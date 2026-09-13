// =============================================================================================
// [S1.71 / khoản 123] TRẦN CHỜ KHOÁ GHI SỔ CỦA TỔ CHỨC — TỐI ĐA 2 s CHO MỌI LẦN GHI SỔ, ĐO TRÊN POSTGRES THẬT
//
// `public.noi_chuoi_kiem_toan()` mở đầu bằng `pg_advisory_xact_lock` theo tổ chức, và khoá ấy sống tới hết giao dịch. Khi một giao
// dịch giữ nó lâu — giao dịch treo, `app_api` bị chiếm —, mọi lần ghi sổ khác của tổ chức, trong giao dịch nghiệp vụ lẫn lần ghi sổ từ
// chối ở giao dịch độc lập, chờ tới `lock_timeout` / `statement_timeout` 15 s của `createPool` trong khi yêu cầu của nó giữ một kết nối
// nghiệp vụ, và yêu cầu của tổ chức KHÁC đứng theo khi pool cạn (đo trên tiến trình `api` thật: §S1.69, §S1.71). Chủ dự án chọn ngày
// 2026-09-14: trần 2 s
// cho MỌI lần ghi sổ chờ khoá ấy, đặt trên chính hàm nối chuỗi (`SET lock_timeout = '2s'` — migration 050, hardening mục (D1b)): nó áp
// cho mọi người gọi, chỉ sống trong lúc hàm chạy, và không thêm câu SQL nào vào đường ghi.
//
// [lượt soi 65a-8] Giao dịch của test chạy dưới vai `app_api` (pool `createPool` có vai), như tiến trình `api`; hai phép đọc/sửa catalog
// chạy dưới superuser của cụm test. Việc 050 và (D1b) mang cùng một giá trị do `db/tran-cho-khoa-ghi-so-dong-bo.test.ts` canh: đổi hay
// gỡ trần ở 050 thì lượt sửa của hardening sau vòng đánh số tạo lại hàm, nên không test nào dưới đây đỏ vì riêng việc ấy (đột biến M1,
// M4 — §S1.71); xoá hẳn tệp 050 thì ba danh sách migration của `db/migrations.int.test.ts` đỏ (lượt soi 65c-7).
//
// Không nhãn INV: đây là vách ngăn khả dụng giữa các tổ chức, không phải một vế của bất biến nào trong sổ đăng ký.
// =============================================================================================

import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const GHI_SO =
  "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, $2, 'K123', NULL, '{}'::jsonb, NULL, NULL, NULL)";
const PROCONFIG_NOI_CHUOI =
  "SELECT p.proconfig FROM pg_proc p WHERE p.oid = 'public.noi_chuoi_kiem_toan()'::regprocedure";

let db: TestDatabase;
/** Pool dựng bằng `createPool` với vai `app_api` và tuỳ chọn mặc định — `lock_timeout`, `statement_timeout` 15 s, như tiến trình `api`. */
let pool: pg.Pool;
let orgA = "";
let orgB = "";

/** Mở một giao dịch đã gắn tổ chức và ghi một sự kiện — giao dịch giữ khoá ghi sổ của tổ chức tới khi người gọi kết thúc nó. */
async function moGiaoDichDaGhiSo(org: string, hanhDong: string): Promise<pg.PoolClient> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.org_id', $1, true)", [org]);
    await c.query(GHI_SO, [org, hanhDong]);
    return c;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
    throw e;
  }
}

async function ketThuc(c: pg.PoolClient): Promise<void> {
  try {
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }
}

/** Chạy `viec`, trả mã lỗi PostgreSQL (hay null nếu thành công) và số mili-giây. */
async function doLoi(viec: () => Promise<unknown>): Promise<{ ma: string | null; thongDiep: string; ms: number }> {
  const batDau = Date.now();
  const loi = await viec().then(
    () => null,
    (e: unknown) => e as { code?: string; message?: string },
  );
  return { ma: loi === null ? null : (loi.code ?? "?"), thongDiep: loi?.message ?? "thành công", ms: Date.now() - batDau };
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('K123 A', 'k123-a'), ('K123 B', 'k123-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  pool = createPool(db.connectionString, 3, { role: "app_api" });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await db?.stop();
});

