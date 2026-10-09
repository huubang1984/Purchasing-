import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, approveRfq, cancelRfq, createRfq, extendRfqDeadline, openRfq, returnRfqToDraft, submitRfqForApproval } from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

// =============================================================================================
// [S1.185 / S3.2a] DANH SÁCH ĐƯỢC KÝ LÀ DANH SÁCH ĐƯỢC MỜI (K4a, K4b), VÀ KHÔNG TOKEN MỜI NÀO CHO MỘT GÓI
// CHƯA MỞ (K6) — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `076_danh_sach_moi`. Mỗi chốt có ở đây một phép đo HÀNH VI, một đối chứng và một ĐỘT BIẾN: tắt (hay viết
// lại) đúng lớp ấy thì chính câu vừa bị chặn đi lọt. Mọi chốt chỉ áp cho tổ chức ĐÃ BẬT S3; khối cuối đo nhánh MVP1.
//
// Lời mời và token được chèn bằng CÂU của đường sản xuất (`createInvitation`, `issueMagicLinkToken` của
// `packages/invitation`) viết lại ở đây dưới `app_api`: S3.2a chỉ dựng lớp CSDL, và thứ được đo là trigger — tầng gói
// của lời mời đổi ở S3.2b.
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG: công tắc ADR-080 một chiều, nên dùng chung một tổ chức là để thứ tự chạy quyết định
// kết quả.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `bac-chinh-sach.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo danh sách mời.
const boBocGia = {
  name: "gia-cho-test-danh-sach-moi",
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

/** Bảng bậc tối thiểu: một bậc thường từ 0 và bậc đấu thầu chính thức từ 10 tỷ — khuôn `BAC_CHUAN`. */
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

/** Dưới ngưỡng phê duyệt kép (100 triệu) — một chữ ký. */
const GOI_THUONG = "1000000.00";
/** Trên ngưỡng — `requires_dual_approval`, hai chữ ký. */
const GOI_CAP_KEP = "150000000.00";

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
  /** Hai PROCUREMENT_MANAGER khác — hai người duyệt khác người tạo. */
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
    `ds-${randomBytes(4).toString("hex")}`,
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
    createProcurementPolicy(c, org, {
      version: 1,
      dualApprovalThreshold: "100000000.00",
      currency: "VND",
      actorSessionId: pm.s,
    }),
  );
  return { org, pm, pm2, pm3, tc };
}

/** BẬT S3 cho một tổ chức có sẵn: phiên bản 2 có bậc, PM tạo, FINANCE ký — khuôn `toChucDaBat` của `bac-chinh-sach`. */
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
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org]),
  );
  expect(rows[0]?.b, "dàn cảnh: tổ chức phải ĐÃ BẬT").toBe(true);
}

async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  await batS3(t);
  return t;
}

/**
 * Một nhà cung cấp và một người liên hệ — câu dựng dưới chủ sở hữu, khuôn `invitation.int.test.ts`.
 *
 * [S1.266 / S3.3c1] Tổ chức ĐÃ bật: nhà cung cấp ĐẾM ĐƯỢC cho K2 (`nhaCungCapDemDuoc` — người nhập riêng, MST, xác minh bởi
 * `tc`: FINANCE, không khai phiên bản chính sách v2 mà ngân sách ghim, không tạo gói, không mời) — gói nộp duyệt được (bậc đòi
 * một). Truyền `ncc` thì thêm một người liên hệ THỨ HAI cho nhà cung cấp ấy, cũng do người nhập riêng dựng, rồi `tc` xác minh
 * LẠI: băm hồ sơ của xác minh phủ mọi người liên hệ (`082`), nên người liên hệ thêm sau làm xác minh cũ thôi hiệu lực. Tổ chức
 * chưa bật: nguyên dạng MVP1, do PM dựng — K2 không áp, và xác minh K8a chỉ có ở tổ chức đã bật.
 */
async function nhaCungCap(t: ToChuc, ncc?: string): Promise<NhaCungCap> {
  const daBat = (await db.pool.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org])).rows[0]!.b;
  if (daBat) {
    if (ncc === undefined) {
      const [n] = await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc });
      return { ncc: n!.ncc, lh: n!.lh };
    }
    const nhap = await nguoiNhapNhaCungCap(db.pool, t.org);
    const duoi = randomBytes(6).toString("hex");
    const lh = await motId(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
      [t.org, ncc, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), nhap.u, nhap.s],
    );
    await db.pool.query(
      "INSERT INTO supplier_verifications (org_id, supplier_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'VERIFIED', $3, $4)",
      [t.org, ncc, t.tc.u, t.tc.s],
    );
    return { ncc, lh };
  }
  const id =
    ncc ??
    (await motId(
      "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
    ));
  const duoi = randomBytes(6).toString("hex");
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
    [t.org, id, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), t.pm.u, t.pm.s],
  );
  return { ncc: id, lh };
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

/** Gói DRAFT có ngân sách, một hạng mục và nhóm hàng. */
async function goiNhap(t: ToChuc, giaTri: string = GOI_THUONG): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, {
      rfqId,
      lineNo: 1,
      description: "Thep tam SS400 3mm",
      quantity: "100.0000",
      unit: "tam",
      actorSessionId: t.pm.s,
    });
  });
  return rfqId;
}

const nop = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
/** [S1.198 / khoản 256] Người duyệt gửi lại lần nộp VỪA ĐỌC — ở tổ chức đã bật, trigger `rfq_approvals_so_lan_nop` đòi nó. */
const duyet = (t: ToChuc, rfqId: string, ai: Nguoi): Promise<void> =>
  withTenant(apiPool, t.org, async (c) => {
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]?.n;
    await approveRfq(c, t.org, { rfqId, sessionId: ai.s, ...(lan === undefined ? {} : { lanNopDaXem: lan }) }, apiPool);
  });
