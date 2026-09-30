// ==============================================================================================
// [S1.182 / ADR-111 / 075] VAI CỦA TASK KHỞI TẠO TỔ CHỨC — `app_khoi_tao`: tạo tổ chức, người dùng, gán vai, ghi sổ.
//
// Đo QUYỀN trên chính đường sản xuất: role đăng nhập `app_khoi_tao_login` (như tools/chay-migrate dựng), pool
// `createPool(…, { role: "app_khoi_tao" })` (như tools/khoi-tao-to-chuc), `withTenant` + `appendAuditEvent`. Superuser của
// container KHÔNG dùng để đo quyền — nó SET ROLE sang vai nào cũng được. **[lượt soi]** Câu GHI của nhóm ⑴ là `khoiTaoTran`,
// bản viết trần các câu của `tools/khoi-tao-to-chuc/src/khoi-tao.ts` (tệp này không nhập công cụ): nó đo rằng VAI làm được
// đúng những câu ấy. Hành vi của CHÍNH công cụ — hàng sổ, `resource_id`, thông điệp lỗi — đo ở `khoi-tao.int.test.ts` của nó.
//
// Ba nhóm khẳng định, mỗi nhóm một chiều của quyết định:
//   ⑴ LÀM ĐƯỢC — tạo một tổ chức mới cùng người dùng, vai và sổ trong MỘT giao dịch; thêm người vào tổ chức đã có sổ và
//      chuỗi sổ nối tiếp; hai trigger vai (D3 `005`, `033`) chạy được dưới vai này — và vẫn chặn.
//   ⑵ KHÔNG LÀM ĐƯỢC — đọc dữ liệu nghiệp vụ hay dữ liệu cá nhân, sửa hay xoá bất cứ gì, ghi `users.id`, chèn hàng của tổ
//      chức khác, liệt kê tổ chức, chạm `app_private`, tạo đối tượng; và `app_api` không SET ROLE sang nó được.
//   ⑶ TRÔI TỰ CHỮA — mọi hàng hardening mới cho `app_khoi_tao`/`app_khoi_tao_login` sửa được trôi của chính nó (**[lượt soi]**
//      mỗi hàng một trôi, kể cả hai chiều membership của role đăng nhập, NOLOGIN, và hai cấu hình phiên còn thiếu); quyền đến
//      qua PUBLIC thì deploy dừng, nêu đúng tên mục.
// ==============================================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendAuditEvent, verifyAuditChain } from "@trustprocure/audit";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docHangHardening } from "./hardening-hang.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(new URL("./migrations/hardening.always.sql", import.meta.url), "utf8");
const MAT_KHAU = "mk-khoi-tao-kiem-thu";

let db: TestDatabase;
let ktPool: pg.Pool;
let orgCo: string;

function urlDangNhap(ten: string, matKhau: string): string {
  const u = new URL(db.connectionString);
  u.username = ten;
  u.password = matKhau;
  return u.toString();
}

/** SQLSTATE của một câu chạy dưới `app_khoi_tao`, gắn `org`; `"OK"` nếu chạy được. Mỗi câu một giao dịch riêng. */
async function maLoiDuoiKhoiTao(sql: string, org: string = orgCo): Promise<string> {
  try {
    await withTenant(ktPool, org, (c) => c.query(sql));
    return "OK";
  } catch (e) {
    const ma = (e as { code?: unknown }).code;
    return typeof ma === "string" ? ma : `(${(e as Error).name}: ${(e as Error).message})`;
  }
}

/** Tập sai của hardening về quyền quan hệ của app_khoi_tao — CHÍNH câu phán xét, chạy trên cùng CSDL. */
async function quyenKhoiTaoSai(): Promise<string[]> {
  const { rows } = await db.pool.query<{ mo_ta: string }>(docHangHardening(HARDENING, "CAU_QUYEN_KHOI_TAO_SAI"));
  return rows.map((r) => r.mo_ta).sort();
}

