// ==============================================================================================
// [S1.270 / S3.3d · spec S3 §2.5 ⒀, §5 K3, §5.1 K3 · ADR-058 ⑶(b) · K3 · K12] XOAY VÒNG NHÀ CUNG CẤP — PHÉP ĐO TRÊN POSTGRES 16,
// QUA HTTP VÀ DƯỚI `app_api`
//
// Migration `108_xoay_vong`, ba lần hỏi của `packages/rfq` (`submitRfqForApproval`, `openRfq` kèm khoá chính sách). Bậc 1 của tệp
// này có `xoay_vong_n` = 2, `so_ncc_toi_thieu` = 1, không ký danh sách; bậc 0 có `xoay_vong_n` = 0. Hợp đồng đo ở đây:
//   ⑴ đối chứng dương: gói mời lại nhà cung cấp của gói trước ⇒ `422` mang câu của chốt, MỘT hàng `CONTROL_DENIED {K3_KHONG_XOAY_VONG}`;
//      thêm một nhà cung cấp mới ⇒ đi;
//   ⑵ cửa sổ: chỉ gói ĐÃ MỞ, đúng N suất gần nhất; gói không chiếm suất (bậc `xoay_vong_n` = 0, đã huỷ) vẫn góp nhà cung cấp cũ khi
//      nằm trong khoảng của N suất, không góp khi mở trước suất xa nhất; lời mời thêm SAU KHI KÝ không cho chiếm suất ở gói đồng
//      nghiệp (lượt soi hình dạng, CAO) nhưng vẫn làm nhà cung cấp thành cũ; lời mời thu hồi trước lúc mở không tính;
//   ⑶ người chọn: người tạo, người mời, người thu hồi của gói đang xét;
//   ⑷ khoá nhóm: MST gốc, email của người liên hệ phụ, chín số cuối điện thoại; nhà cung cấp mới phải ĐẾM ĐƯỢC;
//   ⑸ ngoại lệ ROTATION còn sống cứu, đã rút thì không; bậc `xoay_vong_n` = 0 tắt K3;
//   ⑹ cạnh mở: hai gói nộp song song cùng một bộ nhà cung cấp — mở cái đầu thì cái sau bị chặn; hai lần mở đồng thời xếp hàng ở khoá
//      chính sách; `opened_at` khác giờ của lần mở bị chặn ở tổ chức đã bật (khoản 319); READ COMMITTED ở cả hai cạnh; lớp chặn cuối;
//   ⑺ tổ chức chưa bật chạy như MVP1; tập mã của hàm vị từ BẰNG dòng K3 của `CHOT_VAO_SO`.
// Mỗi vế của hàm cửa sổ và hàm vị từ có một ĐỘT BIẾN trong chính tệp này (áp trong một giao dịch rồi ROLLBACK).
// ==============================================================================================
import { createHash, generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import { createInvitation, lapNgoaiLe, revokeInvitation, rutNgoaiLe } from "@trustprocure/invitation";
import { addRfqItem, approveRfq, cancelRfq, createProcurementPolicy, createRfq, openRfq, setRfqBudget } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TD_K3 = CHOT_VAO_SO.K3_KHONG_XOAY_VONG.thongDiep;
const GIAI_TRINH = "Nha cung cap quen da tung trung thau, ly do luan phien: chi ho co kho hang trong ban kinh giao trong ngay.";

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `ngoai-le-canh-tranh.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo cạnh mở gói.
const boBocGia = {
  name: "gia-cho-test-xoay-vong",
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
/** Bậc 0 (dưới 100 triệu) không xoay vòng; bậc 1 xoay vòng N = 2; từ 10 tỷ đấu thầu chính thức. Mỗi bậc một nhà cung cấp là đủ K2. */
const BAC = [
  { tu_so_tien: 0, so_ncc_toi_thieu: 1, ky_danh_sach_moi: false, ...BAC_THUONG },
  { tu_so_tien: 100_000_000, so_ncc_toi_thieu: 1, ky_danh_sach_moi: false, ...BAC_THUONG, xoay_vong_n: 2 },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];
/** Bậc 0, nhỏ — vài gói cùng nhóm hàng không chạm cận 100 triệu, để tín hiệu chia nhỏ (K10a) không chen vào. */
const GIA_BAC0 = "10000000.00";
const GIA_BAC1 = "200000000.00";

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
  /** PROCUREMENT_MANAGER — người chọn thứ hai trong các ca đo. */
  readonly pm3: Nguoi;
  /** PROCUREMENT_MANAGER — người chọn thứ ba trong các ca đo. */
  readonly pm4: Nguoi;
  /** BUYER — người tạo gói ở các ca *người tạo*. */
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
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`xv-${randomBytes(4).toString("hex")}`]);
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
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "1000000000.00", currency: "VND", actorSessionId: pm.s }, auditPool),
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
    await db.pool.query(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) VALUES ($1, $2, 'Lien he phu', $3, $4, $5, $6)",
      [t.org, id, p.email ?? `phu${randomBytes(6).toString("hex")}@vidu.vn`, p.phone === undefined ? dtNgauNhien() : p.phone, ai.u, ai.s],
    );
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

async function moGiaoDich(org: string, capCach = "READ COMMITTED"): Promise<pg.PoolClient> {
  const c = await apiPool.connect();
  await c.query(`BEGIN ISOLATION LEVEL ${capCach}`);
  await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
  return c;
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

// ---- Riêng của K3 ----------------------------------------------------------------------------
const HAM_MOI = "public.rfq_ncc_moi_xoay_vong(uuid, uuid, integer)";
const HAM_K3 = "public.rfq_chot_xoay_vong(uuid, uuid)";

const hoiK3 = async (c: pg.PoolClient, org: string, rfqId: string): Promise<string | null> =>
  (await c.query<{ m: string | null }>("SELECT public.rfq_chot_xoay_vong($1, $2) AS m", [org, rfqId])).rows[0]!.m;

async function chotK3(t: ToChuc, rfqId: string): Promise<string | null> {
  return withTenant(apiPool, t.org, (c) => hoiK3(c, t.org, rfqId));
}

/** Câu nộp và câu mở viết tay dưới `app_api` — không qua lần hỏi trước của gói. */
const CAU_NOP_THO =
  "UPDATE public.rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1 AND status = 'DRAFT'";
const CAU_MO_THO =
  "UPDATE public.rfq_packages SET status = 'OPEN', opened_by = $2, opened_by_session_id = $3, opened_at = $4::timestamptz WHERE id = $1";
/** Câu mở thô cần vật liệu khoá (C5, `017`); ca đo lớp CSDL tắt riêng trigger ấy trong giao dịch đột biến. */
const TAT_KHOA = "ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_khoa_khi_mo";

/** Gói ĐÃ MỞ: tạo (bởi `taoBoi`), mời danh sách (bởi `moiBoi`), nộp, `pm2` duyệt, mở — mỗi bước phải đi. */
async function goiMo(
  t: ToChuc,
  ds: readonly Ncc[],
  o: { readonly gia?: string; readonly taoBoi?: Nguoi; readonly moiBoi?: Nguoi } = {},
): Promise<string> {
  const taoBoi = o.taoBoi ?? t.pm;
  const rfqId = await goiNhap(t, o.gia ?? GIA_BAC1, taoBoi);
  for (const n of ds) await moi(t, rfqId, n, o.moiBoi ?? taoBoi);
  const r = await nop(t, rfqId, taoBoi);
  expect(r.status, r.text).toBe(200);
  await duyet(t, rfqId, t.pm2);
  const m = await mo(t, rfqId);
  expect(m.status, m.text).toBe(200);
  return rfqId;
}

/** Gói DRAFT bậc 1 mời danh sách; trả id. */
async function goiCho(t: ToChuc, ds: readonly Ncc[], o: { readonly taoBoi?: Nguoi; readonly moiBoi?: Nguoi; readonly gia?: string } = {}): Promise<string> {
  const taoBoi = o.taoBoi ?? t.pm;
  const rfqId = await goiNhap(t, o.gia ?? GIA_BAC1, taoBoi);
  for (const n of ds) await moi(t, rfqId, n, o.moiBoi ?? taoBoi);
  return rfqId;
}

async function huy(t: ToChuc, rfqId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => cancelRfq(c, t.org, { rfqId, reason: "huy de do cua so", actorSessionId: t.pm.s }, auditPool));
}

async function soMoi(t: ToChuc, rfqId: string, n = 2): Promise<number> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ n: number }>("SELECT public.rfq_ncc_moi_xoay_vong($1, $2, $3) AS n", [t.org, rfqId, n]),
  );
  return rows[0]!.n;
}

/** Nộp bị K3 chặn: `422` mang câu của chốt, một hàng `CONTROL_DENIED` dưới người nộp, gói ở DRAFT. */
async function nopBiChan(t: ToChuc, rfqId: string, ai: Nguoi = t.pm): Promise<void> {
  const r = await nop(t, rfqId, ai);
  expect([r.status, r.body.error], r.text).toEqual([422, TD_K3]);
  expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K3_KHONG_XOAY_VONG", actorId: ai.u }]);
  expect(await trangThai(rfqId)).toBe("DRAFT");
}

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

// =============================================================================================
// ⑴ ĐỐI CHỨNG DƯƠNG VÀ LỜI TỪ CHỐI CÓ TÊN
// =============================================================================================
describe("[S1.270 / S3.3d / K3] danh sách phải có một nhà cung cấp mới", () => {
  it("[INV-K3] mời lại nhà cung cấp của gói vừa mở ⇒ 422 mang câu của chốt và MỘT hàng CONTROL_DENIED; thêm một nhà cung cấp mới ⇒ 200, không hàng nào", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g]);
    const p = await goiCho(t, [g]);
    expect(await soMoi(t, p)).toBe(0);
    await nopBiChan(t, p);
    await moi(t, p, await ncc(t));
    expect(await soMoi(t, p)).toBe(1);
    expect((await nop(t, p)).status).toBe(200);
    expect(await tuChoiChot(t.org, p), "đường thuận không ghi thêm").toHaveLength(1);
  });

  it("[INV-K3] lớp chặn cuối ở cạnh nộp: câu viết tay dưới `app_api` ⇒ 23514 `k3_xoay_vong`; ĐỘT BIẾN tắt trigger ⇒ cùng câu đi qua", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g]);
    const p = await goiCho(t, [g]);
    const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_NOP_THO, [p, t.pm.u, t.pm.s])));
    expect(e).toMatchObject({ code: "23514", constraint: "k3_xoay_vong", message: "Goi thau chua roi DRAFT duoc (K3): K3_KHONG_XOAY_VONG" });
    const qua = await trongDotBien(t.org, ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_xoay_vong_khi_nop"], (c) =>
      c.query(CAU_NOP_THO, [p, t.pm.u, t.pm.s]),
    );
    expect(qua.rowCount).toBe(1);
  });
});

// =============================================================================================
// ⑵ CỬA SỔ
// =============================================================================================
describe("[S1.270 / S3.3d / K3] cửa sổ: N suất gần nhất của người chọn, chỉ gói đã mở", () => {
  it("[INV-K3] N = 2: G ở suất thứ ba trở về trước là mới; X ở suất thứ hai là cũ; ĐỘT BIẾN nới cửa sổ thêm một suất ⇒ G cũ", async () => {
    const t = await taoToChuc();
    const [g, x, y] = [await ncc(t), await ncc(t), await ncc(t)];
    await goiMo(t, [g]);
    await goiMo(t, [x]);
    await goiMo(t, [y]);
    const pg1 = await goiCho(t, [g]);
    expect(await soMoi(t, pg1)).toBe(1);
    const px = await goiCho(t, [x]);
    expect(await soMoi(t, px)).toBe(0);
    const dotBien = await defDotBien(HAM_MOI, "WHERE s.thu_tu <= p_n", "WHERE s.thu_tu <= p_n + 1");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, pg1))).toBe("K3_KHONG_XOAY_VONG");
    expect((await nop(t, pg1)).status).toBe(200);
  });

  it("[INV-K3] gói CHƯA mở — nháp hay đang chờ duyệt — không vào cửa sổ, không chiếm suất; ĐỘT BIẾN bỏ vế `opened_at` ⇒ hai gói chưa mở chiếm hai suất với mốc NULL, cửa sổ rỗng và G cũ thành mới (fail-open)", async () => {
    const t = await taoToChuc();
    const [g, z] = [await ncc(t), await ncc(t)];
    await goiMo(t, [g]);
    await goiCho(t, [z]);
    const cho = await goiCho(t, [await ncc(t)]);
    expect((await nop(t, cho)).status).toBe(200);
    expect(await soMoi(t, await goiCho(t, [z])), "Z chỉ ở gói nháp").toBe(1);
    const p = await goiCho(t, [g]);
    expect(await soMoi(t, p)).toBe(0);
    const dotBien = await defDotBien(HAM_MOI, "p.id <> p_rfq AND p.opened_at IS NOT NULL", "p.id <> p_rfq");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBeNull();
  });

  it("[INV-K3] gói bậc 0 (N = 0) không chiếm suất nhưng góp nhà cung cấp cũ khi mở SAU suất xa nhất; mở TRƯỚC thì không; ĐỘT BIẾN cho gói bậc 0 chiếm suất ⇒ G mới", async () => {
    const t = await taoToChuc();
    const [g, a, b, z] = [await ncc(t), await ncc(t), await ncc(t), await ncc(t)];
    await goiMo(t, [z], { gia: GIA_BAC0 });
    await goiMo(t, [g]);
    await goiMo(t, [a], { gia: GIA_BAC0 });
    await goiMo(t, [b], { gia: GIA_BAC0 });
    const pg1 = await goiCho(t, [g]);
    expect(await soMoi(t, pg1), "G: suất duy nhất").toBe(0);
    expect(await soMoi(t, await goiCho(t, [a])), "A: gói đệm trong khoảng").toBe(0);
    expect(await soMoi(t, await goiCho(t, [z])), "Z: gói đệm mở trước suất xa nhất").toBe(1);
    const dotBien = await defDotBien(HAM_MOI, "\n       AND coalesce((public.rfq_bac_ghim(p_org, g.id) ->> 'xoay_vong_n')::integer, 0) > 0", "");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, pg1))).toBeNull();
  });

  it("[INV-K3] gói mở rồi HUỶ không chiếm suất nhưng góp nhà cung cấp cũ; ĐỘT BIẾN cho gói huỷ chiếm suất ⇒ G mới", async () => {
    const t = await taoToChuc();
    const [g, x, y] = [await ncc(t), await ncc(t), await ncc(t)];
    await goiMo(t, [g]);
    await huy(t, await goiMo(t, [x]));
    await huy(t, await goiMo(t, [y]));
    const pg1 = await goiCho(t, [g]);
    expect(await soMoi(t, pg1)).toBe(0);
    expect(await soMoi(t, await goiCho(t, [x]))).toBe(0);
    const dotBien = await defDotBien(HAM_MOI, "WHERE g.status <> 'CANCELLED'", "WHERE true");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, pg1))).toBeNull();
  });

  it("[INV-K3] lời mời thêm SAU KHI KÝ không cho chiếm suất ở gói đồng nghiệp (lượt soi, CAO); ĐỘT BIẾN bỏ vế `moi_sau_khi_ky` ⇒ G mới", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g], { moiBoi: t.pm3 });
    for (let i = 0; i < 2; i += 1) {
      const q = await goiMo(t, [await ncc(t)], { taoBoi: t.pm4 });
      await moi(t, q, await ncc(t), t.pm3);
    }
    const p = await goiCho(t, [g], { taoBoi: t.pm3 });
    expect(await soMoi(t, p)).toBe(0);
    await nopBiChan(t, p, t.pm3);
    const dotBien = await defDotBien(HAM_MOI, "\n                      AND NOT j.moi_sau_khi_ky", "");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBeNull();
  });

  it("[INV-K3] nhà cung cấp mời SAU KHI KÝ vào gói trong cửa sổ vẫn là cũ; ĐỘT BIẾN chỉ tính lời mời trước ký ⇒ mới", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    const p1 = await goiMo(t, [await ncc(t)]);
    await moi(t, p1, g);
    const p = await goiCho(t, [g]);
    expect(await soMoi(t, p)).toBe(0);
    const dotBien = await defDotBien(
      HAM_MOI,
      "WHERE j.revoked_at IS NULL OR j.revoked_at >= w.opened_at",
      "WHERE NOT j.moi_sau_khi_ky AND (j.revoked_at IS NULL OR j.revoked_at >= w.opened_at)",
    );
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBeNull();
  });

  it("[INV-K3] lời mời THU HỒI trước lúc mở không làm nhà cung cấp thành cũ; ĐỘT BIẾN bỏ vế thu hồi ⇒ cũ", async () => {
    const t = await taoToChuc();
    const [g, x] = [await ncc(t), await ncc(t)];
    const p1 = await goiNhap(t, GIA_BAC1);
    const lg = await moi(t, p1, g);
    await moi(t, p1, x);
    await thuHoi(t, lg, t.pm);
    expect((await nop(t, p1)).status).toBe(200);
    await duyet(t, p1, t.pm2);
    expect((await mo(t, p1)).status).toBe(200);
    const p = await goiCho(t, [g]);
    expect(await soMoi(t, p)).toBe(1);
    expect(await soMoi(t, await goiCho(t, [x]))).toBe(0);
    const dotBien = await defDotBien(HAM_MOI, "WHERE j.revoked_at IS NULL OR j.revoked_at >= w.opened_at", "WHERE true");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBe("K3_KHONG_XOAY_VONG");
  });
});

// =============================================================================================
// ⑶ NGƯỜI CHỌN
// =============================================================================================
describe("[S1.270 / S3.3d / K3] người chọn: người tạo, người mời, người thu hồi", () => {
  it("[INV-K3] NGƯỜI TẠO nhờ đồng nghiệp bấm mời: gói trước của người tạo (G do pm3 mời) làm G cũ dù người mời lần này (pm4) chưa từng mời G; ĐỘT BIẾN bỏ vế người tạo ⇒ mới", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g], { taoBoi: t.mua, moiBoi: t.pm3 });
    const p = await goiCho(t, [g], { taoBoi: t.mua, moiBoi: t.pm4 });
    expect(await soMoi(t, p)).toBe(0);
    await nopBiChan(t, p, t.mua);
    const dotBien = await defDotBien(HAM_MOI, "WHERE p.created_by = c.u\n        OR EXISTS", "WHERE EXISTS");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBeNull();
  });

  it("[INV-K3] NGƯỜI THU HỒI: pm3 (từng mời G) thu hồi một lời mời của gói ⇒ cửa sổ của pm3 vào phép xét, G cũ; ĐỘT BIẾN bỏ vế người thu hồi ⇒ mới", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g], { taoBoi: t.pm3 });
    const p = await goiCho(t, [g], { moiBoi: t.pm4 });
    const l = await moi(t, p, await ncc(t), t.pm4);
    await thuHoi(t, l, t.pm3);
    expect(await soMoi(t, p)).toBe(0);
    const dotBien = await defDotBien(HAM_MOI, "SELECT i.revoked_by FROM public.rfq_invitations i", "SELECT NULL::uuid FROM public.rfq_invitations i");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBeNull();
  });
});

// =============================================================================================
// ⑷ KHOÁ NHÓM VÀ *ĐẾM ĐƯỢC*
// =============================================================================================
describe("[S1.270 / S3.3d / K3] cùng một nhà cung cấp theo khoá nhóm; nhà cung cấp mới phải đếm được", () => {
  it("[INV-K3] bản ghi mới cùng MST gốc (mã chi nhánh), cùng email ở người liên hệ phụ, cùng chín số cuối điện thoại ⇒ cũ; ĐỘT BIẾN bỏ từng khoá ⇒ mới", async () => {
    const t = await taoToChuc();
    const mst = `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
    const email = `quen${randomBytes(4).toString("hex")}@vidu.vn`;
    const duoi = String(randomInt(0, 1e8)).padStart(8, "0");
    await goiMo(t, [await ncc(t, { mst, email, phone: `09${duoi}` })]);
    const theoMst = await goiCho(t, [await ncc(t, { mst: `${mst}-001` })]);
    const theoEmail = await goiCho(t, [await ncc(t, { lienHePhu: [{ email }] })]);
    const theoDt = await goiCho(t, [await ncc(t, { phone: `+849${duoi}` })]);
    for (const p of [theoMst, theoEmail, theoDt]) expect(await soMoi(t, p)).toBe(0);
    const bo = async (cu: string, moiChuoi: string, p: string): Promise<string | null> =>
      trongDotBien(t.org, [await defDotBien(HAM_MOI, cu, moiChuoi)], (c) => hoiK3(c, t.org, p));
    expect(await bo("'M|' || left(s.tax_code, 10)", "'M|' || s.id::text", theoMst)).toBeNull();
    expect(await bo("'E|' || k.email", "'E|' || k.id::text", theoEmail)).toBeNull();
    expect(await bo("'P|' || right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 9)", "'P|' || k.id::text", theoDt)).toBeNull();
  });

  it("[INV-K3] nhà cung cấp mới tinh mà KHÔNG đếm được (hồ sơ do người tạo gói dựng) không cứu; ĐỘT BIẾN bỏ vế đếm được ⇒ cứu", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g]);
    const p = await goiCho(t, [g, await ncc(t, { nhap: t.pm })]);
    expect(await soMoi(t, p)).toBe(0);
    await nopBiChan(t, p);
    const dotBien = await defDotBien(
      HAM_MOI,
      "AND EXISTS (SELECT 1 FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) d WHERE d = i.id)",
      "AND i.revoked_at IS NULL",
    );
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBeNull();
  });
});