const mo = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));

/** Câu chèn lời mời của `createInvitation` (`packages/invitation`), nguyên cột. */
const CAU_MOI =
  "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
  "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id, status, moi_sau_khi_ky";
const thamSoMoi = (t: ToChuc, rfqId: string, n: NhaCungCap): unknown[] => [t.org, rfqId, n.ncc, n.lh, t.pm.u, t.pm.s];

interface LoiMoi {
  readonly id: string;
  readonly status: string;
  readonly moi_sau_khi_ky: boolean;
}

async function moi(t: ToChuc, rfqId: string, n: NhaCungCap): Promise<LoiMoi> {
  return (await withTenant(apiPool, t.org, (c) => c.query<LoiMoi>(CAU_MOI, thamSoMoi(t, rfqId, n)))).rows[0]!;
}

/** Câu thu hồi của `revokeInvitation`, nguyên cột: người thu hồi đi trong CÙNG câu với `revoked_at` (`013`). */
const CAU_THU_HOI =
  "UPDATE public.rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 " +
  "WHERE id = $1 AND revoked_at IS NULL";

async function thuHoi(t: ToChuc, invId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => c.query(CAU_THU_HOI, [invId, t.pm.u, t.pm.s]));
}
/** [S1.289 / S3.6c / K10c] Câu thu hồi CÓ lý do — ở gói đang mở của tổ chức đã bật trigger K4a đòi cột `ly_do_thu_hoi`. */
const CAU_THU_HOI_LY_DO =
  "UPDATE public.rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3, ly_do_thu_hoi = $4 " +
  "WHERE id = $1 AND revoked_at IS NULL";
async function thuHoiCoLyDo(t: ToChuc, invId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => c.query(CAU_THU_HOI_LY_DO, [invId, t.pm.u, t.pm.s, "Nha cung cap bao het hang"]));
}

/** Câu đúc token của `issueMagicLinkToken`, nguyên cột. */
const CAU_TOKEN =
  "INSERT INTO public.rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
  "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id";

async function token(t: ToChuc, invId: string): Promise<string> {
  return (
    await withTenant(apiPool, t.org, (c) => c.query<{ id: string }>(CAU_TOKEN, [t.org, invId, randomBytes(32), t.pm.u, t.pm.s]))
  ).rows[0]!.id;
}

async function datTrangThaiMoi(t: ToChuc, invId: string, status: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => c.query("UPDATE public.rfq_invitations SET status = $2 WHERE id = $1", [invId, status]));
}

interface LoiPg {
  readonly message: string;
  readonly code: string;
  readonly constraint: string;
}

async function loi(p: Promise<unknown>): Promise<LoiPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string; constraint?: string };
    return { message: x.message, code: x.code ?? "", constraint: x.constraint ?? "" };
  }
}

async function trangThaiGoi(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

async function trangThaiTrigger(trigger: string): Promise<string> {
  return (await db.pool.query<{ e: string }>("SELECT tgenabled AS e FROM pg_trigger WHERE tgname = $1", [trigger])).rows[0]!.e;
}

/** Băm danh sách hiện tại, hỏi dưới chủ sở hữu. */
async function bamDanhSach(rfqId: string): Promise<Buffer> {
  return (await db.pool.query<{ b: Buffer }>("SELECT public.rfq_bam_danh_sach($1) AS b", [rfqId])).rows[0]!.b;
}

/** Băm danh sách mà mỗi chữ ký của gói mang, theo thứ tự ký. */
async function bamDaKy(rfqId: string): Promise<(Buffer | null)[]> {
  const { rows } = await db.pool.query<{ b: Buffer | null }>(
    "SELECT approved_list_hash AS b FROM rfq_approvals WHERE rfq_id = $1 ORDER BY approved_at, id",
    [rfqId],
  );
  return rows.map((r) => r.b);
}

/**
 * ĐỔI DANH SÁCH ĐI VÒNG K4a: câu dựng dưới chủ sở hữu, trong MỘT giao dịch tắt `rfq_invitations_kiem_danh_sach` rồi bật
 * lại `ENABLE ALWAYS` trước COMMIT. Đường thật đổi danh sách giữa hai chữ ký là cạnh về DRAFT của S3.2b; ở đây nó là câu
 * dựng, để đo K4b ĐỘC LẬP với K4a — danh sách đổi bằng đường nào thì chữ ký cũ cũng không được đếm.
 */
async function doiDanhSachVongK4a(cau: readonly (readonly [string, readonly unknown[]])[]): Promise<void> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE public.rfq_invitations DISABLE TRIGGER rfq_invitations_kiem_danh_sach");
    for (const [sql, ts] of cau) await c.query(sql, [...ts]);
    await c.query("ALTER TABLE public.rfq_invitations ENABLE ALWAYS TRIGGER rfq_invitations_kiem_danh_sach");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  expect(await trangThaiTrigger("rfq_invitations_kiem_danh_sach"), "dàn cảnh phải trả trigger về ALWAYS").toBe("A");
}

/**
 * ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: chủ sở hữu chạy `dotBien`, rồi `viec` chạy dưới `app_api` trong tổ chức trên
 * CÙNG kết nối — khuôn `trongDotBien` của `bac-chinh-sach`. Lược đồ không đổi sau đó.
 */
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

/** Định nghĩa của một hàm sau MỘT phép thay chuỗi trên `pg_get_functiondef` — chuỗi phải khớp đúng một chỗ. */
async function defDotBien(ham: string, cu: string, moi: string): Promise<string> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  return goc.replace(cu, moi);
}

/** Như `defDotBien` nhưng COMMIT — để kết nối KHÁC thấy thân đột biến — rồi trả lại thân gốc. */
async function voiHamDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  await db.pool.query(await defDotBien(ham, cu, moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
  }
}

