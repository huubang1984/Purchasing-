// ==============================================================================================
// [ADR-083] `doTonDong` TRÊN POSTGRESQL THẬT, DƯỚI VAI `app_unseal`, TRONG `withTenant`
//
// Vai là vai sẽ chạy: `apps/unseal-worker` gọi `doTonDong` trên pool `app_unseal` của nó. Nên
// test không dùng pool siêu người dùng cho phép đo — chỉ để GIEO hàng (vai ứng dụng không có
// INSERT trạng thái cuối, và đúng ra là không được có).
//
// Bốn điều phải đúng, mỗi điều một mũi:
//   ⑴ không job nào ⇒ 0 giây, 0 job;
//   ⑵ một job PENDING quá hạn ⇒ tuổi ≥ độ trễ của nó;
//   ⑶ DONE, FAILED, RUNNING và PENDING CHƯA tới hạn KHÔNG được đếm;
//   ⑷ cách ly tổ chức: đo tổ chức A không thấy hàng của B, kể cả khi hỏi thẳng id của B.
// ==============================================================================================

import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { doTonDong, type TonDong } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let unsealPool: pg.Pool;
let demToChuc = 0;

async function toChucMoi(): Promise<string> {
  demToChuc += 1;
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`To chuc ton dong ${demToChuc}`, `ton-dong-${demToChuc}`],
  );
  return rows[0]!.id;
}

/**
 * Gieo một hàng bằng phiên SIÊU NGƯỜI DÙNG. `lechGiay` âm = đã tới hạn từ ngần ấy giây trước;
 * dương = còn ngần ấy giây nữa mới tới hạn. Hai CHECK của bảng buộc `lease_expires_at` /
 * `finished_at` theo trạng thái, nên chúng được đặt cho khớp.
 */
async function gieo(org: string, status: "PENDING" | "RUNNING" | "DONE" | "FAILED", lechGiay: number): Promise<void> {
  await db.pool.query(
    `INSERT INTO outbox_jobs (org_id, kind, status, run_after, lease_expires_at, finished_at)
     VALUES ($1::uuid, 'THU_TON_DONG', $2::text,
             now() + make_interval(secs => $3::float8),
             CASE WHEN $2::text = 'RUNNING' THEN now() - interval '1 hour' END,
             CASE WHEN $2::text IN ('DONE', 'FAILED') THEN now() END)`,
    [org, status, lechGiay],
  );
}

function doDuoiVaiUnseal(org: string): Promise<TonDong> {
  return withTenant(unsealPool, org, (c) => doTonDong(c, org));
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  unsealPool = db.poolAs("app_unseal");
}, 180_000);

afterAll(async () => {
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[ADR-083] doTonDong — tồn đọng outbox của một tổ chức", () => {
  it("⑴ không job nào ⇒ 0 giây, 0 job", async () => {
    const org = await toChucMoi();
    await expect(doDuoiVaiUnseal(org)).resolves.toEqual({ giay: 0, soJob: 0 });
  });

  it("⑵ job PENDING quá hạn ⇒ tuổi ≥ độ trễ của job GIÀ NHẤT, số job đếm đủ", async () => {
    const org = await toChucMoi();
    await gieo(org, "PENDING", -600);
    await gieo(org, "PENDING", -30);
    const d = await doDuoiVaiUnseal(org);
    expect(d.soJob).toBe(2);
    expect(d.giay).toBeGreaterThanOrEqual(600);
    // Trần lỏng: bắt một đơn vị sai (ms thay giây) chứ không đo độ trễ của bộ chạy test.
    expect(d.giay).toBeLessThan(600 + 120);
    expect(Number.isInteger(d.giay)).toBe(true);
  });

  it("⑶ DONE, FAILED, RUNNING và PENDING chưa tới hạn KHÔNG được đếm", async () => {
    const org = await toChucMoi();
    await gieo(org, "DONE", -7200);
    await gieo(org, "FAILED", -7200);
    await gieo(org, "RUNNING", -7200);
    await gieo(org, "PENDING", 3600);
    await expect(doDuoiVaiUnseal(org)).resolves.toEqual({ giay: 0, soJob: 0 });
    // Đối chứng dương trên CÙNG tổ chức: thêm một job quá hạn thì nó — và chỉ nó — được thấy.
    await gieo(org, "PENDING", -90);
    const d = await doDuoiVaiUnseal(org);
    expect(d.soJob).toBe(1);
    expect(d.giay).toBeGreaterThanOrEqual(90);
    expect(d.giay).toBeLessThan(7200);
  });

  it("⑷ cách ly tổ chức: A không thấy hàng của B, kể cả khi hỏi thẳng id của B", async () => {
    const a = await toChucMoi();
    const b = await toChucMoi();
    await gieo(a, "PENDING", -100);
    await gieo(b, "PENDING", -5000);
    await gieo(b, "PENDING", -10);

    const doA = await doDuoiVaiUnseal(a);
    const doB = await doDuoiVaiUnseal(b);
    expect(doA.soJob).toBe(1);
    expect(doA.giay).toBeGreaterThanOrEqual(100);
    expect(doA.giay).toBeLessThan(5000);
    expect(doB.soJob).toBe(2);
    expect(doB.giay).toBeGreaterThanOrEqual(5000);

    // Vế phòng thủ `org_id = $1` và RLS cùng chặn: gắn tenant A mà hỏi về B thì 0 — RLS đã lọc
    // mọi hàng của B khỏi phiên, nên vị từ không còn gì để khớp.
    const cheo = await withTenant(unsealPool, a, (c) => doTonDong(c, b));
    expect(cheo).toEqual({ giay: 0, soJob: 0 });
    // Phép GỘP qua mọi tổ chức (MAX tuổi, TỔNG số job) là của worker, và đo trên dòng log thật ở
    // `apps/unseal-worker/src/tien-trinh.int.test.ts`.
  });
});
