import { randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";
import {
  CHANNELS,
  InvitationError,
  OTP_LOCKOUT_SECONDS,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_MAX_PER_CALLER,
  OTP_MAX_PER_DEST,
  OTP_MAX_PER_DEST_TOAN_TO_CHUC,
  OTP_RATE_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
  bam,
  batBuocTrongGiaoDich,
  demVaTang,
  sinhMaOtp,
  tranTtl,
  type Channel,
} from "./invitation.js";
import type { PepperRing } from "./pepper.js";

// =============================================================================================
// [S1.287 / S3.7a1 / ADR-081 ⑶] ĐƯỜNG PASSPORT — LINK, OTP, PHIÊN CỦA NHÀ CUNG CẤP KHÔNG GẮN MỘT LỜI MỜI
//
// Cùng nguyên tắc của `invitation.ts`, và nó là thứ duy nhất cần nhớ khi sửa tệp này: KHÔNG HÀM NÀO KHAI một sự thật an ninh.
// Người gọi đưa vào token dạng rõ (chỉ có nếu nhận được link) và mã OTP (chỉ có nếu giữ kênh đã đăng ký); nhà cung cấp, người liên
// hệ, kênh, đích — đều ĐỌC RA từ hàng token. Bốn bảng riêng (`118_passport_nha_cung_cap`): bảng phiên và bảng thách thức của lời
// mời mang `invitation_id NOT NULL` (`010`), còn Passport gắn một NHÀ CUNG CẤP.
//
// Mặt tiền giữ hình dạng E2 của gói: không hàm nào ở `index.ts` trả về một PHIÊN từ một TOKEN — `redeemPassportLink` trả kênh,
// hàm DUY NHẤT sinh phiên là `verifyPassportOtpAndStartSession` và nó đòi mã. Dùng lại đúng các bản vá đã đo của đường lời mời
// (`bam`, `sinhMaOtp`, `demVaTang`, biểu thức tự tham chiếu H4, `rowCount` MED-2) thay vì chép chúng (lượt soi hình dạng ②).
// =============================================================================================

/** Hạn TRÊN của link Passport — bằng link mời (E1); CHECK `supplier_passport_tokens_han_toi_da` giữ ở CSDL. */
export const PASSPORT_LINK_MAX_TTL_SECONDS = 7 * 24 * 3600;
/** Hạn TRÊN của phiên Passport; mặc định 4 giờ như phiên khách. CHECK `passport_sessions_han_toi_da`. */
export const PASSPORT_SESSION_MAX_TTL_SECONDS = 12 * 3600;
export const PASSPORT_SESSION_MAC_DINH_GIAY = 4 * 3600;
/**
 * Trần OTP theo NHÀ CUNG CẤP trong một cửa sổ — bucket `PASSPORT`. Khoá theo nhà cung cấp chứ không theo token: khoá theo token thì
 * mỗi lần đúc lại có ngân sách mới (lượt soi ④). Bằng trần theo lời mời của đường khách.
 */
export const OTP_MAX_PER_PASSPORT = 5;
/** Kênh của link Passport hôm nay — EMAIL; OTP vì thế đi máy điện thoại (ADR-015 ⑴, so với kênh ĐÃ LƯU ở trigger). */
export const KENH_LINK_PASSPORT: Channel = "EMAIL";

/** Lớp đích của một kênh — cùng phép chia của `otp_lop_dich` (`022`): hai kênh cùng đọc một cột là cùng một lớp. */
function lopDich(kenh: Channel): "HOP_THU" | "MAY_DIEN_THOAI" {
  return kenh === "EMAIL" ? "HOP_THU" : "MAY_DIEN_THOAI";
}

interface HangTokenPassport {
  token_id: string;
  supplier_id: string;
  contact_id: string;
  link_channel: Channel;
}

/**
 * Token còn dùng được: đúng mục đích, chưa hết hạn, chưa thu hồi, chưa tiêu thụ, tổ chức đã bật S3, người liên hệ còn ACTIVE.
 * Mọi ca hỏng cùng MỘT thông báo — phân biệt được là một oracle.
 */
async function docTokenPassport(client: pg.PoolClient, token: string): Promise<HangTokenPassport> {
  const { rows } = await client.query<HangTokenPassport>(
    `SELECT t.id AS token_id, t.supplier_id, t.contact_id, t.link_channel
       FROM public.supplier_passport_tokens t
       JOIN public.supplier_contacts c
         ON c.id OPERATOR(pg_catalog.=) t.contact_id
        AND c.org_id OPERATOR(pg_catalog.=) t.org_id
      WHERE t.token_hash OPERATOR(pg_catalog.=) $1::pg_catalog.bytea
        AND t.purpose OPERATOR(pg_catalog.=) 'PASSPORT_SUBMISSION'::pg_catalog.text
        AND t.expires_at OPERATOR(pg_catalog.>) pg_catalog.now()
        AND t.revoked_at IS NULL
        AND t.consumed_at IS NULL
        AND c.status OPERATOR(pg_catalog.=) 'ACTIVE'::pg_catalog.text
        AND public.to_chuc_da_bat_s3(t.org_id)`,
    [bam(token)],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new InvitationError("link Passport không hợp lệ, đã hết hạn, đã dùng, hoặc đã bị thu hồi");
  }
  return hang;
}

export interface TokenPassportDaDuc {
  readonly tokenId: string;
  /** Dạng rõ — lần DUY NHẤT nó tồn tại; CSDL giữ SHA-256 (E1). Không log, không vào sổ, không vào payload outbox. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly linkChannel: Channel;
  /** Số link chưa dùng và phiên còn sống của CÙNG nhà cung cấp mà lần đúc này thu hồi (lượt soi T3, T4). */
  readonly soLinkThuHoi: number;
  readonly soPhienThuHoi: number;
}

/**
 * Đúc link Passport cho MỘT yêu cầu vừa ghi trong CÙNG giao dịch (trigger `passport_kiem_token` đòi cùng người, cùng phiên, cùng
 * giao dịch). Trước khi đúc, THU HỒI mọi link chưa dùng và mọi phiên còn sống của nhà cung cấp — một nhà cung cấp có tối đa một
 * link sống, và link mới là đường bên mua cắt một người nhận nhầm hay một khoá OTP (lượt soi T3, T4, L9).
 */
export async function ducTokenPassport(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly requestId: string;
    readonly supplierId: string;
    readonly contactId: string;
    readonly actorSessionId: string;
    readonly ttlSeconds?: number;
  },
): Promise<TokenPassportDaDuc> {
  await assertTenantBound(client, orgId, "ducTokenPassport");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const ttl = tranTtl(input.ttlSeconds, PASSPORT_LINK_MAX_TTL_SECONDS, PASSPORT_LINK_MAX_TTL_SECONDS, "ttlSeconds");

  const link = await client.query(
    "UPDATE public.supplier_passport_tokens SET revoked_at = pg_catalog.now() " +
      " WHERE supplier_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND revoked_at IS NULL AND consumed_at IS NULL",
    [input.supplierId],
  );
  const phien = await client.query(
    "UPDATE public.passport_sessions SET revoked_at = pg_catalog.now() " +
      " WHERE supplier_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND revoked_at IS NULL",
    [input.supplierId],
  );

  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO public.supplier_passport_tokens
       (org_id, request_id, supplier_id, contact_id, token_hash, purpose, link_channel, expires_at, issued_by, issued_by_session_id)
     VALUES ($1, $2, $3, $4, $5, 'PASSPORT_SUBMISSION', $6,
             pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $7), $8, $9)
     RETURNING id, expires_at`,
    [orgId, input.requestId, input.supplierId, input.contactId, bam(token), KENH_LINK_PASSPORT, ttl, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("Câu INSERT token Passport không trả về hàng nào");

  const soLinkThuHoi = link.rowCount ?? 0;
  const soPhienThuHoi = phien.rowCount ?? 0;
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "PASSPORT_TOKEN_ISSUED",
    resourceType: "supplier_passport_token",
    resourceId: hang.id,
    payload: { requestId: input.requestId, supplierId: input.supplierId, soLinkThuHoi, soPhienThuHoi },
  });
  return { tokenId: hang.id, token, expiresAt: hang.expires_at, linkChannel: KENH_LINK_PASSPORT, soLinkThuHoi, soPhienThuHoi };
}

/**
 * Phần bù của lần gửi link hỏng SAU commit — khuôn ADR-110: thu hồi token vừa đúc, không thu hồi yêu cầu; link chưa tới nơi
 * không được sống bảy ngày (lượt soi L14). Trả `false` khi token đã được dùng hay thu hồi (không ghi sổ).
 */
export async function thuHoiTokenPassport(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly tokenId: string; readonly actorSessionId: string; readonly reason: "LINK_SEND_FAILED" },
): Promise<boolean> {
  await assertTenantBound(client, orgId, "thuHoiTokenPassport");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const { rows } = await client.query<{ supplier_id: string }>(
    "UPDATE public.supplier_passport_tokens SET revoked_at = pg_catalog.now() " +
      " WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND revoked_at IS NULL AND consumed_at IS NULL " +
      " RETURNING supplier_id",
    [input.tokenId],
  );
  const hang = rows[0];
  if (hang === undefined) return false;
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "PASSPORT_TOKEN_REVOKED",
    resourceType: "supplier_passport_token",
    resourceId: input.tokenId,
    payload: { supplierId: hang.supplier_id, reason: input.reason },
  });
  return true;
}

/** Kết quả đổi link Passport — KHÔNG phải một phiên, không mở được gì. */
export interface LinkPassportDaDoi {
  readonly linkChannel: Channel;
  /** Kênh OTP khả dụng: mọi kênh KHÁC LỚP ĐÍCH với kênh của link — tính từ kênh, không từ dữ liệu người liên hệ (không oracle). */
  readonly otpChannels: readonly Channel[];
}

export async function redeemPassportLink(client: pg.PoolClient, orgId: string, token: string): Promise<LinkPassportDaDoi> {
  await assertTenantBound(client, orgId, "redeemPassportLink");
  const t = await docTokenPassport(client, token);
  return { linkChannel: t.link_channel, otpChannels: CHANNELS.filter((c) => lopDich(c) !== lopDich(t.link_channel)) };
}

export type PassportOtpOutcome =
  | { readonly ok: true; readonly challengeId: string; readonly code: string; readonly destination: string }
  | { readonly ok: false; readonly reason: "DEST_RATE_LIMITED"; readonly retryAfterSeconds: number };

/**
 * Phát OTP Passport. Khuôn `issueOtpChallenge`: đích ĐỌC TỪ `supplier_contacts` theo kênh; bốn bucket tăng TRƯỚC mọi phán quyết
 * (khoản 35) — người gọi, NHÀ CUNG CẤP, (nhà cung cấp, đích), đích toàn tổ chức; mã băm có pepper (ADR-018). Người gọi là handler
 * gửi (ADR-015 ⑶); mã không về client.
 */
export async function issuePassportOtp(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly token: string; readonly channel: Channel; readonly callerFingerprint: string; readonly pepper: PepperRing },
): Promise<PassportOtpOutcome> {
  await assertTenantBound(client, orgId, "issuePassportOtp");
  const t = await docTokenPassport(client, input.token);
  if (lopDich(input.channel) === lopDich(t.link_channel)) {
    throw new InvitationError("OTP không được tới cùng lớp đích với link (ADR-015)");
  }
  const cot = input.channel === "EMAIL" ? "email" : "phone";
  const { rows: lh } = await client.query<{ dich: string | null }>(
    `SELECT ${cot} AS dich FROM public.supplier_contacts WHERE id OPERATOR(pg_catalog.=) $1`,
    [t.contact_id],
  );
  const dich = lh[0]?.dich ?? null;
  if (dich === null || dich.length === 0) {
    throw new InvitationError("người liên hệ chưa có kênh đã đăng ký cho loại kênh này");
  }

  const soLanNguoiGoi = await demVaTang(client, orgId, "CALLER", input.callerFingerprint, input.pepper);
  const soLanNhaCungCap = await demVaTang(client, orgId, "PASSPORT", t.supplier_id, input.pepper);
  const soLanDich = await demVaTang(client, orgId, "DEST", `PASSPORT:${t.supplier_id}:${dich}`, input.pepper);
  const soLanDichChung = await demVaTang(client, orgId, "DEST_ORG", dich, input.pepper);
  if (soLanNguoiGoi > OTP_MAX_PER_CALLER) throw new InvitationError("vượt giới hạn tần suất theo người gọi");
  if (soLanNhaCungCap > OTP_MAX_PER_PASSPORT) throw new InvitationError("vượt giới hạn tần suất theo hồ sơ");
  if (soLanDich > OTP_MAX_PER_DEST || soLanDichChung > OTP_MAX_PER_DEST_TOAN_TO_CHUC) {
    return { ok: false, reason: "DEST_RATE_LIMITED", retryAfterSeconds: OTP_RATE_WINDOW_SECONDS };
  }

  const code = sinhMaOtp();
  const bamMa = input.pepper.bam("PASSPORT", t.token_id, code);
  const bamDich = input.pepper.bam(orgId, "DEST", dich);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.passport_otp_challenges
       (org_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $8)) RETURNING id`,
    [orgId, t.token_id, t.contact_id, input.channel, bamMa.hash, bamDich.hash, bamMa.version, OTP_TTL_SECONDS],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("Câu INSERT thách thức OTP Passport không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: t.contact_id,
    action: "PASSPORT_OTP_ISSUED",
    resourceType: "passport_otp_challenge",
    resourceId: hang.id,
    payload: { supplierId: t.supplier_id, channel: input.channel },
  });
  return { ok: true, challengeId: hang.id, code, destination: dich };
}

