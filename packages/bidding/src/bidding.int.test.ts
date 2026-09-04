// =============================================================================================
// S1.5 — NỘP BÁO GIÁ, ĐO TRÊN POSTGRES THẬT DƯỚI HAI ROLE
//
// Mọi phép đo chạy qua `db.poolAs("app_api")` hoặc `db.poolAs("app_unseal")`. Superuser bỏ qua
// RLS và bỏ qua GRANT (đã đo ở 002), nên một test về QUYỀN CỘT chạy dưới superuser xanh vì lý do
// sai — và quyền cột là chỗ A2/A3 sống trong file này.
//
// FILE NÀY DỰNG RFQ VÀ LỜI MỜI BẰNG SQL VIẾT TAY, không gọi `@trustprocure/rfq` hay
// `@trustprocure/invitation`. Lý do là dây phụ thuộc: `packages/rfq` đã phụ thuộc
// `packages/sealed-envelope`, và một cạnh `bidding -> rfq` chỉ để dựng fixture sẽ ghim một quan hệ
// mà mã sản phẩm không cần. Hệ quả tốt kèm theo: các phép đo dưới đây chạm THẲNG tầng CSDL.
// =============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { getRfqPublicKeys, issueRfqKeyPair, sealBid } from "@trustprocure/sealed-envelope";
import {
  ReceiptSigningKeyRing,
  createLocalDevReceiptSigner,
  getBidReceipt,
  listBidVersions,
  parseReceiptText,
  sha256Hex,
  submitBid,
  verifyReceipt,
  type ReceiptKeyPair,
  type ReceiptSigner,
} from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const GIA_THAT = "Don gia: 1.234.567 VND cho 100 tam thep";

/** Bộ bọc khoá của riêng test — xem cùng khối ở `sealed-envelope/src/key-material.int.test.ts`. */
const boBocTest = {
  name: "doi-xung-cua-test",
  wrap: (_orgId: string, plaintext: Uint8Array) =>
    Promise.resolve({ ciphertext: plaintext.map((b) => b ^ 0xff), keyVersion: "test-v1" }),
};

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;
let uA: string;
let sA: string;
let csA: string;
let boKy: ReceiptSigner;
let khoaKy: ReceiptKeyPair;

async function taoPhien(orgId: string, userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** RFQ đã OPEN + một lời mời + một phiên khách hợp lệ — điểm xuất phát của mọi phép đo. */
async function dungBoiCanh(deadline: Date = MAI_SAU): Promise<{
  rfqId: string;
  invitationId: string;
  guestSessionId: string;
}> {
  const { rows: r } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) " +
      "RETURNING id",
    [orgA, deadline, uA, sA],
  );
  const rfqId = r[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam SS400', '100.0000', " +
      "'tam', $3, $4)",
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
  await withTenant(apiPool, orgA, async (c) => {
    await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sA, wrapper: boBocTest });
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
        "opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uA, sA],
    );
  });

  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
      "VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, `NCC ${randomBytes(4).toString("hex")}`, uA, sA],
  );
  const supplierId = ncc[0]?.id ?? "";
  const { rows: lh } = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) " +
      "RETURNING id",
    [orgA, supplierId, `${randomBytes(4).toString("hex")}@vidu.vn`, uA, sA],
  );
  const contactId = lh[0]?.id ?? "";
  const { rows: lm } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, " +
      "invited_by, invited_by_session_id) VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [orgA, rfqId, supplierId, contactId, uA, sA],
  );
  const invitationId = lm[0]?.id ?? "";
  // Phiên khách KHÔNG dựng thẳng được: trigger `guest_sessions_kiem_danh_tinh` (012, phát hiện
  // C2) đòi nó trỏ tới một thách thức OTP ĐÃ ĐỐI CHIẾU, và đòi `verified_contact_id` cùng
  // `verified_channel` khớp thách thức ấy. Đó chính là bất biến E5 — danh tính đã xác thực là
  // DẪN XUẤT, không phải lời khai — nên fixture ở đây phải đi qua đúng chuỗi mà sản phẩm đi.
  const { rows: tk } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, " +
      "issued_by, issued_by_session_id) VALUES ($1, $2, $3, 'BID_SUBMISSION', " +
      "now() + interval '1 day', $4, $5) RETURNING id",
    [orgA, invitationId, randomBytes(32), uA, sA],
  );
  const { rows: tt } = await db.pool.query<{ id: string }>(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, " +
      "channel, code_hash, destination_hash, pepper_version, expires_at, consumed_at) " +
      "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) " +
      "RETURNING id",
    [orgA, invitationId, tk[0]?.id ?? "", contactId, randomBytes(32), randomBytes(32)],
  );
  const { rows: pk } = await db.pool.query<{ id: string }>(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, " +
      "verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [orgA, invitationId, tt[0]?.id ?? "", randomBytes(32), contactId],
  );
  return { rfqId, invitationId, guestSessionId: pk[0]?.id ?? "" };
}

