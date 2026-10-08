// ==============================================================================================
// ĐƯỜNG KHÁCH QUA HTTP — S1.3 + S1.4 + S1.5 đi trọn qua một cổng mạng, không gọi thẳng gói nào ở
// phía "nhà cung cấp". Mọi thứ nhà cung cấp làm ở đây là `fetch`; mọi thứ hệ thống làm là route.
//
//   [INV-E2]  token magic link một mình KHÔNG mở được route khách — kể cả nhét vào cookie.
//   [INV-E1]  magic link bị TIÊU THỤ khi phiên ra đời: redeem/otp cùng token sau đó ⇒ 422 (T5 #9).
//   [INV-E6]  mã OTP không xuất hiện trong phản hồi; phiên đi ra bằng Set-Cookie HttpOnly/Secure/Strict.
//   [INV-B2]  biên nhận nhận qua HTTP kiểm chứng được bằng KHOÁ CÔNG KHAI MỘT MÌNH.
//   [INV-B1]  nộp lần hai ⇒ version 2, version 1 vẫn còn.
//   [INV-A5]  khách B không đọc được biên nhận của khách A (404, cùng thân với "không tồn tại").
//   [ADR-017] đường khách KHÔNG chạm `rfq_budgets`: đo bằng phản hồi VÀ bằng SQL dưới phiên khách.
//   [028]     đối chứng: policy đóng của 027 làm `publicKeys` về rỗng; 028 là thứ mở nó.
// ==============================================================================================
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { verifyReceipt } from "@trustprocure/bidding";
import { migrate } from "@trustprocure/db";
import { OTP_RATE_WINDOW_SECONDS, createInvitation, issueMagicLinkToken, revokeGuestSession, revokeInvitation } from "@trustprocure/invitation";
import { cancelRfq } from "@trustprocure/rfq";
import { getRfqPublicKeys, issueRfqKeyPair, sealBid } from "@trustprocure/sealed-envelope";
import { withGuestSession, withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { taoDocDiaChi } from "./dia-chi.js";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_KHACH, GUEST_OTP_VERIFY_MAX_PER_CALLER, GUEST_REDEEM_MAX_PER_CALLER } from "./routes/anon.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const NGAN_SACH = "987654321.00";
const GIA_THAT = JSON.stringify({ unitPrice: 1234567891, currency: "VND" });

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

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let orgA: string;
let uA: string;
let sA: string;
let rfqA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;

interface LoiMoi {
  readonly invitationId: string;
  readonly token: string;
}

async function moi(ten: string, rfqId?: string): Promise<LoiMoi> {
  const duoi = randomBytes(4).toString("hex");
  const ncc = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, ten, uA, sA],
  );
  const lh = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi bao gia', $3, $4, $5, $6) RETURNING id",
    [orgA, ncc.rows[0]?.id, `lh${duoi}@vidu.vn`, `09${duoi}`.replace(/[a-f]/g, "3").slice(0, 10), uA, sA],
  );
  return withTenant(apiPool, orgA, async (c) => {
    const loi = await createInvitation(c, orgA, {
      rfqId: rfqId ?? rfqA,
      supplierId: ncc.rows[0]?.id ?? "",
      contactId: lh.rows[0]?.id ?? "",
      linkChannel: "EMAIL",
      actorSessionId: sA,
    }, apiPool);
    const t = await issueMagicLinkToken(c, orgA, { invitationId: loi.id, actorSessionId: sA });
    return { invitationId: loi.id, token: t.token };
  });
}

interface PhanHoi {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

// [sổ nợ 52] Mỗi test một địa chỉ người gọi (qua X-Forwarded-For, socket 127.0.0.1 khai là proxy), để
// trần theo người gọi của hai route khách không rơi từ test này sang test khác — cùng khuôn auth.int.
let soIp = 0;
let ipHienTai = "203.0.113.1";
beforeEach(() => {
  soIp += 1;
  ipHienTai = `203.0.${Math.floor(soIp / 250)}.${(soIp % 250) + 1}`;
});

async function goi(method: string, path: string, tuyChon: { cookie?: string; body?: unknown; ip?: string } = {}): Promise<PhanHoi> {
  const headers: Record<string, string> = { "x-forwarded-for": tuyChon.ip ?? ipHienTai };
  if (tuyChon.cookie !== undefined) headers.cookie = tuyChon.cookie;
  let body: string | undefined;
  if (tuyChon.body !== undefined) {
    body = JSON.stringify(tuyChon.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${goc}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

/** Đi trọn ba bước vô danh, trả về cookie phiên khách. */
async function moPhienKhach(lm: LoiMoi): Promise<string> {
  const r1 = await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: lm.token } });
  expect(r1.status, r1.text).toBe(200);
  const r2 = await goi("POST", "/guest/otp", { body: { orgId: orgA, token: lm.token, channel: "SMS" } });
  expect(r2.status, r2.text).toBe(200);
  const ma = dv.otpDaGui.at(-1)?.code ?? "";
  const r3 = await goi("POST", "/guest/otp/verify", { body: { orgId: orgA, token: lm.token, code: ma } });
  expect(r3.status, r3.text).toBe(200);
  const sc = r3.headers.get("set-cookie") ?? "";
  const gt = /tp_guest=([^;]+)/u.exec(sc)?.[1] ?? "";
  expect(gt).not.toBe("");
  return `${COOKIE_PHIEN_KHACH}=${gt}`;
}

async function guestSessionIdCua(invitationId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "SELECT id FROM guest_sessions WHERE invitation_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [invitationId],
  );
  return rows[0]?.id ?? "";
}

/**
 * [S1.142 / khoản 241] Sàn một chữ ký (`068`): mọi gói cần một chữ ký của người KHÁC người tạo, trên
 * nội dung hiện tại, trước khi mở. Mỗi tổ chức một người ký riêng, không vai trò:
 * `rfq_kiem_nguoi_duyet` chỉ đòi người ký khác người tạo và phiên thuộc về chính họ.
 */
