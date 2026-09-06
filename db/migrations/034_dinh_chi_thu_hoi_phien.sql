-- =============================================================================================
-- 034 — [sổ nợ 48 / review lượt 2 H2-12] ĐÌNH CHỈ MỘT NGƯỜI LÀ THU HỒI MỌI PHIÊN CỦA NGƯỜI ẤY
-- =============================================================================================
-- Trước file này, `users.status = 'SUSPENDED'` chỉ có hiệu lực ở những chỗ ĐỌC nó: `hasPermission`
-- (005), `assertFreshMfa` (006), `resolveSessionByToken` (đường HTTP, review L-1). Hàng `sessions`
-- của người bị đình chỉ VẪN SỐNG: `resolveSessionActor` (đường gói) và trigger 013 chỉ hỏi
-- `revoked_at`/`expires_at`, và một người bị đình chỉ rồi được kích hoạt lại thì mọi phiên cũ còn
-- TTL sống lại ngay — kể cả phiên đã bị coi là đáng ngờ lúc đình chỉ.
--
-- Lớp CSDL: trigger AFTER UPDATE OF status ON users — khi trạng thái đổi sang bất kỳ giá trị nào
-- KHÁC 'ACTIVE', thu hồi mọi phiên còn sống của người ấy TRONG CÙNG GIAO DỊCH. Kích hoạt lại KHÔNG
-- mở lại phiên nào: người ấy đăng nhập lại (magic link + TOTP), và đó là điều đúng.
--
-- Chạy dưới quyền của PHIÊN GHI (không SECURITY DEFINER — mục (C) hardening cấm): `app_api` có
-- `UPDATE (revoked_at)` trên `sessions` (006) và policy RLS gắn tổ chức, nên khi ứng dụng đình chỉ
-- một người của tổ chức đang gắn, câu UPDATE trong trigger thấy đúng các phiên của tổ chức ấy —
-- và chỉ chúng. Superuser (đường vận hành/test) thu hồi được như thường. Cùng bốn kỷ luật 005 §(4):
-- `SET search_path = pg_catalog`, tên bảng đủ `public.`, AFTER ROW, ENABLE ALWAYS.
--
-- Lớp ứng dụng đi kèm (cùng commit): `resolveSessionActor` nối `users.status = 'ACTIVE'` — cùng vế
-- chịu lực của `hasPermission`, để một phiên còn sống của người bị đình chỉ (ví dụ phiên chèn SAU
-- khi đình chỉ, hoặc trigger này bị gỡ) cũng không được nhận là một tác nhân.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.users_thu_hoi_phien_khi_dinh_chi() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $ham$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status OPERATOR(pg_catalog.<>) 'ACTIVE' THEN
    UPDATE public.sessions s
       SET revoked_at = pg_catalog.now()
     WHERE s.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND s.user_id OPERATOR(pg_catalog.=) NEW.id
       AND s.revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$ham$;

CREATE TRIGGER users_thu_hoi_phien_khi_dinh_chi
  AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION public.users_thu_hoi_phien_khi_dinh_chi();
ALTER TABLE users ENABLE ALWAYS TRIGGER users_thu_hoi_phien_khi_dinh_chi;
