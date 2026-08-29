import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type ActorType } from "@trustprocure/audit";

// =============================================================================================
// LỜI MỜI, MAGIC LINK, OTP, PHIÊN KHÁCH (S1.3)
//
// ---------------------------------------------------------------------------------------------
// E2 LÀ MỘT MỆNH ĐỀ HỘI, VÀ HÌNH DẠNG CỦA GÓI NÀY LÀ CÁCH NÓ ĐƯỢC GIỮ
// ---------------------------------------------------------------------------------------------
// *"Token một mình KHÔNG đủ vào phiên báo giá — luôn phải qua OTP trên kênh đã đăng ký."*
//
// Cách vi phạm mệnh đề này mà không ai thấy: viết MỘT hàm `login(token)` trả về một phiên, rồi
// gọi OTP ở tầng trên "khi cần". Lúc đó bất biến nằm trong TRÍ NHỚ của người viết cổng gác.
//
// Ở đây nó nằm trong KIỂU DỮ LIỆU: `redeemMagicLink` trả về `RedeemedLink` — một thứ KHÔNG phải
// phiên và không mở được gì. Hàm DUY NHẤT sinh ra `guest_sessions` là `verifyOtpAndStartSession`,
// và nó KHÔNG nhận `RedeemedLink` làm bằng chứng: nó tự đọc lại thách thức OTP từ CSDL. Không có
// đường nào đi từ "có token" tới "có phiên" mà không đi qua một mã OTP đã đối chiếu.
//
// ---------------------------------------------------------------------------------------------
// E3(5) — SO SÁNH CHỐNG TẤN CÔNG THỜI GIAN, VÀ MỘT ĐIỀU KIỆN DỄ BỊ BỎ QUA
// ---------------------------------------------------------------------------------------------
// `timingSafeEqual` NÉM nếu hai buffer khác độ dài, và cú ném ấy tự nó là một kênh phụ. Ở đây cả
// hai vế luôn là 32 byte vì chúng là đầu ra của SHA-256, nên điều kiện được thoả BỞI CẤU TRÚC chứ
// không bởi một phép kiểm phải nhớ. Đó là lý do so sánh chạy trên HASH chứ không trên mã.
//
// NÓI ĐÚNG MỨC, không rộng hơn: lớp này che vế "so mã đúng hay sai". Nó KHÔNG che thời gian của
// các nhánh KHÁC — một thách thức không tồn tại trả lời nhanh hơn một thách thức tồn tại nhưng
// sai mã, vì nhánh sau còn ghi `failed_attempts`. Không có mốc chết cho điều đó, cùng tình trạng
// đã ghi cho `totp.ts` ở S0.
//
// ---------------------------------------------------------------------------------------------
// E3(2) — GIỚI HẠN TẦN SUẤT: VẾ KHÔNG CÓ MỘT DÒNG MÃ NÀO TRONG TOÀN S0
// ---------------------------------------------------------------------------------------------
// ADR-015 mục 5: hai hạn mức, HAI LOẠI PHẢN ỨNG khác nhau.
//   * theo ĐÍCH (số điện thoại): chỉ được LÀM CHẬM. Khoá theo đích cho phép một người khoá lối
//     vào của người khác chỉ bằng cách bấm "gửi lại" đủ nhiều — đúng đánh đổi đã ghi cho E3(1) ở
//     `packages/identity/src/mfa-credentials.ts`.
//   * theo NGƯỜI GỌI (phiên/IP): được KHOÁ.
// Hàm `issueOtpChallenge` vì vậy TRẢ VỀ một kết quả có nhánh cho ca đích-bị-hạn-mức, và NÉM cho
// ca người-gọi-bị-khoá. Hai hình dạng khác nhau là cố ý: một cái là "chưa gửi được, thử lại sau",
// cái kia là "dừng lại".
//
// KHOẢN NỢ CÒN LẠI, ghi ra thay vì để nó trông như đã đóng: lớp này phủ đường OTP CỦA LỜI MỜI.
// Đường TOTP của `packages/identity` VẪN KHÔNG CÓ giới hạn tần suất — §4 của ma trận cho E3 phải
// nói đúng điều đó chứ không được xoá.
// =============================================================================================

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

/** Kênh gửi. Cùng tập đóng với `CHECK` ở 010. */
export const CHANNELS = ["EMAIL", "SMS", "ZALO_ZNS"] as const;
export type Channel = (typeof CHANNELS)[number];

