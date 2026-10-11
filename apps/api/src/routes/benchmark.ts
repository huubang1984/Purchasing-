// ==============================================================================================
// [S1.260 / S4.5c1] Route BENCHMARK của một gói và *Xem dải* một dòng (spec S4 §4.6, §3.5; §5.1 L6; ADR-142, ADR-143).
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
// [khoản 351 / ADR-9201] Cả hai route khai `tranDocPhien`: bộ điều phối đặt cổng một-lượt-một-lúc và trần theo phiên TRƯỚC handler.
//
// KHÔNG ĐỌC QUERY (E6).
// ==============================================================================================
import { docBenchmark, docDaiBenchmark } from "@trustprocure/danh-gia";
import { HttpError } from "../http.js";
import type { BuyerReadRoute } from "../route-types.js";
// Hai tham số đường dẫn — CÙNG bộ đọc với route ánh xạ hạng mục (sai hình dạng ⇒ 404).
import { lineNoParam, rfqIdParam } from "./anh-xa.js";

/**
 * [khoản 351 / ADR-9201] Trần đọc bản lưu của MỘT phiên mỗi cửa sổ 900 s — cùng số với trần đọc của phiên agent (ADR-091): trung bình
 * một lần mỗi giây, rộng cho người bấm *Đọc benchmark*, hẹp so với ~313 lần mỗi giây đo được của một vòng lặp (§S1.274 mục 8).
 */
export const BENCHMARK_DOC_TRAN_MOI_CUA_SO = 900;
/**
 * [khoản 351 / ADR-9201] Trần *Xem dải* của MỘT phiên mỗi cửa sổ 900 s. Mỗi lần hai lần đọc `quan_sat_gia` cho hàng chuẩn của dòng
 * (~1 s ở 5.000 gói, ADR-143) — đắt hơn lần đọc bản lưu nhiều lần; 120 là một cú bấm mỗi 7,5 s suốt cửa sổ.
 */
export const XEM_DAI_TRAN_MOI_CUA_SO = 120;

export const ROUTES_BENCHMARK: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/rfqs/:rfqId/benchmark",
    audience: "BUYER",
    mutates: false,
    agent: false,
    tranDocPhien: BENCHMARK_DOC_TRAN_MOI_CUA_SO,
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
    tranDocPhien: XEM_DAI_TRAN_MOI_CUA_SO,
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
