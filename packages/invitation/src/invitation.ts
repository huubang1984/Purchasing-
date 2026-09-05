import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";
import { PepperRing } from "./pepper.js";

// =============================================================================================
// LỜI MỜI, MAGIC LINK, OTP, PHIÊN KHÁCH (S1.3) — BẢN SAU REVIEW AN NINH
//
// ---------------------------------------------------------------------------------------------
// BẢN TRƯỚC CỦA FILE NÀY CÓ BA CRITICAL, VÀ CẢ BA CÙNG MỘT HÌNH DẠNG
// ---------------------------------------------------------------------------------------------
// Chuỗi tấn công đã được dựng lại thành phép đo trên Postgres thật và nó chạy TRỌN, với kẻ tấn
// công chỉ có `invitationId`:
//
//   C1  phat OTP toi so tu chon ......................... THANH CONG
//   H1  mo phien chi bang invitationId .................. THANH CONG
//   C2  so kiem toan ghi danh tinh ...................... NGUOI THAT (sai su that)
//   C3  sau THU HOI van mo duoc PHIEN MOI ............... CO
//
// Hình dạng chung: **một sự thật an ninh được NHẬN VÀO dưới dạng tham số thay vì được ĐỌC RA từ
// dữ liệu.** Đích nhận OTP là tham số. Danh tính đã xác thực là tham số. Quyền yêu cầu OTP chỉ
// cần một UUID.
//
// Nguyên tắc của bản này, và nó là thứ duy nhất cần nhớ khi sửa file này về sau:
//
//     KHÔNG HÀM NÀO Ở ĐÂY ĐƯỢC PHÉP *KHAI* MỘT SỰ THẬT AN NINH.
//     Nó chỉ được phép *CHỨNG MINH* một cái đã có, rồi ĐỌC hệ quả ra khỏi dữ liệu.
//
// Vì vậy `destination`, `verifiedContactId` và `verifiedChannel` ĐÃ BỊ GỠ khỏi mọi chữ ký. Thứ
// duy nhất người gọi đưa vào là **token dạng rõ** — một thứ họ chỉ có nếu họ nhận được magic
// link — và **mã OTP** — một thứ họ chỉ có nếu họ giữ kênh đã đăng ký.
//
// ---------------------------------------------------------------------------------------------
// E2 NẰM TRONG KIỂU DỮ LIỆU, VÀ NAY CẢ HAI CHIỀU ĐỀU ĐÓNG
// ---------------------------------------------------------------------------------------------
// Bản trước đóng đúng một chiều — `redeemMagicLink` trả `RedeemedLink`, một thứ không mở được gì
// — và để mở toang chiều còn lại: **không có đường nào BẮT PHẢI có token cả**. Nay hai hàm chạm
// phiên đều nhận token và trigger ở 012 đòi thách thức mang `token_id` của đúng lời mời.
//
// ---------------------------------------------------------------------------------------------
// E3(5) — SO SÁNH CHỐNG TẤN CÔNG THỜI GIAN
// ---------------------------------------------------------------------------------------------
// `timingSafeEqual` NÉM nếu hai buffer khác độ dài, và cú ném ấy tự nó là một kênh phụ. Cả hai vế
// luôn 32 byte (đầu ra SHA-256), nên điều kiện được thoả BỞI CẤU TRÚC. Nói đúng mức: lớp này che
// vế "so mã đúng hay sai", KHÔNG che thời gian của các nhánh KHÁC — một thách thức không tồn tại
// trả lời nhanh hơn một thách thức tồn tại nhưng sai mã. Không có mốc chết cho điều đó, cùng tình
// trạng đã ghi cho `totp.ts` ở S0.
// =============================================================================================

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

export const CHANNELS = ["EMAIL", "SMS", "ZALO_ZNS"] as const;
export type Channel = (typeof CHANNELS)[number];

