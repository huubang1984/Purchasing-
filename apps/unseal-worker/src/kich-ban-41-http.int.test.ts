// ==============================================================================================
// [S1.10.6] KỊCH BẢN MỤC 41 — ĐI TRỌN QUA HTTP, cộng BỘ QUÉT RÒ RỈ trên tiến trình thật.
//
// Bản gói (`kich-ban-41.int.test.ts`) gọi thẳng mười một gói. Bản này gọi `fetch`: mọi thứ người
// mua và nhà cung cấp làm đều là một yêu cầu HTTP tới `apps/api`; thứ duy nhất KHÔNG qua HTTP là
// bước 11 (worker giải mã) — vì đó chính là điều A1/G1 đòi: không có một endpoint nào làm việc ấy.
// File sống trong `apps/unseal-worker/` vì họ `g1-` cấm mọi module ngoài worker import
// `executeUnsealRequest` — cùng lý do bản gói sống ở đây.
//
//   [INV-A1] [INV-A2]  BỘ QUÉT: gieo năm mức giá THẬT qua năm phong bì niêm phong, rồi gọi MỌI route
//                      trong `ROUTES` (đủ bốn đối tượng) TRƯỚC khi mở thầu, quét thân + header phản
//                      hồi + mọi dòng `console.error` bắt được — không một chữ số giá nào lọt. Kèm
//                      đối chứng dương: chính bộ quét bắt được một chuỗi giá gieo vào một thân giả.
//   [INV-A6]  số báo giá đã nhận bị giấu trước CLOSED (qua HTTP), công bố sau.
//   [INV-B1] [INV-B2] [INV-D1] [INV-D2] [INV-A4] [INV-A3] [INV-B5] — cùng phép đo bản gói, qua HTTP.
//
// PHẦN CHÊNH của A2, nói trước: bộ quét đo PHẢN HỒI, HEADER và LOG BẮT ĐƯỢC của tiến trình api.
// Nó KHÔNG đo heap, KHÔNG đo APM trace, KHÔNG đo lỗi ở tầng vận chuyển ngoài tiến trình. §4 của ma
// trận ghi đúng ba vế ấy; ô ✅ của A2 KHÔNG được đọc rộng hơn.
// ==============================================================================================
import { createPublicKey } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { auditStoredCiphertexts, verifyReceipt } from "@trustprocure/bidding";
import { migrate } from "@trustprocure/db";
import { counterForTime, deriveTotpCode } from "@trustprocure/identity";
import { sealBid } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
// Import TƯƠNG ĐỐI xuyên app, có chủ đích: `@trustprocure/api` không có alias vitest và không nên
// là dependency của worker (đường chạy của worker không chạm api). Test là nơi duy nhất nối hai app.
import { createApiServer, createDispatcher, ROUTES } from "../../api/src/index.js";
import { COOKIE_PHIEN_KHACH } from "../../api/src/routes/anon.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "../../api/src/routes/auth.js";
import { dichVuTest, type DichVuTest } from "../../api/src/test-services.js";
import { executeUnsealRequest } from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const NHA_CUNG_CAP = [
  { ten: "Thep Hoa Phat", gia: "980000000.00" },
  { ten: "Thep Viet Duc", gia: "1050000000.00" },
  { ten: "Thep Pomina", gia: "1120000000.00" },
  { ten: "Thep Nam Kim", gia: "999000000.00" },
  { ten: "Thep Tung Kuang", gia: "1400000000.00" },
] as const;
const GIA_SUA_LAI = "930000000.00";
const NGAN_SACH = "1000000000.00";
/** Mọi chuỗi giá đã đi vào hệ thống dưới dạng rõ — thứ bộ quét đi tìm. */
const MOI_GIA: readonly string[] = [...NHA_CUNG_CAP.map((n) => n.gia), GIA_SUA_LAI];

