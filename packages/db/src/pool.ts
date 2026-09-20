import pg from "pg";
import { parse as phanTichConnectionString } from "pg-connection-string";
import { ganVaiTroChoPool, type VaiUngDung } from "./vai-tro.js";

const CAC_HOST_LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

// Các tham số này bị cấm tuyệt đối trong query string bất kể giá trị hay host đích — không
// cố diễn giải từng giá trị sslmode vì "pg-connection-string" tự cảnh báo ngữ nghĩa
// prefer/require/verify-ca SẼ đổi ở bản major sau (hiện là alias của verify-full, sau sẽ yếu
// hơn). Khoá an ninh của dự án vào hành vi phiên bản cụ thể của thư viện bên thứ ba là rủi ro
// tự thân — deny-list theo TÊN tham số không phụ thuộc điều đó.
//
// [vòng fix 2 — M2] `options` nằm trong danh sách này dù nó KHÔNG phải một hồi quy TLS. Lý do
// đo được: createPool chỉ chuyển host/port/user/password/database/ssl RỜI RẠC cho pg.Pool và
// tự đặt `options` của riêng nó (hai GUC của IM7), nên `?options=-c row_security=off` trong
// chuỗi kết nối KHÔNG BAO GIỜ tới server — nó bị BỎ QUA IM LẶNG. Bất biến mà chính file này
// tuyên bố là "TỪ CHỐI THẲNG, không cố sửa giá trị", và bỏ qua im lặng vi phạm đúng bất biến
// đó theo chiều nguy hiểm nhất: người vận hành đặt một tham số an ninh vào chuỗi kết nối, thấy
// kết nối THÀNH CÔNG, và tin rằng nó có hiệu lực. Nếu một bản pg sau này lại tôn trọng query
// string thì cùng tham số ấy GHI ĐÈ hai GUC giảm nhẹ của IM7 — nên tên này bị cấm ở CẢ hai
// trạng thái thế giới. Tên hằng cố ý KHÔNG còn chữ "SSL": danh sách đã rộng hơn TLS.
const CAC_THAM_SO_BI_CAM_LUON = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslnegotiation",
  "uselibpqcompat",
  "options",
]);

/**
 * Tìm tham số nguy hiểm trong query string, hoặc null nếu không có.
 *
 * "host"/"hostaddr" chỉ bị cấm khi giá trị KHÔNG phải đường dẫn Unix socket (không bắt đầu
 * bằng "/"): đây là cách hợp lệ, phổ biến để khai Unix socket qua URI (authority không chứa
 * được dấu "/" nếu không percent-encode), nhưng cũng chính là đường "host trong query string
 * ghi đè host trong URL" mà review tìm ra — chuỗi trông như "localhost" lại nối tới host từ
 * xa. Không có hostname hợp lệ nào bắt đầu bằng "/", nên phân biệt bằng ký tự đầu là đủ và an
 * toàn — không mở lại đường lách khi vẫn chặn hostname giả dạng.
 */
function timThamSoNguyHiem(url: URL): string | null {
  for (const [ten, giaTri] of url.searchParams) {
    const tenThuong = ten.trim().toLowerCase(); // [fix Minor] phong ten tham so co khoang trang thua
    if (CAC_THAM_SO_BI_CAM_LUON.has(tenThuong)) return ten;
    if ((tenThuong === "host" || tenThuong === "hostaddr") && !giaTri.startsWith("/")) {
      return ten;
    }
  }
  return null;
}

/** Loopback (mọi kết nối localhost) hoặc Unix domain socket (host là đường dẫn file). */
function laKetNoiCucBo(host: string | null | undefined): boolean {
  if (!host) return false;
  return CAC_HOST_LOOPBACK.has(host) || host.startsWith("/");
}

/**
 * Tạo pool kết nối Postgres, bắt buộc TLS xác thực chứng chỉ trừ khi đích là loopback/Unix
 * socket cục bộ.
 *
 * KHÔNG truyền connectionString thẳng cho pg.Pool. Đọc trực tiếp
 * node_modules/pg/lib/connection-parameters.js: nếu config có connectionString, pg tự
 *   config = Object.assign({}, config, parse(config.connectionString))
 * — nghĩa là bất kỳ option ssl nào createPool tính toán và truyền vào ĐỀU BỊ GHI ĐÈ bởi
 * những gì pg tự đọc lại được từ chính connectionString. Đã tự kiểm chứng bằng Postgres 16
 * thật: "ssl=0" tắt hẳn TLS không qua sslmode; "host=" trong query string ghi đè host trong
 * URL (chuỗi trông như localhost lại nối tới host từ xa);
 * "uselibpqcompat=true&sslmode=prefer" cho ra đúng {rejectUnauthorized:false} — thứ bị cấm
 * tuyệt đối. Vì vậy: nếu query string có tham số nguy hiểm thì từ chối thẳng; nếu không, parse
 * bằng đúng thư viện pg dùng nội bộ (pg-connection-string) rồi truyền host/port/user/
 * password/database/ssl RỜI RẠC — không kèm connectionString — để pg không còn gì để tự parse
 * lại và ghi đè.
 */