/** 32 byte = 256 bit, gấp đôi mức E1 đòi (≥128 bit). Nguồn là CSPRNG của Node. */
export const MAGIC_LINK_TOKEN_BYTES = 32;
export const GUEST_SESSION_TOKEN_BYTES = 32;

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_FAILED_ATTEMPTS = 5;
export const OTP_LOCKOUT_SECONDS = 900;
/** Cửa sổ của cả hai hạn mức. */
export const OTP_RATE_WINDOW_SECONDS = 900;
/** Theo ĐÍCH — chạm trần thì LÀM CHẬM, không khoá. */
export const OTP_MAX_PER_DEST = 3;
/** Theo NGƯỜI GỌI — chạm trần thì KHOÁ. */
export const OTP_MAX_PER_CALLER = 10;

export interface InvitationActor {
  readonly type: ActorType;
  readonly id?: string | null;
}

function bam(...phan: string[]): Buffer {
  const h = createHash("sha256");
  for (const p of phan) h.update(p, "utf8");
  return h.digest();
}

/**
 * Mã OTP sáu chữ số từ `randomInt` — CSPRNG và KHÔNG lệch phân phối.
 *
 * `Math.random()` sai theo HAI hướng ở đây và cả hai đều nghiêm trọng; `randomBytes(3) % 1000000`
 * thì sai theo hướng thứ hai: 2^24 không chia hết cho 10^6 nên các giá trị nhỏ hơi nặng hơn.
 * `randomInt` loại bỏ phần dư bằng lấy mẫu lại.
 */
function sinhMaOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface CreateInvitationInput {
  readonly rfqId: string;
  readonly supplierId: string;
  readonly contactId: string;
  /** Mặc định EMAIL. Kênh này KHÔNG được trùng kênh OTP — trigger ở 010 cưỡng chế. */
  readonly linkChannel?: Channel;
  readonly actor: InvitationActor;
}

export interface InvitationRecord {
  readonly id: string;
  readonly rfqId: string;
  readonly supplierId: string;
  readonly contactId: string;
  readonly linkChannel: Channel;
  readonly status: "SENT" | "ACCEPTED" | "DECLINED" | "REVOKED";
}

interface HangInvitation {
  id: string;
  rfq_id: string;
  supplier_id: string;
  contact_id: string;
  link_channel: Channel;
  status: InvitationRecord["status"];
}

const COT_INVITATION = "id, rfq_id, supplier_id, contact_id, link_channel, status";

function doiInvitation(h: HangInvitation): InvitationRecord {
  return {
    id: h.id,
    rfqId: h.rfq_id,
    supplierId: h.supplier_id,
    contactId: h.contact_id,
    linkChannel: h.link_channel,
    status: h.status,
  };
}

export async function createInvitation(
  client: pg.PoolClient,
  orgId: string,
  input: CreateInvitationInput,
): Promise<InvitationRecord> {
  await assertTenantBound(client, orgId, "createInvitation");

  const { rows } = await client.query<HangInvitation>(
    `INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COT_INVITATION}`,
    [orgId, input.rfqId, input.supplierId, input.contactId, input.linkChannel ?? "EMAIL"],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("INSERT rfq_invitations không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "INVITATION_CREATED",
    resourceType: "rfq_invitation",
    resourceId: hang.id,
    payload: { rfqId: hang.rfq_id, supplierId: hang.supplier_id },
  });
  return doiInvitation(hang);
}

export interface IssuedToken {
  readonly tokenId: string;
  /**
   * Token DẠNG RÕ, và đây là lần DUY NHẤT nó tồn tại. CSDL chỉ giữ SHA-256 của nó (E1), nên không
   * đường nào lấy lại được giá trị này. KHÔNG ghi log, KHÔNG đưa vào `outbox_jobs.payload` — hợp
   * đồng của `enqueueJob` nói payload mang THAM CHIẾU, không mang GIÁ TRỊ.
   */
  readonly token: string;
  readonly expiresAt: Date;
}

