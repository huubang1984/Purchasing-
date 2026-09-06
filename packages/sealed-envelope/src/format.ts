// ==============================================================================================
// ĐỊNH DẠNG PHONG BÌ NIÊM PHONG — CHỖ ADR-011 TRỞ THÀNH BYTE
//
// Phần "đã ghim" của ADR-011, ghim từ trước khi ADR ấy chốt được mục 1: **phong bì mang một mã
// thuật toán thoả thuận khoá TƯỜNG MINH**. Nhờ nó, việc thêm `X25519` bên cạnh `ECDH P-256` là
// một NHÁNH, không phải một cuộc di trú — phong bì cũ vẫn tự khai được nó đã dùng gì.
//
// BỐ CỤC (tất cả số nguyên là big-endian):
//
//   [0..4)      magic          4 byte   "TPSE"
//   [4]         formatVersion  1 byte
//   [5]         algorithm      1 byte   1 = ECDH_P256, 2 = X25519
//   [6..8)      ephLen         2 byte   độ dài khoá công khai phù du
//   [8..8+n)    ephPub         n byte   SPKI DER của khoá công khai PHÙ DU của nhà cung cấp
//   [8+n..+12)  iv             12 byte
//   [..]        ciphertext     phần còn lại — AES-256-GCM, thẻ xác thực nối ở cuối
//
// HAI RÀNG BUỘC ĐƯỢC CÀI VÀO CHÍNH PHÉP MẬT MÃ, KHÔNG PHẢI VÀO MỘT PHÉP KIỂM Ở TẦNG TRÊN:
//
//   (1) AAD = ĐÚNG PHẦN ĐẦU, từ byte 0 tới hết `ephPub`. Sửa mã thuật toán trong một phong bì đã
//       niêm phong (tấn công hạ cấp) làm thẻ GCM không khớp và phong bì không mở được. Cùng lập
//       luận đã dựng `buildAad` ở `crypto-keys/src/local-dev-shared.ts`.
//   (2) `rfqId` đi vào INFO CỦA HKDF, không đi vào phong bì. Khoá nội dung vì thế là hàm của
//       (bí mật chung, thuật toán, RFQ). Một phong bì niêm phong cho RFQ A mà đem mở bằng ngữ
//       cảnh RFQ B cho ra một khoá KHÁC, và GCM từ chối — kể cả khi kẻ tấn công có đúng khoá
//       riêng của A. Đó là vế "lộ một RFQ không lan sang RFQ khác" của G2, ở dạng mật mã.
//
// VÌ SAO CHỈ DÙNG WebCrypto, KHÔNG DÙNG `node:crypto`: đúng mã này phải chạy được trong trình
// duyệt nhà cung cấp (ADR-007). Một bản cài bằng `node:crypto` sẽ là mã KHÁC với mã chạy thật,
// và mọi phép đo trên nó chỉ nói về máy chủ. `globalThis.crypto.subtle` có ở cả hai nơi.
// ==============================================================================================

// ----------------------------------------------------------------------------------------------
// KIỂU CỦA WebCrypto, VÀ VÌ SAO CHÚNG ĐƯỢC LẤY TỪ `node:crypto`
//
// `tsconfig.base.json` cố ý KHÔNG có `"DOM"` trong `lib`: dự án này là mã máy chủ, và mở DOM ra
// sẽ làm `document`, `window`, `localStorage` nhìn thấy được trong MỌI file — một bán kính ảnh
// hưởng lớn hơn nhiều so với năm dòng dưới đây.
//
// `import type` bị `verbatimModuleSyntax` xoá sạch lúc biên dịch, nên KHÔNG một byte nào của
// `node:crypto` đi vào gói tải xuống trình duyệt. Các kiểu trong `webcrypto` của Node chính là
// các kiểu của chuẩn WebCrypto — cùng một bề mặt mà `crypto.subtle` của trình duyệt cài đặt.
// ----------------------------------------------------------------------------------------------
import type { webcrypto } from "node:crypto";

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;
type SubtleCrypto = webcrypto.SubtleCrypto;
type ThamSoThoaThuan = webcrypto.EcKeyImportParams | webcrypto.AlgorithmIdentifier;

export const SEALED_ENVELOPE_FORMAT_VERSION = 1;

/** "TPSE" — TrustProcure Sealed Envelope. */
const MAGIC = Uint8Array.from([0x54, 0x50, 0x53, 0x45]);

const DAI_IV = 12;
const DAI_DAU_TOI_THIEU = MAGIC.length + 1 + 1 + 2;

export const KEY_AGREEMENT_ALGORITHMS = ["ECDH_P256", "X25519"] as const;
export type KeyAgreementAlgorithm = (typeof KEY_AGREEMENT_ALGORITHMS)[number];

/**
 * Mã một byte cho mỗi thuật toán. Đây là bảng ghim: một giá trị đã phát hành KHÔNG được đổi
 * nghĩa, vì phong bì cũ nằm trong CSDL và chúng tự khai bằng đúng con số này.
 */
