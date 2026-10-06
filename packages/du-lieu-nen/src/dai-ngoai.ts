// [S1.9101 / S4.6b] LÕI THUẦN CỦA DẢI LỊCH SỬ NGOÀI VÀ MỐC NGOÀI (spec S4 §4.6, §4.7, §2.4 ⑽; ADR-096 ⑷; ADR-149 ⑵ ⑶; ADR-9201).
//
// Tất định: không I/O, không đồng hồ, không `double` trên giá. Đầu vào là các hàng của `gia-ngoai.ts` — MỌI hàng dữ liệu của hàng chuẩn,
// kể cả hàng ghi sau mốc và hàng đã rút, mỗi hàng mang ba cờ thời điểm — và mọi phép lọc nằm ở đây, cùng tư thế `benchmark.ts`.
//
// DẢI LỊCH SỬ NGOÀI — cùng phương pháp `TRUNG_VI_THEO_GOI_V1` của dải nội bộ (ADR-096 ⑷), "gói" là (ngày mua, nhà cung cấp đã làm
// sạch) (chủ dự án chốt 2026-10-06, ADR-149 ⑵):
//   ⑴ L1: chỉ hàng ghi TRƯỚC mốc mở giá của X và chưa bị rút TRƯỚC mốc ấy — lần rút sau mốc không gỡ hàng khỏi dải của gói đã mở, chỉ
//      được ĐẾM (`sauMoc.RUT`), cùng hàng ghi sau mốc (`sauMoc.GHI`);
//   ⑵ ngày mua trong [ngày(mốc) − `cua_so_thang` tháng, ngày(mốc)], ngày theo giờ Việt Nam (UTC+7) — cùng lịch với luật *"ngày mua không
//      sau hôm nay"* của `109`;
//   ⑶ khác tiền tệ với báo giá đang xét ⇒ loại, ĐẾM; đơn vị không quy đổi được sang đơn vị gốc TẠI MỐC ⇒ loại, ĐẾM;
//   ⑷ mỗi gói một trung vị, mốc so là trung vị các trung vị, dải [Q1, Q3] (`mocSoTheoGoi`); sàn ≥ `san_goi` gói VÀ ≥ `san_ncc` nhà cung
//      cấp khác nhau của phiên bản ghim, không thì `CHUA_DU_LICH_SU` và không con số nào;
//   ⑸ nhãn bằng CHÍNH `ganNhan` của dải nội bộ (`benchmark.ts`) — cùng ngưỡng. Nhãn ngoài KHÔNG vào lượt chấm, bộ bằng chứng, Risk Score hay cổng (e) (L15).
// MỐC NGOÀI — chỉ độ lệch, KHÔNG nhãn (ADR-096 ⑷). Mốc của (hàng chuẩn, tiền tệ) là hàng có `ngay_hieu_luc` MỚI NHẤT trong cùng cửa sổ
// ngày, cùng tiền tệ, quy đổi được tại mốc, cùng luật L1 ⑴; trùng ngày thì hàng nhập sau (`seq` lớn hơn) (ADR-149 ⑶).
import { mocSoTheoGoi, type NhomBenchmark } from "./benchmark.js";
import { docThapPhan, soSanh, tru, triTuyetDoi, type ThapPhan } from "./so-thap-phan.js";

const MICRO_MOI_NGAY = 86_400_000_000n;
/** UTC+7, không giờ mùa hè. */
const LECH_VN_MICRO = 7n * 3_600_000_000n;
const NGAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Ngày lịch Việt Nam (`YYYY-MM-DD`) của một thời điểm micro giây kể từ epoch. */
export function ngayVnTuMicro(micro: bigint): string {
  const v = micro + LECH_VN_MICRO;
  const ngay = v >= 0n ? v / MICRO_MOI_NGAY : -((-v + MICRO_MOI_NGAY - 1n) / MICRO_MOI_NGAY);
  return new Date(Number(ngay) * 86_400_000).toISOString().slice(0, 10);
}

/** Lùi `thang` tháng lịch trên một ngày `YYYY-MM-DD`, kẹp ngày cuối tháng (31/3 − 1 tháng = 28/2 hay 29/2) — luật `truThang`. */
export function truThangNgay(ngay: string, thang: number): string {
  if (!Number.isInteger(thang) || thang < 0) throw new RangeError("số tháng phải là số nguyên không âm");
  const k = NGAY.exec(ngay);
  if (k === null) throw new RangeError(`không phải ngày YYYY-MM-DD: ${JSON.stringify(ngay)}`);
  const tong = Number(k[1]) * 12 + Number(k[2]) - 1 - thang;
  const nam = Math.floor(tong / 12);
  const thangDich = tong - nam * 12;
  const ngayCuoi = new Date(Date.UTC(nam, thangDich + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nam, thangDich, Math.min(Number(k[3]), ngayCuoi))).toISOString().slice(0, 10);
}

