// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/bidding
//
// Canh bởi hai lớp bổ túc nhau, cùng khuôn các gói trước: danh sách trắng ở
// tests/architecture/barrel-exports.test.ts canh SYMBOL đi qua cửa, họ quy tắc `g9-` của
// dependency-cruiser canh việc KHÔNG AI ĐI VÒNG QUA CỬA.
//
// Bất biến có tên đang được giữ ở cửa này: **`verifyReceipt` phải kiểm chứng được bằng khoá công
// khai MỘT MÌNH.** Đó là toàn bộ nội dung của B2, và §"Rủi ro của việc để mở" của ADR-011 đã đặt
// tên cho cách nó bị phá: *chốt mục 2 dưới áp lực tiến độ bằng một HMAC "cho nhanh" — nó chạy,
// test xanh, và B2 bị vi phạm trong im lặng vì không ai thử đóng vai nhà cung cấp đi kiểm chứng*.
//
// Vì vậy chữ ký của `verifyReceipt` là một hàng rào: nó nhận ĐÚNG ba thứ — văn bản, chữ ký, khoá
// công khai — và không nhận `client`, không nhận `orgId`, không nhận vòng khoá. Một phiên bản
// tương lai thêm một tham số "chỉ máy chủ mới có" vào đây là một phiên bản phá B2, và nó sẽ phải
// đi qua diff của file này.
// ============================================================================================
export {
  RECEIPT_FORMAT_LABEL,
  RECEIPT_SIGNING_ALGORITHM,
  ReceiptError,
  buildReceiptText,
  derToRawSignature,
  parseReceiptText,
  rawToDerSignature,
  sha256Hex,
  verifyReceipt,
  type ReceiptFields,
  type VerifyReceiptInput,
} from "./receipt.js";
export {
  ReceiptSigningKeyRing,
  createLocalDevReceiptSigner,
  type ReceiptKeyPair,
  type ReceiptSigner,
} from "./signer.js";
export {
  BiddingError,
  getBidReceipt,
  listBidVersions,
  submitBid,
  type BidReceiptRecord,
  type BidVersionRecord,
  type SubmitBidInput,
} from "./bidding.js";