/** Một giao dịch mở dưới `app_api` trong tổ chức — để đo hai giao dịch chen nhau. */
async function moGiaoDich(org: string): Promise<pg.PoolClient> {
  const c = await apiPool.connect();
  await c.query("BEGIN");
  await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
  return c;
}

async function pidCua(c: pg.PoolClient): Promise<number> {
  return (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
}

/** Chờ tới khi backend `pid` ĐỨNG CHỜ một khoá hàng — mốc để biết câu của nó đang bị chặn, không phải chưa chạy. */
async function choKhoaHang(pid: number): Promise<void> {
  for (let lan = 0; lan < 250; lan += 1) {
    const { rows } = await db.pool.query<{ cho: boolean }>(
      "SELECT (wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple')) AS cho FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (rows[0]?.cho === true) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`backend ${pid} không đứng chờ khoá hàng sau 5 s`);
}

const loiThem = (trangThai: string): string =>
  `Goi thau o ${trangThai} khong them loi moi duoc — chi o DRAFT, hoac OPEN (K4a)`;
const loiThuHoi = (trangThai: string): string => `Loi moi chi thu hoi duoc khi goi con o DRAFT; goi dang o ${trangThai} (K4a)`;
const LOI_TOKEN = "Khong duc token moi cho goi thau chua mo (K6)";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

// =============================================================================================
// (1) K4a — LỜI MỜI CHỈ ĐỔI Ở DRAFT; Ở OPEN CHỈ THÊM
// =============================================================================================
describe("S3.2a — K4a: lời mời chỉ đổi ở DRAFT; ở OPEN chỉ thêm, và mang nhãn", () => {
  it("[INV-K4a] DRAFT: thêm và thu hồi đi qua; PENDING_APPROVAL: cả hai bị chặn — đúng thông điệp, mã 23514", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const a = await nhaCungCap(t);
    const b = await nhaCungCap(t);
    const moiA = await moi(t, rfqId, a);
    const moiB = await moi(t, rfqId, b);
    expect([moiA.status, moiA.moi_sau_khi_ky]).toEqual(["UNSENT", false]);
    await thuHoi(t, moiB.id);
    const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_invitations WHERE id = $1", [moiB.id]);
    expect(rows[0]?.status, "thu hồi ở DRAFT đi qua").toBe("REVOKED");

    await nop(t, rfqId);
    const c = await nhaCungCap(t);
    const them = await loi(moi(t, rfqId, c));
    expect(them?.message).toBe(loiThem("PENDING_APPROVAL"));
    expect(them?.code).toBe("23514");
    const bo = await loi(thuHoi(t, moiA.id));
    expect(bo?.message).toBe(loiThuHoi("PENDING_APPROVAL"));
    expect(bo?.code).toBe("23514");
  });

  // [S1.289 / S3.6c / K10c] ~~thu hồi bị chặn (tới S3.6)~~ — ở OPEN thu hồi CÓ LÝ DO đi qua khi danh sách còn đủ ngưỡng của bậc (1), bị chặn
  // có tên khi thiếu lý do hay khi rơi dưới ngưỡng mà không ngoại lệ còn sống.
  it("[INV-K4a] [INV-K10c] OPEN: thêm đi qua và mang nhãn `moi_sau_khi_ky`; thu hồi KHÔNG lý do bị chặn có tên; CÓ lý do đi qua khi còn đủ ngưỡng và bị chặn có tên khi rơi dưới — lời mời có từ DRAFT cũng thế", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const truoc = await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");

    const sau = await moi(t, rfqId, await nhaCungCap(t));
    expect([sau.status, sau.moi_sau_khi_ky], "lời mời thêm ở OPEN: chưa gửi, và mang nhãn").toEqual(["UNSENT", true]);
    const { rows } = await db.pool.query<{ nhan: boolean }>("SELECT moi_sau_khi_ky AS nhan FROM rfq_invitations WHERE id = $1", [
      truoc.id,
    ]);
    expect(rows[0]?.nhan, "lời mời có từ DRAFT không mang nhãn").toBe(false);
    for (const id of [truoc.id, sau.id]) {
      const bo = await loi(thuHoi(t, id));
      expect(bo?.message).toBe("Thu hoi loi moi o goi da mo phai co ly do (K10c)");
      expect([bo?.code, bo?.constraint]).toEqual(["23514", "k10c_thu_hoi_thieu_ly_do"]);
    }
    await thuHoiCoLyDo(t, truoc.id);
    const { rows: daThu } = await db.pool.query<{ s: string; l: string | null }>("SELECT status AS s, ly_do_thu_hoi AS l FROM rfq_invitations WHERE id = $1", [truoc.id]);
    expect(daThu[0], "còn một lời mời đếm được ≥ ngưỡng 1: thu hồi có lý do đi qua").toEqual({ s: "REVOKED", l: "Nha cung cap bao het hang" });
    const duoi = await loi(thuHoiCoLyDo(t, sau.id));
    expect([duoi?.code, duoi?.constraint], "lời mời cuối: rơi về 0 < 1, không ngoại lệ").toEqual(["23514", "k10c_thu_hoi_thieu_canh_tranh"]);
    expect(duoi?.message).toMatch(/K10C_THU_HOI_THIEU_CANH_TRANH/u);
  });

  it("[INV-K4a] trạng thái khác DRAFT/OPEN — gói đã HUỶ — không thêm, không thu hồi", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const a = await moi(t, rfqId, await nhaCungCap(t));
    await withTenant(apiPool, t.org, (c) => cancelRfq(c, t.org, { rfqId, reason: "Huy de do K4a", actorSessionId: t.pm.s }, apiPool));
    expect(await trangThaiGoi(rfqId)).toBe("CANCELLED");
    expect((await loi(moi(t, rfqId, await nhaCungCap(t))))?.message).toBe(loiThem("CANCELLED"));
    expect((await loi(thuHoi(t, a.id)))?.message).toBe(loiThuHoi("CANCELLED"));
  });

  it("[INV-K4a] ĐUA: câu thêm lời mời chen với cạnh nộp duyệt — khoá `FOR SHARE` xếp hai bên thành hàng, theo cả hai thứ tự", async () => {
    const t = await toChucDaBat();

    // ① Nộp duyệt trước, chưa COMMIT: câu thêm CHỜ, rồi đọc trạng thái MỚI và bị chặn.
    const g1 = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời ĐÃ COMMIT tới nhà cung cấp đếm được, trước cuộc đua — K2 không cho gói không lời mời rời DRAFT.
    await moi(t, g1, await nhaCungCap(t));
    const n1 = await nhaCungCap(t);
    const cNop = await moGiaoDich(t.org);
    const cThem = await moGiaoDich(t.org);
    try {
      // pid hỏi TRƯỚC câu bị chặn: `pg` xếp câu của một kết nối thành hàng, nên hỏi sau thì câu hỏi chờ chính câu ấy.
      const pidThem = await pidCua(cThem);
      await submitRfqForApproval(cNop, t.org, { rfqId: g1, actorSessionId: t.pm.s }, apiPool);
      const them = loi(cThem.query(CAU_MOI, thamSoMoi(t, g1, n1)));
      await choKhoaHang(pidThem);
      await cNop.query("COMMIT");
      expect((await them)?.message).toBe(loiThem("PENDING_APPROVAL"));
    } finally {
      await cThem.query("ROLLBACK");
      await cNop.query("ROLLBACK");
      cNop.release();
      cThem.release();
    }

    // ② Thêm trước, chưa COMMIT: cạnh nộp duyệt CHỜ; lời mời vào danh sách TRƯỚC khi gói rời DRAFT.
    const g2 = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời ĐÃ COMMIT tới nhà cung cấp đếm được, trước cuộc đua: phép hỏi trước K2 của tầng gói chạy
    // TRƯỚC câu UPDATE và không thấy lời mời chưa commit của `cThem2` — thiếu lời mời này thì nó từ chối trước khi chờ khoá.
    await moi(t, g2, await nhaCungCap(t));
    const n2 = await nhaCungCap(t);
    const cThem2 = await moGiaoDich(t.org);
    const cNop2 = await moGiaoDich(t.org);
    try {
      const pidNop2 = await pidCua(cNop2);
      await cThem2.query(CAU_MOI, thamSoMoi(t, g2, n2));
      const nopXong = loi(submitRfqForApproval(cNop2, t.org, { rfqId: g2, actorSessionId: t.pm.s }, apiPool));
      await choKhoaHang(pidNop2);
      await cThem2.query("COMMIT");
      expect(await nopXong).toBeNull();
      await cNop2.query("COMMIT");
    } finally {
      await cThem2.query("ROLLBACK");
      await cNop2.query("ROLLBACK");
      cThem2.release();
      cNop2.release();
    }
    expect(await trangThaiGoi(g2)).toBe("PENDING_APPROVAL");
    // [S1.266 / S3.3c1] Hai lời mời sống: một của dàn cảnh K2, một CHEN VÀO — phép đo là lời chen vào nằm trong danh sách.
    const { rows } = await db.pool.query<{ n: string; chen: string }>(
      "SELECT count(*) AS n, count(*) FILTER (WHERE supplier_id = $2) AS chen FROM rfq_invitations WHERE rfq_id = $1 AND revoked_at IS NULL",
      [g2, n2.ncc],
    );
    expect([rows[0]?.n, rows[0]?.chen]).toEqual(["2", "1"]);
  });

  it("[INV-K4a] ĐỘT BIẾN: gỡ `FOR SHARE` thì ở thứ tự ① câu thêm KHÔNG chờ, đọc DRAFT cũ và đi lọt — gói vào PENDING_APPROVAL mang một lời mời K4a cấm", async () => {
    const t = await toChucDaBat();
    const g = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời ĐÃ COMMIT tới nhà cung cấp đếm được, trước đột biến — K2.
    await moi(t, g, await nhaCungCap(t));
    const n = await nhaCungCap(t);
    await voiHamDotBien("public.rfq_invitations_kiem_danh_sach()", "FOR SHARE;", ";", async () => {
      const cNop = await moGiaoDich(t.org);
      const cThem = await moGiaoDich(t.org);
      try {
        await submitRfqForApproval(cNop, t.org, { rfqId: g, actorSessionId: t.pm.s }, apiPool);
        expect(await loi(cThem.query(CAU_MOI, thamSoMoi(t, g, n))), "không khoá thì câu thêm không chờ ai").toBeNull();
        await cNop.query("COMMIT");
        await cThem.query("COMMIT");
      } finally {
        await cThem.query("ROLLBACK");
        await cNop.query("ROLLBACK");
        cNop.release();
        cThem.release();
      }
    });
    expect(await trangThaiGoi(g)).toBe("PENDING_APPROVAL");
    // [S1.266 / S3.3c1] Hai lời mời: một của dàn cảnh K2 (có từ DRAFT), một chen vào sau cạnh nộp duyệt — phép đo là lời sau.
    const { rows } = await db.pool.query<{ n: string; chen: string }>(
      "SELECT count(*) AS n, count(*) FILTER (WHERE supplier_id = $2) AS chen FROM rfq_invitations WHERE rfq_id = $1",
      [g, n.ncc],
    );
    expect([rows[0]?.n, rows[0]?.chen], "lời mời chen vào sau cạnh nộp duyệt").toEqual(["2", "1"]);
  });

  it("[INV-K4a] ĐỘT BIẾN: tắt `rfq_invitations_kiem_danh_sach` thì thêm ở PENDING_APPROVAL đi lọt; trigger còn ENABLE ALWAYS thì bị chặn", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời tới nhà cung cấp đếm được — K2 không cho gói không lời mời rời DRAFT.
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    const n = await nhaCungCap(t);
    const khiTat = await trongDotBien(t.org, ["ALTER TABLE public.rfq_invitations DISABLE TRIGGER rfq_invitations_kiem_danh_sach"], (c) =>
      loi(c.query(CAU_MOI, thamSoMoi(t, rfqId, n))),
    );
    expect(khiTat, "trigger tắt thì câu thêm đi lọt").toBeNull();
    expect(await trangThaiTrigger("rfq_invitations_kiem_danh_sach")).toBe("A");
    expect((await loi(moi(t, rfqId, n)))?.message).toBe(loiThem("PENDING_APPROVAL"));
  });
});