/** Đường sản xuất của `tools/khoi-tao-to-chuc`, viết trần: tổ chức (nếu `ten`), một người, vai, sổ — một giao dịch. */
async function khoiTaoTran(pool: pg.Pool, org: string, tuyChon: { ten?: string; email: string; vai: readonly string[] }): Promise<string> {
  return withTenant(pool, org, async (c) => {
    if (tuyChon.ten !== undefined) {
      await c.query("INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)", [org, tuyChon.ten, `slug-${org.slice(0, 8)}`]);
      await appendAuditEvent(c, org, { actorType: "SYSTEM", action: "ORG_CREATED", resourceType: "organization", resourceId: org });
    }
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO public.users (org_id, email, full_name) VALUES ($1, pg_catalog.lower($2::text), 'Nguoi thu') RETURNING id",
      [org, tuyChon.email],
    );
    const u = rows[0]!.id;
    await appendAuditEvent(c, org, { actorType: "SYSTEM", action: "USER_CREATED", resourceType: "user", resourceId: u });
    await c.query("INSERT INTO public.user_roles (org_id, user_id, role_code) SELECT $1, $2, v FROM unnest($3::text[]) AS v", [org, u, [...tuyChon.vai]]);
    for (const v of tuyChon.vai) {
      await appendAuditEvent(c, org, { actorType: "SYSTEM", action: "ROLE_GRANTED", resourceType: "user", resourceId: u, payload: { roleCode: v } });
    }
    return u;
  });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  await db.pool.query(`CREATE ROLE app_khoi_tao_login LOGIN PASSWORD '${MAT_KHAU}' IN ROLE app_khoi_tao`);
  ktPool = createPool(urlDangNhap("app_khoi_tao_login", MAT_KHAU), 2, { role: "app_khoi_tao" });
  // Một tổ chức đã có sổ (do app_api ghi) — cho vế "thêm người nối tiếp chuỗi sổ" và cho các phép thử đọc/ghi.
  orgCo = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Da co', 'da-co') RETURNING id")).rows[0]!.id;
  await withTenant(db.poolAs("app_api"), orgCo, async (c) => {
    for (let i = 0; i < 3; i += 1) await appendAuditEvent(c, orgCo, { actorType: "USER", action: `E${String(i)}`, resourceType: "TEST" });
  });
}, 240_000);

