// ==============================================================================================
// [S1.286 / S4.7b2] TCO Ở MÀN NỘP THẦU VÀ MÀN MỞ THẦU (spec S4 §4.8, §8.6, §8.13; ADR-156 ⑵ ⑶ ⑷; L16 vế form)
//
// Hai việc, mỗi việc một nửa của cùng một thước — thước lượt chấm dùng, chụp vào gói lúc mở (`112` (4), `117`):
//   · `/nop-thau`: đọc thước từ `GET /guest/rfq` (`tco`), hiện ĐÚNG ô của mã bật — bắt buộc trên form (chủ dự án chốt 2026-10-08:
//     không ai mất hạng vì sơ ý; không có phí thì ghi 0) — và nói bằng lời cách mỗi ô được quy đổi, với chính tham số ấy.
//   · `/mo-thau`: phép tính của mỗi mã quy đổi cạnh con số nó sinh ra (§8.6), mã thiếu của báo giá không hạng, và cột hạng giá.
// Phép tính THUẦN, `tsc` gác, `tco.test.ts` đo, phục vụ cho trình duyệt ở `/lib/tco.js` — khuôn `chinh-sach.ts`. Không luật nào ở đây
// là chốt: lượt chấm đọc phong bì bằng bộ đọc SQL (`bid_so_tien`, `bid_so_ngay`) và báo giá thiếu ô vẫn không có hạng (ADR-153 ⑷).
// ==============================================================================================

import { MA_TCO } from "./chinh-sach.js";
import { donGiaNguoiGo } from "./so-tien.js";

/** Thước TCO như `GET /guest/rfq` trả — tập mã theo thứ tự chính sách, tham số của mã bật (`null` khi không áp). */
export interface ThuocTco {
  readonly ma: readonly string[];
  readonly chiPhiVonNam: string | null;
  readonly ngayThanhToanChuan: string | null;
  readonly tyLeTreNgay: string | null;
}

const chuoiHoacNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Đọc `tco` của thân `GET /guest/rfq`; hình dạng lạ ⇒ `null` (màn chỉ còn ô giá — máy chủ vẫn là nơi chấm). */
export function docThuocTco(tco: unknown): ThuocTco | null {
  if (tco === null || typeof tco !== "object") return null;
  const t = tco as { ma?: unknown; thamSo?: unknown };
  if (!Array.isArray(t.ma) || !t.ma.every((m) => typeof m === "string")) return null;
  const ts = (t.thamSo ?? {}) as Record<string, unknown>;
  return {
    ma: t.ma,
    chiPhiVonNam: chuoiHoacNull(ts["chiPhiVonNam"]),
    ngayThanhToanChuan: chuoiHoacNull(ts["ngayThanhToanChuan"]),
    tyLeTreNgay: chuoiHoacNull(ts["tyLeTreNgay"]),
  };
}

/** Bốn ô khai của phong bì, mỗi ô thuộc đúng một mã (`luot-danh-gia.ts` đọc đúng bốn khoá này). */
export interface OCanKhai {
  readonly vanChuyen: boolean;
  readonly nhapKhau: boolean;
  readonly ngayThanhToan: boolean;
  readonly ngayGiao: boolean;
}

export function oCanKhai(t: ThuocTco | null): OCanKhai {
  const co = (m: string): boolean => t !== null && t.ma.includes(m);
  return { vanChuyen: co("van_chuyen"), nhapKhau: co("nhap_khau"), ngayThanhToan: co("chi_phi_thanh_toan"), ngayGiao: co("chi_phi_tre") };
}

/** Miền của ô số ngày — bản chép của `bid_so_ngay` (`112` (6)): số nguyên thập phân 0–3650, không số 0 đầu. */
export const SO_NGAY_KHAI_TOI_DA = 3650;

/** Ô số ngày người gõ → chuỗi chuẩn đi vào phong bì, hay `null` khi không đọc được. */
export function docSoNgayKhai(chuoi: string): string | null {
  const s = chuoi.trim();
  if (!/^(0|[1-9][0-9]{0,3})$/u.test(s)) return null;
  return Number(s) <= SO_NGAY_KHAI_TOI_DA ? s : null;
}

