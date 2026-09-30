import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { ganVaiTroChoPool, laVaiUngDung, VAI_UNG_DUNG, migrate } from "@trustprocure/db";
import { TenantError } from "@trustprocure/tenancy";
import { cauHinhCumCucBo, khoiDongCumCucBo, type MayChuPostgres } from "./postgres-cuc-bo.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
/** [S1.242 / khoản 281] Gốc kho và chính tệp này — để nơi gọi in ra dạng `tệp:dòng` tương đối, đọc được trong log CI. */
const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const TEP_NAY = fileURLToPath(import.meta.url);

// [S1.11] Danh sách đóng các DB role hợp lệ mà poolAs() được phép chuyển sang NAY SỐNG Ở
// `@trustprocure/db` (`VAI_UNG_DUNG`), cùng với cơ chế gắn vai — vì composition root của
// `apps/api` cần đúng cơ chế ấy cho tiến trình thật, và hai bản chép của một hàng rào là một bản
// sẽ trôi. Khối [fix C1 + I3] từng đứng ở đây nay là khối đầu `packages/db/src/vai-tro.ts`.

/**
 * [S1.242 / khoản 281] Lời khai của một test CỐ Ý để trạng thái phiên sót dưới `withTenant` — xem khối lý do khoản 281 ở dưới.
 * Đưa cho `poolAs(vai, …)` thì khai cho pool ấy; đưa cho `startPostgres(…)`/`withMigratedDatabase(fn, …)` thì khai cho `pool` superuser.
 */
export interface TuyChonDemTrangThaiPhien {
  /**
   * Số lần pool này huỷ một kết nối bằng `release(TenantError SESSION_STATE_LEFT)` trước `stop()` — mặc định 0. `stop()` đòi số
   * đếm BẰNG đúng số này (không phải "không quá"). Số nguyên không âm; sai hình dạng thì NÉM ngay lúc gọi.
   */
  readonly soLanSessionStateLeft?: number;
}

export interface TestDatabase {
  readonly connectionString: string;
  readonly pool: pg.Pool;
  /**
   * Pool mới chạy dưới một DB role khác — dùng để chứng minh RLS và GRANT chặn thật. [S1.242 / khoản 281] Mỗi pool mang một bộ
   * đếm `SESSION_STATE_LEFT`; test cố ý dựng cảnh ấy khai số lần qua `tuyChon.soLanSessionStateLeft`.
   */
  poolAs(role: string, tuyChon?: TuyChonDemTrangThaiPhien): pg.Pool;
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
        "SELECT pid, datname, state, application_name FROM pg_catalog.pg_stat_activity " +
          " WHERE pid OPERATOR(pg_catalog.<>) pg_catalog.pg_backend_pid() AND backend_type OPERATOR(pg_catalog.=) 'client backend'",
      );
      if (rows.length === 0 || Date.now() >= hetHan) return rows;
      await new Promise((giaiQuyet) => setTimeout(giaiQuyet, 25));
    }
  } finally {
    await client.end().catch(() => {});
  }
}

// ==============================================================================================
// [S1.242 / khoản 281] TÍN HIỆU ⑴ CỦA HAI POOL NÀY ĐƯỢC ĐẾM — VÀ `stop()` ĐÒI SỐ ĐẾM BẰNG LỜI KHAI
//
// `withTenant` đọc lại trạng thái phiên sau mọi giao dịch; thấy sót — GUC tenant/khách phạm vi PHIÊN,
// `session_replication_role`, `row_security`, search path hiệu lực — thì huỷ kết nối bằng
// `release(TenantError SESSION_STATE_LEFT)` và KHÔNG ném: lỗi ấy chỉ đi vào sự kiện `release` của pool
// (khoản 118). Tiến trình thật nghe nó (cổng `pool-nghe-du-tin-hieu`, tín hiệu ⑴); hai pool của tệp
// này thì không, nên tới vòng này một mã sản xuất để sót trạng thái phiên dưới test làm MỘT kết nối
// biến khỏi pool và không test nào đỏ (khoản 281, §S1.227 mục 7 — cổng ấy quét `apps/`, `tools/`).
//
// Nay `startPostgres` gắn một bộ đếm `release` cho `pool` và cho MỌI pool của `poolAs`; `stop()` so
// từng bộ đếm với số lần KHAI và ném, nêu tệp gọi `startPostgres`, từng pool lệch (tên, nơi dựng, số
// đếm, số khai). Test CỐ Ý dựng cảnh ấy khai qua tham số có tên `soLanSessionStateLeft` — ở
// `poolAs(vai, { … })` cho pool của chính nó, ở `startPostgres({ … })` cho `pool` superuser. Không có
// cờ tắt vế.
//
// BỐN ĐIỂM ĐÃ CÂN:
//   ⒜ Đếm ĐÚNG mã `SESSION_STATE_LEFT` của `TenantError`. `KetNoiNhiemError` của lần lấy client, lỗi
//     gốc của một giao dịch hỏng, `true` của `destroyConnectionWhenDone` cũng huỷ kết nối qua
//     `release`, nhưng là đường KHÁC đã có người đo riêng — ca đối chứng ở `postgres.int.test.ts`.
//   ⒝ Đòi BẰNG, không đòi "không quá": khai 1 mà đếm 0 nghĩa là tiền đề của test đã mất (withTenant
//     thôi bắt trục nó dựng) — cũng đỏ.
//   ⒞ Khai theo POOL, không theo tệp: pool dựng trong chính `it` thì `-t` lọc bỏ `it` ấy cũng bỏ luôn
//     lời khai, nên chạy một phần tệp không đỏ oan. Hệ quả: một test cố ý dựng cảnh trên pool DÙNG
//     CHUNG của cả tệp thì phải dựng pool riêng để khai.
//   ⒟ Ném SAU khi dừng máy chủ, cùng luật ⑵ của khoản 28; hai lời phán (khoản 28, khoản 281) gộp
//     vào MỘT lỗi. Thông điệp chỉ mang tên, nơi dựng và số — không giá trị GUC nào (withTenant cũng
//     không nội suy giá trị vào lỗi của nó).
// ==============================================================================================

