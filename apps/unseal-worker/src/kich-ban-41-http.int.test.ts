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
import { dichVuTest, outboxTest, type DichVuTest } from "../../api/src/test-services.js";
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
/**
 * [S1.109 / S2.5] HAI GIÁ CỦA VÒNG BAFO — và ba tính chất của chúng đều là điều kiện để **J4**
 * đo được thật:
 *
 * ⑴ **Chuỗi chữ số KHÁC HẲN mọi giá vòng một.** Nếu một giá BAFO trùng chữ số với một giá đã mở,
 *    thì *"bộ quét thấy nó"* và *"bộ quét không thấy nó"* đều KHÔNG nói gì — con số ấy đã hợp lệ
 *    có mặt ở khắp nơi từ trước. Lượt quét khi ấy xanh mà rỗng ruột.
 * ⑵ **Thấp hơn mọi giá vòng một** (`930000000.00` là thấp nhất sau lần sửa) — BAFO là *best and
 *    final*, nên một giá BAFO cao hơn sẽ làm bảng xếp hạng sau vòng hai không đổi và ca *"xếp
 *    hạng tính LẠI"* mất răng.
 * ⑶ **Khác nhau đôi một**, để hai nhà cung cấp không hoán đổi được cho nhau trong khẳng định.
 */
const GIA_BAFO = ["911000000.00", "922000000.00"] as const;
/** Mọi chuỗi giá đã đi vào hệ thống dưới dạng rõ — thứ bộ quét đi tìm. */
const MOI_GIA: readonly string[] = [...NHA_CUNG_CAP.map((n) => n.gia), GIA_SUA_LAI, ...GIA_BAFO];

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
let ob: ReturnType<typeof outboxTest>;
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
  await ob.chay(orgA); // [sổ nợ 38] link ra đời khi job chạy
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

/** Giá dưới dạng SỐ NGUYÊN đồng (không phần thập phân) — thứ bộ dò so sánh, thay vì một cách viết. */
const GIA_SO: ReadonlyMap<number, string> = new Map(MOI_GIA.map((g) => [Number(g), g]));

/**
 * Rút mọi giá trị số có thể đọc ra từ một văn bản, theo MỌI cách viết thường gặp:
 * `980000000.00`, `980000000`, `980,000,000`, `980.000.000`, `980 000 000`, `9.8e8`, `9.8E+8`.
 * Mỗi mẩu số cho vài cách đọc (bỏ hết dấu phân cách; bỏ hai chữ số thập phân cuối rồi bỏ phân cách);
 * số mũ được tính ra. Trả về tập số nguyên.
 */
function rutSo(vanBan: string): ReadonlySet<number> {
  const ra = new Set<number>();
  // ============================================================================================
  // [S1.19 / CI run 34125062632] NHÁNH KÝ HIỆU KHOA HỌC PHẢI CÓ BIÊN — NẾU KHÔNG NÓ ĐỌC UUID
  // ============================================================================================
  // Bản trước không có hai vế nhìn trước/nhìn sau, nên nó khớp `98e7` **bên trong** một chuỗi
  // hex: `Number("98e7")` = 980 000 000 = ĐÚNG một giá của kịch bản. Một UUID bất kỳ chứa `98e7`
  // hay `14e8` làm bộ quét báo RÒ RỈ trên một phản hồi KHÔNG có một trường giá nào —
  // `GET /guest/session` trả về đúng bốn trường: hai UUID, một rfqId, một kênh.
  //
  // ĐO ĐƯỢC, và đây là lý do nó chỉ thỉnh thoảng đỏ: trên 300 000 thân giả lập của
  // `GET /guest/session` (5 phiên, 15 UUID mỗi thân) bản cũ báo rò rỉ **1381 lần — 0,46%**. Với
  // hơn bốn mươi route mỗi lượt quét và hai lượt quét mỗi lần chạy, một lượt CI đỏ vì lý do này
  // là chuyện thường gặp chứ không phải hiếm — và nó đã đỏ ở CI của chính vòng S1.19
  // (`kich-ban-41-http.int.test.ts`, `GET /guest/session (200): 930000000.00`).
  //
  // Vì sao đây là khiếm khuyết NẶNG dù nó là ĐỎ GIẢ: nó là một cổng an ninh kêu sai định kỳ, và
  // một cổng như thế dạy người ta chạy lại thay vì đọc. Ngày nó kêu ĐÚNG, phản xạ đã được huấn
  // luyện sẵn là bấm "re-run".
  //
  // Biên: hai vế chặn cả chữ-số-chữ-cái LẪN dấu `-` (một mảnh UUID có thể ĐÚNG BẰNG `98e7`, khi
  // ấy nó đứng giữa hai dấu gạch nối). Giá là số DƯƠNG, nên `-9.8e8` không phải thứ cần bắt.
  // Mọi cách viết thật vẫn khớp: `gia: 9.8e8 VND`, `9.8E+8`, `0.98e9`, `"9.8e8"` trong JSON.
  for (const m of vanBan.matchAll(/(?<![0-9A-Za-z-])\d+(?:[.,]\d+)?[eE][+-]?\d+(?![0-9A-Za-z-])/gu)) {
    const n = Number(m[0].replace(",", "."));
    if (Number.isFinite(n)) ra.add(Math.round(n));
  }
  for (const m of vanBan.matchAll(/\d(?:[\d.,_ ]*\d)?/gu)) {
    const t = m[0];
    const chiSo = t.replace(/[^\d]/gu, "");
    if (chiSo.length > 0 && chiSo.length <= 15) ra.add(Number(chiSo));
    const boThapPhan = t.replace(/[.,]\d{1,2}$/u, "").replace(/[^\d]/gu, "");
    if (boThapPhan.length > 0 && boThapPhan.length <= 15) ra.add(Number(boThapPhan));
  }
  return ra;
}

/**
 * Bộ quét: mọi giá TÌM THẤY trong một văn bản, theo GIÁ TRỊ — không phải theo một chuỗi đã biết.
 * [sổ nợ 49 / review H2-4] Bản cũ là `includes` trên chuỗi thập phân: `980,000,000`, `9.8e8`, base64
 * đi lọt. Nay: rút số theo mọi cách viết; và mọi khối trông như base64 ~~(≥ 16 ký tự) được giải mã rồi
 * quét lại một lần~~ [review H4-11] base64, base64url (`-`/`_` — dạng token và cookie của dự án) hay HEX
 * (≥ 16 ký tự) được giải mã rồi quét lại, sâu HAI tầng. Vẫn KHÔNG bắt được rò THỨ TỰ (xếp hạng), và
 * không bắt mã hoá/nén khác ba dạng ấy — §4 của A2. Hàm THUẦN để có đối chứng dương.
 */
const SAU_TOI_DA = 2;
function quetRoRi(vanBan: string, sau = 0): readonly string[] {
  const thay = new Set<string>();
  for (const so of rutSo(vanBan)) {
    const g = GIA_SO.get(so);
    if (g !== undefined) thay.add(g);
  }
  if (sau < SAU_TOI_DA) {
    const khoi: { chuoi: string; ma: BufferEncoding }[] = [];
    for (const m of vanBan.matchAll(/[A-Za-z0-9+/]{16,}={0,2}/gu)) khoi.push({ chuoi: m[0], ma: "base64" });
    for (const m of vanBan.matchAll(/[A-Za-z0-9_-]{16,}/gu)) if (/[_-]/u.test(m[0])) khoi.push({ chuoi: m[0], ma: "base64url" });
    for (const m of vanBan.matchAll(/\b[0-9a-fA-F]{16,}\b/gu)) if (m[0].length % 2 === 0) khoi.push({ chuoi: m[0], ma: "hex" });
    for (const { chuoi, ma } of khoi) {
      let giaiMa: string;
      try {
        giaiMa = Buffer.from(chuoi, ma).toString("utf8");
      } catch {
        continue;
      }
      // Chỉ văn bản in được mới đáng quét lại — một phong bì nhị phân không phải chỗ giá đứng dạng rõ.
      if (/^[\x20-\x7e\s]+$/u.test(giaiMa)) for (const g of quetRoRi(giaiMa, sau + 1)) thay.add(g);
    }
  }
  return MOI_GIA.filter((g) => thay.has(g));
}

/** Trạng thái RFQ của kịch bản, đọc thẳng dưới vai superuser — không qua route nào. */
async function trangThaiRfq(): Promise<string> {
  const { rows } = await db.pool.query<{ status: string }>(
    "SELECT status FROM rfq_packages WHERE id = $1",
    [trangThai.rfqId],
  );
  return rows[0]?.status ?? "";
}

