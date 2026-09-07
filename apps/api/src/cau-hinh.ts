// ==============================================================================================
// apps/api/src/cau-hinh.ts — CẤU HÌNH TỪ MÔI TRƯỜNG, FAIL-CLOSED, KHÔNG MẶC ĐỊNH CHO BÍ MẬT
//
// [ADR-021] Một hàm THUẦN: nhận một bản đồ tên → chuỗi (trong sản xuất là `process.env`), trả về
// một `CauHinhApi` đã kiểm hình dạng, hoặc ném `CauHinhError`. Nó không đọc `process.env` trực
// tiếp, không chạm CSDL, không dựng adapter — dựng là việc của `composition.ts`. Tách như vậy để
// mọi ca "thiếu biến", "sai độ dài", "hai vòng khoá trùng nhau" đo được ở T1, không cần một tiến
// trình.
//
// BA QUY TẮC, mỗi quy tắc có test:
//   ⑴ Bí mật KHÔNG có mặc định. Thiếu là ném, không phải "dùng khoá dev". Một mặc định cho khoá
//      chính là đúng thứ hàng rào `assertLocalDevAllowed` (crypto-keys, MED-1) tồn tại để chặn.
//   ⑵ Thông điệp lỗi chỉ nêu TÊN biến, không bao giờ nêu GIÁ TRỊ — lỗi khởi động đi thẳng ra log.
//   ⑶ Adapter phải được KHAI TÊN (`TRUSTPROCURE_KEY_ADAPTER`, `TRUSTPROCURE_SENDER_ADAPTER`), và hôm
//      nay mỗi biến chỉ có ĐÚNG MỘT giá trị hợp lệ (`local-dev`, `dev-mailbox`). Một giá trị khác
//      ("kms", "ses") là lời khai về một adapter CHƯA TỒN TẠI — ném với đúng câu ấy, thay vì im
//      lặng rơi về bản dev. Đó là phần chênh của S1.11 và nó được nói ra ở chỗ nó sẽ nổ.
//
// VÌ SAO BA VÒNG BÍ MẬT PHẢI ĐÔI MỘT KHÁC NHAU: `TotpSecretUnsealer` (identity) ghi hợp đồng "không
// được dùng chung vòng khoá chính với bộ mở phong bì thầu" (G1/ADR-006); pepper OTP (ADR-018) là
// khoá HMAC giữ ngoài CSDL. Dùng một chuỗi base64 cho cả ba biến là lỗi dán-chép dễ nhất trong vận
// hành, và nó biến ba khoá thành một — phép kiểm ở đây làm lỗi ấy nổ lúc khởi động.
// ==============================================================================================

import { createPrivateKey, createPublicKey, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ReceiptKeyPair } from "@trustprocure/bidding";
import { DiaChiError, taoDanhSachTinCay } from "./dia-chi.js";

export class CauHinhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauHinhError";
  }
}

/** Một vòng bí mật 32 byte có phiên bản — hình dạng chung của `MasterKeyRing` và `PepperRing`. */
export interface VongBiMat {
  readonly active: string;
  readonly keys: Readonly<Record<string, Buffer>>;
}

export interface VongKhoaKy {
  readonly active: string;
  readonly keys: Readonly<Record<string, ReceiptKeyPair>>;
}

export interface CauHinhApi {
  /** `postgres://app_api_login:...@host/db` — role ĐĂNG NHẬP thành viên của `app_api`; pool tự `SET ROLE`. */
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  readonly listenHost: string;
  readonly listenPort: number;
  /** Gốc của `/login#<token>` và `/i#<token>` (ADR-020 mục 3). `https:` — `http:` chỉ cho localhost. */
  readonly publicBaseUrl: string;
  /** [review M-3] Origin được phép gửi yêu cầu không-GET kèm cookie. Rỗng = mọi trình duyệt bị 403. */
  readonly allowedOrigins: readonly string[];
  /**
   * [sổ nợ 41] CIDR của proxy/LB đứng trước api. Rỗng = không có proxy, `X-Forwarded-For` bị bỏ qua.
   * Khai sai ở đây là khai một kẻ lạ được quyền nói "khách là ai" — nên mỗi mục được kiểm hình dạng
   * lúc khởi động (`dia-chi.ts`).
   */
  readonly trustedProxies: readonly string[];
  readonly keyAdapter: "local-dev";
  /** Vòng khoá chính bọc khoá riêng RFQ (ADR-019). */
  readonly masterKeys: VongBiMat;
  /** Vòng khoá chính bọc bí mật TOTP — CMK RIÊNG, không được trùng vòng trên. */
  readonly totpMasterKeys: VongBiMat;
  /** Pepper HMAC cho băm đích/bộ đếm OTP (ADR-018). */
  readonly otpPeppers: VongBiMat;
  readonly receiptSigningKeys: VongKhoaKy;
  readonly senderAdapter: "dev-mailbox";
  readonly devMailboxDir: string;
  readonly afterCommitTimeoutMs: number | undefined;
}

