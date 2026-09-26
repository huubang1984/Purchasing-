// ==============================================================================================
// apps/web/src/phuc-vu.ts — MÁY CHỦ CỦA LÁT CẮT DEMO
//
// Ba việc, và đúng ba:
//   ⑴ phục vụ vài tệp tĩnh đã biết trước tên;
//   ⑵ phục vụ mã niêm phong dưới dạng JavaScript, GỠ KIỂU TỪ CHÍNH TỆP `.ts` mà test đang đo;
//   ⑶ chuyển tiếp `/api/*` sang `apps/api`.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO CÓ MỘT BỘ CHUYỂN TIẾP, THAY VÌ GỌI THẲNG `apps/api` TỪ TRÌNH DUYỆT
// ----------------------------------------------------------------------------------------------
// Hai ràng buộc đã có trong mã, không phải hai sở thích:
//   * `apps/api/src/server.ts` ghim `content-type: application/json` cho MỌI phản hồi cộng
//     `X-Content-Type-Options: nosniff`, kèm đúng câu *"JSON không bao giờ bị đọc thành HTML"*.
//     Nhét một trang HTML vào api là gỡ tính chất ấy;
//   * `apps/api` KHÔNG trả header CORS nào. Một trang ở origin khác sẽ không gửi được cookie và
//     không đọc được thân phản hồi.
// Đặt trang và API sau CÙNG MỘT origin làm cả hai ràng buộc biến mất mà không phải nới cái nào.
// Đó cũng đúng topo triển khai thật: tĩnh một nơi, API sau một bộ chuyển tiếp.
//
// **Cái giá, nói thẳng:** tiến trình này thấy cookie phiên của người dùng khi nó chuyển tiếp. Nó
// không lưu, không ghi log, không đọc — nhưng nó ĐI QUA, và một tiến trình đi qua là một tiến
// trình phải tin. Vì thế `dependencies` của app rỗng, và vì thế ADR-044 nói app này không được
// đứng trước một cụm sản xuất.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO KHÔNG CÓ MỘT BƯỚC BUILD, VÀ VÌ SAO ĐIỀU ĐÓ QUAN TRỌNG HƠN VẺ TIỆN LỢI
// ----------------------------------------------------------------------------------------------
// Trình duyệt nhận đúng `packages/sealed-envelope/src/seal.ts` — cùng byte mà `roundtrip.test.ts`
// và `guest.int.test.ts` chạy — chỉ gỡ phần kiểu bằng `module.stripTypeScriptTypes` của Node.
// Không bundler, không tệp phát sinh, không phụ thuộc mới. Hệ quả đo được: **không tồn tại một
// bản cài thứ hai của định dạng phong bì**, nên nó không thể trôi. Một dự án mà lõi giá trị là
// "giá được niêm phong đúng cách" không nên có hai bản mã niêm phong.
//
// ----------------------------------------------------------------------------------------------
// BỀ MẶT TỆP: MỘT BẢN ĐỒ ĐÓNG, ĐỌC XONG LÚC KHỞI ĐỘNG
// ----------------------------------------------------------------------------------------------
// Không một lời gọi hệ tệp nào chạy trong vòng đời một yêu cầu. Mọi tệp phục vụ được đọc MỘT LẦN
// lúc khởi động vào một `Map` khoá bằng đường dẫn URL. Đường dẫn của người gọi chỉ được dùng để
// TRA bản đồ ấy, không bao giờ để dựng một đường dẫn đĩa — nên `..%2f..%2fetc/passwd` và mọi biến
// thể của nó chỉ là một khoá không có trong `Map`, tức 404. Đây là cách rẻ nhất để không bao giờ
// phải tranh luận về chuẩn hoá đường dẫn.
// ==============================================================================================

import { createServer as taoServerHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as taoServerHttps } from "node:https";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface TuyChonWeb {
  /** Origin của `apps/api` — mọi `/api/*` đi tới đây. `null` = chỉ tĩnh (ADR-068): `/api/*` ra 404. */
  readonly apiOrigin: string | null;
  /** Cặp PEM đã ĐỌC (không phải đường dẫn): `null` = HTTP. */
  readonly tls: { readonly cert: string; readonly key: string } | null;
}

