import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { createInvitation, docNgoaiLe, lapNgoaiLe, revokeInvitation, rutNgoaiLe } from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  createProcurementPolicy,
  createRfq,
  openRfq,
  returnRfqToDraft,
  setRfqBudget,
  submitRfqForApproval,
} from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

// =============================================================================================
// [S1.9101 / S3.3b · spec S3 §4.4 · K4a · khoản 255] NGOẠI LỆ CẠNH TRANH VÀ LẦN TỪ CHỐI K4a VÀO SỔ — PHÉP ĐO TRÊN POSTGRES 16
//
// Mỗi ca đọc CSDL: hàng trong `rfq_sourcing_exceptions`, hàng sổ, và câu trả lời của `rfq_bam_danh_sach` — hàm mà chữ ký duyệt
// gói ghim (K4b). Tổ chức đã bật S3 dựng theo khuôn `packages/rfq/src/tra-ve-nhap.int.test.ts`.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

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
const GIAI_TRINH = "Chi mot nha san xuat co chung nhan hop quy cho thep tam SS400 day 3mm trong khu vuc.";

let db: TestDatabase;
let apiPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  /** PROCUREMENT_MANAGER — tạo gói, mời, lập ngoại lệ, mở. */
  readonly pm: Nguoi;
  /** PROCUREMENT_MANAGER khác — người duyệt. */
  readonly pm2: Nguoi;
  /** FINANCE — ký phiên bản chính sách; KHÔNG giữ `rfq.invite`. */
  readonly tc: Nguoi;
}
interface NhaCungCap {
  readonly ncc: string;
  readonly lh: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(batS3: boolean): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `nl-${randomBytes(4).toString("hex")}`,
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
  const tc = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  if (batS3) {
    const v2 = (
      await withTenant(apiPool, org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
            "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
            "VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, true, now(), $3, $4) RETURNING id",
          [org, JSON.stringify(BAC), pm.u, pm.s],
        ),
      )
    ).rows[0]!.id;
    await withTenant(apiPool, org, (c) =>
      c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
        org,
        v2,
        tc.u,
        tc.s,
      ]),
    );
  }
  const { rows } = await withTenant(apiPool, org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [org]));
  expect(rows[0]?.b, "dàn cảnh: công tắc S3").toBe(batS3);
  return { org, pm, pm2, tc };
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

/** Gói DRAFT có ngân sách, một hạng mục và một lời mời. */
async function goiNhap(t: ToChuc): Promise<{ rfqId: string; n: NhaCungCap; invId: string }> {
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  const n = await nhaCungCap(t);
  const invId = await withTenant(apiPool, t.org, async (c) =>
    (await createInvitation(c, t.org, { rfqId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.pm.s }, apiPool)).id,
  );
  return { rfqId, n, invId };
}

const nop = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
const duyet = (t: ToChuc, rfqId: string): Promise<void> =>
  withTenant(apiPool, t.org, (c) => approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s }, apiPool));
const mo = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
const traVe = (t: ToChuc, rfqId: string): Promise<unknown> =>
  withTenant(apiPool, t.org, (c) => returnRfqToDraft(c, t.org, { rfqId, reason: "bo sung giai trinh", actorSessionId: t.pm.s }, apiPool));

const lap = (t: ToChuc, rfqId: string, ai: Nguoi = t.pm, tuyChon: { loai?: string; maLyDo?: string; giaiTrinh?: string } = {}) =>
  withTenant(apiPool, t.org, (c) =>
    lapNgoaiLe(
      c,
      t.org,
      {
        rfqId,
        loai: tuyChon.loai ?? "SINGLE_SOURCE",
        maLyDo: tuyChon.maLyDo ?? "PROPRIETARY_TECHNOLOGY",
        giaiTrinh: tuyChon.giaiTrinh ?? GIAI_TRINH,
        actorSessionId: ai.s,
      },
      apiPool,
    ),
  );
const rut = (t: ToChuc, rfqId: string, exceptionId: string, reason = "nha cung cap thu hai vua duoc tim thay") =>
  withTenant(apiPool, t.org, (c) => rutNgoaiLe(c, t.org, { rfqId, exceptionId, reason, actorSessionId: t.pm.s }, apiPool));

