// =============================================================================================
// S1.6 — WORKER MỞ THẦU, ĐO TRÊN POSTGRES THẬT DƯỚI ROLE `app_unseal`
//
// File này nằm TRONG `apps/unseal-worker/` vì nó KHÔNG có chỗ nào khác để nằm: quy tắc
// `g1-khong-import-nguoc-tu-apps-unseal-worker` biến cả thư mục này thành ĐÍCH HẠN CHẾ, nên một
// test đặt ở `packages/` sẽ không import được `executeUnsealRequest`. Hàng rào ấy dựng từ S0 cho
// một thư mục chưa tồn tại; đây là lần đầu nó quyết định chỗ ở của một file có thật.
//
// Hệ quả đi kèm, và nó là một khiếm khuyết ĐÃ ĐO chứ không phải một lựa chọn: `vitest.config.ts`
// KHÔNG include `apps/**` cho tới S1.6. Một test đặt ở đây trước hôm nay sẽ typecheck, sẽ được
// depcruise quét, và sẽ KHÔNG BAO GIỜ CHẠY — tức luôn xanh.
// =============================================================================================

import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { DenialAuditFailedError } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { issueRfqKeyPair, sealBid, getRfqPublicKeys } from "@trustprocure/sealed-envelope";
import { buildComparisonTable, requestUnseal } from "@trustprocure/unseal";
import { executeUnsealRequest, UNSEAL_DECRYPT_MFA_MAX_AGE_SECONDS, UnsealWorkerError } from "./index.js";
import { createOrgKeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// ---------------------------------------------------------------------------------------------
// [ADR-062] BỘ SINH / MỞ CẶP KHOÁ TỔ CHỨC CỦA RIÊNG TEST (xor 0xff trên PKCS#8).
// Adapter thật là `createLocalDevOrgKeyProvisioner`/`createLocalDevOrgUnwrapper` (dev) và KMS (ADR-062); cả
// hai có phép đo riêng ở `packages/crypto-keys`. Ở đây thứ đang được đo là WORKER, không phải
// phép bọc — và dùng đồ giả giữ cho phép đo ấy không phụ thuộc vào một adapter thứ ba.
// ---------------------------------------------------------------------------------------------

const boBocTest = {
  // [ADR-062] Bộ sinh cặp khoá tổ chức của test: cặp P-256 thật, khoá riêng "bọc" bằng xor 0xff.
  name: "doi-xung-cua-test",
  generate: (orgId: string) => {
    const k = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return Promise.resolve({
      orgId,
      keyVersion: "test-v1",
      publicKey: k.publicKey.export({ format: "der", type: "spki" }),
      wrappedPrivateKey: new Uint8Array(k.privateKey.export({ format: "der", type: "pkcs8" })).map((b) => b ^ 0xff),
    });
  },
};

// [ADR-062] Mở cặp khoá tổ chức mà bộ sinh của test "bọc" bằng xor 0xff.
const boMoBocTest = createOrgKeyUnwrapper({
  name: "doi-xung-cua-test",
  moKhoaRieng: (k) => Promise.resolve(new Uint8Array(k.wrappedPrivateKey).map((b) => b ^ 0xff)),
});

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
/** [S1.72 / khoản 121] Pool ghi sổ của worker: cùng vai `app_unseal`, kết nối riêng để lần ghi từ chối sống qua rollback của job. */
let auditUnsealPool: pg.Pool;
let orgA: string;
let uYc: string, uD1: string;
let sYc: string, sD1: string;
let csA: string;

async function taoNguoi(email: string, vaiTro: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
    orgA,
    id,
    vaiTro,
  ]);
  return id;
}

async function taoPhien(userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** Một RFQ đã OPEN kèm vật liệu khoá THẬT. */
async function taoRfqMo(): Promise<string> {
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
    [orgA, rfqId, csA, uYc, sYc],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, " +
      "submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  await withTenant(apiPool, orgA, async (c) => {
    await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sYc, orgKeys: boBocTest });
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
        "opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
  });
  return rfqId;
}

/** Nộp một báo giá THẬT (phong bì niêm phong bằng khoá công khai của chính RFQ). */
async function nopBaoGia(rfqId: string, banRo: string, phongBiRac = false): Promise<string> {
  const hex = randomBytes(4).toString("hex");
  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
      "VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, `NCC ${hex}`, uYc, sYc],
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

  const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
  const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
  if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");
  const phongBi = phongBiRac
    ? // Một phong bì HỢP LỆ VỀ HÌNH DẠNG nhưng không mở được: niêm phong cho MỘT RFQ KHÁC. Đây
      // đúng là ca mà `unsealBid` từ chối, và nó là ca kiểm tra tính sẵn sàng của lượt mở thầu.
      await sealBid({
        rfqId: "99999999-9999-4999-8999-999999999999",
        algorithm: "ECDH_P256",
        recipientPublicKey: p256.publicKey,
        plaintext: new TextEncoder().encode(banRo),
      })
    : await sealBid({
        rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: p256.publicKey,
        plaintext: new TextEncoder().encode(banRo),
      });

  return await withTenant(apiPool, orgA, async (c) => {
    const { rows: b } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, invitationId],
    );
    const bidId = b[0]?.id ?? "";
    const { rows: v } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, bidId, Buffer.from(phongBi), guestSessionId],
    );
    const versionId = v[0]?.id ?? "";
    // Biên nhận: trigger hoãn của 018 đòi nó tồn tại. Nội dung không được kiểm chữ ký ở tầng CSDL
    // (đó là việc của `verifyReceipt`), nên một biên nhận hình dạng đúng là đủ cho fixture này.
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

