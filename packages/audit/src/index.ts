export { assertTenantBound } from "./tenant-guard.js";
export {
  appendAuditEvent,
  exportChainHead,
  recordChainAnchor,
  type ActorType,
  type AuditEventInput,
  type AuditEventRecord,
  type ChainAnchor,
  type ChainHeadExport,
} from "./writer.js";
export {
  verifyAuditChain,
  type ChainProblem,
  type ChainProblemKind,
  type VerificationResult,
  type VerifyOptions,
} from "./verifier.js";
// [S1.17] Đường ĐỌC của mốc neo ngoài — kiểm chữ ký và lấy từ nơi cất. Đường KÝ (`anchor-sign.ts`)
// CỐ Ý không có ở đây: xem khối đầu file đó và quy tắc `g11-ky-neo-chi-o-cong-cu-xuat-neo`.
// [S1.19 / review lượt 11 — H11-9, H11-10] `antoanChoBaoCao` ra cửa. Nó KHÔNG mang một khả năng
// nào — nó cắt một chuỗi xuống 120 ký tự và escape mọi ký tự điều khiển — và nó ra cửa vì
// `tools/neo-so-kiem-toan` cần ĐÚNG bộ khử độc ấy cho những giá trị người vận hành gõ vào (`--org`,
// `--ra`, `--seq`). Đường còn lại là chép nó sang công cụ, và một bản chép của một hàm an ninh là
// thứ dự án này đã đặt tên nhiều lần: hai bản sẽ trôi khỏi nhau.
export {
  ANCHOR_FORMAT_LABEL,
  ANCHOR_SIGNING_ALGORITHM,
  AnchorError,
  antoanChoBaoCao,
  buildAnchorText,
  parseAnchorText,
  type AnchorFields,
} from "./anchor-text.js";
export {
  laNeoDaKiemChuKy,
  verifyAnchorRecord,
  type ExternalAnchor,
  type SignedAnchorRecord,
} from "./anchor-verify.js";
export {
  createFileAnchorStore,
  loadVerifiedAnchors,
  type AnchorStore,
} from "./anchor-store.js";
