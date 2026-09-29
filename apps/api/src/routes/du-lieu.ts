// ==============================================================================================
// [S1.9101 / S4.2b] Route DỮ LIỆU NỀN — hàng chuẩn, bí danh hàng, quy đổi riêng, bí danh đơn vị (spec S4 §3.5, §4.2, §4.3).
//
// GHI: mọi route khai `item.manage` — bộ điều phối gọi `requirePermission` TRƯỚC handler (ADR-016), và trigger
// `du_lieu_nen_kiem_quyen_ghi` đứng dưới nó ở CSDL (ADR-116 ⑹). Hai cổng, hai tầng; handler không kiểm lần thứ ba.
//
// ĐỌC: mọi người mua của tổ chức, không mã quyền — hàng chuẩn không mang giá (spec §4.3: *"đọc nó không phải là đọc giá"*), và
// chủ dự án chốt ngày 2026-09-29 đọc rộng hơn *"người giữ `rfq.create`"* của spec thay vì dựng cổng đọc mới cho route. Cả ba
// `agent: false`: màn `/du-lieu` là màn của người (`apps/mcp/src/cong-cu.ts` khai vì sao).
//
// KHÔNG TÌM Ở MÁY CHỦ. `router.ts` cắt bỏ query và không đọc nó (⑵, E6), nên `GET /items` trả tối đa 500 hàng xếp theo mã
// cùng cờ `conNua` (`TRAN_LIET_KE_HANG_CHUAN` của gói); màn lọc trên danh sách ấy. Mở một đường đọc query là một quyết định
// về E6, không thuộc vòng này.
//
// Danh tính ở mọi lời gọi gói là `ctx.actor.sessionId` — dẫn xuất từ cookie (ADR-016); thân chỉ mang dữ liệu nghiệp vụ.
// ==============================================================================================
import {
  docChiTietHangChuan,
  docDanhMucDonVi,
  khaiBiDanhDonVi,
  khaiBiDanhHang,
  khaiQuyDoiRieng,
  lietKeHangChuan,
  rutBiDanhDonVi,
  rutBiDanhHang,
  rutQuyDoiRieng,
  taoHangChuan,
  taoPhienBanHangChuan,
} from "@trustprocure/du-lieu-nen";
import { PERMISSIONS, listUserIdsWithPermission } from "@trustprocure/identity";
import { HttpError, type ApiRequest } from "../http.js";
import type { BuyerReadRoute, BuyerWriteRoute } from "../route-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Đọc thân — cùng khuôn `buyer.ts`: 422 khi thiếu hay sai kiểu, thông điệp chỉ nêu TÊN trường. Hình dạng bên trong (mã, khoá
// thuộc tính, hệ số) là việc của gói và của `CHECK` ở `083`.
function truong(body: unknown, ten: string): unknown {
  return (body as Record<string, unknown> | null | undefined)?.[ten];
}
function chuoiBatBuoc(body: unknown, ten: string): string {
  const v = truong(body, ten);
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}
function thuocTinhTuyChon(body: unknown): Readonly<Record<string, string>> | undefined {
  const v = truong(body, "thuocTinh");
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v) || Object.values(v).some((x) => typeof x !== "string")) {
    throw new HttpError(422, 'trường "thuocTinh" phải là object chuỗi → chuỗi');
  }
  return v as Readonly<Record<string, string>>;
}
function trongYeuTuyChon(body: unknown): readonly string[] | undefined {
  const v = truong(body, "thuocTinhTrongYeu");
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(422, 'trường "thuocTinhTrongYeu" phải là mảng chuỗi');
  return v as readonly string[];
}
function trangThaiTuyChon(body: unknown): "DANG_DUNG" | "NGUNG_DUNG" | undefined {
  const v = truong(body, "trangThai");
  if (v === undefined || v === null) return undefined;
  if (v !== "DANG_DUNG" && v !== "NGUNG_DUNG") throw new HttpError(422, 'trường "trangThai" phải là DANG_DUNG hoặc NGUNG_DUNG');
  return v;
}
/** Tham số đường dẫn UUID; sai hình dạng ⇒ 404 (không phải 422: đường ấy không tồn tại). */
function itemIdParam(req: ApiRequest): string {
  const v = req.params["itemId"] ?? "";
  if (!UUID_RE.test(v)) throw new HttpError(404, "khong co duong nay");
  return v;
}

const doc: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/items",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const { hangChuan, conNua } = await lietKeHangChuan(ctx.client, ctx.orgId);
      // `choGhi` và `soNguoiQuanLy` để MÀN biết mở phần ghi hay nói §8.10 — không phải một cổng: cổng là `requirePermission` của
      // route ghi. Vì thế đọc bằng `listUserIdsWithPermission` (một danh sách, như lời khai của nó ở `rbac.ts`) chứ không mở
      // `hasPermission` ra mặt tiền gói.
      const nguoiQuanLy = await listUserIdsWithPermission(ctx.client, ctx.orgId, PERMISSIONS.ITEM_MANAGE);
      return {
        status: 200,
        body: {
          hangChuan,
          conNua,
          choGhi: nguoiQuanLy.includes(ctx.actor.id),
          soNguoiQuanLy: nguoiQuanLy.length,
        },
      };
    },
  },
  {
    method: "GET",
    path: "/items/:itemId",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const chiTiet = await docChiTietHangChuan(ctx.client, ctx.orgId, itemIdParam(ctx.req));
      if (chiTiet === null) throw new HttpError(404, "khong co hang chuan nay");
      return { status: 200, body: chiTiet };
    },
  },
  {
    method: "GET",
    path: "/uom",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({ status: 200, body: await docDanhMucDonVi(ctx.client, ctx.orgId) }),
  },
];