async function loiCua(p: Promise<unknown>): Promise<{ ten: string; thongDiep: string; ma?: string; code?: string; constraint?: string }> {
  try {
    await p;
  } catch (e) {
    const l = e as { name: string; message: string; lyDo?: string; code?: string; constraint?: string };
    return {
      ten: l.name,
      thongDiep: l.message,
      ...(l.lyDo === undefined ? {} : { ma: l.lyDo }),
      ...(l.code === undefined ? {} : { code: l.code }),
      ...(l.constraint === undefined ? {} : { constraint: l.constraint }),
    };
  }
  throw new Error("lời gọi phải ném");
}

async function soChot(org: string, resourceId: string): Promise<{ ma: string; loai: string }[]> {
  return (await db.pool.query<{ ma: string; loai: string }>(
    "SELECT payload->>'ma' AS ma, resource_type AS loai FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
    [org, resourceId],
  )).rows;
}

async function bam(t: ToChuc, rfqId: string): Promise<Buffer> {
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: Buffer }>("SELECT public.rfq_bam_danh_sach($1) AS b", [rfqId]));
  return rows[0]!.b;
}

/** Băm danh sách theo công thức của `076` — chỉ dòng `MOI|…`. Gói không ngoại lệ phải cho ĐÚNG giá trị này. */
async function bamChiLoiMoi(rfqId: string): Promise<Buffer> {
  const { rows } = await db.pool.query<{ dong: string }>(
    "SELECT 'MOI|' || supplier_id::text || '|' || contact_id::text || '|' || link_channel AS dong FROM rfq_invitations " +
      "WHERE rfq_id = $1 AND revoked_at IS NULL",
    [rfqId],
  );
  const dong = rows.map((r) => r.dong).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return createHash("sha256").update(dong.join("\n"), "utf8").digest();
}

