-- =============================================================================================
-- 039 — [sổ nợ 43 / review M-4] PHIÊN ĐÃ-MFA CHỈ RA ĐỜI SAU MỘT LẦN TOTP ĐÚNG GẦN ĐÂY — VẾ CSDL
-- =============================================================================================
-- 029 ép hàng `sessions` do đường ứng dụng tạo phải mang `mfa_verified_at`. Nó KHÔNG hỏi "mốc ấy
-- có thật không": một `app_api` bị chiếm INSERT `mfa_verified_at = now()` là có một phiên đã-MFA mà
-- không ai gõ mã nào. Tầng ứng dụng đóng bằng KIỂU (`MfaProof`, chỉ `verifyTotpForLogin` tạo được),
-- và kiểu thì không chạy ở CSDL — đó là khoản nợ 43.
--
-- [review H4-6] Cái trigger này MUA và cái nó KHÔNG mua, nói thẳng: nó chặn MỘT câu INSERT trần.
-- `app_api` có `UPDATE (last_used_counter)` (006 — `verifyTotpAttempt` cần), nên một app_api bị
-- chiếm đi HAI câu (UPDATE bộ đếm về bước hiện tại rồi INSERT) vẫn qua — cùng hạn chế mà 006 §(2)
-- đã ghi cho E3. Vế còn lại ở tầng kiểu. Và bộ đếm có CẬN TRÊN (+3 bước): một bộ đếm ở tương lai
-- xa không được thoả mãn trigger vĩnh viễn — đúng bài học `assertFreshMfa` (mfa.ts) đã viết ra.
--
-- Bằng chứng ở CSDL là `mfa_credentials.last_used_counter`: `verifyTotpAttempt` ghi bộ đếm TOTP
-- vừa khớp vào đó, trong CÙNG giao dịch mà `startUserSession` chèn phiên. Nên trigger này đòi: hồ
-- sơ TOTP của đúng (org, user) đã xác nhận VÀ bộ đếm ấy nằm trong ba bước gần nhất (bước 30 giây —
-- hằng số `STEP_SECONDS` của `packages/identity/src/totp.ts`; CSDL nay BIẾT con số ấy, và đó là một
-- ràng buộc phải giữ đồng bộ, ghi ra). Ba bước (90 giây) bao được cửa sổ ±1 mà `verifyTotpAttempt`
-- chấp nhận, cộng lệch đồng hồ giữa tiến trình và CSDL.
--
-- AFTER INSERT, không BEFORE: khoá ngoại tổ hợp `(org_id, user_id) → users` được kiểm bằng trigger
-- RI của Postgres (AFTER, tên `RI_…` xếp trước tên này), nên một hàng lệch tổ chức vẫn nhận đúng lỗi
-- khoá ngoại mà phép đo [INV-F1] của 006 đang đọc — trigger này chỉ nói khi hàng đã hợp lệ về mặt
-- tham chiếu. Điều kiện theo đường ứng dụng (`la_duong_ung_dung`, 037): superuser và các phép đo
-- lược đồ vẫn chèn được phiên đã-MFA không cần hồ sơ TOTP; các phép đo 006 chạy dưới `app_api` nay
-- gieo một hồ sơ TOTP tươi trước — chúng vẫn đo `app_api`, không chuyển sang superuser.
-- =============================================================================================

CREATE FUNCTION public.sessions_kiem_totp_gan_day() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
DECLARE
  -- `extract(epoch FROM …)` là cú pháp riêng của SQL, không viết được với tiền tố schema; hàm thật
  -- đứng sau nó là `date_part`, và hàm ấy ghim được `pg_catalog.` (quy ước QT3).
  buoc_hien_tai bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) OPERATOR(pg_catalog./) 30)::pg_catalog.int8;
BEGIN
  IF public.la_duong_ung_dung('app_api'::pg_catalog.name)
     AND NEW.mfa_verified_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.mfa_credentials m
        WHERE m.org_id OPERATOR(pg_catalog.=) NEW.org_id
          AND m.user_id OPERATOR(pg_catalog.=) NEW.user_id
          AND m.kind OPERATOR(pg_catalog.=) 'TOTP'
          AND m.confirmed_at IS NOT NULL
          AND m.last_used_counter IS NOT NULL
          AND m.last_used_counter OPERATOR(pg_catalog.>=) (buoc_hien_tai OPERATOR(pg_catalog.-) 3)
          AND m.last_used_counter OPERATOR(pg_catalog.<=) (buoc_hien_tai OPERATOR(pg_catalog.+) 3)
     ) THEN
    RAISE EXCEPTION 'Phien da-MFA phai di sau mot lan TOTP dung GAN DAY cua chinh nguoi ay (039, review M-4/H4-6): khong co ho so TOTP da xac nhan voi bo dem trong +-3 buoc quanh hien tai'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$ham$;

CREATE TRIGGER sessions_kiem_totp_gan_day
  AFTER INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_totp_gan_day();
ALTER TABLE sessions ENABLE ALWAYS TRIGGER sessions_kiem_totp_gan_day;
