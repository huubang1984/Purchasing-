-- ==============================================================================================
-- 9501_nhom_hang_cua_hang_chuan — [S1.9101 / S4.8] NHÓM HÀNG CỦA HÀNG CHUẨN, Ở BẢNG PHIÊN BẢN
--
-- Spec S4 §3.4 (dòng *"Nhóm hàng"*), §4.3, §9 (S4.8); ADR-084 ⑶ — `category_id` vào CSDL ở hạng mục dựng hành vi của nó, sau khi
-- S3.6 vào `master` (S3.6 khép). Chủ dự án chốt 2026-10-11 (ADR-9201): cột TUỲ CHỌN; gán mới chỉ nhóm CÒN DÙNG, giữ nguyên nhóm
-- của phiên bản trước thì được dù nhóm ấy đã ngừng; người gán là người giữ `item.manage` (vai `DATA_STEWARD`, mù giá), trong
-- chính phiên bản hàng chuẩn — không mã quyền mới.
--
-- (1) `canonical_item_versions.category_id` — NULL được, khoá ngoại theo (tổ chức, nhóm) như `rfq_packages` (`085` (5)): một nhóm
--     của tổ chức khác không gán được. Ở bảng PHIÊN BẢN, không ở danh tính (spec §4.3 [S1.159]): danh tính bất biến, mọi thứ đổi
--     được của hàng chuẩn là một phiên bản mới, nên nhóm hàng của hàng chuẩn TẠI một mốc đọc lại được (hàng mới nhất theo `seq` có
--     `ghi_luc` trước mốc). Hàng chuẩn cũ không được điền ngược — cột NULL ở mọi phiên bản trước vòng này.
-- (2) `hang_chuan_kiem_nhom_hang` — trigger BEFORE INSERT. Nhóm khác NULL thì lấy khoá tư vấn CHIA SẺ theo nhóm — cùng khoá mà lần
--     ngừng dùng (`nhom_hang_kiem_doi`) giữ ĐỘC QUYỀN —, rồi hỏi `nhom_hang_con_dung`. Nhóm đã ngừng chỉ qua được khi phiên bản
--     MỚI NHẤT của cùng hàng chuẩn mang đúng nhóm ấy: phiên bản là bản chụp đầy đủ, nên sửa tên hay ngừng dùng một hàng chuẩn thuộc
--     nhóm đã ngừng không bị buộc đổi nhóm (khác gói: nhóm của gói chỉ đổi ở DRAFT, `085` (5)). Từ chối ⇒ ràng buộc có tên
--     `hang_chuan_nhom_hang_da_ngung_dung`.
--     Chỉ dưới READ COMMITTED (khuôn `107`): ở REPEATABLE READ ảnh chụp cố định từ câu INSERT, nên phép hỏi sau khi được khoá vẫn thấy
--     nhóm còn dùng dù lần ngừng dùng đã commit — chờ khoá thành vô nghĩa. Đường ứng dụng luôn ở READ COMMITTED; câu viết tay ở mức
--     khác bị từ chối. Hàm là VOLATILE (mặc định) — mỗi câu một ảnh chụp mới; hardening ghim cả thuộc tính ấy.
--     Tên trigger `canonical_item_versions_nhom_hang` xếp SAU `…_kiem_quyen_ghi` (BEFORE cùng sự kiện chạy theo thứ tự tên): người
--     không giữ `item.manage` nghe lý do ấy trước. `…_dat_thu_tu` chạy trước cả hai và giữ khoá ĐỘC QUYỀN theo (bảng, tổ chức) tới
--     hết giao dịch, nên hai phiên bản của cùng hàng chuẩn không chen nhau: phép đọc *"phiên bản mới nhất"* thấy phiên bản đã commit
--     của lần ghi trước.
-- (3) Quyền theo CỘT là cộng dồn — thêm `category_id` vào tập `INSERT` của `083`.
--
-- Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- (1)
ALTER TABLE canonical_item_versions ADD COLUMN category_id uuid;
ALTER TABLE canonical_item_versions
  ADD CONSTRAINT canonical_item_versions_category_fkey
  FOREIGN KEY (org_id, category_id) REFERENCES procurement_categories (org_id, id);

-- (2)
CREATE OR REPLACE FUNCTION public.hang_chuan_kiem_nhom_hang() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Gan nhom hang cho hang chuan chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay lan ngung dung vua commit (S4.8)',
      pg_catalog.current_setting('transaction_isolation') USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
            pg_catalog.hashtextextended(NEW.category_id::pg_catalog.text, 8));
  IF public.nhom_hang_con_dung(NEW.org_id, NEW.category_id) THEN
    RETURN NEW;
  END IF;
  IF (SELECT v.category_id
        FROM public.canonical_item_versions v
       WHERE v.org_id = NEW.org_id AND v.canonical_item_id = NEW.canonical_item_id
       ORDER BY v.seq DESC
       LIMIT 1) IS NOT DISTINCT FROM NEW.category_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Nhom hang da ngung dung — chi giu duoc nhom cua phien ban truoc (S4.8)'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'hang_chuan_nhom_hang_da_ngung_dung';
END
$ham$;

CREATE TRIGGER canonical_item_versions_nhom_hang
  BEFORE INSERT ON canonical_item_versions
  FOR EACH ROW EXECUTE FUNCTION public.hang_chuan_kiem_nhom_hang();
ALTER TABLE canonical_item_versions ENABLE ALWAYS TRIGGER canonical_item_versions_nhom_hang;

-- (3)
GRANT INSERT (category_id) ON canonical_item_versions TO app_api;
