import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, approveRfq, createRfq, openRfq, returnRfqToDraft, submitRfqForApproval } from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

// =============================================================================================
// [S1.186 / S3.2b1] CẠNH `PENDING_APPROVAL→DRAFT` CHỈ Ở TỔ CHỨC ĐÃ BẬT (K4a), CHỮ KÝ CŨ MẤT HIỆU LỰC BẰNG BĂM (K4b),
// VÀ TOKEN GHI LẠI LÚC ĐÚC GÓI ĐÃ MỞ CHƯA (K6, khoản 253) — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `077_tra_ve_nhap`, hàm gói `returnRfqToDraft`. Mỗi chốt một phép đo hành vi, một đối chứng và một ĐỘT BIẾN. Vế
// PHÍA DÙNG của khoản 253 — lần đổi link, xin OTP, xác minh OTP — đo ở `apps/api/src/token-goi-da-mo.int.test.ts`, nơi gói
// `invitation` và gói `rfq` cùng có mặt.
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG: công tắc ADR-080 một chiều.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `danh-sach-moi.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo cạnh trạng thái.
const boBocGia = {
  name: "gia-cho-test-tra-ve-nhap",
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

/** Bảng bậc tối thiểu, khuôn `danh-sach-moi`. */
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
const GOI_THUONG = "1000000.00";
const GOI_CAP_KEP = "150000000.00";
const LY_DO = "nguoi duyet tra ve: bo sung nha cung cap";
const LOI_CHUA_BAT = "chỉ tổ chức đã bật S3 mới trả gói về nháp được";
const LOI_TRIGGER = "Chi to chuc da bat S3 moi tra goi ve DRAFT duoc (K4a)";
const LOI_NGUON = "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ";

// ---- Dàn cảnh --------------------------------------------------------------------------------
let db: TestDatabase;
let apiPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo gói, mời, mở. */
  readonly pm: Nguoi;
  /** Hai PROCUREMENT_MANAGER khác — người duyệt, giữ `rfq.approve`. */
  readonly pm2: Nguoi;
  readonly pm3: Nguoi;
  /** BUYER — giữ `rfq.create`, KHÔNG giữ `rfq.approve`. */
  readonly mua: Nguoi;
  /** FINANCE — người ký phiên bản chính sách; không giữ `rfq.create` lẫn `rfq.approve`. */
  readonly tc: Nguoi;
}
interface NhaCungCap {
  readonly ncc: string;
  readonly lh: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `tvn-${randomBytes(4).toString("hex")}`,
  ]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const u = await motId("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id", [
      org,
      `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
    ]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const s = await motId(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
        "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [org, u, randomBytes(32)],
    );
    return { u, s };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const pm3 = await nguoi("PROCUREMENT_MANAGER");
  const mua = await nguoi("BUYER");
  const tc = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  return { org, pm, pm2, pm3, mua, tc };
}

/** BẬT S3: phiên bản 2 có bậc, PM tạo, FINANCE ký — khuôn `batS3` của `danh-sach-moi`. */
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
 * [S1.266 / S3.3c1] Tổ chức ĐÃ bật: nhà cung cấp ĐẾM ĐƯỢC cho K2 (`nhaCungCapDemDuoc` — người nhập riêng, MST, xác minh bởi
 * `tc`: FINANCE, không khai phiên bản chính sách v2 mà ngân sách ghim, không tạo gói, không mời) — gói nộp duyệt được (bậc đòi
 * một). Tổ chức chưa bật: nguyên dạng MVP1, do PM dựng — K2 không áp, và xác minh K8a chỉ có ở tổ chức đã bật.
 */
async function nhaCungCap(t: ToChuc): Promise<NhaCungCap> {
  const daBat = (await db.pool.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org])).rows[0]!.b;
  if (daBat) {
    const [n] = await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc });
    return { ncc: n!.ncc, lh: n!.lh };
  }
  const ncc = await motId(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
  );
  const duoi = randomBytes(6).toString("hex");
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
    [t.org, ncc, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), t.pm.u, t.pm.s],
  );
  return { ncc, lh };
}

/**
 * [S1.201 / S3.6a] Nhóm hàng của tổ chức, dựng MỘT lần bởi người FINANCE (giữ `category.manage`): tổ chức đã bật không nộp duyệt
 * được gói không nhóm hàng. Tổ chức chưa bật nhận cùng nhóm — ở đó nó tuỳ chọn, và không phép đo nào ở tệp này đọc nó.
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

/** Gói DRAFT có ngân sách và một hạng mục, do `ai` tạo. */
async function goiNhap(t: ToChuc, giaTri: string = GOI_THUONG, ai: Nguoi = t.pm): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: ai.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: ai.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: ai.s });
  });
  return rfqId;
}

