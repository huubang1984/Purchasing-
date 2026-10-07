import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nhaCungCapDemDuoc, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  addRfqItem,
  approveRfq,
  cancelRfq,
  createRfq,
  getRfq,
  openRfq,
  returnRfqToDraft,
  submitRfqForApproval,
  type RfqRecord,
} from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

// =============================================================================================
// [S1.198 / khoản 256 · khoản 257] LỜI DUYỆT RÀNG VÀO LẦN NỘP NGƯỜI DUYỆT ĐÃ XEM; LẦN TRẢ VỀ RÚT CHỮ KÝ CỦA CHÍNH NGƯỜI TRẢ —
// ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `087_lan_nop_da_xem`. Lượt soi S1.202 đo hai khoảng trống dưới cạnh về DRAFT (`077`), và hai ca giới hạn của
// `rang-ngan-sach.int.test.ts` ghim chúng tới vòng này: PM trả về, sửa, nộp lại giữa lần người duyệt xem và lần bấm ký ⇒ chữ ký
// rơi lên thứ người ấy chưa xem, và gói mở; người duyệt đã ký rồi tự trả về ⇒ nộp lại y nguyên, gói mở bằng chữ ký ấy. Hai ca đầu
// của khối (2) và (3) dưới đây là hai ca ấy, LẬT.
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG: công tắc ADR-080 một chiều. Đột biến ở HÀM sửa toàn cục rồi trả lại trong `finally` — các ca
// trong một tệp chạy nối tiếp.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `rang-ngan-sach.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. *** Tệp này đo cạnh mở gói.
const boBocGia = {
  name: "gia-cho-test-lan-nop-da-xem",
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

/** Bảng bậc tối thiểu, khuôn `rang-ngan-sach`. */
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
/** Ngưỡng kép của chính sách là 100 triệu. */
const GOI_THUONG = "1000000.00";
const GOI_THUONG_LON = "99000000.00";
const GOI_CAP_KEP = "150000000.00";
const LY_DO = "nguoi duyet tra ve: xem lai";
const loiLanNop = (n: number): string =>
  `Goi thau dang o lan nop ${n}; loi duyet khong mang dung lan nop nay — doc lai goi roi duyet (K4b)`;
const loiRoiCho = (trangThai: string): string =>
  `RFQ vua roi PENDING_APPROVAL (nay dang ${trangThai}) trong luc loi duyet dang ghi — doc lai goi roi duyet`;
const loiConHieuLuc = (can: number, co: number): string =>
  `RFQ nay can ${can} chu ky CON HIEU LUC — ky tren lan nop da xem, nguoi ky chua tra goi ve tu lan ay —, moi co ${co} (K4b)`;

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

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `lnx-${randomBytes(4).toString("hex")}`,
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

/** BẬT S3 cho một tổ chức có sẵn: phiên bản 2 có bậc, PM tạo, FINANCE ký — khuôn `rang-ngan-sach`. */
async function batS3(t: ToChuc): Promise<void> {
  const id = (
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
      id,
      t.tc.u,
      t.tc.s,
    ]),
  );
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org]));
  expect(rows[0]?.b, "dàn cảnh: tổ chức phải ĐÃ BẬT").toBe(true);
}

async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  await batS3(t);
  return t;
}

/** Phiên THỨ HAI của cùng một người — tách vế *một người một lần* khỏi vế *một phiên một lần*. */
async function phienKhac(t: ToChuc, ai: Nguoi): Promise<Nguoi> {
  const s = await motId(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [t.org, ai.u, randomBytes(32)],
  );
  return { u: ai.u, s };
}

/**
 * [S1.198 / S3.6a] Nhóm hàng của tổ chức, dựng MỘT lần bởi người FINANCE (giữ `category.manage`): tổ chức đã bật không nộp duyệt
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

/** Gói DRAFT có ngân sách, một hạng mục và một lời mời, do PM tạo. */
async function goiNhap(t: ToChuc, giaTri: string = GOI_THUONG): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  await moi(t, rfqId);
  return rfqId;
}

/**
 * Một nhà cung cấp, một người liên hệ và một lời mời vào gói, do PM mời.
 *
 * [S1.266 / S3.3c1] Tổ chức ĐÃ bật: nhà cung cấp ĐẾM ĐƯỢC cho K2 (`nhaCungCapDemDuoc` — người nhập riêng, MST, xác minh bởi
 * `tc`: FINANCE, không khai phiên bản chính sách v2 mà ngân sách ghim, không tạo gói, không mời) — gói nộp duyệt được (bậc đòi
 * một). Tổ chức chưa bật: nguyên dạng MVP1, do PM dựng — K2 không áp, và xác minh K8a chỉ có ở tổ chức đã bật. Hỏi trạng thái
 * bật lúc mời (`daBat`, khối (6)): khối (6) bật tổ chức giữa ca bằng chữ ký, không qua `batS3`.
 */
async function moi(t: ToChuc, rfqId: string): Promise<void> {
  let ncc: string;
  let lh: string;
  if (await daBat(t.org)) {
    const [n] = await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc });
    ({ ncc, lh } = n!);
  } else {
    ncc = await motId(
      "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
    );
    const duoi = randomBytes(6).toString("hex");
    lh = await motId(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
      [t.org, ncc, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), t.pm.u, t.pm.s],
    );
  }
  await withTenant(apiPool, t.org, (c) =>
    c.query(
      "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6)",
      [t.org, rfqId, ncc, lh, t.pm.u, t.pm.s],
    ),
  );
}

const datNganSach = (t: ToChuc, rfqId: string, giaTri: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s }));
const nop = (t: ToChuc, rfqId: string): Promise<RfqRecord> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
/** Người duyệt ĐỌC gói — lần nộp họ thấy nằm ở `RfqRecord.lanNop`. */
const doc = async (t: ToChuc, rfqId: string): Promise<RfqRecord> => {
  const g = await withTenant(apiPool, t.org, (c) => getRfq(c, t.org, rfqId));
  if (g === null) throw new Error("không đọc được gói");
  return g;
};
/** Lời duyệt mang ĐÚNG `lanNop` truyền vào — `undefined` là lời duyệt không mốc. */
const duyetVoi = (t: ToChuc, rfqId: string, ai: Nguoi, lanNop: number | undefined): Promise<void> =>
  withTenant(apiPool, t.org, (c) =>
    approveRfq(c, t.org, { rfqId, sessionId: ai.s, ...(lanNop === undefined ? {} : { lanNopDaXem: lanNop }) }, apiPool),
  );
/** Đọc gói rồi duyệt ngay — ca thường. */
const duyet = async (t: ToChuc, rfqId: string, ai: Nguoi): Promise<void> => duyetVoi(t, rfqId, ai, (await doc(t, rfqId)).lanNop);
const mo = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
const traVe = (t: ToChuc, rfqId: string, ai: Nguoi, reason: string = LY_DO): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => returnRfqToDraft(c, t.org, { rfqId, reason, actorSessionId: ai.s }, apiPool));

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

