import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, approveRfq, createRfq, datSoNgayGiao, openRfq, returnRfqToDraft, submitRfqForApproval } from "./rfq.js";
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

// =============================================================================================
// (4) [S1.279 / S4.7a / L16 / ADR-153] SỐ NGÀY GIAO YÊU CẦU — CHỈ ĐỔI Ở DRAFT, NẰM TRONG CHỮ KÝ; CẠNH MỞ ĐÒI NÓ KHI PHIÊN BẢN TÍNH
// CHI PHÍ TRỄ
//
// Tệp này vì đường duy nhất đổi số ngày giao SAU khi đã ký là cạnh trả về DRAFT của tổ chức đã bật (MVP1 không có đường về): ký ở 30
// ngày, trả về, đổi thành 7, nộp lại — `title` và hạng mục y nguyên nên `approved_content_hash` không đổi, và trước `112` chữ ký cũ
// mở được gói. Chủ dự án chốt 2026-10-07: băm riêng ở MỌI tổ chức, trigger riêng, không định nghĩa lại `rfq_bam_noi_dung`.
// =============================================================================================
const datNgay = (t: ToChuc, rfqId: string, n: number | null, ai: Nguoi = t.pm): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => datSoNgayGiao(c, t.org, { rfqId, soNgayGiao: n, actorSessionId: ai.s }));
const LOI_NGAY_GIAO = (can: number, co: number): string => `RFQ nay can ${String(can)} NGUOI KY TREN NOI DUNG VA SO NGAY GIAO HIEN TAI, moi co ${String(co)} (L16)`;
/** [rà soát §S1.279 — CAO-2] Ở tổ chức đã bật, số ngày giao nằm trong chính chữ ký còn hiệu lực — K4b nói lời từ chối. */
const LOI_HIEU_LUC = (can: number, co: number): string =>
  `RFQ nay can ${String(can)} chu ky CON HIEU LUC — ky tren lan nop da xem, nguoi ky chua tra goi ve tu lan ay —, moi co ${String(co)} (K4b)`;

/** Phiên bản kế tiếp của tổ chức chưa bật, do `pm` khai qua tầng gói: trọng số TCO và nhóm khoá `tco`. */
async function phienBanTco(t: ToChuc, version: number, evalComponents: readonly Record<string, string>[], tco: Record<string, string> | null): Promise<void> {
  await withTenant(apiPool, t.org, (c) =>
    createProcurementPolicy(c, t.org, {
      version,
      dualApprovalThreshold: "100000000.00",
      currency: "VND",
      evalComponents: evalComponents as never,
      bafoTopN: 0,
      tco,
      actorSessionId: t.pm.s,
    }),
  );
}
const TP_TRE = [
  { ma: "gia", don_vi: "TIEN", he_so: "1.0000" },
  { ma: "chi_phi_tre", don_vi: "TIEN", he_so: "1.0000" },
];

