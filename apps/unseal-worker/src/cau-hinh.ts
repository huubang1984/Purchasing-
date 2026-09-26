// ==============================================================================================
// apps/unseal-worker/src/cau-hinh.ts — CẤU HÌNH TỪ MÔI TRƯỜNG, FAIL-CLOSED
//
// [ADR-021] Cùng khuôn `apps/api/src/cau-hinh.ts` và `apps/mcp/src/cau-hinh.ts`: một hàm THUẦN
// nhận bản đồ tên → chuỗi, trả về cấu hình đã kiểm hình dạng hoặc ném `CauHinhError`. Không đọc
// `process.env`, không chạm CSDL, không dựng adapter — nên mọi ca "thiếu biến" đo được ở T1.
//
// ----------------------------------------------------------------------------------------------
// BA VÒNG BÍ MẬT MÀ TỆP NÀY CỐ Ý KHÔNG ĐỌC, VÀ ĐÓ LÀ MỘT LỜI HỨA CHỨ KHÔNG PHẢI MỘT THIẾU SÓT
// ----------------------------------------------------------------------------------------------
// `docCauHinh` của `apps/api` BẮT BUỘC `TRUSTPROCURE_TOTP_MASTER_KEYS`, `TRUSTPROCURE_OTP_PEPPERS`
// và `TRUSTPROCURE_RECEIPT_SIGNING_KEYS`. Tiến trình này là tiến trình DUY NHẤT giải mã được
// phong bì thầu (ADR-006), nên nó KHÔNG được giữ thêm bí mật nào khác: một tiến trình vừa mở được
// phong bì vừa mở được bí mật TOTP là đúng thứ G1 dựng hai vòng khoá riêng để chặn.
//
// Vì thế tệp này KHÔNG dùng lại `docCauHinh` của api — dùng lại là kéo theo cả ba vòng ấy. Nó
// cũng KHÔNG dùng lại `docVong` của api: hàm ấy không xuất ra khỏi `apps/api`, và mở nó ra cửa
// `@trustprocure/crypto-keys` là thêm một bậc tự do ở đúng cái cửa mà họ quy tắc `g1-` dựng ra để
// giữ hẹp. Phần CHỊU LỰC đã có sẵn và dùng chung: `MasterKeyRing` (`crypto-keys/master-keys.ts`)
// tự ném khi khoá khác 32 byte và khi phiên bản đang dùng không có trong vòng.
//
// HỆ QUẢ NÓI RA, không giấu: `apps/api` so CHÉO ba vòng và nổ lúc khởi động nếu hai vòng trùng
// nhau. Tiến trình này giữ MỘT vòng nên không có gì để so — dán nhầm giá trị pepper vào
// `TRUSTPROCURE_MASTER_KEYS` thì nó LÊN ĐƯỢC và chỉ hỏng lúc mở phong bì. Ghi ở ADR-040.
//
// BA QUY TẮC, giống hai app kia:
//   ⑴ Bí mật KHÔNG có mặc định. Thiếu là ném.
//   ⑵ Thông điệp lỗi chỉ nêu TÊN biến, không bao giờ nêu GIÁ TRỊ.
//   ⑶ Adapter phải được KHAI TÊN, và mỗi biến hôm nay chỉ có ĐÚNG MỘT giá trị hợp lệ [ADR-064: trừ
//      biến khoá, nay có `local-dev` và `aws-kms`, và hai bộ biến của chúng loại trừ nhau]. Một giá
//      trị khác ("kms", "pagerduty") là lời khai về một adapter CHƯA TỒN TẠI — ném với đúng câu
//      ấy, thay vì im lặng rơi về bản dev.
// ==============================================================================================

import { isAbsolute } from "node:path";

export class CauHinhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauHinhError";
  }
}

/**
 * Role ĐĂNG NHẬP của tiến trình này. Ghim theo TÊN vì `hardening.always.sql` giữ đúng một cặp
 * `(app_unseal, app_unseal_login)` trong `CAP_HOP_LE`: mọi tên khác bị gỡ membership ở lần
 * `migrate()` sau, nên một URL khác tên là một cấu hình sẽ chết giữa hai lần deploy — hoặc là
 * superuser. Lớp theo THUỘC TÍNH (`session_user`) đo ở `tien-trinh.ts` lúc khởi động.
 */
const ROLE_DANG_NHAP = "app_unseal_login";

