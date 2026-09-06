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
import type { ReceiptSigner } from "@trustprocure/bidding";
import type { KeyWrapper } from "@trustprocure/crypto-keys";
import type { Permission, SessionActor, TotpSecretUnsealer, WrappedTotpSecret } from "@trustprocure/identity";
import type { Channel, PepperRing } from "@trustprocure/invitation";
import type { ApiRequest, ApiResponse, HttpMethod } from "./http.js";

export type Audience = "PUBLIC" | "ANON" | "GUEST" | "BUYER";

/** Bộ gửi OTP — được TIÊM ở composition root (ADR-015 mục 3: người gọi issueOtpChallenge là handler gửi). */
export interface OtpSender {
  readonly name: string;
  send(input: { readonly channel: Channel; readonly destination: string; readonly code: string }): Promise<void>;
}

/** Bộ gửi link đăng nhập người mua — cùng khuôn `OtpSender`: token đi tới đây, không về client. */
export interface LoginLinkSender {
  readonly name: string;
  send(input: { readonly orgId: string; readonly email: string; readonly token: string }): Promise<void>;
}

/**
 * Bộ BỌC bí mật TOTP lúc ghi danh — cặp với `TotpSecretUnsealer` của identity. Cả hai là adapter
 * TIÊM vào: `apps/api` KHÔNG được import `@trustprocure/crypto-keys/unwrap` (họ `g1-`), nên adapter
 * thật là một lời gọi KMS trên một CMK RIÊNG cho TOTP — không phải CMK của khoá RFQ (ADR-006/009).
 */
export interface TotpSecretWrapper {
  readonly name: string;
  wrapTotpSecret(orgId: string, secret: Uint8Array): Promise<WrappedTotpSecret>;
}

/** Bộ gửi magic link mời thầu — đích ĐỌC TỪ `supplier_contacts`, token không về client. */
export interface InvitationLinkSender {
  readonly name: string;
  send(input: {
    readonly orgId: string;
    readonly invitationId: string;
    readonly channel: Channel;
    readonly destination: string;
    readonly token: string;
  }): Promise<void>;
}

/** Những thứ có KHOÁ hoặc có TÁC DỤNG PHỤ mà handler cần và không được tự tạo. */
export interface ApiServices {
  /** Bọc khoá riêng RFQ lúc `openRfq` (ADR-019) — cửa BỌC của crypto-keys; cửa MỞ thì apps/api không có. */
  readonly rfqKeyWrapper: KeyWrapper;
  readonly invitationLinkSender: InvitationLinkSender;
  readonly pepper: PepperRing;
  readonly otpSender: OtpSender;
  readonly receiptSigner: ReceiptSigner;
  readonly loginLinkSender: LoginLinkSender;
  readonly totpSecretWrapper: TotpSecretWrapper;
  readonly totpSecretUnsealer: TotpSecretUnsealer;
}

export interface PublicContext {
  readonly req: ApiRequest;
}

/**
 * Đường VÔ DANH có tổ chức: chưa có phiên, tự chứng minh bằng token trong THÂN yêu cầu (magic
 * link, OTP). `orgId` đọc từ thân, được kiểm hình dạng UUID rồi gắn bằng `withTenant` — nó không
 * phải bí mật, chỉ là toạ độ. Chỉ có ở `/guest/*` và `/auth/*` (lớp canh ở dưới).
 */
export interface AnonContext {
  readonly req: ApiRequest;
  readonly orgId: string;
  readonly client: pg.PoolClient;
  readonly services: ApiServices;
}

/**
 * Cửa duy nhất vào CSDL của handler khách. Route ĐỌC: `client` đã gắn phiên khách (`withGuestSession`,
 * ba GUC, policy 027/028 lọc theo lời mời). Route GHI (`mutates: true`): `client` chỉ gắn tổ chức —
 * lý do đo được ở `dispatch.ts` khối [S1.10.3]; handler ghi vì thế KHÔNG được viết SQL tay, chỉ gọi
 * hàm gói nhận `guestSessionId` (mọi thứ khác dẫn xuất ở CSDL).
 */
export interface GuestContext {
  readonly req: ApiRequest;
  readonly orgId: string;
  readonly client: pg.PoolClient;
  readonly guestSessionId: string;
  /** DẪN XUẤT từ hàng phiên bởi `withGuestSession` — không đọc từ thân, không đọc từ đường dẫn. */
  readonly invitationId: string;
  readonly rfqId: string;
  readonly services: ApiServices;
}

