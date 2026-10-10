export { startPostgres, withMigratedDatabase, type TestDatabase } from "./postgres.js";
export { taoBoKyNeoThuNghiem, type BoKyNeoThuNghiem } from "./neo-fixture.js";
export { RELKIND_QUET_GIA, quetGiaMoiQuanHe, type KetQuaQuetGia } from "./quet-gia.js";
// [S1.266 / S3.3c1] Nhà cung cấp đếm được cho chốt K2 — người nhập riêng, MST, người liên hệ, xác minh.
export { nguoiNhapNhaCungCap, nhaCungCapDemDuoc, type NguoiPhien, type NhaCungCapDemDuoc } from "./nha-cung-cap-dem-duoc.js";
// [khoản 346] Chờ qua mốc lật của bộ đếm cửa sổ cố định (`caller_rate_limits`, `otp_rate_limits`) theo giờ CSDL.
export { choQuaMocCuaSo, type TuyChonMocCuaSo } from "./moc-cua-so.js";
// [S1.9101 / S3.7a2 / K8b] Phiên bản Passport THÔ cho fixture — đi trọn năm câu ghi của `118` bằng quyền chủ cụm, mọi trigger vẫn chạy.
export { phienBanPassportTho, type HoSoTho, type PhienBanPassportTho } from "./passport-tho.js";