async function trangThaiGoi(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

async function soChuKy(rfqId: string): Promise<number> {
  return (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_approvals WHERE rfq_id = $1", [rfqId])).rows[0]!.n;
}

/** Hàng trả về của một gói, theo thứ tự lần nộp. */
async function hangTraVe(rfqId: string): Promise<{ lan: number; ai: string; phien: string; lyDo: string }[]> {
  const { rows } = await db.pool.query<{ lan: number; ai: string; phien: string; ly_do: string }>(
    "SELECT lan_nop AS lan, returned_by AS ai, returned_by_session_id AS phien, reason AS ly_do FROM rfq_tra_ve WHERE rfq_id = $1 ORDER BY lan_nop",
    [rfqId],
  );
  return rows.map((r) => ({ lan: r.lan, ai: r.ai, phien: r.phien, lyDo: r.ly_do }));
}

/** Mã chốt của các hàng `CONTROL_DENIED` mang gói này, theo thứ tự ghi. */
async function maTuChoiTheoChot(org: string, rfqId: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ ma: string }>(
    "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows.map((r) => r.ma);
}

/** Câu chèn hàng trả về của `returnRfqToDraft`, nguyên cột — `lan_nop` do trigger đặt. */
const CAU_TRA_VE =
  "INSERT INTO public.rfq_tra_ve (org_id, rfq_id, returned_by, returned_by_session_id, reason) VALUES ($1, $2, $3, $4, $5)";
/** Câu chèn chữ ký của `approveRfq`, nguyên cột. */
const CAU_KY =
  "INSERT INTO public.rfq_approvals (org_id, rfq_id, approver_user_id, session_id, lan_nop_da_xem) VALUES ($1, $2, $3, $4, $5)";
/** Câu UPDATE thô của cạnh về DRAFT — thứ trigger thấy, không qua tầng gói. */
const CAU_VE_NHAP = "UPDATE public.rfq_packages SET status = 'DRAFT' WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING status";

/** ĐỘT BIẾN TOÀN CỤC một hàm: thay `soCho` chỗ trong định nghĩa hiện tại, chạy việc, rồi dựng lại bản gốc. */
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

/** Một giao dịch dưới `app_api`, đã gắn tổ chức, CHƯA commit — cho các ca khoá. */
async function giaoDichApi(org: string): Promise<pg.PoolClient> {
  const c = await db.pool.connect();
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE app_api");
  await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
  return c;
}

async function dong(c: pg.PoolClient, cau: "COMMIT" | "ROLLBACK"): Promise<void> {
  try {
    await c.query(cau);
  } finally {
    c.release();
  }
}

async function pidCua(c: pg.PoolClient): Promise<number> {
  return (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
}

/** Chờ tới khi tiến trình `pid` đứng ở một điểm chờ khớp `khop` (chờ khoá, `pg_sleep`…), hay tới khi `xong()`. */
async function choTienTrinh(pid: number, khop: (loai: string | null, suKien: string | null) => boolean, xong: () => boolean): Promise<boolean> {
  for (let lan = 0; lan < 400 && !xong(); lan++) {
    const { rows } = await db.pool.query<{ loai: string | null; su_kien: string | null }>(
      "SELECT wait_event_type AS loai, wait_event AS su_kien FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (khop(rows[0]?.loai ?? null, rows[0]?.su_kien ?? null)) return true;
    await new Promise((ok) => setTimeout(ok, 25));
  }
  return false;
}

/**
 * Lần trả về CHƯA commit (hàng trả về và câu đổi trạng thái), rồi lời duyệt mốc 1 của PM2 ở một giao dịch khác: nó qua phép kiểm
 * trạng thái của D2 — lần trả về chưa commit thì vô hình —, rồi chờ khoá hàng gói nếu trigger so còn khoá. Lần trả về commit; lời
 * duyệt chạy tiếp, và commit nếu qua. Trả lỗi của lời duyệt, `null` nếu nó qua.
 */
async function duyetTrongLucTraVe(t: ToChuc, rfqId: string): Promise<LoiBat | null> {
  const r = await giaoDichApi(t.org);
  const a = await giaoDichApi(t.org);
  try {
    await r.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO]);
    await r.query(CAU_VE_NHAP, [rfqId]);
    const pid = await pidCua(a);
    let xong = false;
    const kq = loi(a.query(CAU_KY, [t.org, rfqId, t.pm2.u, t.pm2.s, 1])).finally(() => {
      xong = true;
    });
    await choTienTrinh(pid, (loai) => loai === "Lock", () => xong);
    await r.query("COMMIT");
    const e = await kq;
    await a.query(e === null ? "COMMIT" : "ROLLBACK");
    return e;
  } finally {
    await r.query("ROLLBACK").catch(() => undefined);
    await a.query("ROLLBACK").catch(() => undefined);
    r.release();
    a.release();
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
// (1) LẦN NỘP
// =============================================================================================
describe("S1.198 — lần nộp: trigger đếm ở mỗi lần nộp duyệt, bên gọi không đặt được", () => {
  it("[INV-K4b] `lanNop` 0 ở DRAFT, 1 sau lần nộp đầu, đứng yên khi trả về, 2 sau lần nộp lại; `app_api` không khai, không sửa được cột", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    expect((await doc(t, rfqId)).lanNop).toBe(0);
    expect((await nop(t, rfqId)).lanNop, "bản ghi của lần nộp mang lần nộp mới").toBe(1);
    await traVe(t, rfqId, t.pm);
    expect((await doc(t, rfqId)).lanNop, "trả về không đếm").toBe(1);
    expect((await nop(t, rfqId)).lanNop).toBe(2);

    const sua = await loi(
      withTenant(apiPool, t.org, (c) => c.query("UPDATE public.rfq_packages SET lan_nop = 1 WHERE id = $1", [rfqId])),
    );
    expect(sua?.code, "cột ngoài GRANT UPDATE").toBe("42501");
    const khai = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO public.rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id, lan_nop) " +
            "VALUES ($1, 'x', $2, true, $3, $4, 7)",
          [t.org, MAI_SAU, t.pm.u, t.pm.s],
        ),
      ),
    );
    expect(khai?.code, "cột ngoài GRANT INSERT").toBe("42501");
  });
});

