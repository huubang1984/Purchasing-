// ==============================================================================================
// [ADR-020 mục 2 / S1.10.4] ĐĂNG NHẬP NGƯỜI MUA — nửa PHÁT của khoản nợ 6
//
// ~~Bốn bước, bốn hàm~~ [S1.79 / lượt soi ngang 72] BẢY hàm, mỗi hàm một giao dịch của người gọi.
// Khối này khai "bốn" rồi liệt NĂM tên, còn hai hàm thêm sau thì không ai thêm vào danh sách:
// `enrollOrReplaceTotpForLogin` (S1.10.7) và `startAgentSession` (S1.76 / khoản 141). Một khối mở
// đầu liệt kê thiếu không làm test nào đỏ — nó chỉ làm người đọc tin rằng tệp này nhỏ hơn thật.
//   issueLoginToken     email → token đăng nhập (băm xuống bảng, dạng rõ đi tới BỘ GỬI, không về client)
//   redeemLoginToken    token → người dùng + đã có TOTP chưa (KHÔNG mở phiên — E2 cho người mua)
//   verifyTotpForLogin  mã TOTP → kết quả; và trả nợ ADR-008 phương án (ii): `justLocked` ⇒ MFA_LOCKED
//                       — [S1.75 / khoản 139] trừ khi khoá ghi sổ của tổ chức bị giữ: lần ghi bị bỏ
//                       trong một SAVEPOINT, hồ sơ VẪN khoá, kết quả mang `auditSkipped`
//   enrollOrReplaceTotpForLogin
//                       ghi danh TOTP, hoặc THAY bí mật của một hồ sơ CHƯA xác nhận; hồ sơ đã xác
//                       nhận thì `rowCount = 0` ⇒ ném. Mỗi lần ghi danh để lại `MFA_ENROLLED` kèm IP
//   startUserSession    tiêu thụ token + chèn phiên ĐÃ MFA trong CÙNG giao dịch → token phiên
//   startAgentSession   [S1.76 / khoản 141] chứng chỉ `AGENT_READONLY` có phạm vi trên hàng phiên,
//                       TTL trần MỘT GIỜ; vẫn đòi một mã TOTP TƯƠI vì trigger 039 bắt buộc thế
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
/**
 * [khoản 141 / ADR-039] Trần TTL của một phiên `AGENT_READONLY` — MỘT GIỜ.
 *
 * Cùng con số mà `sessions_agent_ttl_ngan` (051) ràng ở tầng CSDL; hai lớp, hai lỗi khác nhau.
 * Vì sao không ngắn hơn: bản đầu của vòng này định 15 phút, và lượt soi đối kháng Đ-3 đo ra rằng
 * 15 phút không dùng được — `expires_at` không có `GRANT UPDATE` nên gia hạn là bất khả, còn phát
 * một phiên mới đòi một magic link MỚI cộng một mã TOTP tươi trong ±90 giây (trigger của 039),
 * tức một con người gõ TOTP bốn lần mỗi giờ và đụng `LOGIN_MAX_TOKENS_PER_WINDOW`. Một chế độ
 * vận hành không dùng được không phải một lớp an ninh: nó đẩy người vận hành sang cắm cookie 8
 * giờ của chính mình vào biến môi trường — đúng thứ khoản 141 sinh ra để chặn.
 */
