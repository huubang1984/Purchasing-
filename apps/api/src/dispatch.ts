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
//   GUEST   cookie `__Host-tp_guest=<orgId>.<token>` → `resolveGuestSessionByToken` (một giao dịch) →
//           route ĐỌC: `withGuestSession` (giao dịch thứ hai, đặt ba GUC) → handler;
//           route GHI: `withTenant` (KHÔNG GUC) → handler. Vì sao rẽ nhánh — xem khối dưới.
//   BUYER   cookie `__Host-tp_session=<orgId>.<token>` → `resolveSessionByToken` → nếu route ghi thì
//           `requirePermission` → handler. Tất cả trong MỘT `withTenant` — [S1.70 / khoản 124, lượt soi 64a-4] trừ phần bù của một việc
//           sau commit có bù, chạy trong một `withTenant` MỚI sau commit.
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
// Giai đoạn 1 (xác thực): ~~mọi lỗi~~ [S1.66] lỗi XÁC THỰC ⇒ 401 với CÙNG MỘT thân, bất kể là thiếu cookie, sai hình dạng,
// token không khớp, phiên hết hạn, hay tổ chức không tồn tại. Phân biệt chúng là một oracle trên
// tập phiên — cùng lý do `resolveSessionActor` và `docToken` ném một thông điệp cho bốn ca.
// [S1.66 / lượt soi ngang 59b-1, lượt soi 60a-1, 60a-2] ~~Chưa trọn. Nhánh khách chỉ gói lỗi xác thực, và lỗi giao thức MANG TÊN
// (`TenantError` loại protocol, `KetNoiNhiemError`) đi 500 có log; nhưng nhánh người mua còn gói MỌI lỗi của `resolveSessionByToken`
// thành 401, và lỗi Postgres của lần lấy client rơi vào bảng ánh xạ của giai đoạn 2.~~ Đo trên bản trước S1.67: vai đăng nhập mất membership app_api ⇒ 403
// không log ở cả hai nhánh; EXECUTE trên app_current_org_id() bị thu hồi ⇒ người mua 401, khách 403, không log — khoản 118.
// [S1.67 / khoản 118] Lỗi phân loại theo NGUỒN, không theo tên — trước vòng này mọi lỗi không mang tên riêng rơi vào bảng của giai
// đoạn 2, dù nó đến từ handler hay từ lần lấy client. Bốn nguồn:
//   ⑴ xác thực — chỉ lỗi xác thực CÓ TÊN thành 401: `SessionInvalidError` (người mua), `InvitationError` (khách), `TenantError` loại
//     input; mọi lỗi khác của câu xác thực — lỗi Postgres, phép từ chối gắn tổ chức của `assertTenantBound` — thuộc ⑷;
//   ⑵ phân quyền — `PermissionDeniedError` của `requirePermission` ⇒ 403; lỗi khác của nó thuộc ⑷;
//   ⑶ handler — lỗi mà `route.handler` ném (mang dấu `LoiHandler`), cộng lỗi LỚP 23 ném ở câu kết thúc của giao dịch SAU khi handler
//     đã trả về: ràng buộc hoãn tới COMMIT là việc ghi của handler. Chỉ nguồn này đi qua bảng của giai đoạn 2;
//   ⑷ khung — lần lấy client, câu riêng của withTenant/withGuestSession, bộ đếm hạn mức, và mọi lỗi ngoài lớp 23 của câu kết thúc —
//     kể cả khi handler gây ra nó (handler nuốt một câu lỗi ⇒ TRANSACTION_ABORTED, hàm handler gọi đặt replica ⇒ REPLICA_AT_COMMIT;
//     lượt soi 61a-10), nên đúng hơn là "không qua bảng": 500 thân cố định với MỘT dòng log mang tên lỗi và mã cố định; `HttpError` do
//     chính bộ điều phối ném (thiếu `orgId`, tham số đường dẫn sai hình dạng) giữ mã của nó.
// Đo: `loi-giao-thuc.int.test.ts` describe [S1.67 / khoản 118].
// Giai đoạn 2 (handler): `PermissionDeniedError` ⇒ 403; `HttpError` ⇒ mã của nó; lỗi nghiệp vụ
// có tên (`SupplierError`, `RfqError`, …) ⇒ 422 kèm thông điệp — các lớp ấy đã chịu kỷ luật
// "không nội suy dữ liệu vào message"; MỌI lỗi khác ⇒ 500 với thân cố định, và ~~chỉ TÊN lỗi~~ [S1.68 / lượt soi 62b-4] TÊN lỗi — [S1.66]
// cùng MÃ cố định của `TenantError` — được
// ghi ra `console.error` — không stack có payload, không thân yêu cầu (A2). [S1.67 / khoản 118] Mã cố định gồm cả SQLSTATE của lỗi
// Postgres (`moTaLoiKhongGiaTri`); `SessionInvalidError` do handler ném (một gói gọi `resolveSessionActor` giữa chừng) ⇒ 401.
// [S1.68 / khoản 119] Lỗi không có trường `code` mà `cause` là Error — hôm nay chủ yếu hai lớp bọc của lần ghi sổ từ chối — được nêu
// thêm tên và mã của MỘT tầng cause.
// [S1.67 / lượt soi 61a-1] 42501 của PostgreSQL vẫn ⇒ 403, nhưng kèm MỘT dòng log: mã ấy vừa là câu trả lời nghiệp vụ (trigger D2, bảng
// chỉ-ghi-thêm) vừa là GRANT hay EXECUTE bị thu hồi mà chỉ câu của handler chạm ~~— kể cả lần ghi sổ từ chối qua `auditPool` lồng trong
// handler (khoản 119) —~~ và mã không phân biệt được hai ca. [S1.68 / khoản 119, lượt soi 62a-4] Lần ghi sổ từ chối lồng trong handler
// nay bọc lỗi của nó thành `DenialAuditFailedError` ⇒ 500 với dòng `DenialAuditFailedError <- error 42501`, không còn là một 403.
// [S1.70 / khoản 124, lượt soi 64a-4] Một pha nữa, SAU commit: việc sau commit có bù của route người mua. Nó hỏng hay quá trần ⇒ dòng
// `sau-commit`, phần bù, rồi `phanHoiKhiHong` của route (link mời: 502); phần bù cũng hỏng ⇒ dòng `bu-sau-commit` và `phanHoiKhiBuHong`
// (link mời: 500 kèm `invitationId`). Không lỗi nào của pha này đi qua bảng của giai đoạn 2.
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
import { OTP_RATE_WINDOW_SECONDS, tangBucketNguoiGoi } from "@trustprocure/invitation";
import { TenantError, withGuestSession, withTenant } from "@trustprocure/tenancy";
import { HttpError, type ApiRequest, type ApiResponse } from "./http.js";
import { coHan } from "./co-han.js";
import { diaChiPhanGiaiDuoc, khoaNguoiGoi } from "./dia-chi.js";
import { moTaLoiKhongGiaTri } from "./mo-ta-loi.js";
import { ghepDuongDan, tachCookiePhien, tachDoan } from "./router.js";
import type { ApiServices, Route, ViecSauCommitCoBu } from "./route-types.js";
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
  /**
   * [review H5-1] Vượt trần TOÀN TỔ CHỨC (`orgLimit`) thì LÀM CHẬM chừng này ms rồi vẫn xử lý — không
   * 429. Mặc định `TRE_QUA_TRAN_TO_CHUC_MS`; test tiêm số nhỏ để đo. Xem chú thích ở nhánh ANON.
   */
  readonly treQuaTranMs?: number;
  /**
   * [review H2-7] Trần thời gian cho MỖI việc sau commit (gửi mail/SMS). Việc ấy chạy TRƯỚC khi
   * phản hồi được ghi, và `requestTimeout` của máy chủ không phủ pha này — một bộ gửi treo làm
   * `/auth/link` treo cho email CÓ THẬT và về ngay cho email lạ (oracle M-1 ở dạng vô hạn).
   * Mặc định 5 000 ms; quá trần ~~chỉ ghi TÊN lỗi, không đổi phản hồi~~ [S1.70 / khoản 124, lượt soi 64a-4] với việc THƯỜNG chỉ ghi
   * TÊN lỗi, không đổi phản hồi; với việc CÓ BÙ thì bù và phản hồi đổi thành `phanHoiKhiHong` — link mời: lời mời bị thu hồi, `502`.
   * [64a-6] Một trần, hai hợp đồng: cận của oracle thời gian trên đường vô danh (OTP, H2-7), và ngưỡng mà quá nó một lần gửi link mời
   * bị tính là hỏng. Hạ trần để siết oracle thì bộ gửi chậm hơn trần làm mọi lần mời thành `502` và để lại một link chết mỗi lần gọi lại;
   * nâng trần để chịu bộ gửi chậm thì nới cận H2-7. [S1.12 / lượt soi 64b-6] Ví dụ `/auth/link` ở trên thuộc về trước S1.12 — nay route
   * ấy chỉ đặt job outbox; việc sau commit thường còn lại trên đường vô danh là gửi OTP (`routes/anon.ts`).
   */
  readonly afterCommitTimeoutMs?: number;
  /**
   * [sổ nợ 38] Đánh thức runner outbox của tiến trình cho một tổ chức vừa có job — gọi SAU commit,
   * đồng bộ (bên nhận tự lên lịch, không được chặn phản hồi). Composition root cài; test lắp tay
   * bỏ trống và tự chạy `runOnceForOrg`.
   */
  readonly outboxNudge?: (orgId: string) => void;
}

