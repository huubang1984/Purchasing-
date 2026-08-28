/**
 * Mã quyền dùng trong toàn hệ thống. Phải khớp NGUYÊN VĂN bảng `permissions` trong
 * db/migrations/005_identity.sql — có meta-test đọc cả hai và so sánh (khuôn §R3 đã dùng cho
 * thân `app_current_org_id()` và thân `noi_chuoi_kiem_toan()`).
 */
export const PERMISSIONS = {
  RFQ_CREATE: "rfq.create",
  RFQ_APPROVE: "rfq.approve",
  RFQ_INVITE: "rfq.invite",
  RFQ_UNSEAL: "rfq.unseal",
  RFQ_UNSEAL_APPROVE: "rfq.unseal.approve",
  BID_VIEW: "bid.view",
  EVALUATION_PERFORM: "evaluation.perform",
  AWARD_RECOMMEND: "award.recommend",
  PO_APPROVE: "po.approve",
  SUPPLIER_MANAGE: "supplier.manage",
  AUDIT_READ: "audit.read",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Chuỗi năm bước của bất biến **D3** (docs/TEST-PLAN.md): *"Chuỗi tạo RFQ → chọn nhà cung cấp
 * → mở thầu → award → duyệt không nằm trọn trong tay một người (ma trận mục 25)"*.
 *
 * Đây KHÔNG phải một hằng số tiện dụng — nó là phát biểu máy-đọc-được của một bất biến, và nó
 * tồn tại ở BA nơi phải khớp nhau:
 *   1. đây;
 *   2. thân trigger `public.kiem_tra_phan_tach_nhiem_vu()` — db/migrations/005_identity.sql,
 *      cưỡng chế ở mức NGƯỜI DÙNG vào THỜI ĐIỂM GHI;
 *   3. mục (E2) của db/migrations/hardening.always.sql — phán xét ở mức VAI TRÒ vào THỜI ĐIỂM
 *      DEPLOY.
 * Ba bản khớp nhau là điều kiện để ba lớp nói về CÙNG MỘT bất biến; có meta-test khoá cả ba
 * (packages/identity/src/ma-tran-quyen.test.ts), vì một trong ba trôi đi là kiểu hỏng mà không
 * test hành vi nào bắt được.
 *
 * Thứ tự của mảng là thứ tự nghiệp vụ của chuỗi, không phải thứ tự bảng chữ cái — nó được đọc
 * bởi người, và thông báo lỗi của trigger nhắc lại đúng thứ tự này.
 */
export const SEPARATION_OF_DUTIES_CHAIN = [
  PERMISSIONS.RFQ_CREATE,
  PERMISSIONS.RFQ_INVITE,
  PERMISSIONS.RFQ_UNSEAL,
  PERMISSIONS.AWARD_RECOMMEND,
  PERMISSIONS.PO_APPROVE,
] as const satisfies readonly Permission[];
