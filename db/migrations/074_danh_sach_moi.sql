-- ==============================================================================================
-- 074_danh_sach_moi — [S1.180 / S3.2a của spec S3] DANH SÁCH ĐƯỢC KÝ LÀ DANH SÁCH ĐƯỢC MỜI (K4a, K4b), VÀ KHÔNG
-- TOKEN MỜI NÀO CHO MỘT GÓI CHƯA MỞ (K6)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §3.3, §5.1 (K4, K6), §9 (phần S3.2),
-- §2.5 ⑾. ADR-082 ⑼ ⑾. Chủ dự án chốt ngày 2026-09-27: cạnh `PENDING_APPROVAL→DRAFT` chỉ mở cho tổ chức đã bật (S3.2b);
-- thu hồi lời mời ở OPEN bị CHẶN tới khi S3.6 dựng tín hiệu `INVITE_LIST_NARROWED`.
--
-- MỌI CHỐT Ở ĐÂY CHỈ ÁP CHO TỔ CHỨC ĐÃ BẬT S3 (`to_chuc_da_bat_s3`, ADR-080 ⑶). Tổ chức chưa bật chạy nguyên MVP1: mời
-- ở trạng thái nào cũng được, token đúc ngay lúc mời, thu hồi lúc nào cũng được, lời mời mang `SENT` — cụm test hiện có
-- là đối chứng của nhánh ấy (spec §8.11).
--
-- (1) `rfq_bam_danh_sach(gói)`: băm danh sách mời CÒN SỐNG — một hàm RIÊNG; `rfq_bam_noi_dung` (`011`) không đổi
--     (§2.5 ⑾). Mỗi lời mời một dòng có nhãn loại `MOI|nhà cung cấp|người liên hệ|kênh`, các dòng xếp theo chính chuỗi
--     dòng dưới collation `"C"` — thứ tự không được đổi theo locale của cụm, vì băm lệch là chữ ký vô hiệu. S3.3 thêm
--     dòng `NGOAI_LE|…` cho ngoại lệ: một gói không có ngoại lệ giữ đúng băm hôm nay, nên lần deploy S3.3 không vô hiệu
--     chữ ký nào. Người liên hệ và kênh nằm trong băm: đổi đích nhận link là đổi danh sách.
-- (2) `rfq_approvals.approved_list_hash`: trigger RIÊNG đặt, ngoài GRANT — khuôn `approved_content_hash` (`011`). Tổ
--     chức đã bật: băm (1) lúc ký. Chưa bật: NULL. VẾ NULL LÀ CHỊU LỰC. MVP1 không chặn thêm lời mời ở
--     PENDING_APPROVAL; nếu cột mang băm ở mọi tổ chức thì UNIQUE (3) cho một người ký lần hai trên CÙNG nội dung sau khi
--     danh sách đổi, và khối đếm `count(*)` ở cạnh mở gói (`071`) đếm người ấy hai lần — D2 thủng mà không trigger nào
--     đỏ. NULL cộng `NULLS NOT DISTINCT` giữ cho MVP1 đúng một người một lần trên mỗi nội dung.
-- (3) Hai UNIQUE của `rfq_approvals` mang thêm hai băm: người đã ký ký lại được trên nội dung MỚI hay danh sách MỚI
--     (§2.5 ⑾), và vẫn một người — một phiên — một lần trên mỗi cặp (nội dung, danh sách). Giữ nguyên tên ràng buộc:
--     lời từ chối D2 đọc tên ấy. Ở tổ chức chưa bật, ràng buộc mới TƯƠNG ĐƯƠNG ràng buộc cũ `(tổ chức, gói, người)` của
--     `009`: chữ ký chỉ chèn được ở PENDING_APPROVAL, nội dung không đổi được ở đó (`071` vế (c) cho hạn nộp và tiêu đề,
--     `rfq_items_chi_sua_khi_soan` cho hạng mục), và MVP1 không có đường về DRAFT — nên mọi chữ ký của một gói MVP1 mang
--     cùng một băm nội dung, và băm danh sách của nó NULL (2).
-- (4) CẠNH PENDING_APPROVAL→OPEN — trigger RIÊNG (khuôn `014` §(4)), tổ chức đã bật: đủ người ký khớp CẢ nội dung LẪN
--     danh sách hiện tại — K4b. Khối đếm của `071` giữ nguyên văn và vẫn chạy cho mọi tổ chức.
-- (5) `rfq_invitations`: trạng thái `UNSENT` — *chưa gửi* (ADR-082 ⑼) — và cột `moi_sau_khi_ky`, trigger đặt, ngoài GRANT.
-- (6) K4a: lời mời của tổ chức đã bật chỉ THÊM ở DRAFT hay OPEN — ở OPEN mang nhãn `moi_sau_khi_ky` —, chỉ THU HỒI ở
--     DRAFT, và chèn luôn là `UNSENT`; `UNSENT→SENT` chỉ khi gói OPEN, và không có `SENT→UNSENT`. Trigger khoá hàng gói
--     `FOR SHARE`: một lần chèn hay thu hồi không lọt qua một cạnh trạng thái đang chạy dở.
-- (7) K6: không token mời nào cho gói của tổ chức đã bật khi gói chưa từng mở (`opened_at IS NULL`).
--
-- THỨ MIGRATION NÀY KHÔNG LÀM (S3.2b, S3.2c): hàm và route cạnh về DRAFT; mời ở DRAFT qua route; đúc token lúc mở gói,
-- gửi sau commit, lối gửi lại; màn `/tao-thau`, `gieo:demo`, kịch bản 41 theo thứ tự mới. Vế *"nhãn vào bộ bằng chứng"*
-- của K6 thuộc S3.9.
-- ==============================================================================================

