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
  enrollTotpCredential,
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
      if (kq.ok) await ctx.services.loginLinkSender.send({ orgId: ctx.orgId, email: kq.email, token: kq.token });
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
      // Ghi danh TOTP lần đầu: bí mật sinh ở đây, bọc bằng bộ bọc TIÊM vào, lưu băm-bọc, và đi về
      // client ĐÚNG MỘT LẦN. Lần redeem sau (cùng token) thấy `hasTotp = true` và không trả gì nữa.
      const biMat = generateTotpSecret();
      const boc = await ctx.services.totpSecretWrapper.wrapTotpSecret(ctx.orgId, new Uint8Array(biMat));
      await enrollTotpCredential(ctx.client, { orgId: ctx.orgId, userId: nguoi.userId, wrapped: boc });
      const secretBase32 = base32(new Uint8Array(biMat));
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
        return {
          status: 401,
          body: { ok: false, reason: kq.reason, lockedUntil: kq.lockedUntil?.toISOString() ?? null },
        };
      }
      const phien = await startUserSession(ctx.client, ctx.orgId, {
        tokenId: nguoi.tokenId,
        userId: nguoi.userId,
        ip: ctx.req.remoteAddress === "" ? null : ctx.req.remoteAddress,
      });
      return {
        status: 200,
        body: { ok: true, userId: nguoi.userId },
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