export async function issueMagicLinkToken(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly invitationId: string; readonly ttlSeconds?: number },
): Promise<IssuedToken> {
  await assertTenantBound(client, orgId, "issueMagicLinkToken");

  const token = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString("base64url");
  const ttl = input.ttlSeconds ?? 7 * 24 * 3600;

  const { rows } = await client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + make_interval(secs => $4))
     RETURNING id, expires_at`,
    [orgId, input.invitationId, bam(token), ttl],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("INSERT token không trả về hàng nào");

  return { tokenId: hang.id, token, expiresAt: hang.expires_at };
}

/**
 * Kết quả của việc đổi một magic link. **KHÔNG PHẢI MỘT PHIÊN** và không mở được gì — xem khối E2
 * ở đầu file. Nó chỉ nói "token này hợp lệ và trỏ tới lời mời nào".
 */
export interface RedeemedLink {
  readonly invitationId: string;
  readonly contactId: string;
  readonly linkChannel: Channel;
}

export async function redeemMagicLink(
  client: pg.PoolClient,
  orgId: string,
  token: string,
): Promise<RedeemedLink> {
  await assertTenantBound(client, orgId, "redeemMagicLink");

  const { rows } = await client.query<HangInvitation & { het_han: boolean; thu_hoi: boolean }>(
    `SELECT i.id, i.rfq_id, i.supplier_id, i.contact_id, i.link_channel, i.status,
            (t.expires_at <= now()) AS het_han,
            (t.revoked_at IS NOT NULL OR i.status = 'REVOKED') AS thu_hoi
       FROM rfq_invitation_tokens t
       JOIN rfq_invitations i ON i.id = t.invitation_id
      WHERE t.token_hash = $1 AND t.purpose = 'BID_SUBMISSION'`,
    [bam(token)],
  );

  const hang = rows[0];
  // Ba ca — không tìm thấy, hết hạn, đã thu hồi — cố ý ném CÙNG MỘT thông báo. Phân biệt được
  // chúng là một oracle trên chính tập token: "chuỗi này từng là một token thật".
  if (hang === undefined || hang.het_han || hang.thu_hoi) {
    throw new InvitationError("magic link không hợp lệ, đã hết hạn, hoặc đã bị thu hồi");
  }

  return { invitationId: hang.id, contactId: hang.contact_id, linkChannel: hang.link_channel };
}

export type OtpIssueOutcome =
  | { readonly ok: true; readonly challengeId: string; readonly code: string }
  | { readonly ok: false; readonly reason: "DEST_RATE_LIMITED"; readonly retryAfterSeconds: number };

export interface IssueOtpInput {
  readonly invitationId: string;
  readonly channel: Channel;
  /** Đích nhận dạng rõ (số điện thoại). CHỈ dùng để băm — không bao giờ được ghi xuống. */
  readonly destination: string;
  /** Dấu vân của người gọi: IP, hoặc id phiên trình duyệt. CHỈ dùng để băm. */
  readonly callerFingerprint: string;
}

async function demVaTang(
  client: pg.PoolClient,
  orgId: string,
  kind: "DEST" | "CALLER",
  khoa: string,
): Promise<number> {
  // Cửa sổ RỜI RẠC (`date_trunc` theo bội của cửa sổ) chứ không phải cửa sổ TRƯỢT. Nói đúng mức:
  // một kẻ tấn công canh đúng ranh giới hai cửa sổ gửi được GẤP ĐÔI hạn mức trong một khoảnh
  // khắc. Cửa sổ trượt cần lưu từng dấu thời gian, tức một bảng lớn hơn nhiều cho một lớp mà
  // mục tiêu là chặn lạm dụng ồ ạt, không phải chặn đúng một lần thừa.
  const { rows } = await client.query<{ hits: number }>(
    `INSERT INTO otp_rate_limits (org_id, bucket_kind, bucket_hash, window_start, hits)
     VALUES ($1, $2, $3,
             to_timestamp(floor(extract(epoch FROM now()) / $4) * $4), 1)
     ON CONFLICT (org_id, bucket_kind, bucket_hash, window_start)
       DO UPDATE SET hits = otp_rate_limits.hits + 1
     RETURNING hits`,
    [orgId, kind, bam(kind, khoa), OTP_RATE_WINDOW_SECONDS],
  );
  return rows[0]?.hits ?? 0;
}

/**
 * Sinh một thách thức OTP và TRẢ VỀ mã dạng rõ cho người gọi.
 *
 * NGƯỜI GỌI PHẢI LÀ HANDLER GỬI, và đó là một ràng buộc của ADR-015 mục 3 chứ không phải một lời
 * khuyên: `outbox_jobs.payload` mang THAM CHIẾU, không mang GIÁ TRỊ, nên mã KHÔNG được sinh ở nơi
 * xếp hàng rồi truyền qua payload. Nó phải sinh ở đây, đi thẳng sang nhà cung cấp kênh, rồi biến
 * mất. Không lớp máy nào cưỡng chế điều đó — lớp duy nhất là dòng chữ này cộng code review.
 */
export async function issueOtpChallenge(
  client: pg.PoolClient,
  orgId: string,
  input: IssueOtpInput,
): Promise<OtpIssueOutcome> {
  await assertTenantBound(client, orgId, "issueOtpChallenge");

  const soLanNguoiGoi = await demVaTang(client, orgId, "CALLER", input.callerFingerprint);
  if (soLanNguoiGoi > OTP_MAX_PER_CALLER) {
    // KHOÁ — ADR-015 mục 5. Ném, không trả nhánh: đây là "dừng lại".
    throw new InvitationError("vượt giới hạn tần suất theo người gọi");
  }

  const soLanDich = await demVaTang(client, orgId, "DEST", input.destination);
  if (soLanDich > OTP_MAX_PER_DEST) {
    // LÀM CHẬM — không khoá, không ném. Khoá theo đích cho phép một người chặn lối vào của người
    // khác chỉ bằng cách bấm "gửi lại" đủ nhiều.
    return {
      ok: false,
      reason: "DEST_RATE_LIMITED",
      retryAfterSeconds: OTP_RATE_WINDOW_SECONDS,
    };
  }

  const code = sinhMaOtp();
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO invitation_otp_challenges (org_id, invitation_id, channel, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5)) RETURNING id`,
    [orgId, input.invitationId, input.channel, bam(input.invitationId, code), OTP_TTL_SECONDS],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("INSERT thách thức OTP không trả về hàng nào");

  return { ok: true, challengeId: hang.id, code };
}

