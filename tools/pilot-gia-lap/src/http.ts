// ==============================================================================================
// tools/pilot-gia-lap — MỘT "THIẾT BỊ" CỦA MỘT DIỄN VIÊN: hũ cookie riêng, địa chỉ riêng
//
// Mỗi người mua và mỗi phiên khách của nhà cung cấp là MỘT `PhienHttp`. Hai lý do nó phải riêng:
//   ⑴ cookie phiên (`__Host-tp_session`, `__Host-tp_guest`) là danh tính — hai diễn viên chung một
//      hũ là một người bấm thay người kia, đúng thứ D2 và J3 cấm;
//   ⑵ mọi trần "theo người gọi" của `apps/api` đếm theo địa chỉ, và từ `042` bucket là TOÀN CỤC. Hai
//      mươi diễn viên chung 127.0.0.1 thì lượt chạy đụng trần 30/15 phút của `/auth/*` ở giữa chừng.
//
// Địa chỉ đi qua `X-Forwarded-For`, và `apps/api` chỉ tin header ấy vì bộ khởi cụm khai 127.0.0.1 là
// proxy tin cậy (`TRUSTPROCURE_TRUSTED_PROXIES`, sổ nợ 41) — đúng đường `auth.int.test.ts` đo. Địa chỉ
// thuộc dải TÀI LIỆU `2001:db8::/32` (RFC 3849): nó hiện ra trong `sessions.ip` và nói rõ nó là bịa.
// Mỗi diễn viên một /64, vì khoá bucket IPv6 của `dia-chi.ts` là tiền tố /64.
// ==============================================================================================

export interface PhanHoi {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
}

/** Địa chỉ IPv6 tài liệu, một /64 cho mỗi (lượt chạy, diễn viên). */
export function diaChiGiaLap(maLuot: number, thuTu: number): string {
  if (!Number.isInteger(maLuot) || maLuot < 0 || maLuot > 0xffff) throw new RangeError("maLuot ngoài 0–65535");
  if (!Number.isInteger(thuTu) || thuTu < 0 || thuTu > 0xffff) throw new RangeError("thuTu ngoài 0–65535");
  return `2001:db8:${maLuot.toString(16)}:${thuTu.toString(16)}::1`;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class PhienHttp {
  private readonly cookie = new Map<string, string>();

  constructor(
    private readonly goc: string,
    readonly diaChi: string,
  ) {}

  /** Có cookie phiên (người mua hay khách) chưa. */
  coPhien(): boolean {
    return this.cookie.size > 0;
  }

  async goi(method: string, duong: string, than?: unknown): Promise<PhanHoi> {
    const headers: Record<string, string> = { "x-forwarded-for": this.diaChi, accept: "application/json" };
    if (this.cookie.size > 0) headers.cookie = [...this.cookie.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined;
    if (than !== undefined) {
      body = JSON.stringify(than);
      headers["content-type"] = "application/json";
    }
    const res = await fetch(`${this.goc}${duong}`, { method, headers, body });
    for (const dong of res.headers.getSetCookie()) {
      const dau = dong.split(";")[0] ?? "";
      const bang = dau.indexOf("=");
      if (bang <= 0) continue;
      const ten = dau.slice(0, bang).trim();
      const giaTri = dau.slice(bang + 1).trim();
      if (giaTri === "") this.cookie.delete(ten);
      else this.cookie.set(ten, giaTri);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : (JSON.parse(text) as unknown);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, body: json };
  }
}

/** Đọc một trường lồng nhau của thân JSON; sai hình dạng thì ném kèm tên đường dẫn. */
export function lay(than: unknown, ...duong: readonly (string | number)[]): unknown {
  let x: unknown = than;
  for (const k of duong) {
    if (x === null || typeof x !== "object") throw new HttpError(`phản hồi thiếu trường ${duong.join(".")}`, 0);
    x = (x as Record<string | number, unknown>)[k];
  }
  return x;
}

export function layChuoi(than: unknown, ...duong: readonly (string | number)[]): string {
  const v = lay(than, ...duong);
  if (typeof v !== "string") throw new HttpError(`trường ${duong.join(".")} không phải chuỗi`, 0);
  return v;
}

export function laySo(than: unknown, ...duong: readonly (string | number)[]): number {
  const v = lay(than, ...duong);
  if (typeof v !== "number") throw new HttpError(`trường ${duong.join(".")} không phải số`, 0);
  return v;
}

export function layMang(than: unknown, ...duong: readonly (string | number)[]): readonly unknown[] {
  const v = lay(than, ...duong);
  if (!Array.isArray(v)) throw new HttpError(`trường ${duong.join(".")} không phải mảng`, 0);
  return v as readonly unknown[];
}
