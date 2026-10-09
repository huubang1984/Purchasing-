// ==============================================================================================
// [S1.281 / S3.4a · spec S3 §4.5, §5.1 K9, §8.7 · K9 · K12] KHAI BÁO XUNG ĐỘT LỢI ÍCH — PHÉP ĐO TRÊN POSTGRES 16, QUA HTTP VÀ
// DƯỚI `app_api`
//
// Migration `114_khai_bao_xung_dot`, gói `@trustprocure/kiem-soat` (`khaiBaoXungDot`, `docKhaiBaoXungDot`), bảy trigger cổng và
// một lần hỏi trước ở `openRfq`. Hợp đồng đo ở đây:
//   ⑴ đối chứng dương: ở bậc đòi khai, người chưa khai KHÔNG ký duyệt gói được — `422` mang mã, MỘT hàng `CONTROL_DENIED
//      {K9_CHUA_KHAI_XUNG_DOT}` của chính người ấy —; khai *không xung đột* rồi ký thì đi qua; route đọc trả đúng khai báo, băm hiện
//      tại, bậc đòi khai và chốt;
//   ⑵ băm danh sách: khai rồi danh sách mời đổi ⇒ `K9_KHAI_BAO_LOI_THOI`, KHÔNG hàng sổ (ADR-060); khai lại thì qua;
//   ⑶ `CO_XUNG_DOT` vĩnh viễn: người khai có xung đột không ký được ở mọi bậc (kể cả bậc không đòi khai) — `K9_CO_XUNG_DOT`; khai
//      lại *không xung đột* ⇒ `K9_KHONG_GO_DUOC_XUNG_DOT`, vào sổ; nhà cung cấp khai phải có lời mời; hình dạng đầu vào;
//   ⑷ chữ ký của người có xung đột không đếm: khai CÓ xung đột SAU khi ký ⇒ cạnh mở gói `K9_CHU_KY_CO_XUNG_DOT`, vào sổ; chữ ký
//      của người khác cứu; ở hàng duyệt trao thầu cùng luật (câu thô) — ~~nhánh `APPROVED` của `coi_kiem_trao_thau`~~ **[S1.283 /
//      S3.4b]** nay là K7 (`award_du_chu_ky` đếm chữ ký KHÔNG xung đột, `115`): `k7_thieu_chu_ky`; phần trao thầu đo kỹ ở
//      `packages/danh-gia/src/trao-thau-theo-bac.int.test.ts` ⑸;
//   ⑸ bốn cổng còn lại trên một gói đã mở thầu thật: lượt chấm, đề xuất, chữ ký duyệt, huỷ trao thầu — mỗi cổng một lần bị chặn kèm
//      hàng sổ, rồi khai và đi qua;
//   ⑹ xác minh nhà cung cấp: người đã khai có xung đột với nhà cung cấp không thu hồi xác minh của nó — `K9_XAC_MINH_NCC_XUNG_DOT`,
//      hàng sổ mang tài nguyên SUPPLIER;
//   ⑺ ghi nhận tín hiệu chia nhỏ: người ghi nhận chưa khai bị chặn kèm hàng sổ, khai rồi qua;
//   ⑻ tổ chức chưa bật chạy như MVP1 — không khai, không chặn, không khai được; tập mã trong SQL BẰNG các dòng K9 của `CHOT_VAO_SO`.
// Mỗi lớp cưỡng chế có một ĐỘT BIẾN trong chính tệp này (áp trong một giao dịch rồi ROLLBACK): tắt trigger hay viết lại thân hàm thì
// chính câu vừa bị chặn đi lọt.
// ==============================================================================================
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { deXuatTraoThau, duyetTraoThau, huyTraoThau, taoLuotDanhGia } from "@trustprocure/danh-gia";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import { createInvitation } from "@trustprocure/invitation";
import { ghiNhanTinHieu } from "@trustprocure/kiem-soat";
import { addRfqItem, createProcurementPolicy, createRfq, setRfqBudget } from "@trustprocure/rfq";
import { thuHoiXacMinhNhaCungCap } from "@trustprocure/supplier";
import { withTenant } from "@trustprocure/tenancy";
import { approveUnseal, requestUnseal } from "@trustprocure/unseal";
import { nguoiNhapNhaCungCap, nhaCungCapDemDuoc, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';
const TD = CHOT_VAO_SO;

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `canh-tranh-toi-thieu.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. ***
const boBocGia = {
  name: "gia-cho-test-xung-dot",
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

/** Bậc 0 ĐÒI khai; bậc 1 (từ 100 triệu) KHÔNG đòi; bậc đấu thầu chính thức ở cuối. Ngưỡng cấp kép 1 tỷ: một chữ ký. */
const BAC_THUONG = { so_ncc_toi_thieu: 1, award_vai_khac_nhau: false, ky_danh_sach_moi: false, xoay_vong_n: 0, award_so_chu_ky: 1, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: false, dau_thau_chinh_thuc: false };
const BAC = [
  { tu_so_tien: 0, khai_xung_dot: true, ...BAC_THUONG },
  { tu_so_tien: 100_000_000, khai_xung_dot: false, ...BAC_THUONG },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];
/** Bậc 0 — đòi khai. */
const GIA_DOI_KHAI = "50000000.00";
/** Bậc 1 — không đòi khai. */
const GIA_KHONG_DOI = "200000000.00";

// ---- Dàn cảnh --------------------------------------------------------------------------------
let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let unsealPool: pg.Pool;
let goc = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi extends NguoiPhien {
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  readonly daBat: boolean;
  /** PROCUREMENT_MANAGER — tạo gói, mời, nộp, mở, yêu cầu mở thầu. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER — người ký duyệt gói; người đề xuất trao thầu. */
  readonly pm2: Nguoi;
  /** PROCUREMENT_MANAGER — người ký thứ hai; người chấm. */
  readonly pm3: Nguoi;
  /** FINANCE — khai phiên bản chính sách có bậc. */
  readonly tc: Nguoi;
  /** FINANCE — ký phiên bản ấy; xác minh nhà cung cấp; huỷ trao thầu. */
  readonly tc2: Nguoi;
  /** FINANCE thứ ba — không tác giả, không ký bản v2: người ký thô *chưa khai* ở phép đột biến cổng chữ ký duyệt trao thầu. */
  readonly tc3: Nguoi;
  /** DIRECTOR — duyệt mở thầu; ký duyệt trao thầu. */
  readonly gd: Nguoi;
  /** TECHNICAL — người nhập hồ sơ nhà cung cấp. */
  readonly nhap: NguoiPhien;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(batS3 = true): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`xd-${randomBytes(4).toString("hex")}`]);
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
  const tc = await nguoi("FINANCE");
  const tc2 = await nguoi("FINANCE");
  const tc3 = await nguoi("FINANCE");
  const gd = await nguoi("DIRECTOR");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "1000000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  if (batS3) {
    const v2 = (
      await withTenant(apiPool, org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, eval_components, bafo_top_n, " +
            "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
            "VALUES ($1, 2, '1000000000.00', 'VND', $2::jsonb, $3::jsonb, 0, 30, 12, true, now(), $4, $5) RETURNING id",
          [org, JSON.stringify(BAC), TP_GIA, tc.u, tc.s],
        ),
      )
    ).rows[0]!.id;
    await withTenant(apiPool, org, (c) =>
      c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [org, v2, tc2.u, tc2.s]),
    );
  } else {
    // Tổ chức chưa bật vẫn cần trọng số để chấm được: phiên bản 2 KHÔNG bậc, không chữ ký.
    await withTenant(apiPool, org, (c) =>
      c.query(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, created_by, created_by_session_id) " +
          "VALUES ($1, 2, '1000000000.00', 'VND', $2::jsonb, 0, $3, $4)",
        [org, TP_GIA, pm.s, pm.s].map((x, i) => (i === 2 ? pm.u : x)),
      ),
    );
  }
  const nhap = await nguoiNhapNhaCungCap(db.pool, org);
  return { org, daBat: batS3, pm, pm2, pm3, tc, tc2, tc3, gd, nhap };
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

interface Ncc {
  readonly ncc: string;
  readonly lh: string;
}

/** Một nhà cung cấp ĐẾM ĐƯỢC cho K2 (hồ sơ do người nhập dựng, `tc2` xác minh) — tổ chức chưa bật thì hồ sơ thô. */
async function ncc(t: ToChuc): Promise<Ncc> {
  if (!t.daBat) {
    const id = await motId("INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id", [
      t.org,
      `NCC ${randomBytes(3).toString("hex")}`,
      `0${String(100000000 + Math.floor(Math.random() * 899999999))}`,
      t.nhap.u,
      t.nhap.s,
    ]);
    const lh = await motId(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
      [t.org, id, `${randomBytes(4).toString("hex")}@vidu.vn`, t.nhap.u, t.nhap.s],
    );
    return { ncc: id, lh };
  }
  const n = (await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc2, nguoiNhap: t.nhap, soLuong: 1 }))[0]!;
  return { ncc: n.ncc, lh: n.lh };
}

interface Goi {
  readonly rfqId: string;
  readonly ncc: Ncc;
  readonly loiMoi: string;
}

/** Gói DRAFT có ngân sách, nhóm hàng, một hạng mục và MỘT lời mời tới một nhà cung cấp đếm được — người tạo `pm`. */
async function goiNhap(t: ToChuc, giaTri = GIA_DOI_KHAI): Promise<Goi> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  const n = await ncc(t);
  const loiMoi = (
    await withTenant(apiPool, t.org, (c) =>
      createInvitation(c, t.org, { rfqId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.pm.s }, auditPool),
    )
  ).id;
  return { rfqId, ncc: n, loiMoi };
}

interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
}
/** [S1.283 / S3.4b] Một người mới mang `vai` trong tổ chức — không phiên. */
async function nguoiMoi(org: string, vai: string): Promise<string> {
  const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $2, 'ACTIVE') RETURNING id", [
    org,
    `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
  ]);
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
  return u;
}
/** [S1.283 / S3.4b] Một phiên MỚI của người `u` — `USER` hay `AGENT_READONLY` (khuôn `man-kiem-soat.int.test.ts`). */
async function phienMoi(org: string, u: string, kind: "USER" | "AGENT_READONLY"): Promise<{ u: string; s: string; cookie: string }> {
  const token = randomBytes(32).toString("base64url");
  const s = await motId(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, kind) VALUES ($1, $2, $3, now() + interval '20 minutes', now(), $4) RETURNING id",
    [org, u, createHash("sha256").update(token, "utf8").digest(), kind],
  );
  return { u, s, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
}
async function demTuChoiQuyen(org: string, actor: string): Promise<number> {
  return Number(
    (await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'", [org, actor]))
      .rows[0]!.n,
  );
}
async function goi(method: string, duong: string, cookie: string, than?: unknown): Promise<PhanHoi> {
  const res = await fetch(`${goc}${duong}`, {
    method,
    headers: than === undefined ? { cookie } : { cookie, "content-type": "application/json" },
    body: than === undefined ? undefined : JSON.stringify(than),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // thân không phải JSON
  }
  return { status: res.status, body };
}
const nop = (t: ToChuc, rfqId: string): Promise<PhanHoi> => goi("POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
const mo = (t: ToChuc, rfqId: string): Promise<PhanHoi> => goi("POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
const khai = (rfqId: string, ai: Nguoi, than: Record<string, unknown>): Promise<PhanHoi> => goi("POST", `/rfqs/${rfqId}/coi-declarations`, ai.cookie, than);
const docKhai = (rfqId: string, ai: Nguoi): Promise<PhanHoi> => goi("GET", `/rfqs/${rfqId}/coi-declarations`, ai.cookie);
const khongXungDot = (rfqId: string, ai: Nguoi): Promise<PhanHoi> => khai(rfqId, ai, { trangThai: "KHONG_XUNG_DOT" });

/** Người ký gửi lại lần nộp VỪA ĐỌC (ADR-117) qua route. */
async function duyet(t: ToChuc, rfqId: string, ai: Nguoi): Promise<PhanHoi> {
  const lan = (await db.pool.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]!.n;
  return goi("POST", `/rfqs/${rfqId}/approve`, ai.cookie, { lanNop: lan });
}

async function tuChoiChot(org: string, resourceId: string): Promise<{ ma: unknown; actorId: string | null; loai: string }[]> {
  const { rows } = await db.pool.query<{ payload: Record<string, unknown> | null; actor_id: string | null; resource_type: string }>(
    "SELECT payload, actor_id, resource_type FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, resourceId],
  );
  return rows.map((h) => ({ ma: h.payload?.ma, actorId: h.actor_id, loai: h.resource_type }));
}

async function trangThai(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

interface LoiBat {
  readonly message: string;
  readonly code: string;
  readonly constraint: string;
  readonly name: string;
  readonly lyDo: string;
}
async function loi(p: Promise<unknown>): Promise<LoiBat | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string; constraint?: string; lyDo?: string };
    return { message: x.message, code: x.code ?? "", constraint: x.constraint ?? "", name: x.name, lyDo: x.lyDo ?? "" };
  }
}

/** ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: câu đột biến chạy dưới chủ cụm, rồi `viec` dưới `app_api` trong tổ chức. */
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
async function defDotBien(ham: string, cu: string, moiChuoi: string): Promise<string> {
  const goc0 = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc0.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  return goc0.replace(cu, moiChuoi);
}

const HAM_CHOT = "public.coi_chot_hanh_dong(uuid, uuid, uuid)";
const HAM_CHOT_XM = "public.coi_chot_xac_minh(uuid, uuid, uuid)";
const HAM_CHOT_MO = "public.rfq_chot_chu_ky_xung_dot(uuid, uuid)";
const HAM_CON_HIEU_LUC = "public.rfq_chu_ky_con_hieu_luc(uuid, uuid)";
const HAM_KHAI = "public.coi_kiem_khai_bao()";

/** Câu ký duyệt viết tay dưới `app_api` — qua đúng các trigger của `rfq_approvals`. */
const CAU_KY_THO =
  "INSERT INTO public.rfq_approvals (org_id, rfq_id, approver_user_id, session_id, lan_nop_da_xem) " +
  "VALUES ($1, $2, $3, $4, (SELECT lan_nop FROM public.rfq_packages WHERE id = $2))";
const CAU_MO_THO = "UPDATE public.rfq_packages SET status = 'OPEN', opened_by = $2, opened_by_session_id = $3, opened_at = now() WHERE id = $1";
const CAU_KHAI_THO =
  "INSERT INTO public.coi_declarations (org_id, rfq_id, user_id, session_id, trang_thai, supplier_id) VALUES ($1, $2, $3, $4, $5, $6)";

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
  unsealPool = createPool(db.connectionString, 2, { role: "app_unseal" });
  const services: ApiServices = { ...dichVuTest().services, orgKeyProvisioner: boBocGia };
  goc = await dungServer(createDispatcher({ pool: apiPool, auditPool, services }));
}, 180000);

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