// =============================================================================================
// (2) KHOẢN 256 — LỜI DUYỆT RÀNG VÀO LẦN NỘP ĐÃ XEM
// =============================================================================================
describe("S1.198 — khoản 256: lời duyệt mang lần nộp người duyệt đã xem", () => {
  it("[INV-K4b] [INV-D2] người duyệt xem gói ở 1 triệu (lần nộp 1); PM trả về, đặt 99 triệu, nộp lại (lần 2): lời duyệt mang lần 1 bị từ chối, không hàng chữ ký nào; đọc lại rồi duyệt ⇒ chữ ký nằm trên 99 triệu, gói mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const daXem = await doc(t, rfqId);
    expect(daXem.lanNop).toBe(1);
    await traVe(t, rfqId, t.pm);
    await datNganSach(t, rfqId, GOI_THUONG_LON);
    await nop(t, rfqId);

    const e = await loi(duyetVoi(t, rfqId, t.pm2, daXem.lanNop));
    expect(e?.message, "lời duyệt trên lần xem cũ").toBe(loiLanNop(2));
    expect(e?.code).toBe("23514");
    expect(await soChuKy(rfqId), "không hàng chữ ký nào").toBe(0);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");

    const docLai = await doc(t, rfqId);
    await duyetVoi(t, rfqId, t.pm2, docLai.lanNop);
    const { rows } = await db.pool.query<{ khop: boolean; lan: number }>(
      "SELECT a.approved_budget_hash = public.rfq_bam_ngan_sach(a.rfq_id) AS khop, a.lan_nop_da_xem AS lan FROM rfq_approvals a WHERE a.rfq_id = $1",
      [rfqId],
    );
    expect(rows, "chữ ký nằm trên ngân sách người duyệt vừa đọc").toEqual([{ khop: true, lan: 2 }]);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4b] tổ chức đã bật: lời duyệt KHÔNG mang lần nộp bị từ chối có tên; mang đúng thì đi qua", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    expect((await loi(duyetVoi(t, rfqId, t.pm2, undefined)))?.message).toBe(loiLanNop(1));
    expect((await loi(duyetVoi(t, rfqId, t.pm2, 0)))?.message).toBe(loiLanNop(1));
    expect(await soChuKy(rfqId)).toBe(0);
    await duyetVoi(t, rfqId, t.pm2, 1);
    expect(await soChuKy(rfqId)).toBe(1);
  });

  it("[INV-D2] tổ chức đã bật: người TẠO tự duyệt với mốc thiếu, sai hay đúng ⇒ vẫn là lời từ chối D2, mỗi lần một hàng `CONTROL_DENIED` — trigger so lần nộp chạy SAU chốt D2 (ADR-108 ⑴)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    for (const lanNop of [undefined, 0, 1]) {
      const e = await loi(duyetVoi(t, rfqId, t.pm, lanNop));
      expect([e?.ten, e?.message], `mốc ${String(lanNop)}`).toEqual([
        "ChotKiemSoatError",
        "Người tạo gói thầu không được duyệt chính gói ấy — cần một người khác duyệt (D2).",
      ]);
    }
    expect(await maTuChoiTheoChot(t.org, rfqId)).toEqual(["D2_NGUOI_TAO_TU_DUYET", "D2_NGUOI_TAO_TU_DUYET", "D2_NGUOI_TAO_TU_DUYET"]);
    expect(await soChuKy(rfqId)).toBe(0);
  });

  it("[INV-D2] tổ chức đã bật: phiên của người khác hay phiên đã thu hồi, kèm mốc sai ⇒ vẫn lời từ chối D2 có tên — chốt D2 chạy trước phép so lần nộp", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const ky = (ai: string, phien: string): Promise<LoiBat | null> =>
      loi(withTenant(apiPool, t.org, (c) => c.query(CAU_KY, [t.org, rfqId, ai, phien, 99])));
    expect((await ky(t.pm2.u, t.pm3.s))?.constraint).toBe("d2_phien_nguoi_khac");
    const thuHoi = await phienKhac(t, t.pm2);
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [thuHoi.s]);
    expect((await ky(t.pm2.u, thuHoi.s))?.constraint).toBe("d2_phien_khong_hop_le");
    expect(await soChuKy(rfqId)).toBe(0);
  });

  it("[INV-D2] tổ chức CHƯA bật (MVP1): lời duyệt không mốc đi qua như cũ; mốc sai bị từ chối; mốc đúng đi qua", async () => {
    const a = await taoToChuc();
    const goiA = await goiNhap(a);
    await nop(a, goiA);
    await duyetVoi(a, goiA, a.pm2, undefined);
    const { rows } = await db.pool.query<{ lan: number | null }>("SELECT lan_nop_da_xem AS lan FROM rfq_approvals WHERE rfq_id = $1", [goiA]);
    expect(rows, "MVP1: lời duyệt không mốc, cột NULL").toEqual([{ lan: null }]);
    expect(await loi(mo(a, goiA))).toBeNull();

    const b = await taoToChuc();
    const goiB = await goiNhap(b);
    await nop(b, goiB);
    expect((await loi(duyetVoi(b, goiB, b.pm2, 7)))?.message, "MVP1: gửi thì phải đúng").toBe(loiLanNop(1));
    await duyetVoi(b, goiB, b.pm2, 1);
    expect(await soChuKy(goiB)).toBe(1);
  });

  it("[INV-D2] tổ chức CHƯA bật, gói cấp kép: PM2 duyệt không mốc rồi duyệt LẠI mang mốc đúng, ở phiên khác ⇒ UNIQUE một người một lần chặn (cột đã về NULL), gói không mở bằng một người — phép đếm của `071` đếm HÀNG", async () => {
    const a = await taoToChuc();
    const rfqId = await goiNhap(a, GOI_CAP_KEP);
    await nop(a, rfqId);
    await duyetVoi(a, rfqId, a.pm2, undefined);
    const e = await loi(duyetVoi(a, rfqId, await phienKhac(a, a.pm2), 1));
    expect([e?.code, e?.constraint]).toEqual(["23505", "rfq_approvals_mot_nguoi_mot_lan"]);
    expect(await soChuKy(rfqId)).toBe(1);
    expect((await loi(mo(a, rfqId)))?.message).toBe("RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 1 (D2)");
  });

  it("[INV-K4b] khoá: lời duyệt chưa commit giữ khoá `FOR NO KEY UPDATE` hàng gói — một lần trả về chạy cùng lúc phải chờ; lời duyệt commit xong thì trả về đi được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const a = await giaoDichApi(t.org);
    const b = await giaoDichApi(t.org);
    try {
      await a.query(CAU_KY, [t.org, rfqId, t.pm2.u, t.pm2.s, 1]);
      await b.query("SET LOCAL lock_timeout = '300ms'");
      const cho = await loi(b.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO]));
      expect(cho?.code, "lần trả về phải chờ lời duyệt").toBe("55P03");
    } finally {
      await dong(a, "COMMIT");
      await dong(b, "ROLLBACK");
    }
    expect(await soChuKy(rfqId)).toBe(1);
    await traVe(t, rfqId, t.pm);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
  });

  it("[INV-K4b] chiều ngược: lời duyệt gặp một lần trả về đang chạy — qua phép kiểm trạng thái của D2, chờ khoá hàng gói, rồi đọc lại thấy DRAFT ⇒ từ chối có tên, không hàng chữ ký", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    expect((await duyetTrongLucTraVe(t, rfqId))?.message).toBe(loiRoiCho("DRAFT"));
    expect(await soChuKy(rfqId)).toBe(0);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
  });

  it("[INV-D2] tổ chức CHƯA bật: lời duyệt gặp một lần mở gói đang chạy ⇒ chờ khoá, đọc lại thấy OPEN, từ chối có tên — trước `087_lan_nop_da_xem` chữ ký ấy rơi lên gói đã mở", async () => {
    const a = await taoToChuc();
    const rfqId = await goiNhap(a);
    await nop(a, rfqId);
    await duyetVoi(a, rfqId, a.pm2, undefined);
    const o = await giaoDichApi(a.org);
    const k = await giaoDichApi(a.org);
    try {
      await openRfq(o, a.org, { rfqId, actorSessionId: a.pm.s, orgKeys: boBocGia }, apiPool);
      const pid = await pidCua(k);
      let xong = false;
      const kq = loi(k.query(CAU_KY, [a.org, rfqId, a.pm3.u, a.pm3.s, null])).finally(() => {
        xong = true;
      });
      expect(await choTienTrinh(pid, (loai) => loai === "Lock", () => xong), "lời duyệt phải chờ khoá của lần mở gói").toBe(true);
      await o.query("COMMIT");
      expect((await kq)?.message).toBe(loiRoiCho("OPEN"));
    } finally {
      await o.query("ROLLBACK").catch(() => undefined);
      await k.query("ROLLBACK").catch(() => undefined);
      o.release();
      k.release();
    }
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
    expect(await soChuKy(rfqId)).toBe(1);
  });
});

// =============================================================================================
// (3) KHOẢN 257 — LẦN TRẢ VỀ RÚT CHỮ KÝ CỦA CHÍNH NGƯỜI TRẢ
// =============================================================================================
describe("S1.198 — khoản 257: lần trả về rút chữ ký của chính người trả, không của ai khác", () => {
  it("[INV-K4b] [INV-D2] PM2 ký, rồi chính PM2 trả gói về; PM nộp lại y nguyên ⇒ gói KHÔNG mở bằng chữ ký cũ; PM2 ký lại trên lần nộp mới ⇒ mở, hai hàng chữ ký", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm2, "nguoi duyet rut chu ky");
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe(loiConHieuLuc(1, 0));
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    await duyet(t, rfqId, t.pm2);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await soChuKy(rfqId), "chữ ký cũ ở lại làm dấu vết").toBe(2);
  });

  it("[INV-K4b] người TẠO trả về không rút chữ ký của ai: PM2 ký, PM trả về, nộp lại y nguyên ⇒ gói mở bằng chữ ký cũ của PM2", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm);
    await nop(t, rfqId);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await soChuKy(rfqId), "không ai ký lại").toBe(1);
  });

  it("[INV-K4b] [INV-D2] gói cấp kép: PM2 và PM3 ký, PM3 trả về, nộp lại y nguyên ⇒ còn MỘT chữ ký hiệu lực trên hai; PM3 ký lại ⇒ mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, GOI_CAP_KEP);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await duyet(t, rfqId, t.pm3);
    await traVe(t, rfqId, t.pm3, "can xem lai hang muc");
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe(loiConHieuLuc(2, 1));
    await duyet(t, rfqId, t.pm3);
    expect(await loi(mo(t, rfqId))).toBeNull();
  });
});

