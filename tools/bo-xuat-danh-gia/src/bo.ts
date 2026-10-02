// ==============================================================================================
// [S1.114 / S2.7 / ADR-059] HÌNH DẠNG CỦA BỘ BẰNG CHỨNG, VÀ BỘ ĐỌC PHÁN XỬ NÓ
//
// Tệp này KHÔNG chạm cơ sở dữ liệu và KHÔNG chạm `@trustprocure/danh-gia`. Đó là điều kiện để
// `kiem` chạy được trên một thư mục đã ngắt kết nối — ADR-059 §*Đo bằng gì* ⒜.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO CÓ MỘT BỘ ĐỌC PHÁN XỬ THAY VÌ MỘT PHÉP ÉP KIỂU
// ----------------------------------------------------------------------------------------------
// `JSON.parse` trả `any`. Một bundle là tệp của NGƯỜI KHÁC — nó có thể thiếu trường, mang kiểu
// khác, hay bị sửa tay. Ép kiểu ở đây sẽ biến một bundle hỏng thành một lượt kiểm ĐẠT hay một
// `TypeError` không gọi tên được chỗ hỏng; cả hai đều tệ hơn một câu từ chối có địa chỉ.
//
// ----------------------------------------------------------------------------------------------
// `components` ĐI VÀO BUNDLE NGUYÊN VĂN, KHÔNG CHUẨN HOÁ
// ----------------------------------------------------------------------------------------------
// Cơ sở dữ liệu giữ HAI cách viết khoá cho cùng một khái niệm: `eval_components` của chính sách
// dùng `don_vi`/`he_so` (hợp đồng do `CHECK` của `057` cưỡng chế), còn `components` của từng hàng
// dùng `donVi`/`heSo`/`giaTri` (thứ `luot-danh-gia.ts` `JSON.stringify` ra). Bundle chép ĐÚNG cả
// hai thay vì gộp về một cách viết: một bộ xuất "dọn dẹp" đầu ra là một bộ xuất mà người kiểm
// không đối chiếu được với cơ sở dữ liệu nữa. Cùng bài học với `trich` (ADR-026 §5⑶): chép byte,
// đừng mã hoá lại.
//
// Hệ quả phải nói ra: `057` chỉ đòi `ma` và `tien` trong `components`. `heSo`/`giaTri` là thứ
// đường ghi hôm nay LUÔN viết nhưng lược đồ KHÔNG cưỡng chế — nên một hàng thiếu `giaTri` là hợp
// lệ với cơ sở dữ liệu và **không tái lập được** với bộ kiểm. Bộ kiểm phải báo đúng thế chứ đừng
// đoán, và tổng kết phải đếm riêng số hàng ấy — một lượt kiểm "tất cả ĐẠT" trên không hàng nào là
// đúng cái bẫy `every()` trên mảng rỗng.
// ==============================================================================================

import type { ThanhPhanChinhSachDoc } from "./doc-lap/tinh-lai.js";

export const DANG_BUNDLE = "trustprocure/bo-bang-chung-danh-gia";
/** [S1.9101 / S4.5c2] `2`: lớp dữ liệu nền (`duLieuNen`). */
export const PHIEN_BAN_BUNDLE = 2;
export const TEP_DU_LIEU = "bo-bang-chung.json";
export const TEP_DAC_TA = "DAC-TA.md";

/** Lỗi ĐỌC bundle — luôn gọi tên đường dẫn tới trường hỏng. */
export class BoHongError extends Error {
  public constructor(duong: string, vande: string) {
    super(`bundle hỏng tại \`${duong}\`: ${vande}`);
    this.name = "BoHongError";
  }
}

/**
 * Một mốc thời gian, cùng NGUỒN của nó.
 *
 * Trường `nguon` không phải trang trí: khoản **196** ghi rằng đồng hồ của cơ sở dữ liệu đã lệch
 * 6 giờ 22 phút sau một đêm máy ngủ, và không lớp nào khai nguồn thời gian hay canh nó lệch. Một
 * bundle in một mốc thời gian trần là một bundle mời người đọc tin vào thứ dự án chưa dám tin.
 */
export interface MocThoiGian {
  readonly giaTri: string;
  readonly nguon: string;
}

