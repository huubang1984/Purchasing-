// ==============================================================================================
// apps/api/src/http.ts — HÌNH DẠNG của một yêu cầu và một phản hồi, TÁCH KHỎI node:http
//
// Handler và bộ điều phối làm việc với hai kiểu này, không với `IncomingMessage`/`ServerResponse`.
// Nhờ vậy toàn bộ tầng nghiệp vụ của api đo được bằng một object thuần — không cần mở cổng —
// và `node:http` chỉ xuất hiện ở đúng một file (`server.ts`), điều mà lớp canh `g9-` đòi.
// ==============================================================================================

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface ApiRequest {
  readonly method: HttpMethod;
  /** Đường dẫn ĐÃ tách query, chưa ghép tham số. */
  readonly path: string;
  /** Tham số `:name` do bộ ghép đường dẫn điền. */
  readonly params: Readonly<Record<string, string>>;
  /** Thân JSON đã đọc (hoặc `undefined` khi không có thân). */
  readonly body: unknown;
  readonly cookies: Readonly<Record<string, string>>;
  /** Định danh yêu cầu — sinh ở server, đi vào sổ kiểm toán như `requestId`. */
  readonly requestId: string;
  /**
   * Địa chỉ tầng vận chuyển của bên gọi — `callerFingerprint` của hạn mức OTP (ADR-015).
   * Đọc từ socket, KHÔNG từ `X-Forwarded-For`: header ấy do client viết. Sau một proxy tin cậy,
   * composition root phải thay nguồn này — và đó là một quyết định triển khai, ghi ở ADR-020.
   */
  readonly remoteAddress: string;
}

export interface ApiResponse {
  readonly status: number;
  readonly body?: unknown;
  /** Header THÊM. Bộ header mặc định (E6) do `server.ts` đặt và không handler nào bỏ được. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Mỗi phần tử là một dòng `Set-Cookie` hoàn chỉnh. Cookie là đường DUY NHẤT một phiên đi ra (E6). */
  readonly setCookie?: readonly string[];
}

/**
 * Lỗi mà handler CỐ Ý trả ra dưới một mã HTTP. Thông điệp đi thẳng vào thân phản hồi, nên nó
 * chịu cùng kỷ luật với thông điệp của mọi `*Error` trong `packages/`: KHÔNG nội suy dữ liệu
 * đầu vào, KHÔNG mang giá, token, mã OTP.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
