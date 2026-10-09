// ==============================================================================================
// [S1.9101 / S3.7a1 / ADR-081] ĐƯỜNG PASSPORT CỦA NHÀ CUNG CẤP QUA HTTP
//
// Vô danh (ANON, tiền tố `/guest/` theo lớp canh `route-types.ts`) — ba bước để một link Passport thành một phiên:
//   POST /guest/passport/redeem      {orgId, token}           → kênh của link, kênh OTP khả dụng (không phải một phiên)
//   POST /guest/passport/otp         {orgId, token, channel}  → phát OTP; mã ĐI TỚI BỘ GỬI, không về client
//   POST /guest/passport/otp/verify  {orgId, token, code}     → phiên Passport; token phiên đi ra bằng COOKIE riêng
// Phiên Passport (audience `PASSPORT`, cookie `__Host-tp_passport`):
//   GET  /passport            → bối cảnh + phiên bản mới nhất của CHÍNH nhà cung cấp (số tài khoản che)
//   POST /passport/versions   → nộp một phiên bản hồ sơ
//   POST /passport/logout     → thoát phiên
// Cùng ba điều của đường khách (E6/E2): token chỉ đi trong THÂN; mã OTP không bao giờ trong phản hồi; không cách nào từ token tới
// phiên mà không qua `verifyPassportOtpAndStartSession` — hàm ấy đòi mã.
// ==============================================================================================
import {
  CHANNELS,
  issuePassportOtp,
  redeemPassportLink,
  revokePassportSession,
  verifyPassportOtpAndStartSession,
  type Channel,
} from "@trustprocure/invitation";
import { docHoSoPassportNhap, docPassportCuaToi, nopPhienBanPassport } from "@trustprocure/supplier";
import { khoaNguoiGoi } from "../dia-chi.js";
import { HttpError } from "../http.js";
import type { AnonRoute, PassportRoute } from "../route-types.js";

/** Tiền tố `__Host-` — cùng lý do với cookie khách và cookie người mua (sổ nợ 42). Tên RIÊNG: một cookie, một đối tượng route. */
export const COOKIE_PHIEN_PASSPORT = "__Host-tp_passport";
/** Bằng mặc định của `verifyPassportOtpAndStartSession` (4 giờ). Cookie chết cùng lúc với hàng phiên. */
const TUOI_COOKIE_PASSPORT_GIAY = 4 * 3600;

export function cookiePhienPassport(orgId: string, sessionToken: string): string {
  return (
    `${COOKIE_PHIEN_PASSPORT}=${orgId}.${sessionToken}; Path=/; Max-Age=${TUOI_COOKIE_PASSPORT_GIAY}; ` +
    "HttpOnly; Secure; SameSite=Strict"
  );
}