// ---- Gói đã mở thầu thật: nộp → khai + ký → mở → một báo giá niêm phong giả → đóng → mở thầu (bản rõ ghi thẳng dưới app_unseal) ----
interface GoiDaMoThau extends Goi {
  readonly bidVersionId: string;
}

/** Phong bì GIẢ, bản rõ ghi thẳng — khuôn `packages/danh-gia/src/luot-danh-gia.int.test.ts`. Tệp này đo cổng K9, không đo mật mã. */
async function nopBaoGia(t: ToChuc, g: Goi): Promise<string> {
  // Token đúc lúc mở gói (`076`, ADR-113) ở tổ chức đã bật; ở tổ chức chưa bật, route mời đúc — hàm gói thì không, nên fixture đúc thẳng.
  const daCo = (await db.pool.query<{ id: string }>("SELECT id FROM rfq_invitation_tokens WHERE invitation_id = $1 AND purpose = 'BID_SUBMISSION' ORDER BY expires_at DESC LIMIT 1", [g.loiMoi])).rows[0]?.id;
  const tokenId =
    daCo ??
    (await motId(
      "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
        "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
      [t.org, g.loiMoi, randomBytes(32), t.pm.u, t.pm.s],
    ));
  const tt = await motId(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at, consumed_at) " +
      "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
    [t.org, g.loiMoi, tokenId, g.ncc.lh, randomBytes(32), randomBytes(32)],
  );
  const pk = await motId(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [t.org, g.loiMoi, tt, randomBytes(32), g.ncc.lh],
  );
  return await withTenant(apiPool, t.org, async (c) => {
    const bidId = (await c.query<{ id: string }>("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [t.org, g.loiMoi])).rows[0]!.id;
    const versionId = (
      await c.query<{ id: string }>("INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id", [
        t.org,
        bidId,
        Buffer.alloc(64, 9),
        pk,
      ])
    ).rows[0]!.id;
    await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
      t.org,
      versionId,
      `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${g.rfqId}\nbid_id=${bidId}\nversion=1\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-10-07T00:00:00.000000Z\n`,
      Buffer.alloc(70, 7),
    ]);
    return versionId;
  });
}