/** Niêm phong một báo giá bằng khoá công khai THẬT của RFQ, đúng đường nhà cung cấp đi. */
async function niemPhong(rfqId: string, banRo = GIA_THAT): Promise<Uint8Array> {
  const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
  const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
  if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");
  return await sealBid({
    rfqId,
    algorithm: "ECDH_P256",
    recipientPublicKey: p256.publicKey,
    plaintext: new TextEncoder().encode(banRo),
  });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);

  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  const users = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'ua@vidu.vn', 'Nguoi mua') " +
      "RETURNING id",
    [orgA],
  );
  uA = users.rows[0]?.id ?? "";
  sA = await taoPhien(orgA, uA);
  const cs = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) " +
      "RETURNING id",
    [orgA, uA, sA],
  );
  csA = cs.rows[0]?.id ?? "";
  expect([orgA, uA, sA, csA].filter((x) => x === "")).toEqual([]);

  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");

  const { generateKeyPairSync } = await import("node:crypto");
  const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  khoaKy = {
    privateKey: new Uint8Array(cap.privateKey.export({ type: "pkcs8", format: "der" })),
    publicKey: new Uint8Array(cap.publicKey.export({ type: "spki", format: "der" })),
  };
  boKy = createLocalDevReceiptSigner(
    new ReceiptSigningKeyRing("ky-2026-09", { "ky-2026-09": khoaKy }),
  );
}, 180000);

afterAll(async () => {
  await db?.stop();
});