// =============================================================================================
// (2) K4b — CHỮ KÝ MANG DANH SÁCH NÓ ĐÃ KÝ; CẠNH MỞ GÓI ĐẾM TRÊN DANH SÁCH HIỆN TẠI
// =============================================================================================
describe("S3.2a — K4b: chữ ký mang băm danh sách; cạnh mở gói đếm trên danh sách hiện tại", () => {
  it("[INV-K4b] chữ ký mang băm danh sách LÚC KÝ do trigger đặt; `app_api` không khai được cột", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    const [bam] = await bamDaKy(rfqId);
    expect(bam, "chữ ký của tổ chức đã bật mang băm").not.toBeNull();
    expect(bam?.equals(await bamDanhSach(rfqId))).toBe(true);

    const khai = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id, approved_list_hash) VALUES ($1, $2, $3, $4, $5)",
          [t.org, rfqId, t.pm3.u, t.pm3.s, Buffer.alloc(32)],
        ),
      ),
    );
    expect(khai?.code, "cột ngoài GRANT").toBe("42501");
  });

  it("[INV-K4b] đổi danh sách GIỮA hai chữ ký: chữ ký trên danh sách cũ không được đếm; người ấy ký lại được, và ký lần nữa trên cùng cặp bị UNIQUE chặn", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    const b = await nhaCungCap(t);
    await doiDanhSachVongK4a([[CAU_MOI, thamSoMoi(t, rfqId, b)]]);
    await duyet(t, rfqId, t.pm3);
    const [cu, moiKy] = await bamDaKy(rfqId);
    expect(cu?.equals(moiKy!), "hai chữ ký phải mang hai băm khác nhau").toBe(false);

    // Khối đếm của `071` thấy HAI chữ ký trên nội dung hiện tại và cho qua; K4b chỉ đếm MỘT trên danh sách hiện tại.
    expect((await loi(mo(t, rfqId)))?.message).toBe("RFQ nay can 2 chu ky TREN DANH SACH MOI HIEN TAI, moi co 1 (K4b)");

    await duyet(t, rfqId, t.pm2);
    const lap = await loi(duyet(t, rfqId, t.pm2));
    expect(lap?.code).toBe("23505");
    expect(lap?.constraint).toBe("rfq_approvals_mot_nguoi_mot_lan");
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4b] gói cấp kép ở tổ chức đã bật gia hạn HAI lần sau khi mở — cạnh mở chỉ chạy ở PENDING_APPROVAL→OPEN (khoản 240)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await duyet(t, rfqId, t.pm3);
    await mo(t, rfqId);
    for (const [ngay, lan] of [
      [10, 1],
      [12, 2],
    ] as const) {
      const r = await withTenant(apiPool, t.org, (c) =>
        extendRfqDeadline(c, t.org, {
          rfqId,
          newDeadlineAt: new Date(Date.now() + ngay * 24 * 3600 * 1000),
          reason: `gia han lan ${lan}`,
          actorSessionId: t.pm.s,
        }),
      );
      expect(r.status).toBe("OPEN");
    }
  });

  it("[INV-K4b] ĐỘT BIẾN: tắt `rfq_packages_kiem_danh_sach_khi_mo` thì chữ ký trên danh sách cũ mở được gói", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await doiDanhSachVongK4a([[CAU_MOI, thamSoMoi(t, rfqId, await nhaCungCap(t))]]);
    const khiTat = await trongDotBien(t.org, ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_danh_sach_khi_mo"], (c) =>
      loi(openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool)),
    );
    expect(khiTat, "trigger tắt thì chữ ký cũ mở được gói").toBeNull();
    expect(await trangThaiTrigger("rfq_packages_kiem_danh_sach_khi_mo")).toBe("A");
    expect((await loi(mo(t, rfqId)))?.message).toBe("RFQ nay can 1 chu ky TREN DANH SACH MOI HIEN TAI, moi co 0 (K4b)");
  });

  it("[INV-K4b] ĐỘT BIẾN: băm bỏ người liên hệ thì đổi người nhận link của cùng nhà cung cấp không làm chữ ký cũ vô hiệu", async () => {
    // Kịch bản: nhà cung cấp S mời qua người liên hệ C1; ký; rồi lời mời ấy bị thay bằng lời mời S qua C2 — link đi tới
    // một người khác. Băm thật thấy danh sách đổi; băm bỏ người liên hệ thấy hai danh sách y hệt.
    const kichBan = async (): Promise<LoiPg | null> => {
      const t = await toChucDaBat();
      const rfqId = await goiNhap(t);
      const c1 = await nhaCungCap(t);
      const c2 = await nhaCungCap(t, c1.ncc);
      const cu = await moi(t, rfqId, c1);
      await nop(t, rfqId);
      await duyet(t, rfqId, t.pm2);
      await doiDanhSachVongK4a([
        [CAU_THU_HOI, [cu.id, t.pm.u, t.pm.s]],
        [CAU_MOI, thamSoMoi(t, rfqId, c2)],
      ]);
      return loi(mo(t, rfqId));
    };
    expect((await kichBan())?.message).toBe("RFQ nay can 1 chu ky TREN DANH SACH MOI HIEN TAI, moi co 0 (K4b)");
    const khiDotBien = await voiHamDotBien(
      "public.rfq_bam_danh_sach(uuid)",
      "|| '|' || i.contact_id::text ",
      "",
      kichBan,
    );
    expect(khiDotBien, "băm bỏ người liên hệ thì chữ ký cũ vẫn mở được gói").toBeNull();
  });
});

