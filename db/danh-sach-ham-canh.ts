// ==============================================================================================
// [S1.9191 / khoản 221] HAI DANH SÁCH KHAI BÁO HÀM TRIGGER — MỘT NGUỒN, HAI LỚP ĐỌC
//
// Hai hằng dưới đây từng là hằng NỘI BỘ của `db/hardening-suy-tu-tinh-chat.int.test.ts` (S1.29,
// khoản nợ 60): tổng điều tra ở đó đòi mỗi hàm trigger trong tập rộng phải nằm trong ĐÚNG MỘT danh
// sách, và đó là lớp có thẩm quyền — nó đọc catalog PostgreSQL thật. Nhưng cổng duy nhất là
// `pnpm test:int`, và một bảng tenant mới mang trigger đi qua `pnpm t0` + `pnpm test` xanh trọn
// (khoản 221, đo ở S1.105 trên chính `057`). Nay `db/migration-shape.test.ts` vế ⑷ đọc CÙNG hai
// danh sách này trên VĂN BẢN migration — không CSDL — để một hàm `RETURNS trigger` chưa khai đỏ
// ngay ở T1. Tách ra một module không-int để hai tệp test import cùng một nguồn: hai bản chép của
// một danh sách là đúng thứ sẽ trôi khỏi nhau.
//
// Nội dung hai danh sách và chú thích từng dòng giữ NGUYÊN VĂN từ tệp int (kể cả các con trỏ
// `dungKichBan()`, vốn nói về nhân chứng hành vi ở tệp ấy). Phân loại một hàm là ĐÚNG hay SAI vẫn
// do tệp int phán xét; module này chỉ là chỗ ở của lời khai.
// ==============================================================================================

/**
 * [S1.29, khoản nợ 60] Danh sách KHAI BÁO hàm canh — vế thứ hai của vị từ dưới đây. Tên KHÔNG mang
 * lược đồ vì vị từ ghim `pronamespace = public`; tổng điều tra thì định danh theo `lược đồ.tên`.
 * Bất kỳ tên nào thêm vào đây phải xuất hiện NGUYÊN VĂN trong `hardening.always.sql` (cổng ở test
 * đầu tiên), nên một hàm canh mới là một sửa đổi ở CẢ hai tệp — cố ý.
 */
export const HAM_CANH_CHI_GHI_THEM: readonly string[] = ["bid_chi_ghi_them", "chan_sua_xoa"];

/**
 * Hàm trigger GHI (INSERT/UPDATE/DELETE, mọi hình thức) **không** phải hàm canh chỉ-ghi-thêm: chúng từ chối CÓ
 * ĐIỀU KIỆN (máy trạng thái, kiểm quyền, bất biến cột), nên bảng mang chúng vẫn sửa/xoá được ở
 * những đường hợp lệ. Đo tại `bebeb41`.
 */
