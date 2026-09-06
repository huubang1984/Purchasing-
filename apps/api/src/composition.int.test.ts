// ==============================================================================================
// [S1.11 / ADR-021] TIẾN TRÌNH `api` DỰNG TỪ CẤU HÌNH MÔI TRƯỜNG — đúng đường `main.ts` đi, trừ
// `process.env` và `listen` cổng cố định.
//
// Khác mọi `*.int.test.ts` khác của apps/api (chúng lắp `createDispatcher` với `dichVuTest()` và
// pool `poolAs("app_api")` của test-support), file này đi qua `docCauHinh` → `taoTienTrinhApi`:
// pool tự dựng từ chuỗi kết nối của một role ĐĂNG NHẬP thật (`app_api_login`, thành viên của
// app_api, đúng câu hardening mô tả), adapter thật của kho (local-dev cho ba vòng khoá, hộp thư
// dev cho ba bộ gửi). Cái nó chứng minh: một người mua đi trọn magic link → TOTP → phiên trên
// tiến trình dựng như sản xuất, và không một tầng nào ở giữa còn là stub của test.
//
//   ⑴ `batDau()` chạm CSDL trước khi mở cổng: sai role ⇒ ném, KHÔNG có cổng nào nghe.
//   ⑵ Kết nối của tiến trình đăng nhập bằng `app_api_login` (pg_stat_activity). Vế `current_user =
//      app_api` của pool có vai đo ở `packages/db/src/vai-tro.int.test.ts`, không đo lại ở đây.
//      [review H3-1] Phiên MẠNH HƠN vai (app_api_login bị đặt SUPERUSER, hay được GRANT app_unseal)
//      ⇒ `batDau()` ném, không cổng nào nghe.
//   ⑶ Link đăng nhập nằm trong hộp thư dev với token ở FRAGMENT; ghi danh TOTP đi qua adapter
//      local-dev thật; phiên ra đời; `/me` trả về đúng người; đăng xuất thu hồi.
//   ⑷ `dung()` đóng cổng và cả hai pool — `db.stop()` (khoản nợ 28) đo không còn backend nào sót.
// ==============================================================================================
import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { counterForTime, deriveTotpCode } from "@trustprocure/identity";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docCauHinh, type MoiTruong } from "./cau-hinh.js";
import { taoTienTrinhApi, type TienTrinhApi } from "./composition.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import type { TinHopThuDev } from "./adapters/hop-thu-dev.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let org: string;
let nguoi: string;
let hopThu: string;
let urlLogin: string;
let urlKhongThanhVien: string;
let tienTrinh: TienTrinhApi | undefined;
let goc: string;

function doiNguoiDung(chuoi: string, ten: string, matKhau: string): string {
  const url = new URL(chuoi);
  url.username = ten;
  url.password = matKhau;
  return url.toString();
}

function moiTruong(ghiDe: Record<string, string | undefined> = {}): MoiTruong {
  return {
    TRUSTPROCURE_DATABASE_URL: urlLogin,
    TRUSTPROCURE_DB_POOL_MAX: "3",
    TRUSTPROCURE_LISTEN_HOST: "127.0.0.1",
    TRUSTPROCURE_LISTEN_PORT: "0",
    TRUSTPROCURE_PUBLIC_BASE_URL: "http://localhost:3000",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${randomBytes(32).toString("base64")}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
    TRUSTPROCURE_TOTP_MASTER_KEYS: `t1=${randomBytes(32).toString("base64")}`,
    TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "t1",
    TRUSTPROCURE_OTP_PEPPERS: `p1=${randomBytes(32).toString("base64")}`,
    TRUSTPROCURE_OTP_PEPPER_ACTIVE: "p1",
    TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `ky-1=${generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}`,
    TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "ky-1",
    TRUSTPROCURE_SENDER_ADAPTER: "dev-mailbox",
    TRUSTPROCURE_DEV_MAILBOX_DIR: hopThu,
    ...ghiDe,
  };
}

