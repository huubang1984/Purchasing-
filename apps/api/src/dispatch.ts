// ==============================================================================================
// apps/api/src/dispatch.ts — NƠI DUY NHẤT gắn tổ chức, gắn phiên khách, và kiểm quyền.
//
// [ADR-020 mục 4] Ba tên `withTenant`, `withGuestSession`, `requirePermission` chỉ được xuất hiện
// trong file này trên toàn `apps/api` — `routes.test.ts` đọc mã nguồn và đỏ nếu chúng mọc ở chỗ
// khác. Lý do là hình dạng của lỗi cần chặn: một route mới quên gắn phiên khách KHÔNG viết được
// (handler không có pool để tự mở), và một route ghi quên kiểm quyền KHÔNG biên dịch được
// (`BuyerWriteRoute` đòi `permission`). Lớp canh không phải để bắt kẻ tấn công — nó để bắt một sơ
// suất, và sơ suất thì có đúng một hình dạng.
//
// ---------------------------------------------------------------------------------------------
// BỐN ĐỐI TƯỢNG, BỐN CÁCH VÀO
// ---------------------------------------------------------------------------------------------
//   PUBLIC  không tổ chức, không CSDL.
//   ANON    tổ chức đọc từ THÂN (`orgId`), gắn `withTenant`; thẩm quyền do chính handler chứng
//           minh bằng token trong thân (magic link, OTP). Chỉ ở /guest/* và /auth/*.
//   GUEST   cookie `tp_guest=<orgId>.<token>` → `resolveGuestSessionByToken` (một giao dịch) →
//           route ĐỌC: `withGuestSession` (giao dịch thứ hai, đặt ba GUC) → handler;
//           route GHI: `withTenant` (KHÔNG GUC) → handler. Vì sao rẽ nhánh — xem khối dưới.
//   BUYER   cookie `tp_session=<orgId>.<token>` → `resolveSessionByToken` → nếu route ghi thì
//           `requirePermission` → handler. Tất cả trong MỘT `withTenant`.
//
// ---------------------------------------------------------------------------------------------
// [S1.10.3] ĐƯỜNG GHI CỦA KHÁCH KHÔNG ĐI QUA `withGuestSession` — ĐO ĐƯỢC, KHÔNG PHẢI LỰA CHỌN TIỆN
// ---------------------------------------------------------------------------------------------
// `submitBid` chèn một sự kiện vào sổ kiểm toán trong CÙNG giao dịch với phiên bản báo giá. Trigger
// nối chuỗi (`noi_chuoi_kiem_toan`, 004) là SECURITY INVOKER và tìm đầu chuỗi bằng một SELECT trên
// `audit_events` dưới chính RLS của kết nối. Một kết nối đã gắn phiên khách có USING đóng trên sổ
// (027), nên trigger thấy 0 hàng và chèn một NHÁNH RẼ; mở USING cho khách thì một nhà cung cấp đọc
// được sổ của cả tổ chức (A5). Đo ở 028 và ở `guest.int.test.ts`. Kết luận: kết nối gắn phiên khách
// KHÔNG BAO GIỜ chèn vào sổ — nên route khách `mutates: true` nhận kết nối `withTenant` sau khi phiên
// đã được xác thực. Cô lập của đường ghi do CSDL giữ: trigger `bid_kiem_phien_khach` (018) và chữ ký
// `submitBid` (chỉ nhận `guestSessionId`; bid/invitation/rfq DẪN XUẤT). Phần chênh so với ADR-020
// mục 4 ghi ở §4 của A5: một handler ghi cẩu thả có thể SELECT rộng hơn phiên của nó, và lớp duy
// nhất cho ca ấy là review — handler ghi của khách vì thế KHÔNG được viết SQL tay (chỉ gọi gói).
//
// ---------------------------------------------------------------------------------------------
// ÁNH XẠ LỖI → MÃ HTTP, và vì sao có HAI GIAI ĐOẠN
// ---------------------------------------------------------------------------------------------
// Giai đoạn 1 (xác thực): mọi lỗi ⇒ 401 với CÙNG MỘT thân, bất kể là thiếu cookie, sai hình dạng,
// token không khớp, phiên hết hạn, hay tổ chức không tồn tại. Phân biệt chúng là một oracle trên
// tập phiên — cùng lý do `resolveSessionActor` và `docToken` ném một thông điệp cho bốn ca.
// Giai đoạn 2 (handler): `PermissionDeniedError` ⇒ 403; `HttpError` ⇒ mã của nó; lỗi nghiệp vụ
// có tên (`SupplierError`, `RfqError`, …) ⇒ 422 kèm thông điệp — các lớp ấy đã chịu kỷ luật
// "không nội suy dữ liệu vào message"; MỌI lỗi khác ⇒ 500 với thân cố định, và chỉ TÊN lỗi được
// ghi ra `console.error` — không stack có payload, không thân yêu cầu (A2).
// ==============================================================================================

