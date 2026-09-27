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
// ~~BẢNG NÀY LÀ NGUỒN DUY NHẤT CỦA TỪ VỰNG~~ [S1.171] Nguồn ấy nay ở `@trustprocure/identity`
// ----------------------------------------------------------------------------------------------
// `Record` đầy đủ nên một mã thêm vào `MaChotKiemSoat` mà không có dòng ở đây là một lỗi BIÊN DỊCH.
// Chiều kia — một mã mà hàm SQL trả về nhưng không có ở đây — thì kiểu không bắt được: tầng gói ném
// một lỗi KHÔNG tên (500), và phép đo ở `bac-chinh-sach.int.test.ts` so tập mã trong thân hàm với bảng.
// ~~Hôm nay chỉ `packages/rfq` dùng bảng; khi một gói khác cần (K7, K9 ở trao thầu), bảng dời xuống
// một gói cả hai cùng phụ thuộc — không mọc bảng thứ hai.~~ **[S1.171 / khoản 247 / ADR-107]** Gói khác ấy đã tới
// sớm hơn K7: J3 và D2 của `packages/danh-gia` và của `approveRfq`. Bảng, lời từ chối và hàm ghi sổ nay ở
// `packages/identity/src/chot-kiem-soat.ts`; tệp này còn đúng phần của K1 — câu hỏi hàm vị từ SQL và `kiemChot`.
// ==============================================================================================

import type pg from "pg";
import type { ActorType } from "@trustprocure/audit";
import { laMaChot, tuChoiTheoChot } from "@trustprocure/identity";

// [S1.171 / khoản 247] Chép ra cửa của TỆP này (không của gói) cho các test đang đọc từ đây — cùng MỘT đối
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
