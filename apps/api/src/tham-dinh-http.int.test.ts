// ==============================================================================================
// [S1.293 / S3.7a2 / K8b · ADR-081 ⑵ ⑸] THẨM ĐỊNH ĐẦY ĐỦ QUA HTTP — ba route của bên mua trên một hồ sơ Passport nộp THẬT qua đường
// của `118` (yêu cầu → link → OTP → phiên → nộp). Yêu cầu hồ sơ TỰ SINH lúc đề xuất đo ở kịch bản 41 HTTP (bước 12h/12h2) — nơi có
// trọn luồng gói thầu tới đề xuất; ở đây chỉ ba route và cổng quyền của chúng. Khuôn `passport.int.test.ts`.
// ==============================================================================================
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { createProcurementPolicy } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_PASSPORT } from "./routes/passport.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const BAC = [
  {
    tu_so_tien: 0,
    so_ncc_toi_thieu: 1,
    ky_danh_sach_moi: false,
    xoay_vong_n: 0,
    award_vai_khac_nhau: false,
    award_so_chu_ky: 1,
    award_vai: ["DIRECTOR"],
    tham_dinh_truoc_trao: true,
    khai_xung_dot: false,
    dau_thau_chinh_thuc: false,
  },
];

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let goc = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi extends NguoiPhien {
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  readonly pm: Nguoi;
  /** FINANCE — khai phiên bản chính sách, gửi yêu cầu Passport. */
  readonly tc: Nguoi;
  /** FINANCE — ký chính sách, xác minh K8a, thẩm định K8b. */
  readonly tc2: Nguoi;
  readonly nhap: NguoiPhien;
}
interface Ncc {
  readonly ncc: string;
  readonly lh: string;
  readonly phone: string;
  readonly mst: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`tdh-${randomBytes(4).toString("hex")}`]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const ten = `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}`;
    const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id", [org, `${ten}@vidu.vn`, ten]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const token = randomBytes(32).toString("base64url");
    const s = await motId(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '20 minutes', now()) RETURNING id",
      [org, u, createHash("sha256").update(token, "utf8").digest()],
    );
    return { u, s, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const tc = await nguoi("FINANCE");
  const tc2 = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "1000000000.00", currency: "VND", actorSessionId: pm.s }),
  );
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
  return { org, pm, tc, tc2, nhap: await nguoiNhapNhaCungCap(db.pool, org) };
}

/** Nhà cung cấp dựng thô: người nhập TECHNICAL dựng, `tc2` xác minh (K8a). */
async function ncc(t: ToChuc): Promise<Ncc> {
  const mst = `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
  const id = await motId(
    "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, mst, t.nhap.u, t.nhap.s],
  );
  const phone = `09${String(randomInt(0, 1e8)).padStart(8, "0")}`;
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi lien he', $3, $4, $5, $6) RETURNING id",
    [t.org, id, `lh${randomBytes(6).toString("hex")}@vidu.vn`, phone, t.nhap.u, t.nhap.s],
  );
  await db.pool.query(
    "INSERT INTO supplier_verifications (org_id, supplier_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'VERIFIED', $3, $4)",
    [t.org, id, t.tc2.u, t.tc2.s],
  );
  return { ncc: id, lh, phone, mst };
}

interface PhanHoi {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly setCookie: string[];
}
async function goi(method: string, duong: string, cookie: string | null, than?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = cookie;
  if (than !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${goc}${duong}`, { method, headers, body: than === undefined ? undefined : JSON.stringify(than) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // thân không phải JSON — để `text` nói
  }
  return { status: res.status, body, text, setCookie: res.headers.getSetCookie() };
}

const hoSo = (n: Ncc, soTaiKhoan: string, taxCode = n.mst) => ({
  legalName: "Cong ty TNHH Van Vat Tu",
  taxCode,
  nguoiDaiDien: "Nguyen Van A",
  diaChi: "12 Nguyen Trai, Ha Noi",
  nganHang: "Ngan hang TMCP Thuong Mai",
  soTaiKhoan,
  chungNhan: ["ISO 9001:2015"],
  nhomHang: ["Van cong nghiep"],
});

/** Yêu cầu (FINANCE `tc`) → link → OTP → phiên; trả cookie Passport. */
async function moPhien(t: ToChuc, n: Ncc): Promise<string> {
  const truocLink = dv.passportDaGui.length;
  const yc = await goi("POST", `/suppliers/${n.ncc}/passport-requests`, t.tc.cookie, { contactId: n.lh });
  expect(yc.status, yc.text).toBe(201);
  const token = dv.passportDaGui.slice(truocLink).find((m) => m.supplierId === n.ncc)?.token;
  expect(token, "link Passport phải đi qua bộ gửi").toBeDefined();
  expect((await goi("POST", "/guest/passport/redeem", null, { orgId: t.org, token })).status).toBe(200);
  const truocOtp = dv.otpDaGui.length;
  expect((await goi("POST", "/guest/passport/otp", null, { orgId: t.org, token, channel: "SMS" })).status).toBe(200);
  const ma = dv.otpDaGui.slice(truocOtp).find((m) => m.destination === n.phone)?.code;
  expect(ma, "mã OTP phải đi tới số điện thoại của người liên hệ").toBeDefined();
  const xac = await goi("POST", "/guest/passport/otp/verify", null, { orgId: t.org, token, code: ma });
  expect(xac.status, xac.text).toBe(200);
  const dong = xac.setCookie.find((c) => c.startsWith(`${COOKIE_PHIEN_PASSPORT}=`));
  expect(dong, "verify phải đặt cookie Passport").toBeDefined();
  return dong!.split(";")[0]!;
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
  dv = dichVuTest();
  goc = await dungServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
}, 180000);

