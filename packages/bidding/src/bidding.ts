// ==============================================================================================
// NỘP BÁO GIÁ (S1.5) — VÀ RANH GIỚI VỚI TẦNG CSDL, GHIM TƯỜNG MINH
//
// Cùng khuôn ADR-014 đã dùng cho máy trạng thái RFQ: *cái gì hỏng IM LẶNG thì xuống CSDL; cái gì
// hỏng ỒN ÀO thì ở ứng dụng*. Gói này là NỬA TRÊN, và nó KHÔNG lặp lại nửa dưới:
//
//   CSDL (018) giữ — và giữ MỘT MÌNH:
//     * C1 — hạn nộp, phán quyết bằng `now()` của CHÍNH transaction ghi, có khoá hàng `FOR SHARE`;
//     * B1 — không UPDATE, không DELETE, chặn cả superuser bằng trigger;
//     * số phiên bản là DẪN XUẤT dưới khoá hàng, không phải một tham số;
//     * phiên khách phải THUỘC VỀ luồng báo giá đang ghi (ADR-016 cho phía khách);
//     * B2 vế "MỖI LẦN nộp sinh biên nhận" — constraint trigger hoãn tới COMMIT.
//
//   Gói này giữ:
//     * `assertTenantBound` trước mọi thứ;
//     * đọc ra danh tính từ phiên khách thay vì nhận nó làm tham số;
//     * dựng VĂN BẢN CHÍNH TẮC và gọi bộ ký — thứ CSDL không làm được;
//     * thứ tự các câu ghi trong một transaction.
//
// HỆ QUẢ PHẢI ĐỌC KỸ: `submitBid` KHÔNG kiểm lại hạn nộp trước khi INSERT. Đó là CÓ CHỦ ĐÍCH —
// một phép kiểm ở đây đọc đồng hồ ở một thời điểm KHÁC với thời điểm CSDL phán quyết, nên nó
// không làm bảo đảm mạnh thêm mà chỉ thêm một cửa sổ đua và một thông báo lỗi thứ hai. ADR-005
// đã chốt: phán quyết thuộc về transaction ghi.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { describeEnvelope } from "@trustprocure/sealed-envelope";
import { ReceiptError, buildReceiptText, sha256Hex } from "./receipt.js";
import type { ReceiptSigner } from "./signer.js";

export class BiddingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BiddingError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function batBuocUuid(gia: string, ten: string): void {
  if (!UUID_PATTERN.test(gia)) {
    throw new BiddingError(`${ten} phải là UUID hợp lệ, nhận được: "${gia}".`);
  }
}

export interface SubmitBidInput {
  /**
   * [ADR-016] Phiên khách của CHÍNH nhà cung cấp đang nộp.
   *
   * Chú ý thứ KHÔNG có trong kiểu này: **không có `bidId`, không có `invitationId`, không có
   * `rfqId`.** Cả ba là DẪN XUẤT của phiên. Một tham số `bidId` sẽ là một chỗ để một nhà cung cấp
   * ghi vào luồng của người khác — và CSDL sẽ chặn (trigger `bid_kiem_phien_khach`), nhưng một
   * tham số mà lớp dưới luôn từ chối là một tham số không nên tồn tại.
   */
  readonly guestSessionId: string;
  /** Phong bì niêm phong của S1.4, nguyên vẹn. */
  readonly envelope: Uint8Array;
  readonly signer: ReceiptSigner;
}

export interface BidReceiptRecord {
  readonly bidVersionId: string;
  readonly bidId: string;
  readonly rfqId: string;
  readonly version: number;
  readonly submittedAt: string;
  /** ĐÚNG chuỗi đã được ký. Kiểm chứng phải dùng chuỗi này, không dựng lại từ các trường. */
  readonly canonicalText: string;
  /** Chữ ký dạng DER. */
  readonly signature: Uint8Array;
}

interface HangPhien {
  readonly invitation_id: string;
  readonly rfq_id: string;
  readonly verified_contact_id: string;
}

