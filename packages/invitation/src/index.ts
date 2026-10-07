// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/invitation
//
// Canh bởi hai lớp bổ túc nhau: danh sách trắng ở tests/architecture/barrel-exports.test.ts canh
// SYMBOL đi qua cửa, họ quy tắc `g7-` của dependency-cruiser canh việc KHÔNG AI ĐI VÒNG QUA CỬA
// (và [INV-H16] đòi mọi gói phải có đúng một họ như vậy).
//
// MỘT SYMBOL CỐ Ý KHÔNG NẰM Ở ĐÂY, và lý do là tiêu chí đã dùng cho `hasPermission` (D5) và
// `verifyTotpCode` (E3): **không có hàm nào ở cửa này trả về một PHIÊN từ một TOKEN.**
// `redeemMagicLink` trả `RedeemedLink` — một thứ không mở được gì. Hàm duy nhất sinh phiên là
// `verifyOtpAndStartSession`, và nó đòi một mã OTP. Bất biến E2 vì vậy nằm trong HÌNH DẠNG của
// mặt tiền, không nằm trong trí nhớ của người dựng cổng gác.
// ============================================================================================
export {
  CHANNELS,
  // [S1.181 / ADR-110] Trần và cửa sổ của lần gửi lại link mời — route người mua đọc để trả `Retry-After`.
  CUA_SO_LINK_MOI_GIAY,
  GUEST_SESSION_MAX_TTL_SECONDS,
  GUEST_SESSION_TOKEN_BYTES,
  InvitationError,
  LINK_MOI_TOI_DA_MOI_GIO,
  MAGIC_LINK_MAX_TTL_SECONDS,
  MAGIC_LINK_TOKEN_BYTES,
  OTP_LOCKOUT_SECONDS,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_MAX_PER_CALLER,
  OTP_MAX_PER_DEST,
  OTP_MAX_PER_INVITATION,
  OTP_RATE_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
  clearOtpLockout,
  createInvitation,
  // [S1.188 / S3.2b2 / ADR-113] Tổ chức đã bật S3: `UNSENT→SENT` sau lần gửi link thành công — phần *xong* của lần gửi sau commit.
  danhDauDaGui,
  // [sổ nợ 55 / 042] Bộ dọn `caller_rate_limits` — việc NỀN của tiến trình `api`, nhận Pool.
  donBucketNguoiGoiCu,
  donOtpRateLimitsCu,
  // [S1.188 / S3.2b2 / ADR-113] Tổ chức đã bật S3: đúc token cho mọi lời mời còn sống TRONG giao dịch mở gói, dưới phiên người mở.
  ducTokenKhiMoGoi,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  // [S1.181 / ADR-110] Gửi lại link cho CÙNG lời mời còn sống, và phần bù của nó khi gửi hỏng sau commit.
  reissueInvitationLink,
  revokeMagicLinkToken,
  // [ADR-020 / S1.10.2] Cookie khách → phiên khách. Đường vào DUY NHẤT của `withGuestSession` từ apps/api.
  getInvitationNoticeTarget,
  resolveGuestSessionByToken,
  listInvitations,
  // [S1.181 / ADR-109] Nhà cung cấp tự thoát phiên khách của mình — chạm đúng một hàng phiên, dẫn xuất từ cookie.
  revokeGuestSession,
  revokeInvitation,
  // [sổ nợ 39] Bộ đếm bucket cho người gọi ba route /auth/* — chỉ mở kind LOGIN_CALLER; dispatcher gọi.
  tangBucketHanMuc,
  // [sổ nợ 55] Bộ đếm người gọi TOÀN CỤC (không org_id) — tổ chức thật và tổ chức lạ cùng một hàng.
  tangBucketNguoiGoi,
  verifyOtpAndStartSession,
  type Channel,
  type CreateInvitationInput,
  type InvitationRecord,
  type IssueOtpInput,
  type IssuedToken,
  type LinkKhiMoGoi,
  type OtpDenialReason,
  type OtpIssueOutcome,
  type OtpVerifyResult,
  type RedeemedLink,
  type ReissueLinkOutcome,
  type ResolvedGuestSession,
  type VerifyOtpInput,
  type DanhSachLoiMoi,
} from "./invitation.js";
// [S1.265 / S3.3b · spec S3 §4.4 · K4a] Ngoại lệ cạnh tranh — lập, rút, đọc; và hai tập đóng cùng hai trần mà route dùng lại.
export {
  LOAI_NGOAI_LE,
  LOAI_NGOAI_LE_HAU_KIEM,
  MA_LY_DO_NGOAI_LE,
  SAN_GIAI_TRINH_OTHER_BYTE,
  TRAN_GIAI_TRINH_BYTE,
  docNgoaiLe,
  lapNgoaiLe,
  rutNgoaiLe,
  type LoaiNgoaiLe,
  type MaLyDoNgoaiLe,
  type DanhSachNgoaiLe,
  type NgoaiLeCanhTranh,
} from "./ngoai-le.js";
// ============================================================================================
// [ADR-018] Vong pepper. `PepperRing` phai ra cua vi composition root la noi TIEM no — cung
// khuon `TotpSecretUnsealer` cua identity. No la mot KIEU RIENG du hinh dang giong het
// `MasterKeyRing`, va ly do nam o dau packages/invitation/src/pepper.ts: hai vong khoa cung KIEU
// thi cung noi tiem duoc, va mot ngay nao do mot dong cau hinh se lam pepper BANG khoa boc phong
// bi. Kieu rieng lam viec ay KHONG VIET DUOC.
// ============================================================================================
export { PepperError, PepperRing } from "./pepper.js";
