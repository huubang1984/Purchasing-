// ==============================================================================================
// [S1.283 / S3.4b · K9] LỜI KHAI *KHÔNG XUNG ĐỘT* CHO NHỮNG CHỮ KÝ CÔNG CỤ GHI THAY
//
// Bậc demo (`BAC_DEMO`, như bậc mặc định của màn `/chinh-sach`) bật `khai_xung_dot` ở mọi bậc thường, nên từ S3.4a (`114`) một chữ ký
// duyệt gói, một lượt chấm hay một chữ ký trao thầu của người CHƯA khai *không xung đột* với danh sách mời hiện tại bị trigger chặn
// (K9). `gieo:demo --s3` ký thay vài người để dựng bối cảnh — gói 9 tỷ chờ nhà cung cấp nộp, ba gói tín hiệu chia nhỏ, ba gói đã
// mở —, nên nó khai thay ĐÚNG những người ấy, TRƯỚC chữ ký, bằng hàm gói thật (`khaiBaoXungDot`: phiên của người khai, băm danh sách
// do trigger đặt, một hàng sổ `COI_DECLARED`). Mọi bước người demo tự đi trên màn — ghi nhận tín hiệu, gói một nguồn, chấm, đề xuất,
// duyệt — để họ tự khai ở khối «Khai báo xung đột lợi ích»: đó chính là thứ S3.4b đưa lên màn.
//
// Gọi SAU khi danh sách mời của gói đã chốt (lời mời dựng ở DRAFT ở tổ chức đã bật): một lời mời thêm sau đó làm lời khai lỗi thời.
// ==============================================================================================

import type pg from "pg";
import { khaiBaoXungDot } from "@trustprocure/kiem-soat";
import { withTenant } from "@trustprocure/tenancy";

/** Khai *không xung đột* của `nguoi` trên gói `rfqId`, ở giao dịch riêng — hàng sổ của lời khai không chen vào giao dịch của chữ ký. */
export async function khaiKhongXungDot(pool: pg.Pool, org: string, rfqId: string, nguoi: { readonly sessionId: string }): Promise<void> {
  await withTenant(pool, org, (c) => khaiBaoXungDot(c, org, { rfqId, trangThai: "KHONG_XUNG_DOT", actorSessionId: nguoi.sessionId }, pool));
}
