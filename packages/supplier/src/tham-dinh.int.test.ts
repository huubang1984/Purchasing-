import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { CHOT_THEO_RANG_BUOC, CHOT_VAO_SO } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { phienBanPassportTho, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docThamDinhNhaCungCap, thamDinhNhaCungCap, thuHoiThamDinhNhaCungCap } from "./tham-dinh.js";
import { docHoSoXacMinh, thuHoiXacMinhNhaCungCap, xacMinhNhaCungCap } from "./xac-minh.js";

// =============================================================================================
// [S1.293 / S3.7a2 / K8b · ADR-081 ⑵ ⑸ · ADR-164] THẨM ĐỊNH ĐẦY ĐỦ NHÀ CUNG CẤP — PHÉP ĐO TRÊN POSTGRES 16, DƯỚI `app_api`
//
// Mỗi luật một ca, và mỗi ca đọc CSDL chứ không đọc lời của hàm: hàng trong `supplier_qualifications`, hàng sổ, và câu trả lời của
// `ncc_tham_dinh_hien_hanh` — hàm mà K8b ở trao thầu hỏi. Phiên bản Passport dựng bằng `phienBanPassportTho` (năm câu ghi của `118`,
// mọi trigger chạy). Khuôn `xac-minh.int.test.ts` (K8a); đột biến định nghĩa lại hàm lúc chạy, khôi phục tự kiểm sha256.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const BAC = [
  {
    tu_so_tien: 0,
    so_ncc_toi_thieu: 1,
    award_vai_khac_nhau: false,
    ky_danh_sach_moi: false,
    xoay_vong_n: 0,
    award_so_chu_ky: 1,
    award_vai: ["DIRECTOR"],
    tham_dinh_truoc_trao: true,
    khai_xung_dot: false,
    dau_thau_chinh_thuc: false,
  },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];
/** Hạn hiệu lực của phiên bản chính sách dựng ở đây — thẩm định dùng CHUNG cột với xác minh. */
const THANG = 12;

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo hồ sơ nhà cung cấp; giữ `rfq.invite`, không giữ `supplier.qualify`. */
  readonly pm: Nguoi;
  /** FINANCE — ký phiên bản chính sách. */
  readonly tc: Nguoi;
  /** FINANCE thứ hai — người xác minh K8a và người yêu cầu hồ sơ Passport. */
  readonly tc2: Nguoi;
  /** FINANCE thứ ba — người thẩm định. */
  readonly tc3: Nguoi;
}
interface Ncc {
  readonly ncc: string;
  readonly lh: string;
  readonly mst: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function nguoi(org: string, vai: string): Promise<Nguoi> {
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
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`td-${randomBytes(4).toString("hex")}`]);
  const pm = await nguoi(org, "PROCUREMENT_MANAGER");
  const tc = await nguoi(org, "FINANCE");
  const tc2 = await nguoi(org, "FINANCE");
  const tc3 = await nguoi(org, "FINANCE");
  const v = (
    await withTenant(apiPool, org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
          "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
          "VALUES ($1, 1, '100000000.00', 'VND', $2::jsonb, 30, $3, true, now(), $4, $5) RETURNING id",
        [org, JSON.stringify(BAC), THANG, pm.u, pm.s],
      ),
    )
  ).rows[0]!.id;
  await withTenant(apiPool, org, (c) =>
    c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [org, v, tc.u, tc.s]),
  );
  const { rows } = await withTenant(apiPool, org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [org]));
  expect(rows[0]?.b, "dàn cảnh: công tắc S3").toBe(true);
  return { org, pm, tc, tc2, tc3 };
}