/** Một phần tử của `components` — NGUYÊN VĂN như cơ sở dữ liệu giữ. */
export interface ThanhPhanLuu {
  readonly ma: string;
  readonly donVi?: string;
  readonly heSo?: string;
  readonly giaTri?: string;
  readonly tien: string | null;
}

export interface HangBundle {
  readonly bidVersionId: string;
  readonly supplierName: string;
  readonly effectiveCost: string | null;
  readonly rank: number | null;
  readonly components: readonly ThanhPhanLuu[];
}

export interface LuotChamBundle {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly currency: string;
  /** `eval_components` của ĐÚNG phiên bản chính sách lượt chấm ấy dùng, chép nguyên văn. */
  readonly chinhSachThanhPhan: readonly ThanhPhanChinhSachDoc[];
  readonly taoLuc: MocThoiGian;
  readonly hang: readonly HangBundle[];
}

export interface TraoThauBundle {
  readonly awardId: string;
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly status: string;
  readonly reason: string;
  readonly actedAt: MocThoiGian;
}

export interface BoBangChung {
  readonly dang: string;
  readonly phienBan: number;
  readonly dacTaPhienBan: number;
  /** SHA-256 hex của ĐÚNG byte `DAC-TA.md` đi kèm. `kiem` băm lại tệp và so. */
  readonly dacTaSha256: string;
  readonly orgId: string;
  readonly rfqId: string;
  readonly xuatLuc: MocThoiGian;
  /** Mọi lượt chấm của gói thầu, cũ trước mới sau — KHÔNG chỉ lượt mới nhất. */
  readonly luotCham: readonly LuotChamBundle[];
  readonly traoThau: readonly TraoThauBundle[];
  /** [S1.9101 / S4.5c2] Lớp dữ liệu nền — `DAC-TA.md` §8. `null` khi không lượt chấm nào có nhãn benchmark. */
  readonly duLieuNen: DuLieuNenDoc | null;
}

// ----------------------------------------------------------------------------------------------
// [S1.9101 / S4.5c2] LỚP DỮ LIỆU NỀN — HÌNH DẠNG PHÍA NGƯỜI KIỂM (`DAC-TA.md` §8)
//
// Định nghĩa RIÊNG, không mượn `packages/danh-gia/src/lop-du-lieu-nen.ts`: người kiểm không mượn hình dạng của người bị kiểm (khối
// đầu tệp). Mốc là chuỗi ISO UTC sáu chữ số lẻ (§8.2) — bộ đọc ĐÒI đúng dạng ấy, vì phép so thứ tự từ điển của lớp độc lập chỉ đúng
// trên đúng dạng ấy.
// ----------------------------------------------------------------------------------------------

export interface QuanSatDoc {
  readonly ma: string;
  readonly goi: string;
  readonly ncc: string;
  readonly ngay: string;
  readonly gia: string;
  readonly tienTe: string;
  readonly cungNguoiTao: boolean;
  readonly hoiTo: readonly string[];
}

export interface BangQuanSatDoc {
  readonly mocMoGia: string;
  readonly hangChuan: string;
  readonly tuNgay: string;
  readonly quanSat: readonly QuanSatDoc[];
}

export interface AnhXaDoc {
  readonly anhXaId: string;
  readonly hangChuan: string | null;
  readonly nguon: string;
  readonly lyDo: string | null;
  readonly tacGia: { readonly userId: string; readonly hoTen: string | null };
  readonly ghiLuc: string;
}

export interface GiaDongDoc {
  readonly trangThai: string;
  readonly gia: string | null;
  readonly tienTe: string | null;
  readonly hangChuan: string;
  readonly hoiTo: readonly string[];
}

export interface DongBenchmarkDoc {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly nhan: string;
  readonly chieu: string | null;
  readonly lyDo: string | null;
  readonly hangChuan: string | null;
  readonly tienTe: string | null;
  readonly cuaSoTu: string | null;
  readonly soQuanSat: number | null;
  readonly soGoi: number | null;
  readonly soNcc: number | null;
  readonly soGoiCungNguoiTao: number | null;
  readonly soQuanSatHoiTo: number | null;
  readonly soLoaiTienTe: number | null;
  readonly soLoaiGia0: number | null;
  readonly hoiTo: readonly string[];
  readonly giaDong: GiaDongDoc | null;
  readonly anhXa: AnhXaDoc | null;
}

