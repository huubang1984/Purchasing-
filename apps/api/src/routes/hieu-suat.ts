// ==============================================================================================
// [S1.291 / S3.8a] Route HIỆU SUẤT NHÀ CUNG CẤP của tổ chức (spec S3 §4.9, §5.1 K11; ADR-163).
//
// Đường đọc CÓ CỔNG, khuôn `/items/:itemId/price-history`: route không khai mã quyền vì nó là GET, và cổng `bid.view` nằm TRONG
// `docHieuSuatNhaCungCap` (rổ `HAM_DOC_CO_QUYEN`) — lần từ chối vào sổ qua `auditPool`, lần cho qua để lại một hàng
// `SUPPLIER_PERFORMANCE_READ` trong cùng giao dịch đọc. `agent: false`: hạng và thắng là dữ liệu sau mở thầu, cùng loại với bảng xếp
// hạng, lịch sử giá và benchmark — `apps/mcp/src/cong-cu.ts` khai vì sao.
//
// KHÔNG ĐỌC QUERY (E6): mốc là `now()` của giao dịch, không lọc, không phân trang.
// ==============================================================================================
import { docHieuSuatNhaCungCap } from "@trustprocure/kiem-soat";
import type { BuyerReadRoute } from "../route-types.js";

export const ROUTES_HIEU_SUAT: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/supplier-performance",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const hieuSuat = await docHieuSuatNhaCungCap(ctx.client, ctx.orgId, { actorSessionId: ctx.actor.sessionId }, ctx.auditPool);
      return { status: 200, body: { hieuSuat } };
    },
  },
];
