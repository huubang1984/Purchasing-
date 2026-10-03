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
import { KIND_KHONG_NGUOI_NHAN } from "@trustprocure/outbox";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docCauHinh, type MoiTruong } from "./cau-hinh.js";
import { taoTienTrinhApi, type TienTrinhApi } from "./composition.js";
// [S1.233 / khoản 158] Bảng handler THẬT của tiến trình này, để vế cuối tệp đối chiếu với tập `kind` của policy 095.
import { buildApiOutboxHandlers } from "./outbox-api.js";
import { dichVuTest } from "./test-services.js";
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
  // [khoản 196 / ADR-074 phần 1] ĐỒNG HỒ CSDL LỆCH ĐỒNG HỒ TIẾN TRÌNH.
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
    // [ADR-107] Fragment là `<orgId>:<token>` — đúng dạng trang `/login` đọc, và tổ chức là tổ chức của tin.
    const [orgTrongLink, token = ""] = link.hash.slice(1).split(":");
    expect(orgTrongLink).toBe(org);
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
    const [, token = ""] = new URL(t.duongLink).hash.slice(1).split(":");
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

describe("[S1.169 / ADR-105] cờ ký chính sách đi từ MÔI TRƯỜNG tới route — đúng đường `main.ts` dựng", () => {
  it("không khai `TRUSTPROCURE_S3_CHO_KY_CHINH_SACH` ⇒ `choKy: false`, route ký 409 trước mọi câu ghi; `bat` ⇒ `choKy: true`, route ký đi tới trigger", async () => {
    // Phiên chèn thẳng: thứ cần đo là cờ chảy qua `docCauHinh` → `taoTienTrinhApi` → bộ điều phối — đăng nhập đo ở khối trên.
    const id = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, 'tc-co@vidu.vn', 'Tai chinh', 'ACTIVE') RETURNING id",
        [org],
      )
    ).rows[0]!.id;
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'FINANCE')", [org, id]);
    const token = randomBytes(32).toString("base64url");
    await db.pool.query(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
      [org, id, createHash("sha256").update(token, "utf8").digest()],
    );
    const cookie = `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}`;
    const KHONG_CO = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    for (const [ghiDe, mong] of [
      [{}, { choKy: false, ky: 409 }],
      // Cửa mở thì lời gọi tới trigger: phiên bản không tồn tại ⇒ `foreign_key_violation` ⇒ 422 — không một hàng nào đổi.
      [{ TRUSTPROCURE_S3_CHO_KY_CHINH_SACH: "bat" }, { choKy: true, ky: 422 }],
    ] as const) {
      const tt = taoTienTrinhApi(docCauHinh(moiTruong(ghiDe)));
      try {
        const dc = await tt.batDau();
        const ds = await fetch(`http://${dc.host}:${dc.port}/policy/versions`, { headers: { cookie } });
        expect(ds.status).toBe(200);
        expect(((await ds.json()) as { choKy: boolean }).choKy).toBe(mong.choKy);
        const ky = await fetch(`http://${dc.host}:${dc.port}/policy/${KHONG_CO}/sign`, { method: "POST", headers: { cookie } });
        expect(ky.status, await ky.text()).toBe(mong.ky);
      } finally {
        await tt.dung();
      }
    }
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM org_policy_signatures WHERE org_id = $1", [org]);
    expect(rows0(rows)).toBe("0");
  });
});

