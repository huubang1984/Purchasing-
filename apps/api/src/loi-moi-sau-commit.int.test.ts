// ==============================================================================================
// [S1.70 / khoản 124] LINK MỜI ĐI SAU COMMIT — GỬI HỎNG THÌ LỜI MỜI BỊ THU HỒI TRONG MỘT GIAO DỊCH MỚI
//
// Trước khoản này `POST /rfqs/:rfqId/invitations` gọi `createInvitation` rồi `issueMagicLinkToken` — hai lần `appendAuditEvent`, tức khoá
// tư vấn ghi sổ của tổ chức giữ tới hết giao dịch — rồi `await invitationLinkSender.send(…)` NGAY TRONG giao dịch ấy. Đo trên tiến trình
// `api` dựng từ môi trường, `TRUSTPROCURE_DB_POOL_MAX` 3 (biên bản §S1.70): bộ gửi chậm 3 s giữ khoá của tổ chức khoảng 3,0 s, một lần ghi
// sổ khác của tổ chức ấy chờ khoảng 2,5 s, `/me` của một tổ chức KHÁC chờ khoảng 2,0 s vì pool bị ghim; bộ gửi treo giữ khoá tới
// `idle_in_transaction_session_timeout` 60 s.
//
// Hợp đồng đo ở đây (chủ dự án chọn ngày 2026-09-13 — ADR-020 tiểu mục [S1.70 / khoản 124]):
//   ⑴ bộ gửi nhận token khi lời mời và token ĐÃ commit, và không kết nối nào của ứng dụng giữ khoá của tổ chức trong lúc gửi;
//   ⑵ `201` nghĩa là bộ gửi đã báo xong trong trần; gửi hỏng hay quá trần ⇒ lời mời bị thu hồi trong một giao dịch MỚI, `502` thân cố
//      định, MỘT dòng log `sau-commit`, và người mua gọi lại được ngay;
//   ⑶ lần thu hồi bù cũng hỏng ⇒ `500` kèm `invitationId` của lời mời còn sống, hai dòng log — người mua thu hồi bằng id ấy rồi mời lại
//      (chủ dự án chọn ngày 2026-09-13, lượt soi 64a-1); lần lấy kết nối của phần bù có trần 5 s với lỗi có tên (64a-3);
//   ⑷ ở bộ điều phối: việc có bù chỉ chạy khi phản hồi thành công; chạy TRƯỚC việc sau commit thường; hỏng thì việc thường không chạy;
//      mỗi yêu cầu tối đa MỘT việc có bù — đăng ký lần hai là lỗi của handler (64a-2); phần bù chạy trong giao dịch khác giao dịch của
//      handler, đã gắn tổ chức.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { InvitationError, revokeInvitation } from "@trustprocure/invitation";
import { issueRfqKeyPair } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices, Route } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
/** Thân `502` của route mời khi link không gửi được — ghim ở đây để hợp đồng không trôi theo chuỗi của `routes/buyer.ts`. */
const THAN_502_LOI_MOI = { error: "khong gui duoc link moi, loi moi da thu hoi" };
/** Thân `500` khi cả lần gửi lẫn lần thu hồi bù cùng hỏng — đi kèm `invitationId` (lượt soi 64a-1). */
const THAN_500_BU_HONG = { error: "khong gui duoc link moi va chua thu hoi duoc loi moi" };
const TRAN_NGAN_MS = 800;

interface Nguoi {
  readonly id: string;
  readonly sessionId: string;
  readonly cookie: string;
}

interface PhanHoi {
  readonly status: number;
  readonly body: string;
}

type CheDoGui = "thuong" | "cho" | "cho-roi-nem" | "nem" | "nem-sau-khi-thu-hoi-phien";

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let orgX = "";
let rfqX = "";
let pm: Nguoi;
let gocMacDinh = "";
let gocTranNgan = "";
let gocGia = "";
const dongServer: (() => Promise<void>)[] = [];

/** Bộ gửi link mời do test điều khiển. `tokenDaCommitKhiGui` đếm token của lời mời TỪ MỘT KẾT NỐI KHÁC, ngay khi bộ gửi được gọi. */
const dk: { cheDo: CheDoGui; daGoi: number; tha: (() => void) | null; tokenDaCommitKhiGui: number | null; phienThuHoi: string } = {
  cheDo: "thuong",
  daGoi: 0,
  tha: null,
  tokenDaCommitKhiGui: null,
  phienThuHoi: "",
};
const daGui: { readonly invitationId: string; readonly token: string; readonly destination: string; readonly channel: string }[] = [];

