// ==============================================================================================
// apps/public-keys/src/cau-hinh.ts — CẤU HÌNH TỪ MÔI TRƯỜNG, FAIL-CLOSED
//
// [S1.128 / khoản 15] Cùng khuôn `apps/api/src/cau-hinh.ts` và `apps/unseal-worker/src/cau-hinh.ts`
// (ADR-021): một hàm THUẦN nhận bản đồ tên → chuỗi, trả cấu hình đã kiểm hình dạng hoặc ném
// `CauHinhError`. Không đọc `process.env`, không gọi KMS, không dựng máy chủ.
//
// CÙNG TÊN BIẾN VỚI `apps/api`, CÓ CHỦ Ý: tiến trình này công bố ĐÚNG khoá mà `api` ký. Hai tiến
// trình đọc hai tên khác nhau cho cùng một sự thật là hai tiến trình sẽ lệch nhau.
//   - `local-dev`: `TRUSTPROCURE_RECEIPT_SIGNING_KEYS` / `_ACTIVE` — nguyên định dạng của `api`
//     (`kid=<PKCS8 DER base64>,…`). Nửa công khai được DẪN RA ở đây, và khoá riêng KHÔNG đi ra khỏi
//     hàm này: cấu hình trả về chỉ mang SPKI. (Nó vẫn còn trong `process.env` của tiến trình — giá
//     của việc dùng chung một tệp env dev với `api`; hàng rào `assertLocalDevAllowed` ở `tien-trinh.ts`
//     giữ adapter này khỏi production.)
//   - `aws-kms`: `TRUSTPROCURE_AWS_REGION` (tên của `api`, KHÔNG `…_KMS_REGION`), `TRUSTPROCURE_KMS_RECEIPT_KID`
//     (cùng nghĩa với `api`: `kid` đang ký), và biến RIÊNG của tiến trình này
//     `TRUSTPROCURE_KMS_RECEIPT_KEYS` = `kid=keyId,kid=keyId` — MỌI `kid` phải công bố, kể cả khoá
//     cũ (ADR-011 mục 3). `api` chỉ cần một CMK (khoá đang ký); tiến trình này cần cả lịch sử.
//
// BỐN QUY TẮC:
//   ⑴ Không có mặc định cho khoá. Thiếu là ném.
//   ⑵ Thông điệp lỗi chỉ nêu TÊN biến, không bao giờ nêu GIÁ TRỊ — dưới `local-dev` giá trị là khoá
//      riêng. Chặt hơn `api` một nấc: tên adapter lạ cũng không được vọng lại.
//   ⑶ Adapter phải được KHAI TÊN; một tên lạ là ném, không rơi về bản dev.
//   ⑷ [ADR-064] Hai bộ biến khoá LOẠI TRỪ nhau.
// ==============================================================================================

import { createPrivateKey, createPublicKey } from "node:crypto";
import type { KhoaKmsCongBo } from "./nguon-kms.js";

export class CauHinhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauHinhError";
  }
}

interface CauHinhChung {
  /** Mặc định `127.0.0.1`: một tiến trình dev không tự phơi ra mạng. Container khai `0.0.0.0`. */
  readonly listenHost: string;
  /** Mặc định 8091. `0` = cổng ngẫu nhiên (test). */
  readonly listenPort: number;
}

export interface NguonLocalDev {
  readonly keyAdapter: "local-dev";
  /** CHỈ nửa công khai (SPKI DER) theo `kid` — khoá riêng không qua được cửa này. */
  readonly receiptKeys: { readonly active: string; readonly publicKeys: ReadonlyMap<string, Uint8Array> };
}

export interface NguonAwsKms {
  readonly keyAdapter: "aws-kms";
  readonly kms: { readonly region: string; readonly khoa: readonly KhoaKmsCongBo[]; readonly activeKid: string };
}

export type CauHinhPublicKeys = CauHinhChung & (NguonLocalDev | NguonAwsKms);

type MoiTruong = Readonly<Record<string, string | undefined>>;

const HOST_MAC_DINH = "127.0.0.1";
const CONG_MAC_DINH = 8091;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
/** Cùng hình dạng `KID_PATTERN` của bộ ký; `nguon-kms.ts` kiểm lại bằng chính `assertReceiptKid`. */
const KID = /^[A-Za-z0-9._:-]{1,64}$/u;
/** Cùng phép kiểm `docKeyIdKms` của `api`: alias/…, key id hay ARN. */
const KEY_ID = /^[A-Za-z0-9/:_.-]{1,2048}$/u;
const VUNG_AWS = /^[a-z]{2}(?:-[a-z]+)+-\d$/u;

const BIEN_LOCAL_DEV = ["TRUSTPROCURE_RECEIPT_SIGNING_KEYS", "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE"] as const;
const BIEN_KMS = ["TRUSTPROCURE_AWS_REGION", "TRUSTPROCURE_KMS_RECEIPT_KEYS", "TRUSTPROCURE_KMS_RECEIPT_KID"] as const;

