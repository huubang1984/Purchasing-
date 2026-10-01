// ==============================================================================================
// tools/pilot-gia-lap — DỰNG MỘT CỤM CỤC BỘ BẰNG MỘT LỆNH
//
// ADR-044 ghi công thức chạy lát cắt demo bằng tay: tạo hai vai đăng nhập, sinh ba vòng khoá 32 byte
// đôi một khác nhau, một khoá ký biên nhận PKCS8, rồi khai hơn hai mươi biến môi trường cho bốn tiến
// trình. Một người đi trình diễn không nên phải làm lại việc ấy, nên tệp này làm thay — và làm theo
// đúng hình dạng mà cấu hình của từng ứng dụng đòi (`apps/*/src/cau-hinh.ts`), không nới gì:
//   - khoá local-dev (`TRUSTPROCURE_KEY_ADAPTER=local-dev`, `NODE_ENV=development`) — hàng rào
//     `assertLocalDevAllowed` vẫn đứng nguyên;
//   - bộ gửi hộp thư dev; cảnh báo worker ghi tệp;
//   - `TRUSTPROCURE_TRUSTED_PROXIES=127.0.0.1` để mỗi diễn viên mang địa chỉ riêng qua
//     `X-Forwarded-For` (xem `http.ts`) — chỉ nghe trên 127.0.0.1 nên không ai ngoài máy chạm được.
//
// BÍ MẬT CỦA CỤM được sinh MỘT lần và giữ ở `<thư mục trạng thái>/cum.json` (0600): khoá bọc của tổ
// chức mà lượt đầu tạo ra phải mở được ở lượt sau, và `api` từ chối khởi động khi dấu kiểm vòng khoá
// lệch với dấu đã ghi trong CSDL (khoản 165). Một thư mục trạng thái đi với MỘT CSDL.
//
// Tiến trình con nhận môi trường SẠCH: mọi biến `TRUSTPROCURE_*`, `PG*` và `DATABASE_URL` của người gọi
// bị bỏ trước khi đặt biến của cụm — URL đặc quyền, và mật khẩu superuser mà `PGPASSWORD` có thể mang
// cho kết nối đặc quyền, không đi xuống `api`.
// ==============================================================================================

import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));

export interface BiMatCum {
  readonly phienBan: 1;
  readonly matKhauApi: string;
  readonly matKhauWorker: string;
  readonly masterKey: string;
  readonly totpMasterKey: string;
  readonly otpPepper: string;
  readonly receiptKid: string;
  readonly receiptPkcs8: string;
  readonly receiptSpki: string;
}

export interface CongCum {
  readonly api: number;
  readonly web: number;
  readonly khoa: number;
}

export const CONG_MAC_DINH: CongCum = { api: 18080, web: 18090, khoa: 18070 };

export class CumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CumError";
  }
}

function sinhBiMat(): BiMatCum {
  const b64 = (): string => randomBytes(32).toString("base64");
  const mk = (): string => randomBytes(32).toString("base64url");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    phienBan: 1,
    matKhauApi: mk(),
    matKhauWorker: mk(),
    masterKey: b64(),
    totpMasterKey: b64(),
    otpPepper: b64(),
    receiptKid: "k1",
    receiptPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    receiptSpki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

/**
 * Thư mục trạng thái giữ vòng khoá bọc, bí mật TOTP và token lời mời, nên nó KHÔNG được nằm ở một chỗ
 * git theo dõi. Một lần soi ở vòng này: `--thu-muc demo` rơi vào `<gốc kho>/demo/`, ngoài `.gitignore`,
 * và `git add -A` sẽ mang `cum.json` đi. Trong kho thì chỉ nhận dưới một thư mục tên `.pilot-gia-lap`
 * (mẫu của `.gitignore`); ngoài kho thì nhận mọi chỗ.
 */
export function kiemThuMucTrangThai(goc: string, thuMuc: string): void {
  const r = relative(goc, thuMuc);
  if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) return;
  if (r.split(sep).includes(".pilot-gia-lap")) return;
  throw new CumError(
    `thư mục trạng thái ${thuMuc} nằm trong kho mà không dưới một thư mục \`.pilot-gia-lap\` — nó sẽ giữ khoá và bí mật TOTP ` +
      "ở chỗ git theo dõi. Dùng một đường dẫn ngoài kho, hay <gốc kho>/.pilot-gia-lap/<tên>",
  );
}