interface TepPhucVu {
  readonly noiDung: string | Uint8Array;
  readonly loai: string;
}

/** Trần thân yêu cầu mà bộ chuyển tiếp chịu đọc. Một phong bì thầu thật nhỏ hơn con số này rất xa. */
const TRAN_THAN = 1024 * 1024;

const GOC_WEB = new URL("../", import.meta.url);
const GOC_NIEM_PHONG = new URL("../../../packages/sealed-envelope/src/", import.meta.url);
const GOC_WEB_SRC = new URL("src/", GOC_WEB);

/**
 * Các module của cửa trình duyệt, theo đúng thứ tự phụ thuộc.
 *
 * Danh sách này là một LỜI KHAI, và `apps/web/src/cua-trinh-duyet.test.ts` đối chiếu nó với cây
 * import thật của `browser.ts`: thêm một tệp vào cây mà quên khai ở đây thì trang gãy ở `import`
 * đầu tiên — và cổng ấy làm nó đỏ TRƯỚC, ở T1, không đợi ai mở trình duyệt.
 */
export const MODULE_TRINH_DUYET = ["browser", "seal", "format"] as const;

/**
 * [S1.99 / khoản 206] Module của CHÍNH `apps/web/src/` được phục vụ cho trình duyệt, đi qua đúng
 * bộ gỡ kiểu mà cửa niêm phong đi qua.
 *
 * Vì sao có danh sách thứ hai thay vì nối vào `MODULE_TRINH_DUYET`: danh sách trên là ĐÓNG BẮC
 * CẦU của `browser.ts` và `cua-trinh-duyet.test.ts` đòi nó TRÙNG KHỚP cây import thật — thêm một
 * tên lạ vào đó làm cổng ấy đỏ, đúng như nó phải thế. Hai gốc khác nhau thì hai lời khai.
 */
export const MODULE_WEB = ["so-tien"] as const;

/** Trang tĩnh: đường dẫn URL → tên tệp trong `apps/web/trang/`. Bản đồ ĐÓNG. */
export const TRANG: Readonly<Record<string, string>> = {
  "/nop-thau": "nop-thau.html",
  "/nop-thau.js": "nop-thau.js",
  "/mo-thau": "mo-thau.html",
  "/mo-thau.js": "mo-thau.js",
  "/tao-thau": "tao-thau.html",
  "/tao-thau.js": "tao-thau.js",
  "/chung.css": "chung.css",
  // [S1.99 / khoản 198] HAI ĐƯỜNG MÀ SẢN PHẨM ĐÃ SINH RA LINK TỪ S1.12 MÀ KHO CHƯA BAO GIỜ PHỤC
  // VỤ. `apps/api/src/adapters/hop-thu-dev.ts` dựng `${baseUrl}/login#<mã>` cho người mua và
  // `${baseUrl}/i#<mã>` cho nhà cung cấp theo ADR-020 mục 3; cả hai trả 404 cho tới vòng này, nên
  // MỌI link do sản phẩm sinh ra đều không bấm được và lượt đi thử chỉ đi được nhờ link VIẾT TAY
  // của `tools/gieo-demo`.
  //
  // Chúng là BÍ DANH của trang đã có, không phải màn mới: `/i` là nơi một lời mời dẫn tới, tức
  // trang nộp thầu; `/login` là nơi tin báo người duyệt dẫn tới, tức trang mở thầu. Người mua cần
  // màn tạo gói thì gõ thẳng `/tao-thau` — không bộ gửi nào sinh link tới đó.
  "/i": "nop-thau.html",
  "/login": "mo-thau.html",
};

const LOAI_THEO_DUOI: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

