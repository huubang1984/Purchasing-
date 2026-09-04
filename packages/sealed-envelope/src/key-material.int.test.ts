// =============================================================================================
// S1.4 — VÒNG ĐỜI VẬT LIỆU KHOÁ, ĐO TRÊN POSTGRES THẬT DƯỚI HAI ROLE
//
// Mọi phép đo chạy qua `db.poolAs("app_api")` hoặc `db.poolAs("app_unseal")`. Superuser BỎ QUA
// RLS và bỏ qua GRANT (đã đo ở 002), nên một test về QUYỀN CỘT chạy dưới superuser xanh vì lý do
// sai — và quyền cột là câu chịu lực của cả migration 017.
//
// FILE NÀY DỰNG RFQ BẰNG SQL VIẾT TAY, KHÔNG GỌI `@trustprocure/rfq`, VÀ ĐÓ LÀ MỘT RÀNG BUỘC CHỨ
// KHÔNG PHẢI MỘT SỞ THÍCH: `packages/rfq` phụ thuộc `packages/sealed-envelope` (từ S1.4, vì mở
// RFQ và sinh khoá là một việc), nên một lời gọi ngược từ đây sẽ tạo chu trình giữa hai gói.
// Hệ quả tốt kèm theo: các phép đo dưới đây đo THẲNG tầng CSDL, đúng tầng mà C5 sống.
//
// FILE NÀY CŨNG KHÔNG IMPORT `crypto-keys/src/unwrap.js`, và đó là điều đáng nói nhất về kiến
// trúc ở đây: nó dùng một bộ bọc ĐỐI XỨNG cục bộ của chính test, nên nó chứng minh được TOÀN BỘ
// chuỗi — bọc, cất, đọc lại bằng `app_unseal`, mở bọc, niêm phong, mở phong bì — mà KHÔNG cần
// một miễn trừ nào ở hàng rào G1. Cánh cửa mở bọc thật vẫn chỉ có đúng một người được vào, và
// người ấy là `apps/unseal-worker` (S1.6).
// =============================================================================================

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { getRfqPublicKeys, issueRfqKeyPair, revokeRfqKeyMaterial, sealBid } from "./index.js";
import { unsealBid } from "./unseal.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// ---------------------------------------------------------------------------------------------
// BỘ BỌC ĐỐI XỨNG CỦA RIÊNG TEST — có nghịch đảo, nên chuỗi đo được trọn vẹn.
// Đây KHÔNG phải adapter sản phẩm: khoá nằm trong biến cục bộ của file test. Adapter thật là
// `createLocalDevWrapper` (dev) và KMS (ADR-009), cả hai có phép đo riêng ở `packages/crypto-keys`.
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

function moBocTest(daBoc: Uint8Array): Uint8Array {
  const b = Buffer.from(daBoc);
  const d = createDecipheriv("aes-256-gcm", KHOA_TEST, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return new Uint8Array(Buffer.concat([d.update(b.subarray(28)), d.final()]));
}

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;
let orgB: string;
let uA: string, uB: string;
let sA: string, sB: string;
/** [ADR-017] Chính sách mua sắm của mỗi tổ chức — thứ làm `requires_dual_approval = false` hợp lệ. */
let csA: string, csB: string;

async function taoPhien(orgId: string, userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/**
 * Chính sách mua sắm: ngưỡng 100 triệu. Không có nó, RFQ dưới đây không rời được DRAFT —
 * trigger `rfq_kiem_nguong_phe_duyet_kep` (014) đòi BẰNG CHỨNG cho mọi lần bỏ phê duyệt kép.
 */
async function taoChinhSach(orgId: string, userId: string, sessionId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) " +
      "RETURNING id",
    [orgId, userId, sessionId],
  );
  return rows[0]?.id ?? "";
}

