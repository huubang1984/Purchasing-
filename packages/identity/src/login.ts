// ==============================================================================================
// [ADR-020 mục 2 / S1.10.4] ĐĂNG NHẬP NGƯỜI MUA — nửa PHÁT của khoản nợ 6
//
// Bốn bước, bốn hàm, mỗi hàm một giao dịch của người gọi:
//   issueLoginToken     email → token đăng nhập (băm xuống bảng, dạng rõ đi tới BỘ GỬI, không về client)
//   redeemLoginToken    token → người dùng + đã có TOTP chưa (KHÔNG mở phiên — E2 cho người mua)
//   verifyTotpForLogin  mã TOTP → kết quả; và trả nợ ADR-008 phương án (ii): `justLocked` ⇒ MFA_LOCKED
//   startUserSession    tiêu thụ token + chèn phiên ĐÃ MFA trong CÙNG giao dịch → token phiên
//   revokeSession       đăng xuất
//
// Ba kỷ luật kế thừa nguyên vẹn từ `packages/invitation`:
//   • mọi ca hỏng của một bước ném CÙNG MỘT thông điệp (không oracle trên tập người dùng/token);
//   • token dạng rõ chỉ tồn tại trong bộ nhớ của lượt gọi, CSDL chỉ giữ băm (E1);
//   • không có tham số nào là lời khai danh tính: `userId` ở các bước sau DẪN XUẤT từ token.
// ==============================================================================================

import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { verifyTotpAttempt, type MfaAttemptResult, type TotpSecretUnsealer, type WrappedTotpSecret } from "./mfa-credentials.js";

export const LOGIN_TOKEN_BYTES = 32;
export const LOGIN_TOKEN_TTL_SECONDS = 15 * 60;
/** Tối đa bấy nhiêu token đăng nhập được phát cho MỘT người dùng trong một cửa sổ. */
export const LOGIN_MAX_TOKENS_PER_WINDOW = 5;
export const LOGIN_RATE_WINDOW_SECONDS = 15 * 60;
export const USER_SESSION_DEFAULT_TTL_SECONDS = 8 * 3600;
export const USER_SESSION_MAX_TTL_SECONDS = 24 * 3600;

