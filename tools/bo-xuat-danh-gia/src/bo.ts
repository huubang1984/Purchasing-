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
export const PHIEN_BAN_BUNDLE = 1;
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
  };
}
