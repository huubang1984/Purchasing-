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
import { PERMISSIONS, approveMfaReset, cancelMfaReset, requestMfaReset } from "@trustprocure/identity";
import {
  clearOtpLockout,
  createInvitation,
  issueMagicLinkToken,
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
    handler: (ctx) =>
      Promise.resolve({
        status: 200,
        body: { userId: ctx.actor.id, sessionId: ctx.actor.sessionId, orgId: ctx.orgId },
      }),
  },
  {
    method: "GET",
    path: "/suppliers",
    audience: "BUYER",
    mutates: false,
    handler: async (ctx) => ({ status: 200, body: { suppliers: await listSuppliers(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/suppliers/:supplierId",
    audience: "BUYER",
    mutates: false,
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
    handler: async (ctx) => ({ status: 200, body: { policy: await getActiveProcurementPolicy(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId",
    audience: "BUYER",
    mutates: false,
    handler: async (ctx) => {
      const r = await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co goi thau");
      return { status: 200, body: { rfq: r } };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/items",
    audience: "BUYER",
    mutates: false,
    handler: async (ctx) => ({ status: 200, body: { items: await listRfqItems(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } }),
  },
  {
    method: "GET",
    path: "/unseal/:unsealRequestId",
    audience: "BUYER",
    mutates: false,
    handler: async (ctx) => {
      const r = await getUnsealRequest(ctx.client, ctx.orgId, unsealIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co yeu cau mo thau");
      return { status: 200, body: { unsealRequest: r } };
    },
  },
  // Hai đường ĐỌC CÓ CỔNG (khoản nợ 33): gói tự gọi requirePermission(BID_VIEW). Route là GET vì
  // chúng không đổi trạng thái; cổng nằm trong gói vì mục đích duy nhất của chúng là kiểm soát
  // TIẾT LỘ (A4, A6) — và `auditPool` ở đây là để lần từ chối có bản ghi (D5).
  {
    method: "GET",
    path: "/rfqs/:rfqId/comparison",
    audience: "BUYER",
    mutates: false,
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
];

// ----------------------------------------------------------------------------------------------
// GHI — mỗi route một mã quyền. `resourceId` đọc từ ĐƯỜNG DẪN, không từ thân.
// ----------------------------------------------------------------------------------------------
const ghi: readonly BuyerWriteRoute[] = [
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
      await ctx.services.invitationLinkSender.send({
        orgId: ctx.orgId,
        invitationId: loi.id,
        channel: loi.linkChannel,
        destination: loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? ""),
        token: t.token,
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
