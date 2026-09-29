import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { PermissionDeniedError } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  RfqError,
  addRfqItem,
  approveRfq,
  createRfq,
  openRfq,
  returnRfqToDraft,
  submitRfqForApproval,
} from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

// =============================================================================================
// [S1.9101 / S3.2b] CẠNH PENDING_APPROVAL→DRAFT — `returnRfqToDraft` VÀ TRIGGER `rfq_packages_kiem_canh_ve_soan`
//
// Đường ứng dụng ĐẦU TIÊN của cạnh C-1 (`011`), và lối DUY NHẤT để sửa danh sách mời sau khi nộp duyệt ở tổ chức đã bật S3 —
// K4a (`076`) cấm thêm hay thu hồi lời mời ở PENDING_APPROVAL. Ba điều được đo, mỗi điều một đối chứng:
//   ⑴ ai: người TẠO gói (giữ `rfq.create`) hoặc người giữ `rfq.approve` (ADR-084 ⑵) — người khác để lại `PERMISSION_DENIED`;
//   ⑵ ở đâu: chỉ tổ chức ĐÃ BẬT (S1.185) — tầng gói từ chối trước mọi câu ghi, KHÔNG vào sổ; trigger `9501` chặn câu viết tay;
//   ⑶ chữ ký: cạnh không xoá chữ ký nào — nộp lại nguyên như cũ thì chữ ký cũ vẫn mở được gói; đổi danh sách thì không (K4b).
//
// Mỗi phép đo dựng TỔ CHỨC RIÊNG: công tắc ADR-080 một chiều.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `danh-sach-moi.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. ***
const boBocGia = {
  name: "gia-cho-test-ve-soan",
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

let db: TestDatabase;
let apiPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo gói, mời, nộp, mở. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER khác người tạo — ký, và trả về được bằng `rfq.approve`. */
  readonly pm2: Nguoi;
  /** BUYER — giữ `rfq.create` mà KHÔNG giữ `rfq.approve`. */
  readonly nm: Nguoi;
  /** FINANCE — ký phiên bản chính sách; không giữ `rfq.create`, không giữ `rfq.approve`. */
  readonly tc: Nguoi;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`vs-${randomBytes(4).toString("hex")}`]);
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
  const t = { org, pm: await nguoi("PROCUREMENT_MANAGER"), pm2: await nguoi("PROCUREMENT_MANAGER"), nm: await nguoi("BUYER"), tc: await nguoi("FINANCE") };
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: t.pm.s }),
  );
  return t;
}

/** BẬT S3: phiên bản 2 có bậc, PM tạo, FINANCE ký — khuôn `batS3` của `danh-sach-moi`. */
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
}

async function toChucDaBat(): Promise<ToChuc> {
  const t = await taoToChuc();
  await batS3(t);
  return t;
}

/** Gói DRAFT do `ai` tạo, có ngân sách (dưới ngưỡng kép — một chữ ký) và một hạng mục. */
async function goiNhap(t: ToChuc, ai: Nguoi = t.pm): Promise<string> {
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: ai.s })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: ai.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: ai.s });
  });
  return rfqId;
}

/** Một lời mời chèn bằng CÂU của `createInvitation` (`packages/invitation`) dưới `app_api` — gói này không phụ thuộc gói kia. */
async function moi(t: ToChuc, rfqId: string): Promise<string> {
  const ncc = await motId(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
  );
  const duoi = randomBytes(6).toString("hex");
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, '0900000001', $4, $5) RETURNING id",
    [t.org, ncc, `lh${duoi}@vidu.vn`, t.pm.u, t.pm.s],
  );
  return (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO public.rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
        [t.org, rfqId, ncc, lh, t.pm.u, t.pm.s],
      ),
    )
  ).rows[0]!.id;
}

const nop = (t: ToChuc, rfqId: string, ai: Nguoi = t.pm): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: ai.s }, apiPool));
const duyet = (t: ToChuc, rfqId: string, ai: Nguoi): Promise<void> =>
  withTenant(apiPool, t.org, (c) => approveRfq(c, t.org, { rfqId, sessionId: ai.s }, apiPool));
const mo = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
const veSoan = (t: ToChuc, rfqId: string, ai: Nguoi, reason = "sua danh sach moi"): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => returnRfqToDraft(c, t.org, { rfqId, reason, actorSessionId: ai.s }, apiPool));

