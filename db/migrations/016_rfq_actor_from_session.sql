-- db/migrations/016_rfq_actor_from_session.sql
-- ADR-016 áp cho `packages/rfq` — HẠNG MỤC CÒN LẠI CÓ TÊN của lượt cài ngày 2026-08-30.
--
-- ============================================================================================
-- VÌ SAO FILE NÀY TỒN TẠI, VÀ NÓ LÀ MỘT LỜI TỰ SỬA
-- ============================================================================================
-- ADR-016 mục 3 viết rằng `SupplierActor`/`InvitationActor` phải đi theo đường mà `RfqActor` "đã
-- đi". Câu ấy SAI và đã bị gạch bỏ tại chỗ: thứ đi đúng đường ở vòng sửa S1.2 là **cột
-- `created_by`**, không phải `RfqActor`. Tám hàm export của `packages/rfq` tới trước file này VẪN
-- nhận `actor: RfqActor` — một object hai trường mà người gọi tự khai — rồi ghi thẳng nó vào sổ
-- kiểm toán.
--
-- Tức `packages/rfq` mang ĐÚNG khiếm khuyết mà MEDIUM-3 nêu cho `packages/supplier`. Nó không bị
-- lượt review nào gọi tên vì mỗi lượt chỉ nhìn MỘT hạng mục — và đó là một giới hạn của hình thức
-- review, đáng ghi hơn bản thân khiếm khuyết.
--
-- ============================================================================================
-- BỐN CHUYỂN TRẠNG THÁI ĐƯỢC KÝ TÊN — VÀ VÌ SAO ĐÓ KHÔNG PHẢI "GHI CHO ĐỦ"
-- ============================================================================================
-- `submitted_by`, `opened_by`, `closed_by`, `cancelled_by` không phải siêu dữ liệu trang trí. Ba
-- nguyên tắc bất khả xâm phạm của sản phẩm treo vào đúng bốn câu hỏi này:
--   * *Separation of Duties* (PRODUCT §4.1) — "không cá nhân nào kiểm soát trọn chuỗi tạo RFQ →
--     chọn NCC → mở thầu → award → duyệt". Không có `opened_by`, mệnh đề ấy KHÔNG kiểm được từ dữ
--     liệu, kể cả sau khi việc đã xảy ra.
--   * *Open ≠ Award* (§4.3) — mở thầu là một hành vi có chủ thể, không phải một sự kiện tự xảy ra.
--   * D3 hôm nay cưỡng chế trên **tập quyền**; nó không nói gì về **ai đã thật sự bấm nút**.
--
-- Thu hồi và mở thầu là UPDATE, không có hàng mới để treo trigger INSERT — nên `WHEN` giới hạn
-- phép kiểm đúng vào cạnh chuyển, cùng khuôn `rfq_invitations_kiem_nguoi_thu_hoi` của 013.
--
-- ============================================================================================
-- MỘT ĐƯỜNG CỐ Ý KHÔNG ĐƯỢC KÝ TÊN, GHI RA ĐỂ KHÔNG AI TƯỞNG LÀ QUÊN
-- ============================================================================================
-- `extendRfqDeadline` sửa `deadline_at` mà KHÔNG đổi `status`, nên nó không có cạnh nào để treo
-- một `WHEN`. Danh tính của nó vì vậy chỉ là dẫn xuất Ở TẦNG ỨNG DỤNG — trigger không thấy. Một
-- cột `deadline_changed_by` sẽ chỉ giữ được LẦN CUỐI, tức nó trả lời sai câu hỏi kiểm toán thật
-- ("deadline đã bị đẩy mấy lần, bởi ai"). Câu trả lời đúng cho câu hỏi ấy là sổ kiểm toán, và sổ
-- kiểm toán nay nhận danh tính đã dẫn xuất. Ghi ra vì đây là một phần chênh có thật giữa
-- `packages/rfq` và hai gói đã sửa ở 013.