const NGUOI_KY = new Map<string, { readonly u: string; readonly s: string }>();
async function kyMotChuKy(orgId: string, rfqId: string): Promise<void> {
  let k = NGUOI_KY.get(orgId);
  if (k === undefined) {
    const { rows: nd } = await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi ky') RETURNING id",
      [orgId, `nguoi-ky-${orgId}@vidu.vn`],
    );
    const u = nd[0]?.id ?? "";
    const { rows: ph } = await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
        "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgId, u, randomBytes(32)],
    );
    k = { u, s: ph[0]?.id ?? "" };
    NGUOI_KY.set(orgId, k);
  }
  await db.pool.query(
    "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)",
    [orgId, rfqId, k.u, k.s],
  );
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  uA = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'ua@vidu.vn', 'Nguoi mua') RETURNING id", [orgA])).rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER')", [orgA, uA]);
  sA = (await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, uA, randomBytes(32)],
  )).rows[0]?.id ?? "";
  const csA = (await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
      "VALUES ($1, 1, '10000000000.00', 'VND', $2, $3) RETURNING id",
    [orgA, uA, sA],
  )).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");

  // RFQ OPEN có khoá — cùng công thức `dungBoiCanh` của bidding.int.test.ts.
  rfqA = (await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
      "VALUES ($1, 'Mua thep tam', now() + interval '7 days', false, $2, $3) RETURNING id",
    [orgA, uA, sA],
  )).rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 1, 'Thep tam SS400', '100.0000', 'tam', $3, $4)",
    [orgA, rfqA, uA, sA],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, $3, 'VND', $4, $5, $6)",
    [orgA, rfqA, NGAN_SACH, csA, uA, sA],
  );
  await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfqA, uA, sA]);
  await kyMotChuKy(orgA, rfqA);
  await withTenant(apiPool, orgA, async (c) => {
    await issueRfqKeyPair(c, orgA, { rfqId: rfqA, actorSessionId: sA, orgKeys: boBocTest });
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqA, uA, sA]);
  });

  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }), { remoteAddressOf: taoDocDiaChi(["127.0.0.1"]) });
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect([orgA, uA, sA, csA, rfqA].filter((x) => x === "")).toEqual([]);
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("ba bước vô danh: redeem → OTP → verify", () => {
  it("[INV-E6] redeem cho biết kênh; OTP KHÔNG về client, chỉ tới bộ gửi; phiên đi ra bằng cookie HttpOnly/Secure/Strict", async () => {
    const lm = await moi("NCC E6");
    const r1 = await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: lm.token } });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ invitationId: lm.invitationId, linkChannel: "EMAIL" });
    expect((r1.body as { otpChannels: string[] }).otpChannels).not.toContain("EMAIL");
    expect(r1.text).not.toContain("contactId");

    const truoc = dv.otpDaGui.length;
    const r2 = await goi("POST", "/guest/otp", { body: { orgId: orgA, token: lm.token, channel: "SMS" } });
    expect(r2.status, r2.text).toBe(200);
    expect(dv.otpDaGui).toHaveLength(truoc + 1);
    const gui = dv.otpDaGui.at(-1)!;
    expect(gui.code).toMatch(/^\d{6}$/u);
    expect(r2.text, "mã OTP lọt vào phản hồi").not.toContain(gui.code);
    expect(r2.text, "số điện thoại lọt vào phản hồi").not.toContain(gui.destination);

    const sai = await goi("POST", "/guest/otp/verify", { body: { orgId: orgA, token: lm.token, code: "000000" } });
    expect(sai.status).toBe(401);
    expect(sai.headers.get("set-cookie")).toBeNull();

    const dung = await goi("POST", "/guest/otp/verify", { body: { orgId: orgA, token: lm.token, code: gui.code } });
    expect(dung.status, dung.text).toBe(200);
    const sc = dung.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/^__Host-tp_guest=[0-9a-f-]{36}\.[A-Za-z0-9_-]{32,}/u);
    // [sổ nợ 42] `__Host-` đòi `Path=/` và không `Domain`; cookie khách rời `Path=/guest`.
    for (const thuocTinh of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/;"]) expect(sc).toContain(thuocTinh);
    expect(sc).not.toMatch(/domain=/iu);
    // Token phiên không nằm ở đâu ngoài Set-Cookie.
    const tokenPhien = /tp_guest=[0-9a-f-]{36}\.([^;]+)/u.exec(sc)?.[1] ?? "";
    expect(dung.text).not.toContain(tokenPhien);
  });

  it("[INV-E2] token magic link MỘT MÌNH không mở được route khách — kể cả khi nhét vào cookie", async () => {
    const lm = await moi("NCC E2");
    expect((await goi("GET", "/guest/rfq")).status).toBe(401);
    expect((await goi("GET", "/guest/rfq", { cookie: `${COOKIE_PHIEN_KHACH}=${orgA}.${lm.token}` })).status).toBe(401);
    // Đối chứng dương: đi đủ ba bước thì mở được.
    const ck = await moPhienKhach(lm);
    expect((await goi("GET", "/guest/rfq", { cookie: ck })).status).toBe(200);
  });

  it("[INV-E1] magic link bị TIÊU THỤ khi phiên ra đời: redeem và otp cùng token sau đó ⇒ 422 (T5 #9)", async () => {
    const lm = await moi("NCC E1");
    await moPhienKhach(lm);
    const r = await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: lm.token } });
    expect(r.status).toBe(422);
    const o = await goi("POST", "/guest/otp", { body: { orgId: orgA, token: lm.token, channel: "SMS" } });
    expect(o.status).toBe(422);
  });

  it("thiếu orgId ⇒ 422; orgId lạ với token thật ⇒ 422 (RLS lọc, không oracle về tổ chức)", async () => {
    const lm = await moi("NCC org");
    expect((await goi("POST", "/guest/redeem", { body: { token: lm.token } })).status).toBe(422);
    const la = await goi("POST", "/guest/redeem", { body: { orgId: "00000000-0000-4000-8000-000000000000", token: lm.token } });
    expect(la.status).toBe(422);
  });
});

/**
 * [S1.15] Cùng cái bẫy đã đo ở `auth.int.test.ts` (xem khối `choDuCuaSo` ở đó, và commit `13b418f`):
 * cửa sổ hạn mức làm tròn theo EPOCH, nên mọi bộ đếm về 0 cùng lúc ở những mốc biết trước, và một
 * vòng đếm vắt qua ranh giới thấy 422 ở đúng chỗ nó chờ 429. Khối dưới đây đếm 30 + 30 lời gọi, tức
 * phơi ra cùng cơ chế với xác suất nhỏ hơn (~1 giây trên 900). Bản sao năm dòng thay vì một hàm
 * dùng chung là có chủ đích: đưa nó vào `@trustprocure/test-support` sẽ kéo gói ấy phụ thuộc
 * `@trustprocure/invitation` chỉ vì một hằng số.
 */
const CAN_CUA_SO_MS = 45_000;
const choDuCuaSo = async (): Promise<void> => {
  const cuaSoMs = OTP_RATE_WINDOW_SECONDS * 1000;
  const conLai = cuaSoMs - (Date.now() % cuaSoMs);
  if (conLai < CAN_CUA_SO_MS) await new Promise((xong) => setTimeout(xong, conLai + 100));
};

describe("[sổ nợ 52] hạn mức theo NGƯỜI GỌI trên hai route khách", () => {
  beforeEach(choDuCuaSo);

  it("/guest/redeem: token SAI N lần ⇒ 422, lần N+1 ⇒ 429 + Retry-After; địa chỉ khác vẫn 422; /guest/otp/verify cùng khuôn", async () => {
    const rac = "A".repeat(43);
    for (let i = 0; i < GUEST_REDEEM_MAX_PER_CALLER; i += 1) {
      expect((await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: rac } })).status, `lần ${i + 1}`).toBe(422);
    }
    const chan = await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: rac } });
    expect(chan.status).toBe(429);
    expect(chan.headers.get("retry-after")).toBe("900");
    expect((await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: rac }, ip: "198.51.100.52" })).status).toBe(422);
    // Bucket của redeem KHÔNG chạm verify: verify từ cùng địa chỉ vẫn đếm từ đầu.
    for (let i = 0; i < GUEST_OTP_VERIFY_MAX_PER_CALLER; i += 1) {
      expect((await goi("POST", "/guest/otp/verify", { body: { orgId: orgA, token: rac, code: "000000" } })).status, `verify lần ${i + 1}`).toBe(422);
    }
    expect((await goi("POST", "/guest/otp/verify", { body: { orgId: orgA, token: rac, code: "000000" } })).status).toBe(429);
    // Một khách THẬT từ địa chỉ khác không bị ảnh hưởng.
    const lm = await moi("NCC hạn mức");
    expect((await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: lm.token }, ip: "198.51.100.53" })).status).toBe(200);
  });
});

