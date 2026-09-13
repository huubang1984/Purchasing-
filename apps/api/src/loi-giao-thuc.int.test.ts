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
// cố định — không giá trị GUC, không token. [S1.66 / lượt soi 60a-1, 60a-7] KHÔNG đo ở đây: phiên khách thu hồi; ~~lỗi Postgres của lần
// lấy client hay của câu xác thực — đo riêng ra 403 hay 401 không log — khoản 118~~. [S1.67 / khoản 118] Lỗi Postgres của lần lấy
// client, của câu xác thực và của câu kết thúc nay đo ở describe cuối tệp.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { SessionInvalidError } from "@trustprocure/identity";
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
import type { ApiResponse } from "./http.js";
import { ghiLogKetNoiHuy } from "./mo-ta-loi.js";
import type { Route } from "./route-types.js";
import { ROUTES } from "./routes.js";
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

async function dungServer(pool: pg.Pool, routes?: readonly Route[], auditPool: pg.Pool = apiPool): Promise<string> {
  const server = createApiServer(
    createDispatcher({ pool, auditPool, services: dichVuTest().services, ...(routes === undefined ? {} : { routes }) }),
    { maxBodyBytes: 2048 },
  );
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  canDong.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Gọi một route và gom MỌI dòng `console.error` phát ra trong lúc yêu cầu được phục vụ. */
async function goi(
  goc: string,
  duong: string,
  cookie: string,
  tuyChon: { readonly method?: string; readonly body?: unknown } = {},
): Promise<PhanHoiCoLog> {
  const log: string[] = [];
  const cu = console.error;
  console.error = (...a: unknown[]) => {
    log.push(a.map(String).join(" "));
  };
  try {
    const headers: Record<string, string> = { cookie };
    if (tuyChon.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${goc}${duong}`, {
      method: tuyChon.method ?? "GET",
      headers,
      ...(tuyChon.body === undefined ? {} : { body: JSON.stringify(tuyChon.body) }),
    });
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

// ----------------------------------------------------------------------------------------------
// [S1.67 / khoản 118] NGUỒN CỦA LỖI, KHÔNG PHẢI TÊN CỦA NÓ
//
// Trước khoản 118, `dispatch` đưa MỌI lỗi không mang tên riêng qua bảng ánh xạ của giai đoạn handler, và nhánh người mua gói MỌI lỗi
// của `resolveSessionByToken` thành lỗi xác thực. Đo trên bản đầu S1.66 (lượt soi 60 ⒪): vai đăng nhập mất membership `app_api` ⇒
// `/me` và `/guest/session` ra 403, 0 dòng log; EXECUTE trên `app_current_org_id()` thu hồi ⇒ người mua 401, khách 403, 0 dòng log.
// Hợp đồng đo ở describe dưới:
//   ⒠ ⒡ ⒧ lỗi do HANDLER gây ra giữ bảng ánh xạ của giai đoạn 2 trên mọi nhánh — kể cả lỗi lớp 23 ném ở câu kết thúc của withTenant
//        SAU khi handler đã trả về (ràng buộc hoãn tới COMMIT), và `SessionInvalidError` do handler ném vẫn là 401; 42501 kèm MỘT dòng
//        log (lượt soi 61a-1);
//   ⒢ ⒣ ⒤ ⒦ ⒪ lỗi của KHUNG — câu kết thúc ném lỗi ngoài lớp 23, lần lấy client, câu xác thực (kể cả lỗi lớp 23 ném TRƯỚC khi handler
//        chạy), câu riêng của withGuestSession — ra 500 thân cố định với MỘT dòng log mang tên lỗi và SQLSTATE; ⒨ `HttpError` do chính
//        bộ điều phối ném giữ mã; ⒩ việc sau commit hỏng ghi MỘT dòng mang tên và SQLSTATE, phản hồi không đổi;
//   ⒥ kết nối bị huỷ vì `SESSION_STATE_LEFT` — lỗi của withTenant chỉ đi vào `release()`, không được ném — có MỘT dòng log của bộ nghe
//        `release`; lỗi đã được ném ở chỗ khác thì bộ nghe không ghi lại.
// ----------------------------------------------------------------------------------------------

const CAU_42501 = "SELECT 1 FROM pg_catalog.pg_authid";
/** Khoá ngoại tự tham chiếu HOÃN tới COMMIT: câu chèn đi qua, phép kiểm ném 23503 ở câu kết thúc của withTenant. */
const CAU_HOAN = "INSERT INTO public.hoan_118 (id, cha) VALUES (1, 999)";
/** Số lần handler của `tuyenK118` chạy XONG câu của nó — lỗi ⒡ phải đến SAU khi handler trả về, lỗi ⒠ từ chính câu. */
let soLanHandlerXong = 0;

function tuyenK118(): Route[] {
  const chay =
    (cau: string) =>
    async (ctx: { readonly client: pg.PoolClient }): Promise<ApiResponse> => {
      await ctx.client.query(cau);
      soLanHandlerXong += 1;
      return { status: 200, body: { ok: true } };
    };
  return [
    {
      method: "GET",
      path: "/k118/cong-khai/42501",
      audience: "PUBLIC",
      // PUBLIC không có client: handler tự ném một lỗi mang hình dạng lỗi Postgres (tên `error`, SQLSTATE).
      handler: () => Promise.reject(Object.assign(new Error("gia lap"), { name: "error", code: "42501" })),
    },
    { method: "GET", path: "/k118/mua/42501", audience: "BUYER", mutates: false, handler: chay(CAU_42501) },
    { method: "GET", path: "/k118/mua/hoan", audience: "BUYER", mutates: false, handler: chay(CAU_HOAN) },
    { method: "GET", path: "/k118/mua/phien-hong", audience: "BUYER", mutates: false, handler: () => Promise.reject(new SessionInvalidError()) },
    { method: "GET", path: "/k118/mua/vo-hai", audience: "BUYER", mutates: false, handler: chay("SELECT 1") },
    {
      method: "GET",
      path: "/k118/mua/sau-commit",
      audience: "BUYER",
      mutates: false,
      // Việc sau commit reject bằng một lỗi mang hình dạng lỗi Postgres; thông điệp của nó không được vào log.
      handler: (ctx) => {
        ctx.afterCommit(() => Promise.reject(Object.assign(new Error("gia lap sau commit"), { name: "error", code: "08006" })));
        return Promise.resolve({ status: 200, body: { ok: true } });
      },
    },
    { method: "GET", path: "/k118/khach-doc/42501", audience: "GUEST", mutates: false, handler: chay(CAU_42501) },
    { method: "GET", path: "/k118/khach-doc/hoan", audience: "GUEST", mutates: false, handler: chay(CAU_HOAN) },
    { method: "GET", path: "/k118/khach-doc/vo-hai", audience: "GUEST", mutates: false, handler: chay("SELECT 1") },
    { method: "POST", path: "/k118/khach-ghi/42501", audience: "GUEST", mutates: true, handler: chay(CAU_42501) },
    { method: "POST", path: "/k118/khach-ghi/hoan", audience: "GUEST", mutates: true, handler: chay(CAU_HOAN) },
    { method: "POST", path: "/k118/vo-danh/42501", audience: "ANON", mutates: true, handler: chay(CAU_42501) },
    { method: "POST", path: "/k118/vo-danh/hoan", audience: "ANON", mutates: true, handler: chay(CAU_HOAN) },
    {
      method: "GET",
      path: "/k118/mua/de-lai-phien",
      audience: "BUYER",
      mutates: false,
      handler: async (ctx) => {
        await ctx.client.query("SELECT pg_catalog.set_config('app.org_id', $1, false)", [ctx.orgId]);
        return { status: 200, body: { ok: true } };
      },
    },
  ];
}

describe("[S1.67 / khoản 118] lỗi phân loại theo NGUỒN: lỗi của handler giữ bảng ánh xạ, lỗi của khung ra 500 với MỘT dòng log mang tên lỗi và SQLSTATE", () => {
  let gocK118: string;

  beforeAll(async () => {
    await db.pool.query(
      "CREATE TABLE public.hoan_118 (id integer PRIMARY KEY, cha integer REFERENCES public.hoan_118 (id) DEFERRABLE INITIALLY DEFERRED)",
    );
    await db.pool.query("GRANT INSERT ON public.hoan_118 TO app_api");
    gocK118 = await dungServer(apiPool, [...ROUTES, ...tuyenK118()]);
  });

  it("⒠ lỗi do câu của HANDLER giữ bảng ánh xạ của giai đoạn 2 trên cả năm nhánh: 42501 ⇒ 403, kèm MỘT dòng log `error 42501` không mang thông điệp (lượt soi 61a-1)", async () => {
    const truoc = soLanHandlerXong;
    const ca = [
      ["GET", "/k118/cong-khai/42501", "", undefined],
      ["GET", "/k118/mua/42501", cookieMua, undefined],
      ["GET", "/k118/khach-doc/42501", cookieKhach, undefined],
      ["POST", "/k118/khach-ghi/42501", cookieKhach, {}],
      ["POST", "/k118/vo-danh/42501", "", { orgId: orgA }],
    ] as const;
    for (const [method, duong, cookie, body] of ca) {
      const r = await goi(gocK118, duong, cookie, { method, body });
      expect([r.status, r.log.length], duong).toEqual([403, 1]);
      expect(r.log[0], duong).toContain("error 42501");
      expect(r.log[0], duong).not.toContain("gia lap");
    }
    expect(soLanHandlerXong, "câu 42501 của handler phải ném, không chạy xong").toBe(truoc);
  });

  it("⒡ ràng buộc HOÃN tới COMMIT là lỗi của handler: 23503 ném ở câu kết thúc của withTenant SAU khi handler đã trả về ⇒ 422 không log trên bốn nhánh có giao dịch; không hàng nào được ghi", async () => {
    const truoc = soLanHandlerXong;
    const ca = [
      ["GET", "/k118/mua/hoan", cookieMua, undefined],
      ["GET", "/k118/khach-doc/hoan", cookieKhach, undefined],
      ["POST", "/k118/khach-ghi/hoan", cookieKhach, {}],
      ["POST", "/k118/vo-danh/hoan", "", { orgId: orgA }],
    ] as const;
    for (const [method, duong, cookie, body] of ca) {
      const r = await goi(gocK118, duong, cookie, { method, body });
      expect([r.status, r.log, JSON.parse(r.body)], duong).toEqual([422, [], { error: "tham chieu khong hop le" }]);
    }
    expect(soLanHandlerXong, "bốn handler phải chạy xong câu chèn trước khi phép kiểm hoãn ném").toBe(truoc + 4);
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM public.hoan_118");
    expect(rows[0]!.n).toBe(0);
  });

  it("⒢ câu kết thúc ném lỗi NGOÀI lớp 23 là lỗi của khung: USAGE trên plpgsql thu hồi ⇒ khối DO của withTenant ném 42501 SAU khi handler đã chạy xong (bộ đếm — lượt soi 61a-5) ⇒ /me và một route có câu vô hại ra 500 với MỘT dòng log `error 42501` (đỏ-trước trên /me: 403 không log)", async () => {
    await db.pool.query("REVOKE USAGE ON LANGUAGE plpgsql FROM PUBLIC");
    try {
      const { rows } = await db.pool.query<{ co: boolean }>("SELECT has_language_privilege('app_api', 'plpgsql', 'USAGE') AS co");
      expect(rows[0]!.co, "fixture: app_api còn USAGE trên plpgsql").toBe(false);
      const truoc = soLanHandlerXong;
      for (const duong of ["/me", "/k118/mua/vo-hai"]) {
        const r = await goi(gocK118, duong, cookieMua);
        expect(r.status, duong).toBe(500);
        expect(r.log, duong).toHaveLength(1);
        expect(r.log[0], duong).toContain("error 42501");
        expect(JSON.parse(r.body), duong).toEqual({ error: "loi noi bo" });
      }
      expect(soLanHandlerXong, "handler của route vô hại phải chạy xong trước câu kết thúc").toBe(truoc + 1);
    } finally {
      await db.pool.query("GRANT USAGE ON LANGUAGE plpgsql TO PUBLIC");
    }
    const sau = await goi(gocK118, "/me", cookieMua);
    expect([sau.status, sau.log]).toEqual([200, []]);
  });

  it("⒣ [lượt soi 60a-1 ⑴] vai đăng nhập của pool mất membership app_api ⇒ SET ROLE của lần lấy client ném 42501 ⇒ /me và /guest/session ra 500, mỗi yêu cầu MỘT dòng log `error 42501` (trước khoản 118: 403 không log); cấp lại ⇒ 200", async () => {
    await db.pool.query("CREATE ROLE dang_nhap_118 LOGIN PASSWORD 'mk-118' IN ROLE app_api");
    const url = new URL(db.connectionString);
    url.username = "dang_nhap_118";
    url.password = "mk-118";
    const pool = createPool(url.toString(), 1, { role: "app_api" });
    canDong.push(() => pool.end());
    const goc = await dungServer(pool);
    const truoc = await goi(goc, "/me", cookieMua);
    expect([truoc.status, truoc.log]).toEqual([200, []]);
    await db.pool.query("REVOKE app_api FROM dang_nhap_118");
    try {
      for (const [duong, cookie] of [["/me", cookieMua], ["/guest/session", cookieKhach]] as const) {
        const r = await goi(goc, duong, cookie);
        expect(r.status, duong).toBe(500);
        expect(r.log, duong).toHaveLength(1);
        expect(r.log[0], duong).toContain("error 42501");
        expect(JSON.parse(r.body), duong).toEqual({ error: "loi noi bo" });
      }
    } finally {
      await db.pool.query("GRANT app_api TO dang_nhap_118");
    }
    const sau = await goi(goc, "/guest/session", cookieKhach);
    expect([sau.status, sau.log]).toEqual([200, []]);
  });

  it("⒤ [lượt soi 60a-1 ⑵, 60a-2] EXECUTE trên app_current_org_id() thu hồi ⇒ câu xác thực ném 42501 ⇒ /me và /guest/session ra 500 với MỘT dòng log `error 42501` — nhánh người mua không còn gói mọi lỗi thành 401 (trước khoản 118: người mua 401, khách 403, không log)", async () => {
    const HAM = "public.app_current_org_id()";
    const { rows: duocCap } = await db.pool.query<{ ten: string }>(
      "SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS ten " +
        "FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a " +
        "LEFT JOIN pg_roles r ON r.oid = a.grantee " +
        `WHERE p.oid = '${HAM}'::regprocedure AND a.privilege_type = 'EXECUTE'`,
    );
    expect(duocCap.length).toBeGreaterThan(0);
    const coQuyen = async (): Promise<boolean> =>
      (await db.pool.query<{ co: boolean }>(`SELECT has_function_privilege('app_api', '${HAM}', 'EXECUTE') AS co`)).rows[0]!.co;
    await db.pool.query(`REVOKE EXECUTE ON FUNCTION ${HAM} FROM PUBLIC, app_api`);
    try {
      expect(await coQuyen(), "fixture: app_api còn EXECUTE").toBe(false);
      for (const [duong, cookie] of [["/me", cookieMua], ["/guest/session", cookieKhach]] as const) {
        const r = await goi(gocK118, duong, cookie);
        expect(r.status, duong).toBe(500);
        expect(r.log, duong).toHaveLength(1);
        expect(r.log[0], duong).toContain("error 42501");
        expect(JSON.parse(r.body), duong).toEqual({ error: "loi noi bo" });
      }
    } finally {
      for (const { ten } of duocCap) await db.pool.query(`GRANT EXECUTE ON FUNCTION ${HAM} TO ${ten}`);
    }
    expect(await coQuyen()).toBe(true);
    const sau = await goi(gocK118, "/me", cookieMua);
    expect([sau.status, sau.log]).toEqual([200, []]);
  });

  it("⒥ handler để lại GUC ở phạm vi PHIÊN ⇒ yêu cầu vẫn 200 (đã commit), withTenant huỷ kết nối với SESSION_STATE_LEFT và bộ nghe `release` ghi MỘT dòng mang tên và mã, không giá trị; lần lấy client huỷ kết nối nhiễm bằng lỗi ĐÃ ném ⇒ bộ nghe không ghi thêm", async () => {
    const pool = poolMotKetNoi();
    ghiLogKetNoiHuy(pool, "pool");
    const goc = await dungServer(pool, [...ROUTES, ...tuyenK118()]);
    const r = await goi(goc, "/k118/mua/de-lai-phien", cookieMua);
    expect([r.status, r.log]).toEqual([200, ["[api] ket noi huy pool TenantError SESSION_STATE_LEFT"]]);
    const sau = await goi(goc, "/me", cookieMua);
    expect([sau.status, sau.log]).toEqual([200, []]);
    const c = await pool.connect();
    await c.query("SET row_security = off");
    c.release();
    const nhiem = await goi(goc, "/me", cookieMua);
    expect(nhiem.status).toBe(500);
    expect(nhiem.log).toHaveLength(1);
    expect(nhiem.log[0]).toContain("KetNoiNhiemError");
  });

  it("⒦ lỗi LỚP 23 ném ở câu xác thực — TRƯỚC khi handler chạy — là lỗi của khung: app_current_org_id() bị thay bằng một thân ném 23505 ⇒ /me ra 500 với MỘT dòng log `error 23505`, không phải 409", async () => {
    const HAM = "public.app_current_org_id()";
    const { rows } = await db.pool.query<{ d: string }>(`SELECT pg_get_functiondef('${HAM}'::regprocedure) AS d`);
    const dinhNghiaGoc = rows[0]!.d;
    await db.pool.query(
      `CREATE OR REPLACE FUNCTION ${HAM} RETURNS uuid LANGUAGE plpgsql STABLE AS $$BEGIN RAISE EXCEPTION 'k118' USING ERRCODE = '23505'; END$$`,
    );
    try {
      const r = await goi(gocK118, "/me", cookieMua);
      expect(r.status).toBe(500);
      expect(r.log).toHaveLength(1);
      expect(r.log[0]).toContain("error 23505");
      expect(JSON.parse(r.body)).toEqual({ error: "loi noi bo" });
    } finally {
      await db.pool.query(dinhNghiaGoc);
    }
    const sau = await goi(gocK118, "/me", cookieMua);
    expect([sau.status, sau.log]).toEqual([200, []]);
  });

  it("⒧ `SessionInvalidError` do HANDLER ném — một gói gọi resolveSessionActor khi phiên vừa bị thu hồi — vẫn là 401 không log", async () => {
    const r = await goi(gocK118, "/k118/mua/phien-hong", cookieMua);
    expect([r.status, r.log, JSON.parse(r.body)]).toEqual([401, [], { error: "phien khong hop le" }]);
  });

  it("⒨ `HttpError` do chính bộ điều phối ném giữ mã của nó, không log: route vô danh thiếu `orgId` ⇒ 422; tham số đường dẫn của route ghi không phải UUID ⇒ 404", async () => {
    const thieu = await goi(gocK118, "/k118/vo-danh/42501", "", { method: "POST", body: {} });
    expect([thieu.status, thieu.log]).toEqual([422, []]);
    const sai = await goi(gocK118, "/rfqs/khong-phai-uuid/approve", cookieMua, { method: "POST", body: {} });
    expect([sai.status, sai.log]).toEqual([404, []]);
  });

  it("⒩ việc SAU COMMIT hỏng ⇒ phản hồi không đổi (200) và MỘT dòng log `sau-commit` mang tên và SQLSTATE, không mang thông điệp (lượt soi 61a-2)", async () => {
    const r = await goi(gocK118, "/k118/mua/sau-commit", cookieMua);
    expect(r.status).toBe(200);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toContain("sau-commit error 08006");
    expect(r.log[0]).not.toContain("gia lap");
  });

  it("⒪ [lượt soi 61a-4] câu RIÊNG của withGuestSession — phép đọc lại ba GUC, trước handler — là lỗi của khung: app_current_guest_invitation_id() ném 42501 khi GUC phiên khách đã đặt ⇒ route đọc của khách ra 500 với MỘT dòng log `error 42501` và handler không chạy — dấu handler không bọc phần đầu callback của withGuestSession", async () => {
    const HAM = "public.app_current_guest_invitation_id()";
    const { rows } = await db.pool.query<{ d: string }>(`SELECT pg_get_functiondef('${HAM}'::regprocedure) AS d`);
    const dinhNghiaGoc = rows[0]!.d;
    await db.pool.query(
      `CREATE OR REPLACE FUNCTION ${HAM} RETURNS uuid LANGUAGE plpgsql STABLE AS $$BEGIN ` +
        "IF NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '') IS NOT NULL THEN " +
        "RAISE EXCEPTION 'k118' USING ERRCODE = '42501'; END IF; " +
        "RETURN NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '')::pg_catalog.uuid; END$$",
    );
    try {
      const truoc = soLanHandlerXong;
      const r = await goi(gocK118, "/k118/khach-doc/vo-hai", cookieKhach);
      expect(r.status).toBe(500);
      expect(r.log).toHaveLength(1);
      expect(r.log[0]).toContain("error 42501");
      expect(JSON.parse(r.body)).toEqual({ error: "loi noi bo" });
      expect(soLanHandlerXong, "handler không được chạy").toBe(truoc);
    } finally {
      await db.pool.query(dinhNghiaGoc);
    }
    const sau = await goi(gocK118, "/k118/khach-doc/vo-hai", cookieKhach);
    expect([sau.status, sau.log]).toEqual([200, []]);
  });
});

// ==============================================================================================
// [S1.68 / khoản 119] LẦN GHI SỔ CỦA MỘT LẦN TỪ CHỐI HỎNG ⇒ 500 VỚI MỘT DÒNG LOG MANG TÊN LỚP BỌC VÀ MÃ CỦA LỖI GỐC
//
// Đo trên master 749f925, trước bản vá, trigger chặn lần ghi `UNSEAL_DENIED`, `UNSEAL_APPROVAL_DENIED`, `MFA_RESET_APPROVAL_DENIED`: RAISE
// 23514 ⇒ 422 mang thông điệp của trigger và 0 dòng log; RAISE TP119 ⇒ 500 với `error TP119`; EXECUTE trên `audit_append` thu hồi ⇒ 403
// với `error 42501`. Không ca nào để lại hàng sổ. Và `PermissionAuditFailedError` của cổng quyền ở bộ điều phối chỉ ghi TÊN — không nói
// lần ghi hỏng vì sao. Bộ điều phối của describe này dùng `auditPool` RIÊNG, như composition root (lượt soi 62a-10).
// ==============================================================================================
describe("[INV-D5] [S1.68 / khoản 119] lần ghi sổ của một lần từ chối hỏng ⇒ 500 với MỘT dòng log `<lớp bọc> <- <lỗi gốc>` — không 403, không 422 mang thông điệp nội bộ", () => {
  interface NguoiK119 {
    readonly id: string;
    readonly cookie: string;
    readonly sessionId: string;
  }
  let gocK119: string;
  let pmK119: NguoiK119;
  let gdK119: NguoiK119;
  let chinhSachK119: string;

  async function nguoiK119(email: string, vaiTro: readonly string[]): Promise<NguoiK119> {
    const id = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'K119') RETURNING id", [orgA, email])).rows[0]!.id;
    for (const v of vaiTro) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, v]);
    const token = randomBytes(32).toString("base64url");
    const sessionId = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
        [orgA, id, createHash("sha256").update(token, "utf8").digest()],
      )
    ).rows[0]!.id;
    return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}`, sessionId };
  }

  /** RFQ dưới ngưỡng, đã CLOSED — điểm xuất phát hợp lệ của một yêu cầu mở thầu (cùng fixture với packages/unseal). */
  async function rfqDaDongK119(): Promise<string> {
    const nguoiTao = [pmK119.id, pmK119.sessionId] as const;
    const rfqId = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) VALUES ($1, 'K119', now() + interval '7 days', false, $2, $3) RETURNING id",
        [orgA, ...nguoiTao],
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep', '10.0000', 'tam', $3, $4)",
      [orgA, rfqId, ...nguoiTao],
    );
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
      [orgA, rfqId, chinhSachK119, ...nguoiTao],
    );
    await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfqId, ...nguoiTao]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
        [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), ...nguoiTao],
      );
      await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqId, ...nguoiTao]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som k119', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, ...nguoiTao],
    );
    return rfqId;
  }

  /** Yêu cầu mở thầu PENDING, không phê duyệt nào, do giám đốc tạo qua HTTP. */
  async function yeuCauMoThauK119(): Promise<string> {
    const rfqId = await rfqDaDongK119();
    const r = await goi(gocK119, `/rfqs/${rfqId}/unseal`, gdK119.cookie, { method: "POST", body: { reason: "den gio mo thau" } });
    expect(r.status, r.body).toBe(201);
    return (JSON.parse(r.body) as { unsealRequest: { id: string } }).unsealRequest.id;
  }

  async function demSoK119(action: string, resourceId: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3", [orgA, action, resourceId]);
    return Number(rows[0]?.n ?? "-1");
  }

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ, RAISE với `sqlstate`; mọi lần ghi khác đi qua. */
  async function voiGhiSoBiChanK119<T>(action: string, sqlstate: string, viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        `CREATE FUNCTION public.k119_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'k119 thong diep noi bo' USING ERRCODE = '${sqlstate}'; END$$`,
      );
      await db.pool.query(
        `CREATE TRIGGER k119_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = '${action}') EXECUTE FUNCTION public.k119_chan_ghi_so()`,
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k119_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k119_chan_ghi_so()");
    }
  }

  beforeAll(async () => {
    // [lượt soi 62a-10] `auditPool` RIÊNG, như composition root — `dungServer` mặc định dùng chung `apiPool` cho cả hai.
    const auditPoolK119 = db.poolAs("app_api");
    canDong.push(() => auditPoolK119.end());
    gocK119 = await dungServer(apiPool, undefined, auditPoolK119);
    pmK119 = await nguoiK119("pm-k119@vidu.vn", ["PROCUREMENT_MANAGER"]);
    gdK119 = await nguoiK119("gd-k119@vidu.vn", ["DIRECTOR"]);
    chinhSachK119 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
        [orgA, pmK119.id, pmK119.sessionId],
      )
    ).rows[0]!.id;
  });

  it("[INV-D5] ⒫ vế POLICY_GATE của cổng mở thầu, lần ghi `UNSEAL_DENIED` ném 23514 ⇒ 500 thân cố định với MỘT dòng log `DenialAuditFailedError <- error 23514`, không hàng sổ, không job (trước bản vá: 422 mang thông điệp nội bộ của lỗi, 0 dòng log); đối chứng không chặn ⇒ 422 không log, một hàng", async () => {
    const doiChung = await yeuCauMoThauK119();
    const dc = await goi(gocK119, `/unseal/${doiChung}/dispatch`, gdK119.cookie, { method: "POST" });
    expect([dc.status, dc.log]).toEqual([422, []]);
    expect(await demSoK119("UNSEAL_DENIED", doiChung)).toBe(1);

    const id = await yeuCauMoThauK119();
    const r = await voiGhiSoBiChanK119("UNSEAL_DENIED", "23514", () => goi(gocK119, `/unseal/${id}/dispatch`, gdK119.cookie, { method: "POST" }));
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: "loi noi bo" });
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} DenialAuditFailedError <- error 23514$/u);
    expect(await demSoK119("UNSEAL_DENIED", id)).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM outbox_jobs WHERE dedupe_key = $1", [`unseal:${id}`])).rows).toHaveLength(0);
  });

  it("[INV-D5] ⒬ lần THỬ tự phê duyệt mở thầu, lần ghi `UNSEAL_APPROVAL_DENIED` ném 42501 ⇒ 500 với MỘT dòng log `DenialAuditFailedError <- error 42501` (trước bản vá: 403 với `error 42501`), không hàng sổ", async () => {
    const id = await yeuCauMoThauK119();
    const r = await voiGhiSoBiChanK119("UNSEAL_APPROVAL_DENIED", "42501", () => goi(gocK119, `/unseal/${id}/approve`, gdK119.cookie, { method: "POST" }));
    expect([r.status, JSON.parse(r.body)]).toEqual([500, { error: "loi noi bo" }]);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} DenialAuditFailedError <- error 42501$/u);
    expect(await demSoK119("UNSEAL_APPROVAL_DENIED", id)).toBe(0);
  });

  it("[INV-D5] ⒭ lần THỬ tự duyệt đặt lại TOTP, lần ghi `MFA_RESET_APPROVAL_DENIED` ném TP119 ⇒ 500 với MỘT dòng log `DenialAuditFailedError <- error TP119` (trước bản vá: `error TP119` — không phân biệt được với một lỗi bất kỳ của handler), không hàng sổ", async () => {
    const nan = await nguoiK119(`nan-k119-${randomBytes(3).toString("hex")}@vidu.vn`, ["BUYER"]);
    const yc = await goi(gocK119, `/users/${nan.id}/mfa-reset`, pmK119.cookie, { method: "POST", body: { reason: "mat may" } });
    expect(yc.status, yc.body).toBe(201);
    const id = (JSON.parse(yc.body) as { mfaReset: { id: string } }).mfaReset.id;
    const r = await voiGhiSoBiChanK119("MFA_RESET_APPROVAL_DENIED", "TP119", () =>
      goi(gocK119, `/mfa-resets/${id}/approve`, pmK119.cookie, { method: "POST", body: {} }),
    );
    expect([r.status, JSON.parse(r.body)]).toEqual([500, { error: "loi noi bo" }]);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} DenialAuditFailedError <- error TP119$/u);
    expect(await demSoK119("MFA_RESET_APPROVAL_DENIED", id)).toBe(0);
  });

  it("[INV-D5] ⒮ `PermissionAuditFailedError` của cổng quyền ở bộ điều phối cũng nêu lỗi gốc: phiên không vai trò gọi một route ghi, lần ghi `PERMISSION_DENIED` ném 42501 ⇒ 500 với MỘT dòng log `PermissionAuditFailedError <- error 42501` (trước bản vá: chỉ tên lớp)", async () => {
    const khong = await nguoiK119(`khong-k119-${randomBytes(3).toString("hex")}@vidu.vn`, []);
    const r = await voiGhiSoBiChanK119("PERMISSION_DENIED", "42501", () =>
      goi(gocK119, "/suppliers", khong.cookie, { method: "POST", body: { legalName: "K119" } }),
    );
    expect([r.status, JSON.parse(r.body)]).toEqual([500, { error: "loi noi bo" }]);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} PermissionAuditFailedError <- error 42501$/u);
    // D5 thật, không chỉ dòng log (lượt soi 62a-7): lần từ chối không vào sổ, và thao tác bị từ chối không xảy ra.
    const { rows: soHang } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [orgA, khong.id],
    );
    expect(soHang[0]?.n).toBe("0");
    const { rows: ncc } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM suppliers WHERE org_id = $1 AND legal_name = 'K119'",
      [orgA],
    );
    expect(ncc[0]?.n).toBe("0");
  });
});

