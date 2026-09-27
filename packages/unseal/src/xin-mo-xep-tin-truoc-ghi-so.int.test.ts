// =============================================================================================
// [S1.9101 / khoản 200] XIN MỞ THẦU XẾP TIN BÁO NGƯỜI DUYỆT TRƯỚC LẦN GHI SỔ — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Cùng khuôn `packages/rfq/src/gia-han-xep-job-truoc-ghi-so.int.test.ts` (S1.71 / khoản 123), cho hàm thứ hai. Lần ghi sổ đầu của giao
// dịch lấy khoá tư vấn ghi sổ của tổ chức (`noi_chuoi_kiem_toan()`, 004) và giữ tới COMMIT; mọi lần ghi sổ khác của tổ chức chờ khoá ấy
// tối đa 2 s (050). Bản trước của `requestUnseal` ghi sổ `UNSEAL_REQUESTED` rồi mới chạy câu JOIN ba bảng tìm người duyệt và K lần
// `enqueueJob`. Test một đo thứ tự bằng chính khoá: mỗi lần `enqueueJob` được gọi, một kết nối khác đếm khoá mà giao dịch đang giữ.
//
// Test hai — bài học 65c-1 của S1.71: đọc người duyệt TRƯỚC lúc chờ khoá thì một lần cấp quyền đã ghi sổ nhưng chỉ COMMIT trong lúc chờ
// sẽ bị sót. Test giữ khoá ghi sổ của tổ chức trên một giao dịch đã cấp vai DIRECTOR cho người thứ ba, đợi `requestUnseal` chờ khoá,
// COMMIT, rồi đếm tin.
//
// `vi.mock` bọc `enqueueJob` của `@trustprocure/outbox` — bản bọc gọi bản thật, chỉ đếm khi test bật cờ. Không nhãn INV.
// =============================================================================================
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { requestUnseal } from "./index.js";

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
const KHOA_TO_CHUC =
  "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
  "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid";

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA = "";
let uYc = "";
let sYc = "";
let uD1 = "";
let sD1 = "";
let csA = "";

async function taoNguoi(email: string, vaiTro: string): Promise<string> {
  const id = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id", [orgA, email])
  ).rows[0]!.id;
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, vaiTro]);
  return id;
}

async function taoPhien(userId: string): Promise<string> {
  return (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
        "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgA, userId, randomBytes(32)],
    )
  ).rows[0]!.id;
}

/** RFQ đã CLOSED dưới ngưỡng — cùng đường dựng của `unseal.int.test.ts`. */
async function taoRfqDaDong(): Promise<string> {
  const rfqId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'K200 xin mo', $2, false, $3, $4) RETURNING id",
      [orgA, MAI_SAU, uYc, sYc],
    )
  ).rows[0]!.id;
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [orgA, rfqId, uYc, sYc],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgA, rfqId, csA, uYc, sYc],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  await db.pool.query("INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)", [
    orgA,
    rfqId,
    uD1,
    sD1,
  ]);
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), uYc, sYc],
    );
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [
      rfqId,
      uYc,
      sYc,
    ]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', " +
      "closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  return rfqId;
}

