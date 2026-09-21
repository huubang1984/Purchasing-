// ==============================================================================================
// [S1.99 / khoản 206] SỐ TIỀN CỦA TRANG NỘP THẦU — MỘT BẢN CÀI, ĐƯỢC TSC GÁC VÀ VITEST ĐO
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO TỆP NÀY RA ĐỜI, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// `nop-thau.js` mở đầu bằng một nguyên tắc đúng: nó *"import `sealBid` từ chính
// `packages/sealed-envelope/src/seal.ts` … Không có bản cài thứ hai của định dạng phong bì ở
// đây, và đó là điểm quan trọng nhất của tệp này: thứ trình duyệt chạy là thứ `roundtrip.test.ts`
// đo."*
//
// Phép tính quyết định CON SỐ đi vào phong bì thì không được hưởng nguyên tắc ấy: nó nằm nội
// tuyến trong `nop-thau.js`, một tệp `.js` ngoài `tsconfig.json`, trong một thư mục 1 158 dòng
// không có một test nào. Lượt soi ngang 76 đo ra hậu quả:
//
//     người nộp gõ `1.500`  →  trang tính ra `1,00`, IM LẶNG, sai 1500 lần
//     người nộp gõ `12.5`   →  trang tính ra `12,00`, IM LẶNG
//     trang HIỂN THỊ tổng   →  `1.500.000,00` — dấu chấm là NGHÌN
//
// Tức cùng một trang DẠY người dùng rằng dấu chấm nhóm nghìn khi nó in ra, rồi ĐỌC dấu chấm ấy
// là dấu thập phân khi người ta gõ vào. Và hậu quả không dừng ở một ô hiển thị: `dongTien()` đưa
// CHUỖI THÔ người dùng gõ vào `unitPrice` của phong bì còn `amount` thì tính ra, nên phong bì
// niêm phong mang hai con số tự mâu thuẫn — trên đúng thứ không sửa được sau hạn nộp.
//
// ----------------------------------------------------------------------------------------------
// HAI PHÉP PHÂN GIẢI, VÀ VÌ SAO PHẢI LÀ HAI
// ----------------------------------------------------------------------------------------------
// `sangNguyen` đọc chuỗi MÁY SINH RA (`quantity` của API, đầu ra của `thanhTien`): ở đó dấu chấm
// là dấu thập phân, luôn luôn, vì chính máy chủ viết ra thế.
//
// `donGiaNguoiGo` đọc chuỗi NGƯỜI GÕ: ở đó dấu chấm chỉ có thể là dấu nhóm nghìn — đơn giá là số
// nguyên đồng, ô nhập không có chỗ cho phần lẻ, và trang tự in ra dạng nhóm nghìn ở dòng tổng.
// Nó nhận ĐÚNG hai dạng và từ chối mọi dạng khác:
//
//     `1500000`      ✓ 1500000     `12.5`       ✗ không phải dạng nhóm nghìn
//     `1.500.000`    ✓ 1500000     `1.50`       ✗
//     `1.500`        ✓ 1500        `12,5`       ✗ dấu phẩy là dấu thập phân khi HIỂN THỊ
//
// Một dạng mơ hồ bị TỪ CHỐI CÓ TIẾNG chứ không được đoán: đoán sai ở đây là một phong bì niêm
// phong sai, và người nộp không có lượt thứ hai.
//
// `sangNguyen` cũng thôi cắt cụt âm thầm: phần lẻ dài hơn `soLe` nay trả `null` thay vì bị cắt.
// Đó là cùng một lớp lỗi ở phía chuỗi máy, và nó đã sống được vì không ai đo nó bao giờ.
// ==============================================================================================

/**
 * Chuỗi thập phân MÁY SINH RA → số nguyên tỉ lệ `10^soLe`.
 *
 * Trả `null` khi chuỗi không phải dạng thập phân không dấu, HOẶC khi phần lẻ dài hơn `soLe` —
 * vế thứ hai là chỗ cắt cụt âm thầm từng sống. Không nhận dấu âm: không con số nào của một
 * phong bì thầu âm, và một dấu trừ lọt qua đây là một dấu trừ không ai định viết.
 */
export function sangNguyen(chuoi: string, soLe: number): bigint | null {
  const s = chuoi.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [nguyen, le = ""] = s.split(".");
  if (le.length > soLe) return null;
  return BigInt((nguyen ?? "") + (le + "0".repeat(soLe)).slice(0, soLe));
}

/**
 * Đơn giá NGƯỜI GÕ → chuỗi số nguyên đã chuẩn hoá, hoặc `null` nếu dạng mơ hồ.
 *
 * Đầu ra là thứ đi vào `unitPrice` của phong bì, nên nó phải là DẠNG CHUẨN chứ không phải chuỗi
 * thô: một phong bì mang `1.500` bên cạnh `amount` tính từ `1500` là một phong bì tự cãi mình.
 */
export function donGiaNguoiGo(chuoi: string): string | null {
  const s = chuoi.trim();
  if (s === "") return null;
  if (/^\d+$/.test(s)) return s;
  // Dạng nhóm nghìn kiểu Việt Nam, đúng dạng mà `nhomSo` dưới đây IN RA. Vế `{1,3}` ở đầu là thứ
  // loại `12.5` và `1.50`: chúng không phải một lần nhóm nghìn nào cả.
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return s.replaceAll(".", "");
  return null;
}

/** `sl` (tối đa 4 chữ số thập phân) × `dg` (số nguyên) → chuỗi tiền 2 chữ số thập phân. */
export function thanhTien(sl: string, dg: string): string | null {
  const a = sangNguyen(sl, 4);
  const b = sangNguyen(dg, 0);
  if (a === null || b === null) return null;
  const scaled = (a * b * 100n) / 10000n;
  return `${scaled / 100n}.${String(scaled % 100n).padStart(2, "0")}`;
}

/** Cộng các chuỗi tiền 2 chữ số thập phân. `null` nếu bất kỳ chuỗi nào không đọc được. */
export function cong(dsChuoi: readonly (string | null)[]): string | null {
  let t = 0n;
  for (const c of dsChuoi) {
    if (c === null) return null;
    const v = sangNguyen(c, 2);
    if (v === null) return null;
    t += v;
  }
  return `${t / 100n}.${String(t % 100n).padStart(2, "0")}`;
}

/** Nhóm nghìn bằng dấu chấm — dạng Việt Nam, và là dạng `donGiaNguoiGo` nhận lại. */
export function nhomSo(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Chuỗi tiền 2 chữ số thập phân → dạng đọc được: `1500000.00` → `1.500.000,00`. */
export function tien(chuoi: string | null | undefined): string {
  if (chuoi === null || chuoi === undefined) return "—";
  const [n = "", l = "00"] = String(chuoi).split(".");
  return `${nhomSo(n)},${l}`;
}
