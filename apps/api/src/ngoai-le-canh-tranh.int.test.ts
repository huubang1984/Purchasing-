// ==============================================================================================
// [S1.265 / S3.3b · spec S3 §4.4 · K4a · K4b · K12] NGOẠI LỆ CẠNH TRANH — PHÉP ĐO TRÊN POSTGRES 16, QUA HTTP VÀ DƯỚI `app_api`
//
// Migration `105_ngoai_le_canh_tranh`, gói `packages/invitation/src/ngoai-le.ts`, ba route của `apps/api`. Hợp đồng đo ở đây:
//   ⑴ lập ở DRAFT: `201`, một hàng `LAP` của đúng người phiên, một hàng sổ `SOURCING_EXCEPTION_CREATED` mang loại và mã — không
//      mang giải trình; đọc lại thấy còn sống;
//   ⑵ băm danh sách (`rfq_bam_danh_sach`): gói KHÔNG ngoại lệ giữ đúng băm của `076`; ngoại lệ còn sống vào băm bằng đúng một
//      dòng `NGOAI_LE|id|loại|mã|sha256(giải trình)`; rút thì băm về như trước — nên người duyệt ký lên ngoại lệ (K4b);
//   ⑶ rút: một hàng `RUT` trỏ về đúng ngoại lệ, lý do vào sổ; lần rút thứ hai, rút ngoại lệ của gói khác, hay trỏ vào hàng rút
//      đều bị từ chối có tên, không vào sổ;
//   ⑷ K4a + K12: lập hay rút khi gói đã rời DRAFT — kể cả ở OPEN, nơi lời mời vẫn THÊM được — là `422` mang câu của chốt và
//      MỘT hàng `CONTROL_DENIED {K4A_NGOAI_LE_SAI_TRANG_THAI}`; hai giao dịch chen nhau với lần nộp duyệt xếp hàng ở khoá hàng gói;
//   ⑸ hình dạng: tập đóng của loại và mã, sàn `OTHER` 100 BYTE sau khi cắt, ở gói VÀ ở CHECK;
//   ⑹ quyền: thiếu `rfq.invite` là `403` + `PERMISSION_DENIED` ở cả ghi lẫn đọc; câu thô dưới phiên thiếu quyền bị trigger chặn;
//   ⑺ tổ chức chưa bật: từ chối, không `CONTROL_DENIED` (cấu hình, không phải người đi tắt); chỉ ghi thêm kể cả với chủ CSDL;
//      tổ chức khác không thấy;
//   ⑻ tập loại trừ (`rfq_tap_loai_tru`, ADR-082 ⑿): tác giả ngoại lệ CÒN SỐNG ở trong, rút rồi thì ra.
// Mỗi chốt CSDL có một ĐỘT BIẾN trong chính tệp này: tắt hay viết lại đúng chỗ ấy thì phép đo đổi kết quả.
// ==============================================================================================
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { ghiAnhXa, taoHangChuan } from "@trustprocure/du-lieu-nen";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import { createInvitation, lapNgoaiLe, rutNgoaiLe } from "@trustprocure/invitation";
import { addRfqItem, approveRfq, createProcurementPolicy, createRfq, returnRfqToDraft, setRfqBudget, submitRfqForApproval } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const THONG_DIEP_K4A = CHOT_VAO_SO.K4A_NGOAI_LE_SAI_TRANG_THAI.thongDiep;
const GIAI_TRINH = "Chi mot nha san xuat co chung nhan hop quy cho thep tam SS400 day 3mm trong khu vuc.";
const LOI_TRANG_THAI = (s: string): string => `Ngoai le chi lap hay rut khi goi con o DRAFT; goi dang o ${s} (K4a)`;

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `luong-moi-s3.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo danh sách mời.
const boBocGia = {
  name: "gia-cho-test-ngoai-le",
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

/** Bảng bậc tối thiểu, khuôn `luong-moi-s3`. */
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

// ---- Dàn cảnh --------------------------------------------------------------------------------
let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi {
  readonly u: string;
  readonly s: string;
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo gói, mời, lập ngoại lệ, mở. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER khác — người duyệt. */
  readonly pm2: Nguoi;
  /** BUYER — giữ `rfq.invite`, không tạo gói nào ở đây. */
  readonly mua: Nguoi;
  /** FINANCE — ký phiên bản chính sách, dựng nhóm hàng; KHÔNG giữ `rfq.invite`. */
  readonly tc: Nguoi;
}
interface NhaCungCap {
  readonly ncc: string;
  readonly lh: string;
}
interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
}
interface NgoaiLeHttp {
  readonly id: string;
  readonly rfqId: string;
  readonly loai: string;
  readonly maLyDo: string;
  readonly giaiTrinh: string;
  readonly lapBoi: string;
  readonly rut: { readonly boi: string; readonly lyDo: string } | null;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`nl-${randomBytes(4).toString("hex")}`]);
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
  const mua = await nguoi("BUYER");
  const tc = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  return { org, pm, pm2, mua, tc };
}

/** [S1.266 / S3.3c1] Tổ chức đã bật trong tệp này — ở đó `nhaCungCapCuaGoi` dựng nhà cung cấp ĐẾM ĐƯỢC cho K2. */
const DA_BAT = new Set<string>();

/** BẬT S3 — khuôn `batS3` của `luong-moi-s3`: phiên bản có bậc, chữ ký thứ hai của một người khác. */
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
  DA_BAT.add(t.org);
}

async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  await batS3(t);
  return t;
}

/** [S1.201 / S3.6a] Nhóm hàng của tổ chức, dựng MỘT lần bởi FINANCE: tổ chức đã bật không nộp duyệt được gói không nhóm hàng. */
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

/**
 * [S1.266 / S3.3c1] Nhà cung cấp của lời mời trong một gói: ở tổ chức ĐÃ bật, một nhà cung cấp ĐẾM ĐƯỢC cho K2
 * (`nhaCungCapDemDuoc`, xác minh bởi `tc` — FINANCE, không khai phiên bản chính sách mà ngân sách ghim, không tạo gói, không
 * mời) — để các ca nộp duyệt KHÔNG có ngoại lệ sống (rút rồi nộp lại, nộp trần, đua với một câu lập chưa COMMIT) qua K2 bằng số
 * đếm thay vì bằng ngoại lệ. Danh sách vẫn đúng MỘT nhà cung cấp, nên một `SINGLE_SOURCE` sống vẫn ĐÚNG loại: các ca đo ngoại
 * lệ giữ nguyên ý nghĩa. Tổ chức CHƯA bật (đối chứng ⑺) giữ nhà cung cấp do `pm` dựng — xác minh đòi tổ chức đã bật.
 */
async function nhaCungCapCuaGoi(t: ToChuc): Promise<NhaCungCap> {
  if (!DA_BAT.has(t.org)) return nhaCungCap(t);
  const [n] = await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc });
  return { ncc: n!.ncc, lh: n!.lh };
}

/** Gói DRAFT có ngân sách, một hạng mục và một lời mời — do `pm` dựng. */
async function goiNhap(t: ToChuc): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  // [S1.266 / S3.3c1] Ở tổ chức đã bật: nhà cung cấp đếm được (K2) — người mời vẫn là `pm`.
  const n = await nhaCungCapCuaGoi(t);
  await withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.pm.s }, auditPool));
  return rfqId;
}

const nop = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, auditPool));
/** [S1.198 / khoản 256] Người duyệt gửi lại lần nộp VỪA ĐỌC. */
const duyet = (t: ToChuc, rfqId: string): Promise<void> =>
  withTenant(apiPool, t.org, async (c) => {
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]!.n;
    await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s, lanNopDaXem: lan }, auditPool);
  });
const traVe = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => returnRfqToDraft(c, t.org, { rfqId, reason: "bo sung giai trinh", actorSessionId: t.pm.s }, auditPool));

async function goi(method: string, duong: string, cookie: string, than?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = { cookie };
  if (than !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${goc}${duong}`, { method, headers, ...(than === undefined ? {} : { body: JSON.stringify(than) }) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // thân không phải JSON — để `text` nói
  }
  return { status: res.status, body, text };
}

