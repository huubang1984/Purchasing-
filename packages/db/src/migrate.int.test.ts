import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

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

// =====================================================================================
// DỌN DẸP TẤT ĐỊNH CHO HAI TEST DỰNG DATABASE RIÊNG — sửa sau LẦN CHẠY CI ĐẦU TIÊN
// (run 33218397033, 2026-08-28).
//
// Ở lượt đó **326/326 test XANH, 11/11 file XANH, mà job vẫn ĐỎ**: "Vitest caught 2 unhandled
// errors", cả hai là SQLSTATE `57P01` (`admin_shutdown`, postgres.c:3286, ProcessInterrupts)
// trên `tp_kiem_tra_khoa` và `tp_kiem_tra_mo_khoa`. Đây là vế thứ hai của bài học ràng buộc
// (11) trong sổ tiến trình: **"mọi test xanh" KHÔNG đủ để kết luận job xanh** — lỗi nằm NGOÀI
// vòng đời của test.
//
// CƠ CHẾ, đọc thẳng từ đối tượng lỗi được vitest tuần tự hoá trong log CI:
//   - `await pool.end()` chỉ bảo đảm phía CLIENT đã gửi Terminate và đóng socket. Nó KHÔNG bảo
//     đảm backend phía MÁY CHỦ đã thoát: backend còn nằm trong `pg_stat_activity` thêm một
//     khoảng ngắn.
//   - `DROP DATABASE ... WITH (FORCE)` gửi SIGTERM cho mọi backend còn bám vào database đó.
//     Backend ấy trả về FATAL 57P01 trên socket mà client vẫn còn đang đọc.
//   - Client emit `error`; pg-pool bắt bằng `idleListener`, gắn `err.client = client` (đúng
//     trường `client` thấy trong log) rồi `pool.emit("error", err)`. Pool không có listener
//     `error` nào ⇒ Node ném ⇒ vitest ghi "unhandled error" ⇒ job đỏ, trong khi mọi khẳng
//     định của test đã xanh từ trước.
//
// HAI LỚP SỬA, và lớp đầu là lớp xoá HẲN nguồn phát:
//   (a) `xoaDatabaseSauKhiHetKetNoi()` CHỜ tới khi `pg_stat_activity` không còn backend nào
//       trên database đó rồi mới `DROP DATABASE` **không FORCE**. Không backend nào bị SIGTERM
//       ⇒ không FATAL 57P01 nào được sinh ra. `WITH (FORCE)` chỉ còn là đường lui khi hết hạn
//       chờ — để việc dọn dẹp không bao giờ bỏ lại một database rác, VÀ để ca rò rỉ được báo
//       bằng KHẲNG ĐỊNH ở người gọi chứ không bằng một lần treo.
//   (b) `theoDoiLoiPool()` biến một `pool.emit("error")` từ "sập tiến trình, thông điệp mù"
//       thành một mảng người gọi KHẲNG ĐỊNH là rỗng. Nếu cuộc đua này quay lại dưới một hình
//       dạng khác, test ĐỎ với tên nó, thay vì job đỏ với "unhandled errors".
//
// ĐO TỪNG LỚP VÀ ĐO KẾT HỢP (mũi đột biến: bỏ `await poolSieuQuyen.end()` để rò rỉ ĐÚNG một
// kết nối vào đúng thời điểm dọn dẹp). Năm nhánh, đo thật, kết quả nguyên văn:
//   B0 bản đã sửa, không mũi          → 15 passed, 0 lần 57P01, không unhandled
//   B1 + rò rỉ                        → 15 passed, 0 lần 57P01 (test đó 10.2s thay vì 0.2s)
//   B2 + rò rỉ, TẮT lớp (b)           → 15 passed, 0 lần 57P01  ⟵ lớp (a) một mình là đủ
//   B3 + rò rỉ, TẮT CẢ HAI (= mã cũ)  → **15 passed, exit 1, "Unhandled Errors", 1 lần 57P01**
//   B4 + rò rỉ, TẮT (a), GIỮ (b)      → **1 failed**: `expected [Array(1)] to deeply equal []`
//                                        với "terminating connection due to administrator command"
//
// B3 TÁI LẬP CHÍNH XÁC CHỮ KÝ CỦA LẦN CHẠY CI: mọi test xanh, job đỏ. Tức chẩn đoán được kiểm
// chứng đầu-cuối, không phải suy diễn từ log.
//
// MỘT DỰ ĐOÁN CỦA TÔI ĐÃ BỊ CHÍNH PHÉP ĐO BÁC BỎ, và nó đổi cách phát biểu bảo đảm:
// tôi chờ B1 ĐỎ vì `ketNoiConLai > 0`. Nó XANH, và lý do đọc được ngay ở con số 10.2s:
// `pg.Pool` có `idleTimeoutMillis` mặc định **10 giây**, nên một pool bị bỏ quên TỰ đóng client
// rảnh của nó. Vòng chờ nhìn thấy 0 rồi `DROP` sạch. Vậy nên nói cho đúng:
//   - thứ mua được sự tất định là **VÒNG CHỜ**, không phải khẳng định `ketNoiConLai`;
//   - `expect(ketNoiConLai).toBe(0)` chỉ bắt được rò rỉ SỐNG LÂU HƠN hạn 30s — tức một rò rỉ
//     THẬT, không phải cửa sổ vài trăm mili-giây giữa `pool.end()` và lúc backend thoát.
// Viết "khẳng định này bắt rò rỉ kết nối" là nói rộng hơn thứ đo được.
//
// Vì sao (a) mà vẫn cần (b): B2 cho thấy (a) một mình đủ cho nguồn phát ĐÃ BIẾT; B4 cho thấy (b)
// một mình biến đúng lỗi ấy thành một khẳng định có tên. (b) không giả định (a) đã đóng hết mọi
// nguồn — và nó là lớp duy nhất còn tác dụng trên đường lui `WITH (FORCE)`.
// =====================================================================================

