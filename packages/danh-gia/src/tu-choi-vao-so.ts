// ==============================================================================================
// [S1.116 / khoản 239 / ADR-060] TỪ CHỐI TRẠNG THÁI NÀO VÀO SỔ, VÀ VÌ SAO KHÔNG PHẢI TẤT CẢ
//
// ----------------------------------------------------------------------------------------------
// LỖ ĐƯỢC ĐO TRƯỚC, RỒI MỚI VÁ
// ----------------------------------------------------------------------------------------------
// Bất biến **J6** ở spec S2 §5 nói *"mọi lần đề xuất, duyệt, huỷ award, và mọi lần từ chối của cổng
// đánh giá, đều để lại một hàng sổ"*. Đo ngày 2026-09-23 (khoản **239**): nửa sau KHÔNG đúng. Từ
// chối QUYỀN nằm lại trong `requirePermission`; từ chối TRẠNG THÁI thì **không để lại dấu vết nào**
// — `apps/api/src/dispatch.ts` trả 422 rồi thoát, và chú thích của chính nó viết *"422 với thân cố
// định, KHÔNG vào log"*. Không hàng sổ, không dòng log, không bản ghi nào ở đâu cả.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO **CHỌN LỌC**, KHÔNG PHẢI GHI HẾT — chủ dự án chốt 2026-09-23
// ----------------------------------------------------------------------------------------------
// Cái giá của một hàng sổ KHÔNG phải một lần ghi. `verifyAuditChain` đọc **MỌI** hàng của tổ chức
// (`ORDER BY seq`, không `LIMIT`) rồi lặp — O(n), cả chuỗi vào bộ nhớ — và `audit_events` là bảng
// chỉ-ghi-thêm, không tỉa được. Mỗi hàng thêm vào làm **mọi lượt kiểm về sau** chậm hơn, vĩnh viễn.
//
// Nên luật là một MỆNH ĐỀ, không một danh sách tên:
//
//   **Ghi sổ khi lời từ chối nói rằng NGƯỜI DÙNG cố đi một bước của chuỗi không đúng thứ tự.**
//   **Không ghi khi nó nói rằng CẤU HÌNH chưa sẵn sàng.**
//
// Vế đầu có giá trị kiểm toán vì chuỗi ấy — *tạo RFQ → chọn NCC → mở thầu → award → duyệt* — chính
// là chuỗi mà nguyên tắc **1** của `docs/PRODUCT.md` §4 cấm một cá nhân kiểm soát trọn. Một người
// cố trao thầu trên gói chưa chấm là một tín hiệu về chuỗi ấy. Vế sau thì không: *chính sách chưa
// khai trọng số* là một sự cố vận hành, và kiểm toán viên không hỏi tới nó.
//
// **Điều luật này KHÔNG mua, nói ra:** từ chối do TRIGGER (hai người đua nhau trên cùng một gói)
// huỷ giao dịch nên không lối nào ở đây ghi được chúng. Lớp gói bắt trước ở đường thuận, nên ca ấy
// chỉ tới được khi có tranh chấp thật — và khi ấy sổ im. Đó là giới hạn còn lại, không phải một
// chỗ quên.
//
// ----------------------------------------------------------------------------------------------
// BẢNG NÀY LÀ NGUỒN DUY NHẤT CỦA TỪ VỰNG, VÀ KIỂU CƯỠNG CHẾ ĐIỀU ĐÓ
// ----------------------------------------------------------------------------------------------
// Ba module (`luot-danh-gia`, `trao-thau`, `vong-bafo`) khai union lý do của chúng bằng `Extract<>`
// từ `MaTuChoiTrangThai` dưới đây. Nên một mã MỚI không có dòng trong bảng **không biên dịch được**
// — mạnh hơn một cổng đọc mã nguồn, và rẻ hơn. Chiều import một phía: ba module → tệp này, tệp này
// không import gì của chúng, nên không có cạnh vòng.
// ==============================================================================================

