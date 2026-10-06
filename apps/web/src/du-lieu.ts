// ==============================================================================================
// [S1.199 / S4.2b] MÀN DỮ LIỆU NỀN — PHÉP TÍNH THUẦN CỦA `/du-lieu`
//
// Bốn việc, không việc nào là chốt — mọi luật nằm ở CSDL (`083`) và gói `du-lieu-nen`; màn chỉ nói trước điều máy chủ sẽ nói:
//   ⑴ đọc và viết ô thuộc tính (*"khoá: giá trị"*, mỗi dòng một cặp) và ô thuộc tính trọng yếu (phân cách bằng dấu phẩy);
//   ⑵ lọc danh sách hàng chuẩn ĐANG HIỆN trên màn — `GET /items` không tìm ở máy chủ vì router không đọc query (E6);
//   ⑶ câu §8.10 của spec S4: vai mới là một người mới, và `DATA_STEWARD` chỉ ghép được với `TECHNICAL`;
//   ⑷ một dòng quy đổi đọc được: *"1 cay = 7.22 kg"*.
//
// ⑵ KHÔNG phải `chuoi_sach`. Bước làm sạch của dữ liệu nền chỉ có một bản, ở SQL (spec S4 §2.5 ⒄), vì bí danh LƯU dạng sạch và
// hai bản cài là hai khoá. Bộ lọc ở đây không lưu gì, không so khoá nào — nó chỉ ẩn dòng trên màn —, nên nó được phép gần đúng:
// bỏ dấu, `đ`→`d`, chữ thường. Một dòng lọc sai thì người dùng xoá ô lọc là thấy lại.
//
// Được `tsc` gác, `du-lieu.test.ts` đo, phục vụ cho trình duyệt ở `/lib/du-lieu.js` — khuôn `chinh-sach.ts`.
// ==============================================================================================

/** Khoá thuộc tính — cùng biểu thức với `CHECK canonical_item_versions_thuoc_tinh_hinh_dang` của `083`. */
const KHOA = /^[a-z][a-z0-9_]{0,39}$/u;
/** Mã hàng chuẩn — cùng biểu thức với `CHECK canonical_items_ma_hinh_dang` của `083`. */
const MA = /^[A-Z0-9][A-Z0-9._-]{0,39}$/u;
/** Hệ số — cùng biểu thức với `HE_SO` của `packages/du-lieu-nen/src/hang-chuan.ts`, và phải dương. */
const HE_SO = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/u;

export type KetQuaThuocTinh =
  | { readonly ok: true; readonly thuocTinh: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly loi: string };

/** Ô thuộc tính → object. Dòng trống bỏ qua; mỗi dòng khác phải là `khoá: giá trị` với khoá viết thường, giá trị không rỗng. */
export function docThuocTinh(chu: string): KetQuaThuocTinh {
  const thuocTinh: Record<string, string> = {};
  const dong = chu.split(/\r?\n/u);
  for (let i = 0; i < dong.length; i++) {
    const d = (dong[i] ?? "").trim();
    if (d === "") continue;
    const hai = d.indexOf(":");
    if (hai <= 0) return { ok: false, loi: `dòng ${i + 1}: cần dạng "khoá: giá trị"` };
    const khoa = d.slice(0, hai).trim();
    const giaTri = d.slice(hai + 1).trim();
    if (!KHOA.test(khoa)) return { ok: false, loi: `dòng ${i + 1}: khoá "${khoa}" phải viết thường, bắt đầu bằng chữ, chỉ chữ, số và "_"` };
    if (giaTri === "") return { ok: false, loi: `dòng ${i + 1}: khoá "${khoa}" chưa có giá trị` };
    if (Object.hasOwn(thuocTinh, khoa)) return { ok: false, loi: `dòng ${i + 1}: khoá "${khoa}" khai hai lần` };
    thuocTinh[khoa] = giaTri;
  }
  return { ok: true, thuocTinh };
}