export const XOA_COOKIE_PHIEN_PASSPORT = `${COOKIE_PHIEN_PASSPORT}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** Trần theo NGƯỜI GỌI của hai route mang credential trong thân — cùng con số với `/guest/redeem`, `/guest/otp/verify`. */
export const PASSPORT_REDEEM_MAX_PER_CALLER = 30;
export const PASSPORT_OTP_VERIFY_MAX_PER_CALLER = 30;

function chuoiThan(body: unknown, ten: string): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[ten];
  if (typeof v !== "string" || v === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}

function kenhThan(body: unknown): Channel {
  const v = chuoiThan(body, "channel");
  if (!(CHANNELS as readonly string[]).includes(v)) throw new HttpError(422, 'trường "channel" không hợp lệ');
  return v as Channel;
}

export const ROUTES_PASSPORT_ANON: readonly AnonRoute[] = [
  {
    method: "POST",
    path: "/guest/passport/redeem",
    audience: "ANON",
    mutates: false,
    callerLimit: PASSPORT_REDEEM_MAX_PER_CALLER,
    handler: async (ctx) => {
      const loi = await redeemPassportLink(ctx.client, ctx.orgId, chuoiThan(ctx.req.body, "token"));
      // Không trả nhà cung cấp, người liên hệ hay đích: tên nhà cung cấp chỉ hiện SAU OTP (phiên). Kênh OTP tính từ LỚP của kênh link,
      // không từ việc người liên hệ có số điện thoại — một câu trả lời dựa trên dữ liệu ấy là một oracle (lượt soi ⑫).
      return { status: 200, body: { linkChannel: loi.linkChannel, otpChannels: loi.otpChannels } };
    },
  },
  {
    method: "POST",
    path: "/guest/passport/otp",
    audience: "ANON",
    mutates: true,
    handler: async (ctx) => {
      const channel = kenhThan(ctx.req.body);
      const kq = await issuePassportOtp(ctx.client, ctx.orgId, {
        token: chuoiThan(ctx.req.body, "token"),
        channel,
        callerFingerprint: khoaNguoiGoi(ctx.req.remoteAddress),
        pepper: ctx.services.pepper,
      });
      if (!kq.ok) {
        return {
          status: 429,
          body: { ok: false, reason: kq.reason, retryAfterSeconds: kq.retryAfterSeconds },
          headers: { "retry-after": String(kq.retryAfterSeconds) },
        };
      }
      // Mã đi TỚI bộ gửi SAU COMMIT và dừng ở đó; phản hồi không mang mã, không mang đích (E5).
      const { destination, code } = kq;
      ctx.afterCommit(() => ctx.services.otpSender.send({ channel, destination, code }));
      return { status: 200, body: { ok: true, challengeId: kq.challengeId, channel } };
    },
  },
  {
    method: "POST",
    path: "/guest/passport/otp/verify",
    audience: "ANON",
    mutates: true,
    callerLimit: PASSPORT_OTP_VERIFY_MAX_PER_CALLER,
    handler: async (ctx) => {
      const kq = await verifyPassportOtpAndStartSession(ctx.client, ctx.orgId, {
        token: chuoiThan(ctx.req.body, "token"),
        code: chuoiThan(ctx.req.body, "code"),
        pepper: ctx.services.pepper,
      });
      if (!kq.ok) return { status: 401, body: { ok: false, reason: kq.reason } };
      return {
        status: 200,
        body: { ok: true, verifiedChannel: kq.verifiedChannel },
        setCookie: [cookiePhienPassport(ctx.orgId, kq.sessionToken)],
      };
    },
  },
];

export const ROUTES_PASSPORT: readonly PassportRoute[] = [
  {
    method: "GET",
    path: "/passport",
    audience: "PASSPORT",
    mutates: false,
    handler: async (ctx) => {
      const cuaToi = await docPassportCuaToi(ctx.client, ctx.orgId);
      return {
        status: 200,
        body: {
          // Bối cảnh DẪN XUẤT ở bước tra cookie — tên và MST của BẢN GHI nhà cung cấp mà bên mua đang giữ.
          nhaCungCap: { legalName: ctx.supplierLegalName, taxCode: ctx.supplierTaxCode },
          phienBanMoiNhat: cuaToi.phienBanMoiNhat,
          soPhienBan: cuaToi.soPhienBan,
        },
      };
    },
  },
  {
    method: "POST",
    path: "/passport/versions",
    audience: "PASSPORT",
    mutates: true,
    handler: async (ctx) => {
      const ra = await nopPhienBanPassport(ctx.client, ctx.orgId, {
        passportSessionId: ctx.passportSessionId,
        supplierId: ctx.supplierId,
        contactId: ctx.contactId,
        hoSo: docHoSoPassportNhap(ctx.req.body),
      });
      return { status: 201, body: { phienBan: { thuTu: ra.thuTu, createdAt: ra.createdAt } } };
    },
  },
  {
    method: "POST",
    path: "/passport/logout",
    audience: "PASSPORT",
    mutates: true,
    handler: async (ctx) => {
      // `false` (phiên đã bị thu hồi giữa lúc tra cookie và lúc này) vẫn xoá cookie: thứ người dùng muốn đã đúng.
      await revokePassportSession(ctx.client, ctx.orgId, ctx.passportSessionId);
      return { status: 200, body: { ok: true }, setCookie: [XOA_COOKIE_PHIEN_PASSPORT] };
    },
  },
];
