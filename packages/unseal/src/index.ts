// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/unseal
//
// Bất biến có tên đang được giữ ở cửa này: **cổng chính sách D1 chỉ có MỘT hình dạng ra ngoài,
// và nó là hình dạng NÉM.** `assertUnsealAllowed` không trả `boolean`, không trả `null`, và
// không có phiên bản `canUnseal` nào — cùng tiêu chí đã rút `hasPermission` khỏi mặt tiền của
// `@trustprocure/identity`: một cổng gác trả giá trị là một cổng gác người gọi quên kiểm được.
//
// `UNSEAL_CLAUSES` và `UnsealDeniedError` ra cửa CÓ CHỦ ĐÍCH, và không phải để trang trí giao
// diện: chúng là thứ làm phép hội ĐO ĐƯỢC. Một cổng chỉ ném `Error("bị từ chối")` sẽ làm bốn
// test của bốn vế không phân biệt được vế nào đã chặn — và lúc ấy bốn test đo đúng một thứ.
//
// KHÔNG có hàm nào ở đây giải mã. Đường ấy nằm ở `apps/unseal-worker`, và `dispatchUnseal` chỉ
// đặt một job vào hàng đợi — ADR-006: *"`api` không có quyền giải mã và chỉ được YÊU CẦU mở thầu
// qua hàng đợi"*.
// ============================================================================================
export {
  UNSEAL_CLAUSES,
  UNSEAL_MFA_MAX_AGE_SECONDS,
  UnsealDeniedError,
  assertUnsealAllowed,
  type UnsealClause,
  type UnsealGateInput,
  type UnsealGateReport,
} from "./gate.js";
// [S1.7] `buildComparisonTable` ra cửa với CÙNG tiêu chí hình dạng: nó NÉM cho RFQ chưa mở thầu
// thay vì trả về một bảng rỗng. Một bảng rỗng là một câu trả lời — và "0 báo giá dưới ngân sách"
// vẫn là một trường phái sinh mà A4 cấm nói trước giờ mở.
//
// `countReceivedBids` thì KHÔNG ném, và đó không phải một ngoại lệ của tiêu chí trên: nó trả về
// một union mà nhánh giấu KHÔNG MANG trường `count`. Kiểu ấy làm người gọi không lỡ đọc được con
// số, tức nó cưỡng chế bằng hình dạng chứ không bằng lời hứa — cùng thứ mà một lần ném làm.
export {
  COMPARISON_ALLOWED_STATUSES,
  ComparisonDeniedError,
  ComparisonError,
  buildComparisonTable,
  countReceivedBids,
  type BidCountDisclosure,
  type ComparisonAggregates,
  type ComparisonInput,
  type ComparisonRow,
  type ComparisonTable,
} from "./comparison.js";
export {
  UNSEAL_JOB_KIND,
  UnsealError,
  approveUnseal,
  cancelUnseal,
  dispatchUnseal,
  getUnsealRequest,
  requestUnseal,
  type ApproveUnsealInput,
  type CancelUnsealInput,
  type DispatchUnsealInput,
  type RequestUnsealInput,
  type UnsealRequestRecord,
} from "./requests.js";