describe("[S1.71 / khoản 123] trần chờ khoá ghi sổ của tổ chức", () => {
  it("lần ghi sổ chờ khoá của tổ chức gãy với 55P03 ở trần 2 s, dù phiên mang lock_timeout 15 s của createPool", async () => {
    const giu = await moGiaoDichDaGhiSo(orgA, "GIU_KHOA");
    try {
      const nanNhan = await pool.connect();
      try {
        const { rows: guc } = await nanNhan.query<{ lock_timeout: string }>("SHOW lock_timeout");
        expect(guc[0]!.lock_timeout, "pool của test phải mang lock_timeout mặc định của createPool").toBe("15s");
        await nanNhan.query("BEGIN");
        await nanNhan.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
        const kq = await doLoi(() => nanNhan.query(GHI_SO, [orgA, "NAN_NHAN"]));
        await nanNhan.query("ROLLBACK");
        expect(kq.ma, `lần ghi sổ phải gãy vì chờ khoá, thực tế: ${kq.thongDiep}`).toBe("55P03");
        expect(kq.ms, "lần ghi sổ phải gãy ở trần của hàm, không chờ lock_timeout 15 s của phiên").toBeGreaterThanOrEqual(1_500);
        expect(kq.ms).toBeLessThan(4_000);
      } finally {
        nanNhan.release();
      }
    } finally {
      await ketThuc(giu);
    }
  }, 60_000);

  it("trần chỉ sống trong lúc hàm chạy: sau một lần ghi sổ, lock_timeout của giao dịch vẫn là giá trị phiên", async () => {
    const c = await moGiaoDichDaGhiSo(orgB, "KHONG_TRANH_CHAP");
    try {
      const { rows } = await c.query<{ lock_timeout: string }>("SHOW lock_timeout");
      expect(rows[0]!.lock_timeout).toBe("15s");
    } finally {
      await ketThuc(c);
    }
  });

  it("hàm ném 55P03 ở trần rồi người gọi bắt lỗi — ROLLBACK TO SAVEPOINT hay khối EXCEPTION — thì lock_timeout vẫn là giá trị phiên", async () => {
    // [lượt soi 65a-8 ⑵] PostgreSQL khôi phục biến của mệnh đề SET khi hàm ném, qua lần huỷ giao dịch con; vế này đo điều ấy ở hai
    // cách bắt lỗi mà mã ứng dụng có thể dùng.
    const giu = await moGiaoDichDaGhiSo(orgA, "GIU_KHOA_BAT_LOI");
    try {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
        await c.query("SAVEPOINT truoc_ghi_so");
        const kq = await doLoi(() => c.query(GHI_SO, [orgA, "NAN_NHAN_SAVEPOINT"]));
        expect(kq.ma, kq.thongDiep).toBe("55P03");
        // [lượt soi 65c-5] Cận hai phía như test đầu: gãy ở trần 2 s của hàm, không ở `lock_timeout` của phiên.
        expect(kq.ms, "lần ghi sổ sau SAVEPOINT phải gãy ở trần của hàm").toBeGreaterThanOrEqual(1_500);
        expect(kq.ms).toBeLessThan(4_000);
        await c.query("ROLLBACK TO SAVEPOINT truoc_ghi_so");
        const { rows: sauSavepoint } = await c.query<{ lock_timeout: string }>("SHOW lock_timeout");
        expect(sauSavepoint[0]!.lock_timeout, "sau ROLLBACK TO SAVEPOINT").toBe("15s");

        const batDau = Date.now();
        await c.query(
          "DO $bat$ BEGIN " +
            "PERFORM public.audit_append(pg_catalog.current_setting('app.org_id')::uuid, 'SYSTEM', NULL, 'NAN_NHAN_EXCEPTION', 'K123', " +
            "NULL, '{}'::jsonb, NULL, NULL, NULL); " +
            "EXCEPTION WHEN lock_not_available THEN NULL; END $bat$",
        );
        const msKhoiDo = Date.now() - batDau;
        expect(msKhoiDo, "khối EXCEPTION phải bắt đúng lần gãy ở trần").toBeGreaterThanOrEqual(1_500);
        expect(msKhoiDo).toBeLessThan(4_000);
        const { rows: sauException } = await c.query<{ lock_timeout: string }>("SHOW lock_timeout");
        expect(sauException[0]!.lock_timeout, "sau khối EXCEPTION bắt lock_not_available").toBe("15s");
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    } finally {
      await ketThuc(giu);
    }
  }, 60_000);

  it("khoá của tổ chức A bị giữ thì lần ghi sổ của tổ chức B xong ngay", async () => {
    const giu = await moGiaoDichDaGhiSo(orgA, "GIU_KHOA_A");
    try {
      const batDau = Date.now();
      const b = await moGiaoDichDaGhiSo(orgB, "GHI_B");
      const ms = Date.now() - batDau;
      await ketThuc(b);
      expect(ms).toBeLessThan(1_000);
    } finally {
      await ketThuc(giu);
    }
  });

  it("sau migrate(), hàm nối chuỗi mang lock_timeout=2s cạnh search_path trong proconfig", async () => {
    const { rows } = await db.pool.query<{ proconfig: string[] | null }>(PROCONFIG_NOI_CHUOI);
    expect(rows[0]!.proconfig).toEqual(["search_path=pg_catalog", "lock_timeout=2s"]);
  });

  it("gỡ lock_timeout khỏi hàm thì migrate() kế tự chữa (vai chạy migrate() sở hữu hàm)", async () => {
    await db.pool.query("ALTER FUNCTION public.noi_chuoi_kiem_toan() RESET lock_timeout");
    const { rows: truoc } = await db.pool.query<{ proconfig: string[] | null }>(PROCONFIG_NOI_CHUOI);
    expect(truoc[0]!.proconfig, "đối chứng: trần đã bị gỡ trước lần migrate()").toEqual(["search_path=pg_catalog"]);
    await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    const { rows: sau } = await db.pool.query<{ proconfig: string[] | null }>(PROCONFIG_NOI_CHUOI);
    expect(sau[0]!.proconfig).toEqual(["search_path=pg_catalog", "lock_timeout=2s"]);
  }, 180_000);
});
