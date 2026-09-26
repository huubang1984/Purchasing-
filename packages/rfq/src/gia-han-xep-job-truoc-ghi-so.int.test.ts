// =============================================================================================
// [S1.71 / khoản 123, lượt soi 65a-7] GIA HẠN RFQ XẾP JOB THÔNG BÁO TRƯỚC LẦN GHI SỔ — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// `extendRfqDeadline` xếp MỘT job cho MỖI lời mời, trong cùng giao dịch với lần ghi sổ `RFQ_DEADLINE_EXTENDED`. Lần ghi sổ đầu của giao
// dịch lấy khoá tư vấn ghi sổ của tổ chức (`noi_chuoi_kiem_toan()`, 004) và giữ nó tới COMMIT; từ S1.71 mọi lần ghi sổ khác của tổ chức
// chờ khoá ấy tối đa 2 s (050). Bản trước ghi sổ rồi mới xếp job, nên thời gian giữ khoá tăng theo số lời mời — đo trên tiến trình `api`
// thật: 50 / 200 / 400 lời mời giữ 21 / 104 / 225 ms (§S1.71). Test này đo thứ tự bằng chính khoá: mỗi lần `enqueueJob` được gọi, một
// kết nối khác đếm khoá tư vấn ghi sổ của tổ chức mà giao dịch gia hạn đang giữ.
//
// [lượt soi 65c-1] Test thứ hai: bản đầu của S1.71 đọc lời mời TRƯỚC lúc chờ khoá, nên một lời mời mà giao dịch tạo ra đã ghi sổ nhưng
// chỉ COMMIT trong lúc gia hạn chờ khoá thì không có job — bản trước ghi sổ rồi mới đọc nên có. Test giữ khoá ghi sổ của tổ chức trên một
// giao dịch đã INSERT lời mời thứ ba, đợi gia hạn chờ khoá, COMMIT, rồi đếm job.
//
// `vi.mock` bọc `enqueueJob` của `@trustprocure/outbox` — bản bọc gọi bản thật, chỉ đếm khi test bật cờ. Không nhãn INV.
// =============================================================================================

import {generateKeyPairSync, randomBytes} from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";
import { addRfqItem, createRfq, extendRfqDeadline, openRfq, submitRfqForApproval } from "./rfq.js";

const trangThai = vi.hoisted(() => ({
  dangDem: false,
  khoaKhiXep: [] as number[],
  demKhoa: undefined as undefined | (() => Promise<number>),
}));

