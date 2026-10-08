// ==============================================================================================
// [S1.282 / S3.5b — cầu tới S3.4b] LỜI KHAI *KHÔNG XUNG ĐỘT* CHO NHỮNG NGƯỜI CÔNG CỤ KÝ THAY (K9, ADR-155)
//
// Từ S3.4a (`114`, ADR-155 ⑷) bảy cổng của tổ chức đã bật S3 — chữ ký duyệt gói, lượt chấm, đề xuất, chữ ký duyệt trao thầu, huỷ, xác
// minh, ghi nhận tín hiệu — đòi người hành động có lời khai `KHONG_XUNG_DOT` mang băm danh sách mời HIỆN TẠI khi bậc ghim bật
// `khai_xung_dot`; bốn bậc mặc định của `BAC_DEMO` đều bật. ADR-155 ⑻ xếp việc *"gieo:demo --s3 khai cho những người nó ký thay"* vào
// S3.4b (cùng màn khai báo); vòng S3.5b tới trước, và một gói không ai khai thì không duyệt, không chấm, không trao được — nên đây là
// phần tối thiểu của việc ấy: khai cho ĐÚNG những người công cụ sắp ký thay (và cho những người phần in ra bảo đi tay ở màn chưa có ô
// khai), SAU khi danh sách mời của gói đã đủ — thêm hay thu hồi lời mời sau lời khai làm nó lỗi thời (ADR-155 ⑴). Khai qua hàm gói
// (cổng `coi.declare`, hàng sổ, trigger ghim băm) — không chèn thẳng. Màn khai báo và phần còn lại của `gieo:demo` là S3.4b.
// ==============================================================================================

import type pg from "pg";
import { khaiBaoXungDot } from "@trustprocure/kiem-soat";
import { withTenant } from "@trustprocure/tenancy";

/** Mỗi người một giao dịch: trigger khai báo lấy khoá (gói, người) — hai người khác nhau không chờ nhau. */
export async function khaiKhongXungDot(pool: pg.Pool, org: string, rfqId: string, nguoi: readonly { readonly sessionId: string }[]): Promise<void> {
  for (const n of nguoi) {
    await withTenant(pool, org, (c) =>
      khaiBaoXungDot(c, org, { rfqId, trangThai: "KHONG_XUNG_DOT", ghiChu: "gieo demo: khong co loi ich o nha cung cap nao cua goi", actorSessionId: n.sessionId }, pool),
    );
  }
}
