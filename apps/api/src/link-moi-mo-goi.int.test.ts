// ==============================================================================================
// [S1.9101 / S3.2b / ADR-082 ⑼] LINK MỜI ĐI LÚC MỞ GÓI Ở TỔ CHỨC ĐÃ BẬT S3 — ĐO TRÊN HTTP THẬT VÀ POSTGRES THẬT
//
// Hợp đồng đo ở đây (chủ dự án chốt ngày 2026-09-29):
//   ⑴ ở tổ chức đã bật, lời mời dựng ở DRAFT không có token, không link (K6); PHIÊN NGƯỜI MỞ đúc một token cho MỖI lời mời còn
//      sống trong CHÍNH giao dịch mở gói, và link đi SAU commit — mỗi lời mời đúng một lần;
//   ⑵ gửi được ⇒ lời mời `SENT`; gửi hỏng hay quá trần ⇒ lời mời ở lại `UNSENT`, token VỪA ĐÚC bị thu hồi (`LINK_SEND_FAILED`), và
//      phản hồi vẫn là 2xx kèm danh sách lời mời chưa gửi — không thu hồi lời mời (thu hẹp danh sách đã ký);
//   ⑶ gửi lại (ADR-110) cho lời mời chưa gửi ⇒ `SENT`;
//   ⑷ thêm hay thu hồi lời mời sai trạng thái (K4a) ⇒ 422 có tên và MỘT hàng `CONTROL_DENIED` mang mã;
//   ⑸ route `return-to-draft`: người tạo hoặc người giữ `rfq.approve`; tổ chức chưa bật ⇒ 422 không vào sổ;
//   ⑹ khoản 253: token đúc trước lúc gói mở — thời MVP1, trước lần bật — không dùng được nữa;
//   ⑺ bộ điều phối: mỗi lần gửi một trần, song song; lần ghi kết quả hỏng ⇒ phản hồi nói trạng thái chưa ghi; một yêu cầu tối đa
//      MỘT việc quyết phản hồi.
// Tổ chức CHƯA bật là đối chứng: cùng route, hành vi MVP1 ([S1.70], ADR-110).
// ==============================================================================================
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { CHOT_THEO_RANG_BUOC, CHOT_VAO_SO } from "@trustprocure/identity";
import { InvitationError, createInvitation, issueMagicLinkToken, redeemMagicLink, reissueInvitationLink } from "@trustprocure/invitation";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices, BuyerReadRoute, Route } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const TRAN_NGAN_MS = 800;

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

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc = "";
let gocTranNgan = "";
let gocGia = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi {
  readonly u: string;
  readonly s: string;
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo gói, mời, nộp, mở. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER khác người tạo — ký, trả về bằng `rfq.approve`. */
  readonly pm2: Nguoi;
  /** BUYER — `rfq.create`, `rfq.invite`; không `rfq.approve`. */
  readonly nm: Nguoi;
  /** FINANCE — ký phiên bản chính sách; không `rfq.create`. */
  readonly tc: Nguoi;
}
interface NhaCungCap {
  readonly supplierId: string;
  readonly contactId: string;
  readonly email: string;
}
interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// ---- Bộ gửi link do test điều khiển -----------------------------------------------------------
interface LanGui {
  readonly invitationId: string;
  readonly token: string;
  readonly destination: string;
  /** Số token của lời mời thấy được từ MỘT KẾT NỐI KHÁC ngay lúc bộ gửi được gọi — > 0 nghĩa là giao dịch đã commit. */
  readonly tokenDaCommit: number;
}
const bg: {
  hong: Set<string>;
  treo: Set<string>;
  khiGui: ((m: { invitationId: string }) => Promise<void>) | null;
  da: LanGui[];
  goi: string[];
  /** Mốc bắt đầu (ms) của từng lần gọi bộ gửi, theo id lời mời. */
  batDau: Map<string, number>;
  /** Token bộ gửi NHẬN, ghi ngay lúc được gọi — kể cả lần treo, mà lần ấy không bao giờ tới `da`. */
  tokenNhan: Map<string, string>;
} = {
  hong: new Set(),
  treo: new Set(),
  khiGui: null,
  da: [],
  goi: [],
  batDau: new Map(),
  tokenNhan: new Map(),
};

function loiCoTen(ten: string): Error {
  return Object.assign(new Error(`gia lap ${ten}`), { name: ten });
}

