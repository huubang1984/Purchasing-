// Entrypoint MỞ khóa. CHỈ apps/unseal-worker được import file này.
// Quy tắc "khong-giai-ma-ngoai-unseal-worker" trong .dependency-cruiser.cjs cưỡng chế
// điều này ở tầng T0 — vi phạm làm CI đỏ ngay tại commit (ADR-006, bất biến G1).
export { createLocalDevUnwrapper, type KeyUnwrapper } from "./local-dev-unwrapper.js";
// [ADR-062] Mở khoá riêng TỔ CHỨC một lần mỗi lượt mở thầu, rồi mở khoá RFQ cục bộ.
export { createLocalDevOrgUnwrapper } from "./local-dev-org-unwrapper.js";
// [ADR-062] Bản aws-kms: MỘT `kms:Decrypt` mỗi lượt, kèm encryption context org_id.
export {
  createAwsKmsOrgUnwrapper,
  type AwsKmsOrgUnwrapperConfig,
  type KmsMoKhoa,
} from "./aws-kms-org-unwrapper.js";
export {
  createOrgKeyUnwrapper,
  type OrgKeyHandle,
  type OrgKeyUnwrapper,
  type OrgKeyUnwrapperConfig,
  type WrappedOrgKey,
} from "./org-open.js";