// =============================================================================================
// (3) K6 — KHÔNG TOKEN MỜI CHO GÓI CHƯA MỞ; TRẠNG THÁI *CHƯA GỬI*
// =============================================================================================
describe("S3.2a — K6: không token cho gói chưa mở; lời mời chèn là *chưa gửi*", () => {
  it("[INV-K6] token cho gói chưa từng mở bị chặn ở DRAFT và PENDING_APPROVAL; ở OPEN thì đúc được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const a = await moi(t, rfqId, await nhaCungCap(t));
    const nhap = await loi(token(t, a.id));
    expect(nhap?.message).toBe(LOI_TOKEN);
    expect(nhap?.code).toBe("23514");
    await nop(t, rfqId);
    expect((await loi(token(t, a.id)))?.message).toBe(LOI_TOKEN);
    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    expect(await token(t, a.id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("[INV-K6] `UNSENT→SENT` chỉ khi gói OPEN; `SENT` không quay về `UNSENT`; `app_api` không khai được trạng thái lúc chèn hay nhãn", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const n = await nhaCungCap(t);
    const a = await moi(t, rfqId, n);
    expect((await loi(datTrangThaiMoi(t, a.id, "SENT")))?.message).toBe(
      "Loi moi chi thanh SENT khi goi da OPEN; goi dang o DRAFT (K6)",
    );
    const khac = await nhaCungCap(t);
    const khaiTrangThai = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, invited_by, invited_by_session_id, status) " +
            "VALUES ($1, $2, $3, $4, $5, $6, 'SENT')",
          [t.org, rfqId, khac.ncc, khac.lh, t.pm.u, t.pm.s],
        ),
      ),
    );
    expect(khaiTrangThai?.code, "`status` ngoài GRANT INSERT (`010`)").toBe("42501");
    const khaiNhan = await loi(
      withTenant(apiPool, t.org, (c) => c.query("UPDATE rfq_invitations SET moi_sau_khi_ky = true WHERE id = $1", [a.id])),
    );
    expect(khaiNhan?.code, "nhãn ngoài GRANT UPDATE").toBe("42501");

    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    await datTrangThaiMoi(t, a.id, "SENT");
    expect((await loi(datTrangThaiMoi(t, a.id, "UNSENT")))?.message).toBe("Loi moi da gui khong quay ve chua gui (K6)");
  });

  it("[INV-K6] ĐỘT BIẾN: tắt `rfq_invitation_tokens_kiem_goi_da_mo` thì token cho gói DRAFT đi lọt", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const a = await moi(t, rfqId, await nhaCungCap(t));
    const khiTat = await trongDotBien(
      t.org,
      ["ALTER TABLE public.rfq_invitation_tokens DISABLE TRIGGER rfq_invitation_tokens_kiem_goi_da_mo"],
      (c) => loi(c.query(CAU_TOKEN, [t.org, a.id, randomBytes(32), t.pm.u, t.pm.s])),
    );
    expect(khiTat, "trigger tắt thì token cho gói chưa mở đi lọt").toBeNull();
    expect(await trangThaiTrigger("rfq_invitation_tokens_kiem_goi_da_mo")).toBe("A");
    expect((await loi(token(t, a.id)))?.message).toBe(LOI_TOKEN);
  });

  it("[INV-K6] ĐỘT BIẾN: tắt `rfq_invitations_kiem_danh_sach` thì lời mời thêm ở OPEN mang `SENT` và KHÔNG mang nhãn", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    // [S1.266 / S3.3c1] Một lời mời tới nhà cung cấp đếm được, có từ DRAFT — K2. Phép đo chỉ đọc lời mời thêm ở OPEN.
    await moi(t, rfqId, await nhaCungCap(t));
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    const n = await nhaCungCap(t);
    const khiTat = await trongDotBien(
      t.org,
      ["ALTER TABLE public.rfq_invitations DISABLE TRIGGER rfq_invitations_kiem_danh_sach"],
      async (c) => (await c.query<LoiMoi>(CAU_MOI, thamSoMoi(t, rfqId, n))).rows[0],
    );
    expect([khiTat?.status, khiTat?.moi_sau_khi_ky]).toEqual(["SENT", false]);
    const that = await moi(t, rfqId, n);
    expect([that.status, that.moi_sau_khi_ky]).toEqual(["UNSENT", true]);
  });
});

