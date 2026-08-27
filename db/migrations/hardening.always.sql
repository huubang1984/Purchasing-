-- db/migrations/hardening.always.sql
-- [fix I3] Cưỡng chế thuộc tính role app_api/app_unseal — chạy LẠI ở MỌI lần migrate() được
-- gọi, không qua schema_migrations, không chỉ một lần lúc bootstrap trên 001.
--
-- Vì sao tách khỏi 001_roles_and_functions.sql: mọi bảo đảm ở đó (S1 — không SUPERUSER/
-- BYPASSRLS; I2/I5 — không kế thừa membership dư thừa, không rolconfig IN DATABASE trôi)
-- trước đây chỉ đúng TẠI THỜI ĐIỂM 001 chạy lần đầu trên một database. Không gì phát hiện
-- hay tự sửa nếu SAU triển khai có ai đó "ALTER ROLE app_api BYPASSRLS" để gỡ lỗi rồi quên
-- gỡ lại — 001 đã ghi trong schema_migrations nên không chạy lại, và trôi cứ thế tồn tại
-- vĩnh viễn cho tới lần soát xét thủ công kế tiếp. Đúng kịch bản mà chính S1 sinh ra để
-- chống, chỉ khác thời điểm xảy ra (sau triển khai, không phải lúc bootstrap).
--
-- File này đóng đường trôi đó: mọi câu lệnh dưới đây là idempotent (an toàn lặp lại vô hạn
-- lần), và bộ chạy migration (packages/db/src/migrate.ts) luôn chạy file có hậu tố
-- ".always.sql" TRƯỚC vòng lặp các migration đánh số, ở MỌI lần gọi — nên tự sửa lại trôi
-- trên chính đường triển khai, không cần thao tác thủ công hay viết migration mới.
--
-- Cố ý KHÔNG phụ thuộc bất kỳ đối tượng nào do 001 tạo (schema app_private, hàm
-- app_current_org_id) — chỉ đụng tới pg_roles/pg_auth_members/pg_db_role_setting, vốn luôn
-- tồn tại độc lập với lịch sử migration. Nhờ vậy file này chạy AN TOÀN kể cả ở lần gọi
-- migrate() đầu tiên trên một database HOÀN TOÀN trống, trước khi 001 kịp chạy lần nào.
--
-- Quyết định có chủ đích: KHÔNG đưa "REVOKE USAGE ON SCHEMA app_private FROM ..." hay
-- REVOKE/GRANT EXECUTE của app_current_org_id() vào đây, dù chúng cũng có thể "trôi" theo
-- lý thuyết (ai đó GRANT USAGE ON SCHEMA app_private cho app_api sau triển khai). Lý do:
-- (1) hai đối tượng đó không tồn tại cho tới khi 001 chạy lần đầu — đưa vào đây sẽ cần thêm
-- điều kiện IF EXISTS phức tạp để không vỡ ở lần bootstrap đầu tiên (khi hardening.always.sql
-- này chạy TRƯỚC 001); (2) rủi ro trôi ở đó là một hành động TƯỜNG MINH, dễ lộ khi review
-- (GRANT USAGE ON SCHEMA rõ ràng trong lịch sử SQL) — khác hẳn BYPASSRLS/SUPERUSER vốn có
-- tiền lệ thật trong chính dự án này là bị bật ngầm để gỡ lỗi rồi quên tắt. Chấp nhận đánh
-- đổi này; ghi rõ ở đây để không ai "sửa" nhầm thành thiếu sót.

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

-- Role trong PostgreSQL là cluster-wide, không phải per-database — luôn áp lại tường minh,
-- không dựa vào mặc định ngầm của CREATE ROLE hay trạng thái có sẵn.
ALTER ROLE app_api
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOLOGIN INHERIT;
ALTER ROLE app_unseal
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOLOGIN INHERIT;
-- Xoá mọi rolconfig kế thừa TOÀN CỤM (vd. search_path bị đặt sẵn cho mục đích khác). CHƯA
-- đủ — xem khối RESET ALL "IN DATABASE" bên dưới.
ALTER ROLE app_api RESET ALL;
ALTER ROLE app_unseal RESET ALL;

-- [fix I5] "ALTER ROLE ... RESET ALL" ở trên chỉ xoá rolconfig áp dụng CHO MỌI DATABASE
-- (lưu ở pg_roles.rolconfig). Nó KHÔNG đụng tới cấu hình đặt riêng cho một database cụ thể
-- qua "ALTER ROLE ... IN DATABASE d SET ..." (lưu ở pg_db_role_setting, một bảng khác hẳn) —
-- đã tự kiểm chứng bằng Postgres 16 thật: dựng sẵn
-- "ALTER ROLE app_api IN DATABASE d SET row_security = off", chạy xong RESET ALL ở trên,
-- setting đó VẪN CÒN NGUYÊN (pg_roles.rolconfig là NULL nhưng pg_db_role_setting.setconfig
-- vẫn là {row_security=off}). row_security=off TẮT HẲN RLS cho phiên đó. Dùng EXECUTE/format
-- vì "IN DATABASE" không nhận tên database qua tham số $1, và current_database() không dùng
-- trực tiếp được làm định danh trong câu lệnh ALTER ROLE tĩnh.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_api', current_database());
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', 'app_unseal', current_database());
END
$$;

-- [fix I2] Gỡ tư cách thành viên CẢ HAI CHIỀU:
--   (a) app_api/app_unseal là THÀNH VIÊN của một nhóm khác — kế thừa quyền của nhóm đó
--       (lỗ I5 gốc: "GRANT legacy_group TO app_api" rồi legacy_group có SELECT trên bảng
--       nhạy cảm nào đó).
--   (b) một role KHÁC được cấp membership VÀO app_api/app_unseal — kế thừa quyền của
--       app_api/app_unseal ("GRANT app_api TO ke_tan_cong"). Bản vá vòng trước chỉ xử lý
--       chiều (a); test khẳng định "pg_auth_members = 0 hàng cho cả hai chiều" nhưng fixture
--       chỉ dựng chiều (a), nên chiều (b) sống sót mà không ai phát hiện.
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
       OR nhom.rolname IN ('app_api', 'app_unseal')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', hang.ten_nhom, hang.ten_thanh_vien);
  END LOOP;
END
$$;
