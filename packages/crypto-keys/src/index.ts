// Entrypoint BỌC khóa — an toàn cho mọi service import.
// Đường MỞ khóa nằm ở "./unwrap.js" và chỉ apps/unseal-worker được chạm (ADR-006, INV-G1).
export { KeyError, type WrappedKey } from "./types.js";
// [S1.5] Một PHÉP KIỂM, không một khả năng nào — xem khối đầu `moi-truong.ts` để biết vì sao nó
// được mở ra cửa công khai trong khi `local-dev-shared.ts` thì không.
export { assertDevSinkAllowed, assertLocalDevAllowed } from "./moi-truong.js";
export { MasterKeyRing } from "./master-keys.js";
export { createLocalDevWrapper, type KeyWrapper } from "./local-dev-wrapper.js";
// [ADR-062] Bọc khoá RFQ bằng khoá CÔNG KHAI của tổ chức (hàm thuần, không bí mật), và sinh cặp
// khoá tổ chức mà không bao giờ trả khoá riêng dạng rõ.
export {
  wrapForOrg,
  type OrgKeyProvisioner,
  type OrgPublicKey,
  type ProvisionedOrgKey,
} from "./org-key.js";
export { createLocalDevOrgKeyProvisioner } from "./local-dev-org-provisioner.js";
// [ADR-062] Bản aws-kms của bộ sinh: `GenerateDataKeyPairWithoutPlaintext` — không trường bản rõ nào.
export {
  createAwsKmsOrgKeyProvisioner,
  type AwsKmsOrgKeyProvisionerConfig,
  type KmsSinhCapKhoa,
} from "./aws-kms-org-provisioner.js";
