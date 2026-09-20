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
 * [S1.91 / khoản 194 / ADR-046] Bộ báo cho NGƯỜI DUYỆT rằng có một yêu cầu mở thầu đang chờ họ.
 *
 * `token` có thể là `null`, và vế ấy là một hợp đồng chứ không phải một ca lỗi: mã đăng nhập đi qua
 * `issueLoginToken`, nên `LOGIN_MAX_TOKENS_PER_WINDOW` chặn được người nhận thứ sáu trong một cửa sổ
 * 15 phút. Khi ấy tin VẪN đi — chỉ không mang mã — vì *"có việc chờ anh"* là thông tin người duyệt
 * cần, còn mã đăng nhập thì họ tự xin được.
 */
export interface ApprovalNoticeSender {
  readonly name: string;
  send(input: {
    readonly orgId: string;
    readonly email: string;
    readonly rfqId: string;
    readonly unsealRequestId: string;
    readonly token: string | null;
  }): Promise<void>;
}

/**
 * [S1.91 / khoản 154] Bộ báo cho NHÀ CUNG CẤP rằng hạn nộp đã được gia hạn.
 *
 * Loại việc này được enqueue từ S1.81 và tới S1.90 KHÔNG tiến trình nào nhận — nó nằm `PENDING`
 * vĩnh viễn, và `packages/outbox/src/so-kind-mo-coi.ts` khai điều đó thành một dòng có số khoản.
 * Chặng gửi phải ở `apps/api`: vai `app_unseal` của worker không đọc được `supplier_contacts`
 * (ADR-006), nên worker không dựng nổi đích gửi dù có muốn.
 */
export interface DeadlineNoticeSender {
  readonly name: string;
  send(input: {
    readonly orgId: string;
    readonly invitationId: string;
    readonly channel: Channel;
    readonly destination: string;
    readonly newDeadlineAt: string;
  }): Promise<void>;
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
  readonly approvalNoticeSender: ApprovalNoticeSender;
  readonly deadlineNoticeSender: DeadlineNoticeSender;
  readonly totpSecretWrapper: TotpSecretWrapper;
  readonly totpSecretUnsealer: TotpSecretUnsealer;
}

export interface PublicContext {
  readonly req: ApiRequest;
}

/**
 * [review M-7] Việc có TÁC DỤNG PHỤ RA NGOÀI (gửi mail, SMS) không được chạy TRONG giao dịch: nó giữ
 * một kết nối pool suốt độ trễ của nhà cung cấp, và một lần gửi hỏng làm rollback cả bộ đếm hạn mức.
 * Handler xếp việc ấy vào đây; bộ điều phối chạy SAU khi giao dịch đã commit, và một lỗi ở đó không
 * đổi phản hồi (đã quyết) — chỉ được ghi tên ra log.
 * [S1.70 / lượt soi 64a-8] Việc ấy chạy khi kết nối của handler đã trả về pool: closure không được dùng `ctx.client`.
 */
export type AfterCommit = (viec: () => Promise<void>) => void;

/**
 * [S1.70 / khoản 124] Việc SAU COMMIT mà KẾT QUẢ quyết phản hồi — chỉ route NGƯỜI MUA có, và TỐI ĐA MỘT việc cho mỗi yêu cầu: đăng ký lần
 * hai ném `ViecCoBuThuHai` ngay trong handler, tức giao dịch rollback (lượt soi 64a-2). Bộ điều phối chạy `viec` khi giao dịch đã commit,
 * với cùng trần như `AfterCommit`, và TRƯỚC mọi việc sau commit thường. `viec` ném hay quá trần ⇒ MỘT dòng log `sau-commit`; `bu` chạy
 * trong một giao dịch MỚI đã gắn tổ chức, lần lấy kết nối có trần 5 s; rồi `phanHoiKhiHong` thay cho phản hồi của handler và việc sau
 * commit thường bị bỏ. `bu` cũng hỏng ⇒ `phanHoiKhiBuHong` — không khai thì `500` thân cố định — với một dòng log `bu-sau-commit` (lượt soi
 * 64a-1). Đường VÔ DANH không có kiểu này: ở đó một lần gửi hỏng không được đổi phản hồi (review M-1, H2-7).
 *
 * `viec` và `bu` chạy SAU khi `withTenant` của handler đã trả kết nối về pool: closure KHÔNG được dùng `ctx.client` — kết nối ấy đã rảnh,
 * hay đã ở trong giao dịch của một yêu cầu khác; `bu` dùng `client` được truyền vào (lượt soi 64a-8). Phần bù không đi qua cổng quyền lần
 * nữa: nó chạy dưới mã quyền route đã kiểm, nên chỉ được làm việc mà chính mã quyền ấy cho phép — không lớp nào canh điều này (64a-7).
 */
