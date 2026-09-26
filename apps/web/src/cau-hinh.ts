// ==============================================================================================
// apps/web/src/cau-hinh.ts — CẤU HÌNH TỪ MÔI TRƯỜNG, FAIL-CLOSED
//
// Cùng khuôn `apps/api/src/cau-hinh.ts`: một hàm THUẦN, nhận bản đồ tên → chuỗi, trả về cấu hình
// đã kiểm hình dạng hoặc ném `CauHinhError`. Thông điệp lỗi chỉ nêu TÊN biến, không nêu GIÁ TRỊ.
//
// App này KHÔNG có bí mật nào để đọc — không khoá, không chuỗi kết nối CSDL, không pepper. Đó là
// tính chất đáng chú ý nhất của nó và `package.json` nói thẳng ra: mọi quyền nó có là quyền của
// phiên mà trình duyệt đang cầm.
//
// VỀ `TRUSTPROCURE_WEB_TLS_*`, VÀ VÌ SAO NÓ KHÔNG PHẢI MỘT THỨ TRANG TRÍ
//
// Cookie phiên khách là `__Host-tp_guest`, mang `Secure` (đo ở `apps/api/src/guest.int.test.ts`).
// Trình duyệt chỉ gửi cookie `Secure` qua ngữ cảnh an toàn: `https://…` ở mọi nơi, và `http://`
// CHỈ cho `localhost`/`127.0.0.1`. Hệ quả vận hành, nói trước khi ai đó mất một buổi vì nó: mở
// trang này trên ĐIỆN THOẠI qua một địa chỉ LAN dạng `http://192.168.x.x` thì đăng nhập khách sẽ
// im lặng thất bại — trình duyệt nhận `Set-Cookie` rồi vứt đi. Muốn demo trên máy thật phải có
// HTTPS, và hai biến này là đường ngắn nhất tới đó.
// ==============================================================================================

export class CauHinhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CauHinhError";
  }
}

export interface CauHinhWeb {
  readonly listenHost: string;
  readonly listenPort: number;
  /**
   * Origin của `apps/api`, dạng thuần `scheme://host[:port]`, không dấu `/` cuối.
   * [ADR-068] `null` = CHỈ PHỤC VỤ TĨNH: `/api/*` do reverse proxy của hạ tầng (ALB) định tuyến thẳng
   * tới api, nên tiến trình này không bao giờ thấy cookie phiên.
   */
  readonly apiOrigin: string | null;
  /** Đường tới cert và key dạng PEM. `null` = chạy HTTP (chỉ dùng được ở localhost). */
  readonly tls: { readonly certPath: string; readonly keyPath: string } | null;
}

const CONG_MAC_DINH = 8090;
const HOST_MAC_DINH = "127.0.0.1";

function docChuoi(env: Readonly<Record<string, string | undefined>>, ten: string): string | null {
  const v = env[ten];
  if (v === undefined || v.trim() === "") return null;
  return v.trim();
}

function docCong(env: Readonly<Record<string, string | undefined>>, ten: string): number {
  const v = docChuoi(env, ten);
  if (v === null) return CONG_MAC_DINH;
  if (!/^\d{1,5}$/u.test(v)) throw new CauHinhError(`${ten}: phải là một số cổng`);
  const n = Number(v);
  if (n < 1 || n > 65535) throw new CauHinhError(`${ten}: ngoài khoảng 1–65535`);
  return n;
}

function docOrigin(env: Readonly<Record<string, string | undefined>>, ten: string): string {
  const v = docChuoi(env, ten);
  if (v === null) throw new CauHinhError(`${ten}: thiếu — không biết chuyển tiếp /api/* đi đâu`);
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new CauHinhError(`${ten}: không phải một URL hợp lệ`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CauHinhError(`${ten}: chỉ nhận http: hoặc https:`);
  }
  // Cùng phép kiểm với `docOrigins` của `apps/api`: một origin THUẦN, không đường dẫn, không dấu
  // `/` cuối. Một giá trị mang đường dẫn sẽ làm phép nối URL ở `phuc-vu.ts` ra một địa chỉ khác
  // với thứ người vận hành đọc trong log, và đó là loại lệch không ai phát hiện được bằng mắt.
  if (url.origin !== v) throw new CauHinhError(`${ten}: phải là origin thuần (scheme://host[:port], không dấu / cuối)`);
  return url.origin;
}

function docTls(env: Readonly<Record<string, string | undefined>>): CauHinhWeb["tls"] {
  const cert = docChuoi(env, "TRUSTPROCURE_WEB_TLS_CERT");
  const key = docChuoi(env, "TRUSTPROCURE_WEB_TLS_KEY");
  if (cert === null && key === null) return null;
  // Khai một nửa là lỗi, không phải "gần đủ": rơi âm thầm về HTTP ở đây làm cookie `Secure` bị
  // trình duyệt vứt, và triệu chứng hiện ra ở tận màn đăng nhập của nhà cung cấp.
  if (cert === null) throw new CauHinhError("TRUSTPROCURE_WEB_TLS_CERT: thiếu, trong khi TRUSTPROCURE_WEB_TLS_KEY có mặt");
  if (key === null) throw new CauHinhError("TRUSTPROCURE_WEB_TLS_KEY: thiếu, trong khi TRUSTPROCURE_WEB_TLS_CERT có mặt");
  return { certPath: cert, keyPath: key };
}

/**
 * [ADR-068] Hai chế độ LOẠI TRỪ NHAU: chuyển tiếp (`TRUSTPROCURE_API_ORIGIN`, lát cắt demo ADR-044) hoặc chỉ tĩnh
 * (`TRUSTPROCURE_WEB_STATIC_ONLY=1`). ADR-044 nói bộ chuyển tiếp "không được đứng trước một cụm sản xuất" — nay đó là một
 * hàng rào: `NODE_ENV=production` mà không ở chế độ chỉ tĩnh là lỗi khởi động, không phải một dòng trong tài liệu.
 */
function docApiOrigin(env: Readonly<Record<string, string | undefined>>): string | null {
  const chiTinh = docChuoi(env, "TRUSTPROCURE_WEB_STATIC_ONLY");
  if (chiTinh !== null && chiTinh !== "1") throw new CauHinhError("TRUSTPROCURE_WEB_STATIC_ONLY: chỉ nhận 1");
  if (chiTinh === "1") {
    if (docChuoi(env, "TRUSTPROCURE_API_ORIGIN") !== null) {
      throw new CauHinhError("TRUSTPROCURE_API_ORIGIN: không được có mặt cùng TRUSTPROCURE_WEB_STATIC_ONLY=1 — hai chế độ loại trừ nhau");
    }
    return null;
  }
  if (docChuoi(env, "NODE_ENV") === "production") {
    throw new CauHinhError(
      "TRUSTPROCURE_WEB_STATIC_ONLY: bắt buộc =1 khi NODE_ENV=production — bộ chuyển tiếp /api/* không đứng trước cụm sản xuất (ADR-044, ADR-068)",
    );
  }
  return docOrigin(env, "TRUSTPROCURE_API_ORIGIN");
}

export function docCauHinh(env: Readonly<Record<string, string | undefined>>): CauHinhWeb {
  return {
    listenHost: docChuoi(env, "TRUSTPROCURE_WEB_HOST") ?? HOST_MAC_DINH,
    listenPort: docCong(env, "TRUSTPROCURE_WEB_PORT"),
    apiOrigin: docApiOrigin(env),
    tls: docTls(env),
  };
}
