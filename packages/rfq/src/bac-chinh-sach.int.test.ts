import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, approveRfq, cancelRfq, createRfq, openRfq, submitRfqForApproval } from "./rfq.js";
import { createProcurementPolicy, getActiveProcurementPolicy, setRfqBudget } from "./procurement-policy.js";
import { CHOT_VAO_SO, ChotKiemSoatError } from "./chot-kiem-soat.js";

// =============================================================================================
// [S1.156 / S3.1a] BẬC GIÁ TRỊ, CHỮ KÝ THỨ HAI, CÔNG TẮC ADR-080 VÀ PHIÊN BẢN HIỆU LỰC — ĐO TRÊN
// POSTGRES THẬT DƯỚI `app_api`
//
// Migration `069_bac_va_chu_ky_chinh_sach`. Mỗi lớp của nó có ở đây một phép đo HÀNH VI và một ĐỘT
// BIẾN: tắt (hay viết lại) đúng lớp ấy thì chính câu vừa bị chặn đi lọt. Không nhãn INV: bất biến S3
// có nhãn (K1) ra đời ở S3.1b, khi có thứ đọc bậc.
//
// [S1.166 / S3.1b] Mục (6) đo K1 trên `072_bac_cua_goi`: bậc của gói, ngân sách bắt buộc ghim đúng
// phiên bản hiệu lực, cạnh nộp duyệt, và lớp từ chối `CONTROL_DENIED`. Các ca ấy mang nhãn `[INV-K1]`.
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG (`taoToChuc`): công tắc ADR-080 một chiều, nên dùng chung một tổ
// chức là để thứ tự chạy quyết định kết quả.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `rfq.int.test.ts`: cặp P-256 thật, khoá riêng "bọc" bằng xor
// 0xff. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo hạn xoá khoá, không đo phép bọc.
const boBocGia = {
  name: "gia-cho-test-bac-chinh-sach",
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

// ---- Bậc -------------------------------------------------------------------------------------
type Bac = Readonly<Record<string, unknown>>;

/** Một bậc thường đủ mười khoá; `ghiDe` thay hay thêm khoá, giá trị `undefined` thì GỠ khoá ấy. */
function bacThuong(tu: number, ghiDe: Bac = {}): Bac {
  const goc: Bac = {
    tu_so_tien: tu,
    so_ncc_toi_thieu: 1,
    award_vai_khac_nhau: false,
    ky_danh_sach_moi: false,
    xoay_vong_n: 0,
    award_so_chu_ky: 1,
    award_vai: ["DIRECTOR"],
    tham_dinh_truoc_trao: false,
    khai_xung_dot: false,
    dau_thau_chinh_thuc: false,
  };
  return Object.fromEntries(Object.entries({ ...goc, ...ghiDe }).filter(([, v]) => v !== undefined));
}
const bacChinhThuc = (tu: number): Bac => ({ tu_so_tien: tu, dau_thau_chinh_thuc: true });
/** Bậc chuẩn: một bậc thường từ 0 và bậc đấu thầu chính thức từ 10 tỷ. */
const BAC_CHUAN: readonly Bac[] = [bacThuong(0), bacChinhThuc(10_000_000_000)];

// ---- Dàn cảnh --------------------------------------------------------------------------------
let db: TestDatabase;
let apiPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo phiên bản và gói thầu. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER thứ hai — duyệt gói (người duyệt khác người tạo). */
  readonly pm2: Nguoi;
  /** FINANCE — vai DUY NHẤT giữ `policy.manage` (033): người ký. */
  readonly tc: Nguoi;
  readonly tc2: Nguoi;
  /** DIRECTOR — giữ `po.approve`, không giữ `policy.manage`. */
  readonly gd: Nguoi;
  /** BUYER — không giữ `policy.manage`. */
  readonly nm: Nguoi;
  /** Phiên bản 1, không bậc, qua `createProcurementPolicy`. */
  readonly v1: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoPhien(org: string, u: string): Promise<string> {
  return motId(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [org, u, randomBytes(32)],
  );
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `bac-${randomBytes(4).toString("hex")}`,
  ]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const u = await motId("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id", [
      org,
      `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
    ]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    return { u, s: await taoPhien(org, u) };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const tc = await nguoi("FINANCE");
  const tc2 = await nguoi("FINANCE");
  const gd = await nguoi("DIRECTOR");
  const nm = await nguoi("BUYER");
  const v1 = (
    await withTenant(apiPool, org, (c) =>
      createProcurementPolicy(c, org, {
        version: 1,
        dualApprovalThreshold: "100000000.00",
        currency: "VND",
        actorSessionId: pm.s,
      }),
    )
  ).id;
  return { org, pm, pm2, tc, tc2, gd, nm, v1 };
}

interface PhienBanVao {
  readonly tiers?: unknown;
  /** `chia_nho_cua_so_ngay`, `tham_dinh_hieu_luc_thang` — mặc định `[30, 12]` khi có bậc, `[null, null]` khi không. */
  readonly muc?: readonly [number | null, number | null];
  readonly nguoi?: Nguoi;
  /** `effective_from` — mặc định `now()` của giao dịch chèn. */
  readonly hieuLucTu?: string;
  readonly nghiem?: boolean;
  /** `key_purge_grace_hours` — `014` không cấp cột này cho `app_api`, nên đặt nó là một câu DỰNG dưới chủ sở hữu. */
  readonly anHanGio?: number;
}

/** Câu chèn phiên bản: số phiên bản là `max + 1` của tổ chức, đúng thứ `035` đòi. `$9` là `key_purge_grace_hours`. */
const CAU_CHEN_PHIEN_BAN =
  "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
  "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
  "VALUES ($1, (SELECT coalesce(max(p.version), 0) + 1 FROM org_procurement_policies p WHERE p.org_id = $1), " +
  "'100000000.00', 'VND', $2::jsonb, $3, $4, $5, coalesce($6::timestamptz, now()), $7, $8) RETURNING id";
const CAU_CHEN_PHIEN_BAN_AN_HAN =
  "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
  "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id, " +
  "key_purge_grace_hours) " +
  "VALUES ($1, (SELECT coalesce(max(p.version), 0) + 1 FROM org_procurement_policies p WHERE p.org_id = $1), " +
  "'100000000.00', 'VND', $2::jsonb, $3, $4, $5, coalesce($6::timestamptz, now()), $7, $8, $9) RETURNING id";

function thamSoPhienBan(t: ToChuc, v: PhienBanVao): unknown[] {
  const coBac = v.tiers !== undefined && v.tiers !== null;
  const [chiaNho, thamDinh] = v.muc ?? (coBac ? [30, 12] : [null, null]);
  const ai = v.nguoi ?? t.pm;
  return [t.org, coBac ? JSON.stringify(v.tiers) : null, chiaNho, thamDinh, v.nghiem ?? true, v.hieuLucTu ?? null, ai.u, ai.s];
}

async function chenPhienBan(t: ToChuc, v: PhienBanVao): Promise<string> {
  // `014` không cấp `key_purge_grace_hours` cho `app_api`: phiên bản mang ân hạn là câu DỰNG dưới chủ sở hữu
  // (khuôn `datAnHan` của `key-material.int.test.ts`) — mọi trigger vẫn chạy, chỉ RLS và quyền cột không.
  if (v.anHanGio !== undefined) return motId(CAU_CHEN_PHIEN_BAN_AN_HAN, [...thamSoPhienBan(t, v), v.anHanGio]);
  return (
    await withTenant(apiPool, t.org, (c) => c.query<{ id: string }>(CAU_CHEN_PHIEN_BAN, thamSoPhienBan(t, v)))
  ).rows[0]!.id;
}

const CAU_KY =
  "INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)";

async function ky(t: ToChuc, policyId: string, ai: Nguoi, phien: string = ai.s): Promise<void> {
  await withTenant(apiPool, t.org, (c) => c.query(CAU_KY, [t.org, policyId, ai.u, phien]));
}

interface LoiPg {
  readonly message: string;
  readonly code: string;
  readonly where: string;
  readonly constraint: string;
}

async function loi(p: Promise<unknown>): Promise<LoiPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string; where?: string; constraint?: string };
    return { message: x.message, code: x.code ?? "", where: x.where ?? "", constraint: x.constraint ?? "" };
  }
}

async function hieuLuc(t: ToChuc, luc: string | null = null): Promise<string | null> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ id: string | null }>("SELECT public.chinh_sach_hieu_luc($1, coalesce($2::timestamptz, now())) AS id", [t.org, luc]),
  );
  return rows[0]?.id ?? null;
}

/** `to_chuc_da_bat_s3(hoi)` hỏi dưới RLS của tổ chức `t`. */
async function daBat(t: ToChuc, hoi: string = t.org): Promise<boolean> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [hoi]),
  );
  return rows[0]!.b;
}

/**
 * [S1.201 / S3.6a] Nhóm hàng của tổ chức, dựng MỘT lần bởi người FINANCE (giữ `category.manage`): tổ chức đã bật không nộp duyệt
 * được gói không nhóm hàng — K1 ở tệp này đo ngân sách, không đo nhóm hàng (`nhom-hang.int.test.ts`). Tổ chức chưa bật nhận cùng
 * nhóm; ở đó nó tuỳ chọn.
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

async function taoGoi(t: ToChuc): Promise<string> {
  const categoryId = await nhomCua(t);
  return withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
}

/**
 * [S1.266 / S3.3c1] Một lời mời tới một nhà cung cấp ĐẾM ĐƯỢC cho chốt K2 (S3.3c2) — chỉ gọi ở tổ chức ĐÃ BẬT (xác minh K8a
 * đòi nó). Hồ sơ do người nhập riêng của helper dựng, `tc` (FINANCE) xác minh — mọi phiên bản mà ngân sách của một gói nộp duyệt
 * ghim đều do `pm` khai (`chenPhienBan` mặc định), nên `tc` không là tác giả của nó. Câu chèn là câu của `createInvitation`, người
 * mời `pm` (người tạo gói). Tệp này đo K1: không có lời mời này thì mọi gói thiếu nhà cung cấp và K2 — hỏi SAU K1 ở tầng gói,
 * trigger xếp SAU K1 — từ chối mọi ca nộp lẽ ra đi qua; mọi lời từ chối K1 mà tệp chờ vẫn đứng trước.
 */
async function moiNccDemDuoc(t: ToChuc, rfqId: string): Promise<void> {
  const n = (await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc }))[0]!;
  await withTenant(apiPool, t.org, (c) =>
    c.query(
      "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6)",
      [t.org, rfqId, n.ncc, n.lh, t.pm.u, t.pm.s],
    ),
  );
}

/** Một gói đi trọn đường sản xuất tới HUỶ — khoá đã sinh và đã bị THU HỒI. Mỗi bước một giao dịch. */
async function goiDaHuy(t: ToChuc): Promise<string> {
  const rfqId = await taoGoi(t);
  // [S1.266 / S3.3c1] Tổ chức đã bật: một lời mời đếm được, để K2 cho gói rời DRAFT. Chưa bật: nguyên đường MVP1.
  if (await daBat(t)) await moiNccDemDuoc(t, rfqId);
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, {
      rfqId,
      lineNo: 1,
      description: "Thep tam SS400 3mm",
      quantity: "100.0000",
      unit: "tam",
      actorSessionId: t.pm.s,
    });
    await submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool);
  });
  await withTenant(apiPool, t.org, async (c) => {
    // [S1.198 / khoản 256] Lời duyệt mang lần nộp vừa đọc — tổ chức đã bật đòi nó.
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]!.n;
    await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s, lanNopDaXem: lan }, apiPool);
  });
  await withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
  await withTenant(apiPool, t.org, (c) =>
    cancelRfq(c, t.org, { rfqId, reason: "Huy de do han xoa khoa", actorSessionId: t.pm.s }, apiPool),
  );
  return rfqId;
}

/**
 * ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: chủ sở hữu tắt `trigger` trên `bang`, rồi `cau` chạy dưới
 * `app_api` trong tổ chức — trả lỗi của câu, hay `null` nếu nó đi qua. Lược đồ không đổi sau đó.
 */
async function khiTatTrigger(bang: string, trigger: string, org: string, cau: string, thamSo: readonly unknown[]): Promise<LoiPg | null> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`ALTER TABLE public.${bang} DISABLE TRIGGER ${trigger}`);
    await c.query("SET LOCAL ROLE app_api");
    await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
    return await loi(c.query(cau, [...thamSo]));
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

async function trangThaiTrigger(trigger: string): Promise<string> {
  return (await db.pool.query<{ e: string }>("SELECT tgenabled AS e FROM pg_trigger WHERE tgname = $1", [trigger])).rows[0]!.e;
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

/** Chờ tới khi backend `pid` ĐỨNG CHỜ một khoá tư vấn — mốc để biết câu của nó đang bị chặn, không phải chưa chạy. */
async function choKhoaTuVan(pid: number): Promise<void> {
  for (let lan = 0; lan < 250; lan += 1) {
    const { rows } = await db.pool.query<{ cho: boolean }>(
      "SELECT (wait_event_type = 'Lock' AND wait_event = 'advisory') AS cho FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (rows[0]?.cho === true) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`backend ${pid} không đứng chờ khoá tư vấn sau 5 s`);
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
// (1) HÌNH DẠNG BẬC — `chinh_sach_kiem_bac`
// =============================================================================================
describe("S3.1a — hình dạng bậc: `chinh_sach_kiem_bac` và ba ràng buộc mức chính sách", () => {
  let t: ToChuc;
  beforeAll(async () => {
    t = await taoToChuc();
  }, 60000);

  const CA_SAI: readonly (readonly [string, unknown, RegExp])[] = [
    ["không phải mảng", { tu_so_tien: 0 }, /tiers phai la mot mang JSON khong rong/u],
    ["mảng rỗng", [], /tiers phai la mot mang JSON khong rong/u],
    ["phần tử không phải đối tượng", [1], /bac 0 khong phai mot doi tuong JSON/u],
    ["khoá lạ", [bacThuong(0, { la: 1 })], /bac 0 mang khoa la "la"/u],
    ["thiếu tu_so_tien", [bacThuong(0, { tu_so_tien: undefined })], /bac 0 thieu tu_so_tien kieu so/u],
    ["tu_so_tien là chuỗi", [bacThuong(0, { tu_so_tien: "0" })], /bac 0 thieu tu_so_tien kieu so/u],
    ["tu_so_tien âm", [bacThuong(-1)], /bac 0 co tu_so_tien ngoai numeric\(18,2\) khong am/u],
    ["tu_so_tien ba số lẻ", [bacThuong(0), bacThuong(1000.001)], /bac 1 co tu_so_tien ngoai numeric\(18,2\)/u],
    ["tu_so_tien tràn numeric(18,2)", [bacThuong(0), bacThuong(1e16)], /bac 1 co tu_so_tien ngoai numeric\(18,2\)/u],
    ["bậc đầu không từ 0", [bacThuong(5)], /bac dau phai co tu_so_tien = 0/u],
    ["cận dưới không tăng ngặt", [bacThuong(0), bacThuong(100), bacThuong(100)], /can duoi cua cac bac phai tang ngat: bac 2/u],
    ["thiếu dau_thau_chinh_thuc", [bacThuong(0, { dau_thau_chinh_thuc: undefined })], /bac 0 thieu dau_thau_chinh_thuc kieu boolean/u],
    ["bậc chính thức không đứng cuối", [bacThuong(0), bacChinhThuc(100), bacThuong(200)], /bac dau thau chinh thuc chi dung CUOI/u],
    ["bậc chính thức mang khoá thừa", [bacThuong(0), { ...bacChinhThuc(100), so_ncc_toi_thieu: 3 }], /chi mang tu_so_tien va dau_thau_chinh_thuc/u],
    ["bậc thường thiếu một khoá", [bacThuong(0, { khai_xung_dot: undefined })], /bac 0 phai khai du 10 khoa, dang co 9/u],
    ["khoá boolean là chuỗi", [bacThuong(0, { award_vai_khac_nhau: "false" })], /bac 0 co award_vai_khac_nhau khong phai boolean/u],
    ["so_ncc_toi_thieu = 0", [bacThuong(0, { so_ncc_toi_thieu: 0 })], /so_ncc_toi_thieu phai la so nguyen trong \[1, 32767\]/u],
    ["so_ncc_toi_thieu lẻ", [bacThuong(0, { so_ncc_toi_thieu: 2.5 })], /so_ncc_toi_thieu phai la so nguyen trong \[1, 32767\]/u],
    ["so_ncc_toi_thieu tràn smallint", [bacThuong(0, { so_ncc_toi_thieu: 32768 })], /so_ncc_toi_thieu phai la so nguyen trong \[1, 32767\]/u],
    ["so_ncc_toi_thieu là chuỗi", [bacThuong(0, { so_ncc_toi_thieu: "3" })], /bac 0 co so_ncc_toi_thieu khong phai so/u],
    ["xoay_vong_n âm", [bacThuong(0, { xoay_vong_n: -1 })], /xoay_vong_n phai la so nguyen trong \[0, 32767\]/u],
    ["award_so_chu_ky = 3", [bacThuong(0, { award_so_chu_ky: 3 })], /award_so_chu_ky phai la 1 hoac 2/u],
    ["award_vai rỗng", [bacThuong(0, { award_vai: [] })], /award_vai phai la mang vai khong rong/u],
    ["award_vai là chuỗi", [bacThuong(0, { award_vai: "DIRECTOR" })], /award_vai phai la mang vai khong rong/u],
    ["award_vai chứa số", [bacThuong(0, { award_vai: [1] })], /award_vai chua phan tu khong phai chuoi/u],
    ["award_vai lặp vai", [bacThuong(0, { award_vai: ["DIRECTOR", "DIRECTOR"] })], /award_vai lap vai/u],
    ["vai không giữ po.approve", [bacThuong(0, { award_vai: ["BUYER"] })], /award_vai mang mot vai khong giu po\.approve/u],
    ["vai không tồn tại", [bacThuong(0, { award_vai: ["KHONG_CO_VAI"] })], /award_vai mang mot vai khong giu po\.approve/u],
    [
      "hai chữ ký ở hai vai mà award_vai chỉ một vai",
      [bacThuong(0, { award_so_chu_ky: 2, award_vai_khac_nhau: true })],
      /doi hai chu ky o hai vai khac nhau ma award_vai chi co mot vai/u,
    ],
  ];

  it("mỗi hình dạng hỏng bị CHÍNH `chinh_sach_kiem_bac` từ chối, với đúng thông điệp — và không ca nào tiêu một số phiên bản", async () => {
    for (const [ten, tiers, thongDiep] of CA_SAI) {
      const l = await loi(chenPhienBan(t, { tiers }));
      expect(l?.code, ten).toBe("23514");
      expect(l?.message, ten).toMatch(thongDiep);
      expect(l?.where, `${ten}: lời từ chối phải đến từ chinh_sach_kiem_bac`).toMatch(/function chinh_sach_kiem_bac\(/u);
    }
    const { rows } = await db.pool.query<{ n: number }>("SELECT max(version)::int AS n FROM org_procurement_policies WHERE org_id = $1", [t.org]);
    expect(rows[0]!.n, "không lần chèn hỏng nào được để lại hàng").toBe(1);
  });

  it("hình dạng đúng đi qua: bậc chuẩn, hai chữ ký ở hai vai, cận dưới hai số lẻ; phiên bản không bậc vẫn khai được mức", async () => {
    const CA_DUNG: readonly (readonly [string, PhienBanVao])[] = [
      ["bậc chuẩn", { tiers: BAC_CHUAN }],
      ["hai chữ ký ở hai vai", { tiers: [bacThuong(0, { award_so_chu_ky: 2, award_vai_khac_nhau: true, award_vai: ["DIRECTOR", "FINANCE"] })] }],
      ["cận dưới hai số lẻ", { tiers: [bacThuong(0), bacThuong(1000.5), bacChinhThuc(10_000_000_000)] }],
      ["không bậc, có mức", { tiers: null, muc: [30, 12] }],
    ];
    for (const [ten, v] of CA_DUNG) expect(await loi(chenPhienBan(t, v)), ten).toBeNull();
    // Bậc đọc lại NGUYÊN VĂN: `jsonb` giữ số như đã gửi.
    const { rows } = await withTenant(apiPool, t.org, (c) =>
      c.query<{ tiers: unknown }>("SELECT tiers FROM org_procurement_policies WHERE org_id = $1 AND version = 2", [t.org]),
    );
    expect(rows[0]!.tiers).toEqual(BAC_CHUAN);
  });

  it("ba ràng buộc mức: bậc KÉO THEO mức, hai cột mức cùng khai hoặc cùng không, và dương", async () => {
    const CA: readonly (readonly [string, PhienBanVao, string])[] = [
      ["bậc mà thiếu mức", { tiers: BAC_CHUAN, muc: [null, null] }, "org_procurement_policies_bac_kem_muc_s3"],
      ["chỉ một cột mức", { tiers: null, muc: [30, null] }, "org_procurement_policies_muc_s3_du_bo"],
      ["mức bằng 0", { tiers: null, muc: [0, 12] }, "org_procurement_policies_muc_s3_duong"],
      ["mức âm", { tiers: null, muc: [30, -1] }, "org_procurement_policies_muc_s3_duong"],
    ];
    for (const [ten, v, rangBuoc] of CA) {
      const l = await loi(chenPhienBan(t, v));
      expect([l?.code, l?.constraint], ten).toEqual(["23514", rangBuoc]);
    }
  });

  it("ĐỘT BIẾN: tắt `org_procurement_policies_kiem_bac` thì một mảng bậc rỗng đi lọt; trigger còn ENABLE ALWAYS thì bị chặn lại", async () => {
    const thamSo = thamSoPhienBan(t, { tiers: [] });
    expect(await khiTatTrigger("org_procurement_policies", "org_procurement_policies_kiem_bac", t.org, CAU_CHEN_PHIEN_BAN, thamSo)).toBeNull();
    expect(await trangThaiTrigger("org_procurement_policies_kiem_bac")).toBe("A");
    expect((await loi(chenPhienBan(t, { tiers: [] })))?.message).toMatch(/tiers phai la mot mang JSON khong rong/u);
  });
});

// =============================================================================================
// (2) CHỮ KÝ THỨ HAI — `chinh_sach_kiem_nguoi_ky`, ADR-082 ⑺
// =============================================================================================
describe("S3.1a — chữ ký thứ hai của phiên bản chính sách (ADR-082 ⑺)", () => {
  it("đường đúng: người KHÁC người tạo, giữ `policy.manage`, ký bằng CHÍNH phiên của mình — `signed_at` do CSDL đặt, và công tắc bật", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    expect(await daBat(t), "phiên bản có bậc CHƯA KÝ chưa bật gì").toBe(false);
    const truoc = (await db.pool.query<{ luc: Date }>("SELECT clock_timestamp() AS luc")).rows[0]!.luc;
    await ky(t, v2, t.tc);
    const sau = (await db.pool.query<{ luc: Date }>("SELECT clock_timestamp() AS luc")).rows[0]!.luc;
    const { rows } = await withTenant(apiPool, t.org, (c) =>
      c.query<{ signed_by: string; signed_by_session_id: string; signed_at: Date }>(
        "SELECT signed_by, signed_by_session_id, signed_at FROM org_policy_signatures WHERE policy_id = $1",
        [v2],
      ),
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.signed_by, rows[0]!.signed_by_session_id]).toEqual([t.tc.u, t.tc.s]);
    expect(rows[0]!.signed_at.getTime()).toBeGreaterThanOrEqual(truoc.getTime());
    expect(rows[0]!.signed_at.getTime()).toBeLessThanOrEqual(sau.getTime());
    expect(await daBat(t)).toBe(true);
  });

  it("người tạo KHÔNG tự ký được — kể cả khi chính họ giữ `policy.manage`; một người `policy.manage` khác thì ký được", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN, nguoi: t.tc });
    const l = await loi(ky(t, v2, t.tc));
    expect(l?.message).toMatch(/Nguoi tao phien ban chinh sach khong duoc tu ky/u);
    expect(l?.where).toMatch(/function chinh_sach_kiem_nguoi_ky\(/u);
    expect(await daBat(t)).toBe(false);
    expect(await loi(ky(t, v2, t.tc2))).toBeNull();
  });

  it("người ký phải giữ `policy.manage`: BUYER, PROCUREMENT_MANAGER và DIRECTOR đều bị từ chối", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    for (const [ten, ai] of [["BUYER", t.nm], ["PROCUREMENT_MANAGER", t.pm2], ["DIRECTOR", t.gd]] as const) {
      const l = await loi(ky(t, v2, ai));
      expect(l?.message, ten).toMatch(/Nguoi ky phien ban chinh sach phai giu policy\.manage/u);
      expect(l?.where, ten).toMatch(/function chinh_sach_kiem_nguoi_ky\(/u);
    }
    expect(await daBat(t)).toBe(false);
  });

  it("danh tính là DẪN XUẤT của phiên: phiên của người khác và phiên đã thu hồi đều bị `kiem_danh_tinh_theo_phien` từ chối", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    expect((await loi(ky(t, v2, t.tc, t.tc2.s)))?.message).toMatch(/signed_by khong khop chu phien/u);
    const thuHoi = await taoPhien(t.org, t.tc.u);
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [thuHoi]);
    expect((await loi(ky(t, v2, t.tc, thuHoi)))?.message).toMatch(/Phien khong hop le/u);
    expect(await daBat(t)).toBe(false);
  });

  it("chỉ phiên bản CÓ BẬC nhận chữ ký; mỗi phiên bản MỘT chữ ký", async () => {
    const t = await taoToChuc();
    const l = await loi(ky(t, t.v1, t.tc));
    expect(l?.message).toMatch(/Chi phien ban chinh sach CO BAC moi nhan chu ky thu hai/u);
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    await ky(t, v2, t.tc);
    const l2 = await loi(ky(t, v2, t.tc2));
    expect([l2?.code, l2?.constraint]).toEqual(["23505", "org_policy_signatures_org_id_policy_id_key"]);
  });

  it("[ADR-080] chỉ ký được phiên bản MỚI NHẤT, và chỉ khi nó đã tới ngày hiệu lực", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    await chenPhienBan(t, { tiers: BAC_CHUAN });
    expect((await loi(ky(t, v2, t.tc)))?.message).toMatch(/Chi ky duoc phien ban chinh sach MOI NHAT cua to chuc/u);
    const hen = await chenPhienBan(t, { tiers: BAC_CHUAN, hieuLucTu: new Date(Date.now() + 24 * 3600 * 1000).toISOString() });
    const l = await loi(ky(t, hen, t.tc));
    expect(l?.message).toMatch(/Phien ban chinh sach chua toi ngay hieu luc/u);
    expect(l?.where).toMatch(/function chinh_sach_kiem_nguoi_ky\(/u);
    expect(await daBat(t)).toBe(false);
  });

  it("cô lập: tổ chức khác không thấy chữ ký, không hỏi được công tắc của nhau, không ký hộ; phiên khách không thấy gì", async () => {
    const a = await taoToChuc();
    const b = await taoToChuc();
    const va = await chenPhienBan(a, { tiers: BAC_CHUAN });
    await ky(a, va, a.tc);
    expect(await daBat(a)).toBe(true);
    const demDuoi = async (t: ToChuc, khach: boolean): Promise<number> =>
      withTenant(apiPool, t.org, async (c) => {
        if (khach) await c.query("SELECT pg_catalog.set_config('app.guest_session_id', $1, true)", [randomUUID()]);
        return (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM org_policy_signatures")).rows[0]!.n;
      });
    expect(await demDuoi(a, false), "đối chứng: A thấy chữ ký của chính mình").toBe(1);
    expect(await demDuoi(b, false), "B không thấy chữ ký của A").toBe(0);
    expect(await demDuoi(a, true), "phiên khách của A không thấy chữ ký nào (policy RESTRICTIVE `_khach`)").toBe(0);
    expect(await daBat(b, a.org), "hỏi công tắc của A dưới RLS của B: không thấy hàng nào ⇒ false").toBe(false);
    // A ký phiên bản của B dưới org_id của chính A: không có phiên bản ấy trong A.
    const vb = await chenPhienBan(b, { tiers: BAC_CHUAN });
    const l = await loi(withTenant(apiPool, a.org, (c) => c.query(CAU_KY, [a.org, vb, a.tc.u, a.tc.s])));
    expect(l?.code).toBe("23503");
    // A chèn một chữ ký mang org_id của B: phiên của người ký B không thấy được dưới RLS của A.
    const l2 = await loi(withTenant(apiPool, a.org, (c) => c.query(CAU_KY, [b.org, vb, b.tc.u, b.tc.s])));
    expect(l2).not.toBeNull();
    expect(await daBat(b)).toBe(false);
  });

  it("chỉ ghi thêm: `app_api` không có UPDATE/DELETE và không đặt được `signed_at`; chủ sở hữu bị trigger chặn UPDATE/DELETE/TRUNCATE", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    await ky(t, v2, t.tc);
    for (const cau of [
      "UPDATE org_policy_signatures SET signed_at = signed_at - interval '1 day' WHERE policy_id = $1",
      "DELETE FROM org_policy_signatures WHERE policy_id = $1",
    ]) {
      expect((await loi(withTenant(apiPool, t.org, (c) => c.query(cau, [v2]))))?.code, cau).toBe("42501");
    }
    const v3 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    const lui = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id, signed_at) " +
            "VALUES ($1, $2, $3, $4, now() - interval '1 day')",
          [t.org, v3, t.tc.u, t.tc.s],
        ),
      ),
    );
    expect(lui?.code, "ký lùi ngày là một cột không cấp").toBe("42501");
    for (const [cau, thamSo] of [
      ["UPDATE org_policy_signatures SET signed_at = signed_at - interval '1 day' WHERE policy_id = $1", [v2]],
      ["DELETE FROM org_policy_signatures WHERE policy_id = $1", [v2]],
      ["TRUNCATE org_policy_signatures", []],
    ] as const) {
      expect((await loi(db.pool.query(cau, [...thamSo])))?.message, cau).toMatch(/chi duoc ghi them/u);
    }
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM org_policy_signatures WHERE org_id = $1", [t.org]);
    expect(rows[0]!.n).toBe(1);
  });

  it("ĐỘT BIẾN: tắt `org_policy_signatures_kiem_nguoi_ky` thì người tạo TỰ KÝ được; trigger còn ENABLE ALWAYS thì bị chặn lại", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN, nguoi: t.tc });
    expect(
      await khiTatTrigger("org_policy_signatures", "org_policy_signatures_kiem_nguoi_ky", t.org, CAU_KY, [t.org, v2, t.tc.u, t.tc.s]),
    ).toBeNull();
    expect(await trangThaiTrigger("org_policy_signatures_kiem_nguoi_ky")).toBe("A");
    expect((await loi(ky(t, v2, t.tc)))?.message).toMatch(/khong duoc tu ky/u);
  });
});

// =============================================================================================
// (3) CÔNG TẮC ADR-080 — MỘT CHIỀU, VÀ *ĐÃ BẬT ⇒ PHIÊN BẢN HIỆU LỰC CÓ BẬC*
// =============================================================================================
describe("S3.1a — công tắc ADR-080", () => {
  it("một chiều, và đã bật thì phiên bản hiệu lực có bậc: v1 không bậc, v2 có bậc, v3 không bậc — ký v2 bị từ chối; ký v4 có bậc thì bật, và từ đó phiên bản không bậc bị từ chối", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    expect(await daBat(t)).toBe(false);
    // Chưa bật: phiên bản không bậc vẫn thêm được — tổ chức chạy như MVP1.
    const v3 = await chenPhienBan(t, {});
    expect(await hieuLuc(t)).toBe(v3);
    // Ký v2 lúc này là bật công tắc với phiên bản hiệu lực là v3 KHÔNG BẬC — lần đo đã dựng vế MỚI NHẤT.
    expect((await loi(ky(t, v2, t.tc)))?.message).toMatch(/MOI NHAT/u);
    const v4 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    await ky(t, v4, t.tc);
    expect(await daBat(t)).toBe(true);
    expect(await hieuLuc(t)).toBe(v4);
    const l = await loi(chenPhienBan(t, {}));
    expect(l?.message).toMatch(/To chuc da bat S3 \(ADR-080\): phien ban chinh sach moi phai khai bac gia tri/u);
    expect(l?.where).toMatch(/function chinh_sach_da_bat_thi_phai_co_bac\(/u);
    // Phiên bản có bậc thì vẫn thêm được; chưa ký thì chưa có hiệu lực.
    await chenPhienBan(t, { tiers: BAC_CHUAN });
    expect(await hieuLuc(t)).toBe(v4);
    expect(await daBat(t)).toBe(true);
  });

  it("ĐUA: lần chèn phiên bản không bậc và lần ký cùng tổ chức xếp hàng sau MỘT khoá tư vấn — kẻ đến sau đọc trạng thái mới và bị từ chối, theo cả hai thứ tự", async () => {
    // Thứ tự ①: phiên bản không bậc giữ khoá trước; lần ký chờ, rồi thấy nó ⇒ v2 không còn là MỚI NHẤT.
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    const c1 = await moGiaoDich(t.org);
    const c2 = await moGiaoDich(t.org);
    try {
      await c1.query(CAU_CHEN_PHIEN_BAN, thamSoPhienBan(t, {}));
      const pid2 = await pidCua(c2);
      const kyCho = loi(c2.query(CAU_KY, [t.org, v2, t.tc.u, t.tc.s]));
      await choKhoaTuVan(pid2);
      await c1.query("COMMIT");
      expect((await kyCho)?.message, "①: lần ký chờ khoá rồi thấy phiên bản vừa thêm").toMatch(/MOI NHAT/u);
    } finally {
      await c2.query("ROLLBACK");
      await c1.query("ROLLBACK");
      c1.release();
      c2.release();
    }
    expect(await daBat(t)).toBe(false);

    // Thứ tự ②: lần ký giữ khoá trước; phiên bản không bậc chờ, rồi thấy chữ ký ⇒ tổ chức đã bật.
    const u = await taoToChuc();
    const w2 = await chenPhienBan(u, { tiers: BAC_CHUAN });
    const d1 = await moGiaoDich(u.org);
    const d2 = await moGiaoDich(u.org);
    try {
      await d2.query(CAU_KY, [u.org, w2, u.tc.u, u.tc.s]);
      const pid1 = await pidCua(d1);
      const chenCho = loi(d1.query(CAU_CHEN_PHIEN_BAN, thamSoPhienBan(u, {})));
      await choKhoaTuVan(pid1);
      await d2.query("COMMIT");
      expect((await chenCho)?.message, "②: lần chèn chờ khoá rồi thấy chữ ký vừa ghi").toMatch(/To chuc da bat S3/u);
    } finally {
      await d1.query("ROLLBACK");
      await d2.query("ROLLBACK");
      d1.release();
      d2.release();
    }
    expect(await daBat(u)).toBe(true);
    expect(await hieuLuc(u)).toBe(w2);
  });

  it("ĐỘT BIẾN: gỡ khoá tư vấn khỏi `chinh_sach_kiem_nguoi_ky` thì thứ tự ① đi lọt — tổ chức ĐÃ BẬT mà phiên bản hiệu lực KHÔNG BẬC", async () => {
    const { rows } = await db.pool.query<{ def: string; src: string }>(
      "SELECT pg_get_functiondef(p.oid) AS def, p.prosrc AS src FROM pg_proc p WHERE p.oid = 'public.chinh_sach_kiem_nguoi_ky()'::regprocedure",
    );
    const goc = rows[0]!;
    const dotBien = goc.def.replace(/PERFORM pg_catalog\.pg_advisory_xact_lock\([\s\S]*?\);\n/u, "");
    expect(dotBien, "đột biến phải gỡ được đúng câu khoá").not.toBe(goc.def);
    await db.pool.query(dotBien);
    try {
      const t = await taoToChuc();
      const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
      const c1 = await moGiaoDich(t.org);
      const c2 = await moGiaoDich(t.org);
      let v3 = "";
      try {
        v3 = (await c1.query<{ id: string }>(CAU_CHEN_PHIEN_BAN, thamSoPhienBan(t, {}))).rows[0]!.id;
        // Không khoá thì lần ký không chờ: nó không thấy v3 chưa commit, và đi qua.
        await c2.query(CAU_KY, [t.org, v2, t.tc.u, t.tc.s]);
        await c2.query("COMMIT");
        await c1.query("COMMIT");
      } finally {
        await c1.query("ROLLBACK");
        await c2.query("ROLLBACK");
        c1.release();
        c2.release();
      }
      expect(await daBat(t), "đã bật").toBe(true);
      expect(await hieuLuc(t), "…mà phiên bản hiệu lực là v3").toBe(v3);
      const { rows: bac } = await db.pool.query<{ tiers: unknown }>("SELECT tiers FROM org_procurement_policies WHERE id = $1", [v3]);
      expect(bac[0]!.tiers, "…và v3 KHÔNG có bậc").toBeNull();
    } finally {
      await db.pool.query(goc.def);
      const { rows: sau } = await db.pool.query<{ src: string }>(
        "SELECT prosrc AS src FROM pg_proc WHERE oid = 'public.chinh_sach_kiem_nguoi_ky()'::regprocedure",
      );
      expect(sau[0]!.src, "thân gốc phải được dựng lại").toBe(goc.src);
    }
  });

  it("ĐỘT BIẾN: bỏ vế MỚI NHẤT hay vế NGÀY HIỆU LỰC khỏi `chinh_sach_kiem_nguoi_ky` thì lần ký bật công tắc mà phiên bản hiệu lực KHÔNG BẬC", async () => {
    const goc = (
      await db.pool.query<{ def: string }>("SELECT pg_get_functiondef('public.chinh_sach_kiem_nguoi_ky()'::regprocedure) AS def")
    ).rows[0]!.def;
    /** Thay hàm bằng `dotBien` trong MỘT giao dịch, ký dưới `app_api`, đọc công tắc và phiên bản hiệu lực, rồi ROLLBACK. */
    const kyDuoiDotBien = async (dotBien: string, t: ToChuc, policyId: string): Promise<{ bat: boolean; khongBac: boolean }> => {
      expect(dotBien, "đột biến phải đổi được thân").not.toBe(goc);
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(dotBien);
        await c.query("SET LOCAL ROLE app_api");
        await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [t.org]);
        await c.query(CAU_KY, [t.org, policyId, t.tc.u, t.tc.s]);
        const { rows } = await c.query<{ bat: boolean; khong_bac: boolean }>(
          "SELECT public.to_chuc_da_bat_s3($1) AS bat, " +
            "(SELECT p.tiers IS NULL FROM org_procurement_policies p WHERE p.id = public.chinh_sach_hieu_luc($1, now())) AS khong_bac",
          [t.org],
        );
        return { bat: rows[0]!.bat, khongBac: rows[0]!.khong_bac };
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    };
    // Vế MỚI NHẤT: v2 có bậc, v3 không bậc đứng trên nó.
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    await chenPhienBan(t, {});
    expect(await kyDuoiDotBien(goc.replace("q.version > phien_ban", "q.version > phien_ban AND false"), t, v2)).toEqual({
      bat: true,
      khongBac: true,
    });
    // Vế NGÀY HIỆU LỰC: bản có bậc hẹn ngày mai — ký hôm nay thì hôm nay v1 không bậc vẫn là bản hiệu lực.
    const u = await taoToChuc();
    const hen = await chenPhienBan(u, { tiers: BAC_CHUAN, hieuLucTu: new Date(Date.now() + 24 * 3600 * 1000).toISOString() });
    expect(await kyDuoiDotBien(goc.replace("IF hieu_luc_tu > NEW.signed_at THEN", "IF false THEN"), u, hen)).toEqual({
      bat: true,
      khongBac: true,
    });
    // ROLLBACK dựng lại thân gốc: cả hai lần ký lại bị từ chối.
    expect((await loi(ky(t, v2, t.tc)))?.message).toMatch(/MOI NHAT/u);
    expect((await loi(ky(u, hen, u.tc)))?.message).toMatch(/chua toi ngay hieu luc/u);
  });

  it("ĐỘT BIẾN: tắt `org_procurement_policies_da_bat_thi_phai_co_bac` thì tổ chức đã bật lại thêm được phiên bản không bậc", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    await ky(t, v2, t.tc);
    expect(
      await khiTatTrigger(
        "org_procurement_policies",
        "org_procurement_policies_da_bat_thi_phai_co_bac",
        t.org,
        CAU_CHEN_PHIEN_BAN,
        thamSoPhienBan(t, {}),
      ),
    ).toBeNull();
    expect(await trangThaiTrigger("org_procurement_policies_da_bat_thi_phai_co_bac")).toBe("A");
    expect((await loi(chenPhienBan(t, {})))?.message).toMatch(/To chuc da bat S3/u);
  });
});

// =============================================================================================
// (4) PHIÊN BẢN HIỆU LỰC — MỘT HÀM, BỐN CHỖ ĐỌC
// =============================================================================================
describe("S3.1a — phiên bản hiệu lực: `chinh_sach_hieu_luc` và bốn chỗ đọc", () => {
  it("theo MỐC: phiên bản có bậc có hiệu lực từ lúc KÝ, phiên bản hẹn giờ từ `effective_from`, và trước phiên bản đầu thì không có gì", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    expect(await hieuLuc(t), "chưa ký: phiên bản có bậc chưa có hiệu lực").toBe(t.v1);
    await ky(t, v2, t.tc);
    const { rows } = await db.pool.query<{ ky: string; dau: string }>(
      "SELECT (SELECT signed_at::text FROM org_policy_signatures WHERE policy_id = $1) AS ky, " +
        "       (SELECT effective_from::text FROM org_procurement_policies WHERE id = $2) AS dau",
      [v2, t.v1],
    );
    const { ky: lucKy, dau } = rows[0]!;
    const truocMot = async (luc: string): Promise<string> =>
      (await db.pool.query<{ l: string }>("SELECT ($1::timestamptz - interval '1 microsecond')::text AS l", [luc])).rows[0]!.l;
    expect(await hieuLuc(t, lucKy), "đúng lúc ký").toBe(v2);
    expect(await hieuLuc(t, await truocMot(lucKy)), "một micro giây trước lúc ký").toBe(t.v1);
    expect(await hieuLuc(t, await truocMot(dau)), "trước phiên bản đầu").toBeNull();

    const h = await taoToChuc();
    const mai = new Date(Date.now() + 24 * 3600 * 1000);
    const hen = await chenPhienBan(h, { hieuLucTu: mai.toISOString() });
    expect(await hieuLuc(h), "phiên bản hẹn giờ chưa tới").toBe(h.v1);
    expect(await hieuLuc(h, new Date(mai.getTime() + 3600 * 1000).toISOString()), "…và tới").toBe(hen);
  });

  it("`getActiveProcurementPolicy` (ngưỡng kép, ghim ngân sách) đọc cùng hàm: bản có bậc chưa ký KHÔNG có hiệu lực — `setRfqBudget` ghim v1; ký rồi thì ghim v2", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    const hienHanh = async (): Promise<string | undefined> =>
      (await withTenant(apiPool, t.org, (c) => getActiveProcurementPolicy(c, t.org)))?.id;
    const ghim = async (): Promise<string> => {
      const r = await taoGoi(t);
      return (
        await withTenant(apiPool, t.org, (c) =>
          setRfqBudget(c, t.org, { rfqId: r, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s }),
        )
      ).policyId;
    };
    expect(await hienHanh()).toBe(t.v1);
    expect(await ghim()).toBe(t.v1);
    await ky(t, v2, t.tc);
    expect(await hienHanh()).toBe(v2);
    expect(await ghim()).toBe(v2);
  });

  it("`rfq_che_do_nghiem` (020 ⑵): gói tạo TRƯỚC lần ký giữ chính sách lúc nó ra đời — kể cả khi phiên bản có bậc đã có trước nó; gói tạo SAU đọc bản đã ký", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN, nghiem: false });
    const truoc = await taoGoi(t);
    await ky(t, v2, t.tc);
    const sau = await taoGoi(t);
    // Tiền đề, đo chứ không giả định: gói `truoc` ra đời SAU `effective_from` của v2 và TRƯỚC lần ký — đúng
    // ca mà luật cũ (`effective_from <= created_at`, phiên bản cao nhất) chọn v2.
    const { rows: tien } = await db.pool.query<{ ok: boolean }>(
      "SELECT (p.effective_from < r.created_at AND r.created_at < s.signed_at) AS ok " +
        "  FROM rfq_packages r, org_procurement_policies p, org_policy_signatures s WHERE r.id = $1 AND p.id = $2 AND s.policy_id = $2",
      [truoc, v2],
    );
    expect(tien[0]!.ok).toBe(true);
    const nghiem = async (r: string): Promise<boolean> =>
      (await withTenant(apiPool, t.org, (c) => c.query<{ b: boolean }>("SELECT public.rfq_che_do_nghiem($1) AS b", [r]))).rows[0]!.b;
    expect(await nghiem(truoc), "gói trước lần ký: v1 (strict mặc định)").toBe(true);
    expect(await nghiem(sau), "gói sau lần ký: v2 (strict = false)").toBe(false);
  });

  it("hạn xoá khoá (`026`): cả hàm đọc lẫn trigger xoá đi theo phiên bản hiệu lực lúc gói ra đời", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN, anHanGio: 0 });
    const truoc = await goiDaHuy(t);
    await ky(t, v2, t.tc);
    const sau = await goiDaHuy(t);
    // Tập lý do, không phải danh sách: một gói mở có thể mang nhiều hàng vật liệu khoá.
    const lyDo = async (r: string): Promise<string[]> => [
      ...new Set(
        (
          await withTenant(apiPool, t.org, (c) =>
            c.query<{ ly_do: string }>("SELECT ly_do FROM public.rfq_khoa_du_dieu_kien_xoa($1)", [r]),
          )
        ).rows.map((h) => h.ly_do),
      ),
    ];
    // v1 không bật xoá (NULL); v2 bật với ân hạn 0 giờ. Luật cũ của `026` chọn v2 cho CẢ HAI gói.
    expect(await lyDo(truoc)).toEqual(["CHINH_SACH_TAT"]);
    expect(await lyDo(sau)).toEqual(["DU_DIEU_KIEN"]);
    const xoa = async (r: string): Promise<LoiPg | null> =>
      loi(
        withTenant(apiPool, t.org, (c) =>
          c.query(
            "UPDATE rfq_key_material SET wrapped_private_key = NULL, purged_at = now(), purged_by = $2, " +
              "purged_by_session_id = $3 WHERE rfq_id = $1",
            [r, t.pm.u, t.pm.s],
          ),
        ),
      );
    expect((await xoa(truoc))?.message).toMatch(/KHONG bat xoa vat lieu khoa/u);
    expect(await xoa(sau)).toBeNull();
  });

  it("ĐỘT BIẾN: viết lại `chinh_sach_hieu_luc` theo luật cũ (bỏ vế chữ ký) thì bản CHƯA KÝ có hiệu lực ở cả `getActiveProcurementPolicy` lẫn `rfq_che_do_nghiem` — hàm ấy là lớp chịu lực", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN, nghiem: false });
    const r = await taoGoi(t);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "CREATE OR REPLACE FUNCTION public.chinh_sach_hieu_luc(p_org uuid, p_luc timestamptz) RETURNS uuid " +
          "LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $ham$ " +
          "SELECT p.id FROM public.org_procurement_policies p WHERE p.org_id = p_org AND p.effective_from <= p_luc " +
          "ORDER BY p.version DESC LIMIT 1 $ham$",
      );
      await c.query("SET LOCAL ROLE app_api");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [t.org]);
      expect((await getActiveProcurementPolicy(c, t.org))?.id).toBe(v2);
      expect((await c.query<{ b: boolean }>("SELECT public.rfq_che_do_nghiem($1) AS b", [r])).rows[0]!.b).toBe(false);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect((await withTenant(apiPool, t.org, (k) => getActiveProcurementPolicy(k, t.org)))?.id, "ROLLBACK dựng lại hàm gốc").toBe(t.v1);
  });

  it("MỘT hàm chọn phiên bản: mọi hàm của lược đồ đọc `org_procurement_policies` nằm trong đúng một lớp đã khai, và chỉ `chinh_sach_hieu_luc` xếp theo phiên bản", async () => {
    // CHON: hàm duy nhất trả lời *phiên bản nào đang hiệu lực*. QUA_HAM: đọc phiên bản hiện hành QUA nó.
    // THEO_ID: đọc đúng phiên bản mà một hàng khác đã ghim. KHAC: không chọn phiên bản (đánh số, hỏi tồn tại).
    // Một hàm mới đọc bảng này mà chưa khai ⇒ ĐỎ: câu hỏi là *nó có tự chọn phiên bản không*.
    const KHAI: Readonly<Record<string, "CHON" | "QUA_HAM" | "THEO_ID" | "KHAC">> = {
      // [S1.280 / S3.5a] Bốn hàm của award theo bậc đọc ĐÚNG phiên bản ngân sách ghim (`rfq_budgets.policy_id`): bậc cao hơn (phần tử
      // bậc và tiền tệ), vị từ bậc (tiền tệ), vị từ người ký (tác giả phiên bản), tập loại trừ (tác giả phiên bản) — không tự chọn.
      award_bac_cao_hon: "THEO_ID",
      award_chot_bac: "THEO_ID",
      award_chot_nguoi_ky: "THEO_ID",
      award_tap_loai_tru: "THEO_ID",
      bafo_kiem_vong: "THEO_ID",
      chinh_sach_hieu_luc: "CHON",
      chinh_sach_kiem_nguoi_ky: "THEO_ID",
      chinh_sach_phien_ban_tang_dan: "KHAC",
      kiem_thanh_phan_theo_chinh_sach: "THEO_ID",
      ngan_sach_khong_ghim_ban_chua_ky: "THEO_ID",
      // [S1.166 / S3.1b] Hàm phân bậc và trigger đặt bậc: cả hai đọc ĐÚNG phiên bản ngân sách ghim.
      ngan_sach_xep_bac: "THEO_ID",
      // [S1.196 / S3.3a] Hạn hiệu lực của xác minh nhà cung cấp đọc phiên bản chính sách hiện hành QUA hàm chọn.
      ncc_kiem_xac_minh: "QUA_HAM",
      // [S1.235 / S4.4a] Tiền tệ của gói trong lịch sử giá: phiên bản ngân sách ghim (theo id), không có ngân sách thì phiên bản hiệu
      // lực lúc gói ra đời QUA hàm chọn — không tự xếp phiên bản.
      quan_sat_gia: "QUA_HAM",
      rfq_bac_cua: "THEO_ID",
      // [S1.269 / S3.3c2] Bậc mà gói ghim và số nhóm nhà cung cấp đếm được (tác giả phiên bản) đọc ĐÚNG phiên bản ngân sách ghim.
      rfq_bac_ghim: "THEO_ID",
      // [S1.270 / S3.3d] Vế *đếm được* (tác giả phiên bản) dời sang `rfq_loi_moi_dem_duoc`; `rfq_dem_ncc_canh_tranh` thôi đọc bảng.
      rfq_loi_moi_dem_duoc: "THEO_ID",
      rfq_can_phe_duyet_kep: "THEO_ID",
      rfq_che_do_nghiem: "QUA_HAM",
      rfq_key_material_bat_bien: "QUA_HAM",
      rfq_khoa_du_dieu_kien_xoa: "QUA_HAM",
      // [S1.203 / S3.6b1] Hàm tín hiệu đọc cửa sổ và bậc của ĐÚNG phiên bản ngân sách gói ghim; luật người ghi nhận đọc tác giả của
      // phiên bản mà bằng chứng mang.
      tin_hieu_chia_nho: "THEO_ID",
      tin_hieu_chot_nguoi_ghi_nhan: "THEO_ID",
      to_chuc_da_bat_s3: "KHAC",
    };
    const { rows } = await db.pool.query<{ ten: string; src: string }>(
      "SELECT p.proname AS ten, p.prosrc AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
        " WHERE n.nspname = 'public' AND p.prosrc ~ 'org_procurement_policies'",
    );
    // Sắp ở JS, không bằng ORDER BY: thứ tự của `_` so với chữ cái theo collation của cụm là khác nhau.
    expect(rows.map((r) => r.ten).sort()).toEqual(Object.keys(KHAI).sort());
    const XEP_THEO_PHIEN_BAN = /order\s+by\s+[\w.]*version/iu;
    for (const r of rows) {
      if (KHAI[r.ten] === "QUA_HAM") expect(r.src, r.ten).toMatch(/public\.chinh_sach_hieu_luc\(/u);
      if (KHAI[r.ten] === "CHON") expect(r.src, `đối chứng: bộ bắt thấy ${r.ten}`).toMatch(XEP_THEO_PHIEN_BAN);
      else expect(r.src, r.ten).not.toMatch(XEP_THEO_PHIEN_BAN);
    }
  });
});

// =============================================================================================
// (5) GHIM NGÂN SÁCH — `ngan_sach_khong_ghim_ban_chua_ky`
// =============================================================================================
describe("S3.1a — ngân sách không ghim được phiên bản có bậc CHƯA KÝ", () => {
  const CAU_NGAN_SACH =
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
    "VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)";

  it("INSERT hay UPDATE ghim bản chưa ký bị chặn; bản không bậc và bản đã ký thì ghim được", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    const r = await taoGoi(t);
    const chen = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_NGAN_SACH, [t.org, r, v2, t.pm.u, t.pm.s])));
    expect(chen?.message).toMatch(/Ngan sach khong duoc ghim mot phien ban chinh sach co bac CHUA KY/u);
    expect(chen?.where).toMatch(/function ngan_sach_khong_ghim_ban_chua_ky\(/u);
    expect(await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_NGAN_SACH, [t.org, r, t.v1, t.pm.u, t.pm.s])))).toBeNull();
    const CAU_DOI = "UPDATE rfq_budgets SET policy_id = $2 WHERE rfq_id = $1";
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_DOI, [r, v2]))))?.message).toMatch(/CHUA KY/u);
    await ky(t, v2, t.tc);
    expect(await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_DOI, [r, v2])))).toBeNull();
  });

  it("ĐỘT BIẾN: tắt `rfq_budgets_khong_ghim_ban_chua_ky` thì ngân sách ghim được bản chưa ký", async () => {
    const t = await taoToChuc();
    const v2 = await chenPhienBan(t, { tiers: BAC_CHUAN });
    const r = await taoGoi(t);
    expect(await khiTatTrigger("rfq_budgets", "rfq_budgets_khong_ghim_ban_chua_ky", t.org, CAU_NGAN_SACH, [t.org, r, v2, t.pm.u, t.pm.s])).toBeNull();
    expect(await trangThaiTrigger("rfq_budgets_khong_ghim_ban_chua_ky")).toBe("A");
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_NGAN_SACH, [t.org, r, v2, t.pm.u, t.pm.s]))))?.message).toMatch(/CHUA KY/u);
  });
});

// =============================================================================================
// (6) [S1.166 / S3.1b] K1 — BẬC CỦA GÓI VÀ CẠNH NỘP DUYỆT (`072_bac_cua_goi`)
// =============================================================================================
/** Bảng bậc mặc định của spec §4.1 — biên 100 triệu, 1 tỷ, 10 tỷ; bậc cuối là đấu thầu chính thức. */
const BAC_MAC_DINH: readonly Bac[] = [
  bacThuong(0),
  bacThuong(100_000_000),
  bacThuong(1_000_000_000),
  bacChinhThuc(10_000_000_000),
];

/** Tổ chức ĐÃ BẬT: phiên bản 2 có bậc, PM tạo, FINANCE ký. */
async function toChucDaBat(bac: readonly Bac[] = BAC_MAC_DINH): Promise<{ readonly t: ToChuc; readonly v2: string }> {
  const t = await taoToChuc();
  const v2 = await chenPhienBan(t, { tiers: bac });
  await ky(t, v2, t.tc);
  return { t, v2 };
}

async function datNganSach(t: ToChuc, rfqId: string, giaTri: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) =>
    setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s }),
  );
}

const CAU_BAC_DA_LUU = "SELECT tier_tu_so_tien::text AS b FROM rfq_budgets WHERE rfq_id = $1";

async function bacDaLuu(t: ToChuc, rfqId: string): Promise<string | null> {
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: string | null }>(CAU_BAC_DA_LUU, [rfqId]));
  return rows[0]?.b ?? null;
}

/** Nộp duyệt qua ĐƯỜNG SẢN XUẤT — `null` khi đi qua, còn không thì chính lỗi. */
async function nop(t: ToChuc, rfqId: string): Promise<unknown> {
  return withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool)).then(
    () => null,
    (e: unknown) => e,
  );
}

async function trangThaiGoi(rfqId: string): Promise<{ readonly status: string; readonly submittedAt: Date | null }> {
  const { rows } = await db.pool.query<{ status: string; submitted_at: Date | null }>(
    "SELECT status, submitted_at FROM rfq_packages WHERE id = $1",
    [rfqId],
  );
  return { status: rows[0]!.status, submittedAt: rows[0]!.submitted_at };
}

/** Hàng `CONTROL_DENIED` của một gói: mã trong payload và người. `resource_id`, không đọc payload để tìm gói. */
async function hangChot(org: string, rfqId: string): Promise<{ ma: string; actor: string }[]> {
  const { rows } = await db.pool.query<{ ma: string; actor: string }>(
    "SELECT payload->>'ma' AS ma, actor_id::text AS actor FROM audit_events " +
      "WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows;
}

/** Câu nộp duyệt VIẾT TAY dưới `app_api` — đi vòng tầng gói, chỉ trigger ở cạnh còn canh. */
const CAU_NOP_TAY =
  "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1";

const HAM_CHOT = "public.rfq_chot_ngan_sach(uuid, uuid, timestamptz)";
const HAM_CANH = "public.rfq_kiem_ngan_sach_khi_nop()";

/** Định nghĩa của một hàm sau MỘT phép thay chuỗi trên `pg_get_functiondef` — chuỗi phải khớp đúng một chỗ. */
async function defDotBien(ham: string, cu: string, moi: string): Promise<string> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  return goc.replace(cu, moi);
}

/**
 * ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: chủ sở hữu chạy `dotBien`, rồi `viec` chạy dưới `app_api`
 * trong tổ chức trên CÙNG kết nối — nên đi được trọn đường sản xuất, `submitRfqForApproval(c, …)`.
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

/** Như `defDotBien` nhưng COMMIT — để một kết nối KHÁC thấy thân đột biến — rồi trả lại thân gốc. */
async function voiHamDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  await db.pool.query(await defDotBien(ham, cu, moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
  }
}

describe("S3.1b — K1: bậc của gói (`rfq_bac_cua`, `tier_tu_so_tien`)", () => {
  // [spec §5.1 K1] Đo bằng HẰNG SỐ, không bằng so với chính `rfq_bac_cua`: phép so ấy trùng ngôn, và
  // đột biến `<=` → `<` ở biên sống sót qua nó (ca đột biến dưới đo đúng điều đó).
  const CA_BIEN: readonly (readonly [string, string])[] = [
    ["0.00", "0.00"],
    ["0.01", "0.00"],
    ["99999999.99", "0.00"],
    ["100000000.00", "100000000.00"],
    ["100000000.01", "100000000.00"],
    ["999999999.99", "100000000.00"],
    ["1000000000.00", "1000000000.00"],
    ["9999999999.99", "1000000000.00"],
    ["10000000000.00", "10000000000.00"],
    ["9999999999999999.99", "10000000000.00"],
  ];

  it("[INV-K1] BẢNG CA BIÊN HẰNG SỐ: bậc lưu trên ngân sách đúng ở mọi biên — đo qua `setRfqBudget`, cả lần chèn lẫn lần sửa", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    const sai: string[] = [];
    for (const [giaTri, bac] of CA_BIEN) {
      await datNganSach(t, rfqId, giaTri);
      if ((await bacDaLuu(t, rfqId)) !== bac) sai.push(giaTri);
    }
    expect(sai).toEqual([]);
    // Tổ chức CHƯA bật: ngân sách ghim phiên bản không bậc, nên không có bậc nào — MVP1 giữ nguyên.
    const h = await taoToChuc();
    const r2 = await taoGoi(h);
    await datNganSach(h, r2, "150000000.00");
    expect(await bacDaLuu(h, r2)).toBeNull();
  });

  it("ĐỘT BIẾN: `<=` → `<` trong `rfq_bac_cua` thì ba ca ĐÚNG BIÊN rơi xuống bậc dưới và ca 0 hết bậc — bảng hằng số bắt được, phép so với chính hàm thì không", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    const hong = await defDotBien("public.rfq_bac_cua(uuid, numeric, text)", "::numeric <= p_gia_tri", "::numeric < p_gia_tri");
    const { sai, trungNgon } = await trongDotBien(t.org, [hong], async (c) => {
      const ra: string[] = [];
      let soVoiHam = true;
      for (const [giaTri, bac] of CA_BIEN) {
        await c.query("SAVEPOINT ca");
        try {
          await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
          const { rows } = await c.query<{ b: string; k: boolean }>(
            "SELECT tier_tu_so_tien::text AS b, tier_tu_so_tien = public.rfq_bac_cua(policy_id, estimated_value, currency) AS k " +
              "FROM rfq_budgets WHERE rfq_id = $1",
            [rfqId],
          );
          if (rows[0]!.b !== bac) ra.push(giaTri);
          soVoiHam &&= rows[0]!.k;
          await c.query("RELEASE SAVEPOINT ca");
        } catch {
          await c.query("ROLLBACK TO SAVEPOINT ca");
          ra.push(`${giaTri} ném`);
        }
      }
      return { sai: ra, trungNgon: soVoiHam };
    });
    expect(sai).toEqual(["0.00 ném", "100000000.00", "1000000000.00", "10000000000.00"]);
    expect(trungNgon, "so bậc đã lưu với CHÍNH hàm phân bậc vẫn xanh dưới đột biến — vì sao K1 đo bằng hằng số").toBe(true);
  });

  it("[INV-K1] bậc chỉ do CSDL đặt: `app_api` không ghi được `tier_tu_so_tien` (42501), chủ sở hữu ghi tay thì trigger ghi đè; tiền tệ lệch chính sách thì không phân bậc", async () => {
    const { t, v2 } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    const chen =
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id, tier_tu_so_tien) " +
      "VALUES ($1, $2, '150000000.00', 'VND', $3, $4, $5, 0)";
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query(chen, [t.org, rfqId, v2, t.pm.u, t.pm.s]))))?.code).toBe("42501");
    await datNganSach(t, rfqId, "150000000.00");
    expect(
      (await loi(withTenant(apiPool, t.org, (c) => c.query("UPDATE rfq_budgets SET tier_tu_so_tien = 0 WHERE rfq_id = $1", [rfqId]))))?.code,
    ).toBe("42501");
    await db.pool.query("UPDATE rfq_budgets SET tier_tu_so_tien = 0 WHERE rfq_id = $1", [rfqId]);
    expect(await bacDaLuu(t, rfqId), "chủ sở hữu ghi tay: `rfq_budgets_xep_bac` ghi đè bằng bậc thật").toBe("100000000.00");

    const r2 = await taoGoi(t);
    const lech = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
            "VALUES ($1, $2, '150000000.00', 'USD', $3, $4, $5)",
          [t.org, r2, v2, t.pm.u, t.pm.s],
        ),
      ),
    );
    expect(lech?.message).toMatch(/Don vi tien te cua uoc luong \(USD\) khac cua chinh sach \(VND\)/u);
    expect(lech?.where).toMatch(/function rfq_bac_cua\(/u);
  });

  it("[INV-K1] ĐỘT BIẾN: tắt `rfq_budgets_xep_bac` thì bậc KHÔNG được đặt và cạnh nộp duyệt chặn `BAC_LECH_HAM_PHAN_BAC`; bỏ thêm vế bậc khỏi `rfq_chot_ngan_sach` thì gói bậc NULL rời DRAFT", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được
    const veBac =
      "  IF ns.tier_tu_so_tien IS DISTINCT FROM public.rfq_bac_cua(ns.policy_id, ns.estimated_value, ns.currency) THEN\n" +
      "    RETURN 'BAC_LECH_HAM_PHAN_BAC';\n  END IF;\n";
    const kichBan = (them: readonly string[]): Promise<{ bac: string | null; kq: unknown }> =>
      trongDotBien(t.org, ["ALTER TABLE public.rfq_budgets DISABLE TRIGGER rfq_budgets_xep_bac", ...them], async (c) => {
        await setRfqBudget(c, t.org, { rfqId, estimatedValue: "150000000.00", currency: "VND", actorSessionId: t.pm.s });
        const bac = (await c.query<{ b: string | null }>(CAU_BAC_DA_LUU, [rfqId])).rows[0]!.b;
        const kq = await submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool).then(
          (r) => r.status,
          (e: unknown) => e,
        );
        return { bac, kq };
      });
    const tat = await kichBan([]);
    expect(tat.bac).toBeNull();
    expect(tat.kq).toMatchObject({ name: "ChotKiemSoatError", lyDo: "BAC_LECH_HAM_PHAN_BAC" });
    const tatVaBo = await kichBan([await defDotBien(HAM_CHOT, veBac, "")]);
    expect(tatVaBo.bac).toBeNull();
    expect(tatVaBo.kq).toBe("PENDING_APPROVAL");
    expect(await trangThaiTrigger("rfq_budgets_xep_bac")).toBe("A");
    expect(await hangChot(t.org, rfqId), "`BAC_LECH_HAM_PHAN_BAC` KHÔNG vào sổ").toEqual([]);
  });
});

describe("S3.1b — K1: cạnh DRAFT→PENDING_APPROVAL và lớp từ chối `CONTROL_DENIED`", () => {
  it("[INV-K1] tổ chức ĐÃ BẬT: gói không ngân sách không rời DRAFT — lời từ chối CÓ TÊN và ĐÚNG MỘT hàng `CONTROL_DENIED` mang mã và người; tổ chức chưa bật thì đi như MVP1", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được: gói chỉ thiếu ngân sách
    const e = await nop(t, rfqId);
    expect(e).toBeInstanceOf(ChotKiemSoatError);
    expect(e).toMatchObject({ lyDo: "THIEU_NGAN_SACH", message: CHOT_VAO_SO.THIEU_NGAN_SACH.thongDiep });
    expect(await hangChot(t.org, rfqId)).toEqual([{ ma: "THIEU_NGAN_SACH", actor: t.pm.u }]);
    expect((await trangThaiGoi(rfqId)).status).toBe("DRAFT");
    // ĐỐI CHỨNG DƯƠNG: đặt ngân sách thì cùng lời gọi đi qua, và đường thuận không ghi thêm hàng nào.
    await datNganSach(t, rfqId, "150000000.00");
    expect(await nop(t, rfqId)).toBeNull();
    expect((await trangThaiGoi(rfqId)).status).toBe("PENDING_APPROVAL");
    expect(await hangChot(t.org, rfqId)).toHaveLength(1);

    // Tổ chức CHƯA bật: ước lượng tuỳ chọn (ADR-085 ⑵) — gói không ngân sách nộp được, sổ không có gì.
    const h = await taoToChuc();
    const r2 = await taoGoi(h);
    expect(await nop(h, r2)).toBeNull();
    expect(await hangChot(h.org, r2)).toEqual([]);
  });

  it("[INV-K1] lớp CSDL: câu nộp VIẾT TAY dưới `app_api` bị trigger ở cạnh chặn với cùng mã; tắt trigger thì gói không ngân sách rời DRAFT", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được: gói chỉ thiếu ngân sách
    const e = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_NOP_TAY, [rfqId, t.pm.u, t.pm.s])));
    expect(e?.message).toMatch(/Goi thau chua roi DRAFT duoc \(K1\): THIEU_NGAN_SACH/u);
    expect(e?.where).toMatch(/function rfq_kiem_ngan_sach_khi_nop\(/u);
    expect(await khiTatTrigger("rfq_packages", "rfq_packages_kiem_ngan_sach_khi_nop", t.org, CAU_NOP_TAY, [rfqId, t.pm.u, t.pm.s])).toBeNull();
    expect(await trangThaiTrigger("rfq_packages_kiem_ngan_sach_khi_nop")).toBe("A");
    expect((await trangThaiGoi(rfqId)).status).toBe("DRAFT");
  });

  it("[INV-K1] nộp duyệt đòi ngân sách ghim ĐÚNG phiên bản hiệu lực: ghim bản cũ ⇒ từ chối CÓ TÊN, KHÔNG vào sổ; đặt lại ngân sách thì đi, với bậc của bản mới — kể cả gói có từ trước ngày bật", async () => {
    // ⑴ Gói có từ trước ngày bật: ngân sách ghim v1 không bậc.
    const t = await taoToChuc();
    const rfqId = await taoGoi(t);
    await datNganSach(t, rfqId, "150000000.00");
    expect(await bacDaLuu(t, rfqId)).toBeNull();
    const v2 = await chenPhienBan(t, { tiers: BAC_MAC_DINH });
    await ky(t, v2, t.tc);
    // [S1.266 / S3.3c1] Lời mời đếm được thêm SAU lần bật — xác minh K8a chỉ có ở tổ chức đã bật.
    await moiNccDemDuoc(t, rfqId);
    expect(await nop(t, rfqId)).toMatchObject({ name: "ChotKiemSoatError", lyDo: "NGAN_SACH_GHIM_BAN_CU" });
    await datNganSach(t, rfqId, "150000000.00");
    expect(await bacDaLuu(t, rfqId)).toBe("100000000.00");
    expect(await nop(t, rfqId)).toBeNull();

    // ⑵ Chính sách đổi SAU khi đặt ngân sách: v3 hạ biên bậc 1 xuống 50 triệu, nên gói 60 triệu lên bậc.
    const r2 = await taoGoi(t);
    await moiNccDemDuoc(t, r2); // [S1.266 / S3.3c1]
    await datNganSach(t, r2, "60000000.00");
    expect(await bacDaLuu(t, r2)).toBe("0.00");
    const v3 = await chenPhienBan(t, {
      tiers: [bacThuong(0), bacThuong(50_000_000), bacThuong(1_000_000_000), bacChinhThuc(10_000_000_000)],
    });
    await ky(t, v3, t.tc);
    expect(await nop(t, r2)).toMatchObject({ lyDo: "NGAN_SACH_GHIM_BAN_CU" });
    await datNganSach(t, r2, "60000000.00");
    expect(await bacDaLuu(t, r2)).toBe("50000000.00");
    expect(await nop(t, r2)).toBeNull();
    expect([...(await hangChot(t.org, rfqId)), ...(await hangChot(t.org, r2))], "`NGAN_SACH_GHIM_BAN_CU` KHÔNG vào sổ").toEqual([]);
  });

  it("ĐỘT BIẾN: bỏ vế *ghim đúng phiên bản hiệu lực* khỏi `rfq_chot_ngan_sach` thì gói ghim bản ĐÃ HẾT hiệu lực rời DRAFT — ở cả tầng gói lẫn trigger, vì hai lớp hỏi cùng một hàm", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được
    await datNganSach(t, rfqId, "150000000.00");
    const v3 = await chenPhienBan(t, { tiers: BAC_MAC_DINH });
    await ky(t, v3, t.tc);
    const veGhim =
      "  IF ns.policy_id IS DISTINCT FROM public.chinh_sach_hieu_luc(p_org, p_luc) THEN\n" +
      "    RETURN 'NGAN_SACH_GHIM_BAN_CU';\n  END IF;\n";
    const hong = await defDotBien(HAM_CHOT, veGhim, "");
    const kq = await trongDotBien(t.org, [hong], (c) =>
      submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool).then(
        (r) => r.status,
        (e: unknown) => e,
      ),
    );
    expect(kq).toBe("PENDING_APPROVAL");
    // Ngoài đột biến, cùng gói bị chặn — ca trên xanh vì ĐỘT BIẾN, không vì một lý do khác.
    expect(await nop(t, rfqId)).toMatchObject({ lyDo: "NGAN_SACH_GHIM_BAN_CU" });
  });

  it("ĐỘT BIẾN: cho qua khi thiếu ngân sách thì gói không ngân sách rời DRAFT; quên rẽ nhánh theo hàm *đã bật* thì tổ chức CHƯA bật không nộp được gói không ngân sách (§8.11)", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được: gói chỉ thiếu ngân sách
    const choQua = await defDotBien(HAM_CHOT, "    RETURN 'THIEU_NGAN_SACH';", "    RETURN NULL;");
    expect(
      await trongDotBien(t.org, [choQua], (c) =>
        submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool).then((r) => r.status),
      ),
    ).toBe("PENDING_APPROVAL");

    const h = await taoToChuc();
    const r2 = await taoGoi(h);
    const quenReNhanh = await defDotBien(HAM_CHOT, "  IF NOT public.to_chuc_da_bat_s3(p_org) THEN\n    RETURN NULL;\n  END IF;\n", "");
    expect(
      await trongDotBien(h.org, [quenReNhanh], (c) =>
        submitRfqForApproval(c, h.org, { rfqId: r2, actorSessionId: h.pm.s }, apiPool).then(
          (r) => r.status,
          (e: unknown) => e,
        ),
      ),
    ).toMatchObject({ lyDo: "THIEU_NGAN_SACH" });
    expect(await nop(h, r2), "ngoài đột biến: tổ chức chưa bật nộp được").toBeNull();
  });

  it("chốt chỉ nói về gói ĐANG Ở DRAFT: gói đã rời DRAFT hay không có thật ⇒ lỗi trạng thái như cũ, KHÔNG hàng sổ nào; bỏ vế DRAFT thì sổ nhận một hàng cho một cạnh không đi được", async () => {
    const t = await taoToChuc();
    const rfqId = await taoGoi(t);
    expect(await nop(t, rfqId)).toBeNull();
    // [S1.236 / khoản 261] Lần bật bị từ chối khi tổ chức còn gói chờ duyệt: gói rời DRAFT theo đường MVP1 rồi HUỶ, trước lần ký.
    await withTenant(apiPool, t.org, (c) =>
      cancelRfq(c, t.org, { rfqId, reason: "roi DRAFT truoc lan bat", actorSessionId: t.pm.s }, apiPool),
    );
    const v2 = await chenPhienBan(t, { tiers: BAC_MAC_DINH });
    await ky(t, v2, t.tc);
    const khongCo = randomUUID();
    for (const r of [rfqId, khongCo]) {
      expect(await nop(t, r)).toMatchObject({ name: "RfqError" });
      expect(await hangChot(t.org, r)).toEqual([]);
    }
    const veDraft =
      "  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r\n" +
      "                  WHERE r.org_id = p_org AND r.id = p_rfq AND r.status = 'DRAFT') THEN\n" +
      "    RETURN NULL;\n  END IF;\n";
    const kq = await trongDotBien(t.org, [await defDotBien(HAM_CHOT, veDraft, "")], (c) =>
      submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool).then(
        (r) => r.status,
        (e: unknown) => e,
      ),
    );
    expect(kq).toMatchObject({ lyDo: "THIEU_NGAN_SACH" });
    expect(await hangChot(t.org, rfqId)).toEqual([{ ma: "THIEU_NGAN_SACH", actor: t.pm.u }]);
  });

  it("[INV-K1] ĐỘT BIẾN — chặn lần ghi `CONTROL_DENIED` thì lời từ chối GÃY ỒN ÀO (`DenialAuditFailedError`), không im lặng đi qua", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được: gói chỉ thiếu ngân sách
    let e: unknown;
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k1_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k1 thong diep noi bo' USING ERRCODE = 'TPK01'; END$$",
      );
      await db.pool.query(
        "CREATE TRIGGER k1_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW " +
          "WHEN (NEW.action = 'CONTROL_DENIED') EXECUTE FUNCTION public.k1_chan_ghi_so()",
      );
      e = await nop(t, rfqId);
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k1_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k1_chan_ghi_so()");
    }
    expect((e as Error).name, "lần ghi sổ hỏng phải đổi HÌNH DẠNG lỗi, không được nuốt").toBe("DenialAuditFailedError");
    expect((e as { denial?: { lyDo?: string } }).denial?.lyDo).toBe("THIEU_NGAN_SACH");
    expect(await hangChot(t.org, rfqId)).toEqual([]);
    // ĐỐI CHỨNG: gỡ trigger thì cùng lời gọi ghi được.
    expect(await nop(t, rfqId)).toMatchObject({ lyDo: "THIEU_NGAN_SACH" });
    expect(await hangChot(t.org, rfqId)).toHaveLength(1);
  });

  it("mã của `rfq_chot_ngan_sach` BẰNG tập mã K1 của `CHOT_VAO_SO` — hàm SQL và bảng không trôi khỏi nhau", async () => {
    const src = (await db.pool.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = $1::regprocedure", [HAM_CHOT])).rows[0]!.s;
    const trongHam = [...src.matchAll(/RETURN '([A-Z_]+)'/gu)].map((m) => m[1]!).sort();
    const trongBang = Object.entries(CHOT_VAO_SO)
      .filter(([, d]) => d.chot === "K1")
      .map(([ma]) => ma)
      .sort();
    expect(trongHam.length, "bộ đọc không thấy mã nào — đang mù").toBeGreaterThan(0);
    expect(trongHam).toEqual(trongBang);
  });
});

describe("S3.1b — K1 dưới tranh chấp: khoá chia sẻ và mốc giờ", () => {
  it("[INV-K1] mốc nộp do CSDL đóng: `submitted_at` nằm giữa hai lần đọc đồng hồ quanh lần nộp, ở cả tổ chức chưa bật; `app_api` không ghi được nó (42501)", async () => {
    const { t } = await toChucDaBat();
    const rfqId = await taoGoi(t);
    await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được
    await datNganSach(t, rfqId, "150000000.00");
    const h = await taoToChuc();
    const r2 = await taoGoi(h);
    const dongHo = async (): Promise<number> =>
      (await db.pool.query<{ l: Date }>("SELECT clock_timestamp() AS l")).rows[0]!.l.getTime();
    const truoc = await dongHo();
    expect(await nop(t, rfqId)).toBeNull();
    expect(await nop(h, r2)).toBeNull();
    const sau = await dongHo();
    for (const r of [rfqId, r2]) {
      const moc = (await trangThaiGoi(r)).submittedAt?.getTime() ?? Number.NaN;
      expect(moc, r).toBeGreaterThanOrEqual(truoc);
      expect(moc, r).toBeLessThanOrEqual(sau);
    }
    const r3 = await taoGoi(h);
    expect(
      (await loi(withTenant(apiPool, h.org, (c) => c.query("UPDATE rfq_packages SET submitted_at = now() WHERE id = $1", [r3]))))?.code,
    ).toBe("42501");
  });

  it("[INV-K1] ĐUA: lần nộp ĐỨNG CHỜ một lần ký đang dở rồi đọc trạng thái SAU nó — ghim bản vừa hết hiệu lực thì bị chặn; gỡ khoá chia sẻ thì gói rời DRAFT với bản đã hết hiệu lực", async () => {
    const khoa =
      "  PERFORM pg_catalog.pg_advisory_xact_lock_shared(\n" +
      "            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));\n";
    const kichBan = async (coKhoa: boolean) => {
      const { t, v2 } = await toChucDaBat();
      const rfqId = await taoGoi(t);
      // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được: chân gỡ khoá đi qua K2 trên ảnh chụp ghim v2; chân có khoá bị K1 chặn sau
      // lần chờ (trigger K2 xếp SAU K1, không lời từ chối nào đứng trước lần chờ ấy).
      await moiNccDemDuoc(t, rfqId);
      await datNganSach(t, rfqId, "150000000.00");
      const v3 = await chenPhienBan(t, { tiers: BAC_MAC_DINH });
      const ky3 = await moGiaoDich(t.org);
      const nopTay = await moGiaoDich(t.org);
      try {
        await ky3.query(CAU_KY, [t.org, v3, t.tc.u, t.tc.s]); // giữ khoá ĐỘC QUYỀN, chưa commit
        const pid = await pidCua(nopTay);
        const ketQua = loi(nopTay.query(CAU_NOP_TAY, [rfqId, t.pm.u, t.pm.s]));
        // Có khoá: lần nộp ĐỨNG CHỜ lần ký — đo ở `pg_stat_activity`, không đoán bằng giờ.
        // Không khoá: nó không chờ ai, và đi qua trên ảnh chụp chưa thấy chữ ký.
        if (coKhoa) await choKhoaTuVan(pid);
        else expect(await ketQua).toBeNull();
        await ky3.query("COMMIT");
        const loiNop = await ketQua;
        await nopTay.query(loiNop === null ? "COMMIT" : "ROLLBACK");
        const { rows } = await db.pool.query<{ status: string; ghim: string; tai_lap: string | null }>(
          "SELECT r.status, b.policy_id AS ghim, public.chinh_sach_hieu_luc(r.org_id, r.submitted_at) AS tai_lap " +
            "FROM rfq_packages r JOIN rfq_budgets b ON b.rfq_id = r.id WHERE r.id = $1",
          [rfqId],
        );
        return { loiNop, ...rows[0]!, v2, v3 };
      } finally {
        ky3.release();
        nopTay.release();
      }
    };
    const dung = await kichBan(true);
    expect(dung.loiNop?.message).toMatch(/\(K1\): NGAN_SACH_GHIM_BAN_CU/u);
    expect(dung.status).toBe("DRAFT");

    const hong = await voiHamDotBien(HAM_CANH, khoa, "", () => kichBan(false));
    expect(hong.loiNop).toBeNull();
    expect(hong.status).toBe("PENDING_APPROVAL");
    expect(hong.ghim).toBe(hong.v2);
    expect(hong.tai_lap, "tái lập *phiên bản hiệu lực lúc nộp* ra bản MỚI — gói rời DRAFT với bản đã hết hiệu lực").toBe(hong.v3);
  });

  it("[INV-K1] `signed_at` đóng dấu SAU khoá: lần ký BẮT ĐẦU trước một lần nộp mà lấy khoá sau nó thì mang mốc SAU `submitted_at` — tái lập ra đúng bản đã ghim; trả thân `069` thì tái lập ra bản khác", async () => {
    const kichBan = async () => {
      const { t, v2 } = await toChucDaBat();
      const rfqId = await taoGoi(t);
      await moiNccDemDuoc(t, rfqId); // [S1.266 / S3.3c1] K2 có nhà cung cấp đếm được
      await datNganSach(t, rfqId, "150000000.00");
      const v3 = await chenPhienBan(t, { tiers: BAC_MAC_DINH });
      const ky3 = await moGiaoDich(t.org); // giao dịch ký BẮT ĐẦU ở đây: `now()` của nó đứng ở mốc này
      try {
        expect(await nop(t, rfqId)).toBeNull(); // nộp trọn và commit khi lần ký chưa lấy khoá
        await ky3.query(CAU_KY, [t.org, v3, t.tc.u, t.tc.s]);
        await ky3.query("COMMIT");
      } finally {
        ky3.release();
      }
      const { rows } = await db.pool.query<{ ghim: string; tai_lap: string; ky_sau_nop: boolean }>(
        "SELECT b.policy_id AS ghim, public.chinh_sach_hieu_luc(r.org_id, r.submitted_at) AS tai_lap, " +
          "       (SELECT s.signed_at > r.submitted_at FROM org_policy_signatures s WHERE s.policy_id = $2) AS ky_sau_nop " +
          "  FROM rfq_packages r JOIN rfq_budgets b ON b.rfq_id = r.id WHERE r.id = $1",
        [rfqId, v3],
      );
      return { ...rows[0]!, v2, v3 };
    };
    const dung = await kichBan();
    expect(dung.ghim).toBe(dung.v2);
    expect(dung.ky_sau_nop).toBe(true);
    expect(dung.tai_lap, "tái lập ra đúng bản đã ghim").toBe(dung.v2);

    const hong = await voiHamDotBien("public.chinh_sach_kiem_nguoi_ky()", "  NEW.signed_at := pg_catalog.clock_timestamp();\n", "", kichBan);
    expect(hong.ky_sau_nop, "`signed_at` là `now()` — giờ ĐẦU giao dịch ký, trước lần nộp").toBe(false);
    expect(hong.tai_lap, "K1 đúng lúc chạy mà sai khi tái lập").toBe(hong.v3);
  });
});

describe("S3.1b — hardening ghim chuỗi K1", () => {
  it("thân rỗng ruột ở hai trigger, bốn hàm trợ giúp và hàm ký, cộng trigger ở cạnh bị tắt — lần `migrate()` sau trả lại tất cả", async () => {
    const HAM = [
      HAM_CHOT,
      HAM_CANH,
      "public.rfq_bac_cua(uuid, numeric, text)",
      "public.to_chuc_da_bat_s3(uuid)",
      "public.chinh_sach_hieu_luc(uuid, timestamptz)",
      "public.ngan_sach_xep_bac()",
      "public.chinh_sach_kiem_nguoi_ky()",
    ];
    const than = async (): Promise<Record<string, string>> =>
      Object.fromEntries(
        (
          await db.pool.query<{ ten: string; src: string }>(
            "SELECT p.oid::regprocedure::text AS ten, p.prosrc AS src FROM pg_proc p WHERE p.oid = ANY ($1::regprocedure[])",
            [HAM],
          )
        ).rows.map((r) => [r.ten, r.src]),
      );
    const truoc = await than();
    expect(Object.keys(truoc)).toHaveLength(HAM.length);
    const trigger = "LANGUAGE plpgsql SET search_path = pg_catalog, public AS $x$BEGIN RETURN NEW; END$x$";
    for (const cau of [
      "CREATE OR REPLACE FUNCTION public.rfq_chot_ngan_sach(p_org uuid, p_rfq uuid, p_luc timestamptz) RETURNS text " +
        "LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $x$BEGIN RETURN NULL; END$x$",
      "CREATE OR REPLACE FUNCTION public.rfq_bac_cua(p_policy uuid, p_gia_tri numeric, p_tien_te text) RETURNS numeric " +
        "LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $x$BEGIN RETURN 0; END$x$",
      "CREATE OR REPLACE FUNCTION public.to_chuc_da_bat_s3(p_org uuid) RETURNS boolean " +
        "LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $x$ SELECT false $x$",
      "CREATE OR REPLACE FUNCTION public.chinh_sach_hieu_luc(p_org uuid, p_luc timestamptz) RETURNS uuid " +
        "LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $x$ SELECT NULL::uuid $x$",
      `CREATE OR REPLACE FUNCTION public.ngan_sach_xep_bac() RETURNS trigger ${trigger}`,
      `CREATE OR REPLACE FUNCTION public.rfq_kiem_ngan_sach_khi_nop() RETURNS trigger ${trigger}`,
      `CREATE OR REPLACE FUNCTION public.chinh_sach_kiem_nguoi_ky() RETURNS trigger ${trigger}`,
      "ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_ngan_sach_khi_nop",
    ]) {
      await db.pool.query(cau);
    }
    for (const [ten, src] of Object.entries(await than())) expect(src, `tiền đề: ${ten} đã bị thay`).not.toBe(truoc[ten]);
    await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    expect(await than()).toEqual(truoc);
    expect(await trangThaiTrigger("rfq_packages_kiem_ngan_sach_khi_nop")).toBe("A");
  });
});
