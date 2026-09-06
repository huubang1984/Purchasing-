-- =============================================================================================
-- 026 — [khoản nợ 26] THU HỒI LÀ MỘT DẤU; ĐÂY LÀ CHỖ NÓ TRỞ THÀNH MỘT SỰ THẬT MẬT MÃ
-- =============================================================================================
-- Khối (4) của `017` để lại một câu hỏi CÓ TÊN, và tự nó nói rõ ai phải trả lời:
--
--     "thu hồi ở đây là MỘT DẤU, không phải một lần XOÁ MẬT MÃ. `wrapped_private_key` vẫn nằm
--      nguyên trong hàng. Xoá nó đi sẽ biến 'không ai được mở báo giá của RFQ đã huỷ' từ một quy
--      tắc CHÍNH SÁCH thành một sự thật MẬT MÃ — mạnh hơn hẳn — nhưng nó cũng là một hành động
--      không đảo ngược được đứng sau một nút bấm có thể bấm nhầm. Quyết định ấy thuộc về S1.6,
--      nơi có cổng chính sách để đặt nó vào."
--
-- S1.6 đã xây xong cổng chính sách ấy. Đây là quyết định.
--
-- ---------------------------------------------------------------------------------------------
-- QUYẾT ĐỊNH, VÀ BỐN ĐIỀU KIỆN NÓ ĐỨNG TRÊN
-- ---------------------------------------------------------------------------------------------
-- Xoá mật mã ĐƯỢC hỗ trợ, và nó KHÔNG BAO GIỜ là tác dụng phụ của một nút. Bốn điều kiện, hợp
-- lại, và mỗi cái đóng một cách hỏng khác nhau:
--
--   ⑴ **Chỉ sau khi đã THU HỒI.** `revoked_at IS NULL` ⇒ từ chối. Vật liệu khoá của một RFQ đang
--     mở không xoá được bằng bất kỳ đường nào ở đây.
--
--   ⑵ **Chỉ sau một QUÃNG ÂN HẠN do chính sách của tổ chức đặt ra.** `key_purge_grace_hours`.
--     Đây là chỗ *"nút bấm có thể bấm nhầm"* bị đóng: một lần huỷ nhầm còn cửa sổ để sửa, vì
--     trong quãng ấy khoá vẫn còn và một lần khôi phục còn khả thi bằng tay. Hết quãng thì không.
--
--     `0` LÀ MỘT GIÁ TRỊ HỢP LỆ, và nó KHÔNG đồng nghĩa với `NULL`. `NULL` = *"tổ chức này không
--     xoá"*; `0` = *"xoá được ngay khi đã thu hồi, không chờ"*. Một tổ chức chọn `0` là một tổ
--     chức đã tự bỏ lớp ⑵ và còn lại ba lớp: đã thu hồi, có quyền `rfq.key.purge`, và phải khai
--     đúng số hàng mình đang phá huỷ. Nói ra thay vì để đọc nhầm — và cũng chính `0` làm đường
--     thuận của khoản nợ này ĐO ĐƯỢC bằng một test tất định, thay vì bằng một lần chờ một giờ.
--
--   ⑶ **Mặc định là KHÔNG XOÁ** (`NULL`). Một hành động không đảo ngược được không được bật sẵn
--     cho một tổ chức chưa từng nghe nói tới nó. Bật lên là một quyết định có người ký — cùng
--     khuôn `strict_blind_mode` của `020`, nhưng ngược chiều mặc định, và ngược có lý do: chế độ
--     mù nghiêm ngặt hỏng theo hướng *"thấy ít hơn mong đợi"*, còn xoá mật mã hỏng theo hướng
--     *"mất vĩnh viễn"*.
--
--   ⑷ **Chỉ MỘT CHIỀU, và chỉ về NULL.** Trigger cho phép `wrapped_private_key` đổi giá trị đúng
--     một lần, đúng một hướng: thành `NULL`. `app_api` NAY có `UPDATE` trên cột ấy — thứ trước
--     đây nó không có — và đó là một sự nới quyền phải nói thẳng ra. Nó KHÔNG mở đường thay khoá:
--     `app_api` vẫn KHÔNG ĐỌC được cột này (`017` không cấp `SELECT`), và trigger từ chối mọi giá
--     trị mới khác `NULL`. Ghi được nhưng chỉ ghi được `NULL` và chỉ một lần — đó là hình dạng
--     của một nút phá huỷ, không phải của một nút sửa.
--
-- ---------------------------------------------------------------------------------------------
-- MỘT ĐIỀU FILE NÀY *KHÔNG* LÀM, VÀ VÌ SAO
-- ---------------------------------------------------------------------------------------------
-- Không có tiến trình nền nào tự quét rồi xoá. Một job như thế biến *"quá hạn ân hạn"* thành
-- *"đã bị phá huỷ"* mà không ai bấm gì cả — tức đúng cái nút-bấm-nhầm mà điều kiện ⑵ dựng ra để
-- đóng, chỉ khác là không có ngón tay nào trên nó. Hàm `rfq_khoa_du_dieu_kien_xoa()` trả về danh
-- sách ĐỦ ĐIỀU KIỆN; biến nó thành hành động vẫn là việc của một người có quyền `rfq.key.purge`.
--
-- ---------------------------------------------------------------------------------------------
-- GIỚI HẠN, NÓI RA THAY VÌ ĐỂ ĐỌC NHẦM
-- ---------------------------------------------------------------------------------------------
-- `UPDATE ... SET wrapped_private_key = NULL` xoá GIÁ TRỊ ở mức logic. Nó KHÔNG bảo đảm byte cũ
-- biến khỏi đĩa: Postgres viết một phiên bản hàng mới và bỏ lại hàng cũ cho `VACUUM`, còn WAL,
-- bản sao lưu và bản standby đều còn giữ. Bảo đảm mật mã THẬT chỉ đóng lại khi khoá chủ bọc nó
-- cũng bị huỷ ở KMS (`ADR-009`). Viết *"đã xoá mật mã"* mà không kèm câu này là nói rộng hơn thứ
-- file này làm được — và đó là lý do bản ghi kiểm toán ở tầng trên mang tên
-- `RFQ_KEY_MATERIAL_PURGED` chứ không phải `CRYPTO_ERASED`.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- (1) NÚM CHÍNH SÁCH
-- ---------------------------------------------------------------------------------------------
-- `NULL` = tổ chức này KHÔNG xoá mật mã. Xem điều kiện ⑶.
ALTER TABLE org_procurement_policies
  ADD COLUMN key_purge_grace_hours integer
    CHECK (key_purge_grace_hours IS NULL OR key_purge_grace_hours BETWEEN 0 AND 8760);

