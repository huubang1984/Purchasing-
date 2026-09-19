// ==============================================================================================
// [S1.85 / khoản 131] MỘT LẦN TỪ CHỐI MẤT KHỎI SỔ PHẢI ĐỂ LẠI DÒNG LOG NÓI LẦN TỪ CHỐI NÀO.
//
// Khi khoá ghi sổ của một tổ chức bị giữ quá trần 2 s của `050`, MỌI lần ghi sổ của tổ chức ấy
// gãy `55P03` — kể cả lần ghi `PERMISSION_DENIED` của cổng quyền. Bất biến D5 vẫn đứng (thao tác
// bị từ chối, không hàng sổ, 500 ồn ào), nhưng thứ còn lại sau sự cố là dòng log, và tới trước
// vòng này dòng ấy KHÔNG nói lần từ chối nào đã mất.
//
// ĐO TRÊN HEAD TRƯỚC DÒNG MÃ ĐẦU TIÊN (§S1.85) — tiến trình `api` thật qua HTTP, `POST /suppliers`
// của một phiên KHÔNG vai trò, một giao dịch khác giữ khoá ghi sổ của tổ chức:
//
//     status=500 than={"error":"loi noi bo"} daCho=2052
//     [api] 9c5b2cd6-e418-40ed-aa1b-1cd28aee05de PermissionAuditFailedError <- error 55P03
//
// Tên lớp bọc và SQLSTATE của lần ghi — không `action`, không mã quyền, không `resourceType`,
// không mẫu route. Đúng như khoản 131 ghi từ S1.72.
//
// PHÉP ĐO NÀY LÀ CẢ HAI CHIỀU. Vế chính đòi các hằng đóng CÓ MẶT; vế đối chứng đòi dòng ấy KHÔNG
// mang một giá trị nào — id tổ chức, id người dùng, tên người gọi gửi lên. Thiếu vế sau thì
// "dòng log nói nhiều hơn" là một lời khen mà A2 phải trả giá.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** Tên người gọi gửi lên trong thân — một GIÁ TRỊ, và nó không được có mặt ở dòng log nào. */
const TEN_GUI_LEN = "Nha cung cap 4111-1111-1111-1111";

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;
const logLoi: string[] = [];

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Một phiên NGƯỜI MUA đã qua MFA nhưng KHÔNG có vai trò nào — mọi route ghi của nó là một lần từ chối. */
async function phienKhongVaiTro(): Promise<{ id: string; cookie: string }> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Khong vai tro') RETURNING id",
    [orgA, `k131-${randomBytes(4).toString("hex")}@vidu.vn`],
  );
  const id = rows[0]?.id ?? "";
  const token = randomBytes(32).toString("base64url");
  await db.pool.query(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
    [orgA, id, sha256(token)],
  );
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}` };
}

/** Khoá ghi sổ của tổ chức đang được MỘT giao dịch nào đó cầm? Cùng phép dò với `rbac.int.test.ts`. */
async function demKhoaGiuDuoc(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted " +
      "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [org],
  );
  return rows[0]?.n ?? -1;
}

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logLoi.push(args.map(String).join(" "));
  });
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA =
    (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]
      ?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[INV-D5] [INV-A2] [S1.85 / khoản 131] lần từ chối mất khỏi sổ vì trần 2 s", { timeout: 120_000 }, () => {
  it("khoá ghi sổ của tổ chức bị giữ ⇒ 500 sau ~2 s với MỘT dòng log mang mẫu route, `action`, `resourceType` và mã quyền — và KHÔNG một giá trị nào", async () => {
    const ai = await phienKhongVaiTro();
    const poolGiuKhoa = createPool(db.connectionString, 1, { role: "app_api" });
    let thaKhoa: () => void = () => {};
    const choTha = new Promise<void>((xong) => {
      thaKhoa = xong;
    });
    try {
      const giuKhoa = withTenant(poolGiuKhoa, orgA, async (c) => {
        await c.query("SELECT * FROM public.audit_append($1,'USER',NULL,'K131_GIU_KHOA','RFQ',NULL,'{}'::jsonb,NULL,NULL,NULL)", [orgA]);
        await choTha;
      });
      // Chờ tới khi khoá THẬT SỰ được cầm — không thì phép đo có thể chạy trước người giữ và
      // `POST /suppliers` đi qua bình thường, tức một test XANH không đo gì.
      const han = Date.now() + 5000;
      for (;;) {
        if ((await demKhoaGiuDuoc(orgA)) >= 1) break;
        if (Date.now() > han) throw new Error("het 5000ms ma khoa ghi so cua to chuc chua duoc cam");
        await new Promise<void>((xong) => setTimeout(xong, 20));
      }

      const truoc = logLoi.length;
      const batDau = Date.now();
      const res = await fetch(`${goc}/suppliers`, {
        method: "POST",
        headers: { cookie: ai.cookie, "content-type": "application/json" },
        body: JSON.stringify({ legalName: TEN_GUI_LEN }),
      });
      const daCho = Date.now() - batDau;
      const than = await res.text();
      thaKhoa();
      await giuKhoa;
      const moi = logLoi.slice(truoc);

      expect([res.status, JSON.parse(than)], than).toEqual([500, { error: "loi noi bo" }]);
      expect(daCho, "phải chờ tới trần 2 s của `050` rồi mới gãy 55P03").toBeGreaterThanOrEqual(1800);
      expect(moi, "một sự cố, một dòng").toHaveLength(1);
      expect(moi[0]).toMatch(
        /^\[api\] [0-9a-f-]{36} POST \/suppliers PermissionAuditFailedError PERMISSION_DENIED SUPPLIER supplier\.manage <- error 55P03$/u,
      );
      // ĐỐI CHỨNG A2 — dòng log giàu thêm mà không mang một giá trị nào.
      for (const gt of [orgA, ai.id, TEN_GUI_LEN, "4111"]) {
        expect(moi[0], `dòng log mang một GIÁ TRỊ: ${gt}`).not.toContain(gt);
      }
      // Và D5 thật, không chỉ dòng log: lần từ chối không vào sổ, thao tác không xảy ra.
      const { rows: so } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
        [orgA, ai.id],
      );
      expect(so[0]?.n).toBe("0");
      const { rows: ncc } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM suppliers WHERE org_id = $1 AND legal_name = $2",
        [orgA, TEN_GUI_LEN],
      );
      expect(ncc[0]?.n).toBe("0");
    } finally {
      thaKhoa();
      await poolGiuKhoa.end().catch(() => undefined);
    }
  });

  it("ĐỐI CHỨNG: không ai giữ khoá ⇒ cùng lời gọi ra 403 và MỘT hàng sổ, không dòng log — phép đo trên đo đúng ca `55P03`, không phải mọi lần từ chối", async () => {
    const ai = await phienKhongVaiTro();
    const truoc = logLoi.length;
    const res = await fetch(`${goc}/suppliers`, {
      method: "POST",
      headers: { cookie: ai.cookie, "content-type": "application/json" },
      body: JSON.stringify({ legalName: TEN_GUI_LEN }),
    });
    expect(res.status).toBe(403);
    expect(logLoi.slice(truoc)).toEqual([]);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [orgA, ai.id],
    );
    expect(rows[0]?.n).toBe("1");
  });
});