// ==============================================================================================
// [S1.222 / khoản 168] TIẾN TRÌNH `api` KHÔNG KHAI SỔ `kind` MỒ CÔI — ĐO TRÊN `taoTienTrinhApi` THẬT.
//
// Nửa thứ hai của khoản 168: sổ mồ côi (`KIND_KHONG_NGUOI_NHAN`) từ vòng này do worker mở thầu khai
// (`apps/unseal-worker/src/tien-trinh.ts`, đo ở `tien-trinh.int.test.ts` vế ⑹), và ĐÚNG MỘT tiến trình
// được khai — hai tiến trình cùng khai thì cả hai tranh nhau ghi kết cục và `attempts` của job mồ côi
// thôi đọc được (`packages/outbox/src/runner.ts`). Vế này ghim nửa *"api KHÔNG khai"* trên dây nối
// thật: bỏ `kindKhongNguoiNhan` khỏi `composition.ts` là một dòng XOÁ, và không phép đo nào khác đỏ
// nếu ai đó thêm nó lại — vế này đỏ (đột biến §S1.222 M5: thêm lại dòng ấy ⇒ job mồ côi FAILED).
//
// Cảnh: sổ thật hôm nay RỖNG (S1.91), nên vế này cho nó mượn MỘT dòng thử trước khi dựng tiến trình
// (cùng cách với vế ⑹ của worker; gỡ trong `finally`; tệp này có bản sổ riêng theo cô lập module của
// vitest, nên cổng vế ⑶ ở `apps/unseal-worker/src/composition.int.test.ts` không thấy dòng này). Tổ
// chức phải là tổ chức tiến trình này ĐÃ THẤY xếp việc — không thì `listOrganizations` (`toChucDaThay`)
// không có nó và vế xanh mà không đo gì — nên một lời `/auth/link` đi trước. Đối chứng dương: một lời
// `/auth/link` THỨ HAI, xếp việc SAU khi job mồ côi đã nằm đó, phải ra tin — tức runner đã chạy trọn
// một lượt claim (lô 10 job) cho tổ chức ấy sau khi job mồ côi tồn tại — mà job mồ côi vẫn `PENDING`,
// `attempts` 0, và không dòng log `outbox` nào của tiến trình mang `kind` ấy.
// ==============================================================================================
// ===============================================================================================
// [S1.233 / khoản 158] TẬP `kind` MÀ CSDL CHO `app_api` GHI KẾT CỤC PHẢI BẰNG BẢNG HANDLER CỦA TIẾN TRÌNH NÀY
//
// Migration `095_outbox_policy_theo_kind` (ADR-134): policy `outbox_jobs_kind_app_api` (`AS RESTRICTIVE FOR UPDATE TO app_api`)
// mang NGUYÊN VĂN tập `kind` của `buildApiOutboxHandlers`. Thêm một handler mà quên migration thì job của kind ấy không claim
// được — nằm `PENDING` im lặng — và vế này đỏ TRƯỚC khi tới đó, ở đúng tệp của tiến trình thêm handler. Bản đối chiếu cả hai
// vai (và sổ mồ côi của worker) ở `apps/unseal-worker/src/composition.int.test.ts`; hành vi ở `packages/outbox/src/outbox.int.test.ts`.
// ===============================================================================================
async function docTapKindCuaPolicyApi(): Promise<readonly string[]> {
  const { rows } = await db.pool.query<{ vai: string; permissive: boolean; lenh: string; u: string | null; wc: string | null }>(
    "SELECT array_to_string(ARRAY(SELECT r.rolname FROM unnest(p.polroles) AS o(oid) JOIN pg_roles r ON r.oid = o.oid ORDER BY r.rolname), ',') AS vai, " +
      "       p.polpermissive AS permissive, p.polcmd::text AS lenh, " +
      "       pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS wc " +
      "  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
      " WHERE n.nspname = 'public' AND c.relname = 'outbox_jobs' AND p.polname = 'outbox_jobs_kind_app_api'",
  );
  const p = rows[0];
  expect(p, "CSDL không có policy outbox_jobs_kind_app_api — migration 095 chưa áp, hay policy đã bị đổi tên/xoá").toBeDefined();
  expect({ vai: p!.vai, permissive: p!.permissive, lenh: p!.lenh }, "phải là RESTRICTIVE FOR UPDATE, đúng một vai app_api").toEqual({
    vai: "app_api",
    permissive: false,
    lenh: "w",
  });
  expect(p!.wc, "WITH CHECK phải bằng USING — hai vế khai cùng một tập").toBe(p!.u);
  expect(p!.u ?? "", "USING không đúng hình dạng `(kind = ANY (ARRAY['…'::text, …]))`").toMatch(
    /^\(kind = ANY \(ARRAY\[(?:'[A-Z][A-Z0-9_]{0,63}'::text(?:, )?)+\]\)\)$/u,
  );
  return [...(p!.u ?? "").matchAll(/'([A-Z][A-Z0-9_]{0,63})'::text/gu)].map((m) => m[1]!);
}

/**
 * [S1.233 / khoản 158] Policy 095 ràng tập `kind` của mỗi vai ở CSDL. Vế khoản 168 dưới đây mượn MỘT dòng thử ở sổ mồ côi để
 * đo rằng runner của `api` KHÔNG nhặt nó; từ 095 lớp CSDL cũng chặn kind thử ấy, nên nếu không nới policy thì vế ấy xanh CẢ KHI
 * `api` khai lại sổ (đột biến M5 của §S1.222 chết). Nới policy của vai cho ĐÚNG kind thử, dưới siêu người dùng — thứ còn quyết
 * định là mảng lọc của runner — và khôi phục NGUYÊN VĂN trong `finally`. Cụm của tệp này là cụm riêng; cổng khai của hardening
 * chỉ chạy ở `migrate()`, đã xong ở `beforeAll`.
 */
async function noiPolicyKindTam(polname: "outbox_jobs_kind_app_api" | "outbox_jobs_kind_app_unseal", kind: string): Promise<() => Promise<void>> {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(kind)) throw new Error("kind thử phải khớp CHECK của outbox_jobs.kind");
  const { rows } = await db.pool.query<{ u: string; wc: string }>(
    "SELECT pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS wc " +
      "  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = 'outbox_jobs' AND p.polname = $1",
    [polname],
  );
  const goc = rows[0];
  if (goc === undefined) throw new Error(`không thấy policy ${polname} — migration 095 chưa áp?`);
  const noi = `(${goc.u}) OR (kind = '${kind}')`;
  await db.pool.query(`ALTER POLICY ${polname} ON public.outbox_jobs USING (${noi}) WITH CHECK (${noi})`);
  return async () => {
    await db.pool.query(`ALTER POLICY ${polname} ON public.outbox_jobs USING (${goc.u}) WITH CHECK (${goc.wc})`);
  };
}