export type OtpDenialReason =
  | "NO_CHALLENGE"
  | "EXPIRED"
  | "ALREADY_USED"
  | "LOCKED_OUT"
  | "WRONG_CODE";

export type OtpVerifyResult =
  | { readonly ok: true; readonly sessionId: string; readonly sessionToken: string }
  | { readonly ok: false; readonly reason: OtpDenialReason };

export interface VerifyOtpInput {
  readonly invitationId: string;
  readonly code: string;
  /**
   * Danh tính THỰC TẾ ĐÃ XÁC THỰC (E5) — người liên hệ GIỮ KÊNH đã nhận mã, KHÔNG nhất thiết là
   * người được ghi ở `rfq_invitations.contact_id`. Hai giá trị có thể khác nhau và đó là hành vi
   * được thiết kế: link chuyển tiếp vẫn dùng được.
   */
  readonly verifiedContactId: string;
  readonly verifiedChannel: Channel;
  readonly ttlSeconds?: number;
  readonly actor: InvitationActor;
}

interface HangThachThuc {
  id: string;
  code_hash: Buffer;
  het_han: boolean;
  da_dung: boolean;
  dang_khoa: boolean;
  failed_attempts: number;
}

/**
 * Đối chiếu OTP và — CHỈ KHI ĐÚNG — mở một phiên khách.
 *
 * Đây là hàm DUY NHẤT trong hệ thống sinh ra một hàng `guest_sessions`. Xem khối E2 ở đầu file.
 */
