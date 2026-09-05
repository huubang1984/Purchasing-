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
 * Tuỳ chọn của `withTenant()`.
 *
 * [vòng fix 1 Task 10 — MỤC 2] `destroyConnectionWhenDone` tồn tại vì một phép đo, không vì sự cẩn
 * thận chung chung. Khối `finally` của hàm này chỉ đọc lại MỘT trục (`app.org_id`), trong khi
 * chính docstring dưới đây TỰ LIỆT KÊ `SET ROLE`, `search_path`, `statement_timeout` là những
 * thứ "cũng đi theo kết nối". Đo được trên PostgreSQL 16 / pg@8.23.0:
 *     withTenant(pool, P, fn) với fn chạy `SET search_path = doc, pg_catalog, public`
 *       -> TRONG transaction: "doc, pg_catalog, public"
 *       -> SAU khi withTenant trả về, truy vấn thẳng trên CÙNG pool: "doc, pg_catalog, public"
 * tức trạng thái phiên do `fn` để lại SỐNG SÓT trên kết nối và đi tới người dùng kế tiếp — kể
 * cả khi người dùng kế tiếp là một TỔ CHỨC KHÁC. `SET statement_timeout = 1` (phạm vi PHIÊN)
 * do handler của tổ chức P để lại làm job của tổ chức Q trên cùng kết nối chết vì
 * "canceling statement due to statement timeout".
 *
 * Ai phải bật cờ này: MỌI người gọi giao `client` cho MÃ KHÔNG THUỘC QUYỀN KIỂM SOÁT CỦA MÌNH
 * (điểm mở rộng công khai). Trước Task 10 điều đó là một tai nạn; từ `JobHandler` nó là một
 * HỢP ĐỒNG CÔNG KHAI, nên hàng rào phải là một tuỳ chọn nhìn thấy được chứ không phải một
 * lời hứa. QT1: tự chữa, KHÔNG chặn deploy — hậu quả tệ nhất là vứt thêm một kết nối mỗi lần
 * chạy handler.
 */
export interface WithTenantOptions {
  /**
   * Huỷ kết nối thay vì trả về pool, KỂ CẢ khi mọi thứ thành công. Mặc định `false` (giữ
   * nguyên hành vi của Task 7/8 cho mọi người gọi cũ).
   */
  readonly destroyConnectionWhenDone?: boolean;
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
 *
 * [vòng fix 1 Task 10 — MỤC 2] VÀ MỘT VẾ NỮA CỦA CÙNG CÂU TRÊN, nay đã ĐO: phép kiểm ở
 * `finally` chỉ có MỘT TRỤC (`app.org_id`). Trạng thái phiên KHÁC mà `fn` để lại — `search_path`,
 * `statement_timeout`, `SET ROLE` — đi theo kết nối tới người dùng kế tiếp, kể cả sang tổ chức
 * khác. Người gọi giao `client` cho mã của người khác PHẢI bật `destroyConnectionWhenDone`. Xem
 * docstring của `WithTenantOptions`.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  tuyChon: WithTenantOptions = {},
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
    // [vòng fix 1 Task 10 — MỤC 2] `true` huỷ kết nối mà KHÔNG dán nhãn "lỗi" lên nó: pg-pool
    // đọc mọi đối số truthy là "đừng trả client này về pool". Ưu tiên `loiLamHongClient` khi có,
    // vì nó mang thêm chẩn đoán cho người gọi.
    client.release(loiLamHongClient ?? (tuyChon.destroyConnectionWhenDone === true ? true : undefined));
  }
}

// ==============================================================================================
// [khoản nợ 29] GẮN MỘT PHIÊN KHÁCH — VÀ ĐÂY LÀ CHỖ A5 TRỞ THÀNH MỘT LỚP CSDL
// ==============================================================================================
// `withTenant` gắn TỔ CHỨC; nó không nói gì về việc bên trong tổ chức ấy ai được đọc của ai. Với
// người mua thì đúng — họ được đọc mọi thứ của tổ chức mình. Với một phiên khách thì đó chính là
// khoảng trống A5: phiên khách chạy dưới cùng `app_api` và cùng `app.org_id` của tổ chức người
// mua, nên RLS cô lập TỔ CHỨC chứ không cô lập nhà cung cấp với nhà cung cấp.
//
// Hàm này gắn thêm BA trục — phiên, lời mời, gói thầu — và ba chứ không một là một quyết định có
// lý do: `027` khoá `rfq_packages`/`rfq_items` theo GUC gói thầu thay vì bằng một truy vấn con vào
// `rfq_invitations`, vì một bảng xuất hiện trong vị từ policy làm MỌI role đọc bảng chủ phải có
// `SELECT` trên nó. Hai GUC dẫn xuất (`app.guest_invitation_id`, `app.guest_rfq_id`) vì thế là
// cái giá phải trả để không nới quyền của bất kỳ ai.
//
// Migration `027` cài các policy `AS RESTRICTIVE` đọc đúng những GUC mà hàm này đặt, và MẶC ĐỊNH
// của chúng là TỪ CHỐI: một kết nối đã gắn phiên khách nhìn thấy KHÔNG HÀNG NÀO ở mọi bảng ngoài
// bảy bảng của mặt khách.
//
// PHẠM VI, nói rõ để không ai trích quá lời — cùng câu với docstring của `withTenant`: hàm này
// không ngăn được `fn` tự gọi `set_config` lần nữa để đổi sang phiên khách khác. Nó cũng không
// ngăn được ai đó QUÊN dùng nó và phục vụ một yêu cầu của khách bằng `withTenant` trần. Lớp bù
// cho vế thứ hai là cổng ở tầng ứng dụng, không phải hàm này.
// ==============================================================================================

