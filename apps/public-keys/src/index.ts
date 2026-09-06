// ==============================================================================================
// [khoản nợ 30] ĐƯỜNG CÔNG BỐ KHOÁ CÔNG KHAI KÝ BIÊN NHẬN
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// `ReceiptSigningKeyRing.publicKeys()` trả nửa công khai theo `kid`, và biên nhận mang `kid` trong
// chính văn bản đã ký — **cấu trúc** đã đủ từ S1.5. Thứ thiếu là **ĐƯỜNG**: không có chỗ nào một
// nhà cung cấp lấy được khoá ấy, vì `apps/` còn rỗng. Hệ quả hôm nay: họ lấy khoá bằng cách hỏi
// chính chúng ta qua email, nên vế *"kiểm chứng độc lập"* của B2 mới đúng một nửa.
//
// ----------------------------------------------------------------------------------------------
// FILE NÀY ĐÓNG NỬA NÀO, VÀ NỬA NÀO NÓ *KHÔNG* ĐÓNG
// ----------------------------------------------------------------------------------------------
// ĐÓNG: **đường**. Có một tài liệu ổn định, đọc được bằng máy, không cần xác thực, tra được theo
// `kid`. Một nhà cung cấp viết được một script kiểm chữ ký mà không phải hỏi ai.
//
// KHÔNG ĐÓNG: **tính độc lập**. Một endpoint do CHÍNH CHÚNG TA phục vụ vẫn là *"hỏi chúng ta"* —
// chỉ nhanh hơn. Một máy chủ bị chiếm phục vụ được một khoá khác, và mọi biên nhận giả ký bằng
// khoá ấy sẽ kiểm chứng SẠCH. Nói cho đúng: file này biến *"hỏi chúng ta qua email"* thành *"hỏi
// chúng ta qua HTTPS"*, và đó là một cải thiện về VẬN HÀNH chứ không về NIỀM TIN.
//
// Cái đóng được nửa còn lại là một NEO NGOÀI: `fingerprint` (SHA-256 của SPKI) trong mỗi mục dưới
// đây tồn tại đúng để đi ra khỏi hệ thống — in vào hợp đồng, đọc qua điện thoại, đăng ở một nơi
// chúng ta không kiểm soát. Một nhà cung cấp so dấu vân tay ấy với thứ endpoint trả về thì mới có
// một phép kiểm chứng THẬT SỰ độc lập. Đây là cùng một khoản nợ với "artefact neo ngoài của B3"
// (khoản nợ 11 của sổ S0), và nó vẫn mở — cơ chế có, artefact thì chưa.
//
// ----------------------------------------------------------------------------------------------
// KHÔNG PHỤ THUỘC HTTP FRAMEWORK NÀO
// ----------------------------------------------------------------------------------------------
// `node:http` trần. Thêm một framework vào đây là thêm một mục vào danh sách phụ thuộc sản xuất
// đã ghim (`tests/architecture/pham-vi-san-xuat.test.ts`) — cho một dịch vụ có ĐÚNG hai đường và
// không nhận một byte thân yêu cầu nào. Cái giá phải trả được nói ra: định tuyến ở đây là so
// chuỗi bằng tay, và nó chỉ chịu được đúng chừng này đường.
// ==============================================================================================

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  RECEIPT_SIGNING_ALGORITHM,
  type ReceiptSigningKeyRing,
} from "@trustprocure/bidding";

/** Đường dẫn của tài liệu khoá. Cố định — một URL đổi được là một URL không neo được vào đâu. */
export const RECEIPT_KEYS_PATH = "/.well-known/trustprocure-receipt-keys";

export interface PublishedReceiptKey {
  readonly kid: string;
  /** Thuật toán ký, để người kiểm không phải đoán. */
  readonly alg: string;
  /** Khoá công khai dạng **SPKI DER**, mã hoá base64 — dạng `openssl pkey -pubin` đọc thẳng. */
  readonly spki: string;
  /**
   * SHA-256 của chính chuỗi byte SPKI, viết hex thường.
   *
   * Đây là thứ ĐI RA KHỎI hệ thống: in vào hợp đồng, đọc qua điện thoại. Nó tồn tại vì một tài
   * liệu do chúng ta phục vụ không tự chứng minh được nó chưa bị thay.
   */
  readonly fingerprint: string;
}