/** Cửa sổ ngày của gói X: [ngày(mốc) − `cuaSoThang` tháng, ngày(mốc)], cả hai đầu tính vào. */
export function cuaSoNgayNgoai(mocMoGia: bigint, cuaSoThang: number): { readonly tu: string; readonly den: string } {
  const den = ngayVnTuMicro(mocMoGia);
  return { tu: truThangNgay(den, cuaSoThang), den };
}

/** Ba cờ L1 của một hàng dữ liệu ngoài so với mốc mở giá của X. */
export interface CoThoiDiem {
  readonly ghiTruocMoc: boolean;
  /** Một hàng rút trỏ về hàng này, ghi TRƯỚC mốc. */
  readonly rutTruocMoc: boolean;
  /** Một hàng rút trỏ về hàng này, ghi TỪ mốc trở đi. */
  readonly rutSauMoc: boolean;
}

/** Một hàng dữ liệu của `external_purchase_history` cho một hàng chuẩn, đã quy đổi tại mốc. */
export interface HangLichSuNgoai extends CoThoiDiem {
  readonly id: string;
  /** Chuỗi `numeric` theo đơn vị gốc của hàng chuẩn TẠI MỐC; `null` khi đơn vị không quy đổi được tại mốc. */
  readonly donGiaQuyDoi: string | null;
  readonly tienTe: string;
  readonly ngayMua: string;
  /** `chuoi_sach(nha_cung_cap_text)` — khoá của "gói" và của phép đếm nhà cung cấp. */
  readonly nhaCungCap: string;
  readonly nguon: string;
}

/** Hàng ghi hay rút SAU mốc mở giá mà dải (hay mốc) này không dùng hay vẫn dùng — đếm tới lúc đọc. */
export interface SauMocNgoai {
  /** Hàng dữ liệu ghi từ mốc trở đi mà, nếu ghi trước, đã vào dải (cùng tiền tệ, trong cửa sổ). */
  readonly GHI: number;
  /** Hàng ĐÃ VÀO dải mà bị rút từ mốc trở đi — dải vẫn dùng chúng (L1). */
  readonly RUT: number;
}

export interface DaiNgoai {
  readonly tienTe: string;
  readonly cuaSoTu: string;
  readonly denNgay: string;
  readonly soDong: number;
  readonly soGoi: number;
  readonly soNcc: number;
  readonly soLoaiTienTe: number;
  readonly soLoaiKhongQuyDoi: number;
  readonly duSan: boolean;
  readonly mocSo: { readonly q1: string; readonly trungVi: string; readonly q3: string } | null;
  /** Các `nguon` khác nhau của hàng đã vào dải, sắp tăng — lời khai của người nhập. */
  readonly nguon: readonly string[];
  readonly sauMoc: SauMocNgoai;
}

export interface DaiNgoaiInput {
  readonly tienTe: string;
  /** Mốc mở giá của X, micro giây. */
  readonly mocMoGia: bigint;
  readonly nhom: NhomBenchmark;
}

const trongCuaSo = (ngay: string, cs: { readonly tu: string; readonly den: string }): boolean => ngay >= cs.tu && ngay <= cs.den;
const conTaiMoc = (h: CoThoiDiem): boolean => h.ghiTruocMoc && !h.rutTruocMoc;

/** Dải lịch sử ngoài của một (hàng chuẩn, tiền tệ) tại mốc của X. `hang` là mọi hàng dữ liệu của MỘT hàng chuẩn. */
export function tinhDaiNgoai(hang: readonly HangLichSuNgoai[], vao: DaiNgoaiInput): DaiNgoai {
  const cs = cuaSoNgayNgoai(vao.mocMoGia, vao.nhom.cuaSoThang);
  const theoGoi = new Map<string, ThapPhan[]>();
  const ncc = new Set<string>();
  const nguon = new Set<string>();
  let soDong = 0;
  let soLoaiTienTe = 0;
  let soLoaiKhongQuyDoi = 0;
  let ghiSau = 0;
  let rutSau = 0;
  for (const h of hang) {
    if (!trongCuaSo(h.ngayMua, cs)) continue;
    if (!h.ghiTruocMoc) {
      if (h.tienTe === vao.tienTe) ghiSau += 1;
      continue;
    }
    if (h.rutTruocMoc) continue;
    if (h.tienTe !== vao.tienTe) {
      soLoaiTienTe += 1;
      continue;
    }
    if (h.donGiaQuyDoi === null) {
      soLoaiKhongQuyDoi += 1;
      continue;
    }
    const p = docThapPhan(h.donGiaQuyDoi);
    // `109` buộc đơn giá dương hữu hạn và hệ số quy đổi dương: một giá quy đổi không dương là dữ liệu đã hỏng — NÉM, không đoán.
    if (p.m <= 0n) throw new Error("đơn giá quy đổi của lịch sử ngoài không dương");
    const khoa = `${h.ngayMua}\u0000${h.nhaCungCap}`;
    const ds = theoGoi.get(khoa) ?? [];
    ds.push(p);
    theoGoi.set(khoa, ds);
    ncc.add(h.nhaCungCap);
    nguon.add(h.nguon);
    soDong += 1;
    if (h.rutSauMoc) rutSau += 1;
  }
  const duSan = theoGoi.size >= vao.nhom.sanGoi && ncc.size >= vao.nhom.sanNcc;
  return {
    tienTe: vao.tienTe,
    cuaSoTu: cs.tu,
    denNgay: cs.den,
    soDong,
    soGoi: theoGoi.size,
    soNcc: ncc.size,
    soLoaiTienTe,
    soLoaiKhongQuyDoi,
    duSan,
    mocSo: duSan ? mocSoTheoGoi([...theoGoi.values()]) : null,
    nguon: [...nguon].sort(),
    sauMoc: { GHI: ghiSau, RUT: rutSau },
  };
}

