// ==============================================================================================
// apps/api/src/composition.ts — COMPOSITION ROOT CỦA TIẾN TRÌNH `api`
//
// [ADR-021] Nơi DUY NHẤT của apps/api dựng hạ tầng thật từ cấu hình: hai pool `app_api` (một cho
// giao dịch, một ĐỘC LẬP cho sổ từ chối quyền — D5), ba vòng bí mật, bộ ký biên nhận, ba bộ gửi,
// rồi lắp `createDispatcher` + `createApiServer`. Cùng khuôn `apps/unseal-worker/src/composition.ts`:
// hàm thuần nhận cấu hình, không đọc `process.env`, không `listen` — `main.ts` mới là chỗ ấy.
//
// HAI ĐIỀU FILE NÀY CỐ Ý LÀM:
//   ⑴ Pool mang `role: "app_api"`: mỗi client `SET ROLE` + kiểm `current_user` trước khi giao ra
//      (`@trustprocure/db`, vai-tro.ts). Tiến trình đăng nhập bằng `app_api_login` — role INHERIT có
//      toàn bộ quyền của app_api nhưng KHÁC tên — và mọi phép đo của dự án chạy dưới `SET ROLE app_api`;
//      lớp này làm tiến trình thật chạy ĐÚNG danh tính đã đo. Migration `037` là lớp CSDL đứng sau.
//   ⑵ `batDau()` chạm CSDL TRƯỚC khi mở cổng: một client của mỗi pool được lấy và trả lại. Sai role,
//      sai mật khẩu, CSDL chưa migrate — tất cả nổ ở đây, khi chưa có ai kết nối được vào, thay vì ở
//      yêu cầu đầu tiên của một người dùng thật.
//
// MỘT ĐIỀU NÓ KHÔNG LÀM: chọn adapter. `cau-hinh.ts` đã đòi tên adapter và hôm nay mỗi loại chỉ có
// một — nên file này không có `switch`; ngày có adapter thứ hai (KMS, SMTP), `switch` mọc ở đây và
// `cau-hinh.ts` mở thêm một giá trị, cả hai trong cùng một commit.
// ==============================================================================================

import type { AddressInfo } from "node:net";
import { createLocalDevReceiptSigner, ReceiptSigningKeyRing } from "@trustprocure/bidding";
import { createLocalDevWrapper, MasterKeyRing } from "@trustprocure/crypto-keys";
import { createPool, khangDinhPhienDangNhapUngDung } from "@trustprocure/db";
import { PepperRing, donBucketNguoiGoiCu, donOtpRateLimitsCu } from "@trustprocure/invitation";
import { JobRunner, KIND_KHONG_NGUOI_NHAN } from "@trustprocure/outbox";
import { taoHopThuDev } from "./adapters/hop-thu-dev.js";
import { taoBoMaBiMatTotp } from "./adapters/totp-local-dev.js";
import type { CauHinhApi } from "./cau-hinh.js";
import { KMS_TIMEOUT_MS_MAC_DINH, boiTranKms } from "./co-han.js";
import { taoDocDiaChi } from "./dia-chi.js";
import { createDispatcher } from "./dispatch.js";
import { ghiLogKetNoiHuy, ghiLogLoiKetNoiToiMuon, moTaLoiKhongGiaTri } from "./mo-ta-loi.js";
import { buildApiOutboxHandlers } from "./outbox-api.js";
import type { ApiServices } from "./route-types.js";
import { createApiServer } from "./server.js";

export interface DiaChiNghe {
  readonly host: string;
  readonly port: number;
}

export interface TienTrinhApi {
  /** Kiểm CSDL (cả hai pool giao ra client đúng vai) rồi mở cổng. Ném thì KHÔNG có cổng nào mở. */
  batDau(): Promise<DiaChiNghe>;
  /** Đóng cổng, chờ kết nối đang mở, rồi đóng cả hai pool. Gọi được nhiều lần. */
  dung(): Promise<void>;
}

