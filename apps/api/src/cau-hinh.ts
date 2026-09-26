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
//      nay ~~mỗi biến chỉ có ĐÚNG MỘT giá trị hợp lệ (`local-dev`, `dev-mailbox`)~~ [ADR-064] khoá có
//      HAI giá trị (`local-dev`, `aws-kms`), bộ gửi ~~có một (`dev-mailbox`)~~ [ADR-065] cũng hai
//      (`dev-mailbox`, `ses`), và hai bộ biến gửi cũng loại trừ nhau. Một giá trị khác ("sns")
//      là lời khai về một adapter CHƯA TỒN TẠI — ném với đúng câu ấy, thay vì im lặng rơi về bản dev.
//   ⑷ [ADR-064] Hai bộ biến khoá LOẠI TRỪ nhau: dưới `aws-kms`, một biến vòng khoá local-dev còn sót
//      là lỗi khởi động, và ngược lại — một cấu hình không được mang hai câu trả lời cho câu "khoá ở
//      đâu". Dưới `aws-kms`, CMK của TOTP phải khác CMK bọc cặp khoá tổ chức (ADR-063).
//
// VÌ SAO BA VÒNG BÍ MẬT PHẢI ĐÔI MỘT KHÁC NHAU: `TotpSecretUnsealer` (identity) ghi hợp đồng "không
// được dùng chung vòng khoá chính với bộ mở phong bì thầu" (G1/ADR-006); pepper OTP (ADR-018) là
// khoá HMAC giữ ngoài CSDL. Dùng một chuỗi base64 cho cả ba biến là lỗi dán-chép dễ nhất trong vận
// hành, và nó biến ba khoá thành một — phép kiểm ở đây làm lỗi ấy nổ lúc khởi động.
// ==============================================================================================

import { createPrivateKey, createPublicKey, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ReceiptKeyPair } from "@trustprocure/bidding";
import { CHU_KY_CANH_DONG_HO_MS_MAC_DINH, LECH_DONG_HO_TOI_DA_MS_MAC_DINH } from "@trustprocure/db";
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

export interface CauHinhApiChung {
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
  /** Pepper HMAC cho băm đích/bộ đếm OTP (ADR-018) — giữ ngoài KMS ở cả hai adapter khoá. */
  readonly otpPeppers: VongBiMat;
  /**
   * Trần cho mỗi việc sau commit, ms (`TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS`, 100–60 000; không khai ⇒ 5 000 của bộ điều phối).
   * [S1.70 / khoản 124, lượt soi 64a-6] Một trần, hai hợp đồng: cận oracle thời gian của đường vô danh (OTP, H2-7), và ngưỡng mà quá nó
   * một lần gửi link mời bị tính là hỏng — lời mời bị thu hồi, `502`. Xem docstring `afterCommitTimeoutMs` ở `dispatch.ts`.
   */
  readonly afterCommitTimeoutMs: number | undefined;
  /**
   * [khoản 196 / ADR-074] Ngưỡng lệch giữa đồng hồ CSDL và đồng hồ tiến trình, ms
   * (`TRUSTPROCURE_CLOCK_SKEW_MAX_MS`, 100–60 000; mặc định 2 000). Vượt lúc khởi động ⇒ tiến trình không
   * lên (`LechDongHoError`); vượt lúc chạy ⇒ một dòng log cảnh báo.
   */
  readonly lechDongHoToiDaMs: number;
  /** [khoản 196] Nhịp đo lại lúc chạy, ms (`TRUSTPROCURE_CLOCK_SKEW_CHECK_MS`, 1 000–3 600 000; mặc định 60 000). */
  readonly chuKyCanhDongHoMs: number;
}

/** Khoá ở dạng local-dev: ba vòng bí mật trong tiến trình. */
export interface KhoaLocalDev {
  readonly keyAdapter: "local-dev";
  /** Vòng khoá chính bọc khoá riêng tổ chức (ADR-062). */
  readonly masterKeys: VongBiMat;
  /** Vòng khoá chính bọc bí mật TOTP — CMK RIÊNG, không được trùng vòng trên. */
  readonly totpMasterKeys: VongBiMat;
  readonly receiptSigningKeys: VongKhoaKy;
}