/** Object → ô thuộc tính, theo thứ tự khoá — để màn điền sẵn phiên bản mới nhất khi soạn phiên bản kế. */
export function vietThuocTinh(thuocTinh: Readonly<Record<string, string>>): string {
  return Object.keys(thuocTinh)
    .sort()
    .map((k) => `${k}: ${thuocTinh[k] ?? ""}`)
    .join("\n");
}

/** Ô trọng yếu → danh sách khoá. Mỗi khoá trọng yếu phải có mặt trong thuộc tính (`CHECK … trong_yeu_co_gia_tri`). */
export function docTrongYeu(chu: string, thuocTinh: Readonly<Record<string, string>>): { readonly ok: true; readonly khoa: readonly string[] } | { readonly ok: false; readonly loi: string } {
  const khoa = [...new Set(chu.split(",").map((x) => x.trim()).filter((x) => x !== ""))];
  const thieu = khoa.filter((k) => !Object.hasOwn(thuocTinh, k));
  if (thieu.length > 0) return { ok: false, loi: `thuộc tính trọng yếu chưa có giá trị: ${thieu.join(", ")}` };
  return { ok: true, khoa };
}

/** Mã hàng chuẩn hợp hình dạng không — màn báo trước, CSDL vẫn là nơi phán. */
export function maHopLe(ma: string): boolean {
  return MA.test(ma);
}

/** Hệ số là chuỗi thập phân DƯƠNG — không đi qua `number`. */
export function heSoHopLe(heSo: string): boolean {
  return HE_SO.test(heSo) && !/^0(?:\.0+)?$/u.test(heSo);
}

/** Dạng để LỌC HIỂN THỊ — không phải `chuoi_sach` (xem đầu tệp). */
function dangLoc(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/gu, "").replace(/[đĐ]/gu, "d").toLowerCase();
}

export interface DongHangChuan {
  readonly ma: string;
  readonly ten: string;
}

/** Các dòng mà mã hoặc tên chứa chuỗi lọc (bỏ dấu, không phân biệt hoa thường). Chuỗi lọc rỗng ⇒ mọi dòng. */
export function locHangChuan<T extends DongHangChuan>(ds: readonly T[], loc: string): readonly T[] {
  const q = dangLoc(loc.trim());
  if (q === "") return ds;
  return ds.filter((h) => dangLoc(`${h.ma} ${h.ten}`).includes(q));
}

/**
 * Câu §8.10 — hoặc `null` khi người đang xem giữ `item.manage`. Hai ca, vì hai hoàn cảnh cần hai lời khuyên khác nhau: tổ chức
 * CHƯA có ai giữ vai thì phải gán cho một người MỚI, không phải cho người FINANCE sẵn có (hai trigger khuôn `033` từ chối); đã
 * có người thì người đang xem chỉ đọc được.
 */
export function cauVaiQuanLy(choGhi: boolean, soNguoiQuanLy: number): string | null {
  if (choGhi) return null;
  const vi =
    "Chỉ người giữ vai Quản lý dữ liệu (DATA_STEWARD) ghi được ở màn này. Vai ấy không ghép được với vai nào thấy giá hay tạo, " +
    "mời, trao, duyệt gói — chỉ ghép được với Kỹ thuật (TECHNICAL) — nên KHÔNG gán được cho người Tài chính, Mua sắm hay Giám đốc sẵn có.";
  if (soNguoiQuanLy === 0) return `${vi} Tổ chức chưa có ai giữ vai này: cần thêm MỘT NGƯỜI MỚI trước khi dùng nền dữ liệu.`;
  return `${vi} Tổ chức đã có ${soNguoiQuanLy} người giữ vai này; bạn chỉ xem được.`;
}

export interface QuyDoiHienThi {
  readonly tuDonVi: string;
  readonly sangDonVi: string;
  readonly heSo: string;
}