/** Một RFQ ở DRAFT, có một hạng mục và một ngân sách DƯỚI ngưỡng, KHÔNG cần phê duyệt kép. */
async function taoRfqNhap(orgId: string, userId: string, sessionId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) " +
      "RETURNING id",
    [orgId, MAI_SAU, userId, sessionId],
  );
  const rfqId = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam SS400', '10.0000', " +
      "'tam', $3, $4)",
    [orgId, rfqId, userId, sessionId],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, " +
      "created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgId, rfqId, orgId === orgA ? csA : csB, userId, sessionId],
  );
  return rfqId;
}

/** ... và đưa nó sang PENDING_APPROVAL, tức đúng ngưỡng cửa mà C5 nói tới. */
async function taoRfqChoDuyet(orgId: string, userId: string, sessionId: string): Promise<string> {
  const rfqId = await taoRfqNhap(orgId, userId, sessionId);
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, " +
      "submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, userId, sessionId],
  );
  return rfqId;
}

/** Mở RFQ theo đúng thứ tự mà 017 cưỡng chế: sinh khoá, rồi chuyển trạng thái, cùng giao dịch. */
async function moRfq(orgId: string, rfqId: string, userId: string, sessionId: string): Promise<void> {
  await withTenant(apiPool, orgId, async (c) => {
    await issueRfqKeyPair(c, orgId, { rfqId, actorSessionId: sessionId, wrapper: boBocTest });
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
        "opened_by_session_id = $3 WHERE id = $1",
      [rfqId, userId, sessionId],
    );
  });
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

  const uaRows = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'ua@vidu.vn', 'Nguoi mua A') " +
      "RETURNING id",
    [orgA],
  );
  const ubRows = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'ub@vidu.vn', 'Nguoi mua B') " +
      "RETURNING id",
    [orgB],
  );
  uA = uaRows.rows[0]?.id ?? "";
  uB = ubRows.rows[0]?.id ?? "";
  sA = await taoPhien(orgA, uA);
  sB = await taoPhien(orgB, uB);

  csA = await taoChinhSach(orgA, uA, sA);
  csB = await taoChinhSach(orgB, uB, sB);

  expect([orgA, orgB, uA, uB, sA, sB, csA, csB].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

// ===============================================================================================
// [INV-C5] "CẶP KHOÁ RFQ CHỈ SINH ĐÚNG LÚC CHUYỂN SANG OPEN" — BỐN MŨI VÀ MỘT ĐỐI CHỨNG DƯƠNG
// ===============================================================================================
describe("[INV-C5] khoá RFQ chỉ sinh đúng lúc chuyển sang OPEN", () => {
  it("[INV-C5] ĐỐI CHỨNG DƯƠNG: mở RFQ đúng cách thì có đủ khoá của cả hai thuật toán", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
    expect(khoa.map((k) => k.algorithm)).toEqual(["ECDH_P256", "X25519"]);
    expect(khoa.every((k) => k.publicKey.length > 0)).toBe(true);
    expect(khoa.every((k) => k.keyVersion === "test-v1")).toBe(true);
    expect(khoa.every((k) => k.revokedAt === null)).toBe(true);

    const { rows } = await db.pool.query<{ status: string }>(
      "SELECT status FROM rfq_packages WHERE id = $1",
      [rfqId],
    );
    expect(rows[0]?.status).toBe("OPEN");
  });

  it("[INV-C5] (a) KHÔNG SỚM HƠN: không sinh được khoá cho một RFQ còn DRAFT", async () => {
    const rfqId = await taoRfqNhap(orgA, uA, sA);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sA, wrapper: boBocTest }),
      ),
    ).rejects.toThrow(/chi sinh duoc luc chuyen sang OPEN/);
  });

  it("[INV-C5] (a) và cũng không sinh THÊM được cho một RFQ đã OPEN từ trước", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sA, wrapper: boBocTest }),
      ),
    ).rejects.toThrow(/chi sinh duoc luc chuyen sang OPEN/);
  });

  it("[INV-C5] (b) KHÔNG MỒ CÔI: sinh khoá rồi KHÔNG mở RFQ thì giao dịch bị từ chối ở COMMIT", async () => {
    // Vế này KHÔNG suy ra được từ vế (a): lúc INSERT chạy, RFQ đúng là đang ở PENDING_APPROVAL,
    // nên (a) cho qua. Chỉ tại COMMIT mới trả lời được câu "giao dịch này CÓ mở RFQ hay không",
    // và đó là lý do trigger ấy phải DEFERRABLE INITIALLY DEFERRED.
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sA, wrapper: boBocTest }),
      ),
    ).rejects.toThrow(/khong mo no trong cung giao dich/);

    // Và nó phải KHÔNG để lại gì — một giao dịch bị từ chối ở COMMIT là một giao dịch bị cuộn lại.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_key_material WHERE rfq_id = $1",
      [rfqId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[INV-C5] (c) CHIỀU NGƯỢC LẠI: không mở được RFQ khi chưa có cặp khoá mặc định", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
            "opened_by_session_id = $3 WHERE id = $1",
          [rfqId, uA, sA],
        ),
      ),
    ).rejects.toThrow(/chua co cap khoa ECDH_P256/);
  });

  it("[INV-C5] (c) chỉ có X25519 thôi thì VẪN không mở được — thuật toán mặc định là bắt buộc", async () => {
    // [ADR-011 mục 3] "X25519 KHÔNG được làm điều kiện để nộp thầu" — nên P-256 phải luôn có mặt.
    // Đây là chỗ câu ấy thành một ràng buộc chạy được thay vì một câu trong tài liệu.
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);

    // Lớp thứ nhất, ở tầng ứng dụng: nó nói được VÌ SAO.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueRfqKeyPair(c, orgA, {
          rfqId,
          actorSessionId: sA,
          wrapper: boBocTest,
          algorithms: ["X25519"],
        }),
      ),
    ).rejects.toThrow(/ECDH_P256 bắt buộc phải có mặt/);

    // Lớp CÓ THẨM QUYỀN, ở CSDL: đi vòng qua tầng ứng dụng bằng SQL viết tay, dưới SUPERUSER —
    // tức bỏ qua cả RLS lẫn GRANT. Trigger vẫn chặn.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, " +
          "wrapped_private_key, key_version, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'X25519', $3, $4, 'test-v1', $5, $6)",
        [orgA, rfqId, Buffer.alloc(44, 7), Buffer.alloc(60, 9), uA, sA],
      );
      await expect(
        c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
            "opened_by_session_id = $3 WHERE id = $1",
          [rfqId, uA, sA],
        ),
      ).rejects.toThrow(/chua co cap khoa ECDH_P256/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("[INV-G2] hai RFQ cùng tổ chức có khoá công khai KHÁC NHAU", async () => {
    const r1 = await taoRfqChoDuyet(orgA, uA, sA);
    const r2 = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, r1, uA, sA);
    await moRfq(orgA, r2, uA, sA);

    const [k1, k2] = await withTenant(apiPool, orgA, async (c) => [
      await getRfqPublicKeys(c, orgA, r1),
      await getRfqPublicKeys(c, orgA, r2),
    ]);
    const p256 = (ds: readonly { algorithm: string; publicKey: Uint8Array }[]) =>
      Buffer.from(ds.find((k) => k.algorithm === "ECDH_P256")?.publicKey ?? new Uint8Array(0));
    expect(p256(k1).length).toBeGreaterThan(0);
    expect(p256(k1).equals(p256(k2))).toBe(false);
  });
});