const nop = (t: ToChuc, rfqId: string, ai: Nguoi = t.pm): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: ai.s }, apiPool));
/** [S1.198 / khoản 256] Người duyệt gửi lại lần nộp VỪA ĐỌC — ở tổ chức đã bật, trigger `rfq_approvals_so_lan_nop` đòi nó. */
const duyet = (t: ToChuc, rfqId: string, ai: Nguoi): Promise<void> =>
  withTenant(apiPool, t.org, async (c) => {
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]?.n;
    await approveRfq(c, t.org, { rfqId, sessionId: ai.s, ...(lan === undefined ? {} : { lanNopDaXem: lan }) }, apiPool);
  });
const mo = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
const traVe = (t: ToChuc, rfqId: string, ai: Nguoi, reason: string = LY_DO): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => returnRfqToDraft(c, t.org, { rfqId, reason, actorSessionId: ai.s }, apiPool));

/** Câu chèn lời mời của `createInvitation`, nguyên cột. */
const CAU_MOI =
  "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
  "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id";

async function moi(t: ToChuc, rfqId: string, n: NhaCungCap): Promise<string> {
  return (await withTenant(apiPool, t.org, (c) => c.query<{ id: string }>(CAU_MOI, [t.org, rfqId, n.ncc, n.lh, t.pm.u, t.pm.s]))).rows[0]!.id;
}

async function thuHoi(t: ToChuc, invId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) =>
    c.query(
      "UPDATE public.rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 " +
        "WHERE id = $1 AND revoked_at IS NULL",
      [invId, t.pm.u, t.pm.s],
    ),
  );
}

/** Câu đúc token của `issueMagicLinkToken`, nguyên cột — cột `duc_khi_goi_da_mo` KHÔNG có trong câu. */
const CAU_TOKEN =
  "INSERT INTO public.rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
  "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id, duc_khi_goi_da_mo, created_at";

interface HangToken {
  readonly id: string;
  readonly duc_khi_goi_da_mo: boolean;
  readonly created_at: Date;
}

async function token(t: ToChuc, invId: string): Promise<HangToken> {
  return (await withTenant(apiPool, t.org, (c) => c.query<HangToken>(CAU_TOKEN, [t.org, invId, randomBytes(32), t.pm.u, t.pm.s]))).rows[0]!;
}

interface LoiBat {
  readonly ten: string;
  readonly message: string;
  readonly code: string;
}

async function loi(p: Promise<unknown>): Promise<LoiBat | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string };
    return { ten: x.name, message: x.message, code: x.code ?? "" };
  }
}

