-- ==============================================================================================
-- 9501_chan_bat_s3_khi_con_goi_cho — [S1.9101 / khoản 261] CHỮ KÝ BẬT S3 BỊ TỪ CHỐI KHI TỔ CHỨC CÒN GÓI CHỜ DUYỆT
--
-- Lượt soi S1.198 (F6) đo, khoản 261 ghi. Ở tổ chức chưa bật, danh sách mời đổi được khi gói đang chờ duyệt (`076` chỉ chặn ở
-- tổ chức đã bật) và lần nộp đứng yên (`087` chỉ tăng nó ở cạnh DRAFT→PENDING_APPROVAL). Người duyệt đọc gói ở lần nộp 1 với
-- một lời mời; PM mời thêm — MVP1 cho —; tổ chức bật S3; lời duyệt mang mốc 1 đi qua, chữ ký mang băm của danh sách HAI lời mời
-- lúc ký, và gói MỞ trên một danh sách người duyệt chưa đọc.
--
-- Chủ dự án chốt ngày 2026-09-30: chặn LẦN BẬT, không chặn lời duyệt. Chữ ký làm tổ chức chuyển sang đã bật — chữ ký đầu tiên
-- trên một phiên bản có bậc (`to_chuc_da_bat_s3`, `069` (3)) — bị từ chối khi tổ chức còn gói ở `PENDING_APPROVAL`: một gói nộp
-- dưới luật MVP1 không đi qua lần bật. Tổ chức duyệt rồi mở, hay huỷ, các gói ấy trước — ở tổ chức chưa bật không có cạnh về
-- DRAFT (`077`) —, rồi ký. Chữ ký trên phiên bản có bậc SAU lần bật không bị hỏi: gói chờ duyệt lúc ấy đã nộp dưới luật S3,
-- và từ lần bật danh sách của gói chờ duyệt không đổi được (`076`).
--
-- Không đua: phép kiểm đứng SAU khoá tư vấn theo tổ chức mà hàm này giữ ĐỘC QUYỀN (`069`, `072` (5)) và cạnh nộp duyệt giữ CHIA
-- SẺ (`072` (4)). Một lần nộp đang dở làm lần ký chờ, và câu đếm — một câu mới, nên một ảnh chụp mới của READ COMMITTED, lấy
-- SAU khoá — thấy gói nó vừa nộp; một lần nộp tới sau chờ lần ký, và đọc tổ chức đã bật. Câu đếm lọc theo `org_id` của chính
-- chữ ký và chạy dưới quyền người gọi — cùng tầm nhìn đã tìm ra phiên bản chính sách ở đầu hàm. Phép kiểm đứng CUỐI: một chữ ký
-- sai vì lý do khác vẫn nhận đúng lời từ chối của nó. Thân còn lại NGUYÊN VĂN `072`.
--
-- Hàm mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96); trigger không đổi.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.chinh_sach_kiem_nguoi_ky() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  co_bac boolean;
  phien_ban integer;
  hieu_luc_tu timestamptz;
  goi_cho integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  NEW.signed_at := pg_catalog.clock_timestamp();
  SELECT p.created_by, p.tiers IS NOT NULL, p.version, p.effective_from
    INTO nguoi_tao, co_bac, phien_ban, hieu_luc_tu
    FROM public.org_procurement_policies p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.policy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phien ban chinh sach de ky (ADR-082)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT co_bac THEN
    RAISE EXCEPTION 'Chi phien ban chinh sach CO BAC moi nhan chu ky thu hai (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.signed_by = nguoi_tao THEN
    RAISE EXCEPTION 'Nguoi tao phien ban chinh sach khong duoc tu ky (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.signed_by
                    AND rp.permission_code = 'policy.manage') THEN
    RAISE EXCEPTION 'Nguoi ky phien ban chinh sach phai giu policy.manage (ADR-082)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_procurement_policies q
              WHERE q.org_id = NEW.org_id AND q.version > phien_ban) THEN
    RAISE EXCEPTION 'Chi ky duoc phien ban chinh sach MOI NHAT cua to chuc (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF hieu_luc_tu > NEW.signed_at THEN
    RAISE EXCEPTION 'Phien ban chinh sach chua toi ngay hieu luc — ky khi toi (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    SELECT count(*)::integer INTO goi_cho
      FROM public.rfq_packages g
     WHERE g.org_id = NEW.org_id AND g.status = 'PENDING_APPROVAL';
    IF goi_cho > 0 THEN
      RAISE EXCEPTION 'To chuc con % goi cho duyet: duyet roi mo, hoac huy, cac goi ay truoc khi bat S3 (ADR-080)', goi_cho
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;
