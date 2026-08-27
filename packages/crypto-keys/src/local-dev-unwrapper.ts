import { createDecipheriv } from "node:crypto";
import {
  ENVELOPE_VERSION,
  deriveOrgKey,
  HEADER_LENGTH,
  IV_LENGTH,
} from "./local-dev-shared.js";
import type { MasterKeyRing } from "./master-keys.js";
import { KeyError, type WrappedKey } from "./types.js";

export interface KeyUnwrapper {
  readonly name: string;
  unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array>;
}

export function createLocalDevUnwrapper(ring: MasterKeyRing): KeyUnwrapper {
  return {
    name: "local-dev",
    // async bắt buộc để throw đồng bộ tự trở thành promise bị reject; không có async,
    // `throw` trong hàm thường sẽ ném ngay lập tức thay vì reject Promise, làm
    // `expect(...).rejects` không bao giờ bắt được lỗi.
    // eslint-disable-next-line @typescript-eslint/require-await
    async unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array> {
      const envelope = Buffer.from(wrapped.ciphertext);
      if (envelope.length < HEADER_LENGTH) {
        throw new KeyError("Mở phong bì thất bại: dữ liệu ngắn hơn phần đầu bắt buộc.");
      }
      if (envelope[0] !== ENVELOPE_VERSION) {
        throw new KeyError(`Mở phong bì thất bại: phiên bản định dạng ${String(envelope[0])} không hỗ trợ.`);
      }

      // ring.get() ném KeyError riêng khi thiếu phiên bản, để phân biệt
      // "chưa có khóa" với "dữ liệu đã bị sửa" — hai sự cố cần xử lý khác nhau.
      const orgKey = deriveOrgKey(ring.get(wrapped.keyVersion), orgId);

      const iv = envelope.subarray(1, 1 + IV_LENGTH);
      const tag = envelope.subarray(1 + IV_LENGTH, HEADER_LENGTH);
      const body = envelope.subarray(HEADER_LENGTH);

      try {
        const decipher = createDecipheriv("aes-256-gcm", orgKey, iv);
        decipher.setAuthTag(tag);
        const opened = Buffer.concat([decipher.update(body), decipher.final()]);
        return opened;
      } catch (error) {
        // Không lộ chi tiết mật mã ra thông báo lỗi.
        throw new KeyError("Mở phong bì thất bại: dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức.", {
          cause: error,
        });
      } finally {
        orgKey.fill(0);
      }
    },
  };
}
