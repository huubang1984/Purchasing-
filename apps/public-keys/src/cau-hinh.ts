// ==============================================================================================
// apps/public-keys/src/cau-hinh.ts — CẤU HÌNH TỪ MÔI TRƯỜNG, FAIL-CLOSED (ADR-070)
//
// Tiến trình công bố nhận ĐÚNG nửa công khai, không gì khác: không khoá riêng, không quyền KMS, không CSDL.
// Dưới `aws-kms`, nửa công khai do stack Terraform 50 đọc bằng KeyAdmin (`GetPublicKey`) rồi stack 90 chuyển
// vào đây; ở máy phát triển, người vận hành dán SPKI của vòng khoá local-dev.
//
//   TRUSTPROCURE_RECEIPT_PUBLIC_KEYS   JSON `{ "<kid>": "<SPKI DER base64>", … }` — MỌI khoá đã từng ký,
//                                      không chỉ khoá đang dùng (ADR-011 mục 3: biên nhận cũ vẫn phải kiểm được)
//   TRUSTPROCURE_RECEIPT_ACTIVE_KID    kid đang ký, phải có trong danh sách trên
//   TRUSTPROCURE_PUBLIC_KEYS_HOST      mặc định 127.0.0.1
//   TRUSTPROCURE_PUBLIC_KEYS_PORT      mặc định 8070
//
// Mỗi SPKI phải là khoá EC P-256 — một khoá khác loại ném lúc khởi động, không phải lúc nhà cung cấp kiểm.
// Thông điệp lỗi nêu TÊN biến và kid, không nêu giá trị khoá.
// ==============================================================================================

import { createPublicKey } from "node:crypto";

export class CauHinhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauHinhError";
  }
}

export interface CauHinhPublicKeys {
  readonly listenHost: string;
  readonly listenPort: number;
  readonly activeKeyId: string;
  readonly publicKeys: ReadonlyMap<string, Uint8Array>;
}

type MoiTruong = Readonly<Record<string, string | undefined>>;

/** Cùng hình dạng `assertReceiptKid` của `@trustprocure/bidding`: kid đi nguyên văn vào văn bản đã ký. */
const KID = /^[A-Za-z0-9._:-]{1,64}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

function doc(env: MoiTruong, ten: string): string | undefined {
  const v = env[ten];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function bat(env: MoiTruong, ten: string): string {
  const v = doc(env, ten);
  if (v === undefined) throw new CauHinhError(`${ten}: thiếu`);
  return v;
}

function docSpki(kid: string, b64: unknown): Uint8Array {
  if (typeof b64 !== "string" || !BASE64.test(b64)) {
    throw new CauHinhError(`TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: khoá "${kid}" không phải base64`);
  }
  const der = new Uint8Array(Buffer.from(b64, "base64"));
  let khoa;
  try {
    khoa = createPublicKey({ key: Buffer.from(der), format: "der", type: "spki" });
  } catch {
    throw new CauHinhError(`TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: khoá "${kid}" không phải SPKI DER`);
  }
  if (khoa.asymmetricKeyType !== "ec" || khoa.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new CauHinhError(`TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: khoá "${kid}" phải là EC P-256`);
  }
  return der;
}

export function docCauHinh(env: MoiTruong): CauHinhPublicKeys {
  let tho: unknown;
  try {
    tho = JSON.parse(bat(env, "TRUSTPROCURE_RECEIPT_PUBLIC_KEYS"));
  } catch (e) {
    if (e instanceof CauHinhError) throw e;
    throw new CauHinhError("TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: không phải JSON");
  }
  if (typeof tho !== "object" || tho === null || Array.isArray(tho)) {
    throw new CauHinhError("TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: phải là một đối tượng JSON { kid: spki }");
  }
  const publicKeys = new Map<string, Uint8Array>();
  for (const [kid, b64] of Object.entries(tho as Record<string, unknown>)) {
    if (!KID.test(kid)) throw new CauHinhError("TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: có một kid không hợp lệ");
    publicKeys.set(kid, docSpki(kid, b64));
  }
  if (publicKeys.size === 0) throw new CauHinhError("TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: rỗng");
  const activeKeyId = bat(env, "TRUSTPROCURE_RECEIPT_ACTIVE_KID");
  if (!publicKeys.has(activeKeyId)) {
    throw new CauHinhError("TRUSTPROCURE_RECEIPT_ACTIVE_KID: không có trong TRUSTPROCURE_RECEIPT_PUBLIC_KEYS");
  }
  const congTho = doc(env, "TRUSTPROCURE_PUBLIC_KEYS_PORT");
  if (congTho !== undefined && !/^\d{1,5}$/u.test(congTho)) throw new CauHinhError("TRUSTPROCURE_PUBLIC_KEYS_PORT: phải là số cổng");
  const listenPort = congTho === undefined ? 8070 : Number(congTho);
  if (listenPort < 1 || listenPort > 65535) throw new CauHinhError("TRUSTPROCURE_PUBLIC_KEYS_PORT: ngoài khoảng 1–65535");
  return {
    listenHost: doc(env, "TRUSTPROCURE_PUBLIC_KEYS_HOST") ?? "127.0.0.1",
    listenPort,
    activeKeyId,
    publicKeys,
  };
}
