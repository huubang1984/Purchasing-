// ==============================================================================================
// ĐĂNG NHẬP NGƯỜI MUA QUA HTTP — ADR-020 mục 2, và nửa PHÁT của khoản nợ 6, đo trên tiến trình thật.
//
//   [INV-E1]  token đăng nhập: băm trong CSDL, dùng một lần, có hạn; replay ⇒ 422.
//   [INV-E2]  token magic link một mình KHÔNG là phiên: nhét vào cookie ⇒ 401; chỉ /auth/totp mở phiên.
//   [INV-E3]  TOTP: sai 5 lần ⇒ khoá; lần khoá ghi ĐÚNG MỘT `MFA_LOCKED` (nợ ADR-008 phương án ii).
//   [INV-E6]  token đăng nhập và bí mật TOTP không đi vào log (`console.error` bị theo dõi), token không
//             về client trong phản hồi `/auth/link`; phiên đi ra bằng cookie HttpOnly/Secure/Strict.
//   [029]     app_api KHÔNG chèn được phiên thiếu MFA; đột biến gỡ trigger ⇒ chèn được (RED thật).
//   Không liệt kê được email: email lạ, email bị đình chỉ, và email đúng cho CÙNG một 200.
// ==============================================================================================
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { LOGIN_MAX_TOKENS_PER_WINDOW, MFA_MAX_FAILED_ATTEMPTS, counterForTime, deriveTotpCode } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;
const logLoi: string[] = [];

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

async function taoNguoi(email: string, status = "ACTIVE"): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi mua', $3) RETURNING id",
    [orgA, email, status],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [orgA, id]);
  return id;
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

/** link → redeem (ghi danh) → trả về {token đăng nhập, bí mật TOTP}. */
async function linkVaGhiDanh(email: string): Promise<{ token: string; biMat: Buffer }> {
  const truoc = dv.linkDaGui.length;
  const r = await goi("POST", "/auth/link", { body: { orgId: orgA, email } });
  expect(r.status).toBe(200);
  expect(dv.linkDaGui).toHaveLength(truoc + 1);
  const token = dv.linkDaGui.at(-1)!.token;
  const rd = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token } });
  expect(rd.status, rd.text).toBe(200);
  const b = rd.body as { needsEnrollment: boolean; totpSecretBase32?: string };
  expect(b.needsEnrollment).toBe(true);
  return { token, biMat: base32Decode(b.totpSecretBase32 ?? "") };
}

function maHienTai(biMat: Buffer): string {
  return deriveTotpCode(biMat, counterForTime(Date.now()));
}

