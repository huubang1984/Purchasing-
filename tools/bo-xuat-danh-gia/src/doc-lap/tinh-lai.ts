// ==============================================================================================
// [S1.114 / S2.7 / ADR-059 ⒝] BỘ TÍNH LẠI ĐỘC LẬP — VIẾT TỪ ĐẶC TẢ, KHÔNG IMPORT MỘT SYMBOL NÀO
// CỦA `@trustprocure/danh-gia`
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO TỆP NÀY TỒN TẠI, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// Nếu bộ kiểm của bộ bằng chứng gọi chính `chiPhiHieuDung`, thì một lỗi trong hàm ấy **tự tái lập
// chính nó**: bundle khai ĐẠT trên một con số sai. Bộ kiểm khi ấy chứng *nhất quán*, không chứng
// *đúng*. ADR-059 gọi đó là vế chịu lực và cấm để bảo đảm của bundle phụ thuộc vào nó.
//
// Ranh giới ấy KHÔNG được giữ bằng câu chú thích này. Nó được giữ bằng quy tắc `depcruise`
// `g17-kiem-doc-lap-khong-cham-danh-gia` và một đối chứng dương ở `tests/architecture/boundaries.test.ts`,
// cùng khuôn `g11-ky-neo-chi-o-cong-cu-xuat-neo` đã giữ đường ký mốc neo.
//
// Quy tắc canh CẢ THƯ MỤC `doc-lap/`, không canh riêng tệp này, và hai lý do:
//   ⑴ mặc-định-ĐÓNG — một tệp thứ hai thêm vào lớp độc lập mai sau được canh mà không ai phải nhớ
//     thêm gì (đúng khuôn "fix round 4" đã đảo chiều cho `packages/crypto-keys/src/`);
//   ⑵ đối chứng dương viết được MỘT TỆP DÒ vào thư mục rồi xoá, thay vì phải sửa tệp thật này —
//     một phép đo chạm mã sản xuất là một phép đo có thể để lại mã sản xuất đã sửa.
//
// Và nó dùng `reachable: true` chứ không canh cạnh TRỰC TIẾP: đo ngày 2026-09-23, một dòng
// `import … from "@trustprocure/danh-gia"` làm quy tắc bắt SÁU module, trong đó năm module chỉ
// với tới được qua `index.ts`. Một quy tắc cạnh trực tiếp sẽ chỉ thấy một.
//
// ----------------------------------------------------------------------------------------------
// VÀ NÓ DÙNG MỘT PHƯƠNG PHÁP KHÁC, KHÔNG CHỈ MỘT BẢN SAO KHÁC
// ----------------------------------------------------------------------------------------------
// `packages/danh-gia` quy mọi số về `bigint` ở một tỉ lệ cố định rồi nhân. Tệp này KHÔNG dùng
// `bigint`: nó nhân tay trên MẢNG CHỮ SỐ, đúng phép nhân dài người ta làm trên giấy, rồi làm tròn
// bằng cách đọc phần đuôi bị cắt.
//
// Lý do là một phép đo chứ không một sở thích: một bản sao CÙNG phương pháp chỉ bắt được lỗi gõ
// nhầm. Hai phương pháp khác nhau còn bắt được lỗi của chính phương pháp — tràn tỉ lệ, cắt cụt
// sớm, đặt sai chỗ lần làm tròn. Mũi đột biến ⒞ của ADR-059 (một lỗi làm tròn NẰM TRONG
// `chiPhiHieuDung`) chỉ có nghĩa khi lớp này không đi cùng đường với nó.
//
// **Giới hạn, nói ra thay vì giấu:** lớp này bắt được chỗ MÃ lệch khỏi ĐẶC TẢ. Nó KHÔNG bắt được
// một đặc tả sai — hai bản cài từ cùng một đặc tả sai sẽ cùng sai. Thứ đóng được lỗ ấy là một
// người ĐỌC, và đó chính là lý do `DAC-TA.md` đi kèm bundle thay vì ở lại trong kho.
// ==============================================================================================

/** Một số thập phân đã phân tích: dấu, chữ số (lớn → bé), và số chữ số thập phân. */
export interface SoThapPhan {
  readonly am: boolean;
  /** Mọi chữ số, KỂ CẢ phần lẻ, từ hàng lớn nhất. `[1,2,3]` với `soLe=2` là `1.23`. */
  readonly chuSo: readonly number[];
  readonly soLe: number;
}

