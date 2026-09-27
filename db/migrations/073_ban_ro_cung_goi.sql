-- =============================================================================================
-- 073 — [S1.169 / khoản 228] BẢN RÕ CHỈ RA ĐỜI DƯỚI YÊU CẦU MỞ THẦU CỦA CHÍNH GÓI VÀ CHÍNH VÒNG
--        CỦA PHONG BÌ ẤY
-- =============================================================================================
-- ĐO (S1.109, ca đột biến J4 của `apps/unseal-worker/src/kich-ban-41-http.int.test.ts`): một câu
-- `INSERT` ghép phong bì VÒNG HAI với yêu cầu mở thầu VÒNG MỘT (đã `EXECUTED`) ĐI QUA, trigger đã bật.
-- `unseal_kiem_yeu_cau_khi_ghi_ban_ro` (`019`) chỉ đòi yêu cầu ở `APPROVED`/`EXECUTED`; hai khoá ngoại
-- hợp thành của `rfq_unsealed_bids` trỏ về hai bảng khác nhau, không về nhau. Nên A1 — *bản rõ chỉ ra
-- đời dưới một yêu cầu đã được phê duyệt* — đúng theo nghĩa *"một"* yêu cầu, không *"yêu cầu của chính
-- phong bì ấy"*: cùng khe ấy ghép được phong bì gói A với yêu cầu gói B.
--
-- SỬA (chủ dự án chốt 2026-09-27, ADR-105): thân hàm thêm ĐÚNG vị từ mà worker đã dùng để chọn phong
-- bì (`apps/unseal-worker/src/index.ts`, câu `phongBi`): phiên bản báo giá thuộc `rfq_id` của yêu cầu
-- (qua `vendor_bids` → `rfq_invitations`), VÀ `bafo_round_id` của nó `IS NOT DISTINCT FROM` của yêu
-- cầu. Worker không đổi một dòng; trigger nay nói điều worker đã tự làm.
--
-- Vẫn là MỘT hàm, MỘT trigger — không trigger thứ hai: A1 có một chỗ đứng, và thứ tự tên trigger
-- không được là thứ quyết định câu nào báo trước. `app_unseal` đã có `SELECT` trên đúng các cột đọc
-- ở đây (`018`, `019`, `059`), nên hàm vẫn SECURITY INVOKER, RLS vẫn áp.
--
-- Thân dưới là thân của `019` đổi đúng hai chỗ: đọc thêm `rfq_id`, `bafo_round_id` của yêu cầu, và
-- khối kiểm cuối. `hardening.always.sql` ghim thân mới trong CÙNG commit (S1.96).
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  goi_yc uuid;
  vong_yc uuid;
BEGIN
  SELECT r.status, r.rfq_id, r.bafo_round_id INTO trang_thai, goi_yc, vong_yc
    FROM public.unseal_requests r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.unseal_request_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay yeu cau mo thau %', NEW.unseal_request_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF trang_thai NOT IN ('APPROVED', 'EXECUTED') THEN
    RAISE EXCEPTION 'Chi ghi duoc ban ro duoi mot yeu cau da phe duyet; yeu cau dang o % (A1)',
      trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.vendor_bid_versions v
      JOIN public.vendor_bids b ON b.id OPERATOR(pg_catalog.=) v.bid_id AND b.org_id OPERATOR(pg_catalog.=) v.org_id
      JOIN public.rfq_invitations i ON i.id OPERATOR(pg_catalog.=) b.invitation_id AND i.org_id OPERATOR(pg_catalog.=) b.org_id
     WHERE v.id OPERATOR(pg_catalog.=) NEW.bid_version_id
       AND v.org_id OPERATOR(pg_catalog.=) NEW.org_id
       AND i.rfq_id OPERATOR(pg_catalog.=) goi_yc
       AND v.bafo_round_id IS NOT DISTINCT FROM vong_yc
  ) THEN
    RAISE EXCEPTION 'Ban ro phai thuoc cung goi thau va cung vong voi yeu cau mo thau % (A1)',
      NEW.unseal_request_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;