// ----------------------------------------------------------------------------------------------
// GHI — tám route, một mã quyền. `resourceType` đi vào hàng PERMISSION_DENIED của sổ khi cổng từ chối; hàng sổ của lần ghi THÀNH
// là của gói (`canonical_item`, `uom_alias`), trong cùng giao dịch với hàng dữ liệu.
// ----------------------------------------------------------------------------------------------
const ghi: readonly BuyerWriteRoute[] = [
  {
    method: "POST",
    path: "/items",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    handler: async (ctx) => {
      const hangChuan = await taoHangChuan(ctx.client, ctx.orgId, {
        ma: chuoiBatBuoc(ctx.req.body, "ma"),
        donViGoc: chuoiBatBuoc(ctx.req.body, "donViGoc"),
        ten: chuoiBatBuoc(ctx.req.body, "ten"),
        thuocTinh: thuocTinhTuyChon(ctx.req.body),
        thuocTinhTrongYeu: trongYeuTuyChon(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { hangChuan } };
    },
  },
  {
    method: "POST",
    path: "/items/:itemId/versions",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    resourceId: itemIdParam,
    handler: async (ctx) => {
      const phienBan = await taoPhienBanHangChuan(ctx.client, ctx.orgId, {
        hangChuanId: itemIdParam(ctx.req),
        ten: chuoiBatBuoc(ctx.req.body, "ten"),
        thuocTinh: thuocTinhTuyChon(ctx.req.body),
        thuocTinhTrongYeu: trongYeuTuyChon(ctx.req.body),
        trangThai: trangThaiTuyChon(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { phienBan } };
    },
  },
  {
    method: "POST",
    path: "/items/:itemId/aliases",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    resourceId: itemIdParam,
    handler: async (ctx) => {
      const biDanh = await khaiBiDanhHang(ctx.client, ctx.orgId, {
        hangChuanId: itemIdParam(ctx.req),
        biDanh: chuoiBatBuoc(ctx.req.body, "biDanh"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { biDanh } };
    },
  },
  {
    method: "POST",
    path: "/items/:itemId/aliases/withdraw",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    resourceId: itemIdParam,
    handler: async (ctx) => {
      // Rút là một hàng MỚI (`rut = true`), không phải DELETE — nên POST. `hangChuanId` giữ nút rút trên trang của D10 khỏi rút
      // một bí danh đang trỏ sang D32.
      const rut = await rutBiDanhHang(ctx.client, ctx.orgId, {
        hangChuanId: itemIdParam(ctx.req),
        biDanh: chuoiBatBuoc(ctx.req.body, "biDanh"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { rut } };
    },
  },
  {
    method: "POST",
    path: "/items/:itemId/conversions",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    resourceId: itemIdParam,
    handler: async (ctx) => {
      const quyDoi = await khaiQuyDoiRieng(ctx.client, ctx.orgId, {
        hangChuanId: itemIdParam(ctx.req),
        tuDonVi: chuoiBatBuoc(ctx.req.body, "tuDonVi"),
        sangDonVi: chuoiBatBuoc(ctx.req.body, "sangDonVi"),
        // Hệ số đi dưới dạng CHUỖI thập phân — không qua `number` (ADR-053 ⑴); gói kiểm hình dạng.
        heSo: chuoiBatBuoc(ctx.req.body, "heSo"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { quyDoi } };
    },
  },
  {
    method: "POST",
    path: "/items/:itemId/conversions/withdraw",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "CANONICAL_ITEM",
    resourceId: itemIdParam,
    handler: async (ctx) => {
      const rut = await rutQuyDoiRieng(ctx.client, ctx.orgId, {
        hangChuanId: itemIdParam(ctx.req),
        tuDonVi: chuoiBatBuoc(ctx.req.body, "tuDonVi"),
        sangDonVi: chuoiBatBuoc(ctx.req.body, "sangDonVi"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { rut } };
    },
  },
  {
    method: "POST",
    path: "/uom/aliases",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "UOM_ALIAS",
    handler: async (ctx) => {
      const biDanh = await khaiBiDanhDonVi(ctx.client, ctx.orgId, {
        biDanh: chuoiBatBuoc(ctx.req.body, "biDanh"),
        donVi: chuoiBatBuoc(ctx.req.body, "donVi"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { biDanh } };
    },
  },
  {
    method: "POST",
    path: "/uom/aliases/withdraw",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "UOM_ALIAS",
    handler: async (ctx) => {
      const rut = await rutBiDanhDonVi(ctx.client, ctx.orgId, {
        biDanh: chuoiBatBuoc(ctx.req.body, "biDanh"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { rut } };
    },
  },
];

export const ROUTES_DU_LIEU: readonly (BuyerReadRoute | BuyerWriteRoute)[] = [...doc, ...ghi];
