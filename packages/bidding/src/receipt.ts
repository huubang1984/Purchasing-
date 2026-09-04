// ==============================================================================================
// BIÊN NHẬN NỘP THẦU — VĂN BẢN CHÍNH TẮC, CHỮ KÝ KHOÁ CÔNG KHAI
//
// Đây là chỗ ADR-011 mục 2 trở thành byte, và câu chịu lực của cả file là một câu về ĐỊNH DẠNG
// chứ không về thuật toán:
//
//   Một đối tượng JSON KHÔNG có dạng byte chính tắc. Ký một JSON là ký MỘT TRONG NHIỀU chuỗi byte
//   biểu diễn cùng dữ liệu, nên bên kiểm chứng phải dựng lại ĐÚNG chuỗi ấy — tức phải cài lại bộ
//   mã hoá của chính bên bị kiểm chứng. Lúc đó "kiểm chứng độc lập" (B2) không còn độc lập.
//
// Văn bản chính tắc gỡ bỏ toàn bộ vế ấy. Nhà cung cấp lưu hai tệp và chạy đúng một lệnh:
//
//   openssl dgst -sha256 -verify khoa-cong-khai.pem -signature bien-nhan.sig bien-nhan.txt
//
// File này KHÔNG import gì ngoài thư viện chuẩn của nền tảng — không `pg`, không `node:crypto`.
// Nó phải chạy được trong trình duyệt của nhà cung cấp, vì đó là đường kiểm chứng THỨ NHẤT;
// `openssl` là đường thứ hai. ADR-011 mục 2 chọn `ECDSA P-256` chính vì đường thứ nhất: ai nộp
// được thầu (đường nộp đã đòi họ P-256) thì kiểm chứng được, không thêm một phép dò nào.
// ==============================================================================================

import type { webcrypto } from "node:crypto";

export const RECEIPT_FORMAT_LABEL = "trustprocure-receipt-v1";
export const RECEIPT_SIGNING_ALGORITHM = "ECDSA_P256_SHA256";

/** Thứ tự trường là MỘT PHẦN CỦA ĐỊNH DẠNG. Đổi thứ tự là đổi thứ được ký. */
const TRUONG = [
  "alg",
  "kid",
  "rfq_id",
  "bid_id",
  "version",
  "ciphertext_sha256",
  "submitted_at",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const THOI_GIAN_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
/** `kid` đi vào một dòng `khoa=gia-tri`, nên nó không được mang `\n` hay `=`. */
const KID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export class ReceiptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReceiptError";
  }
}

export interface ReceiptFields {
  readonly kid: string;
  readonly rfqId: string;
  readonly bidId: string;
  readonly version: number;
  /** `sha256(envelope)`, 64 ký tự hex THƯỜNG. */
  readonly ciphertextSha256: string;
  /** Dấu thời gian do POSTGRES định dạng — xem `public.bid_dau_thoi_gian_chinh_tac` (018). */
  readonly submittedAt: string;
}

function batBuoc(dieuKien: boolean, thongDiep: string): void {
  if (!dieuKien) throw new ReceiptError(thongDiep);
}

/**
 * Dựng văn bản chính tắc. Kết thúc bằng **một `\n`**, và đó là một quyết định chứ không phải một
 * sơ suất: hầu hết trình soạn thảo tự thêm một dòng trắng cuối tệp, nên một định dạng KHÔNG có
 * `\n` cuối sẽ hỏng ngay khi nhà cung cấp lưu tệp bằng công cụ của họ — đúng lúc B2 cần hoạt động.
 */