import type pg from "pg";
import { throwAuditedDenial } from "@trustprocure/identity";

/** Toàn bộ từ vựng từ chối TRẠNG THÁI của S2. Thêm một mã là thêm một dòng ở `VAO_SO`. */
export type MaTuChoiTrangThai =
  | "CHINH_SACH_CHUA_KHAI_TRONG_SO"
  | "CHINH_SACH_TAT_BAFO"
  | "CHUA_CHAM_LAN_NAO"
  | "KHONG_CO_AWARD_CON_SONG"
  | "KHONG_CO_BAO_GIA_DOC_DUOC"
  | "KHONG_CO_DE_XUAT_DANG_CHO"
  | "KHONG_CO_VONG_DANG_MO"
  | "LECH_TIEN_TE"
  | "RFQ_KHONG_CHAM_DUOC"
  | "RFQ_KHONG_DE_XUAT_DUOC"
  | "RFQ_KHONG_MO_VONG_DUOC"
  | "THANH_PHAN_CHUA_CO_NGUON";

export interface DongVaoSo {
  /** `true` ⇒ lần từ chối này để lại một hàng `RFQ_STATE_DENIED` ở giao dịch ĐỘC LẬP. */
  readonly vaoSo: boolean;
  /** Vì sao — và nó phải trả lời được câu *"kiểm toán viên có hỏi tới ca này không"*. */
  readonly lyDo: string;
}

/**
 * Mỗi mã, một quyết định, một lý do. `Record` đầy đủ nên quên một mã là một lỗi BIÊN DỊCH.
 *
 * Bảy mã `vaoSo: true` đều nói cùng một câu: *một người cố đi một bước của chuỗi không đúng thứ
 * tự*. Năm mã `false` đều nói: *cấu hình chưa sẵn sàng*.
 */
export const VAO_SO: Readonly<Record<MaTuChoiTrangThai, DongVaoSo>> = {
  // ---- BẢY mã CHUỖI — vào sổ
  RFQ_KHONG_CHAM_DUOC: {
    vaoSo: true,
    lyDo: "một người bấm CHẤM khi gói thầu chưa ở trạng thái chấm được — bước *mở thầu → chấm* bị đi tắt",
  },
  RFQ_KHONG_DE_XUAT_DUOC: {
    vaoSo: true,
    lyDo: "một người bấm ĐỀ XUẤT TRAO THẦU khi gói thầu không ở `EVALUATING` — bước *chấm → award* bị đi tắt",
  },
  RFQ_KHONG_MO_VONG_DUOC: {
    vaoSo: true,
    lyDo: "một người bấm MỞ VÒNG BAFO sai trạng thái — cùng hình dạng với hai mã trên",
  },
  CHUA_CHAM_LAN_NAO: {
    vaoSo: true,
    lyDo: "một người cố trao thầu hay mở BAFO trên một gói CHƯA CHẤM LẦN NÀO — tín hiệu rõ nhất của việc bỏ qua bước chấm",
  },
  KHONG_CO_DE_XUAT_DANG_CHO: {
    vaoSo: true,
    lyDo: "một người bấm DUYỆT khi không có đề xuất nào đang chờ — hoặc họ chậm một nhịp, hoặc có người vừa huỷ",
  },
  KHONG_CO_AWARD_CON_SONG: {
    vaoSo: true,
    lyDo: "một người bấm HUỶ khi không còn award nào sống — cùng lớp với mã trên, và cả hai là dấu vết của hai người làm trên một gói",
  },
  KHONG_CO_VONG_DANG_MO: {
    vaoSo: true,
    lyDo: "một người bấm ĐÓNG VÒNG BAFO khi không có vòng nào mở",
  },

  // ---- NĂM mã CẤU HÌNH — KHÔNG vào sổ
  CHINH_SACH_CHUA_KHAI_TRONG_SO: {
    vaoSo: false,
    lyDo: "tổ chức chưa khai trọng số đánh giá — một sự cố VẬN HÀNH, sửa bằng cách tạo phiên bản chính sách mới; kiểm toán viên không hỏi tới nó, và nó lặp lại đúng bằng số lần người dùng thử trước khi ai đó sửa cấu hình",
  },
  THANH_PHAN_CHUA_CO_NGUON: {
    vaoSo: false,
    lyDo: "chính sách khai một thành phần mà vòng này chưa có nguồn dữ liệu — một giới hạn ĐÃ BIẾT của sản phẩm, không một hành vi của người dùng",
  },
  CHINH_SACH_TAT_BAFO: {
    vaoSo: false,
    lyDo: "`bafo_top_n = 0`, tức tổ chức CHỌN không dùng BAFO — một cấu hình hợp lệ, và từ chối ở đây chỉ là nó được thi hành",
  },
  LECH_TIEN_TE: {
    vaoSo: false,
    lyDo: "các báo giá đọc được không cùng đơn vị tiền — một vấn đề DỮ LIỆU của vòng thầu, gặp một lần rồi chuẩn hoá; không ai *cố* làm nó",
  },
  KHONG_CO_BAO_GIA_DOC_DUOC: {
    vaoSo: false,
    lyDo: "không báo giá nào có số tiền đọc được — cùng hạng với `LECH_TIEN_TE`, và vế *báo giá nào không đọc được* đã có dấu vết ở chính bảng xếp hạng (`effective_cost` NULL)",
  },
};

