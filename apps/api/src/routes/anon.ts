// ==============================================================================================
// Route VÔ DANH của đường khách — ba bước để một magic link thành một phiên (S1.3 qua HTTP).
//
//   POST /guest/redeem      {orgId, token}            → lời mời là gì, OTP đi được kênh nào
//   POST /guest/otp         {orgId, token, channel}   → phát OTP; mã ĐI TỚI BỘ GỬI, không về client
//   POST /guest/otp/verify  {orgId, token, code}      → phiên khách; token phiên đi ra bằng COOKIE
//
// Ba điều E6/E2 đòi và file này giữ: token magic link chỉ đi trong THÂN JSON (trang `/i` đọc
// `location.hash` rồi POST — ADR-020 mục 3); mã OTP không bao giờ xuất hiện trong phản hồi; và
// không có cách nào từ token tới phiên mà không qua `verifyOtpAndStartSession` — hàm ấy đòi mã.
// ==============================================================================================
import {
  CHANNELS,
  issueOtpChallenge,
  redeemMagicLink,
  verifyOtpAndStartSession,
  type Channel,
} from "@trustprocure/invitation";
import { HttpError } from "../http.js";
import type { AnonRoute } from "../route-types.js";

export const COOKIE_PHIEN_KHACH = "tp_guest";
/** Bằng mặc định của `verifyOtpAndStartSession` (4 giờ). Cookie chết cùng lúc với hàng phiên. */
const TUOI_COOKIE_KHACH_GIAY = 4 * 3600;

function chuoi(body: unknown, ten: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (typeof v !== "string" || v === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}

function kenh(body: unknown): Channel {
  const v = chuoi(body, "channel");
  if (!(CHANNELS as readonly string[]).includes(v)) throw new HttpError(422, 'trường "channel" không hợp lệ');
  return v as Channel;
}

/**
 * Dòng `Set-Cookie` cho phiên khách. `Path=/guest` để cookie không đi kèm mọi yêu cầu tới api;
 * `SameSite=Strict` + `HttpOnly` + `Secure` — cùng bộ với phiên người mua (ADR-020 mục 2).
 */
export function cookiePhienKhach(orgId: string, sessionToken: string): string {
  return (
    `${COOKIE_PHIEN_KHACH}=${orgId}.${sessionToken}; Path=/guest; Max-Age=${TUOI_COOKIE_KHACH_GIAY}; ` +
    "HttpOnly; Secure; SameSite=Strict"
  );
}

export const ROUTES_ANON: readonly AnonRoute[] = [
  {
    method: "POST",
    path: "/guest/redeem",
    audience: "ANON",
    mutates: false,
    handler: async (ctx) => {
      const token = chuoi(ctx.req.body, "token");
      const loi = await redeemMagicLink(ctx.client, ctx.orgId, token);
      // KHÔNG trả `contactId`: nó là toạ độ nội bộ của người mua, và client không cần nó để đi
      // bước kế. Kênh OTP khả dụng là mọi kênh KHÁC kênh link (ADR-015 mục 1; trigger ở 010 giữ).
      return {
        status: 200,
        body: {
          invitationId: loi.invitationId,
          linkChannel: loi.linkChannel,
          otpChannels: CHANNELS.filter((c) => c !== loi.linkChannel),
        },
      };
    },
  },
  {
    method: "POST",
    path: "/guest/otp",
    audience: "ANON",
    mutates: true,
    handler: async (ctx) => {
      const token = chuoi(ctx.req.body, "token");
      const channel = kenh(ctx.req.body);
      const kq = await issueOtpChallenge(ctx.client, ctx.orgId, {
        token,
        channel,
        callerFingerprint: ctx.req.remoteAddress,
        pepper: ctx.services.pepper,
      });
      if (!kq.ok) {
        return {
          status: 429,
          body: { ok: false, reason: kq.reason, retryAfterSeconds: kq.retryAfterSeconds },
          headers: { "retry-after": String(kq.retryAfterSeconds) },
        };
      }
      // Mã đi TỚI bộ gửi và dừng ở đó. Phản hồi không mang mã, không mang đích — đích là thứ người
      // mua khai, và một client cầm token chuyển tiếp không được biết số của người được mời (E5).
      await ctx.services.otpSender.send({ channel, destination: kq.destination, code: kq.code });
      return { status: 200, body: { ok: true, challengeId: kq.challengeId, channel } };
    },
  },
  {
    method: "POST",
    path: "/guest/otp/verify",
    audience: "ANON",
    mutates: true,
    handler: async (ctx) => {
      const token = chuoi(ctx.req.body, "token");
      const code = chuoi(ctx.req.body, "code");
      const kq = await verifyOtpAndStartSession(ctx.client, ctx.orgId, {
        token,
        code,
        pepper: ctx.services.pepper,
      });
      if (!kq.ok) return { status: 401, body: { ok: false, reason: kq.reason } };
      return {
        status: 200,
        body: { ok: true, verifiedChannel: kq.verifiedChannel },
        setCookie: [cookiePhienKhach(ctx.orgId, kq.sessionToken)],
      };
    },
  },
];
