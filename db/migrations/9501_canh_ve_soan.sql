-- ==============================================================================================
-- 9501_canh_ve_soan — [S1.9101 / S3.2b của spec S3] CẠNH PENDING_APPROVAL→DRAFT CHỈ ĐI ĐƯỢC Ở TỔ CHỨC ĐÃ BẬT, HAI LỜI
-- TỪ CHỐI K4a MANG TÊN RÀNG BUỘC, CHỮ KÝ RÀNG VÀO NGÂN SÁCH, VÀ MỐC ĐÚC TOKEN LÀ ĐỒNG HỒ CỦA CÂU CHÈN
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §3.3, §5.1 (K4, K12), §9 (phần S3.2).
-- ADR-082 ⑾, ADR-084 ⑵ ⑷, ADR-108. Chủ dự án chốt ngày 2026-09-27 (S1.185): cạnh về DRAFT chỉ mở cho tổ chức đã bật; ngày
-- 2026-09-29 (S1.9101): lần thêm hay thu hồi lời mời sai trạng thái (K4a) là một lần từ chối `CONTROL_DENIED`, vào sổ.
--
-- (1) CẠNH `PENDING_APPROVAL→DRAFT`. Nó có trong `CANH_HOP_LE` từ `011` (C-1) mà chưa đường ứng dụng nào đi; S3.2b dựng hàm
--     gói và route cho nó (`returnRfqToDraft`). Trigger RIÊNG ở đúng cạnh (khuôn `014` §(4), `WHEN` đúng cạnh — §2.5 ⒃) chặn
--     cạnh ấy ở tổ chức CHƯA bật, bằng CHÍNH hàm công tắc mà tầng gói hỏi trước (`to_chuc_da_bat_s3`, ADR-080) — một phép so,
--     hai người dùng. Không có trigger này, câu *"tổ chức chưa bật chạy nguyên MVP1"* (ADR-080 ⑶) chỉ đúng nhờ kỷ luật của
--     route: một câu `UPDATE` viết tay hay một công cụ mới đưa gói MVP1 về DRAFT mà không lớp nào kêu (spec §8.11).
--     Cạnh KHÔNG xoá chữ ký nào: chữ ký cũ vô hiệu bằng băm (`011` C-1, `076` K4b, (3) dưới đây) khi nội dung, danh sách hay
--     ngân sách đổi, và vẫn đếm được nếu gói được nộp lại nguyên như cũ. `submitted_*` giữ lần nộp gần nhất — cạnh nộp lần sau đóng dấu lại
--     (`016`, `072`); lịch sử các lần nộp và trả về nằm ở sổ.
-- (2) HAI LỜI TỪ CHỐI K4a MANG TÊN RÀNG BUỘC — khuôn `074_tu_choi_co_ten` (ADR-108). Tầng gói (`createInvitation`,
--     `revokeInvitation`) bắt CHÍNH lỗi của trigger, nhận ra nó bằng tên (`CHOT_THEO_RANG_BUOC`), ghi một hàng
--     `CONTROL_DENIED` ở giao dịch độc lập rồi ném lời từ chối có tên. Thân `076` trích NGUYÊN VĂN, đổi đúng hai chỗ: vế
--     `CONSTRAINT = …` của hai nhánh K4a. Nhánh K6 (`UNSENT→SENT` ngoài OPEN, `SENT→UNSENT`) và nhánh không tìm thấy gói
--     KHÔNG mang tên: không lời gọi nào của người dùng tới được chúng — lần đặt `SENT` là việc của hệ thống sau khi gửi.
--
-- (3) [lượt soi S1.9101] CHỮ KÝ RÀNG VÀO NGÂN SÁCH. Trước cạnh (1), ngân sách khoá khi gói rời DRAFT
--     (`rfq_budgets_chi_sua_khi_soan`) và không đường ứng dụng nào quay về, nên mọi chữ ký nằm trên ngân sách cuối cùng. Cạnh
--     (1) mở lại ngân sách, mà băm nội dung (`011`) và băm danh sách (`076`) đều không mang nó: trả gói cấp kép về DRAFT, hạ
--     ước lượng dưới ngưỡng, nộp lại — chữ ký ký lúc gói CẦN HAI người mở được gói bằng một (D2 thủng; đo ở lượt soi). Câu
--     *"sau cạnh này nó không lật lại được"* của `014` §(4) về `requires_dual_approval` nay sai với tổ chức đã bật. Cách đóng
--     là CHÍNH cơ chế spec §2.4 đã chọn cho cạnh này — chữ ký cũ vô hiệu bằng băm —, mở rộng sang ngân sách: hàm băm RIÊNG
--     `rfq_bam_ngan_sach` (ước lượng, tiền tệ, phiên bản chính sách, bậc, cờ duyệt kép), cột `approved_budget_hash` do trigger
--     đặt lúc ký (tổ chức chưa bật: NULL — cùng lý do vế NULL của `076` (2)), hai UNIQUE mang thêm cột ấy để người đã ký ký lại
--     được trên ngân sách MỚI, và cạnh mở gói của tổ chức đã bật đếm người ký khớp cả ngân sách hiện tại.
-- (4) [lượt soi S1.9101 / khoản 253] MỐC ĐÚC TOKEN LÀ ĐỒNG HỒ CỦA CÂU CHÈN. `docToken` của tổ chức đã bật đòi
--     `created_at >= opened_at`. Với mặc định `now()` — giờ BẮT ĐẦU giao dịch —, một lần mời thêm mà giao dịch bắt đầu trước
--     giao dịch mở gói rồi chờ khoá hàng gói (K4a `FOR SHARE`) đúc token mang giờ sớm hơn `opened_at`: link đi, lời mời thành
--     `SENT`, và link chết ngay khi ra đời (đo ở lượt soi). `clock_timestamp()` là giờ của chính câu chèn: token đúc sau khi
--     gói mở mang giờ sau lần mở. `created_at` ngoài `GRANT INSERT` (`010`), nên mặc định là người duy nhất đặt nó.
--
-- MỌI THỨ Ở ĐÂY CHỈ ĐỔI HÀNH VI CỦA TỔ CHỨC ĐÃ BẬT, trừ hai vế: cạnh (1) nay bị CHẶN ở tổ chức chưa bật — cạnh mà trước đây
-- chỉ một câu SQL tay đi được —, và mốc (4) đổi cho mọi tổ chức. `issueMagicLinkToken` tính hạn từ CÙNG đồng hồ, nên trần
-- `expires_at > created_at` (`010`) không phụ thuộc giao dịch đã chạy bao lâu (lượt soi: với hạn tính từ `now()`, TTL một giây
-- trong một giao dịch đã chạy quá một giây vi phạm trần ấy); phép đếm trần gửi lại so `created_at` với `now()` trừ một giờ — mốc
-- muộn hơn vài mili giây không đổi kết quả. Mặc định cột không có mục ghim ở hardening; phép đo đua của khoản 253 giữ nó.
-- ==============================================================================================

