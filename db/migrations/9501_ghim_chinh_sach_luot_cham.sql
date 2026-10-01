-- ==============================================================================================
-- 9501_ghim_chinh_sach_luot_cham — [S1.9101 / S4.5a của spec S4] LƯỢT CHẤM DÙNG PHIÊN BẢN CHÍNH SÁCH GHIM LÚC GÓI MỞ (L14)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` §2.4 ⑸, §4.1, §5.1 L14, §8.11, §9 S4.5.
-- ADR-9201. Chủ dự án chốt 2026-10-01: phiên bản áp cho gói X là `chinh_sach_hieu_luc(org, opened_at của X)` — hàm ghim
-- của S3.1 (`069`), không một hàm thứ hai; S4.5 chia ba PR, đây là PR đầu.
--
-- LỖ (góc C① của lượt soi S1.159, đo lại ở S4.5a): `taoLuotDanhGia` đọc `chinh_sach_hieu_luc(org, now())` — phiên bản hiệu
-- lực LÚC CHẤM. Lượt chấm chỉ chạy sau khi giá lộ, và `FINANCE` giữ cùng lúc `policy.manage`, `bid.view`,
-- `evaluation.perform`: thấy giá rồi khai một phiên bản mới là đổi được trọng số, tức đảo được hạng. CSDL không ràng gì
-- `rfq_evaluations.policy_id` (`057` chỉ có trigger danh tính, và `policy_id` nằm trong `GRANT INSERT`).
--
-- VÌ SAO `chinh_sach_hieu_luc(org, opened_at)` KHÔNG CHỌN ĐƯỢC PHIÊN BẢN TẠO SAU LÚC MỞ: `effective_from >= created_at`
-- (`hieu_luc_khong_lui`, `022`), và `created_at` nằm ngoài `GRANT INSERT` (`014`) — mặc định `now()` của giao dịch tạo. Một
-- phiên bản tạo sau lúc mở có `effective_from > opened_at`, nên hàm bỏ qua nó. Vế chữ ký của S3.1 (`signed_at <= p_luc`)
-- giữ nguyên: ở tổ chức đã bật, phiên bản ký SAU lúc mở cũng không áp cho gói.
--
-- TRIGGER NÀY LÀ LỚP CSDL. Tầng gói đọc ĐÚNG hàm ấy tại ĐÚNG mốc ấy, nên đường sản xuất không tới được nhánh từ chối; nó chỉ
-- tới được bằng một đường ghi thứ hai (nhập liệu hàng loạt, một route nhận `policyId`, một bộ đọc lệch) — cùng lý lẽ J5 của
-- `093`. Nhánh mang TÊN ràng buộc (khuôn `074`, ADR-108) để tầng gói ghi `CONTROL_DENIED` cho đúng lần ấy.
--
-- `opened_at` chỉ đặt một lần (`011`), nên phiên bản ghim của một gói không đổi suốt đời gói — lượt chấm lại sau BAFO dùng cùng
-- phiên bản, và `bafo_kiem_vong` (`059`/`060`) đã buộc vòng BAFO theo chính sách của lượt chấm. Gói chưa mở (`opened_at` NULL)
-- hay mở trước khi tổ chức có phiên bản nào hiệu lực thì không có phiên bản ghim: mọi `policy_id` bị từ chối.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: không đụng hàng `rfq_evaluations` đã ghi (trigger chỉ `BEFORE INSERT`) — lượt chấm cũ dưới phiên
-- bản lúc chấm ở lại làm sự thật kiểm toán, và hôm nay không tổ chức thật nào (PRODUCT §10). Không đổi `rfq_che_do_nghiem`,
-- `rfq_chot_ngan_sach` hay `quan_sat_gia`: chúng ghim theo mốc của RIÊNG chúng (S3.1, S4.4a). Vế TCO và form nhà cung cấp của L14
-- chờ S4.7 — hôm nay không chỗ nào trong hai thứ ấy đọc chính sách.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.rfq_evaluations_kiem_phien_ban_ghim() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_mo timestamptz;
BEGIN
  SELECT p.opened_at INTO v_mo
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id;
  IF v_mo IS NULL OR NEW.policy_id IS DISTINCT FROM public.chinh_sach_hieu_luc(NEW.org_id, v_mo) THEN
    RAISE EXCEPTION 'Luot cham phai dung phien ban chinh sach hieu luc luc goi thau mo (L14)'
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
