// ==============================================================================================
// [khoản 165] DẤU KIỂM VÒNG KHOÁ BỌC TRÊN POSTGRES THẬT — `062` + `doiChieuDauKiemVongKhoa`
//
// Đo bằng HAI vai ứng dụng thật (`app_api`, `app_unseal`), vì cả mệnh đề là *hai tiến trình khác vai
// gặp nhau ở một bảng*. Ca chịu lực là ca ĐỎ: worker dán nhầm một khoá khác dưới cùng tên phiên bản
// thì phép đối chiếu NÉM, gọi đúng tên phiên bản, và không in byte nào của khoá hay dấu.
// ==============================================================================================
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { DauKiemVongKhoaLechError, doiChieuDauKiemVongKhoa, tinhDauKiemKhoa } from "./dau-kiem-vong-khoa.js";
import { migrate } from "./migrate.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;

const K1 = Buffer.alloc(32, 0x11);
const K2 = Buffer.alloc(32, 0x22);
const SAI = Buffer.alloc(32, 0x99);

async function voi<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
}, 240000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[khoản 165] bên khởi động trước ghi, bên sau so", () => {
  it("api ghi trước; worker cùng khoá thì đi qua", async () => {
    await voi(apiPool, (c) => doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", { v1: K1 }));
    await voi(unsealPool, (c) => doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", { v1: K1 }));
    const { rows } = await db.pool.query<{ key_version: string; kcv: Buffer }>(
      "SELECT key_version, kcv FROM master_key_check_values ORDER BY key_version",
    );
    expect(rows.map((r) => r.key_version)).toEqual(["v1"]);
    expect(rows[0]!.kcv.equals(tinhDauKiemKhoa(K1))).toBe(true);
  });

  it("worker dán NHẦM khoá dưới cùng tên phiên bản ⇒ NÉM, gọi tên phiên bản, không in byte nào", async () => {
    const loi = await voi(unsealPool, (c) =>
      doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", { v1: SAI }).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect(loi).toBeInstanceOf(DauKiemVongKhoaLechError);
    const e = loi as DauKiemVongKhoaLechError;
    expect(e.phienBanLech).toEqual(["v1"]);
    for (const b of [SAI, K1, tinhDauKiemKhoa(SAI), tinhDauKiemKhoa(K1)]) {
      expect(e.message).not.toContain(b.toString("hex"));
      expect(e.message).not.toContain(b.toString("base64"));
    }
  });

  it("ĐỐI XỨNG: worker ghi trước một phiên bản mới; api giữ khoá khác cho phiên bản ấy thì api NÉM", async () => {
    await voi(unsealPool, (c) => doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", { v1: K1, v2: K2 }));
    const loi = await voi(apiPool, (c) =>
      doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", { v1: K1, v2: SAI }).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    expect((loi as DauKiemVongKhoaLechError).phienBanLech).toEqual(["v2"]);
  });

  it("chỉ-ghi-thêm: không vai ứng dụng nào UPDATE hay DELETE được dấu đã ghi", async () => {
    for (const p of [apiPool, unsealPool]) {
      for (const cau of [
        "UPDATE master_key_check_values SET kcv = kcv WHERE key_version = 'v1'",
        "DELETE FROM master_key_check_values WHERE key_version = 'v1'",
      ]) {
        const loi = await p.query(cau).then(
          () => null,
          (e: unknown) => e as { code?: string },
        );
        expect(loi?.code, cau).toBe("42501");
      }
    }
  });

  it("phiên KHÁCH thấy 0 hàng ⇒ phép đối chiếu NÉM chứ không đọc 0 hàng thành khớp", async () => {
    const loi = await voi(apiPool, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.guest_session_id', '00000000-0000-4000-8000-000000000165', true)");
        return await doiChieuDauKiemVongKhoa(c, "TRUSTPROCURE_MASTER_KEYS", { v1: K1 }).then(
          () => null,
          (e: unknown) => e,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(loi).not.toBeNull();
  });

  it("ĐỘT BIẾN: DISABLE RLS + DROP POLICY trên bảng dấu kiểm ⇒ migrate() kế tiếp DỰNG LẠI", async () => {
    await db.pool.query("ALTER TABLE master_key_check_values DISABLE ROW LEVEL SECURITY");
    await db.pool.query("DROP POLICY master_key_check_values_khach ON master_key_check_values");
    await migrate(db.pool, MIGRATIONS_DIR);
    const { rows } = await db.pool.query<{ rls: boolean; force: boolean; n: number }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'master_key_check_values_khach') AS n
         FROM pg_class c WHERE c.oid = 'public.master_key_check_values'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, force: true, n: 1 });
  });
});