// ===============================================================================================
// [INV-G1] BẤT ĐỐI XỨNG QUYỀN CỘT — GHI ĐƯỢC MÀ KHÔNG ĐỌC ĐƯỢC
// ===============================================================================================
describe("[INV-G1] app_api ghi được khoá riêng đã bọc nhưng KHÔNG đọc lại được", () => {
  it("[INV-G1] SELECT wrapped_private_key bằng app_api bị Postgres TỪ CHỐI", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    // Câu này do một người có thiện chí viết. Nó vẫn không chạy, và nó không chạy vì CSDL từ
    // chối — không vì có ai nhớ ADR-006.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("SELECT wrapped_private_key FROM rfq_key_material WHERE rfq_id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    // Đối chứng dương thứ nhất: CÙNG role, CÙNG bảng, CÙNG hàng — cột khác thì đọc được. Không có
    // vế này, phép đo trên xanh kể cả khi `app_api` mất sạch quyền đọc bảng.
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ algorithm: string }>(
        "SELECT algorithm FROM rfq_key_material WHERE rfq_id = $1 ORDER BY algorithm",
        [rfqId],
      ),
    );
    expect(rows.map((r) => r.algorithm)).toEqual(["ECDH_P256", "X25519"]);
  });

  it("[INV-G1] app_unseal THÌ đọc được — đối chứng dương cho vai trò duy nhất được phép", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    const { rows } = await withTenant(unsealPool, orgA, (c) =>
      c.query<{ wrapped_private_key: Buffer }>(
        "SELECT wrapped_private_key FROM rfq_key_material WHERE rfq_id = $1",
        [rfqId],
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.wrapped_private_key.length).toBeGreaterThan(28);
  });

  it("[INV-G1] app_api KHÔNG xoá và KHÔNG sửa được vật liệu khoá", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("DELETE FROM rfq_key_material WHERE rfq_id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_key_material SET public_key = $2 WHERE rfq_id = $1", [
          rfqId,
          Buffer.alloc(64),
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("[INV-G1] kể cả SUPERUSER cũng không xoá hay đổi được — quyền chặn role, trigger chặn cả chủ", async () => {
    // Đây là vế mà quyền cột KHÔNG mua được: superuser vượt GRANT và vượt RLS, nhưng không vượt
    // trigger. Cùng lập luận đã dựng lớp append-only cho `audit_events` ở 003.
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    await expect(
      db.pool.query("DELETE FROM rfq_key_material WHERE rfq_id = $1", [rfqId]),
    ).rejects.toThrow(/Khong duoc xoa vat lieu khoa/);

    await expect(
      db.pool.query("UPDATE rfq_key_material SET public_key = $2 WHERE rfq_id = $1", [
        rfqId,
        Buffer.alloc(64),
      ]),
    ).rejects.toThrow(/Chi sua duoc bon cot thu hoi/);
  });
});

// ===============================================================================================
// CHUỖI TRỌN VẸN — TỪ CSDL RA PHONG BÌ VÀ NGƯỢC LẠI
// ===============================================================================================
describe("[INV-G2] chuỗi trọn vẹn: khoá trong CSDL mở được đúng phong bì của nó, và chỉ nó", () => {
  it("[INV-G2] niêm phong bằng khoá công khai đọc từ CSDL, mở bằng khoá riêng của chính RFQ ấy", async () => {
    const rfqA = await taoRfqChoDuyet(orgA, uA, sA);
    const rfqB = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqA, uA, sA);
    await moRfq(orgA, rfqB, uA, sA);

    // Nhà cung cấp: chỉ có khoá CÔNG KHAI, đọc qua `app_api`.
    const congKhai = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqA));
    const p256 = congKhai.find((k) => k.algorithm === "ECDH_P256");
    expect(p256).toBeDefined();
    const phongBi = await sealBid({
      rfqId: rfqA,
      algorithm: "ECDH_P256",
      recipientPublicKey: p256?.publicKey ?? new Uint8Array(0),
      plaintext: new TextEncoder().encode("Don gia: 1.234.567 VND"),
    });

    // Bên mở thầu: đọc khoá riêng ĐÃ BỌC qua `app_unseal`, mở bọc, mở phong bì.
    const riengA = await docKhoaRieng(rfqA);
    const banRo = await unsealBid({
      rfqId: rfqA,
      algorithm: "ECDH_P256",
      envelope: phongBi,
      recipientPrivateKey: riengA,
    });
    expect(new TextDecoder().decode(banRo)).toBe("Don gia: 1.234.567 VND");

    // ... và khoá riêng của RFQ B thì KHÔNG mở được. Đây là G2 ở dạng đo được trên dữ liệu thật,
    // không phải trên hai cặp khoá do test tự sinh.
    const riengB = await docKhoaRieng(rfqB);
    await expect(
      unsealBid({
        rfqId: rfqA,
        algorithm: "ECDH_P256",
        envelope: phongBi,
        recipientPrivateKey: riengB,
      }),
    ).rejects.toThrow(/Không mở được phong bì/);
  });

  async function docKhoaRieng(rfqId: string): Promise<Uint8Array> {
    const { rows } = await withTenant(unsealPool, orgA, (c) =>
      c.query<{ wrapped_private_key: Buffer }>(
        "SELECT wrapped_private_key FROM rfq_key_material " +
          " WHERE rfq_id = $1 AND algorithm = 'ECDH_P256'",
        [rfqId],
      ),
    );
    const daBoc = rows[0]?.wrapped_private_key;
    if (daBoc === undefined) throw new Error("khong doc duoc khoa rieng da boc");
    return moBocTest(new Uint8Array(daBoc));
  }
});

