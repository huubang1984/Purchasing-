import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, cancelRfq, createRfq, datNhomHangChoGoi, submitRfqForApproval } from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";
import { doiTrangThaiNhomHang, lietKeNhomHang, taoNhomHang } from "./nhom-hang.js";
import { CAU_CHOT_NHOM_HANG, CHOT_VAO_SO, ChotKiemSoatError } from "./chot-kiem-soat.js";

// =============================================================================================
// [S1.201 / S3.6a] NHÓM HÀNG — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `085_nhom_hang`. Chủ dự án chốt ngày 2026-09-29: nhóm hàng bắt buộc để rời DRAFT ở tổ chức đã bật ngay S3.6a;
// lần từ chối `THIEU_NHOM_HANG` vào sổ; nhóm hàng chỉ tạo, ngừng dùng và dùng lại.
//
// Mỗi lớp có một phép đo HÀNH VI và một ĐỘT BIẾN: tắt (hay viết lại) đúng lớp ấy thì chính câu vừa bị chặn đi lọt. Không nhãn
// INV: K10 vào sổ đăng ký ở S3.6b, cùng tín hiệu nó canh; ở đây nhóm hàng chỉ là tiền đề của K10 (spec §4.3).
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG: công tắc ADR-080 một chiều.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

/** Bảng bậc tối thiểu có hiệu lực: một bậc thường từ 0 và bậc đấu thầu chính thức từ 10 tỷ. */
const BAC = JSON.stringify([
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
]);

let db: TestDatabase;
let apiPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo và nộp gói. Không giữ `category.manage`. */
  readonly pm: Nguoi;
  /** FINANCE — giữ `category.manage` và `policy.manage`. */
  readonly tc: Nguoi;
  /** FINANCE thứ hai — người ký phiên bản có bậc (khác người khai). */
  readonly tc2: Nguoi;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `nhom-${randomBytes(4).toString("hex")}`,
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
  const tc = await nguoi("FINANCE");
  const tc2 = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  return { org, pm, tc, tc2 };
}

/** Phiên bản 2 — có bậc hay không, có cửa sổ chia nhỏ hay không — do `pm` khai. */
async function chenPhienBan2(t: ToChuc, coBac: boolean, cuaSo: number | null): Promise<string> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, chia_nho_cua_so_ngay, " +
        "tham_dinh_hieu_luc_thang, created_by, created_by_session_id) VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, $3, $4, $5, $6) " +
        "RETURNING id",
      [t.org, coBac ? BAC : null, cuaSo, cuaSo === null ? null : 12, t.pm.u, t.pm.s],
    ),
  );
  return rows[0]!.id;
}

/** Tổ chức ĐÃ BẬT: phiên bản 2 có bậc, `pm` khai, `tc2` ký. */
async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  const v2 = await chenPhienBan2(t, true, 30);
  await withTenant(apiPool, t.org, (c) =>
    c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
      t.org,
      v2,
      t.tc2.u,
      t.tc2.s,
    ]),
  );
  return t;
}

async function taoNhom(t: ToChuc, ma: string, ai: Nguoi = t.tc): Promise<string> {
  return (await withTenant(apiPool, t.org, (c) => taoNhomHang(c, t.org, { ma, ten: `Nhom ${ma}`, actorSessionId: ai.s }, apiPool))).id;
}

async function doiTrangThai(t: ToChuc, categoryId: string, conDung: boolean, ai: Nguoi = t.tc): Promise<unknown> {
  return withTenant(apiPool, t.org, (c) => doiTrangThaiNhomHang(c, t.org, { categoryId, conDung, actorSessionId: ai.s }, apiPool));
}

/**
 * [S1.266 / S3.3c1] Một lời mời tới một nhà cung cấp ĐẾM ĐƯỢC cho chốt K2 (S3.3c2) — chỉ ở tổ chức ĐÃ BẬT. Hồ sơ do người
 * nhập riêng của helper dựng, `tc` (FINANCE, không khai phiên bản — người khai là `pm`) xác minh; câu chèn là câu của
 * `createInvitation`, người mời `pm`. Tệp này đo nhóm hàng: không có lời mời này thì gói thiếu nhà cung cấp và K2 — đứng SAU nhóm
 * hàng ở cả tầng gói lẫn thứ tự trigger — từ chối mọi ca nộp lẽ ra đi qua.
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

/**
 * Gói đủ điều kiện K1 — ngân sách ghim phiên bản hiệu lực, một hạng mục — với nhóm hàng tuỳ chọn. [S1.266 / S3.3c1] Ở tổ chức
 * đã bật, thêm đúng một lời mời đếm được (`moiNccDemDuoc`): gói chỉ còn thiếu thứ mà ca đang đo. Tổ chức chưa bật lúc dựng gói
 * (đối chứng MVP1, hai ca ĐUA và *rời DRAFT trước lần bật*) giữ gói không lời mời như cũ.
 */