const lapQuaRoute = (
  t: ToChuc,
  rfqId: string,
  ai: Nguoi = t.pm,
  tuyChon: { loai?: string; maLyDo?: string; giaiTrinh?: string } = {},
): Promise<PhanHoi> =>
  goi("POST", `/rfqs/${rfqId}/exceptions`, ai.cookie, {
    loai: tuyChon.loai ?? "SINGLE_SOURCE",
    maLyDo: tuyChon.maLyDo ?? "PROPRIETARY_TECHNOLOGY",
    giaiTrinh: tuyChon.giaiTrinh ?? GIAI_TRINH,
  });

async function lap(t: ToChuc, rfqId: string, ai: Nguoi = t.pm, tuyChon: { loai?: string; maLyDo?: string; giaiTrinh?: string } = {}): Promise<NgoaiLeHttp> {
  const r = await lapQuaRoute(t, rfqId, ai, tuyChon);
  expect(r.status, r.text).toBe(201);
  return r.body.exception as NgoaiLeHttp;
}

const rutQuaRoute = (t: ToChuc, rfqId: string, exceptionId: string, reason = "nha cung cap thu hai vua duoc tim thay", ai: Nguoi = t.pm): Promise<PhanHoi> =>
  goi("POST", `/rfqs/${rfqId}/exceptions/${exceptionId}/withdraw`, ai.cookie, { reason });

async function danhSach(t: ToChuc, rfqId: string, ai: Nguoi = t.pm): Promise<NgoaiLeHttp[]> {
  const r = await goi("GET", `/rfqs/${rfqId}/exceptions`, ai.cookie);
  expect(r.status, r.text).toBe(200);
  return r.body.exceptions as NgoaiLeHttp[];
}

/** Hàng `CONTROL_DENIED` trên một gói, theo thứ tự ghi. */
async function tuChoiChot(org: string, rfqId: string): Promise<{ ma: unknown; actorId: string | null }[]> {
  const { rows } = await db.pool.query<{ payload: Record<string, unknown> | null; actor_id: string | null }>(
    "SELECT payload, actor_id FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows.map((h) => ({ ma: h.payload?.ma, actorId: h.actor_id }));
}

/** Hàng sổ của một hành động trên một tài nguyên, theo thứ tự ghi. */
async function soCua(org: string, action: string, resourceId: string): Promise<{ actorId: string | null; resourceType: string; payload: unknown }[]> {
  const { rows } = await db.pool.query<{ actor_id: string | null; resource_type: string; payload: unknown }>(
    "SELECT actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3 ORDER BY seq",
    [org, action, resourceId],
  );
  return rows.map((h) => ({ actorId: h.actor_id, resourceType: h.resource_type, payload: h.payload }));
}

async function bam(t: ToChuc, rfqId: string): Promise<Buffer> {
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: Buffer }>("SELECT public.rfq_bam_danh_sach($1) AS b", [rfqId]));
  return rows[0]!.b;
}

/** Băm theo công thức — dòng lời mời còn sống cộng `dongThem`, xếp theo BYTE (collation `"C"`), nối `\n`, sha256. */
async function bamTheoCongThuc(rfqId: string, dongThem: readonly string[] = []): Promise<Buffer> {
  const { rows } = await db.pool.query<{ dong: string }>(
    "SELECT 'MOI|' || supplier_id::text || '|' || contact_id::text || '|' || link_channel AS dong FROM rfq_invitations " +
      "WHERE rfq_id = $1 AND revoked_at IS NULL",
    [rfqId],
  );
  const dong = [...rows.map((r) => r.dong), ...dongThem].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return createHash("sha256").update(dong.join("\n"), "utf8").digest();
}

async function tapLoaiTru(t: ToChuc, rfqId: string): Promise<string[]> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ n: string }>("SELECT n FROM public.rfq_tap_loai_tru($1, $2) AS n ORDER BY n", [t.org, rfqId]),
  );
  return rows.map((r) => r.n);
}

async function trangThaiGoi(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

async function soHang(rfqId: string, hanhDong?: "LAP" | "RUT"): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM rfq_sourcing_exceptions WHERE rfq_id = $1 AND ($2::text IS NULL OR hanh_dong = $2)",
    [rfqId, hanhDong ?? null],
  );
  return rows[0]!.n;
}

