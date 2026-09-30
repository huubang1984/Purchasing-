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
//   [INV-K1]  [S1.166] tổ chức đã bật S3: nộp duyệt gói không ngân sách ⇒ 422 có tên, một hàng CONTROL_DENIED.
//   [S1.169] ký phiên bản chính sách: cờ triển khai TẮT ⇒ 409, không câu ghi; BẬT ⇒ mỗi luật trigger một 422 có tên, người
//             thứ hai ký bản mới nhất ⇒ bật S3; phiên bản kế tiếp tính theo bản MỚI NHẤT, không theo bản hiệu lực.
//   [INV-K10a] [S1.203] gói thứ ba của ba gói 480/470/490 triệu cùng nhóm ⇒ mở 422 có tên và một hàng CONTROL_DENIED; người
//             gây ra ghi nhận ⇒ 422 có tên; không `rfq.approve` ⇒ 403; người độc lập ghi nhận ⇒ 201, rồi mở 200.
// ==============================================================================================
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { CHOT_VAO_SO, HE_THONG_MAX_TOKENS_PER_WINDOW, LOGIN_MAX_TOKENS_PER_WINDOW, PERMISSIONS } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
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

async function nguoi(email: string, roles: readonly string[], org: string = orgA): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi') RETURNING id",
    [org, email],
  );
  const id = rows[0]?.id ?? "";
  for (const r of roles) {
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, r]);
  }
  const token = randomBytes(32).toString("base64url");
  const s = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [org, id, sha256(token)],
  );
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}`, sessionId: s.rows[0]?.id ?? "" };
}

interface PhanHoi {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
}

/** `tai`: gốc của máy chủ nhận lời gọi — mặc định máy chủ chung của tệp; [S1.169] ca ký chính sách dựng máy chủ thứ hai. */
async function goi(method: string, path: string, ai: Nguoi | null, body?: unknown, tai: string = goc): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
  if (ai !== null) headers.cookie = ai.cookie;
  let than: string | undefined;
  if (body !== undefined) {
    than = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${tai}${path}`, { method, headers, body: than });
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
  // [S1.186] Hai lượt quét dồn MỌI lần từ chối vào một phiên — tới một lần mỗi route ghi. Trần từ chối theo phiên
  // (`TU_CHOI_TRAN_MOI_CUA_SO` = 30, khoản 144 · 248) là một phép đo KHÁC, ở `auth.int.test.ts`; khi số route ghi vượt 30
  // (S3.2b1 thêm route thứ 31), route cuối của lượt quét nhận 429 của trần chứ không nhận 403 của cổng quyền. Nên hai lượt
  // quét chạy trên máy chủ THỨ HAI có trần rộng hơn số route, suy từ chính bảng; máy chủ chung giữ trần mặc định.
  let gocQuet = "";
  let serverQuet: ReturnType<typeof createApiServer> | undefined;

  beforeAll(async () => {
    const tran = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self !== true).length + 1;
    const s = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, tranTuChoi: tran }));
    serverQuet = s;
    await new Promise<void>((xong) => s.listen(0, "127.0.0.1", xong));
    gocQuet = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((xong) => (serverQuet === undefined ? xong() : serverQuet.close(() => xong())));
  });

  it("[INV-H17] [INV-D5] mỗi route ghi ⇒ 403, và số bản ghi PERMISSION_DENIED tăng đúng bằng số route", async () => {
    const khongQuyen = await nguoi("khongquyen@vidu.vn", []);
    const routeGhi = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self !== true);
    expect(routeGhi.length, "phải có route ghi để quét — rỗng là rỗng ruột").toBeGreaterThan(15);
    const truoc = await demTuChoi(khongQuyen.id);
    const lot: string[] = [];
    for (const r of routeGhi) {
      const path = r.path.replace(/:[A-Za-z]+/gu, UUID0);
      const kq = await goi(r.method, path, khongQuyen, {}, gocQuet);
      if (kq.status !== 403) lot.push(`${r.method} ${r.path} -> ${kq.status}`);
    }
    expect(lot, "route ghi cho một phiên KHÔNG có quyền nào đi qua mà không 403").toEqual([]);
    expect(await demTuChoi(khongQuyen.id)).toBe(truoc + routeGhi.length);
    // [review H2-9] [INV-D5] Bản ghi từ chối mang TOẠ ĐỘ: mọi route khai `resourceId` (đọc từ đường
    // dẫn) để lại `resource_id = UUID0`; số bản ghi có toạ độ bằng đúng số route khai nó.
    const coToaDo = routeGhi.filter((r) => "resourceId" in r && r.resourceId !== undefined).length;
    expect(coToaDo, "phải có route khai resourceId").toBeGreaterThan(10);
    // ~~Đếm `3`~~ ~~[S1.201 / S3.6a] `4` — thêm `POST /categories` (tạo mới)~~ [S1.199 / S4.2b] Nêu TÊN thay vì đếm: ba route
    // tạo mới cũ, `POST /categories` (tạo mới, S3.6a), `POST /items` (tạo mới) và hai route bí danh đơn vị — thứ chúng ghi là một
    // CHUỖI của tổ chức, không phải một tài nguyên có UUID trên đường dẫn.
    expect(
      routeGhi.filter((r) => !("resourceId" in r && r.resourceId !== undefined)).map((r) => `${r.method} ${r.path}`).sort(),
      "route ghi KHÔNG có toạ độ",
    ).toEqual([
      "POST /categories",
      "POST /items",
      "POST /policy",
      "POST /rfqs",
      "POST /suppliers",
      "POST /uom/aliases",
      "POST /uom/aliases/withdraw",
    ]);
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
        const kq = await goi(r.method, path, ng, {}, gocQuet);
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
    // [review H2-3] `version` chỉ là giá trị KỲ VỌNG: phải bằng ~~hiện hành~~ [S1.169] mới nhất + 1. Một `2147483647` (trần
    // int4 — ghim tổ chức vĩnh viễn vì trigger 022 đòi "lớn hơn" và không có UPDATE/DELETE) bị 422.
    const ghim = await goi("POST", "/policy", tc, { version: 2147483647, dualApprovalThreshold: "0.01", currency: "VND" });
    expect(ghim.status, ghim.text).toBe(422);
    expect(ghim.text).toContain("mới nhất + 1 (2)");
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
    // [S1.213 / khoản 133] Bấm điều phối LẦN HAI khi lượt đầu còn PENDING: 422 cùng câu như trước, và — mới — đúng một hàng
    // `UNSEAL_DISPATCH_DENIED`. Đo trước bản vá: 422, 0 hàng. Đối chứng ngay trước đó: lần điều phối ĐẦU (200) không để lại hàng
    // từ chối nào, và hai lần phê duyệt THẬT ở trên không để lại `UNSEAL_NOT_FOUND_DENIED` nào.
    const demHangTuChoi = async (action: string): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3",
        [orgA, action, unsealId],
      );
      return Number(rows[0]?.n ?? "-1");
    };
    expect(await demHangTuChoi("UNSEAL_DISPATCH_DENIED"), "đối chứng: lần điều phối ĐẦU không phải một lần từ chối").toBe(0);
    expect(await demHangTuChoi("UNSEAL_NOT_FOUND_DENIED"), "đối chứng: hai lần phê duyệt một id CÓ THẬT không phải 'không tìm thấy'").toBe(0);
    const lanHai = await goi("POST", `/unseal/${unsealId}/dispatch`, gd1);
    expect(lanHai.status, lanHai.text).toBe(422);
    expect(lanHai.text).toContain("vẫn còn một lượt đang chờ chạy");
    expect(await demHangTuChoi("UNSEAL_DISPATCH_DENIED"), "[INV-D5] lần bấm thứ hai để lại ĐÚNG một hàng").toBe(1);
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
/**
 * [S1.217 / khoản 250] Đưa ra cấp mô-đun (nguyên văn) để khối thu hồi sau mở thầu dùng chung — trước đó nằm trong
 * `describe("[khoản 194 · 154]…")`.
 *
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

describe("[khoản 194 · 154] hai tin báo mà tới S1.90 không tiến trình nào gửi", () => {
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

    // [S1.9101 / khoản 267, tích hợp lô B1] Huỷ lần nữa một yêu cầu ĐÃ HUỶ: câu 422 riêng kèm `ma` (không còn câu gộp với "không
    // tìm thấy"), và ĐÚNG một hàng `UNSEAL_CANCEL_DENIED` mang lý do trạng thái — lần từ chối trạng thái nay vào sổ (luật ADR-060).
    const truocLan2 = await demTuChoiHuy(xin.id);
    const lan2 = await goi("POST", `/unseal/${id}/cancel`, xin);
    expect([lan2.status, lan2.body]).toEqual([
      422,
      {
        error: "Yêu cầu mở thầu này không còn ở trạng thái huỷ được — nó đã được mở thầu hoặc đã bị huỷ.",
        ma: "KHONG_O_TRANG_THAI_HUY_DUOC",
      },
    ]);
    expect(await demTuChoiHuy(xin.id), "[INV-D5] lần từ chối trạng thái để lại ĐÚNG một hàng").toBe(truocLan2 + 1);
    const { rows: hangLan2 } = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'UNSEAL_CANCEL_DENIED' AND resource_id = $3",
      [orgA, xin.id, id],
    );
    expect(hangLan2.map((h) => h.payload)).toEqual([{ lyDo: "KHONG_O_TRANG_THAI_HUY_DUOC" }]);
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
    // ~~Vì sao không gia hạn lần hai trên cùng gói: một lần gia hạn ĐỔI NỘI DUNG, và hai phê duyệt RFQ
    // được ràng vào nội dung ấy — lần gia hạn thứ hai bị từ chối `422` với *"RFQ nay can 2 phe duyet
    // TREN NOI DUNG HIEN TAI, moi co 0 (D2)"*. Đó là hành vi ĐÚNG và đáng ghi: đổi hạn nộp làm mất
    // hiệu lực chữ ký cũ.~~ [S1.140 / khoản 240] Câu vừa gạch SAI: lần gia hạn ĐẦU ngay trên đổi cùng
    // cột ấy và đi qua, và spec S0+S1 §4.4 không đòi ký lại khi gia hạn. Đó là lỗi của khối đếm chữ ký
    // chạy ở mọi câu UPDATE; `067` sửa nó. Gói thứ hai ở lại vì vế nó đo khác: lời mời ĐÃ THU HỒI
    // không nhận tin. Test này đo chặng GỬI.
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

describe("[S1.166 / S3.1b] K1 qua HTTP — lời từ chối của một CHỐT KIỂM SOÁT đi ra dưới 422 có tên", () => {
  it("[INV-K1] tổ chức đã bật: nộp duyệt gói không ngân sách ⇒ 422 mang thông điệp của bảng chốt và một hàng `CONTROL_DENIED`; đặt ngân sách thì 200", async () => {
    // Tổ chức RIÊNG: công tắc ADR-080 một chiều, bật ở `orgA` là đổi mọi ca khác của tệp này.
    const orgB = (
      await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty B', 'cong-ty-b-k1') RETURNING id")
    ).rows[0]?.id ?? "";
    const pm = await nguoi("pm-k1@vidu.vn", ["PROCUREMENT_MANAGER"], orgB);
    const tc = await nguoi("tc-k1@vidu.vn", ["FINANCE"], orgB);
    const tc2 = await nguoi("tc2-k1@vidu.vn", ["FINANCE"], orgB);
    expect((await goi("POST", "/policy", tc, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(201);
    // Phiên bản có bậc và chữ ký thứ hai: câu DỰNG dưới chủ sở hữu — route của chúng là S3.1c. Mọi trigger vẫn chạy.
    const bac = [
      {
        tu_so_tien: 0,
        so_ncc_toi_thieu: 1,
        award_vai_khac_nhau: false,
        ky_danh_sach_moi: false,
        xoay_vong_n: 0,
        award_so_chu_ky: 1,
        award_vai: ["DIRECTOR"],
        tham_dinh_truoc_trao: false,
        khai_xung_dot: false,
        dau_thau_chinh_thuc: false,
      },
      { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
    ];
    const v2 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, chia_nho_cua_so_ngay, " +
          "tham_dinh_hieu_luc_thang, created_by, created_by_session_id) VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, $3, $4) RETURNING id",
        [orgB, JSON.stringify(bac), tc.id, tc.sessionId],
      )
    ).rows[0]?.id;
    await db.pool.query(
      "INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)",
      [orgB, v2, tc2.id, tc2.sessionId],
    );

    const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const rfq = await goi("POST", "/rfqs", pm, { title: "Mua thep K1", deadlineAt: han });
    expect(rfq.status, rfq.text).toBe(201);
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    const nop = await goi("POST", `/rfqs/${rfqId}/submit`, pm);
    // 422 CÓ TÊN, không 500: thiếu dòng `ChotKiemSoatError` ở `LOI_NGHIEP_VU_422` thì lời từ chối đi ra như một sự cố.
    expect(nop.status, nop.text).toBe(422);
    expect(nop.text).toContain("phải có ngân sách dự tính trước khi nộp duyệt");
    const { rows } = await db.pool.query<{ ma: string; actor: string }>(
      "SELECT payload->>'ma' AS ma, actor_id::text AS actor FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2",
      [orgB, rfqId],
    );
    expect(rows).toEqual([{ ma: "THIEU_NGAN_SACH", actor: pm.id }]);

    const ns = await goi("PUT", `/rfqs/${rfqId}/budget`, pm, { estimatedValue: "150000000.00", currency: "VND" });
    expect(ns.status, ns.text).toBe(200);
    // [S1.201 / S3.6a] Có ngân sách mà chưa có nhóm hàng ⇒ chốt thứ hai của cạnh nói, cùng khuôn: 422 có tên và MỘT hàng sổ.
    const thieuNhom = await goi("POST", `/rfqs/${rfqId}/submit`, pm);
    expect(thieuNhom.status, thieuNhom.text).toBe(422);
    expect(thieuNhom.text).toContain("phải có nhóm hàng trước khi nộp duyệt");
    const nhom = await goi("POST", "/categories", tc, { ma: "thep", ten: "Thep xay dung" });
    expect(nhom.status, nhom.text).toBe(201);
    const nhomId = (nhom.body as { nhomHang: { id: string; ma: string } }).nhomHang.id;
    expect((nhom.body as { nhomHang: { ma: string } }).nhomHang.ma).toBe("THEP");
    // Thân thiếu `categoryId` là 422, không phải một lần XOÁ nhóm hàng của gói đang soạn.
    expect((await goi("PUT", `/rfqs/${rfqId}/category`, pm, {})).status).toBe(422);
    const dat = await goi("PUT", `/rfqs/${rfqId}/category`, pm, { categoryId: nhomId });
    expect(dat.status, dat.text).toBe(200);
    expect((dat.body as { rfq: { categoryId: string } }).rfq.categoryId).toBe(nhomId);
    const lai = await goi("POST", `/rfqs/${rfqId}/submit`, pm);
    expect(lai.status, lai.text).toBe(200);
    const { rows: chot } = await db.pool.query<{ ma: string }>(
      "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
      [orgB, rfqId],
    );
    expect(chot.map((r) => r.ma)).toEqual(["THIEU_NGAN_SACH", "THIEU_NHOM_HANG"]);
    // Nhóm hàng khoá sau DRAFT: đổi lúc gói chờ duyệt là lời từ chối trạng thái có tên, không 500.
    const doiMuon = await goi("PUT", `/rfqs/${rfqId}/category`, pm, { categoryId: nhomId });
    expect(doiMuon.status, doiMuon.text).toBe(422);
    // Danh sách và đổi trạng thái: người tạo gói (PM) đọc được nhưng không quản lý được; FINANCE ngừng dùng được.
    const ds = await goi("GET", "/categories", pm);
    expect(ds.status, ds.text).toBe(200);
    expect((ds.body as { nhomHang: { id: string; conDung: boolean }[] }).nhomHang).toEqual([expect.objectContaining({ id: nhomId, conDung: true })]);
    expect((await goi("POST", "/categories", pm, { ma: "VPP", ten: "Van phong pham" })).status).toBe(403);
    expect((await goi("PUT", `/categories/${nhomId}/status`, pm, { conDung: false })).status).toBe(403);
    const ngung = await goi("PUT", `/categories/${nhomId}/status`, tc, { conDung: false });
    expect(ngung.status, ngung.text).toBe(200);
    expect((ngung.body as { nhomHang: { conDung: boolean } }).nhomHang.conDung).toBe(false);
    expect((await goi("PUT", `/categories/${nhomId}/status`, tc, { conDung: "khong" })).status).toBe(422);
    expect((await goi("PUT", `/rfqs/${rfqId}/category`, pm, { categoryId: "khong-phai-uuid" })).status).toBe(422);
  });
});

/** Tổ chức RIÊNG, gói do PM tạo đã nộp duyệt. `bat`: BẬT S3 bằng câu dựng dưới chủ sở hữu, khuôn ca K1 ở trên. */
async function goiDaNop(slug: string, bat: boolean): Promise<{ org: string; pm: Nguoi; mua: Nguoi; rfqId: string }> {
  const org = (
    await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [slug])
  ).rows[0]?.id ?? "";
  const pm = await nguoi(`pm-${slug}@vidu.vn`, ["PROCUREMENT_MANAGER"], org);
  const mua = await nguoi(`mua-${slug}@vidu.vn`, ["BUYER"], org);
  const tc = await nguoi(`tc-${slug}@vidu.vn`, ["FINANCE"], org);
  const tc2 = await nguoi(`tc2-${slug}@vidu.vn`, ["FINANCE"], org);
  expect((await goi("POST", "/policy", tc, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(201);
  if (bat) {
    const bac = [
      {
        tu_so_tien: 0,
        so_ncc_toi_thieu: 1,
        award_vai_khac_nhau: false,
        ky_danh_sach_moi: false,
        xoay_vong_n: 0,
        award_so_chu_ky: 1,
        award_vai: ["DIRECTOR"],
        tham_dinh_truoc_trao: false,
        khai_xung_dot: false,
        dau_thau_chinh_thuc: false,
      },
      { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
    ];
    const v2 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, chia_nho_cua_so_ngay, " +
          "tham_dinh_hieu_luc_thang, created_by, created_by_session_id) VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, $3, $4) RETURNING id",
        [org, JSON.stringify(bac), tc.id, tc.sessionId],
      )
    ).rows[0]?.id;
    await db.pool.query(
      "INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)",
      [org, v2, tc2.id, tc2.sessionId],
    );
  }
  const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const rfq = await goi("POST", "/rfqs", pm, { title: "Mua thep tra ve", deadlineAt: han });
  expect(rfq.status, rfq.text).toBe(201);
  const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
  expect((await goi("PUT", `/rfqs/${rfqId}/budget`, pm, { estimatedValue: "1000000.00", currency: "VND" })).status).toBe(200);
  // [S1.201 / S3.6a] Tổ chức đã bật đòi nhóm hàng trước lần nộp — người tài chính dựng nhóm, người tạo gói gán nó.
  if (bat) {
    const nhom = await goi("POST", "/categories", tc, { ma: "THEP", ten: "Thep" });
    expect(nhom.status, nhom.text).toBe(201);
    const nhomId = (nhom.body as { nhomHang: { id: string } }).nhomHang.id;
    expect((await goi("PUT", `/rfqs/${rfqId}/category`, pm, { categoryId: nhomId })).status).toBe(200);
  }
  const nop = await goi("POST", `/rfqs/${rfqId}/submit`, pm);
  expect(nop.status, nop.text).toBe(200);
  return { org, pm, mua, rfqId };
}

describe("[S1.186 / S3.2b1] cạnh `PENDING_APPROVAL→DRAFT` qua HTTP — chỉ tổ chức đã bật, người tạo hoặc người duyệt, có lý do", () => {
  it("[INV-K4a] tổ chức đã bật: BUYER không phải người tạo ⇒ 403 và một hàng `PERMISSION_DENIED` trên `rfq.approve`; thiếu lý do ⇒ 422; người tạo có lý do ⇒ 200 và gói ở DRAFT; lần hai ⇒ 422 trạng thái", async () => {
    const { org, pm, mua, rfqId } = await goiDaNop("tra-ve-bat", true);
    const duong = `/rfqs/${rfqId}/return-to-draft`;

    const bi = await goi("POST", duong, mua, { reason: "buyer khong phai nguoi tao" });
    expect(bi.status, bi.text).toBe(403);
    const { rows } = await db.pool.query<{ q: string }>(
      "SELECT payload->>'permission' AS q FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [org, mua.id],
    );
    expect(rows.map((r) => r.q)).toEqual(["rfq.approve"]);

    const thieu = await goi("POST", duong, pm, {});
    expect([thieu.status, thieu.text]).toEqual([422, JSON.stringify({ error: 'thiếu trường "reason"' })]);

    const ve = await goi("POST", duong, pm, { reason: "bo sung nha cung cap truoc khi duyet" });
    expect(ve.status, ve.text).toBe(200);
    expect((ve.body as { rfq: { status: string } }).rfq.status).toBe("DRAFT");

    const lan2 = await goi("POST", duong, pm, { reason: "lan hai" });
    expect([lan2.status, (lan2.body as { error: string }).error]).toEqual([
      422,
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    ]);
  });

  it("[INV-K4a] tổ chức CHƯA bật: người tạo có lý do ⇒ 422 có tên, gói ở nguyên PENDING_APPROVAL", async () => {
    const { pm, rfqId } = await goiDaNop("tra-ve-chua-bat", false);
    const kq = await goi("POST", `/rfqs/${rfqId}/return-to-draft`, pm, { reason: "muon sua danh sach" });
    expect([kq.status, (kq.body as { error: string }).error]).toEqual([422, "chỉ tổ chức đã bật S3 mới trả gói về nháp được"]);
    expect((await goi("GET", `/rfqs/${rfqId}`, pm)).body).toMatchObject({ rfq: { status: "PENDING_APPROVAL" } });
  });
});

describe("[S1.198 / khoản 256] lời duyệt gói qua HTTP mang `lanNop` vừa đọc — bắt buộc ở tổ chức đã bật, MVP1 giữ hợp đồng không thân", () => {
  it("[INV-K4b] tổ chức đã bật: `GET` trả `lanNop` 1; duyệt không thân, thân rỗng, mốc 0 hay `null` ⇒ 422 có tên; mốc không phải số nguyên hay tràn `integer` ⇒ 422; mốc 1 ⇒ 200", async () => {
    const { org, rfqId } = await goiDaNop("lan-nop-bat", true);
    const pm2 = await nguoi("pm2-lan-nop-bat@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    expect((await goi("GET", `/rfqs/${rfqId}`, pm2)).body).toMatchObject({ rfq: { lanNop: 1 } });

    const duong = `/rfqs/${rfqId}/approve`;
    const loiLanNop = { error: "Goi thau dang o lan nop 1; loi duyet khong mang dung lan nop nay — doc lai goi roi duyet (K4b)" };
    for (const than of [undefined, {}, { lanNop: 0 }, { lanNop: null }]) {
      const kq = await goi("POST", duong, pm2, than);
      expect([kq.status, kq.body], JSON.stringify(than) ?? "không thân").toEqual([422, loiLanNop]);
    }
    const chuoi = await goi("POST", duong, pm2, { lanNop: "1" });
    expect([chuoi.status, chuoi.body]).toEqual([422, { error: 'trường "lanNop" phải là số nguyên' }]);
    // Tràn `integer` của cột: Postgres từ chối lúc gắn tham số (22003), TRƯỚC mọi trigger — lớp 22 là lỗi đầu vào, 422 thân cố định.
    const tran = await goi("POST", duong, pm2, { lanNop: 2147483648 });
    expect([tran.status, tran.body]).toEqual([422, { error: "du lieu sai kieu" }]);

    const ok = await goi("POST", duong, pm2, { lanNop: 1 });
    expect(ok.status, ok.text).toBe(200);
  });

  it("tổ chức CHƯA bật: duyệt không thân ⇒ 200 như MVP1 — hợp đồng route không đổi", async () => {
    const { org, rfqId } = await goiDaNop("lan-nop-chua-bat", false);
    const pm2 = await nguoi("pm2-lan-nop-chua-bat@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const kq = await goi("POST", `/rfqs/${rfqId}/approve`, pm2);
    expect(kq.status, kq.text).toBe(200);
  });
});

describe("[S1.200 / khoản 258] `GET /rfqs/:rfqId/budget` — người duyệt đọc được ngân sách mình ký; người tạo gói và người giữ `rfq.approve`, không ai khác", () => {
  /** Hàng từ chối của một người, dạng `loại tài nguyên quyền` — lần đọc ngân sách mang loại riêng `RFQ_BUDGET` (lượt soi F2). */
  async function demTuChoiNganSach(org: string, ai: string): Promise<string[]> {
    const { rows } = await db.pool.query<{ q: string }>(
      "SELECT resource_type || ' ' || (payload->>'permission') AS q FROM audit_events " +
        "WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED' ORDER BY seq",
      [org, ai],
    );
    return rows.map((r) => r.q);
  }

  it("[INV-K4b] tổ chức đã bật, gói chờ duyệt: người tạo và người duyệt đọc đủ năm thứ chữ ký ràng vào; BUYER khác và FINANCE ⇒ 403, một hàng `PERMISSION_DENIED` trên `rfq.approve`; mã gói lạ ⇒ 404", async () => {
    const { org, pm, mua, rfqId } = await goiDaNop("ns-doc-bat", true);
    const pm2 = await nguoi("pm2-ns-doc-bat@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const tc3 = await nguoi("tc3-ns-doc-bat@vidu.vn", ["FINANCE"], org);
    const duong = `/rfqs/${rfqId}/budget`;
    const mong = { rfqId, estimatedValue: "1000000.00", currency: "VND", policyVersion: 2, tierTuSoTien: "0.00", requiresDualApproval: false };
    for (const ai of [pm, pm2]) {
      const kq = await goi("GET", duong, ai);
      expect([kq.status, kq.body], kq.text).toEqual([200, { budget: mong }]);
    }
    for (const ai of [mua, tc3]) {
      const kq = await goi("GET", duong, ai);
      expect(kq.status, kq.text).toBe(403);
      expect(await demTuChoiNganSach(org, ai.id)).toEqual(["RFQ_BUDGET rfq.approve"]);
    }
    expect((await goi("GET", `/rfqs/${UUID0}/budget`, pm2)).status).toBe(404);
  });

  it("[INV-K4b] người tạo gói là BUYER — chỉ giữ `rfq.create`, không giữ `rfq.approve`: đọc được ngân sách của gói mình đã nộp, không hàng từ chối (lượt soi F1)", async () => {
    const { org, mua } = await goiDaNop("ns-doc-mua", true);
    const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const rfq = await goi("POST", "/rfqs", mua, { title: "Goi cua nguoi mua", deadlineAt: han });
    expect(rfq.status, rfq.text).toBe(201);
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("PUT", `/rfqs/${rfqId}/budget`, mua, { estimatedValue: "2000000.00", currency: "VND" })).status).toBe(200);
    // [S1.200 / S3.6a] Tổ chức đã bật đòi nhóm hàng trước lần nộp — gói nhận nhóm `goiDaNop` đã dựng cho tổ chức.
    const nhomId = (await db.pool.query<{ id: string }>("SELECT id FROM procurement_categories WHERE org_id = $1", [org])).rows[0]?.id ?? "";
    expect((await goi("PUT", `/rfqs/${rfqId}/category`, mua, { categoryId: nhomId })).status).toBe(200);
    const nop = await goi("POST", `/rfqs/${rfqId}/submit`, mua);
    expect(nop.status, nop.text).toBe(200);
    const kq = await goi("GET", `/rfqs/${rfqId}/budget`, mua);
    expect([kq.status, kq.body], kq.text).toEqual([
      200,
      { budget: { rfqId, estimatedValue: "2000000.00", currency: "VND", policyVersion: 2, tierTuSoTien: "0.00", requiresDualApproval: false } },
    ]);
    expect(await demTuChoiNganSach(org, mua.id)).toEqual([]);
  });

  it("gói chưa có ngân sách: bốn trường ngân sách `null`; tổ chức chưa bật đọc như tổ chức đã bật — route cho mọi tổ chức", async () => {
    const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('ns-trong', 'ns-trong') RETURNING id")).rows[0]?.id ?? "";
    const pm = await nguoi("pm-ns-trong@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const rfq = await goi("POST", "/rfqs", pm, { title: "Chua dat ngan sach", deadlineAt: han });
    expect(rfq.status, rfq.text).toBe(201);
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    const kq = await goi("GET", `/rfqs/${rfqId}/budget`, pm);
    expect([kq.status, kq.body]).toEqual([
      200,
      { budget: { rfqId, estimatedValue: null, currency: null, policyVersion: null, tierTuSoTien: null, requiresDualApproval: true } },
    ]);
  });
});

describe("[S1.169 / S3.1c] phiên bản chính sách qua HTTP — tạo có bậc, đọc, và ký sau cờ triển khai (ADR-105)", () => {
  // Máy chủ THỨ HAI trên cùng CSDL, cờ BẬT. Máy chủ chung của tệp không khai cờ nên giữ mặc định TẮT của `createDispatcher`
  // — đúng cấu hình một máy chủ thật có khi không ai khai biến môi trường — và mọi ca khác của tệp, kể cả hai lượt quét
  // [INV-H17], chạy dưới cấu hình ấy.
  let gocKy = "";
  let serverKy: ReturnType<typeof createApiServer> | undefined;

  beforeAll(async () => {
    const s = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services, choKyChinhSach: true }));
    serverKy = s;
    await new Promise<void>((xong) => s.listen(0, "127.0.0.1", xong));
    gocKy = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((xong) => (serverKy === undefined ? xong() : serverKy.close(() => xong())));
  });

  // Ma trận hợp lệ nhỏ nhất: một bậc thường từ 0 và bậc đấu thầu chính thức — luật hình dạng là của `069`.
  const BAC = [
    {
      tu_so_tien: 0,
      so_ncc_toi_thieu: 2,
      award_vai_khac_nhau: false,
      ky_danh_sach_moi: true,
      xoay_vong_n: 0,
      award_so_chu_ky: 1,
      award_vai: ["FINANCE", "DIRECTOR"],
      tham_dinh_truoc_trao: false,
      khai_xung_dot: true,
      dau_thau_chinh_thuc: false,
    },
    { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
  ];
  const MUC = { chiaNhoCuaSoNgay: 30, thamDinhHieuLucThang: 12 };

  interface PhienBanDoc {
    readonly id: string;
    readonly version: number;
    readonly tiers: unknown;
    readonly chiaNhoCuaSoNgay: number | null;
    readonly thamDinhHieuLucThang: number | null;
    readonly createdBy: string;
    readonly signedBy: string | null;
    readonly hieuLuc: boolean;
  }
  interface DanhSachDoc {
    readonly phienBan: readonly PhienBanDoc[];
    readonly daBat: boolean;
    readonly choKy: boolean;
  }

  // Tổ chức RIÊNG cho mỗi ca: công tắc ADR-080 một chiều.
  async function toChuc(slug: string): Promise<string> {
    const { rows } = await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [slug]);
    return rows[0]?.id ?? "";
  }
  async function soChuKy(org: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM org_policy_signatures WHERE org_id = $1", [org]);
    return Number(rows[0]?.n ?? "-1");
  }
  async function daBat(org: string): Promise<boolean> {
    const { rows } = await db.pool.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [org]);
    return rows[0]?.b === true;
  }

  it("cờ TẮT — mặc định: route ký ⇒ 409 có tên, KHÔNG một chữ ký, tổ chức KHÔNG bật; `GET /policy/versions` đọc trọn ma trận và nói `choKy: false`; bản có bậc chưa ký KHÔNG chặn phiên bản kế tiếp", async () => {
    const org = await toChuc("cs-co-tat");
    const tc = await nguoi("tc-cs-tat@vidu.vn", ["FINANCE"], org);
    const tc2 = await nguoi("tc2-cs-tat@vidu.vn", ["FINANCE"], org);
    expect((await goi("POST", "/policy", tc, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(201);
    const v2 = await goi("POST", "/policy", tc, { version: 2, dualApprovalThreshold: "1000000000.00", currency: "VND", tiers: BAC, ...MUC });
    expect(v2.status, v2.text).toBe(201);
    const idV2 = (v2.body as { policy: { id: string } }).policy.id;

    // ⑴ Cửa đóng TRƯỚC mọi câu ghi: người ký hợp lệ ở mọi luật của trigger mà vẫn 409, và CSDL không thấy một hàng.
    const ky = await goi("POST", `/policy/${idV2}/sign`, tc2);
    expect(ky.status, ky.text).toBe(409);
    expect(ky.text).toContain("ADR-105");
    expect(await soChuKy(org)).toBe(0);
    expect(await daBat(org)).toBe(false);

    // ⑵ Đọc: bản 2 có bậc, chưa ký, KHÔNG hiệu lực (ADR-082 ⑺); bản 1 vẫn hiệu lực — đúng điều `GET /policy` trả.
    const ds = await goi("GET", "/policy/versions", tc2);
    expect(ds.status, ds.text).toBe(200);
    const b = ds.body as DanhSachDoc;
    expect([b.daBat, b.choKy]).toEqual([false, false]);
    expect(b.phienBan.map((p) => [p.version, p.hieuLuc, p.signedBy])).toEqual([
      [2, false, null],
      [1, true, null],
    ]);
    expect(b.phienBan[0]?.tiers).toEqual(BAC);
    expect([b.phienBan[0]?.chiaNhoCuaSoNgay, b.phienBan[0]?.thamDinhHieuLucThang, b.phienBan[0]?.createdBy]).toEqual([30, 12, tc.id]);
    expect([b.phienBan[1]?.tiers, b.phienBan[1]?.chiaNhoCuaSoNgay]).toEqual([null, null]);
    expect(((await goi("GET", "/policy", tc)).body as { policy: { version: number } }).policy.version).toBe(1);

    // ⑶ Phiên bản KẾ TIẾP tính theo bản MỚI NHẤT. RED THẬT trước vòng này: route đòi "hiện hành + 1" = 2, trigger `022`
    //    (thân `035`) đòi ĐÚNG lớn nhất + 1 = 3, và tổ chức không tạo được phiên bản nào nữa cho tới khi bản 2 được ký —
    //    mà cờ đang tắt.
    const sai = await goi("POST", "/policy", tc, { version: 2, dualApprovalThreshold: "100000000.00", currency: "VND" });
    expect(sai.status, sai.text).toBe(422);
    expect(sai.text).toContain("phải bằng phiên bản mới nhất + 1 (3)");
    const v3 = await goi("POST", "/policy", tc, { version: 3, dualApprovalThreshold: "100000000.00", currency: "VND" });
    expect(v3.status, v3.text).toBe(201);
  });

  it("cờ BẬT: mỗi luật của trigger một 422 có tên; không `policy.manage` ⇒ 403 mang toạ độ; người thứ hai ký bản mới nhất ⇒ 201, BẬT S3, đúng một hàng `PROCUREMENT_POLICY_SIGNED`; ký lại ⇒ 409", async () => {
    const org = await toChuc("cs-co-bat");
    const tcA = await nguoi("tca-cs-bat@vidu.vn", ["FINANCE"], org);
    const tcB = await nguoi("tcb-cs-bat@vidu.vn", ["FINANCE"], org);
    const pm = await nguoi("pm-cs-bat@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const tao = async (version: number, coBac: boolean): Promise<string> => {
      const than = { version, dualApprovalThreshold: "1000000000.00", currency: "VND", ...(coBac ? { tiers: BAC, ...MUC } : {}) };
      const r = await goi("POST", "/policy", tcA, than, gocKy);
      expect(r.status, r.text).toBe(201);
      return (r.body as { policy: { id: string } }).policy.id;
    };
    const v1 = await tao(1, false);
    const v2 = await tao(2, true);
    const v3 = await tao(3, true);
    const ky = (id: string, ai: Nguoi): Promise<PhanHoi> => goi("POST", `/policy/${id}/sign`, ai, undefined, gocKy);

    // ⑴ Route không chép lại luật nào của `chinh_sach_kiem_nguoi_ky`: mỗi lời từ chối là lời của trigger, đi ra 422.
    const tuChoi = [
      [await ky(v1, tcB), "Chi phien ban chinh sach CO BAC moi nhan chu ky thu hai"],
      [await ky(v2, tcB), "Chi ky duoc phien ban chinh sach MOI NHAT"],
      [await ky(v3, tcA), "Nguoi tao phien ban chinh sach khong duoc tu ky"],
      [await ky(UUID0, tcB), "tham chieu khong hop le"],
    ] as const;
    for (const [r, loi] of tuChoi) {
      expect(r.status, r.text).toBe(422);
      expect(r.text).toContain(loi);
    }
    // ⑵ Không giữ `policy.manage`: cổng của bộ điều phối, trước handler — 403 và một PERMISSION_DENIED trỏ ĐÚNG phiên bản.
    expect((await ky(v3, pm)).status).toBe(403);
    const { rows: tuChoiQuyen } = await db.pool.query<{ res: string; loai: string }>(
      "SELECT resource_id::text AS res, resource_type AS loai FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [org, pm.id],
    );
    expect(tuChoiQuyen).toEqual([{ res: v3, loai: "PROCUREMENT_POLICY" }]);
    expect(await soChuKy(org)).toBe(0);
    expect(await daBat(org)).toBe(false);

    // ⑶ Người thứ hai ký bản mới nhất: lần ký đầu tiên của một bản có bậc BẬT S3, một chiều (ADR-080 ⑵).
    const ok = await ky(v3, tcB);
    expect(ok.status, ok.text).toBe(201);
    expect((ok.body as { chuKy: unknown }).chuKy).toMatchObject({ policyId: v3, version: 3, signedBy: tcB.id, daBat: true });
    expect(await daBat(org)).toBe(true);
    const { rows: so } = await db.pool.query<{ actor: string; res: string; payload: unknown }>(
      "SELECT actor_id::text AS actor, resource_id::text AS res, payload FROM audit_events WHERE org_id = $1 AND action = 'PROCUREMENT_POLICY_SIGNED'",
      [org],
    );
    expect(so).toEqual([{ actor: tcB.id, res: v3, payload: { version: 3, daBat: true } }]);

    // ⑷ Ký lại: `UNIQUE (org_id, policy_id)` ⇒ 23505 ⇒ 409, không hàng thứ hai, không dòng sổ thứ hai.
    expect((await ky(v3, tcB)).status).toBe(409);
    expect(await soChuKy(org)).toBe(1);

    // ⑸ Đọc: bản 3 hiệu lực và mang người ký; tổ chức đã bật; màn biết cửa ký đang mở.
    const ds = await goi("GET", "/policy/versions", tcA, undefined, gocKy);
    expect(ds.status, ds.text).toBe(200);
    const b = ds.body as DanhSachDoc;
    expect([b.daBat, b.choKy]).toEqual([true, true]);
    expect(b.phienBan.map((p) => [p.version, p.hieuLuc, p.signedBy])).toEqual([
      [3, true, tcB.id],
      [2, false, null],
      [1, false, null],
    ]);
    expect(((await goi("GET", "/policy", tcA, undefined, gocKy)).body as { policy: { version: number } }).policy.version).toBe(3);

    // ⑹ Đã bật thì phiên bản mới phải có bậc, và bậc sai hình đi ra với lời của `069` — hai tầng, mỗi tầng một việc.
    const moi = { version: 4, dualApprovalThreshold: "1000000000.00", currency: "VND" };
    const khongBac = await goi("POST", "/policy", tcA, moi, gocKy);
    expect([khongBac.status, khongBac.text]).toEqual([422, expect.stringContaining("phien ban chinh sach moi phai khai bac gia tri")]);
    const bacLech = await goi("POST", "/policy", tcA, { ...moi, ...MUC, tiers: [{ ...BAC[0], tu_so_tien: 5 }, BAC[1]] }, gocKy);
    expect([bacLech.status, bacLech.text]).toEqual([422, expect.stringContaining("bac dau phai co tu_so_tien = 0")]);
    const khongMang = await goi("POST", "/policy", tcA, { ...moi, ...MUC, tiers: "bac" }, gocKy);
    expect([khongMang.status, khongMang.text]).toEqual([422, expect.stringContaining('trường \\"tiers\\" phải là mảng')]);
    const khongObject = await goi("POST", "/policy", tcA, { ...moi, ...MUC, tiers: [1] }, gocKy);
    expect([khongObject.status, khongObject.text]).toEqual([422, expect.stringContaining("phải là mảng các object")]);
    expect((await goi("GET", "/policy/versions", tcA, undefined, gocKy)).text).not.toContain('"version":4');
  });

  it("[S1.236 / khoản 261] [INV-K4b] tổ chức còn một gói chờ duyệt: lần ký BẬT S3 ⇒ 422 mang lời của trigger, không chữ ký, tổ chức không bật; PM huỷ gói ấy ⇒ ký ⇒ 201, bật", async () => {
    const org = await toChuc("cs-con-goi-cho");
    const tcA = await nguoi("tca-cs-cho@vidu.vn", ["FINANCE"], org);
    const tcB = await nguoi("tcb-cs-cho@vidu.vn", ["FINANCE"], org);
    const pm = await nguoi("pm-cs-cho@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const mua = await nguoi("mua-cs-cho@vidu.vn", ["BUYER"], org);
    expect((await goi("POST", "/policy", tcA, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" }, gocKy)).status).toBe(201);
    const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const rfq = await goi("POST", "/rfqs", mua, { title: "Mua thep tam", deadlineAt: han }, gocKy);
    expect(rfq.status, rfq.text).toBe(201);
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    const hm = await goi("POST", `/rfqs/${rfqId}/items`, mua, { lineNo: 1, description: "Thep tam SS400", quantity: "100.0000", unit: "tam" }, gocKy);
    expect(hm.status, hm.text).toBe(201);
    const nop = await goi("POST", `/rfqs/${rfqId}/submit`, mua, undefined, gocKy);
    expect(nop.status, nop.text).toBe(200);
    const v2 = await goi("POST", "/policy", tcA, { version: 2, dualApprovalThreshold: "1000000000.00", currency: "VND", tiers: BAC, ...MUC }, gocKy);
    expect(v2.status, v2.text).toBe(201);
    const idV2 = (v2.body as { policy: { id: string } }).policy.id;

    const tuChoi = await goi("POST", `/policy/${idV2}/sign`, tcB, undefined, gocKy);
    expect(tuChoi.status, tuChoi.text).toBe(422);
    expect(tuChoi.text).toContain("To chuc con 1 goi cho duyet");
    expect([await soChuKy(org), await daBat(org)]).toEqual([0, false]);

    const huyGoi = await goi("POST", `/rfqs/${rfqId}/cancel`, pm, { reason: "huy truoc khi bat S3" }, gocKy);
    expect(huyGoi.status, huyGoi.text).toBe(200);
    const ok = await goi("POST", `/policy/${idV2}/sign`, tcB, undefined, gocKy);
    expect(ok.status, ok.text).toBe(201);
    expect((ok.body as { chuKy: unknown }).chuKy).toMatchObject({ policyId: idV2, version: 2, daBat: true });
    expect([await soChuKy(org), await daBat(org)]).toEqual([1, true]);
  });
});

describe("[S1.203 / S3.6b1] tín hiệu chia nhỏ qua HTTP — đọc, ghi nhận, và chốt K10a ở cạnh mở gói", () => {
  it("[INV-K10a] ba gói 480/470/490 triệu cùng nhóm: mở gói thứ ba ⇒ 422 có tên + một hàng sổ; người gây ra ghi nhận ⇒ 422 có tên; BUYER ⇒ 403; thiếu lý do ⇒ 422; người độc lập ⇒ 201; lần hai ⇒ 422; rồi mở ⇒ 200", async () => {
    const org = (
      await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty K10a', 'cong-ty-k10a') RETURNING id")
    ).rows[0]?.id ?? "";
    const pm = await nguoi("pm-k10a@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const pm2 = await nguoi("pm2-k10a@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const pm3 = await nguoi("pm3-k10a@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const mua = await nguoi("mua-k10a@vidu.vn", ["BUYER"], org);
    // Người ghi nhận ĐỘC LẬP giữ ĐÚNG MỘT mã, `rfq.approve`: route khai sai mã (vd. `rfq.create`) thì người này 403 ở cổng —
    // hàm gói hỏi lại `rfq.approve` nên một người giữ cả hai mã không phân biệt được hai bản.
    await db.pool.query("INSERT INTO roles (code, name) VALUES ('KIEM_K10A_DUYET', 'Chi duyet goi')");
    await db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ('KIEM_K10A_DUYET', 'rfq.approve')");
    const docLap = await nguoi("doclap-k10a@vidu.vn", ["KIEM_K10A_DUYET"], org);
    const tc = await nguoi("tc-k10a@vidu.vn", ["FINANCE"], org);
    const tc2 = await nguoi("tc2-k10a@vidu.vn", ["FINANCE"], org);
    expect((await goi("POST", "/policy", tc, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" })).status).toBe(201);
    // Phiên bản có bậc 0 / 1 tỷ / 10 tỷ, cửa sổ 30 ngày — câu DỰNG dưới chủ sở hữu, khuôn ca K1 ở trên. Mọi trigger vẫn chạy.
    const bac = (tu: number): Record<string, unknown> => ({
      tu_so_tien: tu,
      so_ncc_toi_thieu: 1,
      award_vai_khac_nhau: false,
      ky_danh_sach_moi: false,
      xoay_vong_n: 0,
      award_so_chu_ky: 1,
      award_vai: ["DIRECTOR"],
      tham_dinh_truoc_trao: false,
      khai_xung_dot: false,
      dau_thau_chinh_thuc: false,
    });
    const v2 = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, chia_nho_cua_so_ngay, " +
          "tham_dinh_hieu_luc_thang, created_by, created_by_session_id) VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, $3, $4) RETURNING id",
        [org, JSON.stringify([bac(0), bac(1_000_000_000), { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true }]), tc.id, tc.sessionId],
      )
    ).rows[0]?.id;
    await db.pool.query(
      "INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)",
      [org, v2, tc2.id, tc2.sessionId],
    );
    const nhom = await goi("POST", "/categories", tc, { ma: "THEP", ten: "Thep" });
    expect(nhom.status, nhom.text).toBe(201);
    const nhomId = (nhom.body as { nhomHang: { id: string } }).nhomHang.id;
    const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const goiDaDuyet = async (giaTri: string): Promise<string> => {
      const rfq = await goi("POST", "/rfqs", pm, { title: `Thep ${giaTri}`, deadlineAt: han });
      expect(rfq.status, rfq.text).toBe(201);
      const id = (rfq.body as { rfq: { id: string } }).rfq.id;
      expect((await goi("PUT", `/rfqs/${id}/budget`, pm, { estimatedValue: giaTri, currency: "VND" })).status).toBe(200);
      expect((await goi("PUT", `/rfqs/${id}/category`, pm, { categoryId: nhomId })).status).toBe(200);
      expect((await goi("POST", `/rfqs/${id}/items`, pm, { lineNo: 1, description: "Thep tam", quantity: "10", unit: "tam" })).status).toBe(201);
      const nop = await goi("POST", `/rfqs/${id}/submit`, pm);
      expect(nop.status, nop.text).toBe(200);
      for (const ai of [pm2, pm3]) {
        // [S1.198 / khoản 256] Người duyệt gửi lại lần nộp vừa đọc — ở tổ chức đã bật, route duyệt đòi nó.
        const lanNop = ((await goi("GET", `/rfqs/${id}`, ai)).body as { rfq: { lanNop: number } }).rfq.lanNop;
        const d = await goi("POST", `/rfqs/${id}/approve`, ai, { lanNop });
        expect(d.status, d.text).toBe(200);
      }
      return id;
    };
    const hangSo = async (rfqId: string): Promise<string[]> =>
      (
        await db.pool.query<{ ma: string }>(
          "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
          [org, rfqId],
        )
      ).rows.map((r) => r.ma);

    for (const v of ["480000000.00", "470000000.00"]) {
      const id = await goiDaDuyet(v);
      const mo = await goi("POST", `/rfqs/${id}/open`, pm);
      expect(mo.status, mo.text).toBe(200);
    }
    const g3 = await goiDaDuyet("490000000.00");
    const duongGhiNhan = `/rfqs/${g3}/signals/acknowledge`;

    const doc = await goi("GET", `/rfqs/${g3}/signals`, pm);
    expect(doc.status, doc.text).toBe(200);
    const tinHieu = (doc.body as { tinHieu: { canGhiNhan: boolean; hienTai: { can: number; goi: string[] }; tinHieu: unknown[] } }).tinHieu;
    expect([tinHieu.canGhiNhan, tinHieu.hienTai.can, tinHieu.hienTai.goi.length, tinHieu.tinHieu.length]).toEqual([true, 1_000_000_000, 3, 1]);

    // [S3.6b2] Thứ màn cần: người đang xem — dẫn xuất từ PHIÊN, không từ thân hay query — ghi nhận được không, và vì sao không.
    type DocMan = { tinHieu: { nguoiXem: unknown; soNguoiGhiNhanDuoc: number | null; goi: Record<string, { tieuDe: string }> } };
    const xem = async (ai: typeof pm): Promise<DocMan["tinHieu"]> => {
      const r = await goi("GET", `/rfqs/${g3}/signals`, ai);
      expect(r.status, r.text).toBe(200);
      return (r.body as DocMan).tinHieu;
    };
    expect((await xem(pm)).nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: CHOT_VAO_SO.K10A_TU_GHI_NHAN.thongDiep });
    expect((await xem(mua)).nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: "Ghi nhận tín hiệu cần quyền duyệt gói thầu." });
    const tuDocLap = await xem(docLap);
    expect(tuDocLap.nguoiXem).toEqual({ ghiNhanDuoc: true, lyDo: null });
    // Người giữ `rfq.approve`: ba PROCUREMENT_MANAGER và người độc lập; chỉ `pm` — người tạo và nộp cả ba gói — bị loại.
    expect(tuDocLap.soNguoiGhiNhanDuoc).toBe(3);
    expect(Object.values(tuDocLap.goi).map((g) => g.tieuDe).sort()).toEqual(["Thep 470000000.00", "Thep 480000000.00", "Thep 490000000.00"]);
    // Bốn lần đọc không để hàng sổ nào — kể cả của người không giữ quyền (hàng PERMISSION_DENIED duy nhất của `mua` ở dưới).
    expect(await hangSo(g3)).toEqual([]);

    const chan = await goi("POST", `/rfqs/${g3}/open`, pm);
    expect([chan.status, (chan.body as { error: string }).error]).toEqual([422, CHOT_VAO_SO.TIN_HIEU_CHUA_GHI_NHAN.thongDiep]);
    expect(await hangSo(g3)).toEqual(["TIN_HIEU_CHUA_GHI_NHAN"]);

    const tuGhi = await goi("POST", duongGhiNhan, pm, { lyDo: "toi tao ca ba goi" });
    expect([tuGhi.status, (tuGhi.body as { error: string }).error]).toEqual([422, CHOT_VAO_SO.K10A_TU_GHI_NHAN.thongDiep]);
    expect(await hangSo(g3)).toEqual(["TIN_HIEU_CHUA_GHI_NHAN", "K10A_TU_GHI_NHAN"]);

    const bi = await goi("POST", duongGhiNhan, mua, { lyDo: "buyer khong duyet" });
    expect(bi.status, bi.text).toBe(403);
    const { rows: tuChoi } = await db.pool.query<{ q: string; r: string }>(
      "SELECT payload->>'permission' AS q, resource_id::text AS r FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [org, mua.id],
    );
    expect(tuChoi).toEqual([{ q: "rfq.approve", r: g3 }]);

    const thieu = await goi("POST", duongGhiNhan, docLap, {});
    expect([thieu.status, thieu.text]).toEqual([422, JSON.stringify({ error: 'thiếu trường "lyDo"' })]);

    const ghi = await goi("POST", duongGhiNhan, docLap, { lyDo: "Ba cong trinh, ba hop dong khung khac nhau" });
    expect(ghi.status, ghi.text).toBe(201);
    expect((ghi.body as { ghiNhan: { tinHieuMoi: boolean } }).ghiNhan.tinHieuMoi).toBe(false);
    const lan2 = await goi("POST", duongGhiNhan, docLap, { lyDo: "lan hai" });
    expect([lan2.status, (lan2.body as { error: string }).error]).toEqual([422, "Bạn đã ghi nhận tín hiệu này rồi."]);

    const sau = await goi("GET", `/rfqs/${g3}/signals`, pm);
    expect((sau.body as { tinHieu: { canGhiNhan: boolean } }).tinHieu.canGhiNhan).toBe(false);
    const mo = await goi("POST", `/rfqs/${g3}/open`, pm);
    expect(mo.status, mo.text).toBe(200);
  });
});

// ==============================================================================================
// [S1.213 / khoản 133] "KHÔNG TÌM THẤY" QUA HTTP TRÊN BỀ MẶT MỞ THẦU VÀ BẢNG SO SÁNH
//
// Đo trước bản vá trên `69e743e`: bốn đường dưới đây trả 422 mà 0 hàng sổ — bảng so sánh và số báo giá cùng câu "Không tìm thấy RFQ
// trong tổ chức đang gắn.", huỷ mở thầu câu cũ của `cancelUnseal`, còn phê duyệt là 422 "tham chieu khong hop le" của bảng ánh xạ
// SQLSTATE (23503 trần). Lần bấm điều phối THỨ HAI đo ở ca vòng đời phía trên. Chủ dự án chốt: D5 phủ chúng (tiểu mục ADR-016 [S1.213]).
// ==============================================================================================
describe("[INV-D5] [S1.213 / khoản 133] \"không tìm thấy\" qua HTTP: bảng so sánh, số báo giá, huỷ và phê duyệt mở thầu — 422 giữ câu, mỗi lần đúng một hàng sổ", () => {
  async function hangTuChoi(action: string, resourceId: string): Promise<unknown[][]> {
    const { rows } = await db.pool.query<{ actor_id: string | null; resource_type: string; payload: unknown }>(
      "SELECT actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3 ORDER BY seq",
      [orgA, action, resourceId],
    );
    return rows.map((r) => [r.actor_id, r.resource_type, r.payload]);
  }

  it("[INV-D5] id lạ: comparison và bid-count ⇒ 422 cùng câu, mỗi đường một `COMPARISON_NOT_FOUND_DENIED`; cancel ⇒ 422 câu cũ và một `UNSEAL_NOT_FOUND_DENIED`; approve ⇒ 422 CÓ TÊN thay `tham chieu khong hop le` và một `UNSEAL_NOT_FOUND_DENIED`", async () => {
    const pm = await nguoi("k133-pm@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const gd = await nguoi("k133-gd@vidu.vn", ["DIRECTOR"]);
    const idRfq = randomUUID();
    const idYc = randomUUID();

    const ss = await goi("GET", `/rfqs/${idRfq}/comparison`, pm);
    expect([ss.status, ss.body]).toEqual([422, { error: "Không tìm thấy RFQ trong tổ chức đang gắn." }]);
    expect(await hangTuChoi("COMPARISON_NOT_FOUND_DENIED", idRfq)).toEqual([[pm.id, "RFQ", { operation: "BUILD_COMPARISON_TABLE" }]]);

    const dem = await goi("GET", `/rfqs/${idRfq}/bid-count`, pm);
    expect([dem.status, dem.body]).toEqual([422, { error: "Không tìm thấy RFQ trong tổ chức đang gắn." }]);
    expect(await hangTuChoi("COMPARISON_NOT_FOUND_DENIED", idRfq)).toEqual([
      [pm.id, "RFQ", { operation: "BUILD_COMPARISON_TABLE" }],
      [pm.id, "RFQ", { operation: "COUNT_RECEIVED_BIDS" }],
    ]);

    const huy = await goi("POST", `/unseal/${idYc}/cancel`, pm);
    expect([huy.status, huy.body]).toEqual([
      422,
      { error: "Không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn." },
    ]);
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", idYc)).toEqual([[pm.id, "UNSEAL_REQUEST", { operation: "CANCEL_UNSEAL" }]]);

    const duyet = await goi("POST", `/unseal/${idYc}/approve`, gd);
    expect([duyet.status, duyet.body], "trước bản vá: 422 `tham chieu khong hop le` — 23503 trần qua bảng ánh xạ SQLSTATE").toEqual([
      422,
      { error: "Không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn." },
    ]);
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", idYc)).toEqual([
      [pm.id, "UNSEAL_REQUEST", { operation: "CANCEL_UNSEAL" }],
      [gd.id, "UNSEAL_REQUEST", { operation: "APPROVE_UNSEAL" }],
    ]);
  });

  it("[INV-D5] ĐỐI CHỨNG: RFQ có thật ⇒ comparison bị từ chối vì A4 (`COMPARISON_DENIED`), bid-count 200 — 0 hàng `COMPARISON_NOT_FOUND_DENIED`", async () => {
    const pm = await nguoi("k133-pm-dc@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const rfq = await goi("POST", "/rfqs", pm, { title: "Doi chung khoan 133" });
    expect(rfq.status, rfq.text).toBe(201);
    const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("GET", `/rfqs/${rfqId}/comparison`, pm)).status).toBe(422);
    expect((await goi("GET", `/rfqs/${rfqId}/bid-count`, pm)).status).toBe(200);
    expect((await hangTuChoi("COMPARISON_DENIED", rfqId)).length, "lần từ chối A4 vẫn vào sổ như khoản 121").toBe(1);
    expect(await hangTuChoi("COMPARISON_NOT_FOUND_DENIED", rfqId)).toEqual([]);
  });
});

// ==============================================================================================
// [S1.231 / khoản 232 / ADR-133] RÚT ĐỀ XUẤT TRAO THẦU QUA HTTP — `POST /rfqs/:rfqId/award/withdraw` DƯỚI `award.recommend`
//
// Giàn cảnh dựng THẲNG tới `CLOSED` trong một TỔ CHỨC RIÊNG (cùng khuôn `luot-danh-gia.int.test.ts`: phong bì giả, bản rõ ghi
// thẳng dưới `app_unseal` — đường mở thầu thật đã có `kich-ban-41-http`; tổ chức riêng vì các ca S3 ở trên đã bật kiểm soát theo
// bậc cho `orgA`). Mọi bước của S2.6 đi qua HTTP: xin/duyệt mở thầu, chấm, đề xuất, rút, đề xuất lại, duyệt, huỷ. Ba câu của ma
// trận quyền: BUYER rút được đề xuất CỦA MÌNH; BUYER KHÔNG huỷ được award đã duyệt (403 — `po.approve` không đổi, ADR-057);
// FINANCE huỷ được. Mỗi lần từ chối có tên để lại một hàng `RFQ_STATE_DENIED` mang mã (ADR-060).
// ==============================================================================================
describe("[S1.231 / khoản 232] rút đề xuất trao thầu qua HTTP", () => {
  const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

  /** Một gói thầu của `pm` đã ĐÓNG với ba báo giá niêm phong giả — sẵn sàng xin mở thầu qua HTTP. */
  async function goiDaDong(org: string, pm: Nguoi, gd: Nguoi): Promise<{ rfqId: string; banRo: string[] }> {
    const { rows: cs } = await db.pool.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, " +
        "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2::jsonb, 0, $3, $4) RETURNING id",
      [org, TP_GIA, pm.id, pm.sessionId],
    );
    const { rows: r } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Mua thep tam', now() + interval '7 days', false, $2, $3) RETURNING id",
      [org, pm.id, pm.sessionId],
    );
    const rfqId = r[0]?.id ?? "";
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
      [org, rfqId, pm.id, pm.sessionId],
    );
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
        "VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
      [org, rfqId, cs[0]?.id ?? "", pm.id, pm.sessionId],
    );
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
      [rfqId, pm.id, pm.sessionId],
    );
    // Sàn một chữ ký (`068`) — người KHÁC người tạo, trên nội dung hiện tại.
    await db.pool.query(
      "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)",
      [org, rfqId, gd.id, gd.sessionId],
    );
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, " +
          "created_by_session_id) VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
        [org, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), pm.id, pm.sessionId],
      );
      await c.query(
        "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
        [rfqId, pm.id, pm.sessionId],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    const banRo: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const hex = randomBytes(4).toString("hex");
      const { rows: ncc } = await db.pool.query<{ id: string }>(
        "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [org, `NCC ${hex}`, pm.id, pm.sessionId],
      );
      const { rows: lh } = await db.pool.query<{ id: string }>(
        "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
        [org, ncc[0]?.id ?? "", `${hex}@vidu.vn`, pm.id, pm.sessionId],
      );
      const { rows: lm } = await db.pool.query<{ id: string }>(
        "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
        [org, rfqId, ncc[0]?.id ?? "", lh[0]?.id ?? "", pm.id, pm.sessionId],
      );
      const { rows: tk } = await db.pool.query<{ id: string }>(
        "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
          "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
        [org, lm[0]?.id ?? "", randomBytes(32), pm.id, pm.sessionId],
      );
      const { rows: tt } = await db.pool.query<{ id: string }>(
        "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash, " +
          "pepper_version, expires_at, consumed_at) VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
        [org, lm[0]?.id ?? "", tk[0]?.id ?? "", lh[0]?.id ?? "", randomBytes(32), randomBytes(32)],
      );
      const { rows: pk } = await db.pool.query<{ id: string }>(
        "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
          "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
        [org, lm[0]?.id ?? "", tt[0]?.id ?? "", randomBytes(32), lh[0]?.id ?? ""],
      );
      const versionId = await withTenant(apiPool, org, async (c2) => {
        const { rows: b } = await c2.query<{ id: string }>(
          "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
          [org, lm[0]?.id ?? ""],
        );
        const { rows: v } = await c2.query<{ id: string }>(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
          [org, b[0]?.id ?? "", Buffer.alloc(64, 9), pk[0]?.id ?? ""],
        );
        await c2.query(
          "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)",
          [
            org,
            v[0]?.id ?? "",
            `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${b[0]?.id ?? ""}\n` +
              `version=1\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-05T00:00:00.000000Z\n`,
            Buffer.alloc(70, 7),
          ],
        );
        return v[0]?.id ?? "";
      });
      banRo.push(versionId);
    }
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', " +
        "closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, pm.id, pm.sessionId],
    );
    return { rfqId, banRo };
  }

  it("BUYER rút được đề xuất CỦA MÌNH (201, RFQ về EVALUATING, một hàng RFQ_AWARD_WITHDRAWN); BUYER khác ⇒ 422 có tên; sau chữ ký: BUYER không rút (422), không huỷ (403); FINANCE huỷ được (201)", async () => {
    const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty rut de xuat', 'cong-ty-rut-de-xuat') RETURNING id")).rows[0]?.id ?? "";
    const pm = await nguoi("k232-pm@vidu.vn", ["PROCUREMENT_MANAGER"], org);
    const gd1 = await nguoi("k232-gd1@vidu.vn", ["DIRECTOR"], org);
    const gd2 = await nguoi("k232-gd2@vidu.vn", ["DIRECTOR"], org);
    const buyer = await nguoi("k232-buyer@vidu.vn", ["BUYER"], org);
    const buyer2 = await nguoi("k232-buyer2@vidu.vn", ["BUYER"], org);
    const tc = await nguoi("k232-tc@vidu.vn", ["FINANCE"], org);
    const req = await nguoi("k232-req@vidu.vn", ["REQUESTER"], org);
    const { rfqId, banRo } = await goiDaDong(org, pm, gd1);

    // Xin và duyệt mở thầu qua HTTP (gói dưới ngưỡng: một chữ ký), rồi bản rõ ghi thẳng dưới `app_unseal` như worker làm.
    const yc = await goi("POST", `/rfqs/${rfqId}/unseal`, gd1, { reason: "den gio mo thau" });
    expect(yc.status, yc.text).toBe(201);
    const unsealId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
    const duyetMo = await goi("POST", `/unseal/${unsealId}/approve`, gd2);
    expect(duyetMo.status, duyetMo.text).toBe(200);
    const unsealPool = db.poolAs("app_unseal");
    try {
      await withTenant(unsealPool, org, async (c) => {
        const gia = ["548800000.00", "537600000.00", "544000000.00"];
        for (const [i, v] of banRo.entries()) {
          await c.query(
            "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
            [org, unsealId, v, JSON.stringify({ totalAmount: gia[i], currency: "VND" })],
          );
        }
        await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
        await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [unsealId]);
      });
    } finally {
      await unsealPool.end();
    }
    const cham = await goi("POST", `/rfqs/${rfqId}/evaluate`, pm);
    expect(cham.status, cham.text).toBe(201);
    const trangThai = async (): Promise<string> => ((await goi("GET", `/rfqs/${rfqId}`, pm)).body as { rfq: { status: string } }).rfq.status;
    expect(await trangThai()).toBe("EVALUATING");

    // Đề xuất bởi BUYER (`award.recommend`; không tạo gói, không điều phối — J3 cho qua).
    const dx = await goi("POST", `/rfqs/${rfqId}/award`, buyer, { bidVersionId: banRo[1], reason: "gia thap nhat" });
    expect(dx.status, dx.text).toBe(201);
    expect(await trangThai()).toBe("AWARDED");

    // Người KHÁC rút ⇒ 422 có tên; thiếu lý do ⇒ 422 của bộ đọc thân; REQUESTER (không `award.recommend`) ⇒ 403.
    const rutHo = await goi("POST", `/rfqs/${rfqId}/award/withdraw`, buyer2, { reason: "rut ho" });
    expect([rutHo.status, rutHo.body]).toEqual([422, { error: "Chỉ người đã đề xuất mới rút được đề xuất của mình; người khác thì huỷ qua cổng po.approve." }]);
    expect((await goi("POST", `/rfqs/${rfqId}/award/withdraw`, buyer, {})).status).toBe(422);
    expect((await goi("POST", `/rfqs/${rfqId}/award/withdraw`, req, { reason: "x" })).status).toBe(403);
    expect(await trangThai()).toBe("AWARDED");

    // Chính người đề xuất rút ⇒ 201, hàng WITHDRAWN chép đúng báo giá, RFQ về EVALUATING; đường đọc thấy WITHDRAWN không chữ ký.
    const rut = await goi("POST", `/rfqs/${rfqId}/award/withdraw`, buyer, { reason: "bam nham bao gia" });
    expect(rut.status, rut.text).toBe(201);
    const hangRut = (rut.body as { award: { status: string; bidVersionId: string; reason: string; actedBy: string } }).award;
    expect([hangRut.status, hangRut.bidVersionId, hangRut.reason, hangRut.actedBy]).toEqual(["WITHDRAWN", banRo[1], "bam nham bao gia", buyer.id]);
    expect(await trangThai()).toBe("EVALUATING");
    const doc = await goi("GET", `/rfqs/${rfqId}/award`, pm);
    expect(doc.status, doc.text).toBe(200);
    expect((doc.body as { award: { status: string; approvals: unknown[] } }).award).toMatchObject({ status: "WITHDRAWN", approvals: [] });

    // Đề xuất LẠI (J7 mở lại), FINANCE duyệt; nay BUYER không rút được (422 nói hàng mới nhất) và không huỷ được (403);
    // FINANCE huỷ được (201) — cổng huỷ không đổi một chữ.
    const dx2 = await goi("POST", `/rfqs/${rfqId}/award`, buyer, { bidVersionId: banRo[2], reason: "chon lai cho dung" });
    expect(dx2.status, dx2.text).toBe(201);
    const awardId2 = (dx2.body as { award: { awardId: string } }).award.awardId;
    const duyet = await goi("POST", `/rfqs/${rfqId}/award/${awardId2}/approve`, tc);
    expect(duyet.status, duyet.text).toBe(201);
    const rutSauDuyet = await goi("POST", `/rfqs/${rfqId}/award/withdraw`, buyer, { reason: "rut sau duyet" });
    expect(rutSauDuyet.status).toBe(422);
    expect(rutSauDuyet.text).toContain("hàng mới nhất đang ở APPROVED");
    expect((await goi("POST", `/rfqs/${rfqId}/award/cancel`, buyer, { reason: "buyer huy" })).status, "cổng huỷ vẫn là po.approve").toBe(403);
    const huy = await goi("POST", `/rfqs/${rfqId}/award/cancel`, tc, { reason: "ncc rut cam ket" });
    expect(huy.status, huy.text).toBe(201);
    expect(await trangThai()).toBe("EVALUATING");

    // Sổ: một hàng RFQ_AWARD_WITHDRAWN; hai hàng RFQ_STATE_DENIED của đường rút mang đúng mã và đúng người, đúng thứ tự.
    const { rows: so } = await db.pool.query<{ action: string; actor_id: string; payload: { ma?: string } }>(
      "SELECT action, actor_id, payload FROM audit_events WHERE org_id = $1 AND action IN ('RFQ_AWARD_WITHDRAWN', 'RFQ_STATE_DENIED') ORDER BY seq",
      [org],
    );
    expect(so.map((h) => [h.action, h.actor_id, h.payload.ma ?? null])).toEqual([
      ["RFQ_STATE_DENIED", buyer2.id, "KHONG_PHAI_NGUOI_DE_XUAT"],
      ["RFQ_AWARD_WITHDRAWN", buyer.id, null],
      ["RFQ_STATE_DENIED", buyer.id, "KHONG_CO_DE_XUAT_DANG_CHO"],
    ]);
    // Bảng award chỉ-ghi-thêm: năm hàng, đúng thứ tự.
    const { rows: aw } = await db.pool.query<{ status: string }>(
      "SELECT status FROM rfq_awards WHERE org_id = $1 AND rfq_id = $2 ORDER BY acted_at, id",
      [org, rfqId],
    );
    expect(aw.map((h) => h.status)).toEqual(["PROPOSED", "WITHDRAWN", "PROPOSED", "APPROVED", "CANCELLED"]);
  }, 180_000);
});