async function trangThaiGoi(rfqId: string): Promise<string> {
  return (await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.status;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.9101 / S3.3b] ngoại lệ cạnh tranh — lập, rút, băm", () => {
  it("[INV-K4a] lập ở DRAFT ⇒ một hàng LAP của đúng người, sổ SOURCING_EXCEPTION_CREATED mang loại và mã; đọc lại thấy còn sống", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const nl = await lap(t, rfqId);
    expect(nl).toMatchObject({ rfqId, loai: "SINGLE_SOURCE", maLyDo: "PROPRIETARY_TECHNOLOGY", giaiTrinh: GIAI_TRINH, lapBoi: t.pm.u, rut: null });
    const hang = (await db.pool.query("SELECT hanh_dong, created_by FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [rfqId])).rows;
    expect(hang).toEqual([{ hanh_dong: "LAP", created_by: t.pm.u }]);
    const so = (await db.pool.query(
      "SELECT actor_id, payload FROM audit_events WHERE org_id = $1 AND action = 'SOURCING_EXCEPTION_CREATED' AND resource_id = $2",
      [t.org, rfqId],
    )).rows;
    expect(so).toEqual([{ actor_id: t.pm.u, payload: { exceptionId: nl.id, loai: "SINGLE_SOURCE", maLyDo: "PROPRIETARY_TECHNOLOGY" } }]);
  });

  it("[INV-K4a] băm danh sách: gói KHÔNG ngoại lệ giữ đúng băm của `076`; lập ngoại lệ đổi băm; rút thì băm về lại như trước", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const goc = await bam(t, rfqId);
    expect(goc.equals(await bamChiLoiMoi(rfqId)), "gói không ngoại lệ: băm như trước S3.3b").toBe(true);
    const nl = await lap(t, rfqId);
    const coNgoaiLe = await bam(t, rfqId);
    expect(coNgoaiLe.equals(goc)).toBe(false);
    await rut(t, rfqId, nl.id);
    expect((await bam(t, rfqId)).equals(goc), "ngoại lệ đã rút ra khỏi băm").toBe(true);
  });

  it("[INV-K4a] băm có ngoại lệ bằng ĐÚNG công thức: dòng `NGOAI_LE|id|loai|ma|sha256(giải trình)` cạnh dòng lời mời, xếp theo byte", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const song = await lap(t, rfqId, t.pm, { loai: "LIMITED_COMPETITION", maLyDo: "EMERGENCY", giaiTrinh: `${GIAI_TRINH} — gấp` });
    const daRut = await lap(t, rfqId);
    await rut(t, rfqId, daRut.id);
    const { rows } = await db.pool.query<{ dong: string }>(
      "SELECT 'MOI|' || supplier_id::text || '|' || contact_id::text || '|' || link_channel AS dong FROM rfq_invitations " +
        "WHERE rfq_id = $1 AND revoked_at IS NULL",
      [rfqId],
    );
    const hex = createHash("sha256").update(song.giaiTrinh, "utf8").digest("hex");
    const dong = [...rows.map((r) => r.dong), `NGOAI_LE|${song.id}|LIMITED_COMPETITION|EMERGENCY|${hex}`].sort((x, y) =>
      Buffer.compare(Buffer.from(x, "utf8"), Buffer.from(y, "utf8")),
    );
    const ky = createHash("sha256").update(dong.join("\n"), "utf8").digest();
    expect((await bam(t, rfqId)).equals(ky)).toBe(true);
  });

  it("[INV-K4a] người duyệt ký lên ngoại lệ: rút ngoại lệ sau khi trả gói về rồi nộp lại ⇒ chữ ký cũ không còn đếm, mở gói bị K4b chặn", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const nl = await lap(t, rfqId);
    await nop(t, rfqId);
    await duyet(t, rfqId);
    const daKy = (await db.pool.query<{ h: Buffer }>("SELECT approved_list_hash AS h FROM rfq_approvals WHERE rfq_id = $1", [rfqId])).rows[0]!.h;
    expect(daKy.equals(await bam(t, rfqId)), "chữ ký ghim băm CÓ ngoại lệ").toBe(true);
    await traVe(t, rfqId);
    await rut(t, rfqId, nl.id);
    await nop(t, rfqId);
    expect((await loiCua(mo(t, rfqId))).thongDiep).toMatch(/TREN DANH SACH MOI HIEN TAI.*\(K4b\)/u);
    expect(await trangThaiGoi(rfqId)).toBe("PENDING_APPROVAL");
  });

  it("[INV-K4a] rút: hàng RUT trỏ về đúng ngoại lệ, sổ SOURCING_EXCEPTION_WITHDRAWN mang lý do; rút lần hai ⇒ trùng, không hàng mới", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const nl = await lap(t, rfqId);
    const daRut = await rut(t, rfqId, nl.id, "  tim duoc nha cung cap thu hai  ");
    expect(daRut.rut).toMatchObject({ boi: t.pm.u, lyDo: "tim duoc nha cung cap thu hai" });
    const so = (await db.pool.query(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'SOURCING_EXCEPTION_WITHDRAWN' AND resource_id = $2",
      [t.org, rfqId],
    )).rows;
    expect(so).toEqual([{ payload: { exceptionId: nl.id, reason: "tim duoc nha cung cap thu hai" } }]);
    expect((await loiCua(rut(t, rfqId, nl.id))).code).toBe("23505");
    expect((await db.pool.query("SELECT 1 FROM rfq_sourcing_exceptions WHERE rfq_id = $1 AND hanh_dong = 'RUT'", [rfqId])).rowCount).toBe(1);
  });

  it("rút một ngoại lệ của GÓI KHÁC, hay trỏ vào một hàng RUT ⇒ trigger từ chối, không vào sổ", async () => {
    const t = await taoToChuc(true);
    const a = await goiNhap(t);
    const b = await goiNhap(t);
    const nlA = await lap(t, a.rfqId);
    expect((await loiCua(rut(t, b.rfqId, nlA.id))).thongDiep).toMatch(/cung goi thau/u);
    await rut(t, a.rfqId, nlA.id);
    const hangRut = (await db.pool.query<{ id: string }>("SELECT id FROM rfq_sourcing_exceptions WHERE ngoai_le_id = $1", [nlA.id])).rows[0]!.id;
    expect((await loiCua(rut(t, a.rfqId, hangRut))).thongDiep).toMatch(/cung goi thau/u);
    expect(await soChot(t.org, b.rfqId)).toEqual([]);
  });
});

