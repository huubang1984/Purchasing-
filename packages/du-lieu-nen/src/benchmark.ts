// [S1.256 / S4.5b] LÕI THUẦN CỦA BENCHMARK GIÁ — phương pháp `TRUNG_VI_THEO_GOI_V1` (spec S4 §4.6, §2.4 ⑾; ADR-141 ⑧; ADR-142).
//
// Tất định: không I/O, không đồng hồ, không `double` trên giá. Đầu vào là các hàng `quan_sat_gia(mốc mở giá của X, hàng chuẩn)`
// đã đọc — MỌI trạng thái — và mọi phép lọc nằm ở đây, không ở câu SQL: lõi này là thứ phép tính lại L7 và bộ kiểm ngoại tuyến của
// S4.5c đối chiếu, nên luật *"quan sát nào vào dải"* phải đọc được ở một chỗ.
//
// Luật, theo thứ tự:
//   ⑴ chỉ `HOP_LE`; không quan sát nào của CHÍNH gói X (L7 — `quan_sat_gia` tại mốc của X đã loại X vì mốc so NGẶT, lõi loại lần
//      nữa theo `rfqId`); ngày quan sát trong [mốc − `cua_so_thang` tháng, mốc);
//   ⑵ khác tiền tệ với báo giá đang xét ⇒ loại, ĐẾM; đơn giá quy đổi bằng 0 ⇒ loại, ĐẾM (ADR-141 ⑧);
//   ⑶ mỗi gói một trung vị trên các quan sát còn lại của nó; mốc so là trung vị các trung vị gói; dải [Q1, Q3] trên các trung vị
//      gói — tứ phân vị nội suy tuyến tính (cùng nghĩa `percentile_cont`), số thập phân chính xác;
//   ⑷ sàn: ≥ `san_goi` gói VÀ ≥ `san_ncc` nhà cung cấp khác nhau, không thì `CHUA_DU_LICH_SU` và không con số nào;
//   ⑸ nhãn của đơn giá p so với mốc m: |p − m| ≤ `nguong_lech_vua`·m ⇒ `BINH_THUONG`; ≤ `nguong_lech_cao`·m ⇒ `LECH_VUA`; còn lại
//      `LECH_CAO`; hai nhãn LỆCH mang chiều `TREN`/`DUOI`. So bằng nhân chéo, không chia.
// Thời điểm là số micro giây kể từ epoch (`bigint`), đúng độ phân giải của `timestamptz`; tháng trừ theo lịch UTC, ngày cuối tháng
// kẹp về ngày cuối của tháng đích (31/3 − 1 tháng = 28/2 hay 29/2).
import {
  chuoiThapPhan,
  docThapPhan,
  nhan,
  phanViTu,
  sapTang,
  soSanh,
  triTuyetDoi,
  tru,
  type ThapPhan,
} from "./so-thap-phan.js";

export const PHUONG_PHAP_BENCHMARK = "TRUNG_VI_THEO_GOI_V1";

/** Tập ĐÓNG của nhãn — `KHONG_DO_DUOC` cho dòng của X không đo được (chủ dự án chốt 2026-10-01). */
export const NHAN_BENCHMARK = ["BINH_THUONG", "LECH_VUA", "LECH_CAO", "CHUA_DU_LICH_SU", "KHONG_DO_DUOC"] as const;
export type NhanBenchmark = (typeof NHAN_BENCHMARK)[number];
export type ChieuLech = "TREN" | "DUOI";

/** Nhóm khoá `benchmark` của một phiên bản chính sách, đã đọc. */
export interface NhomBenchmark {
  readonly cuaSoThang: number;
  readonly sanGoi: number;
  readonly sanNcc: number;
  readonly nguongLechVua: string;
  readonly nguongLechCao: string;
  readonly phuongPhap: typeof PHUONG_PHAP_BENCHMARK;
}

/**
 * Mẫu điền sẵn của nhóm khoá — mặc định GIẢ ĐỊNH của spec §4.1. Là MẪU cho màn `/chinh-sach` và `gieo:demo`, KHÔNG BAO GIỜ là giá
 * trị ngầm: phiên bản không khai nhóm này thì benchmark hiện *"chưa cấu hình"* (fail-closed, spec S2 §4.1).
 */