describe("S4.7a — L16: số ngày giao yêu cầu chỉ đổi ở DRAFT và nằm trong chữ ký phê duyệt", () => {
  it("[INV-L16] đặt, đổi, xoá ở DRAFT — mỗi lần một hàng sổ; ngoài miền ⇒ từ chối có tên; đã nộp duyệt ⇒ tầng gói từ chối trạng thái, câu thô bị trigger chặn", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await datNgay(t, rfqId, 14);
    await datNgay(t, rfqId, null);
    await datNgay(t, rfqId, 21);
    expect((await soCua("RFQ_DELIVERY_DAYS_SET", rfqId)).map((h) => [h.actor, h.payload])).toEqual([
      [t.pm.u, { soNgayGiao: 30 }],
      [t.pm.u, { soNgayGiao: 14 }],
      [t.pm.u, { soNgayGiao: null }],
      [t.pm.u, { soNgayGiao: 21 }],
    ]);
    for (const sai of [0, 3651, 1.5]) {
      expect((await loi(datNgay(t, rfqId, sai)))?.message).toBe("số ngày giao yêu cầu phải là số nguyên từ 1 đến 3650");
    }
    await expect(
      withTenant(apiPool, t.org, (c) => c.query("UPDATE public.rfq_packages SET so_ngay_giao = 0 WHERE id = $1", [rfqId])),
    ).rejects.toMatchObject({ code: "23514", constraint: "rfq_packages_so_ngay_giao_mien" });

    await nop(t, rfqId);
    expect((await loi(datNgay(t, rfqId, 7)))?.message).toBe(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không còn ở trạng thái soạn thảo",
    );
    await expect(
      withTenant(apiPool, t.org, (c) => c.query("UPDATE public.rfq_packages SET so_ngay_giao = 7 WHERE id = $1", [rfqId])),
    ).rejects.toMatchObject({ code: "23514", constraint: "so_ngay_giao_chi_doi_o_draft" });
    expect((await db.pool.query<{ n: number }>("SELECT so_ngay_giao AS n FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]?.n).toBe(21);
  });

  it("[INV-L16] ĐỘT BIẾN: tắt `rfq_packages_so_ngay_giao` thì câu thô đổi được số ngày giao của gói đã nộp duyệt", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await nop(t, rfqId);
    const doi = await trongDotBien(t.org, ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_so_ngay_giao"], async (c) =>
      (await c.query<{ n: number }>("UPDATE public.rfq_packages SET so_ngay_giao = 7 WHERE id = $1 RETURNING so_ngay_giao AS n", [rfqId])).rows[0]
        ?.n,
    );
    expect(doi).toBe(7);
    expect(await trangThaiTrigger("rfq_packages_so_ngay_giao")).toBe("A");
  });

  it("[INV-L16] ký ở 30 ngày → trả về → đổi thành 7 → nộp lại: chữ ký cũ KHÔNG mở được gói; người ấy ký lại được (hàng mới), rồi mở — hai hàng chữ ký ở lại", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm);
    await datNgay(t, rfqId, 7);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_HIEU_LUC(1, 0));
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM rfq_approvals WHERE rfq_id = $1", [rfqId]);
    expect(rows[0]!.n, "không chữ ký nào bị xoá").toBe("2");
  });

  it("[INV-L16] đối chứng: trả về rồi nộp lại mà KHÔNG đổi số ngày giao — chữ ký cũ vẫn mở được gói", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm);
    await nop(t, rfqId);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  it("[INV-L16] gói cấp kép: một người ký lại trên số ngày giao mới không đủ — đếm NGƯỜI có chữ ký còn hiệu lực, không đếm hàng (D2 đếm hai hàng của cùng người); người thứ hai ký lại thì mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await datNgay(t, rfqId, 30);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await duyet(t, rfqId, t.pm3);
    await traVe(t, rfqId, t.pm);
    await datNgay(t, rfqId, 7);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_HIEU_LUC(2, 0));
    await duyet(t, rfqId, t.pm2);
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_HIEU_LUC(2, 1));
    await duyet(t, rfqId, t.pm3);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  // [S1.281 / S3.4a / K9] Năm vế *khớp băm* (kể cả vế số ngày giao) nay ở `rfq_chu_ky_khop_bam` (`114`); `rfq_chu_ky_con_hieu_luc` đọc nó
  // rồi loại người có xung đột — đột biến áp ở hàm mang vế.
  it("[INV-L16] ĐỘT BIẾN: bỏ vế số ngày giao khỏi `rfq_chu_ky_khop_bam` thì chữ ký trên 30 ngày mở được gói đã đổi thành 7 — đúng lỗ vế ấy đóng", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm);
    await datNgay(t, rfqId, 7);
    await nop(t, rfqId);
    const goc = (await db.pool.query<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE oid = 'public.rfq_chu_ky_khop_bam(uuid, uuid)'::regprocedure"))
      .rows[0]!.src;
    const ve = "\n     AND a.approved_delivery_hash = public.rfq_bam_giao_hang(p_rfq)";
    expect(goc, "tiền đề: thân hàm mang đúng vế số ngày giao").toContain(ve);
    const khiBo = await trongDotBien(
      t.org,
      [
        "CREATE OR REPLACE FUNCTION public.rfq_chu_ky_khop_bam(p_org uuid, p_rfq uuid) RETURNS SETOF uuid LANGUAGE sql STABLE " +
          `SET search_path = pg_catalog, public AS $f$${goc.replace(ve, "")}$f$`,
      ],
      (c) => loi(openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool)),
    );
    expect(khiBo, "bỏ vế: chữ ký cũ mở được gói").toBeNull();
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_HIEU_LUC(1, 0));
  });

  it("[INV-L16] [rà soát §S1.279 — CAO-2] hiệu lực và số ngày giao xét trên CÙNG một hàng: chữ ký đã bị chính người ký rút trên 10 ngày không sống lại nhờ một chữ ký còn hiệu lực trên 20 ngày", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 10);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm2);
    await datNgay(t, rfqId, 20);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm);
    await datNgay(t, rfqId, 10);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message, "chữ ký trên 10 ngày đã bị rút; chữ ký còn hiệu lực ở trên 20 ngày").toBe(LOI_HIEU_LUC(1, 0));
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  it("[INV-L16] tổ chức CHƯA bật: lớp đếm người ký trên số ngày giao ở cạnh mở — số ngày giao đổi sau khi ký (đường ghi thứ hai, trigger DRAFT tắt) thì gói không mở; ĐỐI CHỨNG: không đổi thì mở", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    const khiDoi = await trongDotBien(
      t.org,
      [
        "ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_so_ngay_giao",
        `UPDATE public.rfq_packages SET so_ngay_giao = 7 WHERE id = '${rfqId}'`,
      ],
      (c) => loi(openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool)),
    );
    expect(khiDoi?.message).toBe(LOI_NGAY_GIAO(1, 0));
    expect(await trangThaiTrigger("rfq_packages_so_ngay_giao")).toBe("A");
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  it("[INV-L16] ĐỘT BIẾN: băm số ngày giao bỏ đọc gói (`rfq_bam_giao_hang` trả hằng) thì chữ ký trên 30 ngày mở được gói đã đổi thành 7", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await datNgay(t, rfqId, 30);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    const khiHang = await trongDotBien(
      t.org,
      [
        "CREATE OR REPLACE FUNCTION public.rfq_bam_giao_hang(p_rfq uuid) RETURNS bytea LANGUAGE sql STABLE " +
          "SET search_path = pg_catalog, public AS $f$SELECT pg_catalog.sha256(pg_catalog.convert_to('GIAO_HANG|', 'UTF8'))$f$",
      ],
      async (c) => {
        const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]?.n;
        await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s, ...(lan === undefined ? {} : { lanNopDaXem: lan }) }, apiPool);
        await returnRfqToDraft(c, t.org, { rfqId, reason: LY_DO, actorSessionId: t.pm.s }, apiPool);
        await datSoNgayGiao(c, t.org, { rfqId, soNgayGiao: 7, actorSessionId: t.pm.s });
        await submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool);
        return loi(openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
      },
    );
    expect(khiHang, "băm hằng: chữ ký trên 30 ngày mở được gói 7 ngày").toBeNull();
    // Đột biến đã ROLLBACK — cùng chuỗi trên băm thật bị từ chối (ca «ký ở 30 ngày → … → đổi thành 7» ở trên).
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
  });
});