export function buildReceiptText(fields: ReceiptFields): string {
  batBuoc(KID_PATTERN.test(fields.kid), `kid không hợp lệ: "${fields.kid}".`);
  batBuoc(UUID_PATTERN.test(fields.rfqId), `rfq_id phải là UUID thường: "${fields.rfqId}".`);
  batBuoc(UUID_PATTERN.test(fields.bidId), `bid_id phải là UUID thường: "${fields.bidId}".`);
  batBuoc(
    Number.isInteger(fields.version) && fields.version > 0,
    `version phải là số nguyên dương: ${fields.version}.`,
  );
  batBuoc(
    HEX64_PATTERN.test(fields.ciphertextSha256),
    "ciphertext_sha256 phải là 64 ký tự hex thường.",
  );
  batBuoc(
    THOI_GIAN_PATTERN.test(fields.submittedAt),
    `submitted_at phải đủ micro-giây và kết thúc bằng Z: "${fields.submittedAt}". ` +
      "Nó phải lấy TỪ Postgres, không dựng từ Date của JavaScript (Date chỉ tới mili-giây).",
  );

  const giaTri: Readonly<Record<(typeof TRUONG)[number], string>> = {
    alg: RECEIPT_SIGNING_ALGORITHM,
    kid: fields.kid,
    rfq_id: fields.rfqId,
    bid_id: fields.bidId,
    version: String(fields.version),
    ciphertext_sha256: fields.ciphertextSha256,
    submitted_at: fields.submittedAt,
  };

  const dong = [RECEIPT_FORMAT_LABEL, ...TRUONG.map((t) => `${t}=${giaTri[t]}`)];
  // Kiểm lần cuối trên chính chuỗi sắp ký. Mọi trường ở trên đã qua regex nên không thể mang
  // `\n`, nhưng phép kiểm này không dựa vào lập luận ấy: một trường MỚI thêm vào sau này mà quên
  // regex sẽ chèn được một dòng giả vào văn bản đã ký, và đây là chỗ duy nhất bắt được nó.
  for (const d of dong) {
    batBuoc(!d.includes("\n") && !d.includes("\r"), "Một trường của biên nhận chứa ký tự xuống dòng.");
  }
  return dong.join("\n") + "\n";
}

/**
 * Đọc ngược một văn bản chính tắc. Dùng cho kiểm chứng và tra cứu — KHÔNG dùng để dựng lại văn
 * bản rồi ký lại: thứ được ký là chuỗi byte đã lưu, không phải kết quả của một vòng phân tích.
 */
export function parseReceiptText(text: string): ReceiptFields & { readonly alg: string } {
  batBuoc(text.endsWith("\n"), "Văn bản biên nhận phải kết thúc bằng một dòng mới.");
  const dong = text.slice(0, -1).split("\n");
  batBuoc(dong[0] === RECEIPT_FORMAT_LABEL, "Đây không phải một biên nhận TrustProcure v1.");
  batBuoc(dong.length === TRUONG.length + 1, `Biên nhận phải có đúng ${TRUONG.length + 1} dòng.`);

  const doc: Record<string, string> = {};
  for (let i = 0; i < TRUONG.length; i += 1) {
    const d = dong[i + 1] ?? "";
    const vt = d.indexOf("=");
    batBuoc(vt > 0, `Dòng ${i + 1} không có dạng khoa=gia-tri.`);
    const khoa = d.slice(0, vt);
    batBuoc(khoa === TRUONG[i], `Dòng ${i + 1} phải là "${TRUONG[i]}", đang là "${khoa}".`);
    doc[khoa] = d.slice(vt + 1);
  }

  const version = Number(doc["version"]);
  batBuoc(Number.isInteger(version) && version > 0, "version không phải số nguyên dương.");
  return {
    alg: doc["alg"] ?? "",
    kid: doc["kid"] ?? "",
    rfqId: doc["rfq_id"] ?? "",
    bidId: doc["bid_id"] ?? "",
    version,
    ciphertextSha256: doc["ciphertext_sha256"] ?? "",
    submittedAt: doc["submitted_at"] ?? "",
  };
}

