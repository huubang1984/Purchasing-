-- db/migrations/001_roles_and_functions.sql
-- Nền tảng: extension, hai DB role tách biệt, hàm lấy tổ chức hiện tại.
--
-- app_api    : phục vụ web. KHÔNG bao giờ được đọc khóa riêng của RFQ.
-- app_unseal : runtime mở thầu có kiểm soát. KHÔNG được ghi vào bảng báo giá.
-- Không role nào bao trùm role kia (ADR-006).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal') THEN
    CREATE ROLE app_unseal NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_api, app_unseal;

-- Không cấp quyền mặc định rộng. Mỗi migration tạo bảng tự khai quyền của bảng đó,
-- để quyền luôn đọc được ngay cạnh lược đồ khi kiểm toán.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_api, app_unseal;

-- Lấy tổ chức hiện tại từ biến phiên do withTenant() gắn.
-- Trả NULL khi chưa gắn: mọi policy RLS so sánh với NULL sẽ không khớp hàng nào.
-- Đây là hành vi fail-closed có chủ đích — quên gắn tenant thì không thấy dữ liệu,
-- chứ không phải thấy tất cả.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;
