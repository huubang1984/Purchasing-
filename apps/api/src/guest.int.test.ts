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
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { verifyReceipt } from "@trustprocure/bidding";
import { migrate } from "@trustprocure/db";
import { createInvitation, issueMagicLinkToken } from "@trustprocure/invitation";
import { getRfqPublicKeys, issueRfqKeyPair, sealBid } from "@trustprocure/sealed-envelope";
import { withGuestSession, withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_KHACH } from "./routes/anon.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const NGAN_SACH = "987654321.00";
const GIA_THAT = JSON.stringify({ unitPrice: 1234567891, currency: "VND" });

const boBocTest = {
  name: "doi-xung-cua-test",
  wrap: (_orgId: string, plaintext: Uint8Array) =>
    Promise.resolve({ ciphertext: plaintext.map((b) => b ^ 0xff), keyVersion: "test-v1" }),
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

async function moi(ten: string): Promise<LoiMoi> {
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
      rfqId: rfqA,
      supplierId: ncc.rows[0]?.id ?? "",
      contactId: lh.rows[0]?.id ?? "",
      linkChannel: "EMAIL",
      actorSessionId: sA,
    });
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

async function goi(method: string, path: string, tuyChon: { cookie?: string; body?: unknown } = {}): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
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
  await withTenant(apiPool, orgA, async (c) => {
    await issueRfqKeyPair(c, orgA, { rfqId: rfqA, actorSessionId: sA, wrapper: boBocTest });
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqA, uA, sA]);
  });

  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
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