function tuyChon(env: MoiTruong, ten: string): string | undefined {
  const v = env[ten]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function bat(env: MoiTruong, ten: string): string {
  const v = tuyChon(env, ten);
  if (v === undefined) throw new CauHinhError(`thiếu biến môi trường ${ten}`);
  return v;
}

/** `a=b,c=d` → cặp theo thứ tự khai. Mục rỗng bỏ qua; mục thiếu `=` là lỗi. */
function tachCap(tho: string, ten: string, dang: string): Array<readonly [string, string]> {
  const ra: Array<readonly [string, string]> = [];
  for (const muc of tho.split(",")) {
    const m = muc.trim();
    if (m === "") continue;
    const dau = m.indexOf("=");
    if (dau <= 0) throw new CauHinhError(`${ten}: mỗi mục phải có dạng ${dang}`);
    ra.push([m.slice(0, dau).trim(), m.slice(dau + 1).trim()]);
  }
  if (ra.length === 0) throw new CauHinhError(`${ten}: không có mục nào`);
  return ra;
}

function docLocalDev(env: MoiTruong): NguonLocalDev {
  const ten = "TRUSTPROCURE_RECEIPT_SIGNING_KEYS";
  const cap = tachCap(bat(env, ten), ten, "<kid>=<PKCS8 DER base64>");
  const active = bat(env, "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE");
  const publicKeys = new Map<string, Uint8Array>();
  for (const [kid, b64] of cap) {
    if (!KID.test(kid)) throw new CauHinhError(`${ten}: một kid không hợp lệ (1–64 ký tự [A-Za-z0-9._:-])`);
    if (publicKeys.has(kid)) throw new CauHinhError(`${ten}: kid "${kid}" khai hai lần`);
    if (!BASE64.test(b64) || b64.length % 4 !== 0) {
      throw new CauHinhError(`${ten}: giá trị của kid "${kid}" không phải base64 chuẩn (có đệm)`);
    }
    let rieng;
    try {
      rieng = createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
    } catch {
      throw new CauHinhError(`${ten}: khoá "${kid}" không đọc được theo PKCS8 DER`);
    }
    if (rieng.asymmetricKeyType !== "ec" || rieng.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new CauHinhError(`${ten}: khoá "${kid}" phải là EC P-256 (ADR-011 mục 2)`);
    }
    publicKeys.set(kid, new Uint8Array(createPublicKey(rieng).export({ format: "der", type: "spki" })));
  }
  if (!publicKeys.has(active)) {
    throw new CauHinhError(`TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: kid đang dùng không có trong ${ten}`);
  }
  return { keyAdapter: "local-dev", receiptKeys: { active, publicKeys } };
}

function docAwsKms(env: MoiTruong): NguonAwsKms {
  const region = bat(env, "TRUSTPROCURE_AWS_REGION");
  if (!VUNG_AWS.test(region)) throw new CauHinhError("TRUSTPROCURE_AWS_REGION không phải một vùng AWS hợp lệ");
  const ten = "TRUSTPROCURE_KMS_RECEIPT_KEYS";
  const khoa: KhoaKmsCongBo[] = [];
  for (const [kid, keyId] of tachCap(bat(env, ten), ten, "<kid>=<định danh CMK>")) {
    if (!KID.test(kid)) throw new CauHinhError(`${ten}: một kid không hợp lệ (1–64 ký tự [A-Za-z0-9._:-])`);
    if (!KEY_ID.test(keyId)) throw new CauHinhError(`${ten}: kid "${kid}" không mang một định danh CMK hợp lệ`);
    if (khoa.some((k) => k.kid === kid)) throw new CauHinhError(`${ten}: kid "${kid}" khai hai lần`);
    if (khoa.some((k) => k.keyId === keyId)) throw new CauHinhError(`${ten}: kid "${kid}" trỏ một CMK đã khai cho kid khác`);
    khoa.push({ kid, keyId });
  }
  const activeKid = bat(env, "TRUSTPROCURE_KMS_RECEIPT_KID");
  if (!khoa.some((k) => k.kid === activeKid)) {
    throw new CauHinhError(`TRUSTPROCURE_KMS_RECEIPT_KID: kid đang dùng không có trong ${ten}`);
  }
  return { keyAdapter: "aws-kms", kms: { region, khoa, activeKid } };
}

function tuChoiBienCuaAdapterKhac(env: MoiTruong, adapter: string, bienKhac: readonly string[]): void {
  const sot = bienKhac.filter((b) => tuyChon(env, b) !== undefined);
  if (sot.length > 0) {
    throw new CauHinhError(
      `TRUSTPROCURE_KEY_ADAPTER="${adapter}" nhưng còn khai ${sot.join(", ")} của adapter khoá kia — ` +
        'một cấu hình không được mang hai câu trả lời cho câu "khoá ở đâu" (ADR-064)',
    );
  }
}

function docCong(env: MoiTruong, ten: string): number {
  const v = tuyChon(env, ten);
  if (v === undefined) return CONG_MAC_DINH;
  if (!/^\d{1,5}$/u.test(v) || Number(v) > 65535) throw new CauHinhError(`${ten} phải là một số cổng 0–65535`);
  return Number(v);
}

export function docCauHinh(env: MoiTruong): CauHinhPublicKeys {
  const adapter = bat(env, "TRUSTPROCURE_KEY_ADAPTER");
  let nguon: NguonLocalDev | NguonAwsKms;
  if (adapter === "local-dev") {
    tuChoiBienCuaAdapterKhac(env, adapter, BIEN_KMS);
    nguon = docLocalDev(env);
  } else if (adapter === "aws-kms") {
    tuChoiBienCuaAdapterKhac(env, adapter, BIEN_LOCAL_DEV);
    nguon = docAwsKms(env);
  } else {
    throw new CauHinhError(
      'TRUSTPROCURE_KEY_ADAPTER khai một adapter khoá CHƯA CÓ trong kho — hôm nay chỉ có "local-dev", "aws-kms". ' +
        "Không rơi về bản dev trong im lặng.",
    );
  }
  return {
    ...nguon,
    listenHost: tuyChon(env, "TRUSTPROCURE_PUBLIC_KEYS_HOST") ?? HOST_MAC_DINH,
    listenPort: docCong(env, "TRUSTPROCURE_PUBLIC_KEYS_PORT"),
  };
}