/** Một hàng dữ liệu của `external_price_references` cho một hàng chuẩn — có hay không có con số (bộ đọc cờ không đọc giá). */
export interface HangMocNgoai extends CoThoiDiem {
  readonly id: string;
  readonly tienTe: string;
  readonly ngayHieuLuc: string;
  readonly nguon: string;
  /** `seq` của hàng (chuỗi số nguyên) — phân xử hai mốc cùng ngày hiệu lực. */
  readonly seq: string;
  /** Đơn vị quy đổi được sang đơn vị gốc tại mốc. */
  readonly quyDoiDuoc: boolean;
}

export interface MocNgoaiChon<T extends HangMocNgoai> {
  /** Mốc của (hàng chuẩn, tiền tệ) tại mốc của X; `null` khi không có. */
  readonly moc: T | null;
  /** Hàng mốc ghi từ mốc trở đi mà, nếu ghi trước, đã là ứng viên — mốc này không dùng chúng. */
  readonly ghiSauMoc: number;
  /** Mốc được chọn đã bị rút từ mốc trở đi — vẫn là mốc của X (L1). */
  readonly rutSauMoc: boolean;
}

/** Chọn mốc ngoài của một (hàng chuẩn, tiền tệ) tại mốc của X. `hang` là mọi hàng dữ liệu của MỘT hàng chuẩn. */
export function chonMocNgoai<T extends HangMocNgoai>(
  hang: readonly T[],
  vao: { readonly tienTe: string; readonly mocMoGia: bigint; readonly cuaSoThang: number },
): MocNgoaiChon<T> {
  const cs = cuaSoNgayNgoai(vao.mocMoGia, vao.cuaSoThang);
  let moc: T | null = null;
  let ghiSauMoc = 0;
  for (const h of hang) {
    if (h.tienTe !== vao.tienTe || !trongCuaSo(h.ngayHieuLuc, cs)) continue;
    if (!h.ghiTruocMoc) {
      ghiSauMoc += 1;
      continue;
    }
    if (!conTaiMoc(h) || !h.quyDoiDuoc) continue;
    if (
      moc === null ||
      h.ngayHieuLuc > moc.ngayHieuLuc ||
      (h.ngayHieuLuc === moc.ngayHieuLuc && BigInt(h.seq) > BigInt(moc.seq))
    ) {
      moc = h;
    }
  }
  return { moc, ghiSauMoc, rutSauMoc: moc?.rutSauMoc ?? false };
}

/**
 * Độ lệch của đơn giá `gia` so với mốc `moc`, phần trăm, một chữ số lẻ, làm tròn nửa-ra-xa-0: `(gia − moc) / moc · 100`. Chuỗi có dấu
 * (`"12.3"`, `"-4.5"`, `"0.0"`). Chính xác — phép chia nguyên trên hai số đã cùng số chữ số lẻ. Ném khi mốc không dương.
 */
export function lechPhanTram(gia: string, moc: string): string {
  const p = docThapPhan(gia);
  const m = docThapPhan(moc);
  if (m.m <= 0n) throw new RangeError("mốc phải dương");
  const s = Math.max(p.s, m.s);
  const P = p.m * 10n ** BigInt(s - p.s);
  const M = m.m * 10n ** BigInt(s - m.s);
  const hieu = triTuyetDoi(tru({ m: P, s: 0 }, { m: M, s: 0 })).m;
  // phần nghìn = hiệu · 1000 / M, làm tròn nửa-ra-xa-0: ⌊(2 · hiệu · 1000 + M) / (2M)⌋.
  const phanNghin = (2n * hieu * 1000n + M) / (2n * M);
  const am = soSanh({ m: P, s: 0 }, { m: M, s: 0 }) < 0 && phanNghin > 0n;
  return `${am ? "-" : ""}${String(phanNghin / 10n)}.${String(phanNghin % 10n)}`;
}
