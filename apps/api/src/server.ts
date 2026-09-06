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
  const headers: Record<string, string> = { ...(r.headers ?? {}), ...HEADER_MAC_DINH };
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
}

export function createApiServer(dispatch: Dispatcher, tuyChon: ServerOptions = {}): Server {
  const tran = tuyChon.maxBodyBytes ?? TRAN_THAN_BYTE;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      let phanHoi: ApiResponse;
      try {
        if (!laHttpMethod(req.method)) {
          phanHoi = { status: 405, body: { error: "phuong thuc khong duoc ho tro" } };
        } else {
          const chuoi = await docThan(req, tran);
          const body = phanTichThan(chuoi, req.headers["content-type"]);
          phanHoi = await dispatch({
            method: req.method,
            path: tachQuery(req.url ?? "/"),
            body,
            cookies: docCookie(req.headers.cookie),
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
}
