import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { KiemSoatError, ghiNhanTinHieu, lietKeTinHieu } from "@trustprocure/kiem-soat";
import { issueRfqKeyPair } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { addRfqItem, approveRfq, cancelRfq, createRfq, openRfq, returnRfqToDraft, submitRfqForApproval } from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";
import { taoNhomHang } from "./nhom-hang.js";
import { CHOT_VAO_SO, ChotKiemSoatError } from "./chot-kiem-soat.js";

// =============================================================================================
// [S1.203 / S3.6b1] TÍN HIỆU CHIA NHỎ GÓI VÀ CHỐT K10a Ở CẠNH MỞ GÓI — ĐO TRÊN POSTGRES THẬT DƯỚI `app_api`
//
// Migration `088_tin_hieu_chia_nho`, gói `@trustprocure/kiem-soat`. Tệp ở `packages/rfq` chứ không ở gói kiểm soát: chốt nằm ở
// `openRfq`, và `g20-kiem-soat-khong-cham-duong-mo-thau` cấm mọi tệp dưới `packages/kiem-soat/src/` — kể cả tệp test — với tới
// `@trustprocure/rfq`.
//
// Fixture của spec S3 §7: bậc 0 / 100 triệu / 1 tỷ / 10 tỷ, cửa sổ 30 ngày; ba gói 480, 470, 490 triệu cùng nhóm hàng. Đo trước
// trên `master` (151cbd1): cả ba mở được, không bảng tín hiệu, 0 hàng `CONTROL_DENIED`.
//
// Mỗi lớp có một phép đo HÀNH VI và một ĐỘT BIẾN: tắt (hay viết lại) đúng lớp ấy thì chính câu vừa bị chặn đi lọt. Mỗi phép đo dựng
// TỔ CHỨC RIÊNG — công tắc ADR-080 một chiều, và tập anh em của tín hiệu là mọi gói cùng nhóm trong tổ chức.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const MOT_TY = 1_000_000_000;

const bac = (tu: number): Record<string, unknown> => ({
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
});
const BAC = JSON.stringify([bac(0), bac(100_000_000), bac(MOT_TY), { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true }]);

/** Bộ bọc khoá của bài test — cùng khuôn `key-material.int.test.ts`: không KMS, khoá riêng "bọc" bằng XOR. */
const boBocGia = {
  name: "gia-tin-hieu",
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

let db: TestDatabase;
let apiPool: pg.Pool;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 240000);

afterAll(async () => {
  await apiPool?.end();
  await db?.stop();
});

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo, nộp và mở mọi gói: người GÂY RA tín hiệu. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER — người duyệt thứ nhất; ở vài phép đo là người NỘP một gói. */
  readonly pm2: Nguoi;
  /** PROCUREMENT_MANAGER — người duyệt thứ hai và người ghi nhận ĐỘC LẬP. */
  readonly pm3: Nguoi;
  /** PROCUREMENT_MANAGER — người KHAI phiên bản chính sách mà gói ghim (§2.4 ⑺); giữ `rfq.approve`. */
  readonly pmCs: Nguoi;
  /** FINANCE — giữ `category.manage`, không giữ `rfq.approve`. */
  readonly tc: Nguoi;
  /** Phiên bản 2 — có bậc, cửa sổ 30 ngày; `null` ở tổ chức chưa bật. */
  readonly v2: string | null;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

/** Tổ chức mới. `daBat` ⇒ phiên bản 2 có bậc do `pmCs` khai, người FINANCE thứ hai ký — S3 bật. */
async function taoToChuc(daBat = true): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `tin-hieu-${randomBytes(4).toString("hex")}`,
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
  const pmCs = await nguoi("PROCUREMENT_MANAGER");
  const tc = await nguoi("FINANCE");
  const tc2 = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pmCs.s }),
  );
  let v2: string | null = null;
  if (daBat) {
    v2 = (
      await withTenant(apiPool, org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, chia_nho_cua_so_ngay, " +
            "tham_dinh_hieu_luc_thang, created_by, created_by_session_id) VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, $3, $4) " +
            "RETURNING id",
          [org, BAC, pmCs.u, pmCs.s],
        ),
      )
    ).rows[0]!.id;
    await withTenant(apiPool, org, (c) =>
      c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
        org,
        v2,
        tc2.u,
        tc2.s,
      ]),
    );
  }
  return { org, pm, pm2, pm3, pmCs, tc, v2 };
}