export type MoiTruong = Readonly<Record<string, string | undefined>>;

const TEN_PHIEN_BAN = /^[A-Za-z0-9._:-]{1,32}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

function bat(env: MoiTruong, ten: string): string {
  const v = env[ten]?.trim();
  if (v === undefined || v === "") throw new CauHinhError(`thiếu biến môi trường ${ten}`);
  return v;
}

function tuyChon(env: MoiTruong, ten: string): string | undefined {
  const v = env[ten]?.trim();
  return v === undefined || v === "" ? undefined : v;
}

function soNguyen(env: MoiTruong, ten: string, macDinh: number, nhoNhat: number, lonNhat: number): number {
  const v = tuyChon(env, ten);
  if (v === undefined) return macDinh;
  if (!/^\d{1,9}$/u.test(v)) throw new CauHinhError(`${ten} phải là số nguyên không âm`);
  const n = Number(v);
  if (n < nhoNhat || n > lonNhat) throw new CauHinhError(`${ten} phải trong khoảng ${nhoNhat}–${lonNhat}`);
  return n;
}

function giaiMaBase64(ten: string, phienBan: string, chuoi: string): Buffer {
  if (!BASE64.test(chuoi) || chuoi.length % 4 !== 0) {
    throw new CauHinhError(`${ten}: giá trị của phiên bản "${phienBan}" không phải base64 chuẩn (có đệm)`);
  }
  return Buffer.from(chuoi, "base64");
}

/**
 * `v1=<base64>,v2=<base64>` → bản đồ phiên bản → byte. Mỗi mục là một phiên bản; tên phiên bản đi
 * vào AAD/`kid` nên bị giới hạn ký tự. Không có mục nào là lỗi, trùng tên là lỗi.
 */
function docVong(env: MoiTruong, tenBien: string, tenActive: string, doDaiByte: number | null): VongBiMat {
  const tho = bat(env, tenBien);
  const active = bat(env, tenActive);
  const keys: Record<string, Buffer> = {};
  for (const muc of tho.split(",")) {
    const m = muc.trim();
    if (m === "") continue;
    const dau = m.indexOf("=");
    if (dau <= 0) throw new CauHinhError(`${tenBien}: mỗi mục phải có dạng <phiên bản>=<base64>`);
    const phienBan = m.slice(0, dau).trim();
    if (!TEN_PHIEN_BAN.test(phienBan)) throw new CauHinhError(`${tenBien}: tên phiên bản không hợp lệ (1–32 ký tự [A-Za-z0-9._:-])`);
    if (Object.hasOwn(keys, phienBan)) throw new CauHinhError(`${tenBien}: phiên bản "${phienBan}" khai hai lần`);
    const byte = giaiMaBase64(tenBien, phienBan, m.slice(dau + 1).trim());
    if (doDaiByte !== null && byte.length !== doDaiByte) {
      throw new CauHinhError(`${tenBien}: phiên bản "${phienBan}" phải dài đúng ${doDaiByte} byte, đang là ${byte.length}`);
    }
    keys[phienBan] = byte;
  }
  if (Object.keys(keys).length === 0) throw new CauHinhError(`${tenBien}: không có phiên bản nào`);
  if (!Object.hasOwn(keys, active)) throw new CauHinhError(`${tenActive}: phiên bản đang dùng không có trong ${tenBien}`);
  return { active, keys };
}

/** Khoá riêng ECDSA P-256 ở dạng PKCS8 DER; nửa công khai (SPKI) dẫn ra từ nó. */
function docVongKhoaKy(env: MoiTruong, tenBien: string, tenActive: string): VongKhoaKy {
  const tho = docVong(env, tenBien, tenActive, null);
  const keys: Record<string, ReceiptKeyPair> = {};
  for (const [kid, der] of Object.entries(tho.keys)) {
    let rieng;
    try {
      rieng = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    } catch {
      throw new CauHinhError(`${tenBien}: khoá "${kid}" không đọc được theo PKCS8 DER`);
    }
    if (rieng.asymmetricKeyType !== "ec" || rieng.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new CauHinhError(`${tenBien}: khoá "${kid}" phải là EC P-256 (ADR-011 mục 2)`);
    }
    const congKhai = createPublicKey(rieng).export({ format: "der", type: "spki" });
    keys[kid] = { privateKey: new Uint8Array(der), publicKey: new Uint8Array(congKhai) };
  }
  return { active: tho.active, keys };
}