async function moThau(t: ToChuc, g: Goi, bidVersionId: string): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [g.rfqId, t.pm.u, t.pm.s],
  );
  const yc = await withTenant(apiPool, t.org, (c) => requestUnseal(c, t.org, { rfqId: g.rfqId, reason: "den gio mo thau", actorSessionId: t.pm.s }, auditPool));
  await withTenant(apiPool, t.org, (c) => approveUnseal(c, t.org, { unsealRequestId: yc.id, actorSessionId: t.gd.s }, auditPool));
  await withTenant(unsealPool, t.org, async (c) => {
    await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
      t.org,
      yc.id,
      bidVersionId,
      JSON.stringify({ totalAmount: "48000000.00", currency: "VND" }),
    ]);
    await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [g.rfqId]);
    await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [yc.id]);
  });
}

/** Gói ở `UNSEALED` với một báo giá đã mở — `pm2` đã khai và ký, `pm` mở. */
async function goiDaMoThau(t: ToChuc): Promise<GoiDaMoThau> {
  const g = await goiNhap(t);
  expect((await nop(t, g.rfqId)).status).toBe(200);
  if (t.daBat) expect((await khongXungDot(g.rfqId, t.pm2)).status).toBe(201);
  expect((await duyet(t, g.rfqId, t.pm2)).status).toBe(200);
  expect((await mo(t, g.rfqId)).status).toBe(200);
  const bidVersionId = await nopBaoGia(t, g);
  await moThau(t, g, bidVersionId);
  expect(await trangThai(g.rfqId)).toBe("UNSEALED");
  return { ...g, bidVersionId };
}