/**
 * [B1, B2, C1] Nộp một phiên bản báo giá và phát biên nhận đã ký — trong CÙNG một transaction.
 *
 * Người gọi phải mở transaction. Hàm này KHÔNG tự `BEGIN`: nếu nó tự mở, câu ghi phiên bản và câu
 * ghi biên nhận sẽ nằm trong một transaction KHÁC với phần việc còn lại của người gọi, và vế
 * "mỗi lần nộp sinh biên nhận" tụt từ một ràng buộc xuống một lời hứa. Constraint trigger hoãn
 * tới COMMIT của 018 là thứ cưỡng chế nó, và nó chỉ có nghĩa trong transaction của người gọi.
 */
export async function submitBid(
  client: pg.PoolClient,
  orgId: string,
  input: SubmitBidInput,
): Promise<BidReceiptRecord> {
  await assertTenantBound(client, orgId, "submitBid");
  batBuocUuid(input.guestSessionId, "guestSessionId");

  // Phong bì phải ĐỌC ĐƯỢC trước khi nó được cất. Một mảng byte bất kỳ cũng qua được `CHECK` độ
  // dài của 018, nhưng nó sẽ là một báo giá KHÔNG BAO GIỜ mở được — và điều đó chỉ lộ ra ở lần mở
  // thầu, tức sau khi mọi thứ đã kết thúc. Phép kiểm này không cần khoá nào (S1.4: phong bì tự khai).
  try {
    describeEnvelope(input.envelope);
  } catch (loi) {
    throw new BiddingError("Phong bì niêm phong không đọc được — từ chối thay vì cất đi.", {
      cause: loi,
    });
  }

  // Danh tính là DẪN XUẤT. Vị từ hợp lệ ở đây LẶP LẠI vị từ của trigger `bid_kiem_phien_khach`
  // (018) một cách có chủ đích: lớp này cho một thông báo đọc được, lớp kia là lớp có thẩm quyền.
  const { rows: phien } = await client.query<HangPhien>(
    `SELECT g.invitation_id, i.rfq_id, g.verified_contact_id
       FROM guest_sessions g
       JOIN rfq_invitations i ON i.id = g.invitation_id AND i.org_id = g.org_id
      WHERE g.id = $1 AND g.revoked_at IS NULL AND g.expires_at > now()`,
    [input.guestSessionId],
  );
  const p = phien[0];
  if (p === undefined) {
    throw new BiddingError(
      "phiên khách không hợp lệ: không tồn tại trong tổ chức đang gắn, đã thu hồi, hoặc đã hết hạn",
    );
  }

  const bidId = await layHoacTaoLuong(client, orgId, p.invitation_id);

  const { rows: ban } = await client.query<{
    id: string;
    version: number;
    submitted_at_text: string;
  }>(
    // `submitted_at_text` đi qua `public.bid_dau_thoi_gian_chinh_tac` chứ KHÔNG qua `Date` của
    // JavaScript: `timestamptz` giữ micro-giây còn `Date` chỉ tới mili-giây, và một biên nhận cắt
    // bớt ba chữ số cuối là một biên nhận không khớp dữ liệu nó chứng nhận.
    `INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, version, public.bid_dau_thoi_gian_chinh_tac(submitted_at) AS submitted_at_text`,
    [orgId, bidId, Buffer.from(input.envelope), input.guestSessionId],
  );
  const b = ban[0];
  if (b === undefined) {
    throw new BiddingError("Không ghi được phiên bản báo giá.");
  }

  const canonicalText = buildReceiptText({
    kid: input.signer.activeKeyId,
    rfqId: p.rfq_id,
    bidId,
    version: b.version,
    ciphertextSha256: await sha256Hex(input.envelope),
    submittedAt: b.submitted_at_text,
  });
  const signature = await input.signer.sign(canonicalText);
  if (signature.length === 0) {
    throw new ReceiptError("Bộ ký trả về một chữ ký rỗng.");
  }

  await client.query(
    `INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature)
     VALUES ($1, $2, $3, $4)`,
    [orgId, b.id, canonicalText, Buffer.from(signature)],
  );

  // [E5] Danh tính ghi sổ là NGƯỜI ĐÃ XÁC THỰC THỰC TẾ (`verified_contact_id`), không phải người
  // được mời. Payload KHÔNG mang phong bì và KHÔNG mang chữ ký — sổ kiểm toán không nhân bản dữ
  // liệu; nó ghi rằng một việc đã xảy ra.
  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: p.verified_contact_id,
    action: "BID_SUBMITTED",
    resourceType: "vendor_bid_version",
    resourceId: b.id,
    payload: { rfqId: p.rfq_id, version: b.version },
  });

  return {
    bidVersionId: b.id,
    bidId,
    rfqId: p.rfq_id,
    version: b.version,
    submittedAt: b.submitted_at_text,
    canonicalText,
    signature,
  };
}

