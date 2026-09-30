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

import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { DenialAuditFailedError, PermissionDeniedError } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  COMPARISON_ALLOWED_STATUSES,
  ComparisonDeniedError,
  ComparisonError,
  type ComparisonTable,
  approveUnseal,
  buildComparisonTable,
  countReceivedBids,
  requestUnseal,
} from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

/**
 * ~~Bảy~~ **[S1.108] MƯỜI** giá trị của `rfq_packages.status`.
 *
 * ~~đọc từ chính CHECK của 009, không chép tay~~ — **câu ấy SAI, và nó sai từ lúc được viết**:
 * khối dưới là một mảng CHÉP TAY, không một phép đọc. `059` thêm ba giá trị và danh sách này
 * thiu trong im lặng cho tới khi một test dùng nó. Giữ nguyên hình thức chép tay (một phép đọc
 * ở đây sẽ làm hai test dưới mất khả năng nói "đúng bảy" / "đúng ba"), nhưng thôi khai rằng nó
 * là một phép đọc. Bản khớp-với-CSDL nằm ở `packages/rfq/src/transitions.test.ts`, nơi tập đóng
 * được BÓC từ văn bản `059` và so với `RFQ_STATUSES`.
 */
const MOI_TRANG_THAI = [
  "DRAFT",
  "PENDING_APPROVAL",
  "OPEN",
  "CLOSED",
  "UNSEALED",
  "EVALUATING",
  "BAFO_OPEN",
  "BAFO_CLOSED",
  "BAFO_UNSEALED",
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
  // [S1.142 / khoản 241] Sàn một chữ ký (`068`): một chữ ký của người KHÁC người tạo trước khi mở.
  await db.pool.query(
    "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)",
    [orgA, rfqId, uD1, sD1],
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

/**
 * Đóng RFQ, xin + duyệt mở thầu, ghi bản rõ dưới `app_unseal`, rồi tuyên bố UNSEALED.
 *
 * [S1.218 / khoản 114] Một `payload` là CHUỖI được ghi NGUYÊN VĂN làm văn bản JSON, không qua
 * `JSON.stringify`: ca `1e324` không viết ra được từ một giá trị JS (`Number("1e324")` là
 * `Infinity`, và `JSON.stringify(Infinity)` là `null`) — Postgres thì đọc `1e324` thành một
 * `numeric` 325 chữ số, và đó đúng là thứ khoản 114 đo.
 */
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
        [orgA, yc.id, versionId, typeof payload === "string" ? payload : JSON.stringify(payload)],
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
  // [S1.108 / 059] Ba trạng thái BAFO chỉ tới được QUA `OPEN` rồi `CLOSED`, nên chúng thuộc CẢ
  // HAI tập. Bốn ràng buộc mốc của `009`+`011` đòi đúng thế, và thiếu chúng ở đây thì câu ép
  // trạng thái vỡ với `violates check constraint "rfq_da_dong_thi_co_moc_dong"` — đã đo.
  const DA_MO = ["OPEN", "CLOSED", "UNSEALED", "EVALUATING", "BAFO_OPEN", "BAFO_CLOSED", "BAFO_UNSEALED"];
  const DA_DONG = ["CLOSED", "UNSEALED", "EVALUATING", "BAFO_OPEN", "BAFO_CLOSED", "BAFO_UNSEALED"];
  const daMo = DA_MO.includes(trangThai);
  const daDong = DA_DONG.includes(trangThai);
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

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));

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
    // [S1.108 / 059] ~~năm~~ **BẢY**: `BAFO_OPEN` và `BAFO_CLOSED` là quãng nhà cung cấp đang
    // nộp lại NIÊM PHONG, và bảng so sánh đóng suốt quãng ấy. `BAFO_UNSEALED` thì MỞ — phong bì
    // vòng hai vừa qua cổng bốn vế, và bảng xếp hạng sắp được tính lại từ đó.
    expect(biTuChoi, "bảy trạng thái phải bị từ chối, không phải năm").toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "OPEN",
      "CLOSED",
      "BAFO_OPEN",
      "BAFO_CLOSED",
      "CANCELLED",
    ]);

    for (const trangThai of biTuChoi) {
      await epTrangThai(rfqId, trangThai);
      const loi = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool)).then(
        () => null,
        (e: unknown) => e as ComparisonDeniedError,
      );
      expect(loi, `bảng so sánh dựng được khi RFQ đang ở ${trangThai}`).toBeInstanceOf(
        ComparisonDeniedError,
      );
      expect(loi?.rfqStatus).toBe(trangThai);
    }

    // Đối chứng dương thứ hai: đưa về đúng ~~hai~~ **[S1.108] ba** trạng thái được phép thì cổng mở lại.
    for (const trangThai of COMPARISON_ALLOWED_STATUSES) {
      await epTrangThai(rfqId, trangThai);
      const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
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

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
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

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
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

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
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
// [INV-J8] [S1.165 / khoản 244] BẢNG SO SÁNH ĐỌC TIỀN TỆ QUA CÙNG HÀM VỚI LƯỢT CHẤM
// ===============================================================================================
// ĐO TRƯỚC khi sửa, trên đúng tệp này (biên bản §S1.165): `VND` + `VNĐ` cho HAI nhóm và mọi phép tổng
// hợp thành `null`; hai báo giá cùng `vnd` dưới ngân sách 1.000.000 VND cho `belowBudget` = 0 — vế
// ngân sách so `'VND' = 'vnd'` — trong khi cả hai con số đều dưới ngân sách. Ba ca dưới là ĐÍCH.
describe("[INV-J8] [S1.165 / khoản 244] bảng so sánh và lượt chấm cùng một phán quyết tiền tệ", () => {
  it("[INV-J8] ĐÍCH của đo M4: `VND` + `VNĐ` là MỘT nhóm `VND`, phép tổng hợp có số, và dòng mang đơn vị đã chuẩn hoá", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC Chinh tac");
    const v2 = await nopBaoGia(rfqId, "NCC Go dau");
    await moThau(rfqId, [
      [v1, { totalAmount: "2000000.00", currency: "VND" }],
      [v2, { totalAmount: "900000.00", currency: "VN\u0110" }],
    ]);
    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(bang.aggregates.currencyMismatch).toBe(false);
    expect(bang.aggregates.currency).toBe("VND");
    expect(bang.aggregates.min).toBe("900000.00");
    expect(bang.aggregates.max).toBe("2000000.00");
    expect(bang.aggregates.belowBudget, "ngân sách fixture 1.000.000 VND — một báo giá dưới").toBe(1);
    expect(bang.rows.map((r) => r.currency)).toEqual(["VND", "VND"]);
    // Chuỗi GỐC vẫn còn nguyên trong `payload` — lớp đọc chuẩn hoá, bản rõ không bị sửa.
    expect(bang.rows.map((r) => (r.payload as { currency?: string }).currency)).toEqual(["VN\u0110", "VND"]);
  });

  it("[INV-J8] ĐÍCH của đo M5: hai báo giá cùng `vnd` ⇒ đơn vị `VND`, và vế ngân sách đếm ĐÚNG 2 thay vì 0", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC Mot vnd");
    const v2 = await nopBaoGia(rfqId, "NCC Hai vnd");
    await moThau(rfqId, [
      [v1, { totalAmount: "500000.00", currency: "vnd" }],
      [v2, { totalAmount: "900000.00", currency: "vnd" }],
    ]);
    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(bang.aggregates.currency).toBe("VND");
    expect(bang.aggregates.currencyMismatch).toBe(false);
    expect(bang.aggregates.belowBudget).toBe(2);
  });

  it("[INV-J8] một nhóm DUY NHẤT mà đơn vị không nhận ra ⇒ lệch, như lượt chấm nói; không in min/max của những con số không đơn vị", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, "NCC EUR mot");
    const v2 = await nopBaoGia(rfqId, "NCC EUR hai");
    await moThau(rfqId, [
      [v1, { totalAmount: "500000.00", currency: "EUR" }],
      [v2, { totalAmount: "900000.00", currency: "EUR" }],
    ]);
    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(bang.aggregates.currencyMismatch, "bản trước: `false`, một nhóm `EUR` đọc như một đơn vị hợp lệ").toBe(true);
    expect(bang.aggregates.currency).toBeNull();
    expect(bang.aggregates.min).toBeNull();
    expect(bang.aggregates.belowBudget).toBeNull();
    expect(bang.rows.map((r) => r.currency)).toEqual([null, null]);
    expect(bang.aggregates.parsed, "hai con số vẫn ĐỌC ĐƯỢC — chỉ đơn vị thì không").toBe(2);
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

    const a = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqNghiem, actorSessionId: sYc }, apiPool));
    expect(a.disclosed).toBe(false);
    expect(a).toEqual({
      disclosed: false,
      reason: "STRICT_BLIND_BEFORE_CLOSE",
      rfqStatus: "OPEN",
    });
    // Hình dạng là một tuyên bố: nhánh giấu KHÔNG có trường `count` để mà đọc.
    expect(Object.keys(a).includes("count")).toBe(false);

    const b = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqLong, actorSessionId: sYc }, apiPool));
    expect(b).toEqual({ disclosed: true, count: 2 });
  });

  it("[INV-A6] chế độ nghiêm: giấu ở DRAFT/PENDING_APPROVAL/OPEN/CANCELLED, công bố từ CLOSED", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    await nopBaoGia(rfqId, "NCC X");

    for (const trangThai of ["DRAFT", "PENDING_APPROVAL", "OPEN", "CANCELLED"]) {
      await epTrangThai(rfqId, trangThai);
      const kq = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
      expect(kq.disclosed, `số báo giá bị công bố khi RFQ đang ở ${trangThai}`).toBe(false);
    }
    // `CANCELLED` nằm ở nhóm GIẤU chứ không nhóm CÔNG BỐ, và đó là một lựa chọn: một RFQ bị huỷ
    // có thể chưa từng đi qua `CLOSED`, nên hạn nộp của nó chưa chắc đã qua.
    for (const trangThai of ["CLOSED", "UNSEALED", "EVALUATING"]) {
      await epTrangThai(rfqId, trangThai);
      const kq = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
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
    //   • RFQ ghim `csLong`   (v2, LỎNG)   trong khi sau đó có ~~v90~~ v3 NGHIÊM      -> phải CÔNG BỐ
    //     ([035] phiên bản phải BẰNG đúng lớn nhất + 1 — v90 không còn chèn được, và không cần: cái
    //     test đo là "ban hành SAU", không phải "số lớn".)
    const rfqNghiem = await taoRfqMo(csNghiem);
    await nopBaoGia(rfqNghiem, "NCC Ghim Nghiem");
    const a = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqNghiem, actorSessionId: sYc }, apiPool));
    expect(a.disclosed, "ghim vào v1 NGHIÊM mà lại đọc v2 LỎNG — nhánh tra-theo-ghim đã mất").toBe(
      false,
    );

    const rfqLong = await taoRfqMo(csLong);
    await nopBaoGia(rfqLong, "NCC Ghim Long");
    await taoChinhSach(3, true);
    const b = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqLong, actorSessionId: sYc }, apiPool));
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
    const kq = await withTenant(apiPool, orgB, (c) => countReceivedBids(c, orgB, { rfqId: rfqId, actorSessionId: sB }, apiPool));
    expect(kq).toEqual({
      disclosed: false,
      reason: "STRICT_BLIND_BEFORE_CLOSE",
      rfqStatus: "DRAFT",
    });

    // ĐỐI CHỨNG DƯƠNG, và nó đã phải VIẾT LẠI MỘT LẦN — chuyện đáng ghi hơn bản thân phép đo.
    //
    // Bản đầu ban hành một chính sách với `effective_from = now() - interval '1 year'`, tức LÙI
    // hiệu lực về trước lúc RFQ ra đời. Nó chạy, và nó xanh. Rồi review an ninh S1.7 (MED-2) chỉ
    // ra rằng chính đường ấy là một lỗ: lùi được hiệu lực nghĩa là lật được CHẾ ĐỘ NGHIÊM của
    // MỌI RFQ chưa có ngân sách, HỒI TỐ — trong khi 020 khẳng định nhánh ⑵ *"CỐ ĐỊNH theo thời
    // gian"*. Câu khẳng định ấy đúng chỉ vì `createProcurementPolicy` tình cờ không truyền cột
    // đó, chứ 014 CÓ cấp INSERT trên nó.
    //
    // `CHECK (effective_from >= created_at)` của 022 đóng đường ấy — và bằng chứng nó có răng là
    // chính test này đã ĐỎ khi ràng buộc được thêm vào. Nên đối chứng dương nay đi đường THẬT:
    // chính sách ra đời TRƯỚC, RFQ ra đời SAU.
    await db.pool.query(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
        "strict_blind_mode, created_by, created_by_session_id) " +
        "VALUES ($1, 1, '100000000.00', 'VND', false, $2, $3)",
      [orgB, uB, sB],
    );
    const { rows: sauNay } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, created_by, created_by_session_id) " +
        "VALUES ($1, 'Mua thep tam dot hai', $2, $3, $4) RETURNING id",
      [orgB, MAI_SAU, uB, sB],
    );
    const sau = await withTenant(apiPool, orgB, (c) =>
      countReceivedBids(c, orgB, { rfqId: sauNay[0]?.id ?? "", actorSessionId: sB }, apiPool),
    );
    expect(sau, "chính sách KHÔNG nghiêm có hiệu lực trước RFQ thì con số được công bố").toEqual({
      disclosed: true,
      count: 0,
    });

    // Và RFQ CŨ — ra đời khi chưa có chính sách nào — KHÔNG bị chính sách mới kéo theo.
    const cu = await withTenant(apiPool, orgB, (c) =>
      countReceivedBids(c, orgB, { rfqId, actorSessionId: sB }, apiPool),
    );
    expect(cu.disclosed, "một chính sách ban hành SAU không được đổi phán quyết của RFQ cũ").toBe(
      false,
    );
  });

  it("[INV-A6] PHẦN CHÊNH ĐƯỢC ĐO: `app_api` VẪN đếm được bảng bằng SQL viết tay", async () => {
    // Ô ✅ của A6 KHÔNG được nuốt câu này. Cột "Cưỡng chế" của A6 ghi *"Ứng dụng"* — và đây là
    // đúng nghĩa của chữ ấy: hàng rào nằm ở hàm, không ở quyền. Một truy vấn viết tay đi vòng
    // qua nó. Test này tồn tại để phần chênh ở §4 là thứ ĐÃ ĐO, không phải thứ phỏng đoán.
    const rfqId = await taoRfqMo(csNghiem);
    await nopBaoGia(rfqId, "NCC Vong");
    await nopBaoGia(rfqId, "NCC Vong 2");

    const bi = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqId, actorSessionId: sYc }, apiPool));
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

