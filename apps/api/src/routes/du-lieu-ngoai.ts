// ==============================================================================================
// [S1.9101 / S4.6a] Route MỐC GIÁ NGOÀI VÀ LỊCH SỬ MUA NGOÀI HỆ THỐNG — đường ghi và danh sách KHÔNG cột giá (spec S4 §3.5, §4.7;
// ADR-096; ADR-9201).
//
// GHI: mọi route khai `item.manage` — `requirePermission` của bộ điều phối TRƯỚC handler (ADR-016), trigger
// `du_lieu_nen_kiem_quyen_ghi` dưới nó ở CSDL. Dán CSV là thân JSON `{ vanBan }`, không multipart (ADR-096 ⑸): trần thân 64 KB của
// `router.ts` giữ nguyên. Lô sai ⇒ 422 mang danh sách lỗi THEO DÒNG (`loi`), không lặp lại giá trị nào của ô.
//
// ĐỌC: cổng `item.manage` nằm TRONG `lietKeLoDuLieuNgoai`/`docLoDuLieuNgoai` (rổ `HAM_DOC_CO_QUYEN`) — người quản lý dữ liệu mù giá
// thấy lô, hàng chuẩn, đơn vị, ngày, nguồn, KHÔNG đơn giá (chủ dự án chốt 2026-10-06). `agent: false`: màn `/du-lieu` là màn của
// người, và spec §3.5 khai mọi route mốc ngoài là `agent: false` (`apps/mcp/src/cong-cu.ts` khai vì sao).
//
// KHÔNG ĐỌC QUERY (E6). Danh tính ở mọi lời gọi gói là `ctx.actor.sessionId`.
// ==============================================================================================
import {
  docLoDuLieuNgoai,
  khaiMocNgoai,
  lietKeLoDuLieuNgoai,
  nhapDuLieuNgoai,
  rutDuLieuNgoai,
  type KetQuaNhapNgoai,
  type LoaiDuLieuNgoai,
} from "@trustprocure/du-lieu-nen";
import { PERMISSIONS } from "@trustprocure/identity";
import { HttpError, type ApiRequest, type ApiResponse } from "../http.js";
import type { BuyerReadRoute, BuyerWriteRoute } from "../route-types.js";
import { itemIdParam } from "./du-lieu.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function chuoiBatBuoc(body: unknown, ten: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}
/** Tham số đường dẫn UUID; sai hình dạng ⇒ 404. */
function uuidParam(req: ApiRequest, ten: "batchId" | "rowId"): string {
  const v = req.params[ten] ?? "";
  if (!UUID_RE.test(v)) throw new HttpError(404, "khong co duong nay");
  return v;
}
const batchIdParam = (req: ApiRequest): string => uuidParam(req, "batchId");
const rowIdParam = (req: ApiRequest): string => uuidParam(req, "rowId");

/** Lô nhận ⇒ 201; lô sai ⇒ 422 với lỗi theo dòng. */
function phanHoiNhap(kq: KetQuaNhapNgoai): ApiResponse {
  if (kq.nhan) return { status: 201, body: { lo: { loai: kq.loai, loNhapId: kq.loNhapId, soDong: kq.soDong, soHangChuan: kq.soHangChuan } } };
  return { status: 422, body: { error: `lô bị từ chối: ${String(kq.loi.length)} lỗi — không dòng nào được ghi`, loi: kq.loi } };
}

const doc: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/external-data/batches",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { lo: await lietKeLoDuLieuNgoai(ctx.client, ctx.orgId, { actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  ...(
    [
      ["/external-references/batches/:batchId", "MOC_NGOAI"],
      ["/external-purchase-history/batches/:batchId", "LICH_SU_NGOAI"],
    ] as const
  ).map(
    ([path, loai]): BuyerReadRoute => ({
      method: "GET",
      path,
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: async (ctx) => {
        const lo = await docLoDuLieuNgoai(
          ctx.client,
          ctx.orgId,
          { loai, loNhapId: batchIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        );
        if (lo === null) throw new HttpError(404, "khong co lo nay");
        return { status: 200, body: { lo } };
      },
    }),
  ),
];

const nhap = (path: string, loai: LoaiDuLieuNgoai): BuyerWriteRoute => ({
  method: "POST",
  path,
  audience: "BUYER",
  mutates: true,
  permission: PERMISSIONS.ITEM_MANAGE,
  resourceType: "EXTERNAL_DATA_BATCH",
  handler: async (ctx) =>
    phanHoiNhap(
      await nhapDuLieuNgoai(ctx.client, ctx.orgId, {
        loai,
        vanBan: chuoiBatBuoc(ctx.req.body, "vanBan"),
        actorSessionId: ctx.actor.sessionId,
      }),
    ),
});

const rutLo = (path: string, loai: LoaiDuLieuNgoai): BuyerWriteRoute => ({
  method: "POST",
  path,
  audience: "BUYER",
  mutates: true,
  permission: PERMISSIONS.ITEM_MANAGE,
  resourceType: "EXTERNAL_DATA_BATCH",
  resourceId: batchIdParam,
  handler: async (ctx) => {
    // Rút là hàng MỚI (một hàng rút cho mỗi hàng còn hiệu lực), không DELETE — nên POST.
    const rut = await rutDuLieuNgoai(ctx.client, ctx.orgId, { loai, loNhapId: batchIdParam(ctx.req), actorSessionId: ctx.actor.sessionId });
    return { status: 201, body: { rut } };
  },
});

const rutHang = (path: string, loai: LoaiDuLieuNgoai): BuyerWriteRoute => ({
  method: "POST",
  path,
  audience: "BUYER",
  mutates: true,
  permission: PERMISSIONS.ITEM_MANAGE,
  resourceType: "EXTERNAL_DATA_ROW",
  resourceId: rowIdParam,
  handler: async (ctx) => {
    const rut = await rutDuLieuNgoai(ctx.client, ctx.orgId, { loai, hangId: rowIdParam(ctx.req), actorSessionId: ctx.actor.sessionId });
    return { status: 201, body: { rut } };
  },
});

const ghi: readonly BuyerWriteRoute[] = [
  {
    method: "POST",
    path: "/items/:itemId/external-references",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    resourceId: itemIdParam,
    handler: async (ctx) => {
      const moc = await khaiMocNgoai(ctx.client, ctx.orgId, {
        hangChuanId: itemIdParam(ctx.req),
        // Đơn giá đi dưới dạng CHUỖI thập phân — không qua `number` (ADR-053 ⑴); gói kiểm hình dạng.
        donGia: chuoiBatBuoc(ctx.req.body, "donGia"),
        donVi: chuoiBatBuoc(ctx.req.body, "donVi"),
        tienTe: chuoiBatBuoc(ctx.req.body, "tienTe"),
        ngayHieuLuc: chuoiBatBuoc(ctx.req.body, "ngayHieuLuc"),
        nguon: chuoiBatBuoc(ctx.req.body, "nguon"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { moc } };
    },
  },
  nhap("/external-references/import", "MOC_NGOAI"),
  nhap("/external-purchase-history/import", "LICH_SU_NGOAI"),
  rutLo("/external-references/batches/:batchId/withdraw", "MOC_NGOAI"),
  rutLo("/external-purchase-history/batches/:batchId/withdraw", "LICH_SU_NGOAI"),
  rutHang("/external-references/:rowId/withdraw", "MOC_NGOAI"),
  rutHang("/external-purchase-history/:rowId/withdraw", "LICH_SU_NGOAI"),
];

export const ROUTES_DU_LIEU_NGOAI: readonly (BuyerReadRoute | BuyerWriteRoute)[] = [...doc, ...ghi];
