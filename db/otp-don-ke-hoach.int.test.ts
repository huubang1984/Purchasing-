import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

// ==============================================================================================
// [sổ nợ 58 / migration 046] KẾ HOẠCH CỦA CÂU DỌN `otp_rate_limits` — MỘT PHÉP ĐO, KHÔNG MỘT NIỀM TIN
//
// Bộ dọn của sổ nợ 57 chạy `DELETE FROM otp_rate_limits` KHÔNG có `WHERE` (lý do đầy đủ ở `044`:
// một `WHERE` tham chiếu cột kéo theo đòi hỏi policy SELECT, thứ bảng này cố ý không cấp cho kết
// nối nền). Vế lọc vì thế đến TOÀN BỘ từ RLS: `khách IS NULL AND (org_id = <GUC> OR (<GUC> IS NULL
// AND window_start < mốc))`.
//
// Review lượt 7 kết luận rằng hình dạng ấy KHÔNG dùng được chỉ số, và mở sổ nợ 58 trên kết luận đó.
// Kết luận sai — phép đo đứng sau nó chạy ở chế độ 95% hàng quá sàn, nơi Seq Scan là tối ưu THẬT.
// Ở chế độ của một bảng đang chạy (1%), PostgreSQL dựng `BitmapOr` từ khoá chính + chỉ số
// `window_start` và nhanh hơn 35 lần. `046` dựng lại chỉ số; tệp này là lớp giữ cho kết luận MỚI
// không tự thành một niềm tin nữa.
//
// BA THỨ ĐƯỢC ĐO, và thứ ba là thứ chống-mù:
//   ⑴ kế hoạch dùng ĐÚNG `otp_rate_limits_window_idx`;
//   ⑵ nó KHÔNG phải Seq Scan trên bảng ấy;
//   ⑶ ĐỐI CHỨNG DƯƠNG: gỡ chỉ số ra thì cùng câu ấy, cùng dữ liệu ấy, QUAY VỀ Seq Scan. Không có
//      vế này thì ⑴/⑵ xanh y hệt khi fixture rỗng hoặc khi câu lệnh bị viết sai thành thứ khác.
//
// CHẾ ĐỘ LÀ MỘT THAM SỐ CỦA PHÉP ĐO, không phải một chi tiết: 200 000 hàng với 1% quá sàn. Một
// fixture nhỏ hơn nhiều sẽ làm Seq Scan thắng một cách CHÍNH ĐÁNG và test này sẽ đỏ vì lý do sai.
// Đó cũng đúng là cái bẫy đã làm H7-3 kết luận nhầm, nên nó được viết ra ở đây chứ không để ai đoán.
// ==============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const SO_HANG = 200_000;
const SO_HANG_CU = 2_000;
const ORG = "11111111-1111-4111-8111-1111111158aa";

let db: TestDatabase;
let apiPool: pg.Pool;

/** Kế hoạch THẬT của đúng câu bộ dọn chạy, dưới `app_api` CHƯA gắn tổ chức. */
async function keHoach(): Promise<string> {
  const c = await apiPool.connect();
  try {
    // `EXPLAIN ANALYZE` của một `DELETE` có XOÁ thật, nên nó chạy trong một giao dịch bị cuộn lại:
    // hai lượt đo phải nhìn thấy CÙNG một tập hàng.
    await c.query("BEGIN");
    const { rows } = await c.query<{ "QUERY PLAN": string }>(
      "EXPLAIN (ANALYZE, BUFFERS) DELETE FROM otp_rate_limits",
    );
    await c.query("ROLLBACK");
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  } finally {
    c.release();
  }
}

describe("[sổ nợ 58] câu dọn otp_rate_limits dùng được chỉ số", () => {
  beforeAll(async () => {
    db = await startPostgres();
    await migrate(db.pool, MIGRATIONS_DIR);
    apiPool = db.poolAs("app_api");
    await db.pool.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Cong ty 58', 'cong-ty-58')", [ORG]);
    await db.pool.query(
      `INSERT INTO otp_rate_limits (org_id, bucket_kind, bucket_hash, window_start, hits)
       SELECT $1, 'DEST', decode(lpad(to_hex(g), 64, '0'), 'hex'),
              now() - make_interval(mins => CASE WHEN g <= $3 THEN 90 ELSE 5 END), 1
         FROM generate_series(1, $2) g`,
      [ORG, SO_HANG, SO_HANG_CU],
    );
    await db.pool.query("ANALYZE otp_rate_limits");
  }, 300_000);

  afterAll(async () => {
    await db.stop();
  });

  it("ở chế độ 1% quá sàn, kế hoạch dùng `otp_rate_limits_window_idx` chứ không quét toàn bảng", async () => {
    const kh = await keHoach();
    expect(kh, "chỉ số của 046 không được dùng — bộ dọn quay về chi phí theo KÍCH THƯỚC BẢNG").toContain(
      "otp_rate_limits_window_idx",
    );
    expect(kh).toContain("BitmapOr");
    expect(kh, "Seq Scan ở chế độ 1% nghĩa là chỉ số mất tác dụng").not.toContain("Seq Scan on otp_rate_limits");
    // Chốt chống rỗng ruột: fixture phải thật, và số hàng KHỚP phải đúng 1%. `\b` không thừa —
    // `rows=2000` là TIỀN TỐ của `rows=200000`, tức không có nó thì khẳng định này xanh nhờ chính
    // con số nó phải phân biệt với.
    expect(kh).toMatch(/rows=2000\b/u);
  }, 120_000);

  it("ĐỐI CHỨNG DƯƠNG: gỡ chỉ số ⇒ cùng câu ấy quay về Seq Scan; dựng lại ⇒ dùng chỉ số trở lại", async () => {
    await db.pool.query("DROP INDEX otp_rate_limits_window_idx");
    try {
      const khKhong = await keHoach();
      expect(khKhong, "không có chỉ số thì phải là Seq Scan — nếu không, phép đo trên chứng minh cho cái khác").toContain(
        "Seq Scan on otp_rate_limits",
      );
      expect(khKhong).toMatch(/Rows Removed by Filter: 198000/u);
    } finally {
      await db.pool.query("CREATE INDEX otp_rate_limits_window_idx ON otp_rate_limits (window_start)");
    }
    expect(await keHoach()).toContain("otp_rate_limits_window_idx");
  }, 120_000);
});
