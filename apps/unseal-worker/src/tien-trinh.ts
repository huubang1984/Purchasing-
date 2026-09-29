// ==============================================================================================
// apps/unseal-worker/src/tien-trinh.ts — COMPOSITION ROOT CỦA TIẾN TRÌNH WORKER MỞ THẦU
//
// [khoản 116] Tệp này là thứ khoản 116 gọi là *"điểm vào TIẾN TRÌNH"*: nó dựng hai pool vai
// `app_unseal`, nối `listOrganizations` vào hàm `052`, rồi chạy runner. Trước nó,
// `apps/unseal-worker` có composition nhưng KHÔNG có tiến trình — nên mọi phép đo của 106/107 chạy
// trên một đường KHÁC đường sẽ chạy.
//
// ----------------------------------------------------------------------------------------------
// HAI POOL, VÀ VÌ SAO KHÔNG PHẢI MỘT
// ----------------------------------------------------------------------------------------------
// [khoản 121] `executeUnsealRequest` ghi `UNSEAL_EXECUTION_DENIED` ở một giao dịch ĐỘC LẬP rồi mới
// ném — trong khi giao dịch của job đang giữ một kết nối của pool runner. Dùng lại pool ấy khi nó
// chỉ có một kết nối thì mỗi lần từ chối chờ hết trần rồi ra `DenialAuditFailedError`, KHÔNG bản
// ghi nào. `createUnsealWorkerRunner` không chặn hai pool trùng nhau, nên phép chặn ở đây.
//
// ----------------------------------------------------------------------------------------------
// NGUỒN DANH SÁCH TỔ CHỨC — MỘT LỜI GỌI HÀM, VÀ MỘT PHÉP KIỂM LÚC KHỞI ĐỘNG
// ----------------------------------------------------------------------------------------------
// `organizations` bật FORCE RLS, nên vai `app_unseal` KHÔNG liệt kê được tổ chức bằng một câu
// SELECT (đo: 0 hàng). `052` dựng `public.outbox_danh_sach_to_chuc()` cho đúng việc ấy.
//
// Hàm bị DROP thì lời gọi ném `42883`, và `runOnce()` để lỗi của CHÍNH lister ném ra ngoài (nó chỉ
// nuốt lỗi của từng tổ chức). Nhưng ném ra ngoài trong vòng `start()` thì chỉ tới `onPollError` —
// mặc định IM LẶNG. Nên `batDau()` gọi hàm ấy MỘT LẦN và ném nếu nó không tồn tại: *"thiếu hàm"*
// phải nổ lúc KHỞI ĐỘNG, không phải lúc poll thứ một nghìn.
//
// Câu gọi chạy NGOÀI `withTenant` — có chủ đích, và đây là chỗ duy nhất của tiến trình này làm
// thế. `withTenant` gắn một tổ chức; danh sách tổ chức là câu hỏi ĐỨNG TRƯỚC câu hỏi ấy.
// ==============================================================================================

