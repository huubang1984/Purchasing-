-- db/migrations/001_roles_and_functions.sql
-- Nền tảng lược đồ cho app_api/app_unseal: quyền trên schema public, schema riêng cho hàm
-- không muốn cấp mặc định, hàm lấy tổ chức hiện tại.
--
-- Việc TẠO role app_api/app_unseal và CƯỠNG CHẾ thuộc tính của chúng (không SUPERUSER,
-- không BYPASSRLS, không kế thừa membership dư thừa, không rolconfig IN DATABASE trôi) đã
-- CHUYỂN sang db/migrations/hardening.always.sql — chạy lại ở MỌI lần migrate() được gọi,
-- không chỉ một lần ở đây, để tự sửa trôi cấu hình phát sinh SAU triển khai (xem [fix I3] ở
-- file đó để biết lý do đầy đủ). Bộ chạy migration luôn chạy file ".always.sql" TRƯỚC
-- migration đánh số này ở mọi lần gọi, kể cả lần đầu trên database trống, nên khi tới đây
-- hai role đã chắc chắn tồn tại và đã được hardening.
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

GRANT USAGE ON SCHEMA public TO app_api, app_unseal;

-- [fix S2] "ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC" mà CHƯA từng có GRANT mặc
-- định nào trước đó LÀ NO-OP — đã tự kiểm chứng bằng Postgres 16 thật: sau khi chạy REVOKE
-- đó, pg_default_acl vẫn có 0 dòng, và một hàm tạo sau đó vẫn có proacl = NULL (PUBLIC vẫn
-- có EXECUTE mặc định) — role chỉ có USAGE ON SCHEMA public vẫn gọi được hàm đó. Nguyên
-- nhân (xác nhận bởi review độc lập): ALTER DEFAULT PRIVILEGES lưu một DELTA được merge lên
-- acldefault() lúc tạo đối tượng — REVOKE FROM PUBLIC trên delta RỖNG không ghi gì cả.
--
-- Cách có tác dụng thật, đã tự kiểm chứng: REVOKE/GRANT trên TỪNG hàm ngay sau khi tạo (áp
-- dụng cho app_current_org_id() ngay dưới đây) — VÀ tách các hàm không muốn app_api/
-- app_unseal gọi trực tiếp vào schema app_private (không cấp USAGE) thay vì để chung public.
-- Hai lớp bổ sung cho nhau: lớp REVOKE/GRANT theo hàm bảo vệ ĐÚNG hàm đó dù đặt ở đâu; lớp
-- schema bảo vệ MẶC ĐỊNH cho bất kỳ hàm nào lỡ quên REVOKE/GRANT, miễn là nó không bị đặt
-- vào public. Giới hạn đã biết (đã tự kiểm chứng bằng thí nghiệm riêng, review độc lập xác
-- nhận thêm bằng 6 ca gồm cả hàm SQL và plpgsql bọc lồng nhau): cơ chế schema chặn được cả
-- lời gọi trực tiếp lẫn lời gọi gián tiếp qua một hàm khác cố tình bọc lại ("permission
-- denied during inlining") — app_api không tự dựng được đường lách, phải có role đặc quyền
-- CỐ Ý phơi hàm đó ra (vd. tạo một hàm SECURITY DEFINER trong public rồi gọi sang
-- app_private). Nó KHÔNG chặn được lời gọi gián tiếp qua RLS POLICY tạo sẵn bởi role có
-- USAGE (RLS chỉ kiểm EXECUTE tại thời điểm TẠO policy, không kiểm lại USAGE schema của role
-- đang truy vấn) — nhưng đó là hành động của người vận hành có quyền tạo policy, không phải
-- app_api tự làm được.
CREATE SCHEMA IF NOT EXISTS app_private;
-- Cố ý KHÔNG GRANT USAGE ON SCHEMA app_private TO app_api, app_unseal — đây chính là hàng
-- rào. Migration sau đặt bất kỳ hàm nào không muốn app_api/app_unseal gọi trực tiếp vào đây.
--
-- Không lặp lại "REVOKE USAGE ON SCHEMA app_private FROM ..." trong hardening.always.sql:
-- xem giải thích ở đầu file đó (schema này chưa tồn tại ở lần bootstrap đầu tiên, trước khi
-- migration này chạy).

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
