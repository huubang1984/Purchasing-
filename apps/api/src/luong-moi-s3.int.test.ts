// ==============================================================================================
// [S1.188 / S3.2b2 / ADR-113] LUỒNG MỜI CỦA TỔ CHỨC ĐÃ BẬT S3 — MỜI Ở DRAFT, ĐÚC TOKEN LÚC MỞ GÓI, GỬI SAU COMMIT, `SENT`
// SAU LẦN GỬI ĐƯỢC, GỬI HỎNG THÌ *CHƯA GỬI* CHỨ KHÔNG THU HỒI LỜI MỜI
//
// Spec S3 §3.3, §2.4 ⑼, §5.1 K6. Trước vòng này, ở tổ chức đã bật, route mời còn ba khe (biên bản §S1.186, *Giới hạn tới
// S3.2b2*): mời ở `DRAFT` trả 422 vì K6 chặn đúc token; mở gói không đúc token cho lời mời đã có; lời mời thêm ở `OPEN` ở lại
// `UNSENT` dù link đã đi — và gửi hỏng thì phần bù *thu hồi lời mời* bị K4a chặn, phản hồi 500. Hợp đồng đo ở đây:
//   ⑴ mời ở `DRAFT`: `201`, lời mời `UNSENT`, không token, bộ gửi không được gọi;
//   ⑵ mở gói: phiên người mở đúc MỘT token cho MỖI lời mời còn sống trong giao dịch mở; bộ gửi nhận token khi token VÀ gói đã
//      commit; gửi được ⇒ `SENT`; phản hồi `200` kèm `unsentInvitationIds`;
//   ⑶ một phần link gửi hỏng: `200`, danh sách nói đúng lời mời nào; lời mời ấy `UNSENT`, còn sống, token vừa đúc bị thu hồi
//      có lý do; gửi lại qua route của ADR-110 ⇒ `SENT`;
//   ⑷ các lần gửi chạy CÙNG LÚC: N bộ gửi treo trả về sau MỘT trần, không N trần;
//   ⑸ mời THÊM ở `OPEN`: gửi được ⇒ `SENT`; gửi hỏng ⇒ `201` với lời mời `UNSENT`, KHÔNG 500, KHÔNG thu hồi lời mời;
//   ⑹ trong lúc gửi, không kết nối nào của ứng dụng giữ khoá ghi sổ của tổ chức;
//   ⑺ đối chứng MVP1: tổ chức chưa bật — mở gói không đúc, không gửi gì; hợp đồng [S1.70] của route mời giữ nguyên
//      (`loi-moi-sau-commit.int.test.ts` đo nó, không đổi một dòng);
//   ⑻ `ducTokenKhiMoGoi` chỉ chạy trong chính giao dịch mở gói, dưới phiên người mở; `danhDauDaGui` chỉ đổi lời mời của gói
//      đang `OPEN`;
//   ⑼ ngữ nghĩa của bộ điều phối cho lô gửi và cho `khiXong` của việc có bù — trên route giả.
// ==============================================================================================
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { createInvitation, danhDauDaGui, ducTokenKhiMoGoi, redeemMagicLink } from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  closeRfq,
  createProcurementPolicy,
  createRfq,
  openRfq,
  setRfqBudget,
  submitRfqForApproval,
} from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiResponse } from "./http.js";
import type { ApiServices, BuyerContext, BuyerReadRoute, Route } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
/**
 * Trần `afterCommitTimeoutMs` của máy chủ thứ hai — đo ⑷. Ba lần gửi nối tiếp ⇒ ≥ 4 500 ms; cùng lúc ⇒ khoảng 1 500 ms. Ngưỡng
 * 3 000 ms của phép đo để 1 500 ms cho máy CI chậm ở cả hai phía.
 */
const TRAN_NGAN_MS = 1500;
const LOI_CHOT_MO_GOI = "Chỉ đúc token cho lời mời trong chính giao dịch mở gói, dưới phiên người mở.";

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `token-goi-da-mo.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. ***
const boBocGia = {
  name: "gia-cho-test-luong-moi-s3",
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

const BAC = [
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

interface Nguoi {
  readonly u: string;
  readonly s: string;
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  readonly pm: Nguoi;
  readonly pm2: Nguoi;
  readonly tc: Nguoi;
}
interface NhaCungCap {
  readonly supplierId: string;
  readonly contactId: string;
  readonly email: string;
}
interface LoiMoi extends NhaCungCap {
  readonly id: string;
}
interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
}

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc = "";
let gocTranNgan = "";
let gocGia = "";
let toChucGia: ToChuc;
const dongServer: (() => Promise<void>)[] = [];

// ---------------------------------------------------------------------------------------------
// Bộ gửi link mời do test điều khiển, theo ĐÍCH (email của người liên hệ): id lời mời chưa có lúc test đặt chế độ cho lần mời.
// `khiGui` ghi, ngay lúc bộ gửi được gọi và từ MỘT KẾT NỐI KHÁC, số token của lời mời đã commit và trạng thái gói đã commit.
// ---------------------------------------------------------------------------------------------
type CheDo = "thuong" | "nem" | "treo" | "cho";
const bg: {
  readonly cheDo: Map<string, CheDo>;
  readonly khiGui: { invitationId: string; token: string; tokenDaCommit: number; goiDaCommit: string }[];
  readonly daGui: { invitationId: string; token: string; destination: string; channel: string }[];
  readonly tha: (() => void)[];
} = { cheDo: new Map(), khiGui: [], daGui: [], tha: [] };

function thaHet(): void {
  for (const f of bg.tha.splice(0)) f();
}

function loiCoTen(ten: string, thongDiep: string): Error {
  return Object.assign(new Error(thongDiep), { name: ten });
}

const ngu = (ms: number): Promise<void> => new Promise((xong) => setTimeout(xong, ms));

async function doi(dieuKien: () => boolean, hanMs: number, thongDiep: string): Promise<void> {
  const het = Date.now() + hanMs;
  while (!dieuKien()) {
    if (Date.now() > het) throw new Error(`het ${hanMs} ms: ${thongDiep}`);
    await ngu(10);
  }
}

async function goi(g: string, method: string, duong: string, cookie: string, than?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = { cookie };
  if (than !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${g}${duong}`, { method, headers, ...(than === undefined ? {} : { body: JSON.stringify(than) }) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // thân không phải JSON — để `text` nói
  }
  return { status: res.status, body, text };
}