import { KMSClient } from "@aws-sdk/client-kms";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { MasterKeyRing } from "@trustprocure/crypto-keys";
import { createAwsKmsOrgUnwrapper, createLocalDevOrgUnwrapper, type OrgKeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";
import {
  canhLechDongHoDinhKy,
  createPool,
  doiChieuDauKiemVongKhoa,
  khangDinhPhienDangNhapUngDung,
  kiemLechDongHo,
  moTaLech,
  type DongHo,
} from "@trustprocure/db";
import { moTaLoiKhongGiaTri } from "@trustprocure/identity";
import { KIND_KHONG_NGUOI_NHAN, doTonDong } from "@trustprocure/outbox";
import { TenantError, ngheLoiKetNoiToiMuon, withTenant } from "@trustprocure/tenancy";
import { canhTonDongDinhKy } from "./canh-ton-dong.js";
import { taoCanhBaoDev } from "./adapters/canh-bao-dev.js";
import { taoCanhBaoSes } from "./adapters/canh-bao-ses.js";
import { createUnsealWorkerRunner, type BreakGlassAlertSink } from "./composition.js";
import type { CauHinhWorker } from "./cau-hinh.js";

/**
 * Câu lấy danh sách tổ chức. Ghim đủ schema cho cả hàm lẫn kiểu trả về — khuôn [QT3] của
 * `packages/outbox/src/enqueue.ts`: một `search_path` nhiễm không được đổi nghĩa câu này.
 */
const CAU_LIET_KE_TO_CHUC =
  "SELECT t.id::pg_catalog.text AS id FROM public.outbox_danh_sach_to_chuc() AS t(id)";

/** [ADR-083] Trễ của lần đo tồn đọng ĐẦU TIÊN sau khi lên, ms — đủ để vòng poll đầu chạy trước. */
const TRE_DAU_TON_DONG_MS = 5_000;

// ==============================================================================================
// [S1.9151 / khoản 166] BỘ MÔ TẢ LỖI CHO DÒNG LOG: MỘT HÀM, HAI TIẾN TRÌNH.
//
// ~~Tới trước vòng này tệp này giữ một `moTaLoi` CỤC BỘ ~5 dòng — "bản rút gọn của
// `apps/api/src/mo-ta-loi.ts`", chép có chủ đích vì mã CHẠY của worker không import được `apps/api`
// (`g1-`), và được khai là "một bộ định dạng log, không phải một hàng rào, nên không mang rủi ro
// một bản sẽ trôi".~~ Nó ĐÃ trôi ngay từ lúc chép (§S1.82, khoản 166): bản của `api` nêu thêm MỘT
// tầng `cause` cho lỗi không có trường `code` (khoản 119) và nhận `TenantError` theo lớp; bản ở đây
// thì không — nên một `DenialAuditFailedError`, đúng lớp lỗi khoản 121 dựng cho tiến trình NÀY, ra
// dòng log không có SQLSTATE của lần ghi sổ đã hỏng. Đo ở `composition.int.test.ts` (vế khoản 166)
// trên mã trước vòng này: `… DenialAuditFailedError UNSEAL_EXECUTION_DENIED UNSEAL_REQUEST` ở worker,
// trong khi `api` cho cùng lỗi ấy `… <- error 55P03`. Nay hàm sống ở
// `packages/identity/src/mo-ta-loi.ts` — gói cả hai tiến trình đã phụ thuộc, và là nơi
// `moTaHangDongCuaLanTuChoi` sống — và cả hai tiến trình gọi ĐÚNG MỘT bản; `g1-` giữ nguyên.
// ==============================================================================================

export interface TienTrinhWorker {
  batDau(): Promise<void>;
  dung(): Promise<void>;
}

/** Thứ composition root nhận ngoài cấu hình — hôm nay chỉ để đo. Cùng hình dạng với `apps/api`. */
export interface PhuThuocTienTrinhWorker {
  /** [khoản 196] Đồng hồ tiến trình mà phép canh lệch so với đồng hồ CSDL. Mặc định `Date.now`. */
  readonly dongHo?: DongHo;
}

export function taoTienTrinhUnsealWorker(ch: CauHinhWorker, phuThuoc: PhuThuocTienTrinhWorker = {}): TienTrinhWorker {
  const dongHo = phuThuoc.dongHo ?? Date.now;
  // Hai pool RIÊNG: `createPool` gọi hai lần, nên hai đối tượng khác nhau — không có đường nào
  // truyền nhầm cùng một pool vào cả hai chỗ.
  // [S1.94 / khoản 103] Xem khối cùng nhãn trong `packages/db/src/pool.ts`. Tiến trình NÀY là
  // tiến trình duy nhất giải mã được phong bì, nên một lần chết im lặng ở đây đắt hơn ở `api`.
  const pool = createPool(ch.databaseUrl, ch.dbPoolMax, {
    role: "app_unseal",
    onPoolError: (e) => console.error(`[unseal-worker] pool loi ${moTaLoiKhongGiaTri(e)}`),
  });
  const auditPool = createPool(ch.databaseUrl, ch.dbPoolMax, {
    role: "app_unseal",
    onPoolError: (e) => console.error(`[unseal-worker] pool kiem toan loi ${moTaLoiKhongGiaTri(e)}`),
  });

  // ============================================================================================
  // [S1.84 / khoản 129 và khoản 173] HAI TÍN HIỆU MẤT-KHÔNG-AI-BIẾT, GẮN MỘT LẦN CHO MỖI POOL.
  //
  // ⑴ `release` mang `SESSION_STATE_LEFT`: `withTenant` huỷ một kết nối vì trạng thái phiên còn
  //    sót sau giao dịch. Lỗi ấy KHÔNG được ném cho ai.
  // ⑵ sự kiện lỗi-tới-muộn: lần lấy kết nối tới SAU trần `maxConnectWaitMs`, người gọi đã đi.
  //
  // KHOẢN 173 ĐO ĐƯỢC ĐÚNG CHỖ NÀY: tới S1.83, `apps/api/src/composition.ts` gắn ⑴ cho cả hai pool
  // còn tiến trình này KHÔNG gắn lần nào — nên cùng một sự cố để lại dấu ở `api` và không để lại gì
  // ở tiến trình DUY NHẤT giải mã được phong bì. Cổng `tests/architecture/pool-nghe-du-tin-hieu.test.ts`
  // nay đòi cả hai ở mọi pool dựng trong `apps/`, nên nó không quên lại được.
  //
  // ~~Bộ mô tả là `moTaLoi` CỤC BỘ của tiến trình này, không phải bản của `apps/api`: mã CHẠY của
  // worker không được import từ `apps/api` (quy tắc `g1-`). Bản cục bộ hẹp hơn — khoản 166.~~
  // [S1.9151 / khoản 166] Bộ mô tả là `moTaLoiKhongGiaTri` của `@trustprocure/identity` — cùng bản
  // với `apps/api`, không đi qua `apps/api` (quy tắc `g1-` giữ nguyên).
  // ============================================================================================
  // GẮN TỪNG POOL MỘT, không qua một vòng lặp: cổng `pool-nghe-du-tin-hieu.test.ts` đọc TÊN BIẾN
  // trên cây cú pháp, và một vòng lặp biến hai cái tên ấy thành một biến vòng lặp mà cổng không
  // thấy. Bản đầu của khối này viết bằng vòng lặp và cổng ĐỎ — giữ lại lý do ở đây để lần sau
  // không ai "dọn gọn" nó về vòng lặp rồi làm cổng mù. Chỉ CÁI GỌI được trải ra; phần thân dùng
  // chung qua hai hàm dựng bộ nghe ngay dưới, nên không có logic nào bị chép hai lần.
  const ghiKetNoiHuy =
    (ten: string) =>
    (loi: unknown): void => {
      if (loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT") {
        console.error(`[unseal-worker] ket noi huy ${ten} ${moTaLoiKhongGiaTri(loi)}`);
      }
    };
  const ghiLoiToiMuon =
    (ten: string) =>
    (loi: unknown): void => {
      console.error(`[unseal-worker] loi ket noi toi muon ${ten} ${moTaLoiKhongGiaTri(loi)}`);
    };
  pool.on("release", ghiKetNoiHuy("pool"));
  ngheLoiKetNoiToiMuon(pool, ghiLoiToiMuon("pool"));
  auditPool.on("release", ghiKetNoiHuy("auditPool"));
  ngheLoiKetNoiToiMuon(auditPool, ghiLoiToiMuon("auditPool"));

  // [ADR-064] Adapter mở khoá riêng tổ chức theo TRUSTPROCURE_KEY_ADAPTER: local-dev mở bằng vòng master
  // key; aws-kms gọi `kms:Decrypt` trên `alias/tp-org-wrap` MỘT lần mỗi lượt (ADR-062 mục 3).
  let kmsClient: KMSClient | undefined;
  let unwrapper: OrgKeyUnwrapper;
  if (ch.keyAdapter === "local-dev") {
    unwrapper = createLocalDevOrgUnwrapper(new MasterKeyRing(ch.masterKeys.active, ch.masterKeys.keys));
  } else {
    kmsClient = new KMSClient({ region: ch.kms.region });
    unwrapper = createAwsKmsOrgUnwrapper({ client: kmsClient, keyId: ch.kms.orgWrapKeyId });
  }
  // [ADR-065] Cảnh báo break-glass: thư mục dev hay SES tới danh sách người nhận.
  let sesClient: SESv2Client | undefined;
  let alertSink: BreakGlassAlertSink;
  if (ch.alertAdapter === "dev-file") {
    alertSink = taoCanhBaoDev(ch.alertDir);
  } else {
    sesClient = new SESv2Client({ region: ch.ses.region });
    alertSink = taoCanhBaoSes({
      client: sesClient,
      tuDiaChi: ch.ses.tuDiaChi,
      denDiaChi: ch.ses.denDiaChi,
      ...(ch.ses.configurationSet === undefined ? {} : { configurationSet: ch.ses.configurationSet }),
    });
  }

  const lietKeToChuc = async (): Promise<readonly string[]> => {
    const { rows } = await pool.query<{ id: string }>(CAU_LIET_KE_TO_CHUC);
    return rows.map((r) => r.id);
  };

  const runner = createUnsealWorkerRunner(
    pool,
    {
      unwrapper,
      alertSink,
      auditPool,
      // [CẤM LOG] `report.cause` là lỗi GỐC do handler ném và nó CÓ THỂ mang giá hoặc bản rõ —
      // `runner.ts` ghi rõ điều đó. Ở đây chỉ TÊN lý do, kind, và tên cùng mã cố định của lỗi gốc.
      onJobFailure: (bao) => {
        const loi = bao.cause === undefined ? "" : ` ${moTaLoiKhongGiaTri(bao.cause)}`;
        console.error(
          `[unseal-worker] outbox ${bao.kind} ${bao.reason}${bao.gaveUp ? " (bo cuoc)" : ""}${loi}`,
        );
      },
    },
    {
      pollIntervalMs: ch.pollIntervalMs,
      listOrganizations: lietKeToChuc,
      // [S1.9151 / khoản 168] ĐÚNG MỘT tiến trình trong hệ khai sổ `kind` mồ côi, và từ vòng này đó
      // là tiến trình NÀY — không còn là `api`. Vì sao: bảo đảm của sổ là *"một `kind` không người
      // nhận vẫn tới trạng thái cuối ỒN ÀO"*, và nó chỉ đứng ở tiến trình CLAIM được job ấy. `api`
      // chỉ claim cho tập tổ chức nó ĐÃ THẤY enqueue (`toChucDaThay`, rỗng lại sau mỗi lần khởi
      // động), nên một job mồ côi của tổ chức chưa ai xếp việc qua `api` nằm `PENDING` im lặng — đo
      // ở `tien-trinh.int.test.ts` vế ⑹ trên mã trước vòng này (`PENDING`, `attempts` 0 sau 10 s).
      // Tiến trình này liệt kê MỌI tổ chức (hàm `052`), nên nó là chỗ duy nhất bảo đảm ấy đứng được.
      // Lý do S1.81 chọn `api` — *"chạy thường trực trong mọi triển khai, worker có thể chưa được
      // dựng"* — hết hiệu lực từ S1.82 (khoản 116 đóng: worker có điểm vào tiến trình, service ECS
      // riêng, và ADR-077 báo động khi thiếu task). Hai tiến trình cùng khai thì cả hai tranh nhau
      // ghi kết cục và `attempts` thôi đọc được, nên `apps/api/src/composition.ts` KHÔNG khai.
      // Đọc `Object.keys(...)` Ở ĐÂY, lúc dựng, không hoist lên mức module: sổ thật hôm nay rỗng
      // (S1.91), nên vế ⑹ cho sổ mượn một dòng thử TRƯỚC khi dựng tiến trình.
      kindKhongNguoiNhan: Object.keys(KIND_KHONG_NGUOI_NHAN),
      // Lỗi của CHÍNH lister ném ra khỏi `runOnce()` và tới đây. Không nối nó thì hàm `052` bị
      // DROP là một tiến trình chạy mãi mà phục vụ 0 tổ chức, không một dòng log.
      onPollError: (e) => console.error(`[unseal-worker] outbox poll ${moTaLoiKhongGiaTri(e)}`),
    },
  );

  let daDung = false;
  let dungCanhDongHo: (() => void) | undefined;
  let dungCanhTonDong: (() => void) | undefined;

  return {
    async batDau(): Promise<void> {
      // ⑴ Chạm CSDL TRƯỚC khi chạy vòng poll đầu tiên, trên MỖI pool: `connect()` của pool có vai
      //    tự ném nếu `SET ROLE` không có hiệu lực, và phép kiểm dưới đây đòi thêm rằng PHIÊN
      //    ĐĂNG NHẬP không mạnh hơn vai ấy (superuser, BYPASSRLS, CREATEROLE) — `SET ROLE` không
      //    giấu được một `RESET ROLE`. Cùng khuôn `apps/api/src/composition.ts`.
      for (const p of [pool, auditPool]) {
        const c = await p.connect();
        // Một client mượn không có listener 'error' nào thì kết nối đứt giữa phép kiểm làm tiến
        // trình chết với một thông điệp không nói gì. Census vế ⒟ đòi listener ở mọi chỗ lấy client.
        const boQuaLoiKetNoi = (): void => {};
        c.on("error", boQuaLoiKetNoi);
        try {
          await khangDinhPhienDangNhapUngDung(c, "app_unseal");
          // [khoản 165] Tiến trình này giữ MỘT vòng nên không tự so chéo được (ADR-006). Nó so với
          // dấu kiểm mà `apps/api` đã ghi — hay ghi trước để `api` so. Lệch ⇒ tiến trình KHÔNG lên,
          // thay vì hỏng lúc mở phong bì thật. Không giải mã gì: xem khối đầu `062`.
          // [ADR-064] Dưới `aws-kms` tiến trình không giữ vòng nào để so — xem cùng chỗ ở `apps/api`.
          if (p === pool && ch.keyAdapter === "local-dev") {
            await doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", ch.masterKeys.keys);
          }
        } finally {
          c.off("error", boQuaLoiKetNoi);
          c.release();
        }
      }

      // ⑵ Gọi nguồn danh sách tổ chức MỘT LẦN. Hàm `052` thiếu ⇒ 42883 ⇒ tiến trình KHÔNG lên.
      let soToChuc: number;
      try {
        soToChuc = (await lietKeToChuc()).length;
      } catch (e) {
        throw new Error(
          "khong goi duoc public.outbox_danh_sach_to_chuc() — migration 052 chua ap, hay ham da bi " +
            `DROP, hay app_unseal mat EXECUTE tren no (${moTaLoiKhongGiaTri(e)}). Khong co nguon danh sach to ` +
            "chuc thi runner phuc vu 0 to chuc trong im lang.",
          { cause: e },
        );
      }
      // ==========================================================================================
      // ⑵b [S1.83 / lượt soi ngang 73] DANH SÁCH RỖNG CŨNG PHẢI GIẾT TIẾN TRÌNH, KHÔNG CHỈ MỘT
      // LẦN GỌI NÉM.
      //
      // Vế ⑵ ngay trên chỉ bắt đường hàm KHÔNG GỌI ĐƯỢC (42883, 42501). Nhưng `052` sinh ra để
      // giết một cảnh KHÁC — cảnh ❷ của §S1.82: hàm gọi được, **trả 0 hàng, KHÔNG LỖI**. Ba đột
      // biến lúc chạy mà `tien-trinh.int.test.ts` đã đo đều cho đúng cảnh ấy: `SECURITY INVOKER`,
      // `DROP POLICY organizations_liet_ke_worker`, và đổi chủ hàm. Trước vế này, cả ba đi qua ⑵
      // trót lọt, `runner.start()` chạy, và `runOnce()` gặp danh sách rỗng thì `return 0` — dấu vết
      // duy nhất là một dòng log khởi động ghi `to chuc thay duoc: 0`. Một dòng log không phải một
      // hàng rào: nó không dừng gì, và trên đường mở thầu thì "không dừng" nghĩa là phong bì không
      // ai mở mà không ai biết.
      //
      // VÌ SAO NÉM CHỨ KHÔNG CẢNH BÁO: 0 tổ chức là một cấu hình KHÔNG DÙNG ĐƯỢC cho tiến trình
      // này — nó không có việc gì để làm, mãi mãi, ở mọi lượt poll. Một cụm thật luôn có ít nhất
      // một tổ chức; 0 nghĩa là lớp quyền đã vỡ, không phải "hôm nay vắng khách".
      // ==========================================================================================
      if (soToChuc === 0) {
        throw new Error(
          "public.outbox_danh_sach_to_chuc() goi duoc nhung tra 0 to chuc. Day la canh ❷ cua " +
            "ADR-040: ham SECURITY DEFINER doc mot bang FORCE RLS tra 0 hang MA KHONG LOI khi " +
            "policy `organizations_liet_ke_worker` bi DROP, khi ham bi doi sang SECURITY INVOKER, " +
            "hay khi chu ham khong con la `app_liet_ke_to_chuc`. Tien trinh KHONG len de lan hong " +
            "nay khong thanh im lang tren duong mo thau.",
        );
      }

      // ⑶ [khoản 196 / ADR-074 phần 1] Đồng hồ CSDL phải khớp đồng hồ tiến trình trong ngưỡng TRƯỚC
      //    vòng poll đầu tiên. Worker không phán xử hạn nộp, nhưng nó đóng dấu thời gian lên lượt mở
      //    thầu và lên sổ; một tiến trình tin một đồng hồ đã trôi không được lên — cùng khuôn `apps/api`.
      await kiemLechDongHo(pool, ch.lechDongHoToiDaMs, dongHo);

      runner.start();
      dungCanhDongHo = canhLechDongHoDinhKy({
        nguon: pool,
        nguongMs: ch.lechDongHoToiDaMs,
        chuKyMs: ch.chuKyCanhDongHoMs,
        dongHo,
        baoLech: (p) =>
          console.error(
            `[unseal-worker] canh bao LechDongHo: dong ho CSDL lech ${moTaLech(p.lechMs)} so voi tien trinh ` +
              `(khu hoi ${Math.round(p.khuHoiMs)} ms, nguong ${ch.lechDongHoToiDaMs} ms)`,
          ),
        baoLoi: (e) => console.error(`[unseal-worker] canh LechDongHo khong do duoc ${moTaLoiKhongGiaTri(e)}`),
      });
      // ⑷ [ADR-083] Dòng tồn đọng outbox cho cảnh báo lỗi nghiệp vụ — xem `canh-ton-dong.ts`. Đo
      //    MỘT LẦN ngay sau khi lên (trễ ngắn để vòng poll đầu chạy trước), rồi mỗi nhịp. Mỗi tổ
      //    chức đo trong `withTenant` của CHÍNH tổ chức ấy — không câu nào ở đây chạy ngoài tenant
      //    ngoài lời liệt kê đã khai ở khối đầu tệp.
      // [CẤM LOG] Lỗi chỉ ra TÊN và MÃ qua `moTaLoi`; dòng tổng chỉ mang ba con số.
      dungCanhTonDong = canhTonDongDinhKy({
        chuKyMs: ch.chuKyTonDongMs,
        treDauMs: Math.min(TRE_DAU_TON_DONG_MS, ch.chuKyTonDongMs),
        lietKeToChuc,
        doMotToChuc: (orgId) => withTenant(pool, orgId, (c) => doTonDong(c, orgId)),
        ghi: (dong) => console.error(dong),
        baoLoi: (e) => console.error(`[unseal-worker] outbox ton dong khong do duoc ${moTaLoiKhongGiaTri(e)}`),
      });
      console.error(
        `[unseal-worker] dang chay — khoa: ${ch.keyAdapter}, canh bao: ${ch.alertAdapter}, ` +
          `nhip poll: ${String(ch.pollIntervalMs)} ms, to chuc thay duoc: ${String(soToChuc)}`,
      );
    },

    async dung(): Promise<void> {
      if (daDung) return;
      daDung = true;
      // `stop()` KHÔNG huỷ lượt đang chạy — `runner.ts` tự tài liệu điều đó. Job đang chạy giữ
      // hạn thuê của nó; runner khác nhặt lại sau khi hạn hết. Đó là tính chất của at-least-once.
      runner.stop();
      dungCanhDongHo?.();
      dungCanhTonDong?.();
      await Promise.allSettled([pool.end(), auditPool.end()]);
      kmsClient?.destroy();
      sesClient?.destroy();
    },
  };
}