function datCheDo(cheDo: CheDoGui, phienThuHoi = ""): void {
  dk.cheDo = cheDo;
  dk.daGoi = 0;
  dk.tha = null;
  dk.tokenDaCommitKhiGui = null;
  dk.phienThuHoi = phienThuHoi;
}

function loiCoTen(ten: string, thongDiep = `gia lap ${ten}`): Error {
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

async function goi(goc: string, method: string, duong: string, cookie: string, than?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = { cookie };
  if (than !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${goc}${duong}`, { method, headers, ...(than === undefined ? {} : { body: JSON.stringify(than) }) });
  return { status: res.status, body: await res.text() };
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

async function taoNguoi(email: string, vai: string): Promise<Nguoi> {
  const id = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'K124', 'ACTIVE') RETURNING id", [orgX, email])
  ).rows[0]!.id;
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgX, id, vai]);
  const token = randomBytes(32).toString("base64url");
  const sessionId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgX, id, createHash("sha256").update(token, "utf8").digest()],
    )
  ).rows[0]!.id;
  return { id, sessionId, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgX}.${token}` };
}

let soNcc = 0;
async function nhaCungCap(): Promise<{ readonly supplierId: string; readonly contactId: string; readonly email: string }> {
  soNcc += 1;
  const email = `lh-k124-${soNcc}@vidu.vn`;
  const supplierId = (
    await db.pool.query<{ id: string }>("INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id", [
      orgX,
      `NCC K124 ${soNcc}`,
      pm.id,
      pm.sessionId,
    ])
  ).rows[0]!.id;
  const contactId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi bao gia', $3, $4, $5, $6) RETURNING id",
      [orgX, supplierId, email, `090123${String(soNcc).padStart(4, "0")}`, pm.id, pm.sessionId],
    )
  ).rows[0]!.id;
  return { supplierId, contactId, email };
}

async function trangThaiLoiMoi(supplierId: string): Promise<{ loiMoi: number; song: number; token: number; tokenSong: number }> {
  const { rows } = await db.pool.query<{ loi_moi: number; song: number; token: number; token_song: number }>(
    "SELECT (SELECT count(*)::int FROM rfq_invitations WHERE rfq_id = $1 AND supplier_id = $2) AS loi_moi, " +
      "(SELECT count(*)::int FROM rfq_invitations WHERE rfq_id = $1 AND supplier_id = $2 AND revoked_at IS NULL) AS song, " +
      "(SELECT count(*)::int FROM rfq_invitation_tokens t JOIN rfq_invitations i ON i.id = t.invitation_id WHERE i.rfq_id = $1 AND i.supplier_id = $2) AS token, " +
      "(SELECT count(*)::int FROM rfq_invitation_tokens t JOIN rfq_invitations i ON i.id = t.invitation_id " +
      "  WHERE i.rfq_id = $1 AND i.supplier_id = $2 AND t.revoked_at IS NULL) AS token_song",
    [rfqX, supplierId],
  );
  const h = rows[0]!;
  return { loiMoi: h.loi_moi, song: h.song, token: h.token, tokenSong: h.token_song };
}

async function loiMoiDauTien(supplierId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>("SELECT id FROM rfq_invitations WHERE rfq_id = $1 AND supplier_id = $2 ORDER BY created_at LIMIT 1", [
    rfqX,
    supplierId,
  ]);
  return rows[0]?.id ?? "";
}

async function suKienCuaLoiMoi(invitationId: string): Promise<{ action: string; payload: unknown; actorId: string | null }[]> {
  const { rows } = await db.pool.query<{ action: string; payload: unknown; actor_id: string | null }>(
    "SELECT action, payload, actor_id FROM audit_events WHERE org_id = $1 AND (resource_id::text = $2 OR payload ->> 'invitationId' = $2) ORDER BY seq",
    [orgX, invitationId],
  );
  return rows.map((h) => ({ action: h.action, payload: h.payload, actorId: h.actor_id }));
}

