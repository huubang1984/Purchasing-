// ==============================================================================================
// apps/api/src/router.ts — GHÉP ĐƯỜNG DẪN, ĐỌC COOKIE, ĐỌC THÂN JSON. Hàm THUẦN, không I/O.
//
// [ADR-020 mục 1, rủi ro §8.2 của kế hoạch S1.10] Đây là phần "tự viết" mà một framework sẽ làm
// hộ, và vì thế nó là chỗ có lỗ nếu có. Ba lựa chọn đóng ba lỗ đã biết:
//
//   ⑴ Đường dẫn được TÁCH THÀNH ĐOẠN rồi so từng đoạn; KHÔNG regex trên cả chuỗi. Một đoạn hợp lệ
//      chỉ gồm `[A-Za-z0-9._-]`, nên `..`, `%2F`, `\`, khoảng trắng đều rơi vào "không có đường
//      này" TRƯỚC khi chạm tới bảng route. Không decode phần trăm: một đường có `%` là một đường
//      không tồn tại — api này chỉ nhận UUIDv4 và chữ thường trong đường dẫn (ADR-012, E4).
//   ⑵ Query bị CẮT BỎ và KHÔNG đọc. Không route nào của S1.10 nhận tham số qua query, và một chỗ
//      không đọc thì không thể rò (E6).
//   ⑶ Thân JSON có TRẦN byte và đòi đúng `content-type`. Đọc thân là việc của `server.ts`
//      (I/O); ở đây chỉ có phép PHÂN TÍCH trên một chuỗi đã đọc, để nó đo được không cần socket.
// ==============================================================================================

import { HttpError, type HttpMethod } from "./http.js";

/** Một đoạn đường dẫn hợp lệ. Tham số `:x` cũng phải khớp cái này. */
const DOAN_HOP_LE = /^[A-Za-z0-9._-]{1,128}$/u;

export interface KetQuaGhep {
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Tách một đường dẫn thô thành các đoạn, hoặc `null` nếu nó không phải một đường dẫn mà api này
 * chấp nhận. `"/"` cho mảng rỗng.
 */
export function tachDoan(path: string): readonly string[] | null {
  if (!path.startsWith("/")) return null;
  if (path === "/") return [];
  // Cấm `//` và dấu `/` cuối: cả hai là hai cách viết cho cùng một đường, và một bảng route
  // không được có hai cách gọi cho một dòng — đó là cách một lớp canh theo route bị đi vòng.
  if (path.endsWith("/")) return null;
  const doan = path.slice(1).split("/");
  for (const d of doan) {
    if (!DOAN_HOP_LE.test(d)) return null;
    // `.` và `..` khớp biểu thức trên (dấu chấm hợp lệ trong tên tệp) — và đó là hai đoạn duy nhất
    // mang NGHĨA cho hệ thống tệp. Bắt riêng, và có test riêng cho đúng ca này (router.test.ts).
    if (d === "." || d === "..") return null;
  }
  return doan;
}

/** Ghép `template` (có `:name`) với các đoạn của một đường dẫn thật. */
export function ghepDuongDan(template: string, doanThat: readonly string[]): KetQuaGhep | null {
  const doanMau = template === "/" ? [] : template.slice(1).split("/");
  if (doanMau.length !== doanThat.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < doanMau.length; i += 1) {
    const m = doanMau[i]!;
    const t = doanThat[i]!;
    if (m.startsWith(":")) {
      params[m.slice(1)] = t;
    } else if (m !== t) {
      return null;
    }
  }
  return { params };
}

/** Tách đường dẫn khỏi query. Query bị BỎ, xem ⑵ ở đầu file. */
export function tachQuery(url: string): string {
  const i = url.indexOf("?");
  return i < 0 ? url : url.slice(0, i);
}

export function laHttpMethod(x: string | undefined): x is HttpMethod {
  return x === "GET" || x === "POST" || x === "PUT" || x === "DELETE";
}

/**
 * Đọc header `cookie` thành bảng tên → giá trị. Không decode: giá trị cookie của api này là
 * `<orgId>.<token base64url>`, không có ký tự nào cần mã hoá. Một cookie lặp tên lấy giá trị ĐẦU
 * — cùng thứ tự trình duyệt gửi (cookie có `Path` cụ thể hơn đứng trước).
 */
export function docCookie(header: string | undefined): Readonly<Record<string, string>> {
  const ra: Record<string, string> = Object.create(null) as Record<string, string>;
  if (header === undefined || header === "") return ra;
  // [sổ nợ 42 / review L-2] Một tên xuất hiện HAI LẦN là dấu hiệu có kẻ ném cookie (subdomain anh
  // em, hay hai `Path` chồng nhau): không lấy cái đầu, không lấy cái sau — BỎ tên ấy, người gọi
  // thành 401. `__Host-` đã đóng đường subdomain; đây là lớp cho ca tiền tố không áp được.
  const trung = new Set<string>();
  for (const phan of header.split(";")) {
    const i = phan.indexOf("=");
    if (i <= 0) continue;
    const ten = phan.slice(0, i).trim();
    const giaTri = phan.slice(i + 1).trim();
    if (ten === "" || trung.has(ten)) continue;
    // [review H4-12] `hasOwn`, không `in`: `"toString" in {}` là true — một cookie tên `constructor`
    // sẽ bị coi là "trùng" và một tên không có sẽ trả về hàm của prototype.
    if (Object.hasOwn(ra, ten)) {
      delete ra[ten];
      trung.add(ten);
      continue;
    }
    ra[ten] = giaTri;
  }
  return ra;
}

/** Trần thân yêu cầu. 64 KiB đủ cho mọi thân JSON của S1.10, kể cả một phong bì niêm phong. */
export const TRAN_THAN_BYTE = 64 * 1024;

/**
 * Phân tích thân đã đọc. `chuoi` rỗng ⇒ không có thân. Ném `HttpError` với mã đúng: 415 khi
 * `content-type` không phải JSON, 400 khi JSON hỏng. Kích thước KHÔNG kiểm ở đây — `server.ts`
 * chặn ở tầng byte TRONG LÚC đọc, trước khi thân kịp vào bộ nhớ.
 */
export function phanTichThan(chuoi: string, contentType: string | undefined): unknown {
  if (chuoi === "") return undefined;
  const loai = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (loai !== "application/json") {
    throw new HttpError(415, "thân yêu cầu phải là application/json");
  }
  try {
    return JSON.parse(chuoi) as unknown;
  } catch {
    throw new HttpError(400, "thân yêu cầu không phải JSON hợp lệ");
  }
}

/**
 * Tách giá trị cookie phiên `<orgId>.<token>`. `null` khi thiếu hoặc sai hình dạng — người gọi
 * đổi thành 401 và KHÔNG nói vì sao (một thông điệp phân biệt "thiếu cookie" với "sai hình dạng"
 * là một oracle nhỏ, và không ai cần nó).
 */
export function tachCookiePhien(giaTri: string | undefined): { orgId: string; token: string } | null {
  if (giaTri === undefined) return null;
  const i = giaTri.indexOf(".");
  if (i <= 0) return null;
  const orgId = giaTri.slice(0, i);
  const token = giaTri.slice(i + 1);
  if (!UUID_RE.test(orgId) || !TOKEN_RE.test(token)) return null;
  return { orgId, token };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** base64url, 32–128 ký tự: đủ cho 24–96 byte ngẫu nhiên. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/u;