const KHUON_SO = /^-?\d+(?:\.\d+)?$/u;

/** Bỏ các số 0 dẫn đầu, và ép `-0` về `0`: bảng xếp hạng không có hai số không. */
function chuanHoa(am: boolean, chuSo: readonly number[], soLe: number): SoThapPhan {
  let dau = 0;
  while (dau < chuSo.length - soLe - 1 && chuSo[dau] === 0) dau += 1;
  const cat = chuSo.slice(dau);
  const laKhong = cat.every((c) => c === 0);
  return { am: laKhong ? false : am, chuSo: cat, soLe };
}

/**
 * Chuỗi `numeric` → `SoThapPhan`. Trả `null` khi chuỗi không phải một số thập phân.
 *
 * KHÔNG cắt cụt phần lẻ dài: bản gốc từ chối một `he_so` dài hơn bốn chữ số lẻ, còn ở đây phần lẻ
 * đi vào `soLe` nguyên vẹn. Hai lớp vì thế bất đồng ở đúng một ca — và bất đồng ấy là thứ bộ kiểm
 * PHẢI báo, chứ không phải thứ nó phải che bằng cách bắt chước.
 */
export function docThapPhan(chuoi: string): SoThapPhan | null {
  const s = chuoi.trim();
  if (!KHUON_SO.test(s)) return null;
  const am = s.startsWith("-");
  const than = am ? s.slice(1) : s;
  const [nguyen = "", le = ""] = than.split(".");
  const chuSo = [...nguyen, ...le].map((c) => c.charCodeAt(0) - 48);
  return chuanHoa(am, chuSo, le.length);
}

/** `SoThapPhan` → chuỗi `numeric` với ĐÚNG `soLe` chữ số thập phân. */
export function vietThapPhan(x: SoThapPhan): string {
  const can = x.soLe + 1;
  const d = x.chuSo.length >= can ? [...x.chuSo] : [...new Array<number>(can - x.chuSo.length).fill(0), ...x.chuSo];
  const cat = d.length - x.soLe;
  const nguyen = d.slice(0, cat).join("");
  const le = d.slice(cat).join("");
  return `${x.am ? "-" : ""}${nguyen}${x.soLe === 0 ? "" : `.${le}`}`;
}

/** So hai dãy chữ số CÙNG độ dài. `-1 | 0 | 1`. */
function soSanhDay(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Căn hai dãy về cùng độ dài bằng cách chèn 0 ở ĐẦU. */
function canTrai(a: readonly number[], b: readonly number[]): readonly [number[], number[]] {
  const n = Math.max(a.length, b.length);
  const dem = (d: readonly number[]): number[] => [...new Array<number>(n - d.length).fill(0), ...d];
  return [dem(a), dem(b)];
}

/** Cộng hai dãy chữ số không dấu. */
function congDay(a: readonly number[], b: readonly number[]): number[] {
  const [x, y] = canTrai(a, b);
  const ra: number[] = [];
  let nho = 0;
  for (let i = x.length - 1; i >= 0; i -= 1) {
    const t = (x[i] ?? 0) + (y[i] ?? 0) + nho;
    ra.unshift(t % 10);
    nho = t >= 10 ? 1 : 0;
  }
  if (nho > 0) ra.unshift(nho);
  return ra;
}

/** Trừ hai dãy chữ số không dấu, `a >= b`. */
function truDay(a: readonly number[], b: readonly number[]): number[] {
  const [x, y] = canTrai(a, b);
  const ra: number[] = [];
  let muon = 0;
  for (let i = x.length - 1; i >= 0; i -= 1) {
    let t = (x[i] ?? 0) - (y[i] ?? 0) - muon;
    if (t < 0) {
      t += 10;
      muon = 1;
    } else {
      muon = 0;
    }
    ra.unshift(t);
  }
  return ra;
}

/**
 * NHÂN DÀI trên mảng chữ số — phép nhân người ta làm trên giấy.
 *
 * Đây là chỗ tệp này cố ý đi khác `packages/danh-gia`: không `bigint`, không tỉ lệ, không một phép
 * nhân máy nào trên giá trị đầy đủ. Số chữ số thập phân của tích là TỔNG hai số chữ số thập phân —
 * đó là một sự thật của phép nhân, không phải một quy ước của dự án.
 */
export function nhan(a: SoThapPhan, b: SoThapPhan): SoThapPhan {
  const n = a.chuSo.length;
  const m = b.chuSo.length;
  const tich = new Array<number>(n + m).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const t = (a.chuSo[i] ?? 0) * (b.chuSo[j] ?? 0) + (tich[i + j + 1] ?? 0);
      tich[i + j + 1] = t % 10;
      tich[i + j] = (tich[i + j] ?? 0) + Math.floor(t / 10);
    }
  }
  return chuanHoa(a.am !== b.am, tich, a.soLe + b.soLe);
}

