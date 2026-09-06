-- =============================================================================================
-- 040 — [sổ nợ 40 / review M-5] ĐẶT LẠI TOTP: HAI NGƯỜI, VÀ HỒ SƠ BỊ XOÁ CHỨ KHÔNG BỊ SỬA
-- =============================================================================================
-- Người mất ứng dụng TOTP với hồ sơ ĐÃ xác nhận không có lối vào: `enrollOrReplaceTotpForLogin` chỉ
-- thay bí mật của hồ sơ CHƯA xác nhận (031), và 032 khoá ba cột của hồ sơ đã xác nhận trước mọi
-- UPDATE của đường ứng dụng — cả hai đều đúng, và cùng nhau chúng để lại một người không đường về.
--
-- Đường về là một QUY TRÌNH, không phải một lệnh (ADR-022 §3):
--   ⑴ một người có `user.mfa_reset` YÊU CẦU (bảng dưới, lý do bắt buộc, hết hạn 24 giờ);
--   ⑵ một người KHÁC — khác người, khác phiên, cũng có `user.mfa_reset` — PHÊ DUYỆT;
--   ⑶ trong cùng giao dịch phê duyệt: hồ sơ TOTP bị XOÁ (không sửa — bí mật cũ không được phép còn
--      sống để ai đó xác nhận lại), mọi phiên còn sống của người ấy bị thu hồi, yêu cầu được đánh
--      dấu đã tiêu thụ. Lần đăng nhập kế của người ấy ⇒ `needsEnrollment` ⇒ bí mật MỚI.
--
-- CSDL cưỡng chế ~~ba~~ BỐN vế mà mã ứng dụng chỉ NHỚ: yêu cầu ≠ duyệt (CHECK, hai vế người và phiên);
-- danh tính là dẫn xuất của phiên (trigger 013 cho cả người yêu cầu lẫn người duyệt); [review H4-1]
-- người yêu cầu VÀ người duyệt đều phải CÓ `user.mfa_reset` (trigger đọc `user_roles ⋈
-- role_permissions`, khuôn 033 — vì `requirePermission` là tầng ứng dụng, tức tầng mà mô hình
-- "app_api bị chiếm" giả định là mất); và `app_api` CHỈ xoá được hồ sơ TOTP khi có một yêu cầu ĐÃ
-- DUYỆT, CHƯA TIÊU THỤ, CHƯA HẾT HẠN cho đúng (org, user) — trigger BEFORE DELETE trên đường ứng
-- dụng (037). 032 không cần chạm.
-- =============================================================================================

INSERT INTO permissions (code, description) VALUES
  ('user.mfa_reset', 'Yeu cau hoac phe duyet dat lai TOTP cho mot nguoi dung — hai nguoi, khong tu duyet (040)');

-- Hai vai KHÔNG nằm trong chuỗi D3 với mã này; PM và DIRECTOR là hai vai quản lý có mặt ở mọi
-- tổ chức, nên một tổ chức có hai người quản lý là có đường về.
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('PROCUREMENT_MANAGER', 'user.mfa_reset'),
  ('DIRECTOR', 'user.mfa_reset');

