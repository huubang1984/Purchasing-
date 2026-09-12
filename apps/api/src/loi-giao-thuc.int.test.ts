// ==============================================================================================
// [S1.66 / lượt soi ngang 59b-1] LỖI GIAO THỨC CỦA LỚP CÔ LẬP KHÔNG ĐƯỢC THÀNH MỘT 401 CÂM
//
// `withTenant` (S1.47–S1.48, S1.54) và lần lấy client của pool có vai (S1.59) chọn cách ỒN ÀO: từ chối phục vụ khi mặc định
// phiên bị gắn sẵn, khi GUC tenant/khách rò ở phạm vi phiên, khi kết nối lấy từ pool đã nhiễm. Trước vòng này `dispatch` nuốt
// cả nhóm ấy: mọi `TenantError` thành 401 không log, và nhánh GUEST gói MỌI lỗi của `withTenant` — kể cả `KetNoiNhiemError` —
// thành lỗi xác thực. Đo trên PostgreSQL 16 (bản nháp của lượt soi 59, trước bản vá): `ALTER DATABASE … SET app.guest_session_id`
// làm `/me` và `/guest/session` cùng ra 401 với 0 dòng log; rò `set_config('app.org_id', …, false)` ra 401 với 0 dòng log trên
// cả hai đường; kết nối nhiễm `row_security = off` ra 401 câm ở đường khách (500 có log ở đường người mua). Lớp CHẶN vẫn giữ —
// không thay đổi nào được ghi — nhưng người vận hành không thấy gì, và máy khách được bảo "đăng nhập lại".
//
// Hợp đồng đo ở đây: lỗi ĐẦU VÀO của người gọi (cookie hỏng, token lạ~~, phiên khách thu hồi~~) vẫn là MỘT 401 câm, không oracle;
// lỗi GIAO THỨC MANG TÊN (`TenantError` loại protocol, `KetNoiNhiemError`) là 500 với thân cố định và MỘT dòng log mang tên lỗi và mã
// cố định — không giá trị GUC, không token. [S1.66 / lượt soi 60a-1, 60a-7] KHÔNG đo ở đây: phiên khách thu hồi; lỗi Postgres của lần
// lấy client hay của câu xác thực — đo riêng ra 403 hay 401 không log — khoản 118.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import {
  PepperRing,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_KHACH } from "./routes/anon.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const PEPPER = new PepperRing("p1", { p1: Buffer.alloc(32, 9) });
const GIA_TRI_DOC = "00000000-0000-4000-8000-000000000591";

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let cookieMua: string;
let cookieKhach: string;
const canDong: (() => Promise<void>)[] = [];

interface PhanHoiCoLog {
  readonly status: number;
  readonly body: string;
  readonly log: readonly string[];
}

async function dungServer(pool: pg.Pool): Promise<string> {
  const server = createApiServer(createDispatcher({ pool, auditPool: apiPool, services: dichVuTest().services }), { maxBodyBytes: 2048 });
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  canDong.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Gọi một route và gom MỌI dòng `console.error` phát ra trong lúc yêu cầu được phục vụ. */
async function goi(goc: string, duong: string, cookie: string): Promise<PhanHoiCoLog> {
  const log: string[] = [];
  const cu = console.error;
  console.error = (...a: unknown[]) => {
    log.push(a.map(String).join(" "));
  };
  try {
    const res = await fetch(`${goc}${duong}`, { headers: { cookie } });
    return { status: res.status, body: await res.text(), log };
  } finally {
    console.error = cu;
  }
}

function poolMotKetNoi(): pg.Pool {
  const p = createPool(db.connectionString, 1, { role: "app_api" });
  canDong.push(() => p.end());
  return p;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty 59b', 'cong-ty-59b') RETURNING id")).rows[0]!.id;
  const uPM = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'pm59b@vidu.vn', 'PM 59b') RETURNING id", [orgA])).rows[0]!.id;
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER')", [orgA, uPM]);
  const tokPM = randomBytes(32).toString("base64url");
  const sPM = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgA, uPM, createHash("sha256").update(tokPM, "utf8").digest()],
    )
  ).rows[0]!.id;
  const rfqA = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, created_by, created_by_session_id) VALUES ($1, 'RFQ 59b', now() + interval '7 days', $2, $3) RETURNING id",
      [orgA, uPM, sPM],
    )
  ).rows[0]!.id;
  apiPool = db.poolAs("app_api");
  const duoi = randomBytes(4).toString("hex");
  const ncc = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, 'NCC 59b', $2, $3) RETURNING id",
      [orgA, uPM, sPM],
    )
  ).rows[0]!.id;
  const lh = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) VALUES ($1, $2, 'Nguoi 59b', $3, $4, $5, $6) RETURNING id",
      [orgA, ncc, `lh${duoi}@vidu.vn`, `09${duoi}`.replace(/[a-f]/g, "2").slice(0, 10), uPM, sPM],
    )
  ).rows[0]!.id;
  const tokKhach = await withTenant(apiPool, orgA, async (c) => {
    const loi = await createInvitation(c, orgA, { rfqId: rfqA, supplierId: ncc, contactId: lh, linkChannel: "EMAIL", actorSessionId: sPM });
    const t = await issueMagicLinkToken(c, orgA, { invitationId: loi.id, actorSessionId: sPM });
    const otp = await issueOtpChallenge(c, orgA, { token: t.token, channel: "SMS", callerFingerprint: `ip-${duoi}`, pepper: PEPPER });
    if (!otp.ok) throw new Error(`khong phat duoc OTP: ${otp.reason}`);
    const phien = await verifyOtpAndStartSession(c, orgA, { token: t.token, code: otp.code, pepper: PEPPER });
    if (!phien.ok) throw new Error(`khong mo duoc phien khach: ${phien.reason}`);
    return phien.sessionToken;
  });
  cookieMua = `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${tokPM}`;
  cookieKhach = `${COOKIE_PHIEN_KHACH}=${orgA}.${tokKhach}`;
}, 180000);