async function taoNhom(t: ToChuc, ma: string): Promise<string> {
  return (await withTenant(apiPool, t.org, (c) => taoNhomHang(c, t.org, { ma, ten: `Nhom ${ma}`, actorSessionId: t.tc.s }, apiPool))).id;
}

/** Gói `pm` tạo, có ngân sách và một hạng mục, NỘP bởi `nguoiNop` (mặc định `pm`). */
async function goiDaNop(t: ToChuc, nhom: string | null, giaTri: string, nguoiNop: Nguoi = t.pm): Promise<string> {
  const id = await withTenant(apiPool, t.org, async (c) => {
    const r = await createRfq(c, t.org, { title: `Thep ${giaTri}`, deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId: nhom });
    await setRfqBudget(c, t.org, { rfqId: r.id, estimatedValue: giaTri, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId: r.id, lineNo: 1, description: "Thep tam", quantity: "10.0000", unit: "tam", actorSessionId: t.pm.s });
    return r.id;
  });
  await withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId: id, actorSessionId: nguoiNop.s }, apiPool));
  return id;
}

/** Đủ chữ ký để mở: hai người khi gói cần duyệt kép, một khi không. */
async function duyet(t: ToChuc, rfqId: string): Promise<void> {
  const kep = (await db.pool.query<{ k: boolean }>("SELECT requires_dual_approval AS k FROM rfq_packages WHERE id = $1", [rfqId]))
    .rows[0]!.k;
  for (const ai of kep ? [t.pm2, t.pm3] : [t.pm2]) {
    await withTenant(apiPool, t.org, (c) => approveRfq(c, t.org, { rfqId, sessionId: ai.s }, apiPool));
  }
}

/** Mở qua ĐƯỜNG SẢN XUẤT — `null` khi đi qua, còn không thì chính lỗi. */
async function mo(t: ToChuc, rfqId: string): Promise<unknown> {
  return withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool)).then(
    () => null,
    (e: unknown) => e,
  );
}

async function ghiNhan(t: ToChuc, rfqId: string, ai: Nguoi, lyDo = "Hai goi cho hai cong trinh khac nhau"): Promise<unknown> {
  return withTenant(apiPool, t.org, (c) => ghiNhanTinHieu(c, t.org, { rfqId, lyDo, actorSessionId: ai.s }, apiPool));
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

async function trangThai(rfqId: string): Promise<string> {
  return (await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.status;
}

async function hangChot(org: string, rfqId: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ ma: string }>(
    "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, rfqId],
  );
  return rows.map((r) => r.ma);
}

async function hangSo(org: string, action: string, rfqId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3 ORDER BY seq",
    [org, action, rfqId],
  );
  return rows.map((r) => r.payload);
}

async function tinHieuDaGhi(rfqId: string): Promise<{ id: string; nguon: string; bang_chung: Record<string, unknown> }[]> {
  const { rows } = await db.pool.query<{ id: string; nguon: string; bang_chung: Record<string, unknown> }>(
    "SELECT id, nguon, bang_chung FROM governance_signals WHERE rfq_id = $1 ORDER BY tinh_luc, id",
    [rfqId],
  );
  return rows;
}

/** Tín hiệu tính NGAY LÚC HỎI, dưới `app_api` trong tổ chức. */
async function tinHieuHienTai(org: string, rfqId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await withTenant(apiPool, org, (c) =>
    c.query<{ bc: Record<string, unknown> | null }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [org, rfqId]),
  );
  return rows[0]!.bc;
}

