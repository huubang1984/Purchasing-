// ==============================================================================================
// apps/api/src/route-types.ts — HÌNH DẠNG của một route, và lớp canh thuần trên một bảng route.
//
// Tách khỏi `routes.ts` (nơi lắp `ROUTES`) để `routes/*.ts` import KIỂU từ đây mà không tạo vòng
// phụ thuộc (quy tắc `khong-phu-thuoc-vong` của depcruise đã bắt đúng vòng ấy ở lượt chạy đầu).
//
// Route là DỮ LIỆU: một mảng đọc được bằng `import { ROUTES }`, không cần khởi động máy chủ.
// Ba lớp canh "với MỌI route" đứng trên mảng này:
//   • [INV-H17] mọi route ĐỔI TRẠNG THÁI của người mua khai một mã quyền — và KIỂU đã ép điều đó
//     trước cả test: `BuyerWriteRoute` không có `permission` thì không biên dịch;
//   • [INV-E6] không mẫu đường dẫn nào chứa tham số mang tên credential;
//   • bộ quét rò rỉ (S1.10.6) gọi từng dòng của mảng này, không cần OpenAPI.
//
// Handler KHÔNG nhận pool, KHÔNG tự mở giao dịch, KHÔNG tự kiểm quyền: ba việc ấy là của
// `dispatch.ts`, và `routes/**` bị cấm chạm `pg`/`tenancy`/`node:http` (lớp canh `g9-`). Một
// handler quên gắn phiên khách là một handler KHÔNG VIẾT ĐƯỢC — đó là cách A5 §4 vế 1 đóng.
// ==============================================================================================

import type pg from "pg";
import type { Permission, SessionActor } from "@trustprocure/identity";
import type { ApiRequest, ApiResponse, HttpMethod } from "./http.js";

export type Audience = "PUBLIC" | "GUEST" | "BUYER";

export interface PublicContext {
  readonly req: ApiRequest;
}

/** Kết nối ĐÃ gắn tổ chức + phiên khách (`withGuestSession`). Cửa duy nhất vào CSDL của handler. */
export interface GuestContext {
  readonly req: ApiRequest;
  readonly orgId: string;
  readonly client: pg.PoolClient;
  readonly guestSessionId: string;
}

/** Kết nối ĐÃ gắn tổ chức (`withTenant`); `actor` dẫn xuất từ cookie, không từ thân yêu cầu. */
export interface BuyerContext {
  readonly req: ApiRequest;
  readonly orgId: string;
  readonly client: pg.PoolClient;
  readonly actor: SessionActor;
}

interface RouteBase {
  readonly method: HttpMethod;
  /** Mẫu đường dẫn, tham số dạng `:name`. */
  readonly path: string;
}

export interface PublicRoute extends RouteBase {
  readonly audience: "PUBLIC";
  readonly handler: (ctx: PublicContext) => Promise<ApiResponse>;
}

export interface GuestRoute extends RouteBase {
  readonly audience: "GUEST";
  /** Đường khách ghi (nộp báo giá) — tự chứng minh thẩm quyền bằng phiên khách, không có mã quyền. */
  readonly mutates: boolean;
  readonly handler: (ctx: GuestContext) => Promise<ApiResponse>;
}

export interface BuyerReadRoute extends RouteBase {
  readonly audience: "BUYER";
  readonly mutates: false;
  readonly handler: (ctx: BuyerContext) => Promise<ApiResponse>;
}

export interface BuyerWriteRoute extends RouteBase {
  readonly audience: "BUYER";
  readonly mutates: true;
  /** Mã quyền — bộ điều phối gọi `requirePermission` TRƯỚC handler. */
  readonly permission: Permission;
  /** Đi thẳng vào `resource_type` của sổ kiểm toán: MÃ ĐỊNH DANH viết hoa (xem `rbac.ts`). */
  readonly resourceType: string;
  /** Tài nguyên cụ thể nếu đường dẫn nêu tên nó — đọc từ `params`, không từ thân. */
  readonly resourceId?: (req: ApiRequest) => string | null;
  readonly handler: (ctx: BuyerContext) => Promise<ApiResponse>;
}