/** [ADR-064] Khoá ở AWS KMS: không bí mật nào trong tiến trình, chỉ định danh CMK và nhãn phiên bản. */
export interface CauHinhKms {
  readonly region: string;
  /** `alias/tp-org-wrap` (ADR-062) và nhãn phiên bản cặp khoá tổ chức. */
  readonly orgWrapKeyId: string;
  readonly orgKeyVersion: string;
  /** `alias/tp-totp` (ADR-063) và nhãn phiên bản đi vào encryption context. */
  readonly totpKeyId: string;
  readonly totpKeyVersion: string;
  /** `alias/tp-receipt-sign` (ADR-011) và `kid` của nó. */
  readonly receiptKeyId: string;
  readonly receiptKid: string;
}

export interface KhoaAwsKms {
  readonly keyAdapter: "aws-kms";
  readonly kms: CauHinhKms;
}

/** Bộ gửi dev: mỗi tin một tệp JSON trong thư mục (token và OTP dạng rõ — chỉ cho máy phát triển). */
export interface GuiDevMailbox {
  readonly senderAdapter: "dev-mailbox";
  readonly devMailboxDir: string;
}

/** [ADR-065] Bộ gửi thật qua Amazon SES — chỉ kênh EMAIL. */
export interface CauHinhSes {
  readonly region: string;
  /** Địa chỉ gửi đã xác minh; IAM của `tp-api` chỉ cho `ses:FromAddress` này. */
  readonly tuDiaChi: string;
  readonly configurationSet: string | undefined;
}

/** [ADR-069] Kênh SMS qua AWS End User Messaging SMS. */
export interface CauHinhSms {
  readonly region: string;
  /** Sender ID (brandname) hoặc ARN của nó — IAM của `tp-api` chỉ cho gửi từ danh tính này. */
  readonly danhTinhGui: string;
  readonly configurationSet: string | undefined;
}

/** [ADR-069] Kênh Zalo ZNS: token trong Secrets Manager, một template đã duyệt cho mỗi loại tin. */
export interface CauHinhZalo {
  readonly region: string;
  readonly secretId: string;
  readonly mau: { readonly otp: string; readonly loiMoi: string; readonly giaHan: string };
}

export interface GuiSes {
  readonly senderAdapter: "ses";
  readonly ses: CauHinhSes;
  /** `undefined` = kênh SMS chưa bật: tin cho liên hệ khai SMS làm việc outbox thất bại (ADR-065 ⑴). */
  readonly sms: CauHinhSms | undefined;
  readonly zalo: CauHinhZalo | undefined;
}

export type CauHinhApi = CauHinhApiChung & (KhoaLocalDev | KhoaAwsKms) & (GuiDevMailbox | GuiSes);

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

/** Biến khoá của từng adapter — dùng để từ chối một cấu hình mang cả hai bộ (quy tắc ⑷). */
const BIEN_KHOA_LOCAL_DEV = [
  "TRUSTPROCURE_MASTER_KEYS",
  "TRUSTPROCURE_MASTER_KEY_ACTIVE",
  "TRUSTPROCURE_TOTP_MASTER_KEYS",
  "TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE",
  "TRUSTPROCURE_RECEIPT_SIGNING_KEYS",
  "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE",
] as const;
const BIEN_KHOA_KMS = [
  "TRUSTPROCURE_AWS_REGION",
  "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID",
  "TRUSTPROCURE_KMS_ORG_KEY_VERSION",
  "TRUSTPROCURE_KMS_TOTP_KEY_ID",
  "TRUSTPROCURE_KMS_TOTP_KEY_VERSION",
  "TRUSTPROCURE_KMS_RECEIPT_KEY_ID",
  "TRUSTPROCURE_KMS_RECEIPT_KID",
] as const;

function tuChoiBienCuaAdapterKhac(env: MoiTruong, adapter: string, bienKhac: readonly string[]): void {
  const sot = bienKhac.filter((b) => tuyChon(env, b) !== undefined);
  if (sot.length > 0) {
    throw new CauHinhError(
      `TRUSTPROCURE_KEY_ADAPTER="${adapter}" nhưng còn khai ${sot.join(", ")} của adapter khoá kia — ` +
        "một cấu hình không được mang hai câu trả lời cho câu \"khoá ở đâu\" (ADR-064)",
    );
  }
}

const NHAN_KMS = /^[A-Za-z0-9._:-]{1,64}$/u;
const VUNG_AWS = /^[a-z]{2}(?:-[a-z]+)+-\d$/u;