async function dangNhap(email: string): Promise<{ cookie: string; token: string; biMat: Buffer }> {
  const { token, biMat } = await linkVaGhiDanh(email);
  const r = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: maHienTai(biMat) } });
  expect(r.status, r.text).toBe(200);
  const sc = r.headers.get("set-cookie") ?? "";
  const gt = /tp_session=([^;]+)/u.exec(sc)?.[1] ?? "";
  expect(gt).not.toBe("");
  return { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${gt}`, token, biMat };
}

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logLoi.push(args.map(String).join(" "));
  });
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180000);

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("/auth/link — không liệt kê được email", () => {
  it("email đúng, email lạ, email bị đình chỉ: CÙNG một 200; token chỉ đi tới bộ gửi, KHÔNG về client", async () => {
    await taoNguoi("a@vidu.vn");
    await taoNguoi("dinhchi@vidu.vn", "SUSPENDED");
    const truoc = dv.linkDaGui.length;
    const dung = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "A@vidu.vn " } });
    const la = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "khong-co@vidu.vn" } });
    const dc = await goi("POST", "/auth/link", { body: { orgId: orgA, email: "dinhchi@vidu.vn" } });
    expect([dung.status, la.status, dc.status]).toEqual([200, 200, 200]);
    expect(new Set([dung.text, la.text, dc.text]).size).toBe(1);
    expect(dv.linkDaGui).toHaveLength(truoc + 1);
    expect(dv.linkDaGui.at(-1)?.email).toBe("a@vidu.vn");
    expect(dung.text).not.toContain(dv.linkDaGui.at(-1)!.token);
  });

  it("[INV-E1] hạn mức theo người dùng: quá LOGIN_MAX_TOKENS_PER_WINDOW ⇒ vẫn 200 nhưng không gửi thêm", async () => {
    await taoNguoi("hanmuc@vidu.vn");
    const truoc = dv.linkDaGui.length;
    for (let i = 0; i < LOGIN_MAX_TOKENS_PER_WINDOW + 3; i += 1) {
      expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "hanmuc@vidu.vn" } })).status).toBe(200);
    }
    expect(dv.linkDaGui.length - truoc).toBe(LOGIN_MAX_TOKENS_PER_WINDOW);
  });
});

describe("/auth/redeem + /auth/totp — token không là phiên; TOTP mới là phiên", () => {
  it("[INV-E2] token đăng nhập nhét vào cookie ⇒ 401; redeem ghi danh trả bí mật ĐÚNG MỘT LẦN; không mở phiên", async () => {
    await taoNguoi("e2@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("e2@vidu.vn");
    expect(biMat).toHaveLength(20);
    expect((await goi("GET", "/me", { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}` })).status).toBe(401);
    // [review M-5] Hồ sơ CHƯA xác nhận ⇒ redeem lần hai ghi danh LẠI (bí mật KHÁC), vẫn không mở phiên.
    const lan2 = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token } });
    expect(lan2.status).toBe(200);
    expect((lan2.body as { needsEnrollment: boolean; totpSecretBase32: string }).needsEnrollment).toBe(true);
    expect(base32Decode((lan2.body as { totpSecretBase32: string }).totpSecretBase32).equals(biMat)).toBe(false);
    expect(lan2.headers.get("set-cookie")).toBeNull();
  });

  it("[INV-E6] bí mật TOTP và token đăng nhập KHÔNG xuất hiện trong bất kỳ dòng log lỗi nào — trên một 500 THẬT", async () => {
    // [review M-6] Bản trước gửi `code: 123456` (số) và tin rằng nó ép 500 — thực tế 422 và không một
    // dòng log nào chạy: một phép đo RỖNG mang nhãn [INV-E6]. Nay ép 500 bằng bộ mở bí mật TOTP ném
    // (thông điệp lỗi giả CỐ Ý mang phong bì bí mật — nếu dispatcher in `err.message`, test đỏ), và
    // đòi log KHÔNG rỗng trước khi đòi nó không chứa bí mật.
    await taoNguoi("log@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("log@vidu.vn");
    const truoc = logLoi.length;
    dv.hong.totpUnsealer = true;
    try {
      const r = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
      expect(r.status).toBe(500);
      expect(r.text).toBe(JSON.stringify({ error: "loi noi bo" }));
    } finally {
      dv.hong.totpUnsealer = false;
    }
    expect(logLoi.length, "đường 500 phải ghi ĐÚNG một dòng — không có nó, phép đo dưới rỗng ruột").toBe(truoc + 1);
    const toanBo = logLoi.join("\n");
    expect(toanBo).not.toContain(token);
    expect(toanBo).not.toContain(biMat.toString("base64"));
    expect(toanBo).not.toContain(biMat.toString("hex"));
    expect(toanBo).not.toContain("KMS gia dang hong");
  });

  it("[review L-1] người bị ĐÌNH CHỈ với phiên còn hạn ⇒ 401 ngay, không đợi hết TTL", async () => {
    const u = await taoNguoi("dinhchi2@vidu.vn");
    const { cookie } = await dangNhap("dinhchi2@vidu.vn");
    expect((await goi("GET", "/me", { cookie })).status).toBe(200);
    await db.pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [u]);
    const r = await goi("GET", "/me", { cookie });
    expect(r.status).toBe(401);
    expect(r.text).toBe(JSON.stringify({ error: "phien khong hop le" }));
  });

  it("[review M-5] hồ sơ TOTP CHƯA xác nhận được ghi danh LẠI và để lại MFA_ENROLLED; hồ sơ ĐÃ xác nhận thì không", async () => {
    const u = await taoNguoi("ghidanh@vidu.vn");
    const dem = async () => Number((await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'MFA_ENROLLED'", [orgA, u])).rows[0]?.n ?? "-1");
    // Lần 1 (kẻ đọc trộm hộp thư): ghi danh, KHÔNG xác nhận.
    const l1 = await linkVaGhiDanh("ghidanh@vidu.vn");
    expect(await dem()).toBe(1);
    // Lần 2 (người thật, link mới): hồ sơ chưa xác nhận ⇒ ghi danh LẠI, bí mật KHÁC, MFA_ENROLLED thứ hai.
    const l2 = await linkVaGhiDanh("ghidanh@vidu.vn");
    expect(l2.biMat.equals(l1.biMat)).toBe(false);
    expect(await dem()).toBe(2);
    // Bí mật cũ KHÔNG còn mở được phiên; bí mật mới thì có.
    expect((await goi("POST", "/auth/totp", { body: { orgId: orgA, token: l2.token, code: maHienTai(l1.biMat) } })).status).toBe(401);
    const ok = await goi("POST", "/auth/totp", { body: { orgId: orgA, token: l2.token, code: maHienTai(l2.biMat) } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.text).not.toContain("userId");
    // Đã xác nhận: redeem link mới ⇒ needsEnrollment false, KHÔNG có MFA_ENROLLED mới, bí mật giữ nguyên.
    expect((await goi("POST", "/auth/link", { body: { orgId: orgA, email: "ghidanh@vidu.vn" } })).status).toBe(200);
    const rd = await goi("POST", "/auth/redeem", { body: { orgId: orgA, token: dv.linkDaGui.at(-1)!.token } });
    expect(rd.body).toEqual({ needsEnrollment: false });
    expect(await dem()).toBe(2);
    // Đột biến ở tầng SQL: UPDATE thay bí mật của hồ sơ ĐÃ xác nhận dưới app_api ⇒ 0 hàng (vế WHERE giữ).
    const { rowCount } = await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE mfa_credentials SET secret_key_version = 'x' WHERE user_id = $1 AND confirmed_at IS NULL", [u]),
    );
    expect(rowCount).toBe(0);
  });

  it("[INV-E1] mã đúng ⇒ cookie HttpOnly/Secure/Strict/Path=/ và /me mở; token đăng nhập TIÊU THỤ — replay ⇒ 422", async () => {
    const u = await taoNguoi("ok@vidu.vn");
    const { cookie, token } = await dangNhap("ok@vidu.vn");
    const me = await goi("GET", "/me", { cookie });
    expect(me.status).toBe(200);
    expect((me.body as { userId: string }).userId).toBe(u);
    for (const tt of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      // cookie ở đây đã bị cắt thuộc tính; kiểm lại trên một lần đăng nhập mới ở dưới.
      expect(tt).toBeTruthy();
    }
    const replay = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
    expect(replay.status).toBe(422);
    expect((await goi("POST", "/auth/redeem", { body: { orgId: orgA, token } })).status).toBe(422);
    // Hàng phiên do app_api chèn mang mfa_verified_at — không có "đăng nhập nửa chừng".
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND mfa_verified_at IS NULL",
      [u],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("thuộc tính cookie phiên người mua", async () => {
    await taoNguoi("cookie@vidu.vn");
    const { token, biMat } = await linkVaGhiDanh("cookie@vidu.vn");
    const r = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: maHienTai(biMat) } });
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/^tp_session=[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,}/u);
    for (const tt of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/;"]) expect(sc).toContain(tt);
    expect(r.text).not.toContain(/tp_session=[^.]+\.([^;]+)/u.exec(sc)?.[1] ?? "@@");
  });

  it("[INV-E3] sai MFA_MAX_FAILED_ATTEMPTS lần ⇒ khoá; ĐÚNG MỘT bản ghi MFA_LOCKED; lần sau vẫn khoá, không ghi thêm", async () => {
    const u = await taoNguoi("khoa@vidu.vn");
    const { token } = await linkVaGhiDanh("khoa@vidu.vn");
    const dem = async () =>
      Number(
        (await db.pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'MFA_LOCKED'",
          [orgA, u],
        )).rows[0]?.n ?? "-1",
      );
    let cuoi: PhanHoi | undefined;
    for (let i = 0; i < MFA_MAX_FAILED_ATTEMPTS; i += 1) {
      cuoi = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
      expect(cuoi.status).toBe(401);
    }
    expect((cuoi?.body as { reason: string }).reason).toBe("WRONG_CODE");
    expect(await dem()).toBe(1);
    const sau = await goi("POST", "/auth/totp", { body: { orgId: orgA, token, code: "000000" } });
    expect(sau.status).toBe(401);
    expect((sau.body as { reason: string }).reason).toBe("LOCKED_OUT");
    expect(await dem()).toBe(1);
  });

  it("đăng xuất: cookie bị xoá, phiên bị thu hồi, /me ⇒ 401; đăng xuất lần hai vẫn 401 (không phiên)", async () => {
    await taoNguoi("out@vidu.vn");
    const { cookie } = await dangNhap("out@vidu.vn");
    const r = await goi("POST", "/auth/logout", { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await goi("GET", "/me", { cookie })).status).toBe(401);
    expect((await goi("POST", "/auth/logout", { cookie })).status).toBe(401);
  });
});

