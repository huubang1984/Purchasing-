// =============================================================================================
// S1.7 — BẢNG SO SÁNH VÀ SỐ BÁO GIÁ ĐÃ NHẬN, ĐO TRÊN POSTGRES THẬT
//
// Hai mệnh đề được đo ở đây hỏng theo hai kiểu khác nhau, nên chúng được đo theo hai kiểu khác
// nhau:
//
//   [A4] hỏng vì một trường PHÁI SINH xuất hiện sớm. Phép đo: dựng dữ liệu ĐẦY ĐỦ (bản rõ đã
//        nằm trong `rfq_unsealed_bids`) rồi đưa trạng thái RFQ ngược về từng giá trị một, và
//        đòi cổng vẫn từ chối. Nếu cổng chỉ là một cách nói khác của *"chưa có dữ liệu"* thì
//        mọi test ấy XANH SAI — dữ liệu đang có mặt.
//
//   [A6] hỏng vì một con số được công bố sớm. Phép đo: đổi ĐÚNG MỘT thứ — cờ chính sách — trên
//        cùng một RFQ ở cùng một trạng thái, và đòi câu trả lời lật. Cộng một phép đo về phần
//        CHÊNH: `app_api` vẫn đếm được bảng bằng SQL viết tay, và test nói ra điều đó thay vì
//        để ô ✅ ngậm nó.
//
// Fixture dùng phong bì GIẢ (`Buffer.alloc`) vì không phép đo nào ở file này chạm tới mật mã:
// thứ đang đo là cổng đọc TRẠNG THÁI và phép tính đọc `payload`. Đường mật mã thật có phép đo
// riêng ở `apps/unseal-worker/src/unseal-worker.int.test.ts`, nơi bộ quét rò rỉ của A4 sống.
// =============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  COMPARISON_ALLOWED_STATUSES,
  ComparisonDeniedError,
  approveUnseal,
  buildComparisonTable,
  countReceivedBids,
  requestUnseal,
} from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

/** Bảy giá trị của `rfq_packages.status` — đọc từ chính CHECK của 009, không chép tay. */
const MOI_TRANG_THAI = [
  "DRAFT",
  "PENDING_APPROVAL",
  "OPEN",
  "CLOSED",
  "UNSEALED",
  "EVALUATING",
  "CANCELLED",
];

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string, orgB: string;
let uYc: string, uD1: string, uB: string;
let sYc: string, sD1: string, sB: string;
/** csNghiem: chế độ nghiêm BẬT (mặc định). csLong: chế độ nghiêm TẮT. */
let csNghiem: string, csLong: string;

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

async function taoChinhSach(
  version: number,
  nghiem: boolean,
  hieuLucTu?: Date,
): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "strict_blind_mode, effective_from, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '100000000.00', 'VND', $3, coalesce($4, now()), $5, $6) RETURNING id",
    [orgA, version, nghiem, hieuLucTu ?? null, uYc, sYc],
  );
  return rows[0]?.id ?? "";
}

/** RFQ đã OPEN, ghim vào một chính sách qua `rfq_budgets`. */
async function taoRfqMo(policyId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) RETURNING id",
    [orgA, MAI_SAU, uYc, sYc],
  );
  const rfqId = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [orgA, rfqId, uYc, sYc],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, " +
      "created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgA, rfqId, policyId, uYc, sYc],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, " +
      "submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, " +
        "wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), uYc, sYc],
    );
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
        "opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
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