// =============================================================================================
// (4) TỔ CHỨC CHƯA BẬT — NHÁNH MVP1, VÀ ĐIỂM CHỊU LỰC CỦA BĂM NULL (D2)
// =============================================================================================
describe("S3.2a — tổ chức chưa bật chạy nguyên MVP1; băm danh sách NULL là chịu lực cho D2", () => {
  it("ĐỐI CHỨNG MVP1: mời ở DRAFT, PENDING_APPROVAL và OPEN; token ở DRAFT; thu hồi ở OPEN; `SENT`, không nhãn, băm danh sách NULL", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const a = await moi(t, rfqId, await nhaCungCap(t));
    expect([a.status, a.moi_sau_khi_ky]).toEqual(["SENT", false]);
    await token(t, a.id);
    await nop(t, rfqId);
    await moi(t, rfqId, await nhaCungCap(t));
    await duyet(t, rfqId, t.pm2);
    expect(await bamDaKy(rfqId)).toEqual([null]);
    await mo(t, rfqId);
    const sau = await moi(t, rfqId, await nhaCungCap(t));
    expect([sau.status, sau.moi_sau_khi_ky]).toEqual(["SENT", false]);
    await thuHoi(t, sau.id);
    await thuHoi(t, a.id);
  });

  it("[INV-D2] MVP1: thêm lời mời ở PENDING_APPROVAL rồi cùng người ký lại — UNIQUE vẫn chặn, và gói cấp kép không mở với một người", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await moi(t, rfqId, await nhaCungCap(t));
    const lap = await loi(duyet(t, rfqId, t.pm2));
    expect(lap?.code).toBe("23505");
    expect(lap?.constraint).toBe("rfq_approvals_mot_nguoi_mot_lan");
    expect((await loi(mo(t, rfqId)))?.message).toMatch(/can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 1 \(D2\)/);
  });

  // Hai đột biến của điểm chịu lực: băm đặt cho MỌI tổ chức, và UNIQUE mất `NULLS NOT DISTINCT`. Cả hai cho cùng một người
  // ký hai lần trên cùng nội dung, và khối đếm `count(*)` của `071` đếm người ấy HAI lần — gói cấp kép mở với MỘT người.
  //
  // [S1.279 / S4.7a — CA LẬT] Từ `112_tco`, cạnh mở ở tổ chức chưa bật đếm NGƯỜI ký trên nội dung và số ngày giao hiện tại
  // (lớp L16, `rfq_packages_tco_khi_mo`): hai hàng của cùng PM2 là MỘT người, nên mỗi đột biến một mình KHÔNG còn mở được gói.
  // Khoảng trống của điểm chịu lực chỉ mở lại khi lớp ấy cũng tắt — ca đo đúng điều đó; lời từ chối của lớp L16 được đo trước.
  const TAT_LOP_L16 = "ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_tco_khi_mo";
  const LOI_L16 = "RFQ nay can 2 NGUOI KY TREN NOI DUNG VA SO NGAY GIAO HIEN TAI, moi co 1 (L16)";
  const kichBanD2 = (t: ToChuc, rfqId: string, n: NhaCungCap) => async (c: pg.PoolClient) => {
    await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s }, apiPool);
    await c.query(CAU_MOI, thamSoMoi(t, rfqId, n));
    await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s }, apiPool);
    await openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool);
    return (await c.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.status;
  };

  it("[INV-D2] ĐỘT BIẾN: đặt băm danh sách cho MỌI tổ chức thì ở MVP1 một người ký hai lần và gói cấp kép MỞ với một người", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    const n = await nhaCungCap(t);
    const dotBien = await defDotBien(
      "public.rfq_approvals_dat_bam_danh_sach()",
      "IF public.to_chuc_da_bat_s3(NEW.org_id) THEN",
      "IF true THEN",
    );
    expect((await loi(trongDotBien(t.org, [dotBien], kichBanD2(t, rfqId, n))))?.message).toBe(LOI_L16);
    expect(await trongDotBien(t.org, [dotBien, TAT_LOP_L16], kichBanD2(t, rfqId, n))).toBe("OPEN");
    expect(await trangThaiGoi(rfqId), "đột biến đã ROLLBACK").toBe("PENDING_APPROVAL");
  });

  it("[INV-D2] ĐỘT BIẾN: UNIQUE mất `NULLS NOT DISTINCT` thì ở MVP1 một người ký hai lần và gói cấp kép MỞ với một người", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    const n = await nhaCungCap(t);
    const dotBien = [
      "ALTER TABLE public.rfq_approvals DROP CONSTRAINT rfq_approvals_mot_nguoi_mot_lan",
      "ALTER TABLE public.rfq_approvals ADD CONSTRAINT rfq_approvals_mot_nguoi_mot_lan " +
        "UNIQUE (org_id, rfq_id, approver_user_id, approved_content_hash, approved_list_hash)",
      "ALTER TABLE public.rfq_approvals DROP CONSTRAINT rfq_approvals_mot_phien_mot_lan",
      "ALTER TABLE public.rfq_approvals ADD CONSTRAINT rfq_approvals_mot_phien_mot_lan " +
        "UNIQUE (org_id, rfq_id, session_id, approved_content_hash, approved_list_hash)",
    ];
    expect((await loi(trongDotBien(t.org, dotBien, kichBanD2(t, rfqId, n))))?.message).toBe(LOI_L16);
    expect(await trongDotBien(t.org, [...dotBien, TAT_LOP_L16], kichBanD2(t, rfqId, n))).toBe("OPEN");
    const { rows } = await db.pool.query<{ d: string }>(
      "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'rfq_approvals_mot_nguoi_mot_lan'",
    );
    expect(rows[0]?.d, "đột biến đã ROLLBACK").toContain("NULLS NOT DISTINCT");
  });
});