/** `1 cay = 7.22 kg` — hệ số in NGUYÊN chuỗi máy chủ trả, bỏ số 0 thừa sau dấu chấm. */
export function moTaQuyDoi(q: QuyDoiHienThi): string {
  const heSo = q.heSo.includes(".") ? q.heSo.replace(/0+$/u, "").replace(/\.$/u, "") : q.heSo;
  return `1 ${q.tuDonVi} = ${heSo} ${q.sangDonVi}`;
}

// ---------------------------------------------------------------------------------------------
// [S1.234 / S4.3b] Hàng đợi ánh xạ — bước 6 của `/du-lieu`. Luật (L2, L3, L13, §2.5 ⒁) nằm ở trigger `089`; màn chỉ vẽ và gửi.
// ---------------------------------------------------------------------------------------------

export interface UngVienHienThi {
  readonly hangChuanId: string;
  readonly ma: string;
  readonly diem: number;
}

export interface GoiYHienThi {
  readonly ketQua: string;
  readonly doTinCay: string;
  readonly ungVien: readonly UngVienHienThi[];
}

export interface DongHangDoiHienThi {
  readonly tieuDe: string;
  readonly moTa: string;
}

export interface HangChuanChon {
  readonly id: string;
  readonly ma: string;
  readonly ten: string;
  readonly trangThai: string;
}

/** Điểm hay độ tin cậy (0–1, chuỗi hay số) → phần trăm làm tròn. Giá trị lạ ⇒ `—`: màn không đoán. */
export function phanTram(x: string | number): string {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n) || n < 0 || n > 1) return "—";
  return `${Math.round(n * 100)}%`;
}

/** Cột *Gợi ý* của một dòng: kết quả của lõi và ứng viên đầu, hay *chưa chuẩn hoá* khi dòng chưa qua lượt nào. */
export function nhanGoiY(goiY: GoiYHienThi | null): string {
  if (goiY === null) return "Chưa chuẩn hoá — bấm «Chuẩn hoá lại cả gói»";
  const dau = goiY.ungVien[0];
  const loai = goiY.ketQua === "GOI_Y" ? "Gợi ý" : "Cần duyệt";
  if (dau === undefined) return `${loai} — không có ứng viên`;
  return `${loai} ${phanTram(goiY.doTinCay)} — ${dau.ma}`;
}

/** Lọc hàng đợi ĐANG HIỆN theo mô tả hoặc tên gói — cùng phép gần đúng của `locHangChuan`, không phải `chuoi_sach`. */
export function locHangDoi<T extends DongHangDoiHienThi>(ds: readonly T[], loc: string): readonly T[] {
  const q = dangLoc(loc.trim());
  if (q === "") return ds;
  return ds.filter((d) => dangLoc(`${d.moTa} ${d.tieuDe}`).includes(q));
}

/**
 * Ô chọn hàng chuẩn của một dòng: ứng viên của lõi trước (theo điểm, kèm phần trăm), rồi mọi hàng ĐANG DÙNG khác của danh sách
 * đang hiện. ~~Ứng viên không còn trong danh sách vẫn được liệt — tên để trống, máy chủ phán hàng ấy còn dùng được không.~~
 * [lượt soi S4.3b, L1] Gợi ý là hàng đã LƯU: ứng viên của nó có thể đã ngừng dùng từ đó. Ứng viên mà danh sách đang hiện nói là
 * ngừng dùng thì bỏ; ứng viên không có trong danh sách (danh sách dừng ở 500 hàng) vẫn được liệt, tên để trống — máy chủ từ chối hàng
 * ngừng dùng bằng mã `HANG_NGUNG_DUNG`.
 */