export type Route = PublicRoute | GuestRoute | BuyerReadRoute | BuyerWriteRoute;

// ----------------------------------------------------------------------------------------------
// LỚP CANH DƯỚI DẠNG HÀM THUẦN — để test đo được nó trên một bảng GIẢ, không chỉ trên `ROUTES`.
// Không có bước tách này, "một route thiếu quyền làm test đỏ" chỉ chứng minh được bằng cách sửa
// `ROUTES` thật rồi hoàn tác.
// ----------------------------------------------------------------------------------------------

/** Tên tham số đường dẫn KHÔNG BAO GIỜ được phép: chúng là credential (E6). */
export const TEN_THAM_SO_CAM = ["token", "otp", "code", "session", "secret", "password"] as const;

/**
 * Mọi vi phạm hình dạng của một bảng route. Rỗng là hợp lệ.
 *
 * Vị từ của ADR-016 mục 4 từng là *"module gọi hàm ghi thì phải nhắc tới `requirePermission`"*
 * và tự ghi ra rằng nó YẾU. Vị từ ở đây mạnh hơn ở đúng hai chỗ: ⑴ nó đọc CẤU TRÚC chứ không
 * đọc chuỗi, nên một `requirePermission` trong nhánh chết không lừa được nó; ⑵ mã quyền phải là
 * một `Permission` THẬT của danh mục — kiểu ép ở biên dịch, và hàm này ép lại lúc chạy cho một
 * bảng đến từ JSON.
 */
export function timViPhamBangRoute(routes: readonly Route[]): readonly string[] {
  const viPham: string[] = [];
  const daThay = new Set<string>();
  for (const r of routes) {
    const khoa = `${r.method} ${r.path}`;
    if (daThay.has(khoa)) viPham.push(`${khoa}: khai HAI LẦN`);
    daThay.add(khoa);

    if (!r.path.startsWith("/") || (r.path !== "/" && r.path.endsWith("/"))) {
      viPham.push(`${khoa}: mẫu đường dẫn sai hình dạng`);
    }
    for (const doan of r.path.slice(1).split("/")) {
      if (!doan.startsWith(":")) continue;
      const ten = doan.slice(1).toLowerCase();
      if ((TEN_THAM_SO_CAM as readonly string[]).some((cam) => ten.includes(cam))) {
        viPham.push(`${khoa}: tham số ":${doan.slice(1)}" mang tên credential — E6 cấm nó vào URL`);
      }
    }

    if (r.audience === "PUBLIC" && r.method !== "GET") {
      viPham.push(`${khoa}: route PUBLIC chỉ được là GET — không ai xác thực thì không ai được ghi`);
    }
    if (r.audience !== "PUBLIC" && r.method === "GET" && r.mutates) {
      viPham.push(`${khoa}: GET không được đổi trạng thái`);
    }
    if (r.audience !== "PUBLIC" && r.method !== "GET" && !r.mutates) {
      viPham.push(`${khoa}: phương thức ghi mà khai mutates:false — hoặc sai phương thức, hoặc đang trốn cổng quyền`);
    }
    if (r.audience === "BUYER" && r.mutates) {
      // Ép về `string`: kiểu nói `permission` là một `Permission`, nhưng một bảng đến từ JSON thì không.
      if (typeof r.permission !== "string" || (r.permission as string) === "") {
        viPham.push(`${khoa}: route ghi của người mua KHÔNG khai mã quyền [INV-H17]`);
      }
      if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(r.resourceType)) {
        viPham.push(`${khoa}: resourceType phải là MÃ ĐỊNH DANH viết hoa`);
      }
    }
  }
  return viPham;
}
