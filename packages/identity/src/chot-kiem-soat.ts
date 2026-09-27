// ==============================================================================================
// [S1.166 / S3.1b / ADR-084 ⑷] LỚP TỪ CHỐI THỨ BA CỦA K12 — `CONTROL_DENIED`
//
// Ba lớp tách nhau (ADR-084 ⑸): `PERMISSION_DENIED` — thiếu quyền; `RFQ_STATE_DENIED` — đi sai thứ tự
// (`packages/danh-gia/src/tu-choi-vao-so.ts`); `CONTROL_DENIED` — đủ quyền, đúng thứ tự, nhưng một CHỐT
// KIỂM SOÁT chặn. Mã đi qua bảng dưới đây rồi mới ra ngoài.
//
// Luật chọn lọc của ADR-060 giữ nguyên: lời từ chối nói NGƯỜI DÙNG cố đi tắt một chốt thì vào sổ;
// lời từ chối nói dữ liệu hay cấu hình vừa đổi dưới chân họ thì không. Hàng sổ ở giao dịch ĐỘC LẬP
// qua `throwAuditedDenial`, và payload chỉ mang MÃ.
//
// [S1.9101 / khoản 247 / ADR-9201] BẢNG DỜI XUỐNG GÓI NÀY từ `packages/rfq/src/chot-kiem-soat.ts`, đúng như
// chú thích ở đó đã hẹn: khi một gói khác cần, bảng dời xuống một gói cả hai cùng phụ thuộc — không mọc
// bảng thứ hai. Gói khác ấy là `packages/danh-gia`: bốn lần từ chối của TÁCH BẠCH NHIỆM VỤ — J3 ở đề xuất và
// duyệt trao thầu, D2 ở duyệt gói — nay cũng là chốt kiểm soát. Trước vòng ấy chúng chỉ có ở trigger (`011`,
// `061`, `064`), và trigger huỷ cả giao dịch nên pilot giả lập đo được 422 kèm **0 hàng sổ**. Chủ dự án chốt
// lớp của chúng là `CONTROL_DENIED`: người vi phạm J3 có đủ quyền và đi đúng thứ tự — thứ chặn họ là một chốt.
// Hàm vị từ SQL của K1 và câu hỏi nó (`kiemChot`) ở lại `packages/rfq`; ở đây chỉ còn từ vựng và lời từ chối.
//
// ----------------------------------------------------------------------------------------------
// BẢNG NÀY LÀ NGUỒN DUY NHẤT CỦA TỪ VỰNG
// ----------------------------------------------------------------------------------------------
// `Record` đầy đủ nên một mã thêm vào `MaChotKiemSoat` mà không có dòng ở đây là một lỗi BIÊN DỊCH.
// Chiều kia — một mã mà hàm SQL trả về nhưng không có ở đây — thì kiểu không bắt được: tầng gói ném
// một lỗi KHÔNG tên (500), và phép đo ở `packages/rfq/src/bac-chinh-sach.int.test.ts` so tập mã trong thân
// hàm với bảng.
// ==============================================================================================

import type pg from "pg";
import type { ActorType } from "@trustprocure/audit";
import { throwAuditedDenial } from "./rbac.js";

/** Toàn bộ từ vựng chốt kiểm soát. Thêm một mã là thêm một dòng ở `CHOT_VAO_SO`. */
export type MaChotKiemSoat =
  | "BAC_LECH_HAM_PHAN_BAC"
  | "D2_NGUOI_TAO_TU_DUYET"
  | "J3_NGUOI_DE_XUAT_TU_DUYET"
  | "J3_NGUOI_DIEU_PHOI_DE_XUAT"
  | "J3_NGUOI_TAO_DE_XUAT"
  | "NGAN_SACH_GHIM_BAN_CU"
  | "THIEU_NGAN_SACH";

export interface DongChot {
  /** Bất biến mà chốt này cưỡng chế — nhóm K của S3, hay J3/D2 của tách bạch nhiệm vụ (khoản 247). */
  readonly chot: `${"D" | "J" | "K"}${number}`;
  /** `true` ⇒ lần từ chối này để lại một hàng `CONTROL_DENIED` ở giao dịch ĐỘC LẬP. */
  readonly vaoSo: boolean;
  /** Vì sao — và nó phải trả lời được câu *"kiểm toán viên có hỏi tới ca này không"*. */
  readonly lyDo: string;
  /** Thông điệp cho người dùng: nói phải làm gì, không nội suy dữ liệu nào. */
  readonly thongDiep: string;
}

/**
 * Mỗi mã, một quyết định, một lý do. Hai quyết định `vaoSo` của K1 là của chủ dự án (S1.166); bốn dòng J3/D2
 * cũng vậy (S1.9101 / khoản 247 — "cả bảy lần vào sổ").
 */