/**
 * [vòng fix 1 — IM7] HAI GUC ĐẶT TRÊN TUỲ CHỌN KẾT NỐI, ngoài tầm với của hardening.
 *
 * Task 6 đưa vào `noi_chuoi_kiem_toan()` một `pg_advisory_xact_lock` khoá theo TỔ CHỨC, phạm vi
 * TRANSACTION. Bề mặt mới, đo được: một `app_api` bị chiếm mở transaction, ghi một sự kiện, rồi
 * GIỮ transaction đó —
 *     nạn nhân CÙNG tổ chức -> "canceling statement due to lock timeout", CONTEXT trỏ đúng
 *         dòng PERFORM pg_advisory_xact_lock(...)   (chỉ khi nạn nhân CÓ lock_timeout)
 *     tổ chức KHÁC -> ghi bình thường (cô lập xuyên tổ chức giữ được, đúng thiết kế)
 * Dưới G4 ("mọi thao tác khoá sinh audit"), không ghi được audit = KHÔNG LÀM ĐƯỢC thao tác
 * khoá. Không có lock_timeout thì nạn nhân treo VÔ HẠN thay vì lỗi.
 * [S1.71 / khoản 123, lượt soi 65a-11] Với khoá GHI SỔ, vế "chỉ khi nạn nhân CÓ lock_timeout" nay không còn: `noi_chuoi_kiem_toan()`
 * mang `SET lock_timeout = '2s'` (050), nên nạn nhân của khoá ấy gãy sau tối đa 2 s bất kể GUC của phiên. Hai GUC dưới:
 * `lock_timeout` vẫn là trần chờ của mọi khoá khác; `idle_in_transaction_session_timeout` vẫn đuổi giao dịch rảnh ĐANG GIỮ khoá — kể
 * cả khoá ghi sổ (lượt soi 65c-7).
 *
 * Vì sao ĐẶT Ở ĐÂY chứ không bằng `ALTER ROLE app_api SET ...`: hardening.always.sql phát
 * "ALTER ROLE app_api RESET ALL" MỖI DEPLOY với hậu điều kiện `rolconfig IS NULL`, nên biện
 * pháp giảm nhẹ đó bị XOÁ ở mọi lần migrate(). `options` đi trong gói khởi tạo kết nối (biến
 * thành PGOPTIONS `-c ...`), tức nó thuộc về TIẾN TRÌNH ỨNG DỤNG chứ không thuộc catalog —
 * hardening không chạm tới được, và không cần mở một ngoại lệ nào trong danh sách trắng
 * rolconfig (mở ngoại lệ ở đó là nới một bảo đảm ra, đúng khuôn đã sinh ra CR1-v2).
 *
 * Đây là GIẢM NHẸ, không phải bản vá: nó bó cửa sổ lại chứ không lấy khoá đi.
 *
 * Giá trị mặc định và lý do:
 *   - lock_timeout 15s: dài hơn mọi lần ghi audit hợp lệ (đo: ghi 20 sự kiện song song cùng tổ
 *     chức xong dưới 1s) nhưng đủ ngắn để một transaction bị treo không kéo theo cả tổ chức.
 *   - idle_in_transaction_session_timeout 60s: giết chính transaction ĐANG GIỮ khoá, tức đóng
 *     nguyên nhân chứ không chỉ nạn nhân.
 * `migrate()` CỐ Ý vô hiệu hoá cả hai trên kết nối của nó — xem packages/db/src/migrate.ts.
 */
