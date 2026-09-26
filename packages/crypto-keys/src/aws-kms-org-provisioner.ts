// =============================================================================================
// [ADR-062] SINH CẶP KHOÁ TỔ CHỨC — BẢN aws-kms (phía công khai)
//
// Một lời gọi `kms:GenerateDataKeyPairWithoutPlaintext` trên CMK đối xứng `alias/tp-org-wrap`, với
// `EncryptionContext = { org_id }` và `KeyPairSpec = ECC_NIST_P256`. KMS trả khoá công khai (SPKI
// DER) và khoá riêng ĐÃ BỌC — không có trường bản rõ nào trong phản hồi, nên `tp-api` (nơi lời gọi
// chạy) không bao giờ thấy khoá riêng tổ chức. Key policy chỉ trao cho `tp-api` đúng quyền này.
//
// `keyVersion` là một NHÃN do cấu hình đặt, không phải thứ KMS trả: nó phải TẤT ĐỊNH để hai lần mở
// RFQ đua nhau cùng sinh hội tụ về một hàng (`org_key_pairs` khoá chính (org_id, key_version), bên
// thua `ON CONFLICT DO NOTHING` rồi đọc lại). CMK tự xoay hằng năm mà blob cũ vẫn mở được, nên xoay
// CMK KHÔNG đổi nhãn; xoay CẶP KHOÁ tổ chức là đổi nhãn trong cấu hình — RFQ cũ giữ phiên bản cũ.
//
// Tệp này KHÔNG gọi lệnh nào trả bí mật dạng rõ (`[ADR-062 ⒞]` ở `kms-giai-ma-mot-cua.test.ts`
// canh điều đó), nên nó ở mặt công khai `index.ts`.
// =============================================================================================

import {
  GenerateDataKeyPairWithoutPlaintextCommand,
  type GenerateDataKeyPairWithoutPlaintextCommandOutput,
} from "@aws-sdk/client-kms";

import { assertOrgId, khoaCongKhaiTuSpki, type OrgKeyProvisioner, type ProvisionedOrgKey } from "./org-key.js";
import { KeyError } from "./types.js";

/** Mặt tối thiểu của `KMSClient` mà bộ sinh cần — `KMSClient` thật thoả nó; test tiêm bản giả. */
export interface KmsSinhCapKhoa {
  send(lenh: GenerateDataKeyPairWithoutPlaintextCommand): Promise<GenerateDataKeyPairWithoutPlaintextCommandOutput>;
}

export interface AwsKmsOrgKeyProvisionerConfig {
  readonly client: KmsSinhCapKhoa;
  /** CMK đối xứng bọc khoá riêng tổ chức — ARN, key id hay `alias/tp-org-wrap`. */
  readonly keyId: string;
  /** Nhãn phiên bản cặp khoá tổ chức (1–64 byte UTF-8, khớp CHECK của `org_key_pairs`). */
  readonly keyVersion: string;
}

export function kiemKeyId(keyId: string): void {
  if (keyId.trim() === "") throw new KeyError("aws-kms: keyId của CMK không được rỗng.");
}

function kiemKeyVersion(keyVersion: string): void {
  const dai = Buffer.byteLength(keyVersion, "utf8");
  if (dai < 1 || dai > 64) {
    throw new KeyError("aws-kms: keyVersion của cặp khoá tổ chức phải dài 1–64 byte UTF-8.");
  }
}

export function createAwsKmsOrgKeyProvisioner(cfg: AwsKmsOrgKeyProvisionerConfig): OrgKeyProvisioner {
  kiemKeyId(cfg.keyId);
  kiemKeyVersion(cfg.keyVersion);
  return {
    name: "aws-kms",
    async generate(orgId: string): Promise<ProvisionedOrgKey> {
      assertOrgId(orgId);
      let ra: GenerateDataKeyPairWithoutPlaintextCommandOutput;
      try {
        ra = await cfg.client.send(
          new GenerateDataKeyPairWithoutPlaintextCommand({
            KeyId: cfg.keyId,
            KeyPairSpec: "ECC_NIST_P256",
            EncryptionContext: { org_id: orgId },
          }),
        );
      } catch (error) {
        throw new KeyError("aws-kms: GenerateDataKeyPairWithoutPlaintext thất bại.", { cause: error });
      }
      if (ra.KeyPairSpec !== undefined && ra.KeyPairSpec !== "ECC_NIST_P256") {
        throw new KeyError(`aws-kms: KMS trả cặp khoá ${ra.KeyPairSpec}, ADR-062 ghim ECC_NIST_P256.`);
      }
      const { PublicKey: publicKey, PrivateKeyCiphertextBlob: wrappedPrivateKey } = ra;
      if (publicKey === undefined || wrappedPrivateKey === undefined || wrappedPrivateKey.length === 0) {
        throw new KeyError("aws-kms: phản hồi thiếu khoá công khai hay khoá riêng đã bọc.");
      }
      // Đọc lại SPKI: một khoá không phải P-256 bị từ chối TRƯỚC khi vào CSDL, không phải lúc bọc.
      khoaCongKhaiTuSpki(publicKey);
      return { orgId, keyVersion: cfg.keyVersion, publicKey, wrappedPrivateKey };
    },
  };
}