// ===============================================================================================
// [INV-B2] MỖI LẦN NỘP SINH MỘT BIÊN NHẬN, VÀ NHÀ CUNG CẤP KIỂM CHỨNG ĐỘC LẬP ĐƯỢC
// ===============================================================================================
describe("[INV-B2] nộp báo giá và biên nhận đã ký", () => {
  it("[INV-B2] chuỗi TRỌN VẸN: niêm phong, nộp, nhận biên nhận, kiểm bằng khoá công khai một mình", async () => {
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);

    const bn = await withTenant(apiPool, orgA, (c) =>
      submitBid(c, orgA, { guestSessionId: bc.guestSessionId, envelope: phongBi, signer: boKy }),
    );

    expect(bn.version).toBe(1);
    expect(bn.rfqId).toBe(bc.rfqId);

    // Đây là phép đo của B2, và nó nghèo có chủ đích: ba thứ, không thứ nào chỉ máy chủ mới có.
    await expect(
      verifyReceipt({
        canonicalText: bn.canonicalText,
        signature: bn.signature,
        publicKey: khoaKy.publicKey,
      }),
    ).resolves.toBe(true);

    // ... và mọi trường B2 đòi đều nằm TRONG văn bản đã ký.
    const t = parseReceiptText(bn.canonicalText);
    expect(t.rfqId).toBe(bc.rfqId);
    expect(t.bidId).toBe(bn.bidId);
    expect(t.version).toBe(1);
    expect(t.kid).toBe("ky-2026-09");
    expect(t.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it("[INV-B2] băm trong biên nhận khớp CIPHERTEXT THẬT ĐANG NẰM TRONG CSDL", async () => {
    // Vế này là thứ làm B5 có nghĩa về sau: nếu băm trong biên nhận không khớp thứ đã cất, thì
    // "ciphertext lưu trữ luôn khớp hash trong biên nhận" là một câu không kiểm được từ đầu.
    // Đọc ciphertext phải đi qua `app_unseal` — `app_api` không có quyền, và đó là phép đo kế bên.
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);
    const bn = await withTenant(apiPool, orgA, (c) =>
      submitBid(c, orgA, { guestSessionId: bc.guestSessionId, envelope: phongBi, signer: boKy }),
    );

    const { rows } = await withTenant(unsealPool, orgA, (c) =>
      c.query<{ envelope: Buffer }>("SELECT envelope FROM vendor_bid_versions WHERE id = $1", [
        bn.bidVersionId,
      ]),
    );
    const daCat = rows[0]?.envelope;
    expect(daCat).toBeDefined();
    expect(parseReceiptText(bn.canonicalText).ciphertextSha256).toBe(
      await sha256Hex(new Uint8Array(daCat ?? Buffer.alloc(0))),
    );
  });

  it("[INV-B2] biên nhận đọc lại từ CSDL vẫn kiểm chứng được — byte không đổi khi đi qua text", async () => {
    // `canonical_text` là `text`, và một chuyến đi qua CSDL có thể chuẩn hoá dòng mới nếu ai đó
    // đổi kiểu cột hay cấu hình client. Nếu điều đó xảy ra, chữ ký hỏng — và nó hỏng SAU khi
    // biên nhận đã phát cho nhà cung cấp, tức ở chỗ không sửa được.
    const bc = await dungBoiCanh();
    const bn = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId),
        signer: boKy,
      }),
    );
    const doc = await withTenant(apiPool, orgA, (c) => getBidReceipt(c, orgA, bn.bidVersionId));
    expect(doc).not.toBeNull();
    expect(doc?.canonicalText).toBe(bn.canonicalText);
    await expect(
      verifyReceipt({
        canonicalText: doc?.canonicalText ?? "",
        signature: doc?.signature ?? new Uint8Array(0),
        publicKey: khoaKy.publicKey,
      }),
    ).resolves.toBe(true);
  });

  it("[INV-B2] KHÔNG phiên bản nào không có biên nhận — giao dịch bị từ chối ở COMMIT", async () => {
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);
    const { rows: b } = await db.pool.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, bc.invitationId],
    );
    const bidId = b[0]?.id ?? "";

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, " +
            "submitted_by_guest_session_id) VALUES ($1, $2, $3, $4)",
          [orgA, bidId, Buffer.from(phongBi), bc.guestSessionId],
        ),
      ),
    ).rejects.toThrow(/khong phat bien nhan trong cung giao dich/);

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM vendor_bid_versions WHERE bid_id = $1",
      [bidId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[ADR-011] lược đồ KHÔNG có ràng buộc duy nhất nào trên `signature`", async () => {
    // Chữ ký ECDSA MỀM DẺO (có test đo điều đó ở `receipt.test.ts`), nên một `UNIQUE` trên cột
    // này biến một thứ kẻ tấn công điều khiển được thành một định danh. Đọc `pg_index` chứ không
    // đọc file SQL: thứ có thẩm quyền là chỉ mục đang tồn tại.
    const { rows } = await db.pool.query<{ ten: string }>(
      "SELECT i.relname AS ten FROM pg_index x " +
        "  JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid " +
        "  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey) " +
        " WHERE t.relname = 'bid_receipts' AND a.attname = 'signature' AND x.indisunique",
    );
    expect(rows).toEqual([]);

    // Đối chứng dương: câu truy vấn NÀY biết tìm ra một chỉ mục duy nhất khi có một cái.
    const { rows: co } = await db.pool.query<{ ten: string }>(
      "SELECT i.relname AS ten FROM pg_index x " +
        "  JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid " +
        "  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey) " +
        " WHERE t.relname = 'bid_receipts' AND a.attname = 'bid_version_id' AND x.indisunique",
    );
    expect(co.length).toBeGreaterThan(0);
  });
});

