import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
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
/**
 * Theo ĐÍCH ~~— chạm trần thì LÀM CHẬM, không khoá.~~
 *
 * [khoản nợ 35] CÂU VỪA GẠCH LÀ MỘT LỜI HỨA MÀ MÃ KHÔNG GIỮ, và nó đứng đây suốt từ S1.3.
 * ADR-015 §5 viết rõ: *"hạn mức theo đích chỉ được **làm chậm**, không được **khoá**, vì khoá
 * theo đích cho phép một người khoá lối vào của người khác."* Bản cài đặt trả thẳng
 * `DEST_RATE_LIMITED` — một lần từ chối, không một lần chậm.
 *
 * Và khoá bucket là `HMAC(pepper, orgId ‖ "DEST" ‖ đích)` — **không mang lời mời, không mang
 * RFQ**. Hai điều ấy cộng lại thành một đường CHẶN NGƯỜI KHÁC DỰ THẦU: ai cầm một link đã chuyển
 * tiếp cho RFQ-1 phát ba lần OTP về số của nhà cung cấp, và chính nhà cung cấp ấy không nhận
 * được OTP cho RFQ-2 của một bên mua khác trong 15 phút.
 *
 * Nay tách làm HAI bucket, và mỗi cái trả lời một câu khác nhau:
 *   • theo (LỜI MỜI, ĐÍCH) — hạn mức THẬT, và nó không xuyên qua lời mời được nữa;
 *   • theo ĐÍCH toàn tổ chức — một TRẦN CHI PHÍ, đặt cao hơn hẳn mức dùng bình thường, để nó
 *     không bao giờ là thứ ba lời gọi vũ khí hoá được.
 */
export const OTP_MAX_PER_DEST = 3;
/**
 * [khoản nợ 35] Trần CHI PHÍ theo đích, toàn tổ chức. Nó tồn tại để chặn một lượt gửi hàng loạt
 * về một số điện thoại, KHÔNG để làm hạn mức của một lời mời — nên nó phải cao hơn hẳn tích
 * `OTP_MAX_PER_INVITATION` × (số lời mời hợp lý cùng nhắm một người trong một cửa sổ 15 phút).
 */