export const NHOM_BENCHMARK_MAU: Readonly<Record<string, string>> = {
  cua_so_thang: "12",
  san_goi: "3",
  san_ncc: "3",
  nguong_lech_vua: "0.05",
  nguong_lech_cao: "0.10",
  phuong_phap: PHUONG_PHAP_BENCHMARK,
};

const KHOA_NHOM = ["cua_so_thang", "san_goi", "san_ncc", "nguong_lech_vua", "nguong_lech_cao", "phuong_phap"] as const;
const NGUYEN = /^[1-9][0-9]?$/u;
const NGUONG = /^(0|[1-9][0-9]?)(\.[0-9]{1,4})?$/u;

/**
 * Đọc cột `benchmark` của phiên bản chính sách. `null` ⇔ chưa cấu hình. Hình dạng có thẩm quyền là `CHECK`
 * `org_procurement_policies_benchmark_hinh_dang` (jsonpath `strict` — `lax` để lọt mảng, §S1.256); ở đây NÉM khi giá trị lệch khỏi
 * nó — một hàng đã qua `CHECK` không tới nhánh ấy, nên nó chỉ nổ khi `CHECK` bị gỡ hay nới (fail-closed thay vì một nhãn tính trên
 * ngưỡng lạ).
 */
export function docNhomBenchmark(tho: unknown): NhomBenchmark | null {
  if (tho === null || tho === undefined) return null;
  if (typeof tho !== "object" || Array.isArray(tho)) throw new Error("nhóm benchmark không phải đối tượng");
  const o = tho as Record<string, unknown>;
  const khoa = Object.keys(o).sort();
  if (khoa.join(",") !== [...KHOA_NHOM].sort().join(",")) throw new Error("nhóm benchmark sai tập khoá");
  for (const k of KHOA_NHOM) if (typeof o[k] !== "string") throw new Error(`khoá benchmark ${k} không phải chuỗi`);
  const c = o as Record<(typeof KHOA_NHOM)[number], string>;
  if (c.phuong_phap !== PHUONG_PHAP_BENCHMARK) throw new Error("phương pháp benchmark lạ");
  for (const k of ["cua_so_thang", "san_goi", "san_ncc"] as const) {
    if (!NGUYEN.test(c[k])) throw new Error(`khoá benchmark ${k} không phải số nguyên dương`);
  }
  for (const k of ["nguong_lech_vua", "nguong_lech_cao"] as const) {
    if (!NGUONG.test(c[k])) throw new Error(`khoá benchmark ${k} sai dạng`);
  }
  const vua = docThapPhan(c.nguong_lech_vua);
  const cao = docThapPhan(c.nguong_lech_cao);
  const cuaSo = Number(c.cua_so_thang);
  const sanGoi = Number(c.san_goi);
  const sanNcc = Number(c.san_ncc);
  if (
    cuaSo > 60 ||
    sanGoi > 50 ||
    sanNcc > 50 ||
    vua.m <= 0n ||
    soSanh(vua, cao) >= 0 ||
    soSanh(cao, { m: 10n, s: 0 }) > 0
  ) {
    throw new Error("nhóm benchmark ngoài biên");
  }
  return {
    cuaSoThang: cuaSo,
    sanGoi,
    sanNcc,
    nguongLechVua: c.nguong_lech_vua,
    nguongLechCao: c.nguong_lech_cao,
    phuongPhap: PHUONG_PHAP_BENCHMARK,
  };
}

