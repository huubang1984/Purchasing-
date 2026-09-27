// ==============================================================================================
// [S1.158 / S3.1b / ADR-084 ⑷] LỚP TỪ CHỐI THỨ BA CỦA K12 — `CONTROL_DENIED`
//
// Ba lớp tách nhau (ADR-084 ⑸): `PERMISSION_DENIED` — thiếu quyền; `RFQ_STATE_DENIED` — đi sai thứ tự
// (`packages/danh-gia/src/tu-choi-vao-so.ts`); `CONTROL_DENIED` — đủ quyền, đúng thứ tự, nhưng một CHỐT
// KIỂM SOÁT của S3 chặn. Mỗi chốt là MỘT hàm vị từ SQL trả NULL hay một mã (K12); tầng gói gọi nó TRƯỚC
// mọi tác dụng phụ, và trigger ở cạnh gọi lại chính nó. Mã đi qua bảng dưới đây rồi mới ra ngoài.
//
// Luật chọn lọc của ADR-060 giữ nguyên: lời từ chối nói NGƯỜI DÙNG cố đi tắt một chốt thì vào sổ;
// lời từ chối nói dữ liệu hay cấu hình vừa đổi dưới chân họ thì không. Hàng sổ ở giao dịch ĐỘC LẬP
// qua `throwAuditedDenial`, và payload chỉ mang MÃ.
//
// ----------------------------------------------------------------------------------------------
// BẢNG NÀY LÀ NGUỒN DUY NHẤT CỦA TỪ VỰNG
// ----------------------------------------------------------------------------------------------
// `Record` đầy đủ nên một mã thêm vào `MaChotKiemSoat` mà không có dòng ở đây là một lỗi BIÊN DỊCH.
// Chiều kia — một mã mà hàm SQL trả về nhưng không có ở đây — thì kiểu không bắt được: tầng gói ném
// một lỗi KHÔNG tên (500), và phép đo ở `bac-chinh-sach.int.test.ts` so tập mã trong thân hàm với bảng.
// Hôm nay chỉ `packages/rfq` dùng bảng; khi một gói khác cần (K7, K9 ở trao thầu), bảng dời xuống
// một gói cả hai cùng phụ thuộc — không mọc bảng thứ hai.
// ==============================================================================================

import type pg from "pg";
import type { ActorType } from "@trustprocure/audit";
import { throwAuditedDenial } from "@trustprocure/identity";

/** Toàn bộ từ vựng chốt kiểm soát của S3. Thêm một mã là thêm một dòng ở `CHOT_VAO_SO`. */
export type MaChotKiemSoat = "BAC_LECH_HAM_PHAN_BAC" | "NGAN_SACH_GHIM_BAN_CU" | "THIEU_NGAN_SACH";

export interface DongChot {
  /** Bất biến nhóm K mà chốt này cưỡng chế. */
  readonly chot: `K${number}`;
  /** `true` ⇒ lần từ chối này để lại một hàng `CONTROL_DENIED` ở giao dịch ĐỘC LẬP. */
  readonly vaoSo: boolean;
  /** Vì sao — và nó phải trả lời được câu *"kiểm toán viên có hỏi tới ca này không"*. */
  readonly lyDo: string;
  /** Thông điệp cho người dùng: nói phải làm gì, không nội suy dữ liệu nào. */
  readonly thongDiep: string;
}

/** Mỗi mã, một quyết định, một lý do. Hai quyết định `vaoSo` của K1 là của chủ dự án (S1.158). */
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
};

/** `action` của hàng sổ. MỘT mã cho mọi chốt; chốt cụ thể đi vào `payload`. */
export const ACTION_CHOT_KIEM_SOAT = "CONTROL_DENIED";

/**
 * Câu hỏi hàm vị từ của K1 (`070_bac_cua_goi`): `$1` tổ chức, `$2` gói, mốc là giờ thật lúc hỏi. Câu đứng ở đây, cạnh
 * bảng, vì `kiemChot` là chỗ gọi `.query(`: bộ đọc QT3 (`tests/architecture/qt3-doc-sql.ts`) rút câu theo TỆP, và một
 * tệp gọi `.query(` mà không mang câu nào là một hình dạng nó mù.
 */
export const CAU_CHOT_NGAN_SACH =
  "SELECT public.rfq_chot_ngan_sach($1::pg_catalog.uuid, $2::pg_catalog.uuid, pg_catalog.clock_timestamp()) AS ly_do";

/** Lời từ chối có tên của một chốt kiểm soát. `dispatch.ts` trả nó ra dưới 422 kèm thông điệp. */
export class ChotKiemSoatError extends Error {
  constructor(readonly lyDo: MaChotKiemSoat) {
    super(CHOT_VAO_SO[lyDo].thongDiep);
    this.name = "ChotKiemSoatError";
  }
}

function laMaChot(ma: string): ma is MaChotKiemSoat {
  return Object.hasOwn(CHOT_VAO_SO, ma);
}

/**
 * Hỏi một hàm vị từ của chốt rồi ném theo bảng. Gọi TRƯỚC mọi tác dụng phụ của thao tác.
 *
 * `cau` là một câu SQL trả đúng một cột `ly_do` — NULL khi cho qua. Mã lạ ⇒ lỗi KHÔNG tên: hàm SQL và
 * bảng đã trôi khỏi nhau, và một lời từ chối có tên với thông điệp đoán mò tệ hơn một sự cố có log.
 */
export async function kiemChot(
  client: pg.PoolClient,
  auditPool: pg.Pool,
  orgId: string,
  actor: { readonly type: ActorType; readonly id: string },
  rfqId: string,
  cau: string,
  thamSo: readonly unknown[],
): Promise<void> {
  const { rows } = await client.query<{ ly_do: string | null }>(cau, [...thamSo]);
  const ma = rows[0]?.ly_do ?? null;
  if (ma === null) return;
  if (!laMaChot(ma)) {
    throw new Error("hàm vị từ của chốt trả một mã không có trong CHOT_VAO_SO — hai bên đã trôi khỏi nhau");
  }
  const loi = new ChotKiemSoatError(ma);
  if (!CHOT_VAO_SO[ma].vaoSo) throw loi;
  await throwAuditedDenial(
    auditPool,
    orgId,
    {
      actorType: actor.type,
      actorId: actor.id,
      action: ACTION_CHOT_KIEM_SOAT,
      resourceType: "RFQ",
      resourceId: rfqId,
      // Chỉ MÃ, không thông điệp — cùng lý do `RFQ_STATE_DENIED` (`tu-choi-vao-so.ts`).
      payload: { ma },
    },
    loi,
  );
}
