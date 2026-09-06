-- =============================================================================================
-- 029 — [S1.10.4 / ADR-020 mục 2] ĐĂNG NHẬP NGƯỜI MUA: token đăng nhập + phiên chỉ ra đời sau MFA
-- =============================================================================================
-- Khoản nợ 6 của sổ S0 (*"không hàm nào phát token, tra token, hay đặt `mfa_verified_at`"*) có
-- nửa ĐỌC đóng ở S1.10.2 (`resolveSessionByToken`); file này là lược đồ cho nửa PHÁT. ADR-020 mục
-- 2 chốt: **magic link email + TOTP bắt buộc, không mật khẩu**. Hai thứ ở đây:
--
--   (1) `user_login_tokens` — cùng khuôn `rfq_invitation_tokens` (010): băm, đơn mục đích, có hạn,
--       dùng một lần (E1 cho người mua). Bảng KHÔNG có `revoked_at`: một token đăng nhập sống 15
--       phút, và cách "thu hồi" là để nó hết hạn hoặc tiêu thụ — thêm một cột thu hồi là thêm một
--       trạng thái phải kiểm ở mọi chỗ đọc cho một ca chưa ai cần.
--   (2) `sessions` — `app_api` nay được INSERT `mfa_verified_at`, và một trigger BEFORE INSERT ép:
--       **một hàng `sessions` do `app_api` tạo phải mang `mfa_verified_at`**. Không có "đăng nhập
--       nửa chừng" nằm trong bảng; `startUserSession` chèn đúng một hàng, đã MFA, trong cùng giao
--       dịch với lần TOTP thành công. `resolveSessionByToken` (S1.10.2) đã từ chối hàng thiếu MFA ở
--       tầng đọc; trigger này đóng tầng ghi — hai lớp, hai chiều.
--
-- Trigger CỐ Ý điều kiện theo `current_user = 'app_api'`, khác với các trigger 011/013 (chạy cho
-- MỌI role). Lý do: một hàng `sessions` thiếu MFA là một TRẠNG THÁI hợp lệ cho bộ test (đo
-- `assertFreshMfa`, đo `resolveSessionByToken` từ chối) và cho một đường vận hành chưa có tên;
-- điều ADR-020 cấm là ỨNG DỤNG tạo ra nó. ~~`SET ROLE app_api` làm `current_user` = `app_api`
-- (test-support đo điều ấy ngay khi mở pool), nên vị từ này nhìn thấy đúng đường ứng dụng.~~
-- [S1.11 / 037] Câu vừa gạch đúng cho đường TEST và SAI cho đường SẢN XUẤT: tiến trình đăng nhập
-- bằng `app_api_login` (INHERIT, hardening) — có mọi quyền của app_api mà `current_user` KHÁC tên —
-- nên vị từ này IM LẶNG nếu ứng dụng quên `SET ROLE`. Thân hàm dưới đây là LỊCH SỬ: 037 thay bằng
-- `la_duong_ung_dung('app_api')` (kế thừa quyền + không superuser), cùng tên hàm, cùng trigger.
-- =============================================================================================

CREATE TABLE user_login_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  user_id      uuid NOT NULL,
  token_hash   bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  purpose      text NOT NULL CHECK (purpose IN ('LOGIN')),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id) ON DELETE CASCADE,
  -- org_id đứng ĐẦU: H14 (bộ dò oracle xuyên tổ chức) đòi thế cho mọi chỉ mục duy nhất.
  UNIQUE (org_id, token_hash),
  CONSTRAINT user_login_tokens_han_sau_tao CHECK (expires_at > created_at)
);

CREATE INDEX user_login_tokens_org_user_created_idx ON user_login_tokens (org_id, user_id, created_at);

ALTER TABLE user_login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_login_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY user_login_tokens_tenant_isolation ON user_login_tokens
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới sau 027 phải tự mang policy khách; lớp canh ở
-- tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts đỏ nếu thiếu. Khách KHÔNG có việc gì ở đây.
CREATE POLICY user_login_tokens_khach ON user_login_tokens AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON user_login_tokens TO app_api;
GRANT INSERT (org_id, user_id, token_hash, purpose, expires_at) ON user_login_tokens TO app_api;
GRANT UPDATE (consumed_at) ON user_login_tokens TO app_api;

-- Tiêu thụ ĐƠN ĐIỆU — cùng hàm 012 đã dựng cho token lời mời: đã bật thì không tắt lại được.
CREATE TRIGGER user_login_tokens_thu_hoi_don_dieu
  BEFORE UPDATE ON user_login_tokens
  FOR EACH ROW EXECUTE FUNCTION public.thu_hoi_don_dieu('consumed_at');
ALTER TABLE user_login_tokens ENABLE ALWAYS TRIGGER user_login_tokens_thu_hoi_don_dieu;

-- ---------------------------------------------------------------------------------------------
-- (2) sessions: app_api chèn được mfa_verified_at, và PHẢI chèn nó
-- ---------------------------------------------------------------------------------------------
GRANT INSERT (mfa_verified_at) ON sessions TO app_api;

CREATE OR REPLACE FUNCTION public.sessions_kiem_mfa_khi_tao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF current_user OPERATOR(pg_catalog.=) 'app_api'::pg_catalog.name
     AND NEW.mfa_verified_at IS NULL THEN
    RAISE EXCEPTION 'app_api khong duoc tao mot phien chua qua MFA (ADR-020 muc 2): mfa_verified_at phai duoc dat trong cung cau INSERT'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER sessions_kiem_mfa_khi_tao
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_mfa_khi_tao();
ALTER TABLE sessions ENABLE ALWAYS TRIGGER sessions_kiem_mfa_khi_tao;