// =============================================================================================
// (4) SỔ TRẢ VỀ VÀ CẠNH VỀ DRAFT
// =============================================================================================
describe("S1.198 — `rfq_tra_ve`: cạnh về DRAFT kèm hàng của chính lần nộp; người, lần nộp, lý do nằm trong CSDL", () => {
  it("[INV-K4a] `returnRfqToDraft` ghi đúng một hàng — người, phiên, lần nộp của gói, lý do —, hàng sổ `RFQ_RETURNED_TO_DRAFT` giữ nguyên", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await traVe(t, rfqId, t.pm2, "bo sung nha cung cap");
    await nop(t, rfqId);
    await traVe(t, rfqId, t.pm, "sua han nop");
    expect(await hangTraVe(rfqId)).toEqual([
      { lan: 1, ai: t.pm2.u, phien: t.pm2.s, lyDo: "bo sung nha cung cap" },
      { lan: 2, ai: t.pm.u, phien: t.pm.s, lyDo: "sua han nop" },
    ]);
    const { rows } = await db.pool.query<{ ly_do: string }>(
      "SELECT payload->>'reason' AS ly_do FROM audit_events WHERE resource_id = $1 AND action = 'RFQ_RETURNED_TO_DRAFT' ORDER BY seq",
      [rfqId],
    );
    expect(rows.map((r) => r.ly_do)).toEqual(["bo sung nha cung cap", "sua han nop"]);
  });

  it("[INV-K4a] câu UPDATE thô về DRAFT ở tổ chức đã bật mà KHÔNG kèm hàng trả về ⇒ 23514 có tên; kèm hàng của đúng lần nộp ⇒ đi qua", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const tron = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_VE_NHAP, [rfqId])));
    expect([tron?.code, tron?.message]).toEqual([
      "23514",
      "Tra goi ve DRAFT phai kem mot hang rfq_tra_ve cua lan nop 1 — ai tra va vi sao (K4b)",
    ]);
    const kq = await withTenant(apiPool, t.org, async (c) => {
      await c.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO]);
      return c.query<{ status: string }>(CAU_VE_NHAP, [rfqId]);
    });
    expect(kq.rows).toEqual([{ status: "DRAFT" }]);
  });

  it("[INV-K4a] hàng trả về: `app_api` không khai được lần nộp; gói không chờ duyệt hay tổ chức chưa bật ⇒ từ chối; một lần nộp chỉ trả về một lần; danh tính dẫn xuất từ phiên", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const nhap = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO])));
    expect(nhap?.message, "gói còn DRAFT").toBe("Chi tra ve duoc goi dang cho duyet; goi dang o DRAFT (K4a)");
    await nop(t, rfqId);
    const khaiLan = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO public.rfq_tra_ve (org_id, rfq_id, returned_by, returned_by_session_id, reason, lan_nop) VALUES ($1, $2, $3, $4, $5, 9)",
          [t.org, rfqId, t.pm.u, t.pm.s, LY_DO],
        ),
      ),
    );
    expect(khaiLan?.code, "lần nộp ngoài GRANT").toBe("42501");
    const gia = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_TRA_VE, [t.org, rfqId, t.pm2.u, t.pm.s, LY_DO])));
    expect(gia?.message, "phiên của PM, người khai là PM2").toMatch(/khong khop chu phien/u);
    const hai = await loi(
      withTenant(apiPool, t.org, async (c) => {
        await c.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO]);
        await c.query(CAU_TRA_VE, [t.org, rfqId, t.pm2.u, t.pm2.s, LY_DO]);
      }),
    );
    expect([hai?.code, hai?.constraint], "một lần nộp chỉ trả về một lần").toEqual(["23505", "rfq_tra_ve_mot_lan_moi_lan_nop"]);

    const mvp1 = await taoToChuc();
    const g = await goiNhap(mvp1);
    await nop(mvp1, g);
    const chuaBat = await loi(withTenant(apiPool, mvp1.org, (c) => c.query(CAU_TRA_VE, [mvp1.org, g, mvp1.pm.u, mvp1.pm.s, LY_DO])));
    expect(chuaBat?.message).toBe("Chi to chuc da bat S3 moi tra goi ve DRAFT duoc (K4a)");
  });
});

