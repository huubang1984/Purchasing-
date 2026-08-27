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

  // [fix S7 — checksum] Trước bản vá, sửa nội dung một file migration ĐÃ áp dụng thì lần
  // chạy sau âm thầm bỏ qua vĩnh viễn (chỉ so version, không so nội dung). Với hệ thống mà
  // mọi bảo đảm an ninh nằm trong file .sql để "đọc được nguyên văn khi kiểm toán", việc
  // file kiểm toán viên đọc khác hẳn cái đang chạy trong DB là lỗ hổng toàn vẹn bằng chứng.
  it("[fix S7] sửa nội dung migration đã áp dụng thì lần chạy sau báo lỗi rõ file nào lệch", async () => {
    const dir = migrationDir({ "040_ban_dau.sql": "CREATE TABLE mig_g (id int);" });
    expect(await migrate(db.pool, dir)).toEqual(["040_ban_dau.sql"]);

    writeFileSync(join(dir, "040_ban_dau.sql"), "CREATE TABLE mig_g (id int, ten text);");

    await expect(migrate(db.pool, dir)).rejects.toThrow(/040_ban_dau\.sql/);
  });

  // [fix S7 — advisory lock] Hai tiến trình migrate() song song trên cùng thư mục (blue/
  // green deploy, hai pod cùng khởi động) không được giẫm lên nhau: đúng một trong hai áp
  // dụng migration, cái còn lại thấy đã áp dụng rồi và trả về mảng rỗng — không lỗi, không
  // áp dụng trùng, không đua vào cùng một CREATE TABLE.
  it("[fix S7] hai lượt migrate() đồng thời trên cùng thư mục không lỗi và không áp dụng trùng", async () => {
    const dir = migrationDir({ "050_dong_thoi.sql": "CREATE TABLE mig_h (id int);" });

    const [ketQua1, ketQua2] = await Promise.all([migrate(db.pool, dir), migrate(db.pool, dir)]);

    expect([...ketQua1, ...ketQua2]).toEqual(["050_dong_thoi.sql"]);
  });
});
