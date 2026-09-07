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
export {
  ANCHOR_FORMAT_LABEL,
  ANCHOR_SIGNING_ALGORITHM,
  AnchorError,
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
