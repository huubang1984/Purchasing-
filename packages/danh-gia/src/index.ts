// [S1.104 / S2.2] Cửa công khai của `@trustprocure/danh-gia`. Gói này là một hàm thuần và các
// kiểu của nó — không kết nối, không đồng hồ, không trạng thái.
export {
  SO_LE_HE_SO,
  SO_LE_TIEN,
  docSo,
  laTuChoi,
  lamTron,
  tinhChiPhiHieuDung,
  vietSo,
  type DauVao,
  type DonVi,
  type KetQuaChiPhi,
  type LyDoTuChoi,
  type ThanhPhanChinhSach,
  type ThanhPhanDaQuyDoi,
  type TuChoi,
} from "./chi-phi-hieu-dung.js";

// Lớp CÓ TRẠNG THÁI — spec §3.2 đặt nó cùng gói với hàm thuần, khuôn `packages/unseal`.
export {
  DanhGiaTuChoiError,
  MA_THANH_PHAN_GIA,
  TRANG_THAI_CHAM_DUOC,
  taoLuotDanhGia,
  type HangXepHang,
  type LuotDanhGia,
  type LyDoTuChoiLuot,
  type TaoLuotDanhGiaInput,
} from "./luot-danh-gia.js";

// [S1.106 / S2.4] Đường ĐỌC bảng xếp hạng — cổng `bid.view` nằm THẲNG trong thân hàm
// (khoản 33), vì `cong-quyen-route.test.ts` đọc mã nguồn chứ không đọc một danh sách tên.
export {
  docBangXepHang,
  type BangXepHang,
  type DocBangXepHangInput,
  type HangBangXepHang,
  type ThanhPhanHien,
} from "./doc-bang-xep-hang.js";
// [S1.109 / S2.5 tầng người dùng] VÒNG BAFO — lớp có trạng thái. `059` dựng bảng và ba trigger
// canh, `060` thêm vế *"lượt chấm mới nhất"*; đây là đường sản xuất đi qua chúng, và cho tới vòng
// này KHÔNG đường nào đi qua (khoản 227).
export {
  VongBafoTuChoiError,
  docVongBafo,
  docVongBafoKhach,
  dongVongBafo,
  moVongBafo,
  type DongVongBafoInput,
  type LyDoTuChoiVong,
  type MoVongBafoInput,
  type VongBafo,
  type VongBafoKhach,
} from "./vong-bafo.js";