function docNhanKms(env: MoiTruong, ten: string): string {
  const v = bat(env, ten);
  if (!NHAN_KMS.test(v)) throw new CauHinhError(`${ten} phải dài 1–64 ký tự [A-Za-z0-9._:-]`);
  return v;
}

function docKeyIdKms(env: MoiTruong, ten: string): string {
  const v = bat(env, ten);
  // alias/…, key id (UUID, mrk-…) hay ARN — không khoảng trắng, không quá dài; KMS kiểm phần còn lại.
  if (!/^[A-Za-z0-9/:_.-]{1,2048}$/u.test(v)) throw new CauHinhError(`${ten} không phải một định danh CMK hợp lệ`);
  return v;
}

function docKhoaKms(env: MoiTruong): CauHinhKms {
  const region = bat(env, "TRUSTPROCURE_AWS_REGION");
  if (!VUNG_AWS.test(region)) throw new CauHinhError("TRUSTPROCURE_AWS_REGION không phải một vùng AWS hợp lệ");
  const kms: CauHinhKms = {
    region,
    orgWrapKeyId: docKeyIdKms(env, "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID"),
    orgKeyVersion: docNhanKms(env, "TRUSTPROCURE_KMS_ORG_KEY_VERSION"),
    totpKeyId: docKeyIdKms(env, "TRUSTPROCURE_KMS_TOTP_KEY_ID"),
    totpKeyVersion: docNhanKms(env, "TRUSTPROCURE_KMS_TOTP_KEY_VERSION"),
    receiptKeyId: docKeyIdKms(env, "TRUSTPROCURE_KMS_RECEIPT_KEY_ID"),
    receiptKid: docNhanKms(env, "TRUSTPROCURE_KMS_RECEIPT_KID"),
  };
  // ADR-063: bí mật TOTP KHÔNG được bọc bằng khoá mở hồ sơ thầu. So theo chuỗi khai — hai cách viết
  // khác nhau của cùng một CMK (alias và ARN) lọt qua đây; key policy của tp-org-wrap (chỉ worker
  // Decrypt) là lớp chặn thật, phép so này chỉ bắt lỗi dán-chép.
  const ba: ReadonlyArray<readonly [string, string]> = [
    ["TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", kms.orgWrapKeyId],
    ["TRUSTPROCURE_KMS_TOTP_KEY_ID", kms.totpKeyId],
    ["TRUSTPROCURE_KMS_RECEIPT_KEY_ID", kms.receiptKeyId],
  ];
  for (let i = 0; i < ba.length; i += 1) {
    for (let j = i + 1; j < ba.length; j += 1) {
      if (ba[i]![1] === ba[j]![1]) {
        throw new CauHinhError(`${ba[i]![0]} và ${ba[j]![0]} trỏ CÙNG một CMK — ba khoá phải độc lập (ADR-062, ADR-063, ADR-011)`);
      }
    }
  }
  return kms;
}

const BIEN_GUI_DEV = ["TRUSTPROCURE_DEV_MAILBOX_DIR"] as const;
const BIEN_GUI_SES = ["TRUSTPROCURE_SES_REGION", "TRUSTPROCURE_SES_FROM", "TRUSTPROCURE_SES_CONFIGURATION_SET"] as const;
const BIEN_SMS = ["TRUSTPROCURE_SMS_REGION", "TRUSTPROCURE_SMS_ORIGINATION_IDENTITY", "TRUSTPROCURE_SMS_CONFIGURATION_SET"] as const;
const BIEN_ZALO = [
  "TRUSTPROCURE_ZALO_REGION",
  "TRUSTPROCURE_ZALO_SECRET_ID",
  "TRUSTPROCURE_ZALO_TEMPLATE_OTP",
  "TRUSTPROCURE_ZALO_TEMPLATE_INVITATION",
  "TRUSTPROCURE_ZALO_TEMPLATE_DEADLINE",
] as const;
const TEN_CAU_HINH_AWS = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * [ADR-069] Kênh SMS — bật khi có BẤT KỲ biến nào của nó; khi đã bật thì vùng và danh tính gửi là bắt buộc.
 * Khai một nửa là lỗi, không phải "tắt": rơi âm thầm về "kênh chưa cấu hình" làm lời mời SMS thất bại ở tận outbox.
 */
