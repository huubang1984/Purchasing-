// ==============================================================================================
// [S1.201 / S3.6a] NHÓM HÀNG — PHÉP TÍNH CỦA HAI MÀN
//
// Spec S3 §4.3: nhóm hàng là KHOÁ của tín hiệu chia nhỏ (K10, S3.6b). Chủ dự án chốt ngày 2026-09-29: nhóm hàng bắt buộc để
// rời DRAFT ở tổ chức đã bật; nhóm hàng chỉ tạo, ngừng dùng và dùng lại — mã và tên không sửa; người giữ `category.manage`
// (FINANCE) quản lý ở màn riêng `/nhom-hang`, còn `/tao-thau` có ô chọn ở bước gói thầu, chỉ ở tổ chức đã bật.
//
// Phép tính THUẦN trên dữ liệu máy chủ trả về — `tsc` gác, `nhom-hang.test.ts` đo, phục vụ cho trình duyệt ở
// `/lib/nhom-hang.js` (khuôn `tao-thau.ts`). Không luật nào ở đây là chốt: mã hợp lệ, nhóm còn dùng và chốt nộp duyệt nằm ở
// CSDL (`085_nhom_hang`) và hàm gói; màn chỉ nói trước điều máy chủ sẽ nói.
// ==============================================================================================

/** Một nhóm hàng như `GET /categories` trả — chỉ bốn trường màn đọc. */
export interface NhomHangMan {
  readonly id: string;
  readonly ma: string;
  readonly ten: string;
  readonly conDung: boolean;
}

/** Đọc thân `GET /categories`. Phần tử sai hình dạng bị bỏ — màn không vẽ thứ nó không hiểu. */
export function docNhomHang(body: unknown): NhomHangMan[] {
  const ds = (body as { nhomHang?: unknown } | null)?.nhomHang;
  if (!Array.isArray(ds)) return [];
  const ra: NhomHangMan[] = [];
  for (const x of ds as unknown[]) {
    const n = x as Partial<Record<keyof NhomHangMan, unknown>> | null;
    if (n === null || typeof n !== "object") continue;
    if (typeof n.id !== "string" || typeof n.ma !== "string" || typeof n.ten !== "string" || typeof n.conDung !== "boolean") continue;
    ra.push({ id: n.id, ma: n.ma, ten: n.ten, conDung: n.conDung });
  }
  return ra;
}

/** Mã như máy chủ sẽ lưu: cắt khoảng trắng, viết hoa — `thep` và `THEP` là một mã. */
export function chuanMa(ma: string): string {
  return ma.trim().toUpperCase();
}

/** Khuôn của `CHECK` ở `085_nhom_hang` — máy chủ vẫn là nơi phán, màn chỉ nói trước. */
const MA_HOP_LE = /^[A-Z0-9][A-Z0-9_.-]{0,31}$/u;

/** `null` khi mã (đã chuẩn hoá) hợp lệ; câu nói vì sao khi không. */
export function loiMa(ma: string): string | null {
  const m = chuanMa(ma);
  if (m === "") return "Nhập mã nhóm hàng.";
  if (!MA_HOP_LE.test(m)) return "Mã gồm chữ không dấu, số và _ . -, bắt đầu bằng chữ hoặc số, tối đa 32 ký tự.";
  return null;
}

export function nhanTrangThaiNhom(conDung: boolean): string {
  return conDung ? "đang dùng" : "đã ngừng dùng";
}

/** Nút của một dòng: nhóm đang dùng thì ngừng dùng, đã ngừng thì dùng lại — `conDungMoi` là giá trị gửi lên máy chủ. */
export function nutDoiTrangThai(conDung: boolean): { readonly nhan: string; readonly conDungMoi: boolean } {
  return conDung ? { nhan: "Ngừng dùng", conDungMoi: false } : { nhan: "Dùng lại", conDungMoi: true };
}

/**
 * Lựa chọn của ô chọn nhóm hàng ở `/tao-thau`: một dòng trống, rồi các nhóm CÒN DÙNG theo thứ tự máy chủ trả (theo mã). Nhóm
 * mà gói đang giữ mà đã ngừng dùng vẫn hiện, có nhãn — ngừng dùng chỉ chặn lần gán mới, gói đang giữ nó vẫn nộp duyệt được.
 * [S1.9101 / S4.8] Cùng ô ở `/du-lieu` cho hàng chuẩn, nơi dòng trống là một lựa chọn (*"không nhóm hàng"* — cột tuỳ chọn): nhãn
 * của nó là tham số. Luật nhóm đã ngừng giữ nguyên — CSDL cho giữ đúng nhóm của phiên bản trước. Nhóm đang chọn mà KHÔNG có trong danh
 * sách (đọc nhóm hàng hỏng, hay danh sách cũ hơn lần gán) vẫn là một lựa chọn, nhãn nói không đọc được: thiếu nó, trình duyệt để ô trống
 * và phiên bản bản-chụp-đầy-đủ kế tiếp lặng lẽ bỏ nhóm (rà soát §S1.9101 — TRUNG-1).
 */
export function luaChonNhomHang(
  ds: readonly NhomHangMan[],
  dangChon: string | null,
  nhanTrong = "— chọn nhóm hàng —",
): { readonly value: string; readonly nhan: string }[] {
  const ra: { value: string; nhan: string }[] = [{ value: "", nhan: nhanTrong }];
  for (const n of ds) {
    if (n.conDung) ra.push({ value: n.id, nhan: `${n.ma} — ${n.ten}` });
    else if (n.id === dangChon) ra.push({ value: n.id, nhan: `${n.ma} — ${n.ten} (đã ngừng dùng)` });
  }
  if (dangChon !== null && dangChon !== "" && !ds.some((n) => n.id === dangChon)) {
    ra.push({ value: dangChon, nhan: "(nhóm hàng không đọc được — giữ nguyên)" });
  }
  return ra;
}

/** Nhóm hàng của gói nói bằng lời, cho bảng thông tin gói. `null` khi gói chưa có nhóm. */
export function nhanNhomHangCuaGoi(ds: readonly NhomHangMan[], categoryId: unknown): string | null {
  if (typeof categoryId !== "string") return null;
  const n = ds.find((x) => x.id === categoryId);
  if (n === undefined) return "(nhóm hàng không đọc được)";
  return n.conDung ? `${n.ma} — ${n.ten}` : `${n.ma} — ${n.ten} (đã ngừng dùng)`;
}

/** Nút *Đặt nhóm hàng* chỉ có nghĩa ở tổ chức đã bật, với gói đang soạn — cột khoá sau DRAFT. */
export function hienDatNhomHang(daBat: boolean, trangThaiGoi: string): boolean {
  return daBat && trangThaiGoi === "DRAFT";
}