describe("[INV-F1] [S1.233 / khoản 158] tập `kind` trong policy `outbox_jobs_kind_app_api` BẰNG bảng handler của tiến trình `api`", () => {
  it("Object.keys(buildApiOutboxHandlers) = tập kind của policy — thêm một handler mà quên migration thì đỏ ở đây, trước khi job của nó nằm PENDING im lặng", async () => {
    const handler = Object.keys(buildApiOutboxHandlers(dichVuTest().services));
    expect(handler.length, "bảng handler của api rỗng — phép đối chiếu vô nghĩa").toBeGreaterThan(0);
    expect(
      [...(await docTapKindCuaPolicyApi())].sort(),
      "Tập `kind` trong policy của CSDL KHÁC bảng handler của api. Thêm kind = thêm migration (ADR-134): `ALTER POLICY " +
        "outbox_jobs_kind_app_api ON public.outbox_jobs USING (…) WITH CHECK (…)` trong một migration MỚI, cộng sửa dòng ở " +
        "POLICY_RESTRICTIVE_KHAI (hardening.always.sql) và POLICY_RESTRICTIVE_DA_KHAI (db/rls-coverage.int.test.ts).",
    ).toEqual([...handler].sort());
  });
});

describe("[S1.222 / khoản 168] tiến trình `api` dựng từ môi trường KHÔNG khai sổ `kind` mồ côi", () => {
  it("job mang `kind` trong sổ mồ côi của tổ chức tiến trình này ĐÃ THẤY xếp việc vẫn PENDING, attempts 0, sau khi runner chạy trọn một lượt cho tổ chức ấy (job LOGIN_LINK_SEND xếp SAU nó đã ra tin); không dòng log nào mang `kind` ấy — sổ nay là việc của worker", async () => {
    const KIND_MO_COI = "THU_MO_COI_168_API";
    Object.assign(KIND_KHONG_NGUOI_NHAN, { [KIND_MO_COI]: "dòng THỬ của vế khoản 168 — không phải một khai thật, gỡ trong finally" });
    // [S1.233 / khoản 158] Policy 095 cũng chặn kind thử này dưới app_api; nới cho đúng nó để thứ được đo vẫn là mảng lọc của
    // runner (xem `noiPolicyKindTam`). Khôi phục trong `finally`.
    const khoiPhucPolicy = await noiPolicyKindTam("outbox_jobs_kind_app_api", KIND_MO_COI);
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    // Tổ chức và người dùng RIÊNG cho vế này: không job sót của các vế trước, và `toChucDaThay` của tiến trình dựng dưới đây
    // chỉ có nó. Email phải là của một người dùng ACTIVE — handler `LOGIN_LINK_SEND` không gửi gì cho email lạ (chống dò tài
    // khoản, `outbox-api.ts`), mà tin trong hộp thư là đối chứng dương của vế này.
    const orgK = (
      await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty K168', 'cong-ty-k168') RETURNING id")
    ).rows[0]!.id;
    await db.pool.query("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, 'k168@vidu.vn', 'Nguoi mua K168', 'ACTIVE')", [orgK]);
    const tt = taoTienTrinhApi(docCauHinh(moiTruong()));
    try {
      const dc = await tt.batDau();
      goc = `http://${dc.host}:${dc.port}`;
      const truoc = docHopThu().length;
      // ⑴ Tổ chức vào `toChucDaThay` của tiến trình này bằng đúng đường sản xuất: một lời xếp việc qua `api`.
      const r1 = await goi("POST", "/auth/link", { body: { orgId: orgK, email: "k168@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.68" } });
      expect(r1.status, r1.text).toBe(200);
      await doiHopThu(truoc + 1);
      // ⑵ Job mồ côi của CÙNG tổ chức ấy — chèn thẳng, vì không đường sản xuất nào xếp một `kind` không người nhận.
      const { rows: gieo } = await db.pool.query<{ id: string }>(
        "INSERT INTO outbox_jobs (org_id, kind) VALUES ($1::uuid, $2) RETURNING id",
        [orgK, KIND_MO_COI],
      );
      const idMoCoi = gieo[0]!.id;
      // ⑶ Đối chứng dương: runner chạy trọn một lượt claim cho tổ chức ấy SAU khi job mồ côi đã nằm đó.
      const r2 = await goi("POST", "/auth/link", { body: { orgId: orgK, email: "k168@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.69" } });
      expect(r2.status, r2.text).toBe(200);
      await doiHopThu(truoc + 2);
      // ⑷ Job mồ côi không bị chạm — mảng lọc của runner này là đúng `Object.keys(handlers)`.
      const { rows: job } = await db.pool.query<{ status: string; attempts: number; last_failure_reason: string | null }>(
        "SELECT status, attempts, last_failure_reason FROM outbox_jobs WHERE id = $1",
        [idMoCoi],
      );
      expect(job[0], "api KHÔNG được claim job mồ côi — sổ nay do worker khai, và ĐÚNG MỘT tiến trình khai").toEqual({
        status: "PENDING",
        attempts: 0,
        last_failure_reason: null,
      });
      expect(log.filter((d) => d.includes(KIND_MO_COI)), JSON.stringify(log)).toEqual([]);
      expect(log.join("\n")).not.toContain(orgK);
    } finally {
      await tt.dung();
      console.error = cu;
      Reflect.deleteProperty(KIND_KHONG_NGUOI_NHAN, KIND_MO_COI);
      await khoiPhucPolicy();
    }
  });
});