describe("S4.7a — L16: phiên bản ghim tính chi phí trễ thì gói phải khai số ngày giao trước khi mở", () => {
  it("[INV-L16] tầng gói từ chối CẤU HÌNH có tên trước lần đúc khoá, không vào sổ; câu thô bị trigger chặn với tên ràng buộc; ĐỐI CHỨNG: gói khai số ngày giao thì mở và chụp tập mã", async () => {
    const t = await taoToChuc();
    await phienBanTco(t, 2, TP_TRE, { ty_le_tre_ngay: "0.001" });
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    // Tổ chức chưa bật: không có cạnh về DRAFT, nên lời từ chối không chỉ lối ấy (rà soát §S1.279 — TRUNG-5).
    expect((await loi(mo(t, rfqId)))?.message).toBe(
      "Phiên bản chính sách đang hiệu lực tính chi phí trễ giao, mà gói thầu chưa khai số ngày giao yêu cầu (L16) — " +
        "số ngày giao chỉ khai được khi soạn, và gói đã nộp duyệt không trả về soạn thảo được ở tổ chức chưa bật kiểm soát S3: " +
        "gói này chỉ còn lối huỷ; khai số ngày giao cho gói soạn mới.",
    );
    const { rows: khoa } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM rfq_key_material WHERE rfq_id = $1", [rfqId]);
    expect(khoa[0]!.n, "từ chối TRƯỚC lần đúc khoá (khoản 31)").toBe("0");
    expect(await soCua("CONTROL_DENIED", rfqId), "từ chối cấu hình không vào sổ (L12)").toEqual([]);
    await expect(
      withTenant(apiPool, t.org, async (c) => {
        await c.query(
          "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
            "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
          [t.org, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), t.pm.u, t.pm.s],
        );
        await c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
          [rfqId, t.pm.u, t.pm.s],
        );
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "tco_thieu_so_ngay_giao" });
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");

    const coNgay = await goiNhap(t);
    await datNgay(t, coNgay, 14);
    await nop(t, coNgay);
    await duyet(t, coNgay, t.pm2);
    expect(await loi(mo(t, coNgay))).toBeNull();
    const { rows } = await db.pool.query<{ m: string[] }>("SELECT tco_ma_ghim AS m FROM rfq_packages WHERE id = $1", [coNgay]);
    expect(rows[0]!.m).toEqual(["gia", "chi_phi_tre"]);
  });
});

