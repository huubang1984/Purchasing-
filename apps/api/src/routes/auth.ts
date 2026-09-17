// ==============================================================================================
// Đăng nhập NGƯỜI MUA — ADR-020 mục 2: magic link email + TOTP bắt buộc, KHÔNG mật khẩu.
//
//   POST /auth/link     {orgId, email}        → luôn 200 cùng một thân; token đi tới BỘ GỬI
//   POST /auth/redeem   {orgId, token}        → đã có TOTP chưa; nếu chưa: ghi danh, trả bí mật MỘT LẦN
//   POST /auth/totp     {orgId, token, code}  → phiên ĐÃ MFA, đi ra bằng cookie `__Host-tp_session`
//   POST /auth/logout   (cookie)              → thu hồi phiên, xoá cookie — route "tự thân", không mã quyền
//
// E2 cho người mua: token magic link KHÔNG mở phiên — chỉ `/auth/totp` mở, và nó đòi mã.
// E6: token chỉ đi trong THÂN; link là `/login#<token>` (trang tĩnh đọc `location.hash` rồi POST).
// Bí mật TOTP lúc ghi danh đi thẳng về client trong MỘT phản hồi và không đi đâu khác — đúng điều
// khối chú thích `generateTotpSecret` (totp.ts) đòi, và `auth.int.test.ts` khẳng định không một
// dòng `console.error` nào mang nó.
// ==============================================================================================
import {
  LoginTokenError,
  enrollOrReplaceTotpForLogin,
  generateTotpSecret,
  redeemLoginToken,
  revokeSession,
  startAgentSession,
  startUserSession,
  verifyTotpForLogin,
} from "@trustprocure/identity";
import { enqueueJob } from "@trustprocure/outbox";
import { HttpError } from "../http.js";
import { EMAIL_MAX_BYTES, LOGIN_LINK_SEND_KIND } from "../outbox-api.js";
import type { AnonRoute, BuyerSelfRoute } from "../route-types.js";

/**
 * [sổ nợ 42 / review L-2] Tiền tố `__Host-`: trình duyệt chỉ nhận cookie này khi nó đến từ một
 * phản hồi HTTPS, KHÔNG có `Domain`, và `Path=/` — nên một subdomain anh em bị chiếm KHÔNG ném được
 * một `tp_session` giả vào trình duyệt của người mua (login CSRF). Đổi tên là đổi hợp đồng với
 * client; làm trước khi có client thật là rẻ nhất.
 */
export const COOKIE_PHIEN_NGUOI_MUA = "__Host-tp_session";

/**
 * [sổ nợ 39 / review M-2] Trần theo NGƯỜI GỌI, mỗi route, mỗi 15 phút (dispatcher đếm — `callerLimit`).
 * `/auth/link` thấp nhất: nó là cửa liệt kê email, và một người thật hiếm khi cần hơn vài link một
 * lượt; hai route sau cho phép gõ sai nhiều hơn vì khoá hồ sơ (E3, 5 lần) đã canh theo nạn nhân,
 * còn trần này canh theo kẻ thử nhiều nạn nhân.
 */
// [review H4-4] ~~10~~ 30: một NAT văn phòng người mua là MỘT địa chỉ IPv4, và 30 người đăng nhập lúc
// 9 giờ không được thành 429 cho cả văn phòng. Trần theo người dùng (5/15 phút, `issueLoginToken`)
// mới là trần chống lạm dụng hộp thư; trần này chỉ chống một người gọi làm đầy `outbox_jobs`.
export const LOGIN_LINK_MAX_PER_CALLER = 30;
/**
 * [sổ nợ 52] Trần TOÀN TỔ CHỨC cho `/auth/link` mỗi 15 phút. Một tổ chức người mua có vài chục
 * người; 300 link/15 phút là gấp nhiều lần mọi buổi sáng thứ hai, và là trần cho kẻ xoay /64 IPv6.
 * ~~Vượt ⇒ 429 cho cả tổ chức — DoS có chủ đích thu hẹp: chỉ route link, chỉ 15 phút, người đã có
 * phiên không bị ảnh hưởng.~~ [review H5-1] Vượt ⇒ LÀM CHẬM, không khoá (`TRE_QUA_TRAN_TO_CHUC_MS`):
 * "DoS thu hẹp" vẫn là DoS, và `orgId` không phải bí mật.
 */
