// ==============================================================================================
// [S1.9101 / S3.9b / K12] BẢNG PHÂN LOẠI LỜI TỪ CHỐI — dữ liệu của `db/dieu-tra-k12.int.test.ts`
//
// Mỗi chỗ `RAISE` mức EXCEPTION trong thân cuối của mọi hàm thuộc ĐÚNG MỘT lớp. Tên ràng buộc có trong `CHOT_THEO_RANG_BUOC` không
// có dòng ở đây (lớp THEO_TEN, vế vào sổ là `CHOT_VAO_SO`). Dòng không tên khoá theo (hàm, errcode) và đếm số câu: một câu mới cùng
// khoá làm phép đếm lệch, và người viết phải phân loại lại. Lớp và lý do đọc từ mã lúc viết (ba lượt tra chỉ đọc, kiểm lại từng
// khoảng trống — biên bản §S1.9101); khi một nhóm gom nhánh khác lớp, lý do nói nhánh khác ấy.
//
// Lớp (xem đầu tệp test): HOI_TRUOC — tầng ứng dụng hỏi trước và từ chối ở đó, câu RAISE là lớp chặn cuối; SO_RIENG — tầng gói bắt
// CHÍNH lỗi theo tên và ghi một hàng sổ của riêng nó (`BID_STATE_DENIED`, `BID_DEADLINE_DENIED`, `UNSEAL_NOT_FOUND_DENIED`);
// KHONG_VAO_SO — dữ liệu / cấu hình (ADR-060); BAT_BIEN — không đường hợp lệ nào tới được trừ câu SQL thô; KHOANG_TRONG — người dùng
// đi tắt một chốt mà không để hàng sổ: khoảng trống ĐÃ GỌI TÊN, mỗi dòng trỏ khoản nợ (chủ dự án chốt 2026-10-11: ghi nợ, sửa vòng
// riêng).
// ==============================================================================================

export type LopTay = "HOI_TRUOC" | "SO_RIENG" | "KHONG_VAO_SO" | "BAT_BIEN" | "KHOANG_TRONG";

/** Tên ràng buộc tĩnh NGOÀI `CHOT_THEO_RANG_BUOC`, khoá (tên, hàm), `so` là số câu mang tên ấy trong thân cuối của hàm ấy. */
export interface DongTen {
  readonly ten: string;
  readonly ham: string;
  readonly so: number;
  readonly lop: LopTay;
  readonly lyDo: string;
}

/** Chỗ mang một tên CỦA `CHOT_THEO_RANG_BUOC` — lớp THEO_TEN; `batBoi` là tệp gói bắt tên ấy. */
export interface DongTheoTen {
  readonly ten: string;
  readonly ham: string;
  readonly so: number;
  readonly batBoi: string;
}

/**
 * Tên động (`CONSTRAINT = lower(<biến>)`): mọi phép gán cho biến là lời gọi một hàm vị từ ở `viTu`, và mọi mã các hàm ấy trả về có trong bảng
 * chốt hay ở `TU_VUNG_NGOAI` của đúng hàm ấy. Lớp TƯỜNG MINH: THEO_TEN chỉ khi `batBoi` (tệp gói bắt tên) có; hỏi trước mà câu ghi không bắt
 * tên thì HOI_TRUOC (ca đua im sổ); mã ngoài bảng chốt thì KHONG_VAO_SO.
 */
export interface DongDong {
  readonly ham: string;
  readonly bieuThuc: string;
  readonly so: number;
  readonly viTu: readonly string[];
  readonly lop: "THEO_TEN" | "HOI_TRUOC" | "KHONG_VAO_SO";
  readonly batBoi: string | null;
  readonly lyDo: string;
}

/** Câu `RAISE` không tên, khoá theo (hàm, errcode), `so` là số câu của khoá ấy trong thân cuối. */
export interface DongKhongTen {
  readonly ham: string;
  readonly errcode: string;
  readonly so: number;
  readonly lop: LopTay;
  readonly lyDo: string;
}

/** Mã một hàm vị từ (`viTu`) sau tên động trả về mà KHÔNG có trong `CHOT_THEO_RANG_BUOC` — có từ vựng riêng, có lý do. Chỉ áp cho ĐÚNG hàm ấy. */
export interface TuNgoai {
  readonly viTu: string;
  readonly ma: string;
  readonly lyDo: string;
}