describe("gói thầu và báo giá của khách", () => {
  it("[ADR-017] GET /guest/rfq: hạng mục + khoá CÔNG KHAI, và KHÔNG một dấu vết ngân sách — đo bằng phản hồi lẫn SQL", async () => {
    const lm = await moi("NCC rfq");
    const ck = await moPhienKhach(lm);
    const r = await goi("GET", "/guest/rfq", { cookie: ck });
    expect(r.status, r.text).toBe(200);
    const b = r.body as { rfq: { id: string; status: string }; items: unknown[]; publicKeys: { algorithm: string; publicKey: string }[] };
    expect(b.rfq.id).toBe(rfqA);
    expect(b.rfq.status).toBe("OPEN");
    expect(b.items).toHaveLength(1);
    expect(b.publicKeys.map((k) => k.algorithm)).toContain("ECDH_P256");
    expect(r.text).not.toContain("987654321");
    expect(r.text).not.toContain("estimated");
    expect(r.text).not.toContain("createdBy");

    // Vế SQL: dưới CHÍNH phiên khách ấy, `rfq_budgets` trả 0 hàng dù ngân sách tồn tại.
    const gs = await guestSessionIdCua(lm.invitationId);
    const n = await withGuestSession(apiPool, orgA, gs, async (c) =>
      Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM rfq_budgets")).rows[0]?.n ?? "-1"),
    );
    expect(n).toBe(0);
    const thatSu = await db.pool.query("SELECT 1 FROM rfq_budgets WHERE rfq_id = $1", [rfqA]);
    expect(thatSu.rows).toHaveLength(1);
  });

  it("[S1.165 / khoản 225] GET /guest/rfq: `cancelReason` là `null` khi gói còn sống, và là ĐÚNG câu người huỷ viết khi gói đã huỷ", async () => {
    // Gói riêng — huỷ `rfqA` sẽ làm đổ mọi test khác của tệp. Cùng công thức `beforeAll`.
    const { rows: g } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Goi se bi huy', now() + interval '7 days', false, $2, $3) RETURNING id",
      [orgA, uA, sA],
    );
    const rfqHuy = g[0]?.id ?? "";
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 1, 'Ong thep', '10.0000', 'ong', $3, $4)",
      [orgA, rfqHuy, uA, sA],
    );
    const { rows: cs } = await db.pool.query<{ id: string }>(
      "SELECT id FROM org_procurement_policies WHERE org_id = $1 ORDER BY version DESC LIMIT 1",
      [orgA],
    );
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
      [orgA, rfqHuy, cs[0]?.id, uA, sA],
    );
    await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfqHuy, uA, sA]);
    await kyMotChuKy(orgA, rfqHuy);
    await withTenant(apiPool, orgA, async (c) => {
      await issueRfqKeyPair(c, orgA, { rfqId: rfqHuy, actorSessionId: sA, orgKeys: boBocTest });
      await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqHuy, uA, sA]);
    });

    const ck = await moPhienKhach(await moi("NCC goi bi huy", rfqHuy));
    const truoc = await goi("GET", "/guest/rfq", { cookie: ck });
    expect(truoc.status, truoc.text).toBe(200);
    expect((truoc.body as { rfq: { status: string; cancelReason: unknown } }).rfq).toMatchObject({ status: "OPEN", cancelReason: null });

    const LY_DO = "Bao gia lech don vi tien; goi thau se moi lai tuan sau";
    await withTenant(apiPool, orgA, (c) => cancelRfq(c, orgA, { rfqId: rfqHuy, reason: LY_DO, actorSessionId: sA }, auditPool));

    const sau = await goi("GET", "/guest/rfq", { cookie: ck });
    expect(sau.status, sau.text).toBe(200);
    expect((sau.body as { rfq: { status: string; cancelReason: unknown } }).rfq).toMatchObject({ status: "CANCELLED", cancelReason: LY_DO });

    // Đối chứng: gói `rfqA` còn sống, cùng route, trả `null` — trường không rò lý do của gói khác.
    const khac = await goi("GET", "/guest/rfq", { cookie: await moPhienKhach(await moi("NCC goi song")) });
    expect((khac.body as { rfq: { cancelReason: unknown } }).rfq.cancelReason).toBeNull();
  });

  it("[028] ĐỐI CHỨNG: dưới policy đóng của 027, cùng đường trả publicKeys RỖNG; khôi phục 028 thì có khoá", async () => {
    const lm = await moi("NCC 028");
    const ck = await moPhienKhach(lm);
    const dong =
      "CREATE POLICY rfq_key_material_khach ON rfq_key_material AS RESTRICTIVE " +
      "USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL) " +
      "WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)";
    const mo =
      "CREATE POLICY rfq_key_material_khach ON rfq_key_material AS RESTRICTIVE " +
      "USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL " +
      "  OR rfq_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid) " +
      "WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)";
    await db.pool.query("DROP POLICY rfq_key_material_khach ON rfq_key_material");
    await db.pool.query(dong);
    try {
      const r = await goi("GET", "/guest/rfq", { cookie: ck });
      expect(r.status).toBe(200);
      expect((r.body as { publicKeys: unknown[] }).publicKeys).toEqual([]);
    } finally {
      await db.pool.query("DROP POLICY rfq_key_material_khach ON rfq_key_material");
      await db.pool.query(mo);
    }
    const sau = await goi("GET", "/guest/rfq", { cookie: ck });
    expect((sau.body as { publicKeys: unknown[] }).publicKeys.length).toBeGreaterThan(0);
    // Và một phiên khách vẫn KHÔNG ghi được vào bảng khoá — WITH CHECK hẹp hơn USING.
    // Vế "WITH CHECK hẹp hơn USING" KHÔNG đo được bằng một câu ghi: mọi INSERT/UPDATE vào bảng này
    // bị trigger của 017 (C5, thu hồi đơn điệu) chặn TRƯỚC khi RLS kịp nhìn — đo được hai lần, hai
    // thông điệp trigger khác nhau. Nên đo trên CATALOG: vị từ WITH CHECK của policy phải là vị từ
    // ĐÓNG (không nhắc `guest_rfq_id`), và vị từ USING phải là vị từ MỞ theo `guest_rfq_id`.
    const { rows: pol } = await db.pool.query<{ using_: string; check_: string; permissive: string }>(
      "SELECT pg_get_expr(p.polqual, p.polrelid) AS using_, pg_get_expr(p.polwithcheck, p.polrelid) AS check_, p.polpermissive::text AS permissive " +
        "  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = 'rfq_key_material' AND p.polname = 'rfq_key_material_khach'",
    );
    expect(pol).toHaveLength(1);
    expect(pol[0]?.permissive).toBe("false");
    expect(pol[0]?.using_).toContain("guest_rfq_id");
    expect(pol[0]?.check_).not.toContain("guest_rfq_id");
    expect(pol[0]?.check_).toContain("IS NULL");
  });

  it("[INV-B2] [INV-B1] nộp qua HTTP: biên nhận kiểm chứng bằng khoá công khai MỘT MÌNH; nộp lại ⇒ version 2, version 1 còn", async () => {
    const lm = await moi("NCC bid");
    const ck = await moPhienKhach(lm);
    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqA));
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256")!;
    const niemPhong = async (banRo: string) =>
      Buffer.from(
        await sealBid({ rfqId: rfqA, algorithm: "ECDH_P256", recipientPublicKey: p256.publicKey, plaintext: new TextEncoder().encode(banRo) }),
      ).toString("base64");

    const r1 = await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: await niemPhong(GIA_THAT) } });
    expect(r1.status, r1.text).toBe(201);
    const bn = (r1.body as { receipt: { bidVersionId: string; version: number; canonicalText: string; signature: string } }).receipt;
    expect(bn.version).toBe(1);
    expect(r1.text, "giá dạng rõ lọt vào phản hồi nộp thầu").not.toContain("1234567891");
    await expect(
      verifyReceipt({ canonicalText: bn.canonicalText, signature: new Uint8Array(Buffer.from(bn.signature, "base64")), publicKey: dv.khoaKy.publicKey }),
    ).resolves.toBe(true);

    const r2 = await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: await niemPhong(JSON.stringify({ unitPrice: 1200000000 })) } });
    expect(r2.status, r2.text).toBe(201);
    expect((r2.body as { receipt: { version: number } }).receipt.version).toBe(2);

    const ds = await goi("GET", "/guest/bids", { cookie: ck });
    expect(ds.status).toBe(200);
    const bids = (ds.body as { bids: { versions: { version: number; bidVersionId: string }[] }[] }).bids;
    expect(bids).toHaveLength(1);
    expect(bids[0]?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(ds.text).not.toContain("envelope");

    const rc = await goi("GET", `/guest/bids/${bn.bidVersionId}/receipt`, { cookie: ck });
    expect(rc.status).toBe(200);
    expect((rc.body as { canonicalText: string }).canonicalText).toBe(bn.canonicalText);

    expect((await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: "khong-phai-base64!" } })).status).toBe(422);
  });

  // ============================================================================================
  // [khoản 196 / ADR-074 phần 2 và 3] GIỜ MÁY CHỦ ĐI TỚI NHÀ CUNG CẤP — TRƯỚC khi nộp, và KHI bị chặn.
  //
  // ⑴ `GET /guest/rfq` mang `gioMayChu`: đồng hồ của CSDL — nguồn mà C1 phán xử — ở dạng chính tắc
  //    của biên nhận. Trang nộp thầu đếm ngược theo độ lệch giữa giá trị này và đồng hồ máy người
  //    dùng, không theo đồng hồ máy người dùng trần.
  // ⑵ Lần nộp bị chặn VÌ HẠN ra 422 mang `gioPhanXu` (now() của giao dịch đã phán xử) và `hanNop`
  //    (deadline_at đã so), và giao dịch ấy COMMIT: hàng `BID_DEADLINE_DENIED` nằm lại trong sổ.
  // ============================================================================================
  it("[khoản 196] GET /guest/rfq mang gioMayChu — đồng hồ CSDL ở dạng chính tắc, lệch đồng hồ CSDL không quá vài giây", async () => {
    const lm = await moi("NCC gio may chu");
    const ck = await moPhienKhach(lm);
    const r = await goi("GET", "/guest/rfq", { cookie: ck });
    expect(r.status, r.text).toBe(200);
    const gio = (r.body as { gioMayChu?: unknown }).gioMayChu;
    expect(typeof gio, "thiếu gioMayChu").toBe("string");
    expect(gio).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    const { rows } = await db.pool.query<{ ms: number }>(
      "SELECT abs(extract(epoch FROM (clock_timestamp() - $1::timestamptz)) * 1000)::float8 AS ms",
      [gio],
    );
    expect(rows[0]?.ms).toBeLessThan(5000);
  });

  it("[khoản 196] nộp sau hạn qua HTTP ⇒ 422 mang gioPhanXu và hanNop; giao dịch commit nên hàng BID_DEADLINE_DENIED nằm lại", async () => {
    // Cùng công thức RFQ OPEN của `beforeAll`, trên một gói RIÊNG — gói chung `rfqA` phải còn hạn cho các ca khác.
    const rfqTre = (await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Goi tre', now() + interval '7 days', false, $2, $3) RETURNING id",
      [orgA, uA, sA],
    )).rows[0]?.id ?? "";
    expect(rfqTre).not.toBe("");
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 1, 'Thep tam SS400', '100.0000', 'tam', $3, $4)",
      [orgA, rfqTre, uA, sA],
    );
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
        "SELECT $1, $2, $3, 'VND', id, $4, $5 FROM org_procurement_policies WHERE org_id = $1 AND version = 1",
      [orgA, rfqTre, NGAN_SACH, uA, sA],
    );
    await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfqTre, uA, sA]);
    await kyMotChuKy(orgA, rfqTre);
    await withTenant(apiPool, orgA, async (c) => {
      await issueRfqKeyPair(c, orgA, { rfqId: rfqTre, actorSessionId: sA, orgKeys: boBocTest });
      await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqTre, uA, sA]);
    });
    const lm = await moi("NCC tre", rfqTre);
    const ck = await moPhienKhach(lm);
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_gia_han_khong_hoi_sinh; ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    try {
      await db.pool.query("UPDATE rfq_packages SET deadline_at = now() - interval '1 minute' WHERE id = $1", [rfqTre]);
    } finally {
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_gia_han_khong_hoi_sinh; ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    }
    const han = (await db.pool.query<{ t: string }>("SELECT public.bid_dau_thoi_gian_chinh_tac(deadline_at) AS t FROM rfq_packages WHERE id = $1", [rfqTre])).rows[0]?.t;
    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqTre));
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256")!;
    const pb = Buffer.from(
      await sealBid({ rfqId: rfqTre, algorithm: "ECDH_P256", recipientPublicKey: p256.publicKey, plaintext: new TextEncoder().encode("gia tre") }),
    ).toString("base64");

    const r = await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: pb } });
    expect(r.status, r.text).toBe(422);
    const b = r.body as { error?: unknown; gioPhanXu?: unknown; hanNop?: unknown };
    expect(typeof b.error).toBe("string");
    expect(b.hanNop, "deadline_at đã so").toBe(han);
    expect(typeof b.gioPhanXu).toBe("string");
    expect(String(b.gioPhanXu) >= String(han), "giờ phán xử không trước hạn").toBe(true);

    const { rows } = await db.pool.query<{ payload: { gioCsdl?: string; hanNop?: string } }>(
      "SELECT payload FROM audit_events WHERE action = 'BID_DEADLINE_DENIED' AND resource_id = $1",
      [rfqTre],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ gioCsdl: b.gioPhanXu, hanNop: han });
  });

  it("[INV-A5] khách B không thấy báo giá lẫn biên nhận của khách A — và 404 ấy trùng thân với 'không tồn tại'", async () => {
    const a = await moi("NCC A");
    const b = await moi("NCC B");
    const ckA = await moPhienKhach(a);
    const ckB = await moPhienKhach(b);
    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqA));
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256")!;
    const pb = Buffer.from(
      await sealBid({ rfqId: rfqA, algorithm: "ECDH_P256", recipientPublicKey: p256.publicKey, plaintext: new TextEncoder().encode("gia cua A") }),
    ).toString("base64");
    const r = await goi("POST", "/guest/bids", { cookie: ckA, body: { envelope: pb } });
    expect(r.status).toBe(201);
    const idA = (r.body as { receipt: { bidVersionId: string } }).receipt.bidVersionId;

    const dsB = await goi("GET", "/guest/bids", { cookie: ckB });
    expect((dsB.body as { bids: unknown[] }).bids).toEqual([]);
    const rcB = await goi("GET", `/guest/bids/${idA}/receipt`, { cookie: ckB });
    expect(rcB.status).toBe(404);
    const khongCo = await goi("GET", "/guest/bids/00000000-0000-4000-8000-000000000000/receipt", { cookie: ckB });
    expect(khongCo.status).toBe(404);
    expect(rcB.text).toBe(khongCo.text);
    // Đối chứng dương: A đọc được của A.
    expect((await goi("GET", `/guest/bids/${idA}/receipt`, { cookie: ckA })).status).toBe(200);
  });
});