export const LOGIN_LINK_MAX_PER_ORG = 300;
export const LOGIN_REDEEM_MAX_PER_CALLER = 30;
export const LOGIN_TOTP_MAX_PER_CALLER = 30;

function chuoi(body: unknown, ten: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (typeof v !== "string" || v === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}

/** [review H4-3] Hình dạng email tối thiểu: `a@b`, không khoảng trắng, không ký tự điều khiển, một `@`. */
export function laHinhDangEmail(v: string): boolean {
  const s = v.trim();
  return /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+$/u.test(s);
}

/** RFC 4648 base32, không đệm — dạng mọi ứng dụng TOTP đọc được. */
export function base32(u8: Uint8Array): string {
  const BANG = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let gia = 0;
  let ra = "";
  for (const b of u8) {
    gia = (gia << 8) | b;
    bits += 8;
    while (bits >= 5) {
      ra += BANG[(gia >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) ra += BANG[(gia << (5 - bits)) & 31];
  return ra;
}

export function cookiePhienNguoiMua(orgId: string, token: string, maxAge: number): string {
  return `${COOKIE_PHIEN_NGUOI_MUA}=${orgId}.${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

const XOA_COOKIE = `${COOKIE_PHIEN_NGUOI_MUA}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export const ROUTES_AUTH: readonly AnonRoute[] = [
  {
    method: "POST",
    path: "/auth/link",
    audience: "ANON",
    mutates: true,
    callerLimit: LOGIN_LINK_MAX_PER_CALLER,
    orgLimit: LOGIN_LINK_MAX_PER_ORG,
    handler: async (ctx) => {
      const email = chuoi(ctx.req.body, "email");
      if (email.length > EMAIL_MAX_BYTES) throw new HttpError(422, 'trường "email" quá dài');
      // [review H4-3] Email đi vào `outbox_jobs.payload` (tới khi job xong — 041 xoá). Không lưu chuỗi
      // tuỳ ý: phải trông như email (một `@`, hai vế không rỗng, không khoảng trắng/ký tự điều khiển).
      // Kiểm HÌNH DẠNG, không kiểm tồn tại — cùng một 422 cho mọi chuỗi sai dạng, không phụ thuộc CSDL.
      if (!laHinhDangEmail(email)) throw new HttpError(422, 'trường "email" không đúng hình dạng');
      // [sổ nợ 38 / review M-1, M-7] KHÔNG tra người dùng ở đây. Một INSERT vào outbox cho MỌI email —
      // có người hay không, bị hạn mức hay không — là cùng một câu lệnh, cùng một RTT. Việc "email này
      // là ai, phát token, gửi" chạy SAU phản hồi, dưới runner của tiến trình (`outbox-api.ts`).
      // Nguyên văn cũ, giữ để đối chiếu: ~~`issueLoginToken` ở đây, gửi ở `afterCommit`~~ — hai nhánh
      // ấy khác nhau một INSERT, và RTT nói ra điều đó.
      // Tổ chức KHÔNG tồn tại: khoá ngoại của outbox_jobs từ chối (23503). Vẫn phải là CÙNG một 200 —
      // savepoint để giao dịch không bị bỏ dở, và không có gì để đánh thức.
      await ctx.client.query("SAVEPOINT xep_hang");
      try {
        await enqueueJob(ctx.client, ctx.orgId, { kind: LOGIN_LINK_SEND_KIND, payload: { email } });
      } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "23503")) throw e;
        await ctx.client.query("ROLLBACK TO SAVEPOINT xep_hang");
        return { status: 200, body: { ok: true } };
      }
      ctx.nudgeOutbox();
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: "POST",
    path: "/auth/redeem",
    audience: "ANON",
    mutates: true,
    callerLimit: LOGIN_REDEEM_MAX_PER_CALLER,
    handler: async (ctx) => {
      const token = chuoi(ctx.req.body, "token");
      const nguoi = await redeemLoginToken(ctx.client, ctx.orgId, token);
      if (nguoi.hasTotp) return { status: 200, body: { needsEnrollment: false } };
      // Ghi danh TOTP: bí mật sinh ở đây, bọc bằng bộ bọc TIÊM vào, lưu băm-bọc, và đi về client
      // ĐÚNG MỘT LẦN. [review M-5] Hồ sơ CHƯA XÁC NHẬN được ghi danh LẠI (thay bí mật) — người mua
      // thật không bị khoá bởi một lần ghi danh trộm; hồ sơ đã xác nhận thì không, và mọi lần đều
      // để lại `MFA_ENROLLED`. [review L-6] `Buffer` LÀ `Uint8Array` — không sao chép, xoá một lần.
      const biMat = generateTotpSecret();
      // [review H4-8] `fill(0)` trên MỌI đường ra, kể cả khi KMS quá hạn hay CSDL ném: bí mật không
      // nằm lại trong heap tới GC chỉ vì một lỗi. (Promise KMS gốc bị bỏ vẫn giữ tham chiếu tới
      // buffer đã xoá — nó thấy toàn số 0.)
      try {
        const boc = await ctx.services.totpSecretWrapper.wrapTotpSecret(ctx.orgId, biMat);
        await enrollOrReplaceTotpForLogin(ctx.client, {
          orgId: ctx.orgId,
          userId: nguoi.userId,
          wrapped: boc,
          ip: ctx.req.remoteAddress === "" ? null : ctx.req.remoteAddress,
        });
        const secretBase32 = base32(biMat);
        return { status: 200, body: { needsEnrollment: true, totpSecretBase32: secretBase32, issuer: "TrustProcure" } };
      } finally {
        biMat.fill(0);
      }
    },
  },
  {
    method: "POST",
    path: "/auth/totp",
    audience: "ANON",
    mutates: true,
    callerLimit: LOGIN_TOTP_MAX_PER_CALLER,
    handler: async (ctx) => {
      const token = chuoi(ctx.req.body, "token");
      const code = chuoi(ctx.req.body, "code");
      const nguoi = await redeemLoginToken(ctx.client, ctx.orgId, token);
      const kq = await verifyTotpForLogin(
        ctx.client,
        { orgId: ctx.orgId, userId: nguoi.userId, code },
        ctx.services.totpSecretUnsealer,
      );
      if (!kq.ok) {
        if (kq.auditSkipped === true) {
          // [S1.75 / khoản 139] Hồ sơ ĐÃ khoá nhưng sổ kiểm toán KHÔNG nhận được dòng `MFA_LOCKED`:
          // khoá ghi sổ của tổ chức bị giữ quá trần 2 s (050). Đây là chỗ DUY NHẤT cái thiếu ấy để
          // lại dấu — `verifyAuditChain` chỉ kiểm chuỗi băm của những hàng ĐANG CÓ, nên nó không
          // bao giờ thấy được một hàng chưa từng được ghi.
          //
          // Dòng này CỐ ĐỊNH, không nội suy `orgId`, `userId` hay `lockedUntil` — cùng kỷ luật A2
          // với `dispatch.ts`: một dòng log của đường đăng nhập là thứ đi thẳng ra stderr.
          console.error("[api] khoan 139: MFA_LOCKED khong ghi duoc so (55P03) — ho so VAN khoa");
        }
        // [review L-7] Hai giá trị cho client, không hơn: lý do chi tiết (NO_CREDENTIAL,
        // CODE_ALREADY_USED, …) là oracle cho kẻ cầm token bị chuyển tiếp; `lockedUntil` làm tròn
        // LÊN phút để không ai lên lịch đoán tới giây.
        const khoa = kq.reason === "LOCKED_OUT";
        const lam = kq.lockedUntil === null ? null : new Date(Math.ceil(kq.lockedUntil.getTime() / 60_000) * 60_000).toISOString();
        return { status: 401, body: { ok: false, reason: khoa ? "LOCKED_OUT" : "WRONG_CODE", lockedUntil: khoa ? lam : null } };
      }
      const phien = await startUserSession(ctx.client, ctx.orgId, {
        tokenId: nguoi.tokenId,
        userId: nguoi.userId,
        mfaProof: kq.proof,
        ip: ctx.req.remoteAddress === "" ? null : ctx.req.remoteAddress,
      });
      return {
        status: 200,
        body: { ok: true },
        setCookie: [cookiePhienNguoiMua(ctx.orgId, phien.token, phien.expiresInSeconds)],
      };
    },
  },
];

export const ROUTES_AUTH_SELF: readonly BuyerSelfRoute[] = [
  {
    method: "POST",
    path: "/auth/logout",
    audience: "BUYER",
    mutates: true,
    self: true,
    // [khoản 141] Phiên agent tự thu hồi được, và đó là điều MONG MUỐN: một tiến trình MCP dừng
    // sạch nên trả lại chứng chỉ của nó thay vì để nó sống tới hết giờ. Route chỉ chạm CHÍNH phiên
    // đang gọi, nên nó không mở được gì thêm.
    agent: true,
    // [khoản 144] CỐ Ý KHÔNG TRẦN. Đăng xuất chỉ thu hồi CHÍNH phiên đang gọi: lần đầu thành công
    // làm phiên hết hiệu lực, nên lần thứ hai đã là 401 ở `resolveSessionByToken` — trần ở đây
    // không chặn thêm gì. Và nó có mặt xấu: một 429 trên đường đăng xuất là một lớp GIỮ người ta ở
    // trong phiên, tức đúng chiều ngược với thứ ta muốn khi ai đó nghi phiên mình bị trộm.
    sessionLimit: null,
    handler: async (ctx) => {
      await revokeSession(ctx.client, ctx.orgId, ctx.actor.sessionId);
      return { status: 200, body: { ok: true }, setCookie: [XOA_COOKIE] };
    },
  },
  {
    // ==========================================================================================
    // [khoản 141 / ADR-039] ĐƯỜNG PHÁT CHỨNG CHỈ AGENT — và vì sao nó nằm ở ĐÂY.
    //
    // Phiên agent có trần TTL một giờ (051) và `sessions.expires_at` KHÔNG có `GRANT UPDATE`
    // (006 — "không gia hạn phiên trượt"), nên gia hạn tại chỗ là bất khả. Nếu đường phát duy
    // nhất là `POST /auth/totp` thì giữ một máy chủ MCP sống đòi một con người gõ TOTP mỗi giờ
    // và đụng `LOGIN_MAX_TOKENS_PER_WINDOW` — lượt soi đối kháng Đ-3 đo ra rằng đó là một chế độ
    // vận hành không dùng được, và một chế độ không dùng được không phải một lớp an ninh: nó đẩy
    // người vận hành sang cắm cookie NGƯỜI 8 giờ vào biến môi trường, đúng thứ vòng này chặn.
    //
    // Route này là đường ra khỏi thế lưỡng nan ấy, và nó KHÔNG nới một bảo đảm nào:
    //   • `self: true` + `agent: false` — chỉ một phiên NGƯỜI gọi được. Một chứng chỉ agent KHÔNG
    //     tự gia hạn và KHÔNG tự nhân bản được; đó là vế chịu lực.
    //   • Nó KHÔNG chạm trigger `sessions_kiem_totp_gan_day` (039) đang bị hardening ghim: phiên
    //     người gọi đã qua TOTP, và `assertFreshMfa` dưới đây đòi lần TOTP ấy còn TƯƠI.
    //   • Token đi trong THÂN, không trong cookie: người vận hành chép nó sang biến môi trường
    //     của tiến trình MCP. Cookie không giúp được gì cho một tiến trình không phải trình duyệt.
    // ==========================================================================================
    method: "POST",
    path: "/auth/agent-session",
    audience: "BUYER",
    mutates: true,
    self: true,
    agent: false,
    // [khoản 144 — ĐO] BA, và con số ấy phải nhỏ hơn `MFA_MAX_FAILED_ATTEMPTS` = 5 mới có nghĩa.
    // Đo trước khi có dòng này: 12 lần gọi với mã sai ⇒ 12×401, `failed_attempts` chạm 5, hồ sơ
    // khoá, và nạn nhân sau đó nhận `LOCKED_OUT` trên ĐƯỜNG ĐĂNG NHẬP THẬT với mã ĐÚNG — tức một
    // cookie trộm được khoá luôn đường mà chủ nhân cần để đi thu hồi chính cookie ấy. Trần phải cắt
    // TRƯỚC lần thứ năm, nên 30 (con số của `callerLimit` trên `/auth/totp`) là vô nghĩa ở đây.
    // Một người vận hành thật xin chứng chỉ mỗi giờ một lần; ba lần mỗi mười lăm phút là rộng rãi.
    sessionLimit: 3,
    handler: async (ctx) => {
      // Một mã TOTP TƯƠI, không một magic link nào — xem khối đầu `startAgentSession`. Trigger 039
      // đòi lần TOTP ấy, nên đây không phải một lớp ta tự thêm cho chắc: không có nó thì câu INSERT
      // gãy ở CSDL.
      const code = chuoi(ctx.req.body, "code");
      const kq = await verifyTotpForLogin(
        ctx.client,
        { orgId: ctx.orgId, userId: ctx.actor.id, code },
        ctx.services.totpSecretUnsealer,
      );
      if (!kq.ok) {
        if (kq.auditSkipped === true) {
          // [GIAO ĐIỂM S1.75 × S1.76] Đường này KHÔNG tồn tại khi khoản 139 được vá, nên vế log của
          // nó không thể có mặt ở bản vá ấy — và hai nhánh gộp lại thì không cổng nào đỏ. Điều kiện
          // ① của chủ dự án ("cái thiếu phải để lại dấu") nói về SỰ KIỆN `MFA_LOCKED`, không về
          // đường HTTP nào sinh ra nó; một đường phát mới đi qua `verifyTotpForLogin` mà im lặng là
          // đúng cái lỗ ấy, chỉ ở chỗ khó thấy hơn. Chuỗi NÊU TÊN ĐƯỜNG: hai chỗ cùng một câu thì
          // dòng log không nói được cái thiếu nằm ở đâu.
          console.error("[api] khoan 139: MFA_LOCKED khong ghi duoc so (55P03) tren duong phat agent — ho so VAN khoa");
        }
        // Cùng hai giá trị như `/auth/totp` (review L-7): lý do chi tiết là oracle, `lockedUntil`
        // làm tròn LÊN phút.
        const khoa = kq.reason === "LOCKED_OUT";
        const lam = kq.lockedUntil === null ? null : new Date(Math.ceil(kq.lockedUntil.getTime() / 60_000) * 60_000).toISOString();
        return { status: 401, body: { ok: false, reason: khoa ? "LOCKED_OUT" : "WRONG_CODE", lockedUntil: khoa ? lam : null } };
      }
      const phien = await startAgentSession(ctx.client, ctx.orgId, {
        userId: ctx.actor.id,
        mfaProof: kq.proof,
        capBoiSessionId: ctx.actor.sessionId,
        ip: ctx.req.remoteAddress === "" ? null : ctx.req.remoteAddress,
      });
      // Token đi trong THÂN: người vận hành chép sang biến môi trường của tiến trình MCP. Không
      // `setCookie` — một tiến trình không phải trình duyệt không dùng được cookie, và một chứng
      // chỉ agent nằm trong cookie của người gọi là đúng thứ khoản 141 muốn tách ra.
      return {
        status: 200,
        body: { token: phien.token, expiresInSeconds: phien.expiresInSeconds, kind: "AGENT_READONLY" },
      };
    },
  },
];

export { LoginTokenError };