function docBaseUrl(env: MoiTruong, ten: string): string {
  const tho = bat(env, ten);
  let url: URL;
  try {
    url = new URL(tho);
  } catch {
    throw new CauHinhError(`${ten} không phải một URL hợp lệ`);
  }
  const cucBo = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && cucBo)) {
    throw new CauHinhError(`${ten} phải là https:// (http:// chỉ cho localhost) — magic link đi trên URL này`);
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.pathname !== "/") {
    throw new CauHinhError(`${ten} chỉ được là gốc (scheme://host[:port]) — không đường dẫn, không query, không thông tin đăng nhập`);
  }
  return url.origin;
}

function docOrigins(env: MoiTruong, ten: string): readonly string[] {
  const tho = tuyChon(env, ten);
  if (tho === undefined) return [];
  const ra: string[] = [];
  for (const muc of tho.split(",")) {
    const o = muc.trim();
    if (o === "") continue;
    let url: URL;
    try {
      url = new URL(o);
    } catch {
      throw new CauHinhError(`${ten}: một mục không phải origin hợp lệ`);
    }
    if (url.origin !== o) throw new CauHinhError(`${ten}: một mục không phải origin thuần (scheme://host[:port], không dấu / cuối)`);
    ra.push(o);
  }
  return ra;
}

/**
 * [review H6-1] Giá trị khai rõ "không có proxy nào đứng trước tiến trình này". Bắt buộc phải khai
 * một trong hai: danh sách CIDR, hoặc chuỗi này. Bỏ trống KHÔNG còn là mặc định.
 */
export const KHONG_CO_PROXY = "direct";

function docProxyTinCay(env: MoiTruong, ten: string): readonly string[] {
  // ~~Thiếu biến ⇒ danh sách rỗng (không proxy).~~ [review H6-1] Từ nợ 55, bucket theo người gọi là
  // TOÀN CỤC, nên một triển khai có LB đứng trước mà quên khai proxy gộp mọi khách vào một địa chỉ —
  // và bán kính của lần gộp ấy nay là cả nền tảng, không còn là một tổ chức. Quên không được phép
  // trông giống một lựa chọn: phải khai danh sách CIDR, hoặc khai `direct`.
  const tho = bat(env, ten);
  if (tho.trim() === KHONG_CO_PROXY) return [];
  const ds = tho.split(",").map((m) => m.trim()).filter((m) => m !== "");
  try {
    taoDanhSachTinCay(ds);
  } catch (e) {
    throw new CauHinhError(`${ten}: ${e instanceof DiaChiError ? e.message : "mục không hợp lệ"}`);
  }
  return ds;
}

function docAdapter<T extends string>(env: MoiTruong, ten: string, hopLe: readonly T[], loai: string): T {
  const v = bat(env, ten);
  const khop = hopLe.find((h) => h === v);
  if (khop === undefined) {
    throw new CauHinhError(
      `${ten}="${v}" là một adapter ${loai} CHƯA CÓ trong kho — hôm nay chỉ có ${hopLe.map((h) => `"${h}"`).join(", ")}. ` +
        "Không rơi về bản dev trong im lặng.",
    );
  }
  return khop;
}

/** Ba vòng bí mật 32 byte phải đôi một khác nhau — so từng cặp bằng thời gian hằng. */
function kiemKhongTrung(cac: ReadonlyArray<readonly [string, VongBiMat]>): void {
  const tatCa: Array<{ bien: string; phienBan: string; byte: Buffer }> = [];
  for (const [bien, vong] of cac) for (const [phienBan, byte] of Object.entries(vong.keys)) tatCa.push({ bien, phienBan, byte });
  for (let i = 0; i < tatCa.length; i += 1) {
    for (let j = i + 1; j < tatCa.length; j += 1) {
      const a = tatCa[i]!;
      const b = tatCa[j]!;
      if (a.byte.length === b.byte.length && timingSafeEqual(a.byte, b.byte)) {
        throw new CauHinhError(
          `${a.bien} (phiên bản "${a.phienBan}") và ${b.bien} (phiên bản "${b.phienBan}") mang CÙNG một giá trị — ` +
            "ba vòng khoá phải độc lập (G1/ADR-006, ADR-018)",
        );
      }
    }
  }
}

