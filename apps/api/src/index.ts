// Cửa công khai của apps/api. ~~Không có `main`: tiến trình chạy thật (composition root với pool,
// pepper, khoá ký) là việc của S1.10.6, khi có đủ thứ để tiêm.~~ [S1.11 / ADR-021] Câu trên đã
// thiu: S1.10.6 làm bộ quét rò rỉ, không làm composition root. Nay có `main.ts` (điểm vào),
// `composition.ts` (dựng pool có vai, ba vòng bí mật, bộ ký, hộp thư dev) và `cau-hinh.ts` (đọc
// môi trường, fail-closed). Test vẫn khởi động app qua `createApiServer(createDispatcher(...))`
// với pool của Testcontainers — và `composition.int.test.ts` khởi động qua đúng đường của `main`.
export { CauHinhError, docCauHinh, type CauHinhApi, type MoiTruong } from "./cau-hinh.js";
export { taoTienTrinhApi, type DiaChiNghe, type TienTrinhApi } from "./composition.js";
export { COOKIE_PHIEN_NGUOI_MUA, createDispatcher, type Dispatcher, type DispatcherDeps } from "./dispatch.js";
export { COOKIE_PHIEN_KHACH, cookiePhienKhach } from "./routes/anon.js";
export { cookiePhienNguoiMua } from "./routes/auth.js";
export { HttpError, type ApiRequest, type ApiResponse, type HttpMethod } from "./http.js";
export {
  TEN_THAM_SO_CAM,
  timViPhamBangRoute,
  type ApiServices,
  type InvitationLinkSender,
  type LoginLinkSender,
  type OtpSender,
  type Route,
  type TotpSecretWrapper,
} from "./route-types.js";
export { ROUTES } from "./routes.js";
export { createApiServer, HEADER_MAC_DINH, nguonKhac, type ServerOptions } from "./server.js";
