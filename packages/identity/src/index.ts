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
// ============================================================================================
// [vòng fix 1 — MỤC 4] `verifyTotpCode` ĐÃ ĐƯỢC RÚT KHỎI CỬA NÀY — CÙNG TIÊU CHÍ VỚI
// `hasPermission`, ÁP CHO E3 THAY VÌ D5
//
// Khối trên tự viết ra tiêu chí phân loại: `assertFreshMfa` được ở lại vì nó NÉM khi không
// thoả (fail-closed) chứ không trả boolean, "nên nó không dựng ra được một cổng gác im lặng".
// Tiêu chí đó đã KHÔNG được áp cho `verifyTotpCode`, thứ trả `{ ok: false, reason }` — đúng
// hình dạng "trả giá trị, không ném, không để lại trạng thái" mà tiêu chí ấy loại ra.
//
// LỖ ĐO ĐƯỢC: `tools/zzprobe/cong-gac-im-lang.ts` với thân `return verifyTotpCode(biMatRo,
// code).ok` cho `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm depcruise` exit 0 (no
// violations). Cổng gác ấy KHÔNG đọc `mfa_credentials`, KHÔNG ghi `last_used_counter`, KHÔNG
// đếm `failed_attempts`, KHÔNG tôn trọng `locked_until` — tức nó bỏ qua CẢ E3(1) LẪN E3(4) và
// bỏ qua chúng trong im lặng. Và bên dựng được nó chính là COMPOSITION ROOT: nơi được tiêm
// `TotpSecretUnsealer`, tức nơi DUY NHẤT trong hệ thống có bí mật TOTP ở dạng rõ.
//
// ĐƯỜNG SẢN PHẨM LÀ `verifyTotpAttempt`. Ba symbol còn lại của totp.ts (`generateTotpSecret`,
// `deriveTotpCode`, `counterForTime`) Ở LẠI vì đường GHI DANH cần chúng và không cái nào phán
// xét một lần đăng nhập: hai cái sau là hàm dẫn xuất thuần không đọc trạng thái nào, cái đầu
// SINH một bí mật mới.
//
// `TotpResult`/`TotpVerifyOptions` cũng rút theo: chúng là chữ ký của một hàm không còn ở cửa
// này. `TotpFailureReason` thì Ở LẠI — nó là thành phần của `MfaDenialReason`, tức một phần
// hợp đồng của `verifyTotpAttempt`.
//
// GIỚI HẠN ĐÃ BIẾT của lớp cưỡng chế, viết ra vì Task 8 mua nó cho D5 và nó KHÔNG tự động áp
// cho E3: `tests/architecture/barrel-exports.test.ts` khoá DANH SÁCH export, không khoá HÌNH
// DẠNG từng symbol. Một hàm MỚI có hình dạng "trả boolean/kết quả, không ghi gì" mà được thêm
// vào danh sách trắng kèm một dòng lý do sẽ đi lọt — lớp cuối cùng vẫn là người đọc.
// ============================================================================================
// `isWellFormedTotpCode` và `khangDinhCuaSo` CỐ Ý không ở đây: hợp đồng nội bộ giữa totp.ts và
// mfa-credentials.ts (một biểu thức hình dạng và một phép kiểm biên), không phải năng lực.
export {
  MAX_TOTP_WINDOW,
  counterForTime,
  deriveTotpCode,
  generateTotpSecret,
  type TotpFailureReason,
} from "./totp.js";
export { MfaRequiredError, assertFreshMfa, type MfaFreshnessCheck } from "./mfa.js";
export {
  MFA_LOCKOUT_SECONDS,
  MFA_MAX_ALLOWED_FAILED_ATTEMPTS,
  MFA_MAX_FAILED_ATTEMPTS,
  enrollTotpCredential,
  verifyTotpAttempt,
  type MfaAttemptResult,
  type MfaDenialReason,
  type TotpAttempt,
  type TotpEnrollment,
  type TotpSecretUnsealer,
  type WrappedTotpSecret,
} from "./mfa-credentials.js";
