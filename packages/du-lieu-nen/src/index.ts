// [S1.192 / S4.0] Cửa công khai của `@trustprocure/du-lieu-nen` — nền dữ liệu của S4a (spec S4 §3.2). Gói này không
// với tới đường mở thầu: `g19-` cấm nó phụ thuộc `sealed-envelope`, `unseal`, `crypto-keys`.
export {
  KHONG_QUY_DOI_DUOC,
  chuoiSach,
  quyDoiDonVi,
  type KetQuaQuyDoi,
  type QuyDoiDonViInput,
} from "./don-vi.js";
// [S1.197 / S4.2a] Hàng chuẩn, bí danh hàng, quy đổi riêng.
export {
  DuLieuNenError,
  docChiTietHangChuan,
  docHangChuan,
  khaiBiDanhHang,
  khaiQuyDoiRieng,
  lietKeHangChuan,
  rutBiDanhHang,
  rutQuyDoiRieng,
  taoHangChuan,
  taoPhienBanHangChuan,
  type BiDanhHangHieuLuc,
  type ChiTietHangChuan,
  type HangChuan,
  type HangChuanMoi,
  type KhaiBiDanhHangInput,
  type KhaiQuyDoiRiengInput,
  type PhienBanHangChuan,
  type QuyDoiRiengHieuLuc,
  type TaoHangChuanInput,
  type TaoPhienBanInput,
} from "./hang-chuan.js";
// [S1.199 / S4.2b] Danh mục đơn vị và bí danh đơn vị của tổ chức — đường ghi của màn `/du-lieu`.
export {
  docDanhMucDonVi,
  khaiBiDanhDonVi,
  rutBiDanhDonVi,
  type BiDanhDonViHieuLuc,
  type DanhMucDonVi,
  type DonViDanhMuc,
  type KhaiBiDanhDonViInput,
} from "./bi-danh-don-vi.js";
// [S1.204 / S4.3a] Chuẩn hoá và ánh xạ hạng mục: lõi thuần có phiên bản, lượt chuẩn hoá, thao tác hàng đợi, đọc.
export {
  NGUONG_GOI_Y,
  NGUONG_TU_DONG,
  PHIEN_BAN_BO_CHUAN_HOA,
  chuanHoa,
  type DiemUngVien,
  type KetQuaChuanHoa,
  type UngVienHangChuan,
} from "./chuan-hoa.js";
export {
  LY_DO_CHUAN_HOA_HOI_TO,
  chuanHoaGoi,
  chuanHoaSauNop,
  coHangChuanDangDung,
  docAnhXaGoi,
  docHangDoi,
  ghiAnhXa,
  taoHangChuanVaAnhXa,
  type AnhXaDong,
  type DongHangDoi,
  type GhiAnhXaInput,
  type KetQuaLuotChuanHoa,
} from "./anh-xa.js";
// [S1.9101 / S4.6a] Mốc giá ngoài và lịch sử mua ngoài hệ thống — đường ghi (nhập tay, dán CSV, rút) và danh sách KHÔNG cột giá
// dưới cổng `item.manage` (ADR-096; ADR-9201). Bộ đọc giá dưới `bid.view` là của S4.6b.
export {
  type DongNgoaiDaDoc,
  type KetQuaDocCsv,
  type LoaiDuLieuNgoai,
  type LoiDongNgoai,
  type MaLoiDong,
} from "./csv-ngoai.js";
export {
  docLoDuLieuNgoai,
  khaiMocNgoai,
  lietKeLoDuLieuNgoai,
  nhapDuLieuNgoai,
  rutDuLieuNgoai,
  type CachNhapNgoai,
  type HangDuLieuNgoai,
  type KetQuaNhapNgoai,
  type KhaiMocNgoaiInput,
  type LoDuLieuNgoai,
  type NhapDuLieuNgoaiInput,
  type RutDuLieuNgoaiInput,
} from "./du-lieu-ngoai.js";
// [S1.251 / S4.4b] Lịch sử giá của một hàng chuẩn — cổng `bid.view`, mỗi lần đọc một hàng sổ (L6 vế lịch sử).
export {
  TRANG_THAI_QUAN_SAT,
  docLichSuGia,
  type DocLichSuGiaInput,
  type LichSuGia,
  type QuanSatGia,
  type TrangThaiQuanSat,
} from "./lich-su-gia.js";
// [S1.256 / S4.5b] Benchmark giá: mẫu và bộ đọc nhóm khoá `benchmark`, phép tính của một gói, phép ghi của lượt chấm (L7). Lõi
// thuần (`tinhDai`, `ganNhan`) không ra cửa: người dùng của nó là hai hàm dưới và bộ kiểm ngoại tuyến của S4.5c cài lại từ đặc tả.
// [S1.262 / S4.5c2] Ra cửa đúng hai hàm thuần cho bộ bằng chứng: `nhanMotDong` — lớp ⑴ (gọi hàm thuần) của bộ kiểm, ADR-059 — và
// `truThang` — biên dưới của bảng quan sát mà bộ xuất mang. Lớp ⑵ (độc lập) vẫn cài lại từ `DAC-TA.md`, không import gói này.
export {
  NHOM_BENCHMARK_MAU,
  PHUONG_PHAP_BENCHMARK,
  docNhomBenchmark,
  nhanMotDong,
  truThang,
  type ChieuLech,
  type DaiBenchmark,
  type NhanBenchmark,
  type NhomBenchmark,
  type QuanSatBenchmark,
} from "./benchmark.js";
// [S1.260 / S4.5c1] Bản lưu của bảng so sánh (một bản mỗi lần mở thầu) và dải của một dòng khi bấm *Xem dải* (ADR-143).
export {
  docQuanSatTaiMoc,
  ghiBanLuuBenchmark,
  ghiBenchmarkLuotCham,
  tinhBenchmarkGoi,
  tinhDaiDong,
  type BenchmarkGoi,
  type DaiCuaGoi,
  type DaiDong,
  type DocQuanSatTaiMocInput,
  type DongBenchmark,
  type GhiBanLuuInput,
  type HangQuanSatTaiMoc,
  type GhiBenchmarkInput,
  type GiaQuyDoiCuaX,
  type KetQuaDaiDong,
  type TinhBenchmarkGoiInput,
  type TinhDaiDongInput,
} from "./benchmark-goi.js";
