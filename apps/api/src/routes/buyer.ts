// ==============================================================================================
// Route NGƯỜI MUA — phiên nội bộ đã qua MFA. `ctx.client` đã gắn tổ chức; với route `mutates:
// true`, bộ điều phối đã gọi `requirePermission` TRƯỚC khi vào đây, nên handler không kiểm quyền
// và cũng KHÔNG ĐƯỢC kiểm — một cổng thứ hai ở đây là hai nơi để lệch nhau.
//
// S1.10.2 có ba route, đủ để đo ba điều của khung: phiên dẫn xuất từ cookie (`GET /me`), đường
// đọc không cổng (`GET /suppliers`), và đường ghi CÓ cổng (`POST /suppliers`, [INV-H17]). Đầy đủ
// route nghiệp vụ là S1.10.5.
// ==============================================================================================
import { PERMISSIONS } from "@trustprocure/identity";
import { createSupplier, listSuppliers } from "@trustprocure/supplier";
import { HttpError } from "../http.js";
import type { BuyerReadRoute, BuyerWriteRoute } from "../route-types.js";

/** Đọc một trường chuỗi bắt buộc của thân JSON; 422 khi thiếu hoặc sai kiểu. */
function chuoiBatBuoc(body: unknown, ten: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (typeof v !== "string" || v.trim() === "") {
    throw new HttpError(422, `thiếu trường "${ten}"`);
  }
  return v;
}

function chuoiTuyChon(body: unknown, ten: string): string | null {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(422, `trường "${ten}" phải là chuỗi`);
  return v;
}

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
    handler: async (ctx) => ({
      status: 200,
      body: { suppliers: await listSuppliers(ctx.client, ctx.orgId) },
    }),
  },
];

const ghi: readonly BuyerWriteRoute[] = [
  {
    method: "POST",
    path: "/suppliers",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    resourceType: "SUPPLIER",
    handler: async (ctx) => {
      const legalName = chuoiBatBuoc(ctx.req.body, "legalName");
      const taxCode = chuoiTuyChon(ctx.req.body, "taxCode");
      const supplier = await createSupplier(ctx.client, ctx.orgId, {
        legalName,
        taxCode,
        // [ADR-016] Danh tính là DẪN XUẤT: phiên đến từ cookie, không từ thân yêu cầu.
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { supplier } };
    },
  },
];

export const ROUTES_BUYER: readonly (BuyerReadRoute | BuyerWriteRoute)[] = [...doc, ...ghi];
