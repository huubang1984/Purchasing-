import { hkdfSync } from "node:crypto";
import { KeyError } from "./types.js";
export { assertLocalDevAllowed } from "./moi-truong.js";

export const ENVELOPE_VERSION = 1;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bắt buộc `orgId` không rỗng và đúng định dạng UUID (hợp đồng toàn hệ thống).
 *
 * Không kiểm tra này, `deriveOrgKey` với `orgId = ""` vẫn chạy "thành công" (HKDF chấp
 * nhận salt rỗng), roundtrip vẫn đúng — và kết quả là một khóa DÙNG CHUNG cho mọi caller
 * lỡ đánh mất ngữ cảnh tổ chức, phá vỡ cô lập tổ chức (bất biến F3) mà không một tín hiệu
 * lỗi nào. Gọi hàm này ở đầu cả wrap() và unwrap() để lỗi lộ ra ngay, thay vì im lặng.
 */
export function assertValidOrgId(orgId: string): void {
  if (!UUID_PATTERN.test(orgId)) {
    throw new KeyError(`orgId phải là UUID hợp lệ, nhận được: "${orgId}".`);
  }
}

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

/**
 * Dựng dữ liệu xác thực bổ sung (AAD) cho AES-GCM: ràng buộc phong bì với phiên bản định
 * dạng, phiên bản master key đã bọc, và tổ chức sở hữu. Nếu ai đó sửa `keyVersion` trong một
 * `WrappedKey` (vd. gán nhầm/cố ý sang phiên bản khác) mà không sửa lại ciphertext, tag xác
 * thực sẽ không khớp AAD mới và `unwrap` ném lỗi — đóng đường tấn công downgrade khi sau này
 * nâng `ENVELOPE_VERSION`. `keyVersion` được length-prefix một byte để tránh mơ hồ ranh giới
 * khi nối chuỗi với `orgId` (orgId có độ dài cố định vì đã được validate là UUID).
 */
export function buildAad(keyVersion: string, orgId: string): Buffer {
  const keyVersionBuf = Buffer.from(keyVersion, "utf8");
  if (keyVersionBuf.length > 255) {
    throw new KeyError("keyVersion quá dài để đưa vào AAD (giới hạn 255 byte UTF-8).");
  }
  return Buffer.concat([
    Buffer.from([ENVELOPE_VERSION, keyVersionBuf.length]),
    keyVersionBuf,
    Buffer.from(orgId, "utf8"),
  ]);
}