async function trangThaiGoi(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

async function trangThaiTrigger(trigger: string): Promise<string> {
  return (await db.pool.query<{ e: string }>("SELECT tgenabled AS e FROM pg_trigger WHERE tgname = $1", [trigger])).rows[0]!.e;
}

/** Hàng sổ của một hành động trên một tài nguyên, theo thứ tự ghi. */
async function soCua(action: string, resourceId: string): Promise<{ actor: string; payload: Record<string, unknown> }[]> {
  const { rows } = await db.pool.query<{ actor: string; payload: Record<string, unknown> }>(
    "SELECT actor_id AS actor, payload FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at, id",
    [action, resourceId],
  );
  return rows;
}

/** ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK — khuôn `trongDotBien` của `danh-sach-moi`. */
async function trongDotBien<T>(org: string, dotBien: readonly string[], viec: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    for (const cau of dotBien) await c.query(cau);
    await c.query("SET LOCAL ROLE app_api");
    await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
    return await viec(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

/** Câu UPDATE thô của cạnh — thứ trigger thấy, không qua tầng gói. */
const CAU_VE_NHAP = "UPDATE public.rfq_packages SET status = 'DRAFT' WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING status";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

// =============================================================================================
// (1) K4a — CẠNH VỀ DRAFT: AI, VÌ SAO, VÀ CHỈ Ở TỔ CHỨC ĐÃ BẬT
// =============================================================================================
describe("S3.2b1 — K4a: cạnh `PENDING_APPROVAL→DRAFT` chỉ ở tổ chức đã bật, có người và có lý do", () => {
  it("[INV-K4a] người TẠO trả gói về DRAFT: một hàng sổ mang lý do và người trả; ở DRAFT danh sách lại đổi được, và nộp lại được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const giu = await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    expect((await loi(moi(t, rfqId, await nhaCungCap(t))))?.message, "PENDING_APPROVAL: danh sách khoá").toMatch(/\(K4a\)$/);

    await traVe(t, rfqId, t.pm);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
    expect(await soCua("RFQ_RETURNED_TO_DRAFT", rfqId)).toEqual([{ actor: t.pm.u, payload: { reason: LY_DO } }]);

    // Đúng lý do tồn tại của cạnh: ở DRAFT danh sách THÊM và THU HỒI được lại (K4a), rồi nộp lại.
    await moi(t, rfqId, await nhaCungCap(t));
    await thuHoi(t, giu);
    await nop(t, rfqId);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4a] người giữ `rfq.approve` KHÁC người tạo trả về được; BUYER không phải người tạo ⇒ từ chối VÀO SỔ trên `rfq.approve`; FINANCE cũng thế", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời tới nhà cung cấp đếm được: K2 không cho gói không lời mời rời DRAFT.
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);

    for (const ai of [t.mua, t.tc]) {
      const truoc = (await db.pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM audit_events WHERE action = 'PERMISSION_DENIED' AND actor_id = $1 AND payload ->> 'permission' = 'rfq.approve'",
        [ai.u],
      )).rows[0]!.n;
      const l = await loi(traVe(t, rfqId, ai));
      expect(l?.ten, "không phải người tạo, không giữ rfq.approve").toBe("PermissionDeniedError");
      const sau = (await db.pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM audit_events WHERE action = 'PERMISSION_DENIED' AND actor_id = $1 AND payload ->> 'permission' = 'rfq.approve'",
        [ai.u],
      )).rows[0]!.n;
      expect(Number(sau) - Number(truoc), "mỗi lần từ chối một hàng sổ (D5)").toBe(1);
      expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    }

    await traVe(t, rfqId, t.pm2);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
    expect((await soCua("RFQ_RETURNED_TO_DRAFT", rfqId)).map((h) => h.actor)).toEqual([t.pm2.u]);
  });

  it("[INV-K4a] BUYER là người TẠO thì trả về được — nhánh người tạo đòi `rfq.create`, không đòi `rfq.approve`", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_THUONG, t.mua);
    // [S1.266 / S3.3c1] Một lời mời tới nhà cung cấp đếm được (người mời như mọi lời mời của tệp: PM) — K2.
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId, t.mua);
    await traVe(t, rfqId, t.mua);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
  });

  it("[INV-K4a] lý do rỗng ⇒ từ chối có tên, gói ở nguyên, không hàng sổ nào", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời tới nhà cung cấp đếm được — K2.
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    for (const lyDo of ["", "   "]) {
      const l = await loi(traVe(t, rfqId, t.pm, lyDo));
      expect([l?.ten, l?.message]).toEqual(["RfqError", "reason không được rỗng"]);
    }
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    expect(await soCua("RFQ_RETURNED_TO_DRAFT", rfqId)).toEqual([]);
  });

  it("[INV-K4a] gói không ở PENDING_APPROVAL — DRAFT, OPEN — ⇒ từ chối trạng thái, không ghi gì", async () => {
    const t = await toChucDaBat();
    const nhap = await goiNhap(t);
    expect((await loi(traVe(t, nhap, t.pm)))?.message).toBe(LOI_NGUON);

    const daMo = await goiNhap(t);
    await moi(t, daMo, await nhaCungCap(t));
    await nop(t, daMo);
    await duyet(t, daMo, t.pm2);
    await mo(t, daMo);
    expect((await loi(traVe(t, daMo, t.pm)))?.message).toBe(LOI_NGUON);
    expect(await trangThaiGoi(daMo)).toBe("OPEN");
    expect([...(await soCua("RFQ_RETURNED_TO_DRAFT", nhap)), ...(await soCua("RFQ_RETURNED_TO_DRAFT", daMo))]).toEqual([]);
  });

  it("[INV-K4a] tổ chức CHƯA BẬT: tầng gói từ chối có tên và KHÔNG vào sổ; câu UPDATE thô dưới `app_api` bị trigger chặn", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const truoc = (await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1", [t.org])).rows[0]!.n;
    expect((await loi(traVe(t, rfqId, t.pm)))?.message).toBe(LOI_CHUA_BAT);
    const sau = (await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1", [t.org])).rows[0]!.n;
    expect(sau, "cấu hình chưa sẵn sàng không vào sổ (ADR-060)").toBe(truoc);

    const tho = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_VE_NHAP, [rfqId])));
    expect([tho?.code, tho?.message]).toEqual(["23514", LOI_TRIGGER]);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4a] ĐỘT BIẾN: tắt `rfq_packages_tra_ve_nhap_chi_khi_bat_s3` thì câu thô ở tổ chức chưa bật đi lọt — MVP1 có đường về DRAFT; trigger còn ALWAYS thì bị chặn", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const khiTat = await trongDotBien(
      t.org,
      ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_tra_ve_nhap_chi_khi_bat_s3"],
      async (c) => (await c.query<{ status: string }>(CAU_VE_NHAP, [rfqId])).rows[0]?.status,
    );
    expect(khiTat, "trigger tắt thì tổ chức chưa bật cũng về DRAFT được").toBe("DRAFT");
    expect(await trangThaiTrigger("rfq_packages_tra_ve_nhap_chi_khi_bat_s3")).toBe("A");
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_VE_NHAP, [rfqId]))))?.message).toBe(LOI_TRIGGER);
  });

  it("tiền đề của cổng `rfq.create` ở route: MỌI vai giữ `rfq.approve` cũng giữ `rfq.create` — một vai duyệt không tạo được sẽ bị chặn oan ở cổng", async () => {
    const { rows } = await db.pool.query<{ vai: string }>(
      "SELECT a.role_code AS vai FROM role_permissions a WHERE a.permission_code = 'rfq.approve' " +
        "AND NOT EXISTS (SELECT 1 FROM role_permissions b WHERE b.role_code = a.role_code AND b.permission_code = 'rfq.create')",
    );
    expect(rows, "vai giữ rfq.approve mà không giữ rfq.create — cổng của route phải đổi").toEqual([]);
    const { rows: coDuyet } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM role_permissions WHERE permission_code = 'rfq.approve'",
    );
    expect(Number(coDuyet[0]!.n), "đối chứng: có vai giữ rfq.approve").toBeGreaterThan(0);
  });
});