describe("[S1.9101 / S3.3b / K4a · khoản 255] lần từ chối K4a vào sổ CONTROL_DENIED", () => {
  it("[INV-K4a] lập và rút ngoại lệ khi gói đã rời DRAFT ⇒ ChotKiemSoatError K4A_NGOAI_LE_SAI_TRANG_THAI, mỗi lần MỘT hàng sổ; không hàng ngoại lệ mới", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const nl = await lap(t, rfqId);
    await nop(t, rfqId);
    const l1 = await loiCua(lap(t, rfqId));
    expect(l1).toMatchObject({ ten: "ChotKiemSoatError", ma: "K4A_NGOAI_LE_SAI_TRANG_THAI" });
    const l2 = await loiCua(rut(t, rfqId, nl.id));
    expect(l2).toMatchObject({ ten: "ChotKiemSoatError", ma: "K4A_NGOAI_LE_SAI_TRANG_THAI" });
    expect(await soChot(t.org, rfqId)).toEqual([
      { ma: "K4A_NGOAI_LE_SAI_TRANG_THAI", loai: "RFQ" },
      { ma: "K4A_NGOAI_LE_SAI_TRANG_THAI", loai: "RFQ" },
    ]);
    expect((await db.pool.query("SELECT 1 FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [rfqId])).rowCount).toBe(1);
  });

  it("[INV-K4a] khoản 255: mời thêm ở PENDING_APPROVAL ⇒ K4A_THEM_SAI_TRANG_THAI và một hàng sổ trên gói; thu hồi ở PENDING_APPROVAL ⇒ K4A_THU_HOI_SAI_TRANG_THAI và một hàng sổ trên lời mời", async () => {
    const t = await taoToChuc(true);
    const { rfqId, invId } = await goiNhap(t);
    await nop(t, rfqId);
    const n2 = await nhaCungCap(t);
    const lMoi = await loiCua(
      withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n2.ncc, contactId: n2.lh, actorSessionId: t.pm.s }, apiPool)),
    );
    expect(lMoi).toMatchObject({ ten: "ChotKiemSoatError", ma: "K4A_THEM_SAI_TRANG_THAI" });
    expect(await soChot(t.org, rfqId)).toEqual([{ ma: "K4A_THEM_SAI_TRANG_THAI", loai: "RFQ" }]);
    const lThuHoi = await loiCua(
      withTenant(apiPool, t.org, (c) => revokeInvitation(c, t.org, { invitationId: invId, actorSessionId: t.pm.s }, apiPool)),
    );
    expect(lThuHoi).toMatchObject({ ten: "ChotKiemSoatError", ma: "K4A_THU_HOI_SAI_TRANG_THAI" });
    expect(await soChot(t.org, invId)).toEqual([{ ma: "K4A_THU_HOI_SAI_TRANG_THAI", loai: "RFQ_INVITATION" }]);
  });

  it("khoản 255, đối chứng: lời gọi dựng dữ liệu không truyền `auditPool` ⇒ lỗi gốc của trigger mang tên ràng buộc, sổ im", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    await nop(t, rfqId);
    const n2 = await nhaCungCap(t);
    const l = await loiCua(
      withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n2.ncc, contactId: n2.lh, actorSessionId: t.pm.s })),
    );
    expect(l).toMatchObject({ code: "23514", constraint: "k4a_them_sai_trang_thai" });
    expect(await soChot(t.org, rfqId)).toEqual([]);
  });

  it("gói đã mở: mời thêm vẫn đi (OPEN nhận lời mời), thu hồi bị K4a chặn và vào sổ", async () => {
    const t = await taoToChuc(true);
    const { rfqId, invId } = await goiNhap(t);
    await nop(t, rfqId);
    await duyet(t, rfqId);
    await mo(t, rfqId);
    const n2 = await nhaCungCap(t);
    await withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n2.ncc, contactId: n2.lh, actorSessionId: t.pm.s }, apiPool));
    const l = await loiCua(withTenant(apiPool, t.org, (c) => revokeInvitation(c, t.org, { invitationId: invId, actorSessionId: t.pm.s }, apiPool)));
    expect(l.ma).toBe("K4A_THU_HOI_SAI_TRANG_THAI");
    expect(await soChot(t.org, invId)).toHaveLength(1);
  });
});

