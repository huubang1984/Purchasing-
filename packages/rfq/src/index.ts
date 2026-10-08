// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/rfq
//
// Canh bởi hai lớp bổ túc nhau, cùng khuôn `packages/supplier`: danh sách trắng ở
// tests/architecture/barrel-exports.test.ts canh SYMBOL đi qua cửa, họ quy tắc `g6-` của
// dependency-cruiser canh việc KHÔNG AI ĐI VÒNG QUA CỬA.
//
// `RFQ_TRANSITIONS` xuất ra CÓ CHỦ ĐÍCH, và nó là symbol dễ bị hiểu sai nhất ở đây: nó là bản
// sao ĐỂ ĐỌC của bảng cạnh trong 009, KHÔNG phải lớp cưỡng chế. Ai dựng một cổng gác bằng nó sẽ
// canh được đúng đường đi qua cổng ấy, trong khi trigger canh mọi đường. Có test đọc thẳng file
// SQL và đòi hai bên khớp — nên nó không trôi được, nhưng nó vẫn không phải hàng rào.
// ============================================================================================
export {
  RFQ_DEADLINE_NOTICE_KIND,
  RFQ_STATUSES,
  RFQ_TRANSITIONS,
  RfqError,
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createRfq,
  // [S1.201 / S3.6a] Gán hay đổi nhóm hàng của một gói ĐANG SOẠN — route đòi `rfq.create`, như ngân sách và hạng mục.
  datNhomHangChoGoi,
  // [S1.9101 / S4.7b1] Số ngày giao yêu cầu của một gói ĐANG SOẠN — route `PUT /rfqs/:rfqId/delivery-days` đòi `rfq.create`, như nhóm
  // hàng; `SO_NGAY_GIAO_TOI_DA` là biên của `CHECK` `112`, cửa HTTP dùng nó để nói miền trước khi gói nói.
  datSoNgayGiao,
  SO_NGAY_GIAO_TOI_DA,
  extendRfqDeadline,
  getRfq,
  listRfqItems,
  openRfq,
  returnRfqToDraft,
  submitRfqForApproval,
  type AddRfqItemInput,
  type ApproveRfqInput,
  type CloseRfqInput,
  type CreateRfqInput,
  type ExtendDeadlineInput,
  type OpenRfqInput,
  type RfqItemRecord,
  type RfqRecord,
  type RfqStatus,
} from "./rfq.js";
// ============================================================================================
// [S1.201 / S3.6a] NHÓM HÀNG — danh sách của tổ chức, khoá của tín hiệu chia nhỏ (K10). Hai hàm ghi hỏi `category.manage` ở
// chính hàm (cổng ở hàm, khuôn xác minh nhà cung cấp); hàm đọc không mang giá.
// ============================================================================================
export { doiTrangThaiNhomHang, lietKeNhomHang, taoNhomHang, type NhomHang } from "./nhom-hang.js";
// ============================================================================================
// [ADR-017] CHINH SACH MUA SAM. `setRfqBudget` la duong DUY NHAT ha `requires_dual_approval`
// xuong `false`, va no khong ha duoc neu bang chung khong cho phep — vi chinh CSDL tinh phep so
// (`public.rfq_can_phe_duyet_kep`, 014). `createRfq` khong con nhan co ay nua.
// ============================================================================================
export {
  CURRENCIES,
  MONEY_PATTERN,
  createProcurementPolicy,
  getActiveProcurementPolicy,
  // [S1.169 / S3.1c] Lần ký chính sách (bật S3) và danh sách phiên bản cho màn `/chinh-sach`.
  kyPhienBanChinhSach,
  lietKePhienBanChinhSach,
  setRfqBudget,
  // [S1.200 / khoản 258] Đọc ngân sách cho người duyệt — hàm đọc có cổng (người tạo: `rfq.create`; người khác: `rfq.approve`).
  getRfqBudget,
  type RfqBudgetView,
  type ChuKyChinhSach,
  type DanhSachChinhSach,
  type PhienBanChinhSach,
  type CreateProcurementPolicyInput,
  type Currency,
  type ProcurementPolicyRecord,
  // [S1.107 / lượt soi ngang 77 — CAO ②] Hình dạng một thành phần trọng số, đúng ba khoá mà
  // `CHECK` của `057` cưỡng chế. Ra cửa vì `apps/api` phải đọc thân yêu cầu thành kiểu ấy —
  // một cách viết thứ hai ở tầng HTTP là cách viết THỨ BA cho cùng một hợp đồng.
  type ThanhPhanTrongSoVao,
  type RfqBudgetRecord,
  type SetRfqBudgetInput,
} from "./procurement-policy.js";
