// ==============================================================================================
// packages/identity/src/mo-ta-loi.ts — MÔ TẢ MỘT LỖI CHO DÒNG LOG, KHÔNG MANG GIÁ TRỊ — MỘT BẢN CHO HAI TIẾN TRÌNH
//
// [S1.9151 / khoản 166] Dời từ `apps/api/src/mo-ta-loi.ts` (S1.67 / khoản 118, S1.68 / khoản 119, S1.85 / khoản 131); thân hàm giữ
// nguyên. Vì sao dời, đo được (§S1.82; đo lại ở `apps/unseal-worker/src/composition.int.test.ts`): worker mở thầu không import được
// `apps/api` (quy tắc `g1-`) nên giữ một bản rút gọn ~5 dòng — không tầng `cause`, không nhận `TenantError` theo lớp — và một
// `DenialAuditFailedError` (lớp lỗi khoản 121 dựng cho ĐÚNG worker) ra dòng log không có SQLSTATE của lần ghi sổ đã hỏng, ở tiến trình
// duy nhất giải mã được. Vì sao ở GÓI NÀY chứ không ở `tenancy`: hàm gọi `moTaHangDongCuaLanTuChoi` (gói này) và `TenantError`
// (tenancy); identity đã phụ thuộc tenancy, chiều ngược thì không import được.
//
// Được ghi: TÊN lỗi (hằng của lớp lỗi) và một MÃ cố định nếu có — mã của `TenantError` (hằng của `@trustprocure/tenancy`), hay mã năm ký
// tự chữ số và chữ hoa (SQLSTATE của PostgreSQL, gồm mã riêng của dự án như TP096; mã hệ thống năm chữ như EPIPE cũng khớp, và cũng là
// hằng); và các HẰNG ĐÓNG của một lần từ chối không ghi được sổ (`moTaHangDongCuaLanTuChoi`). KHÔNG được ghi: `message` — thông điệp
// của lỗi Postgres mang tên bảng, tên ràng buộc, và DETAIL của nó có thể mang giá trị hàng; `cause` nguyên — lỗi lồng mang câu lệnh và
// tham số; `stack` (A2).
//
// [S1.68 / khoản 119] Một lỗi KHÔNG có trường `code` mà có `cause` là Error được nêu thêm MỘT tầng: `tên <- tên và mã của cause`, cùng
// luật trên. Chủ yếu là hai lớp bọc của lần ghi sổ từ chối (`DenialAuditFailedError`, `PermissionAuditFailedError`) — không có tầng
// ấy, dòng log của chúng chỉ có tên, nên người vận hành không phân biệt được lần ghi hỏng vì mất quyền (42501) với kết nối đứt, trigger
// chặn hay khoá ghi sổ bị giữ (55P03). Lỗi CÓ trường `code` — lỗi Postgres, `TenantError`, lỗi hệ thống của Node, kể cả khi mã không
// mang hình dạng được ghi — không nêu cause: mã của chính nó là thứ cần đọc. Đúng một tầng — không đi theo chuỗi.
//
// Người gọi: `apps/api/src/mo-ta-loi.ts` (xuất lại cho bộ điều phối và composition root của `api`) và
// `apps/unseal-worker/src/tien-trinh.ts`. Luật A2 đo ở `mo-ta-loi.test.ts` của gói này và của `apps/api`; hai tiến trình ra cùng một
// chuỗi cho cùng một lỗi đo ở `apps/unseal-worker/src/composition.int.test.ts`.
// ==============================================================================================
import { TenantError } from "@trustprocure/tenancy";
import { moTaHangDongCuaLanTuChoi } from "./rbac.js";

/** Hình dạng của SQLSTATE: đúng năm ký tự chữ số và chữ hoa. */
const MA_NAM_KY_TU = /^[0-9A-Z]{5}$/u;

export function moTaLoiKhongGiaTri(loi: unknown): string {
  if (!(loi instanceof Error)) return "loi khong ro";
  const dong = moTaMotTang(loi);
  return !("code" in loi) && loi.cause instanceof Error ? `${dong} <- ${moTaMotTang(loi.cause)}` : dong;
}

function moTaMotTang(loi: Error): string {
  // [S1.85 / khoản 131] Các HẰNG ĐÓNG của một lần từ chối không ghi được sổ, nếu lỗi này là một trong hai lớp bọc ấy. Phép kiểm hình
  // dạng nằm trong `moTaHangDongCuaLanTuChoi` (rbac.ts), và nó trả chuỗi RỖNG cho mọi lỗi khác, kể cả một lỗi chỉ mang TÊN của hai
  // lớp ấy. Thứ đi qua đây vẫn chỉ là tên lớp, mã cố định và mã định danh viết hoa; `message` và `cause` nguyên không vào dòng.
  const hang = moTaHangDongCuaLanTuChoi(loi);
  const duoi = hang === "" ? "" : ` ${hang}`;
  if (loi instanceof TenantError) return `${loi.name} ${loi.code}${duoi}`;
  const ma = (loi as { code?: unknown }).code;
  return typeof ma === "string" && MA_NAM_KY_TU.test(ma) ? `${loi.name} ${ma}${duoi}` : `${loi.name}${duoi}`;
}
