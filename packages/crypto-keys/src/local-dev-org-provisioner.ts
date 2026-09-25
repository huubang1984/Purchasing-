// =============================================================================================
// [ADR-062] SINH CẶP KHOÁ TỔ CHỨC — BẢN local-dev
//
// Bắt chước đúng HÌNH của `kms:GenerateDataKeyPairWithoutPlaintext`: trả khoá công khai và khoá
// riêng ĐÃ BỌC, không bao giờ trả khoá riêng dạng rõ. Khoá riêng (PKCS#8) được bọc bằng chính
// `createLocalDevWrapper` — bọc đối xứng v1 bằng vòng master key — nên "KMS" của local-dev là vòng
// master key, và phiên bản cặp khoá tổ chức là phiên bản master key đang dùng lúc sinh.
//
// PKCS#8 dạng rõ chỉ sống trong hàm này và bị `fill(0)` trong `finally`. Đối tượng `KeyObject`
// của Node thì không xoá được — dư lượng đã biết, cùng loại với ghi chú ở `issueRfqKeyPair`.
// =============================================================================================

import { generateKeyPairSync } from "node:crypto";

import { createLocalDevWrapper } from "./local-dev-wrapper.js";
import type { MasterKeyRing } from "./master-keys.js";
import { assertOrgId, type OrgKeyProvisioner, type ProvisionedOrgKey } from "./org-key.js";

export function createLocalDevOrgKeyProvisioner(ring: MasterKeyRing): OrgKeyProvisioner {
  // createLocalDevWrapper tự gọi assertLocalDevAllowed() ⇒ hàng rào G1 chạy ngay lúc dựng.
  const boc = createLocalDevWrapper(ring);
  return {
    name: "local-dev",
    async generate(orgId: string): Promise<ProvisionedOrgKey> {
      assertOrgId(orgId);
      const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const pkcs8 = cap.privateKey.export({ format: "der", type: "pkcs8" });
      try {
        const daBoc = await boc.wrap(orgId, pkcs8);
        return {
          orgId,
          keyVersion: daBoc.keyVersion,
          publicKey: cap.publicKey.export({ format: "der", type: "spki" }),
          wrappedPrivateKey: daBoc.ciphertext,
        };
      } finally {
        pkcs8.fill(0);
      }
    },
  };
}
