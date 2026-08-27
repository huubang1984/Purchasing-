import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

// Khoá advisory tuỳ ý nhưng cố định cho toàn dự án — chỉ dùng để loại trừ lẫn nhau giữa
// các tiến trình migrate() chạy đồng thời (vd. hai pod cùng khởi động, blue/green deploy).
// Không liên quan tới bất kỳ khoá nghiệp vụ nào khác nên chọn một số bất kỳ đủ lớn để
// tránh trùng ngẫu nhiên với khoá advisory khác mà hệ thống có thể dùng sau này.
const MIGRATION_LOCK_KEY = 727_100_003;

// [fix I3] Tên file cưỡng chế chạy LẠI mỗi lần migrate() được gọi (vd. thuộc tính role),
// không qua schema_migrations. Xem db/migrations/hardening.always.sql để biết lý do.
const HAU_TO_LUON_CHAY = ".always.sql";

function tinhChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * Áp dụng các file .sql trong `dir` theo thứ tự tên, mỗi file trong một transaction riêng.
 * Migration đã áp dụng được ghi vào schema_migrations kèm checksum nội dung và không chạy
 * lại. Toàn bộ vòng lặp được bọc trong một advisory lock để hai tiến trình migrate() chạy
 * đồng thời trên cùng CSDL không giẫm lên nhau.
 *
 * File có hậu tố ".always.sql" chạy LẠI ở MỌI lần gọi, trước các migration đánh số, và
 * không được ghi vào `applied` trả về — dùng cho cưỡng chế cấu hình cần tự sửa lại nếu bị
 * trôi sau triển khai (vd. thuộc tính role), khác với thay đổi lược đồ một-lần.
 *
 * [fix round 4 — Minor] RÀNG BUỘC của ".always.sql": giống mọi migration đánh số, nội dung
 * file được chạy TRONG một BEGIN/COMMIT tường minh, nên KHÔNG dùng được lệnh không chạy
 * trong transaction: CREATE DATABASE, DROP DATABASE, CREATE TABLESPACE, VACUUM,
 * CREATE INDEX CONCURRENTLY, ALTER TYPE ... ADD VALUE (trước PG12)... Postgres sẽ báo
 * "CREATE DATABASE cannot run inside a transaction block". Đây là đánh đổi có chủ đích:
 * một hardening chạy nửa chừng rồi lỗi sẽ để lại cấu hình an ninh ở trạng thái lai — tính
 * nguyên tử quan trọng hơn khả năng chạy lệnh phi-transaction ở đây.
 *
 * Cố ý dùng SQL thuần thay vì thư viện migration: lược đồ này phụ thuộc nặng vào RLS,
 * trigger và GRANT/REVOKE — những thứ cần đọc được nguyên văn khi kiểm toán.
 */