CREATE TABLE mfa_reset_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES organizations(id),
  user_id                  uuid NOT NULL,
  reason                   text NOT NULL CHECK (octet_length(reason) > 0 AND octet_length(reason) <= 2000),
  status                   text NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'APPROVED', 'CANCELLED')),
  requested_by             uuid NOT NULL,
  requested_by_session_id  uuid NOT NULL,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  approved_by              uuid,
  approved_by_session_id   uuid,
  approved_at              timestamptz,
  consumed_at              timestamptz,
  FOREIGN KEY (org_id, user_id)      REFERENCES users (org_id, id),
  FOREIGN KEY (org_id, requested_by) REFERENCES users (org_id, id),
  FOREIGN KEY (org_id, approved_by)  REFERENCES users (org_id, id),
  -- Ba cột phê duyệt đi cùng nhau, và chỉ khi APPROVED.
  CONSTRAINT mfa_reset_requests_duyet_du_bo CHECK (
    (status = 'APPROVED') = (approved_by IS NOT NULL AND approved_by_session_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  -- [D2/D3] Người yêu cầu không được là người duyệt — và phiên duyệt phải là một PHIÊN KHÁC.
  CONSTRAINT mfa_reset_requests_khong_tu_duyet CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT mfa_reset_requests_phien_khac CHECK (approved_by_session_id IS NULL OR approved_by_session_id <> requested_by_session_id),
  CONSTRAINT mfa_reset_requests_tieu_thu_sau_duyet CHECK (consumed_at IS NULL OR status = 'APPROVED'),
  CONSTRAINT mfa_reset_requests_han_sau_tao CHECK (expires_at > requested_at)
);

-- Một người chỉ có MỘT yêu cầu đang chờ. org_id đứng đầu (H14).
CREATE UNIQUE INDEX mfa_reset_requests_mot_yeu_cau_dang_cho
  ON mfa_reset_requests (org_id, user_id) WHERE status = 'PENDING';
CREATE INDEX mfa_reset_requests_org_user_idx ON mfa_reset_requests (org_id, user_id);

ALTER TABLE mfa_reset_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_reset_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY mfa_reset_requests_tenant_isolation ON mfa_reset_requests
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới sau 027 phải tự mang policy khách. Khách KHÔNG có việc gì ở đây.
CREATE POLICY mfa_reset_requests_khach ON mfa_reset_requests AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON mfa_reset_requests TO app_api;
GRANT INSERT (org_id, user_id, reason, requested_by, requested_by_session_id) ON mfa_reset_requests TO app_api;
GRANT UPDATE (status, approved_by, approved_by_session_id, approved_at, consumed_at) ON mfa_reset_requests TO app_api;

-- [013] Danh tính người yêu cầu là DẪN XUẤT của phiên.
CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh
  BEFORE INSERT ON mfa_reset_requests
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'requested_by', 'requested_by_session_id');
ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_danh_tinh;

-- [013] ... và danh tính người duyệt cũng thế — đúng lúc cột ấy được đặt.
CREATE TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet
  BEFORE UPDATE ON mfa_reset_requests
  FOR EACH ROW
  WHEN (OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('approved_by', 'approved_by_session_id');
ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet;

-- [review H4-1] "Hai người" phải là "hai người CÓ `user.mfa_reset`", và vế ấy phải đứng Ở CSDL: với
-- hai phiên BUYER sống bất kỳ (app_api có SELECT ON sessions), một app_api bị chiếm tự dựng yêu cầu
-- + phê duyệt + DELETE và trigger xoá cho qua — "hai phiên sống" không phải "hai người quản lý".
-- Đọc `user_roles ⋈ role_permissions` như 033. VÔ ĐIỀU KIỆN (không theo đường ứng dụng): không có
-- đường nào mà một người không quyền được đứng tên yêu cầu hay phê duyệt.
CREATE FUNCTION public.mfa_reset_kiem_quyen() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
DECLARE
  nguoi pg_catalog.uuid;
  vai   pg_catalog.text;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
    nguoi := NEW.requested_by; vai := 'nguoi yeu cau';
  ELSE
    nguoi := NEW.approved_by;  vai := 'nguoi phe duyet';
  END IF;
  IF nguoi IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
         JOIN public.role_permissions rp ON rp.role_code OPERATOR(pg_catalog.=) ur.role_code
        WHERE ur.org_id OPERATOR(pg_catalog.=) NEW.org_id
          AND ur.user_id OPERATOR(pg_catalog.=) nguoi
          AND rp.permission_code OPERATOR(pg_catalog.=) 'user.mfa_reset') THEN
    RAISE EXCEPTION 'Dat lai TOTP: % phai co user.mfa_reset (040, review H4-1)', vai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau
  BEFORE INSERT ON mfa_reset_requests
  FOR EACH ROW EXECUTE FUNCTION public.mfa_reset_kiem_quyen();
ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau;