/**
 * Chính sách nội dung: `script-src 'self'` — không `unsafe-inline`, không CDN.
 *
 * Đây là lý do mã của hai trang nằm ở tệp `.js` riêng chứ không nằm trong thẻ `<script>` của HTML:
 * một trang có script nội tuyến buộc chính sách phải nới ra `unsafe-inline`, và khi đã nới thì nó
 * không còn chặn được gì. `tools/do-webcrypto/index.html` viết nội tuyến vì nó là một máy dò chạy
 * một mình; trang này nhận cookie phiên của nhà cung cấp nên nó không được hưởng cùng sự dễ dãi.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const HEADER_CHUNG: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": CSP,
  // `no-store` vì bản đồ tệp được đọc MỘT LẦN lúc khởi động: sửa một trang rồi khởi động lại máy
  // chủ mà trình duyệt vẫn giữ bản cũ là một mâu thuẫn tốn đúng một lượt gỡ rối để nhận ra — và
  // nó đã tốn một lượt thật khi trang người mua được vá lần đầu. Không có gì ở đây đáng cache.
  "cache-control": "no-store",
};

function duoiCua(ten: string): string {
  return ten.slice(ten.lastIndexOf(".") + 1);
}

/**
 * Đọc mọi thứ phục vụ được vào bộ nhớ, MỘT LẦN. Ném nếu thiếu một tệp: một trang demo khởi động
 * được rồi 404 ở giữa buổi trình bày là kiểu hỏng tệ nhất có thể có.
 */
export function napTep(): ReadonlyMap<string, TepPhucVu> {
  const m = new Map<string, TepPhucVu>();
  for (const [duong, ten] of Object.entries(TRANG)) {
    const loai = LOAI_THEO_DUOI[duoiCua(ten)];
    if (loai === undefined) throw new Error(`apps/web: không biết content-type của ${ten}`);
    m.set(duong, { noiDung: readFileSync(new URL(`trang/${ten}`, GOC_WEB), "utf8"), loai });
  }
  const canPhucVu: readonly (readonly [string, URL])[] = [
    ...MODULE_TRINH_DUYET.map((ten) => [ten, GOC_NIEM_PHONG] as const),
    ...MODULE_WEB.map((ten) => [ten, GOC_WEB_SRC] as const),
  ];
  for (const [ten, goc] of canPhucVu) {
    const nguon = readFileSync(new URL(`${ten}.ts`, goc), "utf8");
    // `mode: "transform"` chứ không phải mặc định "strip": mã nguồn của kho dùng cú pháp mà bản
    // chỉ-xoá không nhận. Cùng lý do `--experimental-transform-types` có mặt ở mọi script dev.
    const js = stripTypeScriptTypes(nguon, { mode: "transform", sourceUrl: `/lib/${ten}.js` });
    m.set(`/lib/${ten}.js`, { noiDung: js, loai: LOAI_THEO_DUOI.js ?? "text/javascript" });
  }
  return m;
}

function traLoi(res: ServerResponse, ma: number, than: string | Uint8Array, loai: string, themHeader: Readonly<Record<string, string | string[]>> = {}): void {
  res.writeHead(ma, { ...HEADER_CHUNG, "content-type": loai, ...themHeader });
  res.end(than);
}

async function docThan(req: IncomingMessage): Promise<Buffer | null> {
  const phan: Buffer[] = [];
  let tong = 0;
  for await (const c of req) {
    const b = c as Buffer;
    tong += b.length;
    if (tong > TRAN_THAN) return null;
    phan.push(b);
  }
  return Buffer.concat(phan);
}

/**
 * Header được chuyển tiếp LÊN api — một danh sách trắng, không phải "mọi thứ trừ vài cái".
 *
 * `cookie` và `origin` phải đi qua vì chúng là hai thứ `apps/api` phán xét: phiên, và phòng vệ
 * CSRF theo origin (`TRUSTPROCURE_ALLOWED_ORIGINS`). `host` thì KHÔNG đi qua — api phải thấy host
 * của chính nó. `x-forwarded-for` cũng không: khai một địa chỉ mà mình không có quyền khai là
 * đúng thứ `taoDocDiaChi` của api tồn tại để chặn, nên tiến trình này để api nhìn thấy socket
 * thật của nó. Hệ quả: mọi người dùng demo dùng CHUNG một ô đếm hạn mức theo người gọi — chấp
 * nhận được cho một buổi trình bày, và ADR-044 ghi nó ra thay vì để ai đó phát hiện lúc đang demo.
 */
