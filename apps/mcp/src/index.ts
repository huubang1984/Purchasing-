// ==============================================================================================
// apps/mcp/src/index.ts — CỬA CÔNG KHAI CỦA `apps/mcp`
//
// Không có `main.ts` ở đây: điểm vào của tiến trình tự chạy khi được nạp (`chinh()` ở cuối file
// ấy), nên import nó từ một test sẽ KHỞI ĐỘNG một máy chủ MCP. Vòng lặp giao thức vì thế sống ở
// `vong-lap.ts`, và đó là thứ được export.
// ==============================================================================================

export { CauHinhError, docCauHinh, type CauHinhMcp } from "./cau-hinh.js";
export { CONG_CU, ROUTE_DOC_KHONG_PHOI, thamSoCuaDuong, type CongCuMcp } from "./cong-cu.js";
export { dungDuongDan, ThamSoError } from "./duong-dan.js";
export {
  MO_DAU_DU_LIEU,
  PHIEN_BAN_MAY_CHU,
  PHIEN_BAN_MCP,
  TEN_MAY_CHU,
  xuLyYeuCau,
  type GoiApi,
  type KetQuaApi,
  type PhuThuoc,
} from "./giao-thuc.js";
export { NHAN_MAY_KHACH, taoGoiApi, TEN_COOKIE_PHIEN, TRAN_THAN_BYTE } from "./khach-api.js";
export { taoBoGomDong, TRAN_DONG_KY_TU, type BoGomDong } from "./khung-dong.js";
export { taoVongLap, type PhuThuocVongLap } from "./vong-lap.js";