// =============================================================================================
// ⑸ NGOẠI LỆ ROTATION, N = 0
// =============================================================================================
describe("[S1.270 / S3.3d / K3] ngoại lệ ROTATION; bậc không xoay vòng", () => {
  it("[INV-K3] ROTATION còn sống ⇒ nộp và mở được (K5 đòi chữ ký độc lập — pm2); đã rút ⇒ 422; ĐỘT BIẾN bỏ vế ngoại lệ ⇒ K3 chặn", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g]);
    const p = await goiCho(t, [g]);
    await lapNl(t, p, "ROTATION");
    expect(await chotK3(t, p)).toBeNull();
    const dotBien = await defDotBien(HAM_K3, "AND e.loai = 'ROTATION'", "AND e.loai = 'KHONG_CO'");
    expect(await trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p))).toBe("K3_KHONG_XOAY_VONG");
    expect((await nop(t, p)).status).toBe(200);
    await duyet(t, p, t.pm2);
    expect((await mo(t, p)).status).toBe(200);
    const r = await goiCho(t, [g]);
    await rutNl(t, r, await lapNl(t, r, "ROTATION"));
    await nopBiChan(t, r);
  });

  it("[INV-K3] bậc `xoay_vong_n` = 0: mời lại cùng nhà cung cấp vẫn đi; ĐỘT BIẾN bỏ vế N = 0 ⇒ hàm cửa sổ NÉM (cửa sổ phải có ít nhất một gói)", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    await goiMo(t, [g], { gia: GIA_BAC0 });
    const p = await goiCho(t, [g], { gia: GIA_BAC0 });
    expect(await chotK3(t, p)).toBeNull();
    const dotBien = await defDotBien(HAM_K3, "  IF n = 0 THEN\n    RETURN NULL;\n  END IF;\n", "");
    expect(await loi(trongDotBien(t.org, [dotBien], (c) => hoiK3(c, t.org, p)))).toMatchObject({ code: "23514", message: expect.stringMatching(/it nhat mot goi \(K3\)/u) as unknown });
    expect((await nop(t, p)).status).toBe(200);
  });
});