// ----------------------------------------------------------------------------------------------
// DER ↔ RAW — MỘT KHE INTEROP CÓ THẬT, VÀ NÓ SILENT NẾU KHÔNG AI NHÌN
//
// `crypto.subtle` của WebCrypto dùng chữ ký ECDSA dạng **RAW**: `r || s`, mỗi phần đúng 32 byte.
// `openssl`, `node:crypto` và AWS KMS dùng dạng **DER** (`SEQUENCE { INTEGER r, INTEGER s }`).
// Hai dạng KHÔNG hoán đổi được, và sai dạng cho ra "chữ ký không hợp lệ" — thông điệp giống hệt
// thông điệp của một chữ ký bị giả mạo.
//
// Dự án lưu **DER**, vì DER là thứ `openssl dgst -verify` đọc được và là thứ KMS trả về. Bên kiểm
// chứng trong trình duyệt phải đổi sang RAW, và đó là hai hàm dưới đây.
// ----------------------------------------------------------------------------------------------

const DAI_TOA_DO = 32;

function bo0DauVaCanTrai(x: Uint8Array): Uint8Array {
  let i = 0;
  while (i < x.length - 1 && x[i] === 0) i += 1;
  const than = x.subarray(i);
  if (than.length > DAI_TOA_DO) {
    throw new ReceiptError("Toạ độ của chữ ký dài hơn 32 byte — không phải P-256.");
  }
  const ra = new Uint8Array(DAI_TOA_DO);
  ra.set(than, DAI_TOA_DO - than.length);
  return ra;
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` → `r || s` 64 byte. */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  let i = 0;
  const doc = (): number => {
    const b = der[i];
    if (b === undefined) throw new ReceiptError("Chữ ký DER bị cắt cụt.");
    i += 1;
    return b;
  };
  if (doc() !== 0x30) throw new ReceiptError("Chữ ký DER không bắt đầu bằng SEQUENCE.");
  const daiSeq = doc();
  if (daiSeq > 0x80) throw new ReceiptError("Chữ ký DER dài bất thường cho P-256.");
  if (daiSeq !== der.length - 2) throw new ReceiptError("Độ dài SEQUENCE không khớp.");

  const docSo = (): Uint8Array => {
    if (doc() !== 0x02) throw new ReceiptError("Chữ ký DER thiếu một INTEGER.");
    const n = doc();
    if (n === 0 || i + n > der.length) throw new ReceiptError("INTEGER của chữ ký DER hỏng.");
    const ra = der.subarray(i, i + n);
    i += n;
    return ra;
  };
  const r = bo0DauVaCanTrai(docSo());
  const s = bo0DauVaCanTrai(docSo());
  if (i !== der.length) throw new ReceiptError("Chữ ký DER có byte thừa ở cuối.");

  const ra = new Uint8Array(DAI_TOA_DO * 2);
  ra.set(r, 0);
  ra.set(s, DAI_TOA_DO);
  return ra;
}

function soThanhDer(x: Uint8Array): Uint8Array {
  let i = 0;
  while (i < x.length - 1 && x[i] === 0) i += 1;
  const than = x.subarray(i);
  // DER dùng số nguyên CÓ DẤU: byte đầu ≥ 0x80 phải được đệm một byte 0, nếu không nó thành số âm.
  const canDem = (than[0] ?? 0) >= 0x80;
  const noiDung = new Uint8Array(than.length + (canDem ? 1 : 0));
  noiDung.set(than, canDem ? 1 : 0);
  const ra = new Uint8Array(2 + noiDung.length);
  ra[0] = 0x02;
  ra[1] = noiDung.length;
  ra.set(noiDung, 2);
  return ra;
}

/** `r || s` 64 byte → DER `SEQUENCE { INTEGER r, INTEGER s }`. */
export function rawToDerSignature(raw: Uint8Array): Uint8Array {
  if (raw.length !== DAI_TOA_DO * 2) {
    throw new ReceiptError(`Chữ ký RAW phải dài đúng 64 byte, đang là ${raw.length}.`);
  }
  const r = soThanhDer(raw.subarray(0, DAI_TOA_DO));
  const s = soThanhDer(raw.subarray(DAI_TOA_DO));
  const than = r.length + s.length;
  if (than > 0x7f) throw new ReceiptError("Chữ ký DER dài bất thường cho P-256.");
  const ra = new Uint8Array(2 + than);
  ra[0] = 0x30;
  ra[1] = than;
  ra.set(r, 2);
  ra.set(s, 2 + r.length);
  return ra;
}

// ----------------------------------------------------------------------------------------------
// KIỂM CHỨNG — CHỈ CẦN BA THỨ, VÀ KHÔNG THỨ NÀO TRONG BA CHỈ MÁY CHỦ MỚI CÓ
// ----------------------------------------------------------------------------------------------

type SubtleCrypto = webcrypto.SubtleCrypto;

function subtle(): SubtleCrypto {
  const c: webcrypto.Crypto | undefined = globalThis.crypto;
  if (c?.subtle === undefined) {
    throw new ReceiptError(
      "Môi trường này không có crypto.subtle nên không kiểm chứng được biên nhận. " +
        "Cách khác: lưu biên nhận và chữ ký ra tệp rồi chạy `openssl dgst -sha256 -verify`.",
    );
  }
  return c.subtle;
}

export interface VerifyReceiptInput {
  /** ĐÚNG chuỗi đã được ký, lấy nguyên văn từ `bid_receipts.canonical_text`. */
  readonly canonicalText: string;
  /** Chữ ký dạng DER. */
  readonly signature: Uint8Array;
  /** Khoá công khai dạng SPKI DER — thứ `GetPublicKey` của KMS trả về. */
  readonly publicKey: Uint8Array;
}

/**
 * [B2] Kiểm chứng một biên nhận bằng **khoá công khai một mình**.
 *
 * Ba tham số, và không tham số nào là thứ chỉ máy chủ mới có. Đó chính là điều kiện mà
 * §"Rủi ro của việc để mở" của ADR-011 đặt ra để B2 không bị vi phạm trong im lặng: *"test của B2
 * phải kiểm chứng bằng khoá công khai một mình, không được chạm vào bất cứ thứ gì chỉ máy chủ mới
 * có"*. Hàm này KHÔNG nhận `client`, KHÔNG nhận `orgId`, KHÔNG nhận vòng khoá.
 *
 * Trả `false` chứ không ném khi chữ ký sai — sai chữ ký là một CÂU TRẢ LỜI, không phải một sự cố.
 * Nó ném khi đầu vào không đọc được (văn bản hỏng, DER hỏng, khoá hỏng): đó là hai ca khác nhau
 * và gộp chúng lại sẽ giấu mất lỗi lập trình dưới lớp "chữ ký không hợp lệ".
 */
export async function verifyReceipt(input: VerifyReceiptInput): Promise<boolean> {
  const truong = parseReceiptText(input.canonicalText);
  if (truong.alg !== RECEIPT_SIGNING_ALGORITHM) {
    throw new ReceiptError(`Biên nhận khai thuật toán không hỗ trợ: "${truong.alg}".`);
  }
  const raw = derToRawSignature(input.signature);
  const s = subtle();
  let khoa: webcrypto.CryptoKey;
  try {
    khoa = await s.importKey(
      "spki",
      input.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
  } catch (loi) {
    throw new ReceiptError("Khoá công khai không đọc được theo ECDSA P-256.", { cause: loi });
  }
  return await s.verify(
    { name: "ECDSA", hash: "SHA-256" },
    khoa,
    raw,
    new TextEncoder().encode(input.canonicalText),
  );
}

/** `sha256` của một chuỗi byte, dạng hex thường — khuôn của trường `ciphertext_sha256`. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const bam = new Uint8Array(await subtle().digest("SHA-256", data));
  let ra = "";
  for (const b of bam) ra += b.toString(16).padStart(2, "0");
  return ra;
}
