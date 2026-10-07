// ==============================================================================================
// [S1.9101 / S4.7a / L8] TCO — TẬP MÃ CÓ NGUỒN, LUẬT KIỂM PHIÊN BẢN LÚC CHẤM, VÀ HAI CÔNG THỨC QUY ĐỔI. HÀM THUẦN.
//
// Spec S4 §4.8, §2.4 ⑻, §2.5 ⒃; ADR-9201. Mỗi mã `TIEN` có ĐÚNG MỘT nguồn đọc được — một ô nhà cung cấp khai trong phong bì (qua
// bộ đọc SQL, `luot-danh-gia.ts`), hay một quy đổi từ ô khai theo tham số của phiên bản chính sách ghim:
//
//   `gia`                 ← `totalAmount`                                                     (như hôm nay)
//   `van_chuyen`          ← `freight`
//   `nhap_khau`           ← `importCost`
//   `chi_phi_thanh_toan`  ← max(0, ngay_thanh_toan_chuan − paymentDays) × chi_phi_von_nam / 365 × totalAmount
//   `chi_phi_tre`         ← max(0, leadTimeDays − số ngày giao yêu cầu của GÓI) × ty_le_tre_ngay × totalAmount
//
// Chủ dự án chốt 2026-10-07: chi phí trễ là TỶ LỆ của giá trị báo giá mỗi ngày, không một số tiền cố định — nó không phụ thuộc
// đơn vị tiền, và cùng cách hợp đồng viết phạt chậm giao. `chat_luong` không có nguồn tới S5 (tỷ lệ lỗi từ GRN); `thue` bị bỏ
// (ADR-097 ⑻: thuế GTGT khấu trừ được không phải chi phí). `DIEM` vẫn không có nguồn (chưa có màn chấm điểm).
//
// KIỂM LÚC CHẤM, KHÔNG BẰNG `CHECK` (spec §2.5 ⒃): mã có nguồn, `he_so` của mã `TIEN` bằng "1" — tiền là tiền, V2.1 §16 là một phép
// CỘNG, và một hệ số "5" trên `van_chuyen` là một cần gạt thứ hạng —, đủ tham số quy đổi. Không lấy `0` cho thứ thiếu (ADR-053 ⑶).
//
// LÀM TRÒN: mỗi thành phần quy đổi làm tròn ĐÚNG MỘT LẦN về hai chữ số lẻ, nửa-ra-xa-0 (luật của `chi-phi-hieu-dung.ts`), trên
// một phép tính CHÍNH XÁC bằng `bigint` — tỷ lệ là chuỗi, không một `number` nào chạm vào tiền. Rồi `tinhChiPhiHieuDung` cộng.
// ==============================================================================================

import { docSo, vietSo, type DauVao, type ThanhPhanChinhSach } from "./chi-phi-hieu-dung.js";

export const MA_GIA = "gia";
export const MA_VAN_CHUYEN = "van_chuyen";
export const MA_NHAP_KHAU = "nhap_khau";
export const MA_CHI_PHI_THANH_TOAN = "chi_phi_thanh_toan";
export const MA_CHI_PHI_TRE = "chi_phi_tre";

/** Mọi mã có nguồn — đúng bảng của spec §4.8 sau ADR-097 ⑻. */
export const MA_CO_NGUON: readonly string[] = [MA_GIA, MA_VAN_CHUYEN, MA_NHAP_KHAU, MA_CHI_PHI_THANH_TOAN, MA_CHI_PHI_TRE];

/** Mã V2.1 §16 có tên mà không có nguồn — mỗi mã một câu nói vì sao. */
export const MA_KHONG_NGUON: Readonly<Record<string, string>> = {
  chat_luong: "chi phí chất lượng cần tỷ lệ lỗi từ phiếu nhập kho (GRN), chưa có nguồn dữ liệu tới S5",
  thue: "thuế GTGT khấu trừ được không phải chi phí, và mã này đã bị bỏ (ADR-097 ⑻)",
};

/** Số chữ số lẻ tối đa của hai tỷ lệ — khớp `CHECK` `org_procurement_policies_tco_hinh_dang`. */
export const SO_LE_CHI_PHI_VON = 4;
export const SO_LE_TY_LE_TRE = 6;

