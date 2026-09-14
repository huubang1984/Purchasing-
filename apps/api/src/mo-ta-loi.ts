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
// ~~`cause` — lỗi lồng mang câu lệnh và tham số~~ [S1.68 / khoản 119] `cause` nguyên — lỗi lồng mang câu lệnh và tham số; `stack` (A2).
//
// [S1.68 / khoản 119] Một lỗi KHÔNG có trường `code` mà có `cause` là Error được nêu thêm MỘT tầng: `tên <- tên và mã của cause`, cùng luật
// trên. Hôm nay chủ yếu là hai lớp bọc của lần ghi sổ từ chối (`DenialAuditFailedError`, `PermissionAuditFailedError`) — trước khoản này
// dòng log của chúng chỉ có tên, nên người vận hành không phân biệt được lần ghi hỏng vì mất quyền (42501) với kết nối đứt hay trigger chặn
// — nhưng luật áp cho MỌI chỗ gọi hàm này: dòng outbox của một handler ném lỗi mang `cause`, `sau-commit`, `onPollError`, bộ dọn, dòng 500
// của lỗi ngoài bảng (lượt soi 62a-8). Lỗi CÓ trường `code` — lỗi Postgres, `TenantError`, lỗi hệ thống của Node, kể cả khi mã không mang
// hình dạng được ghi — không nêu cause: mã của chính nó là thứ cần đọc, và test S1.67 ghim đúng điều ấy (bản đầu của vòng này xét "không
// ra mã" thay vì "không có trường" và làm đỏ test ấy). Đúng một tầng — không đi theo chuỗi.
// ==============================================================================================
import type pg from "pg";
import { TenantError } from "@trustprocure/tenancy";

/** Hình dạng của SQLSTATE: đúng năm ký tự chữ số và chữ hoa. */
const MA_NAM_KY_TU = /^[0-9A-Z]{5}$/u;

export function moTaLoiKhongGiaTri(loi: unknown): string {
  if (!(loi instanceof Error)) return "loi khong ro";
  const dong = moTaMotTang(loi);
  return !("code" in loi) && loi.cause instanceof Error ? `${dong} <- ${moTaMotTang(loi.cause)}` : dong;
}

function moTaMotTang(loi: Error): string {
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
 * lỗi của ROLLBACK, lỗi của bộ dọn — ~~đều đi cùng một lỗi đã được NÉM cho người gọi~~ [S1.72 / lượt soi ngang 66b-1] đi cùng một lỗi đã được
 * NÉM cho người gọi, TRỪ khi lần lấy client tới SAU trần `maxConnectWaitMs` của `withTenant`: kết nối nhiễm bị bộ bọc vai huỷ bằng
 * `release(KetNoiNhiemError)` trong khi lời hứa của lần lấy đã bị bỏ, nên không ai nhận lỗi ấy — đo (§S1.72): `withTenant` ném
 * CONNECT_WAIT_EXCEEDED, sự kiện `release` mang `KetNoiNhiemError`, 0 dòng log (khoản 129); bộ nghe không ghi chúng để một sự cố không thành
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
