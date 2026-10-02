// ==============================================================================================
// [S1.9101 / S4.5c1] Route BENCHMARK của một gói và *Xem dải* một dòng (spec S4 §4.6, §3.5; §5.1 L6; ADR-142, ADR-9201).
//
// Đường đọc CÓ CỔNG, khuôn `/items/:itemId/price-history`: route không khai mã quyền vì nó là GET, và cổng `bid.view` nằm TRONG
// `docBenchmark`/`docDaiBenchmark` (rổ `HAM_DOC_CO_QUYEN`) — lần từ chối vào sổ qua `auditPool`, lần cho qua để lại một hàng sổ trong
// cùng giao dịch đọc. `agent: false`: spec §3.5 khai mọi route đọc lịch sử, benchmark và mốc ngoài là `agent: false`;
// `apps/mcp/src/cong-cu.ts` khai vì sao.
//
// `GET /rfqs/:rfqId/benchmark` có thể GHI: lần đọc đầu tiên sau một lần mở thầu tính và ghi bản lưu (chủ dự án chốt 2026-10-01). Lần
// ghi ấy là dữ liệu dẫn xuất, một lần cho mỗi lần mở thầu, không đổi trạng thái nghiệp vụ nào — khuôn hàng sổ của mọi route đọc —
// nên route vẫn `mutates: false`.
//
// KHÔNG ĐỌC QUERY (E6).
// ==============================================================================================
import { docBenchmark, docDaiBenchmark } from "@trustprocure/danh-gia";
import { HttpError } from "../http.js";
import type { BuyerReadRoute } from "../route-types.js";
// Hai tham số đường dẫn — CÙNG bộ đọc với route ánh xạ hạng mục (sai hình dạng ⇒ 404).
import { lineNoParam, rfqIdParam } from "./anh-xa.js";

export const ROUTES_BENCHMARK: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/rfqs/:rfqId/benchmark",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const benchmark = await docBenchmark(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      if (benchmark === null) throw new HttpError(404, "khong co goi thau nay");
      return { status: 200, body: { benchmark } };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/items/:lineNo/benchmark",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const dai = await docDaiBenchmark(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), lineNo: lineNoParam(ctx.req), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      if (dai === null) throw new HttpError(404, "khong co goi thau nay");
      return { status: 200, body: { dai } };
    },
  },
];