/**
 * Ô tiền người gõ → chuỗi chuẩn, hay `null`. Cùng quy ước với ô đơn giá (`donGiaNguoiGo`): số nguyên đơn vị tiền, dấu chấm chỉ để
 * nhóm nghìn; bỏ số 0 đầu; tối đa 16 chữ số — miền tiền của lượt chấm (`numeric(18, 2)`).
 */
export function docTienKhai(chuoi: string): string | null {
  const s = donGiaNguoiGo(chuoi);
  if (s === null) return null;
  const chuan = BigInt(s).toString();
  return chuan.length <= 16 ? chuan : null;
}

/** Bốn ô như người gõ. */
export interface OKhai {
  readonly vanChuyen: string;
  readonly nhapKhau: string;
  readonly ngayThanhToan: string;
  readonly ngayGiao: string;
}

/**
 * Câu cho ô ĐẦU TIÊN còn trống hay không đọc được trong các ô cần khai; `null` khi đủ. Ô bắt buộc trên form (ADR-156 ⑶) — lượt chấm
 * vẫn xử báo giá thiếu ô là không hạng, nên câu nói rõ hậu quả.
 */
export function loiOKhai(can: OCanKhai, o: OKhai): string | null {
  const truong: readonly (readonly [boolean, string, string, (s: string) => string | null, string])[] = [
    [can.vanChuyen, o.vanChuyen, "Phí vận chuyển", docTienKhai, "số nguyên đơn vị tiền, dấu chấm chỉ nhóm nghìn"],
    [can.nhapKhau, o.nhapKhau, "Chi phí nhập khẩu", docTienKhai, "số nguyên đơn vị tiền, dấu chấm chỉ nhóm nghìn"],
    [can.ngayThanhToan, o.ngayThanhToan, "Số ngày thanh toán", docSoNgayKhai, "số ngày nguyên từ 0 đến 3650"],
    [can.ngayGiao, o.ngayGiao, "Số ngày giao hàng", docSoNgayKhai, "số ngày nguyên từ 0 đến 3650"],
  ];
  for (const [can_, go, ten, doc, mau] of truong) {
    if (!can_) continue;
    if (go.trim() === "") {
      return `${ten} là ô bắt buộc của gói này — không có khoản ấy thì ghi 0. Thiếu ô thì báo giá không được xếp hạng.`;
    }
    if (doc(go) === null) return `${ten} "${go.trim()}" không đọc được: ${mau}.`;
  }
  return null;
}

/** Trường của phong bì cho các ô cần khai — chuỗi chuẩn; ô không cần khai thì không có khoá. Gọi SAU `loiOKhai` im. */
export function truongKhai(can: OCanKhai, o: OKhai): Readonly<Record<string, string>> {
  const ra: Record<string, string> = {};
  const lay = (v: string | null, k: string): void => {
    if (v !== null) ra[k] = v;
  };
  if (can.vanChuyen) lay(docTienKhai(o.vanChuyen), "freight");
  if (can.nhapKhau) lay(docTienKhai(o.nhapKhau), "importCost");
  if (can.ngayThanhToan) lay(docSoNgayKhai(o.ngayThanhToan), "paymentDays");
  if (can.ngayGiao) lay(docSoNgayKhai(o.ngayGiao), "leadTimeDays");
  return ra;
}

