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

// ==============================================================================================
// [khoản nợ 28] CHỖ 57P01 ĐƯỢC ĐO, THAY VÌ ĐƯỢC SỬA MÙ
//
// Lượt CI `33862719087` đỏ job T3 với `terminating connection due to administrator command`
// (`57P01`) và **không một `expect` nào đỏ**: một kết nối gộp còn sống lúc container Postgres bị
// đóng. Cùng lượt ấy trên commit trước thì xanh. Khoản nợ 28 ghi rõ cách đóng đúng là *"mỗi bộ
// test tích hợp phải đóng pool TRƯỚC khi dừng container, và điều đó phải được ĐO chứ không được
// sửa mù"* — vì nới một `setTimeout` cho tới lúc hết đỏ là đúng thứ biến một phép đo thành một
// lời khai.
//
// Đây là phép đo ấy, và nó đứng ở ĐÚNG một chỗ: khoảnh khắc ngay trước `container.stop()`.
// `stop()` đã tự đóng `pool` và mọi pool của `poolAs()`; thứ nó KHÔNG biết là những pool mà một
// bộ test tự `new pg.Pool(...)` (có thật: `migrate.int.test.ts` dựng bảy cái). Sau khi phần của
// mình đã đóng xong, hỏi thẳng `pg_stat_activity`: còn backend khách nào bám vào cluster không.
//
// BA QUYẾT ĐỊNH ĐÃ CÂN, GHI RA ĐỂ KHÔNG AI PHẢI ĐOÁN LẠI:
//
//   ⑴ CÓ một cửa sổ chờ, và nó KHÔNG phải cách nới ngưỡng. `pool.end()` trả về khi client đã
//     được yêu cầu đóng; backend phía Postgres thoát sau đó vài mili-giây. Cửa sổ này đo cái
//     ĐÃ ĐÓNG-nhưng-chưa-thoát, nên nó hội tụ về 0 gần như tức thì ở ca lành. Một rò rỉ THẬT —
//     pool bị bỏ quên — giữ client của nó tới `idleTimeoutMillis` (mặc định 10 giây của `pg`),
//     nên hạn 3 giây ở đây phân biệt được hai ca. Đúng bài học đã ghi ở đầu
//     `migrate.int.test.ts`: thứ mua được sự tất định là VÒNG CHỜ, và nói cho đúng thì khẳng
//     định này bắt được rò rỉ SỐNG LÂU HƠN 3 giây, không phải mọi rò rỉ.
//
//   ⑵ Nó KHÔNG chặn `container.stop()`. Một khẳng định làm rò rỉ container Testcontainers thật
//     là một khẳng định tệ hơn thứ nó canh — cùng bài học đã ghi ở khối `[fix Minor]` bên dưới.
//     Verdict được giữ lại, container dừng, rồi mới ném.
//
//   ⑶ [CẤM LOG] Thông điệp KHÔNG mang cột `query`. Câu lệnh của một backend còn sống có thể
//     đang mang giá, bản rõ báo giá, hay `token_hash` — và một thông điệp lỗi đi thẳng vào log
//     CI công khai. Chỉ `pid`, `datname`, `state`, `application_name` được nêu: đủ để tìm ra
//     bộ test nào rò rỉ, không đủ để lộ thứ nó đang chạy.
// ==============================================================================================

/** Hạn chờ backend khách thoát hẳn. Xem quyết định ⑴ ở khối trên: 3s < `idleTimeoutMillis` 10s. */
const HAN_CHO_KET_NOI_THOAT_MS = 3_000;

interface BackendConLai {
  readonly pid: number;
  readonly datname: string | null;
  readonly state: string | null;
  readonly application_name: string | null;
}

/**
 * Chờ mọi backend KHÁCH ngoài chính kết nối này thoát, rồi trả về danh sách còn sót.
 *
 * Rỗng = không ai còn bám vào cluster lúc container bị dừng. Không rỗng = một bộ test đã dựng
 * pool riêng và quên đóng, và `57P01` của khoản nợ 28 sắp xảy ra lần nữa.
 */
