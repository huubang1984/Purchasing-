// ==============================================================================================
// apps/mcp/src/cau-hinh.ts — CẤU HÌNH TỪ MÔI TRƯỜNG. HÀM THUẦN, FAIL-CLOSED.
//
// Cùng khuôn `apps/api/src/cau-hinh.ts` (ADR-021): nhận một bản đồ tên → chuỗi, trả về cấu hình
// đã kiểm hình dạng hoặc ném. Không đọc `process.env`, không mở kết nối — nên mọi ca "thiếu
// biến", "URL sai dạng" đo được ở T1.
//
// BÍ MẬT DUY NHẤT của tiến trình này là `TRUSTPROCURE_MCP_SESSION_COOKIE`: ~~một phiên NGƯỜI MUA
// đang sống~~ [S1.80 / khoản 141] một chứng chỉ `AGENT_READONLY` đang sống. ADR-039 đã đổi nó từ
// một phiên người mua TOÀN QUYỀN thành một chứng chỉ có PHẠM VI, TTL trần MỘT GIỜ; câu cũ ở trên
// sống qua bốn vòng sau khi chính điều nó khai bị bác. Tệp này chỉ kiểm HÌNH DẠNG cookie — LOẠI
// phiên thì `khach-api.ts` kiểm bằng một lời gọi `GET /me` lúc khởi động, và từ chối lên nếu
// `kind !== "AGENT_READONLY"`. Nó không có mặc định, và không bao giờ xuất hiện trong một thông
// điệp lỗi.
// ==============================================================================================

export class CauHinhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauHinhError";
  }
}

export interface CauHinhMcp {
  /** Gốc của `apps/api`, KHÔNG có đường dẫn, KHÔNG có query. `https:` — `http:` chỉ cho localhost. */
  readonly apiBaseUrl: string;
  /** Giá trị cookie của chứng chỉ `AGENT_READONLY` — ~~phiên người mua~~ [S1.80 / khoản 141]. Bí mật. */
  readonly sessionCookie: string;
  /** Trần cho mỗi lời gọi api, ms. */
  readonly timeoutMs: number;
}

const HOST_CUC_BO = new Set(["localhost", "127.0.0.1", "[::1]"]);

const TRAN_MAC_DINH_MS = 10_000;
const TRAN_MIN_MS = 100;
const TRAN_MAX_MS = 60_000;

function batBuoc(env: Readonly<Record<string, string | undefined>>, ten: string): string {
  const gt = env[ten]?.trim();
  if (gt === undefined || gt.length === 0) {
    throw new CauHinhError(`thieu bien moi truong ${ten}`);
  }
  return gt;
}

/**
 * Hình dạng hợp lệ của một `cookie-value` (RFC 6265 §4.1.1), cộng một trần độ dài.
 *
 * [lượt soi 69 L-3] Bản đầu chỉ kiểm rỗng — và còn trả giá trị CHƯA trim. Một giá trị mang `;`
 * chèn thêm cookie vào header mà không ai kêu; một giá trị mang `\r\n` hôm nay bị chặn bởi phép
 * kiểm header của undici, tức lớp chặn CRLF injection đến từ NỀN TẢNG chứ không từ mã này. Đây
 * đúng chỗ ADR-021 đòi fail-closed: biến do vận hành đặt, nên sai thì phải nổ lúc khởi động.
 */
const HINH_DANG_COOKIE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,4096}$/u;

function docGoc(gtTho: string): string {
  let u: URL;
  try {
    u = new URL(gtTho);
  } catch {
    throw new CauHinhError("TRUSTPROCURE_MCP_API_URL khong phai mot URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new CauHinhError("TRUSTPROCURE_MCP_API_URL phai dung https: (hoac http: cho localhost)");
  }
  if (u.protocol === "http:" && !HOST_CUC_BO.has(u.hostname)) {
    // Cookie phiên đi trong header của MỌI lời gọi. `http:` tới một host thật là gửi nó trần.
    throw new CauHinhError(
      "TRUSTPROCURE_MCP_API_URL dung http: voi mot host khong phai localhost — cookie phien se di tran",
    );
  }
  if (u.pathname !== "/" || u.search !== "" || u.hash !== "") {
    // Gốc phải là gốc: đường dẫn do bảng công cụ dựng, không do cấu hình nối thêm.
    throw new CauHinhError("TRUSTPROCURE_MCP_API_URL phai la GOC, khong duong dan/query/fragment");
  }
  return u.origin;
}

function docTran(gtTho: string | undefined): number {
  if (gtTho === undefined) return TRAN_MAC_DINH_MS;
  if (!/^[0-9]+$/u.test(gtTho)) {
    throw new CauHinhError("TRUSTPROCURE_MCP_TIMEOUT_MS phai la so nguyen thap phan");
  }
  const n = Number(gtTho);
  if (n < TRAN_MIN_MS || n > TRAN_MAX_MS) {
    throw new CauHinhError(
      `TRUSTPROCURE_MCP_TIMEOUT_MS phai trong khoang ${String(TRAN_MIN_MS)}..${String(TRAN_MAX_MS)}`,
    );
  }
  return n;
}

function docCookie(gtTho: string): string {
  if (!HINH_DANG_COOKIE.test(gtTho)) {
    // Quy tắc ⑵: nêu TÊN biến, không bao giờ nêu GIÁ TRỊ.
    throw new CauHinhError(
      "TRUSTPROCURE_MCP_SESSION_COOKIE sai hinh dang cookie-value (RFC 6265) hoac qua dai",
    );
  }
  return gtTho;
}

export function docCauHinh(env: Readonly<Record<string, string | undefined>>): CauHinhMcp {
  return {
    apiBaseUrl: docGoc(batBuoc(env, "TRUSTPROCURE_MCP_API_URL")),
    sessionCookie: docCookie(batBuoc(env, "TRUSTPROCURE_MCP_SESSION_COOKIE")),
    timeoutMs: docTran(env["TRUSTPROCURE_MCP_TIMEOUT_MS"]),
  };
}
