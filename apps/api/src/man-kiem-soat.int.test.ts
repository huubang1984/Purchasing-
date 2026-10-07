// =============================================================================================
// [S1.273 / S3.3e1] NĂM THAY ĐỔI API CỦA MÀN KIỂM SOÁT — đo trên Postgres 16, qua HTTP, dưới `app_api`
//
// Spec S3 §9 (S3.3e). Chủ dự án chốt 2026-10-06: cờ máy chủ trên `GET /rfqs/:id` đóng khoản 340; lời từ chối 422 của chốt mang
// mã; màn xác minh riêng cho FINANCE. Lượt soi trên hình dạng thêm: danh sách lời mời và ngoại lệ mang `lanNop` cùng ảnh chụp
// (CAO-1), lần xác minh ràng băm hồ sơ đã thấy (CAO-2), số NHÓM của K2 cạnh cờ từng lời mời (TRUNG-2), câu ngoại lệ dựng từ
// `rfq_packages` (TRUNG-3), route hồ sơ là `/supplier-verifications` (THẤP).
//
//   A1  `GET /rfqs/:id` → `{ rfq, coQuyenMoi }` — bit của CHÍNH người xem, `false` với phiên agent; đọc gói không sinh từ chối.
//   A2  `GET …/exceptions` → `{ exceptions, lanNop, trangThai }`, kể cả khi chưa có ngoại lệ nào.
//   A3  422 của `ChotKiemSoatError` → `{ error, ma }`; lỗi nghiệp vụ khác giữ `{ error }`.
//   A4  `GET …/invitations` → `{ invitations (demDuoc, xacMinhConHieuLuc), lanNop, trangThai, canhTranh }`.
//   A5  `GET /supplier-verifications` (không cho agent) và `POST …/verify` đòi `bamDaXem` khớp băm lúc ghi.
// =============================================================================================
import { createHash, generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import { createInvitation, lapNgoaiLe } from "@trustprocure/invitation";
import { addRfqItem, approveRfq, createProcurementPolicy, createRfq, setRfqBudget } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiServices } from "./route-types.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const GIAI_TRINH = "Chi mot hang phan phoi loai van nay tai Viet Nam, da hoi ba dai ly khac va khong ai nhan giao trong thang.";
const GIA = "10000000.00";

const boBocGia = {
  name: "gia-cho-test-man-kiem-soat",
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

/** Một bậc: hai nhóm nhà cung cấp, không ký danh sách, không xoay vòng — K5 chỉ đòi khi gói có ngoại lệ. */
const BAC = [
  {
    tu_so_tien: 0,
    so_ncc_toi_thieu: 2,
    ky_danh_sach_moi: false,
    xoay_vong_n: 0,
    award_vai_khac_nhau: false,
    award_so_chu_ky: 1,
    award_vai: ["DIRECTOR"],
    tham_dinh_truoc_trao: false,
    khai_xung_dot: false,
    dau_thau_chinh_thuc: false,
  },
];

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi extends NguoiPhien {
  readonly cookie: string;
  readonly ten: string;
}
interface ToChuc {
  readonly org: string;
  readonly pm: Nguoi;
  readonly pm2: Nguoi;
  readonly yeuCau: Nguoi;
  readonly tc: Nguoi;
  readonly tc2: Nguoi;
  readonly nhap: NguoiPhien;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function phien(org: string, u: string, kind: "USER" | "AGENT_READONLY"): Promise<{ s: string; cookie: string }> {
  const token = randomBytes(32).toString("base64url");
  const s = await motId(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, kind) " +
      "VALUES ($1, $2, $3, now() + interval '20 minutes', now(), $4) RETURNING id",
    [org, u, createHash("sha256").update(token, "utf8").digest(), kind],
  );
  return { s, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
}

async function taoToChuc(batS3 = true): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`mk-${randomBytes(4).toString("hex")}`]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const ten = `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}`;
    const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id", [
      org,
      `${ten}@vidu.vn`,
      ten,
    ]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    return { u, ten, ...(await phien(org, u, "USER")) };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const yeuCau = await nguoi("REQUESTER");
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
  return { org, pm, pm2, yeuCau, tc, tc2, nhap };
}

async function nhomCua(t: ToChuc): Promise<string> {
  return (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO procurement_categories (org_id, ma, ten, created_by, created_by_session_id) VALUES ($1, $2, 'Thep', $3, $4) RETURNING id",
        [t.org, `THEP${randomBytes(2).toString("hex").toUpperCase()}`, t.tc.u, t.tc.s],
      ),
    )
  ).rows[0]!.id;
}