// =============================================================================================
// ⑹ CẠNH MỞ GÓI
// =============================================================================================
describe("[S1.270 / S3.3d / K3] cạnh mở: nộp song song bị bắt lúc mở; khoá; opened_at; READ COMMITTED", () => {
  it("[INV-K3] hai gói cùng nhóm quen nộp SONG SONG đều qua lúc nộp; mở cái đầu thì cái sau ⇒ 422 mang câu của chốt, MỘT hàng CONTROL_DENIED, không vật liệu khoá", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    const a = await goiCho(t, [g]);
    const b = await goiCho(t, [g]);
    for (const p of [a, b]) {
      expect((await nop(t, p)).status).toBe(200);
      await duyet(t, p, t.pm2);
    }
    expect((await mo(t, a)).status).toBe(200);
    const r = await mo(t, b);
    expect([r.status, r.body.error]).toEqual([422, TD_K3]);
    expect(await tuChoiChot(t.org, b)).toEqual([{ ma: "K3_KHONG_XOAY_VONG", actorId: t.pm.u }]);
    expect((await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [b])).rowCount).toBe(0);
    expect(await trangThai(b)).toBe("PENDING_APPROVAL");
  });

  it("[INV-K3] hai lần mở ĐỒNG THỜI xếp hàng ở khoá chính sách: lần sau chờ, rồi thấy gói vừa mở và bị chặn TRƯỚC lần đúc khoá với lời có tên", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    const a = await goiCho(t, [g]);
    const b = await goiCho(t, [g]);
    for (const p of [a, b]) {
      expect((await nop(t, p)).status).toBe(200);
      await duyet(t, p, t.pm2);
    }
    const cA = await moGiaoDich(t.org);
    const cB = await moGiaoDich(t.org);
    try {
      await openRfq(cA, t.org, { rfqId: a, actorSessionId: t.pm.s, orgKeys: boBocGia }, auditPool);
      const pidB = (await cB.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      const moB = openRfq(cB, t.org, { rfqId: b, actorSessionId: t.pm.s, orgKeys: boBocGia }, auditPool).then(
        () => null,
        (e: unknown) => e as Error & { lyDo?: string },
      );
      await choKhoaTuVan(pidB);
      await cA.query("COMMIT");
      const e = await moB;
      expect(e).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K3_KHONG_XOAY_VONG" });
    } finally {
      await cB.query("ROLLBACK").catch(() => undefined);
      await cA.query("ROLLBACK").catch(() => undefined);
      cA.release();
      cB.release();
    }
    expect(await trangThai(a)).toBe("OPEN");
    expect(await trangThai(b)).toBe("PENDING_APPROVAL");
    expect(await tuChoiChot(t.org, b)).toEqual([{ ma: "K3_KHONG_XOAY_VONG", actorId: t.pm.u }]);
  });

  it("[INV-K3] lớp chặn cuối ở cạnh mở: câu mở thô ⇒ 23514 `k3_xoay_vong`; `opened_at` khác giờ của lần mở ⇒ bị chặn ở tổ chức ĐÃ bật (khoản 319), đi ở tổ chức CHƯA bật; ĐỘT BIẾN tắt trigger ⇒ đi", async () => {
    const t = await taoToChuc();
    const g = await ncc(t);
    // Hai gói nộp TRƯỚC khi gói nào mở — cạnh nộp cho qua cả hai —, rồi mở gói đầu: gói sau chỉ còn cạnh mở chặn.
    const a = await goiCho(t, [g]);
    const b = await goiCho(t, [g]);
    for (const x of [a, b]) {
      expect((await nop(t, x)).status).toBe(200);
      await duyet(t, x, t.pm2);
    }
    expect((await mo(t, a)).status).toBe(200);
    const thamSo = (luc: string): unknown[] => [b, t.pm.u, t.pm.s, luc];
    const e = await loi(trongDotBien(t.org, [TAT_KHOA], async (c) => c.query(CAU_MO_THO, thamSo((await c.query<{ n: string }>("SELECT now()::text AS n")).rows[0]!.n))));
    expect(e).toMatchObject({ code: "23514", constraint: "k3_xoay_vong", message: "Goi thau chua mo duoc (K3): K3_KHONG_XOAY_VONG" });
    const tuongLai = await loi(trongDotBien(t.org, [TAT_KHOA], (c) => c.query(CAU_MO_THO, thamSo("2100-01-01T00:00:00Z"))));
    expect(tuongLai?.message).toMatch(/Moc mo goi phai la gio cua lan mo .*khoan 319/u);
    const tat = await trongDotBien(t.org, [TAT_KHOA, "ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_xoay_vong_khi_mo"], (c) =>
      c.query(CAU_MO_THO, thamSo("2100-01-01T00:00:00Z")),
    );
    expect(tat.rowCount).toBe(1);
    // Tổ chức chưa bật: `opened_at` tuỳ ý vẫn như MVP1 (khoản 319 còn mở ở đó).
    const h = await taoToChuc(false);
    const m = await goiNhap(h, GIA_BAC1);
    expect((await nop(h, m)).status).toBe(200);
    await duyet(h, m, h.pm2);
    const mvp1 = await trongDotBien(h.org, [TAT_KHOA], (c) => c.query(CAU_MO_THO, [m, h.pm.u, h.pm.s, "2100-01-01T00:00:00Z"]));
    expect(mvp1.rowCount).toBe(1);
  });

  it("[INV-K3] READ COMMITTED ở cả hai cạnh — chốt RIÊNG của K3: nộp RR khi trigger K2 tắt, mở RR ⇒ bị chặn; ĐỘT BIẾN bỏ chốt ⇒ đi", async () => {
    const t = await taoToChuc();
    const p = await goiCho(t, [await ncc(t)]);
    const tatK2 = "ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_so_ncc_khi_nop";
    const e = await loi(trongDotBien(t.org, [tatK2], (c) => c.query(CAU_NOP_THO, [p, t.pm.u, t.pm.s]), "REPEATABLE READ"));
    expect(e?.message).toMatch(/Nop duyet chi nhan duoi READ COMMITTED \(giao dich dang o repeatable read\).*\(K3\)/u);
    const boNop = await defDotBien("public.rfq_kiem_xoay_vong_khi_nop()", "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN", "IF false THEN");
    expect((await trongDotBien(t.org, [tatK2, boNop], (c) => c.query(CAU_NOP_THO, [p, t.pm.u, t.pm.s]), "REPEATABLE READ")).rowCount).toBe(1);
    expect((await nop(t, p)).status).toBe(200);
    await duyet(t, p, t.pm2);
    const moRr = (them: readonly string[]): Promise<pg.QueryResult> =>
      trongDotBien(t.org, [TAT_KHOA, ...them], async (c) => c.query(CAU_MO_THO, [p, t.pm.u, t.pm.s, (await c.query<{ n: string }>("SELECT now()::text AS n")).rows[0]!.n]), "REPEATABLE READ");
    expect((await loi(moRr([])))?.message).toMatch(/Mo goi chi nhan duoi READ COMMITTED \(giao dich dang o repeatable read\)/u);
    const boMo = await defDotBien("public.rfq_kiem_xoay_vong_khi_mo()", "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN", "IF false THEN");
    expect((await moRr([boMo])).rowCount).toBe(1);
  });
});

