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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import {
  CUA_SO_LINK_MOI_GIAY,
  InvitationError,
  LINK_MOI_TOI_DA_MOI_GIO,
  createInvitation,
  redeemMagicLink,
  reissueInvitationLink,
  revokeInvitation,
  revokeMagicLinkToken,
} from "@trustprocure/invitation";
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
/**
 * [S1.9101 / khoản 293] Thân `409` của gửi lại link khi gói không nhận báo giá (`RFQ_NOT_ACCEPTING`). Chủ dự án giữ nút *Gửi lại
 * link* ở mọi trạng thái của tổ chức chưa bật (hợp đồng MVP1 «máy chủ tự từ chối»), nên câu từ chối là thứ người mua ĐỌC —
 * `/tao-thau` in nguyên văn (`loiCua`). ~~`goi thau khong nhan bao gia`~~ — câu máy, không dấu, không nói khi nào gửi được.
 */
const THAN_409_GOI_KHONG_NHAN = {
  error:
    "Gói thầu này không nhận báo giá lúc này nên không gửi lại link được — chỉ gửi lại được khi gói đang mở và còn hạn nộp, " +
    "hoặc khi vòng BAFO đang mở và còn hạn.",
};
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
let csX = "";
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
/** [S1.181 / lượt soi] Dịch vụ test của bộ điều phối — giữ tham chiếu để đọc mã OTP đã "gửi" (`otpDaGui`). */
const dv = dichVuTest();

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
  orgX = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty K124', 'cong-ty-k124') RETURNING id")).rows[0]!.id;
  pm = await taoNguoi("pm-k124@vidu.vn", "PROCUREMENT_MANAGER");
  // Pool dựng như sản xuất — cùng `lock_timeout`, `statement_timeout`, `idle_in_transaction_session_timeout` và `application_name`.
  apiPool = createPool(db.connectionString, 4, { role: "app_api" });
  auditPool = createPool(db.connectionString, 4, { role: "app_api" });

  // RFQ OPEN có khoá — cùng công thức với guest.int.test.ts.
  csX = (
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
    [orgX, rfqX, csX, pm.id, pm.sessionId],
  );
  await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [
    rfqX,
    pm.id,
    pm.sessionId,
  ]);
  await kyMotChuKy(orgX, rfqX);
  await withTenant(apiPool, orgX, async (c) => {
    await issueRfqKeyPair(c, orgX, {
      rfqId: rfqX,
      actorSessionId: pm.sessionId,
      orgKeys: dichVuTest().services.orgKeyProvisioner,
    });
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfqX, pm.id, pm.sessionId]);
  });

  const services: ApiServices = {
    ...dv.services,
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
        revokeInvitation(c, orgX, { invitationId: id, actorSessionId: nguoiMoi.sessionId, reason: "LY_DO_LA" as "LINK_SEND_FAILED" }, apiPool),
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

// ---------------------------------------------------------------------------------------------
// [S1.181 / ADR-110] Gửi lại link cho CÙNG lời mời — đi trên cùng đường sau commit, cùng bộ gửi do test điều khiển.
// ---------------------------------------------------------------------------------------------
/** Thân `502` của route gửi lại khi link không gửi được — lời mời giữ nguyên, token vừa phát bị thu hồi, và **[lượt soi]** thân nói
 * cả điều bên mua không tự thấy: link cũ chưa dùng đã hết hiệu lực từ giao dịch đã commit. */
const THAN_502_GUI_LAI = { error: "khong gui duoc link moi; link moi da thu hoi, link cu chua dung da het hieu luc" };

async function goiCoHeader(duong: string, cookie: string): Promise<{ status: number; body: string; retryAfter: string | null }> {
  const res = await fetch(`${gocMacDinh}${duong}`, { method: "POST", headers: { cookie } });
  return { status: res.status, body: await res.text(), retryAfter: res.headers.get("retry-after") };
}

async function moiMot(nguoiMoi: Nguoi): Promise<{ readonly ncc: Awaited<ReturnType<typeof nhaCungCap>>; readonly id: string; readonly token: string }> {
  const ncc = await nhaCungCap();
  datCheDo("thuong");
  const r = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
  expect(r.status, r.body).toBe(201);
  return { ncc, id: (JSON.parse(r.body) as { invitation: { id: string } }).invitation.id, token: daGui.at(-1)!.token };
}

/** `redeemMagicLink` như `/guest/redeem` gọi — token còn dùng được thì trả id lời mời, không thì `null`. */
async function tokenDungDuoc(token: string): Promise<string | null> {
  return withTenant(apiPool, orgX, (c) => redeemMagicLink(c, orgX, token)).then(
    (r) => r.invitationId,
    (e: unknown) => {
      if (e instanceof InvitationError) return null;
      throw e;
    },
  );
}

/** [S1.181 / lượt soi] Lời gọi của trang nộp thầu — không cookie. */
async function goiKhach(duong: string, than: unknown): Promise<PhanHoi> {
  const res = await fetch(`${gocMacDinh}${duong}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(than) });
  return { status: res.status, body: await res.text() };
}

/** [S1.181 / lượt soi] Một gói OPEN mới có khoá, cùng công thức với `rfqX` — cho các ca phải đổi hạn hay trạng thái của CHÍNH gói. */
async function goiMoMoi(ten: string): Promise<string> {
  const rfq = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, $2, now() + interval '7 days', false, $3, $4) RETURNING id",
      [orgX, ten, pm.id, pm.sessionId],
    )
  ).rows[0]!.id;
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep', '1.0000', 'tam', $3, $4)",
    [orgX, rfq, pm.id, pm.sessionId],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, '1000.00', 'VND', $3, $4, $5)",
    [orgX, rfq, csX, pm.id, pm.sessionId],
  );
  await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [rfq, pm.id, pm.sessionId]);
  await kyMotChuKy(orgX, rfq);
  await withTenant(apiPool, orgX, async (c) => {
    await issueRfqKeyPair(c, orgX, { rfqId: rfq, actorSessionId: pm.sessionId, orgKeys: dichVuTest().services.orgKeyProvisioner });
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [rfq, pm.id, pm.sessionId]);
  });
  return rfq;
}

/**
 * [S1.181 / lượt soi] Dựng trạng thái mà chỉ THỜI GIAN mới dựng được trên đường thật: hạn gói đã qua (trigger máy trạng thái cấm
 * lùi hạn và đòi cửa sổ 1 giờ lúc mở), vòng BAFO mở SAU hạn gói. Khuôn `bidding.int.test.ts` [INV-C1] — tắt trigger để dựng
 * fixture, trigger ĐANG ĐO (ở đây: không trigger nào, phép đo nằm trong `reissueInvitationLink`) không liên quan — nhưng trong
 * MỘT giao dịch superuser: tắt MỌI trigger của các bảng nêu tên (cả trigger khoá ngoại), chạy câu dựng, bật lại ĐÚNG trạng thái cũ
 * của từng trigger (hardening để chúng ở `ENABLE ALWAYS`) rồi mới COMMIT. `session_replication_role = replica` không đủ — trigger
 * canh là ENABLE ALWAYS, và đó chính là lý do chúng được để như vậy.
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

describe("[S1.181 / ADR-110] POST /invitations/:invitationId/reissue — gửi lại link cho CÙNG lời mời", () => {
  it("token MỚI cho chính lời mời ấy, tới đúng người liên hệ và kênh; link cũ chưa dùng hết hiệu lực; lời mời không đổi; sổ ghi INVITATION_LINK_REISSUED rồi MAGIC_LINK_TOKEN_ISSUED", async () => {
    const nguoiMoi = await taoNguoi("gl-1-k124@vidu.vn", "BUYER");
    const { ncc, id, token: cu } = await moiMot(nguoiMoi);
    expect(await tokenDungDuoc(cu)).toBe(id);
    const truoc = daGui.length;
    const r = await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
    expect(r.status, r.body).toBe(200);
    // [lượt soi] Thân KHÔNG mang số link cũ bị thu hồi: 0 hay 1 là "nhà cung cấp đã xác minh link hay chưa" — thứ `BUYER` không
    // được đọc (A6). Con số nằm trong sổ, dưới quyền đọc sổ.
    expect(JSON.parse(r.body)).toEqual({ reissued: true });
    expect(daGui).toHaveLength(truoc + 1);
    const moi = daGui.at(-1)!;
    expect(moi).toMatchObject({ invitationId: id, destination: ncc.email, channel: "EMAIL" });
    expect(moi.token).not.toBe(cu);
    expect(r.body).not.toContain(moi.token);
    expect(await tokenDungDuoc(cu), "link cũ chưa dùng phải hết hiệu lực").toBeNull();
    expect(await tokenDungDuoc(moi.token)).toBe(id);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 2, tokenSong: 1 });
    const suKien = await suKienCuaLoiMoi(id);
    expect(suKien.map((x) => x.action)).toEqual(["INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED", "INVITATION_LINK_REISSUED", "MAGIC_LINK_TOKEN_ISSUED"]);
    expect(suKien[2]).toEqual({ action: "INVITATION_LINK_REISSUED", payload: { revokedTokens: 1 }, actorId: nguoiMoi.id });
    expect(JSON.stringify(suKien)).not.toContain(moi.token);
  });

  it(`trần ${String(LINK_MOI_TOI_DA_MOI_GIO)} link một giờ, KỂ CẢ link của lần mời: lần vượt ⇒ 429 + Retry-After cả cửa sổ, không token, không gửi, không hàng sổ`, async () => {
    const nguoiMoi = await taoNguoi("gl-2-k124@vidu.vn", "BUYER");
    const { ncc, id } = await moiMot(nguoiMoi);
    for (let i = 1; i < LINK_MOI_TOI_DA_MOI_GIO; i += 1) {
      const r = await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
      expect(r.status, r.body).toBe(200);
    }
    const truocGui = daGui.length;
    const truocSo = (await suKienCuaLoiMoi(id)).length;
    const vuot = await goiCoHeader(`/invitations/${id}/reissue`, nguoiMoi.cookie);
    expect(vuot.status, vuot.body).toBe(429);
    expect(JSON.parse(vuot.body)).toEqual({ error: "da gui qua nhieu link cho loi moi nay" });
    expect(vuot.retryAfter).toBe(String(CUA_SO_LINK_MOI_GIAY));
    expect(daGui).toHaveLength(truocGui);
    expect((await suKienCuaLoiMoi(id)).length).toBe(truocSo);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: LINK_MOI_TOI_DA_MOI_GIO, tokenSong: 1 });
    // [lượt soi] Cửa sổ là MỘT GIỜ, không ngắn hơn: dời mốc tạo của cả ba lùi 50 phút thì vẫn trong cửa sổ, vẫn 429.
    await db.pool.query("UPDATE rfq_invitation_tokens SET created_at = created_at - interval '50 minutes' WHERE invitation_id = $1", [id]);
    expect((await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie)).status).toBe(429);
    // Token đã thu hồi vẫn bị đếm: dời mốc tạo của cả ba ra ngoài cửa sổ thì gửi lại được ngay.
    await db.pool.query("UPDATE rfq_invitation_tokens SET created_at = created_at - interval '2 hours' WHERE invitation_id = $1", [id]);
    expect((await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie)).status).toBe(200);
  });

  it("ba lần gửi lại CÙNG LÚC khi trần còn hai chỗ ⇒ đúng hai 200 và một 429 — phép đếm chạy dưới khoá hàng của lời mời", async () => {
    const nguoiMoi = await taoNguoi("gl-3-k124@vidu.vn", "BUYER");
    const { ncc, id } = await moiMot(nguoiMoi);
    // Cho ba giao dịch CHỒNG NHAU thật: một kết nối ngoài giữ khoá tư vấn ghi sổ của tổ chức, nên giao dịch đi đầu dừng ở lần
    // ghi sổ đầu tiên, còn hai giao dịch kia dừng ở khoá hàng lời mời (có khoá) — hay ở hàng token mà giao dịch đầu vừa thu hồi
    // (không khoá: khi ấy cả ba đã ĐẾM xong và cả ba ra 200). Thả khi thấy đủ ba lời gọi đang chờ.
    const giu = await db.pool.connect();
    let kq: PhanHoi[];
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgX]);
      const hua = Promise.all([0, 1, 2].map(() => goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie)));
      const het = Date.now() + 5000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE application_name = 'trustprocure' AND wait_event_type = 'Lock'",
        );
        if (rows[0]!.n >= 3) break;
        if (Date.now() > het) throw new Error(`chỉ ${String(rows[0]!.n)} lời gọi đang chờ`);
        await ngu(20);
      }
      await giu.query("COMMIT");
      kq = await hua;
    } finally {
      giu.release();
    }
    expect(kq.map((r) => r.status).sort()).toEqual([200, 200, 429]);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 3, tokenSong: 1 });
  });

  it("lời mời đã thu hồi ⇒ 409; id không tồn tại hay của tổ chức KHÁC ⇒ 404; gói không nhận báo giá ⇒ 409; không giữ rfq.invite ⇒ 403 — không lần nào phát token hay gửi", async () => {
    const nguoiMoi = await taoNguoi("gl-4-k124@vidu.vn", "BUYER");
    const { id } = await moiMot(nguoiMoi);
    expect((await goi(gocMacDinh, "POST", `/invitations/${id}/revoke`, nguoiMoi.cookie)).status).toBe(200);
    const truocGui = daGui.length;
    const daThuHoi = await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
    expect(daThuHoi.status, daThuHoi.body).toBe(409);
    expect(JSON.parse(daThuHoi.body)).toEqual({ error: "loi moi da thu hoi" });
    expect((await goi(gocMacDinh, "POST", `/invitations/${randomUUID()}/reissue`, nguoiMoi.cookie)).status).toBe(404);

    // Tổ chức khác: một lời mời thật của Y, gọi bằng người mua của X ⇒ RLS lọc thành "không tồn tại".
    const orgY = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty Y K124', 'cong-ty-y-k124') RETURNING id")).rows[0]!.id;
    const uY = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'pm-y@vidu.vn', 'PM Y') RETURNING id", [orgY])).rows[0]!.id;
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER')", [orgY, uY]);
    const sY = (await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgY, uY, randomBytes(32)],
    )).rows[0]!.id;
    const nccY = (await db.pool.query<{ id: string }>("INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, 'NCC Y', $2, $3) RETURNING id", [orgY, uY, sY])).rows[0]!.id;
    const lhY = (await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, created_by, created_by_session_id) VALUES ($1, $2, 'LH Y', 'lh-y@vidu.vn', $3, $4) RETURNING id",
      [orgY, nccY, uY, sY],
    )).rows[0]!.id;
    const rfqY = (await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) VALUES ($1, 'RFQ Y', now() + interval '7 days', false, $2, $3) RETURNING id",
      [orgY, uY, sY],
    )).rows[0]!.id;
    const loiY = await withTenant(apiPool, orgY, (c) => createInvitation(c, orgY, { rfqId: rfqY, supplierId: nccY, contactId: lhY, actorSessionId: sY }, apiPool));
    const xuyen = await goi(gocMacDinh, "POST", `/invitations/${loiY.id}/reissue`, nguoiMoi.cookie);
    expect(xuyen.status, xuyen.body).toBe(404);

    // Gói chưa mở (DRAFT) — createInvitation không xét trạng thái gói, nên lời mời ấy có thật; gửi lại thì không.
    const rfqDraftX = (await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) VALUES ($1, 'RFQ nhap K124', now() + interval '7 days', false, $2, $3) RETURNING id",
      [orgX, pm.id, pm.sessionId],
    )).rows[0]!.id;
    const nccNhap = await nhaCungCap();
    const loiNhap = await withTenant(apiPool, orgX, (c) =>
      createInvitation(c, orgX, { rfqId: rfqDraftX, supplierId: nccNhap.supplierId, contactId: nccNhap.contactId, actorSessionId: pm.sessionId }, apiPool),
    );
    const nhap = await goi(gocMacDinh, "POST", `/invitations/${loiNhap.id}/reissue`, nguoiMoi.cookie);
    expect(nhap.status, nhap.body).toBe(409);
    // ~~`{ error: "goi thau khong nhan bao gia" }`~~ [S1.9101 / khoản 293] câu người đọc nêu điều kiện gửi lại được.
    expect(JSON.parse(nhap.body)).toEqual(THAN_409_GOI_KHONG_NHAN);

    const taiChinh = await taoNguoi("gl-4-tc-k124@vidu.vn", "FINANCE");
    const { id: idSong } = await moiMot(nguoiMoi);
    const truocGui2 = daGui.length;
    const cam = await goi(gocMacDinh, "POST", `/invitations/${idSong}/reissue`, taiChinh.cookie);
    expect(cam.status, cam.body).toBe(403);
    expect(daGui).toHaveLength(truocGui2);
    expect(daGui.length - truocGui).toBe(1); // chỉ lần mời `idSong`, không lần gửi lại nào
    const { rows: tuChoi } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2",
      [orgX, taiChinh.id],
    );
    expect(tuChoi[0]!.n).toBe(1);
  });

  it("hai hàm gói ném ở câu ĐẦU khi kết nối gắn tổ chức khác tổ chức khai (`assertTenantBound`); phần bù từ chối lý do ngoài danh sách LÚC CHẠY", async () => {
    const nguoiMoi = await taoNguoi("gl-6-k124@vidu.vn", "BUYER");
    const { ncc, id } = await moiMot(nguoiMoi);
    const khac = randomUUID();
    await expect(withTenant(apiPool, orgX, (c) => reissueInvitationLink(c, khac, { invitationId: id, actorSessionId: nguoiMoi.sessionId }))).rejects.toThrow(
      /^reissueInvitationLink: /u,
    );
    const { rows } = await db.pool.query<{ id: string }>("SELECT id FROM rfq_invitation_tokens WHERE invitation_id = $1", [id]);
    await expect(
      withTenant(apiPool, orgX, (c) => revokeMagicLinkToken(c, khac, { tokenId: rows[0]!.id, invitationId: id, actorSessionId: nguoiMoi.sessionId, reason: "LINK_SEND_FAILED" })),
    ).rejects.toThrow(/^revokeMagicLinkToken: /u);
    await expect(
      withTenant(apiPool, orgX, (c) =>
        revokeMagicLinkToken(c, orgX, { tokenId: rows[0]!.id, invitationId: id, actorSessionId: nguoiMoi.sessionId, reason: "LY_DO_LA" as "LINK_SEND_FAILED" }),
      ),
    ).rejects.toBeInstanceOf(InvitationError);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 1, tokenSong: 1 });
  });

  it("bộ gửi NÉM ⇒ 502 thân cố định, token vừa phát bị thu hồi với lý do LINK_SEND_FAILED, lời mời vẫn sống; MỘT dòng log không mang token hay email; gửi lại ⇒ 200", async () => {
    const nguoiMoi = await taoNguoi("gl-5-k124@vidu.vn", "BUYER");
    const { ncc, id } = await moiMot(nguoiMoi);
    datCheDo("nem");
    const bat = batLog();
    let r: PhanHoi;
    try {
      r = await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
    } finally {
      bat.tra();
    }
    expect(r.status, r.body).toBe(502);
    expect(JSON.parse(r.body)).toEqual(THAN_502_GUI_LAI);
    expect(bat.log).toHaveLength(1);
    expect(bat.log[0]).toMatch(/^\[api\] [0-9a-f-]{36} sau-commit LoiGuiGiaLap$/u);
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 2, tokenSong: 0 });
    const suKien = await suKienCuaLoiMoi(id);
    expect(suKien.map((x) => x.action)).toEqual([
      "INVITATION_CREATED", "MAGIC_LINK_TOKEN_ISSUED", "INVITATION_LINK_REISSUED", "MAGIC_LINK_TOKEN_ISSUED", "MAGIC_LINK_TOKEN_REVOKED",
    ]);
    expect(suKien.at(-1)).toEqual({ action: "MAGIC_LINK_TOKEN_REVOKED", payload: { invitationId: id, reason: "LINK_SEND_FAILED" }, actorId: nguoiMoi.id });

    datCheDo("thuong");
    const lai = await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
    expect(lai.status, lai.body).toBe(200);
    expect(JSON.parse(lai.body)).toEqual({ reissued: true });
    expect(await trangThaiLoiMoi(ncc.supplierId)).toEqual({ loiMoi: 1, song: 1, token: 3, tokenSong: 1 });
    // [lượt soi] Lần HỎNG vẫn tính vào trần — lời mời + lần hỏng + lần được = 3 trong giờ ⇒ lần kế 429. Thân 502 và câu báo của
    // `/tao-thau` nói ra điều này; ADR-110 ghi vì sao chấp nhận.
    expect((await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie)).status).toBe(429);
  });

  it("[lượt soi] gói còn OPEN mà đã QUÁ HẠN ⇒ 409, không token, không thư; ở BAFO_OPEN hạn của VÒNG quyết, không hạn của gói; vòng đóng ⇒ 409", async () => {
    const nguoiMoi = await taoNguoi("gl-7-k124@vidu.vn", "BUYER");
    const rfq = await goiMoMoi("RFQ qua han K124");
    const ncc = await nhaCungCap();
    datCheDo("thuong");
    const m = await goi(gocMacDinh, "POST", `/rfqs/${rfq}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId });
    expect(m.status, m.body).toBe(201);
    const id = (JSON.parse(m.body) as { invitation: { id: string } }).invitation.id;
    const soToken = async (): Promise<number> =>
      (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitation_tokens WHERE invitation_id = $1", [id])).rows[0]!.n;
    const guiLai = (): Promise<PhanHoi> => goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
    const tuChoi = async (ca: string): Promise<void> => {
      const truocGui = daGui.length;
      const truocToken = await soToken();
      const r = await guiLai();
      expect(r.status, `${ca}: ${r.body}`).toBe(409);
      // [S1.9101 / khoản 293] Cùng MỘT câu cho mọi vế (quá hạn gói, quá hạn vòng, không vòng nào mở, gói chưa mở): câu nêu CẢ HAI
      // điều kiện, không nội suy trạng thái hay hạn — cùng khuôn câu 422 của huỷ mở thầu (`packages/unseal/src/requests.ts`).
      expect(JSON.parse(r.body), ca).toEqual(THAN_409_GOI_KHONG_NHAN);
      expect(daGui, ca).toHaveLength(truocGui);
      expect(await soToken(), ca).toBe(truocToken);
    };
    expect((await guiLai()).status, "đối chứng: gói còn hạn").toBe(200);

    // Đóng gói là thao tác tay: một gói quá hạn còn nằm ở OPEN là trạng thái thường, và `bid_kiem_han_nop` chặn mọi lần nộp.
    await dungTrangThai(["public.rfq_packages"], [["UPDATE rfq_packages SET deadline_at = now() - interval '1 minute' WHERE id = $1", [rfq]]]);
    await tuChoi("OPEN quá hạn");

    // Vòng hai mở SAU hạn gói — trạng thái thường của BAFO: hạn gói đã qua, hạn vòng còn ⇒ gửi lại được.
    const vong = randomUUID();
    await dungTrangThai(["public.rfq_packages", "public.rfq_bafo_rounds"], [
      ["UPDATE rfq_packages SET status = 'BAFO_OPEN', closed_at = now() WHERE id = $1", [rfq]],
      [
        "INSERT INTO rfq_bafo_rounds (id, org_id, rfq_id, evaluation_id, policy_id, top_n, round_no, deadline_at, opened_by, opened_by_session_id) " +
          "VALUES ($1, $2, $3, $4, $5, 2, 1, now() + interval '1 day', $6, $7)",
        [vong, orgX, rfq, randomUUID(), csX, pm.id, pm.sessionId],
      ],
    ]);
    const bafo = await guiLai();
    expect(bafo.status, `BAFO_OPEN, hạn vòng còn: ${bafo.body}`).toBe(200);
    await dungTrangThai(["public.rfq_bafo_rounds"], [["UPDATE rfq_bafo_rounds SET deadline_at = now() - interval '1 minute' WHERE id = $1", [vong]]]);
    await tuChoi("BAFO_OPEN, hạn vòng đã qua");
    await dungTrangThai(["public.rfq_bafo_rounds"], [["UPDATE rfq_bafo_rounds SET deadline_at = now() + interval '1 day', closed_at = now() WHERE id = $1", [vong]]]);
    await tuChoi("BAFO_OPEN, không vòng nào đang mở");
  });

  it("[lượt soi] lời mời kênh SMS ⇒ link gửi lại đi tới SỐ ĐIỆN THOẠI của người liên hệ, qua SMS — không tới email", async () => {
    const nguoiMoi = await taoNguoi("gl-8-k124@vidu.vn", "BUYER");
    const ncc = await nhaCungCap();
    datCheDo("thuong");
    const m = await goi(gocMacDinh, "POST", `/rfqs/${rfqX}/invitations`, nguoiMoi.cookie, { supplierId: ncc.supplierId, contactId: ncc.contactId, linkChannel: "SMS" });
    expect(m.status, m.body).toBe(201);
    const id = (JSON.parse(m.body) as { invitation: { id: string } }).invitation.id;
    const { rows } = await db.pool.query<{ phone: string }>("SELECT phone FROM supplier_contacts WHERE id = $1", [ncc.contactId]);
    const r = await goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
    expect(r.status, r.body).toBe(200);
    expect(daGui.at(-1)).toMatchObject({ invitationId: id, channel: "SMS", destination: rows[0]!.phone });
    expect(daGui.at(-1)!.destination).not.toBe(ncc.email);
  });

  it("[lượt soi] phần bù trên token ĐÃ thu hồi ⇒ `false`, KHÔNG hàng sổ nào; token khai sai lời mời ⇒ `false`, token còn sống", async () => {
    const nguoiMoi = await taoNguoi("gl-9-k124@vidu.vn", "BUYER");
    const a = await moiMot(nguoiMoi);
    const b = await moiMot(nguoiMoi);
    const { rows } = await db.pool.query<{ id: string }>("SELECT id FROM rfq_invitation_tokens WHERE invitation_id = $1", [a.id]);
    const bu = (tokenId: string, invitationId: string): Promise<boolean> =>
      withTenant(apiPool, orgX, (c) => revokeMagicLinkToken(c, orgX, { tokenId, invitationId, actorSessionId: nguoiMoi.sessionId, reason: "LINK_SEND_FAILED" }));
    expect(await bu(rows[0]!.id, b.id), "token của lời mời A khai là của B").toBe(false);
    expect(await tokenDungDuoc(a.token)).toBe(a.id);
    expect(await bu(rows[0]!.id, a.id)).toBe(true);
    const truocSo = (await suKienCuaLoiMoi(a.id)).length;
    expect(await bu(rows[0]!.id, a.id), "lần hai trên token đã thu hồi").toBe(false);
    expect((await suKienCuaLoiMoi(a.id)).length, "lần hai không ghi sổ").toBe(truocSo);
    expect(await tokenDungDuoc(a.token)).toBeNull();
  });

  it("[lượt soi] gửi lại ĐUA với xác minh OTP bằng link cũ, lần xác minh khoá hàng token TRƯỚC ⇒ không bế tắc (40P01): cả hai 200", async () => {
    const nguoiMoi = await taoNguoi("gl-10-k124@vidu.vn", "BUYER");
    const { id, token: cu } = await moiMot(nguoiMoi);
    expect((await goiKhach("/guest/redeem", { orgId: orgX, token: cu })).status).toBe(200);
    const otp = await goiKhach("/guest/otp", { orgId: orgX, token: cu, channel: "SMS" });
    expect(otp.status, otp.body).toBe(200);
    const ma = dv.otpDaGui.at(-1)!.code;
    const { rows: tk } = await db.pool.query<{ id: string }>("SELECT id FROM rfq_invitation_tokens WHERE invitation_id = $1", [id]);
    const choKhoa = async (mau: string): Promise<void> => {
      const het = Date.now() + 5000;
      for (;;) {
        const { rows } = await db.pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE $1",
          [mau],
        );
        if (rows[0]!.n > 0) return;
        if (Date.now() > het) throw new Error(`không thấy câu đang chờ khoá: ${mau}`);
        await ngu(10);
      }
    };
    // Một kết nối ngoài giữ hàng token cũ MỘT LÚC — chỉ để ép hai giao dịch vào thứ tự tự nhiên của cửa sổ vài ms ngoài đời:
    // lần xác minh đã tới câu tiêu thụ token, rồi lần gửi lại khoá hàng lời mời và tới câu thu hồi token. Khi hàng token được
    // thả, lần xác minh chèn `guest_sessions` — phép kiểm khoá ngoại lấy `FOR KEY SHARE` trên hàng lời mời mà lần gửi lại
    // đang khoá. Dưới `FOR UPDATE` đó là bế tắc; dưới `FOR NO KEY UPDATE` thì không.
    const e = await db.pool.connect();
    const bat = batLog();
    let xacMinh: Promise<PhanHoi> | undefined;
    let guiLai: Promise<PhanHoi> | undefined;
    try {
      await e.query("BEGIN");
      await e.query("SELECT 1 FROM rfq_invitation_tokens WHERE id = $1 FOR UPDATE", [tk[0]!.id]);
      xacMinh = goiKhach("/guest/otp/verify", { orgId: orgX, token: cu, code: ma });
      await choKhoa("UPDATE public.rfq_invitation_tokens SET consumed_at%");
      guiLai = goi(gocMacDinh, "POST", `/invitations/${id}/reissue`, nguoiMoi.cookie);
      await choKhoa("UPDATE public.rfq_invitation_tokens SET revoked_at%");
      await e.query("COMMIT");
    } finally {
      e.release();
    }
    const [rx, rg] = await Promise.all([xacMinh, guiLai]);
    bat.tra();
    expect(bat.log.join("\n")).not.toMatch(/40P01/u);
    expect(rx.status, rx.body).toBe(200);
    expect(rg.status, rg.body).toBe(200);
    expect(JSON.parse(rg.body), "thân không nói nhà cung cấp đã xác minh hay chưa").toEqual({ reissued: true });
    // Lần xác minh tiêu thụ token cũ trước, nên lần gửi lại không còn token chưa dùng nào để thu hồi — sổ ghi 0.
    const suKien = await suKienCuaLoiMoi(id);
    expect(suKien.find((x) => x.action === "INVITATION_LINK_REISSUED")?.payload).toEqual({ revokedTokens: 0 });
    expect(await tokenDungDuoc(daGui.at(-1)!.token)).toBe(id);
  }, 30_000);
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
