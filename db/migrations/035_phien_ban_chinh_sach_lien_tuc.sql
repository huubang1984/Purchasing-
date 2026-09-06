-- =============================================================================================
-- 035 — [sổ nợ 45 / review lượt 2 H2-3] PHIÊN BẢN CHÍNH SÁCH PHẢI BẰNG ĐÚNG "LỚN NHẤT + 1"
-- =============================================================================================
-- 022 §(9) đặt trigger `chinh_sach_phien_ban_tang_dan` đòi `NEW.version > max(version)` và khai
-- rằng ca *"`version = 2147483647` ghim vĩnh viễn tổ chức"* đã đóng. Review lượt 2 của S1.10 đọc
-- ra: "tăng dần" chỉ chặn TỤT, không chặn GHIM Ở TRẦN — sau hàng 2147483647 không `NEW.version`
-- nào thoả `>` trong int4 nữa; cột không có UPDATE/DELETE cho `app_api`, nên tổ chức bị đóng băng
-- vào đúng chính sách ấy, khôi phục chỉ bằng superuser. Cái 022 đổi là "im lặng" thành "ồn ào";
-- cái nó không đổi là "vĩnh viễn". Tầng HTTP đã đòi `version` = hiện hành + 1 (S1.10.7, vế HTTP);
-- file này đưa đúng quy tắc ấy xuống CSDL — nơi một `app_api` bị chiếm cũng phải đi qua.
--
-- QUY TẮC: `NEW.version` phải BẰNG `COALESCE(max(version), 0) + 1`. `version` vẫn do người gọi
-- truyền (giá trị KỲ VỌNG — hai lượt song song thì đúng một lượt thắng, lượt kia 23514 thay vì
-- lặng lẽ chen vào), nhưng không còn chọn được. Không cần `CHECK (version < N)` phòng hờ nữa:
-- tới được 2147483647 phải đi qua hơn hai tỷ lần tạo chính sách.
--
-- Cùng tên hàm, cùng tên trigger (CREATE OR REPLACE): thân cũ của 022 là lịch sử, đọc ở đó.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.chinh_sach_phien_ban_tang_dan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  lon_nhat integer;
BEGIN
  SELECT max(p.version) INTO lon_nhat
    FROM public.org_procurement_policies p
   WHERE p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NEW.version IS DISTINCT FROM (COALESCE(lon_nhat, 0) OPERATOR(pg_catalog.+) 1) THEN
    RAISE EXCEPTION 'Phien ban chinh sach phai BANG phien ban lon nhat + 1 (%) — khong chon duoc, khong ghim duoc (035)',
      COALESCE(lon_nhat, 0) OPERATOR(pg_catalog.+) 1
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