// =============================================================================================
// ⑺ ĐỐI CHỨNG MVP1 VÀ TỪ VỰNG
// =============================================================================================
describe("[S1.270 / S3.3d / K3] tổ chức chưa bật chạy như MVP1; tập mã khớp bảng", () => {
  it("[INV-K3] tổ chức CHƯA bật: mời lại cùng nhà cung cấp ở gói kế, nộp và mở đi; hàm vị từ trả NULL; không CONTROL_DENIED", async () => {
    const t = await taoToChuc(false);
    const g = await ncc(t, { xacMinh: null });
    await goiMo(t, [g]);
    const p = await goiCho(t, [g]);
    expect(await chotK3(t, p)).toBeNull();
    expect((await nop(t, p)).status).toBe(200);
    await duyet(t, p, t.pm2);
    expect((await mo(t, p)).status).toBe(200);
    expect(await tuChoiChot(t.org, p)).toEqual([]);
  });

  it("mã của `rfq_chot_xoay_vong` BẰNG dòng K3 của `CHOT_VAO_SO`, và nó vào sổ", async () => {
    const src = (await db.pool.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = $1::regprocedure", [HAM_K3])).rows[0]!.s;
    const trongHam = [...src.matchAll(/RETURN '([A-Z0-9_]+)'/gu)].map((m) => m[1]!).sort();
    const trongBang = Object.entries(CHOT_VAO_SO)
      .filter(([, d]) => d.chot === "K3")
      .map(([ma]) => ma)
      .sort();
    expect(trongHam.length, "bộ đọc không thấy mã nào — đang mù").toBeGreaterThan(0);
    expect(trongHam).toEqual(trongBang);
    expect(CHOT_VAO_SO.K3_KHONG_XOAY_VONG.vaoSo).toBe(true);
  });
});
