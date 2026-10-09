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

// [S1.284 / S4.7b1] Luật L8 của phiên bản ghim (S4.7a, `tco.ts`) ra cửa — màn `/chinh-sach` chép nó (không import được gói), và
// `tests/architecture/bac-mac-dinh-dong-bo.test.ts` đối chiếu bản chép với bản này trên một bảng ca. Thuần, không kết nối.
export { MA_CO_NGUON, docNhomTco, kiemChinhSachTco, type LoiChinhSachTco, type ThamSoTco } from "./tco.js";

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
// [S1.110 / S2.6] TRAO THẦU — lớp có trạng thái. `061` dựng hai bảng chỉ-ghi-thêm và năm trigger
// canh (J3 · J5 · J7); đây là đường sản xuất đi qua chúng, và nó là hành động CUỐI của sản phẩm.
export {
  TraoThauTuChoiError,
  deXuatTraoThau,
  // [S1.288 / S4.7c1 / L8] Cam kết TCO chụp ở CSDL lúc đề xuất — cổng `bid.view` thẳng trong thân, hàng sổ `AWARD_COMMITMENT_VIEWED`.
  docCamKetTraoThau,
  docTraoThau,
  duyetTraoThau,
  huyTraoThau,
  // [S1.231 / khoản 232 / ADR-133] Rút một đề xuất chưa chữ ký — hàm ghi thứ tư của trao thầu, cổng `award.recommend`.
  rutDeXuatTraoThau,
  type CamKetTraoThau,
  type ChuKyDuyet,
  type DeXuatTraoThauInput,
  type DocCamKetTraoThauInput,
  type DocTraoThauInput,
  type DuyetTraoThauInput,
  type HuyTraoThauInput,
  type KhaiCamKet,
  type LyDoTuChoiTraoThau,
  type RutDeXuatTraoThauInput,
  type TraoThau,
  type TraoThauDayDu,
  type TrangThaiTraoThau,
} from "./trao-thau.js";
// [mảnh 1 / màn xuất bằng chứng] BỘ BẰNG CHỨNG ĐÁNH GIÁ (S2.7, ADR-059) — nửa XUẤT, chuyển từ
// `tools/bo-xuat-danh-gia` xuống đây để CLI và `apps/api` ghi ra cùng byte. `xuatBoBangChung` là
// đường dưới phiên người dùng, mang hai cổng `audit.read` + `bid.view` trong thân; `dungBoBangChung`
// KHÔNG hỏi quyền và chỉ công cụ vận hành gọi nó.
export { DAC_TA, DAC_TA_PHIEN_BAN } from "./dac-ta.js";
export {
  DANG_BUNDLE,
  PHIEN_BAN_BUNDLE,
  TEP_DAC_TA,
  TEP_DU_LIEU,
  dungBoBangChung,
  xuatBoBangChung,
  type BoBangChung,
  type BoBangChungDaXuat,
  type HangBundle,
  type LuotChamBundle,
  type MocThoiGian,
  type ThanhPhanChinhSachBundle,
  type ThanhPhanLuu,
  type TraoThauBundle,
  type XuatBoBangChungInput,
} from "./bo-bang-chung.js";
// [S1.262 / S4.5c2] Lớp dữ liệu nền của bộ bằng chứng — hình dạng phía XUẤT (người kiểm có bản riêng ở `tools/bo-xuat-danh-gia/src/bo.ts`).
export {
  NGUON_THOI_GIAN_DU_LIEU_NEN,
  type AnhXaBundle,
  type BangQuanSatBundle,
  type DauVaoBundle,
  type DongBenchmarkBundle,
  type DuLieuNenBundle,
  type GiaDongBundle,
  type LuotChamDuLieuNen,
  type QuanSatBundle,
} from "./lop-du-lieu-nen.js";
// [S1.256 / S4.5b] Đường ĐỌC benchmark của một gói — cổng `bid.view` thẳng trong thân, một hàng sổ `BENCHMARK_READ` mỗi lần đọc.
// [S1.260 / S4.5c1] Bản lưu một lần mỗi lần mở thầu (tính ở lần đọc đầu); *Xem dải* một dòng — hàng sổ `BENCHMARK_BAND_READ`.
export {
  TRANG_THAI_BENCHMARK_HIEN,
  TRANG_THAI_VONG_CHAO_LAI,
  docBenchmark,
  docDaiBenchmark,
  type BenchmarkCuaGoi,
  type DaiCuaDong,
  type DaiHien,
  type DocBenchmarkInput,
  type DocDaiBenchmarkInput,
  type DongBenchmarkHien,
  type NguonBenchmark,
  type ThuLai,
} from "./doc-benchmark.js";