async function demTin(requestId: string): Promise<number> {
  return (
    await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_jobs WHERE org_id = $1 AND dedupe_key LIKE $2", [
      orgA,
      `unseal-notice:${requestId}:%`,
    ])
  ).rows[0]!.n;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('K200 xin mo', 'k200-xin-mo') RETURNING id"))
    .rows[0]!.id;
  uYc = await taoNguoi("yc-k200@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi("d1-k200@vidu.vn", "DIRECTOR");
  await taoNguoi("d2-k200@vidu.vn", "DIRECTOR");
  sYc = await taoPhien(uYc);
  sD1 = await taoPhien(uD1);
  csA = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
        "VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
      [orgA, uYc, sYc],
    )
  ).rows[0]!.id;
  apiPool = db.poolAs("app_api");
}, 180_000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.9101 / khoản 200] xin mở thầu xếp tin báo người duyệt trước lần ghi sổ", () => {
  it("mỗi lần xếp tin, giao dịch xin mở CHƯA giữ khoá tư vấn ghi sổ của tổ chức; đủ một tin mỗi người duyệt và một bản ghi sau COMMIT", async () => {
    const rfqId = await taoRfqDaDong();
    // Người duyệt hiện có: mọi người giữ `rfq.unseal.approve`, trừ chính người xin — đếm từ CSDL, không chép tay.
    const soNguoiDuyet = (
      await db.pool.query<{ n: number }>(
        "SELECT count(DISTINCT ur.user_id)::int AS n FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code " +
          "WHERE ur.org_id = $1 AND rp.permission_code = 'rfq.unseal.approve' AND ur.user_id <> $2",
        [orgA, uYc],
      )
    ).rows[0]!.n;
    expect(soNguoiDuyet, "tiền đề: phải có ít nhất hai người duyệt").toBeGreaterThanOrEqual(2);

    trangThai.khoaKhiXep.length = 0;
    let khoaSauGhiSo = -1;
    const yc = await withTenant(apiPool, orgA, async (c) => {
      const pid = (await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const demKhoa = async (): Promise<number> =>
        (
          await db.pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted AND pid = $2 ${KHOA_TO_CHUC}`,
            [orgA, pid],
          )
        ).rows[0]?.n ?? -1;
      trangThai.demKhoa = demKhoa;
      trangThai.dangDem = true;
      try {
        const r = await requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau", actorSessionId: sYc }, apiPool);
        // Đối chứng dương của phép dò: sau lần ghi sổ, chính giao dịch này giữ khoá — thiếu vế này, một phép dò hỏng (luôn ra 0) làm
        // test xanh rỗng.
        trangThai.dangDem = false;
        khoaSauGhiSo = await demKhoa();
        return r;
      } finally {
        trangThai.dangDem = false;
      }
    });

    expect(khoaSauGhiSo, "đối chứng dương: phép dò không thấy khoá mà lần ghi sổ vừa lấy").toBe(1);
    expect(trangThai.khoaKhiXep, "giao dịch xin mở đã giữ khoá ghi sổ của tổ chức trong lúc xếp tin").toEqual(Array(soNguoiDuyet).fill(0));
    expect(await demTin(yc.id)).toBe(soNguoiDuyet);
    const so = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_REQUESTED' AND resource_id = $2",
      [orgA, yc.id],
    );
    expect(so.rows[0]!.n).toBe(1);
  });

  it("người được cấp quyền duyệt COMMIT trong lúc xin mở chờ khoá ghi sổ vẫn nhận tin: xin mở đọc lại người duyệt sau lần ghi sổ", async () => {
    const rfqId = await taoRfqDaDong();
    const truoc = (
      await db.pool.query<{ n: number }>(
        "SELECT count(DISTINCT ur.user_id)::int AS n FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code " +
          "WHERE ur.org_id = $1 AND rp.permission_code = 'rfq.unseal.approve' AND ur.user_id <> $2",
        [orgA, uYc],
      )
    ).rows[0]!.n;
    const moi = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
        [orgA, `d-moi-${randomBytes(4).toString("hex")}@vidu.vn`],
      )
    ).rows[0]!.id;

    // Giao dịch cấp vai: INSERT rồi lấy khoá ghi sổ của tổ chức — đúng khoá mà lần ghi sổ của một lần cấp vai thật lấy trong cùng giao
    // dịch — và giữ tới COMMIT.
    const giu = await db.pool.connect();
    let dangGiu = false;
    let xinMo: Promise<{ id: string }> | undefined;
    try {
      await giu.query("BEGIN");
      dangGiu = true;
      await giu.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DIRECTOR')", [orgA, moi]);
      await giu.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgA]);
      xinMo = withTenant(apiPool, orgA, (c) =>
        requestUnseal(c, orgA, { rfqId, reason: "xin mo dong thoi", actorSessionId: sYc }, apiPool),
      );
      // Đợi lần ghi sổ của xin mở chờ khoá rồi COMMIT ngay — trần chờ của hàm nối chuỗi là 2 s (050).
      const han = Date.now() + 10_000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND NOT granted ${KHOA_TO_CHUC}`,
          [orgA],
        );
        if ((rows[0]?.n ?? 0) >= 1) break;
        if (Date.now() > han) throw new Error("het 10000ms: lan ghi so cua xin mo khong cho khoa");
        await new Promise((xong) => setTimeout(xong, 10));
      }
      await giu.query("COMMIT");
      dangGiu = false;
      const yc = await xinMo;
      expect(await demTin(yc.id), "người duyệt được cấp quyền trong lúc xin mở chờ khoá không có tin").toBe(truoc + 1);
    } finally {
      if (dangGiu) await giu.query("ROLLBACK").catch(() => {});
      if (xinMo !== undefined) await Promise.allSettled([xinMo]);
      giu.release();
    }
  });
});
