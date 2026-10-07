-- ==============================================================================================
-- 9501_lien_he_chi_nguoi_dung_ho_so — [S1.9101 / khoản 344] CHỈ NGƯỜI DỰNG HỒ SƠ NHÀ CUNG CẤP THÊM ĐƯỢC NGƯỜI LIÊN HỆ VÀO NÓ
--
-- Khoản 344 (§S1.273, lượt soi hình dạng S3.3e1 TRUNG-1): `addSupplierContact` và `POST /suppliers/:supplierId/contacts` không hỏi
-- người gọi liên quan gì tới hồ sơ. Người liên hệ không sửa, không xoá được (`011`); K2 loại nhà cung cấp có BẤT KỲ người liên hệ
-- nào do người chọn danh sách dựng (`107`, `108`); băm xác minh phủ người liên hệ (`082`). Nên một người giữ `supplier.manage` thêm
-- một người liên hệ vào hồ sơ của nhà cung cấp tốt là: ⒜ nhà cung cấp ấy thôi được đếm ở gói của người thêm, và xác minh của nó hết
-- hiệu lực ở MỌI gói của tổ chức cho tới khi tài chính xác minh lại; ⒝ một người lạ trên hồ sơ thật nhận link mời và OTP.
--
-- Chủ dự án chốt ngày 2026-10-07: CHỈ NGƯỜI DỰNG HỒ SƠ (`suppliers.created_by`) thêm được người liên hệ — ở MỌI tổ chức, không chỉ tổ
-- chức đã bật S3, vì vế ⒝ không cần S3. Người dựng vắng mặt thì dựng hồ sơ mới; không vai nào được miễn.
--
-- (1) TRIGGER `ncc_kiem_them_lien_he` trên `supplier_contacts`, BEFORE INSERT, `ENABLE ALWAYS`. Tên trigger xếp SAU
--     `supplier_contacts_kiem_danh_tinh` (`kiem_n` > `kiem_d`) nên `created_by` đã là người của phiên khi hàm này đọc nó. Hồ sơ không
--     có người dựng (`created_by IS NULL` — hàng có trước `013`) cũng bị từ chối: không ai chứng minh được mình là người dựng.
--     Không thấy hồ sơ (khác tổ chức, hay RLS che) thì để khoá ngoại hợp thành `(org_id, supplier_id)` của `008` từ chối như cũ.
--     Nhánh từ chối mang TÊN RÀNG BUỘC `k8a_lien_he_ho_so_nguoi_khac` — tầng gói bắt chính lỗi ấy và ghi `CONTROL_DENIED` ở giao
--     dịch độc lập (K12, khuôn ADR-114). Chốt là K8a: thứ bị phá là tính toàn vẹn của hồ sơ mà xác minh nội bộ ràng băm.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: không đổi người liên hệ đã có (dữ liệu thật trước đây có thể mang người liên hệ do người khác thêm —
-- K2 vẫn đọc chúng như cũ); không thêm vai quản trị dữ liệu nhà cung cấp; không thêm hàng chờ duyệt.
--
-- Hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.ncc_kiem_them_lien_he() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_dung uuid;
BEGIN
  SELECT s.created_by INTO nguoi_dung
    FROM public.suppliers s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.supplier_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF nguoi_dung IS NULL OR nguoi_dung IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'Chi nguoi dung ho so nha cung cap moi them nguoi lien he vao ho so ay (K8a)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k8a_lien_he_ho_so_nguoi_khac';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_contacts_kiem_nguoi_them
  BEFORE INSERT ON supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION public.ncc_kiem_them_lien_he();
ALTER TABLE supplier_contacts ENABLE ALWAYS TRIGGER supplier_contacts_kiem_nguoi_them;