-- ============================================================================================
-- (1) CẠNH PENDING_APPROVAL→DRAFT CHỈ Ở TỔ CHỨC ĐÃ BẬT
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_kiem_canh_ve_soan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Canh PENDING_APPROVAL -> DRAFT chi mo cho to chuc da bat S3 (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_canh_ve_soan
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'DRAFT')
  EXECUTE FUNCTION public.rfq_kiem_canh_ve_soan();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_canh_ve_soan;

-- ============================================================================================
-- (2) K4a — THÂN `076`, HAI NHÁNH MANG TÊN RÀNG BUỘC
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
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_them_sai_trang_thai';
    END IF;
    NEW.status := 'UNSENT';
    RETURN NEW;
  END IF;
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Loi moi chi thu hoi duoc khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_thu_hoi_sai_trang_thai';
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

-- ============================================================================================
-- (3) CHỮ KÝ RÀNG VÀO NGÂN SÁCH
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

-- Giữ nguyên tên ràng buộc (lời từ chối D2 và `buyer.ts` đọc tên ấy); `NULLS NOT DISTINCT` giữ MVP1 đúng một người một lần.
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_nguoi_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_nguoi_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, approver_user_id, approved_content_hash, approved_list_hash, approved_budget_hash);
ALTER TABLE rfq_approvals DROP CONSTRAINT rfq_approvals_mot_phien_mot_lan;
ALTER TABLE rfq_approvals ADD CONSTRAINT rfq_approvals_mot_phien_mot_lan
  UNIQUE NULLS NOT DISTINCT (org_id, rfq_id, session_id, approved_content_hash, approved_list_hash, approved_budget_hash);

-- Thân `076` (4) cộng MỘT phép đếm thứ hai: đủ người trên nội dung và danh sách mà thiếu trên ngân sách thì lời từ chối nói
-- đúng chỗ lệch. Phép đếm đầu giữ nguyên văn và nguyên thông điệp.
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

-- ============================================================================================
-- (4) MỐC ĐÚC TOKEN LÀ ĐỒNG HỒ CỦA CÂU CHÈN
-- ============================================================================================
ALTER TABLE rfq_invitation_tokens ALTER COLUMN created_at SET DEFAULT pg_catalog.clock_timestamp();
