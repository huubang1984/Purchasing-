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
// [S1.196 / S3.3a / K8a] Xác minh nội bộ nhà cung cấp — ghi dưới `supplier.qualify`, trigger `ncc_kiem_xac_minh` có thẩm quyền.
export {
  docHoSoXacMinh,
  docXacMinhNhaCungCap,
  thuHoiXacMinhNhaCungCap,
  xacMinhNhaCungCap,
  type HoSoXacMinh,
  type NguoiLienHeXacMinh,
  type XacMinhNhaCungCap,
} from "./xac-minh.js";
// [S1.287 / S3.7a1 / ADR-081] Supplier Passport — yêu cầu hồ sơ (bên mua, `supplier.qualify`), phiên bản hồ sơ (nhà cung cấp), hai
// lời đọc. Cột số tài khoản chỉ được đọc ở `passport.ts` (ranh giới cột ở tầng mã — `tests/architecture/so-tai-khoan-liet-ke.test.ts`).
export {
  CAU_TU_CHOI_PASSPORT,
  MA_TU_CHOI_PASSPORT,
  PassportYeuCauError,
  SO_TAI_KHOAN_PATTERN,
  TRAN_DANH_SACH_PASSPORT,
  docHoSoPassport,
  docHoSoPassportNhap,
  docPassportCuaToi,
  nopPhienBanPassport,
  taoYeuCauPassport,
  taoYeuCauPassportTuDeXuat,
  type HoSoPassport,
  type HoSoPassportBenMua,
  type KetQuaYeuCauPassport,
  type KetQuaYeuCauTuDeXuat,
  type MaTuChoiPassport,
  type PhienBanPassportCuaToi,
} from "./passport.js";
// [S1.9101 / S3.7a2 / K8b · ADR-081 ⑵ ⑸] Thẩm định đầy đủ trên phiên bản Passport mới nhất — ghi dưới `supplier.qualify`, trigger
// `ncc_kiem_tham_dinh` có thẩm quyền; một hàm đọc trạng thái.
export {
  docThamDinhNhaCungCap,
  thamDinhNhaCungCap,
  thuHoiThamDinhNhaCungCap,
  type ThamDinhNhaCungCap,
} from "./tham-dinh.js";
