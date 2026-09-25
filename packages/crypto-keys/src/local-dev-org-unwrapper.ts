// =============================================================================================
// [ADR-062] MỞ KHOÁ RIÊNG TỔ CHỨC — BẢN local-dev (phía mở khoá)
//
// Bắt chước `kms:Decrypt` của adapter thật: mở khoá riêng tổ chức (PKCS#8, bọc v1 bằng vòng
// master key) đúng MỘT lần, rồi trả một `OrgKeyHandle` mở các khoá RFQ cục bộ. Worker gọi
// `openOrgKey` một lần mỗi lượt mở thầu, không phải một lần mỗi khoá RFQ — đó là con số "1 lời
// gọi KMS mỗi lượt" của ADR-009 trục 3, nay là một thuộc tính của INTERFACE chứ không chỉ của
// cách dùng. Phần dùng chung mọi adapter nằm ở `createOrgKeyUnwrapper` (org-open.ts).
//
// Nằm sau quy tắc `g1-khong-giai-ma-ngoai-unseal-worker-local-dev-org-unwrapper-ts`.
// =============================================================================================

import { createLocalDevUnwrapper } from "./local-dev-unwrapper.js";
import type { MasterKeyRing } from "./master-keys.js";
import { createOrgKeyUnwrapper, type OrgKeyUnwrapper } from "./org-open.js";

export function createLocalDevOrgUnwrapper(ring: MasterKeyRing): OrgKeyUnwrapper {
  // createLocalDevUnwrapper tự gọi assertLocalDevAllowed() ⇒ hàng rào G1 chạy ngay lúc dựng.
  const mo = createLocalDevUnwrapper(ring);
  return createOrgKeyUnwrapper({
    name: "local-dev",
    moKhoaRieng: (khoa) =>
      mo.unwrap(khoa.orgId, { ciphertext: khoa.wrappedPrivateKey, keyVersion: khoa.keyVersion }),
  });
}