/** 32 byte = 256 bit, gấp đôi mức E1 đòi (≥128 bit). Nguồn là CSPRNG của Node. */
export const MAGIC_LINK_TOKEN_BYTES = 32;
export const GUEST_SESSION_TOKEN_BYTES = 32;

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_FAILED_ATTEMPTS = 5;
export const OTP_LOCKOUT_SECONDS = 900;
export const OTP_RATE_WINDOW_SECONDS = 900;
/** Theo ĐÍCH — chạm trần thì LÀM CHẬM, không khoá. */
export const OTP_MAX_PER_DEST = 3;
/** Theo NGƯỜI GỌI — chạm trần thì KHOÁ. */
export const OTP_MAX_PER_CALLER = 10;
/**
 * [H3] Theo LỜI MỜI — bucket DUY NHẤT kẻ tấn công không xoay được, vì `invitation_id` chính là
 * thứ nó đang nhắm. Hai bucket kia khoá trên chuỗi do người gọi truyền vào (`callerFingerprint`,
 * và trước vòng sửa này là cả `destination`), nên đổi chuỗi là có bucket mới.
 */
export const OTP_MAX_PER_INVITATION = 5;

/**
 * [H5] Trần TRÊN của TTL. `CHECK (expires_at > created_at)` chỉ chặn cận DƯỚI; một cấu hình sai
 * đặt TTL = 10^9 làm vế *"có hạn"* của E1 biến mất trong im lặng. Đây là bài học dự án đã trả
 * tiền một lần ở `MFA_MAX_ALLOWED_FAILED_ATTEMPTS`: *một tham số chính sách phải có cận TRÊN chứ
 * không chỉ cận DƯỚI*.
 */
export const MAGIC_LINK_MAX_TTL_SECONDS = 7 * 24 * 3600;
export const GUEST_SESSION_MAX_TTL_SECONDS = 12 * 3600;

// =============================================================================================
// [ADR-016] `InvitationActor` ĐÃ BỊ XOÁ — VÀ NÓ ĐƯỢC THAY BẰNG HAI THỨ KHÁC NHAU, KHÔNG PHẢI MỘT
//
// Gói này có HAI loại chủ thể, và gộp chúng vào một `actor` tự khai là chỗ lời khai sống được:
//
//   * BÊN MUA (`createInvitation`, `issueMagicLinkToken`, `revokeInvitation`) là một người đã
//     đăng nhập ⇒ có một hàng `sessions`. Ba hàm ấy nay nhận `actorSessionId`, và trigger
//     `*_kiem_danh_tinh` của 013 đòi cột người khớp chủ phiên.
//
//   * BÊN KHÁCH (`issueOtpChallenge`, `verifyOtpAndStartSession`) KHÔNG có phiên — đó là toàn
//     bộ lý do gói này tồn tại (ràng buộc sản phẩm 1: lần báo giá đầu không cần tài khoản).
//     Hai hàm ấy KHÔNG nhận actor gì cả: danh tính được ĐỌC RA từ token và từ chính thách thức
//     đã đối chiếu. Đó là một phép chứng minh MẠNH HƠN một phiên, không phải một ngoại lệ —
//     người gọi phải cầm được magic link, rồi phải cầm được mã OTP về đúng kênh đã đăng ký.
//
// Cùng một ADR, hai cách cài, vì "đọc ra từ dữ liệu" là quy tắc còn "phiên" chỉ là một trong
// những dữ liệu ấy. Viết `actorSessionId` cho đường khách sẽ là dựng lại đúng lời khai vừa gỡ.
// =============================================================================================

/**
 * SHA-256 TRAN. [ADR-018] Chi dung cho thu co tien anh 32 BYTE NGAU NHIEN — token magic link va
 * token phien khach. Voi chung, liet ke la vo nghia va pepper khong mua them gi.
 *
 * KHONG dung ham nay cho so dien thoai, email hay ma OTP: khong gian tien anh cua chung la 10^9
 * va 10^6, va phep dao nguoc DA DUOC DO — xem khoi dau `pepper.ts`.
 */
function bam(...phan: string[]): Buffer {
  const h = createHash("sha256");
  for (const p of phan) h.update(p, "utf8");
  return h.digest();
}

/**
 * Mã OTP sáu chữ số từ `randomInt` — CSPRNG và KHÔNG lệch phân phối. `randomBytes(3) % 1000000`
 * thì lệch: 2^24 không chia hết cho 10^6.
 */
function sinhMaOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function tranTtl(giaTri: number | undefined, macDinh: number, tran: number, ten: string): number {
  const ttl = giaTri ?? macDinh;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > tran) {
    throw new InvitationError(`${ten} phải là số giây dương và không vượt ${tran}`);
  }
  return ttl;
}

