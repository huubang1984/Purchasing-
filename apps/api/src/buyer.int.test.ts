// ==============================================================================================
// ROUTE NGHIỆP VỤ CỦA NGƯỜI MUA QUA HTTP — S1.10.5.
//
//   [INV-H17] QUÉT: MỌI route ghi của người mua trong `ROUTES` (trừ route tự thân) gọi bằng một
//             phiên KHÔNG có vai trò nào ⇒ 403, và mỗi lần một bản ghi PERMISSION_DENIED — không
//             một route nào lọt, và phép đếm bản ghi bằng ĐÚNG số route đã gọi (D5).
//   [INV-D2]  RFQ vượt ngưỡng cần hai phê duyệt của hai người khác nhau, người tạo không được duyệt.
//   [INV-C5]  mở RFQ qua HTTP ⇒ cặp khoá ra đời; trước đó không có.
//   [INV-A4]  bảng so sánh bị từ chối khi RFQ chưa UNSEALED (kể cả sau khi đã điều phối mở thầu).
//   [INV-E6]  token magic link mời thầu KHÔNG về client — chỉ tới bộ gửi, đích đọc từ supplier_contacts.
//   [INV-D1]  điều phối mở thầu cần cổng bốn vế; hai phê duyệt bởi hai giám đốc khác người yêu cầu.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { ROUTES } from "./routes.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;

interface Nguoi {
  readonly id: string;
  readonly cookie: string;
  readonly sessionId: string;
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

async function nguoi(email: string, roles: readonly string[]): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi') RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  for (const r of roles) {
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, r]);
  }
  const token = randomBytes(32).toString("base64url");
  const s = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, id, sha256(token)],
  );
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}`, sessionId: s.rows[0]?.id ?? "" };
}

interface PhanHoi {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
}

async function goi(method: string, path: string, ai: Nguoi | null, body?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
  if (ai !== null) headers.cookie = ai.cookie;
  let than: string | undefined;
  if (body !== undefined) {
    than = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${goc}${path}`, { method, headers, body: than });
  const text = await res.text();
  return { status: res.status, text, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

async function demTuChoi(userId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
    [orgA, userId],
  );
  return Number(rows[0]?.n ?? "-1");
}

const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[INV-H17] quét MỌI route ghi của người mua bằng một phiên không có vai trò nào", () => {
  it("[INV-H17] [INV-D5] mỗi route ghi ⇒ 403, và số bản ghi PERMISSION_DENIED tăng đúng bằng số route", async () => {
    const khongQuyen = await nguoi("khongquyen@vidu.vn", []);
    const routeGhi = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self !== true);
    expect(routeGhi.length, "phải có route ghi để quét — rỗng là rỗng ruột").toBeGreaterThan(15);
    const truoc = await demTuChoi(khongQuyen.id);
    const lot: string[] = [];
    for (const r of routeGhi) {
      const path = r.path.replace(/:[A-Za-z]+/gu, UUID0);
      const kq = await goi(r.method, path, khongQuyen, {});
      if (kq.status !== 403) lot.push(`${r.method} ${r.path} -> ${kq.status}`);
    }
    expect(lot, "route ghi cho một phiên KHÔNG có quyền nào đi qua mà không 403").toEqual([]);
    expect(await demTuChoi(khongQuyen.id)).toBe(truoc + routeGhi.length);
  });

  it("route ĐỌC không có cổng ở dispatcher (theo ADR-016): phiên không quyền vẫn đọc được /me, /suppliers", async () => {
    const khongQuyen = await nguoi("docduoc@vidu.vn", []);
    expect((await goi("GET", "/me", khongQuyen)).status).toBe(200);
    expect((await goi("GET", "/suppliers", khongQuyen)).status).toBe(200);
    // ... nhưng hai đường đọc CÓ CỔNG (khoản nợ 33) thì gói tự chặn: 403 vẫn là 403.
    expect((await goi("GET", `/rfqs/${UUID0}/comparison`, khongQuyen)).status).toBe(403);
    expect((await goi("GET", `/rfqs/${UUID0}/bid-count`, khongQuyen)).status).toBe(403);
  });
});

