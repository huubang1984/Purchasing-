-- =============================================================================================
-- 038 — [sổ nợ 39 / review M-2] BUCKET THEO NGƯỜI GỌI CHO BA ROUTE ĐĂNG NHẬP NGƯỜI MUA
-- =============================================================================================
-- `/auth/link`, `/auth/redeem`, `/auth/totp` chỉ có hạn mức theo NGƯỜI DÙNG (5 token / 15 phút trên
-- `user_login_tokens`). Không có gì đếm theo NGƯỜI GỌI: một IP thử token đăng nhập hay mã TOTP bao
-- nhiêu lần cũng được, chỉ bị chặn bởi khoá hồ sơ (E3) — tức bị chặn theo NẠN NHÂN, không theo kẻ
-- thử. Bucket `CALLER` của OTP khách (010/012/024) đã có đúng hình dạng cần; file này chỉ mở thêm
-- một `bucket_kind` để tầng đăng nhập dùng cùng bảng, cùng pepper (ADR-018), cùng cửa sổ 15 phút.
--
-- Vì sao một kind RIÊNG thay vì dùng lại `CALLER`: hai bucket đếm hai hành vi khác nhau (phát OTP
-- cho khách / gõ vào cửa đăng nhập người mua) với hai trần khác nhau; gộp là để một bên tiêu ngân
-- sách của bên kia. Khoá của bucket mới mang cả ĐƯỜNG DẪN route (`/auth/link|<ip>`), nên ba route có
-- ba bộ đếm riêng — trần từng route ghi ở `apps/api/src/routes/auth.ts`.
--
-- Nơi ĐẾM là dispatcher, trong một giao dịch RIÊNG trước handler (ADR-022 §2): giao dịch của handler
-- rollback khi token sai, nên đếm bên trong nó là đếm THÀNH CÔNG chứ không đếm THỬ.
-- =============================================================================================

ALTER TABLE otp_rate_limits DROP CONSTRAINT otp_rate_limits_bucket_kind_check;
ALTER TABLE otp_rate_limits ADD CONSTRAINT otp_rate_limits_bucket_kind_check
  CHECK (bucket_kind IN ('DEST', 'DEST_ORG', 'CALLER', 'INVITATION', 'LOGIN_CALLER'));
