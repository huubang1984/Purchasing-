// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/outbox
//
// Danh sách này bị KHOÁ bởi tests/architecture/barrel-exports.test.ts, cùng công cụ và cùng lập
// luận đã dùng cho `crypto-keys` (bất biến G1) và `identity` (D5/E3): một quy tắc biên giới của
// dependency-cruiser canh CẠNH phụ thuộc, nó KHÔNG nhìn thấy symbol, nên một symbol mọc ra ở
// cửa này qua re-export bắc cầu đi lọt mọi cấu hình depcruise.
//
// Đây là gói THỨ BA có danh sách trắng barrel; `audit`, `tenancy`, `db`, `test-support` vẫn
// chưa có (khoản nợ Task 9 §V3.5, nay còn BỐN gói thay vì bốn gói cộng gói này).
//
// TIÊU CHÍ dùng để quyết định cái gì được ra cửa, viết ra để lần sau không phải đoán: mỗi
// symbol ở đây là một NĂNG LỰC mọi service gọi được. `KetCucKhongGhiDuocError` và
// `HetGioHandlerError` cố ý ở lại trong gói — chúng là tín hiệu nội bộ giữa `runOnceForOrg` và
// khối bắt lỗi của chính nó, và đưa chúng ra cửa chỉ mời gọi một tầng khác tự phân xử vòng đời
// hạn thuê bằng tay.
// ============================================================================================
export { OutboxError, enqueueJob, type JobInput } from "./enqueue.js";
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
  type OutboxJob,
} from "./runner.js";
