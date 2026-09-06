// Route CÔNG KHAI — không cookie, không tổ chức, không CSDL. Chỉ GET (lớp canh ở `routes.ts`).
import type { PublicRoute } from "../route-types.js";

export const ROUTES_PUBLIC: readonly PublicRoute[] = [
  {
    method: "GET",
    path: "/health",
    audience: "PUBLIC",
    // Cố ý KHÔNG chạm CSDL: một health check mở kết nối là một bề mặt DoS miễn phí, và cái nó
    // đo ("tiến trình còn sống") không cần Postgres để trả lời.
    handler: () => Promise.resolve({ status: 200, body: { ok: true } }),
  },
];