COMMENT ON COLUMN org_procurement_policies.key_purge_grace_hours IS
  'So gio ke tu luc THU HOI truoc khi vat lieu khoa duoc phep xoa. NULL = khong bao gio xoa; '
  '0 = xoa duoc ngay sau khi thu hoi (khac NULL, xem khoi dau file). '
  'Tran 8760 (mot nam): mot quang an han dai hon mot nam la mot cach viet khac cua NULL, va hai '
  'cach viet cho cung mot y nghia la mot cho de doc nham.';

-- ---------------------------------------------------------------------------------------------
-- (2) DẤU VẾT CỦA LẦN XOÁ
-- ---------------------------------------------------------------------------------------------
-- `wrapped_private_key` bỏ `NOT NULL`, và ràng buộc thay thế là một phép TƯƠNG ĐƯƠNG hai chiều:
-- cột rỗng KHI VÀ CHỈ KHI hàng đã được đánh dấu xoá. Không có trạng thái "rỗng mà không ai biết
-- vì sao", và cũng không có "đã xoá mà giá trị vẫn còn".
ALTER TABLE rfq_key_material ALTER COLUMN wrapped_private_key DROP NOT NULL;

ALTER TABLE rfq_key_material
  ADD COLUMN purged_at            timestamptz,
  ADD COLUMN purged_by            uuid,
  ADD COLUMN purged_by_session_id uuid,
  ADD CONSTRAINT rfq_key_material_xoa_dong_bo
    CHECK ((wrapped_private_key IS NULL) = (purged_at IS NOT NULL)),
  -- Cùng khuôn bốn cột thu hồi của `017`: danh tính đi theo cụm, không lẻ.
  ADD CONSTRAINT rfq_key_material_xoa_du_danh_tinh
    CHECK (num_nonnulls(purged_at, purged_by, purged_by_session_id) IN (0, 3)),
  ADD FOREIGN KEY (org_id, purged_by) REFERENCES users (org_id, id);

-- ---------------------------------------------------------------------------------------------
-- (3) QUYỀN
-- ---------------------------------------------------------------------------------------------
-- `app_api` chưa từng có `UPDATE` trên `wrapped_private_key` — `017` cố ý bỏ nó ra khỏi danh
-- sách, và khối đầu file ấy gọi sự vắng mặt đó là load-bearing. Nay nó được cấp, và điều kiện ⑷
-- của khối đầu file này là toàn bộ lý do việc ấy không mở lại lỗ mà `017` đã đóng.
GRANT UPDATE (wrapped_private_key, purged_at, purged_by, purged_by_session_id)
  ON rfq_key_material TO app_api;