// ===============================================================================================
// [S1.72 / khoản 121] LẦN TỪ CHỐI A4 CỦA BẢNG SO SÁNH VÀO SỔ
//
// Đo trên master 298cd4e, trước bản vá (§S1.72): `buildComparisonTable` qua cổng quyền rồi ném `ComparisonDeniedError` ở CLOSED và OPEN mà
// không ghi hàng sổ nào; qua `GET /rfqs/:rfqId/comparison` là 422 mang trạng thái RFQ, cũng 0 hàng. Một người giữ `bid.view` gọi liên tục
// để dò "RFQ đã mở thầu chưa" sinh CON SỐ KHÔNG bản ghi — đúng hình dạng khoản nợ 32 đã đóng cho cổng mở thầu.
// ===============================================================================================
describe("[INV-D5] [S1.72 / khoản 121] bảng so sánh từ chối vì A4 thì ghi sổ — ở giao dịch độc lập, và lần cho qua không ghi", () => {
  let auditPool: pg.Pool;

  beforeAll(() => {
    auditPool = db.poolAs("app_api");
  });

  afterAll(async () => {
    await auditPool?.end().catch(() => undefined);
  });

  async function demTuChoiSoSanh(rfqId: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'COMPARISON_DENIED' AND resource_id = $2",
      [orgA, rfqId],
    );
    return Number(rows[0]?.n ?? "-1");
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ — cùng khuôn `voiGhiSoBiChan` của unseal.int.test.ts. */
  async function voiGhiSoBiChan<T>(action: string, viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k121_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k121 thong diep noi bo' USING ERRCODE = 'TP121'; END$$",
      );
      await db.pool.query(
        `CREATE TRIGGER k121_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = '${action}') ` +
          "EXECUTE FUNCTION public.k121_chan_ghi_so()",
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k121_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k121_chan_ghi_so()");
    }
  }

  it("[INV-D5] ~~năm~~ BẢY trạng thái bị từ chối ⇒ `ComparisonDeniedError` như cũ và mỗi lần đúng một `COMPARISON_DENIED` mang trạng thái RFQ và người xem; ~~hai~~ BA trạng thái được phép không thêm hàng nào", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const biTuChoi = MOI_TRANG_THAI.filter((t) => !(COMPARISON_ALLOWED_STATUSES as readonly string[]).includes(t));
    for (const [i, trangThai] of biTuChoi.entries()) {
      await epTrangThai(rfqId, trangThai);
      const loi = await loiCua(
        withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, auditPool)),
      );
      expect(loi, `bảng so sánh dựng được khi RFQ đang ở ${trangThai}`).toBeInstanceOf(ComparisonDeniedError);
      expect(await demTuChoiSoSanh(rfqId), `lần từ chối ở ${trangThai} không vào sổ`).toBe(i + 1);
    }
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string | null; resource_type: string; payload: unknown }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND action = 'COMPARISON_DENIED' AND resource_id = $2 ORDER BY seq",
      [orgA, rfqId],
    );
    // [S1.72 / lượt soi 67a-8] Loại tài nguyên và HÌNH DẠNG trọn của payload.
    expect(rows.map((r) => [r.actor_type, r.actor_id, r.resource_type, r.payload])).toEqual(biTuChoi.map((t) => ["USER", uYc, "RFQ", { rfqStatus: t }]));

    for (const trangThai of COMPARISON_ALLOWED_STATUSES) {
      await epTrangThai(rfqId, trangThai);
      await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, auditPool));
    }
    expect(await demTuChoiSoSanh(rfqId), "lần cho qua KHÔNG được ghi bản ghi từ chối").toBe(biTuChoi.length);
  });

  it("[INV-D5] bản ghi `COMPARISON_DENIED` sống qua rollback của người gọi", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const CHAN = new Error("chan-lai-de-do-rollback");
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, auditPool).catch(() => undefined);
        throw CHAN;
      }),
    ).rejects.toBe(CHAN);
    expect(await demTuChoiSoSanh(rfqId), "bản ghi từ chối biến mất cùng rollback — nó phải ở một giao dịch ĐỘC LẬP").toBe(1);
  });

  it("[INV-D5] lần ghi `COMPARISON_DENIED` ném TP121 ⇒ `DenialAuditFailedError` giữ `ComparisonDeniedError` mang trạng thái RFQ, lỗi của lần ghi trong `cause`; không hàng sổ nào", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const loi = await voiGhiSoBiChan("COMPARISON_DENIED", () =>
      loiCua(withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, auditPool))),
    );
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const x = loi as DenialAuditFailedError;
    expect(x.denial).toBeInstanceOf(ComparisonDeniedError);
    expect((x.denial as ComparisonDeniedError).rfqStatus).toBe("OPEN");
    expect((x.cause as { code?: unknown }).code).toBe("TP121");
    expect(await demTuChoiSoSanh(rfqId)).toBe(0);
  });
});

