// ==============================================================================================
// [khoản nợ 29] A5 — MỘT NHÀ CUNG CẤP KHÔNG ĐỌC ĐƯỢC GÌ CỦA NHÀ CUNG CẤP KHÁC
//
// Khối A5 của `018` khai một khoảng trống có tên: phiên khách chạy dưới CÙNG role `app_api` và
// CÙNG `app.org_id` của tổ chức người mua, nên RLS cô lập TỔ CHỨC chứ không cô lập nhà cung cấp
// với nhà cung cấp. Phần CSDL làm được đã làm (một phiên khách không GHI được vào luồng của người
// khác — trigger `bid_kiem_phien_khach`); phần nó không làm được là chặn một câu `SELECT`.
//
// `027` đóng nốt bằng policy `AS RESTRICTIVE` đọc `app.guest_session_id`. Bộ này đo nó, và đo
// theo khuôn ĐỐI KHÁNG: dựng HAI nhà cung cấp trên CÙNG một RFQ, gắn phiên của người thứ nhất,
// rồi thử đọc mọi thứ của người thứ hai qua đúng những câu mà một lỗi lập trình sẽ viết.
//
// BA VẾ, và vế thứ ba là vế chống-mù:
//   ⑴ ĐỐI CHỨNG DƯƠNG — khách A đọc được của CHÍNH MÌNH. Không có vế này, mọi khẳng định "đọc ra
//     0 hàng" ở dưới xanh y hệt khi policy chặn TẤT CẢ, kể cả đường hợp pháp.
//   ⑵ Khách A đọc ra ĐÚNG 0 hàng của khách B, trên từng bảng của mặt khách.
//   ⑶ MỌI bảng có RLS đều phải có policy `<bảng>_khach`. Một bảng mới ra đời mà không ai quyết
//     định sẽ ĐỎ ở đây — cùng khuôn `KIND_KHONG_NHAN` của khoản nợ 34, và cùng bài học đã phải
//     học ba lần: một hàng rào đọc một danh sách tên sẽ mù vào ngày có tên thứ hai.
// ==============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withGuestSession, withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { issueRfqKeyPair, sealBid, getRfqPublicKeys } from "@trustprocure/sealed-envelope";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

const boBocTest = {
  name: "doi-xung-cua-test",
  wrap: (_orgId: string, banRo: Uint8Array) =>
    Promise.resolve({ ciphertext: banRo.map((b) => b ^ 0xff), keyVersion: "test-v1" }),
};

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA = "";
let uA = "";
let sA = "";
let csA = "";
let rfqId = "";

interface BenKhach {
  supplierId: string;
  invitationId: string;
  guestSessionId: string;
  bidId: string;
  versionId: string;
}

async function taoPhienNguoiMua(): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, uA, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/**
 * Dựng một nhà cung cấp CÓ THẬT trên RFQ đang mở: lời mời, token, thách thức OTP đã đối chiếu,
 * phiên khách, luồng báo giá, một phiên bản đã niêm phong, và một biên nhận.
 *
 * Đi qua đúng chuỗi mà sản phẩm đi — trigger `guest_sessions_kiem_danh_tinh` (012) đòi phiên
 * khách trỏ tới một thách thức ĐÃ ĐỐI CHIẾU, và đó chính là bất biến E5.
 */
