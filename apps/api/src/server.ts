// ==============================================================================================
// apps/api/src/server.ts — FILE DUY NHẤT của apps/api được chạm `node:http` (lớp canh `g9-`).
//
// Nó làm đúng bốn việc: đọc yêu cầu thành `ApiRequest` (với trần byte cho thân), gọi bộ điều
// phối, ghi phản hồi, và đặt BỘ HEADER MẶC ĐỊNH lên MỌI phản hồi — kể cả 404, 405, 500, và kể cả
// khi handler ném. Bộ header ấy là lớp cưỡng chế của E6 ở tầng vận chuyển:
//
//   Referrer-Policy: no-referrer    — URL của api không bao giờ đi vào `Referer` của trang khác;
//   Cache-Control: no-store         — phản hồi mang dữ liệu phiên không nằm lại ở proxy/đĩa;
//   X-Content-Type-Options: nosniff — JSON không bao giờ bị đọc thành HTML.
//
// Handler có thể THÊM header, không thể GHI ĐÈ ba dòng này: `server.ts` đặt chúng SAU header của
// handler. `api.int.test.ts` [INV-E6] gọi từng route trong `ROUTES` và đọc lại ba dòng ấy.
// ==============================================================================================

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Dispatcher } from "./dispatch.js";
import { HttpError, type ApiResponse } from "./http.js";
import { docCookie, laHttpMethod, phanTichThan, tachQuery, TRAN_THAN_BYTE } from "./router.js";

export const HEADER_MAC_DINH: Readonly<Record<string, string>> = {
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-type": "application/json; charset=utf-8",
};

/**
 * Đọc thân với TRẦN BYTE cưỡng chế TRONG LÚC đọc: vượt trần thì huỷ ngay, không đợi hết stream.
 * Một trần kiểm SAU khi đã gom xong là một trần trang trí — kẻ gửi 1 GiB đã làm xong việc.
 */
function docThan(req: IncomingMessage, tran: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const manh: Buffer[] = [];
    let tong = 0;
    let quaTran = false;
    req.on("data", (d: Buffer) => {
      if (quaTran) return; // đã từ chối; phần còn lại bị BỎ, không gom.
      tong += d.length;
      if (tong > tran) {
        quaTran = true;
        // KHÔNG `req.destroy()` ở đây: huỷ socket trước khi 413 kịp đi ra làm client thấy
        // "other side closed" thay vì một mã lỗi — đo được ở lượt chạy đầu của api.int.test.ts.
        // Thân còn lại bị bỏ (nhánh trên); socket đóng SAU khi phản hồi đã ghi xong (xem `ghi`).
        reject(new HttpError(413, "thân yêu cầu vượt trần"));
        return;
      }
      manh.push(d);
    });
    req.on("end", () => resolve(Buffer.concat(manh).toString("utf8")));
    req.on("error", (e) => reject(e));
  });
}

function ghi(req: IncomingMessage, res: ServerResponse, r: ApiResponse): void {
  // [review L-3] Chuẩn hoá khoá về chữ thường TRƯỚC khi trộn: `Cache-Control` (hoa) của một handler
  // không được đứng cạnh `cache-control` mặc định thành HAI header cùng tên.
  const cuaHandler: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) cuaHandler[k.toLowerCase()] = v;
  const headers: Record<string, string | string[]> = { ...cuaHandler, ...HEADER_MAC_DINH };
  if (r.setCookie !== undefined && r.setCookie.length > 0) headers["set-cookie"] = [...r.setCookie];
  if (r.status === 413) {
    // Thân bị từ chối giữa chừng: không tái dùng kết nối này. Đóng socket khi phản hồi đã ĐI HẾT,
    // để client nhận được 413 trước — không sớm hơn.
    headers.connection = "close";
    res.once("finish", () => req.destroy());
  }
  res.writeHead(r.status, headers);
  res.end(r.body === undefined ? "" : JSON.stringify(r.body));
}

