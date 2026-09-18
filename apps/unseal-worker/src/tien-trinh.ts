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

import { MasterKeyRing } from "@trustprocure/crypto-keys";
import { createLocalDevUnwrapper } from "@trustprocure/crypto-keys/unwrap";
import { createPool, khangDinhPhienDangNhapUngDung } from "@trustprocure/db";
import { taoCanhBaoDev } from "./adapters/canh-bao-dev.js";
import { createUnsealWorkerRunner } from "./composition.js";
import type { CauHinhWorker } from "./cau-hinh.js";

/**
 * Câu lấy danh sách tổ chức. Ghim đủ schema cho cả hàm lẫn kiểu trả về — khuôn [QT3] của
 * `packages/outbox/src/enqueue.ts`: một `search_path` nhiễm không được đổi nghĩa câu này.
 */
const CAU_LIET_KE_TO_CHUC =
  "SELECT t.id::pg_catalog.text AS id FROM public.outbox_danh_sach_to_chuc() AS t(id)";

/**
 * Mô tả một lỗi cho dòng log mà KHÔNG mang giá trị — bản rút gọn của `apps/api/src/mo-ta-loi.ts`.
 *
 * Bản chép có chủ đích: `apps/unseal-worker` là thư mục DUY NHẤT được giữ khả năng giải mã, và
 * `.dependency-cruiser.cjs` mở đúng một miễn trừ cho nó — cho mã CHẠY của nó import một tệp của
 * `apps/api` là tạo đúng cạnh mà họ quy tắc `g1-` dựng ra để chặn. Đây là một BỘ ĐỊNH DẠNG LOG,
 * không phải một hàng rào, nên bản chép không mang rủi ro *"một bản sẽ trôi"* của
 * `crypto-keys/moi-truong.ts`. Nâng nó lên một gói dùng chung là khoản 166.
 */
function moTaLoi(loi: unknown): string {
  if (!(loi instanceof Error)) return "loi khong ro";
  const ma = (loi as { code?: unknown }).code;
  return typeof ma === "string" && /^[0-9A-Z]{5}$/u.test(ma) ? `${loi.name} ${ma}` : loi.name;
}

export interface TienTrinhWorker {
  batDau(): Promise<void>;
  dung(): Promise<void>;
}

export function taoTienTrinhUnsealWorker(ch: CauHinhWorker): TienTrinhWorker {
  // Hai pool RIÊNG: `createPool` gọi hai lần, nên hai đối tượng khác nhau — không có đường nào
  // truyền nhầm cùng một pool vào cả hai chỗ.
  const pool = createPool(ch.databaseUrl, ch.dbPoolMax, { role: "app_unseal" });
  const auditPool = createPool(ch.databaseUrl, ch.dbPoolMax, { role: "app_unseal" });

  const unwrapper = createLocalDevUnwrapper(
    new MasterKeyRing(ch.masterKeys.active, ch.masterKeys.keys),
  );
  const alertSink = taoCanhBaoDev(ch.alertDir);

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
        const loi = bao.cause === undefined ? "" : ` ${moTaLoi(bao.cause)}`;
        console.error(
          `[unseal-worker] outbox ${bao.kind} ${bao.reason}${bao.gaveUp ? " (bo cuoc)" : ""}${loi}`,
        );
      },
    },
    {
      pollIntervalMs: ch.pollIntervalMs,
      listOrganizations: lietKeToChuc,
      // Lỗi của CHÍNH lister ném ra khỏi `runOnce()` và tới đây. Không nối nó thì hàm `052` bị
      // DROP là một tiến trình chạy mãi mà phục vụ 0 tổ chức, không một dòng log.
      onPollError: (e) => console.error(`[unseal-worker] outbox poll ${moTaLoi(e)}`),
    },
  );

  let daDung = false;

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
            `DROP, hay app_unseal mat EXECUTE tren no (${moTaLoi(e)}). Khong co nguon danh sach to ` +
            "chuc thi runner phuc vu 0 to chuc trong im lang.",
          { cause: e },
        );
      }

      runner.start();
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
      await Promise.allSettled([pool.end(), auditPool.end()]);
    },
  };
}
