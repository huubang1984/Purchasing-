-- =============================================================================================
-- 032 — [S1.10.7 / review lượt 2, H2-1] HỒ SƠ TOTP ĐÃ XÁC NHẬN THÌ BÍ MẬT KHÔNG THAY ĐƯỢC — Ở CSDL
-- =============================================================================================
-- 031 cấp cho `app_api` quyền `UPDATE (secret_wrapped, secret_key_version)` trên `mfa_credentials`
-- và nói vế "chỉ khi hồ sơ CHƯA xác nhận" do câu UPDATE ở `login.ts` giữ bằng `WHERE confirmed_at
-- IS NULL`. Lượt review thứ hai chỉ ra hai điều, cả hai đúng:
--
--   ⑴ GRANT không biết trạng thái, nên một `app_api` bị chiếm (kẻ tấn công A1 của 006) thay được
--      bí mật của một hồ sơ ĐÃ xác nhận bằng MỘT câu UPDATE — đúng lớp mà 006 từng nói thẳng là
--      còn giữ được (*"bí mật của một người đã đăng ký không thay được"*), và 031 đã bỏ đi mà
--      không đặt gì thay vào. Tệ hơn: 006 đã cấp `UPDATE (confirmed_at)`, và không đâu cấm đưa
--      `confirmed_at` từ NOT NULL về NULL — nên kể cả vế WHERE có xuống CSDL, một CẶP UPDATE
--      vẫn vượt được.
--   ⑵ "Đột biến ở tầng SQL" trong `auth.int.test.ts` xanh vì lý do sai: câu UPDATE của test tự
--      mang `AND confirmed_at IS NULL`, nên `rowCount = 0` chỉ chứng minh hàng đã xác nhận, KHÔNG
--      chứng minh CSDL từ chối. Bỏ vế WHERE ấy khỏi câu test thì `rowCount = 1`.
--
-- File này đặt lớp CSDL: một trigger BEFORE UPDATE — khi `OLD.confirmed_at IS NOT NULL` thì
-- `secret_wrapped`, `secret_key_version` và `confirmed_at` đều phải GIỮ NGUYÊN. Đường hợp lệ
-- của ứng dụng không chạm nó: `verifyTotpAttempt` ghi `confirmed_at = COALESCE(confirmed_at, now())`
-- (không đổi khi đã có), và `enrollOrReplaceTotpForLogin` chỉ UPDATE hàng chưa xác nhận.
--
-- Điều kiện theo vai `app_api`, cùng lý do và cùng khuôn với 029: bộ test lược đồ và đường vận
-- hành chạy dưới superuser đặt lại trạng thái hồ sơ để đo E3 — trigger không phân biệt vai làm
-- những phép đo ấy rỗng ruột. Mối đe doạ được đặt tên là `app_api`, và trigger nói đúng tên ấy.
-- Cùng giới hạn L-4 của 029: một vai ứng dụng THỨ HAI đi qua im lặng — đổi sang danh sách vai
-- là quyết định vận hành, ghi ở STATE.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF current_user OPERATOR(pg_catalog.=) 'app_api'::pg_catalog.name
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

CREATE TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan
  BEFORE UPDATE ON mfa_credentials
  FOR EACH ROW EXECUTE FUNCTION public.mfa_credentials_khoa_ho_so_da_xac_nhan();
ALTER TABLE mfa_credentials ENABLE ALWAYS TRIGGER mfa_credentials_khoa_ho_so_da_xac_nhan;
