// ==============================================================================================
// [S1.171 / S3.1d] MA TRẬN BẬC MÀ `pnpm gieo:demo --s3` KHAI — MẶC ĐỊNH CỦA SPEC S3 §4.1
//
// Bảng vai của §7 — bảy người, năm nhà cung cấp cho gói bậc 2 — được tính DƯỚI mặc định này và ngưỡng kép một tỷ, nên
// bối cảnh demo khai đúng nó chứ không khai một ma trận riêng. Mọi ô là GIẢ ĐỊNH của spec, hiệu chỉnh sau pilot.
//
// Đây là bản chép THỨ HAI của mặc định ấy: bản đầu là `BAC_MAC_DINH` của `apps/web/src/chinh-sach.ts` — mẫu điền sẵn của
// màn `/chinh-sach`. Không import được bản ấy: công cụ là mã chạy lúc vận hành, và app là lá — không mã sản xuất nào
// import nó (`tests/architecture/pham-vi-san-xuat.test.ts`). Hai bản khoá nhau bằng
// `tests/architecture/bac-mac-dinh-dong-bo.test.ts`: sửa một bản mà quên bản kia thì cổng đỏ.
//
// Tệp tách khỏi `index.ts` vì `index.ts` CHẠY lúc được import — test đọc hằng ở đây mà không gieo gì.
// ==============================================================================================

/** Một bậc như CSDL cất (`069`): khoá viết theo lối CSDL, cùng lý do `ThanhPhanTrongSoVao`. */
export type BacDemo = Readonly<Record<string, unknown>> & { readonly tu_so_tien: number; readonly dau_thau_chinh_thuc: boolean };

export const BAC_DEMO: readonly BacDemo[] = [
  { tu_so_tien: 0, so_ncc_toi_thieu: 2, award_vai_khac_nhau: false, ky_danh_sach_moi: false, xoay_vong_n: 0, award_so_chu_ky: 1, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: false, khai_xung_dot: true, dau_thau_chinh_thuc: false },
  { tu_so_tien: 100000000, so_ncc_toi_thieu: 3, award_vai_khac_nhau: false, ky_danh_sach_moi: true, xoay_vong_n: 5, award_so_chu_ky: 1, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: false, khai_xung_dot: true, dau_thau_chinh_thuc: false },
  { tu_so_tien: 1000000000, so_ncc_toi_thieu: 5, award_vai_khac_nhau: false, ky_danh_sach_moi: true, xoay_vong_n: 5, award_so_chu_ky: 2, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: true, khai_xung_dot: true, dau_thau_chinh_thuc: false },
  { tu_so_tien: 10000000000, dau_thau_chinh_thuc: true },
];

/** Hai cột mức (§4.1): cửa sổ chia nhỏ 30 ngày, hiệu lực thẩm định 12 tháng; và ngưỡng kép một tỷ (§4.1 bổ sung). */
export const MUC_DEMO = { chiaNhoCuaSoNgay: 30, thamDinhHieuLucThang: 12, nguongKep: "1000000000.00" } as const;
