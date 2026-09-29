-- ==============================================================================================
-- 080_rang_ngan_sach — [S1.194] CHỮ KÝ MỞ GÓI RÀNG VÀO NGÂN SÁCH (K4b, D2) — khoản 254 đóng
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §2.4 (chữ ký cũ vô hiệu bằng băm), §3.3,
-- §5.1 (K4). ADR-114. Chủ dự án chốt ngày 2026-09-29: vá lỗ này trước S3.2c, bằng một PR riêng.
--
-- VÌ SAO. Trước `077`, ngân sách khoá khi gói rời DRAFT (`rfq_budgets_chi_sua_khi_soan`, `014`) và không đường nào quay về,
-- nên mọi chữ ký nằm trên ngân sách cuối cùng. Cạnh `PENDING_APPROVAL→DRAFT` của `077` mở lại ngân sách, mà băm nội dung
-- (`011`) và băm danh sách (`076`) đều không mang nó. Đo trên `master` `8f90bf2`, tổ chức đã bật:
--   · gói 150 triệu cần hai chữ ký, mới có một; trả về, hạ ước lượng xuống 1 triệu, nộp lại ⇒ gói MỞ bằng đúng chữ ký ấy — chữ
--     ký cho lúc gói CẦN HAI người mở gói bằng một (D2);
--   · gói 1 triệu đã ký; trả về, nâng lên 99 triệu — cùng bậc, vẫn một chữ ký —, nộp lại ⇒ gói MỞ bằng chữ ký trên con số 1 triệu.
-- Câu *"sau cạnh này nó không lật lại được"* của `014` §(4) về `requires_dual_approval` sai với tổ chức đã bật từ `077`.
--
-- CÁCH ĐÓNG — CHÍNH cơ chế spec §2.4 đã chọn cho cạnh về DRAFT (chữ ký cũ vô hiệu bằng băm, `011` C-1, `076`), mở sang ngân sách:
-- (1) hàm băm RIÊNG `rfq_bam_ngan_sach(gói)`: ước lượng, tiền tệ, phiên bản chính sách ghim, bậc, cờ duyệt kép — khuôn
--     `rfq_bam_danh_sach`; hai hàm cũ không đổi;
-- (2) cột `rfq_approvals.approved_budget_hash`, ngoài GRANT, do CÙNG trigger đặt băm danh sách đặt lúc ký — tổ chức chưa bật:
--     NULL, cùng lý do vế NULL của `076` (2);
-- (3) hai UNIQUE của `rfq_approvals` mang thêm cột ấy — người đã ký ký lại được trên ngân sách MỚI; giữ nguyên tên ràng buộc;
-- (4) cạnh mở gói của tổ chức đã bật (`076` (4)) đếm thêm người ký khớp CẢ ngân sách hiện tại, với lời từ chối nói đúng chỗ lệch.
--     Phép đếm đầu giữ nguyên văn và nguyên thông điệp.
--
-- KHÔNG ĐIỀN HÀNG CŨ. Chữ ký đã có ở tổ chức đã bật mang NULL: không biết nó đã ký trên ngân sách nào — điền băm HIỆN TẠI chính là
-- lỗ này. Fail-closed: nó không đếm ở cạnh mở gói, và người ấy ký lại được (NULL khác băm, UNIQUE (3) cho qua). Hôm nay không tổ
-- chức thật nào bật được S3 (ADR-105).
--
-- Tổ chức chưa bật chạy nguyên MVP1: cột NULL, hai UNIQUE tương đương ràng buộc cũ, cạnh mở gói hỏi `to_chuc_da_bat_s3` trước.
-- ==============================================================================================

-- ============================================================================================
-- (1) BĂM NGÂN SÁCH
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp. `LEFT JOIN`: cờ duyệt kép luôn nằm trong băm,
-- kể cả khi gói chưa có ngân sách — ở tổ chức đã bật, gói không rời DRAFT được khi thiếu nó (K1).
CREATE OR REPLACE FUNCTION public.rfq_bam_ngan_sach(p_rfq uuid) RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to(
    coalesce((SELECT 'NGAN_SACH|' || coalesce(b.estimated_value::text, '') || '|' || coalesce(b.currency, '')
                     || '|' || coalesce(b.policy_id::text, '') || '|' || coalesce(b.tier_tu_so_tien::text, '')
                     || '|' || p.requires_dual_approval::text
                FROM public.rfq_packages p
                LEFT JOIN public.rfq_budgets b ON b.rfq_id = p.id AND b.org_id = p.org_id
               WHERE p.id = p_rfq), ''),
    'UTF8'))
$ham$;

-- ============================================================================================
-- (2) CHỮ KÝ MANG NGÂN SÁCH NÓ ĐÃ KÝ
-- ============================================================================================
ALTER TABLE rfq_approvals ADD COLUMN approved_budget_hash bytea;
-- Cố ý KHÔNG cấp INSERT hay UPDATE cột này — khuôn `approved_list_hash` (`076` (2)).

-- Thân `076` (2) cộng MỘT vế: cùng một trigger đặt cả hai băm, nên không có thứ tự nào giữa hai trigger để trôi.
CREATE OR REPLACE FUNCTION public.rfq_approvals_dat_bam_danh_sach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF public.to_chuc_da_bat_s3(NEW.org_id) THEN
    NEW.approved_list_hash := public.rfq_bam_danh_sach(NEW.rfq_id);
    NEW.approved_budget_hash := public.rfq_bam_ngan_sach(NEW.rfq_id);
  ELSE
    NEW.approved_list_hash := NULL;
    NEW.approved_budget_hash := NULL;
  END IF;
  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (3) MỘT NGƯỜI, MỘT PHIÊN — MỘT LẦN TRÊN MỖI BỘ BA (NỘI DUNG, DANH SÁCH, NGÂN SÁCH)
-- ============================================================================================
-- Giữ nguyên tên ràng buộc (lời từ chối D2 đọc tên ấy); `NULLS NOT DISTINCT` giữ MVP1 đúng một người một lần.
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_nguoi_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_nguoi_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, approver_user_id, approved_content_hash, approved_list_hash, approved_budget_hash);
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_phien_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_phien_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, session_id, approved_content_hash, approved_list_hash, approved_budget_hash);

-- ============================================================================================
-- (4) K4b — CẠNH MỞ GÓI ĐẾM CHỮ KÝ TRÊN NGÂN SÁCH HIỆN TẠI
-- ============================================================================================
-- Thân `076` (4) cộng MỘT phép đếm thứ hai: đủ người trên nội dung và danh sách mà thiếu trên ngân sách thì lời từ chối nói
-- đúng chỗ lệch. Trigger `rfq_packages_kiem_danh_sach_khi_mo` của `076` giữ nguyên.
CREATE OR REPLACE FUNCTION public.rfq_kiem_chu_ky_danh_sach_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can integer;
  co integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  can := CASE WHEN NEW.requires_dual_approval THEN 2 ELSE 1 END;
  SELECT count(DISTINCT a.approver_user_id) INTO co
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id
     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(NEW.id);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % chu ky TREN DANH SACH MOI HIEN TAI, moi co % (K4b)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(DISTINCT a.approver_user_id) INTO co
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id
     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(NEW.id)
     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(NEW.id);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % chu ky TREN NGAN SACH HIEN TAI, moi co % (K4b)', can, co
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