export interface DauVaoDoc {
  readonly hangChuan: string;
  readonly tienTe: string;
  readonly quanSat: readonly string[];
}

/** Nhóm khoá `benchmark` của chính sách — sáu khoá, cách viết của CSDL. */
export interface NhomBenchmarkDoc {
  readonly cua_so_thang: string;
  readonly san_goi: string;
  readonly san_ncc: string;
  readonly nguong_lech_vua: string;
  readonly nguong_lech_cao: string;
  readonly phuong_phap: string;
}

export interface LuotChamDuLieuNenDoc {
  readonly evaluationId: string;
  readonly chinhSachBenchmark: NhomBenchmarkDoc;
  readonly mocMoGia: string;
  readonly docLuc: string;
  readonly dong: readonly DongBenchmarkDoc[];
  readonly dauVao: readonly DauVaoDoc[];
  readonly dauVaoThieu: number;
}

export interface DuLieuNenDoc {
  readonly phuongPhap: string;
  readonly nguonThoiGian: string;
  readonly goiX: string;
  readonly hangMuc: readonly { readonly lineNo: number; readonly moTa: string; readonly donVi: string; readonly soLuong: string }[];
  readonly bangQuanSat: readonly BangQuanSatDoc[];
  readonly luotCham: readonly LuotChamDuLieuNenDoc[];
}

// ----------------------------------------------------------------------------------------------
// BỘ ĐỌC
// ----------------------------------------------------------------------------------------------

function doiTuong(gt: unknown, duong: string): Record<string, unknown> {
  if (typeof gt !== "object" || gt === null || Array.isArray(gt)) {
    throw new BoHongError(duong, "cần một object");
  }
  return gt as Record<string, unknown>;
}

function chuoi(o: Record<string, unknown>, ten: string, duong: string): string {
  const gt = o[ten];
  if (typeof gt !== "string") throw new BoHongError(`${duong}.${ten}`, "cần một chuỗi");
  return gt;
}

function chuoiHayNull(o: Record<string, unknown>, ten: string, duong: string): string | null {
  const gt = o[ten];
  if (gt === null) return null;
  if (typeof gt !== "string") throw new BoHongError(`${duong}.${ten}`, "cần một chuỗi hay null");
  return gt;
}

function chuoiTuyChon(o: Record<string, unknown>, ten: string, duong: string): string | undefined {
  const gt = o[ten];
  if (gt === undefined) return undefined;
  if (typeof gt !== "string") throw new BoHongError(`${duong}.${ten}`, "cần một chuỗi khi có mặt");
  return gt;
}

function soNguyen(o: Record<string, unknown>, ten: string, duong: string): number {
  const gt = o[ten];
  if (typeof gt !== "number" || !Number.isInteger(gt)) {
    throw new BoHongError(`${duong}.${ten}`, "cần một số nguyên");
  }
  return gt;
}

function soNguyenHayNull(o: Record<string, unknown>, ten: string, duong: string): number | null {
  const gt = o[ten];
  if (gt === null) return null;
  if (typeof gt !== "number" || !Number.isInteger(gt)) {
    throw new BoHongError(`${duong}.${ten}`, "cần một số nguyên hay null");
  }
  return gt;
}

function mang(o: Record<string, unknown>, ten: string, duong: string): readonly unknown[] {
  const gt = o[ten];
  if (!Array.isArray(gt)) throw new BoHongError(`${duong}.${ten}`, "cần một mảng");
  return gt as readonly unknown[];
}

function docMoc(gt: unknown, duong: string): MocThoiGian {
  const o = doiTuong(gt, duong);
  return { giaTri: chuoi(o, "giaTri", duong), nguon: chuoi(o, "nguon", duong) };
}

function docThanhPhanChinhSach(gt: unknown, duong: string): ThanhPhanChinhSachDoc {
  const o = doiTuong(gt, duong);
  return {
    ma: chuoi(o, "ma", duong),
    don_vi: chuoi(o, "don_vi", duong),
    he_so: chuoi(o, "he_so", duong),
  };
}