// ==============================================================================================
// [S1.248 / khoản 277] TIẾN TRÌNH `api` KHỞI ĐỘNG LẠI TỰ NHẶT VIỆC `PENDING` CỦA CHÍNH NÓ — đo trên `taoTienTrinhApi` thật.
//
// Trước vòng này `listOrganizations` của runner là `() => [...toChucDaThay]`: tập tổ chức mà CHÍNH tiến trình đã thấy xếp việc, rỗng
// lại sau mỗi lần khởi động (dấu ADR-047). Job `PENDING` của `api` — link đăng nhập, tin báo người duyệt, tin gia hạn — mà tiến trình
// trước chưa kịp chạy, hay mà một instance KHÁC đã xếp rồi chết trước lời đánh thức (ADR-022), chờ tới yêu cầu GHI CÓ XẾP VIỆC kế
// tiếp của chính tổ chức ấy; vòng poll 5 s không giúp vì danh sách rỗng. Ba cảnh, một cụm, hai tiến trình dựng từ cấu hình:
//   ① tiến trình thứ nhất xếp việc qua `/auth/link` — đường sản xuất; lượt claim của lời đánh thức bị một trigger tạm chặn (lỗi
//      TP277), tức cảnh "đã xếp, chưa kịp chạy"; rồi `dung()`. Job `PENDING`, attempts 0;
//   ② tiến trình MỚI, KHÔNG lời `/auth/link` nào (hộp thư chỉ có đúng tin của job ấy, và tổ chức vẫn đúng MỘT job) ⇒ job `DONE`
//      trong N giây — trước khoản 277: không bao giờ;
//   ③ khi ② đang chạy, một job `PENDING` của tổ chức KHÁC chèn thẳng, không lời đánh thức nào — cảnh instance khác chết ngay sau
//      commit ⇒ một kỳ poll sau đó nhặt nó (vế "mỗi kỳ", không chỉ "lúc lên").
// Kỳ vọng mềm (`expect.soft`) cho ② và ③ để lần đỏ nói cả hai cảnh, không dừng ở cảnh đầu.
// ==============================================================================================
describe("[S1.248 / khoản 277] tiến trình `api` khởi động lại tự nhặt job PENDING của chính nó — không cần lời xếp việc nào", () => {
  /** Chờ tới khi `log` có một dòng khớp `mau` — trần `hanMs`. */
  async function doiDong(log: readonly string[], mau: RegExp, hanMs = 5000): Promise<string> {
    const het = Date.now() + hanMs;
    for (;;) {
      const dong = log.find((d) => mau.test(d));
      if (dong !== undefined) return dong;
      if (Date.now() > het) throw new Error(`het ${hanMs}ms, khong co dong log khop ${String(mau)}: ${JSON.stringify(log)}`);
      await new Promise((x) => setTimeout(x, 25));
    }
  }

  /** Số mili-giây tới khi job `DONE`, hay `null` nếu quá `hanMs` — đọc thẳng CSDL bằng siêu người dùng. */
  async function doiXong(id: string, hanMs: number): Promise<number | null> {
    const batDau = Date.now();
    for (;;) {
      const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM outbox_jobs WHERE id = $1", [id]);
      if (rows[0]?.status === "DONE") return Date.now() - batDau;
      if (Date.now() - batDau > hanMs) return null;
      await new Promise((x) => setTimeout(x, 50));
    }
  }

  async function taoToChuc(ten: string, slug: string, email: string): Promise<string> {
    const id = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [ten, slug])).rows[0]!.id;
    // Người dùng ACTIVE: handler `LOGIN_LINK_SEND` không gửi gì cho email lạ (chống dò tài khoản), mà tin trong hộp thư là đối chứng dương.
    await db.pool.query("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi mua K277', 'ACTIVE')", [id, email]);
    return id;
  }

  const tinLinkDen = (email: string): TinHopThuDev[] => docHopThu().filter((t) => t.loai === "LOGIN_LINK" && t.den === email);

  /**
   * [S1.264 / khoản 339] Số tin tới `email`, chờ tới khi đủ `n` — trần `hanMs`. `DONE` KHÔNG kéo theo "tin đã có": handler
   * `LOGIN_LINK_SEND` trả về hàm gửi, và runner gọi nó SAU khi token và dấu `DONE` đã commit, ngoài giao dịch (ADR-023, sổ nợ 53).
   * Đếm hộp thư ngay khi `doiXong` thấy `DONE` là đua với chính khe ấy: CI của #237 đỏ đúng một lần ở ③ (`expected +0 to be 1`);
   * tiêm 300 ms trước câu ghi tệp của hộp thư dev tái lập nó mỗi lần.
   */
  async function doiTinLinkDen(email: string, n: number, hanMs = 5000): Promise<number> {
    const het = Date.now() + hanMs;
    for (;;) {
      const so = tinLinkDen(email).length;
      if (so >= n || Date.now() > het) return so;
      await new Promise((x) => setTimeout(x, 50));
    }
  }

  /** Hạn chờ của ② và ③: BA kỳ poll 5 s — đủ để vế "không bao giờ" không lẫn với "chậm". */
  const HAN_MS = 15_000;

  it("① job xếp qua /auth/link mà lượt claim bị chặn nằm PENDING qua dung(); ② tiến trình MỚI, KHÔNG lời /auth/link nào ⇒ job DONE và tin vào hộp thư trong N giây, ngay kỳ poll lúc lên; ③ job PENDING chèn thẳng cho tổ chức khác, không lời đánh thức ⇒ một kỳ poll sau nhặt nó", async () => {
    const orgR = await taoToChuc("Cong ty K277", "cong-ty-k277", "k277@vidu.vn");
    const orgS = await taoToChuc("Cong ty K277 S", "cong-ty-k277-s", "k277-s@vidu.vn");
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    let tt1: TienTrinhApi | undefined;
    let tt2: TienTrinhApi | undefined;
    let nHai: number | null = null;
    let nBa: number | null = null;
    let nBon: number | null = null;
    try {
      // ① Lượt claim của tiến trình thứ nhất bị chặn — trigger tạm của siêu người dùng, gỡ ngay sau khi tiến trình dừng.
      await db.pool.query(
        "CREATE FUNCTION public.k277_chan_nhan() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'k277' USING ERRCODE = 'TP277'; END$$",
      );
      await db.pool.query(
        "CREATE TRIGGER k277_chan_nhan BEFORE UPDATE ON public.outbox_jobs FOR EACH ROW WHEN (NEW.status = 'RUNNING') EXECUTE FUNCTION public.k277_chan_nhan()",
      );
      try {
        tt1 = taoTienTrinhApi(docCauHinh(moiTruong()));
        const dc1 = await tt1.batDau();
        goc = `http://${dc1.host}:${dc1.port}`;
        const r = await goi("POST", "/auth/link", { body: { orgId: orgR, email: "k277@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.77" } });
        expect(r.status, r.text).toBe(200);
        // Lời đánh thức đã chạy và gãy ở claim — job được xếp, không được chạy.
        expect(await doiDong(log, /^\[api\] outbox (?!poll )/u)).toBe("[api] outbox error TP277");
        await tt1.dung();
        tt1 = undefined;
      } finally {
        await db.pool.query("DROP TRIGGER IF EXISTS k277_chan_nhan ON public.outbox_jobs");
        await db.pool.query("DROP FUNCTION IF EXISTS public.k277_chan_nhan()");
      }
      const { rows: jobR } = await db.pool.query<{ id: string; kind: string; status: string; attempts: number }>(
        "SELECT id, kind, status, attempts FROM outbox_jobs WHERE org_id = $1",
        [orgR],
      );
      expect(jobR.map(({ kind, status, attempts }) => ({ kind, status, attempts })), "① để lại đúng MỘT job PENDING chưa thử lần nào").toEqual([
        { kind: "LOGIN_LINK_SEND", status: "PENDING", attempts: 0 },
      ]);
      expect(tinLinkDen("k277@vidu.vn"), "① chưa gửi gì").toEqual([]);

      // ② Tiến trình MỚI — không một yêu cầu HTTP nào tới nó.
      tt2 = taoTienTrinhApi(docCauHinh(moiTruong()));
      const dc2 = await tt2.batDau();
      nHai = await doiXong(jobR[0]!.id, HAN_MS);
      expect
        .soft(nHai, `② job PENDING của tổ chức mà tiến trình mới CHƯA thấy xếp việc phải xong trong ${HAN_MS} ms — không lời /auth/link nào`)
        .not.toBeNull();
      expect.soft(nHai ?? Number.POSITIVE_INFINITY, "② xong ngay kỳ poll LÚC LÊN — trước kỳ thứ hai (5 s)").toBeLessThan(5000);

      // ③ Job PENDING chèn thẳng cho tổ chức khác — không lời đánh thức nào.
      const { rows: gieo } = await db.pool.query<{ id: string }>(
        "INSERT INTO outbox_jobs (org_id, kind, payload) VALUES ($1, 'LOGIN_LINK_SEND', $2::jsonb) RETURNING id",
        [orgS, JSON.stringify({ email: "k277-s@vidu.vn" })],
      );
      nBa = await doiXong(gieo[0]!.id, HAN_MS);
      expect.soft(nBa, `③ job PENDING chèn thẳng phải được một kỳ poll nhặt trong ${HAN_MS} ms`).not.toBeNull();

      // Không lời xếp việc nào ở ②, ③: mỗi tổ chức đúng MỘT job, và mỗi địa chỉ đúng MỘT tin — của chính job ấy.
      const { rows: dem } = await db.pool.query<{ org_id: string; n: number }>(
        "SELECT org_id, count(*)::int AS n FROM outbox_jobs WHERE org_id = ANY ($1::uuid[]) GROUP BY org_id ORDER BY org_id",
        [[orgR, orgS]],
      );
      expect(dem.map((d) => d.n), "không lời /auth/link nào ở ② và ③ — mỗi tổ chức vẫn đúng một job").toEqual([1, 1]);
      // [S1.264 / khoản 339] Chờ tin — gửi là việc SAU commit, xem `doiTinLinkDen`. Chờ cả ② để mốc `tinTruoc` của ④ đứng yên.
      expect.soft(await doiTinLinkDen("k277@vidu.vn", 1), "② tin của job khôi phục vào hộp thư").toBe(1);
      expect.soft(await doiTinLinkDen("k277-s@vidu.vn", 1), "③ tin của job chèn thẳng vào hộp thư").toBe(1);

      // ④ HỢP với `toChucDaThay` là chịu lực, và ranh giới của hàm hẹp nói ra bằng phép đo (khoản 307). Job `RUNNING` hết hạn thuê —
      // cảnh "tiến trình chết GIỮA handler" — là việc `CAU_CLAIM` nhặt lại, nhưng chỉ cho tổ chức CÓ trong danh sách. Tổ chức R vừa
      // xếp việc qua CHÍNH tiến trình ② (lời `/auth/link`, nên R ∈ `toChucDaThay`); tổ chức U thì chưa. Mỗi tổ chức một job `RUNNING`
      // hết hạn thuê, KHÔNG job PENDING nào ⇒ hàm hẹp không trả tổ chức nào; R vẫn được nhặt (nhờ vế hợp), U thì không.
      const orgU = await taoToChuc("Cong ty K277 U", "cong-ty-k277-u", "k277-u@vidu.vn");
      goc = `http://${dc2.host}:${dc2.port}`;
      const tinTruoc = tinLinkDen("k277@vidu.vn").length;
      const rLai = await goi("POST", "/auth/link", { body: { orgId: orgR, email: "k277@vidu.vn" }, headers: { "x-forwarded-for": "198.51.100.78" } });
      expect(rLai.status, rLai.text).toBe(200);
      // Tin của lời xếp việc này đã ra ⇒ lời đánh thức đã chạy ⇒ R ∈ `toChucDaThay` của tiến trình ②.
      for (const het = Date.now() + 5000; tinLinkDen("k277@vidu.vn").length === tinTruoc; ) {
        if (Date.now() > het) throw new Error("het 5000ms, tin cua loi /auth/link o ④ chua ra");
        await new Promise((x) => setTimeout(x, 50));
      }
      const hetThue = async (orgId: string, email: string): Promise<string> =>
        (
          await db.pool.query<{ id: string }>(
            "INSERT INTO outbox_jobs (org_id, kind, payload, status, attempts, lease_expires_at) " +
              "VALUES ($1, 'LOGIN_LINK_SEND', $2::jsonb, 'RUNNING', 1, now() - interval '1 minute') RETURNING id",
            [orgId, JSON.stringify({ email })],
          )
        ).rows[0]!.id;
      const jobHetThueR = await hetThue(orgR, "k277@vidu.vn");
      const jobHetThueU = await hetThue(orgU, "k277-u@vidu.vn");
      nBon = await doiXong(jobHetThueR, HAN_MS);
      expect(nBon, "④ job RUNNING hết hạn thuê của tổ chức ĐÃ THẤY xếp việc được kỳ poll nhặt lại — vế hợp với toChucDaThay").not.toBeNull();
      const { rows: conU } = await db.pool.query<{ status: string; attempts: number }>("SELECT status, attempts FROM outbox_jobs WHERE id = $1", [
        jobHetThueU,
      ]);
      expect(conU, "④ ranh giới (khoản 307): job RUNNING hết hạn thuê của tổ chức CHƯA thấy xếp việc nằm yên — hàm hẹp chỉ trả tổ chức có việc PENDING").toEqual([
        { status: "RUNNING", attempts: 1 },
      ]);
    } finally {
      await tt1?.dung();
      await tt2?.dung();
      console.error = cu;
      const moTa = (n: number | null): string => (n === null ? `KHÔNG xong trong ${HAN_MS} ms` : `${n} ms`);
      console.info(`[khoản 277] ② job khôi phục sau khởi động lại: ${moTa(nHai)}; ③ job chèn thẳng: ${moTa(nBa)}; ④ job RUNNING hết hạn thuê của tổ chức đã thấy: ${moTa(nBon)}`);
    }
  }, 90_000);

  it("lúc lên: nguồn tập tổ chức không gọi được — app_api mất EXECUTE trên hàm hẹp — ⇒ batDau() ném nêu tên hàm và mã lỗi, không nêu giá trị nào của cấu hình, không cổng nào nghe; GRANT lại ⇒ lên", async () => {
    await db.pool.query("REVOKE EXECUTE ON FUNCTION public.outbox_to_chuc_co_viec_api() FROM app_api");
    try {
      const tt = taoTienTrinhApi(docCauHinh(moiTruong()));
      const loi = await tt.batDau().then(
        () => null,
        (e: Error) => e,
      );
      await tt.dung();
      expect(loi, "hàm hẹp không gọi được mà tiến trình vẫn lên").not.toBeNull();
      expect(loi!.message).toContain("khong goi duoc public.outbox_to_chuc_co_viec_api()");
      expect(loi!.message).toContain("error 42501");
      expect(loi!.message, "không nêu chuỗi kết nối hay mật khẩu").not.toMatch(/mk-api|postgresql:\/\//u);
    } finally {
      await db.pool.query("GRANT EXECUTE ON FUNCTION public.outbox_to_chuc_co_viec_api() TO app_api");
    }
    const tt2 = taoTienTrinhApi(docCauHinh(moiTruong()));
    try {
      await expect(tt2.batDau(), "đối chứng: GRANT lại ⇒ lên").resolves.toMatchObject({ host: "127.0.0.1" });
    } finally {
      await tt2.dung();
    }
  });

  // ----------------------------------------------------------------------------------------------
  // ĐỐI CHỨNG của nguồn tập tổ chức — chính hàm hẹp, gọi dưới từng vai trong một giao dịch rồi ROLLBACK (không dấu vết cho vế khác):
  //   ⑴ tổ chức vào tập KHI VÀ CHỈ KHI có job `PENDING` thuộc tập `kind` của `api`: không việc, việc đã `DONE`/`FAILED`, việc
  //      `RUNNING` hết hạn thuê (khoản 307 — nói ra bằng phép đo), hay chỉ có việc `PENDING` của worker ⇒ KHÔNG vào tập;
  //   ⑴′ nghĩa ấy nằm ở THÂN hàm, không dựa vào vị từ của policy đi kèm (policy nới thành `true` ⇒ tập không đổi);
  //   ⑵ tập `kind` đưa tổ chức vào tập BẰNG bảng handler của `api` và BẰNG tập của policy `outbox_jobs_kind_app_api` (095, đọc theo
  //      TÊN — không phải "policy RESTRICTIVE đầu tiên của app_api": từ lô B2 `app_api` có thêm một policy FOR INSERT mang năm kind).
  //      Thêm một handler mà quên thân hàm thì job của nó không tự phục hồi sau khởi động lại — vế này đỏ trước khi tới đó;
  //   ⑶ bán kính: `EXECUTE` chỉ `app_api` (app_unseal, app_neo, app_khoi_tao, một vai không thành viên nào ⇒ 42501); `app_api` đọc
  //      thẳng `outbox_jobs` chưa gắn tổ chức vẫn 0 hàng; vai chủ hàm thấy ĐÚNG hàng `PENDING` và không đọc được `payload`.
  // ----------------------------------------------------------------------------------------------
  it("đối chứng: tổ chức vào tập khi và chỉ khi có job PENDING thuộc tập kind của api — không việc, việc DONE/FAILED/RUNNING, hay chỉ việc PENDING của worker thì không; tập kind ấy bằng bảng handler của api và bằng policy 095; EXECUTE chỉ app_api, vai chủ hàm thấy đúng hàng PENDING và không đọc được payload", async () => {
    const KIND_API = Object.keys(buildApiOutboxHandlers(dichVuTest().services)).sort();
    // Năm kind của union `KindOutbox` (`packages/outbox/src/enqueue.ts`): ba của api, hai của worker.
    const MOI_KIND = [...KIND_API, "BREAK_GLASS_UNSEAL_ALERT", "UNSEAL_RFQ"].sort();
    expect(MOI_KIND, "bảng handler của api phải là ba kind của nó — không trùng kind của worker").toHaveLength(5);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      const toChuc = async (slug: string): Promise<string> =>
        (await c.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [slug])).rows[0]!.id;
      const theoKind = new Map<string, string>();
      for (const kind of MOI_KIND) {
        const id = await toChuc(`k277-${kind.toLowerCase().replaceAll("_", "-")}`);
        await c.query("INSERT INTO outbox_jobs (org_id, kind) VALUES ($1, $2)", [id, kind]);
        theoKind.set(kind, id);
      }
      const khongViec = await toChuc("k277-khong-viec");
      const daXong = await toChuc("k277-da-xong");
      await c.query("INSERT INTO outbox_jobs (org_id, kind, status, finished_at) VALUES ($1, 'LOGIN_LINK_SEND', 'DONE', now())", [daXong]);
      const daHong = await toChuc("k277-da-hong");
      await c.query(
        "INSERT INTO outbox_jobs (org_id, kind, status, attempts, last_failure_reason, finished_at) VALUES ($1, 'LOGIN_LINK_SEND', 'FAILED', 5, 'HANDLER_ERROR', now())",
        [daHong],
      );
      const dangChay = await toChuc("k277-dang-chay-het-thue");
      await c.query(
        "INSERT INTO outbox_jobs (org_id, kind, status, attempts, lease_expires_at) VALUES ($1, 'LOGIN_LINK_SEND', 'RUNNING', 1, now() - interval '1 minute')",
        [dangChay],
      );
      const cuaToi = new Set([...theoKind.values(), khongViec, daXong, daHong, dangChay]);

      await c.query("SAVEPOINT truoc_vai");
      await c.query("SET LOCAL ROLE app_api");
      const tap = new Set(
        (await c.query<{ id: string }>("SELECT t.id::text AS id FROM public.outbox_to_chuc_co_viec_api() AS t(id)")).rows
          .map((r) => r.id)
          .filter((id) => cuaToi.has(id)),
      );
      // ⑶ Policy mới mang TO vai khác: app_api đọc thẳng hàng đợi khi chưa gắn tổ chức vẫn thấy 0 hàng.
      const docThang = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM public.outbox_jobs")).rows[0]!.n;
      await c.query("ROLLBACK TO SAVEPOINT truoc_vai");

      // ⑴ Đúng một hàng mỗi tổ chức của vế này có trong tập — và chỉ tổ chức có việc PENDING của api.
      const kindVaoTap = MOI_KIND.filter((k) => tap.has(theoKind.get(k)!));
      expect(
        { khongViec: tap.has(khongViec), daXong: tap.has(daXong), daHong: tap.has(daHong), dangChayHetThue: tap.has(dangChay) },
        "không việc, việc đã xong / đã hỏng, việc RUNNING hết hạn thuê (khoản 307) — không tổ chức nào vào tập",
      ).toEqual({ khongViec: false, daXong: false, daHong: false, dangChayHetThue: false });
      expect(
        { UNSEAL_RFQ: tap.has(theoKind.get("UNSEAL_RFQ")!), BREAK_GLASS_UNSEAL_ALERT: tap.has(theoKind.get("BREAK_GLASS_UNSEAL_ALERT")!) },
        "job PENDING của worker không làm tổ chức vào tập",
      ).toEqual({ UNSEAL_RFQ: false, BREAK_GLASS_UNSEAL_ALERT: false });
      // ⑵ Tập kind đưa tổ chức vào tập = bảng handler của api = tập của policy 095 (đọc theo TÊN).
      expect(kindVaoTap, "tập kind của hàm hẹp phải BẰNG bảng handler của api").toEqual(KIND_API);
      expect(kindVaoTap, "và bằng tập kind của policy outbox_jobs_kind_app_api (095)").toEqual([...(await docTapKindCuaPolicyApi())].sort());
      expect(docThang, "app_api đọc thẳng outbox_jobs chưa gắn tổ chức — policy của vai chủ hàm không nới bán kính của app_api").toBe(0);

      // ⑴′ Nghĩa của hàm không dựa vào policy đi kèm: nới policy thành USING (true) trong giao dịch này (ROLLBACK ngay) — thân hàm
      //     TỰ lọc `status`, nên tổ chức chỉ có việc đã xong / đã hỏng / đang chạy vẫn không vào tập. Không vế này thì đột biến "bỏ vế
      //     status khỏi thân" sống, vì policy còn cắt đúng lát PENDING (đo §S1.248: M10).
      await c.query("SAVEPOINT truoc_noi");
      await c.query("ALTER POLICY outbox_jobs_liet_ke_viec_api ON public.outbox_jobs USING (true)");
      await c.query("SET LOCAL ROLE app_api");
      const tapNoi = new Set(
        (await c.query<{ id: string }>("SELECT t.id::text AS id FROM public.outbox_to_chuc_co_viec_api() AS t(id)")).rows
          .map((r) => r.id)
          .filter((id) => cuaToi.has(id)),
      );
      await c.query("ROLLBACK TO SAVEPOINT truoc_noi");
      expect(
        { daXong: tapNoi.has(daXong), daHong: tapNoi.has(daHong), dangChayHetThue: tapNoi.has(dangChay), coViec: tapNoi.has(theoKind.get("LOGIN_LINK_SEND")!) },
        "policy nới mà thân hàm vẫn chỉ trả tổ chức có job PENDING",
      ).toEqual({ daXong: false, daHong: false, dangChayHetThue: false, coViec: true });

      // ⑶ EXECUTE chỉ app_api: ba vai ứng dụng còn lại và một vai không thành viên nào (PUBLIC) bị từ chối.
      await c.query("CREATE ROLE zz_k277_khong_ai NOLOGIN");
      for (const vai of ["app_unseal", "app_neo", "app_khoi_tao", "zz_k277_khong_ai"]) {
        await c.query("SAVEPOINT truoc_vai");
        await c.query(`SET LOCAL ROLE ${vai}`);
        const loi = await c.query("SELECT * FROM public.outbox_to_chuc_co_viec_api()").then(
          () => null,
          (e: { code?: string }) => e.code ?? "?",
        );
        await c.query("ROLLBACK TO SAVEPOINT truoc_vai");
        expect(loi, `${vai} gọi được hàm hẹp của api`).toBe("42501");
      }
      // ⑶ Vai chủ hàm: ĐÚNG hàng PENDING (không hàng DONE / FAILED / RUNNING nào), và không đọc được payload.
      await c.query("SAVEPOINT truoc_vai");
      await c.query("SET LOCAL ROLE app_liet_ke_to_chuc");
      const thay = (
        await c.query<{ status: string }>("SELECT j.status FROM public.outbox_jobs j WHERE j.org_id = ANY ($1::uuid[])", [[...cuaToi]])
      ).rows.map((r) => r.status);
      await c.query("ROLLBACK TO SAVEPOINT truoc_vai");
      expect(thay, "vai chủ hàm thấy đúng năm hàng PENDING của vế này").toEqual(["PENDING", "PENDING", "PENDING", "PENDING", "PENDING"]);
      await c.query("SAVEPOINT truoc_vai");
      await c.query("SET LOCAL ROLE app_liet_ke_to_chuc");
      const loiPayload = await c.query("SELECT j.payload FROM public.outbox_jobs j LIMIT 1").then(
        () => null,
        (e: { code?: string }) => e.code ?? "?",
      );
      await c.query("ROLLBACK TO SAVEPOINT truoc_vai");
      expect(loiPayload, "vai chủ hàm không được đọc payload (email của link đăng nhập)").toBe("42501");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