export interface ViecSauCommitCoBu {
  readonly viec: () => Promise<void>;
  readonly bu: (client: pg.PoolClient) => Promise<void>;
  readonly phanHoiKhiHong: ApiResponse;
  /** Phản hồi khi `bu` cũng hỏng. Không khai ⇒ `500` thân cố định của bộ điều phối. */
  readonly phanHoiKhiBuHong?: ApiResponse;
}

export type AfterCommitCoBu = (viec: ViecSauCommitCoBu) => void;

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
  readonly afterCommit: AfterCommit;
  /**
   * [sổ nợ 38] Handler vừa `enqueueJob` cho tổ chức này — dispatcher ĐÁNH THỨC runner outbox SAU
   * commit, KHÔNG await (await là đưa oracle thời gian trở lại dưới dạng khác). Không có runner
   * (test lắp tay) thì là no-op; test gọi `runOnceForOrg` tường minh.
   */
  readonly nudgeOutbox: () => void;
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
  readonly afterCommit: AfterCommit;
  /** [S1.70 / khoản 124] Việc sau commit mà kết quả quyết phản hồi — xem `ViecSauCommitCoBu`. */
  readonly afterCommitCoBu: AfterCommitCoBu;
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
  /**
   * [sổ nợ 39] Trần số lời gọi cho MỘT người gọi (địa chỉ, sau proxy đã khai — nợ 41) trên route
   * này trong một cửa sổ 15 phút (`OTP_RATE_WINDOW_SECONDS`). Dispatcher đếm trong một giao dịch
   * RIÊNG trước handler và trả 429 khi vượt — nên một token sai (handler rollback) vẫn bị đếm.
   * Không khai = không đếm theo người gọi (đường khách có bộ đếm riêng trong `issueOtpChallenge`).
   */
  readonly callerLimit?: number;
  /**
   * [sổ nợ 52] Trần cho CẢ TỔ CHỨC trên route này trong cùng cửa sổ — bucket `LOGIN_CALLER` với khoá
   * theo route, không theo địa chỉ. Bịt đường "xoay /64" của IPv6 mà không siết NAT: một tổ chức có
   * chừng ấy người, không ai cần hơn chừng ấy link mỗi 15 phút. Chỉ có nghĩa cùng `callerLimit`.
   * [review H5-1] Vượt ⇒ LÀM CHẬM (`treQuaTranMs`), KHÔNG 429: một trần chặn theo tổ chức là vũ khí
   * khoá cửa đăng nhập của cả tổ chức với giá một địa chỉ. Chỉ cộng khi người gọi chưa vượt trần riêng.
   */
  readonly orgLimit?: number;
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
  /**
   * [khoản 141 / ADR-039] Một phiên `AGENT_READONLY` gọi được route này hay không.
   *
   * BẮT BUỘC, và đó là cả điểm của nó: cùng khuôn `permission` trên `BuyerWriteRoute` — một route
   * đọc mới KHÔNG BIÊN DỊCH ĐƯỢC cho tới khi người viết nó QUYẾT. Bản đầu của vòng này định dùng
   * một danh sách đường cho phép; lượt soi bác đúng: một danh sách chuỗi mà không ai đối chiếu là
   * một cổng sẽ trôi, còn một trường bắt buộc thì không ai quên được.
   */
  readonly agent: boolean;
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
  /**
   * [khoản 141 / ADR-039 — lượt soi đối kháng Đ-1] BẮT BUỘC ở đây CŨNG vậy, và đây là chỗ bản đầu
   * của vòng này sai.
   *
   * Bản đầu chỉ đặt `agent` trên `BuyerReadRoute` và để vị từ trả `r.self === true` cho route tự
   * thân — tức MỌI `BuyerSelfRoute` tương lai được cấp quyền NGẦM. Kịch bản đo được: vòng sau thêm
   * `POST /auth/session/extend` (self, `/auth/*` hợp lệ) và nó gọi được ngay dưới phiên agent —
   * không tệp nào phải sửa, KHÔNG CỔNG NÀO ĐỎ. Route tự thân chạm chính chứng chỉ, nên đó đúng là
   * lớp route không được im lặng.
   */
  readonly agent: boolean;
  /**
   * [S1.78 / khoản 144 — ĐO] Ngưỡng `failed_attempts` của hồ sơ MFA mà route này **không được vượt
   * qua**: đủ ngưỡng thì route trả 429 và **không** thử mã, tức không làm bộ đếm tăng thêm.
   * **BẮT BUỘC khai**; `null` nghĩa là *route này không chạm hồ sơ MFA*, và chỗ khai phải nói vì
   * sao — cùng kỷ luật với `agent` ngay trên.
   *
   * **ĐÂY LÀ BẢN THAY của `sessionLimit`, và lý do là một phép đo.** S1.76 đặt một trần theo CỬA SỔ
   * (`sessionLimit: 3` trên bucket `caller_rate_limits`) với lời khai *"một cookie trộm được không
   * khoá được hồ sơ của chủ nhân nó"*. Lượt soi ngang 72 bác, và phép đo bác theo (§S1.78 mục 2):
   * bucket ấy là cửa sổ **NHẢY** làm tròn theo epoch — mọi bộ đếm về 0 cùng lúc, ở những mốc CÔNG
   * KHAI — còn `failed_attempts` thì **ĐƠN ĐIỆU**. Ba lần ở cửa sổ này cộng hai lần ở cửa sổ sau vẫn
   * đủ năm: đo được `401,401,401,401,401`, `failed_attempts` 3 → 5, hồ sơ KHOÁ, nạn nhân nhận
   * `LOCKED_OUT` trên đường đăng nhập thật với mã ĐÚNG.
   *
   * **VÌ SAO TRẦN NÀY ĐÚNG CHỖ:** nó đọc thẳng đại lượng cần bảo vệ, nên **không có ranh giới nào để
   * canh**. Một trần theo cửa sổ là một bộ đếm SONG SONG — nó đoán về `failed_attempts` qua một biến
   * khác, và mọi lời đoán như thế đều sai ở ranh giới.
   *
   * **RANH GIỚI, nói ra:** trần này chặn đúng MỘT tác hại — đẩy hồ sơ người khác tới ngưỡng khoá. Nó
   * **không** là một trần tần suất: route vẫn nhận bao nhiêu lời gọi cũng được, và câu hỏi trần tần
   * suất cho route người mua vẫn là khoản 144, còn mở.
   */
  readonly mfaTranDuongPhu: number | null;
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