/** Lùi `thang` tháng lịch UTC, kẹp ngày cuối tháng; giữ nguyên giờ, phút, giây, micro giây. */
export function truThang(mocMicro: bigint, thang: number): bigint {
  if (!Number.isInteger(thang) || thang < 0) throw new RangeError("số tháng phải là số nguyên không âm");
  const ms = mocMicro >= 0n ? mocMicro / 1000n : -((-mocMicro + 999n) / 1000n);
  const du = mocMicro - ms * 1000n;
  const d = new Date(Number(ms));
  const tong = d.getUTCFullYear() * 12 + d.getUTCMonth() - thang;
  const nam = Math.floor(tong / 12);
  const thangDich = tong - nam * 12;
  const ngayCuoi = new Date(Date.UTC(nam, thangDich + 1, 0)).getUTCDate();
  const moi = Date.UTC(
    nam,
    thangDich,
    Math.min(d.getUTCDate(), ngayCuoi),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
  return BigInt(moi) * 1000n + du;
}

/** Một hàng của `quan_sat_gia(mốc mở giá của X, hàng chuẩn)` — mọi trạng thái — cộng một cờ đọc từ `rfq_packages`. */
export interface QuanSatBenchmark {
  readonly rfqId: string;
  readonly supplierId: string;
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly anhXaId: string | null;
  /** Mốc mở giá của gói chứa quan sát, micro giây. */
  readonly ngayQuanSat: bigint;
  readonly trangThai: string;
  /** Chuỗi `numeric`; chỉ có khi `HOP_LE`. */
  readonly donGiaQuyDoi: string | null;
  readonly tienTe: string | null;
  readonly hoiTo: readonly string[];
  /** Gói chứa quan sát do CHÍNH người tạo gói X lập. */
  readonly goiCungNguoiTao: boolean;
}

/** Dải của một (gói X, hàng chuẩn, tiền tệ). Không con số nào khi dưới sàn. */
export interface DaiBenchmark {
  readonly tienTe: string;
  readonly cuaSoTu: bigint;
  readonly soQuanSat: number;
  readonly soGoi: number;
  readonly soNcc: number;
  readonly soGoiCungNguoiTao: number;
  readonly soQuanSatHoiTo: number;
  readonly soLoaiTienTe: number;
  readonly soLoaiGia0: number;
  readonly duSan: boolean;
  readonly mocSo: { readonly q1: string; readonly trungVi: string; readonly q3: string } | null;
  /** Mọi quan sát đã vào dải — kể cả khi dưới sàn (đầu vào của phép tính lại L7). */
  readonly dauVao: readonly QuanSatBenchmark[];
}

export interface DaiInput {
  /** Gói đang xét. */
  readonly rfqId: string;
  readonly tienTe: string;
  /** Mốc mở giá của X, micro giây. */
  readonly mocMoGia: bigint;
  readonly nhom: NhomBenchmark;
}

export function tinhDai(quanSat: readonly QuanSatBenchmark[], vao: DaiInput): DaiBenchmark {
  const cuaSoTu = truThang(vao.mocMoGia, vao.nhom.cuaSoThang);
  const dung: QuanSatBenchmark[] = [];
  let soLoaiTienTe = 0;
  let soLoaiGia0 = 0;
  for (const q of quanSat) {
    if (q.trangThai !== "HOP_LE" || q.rfqId === vao.rfqId) continue;
    if (q.ngayQuanSat >= vao.mocMoGia || q.ngayQuanSat < cuaSoTu) continue;
    if (q.tienTe !== vao.tienTe) {
      soLoaiTienTe += 1;
      continue;
    }
    if (q.donGiaQuyDoi === null) throw new Error("quan sát HOP_LE không có đơn giá quy đổi");
    const p = docThapPhan(q.donGiaQuyDoi);
    if (p.m < 0n) throw new Error("đơn giá quy đổi âm");
    if (p.m === 0n) {
      soLoaiGia0 += 1;
      continue;
    }
    dung.push(q);
  }

  const theoGoi = new Map<string, ThapPhan[]>();
  const cungNguoiTao = new Set<string>();
  for (const q of dung) {
    const ds = theoGoi.get(q.rfqId) ?? [];
    ds.push(docThapPhan(q.donGiaQuyDoi!));
    theoGoi.set(q.rfqId, ds);
    if (q.goiCungNguoiTao) cungNguoiTao.add(q.rfqId);
  }
  const soGoi = theoGoi.size;
  const soNcc = new Set(dung.map((q) => q.supplierId)).size;
  const duSan = soGoi >= vao.nhom.sanGoi && soNcc >= vao.nhom.sanNcc;
  const mocSo = duSan ? mocSoTheoGoi([...theoGoi.values()]) : null;
  return {
    tienTe: vao.tienTe,
    cuaSoTu,
    soQuanSat: dung.length,
    soGoi,
    soNcc,
    soGoiCungNguoiTao: cungNguoiTao.size,
    soQuanSatHoiTo: dung.filter((q) => q.hoiTo.length > 0).length,
    soLoaiTienTe,
    soLoaiGia0,
    duSan,
    mocSo,
    dauVao: dung,
  };
}

/**
 * ⑶ của khối đầu tệp: mỗi gói một trung vị trên các đơn giá của nó; mốc so là trung vị các trung vị gói; dải [Q1, Q3] trên các trung vị
 * gói. [S1.276 / S4.6b] Tách ra để dải lịch sử ngoài (`dai-ngoai.ts`) tính CÙNG phương pháp (ADR-096 ⑷) — "gói" của nó là (ngày mua,
 * nhà cung cấp đã làm sạch). Người gọi kiểm sàn trước; ném trên tập rỗng.
 */
export function mocSoTheoGoi(cacGoi: readonly (readonly ThapPhan[])[]): {
  readonly q1: string;
  readonly trungVi: string;
  readonly q3: string;
} {
  const trungViGoi = sapTang(cacGoi.map((ds) => phanViTu(sapTang(ds), 2)));
  return {
    q1: chuoiThapPhan(phanViTu(trungViGoi, 1)),
    trungVi: chuoiThapPhan(phanViTu(trungViGoi, 2)),
    q3: chuoiThapPhan(phanViTu(trungViGoi, 3)),
  };
}

/** Nhãn của một đơn giá quy đổi so với dải — dải nội bộ, hay [S1.276 / S4.6b] dải lịch sử ngoài (cùng ngưỡng của phiên bản ghim). */
export function ganNhan(
  gia: string,
  dai: Pick<DaiBenchmark, "duSan" | "mocSo">,
  nhom: NhomBenchmark,
): { readonly nhan: Exclude<NhanBenchmark, "KHONG_DO_DUOC">; readonly chieu: ChieuLech | null } {
  if (!dai.duSan || dai.mocSo === null) return { nhan: "CHUA_DU_LICH_SU", chieu: null };
  const p = docThapPhan(gia);
  const m = docThapPhan(dai.mocSo.trungVi);
  const lech = triTuyetDoi(tru(p, m));
  if (soSanh(lech, nhan(docThapPhan(nhom.nguongLechVua), m)) <= 0) return { nhan: "BINH_THUONG", chieu: null };
  const chieu: ChieuLech = soSanh(p, m) > 0 ? "TREN" : "DUOI";
  if (soSanh(lech, nhan(docThapPhan(nhom.nguongLechCao), m)) <= 0) return { nhan: "LECH_VUA", chieu };
  return { nhan: "LECH_CAO", chieu };
}

/**
 * [S1.262 / S4.5c2] Nhãn của MỘT dòng `HOP_LE` từ các quan sát đã đọc — đúng hai bước `tinhDai` rồi `ganNhan` mà phép tính của lượt
 * chấm làm cho dòng ấy. Thuần. Người dùng: lớp ⑴ (*gọi hàm thuần*, rẻ, bắt hồi quy) của bộ kiểm bộ bằng chứng (ADR-059) — lớp ⑵ cài lại
 * từ `DAC-TA.md` và không với tới gói này (`g17-`).
 */
export function nhanMotDong(
  quanSat: readonly QuanSatBenchmark[],
  vao: DaiInput & { readonly gia: string },
): { readonly dai: DaiBenchmark; readonly nhan: Exclude<NhanBenchmark, "KHONG_DO_DUOC">; readonly chieu: ChieuLech | null } {
  const dai = tinhDai(quanSat, vao);
  return { dai, ...ganNhan(vao.gia, dai, vao.nhom) };
}
