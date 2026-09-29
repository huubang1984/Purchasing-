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
  type KetQuaGhiNhan,
  type TinHieu,
  type TinHieuCuaGoi,
} from "./tin-hieu.js";