/** Một vòng bí mật 32 byte có phiên bản — cùng hình dạng với `VongBiMat` của `apps/api`. */
export interface VongBiMat {
  readonly active: string;
  readonly keys: Readonly<Record<string, Buffer>>;
}

export interface CauHinhWorkerChung {
  /** `postgres://app_unseal_login:...@host/db` — pool tự đổi sang vai `app_unseal`. */
  readonly databaseUrl: string;
  /**
   * Cỡ MỖI pool. Tiến trình mở tới **2 ×** giá trị này: pool nghiệp vụ và `auditPool` riêng.
   * Khoản 116 (đoạn [S1.72] / khoản 121) đòi hai pool riêng — dùng lại pool của runner khi nó
   * chỉ có một kết nối thì mỗi lần TỪ CHỐI lúc giải mã chờ hết trần rồi ra `DenialAuditFailedError`.
   */
  readonly dbPoolMax: number;
  /** Nhịp poll của runner, ms. */
  readonly pollIntervalMs: number;
}

export interface KhoaWorkerLocalDev {
  readonly keyAdapter: "local-dev";
  /** Vòng khoá chính bọc khoá riêng tổ chức (ADR-062). Vòng DUY NHẤT tiến trình này giữ. */
  readonly masterKeys: VongBiMat;
}

/**
 * [ADR-064] Khoá ở AWS KMS. Worker chỉ cần ĐÚNG MỘT CMK — `alias/tp-org-wrap`, để `kms:Decrypt` khoá
 * riêng tổ chức mỗi lượt mở thầu. Nó KHÔNG đọc định danh CMK của TOTP hay khoá ký biên nhận: cùng lời
 * hứa với ca ⑼ của vòng local-dev (một tiến trình mở phong bì không cầm lối vào bí mật nào khác).
 */
export interface KhoaWorkerAwsKms {
  readonly keyAdapter: "aws-kms";
  readonly kms: { readonly region: string; readonly orgWrapKeyId: string };
}

export interface CanhBaoDevFile {
  readonly alertAdapter: "dev-file";
  /** Thư mục nhận cảnh báo break-glass. TUYỆT ĐỐI, và nên nằm NGOÀI cây repo. */
  readonly alertDir: string;
}

/** [ADR-065] Cảnh báo break-glass qua Amazon SES tới một danh sách người nhận. */
export interface CanhBaoSes {
  readonly alertAdapter: "ses";
  readonly ses: {
    readonly region: string;
    /** Địa chỉ gửi; IAM của `tp-unseal-worker` chỉ cho `ses:FromAddress` này. */
    readonly tuDiaChi: string;
    readonly denDiaChi: readonly string[];
    readonly configurationSet: string | undefined;
  };
}

export type CauHinhWorker = CauHinhWorkerChung & (KhoaWorkerLocalDev | KhoaWorkerAwsKms) & (CanhBaoDevFile | CanhBaoSes);

type MoiTruong = Readonly<Record<string, string | undefined>>;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const TEN_PHIEN_BAN = /^[A-Za-z0-9._:-]{1,32}$/u;

function bat(env: MoiTruong, ten: string): string {
  const v = env[ten]?.trim();
  if (v === undefined || v.length === 0) throw new CauHinhError(`thiếu biến môi trường ${ten}`);
  return v;
}

function docSoNguyen(env: MoiTruong, ten: string, macDinh: number, nhoNhat: number, lonNhat: number): number {
  const v = env[ten]?.trim();
  if (v === undefined || v.length === 0) return macDinh;
  if (!/^\d{1,9}$/u.test(v)) throw new CauHinhError(`${ten} phải là số nguyên không âm`);
  const n = Number(v);
  if (n < nhoNhat || n > lonNhat) {
    throw new CauHinhError(`${ten} phải trong khoảng ${String(nhoNhat)}–${String(lonNhat)}`);
  }
  return n;
}

function docAdapter<T extends string>(env: MoiTruong, ten: string, hopLe: readonly T[], viec: string): T {
  const v = bat(env, ten);
  if (!(hopLe as readonly string[]).includes(v)) {
    throw new CauHinhError(
      `${ten} = "${v}" là một adapter ${viec} CHƯA TỒN TẠI. Hôm nay chỉ có: ${hopLe.join(", ")}.`,
    );
  }
  return v as T;
}