// ===============================================================================================
// [S1.164 / khoản 245 / ADR-102] MỖI LƯỢT ĐỌC BẢNG SO SÁNH ĐỂ LẠI MỘT HÀNG SỔ — CÙNG GIAO DỊCH ĐỌC
//
// `docs/PRODUCT.md` §5 kể *"mọi lần đọc bảng so sánh sau mở thầu đều có hàng sổ"* là một trong ba thứ sản phẩm LÀM ĐƯỢC trước
// rò nghiệp vụ của BAFO. Trước vòng này chỉ lần TỪ CHỐI vào sổ (khối `[INV-D5]` ngay trên đo đúng điều đó: *"lần cho qua không
// ghi"*). Khối này đo lần CHO QUA: đúng một hàng, cùng sống cùng chết với giao dịch đọc, và ghi hỏng thì không bảng nào đi ra.
// ===============================================================================================
describe("[S1.164 / khoản 245] lượt ĐỌC bảng so sánh để lại một hàng sổ, trong chính giao dịch đọc", () => {
  const GIA_A = "4440000.00";
  const GIA_B = "5550000.00";

  async function demXem(rfqId: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'COMPARISON_VIEWED' AND resource_id = $2",
      [orgA, rfqId],
    );
    return Number(rows[0]?.n ?? "-1");
  }

  async function goiDaMo(): Promise<string> {
    const rfqId = await taoRfqMo(csNghiem);
    const v1 = await nopBaoGia(rfqId, `NCC xem A ${randomBytes(3).toString("hex")}`);
    const v2 = await nopBaoGia(rfqId, `NCC xem B ${randomBytes(3).toString("hex")}`);
    await moThau(rfqId, [
      [v1, { totalAmount: GIA_A, currency: "VND" }],
      [v2, { totalAmount: GIA_B, currency: "VND" }],
    ]);
    return rfqId;
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  it("⒜ mỗi lượt đọc được ⇒ ĐÚNG MỘT hàng `COMPARISON_VIEWED` nêu người đọc, gói thầu và phiên — không một con số nào của bảng", async () => {
    const rfqId = await goiDaMo();
    expect(await demXem(rfqId)).toBe(0);
    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(bang.rows.map((r) => r.totalAmount)).toEqual([GIA_A, GIA_B]);
    await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sD1 }, apiPool));
    expect(await demXem(rfqId), "hai lượt đọc ⇒ hai hàng").toBe(2);
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string | null; resource_type: string; payload: unknown }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND action = 'COMPARISON_VIEWED' AND resource_id = $2 ORDER BY seq",
      [orgA, rfqId],
    );
    // HÌNH DẠNG TRỌN của payload: trạng thái gói và phiên đã đọc — không giá, không số dòng.
    expect(rows.map((r) => [r.actor_type, r.actor_id, r.resource_type, r.payload])).toEqual([
      ["USER", uYc, "RFQ", { rfqStatus: "UNSEALED", viewedBySessionId: sYc }],
      ["USER", uD1, "RFQ", { rfqStatus: "UNSEALED", viewedBySessionId: sD1 }],
    ]);
    const van = JSON.stringify(rows);
    for (const gia of [GIA_A, GIA_B]) expect(van).not.toContain(gia.slice(0, 4));
  });

  it("⒝ lượt bị TỪ CHỐI không ghi `COMPARISON_VIEWED` — thiếu `bid.view`, và gói chưa mở thầu", async () => {
    const rfqId = await goiDaMo();
    const uMua = await taoNguoi(orgA, `mua-k245-${randomBytes(3).toString("hex")}@vidu.vn`, "BUYER");
    const sMua = await taoPhien(orgA, uMua);
    const loi = await loiCua(withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sMua }, apiPool)));
    expect(loi, "BUYER không giữ `bid.view` mà vẫn đọc được bảng").toBeInstanceOf(PermissionDeniedError);
    expect(await demXem(rfqId), "lần từ chối quyền KHÔNG phải một lượt đọc").toBe(0);

    const chuaMo = await taoRfqMo(csNghiem);
    const loi2 = await loiCua(withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: chuaMo, actorSessionId: sYc }, apiPool)));
    expect(loi2).toBeInstanceOf(ComparisonDeniedError);
    expect(await demXem(chuaMo), "lần từ chối A4 KHÔNG phải một lượt đọc").toBe(0);
  });

  it("⒞ hàng sổ và bảng CÙNG SỐNG HAY CÙNG CHẾT: giao dịch của người đọc cuộn lại thì hàng biến theo — khác hẳn `COMPARISON_DENIED`", async () => {
    const rfqId = await goiDaMo();
    const CHAN = new Error("chan-lai-sau-khi-doc");
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool);
        throw CHAN;
      }),
    ).rejects.toBe(CHAN);
    expect(await demXem(rfqId), "hàng của lượt đọc phải nằm TRONG giao dịch đọc, không ở một giao dịch độc lập").toBe(0);
  });

  it("⒟ fail-closed: lần ghi `COMPARISON_VIEWED` hỏng ⇒ hàm NÉM chính lỗi ấy, không bảng nào đi ra, không hàng sổ nào", async () => {
    const rfqId = await goiDaMo();
    let bang: unknown = "chua-goi";
    let loi: unknown = null;
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k245_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k245 thong diep noi bo' USING ERRCODE = 'TP245'; END$$",
      );
      await db.pool.query(
        "CREATE TRIGGER k245_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = 'COMPARISON_VIEWED') " +
          "EXECUTE FUNCTION public.k245_chan_ghi_so()",
      );
      bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    } catch (e) {
      loi = e;
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k245_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k245_chan_ghi_so()");
    }
    expect(bang, "bảng đi ra dù sổ không ghi được").toBe("chua-goi");
    expect((loi as { code?: unknown } | null)?.code).toBe("TP245");
    expect(await demXem(rfqId)).toBe(0);
    // Đối chứng: gỡ lớp chặn thì cùng lời gọi ấy đọc được và ghi đúng một hàng.
    await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(await demXem(rfqId)).toBe(1);
  });
});

