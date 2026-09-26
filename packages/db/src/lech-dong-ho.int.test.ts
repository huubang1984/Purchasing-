// [khoản 196 / ADR-069 phần 1] Phép đo lệch đồng hồ trên PostgreSQL THẬT, dưới vai ứng dụng.
//
// Test thuần (`lech-dong-ho.test.ts`) đo số học của phép đo; tệp này đo rằng CÂU ĐỌC chạy được dưới
// `app_api` và `app_unseal` — hai vai của hai tiến trình gọi nó — và rằng một độ lệch thật đi qua
// phép đo thành đúng con số ấy. Đồng hồ CSDL không vặn được từ một test, nên độ lệch được dựng ở
// phía TIẾN TRÌNH: một đồng hồ tiêm chạy chậm hay nhanh đúng N ms so với `Date.now`.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { LechDongHoError, doLechDongHo, kiemLechDongHo } from "./lech-dong-ho.js";
import { migrate } from "./migrate.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
  // Hai vai ứng dụng chỉ tồn tại sau migration 001.
  await migrate(db.pool, MIGRATIONS_DIR);
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[khoản 196] lệch đồng hồ CSDL ↔ tiến trình, trên cụm thật", () => {
  it("dưới app_api và app_unseal: hai đồng hồ cùng máy lệch dưới ngưỡng mặc định, khứ hồi đo được", async () => {
    for (const vai of ["app_api", "app_unseal"] as const) {
      const pool = db.poolAs(vai);
      try {
        const p = await doLechDongHo(pool);
        expect(Math.abs(p.lechMs), vai).toBeLessThan(2000);
        expect(p.khuHoiMs, vai).toBeGreaterThanOrEqual(0);
      } finally {
        await pool.end();
      }
    }
  });

  it("đồng hồ tiến trình chậm 6 giờ 22 phút (cảnh 2026-09-20, đảo chiều) ⇒ LechDongHoError; lệch 1 giây ⇒ qua", async () => {
    const pool = db.poolAs("app_api");
    try {
      const sauGio = 6 * 3600_000 + 22 * 60_000;
      const loi = await kiemLechDongHo(pool, 2000, () => Date.now() - sauGio).catch((e: unknown) => e);
      expect(loi).toBeInstanceOf(LechDongHoError);
      expect(Math.abs((loi as LechDongHoError).lechMs - sauGio)).toBeLessThan(2000);
      const nguoc = await kiemLechDongHo(pool, 2000, () => Date.now() + 5000).catch((e: unknown) => e);
      expect((nguoc as LechDongHoError).lechMs).toBeLessThan(-3000);
      await expect(kiemLechDongHo(pool, 2000, () => Date.now() - 1000)).resolves.toMatchObject({});
    } finally {
      await pool.end();
    }
  });
});