describe("[S1.9101 / S3.3b] hình dạng, quyền, công tắc, chỉ ghi thêm", () => {
  it("[INV-K4a] mã OTHER đòi giải trình ≥ 100 BYTE sau khi cắt: 99 byte bị từ chối ở gói và ở CHECK; 100 byte qua — chữ có dấu đếm theo byte", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    // 33 chữ "ế" = 99 byte; thêm một chữ ASCII = 100 byte.
    const thieu = "ế".repeat(33);
    const du = `${thieu}a`;
    expect(Buffer.byteLength(thieu, "utf8")).toBe(99);
    expect((await loiCua(lap(t, rfqId, t.pm, { maLyDo: "OTHER", giaiTrinh: `  ${thieu}   ` }))).thongDiep).toMatch(/OTHER.*100 byte/u);
    const quaCheck = await loiCua(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_sourcing_exceptions (org_id, rfq_id, hanh_dong, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id) " +
            "VALUES ($1, $2, 'LAP', 'SINGLE_SOURCE', 'OTHER', $3, $4, $5)",
          [t.org, rfqId, thieu, t.pm.u, t.pm.s],
        ),
      ),
    );
    expect(quaCheck).toMatchObject({ code: "23514", constraint: "rfq_sourcing_exceptions_san_other" });
    expect((await lap(t, rfqId, t.pm, { maLyDo: "OTHER", giaiTrinh: du })).maLyDo).toBe("OTHER");
  });

  it("loại và mã ngoài tập ⇒ từ chối ở gói; `LOW_ACTUAL_COMPETITION` chèn thẳng ⇒ trigger từ chối (chưa có đường ghi ở danh sách mời)", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    expect((await loiCua(lap(t, rfqId, t.pm, { loai: "LOW_ACTUAL_COMPETITION" }))).ten).toBe("InvitationError");
    expect((await loiCua(lap(t, rfqId, t.pm, { maLyDo: "CHEAPEST" }))).ten).toBe("InvitationError");
    expect((await loiCua(lap(t, rfqId, t.pm, { giaiTrinh: "   " }))).ten).toBe("InvitationError");
    const thang = await loiCua(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_sourcing_exceptions (org_id, rfq_id, hanh_dong, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id) " +
            "VALUES ($1, $2, 'LAP', 'LOW_ACTUAL_COMPETITION', 'EMERGENCY', 'khan cap', $3, $4)",
          [t.org, rfqId, t.pm.u, t.pm.s],
        ),
      ),
    );
    expect(thang.thongDiep).toMatch(/khong lap o danh sach moi/u);
  });

  it("thiếu `rfq.invite` (FINANCE) ⇒ PermissionDeniedError; chèn thẳng dưới phiên FINANCE ⇒ trigger từ chối", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    expect((await loiCua(lap(t, rfqId, t.tc))).ten).toBe("PermissionDeniedError");
    const thang = await loiCua(
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_sourcing_exceptions (org_id, rfq_id, hanh_dong, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id) " +
            "VALUES ($1, $2, 'LAP', 'SINGLE_SOURCE', 'EMERGENCY', 'khan cap', $3, $4)",
          [t.org, rfqId, t.tc.u, t.tc.s],
        ),
      ),
    );
    expect(thang.thongDiep).toMatch(/phai giu rfq\.invite/u);
    expect((await db.pool.query("SELECT 1 FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [rfqId])).rowCount).toBe(0);
  });

  it("tổ chức CHƯA bật S3 ⇒ từ chối, không hàng sổ CONTROL_DENIED — cấu hình, không phải người đi tắt", async () => {
    const t = await taoToChuc(false);
    const { rfqId } = await goiNhap(t);
    expect((await loiCua(lap(t, rfqId))).thongDiep).toMatch(/da bat S3/u);
    expect(await soChot(t.org, rfqId)).toEqual([]);
  });

  it("chỉ ghi thêm: UPDATE và DELETE bị chặn cả với chủ CSDL; `app_api` không có quyền sửa", async () => {
    const t = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    const nl = await lap(t, rfqId);
    expect((await loiCua(db.pool.query("UPDATE rfq_sourcing_exceptions SET giai_trinh = 'khac' WHERE id = $1", [nl.id]))).thongDiep).toMatch(/chi duoc ghi them/u);
    expect((await loiCua(db.pool.query("DELETE FROM rfq_sourcing_exceptions WHERE id = $1", [nl.id]))).thongDiep).toMatch(/chi duoc ghi them/u);
    expect((await loiCua(withTenant(apiPool, t.org, (c) => c.query("UPDATE rfq_sourcing_exceptions SET giai_trinh = 'khac'")))).code).toBe("42501");
  });

  it("đọc: tổ chức khác không thấy ngoại lệ", async () => {
    const t = await taoToChuc(true);
    const u = await taoToChuc(true);
    const { rfqId } = await goiNhap(t);
    await lap(t, rfqId);
    expect(await withTenant(apiPool, u.org, (c) => docNgoaiLe(c, u.org, rfqId))).toEqual([]);
  });
});