-- ============================================================================================
-- (1) BĂM DANH SÁCH MỜI
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp — lời mời của tổ chức khác không có trong băm.
CREATE OR REPLACE FUNCTION public.rfq_bam_danh_sach(p_rfq uuid) RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to(
    coalesce((SELECT string_agg(d.dong, E'\n' ORDER BY d.dong COLLATE "C")
                FROM (SELECT 'MOI|' || i.supplier_id::text || '|' || i.contact_id::text || '|' || i.link_channel AS dong
                        FROM public.rfq_invitations i
                       WHERE i.rfq_id = p_rfq AND i.revoked_at IS NULL) d), ''),
    'UTF8'))
$ham$;

-- ============================================================================================
-- (2) CHỮ KÝ MANG DANH SÁCH NÓ ĐÃ KÝ
-- ============================================================================================
ALTER TABLE rfq_approvals ADD COLUMN approved_list_hash bytea;
-- Cố ý KHÔNG cấp INSERT hay UPDATE cột này: trigger dưới đặt nó, bên gọi không khai được danh sách mình đã ký.

CREATE OR REPLACE FUNCTION public.rfq_approvals_dat_bam_danh_sach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF public.to_chuc_da_bat_s3(NEW.org_id) THEN
    NEW.approved_list_hash := public.rfq_bam_danh_sach(NEW.rfq_id);
  ELSE
    NEW.approved_list_hash := NULL;
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_approvals_dat_bam_danh_sach
  BEFORE INSERT ON rfq_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_approvals_dat_bam_danh_sach();
ALTER TABLE rfq_approvals ENABLE ALWAYS TRIGGER rfq_approvals_dat_bam_danh_sach;

-- ============================================================================================
-- (3) MỘT NGƯỜI, MỘT PHIÊN — MỘT LẦN TRÊN MỖI CẶP (NỘI DUNG, DANH SÁCH)
-- ============================================================================================
-- `NULLS NOT DISTINCT` là load-bearing — cùng lý do chú thích `session_id NOT NULL` ở `009`: với NULL thường, hai hàng
-- (người, nội dung, NULL) không đụng nhau và ràng buộc thành trang trí đúng ở nhánh MVP1.
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_nguoi_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_nguoi_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, approver_user_id, approved_content_hash, approved_list_hash);
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_phien_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_phien_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, session_id, approved_content_hash, approved_list_hash);