export const BANG_TEN: readonly DongTen[] = [
  { ten: "anh_xa_bi_danh_trong_tap_loai_tru", ham: "anh_xa_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "chuanHoaGoi đọc tập loại trừ dưới khoá bí danh, đẩy dòng sang gợi ý" },
  { ten: "anh_xa_bo_trong_can_ly_do", ham: "anh_xa_kiem_luat", so: 1, lop: "KHONG_VAO_SO", lyDo: "lỗi nhập (khuôn THIEU_GIAI_TRINH) → DuLieuNenError CAN_LY_DO" },
  { ten: "anh_xa_goi_con_soan", ham: "anh_xa_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "kiemGoiDaNop hỏi gói đã rời DRAFT (FOR SHARE) trước" },
  { ten: "anh_xa_goi_con_soan", ham: "goi_y_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "kiemGoiDaNop hỏi gói đã rời DRAFT (FOR SHARE) trước" },
  { ten: "anh_xa_hoi_to_can_item_manage", ham: "anh_xa_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "ba route ghi khai item.manage; requirePermission" },
  { ten: "anh_xa_hoi_to_can_item_manage", ham: "goi_y_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "ba route ghi khai item.manage; requirePermission" },
  { ten: "anh_xa_hoi_to_sai_ma_ly_do", ham: "anh_xa_kiem_luat", so: 1, lop: "BAT_BIEN", lyDo: "chuanHoaGoi tự đặt CHUAN_HOA_HOI_TO khi có bản rõ" },
  { ten: "anh_xa_khong_co_hang_muc", ham: "anh_xa_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "ghiAnhXa hỏi dòng trước (KHONG_CO_HANG_MUC)" },
  { ten: "anh_xa_khong_co_hang_muc", ham: "goi_y_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "ghiAnhXa hỏi dòng trước (KHONG_CO_HANG_MUC)" },
  { ten: "anh_xa_ma_ly_do_danh_rieng", ham: "anh_xa_kiem_luat", so: 1, lop: "KHONG_VAO_SO", lyDo: "gửi lyDo dành riêng là lỗi nhập; 422 không sổ" },
  { ten: "anh_xa_nguoi_duyet_can_item_manage", ham: "anh_xa_kiem_luat", so: 1, lop: "HOI_TRUOC", lyDo: "ba route khai item.manage → PERMISSION_DENIED" },
  { ten: "anh_xa_nguoi_duyet_trong_tap_loai_tru", ham: "anh_xa_kiem_luat", so: 1, lop: "KHOANG_TRONG", lyDo: "người trong tập loại trừ có item.manage tự ánh xạ gói mình: 422 TRONG_TAP_LOAI_TRU, không CONTROL_DENIED; spec S4 L12 (:806) đòi vào sổ (ERRCODE 42501 — maChotTuLoi chỉ nhận 23514) — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ten: "anh_xa_sau_ban_ro_can_ly_do", ham: "anh_xa_kiem_luat", so: 1, lop: "KHONG_VAO_SO", lyDo: "thiếu lý do sau bản rõ (L13): lỗi nhập" },
  { ten: "anh_xa_tu_dong_da_co_anh_xa", ham: "anh_xa_kiem_luat", so: 1, lop: "BAT_BIEN", lyDo: "chuanHoaGoi bỏ dòng đã có, cùng khoá tư vấn" },
  { ten: "anh_xa_tu_dong_khong_khop_bi_danh", ham: "anh_xa_kiem_luat", so: 1, lop: "BAT_BIEN", lyDo: "TU_DONG chỉ khi app vừa đọc bí danh khớp dưới cùng khoá" },
  { ten: "award_giai_trinh_khong_can", ham: "award_kiem_giai_trinh", so: 1, lop: "KHONG_VAO_SO", lyDo: "chủ dự án chốt lỗi NHẬP (vaoSo false)" },
  { ten: "award_giai_trinh_ngoai_de_xuat", ham: "award_kiem_giai_trinh", so: 1, lop: "BAT_BIEN", lyDo: "ba câu chèn APPROVED/CANCELLED/WITHDRAWN không mang cột giải trình" },
  { ten: "award_thieu_giai_trinh_lech_hang", ham: "award_kiem_giai_trinh", so: 1, lop: "KHONG_VAO_SO", lyDo: "chủ dự án chốt lỗi NHẬP" },
  { ten: "bafo_ngoai_top_n", ham: "bid_kiem_vong_bafo", so: 1, lop: "SO_RIENG", lyDo: "NCC ngoài top-N nộp BAFO: bắt theo tên → BID_STATE_DENIED" },
  { ten: "c1_goi_khong_nhan_bao_gia", ham: "bid_kiem_han_nop", so: 1, lop: "SO_RIENG", lyDo: "nộp khi gói đóng/huỷ → BID_STATE_DENIED" },
  { ten: "c1_khong_han_nop", ham: "bid_kiem_han_nop", so: 1, lop: "BAT_BIEN", lyDo: "CHECK buộc gói ngoài DRAFT/CANCELLED có deadline" },
  { ten: "c1_khong_vong_bafo_dang_mo", ham: "bid_kiem_han_nop", so: 1, lop: "BAT_BIEN", lyDo: "vòng BAFO chỉ đóng cùng cạnh BAFO_CLOSED (suy)" },
  { ten: "c1_qua_han_nop", ham: "bid_kiem_han_nop", so: 1, lop: "SO_RIENG", lyDo: "nộp trễ: constraint+DETAIL → BID_DEADLINE_DENIED" },
  { ten: "cam_ket_chi_cho_de_xuat", ham: "award_dien_cam_ket", so: 1, lop: "BAT_BIEN", lyDo: "app_api không có đường ghi; trigger AFTER INSERT PROPOSED chèn" },
  { ten: "cam_ket_ngoai_giao_dich_de_xuat", ham: "award_dien_cam_ket", so: 1, lop: "BAT_BIEN", lyDo: "trigger chèn trong chính giao dịch đề xuất" },
  { ten: "du_lieu_nen_can_item_manage", ham: "du_lieu_nen_kiem_quyen_ghi", so: 1, lop: "HOI_TRUOC", lyDo: "mọi route ghi dữ liệu nền khai item.manage" },
  { ten: "du_lieu_ngoai_don_vi_khong_quy_doi_duoc", ham: "du_lieu_ngoai_kiem_ghi", so: 1, lop: "HOI_TRUOC", lyDo: "ghiLo phân giải đơn vị trước" },
  { ten: "du_lieu_ngoai_ngay_mua_sau_hom_nay", ham: "du_lieu_ngoai_kiem_ghi", so: 1, lop: "HOI_TRUOC", lyDo: "CSV kiểm ngày mua trước" },
  { ten: "du_lieu_ngoai_rut_hang_rut", ham: "du_lieu_ngoai_kiem_ghi", so: 1, lop: "BAT_BIEN", lyDo: "rutDuLieuNgoai chỉ chọn hàng chưa rút" },
  { ten: "giao_hang_chua_ky", ham: "rfq_tco_khi_mo", so: 1, lop: "BAT_BIEN", lyDo: "chỉ tổ chức chưa bật S3; số ngày giao đóng băng sau DRAFT (suy)" },
  { ten: "hang_cham_bao_gia_goi_khac", ham: "luot_cham_kiem_hang", so: 1, lop: "BAT_BIEN", lyDo: "taoLuotDanhGia chỉ ghi báo giá đúng gói" },
  { ten: "hang_cham_loi_moi_thu_hoi", ham: "luot_cham_kiem_phien_ban", so: 1, lop: "KHONG_VAO_SO", lyDo: "chỉ tới khi thu hồi commit giữa lúc đọc và ghi — dữ liệu đổi dưới chân (suy)" },
  { ten: "hang_cham_ngoai_giao_dich_luot", ham: "luot_cham_kiem_hang", so: 1, lop: "BAT_BIEN", lyDo: "lượt và hàng ghi cùng giao dịch" },
  { ten: "hang_cham_phien_ban_cu", ham: "luot_cham_kiem_phien_ban", so: 1, lop: "BAT_BIEN", lyDo: "lấy phiên bản lớn nhất đã mở" },
  { ten: "j7_rut_da_co_chu_ky", ham: "award_kiem_mot_award_song", so: 1, lop: "HOI_TRUOC", lyDo: "đếm chữ ký dưới khoá gói → RFQ_STATE_DENIED" },
  { ten: "j7_rut_khong_o_proposed", ham: "award_kiem_mot_award_song", so: 1, lop: "HOI_TRUOC", lyDo: "KHONG_CO_DE_XUAT_DANG_CHO vào sổ" },
  { ten: "j7_rut_khong_phai_nguoi_de_xuat", ham: "award_kiem_mot_award_song", so: 1, lop: "HOI_TRUOC", lyDo: "KHONG_PHAI_NGUOI_DE_XUAT vào sổ" },
  { ten: "k10_bang_chung_da_doi", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "KHONG_VAO_SO", lyDo: "bằng chứng đổi giữa lúc tìm và lúc ghi nhận" },
  { ten: "k10_ghi_nhan_sai_trang_thai", ham: "tin_hieu_kiem_ghi_nhan", so: 3, lop: "HOI_TRUOC", lyDo: "ghiNhanTinHieu hỏi trạng thái trước" },
  { ten: "k10_nguoi_gay_ra_tu_ghi_nhan", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "HOI_TRUOC", lyDo: "hoiChot → K10A_TU_GHI_NHAN" },
  { ten: "k10_tac_gia_chinh_sach_ghi_nhan", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "HOI_TRUOC", lyDo: "→ K10A_TAC_GIA_CHINH_SACH" },
  { ten: "k10_tin_hieu_chua_ghi_nhan", ham: "rfq_kiem_tin_hieu_khi_mo", so: 1, lop: "HOI_TRUOC", lyDo: "openRfq kiemChot(rfq_chot_tin_hieu)" },
  { ten: "k10b_nguoi_gay_ra_tu_ghi_nhan", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "HOI_TRUOC", lyDo: "→ K10B_TU_GHI_NHAN" },
  { ten: "k10b_tac_gia_chinh_sach_ghi_nhan", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "HOI_TRUOC", lyDo: "→ K10B_TAC_GIA_CHINH_SACH" },
  { ten: "k10b_tin_hieu_chua_ghi_nhan", ham: "award_kiem_tin_hieu_khai_thap", so: 1, lop: "HOI_TRUOC", lyDo: "duyetTraoThau hỏi award_chot_tin_hieu" },
  { ten: "k10c_nguoi_gay_ra_tu_ghi_nhan", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "HOI_TRUOC", lyDo: "→ K10C_TU_GHI_NHAN" },
  { ten: "k10c_tac_gia_chinh_sach_ghi_nhan", ham: "tin_hieu_kiem_ghi_nhan", so: 1, lop: "HOI_TRUOC", lyDo: "→ K10C_TAC_GIA_CHINH_SACH" },
  { ten: "k10c_thu_hoi_thieu_canh_tranh", ham: "rfq_invitations_kiem_danh_sach", so: 1, lop: "HOI_TRUOC", lyDo: "revokeInvitation hỏi rfq_chot_thu_hoi" },
  { ten: "k10c_thu_hoi_thieu_ly_do", ham: "rfq_invitations_kiem_danh_sach", so: 1, lop: "KHONG_VAO_SO", lyDo: "thiếu lý do: lỗi hình dạng" },
  { ten: "k10c_tin_hieu_chua_ghi_nhan", ham: "award_kiem_tin_hieu_khai_thap", so: 1, lop: "HOI_TRUOC", lyDo: "duyetTraoThau hoiChot" },
  { ten: "k2_canh_tranh_toi_thieu", ham: "rfq_kiem_so_ncc_khi_nop", so: 1, lop: "HOI_TRUOC", lyDo: "kiemChot(rfq_chot_canh_tranh) khi nộp" },
  { ten: "k3_xoay_vong", ham: "rfq_kiem_xoay_vong_khi_mo", so: 1, lop: "HOI_TRUOC", lyDo: "kiemChot xoay vòng ở nộp và mở" },
  { ten: "k3_xoay_vong", ham: "rfq_kiem_xoay_vong_khi_nop", so: 1, lop: "HOI_TRUOC", lyDo: "kiemChot xoay vòng ở nộp và mở" },
  { ten: "k5_chu_ky_doc_lap", ham: "rfq_kiem_doc_lap_khi_mo", so: 1, lop: "HOI_TRUOC", lyDo: "openRfq kiemChot" },
  { ten: "k7_thieu_chu_ky", ham: "award_kiem_theo_bac_khi_duyet", so: 1, lop: "HOI_TRUOC", lyDo: "hỏi award_du_chu_ky, chỉ chèn APPROVED khi đủ" },
  { ten: "nhom_hang_chi_doi_o_draft", ham: "rfq_kiem_nhom_hang", so: 1, lop: "HOI_TRUOC", lyDo: "UPDATE … AND status='DRAFT' → RfqError không sổ (biên — giống 75/87)" },
  { ten: "nhom_hang_da_ngung_dung", ham: "rfq_kiem_nhom_hang", so: 1, lop: "KHONG_VAO_SO", lyDo: "chọn nhóm đã ngừng: cấu hình đổi" },
  { ten: "nhom_hang_dung_lai_khi_dang_dung", ham: "nhom_hang_kiem_doi", so: 1, lop: "KHONG_VAO_SO", lyDo: "thao tác lặp/đua" },
  { ten: "nhom_hang_ngung_dung_hai_lan", ham: "nhom_hang_kiem_doi", so: 1, lop: "KHONG_VAO_SO", lyDo: "lặp/đua" },
  { ten: "phien_khach_khac_loi_moi", ham: "bid_kiem_phien_khach", so: 1, lop: "BAT_BIEN", lyDo: "bidId dẫn xuất từ lời mời của chính phiên" },
  { ten: "phien_khach_khong_hop_le", ham: "bid_kiem_phien_khach", so: 1, lop: "HOI_TRUOC", lyDo: "dispatch tra cookie 401; đua → BID_STATE_DENIED" },
  { ten: "phien_passport_khong_hop_le", ham: "passport_kiem_phien_ban", so: 1, lop: "HOI_TRUOC", lyDo: "dispatch tra cookie Passport 401; đua → SupplierError" },
  { ten: "phien_passport_qua_tran_phien_ban", ham: "passport_kiem_phien_ban", so: 1, lop: "KHONG_VAO_SO", lyDo: "trần 5 phiên bản/phiên là hạn mức chống lạm dụng" },
  { ten: "so_ngay_giao_chi_doi_o_draft", ham: "rfq_kiem_so_ngay_giao", so: 1, lop: "HOI_TRUOC", lyDo: "UPDATE … AND status='DRAFT' → RfqError (biên)" },
  { ten: "tco_thieu_so_ngay_giao", ham: "rfq_tco_khi_mo", so: 1, lop: "HOI_TRUOC", lyDo: "openRfq hỏi trước dưới khoá chính sách" },
  { ten: "tin_hieu_goi_khong_cho_duyet", ham: "tin_hieu_kiem_ghi", so: 1, lop: "HOI_TRUOC", lyDo: "NOP_DUYET cùng giao dịch nộp; GHI_NHAN kiểm trạng thái trước" },
  { ten: "tin_hieu_goi_khong_dong", ham: "tin_hieu_kiem_ghi", so: 1, lop: "BAT_BIEN", lyDo: "DONG_SOM ghi ngay sau câu đóng" },
  { ten: "tin_hieu_goi_khong_mo", ham: "tin_hieu_kiem_ghi", so: 1, lop: "BAT_BIEN", lyDo: "THU_HOI chỉ khi OPEN sau FOR SHARE" },
  { ten: "tin_hieu_goi_khong_trao", ham: "tin_hieu_kiem_ghi", so: 3, lop: "HOI_TRUOC", lyDo: "DE_XUAT sau AWARDED cùng giao dịch; GHI_NHAN kiểm AWARDED trước" },
  { ten: "tin_hieu_khong_co", ham: "tin_hieu_kiem_ghi", so: 4, lop: "BAT_BIEN", lyDo: "câu chèn có WHERE tin_hieu_hien_tai IS NOT NULL" },
  { ten: "tin_hieu_nguon_sai", ham: "tin_hieu_kiem_ghi", so: 4, lop: "BAT_BIEN", lyDo: "nguon viết cứng theo loại" },
  { ten: "unseal_approvals_yeu_cau_phai_ton_tai", ham: "unseal_kiem_nguoi_duyet", so: 1, lop: "SO_RIENG", lyDo: "id lạ: bắt code+tên → UNSEAL_NOT_FOUND_DENIED" },
];

/** Chỗ có tên THUỘC `CHOT_THEO_RANG_BUOC`, khoá (tên, hàm, số câu) — `batBoi` là tệp gói bắt tên ấy (`maChotTuLoi`). Chép một tên của bảng chốt
 * vào một trigger mới thì phải thêm dòng — và nói tệp nào bắt nó. */
export const BANG_THEO_TEN: readonly DongTheoTen[] = [
  { ten: "d2_nguoi_tao_tu_duyet", ham: "rfq_kiem_nguoi_duyet", so: 1, batBoi: "packages/rfq/src/rfq.ts" },
  { ten: "d2_phien_khong_hop_le", ham: "rfq_kiem_nguoi_duyet", so: 1, batBoi: "packages/rfq/src/rfq.ts" },
  { ten: "d2_phien_nguoi_khac", ham: "rfq_kiem_nguoi_duyet", so: 1, batBoi: "packages/rfq/src/rfq.ts" },
  { ten: "j3_nguoi_de_xuat_tu_duyet", ham: "award_kiem_nguoi_duyet", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "j3_nguoi_dieu_phoi_de_xuat", ham: "award_kiem_de_xuat", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "j3_nguoi_tao_de_xuat", ham: "award_kiem_de_xuat", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "j3_phien_de_xuat_duyet", ham: "award_kiem_nguoi_duyet", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "j5_luot_cham_khong_moi_nhat", ham: "award_kiem_de_xuat", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "k1_ban_khong_bac", ham: "chinh_sach_da_bat_thi_phai_co_bac", so: 1, batBoi: "packages/rfq/src/procurement-policy.ts" },
  { ten: "k1_nguoi_tao_tu_ky", ham: "chinh_sach_kiem_nguoi_ky", so: 1, batBoi: "packages/rfq/src/procurement-policy.ts" },
  { ten: "k2b_ngoai_le_sai_trang_thai", ham: "ngoai_le_kiem", so: 1, batBoi: "packages/invitation/src/ngoai-le.ts" },
  { ten: "k4a_ngoai_le_sai_trang_thai", ham: "ngoai_le_kiem", so: 1, batBoi: "packages/invitation/src/ngoai-le.ts" },
  { ten: "k4a_them_sai_trang_thai", ham: "rfq_invitations_kiem_danh_sach", so: 1, batBoi: "packages/invitation/src/invitation.ts" },
  { ten: "k4a_thu_hoi_sai_trang_thai", ham: "rfq_invitations_kiem_danh_sach", so: 1, batBoi: "packages/invitation/src/invitation.ts" },
  { ten: "k7_khong_bac_ghim", ham: "award_bac_cao_hon", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "k7_lech_tien_te", ham: "award_bac_cao_hon", so: 1, batBoi: "packages/danh-gia/src/trao-thau.ts" },
  { ten: "k8a_lien_he_ho_so_nguoi_khac", ham: "ncc_kiem_them_lien_he", so: 1, batBoi: "packages/supplier/src/suppliers.ts" },
  { ten: "k8a_nguoi_moi_xac_minh", ham: "ncc_kiem_xac_minh", so: 1, batBoi: "packages/supplier/src/xac-minh.ts" },
  { ten: "k8a_nguoi_tao_tu_xac_minh", ham: "ncc_kiem_xac_minh", so: 1, batBoi: "packages/supplier/src/xac-minh.ts" },
  { ten: "k9_khong_go_duoc_xung_dot", ham: "coi_kiem_khai_bao", so: 1, batBoi: "packages/kiem-soat/src/xung-dot.ts" },
  { ten: "l14_phien_ban_khong_ghim", ham: "rfq_evaluations_kiem_phien_ban_ghim", so: 1, batBoi: "packages/danh-gia/src/luot-danh-gia.ts" },
];

export const BANG_DONG: readonly DongDong[] = [
  { ham: "award_kiem_theo_bac_khi_de_xuat", bieuThuc: "lower(ly_do)", so: 1, viTu: ["award_chot_bac", "award_chot_hau_kiem"], lop: "THEO_TEN", batBoi: "packages/danh-gia/src/trao-thau.ts", lyDo: "`deXuatTraoThau` hỏi award_chot_bac và award_chot_hau_kiem trước câu ghi; trigger hỏi lại, đặt tên bằng mã viết thường, tầng gói bắt tên (maChotTuLoi)" },
  { ham: "award_kiem_theo_bac_khi_duyet", bieuThuc: "lower(ly_do)", so: 2, viTu: ["award_chot_bac", "award_chot_hau_kiem", "award_chot_doc_lap"], lop: "THEO_TEN", batBoi: "packages/danh-gia/src/trao-thau.ts", lyDo: "`duyetTraoThau` hỏi award_chot_bac, award_chot_hau_kiem, award_chot_doc_lap trước câu ghi; trigger hỏi lại, tên = mã viết thường, tầng gói bắt tên" },
  { ham: "award_kiem_vai_theo_bac", bieuThuc: "lower(ly_do)", so: 1, viTu: ["award_chot_bac", "award_chot_nguoi_ky"], lop: "THEO_TEN", batBoi: "packages/danh-gia/src/trao-thau.ts", lyDo: "`duyetTraoThau` hỏi award_chot_bac và award_chot_nguoi_ky trước câu ghi; trigger hỏi lại, tên = mã viết thường, tầng gói bắt tên" },
  { ham: "coi_kiem_chu_ky_mo_goi", bieuThuc: "lower(ly_do)", so: 1, viTu: ["coi_chot_hanh_dong"], lop: "THEO_TEN", batBoi: "packages/rfq/src/rfq.ts", lyDo: "K9 khuôn ADR-108/114: không hỏi trước — trigger lấy khoá (gói, người), hỏi coi_chot_hanh_dong, tên = mã; approveRfq bắt tên" },
  { ham: "coi_kiem_duyet_trao_thau", bieuThuc: "lower(ly_do)", so: 1, viTu: ["coi_chot_hanh_dong"], lop: "THEO_TEN", batBoi: "packages/danh-gia/src/trao-thau.ts", lyDo: "K9 khuôn ADR-108/114: trigger hỏi coi_chot_hanh_dong, tên = mã; duyetTraoThau bắt tên sau câu chèn chữ ký" },
  { ham: "coi_kiem_ghi_nhan", bieuThuc: "lower(ly_do)", so: 1, viTu: ["coi_chot_hanh_dong"], lop: "THEO_TEN", batBoi: "packages/kiem-soat/src/tin-hieu.ts", lyDo: "K9 khuôn ADR-108/114: trigger hỏi coi_chot_hanh_dong, tên = mã; ghiNhanTinHieu bắt tên" },
  { ham: "coi_kiem_luot_cham", bieuThuc: "lower(ly_do)", so: 1, viTu: ["coi_chot_hanh_dong"], lop: "THEO_TEN", batBoi: "packages/danh-gia/src/luot-danh-gia.ts", lyDo: "K9 khuôn ADR-108/114: trigger hỏi coi_chot_hanh_dong, tên = mã; taoLuotDanhGia bắt tên" },
  { ham: "coi_kiem_trao_thau", bieuThuc: "lower(ly_do)", so: 1, viTu: ["coi_chot_hanh_dong"], lop: "THEO_TEN", batBoi: "packages/danh-gia/src/trao-thau.ts", lyDo: "K9 khuôn ADR-108/114: trigger hỏi coi_chot_hanh_dong, tên = mã; đề xuất và huỷ trao thầu bắt tên" },
  { ham: "coi_kiem_xac_minh", bieuThuc: "lower(ly_do)", so: 1, viTu: ["coi_chot_xac_minh"], lop: "THEO_TEN", batBoi: "packages/supplier/src/xac-minh.ts", lyDo: "K9 khuôn ADR-108/114: trigger hỏi coi_chot_xac_minh, tên = mã; xác minh và thu hồi xác minh bắt tên" },
  { ham: "passport_kiem_yeu_cau", bieuThuc: "lower(ly_do)", so: 1, viTu: ["passport_chot_yeu_cau"], lop: "KHONG_VAO_SO", batBoi: null, lyDo: "`taoYeuCauPassport` hỏi passport_chot_yeu_cau trước câu ghi (trả về, route 422/429); trigger hỏi lại — mã PASSPORT_* ở TU_VUNG_NGOAI; đường đua bắt tên thành PassportYeuCauError" },
  { ham: "rfq_kiem_chu_ky_xung_dot_khi_mo", bieuThuc: "lower(ly_do)", so: 1, viTu: ["rfq_chot_chu_ky_xung_dot"], lop: "HOI_TRUOC", batBoi: null, lyDo: "`openRfq` hỏi rfq_chot_chu_ky_xung_dot trước câu mở; trigger hỏi lại, tên = mã — câu UPDATE không bắt tên nên ca đua im sổ (giới hạn ADR-060)" },
];

export const BANG_KHONG_TEN: readonly DongKhongTen[] = [
  { ham: "award_bac_cao_hon", errcode: "check_violation", so: 2, lop: "KHONG_VAO_SO", lyDo: "báo giá chọn không đọc được số tiền/tiền tệ: dữ liệu (cùng hạng KHONG_CO_BAO_GIA_DOC_DUOC); vế ⓑ bất biến" },
  { ham: "award_chot_doc_lap", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "p_award luôn dx.id gói đã đọc" },
  { ham: "award_chot_hau_kiem", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "bậc không chính thức luôn đủ khoá nên so_ncc_toi_thieu không NULL" },
  { ham: "award_du_chu_ky", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "award_so_chu_ky ∈ {1,2} do chinh_sach_kiem_bac" },
  { ham: "award_kiem_de_xuat", errcode: "check_violation", so: 2, lop: "KHONG_VAO_SO", lyDo: "J5 effective_cost NULL: báo giá không đọc được giá → dữ liệu; vế lượt chấm khác RFQ không tới được (biên: bidVersionId gói khác cũng rơi vào đây)" },
  { ham: "award_kiem_de_xuat", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "RFQ thiếu đã chặn trước (RFQ_KHONG_DE_XUAT_DUOC, vào sổ)" },
  { ham: "award_kiem_mot_award_song", errcode: "check_violation", so: 6, lop: "HOI_TRUOC", lyDo: "khoá RFQ, đòi EVALUATING/AWARDED + hàng mới nhất → RFQ_STATE_DENIED" },
  { ham: "award_kiem_nguoi_duyet", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "đòi dx PROPOSED mới nhất → KHONG_CO_DE_XUAT_DANG_CHO (vào sổ)" },
  { ham: "award_kiem_nguoi_duyet", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "award_id do gói đọc trước" },
  { ham: "award_kiem_theo_bac_khi_de_xuat", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "không mã sản xuất nào đặt isolation; chỉ SQL thô" },
  { ham: "award_kiem_theo_bac_khi_duyet", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "như 21" },
  { ham: "award_kiem_vai_theo_bac", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "award_id = dx.id" },
  { ham: "award_so_chu_ky_can", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "n NULL chỉ ở bậc đấu thầu chính thức; award_chot_bac hỏi trước → K7_DAU_THAU_CHINH_THUC" },
  { ham: "award_so_chu_ky_can", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "p_award = dx.id" },
  { ham: "award_vai_cua_nguoi", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "p_award = dx.id" },
  { ham: "bafo_kiem_vong", errcode: "check_violation", so: 10, lop: "HOI_TRUOC", lyDo: "moVongBafo đòi EVALUATING (RFQ_KHONG_MO_VONG_DUOC vào sổ); hạn <1h lỗi nhập" },
  { ham: "bafo_kiem_vong", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "RFQ thiếu đã chặn trước" },
  { ham: "bid_chi_ghi_them", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "chỉ-ghi-thêm" },
  { ham: "bid_kiem_han_nop", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "vendor_bids chèn cùng giao dịch" },
  { ham: "bid_phai_co_bien_nhan", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "biên nhận chèn cùng giao dịch" },
  { ham: "chan_sua_xoa", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "sổ kiểm toán chỉ-ghi-thêm" },
  { ham: "chinh_sach_kiem_bac", errcode: "check_violation", so: 22, lop: "KHONG_VAO_SO", lyDo: "hình dạng bậc là cấu hình người khai; 422 không sổ" },
  { ham: "chinh_sach_kiem_nguoi_ky", errcode: "check_violation", so: 6, lop: "KHONG_VAO_SO", lyDo: "bản không bậc / không mới nhất / chưa hiệu lực / còn gói chờ duyệt: dữ liệu, cấu hình (ADR-060); vế policy.manage là lớp chặn cuối sau cổng route; vế READ COMMITTED chỉ câu thô tới được; nhánh người tạo tự ký nay mang tên k1_nguoi_tao_tu_ky (THEO_TEN)" },
  { ham: "chinh_sach_kiem_nguoi_ky", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "policyId sai từ URL → 422 thân cố định" },
  { ham: "chinh_sach_phien_ban_tang_dan", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "route đòi version = mới nhất+1 (HttpError 422)" },
  { ham: "chot_moc_neo", errcode: "raise_exception", so: 1, lop: "BAT_BIEN", lyDo: "INSERT…SELECT: sổ rỗng ⇒ 0 hàng" },
  { ham: "coi_kiem_duyet_trao_thau", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "award_id = dx.id" },
  { ham: "coi_kiem_ghi_nhan", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "signalId do gói tìm/ghi trước" },
  { ham: "coi_kiem_khai_bao", errcode: "check_violation", so: 2, lop: "KHONG_VAO_SO", lyDo: "chưa bật S3 / NCC chưa có lời mời: cố ý không sổ" },
  { ham: "coi_kiem_khai_bao", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "rfqId sai → 422 cố định" },
  { ham: "guest_session_kiem_danh_tinh", errcode: "check_violation", so: 5, lop: "BAT_BIEN", lyDo: "chèn sau khi tiêu thụ thách thức" },
  { ham: "kiem_danh_tinh_theo_phien", errcode: "check_violation", so: 3, lop: "BAT_BIEN", lyDo: "resolveSessionActor chặn trước (401)" },
  { ham: "kiem_thanh_phan_theo_chinh_sach", errcode: "check_violation", so: 3, lop: "HOI_TRUOC", lyDo: "thiếu trọng số ⇒ CHINH_SACH_CHUA_KHAI_TRONG_SO (không sổ)" },
  { ham: "kiem_tra_ma_tran_quyen", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "app_api chỉ SELECT role_permissions" },
  { ham: "kiem_tra_nguong_khong_cung_tay_nguoi_dung", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "không route gán vai" },
  { ham: "kiem_tra_nguong_khong_cung_tay_vai_tro", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "chỉ migration" },
  { ham: "kiem_tra_phan_tach_nhiem_vu", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "như 47" },
  { ham: "kiem_tra_quan_ly_du_lieu_mu_gia_nguoi_dung", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "như 47" },
  { ham: "kiem_tra_quan_ly_du_lieu_mu_gia_vai_tro", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "như 46" },
  { ham: "loi_moi_khong_song_lai", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "mọi UPDATE lọc revoked_at IS NULL/UNSENT" },
  { ham: "mfa_credentials_khoa_ho_so_da_xac_nhan", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "app chỉ ghi bộ đếm/khoá" },
  { ham: "mfa_credentials_xoa_can_yeu_cau", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "DELETE ngay sau duyệt cùng giao dịch" },
  { ham: "mfa_reset_kiem_chuyen_trang_thai", errcode: "check_violation", so: 4, lop: "KHONG_VAO_SO", lyDo: "duyệt yêu cầu hết hạn → 422 không sổ; vế khác bất biến" },
  { ham: "mfa_reset_kiem_quyen", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "requirePermission(user.mfa_reset)" },
  { ham: "ncc_kiem_xac_minh", errcode: "check_violation", so: 6, lop: "KHONG_VAO_SO", lyDo: "dữ liệu (chưa bật, thiếu MST, không ACTIVE...); supplier.qualify hỏi trước" },
  { ham: "ncc_kiem_xac_minh", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "supplierId sai" },
  { ham: "ngan_sach_khong_ghim_ban_chua_ky", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "setRfqBudget luôn ghim chinh_sach_hieu_luc" },
  { ham: "ngoai_le_kiem", errcode: "check_violation", so: 5, lop: "KHONG_VAO_SO", lyDo: "dữ liệu (chưa bật, đã rút); nhánh rút ngoại lệ của GÓI KHÁC qua URL của gói mình là khoảng trống — khoản 9401" },
  { ham: "ngoai_le_kiem", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "rfqId sai" },
  { ham: "nhom_hang_kiem_doi", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "requirePermission(category.manage)" },
  { ham: "nhom_hang_kiem_nguoi_tao", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "như 62" },
  { ham: "otp_go_khoa_khong_xoa_dau_vet", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "app chỉ +1" },
  { ham: "otp_kiem_kenh_khac_link", errcode: "check_violation", so: 7, lop: "HOI_TRUOC", lyDo: "docToken lọc token/thu hồi, liên hệ dẫn xuất; vế khoá E3 là trạng thái dữ liệu; actor ẩn danh" },
  { ham: "passport_kiem_phien_ban", errcode: "check_violation", so: 2, lop: "HOI_TRUOC", lyDo: "docHoSoPassportNhap kiểm mục trước; NCC dẫn xuất từ cookie phiên" },
  { ham: "passport_kiem_token", errcode: "check_violation", so: 3, lop: "BAT_BIEN", lyDo: "đúc token cùng giao dịch/người/phiên với yêu cầu; kênh link cố định" },
  { ham: "passport_kiem_token", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "requestId vừa chèn cùng giao dịch" },
  { ham: "passport_kiem_yeu_cau", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "route + requirePermission(supplier.qualify) hỏi trước; PERMISSION_DENIED" },
  { ham: "passport_otp_kiem_kenh", errcode: "check_violation", so: 4, lop: "HOI_TRUOC", lyDo: "docTokenPassport + so lớp đích hỏi trước" },
  { ham: "passport_phien_kiem_danh_tinh", errcode: "check_violation", so: 4, lop: "BAT_BIEN", lyDo: "hàm duy nhất mở phiên tiêu thụ thách thức và token" },
  { ham: "rfq_bac_cua", errcode: "check_violation", so: 4, lop: "BAT_BIEN", lyDo: "người gọi chỉ gọi khi có bậc và tiền tệ khớp; bậc đầu 0" },
  { ham: "rfq_bac_cua", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "policy_id luôn bản đã ghim; phiên bản không xoá được" },
  { ham: "rfq_bac_ghim", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "tier_tu_so_tien tính từ tiers của bản ghim" },
  { ham: "rfq_budgets_chi_sua_khi_soan", errcode: "check_violation", so: 2, lop: "KHOANG_TRONG", lyDo: "setRfqBudget không hỏi trạng thái; sửa ngân sách gói đã nộp/mở 422 không sổ — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ham: "rfq_can_phe_duyet_kep", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "setRfqBudget so tiền tệ trước (RfqError lỗi nhập)" },
  { ham: "rfq_chot_canh_tranh", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "validator 069 đòi so_ncc_toi_thieu" },
  { ham: "rfq_chot_lan_nop_da_xem", errcode: "check_violation", so: 4, lop: "KHONG_VAO_SO", lyDo: "chủ dự án chốt: gói đổi sau lúc đọc, 422 không sổ" },
  { ham: "rfq_chot_thu_hoi", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "như 77" },
  { ham: "rfq_chot_xoay_vong", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "validator 069 đòi xoay_vong_n [0,32767]" },
  { ham: "rfq_gia_han_khong_hoi_sinh", errcode: "check_violation", so: 2, lop: "KHONG_VAO_SO", lyDo: "hạn đã qua / hạn mới quá khứ: thời gian trôi, lỗi nhập" },
  { ham: "rfq_invitation_tokens_kiem_goi_da_mo", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "ba đường đúc token chỉ khi gói đã mở" },
  { ham: "rfq_invitation_tokens_kiem_goi_da_mo", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "lời mời vừa chèn/khoá cùng giao dịch" },
  { ham: "rfq_invitations_kiem_danh_sach", errcode: "check_violation", so: 2, lop: "BAT_BIEN", lyDo: "danhDauDaGui chỉ UNSENT→SENT khi OPEN" },
  { ham: "rfq_invitations_kiem_danh_sach", errcode: "foreign_key_violation", so: 1, lop: "KHONG_VAO_SO", lyDo: "rfqId lạ trên route CRUD; không-tìm-thấy hàng cha ngoài sổ (khoản 133 giữ CRUD)" },
  { ham: "rfq_items_cam_truncate", errcode: "insufficient_privilege", so: 1, lop: "BAT_BIEN", lyDo: "chỉ raw SQL TRUNCATE" },
  { ham: "rfq_items_chi_sua_khi_soan", errcode: "check_violation", so: 2, lop: "KHOANG_TRONG", lyDo: "addRfqItem không hỏi trạng thái; thêm hạng mục sau DRAFT 422 không sổ — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ham: "rfq_key_material_bat_bien", errcode: "check_violation", so: 10, lop: "BAT_BIEN", lyDo: "vật liệu khoá bất biến; purge không caller production" },
  { ham: "rfq_khoa_chi_sinh_luc_mo", errcode: "check_violation", so: 1, lop: "KHOANG_TRONG", lyDo: "mở gói không ở PENDING_APPROVAL: vị từ cho qua, trigger C5, 422 không sổ (suy) — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ham: "rfq_khoa_chi_sinh_luc_mo", errcode: "foreign_key_violation", so: 1, lop: "KHONG_VAO_SO", lyDo: "rfqId lạ ở /open; không-tìm-thấy CRUD" },
  { ham: "rfq_khoa_chi_thu_hoi_khi_huy", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "chỉ cancelRfq thu hồi sau CANCELLED" },
  { ham: "rfq_khoa_phai_di_kem_lan_mo", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "đúc khoá rồi UPDATE OPEN; 0 hàng thì ném" },
  { ham: "rfq_kiem_chu_ky_danh_sach_khi_mo", errcode: "check_violation", so: 3, lop: "KHONG_VAO_SO", lyDo: "chữ ký K4b thiếu vì băm danh sách đổi sau lúc ký: dữ liệu đổi dưới chân người mở gói (ADR-060), cùng lý lẽ K9_KHAI_BAO_LOI_THOI — chủ dự án chốt 2026-10-11 (một trong hai nợ đã gọi tên của §S1.202)" },
  { ham: "rfq_kiem_chuyen_trang_thai", errcode: "check_violation", so: 15, lop: "HOI_TRUOC", lyDo: "mọi câu đổi trạng thái có vế WHERE status; vế gia hạn ở PENDING_APPROVAL không hỏi trước — khoản 9401" },
  { ham: "rfq_kiem_khoa_khi_mo", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "openRfq luôn đúc khoá trước UPDATE OPEN" },
  { ham: "rfq_kiem_ngan_sach_khi_nop", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "kiemChot(CAU_CHOT_NGAN_SACH); THIEU_NGAN_SACH" },
  { ham: "rfq_kiem_nguoi_duyet", errcode: "check_violation", so: 2, lop: "KHOANG_TRONG", lyDo: "duyệt gói không ở PENDING_APPROVAL (DRAFT, OPEN…): approveRfq không hỏi trạng thái, nhánh không tên đi thẳng 422 không hàng sổ — song sinh của nhánh *không PENDING* ở unseal_kiem_nguoi_duyet; lượt soi trên mã §S1.9101 T4: một luật cho cả hai — khoản 9401" },
  { ham: "rfq_kiem_nguoi_tao", errcode: "check_violation", so: 3, lop: "BAT_BIEN", lyDo: "người tạo và phiên dẫn xuất từ resolveSessionActor" },
  { ham: "rfq_kiem_nguong_phe_duyet_kep", errcode: "check_violation", so: 2, lop: "BAT_BIEN", lyDo: "chỉ setRfqBudget hạ cờ kép bằng chính hàm so" },
  { ham: "rfq_kiem_nhom_hang_khi_nop", errcode: "check_violation", so: 1, lop: "HOI_TRUOC", lyDo: "kiemChot(CAU_CHOT_NHOM_HANG); THIEU_NHOM_HANG" },
  { ham: "rfq_kiem_so_ncc_khi_nop", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "giao dịch API chạy READ COMMITTED" },
  { ham: "rfq_kiem_tra_ve_nhap", errcode: "check_violation", so: 2, lop: "HOI_TRUOC", lyDo: "returnRfqToDraft hỏi bật S3 trước, chèn rfq_tra_ve trước UPDATE" },
  { ham: "rfq_kiem_xoay_vong_khi_mo", errcode: "check_violation", so: 2, lop: "BAT_BIEN", lyDo: "opened_at = now(); READ COMMITTED" },
  { ham: "rfq_kiem_xoay_vong_khi_nop", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "như 101" },
  { ham: "rfq_kiem_yeu_cau_mo_thau", errcode: "check_violation", so: 3, lop: "BAT_BIEN", lyDo: "chỉ worker chuyển UNSEALED sau EXECUTED cùng giao dịch" },
  { ham: "rfq_ncc_moi_xoay_vong", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "người gọi trả sớm khi n = 0" },
  { ham: "rfq_tra_ve_dat_lan_nop", errcode: "check_violation", so: 2, lop: "HOI_TRUOC", lyDo: "hỏi bật S3, khoá hàng gói, đòi PENDING_APPROVAL trước" },
  { ham: "rfq_tra_ve_dat_lan_nop", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "gói đã đọc thấy ở bước trước" },
  { ham: "rfq_tra_ve_phai_di_kem_canh", errcode: "check_violation", so: 2, lop: "BAT_BIEN", lyDo: "UPDATE về DRAFT ngay sau; 0 hàng thì ném" },
  { ham: "sessions_kiem_mfa_khi_tao", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "hai đường phát phiên luôn đặt mfa_verified_at sau MfaProof" },
  { ham: "sessions_kiem_totp_gan_day", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "MfaProof chỉ verifyTotpForLogin tạo" },
  { ham: "thu_hoi_don_dieu", errcode: "check_violation", so: 2, lop: "BAT_BIEN", lyDo: "mọi UPDATE chỉ đặt revoked_at/consumed_at" },
  { ham: "tin_hieu_hien_tai", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "loại tín hiệu union đóng; route kiểm tập trước" },
  { ham: "tin_hieu_kiem_ghi", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "mọi lời gọi ghiTinHieu mang loại cố định" },
  { ham: "tin_hieu_kiem_ghi_nhan", errcode: "check_violation", so: 2, lop: "HOI_TRUOC", lyDo: "requirePermission + hoiChot hỏi trước; vào sổ" },
  { ham: "tin_hieu_kiem_ghi_nhan", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "signalId vừa tìm/ghi cùng giao dịch" },
  { ham: "unseal_dieu_phoi_mot_lan", errcode: "check_violation", so: 1, lop: "BAT_BIEN", lyDo: "chỉ đặt khi IS NULL" },
  { ham: "unseal_kiem_chuyen_trang_thai", errcode: "check_violation", so: 3, lop: "BAT_BIEN", lyDo: "mọi câu đổi trạng thái có vế WHERE (3 câu thật — câu thứ 4 của regex là chú thích)" },
  { ham: "unseal_kiem_du_phe_duyet", errcode: "check_violation", so: 4, lop: "HOI_TRUOC", lyDo: "approveUnseal đếm phê duyệt trước UPDATE; break-glass qua HTTP luôn 422" },
  { ham: "unseal_kiem_nguoi_duyet", errcode: "check_violation", so: 3, lop: "KHOANG_TRONG", lyDo: "vế \"không PENDING\" 422 không sổ, trái tiền lệ UNSEAL_CANCEL_DENIED; hai vế D2 đã vào sổ — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ham: "unseal_kiem_rfq_da_dong", errcode: "check_violation", so: 3, lop: "KHOANG_TRONG", lyDo: "requestUnseal không hỏi trạng thái gói; xin mở thầu gói chưa đóng (C3) 422 không sổ — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ham: "unseal_kiem_rfq_da_dong", errcode: "foreign_key_violation", so: 1, lop: "KHOANG_TRONG", lyDo: "rfqId lạ trên đường có cổng của bề mặt mở thầu → 23503 trần, không UNSEAL_NOT_FOUND_DENIED (khoản 133) — khoản 9401, chủ dự án chốt 2026-10-11 ghi nợ, sửa vòng riêng" },
  { ham: "unseal_kiem_yeu_cau_khi_ghi_ban_ro", errcode: "check_violation", so: 2, lop: "BAT_BIEN", lyDo: "chỉ worker ghi bản rõ dưới yêu cầu APPROVED" },
  { ham: "unseal_kiem_yeu_cau_khi_ghi_ban_ro", errcode: "foreign_key_violation", so: 1, lop: "BAT_BIEN", lyDo: "worker dùng chính id yêu cầu đang chạy" },
];

export const TU_VUNG_NGOAI: readonly TuNgoai[] = [
  { viTu: "passport_chot_yeu_cau", ma: "PASSPORT_LIEN_HE_KHONG_HOP_LE", lyDo: "trả về, không ném: `taoYeuCauPassport` hỏi `passport_chot_yeu_cau` trước câu ghi, route trả 422 (429 cho trần) không hàng sổ — cấu hình hay dữ liệu (tổ chức chưa bật, nhà cung cấp không hợp lệ hay chưa xác minh, người liên hệ, trần yêu cầu), ADR-060; từ vựng riêng `packages/supplier/src/passport.ts`; đường đua đi ra 422/429 cùng hợp đồng (S3.9b)" },
  { viTu: "passport_chot_yeu_cau", ma: "PASSPORT_LIEN_HE_THIEU_KENH_OTP", lyDo: "trả về, không ném: `taoYeuCauPassport` hỏi `passport_chot_yeu_cau` trước câu ghi, route trả 422 (429 cho trần) không hàng sổ — cấu hình hay dữ liệu (tổ chức chưa bật, nhà cung cấp không hợp lệ hay chưa xác minh, người liên hệ, trần yêu cầu), ADR-060; từ vựng riêng `packages/supplier/src/passport.ts`; đường đua đi ra 422/429 cùng hợp đồng (S3.9b)" },
  { viTu: "passport_chot_yeu_cau", ma: "PASSPORT_NCC_CHUA_XAC_MINH", lyDo: "trả về, không ném: `taoYeuCauPassport` hỏi `passport_chot_yeu_cau` trước câu ghi, route trả 422 (429 cho trần) không hàng sổ — cấu hình hay dữ liệu (tổ chức chưa bật, nhà cung cấp không hợp lệ hay chưa xác minh, người liên hệ, trần yêu cầu), ADR-060; từ vựng riêng `packages/supplier/src/passport.ts`; đường đua đi ra 422/429 cùng hợp đồng (S3.9b)" },
  { viTu: "passport_chot_yeu_cau", ma: "PASSPORT_NCC_KHONG_HOP_LE", lyDo: "trả về, không ném: `taoYeuCauPassport` hỏi `passport_chot_yeu_cau` trước câu ghi, route trả 422 (429 cho trần) không hàng sổ — cấu hình hay dữ liệu (tổ chức chưa bật, nhà cung cấp không hợp lệ hay chưa xác minh, người liên hệ, trần yêu cầu), ADR-060; từ vựng riêng `packages/supplier/src/passport.ts`; đường đua đi ra 422/429 cùng hợp đồng (S3.9b)" },
  { viTu: "passport_chot_yeu_cau", ma: "PASSPORT_QUA_TRAN_YEU_CAU", lyDo: "trả về, không ném: `taoYeuCauPassport` hỏi `passport_chot_yeu_cau` trước câu ghi, route trả 422 (429 cho trần) không hàng sổ — cấu hình hay dữ liệu (tổ chức chưa bật, nhà cung cấp không hợp lệ hay chưa xác minh, người liên hệ, trần yêu cầu), ADR-060; từ vựng riêng `packages/supplier/src/passport.ts`; đường đua đi ra 422/429 cùng hợp đồng (S3.9b)" },
  { viTu: "passport_chot_yeu_cau", ma: "PASSPORT_TO_CHUC_CHUA_BAT", lyDo: "trả về, không ném: `taoYeuCauPassport` hỏi `passport_chot_yeu_cau` trước câu ghi, route trả 422 (429 cho trần) không hàng sổ — cấu hình hay dữ liệu (tổ chức chưa bật, nhà cung cấp không hợp lệ hay chưa xác minh, người liên hệ, trần yêu cầu), ADR-060; từ vựng riêng `packages/supplier/src/passport.ts`; đường đua đi ra 422/429 cùng hợp đồng (S3.9b)" },
];
