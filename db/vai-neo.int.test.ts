// ==============================================================================================
// [ADR-072 phần 1 / 065] VAI CỦA JOB NEO — `app_neo`: LIỆT KÊ được mọi tổ chức, chỉ ĐỌC được sổ.
//
// Đo trên CHÍNH đường sản xuất: role đăng nhập `app_neo_login` (như tools/chay-migrate dựng), pool
// `createPool(…, { role: "app_neo" })` (như tools/neo-so-kiem-toan), `withTenant` + hai hàm đọc của
// `packages/audit`. Superuser của container KHÔNG dùng để đo quyền — nó SET ROLE sang vai nào cũng được,
// nên một phép đo dưới nó nói đúng không gì về vai này.
//
// Ba nhóm khẳng định, mỗi nhóm một chiều của quyết định:
//   ⑴ LÀM ĐƯỢC — liệt kê mọi tổ chức qua `outbox_danh_sach_to_chuc()`; `exportChainHead` và
//      `verifyAuditChain` chạy trọn trong `withTenant`.
//   ⑵ KHÔNG LÀM ĐƯỢC — ghi sổ, đọc sổ của tổ chức khác, đọc bảng nghiệp vụ, chạm `app_private`, tạo
//      đối tượng; và `app_api` VẪN không liệt kê được tổ chức.
//   ⑶ TRÔI TỰ CHỮA — mọi hàng hardening mới cho `app_neo`/`app_neo_login` sửa được trôi của chính nó, và
//      `migrate()` chạy lại không đổi gì.
// ==============================================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportChainHead, appendAuditEvent, recordChainAnchor, verifyAuditChain } from "@trustprocure/audit";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docHangHardening } from "./hardening-hang.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(new URL("./migrations/hardening.always.sql", import.meta.url), "utf8");
const MAT_KHAU = "mk-neo-kiem-thu";

let db: TestDatabase;
let neoPool: pg.Pool;
let orgA: string;
let orgB: string;

function urlDangNhap(ten: string, matKhau: string): string {
  const u = new URL(db.connectionString);
  u.username = ten;
  u.password = matKhau;
  return u.toString();
}

/** SQLSTATE của một câu chạy dưới `app_neo`, gắn tổ chức A; `"OK"` nếu chạy được. Mỗi câu một giao dịch riêng. */
async function maLoiDuoiNeo(sql: string, org: string = orgA): Promise<string> {
  try {
    await withTenant(neoPool, org, (c) => c.query(sql));
    return "OK";
  } catch (e) {
    const ma = (e as { code?: unknown }).code;
    return typeof ma === "string" ? ma : `(${(e as Error).name}: ${(e as Error).message})`;
  }
}

async function taoToChuc(ten: string, soSuKien: number): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
    [ten],
  );
  const id = rows[0]!.id;
  const apiPool = db.poolAs("app_api");
  await withTenant(apiPool, id, async (c) => {
    for (let i = 0; i < soSuKien; i += 1) {
      await appendAuditEvent(c, id, { actorType: "USER", action: `E${i}`, resourceType: "TEST" });
    }
    await recordChainAnchor(c, id);
  });
  return id;
}

/** Tập sai của hardening về quyền quan hệ của app_neo — CHÍNH câu phán xét, chạy trên cùng CSDL. */
async function quyenNeoSai(): Promise<string[]> {
  const { rows } = await db.pool.query<{ mo_ta: string }>(docHangHardening(HARDENING, "CAU_QUYEN_NEO_SAI"));
  return rows.map((r) => r.mo_ta).sort();
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  await db.pool.query(`CREATE ROLE app_neo_login LOGIN PASSWORD '${MAT_KHAU}' IN ROLE app_neo`);
  neoPool = createPool(urlDangNhap("app_neo_login", MAT_KHAU), 2, { role: "app_neo" });
  orgA = await taoToChuc("neo-a", 3);
  orgB = await taoToChuc("neo-b", 5);
}, 240_000);