-- ============================================================================================
-- (4) K4b — CẠNH MỞ GÓI ĐẾM CHỮ KÝ TRÊN DANH SÁCH HIỆN TẠI
-- ============================================================================================
-- `WHEN` đúng cạnh (§2.5 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây.
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
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_danh_sach_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_kiem_chu_ky_danh_sach_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_danh_sach_khi_mo;

-- ============================================================================================
-- (5) TRẠNG THÁI *CHƯA GỬI* VÀ NHÃN *MỜI SAU KHI KÝ*
-- ============================================================================================
-- Giữ tên ràng buộc tự sinh của `010`: `db/check-an-ninh.int.test.ts` khai nó theo tên.
ALTER TABLE rfq_invitations DROP CONSTRAINT rfq_invitations_status_check;
ALTER TABLE rfq_invitations ADD CONSTRAINT rfq_invitations_status_check
  CHECK (status IN ('SENT', 'ACCEPTED', 'DECLINED', 'REVOKED', 'UNSENT'));
ALTER TABLE rfq_invitations ADD COLUMN moi_sau_khi_ky boolean NOT NULL DEFAULT false;
-- Cố ý KHÔNG cấp INSERT hay UPDATE cột này: trigger dưới đặt nó từ trạng thái THẬT của gói lúc chèn.

-- ============================================================================================
-- (6) K4a — LỜI MỜI CHỈ ĐỔI Ở DRAFT; Ở OPEN CHỈ THÊM
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_invitations_kiem_danh_sach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay goi thau cua loi moi (K4a)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF trang_thai = 'DRAFT' THEN
      NEW.moi_sau_khi_ky := false;
    ELSIF trang_thai = 'OPEN' THEN
      NEW.moi_sau_khi_ky := true;
    ELSE
      RAISE EXCEPTION 'Goi thau o % khong them loi moi duoc — chi o DRAFT, hoac OPEN (K4a)', trang_thai
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := 'UNSENT';
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Loi moi chi thu hoi duoc khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'UNSENT' AND NEW.status = 'SENT' AND trang_thai <> 'OPEN' THEN
    RAISE EXCEPTION 'Loi moi chi thanh SENT khi goi da OPEN; goi dang o % (K6)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SENT' AND NEW.status = 'UNSENT' THEN
    RAISE EXCEPTION 'Loi moi da gui khong quay ve chua gui (K6)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_invitations_kiem_danh_sach
  BEFORE INSERT OR UPDATE ON rfq_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_invitations_kiem_danh_sach();
ALTER TABLE rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_kiem_danh_sach;

-- ============================================================================================
-- (7) K6 — KHÔNG TOKEN MỜI CHO GÓI CHƯA MỞ
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_invitation_tokens_kiem_goi_da_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  mo_luc timestamptz;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  SELECT p.opened_at INTO mo_luc
    FROM public.rfq_invitations i
    JOIN public.rfq_packages p ON p.org_id = i.org_id AND p.id = i.rfq_id
   WHERE i.org_id = NEW.org_id AND i.id = NEW.invitation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay loi moi cua token (K6)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF mo_luc IS NULL THEN
    RAISE EXCEPTION 'Khong duc token moi cho goi thau chua mo (K6)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_invitation_tokens_kiem_goi_da_mo
  BEFORE INSERT ON rfq_invitation_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rfq_invitation_tokens_kiem_goi_da_mo();
ALTER TABLE rfq_invitation_tokens ENABLE ALWAYS TRIGGER rfq_invitation_tokens_kiem_goi_da_mo;