/** Đóng RFQ rồi tạo + phê duyệt một yêu cầu mở thầu. Trả về id yêu cầu. */
async function dongVaXinMoThau(rfqId: string): Promise<string> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
      "early_close_reason = 'dong som de kiem tra', closed_by = $2, closed_by_session_id = $3 " +
      "WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  const { rows } = await withTenant(apiPool, orgA, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, " +
        "requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
      [orgA, rfqId, uYc, sYc],
    ),
  );
  const requestId = rows[0]?.id ?? "";
  await withTenant(apiPool, orgA, async (c) => {
    await c.query(
      "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, " +
        "approver_session_id) VALUES ($1, $2, $3, $4)",
      [orgA, requestId, uD1, sD1],
    );
    await c.query(
      "UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1",
      [requestId],
    );
    // [022] Mốc ĐIỀU PHỐI. Worker kiểm lại vế 2 của D1 trên chính phiên này, nên một fixture
    // không ghi nó sẽ bị từ chối — đúng như mong muốn: một job không biết ai đã điều phối mình
    // là một job không kiểm lại được uỷ quyền.
    await c.query(
      "UPDATE unseal_requests SET dispatched_at = now(), dispatched_by = $2, " +
        "dispatched_by_session_id = $3 WHERE id = $1",
      [requestId, uYc, sYc],
    );
  });
  return requestId;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
  auditUnsealPool = db.poolAs("app_unseal");

  uYc = await taoNguoi("yc@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi("d1@vidu.vn", "DIRECTOR");
  sYc = await taoPhien(uYc);
  sD1 = await taoPhien(uD1);
  const cs = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [orgA, uYc, sYc],
  );
  csA = cs.rows[0]?.id ?? "";
  expect([orgA, uYc, uD1, sYc, sD1, csA].filter((x) => x === "")).toEqual([]);
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await auditUnsealPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("worker mở thầu — chuỗi trọn vẹn", () => {
  it("[INV-A1] TRƯỚC khi mở thầu, KHÔNG có một hàng bản rõ nào tồn tại", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 1234567, tienTe: "VND" }));
    await dongVaXinMoThau(rfqId);

    // A1 ở đây KHÔNG được giữ bởi một cổng đọc mà bởi SỰ VẮNG MẶT CỦA DỮ LIỆU: bảng rỗng, nên
    // một câu `SELECT *` viết bởi người chưa đọc tài liệu nào cũng không trả về giá.
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_unsealed_bids"),
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[INV-A1] SAU khi mở thầu, bản rõ khớp ĐÚNG thứ nhà cung cấp đã niêm phong", async () => {
    const rfqId = await taoRfqMo();
    const versionId = await nopBaoGia(rfqId, JSON.stringify({ donGia: 1234567, tienTe: "VND" }));
    const requestId = await dongVaXinMoThau(rfqId);

    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(1);
    expect(ketQua.failedBidVersionIds).toEqual([]);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ payload: { donGia: number; tienTe: string }; bid_version_id: string }>(
        "SELECT payload, bid_version_id FROM rfq_unsealed_bids WHERE unseal_request_id = $1",
        [requestId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bid_version_id).toBe(versionId);
    expect(rows[0]?.payload).toEqual({ donGia: 1234567, tienTe: "VND" });

    const { rows: tt } = await db.pool.query<{ rfq: string; yc: string }>(
      "SELECT p.status AS rfq, r.status AS yc FROM rfq_packages p " +
        " JOIN unseal_requests r ON r.rfq_id = p.id WHERE r.id = $1",
      [requestId],
    );
    expect(tt[0]?.rfq).toBe("UNSEALED");
    expect(tt[0]?.yc).toBe("EXECUTED");
  });

  // ===========================================================================================
  // [khoản nợ 10] ĐƯỜNG GỠ U+0000 CỦA `thanhJson` CÓ PHÉP ĐO — trước khi byte NUL THÔ trong regex của nó thành một escape.
  // [S1.6 H1] `jsonb` không biểu diễn được U+0000 (22P05), nên MỘT byte trong bản rõ của MỘT nhà cung cấp làm cả lượt mở thầu
  // rollback. Bản vá của S1.6 gỡ NUL trước `JSON.parse` nhưng không kèm test nào đi qua đường ấy; tới S1.63 regex còn mang một
  // byte NUL thô, nên phép dò xuống dòng của Git coi tệp là nhị phân và ripgrep quét theo thư mục bỏ qua nó.
  // ===========================================================================================
  it("[khoản nợ 10] một U+0000 THÔ trong chuỗi của bản rõ JSON — [S1.64, lượt soi 57] văn bản ấy KHÔNG phải JSON hợp lệ: cất dưới raw đã gỡ U+0000, lượt mở thầu không hỏng", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, '{"donGia":1234567,"ghiChu":"a\u0000b"}');
    const requestId = await dongVaXinMoThau(rfqId);

    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(1);
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ payload: unknown }>("SELECT payload FROM rfq_unsealed_bids WHERE unseal_request_id = $1", [requestId]),
    );
    // [S1.64, lượt soi 57 NẶNG-1] Kỳ vọng LẬT có chủ đích — ~~`[{ donGia: 1234567, ghiChu: "ab" }]`~~. Gỡ U+0000 TRƯỚC khi phân tích
    // biến một văn bản KHÔNG hợp lệ thành JSON hợp lệ: ở ca này vô hại, nhưng `{"a␀":1,"a":2}` thành `{"a":2}` và `1␀5` thành `15`.
    expect(rows.map((r) => r.payload)).toEqual([{ raw: '{"donGia":1234567,"ghiChu":"ab"}' }]);
  });

  it("[khoản nợ 10] một U+0000 THÔ trong bản rõ KHÔNG phải JSON bị gỡ — cất dưới raw, và CHỈ U+0000 bị gỡ (xuống dòng còn nguyên)", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, "rac\u0000\nrac");
    const requestId = await dongVaXinMoThau(rfqId);

    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(1);
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ payload: unknown }>("SELECT payload FROM rfq_unsealed_bids WHERE unseal_request_id = $1", [requestId]),
    );
    expect(rows.map((r) => r.payload)).toEqual([{ raw: "rac\nrac" }]);
  });

  // ===========================================================================================
  // [khoản nợ 106] MỘT BẢN RÕ JSON HỢP LỆ MÀ `jsonb` HAY `JSON.stringify` KHÔNG NHẬN KHÔNG ĐƯỢC CHẶN CẢ LƯỢT MỞ THẦU.
  // Bản vá [S1.6 H1] gỡ U+0000 THÔ trước `JSON.parse`, nhưng bốn loại đầu vào đi qua bước gỡ ấy (đo ở S1.63): escape của U+0000
  // trong một chuỗi hay một khoá và escape surrogate đơn lẻ (`jsonb` từ chối), mảng lồng quá sâu (`JSON.stringify` ném). Mỗi ca
  // làm CẢ giao dịch rollback ở mọi lần thử, và báo giá sạch cùng RFQ cũng không mở được.
  // Mỗi `it` dưới đây dựng một RFQ có một báo giá sạch rồi mở thầu MỘT lần. Nó đòi lượt mở thầu chạy trọn, báo giá sạch giữ nguyên
  // hình dạng, và mỗi bản rõ `jsonb` không nhận được cất dưới `raw` NGUYÊN VĂN. Không `it` nào ghim mã lỗi. Escape được dựng bằng
  // `String.fromCharCode(92)`, nên khối này không mang một dấu gạch chéo ngược nào.
  // ===========================================================================================
  const BS = String.fromCharCode(92);
  const BAN_RO_SACH = JSON.stringify({ donGia: 111, tienTe: "VND" });

  /** Mảng lồng `n` tầng dưới khoá `a`. Tính cả đối tượng gốc, độ sâu là `n + 1`. */
  function longSau(n: number): string {
    return '{"a":' + "[".repeat(n) + "]".repeat(n) + "}";
  }

  /** [lượt soi 57] Đối tượng lồng `n` tầng dưới khoá `a`, trong cùng là số 1. Độ sâu là `n`. */
  function doiTuongLongSau(n: number): string {
    return '{"a":'.repeat(n) + "1" + "}".repeat(n);
  }

  /**
   * Một RFQ gồm một báo giá sạch và các bản rõ `cacBanRo`, mở thầu MỘT lần. Đòi lượt mở thầu chạy trọn — không phong bì nào
   * hỏng, báo giá sạch giữ nguyên hình dạng, yêu cầu `EXECUTED`, RFQ `UNSEALED` — rồi trả id của RFQ, id phiên bản của từng bản rõ
   * theo đúng thứ tự `cacBanRo`, và payload theo id. [khoản nợ 107] Payload ở đây đã qua `JSON.parse` của `pg`, tức mọi số trong nó
   * đã qua `double`: đừng dùng nó để so giá trị của một số.
   */
  async function moThauCungBaoGiaSachTheoId(
    cacBanRo: readonly string[],
  ): Promise<{ rfqId: string; cacId: string[]; theoId: Map<string, unknown> }> {
    const rfqId = await taoRfqMo();
    const idSach = await nopBaoGia(rfqId, BAN_RO_SACH);
    const cacId: string[] = [];
    for (const banRo of cacBanRo) cacId.push(await nopBaoGia(rfqId, banRo));
    const requestId = await dongVaXinMoThau(rfqId);

    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(cacBanRo.length + 1);
    expect(ketQua.failedBidVersionIds).toEqual([]);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ bid_version_id: string; payload: unknown }>(
        "SELECT bid_version_id, payload FROM rfq_unsealed_bids WHERE unseal_request_id = $1",
        [requestId],
      ),
    );
    const theoId = new Map(rows.map((r) => [r.bid_version_id, r.payload] as const));
    expect(theoId.get(idSach), "báo giá sạch phải giữ nguyên hình dạng").toEqual({ donGia: 111, tienTe: "VND" });
    const { rows: tt } = await db.pool.query<{ rfq: string; yc: string }>(
      "SELECT p.status AS rfq, r.status AS yc FROM rfq_packages p JOIN unseal_requests r ON r.rfq_id = p.id WHERE r.id = $1",
      [requestId],
    );
    expect(tt).toEqual([{ rfq: "UNSEALED", yc: "EXECUTED" }]);
    return { rfqId, cacId, theoId };
  }

  /** Như `moThauCungBaoGiaSachTheoId`, nhưng chỉ trả payload theo đúng thứ tự `cacBanRo`. */
  async function moThauCungBaoGiaSach(cacBanRo: readonly string[]): Promise<unknown[]> {
    const { cacId, theoId } = await moThauCungBaoGiaSachTheoId(cacBanRo);
    return cacId.map((id) => theoId.get(id));
  }

  it("[khoản nợ 106] ⑴ escape của U+0000 trong một CHUỖI — lượt mở thầu chạy trọn, bản rõ ấy cất dưới raw nguyên văn", async () => {
    const banRo = '{"donGia":222,"ghiChu":"a' + BS + 'u0000b"}';
    expect(await moThauCungBaoGiaSach([banRo])).toEqual([{ raw: banRo }]);
  });

  it("[khoản nợ 106] ⑵ escape của U+0000 trong một KHOÁ — cất dưới raw, không gộp với khoá cùng tên sau khi gỡ", async () => {
    const banRo = '{"donGia":333,"a' + BS + 'u0000":1,"a":2}';
    expect(await moThauCungBaoGiaSach([banRo])).toEqual([{ raw: banRo }]);
  });

  it("[khoản nợ 106] ⑶ escape surrogate đơn lẻ — cao, thấp, ngược thứ tự, trong khoá — mỗi bản rõ cất dưới raw", async () => {
    const cacBanRo = [
      '{"ghiChu":"a' + BS + 'ud800b"}',
      '{"ghiChu":"' + BS + 'udc00"}',
      '{"ghiChu":"' + BS + "udc00" + BS + 'ud800"}',
      '{"a' + BS + 'udbff":1}',
    ];
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacBanRo.map((raw) => ({ raw })));
  });

  it("[khoản nợ 106] ⑷ mảng lồng 5 000 và 20 000 tầng — cất dưới raw, lượt mở thầu không ném", async () => {
    const cacBanRo = [longSau(5000), longSau(20000)];
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacBanRo.map((raw) => ({ raw })));
  });

  it("[khoản nợ 106] phép soi đi HẾT cây — U+0000 và surrogate đơn lẻ nằm sâu trong mảng, đối tượng và khoá lồng nhau cũng cất dưới raw", async () => {
    const cacBanRo = [
      '{"hang":[{"dong":1,"ghiChu":"x' + BS + 'u0000"}]}',
      '{"hang":[1,[2,["' + BS + 'ud800"]]]}',
      '{"hang":{"con":{"' + BS + 'u0000":true}}}',
    ];
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacBanRo.map((raw) => ({ raw })));
  });

  it("[khoản nợ 106] ngưỡng độ sâu — 64 tầng giữ nguyên hình dạng, 65 tầng cất dưới raw", async () => {
    const sau64 = longSau(63);
    const sau65 = longSau(64);
    const doc64: unknown = JSON.parse(sau64);
    expect(await moThauCungBaoGiaSach([sau64, sau65])).toEqual([doc64, { raw: sau65 }]);
  });

  it("[khoản nợ 106] ĐỐI CHỨNG — cặp surrogate hợp lệ, escape ký tự điều khiển khác U+0000, gạch chéo ngược THẬT đứng trước u0000 — giữ nguyên hình dạng", async () => {
    const cacBanRo = [
      '{"ghiChu":"' + BS + "ud83d" + BS + 'ude00","' + BS + "ud83d" + BS + 'ude00":1}',
      '{"ghiChu":"a' + BS + "u0001b" + BS + 'u001fc","' + BS + 'u0007":1}',
      '{"ghiChu":"a' + BS + BS + 'u0000b","k' + BS + BS + 'u0000":2}',
    ];
    const cacDoc = cacBanRo.map((b): unknown => JSON.parse(b));
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacDoc);
  });

  it("[khoản nợ 106] [lượt soi 57] U+0000 THÔ không còn biến một văn bản KHÔNG hợp lệ thành JSON mang nội dung khác — khoá gộp, số đổi, trộn với escape: cất dưới raw đã gỡ U+0000", async () => {
    const NUL = String.fromCharCode(0);
    const cacBanRo = [
      '{"a' + NUL + '":1,"a":2}',
      '{"totalAmount":1' + NUL + '5,"currency":"VND"}',
      '{"ghiChu":"x' + NUL + '","khac":"' + BS + 'u0000"}',
    ];
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacBanRo.map((b) => ({ raw: b.split(NUL).join("") })));
  });

  it("[khoản nợ 106] [lượt soi 57] ngưỡng độ sâu tính cả ĐỐI TƯỢNG lồng — 64 tầng giữ nguyên hình dạng, 65 và 5 000 tầng cất dưới raw", async () => {
    const sau64 = doiTuongLongSau(64);
    const sau65 = doiTuongLongSau(65);
    const sau5000 = doiTuongLongSau(5000);
    const doc64: unknown = JSON.parse(sau64);
    expect(await moThauCungBaoGiaSach([sau64, sau65, sau5000])).toEqual([doc64, { raw: sau65 }, { raw: sau5000 }]);
  });

  // ===========================================================================================
  // [khoản nợ 107] SỐ JSON TRONG BẢN RÕ GIỮ NGUYÊN GIÁ TRỊ ĐÃ NIÊM PHONG.
  // Tới S1.64, `thanhJson` cất đối tượng mà `JSON.parse` dựng ra, nên mọi số đi qua `double` trước khi vào `jsonb`:
  // `99999999999999.99` thành `…98`, và `bid_so_tien` nhận con số đã đổi (đo ở S1.64). Các `it` dưới đây so `payload` với CHÍNH
  // bản rõ khi PostgreSQL tự phân tích nó — `jsonb =` so số theo `numeric` — và đọc số tiền bằng đúng biểu thức của bảng so sánh.
  // Không `it` nào so giá trị một số qua payload mà `pg` trả về: `pg` phân tích cột `jsonb` bằng `JSON.parse`. Như khối trên,
  // khối này không mang một dấu gạch chéo ngược nào.
  // ===========================================================================================

  /**
   * [khoản nợ 107] Với từng phiên bản trong `cacId`: `payload` có BẰNG bản rõ cùng vị trí trong `cacBanRo` không, khi PostgreSQL tự
   * phân tích bản rõ ấy thành `jsonb`. Chỉ gọi cho bản rõ mà `jsonb` nhận.
   */
  async function payloadBangBanRo(cacId: readonly string[], cacBanRo: readonly string[]): Promise<boolean[]> {
    expect(cacId).toHaveLength(cacBanRo.length);
    const ketQua: boolean[] = [];
    for (const [i, id] of cacId.entries()) {
      const { rows } = await withTenant(apiPool, orgA, (c) =>
        c.query<{ khop: boolean }>("SELECT payload = $2::jsonb AS khop FROM rfq_unsealed_bids WHERE bid_version_id = $1", [
          id,
          cacBanRo[i],
        ]),
      );
      expect(rows).toHaveLength(1);
      ketQua.push(rows[0]?.khop === true);
    }
    return ketQua;
  }

  it("[khoản nợ 107] số tiền kiểu SỐ JSON giữ nguyên giá trị đã niêm phong — biểu thức của bảng so sánh đọc đúng con số", async () => {
    const cacBanRo = [
      '{"totalAmount":99999999999999.99,"currency":"VND"}',
      '{"totalAmount":9007199254740993,"currency":"VND"}',
      '{"totalAmount":1234567.10,"currency":"VND"}',
    ];
    const { cacId } = await moThauCungBaoGiaSachTheoId(cacBanRo);
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ bid_version_id: string; so_tien: string | null }>(
        "SELECT bid_version_id, bid_so_tien(payload ->> 'totalAmount')::text AS so_tien FROM rfq_unsealed_bids " +
          " WHERE bid_version_id = ANY($1::uuid[])",
        [cacId],
      ),
    );
    const soTienTheoId = new Map(rows.map((r) => [r.bid_version_id, r.so_tien] as const));
    expect(cacId.map((id) => soTienTheoId.get(id))).toEqual(["99999999999999.99", "9007199254740993", "1234567.10"]);
    expect(await payloadBangBanRo(cacId, cacBanRo)).toEqual([true, true, true]);
  });

  it("[khoản nợ 107] MỌI số trong cây giữ nguyên giá trị — hơn 15 chữ số có nghĩa, số nguyên vượt 2^53, số mũ, tràn và hụt của double, trong mảng và đối tượng lồng", async () => {
    const cacBanRo = [
      '{"hang":[{"soLuong":12345678901234567890,"donGia":123456789012.345678}],"tyLe":[1e-7,1E+21,-0,0.1]}',
      '{"a":{"b":{"c":[0.30000000000000001,-9007199254740993]}}}',
      '{"tran":1.7976931348623159e308,"hut":1e-324}',
    ];
    const { cacId } = await moThauCungBaoGiaSachTheoId(cacBanRo);
    expect(await payloadBangBanRo(cacId, cacBanRo)).toEqual([true, true, true]);
  });

  it("[khoản nợ 107] biên văn bản của MỘT số — 1 000 ký tự và số mũ ±324 giữ nguyên giá trị; 1 001 ký tự hay số mũ ±325 thì cả bản rõ cất dưới raw", async () => {
    const trongBien = [
      '{"a":' + "9".repeat(1000) + "}",
      '{"a":-' + "9".repeat(999) + "}",
      '{"a":1e324}',
      '{"a":-1E-324}',
      '{"a":0.5e+0000324}',
    ];
    const ngoaiBien = [
      '{"a":' + "9".repeat(1001) + "}",
      '{"a":-' + "9".repeat(1000) + "}",
      '{"a":1e325}',
      '{"a":1E-325}',
      '{"a":0.5e+0000325}',
    ];
    const { cacId, theoId } = await moThauCungBaoGiaSachTheoId([...trongBien, ...ngoaiBien]);
    expect(await payloadBangBanRo(cacId.slice(0, trongBien.length), trongBien)).toEqual(trongBien.map(() => true));
    expect(cacId.slice(trongBien.length).map((id) => theoId.get(id))).toEqual(ngoaiBien.map((raw) => ({ raw })));
  });

  it("[khoản nợ 107] số mà `numeric` của PostgreSQL không chứa nổi — 131 073 chữ số, số mũ 131 072, 16 384 chữ số thập phân — cất dưới raw, lượt mở thầu không hỏng", async () => {
    const cacBanRo = [
      '{"a":' + "1".repeat(131073) + "}",
      '{"a":1e131072}',
      '{"a":0.' + "1".repeat(16384) + "}",
      // Vượt biên số VÀ mang escape U+0000: phép đi cây lẫn phép quét văn bản cùng từ chối, và bản rõ vẫn phải vào raw.
      '{"a":1e131072,"ghiChu":"' + BS + 'u0000"}',
      // [lượt soi 58 NHẸ-1] Số vượt `numeric` là PHẦN TỬ MẢNG, không đứng ngay sau dấu hai chấm.
      '{"totalAmount":1,"hang":[2,1e131072]}',
    ];
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacBanRo.map((raw) => ({ raw })));
  });

  it("[khoản nợ 107] KHOÁ TRÙNG — ở gốc, lồng trong mảng, trùng sau khi giải escape, ghi đè một escape `jsonb` không nhận hay một cây quá sâu — cả bản rõ cất dưới raw, lượt mở thầu không hỏng", async () => {
    const cacBanRo = [
      '{"totalAmount":"1000.00","currency":"VND","totalAmount":"2000.00"}',
      '{"hang":[{"dong":1,"ghiChu":"x","dong":2}]}',
      '{"a":1,"' + BS + 'u0061":2}',
      '{"ghiChu":"' + BS + 'ud800","ghiChu":"ok"}',
      '{"ghiChu":"' + BS + 'u0000","ghiChu":"ok"}',
      '{"a":' + "[".repeat(20000) + "]".repeat(20000) + ',"a":1}',
      // Khoá `b` đứng sau một dấu nháy ĐÃ THOÁT: một phép quét đọc sai escape nuốt mất nó, bù đúng một khoá trùng, rồi gửi văn bản gốc.
      '{"a":"' + BS + 'ud800","a":"x' + BS + '"y","b":1}',
      // [lượt soi 58 NHẸ-2] Khoá trùng với CR hay LF đứng giữa khoá và dấu hai chấm: một phép quét không coi CR, LF là khoảng trắng bỏ
      // sót đúng khoá trùng ấy, rồi gửi văn bản gốc mang escape `jsonb` từ chối.
      '{"ghiChu":"' + BS + 'ud800","ghiChu"' + String.fromCharCode(13) + ':"ok"}',
      '{"ghiChu":"' + BS + 'ud800","ghiChu"' + String.fromCharCode(10) + ':"ok"}',
    ];
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacBanRo.map((raw) => ({ raw })));
  });

  it("[khoản nợ 107] ĐỐI CHỨNG của phép quét văn bản — khoảng trắng quanh dấu hai chấm (dấu cách, tab, CR, LF), dấu nháy và gạch chéo ngược đã thoát, số và ngoặc nằm trong chuỗi, true/false/null, ký tự không-phải-ký-tự — giữ nguyên hình dạng", async () => {
    const TAB = String.fromCharCode(9);
    const CRLF = String.fromCharCode(13, 10);
    const cacBanRo = [
      '{"a" :  1 ,' + CRLF + ' "b"' + TAB + ":" + CRLF + "[ 2 ] }",
      '{"ghiChu":"x' + BS + '":1","k":[1,"]:{"]}',
      '{"ghiChu":"a' + BS + '"b","k":1}',
      '{"ghiChu":"a' + BS + BS + '","b":2}',
      '{"dung":true,"sai":false,"rong":null,"am":-12.5,"ma":"1e999","khoa1e999":0,"so":"' + "9".repeat(2000) + '"}',
      // [lượt soi 58 NHẸ-2] CR riêng, LF riêng, rồi CRLF cùng tab và dấu cách, giữa khoá và dấu hai chấm.
      '{"a"' + String.fromCharCode(13) + ':1,"b"' + String.fromCharCode(10) + ':2,"c"' + CRLF + TAB + " :3}",
      // [lượt soi 58 NHẸ-4] Ký tự không-phải-ký-tự U+FFFE, U+FFFF, U+FDD0: dạng escape trong một chuỗi và trong một khoá, và dạng thô.
      '{"a":"' + BS + "uFFFE" + BS + 'uFFFF","' + BS + 'uFDD0":1,"tho":"' + String.fromCharCode(0xfffe, 0xffff, 0xfdd0) + '"}',
    ];
    const cacDoc = cacBanRo.map((b): unknown => JSON.parse(b));
    expect(await moThauCungBaoGiaSach(cacBanRo)).toEqual(cacDoc);
  });

  it("[khoản nợ 107] bảng so sánh đọc ĐÚNG con số đã niêm phong — số tiền, min, max và trung bình của báo giá gửi số tiền kiểu SỐ", async () => {
    const { rfqId } = await moThauCungBaoGiaSachTheoId([
      '{"totalAmount":99999999999999.99,"currency":"VND"}',
      '{"totalAmount":9007199254740993,"currency":"VND"}',
    ]);
    const bang = await withTenant(apiPool, orgA, (c) =>
      buildComparisonTable(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(bang.rows.map((r) => r.totalAmount)).toEqual(["99999999999999.99", "9007199254740993", null]);
    expect(bang.aggregates).toMatchObject({
      parsed: 2,
      unparsed: 1,
      currency: "VND",
      currencyMismatch: false,
      min: "99999999999999.99",
      max: "9007199254740993",
      average: "4553599627370496.50",
    });
  });

  it("[INV-G4] mở bọc khoá SINH AUDIT — vế thứ tư của mệnh đề, thứ S1.4 không có", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 100 }));
    const requestId = await dongVaXinMoThau(rfqId);
    await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );

    const { rows } = await db.pool.query<{
      actor_type: string;
      payload: { algorithms: string[]; opened: number };
    }>(
      "SELECT actor_type, payload FROM audit_events " +
        " WHERE resource_id = $1 AND action = 'RFQ_KEY_MATERIAL_UNWRAPPED'",
      [rfqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_type).toBe("SERVICE");
    expect(rows[0]?.payload.algorithms).toEqual(["ECDH_P256"]);
    expect(rows[0]?.payload.opened).toBe(1);

    // ... và KHÔNG một mảnh khoá hay bản rõ nào trong payload.
    const { rows: quet } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE payload::text LIKE '%donGia%'",
    );
    expect(quet[0]?.n).toBe("0");
  });

  it("[INV-G1] app_api KHÔNG ghi được bản rõ — nó không giải mã được nên nó không có gì để ghi", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 100 }));
    const requestId = await dongVaXinMoThau(rfqId);
    const { rows: v } = await db.pool.query<{ id: string }>(
      "SELECT v.id FROM vendor_bid_versions v JOIN vendor_bids b ON b.id = v.bid_id " +
        " JOIN rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1",
      [rfqId],
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) " +
            "VALUES ($1, $2, $3, '{\"donGia\": 1}'::jsonb)",
          [orgA, requestId, v[0]?.id ?? ""],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("[INV-A1] worker TỪ CHỐI một yêu cầu chưa được phê duyệt", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 100 }));
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
        "early_close_reason = 'dong som', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, " +
          "requested_by_session_id) VALUES ($1, $2, 'chua duyet', $3, $4) RETURNING id",
        [orgA, rfqId, uYc, sYc],
      ),
    );
    await expect(
      withTenant(unsealPool, orgA, (c) =>
        executeUnsealRequest(c, orgA, {
          unsealRequestId: rows[0]?.id ?? "",
          unwrapper: boMoBocTest,
        }, auditUnsealPool),
      ),
    ).rejects.toBeInstanceOf(UnsealWorkerError);
  });

  it("[INV-A1] ĐỘT BIẾN: gỡ trigger thì `app_unseal` ghi được bản rõ dưới một yêu cầu CHƯA duyệt", async () => {
    const rfqId = await taoRfqMo();
    const versionId = await nopBaoGia(rfqId, JSON.stringify({ donGia: 100 }));
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
        "early_close_reason = 'dong som', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, " +
          "requested_by_session_id) VALUES ($1, $2, 'chua duyet', $3, $4) RETURNING id",
        [orgA, rfqId, uYc, sYc],
      ),
    );
    const requestId = rows[0]?.id ?? "";

    // Lớp ứng dụng đã từ chối ở test trên. Đây là lớp CSDL, và nó là lớp có thẩm quyền.
    await expect(
      withTenant(unsealPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) " +
            "VALUES ($1, $2, $3, '{}'::jsonb)",
          [orgA, requestId, versionId],
        ),
      ),
    ).rejects.toThrow(/Chi ghi duoc ban ro duoi mot yeu cau da phe duyet/);

    await db.pool.query("DROP TRIGGER rfq_unsealed_bids_kiem_yeu_cau ON rfq_unsealed_bids");
    try {
      const { rowCount } = await withTenant(unsealPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) " +
            "VALUES ($1, $2, $3, '{}'::jsonb)",
          [orgA, requestId, versionId],
        ),
      );
      expect(rowCount, "không có trigger thì bản rõ ra đời mà không ai duyệt").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_unsealed_bids_kiem_yeu_cau BEFORE INSERT ON rfq_unsealed_bids " +
          " FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_yeu_cau_khi_ghi_ban_ro()",
      );
    }
  });

  it("một phong bì KHÔNG mở được không chặn việc mở của những người còn lại", async () => {
    // Tính SẴN SÀNG, và nó là một quyết định sản phẩm: một nhà cung cấp gửi thứ không mở được —
    // cố ý hay do lỗi trình duyệt — KHÔNG được phép giữ cả cuộc thầu làm con tin.
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 111 }));
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 222 }), true);
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 333 }));
    const requestId = await dongVaXinMoThau(rfqId);

    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(2);
    expect(ketQua.failedBidVersionIds.length).toBe(1);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ payload: { donGia: number } }>(
        "SELECT payload FROM rfq_unsealed_bids WHERE unseal_request_id = $1 ORDER BY 1",
        [requestId],
      ),
    );
    expect(rows.map((r) => r.payload.donGia).sort((a, b) => a - b)).toEqual([111, 333]);
  });

  it("chỉ mở PHIÊN BẢN CUỐI của mỗi luồng báo giá", async () => {
    const rfqId = await taoRfqMo();
    const dau = await nopBaoGia(rfqId, JSON.stringify({ donGia: 111 }));

    // Nộp lần hai trên CÙNG luồng — số phiên bản do trigger đặt, nên nó là 2.
    const { rows: b } = await db.pool.query<{ bid_id: string; gs: string }>(
      "SELECT bid_id, submitted_by_guest_session_id AS gs FROM vendor_bid_versions WHERE id = $1",
      [dau],
    );
    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
    const phongBi2 = await sealBid({
      rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: p256?.publicKey ?? new Uint8Array(0),
      plaintext: new TextEncoder().encode(JSON.stringify({ donGia: 999 })),
    });
    await withTenant(apiPool, orgA, async (c) => {
      const { rows: v } = await c.query<{ id: string }>(
        "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, " +
          "submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [orgA, b[0]?.bid_id ?? "", Buffer.from(phongBi2), b[0]?.gs ?? ""],
      );
      await c.query(
        "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) " +
          "VALUES ($1, $2, $3, $4)",
        [
          orgA,
          v[0]?.id ?? "",
          "trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\n" +
            `rfq_id=${rfqId}\nbid_id=${b[0]?.bid_id ?? ""}\nversion=2\n` +
            `ciphertext_sha256=${"b".repeat(64)}\nsubmitted_at=2026-09-05T00:00:01.000000Z\n`,
          Buffer.alloc(70, 8),
        ],
      );
    });

    const requestId = await dongVaXinMoThau(rfqId);
    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(1);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ payload: { donGia: number } }>(
        "SELECT payload FROM rfq_unsealed_bids WHERE unseal_request_id = $1",
        [requestId],
      ),
    );
    expect(rows[0]?.payload.donGia, "phải là bản CUỐI, không phải bản đầu").toBe(999);
  });
});

