import { createCipheriv, randomBytes } from "node:crypto";
import {
  assertLocalDevAllowed,
  assertValidOrgId,
  buildAad,
  deriveOrgKey,
  ENVELOPE_VERSION,
  IV_LENGTH,
} from "./local-dev-shared.js";
import type { MasterKeyRing } from "./master-keys.js";
import type { WrappedKey } from "./types.js";

export interface KeyWrapper {
  readonly name: string;
  wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey>;
}

/**
 * Bộ bọc khóa dùng cho phát triển và test. Môi trường thật dùng adapter KMS/Vault,
 * nơi master key không bao giờ rời khỏi dịch vụ quản lý khóa.
 *
 * Kiểm tra fail-closed chạy ngay khi tạo (không đợi tới lần wrap() đầu tiên): adapter này
 * không được phép hoạt động khi `NODE_ENV=production`, trừ khi có cờ ghi đè tường minh —
 * tín hiệu duy nhất phân biệt "local-dev" với KMS thật không nên chỉ là chuỗi `name` mà
 * không ai kiểm (bất biến G1, phát hiện I6 ở fix round 1).
 */
export function createLocalDevWrapper(ring: MasterKeyRing): KeyWrapper {
  assertLocalDevAllowed();
  return {
    name: "local-dev",
    // Đồng bộ với unwrap(): async đảm bảo mọi throw trong tương lai (vd. nếu ring bị
    // sửa để có thể ném lỗi ở active()) tự trở thành promise bị reject thay vì ném
    // đồng bộ, giữ hợp đồng KeyWrapper nhất quán.
    // eslint-disable-next-line @typescript-eslint/require-await
    async wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey> {
      assertValidOrgId(orgId);
      const { version, key } = ring.active();
      const orgKey = deriveOrgKey(key, orgId);
      try {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv("aes-256-gcm", orgKey, iv);
        cipher.setAAD(buildAad(version, orgId));
        const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();

        // version || iv || tag || ciphertext
        const envelope = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, body]);

        return { ciphertext: envelope, keyVersion: version };
      } finally {
        // Xóa khóa dẫn xuất khỏi heap ngay cả khi createCipheriv/setAAD ném lỗi —
        // trước đây fill(0) nằm ngoài try nên một lần ném giữa chừng để lại khóa
        // dẫn xuất còn nguyên trong bộ nhớ (việc nhỏ phát hiện ở fix round 1).
        orgKey.fill(0);
      }
    },
  };
}