/**
 * [S1.255 / khoản 328] Câu cảnh báo khi dựng cụm trên Windows mà thư mục trạng thái nằm NGOÀI hồ sơ người dùng; `null` khi không.
 *
 * Windows bỏ qua `mode: 0o700` của `docBiMat`: thư mục thừa hưởng ACL của cha. Đo trên máy của lượt đi thử bậc 1: kho trên `D:\`,
 * gốc ổ cho `Authenticated Users` quyền sửa và `Users` quyền đọc, máy có hai tài khoản bật — tài khoản kia đọc được `cum.json`,
 * bí mật TOTP và link đăng nhập còn hạn. Hồ sơ người dùng mặc định chỉ chủ đọc được, nên "nằm dưới hồ sơ" là đúng điều kế hoạch
 * §4 khuyên. PHÁT BIỂU ĐÚNG MỨC: đây là phép kiểm theo ĐƯỜNG DẪN, không đọc ACL — một thư mục ngoài hồ sơ mà ACL đã siết vẫn bị
 * cảnh báo, và một hồ sơ mà ai đó đã nới ACL thì không. Cảnh báo, không từ chối: mọi dữ liệu của cụm là giả lập.
 * So bằng `path.win32` (không phụ thuộc máy chạy test); `win32.relative` so không phân biệt hoa thường, như Windows.
 */
export function canhBaoAclWindows(nenTang: NodeJS.Platform, thuMuc: string, hoSo: string): string | null {
  if (nenTang !== "win32") return null;
  const r = win32.relative(hoSo, thuMuc);
  if (r !== ".." && !r.startsWith(`..${win32.sep}`) && !win32.isAbsolute(r)) return null;
  return (
    `CẢNH BÁO (khoản 328): trên Windows, thư mục trạng thái ${thuMuc} thừa hưởng ACL của thư mục cha — bit 0700 không có tác ` +
    `dụng — và nó nằm ngoài hồ sơ người dùng ${hoSo}. Nếu thư mục cha cho \`Users\` hay \`Authenticated Users\` đọc, một tài khoản ` +
    "khác trên máy này đọc được cum.json (vòng khoá, mật khẩu hai vai đăng nhập), bí mật TOTP của người mua giả lập và link đăng " +
    `nhập còn hạn trong hop-thu/. Kiểm: icacls "${thuMuc}". Tránh: đặt kho dưới hồ sơ người dùng, hay thêm ` +
    `--thu-muc "${win32.join(hoSo, ".pilot-gia-lap")}" vào MỌI lệnh pnpm pilot:gia-lap.`
  );
}