/** Tên role đăng nhập DUY NHẤT mà hardening (CAP_HOP_LE) cho phép là thành viên của `app_api`. */
const ROLE_DANG_NHAP = "app_api_login";

function docDatabaseUrl(env: MoiTruong, ten: string): string {
  const tho = bat(env, ten);
  let url: URL;
  try {
    url = new URL(tho);
  } catch {
    throw new CauHinhError(`${ten} không phải một URI postgres:// hợp lệ`);
  }
  // [review H3-1] Lớp theo TÊN: hardening chỉ giữ membership (app_api_login → app_api); mọi tên khác bị
  // gỡ ở lần migrate() sau, nên một URL khác tên là một cấu hình sẽ chết giữa hai lần deploy — hoặc là
  // superuser. Lớp theo THUỘC TÍNH (session_user) đo ở composition lúc khởi động.
  if (url.username !== ROLE_DANG_NHAP) {
    throw new CauHinhError(`${ten} phải đăng nhập bằng role "${ROLE_DANG_NHAP}" (thành viên của app_api theo hardening), không phải một role khác hay superuser`);
  }
  return tho;
}

function docThuMucTuyetDoi(env: MoiTruong, ten: string): string {
  const v = bat(env, ten);
  // [review H3-3] Tương đối theo cwd = trong cây repo khi chạy `pnpm api:dev` — credential dạng rõ sẽ đi vào `git add -A`.
  if (!isAbsolute(v)) throw new CauHinhError(`${ten} phải là đường dẫn TUYỆT ĐỐI (thư mục này chứa token và mã OTP dạng rõ)`);
  return v;
}

export function docCauHinh(env: MoiTruong): CauHinhApi {
  const databaseUrl = docDatabaseUrl(env, "TRUSTPROCURE_DATABASE_URL");
  const keyAdapter = docAdapter(env, "TRUSTPROCURE_KEY_ADAPTER", ["local-dev"] as const, "khoá");
  const senderAdapter = docAdapter(env, "TRUSTPROCURE_SENDER_ADAPTER", ["dev-mailbox"] as const, "gửi");
  const masterKeys = docVong(env, "TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_MASTER_KEY_ACTIVE", 32);
  const totpMasterKeys = docVong(env, "TRUSTPROCURE_TOTP_MASTER_KEYS", "TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE", 32);
  const otpPeppers = docVong(env, "TRUSTPROCURE_OTP_PEPPERS", "TRUSTPROCURE_OTP_PEPPER_ACTIVE", 32);
  kiemKhongTrung([
    ["TRUSTPROCURE_MASTER_KEYS", masterKeys],
    ["TRUSTPROCURE_TOTP_MASTER_KEYS", totpMasterKeys],
    ["TRUSTPROCURE_OTP_PEPPERS", otpPeppers],
  ]);
  return {
    databaseUrl,
    dbPoolMax: soNguyen(env, "TRUSTPROCURE_DB_POOL_MAX", 10, 1, 100),
    listenHost: tuyChon(env, "TRUSTPROCURE_LISTEN_HOST") ?? "127.0.0.1",
    listenPort: soNguyen(env, "TRUSTPROCURE_LISTEN_PORT", 8080, 0, 65535),
    publicBaseUrl: docBaseUrl(env, "TRUSTPROCURE_PUBLIC_BASE_URL"),
    allowedOrigins: docOrigins(env, "TRUSTPROCURE_ALLOWED_ORIGINS"),
    trustedProxies: docProxyTinCay(env, "TRUSTPROCURE_TRUSTED_PROXIES"),
    keyAdapter,
    masterKeys,
    totpMasterKeys,
    otpPeppers,
    receiptSigningKeys: docVongKhoaKy(env, "TRUSTPROCURE_RECEIPT_SIGNING_KEYS", "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE"),
    senderAdapter,
    devMailboxDir: docThuMucTuyetDoi(env, "TRUSTPROCURE_DEV_MAILBOX_DIR"),
    afterCommitTimeoutMs:
      tuyChon(env, "TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS") === undefined
        ? undefined
        : soNguyen(env, "TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS", 5000, 100, 60_000),
  };
}