-- Và ĐỌC ba cột dấu vết. `017` cấp `SELECT` theo TỪNG CỘT — một quyết định load-bearing của file
-- ấy — nên một cột mới KHÔNG tự nhiên đọc được, kể cả bởi chính hàm ở mục (4) dưới đây. Đã tự vấp
-- đúng chỗ này khi chạy bộ test: `rfq_khoa_du_dieu_kien_xoa()` không phải `SECURITY DEFINER`, nên
-- nó chạy dưới quyền người gọi và đổ với `permission denied for table rfq_key_material`.
--
-- Đây là mặt TỐT của cách cấp theo cột: một cột mới bắt đầu ở trạng thái KHÔNG AI ĐỌC ĐƯỢC, và
-- việc mở nó ra phải được viết thành một dòng có người đọc lại.
GRANT SELECT (purged_at, purged_by, purged_by_session_id) ON rfq_key_material TO app_api;

-- KHÔNG cấp gì thêm cho `app_unseal`. Nó ĐỌC được `wrapped_private_key` (đó là việc của nó), và
-- một tiến trình vừa đọc được bản rõ vừa xoá được nguồn của bản rõ là một tiến trình có thể xoá
-- dấu vết của chính mình.

INSERT INTO permissions (code, description) VALUES
  ('rfq.key.purge',
   'Xoa vat lieu khoa da thu hoi — khong dao nguoc duoc, va chi sau quang an han cua chinh sach');

-- Chỉ `PROCUREMENT_MANAGER`, cùng lập luận của `023`: vòng đời mật mã của gói thầu là một cụm.
-- `DIRECTOR` giữ `rfq.unseal.approve`; gộp cả quyền PHÁ HUỶ vào đó là đưa hai đầu của một cặp
-- kiểm soát về cùng một người.
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('PROCUREMENT_MANAGER', 'rfq.key.purge');

