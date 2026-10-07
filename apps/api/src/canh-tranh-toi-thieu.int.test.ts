// ==============================================================================================
// [S1.269 / S3.3c2 · spec S3 §2.4 ⑹ ⑺, §4.4, §5.1 · K2 · K5 · K12] CẠNH TRANH TỐI THIỂU — PHÉP ĐO TRÊN POSTGRES 16, QUA HTTP
// VÀ DƯỚI `app_api`
//
// Migration `107_canh_tranh_toi_thieu`, hai lần hỏi trước của `packages/rfq` (`submitRfqForApproval`, `openRfq`). Hợp đồng đo ở đây:
//   ⑴ K2 — đối chứng dương: đủ `so_ncc_toi_thieu` nhóm nhà cung cấp ĐẾM ĐƯỢC thì nộp duyệt đi qua; thiếu một ⇒ `422` mang câu của
//      chốt, MỘT hàng `CONTROL_DENIED {K2_THIEU_CANH_TRANH}`, gói ở DRAFT;
//   ⑵ luật đếm — mỗi vế một ca: hồ sơ hay MỘT người liên hệ do người tạo gói, người mời, hay người THU HỒI dựng (lượt soi hình
//      dạng S3.3c2, CAO: người bỏ tên khỏi danh sách); không MST; không xác minh, xác minh đã thu hồi, băm hồ sơ đổi sau xác minh;
//      người xác minh là người khai phiên bản ngân sách ghim, hay về sau thành người chọn danh sách; người liên hệ được mời không
//      ACTIVE hay không có số điện thoại;
//   ⑶ nhóm — MST gốc (mã chi nhánh gộp về gốc), email hay chín chữ số cuối điện thoại của BẤT KỲ người liên hệ nào, bắc cầu, kể cả
//      qua một lời mời không đếm được;
//   ⑷ ngoại lệ khớp CHẶT: một lời mời ⇒ chỉ `SINGLE_SOURCE`; từ hai ⇒ chỉ `LIMITED_COMPETITION`; danh sách rỗng, `ROTATION`,
//      ngoại lệ đã rút không cứu;
//   ⑸ bậc đấu thầu chính thức: `422` + `CONTROL_DENIED {K2_DAU_THAU_CHINH_THUC}`, kể cả đủ nhà cung cấp và có ngoại lệ;
//   ⑹ READ COMMITTED: câu nộp dưới REPEATABLE READ bị trigger chặn ở MỌI tổ chức; một lần rút ngoại lệ chen trước câu nộp được
//      thấy; trigger là lớp chặn cuối cho câu viết tay;
//   ⑺ K5 — bậc `ky_danh_sach_moi` hay gói có ngoại lệ: chữ ký còn hiệu lực của người chọn danh sách (người mời, người thu hồi,
//      người dựng một nhà cung cấp trên danh sách, tác giả ngoại lệ) không mở được gói ⇒ `422` + `CONTROL_DENIED`; một người ký
//      ngoài tập loại trừ thì mở được; gói cấp kép cần hai chữ ký và ít nhất một độc lập; chưa đủ chữ ký thì K4b nói và KHÔNG có
//      hàng `CONTROL_DENIED`; gói không bậc ghim: K2 nhường lời cho K1, K5 coi như bậc đòi ký danh sách;
//   ⑻ tổ chức chưa bật chạy như MVP1; tập mã của hai hàm vị từ BẰNG các dòng K2, K5 của `CHOT_VAO_SO`.
// Mỗi vế của hai hàm vị từ có một ĐỘT BIẾN trong chính tệp này (áp trong một giao dịch rồi ROLLBACK, hay COMMIT rồi khôi phục).
// ==============================================================================================
import { createHash, generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import { createInvitation, lapNgoaiLe, revokeInvitation, rutNgoaiLe } from "@trustprocure/invitation";
import { addRfqItem, approveRfq, createProcurementPolicy, createRfq, setRfqBudget } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TD_K2 = CHOT_VAO_SO.K2_THIEU_CANH_TRANH.thongDiep;
const TD_DTCT = CHOT_VAO_SO.K2_DAU_THAU_CHINH_THUC.thongDiep;
const TD_K5 = CHOT_VAO_SO.K5_THIEU_CHU_KY_DOC_LAP.thongDiep;
const GIAI_TRINH = "Chi mot nha san xuat co chung nhan hop quy cho thep tam SS400 day 3mm trong khu vuc.";

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `ngoai-le-canh-tranh.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo cạnh mở gói.
const boBocGia = {
  name: "gia-cho-test-canh-tranh",
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

const BAC_THUONG = {
  award_vai_khac_nhau: false,
  xoay_vong_n: 0,
  award_so_chu_ky: 1,
  award_vai: ["DIRECTOR"],
  tham_dinh_truoc_trao: false,
  khai_xung_dot: false,
  dau_thau_chinh_thuc: false,
};
/** Ba bậc: dưới 100 triệu cần 2 nhóm, không ký danh sách; từ 100 triệu cần 3 nhóm, ký danh sách; từ 10 tỷ đấu thầu chính thức. */
const BAC = [
  { tu_so_tien: 0, so_ncc_toi_thieu: 2, ky_danh_sach_moi: false, ...BAC_THUONG },
  { tu_so_tien: 100_000_000, so_ncc_toi_thieu: 3, ky_danh_sach_moi: true, ...BAC_THUONG },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];
const GIA_BAC0 = "50000000.00";
const GIA_BAC1 = "200000000.00";
/** Bậc 1, vượt ngưỡng cấp kép 1 tỷ: hai chữ ký. */
const GIA_KEP = "2000000000.00";
const GIA_DTCT = "20000000000.00";
/** Bậc 0, nhỏ: hai gói cùng nhóm hàng không chạm cận 100 triệu — để tín hiệu chia nhỏ (K10a) không chen vào ca đo K5. */
const GIA_NHO = "10000000.00";

// ---- Dàn cảnh --------------------------------------------------------------------------------
let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi extends NguoiPhien {
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  readonly daBat: boolean;
  /** PROCUREMENT_MANAGER — tạo gói, mời, mở. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER — người duyệt độc lập. */
  readonly pm2: Nguoi;
  /** PROCUREMENT_MANAGER — người thứ ba: kẻ chọn danh sách trong các ca đo (mời, thu hồi, dựng hồ sơ, lập ngoại lệ, ký). */
  readonly pm3: Nguoi;
  /** PROCUREMENT_MANAGER — người thứ tư, cho gói cấp kép. */
  readonly pm4: Nguoi;
  /** BUYER — người tạo gói trung thực của ca thu hồi. */
  readonly mua: Nguoi;
  /** FINANCE — người KHAI phiên bản chính sách có bậc. */
  readonly tc: Nguoi;
  /** FINANCE — người KÝ phiên bản ấy; người xác minh mặc định. */
  readonly tc2: Nguoi;
  /** TECHNICAL — người nhập hồ sơ nhà cung cấp (`nguoiNhapNhaCungCap`). */
  readonly nhap: NguoiPhien;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(batS3 = true): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`ct-${randomBytes(4).toString("hex")}`]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $2, 'ACTIVE') RETURNING id", [
      org,
      `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
    ]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const token = randomBytes(32).toString("base64url");
    const s = await motId(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [org, u, createHash("sha256").update(token, "utf8").digest()],
    );
    return { u, s, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const pm3 = await nguoi("PROCUREMENT_MANAGER");
  const pm4 = await nguoi("PROCUREMENT_MANAGER");
  const mua = await nguoi("BUYER");
  const tc = await nguoi("FINANCE");
  const tc2 = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "1000000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  if (batS3) {
    const v2 = (
      await withTenant(apiPool, org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
            "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
            "VALUES ($1, 2, '1000000000.00', 'VND', $2::jsonb, 30, 12, true, now(), $3, $4) RETURNING id",
          [org, JSON.stringify(BAC), tc.u, tc.s],
        ),
      )
    ).rows[0]!.id;
    await withTenant(apiPool, org, (c) =>
      c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [org, v2, tc2.u, tc2.s]),
    );
  }
  const nhap = await nguoiNhapNhaCungCap(db.pool, org);
  return { org, daBat: batS3, pm, pm2, pm3, pm4, mua, tc, tc2, nhap };
}

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