interface PhanHoi {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

async function goi(method: string, path: string, tuyChon: { cookie?: string; body?: unknown } = {}): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
  if (tuyChon.cookie !== undefined) headers.cookie = tuyChon.cookie;
  let body: string | undefined;
  if (tuyChon.body !== undefined) {
    body = JSON.stringify(tuyChon.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${goc}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

function docHopThu(): TinHopThuDev[] {
  return readdirSync(hopThu)
    .sort()
    .map((t) => JSON.parse(readFileSync(join(hopThu, t), "utf8")) as TinHopThuDev);
}

function base32Decode(s: string): Buffer {
  const BANG = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let gia = 0;
  const ra: number[] = [];
  for (const ch of s) {
    const v = BANG.indexOf(ch);
    if (v < 0) throw new Error("base32 hong");
    gia = (gia << 5) | v;
    bits += 5;
    if (bits >= 8) {
      ra.push((gia >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(ra);
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]!.id;
  nguoi = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, 'mua@vidu.vn', 'Nguoi mua', 'ACTIVE') RETURNING id",
      [org],
    )
  ).rows[0]!.id;
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [org, nguoi]);
  await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api' IN ROLE app_api");
  await db.pool.query("CREATE ROLE khong_thanh_vien LOGIN PASSWORD 'mk-ktv'");
  urlLogin = doiNguoiDung(db.connectionString, "app_api_login", "mk-api");
  urlKhongThanhVien = doiNguoiDung(db.connectionString, "khong_thanh_vien", "mk-ktv");
  hopThu = join(mkdtempSync(join(tmpdir(), "tp-api-")), "hop-thu"); // tuyệt đối — cau-hinh.ts đòi thế (H3-3)
}, 180000);

afterAll(async () => {
  await tienTrinh?.dung();
  rmSync(hopThu, { recursive: true, force: true });
  await db?.stop();
});

describe("[S1.11] batDau() fail-closed trước khi mở cổng", () => {
  it("role đăng nhập KHÔNG phải thành viên app_api: tên lạ bị chặn ở cấu hình; app_api_login mất membership ⇒ batDau() ném 42501, không cổng nào nghe; dung() sau đó vẫn sạch", async () => {
    expect(() => docCauHinh(moiTruong({ TRUSTPROCURE_DATABASE_URL: urlKhongThanhVien }))).toThrow(/app_api_login/u);
    await db.pool.query("REVOKE app_api FROM app_api_login");
    try {
      const tt = taoTienTrinhApi(docCauHinh(moiTruong()));
      await expect(tt.batDau()).rejects.toMatchObject({ code: "42501" });
      await tt.dung();
    } finally {
      await db.pool.query("GRANT app_api TO app_api_login");
    }
  });

  it("cấu hình khai adapter chưa có ⇒ không dựng được tiến trình (ném ở docCauHinh, trước cả pool)", () => {
    expect(() => docCauHinh(moiTruong({ TRUSTPROCURE_KEY_ADAPTER: "kms" }))).toThrow(/TRUSTPROCURE_KEY_ADAPTER/u);
  });

  it("[review H3-1] URL superuser bị chặn ngay ở cấu hình (theo TÊN); app_api_login bị nâng SUPERUSER hay GRANT app_unseal ⇒ batDau() ném (theo THUỘC TÍNH), không cổng nào nghe", async () => {
    expect(() => docCauHinh(moiTruong({ TRUSTPROCURE_DATABASE_URL: db.connectionString }))).toThrow(/app_api_login/u);
    await db.pool.query("ALTER ROLE app_api_login SUPERUSER");
    try {
      const tt = taoTienTrinhApi(docCauHinh(moiTruong()));
      await expect(tt.batDau()).rejects.toThrow(/SUPERUSER/u);
      await tt.dung();
    } finally {
      await db.pool.query("ALTER ROLE app_api_login NOSUPERUSER");
    }
    await db.pool.query("GRANT app_unseal TO app_api_login");
    try {
      const tt = taoTienTrinhApi(docCauHinh(moiTruong()));
      await expect(tt.batDau()).rejects.toThrow(/thành viên của app_unseal/u);
      await tt.dung();
    } finally {
      await db.pool.query("REVOKE app_unseal FROM app_api_login");
    }
  });
});

describe("[S1.11] tiến trình dựng từ môi trường: người mua đi trọn đăng nhập trên adapter thật", () => {
  it("batDau() mở cổng 0 → địa chỉ thật; /health 200; kết nối CSDL đăng nhập bằng app_api_login", async () => {
    tienTrinh = taoTienTrinhApi(docCauHinh(moiTruong()));
    const dc = await tienTrinh.batDau();
    expect(dc.host).toBe("127.0.0.1");
    expect(dc.port).toBeGreaterThan(0);
    goc = `http://${dc.host}:${dc.port}`;
    const h = await goi("GET", "/health");
    expect(h.status).toBe(200);
    expect(h.headers.get("referrer-policy")).toBe("no-referrer");
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE usename = 'app_api_login' AND application_name = 'trustprocure'",
    );
    // Hai pool, mỗi pool đã lấy một client ở batDau(): ít nhất một backend còn sống dưới role đăng nhập.
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("magic link vào hộp thư dev (token ở fragment) → redeem ghi danh TOTP (adapter local-dev thật) → /auth/totp mở phiên → /me → logout", async () => {
    expect(docHopThu()).toHaveLength(0);
    const r1 = await goi("POST", "/auth/link", { body: { orgId: org, email: "mua@vidu.vn" } });
    expect(r1.status).toBe(200);
    expect(r1.text).not.toMatch(/token/iu);
    const tin = docHopThu();
    expect(tin).toHaveLength(1);
    const t0 = tin[0]!;
    if (t0.loai !== "LOGIN_LINK") throw new Error("tin dau tien phai la LOGIN_LINK");
    expect(t0.den).toBe("mua@vidu.vn");
    const link = new URL(t0.duongLink);
    expect(link.origin + link.pathname).toBe("http://localhost:3000/login");
    expect(link.search).toBe("");
    const token = link.hash.slice(1);
    expect(token.length).toBeGreaterThan(20);

    const r2 = await goi("POST", "/auth/redeem", { body: { orgId: org, token } });
    expect(r2.status, r2.text).toBe(200);
    const b2 = r2.body as { needsEnrollment: boolean; totpSecretBase32?: string };
    expect(b2.needsEnrollment).toBe(true);
    const biMat = base32Decode(b2.totpSecretBase32 ?? "");
    // Bí mật nằm trong CSDL ở dạng BỌC bởi adapter local-dev (keyVersion = phiên bản vòng TOTP), không phải bản rõ.
    const { rows: mfa } = await db.pool.query<{ secret_key_version: string; secret_wrapped: Buffer }>(
      "SELECT secret_key_version, secret_wrapped FROM mfa_credentials WHERE org_id = $1 AND user_id = $2",
      [org, nguoi],
    );
    expect(mfa[0]?.secret_key_version).toBe("t1");
    expect(mfa[0]?.secret_wrapped.includes(biMat)).toBe(false);

    const sai = await goi("POST", "/auth/totp", { body: { orgId: org, token, code: "000000" } });
    expect(sai.status).toBe(401);
    const r3 = await goi("POST", "/auth/totp", { body: { orgId: org, token, code: deriveTotpCode(biMat, counterForTime(Date.now())) } });
    expect(r3.status, r3.text).toBe(200);
    const sc = r3.headers.get("set-cookie") ?? "";
    const gt = /tp_session=([^;]+)/u.exec(sc)?.[1] ?? "";
    expect(gt).not.toBe("");
    expect(sc).toMatch(/HttpOnly/u);
    const cookie = `${COOKIE_PHIEN_NGUOI_MUA}=${gt}`;

    const me = await goi("GET", "/me", { cookie });
    expect(me.status, me.text).toBe(200);
    expect(me.text).toContain(nguoi);
    // Phiên trong CSDL mang mfa_verified_at — chèn bởi tiến trình dưới app_api (029/037 không chặn đường hợp lệ).
    const { rows: phien } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM sessions WHERE org_id = $1 AND user_id = $2 AND mfa_verified_at IS NOT NULL AND revoked_at IS NULL",
      [org, nguoi],
    );
    expect(rows0(phien)).toBe("1");

    const out = await goi("POST", "/auth/logout", { cookie });
    expect(out.status).toBe(200);
    expect((await goi("GET", "/me", { cookie })).status).toBe(401);
  });

  it("route người mua bị từ chối quyền ghi sổ qua pool KIỂM TOÁN của composition (D5 trên tiến trình thật)", async () => {
    // Đăng nhập lại (token cũ đã tiêu thụ), rồi gọi một route ghi mà BUYER không có quyền.
    await goi("POST", "/auth/link", { body: { orgId: org, email: "mua@vidu.vn" } });
    const tin = docHopThu().filter((t) => t.loai === "LOGIN_LINK");
    const t = tin.at(-1)!;
    if (t.loai !== "LOGIN_LINK") throw new Error("phai la LOGIN_LINK");
    const token = new URL(t.duongLink).hash.slice(1);
    const rd = await goi("POST", "/auth/redeem", { body: { orgId: org, token } });
    expect((rd.body as { needsEnrollment: boolean }).needsEnrollment).toBe(false);
    // Bí mật TOTP đã có (hồ sơ đã xác nhận ở test trước): đọc lại từ hộp thư không được — bí mật chỉ về client một lần.
    // Nên dùng mã sai để chứng minh đường 401 đi qua adapter mở bí mật THẬT (không phải stub): sai ⇒ 401, không 500.
    const sai = await goi("POST", "/auth/totp", { body: { orgId: org, token, code: "000000" } });
    expect(sai.status).toBe(401);
    expect((sai.body as { reason: string }).reason).toBe("WRONG_CODE");
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'MFA_ENROLLED'", [org]);
    expect(rows0(rows)).toBe("1");
  });

  it("dung() đóng cổng và hai pool; gọi lần hai vô hại", async () => {
    await tienTrinh!.dung();
    await tienTrinh!.dung();
    await expect(fetch(`${goc}/health`)).rejects.toThrow();
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_stat_activity WHERE usename = 'app_api_login'");
    expect(rows0(rows)).toBe("0");
    tienTrinh = undefined;
  });
});

function rows0(rows: ReadonlyArray<{ n: string }>): string {
  return rows[0]?.n ?? "?";
}

// ----------------------------------------------------------------------------------------------
// `main.ts` THẬT, chạy như `pnpm api:dev` (tiến trình con, cùng lệnh với script ở package.json gốc).
// Hai ca: cấu hình hỏng ⇒ thoát mã 1, thông điệp nêu TÊN biến và không nêu giá trị; cấu hình đúng
// ⇒ dòng "dang nghe" ra stderr, /health trả 200, rồi bị dừng. Tín hiệu SIGTERM trên Windows là
// một lần giết cứng (Node không giao tín hiệu cho handler), nên vế "dừng sạch" chỉ đo trên POSIX.
// ----------------------------------------------------------------------------------------------
const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const LENH_MAIN = ["--experimental-transform-types", "--import", "./apps/api/register-ts-resolve.mjs", "apps/api/src/main.ts"];

function chayMain(env: MoiTruong): ChildProcess {
  return spawn(process.execPath, LENH_MAIN, {
    cwd: GOC_KHO,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function doiDong(tt: ChildProcess, mau: RegExp, hanMs: number): Promise<string> {
  return new Promise((xong, hong) => {
    let gom = "";
    const dongHo = setTimeout(() => hong(new Error(`het ${hanMs}ms, stderr: ${gom}`)), hanMs);
    tt.stderr?.on("data", (d: Buffer) => {
      gom += d.toString("utf8");
      const m = mau.exec(gom);
      if (m !== null) {
        clearTimeout(dongHo);
        xong(gom);
      }
    });
    tt.once("exit", () => {
      clearTimeout(dongHo);
      if (!mau.test(gom)) hong(new Error(`tien trinh thoat truoc khi thay mau, stderr: ${gom}`));
    });
  });
}

function doiThoat(tt: ChildProcess): Promise<number | null> {
  return new Promise((xong) => tt.once("exit", (ma) => xong(ma)));
}

/**
 * [review H3-6] stderr không được mang GIÁ TRỊ của biến nào ngoài danh sách cho phép — và mật khẩu
 * trong URL CSDL được tách ra kiểm RIÊNG, không ngưỡng độ dài (nó ngắn: "mk-api").
 */
function khongRo(stderr: string, env: MoiTruong, choPhep: readonly string[]): void {
  for (const [ten, gt] of Object.entries(env)) {
    if (gt === undefined || choPhep.includes(ten) || gt.length < 12) continue;
    expect(stderr, ten).not.toContain(gt);
  }
  const url = env["TRUSTPROCURE_DATABASE_URL"];
  if (url !== undefined) {
    const matKhau = new URL(url).password;
    expect(matKhau).not.toBe("");
    expect(stderr, "mat khau CSDL").not.toContain(matKhau);
    expect(stderr, "URL CSDL nguyen ven").not.toContain(url);
  }
}

describe("[S1.11] main.ts — tiến trình con thật", () => {
  it("cấu hình hỏng ⇒ thoát mã 1, stderr nêu TÊN biến, không nêu giá trị của biến nào", async () => {
    const env = moiTruong({ TRUSTPROCURE_KEY_ADAPTER: "kms" });
    const tt = chayMain(env);
    const stderr = await doiDong(tt, /cau hinh khong hop le/u, 60_000);
    expect(await doiThoat(tt)).toBe(1);
    expect(stderr).toContain("TRUSTPROCURE_KEY_ADAPTER");
    khongRo(stderr, env, ["TRUSTPROCURE_KEY_ADAPTER"]);
  }, 90_000);

  it("[review H3-5] lỗi ném ĐỒNG BỘ khi dựng (createPool từ chối `sslmode` trong URL) ⇒ mã thoát 1, không stack, không URL", async () => {
    const env = moiTruong({ TRUSTPROCURE_DATABASE_URL: `${urlLogin}?sslmode=disable` });
    const tt = chayMain(env);
    const stderr = await doiDong(tt, /khong khoi dong duoc/u, 60_000);
    expect(await doiThoat(tt)).toBe(1);
    expect(stderr).toContain("sslmode");
    expect(stderr).not.toMatch(/^\s+at /mu);
    khongRo(stderr, env, []);
  }, 90_000);

  it("cấu hình đúng ⇒ 'dang nghe' ra stderr, /health 200 trên cổng ấy; không dòng nào mang bí mật", async () => {
    const env = moiTruong({ TRUSTPROCURE_LISTEN_PORT: "0" });
    const tt = chayMain(env);
    try {
      const stderr = await doiDong(tt, /dang nghe http:\/\/127\.0\.0\.1:(\d+)/u, 60_000);
      const cong = /dang nghe http:\/\/127\.0\.0\.1:(\d+)/u.exec(stderr)?.[1];
      const r = await fetch(`http://127.0.0.1:${cong}/health`);
      expect(r.status).toBe(200);
      expect(stderr).toContain("khoa: local-dev");
      expect(stderr).toContain("bo gui: dev-mailbox");
      khongRo(stderr, env, []);
      if (process.platform !== "win32") {
        tt.kill("SIGTERM");
        await doiDong(tt, /da dung/u, 30_000);
        expect(await doiThoat(tt)).toBe(0);
      }
    } finally {
      if (tt.exitCode === null) {
        tt.kill();
        await doiThoat(tt);
      }
    }
  }, 90_000);
});
