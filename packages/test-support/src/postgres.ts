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

/**
 * Tái khẳng định role trên MỘT client cụ thể ngay trước khi giao cho người gọi, và ném lỗi
 * rõ ràng nếu SET ROLE không có hiệu lực thật.
 */
async function ganLaiRoleChoClient(client: pg.PoolClient, role: AppRole): Promise<void> {
  await client.query(`SET ROLE ${role}`);
  // Postgres tự hạ thường định danh không có dấu ngoặc kép, nên alias phải viết sẵn chữ
  // thường — viết hoa ở đây sẽ đọc ra "undefined" một cách âm thầm.
  const { rows } = await client.query<{ current_role_name: string }>(
    "SELECT current_user AS current_role_name",
  );
  if (rows[0]?.current_role_name !== role) {
    throw new Error(
      `poolAs("${role}"): SET ROLE không có hiệu lực — current_user vẫn là ` +
        `"${rows[0]?.current_role_name}". Không giao client này cho bất kỳ ai dùng.`,
    );
  }
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

      // Gán vào một const mới ngay sau khi type guard xác thực: TypeScript không giữ
      // narrowing của tham số hàm xuyên vào một function declaration lồng bên trong (khác với
      // arrow function/closure thường), nên phải "chốt" kiểu AppRole vào một binding mới.
      const vaiTroDaXacThuc: AppRole = role;
      const rolePool = new pg.Pool({ connectionString, max: 3 });

      // [fix C1 + I3] Không dùng "onConnect"/'connect' event của pg-pool: cả hai chỉ chạy
      // đúng MỘT LẦN khi mở kết nối VẬT LÝ mới (đã đọc source pg-pool@3.14.0:
      // "_afterConnect" chỉ gọi khi isNew=true), không chạy lại khi pool TÁI SỬ DỤNG một
      // client rảnh đã có sẵn. Hệ quả: một RESET ROLE/DISCARD ALL bất kỳ chạy trên client đó
      // (bởi bất kỳ ai, kể cả code khác dùng chung pool) sẽ đầu độc VĨNH VIỄN client đó trong
      // pool — lần lấy client sau sẽ âm thầm chạy dưới quyền cũ (postgres), khiến mọi khẳng
      // định "RLS chặn thật" phía sau chạy dưới quyền superuser và có thể xanh giả.
      //
      // Sửa bằng cách bọc connect() để MỌI lần lấy client — dù là kết nối mới hay client rảnh
      // được tái dùng — đều tái khẳng định role ngay trước khi giao cho người gọi. pool.query()
      // gọi connect() nội bộ (đã đọc source pg-pool: query() -> this.connect(...)), nên bọc
      // đúng một chỗ này là đủ cho cả hai cách dùng.
      const connectGoc = rolePool.connect.bind(rolePool);

      // pool.query() TỰ GỌI connect() ở dạng CALLBACK bên trong (đã đọc source pg-pool:
      // "query(text, values, cb) { ... this.connect((err, client) => {...}) }"), không phải
      // dạng Promise — nên bản bọc này PHẢI hỗ trợ cả hai kiểu gọi, nếu không mọi
      // pool.query() trên pool trả về từ poolAs() sẽ vỡ ngay (đã tự bắt được lỗi này khi
      // chạy test thật: ban đầu tôi chặn thẳng kiểu callback, làm chính pool.query() lỗi).
      function layVaGanLaiRole(): Promise<pg.PoolClient> {
        return connectGoc().then(async (client) => {
          try {
            await ganLaiRoleChoClient(client, vaiTroDaXacThuc);
          } catch (loi) {
            client.release(loi as Error);
            throw loi;
          }
          return client;
        });
      }

      rolePool.connect = ((
        goiLai?: (
          loi: Error | undefined,
          client: pg.PoolClient | undefined,
          xongViec: (giaiPhong?: Error | boolean) => void,
        ) => void,
      ) => {
        if (!goiLai) return layVaGanLaiRole();
        layVaGanLaiRole().then(
          (client) => goiLai(undefined, client, client.release.bind(client)),
          (loi: Error) => goiLai(loi, undefined, () => {}),
        );
        return undefined;
      }) as typeof rolePool.connect;

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