/** Lời cho nhà cung cấp: cách mỗi ô được quy đổi, với CHÍNH tham số của thước — rỗng khi gói chỉ chấm theo giá. */
export function moTaQuyDoi(t: ThuocTco | null, soNgayGiao: number | null): readonly string[] {
  const can = oCanKhai(t);
  if (t === null || (!can.vanChuyen && !can.nhapKhau && !can.ngayThanhToan && !can.ngayGiao)) return [];
  const ra = [
    "Bên mua xếp hạng báo giá theo tổng chi phí — tổng báo giá cộng các khoản dưới đây — tính theo lời khai của anh/chị. Mọi ô dưới đây " +
      "bắt buộc; không có khoản nào thì ghi 0.",
  ];
  if (can.vanChuyen || can.nhapKhau) ra.push("Phí vận chuyển và chi phí nhập khẩu được cộng nguyên vào tổng để so sánh.");
  if (can.ngayThanhToan) {
    ra.push(
      `Chi phí thanh toán: kỳ thanh toán chuẩn của bên mua là ${t.ngayThanhToanChuan ?? "—"} ngày. Mỗi ngày anh/chị đòi được trả SỚM hơn ` +
        `kỳ ấy được quy thành chi phí vốn ${t.chiPhiVonNam ?? "—"} một năm ÷ 365 × tổng báo giá, cộng vào tổng. Trả muộn hơn không được trừ.`,
    );
  }
  if (can.ngayGiao) {
    ra.push(
      `Chi phí trễ giao: số ngày giao yêu cầu là ${soNgayGiao === null ? "—" : String(soNgayGiao)} ngày. Mỗi ngày anh/chị giao MUỘN hơn ` +
        `được quy thành ${t.tyLeTreNgay ?? "—"} × tổng báo giá, cộng vào tổng. Giao sớm hơn không được trừ.`,
    );
  }
  return ra;
}

// ---------------------------------------------------------------------------------------------
// `/mo-thau` — phép tính cạnh con số (§8.6), mã thiếu, cột hạng giá
// ---------------------------------------------------------------------------------------------

/** Tên của một mã trên màn — tên của `MA_TCO`, mã lạ giữ nguyên. */
export function tenMa(ma: string): string {
  return MA_TCO.find((m) => m.ma === ma)?.ten ?? ma;
}

/** Một thành phần như `GET /rfqs/:rfqId/ranking` trả. */
export interface ThanhPhanXepHang {
  readonly ma: string;
  readonly donVi: string;
  readonly heSo: string | null;
  readonly giaTri: string | null;
  readonly tien: string | null;
  readonly nguon?: Readonly<Record<string, string>>;
}

/**
 * Một thành phần thành chữ. Mã QUY ĐỔI mang phép tính với chính tham số của phiên bản ghim (§8.6 — *"phần nào là số đo, phần nào là
 * số khai"*); mã khai thẳng giữ đúng dạng cũ — số nguyên văn, không làm tròn (dấu vết kiểm toán, J2).
 */
export function moTaThanhPhan(t: ThanhPhanXepHang, phienBan: number | null): string {
  const pb = phienBan === null ? "" : ` — tham số của chính sách phiên bản ${String(phienBan)}`;
  const n = t.nguon;
  if (n !== undefined && t.ma === "chi_phi_thanh_toan") {
    return `${tenMa(t.ma)} = max(0, kỳ chuẩn ${n["ngayChuan"] ?? "—"} − ${n["ngayKhai"] ?? "—"} ngày khai) × ${n["tyLe"] ?? "—"}/năm ÷ 365 × ` +
      `${n["coSo"] ?? "—"} = ${t.tien ?? "—"}${pb}`;
  }
  if (n !== undefined && t.ma === "chi_phi_tre") {
    return `${tenMa(t.ma)} = max(0, ${n["ngayKhai"] ?? "—"} ngày khai − ${n["ngayYeuCau"] ?? "—"} ngày yêu cầu) × ${n["tyLe"] ?? "—"}/ngày × ` +
      `${n["coSo"] ?? "—"} = ${t.tien ?? "—"}${pb}`;
  }
  return `${t.ma} · ${t.giaTri ?? "—"} × ${t.heSo ?? "—"} = ${t.tien ?? "—"} (${t.donVi})`;
}

/** Mã thiếu của một báo giá không hạng, gọi tên (`ma_thieu`); `TONG_VUOT_MIEN` là tổng vượt miền tiền. */
export function moTaMaThieu(maThieu: readonly string[]): string {
  const ten = maThieu.map((m) => (m === "TONG_VUOT_MIEN" ? "tổng vượt miền tiền" : `${tenMa(m)} (${m})`));
  return `không hạng — thiếu: ${ten.join(", ")}`;
}