export interface TuyChonPool {
  /** ms; 0 = không giới hạn. */
  readonly lockTimeoutMs?: number;
  /** ms; 0 = không giới hạn. */
  readonly idleInTransactionTimeoutMs?: number;
  /**
   * [sổ nợ 38] `statement_timeout` (ms; 0 = không giới hạn). Một câu lệnh treo (khoá, truy vấn nặng)
   * bị Postgres huỷ và kết nối được trả lại — nửa CSDL của hàng rào thời gian; nửa JS (`coHan`) ở
   * apps/api. `migrate()` tự đặt 0 trên kết nối của nó (migration dài là bình thường).
   */
  readonly statementTimeoutMs?: number;
  /**
   * [S1.11] Vai ứng dụng gắn vào MỌI client trước khi giao ra (`SET ROLE` + kiểm `current_user`).
   *
   * Tiến trình thật đăng nhập bằng `app_api_login` (hardening: INHERIT, danh sách trắng CAP_HOP_LE)
   * — role ấy có toàn bộ quyền của `app_api` nhưng `current_user` KHÁC tên, và mọi phép đo của dự
   * án đã chạy dưới `SET ROLE app_api`. Đặt `role` để tiến trình chạy ĐÚNG danh tính đã đo; migration
   * `037` là lớp CSDL đứng sau cho ca quên đặt. Xem `vai-tro.ts`.
   */
  readonly role?: VaiUngDung;
  /**
   * [S1.94 / khoản 103 + 180] Bộ ghi log cho sự kiện `'error'` của CHÍNH pool.
   *
   * Người gọi KHÔNG phải gắn listener: `createPool` luôn gắn một cái (xem khối ngay trên
   * `pool.on("error", …)`). Tham số này chỉ nói *ghi dòng log ở đâu và bằng chữ gì* — gói này giữ
   * hợp đồng CẤM LOG, nên nó không tự in một byte nào. Không truyền ⇒ tiến trình vẫn SỐNG, chỉ
   * mất dòng chẩn đoán; truyền ⇒ nói được nó đã sống sót vì chuyện gì.
   */
  readonly onPoolError?: (loi: unknown) => void;
}

const LOCK_TIMEOUT_MS_MAC_DINH = 15_000;
const IDLE_IN_TX_TIMEOUT_MS_MAC_DINH = 60_000;
const STATEMENT_TIMEOUT_MS_MAC_DINH = 15_000;