/**
 * `v1=<base64>,v2=<base64>` → bản đồ phiên bản → byte.
 *
 * Bốn phép kiểm ở đây là bốn phép mà `MasterKeyRing` KHÔNG làm được vì nguyên lý: nó nhận một
 * `Record` đã dựng xong, nên "hai mục cùng phiên bản" đã sụp trước khi tới tay nó. Độ dài 32 byte
 * và "phiên bản đang dùng có trong vòng" thì `MasterKeyRing` tự ném — không lặp lại ở đây.
 */
function docVong(env: MoiTruong, tenBien: string, tenActive: string): VongBiMat {
  const tho = bat(env, tenBien);
  const active = bat(env, tenActive);
  const keys: Record<string, Buffer> = {};
  for (const muc of tho.split(",")) {
    const m = muc.trim();
    if (m === "") continue;
    const dau = m.indexOf("=");
    if (dau <= 0) throw new CauHinhError(`${tenBien}: mỗi mục phải có dạng <phiên bản>=<base64>`);
    const phienBan = m.slice(0, dau).trim();
    if (!TEN_PHIEN_BAN.test(phienBan)) {
      throw new CauHinhError(`${tenBien}: tên phiên bản không hợp lệ (1–32 ký tự [A-Za-z0-9._:-])`);
    }
    if (Object.hasOwn(keys, phienBan)) {
      throw new CauHinhError(`${tenBien}: phiên bản "${phienBan}" khai hai lần`);
    }
    const b64 = m.slice(dau + 1).trim();
    if (!BASE64.test(b64) || b64.length % 4 !== 0) {
      throw new CauHinhError(`${tenBien}: giá trị của phiên bản "${phienBan}" không phải base64 chuẩn (có đệm)`);
    }
    keys[phienBan] = Buffer.from(b64, "base64");
  }
  if (Object.keys(keys).length === 0) throw new CauHinhError(`${tenBien}: không có phiên bản nào`);
  if (!Object.hasOwn(keys, active)) {
    throw new CauHinhError(`${tenActive}: phiên bản đang dùng không có trong ${tenBien}`);
  }
  return { active, keys };
}

function docDatabaseUrl(env: MoiTruong, ten: string): string {
  const tho = bat(env, ten);
  let url: URL;
  try {
    url = new URL(tho);
  } catch {
    throw new CauHinhError(`${ten} không phải một URI postgres:// hợp lệ`);
  }
  if (url.username !== ROLE_DANG_NHAP) {
    throw new CauHinhError(
      `${ten} phải đăng nhập bằng role "${ROLE_DANG_NHAP}" (thành viên của app_unseal theo hardening), ` +
        "không phải một role khác hay superuser",
    );
  }
  return tho;
}

function docThuMucTuyetDoi(env: MoiTruong, ten: string): string {
  const v = bat(env, ten);
  // Tương đối theo cwd = trong cây repo khi chạy `pnpm worker:dev`. Thư mục này nhận cảnh báo
  // break-glass, tức TÊN và MÃ của yêu cầu mở thầu khẩn cấp — không phải thứ để `git add -A`.
  if (!isAbsolute(v)) {
    throw new CauHinhError(`${ten} phải là đường dẫn TUYỆT ĐỐI (thư mục này nhận cảnh báo break-glass)`);
  }
  return v;
}

const BIEN_KHOA_LOCAL_DEV = ["TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_MASTER_KEY_ACTIVE"] as const;
const BIEN_KHOA_KMS = ["TRUSTPROCURE_AWS_REGION", "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID"] as const;

/** [ADR-064] Hai bộ biến khoá LOẠI TRỪ nhau — cùng quy tắc ⑷ của `apps/api/src/cau-hinh.ts`. */
function tuChoiBienCuaAdapterKhac(env: MoiTruong, adapter: string, bienKhac: readonly string[]): void {
  const sot = bienKhac.filter((b) => (env[b]?.trim() ?? "") !== "");
  if (sot.length > 0) {
    throw new CauHinhError(
      `TRUSTPROCURE_KEY_ADAPTER="${adapter}" nhưng còn khai ${sot.join(", ")} của adapter khoá kia (ADR-064)`,
    );
  }
}

