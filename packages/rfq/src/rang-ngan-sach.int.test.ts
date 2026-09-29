import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, approveRfq, createRfq, openRfq, returnRfqToDraft, submitRfqForApproval } from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

// =============================================================================================
// [S1.192 / khoản 254] CHỮ KÝ MỞ GÓI RÀNG VÀO NGÂN SÁCH (K4b, D2) — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `079_rang_ngan_sach`. Cạnh về DRAFT (`077`) mở lại ngân sách, mà băm nội dung (`011`) và băm danh sách (`076`)
// đều không mang nó. ĐO TRƯỚC trên `master` `8f90bf2`: hai ca đầu dưới đây MỞ ĐƯỢC gói — gói cấp kép hạ về một chữ ký mở
// bằng chữ ký cũ, và gói 1 triệu nâng lên 99 triệu mở bằng chữ ký trên con số 1 triệu.
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG: công tắc ADR-080 một chiều. Đột biến ở HÀM sửa toàn cục rồi trả lại trong `finally`, vì
// kịch bản đi qua nhiều giao dịch của tầng gói — các ca trong một tệp chạy nối tiếp; đột biến ở RÀNG BUỘC chạy trong MỘT giao
// dịch rồi ROLLBACK.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `tra-ve-nhap.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo cạnh mở gói.
const boBocGia = {
  name: "gia-cho-test-rang-ngan-sach",
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

/** Bảng bậc tối thiểu, khuôn `tra-ve-nhap`. */
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
/** Ngưỡng kép của chính sách là 100 triệu: dưới ngưỡng một chữ ký, từ ngưỡng hai. */
const GOI_THUONG = "1000000.00";
const GOI_THUONG_LON = "99000000.00";
const GOI_CAP_KEP = "150000000.00";
const LY_DO = "nguoi duyet tra ve: xem lai uoc luong";
const LOI_NGAN_SACH_1 = "RFQ nay can 1 chu ky TREN NGAN SACH HIEN TAI, moi co 0 (K4b)";

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
  /** FINANCE — người ký phiên bản chính sách. */
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
    `rns-${randomBytes(4).toString("hex")}`,
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
  const tc = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  return { org, pm, pm2, pm3, tc };
}

/** Phiên bản `version` có bậc, PM tạo, FINANCE ký — khuôn `batS3` của `tra-ve-nhap`. Trả id phiên bản. */
async function kyPhienBanCoBac(t: ToChuc, version: number): Promise<string> {
  const id = (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
          "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
          "VALUES ($1, $2, '100000000.00', 'VND', $3::jsonb, 30, 12, true, now(), $4, $5) RETURNING id",
        [t.org, version, JSON.stringify(BAC), t.pm.u, t.pm.s],
      ),
    )
  ).rows[0]!.id;
  await withTenant(apiPool, t.org, (c) =>
    c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
      t.org,
      id,
      t.tc.u,
      t.tc.s,
    ]),
  );
  return id;
}

async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  await kyPhienBanCoBac(t, 2);
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org]));
  expect(rows[0]?.b, "dàn cảnh: tổ chức phải ĐÃ BẬT").toBe(true);
  return t;
}

async function nhaCungCap(t: ToChuc): Promise<NhaCungCap> {
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

/** Gói DRAFT có ngân sách, một hạng mục và một lời mời, do PM tạo. */
async function goiNhap(t: ToChuc, giaTri: string = GOI_THUONG): Promise<string> {
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  const n = await nhaCungCap(t);
  await withTenant(apiPool, t.org, (c) =>
    c.query(
      "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6)",
      [t.org, rfqId, n.ncc, n.lh, t.pm.u, t.pm.s],
    ),
  );
  return rfqId;
}

const datNganSach = (t: ToChuc, rfqId: string, giaTri: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s }));
const nop = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
/** [S1.9101 / khoản 256] Người duyệt gửi lại lần nộp VỪA ĐỌC — ở tổ chức đã bật, trigger `rfq_approvals_so_lan_nop` đòi nó. */
const duyet = (t: ToChuc, rfqId: string, ai: Nguoi): Promise<void> =>
  withTenant(apiPool, t.org, async (c) => {
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]?.n;
    await approveRfq(c, t.org, { rfqId, sessionId: ai.s, ...(lan === undefined ? {} : { lanNopDaXem: lan }) }, apiPool);
  });
