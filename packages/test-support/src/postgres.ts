import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { migrate } from "@trustprocure/db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

export interface TestDatabase {
  readonly connectionString: string;
  readonly pool: pg.Pool;
  /** Pool mới chạy dưới một DB role khác — dùng để chứng minh RLS và GRANT chặn thật. */
  poolAs(role: string): pg.Pool;
  stop(): Promise<void>;
}

export async function startPostgres(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("trustprocure_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  const connectionString = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString, max: 5 });
  const rolePools: pg.Pool[] = [];

  return {
    connectionString,
    pool,
    poolAs(role: string): pg.Pool {
      const rolePool = new pg.Pool({ connectionString, max: 3 });
      // Mỗi kết nối mới chuyển sang role cần kiểm chứng ngay khi mở.
      rolePool.on("connect", (client: pg.PoolClient) => {
        void client.query(`SET ROLE ${role}`);
      });
      rolePools.push(rolePool);
      return rolePool;
    },
    async stop(): Promise<void> {
      await Promise.all(rolePools.map((p) => p.end()));
      await pool.end();
      await container.stop();
    },
  };
}

/** Khởi động Postgres, áp dụng toàn bộ migration thật của dự án, chạy `fn`, rồi dọn dẹp. */
export async function withMigratedDatabase(
  fn: (db: TestDatabase) => Promise<void>,
): Promise<void> {
  const db = await startPostgres();
  try {
    await migrate(db.pool, MIGRATIONS_DIR);
    await fn(db);
  } finally {
    await db.stop();
  }
}