export const OTP_MAX_PER_DEST_TOAN_TO_CHUC = 20;
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
    `INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel,
                                  invited_by, invited_by_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COT_INVITATION}`,
    [orgId, input.rfqId, input.supplierId, input.contactId, input.linkChannel ?? "EMAIL",
     actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("Câu INSERT rfq_invitations không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "INVITATION_CREATED",
    resourceType: "RFQ_INVITATION",
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
    `INSERT INTO public.rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at,
                                        issued_by, issued_by_session_id)
     VALUES ($1, $2, $3, 'BID_SUBMISSION', pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $4), $5, $6)
     RETURNING id, expires_at`,
    [orgId, input.invitationId, bam(token), ttl, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new InvitationError("Câu INSERT token không trả về hàng nào");

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
/*
 * [khoản nợ 36] TOÁN TỬ VÀ TÊN KIỂU ĐƯỢC GHIM Ở ĐÂY, VÀ ĐÂY LÀ PHÉP SO CHỊU LỰC DUY NHẤT CỦA CẢ
 * LÁT CẮT.
 *
 * `packages/audit/src/tenant-guard.ts` ghi lại một lần khai thác đã được TÁI LẬP END-TO-END:
 * một `=` bị chiếm cộng một tên kiểu không ghim đã LẬT một phán quyết an ninh trên mã sản phẩm.
 * Ba gói (`audit`, `identity`, `outbox`) ghim `OPERATOR(pg_catalog.=)` 127 lần vì lần ấy; gói
 * này thì ZERO lần cho tới vòng sửa này.
 *
 * Một `=` bị chiếm trên `bytea` ở đây làm MỌI chuỗi ứng viên khớp hàng token đầu tiên nhìn thấy
 * được — tức magic link thôi là một bí mật.
 *
 * NÓI ĐÚNG MỨC: tiền đề của cuộc tấn công ấy (`CREATE` trên một schema nằm trên `search_path`)
 * đã bị `hardening.always.sql` thu hồi cho `app_api` trên `public`. Nhưng chính file ấy ghi rằng
 * `ALTER ROLE ... SET search_path` và biến thể `?options=-c search_path=` **không** được che —
 * *"chặn 0%, vĩnh viễn"*. Nên đây là một lớp thứ hai cho một tiền đề chưa đóng hết.
 */
/**
 * [khoản nợ 36] KHẲNG ĐỊNH NGƯỜI GỌI ĐANG Ở TRONG MỘT GIAO DỊCH — và nó là một phép ĐO, không
 * phải một lời hứa trong chú thích.
 *
 * Cổng OTP đọc trạng thái (`dang_khoa`, `da_dung`, `het_han`) ở MỘT câu `FOR UPDATE` rồi tăng bộ
 * đếm ở câu KHÁC. Ngoài giao dịch, `FOR UPDATE` nhả khoá ngay cuối câu ấy, nên N lời gọi đồng
 * thời đều đọc `dang_khoa = false`, đều so mã, đều tăng — bộ đếm cuối cùng vẫn đúng bằng N, mà
 * kẻ tấn công đã có N lần đoán ở chỗ E3 hứa 5. Không có hạn mức nào trên đường ĐỐI CHIẾU.
 *
 * Chú thích cũ ở thân hàm nói biểu thức tự tham chiếu là *"thứ đúng kể cả khi không có khoá"* —
 * câu ấy đúng cho BỘ ĐẾM và SAI cho CỔNG, và phần sai đã được sửa tại chỗ.
 *
 * ~~PHÉP ĐO: trong một giao dịch nhiều câu lệnh, `now()` đứng yên ở mốc BẮT ĐẦU GIAO DỊCH trong~~
 * ~~khi `statement_timestamp()` tiến theo từng câu — nên `statement_timestamp() > now()`.~~
 *
 * **BẢN ĐẦU ẤY ĐÃ ĐỎ GIẢ, VÀ NÓ ĐỎ TRÊN MỘT TEST HỢP LỆ.** Hai mốc ấy có độ phân giải micro
 * giây, và một lời gọi qua socket cục bộ chạy xong trong CÙNG micro giây với lúc mở giao dịch —
 * nên `statement_timestamp() = now()` ở một lượt gọi hoàn toàn đúng luật. Một hàng rào phụ thuộc
 * ĐỘ PHÂN GIẢI ĐỒNG HỒ là một hàng rào chập chờn, và nó tệ hơn không có: nó dạy người ta chạy
 * lại cho tới khi xanh.
 *
 * PHÉP ĐO THẬT SỰ TẤT ĐỊNH: `SET LOCAL` chỉ có tác dụng TRONG một khối giao dịch. Ngoài giao
 * dịch, PostgreSQL phát một WARNING và giá trị KHÔNG sống qua câu kế tiếp — vì câu kế tiếp là
 * một giao dịch khác. Nên đọc lại nó ở câu thứ hai là một câu trả lời nhị phân, không phụ thuộc
 * thời gian, máy, hay tải.
 */
async function batBuocTrongGiaoDich(client: pg.PoolClient, ten: string): Promise<void> {
  await client.query("SET LOCAL trustprocure.trong_giao_dich = '1'");
  const { rows } = await client.query<{ v: string | null }>(
    "SELECT pg_catalog.current_setting('trustprocure.trong_giao_dich', true) AS v",
  );
  if (rows[0]?.v !== "1") {
    throw new InvitationError(
      `${ten} phải chạy TRONG một giao dịch: cổng OTP đọc trạng thái ở một câu và tăng bộ đếm ` +
        "ở câu khác, nên ngoài giao dịch `FOR UPDATE` không tuần tự hoá được và trần số lần " +
        "đoán của E3 thành vô hạn.",
    );
  }
}

async function docToken(client: pg.PoolClient, orgId: string, token: string): Promise<HangToken> {
  const { rows } = await client.query<HangToken>(
    `SELECT t.id AS token_id, i.id AS invitation_id, i.contact_id, i.supplier_id, i.link_channel
       FROM public.rfq_invitation_tokens t
       JOIN public.rfq_invitations i
         ON i.id OPERATOR(pg_catalog.=) t.invitation_id
        AND i.org_id OPERATOR(pg_catalog.=) t.org_id
      WHERE t.token_hash OPERATOR(pg_catalog.=) $1::pg_catalog.bytea
        AND t.purpose OPERATOR(pg_catalog.=) 'BID_SUBMISSION'::pg_catalog.text
        AND t.expires_at OPERATOR(pg_catalog.>) pg_catalog.now()
        AND t.revoked_at IS NULL
        AND t.consumed_at IS NULL
        AND i.status OPERATOR(pg_catalog.<>) 'REVOKED'::pg_catalog.text
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

/**
 * [sổ nợ 39 / migration 038] Cửa CÔNG KHAI của bộ đếm bucket, và nó chỉ mở ĐÚNG MỘT kind:
 * `LOGIN_CALLER` — người gọi ba route đăng nhập người mua. Bốn kind của OTP khách ở lại trong gói:
 * chúng là một phần của `issueOtpChallenge` (thứ tự tăng và phán quyết là thiết kế — khối [khoản nợ
 * 35] bên dưới), và mở chúng ra là cho một handler ngoài gói tiêu ngân sách của khách.
 *
 * Trả về số lần ĐÃ ĐẾM trong cửa sổ hiện tại (kể cả lần này). Người gọi phán quyết; hàm này không
 * ném vì vượt trần — cùng khuôn "đếm trước, phán sau" của [khoản nợ 35].
 */
export async function tangBucketHanMuc(
  client: pg.PoolClient,
  orgId: string,
  kind: "LOGIN_CALLER",
  khoa: string,
  pepper: PepperRing,
): Promise<number> {
  return demVaTang(client, orgId, kind, khoa, pepper);
}

/**
 * [sổ nợ 55 / migration 042] Bộ đếm theo NGƯỜI GỌI **TOÀN CỤC** — bảng `caller_rate_limits`, không
 * `org_id`, không khoá ngoại. Một lời gọi khai tổ chức KHÔNG tồn tại tăng ĐÚNG HÀNG mà một lời gọi
 * khai tổ chức thật tăng, nên 429 không còn phân biệt được hai ca (review H5-3/H4-5).
 *
 * Không nhận `orgId` và KHÔNG gọi `assertTenantBound`: bảng này cố ý nằm ngoài cây tenant, và nhận
 * một `orgId` chỉ để bỏ đi là mời người sau tưởng nó có tác dụng. Trả về số lần đã đếm trong cửa sổ
 * hiện tại (kể cả lần này); người gọi phán quyết — cùng khuôn "đếm trước, phán sau".
 */
export async function tangBucketNguoiGoi(
  client: pg.PoolClient,
  khoa: string,
  pepper: PepperRing,
): Promise<number> {
  const { rows } = await client.query<{ hits: number }>(
    `INSERT INTO public.caller_rate_limits (bucket_hash, window_start, hits)
     VALUES ($1, pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.now()) OPERATOR(pg_catalog./) $2) * $2), 1)
     ON CONFLICT (bucket_hash, window_start)
       DO UPDATE SET hits = caller_rate_limits.hits OPERATOR(pg_catalog.+) 1
     RETURNING hits`,
    [pepper.bam(MIEN_BUCKET_TOAN_CUC, khoa).hash, OTP_RATE_WINDOW_SECONDS],
  );
  // [review H6-9] KHÔNG `?? 0`: một trần không đếm được phải NÉM, không được đi tiếp như chưa ai gõ
  // cửa. `DO UPDATE … RETURNING` luôn trả một hàng ở PostgreSQL, nên nhánh này là phòng thủ cho ngày
  // câu lệnh đổi — và hướng của giá trị mặc định là thứ chọn được mà không cần biết ca ấy có thật.
  const hits = rows[0]?.hits;
  if (hits === undefined) throw new InvitationError("bộ đếm hạn mức không trả về số lần — không phán quyết được");
  return hits;
}

/**
 * [sổ nợ 55] Dọn `caller_rate_limits`. Hàng ở bảng ấy do người gọi VÔ DANH tạo (không cần một tổ
 * chức thật nào), nên nó là bảng DUY NHẤT của dự án mà số hàng do kẻ tấn công chọn. Xoá mọi cửa sổ
 * cũ hơn `soCuaSo` lần cửa sổ — mặc định 2, tức không bao giờ chạm cửa sổ đang đếm lẫn cửa sổ ngay
 * trước nó. Trả về số hàng đã xoá. Nhận `pg.Pool` chứ không `PoolClient`: đây là việc NỀN, không
 * thuộc giao dịch của một yêu cầu nào.
 */
export async function donBucketNguoiGoiCu(pool: pg.Pool, soCuaSo = 2): Promise<number> {
  // [S1.59 / khoản nợ 99] Giao dịch TƯỜNG MINH thay vì một `pool.query` tự commit: câu tự commit không có COMMIT nào để gác, nên một
  // trigger hay hàm đặt replica ở phạm vi phiên giữa câu dọn thì thay đổi của câu ấy được commit (đo: bản trước trả số hàng và hàng
  // biến mất). Giá: hai vòng đi-về thêm cho một việc nền năm phút một lần.
  const client = await pool.connect();
  let loiHuy: Error | undefined;
  try {
    await client.query("BEGIN");
    const kq = await client.query(
      "DELETE FROM public.caller_rate_limits WHERE window_start OPERATOR(pg_catalog.<) (pg_catalog.now() OPERATOR(pg_catalog.-) pg_catalog.make_interval(secs => $1::pg_catalog.float8))",
      [OTP_RATE_WINDOW_SECONDS * soCuaSo],
    );
    await commitKhongDuoiReplica(client, "bộ dọn caller_rate_limits");
    return kq.rowCount ?? 0;
  } catch (loi) {
    loiHuy = loi as Error;
    // Không nuốt: `ROLLBACK` kết thúc giao dịch ở máy chủ ngay, không chờ socket đóng; lỗi THẬT vẫn bay lên.
    await client.query("ROLLBACK").catch(() => undefined);
    throw loi;
  } finally {
    // [S1.59 / lượt soi 52 INFO-1] Lỗi thì HUỶ kết nối, không trả về pool — xem `CAU_COMMIT_CHAN_REPLICA`.
    client.release(loiHuy);
  }
}

/**
 * [S1.59 / khoản nợ 99] Câu kết thúc giao dịch của hai bộ dọn nền: khối DO ném SQLSTATE `TP096` khi `session_replication_role` không
 * phải origin/local, và COMMIT, trong CÙNG một câu nhiều lệnh — nguyên văn ⑴ của `withTenant` (khoản 96). DO ném thì PostgreSQL bỏ
 * phần còn lại của câu nên COMMIT không chạy; ROLLBACK ở `catch` của bộ dọn hoàn cả thay đổi lẫn giá trị replica đặt trong giao dịch,
 * rồi bộ dọn HUỶ kết nối — trên mọi lỗi, vì ROLLBACK không hoàn giá trị đặt TRƯỚC giao dịch (replica nhiễm sẵn trên một pool không vai)
 * và một ROLLBACK hỏng để lại kết nối không rõ trạng thái (lượt soi 52 INFO-1). Hai bộ dọn chạy trên pool, NGOÀI `withTenant`, nên không
 * lớp nào khác gác commit của chúng: một hàm hay trigger đặt replica ở phạm vi phiên giữa câu dọn (tên dựng lúc chạy — hardening quét
 * tĩnh không thấy) thì phần còn lại của giao dịch bỏ qua trigger ENABLE thường và khoá ngoại. Chép chứ không import: một hàm dùng chung
 * với withTenant đòi một cạnh gói mới (`invitation` không phụ thuộc `tenancy`, `tenancy` không phụ thuộc `@trustprocure/db`) cho một hằng
 * và một phép ánh xạ lỗi (lượt soi 52 INFO-7). Hai bản không trôi được mà không đỏ: census
 * `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` vế ⒝ đòi MỌI lệnh COMMIT của mã sản xuất đi sau đúng khối này, và tệp mang
 * khối có nhánh so SQLSTATE với TP096.
 */
const CAU_COMMIT_CHAN_REPLICA =
  "DO $kiem_khoan_96$BEGIN " +
  "IF pg_catalog.current_setting('session_replication_role') OPERATOR(pg_catalog.<>) 'origin' " +
  "AND pg_catalog.current_setting('session_replication_role') OPERATOR(pg_catalog.<>) 'local' " +
  "THEN RAISE SQLSTATE 'TP096'; END IF; END$kiem_khoan_96$; COMMIT";

/** Kết thúc giao dịch của một bộ dọn bằng `CAU_COMMIT_CHAN_REPLICA`; TP096 thành `InvitationError` nêu tên GUC, không giá trị. */
async function commitKhongDuoiReplica(client: pg.PoolClient, boDon: string): Promise<void> {
  try {
    await client.query(CAU_COMMIT_CHAN_REPLICA);
  } catch (loi) {
    if ((loi as { code?: unknown }).code === "TP096") {
      throw new InvitationError(
        `${boDon}: session_replication_role không phải origin/local lúc COMMIT (TP096) — một hàm hay trigger đã ghi GUC ấy vào phiên ` +
          "trong giao dịch dọn. COMMIT không chạy: không hàng nào bị xoá, và kết nối bị huỷ.",
      );
    }
    throw loi;
  }
}

/**
 * [sổ nợ 57 / migration 044] Dọn `otp_rate_limits`. ~~`otp_rate_limits` KHÔNG có bộ dọn, và không
 * có ở đây là một quyết định có lý do chứ không phải một lần quên: bảng ấy bật RLS theo `org_id`,
 * nên một `DELETE` nền (ngoài `withTenant`) lọc hết và xoá 0 hàng; còn dọn TỪNG TỔ CHỨC đòi biết
 * tập tổ chức, mà `app_api` không đọc được danh sách ấy (cùng ràng buộc đã buộc runner outbox nhận
 * `listOrganizations` — ADR-022), và tập "tổ chức đã thấy" của tiến trình `api` không phủ các tổ
 * chức chỉ có lưu lượng KHÁCH.~~ Cả ba câu ấy vẫn ĐÚNG; thứ đổi là `044` không đi đường nào trong
 * ba: nó thêm một policy `FOR DELETE` chỉ có hiệu lực trên kết nối CHƯA gắn tổ chức, và chỉ trên
 * hàng đã quá SÀN 30 phút. Nên hàm này KHÔNG hỏi "tổ chức nào" — nó hỏi "hàng này còn chặn được ai".
 *
 * KHÔNG có tham số tuổi, và KHÔNG THỂ có — đây là phần đắt nhất của thiết kế và nó phải đọc được
 * ngay ở đây. PostgreSQL đòi policy `SELECT` cho một `DELETE` NGAY KHI câu lệnh tham chiếu cột của
 * bảng, kể cả chỉ trong `WHERE`. Bộ dọn cố ý KHÔNG có đường đọc (policy của nó là `FOR DELETE`, để
 * `[INV-F1]` còn đúng), nên một câu `DELETE … WHERE window_start < …` xoá ĐÚNG 0 hàng — đã đo. Câu
 * TRẦN không tham chiếu cột nào; PostgreSQL tự AND vế `USING` của policy vào, nên mốc tuổi do CSDL
 * áp. Hệ quả: `044` là nơi DUY NHẤT con số 30 phút có hiệu lực, và `don-bucket.test.ts` canh nó.
 *
 * Nhận `pg.Pool` chứ không `PoolClient` vì đây là việc NỀN, và vì câu trần chỉ an toàn trên kết nối
 * CHƯA gắn tổ chức: gắn rồi thì policy cách ly duyệt mọi hàng của tổ chức ấy — kể cả cửa sổ đang
 * đếm — và bộ đếm hạn mức của họ về 0. Không lớp nào ở CSDL phân biệt được ca ấy với một lệnh dọn
 * hợp lệ, nên phép phân biệt nằm ở đây: lấy client, HỎI `app.org_id`, rồi mới xoá.
 */
export async function donOtpRateLimitsCu(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  let loiHuy: Error | undefined;
  try {
    // [review H7-6] MỘT giao dịch, và có TRẦN THỜI GIAN. Câu dọn quét TOÀN BẢNG (vế lọc là OR của
    // hai policy trên hai cột nên không chỉ số nào phục vụ được — đã đo bằng EXPLAIN, xem `044`),
    // nên chi phí của nó lớn theo số hàng. Không có trần, một lần dọn bệnh lý giữ một kết nối của
    // pool YÊU CẦU vô hạn định; có trần, nó hỏng ỒN ÀO và bộ đếm "hỏng liên tiếp" ở composition
    // nhìn thấy. `SET LOCAL` chứ không `SET`: kết nối trả về pool không được mang theo trạng thái.
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${TRAN_DON_MS}`);
    const { rows } = await client.query<{ tu_do: boolean }>(
      "SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '') IS NULL AS tu_do",
    );
    if (rows[0]?.tu_do !== true) {
      throw new InvitationError(
        "bộ dọn otp_rate_limits nhận một kết nối ĐÃ gắn tổ chức — câu DELETE trần ở đó sẽ xoá cả " +
          "cửa sổ đang đếm của tổ chức ấy",
      );
    }
    const kq = await client.query("DELETE FROM public.otp_rate_limits");
    // [S1.59 / khoản nợ 99] COMMIT mang khối chặn replica — xem `CAU_COMMIT_CHAN_REPLICA`.
    await commitKhongDuoiReplica(client, "bộ dọn otp_rate_limits");
    return kq.rowCount ?? 0;
  } catch (loi) {
    loiHuy = loi as Error;
    // Không nuốt: `ROLLBACK` kết thúc giao dịch ở máy chủ ngay, không chờ socket đóng; lỗi THẬT vẫn bay lên.
    await client.query("ROLLBACK").catch(() => undefined);
    throw loi;
  } finally {
    // [S1.59 / lượt soi 52 INFO-1] Lỗi thì HUỶ kết nối, không trả về pool — xem `CAU_COMMIT_CHAN_REPLICA`.
    client.release(loiHuy);
  }
}