const mo = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
const traVe = (t: ToChuc, rfqId: string, reason: string = LY_DO): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => returnRfqToDraft(c, t.org, { rfqId, reason, actorSessionId: t.pm.s }, apiPool));

/** Câu chèn lời mời của `createInvitation`, nguyên cột — ở DRAFT, K4a cho qua. */
async function themLoiMoi(t: ToChuc, rfqId: string): Promise<string> {
  const n = await nhaCungCap(t);
  return (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
        [t.org, rfqId, n.ncc, n.lh, t.pm.u, t.pm.s],
      ),
    )
  ).rows[0]!.id;
}

/** Câu thu hồi lời mời của `revokeInvitation`, nguyên cột — ở DRAFT, K4a cho qua. */
async function thuHoiLoiMoi(t: ToChuc, invId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) =>
    c.query(
      "UPDATE public.rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 " +
        "WHERE id = $1 AND revoked_at IS NULL",
      [invId, t.pm.u, t.pm.s],
    ),
  );
}

/** Gói tự nâng lên hai chữ ký ở DRAFT — `true` luôn hợp lệ, nghiêm hơn chính sách là quyền của người mua (`014` §(4)). */
async function tuNangCapKep(t: ToChuc, rfqId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => c.query("UPDATE public.rfq_packages SET requires_dual_approval = true WHERE id = $1", [rfqId]));
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

