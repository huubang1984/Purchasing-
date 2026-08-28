// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/identity
//
// [vòng fix 1 — F6] `hasPermission` CỐ Ý KHÔNG NẰM Ở ĐÂY. Nó vẫn tồn tại và vẫn là hàm mà
// `requirePermission` gọi, nhưng nó là hợp đồng NỘI BỘ của gói.
//
// Vì sao — một lỗ ĐO ĐƯỢC nằm ở MẶT TIỀN chứ không ở thân hàm. Bất biến D5 (docs/TEST-PLAN.md)
// nói "mỗi lần TỪ CHỐI quyền phải để lại bản ghi kiểm toán". `hasPermission` trả `boolean` và
// KHÔNG ghi gì. Một cổng gác viết bằng nó —
//     if (!(await hasPermission(client, { userId, orgId, permission }))) throw new Forbidden();
// — hợp lệ về kiểu, đọc rất tự nhiên, và vi phạm D5 TRONG IM LẶNG. Đo trên PostgreSQL 16.15:
// dò 11 mã quyền qua `hasPermission` -> sổ kiểm toán trước = 3, sau = 3 (KHÔNG bản ghi mới).
//
// Thân `requirePermission` thì VỮNG — cả ba đường làm một lần từ chối của nó biến mất đều thất
// bại (auditPool cạn -> PermissionAuditFailedError; khoá tư vấn bị giữ -> lỗi tức thì; người
// gọi nuốt lỗi rồi rollback -> bản ghi VẪN CÒN vì nằm ở transaction độc lập). Nên bản vá đúng
// chỗ là RÚT SYMBOL KHỎI BARREL, không phải vá thêm vào thân hàm.
//
// Cùng khuôn `crypto-keys` vòng fix 5 ("chặn symbol lọt qua barrel công khai"): cấu hình
// dependency-cruiser canh CẠNH phụ thuộc và KHÔNG nhìn thấy symbol, nên lớp cưỡng chế là một
// test khẳng định TẬP EXPORT THẬT của cửa này khớp danh sách trắng —
// tests/architecture/barrel-exports.test.ts.
//
// PHÁT BIỂU ĐÚNG MỨC, không rộng hơn thứ được cưỡng chế: D5 được cưỡng chế cho ĐƯỜNG ĐI QUA
// `requirePermission`. Mã BÊN TRONG gói identity vẫn gọi `hasPermission` trực tiếp được (nó
// nằm cùng gói), và một lần từ chối ở TẦNG CSDL (RLS/GRANT) cũng không sinh bản ghi nào — đo
// được. Việc barrel không xuất nó đóng đúng một đường: một gói KHÁC vô tình dựng cổng gác bằng
// nó.
// ============================================================================================
export {
  CHAIN_COVERING_ROLE_PAIRS,
  PERMISSIONS,
  SEPARATION_OF_DUTIES_CHAIN,
  type Permission,
} from "./permissions.js";
export {
  PermissionAuditFailedError,
  PermissionDeniedError,
  requirePermission,
  type PermissionCheck,
  type PermissionRequirement,
} from "./rbac.js";