export class LoginTokenError extends Error {
  constructor() {
    super("token đăng nhập không hợp lệ, đã hết hạn, hoặc đã dùng");
    this.name = "LoginTokenError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/u;

function bam(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export type IssueLoginTokenOutcome =
  | { readonly ok: true; readonly userId: string; readonly token: string; readonly email: string }
  | { readonly ok: false; readonly reason: "NO_USER" | "RATE_LIMITED" };

/**
 * Phát một token đăng nhập cho địa chỉ email. KHÔNG ném khi không có người dùng — người gọi (route
 * `/auth/link`) phải trả về CÙNG một phản hồi cho mọi email, và cách chắc nhất để nó làm đúng là
 * hàm này không cho nó một ngoại lệ để mà lỡ tay phân biệt.
 */
export async function issueLoginToken(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly email: string; readonly ttlSeconds?: number },
): Promise<IssueLoginTokenOutcome> {
  await assertTenantBound(client, orgId, "issueLoginToken");
  const email = input.email.trim().toLowerCase();
  if (email === "" || email.length > 320) return { ok: false, reason: "NO_USER" };
  const ttl = Math.min(Math.max(input.ttlSeconds ?? LOGIN_TOKEN_TTL_SECONDS, 60), LOGIN_TOKEN_TTL_SECONDS);

  // [review lượt 14, H14-6] ĐỌC CẢ `email` CỦA HÀNG, và trả về CHÍNH NÓ ở cuối hàm — không trả
  // lại chuỗi người gọi gửi lên.
  //
  // Hỏng như thế nào nếu trả chuỗi người gọi: ràng buộc duy nhất của `users` là
  // `UNIQUE (org_id, email)` — so NGUYÊN VĂN (`db/migrations/002_organizations_and_users.sql`),
  // không có chỉ mục nào trên `lower(email)`. Nên một tổ chức CÓ THỂ mang đồng thời
  // `Alice@corp.com` và `alice@corp.com`; câu dưới khớp CẢ HAI, `rows[0]` là hàng nào thì không
  // xác định, và `apps/api/src/outbox-api.ts` gửi magic link tới **chuỗi người gọi gửi lên**. Đó
  // là chiếm tài khoản: xin link cho `alice@corp.com`, nhận token của `Alice@corp.com`.
  //
  // Trả `u.email` làm link LUÔN đi tới địa chỉ ĐÃ ĐĂNG KÝ của chính chủ token — hàng nào được
  // chọn thì link đi tới hộp thư của hàng ấy. Phần chênh còn lại (một lời xin có thể trả link cho
  // hàng biến thể hoa-thường khác) là khoản nợ 63: nó cần một chỉ mục
  // `UNIQUE (org_id, lower(email))`, tức một migration và một lượt đối chiếu dữ liệu.
  const { rows } = await client.query<{ id: string; status: string; email: string }>(
    "SELECT id, status, email FROM public.users " +
      "WHERE pg_catalog.lower(email) OPERATOR(pg_catalog.=) $1",
    [email],
  );
  const u = rows[0];
  if (u === undefined || u.status !== "ACTIVE") return { ok: false, reason: "NO_USER" };

  // Hạn mức theo NGƯỜI DÙNG, đếm trên chính bảng token — không bucket, không pepper: cái được đếm
  // là hàng của chính người ấy, không phải một đích do người gọi chọn.
  // Ngoặc quanh phép trừ là BẮT BUỘC: mọi `OPERATOR(pg_catalog.x)` có CÙNG độ ưu tiên và kết hợp trái,
  // nên `a > b - c` viết bằng OPERATOR() thành `(a > b) - c` — đo được: `boolean - interval` (42883).
  const { rows: dem } = await client.query<{ n: string }>(
    `SELECT pg_catalog.count(*) AS n FROM public.user_login_tokens
      WHERE user_id OPERATOR(pg_catalog.=) $1
        AND created_at OPERATOR(pg_catalog.>)
            (pg_catalog.now() OPERATOR(pg_catalog.-) pg_catalog.make_interval(secs => $2::pg_catalog.float8))`,
    [u.id, LOGIN_RATE_WINDOW_SECONDS],
  );
  if (Number(dem[0]?.n ?? 0) >= LOGIN_MAX_TOKENS_PER_WINDOW) return { ok: false, reason: "RATE_LIMITED" };

  const token = randomBytes(LOGIN_TOKEN_BYTES).toString("base64url");
  await client.query(
    `INSERT INTO public.user_login_tokens (org_id, user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, 'LOGIN', (pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $4::pg_catalog.float8)))`,
    [orgId, u.id, bam(token), ttl],
  );
  return { ok: true, userId: u.id, token, email: u.email };
}

export interface RedeemedLoginToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly email: string;
  /**
   * Đã có hồ sơ TOTP ĐÃ XÁC NHẬN chưa — quyết định client phải ghi danh trước hay nhập mã ngay.
   * [review M-5] "Đã xác nhận" = `confirmed_at IS NOT NULL`, tức đã có một lần TOTP đúng: một hồ sơ
   * chèn bởi ai đó đọc trộm hộp thư nhưng chưa từng chứng minh cầm bí mật KHÔNG khoá được người thật.
   */
  readonly hasTotp: boolean;
}

/** Đọc người dùng đứng sau một token còn hiệu lực. KHÔNG tiêu thụ, KHÔNG mở phiên. */
export async function redeemLoginToken(
  client: pg.PoolClient,
  orgId: string,
  token: string,
): Promise<RedeemedLoginToken> {
  await assertTenantBound(client, orgId, "redeemLoginToken");
  if (!TOKEN_RE.test(token)) throw new LoginTokenError();
  const { rows } = await client.query<{ token_id: string; user_id: string; email: string; has_totp: boolean }>(
    `SELECT t.id AS token_id, u.id AS user_id, u.email,
            EXISTS (SELECT 1 FROM public.mfa_credentials m
                     WHERE m.user_id OPERATOR(pg_catalog.=) u.id AND m.kind OPERATOR(pg_catalog.=) 'TOTP'
                       AND m.confirmed_at IS NOT NULL) AS has_totp
       FROM public.user_login_tokens t
       JOIN public.users u ON u.id OPERATOR(pg_catalog.=) t.user_id
      WHERE t.token_hash OPERATOR(pg_catalog.=) $1::pg_catalog.bytea
        AND t.purpose OPERATOR(pg_catalog.=) 'LOGIN'
        AND t.consumed_at IS NULL
        AND t.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()
        AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'`,
    [bam(token)],
  );
  const h = rows[0];
  if (h === undefined) throw new LoginTokenError();
  return { tokenId: h.token_id, userId: h.user_id, email: h.email, hasTotp: h.has_totp };
}

/**
 * Kiểm mã TOTP cho một lần đăng nhập — và TRẢ NỢ ADR-008 bằng phương án (ii): khi hồ sơ VỪA bị
 * khoá (`justLocked`), ghi đúng MỘT bản ghi `MFA_LOCKED`. Tần suất của sự kiện này bị chặn trên
 * `1 / MFA_LOCKOUT_SECONDS` mỗi hồ sơ nên lập luận DoS của ADR-008 không áp dụng; và nó là bản
 * ghi có CHIỀU THỜI GIAN mà `failed_attempts` (một trạng thái bị đặt về 0 khi thành công) không
 * cho được — đúng ba khiếm khuyết ADR-008 liệt kê.
 */
/**
 * [review M-4] BẰNG CHỨNG một lần TOTP đúng. Chỉ `verifyTotpForLogin` tạo được (constructor riêng
 * tư, không export lớp), và `startUserSession` ĐÒI nó — nên "mở phiên mà quên TOTP" là câu KHÔNG
 * BIÊN DỊCH ĐƯỢC, không phải một thứ tự ba dòng phải nhớ. Vế CSDL của cùng khiếm khuyết (trigger
 * đòi bộ đếm TOTP gần đây) cố ý chưa làm — sổ nợ 43, lý do ở đầu migration 031.
 */
let taoMfaProof!: (orgId: string, userId: string, counter: number) => MfaProof;
export class MfaProof {
  private constructor(
    readonly orgId: string,
    readonly userId: string,
    readonly counter: number,
  ) {}
  // [review H2-5] Bản trước có `static _tao(...)` công khai (chỉ ghi `@internal`) và barrel xuất lớp
  // dưới dạng GIÁ TRỊ — `MfaProof._tao(orgId, userId, 0)` biên dịch sạch từ apps/api. Nay lớp chỉ
  // xuất dưới dạng KIỂU, và đường tạo là một hàm KHÔNG export của module này.
  static {
    taoMfaProof = (orgId, userId, counter) => new MfaProof(orgId, userId, counter);
  }
}

export type LoginTotpResult =
  | { readonly ok: true; readonly proof: MfaProof }
  | Extract<MfaAttemptResult, { readonly ok: false }>;

export async function verifyTotpForLogin(
  client: pg.PoolClient,
  input: { readonly orgId: string; readonly userId: string; readonly code: string },
  unsealer: TotpSecretUnsealer,
): Promise<LoginTotpResult> {
  const kq = await verifyTotpAttempt(client, input, unsealer);
  if (kq.ok) return { ok: true, proof: taoMfaProof(input.orgId, input.userId, kq.counter) };
  if (kq.justLocked) {
    await appendAuditEvent(client, input.orgId, {
      actorType: "USER",
      actorId: input.userId,
      action: "MFA_LOCKED",
      resourceType: "MFA_CREDENTIAL",
      payload: { lockedUntil: kq.lockedUntil?.toISOString() ?? null },
    });
  }
  return kq;
}

/**
 * [review M-5] Ghi danh TOTP lúc đăng nhập — hoặc THAY bí mật của một hồ sơ CHƯA XÁC NHẬN. Hồ sơ đã
 * xác nhận (đã có một lần TOTP đúng) KHÔNG thay được ở đây: `rowCount = 0` ⇒ ném. Mọi lần ghi danh
 * để lại `MFA_ENROLLED` trong sổ (kèm IP) — trước đó việc này KHÔNG có dấu vết nào.
 */
export async function enrollOrReplaceTotpForLogin(
  client: pg.PoolClient,
  input: { readonly orgId: string; readonly userId: string; readonly wrapped: WrappedTotpSecret; readonly ip: string | null },
): Promise<{ readonly replaced: boolean }> {
  await assertTenantBound(client, input.orgId, "enrollOrReplaceTotpForLogin");
  if (!UUID_RE.test(input.userId)) throw new LoginTokenError();
  const { rows } = await client.query<{ replaced: boolean }>(
    `INSERT INTO public.mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version)
     VALUES ($1, $2, 'TOTP', $3, $4)
     ON CONFLICT (org_id, user_id, kind) DO UPDATE
       SET secret_wrapped = EXCLUDED.secret_wrapped,
           secret_key_version = EXCLUDED.secret_key_version
       WHERE public.mfa_credentials.confirmed_at IS NULL
     RETURNING (xmax OPERATOR(pg_catalog.<>) 0) AS replaced`,
    [input.orgId, input.userId, Buffer.from(input.wrapped.ciphertext), input.wrapped.keyVersion],
  );
  const h = rows[0];
  if (h === undefined) throw new LoginTokenError();
  await appendAuditEvent(client, input.orgId, {
    actorType: "USER",
    actorId: input.userId,
    action: "MFA_ENROLLED",
    resourceType: "MFA_CREDENTIAL",
    payload: { keyVersion: input.wrapped.keyVersion, replaced: h.replaced },
    ip: input.ip,
  });
  return { replaced: h.replaced };
}

export interface StartedUserSession {
  readonly sessionId: string;
  /** Token phiên dạng rõ — đi vào cookie, KHÔNG BAO GIỜ vào thân phản hồi hay log. */
  readonly token: string;
  readonly expiresInSeconds: number;
}

/**
 * Tiêu thụ token đăng nhập và chèn phiên ĐÃ MFA — trong CÙNG giao dịch của người gọi, ngay sau
 * `verifyTotpForLogin` thành công. Trigger 029 từ chối một hàng thiếu `mfa_verified_at` do
 * `app_api` chèn, nên hàm này không có cách nào tạo ra một phiên nửa chừng dù có viết sai.
 */
export async function startUserSession(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly tokenId: string;
    readonly userId: string;
    /** [review M-4] Bằng chứng TOTP — chỉ `verifyTotpForLogin` tạo được; phải là của ĐÚNG người này. */
    readonly mfaProof: MfaProof;
    readonly ttlSeconds?: number;
    readonly ip?: string | null;
    readonly userAgent?: string | null;
  },
): Promise<StartedUserSession> {
  await assertTenantBound(client, orgId, "startUserSession");
  if (!UUID_RE.test(input.tokenId) || !UUID_RE.test(input.userId)) throw new LoginTokenError();
  if (!(input.mfaProof instanceof MfaProof) || input.mfaProof.userId !== input.userId || input.mfaProof.orgId !== orgId) {
    throw new LoginTokenError();
  }
  const ttl = Math.min(Math.max(input.ttlSeconds ?? USER_SESSION_DEFAULT_TTL_SECONDS, 60), USER_SESSION_MAX_TTL_SECONDS);

  // Tiêu thụ TRƯỚC, và đòi đúng một hàng: hai lượt song song với cùng token thì đúng một lượt
  // qua — vế `consumed_at IS NULL` là khoá, không phải phép kiểm.
  const tieuThu = await client.query(
    `UPDATE public.user_login_tokens SET consumed_at = pg_catalog.now()
      WHERE id OPERATOR(pg_catalog.=) $1 AND user_id OPERATOR(pg_catalog.=) $2
        AND consumed_at IS NULL AND expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()`,
    [input.tokenId, input.userId],
  );
  if (tieuThu.rowCount !== 1) throw new LoginTokenError();

  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, ip, user_agent)
     VALUES ($1, $2, $3, (pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $4::pg_catalog.float8)),
             pg_catalog.now(), $5::pg_catalog.inet, $6)
     RETURNING id`,
    [orgId, input.userId, bam(token), ttl, input.ip ?? null, input.userAgent?.slice(0, 512) ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("startUserSession: INSERT sessions không trả về hàng");
  return { sessionId: id, token, expiresInSeconds: ttl };
}

/** Đăng xuất: thu hồi phiên. Idempotent — thu hồi lần hai không đổi gì và không ném. */
export async function revokeSession(client: pg.PoolClient, orgId: string, sessionId: string): Promise<void> {
  await assertTenantBound(client, orgId, "revokeSession");
  if (!UUID_RE.test(sessionId)) return;
  await client.query(
    "UPDATE public.sessions SET revoked_at = pg_catalog.now() WHERE id OPERATOR(pg_catalog.=) $1 AND revoked_at IS NULL",
    [sessionId],
  );
}