/**
 * [khoản 141 / ADR-039] Một phiên `AGENT_READONLY` gọi được route này hay không.
 *
 * Vị từ THUẦN, và nó là nguồn DUY NHẤT của câu trả lời ấy: `dispatch.ts` gọi nó, và cổng đối chiếu
 * của `apps/mcp` cũng gọi nó. Hai bên đọc cùng một hàm nên không có cách nào lệch nhau.
 *
 * Route KHÔNG phải của người mua trả `false` mà không cần hỏi gì: nhánh `ANON`/`GUEST`/`PUBLIC` của
 * bộ điều phối không đọc cookie phiên người mua, nên một chứng chỉ agent không mua được gì ở đó
 * (đo: `dispatch.ts` nhánh ANON lấy tổ chức từ thân yêu cầu, không từ cookie).
 */
export function agentGoiDuoc(r: Route): boolean {
  if (r.audience !== "BUYER") return false;
  if (r.mutates === false) return r.agent === true;
  if (r.self === true) return r.agent === true;
  // Route GHI có mã quyền: không bao giờ, và không có trường nào để khai ngược lại.
  return false;
}

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
/**
 * [S1.21] Đường VÔ DANH được miễn trần theo người gọi ở tầng dispatcher — mỗi dòng một lý do ĐO
 * ĐƯỢC, không một dòng nào là "chưa làm".
 *
 * Danh sách này KHÔNG rỗng, và đó là khác biệt so với `MIEN_TRU` của ADR-027: ở đây miễn trừ nói
 * *"trần nằm ở chỗ khác"*, không nói *"chưa có trần"*. Một dòng mới chỉ được thêm khi đường dẫn
 * ấy có một bộ đếm THẬT ở tầng khác, và lời khai ấy phải chỉ được tới tận tên hằng số.
 */
