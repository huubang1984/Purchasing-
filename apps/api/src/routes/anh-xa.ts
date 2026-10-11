// ==============================================================================================
// [S1.234 / S4.3b] Route ÁNH XẠ HẠNG MỤC — hàng đợi của người quản lý dữ liệu, trạng thái từng dòng của gói, ba đường ghi (spec S4
// §3.5, §4.4; ADR-135).
//
// GHI: ba route khai `item.manage` — bộ điều phối gọi `requirePermission` TRƯỚC handler (ADR-016); dưới nó, trigger `…_bat_bien` của
// `089_anh_xa_hang_muc` phán lại mọi luật (L2, L3 vế hành vi, L13, §2.5 ⒁). Người tạo gói không có đường ghi ánh xạ nào (spec §4.4:
// *"họ thấy gợi ý và trạng thái hàng đợi"*). Lượt chuẩn hoá SAU lần nộp duyệt không đi qua đây: route nộp duyệt đăng ký nó chạy sau
// commit, dưới phiên người nộp (`buyer.ts`); route `normalize` ở đây là nút *chuẩn hoá lại* của người quản lý dữ liệu, kể cả hồi tố.
//
// ĐỌC: mọi người mua của tổ chức, không mã quyền — khuôn S4.2b: mô tả, đơn vị, số lượng người mua đã viết, không giá. Cả hai
// `agent: false` (chủ dự án chốt 2026-09-30; `apps/mcp/src/cong-cu.ts` khai vì sao). [lượt soi L2] Hàng đợi là đường LIỆT KÊ đầu tiên
// của tổ chức: mọi người mua thấy id, tên và dòng của mọi gói đã nộp còn dòng chờ — ADR-135 ③ nói ra và vì sao nhận.
//
// KHÔNG ĐỌC QUERY (E6): hàng đợi trả tối đa 500 dòng cùng cờ `conNua`, màn lọc trên danh sách ấy.
// ==============================================================================================
import {
  chuanHoaGoi,
  coHangChuanDangDung,
  docAnhXaGoi,
  docHangDoi,
  ghiAnhXa,
  taoHangChuanVaAnhXa,
} from "@trustprocure/du-lieu-nen";
import { PERMISSIONS } from "@trustprocure/identity";
import { getRfq } from "@trustprocure/rfq";
import { HttpError, type ApiRequest } from "../http.js";
import type { BuyerReadRoute, BuyerWriteRoute } from "../route-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function truong(body: unknown, ten: string): unknown {
  return (body as Record<string, unknown> | null | undefined)?.[ten];
}
function chuoiBatBuoc(body: unknown, ten: string): string {
  const v = truong(body, ten);
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}
/** Lý do: vắng hay `null` là không có; có thì phải là chuỗi — hình dạng (không rỗng, không khoảng trắng hai đầu) là `CHECK` ở `089`. */
function lyDoTuyChon(body: unknown): string | null {
  const v = truong(body, "lyDo");
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(422, 'trường "lyDo" phải là chuỗi');
  return v;
}
function taoBiDanhTuyChon(body: unknown): boolean {
  const v = truong(body, "taoBiDanh");
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw new HttpError(422, 'trường "taoBiDanh" phải là true hoặc false');
  return v;
}
/** `hangChuanId` BẮT BUỘC có mặt: `null` là quyết định tường minh *"không có hàng chuẩn tương ứng"* (bác), khác với quên gửi. */
function hangChuanIdBatBuoc(body: unknown): string | null {
  const v = truong(body, "hangChuanId");
  if (v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(422, 'trường "hangChuanId" phải là UUID hoặc null');
  return v;
}
/** [lượt soi L4] Băm (hex) của dòng mà người duyệt đã thấy ở hàng đợi — vắng hay `null` là không so. */
function bamTuyChon(body: unknown): string | null {
  const v = truong(body, "bam");
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/u.test(v)) throw new HttpError(422, 'trường "bam" phải là 64 chữ số hex');
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
/** [S1.9101 / S4.8] Nhóm hàng: vắng hay `null` là không gán; có thì phải là UUID — nhóm có thật, còn dùng là việc của CSDL (`9501`). */
function nhomHangTuyChon(body: unknown): string | null {
  const v = truong(body, "nhomHangId");
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(422, 'trường "nhomHangId" phải là UUID hoặc null');
  return v;
}
/**
 * Tham số đường dẫn; sai hình dạng ⇒ 404 (không phải 422: đường ấy không tồn tại). [S1.260 / S4.5c1] Xuất cho route benchmark — cùng
 * bộ đọc cho cùng hai tham số `:rfqId`, `:lineNo`.
 */
export function rfqIdParam(req: ApiRequest): string {
  const v = req.params["rfqId"] ?? "";
  if (!UUID_RE.test(v)) throw new HttpError(404, "khong co duong nay");
  return v;
}
export function lineNoParam(req: ApiRequest): number {
  const v = req.params["lineNo"] ?? "";
  if (!/^[1-9][0-9]{0,8}$/u.test(v)) throw new HttpError(404, "khong co duong nay");
  return Number(v);
}

const doc: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/mapping-queue",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({ status: 200, body: await docHangDoi(ctx.client, ctx.orgId) }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/mappings",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => {
      const rfqId = rfqIdParam(ctx.req);
      if ((await getRfq(ctx.client, ctx.orgId, rfqId)) === null) throw new HttpError(404, "khong co goi thau");
      // [lượt soi L3] `coHangChuan`: màn ẩn cột *Hàng chuẩn* ở tổ chức chưa khai hàng nào (spec §2.3).
      return {
        status: 200,
        body: { dong: await docAnhXaGoi(ctx.client, ctx.orgId, rfqId), coHangChuan: await coHangChuanDangDung(ctx.client, ctx.orgId) },
      };
    },
  },
];

