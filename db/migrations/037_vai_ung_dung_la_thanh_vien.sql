-- =============================================================================================
-- 037 — [S1.11 / sổ nợ 50] "ĐƯỜNG ỨNG DỤNG" LÀ MỌI THÀNH VIÊN KẾ THỪA CỦA app_api, KHÔNG CHỈ
--        CÁI TÊN app_api
-- =============================================================================================
-- Hai trigger của lớp đăng nhập điều kiện theo `current_user = 'app_api'`:
--   029 `sessions_kiem_mfa_khi_tao`          — app_api không tạo được phiên thiếu MFA;
--   032 `mfa_credentials_khoa_ho_so_da_xac_nhan` — app_api không thay được bí mật TOTP đã xác nhận.
-- Cả hai được viết và đo dưới `poolAs("app_api")` của test-support, nơi MỖI kết nối đều
-- `SET ROLE app_api` trước khi được giao ra. Đó là đường TEST. Đường SẢN XUẤT thì khác, và
-- chính hardening.always.sql ghi cách nó phải khác: `app_api` là NOLOGIN, nên tiến trình đăng
-- nhập bằng một role thành viên (`app_api_login`, danh sách trắng CAP_HOP_LE) — và hardening
-- CƯỠNG CHẾ role ấy là INHERIT. Tức `app_api_login` có TOÀN BỘ quyền của `app_api` ngay khi
-- kết nối, không cần `SET ROLE`, và `current_user` của nó là `app_api_login`.
--
-- Hệ quả đo được (packages/db/src/vai-tro.int.test.ts, ca [037]): trước file này, một kết nối
-- `app_api_login` KHÔNG `SET ROLE` chèn được `sessions` thiếu `mfa_verified_at`, và thay được bí
-- mật TOTP của hồ sơ đã xác nhận — hai lớp im lặng đúng ở đường mà tiến trình thật sẽ đi, trong
-- khi mọi phép đo vẫn xanh vì chúng chạy dưới `SET ROLE`. Không ai viết sai; hai vế của cùng một
-- kiến trúc (role đăng nhập kế thừa + trigger đọc tên) chỉ chưa từng gặp nhau, vì chưa có
-- composition root nào nối chúng lại. S1.11 nối, và câu hỏi lộ ra.
--
-- LỚP ĐÓNG: một vị từ có tên — `la_duong_ung_dung('app_api')` — đúng khi người gọi HIỆN CÓ quyền
-- của `app_api` (`pg_has_role(..., 'USAGE')`: đúng cho chính app_api sau SET ROLE, và cho mọi
-- thành viên INHERIT như app_api_login) VÀ KHÔNG PHẢI superuser. Vế thứ hai là load-bearing:
-- `pg_has_role` trả TRUE cho superuser với mọi role, nên thiếu nó thì đường test/vận hành dưới
-- superuser (lý do 029 và 032 điều kiện theo vai ngay từ đầu) bị chặn theo. Hai thân trigger
-- được thay tại chỗ (CREATE OR REPLACE, cùng tên — thân cũ là lịch sử, đọc ở 029/032) để dùng vị
-- từ ấy; không sửa hai file cũ.
--
-- Lớp thứ hai, ở ỨNG DỤNG: `createPool(..., { role: "app_api" })` (packages/db) `SET ROLE` và
-- kiểm `current_user` ở MỖI lần lấy client — cùng cơ chế poolAs của test-support, nay một bản
-- dùng chung. Composition root của apps/api dùng nó, nên tiến trình thật chạy ĐÚNG danh tính
-- mà mọi phép đo đã chạy. File này vẫn cần: lớp CSDL không được phụ thuộc vào việc ứng dụng
-- nhớ làm một việc.
--
-- GIỚI HẠN, viết ra: vị từ chỉ biết `app_api`. Một vai ứng dụng THỨ HAI (cùng giới hạn L-4 của
-- 029) vẫn đi qua im lặng; muốn canh nó thì gọi vị từ với tên ấy — quyết định vận hành, ghi ở
-- STATE. Và "không phải superuser" là phép kiểm theo THUỘC TÍNH, không theo tên: một role
-- CREATEROLE hay BYPASSRLS mà không SUPERUSER vẫn bị vị từ coi là đường ứng dụng nếu nó kế thừa
-- app_api — đúng chiều fail-closed.
-- =============================================================================================

CREATE FUNCTION public.la_duong_ung_dung(ten_vai pg_catalog.name) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
AS $ham$
  SELECT pg_catalog.pg_has_role(current_user, ten_vai, 'USAGE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles r
        WHERE r.rolname OPERATOR(pg_catalog.=) current_user AND r.rolsuper
     )
$ham$;

-- [review H3-4] Chỉ app_api: app_unseal không có INSERT `sessions` hay UPDATE `mfa_credentials`, nên
-- một GRANT cho nó không mua gì. Hệ quả của REVOKE khỏi PUBLIC, viết ra: trigger không SECURITY
-- DEFINER, nên một role THỨ BA được cấp INSERT `sessions` mai sau sẽ nhận 42501 "permission denied
-- for function" từ TRONG trigger thay vì `false` — fail-closed, và là dấu hiệu phải cấp EXECUTE có
-- chủ đích cho role ấy. Hardening canh thân + ACL của hàm này (khuôn R3).
REVOKE ALL ON FUNCTION public.la_duong_ung_dung(pg_catalog.name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.la_duong_ung_dung(pg_catalog.name) TO app_api;

-- (1) 029 — thân mới, cùng tên, cùng trigger; chỉ vị từ đổi.
CREATE OR REPLACE FUNCTION public.sessions_kiem_mfa_khi_tao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND NEW.mfa_verified_at IS NULL THEN
    RAISE EXCEPTION 'app_api khong duoc tao mot phien chua qua MFA (ADR-020 muc 2): mfa_verified_at phai duoc dat trong cung cau INSERT'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

-- (2) 032 — thân mới, cùng tên, cùng trigger; chỉ vị từ đổi.
CREATE OR REPLACE FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND OLD.confirmed_at IS NOT NULL
     AND (NEW.secret_wrapped IS DISTINCT FROM OLD.secret_wrapped
          OR NEW.secret_key_version IS DISTINCT FROM OLD.secret_key_version
          OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'Ho so TOTP da xac nhan: bi mat va confirmed_at khong thay duoc (032, review H2-1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