// ===============================================================================================
// [INV-G4] MỌI THAO TÁC KHOÁ ĐỀU SINH AUDIT — VÀ PHẦN CHÊNH ĐƯỢC NÓI RA
// ===============================================================================================
describe("[INV-G4] sinh khoá và thu hồi khoá đều để lại bản ghi kiểm toán", () => {
  it("[INV-G4] mỗi cặp khoá sinh ra một bản ghi RFQ_KEY_MATERIAL_ISSUED mang đúng chủ phiên", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    const { rows } = await db.pool.query<{
      actor_type: string;
      actor_id: string;
      payload: { algorithm: string; keyVersion: string };
    }>(
      "SELECT actor_type, actor_id, payload FROM audit_events " +
        " WHERE resource_id = $1 AND action = 'RFQ_KEY_MATERIAL_ISSUED' ORDER BY seq",
      [rfqId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payload.algorithm)).toEqual(["ECDH_P256", "X25519"]);
    // [ADR-016] Danh tính trong sổ là DẪN XUẤT của phiên, không phải một lời khai của người gọi.
    expect(rows.every((r) => r.actor_type === "USER" && r.actor_id === uA)).toBe(true);
    // KHÔNG được có khoá nào trong payload — sổ kiểm toán không phải chỗ nhân bản dữ liệu, và
    // càng không phải chỗ nhân bản vật liệu khoá.
    for (const r of rows) {
      expect(Object.keys(r.payload).sort()).toEqual(["algorithm", "keyVersion"]);
    }
  });

  it("[INV-G4] huỷ RFQ thu hồi khoá, và mỗi lần thu hồi cũng là một bản ghi", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    await withTenant(apiPool, orgA, async (c) => {
      await c.query(
        "UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now(), " +
          "cancelled_by = $2, cancelled_by_session_id = $3 WHERE id = $1",
        [rfqId, uA, sA],
      );
      const so = await revokeRfqKeyMaterial(c, orgA, {
        rfqId,
        reason: "RFQ da huy",
        actorSessionId: sA,
      });
      expect(so).toBe(2);
    });

    const { rows } = await db.pool.query<{ payload: { algorithm: string; reason: string } }>(
      "SELECT payload FROM audit_events WHERE resource_id = $1 " +
        " AND action = 'RFQ_KEY_MATERIAL_REVOKED' ORDER BY seq",
      [rfqId],
    );
    expect(rows.map((r) => r.payload.algorithm).sort()).toEqual(["ECDH_P256", "X25519"]);

    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
    expect(khoa.every((k) => k.revokedAt !== null)).toBe(true);
  });

  it("[INV-G4] KHÔNG thu hồi được khoá của một RFQ chưa huỷ", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        revokeRfqKeyMaterial(c, orgA, { rfqId, reason: "khong co ly do", actorSessionId: sA }),
      ),
    ).rejects.toThrow(/Chi thu hoi duoc vat lieu khoa khi RFQ da huy/);
  });

  it("[INV-G4] thu hồi là MỘT CHIỀU — không gỡ được, kể cả bởi superuser", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);
    await withTenant(apiPool, orgA, async (c) => {
      await c.query(
        "UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now(), " +
          "cancelled_by = $2, cancelled_by_session_id = $3 WHERE id = $1",
        [rfqId, uA, sA],
      );
      await revokeRfqKeyMaterial(c, orgA, { rfqId, reason: "RFQ da huy", actorSessionId: sA });
    });

    await expect(
      db.pool.query("UPDATE rfq_key_material SET revoked_at = NULL WHERE rfq_id = $1", [rfqId]),
    ).rejects.toThrow(/Khong go duoc thu hoi/);
  });
});