// [S1.217 / khoản 250 / ADR-128] THU HỒI LỜI MỜI SAU LẦN MỞ THẦU QUA HTTP ⇒ 422 THÂN CỐ ĐỊNH, MỘT HÀNG `RFQ_STATE_DENIED`
// ==============================================================================================
describe("[S1.217 / khoản 250] thu hồi lời mời sau lần mở thầu qua HTTP", () => {
  it("gói CLOSED: thu hồi ⇒ 200 {revoked: true}, 0 hàng từ chối (đối chứng); ép gói sang UNSEALED: thu hồi lời mời thứ hai ⇒ 422 thân cố định, ĐÚNG MỘT hàng RFQ_STATE_DENIED {LOI_MOI_THU_HOI_SAU_MO_THAU} dưới người gọi, lời mời còn sống; lần bấm thứ hai ⇒ 422 và hàng thứ hai", async () => {
    const pm = await nguoi("k250-pm@vidu.vn", ["PROCUREMENT_MANAGER"]);
    const gd1 = await nguoi("k250-gd1@vidu.vn", ["DIRECTOR"]);
    const gd2 = await nguoi("k250-gd2@vidu.vn", ["DIRECTOR"]);
    const moiNcc = async (ten: string, mst: string, rfqId: string): Promise<string> => {
      const ncc = await goi("POST", "/suppliers", pm, { legalName: ten, taxCode: mst });
      expect(ncc.status, ncc.text).toBe(201);
      const supplierId = (ncc.body as { supplier: { id: string } }).supplier.id;
      const lh = await goi("POST", `/suppliers/${supplierId}/contacts`, pm, { fullName: "Lien he 250", email: `${mst}@vidu.vn` });
      expect(lh.status, lh.text).toBe(201);
      const { rows } = await db.pool.query<{ id: string }>(
        "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
        [orgA, rfqId, supplierId, (lh.body as { contact: { id: string } }).contact.id, pm.id, pm.sessionId],
      );
      return rows[0]?.id ?? "";
    };
    const hangTuChoi = async (rfqId: string): Promise<unknown[][]> => {
      const { rows } = await db.pool.query<{ actor_id: string | null; resource_type: string; payload: unknown }>(
        "SELECT actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_STATE_DENIED' AND resource_id = $2 ORDER BY seq",
        [orgA, rfqId],
      );
      return rows.map((r) => [r.actor_id, r.resource_type, r.payload]);
    };

    // Gói OPEN (fixture của khối khoản 154/125), hai lời mời, rồi đóng qua HTTP.
    const rfqId = await rfqDaDong(pm, [gd1, gd2], false);
    const lm1 = await moiNcc("Thep 250 A", "0325000001", rfqId);
    const lm2 = await moiNcc("Thep 250 B", "0325000002", rfqId);
    expect((await goi("POST", `/rfqs/${rfqId}/close`, pm, { reason: "dong de mo thau" })).status).toBe(200);

    const th1 = await goi("POST", `/invitations/${lm1}/revoke`, pm);
    expect(th1.status, th1.text).toBe(200);
    expect(th1.body).toEqual({ revoked: true });
    expect(await hangTuChoi(rfqId), "đối chứng: trước lần mở, thu hồi không phải một lần từ chối").toEqual([]);

    // Ép sang UNSEALED (cạnh CLOSED→UNSEALED đòi một yêu cầu mở thầu đã chạy — tắt hai trigger cạnh, giữ mốc theo CHECK của 011).
    for (const t of ["rfq_packages_kiem_chuyen_trang_thai", "rfq_packages_kiem_yeu_cau_mo_thau"]) {
      await db.pool.query(`ALTER TABLE rfq_packages DISABLE TRIGGER ${t}`);
    }
    try {
      await db.pool.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
    } finally {
      for (const t of ["rfq_packages_kiem_yeu_cau_mo_thau", "rfq_packages_kiem_chuyen_trang_thai"]) {
        await db.pool.query(`ALTER TABLE rfq_packages ENABLE TRIGGER ${t}`);
      }
    }

    const th2 = await goi("POST", `/invitations/${lm2}/revoke`, pm);
    expect(th2.status, th2.text).toBe(422);
    expect(th2.body).toEqual({
      error: "Gói thầu đã mở thầu nên lời mời không thu hồi được nữa; báo giá đã nộp theo lời mời ấy đã vào lượt mở thầu.",
    });
    expect(await hangTuChoi(rfqId)).toEqual([[pm.id, "RFQ", { ma: "LOI_MOI_THU_HOI_SAU_MO_THAU" }]]);
    const { rows: lm } = await db.pool.query<{ status: string; revoked_at: Date | null }>("SELECT status, revoked_at FROM rfq_invitations WHERE id = $1", [lm2]);
    expect(lm[0]).toEqual({ status: "SENT", revoked_at: null });

    const th3 = await goi("POST", `/invitations/${lm2}/revoke`, pm);
    expect(th3.status).toBe(422);
    expect(await hangTuChoi(rfqId)).toHaveLength(2);
  });
});