// =============================================================================================
// (2) K4b — CHỮ KÝ CŨ Ở LẠI, MẤT HIỆU LỰC BẰNG BĂM; NGƯỜI KÝ KÝ LẠI ĐƯỢC
// =============================================================================================
describe("S3.2b1 — K4b: về DRAFT không xoá chữ ký; chữ ký cũ chỉ đếm khi nội dung và danh sách y nguyên", () => {
  it("[INV-K4b] ký → trả về → THÊM một lời mời → nộp lại: chữ ký cũ không đếm, người ấy ký lại được, rồi mở — hai hàng chữ ký ở lại", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm2);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe("RFQ nay can 1 chu ky TREN DANH SACH MOI HIEN TAI, moi co 0 (K4b)");
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM rfq_approvals WHERE rfq_id = $1", [rfqId]);
    expect(rows[0]!.n, "không chữ ký nào bị xoá").toBe("2");
  });

  it("[INV-K4b] trả về rồi nộp lại mà KHÔNG đổi gì: chữ ký cũ vẫn đếm — người duyệt đã ký đúng thứ ấy", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm);
    await nop(t, rfqId);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  it("[INV-K4b] gói cấp kép: trả về rồi SỬA HẠNG MỤC — hai chữ ký cũ không đếm (băm nội dung), cả hai người ký lại được, rồi mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await duyet(t, rfqId, t.pm3);
    await traVe(t, rfqId, t.pm);
    await withTenant(apiPool, t.org, (c) =>
      addRfqItem(c, t.org, { rfqId, lineNo: 2, description: "Bu long M20", quantity: "40.0000", unit: "bo", actorSessionId: t.pm.s }),
    );
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toMatch(/can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 0 \(D2\)/);
    await duyet(t, rfqId, t.pm2);
    await duyet(t, rfqId, t.pm3);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });
});

