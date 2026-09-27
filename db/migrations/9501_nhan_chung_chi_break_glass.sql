-- =============================================================================================
-- 9501 — [S1.9101 / khoản 215] CẶP NHÂN CHỨNG CHỈ ĐI VỚI YÊU CẦU BREAK-GLASS
-- =============================================================================================
-- ĐỌC (S1.100, lúc đóng khoản 209), ĐO ở vòng này: `requestUnseal` chặn ở tầng ứng dụng (*"Chỉ yêu cầu break-glass mới mang người
-- làm chứng"*), nhưng tầng CSDL thì không — `unseal_kiem_du_phe_duyet` (022) chỉ đọc hai cột nhân chứng trong nhánh
-- `IF NEW.break_glass`, và không ràng buộc nào nối `break_glass` với hai cột ấy. Một câu `INSERT` viết tay dưới `app_api` dựng được
-- một hàng `break_glass = false` mang nhân chứng, và từ `055` cặp ấy còn BẤT BIẾN. Không đặc quyền nào lấy được — đường thường vẫn
-- đòi đủ phê duyệt thật — nhưng hàng ấy nói SAI về đường nó đã đi: một lượt rà sau sự cố thấy một nhân chứng cho một yêu cầu chưa
-- từng cần nhân chứng. Cùng lớp khoản 208.
--
-- SỬA (chủ dự án chọn 2026-09-27): một `CHECK`. Nó ĐƯỢC KIỂM trên hàng CŨ lúc thêm (không `NOT VALID`): một cụm đã có hàng vi phạm
-- thì migration này DỪNG deploy — đúng hướng, vì hàng ấy là một bản ghi sai cần người đọc, không phải thứ để lặng lẽ bỏ qua.
-- Khai trong `CHECK_AN_NINH_KHAI` của `hardening.always.sql` (khoản 105) trong cùng commit.
-- =============================================================================================
ALTER TABLE unseal_requests ADD CONSTRAINT unseal_requests_nhan_chung_chi_break_glass
  CHECK (break_glass OR (break_glass_witness_user_id IS NULL AND break_glass_witness_session_id IS NULL));
