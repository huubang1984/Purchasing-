export { TU_CHOI_CHU_BANG_FORCE, TU_CHOI_DOI_VAI, TU_CHOI_GUC_SOM, TU_CHOI_KHOA_MIGRATE, TU_CHOI_TRUOC_VONG, migrate } from "./migrate.js";
export { createPool, type TuyChonPool } from "./pool.js";
// [S1.11] Cơ chế gắn vai ứng dụng — một bản, dùng chung với test-support (xem đầu vai-tro.ts).
export {
  KetNoiNhiemError,
  TU_CHOI_KET_NOI_NHIEM,
  VAI_UNG_DUNG,
  ganVaiTroChoPool,
  khangDinhPhienDangNhapUngDung,
  laVaiUngDung,
  type VaiUngDung,
} from "./vai-tro.js";
// [khoản 165] Dấu kiểm vòng khoá bọc — `apps/api` và `apps/unseal-worker` đối chiếu lúc khởi động (`062`).
export { DauKiemVongKhoaLechError, doiChieuDauKiemVongKhoa, tinhDauKiemKhoa } from "./dau-kiem-vong-khoa.js";
