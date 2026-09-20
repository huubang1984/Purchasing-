// ==============================================================================================
// [S1.94 / khoản 103] MỘT KẾT NỐI **RẢNH** CHẾT KHÔNG ĐƯỢC PHÉP GIẾT TIẾN TRÌNH.
//
// `pg` phát `'error'` TRÊN POOL khi một client đang rảnh trong hồ chết — CSDL khởi động lại, máy
// ngủ dậy, một cú `pg_terminate_backend`, một lần ngắt mạng. Không ai nghe thì `EventEmitter` ném,
// và vì `apps/api` lẫn `apps/unseal-worker` đều không đặt `process.on("uncaughtException")`, đó là
// một lần chết thật giữa kịch bản đang chạy.
//
// PHÉP ĐO NÀY TỰ NÓ LÀ PHÉP ĐO: nếu `createPool` không gắn listener, sự kiện không người nghe sẽ
// ném NGAY TRONG tiến trình vitest — tệp này không "đỏ một khẳng định", nó làm tiến trình chạy
// test chết. Đã chạy đột biến để thấy đúng điều ấy (§S1.94).
//
// VÌ SAO KHÔNG MÔ PHỎNG BẰNG `pool.emit("error", …)`: emit tay chứng minh `EventEmitter` hoạt động,
// không chứng minh `pg` phát sự kiện ấy trên ĐƯỜNG NÀO. Ở đây backend bị giết từ một kết nối khác,
// đúng hình dạng của sự cố thật.
// ==============================================================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createPool } from "./pool.js";

let db: TestDatabase;

beforeAll(async () => {
  // [S1.94] KHÔNG gọi `migrate()`, và sự vắng mặt ấy là CÓ Ý: tệp này không chạm một bảng nào
  // của dự án — chỉ `pg_backend_pid()`, `pg_terminate_backend()` và `SELECT 1`. Một lượt
  // migrate ở đây là bốn mươi mấy migration cộng hardening chạy cho KHÔNG một khẳng định nào
  // dựa vào chúng, trong một lượt evidence đã có 51 tệp `.int` tranh nhau cùng một cái máy.
  // Một cluster trống là đủ cảnh cho thứ đang được đo: một kết nối rảnh chết.
  db = await startPostgres();
}, 180000);

afterAll(async () => {
  await db?.stop();
});

const ngu = (ms: number): Promise<void> => new Promise((x) => setTimeout(x, ms));

describe("[khoản 103] pool sống sót khi một kết nối RẢNH bị giết", () => {
  it("backend rảnh bị pg_terminate_backend ⇒ `onPoolError` nhận lỗi, tiến trình KHÔNG chết, pool vẫn cấp kết nối mới", async () => {
    const daBat: unknown[] = [];
    const pool = createPool(db.connectionString, 2, { onPoolError: (e) => daBat.push(e) });
    try {
      // Một client được mượn rồi TRẢ LẠI: từ đây nó nằm rảnh trong hồ, không ai đang dùng.
      const c = await pool.connect();
      const { rows } = await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid");
      const pid = rows[0]?.pid;
      expect(pid, "phải đọc được pid của backend đang rảnh").toBeGreaterThan(0);
      c.release();

      // Giết nó TỪ MỘT KẾT NỐI KHÁC — đúng hình dạng của một lần CSDL khởi động lại.
      await db.pool.query("SELECT pg_catalog.pg_terminate_backend($1)", [pid]);

      for (let i = 0; i < 40 && daBat.length === 0; i += 1) await ngu(50);

      expect(daBat.length, "sự kiện 'error' của pool phải tới tay người nghe").toBeGreaterThan(0);
      expect(daBat[0], "và nó là một lỗi có tên, không phải một giá trị lạ").toBeInstanceOf(Error);

      // Vế đáng giá thứ hai: pool vẫn dùng được sau đó — client hỏng đã bị `pg` gỡ khỏi hồ.
      const sau = await pool.query<{ n: number }>("SELECT 1::pg_catalog.int4 AS n");
      expect(sau.rows[0]?.n, "pool vẫn cấp được kết nối mới sau sự cố").toBe(1);
    } finally {
      await pool.end();
    }
  }, 120000);

  it("KHÔNG truyền `onPoolError` thì tiến trình vẫn sống — lớp nằm ở `createPool`, không ở lời khai của người gọi", async () => {
    const pool = createPool(db.connectionString, 2);
    try {
      const c = await pool.connect();
      const { rows } = await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid");
      c.release();
      await db.pool.query("SELECT pg_catalog.pg_terminate_backend($1)", [rows[0]?.pid]);
      await ngu(500);
      const sau = await pool.query<{ n: number }>("SELECT 1::pg_catalog.int4 AS n");
      expect(sau.rows[0]?.n, "không có bộ ghi log thì mất DÒNG CHẨN ĐOÁN, không mất tiến trình").toBe(1);
    } finally {
      await pool.end();
    }
  }, 120000);
});