const HEADER_LEN = ["cookie", "content-type", "accept", "origin"] as const;
/** Header được chuyển tiếp XUỐNG trình duyệt. `set-cookie` đi riêng ngay dưới: nó là MẢNG, và nó là thứ làm phiên khách sống được. */
const HEADER_XUONG = ["content-type"] as const;

async function chuyenTiep(req: IncomingMessage, res: ServerResponse, apiOrigin: string): Promise<void> {
  const duong = (req.url ?? "/").slice("/api".length) || "/";
  const than = req.method === "GET" || req.method === "HEAD" ? null : await docThan(req);
  if (than === null && req.method !== "GET" && req.method !== "HEAD") {
    traLoi(res, 413, JSON.stringify({ error: "than yeu cau qua lon" }), "application/json; charset=utf-8");
    return;
  }
  const headers = new Headers();
  for (const h of HEADER_LEN) {
    const v = req.headers[h];
    if (typeof v === "string") headers.set(h, v);
  }
  let ph: Response;
  try {
    ph = await fetch(`${apiOrigin}${duong}`, {
      method: req.method ?? "GET",
      headers,
      body: than === null || than.length === 0 ? undefined : than,
      redirect: "manual",
    });
  } catch {
    // Không nêu chi tiết lỗi mạng ra ngoài: nó mô tả hình dạng mạng nội bộ. Người vận hành đọc
    // log của api, không đọc thân phản hồi của trang demo.
    traLoi(res, 502, JSON.stringify({ error: "khong goi duoc api" }), "application/json; charset=utf-8");
    return;
  }
  const them: Record<string, string | string[]> = {};
  for (const h of HEADER_XUONG) {
    const v = ph.headers.get(h);
    if (v !== null) them[h] = v;
  }
  const cookie = ph.headers.getSetCookie();
  if (cookie.length > 0) them["set-cookie"] = cookie;
  const noiDung = Buffer.from(await ph.arrayBuffer());
  res.writeHead(ph.status, { ...HEADER_CHUNG, "content-type": "application/json; charset=utf-8", ...them });
  res.end(noiDung);
}

export function taoWebServer(tuyChon: TuyChonWeb): Server {
  const tep = napTep();
  const xuLy = (req: IncomingMessage, res: ServerResponse): void => {
    const duong = (req.url ?? "/").split("?")[0] ?? "/";
    if (duong === "/api" || duong.startsWith("/api/")) {
      // [ADR-068] Chỉ tĩnh: reverse proxy định tuyến `/api/*` trước khi tới đây; một yêu cầu lọt tới là cấu hình
      // hạ tầng sai, và trả 404 thay vì đoán một upstream.
      const apiOrigin = tuyChon.apiOrigin;
      if (apiOrigin === null) {
        traLoi(res, 404, JSON.stringify({ error: "khong co" }), "application/json; charset=utf-8");
        return;
      }
      void chuyenTiep(req, res, apiOrigin).catch(() => {
        if (!res.headersSent) traLoi(res, 502, JSON.stringify({ error: "khong goi duoc api" }), "application/json; charset=utf-8");
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      traLoi(res, 405, "phuong thuc khong duoc phep", "text/plain; charset=utf-8");
      return;
    }
    if (duong === "/") {
      res.writeHead(302, { ...HEADER_CHUNG, location: "/nop-thau", "content-type": "text/plain; charset=utf-8" });
      res.end("");
      return;
    }
    const t = tep.get(duong);
    if (t === undefined) {
      traLoi(res, 404, "khong co trang nay", "text/plain; charset=utf-8");
      return;
    }
    traLoi(res, 200, t.noiDung, t.loai);
  };
  return tuyChon.tls === null
    ? taoServerHttp(xuLy)
    : taoServerHttps({ cert: tuyChon.tls.cert, key: tuyChon.tls.key }, xuLy);
}

/** Đọc cặp PEM từ đĩa. Tách khỏi `taoWebServer` để phần dựng server vẫn là một hàm thuần về I/O. */
export function docTls(certPath: string, keyPath: string): { readonly cert: string; readonly key: string } {
  return { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") };
}

/** Đường tuyệt đối của thư mục `trang/` — dùng trong test để đối chiếu bản đồ với đĩa thật. */
export const DUONG_TRANG = fileURLToPath(new URL("trang/", GOC_WEB));