-- ---------------------------------------------------------------------------------------------
-- (4) ĐIỀU KIỆN ĐỦ, TÍNH Ở CSDL
-- ---------------------------------------------------------------------------------------------
-- Tính ở đây chứ không ở TypeScript vì cùng lý do `rfq_che_do_nghiem()` của `020` sống ở đây:
-- quãng ân hạn phải đo trên ĐỒNG HỒ CỦA CSDL, cùng đồng hồ đã ghi `revoked_at`. Đo bằng đồng hồ
-- của tiến trình ứng dụng là mời một lệch giờ vào giữa một quyết định không đảo ngược.
--
-- `clock_timestamp()` chứ không `now()`: `now()` đứng yên suốt giao dịch, nên trong một giao dịch
-- dài nó nói "chưa tới hạn" cho một hàng vừa tới hạn — cùng cạm bẫy đã ghim ở D1.
CREATE OR REPLACE FUNCTION public.rfq_khoa_du_dieu_kien_xoa(p_rfq_id uuid)
  RETURNS TABLE (key_material_id uuid, revoked_at timestamptz, du_dieu_kien boolean, ly_do text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_gio integer;
BEGIN
  SELECT p.key_purge_grace_hours INTO v_gio
    FROM org_procurement_policies p
    JOIN rfq_packages r ON r.org_id OPERATOR(pg_catalog.=) p.org_id
   WHERE r.id OPERATOR(pg_catalog.=) p_rfq_id
     AND p.effective_from OPERATOR(pg_catalog.<=) r.created_at
   ORDER BY p.effective_from DESC, p.version DESC
   LIMIT 1;

  RETURN QUERY
  SELECT k.id,
         k.revoked_at,
         CASE
           WHEN k.purged_at IS NOT NULL THEN false
           WHEN k.revoked_at IS NULL THEN false
           WHEN v_gio IS NULL THEN false
           ELSE clock_timestamp()
                OPERATOR(pg_catalog.>=) (k.revoked_at + make_interval(hours => v_gio))
         END,
         CASE
           WHEN k.purged_at IS NOT NULL THEN 'DA_XOA'
           WHEN k.revoked_at IS NULL THEN 'CHUA_THU_HOI'
           WHEN v_gio IS NULL THEN 'CHINH_SACH_TAT'
           WHEN clock_timestamp()
                OPERATOR(pg_catalog.<) (k.revoked_at + make_interval(hours => v_gio))
             THEN 'CON_TRONG_AN_HAN'
           ELSE 'DU_DIEU_KIEN'
         END
    FROM rfq_key_material k
   WHERE k.rfq_id OPERATOR(pg_catalog.=) p_rfq_id;
END
$ham$;

REVOKE EXECUTE ON FUNCTION public.rfq_khoa_du_dieu_kien_xoa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rfq_khoa_du_dieu_kien_xoa(uuid) TO app_api;

-- ---------------------------------------------------------------------------------------------
-- (5) BẤT BIẾN VIẾT LẠI — VÀ ĐÂY LÀ CHỖ BỐN ĐIỀU KIỆN ĐƯỢC CƯỠNG CHẾ
-- ---------------------------------------------------------------------------------------------
-- `017` cấm `wrapped_private_key` đổi giá trị, chấm hết. Bản này mở ĐÚNG một cửa và khoá bốn phía
-- của nó. Mọi vế còn lại của bản `017` giữ nguyên nguyên văn — hàm được thay TRỌN, nên chúng phải
-- có mặt lại ở đây, và một lần đọc lướt bỏ sót một vế là một lần mở lại một lỗ đã đóng.
CREATE OR REPLACE FUNCTION public.rfq_key_material_bat_bien() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_gio integer;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN
    RAISE EXCEPTION 'Khong duoc xoa vat lieu khoa cua RFQ (G2/G4)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_by_session_id IS DISTINCT FROM OLD.created_by_session_id THEN
    RAISE EXCEPTION 'Chi sua duoc bon cot thu hoi va ba cot xoa cua rfq_key_material'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Thu hồi là MỘT CHIỀU. Gỡ thu hồi là làm sống lại một khoá đã được tuyên là chết.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'Khong go duoc thu hoi cua vat lieu khoa'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Xoá cũng MỘT CHIỀU: đã xoá thì không hàng nào ở trên nó sửa được nữa.
  IF OLD.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vat lieu khoa da bi xoa — khong sua duoc nua'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.wrapped_private_key IS DISTINCT FROM OLD.wrapped_private_key THEN
    -- Điều kiện ⑷: hướng DUY NHẤT được phép là về NULL. Một giá trị mới khác NULL là một lần
    -- THAY KHOÁ nguỵ trang, và `app_api` không đọc được cột này nên nó cũng không kiểm chứng
    -- được mình đang thay bằng cái gì.
    IF NEW.wrapped_private_key IS NOT NULL THEN
      RAISE EXCEPTION 'Chi duoc xoa wrapped_private_key ve NULL, khong duoc thay gia tri khac'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.purged_at IS NULL THEN
      RAISE EXCEPTION 'Xoa wrapped_private_key phai di kem purged_at'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Điều kiện ⑴.
    IF OLD.revoked_at IS NULL THEN
      RAISE EXCEPTION 'Chi xoa duoc vat lieu khoa DA THU HOI'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Điều kiện ⑵ và ⑶, đọc lại từ chính sách chứ không tin lời người gọi.
    SELECT p.key_purge_grace_hours INTO v_gio
      FROM org_procurement_policies p
      JOIN rfq_packages r ON r.org_id OPERATOR(pg_catalog.=) p.org_id
     WHERE r.id OPERATOR(pg_catalog.=) OLD.rfq_id
       AND p.effective_from OPERATOR(pg_catalog.<=) r.created_at
     ORDER BY p.effective_from DESC, p.version DESC
     LIMIT 1;
    IF v_gio IS NULL THEN
      RAISE EXCEPTION 'Chinh sach cua to chuc KHONG bat xoa vat lieu khoa (key_purge_grace_hours NULL)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF clock_timestamp()
       OPERATOR(pg_catalog.<) (OLD.revoked_at + make_interval(hours => v_gio)) THEN
      RAISE EXCEPTION 'Con trong quang an han — chua xoa duoc vat lieu khoa'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
    -- Đánh dấu đã xoá mà không thật sự xoá là một câu nói dối trong chính bảng. `CHECK` ở (2) đã
    -- chặn, nhưng nói ra ở đây cho ra thông điệp đọc được thay vì một tên ràng buộc.
    RAISE EXCEPTION 'purged_at chi duoc dat CUNG LUC voi viec xoa wrapped_private_key'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- [ADR-016] Danh tính người xoá cũng là dẫn xuất, cùng khuôn `revoked_by` của `017`.
CREATE TRIGGER rfq_key_material_kiem_nguoi_xoa
  BEFORE UPDATE ON rfq_key_material
  FOR EACH ROW
  WHEN (NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL)
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('purged_by', 'purged_by_session_id');