/** Thư mục trạng thái 0700 (POSIX — Windows bỏ qua bit quyền, thư mục thừa hưởng ACL của cha), rồi đọc `cum.json` nếu có. */
export async function docBiMat(thuMuc: string): Promise<BiMatCum | null> {
  await mkdir(thuMuc, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(thuMuc, 0o700);
  const tep = join(thuMuc, "cum.json");
  let tho: Partial<BiMatCum>;
  try {
    tho = JSON.parse(await readFile(tep, "utf8")) as Partial<BiMatCum>;
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
  if (tho.phienBan !== 1 || typeof tho.masterKey !== "string" || typeof tho.receiptPkcs8 !== "string") {
    throw new CumError(`${tep} không đúng hình dạng — xoá thư mục trạng thái và dùng một CSDL mới`);
  }
  return tho as BiMatCum;
}

/** Sinh và ghi `cum.json` 0600; không bao giờ ghi đè một tệp có sẵn. */
export async function taoBiMat(thuMuc: string): Promise<BiMatCum> {
  const biMat = sinhBiMat();
  await writeFile(join(thuMuc, "cum.json"), JSON.stringify(biMat, null, 2), { mode: 0o600, flag: "wx" });
  return biMat;
}

/** Bỏ mọi biến của dự án khỏi môi trường người gọi — xem khối đầu tệp. */
export function moiTruongSach(goc: NodeJS.ProcessEnv): Record<string, string> {
  const ra: Record<string, string> = {};
  for (const [k, v] of Object.entries(goc)) {
    if (v === undefined) continue;
    if (k.startsWith("TRUSTPROCURE_") || k.startsWith("PG") || k === "DATABASE_URL" || k === "NODE_ENV" || k.startsWith("NODE_OPTIONS")) continue;
    ra[k] = v;
  }
  return ra;
}

export interface ThamSoCum {
  readonly thuMuc: string;
  readonly cong: CongCum;
  readonly biMat: BiMatCum;
  readonly urlApi: string;
  readonly urlWorker: string;
}

/** Môi trường của từng tiến trình — hàm thuần để test đọc được mà không dựng tiến trình nào. */
export function moiTruongTienTrinh(ten: "api" | "unseal-worker" | "web" | "public-keys", ts: ThamSoCum): Record<string, string> {
  const web = `http://127.0.0.1:${ts.cong.web}`;
  const chung = { NODE_ENV: "development" };
  const b = ts.biMat;
  switch (ten) {
    case "api":
      return {
        ...chung,
        TRUSTPROCURE_DATABASE_URL: ts.urlApi,
        TRUSTPROCURE_KEY_ADAPTER: "local-dev",
        TRUSTPROCURE_SENDER_ADAPTER: "dev-mailbox",
        TRUSTPROCURE_DEV_MAILBOX_DIR: join(ts.thuMuc, "hop-thu"),
        TRUSTPROCURE_MASTER_KEYS: `v1=${b.masterKey}`,
        TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
        TRUSTPROCURE_TOTP_MASTER_KEYS: `v1=${b.totpMasterKey}`,
        TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "v1",
        TRUSTPROCURE_OTP_PEPPERS: `v1=${b.otpPepper}`,
        TRUSTPROCURE_OTP_PEPPER_ACTIVE: "v1",
        TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `${b.receiptKid}=${b.receiptPkcs8}`,
        TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: b.receiptKid,
        TRUSTPROCURE_PUBLIC_BASE_URL: web,
        TRUSTPROCURE_ALLOWED_ORIGINS: web,
        TRUSTPROCURE_TRUSTED_PROXIES: "127.0.0.1",
        TRUSTPROCURE_LISTEN_HOST: "127.0.0.1",
        TRUSTPROCURE_LISTEN_PORT: String(ts.cong.api),
      };
    case "unseal-worker":
      return {
        ...chung,
        TRUSTPROCURE_DATABASE_URL: ts.urlWorker,
        TRUSTPROCURE_KEY_ADAPTER: "local-dev",
        TRUSTPROCURE_MASTER_KEYS: `v1=${b.masterKey}`,
        TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
        TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
        TRUSTPROCURE_ALERT_DIR: join(ts.thuMuc, "canh-bao"),
        TRUSTPROCURE_OUTBOX_POLL_MS: "500",
      };
    case "web":
      return {
        ...chung,
        TRUSTPROCURE_API_ORIGIN: `http://127.0.0.1:${ts.cong.api}`,
        TRUSTPROCURE_WEB_HOST: "127.0.0.1",
        TRUSTPROCURE_WEB_PORT: String(ts.cong.web),
      };
    case "public-keys":
      return {
        ...chung,
        TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ [b.receiptKid]: b.receiptSpki }),
        TRUSTPROCURE_RECEIPT_ACTIVE_KID: b.receiptKid,
        TRUSTPROCURE_PUBLIC_KEYS_HOST: "127.0.0.1",
        TRUSTPROCURE_PUBLIC_KEYS_PORT: String(ts.cong.khoa),
      };
  }
}

interface TienTrinhCon {
  readonly ten: string;
  readonly con: ChildProcess;
  readonly log: string;
}

export interface Cum {
  readonly apiGoc: string;
  readonly webGoc: string;
  readonly khoaGoc: string;
  readonly hopThuDir: string;
  readonly logDir: string;
  /**
   * Bật worker mở thầu. TÁCH khỏi `khoiDongCum` vì một lần đo: worker từ chối khởi động khi
   * `public.outbox_danh_sach_to_chuc()` trả 0 tổ chức (cạnh ❷ của ADR-040 — một hàng rào cố ý, để lần
   * hỏng của policy liệt kê không thành im lặng). Trên một CSDL mới, tổ chức đầu tiên chỉ có sau khi bộ
   * giả lập gieo nó, nên worker phải lên SAU bước ấy.
   */
  batWorker(): Promise<void>;
  dung(): Promise<void>;
}

async function traLoi(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    await r.arrayBuffer();
    return r.status;
  } catch {
    return null;
  }
}

async function duoiLog(tep: string, soDong = 6): Promise<string> {
  try {
    return (await readFile(tep, "utf8")).trimEnd().split(/\r?\n/u).slice(-soDong).join("\n");
  } catch {
    return "(không đọc được log)";
  }
}