/** Hồ sơ nhà cung cấp có MST và một người liên hệ có điện thoại, dựng bởi `ai` (mặc định `pm`); `tc2` xác minh (K8a) trừ khi tắt. */
async function hoSo(t: ToChuc, tuyChon: { readonly ai?: Nguoi; readonly xacMinh?: boolean } = {}): Promise<Ncc> {
  const ai = tuyChon.ai ?? t.pm;
  const mst = `03${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const duoi = randomBytes(6).toString("hex");
  const ncc = await withTenant(apiPool, t.org, async (c) =>
    (await c.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [t.org, `NCC ${duoi.slice(0, 6)}`, mst, ai.u, ai.s],
    )).rows[0]!.id,
  );
  const lh = await withTenant(apiPool, t.org, async (c) =>
    (await c.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi ban hang', $3, $4, $5, $6) RETURNING id",
      [t.org, ncc, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), ai.u, ai.s],
    )).rows[0]!.id,
  );
  if (tuyChon.xacMinh !== false) {
    await withTenant(apiPool, t.org, async (c) => {
      const bamDaXem = (await docHoSoXacMinh(c, t.org)).find((h) => h.supplierId === ncc)?.bamHoSo ?? "";
      await xacMinhNhaCungCap(c, t.org, { supplierId: ncc, actorSessionId: t.tc2.s, bamDaXem }, auditPool);
    });
  }
  return { ncc, lh, mst };
}

/** Một phiên bản Passport MỚI của nhà cung cấp (yêu cầu bởi `tc2`); trả thứ tự. */
async function phienBan(t: ToChuc, n: Ncc, hoSoTho: { readonly taxCode?: string } = {}): Promise<number> {
  return (await phienBanPassportTho(db.pool, t.org, { ncc: n.ncc, lh: n.lh, mst: n.mst, nguoiYeuCau: t.tc2, hoSo: hoSoTho })).thuTu;
}

const thamDinh = (t: ToChuc, ncc: string, thuTu: number, ai: Nguoi) =>
  withTenant(apiPool, t.org, (c) => thamDinhNhaCungCap(c, t.org, { supplierId: ncc, phienBanThuTu: thuTu, actorSessionId: ai.s }, auditPool));
const thuHoi = (t: ToChuc, ncc: string, lyDo: string, ai: Nguoi) =>
  withTenant(apiPool, t.org, (c) => thuHoiThamDinhNhaCungCap(c, t.org, { supplierId: ncc, reason: lyDo, actorSessionId: ai.s }, auditPool));
const doc = (t: ToChuc, ncc: string) => withTenant(apiPool, t.org, (c) => docThamDinhNhaCungCap(c, t.org, ncc));

async function loiCua(p: Promise<unknown>): Promise<{ ten: string; thongDiep: string; ma?: string }> {
  try {
    await p;
  } catch (e) {
    const l = e as { name: string; message: string; lyDo?: string };
    return { ten: l.name, thongDiep: l.message, ...(l.lyDo === undefined ? {} : { ma: l.lyDo }) };
  }
  throw new Error("lời gọi phải ném");
}

async function hienHanh(t: ToChuc, ncc: string): Promise<string | null> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ id: string | null }>("SELECT public.ncc_tham_dinh_hien_hanh($1, $2) AS id", [t.org, ncc]),
  );
  return rows[0]?.id ?? null;
}

async function soHang(ncc: string): Promise<{ loai: string; thu_tu: string }[]> {
  return (await db.pool.query<{ loai: string; thu_tu: string }>(
    "SELECT loai, thu_tu::text FROM supplier_qualifications WHERE supplier_id = $1 ORDER BY thu_tu",
    [ncc],
  )).rows;
}

async function soChot(org: string, ncc: string): Promise<string[]> {
  return (await db.pool.query<{ ma: string }>(
    "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, ncc],
  )).rows.map((r) => r.ma);
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** ĐỘT BIẾN một hàm lúc chạy: thay đúng MỘT chỗ trong `pg_get_functiondef`, chạy `viec`, khôi phục và tự kiểm sha256 — lệch là NÉM. */
async function voiDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  await db.pool.query(goc.replace(cu, moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
    const sau = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
    if (sha(sau) !== sha(goc)) throw new Error(`khôi phục ${ham} lệch bản gốc`);
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("S3.7a2 — K8b: thẩm định đầy đủ trên phiên bản Passport mới nhất", { timeout: 120000 }, () => {
  it("[INV-K8b] FINANCE khác người tạo hồ sơ thẩm định phiên bản mới nhất ⇒ hàng QUALIFIED thứ tự 1, hạn = lúc ghi + tham_dinh_hieu_luc_thang, hiện hành khác NULL, một hàng sổ SUPPLIER_QUALIFIED", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    expect(await doc(t, n.ncc)).toMatchObject({ loai: null, conHieuLuc: false, phienBanThuTu: null, phienBanMoiNhatThuTu: null });
    const thuTu = await phienBan(t, n);
    expect(thuTu).toBe(1);
    const truoc = Date.now();
    const r = await thamDinh(t, n.ncc, 1, t.tc3);
    expect(r).toMatchObject({ supplierId: n.ncc, loai: "QUALIFIED", conHieuLuc: true, boi: t.tc3.u, lyDo: null, phienBanThuTu: 1, phienBanMoiNhatThuTu: 1 });
    const han = r.hetHanAt!.getTime() - truoc;
    expect(han, "hạn ≈ 12 tháng").toBeGreaterThan(360 * 86400_000);
    expect(han).toBeLessThan(370 * 86400_000);
    expect(await hienHanh(t, n.ncc)).not.toBeNull();
    expect(await soHang(n.ncc)).toEqual([{ loai: "QUALIFIED", thu_tu: "1" }]);
    const { rows } = await db.pool.query<{ payload: { thuTu: string; passportVersionId: string } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'SUPPLIER_QUALIFIED' AND resource_id = $2",
      [t.org, n.ncc],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.thuTu).toBe("1");
    expect(Object.keys(rows[0]!.payload).sort(), "sổ không mang trường hồ sơ nào").toEqual(["passportVersionId", "thuTu"]);
    expect(await soChot(t.org, n.ncc)).toEqual([]);
  });

  it("[INV-K8b] người TẠO hồ sơ (FINANCE, không giữ rfq.invite) tự thẩm định ⇒ ChotKiemSoatError K8B_NGUOI_TAO_TU_THAM_DINH, một hàng CONTROL_DENIED, không hàng thẩm định", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t, { ai: t.tc3 });
    await phienBan(t, n);
    expect(await loiCua(thamDinh(t, n.ncc, 1, t.tc3))).toMatchObject({ ten: "ChotKiemSoatError", ma: "K8B_NGUOI_TAO_TU_THAM_DINH" });
    expect(await soChot(t.org, n.ncc)).toEqual(["K8B_NGUOI_TAO_TU_THAM_DINH"]);
    expect(await soHang(n.ncc)).toEqual([]);
    // Đối chứng dương: FINANCE khác đi qua.
    expect((await thamDinh(t, n.ncc, 1, t.tc)).conHieuLuc).toBe(true);
  });

  it("[INV-K8b] người giữ `rfq.invite` (FINANCE kèm một vai mời) ⇒ ChotKiemSoatError K8B_NGUOI_MOI_THAM_DINH và một hàng CONTROL_DENIED", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    await phienBan(t, n);
    // Dựng như `xac-minh.int.test.ts`: TECHNICAL tạm giữ `rfq.invite` (D3/`033` cấm FINANCE cùng BUYER/PM; TECHNICAL không thuộc chuỗi ấy).
    await db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ('TECHNICAL', 'rfq.invite')");
    try {
      await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'TECHNICAL')", [t.org, t.tc3.u]);
      expect(await loiCua(thamDinh(t, n.ncc, 1, t.tc3))).toMatchObject({ ten: "ChotKiemSoatError", ma: "K8B_NGUOI_MOI_THAM_DINH" });
      expect(await soChot(t.org, n.ncc)).toEqual(["K8B_NGUOI_MOI_THAM_DINH"]);
    } finally {
      await db.pool.query("DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2 AND role_code = 'TECHNICAL'", [t.org, t.tc3.u]);
      await db.pool.query("DELETE FROM role_permissions WHERE role_code = 'TECHNICAL' AND permission_code = 'rfq.invite'");
    }
    expect(await soHang(n.ncc)).toEqual([]);
  });

  it("[INV-K8b] thiếu `supplier.qualify` (PM) ⇒ PermissionDeniedError và một hàng PERMISSION_DENIED; không hàng thẩm định", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    await phienBan(t, n);
    expect((await loiCua(thamDinh(t, n.ncc, 1, t.pm))).ten).toBe("PermissionDeniedError");
    const { rows } = await db.pool.query(
      "SELECT 1 FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2 AND resource_id = $3",
      [t.org, t.pm.u, n.ncc],
    );
    expect(rows).toHaveLength(1);
    expect(await soHang(n.ncc)).toEqual([]);
  });

  it("[INV-K8b] ba lời từ chối DỮ LIỆU có tên, KHÔNG vào sổ: chưa có xác minh K8a; phiên bản không phải mới nhất; MST phiên bản lệch MST bản ghi (ADR-081 ⑴)", async () => {
    const t = await taoToChuc();
    // Chưa xác minh: `phienBanPassportTho` không dựng được (trigger yêu cầu đòi K8a) — chèn phiên bản thô khi đã xác minh rồi thu hồi.
    const n = await hoSo(t);
    await phienBan(t, n);
    await withTenant(apiPool, t.org, (c) =>
      thuHoiXacMinhNhaCungCap(c, t.org, { supplierId: n.ncc, reason: "thu hoi de do", actorSessionId: t.tc2.s }, auditPool),
    );
    expect((await loiCua(thamDinh(t, n.ncc, 1, t.tc3))).thongDiep).toMatch(/chưa có xác minh còn hiệu lực/u);
    // Xác minh lại (hàng mới) rồi nộp phiên bản 2: thẩm định phiên bản 1 bị từ chối có tên.
    await withTenant(apiPool, t.org, async (c) => {
      const bamDaXem = (await docHoSoXacMinh(c, t.org)).find((h) => h.supplierId === n.ncc)?.bamHoSo ?? "";
      await xacMinhNhaCungCap(c, t.org, { supplierId: n.ncc, actorSessionId: t.tc2.s, bamDaXem }, auditPool);
    });
    expect(await phienBan(t, n)).toBe(2);
    expect((await loiCua(thamDinh(t, n.ncc, 1, t.tc3))).thongDiep).toMatch(/phiên bản hồ sơ mới hơn/u);
    // Phiên bản 3 mang MST khác bản ghi.
    expect(await phienBan(t, n, { taxCode: "0399999999" })).toBe(3);
    expect((await loiCua(thamDinh(t, n.ncc, 3, t.tc3))).thongDiep).toMatch(/Mã số thuế/u);
    // Thứ tự không có: lời của tầng gói.
    expect((await loiCua(thamDinh(t, n.ncc, 9, t.tc3))).thongDiep).toMatch(/Không tìm thấy phiên bản/u);
    expect(await soChot(t.org, n.ncc)).toEqual([]);
    expect(await soHang(n.ncc)).toEqual([]);
  });

  it("[INV-K8b] phiên bản Passport MỚI ⇒ thẩm định cũ thôi hiệu lực (không hàng nào bị sửa); thẩm định lại phiên bản mới ⇒ hiệu lực; xác minh K8a thu hồi ⇒ thôi hiệu lực; ĐỘT BIẾN bỏ vế mới nhất ⇒ thẩm định cũ vẫn hiện hành", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    await phienBan(t, n);
    await thamDinh(t, n.ncc, 1, t.tc3);
    expect(await hienHanh(t, n.ncc)).not.toBeNull();
    expect(await phienBan(t, n)).toBe(2);
    expect(await doc(t, n.ncc)).toMatchObject({ loai: "QUALIFIED", conHieuLuc: false, phienBanThuTu: 1, phienBanMoiNhatThuTu: 2 });
    expect(await hienHanh(t, n.ncc)).toBeNull();
    expect(await soHang(n.ncc), "không hàng nào bị sửa").toEqual([{ loai: "QUALIFIED", thu_tu: "1" }]);
    await voiDotBien("public.ncc_tham_dinh_hien_hanh(uuid, uuid)", "ORDER BY v.thu_tu DESC", "ORDER BY v.thu_tu ASC", async () => {
      expect(await hienHanh(t, n.ncc), "đột biến: vế *phiên bản mới nhất* tắt ⇒ thẩm định cũ vẫn hiện hành").not.toBeNull();
    });
    expect((await thamDinh(t, n.ncc, 2, t.tc3)).conHieuLuc).toBe(true);
    expect(await soHang(n.ncc)).toEqual([{ loai: "QUALIFIED", thu_tu: "1" }, { loai: "QUALIFIED", thu_tu: "2" }]);
    await withTenant(apiPool, t.org, (c) =>
      thuHoiXacMinhNhaCungCap(c, t.org, { supplierId: n.ncc, reason: "MST sai", actorSessionId: t.tc2.s }, auditPool),
    );
    expect((await doc(t, n.ncc)).conHieuLuc, "thẩm định đứng trên xác minh (ADR-081 ⑵)").toBe(false);
  });

  it("[INV-K8b] HẾT HẠN ⇒ hiện hành NULL — hàng dựng thẳng bằng superuser, trigger quy tắc tắt tạm", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    const { versionId } = await phienBanPassportTho(db.pool, t.org, { ncc: n.ncc, lh: n.lh, mst: n.mst, nguoiYeuCau: t.tc2 });
    await db.pool.query("ALTER TABLE supplier_qualifications DISABLE TRIGGER supplier_qualifications_kiem_tham_dinh");
    try {
      for (const [thuTu, han] of [[1, "now() - interval '1 second'"], [2, "now() + interval '1 day'"]] as const) {
        await db.pool.query(
          `INSERT INTO supplier_qualifications (org_id, supplier_id, loai, passport_version_id, thu_tu, het_han_at, created_by, created_by_session_id)
           VALUES ($1, $2, 'QUALIFIED', $3, $4, ${han}, $5, $6)`,
          [t.org, n.ncc, versionId, thuTu, t.tc3.u, t.tc3.s],
        );
        expect(await hienHanh(t, n.ncc) !== null, `hạn ${han}`).toBe(thuTu === 2);
      }
    } finally {
      await db.pool.query("ALTER TABLE supplier_qualifications ENABLE ALWAYS TRIGGER supplier_qualifications_kiem_tham_dinh");
    }
  });

  it("[INV-K8b] thu hồi: lý do bắt buộc; chưa thẩm định thì không thu hồi được; sau khi thu hồi ⇒ REVOKED, thôi hiệu lực, lý do vào sổ", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    await phienBan(t, n);
    expect((await loiCua(thuHoi(t, n.ncc, "   ", t.tc3))).thongDiep).toMatch(/Cần lý do/u);
    expect((await loiCua(thuHoi(t, n.ncc, "chua co gi", t.tc3))).thongDiep).toMatch(/chua duoc tham dinh/u);
    await thamDinh(t, n.ncc, 1, t.tc3);
    const r = await thuHoi(t, n.ncc, "Giay phep het han", t.tc);
    expect(r).toMatchObject({ loai: "REVOKED", conHieuLuc: false, lyDo: "Giay phep het han", hetHanAt: null, phienBanThuTu: null });
    expect(await soHang(n.ncc)).toEqual([{ loai: "QUALIFIED", thu_tu: "1" }, { loai: "REVOKED", thu_tu: "2" }]);
    const { rows } = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'SUPPLIER_QUALIFICATION_REVOKED' AND resource_id = $2",
      [t.org, n.ncc],
    );
    expect(rows).toEqual([{ payload: { thuTu: "2", reason: "Giay phep het han" } }]);
  });

  it("[INV-K9] cổng K9 thứ tám: người đã khai CÓ xung đột với nhà cung cấp không thẩm định được nó ⇒ K9_XAC_MINH_NCC_XUNG_DOT vào sổ; người khác đi qua", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    await phienBan(t, n);
    // Khai báo CÓ xung đột trỏ nhà cung cấp — cần một gói có lời mời của nó (trigger `coi_kiem_khai_bao`).
    const rfqId = await motId(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) VALUES ($1, 'Goi do K9', now() + interval '30 days', false, $2, $3) RETURNING id",
      [t.org, t.pm.u, t.pm.s],
    );
    await db.pool.query(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6)",
      [t.org, rfqId, n.ncc, n.lh, t.pm.u, t.pm.s],
    );
    await withTenant(apiPool, t.org, (c) =>
      c.query("INSERT INTO coi_declarations (org_id, rfq_id, user_id, session_id, trang_thai, supplier_id) VALUES ($1, $2, $3, $4, 'CO_XUNG_DOT', $5)", [
        t.org, rfqId, t.tc3.u, t.tc3.s, n.ncc,
      ]),
    );
    expect(await loiCua(thamDinh(t, n.ncc, 1, t.tc3))).toMatchObject({ ten: "ChotKiemSoatError", ma: "K9_XAC_MINH_NCC_XUNG_DOT" });
    expect(await soChot(t.org, n.ncc)).toEqual(["K9_XAC_MINH_NCC_XUNG_DOT"]);
    expect((await thamDinh(t, n.ncc, 1, t.tc)).conHieuLuc).toBe(true);
  });

  it("[INV-K8b] hai lần ghi ĐỒNG THỜI trên cùng nhà cung cấp xếp hàng dưới khoá tư vấn hạt giống 7: thứ tự liền nhau, không trùng", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    await phienBan(t, n);
    await Promise.all([thamDinh(t, n.ncc, 1, t.tc3), thamDinh(t, n.ncc, 1, t.tc), thamDinh(t, n.ncc, 1, t.tc3)]);
    expect((await soHang(n.ncc)).map((h) => h.thu_tu)).toEqual(["1", "2", "3"]);
  });

  it("[INV-K8b] chỉ ghi thêm: app_api không UPDATE/DELETE được; superuser bị trigger chặn; phiên Passport không đọc được bảng thẩm định", async () => {
    const t = await taoToChuc();
    const n = await hoSo(t);
    const { passportSessionId } = await phienBanPassportTho(db.pool, t.org, { ncc: n.ncc, lh: n.lh, mst: n.mst, nguoiYeuCau: t.tc2 });
    await thamDinh(t, n.ncc, 1, t.tc3);
    for (const sql of ["UPDATE supplier_qualifications SET ly_do = 'x' WHERE supplier_id = $1", "DELETE FROM supplier_qualifications WHERE supplier_id = $1"]) {
      await expect(withTenant(apiPool, t.org, (c) => c.query(sql, [ncc(n)])), sql).rejects.toMatchObject({ code: "42501" });
      await expect(db.pool.query(sql, [ncc(n)]), `superuser: ${sql}`).rejects.toThrow();
    }
    expect(await soHang(n.ncc)).toHaveLength(1);
    // Policy khách đóng hẳn: kết nối mang GUC phiên Passport (đặt CHÍNH `app.guest_session_id`) thấy 0 hàng.
    const { rows } = await withTenant(apiPool, t.org, async (c) => {
      await c.query("SELECT set_config('app.guest_session_id', $1, true), set_config('app.passport_supplier_id', $2, true)", [passportSessionId, n.ncc]);
      return await c.query("SELECT 1 FROM public.supplier_qualifications WHERE supplier_id = $1", [n.ncc]);
    });
    expect(rows).toHaveLength(0);
  });

  it("[INV-K8b] K12: ba tên k8b_* của trigger thẩm định ở CHOT_THEO_RANG_BUOC; tập mã K8b trong thân trigger và hai hàm vị từ = các dòng `chot: K8b` của CHOT_VAO_SO", async () => {
    const { rows } = await db.pool.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE oid IN ('public.ncc_kiem_tham_dinh()'::regprocedure, 'public.award_chot_tham_dinh(uuid, uuid, uuid, uuid)'::regprocedure, " +
        "'public.award_chot_tham_dinh_duyet(uuid, uuid)'::regprocedure)",
    );
    expect(rows).toHaveLength(3);
    const trongThan = [
      ...new Set([
        ...rows.flatMap((r) => [...r.prosrc.matchAll(/CONSTRAINT = '(k8b_\w+)'/gu)].map((m) => m[1]!.toUpperCase())),
        ...rows.flatMap((r) => [...r.prosrc.matchAll(/RETURN '(K8B_\w+)'/gu)].map((m) => m[1]!)),
      ]),
    ].sort();
    const trongBang = Object.entries(CHOT_VAO_SO).filter(([, d]) => d.chot === "K8b").map(([k]) => k).sort();
    expect(trongThan).toEqual(trongBang);
    expect(trongBang).toHaveLength(6);
    for (const ma of trongBang) expect(CHOT_THEO_RANG_BUOC[ma.toLowerCase()], ma).toBe(ma);
  });
});

const ncc = (n: Ncc): string => n.ncc;
