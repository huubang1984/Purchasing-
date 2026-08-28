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

/**
 * [fix vòng 1 — I3] Chế độ chạy của file ".always.sql", truyền qua GUC `app.hardening_che_do`.
 * Giá trị lạ làm chính file SQL đó RAISE — cố ý, để một lỗi chính tả ở đây không âm thầm biến
 * lượt phán xét thành no-op. Xem khối "BA LƯỢT" ở đầu db/migrations/hardening.always.sql.
 */
type CheDoHardening = "sua" | "phan_xet";

/**
 * [vòng fix 2 — MỤC C] Một thông báo do PostgreSQL phát ra trong lúc `migrate()` chạy.
 *
 * `severity` là chuỗi PostgreSQL gửi kèm (`NOTICE`, `WARNING`, `INFO`, …). Nó BỊ BẢN ĐỊA HOÁ
 * theo `lc_messages` của server, nên đừng dùng nó làm điều kiện an ninh — nó ở đây để người
 * gọi phân loại khi ghi log, không phải để phán xét.
 */
export interface ThongBaoTuDatabase {
  readonly severity: string;
  readonly message: string;
}

/** Tuỳ chọn của `migrate()`. Mọi trường đều tuỳ chọn — hợp đồng cũ `migrate(pool, dir)` giữ nguyên. */
export interface TuyChonMigrate {
  /**
   * [vòng fix 2 — MỤC C] KÊNH DUY NHẤT ĐƯA THÔNG BÁO CỦA POSTGRESQL RA KHỎI `migrate()`.
   *
   * VÌ SAO NÓ TỒN TẠI, bằng phép đo chứ không bằng nguyên tắc. Mục (E3) của
   * `db/migrations/hardening.always.sql` là lớp deploy-time DUY NHẤT phán xét DỮ LIỆU của
   * `role_permissions` (bất biến D3, trục (b)). Trên chính khuôn deploy mà bộ test của dự án
   * ghim làm khuôn production — superuser bootstrap một lần, rồi deploy dưới role KHÔNG sở hữu
   * bảng và KHÔNG có GRANT nào — nó BỎ QUA hoàn toàn, và trước bản vá này lời "tôi đang bỏ
   * qua" của nó KHÔNG TỚI ĐƯỢC AI: đo được, `migrate()` không gắn listener nào nên đầu ra là
   * 0 dòng; gắn listener thì có 4 thông báo. Một phép kiểm bỏ qua trong im lặng là một phép
   * kiểm tệ hơn không có, nên hoặc phải có kênh này, hoặc phải thôi gọi (E3) là một lớp.
   *
   * CỐ Ý KHÔNG LỌC theo severity. Lọc ở đây sẽ là một quyết định chính sách chôn trong thư
   * viện, và nó vừa mất `NOTICE` mà hardening dùng để tường thuật lượt `sua`, vừa dựa vào một
   * trường BỊ BẢN ĐỊA HOÁ. Người gọi lọc.
   *
   * CỐ Ý KHÔNG `console.log` mặc định: một thư viện tự ghi ra stdout là thứ không tắt được và
   * không định tuyến được. Không truyền `onThongBao` thì hành vi y hệt trước — và đó là một
   * điều phải nói ra chứ không giấu: mặc định VẪN LÀ IM LẶNG, kênh này chỉ làm cho việc "nghe"
   * trở nên KHẢ THI. Người vận hành nào không nối kênh này thì với người đó (E3) vẫn vô hình.
   *
   * Hàm được gọi ĐỒNG BỘ từ trong listener `notice` của `pg`; ném lỗi trong đây sẽ nổi lên
   * dưới dạng sự kiện `error` không ai bắt. Giữ nó nhỏ và không ném.
   */
  readonly onThongBao?: (thongBao: ThongBaoTuDatabase) => void;
}

