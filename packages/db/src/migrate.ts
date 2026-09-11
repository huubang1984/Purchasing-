import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

// Khoá advisory tuỳ ý nhưng cố định cho toàn dự án — chỉ dùng để loại trừ lẫn nhau giữa
// các tiến trình migrate() chạy đồng thời (vd. hai pod cùng khởi động, blue/green deploy).
// Không liên quan tới bất kỳ khoá nghiệp vụ nào khác nên chọn một số bất kỳ đủ lớn để
// tránh trùng ngẫu nhiên với khoá advisory khác mà hệ thống có thể dùng sau này.
const MIGRATION_LOCK_KEY = 727_100_003;

/**
 * [S1.51 / khoản nợ 92] Tiền tố của phép TỪ CHỐI SỚM — xuất ra để test ghim MỘT bản (lượt soi 44 NẶNG-1).
 */
export const TU_CHOI_GUC_SOM =
  "migrate() từ chối chạy: GUC tenant/khách hay GUC vận hành đã bị gắn sẵn trên phiên deploy TRƯỚC lượt sửa";

/**
 * [S1.51 / khoản nợ 92 — lượt soi 44 NẶNG-3] `search_path` được xét theo TÍNH CHẤT, không theo một chuỗi.
 * Tính chất an ninh thật là *không schema nào của người khác đứng trước `public`* (khoản 78 — che tên); `"$user"` và
 * `pg_catalog` là hai tên duy nhất được phép đứng trước. Nên cụm đặt `search_path = 'public'` — cấu hình AN TOÀN HƠN mặc
 * định của PostgreSQL, và là cách một cụm tự chữa khoản 78 — vẫn deploy được. Bản đầu so nguyên văn `'"$user", public'`
 * và CHẶN VĨNH VIỄN cụm ấy, không cửa ra nào (ADR-028 §3, chiều hỏng).
 * ~~Phát biểu chính xác của tính chất: KHÔNG schema nào ngoài `"$user"`/`pg_catalog` được đứng TRƯỚC `public`. Thứ đứng
 * SAU `public` thì không nằm trong tính chất ấy~~ — **[S1.52 / khoản nợ 95]** SAI ở vế sau, và vế ấy là tiền đề cướp: nêu
 * `pg_catalog` ở vị trí SAU thì schema đứng trước che mọi hàm hệ thống cùng chữ ký (đo: `public, pg_catalog` cộng
 * `public.lower(text)` ⇒ `lower('ABC')` ra `CUOP` — đúng tiền đề [INV-H21] canh). Phát biểu nay: `pg_catalog`, nếu được
 * nêu, chỉ ở vị trí ĐẦU; trước `public` chỉ có `pg_catalog` rồi `"$user"`; thứ đứng sau `public` tuỳ ý trừ `pg_catalog`.
 * `pg_catalog` đứng một mình và chuỗi rỗng là hai dạng an toàn nhất (mọi tên phải phân giải ở pg_catalog hay ghi schema)
 * — cùng `pg_catalog, pg_temp`, khuyến nghị của tài liệu PostgreSQL cho SECURITY DEFINER (pg_temp nêu CUỐI nên không che gì) —
 * nên cũng được nhận. `'"$user", public, extensions'` (khuôn Supabase/PostGIS) vẫn deploy được. Cố ý KHÔNG có cửa ra cho
 * schema lạ đứng TRƯỚC `public` hay pg_catalog nêu SAU: hai ca ấy CHÍNH LÀ mối nguy.
 * `"$user"` đứng một mình và `pg_catalog, "$user"` cũng được nhận (lượt soi 45 NHẸ-1 — bản đầu đòi có `public`).
 * Giữ ĐỒNG BỘ với `GUC_VAN_HANH_DOI` (cột `mau` và `cam`) trong `hardening.always.sql` — hai lớp cố ý, cùng CHUỖI regex.
 * Cùng một QUY TẮC chỉ trên miền ASCII không xuống dòng (lượt soi 45 INFO-1): `\s` của `/u` nhận khoảng trắng Unicode,
 * `.` của ARE nhận xuống dòng; ngoài miền ấy bản này NGHIÊM hơn — chỉ có thể chặn oan, không thể để lọt dạng cướp.
 */