// =============================================================================================
// (5) ĐỘT BIẾN — MỖI VẾ CỦA BẢN VÁ MỘT LẦN ĐỎ
// =============================================================================================
describe("S1.198 — đột biến: gỡ từng vế thì khoảng trống mở lại", () => {
  /** Kịch bản khoản 256: lời duyệt trên lần xem trước khi PM trả về, đặt 99 triệu, nộp lại — trả trạng thái cuối. */
  const duaXemKy = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const daXem = (await doc(t, rfqId)).lanNop;
    await traVe(t, rfqId, t.pm);
    await datNganSach(t, rfqId, GOI_THUONG_LON);
    await nop(t, rfqId);
    await loi(duyetVoi(t, rfqId, t.pm2, daXem));
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };
  /** Kịch bản khoản 257: PM2 ký, PM2 trả về, nộp lại y nguyên — trả trạng thái cuối. */
  const rutChuKy = async (): Promise<string> => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm2, "rut chu ky");
    await nop(t, rfqId);
    await loi(mo(t, rfqId));
    return trangThaiGoi(rfqId);
  };

  it("[INV-K4b] đối chứng: bản thật chặn cả hai kịch bản", async () => {
    expect(await duaXemKy()).toBe("PENDING_APPROVAL");
    expect(await rutChuKy()).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4b] [INV-D2] lần nộp đứng yên (trigger đếm thành no-op) ⇒ lời duyệt trên lần xem cũ đi qua, gói mở", async () => {
    expect(await voiHamDotBien("public.rfq_dem_lan_nop()", "NEW.lan_nop := OLD.lan_nop + 1;", "NULL;", duaXemKy)).toBe("OPEN");
  });

  it("[INV-K4b] [INV-D2] trigger so lần nộp bỏ phép so ⇒ lời duyệt trên lần xem cũ đi qua, gói mở", async () => {
    expect(
      await voiHamDotBien(
        "public.rfq_chot_lan_nop_da_xem()",
        "IF NEW.lan_nop_da_xem IS DISTINCT FROM hien_tai THEN",
        "IF false THEN",
        duaXemKy,
      ),
    ).toBe("OPEN");
  });

  it("[INV-K4b] trigger so lần nộp bỏ khoá hàng gói ⇒ lời duyệt không chờ lần trả về đang chạy: chữ ký rơi lên gói đã về DRAFT", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const e = await voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "\n   FOR NO KEY UPDATE;", ";", () => duyetTrongLucTraVe(t, rfqId));
    expect(e).toBeNull();
    expect([await soChuKy(rfqId), await trangThaiGoi(rfqId)]).toEqual([1, "DRAFT"]);
  });

  it("[INV-K4b] trigger so lần nộp bỏ vế trạng thái ⇒ lời duyệt chờ lần trả về đang chạy rồi vẫn ghi: chữ ký rơi lên gói đã về DRAFT", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const e = await voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "IF trang_thai <> 'PENDING_APPROVAL' THEN", "IF false THEN", () =>
      duyetTrongLucTraVe(t, rfqId),
    );
    expect(e).toBeNull();
    expect([await soChuKy(rfqId), await trangThaiGoi(rfqId)]).toEqual([1, "DRAFT"]);
  });

  // [lượt soi S1.198, F1] Khe thật của thứ tự trigger: D2 đọc trạng thái rồi, mấy câu sau, mới băm NỘI DUNG — mỗi câu một ảnh
  // chụp. Ca này nới khe ấy bằng một `pg_sleep` chèn vào D2 (thay cho một tiến trình bị hoãn), rồi trả về và thêm hạng mục trong
  // lúc lời duyệt đang ngủ. Bản thật: vế trạng thái dưới khoá từ chối. Bỏ vế ấy: chữ ký mang băm của hạng mục người duyệt chưa đọc,
  // trên lần nộp cũ, và gói nộp lại mở bằng nó.
  it("[INV-K4b] [INV-D2] khe giữa phép kiểm trạng thái và phép băm nội dung của D2: bản thật từ chối lời duyệt; bỏ vế trạng thái ⇒ chữ ký mang hạng mục thêm sau lúc người duyệt đọc, nộp lại, gói MỞ", async () => {
    const khe = async (): Promise<{ loiDuyet: LoiBat | null; cuoi: string }> => {
      const t = await toChucDaBat();
      const rfqId = await goiNhap(t);
      await nop(t, rfqId);
      const daXem = (await doc(t, rfqId)).lanNop;
      const a = await giaoDichApi(t.org);
      let loiDuyet: LoiBat | null = null;
      try {
        const pid = await pidCua(a);
        let xong = false;
        const kq = loi(a.query(CAU_KY, [t.org, rfqId, t.pm2.u, t.pm2.s, daXem])).finally(() => {
          xong = true;
        });
        expect(await choTienTrinh(pid, (_loai, suKien) => suKien === "PgSleep", () => xong), "lời duyệt phải ngủ trong D2").toBe(true);
        await traVe(t, rfqId, t.pm);
        await withTenant(apiPool, t.org, (c) =>
          addRfqItem(c, t.org, { rfqId, lineNo: 2, description: "Thep tam SS400 10mm", quantity: "10000.0000", unit: "tam", actorSessionId: t.pm.s }),
        );
        loiDuyet = await kq;
        await a.query(loiDuyet === null ? "COMMIT" : "ROLLBACK");
      } finally {
        await a.query("ROLLBACK").catch(() => undefined);
        a.release();
      }
      await nop(t, rfqId);
      await loi(mo(t, rfqId));
      return { loiDuyet, cuoi: await trangThaiGoi(rfqId) };
    };
    const nguTrongD2 = <T>(viec: () => Promise<T>): Promise<T> =>
      voiHamDotBien(
        "public.rfq_kiem_nguoi_duyet()",
        "\n  NEW.approved_content_hash := public.rfq_bam_noi_dung(NEW.rfq_id);",
        "\n  PERFORM pg_catalog.pg_sleep(1.5);\n  NEW.approved_content_hash := public.rfq_bam_noi_dung(NEW.rfq_id);",
        viec,
      );
    const that = await nguTrongD2(khe);
    expect(that.loiDuyet?.message).toBe(loiRoiCho("DRAFT"));
    expect(that.cuoi).toBe("PENDING_APPROVAL");
    const dotBien = await nguTrongD2(() =>
      voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "IF trang_thai <> 'PENDING_APPROVAL' THEN", "IF false THEN", khe),
    );
    expect(dotBien.loiDuyet).toBeNull();
    expect(dotBien.cuoi).toBe("OPEN");
  });

  it("[INV-D2] trigger so lần nộp xếp TRƯỚC chốt D2 (đổi tên) ⇒ lời tự duyệt không mốc bị từ chối vì lần nộp, KHÔNG hàng `CONTROL_DENIED` nào", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await db.pool.query("ALTER TRIGGER rfq_approvals_so_lan_nop ON public.rfq_approvals RENAME TO rfq_approvals_a_so_lan_nop");
    try {
      expect((await loi(duyetVoi(t, rfqId, t.pm, undefined)))?.message).toBe(loiLanNop(1));
    } finally {
      await db.pool.query("ALTER TRIGGER rfq_approvals_a_so_lan_nop ON public.rfq_approvals RENAME TO rfq_approvals_so_lan_nop");
    }
    expect(await maTuChoiTheoChot(t.org, rfqId), "lần vi phạm D2 rơi khỏi sổ").toEqual([]);
  });

  it("[INV-D2] tổ chức chưa bật, trigger so lần nộp KHÔNG đặt cột về NULL ⇒ PM2 duyệt hai lần (không mốc, rồi mốc đúng) và gói cấp kép MỞ bằng một người", async () => {
    // [S1.279 / S4.7a — CA LẬT] Từ `112_tco`, cạnh mở ở tổ chức chưa bật đếm NGƯỜI ký trên nội dung và số ngày giao hiện tại (lớp
    // L16, `rfq_packages_tco_khi_mo`): hai hàng của cùng PM2 là MỘT người, nên đột biến này một mình KHÔNG còn mở được gói. Khoảng
    // trống của vế này chỉ mở lại khi lớp ấy cũng tắt — ca đo đúng điều đó; lời từ chối của lớp L16 được đo trước.
    const a = await taoToChuc();
    const rfqId = await goiNhap(a, GOI_CAP_KEP);
    await nop(a, rfqId);
    await voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "\n    NEW.lan_nop_da_xem := NULL;", "", async () => {
      await duyetVoi(a, rfqId, a.pm2, undefined);
      await duyetVoi(a, rfqId, await phienKhac(a, a.pm2), 1);
    });
    expect(await soChuKy(rfqId)).toBe(2);
    expect((await loi(mo(a, rfqId)))?.message).toBe("RFQ nay can 2 NGUOI KY TREN NOI DUNG VA SO NGAY GIAO HIEN TAI, moi co 1 (L16)");
    await db.pool.query("ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_tco_khi_mo");
    try {
      expect(await loi(mo(a, rfqId))).toBeNull();
    } finally {
      await db.pool.query("ALTER TABLE public.rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_tco_khi_mo");
    }
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4b] [INV-D2] cạnh mở gói bỏ vế *người ký chưa trả về* ⇒ chữ ký của chính người trả về vẫn mở gói", async () => {
    expect(
      // [S1.269 / S3.3c2] Phép đếm thứ ba nay đọc `rfq_chu_ky_con_hieu_luc` (`107`) — đột biến áp ở đó; K5 đọc cùng hàm.
      // [S1.281 / S3.4a / K9] Các vế *khớp băm* dời sang `rfq_chu_ky_khop_bam` (`114`); `rfq_chu_ky_con_hieu_luc` đọc nó rồi loại
      // người có xung đột — đột biến áp ở các vế, K5 và cạnh mở gói vẫn đọc cùng một hàm.
      await voiHamDotBien(
        "public.rfq_chu_ky_khop_bam(uuid, uuid)",
        "\n     AND NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r\n                      WHERE r.org_id = a.org_id AND r.rfq_id = a.rfq_id\n                        AND r.returned_by = a.approver_user_id AND r.lan_nop >= a.lan_nop_da_xem)",
        "",
        rutChuKy,
      ),
    ).toBe("OPEN");
  });

  it("[INV-K4b] cạnh mở gói bỏ vế *mang lần nộp* ⇒ chữ ký không mang lần nộp (dạng trước `087_lan_nop_da_xem`) mở được gói", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    // Chữ ký dạng trước `087_lan_nop_da_xem`: trigger so lần nộp tạm bỏ phép so, lời duyệt không mốc.
    await voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "IF NEW.lan_nop_da_xem IS DISTINCT FROM hien_tai THEN", "IF false THEN", () =>
      duyetVoi(t, rfqId, t.pm2, undefined),
    );
    expect((await loi(mo(t, rfqId)))?.message, "bản thật: chữ ký không mang lần nộp không đếm").toBe(loiConHieuLuc(1, 0));
    // [S1.269 / S3.3c2] Vế ấy nay ở `rfq_chu_ky_con_hieu_luc` (`107`). [S1.281 / S3.4a] Rồi ở `rfq_chu_ky_khop_bam` (`114`).
    await voiHamDotBien(
      "public.rfq_chu_ky_khop_bam(uuid, uuid)",
      "\n     AND a.lan_nop_da_xem IS NOT NULL",
      "",
      () => mo(t, rfqId),
    );
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4a] cạnh về DRAFT bỏ vế *kèm hàng trả về* ⇒ câu UPDATE thô trả gói về không để lại người và lý do", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const kq = await voiHamDotBien(
      "public.rfq_kiem_tra_ve_nhap()",
      "IF NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r",
      "IF false AND NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r",
      () => withTenant(apiPool, t.org, (c) => c.query<{ status: string }>(CAU_VE_NHAP, [rfqId])),
    );
    expect(kq.rows).toEqual([{ status: "DRAFT" }]);
    expect(await hangTraVe(rfqId)).toEqual([]);
  });
});

