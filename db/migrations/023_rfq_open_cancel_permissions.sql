-- db/migrations/023_rfq_open_cancel_permissions.sql
-- KHOẢN NỢ 31 — HAI MÃ QUYỀN MÀ SỰ VẮNG MẶT CỦA CHÚNG LÀM MỘT CÂU LỆNH KHÔNG VIẾT ĐƯỢC
--
-- ============================================================================================
-- KHIẾM KHUYẾT, NÓI THẲNG
-- ============================================================================================
-- `openRfq` và `cancelRfq` xác lập *ai* (`resolveSessionActor`) và *tổ chức nào*
-- (`assertTenantBound`) rồi làm việc — không hỏi *người ấy có được phép không*.
--
-- Vế HUỶ là vế nặng: `cancelRfq` thu hồi TOÀN BỘ vật liệu khoá của RFQ; 017 cấm bỏ dấu thu hồi;
-- worker lọc `revoked_at IS NULL`. Nên bất kỳ phiên hợp lệ nào của tổ chức — kể cả một vai không
-- có một quyền RFQ nào — làm cho báo giá của một RFQ VĨNH VIỄN không mở được, bằng một lời gọi.
--
-- Đây KHÔNG phải khoảng trống *"tầng ứng dụng chưa có"*: `packages/unseal` cùng nhánh GỌI
-- `requirePermission` bên trong gói. Thứ chặn là DANH MỤC: `permissions` không có `rfq.open` và
-- không có `rfq.cancel`, nên câu kiểm quyền ấy không viết ra được.
--
-- ============================================================================================
-- VÌ SAO CHỈ `PROCUREMENT_MANAGER`, VÀ VÌ SAO **KHÔNG** CHO `BUYER`
-- ============================================================================================
-- `BUYER` giữ `rfq.create` và `rfq.invite` — soạn thảo và mời. Mở RFQ thì ĐÚC cặp khoá của nó
-- (C5), và huỷ RFQ thì THU HỒI cặp khoá ấy không đảo ngược được. Hai hành vi ấy nằm ở vòng đời
-- MẬT MÃ của gói thầu, không ở vòng đời soạn thảo.
--
-- Vai trò đã giữ `rfq.approve` — cái cổng quyết định RFQ có được ra ngoài hay không — là vai trò
-- đúng để cũng giữ hai mã này. Kết quả là một phép tách có thật: `BUYER` soạn được và mời được,
-- nhưng KHÔNG tự mở được gói thầu mình soạn, và KHÔNG giết được một gói thầu đang chạy.
--
-- `DIRECTOR` cố ý KHÔNG được cấp. `DIRECTOR` là vai phê duyệt MỞ THẦU (`rfq.unseal.approve`), và
-- cho nó thêm quyền mở/huỷ chính gói thầu ấy là gộp hai đầu của một cặp kiểm soát vào một tay.
--
-- ============================================================================================
-- HAI MỐC GHIM SẼ ĐỎ VÌ FILE NÀY, VÀ ĐỎ LÀ ĐÚNG
-- ============================================================================================
-- `packages/identity/src/ma-tran-quyen.test.ts` có hai phép ghim đọc **DUY NHẤT văn bản của
-- 005**: một cho danh mục `permissions`, một cấm mọi migration khác ghi vào `role_permissions`.
-- Phép ghim thứ hai tự viết ra mục đích của nó — *"biến việc đó thành một lần ĐỎ Ở CI, buộc tác
-- giả tính lại mốc ghim"*.
--
-- Nó đã làm đúng việc của nó. Cách đóng KHÔNG phải là thêm một ngoại lệ tên `023`: hai phép ghim
-- ấy được viết lại để đọc **MỌI** migration theo TÍNH CHẤT, nên một migration `0nn` tương lai
-- cũng tự rơi vào phạm vi — thay vì phải nhớ thêm tên nó vào một danh sách.

INSERT INTO permissions (code, description) VALUES
  ('rfq.open',   'Mở RFQ cho nhà cung cấp báo giá — hành vi ĐÚC cặp khoá của gói thầu'),
  ('rfq.cancel', 'Huỷ RFQ — hành vi THU HỒI cặp khoá, không đảo ngược được');

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('PROCUREMENT_MANAGER', 'rfq.open'),
  ('PROCUREMENT_MANAGER', 'rfq.cancel');
