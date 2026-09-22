// ==============================================================================================
// Route NGƯỜI MUA — phiên nội bộ đã qua MFA. `ctx.client` đã gắn tổ chức; với route `mutates:
// true`, bộ điều phối đã gọi `requirePermission` TRƯỚC khi vào đây, nên handler không kiểm quyền
// và cũng KHÔNG ĐƯỢC kiểm — một cổng thứ hai ở đây là hai nơi để lệch nhau. (Vài hàm gói tự gọi
// `requirePermission` lần nữa với CÙNG mã — khoản nợ 31/33 — đó là lớp của gói, không của route.)
//
// [S1.10.5] Toàn bộ vòng đời phía người mua của kịch bản mục 41: chính sách → nhà cung cấp → RFQ →
// hạng mục → ngân sách → nộp duyệt → duyệt ×2 → mở → mời → gia hạn/đóng/huỷ → yêu cầu mở thầu →
// duyệt ×2 → điều phối → bảng so sánh. Mọi route ghi khai `permission` (kiểu ép, lớp canh
// `routes.test.ts` đọc cấu trúc, và `buyer.int.test.ts` QUÉT từng route ghi bằng một phiên không
// có quyền nào — 403 cho tất cả, mỗi lần một bản ghi PERMISSION_DENIED).
//
// Danh tính ở MỌI lời gọi gói là `ctx.actor.sessionId` — dẫn xuất từ cookie (ADR-016). Thân yêu
// cầu chỉ mang dữ liệu nghiệp vụ; không trường nào trong thân là một lời khai "tôi là ai".
// ==============================================================================================
import {
  docBangXepHang,
  docVongBafo,
  dongVongBafo,
  moVongBafo,
  taoLuotDanhGia,
} from "@trustprocure/danh-gia";
import { PERMISSIONS, approveMfaReset, cancelMfaReset, requestMfaReset } from "@trustprocure/identity";
import {
  clearOtpLockout,
  createInvitation,
  issueMagicLinkToken,
  listInvitations,
  revokeInvitation,
  CHANNELS,
  type Channel,
} from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createProcurementPolicy,
  createRfq,
  extendRfqDeadline,
  getActiveProcurementPolicy,
  getRfq,
  listRfqItems,
  openRfq,
  setRfqBudget,
  submitRfqForApproval,
  type Currency,
  type ThanhPhanTrongSoVao,
} from "@trustprocure/rfq";
import {
  addSupplierContact,
  createSupplier,
  getSupplier,
  listSupplierContacts,
  listSuppliers,
} from "@trustprocure/supplier";
import {
  approveUnseal,
  buildComparisonTable,
  cancelUnseal,
  countReceivedBids,
  dispatchUnseal,
  getOpenUnsealForRfq,
  getUnsealRequest,
  requestUnseal,
} from "@trustprocure/unseal";
import { HttpError, type ApiRequest } from "../http.js";
import type { BuyerReadRoute, BuyerWriteRoute } from "../route-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// ----------------------------------------------------------------------------------------------
// Đọc thân — 422 khi thiếu/sai kiểu. Không nội suy GIÁ TRỊ vào thông điệp (chỉ tên trường).
// ----------------------------------------------------------------------------------------------
function truong(body: unknown, ten: string): unknown {
  return (body as Record<string, unknown> | null | undefined)?.[ten];
}
function chuoiBatBuoc(body: unknown, ten: string): string {
  const v = truong(body, ten);
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}
/** [review H2-8] Định danh trong THÂN phải đúng dạng UUID trước khi chạm CSDL — sai dạng là 422, không phải 22P02 → 500. */
function uuidBody(body: unknown, ten: string): string {
  const v = chuoiBatBuoc(body, ten);
  if (!UUID_RE.test(v)) throw new HttpError(422, `trường "${ten}" phải là UUID`);
  return v;
}
function chuoiTuyChon(body: unknown, ten: string): string | null {
  const v = truong(body, ten);
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(422, `trường "${ten}" phải là chuỗi`);
  return v;
}
function soNguyen(body: unknown, ten: string): number {
  const v = truong(body, ten);
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(422, `trường "${ten}" phải là số nguyên`);
  return v;
}
/**
 * [S1.107 / lượt soi ngang 77 — CAO ②] `evalComponents` của thân `POST /policy`: KHÔNG bắt buộc,
 * và khi vắng thì chính sách ấy không chấm thầu được — đúng trạng thái của MỌI tổ chức cho tới
 * vòng này, vì `056` cấp GRANT từ S1.102 và `057` cưỡng chế hình dạng từ S1.105 nhưng không một
 * dòng mã sản xuất nào ghi hai cột ấy, nên route chấm thầu của S1.106 luôn trả 422 ngoài cụm test.
 *
 * Bộ đọc này chỉ kiểm hình dạng NGOÀI — mảng của object. Ba trường chuỗi do `packages/rfq` kiểm,
 * còn `don_vi` thuộc {TIEN, DIEM}, *ít nhất một TIEN* và khuôn của `he_so` do `CHECK` của `057`
 * phán xử. Ba lớp, mỗi lớp một việc, và không lớp nào chép lại luật của lớp kia.
 */
