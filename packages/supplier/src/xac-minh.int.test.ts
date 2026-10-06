import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docHoSoXacMinh, docXacMinhNhaCungCap, thuHoiXacMinhNhaCungCap, xacMinhNhaCungCap } from "./xac-minh.js";

// =============================================================================================
// [S1.196 / S3.3a / K8a · ADR-081 ⑵] XÁC MINH NỘI BỘ NHÀ CUNG CẤP — PHÉP ĐO TRÊN POSTGRES 16
//
// Mỗi luật một ca, và mỗi ca đọc CSDL chứ không đọc lời của hàm: hàng trong `supplier_verifications`, hàng sổ, và câu trả lời
// của `ncc_xac_minh_con_hieu_luc` — hàm mà K2 (S3.3c) sẽ hỏi. Tổ chức đã bật S3 dựng theo khuôn `tra-ve-nhap.int.test.ts`.
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
    tham_dinh_truoc_trao: false,
    khai_xung_dot: false,
    dau_thau_chinh_thuc: false,
  },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];
/** Hạn hiệu lực của phiên bản chính sách dựng ở đây — xác minh dùng CHUNG cột này (chủ dự án chốt 2026-09-29). */
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
  /** FINANCE thứ hai — người xác minh. */
  readonly tc2: Nguoi;
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

async function taoToChuc(batS3: boolean): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `xm-${randomBytes(4).toString("hex")}`,
  ]);
  const pm = await nguoi(org, "PROCUREMENT_MANAGER");
  const tc = await nguoi(org, "FINANCE");
  const tc2 = await nguoi(org, "FINANCE");
  const tiers = batS3 ? JSON.stringify(BAC) : null;
  const v = (
    await withTenant(apiPool, org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
          "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
          "VALUES ($1, 1, '100000000.00', 'VND', $2::jsonb, $3, $4, true, now(), $5, $6) RETURNING id",
        [org, tiers, batS3 ? 30 : null, batS3 ? THANG : null, pm.u, pm.s],
      ),
    )
  ).rows[0]!.id;
  if (batS3) {
    await withTenant(apiPool, org, (c) =>
      c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
        org,
        v,
        tc.u,
        tc.s,
      ]),
    );
  }
  const { rows } = await withTenant(apiPool, org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [org]));
  expect(rows[0]?.b, "dàn cảnh: công tắc S3").toBe(batS3);
  return { org, pm, tc, tc2 };
}

