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

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { issueRfqKeyPair, sealBid, getRfqPublicKeys } from "@trustprocure/sealed-envelope";
import { buildComparisonTable } from "@trustprocure/unseal";
import { executeUnsealRequest, UnsealWorkerError } from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// ---------------------------------------------------------------------------------------------
// BỘ BỌC / MỞ BỌC ĐỐI XỨNG CỦA RIÊNG TEST — cùng khuôn `sealed-envelope/src/key-material.int.test.ts`.
// Adapter thật là `createLocalDevWrapper`/`createLocalDevUnwrapper` (dev) và KMS (ADR-009); cả
// hai có phép đo riêng ở `packages/crypto-keys`. Ở đây thứ đang được đo là WORKER, không phải
// phép bọc — và dùng đồ giả giữ cho phép đo ấy không phụ thuộc vào một adapter thứ ba.
// ---------------------------------------------------------------------------------------------
const KHOA_TEST = randomBytes(32);

const boBocTest = {
  name: "doi-xung-cua-test",
  wrap: (_orgId: string, plaintext: Uint8Array) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", KHOA_TEST, iv);
    const than = Buffer.concat([c.update(plaintext), c.final()]);
    return Promise.resolve({
      ciphertext: new Uint8Array(Buffer.concat([iv, c.getAuthTag(), than])),
      keyVersion: "test-v1",
    });
  },
};

const boMoBocTest = {
  name: "doi-xung-cua-test",
  unwrap: (_orgId: string, wrapped: { ciphertext: Uint8Array }) => {
    const b = Buffer.from(wrapped.ciphertext);
    const d = createDecipheriv("aes-256-gcm", KHOA_TEST, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Promise.resolve(new Uint8Array(Buffer.concat([d.update(b.subarray(28)), d.final()])));
  },
};

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
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
    await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sYc, wrapper: boBocTest });
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
        }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
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
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
    );
    expect(ketQua.opened).toBe(1);

    const { dinh } = await quetRoRi(MOC_GIA);
    expect(dinh, "bản rõ chỉ được phép tồn tại ở rfq_unsealed_bids").toEqual(["rfq_unsealed_bids"]);
  }, 120000);
});