export type PassportOtpDenial = "NO_CHALLENGE" | "EXPIRED" | "ALREADY_USED" | "LOCKED_OUT" | "WRONG_CODE";

export type PassportVerifyResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly sessionToken: string;
      readonly supplierId: string;
      readonly contactId: string;
      readonly verifiedChannel: Channel;
    }
  | { readonly ok: false; readonly reason: PassportOtpDenial };

/**
 * Đối chiếu OTP và — CHỈ KHI ĐÚNG — mở một phiên Passport. Hàm DUY NHẤT sinh `passport_sessions`. Khuôn
 * `verifyOtpAndStartSession`: `FOR UPDATE` cộng biểu thức tự tham chiếu (H4), `rowCount` ở cả đường đếm lẫn đường tiêu thụ
 * (MED-2), token tiêu thụ cùng lượt (H5) — và câu tiêu thụ đòi thêm `revoked_at IS NULL` cùng hạn theo `clock_timestamp()`: một
 * lần thu hồi commit giữa lúc đọc token và lúc tiêu thụ thì không phiên nào ra (lượt soi L8). Trigger `passport_phien_kiem_danh_tinh`
 * đọc lại token `FOR SHARE` làm lớp cuối.
 */
export async function verifyPassportOtpAndStartSession(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly token: string; readonly code: string; readonly pepper: PepperRing; readonly ttlSeconds?: number },
): Promise<PassportVerifyResult> {
  await assertTenantBound(client, orgId, "verifyPassportOtpAndStartSession");
  await batBuocTrongGiaoDich(client, "verifyPassportOtpAndStartSession");
  const ttl = tranTtl(input.ttlSeconds, PASSPORT_SESSION_MAC_DINH_GIAY, PASSPORT_SESSION_MAX_TTL_SECONDS, "ttlSeconds");
  const t = await docTokenPassport(client, input.token);

  const { rows } = await client.query<{
    id: string;
    code_hash: Buffer;
    pepper_version: string;
    contact_id: string;
    channel: Channel;
    het_han: boolean;
    da_dung: boolean;
    dang_khoa: boolean;
  }>(
    `SELECT id, code_hash, pepper_version, contact_id, channel,
            (expires_at OPERATOR(pg_catalog.<=) pg_catalog.now()) AS het_han,
            (consumed_at IS NOT NULL) AS da_dung,
            (locked_until IS NOT NULL AND locked_until OPERATOR(pg_catalog.>) pg_catalog.now()) AS dang_khoa
       FROM public.passport_otp_challenges
      WHERE token_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
      ORDER BY created_at DESC
      LIMIT 1
        FOR UPDATE`,
    [t.token_id],
  );
  const tt = rows[0];
  if (tt === undefined) return { ok: false, reason: "NO_CHALLENGE" };
  if (tt.dang_khoa) return { ok: false, reason: "LOCKED_OUT" };
  if (tt.da_dung) return { ok: false, reason: "ALREADY_USED" };
  if (tt.het_han) return { ok: false, reason: "EXPIRED" };

  const dung = timingSafeEqual(tt.code_hash, input.pepper.bamTheoPhienBan(tt.pepper_version, "PASSPORT", t.token_id, input.code));
  if (!dung) {
    const { rows: sau } = await client.query<{ locked_until: Date | null }>(
      `UPDATE public.passport_otp_challenges c
          SET failed_attempts = c.failed_attempts OPERATOR(pg_catalog.+) 1,
              locked_until = CASE WHEN (c.failed_attempts OPERATOR(pg_catalog.+) 1) OPERATOR(pg_catalog.>=) $2::pg_catalog.int4
                                  THEN (pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $3::pg_catalog.float8))
                                  ELSE c.locked_until END
        WHERE c.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        RETURNING c.locked_until`,
      [tt.id, OTP_MAX_FAILED_ATTEMPTS, OTP_LOCKOUT_SECONDS],
    );
    // [MED-2] Một lần thử KHÔNG ĐẾM ĐƯỢC phải TỪ CHỐI, không rơi xuống `WRONG_CODE`.
    if (sau.length !== 1) throw new InvitationError("không ghi nhận được lần thử OTP — từ chối thay vì bỏ qua phép đếm (E3)");
    return { ok: false, reason: sau[0]?.locked_until != null ? "LOCKED_OUT" : "WRONG_CODE" };
  }

  const danhDau = await client.query(
    "UPDATE public.passport_otp_challenges SET consumed_at = pg_catalog.now() " +
      "WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND consumed_at IS NULL",
    [tt.id],
  );
  if (danhDau.rowCount !== 1) return { ok: false, reason: "ALREADY_USED" };
  const tieuThu = await client.query(
    "UPDATE public.supplier_passport_tokens SET consumed_at = pg_catalog.now() " +
      "WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND consumed_at IS NULL AND revoked_at IS NULL " +
      "  AND expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()",
    [t.token_id],
  );
  if (tieuThu.rowCount !== 1) return { ok: false, reason: "ALREADY_USED" };

  const sessionToken = randomBytes(32).toString("base64url");
  const phien = await client.query<{ id: string }>(
    `INSERT INTO public.passport_sessions (org_id, supplier_id, contact_id, challenge_id, token_hash, verified_channel, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $7::pg_catalog.float8))
     RETURNING id`,
    [orgId, t.supplier_id, tt.contact_id, tt.id, bam(sessionToken), tt.channel, ttl],
  );
  const hangPhien = phien.rows[0];
  if (hangPhien === undefined) throw new InvitationError("Câu INSERT passport_sessions không trả về hàng");

  // Sổ và bảng phiên kể CÙNG một câu chuyện: actor là người liên hệ ĐÃ GIỮ KÊNH (E5 — người giữ kênh, không phải con người).
  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: tt.contact_id,
    action: "PASSPORT_SESSION_STARTED",
    resourceType: "passport_session",
    resourceId: hangPhien.id,
    payload: { supplierId: t.supplier_id, challengeId: tt.id, verifiedChannel: tt.channel },
  });
  return {
    ok: true,
    sessionId: hangPhien.id,
    sessionToken,
    supplierId: t.supplier_id,
    contactId: tt.contact_id,
    verifiedChannel: tt.channel,
  };
}

