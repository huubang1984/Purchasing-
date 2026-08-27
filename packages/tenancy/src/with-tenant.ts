import type pg from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lỗi thuộc về GIAO THỨC của withTenant(), phân biệt với lỗi do chính `fn` hay Postgres ném.
 * Hai trường hợp, cả hai đều nghĩa là KHÔNG có thay đổi nào được ghi:
 *   - `orgId` không phải UUID hợp lệ (từ chối trước khi mở kết nối);
 *   - transaction đã hỏng nên COMMIT bị Postgres âm thầm chuyển thành ROLLBACK.
 */
export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

/**
 * Chạy `fn` trong một transaction đã gắn tổ chức.
 *
 * `set_config(..., true)` giới hạn biến trong phạm vi transaction, nên giá trị tự biến mất khi
 * commit hoặc rollback. Điều này quan trọng với connection pool: kết nối trả về pool không mang
 * theo tổ chức của lần dùng trước.
 *
 * Mọi truy cập dữ liệu có org_id BẮT BUỘC đi qua hàm này. Đây là điểm duy nhất gắn tenant
 * context, để không có đường vòng nào bỏ qua RLS (bất biến F1).
 *
 * Phạm vi bảo đảm — nói rõ để không ai trích dẫn quá lời: hàm này gắn ĐÚNG một tổ chức khi mở
 * transaction. Nó KHÔNG ngăn được `fn` tự gọi set_config('app.org_id', ...) lần nữa để đổi
 * sang tổ chức khác; app.org_id là GUC tuỳ biến thông thường, mọi phiên đều đặt được. Lớp
 * phòng thủ đó là code review và bất biến F, không phải hàm này.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(orgId)) {
    // Cố ý KHÔNG nội suy giá trị bị từ chối vào thông báo: thông báo lỗi đi vào log, và khuôn
    // "ném dữ liệu đầu vào vào message" là thứ được sao chép sang chỗ mà dữ liệu ĐÚNG LÀ bí
    // mật (giá thầu, token, mã OTP). Giữ khuôn an toàn ngay từ nơi vô hại nhất.
    throw new TenantError("orgId không phải UUID hợp lệ");
  }

  const client = await pool.connect();

  // Trong lúc client đang CHECKED-OUT, pg-pool KHÔNG gắn listener 'error' nào lên nó (chỉ gắn
  // khi client rảnh nằm trong pool). Nếu kết nối chết giữa chừng — backend bị terminate, mất
  // mạng — sự kiện 'error' không ai nghe sẽ ném ra và GIẾT CẢ TIẾN TRÌNH Node. Đã tự đo bằng
  // pg.Pool thật trong lúc viết hàm này: "Emitted 'error' event on Client instance" ->
  // unhandled -> tiến trình thoát. Đây là đúng lỗ hổng [fix I1] mà packages/db/src/migrate.ts
  // đã đóng; withTenant() chạy trên MỌI request nên nó còn phơi ra nhiều hơn migrate().
  //
  // Listener PHẢI được gỡ trước release(): pool.connect() trả về CÙNG MỘT đối tượng Client khi
  // client đó được tái sử dụng, nên listener gắn mà không gỡ sẽ tích luỹ theo số lời gọi và
  // sinh MaxListenersExceededWarning (xem [fix round 4 — N1] ở migrate.ts).
  const boQuaLoiKetNoi = (): void => {};
  client.on("error", boQuaLoiKetNoi);

  // Client bị "đầu độc" (transaction dở dang, kết nối chết) không được quay lại pool: pg-pool
  // huỷ nó khi release(err), còn release() trần thì trả nó về cho người dùng kế tiếp. Xem
  // cùng bài học ở packages/db/src/migrate.ts [fix round 5 — M10].
  let loiLamHongClient: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const ketQua = await fn(client);

    // Đã đo trên PostgreSQL 16.15 (pg@8.23.0): COMMIT trên một transaction ĐANG HỎNG không ném
    // lỗi — nó trả về command tag "ROLLBACK". Không kiểm ở đây thì withTenant() báo THÀNH CÔNG
    // cho người gọi trong khi mọi thay đổi đã bị vứt: một try/catch phòng thủ đặt sai chỗ bên
    // trong `fn` là đủ để dựng ra ca đó.
    const ketThuc = await client.query("COMMIT");
    if (ketThuc.command !== "COMMIT") {
      throw new TenantError(
        `Transaction không commit được: Postgres trả về "${ketThuc.command}" thay vì COMMIT — ` +
          "một truy vấn bên trong đã lỗi và lỗi đó bị nuốt. Không thay đổi nào được ghi.",
      );
    }
    return ketQua;
  } catch (loi) {
    try {
      await client.query("ROLLBACK");
    } catch (loiKhiRollback) {
      // Kết nối có thể đã chết ngay trong lúc chạy — không còn gì để rollback trên một kết nối
      // đã đứt. Ưu tiên ném lỗi GỐC (cùng nguyên tắc với migrate() [fix I1]); lỗi của chính
      // ROLLBACK chỉ dùng để đánh dấu client là hỏng, không được thay thế nguyên nhân thật.
      loiLamHongClient = loiKhiRollback as Error;
    }
    throw loi;
  } finally {
    client.off("error", boQuaLoiKetNoi);
    client.release(loiLamHongClient);
  }
}