export interface CreateInvitationInput {
  readonly rfqId: string;
  readonly supplierId: string;
  readonly contactId: string;
  readonly linkChannel?: Channel;
  /** Phiên của người mua đang mời. Danh tính là dẫn xuất của nó. */
  readonly actorSessionId: string;
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
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows } = await client.query<HangInvitation>(
    `INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel,
                                  invited_by, invited_by_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COT_INVITATION}`,
    [orgId, input.rfqId, input.supplierId, input.contactId, input.linkChannel ?? "EMAIL",
     actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("INSERT rfq_invitations không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
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
   * Token DẠNG RÕ, và đây là lần DUY NHẤT nó tồn tại. CSDL chỉ giữ SHA-256 của nó (E1). KHÔNG ghi
   * log, KHÔNG đưa vào `outbox_jobs.payload` — hợp đồng của `enqueueJob` nói payload mang THAM
   * CHIẾU, không mang GIÁ TRỊ.
   */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * [M4] Phát token nay CÓ ghi kiểm toán. Đúc một credential bearer là thao tác đáng ghi sổ nhất
 * trong cả gói, và bản trước không để lại dấu vết nào trong khi `createInvitation` thì có — một
 * bất đối xứng không có lý do nào được viết ra. Lập luận DoS của ADR-008 không áp dụng: đường này
 * đã có trần tần suất ở phía trên.
 */
export async function issueMagicLinkToken(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly invitationId: string;
    readonly ttlSeconds?: number;
    readonly actorSessionId: string;
  },
): Promise<IssuedToken> {
  await assertTenantBound(client, orgId, "issueMagicLinkToken");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const ttl = tranTtl(input.ttlSeconds, MAGIC_LINK_MAX_TTL_SECONDS, MAGIC_LINK_MAX_TTL_SECONDS, "ttlSeconds");
  const token = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString("base64url");

  const { rows } = await client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at,
                                        issued_by, issued_by_session_id)
     VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + make_interval(secs => $4), $5, $6)
     RETURNING id, expires_at`,
    [orgId, input.invitationId, bam(token), ttl, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("INSERT token không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "MAGIC_LINK_TOKEN_ISSUED",
    resourceType: "rfq_invitation_token",
    resourceId: hang.id,
    payload: { invitationId: input.invitationId },
  });

  return { tokenId: hang.id, token, expiresAt: hang.expires_at };
}

/**
 * Kết quả của việc đổi một magic link. **KHÔNG PHẢI MỘT PHIÊN** và không mở được gì.
 */
export interface RedeemedLink {
  readonly invitationId: string;
  readonly contactId: string;
  readonly linkChannel: Channel;
}

interface HangToken {
  token_id: string;
  invitation_id: string;
  contact_id: string;
  supplier_id: string;
  link_channel: Channel;
}

/**
 * Đối chiếu một token dạng rõ và trả về ngữ cảnh của nó — hoặc ném.
 *
 * Bốn ca hỏng (không tồn tại, hết hạn, đã thu hồi, ĐÃ TIÊU THỤ) cố ý ném CÙNG MỘT thông báo:
 * phân biệt được chúng là một oracle trên chính tập token.
 *
 * [H5] `consumed_at IS NULL` là vế MỚI. Bản trước không bao giờ GHI `consumed_at` và cũng không
 * ĐỌC nó, nên magic link là một bearer token chơi lại được cho tới khi hết hạn — và tệ hơn, ngày
 * ai đó viết mã đặt `consumed_at` thì `redeemMagicLink` vẫn cho qua: một bẫy fail-open đã cài sẵn.
 */
async function docToken(client: pg.PoolClient, orgId: string, token: string): Promise<HangToken> {
  const { rows } = await client.query<HangToken>(
    `SELECT t.id AS token_id, i.id AS invitation_id, i.contact_id, i.supplier_id, i.link_channel
       FROM rfq_invitation_tokens t
       JOIN rfq_invitations i ON i.id = t.invitation_id AND i.org_id = t.org_id
      WHERE t.token_hash = $1
        AND t.purpose = 'BID_SUBMISSION'
        AND t.expires_at > now()
        AND t.revoked_at IS NULL
        AND t.consumed_at IS NULL
        AND i.status <> 'REVOKED'
        AND i.revoked_at IS NULL`,
    [bam(token)],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new InvitationError("magic link không hợp lệ, đã hết hạn, đã dùng, hoặc đã bị thu hồi");
  }
  return hang;
}

export async function redeemMagicLink(
  client: pg.PoolClient,
  orgId: string,
  token: string,
): Promise<RedeemedLink> {
  await assertTenantBound(client, orgId, "redeemMagicLink");
  const t = await docToken(client, orgId, token);
  return { invitationId: t.invitation_id, contactId: t.contact_id, linkChannel: t.link_channel };
}

export type OtpIssueOutcome =
  | {
      readonly ok: true;
      readonly challengeId: string;
      readonly code: string;
      /** Đích ĐỌC TỪ CSDL. Người gọi (handler gửi) cần nó để gửi — nó KHÔNG do người gọi chọn. */
      readonly destination: string;
      readonly contactId: string;
    }
  | { readonly ok: false; readonly reason: "DEST_RATE_LIMITED"; readonly retryAfterSeconds: number };

export interface IssueOtpInput {
  /** [H1] Token dạng rõ — bằng chứng người gọi đã nhận magic link. KHÔNG phải `invitationId`. */
  readonly token: string;
  readonly channel: Channel;
  /**
   * Dấu vân của người gọi. **HỢP ĐỒNG:** nó PHẢI được dẫn xuất ở tầng ngoài cùng từ một nguồn
   * KHÔNG GIẢ MẠO ĐƯỢC — IP tầng vận chuyển sau một proxy tin cậy, không phải `X-Forwarded-By`
   * do client gửi. Không có ràng buộc ấy, hạn mức theo người gọi bị vô hiệu bằng cách xoay chuỗi.
   * Không lớp máy nào cưỡng chế được điều này; lớp duy nhất là dòng chữ này cộng code review, và
   * đó là lý do bucket theo LỜI MỜI tồn tại.
   */
  readonly callerFingerprint: string;
  /**
   * [ADR-018] Vòng pepper, TIÊM ở composition root — cùng khuôn `TotpSecretUnsealer` của
   * `packages/identity`. Nó là một KHOÁ, không phải một lời khai danh tính: ADR-016 cấm nhận
   * sự thật an ninh làm tham số, và một khoá bí mật thì ngược lại — nó KHÔNG được nằm trong
   * CSDL, nên nó phải đi vào từ ngoài.
   */
  readonly pepper: PepperRing;
}

async function demVaTang(
  client: pg.PoolClient,
  orgId: string,
  kind: "DEST" | "CALLER" | "INVITATION",
  khoa: string,
  pepper: PepperRing,
): Promise<number> {
  // Cửa sổ RỜI RẠC, không phải cửa sổ trượt: một kẻ tấn công canh đúng ranh giới hai cửa sổ gửi
  // được GẤP ĐÔI hạn mức trong một khoảnh khắc. Cửa sổ trượt cần lưu từng dấu thời gian.
  //
  // [M1] `orgId` đi vào phép băm: không có nó, cùng một số điện
  // thoại cho cùng một `bucket_hash` ở MỌI tổ chức, và một bản sao lưu cho phép JOIN giữa hai tổ
  // chức để trả lời "hai bên mua này có cùng nhà cung cấp không" — đúng tài sản mà ADR-013 dành
  // trọn một ADR để bảo vệ.
  //
  // [ADR-018] Phần CÒN LẠI của M1 nay đã đóng: phép băm là HMAC với một pepper giữ NGOÀI CSDL.
  // Bảng này KHÔNG mang cột phiên bản, và đó là một quyết định có hệ quả phải nói ra: xoay pepper
  // làm bộ đếm bắt đầu lại: trong đúng cửa sổ xoay, hạn mức của mọi đích được đặt lại. Cửa sổ
  // ngắn nên hàng cũ tự già đi, nhưng xoay pepper vì vậy là một thao tác có thời điểm.
  const { rows } = await client.query<{ hits: number }>(
    `INSERT INTO otp_rate_limits (org_id, bucket_kind, bucket_hash, window_start, hits)
     VALUES ($1, $2, $3,
             to_timestamp(floor(extract(epoch FROM now()) / $4) * $4), 1)
     ON CONFLICT (org_id, bucket_kind, bucket_hash, window_start)
       DO UPDATE SET hits = otp_rate_limits.hits + 1
     RETURNING hits`,
    [orgId, kind, pepper.bam(orgId, kind, khoa).hash, OTP_RATE_WINDOW_SECONDS],
  );
  return rows[0]?.hits ?? 0;
}

/**
 * Sinh một thách thức OTP. **NGƯỜI GỌI PHẢI LÀ HANDLER GỬI** (ADR-015 mục 3): mã không được sinh
 * ở nơi xếp hàng rồi truyền qua `outbox_jobs.payload`, vì payload mang THAM CHIẾU chứ không mang
 * GIÁ TRỊ. Không lớp máy nào cưỡng chế điều đó.
 *
 * [C1] Đích nhận **ĐỌC TỪ `supplier_contacts`**, không nhận từ tham số. Bản trước nhận `destination`
 * tự do và không lưu lại nó, nên "không lớp nào, ở bất kỳ thời điểm nào, biết mã đã đi tới đâu" —
 * và một kẻ có `invitationId` cho gửi OTP về số của chính nó.
 */
export async function issueOtpChallenge(
  client: pg.PoolClient,
  orgId: string,
  input: IssueOtpInput,
): Promise<OtpIssueOutcome> {
  await assertTenantBound(client, orgId, "issueOtpChallenge");

  const t = await docToken(client, orgId, input.token);

  // Kênh quyết định CỘT NÀO được đọc. Nhờ vậy nhãn `channel` và sự thật là MỘT thứ — bản trước
  // để chúng rời nhau, nên `channel='SMS'` với một địa chỉ email đi qua trigger sạch sẽ và OTP về
  // đúng hộp thư đã nhận magic link (H2).
  const cot = input.channel === "EMAIL" ? "email" : "phone";
  const { rows: lh } = await client.query<{ dich: string | null }>(
    `SELECT ${cot} AS dich FROM supplier_contacts WHERE id = $1`,
    [t.contact_id],
  );
  const dich = lh[0]?.dich ?? null;
  if (dich === null || dich.length === 0) {
    // ADR-015 và 008 đã ghim hệ quả này: lời mời phải BỊ TỪ CHỐI khi thiếu kênh, KHÔNG được lặng
    // lẽ rơi về email — rơi về email là đúng thứ ADR-015 mục 1 cấm.
    throw new InvitationError("người liên hệ chưa có kênh đã đăng ký cho loại kênh này");
  }

  const soLanNguoiGoi = await demVaTang(client, orgId, "CALLER", input.callerFingerprint, input.pepper);
  if (soLanNguoiGoi > OTP_MAX_PER_CALLER) {
    throw new InvitationError("vượt giới hạn tần suất theo người gọi");
  }

  const soLanLoiMoi = await demVaTang(client, orgId, "INVITATION", t.invitation_id, input.pepper);
  if (soLanLoiMoi > OTP_MAX_PER_INVITATION) {
    throw new InvitationError("vượt giới hạn tần suất theo lời mời");
  }

  const soLanDich = await demVaTang(client, orgId, "DEST", dich, input.pepper);
  if (soLanDich > OTP_MAX_PER_DEST) {
    return { ok: false, reason: "DEST_RATE_LIMITED", retryAfterSeconds: OTP_RATE_WINDOW_SECONDS };
  }

  const code = sinhMaOtp();
  // [ADR-018] `code_hash` CŨNG có pepper, và mục này KHÔNG nằm trong ADR — nó được tìm ra khi
  // cài. Mã OTP là SÁU CHỮ SỐ, tức 10^6 tiền ảnh, và `invitation_id` nằm ngay trong cùng bản sao
  // lưu. Kẻ có bản sao lưu đọc ra mã của MỌI thách thức chưa tiêu thụ trong vài giây. E1 nói CSDL
  // chỉ giữ BĂM của mã; khi băm đảo ngược được, "chỉ giữ băm" và "giữ mã" là một.
  const bamMa = input.pepper.bam(t.invitation_id, code);
  const bamDich = input.pepper.bam(orgId, "DEST", dich);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO invitation_otp_challenges
       (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash,
        pepper_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $9)) RETURNING id`,
    [
      orgId,
      t.invitation_id,
      t.token_id,
      t.contact_id,
      input.channel,
      bamMa.hash,
      bamDich.hash,
      bamMa.version,
      OTP_TTL_SECONDS,
    ],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("INSERT thách thức OTP không trả về hàng nào");

  // [M4] `payload` mang challengeId và kênh — KHÔNG mang đích, KHÔNG mang mã.
  //
  // [ADR-016] Chủ thể là NHÀ CUNG CẤP, và danh tính của nó ĐỌC RA từ token: `t.contact_id` là
  // người liên hệ mà magic link được phát cho, không phải một chuỗi người gọi tự đặt. Bản trước
  // nhận `actor` tự do, nên một kẻ có token phát được OTP rồi ghi sổ dưới tên bất kỳ ai.
  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: t.contact_id,
    action: "OTP_CHALLENGE_ISSUED",
    resourceType: "invitation_otp_challenge",
    resourceId: hang.id,
    payload: { invitationId: t.invitation_id, channel: input.channel },
  });

  return { ok: true, challengeId: hang.id, code, destination: dich, contactId: t.contact_id };
}

