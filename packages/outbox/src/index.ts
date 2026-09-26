// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/outbox
//
// Danh sách này bị KHOÁ bởi tests/architecture/barrel-exports.test.ts, cùng công cụ và cùng lập
// luận đã dùng cho `crypto-keys` (bất biến G1) và `identity` (D5/E3): một quy tắc biên giới của
// dependency-cruiser canh CẠNH phụ thuộc, nó KHÔNG nhìn thấy symbol, nên một symbol mọc ra ở
// cửa này qua re-export bắc cầu đi lọt mọi cấu hình depcruise.
//
// Đây là gói THỨ BA có danh sách trắng barrel; ~~`audit`, `tenancy`, `db`, `test-support` vẫn
// chưa có (khoản nợ Task 9 §V3.5, nay còn BỐN gói thay vì bốn gói cộng gói này).~~
// [S1.79] Khoản nợ ấy là khoản 9, và nó ĐÓNG 2026-09-07 (S1.18 / ADR-027): cả bốn gói đều đã
// có danh sách trắng, và `[INV-H18]` suy từ TÍNH CHẤT nên danh sách MIỄN TRỪ phải RỖNG.
//
// TIÊU CHÍ dùng để quyết định cái gì được ra cửa, viết ra để lần sau không phải đoán: mỗi
// symbol ở đây là một NĂNG LỰC mọi service gọi được. `KetCucKhongGhiDuocError` và
// `HetGioHandlerError` cố ý ở lại trong gói — chúng là tín hiệu nội bộ giữa `runOnceForOrg` và
// khối bắt lỗi của chính nó, và đưa chúng ra cửa chỉ mời gọi một tầng khác tự phân xử vòng đời
// hạn thuê bằng tay.
// ============================================================================================
export { OutboxError, enqueueJob, type JobInput } from "./enqueue.js";
// [S1.92 / khoản 156] Dấu "giao dịch này đã xếp việc". Ra cửa vì nó là hợp đồng giữa gói này và bộ
// điều phối của `apps/api`: `enqueueJob` đặt dấu, `dispatch.ts` đọc-và-xoá rồi đánh thức runner.
// Giữ nó trong gói thì `apps/api` phải tự khai lại từng chỗ xếp việc — đúng lớp lỗi khoản 156.
export { layDauXepViec } from "./enqueue.js";
// [S1.81 / khoản 154] Sổ `kind` mồ côi. Ra cửa vì nó là hợp đồng GIỮA hai app: `apps/api` truyền
// nó vào `kindKhongNguoiNhan`, và cổng ở `apps/unseal-worker` đối chiếu nó với hợp hai bảng
// handler. Một bản chép ở mỗi app là một bản sẽ trôi.
export { KIND_KHONG_NGUOI_NHAN } from "./so-kind-mo-coi.js";
// [ADR-083] Phép đo tồn đọng của hàng đợi. Ra cửa vì người dùng nó ở NGOÀI gói: `apps/unseal-worker`
// — tiến trình duy nhất liệt kê được MỌI tổ chức — gọi nó trong `withTenant` cho từng tổ chức rồi
// ghi một dòng log mà cảnh báo CloudWatch đọc. Câu SQL ở lại trong gói, cạnh các câu khác của bảng.
export { doTonDong, type TonDong } from "./ton-dong.js";
export {
  JobRunner,
  MAX_ATTEMPTS_LIMIT,
  MAX_BATCH_SIZE,
  MAX_HANDLER_TIMEOUT_MS,
  MAX_LEASE_SECONDS,
  MAX_POLL_INTERVAL_MS,
  MAX_RETRY_DELAY_SECONDS,
  MIN_POLL_INTERVAL_MS,
  type JobFailureReason,
  type JobFailureReport,
  type JobHandler,
  type JobRunnerOptions,
  type OrganizationLister,
  type SauCommit,
  type OutboxJob,
} from "./runner.js";