function mangTrongSo(body: unknown, ten: string): readonly ThanhPhanTrongSoVao[] | undefined {
  const v = truong(body, ten);
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new HttpError(422, `trường "${ten}" phải là mảng`);
  for (const t of v) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) {
      throw new HttpError(422, `trường "${ten}" phải là mảng các object`);
    }
  }
  return v as readonly ThanhPhanTrongSoVao[];
}

/** Số nguyên TUỲ CHỌN — `undefined` khi vắng, để `packages/rfq` phán xử cặp với `evalComponents`. */
function soNguyenTuyChon(body: unknown, ten: string): number | undefined {
  const v = truong(body, ten);
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(422, `trường "${ten}" phải là số nguyên`);
  return v;
}
function ngayTuyChon(body: unknown, ten: string): Date | null {
  const v = truong(body, ten);
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(422, `trường "${ten}" phải là chuỗi ISO 8601`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(422, `trường "${ten}" không phải ngày hợp lệ`);
  return d;
}
function ngayBatBuoc(body: unknown, ten: string): Date {
  const d = ngayTuyChon(body, ten);
  if (d === null) throw new HttpError(422, `thiếu trường "${ten}"`);
  return d;
}
function tienTe(body: unknown): Currency {
  const v = chuoiBatBuoc(body, "currency");
  if (v !== "VND" && v !== "USD") throw new HttpError(422, 'trường "currency" phải là VND hoặc USD');
  return v;
}
function kenhTuyChon(body: unknown): Channel | undefined {
  const v = chuoiTuyChon(body, "linkChannel");
  if (v === null) return undefined;
  if (!(CHANNELS as readonly string[]).includes(v)) throw new HttpError(422, 'trường "linkChannel" không hợp lệ');
  return v as Channel;
}
/** Tham số đường dẫn UUID; sai hình dạng ⇒ 404 (không phải 422: đường ấy không tồn tại). */
function uuidParam(req: ApiRequest, ten: string): string {
  const v = req.params[ten] ?? "";
  if (!UUID_RE.test(v)) throw new HttpError(404, "khong co duong nay");
  return v;
}
const rfqIdParam = (req: ApiRequest): string => uuidParam(req, "rfqId");
const unsealIdParam = (req: ApiRequest): string => uuidParam(req, "unsealRequestId");
const invitationIdParam = (req: ApiRequest): string => uuidParam(req, "invitationId");
const supplierIdParam = (req: ApiRequest): string => uuidParam(req, "supplierId");
const userIdParam = (req: ApiRequest): string => uuidParam(req, "userId");
const mfaResetIdParam = (req: ApiRequest): string => uuidParam(req, "requestId");

// ----------------------------------------------------------------------------------------------
// ĐỌC
// ----------------------------------------------------------------------------------------------
const doc: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/me",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] phiên của chính người gọi; không chạm một bảng nào
    agent: true,
    handler: (ctx) =>
      Promise.resolve({
        status: 200,
        // [khoản 141 / ADR-039 — lượt soi đối kháng Đ-2] `kind` đi ra đây, và đó là đường DUY NHẤT
        // để một máy khách tự kiểm được nó đang cầm loại chứng chỉ nào. Không mở oracle mới: route
        // này đã trả `sessionId` của CHÍNH phiên đang gọi, nên nó không nói thêm gì về phiên của
        // người khác. `apps/mcp` gọi đúng đường này một lần lúc khởi động và NÉM nếu không phải
        // `AGENT_READONLY` — nếu thiếu, bốn lớp của vòng này chỉ là kỷ luật vận hành.
        body: { userId: ctx.actor.id, sessionId: ctx.actor.sessionId, orgId: ctx.orgId, kind: ctx.actor.kind },
      }),
  },
  {
    method: "GET",
    path: "/suppliers",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] sổ nhà cung cấp — dữ liệu nghiệp vụ, không giá
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { suppliers: await listSuppliers(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/suppliers/:supplierId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] một nhà cung cấp; liên hệ KHÔNG nằm trong thân này
    agent: true,
    handler: async (ctx) => {
      const s = await getSupplier(ctx.client, ctx.orgId, supplierIdParam(ctx.req));
      if (s === null) throw new HttpError(404, "khong co nha cung cap");
      return { status: 200, body: { supplier: s } };
    },
  },
  {
    method: "GET",
    path: "/suppliers/:supplierId/contacts",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] tên, email, điện thoại của người ở công ty khác — ADR-038 rút khỏi bề mặt agent
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { contacts: await listSupplierContacts(ctx.client, ctx.orgId, supplierIdParam(ctx.req)) },
    }),
  },
  {
    method: "GET",
    path: "/policy",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] ngưỡng phê duyệt của chính tổ chức
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { policy: await getActiveProcurementPolicy(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] trạng thái RFQ; không bao giờ giá
    agent: true,
    handler: async (ctx) => {
      const r = await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co goi thau");
      return { status: 200, body: { rfq: r } };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/invitations",
    audience: "BUYER",
    mutates: false,
    // [S1.98 / khoản 125] KHÔNG khai `permission` ở đây, và sự vắng mặt ấy là CÓ Ý: `dispatch.ts`
    // chỉ gọi `requirePermission` khi `route.mutates`, nên một cờ quyền trên route ĐỌC là một lời
    // khai không có lớp. Cổng thật nằm THẲNG trong thân `listInvitations`, cùng khuôn hai đường
    // đọc có cổng đã có (`buildComparisonTable`, `countReceivedBids`), và
    // `tests/architecture/cong-quyen-route.test.ts` đọc thân hàm ấy để rổ `HAM_DOC_CO_QUYEN` là
    // một phép đo chứ không một cái nhãn.
    //
    // KHÔNG `agent: true`: danh sách ai được mời là thông tin cạnh tranh, và chứng chỉ agent chỉ
    // đọc — không có lý do để phơi nó ra một bề mặt rộng hơn người bấm nút. Kiểu `BuyerReadRoute`
    // đòi khai cờ này TƯỜNG MINH, nên đây là một quyết định được ghi chứ không một chỗ bỏ trống.
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        invitations: await listInvitations(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/items",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] hạng mục mua — cái gì, bao nhiêu
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { items: await listRfqItems(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } }),
  },
  {
    method: "GET",
    path: "/unseal/:unsealRequestId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] trạng thái một yêu cầu mở thầu
    agent: true,
    handler: async (ctx) => {
      const r = await getUnsealRequest(ctx.client, ctx.orgId, unsealIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co yeu cau mo thau");
      return { status: 200, body: { unsealRequest: r } };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/unseal",
    audience: "BUYER",
    mutates: false,
    // [S1.90 / khoản 190] YÊU CẦU MỞ THẦU ĐANG MỞ CỦA GÓI THẦU NÀY — `null` khi không có.
    //
    // `agent: false`, và vế ấy là quyết định chứ không phải sơ suất. Đường `/unseal/:id` ngay
    // trên là `agent: true` vì nó đòi người gọi ĐÃ BIẾT một UUID; đường này biến một id gói thầu
    // — thứ tác tử chỉ-đọc liệt kê được — thành id của một yêu cầu mở thầu, tức nó mở đúng khả
    // năng mà đường kia giữ lại. Một tác tử chỉ-đọc không có việc nào cần khả năng ấy, và ngày
    // nào có thì đổi một dòng cộng một ADR, chứ không phải đọc ngược lại từ sự im lặng hôm nay.
    //
    // KHÔNG 404 khi không có yêu cầu: "gói thầu này chưa ai xin mở" là một câu trả lời ĐÚNG, và
    // người duyệt thứ hai cần phân biệt nó với "không có gói thầu ấy" (404 thật, từ `getRfq`).
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { unsealRequest: await getOpenUnsealForRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) },
    }),
  },
  // Hai đường ĐỌC CÓ CỔNG (khoản nợ 33): gói tự gọi requirePermission(BID_VIEW). Route là GET vì
  // chúng không đổi trạng thái; cổng nằm trong gói vì mục đích duy nhất của chúng là kiểm soát
  // TIẾT LỘ (A4, A6) — và `auditPool` ở đây là để lần từ chối có bản ghi (D5).
  {
    method: "GET",
    path: "/rfqs/:rfqId/comparison",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] BẢNG SO SÁNH GIÁ — thứ toàn bộ sản phẩm sinh ra để bảo vệ
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        comparison: await buildComparisonTable(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/bid-count",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] số hồ sơ thầu đã nhận — cùng rổ HAM_DOC_CO_QUYEN với bảng giá
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        bidCount: await countReceivedBids(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  // [S1.106 / S2.4] BẢNG XẾP HẠNG của lượt chấm MỚI NHẤT — cùng rổ `HAM_DOC_CO_QUYEN` với hai
  // đường trên, và cùng lý do: cổng `bid.view` nằm THẲNG trong `docBangXepHang`.
  //
  // `null` khi gói thầu chưa được chấm lần nào, KHÔNG 404: "chưa chấm" là một câu trả lời đúng và
  // màn chấm phải phân biệt nó với "không có gói thầu ấy" — cùng khuôn `/rfqs/:rfqId/unseal`
  // (khoản 190). Một mảng rỗng thì nói dối: *"đã chấm, và không ai trong bảng"*.
  // [S1.109 / S2.5] VÒNG BAFO MỚI NHẤT của gói thầu — `null` khi chưa mở vòng nào.
  //
  // KHÔNG cùng rổ `HAM_DOC_CO_QUYEN` với ba đường trên, và vế ấy là một quyết định đo được: hàng
  // này không mang một mức giá nào. Nó mang `topN`, và với một NGƯỜI MUA con số ấy đã đọc được
  // qua `GET /policy` — cổng `bid.view` ở đây sẽ canh một thứ không phải bí mật, rồi làm người
  // đọc tưởng nó là.
  //
  // `agent: false` cùng lý do `/rfqs/:rfqId/unseal` (khoản 190): nó biến một id gói thầu thành
  // id một vòng BAFO, và một tác tử chỉ-đọc không có việc nào cần khả năng ấy.
  {
    method: "GET",
    path: "/rfqs/:rfqId/bafo",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { bafoRound: await docVongBafo(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) },
    }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/ranking",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] THỨ HẠNG — cùng hạng tiết lộ với bảng so sánh, và hơn: nó mang cả `components`,
    // tức từng con số sinh ra `effective_cost`. Tác tử chỉ-đọc không có việc gì ở đây.
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        ranking: await docBangXepHang(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
];

// ----------------------------------------------------------------------------------------------
// GHI — mỗi route một mã quyền. `resourceId` đọc từ ĐƯỜNG DẪN, không từ thân.
// ----------------------------------------------------------------------------------------------
const ghi: readonly BuyerWriteRoute[] = [
  // --------------------------------------------------------------------------------------------
  // [S1.106 / S2.4] CHẤM — cạnh `UNSEALED->EVALUATING` của `011`, và nó là route ghi DUY NHẤT mang
  // `evaluation.perform`.
  //
  // Khoản **220** nói ra giới hạn của chính cổng này: `evaluation.perform` do NĂM trên SÁU vai giữ
  // (chỉ `DIRECTOR` không), nên cổng ở đây là một lớp NÔNG — nó chặn được khách và tác tử, không
  // chặn được "ai trong tổ chức". Ghi ra ở đúng chỗ người đọc mã route sẽ tìm.
  //
  // `taoLuotDanhGia` tự gọi `requirePermission` lần nữa với CÙNG mã — khoản nợ 31/33, lớp của gói
  // chứ không của route; xem khối đầu tệp.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/rfqs/:rfqId/evaluate",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.EVALUATION_PERFORM,
    // [S1.107 / lượt soi ngang 77 — ②] `RFQ`: bộ điều phối ghi cặp này nguyên văn vào hàng
    // sổ `PERMISSION_DENIED`, và lúc ấy lượt đánh giá chưa tồn tại.
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        evaluation: await taoLuotDanhGia(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  // --------------------------------------------------------------------------------------------
  // [S1.109 / S2.5] MỞ và ĐÓNG vòng BAFO — cạnh `EVALUATING->BAFO_OPEN` và `BAFO_OPEN->BAFO_CLOSED`
  // của `059`. Cho tới vòng này bốn cạnh BAFO tồn tại và được canh ở tầng CSDL mà KHÔNG đường sản
  // xuất nào đi qua (khoản **227**).
  //
  // Mã quyền RIÊNG `rfq.bafo.open`, chỉ `PROCUREMENT_MANAGER` (ADR-055) — KHÔNG dùng lại
  // `evaluation.perform`: mở vòng BAFO là hành động duy nhất của sản phẩm mà người bấm ĐÃ BIẾT
  // giá của mọi người, và `evaluation.perform` do NĂM trên SÁU vai giữ (khoản 220).
  //
  // Thân KHÔNG mang `evaluationId`, và đó là vế đóng của một lỗ mà lượt soi hình dạng của vòng
  // này tìm ra: `059` cho người gọi khai lượt chấm nào cũng được, nên vòng BAFO thứ hai mời được
  // top-N của bảng xếp hạng TRƯỚC BAFO. `060` đòi lượt MỚI NHẤT ở tầng CSDL và `moVongBafo` tự
  // suy nó — hai lớp, và không lớp nào đọc một trường do người gọi khai.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/rfqs/:rfqId/bafo",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_BAFO_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        bafoRound: await moVongBafo(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            deadlineAt: ngayBatBuoc(ctx.req.body, "deadlineAt"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/bafo/close",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_BAFO_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        bafoRound: await dongVongBafo(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/policy",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.POLICY_MANAGE,
    resourceType: "PROCUREMENT_POLICY",
    handler: async (ctx) => {
      // [review H2-3] `version` do người gọi chọn + cột `integer` + trigger 022 "phải LỚN HƠN" + không
      // UPDATE/DELETE ⇒ một `version: 2147483647` GHIM tổ chức vào chính sách ấy vĩnh viễn. Ở tầng
      // HTTP, `version` chỉ là GIÁ TRỊ KỲ VỌNG (chống đua): phải bằng phiên bản hiện hành + 1.
      // Vế CSDL (trigger tự gán `max + 1`) chưa làm — sổ nợ, xem STATE.
      const version = soNguyen(ctx.req.body, "version");
      const hienHanh = await getActiveProcurementPolicy(ctx.client, ctx.orgId);
      const keTiep = (hienHanh?.version ?? 0) + 1;
      if (version !== keTiep) throw new HttpError(422, `trường "version" phải bằng phiên bản hiện hành + 1 (${keTiep})`);
      const policy = await createProcurementPolicy(ctx.client, ctx.orgId, {
        version,
        dualApprovalThreshold: chuoiBatBuoc(ctx.req.body, "dualApprovalThreshold"),
        currency: tienTe(ctx.req.body),
        // [S1.107 / CAO ②] Hai trường TUỲ CHỌN đi thành một BỘ — `056` đòi
        // `(eval_components IS NULL) = (bafo_top_n IS NULL)`, và `packages/rfq` ném một lỗi
        // CÓ TÊN khi chỉ một trong hai được khai, thay vì để người gọi đọc một `23514`.
        evalComponents: mangTrongSo(ctx.req.body, "evalComponents"),
        bafoTopN: soNguyenTuyChon(ctx.req.body, "bafoTopN"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { policy } };
    },
  },
  {
    method: "POST",
    path: "/suppliers",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    resourceType: "SUPPLIER",
    handler: async (ctx) => {
      const supplier = await createSupplier(ctx.client, ctx.orgId, {
        legalName: chuoiBatBuoc(ctx.req.body, "legalName"),
        taxCode: chuoiTuyChon(ctx.req.body, "taxCode"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { supplier } };
    },
  },
  {
    method: "POST",
    path: "/suppliers/:supplierId/contacts",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    resourceType: "SUPPLIER",
    resourceId: supplierIdParam,
    handler: async (ctx) => {
      const contact = await addSupplierContact(ctx.client, ctx.orgId, {
        supplierId: supplierIdParam(ctx.req),
        fullName: chuoiBatBuoc(ctx.req.body, "fullName"),
        email: chuoiBatBuoc(ctx.req.body, "email"),
        phone: chuoiTuyChon(ctx.req.body, "phone"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { contact } };
    },
  },
  {
    method: "POST",
    path: "/rfqs",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    handler: async (ctx) => {
      const rfq = await createRfq(ctx.client, ctx.orgId, {
        title: chuoiBatBuoc(ctx.req.body, "title"),
        deadlineAt: ngayTuyChon(ctx.req.body, "deadlineAt"),
        createdBySessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { rfq } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/items",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const item = await addRfqItem(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        lineNo: soNguyen(ctx.req.body, "lineNo"),
        description: chuoiBatBuoc(ctx.req.body, "description"),
        quantity: chuoiBatBuoc(ctx.req.body, "quantity"),
        unit: chuoiBatBuoc(ctx.req.body, "unit"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { item } };
    },
  },
  {
    method: "PUT",
    path: "/rfqs/:rfqId/budget",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const budget = await setRfqBudget(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        estimatedValue: chuoiBatBuoc(ctx.req.body, "estimatedValue"),
        currency: tienTe(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 200, body: { budget } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/submit",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { rfq: await submitRfqForApproval(ctx.client, ctx.orgId, { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }) },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_APPROVE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      await approveRfq(ctx.client, ctx.orgId, { rfqId: rfqIdParam(ctx.req), sessionId: ctx.actor.sessionId });
      return { status: 200, body: { rfq: await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/open",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await openRfq(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId, keyWrapper: ctx.services.rfqKeyWrapper },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/extend",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await extendRfqDeadline(ctx.client, ctx.orgId, {
          rfqId: rfqIdParam(ctx.req),
          newDeadlineAt: ngayBatBuoc(ctx.req.body, "newDeadlineAt"),
          reason: chuoiBatBuoc(ctx.req.body, "reason"),
          actorSessionId: ctx.actor.sessionId,
        }),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/close",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await closeRfq(ctx.client, ctx.orgId, {
          rfqId: rfqIdParam(ctx.req),
          reason: chuoiBatBuoc(ctx.req.body, "reason"),
          actorSessionId: ctx.actor.sessionId,
        }),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CANCEL,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await cancelRfq(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), reason: chuoiBatBuoc(ctx.req.body, "reason"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/invitations",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "INVITATION",
    // [review H2-9] RFQ bị mời nằm trong đường dẫn — bản ghi PERMISSION_DENIED (D5) phải mang nó.
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const supplierId = uuidBody(ctx.req.body, "supplierId");
      const contactId = uuidBody(ctx.req.body, "contactId");
      // [review H2-9 ⑵] "Người liên hệ thuộc nhà cung cấp" kiểm TRƯỚC khi tạo lời mời và phát token —
      // CSDL chỉ có FK `(org_id, contact_id)`, không ràng `contact ∈ supplier`; bản trước kiểm SAU và
      // dựa vào rollback của `withTenant` để vứt `INVITATION_CREATED` + token. Đích của link đọc từ
      // `supplier_contacts` — không từ thân yêu cầu (cùng kỷ luật với OTP, ADR-015 [C1]).
      const lienHe = (await listSupplierContacts(ctx.client, ctx.orgId, supplierId)).find((c) => c.id === contactId);
      if (lienHe === undefined) throw new HttpError(422, "nguoi lien he khong thuoc nha cung cap");
      const loi = await createInvitation(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        supplierId,
        contactId,
        linkChannel: kenhTuyChon(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      const t = await issueMagicLinkToken(ctx.client, ctx.orgId, { invitationId: loi.id, actorSessionId: ctx.actor.sessionId });
      // Token đi tới bộ gửi TIÊM vào và KHÔNG về client.
      // [S1.70 / khoản 124] Trước khoản này bộ gửi được `await` ngay tại đây, TRONG giao dịch — hai lần `appendAuditEvent` ở trên giữ khoá tư
      // vấn ghi sổ của tổ chức tới hết giao dịch, nên lần gửi giữ khoá ấy suốt độ trễ của bộ gửi (đo, biên bản §S1.70: bộ gửi chậm 3 s ⇒
      // khoá khoảng 3,0 s; treo ⇒ 60 s). Nay gửi SAU commit: bộ gửi nhận một token đã tồn tại, không giao dịch nào đứng chờ nó. Gửi hỏng hay
      // quá trần ⇒ lời mời bị thu hồi trong giao dịch mới và phản hồi là `502` — `201` vẫn nghĩa là bộ gửi đã báo xong trong trần (lượt soi
      // 64b-21), và người mua gọi lại được ngay (024: một lời mời CÒN SỐNG cho mỗi nhà cung cấp) — TRỪ khi lần thu hồi bù cũng hỏng (phiên người mời vừa bị thu hồi, pool
      // đầy quá 5 s, mất kết nối): khi ấy lời mời còn sống mà link chưa đi, và phản hồi `500` mang `invitationId` để người mua thu hồi bằng
      // `POST /invitations/:invitationId/revoke` rồi mời lại — không route đọc nào khác trả id ấy (lượt soi 64a-1). Chủ dự án chọn hai hợp
      // đồng này ngày 2026-09-13 — ADR-020 tiểu mục [S1.70 / khoản 124].
      ctx.afterCommitCoBu({
        viec: () =>
          ctx.services.invitationLinkSender.send({
            orgId: ctx.orgId,
            invitationId: loi.id,
            channel: loi.linkChannel,
            destination: loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? ""),
            token: t.token,
          }),
        bu: async (client) => {
          await revokeInvitation(client, ctx.orgId, { invitationId: loi.id, actorSessionId: ctx.actor.sessionId, reason: "LINK_SEND_FAILED" });
        },
        phanHoiKhiHong: { status: 502, body: { error: "khong gui duoc link moi, loi moi da thu hoi" } },
        phanHoiKhiBuHong: { status: 500, body: { error: "khong gui duoc link moi va chua thu hoi duoc loi moi", invitationId: loi.id } },
      });
      return { status: 201, body: { invitation: loi } };
    },
  },
  {
    method: "POST",
    path: "/invitations/:invitationId/revoke",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "INVITATION",
    resourceId: invitationIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { revoked: await revokeInvitation(ctx.client, ctx.orgId, { invitationId: invitationIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }) },
    }),
  },
  {
    method: "POST",
    path: "/invitations/:invitationId/unlock",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.INVITATION_UNLOCK,
    resourceType: "INVITATION",
    resourceId: invitationIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: await clearOtpLockout(ctx.client, ctx.orgId, { invitationId: invitationIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool),
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/unseal",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL,
    resourceType: "UNSEAL_REQUEST",
    // [review H2-9] RFQ được yêu cầu mở nằm trong đường dẫn — bản ghi PERMISSION_DENIED phải mang nó.
    resourceId: rfqIdParam,
    // [review lượt 2] `breakGlass: true` qua HTTP hôm nay LUÔN 422: `requestUnseal` đòi
    // `breakGlassWitnessSessionId` (phiên của người làm chứng) mà route không có cách nào truyền —
    // đường break-glass qua HTTP CHƯA ĐI ĐƯỢC, ghi ở §4 của D4, không phải một tính năng đã có.
    handler: async (ctx) => {
      const breakGlass = truong(ctx.req.body, "breakGlass");
      if (breakGlass !== undefined && typeof breakGlass !== "boolean") throw new HttpError(422, 'trường "breakGlass" phải là boolean');
      const r = await requestUnseal(
        ctx.client,
        ctx.orgId,
        {
          rfqId: rfqIdParam(ctx.req),
          reason: chuoiBatBuoc(ctx.req.body, "reason"),
          actorSessionId: ctx.actor.sessionId,
          ...(breakGlass === true ? { breakGlass: true } : {}),
        },
        ctx.auditPool,
      );
      return { status: 201, body: { unsealRequest: r } };
    },
  },
  {
    method: "POST",
    path: "/unseal/:unsealRequestId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL_APPROVE,
    resourceType: "UNSEAL_REQUEST",
    resourceId: unsealIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { unsealRequest: await approveUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  {
    method: "POST",
    path: "/unseal/:unsealRequestId/dispatch",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL,
    resourceType: "UNSEAL_REQUEST",
    resourceId: unsealIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { gate: await dispatchUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  {
    method: "POST",
    path: "/unseal/:unsealRequestId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL,
    resourceType: "UNSEAL_REQUEST",
    resourceId: unsealIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { unsealRequest: await cancelUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  // --------------------------------------------------------------------------------------------
  // [sổ nợ 40 / review M-5] Đặt lại TOTP — hai người. Yêu cầu và phê duyệt cùng một mã quyền; CSDL
  // (040) cấm cùng người, cùng phiên; phê duyệt xoá hồ sơ + thu hồi phiên trong một giao dịch.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/users/:userId/mfa-reset",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.USER_MFA_RESET,
    resourceType: "USER",
    resourceId: userIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        mfaReset: await requestMfaReset(
          ctx.client,
          ctx.orgId,
          { userId: userIdParam(ctx.req), reason: chuoiBatBuoc(ctx.req.body, "reason"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/mfa-resets/:requestId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.USER_MFA_RESET,
    resourceType: "MFA_RESET_REQUEST",
    resourceId: mfaResetIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { mfaReset: await approveMfaReset(ctx.client, ctx.orgId, { requestId: mfaResetIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  // [review H4-2] Huỷ yêu cầu đang chờ — không có route này, một yêu cầu mở nhầm sống 24 giờ và
  // chặn mọi yêu cầu mới cho người ấy suốt thời gian đó.
  {
    method: "POST",
    path: "/mfa-resets/:requestId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.USER_MFA_RESET,
    resourceType: "MFA_RESET_REQUEST",
    resourceId: mfaResetIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { mfaReset: await cancelMfaReset(ctx.client, ctx.orgId, { requestId: mfaResetIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
];

export const ROUTES_BUYER: readonly (BuyerReadRoute | BuyerWriteRoute)[] = [...doc, ...ghi];