/** Cộng hai số có dấu. Hai số phải CÙNG `soLe` — chỗ gọi của tệp này luôn thế. */
export function cong(a: SoThapPhan, b: SoThapPhan): SoThapPhan {
  if (a.soLe !== b.soLe) throw new RangeError("cong đòi hai số cùng số chữ số thập phân");
  if (a.am === b.am) return chuanHoa(a.am, congDay(a.chuSo, b.chuSo), a.soLe);
  const [x, y] = canTrai(a.chuSo, b.chuSo);
  const cmp = soSanhDay(x, y);
  if (cmp === 0) return chuanHoa(false, [0], a.soLe);
  return cmp > 0
    ? chuanHoa(a.am, truDay(x, y), a.soLe)
    : chuanHoa(b.am, truDay(y, x), a.soLe);
}

/**
 * Thu về `veSoLe` chữ số thập phân theo luật **nửa-ra-xa-0** — luật của `round(x, n)` ở Postgres.
 *
 * Đọc ĐUÔI bị cắt rồi so với "một nửa" viết dưới dạng `5` cộng các số 0: so trên CHỮ SỐ, không quy
 * về một con số máy. Nửa-ra-xa-0 khác nửa-lên đúng ở số âm, nên dấu KHÔNG tham gia phép so — nó
 * chỉ được gắn lại sau cùng.
 */
export function thuVe(x: SoThapPhan, veSoLe: number): SoThapPhan {
  if (veSoLe > x.soLe) throw new RangeError("thuVe chỉ THU số chữ số thập phân, không nới");
  const bo = x.soLe - veSoLe;
  if (bo === 0) return x;
  const giu = x.chuSo.slice(0, Math.max(0, x.chuSo.length - bo));
  const duoi = x.chuSo.slice(Math.max(0, x.chuSo.length - bo));
  const nua = [5, ...new Array<number>(bo - 1).fill(0)];
  const [a, b] = canTrai(duoi, nua);
  const len = soSanhDay(a, b) >= 0 ? congDay(giu.length === 0 ? [0] : giu, [1]) : giu;
  return chuanHoa(x.am, len.length === 0 ? [0] : len, veSoLe);
}

/** So hai số có dấu. `-1 | 0 | 1`. Dùng cho xếp hạng. */
export function soSanh(a: SoThapPhan, b: SoThapPhan): number {
  if (a.soLe !== b.soLe) throw new RangeError("soSanh đòi hai số cùng số chữ số thập phân");
  if (a.am !== b.am) return a.am ? -1 : 1;
  const [x, y] = canTrai(a.chuSo, b.chuSo);
  const cmp = soSanhDay(x, y);
  return a.am ? -cmp : cmp;
}

// ----------------------------------------------------------------------------------------------
// PHÉP TÍNH CỦA ĐẶC TẢ
// ----------------------------------------------------------------------------------------------

/** Số chữ số thập phân của mọi cột tiền — `DAC-TA.md` §2. */
export const SO_LE_TIEN = 2;

/** Một thành phần do phiên bản chính sách khai, đúng ba khoá của `eval_components`. */
export interface ThanhPhanChinhSachDoc {
  readonly ma: string;
  readonly don_vi: string;
  readonly he_so: string;
}

/** Đầu vào của một hàng: mã thành phần và giá trị báo giá khai cho mã ấy. */
export interface DauVaoDoc {
  readonly ma: string;
  readonly giaTri: string | null;
}

export type LyDoKhongTinhDuoc =
  | "HE_SO_KHONG_DOC_DUOC"
  | "GIA_TRI_KHONG_DOC_DUOC"
  | "GIA_TRI_VANG"
  | "DON_VI_LA"
  | "THIEU_DAU_VAO"
  | "DAU_VAO_THUA"
  | "DAU_VAO_TRUNG_MA"
  | "KHONG_CO_THANH_PHAN_TIEN";

