-- ==============================================================================================
-- 080_k4a_co_ten — [S1.194 / S3.2d của spec S3] HAI LỜI TỪ CHỐI K4a MANG TÊN RÀNG BUỘC (khoản 255)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §3.3, §5.1 (K4a, K12), §9 (phần S3.2).
-- ADR-084 ⑷ ⑸, ADR-108, ADR-114. Chủ dự án chốt ngày 2026-09-29, lúc cho làm S3.2d: lần thêm hay thu hồi lời mời sai
-- trạng thái là một lần từ chối `CONTROL_DENIED`, vào sổ; S3.2d chỉ làm khoản 255 — khoản 254 đi ở PR riêng (#199).
--
-- HAI NHÁNH K4a MANG TÊN, khuôn `074_tu_choi_co_ten` (ADR-108). Tầng gói (`createInvitation`, `revokeInvitation`) bắt CHÍNH lỗi
-- của trigger, nhận ra nó bằng TÊN (`CHOT_THEO_RANG_BUOC`), ghi một hàng `CONTROL_DENIED` ở giao dịch độc lập rồi ném lời từ
-- chối có tên. Thân `076` (6) TRÍCH NGUYÊN VĂN, đổi đúng hai chỗ: vế `CONSTRAINT = …` của nhánh thêm và nhánh thu hồi. Thông
-- điệp của CSDL không đổi.
--
-- Các nhánh KHÔNG mang tên, nên tầng gói không ghi: không tìm thấy gói (khoá ngoại hợp thành giữ hàng cha); hai nhánh K6
-- (`UNSENT→SENT` ngoài OPEN, `SENT→UNSENT`) — lần đặt `SENT` là việc của hệ thống sau lần gửi, không lời gọi nào của người dùng
-- tới được chúng. Tổ chức chưa bật không đi vào trigger này, nên không có lần từ chối nào để ghi.
--
-- Không đổi trigger nào: `CREATE OR REPLACE FUNCTION` giữ nguyên trigger trỏ vào hàm. Bản ghim ở `hardening.always.sql` đổi
-- cùng commit.
-- ==============================================================================================

-- ============================================================================================
-- (1) K4a — THÂN `076` (6), HAI NHÁNH MANG TÊN RÀNG BUỘC
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
