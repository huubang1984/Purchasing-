-- db/migrations/001_roles_and_functions.sql
-- Nền tảng: hai DB role tách biệt, hàm lấy tổ chức hiện tại.
--
-- app_api    : phục vụ web. KHÔNG bao giờ được đọc khóa riêng của RFQ.
-- app_unseal : runtime mở thầu có kiểm soát. KHÔNG được ghi vào bảng báo giá.
-- Không role nào bao trùm role kia (ADR-006).
--
-- Không tạo extension pgcrypto: không có hàm nào trong kế hoạch cần tới nó (sha256/
-- gen_random_uuid là built-in từ PG11/PG13; HMAC của TOTP chạy trong Node). Tạo nó sẽ đặt
-- pgp_sym_decrypt và các hàm giải mã khác vào schema public với EXECUTE cấp sẵn cho PUBLIC
-- — trang bị nguyên bộ công cụ mật mã cho đúng role (app_api) mà lời hứa sản phẩm là
-- "không có khả năng giải mã". Nếu task sau thật sự cần, thêm lại kèm lý do cụ thể và cấp
-- EXECUTE từng hàm cho đúng role, không cấp tràn qua PUBLIC.

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

-- Role trong PostgreSQL là cluster-wide, không phải per-database. Nhánh IF NOT EXISTS ở
-- trên chỉ đúng "tình cờ" trên một CSDL trống — nếu app_api đã tồn tại từ trước trên cluster
-- (dùng chung với dự án khác, ops tạo tay, hoặc một lần ALTER ROLE ... BYPASSRLS để gỡ lỗi
-- rồi quên gỡ lại) thì khối DO bỏ qua hoàn toàn và role đó giữ nguyên mọi thuộc tính cũ —
-- kể cả BYPASSRLS, thứ vô hiệu hoá toàn bộ RLS của Task 4-10 cho role đó. Luôn áp lại
-- tường minh, không dựa vào mặc định ngầm của CREATE ROLE hay trạng thái có sẵn.
ALTER ROLE app_api
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOLOGIN INHERIT;
ALTER ROLE app_unseal
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOLOGIN INHERIT;
-- Xoá mọi rolconfig kế thừa từ trạng thái cũ (vd. search_path bị đặt sẵn cho mục đích khác).
ALTER ROLE app_api RESET ALL;
ALTER ROLE app_unseal RESET ALL;

GRANT USAGE ON SCHEMA public TO app_api, app_unseal;

-- ALTER DEFAULT PRIVILEGES chỉ áp cho đối tượng do đúng role đang chạy migration này tạo ra
-- SAU lệnh này (không kèm FOR ROLE) — nếu migration sau chạy bằng role khác, phải lặp lại
-- các dòng này cho role đó.
--
-- Không cần REVOKE mặc định trên TABLE: PostgreSQL không tự cấp quyền bảng nào cho role
-- khác chủ sở hữu, nên không có gì để thu hồi ở đó. Nhưng PostgreSQL MẶC ĐỊNH cấp EXECUTE
-- trên mọi hàm mới và USAGE trên mọi kiểu mới cho PUBLIC — đây là lỗ thật: app_api đã có
-- USAGE ON SCHEMA public ở trên, nên sẽ gọi được ngay bất kỳ hàm SECURITY DEFINER nào
-- migration sau tạo trong schema public, xuyên thủng ranh giới ADR-006 mà không dòng GRANT
-- nào cho ai thấy. Chặn mặc định đó ở đây, cho cả hàm đã có (built-in không bị ảnh hưởng,
-- chúng thuộc schema pg_catalog) lẫn hàm sẽ tạo sau này.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE ON TYPES FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Lấy tổ chức hiện tại từ biến phiên do withTenant() gắn.
-- Trả NULL khi chưa gắn: mọi policy RLS so sánh với NULL sẽ không khớp hàng nào.
-- Đây là hành vi fail-closed có chủ đích — quên gắn tenant thì không thấy dữ liệu,
-- chứ không phải thấy tất cả.
--
-- Cố ý KHÔNG SECURITY DEFINER (không cần thiết, mở thêm rủi ro leo thang quyền) và KHÔNG
-- dùng mệnh đề "SET search_path = ..." (mệnh đề SET chặn inlining của hàm SQL — hàm này sẽ
-- nằm trong vị từ USING của mọi policy RLS trên mọi bảng, mất inlining là mất chỉ mục và
-- giáng hiệu năng nghiêm trọng). Thay vào đó schema-qualify CURRENT_SETTING (một hàm thật
-- trong pg_catalog, có thể bị che khuất nếu search_path đặt public trước pg_catalog và tồn
-- tại public.current_setting cùng chữ ký) để không phụ thuộc search_path của phiên gọi mà
-- vẫn giữ được inlining.
--
-- NULLIF cố ý KHÔNG schema-qualify: đây không phải một hàm trong pg_proc mà là cú pháp đặc
-- biệt được trình phân tích cú pháp của Postgres dịch trực tiếp thành CASE WHEN — giống
-- COALESCE, GREATEST/LEAST. Nó không tra cứu qua search_path nên không thể bị che khuất,
-- và viết "pg_catalog.nullif(...)" sẽ ném lỗi "function does not exist" vì không có entry
-- pg_proc nào như vậy (đã kiểm chứng thật khi chạy migration).
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid
$$;

-- Vừa thu hồi EXECUTE mặc định từ PUBLIC ở trên, nên phải cấp lại tường minh cho đúng hai
-- role cần gọi hàm này (các policy RLS ở migration sau chạy dưới quyền app_api/app_unseal).
GRANT EXECUTE ON FUNCTION app_current_org_id() TO app_api, app_unseal;