const AFTER_COMMIT_TIMEOUT_MS_MAC_DINH = 5000;
/**
 * [S1.70 / khoản 124, lượt soi 64a-3] Trần chờ lấy kết nối của phần bù (`ViecSauCommitCoBu.bu`). Không trần thì pool đầy làm phần bù chờ
 * `connectionTimeoutMillis` 20 s của `createPool` rồi nhận một `Error` không tên — đo trên bản đầu: 500 sau 20 004 ms, dòng
 * `bu-sau-commit Error`. Có trần thì gãy sau 5 s với `TenantError` CONNECT_WAIT_EXCEEDED, cùng con số với lần ghi sổ từ chối (khoản 120).
 * Cái giá: dưới pool đầy, phần bù hỏng sớm hơn — và bù hỏng thì phản hồi mang `invitationId` để người mua tự thu hồi (64a-1).
 */
const TRAN_CHO_KET_NOI_BU_MS = 5_000;

export type Dispatcher = (req: Omit<ApiRequest, "params" | "requestId">) => Promise<ApiResponse>;

/** Tên các lớp lỗi nghiệp vụ được phép đi ra ngoài dưới 422. Danh sách ĐÓNG, có chủ đích. */
const LOI_NGHIEP_VU_422: ReadonlySet<string> = new Set([
  "SupplierError",
  "RfqError",
  "InvitationError",
  // [S1.10.4] token đăng nhập hỏng/hết hạn/đã dùng — cùng lớp với InvitationError của khách.
  "LoginTokenError",
  // [040] yêu cầu đặt lại TOTP không ở PENDING / hết hạn / lý do rỗng — lỗi nghiệp vụ, không nội suy dữ liệu.
  "MfaResetError",
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
const THAN_429 = { error: "qua nhieu yeu cau" } as const;
/** [review H5-1] Độ trễ khi một tổ chức vượt `orgLimit` — làm chậm, không khoá. */
export const TRE_QUA_TRAN_TO_CHUC_MS = 2000;
/** Thân 503 cho ca KHÔNG đọc được địa chỉ người gọi (review H6-1). Không nêu lý do chi tiết. */
const THAN_503 = { error: "khong phuc vu duoc" } as const;
/**
 * [review H6-1] Bội số giữa trần TOÀN CỤC của một địa chỉ và trần theo (địa chỉ, tổ chức). Mười
 * nghĩa là: một địa chỉ phục vụ được mười tổ chức ở mức trần trước khi chạm trần toàn cục — đủ rộng
 * cho một máy khách hợp lệ (một văn phòng dịch vụ làm việc với nhiều bên mua), đủ hẹp để kẻ xoay
 * `orgId` lạ không có ngân sách vô hạn.
 */
export const BOI_TRAN_DIA_CHI = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Lỗi ném ra từ giai đoạn xác thực — bọc để ánh xạ thành 401 mà không mất nguyên nhân. */
class LoiXacThuc extends Error {
  constructor(options?: { cause?: unknown }) {
    super("xac thuc that bai", options);
    this.name = "LoiXacThuc";
  }
}

/**
 * [S1.67 / khoản 118] Lỗi mà HANDLER gây ra — bọc để bảng ánh xạ của giai đoạn 2 chỉ nhận lỗi của handler. Trước vòng này khối catch
 * phân loại theo TÊN, nên một lỗi Postgres của lần lấy client (42501 ở `SET ROLE`) và một lỗi Postgres của handler (42501 do trigger
 * D2 hay GRANT thiếu) là cùng một thứ: 403 không log.
 */
class LoiHandler extends Error {
  constructor(cause: unknown) {
    super("handler that bai", { cause });
    this.name = "LoiHandler";
  }
}

/** Lỗi Postgres lớp 23 (toàn vẹn). Ở câu kết thúc của giao dịch, đó là phép kiểm của một ràng buộc HOÃN tới COMMIT. */
function laLoiToanVen(loi: unknown): boolean {
  if (!(loi instanceof Error) || loi.name !== "error") return false;
  const ma = (loi as { code?: unknown }).code;
  return typeof ma === "string" && ma.startsWith("23");
}

interface NguonHandler {
  /** Chạy handler; lỗi nó ném mang dấu `LoiHandler`. */
  chay<T>(viec: () => Promise<T>): Promise<T>;
  /**
   * Đợi giao dịch chứa handler. Lỗi mà withTenant/withGuestSession ném SAU khi handler đã trả về đến từ câu kết thúc: lớp 23 là ràng
   * buộc hoãn — việc ghi của handler — nên mang dấu `LoiHandler`; mọi lỗi khác ở đó (khối DO của khoản 96, phép kiểm command tag,
   * kết nối đứt) không qua bảng — kể cả khi chính handler gây ra nó (lượt soi 61a-10).
   */
  giaoDich<T>(p: Promise<T>): Promise<T>;
}

/** Một bộ theo dõi cho MỘT lần gọi handler: `chay` bọc handler, `giaoDich` bọc giao dịch chứa nó. */
function nguonHandler(): NguonHandler {
  let daTraVe = false;
  async function chay<T>(viec: () => Promise<T>): Promise<T> {
    try {
      const ketQua = await viec();
      daTraVe = true;
      return ketQua;
    } catch (loi) {
      throw new LoiHandler(loi);
    }
  }
  async function giaoDich<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (loi) {
      if (daTraVe && laLoiToanVen(loi)) throw new LoiHandler(loi);
      throw loi;
    }
  }
  return { chay, giaoDich };
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
 *
 * [review H2-8] Hai chỗ hẹp thêm: ⑴ 23514 cũng là mã của một `CHECK` THƯỜNG, và thông điệp ấy do
 * Postgres viết (`new row for relation "…" violates check constraint "…"` — tên bảng, tên ràng
 * buộc). Chỉ lộ thông điệp khi lỗi đến từ `RAISE` của trigger — Postgres ghi `routine =
 * exec_stmt_raise` cho đúng ca ấy. ⑵ Lớp 22 (dữ liệu sai kiểu: `22P02` UUID sai dạng, `22003` số
 * tràn) là lỗi ĐẦU VÀO của người gọi, không phải sự cố: 422 với thân cố định, không vào log.
 */
function anhXaLoiPostgres(err: Error & { code?: unknown; routine?: unknown }): ApiResponse | null {
  const code = typeof err.code === "string" ? err.code : "";
  if (code === "23514") {
    return err.routine === "exec_stmt_raise"
      ? { status: 422, body: { error: err.message } }
      : { status: 422, body: { error: "du lieu vi pham rang buoc" } };
  }
  if (code === "23505") return { status: 409, body: { error: "xung dot du lieu" } };
  if (code === "23503") return { status: 422, body: { error: "tham chieu khong hop le" } };
  if (code.startsWith("22")) return { status: 422, body: { error: "du lieu sai kieu" } };
  if (code === "42501") return { status: 403, body: THAN_403 };
  return null;
}

function anhXaLoiHandler(err: unknown, requestId: string): ApiResponse {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  if (err instanceof PermissionDeniedError) return { status: 403, body: THAN_403 };
  if (err instanceof MfaRequiredError) return { status: 401, body: THAN_401 };
  // [S1.67 / khoản 118] Trước vòng này khối catch ngoài cùng trả 401 cho MỌI `SessionInvalidError`. Nay nhánh người mua bọc lỗi của
  // chính nó thành `LoiXacThuc`, nên tới đây chỉ còn `SessionInvalidError` do handler ném — một gói gọi `resolveSessionActor` khi phiên
  // vừa bị thu hồi hay người dùng vừa bị đình chỉ — và hợp đồng của ca ấy giữ nguyên.
  if (err instanceof SessionInvalidError) return { status: 401, body: THAN_401 };
  if (err instanceof Error && LOI_NGHIEP_VU_422.has(err.name)) {
    return { status: 422, body: { error: err.message } };
  }
  if (err instanceof Error && err.name === "error" && "code" in err) {
    // [S1.67 / lượt soi 61a-1] 42501 ⇒ 403 như cũ, kèm MỘT dòng log mang tên và mã — xem khối đầu tệp. Lớp 22 và 23 không ghi: người
    // gọi gây ra được.
    if (err.code === "42501") console.error(`[api] ${requestId} ${moTaLoiKhongGiaTri(err)}`);
    const pg = anhXaLoiPostgres(err);
    if (pg !== null) return pg;
  }
  return loiNoiBo(err, requestId);
}

/** 500 thân cố định với MỘT dòng log — đích chung của lỗi handler ngoài bảng và của mọi lỗi thuộc KHUNG. */
function loiNoiBo(err: unknown, requestId: string): ApiResponse {
  // ~~Chỉ TÊN lỗi và mã yêu cầu.~~ [S1.68 / lượt soi 62b-4] TÊN lỗi, mã cố định và mã yêu cầu — cộng tên và mã của MỘT tầng `cause` cho lỗi
  // không có trường `code` (hôm nay chủ yếu hai lớp bọc của lần ghi sổ từ chối), xem `moTaLoiKhongGiaTri`. Không `err` nguyên, không
  // ~~`cause`~~ `cause` nguyên: `cause` của một lỗi Postgres mang câu lệnh và tham số, tức có thể mang một phong bì hay một mã OTP (A2).
  // [S1.66 / lượt soi ngang 59b-1] Và MÃ cố định của một TenantError giao thức: tên lỗi một mình không phân biệt được mặc định phiên
  // gắn sẵn với rò phạm vi phiên hay replica lúc COMMIT. Mã là hằng của `@trustprocure/tenancy`, không mang giá trị nào.
  // [S1.67 / khoản 118] Và SQLSTATE của một lỗi Postgres: tên `error` một mình không phân biệt được 42501 ở `SET ROLE` với 08006 kết
  // nối đứt hay 57014 câu bị huỷ. Cả hai loại mã đi qua `moTaLoiKhongGiaTri` — một hàm cho mọi chỗ ghi log lỗi của bộ điều phối và
  // composition root (`main.ts` in thông điệp của lỗi cấu hình và khởi động — có chủ đích; lượt soi 61a-2).
  console.error(`[api] ${requestId} ${moTaLoiKhongGiaTri(err)}`);
  return { status: 500, body: THAN_500 };
}

/** `orgId` của một yêu cầu vô danh: trong THÂN, đúng hình dạng UUID — hoặc không có gì để gắn. */
function orgIdTuThan(body: unknown): string | null {
  const v = (body as Record<string, unknown> | null | undefined)?.orgId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const routes = deps.routes ?? ROUTES;
  const treQuaTranMs = deps.treQuaTranMs ?? TRE_QUA_TRAN_TO_CHUC_MS;

  return async (vao) => {
    const requestId = randomUUID();
    const tim = timRoute(routes, vao.method, vao.path);
    if (!("route" in tim)) return tim;
    const req: ApiRequest = { ...vao, params: tim.params, requestId };
    const route = tim.route;
    // [review M-7] Việc SAU COMMIT: chạy khi giao dịch đã đóng và phản hồi đã quyết. Một lỗi ở đây
    // ~~chỉ được ghi TÊN~~ [S1.67 / lượt soi 61a-2, 61b-8] chỉ được ghi TÊN cùng mã cố định — không đổi mã trạng thái, không mang nội
    // dung (A2). [S1.70 / khoản 124] Hai câu ấy nói về việc THƯỜNG; việc CÓ BÙ của route người mua đổi được phản hồi — xem dưới.
    const sauCommit: (() => Promise<void>)[] = [];
    const afterCommit = (viec: () => Promise<void>): void => {
      sauCommit.push(viec);
    };
    // [S1.70 / khoản 124] Việc sau commit CÓ BÙ (`ViecSauCommitCoBu`) — chỉ nhánh BUYER giao hàm này cho handler; nhánh ANON không có nó,
    // nên ở đó không bao giờ có việc có bù: một lần gửi OTP hỏng vẫn không đổi được phản hồi (review M-1, H2-7). Tối đa MỘT việc cho mỗi yêu
    // cầu (lượt soi 64a-2): lần đăng ký thứ hai ném ngay trong handler, giao dịch rollback — thay vì trả `phanHoiKhiHong` của việc đầu trong
    // khi việc sau đã commit mà không ai bù.
    let viecCoBu: ViecSauCommitCoBu | undefined;
    const afterCommitCoBu = (viec: ViecSauCommitCoBu): void => {
      if (viecCoBu !== undefined) throw Object.assign(new Error("mot yeu cau chi dang ky duoc mot viec sau commit co bu"), { name: "ViecCoBuThuHai" });
      viecCoBu = viec;
    };
    const tranSauCommitMs = deps.afterCommitTimeoutMs ?? AFTER_COMMIT_TIMEOUT_MS_MAC_DINH;
    const chaySauCommit = async (r: ApiResponse, orgId: string): Promise<ApiResponse> => {
      // [review H2-7] Chỉ chạy khi phản hồi là thành công: một handler xếp việc rồi trả 4xx (sau
      // này) không được gửi gì đi. Và mỗi việc có TRẦN thời gian — xem `afterCommitTimeoutMs`.
      if (r.status >= 400) return r;
      // [S1.70 / khoản 124] Việc có bù chạy TRƯỚC việc thường — kết quả của nó có thể thay phản hồi, và một việc thường không được chạy cho
      // một phản hồi sắp bị thay. Việc có bù hỏng hay quá trần ⇒ một dòng `sau-commit`, bù trong giao dịch MỚI của cùng tổ chức (lần lấy kết
      // nối có trần `TRAN_CHO_KET_NOI_BU_MS`), rồi `phanHoiKhiHong`; việc thường bị bỏ. Bù cũng hỏng ⇒ `phanHoiKhiBuHong` — mặc định 500 thân
      // cố định — với một dòng `bu-sau-commit`.
      const v = viecCoBu;
      if (v !== undefined) {
        try {
          await coHan(v.viec, tranSauCommitMs, "SauCommitQuaHan");
        } catch (e) {
          console.error(`[api] ${requestId} sau-commit ${moTaLoiKhongGiaTri(e)}`);
          try {
            await withTenant(deps.pool, orgId, v.bu, { maxConnectWaitMs: TRAN_CHO_KET_NOI_BU_MS });
          } catch (loiBu) {
            console.error(`[api] ${requestId} bu-sau-commit ${moTaLoiKhongGiaTri(loiBu)}`);
            return v.phanHoiKhiBuHong ?? { status: 500, body: THAN_500 };
          }
          return v.phanHoiKhiHong;
        }
      }
      for (const viec of sauCommit) {
        try {
          await coHan(viec, tranSauCommitMs, "SauCommitQuaHan");
        } catch (e) {
          console.error(`[api] ${requestId} sau-commit ${moTaLoiKhongGiaTri(e)}`);
        }
      }
      return r;
    };

    try {
      switch (route.audience) {
        case "PUBLIC":
          return await nguonHandler().chay(() => route.handler({ req }));

        case "ANON": {
          const orgId = orgIdTuThan(req.body);
          if (orgId === null) throw new HttpError(422, 'thiếu trường "orgId"');
          // [sổ nợ 39] Đếm theo NGƯỜI GỌI trong một giao dịch RIÊNG, TRƯỚC handler: giao dịch của
          // handler rollback khi token sai, nên đếm bên trong nó là đếm thành công chứ không đếm thử.
          // Khoá mang cả đường dẫn route: ba route, ba bộ đếm. Địa chỉ rỗng (không xác định) dùng
          // chung MỘT bucket — fail-closed. [review H4-4] Địa chỉ đi qua `khoaNguoiGoi`: IPv6 đếm theo
          // /64, không theo địa chỉ nguyên vẹn. ~~Tổ chức không tồn tại (khoá ngoại 23503) thì không đếm
          // và đi tiếp: handler vẫn trả cùng một thân cho mọi tổ chức, không mở oracle mới~~
          // [review H4-5] ~~— nhưng 429 CÓ là một oracle: tổ chức thật bị chặn sau N lần, tổ chức lạ
          // thì không. Chấp nhận, nói ra: `orgId` là UUIDv4, không liệt kê được bằng vét cạn, và
          // đếm cả tổ chức lạ đòi một bucket ngoài CSDL (không khoá ngoại) — ghi sổ nợ 52.~~
          // ~~[sổ nợ 52] Tổ chức không tồn tại (23503) được đếm ở bucket TRONG BỘ NHỚ theo `route|người
          // gọi`, CÙNG trần: tổ chức thật hay lạ đều 429 ở lần N+1 — oracle H4-5 đóng [review H5-3]
          // — oracle H4-5 vẫn CÒN, chỉ đổi dạng: hai bộ đếm rời (bộ nhớ cho lạ, CSDL cho thật) nên
          // kẻ dò mồi N lần vào một UUID giả rồi gửi UUID ứng viên là phân biệt được bằng MỘT lời gọi.
          // Chấp nhận với cùng lý do H4-5 (`orgId` UUIDv4 không vét cạn được); đóng thật cần một bảng
          // bucket không khoá ngoại tới `organizations` — sổ nợ 55.~~
          // [sổ nợ 55 / migration 042] Bucket người gọi nay ở `caller_rate_limits`: KHÔNG `org_id`,
          // KHÔNG khoá ngoại — tổ chức thật và tổ chức lạ tăng CÙNG MỘT HÀNG, nên không còn gì để
          // phân biệt hai ca. Bucket bộ nhớ của nợ 52 bị XOÁ cùng lúc: nó tồn tại chỉ vì bảng cũ từ
          // chối tổ chức lạ.
          //
          // [review H6-1, H6-2] BA bộ đếm, và cả ba ở CÙNG bảng không khoá ngoại — đó là điều làm
          // cho tổ chức thật và tổ chức lạ đi qua ĐÚNG cùng một đường, kể cả nhánh làm chậm:
          //   ⑴ `route|ip`         — trần TOÀN CỤC cho một địa chỉ (`callerLimit × BOI_TRAN_DIA_CHI`).
          //      Nó bịt đường xoay `orgId` LẠ để làm mới bộ đếm ⑵, và chỉ nó mới bị chạm bởi kẻ xoay.
          //   ⑵ `route|ip|org`     — trần THẬT theo người gọi (`callerLimit`). Có `orgId` trong KHOÁ
          //      nhưng KHÔNG có khoá ngoại, nên nó không phải oracle; và nó trả lại bán kính nổ mà
          //      bản chỉ-toàn-cục đã đánh mất: một CGNAT/NAT chung nay chỉ chia ngân sách TRONG một
          //      tổ chức, không chia cho cả nền tảng (H6-1).
          //   ⑶ `route|to-chuc|org` — trần TOÀN TỔ CHỨC (`orgLimit`), làm CHẬM chứ không khoá (H5-1).
          //      Nó rời khỏi `otp_rate_limits` vì ở đó tổ chức lạ ném 23503 ⇒ không bao giờ chậm ⇒
          //      độ trễ 2 giây là một oracle tồn tại tổ chức (H6-2). Nay hai ca chậm như nhau.
          // ADR-013 (org_id vào phép băm) KHÔNG áp cho ⑵⑶: khoá của chúng chỉ có route, địa chỉ và
          // chính `orgId` — không một giá trị nào CHUNG giữa hai tổ chức để một bản sao lưu JOIN.
          // [review H5-1] Bucket TOÀN TỔ CHỨC (`orgLimit`) KHÔNG khoá: ~~429~~ vượt thì LÀM CHẬM
          // `treQuaTranMs` rồi vẫn xử lý — nguyên tắc ADR-015 §5 ("hạn mức theo đích chỉ được làm chậm,
          // không được khoá, vì khoá cho phép một người khoá lối vào của người khác"); `orgId` không phải
          // bí mật (nằm trong cookie mọi NCC từng được mời), nên một trần chặn theo tổ chức là vũ khí
          // khoá cửa đăng nhập của cả tổ chức với giá một địa chỉ. Bucket tổ chức chỉ được cộng khi
          // người gọi CHƯA vượt trần riêng — một địa chỉ đóng góp tối đa `callerLimit` vào nó.
          // `Retry-After` là cả cửa sổ, không phải phần còn lại — cố ý thô, không tiết lộ mốc bucket.
          if (route.callerLimit !== undefined) {
            const tran = route.callerLimit;
            // [review H6-1 ⑵] Không đọc được địa chỉ ⇒ TỪ CHỐI, không gộp vào một bucket dùng chung
            // với lưu lượng thật. 503 chứ không 429: đây là "máy chủ không phán quyết được", không
            // phải "bạn gọi quá nhiều"; và nó là tín hiệu vận hành, nên có một dòng log không giá trị.
            if (!diaChiPhanGiaiDuoc(req.remoteAddress)) {
              console.error(`[api] ${requestId} khong doc duoc dia chi nguoi goi ${route.path}`);
              return { status: 503, body: THAN_503 };
            }
            const khoaIp = `${route.path}|${khoaNguoiGoi(req.remoteAddress)}`;
            const [toanCuc, theoToChuc] = await withTenant(deps.pool, orgId, async (client) => [
              await tangBucketNguoiGoi(client, khoaIp, deps.services.pepper),
              await tangBucketNguoiGoi(client, `${khoaIp}|${orgId}`, deps.services.pepper),
            ]);
            if (theoToChuc > tran || toanCuc > tran * BOI_TRAN_DIA_CHI) {
              return { status: 429, body: THAN_429, headers: { "retry-after": String(OTP_RATE_WINDOW_SECONDS) } };
            }
            // Chỉ tới đây khi người gọi CHƯA vượt trần riêng (H5-1): một địa chỉ góp tối đa
            // `callerLimit` vào bucket toàn tổ chức.
            if (route.orgLimit !== undefined) {
              const soLanToChuc = await withTenant(deps.pool, orgId, (client) =>
                tangBucketNguoiGoi(client, `${route.path}|to-chuc|${orgId}`, deps.services.pepper),
              );
              if (soLanToChuc > route.orgLimit) {
                // Tín hiệu tấn công, không phải tải thường — log chỉ mang route và requestId (không orgId).
                console.error(`[api] ${requestId} qua tran to chuc ${route.path}`);
                await new Promise<void>((xong) => setTimeout(xong, treQuaTranMs));
              }
            }
          }
          let danhThuc = false;
          const nudgeOutbox = (): void => {
            danhThuc = true;
          };
          const handler = nguonHandler();
          const phanHoi = await chaySauCommit(
            await handler.giaoDich(
              withTenant(deps.pool, orgId, (client) =>
                handler.chay(() => route.handler({ req, orgId, client, services: deps.services, afterCommit, nudgeOutbox })),
              ),
            ),
            orgId,
          );
          // [sổ nợ 38] Job đã nằm trong CSDL (commit xong) và phản hồi đã quyết: đánh thức, không đợi.
          if (danhThuc && phanHoi.status < 400) deps.outboxNudge?.(orgId);
          return phanHoi;
        }

        case "BUYER": {
          const cookie = tachCookiePhien(req.cookies[COOKIE_PHIEN_NGUOI_MUA]);
          if (cookie === null) return { status: 401, body: THAN_401 };
          const handler = nguonHandler();
          const trongGiaoDich = async (client: pg.PoolClient): Promise<ApiResponse> => {
            let actor: SessionActor;
            try {
              actor = await resolveSessionByToken(client, cookie.orgId, cookie.token);
            } catch (e) {
              // [S1.67 / khoản 118 — lượt soi 60a-2] Chỉ lỗi xác thực CÓ TÊN thành 401: mọi ca hỏng của phiên — token sai hình dạng hay
              // không khớp, thu hồi, hết hạn, chưa MFA, người dùng bị đình chỉ — ném cùng một `SessionInvalidError`. Bản trước gói MỌI
              // lỗi, cả lỗi Postgres của câu xác thực (đo: EXECUTE trên app_current_org_id() thu hồi ⇒ 401 không log) lẫn phép từ chối
              // gắn tổ chức của `assertTenantBound`.
              if (e instanceof SessionInvalidError) throw new LoiXacThuc({ cause: e });
              throw e;
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
            return handler.chay(() =>
              route.handler({ req, orgId: cookie.orgId, client, actor, auditPool: deps.auditPool, services: deps.services, afterCommit, afterCommitCoBu }),
            );
          };
          return await handler.giaoDich(withTenant(deps.pool, cookie.orgId, trongGiaoDich)).then((r) => chaySauCommit(r, cookie.orgId));
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
            // [S1.66 / lượt soi ngang 59b-1] Chỉ lỗi XÁC THỰC thành 401: token khách hỏng, lạ, thu hồi hay hết hạn (`InvitationError`
            // của resolveGuestSessionByToken) và lỗi ĐẦU VÀO của withTenant. Bản trước gói MỌI lỗi — mặc định phiên gắn sẵn, rò phạm
            // vi phiên, `KetNoiNhiemError` của lần lấy client — thành một 401 câm (đo: lượt soi 59, `loi-giao-thuc.int.test.ts`).
            if (e instanceof InvitationError || (e instanceof TenantError && e.kind === "input")) throw new LoiXacThuc({ cause: e });
            throw e;
          }
          const handler = nguonHandler();
          const goiHandler = (client: pg.PoolClient): Promise<ApiResponse> =>
            handler.chay(() =>
              route.handler({
                req,
                orgId: cookie.orgId,
                client,
                guestSessionId: phien.guestSessionId,
                invitationId: phien.invitationId,
                rfqId: phien.rfqId,
                services: deps.services,
              }),
            );
          // Đường GHI: `withTenant`, không GUC — xem khối [S1.10.3] ở đầu file.
          if (route.mutates) return await handler.giaoDich(withTenant(deps.pool, cookie.orgId, goiHandler));
          // Đường ĐỌC: `withGuestSession` tự đọc lại hàng phiên, từ chối phiên thu hồi/hết hạn, và
          // đặt CẢ BA GUC. Handler nhận `client` khi mọi việc ấy đã xong — hoặc không nhận gì cả.
          return await handler.giaoDich(withGuestSession(deps.pool, cookie.orgId, phien.guestSessionId, goiHandler));
        }
      }
    } catch (err) {
      if (err instanceof LoiXacThuc) return { status: 401, body: THAN_401 };
      // [S1.67 / khoản 118] Nguồn ⑶ ở đầu tệp: chỉ lỗi của handler đi qua bảng của giai đoạn 2.
      if (err instanceof LoiHandler) return anhXaLoiHandler(err.cause, requestId);
      // `withTenant` ném TenantError cho một orgId SAI HÌNH DẠNG (nó KHÔNG tra `organizations` —
      // một orgId lạ nhưng đúng UUID đi qua và RLS lọc thành 0 hàng), và `withGuestSession` ném
      // TenantError cho một phiên khách hỏng ~~— cả hai thuộc giai đoạn xác thực, không phải lỗi handler~~. [S1.66 / lượt soi ngang
      // 59b-1] Không chỉ hai ca ấy: withTenant còn ném TenantError khi TỪ CHỐI PHỤC VỤ — mặc định phiên gắn sẵn, rò phạm vi phiên,
      // replica lúc COMMIT, giao dịch hỏng, GUC khách không hiệu lực (đo: lượt soi 59 — cả nhóm từng ra 401 không log). Chỉ loại
      // `input` thuộc giai đoạn xác thực; loại `protocol` rơi xuống ~~`anhXaLoiHandler`~~ [S1.67] `loiNoiBo` — 500 thân cố định, một dòng
      // log mang tên và mã. ~~`SessionInvalidError` và
      // `InvitationError` KHÔNG bao giờ tới đây từ giai đoạn 1 (đã bọc), nên nếu thấy chúng thì
      // đó là lỗi nghiệp vụ của handler và rơi vào bảng 422 ở dưới.~~ [S1.67 / khoản 118] Lỗi của handler không còn tới đây trần (đã mang
      // dấu `LoiHandler`), nên mọi thứ dưới dòng này là lỗi của nguồn ⑴ ⑵ ⑷ — kiểm TÊN ở đây chỉ an toàn VÌ nguồn đã được tách:
      // `TenantError` loại input chỉ đến từ withTenant/withGuestSession, `PermissionDeniedError` chỉ từ `requirePermission`, `HttpError`
      // từ `orgIdTuThan` và `resourceId` của route. Hệ quả: `InvitationError` ném ngoài handler (bộ đếm hạn mức không trả số lần — nhánh
      // phòng thủ) nay là 500 có log, không còn 422.
      if (err instanceof TenantError && err.kind === "input") return { status: 401, body: THAN_401 };
      if (err instanceof PermissionDeniedError) return { status: 403, body: THAN_403 };
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      return loiNoiBo(err, requestId);
    }
  };
}