export async function migrate(pool: pg.Pool, dir: string): Promise<string[]> {
  // [fix I4] TOÀN BỘ vòng lặp chạy trên đúng MỘT client (lockClient) — không xin thêm
  // client nào khác từ pool trong lúc giữ khoá. Bản trước dùng pool.query()/pool.connect()
  // NGOÀI lockClient trong lúc vẫn giữ lockClient checked-out; với pool có max: 1 (mà
  // createPool(cs, max) cho phép người gọi tự chọn), không còn client nào để cấp — migrate()
  // treo VĨNH VIỄN, không timeout (tự kiểm chứng: treo qua mốc 5s trong test, không tự thoát).
  const lockClient = await pool.connect();

  // [fix I1] Trong lúc client đang CHECKED-OUT, pg-pool KHÔNG gắn listener 'error' nào lên nó
  // (chỉ gắn khi client rảnh nằm trong pool — xem pg-pool/index.js makeIdleListener/
  // _acquireClient). Nếu kết nối chết giữa chừng (backend bị terminate, mất mạng...), sự
  // kiện 'error' không ai nghe sẽ ném ra và GIẾT CẢ TIẾN TRÌNH Node — đã tự đo bằng pg.Pool
  // thật: "Emitted 'error' event on Client instance" -> unhandled, crash. Gắn listener rỗng
  // ở đây để sự kiện có nơi tiêu thụ; lỗi thật vẫn nổi lên qua promise reject của câu lệnh
  // đang chạy, không bị nuốt bởi việc này.
  //
  // [fix round 4 — N1] Listener PHẢI được gỡ trong finally. pool.connect() trả về CÙNG MỘT
  // đối tượng Client mỗi lần khi client đó được tái sử dụng, nên một listener gắn mà không
  // gỡ sẽ tích luỹ theo số lần gọi migrate(): đã tự đo trên pg.Pool thật —
  // "sau 1 lan = 1, sau 15 lan = 15" kèm "MaxListenersExceededWarning: ... 11 error
  // listeners added to [Client]". Tiến trình gọi migrate() định kỳ (health-check, retry
  // blue/green) sẽ tích tụ vô hạn. Giữ tham chiếu tới đúng hàm đã gắn để off() được.
  const boQuaLoiKetNoi = (): void => {};
  lockClient.on("error", boQuaLoiKetNoi);

  // [fix round 5 — Minor] Nhả khoá + trả client về pool. Trả về lỗi thay vì ném, để người
  // gọi quyết định: lỗi dọn dẹp KHÔNG được che lỗi gốc của migration (xem [fix I1] về
  // ROLLBACK — cùng một nguyên tắc), nhưng cũng KHÔNG được biến mất khi migration thành
  // công. Bản trước nuốt trọn nhánh catch này: đã đo thật, "REVOKE EXECUTE ON FUNCTION
  // pg_advisory_unlock(bigint) FROM PUBLIC" rồi chạy migrate() dưới role non-superuser cho
  // ra "migrate -> QUA" trong khi unlock đã ném 42501 — lỗi biến mất hoàn toàn.
  let daDonDep = false;
  const nhaKhoaVaTraClient = async (): Promise<Error | null> => {
    // Chốt chạy-một-lần: nhánh catch bên dưới gọi lại hàm này sau khi nhánh thành công đã
    // gọi rồi (lỗi "không nhả được khoá" ném ra TỪ TRONG try). Gọi release() hai lần trên
    // cùng một client là lỗi của pg-pool, nên chặn ở đây thay vì nhân đôi luồng điều khiển.
    if (daDonDep) return null;
    daDonDep = true;
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      // [fix round 4 — N1] Gỡ listener 'error' đã gắn ở trên TRƯỚC release() trên CẢ HAI
      // nhánh — client quay lại pool là cùng một đối tượng sẽ được lần migrate() sau lấy lại.
      lockClient.off("error", boQuaLoiKetNoi);
      lockClient.release();
      return null;
    } catch (loiKhiMoKhoa) {
      // [fix I1] Bản trước: "await lockClient.query(unlock); lockClient.release();" — nếu
      // unlock ném lỗi, release() KHÔNG BAO GIỜ CHẠY, client rò rỉ vĩnh viễn trong sổ sách
      // của pool (vẫn tính là "checked out"): pool.query()/pool.end() sau đó TREO VĨNH VIỄN
      // trên pool max:1.
      //
      // [fix round 5 — M10] release(err) chứ không release() trần, và đây là chỗ khác biệt
      // ĐO ĐƯỢC giữa hai biến thể — trong ca unlock ném 42501 mà KẾT NỐI VẪN SỐNG:
      //   release(err): pg-pool huỷ client        -> total=0 idle=0, 0 advisory lock còn giữ
      //   release()   : client hỏng quay lại pool -> total=1 idle=1, 1 advisory lock CÒN GIỮ
      // Vế thứ hai mới là vế nghiêm trọng: client nằm trong pool VẪN ĐANG GIỮ khoá migration,
      // nên mọi migrate() sau đó trên pool ấy chờ vĩnh viễn một khoá không ai nhả.
      lockClient.off("error", boQuaLoiKetNoi);
      lockClient.release(loiKhiMoKhoa as Error);
      return loiKhiMoKhoa as Error;
    }
  };

  try {
    // pg_advisory_lock chặn tới khi có được khoá — tiến trình migrate() thứ hai chạy đồng
    // thời sẽ đợi ở đây thay vì đua vào cùng một transaction DDL với tiến trình thứ nhất.
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    // [fix round 4 — Minor] CREATE TABLE này phải nằm TRONG advisory lock. Bản trước gọi
    // pool.query(...) TRƯỚC khi lấy khoá: hai migrate() đồng thời trên một CSDL TRỐNG (hai
    // pod cùng khởi động lần đầu) đua nhau tạo cùng một bảng và một bên vỡ với
    // "duplicate key value violates unique constraint \"pg_type_typname_nsp_index\"" —
    // mâu thuẫn trực tiếp với lời hứa "không giẫm lên nhau" ở docstring trên. IF NOT EXISTS
    // KHÔNG chống được đua này: nó chỉ kiểm tra tại thời điểm bắt đầu, không khoá tên kiểu.
    await lockClient.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (" +
        "version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );

    const tatCaFile = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const fileLuonChay = tatCaFile.filter((f) => f.endsWith(HAU_TO_LUON_CHAY));
    const fileDanhSo = tatCaFile.filter((f) => !f.endsWith(HAU_TO_LUON_CHAY));

    for (const file of fileLuonChay) {
      const sql = await readFile(join(dir, file), "utf8");
      try {
        await lockClient.query("BEGIN");
        await lockClient.query(sql);
        await lockClient.query("COMMIT");
      } catch (error) {
        try {
          await lockClient.query("ROLLBACK");
        } catch {
          // Kết nối có thể đã chết ngay trong lúc chạy (xem [fix I1]) — không còn gì để
          // rollback trên một kết nối đã đứt. Ưu tiên ném lỗi GỐC kèm tên file bên dưới,
          // không phải lỗi thất bại của chính ROLLBACK.
        }
        throw new Error(`Hardening ${file} thất bại: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }

    const applied: string[] = [];

    for (const file of fileDanhSo) {
      const sql = await readFile(join(dir, file), "utf8");
      const checksum = tinhChecksum(sql);

      const existing = await lockClient.query<{ checksum: string }>(
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

      try {
        await lockClient.query("BEGIN");
        await lockClient.query(sql);
        await lockClient.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [file, checksum],
        );
        await lockClient.query("COMMIT");
        applied.push(file);
      } catch (error) {
        try {
          await lockClient.query("ROLLBACK");
        } catch {
          // [fix I1] Kết nối có thể đã chết ngay trong lúc chạy migration này (backend bị
          // terminate, mất mạng...) — không còn gì để rollback trên một kết nối đã đứt. Ưu
          // tiên ném lỗi GỐC kèm tên file bên dưới, không phải lỗi thất bại của chính
          // ROLLBACK (đã tự đo: nếu không bọc try/catch riêng ở đây, lỗi "Client has
          // encountered a connection error" của ROLLBACK sẽ thay thế lỗi gốc, che mất tên
          // migration thật sự gây lỗi).
        }
        throw new Error(`Migration ${file} thất bại: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }

    const loiKhiMoKhoa = await nhaKhoaVaTraClient();
    if (loiKhiMoKhoa !== null) {
      throw new Error(
        `Không nhả được advisory lock của migrate() sau khi áp dụng xong: ` +
          `${loiKhiMoKhoa.message}`,
        { cause: loiKhiMoKhoa },
      );
    }
    return applied;
  } catch (loiGoc) {
    // Lỗi GỐC luôn thắng: nếu thân hàm đã hỏng thì lỗi dọn dẹp không được che nó. Kết quả
    // của nhaKhoaVaTraClient() ở đây cố ý bỏ qua — nhưng client vẫn được trả về pool đúng
    // cách trên cả hai nhánh của nó, nên không rò rỉ.
    await nhaKhoaVaTraClient();
    throw loiGoc;
  }
}