// ===============================================================================================
// [INV-B1] MỖI LẦN NỘP TẠO VERSION MỚI; KHÔNG UPDATE, KHÔNG DELETE
// ===============================================================================================
describe("[INV-B1] chỉ ghi thêm", () => {
  it("[INV-B1] nộp lần hai tạo phiên bản 2 và KHÔNG chạm phiên bản 1", async () => {
    const bc = await dungBoiCanh();
    const mot = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId, "gia lan mot"),
        signer: boKy,
      }),
    );
    const hai = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId, "gia lan hai"),
        signer: boKy,
      }),
    );

    expect(mot.version).toBe(1);
    expect(hai.version).toBe(2);
    expect(hai.bidId).toBe(mot.bidId);

    const ds = await withTenant(apiPool, orgA, (c) => listBidVersions(c, orgA, mot.bidId));
    expect(ds.map((v) => v.version)).toEqual([1, 2]);

    // Phiên bản 1 còn nguyên VÀ biên nhận của nó còn kiểm chứng được — "không sửa lén" nghĩa là
    // cả hai, không chỉ hàng còn đó.
    await expect(
      verifyReceipt({
        canonicalText: mot.canonicalText,
        signature: mot.signature,
        publicKey: khoaKy.publicKey,
      }),
    ).resolves.toBe(true);
  });

  it("[INV-B1] app_api KHÔNG UPDATE và KHÔNG DELETE được — quyền chặn", async () => {
    const bc = await dungBoiCanh();
    const bn = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId),
        signer: boKy,
      }),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("DELETE FROM vendor_bid_versions WHERE id = $1", [bn.bidVersionId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE vendor_bid_versions SET bid_id = bid_id WHERE id = $1", [bn.bidVersionId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("DELETE FROM bid_receipts WHERE bid_version_id = $1", [bn.bidVersionId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("[INV-B1] kể cả SUPERUSER cũng không — trigger chặn cả chủ sở hữu bảng", async () => {
    const bc = await dungBoiCanh();
    const bn = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId),
        signer: boKy,
      }),
    );
    await expect(
      db.pool.query("DELETE FROM vendor_bid_versions WHERE id = $1", [bn.bidVersionId]),
    ).rejects.toThrow(/chi duoc ghi them/);
    await expect(
      db.pool.query("UPDATE bid_receipts SET signature = $2 WHERE bid_version_id = $1", [
        bn.bidVersionId,
        Buffer.alloc(70),
      ]),
    ).rejects.toThrow(/chi duoc ghi them/);
  });

  it("[INV-B1] ĐỘT BIẾN: gỡ trigger thì chính câu DELETE ấy chỉ còn quyền đứng chặn", async () => {
    const bc = await dungBoiCanh();
    const bn = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId),
        signer: boKy,
      }),
    );
    await db.pool.query("DROP TRIGGER vendor_bid_versions_chi_ghi_them ON vendor_bid_versions");
    try {
      // Superuser + không trigger = xoá được. Đây là bằng chứng trigger LÀ thứ đang chặn ở phép
      // đo trên, chứ không phải một ràng buộc khác tình cờ đứng đó.
      // Xoá biên nhận trước vì khoá ngoại trỏ vào phiên bản.
      await db.pool.query("DROP TRIGGER bid_receipts_chi_ghi_them ON bid_receipts");
      await db.pool.query("DELETE FROM bid_receipts WHERE bid_version_id = $1", [bn.bidVersionId]);
      const { rowCount } = await db.pool.query(
        "DELETE FROM vendor_bid_versions WHERE id = $1",
        [bn.bidVersionId],
      );
      expect(rowCount, "không có trigger thì một báo giá đã nộp biến mất không dấu vết").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER vendor_bid_versions_chi_ghi_them BEFORE UPDATE OR DELETE ON " +
          "vendor_bid_versions FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them()",
      );
      await db.pool.query(
        "CREATE TRIGGER bid_receipts_chi_ghi_them BEFORE UPDATE OR DELETE ON bid_receipts " +
          "FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them()",
      );
    }
  });
});