/** Số khoá tư vấn ghi sổ của tổ chức X đang ĐƯỢC CẤP cho một kết nối của pool ứng dụng (`application_name` của `createPool`). */
async function demKhoaToChucDangGiu(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid = l.pid " +
      "WHERE l.locktype = 'advisory' AND l.granted AND a.application_name = 'trustprocure' " +
      "AND l.classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND l.objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [orgX],
  );
  return rows[0]?.n ?? -1;
}

async function dungServer(dispatcher: ReturnType<typeof createDispatcher>): Promise<string> {
  const server = createApiServer(dispatcher);
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  dongServer.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// ---------------------------------------------------------------------------------------------
// Route GIẢ cho ngữ nghĩa của bộ điều phối — không đi qua route mời, không chạm bộ gửi.
// ---------------------------------------------------------------------------------------------
const ghiGia: string[] = [];
let txHandler = "";
let buThay: { readonly t: string; readonly org: string | null } | null = null;

function tuyenGia(): Route[] {
  return [
    {
      method: "GET",
      path: "/k124/co-bu-422",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: (ctx) => {
        ctx.afterCommitCoBu({
          viec: () => {
            ghiGia.push("viec");
            return Promise.resolve();
          },
          bu: () => {
            ghiGia.push("bu");
            return Promise.resolve();
          },
          phanHoiKhiHong: { status: 502, body: { error: "gia" } },
        });
        return Promise.resolve({ status: 422, body: { error: "gia 422" } });
      },
    },
    {
      method: "GET",
      path: "/k124/hai-viec-co-bu",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: (ctx) => {
        ctx.afterCommitCoBu({
          viec: () => Promise.reject(loiCoTen("LoiViecMot")),
          bu: () => {
            ghiGia.push("bu-1");
            return Promise.resolve();
          },
          phanHoiKhiHong: { status: 502, body: { error: "bu mot" } },
        });
        ctx.afterCommitCoBu({
          viec: () => {
            ghiGia.push("viec-2");
            return Promise.resolve();
          },
          bu: () => {
            ghiGia.push("bu-2");
            return Promise.resolve();
          },
          phanHoiKhiHong: { status: 503, body: { error: "bu hai" } },
        });
        ctx.afterCommit(() => {
          ghiGia.push("thuong");
          return Promise.resolve();
        });
        return Promise.resolve({ status: 200, body: { ok: true } });
      },
    },
    {
      method: "GET",
      path: "/k124/viec-co-bu-hong",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: (ctx) => {
        ctx.afterCommit(() => {
          ghiGia.push("thuong");
          return Promise.resolve();
        });
        ctx.afterCommitCoBu({
          viec: () => Promise.reject(loiCoTen("LoiViecMot")),
          bu: () => {
            ghiGia.push("bu-1");
            return Promise.resolve();
          },
          phanHoiKhiHong: { status: 502, body: { error: "bu mot" } },
        });
        return Promise.resolve({ status: 200, body: { ok: true } });
      },
    },
    {
      method: "GET",
      path: "/k124/tat-ca-xong",
      audience: "BUYER",
      mutates: false,
      agent: false,
      // Việc thường XẾP TRƯỚC việc có bù — nhưng chạy SAU nó.
      handler: (ctx) => {
        ctx.afterCommit(() => {
          ghiGia.push("thuong");
          return Promise.resolve();
        });
        ctx.afterCommitCoBu({
          viec: () => {
            ghiGia.push("viec-1");
            return Promise.resolve();
          },
          bu: () => {
            ghiGia.push("bu-1");
            return Promise.resolve();
          },
          phanHoiKhiHong: { status: 502, body: { error: "gia" } },
        });
        return Promise.resolve({ status: 200, body: { ok: true } });
      },
    },
    {
      method: "GET",
      path: "/k124/bu-giao-dich",
      audience: "BUYER",
      mutates: false,
      agent: false,
      handler: async (ctx) => {
        txHandler = (await ctx.client.query<{ t: string }>("SELECT pg_catalog.txid_current()::text AS t")).rows[0]!.t;
        ctx.afterCommitCoBu({
          viec: () => Promise.reject(loiCoTen("LoiViecBu")),
          bu: async (c) => {
            buThay = (
              await c.query<{ t: string; org: string | null }>(
                "SELECT pg_catalog.txid_current()::text AS t, pg_catalog.current_setting('app.org_id', true) AS org",
              )
            ).rows[0]!;
          },
          phanHoiKhiHong: { status: 502, body: { error: "da bu" } },
        });
        return { status: 200, body: { ok: true } };
      },
    },
  ];
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgX = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty K124', 'cong-ty-k124') RETURNING id")).rows[0]!.id;
  pm = await taoNguoi("pm-k124@vidu.vn", "PROCUREMENT_MANAGER");
  // Pool dựng như sản xuất — cùng `lock_timeout`, `statement_timeout`, `idle_in_transaction_session_timeout` và `application_name`.
  apiPool = createPool(db.connectionString, 4, { role: "app_api" });
  auditPool = createPool(db.connectionString, 4, { role: "app_api" });

  // RFQ OPEN có khoá — cùng công thức với guest.int.test.ts.
  const cs = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
        "VALUES ($1, 1, '10000000000.00', 'VND', $2, $3) RETURNING id",
      [orgX, pm.id, pm.sessionId],
    )
  ).rows[0]!.id;
  rfqX = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'RFQ K124', now() + interval '7 days', false, $2, $3) RETURNING id",
      [orgX, pm.id, pm.sessionId],
    )
  ).rows[0]!.id;
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep', '1.0000', 'tam', $3, $4)",
    [orgX, rfqX, pm.id, pm.sessionId],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, '1000.00', 'VND', $3, $4, $5)",
    [orgX, rfqX, cs, pm.id, pm.sessionId],
  );
  await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [
    rfqX,
    pm.id,
    pm.sessionId,
  ]);
  await withTenant(apiPool, orgX, async (c) => {
    await issueRfqKeyPair(c, orgX, {
      rfqId: rfqX,
      actorSessionId: pm.sessionId,
      wrapper: { name: "k124", wrap: (_o: string, p: Uint8Array) => Promise.resolve({ ciphertext: p.map((b) => b ^ 0xff), keyVersion: "k124" }) },
    });
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqX, pm.id, pm.sessionId]);
  });

  const services: ApiServices = {
    ...dichVuTest().services,
    invitationLinkSender: {
      name: "bo-gui-dieu-khien",
      send: async (m) => {
        dk.daGoi += 1;
        dk.tokenDaCommitKhiGui = (
          await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitation_tokens WHERE invitation_id = $1", [m.invitationId])
        ).rows[0]!.n;
        if (dk.cheDo === "cho-roi-nem") {
          await new Promise<void>((xong) => {
            dk.tha = xong;
          });
          throw loiCoTen("LoiGuiGiaLap");
        }
        if (dk.cheDo === "cho") {
          await new Promise<void>((xong) => {
            dk.tha = xong;
          });
        } else if (dk.cheDo === "nem") {
          // Thông điệp MANG token và đích — dòng log không được mang mảnh nào của nó (A2).
          throw loiCoTen("LoiGuiGiaLap", `gia lap gui hong ${m.token} ${m.destination}`);
        } else if (dk.cheDo === "nem-sau-khi-thu-hoi-phien") {
          await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [dk.phienThuHoi]);
          throw loiCoTen("LoiGuiGiaLap");
        }
        daGui.push({ invitationId: m.invitationId, token: m.token, destination: m.destination, channel: m.channel });
      },
    },
  };
  gocMacDinh = await dungServer(createDispatcher({ pool: apiPool, auditPool, services }));
  gocTranNgan = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, afterCommitTimeoutMs: TRAN_NGAN_MS }));
  gocGia = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, routes: tuyenGia() }));
}, 180000);

