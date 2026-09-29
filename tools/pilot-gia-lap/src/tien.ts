// ==============================================================================================
// tools/pilot-gia-lap — PHÉP TÍNH TIỀN CHÍNH XÁC, KHÔNG MỘT SỐ THỰC NÀO
//
// Bảng so sánh của sản phẩm phải khớp "tới từng chữ số" với thứ đã niêm phong (`docs/PRODUCT.md`
// §11), nên bộ giả lập tự tính tổng bằng số nguyên lớn: số lượng mang bốn chữ số thập phân
// (`rfq_items.quantity`), đơn giá là số nguyên đồng (cách `/nop-thau` chuẩn hoá ô đơn giá), thành
// tiền và tổng mang hai chữ số thập phân — đúng dạng `totalAmount` mà `bid_so_tien` đọc.
// ==============================================================================================

const SO_LUONG = /^\d{1,12}(?:\.\d{1,4})?$/u;
const TIEN = /^\d{1,15}(?:\.\d{1,2})?$/u;
const DON_GIA = /^\d{1,13}$/u;

function doiSoNguyen(chuoi: string, soLe: number, mau: RegExp, ten: string): bigint {
  if (!mau.test(chuoi)) throw new RangeError(`${ten} không đúng dạng: "${chuoi}"`);
  const [nguyen = "0", le = ""] = chuoi.split(".");
  return BigInt(nguyen) * 10n ** BigInt(soLe) + BigInt(le.padEnd(soLe, "0"));
}

function inTien(xu: bigint): string {
  const am = xu < 0n;
  const tuyetDoi = am ? -xu : xu;
  const nguyen = tuyetDoi / 100n;
  const le = (tuyetDoi % 100n).toString().padStart(2, "0");
  return `${am ? "-" : ""}${nguyen.toString()}.${le}`;
}

/**
 * Thành tiền của một dòng: `soLuong` (≤ 4 chữ số lẻ) × `donGia` (số nguyên đồng), ~~làm tròn nửa lên tới xu~~
 * **[S1.9181 / khoản 218]** làm tròn **nửa-ra-xa-0** tới xu — MỘT luật với `lamTron` của `@trustprocure/danh-gia`
 * và `thanhTien` của `apps/web/src/so-tien.ts` (ADR-050 ⑴). Trên miền không âm mà `SO_LUONG`/`DON_GIA` cưỡng chế,
 * nửa-lên và nửa-ra-xa-0 là cùng một hàm, nên thân hàm không đổi; đổi là LỜI KHAI, và `tien.test.ts` đối chiếu
 * với `lamTron` ở cả 100 phần dư cộng bảng ca nửa xu. Giữ bản riêng thay vì import: gói này không khai
 * `@trustprocure/danh-gia` và bộ giả lập là công cụ dev đứng ngoài sản phẩm — phép đo cạnh nhau là lớp giữ.
 */
export function thanhTien(soLuong: string, donGia: string): string {
  const sl = doiSoNguyen(soLuong, 4, SO_LUONG, "số lượng");
  const dg = doiSoNguyen(donGia, 0, DON_GIA, "đơn giá");
  // sl mang 4 chữ số lẻ ⇒ tích mang 4; đưa về 2 chữ số lẻ. `tich` ≥ 0 nên cộng nửa rồi chia là nửa-ra-xa-0.
  const tich = sl * dg;
  return inTien((tich + 50n) / 100n);
}

/** Tổng của các số tiền hai chữ số lẻ. */
export function congTien(ds: readonly string[]): string {
  let tong = 0n;
  for (const t of ds) tong += doiSoNguyen(t, 2, TIEN, "số tiền");
  return inTien(tong);
}

/** So sánh hai số tiền: âm nếu a < b, 0 nếu bằng, dương nếu a > b. */
export function soSanhTien(a: string, b: string): number {
  const x = doiSoNguyen(a, 2, TIEN, "số tiền");
  const y = doiSoNguyen(b, 2, TIEN, "số tiền");
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Đơn giá chào của một nhà cung cấp: đơn giá thị trường × hệ số phần nghìn, làm tròn tới 10 đồng.
 * Hệ số là SỐ NGUYÊN (970 = 97%) để danh mục kịch bản không mang một số thực nào.
 *
 * Vì sao 10 đồng mà không 100: một lần ĐỘT BIẾN đo ra rằng khi mọi đơn giá tròn trăm và mọi số lượng
 * nguyên thì mọi tổng giá tròn nghìn — và một bảng so sánh làm tròn tổng tới nghìn đồng vẫn "khớp từng
 * chữ số" với dữ liệu ấy. Đơn giá lẻ chục cùng số lượng lẻ (kg, m, m3) trong danh mục làm tổng mang cả
 * hàng đơn vị lẫn hàng xu, nên phép so ở `chay-kich-ban.ts` có răng với lớp lỗi làm tròn.
 */
export function donGiaChao(donGiaThiTruong: string, heSoPhanNghin: number): string {
  if (!Number.isInteger(heSoPhanNghin) || heSoPhanNghin < 500 || heSoPhanNghin > 1500) {
    throw new RangeError(`hệ số phần nghìn ngoài khoảng 500–1500: ${heSoPhanNghin}`);
  }
  const dg = doiSoNguyen(donGiaThiTruong, 0, DON_GIA, "đơn giá thị trường");
  const tich = dg * BigInt(heSoPhanNghin);
  // tich tính theo phần nghìn đồng; làm tròn nửa lên tới 10 đồng = 10 000 phần nghìn.
  return (((tich + 5_000n) / 10_000n) * 10n).toString();
}

/** Tỷ lệ phần trăm (một chữ số lẻ) của `phan` so với `tong` — cho báo cáo, không cho phép so sánh. */
export function phanTram(phan: string, tong: string): string {
  const p = doiSoNguyen(phan, 2, TIEN, "số tiền");
  const t = doiSoNguyen(tong, 2, TIEN, "số tiền");
  if (t === 0n) return "—";
  const phanNghin = (p * 1000n + t / 2n) / t;
  return `${(phanNghin / 10n).toString()},${(phanNghin % 10n).toString()}%`;
}

/** `1440000000.00` → `1.440.000.000` — cách đọc số tiền của người Việt, chỉ cho báo cáo. */
export function dinhDangVnd(tien: string): string {
  if (!TIEN.test(tien)) return tien;
  const [nguyen = "0", le = "00"] = tien.split(".");
  const nhom = nguyen.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return le === "00" || le === "0" ? nhom : `${nhom},${le.padEnd(2, "0")}`;
}