-- ============================================================================================
-- (1) HẠNG MỤC RFQ — MỘT HÀNG MỚI, NÊN MỘT TRIGGER INSERT
-- ============================================================================================
ALTER TABLE rfq_items ADD COLUMN created_by uuid;
ALTER TABLE rfq_items ADD COLUMN created_by_session_id uuid;
ALTER TABLE rfq_items ADD CONSTRAINT rfq_items_created_by_fkey
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id);
GRANT INSERT (created_by, created_by_session_id) ON rfq_items TO app_api;

CREATE TRIGGER rfq_items_kiem_danh_tinh
  BEFORE INSERT ON rfq_items
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');

-- ============================================================================================
-- (2) BỐN CHỮ KÝ CỦA BỐN CẠNH CHUYỂN TRẠNG THÁI
-- ============================================================================================
ALTER TABLE rfq_packages ADD COLUMN submitted_by uuid;
ALTER TABLE rfq_packages ADD COLUMN submitted_by_session_id uuid;
ALTER TABLE rfq_packages ADD COLUMN opened_by uuid;
ALTER TABLE rfq_packages ADD COLUMN opened_by_session_id uuid;
ALTER TABLE rfq_packages ADD COLUMN closed_by uuid;
ALTER TABLE rfq_packages ADD COLUMN closed_by_session_id uuid;
ALTER TABLE rfq_packages ADD COLUMN cancelled_by uuid;
ALTER TABLE rfq_packages ADD COLUMN cancelled_by_session_id uuid;

ALTER TABLE rfq_packages ADD CONSTRAINT rfq_packages_submitted_by_fkey
  FOREIGN KEY (org_id, submitted_by) REFERENCES users (org_id, id);
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_packages_opened_by_fkey
  FOREIGN KEY (org_id, opened_by) REFERENCES users (org_id, id);
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_packages_closed_by_fkey
  FOREIGN KEY (org_id, closed_by) REFERENCES users (org_id, id);
ALTER TABLE rfq_packages ADD CONSTRAINT rfq_packages_cancelled_by_fkey
  FOREIGN KEY (org_id, cancelled_by) REFERENCES users (org_id, id);

GRANT UPDATE (submitted_by, submitted_by_session_id,
              opened_by, opened_by_session_id,
              closed_by, closed_by_session_id,
              cancelled_by, cancelled_by_session_id)
  ON rfq_packages TO app_api;

-- Bốn trigger, MỘT hàm — hàm chung của 013, đọc cột theo tên qua `to_jsonb(NEW)`. Bốn bản sao của
-- cùng một luật là đúng thứ đã hỏng hai lần ở 002.
CREATE TRIGGER rfq_packages_kiem_nguoi_nop
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status = 'PENDING_APPROVAL' AND OLD.status IS DISTINCT FROM 'PENDING_APPROVAL')
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('submitted_by', 'submitted_by_session_id');

CREATE TRIGGER rfq_packages_kiem_nguoi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status = 'OPEN' AND OLD.status IS DISTINCT FROM 'OPEN')
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('opened_by', 'opened_by_session_id');

CREATE TRIGGER rfq_packages_kiem_nguoi_dong
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED')
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('closed_by', 'closed_by_session_id');

CREATE TRIGGER rfq_packages_kiem_nguoi_huy
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
  EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('cancelled_by', 'cancelled_by_session_id');

-- ============================================================================================
-- (3) ĐIỀU FILE NÀY KHÔNG ĐÓNG
-- ============================================================================================
-- Bốn chữ ký trên nói AI ĐÃ BẤM, không nói NGƯỜI ẤY CÓ ĐƯỢC PHÉP. Cổng quyền vẫn nằm ở tầng ứng
-- dụng (ADR-016 mục 1) và vẫn là MẶC ĐỊNH MỞ cho tới khi có lớp canh route — thứ ADR-016 mục 4
-- ghim vào route đầu tiên của `apps/`.
--
-- Và chúng KHÔNG cưỡng chế Separation of Duties: không trigger nào ở đây cấm cùng một người vừa
-- tạo vừa mở. Cấm được điều đó là một quyết định CHÍNH SÁCH (có tổ chức nhỏ chỉ có một người mua)
-- và nó thuộc D3 — mệnh đề mà S1.6 phải đóng, không phải file này.
