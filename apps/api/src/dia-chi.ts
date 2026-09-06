// ==============================================================================================
// apps/api/src/dia-chi.ts — ĐỊA CHỈ NGƯỜI GỌI SAU MỘT PROXY KHAI TÊN (sổ nợ 41 / review M-8)
//
// `server.ts` mặc định lấy địa chỉ SOCKET. Sau một proxy/LB, địa chỉ ấy là của proxy, và mọi bucket
// "theo người gọi" (OTP của khách, và từ nợ 39 là ba route `/auth/*`) thành MỘT bucket cho cả tổ
// chức. `X-Forwarded-For` là câu trả lời, và nó là header do KHÁCH đặt được — nên nó chỉ được tin
// khi socket đến từ một proxy đã khai (`TRUSTPROCURE_TRUSTED_PROXIES`, CIDR), và chỉ phần proxy
// ấy ghi thêm: đi từ PHẢI sang trái, bỏ qua mọi địa chỉ thuộc danh sách, lấy địa chỉ đầu tiên
// KHÔNG thuộc — đó là khách theo lời proxy gần nhất. Không có danh sách ⇒ header bị BỎ QUA hoàn
// toàn (hôm nay là ca của mọi máy phát triển). Header hỏng ⇒ socket. Fail-closed ở mọi nhánh.
//
// Cài bằng `net.BlockList` của Node — không phụ thuộc ngoài (`NGOAI_DUOC_PHEP_O_SAN_XUAT` vẫn hai dòng).
// Địa chỉ IPv4 ánh xạ trong IPv6 (`::ffff:1.2.3.4`, cách Node báo socket IPv4 trên listener v6)
// được đưa về dạng IPv4 trước khi so và trước khi trả về, để một CIDR v4 khai một lần là đủ.
// ==============================================================================================

import { BlockList, isIP } from "node:net";

export class DiaChiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiaChiError";
  }
}

/**
 * `::ffff:1.2.3.4` → `1.2.3.4`; [review H4-9] `1.2.3.4:51234` và `[2001:db8::1]:51234` (IIS/ARR, vài LB
 * ghi kèm cổng) → bỏ cổng; mọi dạng khác giữ nguyên. Không bỏ cổng cho một chuỗi IPv6 trần có dấu
 * hai chấm — `2001:db8::1` không phải "địa chỉ:cổng".
 */
export function chuanHoaDiaChi(dc: string): string {
  let s = dc.trim();
  const ngoac = /^\[([^\]]+)\](?::\d{1,5})?$/u.exec(s);
  if (ngoac !== null) s = ngoac[1] ?? "";
  const v4Cong = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{1,5}$/u.exec(s);
  if (v4Cong !== null) s = v4Cong[1] ?? "";
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/iu.exec(s);
  return m?.[1] ?? s;
}

/**
 * Tiền tố hẹp nhất còn có nghĩa "mạng của tôi" — rộng hơn là "cả Internet là proxy của tôi". IPv6 lấy
 * /7 vì `fc00::/7` (ULA) là dải riêng hợp lệ; cái bị chặn là `::/0` và các dải bao cả Internet.
 */
export const TIEN_TO_TOI_THIEU = { ipv4: 8, ipv6: 7 } as const;

/**
 * [review H4-4] KHOÁ BUCKET theo người gọi. IPv6: mỗi khách dân dụng có ít nhất một /64, nên đếm theo
 * địa chỉ nguyên vẹn là cho kẻ tấn công 2^64 bucket miễn phí — khoá là tiền tố /64. IPv4 giữ nguyên
 * (một NAT văn phòng là một địa chỉ — trần theo route phải đủ rộng cho nó, `auth.ts`). Địa chỉ không
 * phải IP (rỗng, hỏng) trả về nguyên văn — dispatcher đã coi đó là MỘT bucket chung, fail-closed.
 */