function docSms(env: MoiTruong): CauHinhSms | undefined {
  if (BIEN_SMS.every((b) => tuyChon(env, b) === undefined)) return undefined;
  const region = bat(env, "TRUSTPROCURE_SMS_REGION");
  if (!VUNG_AWS.test(region)) throw new CauHinhError("TRUSTPROCURE_SMS_REGION không phải một vùng AWS hợp lệ");
  const danhTinhGui = bat(env, "TRUSTPROCURE_SMS_ORIGINATION_IDENTITY");
  if (!/^[A-Za-z0-9_:/+.-]{1,256}$/u.test(danhTinhGui)) {
    throw new CauHinhError("TRUSTPROCURE_SMS_ORIGINATION_IDENTITY phải là sender ID hoặc ARN của nó");
  }
  const configurationSet = tuyChon(env, "TRUSTPROCURE_SMS_CONFIGURATION_SET");
  if (configurationSet !== undefined && !TEN_CAU_HINH_AWS.test(configurationSet)) {
    throw new CauHinhError("TRUSTPROCURE_SMS_CONFIGURATION_SET phải dài 1–64 ký tự [A-Za-z0-9_-]");
  }
  return { region, danhTinhGui, configurationSet };
}

/** [ADR-069] Kênh Zalo ZNS — cùng quy tắc bật/khai-một-nửa của `docSms`; cả ba template là bắt buộc. */
function docZalo(env: MoiTruong): CauHinhZalo | undefined {
  if (BIEN_ZALO.every((b) => tuyChon(env, b) === undefined)) return undefined;
  const region = bat(env, "TRUSTPROCURE_ZALO_REGION");
  if (!VUNG_AWS.test(region)) throw new CauHinhError("TRUSTPROCURE_ZALO_REGION không phải một vùng AWS hợp lệ");
  const secretId = bat(env, "TRUSTPROCURE_ZALO_SECRET_ID");
  if (!/^[A-Za-z0-9/_+=.@:-]{1,512}$/u.test(secretId)) throw new CauHinhError("TRUSTPROCURE_ZALO_SECRET_ID không phải tên/ARN secret hợp lệ");
  const mau = (ten: string): string => {
    const v = bat(env, ten);
    if (!/^[A-Za-z0-9]{1,64}$/u.test(v)) throw new CauHinhError(`${ten} phải là ID template ZNS [A-Za-z0-9]`);
    return v;
  };
  return {
    region,
    secretId,
    mau: {
      otp: mau("TRUSTPROCURE_ZALO_TEMPLATE_OTP"),
      loiMoi: mau("TRUSTPROCURE_ZALO_TEMPLATE_INVITATION"),
      giaHan: mau("TRUSTPROCURE_ZALO_TEMPLATE_DEADLINE"),
    },
  };
}