function khoi(ten: "api" | "unseal-worker" | "web" | "public-keys", ts: ThamSoCum, logDir: string, nen: Record<string, string>): TienTrinhCon {
  const log = join(logDir, `${ten}.log`);
  const fd = openSync(log, "a", 0o600);
  try {
    const con = spawn(
      process.execPath,
      ["--experimental-transform-types", "--import", `./apps/${ten}/register-ts-resolve.mjs`, `apps/${ten}/src/main.ts`],
      { cwd: GOC_KHO, env: { ...nen, ...moiTruongTienTrinh(ten, ts) }, stdio: ["ignore", fd, fd], windowsHide: true },
    );
    return { ten, con, log };
  } finally {
    closeSync(fd);
  }
}

async function choSan(tt: TienTrinhCon, url: string | null, choMs: number): Promise<void> {
  const han = Date.now() + choMs;
  for (;;) {
    if (tt.con.exitCode !== null || tt.con.signalCode !== null) {
      throw new CumError(`tiến trình ${tt.ten} dừng lúc khởi động — log ${tt.log}:\n${await duoiLog(tt.log)}`);
    }
    if (url === null) {
      if (Date.now() > han) return;
    } else if ((await traLoi(url)) === 200) {
      return;
    }
    if (url !== null && Date.now() > han) throw new CumError(`${tt.ten} chưa trả lời ${url} sau ${choMs} ms — log ${tt.log}:\n${await duoiLog(tt.log)}`);
    await new Promise((xong) => setTimeout(xong, 300));
  }
}

async function dungMot(tt: TienTrinhCon): Promise<void> {
  if (tt.con.exitCode !== null || tt.con.signalCode !== null) return;
  const xong = new Promise<void>((kq) => tt.con.once("exit", () => kq()));
  tt.con.kill("SIGTERM");
  const hetGio = new Promise<"het">((kq) => setTimeout(() => kq("het"), 8000).unref());
  if ((await Promise.race([xong.then(() => "xong" as const), hetGio])) === "het") tt.con.kill("SIGKILL");
}

/**
 * Dựng api, web, khoá công khai và đợi từng cái sẵn sàng; worker bật riêng (`batWorker`). Ném thì mọi
 * tiến trình đã dựng đều bị dừng. `khiCoDung` nhận hàm dừng cụm TRƯỚC khi tiến trình con đầu tiên ra
 * đời — để một tín hiệu tới giữa lúc khởi động (có thể tới hai phút) cũng dừng được những gì đã dựng.
 */
export async function khoiDongCum(ts: ThamSoCum, khiCoDung: (dung: () => Promise<void>) => void = () => undefined): Promise<Cum> {
  const apiGoc = `http://127.0.0.1:${ts.cong.api}`;
  const webGoc = `http://127.0.0.1:${ts.cong.web}`;
  const khoaGoc = `http://127.0.0.1:${ts.cong.khoa}`;
  for (const [ten, url] of [
    ["api", `${apiGoc}/health`],
    ["web", `${webGoc}/`],
    ["public-keys", `${khoaGoc}/`],
  ] as const) {
    if ((await traLoi(url)) !== null) {
      throw new CumError(`cổng của ${ten} (${url}) đang có tiến trình khác nghe — dừng cụm cũ, hay đổi bằng --cong-api/--cong-web/--cong-khoa`);
    }
  }
  const logDir = join(ts.thuMuc, "log");
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  const hopThuDir = join(ts.thuMuc, "hop-thu");
  const nen = moiTruongSach(process.env);
  const con: TienTrinhCon[] = [];
  const dung = async (): Promise<void> => {
    await Promise.all(con.map((c) => dungMot(c)));
  };
  khiCoDung(dung);
  try {
    const api = khoi("api", ts, logDir, nen);
    con.push(api);
    await choSan(api, `${apiGoc}/health`, 60_000);
    const web = khoi("web", ts, logDir, nen);
    con.push(web);
    await choSan(web, `${webGoc}/mo-thau`, 30_000);
    const khoa = khoi("public-keys", ts, logDir, nen);
    con.push(khoa);
    await choSan(khoa, `${khoaGoc}/.well-known/trustprocure-receipt-keys`, 30_000);
  } catch (e) {
    await dung();
    throw e;
  }
  let coWorker = false;
  const batWorker = async (): Promise<void> => {
    if (coWorker) return;
    coWorker = true;
    const worker = khoi("unseal-worker", ts, logDir, nen);
    con.push(worker);
    // Worker không có cổng HTTP: "sẵn sàng" nghĩa là nó sống qua lượt kiểm vai, đồng hồ và danh sách
    // tổ chức lúc khởi động.
    await choSan(worker, null, 5000);
  };
  return { apiGoc, webGoc, khoaGoc, hopThuDir, logDir, batWorker, dung };
}
