// ==============================================================================================
// MỞ PHONG BÌ — CỬA HẠN CHẾ, CHỈ `apps/unseal-worker` ĐƯỢC VÀO
//
// File này là bản sao chính xác về VAI TRÒ của `crypto-keys/src/unwrap.ts`, và nó ra đời CÙNG
// LÚC với gói chứ không sau — họ quy tắc `g8-` của dependency-cruiser mở đúng hai cửa cho
// `packages/sealed-envelope/src/`, và cửa này bị canh tiếp bởi một quy tắc riêng cho phép đúng
// `apps/unseal-worker/` cộng test vòng đời của chính gói.
//
// MỘT THỨ FILE NÀY CỐ Ý KHÔNG LÀM: nó KHÔNG mở bọc khoá riêng. Nó nhận khoá riêng đã ở dạng
// PKCS8. Nếu nó tự gọi `crypto-keys/src/unwrap.js` thì `packages/sealed-envelope` sẽ phải được
// miễn trừ khỏi `g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts` — tức hàng rào G1 đi từ MỘT
// miễn trừ lên HAI, và miễn trừ thứ hai là một cả GÓI chứ không phải một app. Giữ nguyên một
// miễn trừ đáng giá hơn nhiều so với việc tiết kiệm một tham số.
// ==============================================================================================

import {
  assertAlgorithm,
  assertRfqId,
  decodeEnvelope,
  deriveContentKey,
  importPrivateKey,
  importPublicKey,
  SealedEnvelopeError,
  subtle,
  type KeyAgreementAlgorithm,
} from "./format.js";

export interface UnsealBidInput {
  readonly rfqId: string;
  /**
   * Thuật toán mà KHOÁ RIÊNG đang cầm thuộc về — lấy từ `rfq_key_material.algorithm`, KHÔNG lấy
   * từ phong bì. Phong bì tự khai thuật toán của nó, và hàm này đòi HAI nguồn ấy khớp nhau: một
   * phong bì bị sửa mã thuật toán bị từ chối ở đây, TRƯỚC khi tới phép mật mã.
   */
  readonly algorithm: KeyAgreementAlgorithm;
  readonly envelope: Uint8Array;
  /** Khoá riêng RFQ dạng PKCS8, ĐÃ được `apps/unseal-worker` mở bọc. */
  readonly recipientPrivateKey: Uint8Array;
}

export async function unsealBid(input: UnsealBidInput): Promise<Uint8Array> {
  assertRfqId(input.rfqId);
  assertAlgorithm(input.algorithm);

  const phongBi = decodeEnvelope(input.envelope);
  if (phongBi.header.algorithm !== input.algorithm) {
    throw new SealedEnvelopeError(
      `Phong bì khai thuật toán ${phongBi.header.algorithm} nhưng khoá riêng là ` +
        `${input.algorithm} — từ chối thay vì đoán.`,
    );
  }

  const khoaRieng = await importPrivateKey(input.algorithm, input.recipientPrivateKey);
  const khoaPhuDu = await importPublicKey(input.algorithm, phongBi.header.ephemeralPublicKey);
  const khoaNoiDung = await deriveContentKey(
    input.algorithm,
    khoaRieng,
    khoaPhuDu,
    input.rfqId,
  );

  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: phongBi.iv, additionalData: phongBi.aad },
        khoaNoiDung,
        phongBi.ciphertext,
      ),
    );
  } catch (loi) {
    // Thông báo KHÔNG nói vì sao. Ba nguyên nhân — sai khoá riêng, sai RFQ, phong bì bị sửa —
    // đều cho cùng một câu, vì phân biệt được chúng là một oracle cho người thử.
    throw new SealedEnvelopeError("Không mở được phong bì niêm phong.", { cause: loi });
  }
}
