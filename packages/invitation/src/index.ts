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
  GUEST_SESSION_MAX_TTL_SECONDS,
  GUEST_SESSION_TOKEN_BYTES,
  InvitationError,
  MAGIC_LINK_MAX_TTL_SECONDS,
  MAGIC_LINK_TOKEN_BYTES,
  OTP_LOCKOUT_SECONDS,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_MAX_PER_CALLER,
  OTP_MAX_PER_DEST,
  OTP_MAX_PER_INVITATION,
  OTP_RATE_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  revokeInvitation,
  verifyOtpAndStartSession,
  type Channel,
  type CreateInvitationInput,
  type InvitationActor,
  type InvitationRecord,
  type IssueOtpInput,
  type IssuedToken,
  type OtpDenialReason,
  type OtpIssueOutcome,
  type OtpVerifyResult,
  type RedeemedLink,
  type VerifyOtpInput,
} from "./invitation.js";
