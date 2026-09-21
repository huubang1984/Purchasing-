// ==============================================================================================
// [S1.104 / S2.2 / ADR-050 ⑴] CHI PHÍ HIỆU DỤNG — HÀM THUẦN, VÀ LUẬT LÀM TRÒN LÀ MỘT HẰNG SỐ
// CHỨ KHÔNG PHẢI MỘT THÓI QUEN
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO GÓI NÀY KHÔNG DÙNG `number`
// ----------------------------------------------------------------------------------------------
// `effective_cost` là con số quyết định THỨ HẠNG, và thứ hạng quyết định ai được trao thầu. Mọi
// phép tính ở đây chạy trên `bigint` ở một tỉ lệ cố định; không một `number` nào chạm vào tiền.
// Đó không phải sự cẩn thận thừa: `0.1 + 0.2 !== 0.3` là đủ để đảo hai báo giá cách nhau một xu.
//
// ----------------------------------------------------------------------------------------------
// LUẬT LÀM TRÒN: NỬA-RA-XA-0, VÀ NÓ PHẢI GIỐNG POSTGRES TỪNG CA
// ----------------------------------------------------------------------------------------------
// ADR-050 ⑴ chọn luật theo tiền lệ ĐANG CHẠY: `pg_catalog.round(x, 2)` ở `comparison.ts` là số
// tiền phái sinh duy nhất kho có trước S2. Hàm thuần phải làm tròn GIỐNG nó, không được cắt cụt.
//
// **"Nửa-lên" và "nửa-ra-xa-0" chỉ khác nhau ở SỐ ÂM**, và đó là lý do `nuaXuCases` mang ca âm:
// một bảng ca toàn số không âm KHÔNG phân biệt được hai luật, nên nó không ghim được thứ nó sinh
// ra để ghim. (Cùng hình dạng với mũi đột biến ⑶ của khoản 208 ở S1.103: một fixture không phân
// biệt được thì nửa được đo không phải nửa ta tưởng.)
//
// `round(-0.005, 2)` của Postgres là `-0.01`, không phải `0.00` — đo thật, không đọc tài liệu.
//
// ----------------------------------------------------------------------------------------------
// LÀM TRÒN Ở ĐÂU: TỪNG THÀNH PHẦN RỒI CỘNG — chủ dự án chốt 2026-09-21
// ----------------------------------------------------------------------------------------------
// Hai phương án được ĐO trước khi hỏi: trên 200 000 bộ 2–6 thành phần, hai cách cho kết quả khác
// nhau ở **38,5 %** số bộ, lệch lớn nhất gặp được **0,03** (trần lý thuyết `n/2` xu).
//
// Chọn *từng thành phần rồi cộng*, và lý do là J2 chứ không phải số học:
//
//   ⑴ J2 nói kiểm toán viên cầm dữ liệu, chạy hàm, ra đúng con số. Với cách này phép kiểm là một
//     phép CỘNG — công cụ yếu nhất có thể. Với cách kia họ còn phải tái lập ĐÚNG luật làm tròn,
//     mà luật ấy chính là thứ hai tầng của sản phẩm đang bất đồng (khoản 218).
//   ⑵ S2.4 hiện bảng thành phần lên màn. Nếu các thành phần hiển thị không cộng ra con số cuối
//     thì người mua đọc một bảng tự cãi mình — đúng lớp lỗi của khoản 206.
//
// **Cái giá, nói thẳng:** sai số tích luỹ tối đa `n/2` xu so với phép tính một lần. Trên một BẢNG
// XẾP HẠNG, thứ có nghĩa là THỨ TỰ chứ không phải xu tuyệt đối — nhưng hai báo giá cách nhau dưới
// ba xu thì thứ tự giữa chúng do luật làm tròn quyết, và điều đó phải được nói ra chứ không giấu.
// ==============================================================================================

/** Số chữ số thập phân của mọi cột tiền: `numeric(18, 2)` (`022`). */
export const SO_LE_TIEN = 2;

/** Số chữ số thập phân của `quantity` (`009:96`) và của hệ số chính sách. */
export const SO_LE_HE_SO = 4;