// ===============================================================================================
// [S1.218 / khoản 114] SỐ TIỀN ĐƯỢC TÍNH ĐÚNG MỘT LẦN MỖI HÀNG BẢN RÕ MỖI CÂU, VÀ KHÔNG TÍNH TRÊN
// MỘT `totalAmount` KHÔNG VÔ HƯỚNG
//
// ĐO TRƯỚC khi sửa, trên đúng tệp này (biên bản §S1.218): `comparison.ts` gọi
// `bid_so_tien(payload->>'totalAmount')` BẢY lần cho mỗi báo giá đọc được (hai ở câu hàng, năm ở
// câu tổng hợp) và BA lần cho một báo giá mà `totalAmount` là MẢNG — vì `->>` dựng CẢ CÂY thành văn
// bản trước khi `bid_so_tien` kịp trả NULL. Với 20 000 phần tử `1e324` (120 KB văn bản vào, vài KB
// jsonb lưu), mỗi lần gọi nhận 6 540 002 ký tự.
//
// Khối này đếm SỐ LẦN `bid_so_tien` được gọi và ĐỘ DÀI văn bản nó nhận — qua một hàm bọc phát NOTICE
// đặt vào đúng tên `public.bid_so_tien` rồi gỡ ra — thay vì đòi một trần mili-giây: trên máy dùng
// chung, một trần thời gian là một test lúc đỏ lúc xanh, còn số lần gọi thì không. Thời lượng của
// ca ⒜ (không hàm bọc) là số đo mili-giây; nó được ghi ở biên bản, không được khẳng định ở đây.
// ===============================================================================================
describe("[S1.218 / khoản 114] `bid_so_tien` chạy một lần mỗi hàng bản rõ mỗi câu, và không chạy trên `totalAmount` không vô hướng", () => {
  const SO_PHAN_TU = 20_000;
  /** Văn bản JSON THÔ — xem chú thích của `moThau`. */
  const MANG_1E324 = `{"totalAmount":[${Array.from({ length: SO_PHAN_TU }, () => "1e324").join(",")}],"currency":"VND"}`;
  /** Độ dài mà `->>` dựng từ mảng ấy: 325 chữ số mỗi phần tử, `, ` giữa hai phần tử, hai dấu ngoặc. */
  const DO_DAI_KHAI_TRIEN = SO_PHAN_TU * 325 + (SO_PHAN_TU - 1) * 2 + 2;
  const GIA_HOP_LE = "2000000.00";

  let rfqMang: string;

  beforeAll(async () => {
    rfqMang = await taoRfqMo(csNghiem);
    const vHopLe = await nopBaoGia(rfqMang, "NCC Vo huong");
    const vMang = await nopBaoGia(rfqMang, "NCC Mang");
    await moThau(rfqMang, [
      [vHopLe, { totalAmount: GIA_HOP_LE, currency: "VND" }],
      [vMang, MANG_1E324],
    ]);
    // Tiền đề của phép đo: mảng nằm trong bảng ĐÚNG như mảng, và văn bản `->>` của nó dài đúng như tính.
    const { rows } = await db.pool.query<{ loai: string; do_dai: number }>(
      "SELECT jsonb_typeof(payload -> 'totalAmount') AS loai, length(payload ->> 'totalAmount') AS do_dai " +
        "  FROM rfq_unsealed_bids WHERE bid_version_id = $1",
      [vMang],
    );
    expect(rows[0]).toEqual({ loai: "array", do_dai: DO_DAI_KHAI_TRIEN });
  }, 180_000);

  async function docThanBidSoTien(): Promise<string> {
    const { rows } = await db.pool.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE proname = 'bid_so_tien' AND pronamespace = 'public'::regnamespace",
    );
    expect(rows.length, "đúng một `public.bid_so_tien`").toBe(1);
    return rows[0]?.prosrc ?? "";
  }

  /**
   * Chạy `viec` trong lúc `public.bid_so_tien` là một hàm bọc: IMMUTABLE STRICT như hàm gốc — để bộ
   * lập kế hoạch đối xử y hệt —, phát một NOTICE mang ĐỘ DÀI đối số (không mang giá trị) rồi gọi hàm
   * gốc dưới tên tạm. Gỡ trong `finally`, và thân hàm gốc phải trở lại nguyên vẹn.
   */
  async function voiBidSoTienDuocDem<T>(
    viec: (c: pg.PoolClient) => Promise<T>,
  ): Promise<{ ketQua: T; doDai: readonly number[] }> {
    const thanGoc = await docThanBidSoTien();
    await db.pool.query("ALTER FUNCTION public.bid_so_tien(text) RENAME TO bid_so_tien_goc");
    try {
      await db.pool.query(
        "CREATE FUNCTION public.bid_so_tien(p_van text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT " +
          "SET search_path = pg_catalog, public AS $$BEGIN RAISE NOTICE 'k114 do_dai=%', length(p_van); " +
          "RETURN public.bid_so_tien_goc(p_van); END$$",
      );
      const doDai: number[] = [];
      const nghe = (n: { message?: string | undefined }): void => {
        const m = /^k114 do_dai=(\d+)$/u.exec(n.message ?? "");
        if (m !== null) doDai.push(Number(m[1]));
      };
      const ketQua = await withTenant(apiPool, orgA, async (c) => {
        c.on("notice", nghe);
        try {
          return await viec(c);
        } finally {
          c.off("notice", nghe);
        }
      });
      return { ketQua, doDai };
    } finally {
      await db.pool.query("DROP FUNCTION IF EXISTS public.bid_so_tien(text)");
      await db.pool.query("ALTER FUNCTION public.bid_so_tien_goc(text) RENAME TO bid_so_tien");
      expect(await docThanBidSoTien(), "gỡ hàm bọc phải trả lại đúng thân hàm gốc").toBe(thanGoc);
    }
  }

  function bangCua(rfqId: string, c: pg.PoolClient): Promise<ComparisonTable> {
    return buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool);
  }

  it("⒜ hàng mảng vẫn có mặt với số tiền `null`, xuống cuối, và phép tổng hợp đúng như khi không có nó — thời lượng ca này là số đo mili-giây", async () => {
    const bang = await withTenant(apiPool, orgA, (c) => bangCua(rfqMang, c));
    expect(bang.rows.map((r) => [r.supplierLegalName, r.totalAmount])).toEqual([
      ["NCC Vo huong", GIA_HOP_LE],
      ["NCC Mang", null],
    ]);
    expect((bang.rows[1]?.payload as { totalAmount?: unknown }).totalAmount, "`payload` đi ra nguyên vẹn, mảng vẫn là mảng").toHaveLength(SO_PHAN_TU);
    expect(bang.aggregates).toEqual({
      parsed: 1,
      unparsed: 1,
      currency: "VND",
      currencyMismatch: false,
      min: GIA_HOP_LE,
      max: GIA_HOP_LE,
      average: GIA_HOP_LE,
      belowBudget: 0,
    });
  });

  it("⒝ `bid_so_tien` KHÔNG nhận văn bản khai triển của mảng, và chạy đúng một lần mỗi hàng mỗi câu cho báo giá đọc được", async () => {
    const { ketQua: bang, doDai } = await voiBidSoTienDuocDem((c) => bangCua(rfqMang, c));
    expect(bang.rows.map((r) => r.totalAmount), "hàm bọc không đổi kết quả").toEqual([GIA_HOP_LE, null]);
    expect(
      doDai.filter((d) => d >= DO_DAI_KHAI_TRIEN),
      `bản trước: ba lần nhận ${DO_DAI_KHAI_TRIEN} ký tự — \`->>\` dựng cả mảng thành văn bản rồi mới hỏi nó có phải số không`,
    ).toEqual([]);
    // Một hàng đọc được, hai câu (hàng và tổng hợp) ⇒ đúng HAI lần, mỗi lần nhận đúng chuỗi giá.
    expect(doDai, "bản trước: bảy lần cho báo giá đọc được, cộng ba lần cho mảng").toEqual([GIA_HOP_LE.length, GIA_HOP_LE.length]);
  });

  it("⒞ ĐỐI CHỨNG: số JSON và chuỗi số giữ nguyên giá trị; đối tượng, boolean, `null` JSON và thiếu khoá ⇒ `null` mà không gọi `bid_so_tien`", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const vSo = await nopBaoGia(rfqId, "NCC So JSON");
    const vChuoi = await nopBaoGia(rfqId, "NCC Chuoi");
    const vDoiTuong = await nopBaoGia(rfqId, "NCC Doi tuong");
    const vBool = await nopBaoGia(rfqId, "NCC Boolean");
    const vNull = await nopBaoGia(rfqId, "NCC Null");
    const vThieu = await nopBaoGia(rfqId, "NCC Thieu");
    await moThau(rfqId, [
      [vSo, '{"totalAmount":1500000.5,"currency":"VND"}'],
      [vChuoi, { totalAmount: "900000.00", currency: "VND" }],
      [vDoiTuong, { totalAmount: { so: "900000.00" }, currency: "VND" }],
      [vBool, { totalAmount: true, currency: "VND" }],
      [vNull, { totalAmount: null, currency: "VND" }],
      [vThieu, { currency: "VND" }],
    ]);
    const { ketQua: bang, doDai } = await voiBidSoTienDuocDem((c) => bangCua(rfqId, c));
    expect(bang.rows.map((r) => [r.supplierLegalName, r.totalAmount])).toEqual([
      ["NCC Chuoi", "900000.00"],
      ["NCC So JSON", "1500000.5"],
      ["NCC Boolean", null],
      ["NCC Doi tuong", null],
      ["NCC Null", null],
      ["NCC Thieu", null],
    ]);
    expect(bang.aggregates.parsed).toBe(2);
    expect(bang.aggregates.unparsed).toBe(4);
    expect(bang.aggregates.min).toBe("900000.00");
    expect(bang.aggregates.max).toBe("1500000.5");
    expect(bang.aggregates.belowBudget, "ngân sách fixture 1.000.000 VND — một báo giá dưới").toBe(1);
    // Hai báo giá vô hướng × hai câu = bốn lần; đối tượng và boolean KHÔNG tới `bid_so_tien` (bản
    // trước: `->>` cho `{"so": "900000.00"}` và `true`, và hàm bị gọi trên cả hai).
    expect([...doDai].sort((a, b) => a - b)).toEqual(["900000.00".length, "900000.00".length, "1500000.5".length, "1500000.5".length]);
  });
});

