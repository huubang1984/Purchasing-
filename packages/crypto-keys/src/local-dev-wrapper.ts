import { createCipheriv, randomBytes } from "node:crypto";
import { ENVELOPE_VERSION, deriveOrgKey, IV_LENGTH } from "./local-dev-shared.js";
import type { MasterKeyRing } from "./master-keys.js";
import type { WrappedKey } from "./types.js";

export interface KeyWrapper {
  readonly name: string;
  wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey>;
}

/**
 * Bộ bọc khóa dùng cho phát triển và test. Môi trường thật dùng adapter KMS/Vault,
 * nơi master key không bao giờ rời khỏi dịch vụ quản lý khóa.
 */
export function createLocalDevWrapper(ring: MasterKeyRing): KeyWrapper {
  return {
    name: "local-dev",
    // Đồng bộ với unwrap(): async đảm bảo mọi throw trong tương lai (vd. nếu ring bị
    // sửa để có thể ném lỗi ở active()) tự trở thành promise bị reject thay vì ném
    // đồng bộ, giữ hợp đồng KeyWrapper nhất quán.
    // eslint-disable-next-line @typescript-eslint/require-await
    async wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey> {
      const { version, key } = ring.active();
      const orgKey = deriveOrgKey(key, orgId);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", orgKey, iv);
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      // version || iv || tag || ciphertext
      const envelope = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, body]);
      orgKey.fill(0);

      return { ciphertext: envelope, keyVersion: version };
    },
  };
}
