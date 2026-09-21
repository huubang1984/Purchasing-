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
