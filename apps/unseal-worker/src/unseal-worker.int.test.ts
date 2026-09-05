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
    expect(ketQua.failed).toBe(0);

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

  it("[INV-G4] mở bọc khoá SINH AUDIT — vế thứ tư của mệnh đề, thứ S1.4 không có", async () => {
    const rfqId = await taoRfqMo();
    await nopBaoGia(rfqId, JSON.stringify({ donGia: 100 }));
    const requestId = await dongVaXinMoThau(rfqId);
    await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, { unsealRequestId: requestId, unwrapper: boMoBocTest }),
    );

    const { rows } = await db.pool.query<{
      actor_type: string;
      payload: { algorithm: string; opened: number };
    }>(
      "SELECT actor_type, payload FROM audit_events " +
        " WHERE resource_id = $1 AND action = 'RFQ_KEY_MATERIAL_UNWRAPPED'",
      [rfqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_type).toBe("SERVICE");
    expect(rows[0]?.payload.algorithm).toBe("ECDH_P256");
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
    expect(ketQua.failed).toBe(1);

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