afterAll(async () => {
  dk.tha?.();
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.70 / khoản 124] POST /rfqs/:rfqId/invitations — link mời đi SAU commit", () => {
  it("⑴ bộ gửi CHỜ: khi bộ gửi nhận token thì token đã commit, không kết nối nào của ứng dụng giữ khoá tư vấn ghi sổ của tổ chức, một lần ghi sổ khác của tổ chức xong trong lúc lần gửi còn chờ; thả ⇒ 201, đúng một link", async () => {
    // Đối chứng: bộ đếm thấy khoá khi một kết nối của pool ứng dụng giữ nó — nếu không, "0 khoá" dưới đây đúng vì bộ đếm mù.
    await withTenant(apiPool, orgX, async (c) => {
      await c.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgX]);
      expect(await demKhoaToChucDangGiu(), "đối chứng: bộ đếm khoá").toBe(1);
    });
    const nguoiMoi = await taoNguoi("mua-1-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    datCheDo("cho");
    const truocGui = daGui.length;
    const moi = goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
    try {
      await doi(() => dk.tha !== null, 5000, "bo gui chua duoc goi");
      expect(dk.tokenDaCommitKhiGui, "token phải ĐÃ commit khi bộ gửi nhận nó").toBe(1);
      expect(await demKhoaToChucDangGiu(), "khoá tư vấn ghi sổ của tổ chức bị giữ trong lúc gửi").toBe(0);
      const ghi = await Promise.race([goi(gocMacDinh, "POST", "/suppliers", pm.cookie, { legalName: "NCC K124 ghi trong luc gui" }), ngu(3000).then(() => null)]);
      expect(ghi?.status, "một lần ghi sổ khác của tổ chức phải xong trong lúc lần gửi còn chờ").toBe(201);
      expect(dk.daGoi).toBe(1);
    } finally {
      dk.tha?.();
    }
    const r = await moi;
    expect(r.status, r.body).toBe(201);
    expect(daGui).toHaveLength(truocGui + 1);
    expect(daGui.at(-1)).toMatchObject({ destination: ncc.email, channel: "EMAIL" });
    expect(r.body).not.toContain(daGui.at(-1)!.token);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 1, tokenSong: 1 });
  });

  it("⑵ bộ gửi NÉM: 502 thân cố định, lời mời và token bị thu hồi, sổ ghi INVITATION_REVOKED của người mời với lý do LINK_SEND_FAILED, MỘT dòng log `sau-commit` không mang token hay email; gọi lại ⇒ 201", async () => {
    const nguoiMoi = await taoNguoi("mua-2-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    datCheDo("nem");
    const bat = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
    } finally {
      bat.tra();
    }
    expect(r.status, r.body).toBe(502);
    expect(JSON.parse(r.body)).toEqual(THAN_502_LOI_MOI);
    expect(bat.log).toHaveLength(1);
    expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit LoiGuiGiaLap$/u);
    expect(r.body).not.toContain(ncc.email);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 0, token: 1, tokenSong: 0 });
    const suKien = await suKienCuaLoiMoi(await loiMoiDauTien(ncc.supplierId));
    expect(suKien.map((s) => s.action)).toEqual(["INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED", "INVITATION_REVOKED"]);
    expect(suKien[2]).toEqual({ action: "INVITATION_REVOKED", payload: { reason: "LINK_SEND_FAILED" }, actorId: nguoiMoi.id });

    datCheDo("thuong");
    const lai = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
    expect(lai.status, lai.body).toBe(201);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 2, song: 1, token: 2, tokenSong: 1 });

    // Lần người mua TỰ thu hồi không mang lý do — sổ phân biệt nó với lần hệ thống thu hồi thay họ.
    const idMoi = (JSON.parse(lai.body) as { invitation: { id: string } }).invitation.id;
    const thuHoi = await goi(gocMacDinh, "POST", `/invitations/${idMoi}/revoke`, nguoiMoi.cookie);
    expect(thuHoi.status, thuHoi.body).toBe(200);
    expect((await suKienCuaLoiMoi(idMoi)).at(-1)).toEqual({ action: "INVITATION_REVOKED", payload: {}, actorId: nguoiMoi.id });
  });

  it("⑶ bộ gửi TREO quá trần `afterCommitTimeoutMs`: khoá của tổ chức không bị giữ trong lúc treo; 502 sau trần, lời mời thu hồi, MỘT dòng log `sau-commit SauCommitQuaHan`", async () => {
    const nguoiMoi = await taoNguoi("mua-3-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    datCheDo("cho");
    const bat = batLog();
    const batDau = Date.now();
    try {
      const hua = goi(gocTranNgan, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
      await doi(() => dk.tha !== null, 5000, "bo gui chua duoc goi");
      expect(await demKhoaToChucDangGiu(), "khoá tư vấn ghi sổ của tổ chức bị giữ trong lúc bộ gửi treo").toBe(0);
      const r = await Promise.race([hua, ngu(6000).then(() => null)]);
      expect(r?.status, "yêu cầu phải trả ở trần, không treo theo bộ gửi").toBe(502);
      const daCho = Date.now() - batDau;
      expect(daCho).toBeGreaterThanOrEqual(TRAN_NGAN_MS - 100);
      expect(daCho).toBeLessThan(5000);
      expect(JSON.parse(r!.body)).toEqual(THAN_502_LOI_MOI);
      expect(bat.log).toHaveLength(1);
      expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit SauCommitQuaHan$/u);
      expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 0, token: 1, tokenSong: 0 });
    } finally {
      bat.tra();
      dk.tha?.();
    }
    // Gọi lại sau khi quá trần: lời mời cũ đã thu hồi nên chỉ mục một-lời-mời-còn-sống (024) không chặn.
    datCheDo("thuong");
    const lai = await goi(gocTranNgan, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
    expect(lai.status, lai.body).toBe(201);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 2, song: 1, token: 2, tokenSong: 1 });
  });

  it("⑷ lần thu hồi BÙ cũng hỏng — phiên người mời bị thu hồi giữa lúc gửi: 500 kèm `invitationId` của lời mời còn sống, hai dòng log `sau-commit` rồi `bu-sau-commit SessionInvalidError`; mời lại ⇒ 409, một người mua khác thu hồi bằng id ấy rồi mời lại ⇒ 201", async () => {
    const nguoiMoi = await taoNguoi("mua-4-k124@vidu.vn", "BUYER");
    const nguoiKhac = await taoNguoi("mua-4b-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    const than = { supplierId: ncc.supplierId, contactId: ncc.contactId };
    datCheDo("nem-sau-khi-thu-hoi-phien", nguoiMoi.sessionId);
    const bat = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, than);
    } finally {
      bat.tra();
    }
    expect(r.status, r.body).toBe(500);
    const idKet = await loiMoiDauTien(ncc.supplierId);
    expect(JSON.parse(r.body)).toEqual({ ...THAN_500_BU_HONG, invitationId: idKet });
    expect(bat.log).toHaveLength(2);
    expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit LoiGuiGiaLap$/u);
    expect(bat.log[1]).toMatch(/^\[api\] [0-9a-f-]{36} bu-sau-commit SessionInvalidError$/u);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 1, tokenSong: 1 });

    // Đường phục hồi mà phản hồi mở ra: mời lại vẫn 409 vì lời mời còn sống; thu hồi bằng id rồi mời lại thì được.
    datCheDo("thuong");
    const lai = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiKhac.cookie, than);
    expect(lai.status, lai.body).toBe(409);
    const thuHoi = await goi(gocMacDinh, "POST", `/invitations/${idKet}/revoke`, nguoiKhac.cookie);
    expect(thuHoi.status, thuHoi.body).toBe(200);
    const moiLai = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiKhac.cookie, than);
    expect(moiLai.status, moiLai.body).toBe(201);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 2, song: 1, token: 2, tokenSong: 1 });
  });

  it("⑻ `revokeInvitation` từ chối lý do ngoài danh sách LÚC CHẠY: ném `InvitationError`, lời mời không bị thu hồi, không hàng sổ nào (lượt soi 64a-9)", async () => {
    const nguoiMoi = await taoNguoi("mua-8-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    datCheDo("thuong");
    const moi = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
    expect(moi.status, moi.body).toBe(201);
    const id = (JSON.parse(moi.body) as { invitation: { id: string } }).invitation.id;
    await expect(
      withTenant(apiPool, orgX, (c) =>
        revokeInvitation(c, orgX, { invitationId: id, actorSessionId: nguoiMoi.sessionId, reason: "LY_DO_LA" as "LINK_SEND_FAILED" }),
      ),
    ).rejects.toBeInstanceOf(InvitationError);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 1, tokenSong: 1 });
    expect((await suKienCuaLoiMoi(id)).map((x) => x.action)).toEqual(["INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED"]);
  });

  it("⑼ pool nghiệp vụ bị giữ hết lúc phần bù chạy: lần lấy kết nối của phần bù gãy ở trần 5 s với `TenantError CONNECT_WAIT_EXCEEDED` — 500 kèm `invitationId`, lời mời còn sống (lượt soi 64a-3; trước: 20 s, `Error` không tên)", async () => {
    const nguoiMoi = await taoNguoi("mua-9-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    datCheDo("cho-roi-nem");
    const bat = batLog();
    const giu: pg.PoolClient[] = [];
    let r: PhanHoi | null = null;
    let daCho = -1;
    try {
      const hua = goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
      await doi(() => dk.tha !== null, 5000, "bo gui chua duoc goi");
      for (let i = 0; i < 4; i += 1) giu.push(await apiPool.connect());
      const batDau = Date.now();
      dk.tha?.();
      r = await Promise.race([hua, ngu(12000).then(() => null)]);
      daCho = Date.now() - batDau;
    } finally {
      for (const k of giu) k.release();
      bat.tra();
    }
    expect(r?.status, "phần bù phải gãy ở trần, không chờ 20 s của createPool").toBe(500);
    expect(daCho).toBeGreaterThanOrEqual(4500);
    expect(daCho).toBeLessThan(9000);
    const idKet = await loiMoiDauTien(ncc.supplierId);
    expect(JSON.parse(r!.body)).toEqual({ ...THAN_500_BU_HONG, invitationId: idKet });
    expect(bat.log).toHaveLength(2);
    expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit LoiGuiGiaLap$/u);
    expect(bat.log[1]).toMatch(/^\[api\] [0-9a-f-]{36} bu-sau-commit TenantError CONNECT_WAIT_EXCEEDED$/u);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 1, tokenSong: 1 });
  }, 30000);
});