describe("[029] app_api không tạo được phiên thiếu MFA", () => {
  it("INSERT sessions thiếu mfa_verified_at bởi app_api bị trigger từ chối; superuser thì chèn được; đột biến gỡ trigger ⇒ ĐI LỌT", async () => {
    const u = await taoNguoi("trigger@vidu.vn");
    const chen = () =>
      withTenant(apiPool, orgA, (c) =>
        c.query("INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [
          orgA,
          u,
          randomBytes(32),
        ]),
      );
    await expect(chen()).rejects.toThrow(/MFA/u);
    // Superuser (đường test/vận hành) vẫn tạo được — trigger cố ý điều kiện theo role.
    await db.pool.query("INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [orgA, u, randomBytes(32)]);
    // Đột biến: gỡ trigger → câu chèn của app_api ĐI LỌT. Khôi phục sau đó.
    await db.pool.query("DROP TRIGGER sessions_kiem_mfa_khi_tao ON sessions");
    try {
      await expect(chen()).resolves.toBeDefined();
    } finally {
      await db.pool.query("CREATE TRIGGER sessions_kiem_mfa_khi_tao BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_mfa_khi_tao()");
      await db.pool.query("ALTER TABLE sessions ENABLE ALWAYS TRIGGER sessions_kiem_mfa_khi_tao");
    }
    await expect(chen()).rejects.toThrow(/MFA/u);
  });
});