// ==============================================================================================
// [S1.69 / khoản 120] `auditPool` HẾT CHỖ KÉO DÀI ⇒ 500 VỚI MỘT DÒNG LOG PHÂN BIỆT ĐƯỢC VỚI `auditPool` SAI QUYỀN
//
// Đo trên b8d38c7, trước bản vá (biên bản §S1.69): `requirePermission` gãy NGAY khi `auditPool` không còn kết nối rảnh — phép chụp "pool còn
// chỗ" tức thì — và lỗi của phép chụp là một `Error` không tên, nên pool hết chỗ và `auditPool` chạy dưới siêu người dùng cho CÙNG dòng
// `PermissionAuditFailedError <- Error`. Sau bản vá lần ghi chờ kết nối tới trần; hết trần mới gãy, với `TenantError` CONNECT_WAIT_EXCEEDED.
// ==============================================================================================
describe("[INV-D5] [S1.69 / khoản 120] auditPool hết chỗ kéo dài ⇒ 500 với MỘT dòng log `PermissionAuditFailedError <- TenantError CONNECT_WAIT_EXCEEDED`", () => {
  async function phienKhongVaiTro(): Promise<{ readonly id: string; readonly cookie: string }> {
    const id = (
      await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'K120') RETURNING id", [
        orgA,
        `k120-${randomBytes(3).toString("hex")}@vidu.vn`,
      ])
    ).rows[0]!.id;
    const token = randomBytes(32).toString("base64url");
    await db.pool.query(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
      [orgA, id, createHash("sha256").update(token, "utf8").digest()],
    );
    return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}` };
  }

  async function demSoVaNcc(actorId: string, tenNcc: string): Promise<readonly [string, string]> {
    const { rows: so } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [orgA, actorId],
    );
    const { rows: ncc } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM suppliers WHERE org_id = $1 AND legal_name = $2", [
      orgA,
      tenNcc,
    ]);
    return [so[0]?.n ?? "?", ncc[0]?.n ?? "?"];
  }

  it("[INV-D5] ⒰ phiên không vai trò gọi route ghi khi `auditPool` hết chỗ suốt yêu cầu ⇒ 500 thân cố định với MỘT dòng `PermissionAuditFailedError <- TenantError CONNECT_WAIT_EXCEEDED`, không hàng sổ, không nhà cung cấp; đối chứng `auditPool` siêu người dùng vẫn cho `<- Error` (trước bản vá: cả hai cho `<- Error`)", async () => {
    const poolNho = db.poolAs("app_api");
    const giu: pg.PoolClient[] = [];
    try {
      for (let i = 0; i < poolNho.options.max; i += 1) giu.push(await poolNho.connect());
      const goc = await dungServer(apiPool, undefined, poolNho);
      const nguoi = await phienKhongVaiTro();
      // Chốt chặn giờ: một hồi quy làm lần lấy kết nối mất trần thì yêu cầu treo — test ĐỎ ở 12 s, và `finally` nhả kết nối cho yêu cầu ấy xong.
      const r = await Promise.race([
        goi(goc, "/suppliers", nguoi.cookie, { method: "POST", body: { legalName: "K120 HET CHO" } }),
        new Promise<PhanHoiCoLog>((xong) => {
          setTimeout(() => xong({ status: -1, body: "TREO_QUA_12_GIAY", log: [] }), 12000).unref();
        }),
      ]);
      expect(r.status, r.body).toBe(500);
      expect(JSON.parse(r.body)).toEqual({ error: "loi noi bo" });
      expect(r.log).toHaveLength(1);
      expect(r.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} PermissionAuditFailedError <- TenantError CONNECT_WAIT_EXCEEDED$/u);
      expect(await demSoVaNcc(nguoi.id, "K120 HET CHO")).toEqual(["0", "0"]);

      const gocSieu = await dungServer(apiPool, undefined, db.pool);
      const nguoiSieu = await phienKhongVaiTro();
      const rSieu = await goi(gocSieu, "/suppliers", nguoiSieu.cookie, { method: "POST", body: { legalName: "K120 SIEU" } });
      expect(rSieu.status).toBe(500);
      expect(rSieu.log).toHaveLength(1);
      expect(rSieu.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} PermissionAuditFailedError <- Error$/u);
    } finally {
      for (const c of giu) c.release();
      await poolNho.end();
    }
  }, 20000);
});
