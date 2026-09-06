// ==============================================================================================
// NIÊM PHONG — MÃ NÀY CHẠY TRONG TRÌNH DUYỆT NHÀ CUNG CẤP
//
// ADR-007: giá dạng rõ không được đi qua `api` ở BẤT KỲ thời điểm nào (A2). Cách duy nhất làm
// điều đó đúng theo KIẾN TRÚC thay vì theo kỷ luật là mã hoá trước khi rời máy nhà cung cấp.
// Vì vậy file này không import gì ngoài `./format.js` — không `pg`, không `node:crypto`, không
// một mảnh nào của máy chủ. Nó phải nạp được vào một trang web.
// ==============================================================================================

import {
  assertAlgorithm,
  assertRfqId,
  buildEnvelopeHeader,
  deriveContentKey,
  encodeEnvelope,
  generateEphemeralKeyPair,
  importPublicKey,
  IV_LENGTH,
  KEY_AGREEMENT_ALGORITHMS,
  SealedEnvelopeError,
  subtle,
  type KeyAgreementAlgorithm,
} from "./format.js";

export interface SealBidInput {
  /** RFQ mà phong bì này thuộc về. Đi vào INFO của HKDF — xem ràng buộc (2) ở `format.ts`. */
  readonly rfqId: string;
  readonly algorithm: KeyAgreementAlgorithm;
  /** `rfq_key_material.public_key`, dạng SPKI DER. */
  readonly recipientPublicKey: Uint8Array;
  readonly plaintext: Uint8Array;
}

/**
 * Niêm phong một báo giá. Trả về TOÀN BỘ phong bì, tự mô tả, gửi thẳng lên máy chủ được.
 *
 * Ba thứ hàm này KHÔNG làm, ghi ra để không ai trông đợi nhầm:
 *   * nó KHÔNG ký. Biên nhận là việc của S1.5 và thuật toán chữ ký là mục 2 của ADR-011, còn mở.
 *   * nó KHÔNG biết nhà cung cấp là ai. Danh tính thuộc về phiên khách (S1.3).
 *   * nó KHÔNG kiểm hạn nộp. C1 đòi phán quyết dựa trên `now()` của Postgres TRONG chính giao
 *     dịch ghi — một phép kiểm ở đây sẽ là đồng hồ của máy nhà cung cấp, tức đúng thứ ADR-005 cấm.
 */
export async function sealBid(input: SealBidInput): Promise<Uint8Array> {
  assertRfqId(input.rfqId);
  assertAlgorithm(input.algorithm);
  if (input.plaintext.length === 0) {
    throw new SealedEnvelopeError("Không niêm phong một báo giá rỗng.");
  }

  const s = subtle();
  const khoaNhan = await importPublicKey(input.algorithm, input.recipientPublicKey);
  const phuDu = await generateEphemeralKeyPair(input.algorithm);
  const spkiPhuDu = new Uint8Array(await s.exportKey("spki", phuDu.publicKey));

  const khoaNoiDung = await deriveContentKey(
    input.algorithm,
    phuDu.privateKey,
    khoaNhan,
    input.rfqId,
  );

  // AAD là ĐÚNG phần đầu của phong bì sắp dựng, lấy từ chính hàm dựng bố cục.
  const aad = buildEnvelopeHeader(input.algorithm, spkiPhuDu);

  const iv = new Uint8Array(IV_LENGTH);
  globalThis.crypto.getRandomValues(iv);

  const ciphertext = new Uint8Array(
    await s.encrypt({ name: "AES-GCM", iv, additionalData: aad }, khoaNoiDung, input.plaintext),
  );

  return encodeEnvelope(input.algorithm, spkiPhuDu, iv, ciphertext);
}

/**
 * [ADR-011 mục 2] CHỌN THUẬT TOÁN LÀ MỘT PHÉP ĐO LÚC CHẠY, KHÔNG PHẢI MỘT HẰNG SỐ CẤU HÌNH.
 *
 * `supported` là kết quả của máy dò (`tools/do-webcrypto`) chạy trong CHÍNH trình duyệt của nhà
 * cung cấp ấy. Không có danh sách trắng theo phiên bản, không đoán theo User-Agent — cả hai đều
 * là DANH SÁCH TÊN, và dự án đã ba lần bị đúng khuôn ấy làm mù (khoản nợ 3, 16, và lớp canh
 * route ở `4467ca9`).
 *
 * Thứ tự ưu tiên đọc thẳng từ ADR-011 mục 1: `X25519` là đường NÂNG CẤP, `ECDH_P256` là MẶC ĐỊNH.
 * Và mục 3 là lý do hàm này ném thay vì trả `null`: một nhà cung cấp không đi được đường nào phải
 * nhận một câu trả lời rõ ràng, chứ không phải một nút bấm im lặng không làm gì.
 */
export function chooseKeyAgreementAlgorithm(
  offered: readonly KeyAgreementAlgorithm[],
  supported: readonly string[],
): KeyAgreementAlgorithm {
  const daCo = new Set(offered);
  const trinhDuyetLam = new Set(supported);
  const uuTien: readonly KeyAgreementAlgorithm[] = ["X25519", "ECDH_P256"];
  for (const t of uuTien) {
    if (daCo.has(t) && trinhDuyetLam.has(t)) return t;
  }
  throw new SealedEnvelopeError(
    "Trình duyệt này không làm được thuật toán nào mà RFQ đang cung cấp " +
      `(RFQ có: ${[...daCo].join(", ") || "không có gì"}; trình duyệt làm được: ` +
      `${[...trinhDuyetLam].join(", ") || "không có gì"}).`,
  );
}

export { KEY_AGREEMENT_ALGORITHMS };
