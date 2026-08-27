import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

/**
 * Áp dụng các file .sql trong `dir` theo thứ tự tên, mỗi file trong một transaction riêng.
 * Migration đã áp dụng được ghi vào schema_migrations và không chạy lại.
 *
 * Cố ý dùng SQL thuần thay vì thư viện migration: lược đồ này phụ thuộc nặng vào RLS,
 * trigger và GRANT/REVOKE — những thứ cần đọc được nguyên văn khi kiểm toán.
 */
export async function migrate(pool: pg.Pool, dir: string): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
        file,
      ]);
      if (existing.rowCount === 0) {
        const sql = await readFile(join(dir, file), "utf8");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        applied.push(file);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} thất bại: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  return applied;
}
