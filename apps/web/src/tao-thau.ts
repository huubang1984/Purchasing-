// ==============================================================================================
// [S1.191 / S3.2c2] MÀN TẠO GÓI THẦU — THỨ TỰ BƯỚC VÀ LỜI NÓI THEO LUỒNG MỜI CỦA TỔ CHỨC
//
// Spec S3 §3.3 và §9 (S3.2c): ở tổ chức ĐÃ BẬT S3, danh sách mời dựng ở DRAFT, TRƯỚC khi nộp duyệt — chữ ký duyệt gói mang
// băm của danh sách lúc ký (K4b) —, lời mời nằm *chưa gửi* (K6) cho tới lần mở gói, và lần mở gói gửi mọi link một lượt,
// trả danh sách lời mời gửi hỏng (S3.2b2, ADR-113). Tổ chức CHƯA bật chạy nguyên MVP1: mời sau khi mở, link đi ngay lúc mời.
// Chủ dự án chốt ngày 2026-09-29: màn đổi thứ tự bước theo tổ chức đã bật hay chưa, và có nút *Trả về soạn thảo*.
//
// Mọi thứ ở đây là phép tính THUẦN trên dữ liệu máy chủ trả về, nên nó sống ở đây, được `tsc` gác và `tao-thau.test.ts` đo,
// rồi phục vụ cho trình duyệt ở `/lib/tao-thau.js` — khuôn `chinh-sach.ts`. Không luật nào ở đây là chốt: K4a, K6 và cạnh
// về DRAFT nằm ở trigger và hàm gói; màn chỉ nói trước điều máy chủ sẽ nói, và giấu nút mà máy chủ chắc chắn từ chối.
// ==============================================================================================

/** Thứ tự hiển thị của bốn bước sau đăng nhập — id của `section` trong `tao-thau.html`. */
export type Buoc = "b2" | "b3" | "b4" | "b5";

/**
 * Tổ chức đã bật: nhà cung cấp và lời mời (b5) đứng TRƯỚC ngân sách và phê duyệt (b4), vì người duyệt ký lên chính danh
 * sách ấy. Chưa bật: thứ tự MVP1.
 */
export function thuTuBuoc(daBat: boolean): readonly Buoc[] {
  return daBat ? ["b2", "b3", "b5", "b4"] : ["b2", "b3", "b4", "b5"];
}

/** Trạng thái lời mời (`010`, `076`) nói bằng lời. Trạng thái lạ trả nguyên văn — màn không đoán. */
export function nhanTrangThaiLoiMoi(status: unknown): string {
  switch (status) {
    case "UNSENT": return "chưa gửi";
    case "SENT": return "đã gửi";
    case "REVOKED": return "đã thu hồi";
    case "ACCEPTED": return "đã nhận";
    case "DECLINED": return "đã từ chối";
    default: return typeof status === "string" && status !== "" ? status : "—";
  }
}

/**
 * [S1.193 / S3.2c2 · K6] Cột trạng thái của một dòng lời mời: trạng thái nói bằng lời, cộng nhãn *mời sau khi ký* khi trigger
 * `076` đã đặt nó — lời mời thêm lúc gói đã `OPEN`, ở tổ chức đã bật (spec S3 §5.1 K6). `GET /rfqs/:rfqId/invitations` trả
 * cờ ấy (`listInvitations`, `moiSauKhiKy`); chỉ `true` mới là có nhãn.
 */
export function nhanLoiMoi(status: unknown, moiSauKhiKy: unknown): string {
  const nhan = nhanTrangThaiLoiMoi(status);
  return moiSauKhiKy === true ? `${nhan} · mời sau khi ký` : nhan;
}

/** Trạng thái gói mà ở đó nhà cung cấp còn dùng link — lối gửi lại (ADR-110) chỉ chạy khi gói nhận báo giá. */
const GOI_NHAN_BAO_GIA: ReadonlySet<string> = new Set(["OPEN", "BAFO_OPEN"]);

/**
 * [S1.240 / khoản 276 / ADR-128] Trạng thái gói từ lần mở thầu đầu tiên — `UNSEALED` và mọi trạng thái đi tới từ nó, trừ
 * `CANCELLED`. Bản sao ĐỂ ĐỌC của `RFQ_STATUSES_AFTER_UNSEAL` (`packages/invitation`, tập mà `revokeInvitation` chặn thu hồi): module
 * này chạy trong trình duyệt nên không import gói máy chủ; `tao-thau.test.ts` suy tập từ `RFQ_TRANSITIONS` — cùng phép suy ghim hằng
 * của gói ở `invitation.int.test.ts` — và đo màn theo nó, nên hai bản không lệch mà không đỏ.
 */
const GOI_SAU_MO_THAU: ReadonlySet<string> = new Set(["UNSEALED", "EVALUATING", "BAFO_OPEN", "BAFO_CLOSED", "BAFO_UNSEALED", "AWARDED"]);

/**
 * Hai nút của một dòng lời mời.
 *   · Lời mời đã thu hồi: không nút nào.
 *   · Tổ chức chưa bật: như MVP1 — ~~cả hai nút~~ *Gửi lại link* ở mọi trạng thái, máy chủ tự từ chối ca nó không cho.
 *     [S1.240 / khoản 276] *Thu hồi* ẩn sau lần mở thầu (`GOI_SAU_MO_THAU`): từ ADR-128 máy chủ chặn thu hồi ở đó bằng một 422
 *     câu cố định, nên nút ấy là một nút không bao giờ đi được.
 *   · Tổ chức đã bật: *Thu hồi* ở DRAFT, ~~ở OPEN thu hồi bị chặn tới S3.6~~ [S1.9101 / S3.6c / K10c] và ở OPEN — có lý do, sinh
 *     tín hiệu thu hẹp danh sách, bị chặn khi làm danh sách rơi dưới ngưỡng cạnh tranh mà không ngoại lệ (K4a; ở PENDING_APPROVAL
 *     phải trả gói về soạn thảo trước); *Gửi lại link* chỉ khi gói nhận báo giá — trước lần mở gói chưa có token nào để gửi (K6).
 */
export function nutLoiMoi(daBat: boolean, trangThaiGoi: string, daThuHoi: boolean): { readonly guiLai: boolean; readonly thuHoi: boolean } {
  if (daThuHoi) return { guiLai: false, thuHoi: false };
  if (!daBat) return { guiLai: true, thuHoi: !GOI_SAU_MO_THAU.has(trangThaiGoi) };
  return { guiLai: GOI_NHAN_BAO_GIA.has(trangThaiGoi), thuHoi: trangThaiGoi === "DRAFT" || trangThaiGoi === "OPEN" };
}

/** Lời mời như thân `201` của `POST /rfqs/:rfqId/invitations` trả về — chỉ hai trường màn đọc. */
export interface LoiMoiVua {
  readonly status?: unknown;
  readonly moiSauKhiKy?: unknown;
}

