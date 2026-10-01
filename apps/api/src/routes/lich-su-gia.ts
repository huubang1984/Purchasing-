// ==============================================================================================
// [S1.9101 / S4.4b] Route LỊCH SỬ GIÁ của một hàng chuẩn (spec S4 §4.5, §3.5; §5.1 L6; ADR-9201).
//
// Đường đọc CÓ CỔNG, khuôn `/rfqs/:rfqId/comparison` và `/rfqs/:rfqId/ranking`: route không khai mã quyền vì nó là GET, và cổng
// `bid.view` nằm TRONG `docLichSuGia` (rổ `HAM_DOC_CO_QUYEN`) — lần từ chối vào sổ qua `auditPool`, lần cho qua để lại một hàng
// `PRICE_HISTORY_READ` trong cùng giao dịch đọc. `agent: false`: spec §3.5 khai mọi route đọc lịch sử, benchmark và mốc ngoài là
// `agent: false`; `apps/mcp/src/cong-cu.ts` khai vì sao.
//
// KHÔNG ĐỌC QUERY (E6): mốc là `now()` của giao dịch, không phân trang.
// ==============================================================================================
import { docLichSuGia } from "@trustprocure/du-lieu-nen";
import { HttpError } from "../http.js";
import type { BuyerReadRoute } from "../route-types.js";
// Tham số đường dẫn của hàng chuẩn — CÙNG bộ đọc với các route hàng chuẩn khác (sai hình dạng ⇒ 404).
import { itemIdParam } from "./du-lieu.js";

export const ROUTES_LICH_SU_GIA: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/items/:itemId/price-history",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const lichSu = await docLichSuGia(
        ctx.client,
        ctx.orgId,
        { itemId: itemIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      if (lichSu === null) throw new HttpError(404, "khong co hang chuan nay");
      return { status: 200, body: { lichSuGia: lichSu } };
    },
  },
];
