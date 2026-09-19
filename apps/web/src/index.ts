// ==============================================================================================
// MẶT TIỀN CỦA @trustprocure/web — [ADR-044] LÁT CẮT DEMO
//
// App này không phải một thư viện: không service nào import nó. Barrel tồn tại để `main.ts` và
// bộ test có ĐÚNG MỘT cửa, đúng khuôn ba app còn lại. Mỗi symbol một dòng lý do:
//
//   * `docCauHinh`, `CauHinhError`, `CauHinhWeb` — đọc môi trường thành cấu hình; `main.ts` gọi,
//     và `cau-hinh.test.ts` đo từng ca hỏng mà không cần dựng tiến trình.
//   * `taoWebServer` — dựng máy chủ; test tích hợp gọi nó với một cổng ngẫu nhiên.
//   * `docTls` — đọc cặp PEM; tách riêng để `taoWebServer` không tự chạm đĩa.
//   * `napTep` — nạp bản đồ tệp; `phuc-vu.test.ts` gọi thẳng để đo rằng mọi tệp khai trong `TRANG`
//     có thật và mọi module trình duyệt gỡ kiểu được.
//   * `TRANG`, `MODULE_TRINH_DUYET`, `DUONG_TRANG` — ba lời khai mà cổng kiến trúc đối chiếu với
//     đĩa và với cây import thật.
// ==============================================================================================

export { CauHinhError, docCauHinh, type CauHinhWeb } from "./cau-hinh.js";
export { DUONG_TRANG, MODULE_TRINH_DUYET, TRANG, docTls, napTep, taoWebServer, type TuyChonWeb } from "./phuc-vu.js";