/**
 * Câu báo sau một lần mời thành công (`201`). `loi: true` khi link đáng lẽ đã đi mà chưa đi — mời thêm ở OPEN, gửi hỏng.
 * Thân `201` của tổ chức đã bật mang TRẠNG THÁI THẬT của lời mời (ADR-113): `201` không còn nghĩa là link đã đi.
 */
export function baoSauKhiMoi(loiMoi: LoiMoiVua): { readonly loi: boolean; readonly chu: string } {
  if (loiMoi.status === "UNSENT" && loiMoi.moiSauKhiKy !== true) {
    return {
      loi: false,
      chu: "Đã thêm vào danh sách mời. Link CHƯA đi: nó đi tới mọi nhà cung cấp trong danh sách lúc gói thầu được mở — " +
        "người duyệt ký lên chính danh sách này, nên mời đủ rồi mới nộp duyệt.",
    };
  }
  if (loiMoi.status === "UNSENT") {
    return {
      loi: true,
      chu: "Đã mời, nhưng link chưa gửi được. Lời mời vẫn còn — bấm «Gửi lại link» ở dòng của nó trong danh sách lời mời.",
    };
  }
  return { loi: false, chu: "Đã mời. Link đi thẳng tới bộ gửi — màn này không bao giờ thấy mã mời." };
}

/**
 * Câu báo sau lần mở gói (`200 {rfq, unsentInvitationIds}`). Tổ chức chưa bật không có gì để gửi lúc mở — câu cũ. Đã bật:
 * danh sách rỗng là mọi link đã đi; không rỗng là gói ĐÃ mở mà một phần link chưa đi (chủ dự án chọn `200`, không mã lỗi).
 */
export function baoSauKhiMo(daBat: boolean, unsentInvitationIds: unknown): { readonly loi: boolean; readonly chu: string } {
  // ~~"Đã mở thầu."~~ [S1.193 / S3.2c2] *Mở gói* là `PENDING_APPROVAL→OPEN`, *mở thầu* là `CLOSED→UNSEALED` (PRODUCT §4 ⑶,
  // spec S3 §3.3) — ở cả hai luồng.
  const coBan = "Đã mở gói. Từ giờ nhà cung cấp nộp được, và khoá của gói đã sinh ở máy chủ.";
  if (!daBat) return { loi: false, chu: coBan };
  const chuaGui = Array.isArray(unsentInvitationIds) ? unsentInvitationIds.length : 0;
  if (chuaGui === 0) return { loi: false, chu: `${coBan} Link mời đã đi tới mọi nhà cung cấp trong danh sách.` };
  return {
    loi: true,
    chu: `${coBan} Nhưng ${String(chuaGui)} link mời CHƯA gửi được — các dòng «chưa gửi» trong danh sách lời mời; bấm ` +
      "«Gửi lại link» ở từng dòng.",
  };
}

/** Nút *Trả về soạn thảo*: cạnh `PENDING_APPROVAL→DRAFT` chỉ mở ở tổ chức đã bật (`077`). */
export function hienTraVe(daBat: boolean, trangThaiGoi: string): boolean {
  return daBat && trangThaiGoi === "PENDING_APPROVAL";
}

/** Trần độ dài lý do, tính bằng BYTE UTF-8 — cùng số và cùng đơn vị với `batBuoc` của `returnRfqToDraft` (`packages/rfq`). */
export const TRAN_LY_DO_BYTE = 2000;

/**
 * Lý do trả về soạn thảo: bắt buộc, không rỗng sau khi cắt khoảng trắng, không quá trần. `null` là hợp lệ. Đếm BYTE, không
 * đếm ký tự: một chữ có dấu là hai hay ba byte, nên 2000 ký tự tiếng Việt vượt trần của máy chủ.
 */
export function loiLyDo(lyDo: string): string | null {
  const t = lyDo.trim();
  if (t === "") return "Cần ghi lý do trả gói về soạn thảo — lý do vào sổ kiểm toán.";
  if (new TextEncoder().encode(t).length > TRAN_LY_DO_BYTE) return `Lý do dài quá — tối đa ${String(TRAN_LY_DO_BYTE)} byte, chữ có dấu tính hai hay ba byte.`;
  return null;
}

/**
 * [S1.200 / khoản 258] Màn TỰ đọc ngân sách (`GET /rfqs/:rfqId/budget`) ở lần đọc gói chỉ khi người dùng là người tạo gói — họ
 * đặt nó, và cổng cho họ đọc bằng `rfq.create`. Người khác đọc bằng nút *Xem ngân sách*: cổng đòi `rfq.approve`, và mỗi lần từ
 * chối là một hàng sổ cộng một lần trong trần từ chối của phiên (ADR-092) — tự đọc ở mỗi lần đọc gói biến lần từ chối thành nhịp
 * làm việc của mọi người mua không giữ quyền duyệt, và đốt trần mà một lần thử sai quyền THẬT cần để vào sổ (lượt soi §S1.200, F3;
 * chủ dự án chốt ngày 2026-09-29). Chưa biết người dùng thì không coi là người tạo.
 */
export function tuDocNganSach(userId: string, createdBy: unknown): boolean {
  return userId !== "" && createdBy === userId;
}

/** [S1.200 / khoản 258] Năm hàng của bảng ngân sách — đúng năm thứ chữ ký duyệt gói ràng vào (`rfq_bam_ngan_sach`, `086`). */
export function hangNganSach(budget: unknown): readonly (readonly [string, string | null])[] {
  const b = (budget !== null && typeof budget === "object" ? budget : {}) as Record<string, unknown>;
  const chu = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v) : null);
  return [
    ["Giá trị ước lượng", chu(b.estimatedValue)],
    ["Tiền tệ", chu(b.currency)],
    ["Phiên bản chính sách", chu(b.policyVersion)],
    ["Bậc từ", chu(b.tierTuSoTien)],
    ["Cần hai người duyệt", b.requiresDualApproval === true ? "có" : b.requiresDualApproval === false ? "không" : null],
  ];
}

/**
 * [S1.234 / lượt soi S4.3b, L3] Cột *Hàng chuẩn* chỉ hiện khi nó nói được điều gì: tổ chức có hàng chuẩn đang dùng (`coHangChuan` của
 * `GET /rfqs/:rfqId/mappings`), hoặc gói đã có một dòng khác *chưa chuẩn hoá* (ánh xạ cũ vẫn là sự thật khi mọi hàng đã ngừng dùng).
 * Tổ chức chưa khai hàng nào thì màn giữ đúng bảng của hôm nay (spec §2.3). Thân lạ hay đọc hỏng ⇒ ẩn.
 */
