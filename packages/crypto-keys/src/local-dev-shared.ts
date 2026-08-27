import { hkdfSync } from "node:crypto";

export const ENVELOPE_VERSION = 1;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

/**
 * Dẫn xuất khóa riêng cho từng tổ chức từ master key.
 *
 * `orgId` làm salt nên khóa của hai tổ chức khác nhau là hai khóa khác nhau:
 * phong bì của tổ chức A không mở được bằng ngữ cảnh tổ chức B (bất biến F3).
 */
export function deriveOrgKey(masterKey: Buffer, orgId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.from(orgId, "utf8"), Buffer.from("trustprocure/org-dek/v1", "utf8"), 32),
  );
}
