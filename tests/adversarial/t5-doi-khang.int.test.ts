// =============================================================================================
// S1.8 — TẦNG T5: BỘ TEST ĐỐI KHÁNG
//
// §6 của đặc tả định nghĩa T5 là *"mỗi bất biến có ít nhất một test CỐ TÌNH TẤN CÔNG"*. Chữ cố
// tình tấn công là chỗ dễ trượt nhất trong cả bộ test của dự án, vì một test tên là "kẻ tấn công
// không làm được X" xanh **cả khi X vốn dĩ không làm được vì một lý do khác** — và lúc ấy nó đo
// sự vắng mặt của tính năng chứ không đo hàng rào.
//
// Vì vậy MỌI test ở file này đi kèm một trong hai thứ, không có ngoại lệ:
//   • một lượt ĐỘT BIẾN (gỡ trigger / thu hẹp truy vấn) chứng minh nó biết đỏ, hoặc
//   • một ĐỐI CHỨNG DƯƠNG chứng minh đường hợp pháp vẫn đi được.
//
// Bốn mã được nhắm: **C2**, **C4**, **B5**, **E4**. Ba mã KHÔNG được nhắm và lý do nằm ở §3 của
// ma trận: A2 (đòi một tiến trình `api` đang chạy cùng một APM agent), A5 (đòi role `app_guest`
// — khoản nợ 29 — và một tầng HTTP), E6 (đòi một URL).
// =============================================================================================

import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { RFQ_DEADLINE_NOTICE_KIND, extendRfqDeadline } from "@trustprocure/rfq";
import { auditStoredCiphertexts } from "@trustprocure/bidding";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const XA_HON = new Date(Date.now() + 14 * 24 * 3600 * 1000);

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string, orgB: string;
let uA: string, uB: string;
let sA: string, sB: string;
let csA: string;

async function taoNguoi(orgId: string, email: string, vaiTro: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgId, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
    orgId,
    id,
    vaiTro,
  ]);
  return id;
}

async function taoPhien(orgId: string, userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** RFQ đã OPEN của tổ chức A. */
async function taoRfqMo(han: Date = MAI_SAU): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) RETURNING id",
    [orgA, han, uA, sA],
  );
  const rfqId = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [orgA, rfqId, uA, sA],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, " +
      "created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgA, rfqId, csA, uA, sA],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, " +
      "submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uA, sA],
  );
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, " +
        "wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), uA, sA],
    );
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
        "opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uA, sA],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return rfqId;
}

interface LoiMoi {
  readonly invitationId: string;
  readonly supplierId: string;
  readonly contactId: string;
  readonly tokenId: string;
  readonly challengeId: string;
}

/** Một nhà cung cấp đã được mời, kèm token và một thách thức OTP ĐÃ ĐỐI CHIẾU. */
async function moiNhaCungCap(rfqId: string, maSoThue?: string): Promise<LoiMoi> {
  const hex = randomBytes(4).toString("hex");
  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) " +
      "VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [orgA, `NCC ${hex}`, maSoThue ?? null, uA, sA],
  );
  const supplierId = ncc[0]?.id ?? "";
  const { rows: lh } = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) " +
      "RETURNING id",
    [orgA, supplierId, `${hex}@vidu.vn`, uA, sA],
  );
  const contactId = lh[0]?.id ?? "";
  const { rows: lm } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, " +
      "invited_by, invited_by_session_id) VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [orgA, rfqId, supplierId, contactId, uA, sA],
  );
  const invitationId = lm[0]?.id ?? "";
  const { rows: tk } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, " +
      "issued_by, issued_by_session_id) VALUES ($1, $2, $3, 'BID_SUBMISSION', " +
      "now() + interval '1 day', $4, $5) RETURNING id",
    [orgA, invitationId, randomBytes(32), uA, sA],
  );
  const tokenId = tk[0]?.id ?? "";
  const { rows: tt } = await db.pool.query<{ id: string }>(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, " +
      "channel, code_hash, destination_hash, pepper_version, expires_at, consumed_at) " +
      "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
    [orgA, invitationId, tokenId, contactId, randomBytes(32), randomBytes(32)],
  );
  return { invitationId, supplierId, contactId, tokenId, challengeId: tt[0]?.id ?? "" };
}