describe("[S1.70 / khoản 124] bộ điều phối: việc sau commit CÓ BÙ, trên route giả", () => {
  it("⑸ handler trả 4xx ⇒ việc có bù không chạy, không bù, không log", async () => {
    const nguoi = await taoNguoi("gia-5-k124@vidu.vn", "BUYER");
    ghiGia.length = 0;
    const bat = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocGia, "GET", "/k124/co-bu-422", nguoi.cookie);
    } finally {
      bat.tra();
    }
    expect([r.status, r.body]).toEqual([422, JSON.stringify({ error: "gia 422" })]);
    expect(ghiGia).toEqual([]);
    expect(bat.log).toEqual([]);
  });

  it("⑹ việc có bù chạy TRƯỚC việc sau commit thường; việc có bù hỏng ⇒ bù chạy, phản hồi thành `phanHoiKhiHong`, việc thường không chạy; đăng ký việc có bù LẦN HAI ⇒ lỗi của handler, 500, không việc nào chạy (lượt soi 64a-2)", async () => {
    const nguoi = await taoNguoi("gia-6-k124@vidu.vn", "BUYER");
    ghiGia.length = 0;
    const xong = await goi(gocGia, "GET", "/k124/tat-ca-xong", nguoi.cookie);
    expect(xong.status, xong.body).toBe(200);
    expect(ghiGia).toEqual(["viec-1", "thuong"]);

    ghiGia.length = 0;
    const bat = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocGia, "GET", "/k124/viec-co-bu-hong", nguoi.cookie);
    } finally {
      bat.tra();
    }
    expect([r.status, r.body]).toEqual([502, JSON.stringify({ error: "bu mot" })]);
    expect(ghiGia).toEqual(["bu-1"]);
    expect(bat.log).toHaveLength(1);
    expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit LoiViecMot$/u);

    ghiGia.length = 0;
    const bat2 = batLog();
    let r2: PhanHoi;
    try {
      r2 = await goi(gocGia, "GET", "/k124/hai-viec-co-bu", nguoi.cookie);
    } finally {
      bat2.tra();
    }
    expect([r2.status, r2.body]).toEqual([500, JSON.stringify({ error: "loi noi bo" })]);
    expect(ghiGia).toEqual([]);
    expect(bat2.log).toHaveLength(1);
    // [S1.85 / khoản 131] Dòng 500 nay mang MẪU ROUTE — hằng đóng của bảng `ROUTES`, không phải đường dẫn đã gọi.
    expect(bat2.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} GET \/k124\/hai-viec-co-bu ViecCoBuThuHai$/u);
  });

  it("⑺ phần bù chạy trong một giao dịch MỚI đã gắn tổ chức — không phải giao dịch của handler", async () => {
    const nguoi = await taoNguoi("gia-7-k124@vidu.vn", "BUYER");
    txHandler = "";
    buThay = null;
    const bat = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocGia, "GET", "/k124/bu-giao-dich", nguoi.cookie);
    } finally {
      bat.tra();
    }
    expect([r.status, r.body]).toEqual([502, JSON.stringify({ error: "da bu" })]);
    expect(txHandler).not.toBe("");
    expect(buThay).not.toBeNull();
    expect(buThay!.org).toBe(orgX);
    expect(buThay!.t).not.toBe(txHandler);
    expect(bat.log).toHaveLength(1);
    expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit LoiViecBu$/u);
  });
});