/** Hồ sơ nhà cung cấp có MST (hay không) và một người liên hệ, dựng bởi `ai` (người liên hệ bởi `aiLienHe`). */
async function hoSo(t: ToChuc, tuyChon: { readonly mst?: boolean; readonly ai?: Nguoi; readonly aiLienHe?: Nguoi } = {}): Promise<{ ncc: string; lh: string }> {
  const ai = tuyChon.ai ?? t.pm;
  const mst = tuyChon.mst === false ? null : `03${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const ncc = await withTenant(apiPool, t.org, async (c) =>
    (await c.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [t.org, `NCC ${randomBytes(3).toString("hex")}`, mst, ai.u, ai.s],
    )).rows[0]!.id,
  );
  const lhAi = tuyChon.aiLienHe ?? ai;
  const duoi = randomBytes(6).toString("hex");
  const lh = await withTenant(apiPool, t.org, async (c) =>
    (await c.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi ban hang', $3, $4, $5, $6) RETURNING id",
      [t.org, ncc, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), lhAi.u, lhAi.s],
    )).rows[0]!.id,
  );
  return { ncc, lh };
}

async function xacMinh(t: ToChuc, ncc: string, ai: Nguoi): Promise<Awaited<ReturnType<typeof xacMinhNhaCungCap>>> {
  // [S1.273 / S3.3e1] Lần xác minh mang băm hồ sơ đã thấy — đọc ngay trước, như màn `/nha-cung-cap`.
  return await withTenant(apiPool, t.org, async (c) => {
    const bamDaXem = (await docHoSoXacMinh(c, t.org)).find((h) => h.supplierId === ncc)?.bamHoSo ?? "";
    return await xacMinhNhaCungCap(c, t.org, { supplierId: ncc, actorSessionId: ai.s, bamDaXem }, auditPool);
  });
}

async function loiCua(p: Promise<unknown>): Promise<{ ten: string; thongDiep: string; ma?: string }> {
  try {
    await p;
  } catch (e) {
    const l = e as { name: string; message: string; lyDo?: string };
    return { ten: l.name, thongDiep: l.message, ...(l.lyDo === undefined ? {} : { ma: l.lyDo }) };
  }
  throw new Error("lời gọi phải ném");
}

async function conHieuLuc(t: ToChuc, ncc: string): Promise<boolean> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ b: boolean }>("SELECT public.ncc_xac_minh_con_hieu_luc($1, $2) AS b", [t.org, ncc]),
  );
  return rows[0]?.b === true;
}

async function soHang(ncc: string): Promise<{ loai: string; thu_tu: string }[]> {
  return (await db.pool.query<{ loai: string; thu_tu: string }>(
    "SELECT loai, thu_tu::text FROM supplier_verifications WHERE supplier_id = $1 ORDER BY thu_tu",
    [ncc],
  )).rows;
}

async function soChot(org: string, ncc: string): Promise<string[]> {
  return (await db.pool.query<{ ma: string }>(
    "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, ncc],
  )).rows.map((r) => r.ma);
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

describe("S3.3a — K8a: xác minh nội bộ nhà cung cấp", () => {
  it("[INV-K8a] FINANCE khác người tạo hồ sơ xác minh ⇒ hàng VERIFIED thứ tự 1, hạn = lúc ghi + tham_dinh_hieu_luc_thang, hàm hiệu lực trả true, một hàng sổ SUPPLIER_VERIFIED không mang MST", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t);
    expect(await conHieuLuc(t, ncc), "chưa xác minh thì chưa được đếm").toBe(false);
    const xm = await xacMinh(t, ncc, t.tc2);
    expect(xm).toMatchObject({ supplierId: ncc, loai: "VERIFIED", conHieuLuc: true, boi: t.tc2.u, lyDo: null });
    const { rows } = await db.pool.query<{ dung: boolean; bam: boolean }>(
      "SELECT het_han_at = created_at + make_interval(months => $2) AS dung, bam_ho_so IS NOT NULL AS bam FROM supplier_verifications WHERE supplier_id = $1",
      [ncc, THANG],
    );
    expect(rows).toEqual([{ dung: true, bam: true }]);
    expect(await soHang(ncc)).toEqual([{ loai: "VERIFIED", thu_tu: "1" }]);
    const { rows: so } = await db.pool.query<{ actor_id: string; payload: unknown }>(
      "SELECT actor_id, payload FROM audit_events WHERE org_id = $1 AND action = 'SUPPLIER_VERIFIED' AND resource_id = $2",
      [t.org, ncc],
    );
    expect(so).toEqual([{ actor_id: t.tc2.u, payload: { thuTu: "1" } }]);
  });

  it("[INV-K8a] người TẠO hồ sơ tự xác minh ⇒ ChotKiemSoatError K8A_NGUOI_TAO_TU_XAC_MINH, một hàng CONTROL_DENIED, không hàng xác minh nào; người tạo MỘT người liên hệ cũng vậy", async () => {
    const t = await taoToChuc(true);
    // Hai nhánh ĐO RIÊNG: hồ sơ do `tc2` dựng nhưng người liên hệ do `pm` dựng (chỉ nhánh người tạo hồ sơ chặn), rồi ngược lại.
    const a = await hoSo(t, { ai: t.tc2, aiLienHe: t.pm });
    expect(await loiCua(xacMinh(t, a.ncc, t.tc2))).toMatchObject({ ten: "ChotKiemSoatError", ma: "K8A_NGUOI_TAO_TU_XAC_MINH" });
    expect(await soChot(t.org, a.ncc)).toEqual(["K8A_NGUOI_TAO_TU_XAC_MINH"]);
    expect(await soHang(a.ncc)).toEqual([]);
    const b = await hoSo(t, { aiLienHe: t.tc2 });
    expect(await loiCua(xacMinh(t, b.ncc, t.tc2))).toMatchObject({ ten: "ChotKiemSoatError", ma: "K8A_NGUOI_TAO_TU_XAC_MINH" });
    expect(await soChot(t.org, b.ncc)).toEqual(["K8A_NGUOI_TAO_TU_XAC_MINH"]);
    // Đối chứng: người FINANCE KHÁC xác minh được chính hồ sơ ấy.
    expect((await xacMinh(t, b.ncc, t.tc)).conHieuLuc).toBe(true);
  });

  it("[INV-K8a] người giữ `rfq.invite` (FINANCE kèm một vai mời) ⇒ ChotKiemSoatError K8A_NGUOI_MOI_XAC_MINH và một hàng CONTROL_DENIED", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t);
    // Không vai mặc định nào giữ cả `supplier.qualify` lẫn `rfq.invite` — D3/`033` cấm FINANCE cùng BUYER/PM. Dựng một vai mời
    // KHÔNG thuộc chuỗi D3 khác: TECHNICAL giữ `rfq.invite` (3/5 chuỗi cùng FINANCE — trigger ma trận cho qua).
    await db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ('TECHNICAL', 'rfq.invite')");
    try {
      await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'TECHNICAL')", [t.org, t.tc2.u]);
      expect(await loiCua(xacMinh(t, ncc, t.tc2))).toMatchObject({ ten: "ChotKiemSoatError", ma: "K8A_NGUOI_MOI_XAC_MINH" });
      expect(await soChot(t.org, ncc)).toEqual(["K8A_NGUOI_MOI_XAC_MINH"]);
      expect(await soHang(ncc)).toEqual([]);
    } finally {
      await db.pool.query("DELETE FROM role_permissions WHERE role_code = 'TECHNICAL' AND permission_code = 'rfq.invite'");
    }
  });

  it("[INV-K8a] thiếu `supplier.qualify` (PM) ⇒ PermissionDeniedError và một hàng PERMISSION_DENIED; không hàng xác minh", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t, { ai: t.tc });
    expect((await loiCua(xacMinh(t, ncc, t.pm))).ten).toBe("PermissionDeniedError");
    const { rows } = await db.pool.query(
      "SELECT 1 FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND resource_id = $2",
      [t.org, ncc],
    );
    expect(rows).toHaveLength(1);
    expect(await soHang(ncc)).toEqual([]);
  });

  it("[INV-K8a] hồ sơ không MST ⇒ từ chối, KHÔNG vào sổ; tổ chức chưa bật S3 ⇒ từ chối, KHÔNG vào sổ (cấu hình, ADR-060)", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t, { mst: false });
    expect((await loiCua(xacMinh(t, ncc, t.tc2))).thongDiep).toMatch(/chua co MST/u);
    expect(await soChot(t.org, ncc)).toEqual([]);
    const u = await taoToChuc(false);
    const h = await hoSo(u);
    expect((await loiCua(xacMinh(u, h.ncc, u.tc2))).thongDiep).toMatch(/Chi to chuc da bat S3/u);
    expect(await soChot(u.org, h.ncc)).toEqual([]);
    expect(await soHang(h.ncc)).toEqual([]);
  });

  it("[INV-K8a] hồ sơ ĐỔI sau khi xác minh — thêm người liên hệ (qua `app_api`), MST, email, trạng thái (sửa tay của chủ CSDL: `app_api` không UPDATE được, `011`) — ⇒ thôi hiệu lực mà không hàng nào bị sửa; xác minh lại ⇒ hiệu lực, thứ tự tăng", async () => {
    const t = await taoToChuc(true);
    const { ncc, lh } = await hoSo(t);
    const qua = (sql: string, thamSo: readonly unknown[]) => () => withTenant(apiPool, t.org, (c) => c.query(sql, [...thamSo]));
    const chuCsdl = (sql: string, thamSo: readonly unknown[]) => () => db.pool.query(sql, [...thamSo]);
    const doi: readonly [string, () => Promise<unknown>][] = [
      [
        "người liên hệ mới qua app_api",
        qua(
          "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, created_by, created_by_session_id) VALUES ($2, $1, 'Moi', 'moi@vidu.vn', $3, $4)",
          [ncc, t.org, t.pm.u, t.pm.s],
        ),
      ],
      ["MST", chuCsdl("UPDATE suppliers SET tax_code = '0399999999' WHERE id = $1", [ncc])],
      ["email", chuCsdl("UPDATE supplier_contacts SET email = 'khac@vidu.vn' WHERE id = $1", [lh])],
      ["trạng thái người liên hệ", chuCsdl("UPDATE supplier_contacts SET status = 'SUSPENDED' WHERE id = $1", [lh])],
      ["tên pháp lý", chuCsdl("UPDATE suppliers SET legal_name = legal_name || ' JSC' WHERE id = $1", [ncc])],
    ];
    for (const [i, [ten, lam]] of doi.entries()) {
      await xacMinh(t, ncc, t.tc2);
      expect(await conHieuLuc(t, ncc), `${ten}: trước khi đổi`).toBe(true);
      await lam();
      expect(await conHieuLuc(t, ncc), `${ten}: sau khi đổi`).toBe(false);
      expect((await soHang(ncc)).length, `${ten}: không hàng nào bị sửa, chỉ thêm`).toBe(i + 1);
    }
    expect((await xacMinh(t, ncc, t.tc2)).conHieuLuc).toBe(true);
    expect((await soHang(ncc)).map((h) => h.thu_tu)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("[INV-K8a] HẾT HẠN ⇒ hàm hiệu lực trả false — hàng dựng thẳng bằng superuser, trigger quy tắc tắt tạm, băm đúng hồ sơ hiện tại", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t);
    await db.pool.query("ALTER TABLE supplier_verifications DISABLE TRIGGER supplier_verifications_kiem_xac_minh");
    try {
      for (const [thuTu, han] of [[1, "now() - interval '1 second'"], [2, "now() + interval '1 day'"]] as const) {
        await db.pool.query(
          `INSERT INTO supplier_verifications (org_id, supplier_id, loai, thu_tu, bam_ho_so, het_han_at, created_by, created_by_session_id)
           VALUES ($1, $2, 'VERIFIED', $3, public.ncc_bam_xac_minh($1, $2), ${han}, $4, $5)`,
          [t.org, ncc, thuTu, t.tc2.u, t.tc2.s],
        );
        expect(await conHieuLuc(t, ncc), `hạn ${han}`).toBe(thuTu === 2);
      }
    } finally {
      await db.pool.query("ALTER TABLE supplier_verifications ENABLE ALWAYS TRIGGER supplier_verifications_kiem_xac_minh");
    }
  });

  it("[INV-K8a] thu hồi: lý do bắt buộc; chưa xác minh thì không thu hồi được; sau khi thu hồi ⇒ REVOKED, thôi hiệu lực, lý do vào sổ; hàng mới nhất theo thứ tự quyết định", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t);
    const thuHoi = (lyDo: string) =>
      withTenant(apiPool, t.org, (c) => thuHoiXacMinhNhaCungCap(c, t.org, { supplierId: ncc, reason: lyDo, actorSessionId: t.tc.s }, auditPool));
    expect((await loiCua(thuHoi("   "))).thongDiep).toMatch(/Cần lý do/u);
    expect((await loiCua(thuHoi("MST sai"))).thongDiep).toMatch(/chua duoc xac minh/u);
    await xacMinh(t, ncc, t.tc2);
    const r = await thuHoi("MST khong khop giay phep");
    expect(r).toMatchObject({ loai: "REVOKED", conHieuLuc: false, lyDo: "MST khong khop giay phep", hetHanAt: null });
    expect(await soHang(ncc)).toEqual([
      { loai: "VERIFIED", thu_tu: "1" },
      { loai: "REVOKED", thu_tu: "2" },
    ]);
    const { rows } = await db.pool.query<{ payload: unknown }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'SUPPLIER_VERIFICATION_REVOKED' AND resource_id = $2",
      [t.org, ncc],
    );
    expect(rows).toEqual([{ payload: { thuTu: "2", reason: "MST khong khop giay phep" } }]);
    expect((await withTenant(apiPool, t.org, (c) => docXacMinhNhaCungCap(c, t.org, ncc))).loai).toBe("REVOKED");
  });

  it("[INV-K8a] hai lần ghi ĐỒNG THỜI trên cùng nhà cung cấp xếp hàng dưới khoá tư vấn: thứ tự liền nhau, không trùng", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t);
    await Promise.all([xacMinh(t, ncc, t.tc2), xacMinh(t, ncc, t.tc), xacMinh(t, ncc, t.tc2)]);
    expect((await soHang(ncc)).map((h) => h.thu_tu)).toEqual(["1", "2", "3"]);
  });

  it("[INV-K8a] chỉ ghi thêm: app_api không UPDATE/DELETE được; superuser bị trigger chặn", async () => {
    const t = await taoToChuc(true);
    const { ncc } = await hoSo(t);
    await xacMinh(t, ncc, t.tc2);
    for (const sql of ["UPDATE supplier_verifications SET ly_do = 'x' WHERE supplier_id = $1", "DELETE FROM supplier_verifications WHERE supplier_id = $1"]) {
      await expect(withTenant(apiPool, t.org, (c) => c.query(sql, [ncc])), sql).rejects.toMatchObject({ code: "42501" });
      await expect(db.pool.query(sql, [ncc]), `superuser: ${sql}`).rejects.toThrow();
    }
    expect(await soHang(ncc)).toHaveLength(1);
  });
});
