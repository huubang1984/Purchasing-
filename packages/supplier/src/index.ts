// ============================================================================================
// MẶT TIỀN CÔNG KHAI CỦA @trustprocure/supplier
//
// Danh sách export ở đây được canh bởi tests/architecture/barrel-exports.test.ts (danh sách
// trắng), và ĐƯỜNG VÒNG QUA CỬA bị chặn bởi họ quy tắc `g5-` của dependency-cruiser. Hai lớp bổ
// túc cho nhau: một lớp canh SYMBOL đi qua cửa, lớp kia canh việc KHÔNG AI ĐI VÒNG QUA CỬA.
//
// Đây là gói ĐẦU TIÊN của dự án ra đời đã có ĐỦ cả hai. Ba gói trước phải mua chúng bằng ba vòng
// fix riêng biệt sau khi lỗ đã đo được (crypto-keys -> `g1-`, identity -> `g2-`/H11, outbox ->
// `g4-`/H13), và khoản nợ 17 ghi rằng bốn gói còn lại vẫn chưa có. Khoản nợ đó KHÔNG được đóng
// bởi file này — nó chỉ không lớn thêm.
// ============================================================================================
export {
  SUPPLIER_LEVELS,
  SUPPLIER_STATUSES,
  EMAIL_PATTERN,
  PHONE_PATTERN,
  SupplierError,
  TAX_CODE_PATTERN,
  addSupplierContact,
  createSupplier,
  findSupplierByTaxCode,
  getSupplier,
  listSupplierContacts,
  listSuppliers,
  type AddSupplierContactInput,
  type CreateSupplierInput,
  type SupplierContactRecord,
  type SupplierLevel,
  type SupplierRecord,
  type SupplierStatus,
} from "./suppliers.js";