// ===============================================================================================
// [S1.213 / khoản 133] LẦN TỪ CHỐI "KHÔNG TÌM THẤY RFQ" CỦA HAI ĐƯỜNG ĐỌC CÓ CỔNG VÀO SỔ
//
// Đo trước bản vá (§S1.72, đo lại trên `69e743e` ở §S1.213): `buildComparisonTable` và `countReceivedBids` với một id RFQ không có
// trong tổ chức — UUID ngẫu nhiên, hay id CÓ THẬT của tổ chức khác mà RLS giấu — ném `ComparisonError` mà 0 hàng sổ; qua HTTP là 422
// cùng câu, cũng 0 hàng. Một người giữ `bid.view` dò id RFQ không để lại gì. Chủ dự án chốt (tiểu mục ADR-016 [S1.213]): D5 PHỦ lần
// "không tìm thấy" trên các đường CÓ CỔNG của bề mặt mở thầu và bảng so sánh — cùng khuôn nhánh không tìm thấy của cổng mở thầu
// (khoản 121): `throwAuditedDenial`, lớp lỗi và thông điệp giữ nguyên, `resourceId` là id NGƯỜI GỌI gửi, hàng vào sổ của TỔ CHỨC NGƯỜI GỌI.
// ===============================================================================================
describe("[INV-D5] [S1.213 / khoản 133] hai đường đọc có cổng từ chối vì KHÔNG TÌM THẤY RFQ thì ghi sổ — lớp lỗi và thông điệp giữ nguyên", () => {
  let auditPool: pg.Pool;
  const THONG_DIEP = "Không tìm thấy RFQ trong tổ chức đang gắn.";

  beforeAll(() => {
    auditPool = db.poolAs("app_api");
  });

  afterAll(async () => {
    await auditPool?.end().catch(() => undefined);
  });

  /** Mọi hàng `COMPARISON_NOT_FOUND_DENIED` của một tổ chức cho một id — HÌNH DẠNG trọn, theo thứ tự ghi. */
  async function hangKhongTimThay(orgId: string, rfqId: string): Promise<unknown[][]> {
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string | null; resource_type: string; payload: unknown }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events " +
        " WHERE org_id = $1 AND action = 'COMPARISON_NOT_FOUND_DENIED' AND resource_id = $2 ORDER BY seq",
      [orgId, rfqId],
    );
    return rows.map((r) => [r.actor_type, r.actor_id, r.resource_type, r.payload]);
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ — cùng khuôn `voiGhiSoBiChan` của khối khoản 121. */
  async function voiGhiSoBiChan<T>(action: string, viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k133_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k133 thong diep noi bo' USING ERRCODE = 'TP133'; END$$",
      );
      await db.pool.query(
        `CREATE TRIGGER k133_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = '${action}') ` +
          "EXECUTE FUNCTION public.k133_chan_ghi_so()",
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k133_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k133_chan_ghi_so()");
    }
  }

  it("[INV-D5] UUID ngẫu nhiên ⇒ `ComparisonError` cùng câu ở cả hai hàm, và mỗi hàm đúng một `COMPARISON_NOT_FOUND_DENIED` mang người xem, `RFQ`, id đã gửi và tên đường", async () => {
    const id = randomUUID();
    const loiBang = await loiCua(
      withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: id, actorSessionId: sYc }, auditPool)),
    );
    expect(loiBang).toBeInstanceOf(ComparisonError);
    expect((loiBang as Error).message).toBe(THONG_DIEP);
    expect(await hangKhongTimThay(orgA, id)).toEqual([["USER", uYc, "RFQ", { operation: "BUILD_COMPARISON_TABLE" }]]);

    const loiDem = await loiCua(
      withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: id, actorSessionId: sYc }, auditPool)),
    );
    expect(loiDem).toBeInstanceOf(ComparisonError);
    expect((loiDem as Error).message).toBe(THONG_DIEP);
    expect(await hangKhongTimThay(orgA, id)).toEqual([
      ["USER", uYc, "RFQ", { operation: "BUILD_COMPARISON_TABLE" }],
      ["USER", uYc, "RFQ", { operation: "COUNT_RECEIVED_BIDS" }],
    ]);
  });

  it("[INV-D5] id CÓ THẬT của tổ chức khác — RLS giấu ⇒ cùng lần từ chối; hàng vào sổ của TỔ CHỨC NGƯỜI GỌI, sổ của tổ chức kia 0 hàng", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Goi cua B', $2, false, $3, $4) RETURNING id",
      [orgB, MAI_SAU, uB, sB],
    );
    const rfqB = rows[0]?.id ?? "";
    expect(rfqB).not.toBe("");
    const loiBang = await loiCua(
      withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: rfqB, actorSessionId: sYc }, auditPool)),
    );
    const loiDem = await loiCua(
      withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: rfqB, actorSessionId: sYc }, auditPool)),
    );
    expect([loiBang, loiDem].map((l) => [(l as Error).name, (l as Error).message])).toEqual([
      ["ComparisonError", THONG_DIEP],
      ["ComparisonError", THONG_DIEP],
    ]);
    expect(await hangKhongTimThay(orgA, rfqB)).toEqual([
      ["USER", uYc, "RFQ", { operation: "BUILD_COMPARISON_TABLE" }],
      ["USER", uYc, "RFQ", { operation: "COUNT_RECEIVED_BIDS" }],
    ]);
    expect(await hangKhongTimThay(orgB, rfqB), "lần dò của A không được ghi vào sổ của B").toEqual([]);
  });

  it("[INV-D5] bản ghi `COMPARISON_NOT_FOUND_DENIED` sống qua rollback của người gọi", async () => {
    const id = randomUUID();
    const CHAN = new Error("chan-lai-de-do-rollback");
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await buildComparisonTable(c, orgA, { rfqId: id, actorSessionId: sYc }, auditPool).catch(() => undefined);
        throw CHAN;
      }),
    ).rejects.toBe(CHAN);
    expect((await hangKhongTimThay(orgA, id)).length, "bản ghi từ chối biến mất cùng rollback — nó phải ở một giao dịch ĐỘC LẬP").toBe(1);
  });

  it("[INV-D5] ĐỐI CHỨNG DƯƠNG: id có thật ⇒ cả hai hàm đi qua và 0 hàng `COMPARISON_NOT_FOUND_DENIED`", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    await epTrangThai(rfqId, "UNSEALED");
    await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, auditPool));
    await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId, actorSessionId: sYc }, auditPool));
    expect(await hangKhongTimThay(orgA, rfqId)).toEqual([]);
  });

  it("[INV-D5] lần ghi `COMPARISON_NOT_FOUND_DENIED` ném TP133 ⇒ `DenialAuditFailedError` giữ `ComparisonError` trong `denial`, lỗi của lần ghi trong `cause`; không hàng sổ nào", async () => {
    const id = randomUUID();
    const loi = await voiGhiSoBiChan("COMPARISON_NOT_FOUND_DENIED", () =>
      loiCua(withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId: id, actorSessionId: sYc }, auditPool))),
    );
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const x = loi as DenialAuditFailedError;
    expect(x.denial).toBeInstanceOf(ComparisonError);
    expect(x.denial.message).toBe(THONG_DIEP);
    expect((x.cause as { code?: unknown }).code).toBe("TP133");
    expect(await hangKhongTimThay(orgA, id)).toEqual([]);
  });
});