/**
 * Luồng báo giá của một lời mời — tạo nếu chưa có.
 *
 * `ON CONFLICT DO NOTHING` rồi `SELECT` chứ không `DO UPDATE ... RETURNING`: `app_api` **không**
 * có quyền UPDATE trên `vendor_bids` (018), và điều đó là cố ý — một luồng báo giá đã tạo thì
 * không có trường nào để sửa. Cái giá là một câu SELECT thêm ở nhánh đua; cái mua được là một
 * dòng GRANT ít hơn.
 */
async function layHoacTaoLuong(
  client: pg.PoolClient,
  orgId: string,
  invitationId: string,
): Promise<string> {
  const { rows: moi } = await client.query<{ id: string }>(
    `INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2)
     ON CONFLICT (org_id, invitation_id) DO NOTHING RETURNING id`,
    [orgId, invitationId],
  );
  const m = moi[0];
  if (m !== undefined) return m.id;

  const { rows: cu } = await client.query<{ id: string }>(
    "SELECT id FROM vendor_bids WHERE invitation_id = $1",
    [invitationId],
  );
  const c = cu[0];
  if (c === undefined) {
    throw new BiddingError("Không tạo được luồng báo giá cho lời mời này.");
  }
  return c.id;
}

export interface BidVersionRecord {
  readonly id: string;
  readonly version: number;
  readonly submittedAt: string;
}

/**
 * Các phiên bản đã nộp của một luồng báo giá — KHÔNG kèm phong bì.
 *
 * `envelope` không có trong câu SELECT, và nó cũng không thể có: `app_api` KHÔNG được cấp quyền
 * đọc cột ấy (018). Hai lớp nói cùng một điều, và lớp có thẩm quyền là lớp của Postgres.
 */
export async function listBidVersions(
  client: pg.PoolClient,
  orgId: string,
  bidId: string,
): Promise<readonly BidVersionRecord[]> {
  await assertTenantBound(client, orgId, "listBidVersions");
  batBuocUuid(bidId, "bidId");
  const { rows } = await client.query<{ id: string; version: number; submitted_at_text: string }>(
    `SELECT id, version, public.bid_dau_thoi_gian_chinh_tac(submitted_at) AS submitted_at_text
       FROM vendor_bid_versions WHERE bid_id = $1 ORDER BY version`,
    [bidId],
  );
  return rows.map((r) => ({ id: r.id, version: r.version, submittedAt: r.submitted_at_text }));
}

/**
 * Biên nhận của một phiên bản — hai thứ, và chỉ hai thứ.
 *
 * Không có trường nào khác được trả về, và đó là hình dạng của quyết định ở ADR-011 mục 2: mọi
 * thông tin của biên nhận nằm TRONG văn bản đã ký. Muốn biết khoá nào ký thì `parseReceiptText`.
 */
export async function getBidReceipt(
  client: pg.PoolClient,
  orgId: string,
  bidVersionId: string,
): Promise<{ canonicalText: string; signature: Uint8Array } | null> {
  await assertTenantBound(client, orgId, "getBidReceipt");
  batBuocUuid(bidVersionId, "bidVersionId");
  const { rows } = await client.query<{ canonical_text: string; signature: Buffer }>(
    "SELECT canonical_text, signature FROM bid_receipts WHERE bid_version_id = $1",
    [bidVersionId],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return { canonicalText: r.canonical_text, signature: new Uint8Array(r.signature) };
}