export interface ReceiptKeyDocument {
  readonly activeKeyId: string;
  readonly keys: readonly PublishedReceiptKey[];
}

/**
 * Dựng tài liệu công bố từ một vòng khoá.
 *
 * Hàm này KHÔNG chạm nửa riêng — `publicKeys()` của vòng khoá chỉ trả nửa công khai, và test của
 * gói này khẳng định điều đó bằng cách tìm chuỗi byte khoá riêng trong tài liệu đã tuần tự hoá.
 */
export function buildReceiptKeyDocument(ring: ReceiptSigningKeyRing): ReceiptKeyDocument {
  const keys = [...ring.publicKeys()]
    .map(([kid, spki]) => ({
      kid,
      alg: RECEIPT_SIGNING_ALGORITHM,
      spki: Buffer.from(spki).toString("base64"),
      fingerprint: createHash("sha256").update(spki).digest("hex"),
    }))
    // Thứ tự ổn định: tài liệu này được so byte ở tầng vận hành, và một thứ tự phụ thuộc thứ tự
    // chèn sẽ làm hai lần khởi động cho hai tài liệu khác nhau mà không có gì đổi.
    .sort((a, b) => (a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0));
  return { activeKeyId: ring.activeKeyId, keys };
}

function traLoi(res: ServerResponse, ma: number, than: unknown): void {
  const noiDung = JSON.stringify(than);
  res.writeHead(ma, {
    "content-type": "application/json; charset=utf-8",
    // Khoá công khai là công khai. Không có `Vary`, không có cookie, không có gì để giấu — nhưng
    // cũng KHÔNG cache dài: một lần xoay khoá phải tới được người kiểm trong vòng vài phút, không
    // vài ngày.
    "cache-control": "public, max-age=300",
    // Tài liệu này không bao giờ được nhúng vào một trang, và không bao giờ là HTML.
    "x-content-type-options": "nosniff",
  });
  res.end(noiDung);
}

/**
 * Máy chủ công bố khoá — CHỈ ĐỌC, và sự chỉ-đọc ấy được cưỡng chế ở đây chứ không ở tầng triển
 * khai: mọi phương thức khác `GET`/`HEAD` bị từ chối trước khi chạm tới định tuyến.
 */
export function createReceiptKeyServer(ring: ReceiptSigningKeyRing): Server {
  const taiLieu = buildReceiptKeyDocument(ring);
  const theoKid = new Map(taiLieu.keys.map((k) => [k.kid, k]));

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      traLoi(res, 405, { error: "chi doc" });
      return;
    }
    // `req.url` là đường dẫn thô kèm query. Chỉ lấy phần đường dẫn: một `?callback=` bám đuôi
    // không được biến `/.well-known/...` thành một đường khác.
    const duongDan = (req.url ?? "/").split("?")[0] ?? "/";

    if (duongDan === RECEIPT_KEYS_PATH) {
      traLoi(res, 200, taiLieu);
      return;
    }
    if (duongDan.startsWith(`${RECEIPT_KEYS_PATH}/`)) {
      const kid = decodeURIComponent(duongDan.slice(RECEIPT_KEYS_PATH.length + 1));
      const khoa = theoKid.get(kid);
      if (khoa === undefined) {
        // KHÔNG vọng lại `kid` mà người gọi gửi: đường này không xác thực, nên nó là một máy
        // phản chiếu miễn phí cho bất kỳ ai muốn nhét chuỗi của mình vào log của chúng ta.
        traLoi(res, 404, { error: "khong co kid nay" });
        return;
      }
      traLoi(res, 200, khoa);
      return;
    }
    traLoi(res, 404, { error: "khong co duong nay" });
  });
}