CREATE TRIGGER mfa_reset_requests_kiem_quyen_duyet
  BEFORE UPDATE ON mfa_reset_requests
  FOR EACH ROW
  WHEN (OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL)
  EXECUTE FUNCTION public.mfa_reset_kiem_quyen();
ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_quyen_duyet;

-- Máy trạng thái: PENDING → APPROVED (chưa hết hạn) | CANCELLED; APPROVED chỉ còn nhận `consumed_at`
-- đúng một lần; các cột yêu cầu bất biến.
CREATE FUNCTION public.mfa_reset_kiem_chuyen_trang_thai() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_by_session_id IS DISTINCT FROM OLD.requested_by_session_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Yeu cau dat lai TOTP: cac cot yeu cau la bat bien (040)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status OPERATOR(pg_catalog.=) 'PENDING' AND NEW.status OPERATOR(pg_catalog.=) 'APPROVED' THEN
    IF OLD.expires_at OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'Yeu cau dat lai TOTP da het han, khong phe duyet duoc (040)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Phe duyet va tieu thu la hai buoc (040)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status OPERATOR(pg_catalog.=) 'PENDING' AND NEW.status OPERATOR(pg_catalog.=) 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status OPERATOR(pg_catalog.=) 'APPROVED' AND NEW.status OPERATOR(pg_catalog.=) 'APPROVED'
     AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
     AND NEW.approved_by_session_id IS NOT DISTINCT FROM OLD.approved_by_session_id
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
     AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Yeu cau dat lai TOTP: chuyen tu % sang % khong hop le (040)', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END
$ham$;

CREATE TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai
  BEFORE UPDATE ON mfa_reset_requests
  FOR EACH ROW EXECUTE FUNCTION public.mfa_reset_kiem_chuyen_trang_thai();
ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai;

-- ---------------------------------------------------------------------------------------------
-- Hồ sơ TOTP: `app_api` nay XOÁ được — nhưng chỉ khi CSDL thấy một yêu cầu đã duyệt đang chờ tiêu
-- thụ cho đúng người ấy. Không có yêu cầu ⇒ 23514, và một `app_api` bị chiếm không xoá trộm được
-- hồ sơ ai (xoá hồ sơ = mở đường ghi danh lại = chiếm tài khoản qua hộp thư) — ~~vì cần hai phiên
-- sống~~ [review H4-1] vì cần hai phiên sống của hai người CÓ `user.mfa_reset` (trigger
-- `mfa_reset_kiem_quyen` ở trên); một app_api bị chiếm có hai phiên quản lý sống vẫn làm được —
-- đó là phần chênh còn lại, ghi ở ADR-022 §3.
-- ---------------------------------------------------------------------------------------------
GRANT DELETE ON mfa_credentials TO app_api;

CREATE FUNCTION public.mfa_credentials_xoa_can_yeu_cau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND NOT EXISTS (
       SELECT 1 FROM public.mfa_reset_requests r
        WHERE r.org_id OPERATOR(pg_catalog.=) OLD.org_id
          AND r.user_id OPERATOR(pg_catalog.=) OLD.user_id
          AND r.status OPERATOR(pg_catalog.=) 'APPROVED'
          AND r.consumed_at IS NULL
          AND r.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()
     ) THEN
    RAISE EXCEPTION 'Xoa ho so TOTP can mot yeu cau dat lai DA DUYET, chua tieu thu, chua het han (040, review M-5)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$ham$;

CREATE TRIGGER mfa_credentials_xoa_can_yeu_cau
  BEFORE DELETE ON mfa_credentials
  FOR EACH ROW EXECUTE FUNCTION public.mfa_credentials_xoa_can_yeu_cau();
ALTER TABLE mfa_credentials ENABLE ALWAYS TRIGGER mfa_credentials_xoa_can_yeu_cau;
