// ==============================================================================================
// apps/api/src/routes.ts — BẢNG ROUTE KHAI BÁO. Đây là điểm chịu lực của ADR-020 mục 1.
//
// Route là DỮ LIỆU: một mảng đọc được bằng `import { ROUTES }`, không cần khởi động máy chủ. Hình
// dạng từng route và lớp canh thuần (`timViPhamBangRoute`) nằm ở `route-types.ts`; file này chỉ
// LẮP ba nhóm lại. Thứ tự KHÔNG có nghĩa: mỗi cặp (method, path) là duy nhất — lớp canh đòi thế.
// ==============================================================================================
import type { Route } from "./route-types.js";
import { ROUTES_ANON } from "./routes/anon.js";
import { ROUTES_BUYER } from "./routes/buyer.js";
import { ROUTES_GUEST } from "./routes/guest.js";
import { ROUTES_PUBLIC } from "./routes/public.js";

export const ROUTES: readonly Route[] = [...ROUTES_PUBLIC, ...ROUTES_ANON, ...ROUTES_GUEST, ...ROUTES_BUYER];