/** Nhóm khoá `tco` của phiên bản ghim — chuỗi nguyên văn như CSDL cất; `null` cho khoá vắng. */
export interface ThamSoTco {
  readonly chiPhiVonNam: string | null;
  readonly ngayThanhToanChuan: string | null;
  readonly tyLeTreNgay: string | null;
}

export const THAM_SO_TRONG: ThamSoTco = { chiPhiVonNam: null, ngayThanhToanChuan: null, tyLeTreNgay: null };

/** Đọc cột `tco` (jsonb) — hình dạng đã do `CHECK` cưỡng chế; ở đây chỉ lấy ba chuỗi. */
export function docNhomTco(tho: unknown): ThamSoTco {
  if (tho === null || typeof tho !== "object" || Array.isArray(tho)) return THAM_SO_TRONG;
  const o = tho as Record<string, unknown>;
  const lay = (k: string): string | null => (typeof o[k] === "string" ? o[k] : null);
  return {
    chiPhiVonNam: lay("chi_phi_von_nam"),
    ngayThanhToanChuan: lay("ngay_thanh_toan_chuan"),
    tyLeTreNgay: lay("ty_le_tre_ngay"),
  };
}

export type LyDoChinhSachTco = "THANH_PHAN_CHUA_CO_NGUON" | "CHINH_SACH_TCO_SAI";

export interface LoiChinhSachTco {
  readonly lyDo: LyDoChinhSachTco;
  readonly ma: string | null;
  /** Câu người đọc được, gọi tên mã và chỗ hỏng — chưa gồm số phiên bản (tầng gói thêm). */
  readonly cau: string;
}

/**
 * Kiểm một phiên bản ghim có chấm được không (L8). Trả `null` khi được; ngược lại, lỗi ĐẦU TIÊN theo thứ tự của chính sách.
 *
 * Thứ tự kiểm: từng thành phần (đơn vị, mã có nguồn, trùng mã, hệ số), rồi có `gia` không, rồi tham số quy đổi. `soNgayGiao` là
 * của gói; cạnh mở đã đòi nó khi phiên bản ghim có `chi_phi_tre` (`9501` (5)), nên vế ấy ở đây chỉ là lớp thứ hai.
 */
export function kiemChinhSachTco(
  thanhPhan: readonly ThanhPhanChinhSach[],
  thamSo: ThamSoTco,
  soNgayGiao: number | null,
): LoiChinhSachTco | null {
  const daThay = new Set<string>();
  for (const c of thanhPhan) {
    if (c.donVi !== "TIEN") {
      return {
        lyDo: "THANH_PHAN_CHUA_CO_NGUON",
        ma: c.ma,
        cau: `thành phần "${c.ma}" là điểm phi giá (DIEM), mà chưa có màn chấm điểm nào cho nó`,
      };
    }
    const khongNguon = MA_KHONG_NGUON[c.ma];
    if (khongNguon !== undefined) {
      return { lyDo: "THANH_PHAN_CHUA_CO_NGUON", ma: c.ma, cau: `thành phần "${c.ma}" không chấm được: ${khongNguon}` };
    }
    if (!MA_CO_NGUON.includes(c.ma)) {
      return {
        lyDo: "THANH_PHAN_CHUA_CO_NGUON",
        ma: c.ma,
        cau: `thành phần "${c.ma}" không có nguồn dữ liệu; mã chấm được là ${MA_CO_NGUON.map((m) => `"${m}"`).join(", ")}`,
      };
    }
    if (daThay.has(c.ma)) {
      return { lyDo: "CHINH_SACH_TCO_SAI", ma: c.ma, cau: `thành phần "${c.ma}" khai hai lần` };
    }
    daThay.add(c.ma);
    const h = docSo(c.heSo, 4);
    if (h === null || h !== 10_000n) {
      return {
        lyDo: "CHINH_SACH_TCO_SAI",
        ma: c.ma,
        cau: `hệ số của thành phần tiền "${c.ma}" là "${c.heSo}", không phải 1 — tiền cộng với tiền, không nhân hệ số (L8)`,
      };
    }
  }
  if (!daThay.has(MA_GIA)) {
    return { lyDo: "CHINH_SACH_TCO_SAI", ma: null, cau: `không khai thành phần "${MA_GIA}" — chi phí hiệu dụng phải gồm giá` };
  }
  if (daThay.has(MA_CHI_PHI_THANH_TOAN) && (thamSo.chiPhiVonNam === null || thamSo.ngayThanhToanChuan === null)) {
    return {
      lyDo: "THANH_PHAN_CHUA_CO_NGUON",
      ma: MA_CHI_PHI_THANH_TOAN,
      cau: `thành phần "${MA_CHI_PHI_THANH_TOAN}" cần chi phí vốn một năm và kỳ thanh toán chuẩn ở nhóm khoá tco, mà phiên bản không khai`,
    };
  }
  if (daThay.has(MA_CHI_PHI_TRE) && thamSo.tyLeTreNgay === null) {
    return {
      lyDo: "THANH_PHAN_CHUA_CO_NGUON",
      ma: MA_CHI_PHI_TRE,
      cau: `thành phần "${MA_CHI_PHI_TRE}" cần tỷ lệ chi phí trễ mỗi ngày ở nhóm khoá tco, mà phiên bản không khai`,
    };
  }
  if (daThay.has(MA_CHI_PHI_TRE) && soNgayGiao === null) {
    return {
      lyDo: "THANH_PHAN_CHUA_CO_NGUON",
      ma: MA_CHI_PHI_TRE,
      cau: `thành phần "${MA_CHI_PHI_TRE}" cần số ngày giao yêu cầu của gói, mà gói không khai`,
    };
  }
  return null;
}