afterAll(async () => {
  await neoPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[ADR-072 phần 1] ⑴ app_neo LÀM ĐƯỢC đúng việc của job neo", () => {
  it("liệt kê MỌI tổ chức qua outbox_danh_sach_to_chuc() — ngoài withTenant, không gắn tổ chức nào", async () => {
    const { rows } = await neoPool.query<{ id: string }>(
      "SELECT t.id::pg_catalog.text AS id FROM public.outbox_danh_sach_to_chuc() AS t(id)",
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgA);
    expect(ids).toContain(orgB);
    // Đối chứng: đọc THẲNG bảng thì không — năng lực là của HÀM (chỉ trả id), không phải của vai.
    const c = await neoPool.connect();
    try {
      await expect(c.query("SELECT id FROM public.organizations")).rejects.toMatchObject({ code: "42501" });
    } finally {
      c.release();
    }
  });

  it("exportChainHead và verifyAuditChain chạy trọn trong withTenant, mỗi tổ chức ĐÚNG sổ của nó", async () => {
    const dauA = await withTenant(neoPool, orgA, (c) => exportChainHead(c, orgA));
    const dauB = await withTenant(neoPool, orgB, (c) => exportChainHead(c, orgB));
    expect(dauA?.seq).toBe(3);
    expect(dauB?.seq).toBe(5);
    const kq = await withTenant(neoPool, orgA, (c) => verifyAuditChain(c, orgA, { externalAnchors: [] }));
    expect(kq.checked).toBe(3);
    // Không mốc neo ngoài ⇒ NOT_ANCHORED, và CHỈ thế: băm tính lại được (EXECUTE audit_compute_hash), mốc neo
    // trong CSDL đọc được (SELECT ba cột của audit_chain_anchors) và khớp.
    expect(kq.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
  });

  it("policy của hai bảng sổ là PUBLIC-scoped (003) — nên cách ly tổ chức áp cho app_neo mà không cần dòng nào của 065", async () => {
    const { rows } = await db.pool.query<{ bang: string; vai: string[] }>(
      "SELECT c.relname AS bang, p.polroles::pg_catalog.regrole[]::text[] AS vai FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid " +
        "WHERE c.relname IN ('audit_events', 'audit_chain_anchors') AND c.relnamespace = 'public'::regnamespace ORDER BY 1, p.polname",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.vai, r.bang).toEqual(["-"]);
    const { rows: co } = await db.pool.query<{ rls: boolean; force: boolean; bypass: boolean }>(
      "SELECT bool_and(c.relrowsecurity) AS rls, bool_and(c.relforcerowsecurity) AS force, " +
        "(SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_neo') AS bypass " +
        "FROM pg_class c WHERE c.oid IN ('public.audit_events'::regclass, 'public.audit_chain_anchors'::regclass)",
    );
    expect(co[0]).toEqual({ rls: true, force: true, bypass: false });
  });
});

describe("[ADR-072 phần 1] ⑵ app_neo KHÔNG LÀM ĐƯỢC gì ngoài việc ấy", () => {
  it("đọc sổ của tổ chức KHÁC: 0 hàng dưới RLS, và hai hàm của packages/audit NÉM thay vì trả rỗng", async () => {
    const dem = await withTenant(neoPool, orgA, async (c) => {
      const { rows } = await c.query<{ cua_b: number; tong: number; neo_b: number }>(
        "SELECT (SELECT count(*)::int FROM public.audit_events WHERE org_id = $1::uuid) AS cua_b, " +
          "(SELECT count(*)::int FROM public.audit_events) AS tong, " +
          "(SELECT count(*)::int FROM public.audit_chain_anchors WHERE org_id = $1::uuid) AS neo_b",
        [orgB],
      );
      return rows[0];
    });
    expect(dem).toEqual({ cua_b: 0, tong: 3, neo_b: 0 });
    await expect(withTenant(neoPool, orgA, (c) => exportChainHead(c, orgB))).rejects.toThrow(/exportChainHead/u);
    await expect(
      withTenant(neoPool, orgA, (c) => verifyAuditChain(c, orgB, { externalAnchors: [] })),
    ).rejects.toThrow(/verifyAuditChain/u);
  });

  it("ghi sổ: INSERT/UPDATE/DELETE trên cả hai bảng, audit_append, và cột mốc neo ngoài ba cột đã cấp ⇒ 42501", async () => {
    const cau = [
      `INSERT INTO public.audit_events (org_id, actor_type, action, resource_type) VALUES ('${orgA}', 'USER', 'X', 'T')`,
      "UPDATE public.audit_events SET action = 'X'",
      "DELETE FROM public.audit_events",
      "TRUNCATE public.audit_events",
      `INSERT INTO public.audit_chain_anchors (org_id) VALUES ('${orgA}')`,
      "UPDATE public.audit_chain_anchors SET seq = seq",
      "DELETE FROM public.audit_chain_anchors",
      `SELECT * FROM public.audit_append('${orgA}', 'USER', NULL, 'X', 'T', NULL, '{}'::jsonb, NULL, NULL, NULL)`,
      "SELECT id FROM public.audit_chain_anchors",
      "SELECT anchored_at FROM public.audit_chain_anchors",
    ];
    for (const s of cau) expect(await maLoiDuoiNeo(s), s).toBe("42501");
    // Đối chứng: cùng đường, câu ĐỌC thì chạy — 42501 ở trên là của quyền, không phải của đường gọi.
    expect(await maLoiDuoiNeo("SELECT org_id, seq, hash FROM public.audit_chain_anchors")).toBe("OK");
  });

  it("bảng nghiệp vụ (giá thầu, RFQ, danh tính, khoá), app_private, và tạo đối tượng ⇒ 42501", async () => {
    for (const bang of [
      "vendor_bids", "vendor_bid_versions", "rfq_unsealed_bids", "rfq_packages", "rfq_items", "rfq_key_material",
      "org_key_pairs", "users", "sessions", "suppliers", "supplier_contacts", "organizations", "outbox_jobs",
      "mfa_credentials", "guest_sessions", "rfq_awards",
    ]) {
      expect(await maLoiDuoiNeo(`SELECT 1 FROM public.${bang} LIMIT 1`), bang).toBe("42501");
    }
    const { rows } = await db.pool.query<{ usage: boolean; create: boolean; tao_public: boolean }>(
      "SELECT has_schema_privilege('app_neo', 'app_private', 'USAGE') AS usage, " +
        "has_schema_privilege('app_neo', 'app_private', 'CREATE') AS create, " +
        "has_schema_privilege('app_neo', 'public', 'CREATE') AS tao_public",
    );
    expect(rows[0]).toEqual({ usage: false, create: false, tao_public: false });
    expect(await maLoiDuoiNeo("CREATE TABLE public.zz_neo (id int)")).toBe("42501");
    expect(await maLoiDuoiNeo("CREATE TEMP TABLE zz_neo (id int)")).toBe("42501");
    // Census của CHÍNH câu phán xét hardening: không thừa, không thiếu.
    expect(await quyenNeoSai()).toEqual([]);
  });

  it("app_api VẪN không liệt kê được tổ chức (ADR-040), và không SET ROLE sang app_neo được", async () => {
    const apiPool = db.poolAs("app_api");
    const c = await apiPool.connect();
    try {
      await expect(c.query("SELECT * FROM public.outbox_danh_sach_to_chuc()")).rejects.toMatchObject({ code: "42501" });
    } finally {
      c.release();
    }
    const { rows } = await db.pool.query<{ api_goi: boolean; neo_goi: boolean; unseal_goi: boolean; public_goi: boolean }>(
      "SELECT has_function_privilege('app_api', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS api_goi, " +
        "has_function_privilege('app_neo', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS neo_goi, " +
        "has_function_privilege('app_unseal', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS unseal_goi, " +
        "has_function_privilege('public', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS public_goi",
    );
    expect(rows[0]).toEqual({ api_goi: false, neo_goi: true, unseal_goi: true, public_goi: false });
    // Role đăng nhập của api KHÔNG là thành viên app_neo: một pool api đặt nhầm `role: "app_neo"` ném ở lần lấy đầu.
    await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api-neo' IN ROLE app_api");
    const nham = createPool(urlDangNhap("app_api_login", "mk-api-neo"), 1, { role: "app_neo" });
    try {
      await expect(nham.query("SELECT 1")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await nham.end();
      await db.pool.query("DROP ROLE app_api_login");
    }
  });
});

describe("[ADR-072 phần 1] ⑶ hardening canh app_neo/app_neo_login như hai cặp cũ — trôi TỰ CHỮA, chạy lại không đổi gì", () => {
  it("mười lăm trôi cùng lúc ⇒ lượt đầu dừng đòi kết nối mới, lượt kế sửa hết, giữ cặp hợp lệ, rồi chạy lại là no-op", async () => {
    const { rows: tenDb } = await db.pool.query<{ d: string }>("SELECT current_database() AS d");
    await db.pool.query(
      [
        "ALTER ROLE app_neo BYPASSRLS CREATEDB",
        "ALTER ROLE app_neo_login BYPASSRLS",
        "ALTER ROLE app_neo SET row_security = off",
        `ALTER ROLE app_neo_login IN DATABASE "${tenDb[0]!.d}" SET search_path = pg_catalog, public`,
        "GRANT app_api TO app_neo_login",
        "CREATE ROLE zz_ke_neo NOLOGIN",
        "GRANT app_neo TO zz_ke_neo",
        "GRANT INSERT (action) ON public.audit_events TO app_neo",
        "GRANT SELECT ON public.users TO app_neo",
        "GRANT SELECT ON public.audit_chain_anchors TO app_neo",
        "GRANT USAGE ON SCHEMA app_private TO app_neo",
        "GRANT CREATE ON SCHEMA public TO app_neo",
        "REVOKE EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() FROM app_neo",
        "GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_api",
        "REVOKE EXECUTE ON FUNCTION public.app_current_org_id() FROM app_neo",
        "REVOKE SELECT ON public.audit_events FROM app_neo",
      ].join("; "),
    );
    try {
      expect((await quyenNeoSai()).length, "đối chứng: câu phán xét THẤY trôi trước khi sửa").toBeGreaterThan(0);
      // Lượt ĐẦU dừng có chủ đích: hai GUC vận hành gắn ở mức vai của app_neo/app_neo_login được lượt sửa gỡ, và
      // migrate() đòi chạy lại trên kết nối MỚI (khoản 109) — bằng chứng `VAI_UNG_DUNG` của packages/db đã có app_neo.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).rejects.toThrow(/app_neo\.row_security.*app_neo_login\.search_path|app_neo_login\.search_path.*app_neo\.row_security/su);
      await migrate(db.pool, MIGRATIONS_DIR);

      const { rows: vai } = await db.pool.query<{ rolname: string; rolbypassrls: boolean; rolcreatedb: boolean; rolconfig: string[] | null }>(
        "SELECT rolname, rolbypassrls, rolcreatedb, rolconfig FROM pg_roles WHERE rolname IN ('app_neo', 'app_neo_login') ORDER BY 1",
      );
      expect(vai).toEqual([
        { rolname: "app_neo", rolbypassrls: false, rolcreatedb: false, rolconfig: null },
        { rolname: "app_neo_login", rolbypassrls: false, rolcreatedb: false, rolconfig: null },
      ]);
      const { rows: cauHinh } = await db.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname IN ('app_neo', 'app_neo_login')",
      );
      expect(cauHinh[0]!.n).toBe(0);
      const { rows: mem } = await db.pool.query<{ nhom: string; tv: string }>(
        "SELECT g.rolname AS nhom, m.rolname AS tv FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid " +
          "JOIN pg_roles m ON m.oid = am.member WHERE g.rolname LIKE 'app\\_neo%' OR m.rolname LIKE 'app\\_neo%' ORDER BY 1, 2",
      );
      expect(mem, "chỉ còn cặp hợp lệ").toEqual([{ nhom: "app_neo", tv: "app_neo_login" }]);
      expect(await quyenNeoSai()).toEqual([]);
      const { rows: q } = await db.pool.query<Record<string, boolean>>(
        "SELECT has_schema_privilege('app_neo', 'app_private', 'USAGE') AS private_usage, " +
          "has_schema_privilege('app_neo', 'public', 'CREATE') AS public_create, " +
          "has_function_privilege('app_neo', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS neo_liet_ke, " +
          "has_function_privilege('app_api', 'public.outbox_danh_sach_to_chuc()', 'EXECUTE') AS api_liet_ke, " +
          "has_function_privilege('app_neo', 'public.app_current_org_id()', 'EXECUTE') AS neo_org_id",
      );
      expect(q[0]).toEqual({ private_usage: false, public_create: false, neo_liet_ke: true, api_liet_ke: false, neo_org_id: true });

      // Đường sản xuất sống lại sau khi tự chữa (pool mới — kết nối cũ mang cấu hình phiên của lúc mở).
      const pool2 = createPool(urlDangNhap("app_neo_login", MAT_KHAU), 1, { role: "app_neo" });
      try {
        expect((await withTenant(pool2, orgB, (c) => exportChainHead(c, orgB)))?.seq).toBe(5);
      } finally {
        await pool2.end();
      }

      // Chạy lại: không migration nào áp, không trạng thái nào đổi.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await quyenNeoSai()).toEqual([]);
    } finally {
      await db.pool.query("DROP ROLE IF EXISTS zz_ke_neo");
    }
  }, 240_000);

  it("quyền đến qua PUBLIC thì KHÔNG tự thu hồi (chạm mọi vai của cụm) — deploy DỪNG, nêu đúng tên mục", async () => {
    await db.pool.query("GRANT SELECT ON public.suppliers TO PUBLIC");
    try {
      await expect(migrate(db.pool, MIGRATIONS_DIR)).rejects.toThrow(
        /quyền quan hệ của app_neo: .*public\.suppliers: THỪA SELECT/su,
      );
    } finally {
      await db.pool.query("REVOKE SELECT ON public.suppliers FROM PUBLIC");
    }
    await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
  }, 240_000);
});
