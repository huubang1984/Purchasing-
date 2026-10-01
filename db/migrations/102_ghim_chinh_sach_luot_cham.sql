-- ==============================================================================================
-- 102_ghim_chinh_sach_luot_cham — [S1.253 / S4.5a của spec S4] GÓI CHỤP PHIÊN BẢN CHÍNH SÁCH LÚC MỞ; LƯỢT CHẤM DÙNG ĐÚNG
-- PHIÊN BẢN ẤY (L14)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` §2.4 ⑸, §4.1, §5.1 L14, §8.11, §9 S4.5.
-- ADR-141. Chủ dự án chốt 2026-10-01: phiên bản áp cho gói X là phiên bản HIỆU LỰC lúc X mở — luật `chinh_sach_hieu_luc` của
-- S3.1 (`069`), không một hàm thứ hai; rồi, sau lượt soi đối kháng, phiên bản ấy được CHỤP vào gói ở cạnh vào OPEN thay vì tính
-- lại từ dấu thời gian về sau.
--
-- LỖ (góc C① của lượt soi S1.159, đo lại ở S4.5a): `taoLuotDanhGia` đọc `chinh_sach_hieu_luc(org, now())` — phiên bản hiệu
-- lực LÚC CHẤM. Lượt chấm chỉ chạy sau khi giá lộ, và `FINANCE` giữ cùng lúc `policy.manage`, `bid.view`,
-- `evaluation.perform`: thấy giá rồi khai một phiên bản mới là đổi được trọng số, tức đảo được hạng. CSDL không ràng gì
-- `rfq_evaluations.policy_id` (`057` chỉ có trigger danh tính, và `policy_id` nằm trong `GRANT INSERT`).
--
-- VÌ SAO CHỤP, KHÔNG TÍNH LẠI `chinh_sach_hieu_luc(org, opened_at)` (lượt soi §S1.253, hai đường đo được dưới `app_api`):
--   ⑴ `created_at` của phiên bản là `now()` — lúc giao dịch tạo BẮT ĐẦU. Một phiên mở giao dịch trước lúc gói mở, ngồi chờ, rồi
--      sau khi giá lộ mới chèn phiên bản với trọng số tuỳ ý: hàng mang `created_at = effective_from < opened_at`, và phép tính
--      lại chọn nó.
--   ⑵ `opened_at` nằm trong `GRANT UPDATE` của `app_api` (`009`); trigger cạnh chỉ đòi đặt một lần. Mở gói với `opened_at` ở
--      năm 2100 thì phép tính lại thành *"phiên bản mới nhất lúc chấm"*.
-- Chụp lúc mở đóng cả hai: cột `chinh_sach_ghim_id` nằm NGOÀI mọi `GRANT` ghi, chỉ trigger ở cạnh `PENDING_APPROVAL->OPEN` đặt
-- nó, dưới CÙNG khoá tư vấn mà lần tạo phiên bản (`069`) và lần ký (`069`) giữ — một phiên bản đang ghi dở thì lần mở chờ nó
-- commit, rồi đọc bằng ảnh chụp mới; không giá trị nào người gọi gửi lên đi vào phép chọn.
--
-- TRIGGER TRÊN `rfq_evaluations` LÀ LỚP CSDL của lượt chấm. Tầng gói đọc ĐÚNG cột ấy, nên đường sản xuất không tới được nhánh từ
-- chối; nó chỉ tới được bằng một đường ghi thứ hai (nhập liệu hàng loạt, một route nhận `policyId`, một bộ đọc lệch) — cùng lý lẽ
-- J5 của `093`. Nhánh mang TÊN ràng buộc (khuôn `074`, ADR-108) để tầng gói ghi `CONTROL_DENIED` cho đúng lần ấy.
--
-- Cạnh vào OPEN chỉ đi một lần (`CANH_HOP_LE` không có cạnh về `PENDING_APPROVAL` từ OPEN), nên phiên bản ghim không đổi suốt đời
-- gói — lượt chấm lại sau BAFO dùng cùng phiên bản, và `bafo_kiem_vong` (`059`/`060`) đã buộc vòng BAFO theo chính sách của lượt
-- chấm. Gói mở khi tổ chức chưa có phiên bản nào hiệu lực thì cột là NULL và mọi `policy_id` bị từ chối.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: không đụng hàng `rfq_evaluations` đã ghi (trigger chỉ `BEFORE INSERT`) — lượt chấm cũ dưới phiên
-- bản lúc chấm ở lại làm sự thật kiểm toán, và hôm nay không tổ chức thật nào (PRODUCT §10). Không đổi `opened_at` hay quyền của
-- nó (khoản 319 — các chỗ khác đọc mốc ấy). Không đổi `rfq_che_do_nghiem`, `rfq_chot_ngan_sach` hay `quan_sat_gia`: chúng ghim
-- theo mốc của RIÊNG chúng (S3.1, S4.4a). Vế TCO và form nhà cung cấp của L14 chờ S4.7 — hôm nay không chỗ nào đọc chính sách.
-- ==============================================================================================

-- ============================================================================================
-- (1) CỘT PHIÊN BẢN GHIM — ngoài mọi GRANT ghi; `SELECT` của `app_api` trên `rfq_packages` là mức BẢNG (`009`)
-- ============================================================================================
ALTER TABLE rfq_packages ADD COLUMN chinh_sach_ghim_id uuid;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_packages_chinh_sach_ghim_fk
  FOREIGN KEY (org_id, chinh_sach_ghim_id) REFERENCES org_procurement_policies (org_id, id);

-- Gói đã mở trước migration này: điền bằng phép tính lại tại `opened_at` — đúng thứ lượt chấm của chúng sẽ đọc nếu không có cột.
-- Vai chạy migration có BYPASSRLS (ADR-061), nên câu dưới thấy mọi tổ chức; nó chỉ đổi cột mới, nên không trigger cạnh nào xét gì.
UPDATE rfq_packages
   SET chinh_sach_ghim_id = public.chinh_sach_hieu_luc(org_id, opened_at)
 WHERE opened_at IS NOT NULL;

-- ============================================================================================
-- (2) CHỤP Ở CẠNH VÀO OPEN
-- ============================================================================================
-- `WHEN` đúng cạnh (§2.5 ⒃ của spec S3): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây.
-- `clock_timestamp()`, không `NEW.opened_at`: giá trị ấy do người gọi gửi lên (⑵), và `now()` là lúc giao dịch mở BẮT ĐẦU — một
-- phiên bản commit trong lúc lần mở chờ khoá là phiên bản đã hiệu lực khi gói thực sự mở.
CREATE OR REPLACE FUNCTION public.rfq_ghim_chinh_sach_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  NEW.chinh_sach_ghim_id := public.chinh_sach_hieu_luc(NEW.org_id, pg_catalog.clock_timestamp());
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_ghim_chinh_sach_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_ghim_chinh_sach_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_ghim_chinh_sach_khi_mo;

-- ============================================================================================
-- (3) LƯỢT CHẤM MANG ĐÚNG PHIÊN BẢN GHIM
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_evaluations_kiem_phien_ban_ghim() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_ghim uuid;
BEGIN
  SELECT p.chinh_sach_ghim_id INTO v_ghim
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id;
  IF v_ghim IS NULL OR NEW.policy_id IS DISTINCT FROM v_ghim THEN
    RAISE EXCEPTION 'Luot cham phai dung phien ban chinh sach goi thau da ghim luc mo (L14)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'l14_phien_ban_khong_ghim';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_evaluations_kiem_phien_ban_ghim
  BEFORE INSERT ON rfq_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_evaluations_kiem_phien_ban_ghim();
ALTER TABLE rfq_evaluations ENABLE ALWAYS TRIGGER rfq_evaluations_kiem_phien_ban_ghim;
