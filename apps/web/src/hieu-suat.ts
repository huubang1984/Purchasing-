// ==============================================================================================
// [S1.9101 / S3.8b] MÀN HIỆU SUẤT NHÀ CUNG CẤP — PHÉP TÍNH CỦA `/hieu-suat`
//
// Spec S3 §4.9, §5.1 K11; ADR-163. Người giữ `bid.view` (mua sắm, tài chính, giám đốc) đọc `GET /supplier-performance`: mỗi nhà cung
// cấp một hàng, chỉ đếm gói ĐÃ LỘ GIÁ (chủ dự án chốt 2026-10-10). Máy chủ đã giữ lại mọi tỷ lệ và trung vị có mẫu dưới sàn
// (`chuaDuLichSu`); màn nói *"chưa đủ lịch sử"* kèm mẫu số, không tự tính lại, không đoán.
//
// Ngôn ngữ (spec §2.2 ⑶, *Risk Signal ≠ Fraud Verdict*): mọi ô là số MÔ TẢ — đếm, tỷ lệ, thời lượng, hạng —, không nhãn đánh giá, không
// điểm tổng hợp, không tô màu theo con số. `hieu-suat.test.ts` quét chữ của màn và của module này.
//
// Phép tính THUẦN trên dữ liệu máy chủ trả về — `tsc` gác, `hieu-suat.test.ts` đo, phục vụ cho trình duyệt ở `/lib/hieu-suat.js`
// (khuôn `nha-cung-cap.ts`). Kịch bản 41 bản HTTP đưa thân trả về THẬT của route qua `docHieuSuat` và `oCuaHang`.
// ==============================================================================================

/** Các trường máy chủ có thể giữ lại dưới sàn — cùng tên, cùng thứ tự với `TruongDuoiSan` của `packages/kiem-soat`. */
export const TRUONG_DUOI_SAN = [
  "tyLePhanHoiPhanVan",
  "trungViPhanHoiGiay",
  "hangTrungVi",
  "khoangCachTrungViPhanVan",
  "tyLeThangPhanVan",
] as const;
export type TruongDuoiSanMan = (typeof TRUONG_DUOI_SAN)[number];

/** Một nhà cung cấp như `GET /supplier-performance` trả — chỉ các trường màn đọc. */
export interface HieuSuatMan {
  readonly supplierId: string;
  readonly tenNhaCungCap: string;
  readonly soGoiMoi: number;
  readonly soGoiNop: number;
  readonly tyLePhanHoiPhanVan: number | null;
  readonly trungViPhanHoiGiay: number | null;
  readonly soLanSua: number;
  readonly soGoiXepHang: number;
  readonly hangTrungVi: number | null;
  readonly khoangCachTrungViPhanVan: number | null;
  readonly soLanVaoBafo: number;
  readonly soLanThang: number;
  readonly tyLeThangPhanVan: number | null;
  readonly chuaDuLichSu: readonly TruongDuoiSanMan[];
}

export interface BangHieuSuat {
  readonly sanLichSu: number;
  readonly nhaCungCap: readonly HieuSuatMan[];
  /** [lượt soi §S1.9101 THẤP-1] Số hàng sai hình dạng bị bỏ — màn nói ra, không để số nhà cung cấp và câu «chưa ai» nói sai. */
  readonly soHangBoQua: number;
}

const laSoDem = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** Số không âm hữu hạn hay `null`. Khoảng cách phần vạn là `numeric` ở CSDL và có thể vượt `Number.MAX_SAFE_INTEGER`. */
const laSoHoacNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/**
 * Đọc thân `GET /supplier-performance`. Thân sai hình dạng ⇒ `null` (màn nói không đọc được); một hàng sai hình dạng bị bỏ — màn không
 * vẽ thứ nó không hiểu.
 */