/** [S1.242 / khoản 281] Một bộ đếm `SESSION_STATE_LEFT` của một pool. */
interface BoDemTrangThaiPhien {
  readonly ten: string;
  /** `tệp:dòng` nơi pool được dựng (khung đầu tiên của ngăn xếp nằm ngoài tệp này). */
  readonly noiDung: string;
  readonly khai: number;
  dem: number;
}

/**
 * [S1.242 / khoản 281] Nơi gọi `startPostgres`/`poolAs`: khung đầu tiên của ngăn xếp nằm ngoài tệp này và ngoài `node_modules`, dạng
 * `tệp:dòng` tương đối với gốc kho. Chỉ đọc chuỗi ngăn xếp (vitest đã ánh xạ về mã nguồn); không đọc được thì nói thế, không ném.
 */
function noiGoi(): string {
  for (const dong of (new Error().stack ?? "").split("\n").slice(1)) {
    const m = /(?:\(|at )((?:file:\/\/)?\/[^()]+?):(\d+):\d+\)?$/u.exec(dong.trim());
    if (m === null) continue;
    const tep = m[1]!.startsWith("file://") ? fileURLToPath(m[1]!) : m[1]!;
    if (tep === TEP_NAY || tep.includes("/node_modules/")) continue;
    return `${tep.startsWith(GOC_KHO) ? tep.slice(GOC_KHO.length) : tep}:${m[2]!}`;
  }
  return "(không đọc được nơi gọi)";
}

/** [S1.242 / khoản 281] Số lần khai — số nguyên không âm, mặc định 0; sai hình dạng thì NÉM trước khi chạm cụm. */
function soLanKhai(tuyChon: TuyChonDemTrangThaiPhien | undefined, cho: string): number {
  const n = tuyChon?.soLanSessionStateLeft ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`[khoản 281] ${cho}: soLanSessionStateLeft phải là số nguyên không âm — nhận ${String(n)}.`);
  }
  return n;
}

