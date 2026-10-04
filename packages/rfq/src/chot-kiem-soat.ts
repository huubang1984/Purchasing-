// ==============================================================================================
// [S1.166 / S3.1b / ADR-084 ⑷] LỚP TỪ CHỐI THỨ BA CỦA K12 — `CONTROL_DENIED`
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
// ~~BẢNG NÀY LÀ NGUỒN DUY NHẤT CỦA TỪ VỰNG~~ [S1.180] Nguồn ấy nay ở `@trustprocure/identity`
// ----------------------------------------------------------------------------------------------
// `Record` đầy đủ nên một mã thêm vào `MaChotKiemSoat` mà không có dòng ở đây là một lỗi BIÊN DỊCH.
// Chiều kia — một mã mà hàm SQL trả về nhưng không có ở đây — thì kiểu không bắt được: tầng gói ném
// một lỗi KHÔNG tên (500), và phép đo ở `bac-chinh-sach.int.test.ts` so tập mã trong thân hàm với bảng.
// ~~Hôm nay chỉ `packages/rfq` dùng bảng; khi một gói khác cần (K7, K9 ở trao thầu), bảng dời xuống
// một gói cả hai cùng phụ thuộc — không mọc bảng thứ hai.~~ **[S1.180 / khoản 247 / ADR-108]** Gói khác ấy đã tới
// sớm hơn K7: J3 và D2 của `packages/danh-gia` và của `approveRfq`. Bảng, lời từ chối và hàm ghi sổ nay ở
// `packages/identity/src/chot-kiem-soat.ts`; tệp này còn đúng phần của K1 — câu hỏi hàm vị từ SQL và `kiemChot`.
// ==============================================================================================

import type pg from "pg";
import type { ActorType } from "@trustprocure/audit";
import { laMaChot, tuChoiTheoChot } from "@trustprocure/identity";

// [S1.180 / khoản 247] Chép ra cửa của TỆP này (không của gói) cho các test đang đọc từ đây — cùng MỘT đối
// tượng với bản ở `identity`, không phải bảng thứ hai.
export { ACTION_CHOT_KIEM_SOAT, CHOT_VAO_SO, ChotKiemSoatError, type MaChotKiemSoat } from "@trustprocure/identity";

/**
 * Câu hỏi hàm vị từ của K1 (`072_bac_cua_goi`): `$1` tổ chức, `$2` gói, mốc là giờ thật lúc hỏi. Câu đứng ở đây, cạnh
 * bảng, vì `kiemChot` là chỗ gọi `.query(`: bộ đọc QT3 (`tests/architecture/qt3-doc-sql.ts`) rút câu theo TỆP, và một
 * tệp gọi `.query(` mà không mang câu nào là một hình dạng nó mù.
 */
export const CAU_CHOT_NGAN_SACH =
  "SELECT public.rfq_chot_ngan_sach($1::pg_catalog.uuid, $2::pg_catalog.uuid, pg_catalog.clock_timestamp()) AS ly_do";

/**
 * [S1.201 / S3.6a] Câu hỏi chốt nhóm hàng (`085_nhom_hang`): `$1` tổ chức, `$2` gói. Hàm vị từ nhận GIÁ TRỊ cột nhóm hàng — trigger
 * ở cạnh đưa giá trị MỚI —, còn câu này đưa giá trị của hàng DRAFT; gói không ở DRAFT thì không hàng nào, tức cho qua, và câu
 * ghi của thao tác nói lời từ chối trạng thái — tầng gói không ghi sổ cho một lời gọi sai gói, như K1.
 */
export const CAU_CHOT_NHOM_HANG =
  "SELECT public.rfq_chot_nhom_hang(r.org_id, r.category_id) AS ly_do FROM public.rfq_packages r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "AND r.status OPERATOR(pg_catalog.=) 'DRAFT'";

/**
 * [S1.203 / S3.6b1] Câu hỏi chốt K10a ở cạnh mở gói (`088_tin_hieu_chia_nho`): `$1` tổ chức, `$2` gói. Hàm vị từ tính tín hiệu
 * chia nhỏ NGAY LÚC HỎI và đòi một lần ghi nhận trên một tín hiệu có bằng chứng bằng nó; gói không ở PENDING_APPROVAL thì không
 * hàng nào, tức cho qua, và câu mở nói lời từ chối trạng thái — như K1.
 */
export const CAU_CHOT_TIN_HIEU =
  "SELECT public.rfq_chot_tin_hieu(r.org_id, r.id) AS ly_do FROM public.rfq_packages r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "AND r.status OPERATOR(pg_catalog.=) 'PENDING_APPROVAL'";

/**
 * [S1.9101 / S3.3c2] Câu hỏi chốt K2 ở cạnh nộp duyệt (`9501_canh_tranh_toi_thieu`): `$1` tổ chức, `$2` gói. Hàm vị từ đọc hàng gói
 * và tự cho qua khi gói không ở DRAFT — như K1: câu ghi của thao tác nói lời từ chối trạng thái.
 */
export const CAU_CHOT_CANH_TRANH =
  "SELECT public.rfq_chot_canh_tranh($1::pg_catalog.uuid, $2::pg_catalog.uuid) AS ly_do";

/**
 * [S1.9101 / S3.3c2] Câu hỏi chốt K5 ở cạnh mở gói (`9501_canh_tranh_toi_thieu`): `$1` tổ chức, `$2` gói. Hàm vị từ tự cho qua khi
 * gói không ở PENDING_APPROVAL, khi bậc không đòi và gói không có ngoại lệ còn sống, hay khi số chữ ký còn hiệu lực chưa đủ — lời
 * từ chối ấy là của K4b ở trigger, không phải lần lách chốt (ADR-060).
 */
export const CAU_CHOT_CHU_KY_DOC_LAP =
  "SELECT public.rfq_chot_chu_ky_doc_lap($1::pg_catalog.uuid, $2::pg_catalog.uuid) AS ly_do";

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
  await tuChoiTheoChot(auditPool, orgId, actor, rfqId, ma);
}