async function khoaDaDuc(rfqId: string): Promise<number> {
  return (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_key_material WHERE rfq_id = $1", [rfqId])).rows[0]!.n;
}

/** Câu viết tay dưới `app_api` trong tổ chức — đi vòng tầng gói, chỉ trigger còn canh. */
async function tayDuoiApi(org: string, sql: string, thamSo: readonly unknown[]): Promise<pg.QueryResult> {
  return withTenant(apiPool, org, (c) => c.query(sql, [...thamSo]));
}

const CAU_MO_TAY =
  "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1";

/**
 * ĐỘT BIẾN trong MỘT giao dịch rồi ROLLBACK: chủ sở hữu chạy `dotBien`, rồi `viec` chạy dưới `app_api` trong tổ chức trên CÙNG
 * kết nối. Lược đồ không đổi sau đó.
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

const sapXep = (ds: readonly string[]): string[] => [...ds].sort();

describe("[INV-K10a] tín hiệu chia nhỏ chặn lần mở gói tới khi một người độc lập ghi nhận nó", () => {
  it("[INV-K10a] ĐO: ba gói 480/470/490 triệu cùng nhóm trong 30 ngày — gói thứ ba mang tín hiệu từ lúc nộp và KHÔNG mở được khi chưa ai ghi nhận; lần từ chối vào sổ, không khoá nào được đúc; ghi nhận độc lập thì mở được", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    const g1 = await goiDaNop(t, thep, "480000000.00");
    await duyet(t, g1);
    expect(await mo(t, g1)).toBeNull();
    const g2 = await goiDaNop(t, thep, "470000000.00");
    await duyet(t, g2);
    expect(await mo(t, g2)).toBeNull();
    const g3 = await goiDaNop(t, thep, "490000000.00");

    // Hai gói đầu: tổng chưa tới cận 1 tỷ ⇒ không tín hiệu, không hàng nào.
    expect(await tinHieuDaGhi(g1)).toEqual([]);
    expect(await tinHieuDaGhi(g2)).toEqual([]);

    // Gói thứ ba: ảnh chụp lúc nộp — bằng chứng không mang ước lượng nào.
    const daGhi = await tinHieuDaGhi(g3);
    expect(daGhi).toHaveLength(1);
    expect(daGhi[0]!.nguon).toBe("NOP_DUYET");
    expect(daGhi[0]!.bang_chung).toEqual({
      loai: "PURCHASE_SPLITTING",
      nhom_hang: thep,
      chinh_sach: t.v2,
      cua_so_ngay: 30,
      can: MOT_TY,
      goi: sapXep([g1, g2, g3]),
    });
    expect(await tinHieuHienTai(t.org, g3)).toEqual(daGhi[0]!.bang_chung);
    expect(await hangSo(t.org, "GOVERNANCE_SIGNAL_RECORDED", g3)).toEqual([
      { signalId: daGhi[0]!.id, loai: "PURCHASE_SPLITTING", nguon: "NOP_DUYET" },
    ]);

    await duyet(t, g3);
    const e = await mo(t, g3);
    expect(e).toBeInstanceOf(ChotKiemSoatError);
    expect((e as ChotKiemSoatError).lyDo).toBe("TIN_HIEU_CHUA_GHI_NHAN");
    expect((e as Error).message).toBe(CHOT_VAO_SO.TIN_HIEU_CHUA_GHI_NHAN.thongDiep);
    expect(await hangChot(t.org, g3)).toEqual(["TIN_HIEU_CHUA_GHI_NHAN"]);
    expect(await trangThai(g3)).toBe("PENDING_APPROVAL");
    // Chốt hỏi TRƯỚC `issueRfqKeyPair` (khoản 31): không một hàng khoá nào của gói bị từ chối.
    expect(await khoaDaDuc(g3)).toBe(0);

    const doc = await withTenant(apiPool, t.org, (c) => lietKeTinHieu(c, t.org, g3));
    expect(doc.canGhiNhan).toBe(true);
    expect(doc.hienTai).toEqual(daGhi[0]!.bang_chung);
    expect(doc.tinHieu.map((x) => [x.id, x.nguon, x.doTinCay, x.ghiNhan.length])).toEqual([[daGhi[0]!.id, "NOP_DUYET", "XAC_DINH", 0]]);
    expect(doc.tinHieu[0]!.giaiThich).toContain("3 gói cùng nhóm hàng");

    const kq = await ghiNhan(t, g3, t.pm3, "Ba cong trinh, ba hop dong khung khac nhau");
    expect(kq).toMatchObject({ signalId: daGhi[0]!.id, tinHieuMoi: false });
    expect(await hangSo(t.org, "GOVERNANCE_SIGNAL_ACKNOWLEDGED", g3)).toEqual([
      { signalId: daGhi[0]!.id, ackId: (kq as { ackId: string }).ackId, lyDo: "Ba cong trinh, ba hop dong khung khac nhau" },
    ]);
    const sau = await withTenant(apiPool, t.org, (c) => lietKeTinHieu(c, t.org, g3));
    expect(sau.canGhiNhan).toBe(false);
    expect(sau.tinHieu[0]!.ghiNhan.map((a) => [a.nguoi, a.lyDo])).toEqual([[t.pm3.u, "Ba cong trinh, ba hop dong khung khac nhau"]]);

    expect(await mo(t, g3)).toBeNull();
    expect(await trangThai(g3)).toBe("OPEN");
    expect(await hangChot(t.org, g3)).toEqual(["TIN_HIEU_CHUA_GHI_NHAN"]);
  });

  it("[INV-K10a] luật người: người TẠO, người NỘP một gói anh em và người KHAI phiên bản không ghi nhận được — mỗi lần vào sổ với mã của nó; FINANCE không giữ `rfq.approve`; trigger chặn cùng ba người trên câu viết tay", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    await goiDaNop(t, thep, "480000000.00");
    // pm2 NỘP gói anh em nhưng không tạo gói nào — vẫn là người gây ra (chủ dự án chốt 2026-09-29).
    await goiDaNop(t, thep, "470000000.00", t.pm2);
    const g3 = await goiDaNop(t, thep, "490000000.00");
    const sig = (await tinHieuDaGhi(g3))[0]!.id;

    for (const [ai, ma] of [
      [t.pm, "K10A_TU_GHI_NHAN"],
      [t.pm2, "K10A_TU_GHI_NHAN"],
      [t.pmCs, "K10A_TAC_GIA_CHINH_SACH"],
    ] as const) {
      const e = await loi(ghiNhan(t, g3, ai));
      expect(e?.name, `${ma}`).toBe("ChotKiemSoatError");
      expect(e?.message).toBe(CHOT_VAO_SO[ma].thongDiep);
    }
    expect(await hangChot(t.org, g3)).toEqual(["K10A_TU_GHI_NHAN", "K10A_TU_GHI_NHAN", "K10A_TAC_GIA_CHINH_SACH"]);

    const khongQuyen = await loi(ghiNhan(t, g3, t.tc));
    expect(khongQuyen?.name).toBe("PermissionDeniedError");

    // Lớp chặn cuối: cùng ba người, câu viết tay dưới `app_api` — tên ràng buộc nói luật nào.
    const CAU_GHI_NHAN_TAY =
      "INSERT INTO governance_signal_acks (org_id, signal_id, ly_do, created_by, created_by_session_id) VALUES ($1, $2, 'ly do', $3, $4)";
    for (const [ai, rangBuoc] of [
      [t.pm, "k10_nguoi_gay_ra_tu_ghi_nhan"],
      [t.pm2, "k10_nguoi_gay_ra_tu_ghi_nhan"],
      [t.pmCs, "k10_tac_gia_chinh_sach_ghi_nhan"],
    ] as const) {
      const e = await loi(tayDuoiApi(t.org, CAU_GHI_NHAN_TAY, [t.org, sig, ai.u, ai.s]));
      expect([e?.code, e?.constraint]).toEqual(["23514", rangBuoc]);
    }
    const tayTc = await loi(tayDuoiApi(t.org, CAU_GHI_NHAN_TAY, [t.org, sig, t.tc.u, t.tc.s]));
    expect(tayTc?.code).toBe("23514");
    expect(tayTc?.message).toContain("rfq.approve");
    expect((await db.pool.query("SELECT 1 FROM governance_signal_acks WHERE signal_id = $1", [sig])).rowCount).toBe(0);

    // Người độc lập: đi qua, một lần — lần thứ hai là lời từ chối nghiệp vụ, không phải một hàng thứ hai.
    expect(await ghiNhan(t, g3, t.pm3)).toMatchObject({ signalId: sig, tinHieuMoi: false });
    const lan2 = await loi(ghiNhan(t, g3, t.pm3));
    expect(lan2?.name).toBe("KiemSoatError");
    expect((await db.pool.query("SELECT 1 FROM governance_signal_acks WHERE signal_id = $1", [sig])).rowCount).toBe(1);
  });

  it("[INV-K10a] ĐỘT BIẾN luật người: hàm luật người trả NULL ⇒ người tạo ghi nhận được và gói của chính họ mở được — cả tầng gói lẫn trigger chỉ đứng trên hàm ấy", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    await goiDaNop(t, thep, "480000000.00");
    await goiDaNop(t, thep, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");
    const dotBien = await defDotBien(
      "public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)",
      "RETURN 'K10A_TU_GHI_NHAN';",
      "RETURN NULL;",
    );
    const kq = await trongDotBien(t.org, [dotBien], (c) =>
      ghiNhanTinHieu(c, t.org, { rfqId: g3, lyDo: "tu ghi nhan", actorSessionId: t.pm.s }, apiPool),
    );
    expect(kq.tinHieuMoi).toBe(false);
    // Đối chứng: lược đồ thật — cùng câu gọi bị chặn.
    expect((await loi(ghiNhan(t, g3, t.pm)))?.name).toBe("ChotKiemSoatError");
  });

  it("[INV-K10a] TRÔI BẰNG CHỨNG: gói anh em trả về DRAFT sau lần ghi nhận ⇒ lần ghi nhận cũ không còn đủ; ghi nhận tay trên tín hiệu cũ bị chặn; lần ghi nhận mới LƯU một tín hiệu `GHI_NHAN` rồi gói mở được", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    const g1 = await goiDaNop(t, thep, "480000000.00");
    const g2 = await goiDaNop(t, thep, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");
    const g4 = await goiDaNop(t, thep, "300000000.00");
    const cu = (await tinHieuDaGhi(g4))[0]!;
    expect((cu.bang_chung as { goi: string[] }).goi).toEqual(sapXep([g1, g2, g3, g4]));
    await duyet(t, g4);
    await ghiNhan(t, g4, t.pm3);

    await withTenant(apiPool, t.org, (c) =>
      returnRfqToDraft(c, t.org, { rfqId: g1, reason: "Sua lai hang muc", actorSessionId: t.pm.s }, apiPool),
    );
    const moi = await tinHieuHienTai(t.org, g4);
    expect(moi).toMatchObject({ can: MOT_TY, goi: sapXep([g2, g3, g4]) });

    const e = await mo(t, g4);
    expect((e as ChotKiemSoatError).lyDo).toBe("TIN_HIEU_CHUA_GHI_NHAN");
    expect(await khoaDaDuc(g4)).toBe(0);
    expect((await withTenant(apiPool, t.org, (c) => lietKeTinHieu(c, t.org, g4))).canGhiNhan).toBe(true);

    // Lớp chặn cuối: một lần ghi nhận viết tay trỏ tới tín hiệu CŨ — bằng chứng của nó không còn là kết quả hiện tại.
    const tay = await loi(
      tayDuoiApi(
        t.org,
        "INSERT INTO governance_signal_acks (org_id, signal_id, ly_do, created_by, created_by_session_id) VALUES ($1, $2, 'ly do', $3, $4)",
        [t.org, cu.id, t.pm2.u, t.pm2.s],
      ),
    );
    expect([tay?.code, tay?.constraint]).toEqual(["23514", "k10_bang_chung_da_doi"]);

    const kq = (await ghiNhan(t, g4, t.pm3, "Goi 1 da tra ve soan thao; ba goi con lai van cho ba cong trinh")) as {
      signalId: string;
      tinHieuMoi: boolean;
    };
    expect(kq.tinHieuMoi).toBe(true);
    const daGhi = await tinHieuDaGhi(g4);
    expect(daGhi.map((x) => x.nguon)).toEqual(["NOP_DUYET", "GHI_NHAN"]);
    expect(daGhi[1]!.id).toBe(kq.signalId);
    expect(daGhi[1]!.bang_chung).toEqual(moi);
    expect((await hangSo(t.org, "GOVERNANCE_SIGNAL_RECORDED", g4)).map((p) => p["nguon"])).toEqual(["NOP_DUYET", "GHI_NHAN"]);

    expect(await mo(t, g4)).toBeNull();
    expect(await hangChot(t.org, g4)).toEqual(["TIN_HIEU_CHUA_GHI_NHAN"]);
  });

  it("[INV-K10a] tập anh em: gói ĐÃ HUỶ và gói KHÁC nhóm hàng không tính ⇒ không tín hiệu, gói mở không cần ghi nhận; ĐỘT BIẾN bỏ vế huỷ thì tín hiệu hiện ra", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    const xiMang = await taoNhom(t, "XI_MANG");
    await goiDaNop(t, thep, "480000000.00");
    const huy = await goiDaNop(t, thep, "470000000.00");
    await withTenant(apiPool, t.org, (c) => cancelRfq(c, t.org, { rfqId: huy, reason: "Gop vao goi khac", actorSessionId: t.pm.s }, apiPool));
    await goiDaNop(t, xiMang, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");

    expect(await tinHieuHienTai(t.org, g3)).toBeNull();
    expect(await tinHieuDaGhi(g3)).toEqual([]);
    await duyet(t, g3);
    expect(await mo(t, g3)).toBeNull();
    expect(await hangChot(t.org, g3)).toEqual([]);

    const boVeHuy = await defDotBien(
      "public.tin_hieu_chia_nho(uuid, uuid)",
      "AND r.status NOT IN ('DRAFT', 'CANCELLED')",
      "AND r.status NOT IN ('DRAFT')",
    );
    const bc = await trongDotBien(t.org, [boVeHuy], async (c) =>
      (await c.query<{ bc: { goi: string[] } | null }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [t.org, g3])).rows[0]!.bc,
    );
    expect(bc?.goi).toContain(huy);
  });

  it("[INV-K10a] cận bậc: tổng BẰNG cận thì bắn (`≥`, như `rfq_bac_cua`); gói TỪ cận trở lên không vào tập của cận ấy; nhiều cận cùng bắn thì lấy cận CAO NHẤT", async () => {
    const t = await taoToChuc();
    // Nhóm A — 500 + 500 = đúng 1 tỷ.
    const a = await taoNhom(t, "A");
    const a1 = await goiDaNop(t, a, "500000000.00");
    const a2 = await goiDaNop(t, a, "500000000.00");
    expect(await tinHieuHienTai(t.org, a2)).toMatchObject({ can: MOT_TY, goi: sapXep([a1, a2]) });
    expect((await tinHieuDaGhi(a2)).map((x) => x.nguon)).toEqual(["NOP_DUYET"]);
    // Gói 1 tỷ nộp SAU hai gói ấy: tập của cận 1 tỷ đủ tổng nhưng không chứa nó ⇒ không tín hiệu cho nó (`bool_or`).
    const a3 = await goiDaNop(t, a, "1000000000.00");
    expect(await tinHieuHienTai(t.org, a3)).toBeNull();
    const boChuaGoi = await defDotBien("public.tin_hieu_chia_nho(uuid, uuid)", "HAVING bool_or(t.id = p_rfq) AND ", "HAVING ");
    const bcKhongChua = await trongDotBien(t.org, [boChuaGoi], async (c) =>
      (await c.query<{ bc: unknown }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [t.org, a3])).rows[0]!.bc,
    );
    expect(bcKhongChua, "ĐỘT BIẾN bỏ `bool_or`: gói nhận tín hiệu của một tập không chứa nó").toMatchObject({ can: MOT_TY, goi: sapXep([a1, a2]) });

    // Nhóm B — gói 1 tỷ đứng ở bậc 1 tỷ, không dưới nó: 400 + 500 còn thiếu, tổng ba gói chưa tới 10 tỷ.
    const b = await taoNhom(t, "B");
    await goiDaNop(t, b, "1000000000.00");
    await goiDaNop(t, b, "400000000.00");
    const b3 = await goiDaNop(t, b, "500000000.00");
    expect(await tinHieuHienTai(t.org, b3)).toBeNull();
    const nhoHonHoacBang = await defDotBien("public.tin_hieu_chia_nho(uuid, uuid)", "ON t.gia_tri < c.can", "ON t.gia_tri <= c.can");
    const bcDotBien = await trongDotBien(t.org, [nhoHonHoacBang], async (c) =>
      (await c.query<{ bc: unknown }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [t.org, b3])).rows[0]!.bc,
    );
    expect(bcDotBien, "ĐỘT BIẾN `<=`: gói 1 tỷ lọt vào tập của cận 1 tỷ").toMatchObject({ can: MOT_TY });

    // Nhóm C — 60 + 950 + 50: cận 100 triệu bắn ({60, 50}) VÀ cận 1 tỷ bắn (cả ba) ⇒ bằng chứng mang cận 1 tỷ.
    const cNhom = await taoNhom(t, "C");
    const c1 = await goiDaNop(t, cNhom, "60000000.00");
    const c2 = await goiDaNop(t, cNhom, "950000000.00");
    const c3 = await goiDaNop(t, cNhom, "50000000.00");
    expect(await tinHieuHienTai(t.org, c3)).toMatchObject({ can: MOT_TY, goi: sapXep([c1, c2, c3]) });
    const tangDan = await defDotBien("public.tin_hieu_chia_nho(uuid, uuid)", "ORDER BY c.can DESC", "ORDER BY c.can ASC");
    const bcThap = await trongDotBien(t.org, [tangDan], async (c) =>
      (await c.query<{ bc: unknown }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [t.org, c3])).rows[0]!.bc,
    );
    expect(bcThap, "ĐỘT BIẾN thứ tự cận: bằng chứng rơi về cận 100 triệu").toMatchObject({ can: 100_000_000, goi: sapXep([c1, c3]) });
  });

  it("[INV-K10a] cửa sổ neo vào `submitted_at` của CHÍNH gói: anh em nộp đúng 30 ngày trước thì tính, sớm hơn một micro giây thì không; gói nộp SAU không vào cửa sổ của gói trước", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    const g1 = await goiDaNop(t, thep, "480000000.00");
    const g2 = await goiDaNop(t, thep, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");
    // Gói nộp trước không thấy gói nộp sau: cửa sổ của g2 là [g2 − 30 ngày, g2].
    expect(await tinHieuHienTai(t.org, g2)).toBeNull();

    const dichG1 = (khoang: string): string =>
      `UPDATE rfq_packages SET submitted_at = (SELECT submitted_at FROM rfq_packages WHERE id = '${g3}') - interval '${khoang}' ` +
      `WHERE id = '${g1}'`;
    const doSau = async (khoang: string): Promise<unknown> =>
      trongDotBien(t.org, ["ALTER TABLE rfq_packages DISABLE TRIGGER USER", dichG1(khoang)], async (c) =>
        (await c.query<{ bc: unknown }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [t.org, g3])).rows[0]!.bc,
      );
    expect(await doSau("30 days")).toMatchObject({ goi: sapXep([g1, g2, g3]) });
    expect(await doSau("30 days 1 microsecond")).toBeNull();
  });

  it("[INV-K10a] tiền tệ: anh em khác đơn vị tiền không cộng vào tổng — ĐỘT BIẾN bỏ vế tiền tệ thì nó được cộng", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    const g1 = await goiDaNop(t, thep, "480000000.00");
    const g2 = await goiDaNop(t, thep, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");
    // Không đường sản xuất nào đặt một ngân sách khác tiền tệ của phiên bản ghim (`rfq_bac_cua` từ chối): dữ liệu dựng bằng tay.
    const doiTienTe = `UPDATE rfq_budgets SET currency = 'USD' WHERE rfq_id = '${g1}'`;
    const hoi = async (c: pg.PoolClient): Promise<unknown> =>
      (await c.query<{ bc: unknown }>("SELECT public.tin_hieu_chia_nho($1, $2) AS bc", [t.org, g3])).rows[0]!.bc;
    expect(await trongDotBien(t.org, ["ALTER TABLE rfq_budgets DISABLE TRIGGER USER", doiTienTe], hoi)).toBeNull();
    const boVeTienTe = await defDotBien("public.tin_hieu_chia_nho(uuid, uuid)", "AND b.currency = g.currency", "");
    expect(await trongDotBien(t.org, ["ALTER TABLE rfq_budgets DISABLE TRIGGER USER", doiTienTe, boVeTienTe], hoi)).toMatchObject({
      goi: sapXep([g1, g2, g3]),
    });
  });

  it("[INV-K10a] đối chứng MVP1: tổ chức chưa bật — cùng ba gói mở được, không hàng tín hiệu, không hàng sổ", async () => {
    const t = await taoToChuc(false);
    const ids: string[] = [];
    for (const v of ["480000000.00", "470000000.00", "490000000.00"]) {
      const id = await goiDaNop(t, null, v);
      await duyet(t, id);
      expect(await mo(t, id)).toBeNull();
      ids.push(id);
    }
    for (const id of ids) {
      expect(await tinHieuDaGhi(id)).toEqual([]);
      expect(await hangChot(t.org, id)).toEqual([]);
    }
  });

  it("[INV-K10a] lớp chặn cuối: câu mở VIẾT TAY bị trigger chặn với tên `k10_tin_hieu_chua_ghi_nhan`; ĐỘT BIẾN tắt trigger thì câu ấy đi qua; ĐỘT BIẾN vị từ trả NULL thì `openRfq` mở được", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    await goiDaNop(t, thep, "480000000.00");
    await goiDaNop(t, thep, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");
    await duyet(t, g3);

    // Câu viết tay đi đúng thứ tự mà `017` cưỡng chế (C5): đúc khoá, rồi đổi trạng thái — cùng giao dịch. Không có K10a, câu ấy
    // mở được gói; với K10a, trigger ở cạnh là thứ duy nhất đứng giữa.
    const moTay = async (c: pg.PoolClient): Promise<void> => {
      await issueRfqKeyPair(c, t.org, { rfqId: g3, actorSessionId: t.pm.s, orgKeys: boBocGia });
      await c.query(CAU_MO_TAY, [g3, t.pm.u, t.pm.s]);
    };
    const tay = await loi(withTenant(apiPool, t.org, moTay));
    expect([tay?.code, tay?.constraint], tay?.message).toEqual(["23514", "k10_tin_hieu_chua_ghi_nhan"]);
    expect(tay?.message).toContain("TIN_HIEU_CHUA_GHI_NHAN");
    expect(await khoaDaDuc(g3)).toBe(0);

    const tatTrigger = await trongDotBien(t.org, ["ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_tin_hieu_khi_mo"], (c) =>
      loi(moTay(c)),
    );
    expect(tatTrigger).toBeNull();

    const viTuRong = await defDotBien("public.rfq_chot_tin_hieu(uuid, uuid)", "RETURN 'TIN_HIEU_CHUA_GHI_NHAN';", "RETURN NULL;");
    const trangThaiSau = await trongDotBien(t.org, [viTuRong], async (c) => {
      const r = await openRfq(c, t.org, { rfqId: g3, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool);
      return r.status;
    });
    expect(trangThaiSau).toBe("OPEN");

    // Lược đồ thật sau hai đột biến: vẫn chặn.
    expect((await mo(t, g3)) as ChotKiemSoatError).toBeInstanceOf(ChotKiemSoatError);
    expect(await trangThai(g3)).toBe("PENDING_APPROVAL");
  });

  it("[INV-K10a] bằng chứng do CSDL đặt và chỉ ghi thêm: `app_api` không khai được cột bằng chứng, không sửa, không xoá; tín hiệu chỉ ghi cho gói đang chờ duyệt có tín hiệu", async () => {
    const t = await taoToChuc();
    const thep = await taoNhom(t, "THEP");
    const g1 = await goiDaNop(t, thep, "480000000.00");
    await goiDaNop(t, thep, "470000000.00");
    const g3 = await goiDaNop(t, thep, "490000000.00");
    const sig = (await tinHieuDaGhi(g3))[0]!.id;

    const khai = await loi(
      tayDuoiApi(
        t.org,
        "INSERT INTO governance_signals (org_id, rfq_id, loai, nguon, bang_chung, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'PURCHASE_SPLITTING', 'NOP_DUYET', '{}'::jsonb, $3, $4)",
        [t.org, g3, t.pm.u, t.pm.s],
      ),
    );
    expect(khai?.code).toBe("42501");
    for (const cau of [
      "UPDATE governance_signals SET giai_thich = 'khac' WHERE id = $1",
      "DELETE FROM governance_signals WHERE id = $1",
    ]) {
      expect((await loi(tayDuoiApi(t.org, cau, [sig])))?.code, cau).toBe("42501");
    }

    const CAU_GHI_TAY =
      "INSERT INTO governance_signals (org_id, rfq_id, loai, nguon, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'PURCHASE_SPLITTING', 'GHI_NHAN', $3, $4)";
    // g1 không có tín hiệu; một gói đã mở thì không còn chờ duyệt.
    const khongCo = await loi(tayDuoiApi(t.org, CAU_GHI_TAY, [t.org, g1, t.pm3.u, t.pm3.s]));
    expect([khongCo?.code, khongCo?.constraint]).toEqual(["23514", "tin_hieu_khong_co"]);
    await ghiNhan(t, g3, t.pm3);
    await duyet(t, g3);
    expect(await mo(t, g3)).toBeNull();
    const daMo = await loi(tayDuoiApi(t.org, CAU_GHI_TAY, [t.org, g3, t.pm3.u, t.pm3.s]));
    expect([daMo?.code, daMo?.constraint]).toEqual(["23514", "tin_hieu_goi_khong_cho_duyet"]);

    // Ghi nhận ở gói đã mở, và ghi nhận ở gói không có tín hiệu: lời từ chối nghiệp vụ, không hàng nào.
    expect((await loi(ghiNhan(t, g3, t.pm3)))?.name).toBe("KiemSoatError");
    expect((await loi(ghiNhan(t, g1, t.pm3)))?.name).toBe("KiemSoatError");
    const rong = await loi(ghiNhan(t, g1, t.pm3, "   "));
    expect(rong?.name).toBe("KiemSoatError");
    expect(rong?.message).toBe(new KiemSoatError("Ghi lý do khi ghi nhận tín hiệu.").message);
  });

  it("[INV-K10a] từ vựng: mọi mã ba hàm vị từ trả về có dòng K10a VÀO SỔ trong `CHOT_VAO_SO`, và mọi dòng K10a đều có hàm trả nó", async () => {
    const { rows } = await db.pool.query<{ src: string }>(
      "SELECT prosrc AS src FROM pg_proc WHERE oid IN ('public.rfq_chot_tin_hieu(uuid, uuid)'::regprocedure, " +
        "'public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)'::regprocedure)",
    );
    const traVe = new Set(rows.flatMap((r) => [...r.src.matchAll(/RETURN '([A-Z0-9_]+)'/gu)].map((m) => m[1]!)));
    const k10a = Object.entries(CHOT_VAO_SO)
      .filter(([, v]) => v.chot === "K10a")
      .map(([k]) => k);
    expect(sapXep([...traVe])).toEqual(sapXep(k10a));
    for (const ma of k10a) expect(CHOT_VAO_SO[ma as keyof typeof CHOT_VAO_SO].vaoSo, ma).toBe(true);
  });
});
