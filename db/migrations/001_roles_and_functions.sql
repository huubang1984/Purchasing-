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
-- Xoá mọi rolconfig kế thừa TOÀN CỤM từ trạng thái cũ (vd. search_path bị đặt sẵn cho mục
-- đích khác). CHƯA đủ — xem khối RESET ALL "IN DATABASE" bên dưới.
ALTER ROLE app_api RESET ALL;
ALTER ROLE app_unseal RESET ALL;

-- [fix I5] "ALTER ROLE ... RESET ALL" ở trên chỉ xoá rolconfig áp dụng CHO MỌI DATABASE
-- (lưu ở pg_roles.rolconfig). Nó KHÔNG đụng tới cấu hình đặt riêng cho một database cụ thể
-- qua "ALTER ROLE ... IN DATABASE d SET ..." (lưu ở pg_db_role_setting, một bảng khác hẳn) —
-- đã tự kiểm chứng bằng Postgres 16 thật: dựng sẵn
-- "ALTER ROLE app_api IN DATABASE d SET row_security = off" trước migration, chạy xong
-- "RESET ALL" ở trên, setting đó VẪN CÒN NGUYÊN (pg_roles.rolconfig là NULL nhưng
-- pg_db_role_setting.setconfig vẫn là {row_security=off}). row_security=off là thứ TẮT HẲN
-- RLS cho phiên đó — không phải chuyện nhỏ. Dùng EXECUTE/format vì "IN DATABASE" không nhận
-- tên database qua tham số $1, và current_database() không dùng trực tiếp được làm định danh
-- trong câu lệnh ALTER ROLE tĩnh.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_api', current_database());
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_unseal', current_database());
END
$$;

-- [fix I5] Role có thể là THÀNH VIÊN của một role/nhóm khác (GRANT nhom TO app_api) từ
-- trước khi migration này chạy — role kế thừa mọi quyền của nhóm đó, kể cả SELECT trên
-- bảng nhạy cảm không liên quan gì tới app_api/app_unseal. Đã tự kiểm chứng bằng Postgres 16
-- thật: "GRANT legacy_group TO app_api" rồi "GRANT SELECT ON bi_mat TO legacy_group" cho
-- phép app_api đọc được bi_mat dù không có GRANT trực tiếp nào tới app_api — và test chỉ
-- kiểm tra pg_auth_members trên DATABASE TRỐNG (không dựng sẵn membership) không bắt được
-- lỗ này. Gỡ mọi tư cách thành viên hiện có của hai role trước khi migration khác kịp cấp
-- thêm quyền nào lên trên nền đó.
DO $$
DECLARE
  hang RECORD;
BEGIN
  FOR hang IN
    SELECT nhom.rolname AS ten_nhom, thanh_vien.rolname AS ten_thanh_vien
    FROM pg_auth_members am
    JOIN pg_roles nhom ON nhom.oid = am.roleid
    JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member
    WHERE thanh_vien.rolname IN ('app_api', 'app_unseal')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', hang.ten_nhom, hang.ten_thanh_vien);
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO app_api, app_unseal;

-- [fix S2 — sửa lại từ bản trước] "ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC" mà
-- CHƯA từng có GRANT mặc định nào trước đó LÀ NO-OP — đã tự kiểm chứng bằng Postgres 16
-- thật: sau khi chạy hai câu REVOKE này, pg_default_acl vẫn có 0 dòng, và một hàm tạo sau đó
-- vẫn có proacl = NULL (PUBLIC vẫn có EXECUTE mặc định) — role chỉ có USAGE ON SCHEMA public,
-- không có GRANT nào khác, vẫn gọi được hàm đó. Bản vá vòng trước của chính migration này
-- mắc đúng lỗi này (coi hai dòng dưới là đã sửa xong S2 — SAI).
--
-- Nguyên nhân: EXECUTE mặc định cho PUBLIC trên hàm mới là hành vi CỨNG của Postgres, không
-- lưu thành ACL nào cho tới khi có REVOKE/GRANT tường minh trên ĐÚNG ĐỐI TƯỢNG đó — không
-- thể ghi đè qua "default privileges" khi chưa có gì để ghi đè lên.
--
-- Cách có tác dụng thật, đã tự kiểm chứng: REVOKE/GRANT trên TỪNG hàm ngay sau khi tạo (áp
-- dụng cho app_current_org_id() ngay dưới đây) — VÀ tách các hàm không muốn app_api/
-- app_unseal gọi trực tiếp vào schema app_private (không cấp USAGE) thay vì để chung
-- public. Hai lớp bổ sung cho nhau: lớp REVOKE/GRANT theo hàm bảo vệ ĐÚNG hàm đó dù đặt ở
-- đâu; lớp schema bảo vệ MẶC ĐỊNH cho bất kỳ hàm nào lỡ quên REVOKE/GRANT, miễn là nó không
-- bị đặt vào public. Đã tự kiểm chứng: hàm trong app_private có proacl = NULL (PUBLIC vẫn
-- "có" EXECUTE theo lý thuyết) nhưng app_api vẫn nhận "permission denied for schema
-- app_private" vì thiếu USAGE trên schema — chặn được ở bước phân giải tên trước khi chạm
-- tới EXECUTE. Giới hạn đã biết: cơ chế schema KHÔNG chặn được lời gọi GIÁN TIẾP qua RLS
-- policy do người có USAGE tạo sẵn (RLS chỉ kiểm EXECUTE tại thời điểm TẠO policy, không
-- kiểm lại USAGE schema của role đang truy vấn — đã tự kiểm chứng bằng thí nghiệm riêng);
-- nó chỉ chặn lời gọi TRỰC TIẾP của app_api/app_unseal, đúng bề mặt tấn công thật (app_api
-- không tự ý SELECT một hàm bất kỳ nó không được cấp).
CREATE SCHEMA app_private;
-- Cố ý KHÔNG GRANT USAGE ON SCHEMA app_private TO app_api, app_unseal — đây chính là hàng
-- rào. Migration sau đặt bất kỳ hàm nào không muốn app_api/app_unseal gọi trực tiếp vào đây.

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
--
-- Ở lại schema public (không chuyển vào app_private): mọi migration sau (đã viết sẵn trong
-- kế hoạch) gọi hàm này KHÔNG qualify trong USING/WITH CHECK của RLS policy — chuyển schema
-- sẽ đòi hỏi đổi search_path hệ thống, ảnh hưởng diện rộng ngoài phạm vi task này. Vì vậy
-- dùng đúng lớp REVOKE/GRANT theo hàm (không phải lớp schema) để khoá hàm này.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid
$$;

-- PUBLIC mặc định có EXECUTE trên hàm vừa tạo (hành vi cứng của Postgres, không phải do
-- migration này cấp) — thu hồi tường minh rồi cấp lại đúng hai role cần dùng nó cho RLS.
REVOKE EXECUTE ON FUNCTION app_current_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_org_id() TO app_api, app_unseal;