// ==============================================================================================
// [S1.181 / ADR-109] Phiên khách nói tên doanh nghiệp được mời; nhà cung cấp tự thoát phiên của mình.
// ==============================================================================================
describe("[S1.181 / ADR-109] tên nhà cung cấp được mời, và POST /guest/logout", () => {
  it("GET /guest/rfq mang tên pháp lý của CHÍNH nhà cung cấp được mời — hai nhà cung cấp cùng một gói thấy hai tên, không thấy tên nhau", async () => {
    const a = await moi("Cong ty Thep Hoa Phat Mien Bac");
    const b = await moi("Cong ty Co khi Tan Binh");
    const ckA = await moPhienKhach(a);
    const ckB = await moPhienKhach(b);
    const rA = await goi("GET", "/guest/rfq", { cookie: ckA });
    const rB = await goi("GET", "/guest/rfq", { cookie: ckB });
    expect(rA.status, rA.text).toBe(200);
    expect(rB.status, rB.text).toBe(200);
    expect((rA.body as { supplier: unknown }).supplier).toEqual({ legalName: "Cong ty Thep Hoa Phat Mien Bac" });
    expect((rB.body as { supplier: unknown }).supplier).toEqual({ legalName: "Cong ty Co khi Tan Binh" });
    // Cùng một gói: tên gói không phân biệt được hai phiên, tên doanh nghiệp thì có.
    expect((rA.body as { rfq: { title: string } }).rfq.title).toBe((rB.body as { rfq: { title: string } }).rfq.title);
    expect(rA.text).not.toContain("Tan Binh");
    expect(rB.text).not.toContain("Hoa Phat");
    // `supplier` mang ĐÚNG một trường: không mã nhà cung cấp, không MST, không người liên hệ.
    const { rows } = await db.pool.query<{ supplier_id: string; contact_id: string }>(
      "SELECT supplier_id, contact_id FROM rfq_invitations WHERE id = $1",
      [a.invitationId],
    );
    expect(rA.text).not.toContain(rows[0]?.supplier_id ?? "(thieu)");
    expect(rA.text).not.toContain(rows[0]?.contact_id ?? "(thieu)");
    expect(rA.text).not.toContain("Nguoi bao gia");
  });

  it("GET /guest/rfq đọc tên LÚC GỌI: bên mua sửa tên nhà cung cấp thì phiên đang sống thấy tên mới", async () => {
    const a = await moi("Ten cu cua nha cung cap");
    const ck = await moPhienKhach(a);
    const { rows } = await db.pool.query<{ supplier_id: string }>("SELECT supplier_id FROM rfq_invitations WHERE id = $1", [a.invitationId]);
    await db.pool.query("UPDATE suppliers SET legal_name = 'Ten moi cua nha cung cap' WHERE id = $1", [rows[0]?.supplier_id]);
    const r = await goi("GET", "/guest/rfq", { cookie: ck });
    expect((r.body as { supplier: unknown }).supplier).toEqual({ legalName: "Ten moi cua nha cung cap" });
  });

  it("POST /guest/logout: 200, xoá cookie cùng bộ thuộc tính, phiên chết ngay; lời mời KHÔNG bị thu hồi; một hàng sổ mang người liên hệ đã xác minh", async () => {
    const a = await moi("NCC thoat");
    const ck = await moPhienKhach(a);
    const gs = await guestSessionIdCua(a.invitationId);
    expect((await goi("GET", "/guest/rfq", { cookie: ck })).status).toBe(200);

    const r = await goi("POST", "/guest/logout", { cookie: ck });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/^__Host-tp_guest=;/u);
    for (const thuocTinh of ["Max-Age=0", "HttpOnly", "Secure", "SameSite=Strict", "Path=/;"]) expect(sc).toContain(thuocTinh);
    expect(sc).not.toMatch(/domain=/iu);

    // Cookie cũ không mở được gì nữa — cả đường đọc lẫn đường ghi.
    expect((await goi("GET", "/guest/rfq", { cookie: ck })).status).toBe(401);
    expect((await goi("GET", "/guest/bids", { cookie: ck })).status).toBe(401);
    expect((await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: "AAAA" } })).status).toBe(401);

    const { rows: phien } = await db.pool.query<{ revoked_at: Date | null; verified_contact_id: string }>(
      "SELECT revoked_at, verified_contact_id FROM guest_sessions WHERE id = $1",
      [gs],
    );
    expect(phien[0]?.revoked_at).not.toBeNull();
    const { rows: loiMoi } = await db.pool.query<{ status: string; revoked_at: Date | null }>(
      "SELECT status, revoked_at FROM rfq_invitations WHERE id = $1",
      [a.invitationId],
    );
    expect(loiMoi[0]?.status, "thoát phiên không phải thu hồi lời mời").not.toBe("REVOKED");
    expect(loiMoi[0]?.revoked_at).toBeNull();

    const { rows: so } = await db.pool.query<{ actor_type: string; actor_id: string; resource_type: string; payload: unknown }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events WHERE action = 'GUEST_SESSION_REVOKED' AND resource_id = $1",
      [gs],
    );
    expect(so).toEqual([
      { actor_type: "SUPPLIER", actor_id: phien[0]?.verified_contact_id, resource_type: "guest_session", payload: { invitationId: a.invitationId } },
    ]);

    // Lần thoát thứ hai với cookie đã chết: 401 ở bước xác thực, KHÔNG thêm hàng sổ.
    expect((await goi("POST", "/guest/logout", { cookie: ck })).status).toBe(401);
    const { rows: dem } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE action = 'GUEST_SESSION_REVOKED' AND resource_id = $1",
      [gs],
    );
    expect(dem[0]?.n).toBe("1");
  });

  it("[ADR-110] thoát rồi quay lại bằng link bên mua GỬI LẠI qua HTTP: đúng lời mời, thấy lại báo giá đã nộp, lần nộp kế là phiên bản 2 của CÙNG luồng", async () => {
    const a = await moi("NCC quay lai");
    const ck1 = await moPhienKhach(a);
    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqA));
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256")!;
    const niemPhong = async (banRo: string) =>
      Buffer.from(
        await sealBid({ rfqId: rfqA, algorithm: "ECDH_P256", recipientPublicKey: p256.publicKey, plaintext: new TextEncoder().encode(banRo) }),
      ).toString("base64");
    const r1 = await goi("POST", "/guest/bids", { cookie: ck1, body: { envelope: await niemPhong(GIA_THAT) } });
    expect(r1.status, r1.text).toBe(201);
    const v1 = (r1.body as { receipt: { bidVersionId: string; version: number } }).receipt;
    expect(v1.version).toBe(1);
    expect((await goi("POST", "/guest/logout", { cookie: ck1 })).status).toBe(200);

    // Bên mua gửi lại link qua HTTP, bằng một phiên đăng nhập thật của người mua (PROCUREMENT_MANAGER giữ rfq.invite).
    const tokenMua = randomBytes(32).toString("base64url");
    await db.pool.query(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
      [orgA, uA, createHash("sha256").update(tokenMua, "utf8").digest()],
    );
    const truoc = dv.loiMoiDaGui.length;
    const gl = await goi("POST", `/invitations/${a.invitationId}/reissue`, { cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${tokenMua}` });
    expect(gl.status, gl.text).toBe(200);
    expect(dv.loiMoiDaGui).toHaveLength(truoc + 1);
    const lai = dv.loiMoiDaGui.at(-1)!;
    expect(lai.invitationId).toBe(a.invitationId);

    const ck2 = await moPhienKhach({ invitationId: a.invitationId, token: lai.token });
    const ds = await goi("GET", "/guest/bids", { cookie: ck2 });
    expect(ds.status).toBe(200);
    const bids = (ds.body as { bids: { versions: { version: number; bidVersionId: string }[] }[] }).bids;
    expect(bids, "phiên mới thấy lại ĐÚNG hồ sơ báo giá đã nộp").toHaveLength(1);
    expect(bids[0]?.versions.map((v) => v.bidVersionId)).toEqual([v1.bidVersionId]);
    const r2 = await goi("POST", "/guest/bids", { cookie: ck2, body: { envelope: await niemPhong(JSON.stringify({ unitPrice: 1100000000 })) } });
    expect(r2.status, r2.text).toBe(201);
    expect((r2.body as { receipt: { version: number } }).receipt.version).toBe(2);
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM vendor_bids WHERE invitation_id = $1", [a.invitationId]);
    expect(rows[0]!.n, "một lời mời, một luồng báo giá").toBe(1);
  });

  it("POST /guest/logout chạm ĐÚNG phiên đang gọi: phiên khác của CÙNG lời mời và phiên của nhà cung cấp khác vẫn sống", async () => {
    const a = await moi("NCC hai phien");
    const b = await moi("NCC ben canh");
    const ckA1 = await moPhienKhach(a);
    // Bên mua gửi lại link cho CÙNG lời mời (mã đầu đã tiêu thụ) ⇒ phiên thứ hai của lời mời ấy.
    const t2 = await withTenant(apiPool, orgA, (c) => issueMagicLinkToken(c, orgA, { invitationId: a.invitationId, actorSessionId: sA }));
    const ckA2 = await moPhienKhach({ invitationId: a.invitationId, token: t2.token });
    const ckB = await moPhienKhach(b);
    expect(ckA1).not.toBe(ckA2);

    expect((await goi("POST", "/guest/logout", { cookie: ckA1 })).status).toBe(200);
    expect((await goi("GET", "/guest/rfq", { cookie: ckA1 })).status).toBe(401);
    expect((await goi("GET", "/guest/rfq", { cookie: ckA2 })).status, "phiên thứ hai của cùng lời mời không bị thoát theo").toBe(200);
    expect((await goi("GET", "/guest/rfq", { cookie: ckB })).status, "phiên của nhà cung cấp khác không bị thoát theo").toBe(200);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM guest_sessions WHERE invitation_id = $1 AND revoked_at IS NOT NULL",
      [a.invitationId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("POST /guest/logout không cookie, cookie sai hình dạng hay magic link nhét vào cookie ⇒ 401, không Set-Cookie, không hàng sổ", async () => {
    const a = await moi("NCC thoat 401");
    const truoc = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE action = 'GUEST_SESSION_REVOKED'");
    for (const cookie of [undefined, `${COOKIE_PHIEN_KHACH}=rac`, `${COOKIE_PHIEN_KHACH}=${orgA}.${a.token}`]) {
      const r = await goi("POST", "/guest/logout", cookie === undefined ? {} : { cookie });
      expect(r.status, String(cookie)).toBe(401);
      expect(r.headers.get("set-cookie"), String(cookie)).toBeNull();
    }
    const sau = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE action = 'GUEST_SESSION_REVOKED'");
    expect(sau.rows[0]?.n).toBe(truoc.rows[0]?.n);
  });

  it("[lượt soi] POST /guest/logout KHÔNG chạm lời mời, link khác đang chờ hay thách thức OTP đang mở: ba bảng y như trước, link thứ hai vẫn xác minh được", async () => {
    const a = await moi("NCC thoat khong cham");
    const ck = await moPhienKhach(a);
    // Link thứ hai của CÙNG lời mời đang chờ: đã đổi và đã xin OTP, chưa xác minh.
    const t2 = await withTenant(apiPool, orgA, (c) => issueMagicLinkToken(c, orgA, { invitationId: a.invitationId, actorSessionId: sA }));
    expect((await goi("POST", "/guest/redeem", { body: { orgId: orgA, token: t2.token } })).status).toBe(200);
    expect((await goi("POST", "/guest/otp", { body: { orgId: orgA, token: t2.token, channel: "SMS" } })).status).toBe(200);
    const ma = dv.otpDaGui.at(-1)?.code ?? "";
    const chup = async () => ({
      loiMoi: (await db.pool.query("SELECT status, revoked_at, revoked_by FROM rfq_invitations WHERE id = $1", [a.invitationId])).rows,
      token: (await db.pool.query("SELECT id, revoked_at, consumed_at FROM rfq_invitation_tokens WHERE invitation_id = $1 ORDER BY created_at", [a.invitationId])).rows,
      otp: (await db.pool.query(
        "SELECT id, consumed_at, failed_attempts, locked_until FROM invitation_otp_challenges WHERE invitation_id = $1 ORDER BY created_at",
        [a.invitationId],
      )).rows,
    });
    const truoc = await chup();
    expect(truoc.token.filter((t: { consumed_at: Date | null; revoked_at: Date | null }) => t.consumed_at === null && t.revoked_at === null)).toHaveLength(1);
    expect((await goi("POST", "/guest/logout", { cookie: ck })).status).toBe(200);
    expect(await chup()).toEqual(truoc);
    const r3 = await goi("POST", "/guest/otp/verify", { body: { orgId: orgA, token: t2.token, code: ma } });
    expect(r3.status, "link thứ hai vẫn xác minh được sau khi phiên đầu thoát").toBe(200);
  });

  it("[lượt soi] QUA HTTP: phiên bị thu hồi GIỮA bước xác thực và câu UPDATE của handler ⇒ vẫn 200 kèm Set-Cookie xoá, KHÔNG hàng sổ", async () => {
    const a = await moi("NCC dua thoat");
    const ck = await moPhienKhach(a);
    const gs = await guestSessionIdCua(a.invitationId);
    const giu = await db.pool.connect();
    let r: PhanHoi;
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT 1 FROM guest_sessions WHERE id = $1 FOR UPDATE", [gs]);
      const hua = goi("POST", "/guest/logout", { cookie: ck });
      // Bước xác thực (một SELECT) đi qua; câu UPDATE của handler chờ khoá hàng — đợi tới khi thấy nó chờ.
      const het = Date.now() + 5000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE public.guest_sessions%'",
        );
        if (rows[0]!.n > 0) break;
        if (Date.now() > het) throw new Error("câu UPDATE của handler không chờ khoá hàng");
        await new Promise((xong) => setTimeout(xong, 20));
      }
      await giu.query("UPDATE guest_sessions SET revoked_at = now() WHERE id = $1", [gs]);
      await giu.query("COMMIT");
      r = await hua;
    } finally {
      giu.release();
    }
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get("set-cookie") ?? "").toMatch(/^__Host-tp_guest=;/u);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE action = 'GUEST_SESSION_REVOKED' AND resource_id = $1",
      [gs],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("phiên bị bên mua thu hồi giữa bước xác thực và handler (gọi THẲNG hàm): `revokeGuestSession` trả false, KHÔNG ghi sổ", async () => {
    const a = await moi("NCC thu hoi giua chung");
    await moPhienKhach(a);
    const gs = await guestSessionIdCua(a.invitationId);
    await withTenant(apiPool, orgA, (c) => revokeInvitation(c, orgA, { invitationId: a.invitationId, actorSessionId: sA }, apiPool));
    const kq = await withTenant(apiPool, orgA, (c) => revokeGuestSession(c, orgA, gs));
    expect(kq).toBe(false);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE action = 'GUEST_SESSION_REVOKED' AND resource_id = $1",
      [gs],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("`revokeGuestSession` của tổ chức khác không chạm phiên này (RLS lọc) — trả false", async () => {
    const a = await moi("NCC to chuc khac");
    const ck = await moPhienKhach(a);
    const gs = await guestSessionIdCua(a.invitationId);
    const orgKhac = (await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Cong ty khac', $1) RETURNING id",
      [`cong-ty-khac-${randomBytes(4).toString("hex")}`],
    )).rows[0]?.id ?? "";
    const kq = await withTenant(apiPool, orgKhac, (c) => revokeGuestSession(c, orgKhac, gs));
    expect(kq).toBe(false);
    expect((await goi("GET", "/guest/rfq", { cookie: ck })).status).toBe(200);
    // Kết nối gắn tổ chức A mà người gọi khai tổ chức khác ⇒ ném ở câu ĐẦU (`assertTenantBound`), trước câu UPDATE —
    // không phải ở lần ghi sổ sau đó.
    await expect(withTenant(apiPool, orgA, (c) => revokeGuestSession(c, orgKhac, gs))).rejects.toThrow(/^revokeGuestSession: /u);
    expect((await goi("GET", "/guest/rfq", { cookie: ck })).status).toBe(200);
  });
});

// ==============================================================================================
// [S1.219 / khoản 230] LẦN NỘP BỊ TỪ CHỐI MANG MÃ LÝ DO TRONG THÂN 422 — QUA HTTP
//
// Phần CSDL đã xong ở `074`/ADR-108: mỗi nhánh trigger của câu nộp đặt một TÊN RÀNG BUỘC, `submitBid` đọc nó ở trường
// `constraint` (không đọc chuỗi) thành `NopBiTuChoiError.ma` (tập ĐÓNG `MA_THEO_RANG_BUOC`) hay `NopQuaHanError`. Phần còn
// lại của khoản nằm ở ĐÂY: route `POST /guest/bids` trả `ma` cho người nộp, và trang nộp thầu nói câu riêng cho từng mã
// (`apps/web/src/phuc-vu.test.ts`). Mỗi ca dưới đây dựng MỘT lý do từ chối THẬT — trigger thật phán xử — rồi đòi:
//   ⑴ 422, `ma` ĐÚNG mã của nhánh, thân là một tập trường ĐÓNG (`error`, `ma`; hai giờ chỉ ở nhánh VÌ HẠN);
//   ⑵ thân KHÔNG chép câu của CSDL — hai trong các câu ấy nội suy `bid_id`/`bafo_round_id`, và câu chữ của trigger không
//      phải hợp đồng với trình duyệt;
//   ⑶ hàng sổ của nhánh (`BID_STATE_DENIED` mang cùng `ma`) nằm lại — route vẫn đi đường TRẢ VỀ, giao dịch commit.
// ==============================================================================================
describe("[S1.219 / khoản 230] lần nộp bị từ chối mang MÃ lý do trong thân 422", () => {
  /** Cùng công thức RFQ OPEN có khoá của `beforeAll`, trên một gói RIÊNG cho từng ca — gói chung `rfqA` phải còn hạn. */
  async function dungGoiMo(tieuDe: string): Promise<string> {
    const rfq = (await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, $2, now() + interval '7 days', false, $3, $4) RETURNING id",
      [orgA, tieuDe, uA, sA],
    )).rows[0]?.id ?? "";
    expect(rfq).not.toBe("");
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 1, 'Thep tam SS400', '100.0000', 'tam', $3, $4)",
      [orgA, rfq, uA, sA],
    );
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
        "SELECT $1, $2, $3, 'VND', id, $4, $5 FROM org_procurement_policies WHERE org_id = $1 AND version = 1",
      [orgA, rfq, NGAN_SACH, uA, sA],
    );
    await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfq, uA, sA]);
    await kyMotChuKy(orgA, rfq);
    await withTenant(apiPool, orgA, async (c) => {
      await issueRfqKeyPair(c, orgA, { rfqId: rfq, actorSessionId: sA, orgKeys: boBocTest });
      await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfq, uA, sA]);
    });
    return rfq;
  }

  /** Phong bì niêm cho gói `rfqId` bằng khoá P-256 của chính gói ấy, ở dạng base64 mà route nhận. */
  async function phongBiCho(rfqId: string, banRo: string): Promise<string> {
    const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256")!;
    return Buffer.from(
      await sealBid({ rfqId, algorithm: "ECDH_P256", recipientPublicKey: p256.publicKey, plaintext: new TextEncoder().encode(banRo) }),
    ).toString("base64");
  }

  /**
   * Chép từ `loi-moi-sau-commit.int.test.ts`: chạy vài câu SQL với trigger của các bảng TẮT — dựng một trạng thái mà máy
   * trạng thái `011`/`059` không cho đi tới bằng một câu UPDATE — rồi trả trigger về ĐÚNG trạng thái cũ, kể cả `ENABLE
   * ALWAYS` mà hardening đặt. Các ca sau trong tệp dùng chung `rfq_packages`, nên «đúng trạng thái cũ» được đòi trước COMMIT.
   */
  async function dungTrangThai(bang: readonly string[], cau: readonly (readonly [string, readonly unknown[]])[]): Promise<void> {
    const c = await db.pool.connect();
    const trangThai = async (): Promise<string[]> =>
      (
        await c.query<{ d: string }>(
          "SELECT tgrelid::regclass::text || '.' || tgname || '=' || tgenabled::text AS d FROM pg_catalog.pg_trigger WHERE tgrelid = ANY ($1::regclass[]) ORDER BY 1",
          [[...bang]],
        )
      ).rows.map((r) => r.d);
    try {
      await c.query("BEGIN");
      const truoc = await trangThai();
      const { rows: khacGoc } = await c.query<{ bang: string; ten: string; bat: string }>(
        "SELECT tgrelid::regclass::text AS bang, tgname AS ten, tgenabled::text AS bat FROM pg_catalog.pg_trigger " +
          "WHERE tgrelid = ANY ($1::regclass[]) AND tgenabled <> 'O'",
        [[...bang]],
      );
      for (const b of bang) await c.query(`ALTER TABLE ${b} DISABLE TRIGGER ALL`);
      for (const [sql, thamSo] of cau) await c.query(sql, [...thamSo]);
      for (const b of bang) await c.query(`ALTER TABLE ${b} ENABLE TRIGGER ALL`);
      for (const t of khacGoc) {
        const lenh = t.bat === "A" ? "ENABLE ALWAYS TRIGGER" : t.bat === "R" ? "ENABLE REPLICA TRIGGER" : "DISABLE TRIGGER";
        await c.query(`ALTER TABLE ${t.bang} ${lenh} "${t.ten}"`);
      }
      expect(await trangThai(), "trigger phải về ĐÚNG trạng thái cũ trước COMMIT").toEqual(truoc);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  /** Thân 422 của một lần từ chối: hình dạng chung của mọi nhánh, trả về để ca đọc `ma`. */
  function docTuChoi(r: PhanHoi, truong: readonly string[]): Record<string, unknown> {
    expect(r.status, r.text).toBe(422);
    const b = r.body as Record<string, unknown>;
    expect(typeof b.ma, `mã lý do máy đọc được — thân: ${r.text}`).toBe("string");
    expect(typeof b.error, "câu chung cho người đọc").toBe("string");
    expect(Object.keys(b).sort(), "thân là một tập trường ĐÓNG").toEqual([...truong].sort());
    // Không chép câu CSDL: tên cột nội suy, hậu tố `(C1)`/`(J4)`, và chính câu không dấu của từng trigger.
    expect(r.text).not.toMatch(/bid_id|bafo_round_id|\(C1\)|\(J4\)|Da qua han|khong nhan bao gia khi|khong nam trong top-N|Phien khach khong hop le/u);
    return b;
  }

  /** Số hàng `BID_STATE_DENIED` của gói mang đúng mã — bằng chứng route đi đường TRẢ VỀ và giao dịch commit. */
  async function hangSoTuChoi(rfqId: string, ma: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE action = 'BID_STATE_DENIED' AND resource_id = $1 AND payload->>'ma' = $2",
      [rfqId, ma],
    );
    return rows[0]?.n ?? 0;
  }

  it("quá hạn của vòng đang mở ⇒ 422 { error, ma: C1_QUA_HAN_NOP, gioPhanXu, hanNop } — không chép câu CSDL", async () => {
    const rfq = await dungGoiMo("Goi qua han [230]");
    const lm = await moi("NCC qua han [230]", rfq);
    const ck = await moPhienKhach(lm);
    const pb = await phongBiCho(rfq, "gia tre");
    await dungTrangThai(["public.rfq_packages"], [["UPDATE rfq_packages SET deadline_at = now() - interval '1 minute' WHERE id = $1", [rfq]]]);
    const r = await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: pb } });
    const b = docTuChoi(r, ["error", "ma", "gioPhanXu", "hanNop"]);
    expect(b.ma).toBe("C1_QUA_HAN_NOP");
    expect(typeof b.gioPhanXu).toBe("string");
    expect(typeof b.hanNop).toBe("string");
  });

  it("ngoài top-N của vòng BAFO đang mở ⇒ 422 { error, ma: BAFO_NGOAI_TOP_N } — không giờ, không id luồng; hàng BID_STATE_DENIED cùng mã nằm lại", async () => {
    const rfq = await dungGoiMo("Goi BAFO [230]");
    const lm = await moi("NCC ngoai top-N [230]", rfq);
    const ck = await moPhienKhach(lm);
    const pb = await phongBiCho(rfq, "gia vong hai");
    // Vòng hai đang mở, còn hạn, trỏ tới một lượt chấm mà luồng của nhà cung cấp này KHÔNG có hàng xếp hạng nào — với
    // `bid_kiem_vong_bafo` đó chính là «ngoài top-N»: vế duy nhất của nó là `rank <= top_n` trên lượt mà vòng trỏ tới.
    const luot = randomUUID();
    await dungTrangThai(["public.rfq_packages", "public.rfq_evaluations", "public.rfq_bafo_rounds"], [
      ["UPDATE rfq_packages SET status = 'BAFO_OPEN', closed_at = now() WHERE id = $1", [rfq]],
      [
        "INSERT INTO rfq_evaluations (id, org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) " +
          "SELECT $2, $1, $3, id, 'VND', $4, $5 FROM org_procurement_policies WHERE org_id = $1 AND version = 1",
        [orgA, luot, rfq, uA, sA],
      ],
      [
        "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, round_no, deadline_at, opened_by, opened_by_session_id) " +
          "SELECT $1, $2, $3, id, 1, 1, now() + interval '1 day', $4, $5 FROM org_procurement_policies WHERE org_id = $1 AND version = 1",
        [orgA, rfq, luot, uA, sA],
      ],
    ]);
    const r = await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: pb } });
    const b = docTuChoi(r, ["error", "ma"]);
    expect(b.ma).toBe("BAFO_NGOAI_TOP_N");
    expect(await hangSoTuChoi(rfq, "BAFO_NGOAI_TOP_N")).toBe(1);
  });

  it("gói đã đóng ⇒ 422 { error, ma: C1_GOI_KHONG_NHAN_BAO_GIA }; hàng sổ cùng mã", async () => {
    const rfq = await dungGoiMo("Goi dong som [230]");
    const lm = await moi("NCC goi dong [230]", rfq);
    const ck = await moPhienKhach(lm);
    const pb = await phongBiCho(rfq, "gia muon");
    await withTenant(apiPool, orgA, (c) =>
      c.query(
        "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
        [rfq, uA, sA],
      ),
    );
    const r = await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: pb } });
    const b = docTuChoi(r, ["error", "ma"]);
    expect(b.ma).toBe("C1_GOI_KHONG_NHAN_BAO_GIA");
    expect(await hangSoTuChoi(rfq, "C1_GOI_KHONG_NHAN_BAO_GIA")).toBe(1);
  });

  it("phiên khách bị thu hồi GIỮA bước xác thực và câu ghi ⇒ 422 { error, ma: PHIEN_KHACH_KHONG_HOP_LE }; hàng sổ cùng mã", async () => {
    // Trigger `bid_kiem_phien_khach` là lớp có thẩm quyền cho đúng khe này: bước xác thực của bộ điều phối và câu SELECT của
    // `submitBid` đều đã thấy phiên còn sống. Dựng khe bằng khoá hàng: `bid_kiem_han_nop` (chạy TRƯỚC, theo thứ tự tên) lấy
    // `FOR SHARE` trên hàng gói thầu, nên một `FOR UPDATE` giữ ở đây làm câu INSERT chờ — đúng lúc ấy thu hồi phiên rồi nhả
    // khoá. Nộp lần một thành công trước để luồng đã có: câu đứng chờ là câu ghi PHIÊN BẢN, không phải câu tạo luồng.
    const lm = await moi("NCC thu hoi giua cau nop [230]");
    const ck = await moPhienKhach(lm);
    const gs = await guestSessionIdCua(lm.invitationId);
    expect((await goi("POST", "/guest/bids", { cookie: ck, body: { envelope: await phongBiCho(rfqA, "gia lan mot") } })).status).toBe(201);
    const pb = await phongBiCho(rfqA, "gia lan hai");
    const giu = await db.pool.connect();
    let r: PhanHoi;
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT 1 FROM rfq_packages WHERE id = $1 FOR UPDATE", [rfqA]);
      const hua = goi("POST", "/guest/bids", { cookie: ck, body: { envelope: pb } });
      const het = Date.now() + 5000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'INSERT INTO public.vendor_bid_versions%'",
        );
        if (rows[0]!.n > 0) break;
        if (Date.now() > het) throw new Error("câu INSERT phiên bản báo giá không chờ khoá hàng gói thầu");
        await new Promise((xong) => setTimeout(xong, 20));
      }
      await giu.query("UPDATE guest_sessions SET revoked_at = now() WHERE id = $1", [gs]);
      await giu.query("COMMIT");
      r = await hua;
    } finally {
      giu.release();
    }
    const b = docTuChoi(r, ["error", "ma"]);
    expect(b.ma).toBe("PHIEN_KHACH_KHONG_HOP_LE");
    expect(await hangSoTuChoi(rfqA, "PHIEN_KHACH_KHONG_HOP_LE")).toBe(1);
  });
});

// [S1.9101 / S4.7b2 / L16] THƯỚC TCO Ở `GET /guest/rfq` — tập mã và tham số chụp lúc gói mở (`112` (4), `9501`). Khối CUỐI tệp: nó khai
// một phiên bản chính sách mới cho `orgA`, và mọi gói mở sau nó ghim phiên bản ấy (ADR-141).
describe("[S1.9101 / S4.7b2] thước TCO của gói ở GET /guest/rfq", () => {
  it("[INV-L16] gói không ảnh chụp ⇒ `tco: null`, `soNgayGiao: null`; gói mở dưới phiên bản TCO ⇒ tập mã CÓ NGUỒN theo thứ tự chính sách và tham số CHỈ của mã bật — chi phí vốn không lộ khi mã thanh toán không bật, mã lạ không đi ra", async () => {
    const a = await moi("NCC thuoc cu");
    const ra = await goi("GET", "/guest/rfq", { cookie: await moPhienKhach(a) });
    expect(ra.status, ra.text).toBe(200);
    const ta = ra.body as { rfq: { soNgayGiao: unknown }; tco: unknown };
    expect([ta.rfq.soNgayGiao, ta.tco], "phiên bản của `rfqA` không khai trọng số ⇒ không ảnh chụp").toEqual([null, null]);

    // Phiên bản mới: giá và chi phí trễ; nhóm khoá `tco` mang cả ba tham số — hai tham số thanh toán thừa, không mã nào dùng.
    const cs = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, tco, " +
          "created_by, created_by_session_id) SELECT $1, coalesce(max(version), 0) + 1, '10000000000.00', 'VND', $2::jsonb, 0, $3::jsonb, $4, $5 " +
          "FROM org_procurement_policies WHERE org_id = $1 RETURNING id",
        [
          orgA,
          // [rà soát §S1.9101 — THẤP-6] Mã thứ ba là chuỗi tự do không nguồn (`bao_hanh`) — phiên bản không chấm được (L8), và route khách lọc nó.
          '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"chi_phi_tre","don_vi":"TIEN","he_so":"1.0000"},{"ma":"bao_hanh","don_vi":"TIEN","he_so":"1.0000"}]',
          '{"chi_phi_von_nam":"0.12","ngay_thanh_toan_chuan":"60","ty_le_tre_ngay":"0.001"}',
          uA,
          sA,
        ],
      )
    ).rows[0]?.id ?? "";
    const rfqB = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id, so_ngay_giao) " +
          "VALUES ($1, 'Mua van bi', now() + interval '7 days', false, $2, $3, 20) RETURNING id",
        [orgA, uA, sA],
      )
    ).rows[0]?.id ?? "";
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 1, 'Van bi DN50', '10.0000', 'cai', $3, $4)",
      [orgA, rfqB, uA, sA],
    );
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, $3, 'VND', $4, $5, $6)",
      [orgA, rfqB, NGAN_SACH, cs, uA, sA],
    );
    await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfqB, uA, sA]);
    await kyMotChuKy(orgA, rfqB);
    await withTenant(apiPool, orgA, async (c) => {
      await issueRfqKeyPair(c, orgA, { rfqId: rfqB, actorSessionId: sA, orgKeys: boBocTest });
      await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqB, uA, sA]);
    });

    const b = await moi("NCC thuoc moi", rfqB);
    const rb = await goi("GET", "/guest/rfq", { cookie: await moPhienKhach(b) });
    expect(rb.status, rb.text).toBe(200);
    const tb = rb.body as { rfq: { soNgayGiao: unknown }; tco: unknown };
    expect(tb.rfq.soNgayGiao).toBe(20);
    expect(tb.tco).toEqual({ ma: ["gia", "chi_phi_tre"], thamSo: { chiPhiVonNam: null, ngayThanhToanChuan: null, tyLeTreNgay: "0.001" } });
    for (const lo of ["0.12", "chi_phi_von_nam", "he_so", "1.0000", "10000000000", "version", "bao_hanh"]) {
      expect(rb.text, `thân khách không mang "${lo}"`).not.toContain(lo);
    }
  });
});
