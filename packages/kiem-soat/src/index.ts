// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/kiem-soat — [S1.203 / S3.6b1] spec S3 §3.2
//
// Gói giữ lớp có trạng thái của các chốt kiểm soát S3 mà không thuộc về gói thầu: hôm nay là tín hiệu chia nhỏ và lần ghi nhận
// của nó (§4.6). Mỗi chốt là một hàm vị từ SQL; gói gọi chính hàm ấy, trigger gọi lại nó làm lớp chặn cuối. Ranh giới `depcruise`
// (`g20-`): chỉ `index.ts` là cửa, và gói không với tới `sealed-envelope`, `unseal` hay `crypto-keys` — kể cả gián tiếp, nên nó
// cũng không phụ thuộc `@trustprocure/rfq`. Chiều ngược lại (`rfq` → `kiem-soat`) được phép.
// ============================================================================================
export {
  KiemSoatError,
  LOAI_TIN_HIEU_TRAO_THAU,
  ghiNhanTinHieu,
  ghiTinHieuKhiDeXuat,
  ghiTinHieuKhiDongSom,
  ghiTinHieuKhiNop,
  ghiTinHieuKhiThuHoi,
  lietKeTinHieu,
  type GhiNhanTinHieu,
  type GoiTrongBangChung,
  type KetQuaGhiNhan,
  type LoaiTinHieu,
  type NguoiXemTinHieu,
  type TinHieu,
  type TinHieuCuaGoi,
  type TinHieuKhaiThap,
  type TinHieuTraoThau,
} from "./tin-hieu.js";
// [S1.281 / S3.4a] Khai báo xung đột lợi ích (K9, spec S3 §4.5): khai và đọc khai báo của CHÍNH người gọi. Chốt ở bảy cổng là
// trigger của `114_khai_bao_xung_dot`; gói này không giữ bản sao nào của phép so.
export { docKhaiBaoXungDot, khaiBaoXungDot, type KhaiBaoXungDot, type KhaiBaoXungDotCuaToi, type TrangThaiXungDot } from "./xung-dot.js";
// [S1.291 / S3.8a] Hiệu suất nhà cung cấp (K11, spec S3 §4.9): đường đọc DUY NHẤT của view hiệu suất, sau cổng
// `bid.view` và kèm hàng sổ. Vị từ bí mật — chỉ gói đã lộ giá, vị từ khách — là thân view, ghim ở hardening.
export { SAN_LICH_SU, docHieuSuatNhaCungCap, type HieuSuat, type HieuSuatNhaCungCap, type TruongDuoiSan } from "./hieu-suat.js";