// ===============================================================================================
// [INV-C1] SAU HẠN MỌI LẦN NỘP BỊ TỪ CHỐI — PHÁN QUYẾT TRONG CHÍNH TRANSACTION GHI
// ===============================================================================================
describe("[INV-C1] hạn nộp", () => {
  it("[INV-C1] ĐỐI CHỨNG DƯƠNG: trước hạn thì nộp được", async () => {
    const bc = await dungBoiCanh();
    await expect(
      withTenant(apiPool, orgA, async (c) =>
        submitBid(c, orgA, {
          guestSessionId: bc.guestSessionId,
          envelope: await niemPhong(bc.rfqId),
          signer: boKy,
        }),
      ),
    ).resolves.toMatchObject({ version: 1 });
  });

  it("[INV-C1] sau hạn thì bị TỪ CHỐI, và phép kiểm nằm ở CSDL chứ không ở gói", async () => {
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);

    // Dựng trạng thái "đã qua hạn". Migration 011 đòi cửa sổ thầu ≥ 1 giờ lúc MỞ, nên không mở
    // được một RFQ đã hết hạn; và deadline không bao giờ lùi được. Vô hiệu hoá trigger MÁY TRẠNG
    // THÁI để dựng fixture là hợp lệ — trigger ĐANG ĐƯỢC ĐO (`vendor_bid_versions_kiem_han_nop`)
    // vẫn bật nguyên.
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    try {
      await db.pool.query(
        "UPDATE rfq_packages SET deadline_at = now() - interval '1 minute' WHERE id = $1",
        [bc.rfqId],
      );
    } finally {
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    }

    await expect(
      withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, { guestSessionId: bc.guestSessionId, envelope: phongBi, signer: boKy }),
      ),
    ).rejects.toThrow(/Da qua han nop bao gia/);

    // ... và KHÔNG để lại gì: không phiên bản, không biên nhận.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM vendor_bid_versions v JOIN vendor_bids b ON b.id = v.bid_id " +
        " JOIN rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1",
      [bc.rfqId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[INV-C1] RFQ đã CLOSED thì bị từ chối — 'chưa hết hạn' và 'đang mở' là HAI điều kiện", async () => {
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);
    await withTenant(apiPool, orgA, (c) =>
      c.query(
        "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
          "early_close_reason = 'dong som de kiem tra', closed_by = $2, " +
          "closed_by_session_id = $3 WHERE id = $1",
        [bc.rfqId, uA, sA],
      ),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, { guestSessionId: bc.guestSessionId, envelope: phongBi, signer: boKy }),
      ),
    ).rejects.toThrow(/khong nhan bao gia khi dang o trang thai CLOSED/);
  });

  it("[INV-C1] ĐỘT BIẾN: gỡ trigger hạn nộp thì một báo giá TRỄ đi lọt", async () => {
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    try {
      await db.pool.query(
        "UPDATE rfq_packages SET deadline_at = now() - interval '1 minute' WHERE id = $1",
        [bc.rfqId],
      );
    } finally {
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    }

    await db.pool.query("DROP TRIGGER vendor_bid_versions_kiem_han_nop ON vendor_bid_versions");
    try {
      const bn = await withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, { guestSessionId: bc.guestSessionId, envelope: phongBi, signer: boKy }),
      );
      expect(bn.version, "không có trigger thì một báo giá nộp sau hạn được nhận").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER vendor_bid_versions_kiem_han_nop BEFORE INSERT ON vendor_bid_versions " +
          "FOR EACH ROW EXECUTE FUNCTION public.bid_kiem_han_nop()",
      );
    }
  });
});