// ============================================================================================
// [PHẦN 0 — lỗi tiền tồn từ Task 1] CHUẨN HOÁ XUỐNG DÒNG TRƯỚC KHI BĂM
// ============================================================================================
// `migrate()` băm NỘI DUNG ĐỌC TỪ ĐĨA, và nội dung đó phụ thuộc NỀN TẢNG. Đo tại HEAD 8927cc4
// trong worktree này (Git for Windows, core.autocrlf=true từ
// "file:C:/Program Files/Git/etc/gitconfig", repo KHÔNG có .gitattributes lúc đó):
//
//   $ git ls-files --eol db/migrations/
//   i/lf  w/crlf  001_roles_and_functions.sql      <- blob LF, CÂY LÀM VIỆC CRLF
//   i/lf  w/crlf  002_organizations_and_users.sql  <- blob LF, CÂY LÀM VIỆC CRLF
//   i/lf  w/lf    003_audit_events.sql
//   i/lf  w/lf    004_audit_chain_functions.sql
//
//   sha256 (24 ký tự đầu):
//     001  CRLF 471fac22d8e55d741f21cd59   LF f4f638210c0291098f96a7a4
//     002  CRLF cf83769ef418fdc018339c7b   LF d7c58c8c0e612293f4bccf97
//
// Cùng MỘT commit, hai checksum. Một CI Linux (LF) deploy vào CSDL từng migrate từ máy Windows
// (CRLF) — hoặc ngược lại — gãy với "Migration ... đã bị sửa nội dung sau khi áp dụng". `[fix
// S7]` chạy ĐÚNG thiết kế; thứ sai là ĐẦU VÀO của nó.
//
// VÌ SAO VÁ Ở ĐÂY, KHÔNG CHỈ BẰNG .gitattributes — hai lý do đo được, không phải khẩu vị:
//   (1) .gitattributes CHỈ có hiệu lực từ lần CHECKOUT kế tiếp. Một máy đã có checkout CRLF
//       giữ nguyên CRLF trên đĩa cho tới khi file được ghi lại; đo trong worktree này sau khi
//       thêm .gitattributes: "git status --porcelain" RỖNG mà 001/002 vẫn còn 99/178 ký tự CR.
//       Nghĩa là chỉ có (b) thì lỗ vẫn mở đúng ở ca đang tồn tại.
//   (2) Chính việc renormalize LÀ MỘT SỰ KIỆN CHECKSUM: nó ĐỔI BYTE của file trong cây làm
//       việc. Một môi trường đã ghi checksum CRLF vào schema_migrations sẽ gãy ở lần checkout
//       đầu tiên sau khi .gitattributes có hiệu lực. Bản vá phải đóng lỗ TRƯỚC chứ không tạo
//       thêm một lần chuyển trạng thái.
// .gitattributes VẪN được thêm (xem file đó): nó làm byte của cây làm việc tất định, đóng nốt
// dư lượng ở (3) dưới đây. Hai lớp, không phải một lớp thay lớp kia.
//
// PHẠM VI CỦA VIỆC NỚI LỎNG, nói đúng mức — bản vá này nới `[fix S7]` ra ĐÚNG MỘT TRỤC:
//   (1) sửa NỘI DUNG (kể cả CHÚ THÍCH) của một migration đã áp dụng VẪN gãy — có test hồi quy
//       ở cả migrate.test.ts lẫn migrate.int.test.ts;
//   (2) khoảng trắng KHÁC xuống dòng (thụt lề, dấu cách cuối dòng) VẪN tính;
//   (3) DƯ LƯỢNG: một byte CR nằm TRONG một chuỗi ký tự SQL mang ngữ nghĩa khác `\n`, và bản
//       vá này băm hai bản ấy như nhau.
//
// `\r\n?` chứ không `\r\n`: một file toàn `\r` (quy ước Mac cổ điển, và là thứ một bộ chuyển
// đổi hỏng có thể sinh ra) sẽ băm ra GIÁ TRỊ THỨ BA nếu chỉ xử lý CRLF. Có test riêng.
//
// ============================================================================================
// [vòng fix 1 — I4] HIỆU CHUẨN LẠI DƯ LƯỢNG (3): NÓ LÀ **CR ĐƠN LẺ**, VÀ .gitattributes KHÔNG
// ĐÓNG ĐƯỢC NÓ
// ============================================================================================
// Bản trước phát biểu dư lượng là "một `\r\n` nằm trong một chuỗi ký tự SQL" và nói
// `.gitattributes` đóng nó. CẢ HAI VẾ SAI, và sai theo HAI HƯỚNG NGƯỢC NHAU. Đo trong một kho
// Git sạch có đúng dòng `*.sql text eol=lf`:
//   ca `\r\n`   : Git XOÁ CR (cảnh báo "CRLF will be replaced by LF") — blob và mọi checkout
//                 mới đều mất byte đó. Tức nó KHÔNG được "biểu diễn ổn định"; nó bị ÂM THẦM
//                 ĐỔI NGỮ NGHĨA. Một tác giả viết `E'...\r\n...'` dạng byte thật MẤT byte CR.
//   ca CR ĐƠN LẺ: Git GIỮ NGUYÊN BYTE qua cả blob lẫn `git clone` mới
//                 (`git ls-files --eol` -> `i/-text w/-text`).
// Cộng với việc `migrationChecksum('a\rb') = migrationChecksum('a\nb')`, kết cục là: hai văn
// bản migration KHÁC BYTE, cùng commit được, cùng checkout ổn định được, CÙNG CHECKSUM. Trớ
// trêu là chính nhánh `\r\n?` ở ngay trên — được biện minh như một điểm mạnh — mới là thứ mở
// trục này ra. Đúng khuôn QT2: một bảo đảm bị NỚI để mua một phép kiểm, và bậc tự do mới không
// vào sổ.
// Bản vá là GHIM, không phải NỚI, và nó nằm ở lớp TRƯỚC KHI COMMIT chứ không ở đây: một khẳng
// định tĩnh trong packages/db/src/migrate.test.ts cấm hẳn byte CR trong db/migrations/*.sql
// (chạy trong `pnpm test`, không cần Docker). Vì sao KHÔNG đặt phép kiểm ấy vào chính
// `migrate()`: nó sẽ biến một byte thừa thành một cụm KHÔNG DEPLOY ĐƯỢC — đúng cái bẫy QT1 mà
// dự án này liên tục tránh. Xem khối chú thích ở test đó để biết toàn bộ phép đo.
function chuanHoaXuongDong(sql: string): string {
  return sql.replace(/\r\n?/g, "\n");
}

