-- =============================================================================================
-- 047 — [S1.20 / sổ nợ 16] BA BẢNG CHỈ-GHI-THÊM CỦA S1 CHẶN CẢ `TRUNCATE`
-- =============================================================================================
-- ĐO ĐƯỢC TRƯỚC KHI VIẾT FILE NÀY, trên PostgreSQL 16, sau một lượt `migrate()` sạch:
--
--     TRUNCATE public.audit_events        -> NÉM  ("bảng chỉ-ghi-thêm ... bị từ chối")
--     TRUNCATE public.bid_receipts        -> **OK**
--     TRUNCATE public.rfq_unsealed_bids   -> **OK**
--     TRUNCATE public.vendor_bid_versions -> **OK**
--
-- Ba trigger của 018/019 là `BEFORE DELETE OR UPDATE FOR EACH ROW` (tgtype 27). `TRUNCATE` không
-- phải DELETE: nó là một thao tác CẤP CÂU LỆNH, và một trigger cấp HÀNG không bao giờ chạy cho nó.
-- Bảng sổ có hẳn một trigger TRUNCATE riêng từ 003 vì đúng lý do ấy; ba bảng của S1 ra đời sau và
-- không ai chép vế thứ ba sang.
--
-- HẬU QUẢ, nói bằng tên bất biến chứ không bằng tên bảng: **B1** (*"Mỗi lần nộp tạo version mới;
-- không UPDATE, không DELETE"*) và **B2** (*"Mỗi lần nộp sinh biên nhận ... nhà cung cấp kiểm
-- chứng độc lập được"*) đều đang ✅ trong `evidence/INV-matrix.md`, với 10 và 25 khẳng định. Một
-- câu lệnh xoá sạch mọi phiên bản báo giá, mọi biên nhận, và mọi giá đã mở — và không lớp nào kêu.
--
-- AI LÀM ĐƯỢC, nói cho hết: `TRUNCATE` đòi quyền TRUNCATE hoặc quyền SỞ HỮU. `app_api` và
-- `app_unseal` không có. Đã đo, và hai cột catalog phải gọi đúng tên vì chúng KHÁC nhau:
-- `relacl` của ba bảng chỉ mang `r` (SELECT mức bảng), còn `018:113-117`/`342-343` và
-- `019:459-465` cấp INSERT **theo CỘT** nên chúng nằm ở `pg_attribute.attacl` (`a`, cộng `r`).
-- Không một quyền UPDATE/DELETE/TRUNCATE nào ở cả hai chỗ. Nên đây là hàng rào cho
-- ĐÚNG mô hình đe doạ mà 003 đã viết ra khi nó thêm trigger TRUNCATE cho bảng sổ — người vận hành,
-- role deploy, và cửa sổ phơi mà chính 003 thừa nhận (`DISABLE TRIGGER`). Lập luận *"ACL đã đủ"*
-- đã được dự án cân nhắc và BÁC ở 003; file này chỉ áp cùng kết luận cho ba bảng ra đời sau.
--
-- VÌ SAO ĐỊNH NGHĨA LẠI `bid_chi_ghi_them()` THAY VÌ DÙNG `chan_sua_xoa()`:
-- `chan_sua_xoa()` có sẵn thông điệp theo `TG_OP` và đã được ghim, nên nó là lựa chọn đầu tiên.
-- Nhưng vế "bảng lạ" của `bang_al` trong `hardening.always.sql` nhận bảng theo **OID của
-- `chan_sua_xoa`** — cắm hàm ấy lên ba bảng này đưa chúng vào `can_co`, và `can_co` đòi ĐỦ BỘ BA
-- `<bảng>_chan_update` / `_chan_delete` / `_chan_truncate`. Ba tên ấy không tồn tại (tên thật là
-- `_chi_ghi_them`), nên `migrate()` sẽ BÁO LỖI trên một lược đồ HỢP LỆ — đúng cái bẫy [CR4]/QT1
-- mà file hardening đã phải gỡ hai lần. Chi phí của lựa chọn này là một thân hàm đổi và một mục
-- ghim phải trỏ sang `047`; cái giá kia là một lần chặn deploy.
--
-- THÂN HÀM ĐỔI Ở ĐÚNG MỘT CHỖ: thông điệp nay đọc `TG_OP` thay vì kể cứng *"khong UPDATE, khong
-- DELETE"* — một câu sẽ SAI ngay khi trigger TRUNCATE bên dưới bắt đầu gọi nó. Không vế điều kiện
-- nào được thêm hay bớt: hàm vẫn NÉM vô điều kiện, nên vị từ *"hàm trigger không có `RETURN` nào"*
-- (S1.20, `db/hardening-suy-tu-tinh-chat.int.test.ts`) vẫn nhận đúng ba bảng này.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.bid_chi_ghi_them() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$
BEGIN
  RAISE EXCEPTION 'Bang % chi duoc ghi them: thao tac % bi tu choi (B1, B2)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END
$ham$;

-- `FOR EACH STATEMENT` là bắt buộc: PostgreSQL không cho trigger TRUNCATE ở cấp hàng. `ENABLE
-- ALWAYS` đi cùng lúc — `session_replication_role = 'replica'` BỎ QUA trigger ORIGIN.
--
-- ~~và `hardening.always.sql` ghim `tgenabled = 'A'` cho mọi trigger trong `public` (045, sổ nợ 56).~~
-- **[review lượt 12, L1] Câu vừa gạch RỘNG HƠN thực tế, và trong file này một câu như thế là một
-- khoản nợ.** `hardening.always.sql` ghim `tgenabled='A'` cho một tập trigger **được LIỆT KÊ theo
-- tên** (mục ghim của nó tự viết *"cho cả 41 trigger"*), không cho mọi trigger trong `public`. Lý
-- do đúng để ba dòng `ENABLE ALWAYS` dưới đây được canh là: **ba trigger này có tên trong mục ghim
-- `hàm + trigger bid_chi_ghi_them (047)`**, và hậu điều kiện của mục ấy đòi `tgenabled = 'A'` cho
-- từng cái. Một trigger cắm trên bảng `public` mà KHÔNG có tên trong một mục ghim thì không ai
-- canh trạng thái ALWAYS của nó — đó là một bậc tự do có thật, không phải một câu đã đóng.
--
-- `DROP TRIGGER IF EXISTS` đứng trước mỗi `CREATE`: file đánh số chỉ chạy một lần qua
-- `schema_migrations`, nhưng nếu hàng ấy bị xoá (khôi phục một phần, dựng lại môi trường) thì
-- `CREATE TRIGGER` trần sẽ vỡ với "trigger already exists". Mục ghim trong hardening đã dùng đúng
-- khuôn này; chép sang đây rẻ hơn một lần deploy hỏng.
DROP TRIGGER IF EXISTS vendor_bid_versions_chan_truncate ON vendor_bid_versions;
CREATE TRIGGER vendor_bid_versions_chan_truncate
  BEFORE TRUNCATE ON vendor_bid_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_chan_truncate;

DROP TRIGGER IF EXISTS bid_receipts_chan_truncate ON bid_receipts;
CREATE TRIGGER bid_receipts_chan_truncate
  BEFORE TRUNCATE ON bid_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE bid_receipts ENABLE ALWAYS TRIGGER bid_receipts_chan_truncate;

DROP TRIGGER IF EXISTS rfq_unsealed_bids_chan_truncate ON rfq_unsealed_bids;
CREATE TRIGGER rfq_unsealed_bids_chan_truncate
  BEFORE TRUNCATE ON rfq_unsealed_bids
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_unsealed_bids ENABLE ALWAYS TRIGGER rfq_unsealed_bids_chan_truncate;