describe("S4.7a — nhóm khoá `tco` của phiên bản chính sách: hình dạng và biên ở CSDL", () => {
  it("[INV-L8] chỉ ba khoá, mọi giá trị là chuỗi, hai khoá thanh toán đi cùng nhau, ba biên; object rỗng bị từ chối — mỗi ca qua `createProcurementPolicy`", async () => {
    const t = await taoToChuc();
    let v = 2;
    const tao = async (tco: Record<string, string> | null): Promise<LoiBat | null> => {
      const kq = await loi(
        withTenant(apiPool, t.org, (c) =>
          createProcurementPolicy(c, t.org, { version: v, dualApprovalThreshold: "100000000.00", currency: "VND", tco, actorSessionId: t.pm.s }),
        ),
      );
      if (kq === null) v += 1;
      return kq;
    };
    const hopLe: readonly Record<string, string>[] = [
      { ty_le_tre_ngay: "0.001" },
      { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "60" },
      { chi_phi_von_nam: "1", ngay_thanh_toan_chuan: "0", ty_le_tre_ngay: "0.1" },
      { chi_phi_von_nam: "0.0001", ngay_thanh_toan_chuan: "365", ty_le_tre_ngay: "0.000001" },
    ];
    for (const hop of hopLe) {
      expect(await tao(hop), JSON.stringify(hop)).toBeNull();
    }
    const khongHop: readonly Record<string, string>[] = [
      {},
      { bao_hanh: "0.1" },
      { chi_phi_von_nam: "0.12" },
      { ngay_thanh_toan_chuan: "60" },
      { chi_phi_von_nam: "0", ngay_thanh_toan_chuan: "60" },
      { chi_phi_von_nam: "1.5", ngay_thanh_toan_chuan: "60" },
      { chi_phi_von_nam: "0.12345", ngay_thanh_toan_chuan: "60" },
      { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "366" },
      { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "060" },
      { ty_le_tre_ngay: "0" },
      { ty_le_tre_ngay: "0.2" },
      { ty_le_tre_ngay: "0.0000001" },
      { ty_le_tre_ngay: "1e-3" },
    ];
    for (const sai of khongHop) {
      const kq = await tao(sai);
      expect(kq?.code, JSON.stringify(sai)).toBe("23514");
      expect(kq?.message, JSON.stringify(sai)).toContain("org_procurement_policies_tco_hinh_dang");
    }
    // Hình dạng NGOÀI ở tầng gói: một giá trị không phải chuỗi không tới được CSDL.
    expect((await tao({ ty_le_tre_ngay: 0.001 } as never))?.message).toBe("mọi giá trị của tco phải là chuỗi");
    // Không `UPDATE`: đổi tham số là một phiên bản mới.
    await expect(
      withTenant(apiPool, t.org, (c) => c.query("UPDATE org_procurement_policies SET tco = '{\"ty_le_tre_ngay\":\"0.002\"}' WHERE org_id = $1", [t.org])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