afterAll(async () => {
  await ktPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.182 / ADR-111] ⑴ app_khoi_tao LÀM ĐƯỢC đúng việc của task khởi tạo", () => {
  it("tạo tổ chức MỚI, người dùng, vai và sổ trong MỘT giao dịch — sổ bắt đầu ở seq 1 và kiểm chứng được", async () => {
    const org = randomUUID();
    const u = await khoiTaoTran(ktPool, org, { ten: "To chuc moi", email: "Truong.Phong@Khach.vn", vai: ["PROCUREMENT_MANAGER", "TECHNICAL"] });
    const { rows } = await db.pool.query<{ ten: string; email: string; trang_thai: string; vai: string[] }>(
      "SELECT o.name AS ten, u.email, u.status AS trang_thai, array_agg(ur.role_code ORDER BY ur.role_code) AS vai " +
        "FROM organizations o JOIN users u ON u.org_id = o.id JOIN user_roles ur ON ur.user_id = u.id WHERE o.id = $1 GROUP BY 1, 2, 3",
      [org],
    );
    expect(rows).toEqual([{ ten: "To chuc moi", email: "truong.phong@khach.vn", trang_thai: "ACTIVE", vai: ["PROCUREMENT_MANAGER", "TECHNICAL"] }]);
    const { rows: so } = await db.pool.query<{ seq: string; action: string; actor_type: string; actor_id: string | null; resource_id: string }>(
      "SELECT seq::text, action, actor_type, actor_id, resource_id FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [org],
    );
    expect(so).toEqual([
      { seq: "1", action: "ORG_CREATED", actor_type: "SYSTEM", actor_id: null, resource_id: org },
      { seq: "2", action: "USER_CREATED", actor_type: "SYSTEM", actor_id: null, resource_id: u },
      { seq: "3", action: "ROLE_GRANTED", actor_type: "SYSTEM", actor_id: null, resource_id: u },
      { seq: "4", action: "ROLE_GRANTED", actor_type: "SYSTEM", actor_id: null, resource_id: u },
    ]);
    const kq = await withTenant(db.poolAs("app_api"), org, (c) => verifyAuditChain(c, org, { externalAnchors: [] }));
    expect(kq.checked).toBe(4);
    expect(kq.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
  });

  it("thêm người vào tổ chức ĐÃ CÓ sổ: chuỗi nối tiếp (seq 4, 5), kiểm chứng trọn", async () => {
    await khoiTaoTran(ktPool, orgCo, { email: "moi@da-co.vn", vai: ["FINANCE"] });
    const { rows } = await db.pool.query<{ seq: string; action: string }>("SELECT seq::text, action FROM audit_events WHERE org_id = $1 ORDER BY seq", [orgCo]);
    expect(rows.map((r) => `${r.seq}:${r.action}`)).toEqual(["1:E0", "2:E1", "3:E2", "4:USER_CREATED", "5:ROLE_GRANTED"]);
    const kq = await withTenant(db.poolAs("app_api"), orgCo, (c) => verifyAuditChain(c, orgCo, { externalAnchors: [] }));
    expect(kq.checked).toBe(5);
    expect(kq.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
  });

  it("hai trigger vai CHẠY dưới vai này và VẪN chặn: D3 (trọn chuỗi) và 033 (policy.manage cùng rfq.create) ⇒ 42501, rollback trọn", async () => {
    for (const vai of [
      // D3: PROCUREMENT_MANAGER có rfq.create, rfq.invite, rfq.unseal, award.recommend; DIRECTOR thêm po.approve — trọn chuỗi.
      // Không cặp nào của 033 (không ai giữ policy.manage), nên 42501 ở đây là của D3.
      ["PROCUREMENT_MANAGER", "DIRECTOR"],
      // 033: FINANCE giữ policy.manage, BUYER giữ rfq.create — và không ai giữ rfq.unseal, nên D3 không bắn.
      ["FINANCE", "BUYER"],
    ]) {
      const org = randomUUID();
      // [lượt soi] 42501 cũng là "permission denied" — khớp thêm thông điệp của CHÍNH trigger, không thì một GRANT thiếu cũng xanh.
      await expect(khoiTaoTran(ktPool, org, { ten: "Bi chan", email: "x@bi-chan.vn", vai })).rejects.toMatchObject({
        code: "42501",
        message: expect.stringMatching(vai.includes("DIRECTOR") ? /Phân tách nhiệm vụ \(D3\)/u : /\(D2, 033\)/u) as unknown,
      });
      const { rows } = await db.pool.query<{ n: number }>(
        "SELECT (SELECT count(*)::int FROM organizations WHERE id = $1) + (SELECT count(*)::int FROM audit_events WHERE org_id = $1) AS n",
        [org],
      );
      expect(rows[0]!.n, vai.join("+")).toBe(0);
    }
  });
});

describe("[S1.182 / ADR-111] ⑵ app_khoi_tao KHÔNG LÀM ĐƯỢC gì ngoài việc ấy", () => {
  it("đọc: bảng nghiệp vụ, email và họ tên người dùng, payload và người làm của sổ, danh mục tổ chức ⇒ 42501", async () => {
    for (const bang of [
      "vendor_bids", "vendor_bid_versions", "rfq_unsealed_bids", "rfq_packages", "rfq_items", "rfq_budgets", "rfq_key_material",
      "org_key_pairs", "sessions", "suppliers", "supplier_contacts", "organizations", "outbox_jobs", "mfa_credentials",
      "guest_sessions", "rfq_awards", "rfq_invitations", "audit_chain_anchors", "org_procurement_policies", "roles", "permissions",
    ]) {
      expect(await maLoiDuoiKhoiTao(`SELECT 1 FROM public.${bang} LIMIT 1`), bang).toBe("42501");
    }
    for (const cau of [
      "SELECT email FROM public.users",
      "SELECT full_name FROM public.users",
      "SELECT status FROM public.users",
      "SELECT granted_at FROM public.user_roles",
      "SELECT payload FROM public.audit_events",
      "SELECT actor_id FROM public.audit_events",
      "SELECT action FROM public.audit_events",
      "SELECT * FROM public.outbox_danh_sach_to_chuc()",
    ]) {
      expect(await maLoiDuoiKhoiTao(cau), cau).toBe("42501");
    }
    // Đối chứng: đúng những cột 075 cấp thì đọc được — 42501 ở trên là của quyền cột, không phải của đường gọi.
    expect(await maLoiDuoiKhoiTao("SELECT id FROM public.users")).toBe("OK");
    expect(await maLoiDuoiKhoiTao("SELECT org_id, seq, hash, prev_hash, occurred_at, id FROM public.audit_events")).toBe("OK");
    expect(await maLoiDuoiKhoiTao("SELECT role_code, permission_code FROM public.role_permissions")).toBe("OK");
  });

  it("sửa, xoá, ghi cột không cấp ⇒ 42501; chèn hàng của tổ chức KHÁC ⇒ RLS từ chối", async () => {
    const khac = randomUUID();
    for (const cau of [
      "UPDATE public.organizations SET name = 'x'",
      "UPDATE public.users SET status = 'DISABLED'",
      "UPDATE public.users SET email = 'x@x.vn'",
      "DELETE FROM public.users",
      "DELETE FROM public.user_roles",
      "UPDATE public.user_roles SET role_code = 'DIRECTOR'",
      "DELETE FROM public.audit_events",
      "UPDATE public.audit_events SET action = 'X'",
      "TRUNCATE public.audit_events",
      "UPDATE public.role_permissions SET role_code = role_code",
      // `users.id` không cấp — khuôn oracle `users_pkey` của 002; `status` không cấp — DEFAULT 'ACTIVE'.
      `INSERT INTO public.users (id, org_id, email, full_name) VALUES ('${randomUUID()}', '${orgCo}', 'a@b.vn', 'A')`,
      `INSERT INTO public.users (org_id, email, full_name, status) VALUES ('${orgCo}', 'a@b.vn', 'A', 'ACTIVE')`,
      // Ba cột chuỗi sổ do trigger dẫn xuất (004).
      `INSERT INTO public.audit_events (org_id, seq, actor_type, action, resource_type) VALUES ('${orgCo}', 99, 'SYSTEM', 'X', 'T')`,
      `INSERT INTO public.audit_chain_anchors (org_id) VALUES ('${orgCo}')`,
      `INSERT INTO public.rfq_packages (org_id, title, deadline_at) VALUES ('${orgCo}', 'x', now())`,
    ]) {
      expect(await maLoiDuoiKhoiTao(cau), cau).toBe("42501");
    }
    // Hàng mang tổ chức khác tổ chức đang gắn: vế WITH CHECK của 002/005/003 từ chối (42501 "new row violates RLS").
    expect(await maLoiDuoiKhoiTao(`INSERT INTO public.organizations (id, name, slug) VALUES ('${khac}', 'x', 'zz-khac')`)).toBe("42501");
    expect(await maLoiDuoiKhoiTao(`INSERT INTO public.users (org_id, email, full_name) VALUES ('${khac}', 'a@b.vn', 'A')`)).toBe("42501");
    expect(await maLoiDuoiKhoiTao(`SELECT * FROM public.audit_append('${khac}', 'SYSTEM', NULL, 'X', 'T', NULL, '{}'::jsonb, NULL, NULL, NULL)`)).toBe("42501");
  });

  it("app_private, tạo đối tượng, và census của CHÍNH câu phán xét hardening: không thừa, không thiếu", async () => {
    const { rows } = await db.pool.query<{ usage: boolean; create: boolean; tao_public: boolean }>(
      "SELECT has_schema_privilege('app_khoi_tao', 'app_private', 'USAGE') AS usage, " +
        "has_schema_privilege('app_khoi_tao', 'app_private', 'CREATE') AS create, " +
        "has_schema_privilege('app_khoi_tao', 'public', 'CREATE') AS tao_public",
    );
    expect(rows[0]).toEqual({ usage: false, create: false, tao_public: false });
    expect(await maLoiDuoiKhoiTao("CREATE TABLE public.zz_kt (id int)")).toBe("42501");
    expect(await maLoiDuoiKhoiTao("CREATE TEMP TABLE zz_kt (id int)")).toBe("42501");
    expect(await quyenKhoiTaoSai()).toEqual([]);
  });

  it("app_api không SET ROLE sang app_khoi_tao được, và vai này không có hàm liệt kê tổ chức", async () => {
    await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api-kt' IN ROLE app_api");
    const nham = createPool(urlDangNhap("app_api_login", "mk-api-kt"), 1, { role: "app_khoi_tao" });
    try {
      await expect(nham.query("SELECT 1")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await nham.end();
      await db.pool.query("DROP ROLE app_api_login");
    }
    const { rows } = await db.pool.query<{ liet_ke: boolean }>(
      "SELECT has_function_privilege('app_khoi_tao', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS liet_ke",
    );
    expect(rows[0]!.liet_ke).toBe(false);
  });
});

describe("[S1.182 / ADR-111] ⑶ hardening canh app_khoi_tao/app_khoi_tao_login như ba cặp kia — trôi TỰ CHỮA", () => {
  it("hai mươi bốn trôi cùng lúc — mỗi hàng hardening mới một trôi ⇒ lượt đầu dừng đòi kết nối mới, lượt kế sửa hết, giữ cặp hợp lệ, rồi chạy lại là no-op", async () => {
    const { rows: tenDb } = await db.pool.query<{ d: string }>("SELECT current_database() AS d");
    await db.pool.query(
      [
        "ALTER ROLE app_khoi_tao BYPASSRLS CREATEROLE",
        "ALTER ROLE app_khoi_tao_login BYPASSRLS",
        // [lượt soi] Vai NOLOGIN mà đăng nhập được là một cửa vào không qua role đăng nhập nào.
        "ALTER ROLE app_khoi_tao LOGIN",
        "ALTER ROLE app_khoi_tao SET row_security = off",
        `ALTER ROLE app_khoi_tao_login IN DATABASE "${tenDb[0]!.d}" SET search_path = pg_catalog, public`,
        // [lượt soi] Hai cấu hình còn lại của cặp: vai nhóm ở mức database, role đăng nhập ở mức vai.
        `ALTER ROLE app_khoi_tao IN DATABASE "${tenDb[0]!.d}" SET search_path = pg_catalog, public`,
        "ALTER ROLE app_khoi_tao_login SET search_path = pg_catalog, public",
        "GRANT app_api TO app_khoi_tao_login",
        // [lượt soi] Chiều (a) của vùng canh với một nhóm NGOÀI vùng: `GRANT app_api` ở trên bị bắt bằng chiều (b) vì `app_api`
        // nằm trong vùng — bỏ `app_khoi_tao_login` khỏi `ROLE_CANH` mà test vẫn xanh. `pg_read_all_data` cho role đăng nhập đọc
        // email mà không cần SET ROLE.
        "GRANT pg_read_all_data TO app_khoi_tao_login",
        "CREATE ROLE zz_ke_kt NOLOGIN",
        "GRANT app_khoi_tao TO zz_ke_kt",
        // [lượt soi] Chiều (b) của role đăng nhập: một vai khác thừa kế nó.
        "GRANT app_khoi_tao_login TO zz_ke_kt",
        // Thừa: đọc dữ liệu cá nhân, ghi `users.id`, sửa trạng thái, đọc payload sổ, xoá vai, một bảng nghiệp vụ.
        "GRANT SELECT (email) ON public.users TO app_khoi_tao",
        "GRANT INSERT (id) ON public.users TO app_khoi_tao",
        "GRANT UPDATE (status) ON public.users TO app_khoi_tao",
        "GRANT SELECT (payload) ON public.audit_events TO app_khoi_tao",
        "GRANT DELETE ON public.user_roles TO app_khoi_tao",
        "GRANT SELECT ON public.suppliers TO app_khoi_tao",
        // [lượt soi] Quyền nhận KÈM quyền cấp tiếp, và đã cấp tiếp cho một vai khác: tự chữa phải thu hồi theo dây (CASCADE).
        "GRANT SELECT (full_name) ON public.users TO app_khoi_tao WITH GRANT OPTION",
        "SET ROLE app_khoi_tao",
        "GRANT SELECT (full_name) ON public.users TO zz_ke_kt",
        "RESET ROLE",
        // [lượt soi] Hàm liệt kê MỌI tổ chức — SECURITY DEFINER ~~duy nhất~~ [S1.9165] đầu tiên của CSDL (hàm thứ hai,
        // `outbox_to_chuc_co_viec_api()`, chỉ cấp cho app_api — hardening canh app_khoi_tao KHÔNG); câu phán xét quyền quan hệ không thấy nó.
        "GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_khoi_tao",
        // Thiếu: slug, và cột `seq` mà trigger nối chuỗi đọc. (EXECUTE trên hai hàm sổ KHÔNG thử ở đây: PUBLIC có EXECUTE
        // trên cả hai — mặc định của PostgreSQL, 004 không thu hồi — nên thu hồi đích danh không làm vai "thiếu" theo quyền
        // HIỆU DỤNG, và câu phán xét đúng là không kêu.)
        "REVOKE INSERT (slug) ON public.organizations FROM app_khoi_tao",
        "REVOKE SELECT (seq) ON public.audit_events FROM app_khoi_tao",
        "GRANT USAGE ON SCHEMA app_private TO app_khoi_tao",
        "GRANT CREATE ON SCHEMA public TO app_khoi_tao",
        "REVOKE EXECUTE ON FUNCTION public.app_current_org_id() FROM app_khoi_tao",
      ].join("; "),
    );
    try {
      const truoc = await quyenKhoiTaoSai();
      expect(truoc, "đối chứng: câu phán xét THẤY cả thừa lẫn thiếu trước khi sửa").toEqual(
        expect.arrayContaining([
          "public.users.email: THỪA SELECT",
          "public.users.id: THỪA INSERT",
          "public.users.status: THỪA UPDATE",
          "public.audit_events.payload: THỪA SELECT",
          "public.user_roles: THỪA DELETE",
          "public.organizations.slug: THIẾU INSERT",
          "public.audit_events.seq: THIẾU SELECT",
          "public.suppliers.tax_code: THỪA SELECT",
        ]),
      );
      // Lượt ĐẦU dừng có chủ đích: GUC gắn ở mức vai được gỡ, và migrate() đòi chạy lại trên kết nối MỚI (khoản 109) —
      // bằng chứng `VAI_UNG_DUNG` của packages/db đã có app_khoi_tao.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).rejects.toThrow(
        /app_khoi_tao\.row_security.*app_khoi_tao_login\.search_path|app_khoi_tao_login\.search_path.*app_khoi_tao\.row_security/su,
      );
      await migrate(db.pool, MIGRATIONS_DIR);

      const { rows: vai } = await db.pool.query<{ rolname: string; rolbypassrls: boolean; rolcreaterole: boolean; rolcanlogin: boolean; rolconfig: string[] | null }>(
        "SELECT rolname, rolbypassrls, rolcreaterole, rolcanlogin, rolconfig FROM pg_roles WHERE rolname IN ('app_khoi_tao', 'app_khoi_tao_login') ORDER BY 1",
      );
      expect(vai).toEqual([
        { rolname: "app_khoi_tao", rolbypassrls: false, rolcreaterole: false, rolcanlogin: false, rolconfig: null },
        // Role đăng nhập GIỮ LOGIN — hardening không làm rớt đăng nhập của task (cùng lập luận với ba cặp kia).
        { rolname: "app_khoi_tao_login", rolbypassrls: false, rolcreaterole: false, rolcanlogin: true, rolconfig: null },
      ]);
      const { rows: cauHinh } = await db.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname IN ('app_khoi_tao', 'app_khoi_tao_login')",
      );
      expect(cauHinh[0]!.n).toBe(0);
      const { rows: mem } = await db.pool.query<{ nhom: string; tv: string }>(
        "SELECT g.rolname AS nhom, m.rolname AS tv FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid " +
          "JOIN pg_roles m ON m.oid = am.member WHERE g.rolname LIKE 'app\\_khoi\\_tao%' OR m.rolname LIKE 'app\\_khoi\\_tao%' ORDER BY 1, 2",
      );
      expect(mem, "chỉ còn cặp hợp lệ — gỡ cả pg_read_all_data của role đăng nhập (chiều a) lẫn zz_ke_kt thừa kế nó (chiều b)").toEqual([
        { nhom: "app_khoi_tao", tv: "app_khoi_tao_login" },
      ]);
      expect(await quyenKhoiTaoSai()).toEqual([]);
      const { rows: q } = await db.pool.query<Record<string, boolean>>(
        "SELECT has_schema_privilege('app_khoi_tao', 'app_private', 'USAGE') AS private_usage, " +
          "has_schema_privilege('app_khoi_tao', 'public', 'CREATE') AS public_create, " +
          "has_function_privilege('app_khoi_tao', 'public.app_current_org_id()', 'EXECUTE') AS org_id, " +
          "has_function_privilege('app_khoi_tao', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS liet_ke, " +
          "has_column_privilege('zz_ke_kt', 'public.users', 'full_name', 'SELECT') AS cap_tiep",
      );
      expect(q[0]).toEqual({ private_usage: false, public_create: false, org_id: true, liet_ke: false, cap_tiep: false });
      const { rows: lietKe } = await db.pool.query<Record<string, boolean>>(
        "SELECT has_function_privilege('app_unseal', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS unseal, " +
          "has_function_privilege('app_neo', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS neo",
      );
      expect(lietKe[0], "tự chữa không gỡ nhầm hai người gọi hợp lệ").toEqual({ unseal: true, neo: true });

      // Đường sản xuất sống lại sau khi tự chữa (pool mới — kết nối cũ mang cấu hình phiên của lúc mở).
      const pool2 = createPool(urlDangNhap("app_khoi_tao_login", MAT_KHAU), 1, { role: "app_khoi_tao" });
      try {
        await khoiTaoTran(pool2, randomUUID(), { ten: "Sau tu chua", email: "sau@tu-chua.vn", vai: ["BUYER"] });
      } finally {
        await pool2.end();
      }

      // Chạy lại: không migration nào áp, không trạng thái nào đổi.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await quyenKhoiTaoSai()).toEqual([]);
    } finally {
      await db.pool.query("DROP ROLE IF EXISTS zz_ke_kt");
    }
  }, 240_000);

  it("quyền đến qua PUBLIC thì KHÔNG tự thu hồi (chạm mọi vai của cụm) — deploy DỪNG, nêu đúng tên mục", async () => {
    await db.pool.query("GRANT SELECT (email) ON public.users TO PUBLIC");
    try {
      await expect(migrate(db.pool, MIGRATIONS_DIR)).rejects.toThrow(/quyền quan hệ của app_khoi_tao: .*public\.users\.email: THỪA SELECT/su);
    } finally {
      await db.pool.query("REVOKE SELECT (email) ON public.users FROM PUBLIC");
    }
    await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
  }, 240_000);
});