/**
 * Chạy `fn` trong một transaction gắn CẢ tổ chức LẪN phiên khách.
 *
 * BA VIỆC, theo đúng thứ tự, và không việc nào bỏ được:
 *
 *   ⑴ **DẪN XUẤT lời mời VÀ gói thầu từ hàng phiên**, không nhận chúng làm tham số. `027` so
 *     policy với `app.guest_invitation_id` và `app.guest_rfq_id`, và một GUC thì người gọi đặt gì
 *     cũng được — nên chỗ DUY NHẤT chúng được đặt là ở đây, từ một câu đọc chính `guest_sessions`
 *     nối `rfq_invitations`. Người gọi khai được một `guestSessionId`; họ không khai được một lời
 *     mời, và cũng không khai được một gói thầu.
 *
 *   ⑵ **TỪ CHỐI một phiên đã chết.** `revoked_at IS NULL AND expires_at > clock_timestamp()`.
 *     `clock_timestamp()` chứ không `now()`: `now()` đứng yên suốt transaction nên một phiên hết
 *     hạn giữa chừng vẫn qua — cùng cạm bẫy đã ghim ở D1.
 *
 *   ⑶ **ĐỌC LẠI CẢ BA GUC.** `set_config` đã ghim `pg_catalog.` nên không cướp được, nhưng một
 *     GUC KHÔNG có hiệu lực nghĩa là policy khách tương ứng của `027` thấy `NULL` và MỞ TOANG trở
 *     lại đúng khoảng trống A5. Đọc lại HAI trong ba là đủ để một lượt fail-open đi qua trên trục
 *     thứ ba, nên phép kiểm phải phủ cả ba. Fail-open trong im lặng là hướng hỏng duy nhất không
 *     chấp nhận được ở hàm này, nên nó được ĐO chứ không được tin.
 */
export async function withGuestSession<T>(
  pool: pg.Pool,
  orgId: string,
  guestSessionId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  tuyChon: WithTenantOptions = {},
): Promise<T> {
  if (!UUID_RE.test(guestSessionId)) {
    // Cố ý KHÔNG nội suy giá trị vào thông báo — cùng lý do với nhánh `orgId` của `withTenant`.
    throw new TenantError("guestSessionId không phải UUID hợp lệ");
  }
  return withTenant(
    pool,
    orgId,
    async (client) => {
      const phien = await client.query<{ invitation_id: string; rfq_id: string }>(
        "SELECT g.invitation_id, i.rfq_id FROM public.guest_sessions g " +
          "  JOIN public.rfq_invitations i " +
          "    ON i.id OPERATOR(pg_catalog.=) g.invitation_id " +
          " WHERE g.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
          "   AND g.revoked_at IS NULL " +
          "   AND g.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()",
        [guestSessionId],
      );
      const invitationId = phien.rows[0]?.invitation_id;
      const rfqId = phien.rows[0]?.rfq_id;
      if (invitationId === undefined || rfqId === undefined) {
        // Cố ý KHÔNG phân biệt "không có phiên" với "phiên đã chết": một thông điệp phân biệt
        // được hai ca ấy là một oracle cho người cầm một token đã hết hạn.
        throw new TenantError(
          "phiên khách không tồn tại trong tổ chức đang gắn, hoặc đã thu hồi/hết hạn",
        );
      }
      await client.query("SELECT pg_catalog.set_config('app.guest_session_id', $1, true)", [
        guestSessionId,
      ]);
      await client.query("SELECT pg_catalog.set_config('app.guest_invitation_id', $1, true)", [
        invitationId,
      ]);
      // Trục THỨ BA: `rfq_packages`/`rfq_items` khoá theo RFQ chứ không theo lời mời, vì một
      // truy vấn con vào `rfq_invitations` trong policy của bảng được đọc rộng nhất kho sẽ bắt
      // mọi role phải đọc được `rfq_invitations`. Xem mục (5) của `027`.
      await client.query("SELECT pg_catalog.set_config('app.guest_rfq_id', $1, true)", [rfqId]);
      const { rows } = await client.query<{
        phien: string | null;
        loi_moi: string | null;
        goi_thau: string | null;
      }>(
        "SELECT public.app_current_guest_session_id()::text AS phien, " +
          "       public.app_current_guest_invitation_id()::text AS loi_moi, " +
          "       NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '') AS goi_thau",
      );
      if (
        rows[0]?.phien !== guestSessionId ||
        rows[0]?.loi_moi !== invitationId ||
        rows[0]?.goi_thau !== rfqId
      ) {
        throw new TenantError(
          "GUC phiên khách KHÔNG có hiệu lực sau khi đặt. Mọi policy khách của 027 sẽ đọc NULL " +
            "và mở lại đúng khoảng trống A5, nên không truy vấn nào được phép chạy tiếp.",
        );
      }
      return fn(client);
    },
    tuyChon,
  );
}