const trangThai: {
  rfqId: string;
  loiMoi: { invitationId: string; supplierId: string; ten: string; gia: string; cookie: string }[];
  bienNhan: { canonicalText: string; signature: string; ten: string; bidVersionId: string }[];
  unsealRequestId: string;
  bafoRoundId: string;
  awardId: string;
  topN: string[];
  giaBafo: Map<string, string>;
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
  bafoRoundId: "",
  awardId: "",
  topN: [],
  giaBafo: new Map(),
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
  ob = outboxTest(apiPool, dv.services);
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
    // [S1.107 / lượt soi ngang 77 — CAO ②] Chính sách NAY khai trọng số qua HTTP. Trước vòng này
    // `createProcurementPolicy` không có đường ghi `eval_components`, nên mọi tổ chức tạo qua
    // sản phẩm đều KHÔNG chấm thầu được — và không cổng nào thấy, vì mọi fixture ghi SQL thẳng.
    expect((await goi("POST", "/policy", trangThai.taiChinh.cookie, { version: 1, dualApprovalThreshold: "500000000.00", currency: "VND", evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 2 })).status).toBe(201);
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
    // Đối chứng dương TRƯỚC: bộ quét phải bắt được thứ nó đi tìm — theo GIÁ TRỊ, mọi cách viết (sổ nợ 49).
    expect(quetRoRi(JSON.stringify({ x: NHA_CUNG_CAP[0].gia }))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi(JSON.stringify({ x: 930000000 }))).toEqual([GIA_SUA_LAI]);
    for (const cachViet of ["980,000,000", "980.000.000", "980 000 000", "980,000,000.00", "9.8e8", "9.8E+8", "0.98e9"]) {
      expect(quetRoRi(`gia: ${cachViet} VND`), cachViet).toEqual([NHA_CUNG_CAP[0].gia]);
    }
    expect(quetRoRi(Buffer.from('{"totalAmount":"1400000000.00"}').toString("base64"))).toEqual(["1400000000.00"]);
    // [review H4-11] base64url (dạng token/cookie của dự án), hex, và hai tầng (base64 trong base64url).
    expect(quetRoRi(Buffer.from('{"gia":"980000000.00","k":">>>???"}').toString("base64url"))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi(Buffer.from('{"totalAmount":"1400000000.00"}').toString("hex"))).toEqual(["1400000000.00"]);
    expect(quetRoRi(Buffer.from(Buffer.from('{"gia":"980000000.00","k":">>>???"}').toString("base64")).toString("base64url"))).toEqual([NHA_CUNG_CAP[0].gia]);
    expect(quetRoRi("{}")).toEqual([]);
    expect(quetRoRi(JSON.stringify({ deadlineAt: "2026-09-07T10:00:00.000Z", id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", n: 98000000 }))).toEqual([]);
    // [S1.19 / CI run 34125062632] BA CA UUID PHẢI SẠCH — chúng là ca đã làm CI đỏ.
    // `98e7` và `14e8` nằm trong một chuỗi hex đọc ra 980 000 000 và 1 400 000 000, đúng hai giá
    // của kịch bản; và một mảnh UUID có thể ĐÚNG BẰNG `98e7`, khi ấy nó đứng giữa hai gạch nối.
    expect(quetRoRi(JSON.stringify({ id: "c98e7abc-1234-4567-89ab-000000000000" })), "98e7 trong hex").toEqual([]);
    expect(quetRoRi(JSON.stringify({ id: "abcd1234-98e7-4567-89ab-00000014e800" })), "98e7 là MỘT mảnh UUID").toEqual([]);
    expect(quetRoRi(JSON.stringify({ id: "0000000a-0000-4000-8000-0000c14e8abc" })), "14e8 trong hex").toEqual([]);
    // Và bộ quét KHÔNG được mất răng vì hai vế biên vừa thêm: một thân đúng năm phiên khách của
    // `GET /guest/session` mang một giá THẬT vẫn phải bị bắt.
    expect(
      quetRoRi(
        JSON.stringify({
          sessions: [{ guestSessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", tong: "980000000.00" }],
        }),
      ),
    ).toEqual([NHA_CUNG_CAP[0].gia]);

    const m = trangThai.mua.cookie;
    const k = trangThai.loiMoi[0]!.cookie;
    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

    // [sổ nợ 49 / review H2-4 ⑶] HAI RFQ HY SINH để route GHI được gọi với thân HỢP LỆ và đích THẬT, thay
    // vì `{}` (422 trước nghiệp vụ). `hyB` ở DRAFT đi qua items → budget → submit → approve → open theo
    // đúng thứ tự ROUTES; `hyA` đã OPEN kèm một lời mời và một phiên khách — cho route khách ghi (nộp
    // một phong bì THẬT với giá mồi KHÔNG thuộc bộ giá) và cho extend → close → unseal → approve/cancel.
    // Không chạm RFQ chính: bộ quét không được làm hỏng kịch bản nó đang bảo vệ.
    const GIA_MOI = "777000000.00";
    const taoRfqHy = async (ten: string): Promise<string> => {
      const r = await goi("POST", "/rfqs", m, { title: ten, deadlineAt: new Date(Date.now() + 5 * 86400_000).toISOString() });
      expect(r.status, r.text).toBe(201);
      return (r.body as { rfq: { id: string } }).rfq.id;
    };
    const hyA = await taoRfqHy("RFQ hy sinh A (mo)");
    expect((await goi("POST", `/rfqs/${hyA}/items`, m, { lineNo: 1, description: "Vat tu hy sinh", quantity: "1.0000", unit: "cai" })).status).toBe(201);
    expect((await goi("PUT", `/rfqs/${hyA}/budget`, m, { estimatedValue: "10000000.00", currency: "VND" })).status).toBe(200);
    expect((await goi("POST", `/rfqs/${hyA}/submit`, m)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${hyA}/approve`, trangThai.pm2.cookie)).status).toBe(200);
    expect((await goi("POST", `/rfqs/${hyA}/open`, m)).status).toBe(200);
    const nccHy = await goi("POST", "/suppliers", m, { legalName: "Cong ty Hy Sinh", taxCode: "0399999999" });
    expect(nccHy.status, nccHy.text).toBe(201);
    const nccHyId = (nccHy.body as { supplier: { id: string } }).supplier.id;
    const lhHy = await goi("POST", `/suppliers/${nccHyId}/contacts`, m, { fullName: "Lien he hy sinh", email: "hy@ncc.vn", phone: "0909999999" });
    expect(lhHy.status, lhHy.text).toBe(201);
    const lhHyId = (lhHy.body as { contact: { id: string } }).contact.id;
    const truocMoi = dv.loiMoiDaGui.length;
    const lmHy = await goi("POST", `/rfqs/${hyA}/invitations`, m, { supplierId: nccHyId, contactId: lhHyId });
    expect(lmHy.status, lmHy.text).toBe(201);
    expect(dv.loiMoiDaGui).toHaveLength(truocMoi + 1);
    const kHy = await moPhienKhach(dv.loiMoiDaGui.at(-1)!.token);
    const khoaHy = (await goi("GET", "/guest/rfq", kHy)).body as { publicKeys: { algorithm: string; publicKey: string }[] };
    const phongBiHy = await sealBid({
      rfqId: hyA,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoaHy.publicKeys.find((x) => x.algorithm === "ECDH_P256")!.publicKey, "base64")),
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: GIA_MOI, currency: "VND" })),
    });
    const hyB = await taoRfqHy("RFQ hy sinh B (nhap)");
    const nanHy = await dangNhap("nan-hy@vidu.vn", "BUYER");
    const hy: { unsealId: string; mfaResetId: string } = { unsealId: UUID0, mfaResetId: UUID0 };

    /** Thân + đích + người gọi hợp lệ cho MỖI route ghi; đọc kết quả để cho route sau một đích thật. */
    const thanHopLe = (r: (typeof ROUTES)[number]): { path: string; body: unknown; cookie: string; sau?: (ph: PhanHoi) => void } | null => {
      const han = new Date(Date.now() + 9 * 86400_000).toISOString();
      const tokenGia = "A".repeat(43); // đúng hình dạng base64url ≥ 32 ký tự, không tồn tại
      switch (`${r.method} ${r.path}`) {
        // Sáu route VÔ DANH mang credential trong thân: thân đúng hình dạng để qua bộ đọc thân và dừng ở
        // nghiệp vụ (token lạ ⇒ 422 có tên; email lạ ⇒ cùng một 200). Không dùng credential thật ở đây —
        // bộ quét không được tiêu thụ link/OTP của kịch bản nó đang bảo vệ.
        case "POST /guest/redeem":
          return { path: r.path, body: { orgId: orgA, token: tokenGia }, cookie: "" };
        case "POST /guest/otp":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, channel: "EMAIL" }, cookie: "" };
        case "POST /guest/otp/verify":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, code: "000000" }, cookie: "" };
        case "POST /auth/link":
          return { path: r.path, body: { orgId: orgA, email: "quet-vo-danh@vidu.vn" }, cookie: "" };
        case "POST /auth/redeem":
          return { path: r.path, body: { orgId: orgA, token: tokenGia }, cookie: "" };
        case "POST /auth/totp":
          return { path: r.path, body: { orgId: orgA, token: tokenGia, code: "000000" }, cookie: "" };
        case "POST /guest/bids":
          return { path: r.path, body: { envelope: Buffer.from(phongBiHy).toString("base64") }, cookie: kHy };
        case "POST /policy":
          // [S1.107] Bản v2 mà bộ quét tạo THÀNH bản hiệu lực, nên nó phải khai trọng số — nếu không,
          // bước 12b chấm thầu trên một chính sách không khai và dừng ở `CHINH_SACH_CHUA_KHAI_TRONG_SO`.
          return { path: r.path, body: { version: 2, dualApprovalThreshold: "500000000.00", currency: "VND", evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 2 }, cookie: trangThai.taiChinh.cookie };
        case "POST /suppliers":
          return { path: r.path, body: { legalName: "Cong ty Quet", taxCode: "0388888888" }, cookie: m };
        case "POST /suppliers/:supplierId/contacts":
          return { path: r.path.replace(":supplierId", nccHyId), body: { fullName: "Lien he quet", email: "quet@ncc.vn", phone: "0908888888" }, cookie: m };
        case "POST /rfqs":
          return { path: r.path, body: { title: "RFQ quet", deadlineAt: han }, cookie: m };
        case "POST /rfqs/:rfqId/items":
          return { path: r.path.replace(":rfqId", hyB), body: { lineNo: 1, description: "Hang muc quet", quantity: "2.0000", unit: "cai" }, cookie: m };
        case "PUT /rfqs/:rfqId/budget":
          return { path: r.path.replace(":rfqId", hyB), body: { estimatedValue: "20000000.00", currency: "VND" }, cookie: m };
        case "POST /rfqs/:rfqId/submit":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        case "POST /rfqs/:rfqId/approve":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: trangThai.pm2.cookie };
        case "POST /rfqs/:rfqId/open":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        case "POST /rfqs/:rfqId/extend":
          return { path: r.path.replace(":rfqId", hyA), body: { reason: "gia han de quet", newDeadlineAt: han }, cookie: m };
        case "POST /rfqs/:rfqId/close":
          return { path: r.path.replace(":rfqId", hyA), body: { reason: "dong de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/cancel":
          return { path: r.path.replace(":rfqId", hyB), body: { reason: "huy de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/invitations":
          return { path: r.path.replace(":rfqId", hyA), body: { supplierId: nccHyId, contactId: lhHyId }, cookie: m };
        case "POST /invitations/:invitationId/revoke":
          return { path: r.path.replace(":invitationId", UUID0), body: { reason: "thu hoi de quet" }, cookie: m };
        case "POST /invitations/:invitationId/unlock":
          return { path: r.path.replace(":invitationId", UUID0), body: { reason: "mo khoa de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/unseal":
          return {
            path: r.path.replace(":rfqId", hyA),
            body: { reason: "mo thau RFQ hy sinh" },
            cookie: m,
            sau: (ph) => {
              if (ph.status === 201) hy.unsealId = (ph.body as { unsealRequest: { id: string } }).unsealRequest.id;
            },
          };
        case "POST /unseal/:unsealRequestId/approve":
          return { path: r.path.replace(":unsealRequestId", hy.unsealId), body: {}, cookie: trangThai.gd1.cookie };
        case "POST /unseal/:unsealRequestId/dispatch":
          return { path: r.path.replace(":unsealRequestId", hy.unsealId), body: {}, cookie: m };
        case "POST /unseal/:unsealRequestId/cancel":
          return { path: r.path.replace(":unsealRequestId", hy.unsealId), body: {}, cookie: m };
        // [S1.106 / S2.4] RFQ hy sinh B đang ở DRAFT, nên lượt chấm dừng ở
        // `RFQ_KHONG_CHAM_DUOC` — một 422 NGHIỆP VỤ có tên, đúng thứ bộ quét cần: thân đã qua
        // bộ đọc thân và chạm nghiệp vụ. Không dùng RFQ thật của kịch bản: một lượt chấm đổi
        // trạng thái gói thầu sang EVALUATING và bộ quét không được làm thế.
        case "POST /rfqs/:rfqId/evaluate":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        // [S1.109 / S2.5] Hai route BAFO đi tới `hyB` — một RFQ ở `DRAFT`, nên chúng dừng ở lời
        // TỪ CHỐI CÓ TÊN của `VongBafoTuChoiError` (422) chứ không ở một 422 hình dạng. Đó đúng
        // là thứ sổ nợ 49 đòi: route ghi phải đi TỚI nghiệp vụ, không dừng ở bộ đọc thân.
        case "POST /rfqs/:rfqId/bafo":
          return { path: r.path.replace(":rfqId", hyB), body: { deadlineAt: han }, cookie: m };
        case "POST /rfqs/:rfqId/bafo/close":
          return { path: r.path.replace(":rfqId", hyB), body: {}, cookie: m };
        // [S1.110 / S2.6] BA route trao thầu đi tới `hyB` — một RFQ ở `DRAFT` — nên chúng
        // dừng ở lời TỪ CHỐI CÓ TÊN của `TraoThauTuChoiError` (422), sau khi đã qua bộ đọc
        // thân và chạm nghiệp vụ. `bidVersionId` là `UUID0`: nó chỉ cần đúng HÌNH DẠNG, vì
        // phép kiểm trạng thái gói thầu nổ TRƯỚC khi câu `INSERT` chạm khoá ngoại nào.
        //
        // Hai route DUYỆT và HUỶ đi bằng cookie GIÁM ĐỐC, không `m`: cổng của chúng là
        // `po.approve`, và `PROCUREMENT_MANAGER` KHÔNG giữ mã ấy — dùng `m` sẽ cho một 403 ở
        // cổng quyền, tức route KHÔNG đi tới nghiệp vụ và bộ quét đo một thế giới rỗng.
        case "POST /rfqs/:rfqId/award":
          return { path: r.path.replace(":rfqId", hyB), body: { bidVersionId: UUID0, reason: "de xuat de quet" }, cookie: m };
        case "POST /rfqs/:rfqId/award/:awardId/approve":
          return { path: r.path.replace(":rfqId", hyB).replace(":awardId", UUID0), body: {}, cookie: trangThai.gd1.cookie };
        case "POST /rfqs/:rfqId/award/cancel":
          return { path: r.path.replace(":rfqId", hyB), body: { reason: "huy de quet" }, cookie: trangThai.gd1.cookie };
        case "POST /users/:userId/mfa-reset":
          return {
            path: r.path.replace(":userId", nanHy.id),
            body: { reason: "mat may, quet" },
            cookie: m,
            sau: (ph) => {
              if (ph.status === 201) hy.mfaResetId = (ph.body as { mfaReset: { id: string } }).mfaReset.id;
            },
          };
        case "POST /mfa-resets/:requestId/approve":
          return { path: r.path.replace(":requestId", hy.mfaResetId), body: {}, cookie: trangThai.pm2.cookie };
        // [review H4-2] Yêu cầu ở trên đã được duyệt (tiêu thụ) trước khi tới đây ⇒ 422 nghiệp vụ có
        // tên — vẫn là "qua bộ đọc thân", đúng thứ bộ quét cần.
        case "POST /mfa-resets/:requestId/cancel":
          return { path: r.path.replace(":requestId", hy.mfaResetId), body: {}, cookie: m };
        default:
          return null;
      }
    };
    const LOI_HINH_DANG = /thiếu trường|phải là|không phải ngày|không hợp lệ"?\s*$/u;

    const thay = (path: string) =>
      path.replace(":rfqId", trangThai.rfqId).replace(":bidVersionId", trangThai.bienNhan[0]!.bidVersionId).replace(/:[A-Za-z]+/gu, UUID0);
    const logTruoc = logLoi.length;
    const roRi: string[] = [];
    const loiHinhDang: string[] = [];
    let soGoi = 0;
    let soThanhCong = 0;
    for (const r of ROUTES) {
      if (r.audience === "BUYER" && r.mutates && r.self === true) continue; // đăng xuất — không tự bắn vào chân
      const laGhi = r.method !== "GET";
      const hopLe = laGhi ? thanHopLe(r) : null;
      if (laGhi && r.audience !== "PUBLIC") {
        expect(hopLe, `route ghi ${r.method} ${r.path} chưa có thân hợp lệ trong bộ quét (sổ nợ 49)`).not.toBeNull();
      }
      const cacCa: { path: string; cookie?: string; body?: unknown; sau?: (ph: PhanHoi) => void }[] =
        r.audience === "PUBLIC" ? [{ path: thay(r.path) }]
        : hopLe !== null
          ? [{ path: hopLe.path, ...(hopLe.cookie === "" ? {} : { cookie: hopLe.cookie }), body: hopLe.body, ...(hopLe.sau === undefined ? {} : { sau: hopLe.sau }) }]
          : [{ path: thay(r.path), cookie: r.audience === "GUEST" ? k : m }];
      for (const ca of cacCa) {
        const ph = await goi(r.method, ca.path, ca.cookie, r.method === "GET" ? undefined : (ca.body ?? {}));
        soGoi += 1;
        ca.sau?.(ph);
        if (laGhi && ph.status < 300) soThanhCong += 1;
        if (laGhi && ph.status === 422 && LOI_HINH_DANG.test(ph.text)) loiHinhDang.push(`${r.method} ${r.path}: ${ph.text}`);
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
      }
    }
    // [khoản 141] Số route bị bỏ qua SUY từ chính bảng, không viết cứng: vòng lặp trên bỏ MỌI
    // route tự thân, và S1.76 thêm cái thứ hai (`POST /auth/agent-session`). Con số `- 1` cũ
    // đúng khi chỉ có đăng xuất, và nó thiu lặng lẽ ngay khi lớp route ấy có thêm một thành viên.
    const soTuThan = ROUTES.filter((r) => r.audience === "BUYER" && r.mutates && r.self === true).length;
    expect(soTuThan, "không còn route tự thân nào — vòng lặp trên đã bỏ qua nhầm thứ gì đó").toBeGreaterThan(0);
    expect(soGoi).toBeGreaterThanOrEqual(ROUTES.length - soTuThan);
    // [sổ nợ 49] Không route ghi nào dừng ở 422 HÌNH DẠNG — mọi thân đều qua bộ đọc thân và chạm nghiệp vụ;
    // và ít nhất mười route ghi đi trọn tới 2xx trên RFQ hy sinh.
    expect(loiHinhDang, "route ghi dừng ở 422 hình dạng — thân chưa hợp lệ").toEqual([]);
    expect(soThanhCong).toBeGreaterThanOrEqual(10);
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
    // [S1.91 / khoản 194] Câu này TỪNG là `toEqual(["UNSEAL_RFQ"])`, và nó đỏ ở lượt evidence của vòng
    // khoản 194 vì `requestUnseal` nay xếp thêm một việc BÁO cho mỗi người duyệt — những việc ấy mang
    // cùng `unsealRequestId` nên lọt vào đúng câu SELECT này.
    //
    // Lời khai GỐC không sai, chỉ được viết hẹp hơn thứ nó muốn nói: *điều phối chỉ ĐẶT MỘT job GIẢI
    // MÃ, `api` không tự giải mã*. Vế ấy giữ nguyên độ sắc ở dòng đầu dưới đây — đúng MỘT `UNSEAL_RFQ`,
    // không phải "ít nhất một". Hai dòng sau nói thêm điều mới mà không nới vế cũ.
    expect(rows.filter((r) => r.kind === "UNSEAL_RFQ"), "điều phối đặt ĐÚNG MỘT việc giải mã").toHaveLength(1);
    expect(rows.filter((r) => r.kind === "UNSEAL_APPROVAL_NOTICE").length, "và ít nhất một tin báo người duyệt").toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.kind)), "không loại việc nào khác bám theo một yêu cầu mở thầu").toEqual(
      new Set(["UNSEAL_RFQ", "UNSEAL_APPROVAL_NOTICE"]),
    );
    // Bảng so sánh VẪN bị từ chối — điều phối không phải giải mã.
    expect((await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie)).status).toBe(422);
  });

  it("bước 11 — worker (KHÔNG qua HTTP, và đó là điểm mấu chốt) mở năm phong bì, lấy PHIÊN BẢN CUỐI", async () => {
    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: trangThai.unsealRequestId, unwrapper: boMoBoc }, unsealPool));
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

  it("bước 12b — CHẤM THẦU qua HTTP: `POST /evaluate` rồi `GET /ranking`, và THÀNH PHẦN đi ra tới người đọc", async () => {
    // [S1.107 / lượt soi ngang 77 — CAO ②] Bước này KHÔNG dựng được trước vòng này: không đường
    // sản xuất nào ghi `eval_components`, nên `POST /evaluate` của S1.106 luôn trả 422 ngoài cụm
    // test. Đây là phép đo đầu tiên đi TRỌN đường chấm thầu bằng HTTP, trên chính sách mà người
    // mua tạo qua HTTP.
    const m = trangThai.mua.cookie;
    const r = await goi("POST", `/rfqs/${trangThai.rfqId}/evaluate`, m, {});
    expect(r.status, r.text).toBe(201);
    const ld = (r.body as { evaluation: { evaluationId: string; currency: string; lines: { rank: number | null }[] } }).evaluation;
    expect(ld.currency).toBe("VND");
    expect(ld.lines).toHaveLength(5);
    expect([...ld.lines].map((x) => x.rank).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5]);

    const bxh = await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, m);
    expect(bxh.status, bxh.text).toBe(200);
    const bang = (bxh.body as {
      ranking: {
        evaluationId: string;
        rows: { supplierName: string; effectiveCost: string | null; rank: number | null; components: { ma: string; tien: string | null }[] }[];
      };
    }).ranking;
    expect(bang.evaluationId).toBe(ld.evaluationId);
    const mongDoi = [...trangThai.loiMoi].sort((a, b) => Number(a.gia) - Number(b.gia));
    expect(bang.rows.map((x) => x.supplierName)).toEqual(mongDoi.map((x) => x.ten));
    expect(bang.rows[0]?.effectiveCost).toBe(GIA_SUA_LAI);
    // VẾ CHỊU LỰC của cả S2.4: mỗi hàng mang THÀNH PHẦN sinh ra con số. Hệ số là `1.0000`, nên
    // `tien` phải bằng chính `effectiveCost` — một bảng chỉ hiện tổng thì J2 là lời hứa rỗng.
    for (const h of bang.rows) {
      expect(h.components, JSON.stringify(h)).toHaveLength(1);
      expect(h.components[0]?.ma).toBe("gia");
      expect(h.components[0]?.tien).toBe(h.effectiveCost);
    }

    // Chấm LẦN HAI dừng ở một từ chối CÓ TÊN: cạnh `UNSEALED->EVALUATING` đã đi qua một lần.
    const lai = await goi("POST", `/rfqs/${trangThai.rfqId}/evaluate`, m, {});
    expect(lai.status, lai.text).toBe(422);
    expect(lai.text).toContain("UNSEALED");
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

  // ==============================================================================================
  // [S1.109 / S2.5] VÒNG BAFO QUA HTTP — và **J4**, bất biến mà cả vòng này sinh ra để đo.
  //
  // J4: *"Báo giá BAFO niêm phong đúng như vòng một: không route nào trả một mức giá BAFO trước
  // khi vòng ấy được mở qua cổng bốn vế."* Khoản **227** ghi vì sao nó KHÔNG đo được ở S1.108:
  // nó là một vòng quét ROUTE, và quét khi chưa route nào tồn tại cho ra một cổng XANH trên tập
  // RỖNG — đúng cái bẫy lượt soi ngang 77 gọi tên.
  //
  // Vế người đọc ở đây RỘNG HƠN lượt quét lần hai một cách có chủ đích: lần hai hỏi *"người
  // KHÔNG có `bid.view` thấy gì"*, còn J4 hỏi *"NGƯỜI MUA CÓ ĐỦ QUYỀN thấy gì"* — vì lời hứa của
  // BAFO là niêm phong với CHÍNH NGƯỜI MUA cho tới khi cổng bốn vế chạy. Một bộ quét chỉ soi
  // người không quyền sẽ xanh kể cả khi giá BAFO nằm sẵn trong bảng so sánh.
  //
  // ------------------------------------------------------------------------------------------
  // VÌ SAO BA CA DƯỚI ĐÂY **KHÔNG** MANG NHÃN bất biến của nhóm J, dù chúng có đủ ba thứ spec §5 đòi
  // (phép đo thật, đối chứng dương, đột biến giết được nó)
  // ------------------------------------------------------------------------------------------
  // Vì cho một mã J vào sổ đăng ký là một đổi thay của CỖ MÁY BẰNG CHỨNG, không phải một hạng
  // mục của S2.5. Đo được, không suy: dải mã bất biến được ghim `[A-H]` ở **tám** chỗ — trong đó
  // `tools/inv-matrix/src/parse.ts` giữ BA (`HANG_BAT_BIEN`, `NHAN_PHU_DO_DUOC`, và bộ đếm độc
  // lập `demHangUngVien`), `tests/architecture/so-no-tu-doi-chieu.test.ts` giữ BA, cộng
  // `nhan-bat-bien-cho-dat.test.ts` và `tools/inv-matrix/src/danh-gia.test.ts`. Nới dải ấy đổi
  // cách ĐẾM của mọi bất biến về sau, và nó kéo theo hai con số tổng ở `docs/TEST-PLAN.md` cùng
  // mọi lời khai *56/56* đang sống.
  //
  // Gộp một đổi thay như thế vào một vòng đã chạm lõi niêm phong là gộp đúng hai thứ phải tách.
  // Nên vòng này giao PHẦN CHẤT của J4 — ba ca dưới — và để phần ĐĂNG KÝ thành một khoản riêng,
  // cùng lúc với J1/J2 (`packages/danh-gia/src/luot-danh-gia.int.test.ts` đã ghi vì sao hai mã ấy
  // cũng chưa vào sổ). Gắn nhãn hôm nay là ghi một dòng `passed` vào một hàng chưa tồn tại.
  //
  // **[S1.115 / khoản 229] KHOẢN RIÊNG ẤY ĐÃ CHẠY, và con số *tám* ở trên SAI.** Đo lại trên
  // `master` ngày 2026-09-23: **MƯỜI** chỗ ghim, không tám — `parse.ts` giữ **BỐN** chứ không ba
  // (vế *nhãn chưa khai* không được kể), và có một chỗ thứ mười ở `packages/outbox/src/`, một GÓI
  // mà cả hai đoạn văn trên đều không nhắc tên. Cả mười nay là `[A-HJ]`, `J4` đã có ô, và ba ca
  // dưới mang nhãn `[INV-J4]`.
  // ==============================================================================================

  it("bước 12c — MỞ VÒNG BAFO qua HTTP: top-N suy từ bảng xếp hạng, và nhà cung cấp thấy hạn CỦA VÒNG", async () => {
    const m = trangThai.mua.cookie;

    // Cổng quyền TRƯỚC: `rfq.bafo.open` chỉ `PROCUREMENT_MANAGER` (ADR-055). GIÁM ĐỐC chấm thầu
    // được (`evaluation.perform`) mà KHÔNG mở vòng BAFO được — đó là toàn bộ lý do mã quyền này
    // tồn tại riêng thay vì dùng lại `evaluation.perform` (khoản 220).
    const han = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    expect((await goi("POST", `/rfqs/${trangThai.rfqId}/bafo`, trangThai.gd1.cookie, { deadlineAt: han.toISOString() })).status).toBe(403);

    const mo = await goi("POST", `/rfqs/${trangThai.rfqId}/bafo`, m, { deadlineAt: han.toISOString() });
    expect(mo.status, mo.text).toBe(201);
    const vong = (mo.body as { bafoRound: { bafoRoundId: string; roundNo: number; topN: number } }).bafoRound;
    expect(vong.roundNo).toBe(1);
    expect(vong.topN).toBe(2);
    trangThai.bafoRoundId = vong.bafoRoundId;

    // Ai là top-2 thì SUY từ bảng xếp hạng, không gõ tay — đó chính là lời hứa của §8.1⑴.
    const bxh = await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, m);
    const hang = (bxh.body as { ranking: { rows: { supplierName: string; rank: number | null }[] } }).ranking.rows;
    trangThai.topN = hang.filter((h) => h.rank !== null && h.rank <= 2).sort((a, b) => Number(a.rank) - Number(b.rank)).map((h) => h.supplierName);
    expect(trangThai.topN).toHaveLength(2);

    // NHÀ CUNG CẤP THẤY HẠN CỦA VÒNG — khoản 227⑶. Và `rfq.deadlineAt` lúc này đã ở QUÁ KHỨ, nên
    // không có trường này thì màn nộp thầu chỉ đọc được một hạn đã qua trong khi vẫn nộp được.
    const lm = trangThai.loiMoi.find((x) => x.ten === trangThai.topN[0])!;
    const gr = await goi("GET", "/guest/rfq", lm.cookie);
    expect(gr.status, gr.text).toBe(200);
    const br = (gr.body as { rfq: { deadlineAt: string }; bafoRound: Record<string, unknown> | null }).bafoRound;
    expect(br).not.toBeNull();
    // ĐÚNG HAI TRƯỜNG: `topN` và `openedBy` là tin cạnh tranh thật và chúng KHÔNG ra khỏi đây.
    expect(Object.keys(br!).sort()).toEqual(["deadlineAt", "roundNo"]);
    expect(br!.roundNo).toBe(1);
    expect(new Date(String(br!.deadlineAt)).getTime()).toBeGreaterThan(Date.now());
    // [S1.109 — PHÉP ĐO BÁC MỘT CÂU CỦA CHÍNH LƯỢT SOI NÀY] Lượt soi hình dạng viết rằng hạn
    // vòng một *"đã ở QUÁ KHỨ"* suốt `BAFO_OPEN`. Ở kịch bản này nó **CHƯA** — gói thầu được ĐÓNG
    // SỚM (`early_close_reason`), nên `rfq.deadlineAt` vẫn nằm ở tương lai. Đo, không suy.
    //
    // Và ca ấy còn TỆ HƠN ca lượt soi tưởng tượng: một nhà cung cấp đọc `rfq.deadlineAt` sẽ tin
    // mình còn tới NGÀY XA HƠN hạn thật của vòng BAFO — tức màn hình không chỉ nói sai, nó nói
    // sai theo chiều ru ngủ. Vế phải đo là *hai hạn KHÁC NHAU, và hạn đúng là hạn của VÒNG*.
    const hanVongMot = new Date((gr.body as { rfq: { deadlineAt: string } }).rfq.deadlineAt).getTime();
    const hanVongBafo = new Date(String(br!.deadlineAt)).getTime();
    expect(hanVongBafo, "hai hạn phải KHÁC nhau — nếu bằng thì trường mới không mua gì").not.toBe(hanVongMot);
    expect(hanVongMot, "ở kịch bản này gói thầu đóng SỚM, nên hạn vòng một còn XA HƠN hạn BAFO").toBeGreaterThan(hanVongBafo);
  });

  it("bước 12d — TOP-2 nộp lại NIÊM PHONG; người NGOÀI top-2 bị chặn, và bằng 422 chứ không 500", async () => {
    for (const [i, ten] of trangThai.topN.entries()) {
      const lm = trangThai.loiMoi.find((x) => x.ten === ten)!;
      const r = await goi("GET", "/guest/rfq", lm.cookie);
      const khoa = (r.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256")!;
      const phongBi = await sealBid({
        rfqId: trangThai.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: new Uint8Array(Buffer.from(khoa.publicKey, "base64")),
        plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: GIA_BAFO[i], currency: "VND", nhaCungCap: lm.ten })),
      });
      const bn = await goi("POST", "/guest/bids", lm.cookie, { envelope: Buffer.from(phongBi).toString("base64") });
      expect(bn.status, `${ten}: ${bn.text}`).toBe(201);
      trangThai.giaBafo.set(ten, GIA_BAFO[i]!);
    }

    // NGƯỜI NGOÀI TOP-2 — `bid_kiem_vong_bafo` (059 mục 6) chặn, và phép suy từ `rank` thành một
    // lớp CHẶN chứ không một truy vấn hiển thị.
    //
    // 422, KHÔNG 500, và đó là một bản vá của chính vòng này: câu `INSERT` của `bidding.ts` không
    // bọc try/catch, nên lỗi `pg` đi lên với `name === "error"` và rơi ra ngoài danh sách ĐÓNG
    // `LOI_NGHIEP_VU_422` của `dispatch.ts`. Đo được rằng trước vòng này KHÔNG ca nào ghim hành
    // vi ấy — kể cả cho lần từ chối QUÁ HẠN của C1, vốn đã có từ S1.4.
    const ngoai = trangThai.loiMoi.find((x) => !trangThai.topN.includes(x.ten))!;
    const r2 = await goi("GET", "/guest/rfq", ngoai.cookie);
    const khoa2 = (r2.body as { publicKeys: { algorithm: string; publicKey: string }[] }).publicKeys.find((k) => k.algorithm === "ECDH_P256")!;
    const pb2 = await sealBid({
      rfqId: trangThai.rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: new Uint8Array(Buffer.from(khoa2.publicKey, "base64")),
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: "888000000.00", currency: "VND", nhaCungCap: ngoai.ten })),
    });
    const bn2 = await goi("POST", "/guest/bids", ngoai.cookie, { envelope: Buffer.from(pb2).toString("base64") });
    expect(bn2.status, bn2.text).toBe(422);
    // Và thông điệp KHÔNG chép lại câu của CSDL: hai trong ba câu ấy nội suy UUID.
    expect(bn2.text).not.toContain(trangThai.bafoRoundId);
  });

  it("[INV-A2] [INV-J4] BỘ QUÉT RÒ RỈ LẦN BA — giá BAFO đã NẰM TRONG CSDL mà chưa qua cổng bốn vế: không route nào trả nó, KỂ CẢ cho người mua đủ quyền", async () => {
    // TIỀN ĐỀ, đo trước khi quét: hai phong bì BAFO thật sự đã nộp. Không có khẳng định này, lượt
    // quét xanh cả khi bước trên hỏng lặng lẽ — và một bộ quét trên tập rỗng thì không đo gì.
    const { rows: dem } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM vendor_bid_versions WHERE bafo_round_id = $1", [trangThai.bafoRoundId],
    );
    expect(dem[0]?.n, "hai phong bì BAFO phải đã nằm trong CSDL trước khi quét").toBe("2");

    const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const thayDuong = (path: string) =>
      path.replace(":rfqId", trangThai.rfqId).replace(":unsealRequestId", trangThai.unsealRequestId).replace(/:[A-Za-z]+/gu, UUID0);
    const roRi: string[] = [];
    let soGoi = 0;
    let thayGiaVongMot = 0;
    for (const r of ROUTES) {
      if (r.method !== "GET") continue;
      const cookies =
        r.audience === "GUEST" ? trangThai.loiMoi.map((lm) => lm.cookie)
        // NGƯỜI MUA CÓ ĐỦ QUYỀN — vế làm J4 khác lượt quét lần hai.
        : r.audience === "BUYER" ? [trangThai.mua.cookie]
        : [];
      for (const cookie of cookies) {
        const path = r.audience === "GUEST" && r.path.includes(":bidVersionId")
          ? r.path.replace(":bidVersionId", trangThai.bienNhan.find((b) => trangThai.loiMoi.some((lm) => lm.cookie === cookie && lm.ten === b.ten))?.bidVersionId ?? UUID0)
          : thayDuong(r.path);
        const ph = await goi(r.method, path, cookie);
        soGoi += 1;
        const headerText = [...ph.headers.entries()].map(([a, b]) => `${a}: ${b}`).join("\n");
        for (const g of quetRoRi(ph.text + "\n" + headerText)) {
          if ((GIA_BAFO as readonly string[]).includes(g)) roRi.push(`${r.method} ${r.path} (${ph.status}): ${g}`);
          else thayGiaVongMot += 1;
        }
      }
    }
    expect(soGoi).toBeGreaterThan(5 * 4 + 8);
    expect(roRi, "[J4] một mức giá BAFO lọt ra TRƯỚC khi vòng ấy đi qua cổng bốn vế").toEqual([]);
    // ĐỐI CHỨNG: bộ quét KHÔNG mù ở chính lượt chạy này — nó vẫn thấy giá vòng một (đã mở, và
    // người mua có `bid.view`). Thiếu vế này, một `quetRoRi` hỏng sẽ cho `roRi` rỗng và ca xanh.
    expect(thayGiaVongMot, "bộ quét phải VẪN thấy giá VÒNG MỘT ở chính lượt này").toBeGreaterThan(0);
  });

  it("[INV-J4] ĐỘT BIẾN — gỡ lớp giữ J4 lúc chạy thì bộ quét THẤY giá BAFO ngay ở route ấy", async () => {
    // J4 đúng KHÔNG phải vì bộ quét mù, và không phải vì route khéo: nó đúng vì **chưa có một
    // hàng bản rõ nào** cho phong bì BAFO, và đường DUY NHẤT sinh ra hàng ấy đi qua cổng bốn vế
    // (`rfq_kiem_yeu_cau_mo_thau` của `019 §4`, và từ `059` nó phân biệt được VÒNG).
    //
    // Ca này gỡ đúng lớp ấy LÚC CHẠY rồi hỏi lại cùng một câu hỏi. Nếu bộ quét vẫn im, nó đang
    // im vì một lý do khác lý do ta nghĩ — và cả lượt quét ở trên là một cổng xanh rỗng ruột.
    const { rows: pb } = await db.pool.query<{ id: string }>(
      "SELECT id FROM vendor_bid_versions WHERE bafo_round_id = $1 ORDER BY id LIMIT 1",
      [trangThai.bafoRoundId],
    );
    const versionId = pb[0]?.id ?? "";
    expect(versionId, "tiền đề: phải có một phong bì BAFO để đột biến").not.toBe("");

    // Yêu cầu mở thầu VÒNG MỘT — đã `EXECUTED`, và nó KHÔNG thuộc vòng BAFO. Dùng lại nó là
    // đúng kịch bản mà cổng tồn tại để chặn.
    await db.pool.query("ALTER TABLE rfq_unsealed_bids DISABLE TRIGGER USER");
    try {
      await db.pool.query(
        "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
        [orgA, trangThai.unsealRequestId, versionId, JSON.stringify({ totalAmount: GIA_BAFO[0], currency: "VND" })],
      );
      // ------------------------------------------------------------------------------------
      // VÀ ĐÂY LÀ THỨ PHÉP ĐO TRẢ VỀ, KHÁC THỨ CA NÀY ĐƯỢC VIẾT RA ĐỂ CHỜ.
      //
      // Bản đầu của ca này khẳng định bộ quét sẽ THẤY giá — tức J4 chỉ đứng nhờ MỘT lớp (không có
      // hàng bản rõ nào). Phép đo BÁC câu ấy: hàng bản rõ đã nằm đó mà không route nào trả nó, vì
      // một lớp THỨ HAI cũng đang từ chối — `COMPARISON_ALLOWED_STATUSES` không chứa `BAFO_OPEN`
      // (`packages/unseal/src/comparison.ts`), nên `buildComparisonTable` trả 422 suốt cửa sổ
      // niêm phong của vòng hai, bất kể trong bảng có gì.
      //
      // Kết quả MẠNH HƠN thứ được đi tìm, nên nó được ghi đúng như nó là: gỡ MỘT lớp không đủ để
      // giết J4. Cả hai vế dưới đây đều được khẳng định — nếu ngày nào lớp thứ hai bị nới ra
      // `BAFO_OPEN`, vế thứ nhất ĐỎ ngay và ca này kể đúng câu chuyện đã đổi.
      // ------------------------------------------------------------------------------------
      const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
      const thay = quetRoRi(r.text).filter((g) => (GIA_BAFO as readonly string[]).includes(g));
      expect(thay, "gỡ lớp *không có hàng bản rõ* KHÔNG đủ để giá BAFO đi ra").toEqual([]);
      expect(r.status, "vì lớp thứ hai — cổng trạng thái của bảng so sánh — vẫn đang từ chối").toBe(422);
    } finally {
      await db.pool.query("DELETE FROM rfq_unsealed_bids WHERE bid_version_id = $1", [versionId]);
      await db.pool.query("ALTER TABLE rfq_unsealed_bids ENABLE TRIGGER USER");
    }

    // KHÔI PHỤC ĐƯỢC TỰ KIỂM, không tin vào `finally`: bảng phải trở lại đúng năm hàng bản rõ
    // của vòng một, và trigger phải bật lại. S1.86 để sót một đột biến vì không có vế này.
    const { rows: con } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_unsealed_bids WHERE org_id = $1", [orgA],
    );
    expect(con[0]?.n, "đột biến phải được gỡ sạch").toBe("5");
    const { rows: tg } = await db.pool.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.rfq_unsealed_bids'::regclass AND NOT tgisinternal",
    );
    expect(tg.length).toBeGreaterThan(0);
    expect(tg.every((t) => t.tgenabled !== "D"), "mọi trigger phải được bật lại").toBe(true);
    // ------------------------------------------------------------------------------------------
    // MỘT KHẲNG ĐỊNH CỦA CHÍNH CA NÀY ĐÃ BỊ PHÉP ĐO BÁC, VÀ THỨ THAY NÓ HẸP HƠN.
    //
    // Bản đầu đóng ca bằng *"cổng THẬT vẫn chặn: cùng câu INSERT, trigger đã bật, phải ĐỎ"*. Nó
    // XANH — tức câu INSERT ĐI QUA. Lý do đo được: `unseal_kiem_yeu_cau_khi_ghi_ban_ro` (`019`)
    // chỉ đòi yêu cầu mở thầu ở `APPROVED`/`EXECUTED`, và yêu cầu VÒNG MỘT đúng ở `EXECUTED`;
    // không ràng buộc nào buộc `bid_version_id` thuộc CÙNG gói thầu với `unseal_request_id` —
    // hai khoá ngoại hợp thành trỏ về hai bảng khác nhau, không về nhau.
    //
    // Nó KHÔNG phải một lỗ đang mở: `INSERT` trên bảng bản rõ chỉ cấp cho `app_unseal`, và tiến
    // trình duy nhất mang vai ấy suy CẢ HAI giá trị từ cùng một yêu cầu. Nhưng nó là một lớp
    // MỎNG HƠN thứ ca này tưởng, nên nó được ghi thành một khoản nợ thay vì nuốt vào im lặng.
    //
    // Thứ thay thế là vế THẬT SỰ chịu lực cho J4 ở phía route: vai của `apps/api` không ghi được
    // một hàng bản rõ nào, bằng lối nào.
    // ------------------------------------------------------------------------------------------
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
          [orgA, trangThai.unsealRequestId, versionId, JSON.stringify({ totalAmount: GIA_BAFO[0], currency: "VND" })],
        ),
      ),
      "vai app_api KHÔNG được ghi bản rõ — đó là lớp giữ J4 ở phía route",
    ).rejects.toThrow(/permission denied/u);
  });

  it("bước 12e — đóng vòng, cổng bốn vế LẦN HAI, và worker mở ĐÚNG hai phong bì của vòng hai", async () => {
    const m = trangThai.mua.cookie;
    const dong = await goi("POST", `/rfqs/${trangThai.rfqId}/bafo/close`, m);
    expect(dong.status, dong.text).toBe(200);

    // Cổng bốn vế chạy LẠI, nguyên khuôn — mỗi vòng là một hàng `unseal_requests` mới, nên *hai
    // người khác nhau* được đo LẠI. Đây là phần lãi của phép ảnh mà S1.108 chọn: không khuôn thứ
    // hai nào được dựng cho vòng BAFO.
    const yc = await goi("POST", `/rfqs/${trangThai.rfqId}/unseal`, m, { reason: "het han vong BAFO, mo phong bi vong hai" });
    expect(yc.status, yc.text).toBe(201);
    const ycId = (yc.body as { unsealRequest: { id: string } }).unsealRequest.id;
    expect(ycId).not.toBe(trangThai.unsealRequestId);
    expect((await goi("POST", `/unseal/${ycId}/approve`, trangThai.gd1.cookie)).status).toBe(200);
    expect((await goi("POST", `/unseal/${ycId}/approve`, trangThai.gd2.cookie)).status).toBe(200);
    const dp = await goi("POST", `/unseal/${ycId}/dispatch`, m);
    expect(dp.status, dp.text).toBe(200);
    expect((dp.body as { gate: { clauses: string[] } }).gate.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);

    const kq = await withTenant(unsealPool, orgA, (c) => executeUnsealRequest(c, orgA, { unsealRequestId: ycId, unwrapper: boMoBoc }, unsealPool));
    // ĐÚNG HAI — không năm. Nhà cung cấp ngoài top-2 không nộp lại, nên phiên bản mới nhất của họ
    // vẫn là phong bì VÒNG MỘT **đã mở rồi**; đọc lại nó sẽ đụng `UNIQUE (org_id, bid_version_id)`.
    expect(kq.opened, "worker phải lọc theo bafo_round_id").toBe(2);
    expect(kq.failedBidVersionIds).toEqual([]);
    const { rows: tt } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [trangThai.rfqId]);
    expect(tt[0]?.status).toBe("BAFO_UNSEALED");
    // Hàng sổ mang DẤU VÒNG — không có nó, sau BAFO sổ có hai hàng `RFQ_UNSEALED` giống hệt nhau.
    const { rows: so } = await db.pool.query<{ payload: { bafoRoundId: string | null } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_UNSEALED' ORDER BY occurred_at", [orgA],
    );
    expect(so).toHaveLength(2);
    expect(so[0]?.payload.bafoRoundId).toBeNull();
    expect(so[1]?.payload.bafoRoundId).toBe(trangThai.bafoRoundId);
  });

  it("[INV-J4] ĐỐI CHỨNG DƯƠNG — SAU cổng bốn vế, cùng bộ quét ấy THẤY giá BAFO", async () => {
    // §6 của spec gọi đúng vế này: *"Vòng quét route chứng minh KHÔNG thấy giá BAFO; nó chỉ có
    // nghĩa khi có một lượt chứng minh bộ quét THẤY giá ấy sau khi vòng BAFO mở."*
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    expect(r.status, r.text).toBe(200);
    const thay = quetRoRi(r.text).filter((g) => (GIA_BAFO as readonly string[]).includes(g));
    expect(thay.sort(), "cùng bộ quét, cùng route, sau cổng — giá BAFO phải hiện ra").toEqual([...GIA_BAFO].sort());
  });

  it("bước 12f — BẢNG SO SÁNH sau BAFO: BẢY dòng lịch sử, nhưng phần TỔNG HỢP khử trùng còn NĂM", async () => {
    const r = await goi("GET", `/rfqs/${trangThai.rfqId}/comparison`, trangThai.mua.cookie);
    const bang = (r.body as {
      comparison: {
        rfqStatus: string;
        rows: { supplierLegalName: string; totalAmount: string; bafoRoundNo: number | null; isLatestForBid: boolean }[];
        aggregates: { parsed: number; unparsed: number; min: string; max: string };
      };
    }).comparison;
    expect(bang.rfqStatus).toBe("BAFO_UNSEALED");

    // NĂM dòng vòng một + HAI dòng BAFO. Chủ dự án chọn giữ cả hai (2026-09-22): bảng này là một
    // bảng LỊCH SỬ, và người mua cần thấy AI HẠ BAO NHIÊU.
    expect(bang.rows).toHaveLength(7);
    expect(bang.rows.filter((x) => x.bafoRoundNo === 1)).toHaveLength(2);
    expect(bang.rows.filter((x) => x.bafoRoundNo === null)).toHaveLength(5);
    // Hai nhà cung cấp top-2 có HAI dòng, và đúng một dòng của mỗi người là dòng đang có hiệu lực.
    for (const ten of trangThai.topN) {
      const cua = bang.rows.filter((x) => x.supplierLegalName === ten);
      expect(cua, ten).toHaveLength(2);
      expect(cua.filter((x) => x.isLatestForBid), ten).toHaveLength(1);
      expect(cua.find((x) => x.isLatestForBid)?.totalAmount).toBe(trangThai.giaBafo.get(ten));
    }

    // VÀ ĐÂY LÀ VẾ KHÔNG PHẢI MỘT LỰA CHỌN: `min`/`max`/`parsed` là lời khai về TẬP NGƯỜI DỰ
    // THẦU. Tính chúng trên bảy dòng thì `parsed` nói có bảy người dự thầu — sai dưới mọi cách
    // đọc, vì có năm.
    expect(bang.aggregates.parsed, "khử trùng: NĂM luồng báo giá, không bảy dòng").toBe(5);
    expect(bang.aggregates.unparsed).toBe(0);
    expect(bang.aggregates.min, "giá thấp nhất ĐANG CÓ HIỆU LỰC là giá BAFO thấp hơn").toBe(
      [...GIA_BAFO].sort((a, b) => Number(a) - Number(b))[0],
    );
  });

  it("bước 12g — CHẤM LẠI sau BAFO: mỗi nhà cung cấp đúng MỘT hàng, và thứ hạng tính trên giá MỚI", async () => {
    const m = trangThai.mua.cookie;
    const r = await goi("POST", `/rfqs/${trangThai.rfqId}/evaluate`, m, {});
    expect(r.status, r.text).toBe(201);
    const ld = (r.body as { evaluation: { evaluationId: string; lines: { bidVersionId: string; effectiveCost: string | null; rank: number | null }[] } }).evaluation;

    // NĂM hàng — không bảy. Đây là vế mà mục 7d của §S1.108 vá ở `docBaoGia`, và ca này là phép
    // đo của nó trên đường HTTP thật.
    expect(ld.lines, "một hàng mỗi LUỒNG báo giá, không một hàng mỗi phong bì đã mở").toHaveLength(5);
    expect([...ld.lines].map((x) => x.rank).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5]);

    const bxh = await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, m);
    const bang = (bxh.body as { ranking: { rows: { supplierName: string; effectiveCost: string | null; rank: number | null }[] } }).ranking;
    expect(bang.rows).toHaveLength(5);
    // Hạng NHẤT là giá BAFO thấp nhất — bảng xếp hạng tính LẠI thật, không giữ bảng vòng một.
    const nhat = bang.rows.find((x) => x.rank === 1)!;
    expect(nhat.effectiveCost).toBe([...GIA_BAFO].sort((a, b) => Number(a) - Number(b))[0]);
    expect(trangThai.topN).toContain(nhat.supplierName);
    // Và người NGOÀI top-2 vẫn đứng trong bảng với giá vòng một — BAFO cải thiện giá của top-N,
    // nó không loại ai khỏi cuộc thi.
    const ngoai = trangThai.loiMoi.filter((x) => !trangThai.topN.includes(x.ten)).map((x) => x.ten);
    for (const ten of ngoai) {
      const h = bang.rows.find((x) => x.supplierName === ten);
      expect(h, ten).toBeDefined();
      expect(h?.effectiveCost, ten).toBe(trangThai.loiMoi.find((x) => x.ten === ten)?.gia);
    }
    expect(await goi("GET", `/rfqs/${trangThai.rfqId}/bafo`, m).then((x) => (x.body as { bafoRound: { closedAt: string | null } }).bafoRound.closedAt)).not.toBeNull();
  });

  // ============================================================================================
  // [S1.110 / S2.6] TRAO THẦU QUA HTTP — hành động CUỐI, và chỗ duy nhất đòi đúng HAI con người
  //
  // Bốn route của S2.6 đã có một vòng quét quyền ở `buyer.int.test.ts` (403 cho phiên không quyền,
  // đúng một mã đi qua), nhưng vòng quét ấy chứng minh cổng ĐÓNG chứ không chứng minh đường ĐI
  // ĐƯỢC. Hai bước dưới đây là phép đo ấy, trên cùng tiến trình HTTP thật với cùng năm con người
  // mà kịch bản đã dựng — và đúng ba vai khác nhau, nên J3 có việc thật để làm.
  // ============================================================================================

  it("[INV-J3] bước 12h — ĐỀ XUẤT trao thầu qua HTTP: người TẠO gói thầu bị J3 chặn, người KHÁC đi qua", async () => {
    // `trangThai.mua` vừa là `created_by` của RFQ vừa là người ĐIỀU PHỐI cả hai lượt mở thầu, nên
    // J3 chặn họ trên HAI vế cùng lúc; trigger kiểm `created_by` trước nên thông điệp nói vế ấy.
    // Đây là lần DUY NHẤT trong kho một cổng quyền nói CÓ mà một trigger nói KHÔNG — `mua` là
    // `PROCUREMENT_MANAGER`, tức họ GIỮ `award.recommend`.
    const nhat = (await goi("GET", `/rfqs/${trangThai.rfqId}/ranking`, trangThai.mua.cookie).then(
      (x) => (x.body as { ranking: { rows: { bidVersionId: string; rank: number | null }[] } }).ranking,
    )).rows.find((h) => h.rank === 1)!;
    expect(nhat.bidVersionId, "tiền đề: phải có một hàng hạng NHẤT để trao thầu").toBeTruthy();

    const tuChoi = await goi("POST", `/rfqs/${trangThai.rfqId}/award`, trangThai.mua.cookie, {
      bidVersionId: nhat.bidVersionId,
      reason: "nguoi tao goi thau tu de xuat",
    });
    // 422 MANG CÂU CỦA TRIGGER, không 500 — và lời khai đầu của vòng này nói 500, rồi phép đo bác
    // nó. `anhXaLoiPostgres` (`dispatch.ts`) ánh xạ `23514` tới 422, và nó LỘ thông điệp khi lỗi
    // đến từ một `RAISE` của trigger (`routine = exec_stmt_raise`) — đúng ca của ba trigger `061`,
    // vì thông điệp ấy do migration VIẾT chứ không nội suy dữ liệu người dùng. Nên J3 nói được cho
    // người bấm biết vì sao, mà không cần một dòng nào ở `LOI_NGHIEP_VU_422`.
    expect(tuChoi.status, tuChoi.text).toBe(422);
    expect(tuChoi.text, "câu từ chối phải GỌI TÊN bất biến, không chỉ nói không").toMatch(/\(J3\)/u);
    expect(await trangThaiRfq(), "lần từ chối KHÔNG được để lại một trạng thái nửa vời").toBe("EVALUATING");

    // ĐỐI CHỨNG DƯƠNG — cùng gói, cùng báo giá, chỉ đổi NGƯỜI: `pm2` cũng là
    // `PROCUREMENT_MANAGER`, cũng giữ `award.recommend`, nhưng họ không tạo và không điều phối.
    const ok = await goi("POST", `/rfqs/${trangThai.rfqId}/award`, trangThai.pm2.cookie, {
      bidVersionId: nhat.bidVersionId,
      reason: "gia BAFO thap nhat, ky thuat dat",
    });
    expect(ok.status, ok.text).toBe(201);
    const aw = (ok.body as { award: { awardId: string; status: string; bidVersionId: string; evaluationId: string } }).award;
    expect(aw.status).toBe("PROPOSED");
    expect(aw.bidVersionId).toBe(nhat.bidVersionId);
    trangThai.awardId = aw.awardId;

    // `AWARDED` nghĩa là *ĐANG CÓ một award còn sống* (ADR-057), nên nó đặt ngay ở hàng PROPOSED.
    expect(await trangThaiRfq()).toBe("AWARDED");

    // Và lượt chấm mà award dựa trên là lượt SAU BAFO — vế mà `deXuatTraoThau` canh MỘT MÌNH
    // (khoản 231). Bước 12g vừa tạo lượt ấy, nên đây là thế giới có HAI lượt chấm.
    const { rows: luot } = await db.pool.query<{ id: string }>(
      "SELECT id FROM rfq_evaluations WHERE org_id = $1 AND rfq_id = $2 ORDER BY created_at DESC, id DESC",
      [orgA, trangThai.rfqId],
    );
    expect(luot.length, "tiền đề: phải có HAI lượt chấm sau một chu kỳ BAFO").toBe(2);
    expect(aw.evaluationId, "award phải dựa trên bảng xếp hạng SAU BAFO").toBe(luot[0]?.id);
  });

  it("bước 12i — PHÊ DUYỆT qua HTTP: người đề xuất bị chặn ở cổng QUYỀN, giám đốc ký, RFQ đứng yên", async () => {
    const duong = `/rfqs/${trangThai.rfqId}/award/${trangThai.awardId}/approve`;

    // `pm2` vừa đề xuất, và `PROCUREMENT_MANAGER` KHÔNG giữ `po.approve` — nên họ dừng ở cổng
    // QUYỀN (403), trước cả khi trigger *không tự duyệt* được hỏi. Hai lớp, và lớp ngoài chặn trước.
    const chan = await goi("POST", duong, trangThai.pm2.cookie);
    expect(chan.status, chan.text).toBe(403);

    const ok = await goi("POST", duong, trangThai.gd1.cookie);
    expect(ok.status, ok.text).toBe(201);
    expect((ok.body as { award: { status: string } }).award.status).toBe("APPROVED");

    // Duyệt KHÔNG đổi trạng thái RFQ — nó đã ở `AWARDED` từ lúc có đề xuất.
    expect(await trangThaiRfq()).toBe("AWARDED");

    const doc = await goi("GET", `/rfqs/${trangThai.rfqId}/award`, trangThai.mua.cookie);
    expect(doc.status, doc.text).toBe(200);
    const day = (doc.body as { award: { status: string; approvals: { approverUserId: string }[] } }).award;
    expect(day.status).toBe("APPROVED");
    // MỘT chữ ký, đúng §7 — và nó là của GIÁM ĐỐC, không của người đề xuất.
    expect(day.approvals.map((c) => c.approverUserId)).toEqual([trangThai.gd1.id]);

    // Lần duyệt THỨ HAI trên cùng đề xuất bị từ chối: hàng mới nhất nay là `APPROVED`.
    const lai = await goi("POST", duong, trangThai.gd2.cookie);
    expect(lai.status, lai.text).toBe(422);
  });

  it("bước 13 — [INV-B5] job toàn vẹn chạy sạch trên TÁM phiên bản (đường vận hành, không HTTP)", async () => {
    const bc = await withTenant(unsealPool, orgA, (c) => auditStoredCiphertexts(c, orgA, trangThai.rfqId));
    // ~~SÁU~~ **[S1.109] TÁM**: năm phong bì vòng một + một bản sửa giá + HAI phong bì BAFO. Con
    // số này là một lời khai về *mọi phiên bản của gói thầu*, nên nó phải lớn lên cùng vòng BAFO;
    // giữ nguyên 6 sẽ là một cổng toàn vẹn KHÔNG soi hai phong bì mới nhất.
    expect(bc.checked).toBe(8);
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
    // [S1.107 / khoản 224 — QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN] Lời khai cũ ở đây là *"giá dạng rõ chỉ tồn
    // tại ở ĐÚNG MỘT bảng"*, và nó ĐÚNG — trong một kịch bản KHÔNG CHẤM THẦU LẦN NÀO. `057` dựng
    // chỗ ở thứ hai từ S1.105 (`effective_cost` và `components.tien` của `rfq_evaluation_lines`),
    // và lượt soi ngang 77 đo ra rằng cổng này xanh vì phạm vi của nó, không vì lời khai đúng.
    //
    // Bước 12b nay chấm thầu THẬT trước khi tới đây, nên phép quét dưới chạy trong một thế giới
    // CÓ lượt chấm — và lời khai đổi theo ADR-054: giá dạng rõ chỉ ở những bảng ĐƯỢC KHAI, mỗi
    // bảng kèm vai ghi và cổng đọc của nó:
    //   • `rfq_unsealed_bids`     — ghi bởi `app_unseal` (019), đọc qua `bid.view`;
    //   • `rfq_evaluation_lines`  — ghi bởi `app_api` qua `taoLuotDanhGia` với GRANT theo CỘT
    //                               (057), đọc qua `bid.view` ở `docBangXepHang`.
    // Tập viết VÉT CẠN chứ không "chứa": một bảng THỨ BA mai sau phải làm dòng này ĐỎ.
    expect(dinh).toEqual(["rfq_evaluation_lines", "rfq_unsealed_bids"]);
  }, 120000);

  it("bước 15 — sổ kiểm toán kể lại toàn bộ kịch bản, kể cả năm lần đăng nhập qua TOTP, theo đúng thứ tự", async () => {
    const { rows } = await db.pool.query<{ action: string }>("SELECT action FROM audit_events WHERE org_id = $1 ORDER BY seq", [orgA]);
    const cac = rows.map((r) => r.action);
    for (const moc of ["RFQ_CREATED", "RFQ_SUBMITTED_FOR_APPROVAL", "RFQ_APPROVED", "RFQ_KEY_MATERIAL_ISSUED", "RFQ_OPENED", "GUEST_SESSION_STARTED", "RFQ_CLOSED", "UNSEAL_REQUESTED", "UNSEAL_APPROVED", "UNSEAL_DISPATCHED", "RFQ_KEY_MATERIAL_UNWRAPPED", "RFQ_UNSEALED"]) {
      expect(cac, `sổ kiểm toán thiếu mốc ${moc}`).toContain(moc);
    }
    // [S1.109] Hai khẳng định này trộn `indexOf` với `lastIndexOf`, và câu ấy chỉ đúng khi kho
    // có ĐÚNG MỘT lượt mở thầu. Vòng BAFO cho lượt thứ hai, nên `lastIndexOf("UNSEAL_APPROVED")`
    // trỏ vào phê duyệt của vòng HAI còn `indexOf("RFQ_KEY_MATERIAL_UNWRAPPED")` trỏ vào lần mở
    // bọc của vòng MỘT — so hai vòng khác nhau, và nó ĐỎ. Nay khẳng định theo TỪNG vòng: lần đầu
    // so với lần đầu, lần cuối so với lần cuối — mạnh hơn bản cũ, vì nó đòi trật tự ấy ở CẢ HAI.
    for (const lay of [
      (a: string) => cac.indexOf(a),
      (a: string) => cac.lastIndexOf(a),
    ]) {
      expect(lay("RFQ_KEY_MATERIAL_UNWRAPPED")).toBeGreaterThan(lay("UNSEAL_APPROVED"));
      expect(lay("RFQ_UNSEALED")).toBeGreaterThan(lay("RFQ_KEY_MATERIAL_UNWRAPPED"));
    }
    // Và hai vòng là HAI, không một — nếu khối BAFO ở trên lặng lẽ không chạy, hai dòng này đỏ.
    expect(cac.filter((a) => a === "RFQ_UNSEALED")).toHaveLength(2);
    expect(cac.filter((a) => a === "RFQ_BAFO_ROUND_OPENED")).toHaveLength(1);
    // [S1.110 / S2.6] Hành động CUỐI để lại ĐÚNG hai dòng, và thứ tự của chúng là một phần
    // của mệnh đề: một đề xuất rồi một lần duyệt, không bao giờ ngược lại.
    expect(cac.filter((a) => a === "RFQ_AWARD_PROPOSED")).toHaveLength(1);
    expect(cac.filter((a) => a === "RFQ_AWARD_APPROVED")).toHaveLength(1);
    expect(cac.indexOf("RFQ_AWARD_APPROVED")).toBeGreaterThan(cac.indexOf("RFQ_AWARD_PROPOSED"));
    // ...và lần đề xuất đứng SAU lượt chấm cuối: award dựa trên bảng xếp hạng SAU BAFO.
    expect(cac.indexOf("RFQ_AWARD_PROPOSED")).toBeGreaterThan(cac.lastIndexOf("RFQ_EVALUATED"));
    // Năm phiên khách của kịch bản + MỘT của RFQ hy sinh mà bộ quét (sổ nợ 49) mở để nộp một phong bì thật.
    expect(cac.filter((a) => a === "GUEST_SESSION_STARTED")).toHaveLength(6);
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
    await ob.chay(orgA);
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
