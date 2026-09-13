// ==============================================================================================
// apps/api/src/mo-ta-loi.ts — MÔ TẢ MỘT LỖI CHO DÒNG LOG, KHÔNG MANG GIÁ TRỊ
//
// [S1.67 / khoản 118] Mọi chỗ ghi log lỗi của bộ điều phối và composition root mô tả lỗi bằng MỘT hàm: dòng 500, dòng 42501 và dòng
// `sau-commit` của `dispatch`; dòng outbox và bộ dọn; dòng của bộ nghe `release`. Trước khoản này mỗi chỗ tự viết `e.name`: một lỗi
// Postgres ra dòng log "error" không SQLSTATE, và dòng lỗi job outbox không nói lỗi gì. Ngoại lệ có chủ đích: `main.ts` in `tên:
// thông điệp` của lỗi cấu hình và lỗi khởi động, trước khi có yêu cầu nào (lượt soi 61a-2).
//
// Được ghi: TÊN lỗi (hằng của lớp lỗi) và một MÃ cố định nếu có — mã của `TenantError` (hằng của `@trustprocure/tenancy`), hay mã năm ký
// tự chữ số và chữ hoa (SQLSTATE của PostgreSQL, gồm mã riêng của dự án như TP096; mã hệ thống năm chữ như EPIPE cũng khớp, và cũng là
// hằng). KHÔNG được ghi: `message` — thông điệp của lỗi Postgres mang tên bảng, tên ràng buộc, và DETAIL của nó có thể mang giá trị hàng;
// `cause` — lỗi lồng mang câu lệnh và tham số; `stack` (A2).
// ==============================================================================================
import type pg from "pg";
import { TenantError } from "@trustprocure/tenancy";

/** Hình dạng của SQLSTATE: đúng năm ký tự chữ số và chữ hoa. */
const MA_NAM_KY_TU = /^[0-9A-Z]{5}$/u;

export function moTaLoiKhongGiaTri(loi: unknown): string {
  if (!(loi instanceof Error)) return "loi khong ro";
  if (loi instanceof TenantError) return `${loi.name} ${loi.code}`;
  const ma = (loi as { code?: unknown }).code;
  return typeof ma === "string" && MA_NAM_KY_TU.test(ma) ? `${loi.name} ${ma}` : loi.name;
}

/**
 * [S1.67 / khoản 118] Ghi MỘT dòng khi pool huỷ một kết nối vì `SESSION_STATE_LEFT`.
 *
 * `withTenant` đọc lại trạng thái phiên sau mọi giao dịch; thấy lệch thì huỷ kết nối bằng `release(TenantError SESSION_STATE_LEFT)` và
 * KHÔNG ném — giao dịch có thể đã commit, và ném là bảo người gọi rằng việc của họ không được ghi. Nên lỗi ấy không tới `dispatch`, runner
 * hay bộ dọn nào; chỗ duy nhất thấy nó là sự kiện `release` mà pg-pool phát kèm đối số của `release()` (đọc pg-pool@3.14.0: `_release`
 * phát `'release'` trước khi gỡ client).
 *
 * Nghe đúng MỘT mã. Các lỗi khác đi vào `release()` — `KetNoiNhiemError` hay lỗi của `SET ROLE` ở lần lấy client, `SESSION_SCOPE_LEAK`,
 * lỗi của ROLLBACK, lỗi của bộ dọn — đều đi cùng một lỗi đã được NÉM cho người gọi; bộ nghe không ghi chúng để một sự cố không thành
 * hai dòng. Nói đúng mức (lượt soi 61a-7): lỗi được ném không nhất thiết được ghi — lỗi của ROLLBACK đi kèm một lỗi gốc mà bảng giai
 * đoạn handler trả 401, 409, 422 hay 403 không phải 42501 thì không dòng nào nhắc tới nó.
 * RANH GIỚI, nói ra: khi chính phép đọc lại của `withTenant` ném (kết nối vừa đứt; search path có `pg_temp` đứng đầu dưới vai không có
 * TEMP — đo S1.54), kết nối bị huỷ bằng lỗi gốc, không phải `SESSION_STATE_LEFT`, và bộ nghe này không ghi gì. Ngược lại, khi câu
 * `BEGIN; SELECT` của `withTenant` không xong (`MULTI_STATEMENT_UNSUPPORTED`, câu bị huỷ), mốc search path thiếu nên phép đọc lại tính
 * là lệch và kết nối bị huỷ bằng `SESSION_STATE_LEFT`: bộ nghe ghi một dòng sai nguyên nhân cạnh dòng 500 của lỗi thật (lượt soi 61a-7,
 * đọc).
 * Gắn MỘT lần cho mỗi pool, ở composition root — không trong `createDispatcher`, vì test dựng nhiều bộ điều phối trên cùng một pool.
 */
export function ghiLogKetNoiHuy(pool: pg.Pool, tenPool: string): void {
  pool.on("release", (loi: unknown) => {
    if (loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT") {
      console.error(`[api] ket noi huy ${tenPool} ${moTaLoiKhongGiaTri(loi)}`);
    }
  });
}
