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
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
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

// [khoản 165] MỘT khoá bọc cho mọi tiến trình dựng trong tệp này: từ `062`, tiến trình khởi động
// trước ghi dấu kiểm của `v1`, và mọi tiến trình sau giữ khoá KHÁC dưới cùng tên `v1` bị từ chối lên
// — đúng thứ khoản ấy đòi. Khoá ngẫu nhiên MỖI LẦN gọi `moiTruong` là một cụm dán nhầm khoá.
const KHOA_BOC = randomBytes(32).toString("base64");

function moiTruong(ghiDe: Record<string, string | undefined> = {}): MoiTruong {
  return {
    TRUSTPROCURE_DATABASE_URL: urlLogin,
    TRUSTPROCURE_DB_POOL_MAX: "3",
    TRUSTPROCURE_LISTEN_HOST: "127.0.0.1",
    TRUSTPROCURE_LISTEN_PORT: "0",
    TRUSTPROCURE_PUBLIC_BASE_URL: "http://localhost:3000",
    // [sổ nợ 41] Socket của mọi yêu cầu trong test là 127.0.0.1 — khai nó là proxy để đo đường X-Forwarded-For.
    TRUSTPROCURE_TRUSTED_PROXIES: "127.0.0.1",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_BOC}`,
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

async function goi(method: string, path: string, tuyChon: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<PhanHoi> {
  const headers: Record<string, string> = { ...tuyChon.headers };
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
  // [S1.22] CHỈ đọc `.json`. Bộ ghi tạo tệp `.tmp` rồi `rename` — đổi tên là nguyên tử, nên một
  // tệp `.json` luôn ĐẦY ĐỦ. Trước bản sửa ấy, người đọc này bắt được tệp vừa-tạo-chưa-ghi và
  // `JSON.parse` ném `Unexpected end of JSON input` (CI lượt S1.22, hai lượt liên tiếp).
  return readdirSync(hopThu)
    .filter((t) => t.endsWith(".json"))
    .sort()
    .map((t) => JSON.parse(readFileSync(join(hopThu, t), "utf8")) as TinHopThuDev);
}

/** [sổ nợ 38] Link ra đời SAU phản hồi, khi runner outbox của tiến trình được đánh thức: đợi tới khi hộp thư có `n` tin. */
async function doiHopThu(n: number, hanMs = 5000): Promise<TinHopThuDev[]> {
  const het = Date.now() + hanMs;
  for (;;) {
    const tin = docHopThu();
    if (tin.length >= n) return tin;
    if (Date.now() > het) throw new Error(`het ${hanMs}ms, hop thu co ${tin.length} tin, mong ${n}`);
    await new Promise((x) => setTimeout(x, 50));
  }
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

  // [khoản 165] Ca chịu lực của `062`: một tiến trình KHÁC đã khởi động với `KHOA_BOC` dưới `v1`
  // (lần dựng đầu tiên trong tệp ghi dấu kiểm), rồi tiến trình này dán NHẦM một khoá khác dưới cùng
  // tên. Trước khoản 165 nó LÊN và chỉ hỏng khi worker mở phong bì; nay nó KHÔNG mở cổng nào.
  it("[khoản 165] khoá bọc dán NHẦM dưới cùng tên phiên bản ⇒ batDau() ném DauKiemVongKhoaLechError, không cổng nào nghe", async () => {
    const dung = taoTienTrinhApi(docCauHinh(moiTruong()));
    await dung.batDau();
    await dung.dung();
    const nham = randomBytes(32).toString("base64");
    const tt = taoTienTrinhApi(docCauHinh(moiTruong({ TRUSTPROCURE_MASTER_KEYS: `v1=${nham}` })));
    const loi = await tt.batDau().then(
      () => null,
      (e: unknown) => e as Error,
    );
    await tt.dung();
    expect(loi?.name).toBe("DauKiemVongKhoaLechError");
    expect(loi?.message).toContain('"v1"');
    expect(loi?.message).not.toContain(nham);
    expect(loi?.message).not.toContain(KHOA_BOC);
  });

  // ============================================================================================
  // [khoản 196 / ADR-072 phần 1] ĐỒNG HỒ CSDL LỆCH ĐỒNG HỒ TIẾN TRÌNH.
  //
  // Đồng hồ của CSDL không vặn được từ một test, nên cảnh "trôi" được dựng ở phía tiến trình: một
  // đồng hồ tiêm chạy lệch N ms so với `Date.now`. Lúc KHỞI ĐỘNG: vượt ngưỡng ⇒ `LechDongHoError`,
  // không cổng nào nghe (đối chứng dương: cùng cấu hình, đồng hồ thật ⇒ lên). Lúc CHẠY: đồng hồ trôi
  // SAU khi đã lên ⇒ một dòng log cảnh báo mang tên `LechDongHo` và ba con số, tiến trình VẪN phục vụ,
  // và dòng ấy không mang giá trị nào của cấu hình (URL CSDL, mật khẩu).
  // ============================================================================================
  it("[khoản 196] đồng hồ tiến trình lệch 6 giờ 22 phút so với CSDL ⇒ batDau() ném LechDongHoError, không cổng nào nghe; ĐỐI CHỨNG: đồng hồ thật ⇒ lên", async () => {
    const lech = 6 * 3600_000 + 22 * 60_000;
    const tt = taoTienTrinhApi(docCauHinh(moiTruong()), { dongHo: () => Date.now() + lech });
    const loi = await tt.batDau().then(
      () => null,
      (e: unknown) => e as Error,
    );
    await tt.dung();
    expect(loi?.name).toBe("LechDongHoError");
    expect(loi?.message).toMatch(/lệch -229\d{5} ms/u);
    expect(loi?.message).not.toContain(urlLogin);
    const tot = taoTienTrinhApi(docCauHinh(moiTruong()));
    try {
      await expect(tot.batDau()).resolves.toMatchObject({ host: "127.0.0.1" });
    } finally {
      await tot.dung();
    }
  });

  it("[khoản 196] đồng hồ trôi SAU khi đã lên ⇒ dòng log `canh bao LechDongHo` mang ba con số, không mang URL; tiến trình VẪN phục vụ /health", async () => {
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    let troi = 0;
    const tt = taoTienTrinhApi(docCauHinh(moiTruong({ TRUSTPROCURE_CLOCK_SKEW_CHECK_MS: "1000" })), {
      dongHo: () => Date.now() + troi,
    });
    try {
      const dc = await tt.batDau();
      troi = -10_000;
      const het = Date.now() + 8000;
      let dong: string | undefined;
      while (dong === undefined && Date.now() < het) {
        await new Promise((x) => setTimeout(x, 100));
        dong = log.find((d) => d.includes("canh bao LechDongHo"));
      }
      expect(dong, JSON.stringify(log)).toBeDefined();
      expect(dong).toMatch(/lech \+\d{4,5} ms .*khu hoi \d+ ms, nguong 2000 ms/u);
      expect(dong).not.toContain(urlLogin);
      const r = await fetch(`http://${dc.host}:${dc.port}/health`);
      expect(r.status).toBe(200);
    } finally {
      await tt.dung();
      console.error = cu;
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
    expect(docHopThu(), "phản hồi về TRƯỚC khi link được gửi — handler không đợi bộ gửi").toHaveLength(0);
    const tin = await doiHopThu(1);
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
    // [sổ nợ 41] Socket 127.0.0.1 là proxy đã khai: hop ngoài cùng bên phải KHÔNG thuộc proxy là khách;
    // hop "1.1.1.1" do khách tự ghi trước đó bị bỏ qua.
    const r3 = await goi("POST", "/auth/totp", {
      body: { orgId: org, token, code: deriveTotpCode(biMat, counterForTime(Date.now())) },
      headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.9" },
    });
    expect(r3.status, r3.text).toBe(200);
    const { rows: ip } = await db.pool.query<{ ip: string }>(
      "SELECT host(ip) AS ip FROM sessions WHERE org_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1",
      [org, nguoi],
    );
    expect(ip[0]?.ip).toBe("203.0.113.9");
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
    const tin = (await doiHopThu(2)).filter((t) => t.loai === "LOGIN_LINK");
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
    // [S1.16] VÒNG CHỜ, không phải một phép đếm tức thì — và nó KHÔNG phải một ngưỡng được nới cho
    // tới lúc hết đỏ. `pool.end()` trả về khi client đã được YÊU CẦU đóng; backend phía Postgres
    // thoát sau đó vài mili-giây, nên bản cũ đo "đã đóng nhưng chưa thoát" và gọi nó là rò rỉ. Đo
    // được trong một lượt `pnpm evidence` song song: `expected '2' to be '0'` — đúng HAI backend,
    // tức đúng hai pool của tiến trình, ở khoảnh khắc ngay sau `dung()`.
    //
    // Cửa sổ 3 giây là con số ĐÃ CÓ LẬP LUẬN ở `packages/test-support/src/postgres.ts` (khoản nợ
    // 28, quyết định ⑴): nó nhỏ hơn `idleTimeoutMillis` mặc định 10 giây của `pg`, nên nó phân
    // biệt được "đã đóng, chưa thoát" với một pool BỊ BỎ QUÊN — thứ sẽ giữ client của nó tới 10
    // giây và vẫn làm khẳng định này đỏ. Nói cho đúng phạm vi: nó bắt rò rỉ SỐNG LÂU HƠN 3 giây.
    const demBackend = async (): Promise<string> => {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_stat_activity WHERE usename = 'app_api_login'",
      );
      return rows0(rows);
    };
    const hetHan = Date.now() + 3_000;
    let con = await demBackend();
    while (con !== "0" && Date.now() < hetHan) {
      await new Promise((xong) => setTimeout(xong, 25));
      con = await demBackend();
    }
    expect(con, "backend của app_api_login còn sống > 3 giây sau dung() — đây là rò rỉ pool thật").toBe("0");
    tienTrinh = undefined;
  });
});