/** `action` của hàng sổ. MỘT mã cho mọi lối; lý do cụ thể đi vào `payload`. */
export const ACTION_TU_CHOI_TRANG_THAI = "RFQ_STATE_DENIED";

/**
 * Hình dạng chung của ba lớp lỗi từ chối trạng thái — chúng thoả nó theo CẤU TRÚC, không cần kế
 * thừa một lớp cha, nên tệp này vẫn không import gì của ba module kia.
 */
export interface LoiTuChoiTrangThai extends Error {
  readonly lyDo: MaTuChoiTrangThai;
}

/**
 * Lối ra DUY NHẤT của một lần từ chối trạng thái.
 *
 * Mã đọc TỪ CHÍNH lỗi (`loi.lyDo`), không nhận thêm một tham số mã: hai chỗ viết cùng một mã là hai
 * chỗ để chúng trôi khỏi nhau, và ở đây chỗ trôi sẽ là *hàng sổ ghi một mã khác thông điệp người
 * dùng đọc*.
 *
 * Trả `Promise<never>`: chỗ gọi viết `return nemTuChoi(...)` hay `await nemTuChoi(...)` và TypeScript
 * coi phần sau là không tới được — cùng khuôn `assertUnsealAllowed` của `packages/unseal/src/gate.ts`.
 *
 * Khi `vaoSo` là `false`, hàm NÉM THẲNG: không chạm `auditPool`, không mở một giao dịch nào. Đó là
 * nửa rẻ của luật, và nó phải rẻ thật chứ không chỉ rẻ trên giấy.
 */
export async function nemTuChoi(
  auditPool: pg.Pool,
  orgId: string,
  actorId: string,
  rfqId: string,
  loi: LoiTuChoiTrangThai,
): Promise<never> {
  if (!VAO_SO[loi.lyDo].vaoSo) throw loi;
  return throwAuditedDenial(
    auditPool,
    orgId,
    {
      actorType: "USER",
      actorId,
      action: ACTION_TU_CHOI_TRANG_THAI,
      resourceType: "RFQ",
      resourceId: rfqId,
      // Chỉ MÃ, không thông điệp: thông điệp mang tên trạng thái và đôi khi tên gói thầu, còn
      // hàng sổ thì bất biến và đọc được bởi mọi vai có quyền đọc sổ. Mã là đủ để trả lời
      // *"ai đã cố đi tắt bước nào"*, và nó là thứ duy nhất ca đột biến của J6 cần thấy.
      payload: { ma: loi.lyDo },
    },
    loi,
  );
}
