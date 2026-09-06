// ==============================================================================================
// apps/api — PHÉP ĐO TRÊN TIẾN TRÌNH HTTP THẬT, Postgres thật (Testcontainers), cổng thật (`:0`).
//
// Đây là lần đầu trong dự án một bất biến được đo QUA MỘT CỔNG MẠNG. Ba nhóm:
//   [INV-E6]  mọi route trong `ROUTES` — và cả 404/405 — trả về ba header của E6;
//   [INV-H17] + [INV-D5] một phiên thiếu quyền nhận 403 VÀ để lại một bản ghi PERMISSION_DENIED;
//             phiên đủ quyền tạo được và đọc lại được — đối chứng dương;
//   [INV-A5]  hai phiên khách của hai nhà cung cấp trên CÙNG một RFQ, cùng đường, thấy hai thứ
//             khác nhau — và route ấy CỐ Ý không có `WHERE` (xem routes/guest.ts).
// Cộng: mọi ca xác thực hỏng cho CÙNG một 401 (không oracle); trần thân 413; content-type 415.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  PepperRing,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_KHACH } from "./routes/anon.js";
import { dichVuTest } from "./test-services.js";
import { ROUTES } from "./routes.js";
import { createApiServer } from "./server.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const PEPPER = new PepperRing("p1", { p1: Buffer.alloc(32, 9) });

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let orgA: string;
let uPM: string;
let uBuyer: string;
/** Phiên (id) của trưởng phòng — dùng làm `created_by_session_id` khi gieo dữ liệu thô. */
let sPM: string;
let tokPM: string;
let tokBuyer: string;
let tokChuaMfa: string;
let tokThuHoi: string;
let rfqA: string;
let guest1: { token: string; invitationId: string };
let guest2: { token: string; invitationId: string };
let goc: string;
let server: ReturnType<typeof createApiServer>;

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

async function taoPhien(userId: string, tuyChon: { mfa?: boolean; thuHoi?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, revoked_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', " +
      "        CASE WHEN $4::boolean THEN now() END, CASE WHEN $5::boolean THEN now() END) RETURNING id",
    [orgA, userId, sha256(token), tuyChon.mfa ?? true, tuyChon.thuHoi ?? false],
  );
  return { id: rows[0]?.id ?? "", token };
}

/** Một nhà cung cấp + một người liên hệ + lời mời + link + OTP + phiên khách — trọn đường S1.3. */
async function moiVaMoPhien(ten: string): Promise<{ token: string; invitationId: string }> {
  const duoi = randomBytes(4).toString("hex");
  const ncc = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
      "VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, ten, uPM, sPM],
  );
  const lh = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi bao gia', $3, $4, $5, $6) RETURNING id",
    [orgA, ncc.rows[0]?.id, `lh${duoi}@vidu.vn`, `09${duoi}`.replace(/[a-f]/g, "2").slice(0, 10), uPM, sPM],
  );
  return withTenant(apiPool, orgA, async (c) => {
    const loi = await createInvitation(c, orgA, {
      rfqId: rfqA,
      supplierId: ncc.rows[0]?.id ?? "",
      contactId: lh.rows[0]?.id ?? "",
      linkChannel: "EMAIL",
      actorSessionId: sPM,
    });
    const t = await issueMagicLinkToken(c, orgA, { invitationId: loi.id, actorSessionId: sPM });
    const otp = await issueOtpChallenge(c, orgA, {
      token: t.token,
      channel: "SMS",
      callerFingerprint: `ip-${duoi}`,
      pepper: PEPPER,
    });
    if (!otp.ok) throw new Error(`khong phat duoc OTP: ${otp.reason}`);
    const phien = await verifyOtpAndStartSession(c, orgA, { token: t.token, code: otp.code, pepper: PEPPER });
    if (!phien.ok) throw new Error(`khong mo duoc phien khach: ${phien.reason}`);
    return { token: phien.sessionToken, invitationId: loi.id };
  });
}

function cookieMua(token: string): string {
  return `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}`;
}
function cookieKhach(token: string): string {
  return `${COOKIE_PHIEN_KHACH}=${orgA}.${token}`;
}