const MA_THUAT_TOAN: Readonly<Record<KeyAgreementAlgorithm, number>> = {
  ECDH_P256: 1,
  X25519: 2,
};

const TU_MA: ReadonlyMap<number, KeyAgreementAlgorithm> = new Map(
  KEY_AGREEMENT_ALGORITHMS.map((t) => [MA_THUAT_TOAN[t], t]),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SealedEnvelopeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SealedEnvelopeError";
  }
}

/** Thứ đọc được từ một phong bì mà KHÔNG cần khoá nào. Phong bì phải tự khai. */
export interface SealedEnvelopeHeader {
  readonly formatVersion: number;
  readonly algorithm: KeyAgreementAlgorithm;
  readonly ephemeralPublicKey: Uint8Array;
}

interface PhongBiDaTach {
  readonly header: SealedEnvelopeHeader;
  readonly aad: Uint8Array;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export function assertRfqId(rfqId: string): void {
  if (!UUID_PATTERN.test(rfqId)) {
    throw new SealedEnvelopeError(`rfqId phải là UUID hợp lệ, nhận được: "${rfqId}".`);
  }
}

export function assertAlgorithm(value: string): asserts value is KeyAgreementAlgorithm {
  if (!(KEY_AGREEMENT_ALGORITHMS as readonly string[]).includes(value)) {
    throw new SealedEnvelopeError(`Thuật toán thoả thuận khoá không nhận ra: "${value}".`);
  }
}

/**
 * Dựng phần đầu (cũng CHÍNH LÀ AAD) — một chỗ duy nhất biết bố cục byte.
 *
 * Xuất ra ngoài có chủ đích: `seal.ts` cần đúng chuỗi byte này làm AAD. Cách thay thế là để
 * `seal.ts` tự ghép lại bố cục — tức hai bản chép của một bố cục, thứ sẽ lệch nhau vào ngày ai
 * đó thêm một trường.
 */
export function buildEnvelopeHeader(algorithm: KeyAgreementAlgorithm, ephPub: Uint8Array): Uint8Array {
  if (ephPub.length === 0 || ephPub.length > 0xffff) {
    throw new SealedEnvelopeError(`Khoá công khai phù du dài bất thường: ${ephPub.length} byte.`);
  }
  const dau = new Uint8Array(DAI_DAU_TOI_THIEU + ephPub.length);
  dau.set(MAGIC, 0);
  dau[4] = SEALED_ENVELOPE_FORMAT_VERSION;
  dau[5] = MA_THUAT_TOAN[algorithm];
  dau[6] = (ephPub.length >>> 8) & 0xff;
  dau[7] = ephPub.length & 0xff;
  dau.set(ephPub, DAI_DAU_TOI_THIEU);
  return dau;
}

export function encodeEnvelope(
  algorithm: KeyAgreementAlgorithm,
  ephemeralPublicKey: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  if (iv.length !== DAI_IV) {
    throw new SealedEnvelopeError(`IV phải dài đúng ${DAI_IV} byte, đang là ${iv.length}.`);
  }
  const dau = buildEnvelopeHeader(algorithm, ephemeralPublicKey);
  const ra = new Uint8Array(dau.length + iv.length + ciphertext.length);
  ra.set(dau, 0);
  ra.set(iv, dau.length);
  ra.set(ciphertext, dau.length + iv.length);
  return ra;
}

/**
 * Tách một phong bì. Mọi lỗi định dạng đều ném — KHÔNG có đường trả về `null` hay một phong bì
 * "mở một phần". Một phong bì không đọc được là một phong bì bị từ chối.
 */
export function decodeEnvelope(envelope: Uint8Array): PhongBiDaTach {
  if (envelope.length < DAI_DAU_TOI_THIEU) {
    throw new SealedEnvelopeError("Phong bì ngắn hơn cả phần đầu bắt buộc.");
  }
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (envelope[i] !== MAGIC[i]) {
      throw new SealedEnvelopeError("Đây không phải một phong bì niêm phong của TrustProcure.");
    }
  }
  const formatVersion = envelope[4] as number;
  if (formatVersion !== SEALED_ENVELOPE_FORMAT_VERSION) {
    throw new SealedEnvelopeError(
      `Phiên bản định dạng phong bì không hỗ trợ: ${formatVersion}.`,
    );
  }
  const algorithm = TU_MA.get(envelope[5] as number);
  if (algorithm === undefined) {
    throw new SealedEnvelopeError(`Mã thuật toán không nhận ra: ${envelope[5] as number}.`);
  }
  const ephLen = ((envelope[6] as number) << 8) | (envelope[7] as number);
  const hetDau = DAI_DAU_TOI_THIEU + ephLen;
  // Phong bì phải còn đủ chỗ cho IV VÀ ít nhất một thẻ GCM 16 byte. Không có phép kiểm này, một
  // phong bì bị cắt cụt đi tới tận `subtle.decrypt` rồi mới hỏng, với một thông báo của trình
  // duyệt thay vì của chúng ta.
  if (envelope.length < hetDau + DAI_IV + 16) {
    throw new SealedEnvelopeError("Phong bì bị cắt cụt.");
  }
  return {
    header: {
      formatVersion,
      algorithm,
      ephemeralPublicKey: envelope.slice(DAI_DAU_TOI_THIEU, hetDau),
    },
    aad: envelope.slice(0, hetDau),
    iv: envelope.slice(hetDau, hetDau + DAI_IV),
    ciphertext: envelope.slice(hetDau + DAI_IV),
  };
}

