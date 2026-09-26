// ==============================================================================================
// KÝ BIÊN NHẬN BẰNG AWS KMS — `alias/tp-receipt-sign` (ADR-011, ADR-009)
//
// Khoá riêng KHÔNG BAO GIỜ rời KMS: `kms:Sign` nhận văn bản chính tắc (`MessageType = RAW`, KMS tự
// băm SHA-256) và trả chữ ký DER — đúng dạng `verifyReceipt` nhận và `openssl dgst -verify` đọc.
// Key policy ở `infra/terraform/50-kms-prod` chỉ cho `tp-api` `Sign` với `ECDSA_SHA_256`.
//
// `kid` là NHÃN do cấu hình đặt, ánh xạ 1–1 với một CMK: xoay khoá ký = CMK mới + `kid` mới, CMK
// cũ giữ nguyên để kiểm biên nhận cũ (ADR-011 mục 3). Nửa công khai lấy bằng `GetPublicKey`
// (`layKhoaCongKhaiBienNhanKms`) — thứ đường công bố `apps/public-keys` cần cho mỗi `kid`.
//
// Chữ ký KMS trả được CHUẨN HOÁ qua DER → RAW → DER trước khi ra khỏi hàm: một DER dị dạng ném ở
// đây, lúc ký, chứ không ở tay nhà cung cấp lúc kiểm — một biên nhận không kiểm chứng được là một
// biên nhận hỏng mà không ai biết.
// ==============================================================================================

import {
  GetPublicKeyCommand,
  SignCommand,
  type GetPublicKeyCommandOutput,
  type SignCommandOutput,
} from "@aws-sdk/client-kms";

import { derToRawSignature, rawToDerSignature, ReceiptError } from "./receipt.js";
import { assertReceiptKid, type ReceiptSigner } from "./signer.js";

/** Mặt tối thiểu của `KMSClient` mà bộ ký cần — `KMSClient` thật thoả nó; test tiêm bản giả. */
export interface KmsKyBienNhan {
  send(lenh: SignCommand): Promise<SignCommandOutput>;
}

/** Mặt tối thiểu để đọc nửa công khai. */
export interface KmsDocKhoaCongKhai {
  send(lenh: GetPublicKeyCommand): Promise<GetPublicKeyCommandOutput>;
}

export interface AwsKmsReceiptSignerConfig {
  readonly client: KmsKyBienNhan;
  /** CMK `ECC_NIST_P256` / `SIGN_VERIFY` — ARN, key id hay `alias/tp-receipt-sign`. */
  readonly keyId: string;
  /** Nhãn đi vào dòng `kid=` của biên nhận; ánh xạ đúng một CMK. */
  readonly kid: string;
}

function kiemKeyId(keyId: string): void {
  if (keyId.trim() === "") throw new ReceiptError("aws-kms: keyId của khoá ký không được rỗng.");
}

export function createAwsKmsReceiptSigner(cfg: AwsKmsReceiptSignerConfig): ReceiptSigner {
  kiemKeyId(cfg.keyId);
  assertReceiptKid(cfg.kid);
  return {
    name: "aws-kms",
    activeKeyId: cfg.kid,
    async sign(canonicalText: string): Promise<Uint8Array> {
      let ra: SignCommandOutput;
      try {
        ra = await cfg.client.send(
          new SignCommand({
            KeyId: cfg.keyId,
            Message: new TextEncoder().encode(canonicalText),
            MessageType: "RAW",
            SigningAlgorithm: "ECDSA_SHA_256",
          }),
        );
      } catch (loi) {
        throw new ReceiptError("aws-kms: Sign biên nhận thất bại.", { cause: loi });
      }
      if (ra.SigningAlgorithm !== undefined && ra.SigningAlgorithm !== "ECDSA_SHA_256") {
        throw new ReceiptError(`aws-kms: KMS ký bằng ${ra.SigningAlgorithm}, ADR-011 ghim ECDSA_SHA_256.`);
      }
      if (ra.Signature === undefined || ra.Signature.length === 0) {
        throw new ReceiptError("aws-kms: Sign không trả chữ ký.");
      }
      return rawToDerSignature(derToRawSignature(ra.Signature));
    },
  };
}

/** Nửa công khai (SPKI DER) của một CMK ký biên nhận — từ chối mọi khoá không đúng ADR-011. */
export async function layKhoaCongKhaiBienNhanKms(client: KmsDocKhoaCongKhai, keyId: string): Promise<Uint8Array> {
  kiemKeyId(keyId);
  let ra: GetPublicKeyCommandOutput;
  try {
    ra = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
  } catch (loi) {
    throw new ReceiptError("aws-kms: GetPublicKey của khoá ký thất bại.", { cause: loi });
  }
  if (ra.KeySpec !== "ECC_NIST_P256" || ra.KeyUsage !== "SIGN_VERIFY") {
    throw new ReceiptError(
      `aws-kms: khoá ký phải là ECC_NIST_P256 / SIGN_VERIFY, KMS trả ${String(ra.KeySpec)} / ${String(ra.KeyUsage)}.`,
    );
  }
  if (!(ra.SigningAlgorithms ?? []).includes("ECDSA_SHA_256")) {
    throw new ReceiptError("aws-kms: khoá ký không hỗ trợ ECDSA_SHA_256.");
  }
  if (ra.PublicKey === undefined || ra.PublicKey.length === 0) {
    throw new ReceiptError("aws-kms: GetPublicKey không trả khoá công khai.");
  }
  return ra.PublicKey;
}