async function dungBenKhach(ten: string): Promise<BenKhach> {
  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
      "VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, `NCC ${ten}`, uA, sA],
  );
  const supplierId = ncc[0]?.id ?? "";
  const { rows: lh } = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, " +
      "created_by, created_by_session_id) VALUES ($1, $2, $3, $4, '0900000001', $5, $6) " +
      "RETURNING id",
    [orgA, supplierId, `Nguoi ban ${ten}`, `${ten}@vidu.vn`, uA, sA],
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
  const guestSessionId = pk[0]?.id ?? "";

  const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
  const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
  if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");
  const phongBi = await sealBid({
    rfqId,
    algorithm: "ECDH_P256",
    recipientPublicKey: p256.publicKey,
    plaintext: new TextEncoder().encode(`Gia cua ${ten}`),
  });

  const { rows: lu } = await db.pool.query<{ id: string }>(
    "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
    [orgA, invitationId],
  );
  const bidId = lu[0]?.id ?? "";
  // MỘT giao dịch cho cả phiên bản lẫn biên nhận: `018` gắn một CONSTRAINT TRIGGER
  // `INITIALLY DEFERRED` đòi mỗi phiên bản có biên nhận LÚC COMMIT (B2). Hai lời gọi
  // `db.pool.query` là hai giao dịch, và giao dịch thứ nhất chết ngay ở COMMIT — đúng như nó
  // nên chết. Fixture phải đi theo luật ấy, không đi vòng.
  const client = await db.pool.connect();
  let versionId = "";
  try {
    await client.query("BEGIN");
    const { rows: pb } = await client.query<{ id: string }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, bidId, Buffer.from(phongBi), guestSessionId],
    );
    versionId = pb[0]?.id ?? "";
    // `canonical_text` phải bắt đầu bằng đúng dòng tiêu đề và dài ≥ 64 byte — CHECK của `018`.
    // Fixture đi theo luật của bảng, không nới luật cho fixture.
    await client.query(
      "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) " +
        "VALUES ($1, $2, $3, $4)",
      [
        orgA,
        versionId,
        `trustprocure-receipt-v1
kid=k1
ben=${ten}
${"x".repeat(64)}`,
        randomBytes(70),
      ],
    );
    await client.query("COMMIT");
  } catch (loi) {
    await client.query("ROLLBACK");
    throw loi;
  } finally {
    client.release();
  }

  return { supplierId, invitationId, guestSessionId, bidId, versionId };
}

let ben1: BenKhach;
let ben2: BenKhach;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");

  const { rows: o } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = o[0]?.id ?? "";
  const { rows: u } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'ua@vidu.vn', 'Nguoi mua') " +
      "RETURNING id",
    [orgA],
  );
  uA = u[0]?.id ?? "";
  sA = await taoPhienNguoiMua();
  const { rows: cs } = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) " +
      "RETURNING id",
    [orgA, uA, sA],
  );
  csA = cs[0]?.id ?? "";

  const { rows: r } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) " +
      "RETURNING id",
    [orgA, MAI_SAU, uA, sA],
  );
  rfqId = r[0]?.id ?? "";
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

  ben1 = await dungBenKhach("mot");
  ben2 = await dungBenKhach("hai");
  expect([orgA, uA, sA, csA, rfqId].filter((x) => x === "")).toEqual([]);
}, 240000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await db?.stop();
});

/** Đếm hàng dưới một phiên khách. Trả về số nguyên, `-1` nếu câu lệnh không trả gì. */
async function demDuoiKhach(guestSessionId: string, cau: string, thamSo: unknown[]): Promise<number> {
  const { rows } = await withGuestSession(apiPool, orgA, guestSessionId, (c) =>
    c.query<{ n: string }>(cau, thamSo),
  );
  return Number(rows[0]?.n ?? "-1");
}