/** Số backend còn bám vào `pTenDb`, không tính chính kết nối đang hỏi. */
async function demKetNoi(pQuanTri: pg.Pool, pTenDb: string): Promise<number> {
  const { rows } = await pQuanTri.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity " +
      "WHERE datname = $1 AND pid <> pg_backend_pid()",
    [pTenDb],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Chờ hết kết nối rồi xoá database. Trả về **số kết nối còn sót tại thời điểm xoá** — người
 * gọi phải khẳng định nó bằng 0. Trả về thay vì tự `expect()` là có chủ đích: hàm này chạy
 * trong `finally`, và một `expect()` ném ở đó sẽ NUỐT MẤT lỗi gốc của test.
 */
async function xoaDatabaseSauKhiHetKetNoi(
  pQuanTri: pg.Pool,
  pTenDb: string,
  pHanMs = 30_000,
): Promise<number> {
  const hetHan = Date.now() + pHanMs;
  let conLai = await demKetNoi(pQuanTri, pTenDb);
  while (conLai > 0 && Date.now() < hetHan) {
    await new Promise((giaiQuyet) => setTimeout(giaiQuyet, 25));
    conLai = await demKetNoi(pQuanTri, pTenDb);
  }
  // Đường lui: còn kết nối thì vẫn phải xoá cho sạch, và người gọi sẽ làm test đỏ vì `conLai`.
  await pQuanTri.query(
    conLai === 0
      ? `DROP DATABASE IF EXISTS ${pTenDb}`
      : `DROP DATABASE IF EXISTS ${pTenDb} WITH (FORCE)`,
  );
  return conLai;
}

/**
 * Ghi lại mọi sự kiện `error` của pool thay vì để nó thành "unhandled error" của tiến trình.
 * Trả về chính mảng ghi — người gọi khẳng định nó rỗng SAU khi đã dọn dẹp xong.
 */
function theoDoiLoiPool(...pDsPool: readonly pg.Pool[]): string[] {
  const loi: string[] = [];
  for (const pool of pDsPool) pool.on("error", (e: Error) => loi.push(e.message));
  return loi;
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

  // [PHẦN 0 — lỗi tiền tồn từ Task 1] Đây là ca THẬT sẽ xảy ra ở CI: cùng một commit được
  // checkout ra CRLF trên máy Windows (core.autocrlf=true, không .gitattributes) và ra LF trên
  // Linux. Trước bản vá, lần thứ hai ném "checksum không khớp" và deploy chết cứng.
  // Xem khối "CHUẨN HOÁ XUỐNG DÒNG" ở packages/db/src/migrate.ts để biết số đo trên HEAD.
  it("[PHẦN 0] cùng một migration checkout ra CRLF rồi ra LF KHÔNG làm migrate() gãy", async () => {
    const noiDungLf = "-- bảng của phần 0\nCREATE TABLE mig_eol (id int);\n";
    const noiDungCrlf = noiDungLf.replace(/\n/g, "\r\n");
    expect(noiDungCrlf).not.toBe(noiDungLf); // chống rỗng ruột

    const dir = migrationDir({ "041_eol.sql": noiDungCrlf });
    expect(await migrate(db.pool, dir)).toEqual(["041_eol.sql"]);

    // Cùng thư mục, file được ghi lại bằng LF — mô phỏng đúng một checkout trên nền tảng khác.
    writeFileSync(join(dir, "041_eol.sql"), noiDungLf);
    expect(await migrate(db.pool, dir)).toEqual([]);

    // Và chiều ngược lại (Linux trước, Windows sau) cũng phải qua.
    writeFileSync(join(dir, "041_eol.sql"), noiDungCrlf);
    expect(await migrate(db.pool, dir)).toEqual([]);
  });

  // [PHẦN 0 — hồi quy] Bản vá nới `[fix S7]` ra ĐÚNG MỘT trục. Ca đo được của Task 6 ("sửa
  // CHÚ THÍCH của một migration ĐÃ ÁP DỤNG = sửa migration đã áp dụng") PHẢI vẫn gãy — nếu
  // không, bản vá an ninh này đã làm một phép kiểm an ninh khác mất tác dụng mà vẫn xanh.
  it("[PHẦN 0] hồi quy — sửa CHÚ THÍCH của migration đã áp dụng VẪN làm migrate() gãy", async () => {
    const banDau = "-- ghi chú gốc\nCREATE TABLE mig_eol_ct (id int);\n";
    const dir = migrationDir({ "042_chu_thich.sql": banDau });
    expect(await migrate(db.pool, dir)).toEqual(["042_chu_thich.sql"]);

    // CHỈ đổi chú thích, giữ nguyên xuống dòng.
    writeFileSync(join(dir, "042_chu_thich.sql"), banDau.replace("gốc", "đã bị sửa"));
    await expect(migrate(db.pool, dir)).rejects.toThrow(/042_chu_thich\.sql/);

    // Và đổi chú thích ĐỒNG THỜI đổi xuống dòng cũng phải gãy — chuẩn hoá không được che một
    // thay đổi nội dung thật chỉ vì nó đi kèm một lần đổi quy ước xuống dòng.
    writeFileSync(
      join(dir, "042_chu_thich.sql"),
      banDau.replace("gốc", "đã bị sửa").replace(/\n/g, "\r\n"),
    );
    await expect(migrate(db.pool, dir)).rejects.toThrow(/042_chu_thich\.sql/);
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

  // [fix I4] Bản trước giữ lockClient checked-out rồi vẫn xin thêm client khác từ pool
  // (pool.query()/pool.connect() cho từng file) trong lúc giữ khoá — với pool chỉ có
  // max: 1 (mà createPool(cs, max) cho phép người gọi tự chọn), không còn client nào để
  // cấp, migrate() treo VĨNH VIỄN, không tự thoát (đã tự đo: treo qua mốc 5s). Test này
  // dùng Promise.race với một timeout ngắn để biến "treo mãi" thành một lần FAIL rõ ràng
  // thay vì chờ hết 30s timeout mặc định của vitest.
  it("[fix I4] migrate() không deadlock khi pool chỉ có max: 1", async () => {
    const poolMotKetNoi = new pg.Pool({ connectionString: db.connectionString, max: 1 });
    try {
      const dir = migrationDir({ "060_mot_ket_noi.sql": "CREATE TABLE mig_i (id int);" });

      const hoanThanh = migrate(poolMotKetNoi, dir);
      const hetGio = new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("timeout: migrate() treo qua 5s với pool max: 1")),
          5000,
        );
      });

      await expect(Promise.race([hoanThanh, hetGio])).resolves.toEqual(["060_mot_ket_noi.sql"]);
    } finally {
      await poolMotKetNoi.end();
    }
  });

  // [fix I1] Bản trước: "await lockClient.query(unlock); lockClient.release();" trong
  // finally — nếu unlock ném lỗi (kết nối chết giữa chừng), release() không bao giờ chạy,
  // client rò rỉ vĩnh viễn trong sổ sách của pool. Mô phỏng mất kết nối giữa chừng bằng
  // chính nội dung migration: "pg_terminate_backend(pg_backend_pid())" tự ngắt kết nối của
  // chính nó đang chạy — xác định, không cần một kết nối thứ hai canh thời điểm để giết.
  it("[fix I1] mất kết nối giữa chừng không rò rỉ client — pool vẫn dùng được ngay sau, lỗi thật nổi lên", async () => {
    // [fix round 4] Bắt mọi lỗi thoát ra MỨC TIẾN TRÌNH trong suốt test này. Listener rỗng
    // lockClient.on("error", ...) trong migrate() tồn tại chính vì điều này: đã đo thật —
    // kết nối chết giữa chừng làm pg phát 'error' trên Client ĐÚNG MỘT lần; có listener thì
    // "so listener luc do = 1" và không có gì thoát ra, bỏ listener đi thì
    // "so listener luc do = 0" và Node ném ra ngoài ("Connection terminated unexpectedly"),
    // trong một tiến trình Node thường là uncaughtException giết cả tiến trình. Khẳng định
    // dưới đây biến đột biến "bỏ listener" thành một lần FAIL của ĐÚNG test này, thay vì một
    // dòng "Unhandled Errors" mà bộ chạy test dễ bỏ qua.
    const loiThoatRaTienTrinh: unknown[] = [];
    const batLoi = (loi: unknown): void => {
      loiThoatRaTienTrinh.push(loi);
    };
    process.on("uncaughtException", batLoi);
    process.on("unhandledRejection", batLoi);

    const poolMotKetNoi = new pg.Pool({ connectionString: db.connectionString, max: 1 });
    try {
      const dir = migrationDir({
        "070_tu_ngat_ket_noi.sql": "SELECT pg_terminate_backend(pg_backend_pid());",
      });

      // [fix round 4] Bản trước dùng "rejects.toThrow()" KHÔNG tham số — nó sống sót ba đột
      // biến khác nhau của chính bản vá nó canh (bỏ listener 'error'; đổi release(err) thành
      // release(); bỏ try/catch quanh ROLLBACK). Hai khẳng định dưới đây khoá hai trong ba:
      //  - regex tên file: nếu bỏ try/catch quanh ROLLBACK, lỗi của chính ROLLBACK thay thế
      //    lỗi gốc và thông báo tụt xuống "Connection terminated unexpectedly" — mất tên
      //    migration thật sự gây lỗi, đúng thứ người trực đêm cần đọc đầu tiên;
      //  - totalCount === 0: release(err) yêu cầu pg-pool HUỶ client hỏng khỏi sổ sách;
      //    release() trần để nó nằm lại pool ở trạng thái hỏng (totalCount vẫn 1).
      await expect(migrate(poolMotKetNoi, dir)).rejects.toThrow(/070_tu_ngat_ket_noi\.sql/);
      expect(poolMotKetNoi.totalCount).toBe(0);

      const hetGio = new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("timeout: pool.query() treo sau khi mất kết nối")),
          5000,
        );
      });
      await expect(
        Promise.race([poolMotKetNoi.query("SELECT 1"), hetGio]),
      ).resolves.toBeTruthy();

      // pg phát 'error' trên Client một nhịp sau khi socket đứt — chờ nó lắng rồi mới đọc.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(loiThoatRaTienTrinh.map((e) => (e as Error).message)).toEqual([]);
    } finally {
      process.off("uncaughtException", batLoi);
      process.off("unhandledRejection", batLoi);
      await poolMotKetNoi.end();
    }
  });

  // [fix I3 — cơ chế chung] File "*.always.sql" chạy lại ở MỌI lần gọi migrate(), không qua
  // schema_migrations, và không xuất hiện trong mảng "applied" trả về (nó không phải một
  // migration một-lần). Test bằng cách đếm số lần thực thi qua một bảng đếm — nếu chạy lại
  // đúng như thiết kế, số đếm tăng ở mỗi lần gọi migrate(), kể cả khi không có migration đánh
  // số mới nào để áp dụng.
  //
  // [vòng fix 1 — I3] Số lần mỗi lời gọi là BA, không phải một: 'sua' trước vòng migration đánh
  // số, rồi 'sua' và 'phan_xet' sau vòng đó (lý do đầy đủ ở khối "BA LƯỢT" đầu
  // db/migrations/hardening.always.sql). Con số đó được khoá ở đây có chủ đích — nó là thứ
  // biến "always.sql phải idempotent" từ một lời khuyên thành một ràng buộc đo được: fixture
  // dưới đây cố ý KHÔNG idempotent (INSERT trần) nên nó đếm được đúng số lượt.
  it("[fix I3 — cơ chế chung] file *.always.sql chạy lại BA lượt mỗi lần migrate(), không ghi vào schema_migrations", async () => {
    const dir = migrationDir({
      "080_binh_thuong.sql": "CREATE TABLE mig_j (id int);",
      "hardening_gia_lap.always.sql":
        "CREATE TABLE IF NOT EXISTS mig_j_dem (danh_dau int); INSERT INTO mig_j_dem VALUES (1);",
    });

    const ketQua1 = await migrate(db.pool, dir);
    expect(ketQua1).toEqual(["080_binh_thuong.sql"]); // always.sql KHÔNG có trong applied

    const demSauLan1 = await db.pool.query<{ dem: string }>(
      "SELECT count(*) AS dem FROM mig_j_dem",
    );
    expect(Number(demSauLan1.rows[0]?.dem), "một lần migrate() = ba lượt always.sql").toBe(3);

    const ketQua2 = await migrate(db.pool, dir);
    expect(ketQua2).toEqual([]); // 080 đã áp dụng — nhưng always.sql vẫn chạy lại

    const { rows } = await db.pool.query<{ dem: string }>(
      "SELECT count(*) AS dem FROM mig_j_dem",
    );
    expect(Number(rows[0]?.dem)).toBe(6);
  });

  // [vòng fix 1 — I3] Lượt 'sua' phải chạy TRƯỚC vòng migration đánh số, và lượt 'phan_xet'
  // SAU. Không có khẳng định này thì hai lượt có thể bị đảo hoặc gộp mà không test nào đỏ —
  // trong khi toàn bộ giá trị của thiết kế nằm ở đúng thứ tự đó: 001 GRANT cho app_api nên
  // lượt trước-vòng phải tồn tại, và chỉ lượt sau-vòng mới NHÌN THẤY migration vừa đưa vào.
  it("[vòng fix 1 — I3] always.sql chạy quanh vòng migration đánh số theo đúng thứ tự sua → (đánh số) → sua → phan_xet", async () => {
    const dir = migrationDir({
      "081_ghi_dau.sql": "INSERT INTO mig_k_nhat_ky (buoc) VALUES ('danh_so');",
      "nhat_ky.always.sql":
        "CREATE TABLE IF NOT EXISTS mig_k_nhat_ky (thu_tu serial, buoc text);\n" +
        "INSERT INTO mig_k_nhat_ky (buoc) VALUES " +
        "(coalesce(nullif(current_setting('app.hardening_che_do', true), ''), 'day_du'));",
    });

    await migrate(db.pool, dir);

    const { rows } = await db.pool.query<{ buoc: string }>(
      "SELECT buoc FROM mig_k_nhat_ky ORDER BY thu_tu",
    );
    expect(rows.map((r) => r.buoc)).toEqual(["sua", "danh_so", "sua", "phan_xet"]);
  });

  /**
   * [Task 6 — vòng fix 2 — M4] `SET lock_timeout = 0` trên kết nối của migrate() KHÔNG được
   * thay bằng một giá trị hữu hạn "đủ dài".
   *
   * Test S22 của vòng fix 1 chỉ chứng minh "đủ dài": đột biến `0` -> `60000` SỐNG SÓT qua toàn
   * bộ suite. Trên một lược đồ lớn, một lượt DDL dài hơn giá trị hữu hạn ấy tái sinh đúng chế
   * độ hỏng mà [IM7] mở ra — `lock_timeout` của pool ứng dụng áp CẢ cho khoá tư vấn (đã đo),
   * nên nó huỷ chính cơ chế chống-đua mà migrate() dựa vào từ Task 1.
   *
   * Đo TRỰC TIẾP trên kết nối của migrate(), không phải bằng một khẳng định văn bản: một file
   * `.always.sql` chạy trên đúng `lockClient`, nên nó đọc được GUC hiệu lực thật ở đó. Phép đo
   * này vẫn đỏ nếu ai đó chuyển hai câu SET đi nơi khác rồi quên.
   */
  it("[Task 6 — vòng fix 2 — M4] kết nối của migrate() mang lock_timeout/idle_in_tx = 0, không phải giá trị hữu hạn", async () => {
    const dir = migrationDir({
      "082_khong_lam_gi.sql": "SELECT 1;",
      "do_guc.always.sql":
        "CREATE TABLE IF NOT EXISTS mig_l_guc (thu_tu serial, lock_timeout text, idle_tx text);\n" +
        "INSERT INTO mig_l_guc (lock_timeout, idle_tx) VALUES (current_setting('lock_timeout'), " +
        "current_setting('idle_in_transaction_session_timeout'));",
    });

    // Pool ỨNG DỤNG: createPool đặt hai GUC qua PGOPTIONS. Nếu migrate() không vô hiệu hoá
    // chúng thì chính giá trị này sẽ đọc được bên trong.
    const poolUngDung = createPool(db.connectionString, 2, {
      lockTimeoutMs: 200,
      idleInTransactionTimeoutMs: 300,
    });
    try {
      await migrate(poolUngDung, dir);
    } finally {
      await poolUngDung.end();
    }

    const { rows } = await db.pool.query<{ lock_timeout: string; idle_tx: string }>(
      "SELECT lock_timeout, idle_tx FROM mig_l_guc ORDER BY thu_tu",
    );
    expect(rows.length, "một lần migrate() = ba lượt always.sql").toBe(3);
    expect(rows.map((r) => r.lock_timeout)).toEqual(["0", "0", "0"]);
    expect(rows.map((r) => r.idle_tx)).toEqual(["0", "0", "0"]);
  });

  // [fix round 4 — N1] pool.connect() trả về CÙNG MỘT đối tượng Client khi client đó được
  // tái sử dụng. Bản trước gắn lockClient.on("error", ...) ở mỗi lần gọi mà không bao giờ
  // gỡ, nên số listener bằng đúng số lần gọi migrate() — đã đo trên bản trước bản vá:
  // "sau 1 lan = 1, sau 15 lan = 15", kèm "MaxListenersExceededWarning: ... 11 error
  // listeners added to [Client]". Tiến trình gọi migrate() định kỳ (health-check, retry
  // blue/green) tích tụ vô hạn. So sánh số listener sau 1 lần với sau 15 lần: rò rỉ thì
  // chênh lệch đúng bằng 14.
  it("[fix round 4 — N1] gọi migrate() nhiều lần không tích luỹ listener 'error' trên client tái dùng", async () => {
    const poolMotKetNoi = new pg.Pool({ connectionString: db.connectionString, max: 1 });
    try {
      const dir = migrationDir({ "090_dem_listener.sql": "CREATE TABLE mig_k (id int);" });

      await migrate(poolMotKetNoi, dir);
      const clientDau = await poolMotKetNoi.connect();
      const demSauMotLan = clientDau.listenerCount("error");
      clientDau.release();

      for (let i = 0; i < 14; i++) await migrate(poolMotKetNoi, dir);
      const clientSau = await poolMotKetNoi.connect();
      const demSauMuoiLamLan = clientSau.listenerCount("error");
      clientSau.release();

      expect(demSauMuoiLamLan).toBe(demSauMotLan);
    } finally {
      await poolMotKetNoi.end();
    }
  });

  // [fix round 4 — Minor] "CREATE TABLE IF NOT EXISTS schema_migrations" phải nằm TRONG
  // advisory lock. Bản trước chạy nó bằng pool.query() TRƯỚC khi lấy khoá: hai migrate()
  // đồng thời trên một CSDL TRỐNG (hai pod cùng khởi động lần đầu) đua nhau và một bên vỡ
  // với "duplicate key value violates unique constraint \"pg_type_typname_nsp_index\"" —
  // mâu thuẫn trực tiếp với docstring của migrate() nói hai tiến trình "không giẫm lên
  // nhau". IF NOT EXISTS không chống được đua này.
  //
  // Test XÁC ĐỊNH thay vì đua thật: giữ sẵn advisory lock từ một kết nối khác, gọi migrate()
  // trên một database HOÀN TOÀN trống, rồi khẳng định schema_migrations VẪN CHƯA tồn tại
  // trong lúc migrate() còn đang chờ khoá. Nếu CREATE TABLE nằm ngoài khoá, bảng đã có mặt.
  it("[fix round 4] CREATE TABLE schema_migrations nằm trong advisory lock, không chạy trước khi có khoá", async () => {
    // Trùng với MIGRATION_LOCK_KEY trong packages/db/src/migrate.ts — cố ý không export ra
    // mặt tiền công khai chỉ để phục vụ test.
    const KHOA_MIGRATION = 727_100_003;
    const TEN_DB = "tp_kiem_tra_khoa";

    await db.pool.query(`CREATE DATABASE ${TEN_DB}`);
    const urlDbTrong = new URL(db.connectionString);
    urlDbTrong.pathname = `/${TEN_DB}`;
    const csDbTrong = urlDbTrong.toString();

    const poolGiuKhoa = new pg.Pool({ connectionString: csDbTrong, max: 1 });
    const poolMigrate = new pg.Pool({ connectionString: csDbTrong, max: 2 });
    const loiPool = theoDoiLoiPool(poolGiuKhoa, poolMigrate);
    let ketNoiConLai = -1;
    try {
      const clientGiuKhoa = await poolGiuKhoa.connect();
      await clientGiuKhoa.query("SELECT pg_advisory_lock($1)", [KHOA_MIGRATION]);

      const dir = migrationDir({ "100_sau_khoa.sql": "CREATE TABLE mig_l (id int);" });
      const dangChay = migrate(poolMigrate, dir);

      // Cho migrate() đủ thời gian chạy tới chỗ chờ khoá.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const { rows } = await poolMigrate.query<{ bang: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS bang",
      );
      expect(rows[0]?.bang).toBeNull();

      await clientGiuKhoa.query("SELECT pg_advisory_unlock($1)", [KHOA_MIGRATION]);
      clientGiuKhoa.release();

      await expect(dangChay).resolves.toEqual(["100_sau_khoa.sql"]);
    } finally {
      await poolGiuKhoa.end();
      await poolMigrate.end();
      ketNoiConLai = await xoaDatabaseSauKhiHetKetNoi(db.pool, TEN_DB);
    }

    // Ngoài `finally` một cách CÓ CHỦ ĐÍCH: nếu thân test đã đỏ, lỗi gốc phải là lỗi được báo,
    // và hai khẳng định dọn dẹp này không được chen vào che nó.
    expect(ketNoiConLai, `còn ${ketNoiConLai} kết nối bám vào ${TEN_DB} sau khi đã end() cả hai pool`).toBe(0);
    expect(loiPool).toEqual([]);
  });

  // [fix round 5 — M10 + Minor] Vòng 4 khai rằng không dựng được ca xác định phân biệt
  // release(err) với release() trần; reviewer chỉ ra ca đó chỉ cần một câu SQL: thu hồi
  // EXECUTE trên chính pg_advisory_unlock rồi chạy migrate() dưới role không phải superuser.
  // Khi ấy unlock ném 42501 TRONG KHI KẾT NỐI VẪN SỐNG — khác hẳn ca cũ (backend bị giết),
  // nơi socket đã đứt trước lúc release() nên pg-pool huỷ client theo cả hai đường.
  //
  // Hai đại lượng được khẳng định, đại lượng thứ hai mới là đại lượng nghiêm trọng:
  //   release(err): total=0 idle=0, 0 advisory lock còn giữ
  //   release()   : total=1 idle=1, 1 advisory lock CÒN GIỮ  <- client hỏng nằm trong pool
  //                 vẫn đang giữ khoá migration, nên mọi migrate() sau đó trên pool ấy chờ
  //                 vĩnh viễn một khoá không ai nhả.
  // Đồng thời khoá luôn Minor "nhánh catch của unlock không log, không rethrow": trước bản
  // vá, migrate() ở đây trả QUA bình thường và lỗi 42501 biến mất hoàn toàn.
  it("[fix round 5 — M10] unlock bị từ chối quyền khi kết nối còn sống: không rò rỉ client, không kẹt advisory lock, lỗi không biến mất", async () => {
    // Database riêng: test này phải TỰ ĐỦ, không mượn schema_migrations do test trước tạo.
    // (Bản đầu của chính test này mượn, và khi chạy một mình bằng "vitest -t" thì đỏ vì
    // "relation schema_migrations does not exist" — tức là nó ĐỎ vì lý do sai, làm hỏng
    // luôn giá trị kiểm chứng bằng đột biến.)
    const TEN_DB = "tp_kiem_tra_mo_khoa";
    const TEN_ROLE = "khong_sieu_quyen";
    await db.pool.query(`CREATE DATABASE ${TEN_DB}`);
    await db.pool.query(`CREATE ROLE ${TEN_ROLE} LOGIN PASSWORD 'mat-khau-kiem-thu'`);

    const urlSieuQuyen = new URL(db.connectionString);
    urlSieuQuyen.pathname = `/${TEN_DB}`;
    const urlThuong = new URL(urlSieuQuyen.toString());
    urlThuong.username = TEN_ROLE;
    urlThuong.password = "mat-khau-kiem-thu";

    const poolSieuQuyen = new pg.Pool({ connectionString: urlSieuQuyen.toString(), max: 1 });
    const poolThuong = new pg.Pool({ connectionString: urlThuong.toString(), max: 2 });
    const loiPool = theoDoiLoiPool(poolSieuQuyen, poolThuong);
    let ketNoiConLai = -1;
    try {
      await poolSieuQuyen.query(`GRANT CREATE, USAGE ON SCHEMA public TO ${TEN_ROLE}`);
      // Đây là toàn bộ mẹo dựng ca: lock vẫn chạy được, unlock thì không.
      await poolSieuQuyen.query(
        "REVOKE EXECUTE ON FUNCTION pg_advisory_unlock(bigint) FROM PUBLIC",
      );

      const dir = migrationDir({ "110_mo_khoa.sql": "CREATE TABLE mig_m (id int);" });

      // Lỗi KHÔNG được biến mất: migrate() phải ném, và nói rõ là chuyện advisory lock.
      await expect(migrate(poolThuong, dir)).rejects.toThrow(/advisory lock/);

      expect(poolThuong.totalCount).toBe(0);
      expect(poolThuong.idleCount).toBe(0);

      const { rows } = await poolSieuQuyen.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' " +
          "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await poolThuong.end();
      await poolSieuQuyen.end();
      ketNoiConLai = await xoaDatabaseSauKhiHetKetNoi(db.pool, TEN_DB);
      await db.pool.query(`DROP ROLE IF EXISTS ${TEN_ROLE}`);
    }

    // Cùng lý do như test trên: đặt NGOÀI `finally` để không nuốt lỗi gốc.
    expect(ketNoiConLai, `còn ${ketNoiConLai} kết nối bám vào ${TEN_DB} sau khi đã end() cả hai pool`).toBe(0);
    expect(loiPool).toEqual([]);
  });
});
