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
//   ⑶ Adapter phải được KHAI TÊN, và mỗi biến hôm nay chỉ có ĐÚNG MỘT giá trị hợp lệ. Một giá
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

export interface CauHinhWorker {
  /** `postgres://app_unseal_login:...@host/db` — pool tự đổi sang vai `app_unseal`. */
  readonly databaseUrl: string;
  /**
   * Cỡ MỖI pool. Tiến trình mở tới **2 ×** giá trị này: pool nghiệp vụ và `auditPool` riêng.
   * Khoản 116 (đoạn [S1.72] / khoản 121) đòi hai pool riêng — dùng lại pool của runner khi nó
   * chỉ có một kết nối thì mỗi lần TỪ CHỐI lúc giải mã chờ hết trần rồi ra `DenialAuditFailedError`.
   */
  readonly dbPoolMax: number;
  readonly keyAdapter: "local-dev";
  /** Vòng khoá chính bọc khoá riêng RFQ (ADR-019). Vòng DUY NHẤT tiến trình này giữ. */
  readonly masterKeys: VongBiMat;
  readonly alertAdapter: "dev-file";
  /** Thư mục nhận cảnh báo break-glass. TUYỆT ĐỐI, và nên nằm NGOÀI cây repo. */
  readonly alertDir: string;
  /** Nhịp poll của runner, ms. */
  readonly pollIntervalMs: number;
}

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

export function docCauHinh(env: MoiTruong): CauHinhWorker {
  return {
    databaseUrl: docDatabaseUrl(env, "TRUSTPROCURE_DATABASE_URL"),
    dbPoolMax: docSoNguyen(env, "TRUSTPROCURE_DB_POOL_MAX", 10, 1, 100),
    keyAdapter: docAdapter(env, "TRUSTPROCURE_KEY_ADAPTER", ["local-dev"] as const, "khoá"),
    masterKeys: docVong(env, "TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_MASTER_KEY_ACTIVE"),
    alertAdapter: docAdapter(env, "TRUSTPROCURE_ALERT_ADAPTER", ["dev-file"] as const, "cảnh báo"),
    alertDir: docThuMucTuyetDoi(env, "TRUSTPROCURE_ALERT_DIR"),
    pollIntervalMs: docSoNguyen(env, "TRUSTPROCURE_OUTBOX_POLL_MS", 1000, 100, 60_000),
  };
}