/**
 * Checksum nội dung một file migration — ĐỘC LẬP NỀN TẢNG.
 *
 * Xuất khẩu (thay vì để nội bộ) để test khoá được chính hợp đồng này mà không phải dựng
 * database: xem packages/db/src/migrate.test.ts. KHÔNG nằm trong barrel `@trustprocure/db` —
 * nó là hợp đồng nội bộ của bộ chạy migration, không phải mặt tiền của gói.
 *
 * Thuật toán KHÔNG đổi so với bản trước: với đầu vào LF thuần, giá trị trả về vẫn đúng bằng
 * sha256 của chính byte đó. Đó là điều kiện để mọi môi trường đã migrate từ một checkout LF
 * (tức mọi CI Linux) không gãy ở lần deploy kế tiếp — có test neo giá trị.
 */
export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(chuanHoaXuongDong(sql), "utf8").digest("hex");
}

/**
 * Áp dụng các file .sql trong `dir` theo thứ tự tên, mỗi file trong một transaction riêng.
 * Migration đã áp dụng được ghi vào schema_migrations kèm checksum nội dung và không chạy
 * lại. Toàn bộ vòng lặp được bọc trong một advisory lock để hai tiến trình migrate() chạy
 * đồng thời trên cùng CSDL không giẫm lên nhau.
 *
 * File có hậu tố ".always.sql" chạy LẠI ở MỌI lần gọi và không được ghi vào `applied` trả về
 * — dùng cho cưỡng chế cấu hình cần tự sửa lại nếu bị trôi sau triển khai (vd. thuộc tính
 * role), khác với thay đổi lược đồ một-lần.
 *
 * [fix vòng 1 — I3] Nó chạy BA lượt trong một lần migrate(), mỗi lượt một transaction riêng:
 * `sua` trước vòng migration đánh số, rồi `sua` và `phan_xet` sau vòng đó. Lý do đầy đủ ở
 * khối "BA LƯỢT" đầu db/migrations/hardening.always.sql; tóm tắt: lượt trước-vòng phải tồn
 * tại (001 GRANT cho các role), lượt sau-vòng là lượt DUY NHẤT nhìn thấy migration vừa được
 * đưa vào, và tách phán xét sang transaction riêng để một phán xét hỏng không rollback các
 * sửa chữa đã thành công.
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
export async function migrate(
  pool: pg.Pool,
  dir: string,
  tuyChon: TuyChonMigrate = {},
): Promise<string[]> {
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

  // [vòng fix 2 — MỤC C] Listener 'notice'. Gắn/gỡ theo ĐÚNG khuôn của listener 'error' ngay
  // trên — cùng lý do [fix round 4 — N1]: pool.connect() trả về CÙNG một đối tượng Client khi
  // client được tái sử dụng, nên một listener gắn mà không gỡ tích luỹ theo số lần gọi
  // migrate() và cuối cùng cho MaxListenersExceededWarning. Chỉ gắn khi người gọi thật sự
  // muốn nghe, để không đổi hành vi của mọi đường gọi cũ.
  const nghenThongBao =
    tuyChon.onThongBao === undefined
      ? undefined
      : (tb: { severity?: string; message?: string }): void => {
          tuyChon.onThongBao?.({ severity: tb.severity ?? "", message: tb.message ?? "" });
        };
  if (nghenThongBao !== undefined) lockClient.on("notice", nghenThongBao);

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
      // [vòng fix 1 — IM7] Trả hai timeout về giá trị của kết nối trước khi client quay lại
      // pool: người gọi ĐƯỢC PHÉP chia sẻ pool ứng dụng với migrate() (các test tích hợp của
      // dự án đang làm thế), và một client mang lock_timeout=0 nằm lại trong pool ứng dụng là
      // chính bậc tự do mà [IM7] vừa đóng. RESET chứ không SET giá trị mặc định: giá trị đúng
      // đến từ PGOPTIONS lúc mở kết nối, nên RESET khôi phục đúng nó.
      await lockClient.query("RESET lock_timeout");
      await lockClient.query("RESET idle_in_transaction_session_timeout");
      await lockClient.query("SELECT pg_catalog.pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      // [fix round 4 — N1] Gỡ listener 'error' đã gắn ở trên TRƯỚC release() trên CẢ HAI
      // nhánh — client quay lại pool là cùng một đối tượng sẽ được lần migrate() sau lấy lại.
      lockClient.off("error", boQuaLoiKetNoi);
      if (nghenThongBao !== undefined) lockClient.off("notice", nghenThongBao);
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
      if (nghenThongBao !== undefined) lockClient.off("notice", nghenThongBao);
      lockClient.release(loiKhiMoKhoa as Error);
      return loiKhiMoKhoa as Error;
    }
  };

  try {
    // [fix vòng 2 — CR1] GHIM search_path CHO CẢ LẦN migrate() NÀY, câu lệnh đầu tiên chạy
    // trên kết nối, trước cả advisory lock.
    //
    // Hai lỗ ĐO ĐƯỢC trên PostgreSQL 16.15 mà một dòng này đóng, cả hai cùng một lớp lỗi
    // ("bảo đảm chỉ đúng ở một cấu hình"):
    //   (1) pg_get_expr deparse THEO search_path của phiên đang đọc. Với
    //       "ALTER ROLE <role_deploy> SET search_path = gia, public" và một hàm
    //       gia.app_current_org_id() trả về tổ chức B, policy của users deparse ra đúng chuỗi
    //       trần mà danh sách trắng của hardening duyệt -> migrate() PASS ở MỌI lần chạy, và
    //       app_api_login đã gắn TỔ CHỨC A đọc được người dùng của TỔ CHỨC B. Dưới path đã
    //       ghim, cùng policy đó deparse thành "(org_id = gia.app_current_org_id())" và BỊ
    //       CHẶN. hardening.always.sql còn tự ghim lại ở phạm vi transaction (phòng khi chạy
    //       bằng psql -f), nhưng khối DECLARE của nó chạy TRƯỚC lần ghim đó — chỉ dòng này
    //       che được khối ấy.
    //   (2) "CREATE TABLE IF NOT EXISTS schema_migrations" bên dưới tạo bảng ở schema ĐẦU
    //       TIÊN của search_path. Dưới search_path không có public đứng đầu, nó tạo
    //       gia.schema_migrations, thấy bảng rỗng, rồi ÁP LẠI TOÀN BỘ 001/002 vào schema lạ
    //       (đo được: gia.schema_migrations, gia.users, gia.organizations). Idempotency của
    //       migrate() tự vỡ mà không ai báo.
    //
    // Vì sao 'public' chứ không phải 'pg_catalog, public': pg_catalog được tìm NGẦM trước khi
    // nó không được nêu tên, nên hai cách tra cứu như nhau — nhưng CREATE không ghi schema thì
    // rơi vào schema ĐẦU TIÊN ĐƯỢC NÊU. Đã đo: với 'pg_catalog, public', CREATE TABLE báo
    // "permission denied to create pg_catalog.… System catalog modifications are currently
    // disallowed" ngay cả dưới superuser. hardening.always.sql thì dùng 'pg_catalog, public'
    // được vì nó không tạo đối tượng nào thiếu tên schema.
    //
    // Phạm vi: PHIÊN, không phải transaction — nó phải sống qua mọi BEGIN/COMMIT của vòng lặp
    // migration. Client này được release() về pool khi xong; giá trị SET còn dính trên kết
    // nối đó.
    //
    // [vòng fix 3 — nói quá] Bản trước viết vô điều kiện "Người gọi dùng pool ứng dụng riêng
    // (packages/tenancy) nên không chia sẻ kết nối này". SAI về phạm vi: migrate(pool, dir)
    // nhận BẤT KỲ pool nào người gọi đưa vào — kể cả pool ứng dụng, và đúng là các test tích
    // hợp của dự án đang gọi migrate(db.pool, ...) rồi dùng lại chính pool đó. Phát biểu đúng
    // mức: khuôn dùng ĐƯỢC KHUYẾN NGHỊ là một pool riêng cho migrate(); nếu người gọi chia sẻ
    // pool ứng dụng thì một kết nối trong pool đó mang theo "search_path = public" cho tới
    // khi bị đóng. Hệ quả đã cân nhắc và chấp nhận: 'public' cũng chính là search_path mặc
    // định của PostgreSQL, và pg_catalog vẫn được tìm ngầm TRƯỚC (xem ghi chú dưới), nên đây
    // là một trạng thái phiên VÔ HẠI — khác hẳn app.org_id, thứ mà packages/tenancy huỷ hẳn
    // kết nối để không rò.
    //
    // [vòng fix 3 — I1] DÒNG NÀY LÀ TIỀN ĐỀ NGẦM CỦA NHỮNG DÒNG KHÁC TRONG FILE — ai xoá nó
    // phải biết mình đang phá gì. Đã đo trên PostgreSQL 16.15 quy tắc chính xác: pg_catalog
    // được tìm NGẦM TRƯỚC MỌI THỨ *chỉ khi* nó KHÔNG được nêu tên; nêu tên nó ở vị trí sau
    // ("gia, pg_catalog, public") thì schema đứng trước cướp được cả current_setting lẫn
    // set_config. 'public' không nêu pg_catalog, nên dưới dòng này mọi tên hàm/kiểu/toán tử
    // trần trong file này VÀ trong 001/002 đều phân giải về pg_catalog trước.
    //   - Lời gọi hàm của CHÍNH file này nay viết đủ "pg_catalog." nên chúng KHÔNG còn phụ
    //     thuộc dòng này (trước vòng fix 3 thì có, và không ghi chú nào nói ra).
    //   - VẪN phụ thuộc dòng này: "CREATE TABLE IF NOT EXISTS schema_migrations" và mọi
    //     SELECT/INSERT trên schema_migrations bên dưới (tên bảng KHÔNG ghi schema, nên nó
    //     rơi vào schema ĐẦU TIÊN của search_path), toàn bộ DDL không ghi schema trong
    //     001/002, và tính ổn định của pg_get_expr mà hardening.always.sql phán xét.
    await lockClient.query("SET search_path = public");

    // [vòng fix 1 — IM7] VÔ HIỆU HOÁ hai timeout mà createPool đặt cho POOL ỨNG DỤNG. Chúng
    // tồn tại để một transaction bị treo không khoá cả tổ chức khỏi việc ghi audit (xem
    // packages/db/src/pool.ts), nhưng migrate() có ĐÚNG hai tính chất mà chúng cấm:
    //   * nó CHỜ VÔ HẠN trên pg_advisory_lock ngay dưới đây — đó là toàn bộ cơ chế chống hai
    //     tiến trình migrate() đồng thời, và lock_timeout áp cả cho khoá tư vấn (đã đo);
    //   * lượt hardening + vòng migration là một transaction DDL có thể dài hơn 60 giây trên
    //     một lược đồ lớn.
    // Phạm vi PHIÊN (không SET LOCAL): nó phải sống qua mọi BEGIN/COMMIT của vòng lặp. Cùng
    // đánh đổi đã ghi cho `SET search_path = public` ngay trên: nếu người gọi chia sẻ pool ứng
    // dụng, kết nối đó mang hai giá trị 0 cho tới khi bị đóng. Khác với search_path, đây KHÔNG
    // vô hại — nên khuôn dùng được khuyến nghị (pool riêng cho migrate) nay là load-bearing,
    // và dòng RESET ở finally bên dưới đóng ca chia sẻ pool.
    await lockClient.query("SET lock_timeout = 0");
    await lockClient.query("SET idle_in_transaction_session_timeout = 0");

    // pg_advisory_lock chặn tới khi có được khoá — tiến trình migrate() thứ hai chạy đồng
    // thời sẽ đợi ở đây thay vì đua vào cùng một transaction DDL với tiến trình thứ nhất.
    await lockClient.query("SELECT pg_catalog.pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

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

    const chayFileLuonChay = async (cheDo: CheDoHardening): Promise<void> => {
      for (const file of fileLuonChay) {
        const sql = await readFile(join(dir, file), "utf8");
        try {
          await lockClient.query("BEGIN");
          // set_config(..., true) = phạm vi transaction, nên GUC tự biến mất khi COMMIT/
          // ROLLBACK và không rò sang migration đánh số hay sang lần dùng kết nối kế tiếp.
          await lockClient.query("SELECT pg_catalog.set_config('app.hardening_che_do', $1, true)", [
            cheDo,
          ]);
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
          throw new Error(`Hardening ${file} (${cheDo}) thất bại: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
    };

    // [fix vòng 1 — I3] LƯỢT 1: chỉ SỬA, không phán xét. Bắt buộc chạy TRƯỚC migration đánh
    // số vì 001 GRANT cho app_api/app_unseal nên hai role đó phải tồn tại trước.
    await chayFileLuonChay("sua");

    const applied: string[] = [];

    for (const file of fileDanhSo) {
      const sql = await readFile(join(dir, file), "utf8");
      const checksum = migrationChecksum(sql);

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

    // [fix vòng 1 — I3] LƯỢT 2 (SỬA) rồi LƯỢT 3 (PHÁN XÉT), mỗi lượt một transaction RIÊNG.
    // Ba triệu chứng đo được của khuôn "một lượt, chạy trước" mà thứ tự này đóng:
    //   (1) khối phán xét KHÔNG BAO GIỜ kiểm chính migration đang được đưa vào — nó chỉ thấy
    //       trạng thái TRƯỚC khi 00N chạy, nên lỗi chỉ lộ ở lần deploy SAU, khi file đã nằm
    //       trong schema_migrations và không chạy lại được;
    //   (2) vì phán xét chạy TRƯỚC, một lược đồ hỏng KHÔNG vá được bằng migration mới:
    //       migrate() gãy trước khi tới được 004. Nay lượt 1 chỉ sửa, nên vòng migration đánh
    //       số LUÔN chạy được hết và một migration vá lỗi tới được đích;
    //   (3) phán xét hỏng KHÔNG còn rollback các sửa chữa đã thành công: lượt 2 đã COMMIT
    //       xong trước khi lượt 3 bắt đầu, và lượt 3 không sửa gì nên transaction của nó rỗng.
    await chayFileLuonChay("sua");
    await chayFileLuonChay("phan_xet");

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