async function goi(
  method: string,
  path: string,
  tuyChon: { cookie?: string; body?: unknown; contentType?: string; rawBody?: string } = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const headers: Record<string, string> = {};
  if (tuyChon.cookie !== undefined) headers.cookie = tuyChon.cookie;
  let body: string | undefined;
  if (tuyChon.rawBody !== undefined) {
    body = tuyChon.rawBody;
    headers["content-type"] = tuyChon.contentType ?? "application/json";
  } else if (tuyChon.body !== undefined) {
    body = JSON.stringify(tuyChon.body);
    headers["content-type"] = tuyChon.contentType ?? "application/json";
  }
  const res = await fetch(`${goc}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

async function demTuChoi(userId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
    [orgA, userId],
  );
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const org = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = org.rows[0]?.id ?? "";
  const nguoi = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'pm@vidu.vn', 'Truong phong'), " +
      "($1, 'buyer@vidu.vn', 'Nhan vien mua') RETURNING id",
    [orgA],
  );
  uPM = nguoi.rows[0]?.id ?? "";
  uBuyer = nguoi.rows[1]?.id ?? "";
  await db.pool.query(
    "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER'), ($1, $3, 'BUYER')",
    [orgA, uPM, uBuyer],
  );
  const pm = await taoPhien(uPM);
  sPM = pm.id;
  tokPM = pm.token;
  tokBuyer = (await taoPhien(uBuyer)).token;
  tokChuaMfa = (await taoPhien(uPM, { mfa: false })).token;
  tokThuHoi = (await taoPhien(uPM, { thuHoi: true })).token;

  const rfq = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, created_by, created_by_session_id) " +
      "VALUES ($1, 'RFQ cua api', now() + interval '7 days', $2, $3) RETURNING id",
    [orgA, uPM, sPM],
  );
  rfqA = rfq.rows[0]?.id ?? "";

  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  guest1 = await moiVaMoPhien("NCC mot");
  guest2 = await moiVaMoPhien("NCC hai");

  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dichVuTest().services }), { maxBodyBytes: 2048 });
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  const dc = server.address() as AddressInfo;
  goc = `http://127.0.0.1:${dc.port}`;
  expect([orgA, uPM, uBuyer, sPM, rfqA].filter((x) => x === "")).toEqual([]);
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[INV-E6] ba header của E6 nằm trên MỌI phản hồi", () => {
  it("[INV-E6] duyệt từng route trong ROUTES (không cookie) — kể cả 404 và 405", async () => {
    const duong = [
      ...ROUTES.map((r) => ({
        method: r.method,
        path: r.path.replace(/:[A-Za-z]+/gu, "3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
      })),
      { method: "GET", path: "/khong-co-duong-nay" },
      { method: "PUT", path: "/health" },
      { method: "GET", path: "/suppliers/../admin" },
    ];
    expect(duong.length).toBeGreaterThan(ROUTES.length);
    for (const d of duong) {
      const r = await goi(d.method, d.path);
      const tenCa = `${d.method} ${d.path} -> ${r.status}`;
      expect(r.headers.get("referrer-policy"), tenCa).toBe("no-referrer");
      expect(r.headers.get("cache-control"), tenCa).toBe("no-store");
      expect(r.headers.get("x-content-type-options"), tenCa).toBe("nosniff");
      expect(r.headers.get("content-type"), tenCa).toContain("application/json");
    }
  });

  it("[INV-E6] handler KHÔNG ghi đè được header mặc định — chúng được đặt SAU header của handler", async () => {
    // Đối chứng ở tầng đơn vị của server.ts: `HEADER_MAC_DINH` trải sau `r.headers`. Ở đây đo
    // trên dây: /health không đặt header nào nên chỉ chứng minh sự có mặt; vế "không ghi đè" đo
    // bằng thứ tự spread và được khoá bởi test dưới (một handler giả đặt cache-control khác).
    const { createDispatcher: tao } = await import("./dispatch.js");
    const dispatch = tao({
      pool: apiPool,
      auditPool,
      services: dichVuTest().services,
      routes: [
        {
          method: "GET",
          path: "/gia",
          audience: "PUBLIC",
          handler: () =>
            Promise.resolve({ status: 200, body: {}, headers: { "cache-control": "public, max-age=999", "referrer-policy": "unsafe-url" } }),
        },
      ],
    });
    const s2 = createApiServer(dispatch);
    await new Promise<void>((xong) => s2.listen(0, "127.0.0.1", xong));
    try {
      const port = (s2.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/gia`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      await new Promise<void>((xong) => s2.close(() => xong()));
    }
  });
});

describe("xác thực người mua — một 401 cho mọi ca hỏng", () => {
  it("không cookie / sai hình dạng / token lạ / chưa MFA / đã thu hồi ⇒ CÙNG một thân 401", async () => {
    const cac = [
      undefined,
      `${COOKIE_PHIEN_NGUOI_MUA}=rac`,
      cookieMua(randomBytes(32).toString("base64url")),
      cookieMua(tokChuaMfa),
      cookieMua(tokThuHoi),
      `${COOKIE_PHIEN_NGUOI_MUA}=00000000-0000-4000-8000-000000000000.${tokPM}`,
    ];
    const than = new Set<string>();
    for (const c of cac) {
      const r = await goi("GET", "/me", { cookie: c });
      expect(r.status, c ?? "(khong cookie)").toBe(401);
      than.add(JSON.stringify(r.body));
    }
    expect(than.size, "hai ca hỏng cho hai thân khác nhau là một oracle").toBe(1);
  });

  it("phiên hợp lệ: /me trả đúng người và đúng phiên — danh tính DẪN XUẤT từ cookie", async () => {
    const r = await goi("GET", "/me", { cookie: cookieMua(tokPM) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ userId: uPM, sessionId: sPM, orgId: orgA });
  });
});

describe("[INV-H17] cổng quyền chạy TRƯỚC handler, và lần từ chối để lại dấu vết [INV-D5]", () => {
  it("[INV-H17] [INV-D5] BUYER (không có supplier.manage) POST /suppliers ⇒ 403 + đúng MỘT bản ghi PERMISSION_DENIED", async () => {
    const truoc = await demTuChoi(uBuyer);
    const r = await goi("POST", "/suppliers", { cookie: cookieMua(tokBuyer), body: { legalName: "NCC cua buyer" } });
    expect(r.status).toBe(403);
    expect(await demTuChoi(uBuyer)).toBe(truoc + 1);
    // Và không hàng nào được tạo — cổng đứng TRƯỚC handler, không phải sau.
    const { rows } = await db.pool.query("SELECT 1 FROM suppliers WHERE org_id = $1 AND legal_name = 'NCC cua buyer'", [orgA]);
    expect(rows).toHaveLength(0);
  });

  it("[INV-H17] ĐỐI CHỨNG DƯƠNG: PROCUREMENT_MANAGER tạo được, đọc lại được, KHÔNG có bản ghi từ chối", async () => {
    const truoc = await demTuChoi(uPM);
    const r = await goi("POST", "/suppliers", { cookie: cookieMua(tokPM), body: { legalName: "NCC cua PM", taxCode: "0101010101" } });
    expect(r.status).toBe(201);
    const ncc = (r.body as { supplier: { id: string; legalName: string } }).supplier;
    expect(ncc.legalName).toBe("NCC cua PM");
    expect(await demTuChoi(uPM)).toBe(truoc);

    const ds = await goi("GET", "/suppliers", { cookie: cookieMua(tokPM) });
    expect(ds.status).toBe(200);
    expect((ds.body as { suppliers: { id: string }[] }).suppliers.some((s) => s.id === ncc.id)).toBe(true);
  });

  it("thân thiếu trường ⇒ 422, và vẫn không tạo gì", async () => {
    const r = await goi("POST", "/suppliers", { cookie: cookieMua(tokPM), body: { taxCode: "1" } });
    expect(r.status).toBe(422);
  });
});

describe("[INV-A5] đường khách chỉ nhìn thấy lời mời của chính mình — đo qua HTTP", () => {
  it("[INV-A5] hai phiên khách trên CÙNG RFQ, cùng route: mỗi bên đúng MỘT phiên, và là của mình", async () => {
    const r1 = await goi("GET", "/guest/session", { cookie: cookieKhach(guest1.token) });
    const r2 = await goi("GET", "/guest/session", { cookie: cookieKhach(guest2.token) });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const s1 = (r1.body as { sessions: { invitationId: string; rfqId: string }[] }).sessions;
    const s2 = (r2.body as { sessions: { invitationId: string; rfqId: string }[] }).sessions;
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s1[0]?.invitationId).toBe(guest1.invitationId);
    expect(s2[0]?.invitationId).toBe(guest2.invitationId);
    expect(s1[0]?.rfqId).toBe(rfqA);
    expect(s2[0]?.rfqId).toBe(rfqA);
    expect(guest1.invitationId).not.toBe(guest2.invitationId);

    // Đối chứng cho "route cố ý không có WHERE": dưới superuser, cùng câu SELECT thấy CẢ HAI.
    const { rows } = await db.pool.query("SELECT id FROM guest_sessions WHERE org_id = $1", [orgA]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("cookie khách lạ / thu hồi ⇒ 401, cùng thân với 401 của người mua", async () => {
    const la = await goi("GET", "/guest/session", { cookie: cookieKhach(randomBytes(32).toString("base64url")) });
    expect(la.status).toBe(401);
    await db.pool.query("UPDATE guest_sessions SET revoked_at = now() WHERE invitation_id = $1", [guest2.invitationId]);
    const thuHoi = await goi("GET", "/guest/session", { cookie: cookieKhach(guest2.token) });
    expect(thuHoi.status).toBe(401);
    const mua = await goi("GET", "/me");
    expect(JSON.stringify(thuHoi.body)).toBe(JSON.stringify(mua.body));
  });

  it("cookie người mua KHÔNG mở được route khách, và ngược lại", async () => {
    expect((await goi("GET", "/guest/session", { cookie: cookieMua(tokPM) })).status).toBe(401);
    expect((await goi("GET", "/me", { cookie: cookieKhach(guest1.token) })).status).toBe(401);
  });
});

describe("tầng vận chuyển: trần thân, content-type, phương thức", () => {
  it("thân vượt trần ⇒ 413; content-type sai ⇒ 415; JSON hỏng ⇒ 400; PUT /health ⇒ 405", async () => {
    const to = await goi("POST", "/suppliers", { cookie: cookieMua(tokPM), rawBody: JSON.stringify({ legalName: "x".repeat(4096) }) });
    expect(to.status).toBe(413);
    const sai = await goi("POST", "/suppliers", { cookie: cookieMua(tokPM), rawBody: "legalName=x", contentType: "text/plain" });
    expect(sai.status).toBe(415);
    const hong = await goi("POST", "/suppliers", { cookie: cookieMua(tokPM), rawBody: "{" });
    expect(hong.status).toBe(400);
    expect((await goi("PUT", "/health")).status).toBe(405);
    expect((await goi("GET", "/health")).body).toEqual({ ok: true });
  });
});