export type OtpDenialReason =
  | "NO_CHALLENGE"
  | "EXPIRED"
  | "ALREADY_USED"
  | "LOCKED_OUT"
  | "WRONG_CODE";

export type OtpVerifyResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly sessionToken: string;
      /** DẪN XUẤT từ thách thức, không phải một tham số. Xem C2. */
      readonly verifiedContactId: string;
      readonly verifiedChannel: Channel;
    }
  | { readonly ok: false; readonly reason: OtpDenialReason };

export interface VerifyOtpInput {
  /** [H1] Token dạng rõ. Cùng token đã dùng để phát thách thức — trigger ở 012 đòi trùng khớp. */
  readonly token: string;
  readonly code: string;
  readonly ttlSeconds?: number;
  /** [ADR-018] Cùng vòng pepper đã dùng lúc phát. Xem `IssueOtpInput.pepper`. */
  readonly pepper: PepperRing;
}

interface HangThachThuc {
  id: string;
  code_hash: Buffer;
  pepper_version: string;
  contact_id: string;
  channel: Channel;
  het_han: boolean;
  da_dung: boolean;
  dang_khoa: boolean;
}

/**
 * Đối chiếu OTP và — CHỈ KHI ĐÚNG — mở một phiên khách. Hàm DUY NHẤT sinh `guest_sessions`.
 *
 * [C2] `verified_contact_id` và `verified_channel` được SAO CHÉP từ hàng thách thức, và trigger
 * `guest_sessions_kiem_danh_tinh` (012) đòi chúng khớp. Bản trước nhận chúng làm tham số, nên sổ
 * kiểm toán — bằng chứng pháp lý duy nhất của hệ thống — ghi được một danh tính chưa từng xác thực.
 *
 * [H5] Token bị TIÊU THỤ khi phiên ra đời. Hệ quả về sản phẩm phải nói ra: một magic link mở được
 * ĐÚNG MỘT phiên; muốn vào lại sau khi phiên hết hạn thì phải phát link mới. Đó là đánh đổi có
 * chủ đích — một bearer token 7 ngày chơi lại vô hạn là thứ nằm trong URL, trong lịch sử duyệt,
 * và trong log của mọi proxy.
 */
