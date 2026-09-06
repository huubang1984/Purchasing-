// Cửa công khai của apps/api. Không có `main`: tiến trình chạy thật (composition root với pool,
// pepper, khoá ký) là việc của S1.10.6, khi có đủ thứ để tiêm. Hôm nay app này được test khởi
// động qua `createApiServer(createDispatcher(...))` với pool của Testcontainers.
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
export { createApiServer, HEADER_MAC_DINH } from "./server.js";
