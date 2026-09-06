// ==============================================================================================
// Đăng nhập NGƯỜI MUA — ADR-020 mục 2: magic link email + TOTP bắt buộc, KHÔNG mật khẩu.
//
//   POST /auth/link     {orgId, email}        → luôn 200 cùng một thân; token đi tới BỘ GỬI
//   POST /auth/redeem   {orgId, token}        → đã có TOTP chưa; nếu chưa: ghi danh, trả bí mật MỘT LẦN
//   POST /auth/totp     {orgId, token, code}  → phiên ĐÃ MFA, đi ra bằng cookie `tp_session`
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
  issueLoginToken,
  redeemLoginToken,
  revokeSession,
  startUserSession,
  verifyTotpForLogin,
} from "@trustprocure/identity";
import { HttpError } from "../http.js";
import type { AnonRoute, BuyerSelfRoute } from "../route-types.js";

export const COOKIE_PHIEN_NGUOI_MUA = "tp_session";

function chuoi(body: unknown, ten: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (typeof v !== "string" || v === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
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
    handler: async (ctx) => {
      const email = chuoi(ctx.req.body, "email");
      const kq = await issueLoginToken(ctx.client, ctx.orgId, { email });
      // Không có người dùng, bị hạn mức, hay đã gửi: CÙNG một phản hồi. Cái khác duy nhất nằm ở
      // hộp thư — nơi kẻ liệt kê email không nhìn vào được.
      // [review M-7] Gửi SAU COMMIT — token đã ở CSDL trước khi mail đi, và lỗi bộ gửi không đổi 200.
      if (kq.ok) {
        const { email: dich, token } = kq;
        ctx.afterCommit(() => ctx.services.loginLinkSender.send({ orgId: ctx.orgId, email: dich, token }));
      }
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: "POST",
    path: "/auth/redeem",
    audience: "ANON",
    mutates: true,
    handler: async (ctx) => {
      const token = chuoi(ctx.req.body, "token");
      const nguoi = await redeemLoginToken(ctx.client, ctx.orgId, token);
      if (nguoi.hasTotp) return { status: 200, body: { needsEnrollment: false } };
      // Ghi danh TOTP: bí mật sinh ở đây, bọc bằng bộ bọc TIÊM vào, lưu băm-bọc, và đi về client
      // ĐÚNG MỘT LẦN. [review M-5] Hồ sơ CHƯA XÁC NHẬN được ghi danh LẠI (thay bí mật) — người mua
      // thật không bị khoá bởi một lần ghi danh trộm; hồ sơ đã xác nhận thì không, và mọi lần đều
      // để lại `MFA_ENROLLED`. [review L-6] `Buffer` LÀ `Uint8Array` — không sao chép, xoá một lần.
      const biMat = generateTotpSecret();
      const boc = await ctx.services.totpSecretWrapper.wrapTotpSecret(ctx.orgId, biMat);
      await enrollOrReplaceTotpForLogin(ctx.client, {
        orgId: ctx.orgId,
        userId: nguoi.userId,
        wrapped: boc,
        ip: ctx.req.remoteAddress === "" ? null : ctx.req.remoteAddress,
      });
      const secretBase32 = base32(biMat);
      biMat.fill(0);
      return { status: 200, body: { needsEnrollment: true, totpSecretBase32: secretBase32, issuer: "TrustProcure" } };
    },
  },
  {
    method: "POST",
    path: "/auth/totp",
    audience: "ANON",
    mutates: true,
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
    handler: async (ctx) => {
      await revokeSession(ctx.client, ctx.orgId, ctx.actor.sessionId);
      return { status: 200, body: { ok: true }, setCookie: [XOA_COOKIE] };
    },
  },
];

export { LoginTokenError };