function docThanhPhanLuu(gt: unknown, duong: string): ThanhPhanLuu {
  const o = doiTuong(gt, duong);
  return {
    ma: chuoi(o, "ma", duong),
    donVi: chuoiTuyChon(o, "donVi", duong),
    heSo: chuoiTuyChon(o, "heSo", duong),
    giaTri: chuoiTuyChon(o, "giaTri", duong),
    tien: chuoiHayNull(o, "tien", duong),
  };
}

function docHang(gt: unknown, duong: string): HangBundle {
  const o = doiTuong(gt, duong);
  return {
    bidVersionId: chuoi(o, "bidVersionId", duong),
    supplierName: chuoi(o, "supplierName", duong),
    effectiveCost: chuoiHayNull(o, "effectiveCost", duong),
    rank: soNguyenHayNull(o, "rank", duong),
    components: mang(o, "components", duong).map((x, i) =>
      docThanhPhanLuu(x, `${duong}.components[${String(i)}]`),
    ),
  };
}

function docLuotCham(gt: unknown, duong: string): LuotChamBundle {
  const o = doiTuong(gt, duong);
  return {
    evaluationId: chuoi(o, "evaluationId", duong),
    policyId: chuoi(o, "policyId", duong),
    policyVersion: soNguyen(o, "policyVersion", duong),
    currency: chuoi(o, "currency", duong),
    chinhSachThanhPhan: mang(o, "chinhSachThanhPhan", duong).map((x, i) =>
      docThanhPhanChinhSach(x, `${duong}.chinhSachThanhPhan[${String(i)}]`),
    ),
    taoLuc: docMoc(o["taoLuc"], `${duong}.taoLuc`),
    hang: mang(o, "hang", duong).map((x, i) => docHang(x, `${duong}.hang[${String(i)}]`)),
  };
}

function docTraoThau(gt: unknown, duong: string): TraoThauBundle {
  const o = doiTuong(gt, duong);
  return {
    awardId: chuoi(o, "awardId", duong),
    evaluationId: chuoi(o, "evaluationId", duong),
    bidVersionId: chuoi(o, "bidVersionId", duong),
    status: chuoi(o, "status", duong),
    reason: chuoi(o, "reason", duong),
    actedAt: docMoc(o["actedAt"], `${duong}.actedAt`),
  };
}

// ---- [S1.9101 / S4.5c2] bộ đọc lớp dữ liệu nền ---------------------------------------------------

const KHUON_MOC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const KHUON_SO_KHONG_AM = /^\d+(?:\.\d+)?$/u;

function moc6(o: Record<string, unknown>, ten: string, duong: string): string {
  const gt = chuoi(o, ten, duong);
  if (!KHUON_MOC.test(gt)) throw new BoHongError(`${duong}.${ten}`, "cần một mốc ISO UTC đúng sáu chữ số lẻ (DAC-TA §8.2)");
  return gt;
}

function moc6HayNull(o: Record<string, unknown>, ten: string, duong: string): string | null {
  return o[ten] === null ? null : moc6(o, ten, duong);
}

function soKhongAm(o: Record<string, unknown>, ten: string, duong: string): string {
  const gt = chuoi(o, ten, duong);
  if (!KHUON_SO_KHONG_AM.test(gt)) throw new BoHongError(`${duong}.${ten}`, "cần một chuỗi thập phân không âm");
  return gt;
}

function logic(o: Record<string, unknown>, ten: string, duong: string): boolean {
  const gt = o[ten];
  if (typeof gt !== "boolean") throw new BoHongError(`${duong}.${ten}`, "cần true hay false");
  return gt;
}

function mangChuoi(o: Record<string, unknown>, ten: string, duong: string): readonly string[] {
  return mang(o, ten, duong).map((x, i) => {
    if (typeof x !== "string") throw new BoHongError(`${duong}.${ten}[${String(i)}]`, "cần một chuỗi");
    return x;
  });
}

function docQuanSat(gt: unknown, duong: string): QuanSatDoc {
  const o = doiTuong(gt, duong);
  return {
    ma: chuoi(o, "ma", duong),
    goi: chuoi(o, "goi", duong),
    ncc: chuoi(o, "ncc", duong),
    ngay: moc6(o, "ngay", duong),
    gia: soKhongAm(o, "gia", duong),
    tienTe: chuoi(o, "tienTe", duong),
    cungNguoiTao: logic(o, "cungNguoiTao", duong),
    hoiTo: mangChuoi(o, "hoiTo", duong),
  };
}