// ----------------------------------------------------------------------------------------------
// GHI — ba route, một mã quyền, tọa độ là gói. Hàng sổ của lần ghi THÀNH là của gói (`RFQ_ITEMS_NORMALIZED`, `RFQ_ITEM_MAPPED`, và
// `ITEM_CREATED`/`ITEM_ALIAS_DECLARED` khi tạo hàng hay khai bí danh), trong cùng giao dịch với hàng dữ liệu.
// ----------------------------------------------------------------------------------------------
const ghi: readonly BuyerWriteRoute[] = [
  {
    method: "POST",
    path: "/rfqs/:rfqId/normalize",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { ketQua: await chuanHoaGoi(ctx.client, ctx.orgId, { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }) },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/items/:lineNo/mapping",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const { seq } = await ghiAnhXa(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        lineNo: lineNoParam(ctx.req),
        hangChuanId: hangChuanIdBatBuoc(ctx.req.body),
        lyDo: lyDoTuyChon(ctx.req.body),
        taoBiDanh: taoBiDanhTuyChon(ctx.req.body),
        bamMongDoi: bamTuyChon(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { seq } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/items/:lineNo/mapping/new-item",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.ITEM_MANAGE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const { hangChuanId, seq } = await taoHangChuanVaAnhXa(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        lineNo: lineNoParam(ctx.req),
        hangChuan: {
          ma: chuoiBatBuoc(ctx.req.body, "ma"),
          ten: chuoiBatBuoc(ctx.req.body, "ten"),
          donViGoc: chuoiBatBuoc(ctx.req.body, "donViGoc"),
          thuocTinh: thuocTinhTuyChon(ctx.req.body),
          thuocTinhTrongYeu: trongYeuTuyChon(ctx.req.body),
          nhomHangId: nhomHangTuyChon(ctx.req.body),
        },
        lyDo: lyDoTuyChon(ctx.req.body),
        taoBiDanh: taoBiDanhTuyChon(ctx.req.body),
        bamMongDoi: bamTuyChon(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { hangChuanId, seq } };
    },
  },
];

export const ROUTES_ANH_XA: readonly (BuyerReadRoute | BuyerWriteRoute)[] = [...doc, ...ghi];