export function hienCotHangChuan(than: unknown): boolean {
  const t = than as { readonly coHangChuan?: unknown; readonly dong?: unknown } | null | undefined;
  if (t?.coHangChuan === true) return true;
  return Array.isArray(t?.dong) && t.dong.some((d) => (d as { trangThai?: unknown } | null)?.trangThai !== "CHUA_CHUAN_HOA");
}

/**
 * [S1.234 / S4.3b] Cột *Hàng chuẩn* của bảng hạng mục — trạng thái ánh xạ của dòng (`GET /rfqs/:rfqId/mappings`) nói bằng lời.
 * Người tạo gói chỉ ĐỌC: người ghi ánh xạ là người quản lý dữ liệu ngoài tập loại trừ của gói (L3). Trạng thái lạ ⇒ `—`.
 */
export function nhanAnhXa(dong: { readonly trangThai: unknown; readonly hangChuan: { readonly ma: string } | null; readonly lyDo: string | null }): string {
  switch (dong.trangThai) {
    case "TU_DONG":
      return dong.hangChuan === null ? "—" : `Tự động — ${dong.hangChuan.ma}${dong.lyDo === "CHUAN_HOA_HOI_TO" ? " (chuẩn hoá hồi tố)" : ""}`;
    case "NGUOI_DUYET":
      if (dong.hangChuan !== null) return `Đã duyệt — ${dong.hangChuan.ma}`;
      return dong.lyDo === null ? "Không có hàng chuẩn tương ứng" : `Không có hàng chuẩn tương ứng — ${dong.lyDo}`;
    case "CHO_DUYET":
      return "Chờ người quản lý dữ liệu duyệt";
    case "CHUA_CHUAN_HOA":
      return "Chưa chuẩn hoá";
    default:
      return "—";
  }
}

// =============================================================================================
// [S3.6b2 / K10a] KHUNG TÍN HIỆU CHIA NHỎ GÓI (`PURCHASE_SPLITTING`) — thân `GET /rfqs/:rfqId/signals` đọc ra thứ màn vẽ.
//
// Chủ dự án chốt ngày 2026-09-30: khung nằm trong `/tao-thau`; hàm đọc trả thêm tên và trạng thái các gói trong bằng chứng, họ
// tên người ghi, và người đang xem ghi nhận được không. Màn không phán xét gì: tín hiệu do `tin_hieu_chia_nho` tính, luật người
// do `tin_hieu_chot_nguoi_ghi_nhan` — màn chỉ nói lại, và chỉ mời bấm khi máy chủ sẽ nhận. Bằng chứng không mang số tiền nào
// ngoài cận bậc của chính sách.
// =============================================================================================

/** Một gói trong bằng chứng, như màn vẽ nó. */
export interface GoiTinHieu {
  readonly id: string;
  readonly tieuDe: string;
  readonly trangThai: string;
  readonly laGoiNay: boolean;
}

/** Một dòng lịch sử: mốc (chuỗi ISO của máy chủ, màn định dạng) và câu. */
export interface DongLichSu {
  readonly luc: string | null;
  readonly noiDung: string;
}

export interface KhungTinHieu {
  /** Gói không có tín hiệu nào — hiện tại hay đã lưu — thì khung ẩn. */
  readonly hien: boolean;
  readonly tomTat: string;
  readonly goi: readonly GoiTinHieu[];
  readonly lichSu: readonly DongLichSu[];
  /** Ô lý do và nút «Ghi nhận tín hiệu»: chỉ khi tín hiệu còn chờ ghi nhận VÀ người đang xem ghi nhận được. */
  readonly choGhiNhan: boolean;
  /** Vì sao người đang xem không ghi nhận được — câu của máy chủ; `null` khi không có gì để nói. */
  readonly khongDuoc: string | null;
}

export const KHUNG_TIN_HIEU_RONG: KhungTinHieu = { hien: false, tomTat: "", goi: [], lichSu: [], choGhiNhan: false, khongDuoc: null };

/** Trạng thái gói (`rfq_packages.status`) nói bằng lời. Trạng thái lạ trả nguyên văn — màn không đoán. */
export function nhanTrangThaiGoi(status: unknown): string {
  switch (status) {
    case "DRAFT": return "đang soạn";
    case "PENDING_APPROVAL": return "chờ duyệt";
    case "OPEN": return "đã mở";
    case "CLOSED": return "đã đóng";
    case "UNSEALED": return "đã mở thầu";
    case "CANCELLED": return "đã huỷ";
    default: return typeof status === "string" && status !== "" ? status : "—";
  }
}

/** Số nguyên có dấu chấm ngăn nghìn — không phụ thuộc bảng ngôn ngữ của trình duyệt. */
function soNghin(v: unknown): string {
  const chu = typeof v === "number" || typeof v === "string" ? String(v) : "";
  return /^\d+$/u.test(chu) ? chu.replace(/\B(?=(\d{3})+(?!\d))/gu, ".") : chu === "" ? "—" : chu;
}

const laDoiTuong = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const idGoi = (bangChung: unknown): string[] =>
  laDoiTuong(bangChung) && Array.isArray(bangChung.goi) ? bangChung.goi.filter((g): g is string => typeof g === "string") : [];
const chuHoacNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Thân `GET /rfqs/:rfqId/signals` ra khung. Bảng gói vẽ bằng chứng HIỆN TẠI; không có thì bằng chứng của hàng đã lưu mới nhất —
 * tập chỉ co lại sau lần nộp, nên hàng cũ nói gói nào đã rời tập.
 */