export async function verifyOtpAndStartSession(
  client: pg.PoolClient,
  orgId: string,
  input: VerifyOtpInput,
): Promise<OtpVerifyResult> {
  await assertTenantBound(client, orgId, "verifyOtpAndStartSession");

  // `FOR UPDATE` trên thách thức mới nhất: hai lần thử song song cùng đọc `failed_attempts = 4`
  // rồi cùng ghi `5` sẽ làm trần loạt đầu bằng ĐỘ ĐỒNG THỜI CỦA KẺ TẤN CÔNG thay vì bằng hằng số
  // cấu hình — đúng khoản nợ 2 của S0, và ở đây nó được đóng thay vì lặp lại.
  const { rows } = await client.query<HangThachThuc>(
    `SELECT id, code_hash, failed_attempts,
            (expires_at <= now()) AS het_han,
            (consumed_at IS NOT NULL) AS da_dung,
            (locked_until IS NOT NULL AND locked_until > now()) AS dang_khoa
       FROM invitation_otp_challenges
      WHERE invitation_id = $1
      ORDER BY created_at DESC
      LIMIT 1
        FOR UPDATE`,
    [input.invitationId],
  );

  const tt = rows[0];
  if (tt === undefined) return { ok: false, reason: "NO_CHALLENGE" };
  if (tt.dang_khoa) return { ok: false, reason: "LOCKED_OUT" };
  if (tt.da_dung) return { ok: false, reason: "ALREADY_USED" };
  if (tt.het_han) return { ok: false, reason: "EXPIRED" };

  // Cả hai vế luôn 32 byte (đầu ra SHA-256), nên `timingSafeEqual` không bao giờ ném vì lệch độ
  // dài — điều kiện được thoả BỞI CẤU TRÚC. Xem khối E3(5) ở đầu file.
  const dung = timingSafeEqual(tt.code_hash, bam(input.invitationId, input.code));

  if (!dung) {
    const lanThu = tt.failed_attempts + 1;
    await client.query(
      // `$2::int` ở CẢ HAI chỗ: không có ép kiểu, Postgres suy ra hai kiểu khác nhau cho cùng
      // một tham số (một vế là `integer` của cột, vế kia là toán hạng của `>=`) và trả
      // "inconsistent types deduced for parameter $2". Đã vấp phải khi chạy test lần đầu.
      `UPDATE invitation_otp_challenges
          SET failed_attempts = $2::int,
              locked_until = CASE WHEN $2::int >= $3::int
                                  THEN now() + make_interval(secs => $4) ELSE NULL END
        WHERE id = $1`,
      [tt.id, lanThu, OTP_MAX_FAILED_ATTEMPTS, OTP_LOCKOUT_SECONDS],
    );
    return { ok: false, reason: lanThu >= OTP_MAX_FAILED_ATTEMPTS ? "LOCKED_OUT" : "WRONG_CODE" };
  }

  // DÙNG MỘT LẦN — vế bền vững, không phải một cờ trong bộ nhớ. Câu này có `consumed_at IS NULL`
  // trong `WHERE` nên hai lần dùng song song chỉ có một lần chạm được hàng.
  const danhDau = await client.query(
    "UPDATE invitation_otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
    [tt.id],
  );
  if (danhDau.rowCount !== 1) return { ok: false, reason: "ALREADY_USED" };

  const sessionToken = randomBytes(GUEST_SESSION_TOKEN_BYTES).toString("base64url");
  const phien = await client.query<{ id: string }>(
    `INSERT INTO guest_sessions
       (org_id, invitation_id, token_hash, verified_contact_id, verified_channel, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6)) RETURNING id`,
    [
      orgId,
      input.invitationId,
      bam(sessionToken),
      input.verifiedContactId,
      input.verifiedChannel,
      input.ttlSeconds ?? 4 * 3600,
    ],
  );
  const hangPhien = phien.rows[0];
  if (hangPhien === undefined) throw new InvitationError("INSERT guest_sessions không trả về hàng");

  // E5: sổ kiểm toán ghi danh tính THỰC TẾ ĐÃ XÁC THỰC. `payload` KHÔNG mang mã OTP, không mang
  // token, không mang số điện thoại — chỉ tham chiếu.
  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "GUEST_SESSION_STARTED",
    resourceType: "guest_session",
    resourceId: hangPhien.id,
    payload: {
      invitationId: input.invitationId,
      verifiedContactId: input.verifiedContactId,
      verifiedChannel: input.verifiedChannel,
    },
  });

  return { ok: true, sessionId: hangPhien.id, sessionToken };
}

export async function revokeInvitation(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly invitationId: string; readonly actor: InvitationActor },
): Promise<void> {
  await assertTenantBound(client, orgId, "revokeInvitation");

  await client.query(
    "UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now() WHERE id = $1",
    [input.invitationId],
  );
  await client.query(
    "UPDATE rfq_invitation_tokens SET revoked_at = now() " +
      " WHERE invitation_id = $1 AND revoked_at IS NULL",
    [input.invitationId],
  );

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "INVITATION_REVOKED",
    resourceType: "rfq_invitation",
    resourceId: input.invitationId,
  });
}