/** Ô khai của MỘT báo giá, đã qua bộ đọc SQL — `null` khi vắng hay ngoài miền. */
export interface OKhai {
  readonly tongTien: string | null;
  readonly phiVanChuyen: string | null;
  readonly chiPhiNhapKhau: string | null;
  readonly soNgayThanhToan: number | null;
  readonly soNgayGiaoKhai: number | null;
}

/** Đầu vào đã quy đổi cho `tinhChiPhiHieuDung`, cùng nguồn của từng mã quy đổi (để màn và bộ kiểm đọc lại được phép tính). */
export interface DauVaoTco {
  readonly dauVao: readonly DauVao[];
  readonly nguon: ReadonlyMap<string, Readonly<Record<string, string>>>;
}

/** Một báo giá thiếu ô — các mã không có giá trị đọc được, theo thứ tự của chính sách. */
export interface ThieuOKhai {
  readonly maThieu: readonly string[];
}

/** Chia `tu / mau` (cả hai không âm) và làm tròn nửa-ra-xa-0 về số nguyên. */
function chiaLamTron(tu: bigint, mau: bigint): bigint {
  return (2n * tu + mau) / (2n * mau);
}

function batBuoc(gt: bigint | null, ten: string): bigint {
  if (gt === null) throw new RangeError(`${ten} không đọc được — đầu vào phải đi qua bộ đọc SQL và CHECK của nhóm khoá tco`);
  return gt;
}

/**
 * `max(0, ngayChuan − ngayKhai) × tyLeNam / 365 × tong`, hai chữ số lẻ. `tong` ở tỉ lệ 10², `tyLeNam` ở 10⁴ ⇒ tích ở 10⁶; chia
 * cho `365 × 10⁴` ra tỉ lệ 10², làm tròn một lần.
 */
export function chiPhiThanhToan(tong: string, ngayChuan: number, ngayKhai: number, tyLeNam: string): string {
  const t = batBuoc(docSo(tong, 2), "tổng tiền");
  const r = batBuoc(docSo(tyLeNam, SO_LE_CHI_PHI_VON), "chi phí vốn");
  const d = BigInt(Math.max(0, ngayChuan - ngayKhai));
  return vietSo(chiaLamTron(d * r * t, 365n * 10n ** BigInt(SO_LE_CHI_PHI_VON)), 2);
}