// ===============================================================================================
// [S1.213 / khoản 108 / ADR-125] HỢP ĐỒNG API CỦA BẢNG SO SÁNH: `totalAmount` (CHUỖI) LÀ SỐ CHUẨN, `payload` LÀ BẢN HIỂN THỊ
//
// `pg` phân tích cột `jsonb` bằng `JSON.parse`, nên một số JSON quá 15 chữ số có nghĩa trong `payload` đi qua `double` ở PHÍA ĐỌC —
// đo ở khoản 108: `'{"a":99999999999999.99}'::jsonb` đọc qua `pg` ra `99999999999999.98`. `totalAmount` của hàng thì tính bằng SQL
// (`bid_so_tien`, 020) và trả về dạng CHUỖI, nên đúng tới từng chữ số. Chủ dự án chốt GIỮ hình dạng JSON và GHI HỢP ĐỒNG (ADR-125);
// khối dưới đây ghim ĐÚNG hành vi ấy — không "sửa" nó — để một vòng sau đổi cách phân tích của `pg` hay đổi `payload` sang văn bản
// thì cổng này đỏ và hợp đồng phải viết lại. Cột `jsonb` trong CSDL vẫn giữ đủ chữ số: phép mất xảy ra ở phía đọc, và ca đo nói rõ chỗ.
// ===============================================================================================
describe("[S1.213 / khoản 108] hợp đồng: `totalAmount` chuỗi đúng tới từng chữ số, `payload` là bản hiển thị và có thể mất chính xác từ 16 chữ số có nghĩa", () => {
  it("số tiền 18 chữ số có nghĩa (16 nguyên + 2 thập phân): `totalAmount` và phép tổng hợp giữ nguyên; `payload` đọc qua `pg` đã làm tròn — cả trường đơn giá lẫn khi chính `totalAmount` trong phong bì là số JSON; CSDL vẫn giữ đủ chữ số", async () => {
    const rfqId = await taoRfqMo(csNghiem);
    const vChuoi = await nopBaoGia(rfqId, "NCC Chuoi");
    const vSo = await nopBaoGia(rfqId, "NCC So");
    // 18 chữ số có nghĩa — đúng miền `numeric(18, 2)` mà `bid_so_tien` (022 mục 8) nhận; `double` chỉ giữ 15–17 chữ số, nên hai con số này
    // KHÔNG sống sót qua `Number(…)`. (Bản đầu của ca này dùng 17 chữ số PHẦN NGUYÊN và đỏ vì `bid_so_tien` trả NULL từ 10^16 — đúng
    // luật của 022, ghi lại ở docstring `buildComparisonTable`.)
    const DON_GIA = "1234567890123456.78";
    const TONG_SO = "2234567890123456.78";
    expect(String(Number(DON_GIA)), "tiền đề: con số này KHÔNG sống sót qua double").not.toBe(DON_GIA);
    expect(String(Number(TONG_SO)), "tiền đề: con số này KHÔNG sống sót qua double").not.toBe(TONG_SO);
    // Văn bản JSON THÔ (xem chú thích của `moThau`): `JSON.stringify` của một giá trị JS đã làm tròn TRƯỚC khi vào CSDL.
    await moThau(rfqId, [
      [vChuoi, `{"totalAmount":"${DON_GIA}","currency":"VND","lines":[{"description":"Thep tam","quantity":1,"unitPrice":${DON_GIA}}]}`],
      [vSo, `{"totalAmount":${TONG_SO},"currency":"VND"}`],
    ]);
    // Tiền đề: CSDL giữ ĐỦ chữ số ở cả hai phong bì — phép mất không nằm ở chỗ lưu.
    const { rows: trongCsdl } = await db.pool.query<{ bid_version_id: string; tong: string; don_gia: string | null }>(
      "SELECT bid_version_id, payload ->> 'totalAmount' AS tong, payload -> 'lines' -> 0 ->> 'unitPrice' AS don_gia " +
        "  FROM rfq_unsealed_bids WHERE bid_version_id = ANY($1::uuid[]) ORDER BY bid_version_id = $2 DESC",
      [[vChuoi, vSo], vChuoi],
    );
    expect(trongCsdl.map((r) => [r.tong, r.don_gia])).toEqual([
      [DON_GIA, DON_GIA],
      [TONG_SO, null],
    ]);

    const bang = await withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    const theoPhienBan = new Map(bang.rows.map((r) => [r.bidVersionId, r]));
    const hChuoi = theoPhienBan.get(vChuoi);
    const hSo = theoPhienBan.get(vSo);
    expect(hChuoi !== undefined && hSo !== undefined, "cả hai hàng có mặt").toBe(true);
    if (hChuoi === undefined || hSo === undefined) return;

    // HỢP ĐỒNG ⑴: `totalAmount` (chuỗi, tính bằng SQL) đúng tới từng chữ số — kể cả khi phong bì viết nó là số JSON.
    expect(hChuoi.totalAmount).toBe(DON_GIA);
    expect(hSo.totalAmount).toBe(TONG_SO);
    expect(bang.aggregates.min).toBe(DON_GIA);
    expect(bang.aggregates.max).toBe(TONG_SO);

    // HỢP ĐỒNG ⑵: `payload` là bản HIỂN THỊ — chuỗi đi nguyên, số JSON quá 15 chữ số có nghĩa đã qua double của `JSON.parse` trong `pg`.
    const pChuoi = hChuoi.payload as { totalAmount: unknown; lines: readonly { unitPrice: unknown }[] };
    expect(pChuoi.totalAmount, "chuỗi thì không đi qua double").toBe(DON_GIA);
    expect(pChuoi.lines[0]?.unitPrice, "đơn giá là số JSON: đã làm tròn về double gần nhất").toBe(Number(DON_GIA));
    expect(String(pChuoi.lines[0]?.unitPrice)).not.toBe(DON_GIA);
    const pSo = hSo.payload as { totalAmount: unknown };
    expect(pSo.totalAmount, "`payload.totalAmount` số JSON: đã làm tròn — người đọc PHẢI lấy `row.totalAmount`").toBe(Number(TONG_SO));
    expect(String(pSo.totalAmount)).not.toBe(hSo.totalAmount);
  });
});

