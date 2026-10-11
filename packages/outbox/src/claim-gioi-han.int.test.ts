// ==============================================================================================
// [khoản 350] CÂU CLAIM TÔN TRỌNG `batchSize` DƯỚI KẾ HOẠCH LÀM LỘ LỖI
//
// Bản trước của `CAU_CLAIM` chọn lô bằng `j.id = ANY (SELECT … LIMIT $2 FOR UPDATE SKIP LOCKED)`: PostgreSQL chạy lại truy vấn con
// cho MỖI hàng ngoài của một Nested Loop Semi Join, hàng đầu đã bị chính câu UPDATE sửa nên bị bỏ qua ở lần chạy lại, và lần chạy
// lại trả hàng kế tiếp — `LIMIT` mất tác dụng. Kế hoạch ấy là kế hoạch của một bảng `outbox_jobs` nhỏ khi hàng ngoài nằm theo đúng
// thứ tự `ORDER BY`, và planner chọn nó THEO THỐNG KÊ: quét đo dưới vai `app_api`, bốn job, `LIMIT 1` (2026-10-10) — nền 0 hàng có
// `ANALYZE` ⇒ giành 4, không ⇒ 1; nền 200 hàng không `ANALYZE` ⇒ 4, có ⇒ 1; nền 2 000 ⇒ 1 (dưới siêu người dùng: 4, 4, 4, 4, 1).
// Nên lỗi lộ ra thưa. Tệp này dựng ĐÚNG cảnh lộ lỗi trên một cụm mới: bốn job của một tổ chức, xếp lần lượt, đã COMMIT, rồi `ANALYZE`.
//
// ĐỐI CHỨNG DƯƠNG trước: bản câu cũ, chép nguyên văn, chạy trên CHÍNH fixture này (vai `app_api`, giao dịch cuộn lại) phải giành
// NHIỀU HƠN `LIMIT` — không thế thì fixture không dựng được kế hoạch làm lộ lỗi, và ca của runner bên dưới xanh mà không đo gì.
// Rồi runner thật, `batchSize` 1 rồi 2, phải giành ĐÚNG chừng ấy job.
// ==============================================================================================
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { JobRunner, enqueueJob, type OutboxJob } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** Bản `CAU_CLAIM` TRƯỚC khoản 350, nguyên văn (runner.ts ở master `74a18d3f`). Chỉ dùng làm đối chứng dương. */
const CAU_CLAIM_CU = `
  UPDATE public.outbox_jobs AS j
     SET status = 'RUNNING',
         attempts = j.attempts OPERATOR(pg_catalog.+) 1,
         lease_expires_at = pg_catalog.clock_timestamp()
             OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $3::pg_catalog.float8)
   WHERE j.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND j.kind OPERATOR(pg_catalog.=) ANY ($4::pg_catalog.text[])
     AND j.id OPERATOR(pg_catalog.=) ANY (
           SELECT s.id
             FROM public.outbox_jobs s
            WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
              AND s.kind OPERATOR(pg_catalog.=) ANY ($4::pg_catalog.text[])
              AND ((s.status OPERATOR(pg_catalog.=) 'PENDING'::pg_catalog.text
                    AND s.run_after OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp())
                OR (s.status OPERATOR(pg_catalog.=) 'RUNNING'::pg_catalog.text
                    AND s.lease_expires_at OPERATOR(pg_catalog.<) pg_catalog.clock_timestamp()))
            ORDER BY s.run_after, s.id
            LIMIT $2::pg_catalog.int4
            FOR UPDATE SKIP LOCKED)
  RETURNING j.id`;

const KIND = "LOGIN_LINK_SEND";
const SO_JOB = 4;

let db: TestDatabase;
let apiPool: pg.Pool;
let org: string;
let demToChuc = 0;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** Mỗi ca một tổ chức mới với `SO_JOB` job đã COMMIT, xếp lần lượt — `run_after` tăng theo thứ tự chèn. */
beforeEach(async () => {
  demToChuc += 1;
  org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [`Claim ${String(demToChuc)}`, `claim-${String(demToChuc)}`])).rows[0]!.id;
  for (let i = 0; i < SO_JOB; i += 1) {
    await withTenant(apiPool, org, (c) => enqueueJob(c, org, { kind: KIND, payload: { thu: i } }));
  }
  // Thống kê mới cho đúng hình dạng này — thiếu nó, kế hoạch dưới `app_api` không lộ lỗi (khối đầu tệp).
  await db.pool.query("ANALYZE public.outbox_jobs");
});

async function demTheoTrangThai(): Promise<Record<string, number>> {
  const { rows } = await db.pool.query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM outbox_jobs WHERE org_id = $1 GROUP BY status ORDER BY status",
    [org],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

describe("[khoản 350] câu claim tôn trọng batchSize", () => {
  it("ĐỐI CHỨNG DƯƠNG: trên fixture này, bản câu CŨ với LIMIT 1 giành NHIỀU HƠN một job (vai app_api, giao dịch cuộn lại)", async () => {
    const c = await apiPool.connect();
    let gianh: number | null = null;
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
      gianh = (await c.query(CAU_CLAIM_CU, [org, 1, 60, [KIND]])).rowCount;
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    expect(gianh, "fixture không dựng được kế hoạch làm lộ lỗi — các ca dưới đây không đo gì").toBeGreaterThan(1);
    expect(await demTheoTrangThai(), "giao dịch đối chứng đã cuộn lại").toEqual({ PENDING: SO_JOB });
  });

  it.each([1, 2])("runner với batchSize %i giành và xử lý ĐÚNG chừng ấy job — phần còn lại vẫn PENDING, chưa tốn lượt thử", async (lo) => {
    const daXuLy: string[] = [];
    const runner = new JobRunner(
      apiPool,
      {
        [KIND]: (job: OutboxJob) => {
          daXuLy.push(job.id);
          return Promise.resolve();
        },
      },
      { listOrganizations: () => [org], batchSize: lo },
    );
    expect(await runner.runOnceForOrg(org)).toBe(lo);
    expect(daXuLy).toHaveLength(lo);
    expect(await demTheoTrangThai()).toEqual({ DONE: lo, PENDING: SO_JOB - lo });
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_jobs WHERE org_id = $1 AND status = 'PENDING' AND attempts <> 0", [org]);
    expect(rows[0]?.n, "job chưa tới lượt không được tốn lượt thử").toBe(0);
  });
});