vi.mock("@trustprocure/outbox", async (layGoc) => {
  const goc = await layGoc<typeof import("@trustprocure/outbox")>();
  return {
    ...goc,
    enqueueJob: async (...thamSo: Parameters<typeof goc.enqueueJob>) => {
      if (trangThai.dangDem && trangThai.demKhoa !== undefined) trangThai.khoaKhiXep.push(await trangThai.demKhoa());
      return goc.enqueueJob(...thamSo);
    },
  };
});

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const MAI_SAU_XA = new Date(Date.now() + 14 * 24 * 3600 * 1000);
const SO_LOI_MOI = 3;
const boBocGia = {
  // [ADR-062] Bộ sinh cặp khoá tổ chức của test: cặp P-256 thật, khoá riêng "bọc" bằng xor 0xff.
  name: "gia-cho-test-gia-han",
  generate: (orgId: string) => {
    const k = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return Promise.resolve({
      orgId,
      keyVersion: "test-v1",
      publicKey: k.publicKey.export({ format: "der", type: "spki" }),
      wrappedPrivateKey: new Uint8Array(k.privateKey.export({ format: "der", type: "pkcs8" })).map((b) => b ^ 0xff),
    });
  },
};

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA = "";
let u1 = "";
let s1 = "";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('K123 gia han', 'k123-gia-han') RETURNING id")).rows[0]!.id;
  u1 = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'pm-k123@vidu.vn', 'PM') RETURNING id", [orgA])).rows[0]!.id;
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER')", [orgA, u1]);
  s1 = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgA, u1, randomBytes(32)],
    )
  ).rows[0]!.id;
  apiPool = db.poolAs("app_api");
  await withTenant(apiPool, orgA, (c) =>
    createProcurementPolicy(c, orgA, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: s1 }),
  );
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.71 / khoản 123] gia hạn RFQ xếp job thông báo trước lần ghi sổ", () => {
  it("mỗi lần xếp job, giao dịch gia hạn CHƯA giữ khoá tư vấn ghi sổ của tổ chức; đủ một job mỗi lời mời và một bản ghi sau COMMIT", async () => {
    const rfqId = await withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, { title: "K123 gia han", deadlineAt: MAI_SAU, createdBySessionId: s1 });
      await setRfqBudget(c, orgA, { rfqId: r.id, estimatedValue: "1000000.00", currency: "VND", actorSessionId: s1 });
      await addRfqItem(c, orgA, { rfqId: r.id, lineNo: 1, description: "Thep", quantity: "1.0000", unit: "tam", actorSessionId: s1 });
      await submitRfqForApproval(c, orgA, { rfqId: r.id, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId: r.id, actorSessionId: s1, orgKeys: boBocGia }, apiPool);
      return r.id;
    });
    for (let i = 0; i < SO_LOI_MOI; i++) {
      const hex = randomBytes(4).toString("hex");
      const ncc = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
          [orgA, `NCC ${hex}`, u1, s1],
        )
      ).rows[0]!.id;
      const lh = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
            "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
          [orgA, ncc, `${hex}@vidu.vn`, u1, s1],
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6)",
        [orgA, rfqId, ncc, lh, u1, s1],
      );
    }

    trangThai.khoaKhiXep.length = 0;
    let khoaSauGhiSo = -1;
    await withTenant(apiPool, orgA, async (c) => {
      const pid = (await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const demKhoa = async (): Promise<number> =>
        (
          await db.pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted AND pid = $2 " +
              "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
              "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
            [orgA, pid],
          )
        ).rows[0]?.n ?? -1;
      trangThai.demKhoa = demKhoa;
      trangThai.dangDem = true;
      try {
        await extendRfqDeadline(c, orgA, { rfqId, newDeadlineAt: MAI_SAU_XA, reason: "nha cung cap xin them", actorSessionId: s1 });
      } finally {
        trangThai.dangDem = false;
      }
      // [lượt soi 65c-3] Đối chứng dương của phép dò: sau lần ghi sổ, chính giao dịch này giữ khoá — phép dò phải thấy nó. Không vế này
      // thì một phép dò hỏng (luôn ra 0) làm test xanh rỗng.
      khoaSauGhiSo = await demKhoa();
    });

    expect(khoaSauGhiSo, "đối chứng dương: phép dò không thấy khoá mà lần ghi sổ vừa lấy").toBe(1);
    expect(trangThai.khoaKhiXep, "giao dịch gia hạn đã giữ khoá ghi sổ của tổ chức trong lúc xếp job").toEqual(Array(SO_LOI_MOI).fill(0));
    const job = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM outbox_jobs WHERE org_id = $1 AND dedupe_key LIKE $2",
      [orgA, `deadline:${rfqId}:%`],
    );
    expect(job.rows[0]!.n).toBe(SO_LOI_MOI);
    const so = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'RFQ_DEADLINE_EXTENDED' AND resource_id = $2",
      [orgA, rfqId],
    );
    expect(so.rows[0]!.n).toBe(1);
  });

  it("lời mời COMMIT trong lúc gia hạn chờ khoá ghi sổ vẫn nhận job thông báo: gia hạn đọc lại lời mời sau lần ghi sổ", async () => {
    const rfqId = await withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, { title: "K123 gia han dong thoi", deadlineAt: MAI_SAU, createdBySessionId: s1 });
      await setRfqBudget(c, orgA, { rfqId: r.id, estimatedValue: "1000000.00", currency: "VND", actorSessionId: s1 });
      await addRfqItem(c, orgA, { rfqId: r.id, lineNo: 1, description: "Thep", quantity: "1.0000", unit: "tam", actorSessionId: s1 });
      await submitRfqForApproval(c, orgA, { rfqId: r.id, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId: r.id, actorSessionId: s1, orgKeys: boBocGia }, apiPool);
      return r.id;
    });
    const nhaCungCap = async (): Promise<{ ncc: string; lh: string }> => {
      const hex = randomBytes(4).toString("hex");
      const ncc = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
          [orgA, `NCC ${hex}`, u1, s1],
        )
      ).rows[0]!.id;
      const lh = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
            "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
          [orgA, ncc, `${hex}@vidu.vn`, u1, s1],
        )
      ).rows[0]!.id;
      return { ncc, lh };
    };
    const MOI =
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
      "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6)";
    for (let i = 0; i < 2; i++) {
      const { ncc, lh } = await nhaCungCap();
      await db.pool.query(MOI, [orgA, rfqId, ncc, lh, u1, s1]);
    }
    const thuBa = await nhaCungCap();

    // Giao dịch tạo lời mời thứ ba: INSERT rồi lấy khoá ghi sổ của tổ chức — đúng khoá mà lần ghi `INVITATION_CREATED` của
    // `createInvitation` lấy trong cùng giao dịch — và giữ tới COMMIT.
    const giu = await db.pool.connect();
    let dangGiu = false;
    let giaHan: Promise<unknown> | undefined;
    try {
      await giu.query("BEGIN");
      dangGiu = true;
      await giu.query(MOI, [orgA, rfqId, thuBa.ncc, thuBa.lh, u1, s1]);
      await giu.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgA]);
      giaHan = withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, { rfqId, newDeadlineAt: MAI_SAU_XA, reason: "gia han dong thoi", actorSessionId: s1 }),
      );
      // Đợi lần ghi sổ của gia hạn chờ khoá rồi COMMIT ngay — trần chờ của hàm nối chuỗi là 2 s (050).
      const han = Date.now() + 10_000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND NOT granted " +
            "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
            "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
          [orgA],
        );
        if ((rows[0]?.n ?? 0) >= 1) break;
        if (Date.now() > han) throw new Error("het 10000ms: lan ghi so cua gia han khong cho khoa");
        await new Promise((xong) => setTimeout(xong, 10));
      }
      await giu.query("COMMIT");
      dangGiu = false;
      await giaHan;
    } finally {
      if (dangGiu) await giu.query("ROLLBACK").catch(() => {});
      if (giaHan !== undefined) await Promise.allSettled([giaHan]);
      giu.release();
    }

    const job = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM outbox_jobs WHERE org_id = $1 AND dedupe_key LIKE $2",
      [orgA, `deadline:${rfqId}:%`],
    );
    expect(job.rows[0]!.n, "lời mời COMMIT trong lúc gia hạn chờ khoá không có job thông báo").toBe(3);
  });
});
