import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { migrate } from "./migrate.js";

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
});

afterAll(async () => {
  await db?.stop();
});

function migrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tp-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe("bộ chạy migration", () => {
  it("áp dụng migration theo thứ tự tên file", async () => {
    const dir = migrationDir({
      "001_a.sql": "CREATE TABLE mig_a (id int PRIMARY KEY);",
      "002_b.sql": "CREATE TABLE mig_b (id int REFERENCES mig_a(id));",
    });
    expect(await migrate(db.pool, dir)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("bất biến — chạy lại không áp dụng lần hai", async () => {
    const dir = migrationDir({ "010_c.sql": "CREATE TABLE mig_c (id int);" });
    expect(await migrate(db.pool, dir)).toEqual(["010_c.sql"]);
    expect(await migrate(db.pool, dir)).toEqual([]);
  });

  it("migration lỗi thì rollback trọn vẹn và ném lỗi có tên file", async () => {
    const dir = migrationDir({
      "020_ok.sql": "CREATE TABLE mig_d (id int);",
      "021_hong.sql": "CREATE TABLE mig_e (id int); SELECT khong_ton_tai();",
    });
    await expect(migrate(db.pool, dir)).rejects.toThrow(/021_hong\.sql/);

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'mig_e'",
    );
    expect(rowCount).toBe(0);
  });
});
