// ==============================================================================================
// apps/api/src/adapters/totp-local-dev.ts — BỌC / MỞ BÍ MẬT TOTP CHO PHÁT TRIỂN, TRÊN MỘT VÒNG KHOÁ RIÊNG
//
// `TotpSecretUnsealer` (identity) là một CỔNG: `apps/api` không được import đường mở bọc của
// `crypto-keys` (họ `g1-`), nên bí mật TOTP không đi qua bộ mở phong bì thầu — và hợp đồng của
// cổng ấy nói thẳng: *không được dùng chung vòng khoá chính với bộ đó*. File này là cài đặt dev
// của cổng, cùng khuôn `createLocalDevWrapper`/`createLocalDevReceiptSigner`: hàng rào
// `assertLocalDevAllowed()` chạy NGAY KHI TẠO, không đợi lần gọi đầu.
//
// Đây KHÔNG phải một bản chép của `local-dev-shared.ts` (crypto-keys) — không import được (quy tắc
// `g1-...-local-dev-shared-ts` cấm đúng module ấy, và cấm đúng), và cũng không nên: hai adapter
// dùng hai nhãn HKDF khác nhau (`trustprocure/totp-dek/v1` ở đây), nên kể cả khi một người vận
// hành dán CÙNG một base64 vào hai biến, khoá dẫn xuất vẫn khác — và `cau-hinh.ts` đã chặn lỗi
// dán ấy từ trước. Tính chất giữ được của hợp đồng, có test: ⑴ ràng buộc tổ chức (khoá dẫn xuất
// theo `orgId` + `orgId` trong AAD): bí mật bọc ở A không mở ở B; ⑵ NÉM khi không mở được, không
// bao giờ trả mảng rỗng; ⑶ `kind` phân biệt để không gán nhầm `KeyUnwrapper` vào đây.
//
// Định dạng: iv(12) || tag(16) || ciphertext. `keyVersion` = phiên bản của vòng, đi vào AAD cùng
// `orgId` — đổi phiên bản trong hàng mà không đổi ciphertext thì tag không khớp.
// ==============================================================================================

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { assertLocalDevAllowed, type MasterKeyRing } from "@trustprocure/crypto-keys";
import type { TotpSecretUnsealer, WrappedTotpSecret } from "@trustprocure/identity";
import type { TotpSecretWrapper } from "../route-types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const IV = 12;
const TAG = 16;

export interface BoMaBiMatTotp {
  readonly wrapper: TotpSecretWrapper;
  readonly unsealer: TotpSecretUnsealer;
}

class TotpLocalDevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotpLocalDevError";
  }
}

function khoaTheoToChuc(khoaChinh: Buffer, orgId: string): Buffer {
  if (!UUID.test(orgId)) throw new TotpLocalDevError("orgId phải là UUID hợp lệ");
  return Buffer.from(hkdfSync("sha256", khoaChinh, Buffer.from(orgId, "utf8"), Buffer.from("trustprocure/totp-dek/v1", "utf8"), 32));
}

function aad(phienBan: string, orgId: string): Buffer {
  return Buffer.from(`totp/v1|${phienBan}|${orgId}`, "utf8");
}

export function taoBoMaBiMatTotp(vong: MasterKeyRing): BoMaBiMatTotp {
  assertLocalDevAllowed();
  return {
    wrapper: {
      name: "local-dev",
      wrapTotpSecret(orgId: string, secret: Uint8Array): Promise<WrappedTotpSecret> {
        // Mọi lỗi — kể cả `orgId` sai hình dạng — đi ra dưới dạng REJECT, không ném đồng bộ: hợp đồng của
        // một hàm trả Promise là một hình dạng lỗi, và `dispatch.ts` chỉ bắt hình dạng ấy.
        let khoa: Buffer | undefined;
        try {
          const { version, key } = vong.active();
          khoa = khoaTheoToChuc(key, orgId);
          const iv = randomBytes(IV);
          const c = createCipheriv("aes-256-gcm", khoa, iv);
          c.setAAD(aad(version, orgId));
          const than = Buffer.concat([c.update(Buffer.from(secret)), c.final()]);
          return Promise.resolve({ ciphertext: new Uint8Array(Buffer.concat([iv, c.getAuthTag(), than])), keyVersion: version });
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new TotpLocalDevError("khong boc duoc bi mat TOTP"));
        } finally {
          khoa?.fill(0);
        }
      },
    },
    unsealer: {
      kind: "TOTP_SECRET_UNSEALER",
      name: "local-dev",
      openTotpSecret(orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array> {
        const phongBi = Buffer.from(wrapped.ciphertext);
        if (phongBi.length <= IV + TAG) return Promise.reject(new TotpLocalDevError("phong bi TOTP qua ngan"));
        let khoa: Buffer;
        try {
          khoa = khoaTheoToChuc(vong.get(wrapped.keyVersion), orgId);
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new TotpLocalDevError("khong lay duoc khoa"));
        }
        try {
          const d = createDecipheriv("aes-256-gcm", khoa, phongBi.subarray(0, IV));
          d.setAAD(aad(wrapped.keyVersion, orgId));
          d.setAuthTag(phongBi.subarray(IV, IV + TAG));
          const ro = Buffer.concat([d.update(phongBi.subarray(IV + TAG)), d.final()]);
          if (ro.length === 0) throw new TotpLocalDevError("bi mat TOTP rong");
          return Promise.resolve(new Uint8Array(ro));
        } catch {
          // Một thông điệp cho mọi nguyên nhân (sai tổ chức, sai phiên bản, bị sửa): phân biệt là oracle.
          return Promise.reject(new TotpLocalDevError("khong mo duoc bi mat TOTP"));
        } finally {
          khoa.fill(0);
        }
      },
    },
  };
}