/** Một báo giá đã nộp (phong bì GIẢ — xem khối đầu file). Trả về id phiên bản. */
async function nopBaoGia(rfqId: string, tenNcc: string): Promise<string> {
  const hex = randomBytes(4).toString("hex");
  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
      "VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, tenNcc, uYc, sYc],
  );
  const supplierId = ncc[0]?.id ?? "";
  const { rows: lh } = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) " +
      "RETURNING id",
    [orgA, supplierId, `${hex}@vidu.vn`, uYc, sYc],
  );
  const contactId = lh[0]?.id ?? "";
  const { rows: lm } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, " +
      "invited_by, invited_by_session_id) VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [orgA, rfqId, supplierId, contactId, uYc, sYc],
  );
  const invitationId = lm[0]?.id ?? "";
  const { rows: tk } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, " +
      "issued_by, issued_by_session_id) VALUES ($1, $2, $3, 'BID_SUBMISSION', " +
      "now() + interval '1 day', $4, $5) RETURNING id",
    [orgA, invitationId, randomBytes(32), uYc, sYc],
  );
  const { rows: tt } = await db.pool.query<{ id: string }>(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, " +
      "channel, code_hash, destination_hash, pepper_version, expires_at, consumed_at) " +
      "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
    [orgA, invitationId, tk[0]?.id ?? "", contactId, randomBytes(32), randomBytes(32)],
  );
  const { rows: pk } = await db.pool.query<{ id: string }>(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, " +
      "verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [orgA, invitationId, tt[0]?.id ?? "", randomBytes(32), contactId],
  );
  const guestSessionId = pk[0]?.id ?? "";

  return await withTenant(apiPool, orgA, async (c) => {
    const { rows: b } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, invitationId],
    );
    const bidId = b[0]?.id ?? "";
    const { rows: v } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, bidId, Buffer.alloc(64, 9), guestSessionId],
    );
    const versionId = v[0]?.id ?? "";
    await c.query(
      "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) " +
        "VALUES ($1, $2, $3, $4)",
      [
        orgA,
        versionId,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\n` +
          `bid_id=${bidId}\nversion=1\nciphertext_sha256=${"a".repeat(64)}\n` +
          "submitted_at=2026-09-05T00:00:00.000000Z\n",
        Buffer.alloc(70, 7),
      ],
    );
    return versionId;
  });
}

/** Đóng RFQ, xin + duyệt mở thầu, ghi bản rõ dưới `app_unseal`, rồi tuyên bố UNSEALED. */
async function moThau(rfqId: string, banRo: readonly (readonly [string, unknown])[]): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
      "early_close_reason = 'dong som de kiem tra', closed_by = $2, closed_by_session_id = $3 " +
      "WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  const yc = await withTenant(apiPool, orgA, (c) =>
    requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau", actorSessionId: sYc }, apiPool),
  );
  await withTenant(apiPool, orgA, (c) =>
    approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, apiPool),
  );
  await withTenant(unsealPool, orgA, async (c) => {
    for (const [versionId, payload] of banRo) {
      await c.query(
        "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) " +
          "VALUES ($1, $2, $3, $4)",
        [orgA, yc.id, versionId, JSON.stringify(payload)],
      );
    }
    await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
  });
}

/**
 * Đặt trạng thái RFQ mà KHÔNG đi qua bảng cạnh — chỉ dùng để dựng ca đối kháng của A4/A6.
 *
 * Bảng cạnh của 009 KHÔNG cho các cạnh lùi này, và đó chính là lý do phải gỡ trigger để dựng
 * được trạng thái cần đo: phép đo hỏi *"cổng ở TypeScript có tự đứng được không nếu một ngày
 * bảng cạnh nới ra"*, nên nó phải chạy được ở một thế giới nơi bảng cạnh đã nới ra.
 *
 * Bốn RÀNG BUỘC DỮ LIỆU của 009/011 thì KHÔNG gỡ được (chúng là `CHECK`, không phải trigger),
 * nên các mốc thời gian phải đi kèm cho nhất quán — và điều đó là đúng: một trạng thái không
 * kèm mốc của nó là một hàng dữ liệu HỎNG, không phải một ca đối kháng.
 */
async function epTrangThai(rfqId: string, trangThai: string): Promise<void> {
  const daMo = ["OPEN", "CLOSED", "UNSEALED", "EVALUATING"].includes(trangThai);
  const daDong = ["CLOSED", "UNSEALED", "EVALUATING"].includes(trangThai);
  for (const t of ["rfq_packages_kiem_chuyen_trang_thai", "rfq_packages_kiem_yeu_cau_mo_thau"]) {
    await db.pool.query(`ALTER TABLE rfq_packages DISABLE TRIGGER ${t}`);
  }
  try {
    await db.pool.query(
      "UPDATE rfq_packages SET status = $2, " +
        "opened_at = CASE WHEN $3 THEN coalesce(opened_at, now()) ELSE NULL END, " +
        "opened_by = CASE WHEN $3 THEN coalesce(opened_by, $5) ELSE NULL END, " +
        "opened_by_session_id = CASE WHEN $3 THEN coalesce(opened_by_session_id, $6) ELSE NULL END, " +
        "closed_at = CASE WHEN $4 THEN coalesce(closed_at, now()) ELSE NULL END, " +
        "closed_by = CASE WHEN $4 THEN coalesce(closed_by, $5) ELSE NULL END, " +
        "closed_by_session_id = CASE WHEN $4 THEN coalesce(closed_by_session_id, $6) ELSE NULL END, " +
        "early_close_reason = CASE WHEN $4 THEN 'dong som de kiem tra' ELSE NULL END, " +
        "cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE NULL END, " +
        "cancelled_by = CASE WHEN $2 = 'CANCELLED' THEN $5::uuid ELSE NULL END, " +
        "cancelled_by_session_id = CASE WHEN $2 = 'CANCELLED' THEN $6::uuid ELSE NULL END " +
        "WHERE id = $1",
      [rfqId, trangThai, daMo, daDong, uYc, sYc],
    );
  } finally {
    for (const t of ["rfq_packages_kiem_yeu_cau_mo_thau", "rfq_packages_kiem_chuyen_trang_thai"]) {
      await db.pool.query(`ALTER TABLE rfq_packages ENABLE TRIGGER ${t}`);
    }
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

  uYc = await taoNguoi(orgA, "yc@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi(orgA, "d1@vidu.vn", "DIRECTOR");
  uB = await taoNguoi(orgB, "b@vidu.vn", "PROCUREMENT_MANAGER");
  sYc = await taoPhien(orgA, uYc);
  sD1 = await taoPhien(orgA, uD1);
  sB = await taoPhien(orgB, uB);

  csNghiem = await taoChinhSach(1, true);
  csLong = await taoChinhSach(2, false);

  expect([orgA, orgB, uYc, uD1, uB, sYc, sD1, sB, csNghiem, csLong].filter((x) => x === "")).toEqual(
    [],
  );
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

// ===============================================================================================
// [INV-A4] KHÔNG TRƯỜNG PHÁI SINH NÀO TRƯỚC MỞ THẦU
// ===============================================================================================
describe("[INV-A4] trường phái sinh chỉ tồn tại sau khi mở thầu", () => {
  it("[INV-A4] ĐỐI CHỨNG DƯƠNG: sau UNSEALED, cả năm trường phái sinh có mặt và đúng", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC Ba");
    const v2 = await nopBaoGia(rfqId, "NCC Mot");
    const v3 = await nopBaoGia(rfqId, "NCC Hai");
    await moThau(rfqId, [
      [v1, { totalAmount: "3000000.00", currency: "VND" }],
      [v2, { totalAmount: "900000.00", currency: "VND" }],
      [v3, { totalAmount: "1500000.00", currency: "VND" }],
    ]);

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, rfqId));

    // ⑴ SẮP THEO GIÁ — mệnh đề cấm nó trước mở thầu, nên nó phải có mặt SAU.
    expect(bang.rows.map((r) => r.totalAmount)).toEqual([
      "900000.00",
      "1500000.00",
      "3000000.00",
    ]);
    // ⑵ min ⑶ max ⑷ trung bình
    expect(bang.aggregates.min).toBe("900000.00");
    expect(bang.aggregates.max).toBe("3000000.00");
    expect(bang.aggregates.average).toBe("1800000.00");
    // ⑸ "số NCC dưới ngân sách" — ngân sách của fixture là 1.000.000 VND.
    expect(bang.aggregates.belowBudget).toBe(1);
    expect(bang.aggregates.parsed).toBe(3);
    expect(bang.aggregates.unparsed).toBe(0);
    expect(bang.aggregates.currencyMismatch).toBe(false);
    expect(bang.rows.map((r) => r.supplierLegalName)).toEqual(["NCC Mot", "NCC Hai", "NCC Ba"]);
  });

  it("[INV-A4] CỔNG LÀ MỘT LỚP THẬT: dữ liệu ĐÃ CÓ MẶT, đưa trạng thái lùi lại thì vẫn bị từ chối", async () => {
    // Đây là phép đo trung tâm của A4 ở S1.7. Nếu cổng chỉ là một cách nói khác của "chưa có bản
    // rõ" thì mọi vòng lặp dưới đây XANH SAI — bản rõ đang nằm trong bảng, đã đếm được ở dòng đầu.
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC A");
    await moThau(rfqId, [[v1, { totalAmount: "500000.00", currency: "VND" }]]);
    const { rows: co } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_unsealed_bids WHERE org_id = $1",
      [orgA],
    );
    expect(Number(co[0]?.n ?? "0"), "tiền đề của phép đo: bản rõ PHẢI đang có mặt").toBeGreaterThan(
      0,
    );

    const biTuChoi = MOI_TRANG_THAI.filter(
      (t) => !(COMPARISON_ALLOWED_STATUSES as readonly string[]).includes(t),
    );
    expect(biTuChoi, "năm trạng thái phải bị từ chối, không phải bốn").toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "OPEN",
      "CLOSED",
      "CANCELLED",
    ]);

    for (const trangThai of biTuChoi) {
      await epTrangThai(rfqId, trangThai);
      const loi = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, rfqId)).then(
        () => null,
        (e: unknown) => e as ComparisonDeniedError,
      );
      expect(loi, `bảng so sánh dựng được khi RFQ đang ở ${trangThai}`).toBeInstanceOf(
        ComparisonDeniedError,
      );
      expect(loi?.rfqStatus).toBe(trangThai);
    }

    // Đối chứng dương thứ hai: đưa về đúng hai trạng thái được phép thì cổng mở lại.
    for (const trangThai of COMPARISON_ALLOWED_STATUSES) {
      await epTrangThai(rfqId, trangThai);
      const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, rfqId));
      expect(bang.rfqStatus).toBe(trangThai);
      expect(bang.aggregates.min).toBe("500000.00");
    }
  });

  it("[INV-A4] tiền được cộng ở SQL: một con số double không tái lập được đi qua đây nguyên vẹn", async () => {
    // `Number("99999999999999.99")` là `99999999999999.98`. Một phép tổng hợp chạy trong tiến
    // trình Node — dù chỉ một lần `parseFloat` để so sánh — sẽ trả về con số sai ở khẳng định
    // `max` dưới đây. Đây là phép đo cho quyết định *"phép tính tiền ở SQL"* của migration 020.
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC Lon 1");
    const v2 = await nopBaoGia(rfqId, "NCC Lon 2");
    const v3 = await nopBaoGia(rfqId, "NCC Nho");
    await moThau(rfqId, [
      [v1, { totalAmount: "99999999999999.99", currency: "VND" }],
      [v2, { totalAmount: "99999999999999.99", currency: "VND" }],
      [v3, { totalAmount: "0.02", currency: "VND" }],
    ]);

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, rfqId));
    expect(bang.aggregates.max, "qua double sẽ là 99999999999999.98").toBe("99999999999999.99");
    expect(bang.aggregates.average, "qua double sẽ là 66666666666666.66").toBe(
      "66666666666666.67",
    );
    expect(bang.aggregates.min).toBe("0.02");
  });

  it("[INV-A4] báo giá không đọc ra số tiền KHÔNG bị vứt đi, và không làm hỏng phép tổng hợp", async () => {
    // Nội dung `payload` là thứ NHÀ CUNG CẤP viết. `'ba trieu'::numeric` ném, và một lần ném
    // giữa truy vấn tổng hợp làm hỏng cả bảng so sánh vì đúng một người gõ sai.
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC Dung");
    const v2 = await nopBaoGia(rfqId, "NCC Chu");
    const v3 = await nopBaoGia(rfqId, "NCC Am");
    await moThau(rfqId, [
      [v1, { totalAmount: "2000000.00", currency: "VND" }],
      [v2, { totalAmount: "ba trieu", currency: "VND" }],
      [v3, { totalAmount: "-1.00", currency: "VND" }],
    ]);

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, rfqId));
    expect(bang.rows.length, "cả ba dòng vẫn có mặt").toBe(3);
    expect(bang.aggregates.parsed).toBe(1);
    expect(bang.aggregates.unparsed).toBe(2);
    expect(bang.aggregates.min).toBe("2000000.00");
    // Dòng không đọc được giá xuống CUỐI, không lên đầu — `NULLS LAST` chứ không phải mặc định.
    expect(bang.rows[0]?.totalAmount).toBe("2000000.00");
    expect(bang.rows.slice(1).map((r) => r.totalAmount)).toEqual([null, null]);
  });

  it("[INV-A4] `bid_so_tien` từ chối bốn thứ: chuỗi lạ, NaN, Infinity, số âm", async () => {
    // Ba trong bốn là bẫy của chính kiểu `numeric`: nó NHẬN 'NaN' và 'Infinity', và `NaN > 0`
    // là TRUE trong Postgres. Đo thẳng hàm, vì một lỗi ở đây làm `min` trả về 'NaN' cho cả RFQ.
    for (const van of ["ba trieu", "NaN", "Infinity", "-Infinity", "-1", ""]) {
      const { rows: r } = await db.pool.query<{ x: string | null }>(
        "SELECT bid_so_tien($1)::text AS x",
        [van],
      );
      expect(r[0]?.x, `bid_so_tien('${van}') phải là NULL`).toBeNull();
    }
    // Đối chứng dương: hàm KHÔNG phải một hàm luôn trả NULL.
    const { rows: ok } = await db.pool.query<{ x: string | null }>(
      "SELECT bid_so_tien('1234.56')::text AS x",
    );
    expect(ok[0]?.x).toBe("1234.56");
  });

  it("[INV-A4] lệch tiền tệ làm mọi phép tổng hợp thành null thay vì thành một con số vô nghĩa", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC VND");
    const v2 = await nopBaoGia(rfqId, "NCC USD");
    await moThau(rfqId, [
      [v1, { totalAmount: "2000000.00", currency: "VND" }],
      [v2, { totalAmount: "100.00", currency: "USD" }],
    ]);

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, rfqId));
    expect(bang.aggregates.currencyMismatch).toBe(true);
    expect(bang.aggregates.currency).toBeNull();
    expect(bang.aggregates.min).toBeNull();
    expect(bang.aggregates.max).toBeNull();
    expect(bang.aggregates.average).toBeNull();
    expect(bang.aggregates.belowBudget).toBeNull();
    // Nhưng hai dòng thì VẪN ra — người mua thấy được hai báo giá, chỉ không thấy một phép so sai.
    expect(bang.rows.length).toBe(2);
    expect(bang.aggregates.parsed).toBe(2);
  });
});

// ===============================================================================================
// [INV-A6] SỐ BÁO GIÁ ĐÃ NHẬN LÀ THÔNG TIN NHẠY CẢM
// ===============================================================================================
describe("[INV-A6] chế độ nghiêm giấu số báo giá đã nhận trước giờ đóng", () => {
  it("[INV-A6] CÙNG RFQ, CÙNG TRẠNG THÁI, ĐỔI ĐÚNG CỜ CHÍNH SÁCH — câu trả lời lật", async () => {
    // Khuôn "một trạng thái chỉ khác đúng một thứ": nếu hàm bỏ qua cờ chính sách thì hai khẳng
    // định dưới đây không thể cùng xanh.
    const rfqNghiem = await taoRfqMo(csNghiem);
    const rfqLong = await taoRfqMo(csLong);
    await nopBaoGia(rfqNghiem, "NCC N1");
    await nopBaoGia(rfqNghiem, "NCC N2");
    await nopBaoGia(rfqLong, "NCC L1");
    await nopBaoGia(rfqLong, "NCC L2");

    const a = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqNghiem));
    expect(a.disclosed).toBe(false);
    expect(a).toEqual({
      disclosed: false,
      reason: "STRICT_BLIND_BEFORE_CLOSE",
      rfqStatus: "OPEN",
    });
    // Hình dạng là một tuyên bố: nhánh giấu KHÔNG có trường `count` để mà đọc.
    expect(Object.keys(a).includes("count")).toBe(false);

    const b = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqLong));
    expect(b).toEqual({ disclosed: true, count: 2 });
  });

  it("[INV-A6] chế độ nghiêm: giấu ở DRAFT/PENDING_APPROVAL/OPEN/CANCELLED, công bố từ CLOSED", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    await nopBaoGia(rfqId, "NCC X");

    for (const trangThai of ["DRAFT", "PENDING_APPROVAL", "OPEN", "CANCELLED"]) {
      await epTrangThai(rfqId, trangThai);
      const kq = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqId));
      expect(kq.disclosed, `số báo giá bị công bố khi RFQ đang ở ${trangThai}`).toBe(false);
    }
    // `CANCELLED` nằm ở nhóm GIẤU chứ không nhóm CÔNG BỐ, và đó là một lựa chọn: một RFQ bị huỷ
    // có thể chưa từng đi qua `CLOSED`, nên hạn nộp của nó chưa chắc đã qua.
    for (const trangThai of ["CLOSED", "UNSEALED", "EVALUATING"]) {
      await epTrangThai(rfqId, trangThai);
      const kq = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqId));
      expect(kq, `số báo giá bị giấu khi RFQ đã ở ${trangThai}`).toEqual({
        disclosed: true,
        count: 1,
      });
    }
  });

  it("[INV-A6] chính sách ĐÃ GHIM thắng chính sách MỚI NHẤT — cả hai chiều", async () => {
    // Phép đo này được dựng lại một lần sau khi bản đầu bị chứng minh là KHÔNG CÓ RĂNG: bản ấy
    // ghim vào `csLong` trong khi `csLong` cũng đúng là chính sách mới nhất, nên gỡ hẳn nhánh
    // tra-theo-ghim khỏi `rfq_che_do_nghiem` vẫn cho cùng câu trả lời. Một test xanh dưới cả
    // hai cài đặt không đo cài đặt nào.
    //
    // Bản này ghim NGƯỢC với thứ mà "chính sách mới nhất" sẽ chọn, ở CẢ HAI CHIỀU:
    //   • RFQ ghim `csNghiem` (v1, NGHIÊM) trong khi mới nhất là `csLong` (v2, LỎNG) -> phải GIẤU
    //   • RFQ ghim `csLong`   (v2, LỎNG)   trong khi sau đó có v90 NGHIÊM         -> phải CÔNG BỐ
    const rfqNghiem = await taoRfqMo(csNghiem);
    await nopBaoGia(rfqNghiem, "NCC Ghim Nghiem");
    const a = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqNghiem));
    expect(a.disclosed, "ghim vào v1 NGHIÊM mà lại đọc v2 LỎNG — nhánh tra-theo-ghim đã mất").toBe(
      false,
    );

    const rfqLong = await taoRfqMo(csLong);
    await nopBaoGia(rfqLong, "NCC Ghim Long");
    await taoChinhSach(90, true);
    const b = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqLong));
    expect(b, "chính sách BAN HÀNH SAU không được đổi phán quyết của một RFQ đã ghim").toEqual({
      disclosed: true,
      count: 1,
    });
  });

  it("[INV-A6] không có chính sách nào tra được thì MẶC ĐỊNH ĐÓNG — và đó là hướng an toàn", async () => {
    // Tổ chức B chưa từng ban hành chính sách nào. RFQ ở đó không có `rfq_budgets` (nó cần phê
    // duyệt kép nên không phải chứng minh gì), tức cả hai nguồn tra đều rỗng.
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, created_by, created_by_session_id) " +
        "VALUES ($1, 'Mua thep tam', $2, $3, $4) RETURNING id",
      [orgB, MAI_SAU, uB, sB],
    );
    const rfqId = rows[0]?.id ?? "";
    const kq = await withTenant(apiPool, orgB, (c) => countReceivedBids(c, orgB, rfqId));
    expect(kq).toEqual({
      disclosed: false,
      reason: "STRICT_BLIND_BEFORE_CLOSE",
      rfqStatus: "DRAFT",
    });

    // Đối chứng dương: ban hành một chính sách KHÔNG nghiêm, có hiệu lực TRƯỚC lúc RFQ ra đời,
    // thì nguồn tra ⑵ tìm thấy nó và phán quyết lật. Không có vế này, khẳng định trên xanh kể cả
    // khi hàm là `SELECT true`.
    await db.pool.query(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
        "strict_blind_mode, effective_from, created_by, created_by_session_id) " +
        "VALUES ($1, 1, '100000000.00', 'VND', false, now() - interval '1 year', $2, $3)",
      [orgB, uB, sB],
    );
    const sau = await withTenant(apiPool, orgB, (c) => countReceivedBids(c, orgB, rfqId));
    expect(sau).toEqual({ disclosed: true, count: 0 });
  });

  it("[INV-A6] PHẦN CHÊNH ĐƯỢC ĐO: `app_api` VẪN đếm được bảng bằng SQL viết tay", async () => {
    // Ô ✅ của A6 KHÔNG được nuốt câu này. Cột "Cưỡng chế" của A6 ghi *"Ứng dụng"* — và đây là
    // đúng nghĩa của chữ ấy: hàng rào nằm ở hàm, không ở quyền. Một truy vấn viết tay đi vòng
    // qua nó. Test này tồn tại để phần chênh ở §4 là thứ ĐÃ ĐO, không phải thứ phỏng đoán.
    const rfqId = await taoRfqMo(csNghiem);
    await nopBaoGia(rfqId, "NCC Vong");
    await nopBaoGia(rfqId, "NCC Vong 2");

    const bi = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, rfqId));
    expect(bi.disclosed).toBe(false);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM vendor_bids b " +
          "JOIN rfq_invitations i ON i.id = b.invitation_id AND i.org_id = b.org_id " +
          "WHERE i.rfq_id = $1",
        [rfqId],
      ),
    );
    expect(rows[0]?.n, "nếu dòng này ĐỎ thì A6 đã lên được tầng quyền — cập nhật §4").toBe("2");
  });
});