// ===============================================================================================
// [INV-A4] BỘ QUÉT RÒ RỈ TỰ ĐỘNG — PHIÊN BẢN CHẠY ĐƯỢC KHI CHƯA CÓ TẦNG HTTP
//
// §6 của đặc tả mô tả bộ quét này là một vòng lặp trên MỌI endpoint của OpenAPI. Không có
// endpoint nào để lặp, và `apps/` chỉ có worker này. Nhưng ý chịu lực của nó thì KHÔNG phụ thuộc
// vào HTTP: *gieo một giá trị dễ nhận, rồi tìm nó ở mọi chỗ nó có thể tới, thay vì kiểm từng chỗ
// mình NHỚ RA*. Ở tầng dữ liệu, "mọi chỗ" là mọi bảng của schema — và danh sách bảng được đọc từ
// `pg_class` chứ không viết tay, nên một bảng thêm vào ở S2 tự rơi vào phạm vi.
//
// QUÉT DƯỚI SUPERUSER, không dưới `app_api`. Hai lý do: nó là tập CHA của mọi thứ một role ứng
// dụng đọc được, và nó là đúng vế *"kể cả bằng role quản trị"* của A3 — cùng phép quét trả lời
// được cả hai mệnh đề.
//
// VÌ SAO MỐC LÀ MỘT CHUỖI CHỨ KHÔNG PHẢI MỘT CON SỐ, và đây là một khiếm khuyết ĐÃ TÍNH RA của
// khuôn "gieo 1234567891" mà đặc tả gợi ý: `bytea` hiện ra dưới `::text` dưới dạng hex, và chữ
// số thập phân LÀ chữ số hex. Một phong bì ~150 byte cho ~300 ký tự hex, nên xác suất một chuỗi
// 10 chữ số bất kỳ xuất hiện tình cờ trong đó là ~290 × (10/16)^10 ≈ 2.6 — tức gần như CHẮC CHẮN
// có ít nhất một lần khớp giả. Một bộ quét như thế sẽ đỏ ngẫu nhiên và bị tắt đi trong một tuần.
// Mốc ở đây có chữ HOA và dấu gạch dưới, hai thứ không bao giờ có trong hex viết thường.
// ===============================================================================================
const MOC_GIA = "GIA_BI_MAT_9182736450";
const TEN_BANG_HOP_LE = /^[a-z_][a-z0-9_]*$/;

