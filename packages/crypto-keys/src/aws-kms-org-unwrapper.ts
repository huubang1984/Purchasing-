// =============================================================================================
// [ADR-062] MỞ KHOÁ RIÊNG TỔ CHỨC — BẢN aws-kms (phía mở khoá)
//
// Một lời gọi `kms:Decrypt` mỗi lượt mở thầu: mở `PrivateKeyCiphertextBlob` mà
// `GenerateDataKeyPairWithoutPlaintext` đã trả lúc sinh, với CÙNG `EncryptionContext = { org_id }`
// — blob của tổ chức A đem mở dưới org_id của B thì KMS từ chối, không phải mã ứng dụng từ chối.
// `KeyId` được truyền tường minh để KMS không mở một blob của CMK khác dù principal có quyền trên
// nó. Phần còn lại (dựng KeyObject, mở khoá RFQ cục bộ, dispose) là `createOrgKeyUnwrapper`, dùng
// chung với local-dev.
//
// Nằm sau quy tắc `g1-khong-giai-ma-ngoai-unseal-worker-aws-kms-org-unwrapper-ts`: tệp này gọi
// `DecryptCommand`, và `[ADR-062 ⒞]` chỉ cho phép điều đó ở đích của một quy tắc họ `g1-`.
// =============================================================================================

import { DecryptCommand, type DecryptCommandOutput } from "@aws-sdk/client-kms";

import { kiemKeyId } from "./aws-kms-org-provisioner.js";
import { createOrgKeyUnwrapper, type OrgKeyUnwrapper } from "./org-open.js";
import { KeyError } from "./types.js";

/** Mặt tối thiểu của `KMSClient` mà bộ mở cần — `KMSClient` thật thoả nó; test tiêm bản giả. */
export interface KmsMoKhoa {
  send(lenh: DecryptCommand): Promise<DecryptCommandOutput>;
}

export interface AwsKmsOrgUnwrapperConfig {
  readonly client: KmsMoKhoa;
  /** CMK đối xứng đã bọc khoá riêng tổ chức — cùng giá trị với bên sinh. */
  readonly keyId: string;
}

export function createAwsKmsOrgUnwrapper(cfg: AwsKmsOrgUnwrapperConfig): OrgKeyUnwrapper {
  kiemKeyId(cfg.keyId);
  return createOrgKeyUnwrapper({
    name: "aws-kms",
    async moKhoaRieng(khoa): Promise<Uint8Array> {
      let ra: DecryptCommandOutput;
      try {
        ra = await cfg.client.send(
          new DecryptCommand({
            KeyId: cfg.keyId,
            CiphertextBlob: khoa.wrappedPrivateKey,
            EncryptionContext: { org_id: khoa.orgId },
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          }),
        );
      } catch (error) {
        throw new KeyError("aws-kms: Decrypt khoá riêng tổ chức thất bại.", { cause: error });
      }
      if (ra.Plaintext === undefined || ra.Plaintext.length === 0) {
        throw new KeyError("aws-kms: Decrypt không trả bản rõ.");
      }
      return ra.Plaintext;
    },
  });
}