function docBangQuanSat(gt: unknown, duong: string): BangQuanSatDoc {
  const o = doiTuong(gt, duong);
  return {
    mocMoGia: moc6(o, "mocMoGia", duong),
    hangChuan: chuoi(o, "hangChuan", duong),
    tuNgay: moc6(o, "tuNgay", duong),
    quanSat: mang(o, "quanSat", duong).map((x, i) => docQuanSat(x, `${duong}.quanSat[${String(i)}]`)),
  };
}

function docAnhXa(gt: unknown, duong: string): AnhXaDoc | null {
  if (gt === null) return null;
  const o = doiTuong(gt, duong);
  const t = doiTuong(o["tacGia"], `${duong}.tacGia`);
  return {
    anhXaId: chuoi(o, "anhXaId", duong),
    hangChuan: chuoiHayNull(o, "hangChuan", duong),
    nguon: chuoi(o, "nguon", duong),
    lyDo: chuoiHayNull(o, "lyDo", duong),
    tacGia: { userId: chuoi(t, "userId", `${duong}.tacGia`), hoTen: chuoiHayNull(t, "hoTen", `${duong}.tacGia`) },
    ghiLuc: moc6(o, "ghiLuc", duong),
  };
}

function docGiaDong(gt: unknown, duong: string): GiaDongDoc | null {
  if (gt === null) return null;
  const o = doiTuong(gt, duong);
  const gia = chuoiHayNull(o, "gia", duong);
  if (gia !== null && !KHUON_SO_KHONG_AM.test(gia)) throw new BoHongError(`${duong}.gia`, "cần một chuỗi thập phân không âm");
  return {
    trangThai: chuoi(o, "trangThai", duong),
    gia,
    tienTe: chuoiHayNull(o, "tienTe", duong),
    hangChuan: chuoi(o, "hangChuan", duong),
    hoiTo: mangChuoi(o, "hoiTo", duong),
  };
}

function docDongBenchmark(gt: unknown, duong: string): DongBenchmarkDoc {
  const o = doiTuong(gt, duong);
  return {
    bidVersionId: chuoi(o, "bidVersionId", duong),
    lineNo: soNguyen(o, "lineNo", duong),
    nhan: chuoi(o, "nhan", duong),
    chieu: chuoiHayNull(o, "chieu", duong),
    lyDo: chuoiHayNull(o, "lyDo", duong),
    hangChuan: chuoiHayNull(o, "hangChuan", duong),
    tienTe: chuoiHayNull(o, "tienTe", duong),
    cuaSoTu: moc6HayNull(o, "cuaSoTu", duong),
    soQuanSat: soNguyenHayNull(o, "soQuanSat", duong),
    soGoi: soNguyenHayNull(o, "soGoi", duong),
    soNcc: soNguyenHayNull(o, "soNcc", duong),
    soGoiCungNguoiTao: soNguyenHayNull(o, "soGoiCungNguoiTao", duong),
    soQuanSatHoiTo: soNguyenHayNull(o, "soQuanSatHoiTo", duong),
    soLoaiTienTe: soNguyenHayNull(o, "soLoaiTienTe", duong),
    soLoaiGia0: soNguyenHayNull(o, "soLoaiGia0", duong),
    hoiTo: mangChuoi(o, "hoiTo", duong),
    giaDong: docGiaDong(o["giaDong"], `${duong}.giaDong`),
    anhXa: docAnhXa(o["anhXa"], `${duong}.anhXa`),
  };
}

function docNhomBenchmark(gt: unknown, duong: string): NhomBenchmarkDoc {
  const o = doiTuong(gt, duong);
  const khoa = Object.keys(o).sort().join(",");
  const can = "cua_so_thang,nguong_lech_cao,nguong_lech_vua,phuong_phap,san_goi,san_ncc";
  if (khoa !== can) throw new BoHongError(duong, `cần đúng sáu khoá ${can}, gặp ${khoa}`);
  return {
    cua_so_thang: chuoi(o, "cua_so_thang", duong),
    san_goi: chuoi(o, "san_goi", duong),
    san_ncc: chuoi(o, "san_ncc", duong),
    nguong_lech_vua: soKhongAm(o, "nguong_lech_vua", duong),
    nguong_lech_cao: soKhongAm(o, "nguong_lech_cao", duong),
    phuong_phap: chuoi(o, "phuong_phap", duong),
  };
}