/** Trả về tên các bảng có chứa `chuoi` ở BẤT KỲ cột nào của BẤT KỲ hàng nào. */
async function quetRoRi(chuoi: string): Promise<{ dinh: string[]; soBangDaQuet: number }> {
  const { rows: bang } = await db.pool.query<{ ten: string }>(
    `SELECT c.relname AS ten
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
  );
  const dinh: string[] = [];
  for (const b of bang) {
    if (!TEN_BANG_HOP_LE.test(b.ten)) throw new Error(`ten bang la: ${b.ten}`);
    const { rows } = await db.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${b.ten} t WHERE t::text LIKE '%' || $1 || '%'`,
      [chuoi],
    );
    if (rows[0]?.n !== "0") dinh.push(b.ten);
  }
  return { dinh, soBangDaQuet: bang.length };
}

describe("[INV-A4] bộ quét rò rỉ — giá gieo vào phong bì không tới được bảng nào khác", () => {
  it("[INV-A4] TRƯỚC mở thầu: mốc giá không có mặt ở MỘT bảng nào của schema", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 9182736450, ghiChu: MOC_GIA }));
    await dongVaXinMoThau(rfqId);

    const { dinh, soBangDaQuet } = await quetRoRi(MOC_GIA);
    // Chống rỗng ruột: "0 lần khớp" phải khác "đã quét 0 bảng". Ngưỡng là một con số SÀN, không
    // phải một con số ghim — thêm bảng ở S2 không được làm test này đỏ.
    expect(soBangDaQuet, "bộ quét phải nhìn thấy toàn bộ schema").toBeGreaterThan(20);
    expect(dinh, "mốc giá lọt ra ngoài phong bì trước khi mở thầu").toEqual([]);

    // ĐỐI CHỨNG DƯƠNG: cùng bộ quét, một chuỗi CÓ THẬT trong dữ liệu, và nó tìm ra.
    const { dinh: coThat } = await quetRoRi("Mua thep tam");
    expect(coThat, "bộ quét không biết tìm ra thứ đang có mặt").toContain("rfq_packages");

    // Và `app_api` không đọc được thứ CHỨA mốc ấy — phong bì là cột duy nhất mang nó.
    await expect(
      withTenant(apiPool, orgA, (c) => c.query("SELECT envelope FROM vendor_bid_versions")),
    ).rejects.toThrow(/permission denied/i);
  }, 120000);

  it("[INV-A4] SAU mở thầu: mốc giá có mặt ở ĐÚNG MỘT bảng — và đó là bảng 019 đã chỉ định", async () => {
    // Vế này là đối chứng dương của vế trên ở mức mạnh nhất: nó chứng minh mốc giá THẬT SỰ đã đi
    // vào hệ thống, nên "không tìm thấy ở đâu" phía trên không phải vì gieo hụt.
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 9182736450, ghiChu: MOC_GIA }));
    const requestId = await dongVaXinMoThau(rfqId);
    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool),
    );
    expect(ketQua.opened).toBe(1);

    const { dinh } = await quetRoRi(MOC_GIA);
    expect(dinh, "bản rõ chỉ được phép tồn tại ở rfq_unsealed_bids").toEqual(["rfq_unsealed_bids"]);
  }, 120000);
});