async function trangThaiTrigger(trigger: string): Promise<string> {
  return (await db.pool.query<{ e: string }>("SELECT tgenabled AS e FROM pg_trigger WHERE tgname = $1", [trigger])).rows[0]!.e;
}

interface LoiBat {
  readonly ten: string;
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
    return { ten: x.name, message: x.message, code: x.code ?? "", constraint: x.constraint ?? "" };
  }
}

/** Câu chèn ngoại lệ của `lapNgoaiLe`, nguyên cột — để đo LỚP CSDL không qua gói. */
const CAU_LAP =
  "INSERT INTO public.rfq_sourcing_exceptions (org_id, rfq_id, hanh_dong, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id) " +
  "VALUES ($1, $2, 'LAP', $3, $4, $5, $6, $7) RETURNING id";
const CAU_RUT =
  "INSERT INTO public.rfq_sourcing_exceptions (org_id, rfq_id, hanh_dong, ngoai_le_id, giai_trinh, created_by, created_by_session_id) " +
  "VALUES ($1, $2, 'RUT', $3, 'rut tho', $4, $5) RETURNING id";

const thamSoLap = (t: ToChuc, rfqId: string, ai: Nguoi = t.pm, loai = "SINGLE_SOURCE", ma = "EMERGENCY", giaiTrinh = "khan cap"): unknown[] => [
  t.org,
  rfqId,
  loai,
  ma,
  giaiTrinh,
  ai.u,
  ai.s,
];

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

/** Định nghĩa của một hàm sau MỘT phép thay chuỗi trên `pg_get_functiondef` — chuỗi phải khớp đúng một chỗ. */
async function defDotBien(ham: string, cu: string, moi: string): Promise<string> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  return goc.replace(cu, moi);
}

