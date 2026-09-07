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
import { PepperRing, donBucketNguoiGoiCu } from "@trustprocure/invitation";
import { JobRunner } from "@trustprocure/outbox";
import { taoHopThuDev } from "./adapters/hop-thu-dev.js";
import { taoBoMaBiMatTotp } from "./adapters/totp-local-dev.js";
import type { CauHinhApi } from "./cau-hinh.js";
import { KMS_TIMEOUT_MS_MAC_DINH, boiTranKms } from "./co-han.js";
import { taoDocDiaChi } from "./dia-chi.js";
import { createDispatcher } from "./dispatch.js";
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

/** Số kết nối của pool sổ từ chối quyền — nhỏ, vì nó chỉ ghi một hàng cho mỗi lần 403. */
const AUDIT_POOL_MAX = 2;
/** Chu kỳ poll của runner outbox — đường thử lại; đường chính là `nudge` ngay sau commit. */
const OUTBOX_POLL_MS = 5000;
/**
 * [sổ nợ 55 / 042] Nhịp dọn `caller_rate_limits`. Bảng ấy là bảng DUY NHẤT mà số hàng do người gọi
 * VÔ DANH quyết (không cần một tổ chức thật nào), nên nó phải có bộ dọn — mỗi lượt xoá cửa sổ cũ
 * hơn hai cửa sổ, tức không bao giờ chạm bộ đếm đang sống.
 */
const DON_BUCKET_MS = 5 * 60 * 1000;
/**
 * [review H6-8] Ngưỡng "ồn ào" của một lượt dọn. Một tiến trình khoẻ dọn vài chục hàng mỗi năm phút;
 * hàng nghìn nghĩa là ai đó đang xoay địa chỉ. Con số này KHÔNG phải một trần — nó chỉ là ngưỡng ghi log.
 */
const DON_BUCKET_ON_AO = 1000;

export function taoTienTrinhApi(ch: CauHinhApi): TienTrinhApi {
  const pool = createPool(ch.databaseUrl, ch.dbPoolMax, { role: "app_api" });
  const auditPool = createPool(ch.databaseUrl, AUDIT_POOL_MAX, { role: "app_api" });

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
    onJobFailure: (bao) => {
      // [CẤM LOG] `bao.cause` có thể mang địa chỉ email — chỉ tên lý do và kind.
      console.error(`[api] outbox ${bao.kind} ${bao.reason}${bao.gaveUp ? " (bo cuoc)" : ""}`);
    },
    onPollError: (e) => console.error(`[api] outbox poll ${e instanceof Error ? e.name : "loi khong ro"}`),
  });
  const outboxNudge = (orgId: string): void => {
    toChucDaThay.add(orgId);
    setImmediate(() => {
      runner.runOnceForOrg(orgId).catch((e: unknown) => console.error(`[api] outbox ${e instanceof Error ? e.name : "loi khong ro"}`));
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
        try {
          await khangDinhPhienDangNhapUngDung(c, "app_api");
        } finally {
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
      // [sổ nợ 55] Bộ dọn chạy NỀN: `unref` để nó không giữ tiến trình sống, và lỗi của nó chỉ ghi
      // TÊN — một lần dọn hỏng không được làm đổ tiến trình `api` (cùng khuôn `onPollError`).
      // [review H6-8] Bộ dọn là ĐƯỜNG BỊT DUY NHẤT của một bảng mà số hàng do người gọi vô danh
      // quyết, nên nó không được hỏng trong im lặng: mỗi lượt xoá được nhiều hơn `DON_BUCKET_ON_AO`
      // hàng là một tín hiệu tải bất thường, và hai lượt hỏng LIÊN TIẾP là một tín hiệu bộ dọn chết.
      // Cả hai chỉ ghi SỐ và TÊN lỗi — không giá trị nào của bảng đi vào log.
      let honglienTiep = 0;
      dongHoDon = setInterval(() => {
        void donBucketNguoiGoiCu(pool)
          .then((n) => {
            honglienTiep = 0;
            if (n > DON_BUCKET_ON_AO) console.error(`[api] don bucket nguoi goi: ${n} hang`);
          })
          .catch((e: unknown) => {
            honglienTiep += 1;
            console.error(
              `[api] don bucket nguoi goi ${e instanceof Error ? e.name : "loi khong ro"}` +
                (honglienTiep >= 2 ? ` (hong ${honglienTiep} luot lien tiep — bang chi lon len)` : ""),
            );
          });
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