export function luaChonHangChuan(
  goiY: GoiYHienThi | null,
  hangChuan: readonly HangChuanChon[],
): readonly { readonly id: string; readonly nhan: string }[] {
  const tenTheoId = new Map(hangChuan.map((h) => [h.id, h.ten]));
  const ngungDung = new Set(hangChuan.filter((h) => h.trangThai !== "DANG_DUNG").map((h) => h.id));
  const ungVien = (goiY?.ungVien ?? [])
    .filter((u) => !ngungDung.has(u.hangChuanId))
    .map((u) => ({ id: u.hangChuanId, nhan: `${u.ma} — ${tenTheoId.get(u.hangChuanId) ?? ""} (${phanTram(u.diem)})` }));
  const daCo = new Set(ungVien.map((u) => u.id));
  const conLai = hangChuan.filter((h) => h.trangThai === "DANG_DUNG" && !daCo.has(h.id)).map((h) => ({ id: h.id, nhan: `${h.ma} — ${h.ten}` }));
  return [...ungVien, ...conLai];
}

// ----------------------------------------------------------------------------------------------
// [S1.9101 / S4.6a] Mốc giá ngoài và lịch sử mua ngoài hệ thống — bước 7. Không phép tính nào về GIÁ: màn của người quản lý dữ liệu
// không nhận lại đơn giá (ADR-096 ⑵; chủ dự án chốt 2026-10-06). Luật đọc văn bản dán ở `packages/du-lieu-nen/src/csv-ngoai.ts`.
// ----------------------------------------------------------------------------------------------

export type LoaiDuLieuNgoai = "MOC_NGOAI" | "LICH_SU_NGOAI";

/** Dòng tiêu đề mẫu mà màn đưa cho người dán — đúng tên cột của bộ đọc (thứ tự tự do, có dấu hay không đều được). */
export const TIEU_DE_MAU: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI: "ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_hieu_luc\tnguon",
  LICH_SU_NGOAI: "ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_mua\tnha_cung_cap\tnguon",
};

export const TEN_LOAI: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI: "mốc giá ngoài",
  LICH_SU_NGOAI: "lịch sử mua ngoài hệ thống",
};

/** Một lỗi theo dòng của lô bị từ chối — đúng hình dạng thân 422 của `POST /external-…/import`. */
export interface LoiDongNgoai {
  readonly dong: number;
  readonly cot: string | null;
  readonly ma: string;
  readonly cau: string;
}

/** *"Dòng 3, cột don_vi: …"* — dòng 1 là tiêu đề, đúng số dòng người dán thấy trong bảng tính. */
export function moTaLoiDong(l: LoiDongNgoai): string {
  return `Dòng ${String(l.dong)}${l.cot === null ? "" : `, cột ${l.cot}`}: ${l.cau}`;
}

/** Thân 422 của lần nhập lô → danh sách câu; thân không mang `loi` (một 422 khác) ⇒ `null`. */
export function docLoiLo(body: unknown): readonly string[] | null {
  const loi = (body as { loi?: unknown } | null)?.loi;
  if (!Array.isArray(loi)) return null;
  return loi
    .filter((l): l is LoiDongNgoai => typeof l === "object" && l !== null && typeof (l as LoiDongNgoai).dong === "number" && typeof (l as LoiDongNgoai).cau === "string")
    .map(moTaLoiDong);
}

/** *"2025-11-20 → 2025-12-05"*, hay một ngày khi hai đầu trùng. */
export function khoangNgay(tu: string, den: string): string {
  return tu === den ? tu : `${tu} → ${den}`;
}

/** Trần thân yêu cầu của API mà một lô dán phải lọt — bằng `TRAN_THAN_BYTE` của `apps/api/src/router.ts`; test đối chiếu nguồn. */
export const TRAN_THAN_LO_BYTE = 64 * 1024;

/** Thân `{ vanBan }` vượt trần ⇒ máy chủ cắt kết nối trước khi đọc xong; màn nói trước, kèm cách chia lô. */
export function thanLoVuotTran(vanBan: string): boolean {
  return new TextEncoder().encode(JSON.stringify({ vanBan })).length > TRAN_THAN_LO_BYTE;
}