function docLuotChamDuLieuNen(gt: unknown, duong: string): LuotChamDuLieuNenDoc {
  const o = doiTuong(gt, duong);
  return {
    evaluationId: chuoi(o, "evaluationId", duong),
    chinhSachBenchmark: docNhomBenchmark(o["chinhSachBenchmark"], `${duong}.chinhSachBenchmark`),
    mocMoGia: moc6(o, "mocMoGia", duong),
    docLuc: moc6(o, "docLuc", duong),
    dong: mang(o, "dong", duong).map((x, i) => docDongBenchmark(x, `${duong}.dong[${String(i)}]`)),
    dauVao: mang(o, "dauVao", duong).map((x, i) => {
      const d = doiTuong(x, `${duong}.dauVao[${String(i)}]`);
      const p = `${duong}.dauVao[${String(i)}]`;
      return { hangChuan: chuoi(d, "hangChuan", p), tienTe: chuoi(d, "tienTe", p), quanSat: mangChuoi(d, "quanSat", p) };
    }),
    dauVaoThieu: soNguyen(o, "dauVaoThieu", duong),
  };
}

function docDuLieuNen(gt: unknown, duong: string): DuLieuNenDoc | null {
  if (gt === null) return null;
  const o = doiTuong(gt, duong);
  return {
    phuongPhap: chuoi(o, "phuongPhap", duong),
    nguonThoiGian: chuoi(o, "nguonThoiGian", duong),
    goiX: chuoi(o, "goiX", duong),
    hangMuc: mang(o, "hangMuc", duong).map((x, i) => {
      const p = `${duong}.hangMuc[${String(i)}]`;
      const h = doiTuong(x, p);
      return { lineNo: soNguyen(h, "lineNo", p), moTa: chuoi(h, "moTa", p), donVi: chuoi(h, "donVi", p), soLuong: chuoi(h, "soLuong", p) };
    }),
    bangQuanSat: mang(o, "bangQuanSat", duong).map((x, i) => docBangQuanSat(x, `${duong}.bangQuanSat[${String(i)}]`)),
    luotCham: mang(o, "luotCham", duong).map((x, i) => docLuotChamDuLieuNen(x, `${duong}.luotCham[${String(i)}]`)),
  };
}

/**
 * Phán xử một giá trị `JSON.parse` thành một `BoBangChung`.
 *
 * Ném `BoHongError` mang ĐƯỜNG DẪN tới trường hỏng. Một thông điệp *"bundle không hợp lệ"* buộc
 * người cầm tệp phải đoán, và đoán là thứ lớp bằng chứng tồn tại để xoá bỏ.
 */
export function docBo(raw: unknown): BoBangChung {
  const o = doiTuong(raw, "$");
  const dang = chuoi(o, "dang", "$");
  if (dang !== DANG_BUNDLE) {
    throw new BoHongError("$.dang", `cần "${DANG_BUNDLE}", gặp "${dang}"`);
  }
  const phienBan = soNguyen(o, "phienBan", "$");
  if (phienBan !== PHIEN_BAN_BUNDLE) {
    throw new BoHongError("$.phienBan", `bộ kiểm này chỉ đọc phiên bản ${String(PHIEN_BAN_BUNDLE)}`);
  }
  return {
    dang,
    phienBan,
    dacTaPhienBan: soNguyen(o, "dacTaPhienBan", "$"),
    dacTaSha256: chuoi(o, "dacTaSha256", "$"),
    orgId: chuoi(o, "orgId", "$"),
    rfqId: chuoi(o, "rfqId", "$"),
    xuatLuc: docMoc(o["xuatLuc"], "$.xuatLuc"),
    luotCham: mang(o, "luotCham", "$").map((x, i) => docLuotCham(x, `$.luotCham[${String(i)}]`)),
    traoThau: mang(o, "traoThau", "$").map((x, i) => docTraoThau(x, `$.traoThau[${String(i)}]`)),
    duLieuNen: docDuLieuNen(o["duLieuNen"], "$.duLieuNen"),
  };
}