const mstNgauNhien = (): string => `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
const dtNgauNhien = (): string => `09${String(randomInt(0, 1e8)).padStart(8, "0")}`;

interface Ncc {
  readonly ncc: string;
  readonly lh: string;
  readonly ten: string;
}

/** Một nhà cung cấp dựng thô dưới chủ cụm — mặc định ĐẾM ĐƯỢC cho K2 (người nhập TECHNICAL dựng, `tc2` xác minh). */
async function ncc(t: ToChuc, o: { readonly nhap?: NguoiPhien; readonly mst?: string; readonly xacMinh?: boolean } = {}): Promise<Ncc> {
  const nhap = o.nhap ?? t.nhap;
  const ten = `NCC ${randomBytes(3).toString("hex")}`;
  const id = await motId(
    "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [t.org, ten, o.mst ?? mstNgauNhien(), nhap.u, nhap.s],
  );
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
    [t.org, id, `lh${randomBytes(6).toString("hex")}@vidu.vn`, dtNgauNhien(), nhap.u, nhap.s],
  );
  if (o.xacMinh !== false) {
    await db.pool.query(
      "INSERT INTO supplier_verifications (org_id, supplier_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'VERIFIED', $3, $4)",
      [t.org, id, t.tc2.u, t.tc2.s],
    );
  }
  return { ncc: id, lh, ten };
}

async function goiNhap(t: ToChuc): Promise<string> {
  const categoryId = await nhomCua(t);
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua van", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s, categoryId })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: GIA, currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Van bi DN50", quantity: "10.0000", unit: "cai", actorSessionId: t.pm.s });
  });
  return rfqId;
}

async function moi(t: ToChuc, rfqId: string, n: Ncc): Promise<string> {
  return (
    await withTenant(apiPool, t.org, (c) => createInvitation(c, t.org, { rfqId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.pm.s }, auditPool))
  ).id;
}

interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
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
    // thân không phải JSON — để `text` nói
  }
  return { status: res.status, body, text };
}

async function demTuChoiQuyen(org: string, actor: string): Promise<number> {
  return Number(
    (
      await db.pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
        [org, actor],
      )
    ).rows[0]!.n,
  );
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

describe("[INV-D5] [S1.273 / S3.3e1 · khoản 340] A1 — `coQuyenMoi` trên GET /rfqs/:id", () => {
  it("người giữ quyền mời ⇒ true; người yêu cầu mua và tài chính ⇒ false; thân chỉ mang `rfq` và bit của chính người xem", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const cua = async (ai: Nguoi): Promise<PhanHoi> => {
      const r = await goi("GET", `/rfqs/${rfqId}`, ai.cookie);
      expect(r.status, r.text).toBe(200);
      expect(Object.keys(r.body).sort(), "thân không mang danh sách ai giữ quyền").toEqual(["coQuyenMoi", "rfq"]);
      return r;
    };
    expect((await cua(t.pm)).body.coQuyenMoi).toBe(true);
    expect((await cua(t.pm2)).body.coQuyenMoi).toBe(true);
    expect((await cua(t.yeuCau)).body.coQuyenMoi).toBe(false);
    expect((await cua(t.tc)).body.coQuyenMoi).toBe(false);
  });

  it("người yêu cầu mua đọc gói không để lại hàng PERMISSION_DENIED nào; đối chứng dương — đọc danh sách lời mời thì để lại một", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const truoc = await demTuChoiQuyen(t.org, t.yeuCau.u);
    for (let i = 0; i < 3; i += 1) expect((await goi("GET", `/rfqs/${rfqId}`, t.yeuCau.cookie)).status).toBe(200);
    expect(await demTuChoiQuyen(t.org, t.yeuCau.u), "đọc gói không sinh từ chối").toBe(truoc);
    expect((await goi("GET", `/rfqs/${rfqId}/invitations`, t.yeuCau.cookie)).status).toBe(403);
    expect((await goi("GET", `/rfqs/${rfqId}/exceptions`, t.yeuCau.cookie)).status).toBe(403);
    expect(await demTuChoiQuyen(t.org, t.yeuCau.u), "hai route đọc vẫn tự cổng và vào sổ").toBe(truoc + 2);
  });

  it("phiên agent của chính người giữ quyền mời ⇒ false — hai danh sách không cho agent, cờ true chỉ mời nó tiêu trần từ chối", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const a = await phien(t.org, t.pm.u, "AGENT_READONLY");
    const r = await goi("GET", `/rfqs/${rfqId}`, a.cookie);
    expect(r.status, r.text).toBe(200);
    expect(r.body.coQuyenMoi).toBe(false);
    expect((await goi("GET", `/rfqs/${rfqId}`, t.pm.cookie)).body.coQuyenMoi, "đối chứng: phiên người của cùng người").toBe(true);
  });
});

describe("[S1.273 / S3.3e1 · lượt soi CAO-1, TRUNG-3] A2 — ngoại lệ mang `lanNop` cùng ảnh chụp", () => {
  it("gói chưa có ngoại lệ ⇒ danh sách rỗng VẪN mang lanNop và trạng thái; lập, nộp, trả về, nộp lại ⇒ lanNop đi theo", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const doc = async (): Promise<Record<string, unknown>> => {
      const r = await goi("GET", `/rfqs/${rfqId}/exceptions`, t.pm.cookie);
      expect(r.status, r.text).toBe(200);
      return r.body;
    };
    expect(await doc()).toEqual({ exceptions: [], lanNop: 0, trangThai: "DRAFT" });
    await moi(t, rfqId, await ncc(t));
    await withTenant(apiPool, t.org, (c) =>
      lapNgoaiLe(c, t.org, { rfqId, loai: "SINGLE_SOURCE", maLyDo: "NO_ALTERNATIVE", giaiTrinh: GIAI_TRINH, actorSessionId: t.pm2.s }, auditPool),
    );
    expect((await goi("POST", `/rfqs/${rfqId}/submit`, t.pm.cookie)).status).toBe(200);
    const sau1 = await doc();
    expect([sau1.lanNop, sau1.trangThai, (sau1.exceptions as unknown[]).length]).toEqual([1, "PENDING_APPROVAL", 1]);
    expect((await goi("POST", `/rfqs/${rfqId}/return-to-draft`, t.pm.cookie, { reason: "them nha cung cap" })).status).toBe(200);
    expect((await doc()).trangThai).toBe("DRAFT");
    expect((await goi("POST", `/rfqs/${rfqId}/submit`, t.pm.cookie)).status).toBe(200);
    expect((await doc()).lanNop).toBe(2);
  });

  it("gói không đọc được ⇒ 404 ở cả hai danh sách, không 200 rỗng", async () => {
    const t = await taoToChuc();
    const khong = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect((await goi("GET", `/rfqs/${khong}/exceptions`, t.pm.cookie)).status).toBe(404);
    expect((await goi("GET", `/rfqs/${khong}/invitations`, t.pm.cookie)).status).toBe(404);
  });
});

describe("[S1.273 / S3.3e1] A3 — 422 của chốt mang mã", () => {
  it("[INV-K2] K2 ở lần nộp ⇒ 422 { error, ma: K2_THIEU_CANH_TRANH }, câu là câu của bảng", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t));
    const r = await goi("POST", `/rfqs/${rfqId}/submit`, t.pm.cookie);
    expect(r.status, r.text).toBe(422);
    expect(r.body).toEqual({ error: CHOT_VAO_SO.K2_THIEU_CANH_TRANH.thongDiep, ma: "K2_THIEU_CANH_TRANH" });
  });

  it("[INV-K5] K5 ở lần mở — người duyệt duy nhất là tác giả ngoại lệ ⇒ 422 { error, ma: K5_THIEU_CHU_KY_DOC_LAP }", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t));
    await withTenant(apiPool, t.org, (c) =>
      lapNgoaiLe(c, t.org, { rfqId, loai: "SINGLE_SOURCE", maLyDo: "NO_ALTERNATIVE", giaiTrinh: GIAI_TRINH, actorSessionId: t.pm2.s }, auditPool),
    );
    expect((await goi("POST", `/rfqs/${rfqId}/submit`, t.pm.cookie)).status).toBe(200);
    await withTenant(apiPool, t.org, (c) => approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s, lanNopDaXem: 1 }, auditPool));
    const r = await goi("POST", `/rfqs/${rfqId}/open`, t.pm.cookie);
    expect(r.status, r.text).toBe(422);
    expect(r.body).toEqual({ error: CHOT_VAO_SO.K5_THIEU_CHU_KY_DOC_LAP.thongDiep, ma: "K5_THIEU_CHU_KY_DOC_LAP" });
  });

  it("lỗi nghiệp vụ không phải chốt (thiếu trường) ⇒ thân chỉ `{ error }`, không `ma`", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const r = await goi("POST", `/rfqs/${rfqId}/return-to-draft`, t.pm.cookie, {});
    expect(r.status, r.text).toBe(422);
    expect(Object.keys(r.body)).toEqual(["error"]);
  });
});

describe("[INV-K2] [S1.273 / S3.3e1 · lượt soi TRUNG-2] A4 — danh sách lời mời: cờ từng dòng, số NHÓM, lần nộp", () => {
  it("đếm được, chưa xác minh, do người chọn dựng — cờ đúng từng dòng; số nhóm và ngưỡng của bậc ghim; lanNop và trạng thái", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const tot = await ncc(t);
    const chuaXm = await ncc(t, { xacMinh: false });
    const doPm = await ncc(t, { nhap: t.pm });
    for (const n of [tot, chuaXm, doPm]) await moi(t, rfqId, n);
    const r = await goi("GET", `/rfqs/${rfqId}/invitations`, t.pm.cookie);
    expect(r.status, r.text).toBe(200);
    expect([r.body.lanNop, r.body.trangThai, r.body.canhTranh]).toEqual([0, "DRAFT", { soNhomDemDuoc: 1, toiThieu: 2 }]);
    const ds = r.body.invitations as { supplierId: string; demDuoc: unknown; xacMinhConHieuLuc: unknown }[];
    expect(ds.map((m) => [m.supplierId, m.demDuoc, m.xacMinhConHieuLuc])).toEqual([
      [tot.ncc, true, true],
      [chuaXm.ncc, false, false],
      [doPm.ncc, false, true],
    ]);
  });

  it("hai nhà cung cấp chung MST gốc ⇒ hai dòng đếm được nhưng MỘT nhóm — màn đọc số nhóm, không cộng cờ", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const goc10 = mstNgauNhien();
    await moi(t, rfqId, await ncc(t, { mst: goc10 }));
    await moi(t, rfqId, await ncc(t, { mst: `${goc10}-001` }));
    const r = await goi("GET", `/rfqs/${rfqId}/invitations`, t.pm.cookie);
    expect((r.body.invitations as { demDuoc: unknown }[]).map((m) => m.demDuoc)).toEqual([true, true]);
    expect(r.body.canhTranh).toEqual({ soNhomDemDuoc: 1, toiThieu: 2 });
  });

  it("tổ chức chưa bật ⇒ cờ từng dòng null và canhTranh null; lanNop và trạng thái vẫn có", async () => {
    const t = await taoToChuc(false);
    const rfqId = await goiNhap(t);
    await moi(t, rfqId, await ncc(t, { xacMinh: false }));
    const r = await goi("GET", `/rfqs/${rfqId}/invitations`, t.pm.cookie);
    expect(r.status, r.text).toBe(200);
    expect([r.body.lanNop, r.body.trangThai, r.body.canhTranh]).toEqual([0, "DRAFT", null]);
    const m = (r.body.invitations as Record<string, unknown>[])[0]!;
    expect([m.demDuoc, m.xacMinhConHieuLuc]).toEqual([null, null]);
  });
});

describe("[INV-K8a] [S1.273 / S3.3e1 · lượt soi CAO-2] A5 — hồ sơ xác minh và lần xác minh ràng băm đã thấy", () => {
  async function hoSo(t: ToChuc, nccId: string, ai: Nguoi = t.tc2): Promise<Record<string, unknown>> {
    const r = await goi("GET", "/supplier-verifications", ai.cookie);
    expect(r.status, r.text).toBe(200);
    const h = (r.body.hoSo as Record<string, unknown>[]).find((x) => x.supplierId === nccId);
    expect(h, "hồ sơ có trong danh sách").toBeDefined();
    return h!;
  }

  it("người liên hệ lạ thêm vào hồ sơ đã xác minh ⇒ ~~xác minh thôi hiệu lực~~ [S1.9101 / khoản 344] 422 K8a, hồ sơ và xác minh giữ nguyên; dữ liệu có trước `9501` vẫn hiện cờ «hồ sơ đổi» và người thêm", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const truoc = await hoSo(t, n.ncc);
    expect([truoc.doiSauXacMinh, (truoc.xacMinh as { conHieuLuc: boolean }).conHieuLuc]).toEqual([false, true]);
    expect(truoc.bamHoSo).toMatch(/^[0-9a-f]{64}$/u);
    // PM2 — giữ quyền quản lý hồ sơ nhà cung cấp, không là người chọn của gói nào ở đây — thêm người liên hệ của chính mình.
    // [S1.9101 / khoản 344] Hồ sơ do người khác dựng ⇒ trigger `ncc_kiem_them_lien_he` chặn; trước vòng ấy lần thêm này 201 và làm xác
    // minh hết hiệu lực ở cả tổ chức.
    const r = await goi("POST", `/suppliers/${n.ncc}/contacts`, t.pm2.cookie, { fullName: "Lien he la", email: "la@vidu.vn", phone: "0912345678" });
    expect(r.status, r.text).toBe(422);
    expect(r.body.ma).toBe("K8A_LIEN_HE_HO_SO_NGUOI_KHAC");
    const giuNguyen = await hoSo(t, n.ncc);
    expect([giuNguyen.doiSauXacMinh, (giuNguyen.xacMinh as { conHieuLuc: boolean }).conHieuLuc, giuNguyen.bamHoSo]).toEqual([false, true, truoc.bamHoSo]);
    // Dữ liệu có trước `9501`: người liên hệ do người khác thêm vẫn có thể nằm trên hồ sơ thật — dựng bằng superuser với trigger tạm tắt.
    // Màn vẫn phải nói ra (ADR-150 ⑷).
    await db.pool.query("ALTER TABLE supplier_contacts DISABLE TRIGGER supplier_contacts_kiem_nguoi_them");
    try {
      await db.pool.query(
        "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'Lien he la', 'la@vidu.vn', '0912345678', $3, $4)",
        [t.org, n.ncc, t.pm2.u, t.pm2.s],
      );
    } finally {
      await db.pool.query("ALTER TABLE supplier_contacts ENABLE ALWAYS TRIGGER supplier_contacts_kiem_nguoi_them");
    }
    const sau = await hoSo(t, n.ncc);
    expect([sau.doiSauXacMinh, (sau.xacMinh as { conHieuLuc: boolean }).conHieuLuc]).toEqual([true, false]);
    expect(sau.bamHoSo).not.toBe(truoc.bamHoSo);
    const la = (sau.contacts as { email: string; themBoiTen: string | null }[]).find((c) => c.email === "la@vidu.vn");
    expect(la?.themBoiTen, "màn thấy AI thêm người liên hệ").toBe(t.pm2.ten);
  });

  it("băm cũ ⇒ 422 có tên và KHÔNG hàng xác minh nào ở lại; băm vừa đọc ⇒ 201, còn hiệu lực", async () => {
    const t = await taoToChuc();
    // [S1.9101 / khoản 344] PM2 dựng hồ sơ — chỉ người dựng thêm được người liên hệ, và lần thêm sau lúc đọc là thứ làm băm cũ.
    const n = await ncc(t, { xacMinh: false, nhap: t.pm2 });
    const cu = (await hoSo(t, n.ncc)).bamHoSo as string;
    expect((await goi("POST", `/suppliers/${n.ncc}/contacts`, t.pm2.cookie, { fullName: "Them sau", email: "sau@vidu.vn", phone: "0911111111" })).status).toBe(201);
    const dem = async (): Promise<number> =>
      Number((await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM supplier_verifications WHERE supplier_id = $1", [n.ncc])).rows[0]!.n);
    const r = await goi("POST", `/suppliers/${n.ncc}/verify`, t.tc2.cookie, { bamDaXem: cu });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error).toMatch(/^Hồ sơ nhà cung cấp đã đổi từ lúc bạn xem/u);
    expect(await dem(), "lần xác minh lệch băm rollback").toBe(0);
    const moiDoc = (await hoSo(t, n.ncc)).bamHoSo as string;
    const ok = await goi("POST", `/suppliers/${n.ncc}/verify`, t.tc2.cookie, { bamDaXem: moiDoc });
    expect(ok.status, ok.text).toBe(201);
    expect((ok.body.verification as { conHieuLuc: boolean }).conHieuLuc).toBe(true);
    expect(await dem()).toBe(1);
  });

  it("thiếu băm ⇒ 422 «thiếu trường», không chạm CSDL; băm sai hình dạng ⇒ 422 của gói", async () => {
    const t = await taoToChuc();
    const n = await ncc(t, { xacMinh: false });
    const thieu = await goi("POST", `/suppliers/${n.ncc}/verify`, t.tc2.cookie, {});
    expect(thieu.status, thieu.text).toBe(422);
    expect(thieu.body.error).toBe('thiếu trường "bamDaXem"');
    const sai = await goi("POST", `/suppliers/${n.ncc}/verify`, t.tc2.cookie, { bamDaXem: "khong-phai-hex" });
    expect(sai.status, sai.text).toBe(422);
    expect(sai.body.error).toMatch(/^Thiếu băm hồ sơ đã xem/u);
  });

  it("route hồ sơ không cho agent; người dùng bên mua nào cũng đọc được (như hai route đọc mà nó gộp)", async () => {
    const t = await taoToChuc();
    await ncc(t);
    const a = await phien(t.org, t.tc2.u, "AGENT_READONLY");
    expect((await goi("GET", "/supplier-verifications", a.cookie)).status).toBe(403);
    expect((await goi("GET", "/supplier-verifications", t.yeuCau.cookie)).status).toBe(200);
  });
});