async function chuoBackendKhachThoat(connectionString: string): Promise<BackendConLai[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const hetHan = Date.now() + HAN_CHO_KET_NOI_THOAT_MS;
    for (;;) {
      // `backend_type = 'client backend'` loại autovacuum/walwriter/checkpointer ra — chúng là
      // của chính Postgres và không bao giờ là thứ một bộ test rò rỉ.
      const { rows } = await client.query<BackendConLai>(
        "SELECT pid, datname, state, application_name FROM pg_stat_activity " +
          " WHERE pid <> pg_backend_pid() AND backend_type = 'client backend'",
      );
      if (rows.length === 0 || Date.now() >= hetHan) return rows;
      await new Promise((giaiQuyet) => setTimeout(giaiQuyet, 25));
    }
  } finally {
    await client.end().catch(() => {});
  }
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
      // [fix Minor] "Promise.all" + "await pool.end()" trần: nếu người gọi đã tự end() một
      // rolePool trước đó (hợp lệ, không cấm), p.end() ở đây ném "Called end on pool more
      // than once" — Promise.all reject NGAY, và "container.stop()" phía dưới KHÔNG BAO GIỜ
      // CHẠY, rò rỉ container Testcontainers thật. Đã tự vấp phải khi viết test cho chính lỗi
      // này. Dùng allSettled/catch để một pool lỗi khi đóng không cản các bước dọn dẹp còn
      // lại — container luôn phải dừng dù bước nào trước đó thất bại.
      await Promise.allSettled(rolePools.map((p) => p.end()));
      await pool.end().catch(() => {});

      // [khoản nợ 28] Đo TRƯỚC khi dừng container — xem khối lý do phía trên file. Bản thân
      // phép đo không được phép làm hỏng việc dọn dẹp: nếu nó không hỏi được (container đã
      // chết, mạng docker đứt), coi như không có gì để nói, vì lúc ấy cũng chẳng còn kết nối
      // nào để rò rỉ.
      let conSot: BackendConLai[] = [];
      try {
        conSot = await chuoBackendKhachThoat(connectionString);
      } catch {
        conSot = [];
      }

      await container.stop();

      if (conSot.length > 0) {
        const moTa = conSot
          .map((b) => `pid=${b.pid} db=${b.datname ?? "?"} state=${b.state ?? "?"} app=${b.application_name ?? "?"}`)
          .join("; ");
        throw new Error(
          `[khoản nợ 28] Bộ test này dừng container khi còn ${conSot.length} kết nối khách sống ` +
            `sau ${HAN_CHO_KET_NOI_THOAT_MS}ms chờ. Đó chính là nguồn của \`57P01\` ` +
            `("terminating connection due to administrator command") — một lỗi làm JOB đỏ mà ` +
            `KHÔNG một \`expect\` nào đỏ, nên nó không tìm được bằng cách đọc kết quả test. ` +
            `Cách sửa: \`await pool.end()\` mọi pool bộ test TỰ dựng, trong \`finally\` hoặc ` +
            `\`afterAll\`, TRƯỚC khi \`db.stop()\` chạy. Backend còn sót: ${moTa}`,
        );
      }
    },
  };
}

/** Khởi động Postgres, áp dụng toàn bộ migration thật của dự án, chạy `fn`, rồi dọn dẹp. */
export async function withMigratedDatabase(
  fn: (db: TestDatabase) => Promise<void>,
): Promise<void> {
  const db = await startPostgres();
  // [khoản nợ 28] `finally { await db.stop() }` trần KHÔNG dùng được nữa: `stop()` nay có thể
  // ném vì rò rỉ kết nối, và một lần ném trong `finally` NUỐT lỗi gốc của thân hàm — tức phép
  // đo mới sẽ che mất đúng thứ bộ test đang tìm. Lỗi của thân hàm luôn thắng; lỗi dọn dẹp chỉ
  // được nói khi thân hàm đã qua.
  // `Error` chứ không `unknown`: quy tắc `only-throw-error` cấm ném lại một biến `unknown`, và
  // nó có lý — một `throw "chuỗi"` lọt xuống đây sẽ mất sạch ngăn xếp. Bọc lại thay vì tắt quy tắc.
  const nhuLoi = (v: unknown): Error => (v instanceof Error ? v : new Error(String(v)));
  let loiThan: Error | undefined;
  try {
    await migrate(db.pool, MIGRATIONS_DIR);
    await fn(db);
  } catch (loi) {
    loiThan = nhuLoi(loi);
  }
  try {
    await db.stop();
  } catch (loiDon) {
    if (loiThan === undefined) throw nhuLoi(loiDon);
  }
  if (loiThan !== undefined) throw loiThan;
}