// =============================================================================================
// (6) [S1.236 / khoản 261] CHỮ KÝ BẬT S3 BỊ TỪ CHỐI KHI TỔ CHỨC CÒN GÓI CHỜ DUYỆT
//
// Lượt soi S1.198 (F6) đo: ở tổ chức chưa bật, danh sách mời đổi được khi gói đang chờ duyệt (`076` chỉ chặn ở tổ chức đã bật) và
// lần nộp đứng yên; tổ chức bật S3 giữa chừng thì lời duyệt mốc 1 đi qua với danh sách người duyệt chưa đọc, và gói MỞ. Chủ dự án
// chốt chặn LẦN BẬT: chữ ký đầu tiên trên một phiên bản có bậc bị từ chối khi tổ chức còn gói ở `PENDING_APPROVAL`
// (`097_chan_bat_s3_khi_con_goi_cho`). Ca đầu là ca giới hạn cũ của khối này, LẬT.
// =============================================================================================
const loiConGoiCho = (n: number): string =>
  `To chuc con ${n} goi cho duyet: duyet roi mo, hoac huy, cac goi ay truoc khi bat S3 (ADR-080)`;
/** Câu nộp duyệt thô — thứ trigger ở cạnh `DRAFT→PENDING_APPROVAL` thấy, không qua tầng gói. */
const CAU_NOP = "UPDATE public.rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1";
/** Câu ký phiên bản chính sách, nguyên cột — `signed_by` phải là người của phiên. */
const CAU_KY_BAN = "INSERT INTO public.org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)";

/** Phiên bản chính sách CÓ BẬC, do PM tạo, CHƯA ký. */
async function banCoBac(t: ToChuc, version: number): Promise<string> {
  const { rows } = await withTenant(apiPool, t.org, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
        "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
        "VALUES ($1, $2, '100000000.00', 'VND', $3::jsonb, 30, 12, true, now(), $4, $5) RETURNING id",
      [t.org, version, JSON.stringify(BAC), t.pm.u, t.pm.s],
    ),
  );
  return rows[0]!.id;
}
/** FINANCE ký một phiên bản — trả lời hứa, để đo cả lời từ chối. */
const kyBan = (t: ToChuc, policyId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => c.query(CAU_KY_BAN, [t.org, policyId, t.tc.u, t.tc.s]));
async function daBat(org: string): Promise<boolean> {
  return (await db.pool.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [org])).rows[0]!.b;
}
async function soChuKyChinhSach(org: string): Promise<number> {
  return (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM org_policy_signatures WHERE org_id = $1", [org])).rows[0]!.n;
}
const huy = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => cancelRfq(c, t.org, { rfqId, reason: "huy goi truoc khi bat S3", actorSessionId: t.pm.s }, apiPool));

describe("S1.236 — khoản 261: chữ ký bật S3 bị từ chối khi tổ chức còn gói chờ duyệt", () => {
  it("[INV-K4a] [INV-K4b] khoản 261 — người duyệt đọc gói (lần nộp 1, một lời mời); PM mời thêm khi gói đang chờ — MVP1 cho —; chữ ký BẬT S3 bị từ chối, tổ chức không bật và không một chữ ký; huỷ gói ấy rồi ký thì bật", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    expect((await doc(t, rfqId)).lanNop).toBe(1);
    await moi(t, rfqId);
    const v2 = await banCoBac(t, 2);

    // Vế mới đứng CUỐI: một chữ ký sai vì lý do khác nhận đúng lời từ chối của nó — người tạo phiên bản tự ký.
    const tuKy = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_KY_BAN, [t.org, v2, t.pm.u, t.pm.s])));
    expect(tuKy?.message).toBe("Nguoi tao phien ban chinh sach khong duoc tu ky (ADR-082)");
    const e = await loi(kyBan(t, v2));
    expect([e?.code, e?.message]).toEqual(["23514", loiConGoiCho(1)]);
    expect(await daBat(t.org)).toBe(false);
    expect(await soChuKyChinhSach(t.org)).toBe(0);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");

    await huy(t, rfqId);
    expect(await loi(kyBan(t, v2))).toBeNull();
    expect(await daBat(t.org)).toBe(true);
  });

  it("[INV-K4b] câu đếm đếm đúng gói chờ duyệt của CHÍNH tổ chức ký: hai gói chờ ⇒ «2»; gói nháp và gói của tổ chức khác không đếm; mở một gói theo đường MVP1 ⇒ «1»; huỷ gói kia ⇒ bật", async () => {
    const t = await taoToChuc();
    const khac = await taoToChuc();
    const a = await goiNhap(t);
    const b = await goiNhap(t);
    await goiNhap(t);
    await nop(t, a);
    await nop(t, b);
    await nop(khac, await goiNhap(khac));
    const v2 = await banCoBac(t, 2);

    expect((await loi(kyBan(t, v2)))?.message).toBe(loiConGoiCho(2));
    // Dưới một vai BỎ QUA RLS (chủ sở hữu ở cụm test) câu đếm vẫn chỉ đếm gói của tổ chức ký: bộ lọc `org_id` không dựa vào RLS.
    expect((await loi(db.pool.query(CAU_KY_BAN, [t.org, v2, t.tc.u, t.tc.s])))?.message).toBe(loiConGoiCho(2));
    await duyet(t, a, t.pm2);
    expect(await loi(mo(t, a))).toBeNull();
    expect(await trangThaiGoi(a)).toBe("OPEN");
    expect((await loi(kyBan(t, v2)))?.message).toBe(loiConGoiCho(1));
    await huy(t, b);
    expect(await loi(kyBan(t, v2))).toBeNull();
    expect([await daBat(t.org), await daBat(khac.org)]).toEqual([true, false]);
  });

  it("[INV-K4b] không đua qua khoá tư vấn: lần nộp đang dở làm lần ký CHỜ, nộp commit ⇒ lần ký thấy gói ấy và bị từ chối; lần ký đang dở làm lần nộp CHỜ, ký commit ⇒ lần nộp đọc tổ chức ĐÃ bật và bị chốt ngân sách chặn", async () => {
    // Chiều ⑴ — nộp trước, ký sau.
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const v2 = await banCoBac(t, 2);
    const n = await giaoDichApi(t.org);
    const k = await giaoDichApi(t.org);
    try {
      await n.query(CAU_NOP, [rfqId, t.pm.u, t.pm.s]);
      const pid = await pidCua(k);
      let xong = false;
      const kq = loi(k.query(CAU_KY_BAN, [t.org, v2, t.tc.u, t.tc.s])).finally(() => {
        xong = true;
      });
      expect(await choTienTrinh(pid, (loai, suKien) => loai === "Lock" && suKien === "advisory", () => xong), "lần ký phải chờ khoá tư vấn").toBe(true);
      await n.query("COMMIT");
      expect((await kq)?.message).toBe(loiConGoiCho(1));
    } finally {
      await dong(n, "ROLLBACK").catch(() => undefined);
      await dong(k, "ROLLBACK");
    }
    expect([await daBat(t.org), await trangThaiGoi(rfqId)]).toEqual([false, "PENDING_APPROVAL"]);

    // Chiều ⑵ — ký trước, nộp sau: lần nộp chờ, rồi đi dưới luật S3 — ngân sách ghim phiên bản 1 không bậc, không còn hiệu lực.
    const t2 = await taoToChuc();
    const rfq2 = await goiNhap(t2);
    const v2b = await banCoBac(t2, 2);
    const k2 = await giaoDichApi(t2.org);
    const n2 = await giaoDichApi(t2.org);
    try {
      await k2.query(CAU_KY_BAN, [t2.org, v2b, t2.tc.u, t2.tc.s]);
      const pid = await pidCua(n2);
      let xong = false;
      const kq = loi(n2.query(CAU_NOP, [rfq2, t2.pm.u, t2.pm.s])).finally(() => {
        xong = true;
      });
      expect(await choTienTrinh(pid, (loai, suKien) => loai === "Lock" && suKien === "advisory", () => xong), "lần nộp phải chờ khoá tư vấn").toBe(true);
      await k2.query("COMMIT");
      const e = await kq;
      expect(e?.code).toBe("23514");
      expect(e?.message).toContain("NGAN_SACH_GHIM_BAN_CU");
    } finally {
      await dong(k2, "ROLLBACK").catch(() => undefined);
      await dong(n2, "ROLLBACK");
    }
    expect([await daBat(t2.org), await trangThaiGoi(rfq2)]).toEqual([true, "DRAFT"]);
  });

  it("[INV-K4b] SAU lần bật, chữ ký lên một phiên bản có bậc mới không bị hỏi: gói chờ duyệt lúc ấy đã nộp dưới luật S3", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    expect(await loi(kyBan(t, await banCoBac(t, 3)))).toBeNull();
    expect(await soChuKyChinhSach(t.org)).toBe(2);
  });

  it("[INV-K4b] lần ký bật dưới REPEATABLE READ hay SERIALIZABLE bị từ chối — ảnh chụp lấy TRƯỚC lần nộp không thấy gói chờ, và lượt soi dựng lại trọn lỗ gốc bằng đúng đường ấy", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const v2 = await banCoBac(t, 2);
    const loiMuc = (muc: string): string =>
      `Chu ky bat S3 chi nhan duoi READ COMMITTED (giao dich dang o ${muc}): anh chup cu khong thay goi vua nop (ADR-080)`;
    const moMuc = async (muc: string): Promise<pg.PoolClient> => {
      const c = await db.pool.connect();
      await c.query(`BEGIN ISOLATION LEVEL ${muc}`);
      await c.query("SET LOCAL ROLE app_api");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [t.org]);
      return c;
    };
    // REPEATABLE READ: ảnh chụp lấy ở câu đầu; gói nộp và commit SAU đó, ở kết nối khác; rồi mới ký.
    const rr = await moMuc("REPEATABLE READ");
    try {
      await rr.query("SELECT 1");
      await nop(t, rfqId);
      expect((await loi(rr.query(CAU_KY_BAN, [t.org, v2, t.tc.u, t.tc.s])))?.message).toBe(loiMuc("repeatable read"));
    } finally {
      await dong(rr, "ROLLBACK");
    }
    // SERIALIZABLE, câu ký là câu đầu — ảnh chụp lấy lúc câu bắt đầu, TRƯỚC khoá tư vấn.
    const sr = await moMuc("SERIALIZABLE");
    try {
      expect((await loi(sr.query(CAU_KY_BAN, [t.org, v2, t.tc.u, t.tc.s])))?.message).toBe(loiMuc("serializable"));
    } finally {
      await dong(sr, "ROLLBACK");
    }
    expect([await daBat(t.org), await soChuKyChinhSach(t.org), await trangThaiGoi(rfqId)]).toEqual([false, 0, "PENDING_APPROVAL"]);
    // Đối chứng READ COMMITTED: lời của câu đếm, rồi huỷ gói thì bật.
    expect((await loi(kyBan(t, v2)))?.message).toBe(loiConGoiCho(1));
    await huy(t, rfqId);
    expect(await loi(kyBan(t, v2))).toBeNull();
  });

  it("hardening phán xét `provolatile` của hàm ký: đổi thành STABLE — câu đếm dùng ảnh chụp lấy TRƯỚC khoá — thì `migrate()` báo trạng thái SAI trước khi sửa và dựng lại VOLATILE", async () => {
    const volatile = async (): Promise<string> =>
      (await db.pool.query<{ v: string }>("SELECT provolatile AS v FROM pg_proc WHERE oid = 'public.chinh_sach_kiem_nguoi_ky()'::regprocedure")).rows[0]!.v;
    await db.pool.query("ALTER FUNCTION public.chinh_sach_kiem_nguoi_ky() STABLE");
    try {
      expect(await volatile()).toBe("s");
      const thongBao: string[] = [];
      await migrate(db.pool, MIGRATIONS_DIR, { onThongBao: (tb) => thongBao.push(tb.message) });
      expect(thongBao.some((m) => m.includes("chinh_sach_kiem_nguoi_ky") && m.includes("SAI TRƯỚC khi sửa") && m.includes("volatile=s"))).toBe(true);
      expect(await volatile()).toBe("v");
    } finally {
      await db.pool.query("ALTER FUNCTION public.chinh_sach_kiem_nguoi_ky() VOLATILE");
    }
  }, 300000);
});