afterAll(async () => {
  for (const dong of canDong.reverse()) await dong().catch(() => undefined);
  await db?.stop();
});

describe("[S1.66 / lượt soi ngang 59b-1] lỗi giao thức MANG TÊN của withTenant và của lần lấy client (TenantError loại protocol, KetNoiNhiemError) đi ra 500 có log, lỗi đầu vào vẫn là 401 câm", () => {
  it("đối chứng: phiên hợp lệ ⇒ 200 không log; token khách lạ, cookie hỏng ⇒ CÙNG một 401 không log", async () => {
    const goc = await dungServer(apiPool);
    const me = await goi(goc, "/me", cookieMua);
    const khach = await goi(goc, "/guest/session", cookieKhach);
    expect([me.status, me.log, khach.status, khach.log]).toEqual([200, [], 200, []]);
    const la = await goi(goc, "/guest/session", `${COOKIE_PHIEN_KHACH}=${orgA}.${randomBytes(32).toString("base64url")}`);
    const hong = await goi(goc, "/me", `${COOKIE_PHIEN_NGUOI_MUA}=rac`);
    expect([la.status, la.log, hong.status, hong.log]).toEqual([401, [], 401, []]);
    expect(la.body).toBe(hong.body);
  });

  it("⒜ GUC khách gắn sẵn ở mức database (mặc định phiên) ⇒ /me và /guest/session ra 500, mỗi yêu cầu MỘT dòng log mang TenantError và mã SESSION_DEFAULT_PRESET, không mang giá trị", async () => {
    const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
    await db.pool.query(`ALTER DATABASE "${tenDb}" SET app.guest_session_id = '${GIA_TRI_DOC}'`);
    try {
      const goc = await dungServer(poolMotKetNoi());
      for (const [duong, cookie] of [["/me", cookieMua], ["/guest/session", cookieKhach]] as const) {
        const r = await goi(goc, duong, cookie);
        expect(r.status, duong).toBe(500);
        expect(r.log, duong).toHaveLength(1);
        expect(r.log[0], duong).toContain("TenantError SESSION_DEFAULT_PRESET");
        expect(r.log[0], duong).not.toContain(GIA_TRI_DOC);
        expect(JSON.parse(r.body), duong).toEqual({ error: "loi noi bo" });
      }
    } finally {
      await db.pool.query(`ALTER DATABASE "${tenDb}" RESET app.guest_session_id`);
    }
  });

  it("⒞ GUC tenant rò ở phạm vi PHIÊN từ mã ngoài withTenant ⇒ 500 và MỘT dòng log SESSION_SCOPE_LEAK trên CẢ đường khách lẫn đường người mua; yêu cầu kế trên cùng pool ra 200", async () => {
    const pool = poolMotKetNoi();
    const goc = await dungServer(pool);
    const roRi = async (): Promise<void> => {
      const c = await pool.connect();
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, false)", [orgA]);
      c.release();
    };
    for (const [duong, cookie] of [["/guest/session", cookieKhach], ["/me", cookieMua]] as const) {
      await roRi();
      const r = await goi(goc, duong, cookie);
      expect(r.status, duong).toBe(500);
      expect(r.log, duong).toHaveLength(1);
      expect(r.log[0], duong).toContain("TenantError SESSION_SCOPE_LEAK");
    }
    const sau = await goi(goc, "/me", cookieMua);
    expect([sau.status, sau.log]).toEqual([200, []]);
  });

  it("⒟ kết nối trả về pool với row_security = off ⇒ lần lấy client ném KetNoiNhiemError ⇒ 500 và MỘT dòng log trên CẢ đường khách (trước vòng này: 401 câm)", async () => {
    const pool = poolMotKetNoi();
    const goc = await dungServer(pool);
    const nhiem = async (): Promise<void> => {
      const c = await pool.connect();
      await c.query("SET row_security = off");
      c.release();
    };
    for (const [duong, cookie] of [["/guest/session", cookieKhach], ["/me", cookieMua]] as const) {
      await nhiem();
      const r = await goi(goc, duong, cookie);
      expect(r.status, duong).toBe(500);
      expect(r.log, duong).toHaveLength(1);
      expect(r.log[0], duong).toContain("KetNoiNhiemError");
    }
  });
});