function rows0(rows: ReadonlyArray<{ n: string }>): string {
  return rows[0]?.n ?? "?";
}

// ----------------------------------------------------------------------------------------------
// [S1.67 / khoản 118] CHỖ GHI LOG CỦA COMPOSITION ROOT MANG TÊN VÀ MÃ CỐ ĐỊNH CỦA LỖI — đo trên `taoTienTrinhApi` thật, mỗi `it` một
// tiến trình dừng trong `finally`. Lỗi được gây bằng một trigger tạm của superuser trên bảng thật, gỡ ngay sau phép đo:
//   ⑴ kết nối bị huỷ vì `SESSION_STATE_LEFT` sau một giao dịch đã commit — bộ nghe `release` mà composition gắn vào pool;
//   ⑵ handler của job outbox hỏng vì lỗi Postgres — `onJobFailure` (trước khoản 118: chỉ kind và lý do);
//   ⑶ lượt chạy của runner cho một tổ chức ném — dòng của lời đánh thức (trước khoản 118: chỉ tên lỗi);
//   ⑷ lần ghi sổ từ chối quyền qua `auditPool` để lại trạng thái phiên — bộ nghe `release` composition gắn vào `auditPool` (lượt soi 61a-3).
// Mỗi ca gọi `/auth/link` từ một địa chỉ riêng (proxy đã khai) với một email không có người dùng: bộ đếm theo người gọi của các test
// trên không đổi, và không tin nào vào hộp thư.
// ----------------------------------------------------------------------------------------------
describe("[S1.67 / khoản 118] tiến trình dựng từ môi trường: dòng log mang tên lỗi và mã cố định, không mang giá trị", () => {
  async function voiTienTrinh(viec: (log: readonly string[]) => Promise<void>): Promise<void> {
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    const tt = taoTienTrinhApi(docCauHinh(moiTruong()));
    try {
      const dc = await tt.batDau();
      goc = `http://${dc.host}:${dc.port}`;
      await viec(log);
    } finally {
      await tt.dung();
      console.error = cu;
    }
  }

  async function doiDongLog(log: readonly string[], mau: RegExp, hanMs = 5000): Promise<string> {
    const het = Date.now() + hanMs;
    for (;;) {
      const dong = log.find((d) => mau.test(d));
      if (dong !== undefined) return dong;
      if (Date.now() > het) throw new Error(`het ${hanMs}ms, khong co dong log khop ${String(mau)}: ${JSON.stringify(log)}`);
      await new Promise((x) => setTimeout(x, 25));
    }
  }

  it("⑴ kết nối bị huỷ vì SESSION_STATE_LEFT sau một giao dịch đã commit ⇒ bộ nghe release mà composition gắn vào pool ghi MỘT dòng `ket noi huy` cho MỖI kết nối — hai giao dịch bộ đếm của /auth/link, hai dòng — không mang giá trị; phản hồi không đổi", async () => {
    await db.pool.query(
      "CREATE FUNCTION public.k118_de_lai_guc() RETURNS trigger LANGUAGE plpgsql AS " +
        "$$BEGIN PERFORM pg_catalog.set_config('app.guest_rfq_id', '00000000-0000-4000-8000-000000000118', false); RETURN NULL; END$$",
    );
    await db.pool.query(
      "CREATE TRIGGER k118_de_lai_guc AFTER INSERT OR UPDATE ON public.caller_rate_limits FOR EACH ROW EXECUTE FUNCTION public.k118_de_lai_guc()",
    );
    try {
      await voiTienTrinh(async (log) => {
        const r = await goi("POST", "/auth/link", { body: { orgId: org, email: "k118-a@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.18" } });
        expect(r.status, r.text).toBe(200);
        // Hai giao dịch của bộ điều phối ghi `caller_rate_limits` cho `/auth/link` (`callerLimit` và `orgLimit`, routes/auth.ts): mỗi giao
        // dịch một kết nối bị huỷ, mỗi kết nối MỘT dòng — gắn bộ nghe hai lần thì bốn dòng (lượt soi 61a-3).
        const huy = log.filter((d) => d.includes("ket noi huy"));
        expect(huy, JSON.stringify(log)).toEqual([
          "[api] ket noi huy pool TenantError SESSION_STATE_LEFT",
          "[api] ket noi huy pool TenantError SESSION_STATE_LEFT",
        ]);
        expect(log.join("\n")).not.toContain("000000000118");
      });
    } finally {
      await db.pool.query("DROP TRIGGER k118_de_lai_guc ON public.caller_rate_limits");
      await db.pool.query("DROP FUNCTION public.k118_de_lai_guc()");
    }
  });

  it("⑵ handler của job outbox hỏng vì lỗi Postgres ⇒ dòng `outbox` mang kind, lý do, TÊN và SQLSTATE của lỗi gốc — không mang email (trước khoản 118: chỉ kind và lý do)", async () => {
    await db.pool.query(
      "CREATE FUNCTION public.k118_chan_xong() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'k118' USING ERRCODE = 'TP118'; END$$",
    );
    await db.pool.query(
      "CREATE TRIGGER k118_chan_xong BEFORE UPDATE ON public.outbox_jobs FOR EACH ROW WHEN (NEW.status = 'DONE') EXECUTE FUNCTION public.k118_chan_xong()",
    );
    try {
      await voiTienTrinh(async (log) => {
        const r = await goi("POST", "/auth/link", { body: { orgId: org, email: "k118-b@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.19" } });
        expect(r.status, r.text).toBe(200);
        expect(await doiDongLog(log, /^\[api\] outbox /u)).toBe("[api] outbox LOGIN_LINK_SEND HANDLER_ERROR error TP118");
        expect(log.join("\n")).not.toContain("k118-b@vidu.vn");
      });
    } finally {
      await db.pool.query("DROP TRIGGER k118_chan_xong ON public.outbox_jobs");
      await db.pool.query("DROP FUNCTION public.k118_chan_xong()");
    }
  });

  it("⑶ lượt chạy của runner cho một tổ chức ném ⇒ dòng `outbox` của lời đánh thức mang TÊN và SQLSTATE (trước khoản 118: chỉ tên lỗi)", async () => {
    await db.pool.query(
      "CREATE FUNCTION public.k118_chan_nhan() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'k118' USING ERRCODE = 'TP118'; END$$",
    );
    await db.pool.query(
      "CREATE TRIGGER k118_chan_nhan BEFORE UPDATE ON public.outbox_jobs FOR EACH ROW WHEN (NEW.status = 'RUNNING') EXECUTE FUNCTION public.k118_chan_nhan()",
    );
    try {
      await voiTienTrinh(async (log) => {
        const r = await goi("POST", "/auth/link", { body: { orgId: org, email: "k118-c@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.20" } });
        expect(r.status, r.text).toBe(200);
        expect(await doiDongLog(log, /^\[api\] outbox (?!poll )/u)).toBe("[api] outbox error TP118");
      });
    } finally {
      await db.pool.query("DROP TRIGGER k118_chan_nhan ON public.outbox_jobs");
      await db.pool.query("DROP FUNCTION public.k118_chan_nhan()");
    }
  });

  it("⑷ [lượt soi 61a-3] lần ghi sổ từ chối quyền qua auditPool để lại GUC phạm vi phiên ⇒ bộ nghe release mà composition gắn vào auditPool ghi MỘT dòng `ket noi huy auditPool`, không mang giá trị; phản hồi vẫn 403", async () => {
    const token = randomBytes(32).toString("base64url");
    await db.pool.query(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
      [org, nguoi, createHash("sha256").update(token, "utf8").digest()],
    );
    await db.pool.query(
      "CREATE FUNCTION public.k118_de_lai_guc_so() RETURNS trigger LANGUAGE plpgsql AS " +
        "$$BEGIN PERFORM pg_catalog.set_config('app.guest_rfq_id', '00000000-0000-4000-8000-000000000118', false); RETURN NULL; END$$",
    );
    await db.pool.query(
      "CREATE TRIGGER k118_de_lai_guc_so AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.k118_de_lai_guc_so()",
    );
    try {
      await voiTienTrinh(async (log) => {
        // BUYER không có supplier.manage: `requirePermission` từ chối và ghi PERMISSION_DENIED qua auditPool (D5).
        const r = await goi("POST", "/suppliers", { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}`, body: { legalName: "NCC k118" } });
        expect(r.status, r.text).toBe(403);
        expect(log.filter((d) => d.includes("ket noi huy")), JSON.stringify(log)).toEqual([
          "[api] ket noi huy auditPool TenantError SESSION_STATE_LEFT",
        ]);
        expect(log.join("\n")).not.toContain("000000000118");
      });
    } finally {
      await db.pool.query("DROP TRIGGER k118_de_lai_guc_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION public.k118_de_lai_guc_so()");
    }
  });
});

// ----------------------------------------------------------------------------------------------
// [S1.69 / khoản 120] CỠ `auditPool` CỦA COMPOSITION ROOT — đo trên `taoTienTrinhApi` thật.
//
// Mỗi lần ghi sổ từ chối của tiến trình chạy khi yêu cầu ĐANG GIỮ một kết nối của pool nghiệp vụ: `requirePermission` của bộ điều phối
// và mọi handler nhận `auditPool` đều nằm trong `withTenant(deps.pool, …)` (`dispatch.ts`). Nên số lần ghi sổ từ chối đồng thời của một
// tiến trình không vượt `TRUSTPROCURE_DB_POOL_MAX`, và một `auditPool` cùng cỡ không là chỗ hẹp hơn cho nhu cầu ấy. Trước bản vá `auditPool` có 2
// kết nối dùng chung mọi tổ chức; đo trên b8d38c7 ở mức gói (biên bản §S1.69): khoá tư vấn ghi sổ của một tổ chức ghim cả hai kết nối, lần
// từ chối của tổ chức KHÁC gãy sau 15 ms, không hàng sổ. Ở đây `TRUSTPROCURE_DB_POOL_MAX` là 3: khoá của tổ chức X ghim hai lần ghi, lần
// từ chối ở tổ chức A đi trên kết nối nghiệp vụ thứ ba và phải có kết nối `auditPool` ngay — trước khi X nhả khoá.
//
// [lượt soi 63a-5] Test ghim CẬN DƯỚI — `auditPool` không nhỏ hơn 3 khi `TRUSTPROCURE_DB_POOL_MAX` là 3: `dbPoolMax + 2` hay
// `Math.max(dbPoolMax, 10)` cũng xanh. Cận trên không đo được bằng hành vi của tiến trình, vì nhu cầu của nó không vượt `dbPoolMax`.
// ----------------------------------------------------------------------------------------------
describe("[INV-D5] [S1.69 / khoản 120] tiến trình dựng từ môi trường: auditPool KHÔNG nhỏ hơn TRUSTPROCURE_DB_POOL_MAX", () => {
  it("[INV-D5] khoá tư vấn ghi sổ của tổ chức X ghim hai lần ghi sổ từ chối ⇒ lần từ chối ở tổ chức A vẫn ghi được ngay: 403 khi X còn giữ khoá, rồi đủ ba hàng sổ", async () => {
    const orgX = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty X k120', 'cong-ty-x-k120') RETURNING id")).rows[0]!
      .id;
    const phien = async (toChuc: string, email: string): Promise<string> => {
      const id = (
        await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'K120', 'ACTIVE') RETURNING id", [
          toChuc,
          email,
        ])
      ).rows[0]!.id;
      await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [toChuc, id]);
      const token = randomBytes(32).toString("base64url");
      await db.pool.query(
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
        [toChuc, id, createHash("sha256").update(token, "utf8").digest()],
      );
      return `${COOKIE_PHIEN_NGUOI_MUA}=${toChuc}.${token}`;
    };
    const cookieX1 = await phien(orgX, "x1-k120@vidu.vn");
    const cookieX2 = await phien(orgX, "x2-k120@vidu.vn");
    const cookieA = await phien(org, "a-k120@vidu.vn");
    const demTuChoi = async (toChuc: string): Promise<number> =>
      Number(
        rows0((await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED'", [toChuc])).rows),
      );
    const truocX = await demTuChoi(orgX);
    const truocA = await demTuChoi(org);

    const tt = taoTienTrinhApi(docCauHinh(moiTruong({ TRUSTPROCURE_DB_POOL_MAX: "3" })));
    const giuKhoa = await db.pool.connect();
    let dangGiuKhoa = false;
    let haiX: Promise<PhanHoi>[] = [];
    try {
      const dc = await tt.batDau();
      goc = `http://${dc.host}:${dc.port}`;
      await giuKhoa.query("BEGIN");
      // Cùng khoá mà mỗi lần ghi sổ của tổ chức lấy (ĐO-5a ở docstring của `CAU_KHOA_TU_VAN`, packages/identity/src/rbac.ts).
      await giuKhoa.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgX]);
      dangGiuKhoa = true;
      // BUYER không có supplier.manage: mỗi yêu cầu là một lần ghi PERMISSION_DENIED qua auditPool (D5), và lần ghi của X chờ khoá.
      haiX = [cookieX1, cookieX2].map((cookie) => goi("POST", "/suppliers", { cookie, body: { legalName: "NCC k120 X" } }));
      const han = Date.now() + 10000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND NOT granted " +
            "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
            "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
          [orgX],
        );
        if (rows0(rows) === "2") break;
        if (Date.now() > han) throw new Error(`het 10000ms, so lan ghi so cua X dang cho khoa: ${rows0(rows)}`);
        await new Promise((xong) => setTimeout(xong, 20));
      }
      const batDau = Date.now();
      const rA = await goi("POST", "/suppliers", { cookie: cookieA, body: { legalName: "NCC k120 A" } });
      const daCho = Date.now() - batDau;
      expect(rA.status, rA.text).toBe(403);
      // [S1.71 / khoản 123, lượt soi 65a-4, 65c-6] Hai lần ghi sổ của X đang chờ khoá gãy 55P03 sau 2 s (050), và lần từ chối ở A chạy
      // trong lúc ấy. Lần chờ của X = độ trễ tới lúc dò thấy đủ hai + thời gian của A + COMMIT: cận của A để phần lớn 2 s cho hai phần kia
      // nhưng không chặn trọn lần chờ ấy — một máy rất chậm vẫn có thể biến [403, 403] của X thành 500.
      expect(daCho, "lần từ chối ở A không được chờ X nhả khoá").toBeLessThan(1000);
      await giuKhoa.query("COMMIT");
      dangGiuKhoa = false;
      expect((await Promise.all(haiX)).map((r) => r.status)).toEqual([403, 403]);
      expect(await demTuChoi(orgX)).toBe(truocX + 2);
      expect(await demTuChoi(org)).toBe(truocA + 1);
    } finally {
      if (dangGiuKhoa) await giuKhoa.query("ROLLBACK").catch(() => {});
      await Promise.allSettled(haiX);
      giuKhoa.release();
      await tt.dung();
    }
  }, 60000);
});

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
