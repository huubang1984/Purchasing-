// [S1.256 / S4.5b] SỐ THẬP PHÂN CHÍNH XÁC cho lõi benchmark (ADR-141 ⑧: *"số thập phân chính xác dạng chuỗi"*).
//
// Đơn giá quy đổi của `quan_sat_gia` là `numeric` với số chữ số lẻ THAY ĐỔI (`thanh_tien / (so_luong * he_so)`), nên lối bigint
// co giãn theo một số chữ số lẻ cố định của `chi-phi-hieu-dung.ts` không đủ. Ở đây một số là `m / 10^s` — `m` bigint, `s` số
// nguyên không âm — và mọi phép mà lõi cần đều ĐÓNG trên tập ấy: cộng, trừ, nhân, so, và chia cho LUỸ THỪA CỦA 2 (`x / 2^k =
// x · 5^k / 10^k`), đủ cho trung vị của tập chẵn và tứ phân vị nội suy tuyến tính. Không phép chia tổng quát, không `double`.
//
// Tất định, không I/O. Bộ kiểm độc lập của S4.5c (tính lại ngoại tuyến) cài lại đúng những phép này từ `DAC-TA.md`.

/** Giá trị `m / 10^s`. Không chuẩn hoá: `1.50` và `1.5` là hai cách viết của một số, `soSanh` cho `0`. */
export interface ThapPhan {
  readonly m: bigint;
  readonly s: number;
}

const DANG = /^(-?)([0-9]+)(?:\.([0-9]+))?$/u;

/** Đọc một chuỗi thập phân (dạng `numeric::text` của Postgres). Ném khi không phải dạng ấy — số mũ, `NaN`, khoảng trắng. */
export function docThapPhan(chuoi: string): ThapPhan {
  const k = DANG.exec(chuoi);
  if (k === null) throw new RangeError(`không phải số thập phân: ${JSON.stringify(chuoi)}`);
  const le = k[3] ?? "";
  const m = BigInt(`${k[2]!}${le}`);
  return { m: k[1] === "-" ? -m : m, s: le.length };
}

const MUOI = 10n;

function nangThang(x: ThapPhan, s: number): bigint {
  return x.m * MUOI ** BigInt(s - x.s);
}

/** Hai số về cùng số chữ số lẻ. */
function canBang(a: ThapPhan, b: ThapPhan): readonly [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [nangThang(a, s), nangThang(b, s), s];
}

export function cong(a: ThapPhan, b: ThapPhan): ThapPhan {
  const [x, y, s] = canBang(a, b);
  return { m: x + y, s };
}

export function tru(a: ThapPhan, b: ThapPhan): ThapPhan {
  const [x, y, s] = canBang(a, b);
  return { m: x - y, s };
}

export function nhan(a: ThapPhan, b: ThapPhan): ThapPhan {
  return { m: a.m * b.m, s: a.s + b.s };
}

export function triTuyetDoi(a: ThapPhan): ThapPhan {
  return a.m < 0n ? { m: -a.m, s: a.s } : a;
}

export function soSanh(a: ThapPhan, b: ThapPhan): -1 | 0 | 1 {
  const [x, y] = canBang(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** `a / 2^k`, chính xác: `a · 5^k / 10^k`. */
export function chiaLuyThua2(a: ThapPhan, k: number): ThapPhan {
  if (!Number.isInteger(k) || k < 0) throw new RangeError("số mũ của 2 phải là số nguyên không âm");
  return { m: a.m * 5n ** BigInt(k), s: a.s + k };
}

/** `a · n` với `n` nguyên. */
export function nhanNguyen(a: ThapPhan, n: number): ThapPhan {
  if (!Number.isSafeInteger(n)) throw new RangeError("hệ số phải là số nguyên an toàn");
  return { m: a.m * BigInt(n), s: a.s };
}

/** Chuỗi chuẩn: bỏ số 0 thừa ở phần lẻ, bỏ dấu chấm khi phần lẻ rỗng, không `-0`. */
export function chuoiThapPhan(a: ThapPhan): string {
  let m = a.m;
  let s = a.s;
  while (s > 0 && m % MUOI === 0n) {
    m /= MUOI;
    s -= 1;
  }
  const am = m < 0n;
  const tuyet = (am ? -m : m).toString().padStart(s + 1, "0");
  const nguyen = tuyet.slice(0, tuyet.length - s);
  const le = tuyet.slice(tuyet.length - s);
  return `${am ? "-" : ""}${nguyen}${le === "" ? "" : `.${le}`}`;
}

/**
 * Phân vị `tu/4` (`tu` ∈ {1, 2, 3}) của một dãy ĐÃ SẮP tăng dần, nội suy tuyến tính — cùng nghĩa `percentile_cont` (vị trí
 * `p · (n − 1)` tính từ 0). `tu = 2` là trung vị: tập lẻ ra phần tử giữa, tập chẵn ra trung bình hai phần tử giữa. Ném trên dãy
 * rỗng — người gọi xử lý tập rỗng trước.
 */
export function phanViTu(daySapXep: readonly ThapPhan[], tu: 1 | 2 | 3): ThapPhan {
  const n = daySapXep.length;
  if (n === 0) throw new RangeError("phân vị của dãy rỗng");
  const viTri = tu * (n - 1);
  const duoi = Math.floor(viTri / 4);
  const du = viTri % 4;
  const a = daySapXep[duoi]!;
  if (du === 0) return a;
  const b = daySapXep[duoi + 1]!;
  return cong(a, chiaLuyThua2(nhanNguyen(tru(b, a), du), 2));
}

/** Sắp tăng dần, không đổi mảng vào. */
export function sapTang(day: readonly ThapPhan[]): ThapPhan[] {
  return [...day].sort((x, y) => soSanh(x, y));
}