/** Chu kỳ poll của runner outbox — đường thử lại; đường chính là `nudge` ngay sau commit. */
const OUTBOX_POLL_MS = 5000;
/**
 * [sổ nợ 55 / 042] Nhịp dọn `caller_rate_limits` ~~. Bảng ấy là bảng DUY NHẤT mà số hàng do người
 * gọi VÔ DANH quyết~~ — và [sổ nợ 57 / 044] của cả `otp_rate_limits`. Bảng đầu vẫn là bảng duy nhất
 * mà số hàng do người gọi VÔ DANH quyết; bảng thứ hai lớn theo lưu lượng THẬT nhưng chưa từng có ai
 * xoá. Mỗi lượt xoá cửa sổ cũ hơn hai cửa sổ, tức không bao giờ chạm bộ đếm đang sống.
 */
const DON_BUCKET_MS = 5 * 60 * 1000;
/**
 * [review H6-8] Ngưỡng "ồn ào" của một lượt dọn. Một tiến trình khoẻ dọn vài chục hàng mỗi năm phút;
 * hàng nghìn nghĩa là ai đó đang xoay địa chỉ. Con số này KHÔNG phải một trần — nó chỉ là ngưỡng ghi log.
 */
const DON_BUCKET_ON_AO = 1000;

export function taoTienTrinhApi(ch: CauHinhApi): TienTrinhApi {
  const pool = createPool(ch.databaseUrl, ch.dbPoolMax, { role: "app_api" });
  // [S1.69 / khoản 120] Chú thích dời từ hằng `AUDIT_POOL_MAX` đã gỡ, giữ nguyên văn: "Số kết nối của pool ~~sổ từ chối quyền — nhỏ, vì nó chỉ
  // ghi một hàng cho mỗi lần 403~~ [S1.68 / lượt soi 62a-4] ghi sổ MỌI lần từ chối ở giao dịch độc lập — `PERMISSION_DENIED` (403),
  // `UNSEAL_DENIED` và hai lần thử vi phạm D2 (422) — dùng chung mọi tổ chức. ~~Cỡ của nó và phép kiểm "pool còn chỗ" tức thì của
  // `requirePermission`: khoản nợ 120.~~" — ~~`AUDIT_POOL_MAX = 2`~~ nay cỡ bằng `dbPoolMax`: mỗi lần ghi sổ từ chối của tiến trình này chạy khi
  // yêu cầu đang giữ một kết nối của `pool` — `requirePermission` của bộ điều phối và mọi handler nhận `auditPool` nằm trong
  // `withTenant(deps.pool, …)` (dispatch.ts, đọc) —, nên nhu cầu đồng thời của `auditPool` không vượt `dbPoolMax`, và cùng cỡ thì với nhu cầu
  // ấy nó không là chỗ hẹp hơn. Với 2 kết nối, đo trên b8d38c7 (biên bản §S1.69): khoá tư vấn ghi sổ của một tổ chức ghim cả hai kết nối, và
  // lần từ chối của tổ chức KHÁC gãy sau 15 ms, không hàng sổ. Giá, nói ra:
  //   ⑴ tối đa `2 × dbPoolMax` kết nối CSDL mỗi tiến trình thay vì `dbPoolMax + 2` — mặc định 20 thay vì 12, ở trần cấu hình 100 là 200 (lượt
  //     soi 63a-3); `batDau` mở một kết nối `auditPool` để kiểm vai, còn lại mở khi có lần từ chối, và đóng sau `idleTimeoutMillis` 10 s mặc
  //     định của pg-pool (`createPool` không đặt);
  //   ⑵ không còn vách ngăn 2 kết nối trước các lần từ chối nằm chờ khoá tư vấn ghi sổ của một tổ chức (lượt soi 63a-2, 63b-3). Đo lặp ba
  //     lượt, `TRUSTPROCURE_DB_POOL_MAX` 3, `/me` của tổ chức A gửi 1 s sau yêu cầu cuối của X (biên bản §S1.69): ba lần từ chối của X tới
  //     tuần tự ⇒ `/me` đứng 13 620–13 647 ms, trước bản vá 16–17 ms; tới cùng lúc ⇒ 13 999–14 016 ms, trước bản vá 14 002–14 018 ms; ba
  //     lần GHI hợp lệ ⇒ khoảng 14 s ở cả hai bản — vách ngăn cũ chưa bao giờ che đường ghi. Chủ dự án chọn giữ cỡ này ngày 2026-09-13 để
  //     lần từ chối chéo tổ chức không mất bản ghi — khoản 123; ~~đường gửi link mời giữ khoá ấy suốt lần gửi — khoản 124~~ [S1.70] khoản 124 đóng: link mời gửi sau commit. Hạn mức theo
  //     người gọi cho lần từ chối — khoản 122.
  //     [S1.72 / lượt soi ngang 66b-8, 66c-1] Số đo ⑵ là của trước S1.71: từ S1.71 lần ghi sổ chờ khoá ghi sổ của tổ chức tối đa 2 s (050),
  //     `/me` của tổ chức khác 627–1 007 ms ở cả ba kịch bản, và khoản 123 đã đóng (§S1.71).
  const auditPool = createPool(ch.databaseUrl, ch.dbPoolMax, { role: "app_api" });
  // [S1.67 / khoản 118] Kết nối bị `withTenant` huỷ vì trạng thái phiên còn sót sau giao dịch: lỗi ấy không được ném cho ai, nên đây là
  // chỗ duy nhất nó thành một dòng log — xem `ghiLogKetNoiHuy`.
  ghiLogKetNoiHuy(pool, "pool");
  ghiLogKetNoiHuy(auditPool, "auditPool");
  // [S1.84 / khoản 129] Lỗi của lần lấy kết nối TỚI SAU trần `maxConnectWaitMs`: người gọi đã nhận
  // `CONNECT_WAIT_EXCEEDED` và bỏ đi, nên lỗi ấy không có ai để ném tới. Đây là chỗ duy nhất nó
  // thành một dòng log. Nêu TÊN POOL: `auditPool` (trần 5 s) và `pool` (phần bù sau commit) là hai
  // đường khác nhau, và một dòng không nói pool nào thì không dẫn tới nguyên nhân nào.
  ghiLogLoiKetNoiToiMuon(pool, "pool");
  ghiLogLoiKetNoiToiMuon(auditPool, "auditPool");

  const totp = taoBoMaBiMatTotp(new MasterKeyRing(ch.totpMasterKeys.active, ch.totpMasterKeys.keys));
  const hopThu = taoHopThuDev({ thuMuc: ch.devMailboxDir, baseUrl: ch.publicBaseUrl });
  // [sổ nợ 38] Hai adapter KMS có TRẦN thời gian — chúng chạy trong giao dịch, và một KMS treo không
  // được giữ kết nối tới idle_in_transaction_session_timeout.
  const services: ApiServices = boiTranKms({
    rfqKeyWrapper: createLocalDevWrapper(new MasterKeyRing(ch.masterKeys.active, ch.masterKeys.keys)),
    totpSecretWrapper: totp.wrapper,
    totpSecretUnsealer: totp.unsealer,
    pepper: new PepperRing(ch.otpPeppers.active, ch.otpPeppers.keys),
    receiptSigner: createLocalDevReceiptSigner(
      new ReceiptSigningKeyRing(ch.receiptSigningKeys.active, ch.receiptSigningKeys.keys),
    ),
    loginLinkSender: hopThu.loginLinkSender,
    approvalNoticeSender: hopThu.approvalNoticeSender,
    deadlineNoticeSender: hopThu.deadlineNoticeSender,
    invitationLinkSender: hopThu.invitationLinkSender,
    otpSender: hopThu.otpSender,
  }, KMS_TIMEOUT_MS_MAC_DINH);

  // [sổ nợ 38 / ADR-022 §1] Runner outbox TRONG tiến trình `api`. `app_api` không đọc được danh sách
  // tổ chức (RLS), nên `listOrganizations` là tập tổ chức tiến trình này ĐÃ THẤY enqueue; `nudge`
  // đánh thức ngay cho tổ chức vừa có job (setImmediate — không chặn phản hồi), vòng poll nhặt job
  // còn sót (thử lại). Giới hạn nhiều instance ghi ở ADR-022.
  const toChucDaThay = new Set<string>();
  const runner = new JobRunner(pool, buildApiOutboxHandlers(services), {
    pollIntervalMs: OUTBOX_POLL_MS,
    listOrganizations: () => [...toChucDaThay],
    // [S1.81 / khoản 154] ĐÚNG MỘT tiến trình trong hệ khai sổ `kind` mồ côi, và đó là tiến trình
    // này. Vì sao `api` chứ không phải worker: `api` là tiến trình chạy thường trực trong mọi
    // triển khai (worker có thể chưa được dựng — khoản 116), nên đặt ở đây thì một `kind` không
    // người nhận vẫn tới trạng thái cuối ỒN ÀO ở đúng một chỗ. Hai tiến trình cùng khai thì cả
    // hai cùng tranh nhau ghi kết cục và `attempts` của job ấy thôi đọc được.
    kindKhongNguoiNhan: Object.keys(KIND_KHONG_NGUOI_NHAN),
    onJobFailure: (bao) => {
      // [CẤM LOG] `bao.cause` có thể mang địa chỉ email — ~~chỉ tên lý do và kind~~ [S1.67 / khoản 118] tên lý do, kind, và TÊN cùng MÃ
      // cố định của lỗi gốc (`moTaLoiKhongGiaTri`) — không message. Trước vòng này dòng này không nói lỗi gì: job hỏng vì kết nối nhiễm
      // hay vì 42501 trông như nhau.
      const loi = bao.cause === undefined ? "" : ` ${moTaLoiKhongGiaTri(bao.cause)}`;
      console.error(`[api] outbox ${bao.kind} ${bao.reason}${bao.gaveUp ? " (bo cuoc)" : ""}${loi}`);
    },
    onPollError: (e) => console.error(`[api] outbox poll ${moTaLoiKhongGiaTri(e)}`),
  });
  const outboxNudge = (orgId: string): void => {
    toChucDaThay.add(orgId);
    setImmediate(() => {
      runner.runOnceForOrg(orgId).catch((e: unknown) => console.error(`[api] outbox ${moTaLoiKhongGiaTri(e)}`));
    });
  };

  const server = createApiServer(
    createDispatcher({
      pool,
      auditPool,
      services,
      outboxNudge,
      ...(ch.afterCommitTimeoutMs === undefined ? {} : { afterCommitTimeoutMs: ch.afterCommitTimeoutMs }),
    }),
    // [sổ nợ 41] Địa chỉ người gọi: socket, trừ khi socket là một proxy đã khai — xem dia-chi.ts.
    { allowedOrigins: ch.allowedOrigins, remoteAddressOf: taoDocDiaChi(ch.trustedProxies) },
  );

  let daDung = false;
  let dongHoDon: NodeJS.Timeout | undefined;

  return {
    async batDau(): Promise<DiaChiNghe> {
      // Chạm CSDL trước khi mở cổng — xem ⑵ ở đầu file. `connect()` của pool có vai tự ném nếu SET ROLE
      // không có hiệu lực; [review H3-1] và PHIÊN đăng nhập phải không mạnh hơn vai ấy (superuser,
      // BYPASSRLS, CREATEROLE, thành viên app_unseal) — SET ROLE không giấu được một RESET ROLE.
      for (const p of [pool, auditPool]) {
        const c = await p.connect();
        // [S1.66 / lượt soi ngang 59b-2] Cùng khuôn [fix I1]: một client mượn không có listener 'error' nào, nên kết nối đứt giữa phép
        // kiểm làm tiến trình chết với một thông điệp không nói gì. Census vế ⒟ đòi listener ở mọi chỗ lấy client.
        const boQuaLoiKetNoi = (): void => {};
        c.on("error", boQuaLoiKetNoi);
        try {
          await khangDinhPhienDangNhapUngDung(c, "app_api");
        } finally {
          c.off("error", boQuaLoiKetNoi);
          c.release();
        }
      }
      await new Promise<void>((xong, hong) => {
        server.once("error", hong);
        server.listen(ch.listenPort, ch.listenHost, () => {
          server.off("error", hong);
          xong();
        });
      });
      runner.start();
      // [sổ nợ 55] Bộ dọn chạy NỀN: `unref` để nó không giữ tiến trình sống, và lỗi của nó ~~chỉ ghi
      // TÊN~~ [S1.67 / khoản 118, lượt soi 61b-8] ghi TÊN cùng mã cố định — một lần dọn hỏng không được làm đổ tiến trình `api` (cùng
      // khuôn `onPollError`).
      // [review H6-8] Bộ dọn là ĐƯỜNG BỊT DUY NHẤT của một bảng mà số hàng do người gọi vô danh
      // quyết, nên nó không được hỏng trong im lặng: mỗi lượt xoá được nhiều hơn `DON_BUCKET_ON_AO`
      // hàng là một tín hiệu tải bất thường, và hai lượt hỏng LIÊN TIẾP là một tín hiệu bộ dọn chết.
      // Cả hai ~~chỉ ghi SỐ và TÊN lỗi~~ [S1.67 / khoản 118, lượt soi 61b-8] ghi SỐ, TÊN lỗi và mã cố định — không giá trị nào của bảng
      // đi vào log.
      //
      // [sổ nợ 57 / 044] Từ nay có HAI bảng phải dọn, và mỗi bảng giữ bộ đếm "hỏng liên tiếp"
      // RIÊNG: gộp chúng vào một biến thì một bộ dọn khoẻ sẽ đặt lại bộ đếm của bộ dọn đã chết,
      // và tín hiệu "hỏng hai lượt liên tiếp" biến mất đúng lúc nó cần được nghe.
      const nhipDon = (ten: string, chay: () => Promise<number>): (() => void) => {
        let hongLienTiep = 0;
        return () => {
          void chay()
            .then((n) => {
              hongLienTiep = 0;
              if (n > DON_BUCKET_ON_AO) console.error(`[api] don ${ten}: ${n} hang`);
            })
            .catch((e: unknown) => {
              hongLienTiep += 1;
              console.error(
                `[api] don ${ten} ${moTaLoiKhongGiaTri(e)}` +
                  (hongLienTiep >= 2 ? ` (hong ${hongLienTiep} luot lien tiep — bang chi lon len)` : ""),
              );
            });
        };
      };
      const donNguoiGoi = nhipDon("bucket nguoi goi", () => donBucketNguoiGoiCu(pool));
      // [review H7-4] Lượt dọn ĐẦU TIÊN sau khi `044` được áp xoá TOÀN BỘ tồn đọng lịch sử của
      // `otp_rate_limits` — bảng ấy chưa từng có ai xoá — nên nó gần như chắc chắn vượt
      // `DON_BUCKET_ON_AO` và ghi một dòng. Dòng ấy ĐÚNG (số hàng là số hàng), nhưng nó KHÔNG phải
      // "tín hiệu tải bất thường" như câu ở trên nói; người trực đêm đọc log lần đầu sau triển khai
      // cần biết điều đó ở đây chứ không phải sau ba mươi phút truy nguyên.
      const donOtp = nhipDon("bucket otp", () => donOtpRateLimitsCu(pool));
      dongHoDon = setInterval(() => {
        donNguoiGoi();
        donOtp();
      }, DON_BUCKET_MS);
      dongHoDon.unref();
      const dc = server.address() as AddressInfo;
      return { host: dc.address, port: dc.port };
    },
    async dung(): Promise<void> {
      if (daDung) return;
      daDung = true;
      runner.stop();
      if (dongHoDon !== undefined) clearInterval(dongHoDon);
      await new Promise<void>((xong) => {
        if (!server.listening) {
          xong();
          return;
        }
        server.close(() => xong());
        // Kết nối keep-alive rảnh không tự đóng khi `close()`; đóng chúng để tiến trình không treo.
        server.closeIdleConnections();
      });
      await Promise.allSettled([pool.end(), auditPool.end()]);
    },
  };
}