/** Như `defDotBien` nhưng COMMIT — để kết nối KHÁC thấy thân đột biến — rồi trả lại thân gốc và kiểm nó đã về. */
async function voiHamDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const doc = async (): Promise<string> =>
    (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  const gocDef = await doc();
  await db.pool.query(await defDotBien(ham, cu, moi));
  expect(await doc(), "đột biến phải đã áp").not.toBe(gocDef);
  try {
    return await viec();
  } finally {
    await db.pool.query(gocDef);
    if ((await doc()) !== gocDef) throw new Error(`không khôi phục được ${ham}`);
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
// ⑴ ⑵ ⑶ — LẬP, BĂM, RÚT
// =============================================================================================
describe("[S1.265 / S3.3b] ngoại lệ cạnh tranh — lập, băm, rút", () => {
  it("[INV-K4a] ⑴ lập ở DRAFT: 201, MỘT hàng LAP của người phiên, sổ SOURCING_EXCEPTION_CREATED mang loại và mã (không giải trình); đọc lại thấy còn sống", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId, t.pm, { giaiTrinh: `   ${GIAI_TRINH}  ` });
    expect(nl).toMatchObject({ rfqId, loai: "SINGLE_SOURCE", maLyDo: "PROPRIETARY_TECHNOLOGY", giaiTrinh: GIAI_TRINH, lapBoi: t.pm.u, rut: null });
    const { rows } = await db.pool.query("SELECT hanh_dong, created_by, created_by_session_id, giai_trinh FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [rfqId]);
    expect(rows).toEqual([{ hanh_dong: "LAP", created_by: t.pm.u, created_by_session_id: t.pm.s, giai_trinh: GIAI_TRINH }]);
    // [lượt soi hình dạng, T1] Sổ chuỗi băm buộc ĐÚNG các byte người duyệt ký: sha256 của giải trình ĐÃ CẮT, cùng băm ở dòng
    // `NGOAI_LE|…` — không mang văn bản.
    const giaiTrinhSha256 = createHash("sha256").update(GIAI_TRINH, "utf8").digest("hex");
    expect(await soCua(t.org, "SOURCING_EXCEPTION_CREATED", rfqId)).toEqual([
      {
        actorId: t.pm.u,
        resourceType: "RFQ",
        payload: { exceptionId: nl.id, loai: "SINGLE_SOURCE", maLyDo: "PROPRIETARY_TECHNOLOGY", giaiTrinhSha256 },
      },
    ]);
    expect((await danhSach(t, rfqId)).map((n) => [n.id, n.rut])).toEqual([[nl.id, null]]);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  it("[INV-K4b] ⑵ băm danh sách: gói KHÔNG ngoại lệ giữ ĐÚNG băm của `076`; lập ngoại lệ đổi băm; rút thì băm về như trước", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const truoc = await bam(t, rfqId);
    expect(truoc.equals(await bamTheoCongThuc(rfqId)), "gói không ngoại lệ: băm như trước S3.3b").toBe(true);
    const nl = await lap(t, rfqId);
    expect((await bam(t, rfqId)).equals(truoc), "ngoại lệ còn sống nằm trong băm").toBe(false);
    expect((await rutQuaRoute(t, rfqId, nl.id)).status).toBe(200);
    expect((await bam(t, rfqId)).equals(truoc), "ngoại lệ đã rút ra khỏi băm").toBe(true);
  });

  it("[INV-K4b] ⑵ băm có ngoại lệ bằng ĐÚNG công thức: dòng `NGOAI_LE|id|loại|mã|sha256(giải trình)` cạnh dòng lời mời, xếp theo byte; ngoại lệ đã rút không có dòng", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const song = await lap(t, rfqId, t.pm, { loai: "LIMITED_COMPETITION", maLyDo: "EMERGENCY", giaiTrinh: `${GIAI_TRINH} — gấp` });
    const daRut = await lap(t, rfqId);
    expect((await rutQuaRoute(t, rfqId, daRut.id)).status).toBe(200);
    const hex = createHash("sha256").update(song.giaiTrinh, "utf8").digest("hex");
    expect((await bam(t, rfqId)).equals(await bamTheoCongThuc(rfqId, [`NGOAI_LE|${song.id}|LIMITED_COMPETITION|EMERGENCY|${hex}`]))).toBe(true);
  });

  it("[INV-K4b] ⑵ người duyệt ký lên ngoại lệ: chữ ký ghim băm CÓ ngoại lệ; trả về, rút, nộp lại ⇒ chữ ký cũ không còn đếm, mở gói 422 (K4b); một chữ ký mới thì mở được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId);
    const daKy = (await db.pool.query<{ h: Buffer }>("SELECT approved_list_hash AS h FROM rfq_approvals WHERE rfq_id = $1", [rfqId])).rows[0]!.h;
    expect(daKy.equals(await bam(t, rfqId)), "chữ ký ghim băm có ngoại lệ").toBe(true);
    await traVe(t, rfqId);
    expect((await rutQuaRoute(t, rfqId, nl.id)).status).toBe(200);
    await nop(t, rfqId);
    const mo = await goi("POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(mo.status, mo.text).toBe(422);
    expect(mo.body.error).toMatch(/TREN DANH SACH MOI HIEN TAI.*\(K4b\)/u);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    // Đối chứng dương: ký lại trên danh sách HIỆN TẠI thì cạnh mở gói đi qua.
    await duyet(t, rfqId);
    const moLai = await goi("POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(moLai.status, moLai.text).toBe(200);
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4a] ⑶ rút: hàng RUT trỏ về đúng ngoại lệ, sổ SOURCING_EXCEPTION_WITHDRAWN mang lý do đã cắt; rút lần hai ⇒ 422 có tên, không hàng mới, không CONTROL_DENIED", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId);
    const r = await rutQuaRoute(t, rfqId, nl.id, "  tim duoc nha cung cap thu hai  ", t.mua);
    expect(r.status, r.text).toBe(200);
    expect((r.body.exception as NgoaiLeHttp).rut).toMatchObject({ boi: t.mua.u, lyDo: "tim duoc nha cung cap thu hai" });
    const { rows } = await db.pool.query("SELECT ngoai_le_id, created_by FROM rfq_sourcing_exceptions WHERE rfq_id = $1 AND hanh_dong = 'RUT'", [rfqId]);
    expect(rows).toEqual([{ ngoai_le_id: nl.id, created_by: t.mua.u }]);
    expect(await soCua(t.org, "SOURCING_EXCEPTION_WITHDRAWN", rfqId)).toEqual([
      { actorId: t.mua.u, resourceType: "RFQ", payload: { exceptionId: nl.id, reason: "tim duoc nha cung cap thu hai" } },
    ]);
    const lan2 = await rutQuaRoute(t, rfqId, nl.id);
    expect(lan2.status, lan2.text).toBe(422);
    expect(lan2.body.error).toBe("Ngoai le nay da duoc rut (K4a)");
    expect(await soHang(rfqId, "RUT")).toBe(1);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
  });

  it("⑶ rút một ngoại lệ của GÓI KHÁC, trỏ vào một hàng RUT, hay một id không có ⇒ 422 của trigger, không hàng mới, không vào sổ", async () => {
    const t = await toChucDaBat();
    const a = await goiNhap(t);
    const b = await goiNhap(t);
    const nlA = await lap(t, a);
    const sai = "Hang rut phai tro ve mot ngoai le da lap cua cung goi thau (K4a)";
    const khacGoi = await rutQuaRoute(t, b, nlA.id);
    expect([khacGoi.status, khacGoi.body.error]).toEqual([422, sai]);
    expect((await rutQuaRoute(t, a, nlA.id)).status).toBe(200);
    const hangRut = (await db.pool.query<{ id: string }>("SELECT id FROM rfq_sourcing_exceptions WHERE ngoai_le_id = $1", [nlA.id])).rows[0]!.id;
    const troRut = await rutQuaRoute(t, a, hangRut);
    expect([troRut.status, troRut.body.error]).toEqual([422, sai]);
    const khongCo = await rutQuaRoute(t, a, "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect([khongCo.status, khongCo.body.error]).toEqual([422, sai]);
    expect([await soHang(a), await soHang(b)]).toEqual([2, 0]);
    expect([...(await tuChoiChot(t.org, a)), ...(await tuChoiChot(t.org, b))]).toEqual([]);
  });
});

// =============================================================================================
// ⑷ — K4a + K12: CHỈ Ở DRAFT, LẦN TỪ CHỐI VÀO SỔ; XẾP HÀNG VỚI LẦN NỘP DUYỆT
// =============================================================================================
describe("[S1.265 / S3.3b / K4a · K12] lập hay rút ngoài DRAFT để lại MỘT hàng CONTROL_DENIED", () => {
  it("[INV-K4a] gói CHỜ DUYỆT: lập và rút ⇒ 422 mang câu của chốt; mỗi lần MỘT hàng CONTROL_DENIED {K4A_NGOAI_LE_SAI_TRANG_THAI} dưới người gọi; không hàng ngoại lệ mới", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId);
    await nop(t, rfqId);
    const l1 = await lapQuaRoute(t, rfqId);
    expect([l1.status, l1.body.error]).toEqual([422, THONG_DIEP_K4A]);
    const l2 = await rutQuaRoute(t, rfqId, nl.id, "rut sau khi nop", t.mua);
    expect([l2.status, l2.body.error]).toEqual([422, THONG_DIEP_K4A]);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([
      { ma: "K4A_NGOAI_LE_SAI_TRANG_THAI", actorId: t.pm.u },
      { ma: "K4A_NGOAI_LE_SAI_TRANG_THAI", actorId: t.mua.u },
    ]);
    expect(await soHang(rfqId)).toBe(1);
    expect((await danhSach(t, rfqId)).map((n) => n.rut)).toEqual([null]);
  });

  it("[INV-K4a] gói ĐÃ MỞ — nơi lời mời vẫn THÊM được — ngoại lệ vẫn bị chặn: 422 và một hàng CONTROL_DENIED", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId);
    expect((await goi("POST", `/rfqs/${rfqId}/open`, t.pm.cookie)).status).toBe(200);
    const r = await lapQuaRoute(t, rfqId);
    expect([r.status, r.body.error]).toEqual([422, THONG_DIEP_K4A]);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K4A_NGOAI_LE_SAI_TRANG_THAI", actorId: t.pm.u }]);
    expect(await soHang(rfqId)).toBe(0);
  });

  it("[INV-K4a] hai giao dịch chen nhau: ① nộp duyệt trước, chưa COMMIT ⇒ câu lập CHỜ rồi thấy PENDING_APPROVAL và bị chặn; ② lập trước ⇒ nộp duyệt CHỜ, ngoại lệ vào danh sách trước khi gói rời DRAFT và vào băm người duyệt ký", async () => {
    const t = await toChucDaBat();
    // ①
    const g1 = await goiNhap(t);
    const cNop = await moGiaoDich(t.org);
    const cLap = await moGiaoDich(t.org);
    try {
      const pidLap = await pidCua(cLap);
      await submitRfqForApproval(cNop, t.org, { rfqId: g1, actorSessionId: t.pm.s }, auditPool);
      const lapXong = loi(cLap.query(CAU_LAP, thamSoLap(t, g1)));
      await choKhoaHang(pidLap);
      await cNop.query("COMMIT");
      const l = await lapXong;
      expect([l?.message, l?.constraint]).toEqual([LOI_TRANG_THAI("PENDING_APPROVAL"), "k4a_ngoai_le_sai_trang_thai"]);
    } finally {
      await cLap.query("ROLLBACK");
      await cNop.query("ROLLBACK");
      cNop.release();
      cLap.release();
    }
    expect(await soHang(g1)).toBe(0);

    // ②
    const g2 = await goiNhap(t);
    const cLap2 = await moGiaoDich(t.org);
    const cNop2 = await moGiaoDich(t.org);
    try {
      const pidNop2 = await pidCua(cNop2);
      await cLap2.query(CAU_LAP, thamSoLap(t, g2));
      const nopXong = loi(submitRfqForApproval(cNop2, t.org, { rfqId: g2, actorSessionId: t.pm.s }, auditPool));
      await choKhoaHang(pidNop2);
      await cLap2.query("COMMIT");
      expect(await nopXong).toBeNull();
      await cNop2.query("COMMIT");
    } finally {
      await cLap2.query("ROLLBACK");
      await cNop2.query("ROLLBACK");
      cLap2.release();
      cNop2.release();
    }
    expect([await trangThaiGoi(g2), await soHang(g2)]).toEqual(["PENDING_APPROVAL", 1]);
    await duyet(t, g2);
    const daKy = (await db.pool.query<{ h: Buffer }>("SELECT approved_list_hash AS h FROM rfq_approvals WHERE rfq_id = $1", [g2])).rows[0]!.h;
    expect(daKy.equals(await bamTheoCongThuc(g2)), "chữ ký KHÔNG ký trên danh sách thiếu ngoại lệ").toBe(false);
    expect(daKy.equals(await bam(t, g2))).toBe(true);
  });

  it("[INV-K4a] ĐỘT BIẾN: gỡ `FOR SHARE` khỏi `ngoai_le_kiem` thì ở thứ tự ① câu lập KHÔNG chờ, đọc DRAFT cũ và đi lọt — gói vào PENDING_APPROVAL mang một ngoại lệ K4a cấm", async () => {
    const t = await toChucDaBat();
    const g = await goiNhap(t);
    await voiHamDotBien("public.ngoai_le_kiem()", "FOR SHARE;", ";", async () => {
      const cNop = await moGiaoDich(t.org);
      const cLap = await moGiaoDich(t.org);
      try {
        await submitRfqForApproval(cNop, t.org, { rfqId: g, actorSessionId: t.pm.s }, auditPool);
        expect(await loi(cLap.query(CAU_LAP, thamSoLap(t, g))), "không khoá thì câu lập không chờ ai").toBeNull();
        await cNop.query("COMMIT");
        await cLap.query("COMMIT");
      } finally {
        await cLap.query("ROLLBACK");
        await cNop.query("ROLLBACK");
        cNop.release();
        cLap.release();
      }
    });
    expect([await trangThaiGoi(g), await soHang(g)], "ngoại lệ chen vào sau cạnh nộp duyệt").toEqual(["PENDING_APPROVAL", 1]);
  });

  it("[INV-K4a] ĐỘT BIẾN: tắt `rfq_sourcing_exceptions_kiem_ngoai_le` thì lập ở PENDING_APPROVAL đi lọt; trigger còn ENABLE ALWAYS thì bị chặn", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const khiTat = await trongDotBien(t.org, ["ALTER TABLE public.rfq_sourcing_exceptions DISABLE TRIGGER rfq_sourcing_exceptions_kiem_ngoai_le"], (c) =>
      loi(c.query(CAU_LAP, thamSoLap(t, rfqId))),
    );
    expect(khiTat, "trigger tắt thì câu lập đi lọt").toBeNull();
    expect(await trangThaiTrigger("rfq_sourcing_exceptions_kiem_ngoai_le")).toBe("A");
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId)))))?.message).toBe(LOI_TRANG_THAI("PENDING_APPROVAL"));
  });
});