export function createPool(
  connectionString: string,
  max = 10,
  tuyChon: TuyChonPool = {},
): pg.Pool {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (error) {
    throw new Error(
      "createPool: connection string phải là dạng URI (postgres://user:pass@host:port/db), " +
        `không parse được: ${(error as Error).message}`,
    );
  }

  const thamSoNguyHiem = timThamSoNguyHiem(url);
  if (thamSoNguyHiem !== null) {
    throw new Error(
      `createPool: tham số "${thamSoNguyHiem}" trong connection string bị cấm — nó có thể ` +
        "ghi đè host, tắt/làm yếu xác thực TLS, hoặc (với `options`) đặt GUC của phiên ngoài " +
        "tầm kiểm soát của createPool. createPool KHÔNG bỏ qua tham số như vậy: nó từ chối " +
        "thẳng, vì bỏ qua im lặng để lại người vận hành tin rằng tham số đã có hiệu lực.",
    );
  }

  const daPhanTich = phanTichConnectionString(connectionString);
  const host = daPhanTich.host ?? undefined;
  const canBoQuaTls = laKetNoiCucBo(host);

  // Số nguyên không âm, ép ở đây chứ không tin người gọi: chuỗi này đi thẳng vào PGOPTIONS.
  const soMs = (giaTri: number | undefined, macDinh: number): number => {
    if (giaTri === undefined) return macDinh;
    if (!Number.isInteger(giaTri) || giaTri < 0) {
      throw new Error(
        `createPool: timeout phải là số nguyên không âm (ms), nhận được ${String(giaTri)}.`,
      );
    }
    return giaTri;
  };
  const lockMs = soMs(tuyChon.lockTimeoutMs, LOCK_TIMEOUT_MS_MAC_DINH);
  const idleTxMs = soMs(tuyChon.idleInTransactionTimeoutMs, IDLE_IN_TX_TIMEOUT_MS_MAC_DINH);
  const cauLenhMs = soMs(tuyChon.statementTimeoutMs, STATEMENT_TIMEOUT_MS_MAC_DINH);

  const pool = new pg.Pool({
    host,
    port: daPhanTich.port ? Number(daPhanTich.port) : undefined,
    user: daPhanTich.user,
    password: daPhanTich.password,
    database: daPhanTich.database ?? undefined,
    max,
    // [review an ninh lượt 17, M-1] MỐC CHẾT CHO HÀNG ĐỢI POOL. Mặc định của `pg-pool` là `0`,
    // tức `pool.connect()` xếp hàng VÔ HẠN — và `server.requestTimeout` chỉ huỷ socket chứ không
    // huỷ promise đang treo, nên hàng đợi KHÔNG co lại khi client bỏ đi.
    //
    // Vì sao nó thành chuyện ở S1.26: bản vá khoản nợ 2 giữ một khoá hàng qua trọn lời gọi cổng
    // mở bí mật, nên các request chồng nhau trên CÙNG một hồ sơ TUẦN TỰ HOÁ thay vì chạy song
    // song. Ba GUC mà khối chú thích của khoản nợ 2 dựa vào (`lock_timeout`,
    // `statement_timeout`, `idle_in_transaction_session_timeout`) chặn THỜI GIAN MỘT PHIÊN; không
    // cái nào chặn SỐ KẾT NỐI BỊ GHIM. Với `dbPoolMax` mặc định 10, một người dùng hợp lệ bắn 10
    // lượt `/auth/totp` đồng thời cho CHÍNH hồ sơ mình có thể rút cạn pool của cả tiến trình —
    // tức chạm tới người của TỔ CHỨC KHÁC.
    //
    // 20 giây = cận trên của một lượt chờ hợp lý: nó LỚN HƠN `lock_timeout` (15 s) nên một người
    // chờ khoá hàng vẫn chết vì 55P03 với thông điệp đúng của nó, chứ không bị cắt sớm bởi hàng
    // đợi pool và mất chẩn đoán. Vượt mốc này thì `pool.connect()` NÉM, và một lỗi ồn ào đúng hơn
    // hẳn một hàng đợi lớn dần trong im lặng.
    connectionTimeoutMillis: 20_000,
    application_name: "trustprocure",
    // [vòng fix 1 — IM7] Xem khối chú thích của TuyChonPool. Chỉ chứa chữ số nên không có
    // đường tiêm tham số nào qua PGOPTIONS.
    options: `-c lock_timeout=${lockMs} -c idle_in_transaction_session_timeout=${idleTxMs} -c statement_timeout=${cauLenhMs}`,
    // Không có tham số nào của createPool cho phép truyền rejectUnauthorized: false — cấm
    // tuyệt đối bằng cách không mở đường thoát đó ra API công khai. Đặt tường minh false cho
    // nhánh loopback (không để undefined) để không phụ thuộc biến môi trường PGSSLMODE có thể
    // rò từ máy chủ vào tiến trình.
    ssl: canBoQuaTls ? false : { rejectUnauthorized: true },
  });
  // ============================================================================================
  // [S1.94 / khoản 103 — lượt soi ngang 75 góc 6] SỰ KIỆN `'error'` CỦA POOL PHẢI CÓ NGƯỜI NGHE,
  // VÀ CHỖ KHÔNG QUÊN ĐƯỢC LÀ CHÍNH HÀM NÀY.
  //
  // `pg` phát `'error'` TRÊN POOL khi một client ĐANG RẢNH trong hồ chết (CSDL khởi động lại, máy
  // ngủ dậy, `pg_terminate_backend`, một cú ngắt mạng). Không ai nghe thì `EventEmitter` NÉM —
  // `events.js` biến một sự kiện không người nghe thành một exception không ai bắt, và tiến trình
  // Node CHẾT. `apps/api` và `apps/unseal-worker` không đặt `process.on("uncaughtException")`, nên
  // đó là chết thật, giữa một kịch bản đang chạy.
  //
  // VÌ SAO NUỐT CHỨ KHÔNG NÉM LẠI: tới lúc sự kiện này tới, `pg` ĐÃ gỡ client hỏng khỏi hồ. Không
  // có giao dịch nào của người dùng đang treo trên nó (client rảnh, theo định nghĩa), nên không có
  // gì để fail-closed cho. Thứ duy nhất còn lại là một dòng chẩn đoán — và đó là việc của
  // `onPoolError`, cắm từ composition root, vì gói này giữ hợp đồng CẤM LOG.
  //
  // VÌ SAO ĐẶT Ở ĐÂY CHỨ KHÔNG Ở COMPOSITION ROOT như hai tín hiệu của khoản 129/173: hai tín hiệu
  // ấy là sự kiện của RIÊNG kho này (`release` mang `SESSION_STATE_LEFT`, `SU_KIEN_LOI_KET_NOI_TOI_MUON`)
  // nên chúng phải được khai. `'error'` thì không: nó là hợp đồng của `pg`, và một lớp phải-khai cho
  // nó đã được ĐO là quên được — `tools/neo-so-kiem-toan` dựng hai pool và không gắn gì (khoản 180),
  // đúng lớp lỗi mà khoản 173 vừa đóng, còn nguyên ở chỗ thứ ba. Cùng bài học với ADR-047: đặt lớp
  // ở chỗ không thể quên, vì không dựng pool thì không có gì để quên.
  // ============================================================================================
  pool.on("error", (loi: unknown) => {
    tuyChon.onPoolError?.(loi);
  });
  return tuyChon.role === undefined ? pool : ganVaiTroChoPool(pool, tuyChon.role);
}