export const CHOT_VAO_SO: Readonly<Record<MaChotKiemSoat, DongChot>> = {
  THIEU_NGAN_SACH: {
    chot: "K1",
    vaoSo: true,
    lyDo:
      "một người nộp duyệt một gói KHÔNG có ngân sách ở tổ chức đã bật S3 — gói không ngân sách không có bậc, nên bỏ bước " +
      "này là thoát MỌI chốt của S3 (spec §2.4 ⑸). Kiểm toán viên hỏi tới đúng lần cố ấy",
    thongDiep: "Tổ chức đã bật kiểm soát theo bậc: gói thầu phải có ngân sách dự tính trước khi nộp duyệt.",
  },
  NGAN_SACH_GHIM_BAN_CU: {
    chot: "K1",
    vaoSo: false,
    lyDo:
      "chính sách đổi SAU khi gói đặt ngân sách — cấu hình đổi dưới chân người dùng, không ai cố lách, và CSDL chặn sẵn; " +
      "ghi sổ thì mỗi lần đổi chính sách, mỗi gói nháp để lại một hàng vĩnh viễn",
    thongDiep: "Chính sách mua sắm đã đổi từ khi đặt ngân sách: đặt lại ngân sách để gói nhận bậc theo chính sách hiện hành.",
  },
  BAC_LECH_HAM_PHAN_BAC: {
    chot: "K1",
    vaoSo: false,
    lyDo:
      "bậc đã lưu khác kết quả của hàm phân bậc hiện hành — chỉ tới được khi hàm phân bậc đổi sau lúc đặt ngân sách, hay " +
      "khi chủ CSDL sửa tay; người dùng không gây ra nó, và sửa bằng cách đặt lại ngân sách",
    thongDiep: "Bậc của gói thầu cần tính lại: đặt lại ngân sách dự tính rồi nộp duyệt.",
  },
  D2_NGUOI_TAO_TU_DUYET: {
    chot: "D2",
    vaoSo: true,
    lyDo:
      "người tạo gói duyệt chính gói ấy — đúng cặp *tạo → duyệt* mà nguyên tắc 1 (PRODUCT §4) cấm một người giữ trọn. Lần cố ấy " +
      "là thứ kiểm toán viên hỏi đầu tiên; trước khoản 247 nó chỉ bị trigger `rfq_kiem_nguoi_duyet` (011) chặn và không để lại dấu vết",
    thongDiep: "Người tạo gói thầu không được duyệt chính gói ấy — cần một người khác duyệt.",
  },
  J3_NGUOI_TAO_DE_XUAT: {
    chot: "J3",
    vaoSo: true,
    lyDo:
      "người tạo gói đề xuất trao thầu cho chính gói ấy — vế 2 của J3. Người ấy có `award.recommend` và gói đang `EVALUATING`, " +
      "nên chỉ chốt này chặn; lần cố là một tín hiệu về đúng chuỗi mà nguyên tắc 1 bảo vệ",
    thongDiep: "Người tạo gói thầu không được đề xuất trao thầu cho chính gói ấy.",
  },
  J3_NGUOI_DIEU_PHOI_DE_XUAT: {
    chot: "J3",
    vaoSo: true,
    lyDo:
      "người từng điều phối mở thầu gói này đề xuất trao thầu cho nó — vế 3 của J3, đọc lịch sử điều phối (`064`, khoản 233). " +
      "Người đã chạm bản rõ trước mọi người khác mà chọn luôn người thắng là đúng ca kiểm toán viên cần thấy",
    thongDiep: "Người từng điều phối mở thầu gói này không được đề xuất trao thầu cho nó.",
  },
  J3_NGUOI_DE_XUAT_TU_DUYET: {
    chot: "J3",
    vaoSo: true,
    lyDo:
      "người đề xuất trao thầu tự duyệt đề xuất của chính mình — vế 1 của J3. `FINANCE` giữ cả `award.recommend` lẫn " +
      "`po.approve`, nên lớp vai trò không chặn được; lần cố tự duyệt là tín hiệu rõ nhất của một người ôm trọn quyết định",
    thongDiep: "Người đề xuất trao thầu không được tự duyệt đề xuất của mình — cần một người khác duyệt.",
  },
};

/** `action` của hàng sổ. MỘT mã cho mọi chốt; chốt cụ thể đi vào `payload`. */
export const ACTION_CHOT_KIEM_SOAT = "CONTROL_DENIED";

/** Lời từ chối có tên của một chốt kiểm soát. `dispatch.ts` trả nó ra dưới 422 kèm thông điệp. */
export class ChotKiemSoatError extends Error {
  constructor(readonly lyDo: MaChotKiemSoat) {
    super(CHOT_VAO_SO[lyDo].thongDiep);
    this.name = "ChotKiemSoatError";
  }
}

/** `true` khi `ma` là một mã có dòng trong bảng — người đọc mã do một hàm SQL trả về dùng nó trước khi tin mã. */
export function laMaChot(ma: string): ma is MaChotKiemSoat {
  return Object.hasOwn(CHOT_VAO_SO, ma);
}

/**
 * Từ chối theo một mã chốt — LUÔN ném. Mã vào sổ ⇒ một hàng `CONTROL_DENIED` ở giao dịch ĐỘC LẬP rồi ném
 * `ChotKiemSoatError`, hoặc `DenialAuditFailedError` mang lời từ chối ấy khi không ghi được (vế ⒞ của ADR-060).
 * Mã không vào sổ ⇒ ném thẳng, không chạm `auditPool`.
 *
 * Gọi TRƯỚC mọi tác dụng phụ của thao tác bị chặn: hàm ném, nên giao dịch của người gọi rollback, và thứ duy
 * nhất còn lại là hàng sổ đã commit ở giao dịch riêng.
 */
export async function tuChoiTheoChot(
  auditPool: pg.Pool,
  orgId: string,
  actor: { readonly type: ActorType; readonly id: string },
  rfqId: string,
  ma: MaChotKiemSoat,
): Promise<never> {
  const loi = new ChotKiemSoatError(ma);
  if (!CHOT_VAO_SO[ma].vaoSo) throw loi;
  return await throwAuditedDenial(
    auditPool,
    orgId,
    {
      actorType: actor.type,
      actorId: actor.id,
      action: ACTION_CHOT_KIEM_SOAT,
      resourceType: "RFQ",
      resourceId: rfqId,
      // Chỉ MÃ, không thông điệp — cùng lý do `RFQ_STATE_DENIED` (`packages/danh-gia/src/tu-choi-vao-so.ts`).
      payload: { ma },
    },
    loi,
  );
}