// =============================================================================================
// (5) GIỚI HẠN, ĐO — GÓI ĐANG BAY LÚC TỔ CHỨC BẬT S3 (khoản 253)
//
// [S1.186 / S3.2b1] Khoản 253 ĐÓNG Ở PHÍA DÙNG. Ca đầu dưới đây vẫn đúng nguyên văn — token thời MVP1 còn trong bảng, chưa
// thu hồi —, nhưng nó mang `duc_khi_goi_da_mo = false` (`077_tra_ve_nhap`), nên ở tổ chức đã bật nó không đổi link, không
// xin, không xác minh OTP được nữa: `apps/api/src/token-goi-da-mo.int.test.ts`.
// =============================================================================================
describe("S3.2a — giới hạn, đo: gói đang bay lúc tổ chức bật S3 (khoản 253)", () => {
  it("token đúc thời MVP1 cho gói chưa mở còn sống sau khi bật — K6 chặn lần đúc MỚI, không thu hồi cái đã đúc", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const a = await moi(t, rfqId, await nhaCungCap(t));
    const cu = await token(t, a.id);
    await batS3(t);
    const { rows } = await db.pool.query<{ r: Date | null }>("SELECT revoked_at AS r FROM rfq_invitation_tokens WHERE id = $1", [cu]);
    expect(rows[0]?.r, "khoản 253: token thời MVP1 của gói chưa mở vẫn chưa thu hồi").toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
    expect((await loi(token(t, a.id)))?.message).toBe(LOI_TOKEN);
  });

  // [S1.236 / khoản 261] Ca này từng đo chữ ký thời MVP1 của một gói đang PENDING_APPROVAL ĐI QUA lần bật (K4b không đếm nó,
  // người ấy ký lại được). Nay lần bật bị từ chối khi tổ chức còn gói chờ duyệt — `097_chan_bat_s3_khi_con_goi_cho` —, nên tình
  // huống ấy không còn tới được: ca dưới đo lời từ chối, ca kế đo lớp hai cho dữ liệu có từ trước
  // `097_chan_bat_s3_khi_con_goi_cho`. Vế *K4b đếm người chứ không đếm hàng* đo lại trong S3, ở khối ngay sau.
  it("[S1.236 / khoản 261] gói đang PENDING_APPROVAL lúc bật — kể cả gói đã mang chữ ký thời MVP1, không băm — chặn lần bật: chữ ký thời MVP1 không còn đi qua lần bật", async () => {
    const t = await taoToChuc();
    for (const giaTri of [GOI_THUONG, GOI_CAP_KEP]) {
      const g = await goiNhap(t, giaTri);
      await moi(t, g, await nhaCungCap(t));
      await nop(t, g);
      await duyet(t, g, t.pm2);
    }
    expect((await loi(batS3(t)))?.message).toBe(
      "To chuc con 2 goi cho duyet: duyet roi mo, hoac huy, cac goi ay truoc khi bat S3 (ADR-080)",
    );
    const { rows } = await db.pool.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org]);
    expect(rows[0]?.b).toBe(false);
  });

  it("[S1.236 / khoản 261] lớp hai, cho dữ liệu có TRƯỚC `097_chan_bat_s3_khi_con_goi_cho` — mô phỏng bằng thân `072` ở lần ký: chữ ký thời MVP1 của gói chờ duyệt không mang băm nên K4b không đếm nó; người ấy ký lại thì mở", async () => {
    const t = await taoToChuc();
    const thuong = await goiNhap(t);
    await moi(t, thuong, await nhaCungCap(t));
    await nop(t, thuong);
    await duyet(t, thuong, t.pm2);
    await voiHamDotBien("public.chinh_sach_kiem_nguoi_ky()", "  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN\n", "  IF false THEN\n", () =>
      batS3(t),
    );
    // Sàn một chữ ký của `071` thấy chữ ký cũ và cho qua; K4b không thấy nó trên danh sách hiện tại.
    expect((await loi(mo(t, thuong)))?.message).toBe("RFQ nay can 1 chu ky TREN DANH SACH MOI HIEN TAI, moi co 0 (K4b)");
    // [S1.281 / S3.4a / K9] Gói có từ trước lần bật không bậc ghim — K9 coi như ĐÒI khai (fail-closed, cùng K5): người ký lại khai
    // *không xung đột* trước, bằng chính câu chèn của `khaiBaoXungDot` (băm danh sách do trigger đặt).
    await withTenant(apiPool, t.org, (c) =>
      c.query(
        "INSERT INTO public.coi_declarations (org_id, rfq_id, user_id, session_id, trang_thai) VALUES ($1, $2, $3, $4, 'KHONG_XUNG_DOT')",
        [t.org, thuong, t.pm2.u, t.pm2.s],
      ),
    );
    await duyet(t, thuong, t.pm2);
    expect(await loi(mo(t, thuong))).toBeNull();
  });
});