function docKhoa(env: MoiTruong): KhoaWorkerLocalDev | KhoaWorkerAwsKms {
  const keyAdapter = docAdapter(env, "TRUSTPROCURE_KEY_ADAPTER", ["local-dev", "aws-kms"] as const, "khoá");
  if (keyAdapter === "local-dev") {
    tuChoiBienCuaAdapterKhac(env, keyAdapter, BIEN_KHOA_KMS);
    return { keyAdapter, masterKeys: docVong(env, "TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_MASTER_KEY_ACTIVE") };
  }
  tuChoiBienCuaAdapterKhac(env, keyAdapter, BIEN_KHOA_LOCAL_DEV);
  const region = bat(env, "TRUSTPROCURE_AWS_REGION");
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(region)) throw new CauHinhError("TRUSTPROCURE_AWS_REGION không phải một vùng AWS hợp lệ");
  const orgWrapKeyId = bat(env, "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID");
  if (!/^[A-Za-z0-9/:_.-]{1,2048}$/u.test(orgWrapKeyId)) {
    throw new CauHinhError("TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID không phải một định danh CMK hợp lệ");
  }
  return { keyAdapter, kms: { region, orgWrapKeyId } };
}

const EMAIL_DON = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,253}\.[^\s@,;<>"]{2,63}$/u;
const BIEN_CANH_BAO_DEV = ["TRUSTPROCURE_ALERT_DIR"] as const;
const BIEN_CANH_BAO_SES = [
  "TRUSTPROCURE_SES_REGION",
  "TRUSTPROCURE_SES_FROM",
  "TRUSTPROCURE_ALERT_EMAILS",
  "TRUSTPROCURE_SES_CONFIGURATION_SET",
] as const;

/** [ADR-065] Hai bộ biến cảnh báo LOẠI TRỪ nhau — cùng quy tắc với bộ biến khoá. */
function docCanhBao(env: MoiTruong): CanhBaoDevFile | CanhBaoSes {
  const alertAdapter = docAdapter(env, "TRUSTPROCURE_ALERT_ADAPTER", ["dev-file", "ses"] as const, "cảnh báo");
  const bienKhac = alertAdapter === "ses" ? BIEN_CANH_BAO_DEV : BIEN_CANH_BAO_SES;
  const sot = bienKhac.filter((b) => (env[b]?.trim() ?? "") !== "");
  if (sot.length > 0) {
    throw new CauHinhError(`TRUSTPROCURE_ALERT_ADAPTER="${alertAdapter}" nhưng còn khai ${sot.join(", ")} của adapter kia (ADR-065)`);
  }
  if (alertAdapter === "dev-file") return { alertAdapter, alertDir: docThuMucTuyetDoi(env, "TRUSTPROCURE_ALERT_DIR") };
  const region = bat(env, "TRUSTPROCURE_SES_REGION");
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/u.test(region)) throw new CauHinhError("TRUSTPROCURE_SES_REGION không phải một vùng AWS hợp lệ");
  const tuDiaChi = bat(env, "TRUSTPROCURE_SES_FROM");
  if (!EMAIL_DON.test(tuDiaChi)) throw new CauHinhError("TRUSTPROCURE_SES_FROM không phải một địa chỉ email đơn");
  const denDiaChi = bat(env, "TRUSTPROCURE_ALERT_EMAILS")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "");
  if (denDiaChi.length === 0 || denDiaChi.length > 50) throw new CauHinhError("TRUSTPROCURE_ALERT_EMAILS cần 1–50 địa chỉ");
  if (denDiaChi.some((d) => !EMAIL_DON.test(d))) throw new CauHinhError("TRUSTPROCURE_ALERT_EMAILS có một mục không phải email đơn");
  if (new Set(denDiaChi).size !== denDiaChi.length) throw new CauHinhError("TRUSTPROCURE_ALERT_EMAILS khai trùng một địa chỉ");
  const cs = env["TRUSTPROCURE_SES_CONFIGURATION_SET"]?.trim();
  const configurationSet = cs === undefined || cs === "" ? undefined : cs;
  if (configurationSet !== undefined && !/^[A-Za-z0-9_-]{1,64}$/u.test(configurationSet)) {
    throw new CauHinhError("TRUSTPROCURE_SES_CONFIGURATION_SET phải dài 1–64 ký tự [A-Za-z0-9_-]");
  }
  return { alertAdapter, ses: { region, tuDiaChi, denDiaChi, configurationSet } };
}

export function docCauHinh(env: MoiTruong): CauHinhWorker {
  return {
    databaseUrl: docDatabaseUrl(env, "TRUSTPROCURE_DATABASE_URL"),
    dbPoolMax: docSoNguyen(env, "TRUSTPROCURE_DB_POOL_MAX", 10, 1, 100),
    ...docKhoa(env),
    ...docCanhBao(env),
    pollIntervalMs: docSoNguyen(env, "TRUSTPROCURE_OUTBOX_POLL_MS", 1000, 100, 60_000),
  };
}
