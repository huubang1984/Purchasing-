// ==============================================================================================
// apps/api/src/adapters/totp-aws-kms.ts — BỌC / MỞ BÍ MẬT TOTP BẰNG CMK RIÊNG `alias/tp-totp` (ADR-063)
//
// Cài đặt thật của cổng `TotpSecretUnsealer` (identity) và `TotpSecretWrapper` (route-types): mỗi
// bí mật (20 byte) được `kms:Encrypt` thẳng trên một CMK đối xứng DÀNH RIÊNG cho TOTP, và mỗi lần
// kiểm mã TOTP là một `kms:Decrypt`. Không bí mật dài hạn nào nằm trong bộ nhớ `api`.
//
// Vì sao `api` được `Decrypt` ở đây mà ADR-062 cấm `api` giải mã: lệnh cấm của ADR-062 là trên
// `alias/tp-org-wrap` — khoá mở được mọi hồ sơ thầu. CMK này là khoá KHÁC, key policy của nó chỉ
// nhận `tp-api`, và key policy của `tp-org-wrap` vẫn `Deny` Decrypt với mọi principal ngoài worker
// — nên quyền ở đây không bắc cầu sang hồ sơ thầu. Hợp đồng của cổng ("không dùng chung vòng khoá
// với bộ mở phong bì thầu") giữ bằng CMK riêng, không bằng một nhãn HKDF.
//
// Ba tính chất của hợp đồng, như bản local-dev, có test:
//   ⑴ ràng buộc tổ chức — `EncryptionContext = { org_id, key_version }` là AAD của blob KMS: bí mật
//      bọc ở A không mở dưới org_id của B, và đổi `key_version` trong hàng mà không đổi blob thì
//      KMS không mở; ⑵ NÉM khi không mở được, không bao giờ trả mảng rỗng; ⑶ `kind` phân biệt.
//
// Nằm sau quy tắc depcruise `g18-totp-kms-chi-composition`: chỉ composition root dựng được nó.
// Tệp này gọi `DecryptCommand`, và `[ADR-062 ⒞]` (kms-giai-ma-mot-cua.test.ts) chỉ cho phép điều
// ấy ở phía mở khoá thầu HOẶC ở đích của một quy tắc họ `g18-totp-` — xem ADR-063.
// ==============================================================================================

import {
  DecryptCommand,
  EncryptCommand,
  type DecryptCommandOutput,
  type EncryptCommandOutput,
} from "@aws-sdk/client-kms";
import type { TotpSecretUnsealer, WrappedTotpSecret } from "@trustprocure/identity";
import type { TotpSecretWrapper } from "../route-types.js";
import type { BoMaBiMatTotp } from "./totp-local-dev.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Mặt tối thiểu của `KMSClient` mà adapter cần — `KMSClient` thật thoả nó; test tiêm bản giả. */
export interface KmsTotp {
  send(lenh: EncryptCommand): Promise<EncryptCommandOutput>;
  send(lenh: DecryptCommand): Promise<DecryptCommandOutput>;
}

export interface TotpAwsKmsConfig {
  readonly client: KmsTotp;
  /** CMK đối xứng dành riêng cho TOTP — ARN, key id hay `alias/tp-totp`. */
  readonly keyId: string;
  /** Nhãn phiên bản ghi vào `mfa_credentials.secret_key_version` và vào encryption context. */
  readonly keyVersion: string;
}

class TotpAwsKmsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TotpAwsKmsError";
  }
}

function ngCanh(orgId: string, keyVersion: string): Record<string, string> {
  if (!UUID.test(orgId)) throw new TotpAwsKmsError("orgId phải là UUID hợp lệ");
  return { org_id: orgId, key_version: keyVersion };
}

export function taoBoMaBiMatTotpAwsKms(cfg: TotpAwsKmsConfig): BoMaBiMatTotp {
  if (cfg.keyId.trim() === "") throw new TotpAwsKmsError("aws-kms: keyId của CMK TOTP không được rỗng");
  const dai = Buffer.byteLength(cfg.keyVersion, "utf8");
  if (dai < 1 || dai > 64 || !/^[A-Za-z0-9._:-]+$/u.test(cfg.keyVersion)) {
    throw new TotpAwsKmsError("aws-kms: keyVersion của TOTP phải dài 1–64 ký tự [A-Za-z0-9._:-]");
  }
  const wrapper: TotpSecretWrapper = {
    name: "aws-kms",
    async wrapTotpSecret(orgId: string, secret: Uint8Array): Promise<WrappedTotpSecret> {
      const ctx = ngCanh(orgId, cfg.keyVersion);
      if (secret.length === 0) throw new TotpAwsKmsError("bi mat TOTP rong");
      let ra: EncryptCommandOutput;
      try {
        ra = await cfg.client.send(new EncryptCommand({ KeyId: cfg.keyId, Plaintext: secret, EncryptionContext: ctx }));
      } catch (loi) {
        throw new TotpAwsKmsError("khong boc duoc bi mat TOTP", { cause: loi });
      }
      if (ra.CiphertextBlob === undefined || ra.CiphertextBlob.length === 0) {
        throw new TotpAwsKmsError("KMS khong tra ciphertext");
      }
      return { ciphertext: ra.CiphertextBlob, keyVersion: cfg.keyVersion };
    },
  };
  const unsealer: TotpSecretUnsealer = {
    kind: "TOTP_SECRET_UNSEALER",
    name: "aws-kms",
    async openTotpSecret(orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array> {
      const ctx = ngCanh(orgId, wrapped.keyVersion);
      let ra: DecryptCommandOutput;
      try {
        ra = await cfg.client.send(
          new DecryptCommand({
            KeyId: cfg.keyId,
            CiphertextBlob: wrapped.ciphertext,
            EncryptionContext: ctx,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          }),
        );
      } catch (loi) {
        // Một thông điệp cho mọi nguyên nhân (sai tổ chức, sai phiên bản, bị sửa, bị từ chối):
        // phân biệt là oracle. Lỗi gốc vẫn ở `cause` cho chẩn đoán phía máy chủ.
        throw new TotpAwsKmsError("khong mo duoc bi mat TOTP", { cause: loi });
      }
      if (ra.Plaintext === undefined || ra.Plaintext.length === 0) {
        throw new TotpAwsKmsError("khong mo duoc bi mat TOTP");
      }
      return ra.Plaintext;
    },
  };
  return { wrapper, unsealer };
}