// ===============================================================================================
// [INV-F1] CÔ LẬP TỔ CHỨC — VẬT LIỆU KHOÁ KHÔNG PHẢI NGOẠI LỆ
// ===============================================================================================
describe("[INV-F1] vật liệu khoá chịu RLS như mọi bảng có org_id", () => {
  it("[INV-F1] tổ chức B không nhìn thấy một hàng nào của tổ chức A", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    const thay = await withTenant(apiPool, orgB, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_key_material"),
    );
    expect(thay.rows[0]?.n).toBe("0");

    // Đối chứng dương: cùng câu ấy dưới tổ chức A thì thấy. Không có vế này, phép đo trên xanh
    // kể cả khi bảng rỗng.
    const thayA = await withTenant(apiPool, orgA, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_key_material"),
    );
    expect(Number(thayA.rows[0]?.n ?? "0")).toBeGreaterThan(0);
  });

  it("[INV-F1] và app_unseal của tổ chức B cũng không đọc được khoá riêng của tổ chức A", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    const thay = await withTenant(unsealPool, orgB, (c) =>
      c.query<{ wrapped_private_key: Buffer }>(
        "SELECT wrapped_private_key FROM rfq_key_material WHERE rfq_id = $1",
        [rfqId],
      ),
    );
    expect(thay.rows).toHaveLength(0);
    expect(sB).not.toBe("");
    expect(uB).not.toBe("");
  });
});