/** Kết nối ĐÃ gắn tổ chức (`withTenant`); `actor` dẫn xuất từ cookie, không từ thân yêu cầu. */
export interface BuyerContext {
  readonly req: ApiRequest;
  readonly orgId: string;
  readonly client: pg.PoolClient;
  readonly actor: SessionActor;
  /**
   * Pool ĐỘC LẬP cho sổ kiểm toán — hợp đồng của `requirePermission`/`requestUnseal`/… (D5: một lần
   * từ chối phải sống qua rollback của người gọi). Chỉ route NGƯỜI MUA có nó; route khách cố ý
   * KHÔNG — handler khách không được cầm một pool nào (A5 §4).
   */
  readonly auditPool: pg.Pool;
  readonly services: ApiServices;
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

export interface AnonRoute extends RouteBase {
  readonly audience: "ANON";
  readonly mutates: boolean;
  readonly handler: (ctx: AnonContext) => Promise<ApiResponse>;
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

/**
 * Route ghi TỰ THÂN của người mua: đổi trạng thái của CHÍNH phiên đang gọi (đăng xuất), không chạm
 * dữ liệu nghiệp vụ, nên không có mã quyền nào mô tả nó. Chỉ được ở `/auth/*` — lớp canh ở dưới.
 */
export interface BuyerSelfRoute extends RouteBase {
  readonly audience: "BUYER";
  readonly mutates: true;
  readonly self: true;
  readonly handler: (ctx: BuyerContext) => Promise<ApiResponse>;
}

export interface BuyerWriteRoute extends RouteBase {
  readonly audience: "BUYER";
  readonly mutates: true;
  readonly self?: false;
  /** Mã quyền — bộ điều phối gọi `requirePermission` TRƯỚC handler. */
  readonly permission: Permission;
  /** Đi thẳng vào `resource_type` của sổ kiểm toán: MÃ ĐỊNH DANH viết hoa (xem `rbac.ts`). */
  readonly resourceType: string;
  /** Tài nguyên cụ thể nếu đường dẫn nêu tên nó — đọc từ `params`, không từ thân. */
  readonly resourceId?: (req: ApiRequest) => string | null;
  readonly handler: (ctx: BuyerContext) => Promise<ApiResponse>;
}

export type Route = PublicRoute | AnonRoute | GuestRoute | BuyerReadRoute | BuyerSelfRoute | BuyerWriteRoute;

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
    // Đường VÔ DANH là bề mặt tấn công rộng nhất của api: không cookie, không phiên. Nó chỉ được
    // tồn tại ở hai tiền tố có lý do (magic link + OTP của khách; đăng nhập người mua), và chỉ
    // bằng POST — một GET vô danh đổi trạng thái là một link bấm-là-chết.
    if (r.audience === "ANON" && !(r.path.startsWith("/guest/") || r.path.startsWith("/auth/"))) {
      viPham.push(`${khoa}: route ANON ngoài /guest/* và /auth/* — đường vô danh không được mọc ở chỗ khác`);
    }
    if (r.audience === "ANON" && r.method !== "POST") {
      viPham.push(`${khoa}: route ANON chỉ được là POST — token đi trong THÂN, không trong URL (E6)`);
    }
    if (r.audience !== "PUBLIC" && r.method === "GET" && r.mutates) {
      viPham.push(`${khoa}: GET không được đổi trạng thái`);
    }
    // ANON được POST mà không đổi trạng thái: token phải đi trong THÂN (E6), và GET không có thân.
    if (r.audience !== "PUBLIC" && r.audience !== "ANON" && r.method !== "GET" && !r.mutates) {
      viPham.push(`${khoa}: phương thức ghi mà khai mutates:false — hoặc sai phương thức, hoặc đang trốn cổng quyền`);
    }
    if (r.audience === "BUYER" && r.mutates && r.self === true) {
      if (!r.path.startsWith("/auth/")) {
        viPham.push(`${khoa}: route TỰ THÂN (self) ngoài /auth/* — một route ghi không có mã quyền chỉ được là đăng xuất`);
      }
    } else if (r.audience === "BUYER" && r.mutates) {
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