/** `max(0, ngayKhai − ngayYeuCau) × tyLeNgay × tong`, hai chữ số lẻ. `tong` ở 10², `tyLeNgay` ở 10⁶ ⇒ tích ở 10⁸; thu về 10². */
export function chiPhiTre(tong: string, ngayYeuCau: number, ngayKhai: number, tyLeNgay: string): string {
  const t = batBuoc(docSo(tong, 2), "tổng tiền");
  const r = batBuoc(docSo(tyLeNgay, SO_LE_TY_LE_TRE), "tỷ lệ trễ");
  const d = BigInt(Math.max(0, ngayKhai - ngayYeuCau));
  return vietSo(chiaLamTron(d * r * t, 10n ** BigInt(SO_LE_TY_LE_TRE)), 2);
}

/**
 * Giá trị của từng mã cho MỘT báo giá. Phiên bản phải đã qua `kiemChinhSachTco` — hàm này không kiểm lại tham số.
 *
 * Mã nào không có giá trị đọc được thì báo giá ấy KHÔNG CÓ HẠNG, và mọi mã thiếu được gọi tên (spec §4.8). Mã quy đổi thiếu khi Ô
 * KHAI của chính nó thiếu; khi `totalAmount` không đọc được, `gia` thiếu và hai mã quy đổi không tính được — chúng không bị kể là
 * thiếu nếu ô của chính chúng có.
 */
export function dauVaoTco(
  thanhPhan: readonly ThanhPhanChinhSach[],
  thamSo: ThamSoTco,
  soNgayGiao: number | null,
  o: OKhai,
): DauVaoTco | ThieuOKhai {
  const maThieu: string[] = [];
  const dauVao: DauVao[] = [];
  const nguon = new Map<string, Readonly<Record<string, string>>>();
  for (const c of thanhPhan) {
    switch (c.ma) {
      case MA_GIA:
        if (o.tongTien === null) maThieu.push(c.ma);
        else dauVao.push({ ma: c.ma, giaTri: o.tongTien });
        break;
      case MA_VAN_CHUYEN:
        if (o.phiVanChuyen === null) maThieu.push(c.ma);
        else dauVao.push({ ma: c.ma, giaTri: o.phiVanChuyen });
        break;
      case MA_NHAP_KHAU:
        if (o.chiPhiNhapKhau === null) maThieu.push(c.ma);
        else dauVao.push({ ma: c.ma, giaTri: o.chiPhiNhapKhau });
        break;
      case MA_CHI_PHI_THANH_TOAN: {
        if (o.soNgayThanhToan === null) {
          maThieu.push(c.ma);
          break;
        }
        if (o.tongTien === null || thamSo.chiPhiVonNam === null || thamSo.ngayThanhToanChuan === null) break;
        const ngayChuan = Number(thamSo.ngayThanhToanChuan);
        dauVao.push({
          ma: c.ma,
          giaTri: chiPhiThanhToan(o.tongTien, ngayChuan, o.soNgayThanhToan, thamSo.chiPhiVonNam),
        });
        nguon.set(c.ma, {
          coSo: o.tongTien,
          ngayKhai: String(o.soNgayThanhToan),
          ngayChuan: thamSo.ngayThanhToanChuan,
          tyLe: thamSo.chiPhiVonNam,
        });
        break;
      }
      case MA_CHI_PHI_TRE: {
        if (o.soNgayGiaoKhai === null) {
          maThieu.push(c.ma);
          break;
        }
        if (o.tongTien === null || thamSo.tyLeTreNgay === null || soNgayGiao === null) break;
        dauVao.push({ ma: c.ma, giaTri: chiPhiTre(o.tongTien, soNgayGiao, o.soNgayGiaoKhai, thamSo.tyLeTreNgay) });
        nguon.set(c.ma, {
          coSo: o.tongTien,
          ngayKhai: String(o.soNgayGiaoKhai),
          ngayYeuCau: String(soNgayGiao),
          tyLe: thamSo.tyLeTreNgay,
        });
        break;
      }
      default:
        // `kiemChinhSachTco` đã từ chối mọi mã khác — tới đây là gọi sai thứ tự.
        throw new RangeError(`mã "${c.ma}" không có nguồn — gọi kiemChinhSachTco trước`);
    }
  }
  return maThieu.length > 0 ? { maThieu } : { dauVao, nguon };
}

export function laThieuOKhai(kq: DauVaoTco | ThieuOKhai): kq is ThieuOKhai {
  return "maThieu" in kq;
}