// ===============================================================================================
// [INV-A3] TRUY VẤN SQL TRỰC TIẾP CHỈ CHO RA CIPHERTEXT
// ===============================================================================================
describe("[INV-A3] không đường SQL nào cho ra giá dạng rõ", () => {
  it("[INV-A3] giá dạng rõ KHÔNG xuất hiện trong BẤT KỲ cột nào của BẤT KỲ hàng nào", async () => {
    // Phép đo này chạy trên DỮ LIỆU THẬT, không đọc lược đồ: nó chuyển mọi hàng của ba bảng thành
    // văn bản rồi tìm chuỗi giá. Một cột mới thêm vào sau này tự rơi vào phạm vi — khác hẳn một
    // danh sách tên cột phải nhớ cập nhật.
    const bc = await dungBoiCanh();
    await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId, GIA_THAT),
        signer: boKy,
      }),
    );

    // Ba bảng báo giá CỘNG hai bảng mà một lần rò rỉ hay đi qua nhất: sổ kiểm toán và hàng đợi
    // outbox. `payload` của cả hai là `jsonb` — tức DẠNG RÕ — nên chúng là chỗ một `payload` viết
    // vội sẽ mang cả phong bì hoặc cả biên nhận ra ngoài. Khoản nợ I1 của Task 10 đã là đúng lớp
    // lỗi ấy một lần (payload đi vào log PostgreSQL).
    for (const bang of [
      "vendor_bids",
      "vendor_bid_versions",
      "bid_receipts",
      "audit_events",
      "outbox_jobs",
    ]) {
      const { rows } = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${bang} t WHERE t::text LIKE '%' || $1 || '%'`,
        [GIA_THAT],
      );
      expect(rows[0]?.n, `giá dạng rõ lọt vào bảng ${bang}`).toBe("0");
    }

    // Đối chứng dương: phép tìm NÀY biết tìm ra chuỗi ấy khi nó có mặt thật.
    const { rows: doi } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM (SELECT $1::text AS x) t WHERE t::text LIKE '%' || $1 || '%'",
      [GIA_THAT],
    );
    expect(doi[0]?.n).toBe("1");
  });

  it("[INV-A3] app_api GHI ĐƯỢC phong bì nhưng KHÔNG ĐỌC LẠI ĐƯỢC", async () => {
    const bc = await dungBoiCanh();
    const bn = await withTenant(apiPool, orgA, async (c) =>
      submitBid(c, orgA, {
        guestSessionId: bc.guestSessionId,
        envelope: await niemPhong(bc.rfqId),
        signer: boKy,
      }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("SELECT envelope FROM vendor_bid_versions WHERE id = $1", [bn.bidVersionId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    // Đối chứng dương thứ nhất: CÙNG role, CÙNG hàng, cột khác thì đọc được.
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ version: number }>("SELECT version FROM vendor_bid_versions WHERE id = $1", [
        bn.bidVersionId,
      ]),
    );
    expect(rows[0]?.version).toBe(1);

    // Đối chứng dương thứ hai: `app_unseal` THÌ đọc được — vai trò duy nhất có việc với ciphertext.
    const { rows: u } = await withTenant(unsealPool, orgA, (c) =>
      c.query<{ envelope: Buffer }>("SELECT envelope FROM vendor_bid_versions WHERE id = $1", [
        bn.bidVersionId,
      ]),
    );
    expect((u[0]?.envelope.length ?? 0) > 0).toBe(true);
  });
});

// ===============================================================================================
// [ADR-016 phía KHÁCH] PHIÊN KHÁCH KHÔNG GHI ĐƯỢC VÀO LUỒNG CỦA NGƯỜI KHÁC
// ===============================================================================================
describe("[ADR-016] danh tính của nhà cung cấp là DẪN XUẤT của phiên khách", () => {
  it("phiên khách của lời mời KHÁC không ghi được vào luồng này", async () => {
    const a = await dungBoiCanh();
    const b = await dungBoiCanh();
    const phongBi = await niemPhong(a.rfqId);

    // Dựng luồng của A rồi thử ghi bằng phiên của B — SQL viết tay, vì `submitBid` không có
    // tham số nào để diễn đạt cuộc tấn công này (xem chú thích của `SubmitBidInput`).
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, a.invitationId],
    );
    const bidId = rows[0]?.id ?? "";
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, " +
            "submitted_by_guest_session_id) VALUES ($1, $2, $3, $4)",
          [orgA, bidId, Buffer.from(phongBi), b.guestSessionId],
        ),
      ),
    ).rejects.toThrow(/thuoc loi moi khac/);
  });

  it("phiên khách ĐÃ THU HỒI không nộp được nữa", async () => {
    const bc = await dungBoiCanh();
    const phongBi = await niemPhong(bc.rfqId);
    await db.pool.query("UPDATE guest_sessions SET revoked_at = now() WHERE id = $1", [
      bc.guestSessionId,
    ]);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, { guestSessionId: bc.guestSessionId, envelope: phongBi, signer: boKy }),
      ),
    ).rejects.toThrow(/phiên khách không hợp lệ/);
  });

  it("phong bì RÁC bị từ chối TRƯỚC khi được cất", async () => {
    const bc = await dungBoiCanh();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, {
          guestSessionId: bc.guestSessionId,
          envelope: new Uint8Array(64),
          signer: boKy,
        }),
      ),
    ).rejects.toThrow(/không đọc được/);
  });
});
