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
import { HE_THONG_MAX_TOKENS_PER_WINDOW, LOGIN_MAX_TOKENS_PER_WINDOW, PERMISSIONS } from "@trustprocure/identity";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { ROUTES } from "./routes.js";
import { createApiServer } from "./server.js";
import { dichVuTest, outboxTest, type DichVuTest } from "./test-services.js";

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

/**
 * [S1.92 / khoản 156] Mọi lời đánh thức runner outbox mà BỘ ĐIỀU PHỐI phát ra, theo thứ tự.
 *
 * Tiến trình thật cắm `runner.runOnceForOrg` vào đây (composition.ts). Test lắp tay thì cắm một
 * mảng: thứ cần đo ở tầng này không phải job có chạy không — `outboxTest` đo việc ấy — mà là bộ
 * điều phối có PHÁT lời đánh thức hay không. Trước vòng này, đường người mua không phát lời nào.
 */
const daDanhThuc: string[] = [];

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  dv = dichVuTest();
  server = createApiServer(
    createDispatcher({ pool: apiPool, auditPool, services: dv.services, outboxNudge: (org) => daDanhThuc.push(org) }),
  );
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
    // [review H2-9] [INV-D5] Bản ghi từ chối mang TOẠ ĐỘ: mọi route khai `resourceId` (đọc từ đường
    // dẫn) để lại `resource_id = UUID0`; số bản ghi có toạ độ bằng đúng số route khai nó.
    const coToaDo = routeGhi.filter((r) => "resourceId" in r && r.resourceId !== undefined).length;
    expect(coToaDo, "phải có route khai resourceId").toBeGreaterThan(10);
    expect(routeGhi.length - coToaDo, "route ghi KHÔNG có toạ độ: chỉ POST /policy, /suppliers, /rfqs (tạo mới)").toBe(3);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED' AND resource_id = $3",
      [orgA, khongQuyen.id, UUID0],
    );
    expect(Number(rows[0]?.n)).toBe(coToaDo);
  });

  it("[INV-H17] [sổ nợ 47] MÃ QUYỀN ĐÚNG: với mỗi route ghi, một phiên giữ ĐÚNG MỘT mã quyền — chỉ đúng `route.permission` mới qua cổng, MỌI mã khác ⇒ 403", async () => {
    // [review H2-11 ⑶] Quét "không quyền ⇒ 403" chứng minh cổng ĐÓNG, không chứng minh nó đóng ĐÚNG
    // KHOÁ: `/rfqs/:id/approve` gán nhầm `RFQ_CREATE` vẫn xanh. Reviewer đề nghị "mọi quyền TRỪ
    // route.permission ⇒ 403" — bất khả thi theo đúng thiết kế: một vai/một người gom gần hết quyền
    // bị chính trigger D3 (005) và 033 chặn. Phép đo tương đương và trigger-an-toàn: MỖI mã quyền
    // một vai đơn lẻ, một người; với mỗi route ghi, đúng một người qua cổng (không thêm bản ghi
    // từ chối), mọi người khác 403 và +1 PERMISSION_DENIED. Tất cả tự sinh từ ROUTES và PERMISSIONS.
    const maQuyen = Object.values(PERMISSIONS);
    const nguoiTheoQuyen = new Map<string, Nguoi>();
    for (const ma of maQuyen) {
      const vai = `KIEM_${ma.toUpperCase().replace(/\./gu, "_")}`;
      await db.pool.query("INSERT INTO roles (code, name) VALUES ($1, $2)", [vai, `Kiem ${ma}`]);
      await db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ($1, $2)", [vai, ma]);
      nguoiTheoQuyen.set(ma, await nguoi(`kiem-${ma}@vidu.vn`, [vai]));
    }
    const routeGhi = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self !== true);
    expect(routeGhi.length).toBeGreaterThan(15);
    const truoc = new Map<string, number>();
    for (const [ma, ng] of nguoiTheoQuyen) truoc.set(ma, await demTuChoi(ng.id));

    const sai: string[] = [];
    for (const r of routeGhi) {
      // TS suy ra vị từ từ `filter` ở trên: `r` là BuyerWriteRoute, `permission` chắc chắn có.
      const path = r.path.replace(/:[A-Za-z]+/gu, UUID0);
      for (const [ma, ng] of nguoiTheoQuyen) {
        const kq = await goi(r.method, path, ng, {});
        const quaCong = kq.status !== 403;
        if (ma === (r.permission as string) && !quaCong) sai.push(`${r.method} ${r.path}: ĐÚNG mã ${ma} mà vẫn 403`);
        if (ma !== (r.permission as string) && quaCong) sai.push(`${r.method} ${r.path}: mã ${ma} (không phải ${r.permission}) đi qua với ${kq.status}`);
      }
    }
    expect(sai, "cổng quyền của một route đóng SAI KHOÁ").toEqual([]);
    // Đếm chéo bằng sổ kiểm toán: người giữ mã P bị từ chối đúng bằng số route ghi KHÔNG đòi P.
    for (const [ma, ng] of nguoiTheoQuyen) {
      const mongDoi = routeGhi.filter((r) => (r.permission as string) !== ma).length;
      expect(await demTuChoi(ng.id) - (truoc.get(ma) ?? 0), `PERMISSION_DENIED của người giữ ${ma}`).toBe(mongDoi);
    }
    // Chống rỗng ruột: có mã quyền không route nào đòi (bị từ chối ở MỌI route) và có mã được ≥ 1 route đòi.
    const doiBoi = new Set(routeGhi.map((r) => r.permission as string));
    expect(maQuyen.filter((m) => !doiBoi.has(m)).length).toBeGreaterThan(0);
    expect(doiBoi.size).toBeGreaterThan(5);
    // [S1.11] Ngân sách riêng, vì ca này là một VÒNG QUÉT (route ghi × mã quyền, mỗi cặp một phiên
    // và một lời gọi HTTP) và nó lớn theo cả hai chiều. Đo được: ~13,5 s trong một lượt `test:int`
    // đầy đủ; 30 s+ khi `pnpm evidence` chạy CẢ HAI tầng trên cùng máy (16 worker) — đỏ hai lượt
    // liên tiếp đúng ở trần 30 s mặc định, không một khẳng định nào sai. Không phải họ 57P01 của
    // nợ 24 (đó là vòng đời kết nối); đây là ngân sách wall-clock cho một ca cố ý nặng.
  }, 120_000);

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
    const tc = await nguoi("taichinh@vidu.vn", ["FINANCE"]);

    // Chính sách: ~~policy.manage là của PROCUREMENT_MANAGER — 030~~ [033 / nợ 44] là của FINANCE —
    // BUYER (đặt ước lượng) và PM (đặt ước lượng + duyệt) đều 403; người đặt thước không cầm thứ bị đo.
    expect((await goi("POST", "/policy", buyer, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(403);
    expect((await goi("POST", "/policy", pm1, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(403);
    const cs = await goi("POST", "/policy", tc, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" });
    expect(cs.status, cs.text).toBe(201);
    expect((await goi("GET", "/policy", buyer)).status).toBe(200);
    // [review H2-3] `version` chỉ là giá trị KỲ VỌNG: phải bằng hiện hành + 1. Một `2147483647` (trần
    // int4 — ghim tổ chức vĩnh viễn vì trigger 022 đòi "lớn hơn" và không có UPDATE/DELETE) bị 422.
    const ghim = await goi("POST", "/policy", tc, { version: 2147483647, dualApprovalThreshold: "0.01", currency: "VND" });
    expect(ghim.status, ghim.text).toBe(422);
    expect(ghim.text).toContain("hiện hành + 1 (2)");
    expect((await goi("POST", "/policy", tc, { version: 1, dualApprovalThreshold: "0.01", currency: "VND" })).status).toBe(422);
    expect((await goi("GET", "/policy", buyer)).text).toContain('"version":1');

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
    // Chưa đủ hai người ⇒ mở bị từ chối — và [review H2-10] đọc LÝ DO: thông điệp của trigger 009 (D2),
    // không phải một 422 nào đó khác (trạng thái sai, thiếu hạng mục) trông y hệt.
    const moSom = await goi("POST", `/rfqs/${rfqId}/open`, pm1);
    expect(moSom.status).toBe(422);
    expect(moSom.text).toContain("can 2 phe duyet");
    expect(moSom.text).toContain(", moi co 1 (D2)");
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
    // [review H2-9 ⑵] Người liên hệ của NCC KHÁC ⇒ 422 TRƯỚC khi có lời mời hay token nào; định danh
    // sai dạng ⇒ 422 (không phải 22P02 → 500). Đo cả "không để lại gì": không hàng rfq_invitations
    // cho NCC ấy, bộ gửi không nhận thêm link.
    const nccKhac = await goi("POST", "/suppliers", pm1, { legalName: "Thep Khac", taxCode: "0309876543" });
    const supplierKhac = (nccKhac.body as { supplier: { id: string } }).supplier.id;
    const lhKhac = await goi("POST", `/suppliers/${supplierKhac}/contacts`, pm1, { fullName: "Chi Khac", email: "khac@thepkhac.vn" });
    const contactKhac = (lhKhac.body as { contact: { id: string } }).contact.id;
    const truocMoi = dv.loiMoiDaGui.length;
    const lech = await goi("POST", `/rfqs/${rfqId}/invitations`, buyer, { supplierId, contactId: contactKhac });
    expect(lech.status, lech.text).toBe(422);
    expect(lech.text).toContain("khong thuoc nha cung cap");
    expect((await goi("POST", `/rfqs/${rfqId}/invitations`, buyer, { supplierId: "khong-phai-uuid", contactId })).status).toBe(422);
    expect((await db.pool.query("SELECT 1 FROM rfq_invitations WHERE rfq_id = $1", [rfqId])).rows).toHaveLength(0);
    expect(dv.loiMoiDaGui).toHaveLength(truocMoi);

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

    // [S1.90 / khoản 190] Trước khi có ai xin mở: 200 kèm `null`, KHÔNG phải 404. "Gói thầu này
    // chưa ai xin mở" và "không có gói thầu ấy" là hai câu trả lời khác nhau, và người duyệt thứ
    // hai cần phân biệt được — 404 cho cả hai là bắt họ đoán.
    const chuaAiXin = await goi("GET", `/rfqs/${rfqId}/unseal`, gd2);
    expect(chuaAiXin.status, chuaAiXin.text).toBe(200);
    expect((chuaAiXin.body as { unsealRequest: unknown }).unsealRequest).toBeNull();

    // [INV-D1] [INV-D2] Yêu cầu mở thầu (DIRECTOR có rfq.unseal), hai giám đốc KHÁC duyệt, rồi điều phối.
    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, gd1, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    const unsealId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;

    // [S1.90 / khoản 190 · 192] Người duyệt thứ hai ngồi MÁY KHÁC: tất cả những gì họ có là mã gói
    // thầu, không phải `unsealId` — cái ấy chỉ hiện trên màn hình của người đã tạo. Đường dưới đây
    // là thứ biến "cần hai người duyệt" từ một lời hứa thành một việc làm được.
    const timTheoRfq = async (): Promise<{ id: string; approvalCount: number; requiredApprovals: number }> => {
      const t = await goi("GET", `/rfqs/${rfqId}/unseal`, gd2);
      expect(t.status, t.text).toBe(200);
      return (t.body as { unsealRequest: { id: string; approvalCount: number; requiredApprovals: number } }).unsealRequest;
    };
    expect(await timTheoRfq()).toMatchObject({ id: unsealId, approvalCount: 0, requiredApprovals: 2 });
    // [review H2-10] Hai 422 dưới đọc LÝ DO: trigger 019 (D2, D3) và cổng D1 — không phải 422 nào cũng được.
    const tuDuyet = await goi("POST", `/unseal/${unsealId}/approve`, gd1);
    expect(tuDuyet.status).toBe(422);
    expect(tuDuyet.text).toContain("khong duoc tu phe duyet (D2, D3)");
    expect((await goi("POST", `/unseal/${unsealId}/approve`, gd2)).status).toBe(200);
    expect((await timTheoRfq()).approvalCount, "một chữ ký — và màn hình phải đọc ra ĐÚNG một").toBe(1);
    const somMot = await goi("POST", `/unseal/${unsealId}/dispatch`, gd1);
    expect(somMot.status).toBe(422);
    // Cổng D1 đọc trạng thái trước khi đếm: mới một phê duyệt ⇒ yêu cầu còn PENDING, chưa APPROVED.
    expect(somMot.text).toContain("phải ở trạng thái APPROVED; đang ở PENDING");
    expect((await goi("POST", `/unseal/${unsealId}/approve`, gd3)).status).toBe(200);
    expect(await timTheoRfq()).toMatchObject({ approvalCount: 2, requiredApprovals: 2 });
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

describe("[sổ nợ 40 / 040] đặt lại TOTP qua HTTP — hai người", () => {
  it("BUYER ⇒ 403; PM yêu cầu ⇒ 201; thiếu lý do ⇒ 422; PM tự duyệt ⇒ 422 (CHECK); PM khác duyệt ⇒ 200, hồ sơ mất, cookie nạn nhân ⇒ 401", async () => {
    const buyer = await nguoi("mr-buyer@vidu.vn", ["BUYER"]);
    const pm1 = await nguoi("mr-pm1@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const pm2 = await nguoi("mr-pm2@vidu.vn", ["DIRECTOR"]);
    const nan = await nguoi("mr-nan@vidu.vn", ["BUYER"]);
    await db.pool.query(
      "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version, confirmed_at, last_used_counter) VALUES ($1, $2, 'TOTP', '\\x01', 'v1', now(), 1)",
      [orgA, nan.id],
    );
    expect((await goi("GET", "/me", nan)).status).toBe(200);
    expect((await goi("POST", `/users/${nan.id}/mfa-reset`, buyer, { reason: "mat may" })).status).toBe(403);
    expect((await goi("POST", `/users/${nan.id}/mfa-reset`, pm1, {})).status).toBe(422);
    const yc = await goi("POST", `/users/${nan.id}/mfa-reset`, pm1, { reason: "mat may" });
    expect(yc.status, yc.text).toBe(201);
    const id = (yc.body as { mfaReset: { id: string; status: string } }).mfaReset.id;
    expect((yc.body as { mfaReset: { status: string } }).mfaReset.status).toBe("PENDING");
    const tu = await goi("POST", `/mfa-resets/${id}/approve`, pm1, {});
    expect(tu.status).toBe(422);
    // CHECK thường (không phải RAISE của trigger): thân cố định, không lộ tên ràng buộc (review H2-8).
    expect(tu.text).toBe(JSON.stringify({ error: "du lieu vi pham rang buoc" }));
    const ok = await goi("POST", `/mfa-resets/${id}/approve`, pm2, {});
    expect(ok.status, ok.text).toBe(200);
    const kq = (ok.body as { mfaReset: { status: string; credentialDeleted: boolean; sessionsRevoked: number } }).mfaReset;
    expect(kq.status).toBe("APPROVED");
    expect(kq.credentialDeleted).toBe(true);
    expect(kq.sessionsRevoked).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM mfa_credentials WHERE org_id = $1 AND user_id = $2", [orgA, nan.id])).rows).toHaveLength(0);
    expect((await goi("GET", "/me", nan)).status).toBe(401);
    expect((await goi("POST", `/mfa-resets/${id}/approve`, pm2, {})).status).toBe(422);
    expect((await goi("POST", "/mfa-resets/00000000-0000-4000-8000-000000000000/approve", pm2, {})).status).toBe(422);
    // [review H4-2] Huỷ qua HTTP: đã duyệt ⇒ 422; yêu cầu mới ⇒ BUYER huỷ 403, PM huỷ 200 (CANCELLED), duyệt sau huỷ ⇒ 422.
    expect((await goi("POST", `/mfa-resets/${id}/cancel`, pm2, {})).status).toBe(422);
    const nan2 = await nguoi("mr-nan2@vidu.vn", ["BUYER"]);
    const yc2 = await goi("POST", `/users/${nan2.id}/mfa-reset`, pm1, { reason: "mo nham" });
    expect(yc2.status, yc2.text).toBe(201);
    const id2 = (yc2.body as { mfaReset: { id: string } }).mfaReset.id;
    expect((await goi("POST", `/mfa-resets/${id2}/cancel`, buyer, {})).status).toBe(403);
    const huy = await goi("POST", `/mfa-resets/${id2}/cancel`, pm2, {});
    expect(huy.status, huy.text).toBe(200);
    expect((huy.body as { mfaReset: { status: string } }).mfaReset.status).toBe("CANCELLED");
    expect((await goi("POST", `/mfa-resets/${id2}/approve`, pm2, {})).status).toBe(422);
  });
});
// =================================================================================================
// [S1.91 / khoản 194 · 154] HAI TIN BÁO MÀ TỚI S1.90 KHÔNG TIẾN TRÌNH NÀO GỬI
//
// Khoản 194 sinh ra từ một lượt đi thử và ĐƯỢC GHI SAI ở vòng S1.90: biên bản khi ấy đổ cho cửa sổ
// 15 phút của mã đăng nhập. Phép đo ở S1.91 bác điều đó — `LOGIN_TOKEN_TTL_SECONDS` đếm từ lúc
// NGƯỜI DÙNG xin link, và phiên sống 8 giờ sau khi vào. Thứ làm hỏng lượt đi thử là `tools/gieo-demo`
// phát cả ba link một lúc rồi để đó.
//
// Khoảng trống THẬT lớn hơn: `requestUnseal` không xếp một việc nào, nên người duyệt thứ hai chỉ biết
// có việc chờ mình nếu một con người khác nhắn cho họ. Mở thầu đòi HAI người (D2) mà hệ thống không
// nói với người thứ hai — tính năng ấy tự chạy được bao giờ.
//
// Khoản 154 là cùng một khoảng trống ở đầu kia: `RFQ_DEADLINE_EXTENDED_NOTICE` được enqueue từ S1.81
// và không tiến trình nào nhận. Hai khoản đóng bằng MỘT chặng gửi, và đó là lý do chúng cùng vòng.
// =================================================================================================
describe("[khoản 194 · 154] hai tin báo mà tới S1.90 không tiến trình nào gửi", () => {
  /**
   * RFQ đã ĐÓNG — cùng khuôn `taoRfqDaDong` của `packages/unseal`, dựng bằng SQL để không phụ thuộc
   * chính sách mà một test khác trong tệp này có thể đã đặt (hay chưa đặt).
   *
   * LUÔN cấp kép, và hai phê duyệt RFQ phải đến từ HAI người khác nhau: cổng D2 ở tầng CSDL từ chối
   * cạnh PENDING_APPROVAL -> OPEN khi thiếu, và nó từ chối ĐÚNG — fixture thiếu hai hàng ấy làm ba
   * test đầu của khối này đỏ với *"RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 0"*.
   */
  async function rfqDaDong(ai: Nguoi, duyet: readonly Nguoi[], dong = true): Promise<string> {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Bao tin', now() + interval '7 days', true, $2, $3) RETURNING id",
      [orgA, ai.id, ai.sessionId],
    );
    const rfqId = rows[0]?.id ?? "";
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
      [orgA, rfqId, ai.id, ai.sessionId],
    );
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
      [rfqId, ai.id, ai.sessionId],
    );
    for (const d of duyet) {
      await db.pool.query("INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)", [orgA, rfqId, d.id, d.sessionId]);
    }
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
        [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), ai.id, ai.sessionId],
      );
      await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqId, ai.id, ai.sessionId]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    // `dong = false` giữ RFQ ở OPEN: cạnh CLOSED -> OPEN KHÔNG tồn tại (máy trạng thái từ chối,
    // và nó từ chối đúng), nên một test cần RFQ còn mở phải dừng ở đây chứ không mở lại.
    if (dong) {
      await db.pool.query(
        "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong de kiem tra', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
        [rfqId, ai.id, ai.sessionId],
      );
    }
    return rfqId;
  }

  /** Mọi người trong tổ chức đang giữ `rfq.unseal.approve` — đọc bằng SQL, không qua hàm đang được đo. */
  async function nguoiDuyetCuaToChuc(): Promise<Set<string>> {
    const { rows } = await db.pool.query<{ id: string }>(
      `SELECT DISTINCT u.id FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
         JOIN role_permissions rp ON rp.role_code = ur.role_code
        WHERE ur.org_id = $1 AND rp.permission_code = 'rfq.unseal.approve' AND u.status = 'ACTIVE'`,
      [orgA],
    );
    return new Set(rows.map((r) => r.id));
  }

  it("[khoản 194] tạo yêu cầu mở ⇒ MỖI người duyệt một việc, và người YÊU CẦU không có việc nào", async () => {
    const nguoiXin = await nguoi("bao-xin@vidu.vn", ["DIRECTOR"]);
    const duyetA = await nguoi("bao-duyet-a@vidu.vn", ["DIRECTOR"]);
    const duyetA2 = await nguoi("bao-duyet-a2@vidu.vn", ["DIRECTOR"]);
    // PM giữ `rfq.unseal` (xin mở được) nhưng KHÔNG giữ `rfq.unseal.approve`. Người này tồn tại
    // trong phép đo để ghim rằng tin báo đi theo quyền PHÊ DUYỆT chứ không theo quyền XIN MỞ — đổi
    // một mã quyền thành mã kia là một đột biến SỐNG nếu không có ai giữ đúng một trong hai.
    const pmKhongDuyet = await nguoi("bao-pm-khong-duyet@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const rfqId = await rfqDaDong(nguoiXin, [duyetA, duyetA2]);

    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, nguoiXin, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    const unsealId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;

    const { rows: viec } = await db.pool.query<{ payload: { userId: string } }>(
      "SELECT payload FROM outbox_jobs WHERE org_id = $1 AND kind = 'UNSEAL_APPROVAL_NOTICE' AND payload->>'unsealRequestId' = $2",
      [orgA, unsealId],
    );
    const nhan = new Set(viec.map((v) => v.payload.userId));
    const phaiNhan = await nguoiDuyetCuaToChuc();
    phaiNhan.delete(nguoiXin.id);

    expect(nhan, "mỗi người giữ rfq.unseal.approve nhận ĐÚNG một việc").toEqual(phaiNhan);
    expect(nhan.has(duyetA.id), "người duyệt vừa tạo phải có trong danh sách").toBe(true);
    expect(nhan.has(nguoiXin.id), "D2 nói người yêu cầu không duyệt được — báo cho họ là một tin SAI").toBe(false);
    expect(
      nhan.has(pmKhongDuyet.id),
      "PROCUREMENT_MANAGER giữ rfq.unseal nhưng không giữ rfq.unseal.approve — họ xin mở được, không duyệt được",
    ).toBe(false);
    expect(viec).toHaveLength(phaiNhan.size);
  });

  it("[khoản 194] chạy outbox ⇒ tin tới đúng email của từng người duyệt, mang mã đăng nhập", async () => {
    const nguoiXin = await nguoi("bao2-xin@vidu.vn", ["DIRECTOR"]);
    const duyetB = await nguoi("bao2-duyet@vidu.vn", ["DIRECTOR"]);
    const duyetB2 = await nguoi("bao2-duyet-2@vidu.vn", ["DIRECTOR"]);
    const rfqId = await rfqDaDong(nguoiXin, [duyetB, duyetB2]);
    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, nguoiXin, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    const unsealId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;

    const truoc = dv.thongBaoDaGui.length;
    const ob = outboxTest(apiPool, dv.services);
    await ob.chay(orgA);
    const moi = dv.thongBaoDaGui.slice(truoc).filter((t) => t.unsealRequestId === unsealId);

    expect(ob.loi, "không job nào được phép hỏng").toEqual([]);
    expect(moi.length, "ít nhất người duyệt vừa tạo phải nhận được").toBeGreaterThan(0);
    const choDuyetB = moi.find((t) => t.email === "bao2-duyet@vidu.vn");
    expect(choDuyetB, "tin phải tới đúng email đọc từ hàng users").toBeDefined();
    expect(choDuyetB?.rfqId).toBe(rfqId);
    expect(choDuyetB?.token, "chủ dự án chọn tin MANG mã đăng nhập — ADR-046").not.toBeNull();
    expect(moi.some((t) => t.email === "bao2-xin@vidu.vn"), "người yêu cầu không nhận tin nào").toBe(false);
  });

  it("[khoản 156] đường NGƯỜI MUA đánh thức runner khi — và CHỈ khi — giao dịch vừa xếp việc", async () => {
    // Phép đo của lượt đi thử 2026-09-20 (§S1.92) ở tầng thấp nhất còn nói đúng nó: hai test khoản
    // 194 ở trên chạy handler outbox BẰNG TAY (`outboxTest`), nên chúng xanh kể cả khi không một
    // tiến trình nào trên đời gọi handler ấy. Đó đúng là chỗ cổng đã mù, và đây là chỗ bịt.
    const nguoiXin = await nguoi("dt-xin@vidu.vn", ["DIRECTOR"]);
    const duyetD = await nguoi("dt-duyet@vidu.vn", ["DIRECTOR"]);
    const duyetD2 = await nguoi("dt-duyet-2@vidu.vn", ["DIRECTOR"]);
    const rfqId = await rfqDaDong(nguoiXin, [duyetD, duyetD2]);

    daDanhThuc.length = 0;
    expect((await goi("GET", `/rfqs/${rfqId}/unseal`, nguoiXin)).status).toBe(200);
    expect(daDanhThuc, "một phép ĐỌC không xếp việc nào, nên không đánh thức ai").toEqual([]);

    // Một route GHI của người mua KHÔNG xếp việc: dấu phải vắng, nếu không thì mỗi lần ghi là một
    // lần chạy runner vô ích — và lời khai "đánh thức khi có việc" thành một lời khai rỗng.
    const boDi = await nguoi("dt-bo-di@vidu.vn", []);
    expect((await goi("POST", "/auth/logout", boDi)).status).toBe(200);
    expect(daDanhThuc, "route GHI không xếp việc thì không đánh thức ai").toEqual([]);

    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, nguoiXin, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    expect(daDanhThuc, "xếp việc trên đường người mua ⇒ ĐÚNG MỘT lời đánh thức, mang đúng tổ chức").toEqual([orgA]);
  });

  it("[khoản 199] vòng xin mở → huỷ → xin mở KHÔNG khoá được người duyệt ra khỏi hệ thống", async () => {
    // ==========================================================================================
    // Phép đo này dựng lại một lượt tấn công mà lượt soi ngang 75 tái lập trên ngăn xếp THẬT trong
    // ba giây: 5 mã đăng nhập cho MỖI người duyệt, rồi `/auth/link` của họ trả 200 mà không gửi
    // gì. Kẻ tấn công không cần quyền đặc biệt nào — `rfq.unseal` là quyền để XIN MỞ THẦU.
    //
    // Vế đáng giá không phải "hệ thống tiêu ít mã hơn", mà là dòng cuối: NẠN NHÂN VẪN VÀO ĐƯỢC.
    // ==========================================================================================
    const keLap = await nguoi("k199-xin@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const duyet1 = await nguoi("k199-duyet-1@vidu.vn", ["DIRECTOR"]);
    const duyet2 = await nguoi("k199-duyet-2@vidu.vn", ["DIRECTOR"]);
    const rfqId = await rfqDaDong(keLap, [duyet1, duyet2]);
    const ob = outboxTest(apiPool, dv.services);

    const demMa = async (uid: string): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM user_login_tokens WHERE org_id = $1 AND user_id = $2",
        [orgA, uid],
      );
      return Number(rows[0]?.n ?? "-1");
    };

    for (let i = 0; i < 4; i += 1) {
      const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, keLap, { reason: "den gio mo thau" });
      expect(yc.status, `vòng ${i}: ${yc.text}`).toBe(201);
      await ob.chay(orgA);
      const id = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
      expect((await goi("POST", `/unseal/${id}/cancel`, keLap)).status, "người YÊU CẦU tự rút lời của mình").toBe(200);
    }
    expect(ob.loi, "không job nào được phép hỏng").toEqual([]);

    expect(await demMa(duyet1.id), "hệ thống chỉ được tiêu tối đa trần RIÊNG của nó").toBe(HE_THONG_MAX_TOKENS_PER_WINDOW);
    expect(await demMa(duyet2.id)).toBe(HE_THONG_MAX_TOKENS_PER_WINDOW);
    expect(HE_THONG_MAX_TOKENS_PER_WINDOW, "trần hệ thống phải NHỎ HƠN HẲN trần tự phục vụ").toBeLessThan(
      LOGIN_MAX_TOKENS_PER_WINDOW,
    );

    // Tin thứ ba trở đi vẫn ĐI, chỉ không mang mã — hợp đồng `token: string | null`.
    const choDuyet1 = dv.thongBaoDaGui.filter((t) => t.email === "k199-duyet-1@vidu.vn");
    expect(choDuyet1.length, "bốn vòng ⇒ bốn tin, không tin nào bị nuốt").toBe(4);
    expect(choDuyet1.filter((t) => t.token !== null), "chỉ hai tin đầu mang mã").toHaveLength(HE_THONG_MAX_TOKENS_PER_WINDOW);

    // VẾ ĐÁNG GIÁ: nạn nhân tự xin link và NHẬN ĐƯỢC.
    const truoc = dv.linkDaGui.length;
    const xin = await goi("POST", "/auth/link", null, { orgId: orgA, email: "k199-duyet-1@vidu.vn" });
    expect(xin.status).toBe(200);
    await ob.chay(orgA);
    expect(
      dv.linkDaGui.slice(truoc).some((l) => l.email === "k199-duyet-1@vidu.vn"),
      "người duyệt VẪN tự đăng nhập được sau bốn vòng tấn công — đây là chính khoản 199",
    ).toBe(true);
  });

  it("[khoản 199] chỉ người YÊU CẦU hoặc người DUYỆT được huỷ, và lần từ chối để lại một hàng sổ", async () => {
    const xin = await nguoi("k199b-xin@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const pmKhac = await nguoi("k199b-pm-khac@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const gd1 = await nguoi("k199b-gd1@vidu.vn", ["DIRECTOR"]);
    const gd2 = await nguoi("k199b-gd2@vidu.vn", ["DIRECTOR"]);
    const rfqId = await rfqDaDong(xin, [gd1, gd2]);

    const demTuChoiHuy = async (uid: string): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'UNSEAL_CANCEL_DENIED'",
        [orgA, uid],
      );
      return Number(rows[0]?.n ?? "-1");
    };

    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, xin, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    const id = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;

    // Một PM KHÁC giữ đúng `rfq.unseal` — tới trước vòng này chừng ấy là đủ để xoá công của hai người.
    const truoc = await demTuChoiHuy(pmKhac.id);
    const tuChoi = await goi("POST", `/unseal/${id}/cancel`, pmKhac);
    expect(tuChoi.status, tuChoi.text).toBe(422);
    expect(await demTuChoiHuy(pmKhac.id), "[INV-D5] mỗi lần từ chối để lại ĐÚNG một hàng").toBe(truoc + 1);

    // Yêu cầu vẫn sống — lần từ chối không được phép đổi trạng thái gì.
    const con = await goi("GET", `/rfqs/${rfqId}/unseal`, gd1);
    expect((con.body as { unsealRequest: { id: string } | null }).unsealRequest?.id).toBe(id);

    // Người DUYỆT thì huỷ được: một yêu cầu kẹt vẫn phải có đường dừng.
    expect((await goi("POST", `/unseal/${id}/cancel`, gd1)).status, "người giữ rfq.unseal.approve huỷ được").toBe(200);
  });

  it("[khoản 154] gia hạn hạn nộp ⇒ tin tới ĐÚNG đích của lời mời; lời mời đã thu hồi thì KHÔNG gửi", async () => {
    const pm = await nguoi("bao-han-pm@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const { rows: ncc } = await db.pool.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, 'Thep Bao Tin', '0311111111', $2, $3) RETURNING id",
      [orgA, pm.id, pm.sessionId],
    );
    const supplierId = ncc[0]?.id ?? "";
    const { rows: lh } = await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Chi Tin', 'tin@thepbaotin.vn', '0912345678', $3, $4) RETURNING id",
      [orgA, supplierId, pm.id, pm.sessionId],
    );
    const contactId = lh[0]?.id ?? "";

    const gdH1 = await nguoi("bao-han-gd1@vidu.vn", ["DIRECTOR"]);
    const gdH2 = await nguoi("bao-han-gd2@vidu.vn", ["DIRECTOR"]);
    const rfqId = await rfqDaDong(pm, [gdH1, gdH2], false);
    const { rows: moi } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
      [orgA, rfqId, supplierId, contactId, pm.id, pm.sessionId],
    );
    const invitationId = moi[0]?.id ?? "";

    const hanMoi = new Date(Date.now() + 9 * 24 * 3600 * 1000).toISOString();
    const gh = await goi("POST", `/rfqs/${rfqId}/extend`, pm, { newDeadlineAt: hanMoi, reason: "them thoi gian" });
    expect(gh.status, gh.text).toBe(200);

    const truoc = dv.hanMoiDaGui.length;
    const ob = outboxTest(apiPool, dv.services);
    await ob.chay(orgA);
    const daGui = dv.hanMoiDaGui.slice(truoc).filter((t) => t.invitationId === invitationId);
    expect(ob.loi).toEqual([]);
    expect(daGui, "một lời mời còn sống ⇒ đúng một tin").toHaveLength(1);
    expect(daGui[0]?.destination, "kênh EMAIL ⇒ địa chỉ email của người liên hệ").toBe("tin@thepbaotin.vn");
    expect(daGui[0]?.channel).toBe("EMAIL");

    // VẾ NGƯỢC, và nó là vế đáng giá — dựng trên một gói thầu THỨ HAI chứ không gia hạn lần nữa.
    //
    // Vì sao không gia hạn lần hai trên cùng gói: một lần gia hạn ĐỔI NỘI DUNG, và hai phê duyệt RFQ
    // được ràng vào nội dung ấy — lần gia hạn thứ hai bị từ chối `422` với *"RFQ nay can 2 phe duyet
    // TREN NOI DUNG HIEN TAI, moi co 0 (D2)"*. Đó là hành vi ĐÚNG và đáng ghi: đổi hạn nộp làm mất
    // hiệu lực chữ ký cũ. Test này đo chặng GỬI, không đo lại vế ấy.
    const rfqB = await rfqDaDong(pm, [gdH1, gdH2], false);
    const { rows: moiB } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
      [orgA, rfqB, supplierId, contactId, pm.id, pm.sessionId],
    );
    const invitationB = moiB[0]?.id ?? "";
    await db.pool.query("UPDATE rfq_invitations SET revoked_at = now(), status = 'REVOKED', revoked_by = $2, revoked_by_session_id = $3 WHERE id = $1", [invitationB, pm.id, pm.sessionId]);

    const han2 = new Date(Date.now() + 11 * 24 * 3600 * 1000).toISOString();
    const ghB = await goi("POST", `/rfqs/${rfqB}/extend`, pm, { newDeadlineAt: han2, reason: "gia han goi B" });
    expect(ghB.status, ghB.text).toBe(200);
    const truoc2 = dv.hanMoiDaGui.length;
    await ob.chay(orgA);
    expect(
      dv.hanMoiDaGui.slice(truoc2).filter((t) => t.invitationId === invitationB),
      "một thông báo gia hạn gửi cho người đã bị rút lời mời là một tin nói sai về trạng thái của họ",
    ).toHaveLength(0);
  });

  // =============================================================================================
  // [S1.98 / khoản 125] MỘT LỜI MỜI CÒN SỐNG MÀ NGƯỜI MUA KHÔNG GIỮ ID THÌ KHÔNG THU HỒI ĐƯỢC,
  // VÀ MỜI LẠI NHÀ CUNG CẤP ẤY LUÔN 409.
  //
  // Id lời mời chỉ đi ra ở thân `201` của `POST /rfqs/:rfqId/invitations` (và ở thân `500` của ca
  // bù hỏng, từ S1.70). Mất phản hồi ấy là kẹt: `revoked_at` chỉ do `revokeInvitation` đặt nên
  // lời mời không tự hết, còn `rfq_invitations_mot_loi_moi_con_song` (024) biến mọi lần mời lại
  // thành 409. Phép đo dưới đây dựng đúng cảnh ấy — lời mời có thật, id thì KHÔNG ai cầm — rồi đi
  // trọn đường thoát mà khoản 125 kê: đọc danh sách, thu hồi bằng id đọc được, mời lại.
  // =============================================================================================
  it("[khoản 125] danh sách lời mời trả id nên lời mời kẹt thu hồi được rồi mời lại 201 — và danh sách KHÔNG mang token, cổng quyền là rfq.invite", async () => {
    const pm = await nguoi("ds-moi-pm@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const gdA = await nguoi("ds-moi-gd1@vidu.vn", ["DIRECTOR"]);
    const gdB = await nguoi("ds-moi-gd2@vidu.vn", ["DIRECTOR"]);
    // TECHNICAL KHÔNG giữ `rfq.invite` — xem ma trận quyền ở `packages/identity`.
    const ktv = await nguoi("ds-moi-kt@vidu.vn", ["TECHNICAL"]);

    const { rows: ncc } = await db.pool.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, 'Thep Danh Sach', '0322222222', $2, $3) RETURNING id",
      [orgA, pm.id, pm.sessionId],
    );
    const supplierId = ncc[0]?.id ?? "";
    const { rows: lh } = await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Chi Ds', 'ds@thepdanhsach.vn', '0913333333', $3, $4) RETURNING id",
      [orgA, supplierId, pm.id, pm.sessionId],
    );
    const contactId = lh[0]?.id ?? "";
    const rfqId = await rfqDaDong(pm, [gdA, gdB], false);

    // Lời mời KẸT: dựng thẳng bằng SQL, tức không ai cầm thân `201` — đúng cảnh mà khoản 125 tả.
    const { rows: ket } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
      [orgA, rfqId, supplierId, contactId, pm.id, pm.sessionId],
    );
    const idKet = ket[0]?.id ?? "";

    // ⑴ Mời lại khi lời mời cũ còn sống: 409 — đây là cái bẫy mà khoản 125 nói tới.
    const trung = await goi("POST", `/rfqs/${rfqId}/invitations`, pm, { supplierId, contactId });
    expect(trung.status, trung.text).toBe(409);

    // ⑵ Danh sách trả ĐÚNG id ấy, kèm tên người để người mua nhận ra mình đang thu hồi của ai.
    const ds = await goi("GET", `/rfqs/${rfqId}/invitations`, pm);
    expect(ds.status, ds.text).toBe(200);
    const dsMoi = (ds.body as { invitations: readonly { id: string; supplierName: string; contactName: string; status: string; revokedAt: string | null }[] }).invitations;
    expect(dsMoi).toHaveLength(1);
    expect(dsMoi[0]?.id, "id ấy TRƯỚC vòng này không route đọc nào trả").toBe(idKet);
    expect(dsMoi[0]?.supplierName).toBe("Thep Danh Sach");
    expect(dsMoi[0]?.contactName).toBe("Chi Ds");
    expect(dsMoi[0]?.status).toBe("SENT");
    expect(dsMoi[0]?.revokedAt).toBeNull();

    // ⑶ CỔNG QUYỀN: danh sách ai được mời là thông tin cạnh tranh. TECHNICAL bị 403, và lần từ
    //    chối ấy để lại ĐÚNG một hàng sổ — cổng nằm trong thân hàm, không ở cờ của route.
    const demTuChoi = async (): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND resource_id = $2",
        [orgA, rfqId],
      );
      return Number(rows[0]?.n ?? "0");
    };
    const truocTuChoi = await demTuChoi();
    const cam = await goi("GET", `/rfqs/${rfqId}/invitations`, ktv);
    expect(cam.status, cam.text).toBe(403);
    expect(await demTuChoi(), "[INV-D5] một lần từ chối ⇒ một hàng sổ").toBe(truocTuChoi + 1);

    // ⑷ Thu hồi bằng id vừa đọc, rồi mời lại: 201. Vòng kẹt thoát ra được.
    expect((await goi("POST", `/invitations/${idKet}/revoke`, pm)).status).toBe(200);
    const truocGui = dv.loiMoiDaGui.length;
    const lai = await goi("POST", `/rfqs/${rfqId}/invitations`, pm, { supplierId, contactId });
    expect(lai.status, lai.text).toBe(201);
    expect(dv.loiMoiDaGui).toHaveLength(truocGui + 1);
    const tokenThat = dv.loiMoiDaGui.at(-1)?.token ?? "";
    expect(tokenThat.length, "tiền đề: lần mời lại đã phát một token THẬT").toBeGreaterThan(20);

    // ⑸ Danh sách nay hai dòng — một đã thu hồi, một còn sống — và KHÔNG mang một byte nào của
    //    token. `rfq_invitations` không có cột token nào (mã sống ở `rfq_invitation_tokens`), nên
    //    khẳng định này canh cấu tạo chứ không canh một câu SELECT tự giữ mình.
    const ds2 = await goi("GET", `/rfqs/${rfqId}/invitations`, pm);
    expect(ds2.status).toBe(200);
    const dsHai = (ds2.body as { invitations: readonly { id: string; status: string; revokedAt: string | null }[] }).invitations;
    expect(dsHai).toHaveLength(2);
    expect(dsHai.filter((m) => m.status === "REVOKED").map((m) => m.id)).toEqual([idKet]);
    expect(dsHai.filter((m) => m.revokedAt === null)).toHaveLength(1);
    expect(ds2.text, "danh sách lời mời KHÔNG được mang mã mời").not.toContain(tokenThat);
  });
});