export const AGENT_SESSION_MAX_TTL_SECONDS = 3600;

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
  // [khoản nợ 63 / S1.27] KHÔNG hạ chữ thường ở đây, và đó là toàn bộ bản vá — xem khối chú
  // thích ngay trên câu truy vấn bên dưới. Hai tầng từng mỗi tầng dùng MỘT hàm hạ chữ thường
  // riêng, và hai hàm ấy LỆCH NHAU.
  const email = input.email.trim();
  if (email === "" || email.length > 320) return { ok: false, reason: "NO_USER" };
  const ttl = Math.min(Math.max(input.ttlSeconds ?? LOGIN_TOKEN_TTL_SECONDS, 60), LOGIN_TOKEN_TTL_SECONDS);

  // [review lượt 14, H14-6] ĐỌC CẢ `email` CỦA HÀNG, và trả về CHÍNH NÓ ở cuối hàm — không trả
  // lại chuỗi người gọi gửi lên.
  //
  // Hỏng như thế nào nếu trả chuỗi người gọi: ràng buộc duy nhất của `users` là
  // `UNIQUE (org_id, email)` — so NGUYÊN VĂN (`db/migrations/002_organizations_and_users.sql`),
  // ~~không có chỉ mục nào trên `lower(email)`. Nên một tổ chức CÓ THỂ mang đồng thời
  // `Alice@corp.com` và `alice@corp.com`;~~ câu dưới khớp CẢ HAI, `rows[0]` là hàng nào thì không
  // xác định, và `apps/api/src/outbox-api.ts` gửi magic link tới **chuỗi người gọi gửi lên**. Đó
  // là chiếm tài khoản: xin link cho `alice@corp.com`, nhận token của `Alice@corp.com`.
  //
  // Trả `u.email` làm link LUÔN đi tới địa chỉ ĐÃ ĐĂNG KÝ của chính chủ token — hàng nào được
  // chọn thì link đi tới hộp thư của hàng ấy. ~~Phần chênh còn lại (một lời xin có thể trả link
  // cho hàng biến thể hoa-thường khác) là khoản nợ 63: nó cần một chỉ mục
  // `UNIQUE (org_id, lower(email))`, tức một migration và một lượt đối chiếu dữ liệu.~~
  //
  // **[S1.27] KHOẢN NỢ 63 ĐÓNG, VÀ KHÔNG BẰNG CHỈ MỤC ẤY.** `048` thêm
  // `CHECK (email = lower(email))` cho `users`, nên một email có chữ hoa KHÔNG CẤT ĐƯỢC — cặp
  // biến thể vì thế không dựng lên được nữa, và ca `Alice@corp.com` đứng một mình (thứ một chỉ
  // mục trên `lower(email)` vẫn CHO QUA) cũng đóng theo. Đo cạnh nhau ở chú thích của `048`.
  //
  // `pg_catalog.lower(...)` bọc CẢ HAI VẾ, và đó là toàn bộ bản vá. Trước vòng này, vế trái đi
  // qua `lower()` của PostgreSQL còn vế phải là chuỗi đã được `.toLowerCase()` của JS hạ — HAI
  // HÀM KHÁC NHAU. Đo được trên `postgres:16-alpine` + Node 24: JS hạ 1488 điểm mã, máy chủ hạ
  // 1364; phần chênh là điểm BẤT ĐỘNG với máy chủ (nên qua được `CHECK` của `048`) mà JS vẫn hạ,
  // ví dụ `U+24B6` (Ⓐ) và `U+1C8A` (Ᲊ). Với một địa chỉ như thế, câu này trả **0 hàng** và người
  // dùng KHÔNG BAO GIỜ nhận được magic link — im lặng, vì `/auth/link` luôn trả cùng một 200.
  // Có mốc chết: `apps/api/src/auth.int.test.ts`, test `[sổ nợ 63]`, tự tìm điểm mã phân kỳ lúc
  // chạy thay vì đóng cứng một cái.
  //
  // Nay cả hai vế dùng CÙNG một hàm, nên chúng không lệch được — bất kể libc của máy chủ là gì.
  // Cộng với `CHECK (email = lower(email))` của `048`, vị từ này tương đương `email = lower($1)`,
  // và `UNIQUE (org_id, email)` bảo đảm **nhiều nhất MỘT hàng khớp**: `rows[0]` tất định. Đó mới
  // đúng là điều khoản nợ 63 đòi.
  //
  // ~~Cái giá là câu này không dùng được tiền tố `(org_id, ...)` của chỉ mục duy nhất.~~ **[đã đo
  // lại — gọi sai thứ bị mất]** Tiền tố ấy VẪN được dùng: kế hoạch là Bitmap Index Scan trên
  // `users_org_id_email_key` với `Index Cond: (org_id = ...)`. Thứ mất là cột khoá THỨ HAI —
  // `lower(email)` tụt xuống thành Filter trên heap, nên câu đọc trọn tập hàng CỦA MỘT TỔ CHỨC
  // thay vì một lần tra. Dưới RLS tập ấy nhỏ, nên chi phí không đáng một lần đổi; nhưng nói cho
  // đúng thì đó là mất một cột khoá, không phải mất chỉ mục.
  const { rows } = await client.query<{ id: string; status: string; email: string }>(
    "SELECT id, status, email FROM public.users " +
      "WHERE pg_catalog.lower(email) OPERATOR(pg_catalog.=) pg_catalog.lower($1::pg_catalog.text)",
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
 * Kiểm mã TOTP cho một lần đăng nhập — và TRẢ NỢ ADR-008 bằng phương án (ii).
 *
 * **[S1.75 / khoản 139] LỜI KHAI ĐÚNG HÔM NAY:** khi hồ sơ VỪA bị khoá (`justLocked`), hàm ghi
 * đúng MỘT bản ghi `MFA_LOCKED` — TRỪ khi khoá tư vấn ghi sổ của tổ chức bị giữ quá trần 2 s (050)
 * ở đúng lần chạm ngưỡng. Khi ấy lần ghi bị BỎ trong một SAVEPOINT, **khoá hồ sơ vẫn đứng**, và
 * kết quả mang `auditSkipped` để tầng app ghi lại cái thiếu. Nguyên văn cũ, giữ để đối chiếu:
 * ~~khi hồ sơ VỪA bị khoá (`justLocked`), ghi đúng MỘT bản ghi `MFA_LOCKED`~~ — câu ấy đúng cho tới
 * S1.74, và nó SAI theo hướng nguy hiểm: tới S1.73 lần ghi hỏng kéo theo cả khoá hồ sơ (khoản 139).
 *
 * Tần suất của sự kiện này bị chặn trên
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
  | (Extract<MfaAttemptResult, { readonly ok: false }> & {
      /**
       * [khoản nợ 139] Hồ sơ VỪA bị khoá nhưng bản ghi `MFA_LOCKED` KHÔNG vào được sổ, vì khoá tư
       * vấn ghi sổ của tổ chức bị giữ quá trần 2 s của `noi_chuoi_kiem_toan()` (050). Khoá hồ sơ
       * vẫn đứng — đó là toàn bộ lý do khoản 139 đóng được — nhưng sổ THIẾU một dòng.
       *
       * Cờ này tồn tại để cái thiếu ấy KHÔNG im lặng: gói này cố ý không tự ghi ra `console.*`
       * (cùng kỷ luật với `packages/outbox/src/runner.ts`), nên nó BÁO LÊN và người gọi ở tầng app
       * ghi một dòng log. Không có cờ, chỗ này là một lần mất dữ liệu kiểm toán không ai đếm được.
       */
      readonly auditSkipped?: true;
    });

export async function verifyTotpForLogin(
  client: pg.PoolClient,
  input: { readonly orgId: string; readonly userId: string; readonly code: string },
  unsealer: TotpSecretUnsealer,
): Promise<LoginTotpResult> {
  const kq = await verifyTotpAttempt(client, input, unsealer);
  if (kq.ok) return { ok: true, proof: taoMfaProof(input.orgId, input.userId, kq.counter) };
  if (kq.justLocked) {
    // ==========================================================================================
    // [S1.75 / khoản nợ 139] LẦN GHI `MFA_LOCKED` KHÔNG ĐƯỢC KÉO THEO KHOÁ HỒ SƠ KHI NÓ HỎNG.
    //
    // `verifyTotpAttempt` vừa chạy `CAU_DAT_KHOA` — bộ đếm và `locked_until` đã nằm trong giao
    // dịch này. Lần ghi sổ ngay dưới lấy khoá tư vấn ghi sổ của tổ chức qua trigger 004, và từ
    // 050 nó chờ tối đa 2 s rồi gãy 55P03. TRƯỚC vòng này, lỗi ấy ném ra khỏi handler, giao dịch
    // rollback, và nó mang theo CẢ khoá hồ sơ: đo được ba lần đoán sai liên tiếp ở ngưỡng đều
    // không khoá được ai — tức trong cửa sổ ấy số lần đoán TOTP KHÔNG CÒN TRẦN (§S1.73).
    //
    // SAVEPOINT là BẮT BUỘC, không phải trang trí. Một `try/catch` trần không cứu được gì: câu
    // lệnh hỏng đã đưa giao dịch vào trạng thái aborted, mọi câu sau ném 25P02, và COMMIT trên nó
    // trả về command tag ROLLBACK chứ KHÔNG ném — `packages/tenancy/src/with-tenant.ts` ghi đúng
    // hành vi ấy. Hình dạng này đã có tiền lệ sản xuất ở `apps/api/src/routes/auth.ts`
    // (`SAVEPOINT xep_hang`, bắt 23503), và tầng CSDL đã đo rằng nó đúng với CHÍNH lỗi 55P03 này:
    // `db/tran-cho-khoa-ghi-so.int.test.ts` — sau `ROLLBACK TO SAVEPOINT`, `lock_timeout` vẫn là
    // giá trị phiên.
    //
    // CÁI GIÁ, nói thẳng: sổ kiểm toán THIẾU một dòng `MFA_LOCKED` trong đúng cửa sổ ấy. Chủ dự án
    // chọn đánh đổi này ngày 2026-09-17 (ADR-008, tiểu mục [S1.75 / khoản 139]) — ngưỡng khoá MFA
    // có trần quan trọng hơn một dòng sổ, VỚI ĐIỀU KIỆN cái thiếu ấy để lại dấu: xem `auditSkipped`.
    //
    // `catch` HẸP CÓ CHỦ Ý — chỉ 55P03, không 57014. Nếu `statement_timeout` cạn trước trần 2 s thì
    // lỗi là 57014 và câu dưới NÉM LẠI, tức rơi về hành vi cũ; đó là lựa chọn fail-closed, vì nuốt
    // 57014 sẽ nuốt luôn mọi lần huỷ câu chính đáng. Dư lượng ấy ghi ở khoản nợ 143.
    // ==========================================================================================
    await client.query("SAVEPOINT ghi_so_mfa_locked");
    try {
      await appendAuditEvent(client, input.orgId, {
        actorType: "USER",
        actorId: input.userId,
        action: "MFA_LOCKED",
        resourceType: "MFA_CREDENTIAL",
        payload: { lockedUntil: kq.lockedUntil?.toISOString() ?? null },
      });
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "55P03")) throw e;
      await client.query("ROLLBACK TO SAVEPOINT ghi_so_mfa_locked");
      return { ...kq, auditSkipped: true };
    }
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
  // [khoản 141 / ADR-039] Hàm này phát ĐÚNG MỘT loại phiên: phiên của một CON NGƯỜI. Bản đầu của
  // vòng nhận thêm một tham số `kind`, và một lượt đột biến cho thấy nhánh ấy KHÔNG CÓ NGƯỜI GỌI —
  // `startAgentSession` là đường duy nhất phát chứng chỉ agent. Một nhánh không ai đi là một nhánh
  // không ai đo, nên nó bị bỏ chứ không được thêm một test cho có.
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
  // [khoản 141] `kind` được NÊU TÊN tường minh, không dựa vào `DEFAULT 'USER'` của 051: DEFAULT ở
  // đó bảo vệ hàng trăm câu INSERT viết tay trong test, nó KHÔNG bảo vệ sản xuất. Một đường phát
  // quên khai phạm vi mà vẫn chạy được là đúng hình dạng lỗi khoản 141 nói tới.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, ip, user_agent, kind)
     VALUES ($1, $2, $3, (pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $4::pg_catalog.float8)),
             pg_catalog.now(), $5::pg_catalog.inet, $6, 'USER')
     RETURNING id`,
    [orgId, input.userId, bam(token), ttl, input.ip ?? null, input.userAgent?.slice(0, 512) ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("startUserSession: INSERT sessions không trả về hàng");
  return { sessionId: id, token, expiresInSeconds: ttl };
}

// ==============================================================================================
// [khoản 141 / ADR-039] PHÁT MỘT CHỨNG CHỈ AGENT CHO CHÍNH NGƯỜI ĐANG ĐĂNG NHẬP
//
// Khác `startUserSession` ở đúng hai chỗ, và cả hai đều là chỗ nó HẸP HƠN:
//   ⑴ KHÔNG tiêu thụ một `user_login_tokens` nào — người gọi đã có một phiên NGƯỜI còn sống, và
//      `apps/api` đã đòi điều đó bằng `self: true` + `agent: false` trên route. Nên đường này
//      KHÔNG đụng `LOGIN_MAX_TOKENS_PER_WINDOW` và không cần một lượt gửi email nào. Đó chính là
//      thứ làm trần một giờ trở nên dùng được (lượt soi đối kháng Đ-3).
//   ⑵ TTL bị ghim bằng `AGENT_SESSION_MAX_TTL_SECONDS`, không nhận tham số — người gọi không xin
//      dài hơn được.
//
// VẪN ĐÒI MỘT MÃ TOTP TƯƠI, và đó KHÔNG phải một lựa chọn: trigger `sessions_kiem_totp_gan_day`
// (039, `ENABLE ALWAYS`, thân bị hardening ghim) bắt MỌI hàng phiên do `app_api` chèn có
// `mfa_verified_at IS NOT NULL` phải đi sau một lần TOTP đúng trong ±3 bước 30 giây. Mà
// `resolveSessionByToken` lại đòi đúng cột ấy — một phiên `mfa_verified_at NULL` không đăng nhập
// được. Tức "phát chứng chỉ máy một lần rồi để đó" là BẤT KHẢ hôm nay mà không nới thân một
// trigger đang bị ghim; vòng này KHÔNG nới nó. Phát biểu đúng mức: đường này đổi "magic link CỘNG
// TOTP mỗi giờ" thành "MỘT mã TOTP mỗi giờ" — rẻ hơn hẳn, và vẫn là một con người mỗi giờ.
// ==============================================================================================

export interface StartedAgentSession {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresInSeconds: number;
}

export async function startAgentSession(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly userId: string;
    /** Bằng chứng TOTP TƯƠI của CHÍNH người này — cùng hợp đồng `startUserSession`. */
    readonly mfaProof: MfaProof;
    /** Phiên NGƯỜI đã xin chứng chỉ này. Đi vào sổ kiểm toán, không vào hàng phiên. */
    readonly capBoiSessionId: string;
    readonly ip?: string | null;
  },
): Promise<StartedAgentSession> {
  await assertTenantBound(client, orgId, "startAgentSession");
  if (!UUID_RE.test(input.userId) || !UUID_RE.test(input.capBoiSessionId)) throw new LoginTokenError();
  if (!(input.mfaProof instanceof MfaProof) || input.mfaProof.userId !== input.userId || input.mfaProof.orgId !== orgId) {
    throw new LoginTokenError();
  }

  const token = randomBytes(LOGIN_TOKEN_BYTES).toString("base64url");
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, ip, kind)
     VALUES ($1, $2, $3, (pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $4::pg_catalog.float8)),
             pg_catalog.now(), $5::pg_catalog.inet, 'AGENT_READONLY')
     RETURNING id`,
    [orgId, input.userId, bam(token), AGENT_SESSION_MAX_TTL_SECONDS, input.ip ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("startAgentSession: INSERT sessions không trả về hàng");

  // Phát một chứng chỉ máy là một sự kiện đáng có trong sổ: nó là lần DUY NHẤT một phạm vi mới ra
  // đời, và nó nêu tên cả phiên người đã xin. `resourceId` là phiên MỚI — thứ cần tra ngược khi
  // một hàng `AGENT_SCOPE_DENIED` xuất hiện.
  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: input.userId,
    action: "AGENT_SESSION_ISSUED",
    resourceType: "SESSION",
    resourceId: id,
    payload: { issuedBySessionId: input.capBoiSessionId, expiresInSeconds: AGENT_SESSION_MAX_TTL_SECONDS },
  });

  return { sessionId: id, token, expiresInSeconds: AGENT_SESSION_MAX_TTL_SECONDS };
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