describe("[INV-A5] phiên khách bị cô lập ở tầng CSDL, không chỉ ở kỷ luật ứng dụng", () => {
  it("[INV-A5] ĐỐI CHỨNG DƯƠNG: khách MỘT đọc được đầy đủ dữ liệu CỦA CHÍNH MÌNH", async () => {
    // Vế này đi TRƯỚC: mọi khẳng định "0 hàng" ở dưới xanh y hệt khi policy chặn tất cả, kể cả
    // đường hợp pháp — và một cổng chặn cả người đúng lẫn người sai không phải một cổng.
    expect(
      await demDuoiKhach(ben1.guestSessionId, "SELECT count(*)::text AS n FROM guest_sessions", []),
      "phiên của chính mình",
    ).toBe(1);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM rfq_invitations WHERE id = $1",
        [ben1.invitationId],
      ),
      "lời mời của chính mình",
    ).toBe(1);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM vendor_bids WHERE id = $1",
        [ben1.bidId],
      ),
      "luồng báo giá của chính mình",
    ).toBe(1);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM vendor_bid_versions WHERE id = $1",
        [ben1.versionId],
      ),
      "phiên bản của chính mình",
    ).toBe(1);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM bid_receipts WHERE bid_version_id = $1",
        [ben1.versionId],
      ),
      "biên nhận của chính mình",
    ).toBe(1);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM rfq_packages WHERE id = $1",
        [rfqId],
      ),
      "gói thầu mình được mời",
    ).toBe(1);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM rfq_items WHERE rfq_id = $1",
        [rfqId],
      ),
      "hạng mục của gói thầu ấy",
    ).toBe(1);
  });

  it("[INV-A5] khách MỘT không thấy SỰ TỒN TẠI của khách HAI — lời mời, luồng, phiên bản, biên nhận", async () => {
    // Đây là đúng bốn danh từ của mệnh đề A5: *danh tính, sự tồn tại, số lượng, giá*. Mỗi câu
    // dưới đây là một câu mà một lỗi lập trình bình thường sẽ viết — không phải một câu tấn công
    // tinh vi — và đó mới là điều đáng đo.
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM rfq_invitations WHERE id = $1",
        [ben2.invitationId],
      ),
      "lời mời của người khác",
    ).toBe(0);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM vendor_bids WHERE id = $1",
        [ben2.bidId],
      ),
      "luồng báo giá của người khác",
    ).toBe(0);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM vendor_bid_versions WHERE id = $1",
        [ben2.versionId],
      ),
      "phiên bản của người khác",
    ).toBe(0);
    expect(
      await demDuoiKhach(
        ben1.guestSessionId,
        "SELECT count(*)::text AS n FROM bid_receipts WHERE bid_version_id = $1",
        [ben2.versionId],
      ),
      "biên nhận của người khác",
    ).toBe(0);
    expect(
      await demDuoiKhach(ben1.guestSessionId, "SELECT count(*)::text AS n FROM guest_sessions", []),
      "phiên khách của người khác",
    ).toBe(1);
  });

  it("[INV-A5] ĐẾM TOÀN BẢNG cũng chỉ ra số của CHÍNH MÌNH — không có `WHERE` nào để quên", async () => {
    // Vế trên dùng `WHERE id = <của người khác>`, tức nó vẫn giả định người viết câu biết mình
    // đang hỏi gì. Vế này bỏ luôn `WHERE`: một câu `SELECT count(*)` trần là thứ dễ viết nhất
    // trong một màn hình "báo giá của bạn", và nó KHÔNG được tiết lộ số lượng đối thủ.
    for (const [bang, mong] of [
      ["rfq_invitations", 1],
      ["vendor_bids", 1],
      ["vendor_bid_versions", 1],
      ["bid_receipts", 1],
    ] as const) {
      expect(
        await demDuoiKhach(ben1.guestSessionId, `SELECT count(*)::text AS n FROM ${bang}`, []),
        `${bang}: đếm trần dưới phiên khách`,
      ).toBe(mong);
    }
  });

  it("[INV-A5] các bảng NGOÀI mặt khách trả về ĐÚNG 0 hàng dưới một phiên khách", async () => {
    // Mặc định của `027` là TỪ CHỐI. Bốn bảng dưới đây là bốn bảng mà một lần rò rỉ sẽ đau nhất,
    // và không bảng nào trong số chúng có lý do xuất hiện trước một phiên khách.
    for (const bang of ["users", "suppliers", "supplier_contacts", "org_procurement_policies"]) {
      expect(
        await demDuoiKhach(ben1.guestSessionId, `SELECT count(*)::text AS n FROM ${bang}`, []),
        `${bang} phải đóng với khách`,
      ).toBe(0);
      // ĐỐI CHỨNG: cùng câu ấy, KHÔNG gắn phiên khách, thấy hàng như thường — nên con số 0 ở
      // trên là do policy khách, không do bảng rỗng.
      const { rows } = await withTenant(apiPool, orgA, (c) =>
        c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${bang}`),
      );
      expect(Number(rows[0]?.n ?? "0"), `${bang} phải CÓ hàng ở đường người mua`).toBeGreaterThan(0);
    }
  });

  it("[khoản nợ 29] MỌI bảng có RLS đều có policy `<bảng>_khach` — không bảng nào bị bỏ quên", async () => {
    // Vế chống-mù. `027` lấp một lượt cho lược đồ hôm nay; thứ làm cho bảng TIẾP THEO phải được
    // quyết định là chính khẳng định này. Suy từ TÍNH CHẤT (`pg_class.relrowsecurity`), không từ
    // một danh sách tên — cùng bài học đã phải học ba lần ở dự án này.
    const { rows } = await db.pool.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = c.oid AND p.polname = c.relname || '_khach')
        ORDER BY c.relname`,
    );
    expect(
      rows.map((h) => h.relname),
      "Bảng có RLS nhưng KHÔNG có policy khách. Nếu khách được đọc nó, viết một policy " +
        "`<bảng>_khach AS RESTRICTIVE` với vị từ đúng; nếu không, vị từ đóng " +
        "`app_current_guest_session_id() IS NULL`. Bỏ qua nghĩa là bảng ấy MỞ TOANG với mọi " +
        "phiên khách — đúng khoảng trống A5.",
    ).toEqual([]);

    // Chống rỗng ruột hai chiều: phép quét phải THẤY một số lượng bảng thật.
    const { rows: tong } = await db.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`,
    );
    expect(Number(tong[0]?.n ?? "0")).toBeGreaterThan(10);
  });

  it("[khoản nợ 29] `withGuestSession` từ chối một GUC KHÔNG có hiệu lực", async () => {
    await expect(
      withGuestSession(apiPool, orgA, "khong-phai-uuid", () => Promise.resolve(1)),
    ).rejects.toThrow(/guestSessionId/u);
  });

  it("[khoản nợ 29] phiên đã THU HỒI không gắn được — và thông điệp không phân biệt hai ca", async () => {
    // Lời mời KHÔNG phải tham số của `withGuestSession`; nó được DẪN XUẤT từ hàng phiên. Ca này
    // đo vế thứ hai của phép dẫn xuất ấy: một phiên đã chết thì không dẫn xuất được gì cả.
    const ben3 = await dungBenKhach(`ba-${randomBytes(3).toString("hex")}`);
    await db.pool.query("UPDATE guest_sessions SET revoked_at = now() WHERE id = $1", [
      ben3.guestSessionId,
    ]);
    await expect(
      withGuestSession(apiPool, orgA, ben3.guestSessionId, (c) => c.query("SELECT 1")),
    ).rejects.toThrow(/thu hồi\/hết hạn/u);

    // ĐỐI CHỨNG DƯƠNG: một phiên KHÔNG bị thu hồi vẫn gắn được — nếu không, khẳng định trên xanh
    // kể cả khi hàm từ chối mọi phiên.
    await expect(
      withGuestSession(apiPool, orgA, ben1.guestSessionId, (c) => c.query("SELECT 1")),
    ).resolves.toBeDefined();
  });

  it("[khoản nợ 29] GUC là LOCAL — không sót lại trên kết nối sau khi transaction đóng", async () => {
    // Nếu nó sót, kết nối kế tiếp lấy từ pool sẽ chạy dưới phiên khách của người trước — và với
    // mặc định TỪ CHỐI của `027`, đường người mua sẽ đọc ra rỗng một cách bí ẩn. Fail-closed,
    // nhưng vẫn là một lỗi, và nó phải không xảy ra.
    await withGuestSession(apiPool, orgA, ben1.guestSessionId, (c) => c.query("SELECT 1"));
    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ v: string | null; w: string | null; x: string | null }>(
        "SELECT pg_catalog.current_setting('app.guest_session_id', true) AS v, " +
          "       pg_catalog.current_setting('app.guest_invitation_id', true) AS w, " +
          "       pg_catalog.current_setting('app.guest_rfq_id', true) AS x",
      ),
    );
    // CẢ BA trục, không chỉ một: `027` so policy với GUC lời mời và GUC gói thầu, nên một GUC
    // còn sót đủ để một kết nối người mua đọc nhầm phạm vi của một khách.
    expect(rows[0]?.v ?? "").toBe("");
    expect(rows[0]?.w ?? "").toBe("");
    expect(rows[0]?.x ?? "").toBe("");
  });
});