async function thu(p: Promise<unknown>): Promise<unknown> {
  try {
    return await p;
  } catch (e) {
    return e;
  }
}

async function trangThaiGoi(rfqId: string): Promise<string> {
  return (await db.pool.query<{ s: string }>("SELECT status AS s FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.s;
}

async function soChuKy(rfqId: string): Promise<number> {
  return (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_approvals WHERE rfq_id = $1", [rfqId])).rows[0]!.n;
}

/** Hàng sổ của gói theo `action`, thứ tự nối chuỗi. */
async function hangSo(org: string, rfqId: string, action: string): Promise<{ actor: string; payload: unknown }[]> {
  const { rows } = await db.pool.query<{ actor_id: string; payload: unknown }>(
    "SELECT actor_id, payload FROM audit_events WHERE org_id = $1 AND resource_id = $2 AND action = $3 ORDER BY seq",
    [org, rfqId, action],
  );
  return rows.map((h) => ({ actor: h.actor_id, payload: h.payload }));
}

/** Thay thân một hàm bằng MỘT phép thay chuỗi trên `pg_get_functiondef`, COMMIT, chạy `viec`, rồi trả thân gốc — khuôn `danh-sach-moi`. */
async function voiHamDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  await db.pool.query(goc.replace(cu, moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
  }
}

/** Câu viết tay của cạnh, dưới `app_api` trong tổ chức — không qua tầng gói. */
const CAU_VE_SOAN = "UPDATE public.rfq_packages SET status = 'DRAFT' WHERE id = $1 AND status = 'PENDING_APPROVAL'";
const LOI_TRIGGER = "Canh PENDING_APPROVAL -> DRAFT chi mo cho to chuc da bat S3 (ADR-080)";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.9101 / S3.2b] cạnh PENDING_APPROVAL→DRAFT", () => {
  it("[INV-K4a] người tạo trả gói về DRAFT: một hàng `RFQ_RETURNED_TO_DRAFT` mang lý do; chữ ký cũ ở lại; nộp lại NGUYÊN như cũ thì chữ ký ấy vẫn mở được gói", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);

    const kq = (await veSoan(t, rfqId, t.pm, "them nha cung cap")) as { status: string };
    expect(kq.status).toBe("DRAFT");
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
    expect(await hangSo(t.org, rfqId, "RFQ_RETURNED_TO_DRAFT")).toEqual([{ actor: t.pm.u, payload: { reason: "them nha cung cap" } }]);
    expect(await soChuKy(rfqId), "cạnh KHÔNG xoá chữ ký (011 C-1)").toBe(1);

    await nop(t, rfqId);
    await mo(t, rfqId);
    expect(await trangThaiGoi(rfqId), "nội dung và danh sách không đổi ⇒ chữ ký cũ khớp cả hai băm").toBe("OPEN");
  });

  it("[INV-K4b] đổi danh sách sau khi trả về: chữ ký cũ KHÔNG mở được gói; người ấy ký lại trên danh sách mới thì mở", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await veSoan(t, rfqId, t.pm2, "thieu nha cung cap");
    await moi(t, rfqId);
    await nop(t, rfqId);

    const e = await thu(mo(t, rfqId));
    expect((e as Error).message).toBe("RFQ nay can 1 chu ky TREN DANH SACH MOI HIEN TAI, moi co 0 (K4b)");
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
    expect(await soChuKy(rfqId), "hai chữ ký của CÙNG một người trên hai danh sách").toBe(2);
  });

  it("[INV-K4b] [INV-D2] đổi NGÂN SÁCH sau khi trả về: chữ ký ký lúc gói CẦN HAI người không mở được gói đã hạ về một chữ ký; người ấy ký lại trên ngân sách mới thì mở (lượt soi S1.9101)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await withTenant(apiPool, t.org, (c) =>
      setRfqBudget(c, t.org, { rfqId, estimatedValue: "500000000.00", currency: "VND", actorSessionId: t.pm.s }),
    );
    await moi(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    expect(((await thu(mo(t, rfqId))) as Error).message, "gói cấp kép: một chữ ký chưa đủ").toMatch(/can 2 /);

    await veSoan(t, rfqId, t.pm, "ha uoc luong");
    await withTenant(apiPool, t.org, (c) =>
      setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s }),
    );
    await nop(t, rfqId);
    const e = await thu(mo(t, rfqId));
    expect((e as Error).message, "chữ ký trên ngân sách 500 triệu không mở gói 1 triệu").toBe(
      "RFQ nay can 1 chu ky TREN NGAN SACH HIEN TAI, moi co 0 (K4b)",
    );
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
  });

  it("[INV-K4b] chiều ngược, cùng bậc: nâng ước lượng sau khi ký — vẫn một chữ ký, mà chữ ký cũ nằm trên con số khác ⇒ không mở; đặt lại đúng con số cũ ⇒ chữ ký cũ mở được", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId, t.pm2);
    await veSoan(t, rfqId, t.pm, "nang uoc luong");
    await withTenant(apiPool, t.org, (c) =>
      setRfqBudget(c, t.org, { rfqId, estimatedValue: "99000000.00", currency: "VND", actorSessionId: t.pm.s }),
    );
    await nop(t, rfqId);
    expect(((await thu(mo(t, rfqId))) as Error).message).toBe("RFQ nay can 1 chu ky TREN NGAN SACH HIEN TAI, moi co 0 (K4b)");
    // Ràng vào NGÂN SÁCH, không vào lần nộp: trả về lần nữa, đặt lại đúng con số cũ, nộp — chữ ký cũ nằm trên đúng ngân sách ấy.
    await veSoan(t, rfqId, t.pm, "tra lai con so cu");
    await withTenant(apiPool, t.org, (c) =>
      setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s }),
    );
    await nop(t, rfqId);
    await mo(t, rfqId);
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
    expect(await soChuKy(rfqId), "một chữ ký, không ai ký lại").toBe(1);
  });

  it("[INV-K4b] ĐỘT BIẾN: cạnh mở gói bỏ phép đếm trên ngân sách, hay băm ngân sách bỏ ước lượng ⇒ chữ ký trên con số cũ mở được gói", async () => {
    const kichBan = async (): Promise<string> => {
      const t = await toChucDaBat();
      const rfqId = await goiNhap(t);
      await moi(t, rfqId);
      await nop(t, rfqId);
      await duyet(t, rfqId, t.pm2);
      await veSoan(t, rfqId, t.pm, "nang uoc luong");
      await withTenant(apiPool, t.org, (c) =>
        setRfqBudget(c, t.org, { rfqId, estimatedValue: "99000000.00", currency: "VND", actorSessionId: t.pm.s }),
      );
      await nop(t, rfqId);
      await thu(mo(t, rfqId));
      return trangThaiGoi(rfqId);
    };
    expect(await kichBan(), "đối chứng: bản thật chặn").toBe("PENDING_APPROVAL");
    expect(
      await voiHamDotBien(
        "public.rfq_kiem_chu_ky_danh_sach_khi_mo()",
        "\n     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(NEW.id);",
        ";",
        kichBan,
      ),
      "cạnh mở gói không đếm trên ngân sách",
    ).toBe("OPEN");
    expect(
      await voiHamDotBien("public.rfq_bam_ngan_sach(uuid)", "coalesce(b.estimated_value::text, '')", "''", kichBan),
      "băm ngân sách bỏ ước lượng",
    ).toBe("OPEN");
  });

  it("ai được đi: người duyệt khác người tạo thì được (`rfq.approve`); BUYER không phải người tạo và FINANCE ⇒ `PERMISSION_DENIED` mang `rfq.approve`, gói đứng yên", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);

    for (const ai of [t.nm, t.tc]) {
      const e = await thu(veSoan(t, rfqId, ai));
      expect(e).toBeInstanceOf(PermissionDeniedError);
    }
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    const { rows } = await db.pool.query<{ actor_id: string; quyen: string }>(
      "SELECT actor_id, payload ->> 'permission' AS quyen FROM audit_events " +
        "WHERE org_id = $1 AND resource_id = $2 AND action = 'PERMISSION_DENIED' ORDER BY seq",
      [t.org, rfqId],
    );
    expect(rows).toEqual([
      { actor_id: t.nm.u, quyen: "rfq.approve" },
      { actor_id: t.tc.u, quyen: "rfq.approve" },
    ]);
    expect(await hangSo(t.org, rfqId, "RFQ_RETURNED_TO_DRAFT")).toEqual([]);

    await veSoan(t, rfqId, t.pm2);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
  });

  it("BUYER là người TẠO thì trả về được bằng `rfq.create` — không cần `rfq.approve`", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, t.nm);
    await nop(t, rfqId, t.nm);
    await veSoan(t, rfqId, t.nm);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
    expect(await hangSo(t.org, rfqId, "RFQ_RETURNED_TO_DRAFT")).toHaveLength(1);
  });

  it("người TẠO mà đã mất `rfq.create` (bị gỡ vai) ⇒ `PERMISSION_DENIED` mang `rfq.create`, gói đứng yên — người tạo đi qua cổng quyền của gói, không được miễn", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t, t.nm);
    await nop(t, rfqId, t.nm);
    await db.pool.query("DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2", [t.org, t.nm.u]);
    const e = await thu(veSoan(t, rfqId, t.nm));
    expect(e).toBeInstanceOf(PermissionDeniedError);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    expect((await hangSo(t.org, rfqId, "PERMISSION_DENIED")).map((h) => [h.actor, (h.payload as { permission: string }).permission])).toEqual([
      [t.nm.u, "rfq.create"],
    ]);
    expect(await hangSo(t.org, rfqId, "RFQ_RETURNED_TO_DRAFT")).toEqual([]);
  });

  it("tổ chức CHƯA bật: tầng gói từ chối trước mọi câu ghi — `RfqError`, KHÔNG hàng sổ nào, gói đứng yên; câu viết tay bị trigger chặn; ĐỘT BIẾN tắt trigger thì câu ấy đi lọt", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);

    const e = await thu(veSoan(t, rfqId, t.pm));
    expect(e).toBeInstanceOf(RfqError);
    expect((e as Error).message).toBe("Tổ chức chưa bật kiểm soát theo bậc: trả gói thầu về soạn thảo chưa mở (ADR-080).");
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
    const { rows: so } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND resource_id = $2 AND action IN ('RFQ_RETURNED_TO_DRAFT', 'PERMISSION_DENIED', 'CONTROL_DENIED')",
      [t.org, rfqId],
    );
    expect(so[0]?.n, "cấu hình chưa sẵn sàng không vào sổ (ADR-060, ADR-084 ⑸)").toBe(0);

    const tay = await thu(withTenant(apiPool, t.org, (c) => c.query(CAU_VE_SOAN, [rfqId])));
    expect((tay as { code?: string }).code).toBe("23514");
    expect((tay as Error).message).toBe(LOI_TRIGGER);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");

    // ĐỘT BIẾN: tắt trigger trong MỘT giao dịch rồi ROLLBACK — câu viết tay đưa gói MVP1 về DRAFT.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE public.rfq_packages DISABLE TRIGGER rfq_packages_kiem_canh_ve_soan");
      await c.query("SET LOCAL ROLE app_api");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [t.org]);
      const r = await c.query(CAU_VE_SOAN, [rfqId]);
      expect(r.rowCount, "đột biến: không trigger thì cạnh đi được ở tổ chức chưa bật").toBe(1);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
  });

  it("tổ chức ĐÃ bật: câu viết tay đi được — trigger chỉ chặn tổ chức chưa bật (đối chứng của phép đo trên)", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    await nop(t, rfqId);
    const r = await withTenant(apiPool, t.org, (c) => c.query(CAU_VE_SOAN, [rfqId]));
    expect(r.rowCount).toBe(1);
    expect(await trangThaiGoi(rfqId)).toBe("DRAFT");
  });

  it("sai trạng thái: gói DRAFT hay OPEN ⇒ `RfqError`, không hàng sổ nào; lý do rỗng ⇒ `RfqError` trước mọi câu ghi", async () => {
    const t = await toChucDaBat();
    const rfqId = await goiNhap(t);
    const draft = await thu(veSoan(t, rfqId, t.pm));
    expect(draft).toBeInstanceOf(RfqError);
    expect((draft as Error).message).toBe("không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ");

    await nop(t, rfqId);
    const rong = await thu(veSoan(t, rfqId, t.pm, "   "));
    expect(rong).toBeInstanceOf(RfqError);
    expect((rong as Error).message).toBe("reason không được rỗng");
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");

    await duyet(t, rfqId, t.pm2);
    await mo(t, rfqId);
    const open = await thu(veSoan(t, rfqId, t.pm));
    expect(open).toBeInstanceOf(RfqError);
    expect(await trangThaiGoi(rfqId)).toBe("OPEN");
    expect(await hangSo(t.org, rfqId, "RFQ_RETURNED_TO_DRAFT")).toEqual([]);
  });
});