async function soChuKy(rfqId: string): Promise<number> {
  return (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_approvals WHERE rfq_id = $1", [rfqId])).rows[0]!.n;
}

/**
 * ĐỘT BIẾN TOÀN CỤC một hàm: thay ĐÚNG một chỗ trong định nghĩa hiện tại, chạy việc, rồi dựng lại bản gốc. Kịch bản đi qua
 * nhiều giao dịch của tầng gói nên đột biến không gói được trong một giao dịch.
 */
async function voiHamDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>, soCho = 1): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG ${soCho} chỗ trong ${ham}`).toBe(soCho);
  await db.pool.query(goc.split(cu).join(moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
  }
}

/** Câu chèn chữ ký của `approveRfq`, nguyên cột — ba băm do trigger đặt; lần nộp đã xem là lần nộp hiện tại (khoản 256). */
const CAU_KY =
  "INSERT INTO public.rfq_approvals (org_id, rfq_id, approver_user_id, session_id, lan_nop_da_xem) " +
  "SELECT $1, $2, $3, $4, p.lan_nop FROM public.rfq_packages p WHERE p.id = $2";

/** ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK — khuôn `trongDotBien` của `tra-ve-nhap`. */
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

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

// =============================================================================================
// (1) HAI LỖ ĐO TRƯỚC TRÊN MASTER
// =============================================================================================
describe("S1.192 — K4b: chữ ký ràng vào ngân sách, ở tổ chức đã bật (khoản 254)", () => {
  it("[INV-K4b] [INV-D2] gói CẤP KÉP, một chữ ký: trả về, HẠ ngân sách xuống bậc một chữ ký, nộp lại ⇒ chữ ký cho lúc gói cần hai người KHÔNG mở được gói; chính người ấy ký lại trên ngân sách mới ⇒ mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    expect((await loi(mo(t, rfqId)))?.message, "gói cấp kép: một chữ ký chưa đủ").toMatch(
      /can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 1 \(D2\)/,
    );

    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message, "chữ ký trên ngân sách 150 triệu không mở gói 1 triệu").toBe(LOI_NGAN_SACH_1);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");

    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
    expect(await soChuKy(rfqId), "hai chữ ký của CÙNG một người, trên hai ngân sách — chữ ký cũ ở lại làm dấu vết").toBe(2);
  });

  it("[INV-K4b] CÙNG BẬC: nâng ước lượng sau khi ký — vẫn một chữ ký, mà chữ ký cũ nằm trên con số khác ⇒ không mở; trả về lần nữa, đặt lại ĐÚNG con số cũ ⇒ chữ ký cũ mở được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG_LON);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message, "chữ ký trên 1 triệu không mở gói 99 triệu").toBe(LOI_NGAN_SACH_1);

    // Ràng vào NGÂN SÁCH, không vào lần nộp: đặt lại đúng con số cũ thì chữ ký cũ nằm trên đúng ngân sách ấy.
    await traVe(t, rfqId, "tra lai con so cu");
    await datNganSach(t, rfqId, GOI_THUONG);
    await nop(t, rfqId);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
    expect(await soChuKy(rfqId), "một chữ ký, không ai ký lại").toBe(1);
  });

  it("[INV-K4b] [INV-D2] một người ký hai lần trên hai ngân sách vẫn là MỘT người: gói cấp kép không mở — khối đếm `count(*)` của `071` thấy hai hàng trên cùng nội dung, phép đếm DISTINCT ở cạnh mở gói thì không", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, "160000000.00");
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    expect(await soChuKy(rfqId), "UNIQUE mới cho người ấy ký lại trên ngân sách mới").toBe(2);
    // Lời của phép đếm ĐẦU (`076`) nói *danh sách* dù danh sách không đổi: phép đếm DISTINCT ấy là phép chặn ở đây.
    expect((await loi(mo(t, rfqId)))?.message).toBe("RFQ nay can 2 chu ky TREN DANH SACH MOI HIEN TAI, moi co 1 (K4b)");
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    await duyet(t, rfqId, t.pm3);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  it("[INV-K4b] [INV-D2] băm mang CỜ DUYỆT KÉP: gói tự nâng lên hai chữ ký, một người ký; trả về, đặt lại ĐÚNG ngân sách cũ — cờ tính lại về `false` — ⇒ chữ ký cho lúc gói cần hai người không mở được gói một chữ ký (lượt soi S1.192)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await tuNangCapKep(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    expect((await loi(mo(t, rfqId)))?.message, "gói tự nâng: một chữ ký chưa đủ").toMatch(
      /can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 1 \(D2\)/,
    );
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG);
    const { rows } = await db.pool.query<{ k: boolean }>("SELECT requires_dual_approval AS k FROM rfq_packages WHERE id = $1", [rfqId]);
    expect(rows[0]?.k, "đặt lại ngân sách tính lại cờ từ chính sách").toBe(false);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message, "cùng con số, cùng phiên bản, cùng bậc — chỉ cờ khác").toBe(LOI_NGAN_SACH_1);
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });

  it("[INV-K4b] chữ ký ràng vào BỘ BA (nội dung, danh sách, ngân sách), không ghép được từ hai chữ ký: PM2 ký (L1, 1 triệu), PM3 ký (L2, 99 triệu); trả về, thu hồi lời mời vừa thêm ⇒ gói ở (L1, 99 triệu) — chưa ai ký — không mở (lượt soi S1.192)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    const them = await themLoiMoi(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG_LON);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm3);
    await traVe(t, rfqId);
    await thuHoiLoiMoi(t, them);
    await nop(t, rfqId);
    // Phép đếm đầu (nội dung, danh sách) thấy PM2; phép đếm thứ hai (cả ngân sách) không thấy ai.
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_NGAN_SACH_1);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4b] băm ngân sách mang PHIÊN BẢN CHÍNH SÁCH: cùng con số, cùng bậc, cùng ngưỡng mà ghim sang phiên bản mới ⇒ chữ ký cũ không mở được; ký lại ⇒ mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, "ghim phien ban moi");
    // Phiên bản 3 y hệt phiên bản 2 (bậc, ngưỡng kép); FINANCE ký — nay là phiên bản hiệu lực, và lần đặt ngân sách ghim nó.
    const v3 = await kyPhienBanCoBac(t, 3);
    await datNganSach(t, rfqId, GOI_THUONG);
    const { rows } = await db.pool.query<{ p: string }>("SELECT policy_id AS p FROM rfq_budgets WHERE rfq_id = $1", [rfqId]);
    expect(rows[0]?.p, "ngân sách ghim phiên bản 3").toBe(v3);
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_NGAN_SACH_1);
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });
});

// =============================================================================================
// (2) CỘT, VẾ NULL VÀ HÀNG CŨ
// =============================================================================================
describe("S1.192 — cột `approved_budget_hash`: trigger đặt lúc ký, ngoài GRANT, NULL ở tổ chức chưa bật, không điền hàng cũ", () => {
  it("[INV-K4b] tổ chức đã bật: chữ ký mang băm ngân sách LÚC KÝ; `app_api` không khai được cột. Tổ chức chưa bật: NULL, và một người vẫn chỉ ký được một lần", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    const { rows } = await db.pool.query<{ khop: boolean | null }>(
      "SELECT a.approved_budget_hash = public.rfq_bam_ngan_sach(a.rfq_id) AS khop FROM rfq_approvals a WHERE a.rfq_id = $1",
      [rfqId],
    );
    expect(rows, "một chữ ký, mang đúng băm ngân sách lúc ký").toEqual([{ khop: true }]);

    const khai = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id, approved_budget_hash) VALUES ($1, $2, $3, $4, $5)",
          [t.org, rfqId, t.pm3.u, t.pm3.s, Buffer.alloc(32)],
        ),
      ),
    );
    expect(khai?.code, "cột ngoài GRANT").toBe("42501");

    const mvp1 = await taoToChuc();
    const g = await goiNhap(mvp1);
    await nop(mvp1, g);
    await duyet(mvp1, g, mvp1.pm2);
    const { rows: r1 } = await db.pool.query<{ b: Buffer | null }>("SELECT approved_budget_hash AS b FROM rfq_approvals WHERE rfq_id = $1", [g]);
    expect(r1, "tổ chức chưa bật: NULL").toEqual([{ b: null }]);
    const lan2 = await loi(duyet(mvp1, g, mvp1.pm2));
    expect(lan2, "MVP1: `NULLS NOT DISTINCT` giữ một người một lần").not.toBeNull();
    expect(await soChuKy(g)).toBe(1);
  });

  it("[INV-K4b] KHÔNG ĐIỀN HÀNG CŨ, fail-closed: chữ ký đặt khi hàm chưa ghi băm ngân sách (dạng `076`) không đếm ở cạnh mở gói; người ấy ký lại được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    // Chữ ký dạng trước `079_rang_ngan_sach`: hàm đặt băm chưa có vế ngân sách.
    await voiHamDotBien(
      "public.rfq_approvals_dat_bam_danh_sach()",
      "NEW.approved_budget_hash := public.rfq_bam_ngan_sach(NEW.rfq_id);",
      "NULL;",
      () => duyet(t, rfqId, t.pm2),
    );
    const { rows } = await db.pool.query<{ b: Buffer | null }>("SELECT approved_budget_hash AS b FROM rfq_approvals WHERE rfq_id = $1", [rfqId]);
    expect(rows, "dàn cảnh: chữ ký không mang băm ngân sách").toEqual([{ b: null }]);
    expect((await loi(mo(t, rfqId)))?.message).toBe(LOI_NGAN_SACH_1);
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await soChuKy(rfqId)).toBe(2);
  });
});

// =============================================================================================
// (3) ĐỘT BIẾN — MỖI VẾ CỦA BẢN VÁ MỘT LẦN ĐỎ
//
// Tiền tệ và bậc trong băm là đột biến TƯƠNG ĐƯƠNG ở tổ chức đã bật: tiền tệ phải khớp phiên bản có bậc (`ngan_sach_xep_bac`),
// bậc suy từ phiên bản ghim và ước lượng — không đường nào đổi riêng chúng khi hai thứ kia đứng yên (lượt soi S1.192).
// =============================================================================================
describe("S1.192 — đột biến: gỡ từng vế thì lỗ mở lại", () => {
  /** Gói 1 triệu đã ký, trả về, nâng lên 99 triệu cùng bậc, nộp lại, thử mở — trả trạng thái cuối. */
  const nangCungBac = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG_LON);
    await nop(t, rfqId);
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };
  /** Gói cấp kép một chữ ký, trả về, hạ về một chữ ký, nộp lại, thử mở — trả trạng thái cuối. */
  const haBac = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG);
    await nop(t, rfqId);
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };
  /** Gói tự nâng lên hai chữ ký, một chữ ký, trả về, đặt lại ngân sách cũ (cờ về `false`), nộp lại, thử mở. */
  const coKepTuNang = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await tuNangCapKep(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG);
    await nop(t, rfqId);
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };
  /** Hai chữ ký trên hai bộ ba khác nhau, gói về một bộ ba thứ ba chưa ai ký, thử mở. */
  const ghepBoBa = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    const them = await themLoiMoi(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG_LON);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm3);
    await traVe(t, rfqId);
    await thuHoiLoiMoi(t, them);
    await nop(t, rfqId);
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };
  /** Cùng con số, ghim sang phiên bản chính sách mới — trả trạng thái cuối. */
  const doiPhienBan = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await kyPhienBanCoBac(t, 3);
    await datNganSach(t, rfqId, GOI_THUONG);
    await nop(t, rfqId);
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };

  it("[INV-K4b] đối chứng: bản thật chặn cả năm kịch bản", async () => {
    expect(await nangCungBac()).toBe("PENDING_APPROVAL");
    expect(await haBac()).toBe("PENDING_APPROVAL");
    expect(await doiPhienBan()).toBe("PENDING_APPROVAL");
    expect(await coKepTuNang()).toBe("PENDING_APPROVAL");
    expect(await ghepBoBa()).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4b] [INV-D2] băm ngân sách bỏ cờ duyệt kép ⇒ gói tự nâng lên hai chữ ký mở bằng một chữ ký (lượt soi S1.192, M1)", async () => {
    expect(
      await voiHamDotBien("public.rfq_bam_ngan_sach(uuid)", "|| '|' || p.requires_dual_approval::text", "", coKepTuNang),
    ).toBe("OPEN");
  });

  it("[INV-K4b] hai phép đếm có vế ngân sách chỉ xét ngân sách, bỏ nội dung và danh sách ⇒ hai chữ ký trên hai bộ ba ghép thành bộ ba chưa ai ký (lượt soi S1.192, M2)", async () => {
    expect(
      await voiHamDotBien(
        "public.rfq_kiem_chu_ky_danh_sach_khi_mo()",
        "     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)\n     AND a.approved_list_hash = public.rfq_bam_danh_sach(NEW.id)\n     AND a.approved_budget_hash",
        "     AND a.approved_budget_hash",
        ghepBoBa,
        2,
      ),
    ).toBe("OPEN");
  });

  it("[INV-K4b] [INV-D2] cạnh mở gói bỏ phép đếm trên ngân sách ⇒ cả hai lỗ đo trên master mở lại", async () => {
    // [S1.9101] Vế ngân sách nay có ở HAI phép đếm — thứ hai, và thứ ba (chữ ký còn hiệu lực) —; đột biến gỡ cả hai.
    const boDem = <T>(viec: () => Promise<T>): Promise<T> =>
      voiHamDotBien(
        "public.rfq_kiem_chu_ky_danh_sach_khi_mo()",
        "\n     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(NEW.id)",
        "",
        viec,
        2,
      );
    expect(await boDem(nangCungBac), "nâng cùng bậc").toBe("OPEN");
    expect(await boDem(haBac), "hạ bậc cấp kép").toBe("OPEN");
  });

  it("[INV-K4b] băm ngân sách bỏ ước lượng ⇒ nâng cùng bậc mở; bỏ phiên bản chính sách ⇒ ghim phiên bản mới mở", async () => {
    expect(
      await voiHamDotBien("public.rfq_bam_ngan_sach(uuid)", "coalesce(b.estimated_value::text, '')", "''", nangCungBac),
      "bỏ ước lượng",
    ).toBe("OPEN");
    expect(
      await voiHamDotBien("public.rfq_bam_ngan_sach(uuid)", "coalesce(b.policy_id::text, '')", "''", doiPhienBan),
      "bỏ phiên bản chính sách",
    ).toBe("OPEN");
  });

  it("[INV-K4b] hàm đặt băm của chữ ký bỏ vế ngân sách ⇒ không chữ ký nào đếm (fail-closed, không phải lỗ) — đo để vế ấy không là trang trí", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const kq = await voiHamDotBien(
      "public.rfq_approvals_dat_bam_danh_sach()",
      "NEW.approved_budget_hash := public.rfq_bam_ngan_sach(NEW.rfq_id);",
      "NULL;",
      async () => {
        await duyet(t, rfqId, t.pm2);
        return (await loi(mo(t, rfqId)))?.message;
      },
    );
    expect(kq, "chữ ký hợp lệ bị từ chối khi vế ấy mất").toBe(LOI_NGAN_SACH_1);
  });

  it("[INV-K4b] UNIQUE bỏ cột băm ngân sách ⇒ người đã ký KHÔNG ký lại được trên ngân sách mới — gói hạ bậc kẹt ở PENDING_APPROVAL", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId);
    await datNganSach(t, rfqId, GOI_THUONG);
    await nop(t, rfqId);
    const kyLai = (c: pg.PoolClient): Promise<LoiBat | null> => loi(c.query(CAU_KY, [t.org, rfqId, t.pm2.u, t.pm2.s]));
    // Hai UNIQUE dạng `076` — không băm ngân sách —, GIỚI HẠN ở gói này: hàng của các ca trước trong cùng CSDL (một người ký
    // hai lần trên hai ngân sách) không cho dựng lại ràng buộc dạng cũ trên cả bảng.
    const dotBien = [
      "ALTER TABLE public.rfq_approvals DROP CONSTRAINT rfq_approvals_mot_nguoi_mot_lan",
      "ALTER TABLE public.rfq_approvals DROP CONSTRAINT rfq_approvals_mot_phien_mot_lan",
      "CREATE UNIQUE INDEX dot_bien_mot_nguoi ON public.rfq_approvals " +
        `(org_id, rfq_id, approver_user_id, approved_content_hash, approved_list_hash) NULLS NOT DISTINCT WHERE rfq_id = '${rfqId}'`,
      "CREATE UNIQUE INDEX dot_bien_mot_phien ON public.rfq_approvals " +
        `(org_id, rfq_id, session_id, approved_content_hash, approved_list_hash) NULLS NOT DISTINCT WHERE rfq_id = '${rfqId}'`,
    ];
    expect((await trongDotBien(t.org, dotBien, kyLai))?.code, "UNIQUE dạng `076` chặn lần ký lại").toBe("23505");
    expect(await trongDotBien(t.org, [], kyLai), "đối chứng trong cùng khuôn: bản thật cho ký lại").toBeNull();
    expect(await soChuKy(rfqId), "hai giao dịch đều ROLLBACK").toBe(1);
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });
});