/** [S1.193 / S3.2c] `GET /rfqs/:rfqId/invitations` — ba trường màn `/tao-thau` đọc để vẽ bảng và chọn nút. */
async function danhSach(t: ToChuc, rfqId: string): Promise<{ id: string; status: string; moiSauKhiKy: boolean }[]> {
  const r = await goi(goc, "GET", `/rfqs/${rfqId}/invitations`, t.pm.cookie);
  expect(r.status, r.text).toBe(200);
  return (r.body.invitations as { id: string; status: string; moiSauKhiKy: boolean }[]).map(({ id, status, moiSauKhiKy }) => ({ id, status, moiSauKhiKy }));
}

/** Gom MỌI dòng `console.error` từ lúc gọi tới lúc `tra()`. */
function batLog(): { readonly log: string[]; readonly tra: () => void } {
  const log: string[] = [];
  const cu = console.error;
  console.error = (...a: unknown[]) => {
    log.push(a.map(String).join(" "));
  };
  return {
    log,
    tra: () => {
      console.error = cu;
    },
  };
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`lms3-${randomBytes(4).toString("hex")}`]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $2, 'ACTIVE') RETURNING id", [
      org,
      `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
    ]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const token = randomBytes(32).toString("base64url");
    const s = await motId(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [org, u, createHash("sha256").update(token, "utf8").digest()],
    );
    return { u, s, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const tc = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  return { org, pm, pm2, tc };
}

/** BẬT S3 — khuôn `batS3` của `danh-sach-moi.int.test.ts`: phiên bản có bậc, chữ ký thứ hai của một người khác. */
async function batS3(t: ToChuc): Promise<void> {
  const v2 = (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
          "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
          "VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, true, now(), $3, $4) RETURNING id",
        [t.org, JSON.stringify(BAC), t.pm.u, t.pm.s],
      ),
    )
  ).rows[0]!.id;
  await withTenant(apiPool, t.org, (c) =>
    c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
      t.org,
      v2,
      t.tc.u,
      t.tc.s,
    ]),
  );
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org]));
  expect(rows[0]?.b, "dàn cảnh: tổ chức phải ĐÃ BẬT").toBe(true);
}

async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  await batS3(t);
  return t;
}


/**
 * [S1.9101 / S3.6a] Nhóm hàng của tổ chức, dựng MỘT lần bởi người FINANCE (giữ `category.manage`): tổ chức đã bật không nộp duyệt
 * được gói không nhóm hàng. Tổ chức chưa bật nhận cùng nhóm — ở đó nó tuỳ chọn.
 */
const NHOM_CUA = new Map<string, string>();
async function nhomCua(t: ToChuc): Promise<string> {
  const co = NHOM_CUA.get(t.org);
  if (co !== undefined) return co;
  const id = (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO procurement_categories (org_id, ma, ten, created_by, created_by_session_id) VALUES ($1, 'THEP', 'Thep', $2, $3) RETURNING id",
        [t.org, t.tc.u, t.tc.s],
      ),
    )
  ).rows[0]!.id;
  NHOM_CUA.set(t.org, id);
  return id;
}
async function goiNhap(t: ToChuc): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  return rfqId;
}

/** Nộp duyệt → một chữ ký của người khác người tạo, bằng hàm gói thật. Lần MỞ đi qua route — thứ đang đo. */
async function nopVaDuyet(t: ToChuc, rfqId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
  await withTenant(apiPool, t.org, (c) => approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s }, apiPool));
}

async function nhaCungCap(t: ToChuc): Promise<NhaCungCap> {
  const supplierId = await motId(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
  );
  const duoi = randomBytes(6).toString("hex");
  const email = `lh${duoi}@vidu.vn`;
  const contactId = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
    [t.org, supplierId, email, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), t.pm.u, t.pm.s],
  );
  return { supplierId, contactId, email };
}

/** Mời qua ROUTE thật (`POST /rfqs/:rfqId/invitations`), bằng phiên PM. */
async function moiQuaRoute(t: ToChuc, rfqId: string, ncc?: NhaCungCap, g = goc): Promise<{ readonly r: PhanHoi; readonly loiMoi: LoiMoi }> {
  const n = ncc ?? (await nhaCungCap(t));
  const r = await goi(g, "POST", `/rfqs/${rfqId}/invitations`, t.pm.cookie, { supplierId: n.supplierId, contactId: n.contactId });
  const id = (r.body.invitation as { id?: string } | undefined)?.id ?? "";
  return { r, loiMoi: { ...n, id } };
}

async function moi(t: ToChuc, rfqId: string): Promise<LoiMoi> {
  const { r, loiMoi } = await moiQuaRoute(t, rfqId);
  expect(r.status, r.text).toBe(201);
  return loiMoi;
}

interface HangToken {
  readonly hash: Buffer;
  readonly revokedAt: Date | null;
  readonly issuedBy: string;
  readonly issuedBySession: string;
  readonly ducKhiGoiDaMo: boolean;
}

async function trangThai(invitationId: string): Promise<{ status: string; revokedAt: Date | null; moiSauKhiKy: boolean; tokens: HangToken[] }> {
  const { rows: i } = await db.pool.query<{ status: string; revoked_at: Date | null; moi_sau_khi_ky: boolean }>(
    "SELECT status, revoked_at, moi_sau_khi_ky FROM rfq_invitations WHERE id = $1",
    [invitationId],
  );
  const { rows: t } = await db.pool.query<{
    token_hash: Buffer;
    revoked_at: Date | null;
    issued_by: string;
    issued_by_session_id: string;
    duc_khi_goi_da_mo: boolean;
  }>(
    "SELECT token_hash, revoked_at, issued_by, issued_by_session_id, duc_khi_goi_da_mo FROM rfq_invitation_tokens WHERE invitation_id = $1 ORDER BY created_at, id",
    [invitationId],
  );
  const h = i[0];
  if (h === undefined) throw new Error("không có lời mời");
  return {
    status: h.status,
    revokedAt: h.revoked_at,
    moiSauKhiKy: h.moi_sau_khi_ky,
    tokens: t.map((x) => ({
      hash: x.token_hash,
      revokedAt: x.revoked_at,
      issuedBy: x.issued_by,
      issuedBySession: x.issued_by_session_id,
      ducKhiGoiDaMo: x.duc_khi_goi_da_mo,
    })),
  };
}

async function suKien(org: string, invitationId: string): Promise<{ action: string; payload: Record<string, unknown> | null; actorId: string | null }[]> {
  const { rows } = await db.pool.query<{ action: string; payload: Record<string, unknown> | null; actor_id: string | null }>(
    "SELECT action, payload, actor_id FROM audit_events WHERE org_id = $1 AND (resource_id::text = $2 OR payload ->> 'invitationId' = $2) ORDER BY seq",
    [org, invitationId],
  );
  return rows.map((h) => ({ action: h.action, payload: h.payload, actorId: h.actor_id }));
}

const bam = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();

/** Số khoá tư vấn ghi sổ của tổ chức đang ĐƯỢC CẤP cho một kết nối của pool ứng dụng (`application_name` của `createPool`). */
async function demKhoaToChucDangGiu(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid = l.pid " +
      "WHERE l.locktype = 'advisory' AND l.granted AND a.application_name = 'trustprocure' " +
      "AND l.classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND l.objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [org],
  );
  return rows[0]?.n ?? -1;
}

async function loi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function dungServer(dispatcher: ReturnType<typeof createDispatcher>): Promise<string> {
  const server = createApiServer(dispatcher);
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  dongServer.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// ---------------------------------------------------------------------------------------------
// Route GIẢ cho ngữ nghĩa của bộ điều phối (⑼) — không đi qua route mời, không chạm bộ gửi.
// ---------------------------------------------------------------------------------------------
const ghiGia: { viec: string; tx: string; org: string | null }[] = [];
let txHandler = "";

async function ghiTx(viec: string, c: pg.PoolClient): Promise<void> {
  const h = (
    await c.query<{ t: string; org: string | null }>("SELECT pg_catalog.txid_current()::text AS t, pg_catalog.current_setting('app.org_id', true) AS org")
  ).rows[0]!;
  ghiGia.push({ viec, tx: h.t, org: h.org });
}

const THAN_LO = (r: ApiResponse, khoaHong: readonly string[]): ApiResponse => ({ ...r, body: { ...(r.body as object), khoaHong } });

function tuyenGia(): Route[] {
  const tuyen = (path: string, handler: (ctx: BuyerContext) => Promise<ApiResponse>): BuyerReadRoute => ({ method: "GET", path, audience: "BUYER", mutates: false, agent: false, handler });
  return [
    tuyen("/s32b2/lo-ba", async (ctx) => {
      txHandler = (await ctx.client.query<{ t: string }>("SELECT pg_catalog.txid_current()::text AS t")).rows[0]!.t;
      ctx.afterCommit(() => {
        ghiGia.push({ viec: "thuong", tx: "", org: null });
        return Promise.resolve();
      });
      ctx.afterCommitLoGui({
        lanGui: [
          { khoa: "k1", gui: () => Promise.resolve(), khiXong: (c) => ghiTx("xong-k1", c), bu: (c) => ghiTx("bu-k1", c) },
          { khoa: "k2", gui: () => Promise.reject(loiCoTen("LoiGiaK2", "gia lap k2")), khiXong: (c) => ghiTx("xong-k2", c), bu: (c) => ghiTx("bu-k2", c) },
          { khoa: "k3", gui: () => Promise.resolve(), khiXong: (c) => ghiTx("xong-k3", c), bu: (c) => ghiTx("bu-k3", c) },
        ],
        phanHoi: THAN_LO,
      });
      return { status: 200, body: { ok: true } };
    }),
    tuyen("/s32b2/lo-ghi-hong", (ctx) => {
      ctx.afterCommitLoGui({
        lanGui: [
          { khoa: "k1", gui: () => Promise.resolve(), khiXong: () => Promise.reject(loiCoTen("LoiGhiK1", "gia lap ghi k1")), bu: (c) => ghiTx("bu-k1", c) },
          { khoa: "k2", gui: () => Promise.reject(loiCoTen("LoiGuiK2", "gia lap gui k2")), khiXong: (c) => ghiTx("xong-k2", c), bu: () => Promise.reject(loiCoTen("LoiBuK2", "gia lap bu k2")) },
        ],
        phanHoi: THAN_LO,
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    tuyen("/s32b2/lo-422", (ctx) => {
      ctx.afterCommitLoGui({
        lanGui: [{ khoa: "k1", gui: () => { ghiGia.push({ viec: "gui-k1", tx: "", org: null }); return Promise.resolve(); }, khiXong: (c) => ghiTx("xong-k1", c), bu: (c) => ghiTx("bu-k1", c) }],
        phanHoi: THAN_LO,
      });
      return Promise.resolve({ status: 422, body: { error: "gia 422" } });
    }),
    tuyen("/s32b2/hai-lo", (ctx) => {
      const lo = { lanGui: [{ khoa: "k1", gui: () => { ghiGia.push({ viec: "gui-k1", tx: "", org: null }); return Promise.resolve(); }, khiXong: (c: pg.PoolClient) => ghiTx("xong-k1", c), bu: (c: pg.PoolClient) => ghiTx("bu-k1", c) }], phanHoi: THAN_LO };
      ctx.afterCommitLoGui(lo);
      ctx.afterCommitLoGui(lo);
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    tuyen("/s32b2/co-bu-roi-lo", (ctx) => {
      ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: (c) => ghiTx("bu", c), phanHoiKhiHong: { status: 502, body: { error: "gia" } } });
      ctx.afterCommitLoGui({ lanGui: [], phanHoi: THAN_LO });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    tuyen("/s32b2/co-bu-khi-xong", async (ctx) => {
      txHandler = (await ctx.client.query<{ t: string }>("SELECT pg_catalog.txid_current()::text AS t")).rows[0]!.t;
      ctx.afterCommitCoBu({
        viec: () => Promise.resolve(),
        bu: (c) => ghiTx("bu", c),
        khiXong: (c) => ghiTx("xong", c),
        phanHoiKhiHong: { status: 502, body: { error: "gia" } },
      });
      return { status: 200, body: { ok: true } };
    }),
    tuyen("/s32b2/co-bu-khi-xong-hong", (ctx) => {
      ctx.afterCommitCoBu({
        viec: () => Promise.resolve(),
        bu: (c) => ghiTx("bu", c),
        khiXong: () => Promise.reject(loiCoTen("LoiGhiXong", "gia lap ghi xong")),
        phanHoiKhiHong: { status: 502, body: { error: "gia" } },
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    tuyen("/s32b2/co-bu-hong-khong-xong", (ctx) => {
      ctx.afterCommitCoBu({
        viec: () => Promise.reject(loiCoTen("LoiViec", "gia lap viec")),
        bu: (c) => ghiTx("bu", c),
        khiXong: (c) => ghiTx("xong", c),
        phanHoiKhiHong: { status: 502, body: { error: "da bu" } },
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
  ];
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  // Pool dựng như sản xuất — cùng `lock_timeout`, `statement_timeout` và `application_name` mà phép đếm khoá đọc.
  apiPool = createPool(db.connectionString, 6, { role: "app_api" });
  auditPool = createPool(db.connectionString, 4, { role: "app_api" });
  const dv = dichVuTest();
  const services: ApiServices = {
    ...dv.services,
    orgKeyProvisioner: boBocGia,
    invitationLinkSender: {
      name: "bo-gui-dieu-khien-s32b2",
      send: async (m) => {
        const cheDo = bg.cheDo.get(m.destination) ?? "thuong";
        const { rows } = await db.pool.query<{ n: number; goi: string }>(
          "SELECT (SELECT count(*)::int FROM rfq_invitation_tokens WHERE invitation_id = $1) AS n, " +
            "(SELECT p.status FROM rfq_packages p JOIN rfq_invitations i ON i.rfq_id = p.id AND i.org_id = p.org_id WHERE i.id = $1) AS goi",
          [m.invitationId],
        );
        bg.khiGui.push({ invitationId: m.invitationId, token: m.token, tokenDaCommit: rows[0]?.n ?? -1, goiDaCommit: rows[0]?.goi ?? "" });
        // Thông điệp MANG token và đích — dòng log không được mang mảnh nào của nó (A2).
        if (cheDo === "nem") throw loiCoTen("LoiGuiGiaLap", `gia lap gui hong ${m.token} ${m.destination}`);
        if (cheDo === "treo" || cheDo === "cho") {
          await new Promise<void>((xong) => {
            bg.tha.push(xong);
          });
          if (cheDo === "treo") return;
        }
        bg.daGui.push({ invitationId: m.invitationId, token: m.token, destination: m.destination, channel: m.channel });
      },
    },
  };
  goc = await dungServer(createDispatcher({ pool: apiPool, auditPool, services }));
  gocTranNgan = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, afterCommitTimeoutMs: TRAN_NGAN_MS }));
  gocGia = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, routes: tuyenGia() }));
  toChucGia = await taoToChuc();
}, 180000);

afterAll(async () => {
  thaHet();
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("S3.2b2 — luồng mời của tổ chức đã bật S3 qua HTTP", () => {
  it("[INV-K4a] [INV-K6] ⑴ mời ở DRAFT: 201, lời mời UNSENT không nhãn, KHÔNG token, bộ gửi không được gọi; sổ chỉ INVITATION_CREATED", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const truoc = bg.khiGui.length;
    const { r, loiMoi } = await moiQuaRoute(t, rfqId);
    expect(r.status, r.text).toBe(201);
    expect(r.body.invitation).toMatchObject({ id: loiMoi.id, status: "UNSENT", moiSauKhiKy: false });
    const h = await trangThai(loiMoi.id);
    expect(h.status).toBe("UNSENT");
    expect(h.tokens, "không token nào cho gói chưa từng mở (K6)").toHaveLength(0);
    expect(bg.khiGui.length, "bộ gửi không được gọi").toBe(truoc);
    expect((await suKien(t.org, loiMoi.id)).map((e) => e.action)).toEqual(["INVITATION_CREATED"]);
    // [S1.193 / S3.2c] Danh sách mà màn đọc nói đúng điều ấy: chưa gửi, không nhãn.
    expect(await danhSach(t, rfqId)).toEqual([{ id: loiMoi.id, status: "UNSENT", moiSauKhiKy: false }]);
  });

  it("[INV-K6] ⑵ mở gói: MỘT token cho MỖI lời mời còn sống, dưới phiên người mở, trong giao dịch mở; link đi khi token và gói ĐÃ commit; lời mời thành SENT; 200 với danh sách chưa gửi rỗng", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const song = [await moi(t, rfqId), await moi(t, rfqId), await moi(t, rfqId)];
    const bo = await moi(t, rfqId);
    const th = await goi(goc, "POST", `/invitations/${bo.id}/revoke`, t.pm.cookie);
    expect(th.status, `thu hồi ở DRAFT đi qua (K4a): ${th.text}`).toBe(200);
    await nopVaDuyet(t, rfqId);

    const r = await goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(r.status, r.text).toBe(200);
    expect((r.body.rfq as { status: string }).status).toBe("OPEN");
    expect(r.body.unsentInvitationIds).toEqual([]);

    const cuaGoi = new Set([...song.map((s) => s.id), bo.id]);
    const khiGui = bg.khiGui.filter((k) => cuaGoi.has(k.invitationId));
    expect(khiGui.map((k) => k.invitationId).sort(), "đúng ba link, không link nào cho lời mời đã thu hồi").toEqual(song.map((s) => s.id).sort());
    for (const k of khiGui) {
      expect(k.tokenDaCommit, "lúc bộ gửi được gọi, token ĐÃ commit").toBe(1);
      expect(k.goiDaCommit, "lúc bộ gửi được gọi, gói ĐÃ commit ở OPEN").toBe("OPEN");
    }
    for (const s of song) {
      const h = await trangThai(s.id);
      expect(h.status, "gửi được ⇒ SENT").toBe("SENT");
      expect(h.tokens).toHaveLength(1);
      const tk = h.tokens[0]!;
      expect(tk.issuedBy, "token đúc dưới người mở").toBe(t.pm.u);
      expect(tk.issuedBySession, "token đúc dưới PHIÊN người mở").toBe(t.pm.s);
      expect(tk.ducKhiGoiDaMo).toBe(true);
      expect(tk.revokedAt).toBeNull();
      const gui = bg.daGui.find((d) => d.invitationId === s.id);
      expect(gui?.destination, "đích đọc từ supplier_contacts").toBe(s.email);
      expect(gui?.channel).toBe("EMAIL");
      expect(bam(gui?.token ?? "").equals(tk.hash), "bộ gửi nhận ĐÚNG token đã đúc").toBe(true);
      expect(r.text, "token không về client").not.toContain(gui?.token);
      expect(await loi(withTenant(apiPool, t.org, (c) => redeemMagicLink(c, t.org, gui?.token ?? ""))), "link đổi được").toBeNull();
      expect((await suKien(t.org, s.id)).map((e) => e.action)).toEqual(["INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED"]);
    }
    const hBo = await trangThai(bo.id);
    expect(hBo.status).toBe("REVOKED");
    expect(hBo.tokens).toHaveLength(0);
  });

  it("[INV-K6] ⑶ một phần link gửi hỏng: 200 kèm đúng lời mời chưa gửi; nó UNSENT, còn sống, token vừa đúc thu hồi có lý do; phần còn lại SENT; log không mang token hay đích; gửi lại qua route ADR-110 ⇒ SENT", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const [a, b, c] = [await moi(t, rfqId), await moi(t, rfqId), await moi(t, rfqId)];
    await nopVaDuyet(t, rfqId);
    bg.cheDo.set(b.email, "nem");
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    } finally {
      log.tra();
      bg.cheDo.delete(b.email);
    }
    expect(r.status, r.text).toBe(200);
    expect(r.body.unsentInvitationIds).toEqual([b.id]);
    expect((await trangThai(a.id)).status).toBe("SENT");
    expect((await trangThai(c.id)).status).toBe("SENT");
    const hb = await trangThai(b.id);
    expect(hb.status, "gửi hỏng ⇒ chưa gửi").toBe("UNSENT");
    expect(hb.revokedAt, "KHÔNG thu hồi lời mời").toBeNull();
    expect(hb.tokens).toHaveLength(1);
    expect(hb.tokens[0]?.revokedAt, "token vừa đúc bị thu hồi").not.toBeNull();
    const sk = await suKien(t.org, b.id);
    expect(sk.map((e) => e.action)).toEqual(["INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED", "MAGIC_LINK_TOKEN_REVOKED"]);
    expect(sk[2]?.payload).toEqual({ invitationId: b.id, reason: "LINK_SEND_FAILED" });
    expect(sk[2]?.actorId, "phần bù dưới phiên người mở").toBe(t.pm.u);
    const tokenHong = bg.khiGui.find((k) => k.invitationId === b.id)?.token ?? "";
    expect(tokenHong).not.toBe("");
    expect(log.log.filter((l) => l.includes("sau-commit"))).toHaveLength(1);
    expect(log.log.join("\n")).toMatch(/sau-commit 2\/3 LoiGuiGiaLap/);
    for (const l of log.log) {
      expect(l, "A2: log không mang token").not.toContain(tokenHong);
      expect(l, "A2: log không mang đích").not.toContain(b.email);
    }

    const gl = await goi(goc, "POST", `/invitations/${b.id}/reissue`, t.pm.cookie);
    expect(gl.status, gl.text).toBe(200);
    expect((await trangThai(b.id)).status, "gửi lại đi được ⇒ SENT").toBe("SENT");
    const guiLai = bg.daGui.filter((d) => d.invitationId === b.id);
    expect(guiLai).toHaveLength(1);
    expect(await loi(withTenant(apiPool, t.org, (cl) => redeemMagicLink(cl, t.org, guiLai[0]?.token ?? "")))).toBeNull();
  });

  it("[INV-K6] ⑷ bộ gửi treo quá trần cho CẢ BA lời mời: phản hồi về sau khoảng MỘT trần — các lần gửi chạy cùng lúc —, cả ba chưa gửi, ba token thu hồi", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const ds = [await moi(t, rfqId), await moi(t, rfqId), await moi(t, rfqId)];
    await nopVaDuyet(t, rfqId);
    for (const d of ds) bg.cheDo.set(d.email, "treo");
    const log = batLog();
    let r: PhanHoi;
    const batDau = Date.now();
    try {
      r = await goi(gocTranNgan, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    } finally {
      log.tra();
      for (const d of ds) bg.cheDo.delete(d.email);
      thaHet();
    }
    const tre = Date.now() - batDau;
    expect(r.status, r.text).toBe(200);
    expect(r.body.unsentInvitationIds, "đúng thứ tự lời mời").toEqual(ds.map((d) => d.id));
    expect(tre).toBeGreaterThanOrEqual(TRAN_NGAN_MS - 100);
    expect(tre, `ba lần gửi nối tiếp là ≥ ${String(3 * TRAN_NGAN_MS)} ms`).toBeLessThan(2 * TRAN_NGAN_MS);
    for (const d of ds) {
      const h = await trangThai(d.id);
      expect(h.status).toBe("UNSENT");
      expect(h.tokens[0]?.revokedAt).not.toBeNull();
    }
    expect(log.log.filter((l) => /sau-commit [123]\/3 SauCommitQuaHan/.test(l))).toHaveLength(3);
  });

  it("[INV-K6] ⑸ mời THÊM ở OPEN: gửi được ⇒ 201 SENT có nhãn; gửi hỏng ⇒ 201 lời mời UNSENT còn sống, token thu hồi, KHÔNG 500, KHÔNG INVITATION_REVOKED; gửi lại ⇒ SENT", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nopVaDuyet(t, rfqId);
    const mo = await goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(mo.status, mo.text).toBe(200);
    expect(mo.body.unsentInvitationIds, "gói không lời mời: danh sách rỗng").toEqual([]);

    const duoc = await moiQuaRoute(t, rfqId);
    expect(duoc.r.status, duoc.r.text).toBe(201);
    expect(duoc.r.body.invitation).toMatchObject({ id: duoc.loiMoi.id, status: "SENT", moiSauKhiKy: true });
    const hd = await trangThai(duoc.loiMoi.id);
    expect(hd).toMatchObject({ status: "SENT", moiSauKhiKy: true });
    expect(hd.tokens.map((x) => x.revokedAt)).toEqual([null]);

    const n = await nhaCungCap(t);
    bg.cheDo.set(n.email, "nem");
    const log = batLog();
    let hong: Awaited<ReturnType<typeof moiQuaRoute>>;
    try {
      hong = await moiQuaRoute(t, rfqId, n);
    } finally {
      log.tra();
      bg.cheDo.delete(n.email);
    }
    expect(hong.r.status, hong.r.text).toBe(201);
    expect(hong.r.body.invitation).toMatchObject({ id: hong.loiMoi.id, status: "UNSENT", moiSauKhiKy: true });
    const hh = await trangThai(hong.loiMoi.id);
    expect(hh.status).toBe("UNSENT");
    expect(hh.revokedAt, "K4a cấm thu hồi ở OPEN — và phần bù không thử").toBeNull();
    expect(hh.tokens[0]?.revokedAt).not.toBeNull();
    const sk = await suKien(t.org, hong.loiMoi.id);
    expect(sk.map((e) => e.action)).toEqual(["INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED", "MAGIC_LINK_TOKEN_REVOKED"]);
    expect(sk[2]?.payload).toEqual({ invitationId: hong.loiMoi.id, reason: "LINK_SEND_FAILED" });
    expect(log.log.filter((l) => l.includes("sau-commit"))).toHaveLength(1);
    // [S1.193 / S3.2c] Danh sách mà màn đọc mang nhãn *mời sau khi ký* của CẢ HAI, và trạng thái thật của từng lời mời.
    expect(await danhSach(t, rfqId)).toEqual([
      { id: duoc.loiMoi.id, status: "SENT", moiSauKhiKy: true },
      { id: hong.loiMoi.id, status: "UNSENT", moiSauKhiKy: true },
    ]);

    const gl = await goi(goc, "POST", `/invitations/${hong.loiMoi.id}/reissue`, t.pm.cookie);
    expect(gl.status, gl.text).toBe(200);
    expect((await trangThai(hong.loiMoi.id)).status).toBe("SENT");
  });

  it("[INV-K6] ⑹ trong lúc các link đang gửi, không kết nối nào của ứng dụng giữ khoá ghi sổ của tổ chức, và một lần ghi khác của tổ chức ấy đi qua ngay", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const ds = [await moi(t, rfqId), await moi(t, rfqId)];
    await nopVaDuyet(t, rfqId);
    for (const d of ds) bg.cheDo.set(d.email, "cho");
    try {
      const phanHoi = goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
      await doi(() => ds.every((d) => bg.khiGui.some((k) => k.invitationId === d.id)), 10000, "bộ gửi chưa được gọi cho cả hai");
      expect(await demKhoaToChucDangGiu(t.org), "không ai giữ khoá ghi sổ trong lúc gửi").toBe(0);
      const batDau = Date.now();
      const ghiKhac = await goi(goc, "POST", "/suppliers", t.pm.cookie, { legalName: "Thep Trong Luc Gui", taxCode: `03${String(Date.now()).slice(-8)}` });
      expect(ghiKhac.status, ghiKhac.text).toBe(201);
      expect(Date.now() - batDau, "lần ghi khác không chờ lần gửi").toBeLessThan(2000);
      thaHet();
      const r = await phanHoi;
      expect(r.status, r.text).toBe(200);
      expect(r.body.unsentInvitationIds).toEqual([]);
    } finally {
      for (const d of ds) bg.cheDo.delete(d.email);
      thaHet();
    }
    for (const d of ds) expect((await trangThai(d.id)).status).toBe("SENT");
  });

  it("⑺ ĐỐI CHỨNG MVP1: tổ chức CHƯA bật — mời ở DRAFT đúc và gửi ngay (SENT); mở gói qua route không đúc, không gửi gì, danh sách rỗng", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const { r, loiMoi } = await moiQuaRoute(t, rfqId);
    expect(r.status, r.text).toBe(201);
    expect(r.body.invitation).toMatchObject({ status: "SENT", moiSauKhiKy: false });
    expect(bg.khiGui.filter((k) => k.invitationId === loiMoi.id)).toHaveLength(1);
    await nopVaDuyet(t, rfqId);
    const mo = await goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(mo.status, mo.text).toBe(200);
    expect(mo.body.unsentInvitationIds).toEqual([]);
    expect(bg.khiGui.filter((k) => k.invitationId === loiMoi.id), "lần mở không gửi thêm").toHaveLength(1);
    const h = await trangThai(loiMoi.id);
    expect(h.status).toBe("SENT");
    expect(h.tokens, "lần mở không đúc thêm").toHaveLength(1);
    expect(await danhSach(t, rfqId), "[S1.193 / S3.2c] tổ chức chưa bật: không nhãn").toEqual([{ id: loiMoi.id, status: "SENT", moiSauKhiKy: false }]);
  });
});

// =============================================================================================
// [S1.194 / S3.2d / khoản 255 / ADR-114] K4a VÀO SỔ. Lần thêm hay thu hồi lời mời sai trạng thái để lại MỘT hàng
// `CONTROL_DENIED` mang mã, ghi ở giao dịch ĐỘC LẬP. Trigger `rfq_invitations_kiem_danh_sach` vẫn là lớp có thẩm quyền; tầng gói
// nhận ra lời từ chối của nó bằng TÊN ràng buộc (khuôn ADR-108). Trước vòng này: `422` mang câu của trigger, không hàng sổ nào
// (lượt đi thử T4 của S3.2c2, §S1.193).
// =============================================================================================
const THONG_DIEP_THEM =
  "Danh sách mời chỉ đổi được khi gói thầu còn soạn thảo, và chỉ thêm được khi gói đã mở; gói đang chờ duyệt thì trả về soạn " +
  "thảo trước (K4a).";
const THONG_DIEP_THU_HOI =
  "Lời mời chỉ thu hồi được khi gói thầu còn soạn thảo; gói đang chờ duyệt thì trả về soạn thảo trước, gói đã mở thì chưa thu hồi " +
  "được (K4a).";

/** Hàng `CONTROL_DENIED` trên một gói, theo thứ tự ghi. */
async function tuChoiChot(org: string, rfqId: string): Promise<{ ma: unknown; actorId: string | null }[]> {
  const { rows } = await db.pool.query<{ payload: Record<string, unknown> | null; actor_id: string | null }>(
    "SELECT payload, actor_id FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows.map((h) => ({ ma: h.payload?.ma, actorId: h.actor_id }));
}

describe("S3.2d — K4a vào sổ: thêm hay thu hồi lời mời sai trạng thái để lại MỘT hàng CONTROL_DENIED (khoản 255)", () => {
  it("[INV-K4a] mời lúc gói CHỜ DUYỆT ⇒ 422 mang thông điệp của chốt; MỘT hàng CONTROL_DENIED {K4A_THEM_SAI_TRANG_THAI} dưới người mời; không lời mời nào chèn thêm", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId);
    await nopVaDuyet(t, rfqId);
    const { r } = await moiQuaRoute(t, rfqId);
    expect(r.status, r.text).toBe(422);
    expect(r.body.error).toBe(THONG_DIEP_THEM);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K4A_THEM_SAI_TRANG_THAI", actorId: t.pm.u }]);
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitations WHERE rfq_id = $1", [rfqId]);
    expect(rows[0]?.n, "lời mời lúc DRAFT còn, lần chèn lúc chờ duyệt rollback").toBe(1);
  });

  it("[INV-K4a] thu hồi ở OPEN ⇒ 422 mang thông điệp của chốt; MỘT hàng CONTROL_DENIED {K4A_THU_HOI_SAI_TRANG_THAI}; lời mời và token còn sống", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const lm = await moi(t, rfqId);
    await nopVaDuyet(t, rfqId);
    const mo = await goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(mo.status, mo.text).toBe(200);
    const r = await goi(goc, "POST", `/invitations/${lm.id}/revoke`, t.pm.cookie);
    expect(r.status, r.text).toBe(422);
    expect(r.body.error).toBe(THONG_DIEP_THU_HOI);
    expect(await tuChoiChot(t.org, rfqId), "mời ở DRAFT và mở gói không để hàng nào; lần thu hồi để đúng một").toEqual([
      { ma: "K4A_THU_HOI_SAI_TRANG_THAI", actorId: t.pm.u },
    ]);
    const h = await trangThai(lm.id);
    expect(h).toMatchObject({ status: "SENT", revokedAt: null });
    expect(h.tokens.map((x) => x.revokedAt)).toEqual([null]);
  });

  it("[INV-K4a] thu hồi lúc gói CHỜ DUYỆT ⇒ 422 mang thông điệp của chốt; MỘT hàng CONTROL_DENIED {K4A_THU_HOI_SAI_TRANG_THAI}; lời mời còn sống, gói ở nguyên", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const lm = await moi(t, rfqId);
    await nopVaDuyet(t, rfqId);
    const r = await goi(goc, "POST", `/invitations/${lm.id}/revoke`, t.pm.cookie);
    expect(r.status, r.text).toBe(422);
    expect(r.body.error).toBe(THONG_DIEP_THU_HOI);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K4A_THU_HOI_SAI_TRANG_THAI", actorId: t.pm.u }]);
    expect(await trangThai(lm.id)).toMatchObject({ status: "UNSENT", revokedAt: null });
    const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId]);
    expect(rows[0]?.status).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4a] thu hồi ở DRAFT — lần K4a cho phép — đi qua, không hàng CONTROL_DENIED", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const lm = await moi(t, rfqId);
    const r = await goi(goc, "POST", `/invitations/${lm.id}/revoke`, t.pm.cookie);
    expect(r.status, r.text).toBe(200);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  it("[INV-K4a] ĐỐI CHỨNG MVP1: tổ chức CHƯA bật — mời lúc chờ duyệt và thu hồi ở OPEN đi qua, không hàng CONTROL_DENIED nào", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const lm = await moi(t, rfqId);
    await nopVaDuyet(t, rfqId);
    const { r } = await moiQuaRoute(t, rfqId);
    expect(r.status, r.text).toBe(201);
    const mo = await goi(goc, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(mo.status, mo.text).toBe(200);
    const th = await goi(goc, "POST", `/invitations/${lm.id}/revoke`, t.pm.cookie);
    expect(th.status, th.text).toBe(200);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  it("[INV-K4a] ĐỘT BIẾN: trigger mất TÊN ràng buộc ⇒ lần mời vẫn bị chặn (23514) nhưng KHÔNG hàng sổ nào — tầng gói nhận ra lời từ chối bằng tên, không bằng câu", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nopVaDuyet(t, rfqId);
    const n = await nhaCungCap(t);
    const { rows } = await db.pool.query<{ d: string }>(
      "SELECT pg_get_functiondef('public.rfq_invitations_kiem_danh_sach()'::regprocedure) AS d",
    );
    const than = rows[0]!.d;
    const khongTen = than.replace(/,\s*CONSTRAINT = 'k4a_[a-z_]+'/g, "");
    expect(khongTen, "tiền đề: thân hàm mang tên ràng buộc ở hai nhánh K4a").not.toBe(than);
    const c = await db.pool.connect();
    let bat: unknown = null;
    try {
      await c.query("BEGIN");
      await c.query(khongTen);
      await c.query("SET LOCAL ROLE app_api");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [t.org]);
      try {
        await createInvitation(c, t.org, { rfqId, supplierId: n.supplierId, contactId: n.contactId, actorSessionId: t.pm.s }, auditPool);
      } catch (e) {
        bat = e;
      }
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect((bat as { code?: string } | null)?.code, "trigger vẫn là lớp chặn").toBe("23514");
    expect(await tuChoiChot(t.org, rfqId), "không tên ⇒ tầng gói không nhận ra ⇒ không hàng sổ").toEqual([]);
  });
});

describe("S3.2b2 — hai hàm gói của luồng mới", () => {
  it("[INV-K6] ⑻ `ducTokenKhiMoGoi` chỉ đúc trong CHÍNH giao dịch mở gói, dưới CHÍNH phiên người mở — không phải một lối gửi lại hàng loạt", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const n = await nhaCungCap(t);
    const inv = await withTenant(apiPool, t.org, async (c) =>
      (await createInvitation(c, t.org, { rfqId, supplierId: n.supplierId, contactId: n.contactId, actorSessionId: t.pm.s }, apiPool)).id,
    );
    await nopVaDuyet(t, rfqId);
    // Cùng giao dịch, phiên KHÁC người mở ⇒ từ chối, và cả lần mở rollback.
    expect(
      await loi(
        withTenant(apiPool, t.org, async (c) => {
          await openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool);
          await ducTokenKhiMoGoi(c, t.org, { rfqId, actorSessionId: t.pm2.s });
        }),
      ),
    ).toBe(LOI_CHOT_MO_GOI);
    const { rows: g } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId]);
    expect(g[0]?.status).toBe("PENDING_APPROVAL");
    // Cùng giao dịch, cùng phiên ⇒ đúc đúng một token cho lời mời còn sống.
    const links = await withTenant(apiPool, t.org, async (c) => {
      await openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool);
      return ducTokenKhiMoGoi(c, t.org, { rfqId, actorSessionId: t.pm.s });
    });
    expect(links.map((l) => ({ invitationId: l.invitationId, channel: l.channel, destination: l.destination }))).toEqual([
      { invitationId: inv, channel: "EMAIL", destination: n.email },
    ]);
    // Giao dịch SAU, cùng phiên người mở ⇒ từ chối: gói đã mở từ trước.
    expect(await loi(withTenant(apiPool, t.org, (c) => ducTokenKhiMoGoi(c, t.org, { rfqId, actorSessionId: t.pm.s })))).toBe(LOI_CHOT_MO_GOI);
    expect((await trangThai(inv)).tokens).toHaveLength(1);
  });

  it("⑻ ĐỐI CHỨNG MVP1: `ducTokenKhiMoGoi` ở tổ chức chưa bật trả mảng rỗng, không đúc gì — kể cả trong chính giao dịch mở gói", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const n = await nhaCungCap(t);
    const inv = await withTenant(apiPool, t.org, async (c) =>
      (await createInvitation(c, t.org, { rfqId, supplierId: n.supplierId, contactId: n.contactId, actorSessionId: t.pm.s }, apiPool)).id,
    );
    await nopVaDuyet(t, rfqId);
    const links = await withTenant(apiPool, t.org, async (c) => {
      await openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool);
      return ducTokenKhiMoGoi(c, t.org, { rfqId, actorSessionId: t.pm.s });
    });
    expect(links).toEqual([]);
    expect((await trangThai(inv)).tokens).toHaveLength(0);
  });

  it("[INV-K6] ⑻ `danhDauDaGui` chỉ đổi lời mời còn sống, còn UNSENT, của gói đang OPEN — gói đã đóng thì trả false thay vì làm hỏng giao dịch ghi", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const n = await nhaCungCap(t);
    const inv = await withTenant(apiPool, t.org, async (c) =>
      (await createInvitation(c, t.org, { rfqId, supplierId: n.supplierId, contactId: n.contactId, actorSessionId: t.pm.s }, apiPool)).id,
    );
    await nopVaDuyet(t, rfqId);
    await withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
    await withTenant(apiPool, t.org, (c) => closeRfq(c, t.org, { rfqId, reason: "dong som de do", actorSessionId: t.pm.s }));
    expect(await withTenant(apiPool, t.org, (c) => danhDauDaGui(c, t.org, inv))).toBe(false);
    expect((await trangThai(inv)).status).toBe("UNSENT");

    const rfq2 = await goiNhap(t);
    const n2 = await nhaCungCap(t);
    const inv2 = await withTenant(apiPool, t.org, async (c) =>
      (await createInvitation(c, t.org, { rfqId: rfq2, supplierId: n2.supplierId, contactId: n2.contactId, actorSessionId: t.pm.s }, apiPool)).id,
    );
    await nopVaDuyet(t, rfq2);
    await withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId: rfq2, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
    expect(await withTenant(apiPool, t.org, (c) => danhDauDaGui(c, t.org, inv2))).toBe(true);
    expect((await trangThai(inv2)).status).toBe("SENT");
    expect(await withTenant(apiPool, t.org, (c) => danhDauDaGui(c, t.org, inv2)), "lần hai: không còn gì để đổi").toBe(false);
  });
});

describe("S3.2b2 — bộ điều phối: lô gửi sau commit và `khiXong` của việc có bù (route giả)", () => {
  const goiGia = (duong: string): Promise<PhanHoi> => goi(gocGia, "GET", duong, toChucGia.pm.cookie);

  it("⑼ lô ba lần gửi, lần giữa hỏng: `khiXong` cho lần xong, `bu` cho lần hỏng, mỗi việc một giao dịch MỚI đã gắn tổ chức; `phanHoi` nhận đúng khoá hỏng; việc thường chạy sau", async () => {
    ghiGia.length = 0;
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await goiGia("/s32b2/lo-ba");
    } finally {
      log.tra();
    }
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({ ok: true, khoaHong: ["k2"] });
    expect(ghiGia.map((g) => g.viec)).toEqual(["xong-k1", "bu-k2", "xong-k3", "thuong"]);
    const cacTx = ghiGia.filter((g) => g.viec !== "thuong");
    for (const g of cacTx) {
      expect(g.tx, "giao dịch khác giao dịch của handler").not.toBe(txHandler);
      expect(g.org, "giao dịch đã gắn tổ chức").toBe(toChucGia.org);
    }
    expect(new Set(cacTx.map((g) => g.tx)).size, "mỗi việc một giao dịch").toBe(3);
    expect(log.log).toHaveLength(1);
    expect(log.log[0]).toMatch(/sau-commit 2\/3 LoiGiaK2$/);
  });

  it("⑼ lô: `khiXong` hay `bu` hỏng ⇒ một dòng log mỗi lần, danh sách khoá hỏng KHÔNG đổi", async () => {
    ghiGia.length = 0;
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await goiGia("/s32b2/lo-ghi-hong");
    } finally {
      log.tra();
    }
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({ ok: true, khoaHong: ["k2"] });
    expect(log.log.map((l) => l.replace(/^\[api\] [0-9a-f-]+ /, ""))).toEqual([
      "ghi-sau-commit 1/2 LoiGhiK1",
      "sau-commit 2/2 LoiGuiK2",
      "bu-sau-commit 2/2 LoiBuK2",
    ]);
  });

  it("⑼ lô chỉ chạy khi phản hồi thành công; một yêu cầu đăng ký MỘT việc có bù — hai lô, hay việc có bù rồi lô, là lỗi của handler", async () => {
    ghiGia.length = 0;
    const r422 = await goiGia("/s32b2/lo-422");
    expect(r422.status).toBe(422);
    const log = batLog();
    let hai: PhanHoi;
    let coBuRoiLo: PhanHoi;
    try {
      hai = await goiGia("/s32b2/hai-lo");
      coBuRoiLo = await goiGia("/s32b2/co-bu-roi-lo");
    } finally {
      log.tra();
    }
    expect(hai.status).toBe(500);
    expect(coBuRoiLo.status).toBe(500);
    expect(ghiGia, "không lần gửi nào, không việc ghi nào").toEqual([]);
    expect(log.log.filter((l) => l.includes("ViecCoBuThuHai"))).toHaveLength(2);
  });

  it("⑼ `khiXong` của việc có bù: chạy SAU `viec` xong, trong giao dịch MỚI đã gắn tổ chức; hỏng ⇒ một dòng `ghi-sau-commit`, phản hồi giữ nguyên; `viec` hỏng ⇒ `bu` chạy, `khiXong` KHÔNG chạy", async () => {
    ghiGia.length = 0;
    const r = await goiGia("/s32b2/co-bu-khi-xong");
    expect(r.status, r.text).toBe(200);
    expect(ghiGia.map((g) => g.viec)).toEqual(["xong"]);
    expect(ghiGia[0]?.tx).not.toBe(txHandler);
    expect(ghiGia[0]?.org).toBe(toChucGia.org);

    const log = batLog();
    let rHong: PhanHoi;
    let rViecHong: PhanHoi;
    ghiGia.length = 0;
    try {
      rHong = await goiGia("/s32b2/co-bu-khi-xong-hong");
      rViecHong = await goiGia("/s32b2/co-bu-hong-khong-xong");
    } finally {
      log.tra();
    }
    expect(rHong.status, rHong.text).toBe(200);
    expect(rHong.body).toEqual({ ok: true });
    expect(rViecHong.status).toBe(502);
    expect(rViecHong.body).toEqual({ error: "da bu" });
    expect(ghiGia.map((g) => g.viec)).toEqual(["bu"]);
    expect(log.log.map((l) => l.replace(/^\[api\] [0-9a-f-]+ /, ""))).toEqual(["ghi-sau-commit LoiGhiXong", "sau-commit LoiViec"]);
  });
});