// =============================================================================================
// (7) [S1.205 / khoản 259] BẢN ĐỔI TÊN CỦA TRIGGER SO LẦN NỘP KHÔNG SỐNG QUA `migrate()`
//
// Lượt soi S1.198 (F4) đo: đổi tên `rfq_approvals_so_lan_nop` thành một tên xếp trước chốt D2 ⇒ `migrate()` xanh, mục ghim dựng
// lại tên đúng và GIỮ bản đổi tên — phép so lần nộp chạy trước D2, và lời tự duyệt thiếu mốc bị từ chối vì lần nộp mà không để lại
// hàng `CONTROL_DENIED` (ADR-108 ⑴). Nay hardening mặc định-đóng với trigger (khoản 259): bản đổi tên bị gỡ. Ca dưới đo cả hai phía
// của lần `migrate()`. Mục hardening được đo riêng ở `db/trigger-la-mac-dinh-dong.int.test.ts`.
// =============================================================================================
describe("S1.205 — khoản 259: bản đổi tên của trigger so lần nộp xếp trước chốt D2 không sống qua `migrate()`", () => {
  it("[INV-H19] [INV-D2] đổi tên trigger so lần nộp thành tên xếp trước chốt D2 ⇒ lời tự duyệt thiếu mốc mất hàng `CONTROL_DENIED`; `migrate()` gỡ bản đổi tên và dựng lại tên đúng ⇒ lời ấy lại là lời từ chối D2 có sổ", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await db.pool.query("ALTER TRIGGER rfq_approvals_so_lan_nop ON public.rfq_approvals RENAME TO rfq_approvals_a_so_lan_nop");
    try {
      // Lỗ, đo trước lần migrate(): phép so lần nộp chạy TRƯỚC chốt D2 ⇒ từ chối vì lần nộp, không hàng sổ nào.
      expect((await loi(duyetVoi(t, rfqId, t.pm, undefined)))?.message).toBe(loiLanNop(1));
      expect(await maTuChoiTheoChot(t.org, rfqId)).toEqual([]);

      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows } = await db.pool.query<{ ten: string }>(
        "SELECT tgname AS ten FROM pg_trigger WHERE tgrelid = 'public.rfq_approvals'::regclass AND NOT tgisinternal ORDER BY tgname",
      );
      // [S1.279 / S4.7a — CA LẬT] ~~ba~~ BỐN: `rfq_approvals_dat_bam_giao_hang` (`112_tco`) đặt băm số ngày giao — không từ chối gì.
      // [S1.281 / S3.4a / K9] Trigger thứ tư: cổng K9 ở chữ ký — đứng sau D2 và trước phép so lần nộp theo tên.
      expect(rows.map((r) => r.ten), "đúng năm trigger chuẩn, theo đúng thứ tự tên").toEqual([
        "rfq_approvals_dat_bam_danh_sach",
        "rfq_approvals_dat_bam_giao_hang",
        "rfq_approvals_kiem_nguoi_duyet",
        "rfq_approvals_kiem_xung_dot",
        "rfq_approvals_so_lan_nop",
      ]);

      const e = await loi(duyetVoi(t, rfqId, t.pm, undefined));
      expect([e?.ten, e?.message]).toEqual([
        "ChotKiemSoatError",
        "Người tạo gói thầu không được duyệt chính gói ấy — cần một người khác duyệt (D2).",
      ]);
      expect(await maTuChoiTheoChot(t.org, rfqId)).toEqual(["D2_NGUOI_TAO_TU_DUYET"]);
      expect(await soChuKy(rfqId)).toBe(0);
    } finally {
      // Phép đo gãy giữa chừng thì trả cụm về bản chuẩn cho các tệp sau không thừa hưởng trigger đổi tên.
      await db.pool.query("DROP TRIGGER IF EXISTS rfq_approvals_a_so_lan_nop ON public.rfq_approvals");
      await migrate(db.pool, MIGRATIONS_DIR);
    }
  }, 300000);
});

