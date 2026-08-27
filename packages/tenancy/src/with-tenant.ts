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
 * `set_config(..., true)` giới hạn biến trong phạm vi transaction, nên giá trị do CHÍNH hàm này
 * đặt tự biến mất khi commit hoặc rollback.
 *
 * [vòng fix 1 — I1] Bản trước tuyên bố VÔ ĐIỀU KIỆN "kết nối trả về pool không mang theo tổ
 * chức của lần dùng trước". Đo được ca mang theo, và cơ chế đáng ghi lại vì phép kiểm command
 * tag ở dưới KHÔNG bắt được nó: `COMMIT` chạy NGOÀI transaction cũng trả về tag "COMMIT" (chỉ
 * kèm một warning). Nên nếu `fn` tự kết thúc transaction rồi gọi
 * `set_config('app.org_id', ..., false)` (phạm vi PHIÊN), withTenant() báo thành công và giá
 * trị SỐNG SÓT trên client trả về pool. Đo trên PostgreSQL 16.15 / pg@8.23.0:
 *     COMMIT trong tx -> "COMMIT" · COMMIT NGOÀI tx -> "COMMIT" (không ném lỗi)
 *     sau withTenant "bình thường": current_setting('app.org_id') = <tổ chức của fn>
 *     lần dùng kết nối kế tiếp (không qua withTenant): CÙNG giá trị đó
 * Từ đó mọi `pool.query()` trên kết nối ấy chạy dưới tổ chức sai, VĨNH VIỄN cho tới khi client
 * bị huỷ. Nay khối `finally` đọc lại GUC và HUỶ kết nối nếu còn sót — biến một rò rỉ im lặng
 * thành một kết nối bị bỏ đi. Huỷ cả kết nối chứ không chỉ RESET đúng `app.org_id`: `fn` đã
 * chứng minh nó để lại trạng thái phiên, và những thứ khác nó có thể để lại (`SET ROLE`,
 * `search_path`, `statement_timeout`) cũng đi theo kết nối. Giá phải trả, nói rõ: một lượt
 * round-trip thêm cho MỌI lời gọi withTenant().
 *
 * Bảo đảm hiện tại, phát biểu đúng phạm vi: kết nối trả về pool KHÔNG mang theo `app.org_id`
 * — hoặc vì nó chưa bao giờ vượt ra khỏi transaction, hoặc vì kết nối đã bị huỷ thay vì trả về.
 *
 * Mọi truy cập dữ liệu có org_id BẮT BUỘC đi qua hàm này. Đây là điểm duy nhất gắn tenant
 * context, để không có đường vòng nào bỏ qua RLS (bất biến F1).
 *
 * [vòng fix 3 — I1] GHIM TÊN HÀM: mọi lời gọi hàm hệ thống trong hàm này viết đủ
 * `pg_catalog.`. Quy tắc "pg_catalog được tìm NGẦM trước" PHÁ ĐƯỢC — nó chỉ đúng khi
 * pg_catalog KHÔNG được nêu tên; nêu tên nó ở vị trí SAU thì mọi schema đứng trước được tìm
 * trước. Đã đo trên PostgreSQL 16.15, cả hai biến thể cho ra DỮ LIỆU CỦA TỔ CHỨC KHÁC:
 *     ALTER ROLE <role đăng nhập> SET search_path = doc, pg_catalog, public
 *     chuỗi kết nối ?options=-c search_path=doc,pg_catalog,public
 * cộng một `doc.set_config(text, text, boolean)` chuyển hướng giá trị -> withTenant(orgA)
 * đọc ra người dùng của tổ chức B. Biến thể thứ hai KHÔNG BAO GIỜ bị hardening phát hiện
 * (rolconfig sạch, pg_db_role_setting sạch).
 *
 * Vì sao lỗ này chỉ tồn tại Ở ĐÂY và không ở packages/db/src/migrate.ts: migrate() GHIM
 * `SET search_path = public` làm câu lệnh đầu tiên trên kết nối của nó. Hàm này chạy trên
 * pool ỨNG DỤNG, dùng chung với mã nghiệp vụ, nên nó KHÔNG được phép đặt search_path của
 * người gọi — ghim tên hàm là cách duy nhất còn lại.
 *
 * Phạm vi của việc ghim, nói đúng mức: nó bảo vệ ba câu lệnh của CHÍNH hàm này. Truy vấn do
 * `fn` viết vẫn chạy dưới search_path của người gọi — nhưng biểu thức của policy RLS thì
 * KHÔNG: PostgreSQL lưu policy dưới dạng OID đã phân giải, nên search_path lúc chạy không
 * đổi được hàm mà policy gọi (đã đo ở db/migrations.int.test.ts "[fix S3] ...").
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
    // [vòng fix 3 — I1] pg_catalog.set_config, KHÔNG phải set_config trần. Xem khối
    // "GHIM TÊN HÀM" ở docstring: đây là đường DUY NHẤT trong repo chạy dưới một
    // search_path mà dự án không kiểm soát, nên nó là chỗ DUY NHẤT lời gọi trần thật sự
    // cướp được.
    await client.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [orgId]);
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
    // [vòng fix 1 — I1] Xem giải thích dài ở docstring. Chạy trên CẢ HAI đường ra (trả về
    // bình thường và ném lỗi) vì `fn` để lại trạng thái phiên được ở cả hai.
    try {
      const { rows } = await client.query<{ con_sot: string | null }>(
        // [vòng fix 3 — I1] pg_catalog.current_setting: một doc.current_setting(text, boolean)
        // trả '' luôn luôn sẽ làm phép kiểm này MÙ, và kết nối còn sót app.org_id được trả
        // về pool như thể sạch. Đây là nửa "âm tính giả" của cùng một lỗ.
        "SELECT pg_catalog.current_setting('app.org_id', true) AS con_sot",
      );
      // Cố ý KHÔNG nội suy giá trị còn sót vào thông báo — cùng lý do với nhánh UUID ở trên.
      if (rows[0]?.con_sot) {
        loiLamHongClient ??= new TenantError(
          "app.org_id còn sót sau transaction — `fn` đã đặt biến ở phạm vi PHIÊN. Kết nối bị " +
            "huỷ thay vì trả về pool.",
        );
      }
    } catch {
      // Kết nối đã chết — release(loiLamHongClient) bên dưới xử lý nốt.
    }
    client.off("error", boQuaLoiKetNoi);
    client.release(loiLamHongClient);
  }
}
