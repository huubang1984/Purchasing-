import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

// Khoá advisory tuỳ ý nhưng cố định cho toàn dự án — chỉ dùng để loại trừ lẫn nhau giữa
// các tiến trình migrate() chạy đồng thời (vd. hai pod cùng khởi động, blue/green deploy).
// Không liên quan tới bất kỳ khoá nghiệp vụ nào khác nên chọn một số bất kỳ đủ lớn để
// tránh trùng ngẫu nhiên với khoá advisory khác mà hệ thống có thể dùng sau này.
const MIGRATION_LOCK_KEY = 727_100_003;

function tinhChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * Áp dụng các file .sql trong `dir` theo thứ tự tên, mỗi file trong một transaction riêng.
 * Migration đã áp dụng được ghi vào schema_migrations kèm checksum nội dung và không chạy
 * lại. Toàn bộ vòng lặp được bọc trong một advisory lock để hai tiến trình migrate() chạy
 * đồng thời trên cùng CSDL không giẫm lên nhau.
 *
 * Cố ý dùng SQL thuần thay vì thư viện migration: lược đồ này phụ thuộc nặng vào RLS,
 * trigger và GRANT/REVOKE — những thứ cần đọc được nguyên văn khi kiểm toán.
 */
export async function migrate(pool: pg.Pool, dir: string): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );

  const lockClient = await pool.connect();
  try {
    // pg_advisory_lock chặn tới khi có được khoá — tiến trình migrate() thứ hai chạy đồng
    // thời sẽ đợi ở đây thay vì đua vào cùng một transaction DDL với tiến trình thứ nhất.
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];

    for (const file of files) {
      const sql = await readFile(join(dir, file), "utf8");
      const checksum = tinhChecksum(sql);

      const existing = await pool.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (existing.rowCount !== 0) {
        if (existing.rows[0]?.checksum !== checksum) {
          // Bằng chứng kiểm toán chỉ có giá trị nếu file .sql trên đĩa luôn khớp cái đã
          // thật sự chạy trong DB. Lệch checksum là dấu hiệu ai đó sửa migration cũ sau
          // khi đã áp dụng — không được âm thầm bỏ qua.
          throw new Error(
            `Migration ${file} đã bị sửa nội dung sau khi áp dụng — checksum không khớp ` +
              `bản đã ghi (đã ghi: ${existing.rows[0]?.checksum}, hiện tại: ${checksum}). ` +
              "Không tạo migration mới thay vì sửa migration cũ đã chạy.",
          );
        }
        continue; // đã áp dụng, nội dung không đổi — bỏ qua
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
          file,
          checksum,
        ]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} thất bại: ${(error as Error).message}`, {
          cause: error,
        });
      } finally {
        client.release();
      }
    }

    return applied;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    lockClient.release();
  }
}