// ===============================================================================================
// [S1.72 / khoản 121] WORKER TỪ CHỐI LÚC GIẢI MÃ THÌ GHI SỔ — DƯỚI VAI CỦA NÓ, Ở GIAO DỊCH ĐỘC LẬP
//
// Đo trên master 298cd4e, trước bản vá (§S1.72), gọi thẳng `executeUnsealRequest` dưới `app_unseal`: yêu cầu không tìm thấy, chưa APPROVED,
// thiếu phiên điều phối ⇒ `UnsealWorkerError`; phiên điều phối có MFA quá cửa sổ hay bị thu hồi ⇒ `MfaRequiredError` — cả năm nhánh 0 hàng
// sổ. Đây là lần kiểm lại D1 ở hành động DUY NHẤT không thu hồi được, và lần nó từ chối là thứ người kiểm toán cần thấy nhất.
// ===============================================================================================
describe("[INV-D5] [S1.72 / khoản 121] worker từ chối lúc giải mã thì ghi `UNSEAL_EXECUTION_DENIED` dưới vai `app_unseal`", () => {
  /** Tham số thứ tư là pool ghi sổ của worker. */
  const chayWorker = (c: pg.PoolClient, unsealRequestId: string): Promise<unknown> =>
    executeUnsealRequest(c, orgA, { unsealRequestId, unwrapper: boMoBocTest }, auditUnsealPool);

  async function hangTuChoi(requestId: string): Promise<{ actor_type: string; actor_id: string | null; clause: unknown }[]> {
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string | null; resource_type: string; payload: Record<string, unknown> }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events " +
        " WHERE org_id = $1 AND action = 'UNSEAL_EXECUTION_DENIED' AND resource_id = $2 ORDER BY seq",
      [orgA, requestId],
    );
    // [S1.72 / lượt soi 67a-8] Loại tài nguyên và HÌNH DẠNG trọn của payload ở mọi hàng — lời hứa "payload chỉ mang vế" có mốc chết.
    for (const r of rows) {
      expect(r.resource_type).toBe("UNSEAL_REQUEST");
      expect(Object.keys(r.payload)).toEqual(["clause"]);
    }
    return rows.map((r) => ({ actor_type: r.actor_type, actor_id: r.actor_id, clause: r.payload.clause }));
  }

  /** RFQ đã CLOSED kèm một yêu cầu mở thầu PENDING — chưa ai duyệt, chưa điều phối. */
  async function yeuCauChuaDuyet(): Promise<string> {
    const rfqId = await taoRfqMo();
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
        "early_close_reason = 'dong som', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) " +
          "VALUES ($1, $2, 'k121 tu choi luc giai ma', $3, $4) RETURNING id",
        [orgA, rfqId, uYc, sYc],
      ),
    );
    return rows[0]?.id ?? "";
  }

  async function duyet(requestId: string): Promise<void> {
    await withTenant(apiPool, orgA, async (c) => {
      await c.query(
        "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)",
        [orgA, requestId, uD1, sD1],
      );
      await c.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [requestId]);
    });
  }

  async function dieuPhoiBang(requestId: string, sessionId: string): Promise<void> {
    await withTenant(apiPool, orgA, (c) =>
      c.query(
        "UPDATE unseal_requests SET dispatched_at = now(), dispatched_by = $2, dispatched_by_session_id = $3 WHERE id = $1",
        [requestId, uYc, sessionId],
      ),
    );
  }

  async function phienMoi(mfaTuoiGiay: number): Promise<string> {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
        "VALUES ($1, $2, $3, now() + interval '1 day', now() - make_interval(secs => $4)) RETURNING id",
      [orgA, uYc, randomBytes(32), mfaTuoiGiay],
    );
    return rows[0]?.id ?? "";
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  it("[INV-D5] worker: yêu cầu KHÔNG tìm thấy trong tổ chức ⇒ `UnsealWorkerError` như cũ và đúng một hàng (SERVICE, vế POLICY_GATE) — sống qua rollback của giao dịch job", async () => {
    const id = randomUUID();
    const loi = await loiCua(withTenant(unsealPool, orgA, (c) => chayWorker(c, id)));
    expect(loi).toBeInstanceOf(UnsealWorkerError);
    expect(await hangTuChoi(id)).toEqual([{ actor_type: "SERVICE", actor_id: null, clause: "POLICY_GATE" }]);
  });

  it("[INV-D5] worker: yêu cầu chưa APPROVED ⇒ `UnsealWorkerError` như cũ và đúng một hàng, vế POLICY_GATE", async () => {
    const id = await yeuCauChuaDuyet();
    const loi = await loiCua(withTenant(unsealPool, orgA, (c) => chayWorker(c, id)));
    expect(loi).toBeInstanceOf(UnsealWorkerError);
    expect(await hangTuChoi(id)).toEqual([{ actor_type: "SERVICE", actor_id: null, clause: "POLICY_GATE" }]);
  });

  it("[INV-D5] worker: yêu cầu APPROVED mà không mang phiên điều phối ⇒ `UnsealWorkerError` như cũ và đúng một hàng, vế MFA_FRESH", async () => {
    const id = await yeuCauChuaDuyet();
    await duyet(id);
    const loi = await loiCua(withTenant(unsealPool, orgA, (c) => chayWorker(c, id)));
    expect(loi).toBeInstanceOf(UnsealWorkerError);
    expect(await hangTuChoi(id)).toEqual([{ actor_type: "SERVICE", actor_id: null, clause: "MFA_FRESH" }]);
  });

  it("[INV-D5] worker: phiên điều phối có MFA quá cửa sổ giải mã ⇒ `UnsealWorkerError` vế MFA_FRESH giữ `MfaRequiredError` ở `cause`, và đúng một hàng", async () => {
    const id = await yeuCauChuaDuyet();
    await duyet(id);
    await dieuPhoiBang(id, await phienMoi(UNSEAL_DECRYPT_MFA_MAX_AGE_SECONDS + 600));
    const loi = await loiCua(withTenant(unsealPool, orgA, (c) => chayWorker(c, id)));
    expect(loi).toBeInstanceOf(UnsealWorkerError);
    expect((loi as { clause?: unknown }).clause).toBe("MFA_FRESH");
    expect(((loi as Error).cause as Error | undefined)?.name).toBe("MfaRequiredError");
    expect(await hangTuChoi(id)).toEqual([{ actor_type: "SERVICE", actor_id: null, clause: "MFA_FRESH" }]);
  });

  it("[INV-D5] worker: phiên điều phối bị THU HỒI sau điều phối ⇒ `UnsealWorkerError` vế MFA_FRESH và đúng một hàng", async () => {
    // Trigger của unseal_requests không nhận một phiên ĐÃ thu hồi làm phiên điều phối (đo ở bản nháp của §S1.72): điều phối bằng phiên còn
    // hiệu lực, rồi thu hồi phiên ấy — đúng thứ tự của ca thật.
    const id = await yeuCauChuaDuyet();
    await duyet(id);
    const phien = await phienMoi(0);
    await dieuPhoiBang(id, phien);
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [phien]);
    const loi = await loiCua(withTenant(unsealPool, orgA, (c) => chayWorker(c, id)));
    expect(loi).toBeInstanceOf(UnsealWorkerError);
    expect((loi as { clause?: unknown }).clause).toBe("MFA_FRESH");
    expect(await hangTuChoi(id)).toEqual([{ actor_type: "SERVICE", actor_id: null, clause: "MFA_FRESH" }]);
  });

  it("[INV-D5] [S1.72 / lượt soi 67a-8] worker: lỗi KHÔNG phải `MfaRequiredError` từ phép kiểm MFA đi nguyên — không thành lần từ chối, không vào sổ", async () => {
    // `assertFreshMfa` kiểm tham số trước câu SQL: `maxMfaAgeSeconds` 0 ⇒ `Error` thường, ném TRONG khối try của worker — đúng chỗ phép phân
    // loại đứng. Nới phép phân loại thành mọi `Error` thì lỗi vận hành (42501, 57014) thành hàng MFA_FRESH sai nguyên nhân.
    const id = await yeuCauChuaDuyet();
    await duyet(id);
    await dieuPhoiBang(id, await phienMoi(0));
    const loi = await loiCua(
      withTenant(unsealPool, orgA, (c) =>
        executeUnsealRequest(c, orgA, { unsealRequestId: id, unwrapper: boMoBocTest, maxMfaAgeSeconds: 0 }, auditUnsealPool),
      ),
    );
    expect(loi).toBeInstanceOf(Error);
    expect(loi).not.toBeInstanceOf(UnsealWorkerError);
    expect((loi as Error).message).toContain("maxAgeSeconds");
    expect(await hangTuChoi(id)).toEqual([]);
  });

  it("[INV-D5] [S1.72 / lượt soi 67c-6] worker: lỗi MANG SQLSTATE từ câu SQL của phép kiểm MFA đi nguyên — không thành lần từ chối, không vào sổ", async () => {
    // Lỗi của test trên không mang `code`: nới phép phân loại thành "`MfaRequiredError` hay lỗi mang `code`" thì nó vẫn xanh. `maxMfaAgeSeconds`
    // 1e12 qua được phép kiểm tham số; mốc `clock_timestamp() - 1e12 giây` ra ngoài miền timestamp — lỗi của PostgreSQL ném TRONG khối try.
    const id = await yeuCauChuaDuyet();
    await duyet(id);
    await dieuPhoiBang(id, await phienMoi(0));
    const loi = await loiCua(
      withTenant(unsealPool, orgA, (c) =>
        executeUnsealRequest(c, orgA, { unsealRequestId: id, unwrapper: boMoBocTest, maxMfaAgeSeconds: 1e12 }, auditUnsealPool),
      ),
    );
    expect(loi).not.toBeInstanceOf(UnsealWorkerError);
    expect((loi as { code?: unknown } | null)?.code, String((loi as Error | null)?.message)).toBe("22008");
    expect(await hangTuChoi(id)).toEqual([]);
  });

  it("[INV-D5] worker: ĐỐI CHỨNG DƯƠNG — một lượt mở thầu hợp lệ KHÔNG ghi `UNSEAL_EXECUTION_DENIED` nào", async () => {
    // Không có vế này, năm khẳng định trên xanh kể cả khi worker ghi bản ghi từ chối ở MỌI lượt gọi.
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 100 }));
    const requestId = await dongVaXinMoThau(rfqId);
    const ketQua = (await withTenant(unsealPool, orgA, (c) => chayWorker(c, requestId))) as { opened: number };
    expect(ketQua.opened).toBe(1);
    expect(await hangTuChoi(requestId)).toEqual([]);
  });

  it("[INV-D5] worker: lần ghi `UNSEAL_EXECUTION_DENIED` ném TP121 ⇒ `DenialAuditFailedError` giữ lần từ chối vế POLICY_GATE, lỗi của lần ghi trong `cause`; không hàng sổ nào", async () => {
    const id = randomUUID();
    let loi: unknown;
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k121_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k121 thong diep noi bo' USING ERRCODE = 'TP121'; END$$",
      );
      await db.pool.query(
        "CREATE TRIGGER k121_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW " +
          "WHEN (NEW.action = 'UNSEAL_EXECUTION_DENIED') EXECUTE FUNCTION public.k121_chan_ghi_so()",
      );
      loi = await loiCua(withTenant(unsealPool, orgA, (c) => chayWorker(c, id)));
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k121_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k121_chan_ghi_so()");
    }
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const x = loi as DenialAuditFailedError;
    expect(x.denial).toBeInstanceOf(UnsealWorkerError);
    expect((x.denial as { clause?: unknown }).clause).toBe("POLICY_GATE");
    expect((x.cause as { code?: unknown }).code).toBe("TP121");
    expect(await hangTuChoi(id)).toEqual([]);
  });
});