/** Bộ mở bọc CẶP với `rfqKeyWrapper` của `dichVuTest()` (xor 0xff) — chỉ worker cầm. */
const boMoBoc = {
  name: "doi-xung-cua-test",
  unwrap: (_orgId: string, wrapped: { ciphertext: Uint8Array }) =>
    Promise.resolve(wrapped.ciphertext.map((b) => b ^ 0xff)),
};

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let unsealPool: pg.Pool;
let dv: DichVuTest;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;
const logLoi: string[] = [];

interface Nguoi {
  readonly id: string;
  readonly cookie: string;
}
interface PhanHoi {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

function base32Decode(s: string): Buffer {
  const BANG = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let gia = 0;
  const ra: number[] = [];
  for (const ch of s) {
    const v = BANG.indexOf(ch);
    if (v < 0) throw new Error("base32 hong");
    gia = (gia << 5) | v;
    bits += 5;
    if (bits >= 8) {
      ra.push((gia >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(ra);
}

async function goi(method: string, path: string, cookie?: string, body?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  let than: string | undefined;
  if (body !== undefined) {
    than = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${goc}${path}`, { method, headers, body: than });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

/** Người mua đi TRỌN đường đăng nhập của S1.10.4: link → ghi danh TOTP → mã đúng → cookie. */
async function dangNhap(email: string, vaiTro: string): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, vaiTro]);
  const truoc = dv.linkDaGui.length;
  expect((await goi("POST", "/auth/link", undefined, { orgId: orgA, email })).status).toBe(200);
  expect(dv.linkDaGui).toHaveLength(truoc + 1);
  const token = dv.linkDaGui.at(-1)!.token;
  const rd = await goi("POST", "/auth/redeem", undefined, { orgId: orgA, token });
  expect(rd.status, rd.text).toBe(200);
  const biMat = base32Decode((rd.body as { totpSecretBase32: string }).totpSecretBase32);
  const r = await goi("POST", "/auth/totp", undefined, { orgId: orgA, token, code: deriveTotpCode(biMat, counterForTime(Date.now())) });
  expect(r.status, r.text).toBe(200);
  const gt = /tp_session=([^;]+)/u.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
  expect(gt).not.toBe("");
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${gt}` };
}

/** Nhà cung cấp đi TRỌN đường S1.3 qua HTTP: link (từ bộ gửi) → redeem → OTP → verify → cookie. */
async function moPhienKhach(tokenLink: string): Promise<string> {
  expect((await goi("POST", "/guest/redeem", undefined, { orgId: orgA, token: tokenLink })).status).toBe(200);
  const truoc = dv.otpDaGui.length;
  expect((await goi("POST", "/guest/otp", undefined, { orgId: orgA, token: tokenLink, channel: "SMS" })).status).toBe(200);
  expect(dv.otpDaGui).toHaveLength(truoc + 1);
  const r = await goi("POST", "/guest/otp/verify", undefined, { orgId: orgA, token: tokenLink, code: dv.otpDaGui.at(-1)!.code });
  expect(r.status, r.text).toBe(200);
  const gt = /tp_guest=([^;]+)/u.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
  expect(gt).not.toBe("");
  return `${COOKIE_PHIEN_KHACH}=${gt}`;
}

/** Bộ quét: mọi chuỗi giá tìm thấy trong một văn bản. Hàm THUẦN để có đối chứng dương. */
function quetRoRi(vanBan: string): readonly string[] {
  return MOI_GIA.filter((g) => vanBan.includes(g) || vanBan.includes(g.replace(/\.00$/u, "")));
}

const trangThai: {
  rfqId: string;
  loiMoi: { invitationId: string; supplierId: string; ten: string; gia: string; cookie: string }[];
  bienNhan: { canonicalText: string; signature: string; ten: string; bidVersionId: string }[];
  unsealRequestId: string;
  mua: Nguoi;
  pm2: Nguoi;
  pm3: Nguoi;
  gd1: Nguoi;
  gd2: Nguoi;
  taiChinh: Nguoi;
} = {
  rfqId: "",
  loiMoi: [],
  bienNhan: [],
  unsealRequestId: "",
  mua: { id: "", cookie: "" },
  pm2: { id: "", cookie: "" },
  pm3: { id: "", cookie: "" },
  gd1: { id: "", cookie: "" },
  gd2: { id: "", cookie: "" },
  taiChinh: { id: "", cookie: "" },
};

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logLoi.push(args.map(String).join(" "));
  });
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty Mua Sam A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  trangThai.mua = await dangNhap("mua@vidu.vn", "PROCUREMENT_MANAGER");
  trangThai.pm2 = await dangNhap("pm2@vidu.vn", "PROCUREMENT_MANAGER");
  trangThai.pm3 = await dangNhap("pm3@vidu.vn", "PROCUREMENT_MANAGER");
  trangThai.gd1 = await dangNhap("gd1@vidu.vn", "DIRECTOR");
  trangThai.gd2 = await dangNhap("gd2@vidu.vn", "DIRECTOR");
  // [033 / nợ 44] Ngưỡng phê duyệt kép do FINANCE đặt — PM (người đặt ước lượng, người duyệt) không được.
  trangThai.taiChinh = await dangNhap("taichinh@vidu.vn", "FINANCE");
}, 240000);

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[KỊCH BẢN 41 — QUA HTTP] RFQ 1 tỷ, 5 nhà cung cấp, sửa giá, mở thầu phê duyệt kép, bảng so sánh", () => {
  it("bước 1 — người mua dựng RFQ 1 tỷ qua HTTP và nó GIỮ yêu cầu phê duyệt kép", async () => {
    const m = trangThai.mua.cookie;
    expect((await goi("POST", "/policy", m, { version: 1, dualApprovalThreshold: "500000000.00", currency: "VND" })).status).toBe(403);
    expect((await goi("POST", "/policy", trangThai.taiChinh.cookie, { version: 1, dualApprovalThreshold: "500000000.00", currency: "VND" })).status).toBe(201);
    const rfq = await goi("POST", "/rfqs", m, { title: "Mua thep tam SS400 quy IV", deadlineAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
    expect(rfq.status, rfq.text).toBe(201);
    trangThai.rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/items`, m, { lineNo: 1, description: "Thep tam SS400 12mm", quantity: "100.0000", unit: "tam" })).status).toBe(201);
    const ns = await goi("PUT", `/rfqs/${trangThai.rfqId}/budget`, m, { estimatedValue: NGAN_SACH, currency: "VND" });
    expect(ns.status, ns.text).toBe(200);
    expect((ns.body as { budget: { requiresDualApproval: boolean } }).budget.requiresDualApproval).toBe(true);
  });

  it("bước 2 — hai người KHÁC NHAU duyệt qua HTTP, rồi RFQ mở kèm cặp khoá của chính nó", async () => {
    const m = trangThai.mua.cookie;
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/submit`, m)).status).toBe(200);
    // [INV-D2] người tạo không tự duyệt được (trigger 011 — 422, và [review H2-10] đọc đúng LÝ DO), hai PM khác duyệt.
    const tuDuyet = await goi("POST", `/rfqs/${trangThai.rfqId}/approve`, m);
    expect(tuDuyet.status).toBe(422);
    expect(tuDuyet.text).toContain("khong duoc la mot trong hai nguoi duyet (D2)");
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/approve`, trangThai.pm2.cookie)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/approve`, trangThai.pm3.cookie)).status).toBe(200);
    const mo = await goi("POST", `/rfqs/${trangThai.rfqId}/open`, m);
    expect(mo.status, mo.text).toBe(200);
    expect((mo.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");
    const { rows } = await db.pool.query("SELECT algorithm FROM rfq_key_material WHERE rfq_id = $1", [trangThai.rfqId]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("bước 3 — mời năm nhà cung cấp qua HTTP; mỗi người đi trọn link → OTP → phiên khách qua HTTP", async () => {
    const m = trangThai.mua.cookie;
    for (const [i, ncc] of NHA_CUNG_CAP.entries()) {
      const s = await goi("POST", "/suppliers", m, { legalName: ncc.ten, taxCode: `03000000${i}${i}` });
      expect(s.status, s.text).toBe(201);
      const supplierId = (s.body as { supplier: { id: string } }).supplier.id;
      const c = await goi("POST", `/suppliers/${supplierId}/contacts`, m, { fullName: `Kinh doanh ${i}`, email: `kd${i}@ncc.vn`, phone: `090000000${i}` });
      expect(c.status, c.text).toBe(201);
      const contactId = (c.body as { contact: { id: string } }).contact.id;
      const truoc = dv.loiMoiDaGui.length;
      const lm = await goi("POST", `/rfqs/${trangThai.rfqId}/invitations`, m, { supplierId, contactId });
      expect(lm.status, lm.text).toBe(201);
      expect(dv.loiMoiDaGui).toHaveLength(truoc + 1);
      const cookie = await moPhienKhach(dv.loiMoiDaGui.at(-1)!.token);
      trangThai.loiMoi.push({ invitationId: (lm.body as { invitation: { id: string } }).invitation.id, supplierId, ten: ncc.ten, gia: ncc.gia, cookie });
    }
    expect(trangThai.loiMoi).toHaveLength(5);
  });

  it("bước 4 — năm báo giá niêm phong ở phía nhà cung cấp, nộp qua HTTP, mỗi lần một biên nhận đã ký", async () => {
    for (const lm of trangThai.loiMoi) {
      const r = await goi("GET", "/guest/rfq", lm.cookie);
      expect(r.status, r.text).toBe(200);
      const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256");
      if (khoa === undefined) throw new Error("RFQ khong co khoa ECDH_P256 qua HTTP");
      const phongBi = await sealBid({
        rfqId: trangThai.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
        plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: lm.gia, currency: "VND", nhaCungCap: lm.ten })),
      });
      const bn = await goi("POST", "/guest/bids", lm.cookie, { envelope: Buffer.from(phongBi).toString("base64") });
      expect(bn.status, bn.text).toBe(201);
      const rc = (bn.body as { receipt: { version: number; canonicalText: string; signature: string; bidVersionId: string } }).receipt;
      expect(rc.version).toBe(1);
      expect(quetRoRi(bn.text), "phản hồi nộp thầu mang giá dạng rõ").toEqual([]);
      trangThai.bienNhan.push({ canonicalText: rc.canonicalText, signature: rc.signature, ten: lm.ten, bidVersionId: rc.bidVersionId });
    }
    expect(trangThai.bienNhan).toHaveLength(5);
  });

  it("bước 5 — [INV-B2] nhà cung cấp kiểm chứng biên nhận nhận qua HTTP bằng KHOÁ CÔNG KHAI MỘT MÌNH", async () => {
    for (const bn of trangThai.bienNhan) {
      expect(await verifyReceipt({ canonicalText: bn.canonicalText, signature: new Uint8Array(Buffer.from(bn.signature, "base64")), publicKey: dv.khoaKy.publicKey }), bn.ten).toBe(true);
    }
    const dau = trangThai.bienNhan[0]!;
    expect(await verifyReceipt({ canonicalText: dau.canonicalText.replace("version=1", "version=9"), signature: new Uint8Array(Buffer.from(dau.signature, "base64")), publicKey: dv.khoaKy.publicKey })).toBe(false);
    expect(createPublicKey({ key: Buffer.from(dv.khoaKy.publicKey), format: "der", type: "spki" }).asymmetricKeyType).toBe("ec");
  });

  it("bước 6 — [INV-B1] SỬA GIÁ trước hạn qua HTTP: version 2, bản cũ VẪN CÒN", async () => {
    const lm = trangThai.loiMoi[3]!;
    const r = await goi("GET", "/guest/rfq", lm.cookie);
    const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256")!;
    const phongBi = await sealBid({
      rfqId: trangThai.rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: GIA_SUA_LAI, currency: "VND", nhaCungCap: lm.ten })),
    });
    const bn2 = await goi("POST", "/guest/bids", lm.cookie, { envelope: Buffer.from(phongBi).toString("base64") });
    expect(bn2.status, bn2.text).toBe(201);
    expect((bn2.body as { receipt: { version: number } }).receipt.version).toBe(2);
    const ds = await goi("GET", "/guest/bids", lm.cookie);
    expect((ds.body as { bids: { versions: { version: number }[] }[] }).bids[0]?.versions.map((v) => v.version)).toEqual([1, 2]);
    lm.gia = GIA_SUA_LAI;
  });

  it("[INV-A1] [INV-A2] BỘ QUÉT RÒ RỈ: mọi route, bốn đối tượng, TRƯỚC mở thầu — không một chữ số giá nào ở thân, header, hay log", async () => {
    // Đối chứng dương TRƯỚC: bộ quét phải bắt được thứ nó đi tìm.
    expect(quetRoRi(JSON.stringify({ x: NHA_CUNG_CAP[0].gia }))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi(JSON.stringify({ x: 930000000 }))).toEqual([GIA_SUA_LAI]);
    expect(quetRoRi("{}")).toEqual([]);

    const m = trangThai.mua.cookie;
    const k = trangThai.loiMoi[0]!.cookie;
    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const thay = (path: string) =>
      path.replace(":rfqId", trangThai.rfqId).replace(":bidVersionId", trangThai.bienNhan[0]!.bidVersionId).replace(/:[A-Za-z]+/gu, UUID0);
    const logTruoc = logLoi.length;
    const roRi: string[] = [];
    let soGoi = 0;
    for (const r of ROUTES) {
      if (r.audience === "BUYER" && r.mutates && r.self === true) continue; // đăng xuất — không tự bắn vào chân
      const path = thay(r.path);
      const cacCa: { cookie?: string; body?: unknown }[] =
        r.audience === "PUBLIC" ? [{}]
        : r.audience === "ANON" ? [{ body: { orgId: orgA } }]
        : r.audience === "GUEST" ? [{ cookie: k }, { cookie: k, body: {} }]
        : [{ cookie: m }, { cookie: m, body: {} }];
      for (const ca of cacCa) {
        if (r.method === "GET" && ca.body !== undefined) continue;
        const ph = await goi(r.method, path, ca.cookie, r.method === "GET" ? undefined : (ca.body ?? {}));
        soGoi += 1;
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
      }
    }
    expect(soGoi).toBeGreaterThan(ROUTES.length);
    for (const dong of logLoi.slice(logTruoc)) for (const g of quetRoRi(dong)) roRi.push(`log: ${g}`);
    expect(roRi, "giá dạng rõ lọt ra trước khi mở thầu").toEqual([]);
    // Và trạng thái nghiệp vụ không bị bộ quét làm hỏng: RFQ vẫn OPEN, vẫn 5 lời mời.
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}`, m);
    expect((r.body as { rfq: { status: string } }).rfq.status).toBe("OPEN");
  });

  it("bước 7 — [INV-A6] trước khi đóng, số báo giá đã nhận bị GIẤU qua HTTP; sau khi đóng thì công bố", async () => {
    const m = trangThai.mua.cookie;
    const truoc = await goi("GET", `/rfqs/${trangThai.rfqId}/bid-count`, m);
    expect(truoc.status, truoc.text).toBe(200);
    expect((truoc.body as { bidCount: unknown }).bidCount).toEqual({ disclosed: false, reason: "STRICT_BLIND_BEFORE_CLOSE", rfqStatus: "OPEN" });
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/close`, m, { reason: "dong dung han theo ke hoach mua sam Q4" })).status).toBe(200);
    const sau = await goi("GET", `/rfqs/${trangThai.rfqId}/bid-count`, m);
    expect((sau.body as { bidCount: unknown }).bidCount).toEqual({ disclosed: true, count: 5 });
  });

  it("bước 8 — [INV-A4] RFQ đã CLOSED nhưng CHƯA mở thầu: bảng so sánh qua HTTP vẫn bị từ chối", async () => {
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    expect(r.status).toBe(422);
    expect(quetRoRi(r.text)).toEqual([]);
    const { rows } = await withTenant(apiPool, orgA, (c) => c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_unsealed_bids"));
    expect(rows[0]?.n).toBe("0");
  });

  it("bước 9 — [INV-D2] mở thầu cần HAI phê duyệt của HAI người qua HTTP, và người yêu cầu không tự duyệt", async () => {
    const yc = await goi("POST", `/rfqs/${trangThai.rfqId}/unseal`, trangThai.mua.cookie, { reason: "da het han nop, mo thau de cham" });
    expect(yc.status, yc.text).toBe(201);
    trangThai.unsealRequestId = (yc.body as { unsealRequest: { id: string; status: string } }).unsealRequest.id;
    expect((yc.body as { unsealRequest: { status: string } }).unsealRequest.status).toBe("PENDING");
    // Người yêu cầu (PM, không có rfq.unseal.approve) ⇒ 403 ngay ở dispatcher.
    expect((await goi("POST", `/unseal/${trangThai.unsealRequestId}/approve`, trangThai.mua.cookie)).status).toBe(403);
    const mot = await goi("POST", `/unseal/${trangThai.unsealRequestId}/approve`, trangThai.gd1.cookie);
    expect(mot.status, mot.text).toBe(200);
    expect((mot.body as { unsealRequest: { status: string } }).unsealRequest.status).toBe("PENDING");
    const hai = await goi("POST", `/unseal/${trangThai.unsealRequestId}/approve`, trangThai.gd2.cookie);
    expect((hai.body as { unsealRequest: { status: string } }).unsealRequest.status).toBe("APPROVED");
  });

  it("bước 10 — [INV-D1] cổng bốn vế cho qua qua HTTP, và `api` chỉ ĐẶT MỘT JOB chứ không giải mã", async () => {
    const dp = await goi("POST", `/unseal/${trangThai.unsealRequestId}/dispatch`, trangThai.mua.cookie);
    expect(dp.status, dp.text).toBe(200);
    expect((dp.body as { gate: { clauses: string[] } }).gate.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);
    const { rows } = await db.pool.query<{ kind: string }>("SELECT kind FROM outbox_jobs WHERE payload->>'unsealRequestId' = $1", [trangThai.unsealRequestId]);
    expect(rows.map((r) => r.kind)).toEqual(["UNSEAL_RFQ"]);
    // Bảng so sánh VẪN bị từ chối — điều phối không phải giải mã.
    expect((await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie)).status).toBe(422);
  });

  it("bước 11 — worker (KHÔNG qua HTTP, và đó là điểm mấu chốt) mở năm phong bì, lấy PHIÊN BẢN CUỐI", async () => {
    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: trangThai.unsealRequestId, unwrapper: boMoBoc }));
    expect(kq.opened).toBe(5);
    expect(kq.failedBidVersionIds).toEqual([]);
  });

  it("bước 12 — BẢNG SO SÁNH qua HTTP: năm dòng, sắp theo giá, giá SỬA LẠI thắng — và đây là lần ĐẦU giá đi ra", async () => {
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    expect(r.status, r.text).toBe(200);
    const bang = (r.body as { comparison: { rfqStatus: string; rows: { supplierLegalName: string; totalAmount: string }[]; aggregates: { min: string; max: string; belowBudget: number } } }).comparison;
    expect(bang.rfqStatus).toBe("UNSEALED");
    const mongDoi = [...trangThai.loiMoi].sort((a, b) => Number(a.gia) - Number(b.gia));
    expect(bang.rows.map((x) => x.supplierLegalName)).toEqual(mongDoi.map((x) => x.ten));
    expect(bang.rows.map((x) => x.totalAmount)).toEqual(mongDoi.map((x) => x.gia));
    expect(bang.rows[0]?.totalAmount).toBe(GIA_SUA_LAI);
    expect(bang.aggregates.min).toBe(GIA_SUA_LAI);
    expect(bang.aggregates.max).toBe("1400000000.00");
    expect(bang.aggregates.belowBudget).toBe(2);
    // Sau UNSEALED, giá đi ra là ĐÚNG — bộ quét phải thấy nó, nếu không bộ quét mù.
    expect(quetRoRi(r.text).length).toBeGreaterThan(0);
  });

  it("[INV-A2] [INV-A5] [INV-A4] BỘ QUÉT RÒ RỈ LẦN HAI — SAU mở thầu, khi bản rõ ĐÃ nằm trong CSDL: năm phiên khách và một người mua KHÔNG có bid.view đọc mọi route đọc — không giá nào lọt", async () => {
    // [review H2-4 ⑴⑷] Vòng quét thứ nhất chạy TRƯỚC mở thầu, khi bản rõ giá chưa tồn tại phía máy chủ —
    // không route nào rò được thứ chưa có. Vòng này chạy ở cửa sổ có nghĩa: `rfq_unsealed_bids` đã có
    // năm hàng, và người đọc là đúng hai đối tượng A5/A4 nói tới. Đối chứng dương ngay trên: bước 12
    // thấy giá với người có `bid.view`.
    const khongXem = await dangNhap("khongxem@vidu.vn", "BUYER"); // BUYER không có bid.view (005)
    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const thay = (path: string) =>
      path.replace(":rfqId", trangThai.rfqId).replace(":unsealRequestId", trangThai.unsealRequestId).replace(/:[A-Za-z]+/gu, UUID0);
    const roRi: string[] = [];
    let soGoi = 0;
    for (const r of ROUTES) {
      if (r.method !== "GET") continue;
      const cookies =
        r.audience === "GUEST" ? trangThai.loiMoi.map((lm) => lm.cookie)
        : r.audience === "BUYER" ? [khongXem.cookie]
        : [];
      for (const cookie of cookies) {
        const path = r.audience === "GUEST" && r.path.includes(":bidVersionId")
          ? r.path.replace(":bidVersionId", trangThai.bienNhan.find((b) => trangThai.loiMoi.some((lm) => lm.cookie === cookie && lm.ten === b.ten))?.bidVersionId ?? UUID0)
          : thay(r.path);
        const ph = await goi(r.method, path, cookie);
        soGoi += 1;
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
      }
    }
    expect(soGoi).toBeGreaterThan(5 * 4 + 8);
    expect(roRi, "giá dạng rõ lọt ra SAU mở thầu tới người không được xem").toEqual([]);
    // Và cổng bid.view thật sự đóng với người này (403), không phải "rỗng vì chưa có gì".
    expect((await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, khongXem.cookie)).status).toBe(403);
  });

  it("bước 13 — [INV-B5] job toàn vẹn chạy sạch trên sáu phiên bản (đường vận hành, không HTTP)", async () => {
    const bc = await withTenant(unsealPool, orgA, (c) => auditStoredCiphertexts(c, orgA, trangThai.rfqId));
    expect(bc.checked).toBe(6);
    expect(bc.mismatched).toEqual([]);
    expect(bc.missingReceipt).toEqual([]);
  });

  it("bước 14 — [INV-A3] sau tất cả, giá dạng rõ chỉ tồn tại ở ĐÚNG MỘT bảng", async () => {
    const { rows: bang } = await db.pool.query<{ ten: string }>(
      "SELECT c.relname AS ten FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname",
    );
    const dinh: string[] = [];
    for (const b of bang) {
      if (!/^[a-z_][a-z0-9_]*$/u.test(b.ten)) throw new Error(`ten bang la: ${b.ten}`);
      const { rows } = await db.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${b.ten} t WHERE t::text LIKE '%' || $1 || '%'`, [GIA_SUA_LAI]);
      if (rows[0]?.n !== "0") dinh.push(b.ten);
    }
    expect(bang.length).toBeGreaterThan(20);
    expect(dinh).toEqual(["rfq_unsealed_bids"]);
  }, 120000);

  it("bước 15 — sổ kiểm toán kể lại toàn bộ kịch bản, kể cả năm lần đăng nhập qua TOTP, theo đúng thứ tự", async () => {
    const { rows } = await db.pool.query<{ action: string }>("SELECT action FROM audit_events WHERE org_id = $1 ORDER BY seq", [orgA]);
    const cac = rows.map((r) => r.action);
    for (const moc of ["RFQ_CREATED", "RFQ_SUBMITTED_FOR_APPROVAL", "RFQ_APPROVED", "RFQ_KEY_MATERIAL_ISSUED", "RFQ_OPENED", "GUEST_SESSION_STARTED", "RFQ_CLOSED", "UNSEAL_REQUESTED", "UNSEAL_APPROVED", "UNSEAL_DISPATCHED", "RFQ_KEY_MATERIAL_UNWRAPPED", "RFQ_UNSEALED"]) {
      expect(cac, `sổ kiểm toán thiếu mốc ${moc}`).toContain(moc);
    }
    expect(cac.indexOf("RFQ_KEY_MATERIAL_UNWRAPPED")).toBeGreaterThan(cac.lastIndexOf("UNSEAL_APPROVED"));
    expect(cac.indexOf("RFQ_UNSEALED")).toBeGreaterThan(cac.indexOf("RFQ_KEY_MATERIAL_UNWRAPPED"));
    expect(cac.filter((a) => a === "GUEST_SESSION_STARTED")).toHaveLength(5);
    // Không một dòng sổ nào mang giá — sổ là bằng chứng, không phải nơi rò.
    const { rows: so } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND payload::text LIKE '%' || $2 || '%'", [orgA, GIA_SUA_LAI]);
    expect(so[0]?.n).toBe("0");
    // Và token, mã OTP, bí mật TOTP không ở đâu trong sổ.
    for (const t of [...dv.linkDaGui.map((l) => l.token), ...dv.otpDaGui.map((o) => o.code), ...dv.loiMoiDaGui.map((l) => l.token)]) {
      const { rows: r2 } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND payload::text LIKE '%' || $2 || '%'", [orgA, t]);
      expect(r2[0]?.n, "bí mật lọt vào sổ kiểm toán").toBe("0");
    }
    // Không log lỗi nào của tiến trình mang bất kỳ bí mật nào. [review H2-4 ⑵] Bản trước "chống rỗng
    // ruột" bằng `sha256(log).length === 64` — đúng cả với chuỗi rỗng. Nay ép MỘT 500 THẬT (bộ mở bí
    // mật TOTP ném, thông điệp cố ý mang phong bì) để log KHÔNG rỗng trước khi đòi nó sạch.
    const truocLog = logLoi.length;
    expect((await goi("POST", "/auth/link", undefined, { orgId: orgA, email: "mua@vidu.vn" })).status).toBe(200);
    const tokenHong = dv.linkDaGui.at(-1)!.token;
    dv.hong.totpUnsealer = true;
    try {
      expect((await goi("POST", "/auth/totp", undefined, { orgId: orgA, token: tokenHong, code: "000000" })).status).toBe(500);
    } finally {
      dv.hong.totpUnsealer = false;
    }
    expect(logLoi.length).toBe(truocLog + 1);
    const toanBo = logLoi.join("\n");
    expect(toanBo.length).toBeGreaterThan(0);
    for (const t of [...dv.linkDaGui.map((l) => l.token), ...dv.otpDaGui.map((o) => o.code)]) expect(toanBo).not.toContain(t);
    expect(toanBo).not.toContain("KMS gia dang hong");
    for (const g of quetRoRi(toanBo)) expect.fail(`giá trong log: ${g}`);
  });
});