/** Bối cảnh của một phiên Passport — DẪN XUẤT ở bước tra cookie, trên kết nối CHỈ gắn tổ chức (`suppliers` đóng với phiên khách). */
export interface ResolvedPassportSession {
  readonly passportSessionId: string;
  readonly supplierId: string;
  readonly contactId: string;
  readonly supplierLegalName: string;
  readonly supplierTaxCode: string | null;
}

export async function resolvePassportSessionByToken(
  client: pg.PoolClient,
  orgId: string,
  sessionToken: string,
): Promise<ResolvedPassportSession> {
  await assertTenantBound(client, orgId, "resolvePassportSessionByToken");
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(sessionToken)) {
    throw new InvitationError("phiên Passport không hợp lệ, đã hết hạn, hoặc đã bị thu hồi");
  }
  const { rows } = await client.query<{ id: string; supplier_id: string; contact_id: string; legal_name: string; tax_code: string | null }>(
    `SELECT p.id, p.supplier_id, p.contact_id, s.legal_name, s.tax_code
       FROM public.passport_sessions p
       JOIN public.suppliers s ON s.id OPERATOR(pg_catalog.=) p.supplier_id AND s.org_id OPERATOR(pg_catalog.=) p.org_id
      WHERE p.token_hash OPERATOR(pg_catalog.=) $1::pg_catalog.bytea
        AND p.revoked_at IS NULL
        AND p.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()`,
    [bam(sessionToken)],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("phiên Passport không hợp lệ, đã hết hạn, hoặc đã bị thu hồi");
  return {
    passportSessionId: hang.id,
    supplierId: hang.supplier_id,
    contactId: hang.contact_id,
    supplierLegalName: hang.legal_name,
    supplierTaxCode: hang.tax_code,
  };
}

/**
 * Nhà cung cấp tự thoát phiên Passport — khuôn `revokeGuestSession` (ADR-109): chạm đúng một hàng phiên, dẫn xuất từ cookie; hàng
 * sổ chỉ khi câu UPDATE thật sự đổi một hàng. Chạy dưới kết nối CHỈ gắn tổ chức (đường ghi).
 */
export async function revokePassportSession(client: pg.PoolClient, orgId: string, passportSessionId: string): Promise<boolean> {
  await assertTenantBound(client, orgId, "revokePassportSession");
  const { rows } = await client.query<{ supplier_id: string; contact_id: string }>(
    "UPDATE public.passport_sessions SET revoked_at = pg_catalog.now() " +
      " WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND revoked_at IS NULL " +
      " RETURNING supplier_id, contact_id",
    [passportSessionId],
  );
  const hang = rows[0];
  if (hang === undefined) return false;
  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: hang.contact_id,
    action: "PASSPORT_SESSION_REVOKED",
    resourceType: "passport_session",
    resourceId: passportSessionId,
    payload: { supplierId: hang.supplier_id },
  });
  return true;
}