export function docHieuSuat(body: unknown): BangHieuSuat | null {
  const hs = (body as { hieuSuat?: unknown } | null)?.hieuSuat as Record<string, unknown> | null | undefined;
  if (hs === null || typeof hs !== "object") return null;
  if (!laSoDem(hs.sanLichSu) || hs.sanLichSu === 0 || !Array.isArray(hs.nhaCungCap)) return null;
  const ra: HieuSuatMan[] = [];
  const tatCa = hs.nhaCungCap as unknown[];
  for (const x of tatCa) {
    const h = x as Record<string, unknown> | null;
    if (h === null || typeof h !== "object") continue;
    if (typeof h.supplierId !== "string" || typeof h.tenNhaCungCap !== "string") continue;
    const dem = [h.soGoiMoi, h.soGoiNop, h.soLanSua, h.soGoiXepHang, h.soLanVaoBafo, h.soLanThang];
    if (!dem.every(laSoDem)) continue;
    const giaTri = [h.tyLePhanHoiPhanVan, h.trungViPhanHoiGiay, h.hangTrungVi, h.khoangCachTrungViPhanVan, h.tyLeThangPhanVan];
    if (!giaTri.every(laSoHoacNull) || !Array.isArray(h.chuaDuLichSu)) continue;
    const chuaDu = (h.chuaDuLichSu as unknown[]).filter((t): t is TruongDuoiSanMan => (TRUONG_DUOI_SAN as readonly unknown[]).includes(t));
    ra.push({
      supplierId: h.supplierId,
      tenNhaCungCap: h.tenNhaCungCap,
      soGoiMoi: h.soGoiMoi as number,
      soGoiNop: h.soGoiNop as number,
      tyLePhanHoiPhanVan: h.tyLePhanHoiPhanVan as number | null,
      trungViPhanHoiGiay: h.trungViPhanHoiGiay as number | null,
      soLanSua: h.soLanSua as number,
      soGoiXepHang: h.soGoiXepHang as number,
      hangTrungVi: h.hangTrungVi as number | null,
      khoangCachTrungViPhanVan: h.khoangCachTrungViPhanVan as number | null,
      soLanVaoBafo: h.soLanVaoBafo as number,
      soLanThang: h.soLanThang as number,
      tyLeThangPhanVan: h.tyLeThangPhanVan as number | null,
      chuaDuLichSu: chuaDu,
    });
  }
  return { sanLichSu: hs.sanLichSu, nhaCungCap: ra, soHangBoQua: tatCa.length - ra.length };
}

/**
 * Nhóm nghìn bằng dấu chấm, kiểu Việt Nam — vòng lặp trên chữ số, không qua `Intl` (kết quả không phụ thuộc bộ ICU của trình duyệt)
 * và không chép biểu thức nhóm nghìn của `tools/pilot-gia-lap` (cổng `ma-chep-api-worker`).
 */
function nhomNghin(n: number): string {
  const chuSo = String(n);
  let ra = "";
  for (let i = 0; i < chuSo.length; i += 1) {
    if (i > 0 && (chuSo.length - i) % 3 === 0) ra += ".";
    ra += chuSo[i] ?? "";
  }
  return ra;
}

/**
 * Phần vạn thành phần trăm, dấu phẩy thập phân, bỏ số 0 thừa: 10000 ⇒ "100%", 6667 ⇒ "66,67%", 1250 ⇒ "12,5%".
 *
 * Khoảng cách là `numeric` ở CSDL (ADR-163, lượt soi THẤP-6: một giá 0,01 cạnh chi phí 10 nghìn tỷ cho 9 999 999 999 999 990 000 phần
 * vạn) và đi qua JSON thành một `double`: trên `Number.MAX_SAFE_INTEGER` các chữ số cuối đã không còn là chữ số của CSDL, nên màn nói
 * cận dưới thay vì in một con số trông chính xác mà sai.
 */
export function phanTramTuPhanVan(phanVan: number): string {
  if (!Number.isSafeInteger(phanVan)) return `hơn ${phanTramTuPhanVan(Number.MAX_SAFE_INTEGER)}`;
  const nguyen = nhomNghin(Math.floor(phanVan / 100));
  const le = phanVan % 100;
  if (le === 0) return `${nguyen}%`;
  return le % 10 === 0 ? `${nguyen},${String(le / 10)}%` : `${nguyen},${String(le).padStart(2, "0")}%`;
}

/** Giây thành thời lượng đọc được, hai đơn vị lớn nhất: 45 ⇒ "45 giây", 7500 ⇒ "2 giờ 5 phút", 93600 ⇒ "1 ngày 2 giờ". */
export function thoiLuongGiay(giay: number): string {
  const g = Math.max(0, Math.trunc(giay));
  const hai = (lon: number, tenLon: string, nho: number, tenNho: string): string =>
    nho === 0 ? `${String(lon)} ${tenLon}` : `${String(lon)} ${tenLon} ${String(nho)} ${tenNho}`;
  if (g < 60) return `${String(g)} giây`;
  if (g < 3600) return hai(Math.floor(g / 60), "phút", g % 60, "giây");
  if (g < 86400) return hai(Math.floor(g / 3600), "giờ", Math.floor((g % 3600) / 60), "phút");
  return hai(Math.floor(g / 86400), "ngày", Math.floor((g % 86400) / 3600), "giờ");
}

