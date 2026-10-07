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
  ghiNhanTinHieu,
  ghiTinHieuKhiNop,
  lietKeTinHieu,
  type GhiNhanTinHieu,
  type GoiTrongBangChung,
  type KetQuaGhiNhan,
  type NguoiXemTinHieu,
  type TinHieu,
  type TinHieuCuaGoi,
} from "./tin-hieu.js";
// [S1.9101 / S3.4a] Khai báo xung đột lợi ích (K9, spec S3 §4.5): khai và đọc khai báo của CHÍNH người gọi. Chốt ở bảy cổng là
// trigger của `9501_khai_bao_xung_dot`; gói này không giữ bản sao nào của phép so.
export { docKhaiBaoXungDot, khaiBaoXungDot, type KhaiBaoXungDot, type KhaiBaoXungDotCuaToi, type TrangThaiXungDot } from "./xung-dot.js";