import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  MfaRequiredError,
  PermissionDeniedError,
  requirePermission,
  resolveSessionByToken,
  SessionInvalidError,
  type SessionActor,
} from "@trustprocure/identity";
import { InvitationError, resolveGuestSessionByToken } from "@trustprocure/invitation";
import { TenantError, withGuestSession, withTenant } from "@trustprocure/tenancy";
import { HttpError, type ApiRequest, type ApiResponse } from "./http.js";
import { ghepDuongDan, tachCookiePhien, tachDoan } from "./router.js";
import type { ApiServices, Route } from "./route-types.js";
import { COOKIE_PHIEN_KHACH } from "./routes/anon.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { ROUTES } from "./routes.js";

export { COOKIE_PHIEN_NGUOI_MUA };

export interface DispatcherDeps {
  /** Pool chạy dưới `app_api`. */
  readonly pool: pg.Pool;
  /** Pool ghi sổ kiểm toán ĐỘC LẬP cho lần từ chối quyền (D5) — cùng hợp đồng với `requirePermission`. */
  readonly auditPool: pg.Pool;
  /** Pepper OTP, bộ gửi OTP, bộ ký biên nhận — TIÊM, không mặc định (cùng khuôn `BreakGlassAlertSink`). */
  readonly services: ApiServices;
  /** Mặc định `ROUTES`; test tiêm một bảng khác để đo bộ điều phối trên route giả. */
  readonly routes?: readonly Route[];
}

export type Dispatcher = (req: Omit<ApiRequest, "params" | "requestId">) => Promise<ApiResponse>;

/** Tên các lớp lỗi nghiệp vụ được phép đi ra ngoài dưới 422. Danh sách ĐÓNG, có chủ đích. */
const LOI_NGHIEP_VU_422: ReadonlySet<string> = new Set([
  "SupplierError",
  "RfqError",
  "InvitationError",
  // [S1.10.4] token đăng nhập hỏng/hết hạn/đã dùng — cùng lớp với InvitationError của khách.
  "LoginTokenError",
  "BiddingError",
  "ReceiptError",
  "SealedEnvelopeError",
  "UnsealError",
  "UnsealDeniedError",
  "ComparisonError",
  "ComparisonDeniedError",
]);

const THAN_401 = { error: "phien khong hop le" } as const;
const THAN_403 = { error: "khong co quyen" } as const;
const THAN_404 = { error: "khong co duong nay" } as const;
const THAN_405 = { error: "phuong thuc khong duoc ho tro" } as const;
const THAN_500 = { error: "loi noi bo" } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Lỗi ném ra từ giai đoạn xác thực — bọc để ánh xạ thành 401 mà không mất nguyên nhân. */
class LoiXacThuc extends Error {
  constructor(options?: { cause?: unknown }) {
    super("xac thuc that bai", options);
    this.name = "LoiXacThuc";
  }
}

function timRoute(
  routes: readonly Route[],
  method: ApiRequest["method"],
  path: string,
): { route: Route; params: Readonly<Record<string, string>> } | ApiResponse {
  const doan = tachDoan(path);
  if (doan === null) return { status: 404, body: THAN_404 };
  let cungDuong = false;
  for (const r of routes) {
    const ghep = ghepDuongDan(r.path, doan);
    if (ghep === null) continue;
    if (r.method === method) return { route: r, params: ghep.params };
    cungDuong = true;
  }
  return cungDuong ? { status: 405, body: THAN_405 } : { status: 404, body: THAN_404 };
}

/**
 * Lỗi Postgres mang SQLSTATE — và ở dự án này, lớp 23 (toàn vẹn) chính là nơi LỚP CSDL nói "không":
 * trigger máy trạng thái, phân tách nhiệm vụ, ràng buộc duy nhất. Chúng là câu trả lời nghiệp vụ,
 * không phải sự cố. Ánh xạ HẸP, theo mã, và chỉ để lộ thông điệp cho `check_violation` (23514) —
 * thông điệp ấy do migration VIẾT, không nội suy dữ liệu người dùng; các mã còn lại đi ra với thân
 * cố định. Mọi mã khác (kể cả 42xxx cú pháp, 08xxx kết nối) là 500 câm — đó là lỗi của chúng ta.
 */
function anhXaLoiPostgres(err: Error & { code?: unknown }): ApiResponse | null {
  const code = typeof err.code === "string" ? err.code : "";
  if (code === "23514") return { status: 422, body: { error: err.message } };
  if (code === "23505") return { status: 409, body: { error: "xung dot du lieu" } };
  if (code === "23503") return { status: 422, body: { error: "tham chieu khong hop le" } };
  if (code === "42501") return { status: 403, body: THAN_403 };
  return null;
}