/**
 * [review H7-6] Trần thời gian của MỘT lượt dọn `otp_rate_limits`, mili-giây. Không phải một ngưỡng
 * hiệu năng: nó là mốc mà quá đó thì "đang dọn" và "đang treo" không phân biệt được nữa, và một
 * kết nối của pool yêu cầu bị giữ là cái giá thật. Rộng hơn nhiều so với phép đo (20 000 hàng =
 * 9,5 ms) vì nó không được kêu ở tải bình thường.
 */
const TRAN_DON_MS = 60_000;

/** Miền băm của bucket toàn cục — tách khỏi `org_id ‖ kind` của `otp_rate_limits` (042). */
const MIEN_BUCKET_TOAN_CUC = "LOGIN_CALLER_TOAN_CUC";

async function demVaTang(
  client: pg.PoolClient,
  orgId: string,
  kind: "DEST" | "DEST_ORG" | "CALLER" | "INVITATION" | "LOGIN_CALLER",
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
    `INSERT INTO public.otp_rate_limits (org_id, bucket_kind, bucket_hash, window_start, hits)
     VALUES ($1, $2, $3,
             pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.now()) OPERATOR(pg_catalog./) $4) * $4), 1)
     ON CONFLICT (org_id, bucket_kind, bucket_hash, window_start)
       DO UPDATE SET hits = otp_rate_limits.hits OPERATOR(pg_catalog.+) 1
     RETURNING hits`,
    [orgId, kind, pepper.bam(orgId, kind, khoa).hash, OTP_RATE_WINDOW_SECONDS],
  );
  // [review H6-9] Cùng lý do với `tangBucketNguoiGoi`: fail-closed, không fail-open.
  const hits = rows[0]?.hits;
  if (hits === undefined) throw new InvitationError("bộ đếm hạn mức không trả về số lần — không phán quyết được");
  return hits;
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
    `SELECT ${cot} AS dich FROM public.supplier_contacts WHERE id OPERATOR(pg_catalog.=) $1`,
    [t.contact_id],
  );
  const dich = lh[0]?.dich ?? null;
  if (dich === null || dich.length === 0) {
    // ADR-015 và 008 đã ghim hệ quả này: lời mời phải BỊ TỪ CHỐI khi thiếu kênh, KHÔNG được lặng
    // lẽ rơi về email — rơi về email là đúng thứ ADR-015 mục 1 cấm.
    throw new InvitationError("người liên hệ chưa có kênh đã đăng ký cho loại kênh này");
  }

  // [khoản nợ 35] BỐN bucket, và THỨ TỰ TĂNG là một phần của thiết kế: mọi bucket đều được tăng
  // TRƯỚC mọi phán quyết. Một lần từ chối vì thế vẫn tiêu ngân sách của cả bốn — cố ý, vì chúng
  // là TRẦN CHI PHÍ: một lời gọi đã tốn một lượt ghi CSDL dù nó bị từ chối ở đâu.
  //
  // Bản trước xen kẽ tăng và phán quyết, nên một lần bị chặn ở bucket cuối vẫn tiêu ngân sách của
  // hai bucket đầu MÀ KHÔNG NÓI RA — cùng hệ quả, khác chỗ: nó là một tác dụng phụ chứ không một
  // quyết định.
  const soLanNguoiGoi = await demVaTang(client, orgId, "CALLER", input.callerFingerprint, input.pepper);
  const soLanLoiMoi = await demVaTang(client, orgId, "INVITATION", t.invitation_id, input.pepper);
  // Khoá mang CẢ lời mời: đây là thứ làm hạn mức thôi xuyên qua lời mời được. `invitation_id` là
  // một UUID dài cố định nên dấu hai chấm không tạo ra hai khoá đụng nhau.
  const soLanDich = await demVaTang(client, orgId, "DEST", `${t.invitation_id}:${dich}`, input.pepper);
  const soLanDichChung = await demVaTang(client, orgId, "DEST_ORG", dich, input.pepper);

  if (soLanNguoiGoi > OTP_MAX_PER_CALLER) {
    throw new InvitationError("vượt giới hạn tần suất theo người gọi");
  }
  if (soLanLoiMoi > OTP_MAX_PER_INVITATION) {
    throw new InvitationError("vượt giới hạn tần suất theo lời mời");
  }
  if (soLanDich > OTP_MAX_PER_DEST || soLanDichChung > OTP_MAX_PER_DEST_TOAN_TO_CHUC) {
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
    `INSERT INTO public.invitation_otp_challenges
       (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash,
        pepper_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, pg_catalog.now() OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $9)) RETURNING id`,
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
  if (hang === undefined) throw new InvitationError("Câu INSERT thách thức OTP không trả về hàng nào");

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
  await batBuocTrongGiaoDich(client, "verifyOtpAndStartSession");

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
            (expires_at OPERATOR(pg_catalog.<=) pg_catalog.now()) AS het_han,
            (consumed_at IS NOT NULL) AS da_dung,
            (locked_until IS NOT NULL
             AND locked_until OPERATOR(pg_catalog.>) pg_catalog.now()) AS dang_khoa
       FROM public.invitation_otp_challenges
      WHERE invitation_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND token_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
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
      `UPDATE public.invitation_otp_challenges c
          SET failed_attempts = c.failed_attempts OPERATOR(pg_catalog.+) 1,
              locked_until = CASE WHEN (c.failed_attempts OPERATOR(pg_catalog.+) 1)
                                       OPERATOR(pg_catalog.>=) $2::pg_catalog.int4
                                  THEN (pg_catalog.now()
                                        OPERATOR(pg_catalog.+)
                                        pg_catalog.make_interval(secs => $3::pg_catalog.float8))
                                  ELSE c.locked_until END
        WHERE c.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
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
    "UPDATE public.invitation_otp_challenges SET consumed_at = pg_catalog.now() " +
      "WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND consumed_at IS NULL",
    [tt.id],
  );
  if (danhDau.rowCount !== 1) return { ok: false, reason: "ALREADY_USED" };

  // [H5] Tiêu thụ token cùng lượt.
  await client.query(
    "UPDATE public.rfq_invitation_tokens SET consumed_at = pg_catalog.now() " +
      "WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND consumed_at IS NULL",
    [t.token_id],
  );

  const sessionToken = randomBytes(GUEST_SESSION_TOKEN_BYTES).toString("base64url");
  const phien = await client.query<{ id: string }>(
    `INSERT INTO public.guest_sessions
       (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel,
        expires_at)
     VALUES ($1, $2, $3, $4, $5, $6,
             (pg_catalog.now()
              OPERATOR(pg_catalog.+)
              pg_catalog.make_interval(secs => $7::pg_catalog.float8)))
     RETURNING id`,
    [orgId, t.invitation_id, tt.id, bam(sessionToken), tt.contact_id, tt.channel, ttl],
  );
  const hangPhien = phien.rows[0];
  if (hangPhien === undefined) throw new InvitationError("Câu INSERT guest_sessions không trả về hàng");

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
/**
 * [khoản nợ 37] Gỡ khoá OTP của một lời mời — ĐƯỜNG RA của một khoá vốn không có đường ra.
 *
 * Khoá cấp-lời-mời (012 §H3) chặn MỌI lần phát thách thức mới khi còn một thách thức đang khoá.
 * Đó là phép sửa đúng cho một khiếm khuyết đã đo, nhưng nó tạo ra một đường CHẶN NGƯỜI KHÁC DỰ
 * THẦU: ai cầm một link đã chuyển tiếp đoán sai năm lần là giữ được nhà cung cấp thật ở ngoài
 * 900 giây, lặp lại vô hạn, và tới trước hàm này KHÔNG có gì gỡ.
 *
 * Ba thứ hàm này KHÔNG làm, và cả ba là cố ý:
 *   ✘ không đặt lại `failed_attempts` — trigger của 024 chặn cả việc ấy ở tầng CSDL. Gỡ khoá là
 *     một HÀNH VI, không phải một lần xoá dấu vết;
 *   ✘ không tiêu thụ hay huỷ thách thức đang khoá — nó vẫn hết hạn theo lịch của nó;
 *   ✘ không phát một mã mới — người mua gỡ khoá, nhà cung cấp mới là người xin mã.
 */
export async function clearOtpLockout(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly invitationId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<{ readonly cleared: number }> {
  await assertTenantBound(client, orgId, "clearOtpLockout");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.INVITATION_UNLOCK,
      resourceType: "RFQ_INVITATION",
      resourceId: input.invitationId,
    },
    auditPool,
  );

  const { rowCount } = await client.query(
    `UPDATE public.invitation_otp_challenges SET locked_until = NULL
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND invitation_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND locked_until IS NOT NULL
        AND locked_until OPERATOR(pg_catalog.>) pg_catalog.now()`,
    [orgId, input.invitationId],
  );

  // Ghi sổ kể cả khi KHÔNG có khoá nào để gỡ: *"ai đã thử gỡ khoá lời mời này"* là một câu kiểm
  // toán viên hỏi, và một lần gỡ hụt cũng là một lần ai đó chạm vào.
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "INVITATION_OTP_LOCKOUT_CLEARED",
    resourceType: "RFQ_INVITATION",
    resourceId: input.invitationId,
    payload: { cleared: rowCount ?? 0 },
  });
  return { cleared: rowCount ?? 0 };
}

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
    "UPDATE public.rfq_invitations SET status = 'REVOKED', revoked_at = pg_catalog.now(), " +
      " revoked_by = $2, revoked_by_session_id = $3" +
      " WHERE id OPERATOR(pg_catalog.=) $1 AND revoked_at IS NULL",
    [input.invitationId, actor.id, actor.sessionId],
  );
  if (loiMoi.rowCount !== 1) return false;

  await client.query(
    "UPDATE public.rfq_invitation_tokens SET revoked_at = pg_catalog.now() " +
      " WHERE invitation_id OPERATOR(pg_catalog.=) $1 AND revoked_at IS NULL",
    [input.invitationId],
  );
  await client.query(
    "UPDATE public.invitation_otp_challenges SET consumed_at = pg_catalog.now() " +
      " WHERE invitation_id OPERATOR(pg_catalog.=) $1 AND consumed_at IS NULL",
    [input.invitationId],
  );
  await client.query(
    "UPDATE public.guest_sessions SET revoked_at = pg_catalog.now() " +
      " WHERE invitation_id OPERATOR(pg_catalog.=) $1 AND revoked_at IS NULL",
    [input.invitationId],
  );

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "INVITATION_REVOKED",
    resourceType: "RFQ_INVITATION",
    resourceId: input.invitationId,
  });
  return true;
}

// ==============================================================================================
// [ADR-020 mục 4 — S1.10.2] COOKIE KHÁCH → PHIÊN KHÁCH, bằng BĂM. Đường vào của `withGuestSession`.
//
// `verifyOtpAndStartSession` trả `sessionToken` dạng rõ và ghi `bam(sessionToken)` xuống
// `guest_sessions.token_hash` (010 có `UNIQUE (org_id, token_hash)`). Tầng HTTP cầm token ấy từ
// cookie và cần `guest_sessions.id` để gọi `withGuestSession` — hàm này là mắt xích đó.
//
// Nó CHỈ tra, KHÔNG gắn GUC: gắn là việc của `withGuestSession`, và nó phải chạy ở một giao dịch
// KHÁC (đọc lại hàng phiên, từ chối thu hồi/hết hạn, đặt cả ba GUC, đọc lại cả ba). Một hàm vừa
// tra vừa gắn là một chỗ để hai phép kiểm lệch nhau. Mọi ca hỏng ném CÙNG MỘT thông điệp.
// ==============================================================================================

export interface ResolvedGuestSession {
  readonly guestSessionId: string;
  readonly invitationId: string;
  /** DẪN XUẤT qua `rfq_invitations` — cùng cách `withGuestSession` dẫn xuất GUC thứ ba. */
  readonly rfqId: string;
  readonly verifiedChannel: Channel;
}

export async function resolveGuestSessionByToken(
  client: pg.PoolClient,
  orgId: string,
  token: string,
): Promise<ResolvedGuestSession> {
  await assertTenantBound(client, orgId, "resolveGuestSessionByToken");
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) {
    throw new InvitationError("phiên khách không hợp lệ, đã hết hạn, hoặc đã bị thu hồi");
  }
  const { rows } = await client.query<{ id: string; invitation_id: string; rfq_id: string; verified_channel: Channel }>(
    `SELECT g.id, g.invitation_id, i.rfq_id, g.verified_channel
       FROM public.guest_sessions g
       JOIN public.rfq_invitations i ON i.id OPERATOR(pg_catalog.=) g.invitation_id
      WHERE g.token_hash OPERATOR(pg_catalog.=) $1::pg_catalog.bytea
        AND g.revoked_at IS NULL
        AND g.expires_at OPERATOR(pg_catalog.>) pg_catalog.clock_timestamp()`,
    [bam(token)],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new InvitationError("phiên khách không hợp lệ, đã hết hạn, hoặc đã bị thu hồi");
  }
  return { guestSessionId: hang.id, invitationId: hang.invitation_id, rfqId: hang.rfq_id, verifiedChannel: hang.verified_channel };
}