describe("vòng đời phía người mua qua HTTP — kịch bản mục 41, nửa người mua", () => {
  it("chính sách → NCC → RFQ → hạng mục → ngân sách → nộp → duyệt ×2 → mở → mời → gia hạn → đóng → mở thầu → điều phối", async () => {
    const pm1 = await nguoi("pm1@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const pm2 = await nguoi("pm2@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const pm3 = await nguoi("pm3@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const buyer = await nguoi("buyer@vidu.vn", ["BUYER"]);
    const gd1 = await nguoi("gd1@vidu.vn", ["DIRECTOR"]);
    const gd2 = await nguoi("gd2@vidu.vn", ["DIRECTOR"]);
    const gd3 = await nguoi("gd3@vidu.vn", ["DIRECTOR"]);

    // Chính sách: BUYER bị 403 (policy.manage là của PROCUREMENT_MANAGER — 030), PM tạo được.
    expect((await goi("POST", "/policy", buyer, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(403);
    const cs = await goi("POST", "/policy", pm1, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" });
    expect(cs.status, cs.text).toBe(201);
    expect((await goi("GET", "/policy", buyer)).status).toBe(200);

    // Nhà cung cấp + người liên hệ (đích của magic link).
    const ncc = await goi("POST", "/suppliers", pm1, { legalName: "Thep Viet", taxCode: "0301234567" });
    expect(ncc.status, ncc.text).toBe(201);
    const supplierId = (ncc.body as { supplier: { id: string } }).supplier.id;
    const lh = await goi("POST", `/suppliers/${supplierId}/contacts`, pm1, { fullName: "Anh Ban", email: "ban@thepviet.vn", phone: "0901234567" });
    expect(lh.status, lh.text).toBe(201);
    const contactId = (lh.body as { contact: { id: string } }).contact.id;
    expect((await goi("GET", `/suppliers/${supplierId}/contacts`, buyer)).status).toBe(200);

    // RFQ 1 tỷ: vượt ngưỡng ⇒ giữ phê duyệt kép.
    const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const rfq = await goi("POST", "/rfqs", buyer, { title: "Mua thep tam", deadlineAt: han });
    expect(rfq.status, rfq.text).toBe(201);
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("POST", `/rfqs/${rfqId}/items`, buyer, { lineNo: 1, description: "Thep tam SS400", quantity: "100.0000", unit: "tam" })).status).toBe(201);
    const ns = await goi("PUT", `/rfqs/${rfqId}/budget`, buyer, { estimatedValue: "1000000000.00", currency: "VND" });
    expect(ns.status, ns.text).toBe(200);
    expect((ns.body as { budget: { requiresDualApproval: boolean } }).budget.requiresDualApproval).toBe(true);
    expect((await goi("POST", `/rfqs/${rfqId}/submit`, buyer)).status).toBe(200);

    // [INV-D2] Người tạo không duyệt được; hai PM khác nhau mới đủ; PM duyệt hai lần cũng không đủ.
    expect((await goi("POST", `/rfqs/${rfqId}/approve`, buyer)).status).toBe(403); // BUYER không có rfq.approve
    const d1 = await goi("POST", `/rfqs/${rfqId}/approve`, pm2);
    expect(d1.status, d1.text).toBe(200);
    // Cùng người duyệt hai lần: `rfq_approvals_mot_nguoi_mot_lan` (UNIQUE) ⇒ 23505 ⇒ 409, thân cố định.
    const d1lai = await goi("POST", `/rfqs/${rfqId}/approve`, pm2);
    expect(d1lai.status, d1lai.text).toBe(409);
    // Chưa đủ hai người ⇒ mở bị từ chối.
    expect((await goi("POST", `/rfqs/${rfqId}/open`, pm1)).status).toBe(422);
    expect((await goi("POST", `/rfqs/${rfqId}/approve`, pm3)).status).toBe(200);

    // [INV-C5] Trước khi mở: chưa có khoá. Sau khi mở: có.
    const khoaTruoc = await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [rfqId]);
    expect(khoaTruoc.rows).toHaveLength(0);
    expect((await goi("POST", `/rfqs/${rfqId}/open`, buyer)).status).toBe(403); // rfq.open là của PM
    const mo = await goi("POST", `/rfqs/${rfqId}/open`, pm1);
    expect(mo.status, mo.text).toBe(200);
    expect((mo.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");
    const khoaSau = await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [rfqId]);
    expect(khoaSau.rows.length).toBeGreaterThan(0);

    // [INV-E6] Mời: token magic link tới BỘ GỬI với đích đọc từ supplier_contacts, KHÔNG về client.
    const truocMoi = dv.loiMoiDaGui.length;
    const moi = await goi("POST", `/rfqs/${rfqId}/invitations`, buyer, { supplierId, contactId });
    expect(moi.status, moi.text).toBe(201);
    expect(dv.loiMoiDaGui).toHaveLength(truocMoi + 1);
    const gui = dv.loiMoiDaGui.at(-1)!;
    expect(gui.destination).toBe("ban@thepviet.vn");
    expect(moi.text).not.toContain(gui.token);
    const invitationId = (moi.body as { invitation: { id: string } }).invitation.id;

    // Gia hạn (đẩy ra xa) rồi đóng có lý do.
    const hanMoi = new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString();
    expect((await goi("POST", `/rfqs/${rfqId}/extend`, pm1, { newDeadlineAt: hanMoi, reason: "them thoi gian" })).status).toBe(200);
    expect((await goi("POST", `/rfqs/${rfqId}/close`, pm1, { reason: "het han" })).status).toBe(200);
    expect((await goi("POST", `/invitations/${invitationId}/revoke`, buyer)).status).toBe(200);

    // [INV-A4] Đã CLOSED, chưa mở thầu: bảng so sánh bị từ chối (422 từ ComparisonDeniedError).
    const ss = await goi("GET", `/rfqs/${rfqId}/comparison`, pm1);
    expect(ss.status, ss.text).toBe(422);
    expect((await goi("GET", `/rfqs/${rfqId}/bid-count`, pm1)).status).toBe(200);

    // [INV-D1] [INV-D2] Yêu cầu mở thầu (DIRECTOR có rfq.unseal), hai giám đốc KHÁC duyệt, rồi điều phối.
    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, gd1, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    const unsealId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
    expect((await goi("POST", `/unseal/${unsealId}/approve`, gd1)).status).toBe(422); // người yêu cầu không tự duyệt
    expect((await goi("POST", `/unseal/${unsealId}/approve`, gd2)).status).toBe(200);
    expect((await goi("POST", `/unseal/${unsealId}/dispatch`, gd1)).status).toBe(422); // mới một phê duyệt
    expect((await goi("POST", `/unseal/${unsealId}/approve`, gd3)).status).toBe(200);
    const dp = await goi("POST", `/unseal/${unsealId}/dispatch`, gd1);
    expect(dp.status, dp.text).toBe(200);
    const trangThai = await goi("GET", `/unseal/${unsealId}`, pm1);
    expect(trangThai.status).toBe(200);
    // Điều phối chỉ ĐẶT MỘT JOB — RFQ chưa UNSEALED, bảng so sánh vẫn bị từ chối (A4).
    expect((await goi("GET", `/rfqs/${rfqId}/comparison`, pm1)).status).toBe(422);
    const job = await db.pool.query("SELECT 1 FROM outbox_jobs WHERE org_id = $1 AND kind = 'UNSEAL_RFQ'", [orgA]);
    expect(job.rows).toHaveLength(1);
  });

  it("huỷ RFQ: BUYER 403 (rfq.cancel là của PM); PM huỷ được với lý do; tham số đường dẫn không phải UUID ⇒ 404", async () => {
    const pm = await nguoi("pmhuy@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const buyer = await nguoi("buyerhuy@vidu.vn", ["BUYER"]);
    const rfq = await goi("POST", "/rfqs", buyer, { title: "Huy" });
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("POST", `/rfqs/${rfqId}/cancel`, buyer, { reason: "x" })).status).toBe(403);
    expect((await goi("POST", `/rfqs/${rfqId}/cancel`, pm, {})).status).toBe(422);
    expect((await goi("POST", `/rfqs/${rfqId}/cancel`, pm, { reason: "khong can nua" })).status).toBe(200);
    expect((await goi("GET", "/rfqs/khong-phai-uuid", pm)).status).toBe(404);
  });
});
