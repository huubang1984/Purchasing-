-- =============================================================================================
-- 043 — [review H6-4] MƯỜI CHÍN TRIGGER DANH TÍNH LÊN `ENABLE ALWAYS`
-- =============================================================================================
-- `kiem_danh_tinh_theo_phien` (013) canh một bất biến của chuỗi D: danh tính ghi vào một hàng
-- (`created_by`, `invited_by`, `requested_by`, `approver_user_id`, …) là DẪN XUẤT của một phiên
-- sống, không phải một lời khai của người gọi. Hai mươi mốt trigger gắn hàm ấy; hai cái của 040 đã
-- `ENABLE ALWAYS`, mười chín cái còn lại (013/014/016/017/019/022/026) ở trạng thái ORIGIN.
--
-- ORIGIN là trạng thái mà `session_replication_role = 'replica'` BỎ QUA. Dự án đã đo và ghi điều ấy
-- ba lần (003 §sổ kiểm toán, 004, 005) và đã dùng ALWAYS cho đúng lớp bất biến này ở 040. Cùng một
-- hàm, cùng một bất biến, hai độ mạnh khác nhau là một khoảng trống — và từ S1.14 nó còn tệ hơn một
-- khoảng trống: `hardening.always.sql` GHIM trạng thái ấy, nên một lần nâng lên ALWAYS bằng tay sẽ
-- bị `migrate()` HẠ xuống ORIGIN ở lần triển khai kế. File này đóng cả hai vế cùng lúc: nâng thật,
-- rồi bản ghim ở hardening đổi sang `'A'` (cùng commit).
--
-- Vì sao KHÔNG dừng ở "đó là khoảng trống của 013": kẻ đặt được `session_replication_role` chèn
-- thẳng vào `unseal_requests`, `unseal_approvals`, `rfq_key_material`, `rfq_packages` với người
-- thực hiện TỰ KHAI — tức phá đúng vế D2/D3 mà toàn bộ chuỗi phê duyệt kép dựa vào.
-- =============================================================================================

ALTER TABLE org_procurement_policies ENABLE ALWAYS TRIGGER org_procurement_policies_kiem_danh_tinh;
ALTER TABLE rfq_budgets ENABLE ALWAYS TRIGGER rfq_budgets_kiem_danh_tinh;
ALTER TABLE rfq_invitation_tokens ENABLE ALWAYS TRIGGER rfq_invitation_tokens_kiem_danh_tinh;
ALTER TABLE rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_kiem_danh_tinh;
ALTER TABLE rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_kiem_nguoi_thu_hoi;
ALTER TABLE rfq_items ENABLE ALWAYS TRIGGER rfq_items_kiem_danh_tinh;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_kiem_danh_tinh;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_kiem_nguoi_thu_hoi;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_kiem_nguoi_xoa;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_dong;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_huy;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_mo;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_nop;
ALTER TABLE supplier_contacts ENABLE ALWAYS TRIGGER supplier_contacts_kiem_danh_tinh;
ALTER TABLE suppliers ENABLE ALWAYS TRIGGER suppliers_kiem_danh_tinh;
ALTER TABLE unseal_approvals ENABLE ALWAYS TRIGGER unseal_approvals_kiem_danh_tinh;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_danh_tinh;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nguoi_dieu_phoi;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nhan_chung;
