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

async function dungServer(pool: pg.Pool, routes?: readonly Route[]): Promise<string> {
  const server = createApiServer(
    createDispatcher({ pool, auditPool: apiPool, services: dichVuTest().services, ...(routes === undefined ? {} : { routes }) }),
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