function anhXaLoiHandler(err: unknown, requestId: string): ApiResponse {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  if (err instanceof PermissionDeniedError) return { status: 403, body: THAN_403 };
  if (err instanceof MfaRequiredError) return { status: 401, body: THAN_401 };
  if (err instanceof Error && LOI_NGHIEP_VU_422.has(err.name)) {
    return { status: 422, body: { error: err.message } };
  }
  if (err instanceof Error && err.name === "error" && "code" in err) {
    const pg = anhXaLoiPostgres(err as Error & { code?: unknown });
    if (pg !== null) return pg;
  }
  // Chỉ TÊN lỗi và mã yêu cầu. Không `err` nguyên, không `cause`: `cause` của một lỗi Postgres
  // mang câu lệnh và tham số, tức có thể mang một phong bì hay một mã OTP (A2).
  console.error(`[api] ${requestId} ${err instanceof Error ? err.name : "loi khong ro"}`);
  return { status: 500, body: THAN_500 };
}

/** `orgId` của một yêu cầu vô danh: trong THÂN, đúng hình dạng UUID — hoặc không có gì để gắn. */
function orgIdTuThan(body: unknown): string | null {
  const v = (body as Record<string, unknown> | null | undefined)?.orgId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const routes = deps.routes ?? ROUTES;

  return async (vao) => {
    const requestId = randomUUID();
    const tim = timRoute(routes, vao.method, vao.path);
    if (!("route" in tim)) return tim;
    const req: ApiRequest = { ...vao, params: tim.params, requestId };
    const route = tim.route;

    try {
      switch (route.audience) {
        case "PUBLIC":
          return await route.handler({ req });

        case "ANON": {
          const orgId = orgIdTuThan(req.body);
          if (orgId === null) throw new HttpError(422, 'thiếu trường "orgId"');
          return await withTenant(deps.pool, orgId, (client) =>
            route.handler({ req, orgId, client, services: deps.services }),
          );
        }

        case "BUYER": {
          const cookie = tachCookiePhien(req.cookies[COOKIE_PHIEN_NGUOI_MUA]);
          if (cookie === null) return { status: 401, body: THAN_401 };
          return await withTenant(deps.pool, cookie.orgId, async (client) => {
            let actor: SessionActor;
            try {
              actor = await resolveSessionByToken(client, cookie.orgId, cookie.token);
            } catch (e) {
              throw new LoiXacThuc({ cause: e });
            }
            // Route TỰ THÂN (đăng xuất) không có mã quyền — nó chỉ chạm phiên của chính người gọi.
            if (route.mutates && route.self !== true) {
              await requirePermission(
                client,
                {
                  userId: actor.id,
                  orgId: cookie.orgId,
                  permission: route.permission,
                  resourceType: route.resourceType,
                  resourceId: route.resourceId?.(req) ?? null,
                  requestId,
                },
                deps.auditPool,
              );
            }
            return route.handler({ req, orgId: cookie.orgId, client, actor, auditPool: deps.auditPool, services: deps.services });
          });
        }

        case "GUEST": {
          const cookie = tachCookiePhien(req.cookies[COOKIE_PHIEN_KHACH]);
          if (cookie === null) return { status: 401, body: THAN_401 };
          let phien: { guestSessionId: string; invitationId: string; rfqId: string };
          try {
            phien = await withTenant(deps.pool, cookie.orgId, (client) =>
              resolveGuestSessionByToken(client, cookie.orgId, cookie.token),
            );
          } catch (e) {
            throw new LoiXacThuc({ cause: e });
          }
          const goiHandler = (client: pg.PoolClient): Promise<ApiResponse> =>
            route.handler({
              req,
              orgId: cookie.orgId,
              client,
              guestSessionId: phien.guestSessionId,
              invitationId: phien.invitationId,
              rfqId: phien.rfqId,
              services: deps.services,
            });
          // Đường GHI: `withTenant`, không GUC — xem khối [S1.10.3] ở đầu file.
          if (route.mutates) return await withTenant(deps.pool, cookie.orgId, goiHandler);
          // Đường ĐỌC: `withGuestSession` tự đọc lại hàng phiên, từ chối phiên thu hồi/hết hạn, và
          // đặt CẢ BA GUC. Handler nhận `client` khi mọi việc ấy đã xong — hoặc không nhận gì cả.
          return await withGuestSession(deps.pool, cookie.orgId, phien.guestSessionId, goiHandler);
        }
      }
    } catch (err) {
      if (err instanceof LoiXacThuc) return { status: 401, body: THAN_401 };
      // `withTenant` ném TenantError cho một orgId SAI HÌNH DẠNG (nó KHÔNG tra `organizations` —
      // một orgId lạ nhưng đúng UUID đi qua và RLS lọc thành 0 hàng), và `withGuestSession` ném
      // TenantError cho một phiên khách hỏng — cả hai thuộc giai đoạn xác thực, không phải lỗi handler. `SessionInvalidError` và
      // `InvitationError` KHÔNG bao giờ tới đây từ giai đoạn 1 (đã bọc), nên nếu thấy chúng thì
      // đó là lỗi nghiệp vụ của handler và rơi vào bảng 422 ở dưới.
      if (err instanceof TenantError) return { status: 401, body: THAN_401 };
      if (err instanceof SessionInvalidError) return { status: 401, body: THAN_401 };
      if (err instanceof InvitationError) return { status: 422, body: { error: err.message } };
      return anhXaLoiHandler(err, requestId);
    }
  };
}