beforeEach(async () => {
  await db.pool.query("DELETE FROM caller_rate_limits");
});

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.293 / S3.7a2 / K8b] thẩm định qua HTTP", { timeout: 120000 }, () => {
  it("[INV-K8b] hồ sơ nộp thật ⇒ GET qualification nói chưa thẩm định; POST qualify phiên bản mới nhất ⇒ 201 hiệu lực; phiên bản 2 ⇒ thôi hiệu lực, thẩm định phiên bản 1 bị 422 có tên; thẩm định 2 ⇒ hiệu lực; thu hồi ⇒ REVOKED", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const cookie = await moPhien(t, n);
    expect((await goi("POST", "/passport/versions", cookie, hoSo(n, "111122223333"))).status).toBe(201);

    const chua = await goi("GET", `/suppliers/${n.ncc}/qualification`, t.tc2.cookie);
    expect(chua.status, chua.text).toBe(200);
    expect(chua.body.qualification).toMatchObject({ supplierId: n.ncc, loai: null, conHieuLuc: false, phienBanThuTu: null, phienBanMoiNhatThuTu: 1 });

    const td = await goi("POST", `/suppliers/${n.ncc}/qualify`, t.tc2.cookie, { phienBanThuTu: 1 });
    expect(td.status, td.text).toBe(201);
    expect(td.body.qualification).toMatchObject({ loai: "QUALIFIED", conHieuLuc: true, boi: t.tc2.u, phienBanThuTu: 1, phienBanMoiNhatThuTu: 1 });
    const { rows: so } = await db.pool.query<{ payload: { thuTu: string } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'SUPPLIER_QUALIFIED' AND resource_id = $2",
      [t.org, n.ncc],
    );
    expect(so.map((r) => r.payload.thuTu)).toEqual(["1"]);

    expect((await goi("POST", "/passport/versions", cookie, hoSo(n, "111122224444"))).status).toBe(201);
    expect((await goi("GET", `/suppliers/${n.ncc}/qualification`, t.tc2.cookie)).body.qualification).toMatchObject({ loai: "QUALIFIED", conHieuLuc: false, phienBanThuTu: 1, phienBanMoiNhatThuTu: 2 });
    const cu = await goi("POST", `/suppliers/${n.ncc}/qualify`, t.tc2.cookie, { phienBanThuTu: 1 });
    expect([cu.status, cu.text]).toEqual([422, expect.stringMatching(/phiên bản hồ sơ mới hơn/u)]);
    const lai = await goi("POST", `/suppliers/${n.ncc}/qualify`, t.tc2.cookie, { phienBanThuTu: 2 });
    expect(lai.status, lai.text).toBe(201);
    expect(lai.body.qualification).toMatchObject({ conHieuLuc: true, phienBanThuTu: 2 });

    const th = await goi("POST", `/suppliers/${n.ncc}/qualification/revoke`, t.tc2.cookie, { reason: "giay phep het han" });
    expect(th.status, th.text).toBe(200);
    expect(th.body.qualification).toMatchObject({ loai: "REVOKED", conHieuLuc: false, lyDo: "giay phep het han", phienBanThuTu: null });
    expect((await goi("POST", `/suppliers/${n.ncc}/qualification/revoke`, t.tc2.cookie, { reason: "" })).status).toBe(422);
  });

  it("[INV-D5] PM không giữ `supplier.qualify` ⇒ 403 ở cổng route và một hàng PERMISSION_DENIED; thứ tự lạ ⇒ 422; MST phiên bản lệch ⇒ 422 có tên, không hàng thẩm định", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const cookie = await moPhien(t, n);
    expect((await goi("POST", "/passport/versions", cookie, hoSo(n, "555566667777", "0399999999"))).status).toBe(201);
    const pm = await goi("POST", `/suppliers/${n.ncc}/qualify`, t.pm.cookie, { phienBanThuTu: 1 });
    expect(pm.status, pm.text).toBe(403);
    const { rows } = await db.pool.query("SELECT 1 FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2 AND resource_id = $3", [
      t.org, t.pm.u, n.ncc,
    ]);
    expect(rows).toHaveLength(1);
    expect((await goi("POST", `/suppliers/${n.ncc}/qualify`, t.tc2.cookie, { phienBanThuTu: 7 })).status).toBe(422);
    const lech = await goi("POST", `/suppliers/${n.ncc}/qualify`, t.tc2.cookie, { phienBanThuTu: 1 });
    expect([lech.status, lech.text]).toEqual([422, expect.stringMatching(/Mã số thuế/u)]);
    const { rows: hang } = await db.pool.query("SELECT 1 FROM supplier_qualifications WHERE supplier_id = $1", [n.ncc]);
    expect(hang).toHaveLength(0);
    expect((await goi("GET", `/suppliers/${n.ncc}/qualification`, t.pm.cookie)).status, "route đọc không cổng, như …/verification").toBe(200);
  });
});