// ==============================================================================================
describe("[S1.281 / S3.4a / K9] khai báo và chữ ký mở gói — route, băm danh sách, CO_XUNG_DOT vĩnh viễn", { timeout: 180000 }, () => {
  it("[INV-K9] đối chứng dương: chưa khai ⇒ 422 mang mã + MỘT hàng CONTROL_DENIED của chính người ký; khai KHONG_XUNG_DOT ⇒ ký được; route đọc trả khai báo, băm hiện tại, bậc đòi khai, chốt", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    expect((await nop(t, g.rfqId)).status).toBe(200);

    const truoc = await docKhai(g.rfqId, t.pm2);
    expect(truoc.status).toBe(200);
    const kb0 = truoc.body.khaiBao as { khaiBao: unknown[]; danhSachBamHienTai: string; bacDoiKhai: boolean; chot: string | null };
    expect(kb0.khaiBao).toEqual([]);
    expect(kb0.bacDoiKhai).toBe(true);
    expect(kb0.chot).toBe("K9_CHUA_KHAI_XUNG_DOT");
    expect(kb0.danhSachBamHienTai).toMatch(/^[0-9a-f]{64}$/u);
    // [S1.283 / S3.4b] Lời đọc nói tổ chức đã bật — `/mo-thau` dựa vào nó để hiện khối khai báo.
    expect((truoc.body.khaiBao as { toChucDaBat: unknown }).toChucDaBat).toBe(true);

    const chan = await duyet(t, g.rfqId, t.pm2);
    expect(chan.status).toBe(422);
    expect(chan.body).toEqual({ error: TD.K9_CHUA_KHAI_XUNG_DOT.thongDiep, ma: "K9_CHUA_KHAI_XUNG_DOT" });
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K9_CHUA_KHAI_XUNG_DOT", actorId: t.pm2.u, loai: "RFQ" }]);
    expect(await db.pool.query("SELECT 1 FROM rfq_approvals WHERE rfq_id = $1", [g.rfqId]).then((r) => r.rowCount)).toBe(0);

    const kb = await khongXungDot(g.rfqId, t.pm2);
    expect(kb.status).toBe(201);
    const hang = kb.body.khaiBao as { trangThai: string; supplierId: string | null; danhSachBam: string };
    expect(hang).toMatchObject({ trangThai: "KHONG_XUNG_DOT", supplierId: null, danhSachBam: kb0.danhSachBamHienTai });

    const sau = (await docKhai(g.rfqId, t.pm2)).body.khaiBao as { khaiBao: { trangThai: string }[]; chot: string | null };
    expect(sau.khaiBao.map((k) => k.trangThai)).toEqual(["KHONG_XUNG_DOT"]);
    expect(sau.chot).toBeNull();
    // Khai báo của người khác KHÔNG ra ngoài route đọc (K11): `pm3` thấy sổ của chính mình, rỗng.
    expect(((await docKhai(g.rfqId, t.pm3)).body.khaiBao as { khaiBao: unknown[] }).khaiBao).toEqual([]);

    expect((await duyet(t, g.rfqId, t.pm2)).status).toBe(200);
    expect(await tuChoiChot(t.org, g.rfqId)).toHaveLength(1);
    // Sổ của lần khai: AI khai GÌ, không ghi chú.
    const so = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'COI_DECLARED' AND resource_id = $2",
      [t.org, g.rfqId],
    );
    expect(so.rows).toHaveLength(1);
    const { declarationId, ...conLai } = so.rows[0]!.payload;
    expect(typeof declarationId).toBe("string");
    expect(conLai).toEqual({ trangThai: "KHONG_XUNG_DOT", supplierId: null });
    expect((await mo(t, g.rfqId)).status).toBe(200);
  });

  it("[INV-K9] băm danh sách: khai rồi danh sách mời đổi ⇒ K9_KHAI_BAO_LOI_THOI, KHÔNG hàng sổ; khai lại ⇒ ký được", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    expect((await khongXungDot(g.rfqId, t.pm2)).status).toBe(201);
    const n2 = await ncc(t);
    await withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId: g.rfqId, supplierId: n2.ncc, contactId: n2.lh, actorSessionId: t.pm.s }, auditPool));
    expect((await nop(t, g.rfqId)).status).toBe(200);
    const doc = (await docKhai(g.rfqId, t.pm2)).body.khaiBao as { khaiBao: { danhSachBam: string }[]; danhSachBamHienTai: string; chot: string | null };
    expect(doc.khaiBao[0]!.danhSachBam).not.toBe(doc.danhSachBamHienTai);
    expect(doc.chot).toBe("K9_KHAI_BAO_LOI_THOI");
    const chan = await duyet(t, g.rfqId, t.pm2);
    expect(chan.status).toBe(422);
    expect(chan.body).toEqual({ error: TD.K9_KHAI_BAO_LOI_THOI.thongDiep, ma: "K9_KHAI_BAO_LOI_THOI" });
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([]);
    expect((await khongXungDot(g.rfqId, t.pm2)).status).toBe(201);
    expect((await duyet(t, g.rfqId, t.pm2)).status).toBe(200);
  });

  it("[INV-K9] CO_XUNG_DOT vĩnh viễn: không ký được ⇒ K9_CO_XUNG_DOT vào sổ; khai lại KHONG_XUNG_DOT ⇒ K9_KHONG_GO_DUOC_XUNG_DOT vào sổ; nhà cung cấp phải có lời mời; hình dạng đầu vào", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    expect((await nop(t, g.rfqId)).status).toBe(200);
    // Hình dạng: CO_XUNG_DOT không nhà cung cấp, KHONG_XUNG_DOT kèm nhà cung cấp, trạng thái lạ — 422 của gói, không hàng nào.
    // Câu của GÓI, không phải của CHECK `coi_declarations_hinh_dang` — đột biến bỏ kiểm hình dạng ở gói thì CHECK vẫn chặn (422) nhưng
    // câu đổi; khẳng định câu để đột biến ấy chết.
    const h1 = await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT" });
    expect([h1.status, h1.body.error]).toEqual([422, "Khai có xung đột lợi ích thì phải nêu nhà cung cấp."]);
    const h2 = await khai(g.rfqId, t.pm2, { trangThai: "KHONG_XUNG_DOT", supplierId: g.ncc.ncc });
    expect([h2.status, h2.body.error]).toEqual([422, "Khai không xung đột lợi ích thì không nêu nhà cung cấp nào."]);
    const h3 = await khai(g.rfqId, t.pm2, { trangThai: "CO_LE" });
    expect([h3.status, h3.body.error]).toEqual([422, "Trạng thái khai báo phải là KHONG_XUNG_DOT hoặc CO_XUNG_DOT."]);
    // Nhà cung cấp KHÔNG có lời mời của gói: trigger từ chối (không tên, không sổ).
    const la = await ncc(t);
    const sai = await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: la.ncc });
    expect(sai.status).toBe(422);
    expect(String(sai.body.error)).toMatch(/phai co loi moi/u);
    expect(await db.pool.query("SELECT 1 FROM coi_declarations WHERE rfq_id = $1", [g.rfqId]).then((r) => r.rowCount)).toBe(0);

    const co = await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc, ghiChu: "  Em ruot lam giam doc o day.  " });
    expect(co.status).toBe(201);
    expect(co.body.khaiBao).toMatchObject({ trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc, ghiChu: "Em ruot lam giam doc o day." });
    const chan = await duyet(t, g.rfqId, t.pm2);
    expect(chan.status).toBe(422);
    expect(chan.body).toEqual({ error: TD.K9_CO_XUNG_DOT.thongDiep, ma: "K9_CO_XUNG_DOT" });
    const go = await khongXungDot(g.rfqId, t.pm2);
    expect(go.status).toBe(422);
    expect(go.body).toEqual({ error: TD.K9_KHONG_GO_DUOC_XUNG_DOT.thongDiep, ma: "K9_KHONG_GO_DUOC_XUNG_DOT" });
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([
      { ma: "K9_CO_XUNG_DOT", actorId: t.pm2.u, loai: "RFQ" },
      { ma: "K9_KHONG_GO_DUOC_XUNG_DOT", actorId: t.pm2.u, loai: "RFQ" },
    ]);
    // Người khác ký thì qua; bảng chỉ ghi thêm.
    expect((await khongXungDot(g.rfqId, t.pm3)).status).toBe(201);
    expect((await duyet(t, g.rfqId, t.pm3)).status).toBe(200);
    const xoa = await loi(withTenant(apiPool, t.org, (c) => c.query("DELETE FROM public.coi_declarations WHERE rfq_id = $1", [g.rfqId])));
    expect(xoa?.code).toBe("42501");
  });

  it("[INV-K9] bậc KHÔNG đòi khai: ký không cần khai; nhưng CO_XUNG_DOT vẫn chặn ở mọi bậc, và khai CÓ xung đột SAU khi ký làm chữ ký thôi đếm ⇒ cạnh mở gói K9_CHU_KY_CO_XUNG_DOT vào sổ; chữ ký của người khác cứu", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t, GIA_KHONG_DOI);
    expect((await nop(t, g.rfqId)).status).toBe(200);
    const doc = (await docKhai(g.rfqId, t.pm2)).body.khaiBao as { bacDoiKhai: boolean; chot: string | null };
    expect(doc).toMatchObject({ bacDoiKhai: false, chot: null });
    expect((await duyet(t, g.rfqId, t.pm2)).status).toBe(200);
    // Khai CÓ xung đột SAU khi ký — khai được ở mọi trạng thái.
    expect((await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc })).status).toBe(201);
    const chan = await mo(t, g.rfqId);
    expect(chan.status).toBe(422);
    expect(chan.body).toEqual({ error: TD.K9_CHU_KY_CO_XUNG_DOT.thongDiep, ma: "K9_CHU_KY_CO_XUNG_DOT" });
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K9_CHU_KY_CO_XUNG_DOT", actorId: t.pm.u, loai: "RFQ" }]);
    expect(await trangThai(g.rfqId)).toBe("PENDING_APPROVAL");
    // Hàm vị từ: chữ ký khớp băm 1, còn hiệu lực 0.
    const dem = await withTenant(apiPool, t.org, (c) =>
      c.query<{ khop: string; hieu_luc: string; chot: string | null }>(
        "SELECT (SELECT count(*) FROM public.rfq_chu_ky_khop_bam($1, $2)) AS khop, (SELECT count(*) FROM public.rfq_chu_ky_con_hieu_luc($1, $2)) AS hieu_luc, public.rfq_chot_chu_ky_xung_dot($1, $2) AS chot",
        [t.org, g.rfqId],
      ),
    );
    expect(dem.rows[0]).toEqual({ khop: "1", hieu_luc: "0", chot: "K9_CHU_KY_CO_XUNG_DOT" });
    // Bậc không đòi khai nhưng CO_XUNG_DOT chặn chính người ấy ở mọi cổng — ký lại cũng không.
    const kyLai = await duyet(t, g.rfqId, t.pm2);
    expect(kyLai.status).toBe(422);
    expect(kyLai.body.ma).toBe("K9_CO_XUNG_DOT");
    expect((await duyet(t, g.rfqId, t.pm3)).status).toBe(200);
    expect((await mo(t, g.rfqId)).status).toBe(200);
  });

  it("[INV-K9] lớp chặn cuối: câu ký viết tay dưới `app_api` ⇒ 23514 mang tên `k9_chua_khai_xung_dot`; ĐỘT BIẾN tắt trigger, hay thân vị từ `RETURN NULL`, ⇒ cùng câu đi qua", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    expect((await nop(t, g.rfqId)).status).toBe(200);
    const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_KY_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s])));
    expect(e).toMatchObject({ code: "23514", constraint: "k9_chua_khai_xung_dot", message: "Chua ky duyet goi thau duoc (K9): K9_CHUA_KHAI_XUNG_DOT" });
    const qua = await trongDotBien(t.org, ["ALTER TABLE public.rfq_approvals DISABLE TRIGGER rfq_approvals_kiem_xung_dot"], (c) =>
      c.query(CAU_KY_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s]),
    );
    expect(qua.rowCount).toBe(1);
    const defTat = await defDotBien(HAM_CHOT, "RETURN 'K9_CHUA_KHAI_XUNG_DOT';", "RETURN NULL;");
    const qua2 = await trongDotBien(t.org, [defTat], (c) => c.query(CAU_KY_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s]));
    expect(qua2.rowCount).toBe(1);
    // Vế CO_XUNG_DOT: khai có xung đột, rồi đột biến bỏ vế ấy khỏi hàm vị từ ⇒ người có xung đột ký được.
    expect((await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc })).status).toBe(201);
    const e2 = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_KY_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s])));
    expect(e2).toMatchObject({ code: "23514", constraint: "k9_co_xung_dot" });
    // Bỏ vế CO_XUNG_DOT (`NULL;` — câu rỗng của PL/pgSQL, dòng chảy đi tiếp) thì người ấy rơi xuống vế *khai báo lỗi thời* — có
    // hàng khai (chính hàng CO_XUNG_DOT) mà không hàng KHONG_XUNG_DOT nào mang băm hiện tại — nên vẫn bị chặn ở vế sau; bỏ CẢ HAI vế
    // mới đi qua: đột biến phải giết đúng vế nó nhắm.
    const defCo = await defDotBien(HAM_CHOT, "RETURN 'K9_CO_XUNG_DOT';", "NULL;");
    const e3 = await loi(trongDotBien(t.org, [defCo], (c) => c.query(CAU_KY_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s])));
    expect(e3).toMatchObject({ code: "23514", constraint: "k9_khai_bao_loi_thoi" });
    const defCaHai = defCo.replace("RETURN 'K9_KHAI_BAO_LOI_THOI';", "RETURN NULL;");
    expect(defCaHai).not.toBe(defCo);
    const qua3 = await trongDotBien(t.org, [defCaHai], (c) => c.query(CAU_KY_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s]));
    expect(qua3.rowCount).toBe(1);
  });

  it("[INV-K9] ĐỘT BIẾN luật khai: tắt vế *không gỡ được CO_XUNG_DOT* của `coi_kiem_khai_bao` ⇒ hàng KHONG_XUNG_DOT sau CO_XUNG_DOT đi lọt", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    expect((await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc })).status).toBe(201);
    const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_KHAI_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s, "KHONG_XUNG_DOT", null])));
    expect(e).toMatchObject({ code: "23514", constraint: "k9_khong_go_duoc_xung_dot" });
    const def = await defDotBien(HAM_KHAI, "AND d.trang_thai = 'CO_XUNG_DOT') THEN", "AND false) THEN");
    const qua = await trongDotBien(t.org, [def], (c) => c.query(CAU_KHAI_THO, [t.org, g.rfqId, t.pm2.u, t.pm2.s, "KHONG_XUNG_DOT", null]));
    expect(qua.rowCount).toBe(1);
  });

  it("[INV-K9] ĐỘT BIẾN cạnh mở gói: bỏ vế loại trừ khỏi `rfq_chu_ky_con_hieu_luc` ⇒ gói mở bằng chữ ký của người đã khai có xung đột; tắt riêng trigger K9 ⇒ K4b vẫn chặn nhưng KHÔNG tên", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t, GIA_KHONG_DOI);
    expect((await nop(t, g.rfqId)).status).toBe(200);
    expect((await duyet(t, g.rfqId, t.pm2)).status).toBe(200);
    expect((await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc })).status).toBe(201);
    const e = await loi(trongDotBien(t.org, [], (c) => c.query(CAU_MO_THO, [g.rfqId, t.pm.u, t.pm.s])));
    expect(e).toMatchObject({ code: "23514", constraint: "k9_chu_ky_co_xung_dot" });
    const defBo = await defDotBien(
      HAM_CON_HIEU_LUC,
      "WHERE NOT EXISTS (SELECT 1 FROM public.coi_declarations d",
      "WHERE true OR NOT EXISTS (SELECT 1 FROM public.coi_declarations d",
    );
    // Câu mở thô cũng cần khoá RFQ và vật liệu khoá — `openRfq` làm việc ấy; ở đây chỉ đo tới cạnh: không trigger K9/K4b nào chặn
    // nữa thì lỗi (nếu có) phải là của lớp khác, không mang tên K9 và không nói *CON HIEU LUC*.
    const sau = await loi(trongDotBien(t.org, [defBo], (c) => c.query(CAU_MO_THO, [g.rfqId, t.pm.u, t.pm.s])));
    expect(sau?.constraint ?? "").not.toMatch(/^k9_/u);
    expect(sau?.message ?? "").not.toMatch(/CON HIEU LUC|K9/u);
    const tat = await loi(trongDotBien(t.org, ["ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_chu_ky_xung_dot_khi_mo"], (c) => c.query(CAU_MO_THO, [g.rfqId, t.pm.u, t.pm.s])));
    expect(tat).toMatchObject({ code: "23514", constraint: "" });
    expect(tat?.message).toMatch(/CON HIEU LUC.*\(K4b\)/u);
    const defMo = await defDotBien(HAM_CHOT_MO, "RETURN 'K9_CHU_KY_CO_XUNG_DOT';", "RETURN NULL;");
    const tat2 = await loi(trongDotBien(t.org, [defMo], (c) => c.query(CAU_MO_THO, [g.rfqId, t.pm.u, t.pm.s])));
    expect(tat2).toMatchObject({ code: "23514", constraint: "" });
  });
});