async function goiSanSang(t: ToChuc, categoryId: string | null = null): Promise<string> {
  const rfqId = await withTenant(apiPool, t.org, async (c) => {
    const rfq = await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId });
    await setRfqBudget(c, t.org, { rfqId: rfq.id, estimatedValue: "50000000.00", currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId: rfq.id, lineNo: 1, description: "Thep tam SS400", quantity: "10.0000", unit: "tam", actorSessionId: t.pm.s });
    return rfq.id;
  });
  const daBat = (await db.pool.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org])).rows[0]?.b === true;
  if (daBat) await moiNccDemDuoc(t, rfqId);
  return rfqId;
}

/** Nộp duyệt qua ĐƯỜNG SẢN XUẤT — `null` khi đi qua, còn không thì chính lỗi. */
async function nop(t: ToChuc, rfqId: string): Promise<unknown> {
  return withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool)).then(
    () => null,
    (e: unknown) => e,
  );
}

async function loi(p: Promise<unknown>): Promise<{ code: string; constraint: string; message: string; name: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string; constraint?: string };
    return { code: x.code ?? "", constraint: x.constraint ?? "", message: x.message, name: x.name };
  }
}

async function trangThaiGoi(rfqId: string): Promise<{ status: string; category: string | null }> {
  const { rows } = await db.pool.query<{ status: string; category_id: string | null }>(
    "SELECT status, category_id FROM rfq_packages WHERE id = $1",
    [rfqId],
  );
  return { status: rows[0]!.status, category: rows[0]!.category_id };
}

async function hangChot(org: string, rfqId: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ ma: string }>(
    "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows.map((r) => r.ma);
}

async function hangSo(org: string, action: string): Promise<{ resource: string | null; payload: unknown }[]> {
  const { rows } = await db.pool.query<{ resource_id: string | null; payload: unknown }>(
    "SELECT resource_id::text, payload FROM audit_events WHERE org_id = $1 AND action = $2 ORDER BY seq",
    [org, action],
  );
  return rows.map((r) => ({ resource: r.resource_id, payload: r.payload }));
}

/** Câu viết tay dưới `app_api` trong tổ chức — đi vòng tầng gói, chỉ trigger còn canh. */
async function tayDuoiApi(org: string, sql: string, thamSo: readonly unknown[]): Promise<pg.QueryResult> {
  return withTenant(apiPool, org, (c) => c.query(sql, [...thamSo]));
}

const CAU_NOP_TAY =
  "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1";

/**
 * ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: chủ sở hữu chạy `dotBien`, rồi `viec` chạy dưới `app_api` trong tổ chức trên CÙNG
 * kết nối — nên đi được trọn đường sản xuất. Lược đồ không đổi sau đó.
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

/** Định nghĩa của một hàm sau MỘT phép thay chuỗi — chuỗi phải khớp đúng một chỗ. */
async function defDotBien(ham: string, cu: string, moi: string): Promise<string> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  return goc.replace(cu, moi);
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