/**
 * [ADR-011, "Đo bằng gì" mục 3] PHONG BÌ PHẢI TỰ KHAI.
 *
 * Đọc được phần đầu mà KHÔNG cần khoá nào — đó là điều kiện để một phong bì cũ còn mở được sau
 * lần xoay thuật toán kế tiếp. Hàm này là thứ được xuất ra cửa công khai; `decodeEnvelope` thì
 * không, vì nó còn trả ra AAD/IV/ciphertext và ba thứ đó chỉ có nghĩa với đường mở.
 */
export function describeEnvelope(envelope: Uint8Array): SealedEnvelopeHeader {
  return decodeEnvelope(envelope).header;
}

// ----------------------------------------------------------------------------------------------
// PHẦN MẬT MÃ DÙNG CHUNG CHO CẢ HAI CHIỀU
//
// `format.ts` KHÔNG phải một `local-dev-shared.ts` thứ hai, và khác biệt ấy đáng nói ra vì hình
// dạng hai file rất giống nhau. `deriveOrgKey` ở crypto-keys là ĐỦ để tự giải mã nếu có master
// key, nên nó phải mang một quy tắc `g1-` riêng. Ở đây thì không: `deriveContentKey` đòi một
// KHOÁ RIÊNG dạng CryptoKey, và đường duy nhất tới khoá riêng đi qua `crypto-keys/src/unwrap.ts`
// — thứ đã bị canh. Vì vậy file này chỉ chịu quy tắc cửa công khai `g8-`, không có quy tắc riêng.
// ----------------------------------------------------------------------------------------------

function thamSoThuatToan(algorithm: KeyAgreementAlgorithm): ThamSoThoaThuan {
  return algorithm === "ECDH_P256" ? { name: "ECDH", namedCurve: "P-256" } : { name: "X25519" };
}

export function subtle(): SubtleCrypto {
  const c: webcrypto.Crypto | undefined = globalThis.crypto;
  if (c?.subtle === undefined) {
    // ADR-007 rủi ro số 1, ở dạng một thông điệp thay vì một `undefined is not a function`.
    throw new SealedEnvelopeError(
      "Môi trường này không có crypto.subtle nên không niêm phong được báo giá. " +
        "Hãy mở liên kết bằng trình duyệt của máy thay vì trong ứng dụng nhắn tin.",
    );
  }
  return c.subtle;
}

export async function generateEphemeralKeyPair(
  algorithm: KeyAgreementAlgorithm,
): Promise<CryptoKeyPair> {
  return (await subtle().generateKey(thamSoThuatToan(algorithm), true, [
    "deriveBits",
  ])) as CryptoKeyPair;
}

export async function importPublicKey(
  algorithm: KeyAgreementAlgorithm,
  spki: Uint8Array,
): Promise<CryptoKey> {
  try {
    return await subtle().importKey("spki", spki, thamSoThuatToan(algorithm), true, []);
  } catch (loi) {
    throw new SealedEnvelopeError(
      `Khoá công khai không đọc được theo thuật toán ${algorithm}.`,
      { cause: loi },
    );
  }
}

export async function importPrivateKey(
  algorithm: KeyAgreementAlgorithm,
  pkcs8: Uint8Array,
): Promise<CryptoKey> {
  try {
    return await subtle().importKey("pkcs8", pkcs8, thamSoThuatToan(algorithm), false, [
      "deriveBits",
    ]);
  } catch (loi) {
    throw new SealedEnvelopeError(`Khoá riêng không đọc được theo thuật toán ${algorithm}.`, {
      cause: loi,
    });
  }
}

/**
 * Bí mật chung -> khoá nội dung AES-256-GCM, qua HKDF-SHA256.
 *
 * `info` mang cả thuật toán LẪN `rfqId`: xem ràng buộc (2) ở đầu file. Nó là chỗ G2 được cưỡng
 * chế bằng mật mã chứ không bằng một câu `if`.
 */
export async function deriveContentKey(
  algorithm: KeyAgreementAlgorithm,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  rfqId: string,
): Promise<CryptoKey> {
  assertRfqId(rfqId);
  const s = subtle();
  const biMatChung = await s.deriveBits(
    { name: algorithm === "ECDH_P256" ? "ECDH" : "X25519", public: publicKey },
    privateKey,
    256,
  );
  const khoaHkdf = await s.importKey("raw", biMatChung, "HKDF", false, ["deriveKey"]);
  const info = new TextEncoder().encode(
    `trustprocure/sealed-envelope/v${SEALED_ENVELOPE_FORMAT_VERSION}|${algorithm}|${rfqId.toLowerCase()}`,
  );
  return await s.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
    khoaHkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export { DAI_IV as IV_LENGTH };