export const HAM_KHONG_PHAI_CANH: readonly string[] = [
  "public.kiem_danh_tinh_theo_phien",
  // [S1.32] ~~Mười chín~~ **[S1.105]** HAI MƯƠI hàm chỉ gắn INSERT vào tập rộng khi tập ấy mở ra bit 4.
  // Chúng không thể là hàm canh chỉ-ghi-thêm (không gắn UPDATE/DELETE); khai ở đây để một hàm INSERT mới
  // không đi vào lặng lẽ.
  "public.bid_dat_so_phien_ban",
  "public.bid_kiem_han_nop",
  "public.bid_kiem_phien_khach",
  // [S1.108 / 059] Vế top-N của vòng BAFO: nó đọc `NEW.bafo_round_id` mà C1 vừa đặt và RAISE khi
  // luồng báo giá không nằm trong top-N của lượt đánh giá mà vòng trỏ tới. Một hàng HỢP LỆ đi qua
  // nó (mọi lần nộp vòng MỘT, vì `bafo_round_id IS NULL` thì nó trả `NEW` ngay), nên nó đòi một
  // nhân chứng hành vi cho INSERT — `dungKichBan()` đã nộp báo giá thật.
  "public.bid_kiem_vong_bafo",
  // [S1.110 / S2.6 / 061] BA hàm cưỡng chế của trao thầu — **J3 · J5 · J7**. Cả ba chỉ gắn
  // INSERT, nên chúng KHÔNG thể là hàm canh chỉ-ghi-thêm (một bảng vẫn sửa được nếu chỉ có
  // chúng); thứ giữ hai bảng ấy chỉ-ghi-thêm là `bid_chi_ghi_them`. Một hàng HỢP LỆ đi qua
  // cả ba, nên cả ba đòi một nhân chứng hành vi — `dungKichBan()` dựng một chuỗi trao thầu
  // thật ở cuối kịch bản, với BA con người khác nhau vì J3 đòi đúng thế.
  "public.award_kiem_de_xuat",
  "public.award_kiem_mot_award_song",
  "public.award_kiem_nguoi_duyet",
  "public.bid_phai_co_bien_nhan",
  // [S1.156 / S3.1a / `069_bac_va_chu_ky_chinh_sach`] BA hàm INSERT của bậc và chữ ký thứ hai: hình dạng `tiers`, *đã bật thì
  // phải có bậc* (ADR-080), phân tách nhiệm vụ của người ký (ADR-082 ⑺). Chỉ gắn INSERT ⇒ không thể là
  // hàm canh; một hàng HỢP LỆ đi qua cả ba — `dungKichBan()` chèn phiên bản 2 có bậc rồi ký nó.
  "public.chinh_sach_da_bat_thi_phai_co_bac",
  "public.chinh_sach_kiem_bac",
  "public.chinh_sach_kiem_nguoi_ky",
  "public.chinh_sach_phien_ban_tang_dan",
  "public.chot_moc_neo",
  // [S1.192 / S4.1 / L1 / `079_don_vi_do`] Hàm trigger khuôn của MỌI bảng dữ liệu nền: BEFORE INSERT, lấy khoá tư vấn rồi ĐẶT
  // `seq` và `ghi_luc` — không bao giờ từ chối. Chỉ gắn INSERT ⇒ không thể là hàm canh; thứ giữ bảng chỉ-ghi-thêm là
  // `bid_chi_ghi_them`. Nhân chứng: câu khai bí danh cuối `dungKichBan()`.
  "public.du_lieu_nen_dat_thu_tu",
  "public.guest_session_kiem_danh_tinh",
  // [S1.105 / 057] Vế NỘI DUNG của J1: nó so tập `(ma, đơn vị)` của `components` với tập mà phiên bản
  // chính sách đã ghim, và RAISE khi lệch. Một hàng HỢP LỆ đi qua nó, nên nó đòi một nhân chứng hành vi
  // — `dungKichBan()` dựng một lượt chấm thật ở cuối kịch bản.
  "public.kiem_thanh_phan_theo_chinh_sach",
  // [S1.201 / S3.6a] Luật người của nhóm hàng, và luật người + chiều đổi + thứ tự dưới khoá của lần đổi trạng thái. Chỉ gắn
  // INSERT ⇒ không thể là hàm canh; một hàng HỢP LỆ đi qua cả hai — `dungKichBan()` dựng một nhóm hàng rồi ngừng dùng nó.
  "public.nhom_hang_kiem_doi",
  "public.nhom_hang_kiem_nguoi_tao",
  "public.noi_chuoi_kiem_toan",
  "public.otp_kiem_kenh_khac_link",
  "public.rfq_khoa_chi_sinh_luc_mo",
  "public.rfq_khoa_phai_di_kem_lan_mo",
  "public.rfq_kiem_nguoi_duyet",
  "public.rfq_kiem_nguoi_tao",
  "public.sessions_kiem_mfa_khi_tao",
  "public.sessions_kiem_totp_gan_day",
  "public.unseal_canh_bao_break_glass",
  "public.unseal_kiem_nguoi_duyet",
  "public.unseal_kiem_rfq_da_dong",
  "public.unseal_kiem_yeu_cau_khi_ghi_ban_ro",
  // [S1.31] Khối dưới là 20 hàm BEFORE-ROW UPDATE/DELETE của S1.29 CỘNG 5 hàm AFTER-ROW UPDATE vào tập rộng
  // khi tập ấy thôi khoá theo hình thức BEFORE-ROW (kiem_tra_*, users_thu_hoi_phien_khi_dinh_chi), sắp theo tên.
  // [lượt soi 25b #5] Chú thích cũ nói "năm hàm" đứng đầu một khối 25 tên.
  "public.kiem_tra_ma_tran_quyen",
  "public.kiem_tra_nguong_khong_cung_tay_nguoi_dung",
  "public.kiem_tra_nguong_khong_cung_tay_vai_tro",
  // [S1.197 / S4.2a / L3 / `083_hang_chuan`] Khuôn `033` cho người đặt thước dữ liệu: AFTER ROW, từ chối CÓ ĐIỀU KIỆN — chỉ khi một
  // vai/một người giữ `item.manage` cùng một mã thấy giá. Nhân chứng: mọi câu ghi `user_roles`/`role_permissions` của kịch bản.
  "public.kiem_tra_quan_ly_du_lieu_mu_gia_nguoi_dung",
  "public.kiem_tra_quan_ly_du_lieu_mu_gia_vai_tro",
  // [S1.197 / S4.2a / L3] Cổng GHI của dữ liệu nền — BEFORE INSERT, từ chối CÓ ĐIỀU KIỆN (người ghi không giữ `item.manage`).
  // Nhân chứng: năm câu chèn dữ liệu nền cuối `dungKichBan()`, dưới một `DATA_STEWARD`.
  "public.du_lieu_nen_kiem_quyen_ghi",
  "public.kiem_tra_phan_tach_nhiem_vu",
  "public.loi_moi_khong_song_lai",
  "public.mfa_credentials_khoa_ho_so_da_xac_nhan",
  "public.mfa_credentials_xoa_can_yeu_cau",
  "public.mfa_reset_kiem_chuyen_trang_thai",
  "public.mfa_reset_kiem_quyen",
  // [S1.156 / S3.1a / `069_bac_va_chu_ky_chinh_sach`] BEFORE INSERT OR UPDATE trên `rfq_budgets`: từ chối CÓ ĐIỀU KIỆN — chỉ khi
  // ngân sách ghim một phiên bản có bậc CHƯA KÝ. Câu chèn và câu sửa ngân sách của `dungKichBan()` ghim
  // phiên bản 1 (không bậc) nên đi qua: hai nhân chứng.
  "public.ngan_sach_khong_ghim_ban_chua_ky",
  // [S1.166 / S3.1b / `072_bac_cua_goi`] BEFORE INSERT OR UPDATE trên `rfq_budgets`: ĐẶT `tier_tu_so_tien` từ `rfq_bac_cua`,
  // và từ chối CÓ ĐIỀU KIỆN — chỉ khi tiền tệ lệch một phiên bản có bậc. Câu chèn và câu sửa ngân sách của
  // `dungKichBan()` ghim phiên bản 1 (không bậc) nên đi qua: hai nhân chứng.
  "public.ngan_sach_xep_bac",
  "public.otp_go_khoa_khong_xoa_dau_vet",
  "public.outbox_jobs_xoa_payload_dang_nhap",
  // [S1.108 / 059] Ba nhánh trong một hàm: INSERT (một vòng hợp lệ), UPDATE (chỉ `closed_at`, chỉ
  // một chiều), DELETE (từ chối vô điều kiện). Nhánh DELETE một mình sẽ làm nó là hàm CANH, nhưng
  // nhánh UPDATE từ chối CÓ ĐIỀU KIỆN — một câu `SET closed_at = now()` hợp lệ đi qua — nên bảng
  // vẫn sửa được ở đường hợp lệ và nó thuộc danh sách này.
  "public.bafo_kiem_vong",
  "public.rfq_budgets_chi_sua_khi_soan",
  "public.rfq_gia_han_khong_hoi_sinh",
  "public.rfq_items_chi_sua_khi_soan",
  "public.rfq_key_material_bat_bien",
  "public.rfq_khoa_chi_thu_hoi_khi_huy",
  "public.rfq_kiem_chuyen_trang_thai",
  "public.rfq_kiem_khoa_khi_mo",
  // [S1.166 / S3.1b / K1] BEFORE UPDATE `WHEN` cạnh DRAFT→PENDING_APPROVAL: từ chối CÓ ĐIỀU KIỆN — chỉ ở tổ chức đã
  // bật S3 mà ngân sách thiếu, ghim bản cũ hay lệch bậc. Câu nộp duyệt của `dungKichBan()` đi qua: một nhân chứng.
  "public.rfq_kiem_ngan_sach_khi_nop",
  // [S1.185 / S3.2a / K4a · K4b · K6 / `076_danh_sach_moi`] BỐN hàm của danh sách mời, từ chối CÓ ĐIỀU KIỆN — chỉ ở tổ
  // chức đã bật S3, và `rfq_approvals_dat_bam_danh_sach` không bao giờ từ chối (nó ĐẶT băm). Tổ chức của `dungKichBan()`
  // chỉ bật ở câu ký cuối kịch bản, nên câu duyệt, câu mở gói, câu mời, câu thu hồi lời mời và câu đúc token của nó đều
  // đi qua cả bốn: năm nhân chứng.
  "public.rfq_approvals_dat_bam_danh_sach",
  "public.rfq_invitation_tokens_kiem_goi_da_mo",
  "public.rfq_invitations_kiem_danh_sach",
  "public.rfq_kiem_chu_ky_danh_sach_khi_mo",
  // [S1.186 / S3.2b1 / K4a · K6 / `077_tra_ve_nhap`] HAI hàm: cạnh về DRAFT từ chối CÓ ĐIỀU KIỆN — chỉ ở tổ chức chưa bật —, và
  // `rfq_invitation_tokens_ghi_goi_da_mo` không bao giờ từ chối (nó GHI cột). `dungKichBan()` nộp một gói trước lần bật rồi
  // trả nó về DRAFT sau lần bật; câu đúc token của nó đi qua hàm thứ hai: hai nhân chứng.
  "public.rfq_invitation_tokens_ghi_goi_da_mo",
  "public.rfq_kiem_tra_ve_nhap",
  // [S1.201 / S3.6a] HAI hàm của nhóm hàng trên `rfq_packages`, từ chối CÓ ĐIỀU KIỆN: `rfq_kiem_nhom_hang` (INSERT, và UPDATE cột
  // nhóm hàng) chỉ khi gói đã rời DRAFT hay nhóm đã ngừng dùng; `rfq_kiem_nhom_hang_khi_nop` (cạnh nộp duyệt) chỉ ở tổ chức đã
  // bật mà gói không nhóm hàng. Mọi câu dựng gói, câu gán nhóm và câu nộp duyệt của `dungKichBan()` đi qua.
  "public.rfq_kiem_nhom_hang",
  "public.rfq_kiem_nhom_hang_khi_nop",
  "public.rfq_kiem_nguong_phe_duyet_kep",
  "public.rfq_kiem_yeu_cau_mo_thau",
  "public.thu_hoi_don_dieu",
  "public.unseal_dieu_phoi_mot_lan",
  // [S1.129 / khoản 233 / 064] AFTER-ROW UPDATE, không bao giờ từ chối: nó GHI THÊM một hàng lịch
  // sử khi cặp người-phiên điều phối đổi. Câu điều phối của `dungKichBan()` là nhân chứng hành vi.
  "public.unseal_ghi_lich_su_dieu_phoi",
  "public.unseal_kiem_chuyen_trang_thai",
  "public.unseal_kiem_du_phe_duyet",
  "public.users_thu_hoi_phien_khi_dinh_chi",
];
