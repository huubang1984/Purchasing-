// ==============================================================================================
// [S1.81 / khoản 154] SỔ `kind` MỒ CÔI — NƠI DUY NHẤT KHAI ĐƯỢC "KHÔNG TIẾN TRÌNH NÀO NHẬN"
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO SỔ NÀY PHẢI TỒN TẠI TRƯỚC KHI VỊ TỪ LỌC `kind` TỒN TẠI
// ----------------------------------------------------------------------------------------------
// Tới S1.80, `CAU_CLAIM` không có vị từ `kind`: MỌI runner claim MỌI loại job của tổ chức nó phục
// vụ. Hệ quả đã ĐO trên HEAD `e587819` (§S1.81 mục 1) — runner của tiến trình `api`, bảng handler
// đúng một khoá `LOGIN_LINK_SEND`, nhặt cả ba job còn lại và giết chúng ngay lượt thử THỨ NHẤT:
//
//   UNSEAL_RFQ                   status=FAILED attempts=1 ly_do=NO_HANDLER
//   BREAK_GLASS_UNSEAL_ALERT     status=FAILED attempts=1 ly_do=NO_HANDLER
//   RFQ_DEADLINE_EXTENDED_NOTICE status=FAILED attempts=1 ly_do=NO_HANDLER
//
// Vị từ lọc `kind` đóng lỗ ấy. Nhưng một mình nó ĐỔI MỘT THẤT BẠI ỒN ÀO THÀNH MỘT THẤT BẠI IM
// LẶNG: một `kind` mà KHÔNG tiến trình nào nhận thôi bị claim, nên nó thôi để lại dòng
// `console.error` lẫn hàng `FAILED` — nó chỉ nằm `PENDING` mãi mãi, và không lớp nào trong kho
// đếm tuổi của một hàng `PENDING`.
//
// Sổ này là vế thứ hai. Một `kind` khai ở đây VẪN nằm trong mảng lọc, nên nó VẪN bị claim, VẪN rơi
// vào nhánh `if (!handler)` và VẪN chết ỒN ÀO với `NO_HANDLER` — tín hiệu duy nhất đang tồn tại
// không bị vị từ lọc xoá. Khác biệt với hôm nay: nó chết ở ĐÚNG MỘT tiến trình, do một dòng khai
// tường minh, chứ không do một vị từ nhặt việc quá rộng.
//
// ----------------------------------------------------------------------------------------------
// HỢP ĐỒNG — BA VẾ, VÀ CẢ BA ĐƯỢC CANH Ở `apps/unseal-worker/src/composition.int.test.ts`
// ----------------------------------------------------------------------------------------------
//   ⑴ mọi `kind` được enqueue trong kho phải có handler ở MỘT tiến trình, hoặc nằm ở đây;
//   ⑵ sổ này KHÔNG được giao với hợp hai bảng handler — một `kind` không thể vừa có người nhận
//      vừa mồ côi, và nếu nó giao thì tiến trình khai nhầm sẽ GIẾT job của tiến trình kia;
//   ⑶ mỗi dòng phải trỏ tới một khoản CÒN MỞ trong `docs/STATE.md`. Khoản đóng ⇒ cổng ĐỎ, vì một
//      `kind` mồ côi vĩnh viễn là một tính năng chết chứ không phải một trạng thái ổn định.
//
// ĐÚNG MỘT tiến trình được khai sổ này vào `JobRunnerOptions.kindKhongNguoiNhan` — hôm nay là
// `api` (`apps/api/src/composition.ts`). Worker KHÔNG khai: hai tiến trình cùng khai thì cả hai
// cùng tranh nhau đưa một job mồ côi tới trạng thái cuối, và `attempts` của nó thôi đọc được.
// ==============================================================================================

/**
 * `kind` được enqueue ở đâu đó trong kho mà KHÔNG tiến trình nào có handler.
 *
 * Khoá là `kind`; giá trị là lý do, và lý do PHẢI nêu số khoản còn mở giữ chặng cuối của nó.
 * Thêm một dòng vào đây là khai *"tính năng này chưa có chặng cuối"* — không phải *"job này bỏ
 * qua được"*. Đường ĐÚNG khi một `kind` mới ra đời là viết handler; dòng ở đây là đường TẠM, và
 * vế ⑶ của hợp đồng ở trên tồn tại để nó không ở tạm mãi.
 */
export const KIND_KHONG_NGUOI_NHAN: Readonly<Record<string, string>> = {
  // `packages/rfq/src/rfq.ts` enqueue nó ở hai chỗ khi hạn nộp được gia hạn, nhưng chặng GỬI tới
  // nhà cung cấp chưa tồn tại: `apps/api` chỉ đăng ký `LOGIN_LINK_SEND`, và `apps/unseal-worker`
  // cố ý không nhận (vai `app_unseal` không đọc được `supplier_contacts` — ADR-006).
  RFQ_DEADLINE_EXTENDED_NOTICE: "khoản 154: chặng gửi thông báo gia hạn hạn nộp chưa có handler ở tiến trình nào",
};
