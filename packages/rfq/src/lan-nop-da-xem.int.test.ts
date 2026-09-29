import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  addRfqItem,
  approveRfq,
  createRfq,
  getRfq,
  openRfq,
  returnRfqToDraft,
  submitRfqForApproval,
  type RfqRecord,
} from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

// =============================================================================================
// [S1.9101 / khoản 256 · khoản 257] LỜI DUYỆT RÀNG VÀO LẦN NỘP NGƯỜI DUYỆT ĐÃ XEM; LẦN TRẢ VỀ RÚT CHỮ KÝ CỦA CHÍNH NGƯỜI TRẢ —
// ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `9501_lan_nop_da_xem`. Lượt soi S1.192 đo hai khoảng trống dưới cạnh về DRAFT (`077`), và hai ca giới hạn của
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

/** Gói DRAFT có ngân sách, một hạng mục và một lời mời, do PM tạo. */
async function goiNhap(t: ToChuc, giaTri: string = GOI_THUONG): Promise<string> {
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  await moi(t, rfqId);
  return rfqId;
}

/** Một nhà cung cấp, một người liên hệ và một lời mời vào gói, do PM mời. */
async function moi(t: ToChuc, rfqId: string): Promise<void> {
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
describe("S1.9101 — lần nộp: trigger đếm ở mỗi lần nộp duyệt, bên gọi không đặt được", () => {
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
describe("S1.9101 — khoản 256: lời duyệt mang lần nộp người duyệt đã xem", () => {
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

  it("[INV-D2] tổ chức CHƯA bật: lời duyệt gặp một lần mở gói đang chạy ⇒ chờ khoá, đọc lại thấy OPEN, từ chối có tên — trước `9501_lan_nop_da_xem` chữ ký ấy rơi lên gói đã mở", async () => {
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
describe("S1.9101 — khoản 257: lần trả về rút chữ ký của chính người trả, không của ai khác", () => {
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
describe("S1.9101 — `rfq_tra_ve`: cạnh về DRAFT kèm hàng của chính lần nộp; người, lần nộp, lý do nằm trong CSDL", () => {
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
describe("S1.9101 — đột biến: gỡ từng vế thì khoảng trống mở lại", () => {
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

  // [lượt soi S1.9101, F1] Khe thật của thứ tự trigger: D2 đọc trạng thái rồi, mấy câu sau, mới băm NỘI DUNG — mỗi câu một ảnh
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
    const a = await taoToChuc();
    const rfqId = await goiNhap(a, GOI_CAP_KEP);
    await nop(a, rfqId);
    await voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "\n    NEW.lan_nop_da_xem := NULL;", "", async () => {
      await duyetVoi(a, rfqId, a.pm2, undefined);
      await duyetVoi(a, rfqId, await phienKhac(a, a.pm2), 1);
    });
    expect(await soChuKy(rfqId)).toBe(2);
    expect(await loi(mo(a, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4b] [INV-D2] cạnh mở gói bỏ vế *người ký chưa trả về* ⇒ chữ ký của chính người trả về vẫn mở gói", async () => {
    expect(
      await voiHamDotBien(
        "public.rfq_kiem_chu_ky_danh_sach_khi_mo()",
        "\n     AND NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r\n                      WHERE r.org_id = a.org_id AND r.rfq_id = a.rfq_id\n                        AND r.returned_by = a.approver_user_id AND r.lan_nop >= a.lan_nop_da_xem);",
        ";",
        rutChuKy,
      ),
    ).toBe("OPEN");
  });

  it("[INV-K4b] cạnh mở gói bỏ vế *mang lần nộp* ⇒ chữ ký không mang lần nộp (dạng trước `9501_lan_nop_da_xem`) mở được gói", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    // Chữ ký dạng trước `9501_lan_nop_da_xem`: trigger so lần nộp tạm bỏ phép so, lời duyệt không mốc.
    await voiHamDotBien("public.rfq_chot_lan_nop_da_xem()", "IF NEW.lan_nop_da_xem IS DISTINCT FROM hien_tai THEN", "IF false THEN", () =>
      duyetVoi(t, rfqId, t.pm2, undefined),
    );
    expect((await loi(mo(t, rfqId)))?.message, "bản thật: chữ ký không mang lần nộp không đếm").toBe(loiConHieuLuc(1, 0));
    await voiHamDotBien(
      "public.rfq_kiem_chu_ky_danh_sach_khi_mo()",
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
// (6) GIỚI HẠN, ĐO — LẦN BẬT S3 GIỮA LÚC GÓI ĐANG CHỜ DUYỆT (lượt soi S1.9101, F6; khoản 9404)
//
// Ở tổ chức chưa bật, danh sách mời đổi được khi gói đang chờ duyệt (`076` chỉ chặn ở tổ chức đã bật) và lần nộp không đổi. Ca dưới
// ghim hành vi HÔM NAY; không mang nhãn bất biến: nó đo một khoảng trống, không đo một chốt.
// =============================================================================================
describe("S1.9101 — giới hạn, đo: tổ chức bật S3 khi gói đang chờ duyệt", () => {
  it("khoản 9404 — người duyệt đọc gói (lần nộp 1, một lời mời); PM mời thêm khi gói đang chờ — MVP1 cho —, rồi tổ chức BẬT S3: lời duyệt mốc 1 đi qua với danh sách HAI lời mời, và gói MỞ", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const daXem = (await doc(t, rfqId)).lanNop;
    await moi(t, rfqId);
    await batS3(t);
    await duyetVoi(t, rfqId, t.pm2, daXem);
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_invitations WHERE rfq_id = $1", [rfqId]);
    expect(rows, "chữ ký mang danh sách hai lời mời").toEqual([{ n: 2 }]);
    expect(await loi(mo(t, rfqId))).toBeNull();
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });
});