export async function verifyOtpAndStartSession(
  client: pg.PoolClient,
  orgId: string,
  input: VerifyOtpInput,
): Promise<OtpVerifyResult> {
  await assertTenantBound(client, orgId, "verifyOtpAndStartSession");

  const ttl = tranTtl(
    input.ttlSeconds,
    4 * 3600,
    GUEST_SESSION_MAX_TTL_SECONDS,
    "ttlSeconds",
  );
  const t = await docToken(client, orgId, input.token);

  // `FOR UPDATE` giữ hàng cho tới hết transaction. Nó là lớp THỨ HAI: lớp thứ nhất là biểu thức
  // TỰ THAM CHIẾU ở câu ghi thất bại bên dưới, thứ đúng kể cả khi không có khoá.
  const { rows } = await client.query<HangThachThuc>(
    `SELECT id, code_hash, pepper_version, contact_id, channel,
            (expires_at <= now()) AS het_han,
            (consumed_at IS NOT NULL) AS da_dung,
            (locked_until IS NOT NULL AND locked_until > now()) AS dang_khoa
       FROM invitation_otp_challenges
      WHERE invitation_id = $1 AND token_id = $2
      ORDER BY created_at DESC
      LIMIT 1
        FOR UPDATE`,
    [t.invitation_id, t.token_id],
  );

  const tt = rows[0];
  if (tt === undefined) return { ok: false, reason: "NO_CHALLENGE" };
  if (tt.dang_khoa) return { ok: false, reason: "LOCKED_OUT" };
  if (tt.da_dung) return { ok: false, reason: "ALREADY_USED" };
  if (tt.het_han) return { ok: false, reason: "EXPIRED" };

  // [ADR-018] Băm lại theo ĐÚNG phiên bản pepper của hàng, không theo phiên bản đang dùng: một
  // thách thức phát trước lần xoay gần nhất vẫn phải đối chiếu được cho tới khi nó hết hạn.
  const dung = timingSafeEqual(
    tt.code_hash,
    input.pepper.bamTheoPhienBan(tt.pepper_version, t.invitation_id, input.code),
  );

  if (!dung) {
    // [H4] BIỂU THỨC TỰ THAM CHIẾU, không phải một giá trị tuyệt đối tính ở Node. Bản trước tính
    // `failed_attempts + 1` trong JavaScript rồi ghi đè — đúng hình dạng fail-OPEN mà dự án đã ĐO
    // và đã bác ở `packages/identity/src/mfa-credentials.ts` (24 mã được phán xét, LOCKED_OUT = 0).
    // Ở dạng đó, tính đúng đắn phụ thuộc HOÀN TOÀN vào `FOR UPDATE` giữ khoá tới hết lượt ghi,
    // tức phụ thuộc vào một điều kiện tiên quyết không được viết ra: người gọi phải đang ở trong
    // một transaction. `assertTenantBound` KHÔNG đòi điều đó.
    const { rows: sau } = await client.query<{ locked_until: Date | null }>(
      `UPDATE invitation_otp_challenges c
          SET failed_attempts = c.failed_attempts + 1,
              locked_until = CASE WHEN c.failed_attempts + 1 >= $2::int
                                  THEN now() + make_interval(secs => $3) ELSE c.locked_until END
        WHERE c.id = $1
        RETURNING c.locked_until`,
      [tt.id, OTP_MAX_FAILED_ATTEMPTS, OTP_LOCKOUT_SECONDS],
    );
    // [REVIEW AN NINH S1.3 — MED-2] `rowCount` PHẢI được kiểm, và đây là một bất đối xứng đã đo
  // trong chính file này: đường TIÊU THỤ ba dòng dưới có `if (danhVi.rowCount !== 1)`, đường ĐẾM
  // thì không. Nếu câu `UPDATE` này chạm 0 hàng — RLS đổi, GRANT bị thu, một trigger tương lai
  // trả `NULL` — thì `sau` rỗng, `bikhoa` là `false`, hàm trả `WRONG_CODE`, và LẦN THỬ ẤY KHÔNG
  // ĐƯỢC ĐẾM. Trần 5 lần đoán của E3 lặng lẽ thành vô hạn, không một dòng nào đỏ.
  //
  // Một lần thử KHÔNG ĐẾM ĐƯỢC phải TỪ CHỐI, không được rơi xuống `WRONG_CODE`.
  if (sau.length !== 1) {
    throw new InvitationError(
      "không ghi nhận được lần thử OTP — từ chối thay vì bỏ qua phép đếm (E3)",
    );
  }
  const bikhoa = sau[0]?.locked_until != null;
    return { ok: false, reason: bikhoa ? "LOCKED_OUT" : "WRONG_CODE" };
  }

  const danhDau = await client.query(
    "UPDATE invitation_otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
    [tt.id],
  );
  if (danhDau.rowCount !== 1) return { ok: false, reason: "ALREADY_USED" };

  // [H5] Tiêu thụ token cùng lượt.
  await client.query(
    "UPDATE rfq_invitation_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
    [t.token_id],
  );

  const sessionToken = randomBytes(GUEST_SESSION_TOKEN_BYTES).toString("base64url");
  const phien = await client.query<{ id: string }>(
    `INSERT INTO guest_sessions
       (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel,
        expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7)) RETURNING id`,
    [orgId, t.invitation_id, tt.id, bam(sessionToken), tt.contact_id, tt.channel, ttl],
  );
  const hangPhien = phien.rows[0];
  if (hangPhien === undefined) throw new InvitationError("INSERT guest_sessions không trả về hàng");

  // [ADR-016] `actorId` là chính `tt.contact_id` — người liên hệ ĐÃ GIỮ KÊNH và đã đối chiếu
  // đúng mã. Nó là cùng một giá trị với `verified_contact_id` của hàng phiên, và đó là chủ ý:
  // sổ kiểm toán và bảng phiên phải kể CÙNG một câu chuyện, nếu không thì một trong hai đang
  // nói dối và không lớp nào biết cái nào.
  //
  // PHẦN HẸP PHẢI NÓI RA, và nó là phần ADR-015 đã ghi cho E5: đây là NGƯỜI GIỮ KÊNH, không
  // phải con người đang ngồi trước màn hình.
  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: tt.contact_id,
    action: "GUEST_SESSION_STARTED",
    resourceType: "guest_session",
    resourceId: hangPhien.id,
    payload: {
      invitationId: t.invitation_id,
      challengeId: tt.id,
      verifiedContactId: tt.contact_id,
      verifiedChannel: tt.channel,
    },
  });

  return {
    ok: true,
    sessionId: hangPhien.id,
    sessionToken,
    verifiedContactId: tt.contact_id,
    verifiedChannel: tt.channel,
  };
}