/** [S1.242 / khoản 281] Gắn bộ đếm vào `pool`: mỗi `release` mang `TenantError` mã `SESSION_STATE_LEFT` cộng một. */
function ganBoDem(pool: pg.Pool, ten: string, noiDung: string, khai: number): BoDemTrangThaiPhien {
  const bo: BoDemTrangThaiPhien = { ten, noiDung, khai, dem: 0 };
  pool.on("release", (loi: unknown) => {
    if (loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT") bo.dem += 1;
  });
  return bo;
}

/** [S1.242 / khoản 281] Lời phán của `stop()` khi có pool lệch — tên, nơi dựng, số; không giá trị. */
function moTaLech(tepGoi: string, lech: readonly BoDemTrangThaiPhien[]): string {
  return (
    `[khoản 281] ${tepGoi}: số lần withTenant huỷ kết nối bằng TenantError SESSION_STATE_LEFT khác số đã khai — ` +
    lech.map((b) => `${b.ten} (dựng ở ${b.noiDung}) đếm ${String(b.dem)}, khai ${String(b.khai)}`).join("; ") +
    ". Đếm NHIỀU hơn khai: một giao dịch dưới withTenant để lại trạng thái phiên (SET không LOCAL, set_config(…, false), " +
    "search_path, session_replication_role, row_security) — dưới tiến trình thật mỗi lần như thế là một kết nối bị huỷ mà chỉ " +
    "một dòng log `ket noi huy` nói ra; sửa mã, hay nếu test CỐ Ý dựng cảnh ấy thì khai số lần ở " +
    "`poolAs(vai, { soLanSessionStateLeft })` / `startPostgres({ soLanSessionStateLeft })`. Đếm ÍT hơn khai: tiền đề của test " +
    "đã mất — withTenant thôi bắt trục mà test ấy dựng."
  );
}

/** Đường mặc định: một container Testcontainers cho mỗi lần gọi. */
async function khoiDongContainer(): Promise<MayChuPostgres> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("trustprocure_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();
  return {
    connectionString: container.getConnectionUri(),
    async dung(): Promise<void> {
      await container.stop();
    },
  };
}

export async function startPostgres(tuyChon: TuyChonDemTrangThaiPhien = {}): Promise<TestDatabase> {
  // [S1.242 / khoản 281] Nơi gọi và lời khai đọc TRƯỚC mọi `await`: ngăn xếp lúc này còn khung của người gọi, và một lời khai sai
  // hình dạng ném trước khi một cụm nào được dựng.
  const tepGoi = noiGoi();
  const khaiPoolChinh = soLanKhai(tuyChon, `startPostgres (${tepGoi})`);

  // Không có Docker thì đi đường cụm cục bộ (xem đầu `postgres-cuc-bo.ts`); có đủ hai biến môi
  // trường mới rẽ, còn lại container như trước. Mọi thứ dưới đây không biết mình đang ở đường nào.
  const cucBo = cauHinhCumCucBo();
  const mayChu: MayChuPostgres = cucBo === undefined ? await khoiDongContainer() : await khoiDongCumCucBo(cucBo);

  const connectionString = mayChu.connectionString;
  const pool = new pg.Pool({ connectionString, max: 5 });
  const rolePools: pg.Pool[] = [];
  // [S1.242 / khoản 281] Một bộ đếm mỗi pool — `pool` superuser trước, rồi từng pool của `poolAs` theo thứ tự dựng.
  const boDem: BoDemTrangThaiPhien[] = [ganBoDem(pool, "pool superuser", tepGoi, khaiPoolChinh)];

  return {
    connectionString,
    pool,
    poolAs(role: string, tuyChonPool?: TuyChonDemTrangThaiPhien): pg.Pool {
      const noiDung = noiGoi();
      if (!laVaiUngDung(role)) {
        throw new Error(
          `poolAs: vai trò không hợp lệ "${role}" — chỉ chấp nhận ${VAI_UNG_DUNG.join(" hoặc ")}.`,
        );
      }
      // Gán vào một const mới ngay sau khi type guard xác thực: TypeScript không giữ narrowing
      // của tham số hàm xuyên vào một closure lồng bên trong, nên phải "chốt" kiểu vào một binding mới.
      const vaiTroDaXacThuc = role;
      const khai = soLanKhai(tuyChonPool, `poolAs("${vaiTroDaXacThuc}") (${noiDung})`);
      const rolePool = ganVaiTroChoPool(new pg.Pool({ connectionString, max: 3 }), vaiTroDaXacThuc);
      boDem.push(ganBoDem(rolePool, `poolAs("${vaiTroDaXacThuc}")`, noiDung, khai));
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

      // [S1.242 / khoản 281] Chốt số đếm SAU khi mọi pool đã đóng: `withTenant` phát `release` đồng bộ trong `finally` của nó, nên
      // một giao dịch đã trả về thì đã được đếm; và TRƯỚC khi dừng máy chủ — nhưng ném thì SAU (điểm ⒟ ở khối lý do).
      const lech = boDem.filter((b) => b.dem !== b.khai);

      await mayChu.dung();

      const loiPhan: string[] = [];
      if (conSot.length > 0) {
        const moTa = conSot
          .map((b) => `pid=${b.pid} db=${b.datname ?? "?"} state=${b.state ?? "?"} app=${b.application_name ?? "?"}`)
          .join("; ");
        loiPhan.push(
          `[khoản nợ 28] Bộ test này dừng container khi còn ${conSot.length} kết nối khách sống ` +
            `sau ${HAN_CHO_KET_NOI_THOAT_MS}ms chờ. Đó chính là nguồn của \`57P01\` ` +
            `("terminating connection due to administrator command") — một lỗi làm JOB đỏ mà ` +
            `KHÔNG một \`expect\` nào đỏ, nên nó không tìm được bằng cách đọc kết quả test. ` +
            `Cách sửa: \`await pool.end()\` mọi pool bộ test TỰ dựng, trong \`finally\` hoặc ` +
            `\`afterAll\`, TRƯỚC khi \`db.stop()\` chạy. Backend còn sót: ${moTa}`,
        );
      }
      if (lech.length > 0) loiPhan.push(moTaLech(tepGoi, lech));
      if (loiPhan.length > 0) throw new Error(loiPhan.join("\n"));
    },
  };
}

/**
 * Khởi động Postgres, áp dụng toàn bộ migration thật của dự án, chạy `fn`, rồi dọn dẹp. [S1.242 / khoản 281] `tuyChon` là lời khai
 * cho `pool` superuser, chuyển nguyên cho `startPostgres`.
 */
export async function withMigratedDatabase(
  fn: (db: TestDatabase) => Promise<void>,
  tuyChon: TuyChonDemTrangThaiPhien = {},
): Promise<void> {
  const db = await startPostgres(tuyChon);
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