/** Đơn vị của một thành phần chính sách. **J1**: chỉ `TIEN` đi vào `effective_cost`. */
export type DonVi = "TIEN" | "DIEM";

/** Một thành phần do phiên bản chính sách khai. */
export interface ThanhPhanChinhSach {
  readonly ma: string;
  readonly donVi: DonVi;
  /** Hệ số quy đổi, chuỗi `numeric` tối đa `SO_LE_HE_SO` chữ số thập phân. */
  readonly heSo: string;
}

/** Giá trị một báo giá khai cho một mã thành phần. */
export interface DauVao {
  readonly ma: string;
  /** Chuỗi `numeric` tối đa `SO_LE_TIEN` chữ số thập phân. */
  readonly giaTri: string;
}

/** Một thành phần đã quy đổi — đây là thứ đi vào cột `components` của `rfq_evaluation_lines`. */
export interface ThanhPhanDaQuyDoi {
  readonly ma: string;
  readonly donVi: DonVi;
  readonly heSo: string;
  readonly giaTri: string;
  /** `giaTri × heSo`, đã làm tròn nửa-ra-xa-0 về `SO_LE_TIEN`. `null` cho thành phần `DIEM`. */
  readonly tien: string | null;
}

export interface KetQuaChiPhi {
  /** Tổng ĐÚNG của các `tien` — một phép cộng, không làm tròn lần nữa. */
  readonly effectiveCost: string;
  readonly components: readonly ThanhPhanDaQuyDoi[];
}

/** Lý do một lượt tính KHÔNG ra số. Mỗi mã là một câu nói được cho người dùng. */
export type LyDoTuChoi =
  | "HE_SO_KHONG_DOC_DUOC"
  | "GIA_TRI_KHONG_DOC_DUOC"
  | "THIEU_DAU_VAO"
  | "DAU_VAO_THUA"
  | "DAU_VAO_TRUNG_MA"
  | "KHONG_CO_THANH_PHAN_TIEN";

export interface TuChoi {
  readonly lyDo: LyDoTuChoi;
  /** Mã thành phần gây ra, khi lý do gắn với một thành phần cụ thể. */
  readonly ma?: string;
}

/**
 * Chuỗi `numeric` → `bigint` ở tỉ lệ `10^soLe`.
 *
 * Trả `null` khi chuỗi không phải một số thập phân, HOẶC khi phần lẻ dài hơn `soLe`. Vế thứ hai
 * là cố ý: cắt cụt âm thầm ở đây là đúng khoản 218 ở một chỗ mới. Nhận dấu `-` — một thành phần
 * có thể là một khoản GIẢM TRỪ, và một luật làm tròn chỉ đúng cho số dương là một luật chưa đủ.
 */
export function docSo(chuoi: string, soLe: number): bigint | null {
  const s = chuoi.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const am = s.startsWith("-");
  const [nguyen = "", le = ""] = (am ? s.slice(1) : s).split(".");
  if (le.length > soLe) return null;
  const v = BigInt(nguyen + (le + "0".repeat(soLe)).slice(0, soLe));
  return am ? -v : v;
}

/** `bigint` ở tỉ lệ `10^soLe` → chuỗi `numeric` đúng `soLe` chữ số thập phân. */
export function vietSo(v: bigint, soLe: number): string {
  const chia = 10n ** BigInt(soLe);
  const am = v < 0n;
  const t = am ? -v : v;
  const le = String(t % chia).padStart(soLe, "0");
  return `${am ? "-" : ""}${t / chia}${soLe === 0 ? "" : `.${le}`}`;
}

/**
 * Thu `v` từ tỉ lệ `tuSoLe` về `veSoLe` theo luật **nửa-ra-xa-0** — luật của `round(x, n)` ở
 * Postgres.
 *
 * `(|v| + nửa) / chia` rồi trả dấu: phép chia `bigint` cắt về 0, nên cộng nửa TRƯỚC khi chia trên
 * TRỊ TUYỆT ĐỐI cho đúng nửa-ra-xa-0 ở cả hai phía. Làm trên `v` có dấu sẽ ra nửa-LÊN, và hai luật
 * ấy chỉ khác nhau ở số âm — đúng chỗ một bảng ca toàn số dương không nhìn thấy.
 */