/** Địa chỉ email đơn — cùng hình dạng `gui-ses.ts` kiểm lại lúc gửi. */
const EMAIL_DON = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,253}\.[^\s@,;<>"]{2,63}$/u;

/** [ADR-065] Hai bộ biến gửi LOẠI TRỪ nhau — cùng quy tắc ⑷ của bộ biến khoá. */
function docBoGui(env: MoiTruong, senderAdapter: "dev-mailbox" | "ses"): GuiDevMailbox | GuiSes {
  // [ADR-069] Biến SMS/Zalo là của bộ gửi thật: dưới hộp thư dev chúng là "bộ gửi kia" (hộp thư dev ghi MỌI kênh ra tệp).
  const bienKhac = senderAdapter === "ses" ? BIEN_GUI_DEV : [...BIEN_GUI_SES, ...BIEN_SMS, ...BIEN_ZALO];
  const sot = bienKhac.filter((b) => tuyChon(env, b) !== undefined);
  if (sot.length > 0) {
    throw new CauHinhError(`TRUSTPROCURE_SENDER_ADAPTER="${senderAdapter}" nhưng còn khai ${sot.join(", ")} của bộ gửi kia (ADR-065)`);
  }
  if (senderAdapter === "dev-mailbox") {
    return { senderAdapter, devMailboxDir: docThuMucTuyetDoi(env, "TRUSTPROCURE_DEV_MAILBOX_DIR") };
  }
  const region = bat(env, "TRUSTPROCURE_SES_REGION");
  if (!VUNG_AWS.test(region)) throw new CauHinhError("TRUSTPROCURE_SES_REGION không phải một vùng AWS hợp lệ");
  const tuDiaChi = bat(env, "TRUSTPROCURE_SES_FROM");
  if (!EMAIL_DON.test(tuDiaChi)) throw new CauHinhError("TRUSTPROCURE_SES_FROM không phải một địa chỉ email đơn");
  const configurationSet = tuyChon(env, "TRUSTPROCURE_SES_CONFIGURATION_SET");
  if (configurationSet !== undefined && !/^[A-Za-z0-9_-]{1,64}$/u.test(configurationSet)) {
    throw new CauHinhError("TRUSTPROCURE_SES_CONFIGURATION_SET phải dài 1–64 ký tự [A-Za-z0-9_-]");
  }
  return { senderAdapter, ses: { region, tuDiaChi, configurationSet }, sms: docSms(env), zalo: docZalo(env) };
}

export function docCauHinh(env: MoiTruong): CauHinhApi {
  const databaseUrl = docDatabaseUrl(env, "TRUSTPROCURE_DATABASE_URL");
  const keyAdapter = docAdapter(env, "TRUSTPROCURE_KEY_ADAPTER", ["local-dev", "aws-kms"] as const, "khoá");
  const senderAdapter = docAdapter(env, "TRUSTPROCURE_SENDER_ADAPTER", ["dev-mailbox", "ses"] as const, "gửi");
  const otpPeppers = docVong(env, "TRUSTPROCURE_OTP_PEPPERS", "TRUSTPROCURE_OTP_PEPPER_ACTIVE", 32);
  let khoa: KhoaLocalDev | KhoaAwsKms;
  if (keyAdapter === "local-dev") {
    tuChoiBienCuaAdapterKhac(env, keyAdapter, BIEN_KHOA_KMS);
    const masterKeys = docVong(env, "TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_MASTER_KEY_ACTIVE", 32);
    const totpMasterKeys = docVong(env, "TRUSTPROCURE_TOTP_MASTER_KEYS", "TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE", 32);
    kiemKhongTrung([
      ["TRUSTPROCURE_MASTER_KEYS", masterKeys],
      ["TRUSTPROCURE_TOTP_MASTER_KEYS", totpMasterKeys],
      ["TRUSTPROCURE_OTP_PEPPERS", otpPeppers],
    ]);
    khoa = {
      keyAdapter,
      masterKeys,
      totpMasterKeys,
      receiptSigningKeys: docVongKhoaKy(env, "TRUSTPROCURE_RECEIPT_SIGNING_KEYS", "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE"),
    };
  } else {
    tuChoiBienCuaAdapterKhac(env, keyAdapter, BIEN_KHOA_LOCAL_DEV);
    khoa = { keyAdapter, kms: docKhoaKms(env) };
  }
  return {
    ...khoa,
    databaseUrl,
    dbPoolMax: soNguyen(env, "TRUSTPROCURE_DB_POOL_MAX", 10, 1, 100),
    listenHost: tuyChon(env, "TRUSTPROCURE_LISTEN_HOST") ?? "127.0.0.1",
    listenPort: soNguyen(env, "TRUSTPROCURE_LISTEN_PORT", 8080, 0, 65535),
    publicBaseUrl: docBaseUrl(env, "TRUSTPROCURE_PUBLIC_BASE_URL"),
    allowedOrigins: docOrigins(env, "TRUSTPROCURE_ALLOWED_ORIGINS"),
    trustedProxies: docProxyTinCay(env, "TRUSTPROCURE_TRUSTED_PROXIES"),
    otpPeppers,
    ...docBoGui(env, senderAdapter),
    afterCommitTimeoutMs:
      tuyChon(env, "TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS") === undefined
        ? undefined
        : soNguyen(env, "TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS", 5000, 100, 60_000),
    lechDongHoToiDaMs: soNguyen(env, "TRUSTPROCURE_CLOCK_SKEW_MAX_MS", LECH_DONG_HO_TOI_DA_MS_MAC_DINH, 100, 60_000),
    chuKyCanhDongHoMs: soNguyen(env, "TRUSTPROCURE_CLOCK_SKEW_CHECK_MS", CHU_KY_CANH_DONG_HO_MS_MAC_DINH, 1000, 3_600_000),
  };
}