// ===============================================================================================
// [S1.217 / khoản 250 / ADR-128] BẢN RÕ CỦA LỜI MỜI ĐÃ THU HỒI KHÔNG VÀO BẢNG SO SÁNH
//
// Từ S1.217 worker không mở phong bì của lời mời đã thu hồi (đo ở `apps/unseal-worker/src/unseal-worker.int.test.ts`), nên trên
// đường thuận hàng bản rõ ấy KHÔNG tồn tại. Ca này dựng đúng thế giới mà vế lọc của bảng so sánh còn phải đứng một mình: bản rõ
// ĐÃ CÓ (ghi thẳng dưới `app_unseal`, như mọi ca của tệp — hàng của những lượt mở thầu trước S1.217, hay của một chỗ ghi khác),
// rồi lời mời bị thu hồi. Hai câu của `buildComparisonTable` — câu hàng và câu tổng hợp — cùng lọc `i.revoked_at IS NULL`, và
// cổng tĩnh `tests/architecture/phong-bi-loi-moi-con-song.test.ts` đòi ba chỗ đọc mang đúng MỘT vế ấy.
//
// [S1.9135 / khoản 271] Cùng giàn cảnh đo luôn câu ĐẾM: chủ dự án chốt (kế hoạch đợt 3, câu 7) số của `countReceivedBids` là số báo
// giá SẼ DỰ THẦU — luồng của lời mời còn sống —, nên câu đếm mang cùng vế và cổng tĩnh trên đòi cả nó (tiêu chí hình dạng thứ hai:
// câu ấy không có `v.bid_id`). Đối chứng TRƯỚC khi thu hồi: 2; sau: 1.
// ===============================================================================================
describe("[S1.217 / khoản 250] bản rõ của lời mời đã thu hồi không vào bảng so sánh", () => {
  /** Lời mời của một phiên bản báo giá — đọc dưới superuser, không đi qua hàm nào của gói. */
  async function loiMoiCuaPhienBan(versionId: string): Promise<string> {
    const { rows } = await db.pool.query<{ invitation_id: string }>(
      "SELECT b.invitation_id FROM vendor_bid_versions v JOIN vendor_bids b ON b.id = v.bid_id WHERE v.id = $1",
      [versionId],
    );
    return rows[0]?.invitation_id ?? "";
  }

  it("hai bản rõ, thu hồi lời mời của một ⇒ câu hàng và câu tổng hợp cùng bỏ nó: một dòng, `parsed` 1, min = max = giá còn lại, `belowBudget` 0 — bản rõ vẫn nằm trong CSDL; ĐỐI CHỨNG trước khi thu hồi: hai dòng; [S1.9135 / khoản 271] số báo giá sẽ dự thầu 2 → 1", async () => {
    const rfqId = await taoRfqMo(csLong);
    const vThuHoi = await nopBaoGia(rfqId, "NCC bi thu hoi");
    const vConLai = await nopBaoGia(rfqId, "NCC con lai");
    await moThau(rfqId, [
      [vThuHoi, { totalAmount: "900000.00", currency: "VND" }],
      [vConLai, { totalAmount: "1200000.00", currency: "VND" }],
    ]);
    const doc = (): Promise<ComparisonTable> =>
      withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));

    // Đối chứng dương: chưa thu hồi thì cả hai dự thầu — 900 nghìn dưới ngân sách 1 triệu.
    const truoc = await doc();
    expect(truoc.rows.map((r) => r.bidVersionId).sort()).toEqual([vThuHoi, vConLai].sort());
    expect(truoc.aggregates).toMatchObject({ parsed: 2, min: "900000.00", max: "1200000.00", belowBudget: 1 });
    // [S1.9135 / khoản 271] ĐỐI CHỨNG của câu đếm: chưa thu hồi thì cả hai luồng sẽ dự thầu — vế lọc không bớt ai khi không ai bị loại.
    const demTruoc = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(demTruoc, "trước thu hồi: hai luồng, hai báo giá sẽ dự thầu").toEqual({ disclosed: true, count: 2 });

    // Thu hồi bằng SQL dưới superuser, ký tên theo trigger 013 — gói không đi qua `revokeInvitation` (nó chặn sau lần mở, đúng
    // quyết định): thứ đo ở đây là VẾ LỌC, không phải đường thu hồi.
    const loiMoi = await loiMoiCuaPhienBan(vThuHoi);
    await db.pool.query(
      "UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 WHERE id = $1",
      [loiMoi, uYc, sYc],
    );
    const sau = await doc();
    expect(sau.rows.map((r) => [r.bidVersionId, r.totalAmount, r.isLatestForBid])).toEqual([[vConLai, "1200000.00", true]]);
    expect(sau.aggregates).toMatchObject({ parsed: 1, unparsed: 0, min: "1200000.00", max: "1200000.00", average: "1200000.00", belowBudget: 0 });

    // Bản rõ KHÔNG bị xoá: bảng chỉ-ghi-thêm, và lịch sử ấy là một câu hỏi kiểm toán thật. Lọc ở lần ĐỌC, không ở dữ liệu.
    const { rows: banRo } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_unsealed_bids u JOIN vendor_bid_versions v ON v.id = u.bid_version_id " +
        " JOIN vendor_bids b ON b.id = v.bid_id JOIN rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1",
      [rfqId],
    );
    expect(banRo[0]?.n).toBe("2");

    // ~~GIỚI HẠN ĐÃ ĐO, nói ra (khoản 271): `countReceivedBids` đếm `vendor_bids` qua `rfq_invitations` mà KHÔNG lọc thu hồi —
    // ngoài ba câu chọn phong bì của khoản 250. Số báo giá đã nhận vẫn là 2 sau khi thu hồi. Ghim để lần đóng 271 đỏ đúng đây.~~
    // **[S1.9135 / khoản 271]** Ca ghim đã đỏ đúng đây và lật: con số là số báo giá SẼ DỰ THẦU (câu 7 của kế hoạch đợt 3; ADR-128 —
    // thu hồi là loại), nên luồng của lời mời vừa thu hồi thôi được đếm: 1. Đo trước bản vá (câu đếm chưa mang vế): `expected
    // { disclosed: true, count: 2 } to deeply equal { disclosed: true, count: 1 }`. Bản rõ và `vendor_bids` vẫn nguyên (dòng trên):
    // số đổi vì lần ĐỌC lọc, không vì dữ liệu mất.
    const dem = await withTenant(apiPool, orgA, (c) => countReceivedBids(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    expect(dem, "sau thu hồi: luồng của lời mời đã thu hồi không còn được đếm").toEqual({ disclosed: true, count: 1 });
  });
});
