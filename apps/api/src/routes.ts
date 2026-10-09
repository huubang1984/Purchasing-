// ==============================================================================================
// apps/api/src/routes.ts — BẢNG ROUTE KHAI BÁO. Đây là điểm chịu lực của ADR-020 mục 1.
//
// Route là DỮ LIỆU: một mảng đọc được bằng `import { ROUTES }`, không cần khởi động máy chủ. Hình
// dạng từng route và lớp canh thuần (`timViPhamBangRoute`) nằm ở `route-types.ts`; file này chỉ
// LẮP ~~ba~~ ~~[S1.79] SÁU nhóm (từ NĂM module — `auth.ts` xuất hai)~~ ~~[S1.199] BẢY nhóm (từ SÁU module — `auth.ts`
// xuất hai)~~ ~~[S1.234] TÁM nhóm (từ BẢY module — `auth.ts` xuất hai)~~ ~~[S1.251] CHÍN nhóm (từ TÁM module — `auth.ts` xuất
// hai)~~ ~~[S1.260] MƯỜI nhóm (từ CHÍN module — `auth.ts` xuất hai)~~ [S1.9101] MƯỜI HAI nhóm (từ MƯỜI module — `auth.ts` và
// `passport.ts` mỗi tệp xuất hai) lại. Thứ tự KHÔNG có nghĩa: mỗi cặp (method, path) là duy nhất — lớp canh đòi thế.
// ==============================================================================================
import type { Route } from "./route-types.js";
import { ROUTES_ANH_XA } from "./routes/anh-xa.js";
import { ROUTES_ANON } from "./routes/anon.js";
import { ROUTES_AUTH, ROUTES_AUTH_SELF } from "./routes/auth.js";
import { ROUTES_BENCHMARK } from "./routes/benchmark.js";
import { ROUTES_BUYER } from "./routes/buyer.js";
import { ROUTES_DU_LIEU } from "./routes/du-lieu.js";
import { ROUTES_DU_LIEU_NGOAI } from "./routes/du-lieu-ngoai.js";
import { ROUTES_GUEST } from "./routes/guest.js";
import { ROUTES_LICH_SU_GIA } from "./routes/lich-su-gia.js";
import { ROUTES_PASSPORT, ROUTES_PASSPORT_ANON } from "./routes/passport.js";
import { ROUTES_PUBLIC } from "./routes/public.js";

export const ROUTES: readonly Route[] = [
  ...ROUTES_PUBLIC,
  ...ROUTES_ANON,
  ...ROUTES_AUTH,
  ...ROUTES_GUEST,
  ...ROUTES_BUYER,
  // [S1.199 / S4.2b] Dữ liệu nền: hàng chuẩn, bí danh, quy đổi riêng, bí danh đơn vị (spec S4 §3.5).
  ...ROUTES_DU_LIEU,
  // [S1.272 / S4.6a] Mốc giá ngoài và lịch sử mua ngoài hệ thống: nhập tay, dán CSV, rút; danh sách KHÔNG cột giá dưới
  // `item.manage` trong gói, `agent: false` (spec S4 §4.7; ADR-096; ADR-149).
  ...ROUTES_DU_LIEU_NGOAI,
  // [S1.234 / S4.3b] Ánh xạ hạng mục: hàng đợi, trạng thái từng dòng, duyệt/bác/tạo hàng chuẩn, chuẩn hoá lại (spec S4 §4.4).
  ...ROUTES_ANH_XA,
  // [S1.251 / S4.4b] Lịch sử giá của một hàng chuẩn — cổng `bid.view` trong gói, `agent: false` (spec S4 §4.5, L6).
  ...ROUTES_LICH_SU_GIA,
  // [S1.260 / S4.5c1] Benchmark của một gói (bản lưu một lần mỗi lần mở thầu) và *Xem dải* một dòng — cổng `bid.view` trong gói,
  // `agent: false` (spec S4 §4.6, L6).
  ...ROUTES_BENCHMARK,
  ...ROUTES_AUTH_SELF,
  // [S1.9101 / S3.7a1 / ADR-081] Passport: ba bước vô danh (link → OTP → phiên) và ba route của phiên Passport.
  ...ROUTES_PASSPORT_ANON,
  ...ROUTES_PASSPORT,
];