// =============================================================================================
// (3) K6 / khoản 253 — TOKEN GHI LẠI, LÚC ĐÚC, GÓI ĐÃ MỞ CHƯA
// =============================================================================================
describe("S3.2b1 — K6: cột `duc_khi_goi_da_mo` ghi đúng điều K6 hỏi, lúc đúc, cho mọi tổ chức", () => {
  it("[INV-K6] tổ chức chưa bật: token đúc ở DRAFT mang `false`, ở OPEN mang `true`; tổ chức đã bật: ở OPEN mang `true`", async () => {
    const mvp1 = await taoToChuc();
    const g = await goiNhap(mvp1);
    const a = await moi(mvp1, g, await nhaCungCap(mvp1));
    expect((await token(mvp1, a)).duc_khi_goi_da_mo).toBe(false);
    await nop(mvp1, g);
    await duyet(mvp1, g, mvp1.pm2);
    await mo(mvp1, g);
    expect((await token(mvp1, a)).duc_khi_goi_da_mo).toBe(true);

    const s3 = await toChucDaBat();
    const h = await goiNhap(s3);
    const b = await moi(s3, h, await nhaCungCap(s3));
    await nop(s3, h);
    await duyet(s3, h, s3.pm2);
    await mo(s3, h);
    expect((await token(s3, b)).duc_khi_goi_da_mo).toBe(true);
  });

  it("[INV-K6] `app_api` không khai được cột lúc đúc và không sửa được nó về sau", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    const a = await moi(t, g, await nhaCungCap(t));
    const khai = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO public.rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id, duc_khi_goi_da_mo) " +
            "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5, true)",
          [t.org, a, randomBytes(32), t.pm.u, t.pm.s],
        ),
      ),
    );
    expect(khai?.code).toBe("42501");
    const tk = await token(t, a);
    const sua = await loi(
      withTenant(apiPool, t.org, (c) => c.query("UPDATE public.rfq_invitation_tokens SET duc_khi_goi_da_mo = true WHERE id = $1", [tk.id])),
    );
    expect(sua?.code).toBe("42501");
  });

  it("[INV-K6] ĐUA: giao dịch đúc BẮT ĐẦU trước lần mở gói và đúc SAU khi lần mở commit — `created_at` sớm hơn `opened_at`, cột vẫn `true`", async () => {
    const t = await toChucDaBat();
    const g = await goiNhap(t);
    await moi(t, g, await nhaCungCap(t));
    await nop(t, g);
    await duyet(t, g, t.pm2);
    const n = await nhaCungCap(t);

    // Giao dịch mời mở TRƯỚC — `now()` của nó đứng yên ở đây —, rồi lần mở gói chạy và commit ở kết nối khác.
    const c = await apiPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [t.org]);
      await new Promise((r) => setTimeout(r, 20));
      await mo(t, g);
      const inv = (await c.query<{ id: string }>(CAU_MOI, [t.org, g, n.ncc, n.lh, t.pm.u, t.pm.s])).rows[0]!.id;
      const tk = (await c.query<HangToken>(CAU_TOKEN, [t.org, inv, randomBytes(32), t.pm.u, t.pm.s])).rows[0]!;
      await c.query("COMMIT");
      const { rows } = await db.pool.query<{ o: Date }>("SELECT opened_at AS o FROM rfq_packages WHERE id = $1", [g]);
      expect(tk.created_at.getTime(), "phép so thời gian sẽ giết link này").toBeLessThan(rows[0]!.o.getTime());
      expect(tk.duc_khi_goi_da_mo, "trigger thấy gói đã mở lúc đúc").toBe(true);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  });

  it("[INV-K6] ĐỘT BIẾN: tắt `rfq_invitation_tokens_ghi_goi_da_mo` thì token đúc cho gói ĐÃ MỞ mang `false` — lần đổi link của tổ chức đã bật sẽ giết nó", async () => {
    const t = await toChucDaBat();
    const g = await goiNhap(t);
    const a = await moi(t, g, await nhaCungCap(t));
    await nop(t, g);
    await duyet(t, g, t.pm2);
    await mo(t, g);
    const khiTat = await trongDotBien(
      t.org,
      ["ALTER TABLE public.rfq_invitation_tokens DISABLE TRIGGER rfq_invitation_tokens_ghi_goi_da_mo"],
      async (c) => (await c.query<HangToken>(CAU_TOKEN, [t.org, a, randomBytes(32), t.pm.u, t.pm.s])).rows[0]!.duc_khi_goi_da_mo,
    );
    expect(khiTat).toBe(false);
    expect(await trangThaiTrigger("rfq_invitation_tokens_ghi_goi_da_mo")).toBe("A");
    expect((await token(t, a)).duc_khi_goi_da_mo).toBe(true);
  });
});