/** Một ô của bảng: nhãn cột (cũng là `data-nhan` trên màn hẹp) và chữ của ô. */
export interface OHieuSuat {
  readonly nhan: string;
  readonly noiDung: string;
}

/** Nhãn mười hai cột, theo thứ tự của bảng — `hieu-suat.html` khai `<th>` đúng thứ tự này. */
export const COT_HIEU_SUAT = [
  "Nhà cung cấp",
  "Được mời",
  "Đã nộp",
  "Tỷ lệ phản hồi",
  "Phản hồi trung vị",
  "Lần sửa báo giá",
  "Gói xếp hạng",
  "Hạng trung vị",
  "Cách hạng nhất (trung vị)",
  "Vào BAFO",
  "Thắng",
  "Tỷ lệ thắng",
] as const;

/**
 * Mười hai ô của một nhà cung cấp. Trường máy chủ giữ lại dưới sàn ⇒ *"chưa đủ lịch sử (m/s gói)"* — `m` là mẫu số của CHÍNH chỉ số ấy
 * (gói được mời, gói đã nộp, gói xếp hạng), `s` là sàn. Trường không bị giữ mà vẫn rỗng (mọi lượt có chi phí hạng nhất bằng 0) ⇒ "—".
 */
export function oCuaHang(h: HieuSuatMan, san: number): OHieuSuat[] {
  const duoiSan = (t: TruongDuoiSanMan): boolean => h.chuaDuLichSu.includes(t);
  const chuaDu = (mau: number): string => `chưa đủ lịch sử (${String(mau)}/${String(san)} gói)`;
  const o = (i: number, noiDung: string): OHieuSuat => ({ nhan: COT_HIEU_SUAT[i] ?? "", noiDung });
  const chiSo = (t: TruongDuoiSanMan, mau: number, giaTri: number | null, chu: (v: number) => string): string =>
    duoiSan(t) ? chuaDu(mau) : giaTri === null ? "—" : chu(giaTri);
  return [
    o(0, h.tenNhaCungCap),
    o(1, `${String(h.soGoiMoi)} gói`),
    o(2, `${String(h.soGoiNop)} gói`),
    o(3, chiSo("tyLePhanHoiPhanVan", h.soGoiMoi, h.tyLePhanHoiPhanVan, phanTramTuPhanVan)),
    o(4, chiSo("trungViPhanHoiGiay", h.soGoiNop, h.trungViPhanHoiGiay, thoiLuongGiay)),
    o(5, String(h.soLanSua)),
    o(6, `${String(h.soGoiXepHang)} gói`),
    o(7, chiSo("hangTrungVi", h.soGoiXepHang, h.hangTrungVi, (v) => `hạng ${String(v)}`)),
    o(8, chiSo("khoangCachTrungViPhanVan", h.soGoiXepHang, h.khoangCachTrungViPhanVan,
      (v) => (v === 0 ? "bằng hạng nhất" : `chi phí cao hơn hạng nhất ${phanTramTuPhanVan(v)}`))),
    o(9, `${String(h.soLanVaoBafo)} lần`),
    o(10, `${String(h.soLanThang)} gói`),
    o(11, chiSo("tyLeThangPhanVan", h.soGoiXepHang, h.tyLeThangPhanVan, phanTramTuPhanVan)),
  ];
}

/**
 * Câu tóm tắt trên bảng: bao nhiêu nhà cung cấp, sàn bao nhiêu, bao nhiêu người đủ lịch sử ở mọi chỉ số — và bao nhiêu hàng sai hình
 * dạng không hiện.
 */
export function tomTat(b: BangHieuSuat): string {
  const boQua = b.soHangBoQua > 0 ? ` ${String(b.soHangBoQua)} hàng của bảng vừa nhận sai hình dạng nên không hiện.` : "";
  if (b.nhaCungCap.length === 0) {
    if (b.soHangBoQua > 0) return `Không hàng nào hiện được.${boQua}`;
    return "Chưa nhà cung cấp nào có gói đã mở niêm phong trong tổ chức — bảng trống cho tới khi một gói được mở niêm phong.";
  }
  const du = b.nhaCungCap.filter((h) => h.chuaDuLichSu.length === 0).length;
  return `${String(b.nhaCungCap.length)} nhà cung cấp có gói đã mở niêm phong; ${String(du)} người đủ ${String(b.sanLichSu)} gói ở mọi ` +
    `chỉ số. Tỷ lệ và trung vị của người dưới sàn hiện «chưa đủ lịch sử»; số đếm luôn hiện.${boQua}`;
}