const mstNgauNhien = (): string => `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
const dtNgauNhien = (): string => `09${String(randomInt(0, 1e8)).padStart(8, "0")}`;

interface TuyChonNcc {
  /** Người dựng hồ sơ — mặc định người nhập TECHNICAL. */
  readonly nhap?: NguoiPhien;
  /** Người dựng người liên hệ được mời — mặc định như hồ sơ. */
  readonly nhapLienHe?: NguoiPhien;
  readonly mst?: string | null;
  readonly email?: string;
  readonly phone?: string | null;
  readonly trangThaiLienHe?: "ACTIVE" | "SUSPENDED";
  /** Người liên hệ PHỤ — không được mời; dựng trước lần xác minh (băm hồ sơ phủ nó). */
  readonly lienHePhu?: readonly { readonly email?: string; readonly phone?: string | null; readonly nhap?: NguoiPhien }[];
  /** Người xác minh — mặc định `tc2`; `null` thì không xác minh. */
  readonly xacMinh?: NguoiPhien | null;
}
interface Ncc {
  readonly ncc: string;
  readonly lh: string;
}

/** Một nhà cung cấp dựng bằng câu thô dưới chủ cụm — mặc định ĐẾM ĐƯỢC cho K2; mỗi tuỳ chọn bẻ đúng một vế. */
async function ncc(t: ToChuc, o: TuyChonNcc = {}): Promise<Ncc> {
  const nhap = o.nhap ?? t.nhap;
  const id = await motId(
    "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, o.mst === undefined ? mstNgauNhien() : o.mst, nhap.u, nhap.s],
  );
  const nhapLh = o.nhapLienHe ?? nhap;
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, status, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6, $7) RETURNING id",
    [
      t.org,
      id,
      o.email ?? `lh${randomBytes(6).toString("hex")}@vidu.vn`,
      o.phone === undefined ? dtNgauNhien() : o.phone,
      o.trangThaiLienHe ?? "ACTIVE",
      nhapLh.u,
      nhapLh.s,
    ],
  );
  for (const p of o.lienHePhu ?? []) {
    const ai = p.nhap ?? nhap;
    // [S1.9101 / khoản 344] Người liên hệ do người KHÁC người dựng hồ sơ thêm nay bị trigger `ncc_kiem_them_lien_he` chặn; hàng như thế
    // chỉ còn là dữ liệu có trước `9501` — K2 vẫn phải loại nó. Dựng bằng superuser với trigger tạm tắt.
    const cu = ai.u !== nhap.u;
    if (cu) await db.pool.query("ALTER TABLE supplier_contacts DISABLE TRIGGER supplier_contacts_kiem_nguoi_them");
    try {
      await db.pool.query(
        "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) VALUES ($1, $2, 'Lien he phu', $3, $4, $5, $6)",
        [t.org, id, p.email ?? `phu${randomBytes(6).toString("hex")}@vidu.vn`, p.phone === undefined ? dtNgauNhien() : p.phone, ai.u, ai.s],
      );
    } finally {
      if (cu) await db.pool.query("ALTER TABLE supplier_contacts ENABLE ALWAYS TRIGGER supplier_contacts_kiem_nguoi_them");
    }
  }
  const xm = o.xacMinh === undefined ? t.tc2 : o.xacMinh;
  if (xm !== null) await xacMinh(t, id, xm);
  return { ncc: id, lh };
}

async function xacMinh(t: ToChuc, nccId: string, ai: NguoiPhien, loai: "VERIFIED" | "REVOKED" = "VERIFIED"): Promise<void> {
  await db.pool.query(
    "INSERT INTO supplier_verifications (org_id, supplier_id, loai, ly_do, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [t.org, nccId, loai, loai === "REVOKED" ? "thu hoi xac minh" : null, ai.u, ai.s],
  );
}

/** Gói DRAFT có ngân sách, nhóm hàng và một hạng mục — người tạo mặc định `pm`. */
async function goiNhap(t: ToChuc, giaTri = GIA_BAC0, taoBoi: Nguoi = t.pm): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: taoBoi.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: taoBoi.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: taoBoi.s });
  });
  return rfqId;
}

async function moi(t: ToChuc, rfqId: string, n: Ncc, ai: Nguoi = t.pm): Promise<string> {
  return (
    await withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n.ncc, contactId: n.lh, actorSessionId: ai.s }, auditPool))
  ).id;
}

async function thuHoi(t: ToChuc, loiMoi: string, ai: Nguoi): Promise<void> {
  await withTenant(apiPool, t.org, (c) => revokeInvitation(c, t.org, { invitationId: loiMoi, actorSessionId: ai.s }, auditPool));
}

async function moiDemDuoc(t: ToChuc, rfqId: string, soLuong: number, ai: Nguoi = t.pm): Promise<void> {
  for (let i = 0; i < soLuong; i += 1) await moi(t, rfqId, await ncc(t), ai);
}

async function lapNl(t: ToChuc, rfqId: string, loai: string, ai: Nguoi = t.pm): Promise<string> {
  return (
    await withTenant(apiPool, t.org, (c) =>
      lapNgoaiLe(c, t.org, { rfqId, loai, maLyDo: "PROPRIETARY_TECHNOLOGY", giaiTrinh: GIAI_TRINH, actorSessionId: ai.s }, auditPool),
    )
  ).id;
}

async function rutNl(t: ToChuc, rfqId: string, exceptionId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) =>
    rutNgoaiLe(c, t.org, { rfqId, exceptionId, reason: "tim duoc nha cung cap khac", actorSessionId: t.pm.s }, auditPool),
  );
}

/** Người ký gửi lại lần nộp VỪA ĐỌC (ADR-117). Hàm gói không hỏi `rfq.approve` — route hỏi; K5 hỏi lại ở CSDL. */
async function duyet(t: ToChuc, rfqId: string, ai: Nguoi): Promise<void> {
  await withTenant(apiPool, t.org, async (c) => {
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]!.n;
    await approveRfq(c, t.org, { rfqId, sessionId: ai.s, lanNopDaXem: lan }, auditPool);
  });
}

interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
}
async function goi(method: string, duong: string, cookie: string): Promise<PhanHoi> {
  const res = await fetch(`${goc}${duong}`, { method, headers: { cookie } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // thân không phải JSON — để `text` nói
  }
  return { status: res.status, body, text };
}
const nop = (t: ToChuc, rfqId: string, ai: Nguoi = t.pm): Promise<PhanHoi> => goi("POST", `/rfqs/${rfqId}/submit`, ai.cookie);
const mo = (t: ToChuc, rfqId: string): Promise<PhanHoi> => goi("POST", `/rfqs/${rfqId}/open`, t.pm.cookie);

async function tuChoiChot(org: string, rfqId: string): Promise<{ ma: unknown; actorId: string | null }[]> {
  const { rows } = await db.pool.query<{ payload: Record<string, unknown> | null; actor_id: string | null }>(
    "SELECT payload, actor_id FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows.map((h) => ({ ma: h.payload?.ma, actorId: h.actor_id }));
}

async function trangThai(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

async function dem(t: ToChuc, rfqId: string): Promise<number> {
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ n: number }>("SELECT public.rfq_dem_ncc_canh_tranh($1, $2) AS n", [t.org, rfqId]));
  return rows[0]!.n;
}

async function chotK2(t: ToChuc, rfqId: string): Promise<string | null> {
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ m: string | null }>("SELECT public.rfq_chot_canh_tranh($1, $2) AS m", [t.org, rfqId]));
  return rows[0]!.m;
}

interface LoiBat {
  readonly message: string;
  readonly code: string;
  readonly constraint: string;
}
async function loi(p: Promise<unknown>): Promise<LoiBat | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string; constraint?: string };
    return { message: x.message, code: x.code ?? "", constraint: x.constraint ?? "" };
  }
}

/** ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: câu đột biến chạy dưới chủ cụm, rồi `viec` dưới `app_api` trong tổ chức. */
async function trongDotBien<T>(org: string, dotBien: readonly string[], viec: (c: pg.PoolClient) => Promise<T>, capCach = "READ COMMITTED"): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query(`BEGIN ISOLATION LEVEL ${capCach}`);
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
async function defDotBien(ham: string, cu: string, moiChuoi: string): Promise<string> {
  const goc0 = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc0.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  return goc0.replace(cu, moiChuoi);
}

const hoiK2 = async (c: pg.PoolClient, org: string, rfqId: string): Promise<string | null> =>
  (await c.query<{ m: string | null }>("SELECT public.rfq_chot_canh_tranh($1, $2) AS m", [org, rfqId])).rows[0]!.m;
const hoiDem = async (c: pg.PoolClient, org: string, rfqId: string): Promise<number> =>
  (await c.query<{ n: number }>("SELECT public.rfq_dem_ncc_canh_tranh($1, $2) AS n", [org, rfqId])).rows[0]!.n;
const hoiK5 = async (c: pg.PoolClient, org: string, rfqId: string): Promise<string | null> =>
  (await c.query<{ m: string | null }>("SELECT public.rfq_chot_chu_ky_doc_lap($1, $2) AS m", [org, rfqId])).rows[0]!.m;

const HAM_DEM = "public.rfq_dem_ncc_canh_tranh(uuid, uuid)";
/** [S1.270 / S3.3d] Vị từ *đếm được* tách khỏi `rfq_dem_ncc_canh_tranh` (`108_xoay_vong`) — các đột biến của sáu vế áp ở đây. */
const HAM_DEM_DUOC = "public.rfq_loi_moi_dem_duoc(uuid, uuid)";
const HAM_K2 = "public.rfq_chot_canh_tranh(uuid, uuid)";
const HAM_K5 = "public.rfq_chot_chu_ky_doc_lap(uuid, uuid)";

/** Câu nộp viết tay dưới `app_api` — không qua lần hỏi trước của gói. */
const CAU_NOP_THO =
  "UPDATE public.rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1 AND status = 'DRAFT'";
const CAU_MO_THO = "UPDATE public.rfq_packages SET status = 'OPEN', opened_by = $2, opened_by_session_id = $3, opened_at = now() WHERE id = $1";

async function moGiaoDich(org: string, capCach = "READ COMMITTED"): Promise<pg.PoolClient> {
  const c = await apiPool.connect();
  await c.query(`BEGIN ISOLATION LEVEL ${capCach}`);
  await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
  return c;
}

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

async function dungServer(dispatcher: ReturnType<typeof createDispatcher>): Promise<string> {
  const server = createApiServer(dispatcher);
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  dongServer.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = createPool(db.connectionString, 6, { role: "app_api" });
  auditPool = createPool(db.connectionString, 4, { role: "app_api" });
  const services: ApiServices = { ...dichVuTest().services, orgKeyProvisioner: boBocGia };
  goc = await dungServer(createDispatcher({ pool: apiPool, auditPool, services }));
}, 180000);

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

// =============================================================================================
// ⑴ K2 — ĐỐI CHỨNG DƯƠNG VÀ LỜI TỪ CHỐI CÓ TÊN
// =============================================================================================
describe("[S1.269 / S3.3c2 / K2] nộp duyệt cần đủ nhóm nhà cung cấp đếm được", () => {
  it("[INV-K2] ĐỐI CHỨNG DƯƠNG: bậc cần 2, hai nhà cung cấp đếm được ⇒ nộp 200, đếm 2, không CONTROL_DENIED", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await moiDemDuoc(t, rfqId, 2);
    expect(await dem(t, rfqId)).toBe(2);
    const r = await nop(t, rfqId);
    expect(r.status, r.text).toBe(200);
    expect(await trangThai(rfqId)).toBe("PENDING_APPROVAL");
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  it("[INV-K2] một nhà cung cấp đếm được ở bậc cần 2 ⇒ 422 mang câu của chốt, MỘT hàng CONTROL_DENIED {K2_THIEU_CANH_TRANH} dưới người nộp, gói ở DRAFT; bậc cần 3 với 2 ⇒ cũng vậy", async () => {
    const t = await taoToChuc();
    const a = await goiNhap(t);
    await moiDemDuoc(t, a, 1);
    const r = await nop(t, a);
    expect([r.status, r.body.error]).toEqual([422, TD_K2]);
    expect(await trangThai(a)).toBe("DRAFT");
    expect(await tuChoiChot(t.org, a)).toEqual([{ ma: "K2_THIEU_CANH_TRANH", actorId: t.pm.u }]);
    const b = await goiNhap(t, GIA_BAC1);
    await moiDemDuoc(t, b, 2);
    expect([(await nop(t, b)).status, await trangThai(b)]).toEqual([422, "DRAFT"]);
    await moiDemDuoc(t, b, 1);
    expect((await nop(t, b)).status).toBe(200);
  });

  it("[INV-K2] lớp chặn cuối: câu nộp viết tay dưới `app_api` ⇒ 23514 mang tên `k2_canh_tranh_toi_thieu`; ĐỘT BIẾN tắt trigger ⇒ cùng câu đi qua", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await moiDemDuoc(t, rfqId, 1);
    const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_NOP_THO, [rfqId, t.pm.u, t.pm.s])));
    expect(e).toMatchObject({ code: "23514", constraint: "k2_canh_tranh_toi_thieu", message: "Goi thau chua roi DRAFT duoc (K2): K2_THIEU_CANH_TRANH" });
    const qua = await trongDotBien(t.org, ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_so_ncc_khi_nop"], (c) =>
      c.query(CAU_NOP_THO, [rfqId, t.pm.u, t.pm.s]),
    );
    expect(qua.rowCount).toBe(1);
  });
});

// =============================================================================================
// ⑵ LUẬT ĐẾM — MỖI VẾ MỘT CA, MỖI CA ĐỘT BIẾN ĐÚNG VẾ ẤY
// =============================================================================================
describe("[S1.269 / S3.3c2 / K2] luật đếm — mỗi vế một ca", () => {
  /** Gói bậc 0 (cần 2) với MỘT nhà cung cấp đếm được và một nhà cung cấp `bien` — đếm ra 1 thì nộp bị từ chối. */
  async function goiVoiBien(t: ToChuc, bien: (t: ToChuc) => Promise<Ncc>, ai: { readonly moi?: Nguoi; readonly moiBien?: Nguoi } = {}): Promise<string> {
    const rfqId = await goiNhap(t);
    await moiDemDuoc(t, rfqId, 1, ai.moi ?? t.pm);
    await moi(t, rfqId, await bien(t), ai.moiBien ?? ai.moi ?? t.pm);
    return rfqId;
  }
  async function khongDem(t: ToChuc, rfqId: string): Promise<void> {
    expect(await dem(t, rfqId), "nhà cung cấp biến không được đếm").toBe(1);
    expect((await nop(t, rfqId)).status).toBe(422);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K2_THIEU_CANH_TRANH", actorId: t.pm.u }]);
  }

  it("[INV-K2] (i) hồ sơ do NGƯỜI TẠO gói dựng ⇒ không đếm; ĐỘT BIẾN bỏ người tạo khỏi tập người chọn ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    // Người mời là `mua`, không phải người tạo — để đột biến chỉ gỡ ĐÚNG vế người tạo.
    const rfqId = await goiVoiBien(t, (x) => ncc(x, { nhap: x.pm }), { moi: t.mua });
    await khongDem(t, rfqId);
    const n = await trongDotBien(t.org, [await defDotBien(HAM_DEM_DUOC, "SELECT g.nguoi_tao AS n FROM goc g\n    UNION", "SELECT NULL::uuid AS n FROM goc g\n    UNION")], (c) => hoiDem(c, t.org, rfqId));
    expect(n).toBe(2);
  });

  it("[INV-K2] (i) hồ sơ do một NGƯỜI MỜI khác người tạo dựng ⇒ không đếm; ĐỘT BIẾN bỏ vế người mời ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    const rfqId = await goiVoiBien(t, (x) => ncc(x, { nhap: x.pm3 }), { moiBien: t.pm3 });
    await khongDem(t, rfqId);
    const n = await trongDotBien(
      t.org,
      [await defDotBien(HAM_DEM_DUOC, "SELECT i.invited_by FROM public.rfq_invitations i WHERE", "SELECT NULL::uuid FROM public.rfq_invitations i WHERE")],
      (c) => hoiDem(c, t.org, rfqId),
    );
    expect(n).toBe(2);
  });

  it("[INV-K2] (i) NGƯỜI THU HỒI là người chọn (lượt soi hình dạng, CAO): người mua tạo và mời hai nhà thật cùng hai nhà vỏ của PM X; X thu hồi hai nhà thật ở DRAFT ⇒ nhà vỏ không đếm, nộp 422; ĐỘT BIẾN bỏ vế người thu hồi ⇒ chốt cho qua", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t, GIA_BAC0, t.mua);
    const that = [await moi(t, rfqId, await ncc(t), t.mua), await moi(t, rfqId, await ncc(t), t.mua)];
    await moi(t, rfqId, await ncc(t, { nhap: t.pm3 }), t.mua);
    await moi(t, rfqId, await ncc(t, { nhap: t.pm3 }), t.mua);
    expect(await dem(t, rfqId), "trước lần thu hồi: bốn nhà, bốn nhóm").toBe(4);
    for (const l of that) await thuHoi(t, l, t.pm3);
    expect(await dem(t, rfqId)).toBe(0);
    const r = await nop(t, rfqId, t.mua);
    expect([r.status, r.body.error]).toEqual([422, TD_K2]);
    const m = await trongDotBien(
      t.org,
      [await defDotBien(HAM_DEM_DUOC, "SELECT i.revoked_by FROM public.rfq_invitations i\n     WHERE", "SELECT NULL::uuid FROM public.rfq_invitations i\n     WHERE")],
      (c) => hoiK2(c, t.org, rfqId),
    );
    expect(m, "đột biến: hai nhà vỏ của người thu hồi được đếm").toBeNull();
  });

  it("[INV-K2] (i) MỘT người liên hệ PHỤ do người tạo gói dựng ⇒ cả hồ sơ không đếm; ĐỘT BIẾN bỏ vế người liên hệ ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    const rfqId = await goiVoiBien(t, (x) => ncc(x, { lienHePhu: [{ nhap: x.pm }] }));
    await khongDem(t, rfqId);
    const n = await trongDotBien(
      t.org,
      [await defDotBien(HAM_DEM_DUOC, "AND (k.created_by IS NULL OR EXISTS", "AND false AND (k.created_by IS NULL OR EXISTS")],
      (c) => hoiDem(c, t.org, rfqId),
    );
    expect(n).toBe(2);
  });

  it("[INV-K2] (ii) không MST ⇒ không đếm (xác minh cũng đòi MST, nên vế này là lớp phòng hai)", async () => {
    const t = await taoToChuc();
    await khongDem(t, await goiVoiBien(t, (x) => ncc(x, { mst: null, xacMinh: null })));
  });

  it("[INV-K2] (iii) không xác minh, xác minh đã THU HỒI, hay người liên hệ thêm SAU lần xác minh (băm hồ sơ đổi) ⇒ không đếm; ĐỘT BIẾN bỏ vế xác minh ⇒ đếm lại", async () => {
    const t = await taoToChuc();
    const a = await goiVoiBien(t, (x) => ncc(x, { xacMinh: null }));
    await khongDem(t, a);
    const b = await goiVoiBien(t, async (x) => {
      const n = await ncc(x);
      await xacMinh(x, n.ncc, x.tc2, "REVOKED");
      return n;
    });
    expect(await dem(t, b)).toBe(1);
    const c3 = await goiVoiBien(t, async (x) => {
      const n = await ncc(x);
      await db.pool.query(
        "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, created_by, created_by_session_id) VALUES ($1, $2, 'Moi them', $3, $4, $5)",
        [x.org, n.ncc, `them${randomBytes(4).toString("hex")}@vidu.vn`, x.nhap.u, x.nhap.s],
      );
      return n;
    });
    expect(await dem(t, c3)).toBe(1);
    // Đột biến đo trên ca ĐÃ THU HỒI và ca băm đổi: ca chưa xác minh vẫn rơi ở vế người xác minh (không hàng xác minh nào).
    const dotBien = [await defDotBien(HAM_DEM_DUOC, "AND public.ncc_xac_minh_con_hieu_luc(p_org, s.id)", "")];
    expect(await trongDotBien(t.org, dotBien, (c) => hoiDem(c, t.org, b))).toBe(2);
    expect(await trongDotBien(t.org, dotBien, (c) => hoiDem(c, t.org, c3))).toBe(2);
  });

  it("[INV-K2] (iii) người xác minh là người KHAI phiên bản ngân sách ghim (§2.4 ⑺) ⇒ không đếm; ĐỘT BIẾN bỏ vế tác giả ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    const rfqId = await goiVoiBien(t, (x) => ncc(x, { xacMinh: x.tc }));
    await khongDem(t, rfqId);
    const n = await trongDotBien(t.org, [await defDotBien(HAM_DEM_DUOC, "AND m.created_by IS DISTINCT FROM g.tac_gia", "")], (c) => hoiDem(c, t.org, rfqId));
    expect(n).toBe(2);
  });

  it("[INV-K2] (iii) người xác minh VỀ SAU thành người mời của gói (lượt soi hình dạng, T2) ⇒ hồ sơ không đếm; ĐỘT BIẾN bỏ vế ấy ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    // Lúc xác minh, `tc2` chỉ là FINANCE. Về sau được một vai mời — dựng như `xac-minh.int.test.ts`: TECHNICAL tạm giữ `rfq.invite`
    // (D3/`033` cấm FINANCE cùng BUYER/PM; TECHNICAL không thuộc chuỗi ấy).
    const n = await ncc(t);
    const rfqId = await goiNhap(t);
    await moiDemDuoc(t, rfqId, 1);
    await db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ('TECHNICAL', 'rfq.invite')");
    try {
      await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'TECHNICAL')", [t.org, t.tc2.u]);
      await moi(t, rfqId, n, t.tc2);
    } finally {
      await db.pool.query("DELETE FROM role_permissions WHERE role_code = 'TECHNICAL' AND permission_code = 'rfq.invite'");
    }
    // Hai nhà cung cấp đều do `tc2` xác minh, và `tc2` nay là người mời ⇒ cả hai thôi đếm.
    expect(await dem(t, rfqId)).toBe(0);
    expect((await nop(t, rfqId)).status).toBe(422);
    const m = await trongDotBien(
      t.org,
      [await defDotBien(HAM_DEM_DUOC, "AND NOT EXISTS (SELECT 1 FROM chon WHERE chon.n = m.created_by)", "")],
      (c) => hoiDem(c, t.org, rfqId),
    );
    expect(m).toBe(2);
  });

  it("[INV-K2] người liên hệ ĐƯỢC MỜI không ACTIVE, hay không có số điện thoại ⇒ không đếm; ĐỘT BIẾN bỏ vế ấy ⇒ đếm lại", async () => {
    const t = await taoToChuc();
    const a = await goiVoiBien(t, (x) => ncc(x, { trangThaiLienHe: "SUSPENDED" }));
    await khongDem(t, a);
    const b = await goiVoiBien(t, (x) => ncc(x, { phone: null }));
    expect(await dem(t, b)).toBe(1);
    const dotBien = [await defDotBien(HAM_DEM_DUOC, "AND c.status = 'ACTIVE' AND c.phone IS NOT NULL", "")];
    expect(await trongDotBien(t.org, dotBien, (c) => hoiDem(c, t.org, a))).toBe(2);
    expect(await trongDotBien(t.org, dotBien, (c) => hoiDem(c, t.org, b))).toBe(2);
  });

  it("[INV-K2] một hàng lời mời không rõ người mời (hàng trước `013`) ⇒ đếm 0 — không biết ai chọn thì không biết ai bị loại", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await moiDemDuoc(t, rfqId, 2);
    const n = await trongDotBien(
      t.org,
      ["ALTER TABLE public.rfq_invitations DISABLE TRIGGER USER", `UPDATE public.rfq_invitations SET invited_by = NULL, invited_by_session_id = NULL WHERE id = (SELECT id FROM public.rfq_invitations WHERE rfq_id = '${rfqId}' LIMIT 1)`],
      (c) => hoiDem(c, t.org, rfqId),
    );
    expect(n).toBe(0);
    expect(await dem(t, rfqId), "đối chứng: không đột biến thì đếm 2").toBe(2);
  });
});

// =============================================================================================
// ⑶ NHÓM — MST GỐC, EMAIL, CHÍN SỐ CUỐI, BẮC CẦU
// =============================================================================================
describe("[S1.269 / S3.3c2 / K2] hai lời mời của cùng một thực thể đếm một lần", () => {
  it("[INV-K2] MST gốc: `0123456789` và `0123456789-001` là một nhóm ⇒ đếm 1, nộp 422; ĐỘT BIẾN so nguyên MST ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    const goc0 = mstNgauNhien();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t, { mst: goc0 }));
    await moi(t, rfqId, await ncc(t, { mst: `${goc0}-001` }));
    expect(await dem(t, rfqId)).toBe(1);
    expect((await nop(t, rfqId)).status).toBe(422);
    expect(await trongDotBien(t.org, [await defDotBien(HAM_DEM, "left(s.tax_code, 10) AS mst_goc", "s.tax_code AS mst_goc")], (c) => hoiDem(c, t.org, rfqId))).toBe(2);
  });

  it("[INV-K2] email chung ở một người liên hệ PHỤ (không được mời) ⇒ một nhóm; ĐỘT BIẾN bỏ cạnh email ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    const email = `chung${randomBytes(4).toString("hex")}@vidu.vn`;
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t, { email }));
    await moi(t, rfqId, await ncc(t, { lienHePhu: [{ email }] }));
    expect(await dem(t, rfqId)).toBe(1);
    const dotBien = await defDotBien(
      HAM_DEM,
      "SELECT n.id, 'E|' || k.email\n      FROM nut n JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = n.supplier_id",
      "SELECT n.id, 'E|' || k.email\n      FROM nut n JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = n.supplier_id AND false",
    );
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiDem(c, t.org, rfqId))).toBe(2);
  });

  it("[INV-K2] điện thoại so chín chữ số cuối: `+84901234567` và `0901234567` là một nhóm; ĐỘT BIẾN so nguyên chuỗi số ⇒ đếm 2", async () => {
    const t = await taoToChuc();
    const duoi = String(randomInt(0, 1e8)).padStart(8, "0");
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t, { phone: `+849${duoi}` }));
    await moi(t, rfqId, await ncc(t, { phone: `09${duoi}` }));
    expect(await dem(t, rfqId)).toBe(1);
    const dotBien = await defDotBien(HAM_DEM, "right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 9)", "regexp_replace(k.phone, '[^0-9]', '', 'g')");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiDem(c, t.org, rfqId))).toBe(2);
  });

  it("[INV-K2] BẮC CẦU qua một lời mời KHÔNG đếm được: A ~ B (email), B ~ C (MST gốc), B chưa xác minh ⇒ A và C là một nhóm, đếm 1", async () => {
    const t = await taoToChuc();
    const email = `cau${randomBytes(4).toString("hex")}@vidu.vn`;
    const gocB = mstNgauNhien();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t, { email }));
    await moi(t, rfqId, await ncc(t, { mst: gocB, lienHePhu: [{ email }], xacMinh: null }));
    await moi(t, rfqId, await ncc(t, { mst: `${gocB}-002` }));
    expect(await dem(t, rfqId)).toBe(1);
    expect((await nop(t, rfqId)).status).toBe(422);
  });
});

// =============================================================================================
// ⑷ NGOẠI LỆ KHỚP CHẶT
// =============================================================================================
describe("[S1.269 / S3.3c2 / K2] dưới ngưỡng thì chỉ ngoại lệ còn sống ĐÚNG loại cứu", () => {
  it("[INV-K2] MỘT lời mời: `SINGLE_SOURCE` còn sống ⇒ nộp 200; `LIMITED_COMPETITION` hay `ROTATION` ⇒ 422; `SINGLE_SOURCE` đã rút ⇒ 422", async () => {
    const t = await taoToChuc();
    const ok = await goiNhap(t);
    await moiDemDuoc(t, ok, 1);
    await lapNl(t, ok, "SINGLE_SOURCE");
    expect((await nop(t, ok)).status).toBe(200);
    for (const loai of ["LIMITED_COMPETITION", "ROTATION"]) {
      const sai = await goiNhap(t);
      await moiDemDuoc(t, sai, 1);
      await lapNl(t, sai, loai);
      const r = await nop(t, sai);
      expect([loai, r.status, r.body.error]).toEqual([loai, 422, TD_K2]);
    }
    const daRut = await goiNhap(t);
    await moiDemDuoc(t, daRut, 1);
    await rutNl(t, daRut, await lapNl(t, daRut, "SINGLE_SOURCE"));
    expect((await nop(t, daRut)).status).toBe(422);
  });

  it("[INV-K2] HAI lời mời đếm ra một nhóm: `LIMITED_COMPETITION` ⇒ 200; `SINGLE_SOURCE` ⇒ 422 — ngoại lệ phải nói đúng danh sách người duyệt ký; ĐỘT BIẾN nhận mọi loại ⇒ cho qua", async () => {
    const t = await taoToChuc();
    const ok = await goiNhap(t);
    await moiDemDuoc(t, ok, 1);
    await moi(t, ok, await ncc(t, { xacMinh: null }));
    await lapNl(t, ok, "LIMITED_COMPETITION");
    expect((await nop(t, ok)).status).toBe(200);
    const sai = await goiNhap(t);
    await moiDemDuoc(t, sai, 1);
    await moi(t, sai, await ncc(t, { xacMinh: null }));
    await lapNl(t, sai, "SINGLE_SOURCE");
    expect((await nop(t, sai)).status).toBe(422);
    const m = await trongDotBien(
      t.org,
      [await defDotBien(HAM_K2, "AND e.loai = CASE WHEN so_moi = 1 THEN 'SINGLE_SOURCE' ELSE 'LIMITED_COMPETITION' END", "")],
      (c) => hoiK2(c, t.org, sai),
    );
    expect(m).toBeNull();
  });

  it("[INV-K2] danh sách RỖNG: `SINGLE_SOURCE` không cứu; ĐỘT BIẾN bỏ vế ngoại lệ còn sống ⇒ ngoại lệ đã rút cứu được", async () => {
    const t = await taoToChuc();
    const rong = await goiNhap(t);
    // Danh sách rỗng không lập được ngoại lệ có nghĩa — đo bằng hàm vị từ trên gói có một ngoại lệ rồi thu hồi lời mời duy nhất.
    const l = await moi(t, rong, await ncc(t));
    await lapNl(t, rong, "SINGLE_SOURCE");
    await thuHoi(t, l, t.pm);
    expect(await chotK2(t, rong)).toBe("K2_THIEU_CANH_TRANH");
    const daRut = await goiNhap(t);
    await moiDemDuoc(t, daRut, 1);
    await rutNl(t, daRut, await lapNl(t, daRut, "SINGLE_SOURCE"));
    expect(await chotK2(t, daRut)).toBe("K2_THIEU_CANH_TRANH");
    const dotBien = await defDotBien(
      HAM_K2,
      "AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r\n                                     WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)",
      "",
    );
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK2(c, t.org, daRut))).toBeNull();
  });
});

// =============================================================================================
// ⑸ BẬC ĐẤU THẦU CHÍNH THỨC
// =============================================================================================
describe("[S1.269 / S3.3c2 / K2] bậc đấu thầu chính thức không bao giờ qua", () => {
  it("[INV-K2] ước lượng 20 tỷ, năm nhà cung cấp đếm được VÀ một ngoại lệ ⇒ 422 + CONTROL_DENIED {K2_DAU_THAU_CHINH_THUC}; ĐỘT BIẾN bỏ vế ấy ⇒ hàm theo bậc NÉM (bậc thiếu ngưỡng)", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t, GIA_DTCT);
    await moiDemDuoc(t, rfqId, 5);
    await lapNl(t, rfqId, "LIMITED_COMPETITION");
    const r = await nop(t, rfqId);
    expect([r.status, r.body.error]).toEqual([422, TD_DTCT]);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K2_DAU_THAU_CHINH_THUC", actorId: t.pm.u }]);
    const dotBien = await defDotBien(
      HAM_K2,
      "IF (bac ->> 'dau_thau_chinh_thuc')::boolean IS NOT FALSE THEN\n    RETURN 'K2_DAU_THAU_CHINH_THUC';\n  END IF;",
      "",
    );
    expect(await loi(trongDotBien(t.org, [dotBien], (c) => hoiK2(c, t.org, rfqId)))).toMatchObject({ code: "23514", message: expect.stringMatching(/thieu so_ncc_toi_thieu/u) as unknown });
  });
});

// =============================================================================================
// ⑹ READ COMMITTED VÀ ĐUA
// =============================================================================================
describe("[S1.269 / S3.3c2 / K2] chỉ READ COMMITTED; lần rút ngoại lệ chen trước câu nộp được thấy", () => {
  it("[INV-K2] câu nộp dưới REPEATABLE READ hay SERIALIZABLE ⇒ trigger chặn ở tổ chức ĐÃ bật VÀ chưa bật (khoản 286 ⑴); READ COMMITTED đi qua; ĐỘT BIẾN bỏ vế ấy ⇒ RR đi qua", async () => {
    for (const daBat of [true, false]) {
      const t = await taoToChuc(daBat);
      const rfqId = await goiNhap(t);
      if (daBat) await moiDemDuoc(t, rfqId, 2);
      for (const capCach of ["REPEATABLE READ", "SERIALIZABLE"]) {
        const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_NOP_THO, [rfqId, t.pm.u, t.pm.s]), capCach));
        expect([daBat, capCach, e?.code, e?.message]).toEqual([
          daBat,
          capCach,
          "23514",
          expect.stringContaining(`chi nhan duoi READ COMMITTED (giao dich dang o ${capCach.toLowerCase()})`),
        ]);
      }
      const qua = await trongDotBien(t.org, [], (c) => c.query(CAU_NOP_THO, [rfqId, t.pm.u, t.pm.s]));
      expect(qua.rowCount).toBe(1);
      const dotBien = await defDotBien("public.rfq_kiem_so_ncc_khi_nop()", "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN", "IF false THEN");
      // [S1.270 / S3.3d] Trigger K3 ở cùng cạnh mang chốt READ COMMITTED RIÊNG — gỡ cả hai thì câu RR mới đi qua.
      const dotBienK3 = await defDotBien("public.rfq_kiem_xoay_vong_khi_nop()", "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN", "IF false THEN");
      const rr = await trongDotBien(t.org, [dotBien, dotBienK3], (c) => c.query(CAU_NOP_THO, [rfqId, t.pm.u, t.pm.s]), "REPEATABLE READ");
      expect(rr.rowCount).toBe(1);
    }
  });

  it("[INV-K2] đua: giao dịch B rút ngoại lệ (giữ FOR SHARE hàng gói), A nộp duyệt CHỜ khoá; B COMMIT ⇒ A thấy lần rút và bị K2 chặn", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await moiDemDuoc(t, rfqId, 1);
    const nl = await lapNl(t, rfqId, "SINGLE_SOURCE");
    const cRut = await moGiaoDich(t.org);
    const cNop = await moGiaoDich(t.org);
    try {
      await cRut.query(
        "INSERT INTO public.rfq_sourcing_exceptions (org_id, rfq_id, hanh_dong, ngoai_le_id, giai_trinh, created_by, created_by_session_id) VALUES ($1, $2, 'RUT', $3, 'rut', $4, $5)",
        [t.org, rfqId, nl, t.pm.u, t.pm.s],
      );
      const pidNop = (await cNop.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      const nopXong = loi(cNop.query(CAU_NOP_THO, [rfqId, t.pm.u, t.pm.s]));
      await choKhoaHang(pidNop);
      await cRut.query("COMMIT");
      expect(await nopXong).toMatchObject({ code: "23514", constraint: "k2_canh_tranh_toi_thieu" });
    } finally {
      await cNop.query("ROLLBACK").catch(() => undefined);
      await cRut.query("ROLLBACK").catch(() => undefined);
      cNop.release();
      cRut.release();
    }
    expect(await trangThai(rfqId)).toBe("DRAFT");
  });
});

// =============================================================================================
// ⑺ K5 — CHỮ KÝ ĐỘC LẬP Ở CẠNH MỞ GÓI
// =============================================================================================
describe("[S1.269 / S3.3c2 / K5] bậc ký danh sách hay gói có ngoại lệ cần một chữ ký ngoài tập loại trừ", () => {
  /** Gói bậc 1 (cần 3, ký danh sách) đã nộp, do `pm` tạo; `chuanBi` thêm hành vi của người chọn trước khi nộp. */
  async function goiBac1(t: ToChuc, chuanBi?: (rfqId: string) => Promise<void>, giaTri = GIA_BAC1): Promise<string> {
    const rfqId = await goiNhap(t, giaTri);
    await moiDemDuoc(t, rfqId, 3);
    if (chuanBi !== undefined) await chuanBi(rfqId);
    const r = await nop(t, rfqId);
    expect(r.status, r.text).toBe(200);
    return rfqId;
  }

  it("[INV-K5] ĐỐI CHỨNG DƯƠNG: người ký độc lập (pm2) ⇒ mở 200, không CONTROL_DENIED", async () => {
    const t = await taoToChuc();
    const rfqId = await goiBac1(t);
    await duyet(t, rfqId, t.pm2);
    expect((await mo(t, rfqId)).status).toBe(200);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  const NGUON: readonly { readonly ten: string; readonly lam: (t: ToChuc, rfqId: string) => Promise<void> }[] = [
    { ten: "người MỜI", lam: async (t, rfqId) => void (await moi(t, rfqId, await ncc(t), t.pm3)) },
    {
      ten: "người THU HỒI",
      lam: async (t, rfqId) => {
        const l = await moi(t, rfqId, await ncc(t));
        await thuHoi(t, l, t.pm3);
      },
    },
    { ten: "người DỰNG một nhà cung cấp trên danh sách", lam: async (t, rfqId) => void (await moi(t, rfqId, await ncc(t, { nhap: t.pm3 }))) },
    { ten: "TÁC GIẢ ngoại lệ còn sống", lam: async (t, rfqId) => void (await lapNl(t, rfqId, "LIMITED_COMPETITION", t.pm3)) },
  ];
  for (const nguon of NGUON) {
    it(`[INV-K5] chữ ký DUY NHẤT của ${nguon.ten} ⇒ mở 422 mang câu của chốt, MỘT hàng CONTROL_DENIED {K5_THIEU_CHU_KY_DOC_LAP}, không khoá; thêm chữ ký pm2 ⇒ mở 200`, async () => {
      const t = await taoToChuc();
      const rfqId = await goiBac1(t, (id) => nguon.lam(t, id));
      await duyet(t, rfqId, t.pm3);
      const r = await mo(t, rfqId);
      expect([r.status, r.body.error]).toEqual([422, TD_K5]);
      expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K5_THIEU_CHU_KY_DOC_LAP", actorId: t.pm.u }]);
      expect((await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [rfqId])).rowCount, "từ chối TRƯỚC lần đúc khoá").toBe(0);
      await duyet(t, rfqId, t.pm2);
      expect((await mo(t, rfqId)).status).toBe(200);
    });
  }

  it("[INV-K5] ĐỘT BIẾN bỏ vế tập loại trừ ⇒ chữ ký của người mời mở được gói", async () => {
    const t = await taoToChuc();
    const rfqId = await goiBac1(t, async (id) => void (await moi(t, id, await ncc(t), t.pm3)));
    await duyet(t, rfqId, t.pm3);
    const dotBien = await defDotBien(HAM_K5, "WHERE NOT EXISTS (SELECT 1 FROM public.rfq_tap_loai_tru(p_org, p_rfq) t(n) WHERE t.n = k.n)", "WHERE true");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK5(c, t.org, rfqId))).toBeNull();
  });

  it("[INV-K5] bậc KHÔNG ký danh sách: không ngoại lệ ⇒ chữ ký của người mời mở được; CÓ ngoại lệ còn sống ⇒ 422 K5 — một ngoại lệ không bao giờ tự duyệt (spec §4.4); ĐỘT BIẾN bỏ vế ngoại lệ ⇒ mở được", async () => {
    const t = await taoToChuc();
    const khong = await goiNhap(t, GIA_NHO);
    await moiDemDuoc(t, khong, 2);
    await moi(t, khong, await ncc(t), t.pm3);
    expect((await nop(t, khong)).status).toBe(200);
    await duyet(t, khong, t.pm3);
    expect((await mo(t, khong)).status).toBe(200);
    const co = await goiNhap(t, GIA_NHO);
    await moiDemDuoc(t, co, 1);
    await lapNl(t, co, "SINGLE_SOURCE", t.pm3);
    expect((await nop(t, co)).status).toBe(200);
    await duyet(t, co, t.pm3);
    const r = await mo(t, co);
    expect([r.status, r.body.error]).toEqual([422, TD_K5]);
    const dotBien = await defDotBien(HAM_K5, "IF NOT ky\n     AND NOT EXISTS", "IF NOT ky\n     OR NOT EXISTS");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK5(c, t.org, co))).toBeNull();
    await duyet(t, co, t.pm2);
    expect((await mo(t, co)).status).toBe(200);
  });

  it("[INV-K5] gói cấp kép: người mời + người thu hồi ký ⇒ 422 K5; người mời + pm2 ⇒ mở 200", async () => {
    const t = await taoToChuc();
    const rfqId = await goiBac1(
      t,
      async (id) => {
        await moi(t, id, await ncc(t), t.pm3);
        const l = await moi(t, id, await ncc(t));
        await thuHoi(t, l, t.pm4);
      },
      GIA_KEP,
    );
    await duyet(t, rfqId, t.pm3);
    await duyet(t, rfqId, t.pm4);
    const r = await mo(t, rfqId);
    expect([r.status, r.body.error]).toEqual([422, TD_K5]);
    await duyet(t, rfqId, t.pm2);
    expect((await mo(t, rfqId)).status).toBe(200);
  });

  it("[INV-K5] CHƯA ĐỦ chữ ký (chưa ai ký) ⇒ K4b nói, KHÔNG hàng CONTROL_DENIED (đi sai thứ tự — ADR-060); ĐỘT BIẾN bỏ vế ấy ⇒ hàm vị từ trả mã K5", async () => {
    const t = await taoToChuc();
    const rfqId = await goiBac1(t, async (id) => void (await moi(t, id, await ncc(t), t.pm3)));
    const r = await mo(t, rfqId);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/\((D2, san mot chu ky|K4b)\)/u);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
    const dotBien = await defDotBien(HAM_K5, "IF (SELECT count(*) FROM public.rfq_chu_ky_con_hieu_luc(p_org, p_rfq)) < can THEN", "IF false THEN");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK5(c, t.org, rfqId))).toBe("K5_THIEU_CHU_KY_DOC_LAP");
  });

  it("[INV-K5] lớp chặn cuối: câu mở viết tay dưới `app_api` ⇒ 23514 mang tên `k5_chu_ky_doc_lap` (trước cả trigger khoá — tên xếp trước); ĐỘT BIẾN tắt trigger ⇒ câu đi tới trigger khoá", async () => {
    const t = await taoToChuc();
    const rfqId = await goiBac1(t, async (id) => void (await moi(t, id, await ncc(t), t.pm3)));
    await duyet(t, rfqId, t.pm3);
    const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_MO_THO, [rfqId, t.pm.u, t.pm.s])));
    expect(e).toMatchObject({ code: "23514", constraint: "k5_chu_ky_doc_lap", message: "Goi thau chua mo duoc (K5): K5_THIEU_CHU_KY_DOC_LAP" });
    const e2 = await loi(
      trongDotBien(t.org, ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_doc_lap_khi_mo"], (c) => c.query(CAU_MO_THO, [rfqId, t.pm.u, t.pm.s])),
    );
    expect(e2?.constraint ?? "").not.toBe("k5_chu_ky_doc_lap");
    expect(e2, "không còn K5 thì câu dừng ở trigger khác (khoá C5)").not.toBeNull();
  });
});

describe("[S1.269 / S3.3c2 / K2 · K5] gói KHÔNG bậc ghim (bậc NULL — dữ liệu trước lần bật, hay trigger xếp bậc bị tắt)", () => {
  it("[INV-K2] [INV-K5] K2 nhường lời cho K1 (`BAC_LECH_HAM_PHAN_BAC`); K5 coi như bậc ĐÒI ký danh sách — chữ ký của người mời không mở được; ĐỘT BIẾN coi bậc vắng là KHÔNG đòi ⇒ cho qua", async () => {
    const t = await taoToChuc();
    const nhap = await goiNhap(t);
    await moiDemDuoc(t, nhap, 2);
    const xoaBac = [
      "ALTER TABLE public.rfq_budgets DISABLE TRIGGER USER",
      `UPDATE public.rfq_budgets SET tier_tu_so_tien = NULL WHERE rfq_id = '${nhap}'`,
    ];
    const kq = await trongDotBien(t.org, xoaBac, async (c) => [
      await hoiK2(c, t.org, nhap),
      (await c.query<{ m: string | null }>("SELECT public.rfq_chot_ngan_sach($1, $2, pg_catalog.clock_timestamp()) AS m", [t.org, nhap])).rows[0]!.m,
    ]);
    expect(kq).toEqual([null, "BAC_LECH_HAM_PHAN_BAC"]);
    // K5: gói bậc 0 (không ký danh sách), không ngoại lệ, người mời pm3 ký — bình thường cho qua. Băm ngân sách phủ bậc, nên bậc
    // vắng mô phỏng bằng hàm bậc ghim trả NULL (chữ ký vẫn còn hiệu lực), không bằng xoá cột.
    const cho = await goiNhap(t, GIA_NHO);
    await moiDemDuoc(t, cho, 2);
    await moi(t, cho, await ncc(t), t.pm3);
    expect((await nop(t, cho)).status).toBe(200);
    await duyet(t, cho, t.pm3);
    expect(await trongDotBien(t.org, [], (c) => hoiK5(c, t.org, cho))).toBeNull();
    const khongBac = await defDotBien("public.rfq_bac_ghim(uuid, uuid)", "IF NOT FOUND OR bac_luu IS NULL THEN", "IF true THEN");
    expect(await trongDotBien(t.org, [khongBac], (c) => hoiK5(c, t.org, cho))).toBe("K5_THIEU_CHU_KY_DOC_LAP");
    const voiVang = await defDotBien(HAM_K5, "coalesce((bac ->> 'ky_danh_sach_moi')::boolean, true)", "coalesce((bac ->> 'ky_danh_sach_moi')::boolean, false)");
    expect(await trongDotBien(t.org, [khongBac, voiVang], (c) => hoiK5(c, t.org, cho))).toBeNull();
  });
});

// =============================================================================================
// ⑻ ĐỐI CHỨNG MVP1 VÀ TỪ VỰNG
// =============================================================================================
describe("[S1.269 / S3.3c2] tổ chức chưa bật chạy như MVP1; tập mã khớp bảng", () => {
  it("[INV-K2] [INV-K5] tổ chức CHƯA bật: nộp không lời mời nào ⇒ 200; mở với chữ ký pm2 ⇒ 200; không CONTROL_DENIED; hai hàm vị từ trả NULL", async () => {
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    expect(await chotK2(t, rfqId)).toBeNull();
    expect((await nop(t, rfqId)).status).toBe(200);
    await duyet(t, rfqId, t.pm2);
    expect((await mo(t, rfqId)).status).toBe(200);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  it("mã của `rfq_chot_canh_tranh` BẰNG các dòng K2 của `CHOT_VAO_SO`, mã của `rfq_chot_chu_ky_doc_lap` BẰNG các dòng K5; cả ba vào sổ", async () => {
    for (const [ham, chot] of [
      [HAM_K2, "K2"],
      [HAM_K5, "K5"],
    ] as const) {
      const src = (await db.pool.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = $1::regprocedure", [ham])).rows[0]!.s;
      const trongHam = [...src.matchAll(/RETURN '([A-Z0-9_]+)'/gu)].map((m) => m[1]!).sort();
      const trongBang = Object.entries(CHOT_VAO_SO)
        .filter(([, d]) => d.chot === chot)
        .map(([ma]) => ma)
        .sort();
      expect(trongHam.length, "bộ đọc không thấy mã nào — đang mù").toBeGreaterThan(0);
      expect(trongHam).toEqual(trongBang);
      for (const ma of trongBang) expect(CHOT_VAO_SO[ma as keyof typeof CHOT_VAO_SO].vaoSo, ma).toBe(true);
    }
  });
});
