// =============================================================================================
// [ADR-062] MỞ KHOÁ RIÊNG TỔ CHỨC — BẢN local-dev (phía mở khoá)
//
// Bắt chước `kms:Decrypt` của adapter thật: mở khoá riêng tổ chức (PKCS#8, bọc v1 bằng vòng
// master key) đúng MỘT lần, rồi trả một `OrgKeyHandle` mở các khoá RFQ cục bộ. Worker gọi
// `openOrgKey` một lần mỗi lượt mở thầu, không phải một lần mỗi khoá RFQ — đó là con số "1 lời
// gọi KMS mỗi lượt" của ADR-009 trục 3, nay là một thuộc tính của INTERFACE chứ không chỉ của
// cách dùng.
//
// Nằm sau quy tắc `g1-khong-giai-ma-ngoai-unseal-worker-local-dev-org-unwrapper-ts`.
// =============================================================================================

import { createPrivateKey, type KeyObject } from "node:crypto";

import { createLocalDevUnwrapper } from "./local-dev-unwrapper.js";
import type { MasterKeyRing } from "./master-keys.js";
import { taoHandle, type OrgKeyHandle, type WrappedOrgKey } from "./org-open.js";
import { KeyError } from "./types.js";

export interface OrgKeyUnwrapper {
  readonly name: string;
  /** Mở khoá riêng tổ chức cho MỘT lượt mở thầu. Bên gọi phải `dispose()` handle khi xong. */
  openOrgKey(khoa: WrappedOrgKey): Promise<OrgKeyHandle>;
}

export function createLocalDevOrgUnwrapper(ring: MasterKeyRing): OrgKeyUnwrapper {
  // createLocalDevUnwrapper tự gọi assertLocalDevAllowed() ⇒ hàng rào G1 chạy ngay lúc dựng.
  const mo = createLocalDevUnwrapper(ring);
  return {
    name: "local-dev",
    async openOrgKey(khoa: WrappedOrgKey): Promise<OrgKeyHandle> {
      const pkcs8 = await mo.unwrap(khoa.orgId, {
        ciphertext: khoa.wrappedPrivateKey,
        keyVersion: khoa.keyVersion,
      });
      let rieng: KeyObject;
      try {
        rieng = createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" });
      } catch (error) {
        throw new KeyError("Khoá riêng tổ chức đã mở nhưng không phải PKCS#8 hợp lệ.", { cause: error });
      } finally {
        pkcs8.fill(0);
      }
      return taoHandle(khoa.orgId, khoa.keyVersion, rieng);
    },
  };
}
