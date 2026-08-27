import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { migrate } from "@trustprocure/db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

// Danh sách đóng các DB role hợp lệ mà poolAs() được phép chuyển sang. Cố ý không cho
// nội suy chuỗi tuỳ ý vào "SET ROLE ..." — role không nằm trong danh sách này bị chặn ngay
// tại lời gọi, trước khi chạm tới Postgres.
const APP_ROLES = ["app_api", "app_unseal"] as const;
type AppRole = (typeof APP_ROLES)[number];

function laAppRoleHopLe(giaTri: string): giaTri is AppRole {
  return (APP_ROLES as readonly string[]).includes(giaTri);
}

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
      if (!laAppRoleHopLe(role)) {
        throw new Error(
          `poolAs: vai trò không hợp lệ "${role}" — chỉ chấp nhận ${APP_ROLES.join(" hoặc ")}.`,
        );
      }

      const rolePool = new pg.Pool({
        connectionString,
        max: 3,
        // pg-pool CHỜ hook này (await _promiseTry) trước khi giao client cho bất kỳ ai gọi
        // pool.connect()/pool.query() — xem pg-pool/index.js _afterConnect. Nếu hook ném lỗi,
        // pg-pool tự đóng client và trả lỗi đó về đúng lời gọi connect()/query() đang chờ.
        // Vì vậy KHÔNG được dùng "void client.query(...)" kiểu bắn-rồi-quên như bản trước:
        // nó vừa nuốt lỗi (unhandled rejection làm crash tiến trình), vừa để câu SET ROLE
        // chạy chồng lấn với câu lệnh thật của người gọi trên cùng một client.
        //
        // @types/pg khai onConnect là (client) => void vì nó không hỗ trợ TypeScript hoá
        // phần trả về bất đồng bộ, nhưng cài đặt runtime của pg-pool THẬT SỰ await hàm này
        // qua _promiseTry trước khi giao client cho ai (đã đọc source pg-pool@3.14.0 và đã
        // tự kiểm chứng bằng test packages/test-support/src/postgres.int.test.ts: lỗi ném
        // ra từ đây làm đúng connect()/query() đang chờ reject, không rơi thành unhandled
        // rejection). Vô hiệu hoá quy tắc lint đúng một dòng cho trường hợp đã kiểm chứng
        // an toàn này, không nới cho toàn file.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async onConnect(client: pg.ClientBase): Promise<void> {
          await client.query(`SET ROLE ${role}`);
          // Postgres tự hạ thường định danh không có dấu ngoặc kép, nên alias phải viết
          // sẵn chữ thường — viết hoa ở đây sẽ đọc ra "undefined" một cách âm thầm.
          const { rows } = await client.query<{ current_role_name: string }>(
            "SELECT current_user AS current_role_name",
          );
          if (rows[0]?.current_role_name !== role) {
            throw new Error(
              `poolAs("${role}"): SET ROLE không có hiệu lực — current_user vẫn là ` +
                `"${rows[0]?.current_role_name}". Không giao client này cho bất kỳ ai dùng.`,
            );
          }
        },
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