// ===============================================================================================
// ĐỘT BIẾN — MỖI LỚP BỊ GỠ ĐI THÌ CHÍNH PHÉP ĐO Ở TRÊN ĐI LỌT
//
// Không có khối này, mọi khẳng định phía trên xanh kể cả khi thứ chặn là một thứ KHÁC — một
// CHECK, một quyền cột, hay một sự trùng hợp. Bốn phép đo dưới đây gỡ ĐÚNG MỘT lớp mỗi lần và
// đòi cùng thao tác ấy ĐI QUA. Đó là khác biệt giữa "có một quy tắc" và "quy tắc ấy là thứ đang
// chặn".
// ===============================================================================================
describe("đột biến — chứng minh từng lớp là thứ ĐANG chặn, không phải một lớp khác", () => {
  it("gỡ trigger (a) thì sinh THÊM khoá cho một RFQ đã OPEN ĐI LỌT", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    await db.pool.query("DROP TRIGGER rfq_key_material_chi_sinh_luc_mo ON rfq_key_material");
    try {
      // RFQ đang OPEN, nên vế (b) — vốn đòi RFQ đã đi QUA cửa OPEN — vẫn thoả. Chỉ vế (a) đứng
      // giữa thao tác này và CSDL, và nó vừa bị gỡ.
      const { rowCount } = await db.pool.query(
        "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, " +
          "wrapped_private_key, key_version, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'X25519', $3, $4, 'dot-bien', $5, $6) " +
          "ON CONFLICT (org_id, rfq_id, algorithm) DO NOTHING",
        [orgA, rfqId, Buffer.alloc(44, 3), Buffer.alloc(60, 4), uA, sA],
      );
      // Hàng X25519 đã có từ `moRfq`, nên ON CONFLICT nuốt nó — điều được đo ở đây là câu lệnh
      // KHÔNG còn bị RAISE EXCEPTION, chứ không phải nó ghi được bao nhiêu hàng.
      expect(rowCount).toBe(0);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_key_material_chi_sinh_luc_mo BEFORE INSERT ON rfq_key_material " +
          "FOR EACH ROW EXECUTE FUNCTION public.rfq_khoa_chi_sinh_luc_mo()",
      );
    }
  });

  it("gỡ trigger (b) thì một cặp khoá MỒ CÔI sống sót qua COMMIT", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);

    await db.pool.query(
      "DROP TRIGGER rfq_key_material_phai_di_kem_lan_mo ON rfq_key_material",
    );
    try {
      await withTenant(apiPool, orgA, (c) =>
        issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sA, wrapper: boBocTest }),
      );
      const { rows } = await db.pool.query<{ n: string; status: string }>(
        "SELECT (SELECT count(*)::text FROM rfq_key_material WHERE rfq_id = p.id) AS n, " +
          " p.status FROM rfq_packages p WHERE p.id = $1",
        [rfqId],
      );
      // Hai cặp khoá tồn tại cho một RFQ chưa bao giờ mở — đúng thứ vế (b) sinh ra để chặn.
      expect(rows[0]?.n).toBe("2");
      expect(rows[0]?.status).toBe("PENDING_APPROVAL");
    } finally {
      await db.pool.query(
        "CREATE CONSTRAINT TRIGGER rfq_key_material_phai_di_kem_lan_mo " +
          " AFTER INSERT ON rfq_key_material DEFERRABLE INITIALLY DEFERRED " +
          " FOR EACH ROW EXECUTE FUNCTION public.rfq_khoa_phai_di_kem_lan_mo()",
      );
    }
  });

  it("gỡ trigger (c) thì một RFQ mở ra mà KHÔNG có cặp khoá nào", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);

    await db.pool.query("DROP TRIGGER rfq_packages_kiem_khoa_khi_mo ON rfq_packages");
    try {
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
            "opened_by_session_id = $3 WHERE id = $1",
          [rfqId, uA, sA],
        ),
      );
      expect(rowCount, "không có trigger thì một RFQ mở ra mà nhà cung cấp không có gì để niêm phong").toBe(1);
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM rfq_key_material WHERE rfq_id = $1",
        [rfqId],
      );
      expect(rows[0]?.n).toBe("0");
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_khoa_khi_mo BEFORE UPDATE ON rfq_packages " +
          " FOR EACH ROW WHEN (NEW.status = 'OPEN' AND NEW.status IS DISTINCT FROM OLD.status) " +
          " EXECUTE FUNCTION public.rfq_kiem_khoa_khi_mo()",
      );
    }
  });

  it("[INV-G1] cấp thêm SELECT cho app_api thì chính câu SELECT ấy chạy — quyền CỘT là thứ đang chặn", async () => {
    const rfqId = await taoRfqChoDuyet(orgA, uA, sA);
    await moRfq(orgA, rfqId, uA, sA);

    await db.pool.query("GRANT SELECT (wrapped_private_key) ON rfq_key_material TO app_api");
    try {
      const { rows } = await withTenant(apiPool, orgA, (c) =>
        c.query<{ wrapped_private_key: Buffer }>(
          "SELECT wrapped_private_key FROM rfq_key_material WHERE rfq_id = $1",
          [rfqId],
        ),
      );
      expect(rows).toHaveLength(2);
      // Và nó KHÔNG chỉ chạy — nó cho ra đúng khoá riêng mở bọc được. Tức nếu dòng GRANT ở 017
      // được viết rộng thêm một cột, `api` mở được mọi báo giá của mọi RFQ.
      const daBoc = rows[0]?.wrapped_private_key;
      expect(daBoc).toBeDefined();
      expect(moBocTest(new Uint8Array(daBoc ?? Buffer.alloc(0))).length).toBeGreaterThan(0);
    } finally {
      await db.pool.query("REVOKE SELECT (wrapped_private_key) ON rfq_key_material FROM app_api");
    }
  });
});