// ==============================================================================================
describe("[S1.281 / S3.4a / K9] bốn cổng sau mở thầu, xác minh, ghi nhận tín hiệu", { timeout: 300000 }, () => {
  it("[INV-K9] lượt chấm, đề xuất, chữ ký duyệt, huỷ trao thầu: mỗi cổng chặn người chưa khai kèm hàng sổ, khai rồi qua; hàng APPROVED đòi một chữ ký của người không có xung đột", async () => {
    const t = await taoToChuc();
    const g = await goiDaMoThau(t);
    const trong = (c: pg.PoolClient): pg.PoolClient => c;
    // ⑴ lượt chấm — pm3 chưa khai.
    const e1 = await loi(withTenant(apiPool, t.org, (c) => taoLuotDanhGia(trong(c), t.org, { rfqId: g.rfqId, actorSessionId: t.pm3.s }, auditPool)));
    expect(e1).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K9_CHUA_KHAI_XUNG_DOT" });
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K9_CHUA_KHAI_XUNG_DOT", actorId: t.pm3.u, loai: "RFQ" }]);
    expect((await khongXungDot(g.rfqId, t.pm3)).status).toBe(201);
    await withTenant(apiPool, t.org, (c) => taoLuotDanhGia(c, t.org, { rfqId: g.rfqId, actorSessionId: t.pm3.s }, auditPool));
    expect(await trangThai(g.rfqId)).toBe("EVALUATING");
    // [S1.283 / S3.4b · lượt đi thử T4] Hàng xếp hạng mang mã nhà cung cấp — khối khai báo ở `/mo-thau` chọn *có xung đột với* từ đó
    // khi bảng so sánh đã đóng (AWARDED, lúc người duyệt trao thầu ký).
    const bxh = await goi("GET", `/rfqs/${g.rfqId}/ranking`, t.pm3.cookie);
    expect((bxh.body.ranking as { rows: { supplierId: unknown }[] }).rows.map((h) => h.supplierId)).toEqual([g.ncc.ncc]);
    // ⑵ đề xuất — pm2 đã khai từ lúc ký; khai CÓ xung đột (sau khi ký) thì không đề xuất được; pm3 đề xuất thay.
    expect((await khai(g.rfqId, t.pm2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc })).status).toBe(201);
    const e2 = await loi(withTenant(apiPool, t.org, (c) => deXuatTraoThau(c, t.org, { rfqId: g.rfqId, bidVersionId: g.bidVersionId, reason: "gia tot", actorSessionId: t.pm2.s }, auditPool)));
    expect(e2).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K9_CO_XUNG_DOT" });
    const dx = await withTenant(apiPool, t.org, (c) => deXuatTraoThau(c, t.org, { rfqId: g.rfqId, bidVersionId: g.bidVersionId, reason: "gia tot", actorSessionId: t.pm3.s }, auditPool));
    expect(dx.status).toBe("PROPOSED");
    // [S1.289 / S3.6c / K10c] Fixture đóng gói SỚM khi đã có báo giá ⇒ tín hiệu đóng sớm chặn chữ ký trao thầu (hàm gói hỏi K10 TRƯỚC K9);
    // một DIRECTOR MỚI (ngoài gói, không dùng ở ca nào dưới đây làm *người chưa khai*) khai không xung đột rồi ghi nhận — chính lần ghi
    // nhận cũng là một cổng K9 (ADR-082 ⒄).
    const gdDoc = await phienMoi(t.org, await nguoiMoi(t.org, "DIRECTOR"), "USER");
    expect((await khongXungDot(g.rfqId, gdDoc)).status).toBe(201);
    await withTenant(apiPool, t.org, (c) => ghiNhanTinHieu(c, t.org, { rfqId: g.rfqId, lyDo: "Da doc tin hieu dong som", actorSessionId: gdDoc.s, loai: "EARLY_CLOSE" }, auditPool));
    // ⑶ chữ ký duyệt — gd chưa khai.
    const e3 = await loi(withTenant(apiPool, t.org, (c) => duyetTraoThau(c, t.org, { rfqId: g.rfqId, awardId: dx.awardId, actorSessionId: t.gd.s }, auditPool)));
    expect(e3).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K9_CHUA_KHAI_XUNG_DOT" });
    expect(await db.pool.query("SELECT 1 FROM rfq_award_approvals WHERE award_id = $1", [dx.awardId]).then((r) => r.rowCount)).toBe(0);
    // Hàng APPROVED thô: chữ ký thô của gd (đã khai), rồi gd khai CÓ xung đột, rồi hàng APPROVED ⇒ ~~`k9_chu_ky_co_xung_dot`~~
    // [S1.283 / S3.4b] `k7_thieu_chu_ky`: `award_du_chu_ky` (trigger K7 của cạnh APPROVED, xếp TRƯỚC `_kiem_xung_dot`) không đếm
    // chữ ký của người đã khai xung đột (`115`), nên nhánh APPROVED riêng của K9 thôi tồn tại — chặn sớm hơn, cùng ca.
    expect((await khongXungDot(g.rfqId, t.gd)).status).toBe(201);
    const eA = await loi(
      trongDotBien(t.org, [], async (c) => {
        await c.query("INSERT INTO public.rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [t.org, dx.awardId, t.gd.u, t.gd.s]);
        await c.query(CAU_KHAI_THO, [t.org, g.rfqId, t.gd.u, t.gd.s, "CO_XUNG_DOT", g.ncc.ncc]);
        await c.query(
          "INSERT INTO public.rfq_awards (org_id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_by_session_id) VALUES ($1, $2, $3, $4, 'APPROVED', 'duyet', $5, $6)",
          [t.org, g.rfqId, dx.evaluationId, g.bidVersionId, t.gd.u, t.gd.s],
        );
      }),
    );
    expect(eA).toMatchObject({ code: "23514", constraint: "k7_thieu_chu_ky" });
    const dy = await withTenant(apiPool, t.org, (c) => duyetTraoThau(c, t.org, { rfqId: g.rfqId, awardId: dx.awardId, actorSessionId: t.gd.s }, auditPool));
    expect(dy.status).toBe("APPROVED");
    expect(await trangThai(g.rfqId)).toBe("AWARDED");
    // ⑷ huỷ — tc2 chưa khai.
    const e4 = await loi(withTenant(apiPool, t.org, (c) => huyTraoThau(c, t.org, { rfqId: g.rfqId, awardId: dy.awardId, reason: "nha cung cap rut lui", actorSessionId: t.tc2.s }, auditPool)));
    expect(e4).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K9_CHUA_KHAI_XUNG_DOT" });
    expect(await trangThai(g.rfqId)).toBe("AWARDED");
    expect((await khongXungDot(g.rfqId, t.tc2)).status).toBe(201);
    const huy = await withTenant(apiPool, t.org, (c) => huyTraoThau(c, t.org, { rfqId: g.rfqId, awardId: dy.awardId, reason: "nha cung cap rut lui", actorSessionId: t.tc2.s }, auditPool));
    expect(huy.status).toBe("CANCELLED");
    expect(await trangThai(g.rfqId)).toBe("EVALUATING");
    expect((await tuChoiChot(t.org, g.rfqId)).map((h) => [h.ma, h.actorId])).toEqual([
      ["K9_CHUA_KHAI_XUNG_DOT", t.pm3.u],
      ["K9_CO_XUNG_DOT", t.pm2.u],
      ["K9_CHUA_KHAI_XUNG_DOT", t.gd.u],
      ["K9_CHUA_KHAI_XUNG_DOT", t.tc2.u],
    ]);
    // ĐỘT BIẾN bốn trigger: tắt từng cái thì câu thô của người chưa khai đi lọt.
    const chinhSachGhim = (await db.pool.query<{ id: string }>("SELECT chinh_sach_ghim_id AS id FROM rfq_packages WHERE id = $1", [g.rfqId])).rows[0]!.id;
    const cauCham = "INSERT INTO public.rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) VALUES ($1, $2, $3, 'VND', $4, $5)";
    // `pm` (người tạo) chưa khai — một người mới trong tổ chức.
    const eC = await loi(trongDotBien(t.org, [], (c) => c.query(cauCham, [t.org, g.rfqId, chinhSachGhim, t.pm.u, t.pm.s])));
    expect(eC).toMatchObject({ code: "23514", constraint: "k9_chua_khai_xung_dot" });
    expect((await trongDotBien(t.org, ["ALTER TABLE public.rfq_evaluations DISABLE TRIGGER rfq_evaluations_kiem_xung_dot"], (c) => c.query(cauCham, [t.org, g.rfqId, chinhSachGhim, t.pm.u, t.pm.s]))).rowCount).toBe(1);
    const cauDeXuat =
      "INSERT INTO public.rfq_awards (org_id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_by_session_id) VALUES ($1, $2, $3, $4, 'PROPOSED', 'thu', $5, $6)";
    // `pm2` có CO_XUNG_DOT; tắt trigger thì đề xuất được.
    const eD = await loi(trongDotBien(t.org, [], (c) => c.query(cauDeXuat, [t.org, g.rfqId, dx.evaluationId, g.bidVersionId, t.pm2.u, t.pm2.s])));
    expect(eD).toMatchObject({ code: "23514", constraint: "k9_co_xung_dot" });
    expect((await trongDotBien(t.org, ["ALTER TABLE public.rfq_awards DISABLE TRIGGER rfq_awards_kiem_xung_dot"], (c) => c.query(cauDeXuat, [t.org, g.rfqId, dx.evaluationId, g.bidVersionId, t.pm2.u, t.pm2.s]))).rowCount).toBe(1);
    const dx2 = await withTenant(apiPool, t.org, (c) => deXuatTraoThau(c, t.org, { rfqId: g.rfqId, bidVersionId: g.bidVersionId, reason: "lai", actorSessionId: t.pm3.s }, auditPool));
    const cauKy = "INSERT INTO public.rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)";
    // `tc3` (FINANCE, po.approve) chưa khai — không dùng `tc`: tác giả bản v2, và `rfq_award_approvals_kiem_vai_theo_bac` (K7, `113`,
    // gộp S1.280) đứng TRƯỚC `_kiem_xung_dot` theo tên nên `k7_tac_gia_chinh_sach` nói trước K9.
    const eK = await loi(trongDotBien(t.org, [], (c) => c.query(cauKy, [t.org, dx2.awardId, t.tc3.u, t.tc3.s])));
    expect(eK).toMatchObject({ code: "23514", constraint: "k9_chua_khai_xung_dot" });
    expect((await trongDotBien(t.org, ["ALTER TABLE public.rfq_award_approvals DISABLE TRIGGER rfq_award_approvals_kiem_xung_dot"], (c) => c.query(cauKy, [t.org, dx2.awardId, t.tc3.u, t.tc3.s]))).rowCount).toBe(1);
  });

  it("[INV-K9] xác minh nhà cung cấp: người đã khai CÓ xung đột với nhà cung cấp không thu hồi xác minh của nó ⇒ K9_XAC_MINH_NCC_XUNG_DOT, hàng sổ mang SUPPLIER; ĐỘT BIẾN tắt trigger ⇒ câu thô đi lọt", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    expect((await khai(g.rfqId, t.tc2, { trangThai: "CO_XUNG_DOT", supplierId: g.ncc.ncc })).status).toBe(201);
    const e = await loi(withTenant(apiPool, t.org, (c) => thuHoiXacMinhNhaCungCap(c, t.org, { supplierId: g.ncc.ncc, reason: "ho so sai", actorSessionId: t.tc2.s }, auditPool)));
    expect(e).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K9_XAC_MINH_NCC_XUNG_DOT" });
    expect(await tuChoiChot(t.org, g.ncc.ncc)).toEqual([{ ma: "K9_XAC_MINH_NCC_XUNG_DOT", actorId: t.tc2.u, loai: "SUPPLIER" }]);
    // Người FINANCE khác thu hồi được; hàm vị từ trả lời theo (nhà cung cấp, người).
    const hoi = await withTenant(apiPool, t.org, (c) =>
      c.query<{ a: string | null; b: string | null }>("SELECT public.coi_chot_xac_minh($1, $2, $3) AS a, public.coi_chot_xac_minh($1, $2, $4) AS b", [t.org, g.ncc.ncc, t.tc2.u, t.tc.u]),
    );
    expect(hoi.rows[0]).toEqual({ a: "K9_XAC_MINH_NCC_XUNG_DOT", b: null });
    const cau = "INSERT INTO public.supplier_verifications (org_id, supplier_id, loai, ly_do, created_by, created_by_session_id) VALUES ($1, $2, 'REVOKED', 'ho so sai', $3, $4)";
    const eT = await loi(trongDotBien(t.org, [], (c) => c.query(cau, [t.org, g.ncc.ncc, t.tc2.u, t.tc2.s])));
    expect(eT).toMatchObject({ code: "23514", constraint: "k9_xac_minh_ncc_xung_dot" });
    expect((await trongDotBien(t.org, ["ALTER TABLE public.supplier_verifications DISABLE TRIGGER supplier_verifications_kiem_xung_dot"], (c) => c.query(cau, [t.org, g.ncc.ncc, t.tc2.u, t.tc2.s]))).rowCount).toBe(1);
    const defTat = await defDotBien(HAM_CHOT_XM, "RETURN 'K9_XAC_MINH_NCC_XUNG_DOT';", "RETURN NULL;");
    expect((await trongDotBien(t.org, [defTat], (c) => c.query(cau, [t.org, g.ncc.ncc, t.tc2.u, t.tc2.s]))).rowCount).toBe(1);
  });

  it("[INV-K9] ghi nhận tín hiệu chia nhỏ: người ghi nhận chưa khai ⇒ chặn kèm hàng sổ; khai rồi qua; ĐỘT BIẾN tắt trigger ⇒ câu thô đi lọt", async () => {
    const t = await taoToChuc();
    // Hai gói 60 + 50 triệu cùng nhóm hàng, mỗi gói dưới cận 100 triệu, tổng vượt: gói thứ hai mang tín hiệu lúc nộp.
    const g1 = await goiNhap(t, "60000000.00");
    expect((await nop(t, g1.rfqId)).status).toBe(200);
    const g2 = await goiNhap(t, "50000000.00");
    expect((await nop(t, g2.rfqId)).status).toBe(200);
    expect(await db.pool.query("SELECT 1 FROM governance_signals WHERE rfq_id = $1", [g2.rfqId]).then((r) => r.rowCount)).toBe(1);
    const e = await loi(withTenant(apiPool, t.org, (c) => ghiNhanTinHieu(c, t.org, { rfqId: g2.rfqId, lyDo: "hai cong trinh khac nhau", actorSessionId: t.pm2.s }, auditPool)));
    expect(e).toMatchObject({ name: "ChotKiemSoatError", lyDo: "K9_CHUA_KHAI_XUNG_DOT" });
    expect(await tuChoiChot(t.org, g2.rfqId)).toEqual([{ ma: "K9_CHUA_KHAI_XUNG_DOT", actorId: t.pm2.u, loai: "RFQ" }]);
    expect(await db.pool.query("SELECT 1 FROM governance_signal_acks a JOIN governance_signals s ON s.id = a.signal_id WHERE s.rfq_id = $1", [g2.rfqId]).then((r) => r.rowCount)).toBe(0);
    expect((await khongXungDot(g2.rfqId, t.pm2)).status).toBe(201);
    const gn = await withTenant(apiPool, t.org, (c) => ghiNhanTinHieu(c, t.org, { rfqId: g2.rfqId, lyDo: "hai cong trinh khac nhau", actorSessionId: t.pm2.s }, auditPool));
    expect(gn.ackId).toEqual(expect.any(String));
    const cau = "INSERT INTO public.governance_signal_acks (org_id, signal_id, ly_do, created_by, created_by_session_id) VALUES ($1, $2, 'thu', $3, $4)";
    // `pm3` giữ `rfq.approve`, không tạo gói nào, chưa khai.
    const eT = await loi(trongDotBien(t.org, [], (c) => c.query(cau, [t.org, gn.signalId, t.pm3.u, t.pm3.s])));
    expect(eT).toMatchObject({ code: "23514", constraint: "k9_chua_khai_xung_dot" });
    expect((await trongDotBien(t.org, ["ALTER TABLE public.governance_signal_acks DISABLE TRIGGER governance_signal_acks_kiem_xung_dot"], (c) => c.query(cau, [t.org, gn.signalId, t.pm3.u, t.pm3.s]))).rowCount).toBe(1);
  });

  it("[INV-K9] tổ chức CHƯA bật chạy như MVP1: không khai được, không cổng nào chặn — ký, mở, chấm, đề xuất, duyệt đều đi qua không khai báo", async () => {
    const t = await taoToChuc(false);
    const g = await goiNhap(t);
    const kb = await khongXungDot(g.rfqId, t.pm2);
    expect(kb.status).toBe(422);
    expect(String(kb.body.error)).toMatch(/da bat S3/u);
    const doc = (await docKhai(g.rfqId, t.pm2)).body.khaiBao as { bacDoiKhai: boolean; chot: string | null; khaiBao: unknown[] };
    expect(doc).toMatchObject({ bacDoiKhai: false, chot: null, khaiBao: [], toChucDaBat: false });
    const gm = await goiDaMoThau(t);
    await withTenant(apiPool, t.org, (c) => taoLuotDanhGia(c, t.org, { rfqId: gm.rfqId, actorSessionId: t.pm3.s }, auditPool));
    const dx = await withTenant(apiPool, t.org, (c) => deXuatTraoThau(c, t.org, { rfqId: gm.rfqId, bidVersionId: gm.bidVersionId, reason: "gia tot", actorSessionId: t.pm2.s }, auditPool));
    const dy = await withTenant(apiPool, t.org, (c) => duyetTraoThau(c, t.org, { rfqId: gm.rfqId, awardId: dx.awardId, actorSessionId: t.gd.s }, auditPool));
    expect(dy.status).toBe("APPROVED");
    expect(await tuChoiChot(t.org, gm.rfqId)).toEqual([]);
  });

  it("[S1.283 / S3.4b] cờ `coQuyenKhai` trên GET /rfqs/:id: người giữ `coi.declare` ⇒ true; DATA_STEWARD ⇒ false và đọc gói không để lại PERMISSION_DENIED (đối chứng: đọc khai báo thì để lại một); phiên agent ⇒ false", async () => {
    const t = await taoToChuc();
    const g = await goiNhap(t);
    const cua = async (cookie: string): Promise<PhanHoi> => {
      const r = await goi("GET", `/rfqs/${g.rfqId}`, cookie);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort(), "thân không mang danh sách ai giữ quyền").toEqual(["coQuyenKhai", "coQuyenMoi", "rfq"]);
      return r;
    };
    for (const ai of [t.pm, t.pm3, t.tc, t.gd]) expect((await cua(ai.cookie)).body.coQuyenKhai).toBe(true);
    const dl = await phienMoi(t.org, await nguoiMoi(t.org, "DATA_STEWARD"), "USER");
    const truoc = await demTuChoiQuyen(t.org, dl.u);
    for (let i = 0; i < 3; i += 1) expect((await cua(dl.cookie)).body.coQuyenKhai).toBe(false);
    expect(await demTuChoiQuyen(t.org, dl.u), "đọc gói không sinh từ chối").toBe(truoc);
    expect((await goi("GET", `/rfqs/${g.rfqId}/coi-declarations`, dl.cookie)).status).toBe(403);
    expect(await demTuChoiQuyen(t.org, dl.u), "route đọc khai báo vẫn tự cổng và vào sổ").toBe(truoc + 1);
    const agent = await phienMoi(t.org, t.pm.u, "AGENT_READONLY");
    expect((await cua(agent.cookie)).body.coQuyenKhai, "phiên agent của người giữ mã").toBe(false);
  });

  it("tập mã của ba hàm vị từ và hai trigger có tên BẰNG tập mã K9 của `CHOT_VAO_SO` — SQL và bảng không trôi khỏi nhau", async () => {
    const { rows } = await db.pool.query<{ s: string }>(
      "SELECT prosrc AS s FROM pg_proc WHERE oid IN ($1::regprocedure, $2::regprocedure, $3::regprocedure, 'public.coi_kiem_khai_bao()'::regprocedure, 'public.coi_kiem_trao_thau()'::regprocedure)",
      [HAM_CHOT, HAM_CHOT_XM, HAM_CHOT_MO],
    );
    const trongSql = new Set<string>();
    for (const { s } of rows) {
      for (const m of s.matchAll(/RETURN '(K9_[A-Z_]+)'/gu)) trongSql.add(m[1]!);
      for (const m of s.matchAll(/CONSTRAINT = '(k9_[a-z_]+)'/gu)) trongSql.add(m[1]!.toUpperCase());
    }
    const trongBang = Object.entries(TD)
      .filter(([, d]) => d.chot === "K9")
      .map(([ma]) => ma)
      .sort();
    expect(trongBang.length, "bộ đọc không thấy mã nào — đang mù").toBe(6);
    expect([...trongSql].sort()).toEqual(trongBang);
  });
});
