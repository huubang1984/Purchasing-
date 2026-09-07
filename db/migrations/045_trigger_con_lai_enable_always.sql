-- =============================================================================================
-- 045 — [sổ nợ 56] BA MƯƠI BẢY TRIGGER CÒN LẠI LÊN `ENABLE ALWAYS`
-- =============================================================================================
-- `043` nâng mười chín trigger danh tính vì ORIGIN là trạng thái mà `session_replication_role =
-- 'replica'` BỎ QUA, và vì `hardening.always.sql` ghim trạng thái ấy — nên một lần nâng bằng tay sẽ
-- bị `migrate()` HẠ xuống ở lần triển khai kế. File này áp đúng lập luận ấy cho phần còn lại, và nó
-- phải đi CÙNG COMMIT với các mục ghim của sổ nợ 56: ghim `'O'` là biến `migrate()` thành thứ hạ
-- cấp một trigger đã được nâng, ghim `'A'` mà không nâng thật là làm mọi lần `migrate()` phải sửa.
--
-- BA MƯƠI BẢY trigger, thuộc ba mươi lăm hàm mà sổ nợ 56 ghim thân trong cùng commit. Chúng canh
-- đúng những bất biến mà dự án đã dành trọn các ADR để bảo vệ: máy trạng thái RFQ và mở thầu
-- (`rfq_kiem_chuyen_trang_thai`, `unseal_kiem_chuyen_trang_thai`), phân tách nhiệm vụ D2
-- (`rfq_kiem_nguoi_duyet`, `unseal_kiem_nguoi_duyet`), append-only của báo giá (`bid_chi_ghi_them`),
-- tính bất biến của vật liệu khoá (`rfq_key_material_bat_bien`), và tính ĐƠN ĐIỆU của thu hồi
-- (`thu_hoi_don_dieu`). Một kẻ đặt được `session_replication_role` mà không có các trigger này sẽ
-- chuyển trạng thái RFQ tuỳ ý, tự duyệt yêu cầu của chính mình, sửa báo giá đã nộp và hồi sinh một
-- lời mời đã thu hồi — tức phá gần trọn phần CSDL của mô hình đe doạ.
--
-- BA TRIGGER trong nhóm ba mươi lăm hàm ấy ĐÃ `ALWAYS` từ trước (`user_roles_nguong_khong_cung_tay`,
-- `role_permissions_nguong_khong_cung_tay` — 033; `users_thu_hoi_phien_khi_dinh_chi` — 034) nên
-- chúng không có mặt ở đây; bản ghim vẫn đòi `'A'` cho cả ba, và đó là cùng một trạng thái.
--
-- KHÔNG CÓ VẾ NGƯỢC LẠI ĐÁNG KỂ: `ALWAYS` chỉ THÊM lần chạy trong chế độ replica, không đổi hành vi
-- của bất kỳ đường nào hôm nay (đã quét: không test nào, không mã sản phẩm nào đặt
-- `session_replication_role`). Và GUC ấy đòi superuser hoặc một `GRANT SET ON PARAMETER` mà `app_api`
-- không có — nên đây là hàng rào cho ca "người vận hành / tiến trình apply của logical replication",
-- không phải cho ca "app_api bị chiếm".
--
-- FILE NÀY KHÔNG PHẢI THỨ LÀM CHO TRẠNG THÁI CUỐI ĐÚNG, và nói ra vì đã ĐO: bỏ một câu ALTER khỏi
-- đây rồi chạy lại toàn bộ, trigger ấy VẪN về `'A'` — mục ghim của sổ nợ 56 thấy `tgenabled <> 'A'`,
-- DROP trigger rồi CREATE lại kèm `ENABLE ALWAYS`. Thứ file này mua là hình dạng của lần triển khai:
-- trên một cụm ĐANG CHẠY, không có nó thì lần `migrate()` kế DROP rồi CREATE lại bốn mươi mốt
-- trigger — trong đó có hai CONSTRAINT TRIGGER — thay vì đổi cờ tại chỗ. Cả hai đều nằm trong một
-- transaction nên không có cửa sổ nào hở ra ngoài, nhưng "đổi cờ" và "dựng lại" là hai thao tác
-- khác nhau khi đọc log, và cái rẻ hơn là cái đúng để viết ra. Vế thứ hai: một câu ALTER đọc được
-- trong một migration đánh số là thứ người review thấy; một lần DROP/CREATE trong thân một khối DO
-- của hardening thì không.
-- =============================================================================================

ALTER TABLE bid_receipts ENABLE ALWAYS TRIGGER bid_receipts_chi_ghi_them;
ALTER TABLE rfq_unsealed_bids ENABLE ALWAYS TRIGGER rfq_unsealed_bids_chi_ghi_them;
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_chi_ghi_them;
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER a_vendor_bid_versions_dat_so_phien_ban;
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_kiem_han_nop;
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_kiem_phien_khach;
ALTER TABLE vendor_bid_versions ENABLE ALWAYS TRIGGER vendor_bid_versions_phai_co_bien_nhan;
ALTER TABLE org_procurement_policies ENABLE ALWAYS TRIGGER org_procurement_policies_phien_ban_tang_dan;
ALTER TABLE guest_sessions ENABLE ALWAYS TRIGGER guest_sessions_kiem_danh_tinh;
ALTER TABLE rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_khong_song_lai;
ALTER TABLE invitation_otp_challenges ENABLE ALWAYS TRIGGER invitation_otp_go_khoa_khong_xoa_dau_vet;
ALTER TABLE invitation_otp_challenges ENABLE ALWAYS TRIGGER invitation_otp_kiem_kenh;
ALTER TABLE rfq_budgets ENABLE ALWAYS TRIGGER rfq_budgets_chi_sua_khi_soan;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_gia_han_khong_hoi_sinh;
ALTER TABLE rfq_items ENABLE ALWAYS TRIGGER rfq_items_cam_truncate;
ALTER TABLE rfq_items ENABLE ALWAYS TRIGGER rfq_items_chi_sua_khi_soan;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_bat_bien;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_chi_sinh_luc_mo;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_chi_thu_hoi_khi_huy;
ALTER TABLE rfq_key_material ENABLE ALWAYS TRIGGER rfq_key_material_phai_di_kem_lan_mo;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_chuyen_trang_thai;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_khoa_khi_mo;
ALTER TABLE rfq_approvals ENABLE ALWAYS TRIGGER rfq_approvals_kiem_nguoi_duyet;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguoi_tao;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep;
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_yeu_cau_mo_thau;
ALTER TABLE guest_sessions ENABLE ALWAYS TRIGGER guest_sessions_thu_hoi_don_dieu;
ALTER TABLE invitation_otp_challenges ENABLE ALWAYS TRIGGER invitation_otp_thu_hoi_don_dieu;
ALTER TABLE rfq_invitation_tokens ENABLE ALWAYS TRIGGER rfq_invitation_tokens_thu_hoi_don_dieu;
ALTER TABLE rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_thu_hoi_don_dieu;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_canh_bao_break_glass;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_dieu_phoi_mot_lan;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_chuyen_trang_thai;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_du_phe_duyet;
ALTER TABLE unseal_approvals ENABLE ALWAYS TRIGGER unseal_approvals_kiem_nguoi_duyet;
ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_rfq_da_dong;
ALTER TABLE rfq_unsealed_bids ENABLE ALWAYS TRIGGER rfq_unsealed_bids_kiem_yeu_cau;