export interface ThanhPhanTinhLai {
  readonly ma: string;
  readonly donVi: string;
  /** `null` cho thành phần `DIEM` — nó không bao giờ cộng vào tổng. */
  readonly tien: string | null;
}

export interface KetQuaTinhLai {
  readonly effectiveCost: string;
  readonly components: readonly ThanhPhanTinhLai[];
}

export interface KhongTinhDuoc {
  readonly lyDo: LyDoKhongTinhDuoc;
  readonly ma?: string;
}

export function khongTinhDuoc(kq: KetQuaTinhLai | KhongTinhDuoc): kq is KhongTinhDuoc {
  return "lyDo" in kq;
}

/**
 * Tính lại chi phí hiệu dụng của MỘT hàng, từ `eval_components` của chính sách và giá trị báo giá.
 *
 * Hàm thuần: không đọc CSDL, không đọc đồng hồ, không ném (trừ lỗi lập trình ở các phép số học).
 * **Không đọc một trường `tien` hay `he_so` nào của `components` đã lưu** — nếu nó đọc, nó chỉ
 * chép lại kết luận nó đang phải kiểm.
 */
export function tinhLai(
  chinhSach: readonly ThanhPhanChinhSachDoc[],
  dauVao: readonly DauVaoDoc[],
): KetQuaTinhLai | KhongTinhDuoc {
  const theoMa = new Map<string, string | null>();
  for (const d of dauVao) {
    if (theoMa.has(d.ma)) return { lyDo: "DAU_VAO_TRUNG_MA", ma: d.ma };
    theoMa.set(d.ma, d.giaTri);
  }
  const maChinhSach = new Set(chinhSach.map((c) => c.ma));
  for (const d of dauVao) {
    if (!maChinhSach.has(d.ma)) return { lyDo: "DAU_VAO_THUA", ma: d.ma };
  }
  if (!chinhSach.some((c) => c.don_vi === "TIEN")) return { lyDo: "KHONG_CO_THANH_PHAN_TIEN" };

  const components: ThanhPhanTinhLai[] = [];
  let tong = chuanHoa(false, [0], SO_LE_TIEN);
  for (const c of chinhSach) {
    if (!theoMa.has(c.ma)) return { lyDo: "THIEU_DAU_VAO", ma: c.ma };
    if (c.don_vi !== "TIEN" && c.don_vi !== "DIEM") return { lyDo: "DON_VI_LA", ma: c.ma };
    if (c.don_vi === "DIEM") {
      components.push({ ma: c.ma, donVi: c.don_vi, tien: null });
      continue;
    }
    const gia = theoMa.get(c.ma) ?? null;
    if (gia === null) return { lyDo: "GIA_TRI_VANG", ma: c.ma };
    const h = docThapPhan(c.he_so);
    if (h === null) return { lyDo: "HE_SO_KHONG_DOC_DUOC", ma: c.ma };
    const g = docThapPhan(gia);
    if (g === null) return { lyDo: "GIA_TRI_KHONG_DOC_DUOC", ma: c.ma };

    // ĐÚNG MỘT lần làm tròn cho mỗi thành phần, rồi CỘNG — tổng không làm tròn lần nữa.
    const tien = thuVe(nhan(g, h), SO_LE_TIEN);
    tong = cong(tong, tien);
    components.push({ ma: c.ma, donVi: c.don_vi, tien: vietThapPhan(tien) });
  }
  return { effectiveCost: vietThapPhan(tong), components };
}

/**
 * Xếp hạng theo `effective_cost` tăng dần, hạng bằng nhau cho giá trị bằng nhau.
 *
 * Hàng không có số nhận `null` — nó KHÔNG lên đầu bảng, và nó cũng không chiếm một hạng. Xem
 * `DAC-TA.md` §4.
 */
export function xepHangLai(gia: readonly (string | null)[]): readonly (number | null)[] {
  const doc = gia
    .map((g, i) => ({ i, v: g === null ? null : docThapPhan(g) }))
    .filter((x): x is { i: number; v: SoThapPhan } => x.v !== null)
    .sort((a, b) => soSanh(a.v, b.v));
  const hang = new Array<number | null>(gia.length).fill(null);
  let truoc: SoThapPhan | null = null;
  let hangTruoc = 0;
  doc.forEach((x, viTri) => {
    const h = truoc !== null && soSanh(x.v, truoc) === 0 ? hangTruoc : viTri + 1;
    hang[x.i] = h;
    truoc = x.v;
    hangTruoc = h;
  });
  return hang;
}
