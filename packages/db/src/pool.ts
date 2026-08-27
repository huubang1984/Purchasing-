import pg from "pg";
import { parse as phanTichConnectionString } from "pg-connection-string";

const CAC_HOST_LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

// Các tham số này bị cấm tuyệt đối trong query string bất kể giá trị hay host đích — không
// cố diễn giải từng giá trị sslmode vì "pg-connection-string" tự cảnh báo ngữ nghĩa
// prefer/require/verify-ca SẼ đổi ở bản major sau (hiện là alias của verify-full, sau sẽ yếu
// hơn). Khoá an ninh của dự án vào hành vi phiên bản cụ thể của thư viện bên thứ ba là rủi ro
// tự thân — deny-list theo TÊN tham số không phụ thuộc điều đó.
const CAC_THAM_SO_SSL_BI_CAM_LUON = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslnegotiation",
  "uselibpqcompat",
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
    const tenThuong = ten.toLowerCase();
    if (CAC_THAM_SO_SSL_BI_CAM_LUON.has(tenThuong)) return ten;
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
export function createPool(connectionString: string, max = 10): pg.Pool {
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
        "ghi đè host hoặc tắt/làm yếu xác thực TLS ngoài tầm kiểm soát của createPool.",
    );
  }

  const daPhanTich = phanTichConnectionString(connectionString);
  const host = daPhanTich.host ?? undefined;
  const canBoQuaTls = laKetNoiCucBo(host);

  return new pg.Pool({
    host,
    port: daPhanTich.port ? Number(daPhanTich.port) : undefined,
    user: daPhanTich.user,
    password: daPhanTich.password,
    database: daPhanTich.database ?? undefined,
    max,
    application_name: "trustprocure",
    // Không có tham số nào của createPool cho phép truyền rejectUnauthorized: false — cấm
    // tuyệt đối bằng cách không mở đường thoát đó ra API công khai. Đặt tường minh false cho
    // nhánh loopback (không để undefined) để không phụ thuộc biến môi trường PGSSLMODE có thể
    // rò từ máy chủ vào tiến trình.
    ssl: canBoQuaTls ? false : { rejectUnauthorized: true },
  });
}