// =============================================================================================
// [S1.73 / khoản 126] WORKER MỞ THẦU CHỜ KHOÁ HÀNG CỦA RFQ SAU LẦN GHI SỔ ĐẦU — ĐO TRÊN POSTGRES THẬT
//
// `executeUnsealRequest` ghi sổ `RFQ_KEY_MATERIAL_UNWRAPPED` — lần ghi sổ ĐẦU của giao dịch, tức lúc lấy khoá tư vấn ghi sổ của tổ chức
// (`noi_chuoi_kiem_toan()`, 004) và giữ tới COMMIT — RỒI mới phát `UPDATE public.unseal_requests` (kt1) và `UPDATE public.rfq_packages
// SET status = 'UNSEALED'` (kt2). kt2 chờ khoá hàng RFQ. Từ S1.71, mọi lần ghi sổ KHÁC của cùng tổ chức chờ khoá tư vấn ấy tối đa 2 s rồi
// gãy 55P03 (050) — nên mỗi mili-giây worker chờ khoá hàng SAU lần ghi sổ đầu là một mili-giây cả tổ chức không ghi sổ được.
//
// NGƯỜI GIỮ dựng từ ĐƯỜNG SẢN XUẤT dưới vai `app_api`, không superuser, không cần IM7 (khoản 128). Chỉ một hình dạng dựng được: một giao
// dịch LẤY ĐƯỢC khoá hàng rồi CHỜ TIẾP. Giao dịch HỎNG không dựng được — PostgreSQL thả khoá ngay lúc abort, trước cả khi tiến trình gửi
// ROLLBACK (đo ở test thứ hai dưới đây).
//
// Hình dạng dựng được: `requestUnseal` của người thứ hai rơi vào cửa sổ GIỮA kt1 và kt2. Trigger 019 `unseal_requests_kiem_rfq_da_dong`
// lấy `FOR SHARE` trên hàng RFQ (RFQ đã CLOSED nên phép kiểm qua), rồi câu INSERT vướng chỉ mục riêng phần `unseal_requests_mot_yeu_cau
// _dang_mo`: hàng cũ vừa được kt1 đổi sang EXECUTED nhưng CHƯA commit, nên PostgreSQL bắt nó CHỜ giao dịch worker — trong lúc nó đang giữ
// `FOR SHARE`. Worker chờ khoá hàng ấy ở kt2. Vòng khép kín.
//
// [tự bắt ⑴] Bản đo đầu đặt các phép thăm dò BÊN TRONG hàm gọi của `withTenant`, nên chính chúng giữ giao dịch worker mở quá lâu và con
// số đọc ra là của phép đo chứ không của đường sản xuất. Bản này chạy worker như một lời hứa và thăm dò SONG SONG bên ngoài.
//
// Không nhãn INV: đây là vách ngăn khả dụng bên trong một tổ chức, cùng loại với `db/tran-cho-khoa-ghi-so.int.test.ts`.
// =============================================================================================