/**
 * [C3] Thu hồi nay chạm CẢ BA đường: token, thách thức OTP đang mở, và phiên khách đang sống.
 *
 * Bản trước chỉ chạm token, và `verifyOtpAndStartSession` không đọc trạng thái lời mời — nên sau
 * khi người mua phát hiện link bị rò và thu hồi, kẻ tấn công vẫn phát được OTP và vẫn mở được một
 * phiên mới. Đo được: `sau THU HOI van mo duoc PHIEN MOI: CO`.
 *
 * [M4] Sự kiện kiểm toán chỉ được ghi khi THẬT SỰ có hàng đổi. Bản trước ghi `INVITATION_REVOKED`
 * kể cả khi hai câu UPDATE chạm 0 hàng (id không tồn tại, hoặc thuộc tổ chức khác và bị RLS lọc)
 * — tức sổ kiểm toán chứa một sự kiện thu hồi chưa từng xảy ra.
 */
export async function revokeInvitation(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly invitationId: string; readonly actorSessionId: string },
): Promise<boolean> {
  await assertTenantBound(client, orgId, "revokeInvitation");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  // [ADR-016] Hai cột người thu hồi đi TRONG CÙNG câu lệnh đặt `revoked_at`, không phải một
  // câu UPDATE thứ hai: trigger `rfq_invitations_kiem_nguoi_thu_hoi` (013) chạy đúng ở lượt
  // chuyển sang đã-thu-hồi, nên tách ra là để lại một hàng đã thu hồi mà chưa ai ký tên.
  const loiMoi = await client.query(
    "UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now(), " +
      " revoked_by = $2, revoked_by_session_id = $3" +
      " WHERE id = $1 AND revoked_at IS NULL",
    [input.invitationId, actor.id, actor.sessionId],
  );
  if (loiMoi.rowCount !== 1) return false;

  await client.query(
    "UPDATE rfq_invitation_tokens SET revoked_at = now() " +
      " WHERE invitation_id = $1 AND revoked_at IS NULL",
    [input.invitationId],
  );
  await client.query(
    "UPDATE invitation_otp_challenges SET consumed_at = now() " +
      " WHERE invitation_id = $1 AND consumed_at IS NULL",
    [input.invitationId],
  );
  await client.query(
    "UPDATE guest_sessions SET revoked_at = now() " +
      " WHERE invitation_id = $1 AND revoked_at IS NULL",
    [input.invitationId],
  );

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "INVITATION_REVOKED",
    resourceType: "rfq_invitation",
    resourceId: input.invitationId,
  });
  return true;
}