// =============================================================================================
// (8) [S1.207 / khoản 260] HÀNG `rfq_tra_ve` PHẢI ĐI KÈM CẠNH VỀ DRAFT CỦA CHÍNH LẦN NỘP ẤY; BẢNG CHỈ-GHI-THÊM CẢ VỚI CHỦ BẢNG
//
// Lượt soi S1.198 đọc ra: `087` chỉ buộc một chiều — cạnh về DRAFT đòi hàng, hàng không đòi cạnh —, và bảng chỉ-ghi-thêm bằng
// QUYỀN. Một hàng chèn tay commit được, chiếm `UNIQUE (org, gói, lần nộp)` và thoả vế (4) cho một câu UPDATE thô về sau; chủ bảng
// xoá một hàng thì chữ ký người trả đã rút đếm lại. Nay một constraint trigger hoãn tới COMMIT đòi gói đã ĐI QUA DRAFT ở lần nộp
// của hàng (chủ dự án chốt: một tập, khuôn `017`), và `bid_chi_ghi_them` chặn sửa, xoá, TRUNCATE cả với chủ bảng. Đầu vào khác
// của cùng phép đếm — sửa `rfq_approvals`, nâng `lan_nop` của gói — chủ bảng còn chạm được (khoản 262): khối này không canh chúng.
// =============================================================================================
const loiKhongDiKemCanh = (lanNop: number, trangThai: string): string =>
  `Hang rfq_tra_ve cua lan nop ${lanNop} phai di kem canh ve DRAFT cua chinh lan nop ay trong cung giao dich; goi dang o ${trangThai} (K4a)`;
const loiChiGhiThem = (thaoTac: string): string => `Bang rfq_tra_ve chi duoc ghi them: thao tac ${thaoTac} bi tu choi (B1, B2)`;

describe("S1.207 — khoản 260: hàng trả về đi kèm cạnh về DRAFT; sổ trả về chỉ-ghi-thêm cả với chủ bảng", () => {
  it("[INV-K4a] hàng trả về chèn lẻ, không kèm cạnh ⇒ từ chối lúc COMMIT; câu UPDATE thô về DRAFT ở giao dịch sau không có hàng nào để dựa; lần trả về thật của lần nộp ấy đi qua", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    // PM2 — người giữ `rfq.approve` — chèn tay một hàng mang danh tính của chính mình, không đổi trạng thái gói.
    const le = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_TRA_VE, [t.org, rfqId, t.pm2.u, t.pm2.s, LY_DO])));
    expect([le?.code, le?.message]).toEqual(["23514", loiKhongDiKemCanh(1, "PENDING_APPROVAL")]);
    expect(await hangTraVe(rfqId), "không hàng nào ở lại chiếm UNIQUE của lần nộp 1").toEqual([]);
    const tho = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_VE_NHAP, [rfqId])));
    expect(tho?.message, "câu UPDATE thô về sau không dựa được vào hàng lẻ").toBe(
      "Tra goi ve DRAFT phai kem mot hang rfq_tra_ve cua lan nop 1 — ai tra va vi sao (K4b)",
    );
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    expect(await loi(traVe(t, rfqId, t.pm)), "lần trả về thật của lần nộp 1").toBeNull();
    expect((await hangTraVe(rfqId)).map((h) => [h.lan, h.ai])).toEqual([[1, t.pm.u]]);
  });

  it("[INV-K4a] hàng trả về đi kèm cạnh MỞ gói hay HUỶ gói trực tiếp trong cùng giao dịch ⇒ từ chối lúc COMMIT, gói ở lại chờ duyệt; không kèm hàng thì mở được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    const kemMo = await loi(
      withTenant(apiPool, t.org, async (c) => {
        await c.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO]);
        await openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool);
      }),
    );
    expect([kemMo?.code, kemMo?.message]).toEqual(["23514", loiKhongDiKemCanh(1, "OPEN")]);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    const kemHuy = await loi(
      withTenant(apiPool, t.org, async (c) => {
        await c.query(CAU_TRA_VE, [t.org, rfqId, t.pm.u, t.pm.s, LY_DO]);
        await cancelRfq(c, t.org, { rfqId, reason: "huy goi", actorSessionId: t.pm.s }, apiPool);
      }),
    );
    expect([kemHuy?.code, kemHuy?.message]).toEqual(["23514", loiKhongDiKemCanh(1, "CANCELLED")]);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    expect(await hangTraVe(rfqId)).toEqual([]);
    expect(await loi(mo(t, rfqId)), "đối chứng: không kèm hàng thì mở được").toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4a] trả về rồi nộp lại TRONG CÙNG giao dịch ⇒ đi qua: lần nộp đã tăng, nên gói đã đi qua DRAFT", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await withTenant(apiPool, t.org, async (c) => {
      await returnRfqToDraft(c, t.org, { rfqId, reason: LY_DO, actorSessionId: t.pm.s }, apiPool);
      await submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool);
    });
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    expect((await doc(t, rfqId)).lanNop).toBe(2);
    expect((await hangTraVe(rfqId)).map((h) => h.lan)).toEqual([1]);
  });

  it("[INV-K4a] đổi `app.org_id` giữa lần chèn hàng lẻ và COMMIT — gói biến khỏi tầm nhìn của hàm dưới RLS — vẫn bị từ chối, không lọt", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const doiOrg = await loi(
      withTenant(apiPool, t.org, async (c) => {
        await c.query(CAU_TRA_VE, [t.org, rfqId, t.pm2.u, t.pm2.s, LY_DO]);
        await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [randomUUID()]);
      }),
    );
    expect([doiOrg?.code, doiOrg?.message]).toEqual(["23514", "Khong doc duoc goi thau cua hang tra ve luc COMMIT (K4a)"]);
    expect(await hangTraVe(rfqId)).toEqual([]);
  });

  it("[INV-K4b] [INV-H19] chủ bảng không xoá, không sửa, không TRUNCATE được hàng trả về — kể cả dưới `session_replication_role = replica` —, nên xoá hàng trả về không còn làm chữ ký đã rút đếm lại", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await traVe(t, rfqId, t.pm2, "nguoi duyet rut chu ky");
    await nop(t, rfqId);
    expect((await loi(mo(t, rfqId)))?.message).toBe(loiConHieuLuc(1, 0));

    const xoa = await loi(db.pool.query("DELETE FROM public.rfq_tra_ve WHERE rfq_id = $1", [rfqId]));
    expect([xoa?.code, xoa?.message]).toEqual(["23514", loiChiGhiThem("DELETE")]);
    const sua = await loi(db.pool.query("UPDATE public.rfq_tra_ve SET lan_nop = 0 WHERE rfq_id = $1", [rfqId]));
    expect([sua?.code, sua?.message]).toEqual(["23514", loiChiGhiThem("UPDATE")]);
    // Mỗi phép thử một giao dịch lùi: TRUNCATE lọt mà không lùi thì xoá sổ trả về của cả cụm.
    const trongGiaoDichLui = async (truoc: string | null, cau: string, thamSo: readonly unknown[]): Promise<LoiBat | null> => {
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        if (truoc !== null) await c.query(truoc);
        return await loi(c.query(cau, [...thamSo]));
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    };
    const replica = await trongGiaoDichLui(
      "SET LOCAL session_replication_role = replica",
      "DELETE FROM public.rfq_tra_ve WHERE rfq_id = $1",
      [rfqId],
    );
    expect(replica?.message, "ENABLE ALWAYS — replica không tắt được chốt").toBe(loiChiGhiThem("DELETE"));
    const cat = await trongGiaoDichLui(null, "TRUNCATE public.rfq_tra_ve", []);
    expect(cat?.message).toBe(loiChiGhiThem("TRUNCATE"));

    expect((await hangTraVe(rfqId)).map((h) => [h.lan, h.ai])).toEqual([[1, t.pm2.u]]);
    expect((await loi(mo(t, rfqId)))?.message, "chữ ký đã rút vẫn không đếm").toBe(loiConHieuLuc(1, 0));
  });
});