/** Chờ tới khi backend `pid` ĐỨNG CHỜ một khoá tư vấn — mốc để biết câu của nó đang bị chặn, không phải chưa chạy. */
async function choKhoaTuVan(pid: number): Promise<boolean> {
  for (let lan = 0; lan < 250; lan += 1) {
    const { rows } = await db.pool.query<{ cho: boolean }>(
      "SELECT (wait_event_type = 'Lock' AND wait_event = 'advisory') AS cho FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (rows[0]?.cho === true) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/** Một giao dịch mở dưới `app_api` trong tổ chức, cùng pid của nó — để đo hai giao dịch chen nhau. */
async function moGiaoDich(org: string): Promise<{ c: pg.PoolClient; pid: number }> {
  const c = await apiPool.connect();
  await c.query("BEGIN");
  await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
  return { c, pid: (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid };
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await apiPool?.end();
  await db?.stop();
});

// =============================================================================================
// (1) DANH SÁCH NHÓM HÀNG VÀ NGƯỜI QUẢN LÝ NÓ
// =============================================================================================
describe("S3.6a — nhóm hàng: ai tạo, mã, chỉ ghi thêm", () => {
  it("FINANCE tạo được: mã viết hoa, nhóm mới là còn dùng, lần tạo vào sổ; danh sách chỉ thấy nhóm của CHÍNH tổ chức", async () => {
    const t = await taoToChuc();
    const h = await taoToChuc();
    const nhom = await withTenant(apiPool, t.org, (c) =>
      taoNhomHang(c, t.org, { ma: "  thep-01 ", ten: " Thep xay dung ", actorSessionId: t.tc.s }, apiPool),
    );
    expect(nhom).toMatchObject({ ma: "THEP-01", ten: "Thep xay dung", conDung: true });
    await taoNhom(h, "THEP-01");
    const ds = await withTenant(apiPool, t.org, (c) => lietKeNhomHang(c, t.org));
    expect(ds.map((n) => [n.id, n.ma, n.conDung])).toEqual([[nhom.id, "THEP-01", true]]);
    expect(await hangSo(t.org, "CATEGORY_CREATED")).toEqual([{ resource: nhom.id, payload: { ma: "THEP-01" } }]);
  });

  it("người không giữ `category.manage` (PROCUREMENT_MANAGER) bị từ chối ở tầng gói — `PERMISSION_DENIED` vào sổ, không hàng nào", async () => {
    const t = await taoToChuc();
    const e = await loi(taoNhom(t, "VPP", t.pm));
    expect(e?.name).toBe("PermissionDeniedError");
    expect((await hangSo(t.org, "PERMISSION_DENIED")).length).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM procurement_categories WHERE org_id = $1", [t.org])).rowCount).toBe(0);
  });

  it("câu INSERT viết tay của người không giữ `category.manage` bị TRIGGER chặn — lớp chặn cuối; ĐỘT BIẾN tắt trigger ⇒ đi lọt", async () => {
    const t = await taoToChuc();
    const cau =
      "INSERT INTO procurement_categories (org_id, ma, ten, created_by, created_by_session_id) VALUES ($1, 'TAY', 'Nhom tay', $2, $3)";
    const e = await loi(tayDuoiApi(t.org, cau, [t.org, t.pm.u, t.pm.s]));
    expect(e?.code).toBe("23514");
    expect(e?.message).toContain("category.manage");
    const dotBien = await trongDotBien(t.org, ["ALTER TABLE procurement_categories DISABLE TRIGGER procurement_categories_kiem_nguoi"], (c) =>
      c.query(cau, [t.org, t.pm.u, t.pm.s]).then((r) => r.rowCount),
    );
    expect(dotBien, "tắt trigger luật người ⇒ người tạo gói dựng được nhóm hàng").toBe(1);
  });

  it("mã sai hình dạng và mã trùng trong tổ chức là lời từ chối CÓ TÊN; cùng mã ở tổ chức khác thì được", async () => {
    const t = await taoToChuc();
    const h = await taoToChuc();
    expect(await loi(taoNhom(t, "-THEP"))).toMatchObject({ name: "RfqError" });
    expect(await loi(taoNhom(t, "THÉP"))).toMatchObject({ name: "RfqError" });
    expect(await loi(taoNhom(t, "A".repeat(33)))).toMatchObject({ name: "RfqError" });
    await taoNhom(t, "VPP");
    expect(await loi(taoNhom(t, "vpp"))).toMatchObject({ name: "RfqError", message: "Mã nhóm hàng này đã có trong tổ chức." });
    await expect(taoNhom(h, "VPP")).resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("chỉ ghi thêm: `app_api` không UPDATE/DELETE được hai bảng (42501); chủ sở hữu thì trigger chặn (23514)", async () => {
    const t = await taoToChuc();
    const nhom = await taoNhom(t, "IT");
    await doiTrangThai(t, nhom, false);
    for (const cau of [
      "UPDATE procurement_categories SET ten = 'Doi ten' WHERE id = $1",
      "DELETE FROM procurement_categories WHERE id = $1",
      "UPDATE procurement_category_changes SET loai = 'REACTIVATED' WHERE category_id = $1",
      "DELETE FROM procurement_category_changes WHERE category_id = $1",
    ]) {
      expect((await loi(tayDuoiApi(t.org, cau, [nhom])))?.code, cau).toBe("42501");
      expect((await loi(db.pool.query(cau, [nhom])))?.code, `chủ sở hữu: ${cau}`).toBe("23514");
    }
  });
});

// =============================================================================================
// (2) NGỪNG DÙNG VÀ DÙNG LẠI
// =============================================================================================
describe("S3.6a — trạng thái nhóm hàng: một hàng đổi mới mỗi lần, đúng chiều, dưới khoá", () => {
  it("ngừng dùng ⇒ còn dùng = false; ngừng lần nữa ⇒ lời có tên; dùng lại ⇒ true; dùng lại lần nữa ⇒ lời có tên; thứ tự 1, 2", async () => {
    const t = await taoToChuc();
    const nhom = await taoNhom(t, "THEP");
    expect(await doiTrangThai(t, nhom, false)).toMatchObject({ id: nhom, conDung: false });
    expect(await loi(doiTrangThai(t, nhom, false))).toMatchObject({ name: "RfqError", message: "Nhóm hàng này đã ngừng dùng rồi." });
    expect(await doiTrangThai(t, nhom, true)).toMatchObject({ id: nhom, conDung: true });
    expect(await loi(doiTrangThai(t, nhom, true))).toMatchObject({
      name: "RfqError",
      message: "Nhóm hàng này đang dùng — không có gì để dùng lại.",
    });
    const { rows } = await db.pool.query<{ loai: string; thu_tu: string }>(
      "SELECT loai, thu_tu::text FROM procurement_category_changes WHERE category_id = $1 ORDER BY thu_tu",
      [nhom],
    );
    expect(rows).toEqual([
      { loai: "RETIRED", thu_tu: "1" },
      { loai: "REACTIVATED", thu_tu: "2" },
    ]);
    expect((await hangSo(t.org, "CATEGORY_RETIRED")).map((h) => h.resource)).toEqual([nhom]);
    expect((await hangSo(t.org, "CATEGORY_REACTIVATED")).map((h) => h.resource)).toEqual([nhom]);
  });

  it("người không giữ `category.manage`: tầng gói từ chối; câu viết tay bị trigger chặn — ĐỘT BIẾN thân `RETURN NEW` ⇒ đi lọt", async () => {
    const t = await taoToChuc();
    const nhom = await taoNhom(t, "THEP");
    expect((await loi(doiTrangThai(t, nhom, false, t.pm)))?.name).toBe("PermissionDeniedError");
    const cau =
      "INSERT INTO procurement_category_changes (org_id, category_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'RETIRED', $3, $4)";
    expect((await loi(tayDuoiApi(t.org, cau, [t.org, nhom, t.pm.u, t.pm.s])))?.message).toContain("category.manage");
    const rong = await defDotBien(
      "public.nhom_hang_kiem_doi()",
      "DECLARE\n  loai_cuoi text;\nBEGIN",
      "DECLARE\n  loai_cuoi text;\nBEGIN\n  NEW.thu_tu := 1;\n  RETURN NEW;",
    );
    expect(await trongDotBien(t.org, [rong], (c) => c.query(cau, [t.org, nhom, t.pm.u, t.pm.s]).then((r) => r.rowCount))).toBe(1);
  });

  it("một lần GÁN nhóm cho gói đang chờ khoá thì lần NGỪNG DÙNG chen vào phải chờ nó — rồi lần gán kế tiếp bị chặn", async () => {
    const t = await taoToChuc();
    const nhom = await taoNhom(t, "THEP");
    const rfqId = await withTenant(apiPool, t.org, async (c) =>
      (await createRfq(c, t.org, { title: "Goi dua", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s })).id,
    );
    const gan = await moGiaoDich(t.org);
    const ngung = await moGiaoDich(t.org);
    try {
      await gan.c.query("UPDATE rfq_packages SET category_id = $2 WHERE id = $1", [rfqId, nhom]);
      const cho = ngung.c.query(
        "INSERT INTO procurement_category_changes (org_id, category_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'RETIRED', $3, $4)",
        [t.org, nhom, t.tc.u, t.tc.s],
      );
      expect(await choKhoaTuVan(ngung.pid), "lần ngừng dùng phải ĐỨNG CHỜ khoá tư vấn của lần gán").toBe(true);
      await gan.c.query("COMMIT");
      await cho;
      await ngung.c.query("COMMIT");
    } finally {
      gan.c.release();
      ngung.c.release();
    }
    expect((await trangThaiGoi(rfqId)).category).toBe(nhom);
    const e = await loi(
      withTenant(apiPool, t.org, async (c) =>
        createRfq(c, t.org, { title: "Goi sau", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId: nhom }),
      ),
    );
    expect(e).toMatchObject({ name: "RfqError", message: "Nhóm hàng này đã ngừng dùng — chọn một nhóm hàng khác." });
  });
});

// =============================================================================================
// (3) NHÓM HÀNG CỦA GÓI
// =============================================================================================
describe("S3.6a — nhóm hàng của gói: chỉ nhóm còn dùng của chính tổ chức, chỉ đổi ở DRAFT", () => {
  it("tạo gói kèm nhóm, rồi đổi nhóm ở DRAFT — bản ghi mang `categoryId`, hai lần vào sổ", async () => {
    const t = await taoToChuc();
    const a = await taoNhom(t, "A");
    const b = await taoNhom(t, "B");
    const rfq = await withTenant(apiPool, t.org, (c) =>
      createRfq(c, t.org, { title: "Goi co nhom", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId: a }),
    );
    expect(rfq.categoryId).toBe(a);
    const doi = await withTenant(apiPool, t.org, (c) => datNhomHangChoGoi(c, t.org, { rfqId: rfq.id, categoryId: b, actorSessionId: t.pm.s }));
    expect(doi.categoryId).toBe(b);
    expect((await hangSo(t.org, "RFQ_CREATED")).at(-1)?.payload).toEqual({ requiresDualApproval: true, categoryId: a });
    expect(await hangSo(t.org, "RFQ_CATEGORY_SET")).toEqual([{ resource: rfq.id, payload: { categoryId: b } }]);
  });

  it("nhóm đã ngừng dùng và nhóm của tổ chức khác không gán được — cả lúc tạo lẫn lúc đổi — lời có tên, gói không đổi", async () => {
    const t = await taoToChuc();
    const h = await taoToChuc();
    const nhom = await taoNhom(t, "A");
    const khac = await taoNhom(h, "A");
    await doiTrangThai(t, nhom, false);
    const tao = (categoryId: string): Promise<unknown> =>
      withTenant(apiPool, t.org, (c) => createRfq(c, t.org, { title: "Goi", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId }));
    expect(await loi(tao(nhom))).toMatchObject({ name: "RfqError", message: "Nhóm hàng này đã ngừng dùng — chọn một nhóm hàng khác." });
    expect(await loi(tao(khac))).toMatchObject({ name: "RfqError", message: "Không tìm thấy nhóm hàng trong tổ chức đang gắn." });
    const rfqId = await goiSanSang(t);
    const dat = (categoryId: string): Promise<unknown> =>
      withTenant(apiPool, t.org, (c) => datNhomHangChoGoi(c, t.org, { rfqId, categoryId, actorSessionId: t.pm.s }));
    expect(await loi(dat(nhom))).toMatchObject({ name: "RfqError" });
    expect(await loi(dat(khac))).toMatchObject({ name: "RfqError", message: "Không tìm thấy nhóm hàng trong tổ chức đang gắn." });
    expect((await trangThaiGoi(rfqId)).category).toBeNull();
    // ĐỘT BIẾN: thân `nhom_hang_con_dung` trả hằng `true` ⇒ nhóm đã ngừng dùng gán được.
    const hang = await defDotBien(
      "public.nhom_hang_con_dung(uuid, uuid)",
      "SELECT coalesce((",
      "SELECT true OR coalesce((",
    );
    expect(await trongDotBien(t.org, [hang], (c) => c.query("UPDATE rfq_packages SET category_id = $2 WHERE id = $1", [rfqId, nhom]).then((r) => r.rowCount))).toBe(1);
  });

  it("gói đã rời DRAFT: tầng gói từ chối trạng thái; câu viết tay bị trigger chặn (`nhom_hang_chi_doi_o_draft`) — ĐỘT BIẾN tắt trigger ⇒ đổi được", async () => {
    const t = await taoToChuc();
    const a = await taoNhom(t, "A");
    const b = await taoNhom(t, "B");
    const rfqId = await goiSanSang(t, a);
    expect(await nop(t, rfqId)).toBeNull();
    expect(
      await loi(withTenant(apiPool, t.org, (c) => datNhomHangChoGoi(c, t.org, { rfqId, categoryId: b, actorSessionId: t.pm.s }))),
    ).toMatchObject({ name: "RfqError" });
    const cau = "UPDATE rfq_packages SET category_id = $2 WHERE id = $1";
    expect(await loi(tayDuoiApi(t.org, cau, [rfqId, b]))).toMatchObject({ code: "23514", constraint: "nhom_hang_chi_doi_o_draft" });
    expect((await trangThaiGoi(rfqId)).category).toBe(a);
    const dotBien = await trongDotBien(t.org, ["ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_nhom_hang"], (c) =>
      c.query(cau, [rfqId, b]).then((r) => r.rowCount),
    );
    expect(dotBien, "tắt trigger ⇒ nhóm hàng đổi được sau khi nộp duyệt — lối né tín hiệu chia nhỏ").toBe(1);
  });
});

// =============================================================================================
// (4) CHỐT `THIEU_NHOM_HANG` Ở CẠNH DRAFT→PENDING_APPROVAL
// =============================================================================================
describe("S3.6a — chốt nhóm hàng: tổ chức đã bật không nộp duyệt gói không nhóm hàng", () => {
  it("tổ chức đã bật, gói đủ K1 mà không nhóm hàng ⇒ `THIEU_NHOM_HANG` có tên, đúng MỘT hàng `CONTROL_DENIED`, gói ở DRAFT", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiSanSang(t);
    const e = await nop(t, rfqId);
    expect(e).toBeInstanceOf(ChotKiemSoatError);
    expect((e as ChotKiemSoatError).lyDo).toBe("THIEU_NHOM_HANG");
    expect((e as Error).message).toBe(CHOT_VAO_SO.THIEU_NHOM_HANG.thongDiep);
    expect(await hangChot(t.org, rfqId)).toEqual(["THIEU_NHOM_HANG"]);
    expect((await trangThaiGoi(rfqId)).status).toBe("DRAFT");
  });

  it("gán nhóm hàng rồi nộp lại ⇒ đi qua; nhóm ngừng dùng SAU khi gán không chặn lần nộp (chỉ chặn lần gán mới)", async () => {
    const t = await toChucDaBat();
    const nhom = await taoNhom(t, "THEP");
    const rfqId = await goiSanSang(t);
    await withTenant(apiPool, t.org, (c) => datNhomHangChoGoi(c, t.org, { rfqId, categoryId: nhom, actorSessionId: t.pm.s }));
    await doiTrangThai(t, nhom, false);
    expect(await nop(t, rfqId)).toBeNull();
    expect(await trangThaiGoi(rfqId)).toEqual({ status: "PENDING_APPROVAL", category: nhom });
    expect(await hangChot(t.org, rfqId)).toEqual([]);
  });

  it("gói rời DRAFT TRƯỚC lần bật, không nhóm hàng; sau lần bật gọi nộp lại ⇒ lời từ chối TRẠNG THÁI, không hàng `CONTROL_DENIED` — chốt chỉ hỏi gói ở DRAFT", async () => {
    const t = await taoToChuc();
    const rfqId = await goiSanSang(t);
    expect(await nop(t, rfqId)).toBeNull();
    // [S1.236 / khoản 261] Lần bật bị từ chối khi tổ chức còn gói chờ duyệt: gói rời DRAFT theo đường MVP1 rồi HUỶ, trước lần ký.
    await withTenant(apiPool, t.org, (c) =>
      cancelRfq(c, t.org, { rfqId, reason: "roi DRAFT truoc lan bat", actorSessionId: t.pm.s }, apiPool),
    );
    const v2 = await chenPhienBan2(t, true, 30);
    await withTenant(apiPool, t.org, (c) =>
      c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
        t.org,
        v2,
        t.tc2.u,
        t.tc2.s,
      ]),
    );
    expect(await nop(t, rfqId)).toMatchObject({ name: "RfqError" });
    expect(await hangChot(t.org, rfqId)).toEqual([]);
    expect(await trangThaiGoi(rfqId)).toEqual({ status: "CANCELLED", category: null });
  });

  it("gói thiếu CẢ ngân sách lẫn nhóm hàng ⇒ lời từ chối về ngân sách trước (K1 đứng trước)", async () => {
    const t = await toChucDaBat();
    const rfqId = await withTenant(apiPool, t.org, async (c) =>
      (await createRfq(c, t.org, { title: "Goi trong", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s })).id,
    );
    // [S1.266 / S3.3c1] Một lời mời đếm được: gói thiếu ĐÚNG hai thứ ca này đo — ngân sách và nhóm hàng —, không thiếu nhà cung cấp.
    await moiNccDemDuoc(t, rfqId);
    expect((await nop(t, rfqId)) as ChotKiemSoatError).toMatchObject({ lyDo: "THIEU_NGAN_SACH" });
  });

  it("ĐUA: lần ký BẬT tổ chức đang dở khi một gói không nhóm hàng nộp duyệt — lần nộp đứng chờ khoá của K1, rồi K1 chặn nó; gỡ khoá K1 thì gói rời DRAFT không nhóm hàng — trigger nhóm hàng không giữ khoá riêng", async () => {
    const khoaK1 =
      "  PERFORM pg_catalog.pg_advisory_xact_lock_shared(\n" +
      "            pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));\n";
    const kichBan = async (coKhoa: boolean) => {
      const t = await taoToChuc();
      const rfqId = await goiSanSang(t); // chưa bật: ngân sách ghim bản 1, không nhóm hàng
      // [S1.266 / S3.3c1] Không lời mời (xác minh K8a chỉ có ở tổ chức đã bật), và K2 không chạm ca này: trigger K2 xếp SAU K1 —
      // chân có khoá bị K1 chặn sau lần chờ; chân gỡ khoá nộp trên ảnh chụp CHƯA bật, nơi trigger K2 trả NEW.
      const v2 = await chenPhienBan2(t, true, 30);
      const ky = await moGiaoDich(t.org);
      const nopTay = await moGiaoDich(t.org);
      try {
        // Lần ký bật tổ chức, giữ khoá ĐỘC QUYỀN theo tổ chức, chưa commit.
        await ky.c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
          t.org,
          v2,
          t.tc2.u,
          t.tc2.s,
        ]);
        const ketQua = loi(nopTay.c.query(CAU_NOP_TAY, [rfqId, t.pm.u, t.pm.s]));
        if (coKhoa) expect(await choKhoaTuVan(nopTay.pid), "lần nộp phải ĐỨNG CHỜ lần ký").toBe(true);
        else expect(await ketQua, "không khoá: lần nộp không chờ ai, đi qua trên ảnh chụp CHƯA bật").toBeNull();
        await ky.c.query("COMMIT");
        const loiNop = await ketQua;
        await nopTay.c.query(loiNop === null ? "COMMIT" : "ROLLBACK");
        return { loiNop, ...(await trangThaiGoi(rfqId)) };
      } finally {
        ky.c.release();
        nopTay.c.release();
      }
    };
    const dung = await kichBan(true);
    expect(dung.loiNop?.message).toMatch(/\(K1\): NGAN_SACH_GHIM_BAN_CU/u);
    expect(dung.status).toBe("DRAFT");

    const hong = await voiHamDotBien("public.rfq_kiem_ngan_sach_khi_nop()", khoaK1, "", () => kichBan(false));
    expect(hong, "tổ chức đã bật mà gói rời DRAFT không nhóm hàng").toEqual({ loiNop: null, status: "PENDING_APPROVAL", category: null });
  });

  it("ĐỐI CHỨNG MVP1: tổ chức chưa bật nộp gói không nhóm hàng — đi qua, không hàng sổ nào", async () => {
    const t = await taoToChuc();
    const rfqId = await goiSanSang(t);
    expect(await nop(t, rfqId)).toBeNull();
    expect(await hangChot(t.org, rfqId)).toEqual([]);
  });

  it("[§8.11] tổ chức chưa bật có phiên bản KHÔNG bậc khai `chia_nho_cua_so_ngay` (`069` cho phép) — vẫn không bị đòi nhóm hàng", async () => {
    const t = await taoToChuc();
    await chenPhienBan2(t, false, 30);
    const rfqId = await goiSanSang(t);
    expect(await nop(t, rfqId)).toBeNull();
    expect(await hangChot(t.org, rfqId)).toEqual([]);
  });

  it("câu nộp duyệt VIẾT TAY bị trigger ở cạnh chặn — kể cả câu vừa nộp vừa XOÁ nhóm hàng; ĐỘT BIẾN tắt trigger ⇒ đi lọt", async () => {
    const t = await toChucDaBat();
    const nhom = await taoNhom(t, "THEP");
    const khong = await goiSanSang(t);
    const e = await loi(tayDuoiApi(t.org, CAU_NOP_TAY, [khong, t.pm.u, t.pm.s]));
    expect(e?.code).toBe("23514");
    expect(e?.message).toContain("THIEU_NHOM_HANG");
    // Hàm vị từ nhận GIÁ TRỊ MỚI của cột: một câu vừa nộp vừa xoá nhóm hàng không đi lọt nhờ hàng cũ trong bảng.
    const co = await goiSanSang(t, nhom);
    const xoa = await loi(
      tayDuoiApi(
        t.org,
        "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3, category_id = NULL WHERE id = $1",
        [co, t.pm.u, t.pm.s],
      ),
    );
    expect(xoa?.message).toContain("THIEU_NHOM_HANG");
    expect(await trangThaiGoi(co)).toEqual({ status: "DRAFT", category: nhom });
    const dotBien = await trongDotBien(t.org, ["ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_nhom_hang_khi_nop"], (c) =>
      c.query(CAU_NOP_TAY, [khong, t.pm.u, t.pm.s]).then((r) => r.rowCount),
    );
    expect(dotBien, "tắt trigger ở cạnh ⇒ gói không nhóm hàng rời DRAFT qua một câu viết tay").toBe(1);
  });

  it("ĐỘT BIẾN hàm vị từ trả NULL ⇒ đường sản xuất đi qua không nhóm hàng và không hàng sổ nào — tầng gói và trigger cùng hỏi MỘT hàm", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiSanSang(t);
    const rong = await defDotBien("public.rfq_chot_nhom_hang(uuid, uuid)", "RETURN 'THIEU_NHOM_HANG';", "RETURN NULL;");
    const ketQua = await trongDotBien(t.org, [rong], (c) =>
      submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool).then(
        (r) => r.status,
        (e: unknown) => e,
      ),
    );
    expect(ketQua).toBe("PENDING_APPROVAL");
  });

  it("mã của `rfq_chot_nhom_hang` đều có dòng K10 ở `CHOT_VAO_SO`, và `THIEU_NHOM_HANG` vào sổ", async () => {
    const src = (
      await db.pool.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = 'public.rfq_chot_nhom_hang(uuid, uuid)'::regprocedure")
    ).rows[0]!.s;
    const trongHam = [...src.matchAll(/RETURN '([A-Z_]+)'/gu)].map((m) => m[1]!);
    expect(trongHam).toEqual(["THIEU_NHOM_HANG"]);
    for (const ma of trongHam) {
      expect(CHOT_VAO_SO[ma as keyof typeof CHOT_VAO_SO]?.chot, ma).toBe("K10");
    }
    expect(CHOT_VAO_SO.THIEU_NHOM_HANG.vaoSo).toBe(true);
    // Câu hỏi của tầng gói gọi đúng hàm ấy trên hàng DRAFT.
    expect(CAU_CHOT_NHOM_HANG).toContain("public.rfq_chot_nhom_hang(r.org_id, r.category_id)");
    expect(CAU_CHOT_NHOM_HANG).toContain("'DRAFT'");
  });
});

// =============================================================================================
// (5) AI GIỮ `category.manage`
// =============================================================================================
describe("S3.6a — `category.manage` không đứng cùng `rfq.create`", () => {
  it("mọi vai giữ `category.manage` đều giữ `policy.manage` — nên `033` cấm một NGƯỜI giữ nó cùng `rfq.create`; hôm nay đúng FINANCE", async () => {
    const { rows } = await db.pool.query<{ vai: string; policy: boolean; tao: boolean }>(
      "SELECT rp.role_code AS vai, " +
        "EXISTS (SELECT 1 FROM role_permissions q WHERE q.role_code = rp.role_code AND q.permission_code = 'policy.manage') AS policy, " +
        "EXISTS (SELECT 1 FROM role_permissions q WHERE q.role_code = rp.role_code AND q.permission_code = 'rfq.create') AS tao " +
        "FROM role_permissions rp WHERE rp.permission_code = 'category.manage' ORDER BY 1",
    );
    expect(rows).toEqual([{ vai: "FINANCE", policy: true, tao: false }]);
  });
});