async function goi(g: string, method: string, duong: string, cookie: string, than?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = { cookie };
  if (than !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${g}${duong}`, { method, headers, ...(than === undefined ? {} : { body: JSON.stringify(than) }) });
  const van = await res.text();
  return { status: res.status, body: van === "" ? {} : (JSON.parse(van) as Record<string, unknown>) };
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(daBat: boolean): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`lm-${randomBytes(4).toString("hex")}`]);
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
  const t: ToChuc = {
    org,
    pm: await nguoi("PROCUREMENT_MANAGER"),
    pm2: await nguoi("PROCUREMENT_MANAGER"),
    nm: await nguoi("BUYER"),
    tc: await nguoi("FINANCE"),
  };
  await db.pool.query(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
      "VALUES ($1, 1, '100000000.00', 'VND', $2, $3)",
    [org, t.pm.u, t.pm.s],
  );
  if (daBat) await batS3(t);
  return t;
}

/** BẬT S3: phiên bản 2 có bậc, PM tạo, FINANCE ký — khuôn `batS3` của `packages/rfq/src/danh-sach-moi.int.test.ts`. */
async function batS3(t: ToChuc): Promise<void> {
  const v2 = await motId(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, chia_nho_cua_so_ngay, " +
      "tham_dinh_hieu_luc_thang, created_by, created_by_session_id) VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, $3, $4) RETURNING id",
    [t.org, JSON.stringify(BAC), t.pm.u, t.pm.s],
  );
  await db.pool.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
    t.org,
    v2,
    t.tc.u,
    t.tc.s,
  ]);
}

/** Số mặc định của người liên hệ; mỗi phép đo đích theo kênh tự đặt số riêng. */
const SO_MAC_DINH = "0901234567";

async function nhaCungCap(t: ToChuc, soDienThoai: string | null = SO_MAC_DINH): Promise<NhaCungCap> {
  const supplierId = await motId(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
  );
  const email = `lh-${randomBytes(4).toString("hex")}@vidu.vn`;
  const contactId = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi bao gia', $3, $4, $5, $6) RETURNING id",
    [t.org, supplierId, email, soDienThoai, t.pm.u, t.pm.s],
  );
  return { supplierId, contactId, email };
}

/** Gói DRAFT qua route: tạo, một hạng mục, ngân sách dưới ngưỡng kép (một chữ ký). */
async function goiNhap(t: ToChuc): Promise<string> {
  const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const tao = await goi(goc, "POST", "/rfqs", t.pm.cookie, { title: "Mua thep tam", deadlineAt: han });
  expect(tao.status, JSON.stringify(tao.body)).toBe(201);
  const rfqId = (tao.body.rfq as { id: string }).id;
  const hm = await goi(goc, "POST", `/rfqs/${rfqId}/items`, t.pm.cookie, { lineNo: 1, description: "Thep tam", quantity: "10.0000", unit: "tam" });
  expect(hm.status, JSON.stringify(hm.body)).toBe(201);
  const ns = await goi(goc, "PUT", `/rfqs/${rfqId}/budget`, t.pm.cookie, { estimatedValue: "1000000.00", currency: "VND" });
  expect(ns.status, JSON.stringify(ns.body)).toBe(200);
  return rfqId;
}

const moi = (t: ToChuc, rfqId: string, n: NhaCungCap, g = goc, kenh?: "EMAIL" | "SMS" | "ZALO_ZNS"): Promise<PhanHoi> =>
  goi(g, "POST", `/rfqs/${rfqId}/invitations`, t.pm.cookie, {
    supplierId: n.supplierId,
    contactId: n.contactId,
    ...(kenh === undefined ? {} : { linkChannel: kenh }),
  });

async function nopDuyet(t: ToChuc, rfqId: string): Promise<void> {
  const nop = await goi(goc, "POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
  expect(nop.status, JSON.stringify(nop.body)).toBe(200);
  const ky = await goi(goc, "POST", `/rfqs/${rfqId}/approve`, t.pm2.cookie);
  expect(ky.status, JSON.stringify(ky.body)).toBe(200);
}

const mo = (t: ToChuc, rfqId: string, g = goc): Promise<PhanHoi> => goi(g, "POST", `/rfqs/${rfqId}/open`, t.pm.cookie);

async function trangThaiLoiMoi(id: string): Promise<{ status: string; nhan: boolean }> {
  const { rows } = await db.pool.query<{ status: string; nhan: boolean }>(
    "SELECT status, moi_sau_khi_ky AS nhan FROM rfq_invitations WHERE id = $1",
    [id],
  );
  return rows[0]!;
}

interface HangToken {
  readonly song: boolean;
  readonly issuedBy: string;
  /** Token mang giờ không sớm hơn `opened_at` — điều `docToken` của tổ chức đã bật đòi (khoản 253). */
  readonly sauLucMo: boolean;
}
async function tokenCua(invitationId: string): Promise<HangToken[]> {
  const { rows } = await db.pool.query<{ song: boolean; issued_by: string; sau_luc_mo: boolean }>(
    "SELECT t.revoked_at IS NULL AS song, t.issued_by, t.created_at >= p.opened_at AS sau_luc_mo " +
      "FROM rfq_invitation_tokens t JOIN rfq_invitations i ON i.id = t.invitation_id JOIN rfq_packages p ON p.id = i.rfq_id " +
      "WHERE t.invitation_id = $1 ORDER BY t.created_at, t.id",
    [invitationId],
  );
  return rows.map((h) => ({ song: h.song, issuedBy: h.issued_by, sauLucMo: h.sau_luc_mo === true }));
}

async function soDong(org: string, action: string, resourceId?: string): Promise<{ actor: string; payload: unknown; resource: string | null }[]> {
  const { rows } = await db.pool.query<{ actor_id: string; payload: unknown; resource_id: string | null }>(
    "SELECT actor_id, payload, resource_id FROM audit_events WHERE org_id = $1 AND action = $2 AND ($3::uuid IS NULL OR resource_id = $3) ORDER BY seq",
    [org, action, resourceId ?? null],
  );
  return rows.map((h) => ({ actor: h.actor_id, payload: h.payload, resource: h.resource_id }));
}

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

/**
 * Dựng trạng thái bằng câu tay dưới quyền chủ, trigger TẮT — rồi trả ĐÚNG chế độ cũ của từng trigger (`ENABLE ALWAYS` không được
 * rơi về `ENABLE`) trước COMMIT. Khuôn `dungTrangThai` của `loi-moi-sau-commit.int.test.ts`.
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

async function dungServer(dispatcher: ReturnType<typeof createDispatcher>): Promise<string> {
  const server = createApiServer(dispatcher);
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  dongServer.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// ---- Route GIẢ cho ngữ nghĩa của bộ điều phối -------------------------------------------------
const ghiGia: string[] = [];
/** Kết nối của `apiPool` mà lần gửi của `/s3b/giu-pool` giữ — phép đo nhả chúng sau khi có phản hồi. */
const giuKetNoi: pg.PoolClient[] = [];
const ngu = (ms: number): Promise<void> => new Promise<void>((xong) => setTimeout(xong, ms));

/** `ghiKetQua` giả: ghi `nhan` rồi trả `tron` — `false` là *chưa ghi trọn*. */
function ghiGiaTra(nhan: string, tron = true): () => Promise<boolean> {
  return () => {
    ghiGia.push(nhan);
    return Promise.resolve(tron);
  };
}

/** Một loạt gửi giả: khoá trong `hong` thì lần gửi ném, còn lại ghi `gui-<khoá>`. */
function loatGia(khoa: readonly string[], hong: readonly string[]): { khoa: string; gui: () => Promise<void> }[] {
  return khoa.map((k) => ({
    khoa: k,
    gui: () => (hong.includes(k) ? Promise.reject(loiCoTen("LoiGuiGiaLap")) : Promise.resolve(void ghiGia.push(`gui-${k}`))),
  }));
}

function tuyenGia(): Route[] {
  const giaDoc = (path: string, handler: BuyerReadRoute["handler"]): BuyerReadRoute => ({
    method: "GET",
    path,
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler,
  });
  return [
    // Việc có bù TRƯỚC, loạt gửi SAU — phép hỏi của `afterCommitGuiNhieu` phải thấy việc có bù.
    giaDoc("/s3b/co-bu-roi-gui-nhieu", (ctx) => {
      ctx.afterCommitCoBu({
        viec: () => Promise.resolve(void ghiGia.push("viec-co-bu")),
        bu: () => Promise.resolve(),
        phanHoiKhiHong: { status: 502, body: { error: "gia" } },
      });
      ctx.afterCommitGuiNhieu({
        viec: loatGia(["a"], []),
        ghiKetQua: ghiGiaTra("ghi"),
        phanHoi: () => ({ status: 200, body: { ok: true } }),
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    // Hai loạt gửi — lần đăng ký thứ hai phải ném, không đè lần đầu.
    giaDoc("/s3b/gui-nhieu-hai-lan", (ctx) => {
      for (const k of ["a", "b"]) {
        ctx.afterCommitGuiNhieu({
          viec: loatGia([k], []),
          ghiKetQua: ghiGiaTra(`ghi-${k}`),
          phanHoi: () => ({ status: 200, body: { loat: k } }),
        });
      }
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    // Thứ tự: kết quả theo thứ tự đăng ký; `ghiKetQua` trước việc thường; việc thường hỏng bị nuốt, việc sau nó vẫn chạy.
    giaDoc("/s3b/thu-tu", (ctx) => {
      ctx.afterCommit(() => Promise.resolve(void ghiGia.push("thuong-1")));
      ctx.afterCommit(() => Promise.reject(loiCoTen("LoiViecThuongGiaLap")));
      ctx.afterCommit(() => Promise.resolve(void ghiGia.push("thuong-3")));
      ctx.afterCommitGuiNhieu({
        viec: loatGia(["a", "b", "c", "d"], ["b", "d"]),
        ghiKetQua: (_c, kq) => {
          ghiGia.push(`ghi ${kq.daGui.join(",")} | ${kq.chuaGui.join(",")}`);
          return Promise.resolve(true);
        },
        phanHoi: (kq, ghiDuoc) => ({ status: 200, body: { daGui: kq.daGui, chuaGui: kq.chuaGui, ghiDuoc } }),
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    // Mọi lần gửi hỏng mà phản hồi vẫn 2xx (mở gói với cả danh sách gửi hỏng): việc thường VẪN chạy.
    giaDoc("/s3b/hong-het-van-200", (ctx) => {
      ctx.afterCommit(() => Promise.resolve(void ghiGia.push("thuong")));
      ctx.afterCommitGuiNhieu({
        viec: loatGia(["a", "b"], ["a", "b"]),
        ghiKetQua: ghiGiaTra("ghi"),
        phanHoi: (kq) => ({ status: 200, body: { daGui: kq.daGui, chuaGui: kq.chuaGui } }),
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    // Phản hồi lỗi (gửi lại hỏng ⇒ 502): việc thường KHÔNG chạy — cùng luật với việc có bù hỏng.
    giaDoc("/s3b/phan-hoi-502", (ctx) => {
      ctx.afterCommit(() => Promise.resolve(void ghiGia.push("thuong")));
      ctx.afterCommitGuiNhieu({
        viec: loatGia(["a"], ["a"]),
        ghiKetQua: ghiGiaTra("ghi"),
        phanHoi: () => ({ status: 502, body: { error: "gia 502" } }),
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    // Lần gửi GIỮ HẾT pool nghiệp vụ: lần lấy kết nối của `ghiKetQua` phải gãy ở trần 5 s, không chờ 20 s của pool.
    giaDoc("/s3b/giu-pool", (ctx) => {
      ctx.afterCommitGuiNhieu({
        viec: [
          {
            khoa: "a",
            gui: async () => {
              for (let i = 0; i < 4; i += 1) giuKetNoi.push(await apiPool.connect());
            },
          },
        ],
        ghiKetQua: ghiGiaTra("ghi"),
        phanHoi: (kq, ghiDuoc) => ({ status: 200, body: { daGui: kq.daGui, chuaGui: kq.chuaGui, ghiDuoc } }),
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    // `ghiKetQua` KHÔNG ném mà trả `false` (chưa ghi trọn) ⇒ `ghiDuoc = false` và một dòng `ghi-ket-qua-gui GhiChuaTron`.
    giaDoc("/s3b/ghi-chua-tron", (ctx) => {
      ctx.afterCommitGuiNhieu({
        viec: loatGia(["a"], []),
        ghiKetQua: ghiGiaTra("ghi", false),
        phanHoi: (kq, ghiDuoc) => ({ status: 200, body: { daGui: kq.daGui, chuaGui: kq.chuaGui, ghiDuoc } }),
      });
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    {
      method: "GET",
      path: "/s3b/gui-roi-422",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: (ctx) => {
        ctx.afterCommitGuiNhieu({
          viec: [{ khoa: "a", gui: () => Promise.resolve(void ghiGia.push("gui-a")) }],
          ghiKetQua: ghiGiaTra("ghi"),
          phanHoi: () => ({ status: 200, body: { ok: true } }),
        });
        return Promise.resolve({ status: 422, body: { error: "gia 422" } });
      },
    },
    {
      method: "GET",
      path: "/s3b/hai-viec-quyet-phan-hoi",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: (ctx) => {
        ctx.afterCommitGuiNhieu({
          viec: [{ khoa: "a", gui: () => Promise.resolve(void ghiGia.push("gui-a")) }],
          ghiKetQua: ghiGiaTra("ghi"),
          phanHoi: () => ({ status: 200, body: { ok: true } }),
        });
        ctx.afterCommitCoBu({
          viec: () => Promise.resolve(void ghiGia.push("viec-co-bu")),
          bu: () => Promise.resolve(),
          phanHoiKhiHong: { status: 502, body: { error: "gia" } },
        });
        return Promise.resolve({ status: 200, body: { ok: true } });
      },
    },
    {
      method: "GET",
      path: "/s3b/ghi-hong",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: (ctx) => {
        ctx.afterCommit(() => Promise.resolve(void ghiGia.push("thuong")));
        ctx.afterCommitGuiNhieu({
          viec: [
            { khoa: "a", gui: () => Promise.resolve(void ghiGia.push("gui-a")) },
            { khoa: "b", gui: () => Promise.reject(loiCoTen("LoiGuiGiaLap")) },
          ],
          ghiKetQua: () => Promise.reject(loiCoTen("LoiGhiGiaLap")),
          phanHoi: (kq, ghiDuoc) => ({ status: 200, body: { daGui: kq.daGui, chuaGui: kq.chuaGui, ghiDuoc } }),
        });
        return Promise.resolve({ status: 200, body: { ok: true } });
      },
    },
  ];
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = createPool(db.connectionString, 4, { role: "app_api" });
  auditPool = createPool(db.connectionString, 4, { role: "app_api" });
  const dv = dichVuTest();
  const services: ApiServices = {
    ...dv.services,
    invitationLinkSender: {
      name: "bo-gui-dieu-khien-s3b",
      send: async (m) => {
        bg.goi.push(m.invitationId);
        bg.batDau.set(m.invitationId, Date.now());
        bg.tokenNhan.set(m.invitationId, m.token);
        const tokenDaCommit = (
          await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitation_tokens WHERE invitation_id = $1", [m.invitationId])
        ).rows[0]!.n;
        const khiGui = bg.khiGui;
        if (khiGui !== null) {
          bg.khiGui = null;
          await khiGui(m);
        }
        if (bg.treo.has(m.destination)) await new Promise<void>(() => undefined);
        if (bg.hong.has(m.destination)) throw loiCoTen("LoiGuiGiaLap");
        bg.da.push({ invitationId: m.invitationId, token: m.token, destination: m.destination, tokenDaCommit });
      },
    },
  };
  goc = await dungServer(createDispatcher({ pool: apiPool, auditPool, services }));
  gocTranNgan = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, afterCommitTimeoutMs: TRAN_NGAN_MS }));
  gocGia = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, routes: tuyenGia() }));
}, 180000);

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

function datLaiBoGui(): void {
  bg.hong.clear();
  bg.treo.clear();
  bg.khiGui = null;
  bg.da.length = 0;
  bg.goi.length = 0;
  bg.batDau.clear();
  bg.tokenNhan.clear();
}

// =============================================================================================
// ⑴ ⑵ ⑶ — LINK ĐI LÚC MỞ GÓI
// =============================================================================================
describe("[S1.9101 / S3.2b] tổ chức đã bật: link mời đi lúc MỞ GÓI, sau commit, mỗi lời mời một lần", () => {
  it("[INV-K6] mời ở DRAFT: 201 `UNSENT`, không token, bộ gửi không được gọi; mở gói: MỘT token mỗi lời mời CÒN SỐNG, đúc bởi phiên người mở trong giao dịch mở, link đi SAU commit — 200 liệt kê, lời mời `SENT`", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const [a, b, c] = [await nhaCungCap(t), await nhaCungCap(t), await nhaCungCap(t)];
    const ids: string[] = [];
    for (const n of [a, b, c]) {
      const r = await moi(t, rfqId, n);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const inv = r.body.invitation as { id: string; status: string; moiSauKhiKy: boolean };
      expect([inv.status, inv.moiSauKhiKy]).toEqual(["UNSENT", false]);
      ids.push(inv.id);
    }
    expect(bg.goi, "ở DRAFT không link nào đi").toEqual([]);
    for (const id of ids) expect(await tokenCua(id), "ở DRAFT không token nào (K6)").toEqual([]);
    // Thu hồi ở DRAFT đi qua (K4a) — lời mời ấy không được đúc token lúc mở.
    const bo = await goi(goc, "POST", `/invitations/${ids[2]}/revoke`, t.pm.cookie);
    expect(bo.status, JSON.stringify(bo.body)).toBe(200);

    await nopDuyet(t, rfqId);
    const r = await mo(t, rfqId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lm = r.body.linkMoi as { daGui: string[]; chuaGui: string[] };
    expect([...lm.daGui].sort()).toEqual([ids[0], ids[1]].sort());
    expect(lm.chuaGui).toEqual([]);
    expect([...bg.goi].sort(), "mỗi lời mời còn sống đúng MỘT lần gửi; lời mời đã thu hồi không").toEqual([ids[0], ids[1]].sort());
    for (const lan of bg.da) expect(lan.tokenDaCommit, "bộ gửi được gọi khi token ĐÃ commit").toBe(1);
    for (const id of [ids[0]!, ids[1]!]) {
      expect(await trangThaiLoiMoi(id)).toEqual({ status: "SENT", nhan: false });
      expect(await tokenCua(id)).toEqual([{ song: true, issuedBy: t.pm.u, sauLucMo: true }]);
    }
    // Đúc trong CHÍNH giao dịch mở gói: token và phiên bản hàng gói mà lần mở ghi mang cùng `xmin`.
    const { rows: cungGd } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM rfq_invitation_tokens t JOIN rfq_packages p ON p.id = $1 " +
        "WHERE t.invitation_id = ANY ($2::uuid[]) AND t.xmin::text = p.xmin::text",
      [rfqId, [ids[0], ids[1]]],
    );
    expect(cungGd[0]?.n, "hai token đúc trong giao dịch mở gói").toBe(2);
    expect(await tokenCua(ids[2]!)).toEqual([]);
    const phat = await soDong(t.org, "MAGIC_LINK_TOKEN_ISSUED");
    expect(phat.map((x) => x.actor), "hàng sổ đúc token mang người mở").toEqual([t.pm.u, t.pm.u]);
    // Danh sách lời mời đọc được nhãn và trạng thái.
    const ds = await goi(goc, "GET", `/rfqs/${rfqId}/invitations`, t.pm.cookie);
    const theoId = new Map((ds.body.invitations as { id: string; status: string; moiSauKhiKy: boolean }[]).map((x) => [x.id, x]));
    expect(theoId.get(ids[0]!)).toMatchObject({ status: "SENT", moiSauKhiKy: false });
    expect(theoId.get(ids[2]!)).toMatchObject({ status: "REVOKED" });
  });

  it("[INV-K6] token lúc mở do PHIÊN NGƯỜI MỞ đúc, không phải phiên người mời: BUYER mời ở DRAFT, PM mở ⇒ token và hàng sổ mang PM", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const n = await nhaCungCap(t);
    const r = await goi(goc, "POST", `/rfqs/${rfqId}/invitations`, t.nm.cookie, { supplierId: n.supplierId, contactId: n.contactId });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = (r.body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);
    expect((await tokenCua(id)).map((x) => x.issuedBy), "người đúc là người MỞ").toEqual([t.pm.u]);
    expect((await soDong(t.org, "MAGIC_LINK_TOKEN_ISSUED")).map((x) => x.actor)).toEqual([t.pm.u]);
  });

  it("[INV-K6] gửi hỏng lúc mở gói: vẫn 200, `chuaGui` nêu đúng lời mời; token của nó bị thu hồi (`LINK_SEND_FAILED`), lời mời ở lại `UNSENT` và KHÔNG bị thu hồi; gửi lại ⇒ `SENT`", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const [a, b] = [await nhaCungCap(t), await nhaCungCap(t)];
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    const idB = ((await moi(t, rfqId, b)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.hong.add(b.email);
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await mo(t, rfqId);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.linkMoi).toEqual({ daGui: [idA], chuaGui: [idB] });
    expect((r.body.rfq as { status: string }).status).toBe("OPEN");
    expect(log.log.filter((d) => d.includes("sau-commit"))).toHaveLength(1);
    expect(await trangThaiLoiMoi(idA)).toEqual({ status: "SENT", nhan: false });
    expect(await trangThaiLoiMoi(idB), "không thu hồi lời mời — thu hồi thu hẹp danh sách đã ký").toEqual({ status: "UNSENT", nhan: false });
    expect(await tokenCua(idB), "token của lần gửi hỏng chết ngay: UNSENT nghĩa là không link sống").toEqual([
      { song: false, issuedBy: t.pm.u, sauLucMo: true },
    ]);
    const thuHoi = await soDong(t.org, "MAGIC_LINK_TOKEN_REVOKED");
    expect(thuHoi.map((x) => x.payload)).toEqual([{ invitationId: idB, reason: "LINK_SEND_FAILED" }]);

    bg.hong.clear();
    const lai = await goi(goc, "POST", `/invitations/${idB}/reissue`, t.pm.cookie);
    expect(lai.status, JSON.stringify(lai.body)).toBe(200);
    expect(lai.body).toEqual({ reissued: true });
    expect(await trangThaiLoiMoi(idB)).toEqual({ status: "SENT", nhan: false });
    expect((await tokenCua(idB)).map((x) => x.song)).toEqual([false, true]);
  });

  it("[INV-K6] gửi lại lời mời chưa gửi mà vẫn hỏng: 502 như ADR-110, lời mời ở lại `UNSENT`, token mới cũng bị thu hồi", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const a = await nhaCungCap(t);
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.hong.add(a.email);
    const log = batLog();
    try {
      expect((await mo(t, rfqId)).body.linkMoi).toEqual({ daGui: [], chuaGui: [idA] });
      const lai = await goi(goc, "POST", `/invitations/${idA}/reissue`, t.pm.cookie);
      expect(lai.status, JSON.stringify(lai.body)).toBe(502);
      expect(lai.body).toEqual({ error: "khong gui duoc link moi; link moi da thu hoi, link cu chua dung da het hieu luc" });
    } finally {
      log.tra();
    }
    expect(await trangThaiLoiMoi(idA)).toEqual({ status: "UNSENT", nhan: false });
    expect((await tokenCua(idA)).map((x) => x.song)).toEqual([false, false]);
  });

  it("[INV-K6] mời THÊM khi gói đã OPEN: 201, nhãn *mời sau khi ký*, link đi ngay sau commit ⇒ `SENT`; gửi hỏng ⇒ vẫn 201, `UNSENT`, token thu hồi, lời mời còn sống", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await nhaCungCap(t));
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);

    const c = await nhaCungCap(t);
    const r = await moi(t, rfqId, c);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inv = r.body.invitation as { id: string; status: string; moiSauKhiKy: boolean };
    expect([inv.status, inv.moiSauKhiKy]).toEqual(["SENT", true]);
    expect(r.body.linkMoi).toEqual({ daGui: [inv.id], chuaGui: [] });
    expect(await trangThaiLoiMoi(inv.id)).toEqual({ status: "SENT", nhan: true });
    // Bản ghi lời mời của lối gửi lại mang nhãn thật — kiểu khai `boolean`, không `undefined` (lượt soi S1.9101).
    const kq = await withTenant(apiPool, t.org, (k) => reissueInvitationLink(k, t.org, { invitationId: inv.id, actorSessionId: t.pm.s }));
    expect(kq.ok && [kq.invitation.status, kq.invitation.moiSauKhiKy]).toEqual(["SENT", true]);

    const d = await nhaCungCap(t);
    bg.hong.add(d.email);
    const log = batLog();
    let r2: PhanHoi;
    try {
      r2 = await moi(t, rfqId, d);
    } finally {
      log.tra();
    }
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const inv2 = r2.body.invitation as { id: string; status: string };
    expect(inv2.status).toBe("UNSENT");
    expect(r2.body.linkMoi).toEqual({ daGui: [], chuaGui: [inv2.id] });
    expect(await trangThaiLoiMoi(inv2.id)).toEqual({ status: "UNSENT", nhan: true });
    expect((await tokenCua(inv2.id)).map((x) => x.song)).toEqual([false]);
    const { rows } = await db.pool.query<{ song: boolean }>("SELECT revoked_at IS NULL AS song FROM rfq_invitations WHERE id = $1", [inv2.id]);
    expect(rows[0]?.song, "lời mời không bị thu hồi — khác [S1.70] của MVP1").toBe(true);
  });

  it("[INV-K6] bộ điều phối: mỗi lần gửi MỘT trần, SONG SONG — hai lần treo bắt đầu cùng lúc và cùng thành `chuaGui` sau một trần, lần kia vẫn `daGui`; mỗi lời mời đúng một lần gọi, không thử lại", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const [a, b, c] = [await nhaCungCap(t), await nhaCungCap(t), await nhaCungCap(t)];
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    const idB = ((await moi(t, rfqId, b)).body.invitation as { id: string }).id;
    const idC = ((await moi(t, rfqId, c)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.treo.add(b.email);
    bg.treo.add(c.email);
    const log = batLog();
    let r: PhanHoi;
    const batDau = Date.now();
    try {
      r = await mo(t, rfqId, gocTranNgan);
    } finally {
      log.tra();
    }
    const daCho = Date.now() - batDau;
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Cả loạt xong trong khoảng MỘT trần: không sớm hơn trần (hai lần treo chờ hết nó), và xa dưới ba trần.
    expect(daCho).toBeGreaterThanOrEqual(TRAN_NGAN_MS);
    expect(daCho, "cả loạt xong trong khoảng một trần").toBeLessThan(TRAN_NGAN_MS * 2.8);
    const lm = r.body.linkMoi as { daGui: string[]; chuaGui: string[] };
    expect(lm.daGui).toEqual([idA]);
    expect([...lm.chuaGui].sort()).toEqual([idB, idC].sort());
    // Tuần tự thì lần treo thứ hai chỉ bắt đầu SAU trần của lần thứ nhất (≥ 800 ms); song song thì cách nhau vài ms.
    const lech = Math.abs(bg.batDau.get(idB)! - bg.batDau.get(idC)!);
    expect(lech, "hai lần treo phải bắt đầu cùng lúc — gửi song song, mỗi lần một trần").toBeLessThan(TRAN_NGAN_MS / 2);
    expect(log.log.filter((d) => d.includes("sau-commit") && d.includes("SauCommitQuaHan"))).toHaveLength(2);
    for (const id of [idB, idC]) {
      expect(bg.goi.filter((x) => x === id), "at-most-once: không thử lại").toHaveLength(1);
      expect(await trangThaiLoiMoi(id)).toEqual({ status: "UNSENT", nhan: false });
      expect((await tokenCua(id)).map((x) => x.song)).toEqual([false]);
    }
  });

  it("gói bị huỷ giữa lần gửi và lần đặt `SENT`: 200 mang `trangThaiChuaGhi`, một dòng `ghi-ket-qua-gui`; lời mời ở lại `UNSENT`", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const idA = ((await moi(t, rfqId, await nhaCungCap(t))).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.khiGui = async () => {
      const huy = await goi(goc, "POST", `/rfqs/${rfqId}/cancel`, t.pm.cookie, { reason: "huy giua luc gui" });
      expect(huy.status, JSON.stringify(huy.body)).toBe(200);
    };
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await mo(t, rfqId);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.linkMoi).toEqual({ daGui: [idA], chuaGui: [], trangThaiChuaGhi: true });
    expect(log.log.filter((d) => d.includes("ghi-ket-qua-gui GhiChuaTron"))).toHaveLength(1);
    expect(await trangThaiLoiMoi(idA)).toEqual({ status: "UNSENT", nhan: false });
    expect((await tokenCua(idA)).map((x) => x.song), "không đặt được SENT ⇒ token cũng chết: *chưa gửi* là không link sống").toEqual([false]);
    expect((await soDong(t.org, "MAGIC_LINK_TOKEN_REVOKED")).map((x) => x.payload), "link đã đi: lý do không phải gửi hỏng").toEqual([
      { invitationId: idA, reason: "RFQ_LEFT_OPEN" },
    ]);
  });

  it("[INV-K6] lần gửi QUÁ TRẦN mà vẫn tới tay, và gói bị huỷ giữa loạt gửi: lời mời ấy vẫn bị thu hồi token — lần đặt `SENT` bị K6 từ chối không kéo lần thu hồi rollback theo (lượt soi S1.9101)", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const [a, b] = [await nhaCungCap(t), await nhaCungCap(t)];
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    const idB = ((await moi(t, rfqId, b)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.treo.add(b.email);
    bg.khiGui = async () => {
      const huy = await goi(goc, "POST", `/rfqs/${rfqId}/cancel`, t.pm.cookie, { reason: "huy giua loat gui" });
      expect(huy.status, JSON.stringify(huy.body)).toBe(200);
    };
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await mo(t, rfqId, gocTranNgan);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.linkMoi).toEqual({ daGui: [idA], chuaGui: [idB], trangThaiChuaGhi: true });
    for (const id of [idA, idB]) {
      expect(await trangThaiLoiMoi(id)).toEqual({ status: "UNSENT", nhan: false });
      expect((await tokenCua(id)).map((x) => x.song), `${id === idA ? "A" : "B"}: không link sống`).toEqual([false]);
    }
    const lyDo = (await soDong(t.org, "MAGIC_LINK_TOKEN_REVOKED")).map((x) => x.payload as { invitationId: string; reason: string });
    expect(new Map(lyDo.map((x) => [x.invitationId, x.reason]))).toEqual(
      new Map([
        [idA, "RFQ_LEFT_OPEN"],
        [idB, "LINK_SEND_FAILED"],
      ]),
    );
    const tokenB = bg.tokenNhan.get(idB)!;
    const doiB = await withTenant(apiPool, t.org, (c) => redeemMagicLink(c, t.org, tokenB)).catch((e: unknown) => e);
    expect(doiB, "link quá trần tới tay người nhận là link chết").toBeInstanceOf(InvitationError);
  });

  it("[INV-K6] mời THÊM ở OPEN rồi gói bị huỷ giữa lần gửi và lần đặt `SENT`: 201 nói lời mời `UNSENT` kèm `trangThaiChuaGhi` — không nói `SENT` cho một trạng thái chưa ghi", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await nhaCungCap(t));
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);
    const c = await nhaCungCap(t);
    bg.khiGui = async () => {
      const huy = await goi(goc, "POST", `/rfqs/${rfqId}/cancel`, t.pm.cookie, { reason: "huy giua luc gui" });
      expect(huy.status, JSON.stringify(huy.body)).toBe(200);
    };
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await moi(t, rfqId, c);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inv = r.body.invitation as { id: string; status: string };
    expect(inv.status, "link đã đi nhưng trạng thái chưa ghi được").toBe("UNSENT");
    expect(r.body.linkMoi).toEqual({ daGui: [inv.id], chuaGui: [], trangThaiChuaGhi: true });
    expect(await trangThaiLoiMoi(inv.id)).toEqual({ status: "UNSENT", nhan: true });
    expect((await tokenCua(inv.id)).map((x) => x.song)).toEqual([false]);
    expect(log.log.filter((d) => d.includes("ghi-ket-qua-gui GhiChuaTron"))).toHaveLength(1);
  });

  it("[INV-K6] mời qua SMS/ZNS mà người liên hệ không có số ⇒ 422, không lời mời nào, không hàng sổ nào — không thì lời mời kẹt trong danh sách đã ký (lượt soi S1.9101)", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const b = await nhaCungCap(t, null);
    for (const kenh of ["SMS", "ZALO_ZNS"] as const) {
      const r = await moi(t, rfqId, b, goc, kenh);
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      expect(r.body).toEqual({ error: "nguoi lien he khong co so dien thoai cho kenh cua loi moi" });
    }
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitations WHERE supplier_id = $1", [b.supplierId]);
    expect(rows[0]?.n).toBe(0);
    expect(await soDong(t.org, "INVITATION_CREATED"), "giao dịch rollback trọn").toEqual([]);
    expect((await moi(t, rfqId, b)).status, "cùng người liên hệ, kênh EMAIL ⇒ mời được").toBe(201);

    // Ca OPEN — chính ca mà lời mời kẹt vĩnh viễn nếu lọt: mời THÊM qua SMS cho người liên hệ không có số ⇒ cũng 422.
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);
    const c = await nhaCungCap(t, null);
    const rc = await moi(t, rfqId, c, goc, "SMS");
    expect(rc.status, JSON.stringify(rc.body)).toBe(422);
    const { rows: sau } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitations WHERE supplier_id = $1", [c.supplierId]);
    expect(sau[0]?.n, "ở OPEN cũng không lời mời nào").toBe(0);
  });

  it("[INV-K6] đích theo kênh: link SMS/ZNS đi tới SỐ của người liên hệ — lúc mở gói, lúc gửi lại, lúc mời thêm ở OPEN; người liên hệ không có số ⇒ bộ gửi KHÔNG được gọi, lời mời vào `chuaGui`, token thu hồi", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const [a, b, c] = [await nhaCungCap(t, "0911111111"), await nhaCungCap(t, null), await nhaCungCap(t, "0933333333")];
    const idA = ((await moi(t, rfqId, a, goc, "SMS")).body.invitation as { id: string }).id;
    // Route trả 422 cho kênh không đích (phép đo kế tiếp); lời mời này dựng ở tầng gói để đo lớp phòng thứ hai ở bộ gửi.
    const idB = await withTenant(apiPool, t.org, async (k) =>
      (
        await createInvitation(
          k,
          t.org,
          { rfqId, supplierId: b.supplierId, contactId: b.contactId, linkChannel: "SMS", actorSessionId: t.pm.s },
          auditPool,
        )
      ).id,
    );
    const idC = ((await moi(t, rfqId, c, goc, "ZALO_ZNS")).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.hong.add("0933333333");
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await mo(t, rfqId);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lm = r.body.linkMoi as { daGui: string[]; chuaGui: string[] };
    expect(lm.daGui).toEqual([idA]);
    expect([...lm.chuaGui].sort()).toEqual([idB, idC].sort());
    expect(bg.da.map((x) => [x.invitationId, x.destination]), "SMS đi tới số, không tới email").toEqual([[idA, "0911111111"]]);
    expect(bg.goi.includes(idB), "đích rỗng không tới bộ gửi").toBe(false);
    expect(log.log.filter((d) => d.includes("sau-commit KhongCoDichGuiLink"))).toHaveLength(1);
    expect(await trangThaiLoiMoi(idB)).toEqual({ status: "UNSENT", nhan: false });
    expect((await tokenCua(idB)).map((x) => x.song), "không đích thì token cũng chết").toEqual([false]);

    datLaiBoGui();
    const lai = await goi(goc, "POST", `/invitations/${idC}/reissue`, t.pm.cookie);
    expect(lai.status, JSON.stringify(lai.body)).toBe(200);
    expect(bg.da.map((x) => [x.invitationId, x.destination]), "gửi lại lời mời ZNS chưa gửi: đúng số ấy").toEqual([[idC, "0933333333"]]);
    expect(await trangThaiLoiMoi(idC)).toEqual({ status: "SENT", nhan: false });

    datLaiBoGui();
    const rd = await moi(t, rfqId, await nhaCungCap(t, "0944444444"), goc, "SMS");
    expect(rd.status, JSON.stringify(rd.body)).toBe(201);
    const idD = (rd.body.invitation as { id: string }).id;
    expect(bg.da.map((x) => [x.invitationId, x.destination]), "mời thêm ở OPEN qua SMS: số của người liên hệ mới").toEqual([[idD, "0944444444"]]);
  });

  it("[INV-K6] gửi lại lời mời chưa gửi, gửi ĐƯỢC mà gói bị huỷ trước lần đặt `SENT`: 200 mang `trangThaiChuaGhi`, lời mời ở lại `UNSENT`", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const a = await nhaCungCap(t);
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.hong.add(a.email);
    const log = batLog();
    let lai: PhanHoi;
    try {
      expect((await mo(t, rfqId)).body.linkMoi).toEqual({ daGui: [], chuaGui: [idA] });
      bg.hong.clear();
      bg.khiGui = async () => {
        const huy = await goi(goc, "POST", `/rfqs/${rfqId}/cancel`, t.pm.cookie, { reason: "huy giua luc gui lai" });
        expect(huy.status, JSON.stringify(huy.body)).toBe(200);
      };
      lai = await goi(goc, "POST", `/invitations/${idA}/reissue`, t.pm.cookie);
    } finally {
      log.tra();
    }
    expect(lai.status, JSON.stringify(lai.body)).toBe(200);
    expect(lai.body).toEqual({ reissued: true, trangThaiChuaGhi: true });
    expect(log.log.filter((d) => d.includes("ghi-ket-qua-gui GhiChuaTron"))).toHaveLength(1);
    expect(await trangThaiLoiMoi(idA)).toEqual({ status: "UNSENT", nhan: false });
    expect((await tokenCua(idA)).map((x) => x.song), "không đặt được SENT ⇒ token mới cũng chết").toEqual([false, false]);
  });

  it("[INV-K6] gửi lại lời mời CHƯA GỬI khi gói ở BAFO_OPEN ⇒ 409 không gửi gì — K6 chỉ cho `UNSENT→SENT` ở OPEN; lời mời ĐÃ gửi thì vẫn gửi lại được (lượt soi S1.9101)", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const [a, b] = [await nhaCungCap(t), await nhaCungCap(t)];
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    const idB = ((await moi(t, rfqId, b)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.hong.add(b.email);
    const log = batLog();
    try {
      expect((await mo(t, rfqId)).body.linkMoi).toEqual({ daGui: [idA], chuaGui: [idB] });
    } finally {
      log.tra();
    }
    // Dựng BAFO_OPEN bằng câu tay (khuôn `dungTrangThai` của `loi-moi-sau-commit`): vòng BAFO đang mở, hạn vòng còn — đúng hai vế
    // `con_han` của lối gửi lại, nên lời mời ĐÃ gửi vẫn gửi lại được (đối chứng).
    const cs = (await db.pool.query<{ id: string }>("SELECT id FROM org_procurement_policies WHERE org_id = $1 ORDER BY version DESC LIMIT 1", [t.org])).rows[0]!.id;
    await dungTrangThai(["public.rfq_packages", "public.rfq_bafo_rounds"], [
      ["UPDATE rfq_packages SET status = 'BAFO_OPEN', closed_at = now() WHERE id = $1", [rfqId]],
      [
        "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, round_no, deadline_at, opened_by, opened_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 2, 1, now() + interval '1 day', $5, $6)",
        [t.org, rfqId, randomUUID(), cs, t.pm.u, t.pm.s],
      ],
    ]);
    datLaiBoGui();
    const laiB = await goi(goc, "POST", `/invitations/${idB}/reissue`, t.pm.cookie);
    expect(laiB.status, JSON.stringify(laiB.body)).toBe(409);
    expect(laiB.body).toEqual({ error: "goi thau khong nhan bao gia" });
    expect(bg.goi, "lời mời chưa gửi ở BAFO_OPEN: không link nào đi").toEqual([]);
    expect((await tokenCua(idB)).map((x) => x.song)).toEqual([false]);
    const laiA = await goi(goc, "POST", `/invitations/${idA}/reissue`, t.pm.cookie);
    expect(laiA.status, JSON.stringify(laiA.body)).toBe(200);
    expect(bg.goi).toEqual([idA]);
  });

  it("[INV-K6] gửi lại lời mời chưa gửi: gửi hỏng MÀ phần ghi cũng hỏng (phiên người gọi bị thu hồi giữa chừng) ⇒ 500 như ADR-110 — token mới chưa thu hồi được, và thân 500 nói đúng thế", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const a = await nhaCungCap(t);
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    bg.hong.add(a.email);
    const log = batLog();
    let lai: PhanHoi;
    try {
      expect((await mo(t, rfqId)).body.linkMoi).toEqual({ daGui: [], chuaGui: [idA] });
      bg.khiGui = async () => {
        await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [t.pm.s]);
      };
      lai = await goi(goc, "POST", `/invitations/${idA}/reissue`, t.pm.cookie);
    } finally {
      log.tra();
    }
    expect(lai.status, JSON.stringify(lai.body)).toBe(500);
    expect(lai.body).toEqual({ error: "khong gui duoc link moi va chua thu hoi duoc link moi" });
    expect(log.log.filter((d) => d.includes("ghi-ket-qua-gui"))).toHaveLength(1);
    expect(await trangThaiLoiMoi(idA)).toEqual({ status: "UNSENT", nhan: false });
    expect((await tokenCua(idA)).map((x) => x.song), "token mới còn sống — đúng điều thân 500 nói").toEqual([false, true]);
  });
});

// =============================================================================================
// ⑷ — K4a VÀO SỔ: CONTROL_DENIED
// =============================================================================================
describe("[S1.9101 / S3.2b] K4a qua route: lần thêm hay thu hồi sai trạng thái để lại MỘT hàng `CONTROL_DENIED`", () => {
  it("[INV-K4a] mời khi gói PENDING_APPROVAL ⇒ 422 thông điệp của bảng, `CONTROL_DENIED` {ma}, không lời mời nào; thu hồi khi gói OPEN ⇒ 422, `CONTROL_DENIED` {ma} mang toạ độ GÓI", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const idA = ((await moi(t, rfqId, await nhaCungCap(t))).body.invitation as { id: string }).id;
    const nop = await goi(goc, "POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
    expect(nop.status).toBe(200);

    const b = await nhaCungCap(t);
    const them = await moi(t, rfqId, b);
    expect(them.status, JSON.stringify(them.body)).toBe(422);
    expect(them.body).toEqual({ error: CHOT_VAO_SO.K4A_THEM_SAI_TRANG_THAI.thongDiep });
    expect(await soDong(t.org, "CONTROL_DENIED", rfqId)).toEqual([{ actor: t.pm.u, payload: { ma: "K4A_THEM_SAI_TRANG_THAI" }, resource: rfqId }]);
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitations WHERE supplier_id = $1", [b.supplierId]);
    expect(rows[0]?.n).toBe(0);

    const boCho = await goi(goc, "POST", `/invitations/${idA}/revoke`, t.pm.cookie);
    expect(boCho.status).toBe(422);
    expect(boCho.body).toEqual({ error: CHOT_VAO_SO.K4A_THU_HOI_SAI_TRANG_THAI.thongDiep });

    const ky = await goi(goc, "POST", `/rfqs/${rfqId}/approve`, t.pm2.cookie);
    expect(ky.status).toBe(200);
    expect((await mo(t, rfqId)).status).toBe(200);
    const bo = await goi(goc, "POST", `/invitations/${idA}/revoke`, t.pm.cookie);
    expect(bo.status, JSON.stringify(bo.body)).toBe(422);
    expect(bo.body).toEqual({ error: CHOT_VAO_SO.K4A_THU_HOI_SAI_TRANG_THAI.thongDiep });
    expect((await soDong(t.org, "CONTROL_DENIED", rfqId)).map((x) => x.payload)).toEqual([
      { ma: "K4A_THEM_SAI_TRANG_THAI" },
      { ma: "K4A_THU_HOI_SAI_TRANG_THAI" },
      { ma: "K4A_THU_HOI_SAI_TRANG_THAI" },
    ]);
    expect(await trangThaiLoiMoi(idA)).toMatchObject({ status: "SENT" });
  });

  it("[INV-K4a] ĐỐI CHỨNG: tổ chức chưa bật mời ở PENDING_APPROVAL và thu hồi ở OPEN như MVP1 — không hàng `CONTROL_DENIED` nào", async () => {
    datLaiBoGui();
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    await nopDuyet(t, rfqId);
    const r = await moi(t, rfqId, await nhaCungCap(t));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const inv = r.body.invitation as { id: string; status: string };
    expect(inv.status, "MVP1: SENT từ lúc chèn").toBe("SENT");
    expect(r.body.linkMoi, "MVP1 giữ thân [S1.70]").toBeUndefined();
    const moGoi = await mo(t, rfqId);
    expect(moGoi.status).toBe(200);
    expect(Object.keys(moGoi.body), "MVP1 giữ thân mở gói: không `linkMoi` — link đã đi lúc mời (spec §8.11)").toEqual(["rfq"]);
    const bo = await goi(goc, "POST", `/invitations/${inv.id}/revoke`, t.pm.cookie);
    expect(bo.status).toBe(200);
    expect(await soDong(t.org, "CONTROL_DENIED")).toEqual([]);
  });

  it("[INV-K4a] tên ràng buộc hai chiều: mọi tên `k4a_…` trong thân trigger THẬT có dòng ở `CHOT_THEO_RANG_BUOC`, và ngược lại; ĐỘT BIẾN gỡ tên ⇒ 422 mang câu của trigger, KHÔNG hàng sổ nào", async () => {
    const def = (await db.pool.query<{ d: string }>("SELECT pg_get_functiondef('public.rfq_invitations_kiem_danh_sach()'::regprocedure) AS d")).rows[0]!.d;
    const trongThan = [...def.matchAll(/CONSTRAINT = '([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    const trongBang = Object.keys(CHOT_THEO_RANG_BUOC).filter((k) => k.startsWith("k4a_")).sort();
    expect(trongThan).toEqual(trongBang);
    expect(trongThan).toEqual(["k4a_them_sai_trang_thai", "k4a_thu_hoi_sai_trang_thai"]);

    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    await goi(goc, "POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
    await db.pool.query(def.replace(", CONSTRAINT = 'k4a_them_sai_trang_thai'", ""));
    try {
      const them = await moi(t, rfqId, await nhaCungCap(t));
      expect(them.status).toBe(422);
      expect(them.body).toEqual({ error: "Goi thau o PENDING_APPROVAL khong them loi moi duoc — chi o DRAFT, hoac OPEN (K4a)" });
      expect(await soDong(t.org, "CONTROL_DENIED"), "đột biến: mất tên là mất hàng sổ").toEqual([]);
    } finally {
      await db.pool.query(def);
    }
  });
});

// =============================================================================================
// ⑸ — ROUTE return-to-draft
// =============================================================================================
describe("[S1.9101 / S3.2b] `POST /rfqs/:rfqId/return-to-draft`", () => {
  it("người tạo ⇒ 200 DRAFT; BUYER không phải người tạo ⇒ 403, `PERMISSION_DENIED` mang `rfq.approve`; FINANCE ⇒ 403 ở bộ điều phối (`rfq.create`); thiếu lý do ⇒ 422", async () => {
    const t = await toChucVaGoiChoDuyet(true);
    const nm = await goi(goc, "POST", `/rfqs/${t.rfqId}/return-to-draft`, t.nm.cookie, { reason: "sua" });
    expect(nm.status).toBe(403);
    const tc = await goi(goc, "POST", `/rfqs/${t.rfqId}/return-to-draft`, t.tc.cookie, { reason: "sua" });
    expect(tc.status).toBe(403);
    expect((await soDong(t.org, "PERMISSION_DENIED", t.rfqId)).map((x) => [x.actor, (x.payload as { permission: string }).permission])).toEqual([
      [t.nm.u, "rfq.approve"],
      [t.tc.u, "rfq.create"],
    ]);
    const thieu = await goi(goc, "POST", `/rfqs/${t.rfqId}/return-to-draft`, t.pm.cookie, {});
    expect(thieu.status).toBe(422);
    const r = await goi(goc, "POST", `/rfqs/${t.rfqId}/return-to-draft`, t.pm.cookie, { reason: "them nha cung cap" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body.rfq as { status: string }).status).toBe("DRAFT");
    expect((await soDong(t.org, "RFQ_RETURNED_TO_DRAFT", t.rfqId)).map((x) => x.payload)).toEqual([{ reason: "them nha cung cap" }]);
    // Về DRAFT rồi thì danh sách đổi được lại (K4a) — lối duy nhất để sửa danh sách sau khi nộp.
    expect((await moi(t, t.rfqId, await nhaCungCap(t))).status).toBe(201);
  });

  it("tổ chức CHƯA bật ⇒ 422 thông điệp có tên, không hàng sổ nào của lần trả về", async () => {
    const t = await toChucVaGoiChoDuyet(false);
    const r = await goi(goc, "POST", `/rfqs/${t.rfqId}/return-to-draft`, t.pm.cookie, { reason: "sua" });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ error: "Tổ chức chưa bật kiểm soát theo bậc: trả gói thầu về soạn thảo chưa mở (ADR-080)." });
    expect(await soDong(t.org, "RFQ_RETURNED_TO_DRAFT")).toEqual([]);
  });
});

async function toChucVaGoiChoDuyet(daBat: boolean): Promise<ToChuc & { readonly rfqId: string }> {
  datLaiBoGui();
  const t = await taoToChuc(daBat);
  const rfqId = await goiNhap(t);
  const nop = await goi(goc, "POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
  expect(nop.status, JSON.stringify(nop.body)).toBe(200);
  return { ...t, rfqId };
}

// =============================================================================================
// ⑹ — KHOẢN 253
// =============================================================================================
describe("[S1.9101 / S3.2b / khoản 253] token đúc trước lúc gói mở không dùng được ở tổ chức đã bật", () => {
  const doiToken = (org: string, token: string): Promise<unknown> =>
    withTenant(apiPool, org, (c) => redeemMagicLink(c, org, token)).catch((e: unknown) => e);

  it("nửa PENDING_APPROVAL: token đúc thời MVP1 khi gói đã nộp duyệt dùng được trước lần bật, bị từ chối sau lần bật (lượt soi S1.9101)", async () => {
    datLaiBoGui();
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    const nop = await goi(goc, "POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
    expect(nop.status, JSON.stringify(nop.body)).toBe(200);
    const r = await moi(t, rfqId, await nhaCungCap(t));
    expect(r.status, "MVP1 mời được ở PENDING_APPROVAL").toBe(201);
    const id = (r.body.invitation as { id: string }).id;
    const t0 = bg.da.find((x) => x.invitationId === id)!.token;
    expect(await doiToken(t.org, t0), "đối chứng trước lần bật").toMatchObject({ invitationId: id });
    await batS3(t);
    expect(await doiToken(t.org, t0), "gói chưa mở: token thời MVP1 chết").toBeInstanceOf(InvitationError);
  });

  it("gói ĐÃ mở lúc tổ chức bật mà token đúc ở DRAFT (trước lần mở, qua API): token ấy chết khi bật — đúng hình dạng hàng 253 —, và lối gửi lại đưa link sống về (lượt soi S1.9101)", async () => {
    datLaiBoGui();
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    const r = await moi(t, rfqId, await nhaCungCap(t));
    const id = (r.body.invitation as { id: string }).id;
    const t0 = bg.da.find((x) => x.invitationId === id)!.token;
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);
    expect(await doiToken(t.org, t0), "đối chứng: MVP1, gói đã mở, token dùng được").toMatchObject({ invitationId: id });
    await batS3(t);
    expect(await doiToken(t.org, t0), "token đúc trước opened_at chết khi bật").toBeInstanceOf(InvitationError);
    datLaiBoGui();
    const lai = await goi(goc, "POST", `/invitations/${id}/reissue`, t.pm.cookie);
    expect(lai.status, JSON.stringify(lai.body)).toBe(200);
    const t1 = bg.da.find((x) => x.invitationId === id)!.token;
    expect(await doiToken(t.org, t1), "link gửi lại dùng được").toMatchObject({ invitationId: id });
  });

  it("biên: token mang ĐÚNG giờ `opened_at` dùng được — phép so là `>=`, không `>`", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    const id = ((await moi(t, rfqId, await nhaCungCap(t))).body.invitation as { id: string }).id;
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);
    const tho = randomBytes(32).toString("base64url");
    await db.pool.query(
      "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, created_at, issued_by, issued_by_session_id) " +
        "SELECT $1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', p.opened_at, $4, $5 FROM rfq_packages p WHERE p.id = $6",
      [t.org, id, createHash("sha256").update(tho, "utf8").digest(), t.pm.u, t.pm.s, rfqId],
    );
    expect(await doiToken(t.org, tho)).toMatchObject({ invitationId: id });
  });

  it("lần mở chỉ thay token CHƯA dùng: token thời MVP1 đã tiêu thụ (qua OTP) không bị thu hồi lại, không có hàng `SUPERSEDED_AT_OPEN` nào cho nó", async () => {
    datLaiBoGui();
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    const [a, b] = [await nhaCungCap(t), await nhaCungCap(t)];
    const idA = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    const idB = ((await moi(t, rfqId, b)).body.invitation as { id: string }).id;
    await db.pool.query("UPDATE rfq_invitation_tokens SET consumed_at = now() WHERE invitation_id = $1", [idB]);
    await batS3(t);
    expect((await goi(goc, "PUT", `/rfqs/${rfqId}/budget`, t.pm.cookie, { estimatedValue: "1000000.00", currency: "VND" })).status).toBe(200);
    await nopDuyet(t, rfqId);
    expect((await mo(t, rfqId)).status).toBe(200);
    const { rows } = await db.pool.query<{ inv: string; thu_hoi: boolean; tieu_thu: boolean }>(
      "SELECT invitation_id AS inv, revoked_at IS NOT NULL AS thu_hoi, consumed_at IS NOT NULL AS tieu_thu FROM rfq_invitation_tokens " +
        "WHERE invitation_id = ANY ($1::uuid[]) ORDER BY created_at",
      [[idA, idB]],
    );
    expect(rows.filter((h) => h.inv === idB && h.tieu_thu), "token đã tiêu thụ không bị thu hồi lại").toEqual([
      { inv: idB, thu_hoi: false, tieu_thu: true },
    ]);
    expect((await soDong(t.org, "MAGIC_LINK_TOKEN_REVOKED")).map((x) => (x.payload as { invitationId: string }).invitationId)).toEqual([idA]);
  });

  it("lời mời thời MVP1 đang `SENT` của gói đang bay lúc bật: lần mở gửi lại link; gửi hỏng ⇒ vẫn `SENT` (K6 cấm lùi về `UNSENT`), `chuaGui` nêu nó, cả hai token chết — sổ nói đúng hai lý do", async () => {
    datLaiBoGui();
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    const a = await nhaCungCap(t);
    const id = ((await moi(t, rfqId, a)).body.invitation as { id: string }).id;
    await batS3(t);
    expect((await goi(goc, "PUT", `/rfqs/${rfqId}/budget`, t.pm.cookie, { estimatedValue: "1000000.00", currency: "VND" })).status).toBe(200);
    await nopDuyet(t, rfqId);
    bg.hong.add(a.email);
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await mo(t, rfqId);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.linkMoi).toEqual({ daGui: [], chuaGui: [id] });
    expect(await trangThaiLoiMoi(id)).toEqual({ status: "SENT", nhan: false });
    expect((await tokenCua(id)).map((x) => x.song)).toEqual([false, false]);
    expect((await soDong(t.org, "MAGIC_LINK_TOKEN_REVOKED")).map((x) => (x.payload as { reason: string }).reason)).toEqual([
      "SUPERSEDED_AT_OPEN",
      "LINK_SEND_FAILED",
    ]);
  });

  it("token đúc thời MVP1 cho một gói còn ở DRAFT: dùng được trước lần bật (đối chứng), bị từ chối sau lần bật; token đúc lúc mở gói dùng được", async () => {
    datLaiBoGui();
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    const a = await nhaCungCap(t);
    const r = await moi(t, rfqId, a);
    expect(r.status).toBe(201);
    const idA = (r.body.invitation as { id: string }).id;
    const t0 = bg.da.find((x) => x.invitationId === idA)!.token;
    const doi = (token: string): Promise<unknown> => withTenant(apiPool, t.org, (c) => redeemMagicLink(c, t.org, token)).catch((e: unknown) => e);

    expect(await doi(t0), "đối chứng: tổ chức chưa bật, token đúc ở DRAFT đổi được").toMatchObject({ invitationId: idA });
    await batS3(t);
    const sau = await doi(t0);
    expect(sau).toBeInstanceOf(InvitationError);
    expect((sau as Error).message).toBe("magic link không hợp lệ, đã hết hạn, đã dùng, hoặc đã bị thu hồi");

    // Ngân sách ghim lại phiên bản hiệu lực (K1), rồi nộp, ký, mở: lần mở đúc token MỚI và thu hồi token cũ.
    expect((await goi(goc, "PUT", `/rfqs/${rfqId}/budget`, t.pm.cookie, { estimatedValue: "1000000.00", currency: "VND" })).status).toBe(200);
    await nopDuyet(t, rfqId);
    datLaiBoGui();
    expect((await mo(t, rfqId)).body.linkMoi).toEqual({ daGui: [idA], chuaGui: [] });
    const t1 = bg.da.find((x) => x.invitationId === idA)!.token;
    expect(await doi(t1)).toMatchObject({ invitationId: idA });
    expect((await tokenCua(idA)).map((x) => x.song), "token thời MVP1 bị thu hồi ở lần mở").toEqual([false, true]);
    // Lần thu hồi ấy không im lặng: một hàng sổ mang ĐÚNG token thời MVP1, dưới người mở, lý do `SUPERSEDED_AT_OPEN`.
    const { rows: cu } = await db.pool.query<{ id: string }>(
      "SELECT id FROM rfq_invitation_tokens WHERE invitation_id = $1 AND revoked_at IS NOT NULL",
      [idA],
    );
    expect(await soDong(t.org, "MAGIC_LINK_TOKEN_REVOKED")).toEqual([
      { actor: t.pm.u, payload: { invitationId: idA, reason: "SUPERSEDED_AT_OPEN" }, resource: cu[0]?.id },
    ]);
  });

  it("mời thêm trong một giao dịch BẮT ĐẦU trước giao dịch mở gói: token mang giờ của câu chèn, không giờ bắt đầu giao dịch — link dùng được (lượt soi S1.9101)", async () => {
    datLaiBoGui();
    const t = await taoToChuc(true);
    const rfqId = await goiNhap(t);
    await nopDuyet(t, rfqId);
    const c = await nhaCungCap(t);
    // Giao dịch T bắt đầu (`now()` của nó đóng băng ở đây), lần mở gói chạy trọn và commit, rồi T mới mời và đúc token — đúng hai
    // lời gọi của route mời ở OPEN. Với mốc `now()`, token này mang giờ SỚM hơn `opened_at` và chết ngay khi ra đời.
    const token = await withTenant(apiPool, t.org, async (k) => {
      await k.query("SELECT 1");
      const r = await mo(t, rfqId);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const inv = await createInvitation(
        k,
        t.org,
        { rfqId, supplierId: c.supplierId, contactId: c.contactId, actorSessionId: t.pm.s },
        auditPool,
      );
      expect([inv.status, inv.moiSauKhiKy]).toEqual(["UNSENT", true]);
      return (await issueMagicLinkToken(k, t.org, { invitationId: inv.id, actorSessionId: t.pm.s })).token;
    });
    const doi = await withTenant(apiPool, t.org, (k) => redeemMagicLink(k, t.org, token)).catch((e: unknown) => e);
    expect(doi, "token đúc sau khi gói mở phải dùng được").not.toBeInstanceOf(Error);
  });
});

// =============================================================================================
// ⑺ — BỘ ĐIỀU PHỐI
// =============================================================================================
describe("[S1.9101 / S3.2b] bộ điều phối — loạt gửi sau commit", () => {
  it("handler trả 4xx ⇒ không lần gửi nào chạy; hai việc quyết phản hồi trong một yêu cầu — loạt rồi có bù, có bù rồi loạt, hai loạt — ⇒ 500, không gì được gửi", async () => {
    const t = await taoToChuc(false);
    ghiGia.length = 0;
    const log = batLog();
    try {
      const r = await goi(gocGia, "GET", "/s3b/gui-roi-422", t.pm.cookie);
      expect(r.status).toBe(422);
      const r2 = await goi(gocGia, "GET", "/s3b/hai-viec-quyet-phan-hoi", t.pm.cookie);
      expect(r2.status).toBe(500);
      const r3 = await goi(gocGia, "GET", "/s3b/co-bu-roi-gui-nhieu", t.pm.cookie);
      expect(r3.status, "việc có bù rồi loạt gửi: phép hỏi của loạt gửi phải thấy việc có bù").toBe(500);
      const r4 = await goi(gocGia, "GET", "/s3b/gui-nhieu-hai-lan", t.pm.cookie);
      expect(r4.status, "loạt gửi thứ hai phải ném, không đè loạt đầu").toBe(500);
    } finally {
      log.tra();
    }
    expect(ghiGia).toEqual([]);
  });

  it("lần ghi kết quả ném hay trả `false` ⇒ `phanHoi` nhận `ghiDuoc = false`, một dòng `ghi-ket-qua-gui`; việc thường vẫn chạy sau loạt gửi", async () => {
    const t = await taoToChuc(false);
    ghiGia.length = 0;
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocGia, "GET", "/s3b/ghi-hong", t.pm.cookie);
    } finally {
      log.tra();
    }
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ daGui: ["a"], chuaGui: ["b"], ghiDuoc: false });
    expect(ghiGia).toEqual(["gui-a", "thuong"]);
    expect(log.log.filter((d) => d.includes("ghi-ket-qua-gui"))).toHaveLength(1);
    expect(log.log.filter((d) => d.includes("sau-commit"))).toHaveLength(1);

    // Không ném mà trả `false` (chưa ghi trọn): cùng `ghiDuoc = false`, dòng log nói tên.
    ghiGia.length = 0;
    const log2 = batLog();
    let r2: PhanHoi;
    try {
      r2 = await goi(gocGia, "GET", "/s3b/ghi-chua-tron", t.pm.cookie);
    } finally {
      log2.tra();
    }
    expect(r2.body).toEqual({ daGui: ["a"], chuaGui: [], ghiDuoc: false });
    expect(ghiGia).toEqual(["gui-a", "ghi"]);
    expect(log2.log.filter((d) => d.includes("ghi-ket-qua-gui GhiChuaTron"))).toHaveLength(1);
  });

  it("kết quả giữ THỨ TỰ ĐĂNG KÝ; `ghiKetQua` chạy MỘT lần, TRƯỚC việc thường; việc thường hỏng bị nuốt với một dòng `sau-commit`, việc sau nó vẫn chạy", async () => {
    const t = await taoToChuc(false);
    ghiGia.length = 0;
    const log = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocGia, "GET", "/s3b/thu-tu", t.pm.cookie);
    } finally {
      log.tra();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ daGui: ["a", "c"], chuaGui: ["b", "d"], ghiDuoc: true });
    expect(ghiGia).toEqual(["gui-a", "gui-c", "ghi a,c | b,d", "thuong-1", "thuong-3"]);
    expect(log.log.filter((d) => d.includes("sau-commit LoiGuiGiaLap"))).toHaveLength(2);
    expect(log.log.filter((d) => d.includes("sau-commit LoiViecThuongGiaLap"))).toHaveLength(1);
  });

  it("việc thường chạy khi phản hồi cuối dưới 400 — kể cả khi MỌI lần gửi hỏng —, và KHÔNG chạy khi phản hồi là lỗi (gửi lại hỏng ⇒ 502): cùng luật với việc có bù hỏng", async () => {
    const t = await taoToChuc(false);
    ghiGia.length = 0;
    const log = batLog();
    try {
      const r = await goi(gocGia, "GET", "/s3b/hong-het-van-200", t.pm.cookie);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ daGui: [], chuaGui: ["a", "b"] });
      expect(ghiGia).toEqual(["ghi", "thuong"]);
      ghiGia.length = 0;
      const r2 = await goi(gocGia, "GET", "/s3b/phan-hoi-502", t.pm.cookie);
      expect(r2.status).toBe(502);
      expect(r2.body).toEqual({ error: "gia 502" });
      expect(ghiGia, "phản hồi lỗi: việc thường bị bỏ").toEqual(["ghi"]);
    } finally {
      log.tra();
    }
  });

  it("pool nghiệp vụ bị giữ hết lúc phần ghi kết quả chạy: lần lấy kết nối gãy ở trần 5 s với `TenantError CONNECT_WAIT_EXCEEDED` ⇒ `ghiDuoc = false` — không chờ 20 s của pool", async () => {
    const t = await taoToChuc(false);
    ghiGia.length = 0;
    const log = batLog();
    let r: PhanHoi | null = null;
    let daCho = -1;
    try {
      const batDau = Date.now();
      r = await Promise.race([goi(gocGia, "GET", "/s3b/giu-pool", t.pm.cookie), ngu(12_000).then(() => null)]);
      daCho = Date.now() - batDau;
    } finally {
      for (const k of giuKetNoi.splice(0)) k.release();
      log.tra();
    }
    expect(r?.status, "phần ghi phải gãy ở trần, không chờ 20 s của createPool").toBe(200);
    expect(r?.body).toEqual({ daGui: ["a"], chuaGui: [], ghiDuoc: false });
    expect(daCho).toBeGreaterThanOrEqual(4500);
    expect(daCho).toBeLessThan(9000);
    expect(ghiGia, "ghiKetQua không chạy").toEqual([]);
    expect(log.log.filter((d) => d.includes("ghi-ket-qua-gui TenantError CONNECT_WAIT_EXCEEDED"))).toHaveLength(1);
  }, 30_000);
});
