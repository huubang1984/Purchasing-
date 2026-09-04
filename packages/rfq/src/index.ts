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
  RFQ_STATUSES,
  RFQ_TRANSITIONS,
  RfqError,
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createRfq,
  extendRfqDeadline,
  getRfq,
  listRfqItems,
  openRfq,
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
// [ADR-017] CHINH SACH MUA SAM. `setRfqBudget` la duong DUY NHAT ha `requires_dual_approval`
// xuong `false`, va no khong ha duoc neu bang chung khong cho phep — vi chinh CSDL tinh phep so
// (`public.rfq_can_phe_duyet_kep`, 014). `createRfq` khong con nhan co ay nua.
// ============================================================================================
export {
  CURRENCIES,
  MONEY_PATTERN,
  createProcurementPolicy,
  getActiveProcurementPolicy,
  setRfqBudget,
  type CreateProcurementPolicyInput,
  type Currency,
  type ProcurementPolicyRecord,
  type RfqBudgetRecord,
  type SetRfqBudgetInput,
} from "./procurement-policy.js";