async function taoPhienKhach(lm: LoiMoi): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, " +
      "verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [orgA, lm.invitationId, lm.challengeId, randomBytes(32), lm.contactId],
  );
  return rows[0]?.id ?? "";
}

/** Nộp một báo giá kèm biên nhận mang ĐÚNG chuỗi hash của phong bì. */
async function nopBaoGia(
  rfqId: string,
  lm: LoiMoi,
  phongBi: Buffer,
): Promise<{ bidId: string; versionId: string }> {
  const guestSessionId = await taoPhienKhach(lm);
  const bam = createHash("sha256").update(phongBi).digest("hex");
  return await withTenant(apiPool, orgA, async (c) => {
    const { rows: b } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, lm.invitationId],
    );
    const bidId = b[0]?.id ?? "";
    const { rows: v } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, bidId, phongBi, guestSessionId],
    );
    const versionId = v[0]?.id ?? "";
    await c.query(
      "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) " +
        "VALUES ($1, $2, $3, $4)",
      [
        orgA,
        versionId,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\n` +
          `bid_id=${bidId}\nversion=1\nciphertext_sha256=${bam}\n` +
          "submitted_at=2026-09-05T00:00:00.000000Z\n",
        Buffer.alloc(70, 7),
      ],
    );
    return { bidId, versionId };
  });
}

/** Đẩy hạn nộp về QUÁ KHỨ mà không đụng `status` — mô phỏng "thời gian đã trôi qua". */
async function dayHanVeQuaKhu(rfqId: string): Promise<void> {
  await db.pool.query(
    "ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai",
  );
  try {
    await db.pool.query(
      "UPDATE rfq_packages SET deadline_at = now() - interval '1 minute' WHERE id = $1",
      [rfqId],
    );
  } finally {
    await db.pool.query(
      "ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai",
    );
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
      "('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  orgB = orgs.rows[1]?.id ?? "";
  uA = await taoNguoi(orgA, "a@vidu.vn", "PROCUREMENT_MANAGER");
  uB = await taoNguoi(orgB, "b@vidu.vn", "PROCUREMENT_MANAGER");
  sA = await taoPhien(orgA, uA);
  sB = await taoPhien(orgB, uB);
  const cs = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [orgA, uA, sA],
  );
  csA = cs.rows[0]?.id ?? "";
  expect([orgA, orgB, uA, uB, sA, sB, csA].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

// ===============================================================================================
// [INV-C2] TÍNH ĐÚNG ĐẮN KHÔNG PHỤ THUỘC SCHEDULER
// ===============================================================================================
describe("[INV-C2] job đóng RFQ chết không làm một báo giá muộn được nhận", () => {
  it("[INV-C2] KHÔNG scheduler nào chạy: RFQ vẫn OPEN sau hạn, mà báo giá muộn vẫn bị từ chối", async () => {
    const rfqId = await taoRfqMo();
    const lm = await moiNhaCungCap(rfqId);
    const guestSessionId = await taoPhienKhach(lm);
    await dayHanVeQuaKhu(rfqId);

    // TIỀN ĐỀ 1 — scheduler THẬT SỰ chết. File này không khởi động `runOutboxOnce` một lần nào,
    // và không có job nào thuộc bất kỳ `kind` nào tồn tại để một runner khác nhặt.
    const { rows: job } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs WHERE org_id = $1",
      [orgA],
    );
    expect(job[0]?.n, "phép đo này chỉ có nghĩa khi KHÔNG có hàng đợi nào đang chạy").toBe("0");

    // TIỀN ĐỀ 2 — và hậu quả của việc nó chết đã hiện ra: RFQ đáng lẽ phải CLOSED, nhưng nó
    // vẫn OPEN. Đây là trạng thái mà mệnh đề C2 nói tới, và nó phải là trạng thái THẬT chứ
    // không phải một giả định trong đầu người viết test.
    const { rows: tt } = await db.pool.query<{ status: string; qua_han: boolean }>(
      "SELECT status, (deadline_at < now()) AS qua_han FROM rfq_packages WHERE id = $1",
      [rfqId],
    );
    expect(tt[0]?.status).toBe("OPEN");
    expect(tt[0]?.qua_han).toBe(true);

    // TẤN CÔNG — nộp vào đúng cửa sổ ấy.
    const loi = await withTenant(apiPool, orgA, (c) =>
      c.query(
        "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
          "SELECT $1, id, $3, $4 FROM vendor_bids WHERE invitation_id = $2",
        [orgA, lm.invitationId, Buffer.alloc(64, 3), guestSessionId],
      ),
    ).then(
      () => null,
      (e: unknown) => e as Error,
    );

    // Không có `vendor_bids` nào nên câu trên chèn 0 hàng; dựng luồng rồi nộp cho đúng.
    expect(loi).toBeNull();
    await db.pool.query("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2)", [
      orgA,
      lm.invitationId,
    ]);
    const loi2 = await withTenant(apiPool, orgA, (c) =>
      c.query(
        "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
          "SELECT $1, id, $3, $4 FROM vendor_bids WHERE invitation_id = $2",
        [orgA, lm.invitationId, Buffer.alloc(64, 3), guestSessionId],
      ),
    ).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(loi2, "báo giá muộn được nhận khi scheduler chết").not.toBeNull();

    // VÀ ĐÂY LÀ VẾ CHỊU LỰC CỦA C2: lời từ chối phải nói về HẠN, không về TRẠNG THÁI. Nếu nó
    // nói về trạng thái thì phép kiểm đang dựa vào việc một scheduler đã kịp đặt `CLOSED` —
    // tức đúng thứ mệnh đề cấm. RFQ ở đây vẫn OPEN, nên chỉ một phép so thời gian TRONG CHÍNH
    // GIAO DỊCH GHI mới sinh ra được thông báo này.
    expect(loi2?.message).toMatch(/Da qua han nop bao gia/);
    expect(loi2?.message).not.toMatch(/trang thai/);
  });

  it("[INV-C2] ĐỘT BIẾN: gỡ phép kiểm hạn thì đúng lần nộp ấy đi lọt", async () => {
    const rfqId = await taoRfqMo();
    const lm = await moiNhaCungCap(rfqId);
    const guestSessionId = await taoPhienKhach(lm);
    await db.pool.query("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2)", [
      orgA,
      lm.invitationId,
    ]);
    await dayHanVeQuaKhu(rfqId);

    await db.pool.query("DROP TRIGGER vendor_bid_versions_kiem_han_nop ON vendor_bid_versions");
    try {
      const rowCount = await withTenant(apiPool, orgA, async (c) => {
        const { rows } = await c.query<{ id: string; bid_id: string }>(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, " +
            "submitted_by_guest_session_id) SELECT $1, id, $3, $4 FROM vendor_bids " +
            "WHERE invitation_id = $2 RETURNING id, bid_id",
          [orgA, lm.invitationId, Buffer.alloc(64, 3), guestSessionId],
        );
        // Trigger HOÃN `bid_phai_co_bien_nhan` (B2) đòi một biên nhận trong CÙNG giao dịch. Nó
        // KHÔNG phải thứ đang bị đột biến ở đây, nên nó phải được thoả — nếu không, lượt đột
        // biến sẽ đỏ vì B2 chứ không vì C1, và phép đo nói về sai bất biến.
        for (const r of rows) {
          await c.query(
            "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) " +
              "VALUES ($1, $2, $3, $4)",
            [
              orgA,
              r.id,
              [
                "trustprocure-receipt-v1",
                "alg=ECDSA_P256_SHA256",
                "kid=k1",
                `rfq_id=${rfqId}`,
                `bid_id=${r.bid_id}`,
                "version=1",
                `ciphertext_sha256=${"c".repeat(64)}`,
                "submitted_at=2026-09-05T00:00:00.000000Z",
                "",
              ].join("\n"),
              Buffer.alloc(70, 7),
            ],
          );
        }
        return rows.length;
      });
      expect(rowCount, "không có trigger thì báo giá muộn được nhận — test trên có răng").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER vendor_bid_versions_kiem_han_nop BEFORE INSERT ON vendor_bid_versions " +
          "FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_han_nop()",
      );
    }
  });
});

// ===============================================================================================
// [INV-C4] DEADLINE: KHÔNG RÚT NGẮN, GIA HẠN CÓ LÝ DO — CÓ AUDIT — CÓ THÔNG BÁO
// ===============================================================================================
describe("[INV-C4] gia hạn là một hành vi có bốn điều kiện, và cả bốn đều đo được", () => {
  it("[INV-C4] vế 1: rút ngắn bị từ chối, và ĐỘT BIẾN gỡ trigger cho thấy nó đi lọt", async () => {
    const rfqId = await taoRfqMo(XA_HON);
    const somHon = new Date(Date.now() + 3 * 24 * 3600 * 1000);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: somHon,
          reason: "khach giuc",
          actorSessionId: sA,
        }),
      ),
    ).rejects.toThrow(/Khong duoc rut ngan hay xoa deadline/);

    await db.pool.query(
      "ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai",
    );
    try {
      const { rowCount } = await db.pool.query(
        "UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1",
        [rfqId, somHon],
      );
      expect(rowCount, "không có trigger thì hạn lùi được — phép đo trên có răng").toBe(1);
      await db.pool.query("UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1", [
        rfqId,
        XA_HON,
      ]);
    } finally {
      await db.pool.query(
        "ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai",
      );
    }
  });

  it("[INV-C4] vế 2: gia hạn khi RFQ đã CLOSED bị từ chối", async () => {
    const rfqId = await taoRfqMo();
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
        "early_close_reason = 'dong som', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, uA, sA],
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: XA_HON,
          reason: "xin them thoi gian",
          actorSessionId: sA,
        }),
      ),
    ).rejects.toThrow(/Chi doi duoc deadline khi RFQ dang DRAFT hoac OPEN/);
  });

  it("[INV-C4] vế 3: lý do rỗng bị từ chối TRƯỚC khi có bất kỳ lần ghi nào", async () => {
    const rfqId = await taoRfqMo();
    await moiNhaCungCap(rfqId);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: XA_HON,
          reason: "   ",
          actorSessionId: sA,
        }),
      ),
    ).rejects.toThrow();

    const { rows } = await db.pool.query<{ han: Date; n: string; j: string }>(
      "SELECT p.deadline_at AS han, " +
        "(SELECT count(*)::text FROM audit_events e WHERE e.resource_id = p.id " +
        "   AND e.action = 'RFQ_DEADLINE_EXTENDED') AS n, " +
        "(SELECT count(*)::text FROM outbox_jobs o WHERE o.payload->>'rfqId' = p.id::text) AS j " +
        "FROM rfq_packages p WHERE p.id = $1",
      [rfqId],
    );
    expect(rows[0]?.han?.getTime()).toBe(MAI_SAU.getTime());
    expect(rows[0]?.n, "một lần gia hạn bị từ chối không được để lại dấu vết kiểm toán").toBe("0");
    expect(rows[0]?.j, "và không được để lại một ý định thông báo nào").toBe("0");
  });

  it("[INV-C4] vế 4+5: gia hạn hợp lệ sinh audit VÀ đúng một thông báo cho MỖI lời mời", async () => {
    const rfqId = await taoRfqMo();
    const lm = [
      await moiNhaCungCap(rfqId),
      await moiNhaCungCap(rfqId),
      await moiNhaCungCap(rfqId),
    ];

    await withTenant(apiPool, orgA, (c) =>
      extendRfqDeadline(c, orgA, {
        rfqId,
        newDeadlineAt: XA_HON,
        reason: "nha cung cap xin them thoi gian khao sat",
        actorSessionId: sA,
      }),
    );

    const { rows: sk } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events " +
        "WHERE resource_id = $1 AND action = 'RFQ_DEADLINE_EXTENDED'",
      [rfqId],
    );
    expect(sk[0]?.n).toBe("1");

    const { rows: jobs } = await db.pool.query<{ invitation_id: string; kind: string }>(
      "SELECT payload->>'invitationId' AS invitation_id, kind FROM outbox_jobs " +
        "WHERE payload->>'rfqId' = $1 ORDER BY payload->>'invitationId'",
      [rfqId],
    );
    // "TOÀN BỘ nhà cung cấp đã mời" là một phép so TẬP HỢP, không phải một phép đếm: đếm bằng
    // nhau vẫn đúng khi hai job cùng trỏ về một lời mời và một người bị bỏ quên.
    expect(jobs.map((j) => j.invitation_id).sort()).toEqual(
      lm.map((x) => x.invitationId).sort(),
    );
    expect(new Set(jobs.map((j) => j.kind))).toEqual(new Set([RFQ_DEADLINE_NOTICE_KIND]));

    // Và thông báo gửi ra ngoài KHÔNG mang lý do — lý do là văn bản tự do của người mua và nó
    // có thể chứa một con số. Nó thuộc sổ kiểm toán, không thuộc thứ nhà cung cấp nhận được.
    const { rows: co } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs " +
        "WHERE payload->>'rfqId' = $1 AND payload ? 'reason'",
      [rfqId],
    );
    expect(co[0]?.n).toBe("0");
  });

  it("[INV-C4] vế 5 là TRONG CÙNG GIAO DỊCH: rollback xoá cả hạn mới, cả audit, cả thông báo", async () => {
    const rfqId = await taoRfqMo();
    await moiNhaCungCap(rfqId);
    await moiNhaCungCap(rfqId);

    // `withTenant` TỰ mở một giao dịch (BEGIN ... COMMIT) — đã đo được điều đó trong lúc viết
    // file này, qua một lượt đột biến đỏ ở tầng COMMIT. Nên cách đúng để dựng một lần rollback
    // là NÉM từ trong callback, không phải gõ một `BEGIN` lồng nhau.
    const CHAN = new Error("chan-lai-de-do-rollback");
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: XA_HON,
          reason: "se bi rollback",
          actorSessionId: sA,
        });
        // Tiền đề: TRONG giao dịch, thông báo đã có mặt. Không có vế này, ba khẳng định dưới
        // xanh kể cả khi `extendRfqDeadline` chưa từng xếp một job nào.
        const { rows } = await c.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM outbox_jobs WHERE payload->>'rfqId' = $1",
          [rfqId],
        );
        expect(rows[0]?.n, "chưa rollback mà đã không có job — phép đo dưới sẽ vô nghĩa").toBe("2");
        throw CHAN;
      }),
    ).rejects.toBe(CHAN);

    const { rows } = await db.pool.query<{ han: Date; n: string; j: string }>(
      "SELECT p.deadline_at AS han, " +
        "(SELECT count(*)::text FROM audit_events e WHERE e.resource_id = p.id " +
        "   AND e.action = 'RFQ_DEADLINE_EXTENDED') AS n, " +
        "(SELECT count(*)::text FROM outbox_jobs o WHERE o.payload->>'rfqId' = p.id::text) AS j " +
        "FROM rfq_packages p WHERE p.id = $1",
      [rfqId],
    );
    expect(rows[0]?.han?.getTime()).toBe(MAI_SAU.getTime());
    expect(rows[0]?.n).toBe("0");
    expect(rows[0]?.j).toBe("0");
  });
});

// ===============================================================================================
// [INV-B5] CIPHERTEXT LƯU TRỮ CÒN KHỚP HASH TRONG BIÊN NHẬN
// ===============================================================================================
describe("[INV-B5] job toàn vẹn phát hiện được một phong bì đã bị đổi", () => {
  it("[INV-B5] dữ liệu nguyên vẹn: báo cáo sạch, và nó đã THẬT SỰ băm lại", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, await moiNhaCungCap(rfqId), Buffer.from("phong-bi-mot-0123456789-dem-cho-du-32"));
    await nopBaoGia(rfqId, await moiNhaCungCap(rfqId), Buffer.from("phong-bi-hai-9876543210-dem-cho-du-32"));

    const bc = await withTenant(unsealPool, orgA, (c) => auditStoredCiphertexts(c, orgA, rfqId));
    expect(bc.checked, "báo cáo sạch phải kèm số đã kiểm — 0/0 cũng là báo cáo sạch").toBe(2);
    expect(bc.mismatched).toEqual([]);
    expect(bc.missingReceipt).toEqual([]);
    expect(bc.unparsableReceipt).toEqual([]);
  });

  it("[INV-B5] B1 chặn trước: không gỡ trigger thì KHÔNG đổi được phong bì, kể cả bằng superuser", async () => {
    const rfqId = await taoRfqMo();
    const { versionId } = await nopBaoGia(
      rfqId,
      await moiNhaCungCap(rfqId),
      Buffer.from("phong-bi-goc-abcdefghij-dem-cho-du-32"),
    );
    await expect(
      db.pool.query("UPDATE vendor_bid_versions SET envelope = $2 WHERE id = $1", [
        versionId,
        Buffer.from("phong-bi-gia-abcdefghij-dem-cho-du-32"),
      ]),
    ).rejects.toThrow();
  });

  it("[INV-B5] gỡ B1 rồi đổi phong bì: job toàn vẹn CHỈ ĐÍCH DANH đúng phiên bản ấy", async () => {
    const rfqId = await taoRfqMo();
    const sach = await nopBaoGia(
      rfqId,
      await moiNhaCungCap(rfqId),
      Buffer.from("phong-bi-sach-0000000000-dem-cho-du-32"),
    );
    const hong = await nopBaoGia(
      rfqId,
      await moiNhaCungCap(rfqId),
      Buffer.from("phong-bi-se-hong-111111-dem-cho-du-32"),
    );

    const truoc = await withTenant(unsealPool, orgA, (c) =>
      auditStoredCiphertexts(c, orgA, rfqId),
    );
    expect(truoc.mismatched, "tiền đề: trước khi phá thì mọi thứ khớp").toEqual([]);

    // Đường mà B1 KHÔNG canh: một script vận hành gỡ trigger, hoặc một lần khôi phục sai.
    await db.pool.query(
      "ALTER TABLE vendor_bid_versions DISABLE TRIGGER vendor_bid_versions_chi_ghi_them",
    );
    try {
      await db.pool.query("UPDATE vendor_bid_versions SET envelope = $2 WHERE id = $1", [
        hong.versionId,
        Buffer.from("phong-bi-da-bi-thay-the!-dem-cho-du-32"),
      ]);
    } finally {
      await db.pool.query(
        "ALTER TABLE vendor_bid_versions ENABLE TRIGGER vendor_bid_versions_chi_ghi_them",
      );
    }

    const sau = await withTenant(unsealPool, orgA, (c) => auditStoredCiphertexts(c, orgA, rfqId));
    expect(sau.checked).toBe(2);
    expect(sau.mismatched.map((m) => m.bidVersionId)).toEqual([hong.versionId]);
    const m = sau.mismatched[0];
    expect(m?.expectedSha256).toBe(
      createHash("sha256").update(Buffer.from("phong-bi-se-hong-111111-dem-cho-du-32")).digest("hex"),
    );
    expect(m?.actualSha256).toBe(
      createHash("sha256").update(Buffer.from("phong-bi-da-bi-thay-the!-dem-cho-du-32")).digest("hex"),
    );
    // Và phiên bản SẠCH không bị vạ lây — một job toàn vẹn báo cả bảng là một job bị tắt đi.
    expect(sau.mismatched.some((x) => x.bidVersionId === sach.versionId)).toBe(false);
  });

  it("[INV-B5] gọi nhầm role hỏng ỒN ÀO, không âm thầm báo 'mọi thứ đều khớp'", async () => {
    // `app_api` không đọc được `envelope` (A3/G1). Nếu hàm này nuốt lỗi ấy và trả về một báo cáo
    // rỗng thì B5 sẽ XANH VĨNH VIỄN trong sản phẩm mà không ai băm lại một byte nào.
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, await moiNhaCungCap(rfqId), Buffer.from("phong-bi-cho-role-sai-1-dem-cho-du-32"));
    await expect(
      withTenant(apiPool, orgA, (c) => auditStoredCiphertexts(c, orgA, rfqId)),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ===============================================================================================
// [INV-E4] MST VÀ MÃ RFQ KHÔNG BAO GIỜ LÀ CREDENTIAL
// ===============================================================================================
describe("[INV-E4] biết mã số thuế và mã RFQ không mở được cánh cửa nào", () => {
  it("[INV-E4] cùng MST tồn tại ở HAI tổ chức — nên nó không định danh được ai", async () => {
    // Đây là ADR-013 ở dạng đo được. Một `UNIQUE (tax_code)` toàn cục sẽ làm câu INSERT thứ hai
    // ĐỎ — và lúc ấy MST trở thành một khoá toàn hệ thống, tức một oracle xuyên tổ chức và một
    // thứ trông rất giống một danh tính.
    const mst = "0101234567";
    const rfqId = await taoRfqMo();
    await moiNhaCungCap(rfqId, mst);
    await expect(
      db.pool.query(
        "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) " +
          "VALUES ($1, 'Cung mot MST', $2, $3, $4)",
        [orgB, mst, uB, sB],
      ),
      "MST là khoá TOÀN CỤC — nó vừa trở thành một danh tính",
    ).resolves.toBeDefined();
  });

  it("[INV-E4] cầm đúng MST và đúng mã RFQ của tổ chức A, tổ chức B không đọc được gì", async () => {
    const mst = "0209876543";
    const rfqId = await taoRfqMo();
    const lm = await moiNhaCungCap(rfqId, mst);

    // Đối chứng dương: dưới ĐÚNG tổ chức, cùng câu truy vấn ấy trả về hàng.
    const { rows: co } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ id: string }>("SELECT id FROM suppliers WHERE tax_code = $1", [mst]),
    );
    expect(co.length).toBe(1);

    for (const [ten, cau, tham] of [
      ["suppliers theo MST", "SELECT id FROM suppliers WHERE tax_code = $1", mst],
      ["rfq_packages theo id", "SELECT id FROM rfq_packages WHERE id = $1", rfqId],
      ["rfq_invitations theo id", "SELECT id FROM rfq_invitations WHERE id = $1", lm.invitationId],
    ] as const) {
      const { rows } = await withTenant(apiPool, orgB, (c) =>
        c.query<{ id: string }>(cau, [tham]),
      );
      expect(rows.length, `tổ chức B đọc được ${ten} của tổ chức A`).toBe(0);
    }
  });

  it("[INV-E4] không đường nào dựng được phiên khách nếu chỉ có MST và mã RFQ", async () => {
    // Kịch bản tấn công: kẻ tấn công biết MST (công khai, tra được) và mã RFQ (đi trong mọi lời
    // mời). Nó thử tự dựng một phiên khách. Ba lần thử dưới đây là BA đường duy nhất tồn tại, và
    // cả ba đều đòi một thứ mà chỉ chủ hộp thư/số điện thoại có.
    const rfqId = await taoRfqMo();
    const lm = await moiNhaCungCap(rfqId, "0301112223");

    // ⑴ phiên khách KHÔNG có thách thức OTP nào. Thứ chặn nó KHÔNG phải một cột `NOT NULL` —
    // `challenge_id` nhận NULL được ở tầng lược đồ — mà là trigger E2 của 010. Ghi ra vì đó là
    // một chi tiết dễ đoán sai: nếu ai đó tưởng cột ấy `NOT NULL` và vì thế gỡ trigger đi cho
    // gọn, cửa này mở ra mà không một khẳng định nào ở đây đỏ.
    await expect(
      db.pool.query(
        "INSERT INTO guest_sessions (org_id, invitation_id, token_hash, verified_contact_id, " +
          "verified_channel, expires_at) VALUES ($1, $2, $3, $4, 'SMS', now() + interval '1 day')",
        [orgA, lm.invitationId, randomBytes(32), lm.contactId],
      ),
    ).rejects.toThrow(/thach thuc OTP da doi chieu/);

    // ⑵ phiên khách trỏ tới một thách thức CHƯA đối chiếu -> trigger C2 của 010 chặn.
    const { rows: chuaDoi } = await db.pool.query<{ id: string }>(
      "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, " +
        "channel, code_hash, destination_hash, pepper_version, expires_at) " +
        "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day') RETURNING id",
      [orgA, lm.invitationId, lm.tokenId, lm.contactId, randomBytes(32), randomBytes(32)],
    );
    await expect(
      db.pool.query(
        "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, " +
          "verified_contact_id, verified_channel, expires_at) " +
          "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day')",
        [orgA, lm.invitationId, chuaDoi[0]?.id ?? "", randomBytes(32), lm.contactId],
      ),
    ).rejects.toThrow();

    // ⑶ ĐỐI CHỨNG DƯƠNG — đường hợp pháp (token + OTP đã đối chiếu) thì đi được. Không có vế
    // này, hai khẳng định trên xanh kể cả khi bảng `guest_sessions` không dùng được cho ai cả.
    const phien = await taoPhienKhach(lm);
    expect(phien).not.toBe("");
  });

  it("[INV-E4] không bảng credential nào CẤT mã số thuế hay mã RFQ", async () => {
    // Phạm vi suy từ TÍNH CHẤT, không từ một danh sách tên cột: quét NỘI DUNG bốn bảng nằm trên
    // đường xác thực, tìm chính hai chuỗi ấy. Một cột mới thêm vào sau này tự rơi vào phạm vi.
    const mst = "0405556667";
    const rfqId = await taoRfqMo();
    const lm = await moiNhaCungCap(rfqId, mst);
    await taoPhienKhach(lm);

    for (const bang of [
      "sessions",
      "guest_sessions",
      "rfq_invitation_tokens",
      "invitation_otp_challenges",
    ]) {
      for (const [ten, chuoi] of [
        ["mã số thuế", mst],
        ["mã RFQ", rfqId],
      ] as const) {
        const { rows } = await db.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${bang} t WHERE t::text LIKE '%' || $1 || '%'`,
          [chuoi],
        );
        expect(rows[0]?.n, `${ten} nằm trong bảng credential ${bang}`).toBe("0");
      }
    }

    // Đối chứng dương: phép quét ấy biết tìm ra thứ CÓ MẶT — `invitation_id` thì có thật.
    const { rows: co } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM guest_sessions t WHERE t::text LIKE '%' || $1 || '%'",
      [lm.invitationId],
    );
    expect(Number(co[0]?.n ?? "0")).toBeGreaterThan(0);
  });
});