export const MIEN_TRAN_NGUOI_GOI: Readonly<Record<string, string>> = {
  "/guest/otp":
    "trần nằm TRONG `issueOtpChallenge` (packages/invitation) và nó CHẶT HƠN một trần theo route: " +
    "`OTP_MAX_PER_CALLER` = 10, `OTP_MAX_PER_INVITATION` = 5 (bucket kẻ tấn công không xoay được), " +
    "`OTP_MAX_PER_DEST` = 3 và `OTP_MAX_PER_DEST_TOAN_TO_CHUC` = 20 — ADR-015 §5.",
};

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
    // [S1.21, review lượt 13 H13-1] MỘT ĐƯỜNG VÔ DANH PHẢI CÓ TRẦN THEO NGƯỜI GỌI.
    //
    // Vì sao ở đây chứ không ở một chú thích: trước vòng này, `callerLimit` của `/auth/totp` là
    // MỘT DÒNG CẤU HÌNH mà không lớp nào canh — xoá đúng dòng ấy thì vế *giới hạn tần suất* của
    // E3 biến mất khỏi đường TOTP và **không test nào đỏ**. Đó là "xanh giả" ở chiều ngược: hàng
    // rào có thật, nhưng không có gì giữ nó.
    if (r.audience === "ANON" && !(typeof r.callerLimit === "number" && r.callerLimit > 0)) {
      const lyDo = MIEN_TRAN_NGUOI_GOI[r.path];
      if (lyDo === undefined) {
        viPham.push(`${khoa}: route ANON không khai callerLimit và không có lý do miễn — E3 vế giới hạn tần suất`);
      }
    }
    if (r.audience !== "PUBLIC" && r.method === "GET" && r.mutates) {
      viPham.push(`${khoa}: GET không được đổi trạng thái`);
    }
    // ANON được POST mà không đổi trạng thái: token phải đi trong THÂN (E6), và GET không có thân.
    if (r.audience !== "PUBLIC" && r.audience !== "ANON" && r.method !== "GET" && !r.mutates) {
      viPham.push(`${khoa}: phương thức ghi mà khai mutates:false — hoặc sai phương thức, hoặc đang trốn cổng quyền`);
    }
    // [khoản 141 / ADR-039] Lời khai phạm vi phải CÓ MẶT ở đúng nơi nó có nghĩa, và VẮNG ở mọi nơi
    // khác. Kiểu đã ép chiều thứ nhất lúc biên dịch; hai vế dưới đây ép lại cho một bảng đến từ
    // JSON — và vế thứ hai là chiều mà lượt soi Đ-1 chỉ ra rằng bản đầu bỏ sót: một lời khai VẮNG
    // trên route tự thân đọc ra giống hệt một route chưa ai quyết.
    const canKhaiAgent =
      r.audience === "BUYER" && (r.mutates === false || (r.mutates === true && r.self === true));
    if (canKhaiAgent && typeof (r as { agent?: unknown }).agent !== "boolean") {
      viPham.push(`${khoa}: route ĐỌC hoặc TỰ THÂN của người mua KHÔNG khai \`agent\` [khoản 141]`);
    }
    if (!canKhaiAgent && "agent" in r) {
      viPham.push(`${khoa}: khai \`agent\` trên một route không phải route đọc/tự thân của người mua`);
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

/**
 * [S1.78 / khoản 144; S1.83 nới chỗ ở] Thân riêng cho trần TRẠNG THÁI: một 429 ở đây nói "hồ sơ
 * đang gần ngưỡng khoá", không nói "bạn gọi quá nhanh", và KHÔNG mang `Retry-After` — không có
 * cửa sổ nào để chờ hết.
 *
 * NÓ SỐNG Ở ĐÂY chứ không ở `dispatch.ts` vì từ S1.83 có HAI chỗ dựng phản hồi ấy: cổng đi trước
 * của bộ điều phối, và nhánh `SIDE_PATH_EXHAUSTED` trong chính handler — thứ mang THẨM QUYỀN.
 * `dispatch.ts` đã import `routes/auth.js`, nên chiều ngược lại là một VÒNG mà `pnpm t0` chặn;
 * `route-types.ts` là chỗ cả hai cùng nhìn thấy được.
 */
export const THAN_429_MFA = { error: "ho so MFA gan nguong khoa; dang nhap lai truoc" } as const;