export function khoaNguoiGoi(dc: string): string {
  const s = chuanHoaDiaChi(dc);
  if (isIP(s) !== 6) return s;
  const khongVung = s.split("%")[0] ?? s;
  const [trai, phai] = khongVung.split("::");
  const nhomTrai = trai === "" || trai === undefined ? [] : trai.split(":");
  const nhomPhaiTho = phai === undefined || phai === "" ? [] : phai.split(":");
  // Đuôi IPv4 (`64:ff9b::1.2.3.4`) là HAI nhóm 16 bit; giá trị của chúng không bao giờ lọt vào 64 bit đầu.
  const nhomPhai = nhomPhaiTho.flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const nhomTraiDayDu = nhomTrai.flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const thieu = Math.max(0, 8 - nhomTraiDayDu.length - nhomPhai.length);
  const tatCa = [...nhomTraiDayDu, ...new Array<string>(thieu).fill("0"), ...nhomPhai];
  return `${tatCa.slice(0, 4).map((g) => g.toLowerCase().padStart(4, "0")).join(":")}::/64`;
}

/**
 * Dựng danh sách CIDR tin cậy. Mỗi mục là `a.b.c.d`, `a.b.c.d/n`, `x::y` hay `x::y/n`. Sai hình
 * dạng ⇒ ném NGAY (cấu hình, không phải lúc chạy).
 */
export function taoDanhSachTinCay(cac: readonly string[]): BlockList {
  const ds = new BlockList();
  for (const mucTho of cac) {
    const muc = mucTho.trim();
    if (muc === "") continue;
    const [dcTho, tienTo] = muc.split("/");
    const dc = chuanHoaDiaChi(dcTho ?? "");
    const ho = isIP(dc);
    if (ho === 0) throw new DiaChiError(`proxy tin cậy "${muc}" không phải địa chỉ IP`);
    const loai = ho === 4 ? "ipv4" : "ipv6";
    if (tienTo === undefined) {
      ds.addAddress(dc, loai);
      continue;
    }
    const n = /^\d{1,3}$/u.test(tienTo) ? Number(tienTo) : -1;
    if (n < 0 || n > (ho === 4 ? 32 : 128)) throw new DiaChiError(`proxy tin cậy "${muc}" có tiền tố không hợp lệ`);
    // [review H4-9] `0.0.0.0/0` hay `::/0` là "mọi socket là proxy" ⇒ XFF do khách tự đặt được tin ⇒
    // bucket theo người gọi và `sessions.ip` đều giả được. Đó là một lỗi cấu hình, chặn lúc khởi động.
    if (n < TIEN_TO_TOI_THIEU[loai]) {
      throw new DiaChiError(`proxy tin cậy "${muc}" có tiền tố quá rộng (tối thiểu /${TIEN_TO_TOI_THIEU[loai]})`);
    }
    ds.addSubnet(dc, n, loai);
  }
  return ds;
}

function thuocDanhSach(ds: BlockList, dc: string): boolean {
  const ho = isIP(dc);
  return ho !== 0 && ds.check(dc, ho === 4 ? "ipv4" : "ipv6");
}

/** Phần của `IncomingMessage` mà hàm đọc địa chỉ cần — một kiểu cấu trúc, để test dựng tay được. */
export interface YeuCauCoDiaChi {
  readonly socket: { readonly remoteAddress?: string | undefined };
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Hàm đọc địa chỉ người gọi cho `createApiServer({ remoteAddressOf })`. Danh sách rỗng ⇒ luôn socket.
 */
export function taoDocDiaChi(proxyTinCay: readonly string[]): (req: YeuCauCoDiaChi) => string {
  const ds = taoDanhSachTinCay(proxyTinCay);
  const coProxy = proxyTinCay.some((m) => m.trim() !== "");
  return (req) => {
    const socket = chuanHoaDiaChi(req.socket.remoteAddress ?? "");
    if (!coProxy || !thuocDanhSach(ds, socket)) return socket;
    const tho = req.headers["x-forwarded-for"];
    const chuoi = Array.isArray(tho) ? tho.join(",") : (tho ?? "");
    const cacHop = chuoi.split(",").map((x) => chuanHoaDiaChi(x));
    for (let i = cacHop.length - 1; i >= 0; i -= 1) {
      const dc = cacHop[i] ?? "";
      if (isIP(dc) === 0) return socket; // header hỏng: không đoán, không tin.
      if (!thuocDanhSach(ds, dc)) return dc;
    }
    return socket; // mọi hop đều là proxy (hoặc header rỗng): khách là chính socket.
  };
}
