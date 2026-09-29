// ==============================================================================================
// [S1.157 / khoản 243] THÂN CỦA `POST /rfqs/:rfqId/evaluate` KHÔNG MANG GIÁ — đo ở T1, trên CHÍNH
// handler của bảng `ROUTES`, không khởi động máy chủ, không cần Postgres.
//
// `taoLuotDanhGia` được thay bằng một bản giả trả một lượt chấm CÓ giá và hạng — đúng hình dạng mà
// hàm thật trả (`lines{effectiveCost, rank, components}`). Câu hỏi của tệp này là câu hỏi của ROUTE:
// thứ gói trả về có đi thẳng ra thân phản hồi không. Trên mã trước khoản 243 ca đầu ĐỎ: thân mang
// nguyên `lines`, tức giá và hạng của mọi báo giá, cho mọi vai giữ `evaluation.perform` — kể cả
// REQUESTER, BUYER, TECHNICAL là ba vai KHÔNG giữ `bid.view`.
//
// Phép đo trên Postgres thật, với một phiên BUYER không giữ `bid.view` bấm chấm thật: bước 12b và
// 12g của `apps/unseal-worker/src/kich-ban-41-http.int.test.ts`.
// ==============================================================================================
import { describe, expect, it, vi } from "vitest";
import type { ApiResponse } from "./http.js";

const { GIA, LUOT } = vi.hoisted(() => {
  const gia = "930000000.00";
  return {
    GIA: gia,
    LUOT: {
      evaluationId: "7d1f2c3a-0b4e-4f5a-9c6d-2e8f1a3b5c7d",
      policyId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      policyVersion: 3,
      currency: "VND",
      lines: [
        {
          bidVersionId: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
          effectiveCost: gia,
          rank: 1,
          components: [{ ma: "gia", donVi: "TIEN" as const, heSo: "1.0000", giaTri: gia, tien: gia }],
        },
      ],
    },
  };
});

vi.mock("@trustprocure/danh-gia", async (goc) => ({
  ...(await goc<typeof import("@trustprocure/danh-gia")>()),
  taoLuotDanhGia: vi.fn(() => Promise.resolve(LUOT)),
}));

// Sau `vi.mock`: bảng route phải nạp bản giả của gói, không bản thật.
const { ROUTES } = await import("./routes.js");
const { thanLuotCham } = await import("./routes/buyer.js");

const KHOA_DUOC_PHEP = ["currency", "evaluationId", "policyId", "policyVersion"];

describe("[S1.157 / khoản 243] thân của POST /rfqs/:rfqId/evaluate", () => {
  it("handler THẬT của bảng route trả đúng bốn khoá — không giá, không hạng, không thành phần, không số báo giá", async () => {
    const route = ROUTES.find((r) => r.method === "POST" && r.path === "/rfqs/:rfqId/evaluate");
    expect(route, "bảng ROUTES không còn đường POST /rfqs/:rfqId/evaluate").toBeDefined();
    if (route === undefined) return;
    // Handler chỉ đọc `req.params` (qua `rfqIdParam`) rồi gọi `taoLuotDanhGia` — đã thay bằng bản giả.
    const ctx = {
      req: { method: "POST", path: `/rfqs/${LUOT.evaluationId}/evaluate`, params: { rfqId: LUOT.evaluationId }, body: {}, cookies: {}, requestId: "t1" },
      orgId: "00000000-0000-4000-8000-00000000000a",
      client: {},
      actor: { type: "USER", id: "00000000-0000-4000-8000-00000000000b", sessionId: "00000000-0000-4000-8000-00000000000c", kind: "USER" },
      auditPool: {},
      services: {},
      afterCommit: () => undefined,
      afterCommitCoBu: () => undefined,
      afterCommitGuiNhieu: () => undefined,
    };
    const ph = await (route as unknown as { handler: (c: unknown) => Promise<ApiResponse> }).handler(ctx);
    expect(ph.status).toBe(201);
    const ev = (ph.body as { evaluation: Record<string, unknown> }).evaluation;
    expect(Object.keys(ev).sort()).toEqual(KHOA_DUOC_PHEP);
    expect(ev.evaluationId).toBe(LUOT.evaluationId);
    expect(ev.policyVersion).toBe(LUOT.policyVersion);
    // Không một chữ số nào của giá — bất kể trường nào mang nó.
    const than = JSON.stringify(ph.body);
    expect(than).not.toContain(GIA.slice(0, 9));
    for (const khoa of ["lines", "effectiveCost", "rank", "components", "soBaoGia"]) expect(than).not.toContain(khoa);
  });

  it("`thanLuotCham` là DANH SÁCH TRẮNG: một trường mới của lượt chấm không tự đi ra thân phản hồi", () => {
    const coTruongMoi = { ...LUOT, giaThapNhat: GIA, soBaoGia: 5 };
    expect(Object.keys(thanLuotCham(coTruongMoi)).sort()).toEqual(KHOA_DUOC_PHEP);
    expect(JSON.stringify(thanLuotCham(coTruongMoi))).not.toContain(GIA.slice(0, 9));
  });
});