export function khungTinHieu(body: unknown, rfqId: string): KhungTinHieu {
  const t = laDoiTuong(body) && laDoiTuong(body.tinHieu) ? body.tinHieu : null;
  if (t === null) return KHUNG_TIN_HIEU_RONG;
  const daLuu = Array.isArray(t.tinHieu) ? t.tinHieu.filter(laDoiTuong) : [];
  const hienTai = laDoiTuong(t.hienTai) ? t.hienTai : null;
  if (hienTai === null && daLuu.length === 0) return KHUNG_TIN_HIEU_RONG;

  const tenGoi = laDoiTuong(t.goi) ? t.goi : {};
  const ve = hienTai ?? daLuu[daLuu.length - 1]?.bangChung;
  // Bằng chứng xếp id theo UUID — thứ tự không nói gì với người đọc (lượt đi thử T4 thấy «2, 1, 3»). Màn xếp theo tên gói, số trong
  // tên so theo giá trị; cùng tên thì theo id cho ổn định.
  const goi = idGoi(ve)
    .map((id) => {
      const g = tenGoi[id];
      return {
        id,
        tieuDe: laDoiTuong(g) && typeof g.tieuDe === "string" ? g.tieuDe : id,
        trangThai: nhanTrangThaiGoi(laDoiTuong(g) ? g.trangThai : undefined),
        laGoiNay: id === rfqId,
      };
    })
    .sort((a, b) => a.tieuDe.localeCompare(b.tieuDe, "vi", { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const canGhiNhan = t.canGhiNhan === true;
  const xem = laDoiTuong(t.nguoiXem) ? t.nguoiXem : {};
  const choGhiNhan = canGhiNhan && xem.ghiNhanDuoc === true;
  const khongDuoc = canGhiNhan && !choGhiNhan ? chuHoacNull(xem.lyDo) : null;

  const bc = hienTai ?? {};
  const nGoi = String(idGoi(hienTai).length);
  const moTa = `${nGoi} gói cùng nhóm hàng nộp duyệt trong ${soNghin(bc.cua_so_ngay)} ngày, mỗi gói dưới cận ${soNghin(bc.can)} mà tổng chạm cận ấy`;
  const khop = (s: Record<string, unknown>): boolean => JSON.stringify(s.bangChung) === JSON.stringify(hienTai);
  let tomTat: string;
  if (hienTai === null) {
    tomTat = "Tín hiệu ghi lúc nộp không còn đúng: tập gói hiện tại không chạm cận nào, nên lần mở gói không cần ghi nhận.";
  } else if (canGhiNhan) {
    tomTat = `Gói này nằm trong ${moTa}. Gói chỉ mở được sau khi một người giữ quyền duyệt — không tạo, không nộp gói nào trong ` +
      "tập ấy — đọc tín hiệu và ghi nhận nó, kèm lý do.";
    if (t.soNguoiGhiNhanDuoc === 0) {
      tomTat += " Trong tổ chức hiện không ai ghi nhận được tín hiệu này: mọi người giữ quyền duyệt đều dính tới một gói trong tập " +
        "(spec S3 §8.10) — cần thêm một người duyệt.";
    }
  } else if (daLuu.some((s) => khop(s) && Array.isArray(s.ghiNhan) && s.ghiNhan.length > 0)) {
    tomTat = `Gói này nằm trong ${moTa}. Tín hiệu đã được ghi nhận — nó không chặn lần mở gói nữa.`;
  } else {
    tomTat = `Gói này nằm trong ${moTa}.`;
  }

  const lichSu: DongLichSu[] = [];
  for (const s of daLuu) {
    const ai = chuHoacNull(s.nguoiGhiTen) ?? "Một người";
    const tap = `${String(idGoi(s.bangChung).length)} gói, cận ${soNghin(laDoiTuong(s.bangChung) ? s.bangChung.can : undefined)}`;
    lichSu.push({
      luc: chuHoacNull(s.tinhLuc),
      noiDung: s.nguon === "GHI_NHAN"
        ? `${ai} ghi nhận khi tập gói đã đổi sau lần nộp — tín hiệu được ghi lại theo tập hiện tại (${tap}).`
        : `${ai} nộp duyệt; tín hiệu được ghi lúc nộp (${tap}).`,
    });
    for (const a of Array.isArray(s.ghiNhan) ? s.ghiNhan.filter(laDoiTuong) : []) {
      lichSu.push({ luc: chuHoacNull(a.luc), noiDung: `${chuHoacNull(a.nguoiTen) ?? "Một người"} ghi nhận: «${typeof a.lyDo === "string" ? a.lyDo : ""}».` });
    }
  }
  return { hien: true, tomTat, goi, lichSu, choGhiNhan, khongDuoc };
}

/**
 * [S1.285 / S3.6d / K10b] Khung tín hiệu KHAI THẤP ƯỚC LƯỢNG ở bước 7 của `/mo-thau` — thân `GET /rfqs/:rfqId/signals`, phần
 * `tinHieu.khaiThap` cộng các hàng `ESTIMATE_UNDERSTATED` đã lưu. Tóm tắt là câu `giaiThich` CSDL viết cho hàng có bằng chứng BẰNG
 * tín hiệu hiện tại (không số tiền nào — bằng chứng chỉ mang hai mốc bậc); không hàng nào thì nói bằng hai mốc bậc của bằng chứng.
 * Lịch sử: các lần ghi nhận của hàng ấy. Ô lý do và nút chỉ khi còn chờ ghi nhận VÀ người đang xem ghi nhận được.
 */
export interface KhungTinHieuKhaiThap {
  readonly hien: boolean;
  readonly tomTat: string;
  /** Còn chờ ghi nhận (chữ ký trao thầu bị chặn) hay đã có người đọc. */
  readonly choDoc: boolean;
  readonly lichSu: readonly DongLichSu[];
  readonly choGhiNhan: boolean;
  readonly khongDuoc: string | null;
}

export const KHUNG_TIN_HIEU_KHAI_THAP_RONG: KhungTinHieuKhaiThap = { hien: false, tomTat: "", choDoc: false, lichSu: [], choGhiNhan: false, khongDuoc: null };

/** [S1.9101 / S3.6c / K10c] Ba loại tín hiệu mà chữ ký duyệt trao thầu đòi ghi nhận — phần của thân `GET /rfqs/:rfqId/signals`. */
export type LoaiTinHieuTraoThau = "ESTIMATE_UNDERSTATED" | "INVITE_LIST_NARROWED" | "EARLY_CLOSE";
const PHAN_THEO_LOAI: Readonly<Record<LoaiTinHieuTraoThau, string>> = { ESTIMATE_UNDERSTATED: "khaiThap", INVITE_LIST_NARROWED: "thuHep", EARLY_CLOSE: "dongSom" };

/** Câu tóm tắt dựng từ bằng chứng khi chưa có hàng nào mang câu CSDL viết — không số tiền nào. */
function tomTatTuBangChung(loai: LoaiTinHieuTraoThau, hienTai: Record<string, unknown>): string {
  if (loai === "INVITE_LIST_NARROWED") {
    const so = Array.isArray(hienTai.thu_hoi) ? hienTai.thu_hoi.length : 0;
    return `${String(so)} lời mời bị thu hồi sau khi gói thầu mở — danh sách người duyệt đã ký bị thu hẹp.`;
  }
  if (loai === "EARLY_CLOSE") {
    const so = typeof hienTai.so_bao_gia === "number" ? String(hienTai.so_bao_gia) : "—";
    return `Gói thầu đóng lúc ${chuHoacNull(hienTai.dong_luc) ?? "—"}, trước hạn ${chuHoacNull(hienTai.han) ?? "—"}, khi đã có ${so} luồng báo giá.`;
  }
  return `Bậc của số tiền trao (từ ${soNghin(hienTai.bac_trao)}) so với bậc của ước lượng (từ ${soNghin(hienTai.bac_uoc_luong)})${hienTai.vuot_nguong_kep === true ? "; số tiền trao vượt ngưỡng phê duyệt kép mà ước lượng thì không" : ""}.`;
}

/**
 * [S1.9101 / S3.6c / K10c] Khung MỘT loại tín hiệu ở chữ ký trao thầu — cùng khuôn khai thấp cho ba loại: phần theo loại của
 * `tinHieu` (`khaiThap` / `thuHep` / `dongSom`) cộng các hàng đã lưu của loại ấy.
 */
export function khungTinHieuTraoThau(body: unknown, loai: LoaiTinHieuTraoThau): KhungTinHieuKhaiThap {
  const t = laDoiTuong(body) && laDoiTuong(body.tinHieu) ? body.tinHieu : null;
  const phan = t?.[PHAN_THEO_LOAI[loai]];
  const kt = t !== null && laDoiTuong(phan) ? phan : null;
  if (t === null || kt === null) return KHUNG_TIN_HIEU_KHAI_THAP_RONG;
  const hienTai = laDoiTuong(kt.hienTai) ? kt.hienTai : null;
  if (hienTai === null) return KHUNG_TIN_HIEU_KHAI_THAP_RONG;
  const daLuu = (Array.isArray(t.tinHieu) ? t.tinHieu.filter(laDoiTuong) : []).filter((h) => h.loai === loai);
  const khop = daLuu.find((h) => JSON.stringify(h.bangChung) === JSON.stringify(hienTai)) ?? null;
  const tomTat = khop !== null && typeof khop.giaiThich === "string" && khop.giaiThich !== "" ? khop.giaiThich : tomTatTuBangChung(loai, hienTai);
  const lichSu: DongLichSu[] = (khop !== null && Array.isArray(khop.ghiNhan) ? khop.ghiNhan.filter(laDoiTuong) : []).map((g) => ({
    luc: chuHoacNull(g.luc),
    noiDung: `${chuHoacNull(g.nguoiTen) ?? "một người duyệt"} đã ghi nhận: ${chuHoacNull(g.lyDo) ?? "—"}`,
  }));
  const choDoc = kt.canGhiNhan === true;
  const nguoiXem = laDoiTuong(kt.nguoiXem) ? kt.nguoiXem : null;
  const choGhiNhan = choDoc && nguoiXem?.ghiNhanDuoc === true;
  const khongDuoc = choDoc && !choGhiNhan ? chuHoacNull(nguoiXem?.lyDo) : null;
  return { hien: true, tomTat, choDoc, lichSu, choGhiNhan, khongDuoc };
}

export function khungTinHieuKhaiThap(body: unknown): KhungTinHieuKhaiThap {
  return khungTinHieuTraoThau(body, "ESTIMATE_UNDERSTATED");
}

/** Lý do ghi nhận: bắt buộc, không quá trần — cùng số và đơn vị với `ghiNhanTinHieu` (`packages/kiem-soat`). `null` là hợp lệ. */
export function loiLyDoGhiNhan(lyDo: string): string | null {
  const t = lyDo.trim();
  if (t === "") return "Cần ghi lý do ghi nhận — lý do vào sổ kiểm toán cùng tên người ghi nhận.";
  if (new TextEncoder().encode(t).length > TRAN_LY_DO_BYTE) return `Lý do dài quá — tối đa ${String(TRAN_LY_DO_BYTE)} byte, chữ có dấu tính hai hay ba byte.`;
  return null;
}

// ==============================================================================================
// [S1.273 / S3.3e1] NGOẠI LỆ CẠNH TRANH, NHÀ CUNG CẤP CÓ SẴN VÀ LỜI TỪ CHỐI CỦA CHỐT
//
// Spec S3 §4.4 và §9 (S3.3e). K2, K3, K5 chặn ở máy chủ (`107`, `108`); màn chỉ đưa người dùng tới đúng việc phải làm: chọn nhà
// cung cấp người khác đã dựng và FINANCE đã xác minh, lập ngoại lệ đúng loại, hay nhờ người ký độc lập. Ba tập đóng dưới đây là
// BẢN SAO ĐỂ ĐỌC của `packages/invitation/src/ngoai-le.ts` — module này chạy trong trình duyệt nên không import gói máy chủ;
// `tao-thau.test.ts` so chúng với hằng của gói, nên hai bản không lệch mà không đỏ.
// ==============================================================================================

/** Ba loại ngoại lệ của danh sách mời (`LOAI_NGOAI_LE`). */
export const LOAI_NGOAI_LE = ["SINGLE_SOURCE", "LIMITED_COMPETITION", "ROTATION"] as const;
export type LoaiNgoaiLe = (typeof LOAI_NGOAI_LE)[number];
/**
 * [S1.282 / S3.5b] Loại ngoại lệ HẬU KIỂM (`LOAI_NGOAI_LE_HAU_KIEM` của gói): không vào ô chọn của `/tao-thau` — nó lập ở bước 7 của
 * `/mo-thau`, khi gói ở EVALUATING và trước đề xuất trao thầu (ADR-154 ⑸).
 */
export const LOAI_NGOAI_LE_HAU_KIEM = ["LOW_ACTUAL_COMPETITION"] as const;
export type LoaiNgoaiLeHauKiem = (typeof LOAI_NGOAI_LE_HAU_KIEM)[number];

/** Tập đóng của mã lý do (`MA_LY_DO_NGOAI_LE`). */
export const MA_LY_DO_NGOAI_LE = [
  "PROPRIETARY_TECHNOLOGY",
  "EXISTING_CONTRACT",
  "EMERGENCY",
  "NO_ALTERNATIVE",
  "COMPATIBILITY",
  "REGULATORY",
  "OTHER",
] as const;

/** Sàn giải trình của mã `OTHER`, byte UTF-8 sau khi cắt khoảng trắng (`SAN_GIAI_TRINH_OTHER_BYTE`). */
export const SAN_GIAI_TRINH_OTHER_BYTE = 100;
/** Trần giải trình, byte UTF-8 (`TRAN_GIAI_TRINH_BYTE`). */
export const TRAN_GIAI_TRINH_BYTE = 2000;

const NHAN_LOAI: Readonly<Record<LoaiNgoaiLe | LoaiNgoaiLeHauKiem, string>> = {
  SINGLE_SOURCE: "Một nguồn duy nhất",
  LIMITED_COMPETITION: "Cạnh tranh hạn chế",
  ROTATION: "Miễn xoay vòng",
  // [S1.282 / S3.5b] Loại hậu kiểm có nhãn: bảng ngoại lệ của cả hai trang đọc cùng một hàm.
  LOW_ACTUAL_COMPETITION: "Cạnh tranh thực tế thấp (hậu kiểm)",
};

const NHAN_MA_LY_DO: Readonly<Record<(typeof MA_LY_DO_NGOAI_LE)[number], string>> = {
  PROPRIETARY_TECHNOLOGY: "Công nghệ độc quyền",
  EXISTING_CONTRACT: "Hợp đồng đang có",
  EMERGENCY: "Khẩn cấp",
  NO_ALTERNATIVE: "Không có lựa chọn khác",
  COMPATIBILITY: "Tương thích với hệ thống đang dùng",
  REGULATORY: "Yêu cầu pháp lý",
  OTHER: "Lý do khác (giải trình từ 100 byte)",
};

/** Loại ngoại lệ nói bằng lời; mã lạ trả nguyên văn. */
export function nhanLoaiNgoaiLe(loai: unknown): string {
  if (typeof loai !== "string" || loai === "") return "—";
  return Object.hasOwn(NHAN_LOAI, loai) ? NHAN_LOAI[loai as keyof typeof NHAN_LOAI] : loai;
}

/** Mã lý do nói bằng lời; mã lạ trả nguyên văn. */
export function nhanMaLyDo(ma: unknown): string {
  if (typeof ma !== "string" || ma === "") return "—";
  return Object.hasOwn(NHAN_MA_LY_DO, ma) ? NHAN_MA_LY_DO[ma as keyof typeof NHAN_MA_LY_DO] : ma;
}

function soByteUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Giải trình của một ngoại lệ — cùng luật với hàm gói (rỗng, trần, sàn của `OTHER`); `null` là hợp lệ. */
export function loiGiaiTrinh(maLyDo: string, giaiTrinh: string): string | null {
  const g = giaiTrinh.trim();
  if (g === "") return "Cần giải trình vì sao gói không đủ cạnh tranh.";
  if (soByteUtf8(g) > TRAN_GIAI_TRINH_BYTE) return `Giải trình dài quá ${TRAN_GIAI_TRINH_BYTE} byte.`;
  if (maLyDo === "OTHER" && soByteUtf8(g) < SAN_GIAI_TRINH_OTHER_BYTE) {
    return `Lý do «khác» cần giải trình từ ${SAN_GIAI_TRINH_OTHER_BYTE} byte trở lên (hiện ${soByteUtf8(g)}).`;
  }
  return null;
}

/**
 * Loại ngoại lệ K2 nhận cho số lời mời còn sống (`107` ⑶, khớp chặt): một lời mời ⇒ `SINGLE_SOURCE`, từ hai ⇒
 * `LIMITED_COMPETITION`; danh sách rỗng thì không ngoại lệ nào cứu ⇒ `null`. Màn chọn sẵn loại này.
 */
export function loaiNgoaiLeGoiY(soLoiMoiConSong: number): LoaiNgoaiLe | null {
  if (soLoiMoiConSong <= 0) return null;
  return soLoiMoiConSong === 1 ? "SINGLE_SOURCE" : "LIMITED_COMPETITION";
}

/**
 * Một câu chỉ dẫn cho lời từ chối có mã của chốt (`ma` ở thân 422 — `dispatch.ts`). Câu của máy chủ (`CHOT_VAO_SO`) đã nói phải làm
 * gì, bằng mã của ngoại lệ; câu này BỔ SUNG, không nhắc lại — nó nói chỗ làm việc ấy trên màn, tên ngoại lệ như ô chọn hiện, và
 * điều câu máy chủ không nói. [lượt đi thử T4] Bản đầu nhắc lại nửa câu của máy chủ ở K2. `coQuyenMoi` sai ⇒ người xem không sửa
 * được danh sách, câu nói nhờ người mời được. Mã khác ⇒ `null`.
 */
export function chiDanChot(ma: unknown, coQuyenMoi: boolean): string | null {
  const nho = coQuyenMoi ? "" : " Bạn không giữ quyền mời — nhờ người tạo gói hay người giữ quyền mời làm việc này.";
  switch (ma) {
    case "K2_THIEU_CANH_TRANH":
      return "Trên màn: chọn nhà cung cấp ở «Chọn nhà cung cấp có sẵn» — cột «Đếm được» của bảng lời mời nói dòng nào được tính —, " +
        "hay lập ngoại lệ ở khối «Ngoại lệ cạnh tranh»: SINGLE_SOURCE là «Một nguồn duy nhất», LIMITED_COMPETITION là «Cạnh tranh " +
        "hạn chế». Danh sách rỗng thì không ngoại lệ nào cứu." + nho;
    case "K2_DAU_THAU_CHINH_THUC":
      return "Không ngoại lệ nào cứu được bậc này trên hệ thống." + nho;
    case "K3_KHONG_XOAY_VONG":
      return "Trên màn: chọn ở «Chọn nhà cung cấp có sẵn» một nhà cung cấp chưa mời gần đây — nó cũng phải đếm được —, hay lập " +
        "«Miễn xoay vòng» (ROTATION) ở khối «Ngoại lệ cạnh tranh»." + nho;
    case "K5_THIEU_CHU_KY_DOC_LAP":
      return "Nhờ một người giữ quyền duyệt chưa làm việc nào kể trên với gói này ký, rồi mở lại.";
    // [S1.282 / S3.5b] Tám mã của trao thầu theo bậc (K7, K2b, K5b — ADR-154) đi ra ở bước 7 của `/mo-thau`: câu máy chủ nói luật,
    // câu này nói chỗ làm trên màn và người phải đổi.
    case "K2B_THIEU_CANH_TRANH_THUC":
      return "Trên màn: khối «Ngoại lệ hậu kiểm» ở bước 7 — lập «Cạnh tranh thực tế thấp» (LOW_ACTUAL_COMPETITION) khi gói còn ở lượt " +
        "chấm, trước lần đề xuất; người lập không còn là người ký độc lập của gói." + nho;
    case "K2B_NGOAI_LE_SAI_TRANG_THAI":
      return "Rút đề xuất đang có (hay huỷ trao thầu) để gói về lượt chấm, rồi lập hay rút ở khối «Ngoại lệ hậu kiểm».";
    case "K5B_THIEU_CHU_KY_DOC_LAP":
      return "Chữ ký đã có vẫn còn. Nhờ thêm một người giữ vai của bậc mà chưa dính tới gói này ký — chưa lập ngoại lệ, chưa khai bản " +
        "chính sách, chưa điều phối lần mở, chưa xác minh bên thắng.";
    case "K7_SAI_VAI":
      return "Đổi ở bước 1 sang người đang giữ một vai mà bậc của gói cho ký (ma trận ở /chinh-sach).";
    case "K7_TAC_GIA_CHINH_SACH":
      return "Đổi ở bước 1 sang người khác: tác giả của bản chính sách gói ghim không ký được.";
    case "K7_DAU_THAU_CHINH_THUC":
      return "Không trao được trên hệ thống; huỷ gói nếu cần làm lại.";
    case "K7_KHONG_BAC_GHIM":
    case "K7_LECH_TIEN_TE":
      return "Huỷ gói và lập lại với ngân sách ghim bậc, cùng tiền tệ với chính sách.";
    // [S1.285 / S3.6d] Ba mã K10b — tín hiệu khai thấp ước lượng ở bước 7 của `/mo-thau`.
    case "K10B_TIN_HIEU_CHUA_GHI_NHAN":
      return "Trên màn: khối «Tín hiệu khai thấp» ở bước 7 — ai đứng ngoài gói mà giữ quyền ký đọc tín hiệu, ghi lý do rồi bấm " +
        "«Ghi nhận», sau đó mới ký.";
    case "K10B_TU_GHI_NHAN":
      return "Đổi ở bước 1 sang một người duyệt khác đứng ngoài gói này.";
    case "K10B_TAC_GIA_CHINH_SACH":
      return "Đổi ở bước 1 sang người khác: tác giả của bản chính sách gói ghim không làm việc này được.";
    // [S1.9101 / S3.6c] Bốn mã K10c — thu hẹp danh sách mời và đóng sớm ở bước 7 của `/mo-thau`; ngưỡng của lần thu hồi ở bước 5 `/tao-thau`.
    case "K10C_TIN_HIEU_CHUA_GHI_NHAN":
      return "Trên màn: khối «Tín hiệu trước chữ ký trao thầu» ở bước 7 — ai đứng ngoài gói mà giữ quyền ký đọc từng tín hiệu còn chờ, " +
        "ghi lý do rồi bấm «Ghi nhận», sau đó mới ký.";
    case "K10C_TU_GHI_NHAN":
      return "Đổi ở bước 1 sang một người duyệt khác đứng ngoài gói này.";
    case "K10C_TAC_GIA_CHINH_SACH":
      return "Đổi ở bước 1 sang người khác: tác giả của bản chính sách gói ghim không làm việc này được.";
    case "K10C_THU_HOI_THIEU_CANH_TRANH":
      return "Giữ lời mời này, hay mời thêm nhà cung cấp đếm được ở bước 5 rồi mới thu hồi; ngoại lệ cạnh tranh chỉ lập được khi gói còn soạn thảo.";
    default:
      return null;
  }
}

/** Câu tổng của K2 trên bảng lời mời: số NHÓM đếm được so với ngưỡng của bậc ghim. Thân không mang khối ấy ⇒ `null`. */
export function nhanCanhTranh(canhTranh: unknown): string | null {
  if (canhTranh === null || typeof canhTranh !== "object") return null;
  const { soNhomDemDuoc, toiThieu } = canhTranh as { soNhomDemDuoc?: unknown; toiThieu?: unknown };
  if (typeof soNhomDemDuoc !== "number") return null;
  if (typeof toiThieu !== "number") {
    return `Đếm được ${soNhomDemDuoc} nhóm nhà cung cấp. Gói chưa có bậc chính sách — đặt ngân sách để biết cần bao nhiêu.`;
  }
  const du = soNhomDemDuoc >= toiThieu;
  return `Đếm được ${soNhomDemDuoc}/${toiThieu} nhóm nhà cung cấp cho cạnh tranh tối thiểu — ` +
    (du ? "đủ." : "chưa đủ: mời thêm nhà cung cấp đếm được, hay lập ngoại lệ đúng loại.") +
    " Nhà cung cấp chung mã số thuế gốc, email hay số điện thoại là MỘT nhóm.";
}

/** Cờ có/không của một ô; không phải boolean ⇒ `—` (tổ chức chưa bật). */
export function nhanCo(v: unknown): string {
  return v === true ? "có" : v === false ? "không" : "—";
}

/** Ký tự điều khiển hướng chữ (U+202A–202E, U+2066–2069): một tên mang chúng có thể HIỆN khác thứ được băm và ký. */
const KY_TU_DIEU_HUONG = /[‪-‮⁦-⁩]/u;

/** Tên nhà cung cấp kèm mã số thuế để phân biệt hai hồ sơ trùng tên; tên mang ký tự điều hướng thì được đánh dấu. */
export function tenKemMst(ten: unknown, mst: unknown): string {
  const t = typeof ten === "string" ? ten : "—";
  const canh = KY_TU_DIEU_HUONG.test(t) ? " [⚠ tên chứa ký tự đảo chiều chữ]" : "";
  const m = typeof mst === "string" && mst !== "" ? ` — MST ${mst}` : " — không MST";
  return `${t.replace(/[‪-‮⁦-⁩]/gu, "")}${m}${canh}`;
}

/** Văn bản tự do (giải trình, lý do) để hiện: bỏ ký tự điều hướng và đánh dấu khi có. */
export function vanBanAnToan(s: unknown): string {
  if (typeof s !== "string") return "—";
  return KY_TU_DIEU_HUONG.test(s) ? `${s.replace(/[‪-‮⁦-⁩]/gu, "")} [⚠ có ký tự đảo chiều chữ]` : s;
}

/**
 * Danh sách đọc kèm một lần nộp (`GET …/invitations`, `GET …/exceptions`) có thuộc CÙNG lần nộp với lần đọc gói mà nút Phê duyệt
 * sẽ gửi không. Lệch ⇒ màn đọc lại TRỌN gói, không chỉ sửa `lanNop` (lượt soi CAO-1). Thân không mang `lanNop` ⇒ coi như lệch.
 */
export function cungLanNop(lanNopGoi: unknown, lanNopDanhSach: unknown): boolean {
  return typeof lanNopGoi === "number" && typeof lanNopDanhSach === "number" && lanNopGoi === lanNopDanhSach;
}

/** Một nhà cung cấp như `GET /suppliers` trả — chỉ bốn trường ô chọn đọc. */
export interface NhaCungCapChon {
  readonly id: string;
  readonly legalName: string;
  readonly taxCode: string | null;
  readonly status: string;
}

/** Đọc thân `GET /suppliers`; phần tử sai hình dạng bị bỏ. Chỉ hồ sơ ACTIVE vào ô chọn — hồ sơ khác không mời được. */
export function docNhaCungCapChon(body: unknown): NhaCungCapChon[] {
  const ds = (body as { suppliers?: unknown } | null)?.suppliers;
  if (!Array.isArray(ds)) return [];
  const ra: NhaCungCapChon[] = [];
  for (const x of ds as unknown[]) {
    const n = x as Record<string, unknown> | null;
    if (n === null || typeof n !== "object") continue;
    if (typeof n.id !== "string" || typeof n.legalName !== "string" || typeof n.status !== "string") continue;
    if (n.status !== "ACTIVE") continue;
    ra.push({ id: n.id, legalName: n.legalName, taxCode: typeof n.taxCode === "string" ? n.taxCode : null, status: n.status });
  }
  return ra;
}

/** Trạng thái xác minh của nhà cung cấp đang chọn (`GET /suppliers/:id/verification`), một câu. */
export function nhanXacMinhNgan(verification: unknown): string {
  if (verification === null || typeof verification !== "object") return "Không đọc được trạng thái xác minh.";
  const v = verification as { loai?: unknown; conHieuLuc?: unknown; hetHanAt?: unknown };
  if (v.conHieuLuc === true) {
    const han = typeof v.hetHanAt === "string" ? ` tới ${new Date(v.hetHanAt).toLocaleDateString("vi-VN")}` : "";
    return `Đã xác minh, còn hiệu lực${han}.`;
  }
  if (v.loai === "VERIFIED") return "Xác minh đã hết hiệu lực (hết hạn, hay hồ sơ đổi sau lúc xác minh) — nhờ tài chính xác minh lại.";
  if (v.loai === "REVOKED") return "Xác minh đã bị thu hồi — nhà cung cấp này không được đếm cho cạnh tranh tối thiểu.";
  return "Chưa được xác minh — nhờ tài chính xác minh ở màn nhà cung cấp trước khi mời.";
}

// ----------------------------------------------------------------------------------------------
// [S1.284 / S4.7b1] SỐ NGÀY GIAO YÊU CẦU CỦA GÓI (`112_tco`, ADR-153; L16)
// ----------------------------------------------------------------------------------------------
// Con số là của GÓI, chỉ đổi ở DRAFT (trigger `rfq_packages_so_ngay_giao`) và nằm trong chữ ký phê duyệt (`approved_delivery_hash`):
// người duyệt phải thấy nó ở chính màn duyệt. Nó là cơ sở của chi phí trễ giao — phiên bản ghim lúc mở tính `chi_phi_tre` mà gói không
// khai thì cạnh mở từ chối (`tco_thieu_so_ngay_giao`), nên màn cảnh báo TRƯỚC, khi gói còn soạn hay đang chờ duyệt. Không luật nào ở
// đây là chốt: miền là của `CHECK` `112`, cạnh mở là của trigger; màn chỉ nói trước.

/** Biên trên — bản chép của `SO_NGAY_GIAO_TOI_DA` (`packages/rfq`), khoá ở `tao-thau.test.ts`. */
export const SO_NGAY_GIAO_TOI_DA = 3650;

/** Ô người gõ → số ngày; `null` khi để trống (xoá con số); `undefined` khi không đọc được — trang báo, không gửi. */
export function docSoNgayGiao(chuoi: string): number | null | undefined {
  const s = chuoi.trim();
  if (s === "") return null;
  if (!/^[1-9][0-9]{0,3}$/u.test(s)) return undefined;
  const n = Number(s);
  return n <= SO_NGAY_GIAO_TOI_DA ? n : undefined;
}

/** Ô và nút chỉ hiện khi gói ĐANG SOẠN — trigger từ chối mọi trạng thái khác. */
export function hienDatSoNgayGiao(trangThaiGoi: string): boolean {
  return trangThaiGoi === "DRAFT";
}

/** Dòng của bảng gói — mọi trạng thái, vì người duyệt ký lên nó. */
export function nhanSoNgayGiao(v: unknown): string {
  if (typeof v === "number") return `${String(v)} ngày`;
  return v === null ? "chưa khai" : "—";
}

const coChiPhiTre = (p: unknown): boolean =>
  Array.isArray((p as { evalComponents?: unknown } | null)?.evalComponents) &&
  ((p as { evalComponents: unknown[] }).evalComponents).some((t) => (t as { ma?: unknown } | null)?.ma === "chi_phi_tre");

/**
 * Câu cảnh báo khi gói chưa khai số ngày giao mà phiên bản đang hiệu lực — hay một phiên bản MỚI HƠN, chưa có hiệu lực, có thể có hiệu
 * lực trước lúc gói mở — tính chi phí trễ. `body` là thân `GET /policy/versions`. `null`: không có gì để nói.
 *
 * [rà soát §S1.284 — TRUNG-1] Bản đầu nói *"chỉ còn lối huỷ"* cả khi chỉ một phiên bản mới hơn tính chi phí trễ — sai: gói mở được
 * ngay (cạnh mở chỉ đọc phiên bản hiệu lực), và một lời nói sai đẩy người duyệt huỷ một gói lành. Nay hai ca tách nhau:
 * - phiên bản HIỆU LỰC tính chi phí trễ: đúng lời của `openRfq` — gói chờ duyệt ở tổ chức chưa bật chỉ còn lối huỷ;
 * - chỉ một phiên bản MỚI HƠN tính nó: lời có điều kiện *"nếu nó có hiệu lực trước lúc gói mở"*. Ở tổ chức chưa bật, phiên bản có bậc chỉ
 *   có hiệu lực khi được ký, và chữ ký ấy bị từ chối khi còn gói chờ duyệt (`097`) — gói chờ duyệt không rơi vào nó; chỉ phiên bản
 *   không bậc (hiệu lực theo `effective_from`) còn là nguy cơ.
 */
export function canhBaoSoNgayGiao(body: unknown, soNgayGiao: unknown, trangThaiGoi: string): string | null {
  if (soNgayGiao !== null) return null;
  if (trangThaiGoi !== "DRAFT" && trangThaiGoi !== "PENDING_APPROVAL") return null;
  const b = body as { phienBan?: unknown; daBat?: unknown } | null;
  const ds: readonly unknown[] = Array.isArray(b?.phienBan) ? (b.phienBan as unknown[]) : [];
  const daBat = b?.daBat === true;
  const iHieuLuc = ds.findIndex((p) => (p as { hieuLuc?: unknown } | null)?.hieuLuc === true);
  const hieuLuc = iHieuLuc < 0 ? null : ds[iHieuLuc];
  const moiHon = (iHieuLuc < 0 ? ds : ds.slice(0, iHieuLuc)).filter(coChiPhiTre);
  if (hieuLuc !== null && coChiPhiTre(hieuLuc)) {
    const dau = "Chính sách đang hiệu lực tính chi phí trễ giao: gói chưa khai số ngày giao yêu cầu không mở được";
    if (trangThaiGoi === "DRAFT") return `${dau}. Khai số ngày giao ở ô dưới trước khi nộp duyệt.`;
    return daBat
      ? `${dau} — trả gói về soạn thảo để khai số ngày giao, rồi nộp duyệt lại.`
      : `${dau} — gói đã nộp duyệt không trả về soạn thảo được ở tổ chức chưa bật kiểm soát theo bậc, nên gói này chỉ còn lối huỷ.`;
  }
  if (moiHon.length === 0) return null;
  const dau =
    "Một phiên bản chính sách mới hơn, chưa có hiệu lực, tính chi phí trễ giao: nếu nó có hiệu lực trước lúc gói mở, gói chưa khai số " +
    "ngày giao yêu cầu không mở được";
  if (trangThaiGoi === "DRAFT") return `${dau}. Khai số ngày giao ở ô dưới trước khi nộp duyệt.`;
  if (daBat) return `${dau} — khi ấy trả gói về soạn thảo để khai số ngày giao, rồi nộp duyệt lại.`;
  const khongBac = moiHon.some((p) => (p as { tiers?: unknown } | null)?.tiers === null);
  return khongBac
    ? `${dau}, và ở tổ chức chưa bật kiểm soát theo bậc gói đã nộp không trả về soạn thảo được — mở gói trước lúc ấy.`
    : null;
}