export function lamTron(v: bigint, tuSoLe: number, veSoLe: number): bigint {
  if (veSoLe > tuSoLe) throw new RangeError("lamTron chỉ THU tỉ lệ, không nới");
  const chia = 10n ** BigInt(tuSoLe - veSoLe);
  if (chia === 1n) return v;
  const am = v < 0n;
  const t = am ? -v : v;
  const q = (t + chia / 2n) / chia;
  return am ? -q : q;
}

/**
 * Tính chi phí hiệu dụng của MỘT báo giá theo MỘT phiên bản chính sách.
 *
 * Hàm thuần: không đọc CSDL, không đọc đồng hồ, không ném. Mọi lối không ra số đều trả một
 * `TuChoi` mang mã — vì câu từ chối là thứ người mua đọc, và nó phải gọi tên được chỗ hỏng.
 *
 * **J1 ở đây là một phép LỌC, không phải một lời hứa:** thành phần `DIEM` được quy đổi ra `null`
 * và không bao giờ cộng vào tổng. Nó VẪN có mặt trong `components` — vứt nó đi thì bảng thành
 * phần của S2.4 nói dối về thứ chính sách đã khai.
 */
export function tinhChiPhiHieuDung(
  chinhSach: readonly ThanhPhanChinhSach[],
  dauVao: readonly DauVao[],
): KetQuaChiPhi | TuChoi {
  const theoMa = new Map<string, string>();
  for (const d of dauVao) {
    if (theoMa.has(d.ma)) return { lyDo: "DAU_VAO_TRUNG_MA", ma: d.ma };
    theoMa.set(d.ma, d.giaTri);
  }
  const maChinhSach = new Set(chinhSach.map((c) => c.ma));
  for (const d of dauVao) {
    if (!maChinhSach.has(d.ma)) return { lyDo: "DAU_VAO_THUA", ma: d.ma };
  }
  if (!chinhSach.some((c) => c.donVi === "TIEN")) return { lyDo: "KHONG_CO_THANH_PHAN_TIEN" };

  const components: ThanhPhanDaQuyDoi[] = [];
  let tong = 0n;
  for (const c of chinhSach) {
    const gia = theoMa.get(c.ma);
    if (gia === undefined) return { lyDo: "THIEU_DAU_VAO", ma: c.ma };
    const h = docSo(c.heSo, SO_LE_HE_SO);
    if (h === null) return { lyDo: "HE_SO_KHONG_DOC_DUOC", ma: c.ma };
    const g = docSo(gia, SO_LE_TIEN);
    if (g === null) return { lyDo: "GIA_TRI_KHONG_DOC_DUOC", ma: c.ma };

    if (c.donVi === "DIEM") {
      components.push({ ma: c.ma, donVi: c.donVi, heSo: c.heSo, giaTri: gia, tien: null });
      continue;
    }
    // `g` ở tỉ lệ 10^2, `h` ở tỉ lệ 10^4 ⇒ tích ở tỉ lệ 10^6. Thu về 10^2 bằng ĐÚNG một lần
    // làm tròn, rồi CỘNG — tổng không làm tròn lần nữa, đó là quyết định của chủ dự án.
    const tien = lamTron(g * h, SO_LE_TIEN + SO_LE_HE_SO, SO_LE_TIEN);
    tong += tien;
    components.push({
      ma: c.ma,
      donVi: c.donVi,
      heSo: c.heSo,
      giaTri: gia,
      tien: vietSo(tien, SO_LE_TIEN),
    });
  }
  return { effectiveCost: vietSo(tong, SO_LE_TIEN), components };
}

/** Phân biệt hai nhánh trả về của `tinhChiPhiHieuDung` mà không cần ép kiểu ở chỗ gọi. */
export function laTuChoi(kq: KetQuaChiPhi | TuChoi): kq is TuChoi {
  return "lyDo" in kq;
}