// =============================================================================================
// ⑸ ⑹ ⑺ — HÌNH DẠNG, QUYỀN, CÔNG TẮC, CHỈ GHI THÊM, TỔ CHỨC KHÁC
// =============================================================================================
describe("[S1.265 / S3.3b] hình dạng, quyền, công tắc, chỉ ghi thêm", () => {
  it("[INV-K4a] ⑸ mã OTHER đòi giải trình ≥ 100 BYTE sau khi cắt: 99 byte bị từ chối ở gói (422 có tên) và ở CHECK; 100 byte qua — chữ có dấu đếm theo byte", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const thieu = "ế".repeat(33); // 33 × 3 byte = 99
    expect(Buffer.byteLength(thieu, "utf8")).toBe(99);
    const r = await lapQuaRoute(t, rfqId, t.pm, { maLyDo: "OTHER", giaiTrinh: `  ${thieu}   ` });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error).toMatch(/OTHER.*100 byte/u);
    const quaCheck = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId, t.pm, "SINGLE_SOURCE", "OTHER", thieu))));
    expect([quaCheck?.code, quaCheck?.constraint]).toEqual(["23514", "rfq_sourcing_exceptions_san_other"]);
    expect((await lap(t, rfqId, t.pm, { maLyDo: "OTHER", giaiTrinh: `${thieu}a` })).maLyDo).toBe("OTHER");
    expect(await soHang(rfqId)).toBe(1);
  });

  it("⑸ loại hay mã ngoài tập, giải trình rỗng ⇒ 422 ở gói; `LOW_ACTUAL_COMPETITION` chèn thẳng ⇒ trigger từ chối (đường ghi của nó là trao thầu, S3.5)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    for (const tuyChon of [{ loai: "LOW_ACTUAL_COMPETITION" }, { loai: "single_source" }, { maLyDo: "CHEAPEST" }, { giaiTrinh: "   " }]) {
      const r = await lapQuaRoute(t, rfqId, t.pm, tuyChon);
      expect(r.status, `${JSON.stringify(tuyChon)}: ${r.text}`).toBe(422);
    }
    const thang = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId, t.pm, "LOW_ACTUAL_COMPETITION"))));
    // [lượt soi hình dạng, L1] Thông điệp không nội suy giá trị của người gọi — `loai` đi tới trigger TRƯỚC CHECK.
    expect(thang?.message).toBe("Loai ngoai le nay khong lap o danh sach moi (K4a)");
    expect(await soHang(rfqId)).toBe(0);
  });

  it("[INV-K4a] ⑸ giải trình LƯU ĐÃ CẮT theo đúng tập của `String.trim`: gói cắt khoảng trắng Unicode; câu thô có khoảng trắng Unicode ở đầu hay cuối ⇒ CHECK `giai_trinh_da_cat`, kể cả lối độn khoảng trắng qua sàn OTHER; khoảng trắng ở GIỮA đi qua", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    // Dựng bằng điểm mã, không gõ ký tự vô hình vào nguồn.
    const ch = (...cp: number[]): string => String.fromCharCode(...cp);
    const nl = await lap(t, rfqId, t.pm, { giaiTrinh: `${ch(0x3000, 0x0a)}${GIAI_TRINH}${ch(0xa0, 0xfeff)}` });
    expect(nl.giaiTrinh, "gói cắt theo `String.trim`").toBe(GIAI_TRINH);
    const bien: readonly (readonly [string, string])[] = [
      [ch(0x0a), ""],
      ["", ch(0xa0)],
      [ch(0x2028), ""],
      ["", ch(0x3000)],
      [ch(0xfeff), ""],
      ["", ch(0x09)],
    ];
    for (const [dau, cuoi] of bien) {
      const l = await loi(
        withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId, t.pm, "SINGLE_SOURCE", "EMERGENCY", `${dau}khan cap${cuoi}`))),
      );
      expect([l?.code, l?.constraint], JSON.stringify([dau, cuoi])).toEqual(["23514", "rfq_sourcing_exceptions_giai_trinh_da_cat"]);
    }
    const doc = await loi(
      withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId, t.pm, "SINGLE_SOURCE", "OTHER", `${"ế".repeat(33)}${ch(0xa0)}`))),
    );
    expect(doc?.constraint, "99 byte chữ + một NBSP: không vượt sàn bằng khoảng trắng").toBe("rfq_sourcing_exceptions_giai_trinh_da_cat");
    const giua = await loi(
      withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId, t.pm, "SINGLE_SOURCE", "EMERGENCY", `khan${ch(0xa0, 0x0a)}cap`))),
    );
    expect(giua).toBeNull();
    expect(await soHang(rfqId)).toBe(2);
  });

  it("⑹ thiếu `rfq.invite` (FINANCE): lập, rút và ĐỌC ⇒ 403, mỗi lần một hàng PERMISSION_DENIED; câu thô dưới phiên FINANCE ⇒ trigger chặn; BUYER (giữ `rfq.invite`) đọc được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId);
    expect((await lapQuaRoute(t, rfqId, t.tc)).status).toBe(403);
    expect((await rutQuaRoute(t, rfqId, nl.id, "rut", t.tc)).status).toBe(403);
    expect((await goi("GET", `/rfqs/${rfqId}/exceptions`, t.tc.cookie)).status).toBe(403);
    const { rows } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2 AND resource_id = $3",
      [t.org, t.tc.u, rfqId],
    );
    expect(rows[0]?.n).toBe(3);
    // Cổng ở THÂN hàm gói, không chỉ ở route: một người gọi khác của gói (công cụ, worker) không đi qua bộ điều phối.
    const quaGoi = await Promise.all([
      loi(withTenant(apiPool, t.org, (c) => lapNgoaiLe(c, t.org, { rfqId, loai: "SINGLE_SOURCE", maLyDo: "EMERGENCY", giaiTrinh: "khan cap", actorSessionId: t.tc.s }, auditPool))),
      loi(withTenant(apiPool, t.org, (c) => rutNgoaiLe(c, t.org, { rfqId, exceptionId: nl.id, reason: "rut", actorSessionId: t.tc.s }, auditPool))),
    ]);
    expect(quaGoi.map((x) => x?.ten)).toEqual(["PermissionDeniedError", "PermissionDeniedError"]);
    const thang = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_LAP, thamSoLap(t, rfqId, t.tc))));
    expect(thang?.message).toBe("Nguoi lap hay rut ngoai le phai giu rfq.invite (ADR-084)");
    expect(await soHang(rfqId)).toBe(1);
    expect((await danhSach(t, rfqId, t.mua)).map((n) => n.id)).toEqual([nl.id]);
  });

  it("[INV-K4a] ĐỘT BIẾN: bỏ vế `rfq.invite` của `ngoai_le_kiem` thì câu thô dưới phiên FINANCE đi lọt — lớp gói là lớp duy nhất còn lại", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const def = await defDotBien("public.ngoai_le_kiem()", "rp.permission_code = 'rfq.invite'", "rp.permission_code = ANY (ARRAY['rfq.invite', 'po.approve'])");
    expect(await trongDotBien(t.org, [def], (c) => loi(c.query(CAU_LAP, thamSoLap(t, rfqId, t.tc))))).toBeNull();
  });

  it("⑺ tổ chức CHƯA bật S3 ⇒ 422, không hàng CONTROL_DENIED — cấu hình, không phải người đi tắt; không hàng ngoại lệ", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const r = await lapQuaRoute(t, rfqId);
    expect([r.status, r.body.error]).toEqual([422, "Chi to chuc da bat S3 moi lap hay rut ngoai le canh tranh (ADR-080)"]);
    expect(await tuChoiChot(t.org, rfqId)).toEqual([]);
    expect(await soHang(rfqId)).toBe(0);
  });

  it("⑺ chỉ ghi thêm: UPDATE, DELETE, TRUNCATE bị chặn cả với chủ CSDL; `app_api` không có quyền sửa", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId);
    const chiGhiThem = /chi duoc ghi them/u;
    expect((await loi(db.pool.query("UPDATE rfq_sourcing_exceptions SET giai_trinh = 'khac' WHERE id = $1", [nl.id])))?.message).toMatch(chiGhiThem);
    expect((await loi(db.pool.query("DELETE FROM rfq_sourcing_exceptions WHERE id = $1", [nl.id])))?.message).toMatch(chiGhiThem);
    expect((await loi(db.pool.query("TRUNCATE rfq_sourcing_exceptions CASCADE")))?.message).toMatch(chiGhiThem);
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query("UPDATE rfq_sourcing_exceptions SET giai_trinh = 'khac'"))))?.code).toBe("42501");
    expect((await loi(withTenant(apiPool, t.org, (c) => c.query("DELETE FROM rfq_sourcing_exceptions"))))?.code).toBe("42501");
    expect(await soHang(rfqId)).toBe(1);
  });

  it("⑺ tổ chức khác không thấy: đọc qua route ⇒ 404 như gói, câu thô dưới `app_api` của tổ chức khác không thấy hàng; phiên khách không thấy", async () => {
    const t = await toChucDaBat();
    const u = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await lap(t, rfqId);
    // [S1.273 / S3.3e1 · ADR-150 ⑶] ~~đọc qua route trả rỗng~~ Câu đọc nay dựng từ `rfq_packages` để mang lần nộp: gói không đọc được
    // dưới RLS của tổ chức khác ⇒ 404 `khong co goi thau`, cùng câu `GET /rfqs/:id` trả cho đúng gói ấy — không lộ thêm gì.
    const r = await goi("GET", `/rfqs/${rfqId}/exceptions`, u.pm.cookie);
    expect([r.status, r.body.error]).toEqual([404, "khong co goi thau"]);
    expect((await goi("GET", `/rfqs/${rfqId}`, u.pm.cookie)).status, "đối chứng: gói cũng 404").toBe(404);
    const { rows } = await withTenant(apiPool, u.org, (c) => c.query("SELECT 1 FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [rfqId]));
    expect(rows).toEqual([]);
    const khach = await withTenant(apiPool, t.org, async (c) => {
      await c.query("SELECT pg_catalog.set_config('app.guest_session_id', $1, true)", [t.pm.s]);
      return (await c.query<{ x: number }>("SELECT 1 AS x FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [rfqId])).rows;
    });
    expect(khach, "policy khách RESTRICTIVE đóng hẳn").toEqual([]);
  });
});

// =============================================================================================
// ⑵ ⑻ — ĐỘT BIẾN CỦA BĂM VÀ TẬP LOẠI TRỪ
// =============================================================================================
describe("[S1.265 / S3.3b] băm và tập loại trừ — đột biến", () => {
  it("[INV-K4b] ĐỘT BIẾN: băm bỏ dòng NGOAI_LE thì lập ngoại lệ KHÔNG đổi băm — chữ ký trên danh sách không ngoại lệ đếm cho gói có ngoại lệ", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const def = await defDotBien("public.rfq_bam_danh_sach(uuid)", "AND e.hanh_dong = 'LAP'", "AND e.hanh_dong = 'LAP' AND false");
    const [truoc, sau] = await trongDotBien(t.org, [def], async (c) => {
      const b = async (): Promise<Buffer> => (await c.query<{ b: Buffer }>("SELECT public.rfq_bam_danh_sach($1) AS b", [rfqId])).rows[0]!.b;
      const x = await b();
      await c.query(CAU_LAP, thamSoLap(t, rfqId));
      return [x, await b()];
    });
    expect(sau.equals(truoc), "thân đột biến: ngoại lệ không vào băm").toBe(true);
  });

  it("[INV-K4b] ĐỘT BIẾN: băm giữ cả ngoại lệ đã rút thì rút KHÔNG trả băm về — ngoại lệ ghi nhầm nằm mãi trong băm", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const truoc = await bam(t, rfqId);
    const nl = await lap(t, rfqId);
    expect((await rutQuaRoute(t, rfqId, nl.id)).status).toBe(200);
    const def = await defDotBien(
      "public.rfq_bam_danh_sach(uuid)",
      "AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id",
      "AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id AND false",
    );
    const sau = await trongDotBien(t.org, [def], async (c) =>
      (await c.query<{ b: Buffer }>("SELECT public.rfq_bam_danh_sach($1) AS b", [rfqId])).rows[0]!.b,
    );
    expect(sau.equals(truoc), "thân đột biến: ngoại lệ đã rút vẫn trong băm").toBe(false);
    expect((await bam(t, rfqId)).equals(truoc), "thân thật: đã rút thì ra").toBe(true);
  });

  it("[INV-K4b] ⑵ chỉ ba loại của danh sách mời vào băm và tập loại trừ: một hàng `LOW_ACTUAL_COMPETITION` (chèn khi trigger tắt — đường ghi của nó chưa có) không đổi băm, không thêm tác giả; ĐỘT BIẾN bỏ bộ lọc loại thì đổi cả hai", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const truoc = await bam(t, rfqId);
    const tapTruoc = await tapLoaiTru(t, rfqId);
    expect(tapTruoc, "dàn cảnh: BUYER chưa chạm gói").not.toContain(t.mua.u);
    const tat = "ALTER TABLE public.rfq_sourcing_exceptions DISABLE TRIGGER rfq_sourcing_exceptions_kiem_ngoai_le";
    const bamVaTap = async (c: pg.PoolClient): Promise<[Buffer, string[]]> => {
      await c.query(CAU_LAP, thamSoLap(t, rfqId, t.mua, "LOW_ACTUAL_COMPETITION"));
      const b = (await c.query<{ b: Buffer }>("SELECT public.rfq_bam_danh_sach($1) AS b", [rfqId])).rows[0]!.b;
      const n = (await c.query<{ n: string }>("SELECT n FROM public.rfq_tap_loai_tru($1, $2) AS n ORDER BY n", [t.org, rfqId])).rows.map((r) => r.n);
      return [b, n];
    };
    const [b1, n1] = await trongDotBien(t.org, [tat], bamVaTap);
    expect(b1.equals(truoc), "loại ngoài danh sách mời không vào băm").toBe(true);
    expect(n1).toEqual(tapTruoc);
    const LOC = "AND e.loai IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION')";
    const boLocBam = await defDotBien("public.rfq_bam_danh_sach(uuid)", LOC, "");
    const boLocTap = await defDotBien("public.rfq_tap_loai_tru(uuid,uuid)", LOC, "");
    const [b2, n2] = await trongDotBien(t.org, [tat, boLocBam, boLocTap], bamVaTap);
    expect(b2.equals(truoc), "thân đột biến: hàng loại khác đổi băm").toBe(false);
    expect(n2, "thân đột biến: tác giả hàng loại khác vào tập").toContain(t.mua.u);
  });

  it("⑻ tập loại trừ: tác giả ngoại lệ CÒN SỐNG ở trong; rút rồi thì ra — người rút không vào vì rút không nới cạnh tranh", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const goc = await tapLoaiTru(t, rfqId);
    expect(goc, "dàn cảnh: BUYER chưa chạm gói").not.toContain(t.mua.u);
    const nl = await lap(t, rfqId, t.mua);
    expect(await tapLoaiTru(t, rfqId)).toEqual([...goc, t.mua.u].sort());
    expect((await rutQuaRoute(t, rfqId, nl.id)).status).toBe(200);
    expect(await tapLoaiTru(t, rfqId)).toEqual(goc);
  });

  it("[INV-L3] ⑻ hệ quả L3: người lập ngoại lệ CÒN SỐNG của gói, về sau thành người quản lý dữ liệu, không duyệt được ánh xạ của gói ấy (TRONG_TAP_LOAI_TRU); ngoại lệ đã rút thì duyệt được — đối chứng trên gói thứ hai", async () => {
    const t = await toChucDaBat();
    const goiKg = async (): Promise<string> => {
      const categoryId = await nhomCua(t);
      const rfqId = await withTenant(apiPool, t.org, async (c) =>
        (await createRfq(c, t.org, { title: "Mua thep van", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
      );
      await withTenant(apiPool, t.org, async (c) => {
        await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s });
        await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep van D12", quantity: "10.0000", unit: "kg", actorSessionId: t.pm.s });
      });
      // [S1.266 / S3.3c1] Nhà cung cấp đếm được: gói `daRut` nộp duyệt KHÔNG còn ngoại lệ sống, nên qua K2 bằng số đếm.
      const n = await nhaCungCapCuaGoi(t);
      await withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.pm.s }, auditPool));
      return rfqId;
    };
    const conSong = await goiKg();
    const daRut = await goiKg();
    await lap(t, conSong, t.mua);
    const nl = await lap(t, daRut, t.mua);
    expect((await rutQuaRoute(t, daRut, nl.id)).status).toBe(200);
    await nop(t, conSong);
    await nop(t, daRut);
    // BUYER rời vai mời, nhận vai quản lý dữ liệu — `item.manage` không đứng cùng `rfq.invite` (`083`).
    await db.pool.query("DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2", [t.org, t.mua.u]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DATA_STEWARD')", [t.org, t.mua.u]);
    const hang = (
      await withTenant(apiPool, t.org, (c) => taoHangChuan(c, t.org, { ma: "THEP-D12", ten: "Thep van D12", donViGoc: "kg", actorSessionId: t.mua.s }))
    ).id;
    const anhXa = (rfqId: string): Promise<unknown> =>
      withTenant(apiPool, t.org, (c) => ghiAnhXa(c, t.org, { rfqId, lineNo: 1, hangChuanId: hang, actorSessionId: t.mua.s }));
    const l = await anhXa(conSong).then(
      () => null,
      (e: unknown) => e as { name?: string; ma?: string },
    );
    expect([l?.name, l?.ma], "tác giả ngoại lệ còn sống").toEqual(["DuLieuNenError", "TRONG_TAP_LOAI_TRU"]);
    expect(await loi(anhXa(daRut)), "ngoại lệ đã rút: người ấy không còn trong tập").toBeNull();
  });

  it("⑻ ĐỘT BIẾN: tập loại trừ bỏ vế ngoại lệ thì tác giả ngoại lệ còn sống nằm NGOÀI tập — K5 của S3.3c sẽ cho người ấy ký lên chính lời giải trình của mình", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await lap(t, rfqId, t.mua);
    expect(await tapLoaiTru(t, rfqId)).toContain(t.mua.u);
    const def = await defDotBien("public.rfq_tap_loai_tru(uuid,uuid)", "e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'", "e.rfq_id = p_rfq AND e.hanh_dong = 'LAP' AND false");
    const ngoai = await trongDotBien(t.org, [def], async (c) =>
      (await c.query<{ n: string }>("SELECT n FROM public.rfq_tap_loai_tru($1, $2) AS n", [t.org, rfqId])).rows.map((r) => r.n),
    );
    expect(ngoai).not.toContain(t.mua.u);
  });

  it("⑶ ĐỘT BIẾN: bỏ vế *đã rút* của `ngoai_le_kiem` thì lần rút thứ hai rơi xuống UNIQUE — 23505 trần (409) thay cho câu có tên", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nl = await lap(t, rfqId);
    expect((await rutQuaRoute(t, rfqId, nl.id)).status).toBe(200);
    const def = await defDotBien(
      "public.ngoai_le_kiem()",
      "AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = NEW.ngoai_le_id)",
      "AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = NEW.ngoai_le_id AND false)",
    );
    const l = await trongDotBien(t.org, [def], (c) => loi(c.query(CAU_RUT, [t.org, rfqId, nl.id, t.pm.u, t.pm.s])));
    expect(l?.code).toBe("23505");
    const that = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_RUT, [t.org, rfqId, nl.id, t.pm.u, t.pm.s])));
    expect([that?.code, that?.message]).toEqual(["23514", "Ngoai le nay da duoc rut (K4a)"]);
  });
});