/**
 * Bảng có thước TCO (một mã ngoài giá, hay một hàng thiếu ô của mã NGOÀI giá) ⇒ màn hiện cột hạng giá và câu *"theo lời khai"*.
 * [rà soát §S1.286 — THẤP-4] Phiên bản chỉ giá cũng ghi `ma_thieu` `["gia"]` cho báo giá không đọc được tổng — bảng ấy vẫn là bảng chỉ giá.
 */
export function coThuocTco(rows: readonly { readonly components?: readonly { readonly ma: string }[]; readonly maThieu?: unknown }[]): boolean {
  return rows.some(
    (r) => (r.components ?? []).some((c) => c.ma !== "gia") || (Array.isArray(r.maThieu) && r.maThieu.some((m) => m !== "gia")),
  );
}

// ---------------------------------------------------------------------------------------------
// [S1.288 / S4.7c1 / L8] Đề xuất trao thầu — ô giải trình lệch hạng và cam kết TCO (spec S4 §2.4 ⑻, §4.8)
// ---------------------------------------------------------------------------------------------

/** Một hàng của bảng xếp hạng như màn giữ — đủ để biết hai hạng của báo giá được chọn. */
export interface HaiHang {
  readonly rank: number | null;
  readonly hangGia?: number | null;
}

/**
 * Báo giá này có hạng giá khác hạng chi phí — màn đòi ô giải trình trước khi gửi. Cùng phép so của `award_kiem_giai_trinh`
 * (`IS DISTINCT FROM`, hạng giá vắng là `null`); CSDL vẫn là nơi phán, câu này chỉ để người đề xuất không phải gửi hai lần.
 * Báo giá không hạng không đề xuất được (J5), nên không đòi gì.
 */
export function canGiaiTrinh(h: HaiHang | null): boolean {
  if (h === null || h.rank === null) return false;
  return (h.hangGia ?? null) !== h.rank;
}

/** Cam kết TCO như `GET /rfqs/:rfqId/award/commitment` trả (phần màn đọc). */
export interface CamKetHien {
  readonly hangTco: number;
  readonly hangGia: number | null;
  readonly khai: {
    readonly freight: string | null;
    readonly importCost: string | null;
    readonly paymentDays: number | null;
    readonly leadTimeDays: number | null;
  };
  readonly tapMa: readonly string[] | null;
  readonly soNgayGiao: number | null;
  readonly giaiTrinhLechHang: string | null;
}

/**
 * Cam kết thành các dòng nhãn — giá trị: hai hạng lúc đề xuất, lời khai của ĐÚNG các mã bật (ô của mã không bật không có nghĩa
 * gì ở gói này), và lời giải trình. Lời khai giữ nguyên văn như CSDL chụp (hai chữ số lẻ của bộ đọc tiền); `—` khi ô vắng hay không
 * đọc được.
 */
export function moTaCamKet(k: CamKetHien): readonly (readonly [string, string])[] {
  const ma = k.tapMa ?? [];
  const so = (v: number | null): string => (v === null ? "—" : String(v));
  const ra: (readonly [string, string])[] = [
    ["Hạng lúc đề xuất", `chi phí hiệu dụng ${String(k.hangTco)} · giá ${so(k.hangGia)}`],
  ];
  const khai: string[] = [];
  if (ma.includes("van_chuyen")) khai.push(`phí vận chuyển ${k.khai.freight ?? "—"}`);
  if (ma.includes("nhap_khau")) khai.push(`chi phí nhập khẩu ${k.khai.importCost ?? "—"}`);
  if (ma.includes("chi_phi_thanh_toan")) khai.push(`số ngày thanh toán ${so(k.khai.paymentDays)}`);
  if (ma.includes("chi_phi_tre")) {
    khai.push(`số ngày giao ${so(k.khai.leadTimeDays)} (yêu cầu ${so(k.soNgayGiao)})`);
  }
  ra.push(["Lời khai cam kết", khai.length === 0 ? "gói chấm theo giá — không lời khai ngoài giá" : khai.join(" · ")]);
  ra.push([
    "Giải trình lệch hạng",
    k.giaiTrinhLechHang ?? (k.hangGia === k.hangTco ? "không lệch hạng — không cần giải trình" : "—"),
  ]);
  return ra;
}