const MAU_SEARCH_PATH_DUNG = /^\s*(""|pg_catalog(\s*,\s*pg_temp)?|(pg_catalog\s*,\s*)?(("\$user"|\$user)(\s*,\s*public(\s*,.*)?)?|public(\s*,.*)?))\s*$/u;
const CAM_SEARCH_PATH = /,\s*"?pg_catalog"?\s*(,|$)/u;
const searchPathDung = (giaTri: string): boolean => MAU_SEARCH_PATH_DUNG.test(giaTri) && !CAM_SEARCH_PATH.test(giaTri);

/**
 * [S1.51 / khoản nợ 92] Ba GUC VẬN HÀNH, cùng bộ với `GUC_VAN_HANH_DOI` của `hardening.always.sql`. `search_path` đứng
 * cuối và được gọi bằng chỉ số ở phép đọc trước lúc ghim — lý do ở ngay đó.
 */
const TEN_GUC_VAN_HANH = ["row_security", "session_replication_role", "search_path"];

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
  /**
   * [S1.51 / lượt soi 44 NẶNG-1] Thông điệp của phép TỪ CHỐI SỚM là BẰNG CHỨNG của khoản nợ 87 và của 40a H1 — test ghim
   * nguyên văn nó. Bản S1.51 đổi chữ (thêm "hay GUC vận hành") và BỐN chỗ ghim trong test im lặng hỏng: ba `toContain`
   * đỏ, và một hằng dùng trong `bat87` thoái hoá thành no-op vì vế trái không bao giờ đúng nữa. Nên chuỗi nay sống MỘT
   * bản, ở đây, và test import nó — đổi chữ lần sau không làm rỗng ruột phép đo nào.
   */
  const nhaKhoaVaTraClient = async (huyClient?: Error): Promise<Error | null> => {
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
      await lockClient.query("RESET statement_timeout");
      await lockClient.query("SELECT pg_catalog.pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      // [fix round 4 — N1] Gỡ listener 'error' đã gắn ở trên TRƯỚC release() trên CẢ HAI
      // nhánh — client quay lại pool là cùng một đối tượng sẽ được lần migrate() sau lấy lại.
      lockClient.off("error", boQuaLoiKetNoi);
      if (nghenThongBao !== undefined) lockClient.off("notice", nghenThongBao);
      // [S1.51 / lượt soi 44 NẶNG-2] `huyClient` cho nhánh "chạy lại trên KẾT NỐI MỚI": lời khuyên ấy KHÔNG thực hiện
      // được nếu chính phiên độc quay lại pool — một lượt thử lại trong cùng tiến trình (nhất là pool max 1) lấy lại
      // đúng backend ấy và kẹt mãi. `release(err)` bảo pg-pool HUỶ client (đo ở [fix round 5 — M10]).
      lockClient.release(huyClient);
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

  /**
   * [S1.51 / lượt soi 44 NẶNG-2] Ba phép từ chối SAU lượt sửa đều nói "chạy lại trên KẾT NỐI MỚI" — lời khuyên ấy chỉ
   * thực hiện được nếu phiên độc KHÔNG quay lại pool. Đánh dấu để nhánh dọn dẹp huỷ hẳn client.
   */
  let phaiHuyPhien: Error | undefined;
  const tuChoiVaHuyPhien = async (thongDiep: string): Promise<Error> => {
    const loi = new Error(thongDiep);
    phaiHuyPhien = loi;
    return await Promise.resolve(loi);
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
    //   - ~~VẪN phụ thuộc dòng này: "CREATE TABLE IF NOT EXISTS schema_migrations" và mọi
    //     SELECT/INSERT trên schema_migrations bên dưới (tên bảng KHÔNG ghi schema, nên nó
    //     rơi vào schema ĐẦU TIÊN của search_path)~~ — [S1.24] cả ba câu ấy nay ghi
    //     "public.schema_migrations", nên chúng KHÔNG còn phụ thuộc dòng này. Review lượt 15
    //     bắt được một BẤT ĐỐI XỨNG do chính vòng ghim tạo ra: SELECT/INSERT đã ghi schema
    //     mà CREATE thì chưa, tức nếu ai gỡ dòng dưới theo lời chú thích cũ thì CREATE tạo
    //     bảng ở một schema còn SELECT đọc schema khác. Nay CREATE cũng ghi schema. VẪN phụ
    //     thuộc dòng này: toàn bộ DDL không ghi schema trong
    //     001/002, và tính ổn định của pg_get_expr mà hardening.always.sql phán xét.
    // [S1.51 / khoản nợ 92] ĐỌC TRƯỚC KHI GHIM. `search_path` là một trong ba GUC vận hành, nhưng dòng ngay dưới đây biến
    // `pg_settings.source` của nó thành `session` VĨNH VIỄN cho phiên này trong khi `reset_val` vẫn giữ giá trị độc (đo
    // S1.51, PG16) — tới lượt phán xét của hardening thì hàng "đặt ở mức database, ba mục kề vừa chữa xong" và hàng
    // "postgresql.conf / ALTER SYSTEM" trông HỆT nhau. Đây là chỗ DUY NHẤT còn phân biệt được, nên đọc ở đây.
    // Tên GUC đi qua THAM SỐ, không nằm trong văn bản câu: [INV-H21] cấm mọi câu có chữ `search_path` nêu tên
    // `pg_catalog` — đó đúng là tiền đề của ca cướp — mà câu này thì phải ghim đủ bốn trục. Hai đòi hỏi ấy chỉ cùng
    // thoả được khi cái tên không còn là chữ trong câu.
    const { rows: spTruocGhim } = await lockClient.query<{ nguon: string; reset_val: string }>(
      "SELECT st.source AS nguon, st.reset_val FROM pg_catalog.pg_settings st " +
        "WHERE st.name OPERATOR(pg_catalog.=) $1::pg_catalog.text",
      [TEN_GUC_VAN_HANH[2]],
    );
    // Chỉ những NGUỒN mà không lớp nào khác với tới. Cố ý ĐỨNG NGOÀI: `database` (ba mục kề tự chữa, và phép đọc
    // hàng catalog dưới đây lo nốt phần phiên), `user`/`database user` (rolconfig của vai DEPLOY — dự án đã tuyên bố
    // đây là vùng "chặn 0%" và có hai test ghim rằng migrate() chạy được dưới search_path thù địch: nó GHIM search_path
    // ngay dòng dưới, nên không migration nào phân giải tên qua schema lạ), `session` và `client` (`createPool` cấm
    // `options=`). Còn lại — postgresql.conf / ALTER SYSTEM / dòng lệnh / biến môi trường / ALTER ROLE ALL — là những
    // nguồn áp cho MỌI phiên ỨNG DỤNG mà nhánh catalog của mục 92 không thấy hết.
    const NGUON_AP_MOI_PHIEN = ["configuration file", "command line", "environment variable", "global"];
    const spDocNgoai =
      spTruocGhim[0] !== undefined &&
      !searchPathDung(spTruocGhim[0].reset_val) &&
      NGUON_AP_MOI_PHIEN.includes(spTruocGhim[0].nguon);

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
    // [sổ nợ 38] createPool nay đặt statement_timeout; một migration dài là bình thường ở đây.
    await lockClient.query("SET statement_timeout = 0");

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
      "CREATE TABLE IF NOT EXISTS public.schema_migrations (" +
        "version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT pg_catalog.now())",
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
    // [S1.48 / lượt soi ngang 40a H1] Mục phán xét khoản 87 chỉ hỏi ở BƯỚC 3 — SAU khi các migration đánh số của CÙNG
    // lượt đã chạy dưới một GUC `app.*` gắn sẵn (ALTER DATABASE/ROLE … SET, ALTER SYSTEM, options= của chính chuỗi kết nối
    // này) và đã ghi checksum: một backfill dưới vai deploy N2 (FORCE RLS áp) chỉ sửa hàng của tổ chức B, COMMIT, rồi 87
    // mới NÉM — deploy kế không chạy lại migration ấy. Nên migrate() hỏi bốn GUC NGAY ĐÂY, trước lượt sửa, và từ chối:
    // cùng phép đọc như withTenant (placeholder không có ở pg_settings — đo S1.47), không cần quyền, một round-trip.
    // Mục 87 ở BƯỚC 3 vẫn giữ làm lớp catalog (mức database/vai/pg_parameter_acl/proconfig là thứ phiên này không thấy hết).
    //
    // [S1.51 / khoản nợ 92 — lượt soi 43 NẶNG-3] Hai GUC VẬN HÀNH đọc được GIÁ TRỊ HIỆN HÀNH, và chúng phải được hỏi ở
    // ĐÂY chứ không chỉ ở BƯỚC 3: `session_replication_role = replica` làm cả vòng migration đánh số chạy KHÔNG trigger
    // RI và không trigger `ENABLE` thường, `row_security = off` làm mọi câu chạm bảng RLS của vai thường báo lỗi — cả hai
    // COMMIT và ghi checksum xong rồi hardening mới ném, và deploy sau KHÔNG chạy lại migration ấy.
    // Nguồn `database` ĐỨNG NGOÀI phép từ chối SỚM này, và đó là điều kiện sống của ba mục "… đặt ở mức database": chúng
    // chữa đúng hàng ấy bằng `ALTER DATABASE … RESET` ở LƯỢT SỬA — từ chối TRƯỚC lượt sửa thì lượt sửa không bao giờ
    // chạy, ba mục thành mã chết và một cụm dính `ALTER DATABASE … SET` KHÔNG lượt deploy nào gỡ được nữa (ADR-028 §2⑷
    // và §3). Hai phép đọc hàng catalog ngay sau lượt sửa lo nốt phần ấy.
    // [lượt soi 44 NHẸ-5] `local` bắn ĐÚNG tập trigger như `origin` (chỉ `replica` bỏ qua trigger `ENABLE` thường): chặn
    // deploy vì `local` là chặn không có lý do an ninh.
    // KHÔNG được chèn chú thích vào GIỮA chuỗi nối bằng `+` ở dưới: bộ đọc SQL của [INV-H21] ngắt chuỗi ở đó và câu bị
    // cắt cụt (đo — PREPARE báo 42601 "syntax error at end of input").
    const { rows: gucGanSan } = await lockClient.query<{ ten: string | null }>(
      "SELECT pg_catalog.concat_ws(', ', " +
        "  CASE WHEN NULLIF(pg_catalog.current_setting('app.org_id', true), '') IS NOT NULL THEN 'app.org_id' END, " +
        "  CASE WHEN NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '') IS NOT NULL THEN 'app.guest_session_id' END, " +
        "  CASE WHEN NULLIF(pg_catalog.current_setting('app.guest_invitation_id', true), '') IS NOT NULL THEN 'app.guest_invitation_id' END, " +
        "  CASE WHEN NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '') IS NOT NULL THEN 'app.guest_rfq_id' END, " +
        "  (SELECT pg_catalog.string_agg(st.name, ', ' ORDER BY st.name) " +
        "     FROM pg_catalog.pg_settings st " +
        "    WHERE st.source OPERATOR(pg_catalog.<>) 'default' AND st.source OPERATOR(pg_catalog.<>) 'database' " +
        "      AND ((st.name OPERATOR(pg_catalog.=) 'session_replication_role' " +
        "              AND st.setting OPERATOR(pg_catalog.<>) 'origin' AND st.setting OPERATOR(pg_catalog.<>) 'local') " +
        "        OR (st.name OPERATOR(pg_catalog.=) 'row_security' " +
        "              AND st.setting OPERATOR(pg_catalog.<>) 'on'))), " +
        "  $1::pg_catalog.text) AS ten",
      [spDocNgoai ? "search_path" : null],
    );
    if (gucGanSan[0]?.ten) {
      // Chỉ TÊN, không giá trị — thông điệp đi vào log deploy.
      throw new Error(
        `${TU_CHOI_GUC_SOM} — ${gucGanSan[0].ten}. ` +
          "Mọi migration đánh số sẽ chạy dưới tổ chức/phiên khách do người khác chọn (ALTER DATABASE/ROLE … SET, ALTER SYSTEM, " +
          "options= trên chuỗi kết nối deploy). RESET rồi chạy lại trên kết nối mới (mục phán xét khoản 87 của hardening).",
      );
    }

    // [S1.51 / khoản nợ 92 — lượt soi 44 CAO-1] Chụp hàng mức database của ba GUC vận hành TRƯỚC lượt sửa. Vì sao bắt
    // buộc: ba mục kề chạy `ALTER DATABASE … RESET <guc>` VÔ ĐIỀU KIỆN, và một hàng mức database mang GIÁ TRỊ ĐÚNG là một
    // biện pháp giảm nhẹ hợp lệ — nó CHE một độc ở tầng thấp hơn (`postgresql.conf` / `ALTER SYSTEM` / `ALTER ROLE ALL`),
    // thứ mà PostgreSQL xếp dưới `database` trong ưu tiên nguồn. Lượt sửa gỡ hàng che ⇒ phiên deploy vẫn thấy giá trị
    // ĐÚNG (chốt lúc mở kết nối) ⇒ mọi phép đọc trong phiên này im ⇒ deploy XANH, và MỌI phiên ứng dụng mở sau đó chạy
    // dưới độc ấy. Không phiên nào đang mở đọc được giá trị THẬT sau khi hàng che biến mất — nên khi lượt sửa có gỡ hàng
    // nào, lượt này DỪNG và đòi một phiên mới: lượt sau mở sạch, và phép từ chối SỚM ở trên đọc đúng nguồn còn lại.
    const docHangMucDatabase = async (): Promise<string[]> =>
      (
        await lockClient.query<{ ten: string }>(
          "SELECT DISTINCT pg_catalog.split_part(c, '=', 1) AS ten " +
            "  FROM pg_catalog.pg_db_role_setting s, pg_catalog.unnest(s.setconfig) c " +
            " WHERE s.setrole OPERATOR(pg_catalog.=) 0 " +
            "   AND s.setdatabase OPERATOR(pg_catalog.=) " +
            "       (SELECT d.oid FROM pg_catalog.pg_database d " +
            "         WHERE d.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()) " +
            "   AND pg_catalog.split_part(c, '=', 1) OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.text[]) " +
            " ORDER BY 1",
          [TEN_GUC_VAN_HANH],
        )
      ).rows.map((r) => r.ten);
    const hangDbTruoc = await docHangMucDatabase();

    await chayFileLuonChay("sua");

    const hangDbSau = await docHangMucDatabase();
    if (hangDbSau.length > 0) {
      // [lượt soi 44 NẶNG-2] Lượt sửa KHÔNG gỡ được (vai deploy không sở hữu database ⇒ 42501, hardening nuốt thành
      // WARNING). Bản đầu vẫn in "đã gỡ … chạy lại trên kết nối mới" — hai vế đều sai, và nó chỉ người vận hành vào một
      // vòng lặp vô hạn. Nói đúng nguyên nhân và đúng quyền cần có.
      throw await tuChoiVaHuyPhien(
        `migrate() từ chối chạy tiếp: cấu hình mức database của GUC vận hành VẪN CÒN sau lượt sửa — ${hangDbSau.join(", ")}. ` +
          "Lượt sửa đã thử `ALTER DATABASE … RESET` và KHÔNG làm được (cần quyền sở hữu database hiện tại hoặc SUPERUSER). " +
          "Gỡ bằng vai có quyền rồi chạy lại migrate() trên KẾT NỐI MỚI.",
      );
    }
    if (hangDbTruoc.length > 0) {
      throw await tuChoiVaHuyPhien(
        `migrate() từ chối chạy tiếp: lượt sửa vừa gỡ cấu hình mức database của GUC vận hành — ${hangDbTruoc.join(", ")}. ` +
          "Phiên này mở TRƯỚC lúc gỡ nên vẫn mang giá trị cũ, và giá trị THẬT sau khi gỡ (postgresql.conf, ALTER SYSTEM, " +
          "ALTER ROLE ALL — những nguồn mà hàng vừa gỡ có thể đang che) chỉ đọc được trên một phiên MỚI: chạy lại " +
          "migrate() trên KẾT NỐI MỚI. Không migration đánh số nào chạy ở lượt này.",
      );
    }

    // [S1.51 / lượt soi 44] Bản trước còn một phép đọc thứ ba ở đây — `current_setting` của hai GUC vận hành sau lượt
    // sửa. Nó nay là MÃ CHẾT và đã bị bỏ: mọi nguồn làm giá trị phiên sai đều đã bị chặn TRƯỚC lượt sửa (`source` ngoài
    // `default`/`database`) hay bởi hai phép đọc hàng catalog ngay trên (`database`), và không migration đánh số nào chạy
    // giữa chúng. Giữ lại thì nó là một lớp không đột biến nào làm đỏ được — đúng thứ ADR-028 §2⑷ cấm ở `bang`.

    const applied: string[] = [];

    for (const file of fileDanhSo) {
      const sql = await readFile(join(dir, file), "utf8");
      const checksum = migrationChecksum(sql);

      const existing = await lockClient.query<{ checksum: string }>(
        "SELECT checksum FROM public.schema_migrations WHERE version OPERATOR(pg_catalog.=) $1",
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
          "INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)",
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
    await nhaKhoaVaTraClient(phaiHuyPhien);
    throw loiGoc;
  }
}