export interface ServerOptions {
  readonly maxBodyBytes?: number;
  /**
   * [review M-3] Origin được phép gửi yêu cầu KHÔNG-GET kèm cookie. Mặc định RỖNG: mọi yêu cầu
   * không-GET mang header `Origin` (tức đến từ một trình duyệt) đều bị 403 — composition root của
   * ứng dụng web phải khai origin của nó. Yêu cầu không mang `Origin` lẫn `Sec-Fetch-Site` (client
   * không phải trình duyệt, test) đi qua: CSRF là bài toán của trình duyệt, và trình duyệt luôn gửi
   * ít nhất một trong hai header ấy cho yêu cầu không-GET cross-site.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * [review M-8] Nguồn địa chỉ bên gọi. Mặc định là socket. Sau một proxy/LB tin cậy, composition
   * root PHẢI thay bằng một hàm đọc `X-Forwarded-For` theo CIDR tin cậy (sổ nợ 41) — nếu không, mọi
   * client là MỘT fingerprint và hạn mức theo người gọi của OTP thành hạn mức toàn tổ chức.
   */
  readonly remoteAddressOf?: (req: IncomingMessage) => string;
  /** [review L-8] Ba mốc thời gian tường minh — Slowloris không được sống bằng mặc định của Node. */
  readonly requestTimeoutMs?: number;
  readonly headersTimeoutMs?: number;
  readonly keepAliveTimeoutMs?: number;
}

/** Yêu cầu không-GET này có đến từ một nguồn KHÁC không? `null` = không xác định được nguồn. */
export function nguonKhac(
  origin: string | undefined,
  secFetchSite: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin !== undefined) return !allowedOrigins.includes(origin);
  if (secFetchSite !== undefined) return secFetchSite !== "same-origin" && secFetchSite !== "none";
  return false;
}

export function createApiServer(dispatch: Dispatcher, tuyChon: ServerOptions = {}): Server {
  const tran = tuyChon.maxBodyBytes ?? TRAN_THAN_BYTE;
  const allowed = tuyChon.allowedOrigins ?? [];
  const diaChi = tuyChon.remoteAddressOf ?? ((req: IncomingMessage) => req.socket.remoteAddress ?? "");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      let phanHoi: ApiResponse;
      try {
        if (!laHttpMethod(req.method)) {
          phanHoi = { status: 405, body: { error: "phuong thuc khong duoc ho tro" } };
        } else if (req.method !== "GET" && nguonKhac(req.headers.origin, req.headers["sec-fetch-site"], allowed)) {
          // [review M-3] Thân cố định, và KHÔNG đọc thân yêu cầu: một POST cross-site bị chặn trước
          // khi tốn một byte bộ nhớ cho nó.
          phanHoi = { status: 403, body: { error: "nguon khong duoc phep" } };
        } else {
          const chuoi = await docThan(req, tran);
          const body = phanTichThan(chuoi, req.headers["content-type"]);
          phanHoi = await dispatch({
            method: req.method,
            path: tachQuery(req.url ?? "/"),
            body,
            cookies: docCookie(req.headers.cookie),
            remoteAddress: diaChi(req),
          });
        }
      } catch (err) {
        phanHoi =
          err instanceof HttpError
            ? { status: err.status, body: { error: err.message } }
            : { status: 500, body: { error: "loi noi bo" } };
      }
      // Kết nối có thể đã bị huỷ (413). `writableEnded`/`destroyed` là cách hỏi mà không ném.
      if (!res.destroyed && !res.writableEnded) ghi(req, res, phanHoi);
    })();
  });
  server.requestTimeout = tuyChon.requestTimeoutMs ?? 30_000;
  server.headersTimeout = tuyChon.headersTimeoutMs ?? 15_000;
  server.keepAliveTimeout = tuyChon.keepAliveTimeoutMs ?? 5_000;
  return server;
}