// =============================================================================================
// [S1.236] K4b ĐẾM NGƯỜI, KHÔNG ĐẾM HÀNG — ĐO TRONG S3
//
// Ca giới hạn khoản 253 từng mang vế này trên chữ ký thời MVP1 — ở đó chữ ký cũ bị loại vì băm NULL, không vì đếm người. Ca dưới
// dựng HAI hàng hiệu lực của CÙNG một người trên cùng nội dung, danh sách và ngân sách, và khẳng định nguyên văn lời của vế danh
// sách — vế đầu thấy người ấy.
// =============================================================================================
describe("S1.236 — K4b đếm người chứ không đếm hàng, đo trong S3", () => {
  it("[INV-K4b] một người mang HAI chữ ký hiệu lực khớp nội dung hiện tại — ký ở lần nộp 1, PM trả về, nộp lại y nguyên, ký lại ở lần nộp 2 —: khối đếm `count(*)` của `071` thấy hai và cho qua; K4b đếm NGƯỜI và chặn; người thứ hai ký thì mở", async () => {
    const t = await toChucDaBat();
    const kep = await goiNhap(t, GOI_CAP_KEP);
    await moi(t, kep, await nhaCungCap(t));
    await nop(t, kep);
    await duyet(t, kep, t.pm2);
    await withTenant(apiPool, t.org, (c) =>
      returnRfqToDraft(c, t.org, { rfqId: kep, reason: "PM tra ve: soat lai", actorSessionId: t.pm.s }, apiPool),
    );
    await nop(t, kep);
    await duyet(t, kep, t.pm2);
    expect(await bamDaKy(kep), "cùng một người, hai hàng, cùng băm danh sách").toHaveLength(2);
    expect((await loi(mo(t, kep)))?.message).toBe("RFQ nay can 2 chu ky TREN DANH SACH MOI HIEN TAI, moi co 1 (K4b)");
    await duyet(t, kep, t.pm3);
    expect(await loi(mo(t, kep))).toBeNull();
  });
});
