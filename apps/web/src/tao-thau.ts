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
 * Hai nút của một dòng lời mời.
 *   · Lời mời đã thu hồi: không nút nào.
 *   · Tổ chức chưa bật: như MVP1 — cả hai nút, máy chủ tự từ chối ca nó không cho.
 *   · Tổ chức đã bật: *Thu hồi* chỉ ở DRAFT (K4a — ở OPEN thu hồi bị chặn tới S3.6, ở PENDING_APPROVAL phải trả gói về
 *     soạn thảo trước); *Gửi lại link* chỉ khi gói nhận báo giá — trước lần mở gói chưa có token nào để gửi (K6).
 */
export function nutLoiMoi(daBat: boolean, trangThaiGoi: string, daThuHoi: boolean): { readonly guiLai: boolean; readonly thuHoi: boolean } {
  if (daThuHoi) return { guiLai: false, thuHoi: false };
  if (!daBat) return { guiLai: true, thuHoi: true };
  return { guiLai: GOI_NHAN_BAO_GIA.has(trangThaiGoi), thuHoi: trangThaiGoi === "DRAFT" };
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
 * [S1.9101 / S4.3b] Cột *Hàng chuẩn* của bảng hạng mục — trạng thái ánh xạ của dòng (`GET /rfqs/:rfqId/mappings`) nói bằng lời.
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