const GHI_SO_K126 =
  "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, $2, 'K126', NULL, '{}'::jsonb, NULL, NULL, NULL)";

/** Số khoá tư vấn ghi sổ của `orgA` mà backend `pid` ĐANG GIỮ — đọc từ một kết nối khác. */
async function demKhoaGhiSo(pid: number): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted AND pid = $2 " +
      "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [orgA, pid],
  );
  return rows[0]?.n ?? -1;
}

/** Chờ tới khi backend `pid` bị một backend khác CHẶN. Trả số ms đã chờ, -1 nếu quá hạn hay `dungSom()` báo dừng. */
async function choToiKhiBiChan(layPid: () => number, hanMs: number, dungSom?: () => boolean): Promise<number> {
  const batDau = Date.now();
  for (;;) {
    const pid = layPid();
    if (pid > 0) {
      const { rows } = await db.pool.query<{ n: number }>(
        "SELECT cardinality(pg_catalog.pg_blocking_pids($1))::int AS n",
        [pid],
      );
      if ((rows[0]?.n ?? 0) > 0) return Date.now() - batDau;
    }
    if (dungSom?.() === true || Date.now() - batDau > hanMs) return -1;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Một lần ghi sổ của `orgA` trên một kết nối `app_api` riêng: mã lỗi PostgreSQL (null nếu xong) và số ms. */
async function ghiSoDongThoiCuaToChuc(): Promise<{ ma: string | null; ms: number }> {
  const c = await apiPool.connect();
  const batDau = Date.now();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
    const loi = await c.query(GHI_SO_K126, [orgA, "K126_DONG_THOI"]).then(
      () => null,
      (e: unknown) => e as { code?: string },
    );
    return { ma: loi === null ? null : (loi.code ?? "?"), ms: Date.now() - batDau };
  } finally {
    // ROLLBACK trong finally: một lần ném ở giữa mà trả kết nối đang mở giao dịch về pool làm mọi test sau đỏ lan
    // (`KetNoiNhiemError`, evidence lượt đầu của vòng — tự bắt ⑷).
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

/**
 * Bọc client của worker để chạy `truoc` NGAY TRƯỚC câu SQL đầu tiên chứa `moc`, rồi mới phát câu ấy. Chỉ `query` bị bọc — `executeUnseal
 * Request` không dùng gì khác của client. Cách này dựng đúng CỬA SỔ mà một yêu cầu mở thầu thứ hai rơi vào, thay vì quay xổ số thời điểm.
 */
function bocChanTruocCau(c: pg.PoolClient, moc: string, truoc: () => Promise<void>): pg.PoolClient {
  let daChay = false;
  const boc = {
    query: async (...thamSo: unknown[]): Promise<unknown> => {
      const dau = thamSo[0];
      const sql = typeof dau === "string" ? dau : ((dau as { text?: string } | null)?.text ?? "");
      if (!daChay && sql.includes(moc)) {
        daChay = true;
        await truoc();
      }
      return (c.query as (...x: unknown[]) => Promise<unknown>).apply(c, thamSo);
    },
  };
  return boc as unknown as pg.PoolClient;
}

interface KetQuaDoK126 {
  readonly msWorkerBiChan: number;
  readonly khoaKhiCho: number;
  readonly dongThoi: { ma: string | null; ms: number };
  readonly ketCucNguoiGiu: string[];
  readonly opened: number;
  readonly loiWorker: string;
  readonly msTong: number;
}

/**
 * Chạy một lượt mở thầu thật, thả `soNguoiGiu` yêu cầu mở thầu thứ hai vào cửa sổ giữa kt1 và kt2 (cách nhau `cachNhauMs`), rồi đo từ
 * BÊN NGOÀI giao dịch: worker có bị chặn không, lúc ấy nó giữ mấy khoá ghi sổ, và một lần ghi sổ khác của cùng tổ chức đi tới đâu.
 */
async function doCuaSoKt1Kt2(soNguoiGiu: number, cachNhauMs: number): Promise<KetQuaDoK126> {
  const rfqId = await taoRfqMo();
  await nopBaoGia(rfqId, JSON.stringify({ donGia: 1234567, tienTe: "VND" }));
  const requestId = await dongVaXinMoThau(rfqId);

  let pidWorker = -1;
  let pidGiuDau = -1;
  let daXong = false;
  const ketCuc: string[] = [];
  const viecGiu: Promise<void>[] = [];

  const motNguoiGiu = async (dau: boolean): Promise<void> => {
    const kq = await withTenant(apiPool, orgA, async (c) => {
      if (dau) pidGiuDau = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      return requestUnseal(c, orgA, { rfqId, reason: "nguoi thu hai xin mo thau", actorSessionId: sYc }, apiPool);
    }).then(
      () => null,
      (e: unknown) => e as { code?: string; message?: string },
    );
    ketCuc.push(kq === null ? "xong" : (kq.code ?? (kq.message ?? "?").slice(0, 24)));
  };

  const truocKt2 = async (): Promise<void> => {
    viecGiu.push(motNguoiGiu(true));
    await choToiKhiBiChan(() => pidGiuDau, 5_000);
    for (let i = 1; i < soNguoiGiu; i++) {
      viecGiu.push(new Promise<void>((r) => setTimeout(r, i * cachNhauMs)).then(motNguoiGiu.bind(null, false)));
    }
  };

  const batDau = Date.now();
  const chayWorker = withTenant(unsealPool, orgA, async (c) => {
    pidWorker = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
    const boc = bocChanTruocCau(c, "UPDATE public.rfq_packages", truocKt2);
    return executeUnsealRequest(boc, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }, auditUnsealPool);
  }).then(
    (x) => {
      daXong = true;
      return { opened: x.opened, loi: "" };
    },
    (e: unknown) => {
      daXong = true;
      return { opened: -1, loi: (e as { code?: string }).code ?? (e as Error).message };
    },
  );

  const msWorkerBiChan = await choToiKhiBiChan(() => pidWorker, 8_000, () => daXong);
  const khoaKhiCho = await demKhoaGhiSo(pidWorker);
  const dongThoi = await ghiSoDongThoiCuaToChuc();
  const kq = await chayWorker;
  await Promise.all(viecGiu);
  return {
    msWorkerBiChan,
    khoaKhiCho,
    dongThoi,
    ketCucNguoiGiu: ketCuc,
    opened: kq.opened,
    loiWorker: kq.loi,
    msTong: Date.now() - batDau,
  };
}

function ke(d: KetQuaDoK126): string {
  return (
    `worker bị chặn sau ${d.msWorkerBiChan} ms và giữ ${d.khoaKhiCho} khoá ghi sổ lúc ấy; ` +
    `lần ghi sổ đồng thời của tổ chức: ${d.dongThoi.ma ?? "xong"} sau ${d.dongThoi.ms} ms; ` +
    `người giữ: [${d.ketCucNguoiGiu.join(",")}]; worker mở ${d.opened} phong bì, lỗi "${d.loiWorker}"; cả lượt ${d.msTong} ms`
  );
}

describe("[S1.73 / khoản 126] worker mở thầu chờ khoá hàng RFQ sau lần ghi sổ đầu", () => {
  it("đối chứng dương của phép dò: giao dịch vừa ghi sổ thì phép dò thấy ĐÚNG một khoá tư vấn ghi sổ của tổ chức", async () => {
    const c = await apiPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      const pid = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      expect(await demKhoaGhiSo(pid), "trước lần ghi sổ").toBe(0);
      await c.query(GHI_SO_K126, [orgA, "K126_DOI_CHUNG"]);
      expect(await demKhoaGhiSo(pid), "sau lần ghi sổ, giao dịch giữ khoá tới COMMIT").toBe(1);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("giao dịch HỎNG không dựng được người giữ: lần nộp báo giá tới RFQ đã CLOSED lấy `FOR SHARE` rồi ném, và khoá được thả NGAY lúc abort — trước cả ROLLBACK", async () => {
    const rfqId = await taoRfqMo();
    const versionId = await nopBaoGia(rfqId, JSON.stringify({ donGia: 1 }));
    await dongVaXinMoThau(rfqId);
    const { rows: v } = await db.pool.query<{ bid_id: string; envelope: Buffer; sid: string }>(
      "SELECT bid_id, envelope, submitted_by_guest_session_id AS sid FROM vendor_bid_versions WHERE id = $1",
      [versionId],
    );
    const h = v[0]!;
    const c = await apiPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      const pidGiu = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      const loi = await c
        .query(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4)",
          [orgA, h.bid_id, h.envelope, h.sid],
        )
        .then(
          () => null,
          (e: unknown) => e as { code?: string },
        );
      expect(loi?.code, "RFQ đã CLOSED nên trigger 018 phải từ chối").toBe("23514");
      // Lời hứa của driver xong khi ErrorResponse tới, còn việc thả khoá của `AbortTransaction` xong TRƯỚC `ReadyForQuery`:
      // đọc `pg_locks` ngay có thể thấy khoá chưa kịp thả. Dưới tải song song của evidence, lượt đầu của vòng đỏ đúng chỗ này
      // (tự bắt ⑷). Chờ backend về trạng thái nghỉ rồi mới đọc.
      for (let i = 0; i < 300; i += 1) {
        const { rows: tt } = await db.pool.query<{ state: string | null }>(
          "SELECT state FROM pg_catalog.pg_stat_activity WHERE pid = $1",
          [pidGiu],
        );
        if ((tt[0]?.state ?? "") === "idle in transaction (aborted)") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const { rows: khoa } = await db.pool.query<{ mode: string }>(
        "SELECT mode FROM pg_catalog.pg_locks WHERE pid = $1 AND relation = 'public.rfq_packages'::regclass",
        [pidGiu],
      );
      expect(
        khoa.map((r) => r.mode),
        "giao dịch đang ở trạng thái hỏng KHÔNG còn giữ khoá nào trên rfq_packages",
      ).toEqual([]);
      const t = await apiPool.connect();
      try {
        await t.query("BEGIN");
        await t.query("SET LOCAL lock_timeout = '1500ms'");
        await t.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
        const e = await t
          .query("SELECT 1 FROM rfq_packages WHERE id = $1 AND org_id = $2 FOR NO KEY UPDATE", [rfqId, orgA])
          .then(
            () => null,
            (x: unknown) => x as { code?: string },
          );
        expect(e, "kết nối khác khoá được hàng RFQ ngay, tức người giữ đã thả").toBeNull();
      } finally {
        await t.query("ROLLBACK").catch(() => undefined);
        t.release();
      }
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  }, 60_000);

  it("MỘT yêu cầu mở thầu thứ hai trong cửa sổ kt1–kt2: worker không được chờ khoá hàng trong lúc giữ khoá ghi sổ, và lần ghi sổ đồng thời của tổ chức phải xong", async () => {
    const d = await doCuaSoKt1Kt2(1, 0);
    expect(d.khoaKhiCho, ke(d)).toBe(0);
    expect(d.dongThoi.ma, ke(d)).toBeNull();
    expect(d.opened, ke(d)).toBe(1);
  }, 90_000);

  it("BỐN yêu cầu mở thầu cách nhau 500 ms trong cùng cửa sổ: lần ghi sổ đồng thời của tổ chức vẫn phải xong", async () => {
    const d = await doCuaSoKt1Kt2(4, 500);
    expect(d.khoaKhiCho, ke(d)).toBe(0);
    expect(d.dongThoi.ma, ke(d)).toBeNull();
    expect(d.opened, ke(d)).toBe(1);
  }, 120_000);
});
