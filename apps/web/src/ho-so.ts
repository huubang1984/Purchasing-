// ==============================================================================================
// [S1.287 / S3.7a1 / ADR-081] HÀM THUẦN CỦA MÀN `/ho-so` — HỒ SƠ PASSPORT CỦA NHÀ CUNG CẤP
//
// Máy chủ gỡ kiểu và phục vụ tệp này ở `/lib/ho-so.js` (`MODULE_WEB`); trang `trang/ho-so.js` import nó. Kiểm ở đây là để nói
// sớm với người gõ trên điện thoại — máy chủ (`docHoSoPassportNhap`, `packages/supplier`) và CHECK của CSDL mới là thẩm quyền.
// Không chạm DOM, không gọi mạng.
// ==============================================================================================

/** Trần số mục của chứng nhận và nhóm hàng — bằng `TRAN_DANH_SACH_PASSPORT` của `packages/supplier`. */
export const TRAN_DANH_SACH_HO_SO = 20;

export interface HoSoNhap {
  readonly legalName: string;
  readonly taxCode: string;
  readonly nguoiDaiDien: string;
  readonly diaChi: string;
  readonly nganHang: string;
  readonly soTaiKhoan: string;
  readonly chungNhan: readonly string[];
  readonly nhomHang: readonly string[];
}

/** Các ô của form, đúng như người gõ để lại. */
export interface ONhap {
  readonly legalName: string;
  readonly taxCode: string;
  readonly nguoiDaiDien: string;
  readonly diaChi: string;
  readonly nganHang: string;
  readonly soTaiKhoan: string;
  readonly chungNhan: string;
  readonly nhomHang: string;
}

const MST = /^[0-9]{10}(-[0-9]{3})?$/u;
const SO_TAI_KHOAN = /^[0-9]{6,20}$/u;

function doDaiByte(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Một mục mỗi dòng; dòng trống bỏ. */
export function tachDanhSach(chu: string): string[] {
  return chu
    .replaceAll("\r", "")
    .split("\n")
    .map((d) => d.trim())
    .filter((d) => d !== "");
}

/** Số tài khoản như người gõ (có thể có dấu cách, chấm, gạch) → chỉ chữ số — cùng phép chuẩn hoá của máy chủ. */
export function chuanHoaSoTaiKhoan(chu: string): string {
  return chu.replace(/[\s.-]/gu, "");
}

/**
 * Kiểm form trước khi gửi. Trả câu lỗi đầu tiên (gọi tên Ô, không nhắc lại giá trị) hay thân yêu cầu. Thứ tự là thứ tự ô trên
 * màn — người gõ sửa từ trên xuống.
 */
export function kiemHoSo(o: ONhap): { readonly loi: string; readonly than: null } | { readonly loi: null; readonly than: HoSoNhap } {
  const truong: readonly (readonly [string, string, number])[] = [
    [o.legalName.trim(), "tên pháp lý", 500],
    [o.taxCode.trim(), "mã số thuế", 14],
    [o.nguoiDaiDien.trim(), "người đại diện", 200],
    [o.diaChi.trim(), "địa chỉ", 1000],
    [o.nganHang.trim(), "ngân hàng", 200],
  ];
  for (const [giaTri, nhan, tran] of truong) {
    if (giaTri === "") return { loi: `Thiếu ${nhan}.`, than: null };
    if (doDaiByte(giaTri) > tran) return { loi: `${nhan[0]!.toUpperCase()}${nhan.slice(1)} dài quá.`, than: null };
  }
  if (!MST.test(o.taxCode.trim())) return { loi: "Mã số thuế phải là 10 chữ số, hay 10 chữ số kèm -XXX.", than: null };
  const soTaiKhoan = chuanHoaSoTaiKhoan(o.soTaiKhoan);
  if (!SO_TAI_KHOAN.test(soTaiKhoan)) return { loi: "Số tài khoản phải gồm 6–20 chữ số.", than: null };
  const chungNhan = tachDanhSach(o.chungNhan);
  const nhomHang = tachDanhSach(o.nhomHang);
  for (const [ds, nhan] of [[chungNhan, "chứng nhận"], [nhomHang, "nhóm hàng"]] as const) {
    if (ds.length > TRAN_DANH_SACH_HO_SO) return { loi: `Tối đa ${String(TRAN_DANH_SACH_HO_SO)} mục ${nhan}.`, than: null };
    if (ds.some((m) => doDaiByte(m) > 200)) return { loi: `Một mục ${nhan} dài quá.`, than: null };
  }
  return {
    loi: null,
    than: {
      legalName: o.legalName.trim(),
      taxCode: o.taxCode.trim(),
      nguoiDaiDien: o.nguoiDaiDien.trim(),
      diaChi: o.diaChi.trim(),
      nganHang: o.nganHang.trim(),
      soTaiKhoan,
      chungNhan,
      nhomHang,
    },
  };
}

/** Bốn số cuối đã che — thứ duy nhất của số tài khoản máy chủ trả về cho phiên Passport. */
export function cheSoTaiKhoan(cuoi: unknown): string {
  return typeof cuoi === "string" && /^[0-9]{1,4}$/u.test(cuoi) ? `•••• ${cuoi}` : "—";
}

/** Các dòng của bảng tóm tắt phiên bản đã nộp (`GET /passport` → `phienBanMoiNhat`). Giá trị lạ hiện `—`, không ném. */
export function dongPhienBan(pb: unknown): (readonly [string, string])[] {
  if (pb === null || typeof pb !== "object") return [];
  const x = pb as Record<string, unknown>;
  const chu = (v: unknown): string => (typeof v === "string" && v !== "" ? v : "—");
  const ds = (v: unknown): string => (Array.isArray(v) && v.length > 0 ? v.filter((m) => typeof m === "string").join("; ") : "—");
  return [
    ["Phiên bản", typeof x.thuTu === "number" ? `#${String(x.thuTu)}` : "—"],
    ["Tên pháp lý", chu(x.legalName)],
    ["Mã số thuế", chu(x.taxCode)],
    ["Người đại diện", chu(x.nguoiDaiDien)],
    ["Địa chỉ", chu(x.diaChi)],
    ["Ngân hàng", chu(x.nganHang)],
    ["Số tài khoản", cheSoTaiKhoan(x.soTaiKhoanCuoi)],
    ["Chứng nhận", ds(x.chungNhan)],
    ["Nhóm hàng", ds(x.nhomHang)],
  ];
}
