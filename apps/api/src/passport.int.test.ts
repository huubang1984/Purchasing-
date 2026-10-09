// =============================================================================================
// [S1.287 / S3.7a1 / ADR-081] ĐƯỜNG PASSPORT — đo trên Postgres 16, qua HTTP và ở tầng CSDL, dưới `app_api`
//
// Spec S3 §4.8, §5 K11, §8.6; ADR-081 ⑴ ⑶ ⑷; ADR-159. Chủ dự án chốt (2026-10-08): link Passport chỉ tới nhà cung cấp ĐÃ XÁC MINH
// (K8a); số tài khoản là ranh giới cột ở tầng mã (phép đo tĩnh ở `tests/architecture/so-tai-khoan-liet-ke.test.ts`).
//
//   A  luồng trọn qua HTTP: yêu cầu (FINANCE) → link → OTP khác kênh → phiên → nộp phiên bản → nhà cung cấp thấy bốn số cuối, bên mua
//      thấy số đầy đủ sau `supplier.qualify` và để một hàng sổ; sổ không mang số tài khoản.
//   B  lời từ chối của yêu cầu — mỗi vế của hàm vị từ, cổng quyền, trần; trigger là lớp cuối khi tầng gói bị vượt.
//   C  yêu cầu mới thu hồi link và phiên cũ; gửi hỏng thì thu hồi link vừa đúc.
//   D  cô lập: phiên Passport chỉ thấy phiên bản của CHÍNH nhà cung cấp mình và 0 hàng ở mọi bảng khác; phiên khách lời mời thấy 0
//      phiên bản; cookie không lẫn đối tượng.
//   E  từng trigger ở tầng CSDL: token ràng vào yêu cầu, một token sống, OTP khác lớp đích, phiên dẫn xuất từ thách thức đã đối chiếu
//      và token chưa thu hồi, phiên bản dưới phiên sống của đúng nhà cung cấp, trần năm phiên bản.
// =============================================================================================
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { createProcurementPolicy } from "@trustprocure/rfq";
import { nopPhienBanPassport, taoYeuCauPassport, type HoSoPassport } from "@trustprocure/supplier";
import { ducTokenPassport } from "@trustprocure/invitation";
import { withPassportSession, withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_KHACH } from "./routes/anon.js";
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
  readonly tc: Nguoi;
  readonly tc2: Nguoi;
  readonly nhap: NguoiPhien;
}
interface Ncc {
  readonly ncc: string;
  readonly lh: string;
  readonly email: string;
  readonly phone: string | null;
  readonly mst: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(batS3 = true): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`pp-${randomBytes(4).toString("hex")}`]);
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
  return { org, pm, tc, tc2, nhap: await nguoiNhapNhaCungCap(db.pool, org) };
}

const mstNgauNhien = (): string => `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
const dtNgauNhien = (): string => `09${String(randomInt(0, 1e8)).padStart(8, "0")}`;

/** Nhà cung cấp dựng thô: người nhập TECHNICAL dựng, `tc2` xác minh (K8a) — trừ khi `xacMinh: false`. */
async function ncc(t: ToChuc, o: { readonly xacMinh?: boolean; readonly coDienThoai?: boolean } = {}): Promise<Ncc> {
  const mst = mstNgauNhien();
  const id = await motId(
    "INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, mst, t.nhap.u, t.nhap.s],
  );
  const email = `lh${randomBytes(6).toString("hex")}@vidu.vn`;
  const phone = o.coDienThoai === false ? null : dtNgauNhien();
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi lien he', $3, $4, $5, $6) RETURNING id",
    [t.org, id, email, phone, t.nhap.u, t.nhap.s],
  );
  if (o.xacMinh !== false) {
    await db.pool.query(
      "INSERT INTO supplier_verifications (org_id, supplier_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'VERIFIED', $3, $4)",
      [t.org, id, t.tc2.u, t.tc2.s],
    );
  }
  return { ncc: id, lh, email, phone, mst };
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

const hoSo = (n: Ncc, soTaiKhoan: string): HoSoPassport => ({
  legalName: "Cong ty TNHH Van Vat Tu",
  taxCode: n.mst,
  nguoiDaiDien: "Nguyen Van A",
  diaChi: "12 Nguyen Trai, Ha Noi",
  nganHang: "Ngan hang TMCP Thuong Mai",
  soTaiKhoan,
  chungNhan: ["ISO 9001:2015"],
  nhomHang: ["Van cong nghiep"],
});

/** Gửi yêu cầu qua HTTP (FINANCE `tc`) rồi trả token Passport mà bộ gửi của test nhận. */
async function yeuCau(t: ToChuc, n: Ncc): Promise<{ phanHoi: PhanHoi; token: string | null }> {
  const truoc = dv.passportDaGui.length;
  const phanHoi = await goi("POST", `/suppliers/${n.ncc}/passport-requests`, t.tc.cookie, { contactId: n.lh });
  const moi = dv.passportDaGui.slice(truoc).filter((m) => m.supplierId === n.ncc);
  return { phanHoi, token: moi.at(-1)?.token ?? null };
}

/** Đi trọn link → OTP → phiên; trả cookie Passport. */
async function moPhien(t: ToChuc, n: Ncc, token: string): Promise<string> {
  const doi = await goi("POST", "/guest/passport/redeem", null, { orgId: t.org, token });
  expect(doi.status, doi.text).toBe(200);
  const truoc = dv.otpDaGui.length;
  const otp = await goi("POST", "/guest/passport/otp", null, { orgId: t.org, token, channel: "SMS" });
  expect(otp.status, otp.text).toBe(200);
  const ma = dv.otpDaGui.slice(truoc).find((m) => m.destination === n.phone)?.code;
  expect(ma, "mã OTP phải đi tới số điện thoại của người liên hệ").toBeDefined();
  const xac = await goi("POST", "/guest/passport/otp/verify", null, { orgId: t.org, token, code: ma });
  expect(xac.status, xac.text).toBe(200);
  const dong = xac.setCookie.find((c) => c.startsWith(`${COOKIE_PHIEN_PASSPORT}=`));
  expect(dong, "verify phải đặt cookie Passport").toBeDefined();
  expect(dong).toMatch(/; HttpOnly; Secure; SameSite=Strict$/u);
  return dong!.split(";")[0]!;
}

async function sessionIdCua(cookie: string): Promise<string> {
  const token = cookie.split("=")[1]!.split(".")[1]!;
  return (
    await db.pool.query<{ id: string }>("SELECT id FROM passport_sessions WHERE token_hash = $1", [createHash("sha256").update(token, "utf8").digest()])
  ).rows[0]!.id;
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
  // Trần người gọi của ba route vô danh là theo địa chỉ — mọi lời gọi của tệp này đến từ 127.0.0.1.
  await db.pool.query("DELETE FROM caller_rate_limits");
  dv.hong.passportLink = false;
});

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.287 / S3.7a1] A — luồng Passport trọn qua HTTP", () => {
  it("[INV-E2] [INV-E5] yêu cầu → link qua email → OTP qua SMS → phiên → nộp; nhà cung cấp thấy bốn số cuối, bên mua thấy số đầy đủ và để một hàng sổ", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const { phanHoi, token } = await yeuCau(t, n);
    expect(phanHoi.status, phanHoi.text).toBe(201);
    expect((phanHoi.body.yeuCau as { daGui: boolean }).daGui).toBe(true);
    expect(token).not.toBeNull();
    // Link đi EMAIL của người liên hệ — đích ĐỌC từ hồ sơ, không do người gọi khai.
    const tin = dv.passportDaGui.filter((m) => m.supplierId === n.ncc).at(-1)!;
    expect([tin.channel, tin.destination]).toEqual(["EMAIL", n.email]);
    // [INV-E2] Token một mình KHÔNG vào được phiên: redeem trả kênh, không trả cookie.
    const doi = await goi("POST", "/guest/passport/redeem", null, { orgId: t.org, token });
    expect(doi.status, doi.text).toBe(200);
    expect(doi.body).toEqual({ linkChannel: "EMAIL", otpChannels: ["SMS", "ZALO_ZNS"] });
    expect(doi.setCookie).toEqual([]);
    const cookie = await moPhien(t, n, token!);

    const rong = await goi("GET", "/passport", cookie);
    expect(rong.status, rong.text).toBe(200);
    expect(rong.body.phienBanMoiNhat).toBeNull();
    expect((rong.body.nhaCungCap as { taxCode: string }).taxCode).toBe(n.mst);

    const SO = "190312345678";
    const nop = await goi("POST", "/passport/versions", cookie, hoSo(n, `1903 1234 5678`));
    expect(nop.status, nop.text).toBe(201);
    expect((nop.body.phienBan as { thuTu: number }).thuTu).toBe(1);

    const cuaToi = await goi("GET", "/passport", cookie);
    expect((cuaToi.body.phienBanMoiNhat as { soTaiKhoanCuoi: string }).soTaiKhoanCuoi).toBe("5678");
    expect(cuaToi.text.includes(SO), "phiên Passport không đọc ngược được số đầy đủ").toBe(false);

    // Bên mua: số đầy đủ, MST khớp bản ghi, một hàng `PASSPORT_VIEWED` không mang giá trị.
    const benMua = await goi("GET", `/suppliers/${n.ncc}/passport`, t.tc.cookie);
    expect(benMua.status, benMua.text).toBe(200);
    const p = benMua.body.passport as { phienBanMoiNhat: { soTaiKhoan: string; mstKhop: boolean }; cacPhienBan: { doiTaiKhoan: boolean }[] };
    expect([p.phienBanMoiNhat.soTaiKhoan, p.phienBanMoiNhat.mstKhop, p.cacPhienBan.length]).toEqual([SO, true, 1]);

    // Phiên bản hai đổi tài khoản ⇒ cờ ở lịch sử.
    expect((await goi("POST", "/passport/versions", cookie, hoSo(n, "777788889999"))).status).toBe(201);
    const lan2 = (await goi("GET", `/suppliers/${n.ncc}/passport`, t.tc.cookie)).body.passport as { cacPhienBan: { thuTu: number; doiTaiKhoan: boolean }[] };
    expect(lan2.cacPhienBan.map((r) => [r.thuTu, r.doiTaiKhoan])).toEqual([[2, true], [1, false]]);

    // [INV-E5] Sổ kể đúng chuyện: actor của phiên và của lần nộp là NGƯỜI LIÊN HỆ đã giữ kênh; không payload nào mang số tài khoản.
    const { rows: so } = await db.pool.query<{ action: string; actor_type: string; actor_id: string; payload: string }>(
      "SELECT action, actor_type, actor_id, payload::text AS payload FROM audit_events WHERE org_id = $1 AND action LIKE 'PASSPORT_%' ORDER BY seq",
      [t.org],
    );
    expect(so.map((r) => r.action)).toEqual([
      "PASSPORT_REQUESTED",
      "PASSPORT_TOKEN_ISSUED",
      "PASSPORT_OTP_ISSUED",
      "PASSPORT_SESSION_STARTED",
      "PASSPORT_VERSION_SUBMITTED",
      "PASSPORT_VIEWED",
      "PASSPORT_VERSION_SUBMITTED",
      "PASSPORT_VIEWED",
    ]);
    for (const r of so.filter((x) => ["PASSPORT_OTP_ISSUED", "PASSPORT_SESSION_STARTED", "PASSPORT_VERSION_SUBMITTED"].includes(x.action))) {
      expect([r.actor_type, r.actor_id]).toEqual(["SUPPLIER", n.lh]);
    }
    expect(so.filter((r) => r.payload.includes(SO) || r.payload.includes("777788889999"))).toEqual([]);
  });

  it("[INV-D5] bên mua không giữ `supplier.qualify` đọc hồ sơ ⇒ 403 và một hàng PERMISSION_DENIED; route không cho agent", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const r = await goi("GET", `/suppliers/${n.ncc}/passport`, t.pm.cookie);
    expect(r.status, r.text).toBe(403);
    const { rows } = await db.pool.query("SELECT 1 FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'", [t.org, t.pm.u]);
    expect(rows).toHaveLength(1);
  });
});

describe("[S1.287 / S3.7a1] B — lời từ chối của yêu cầu hồ sơ", () => {
  it("mỗi vế của `passport_chot_yeu_cau` ra một mã có tên, 422, không token nào được đúc", async () => {
    const t = await taoToChuc();
    const chuaXacMinh = await ncc(t, { xacMinh: false });
    const thieuSo = await ncc(t, { coDienThoai: false });
    const khac = await ncc(t);
    const cua = async (n: Ncc, lh: string): Promise<PhanHoi> => goi("POST", `/suppliers/${n.ncc}/passport-requests`, t.tc.cookie, { contactId: lh });
    const kq = [
      await cua(chuaXacMinh, chuaXacMinh.lh),
      await cua(thieuSo, thieuSo.lh),
      await cua(khac, chuaXacMinh.lh),
    ].map((r) => [r.status, r.body.ma]);
    expect(kq).toEqual([
      [422, "PASSPORT_NCC_CHUA_XAC_MINH"],
      [422, "PASSPORT_LIEN_HE_THIEU_KENH_OTP"],
      [422, "PASSPORT_LIEN_HE_KHONG_HOP_LE"],
    ]);
    const chuaBat = await taoToChuc(false);
    const n0 = await ncc(chuaBat, { xacMinh: false });
    const r0 = await goi("POST", `/suppliers/${n0.ncc}/passport-requests`, chuaBat.tc.cookie, { contactId: n0.lh });
    expect([r0.status, r0.body.ma]).toEqual([422, "PASSPORT_TO_CHUC_CHUA_BAT"]);
    const { rows } = await db.pool.query("SELECT 1 FROM supplier_passport_tokens WHERE org_id = ANY($1::uuid[])", [[t.org, chuaBat.org]]);
    expect(rows).toEqual([]);
  });

  it("[INV-D5] người không giữ `supplier.qualify` ⇒ 403 ở cổng route; trần ba yêu cầu một giờ ⇒ 429 có `Retry-After`", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    expect((await goi("POST", `/suppliers/${n.ncc}/passport-requests`, t.pm.cookie, { contactId: n.lh })).status).toBe(403);
    for (let i = 0; i < 3; i += 1) expect((await yeuCau(t, n)).phanHoi.status).toBe(201);
    const quaTran = await goi("POST", `/suppliers/${n.ncc}/passport-requests`, t.tc.cookie, { contactId: n.lh });
    expect([quaTran.status, quaTran.body.ma]).toEqual([429, "PASSPORT_QUA_TRAN_YEU_CAU"]);
  });

  it("tầng gói bị vượt (câu ghi thô dưới `app_api`) ⇒ trigger từ chối có tên — nhà cung cấp chưa xác minh không nhận yêu cầu", async () => {
    const t = await taoToChuc();
    const n = await ncc(t, { xacMinh: false });
    const loi = await withTenant(apiPool, t.org, (c) =>
      c.query(
        "INSERT INTO supplier_passport_requests (org_id, supplier_id, contact_id, ly_do, requested_by, requested_by_session_id) VALUES ($1, $2, $3, 'MANUAL', $4, $5)",
        [t.org, n.ncc, n.lh, t.tc.u, t.tc.s],
      ),
    ).then(
      () => null,
      (e: unknown) => e as { constraint?: string },
    );
    expect(loi?.constraint).toBe("passport_ncc_chua_xac_minh");
    // Đối chứng: cùng câu cho nhà cung cấp ĐÃ xác minh thì qua.
    const ok = await ncc(t);
    await withTenant(apiPool, t.org, (c) =>
      c.query(
        "INSERT INTO supplier_passport_requests (org_id, supplier_id, contact_id, ly_do, requested_by, requested_by_session_id) VALUES ($1, $2, $3, 'MANUAL', $4, $5)",
        [t.org, ok.ncc, ok.lh, t.tc.u, t.tc.s],
      ),
    );
  });
});

describe("[S1.287 / S3.7a1] C — link mới thu hồi link và phiên cũ; gửi hỏng thì thu hồi link vừa đúc", () => {
  it("[INV-E1] yêu cầu mới ⇒ cookie phiên cũ thành 401, link cũ chưa dùng thành 422; sổ đếm đúng số đã thu hồi", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const lan1 = await yeuCau(t, n);
    const cookie = await moPhien(t, n, lan1.token!);
    const lan2 = await yeuCau(t, n);
    expect((lan2.phanHoi.body.yeuCau as { soPhienThuHoi: number }).soPhienThuHoi).toBe(1);
    expect((await goi("GET", "/passport", cookie)).status).toBe(401);
    // Link thứ hai chưa dùng; link thứ ba thu hồi nó.
    const lan3 = await yeuCau(t, n);
    expect((lan3.phanHoi.body.yeuCau as { soLinkThuHoi: number }).soLinkThuHoi).toBe(1);
    expect((await goi("POST", "/guest/passport/redeem", null, { orgId: t.org, token: lan2.token })).status).toBe(422);
    expect((await goi("POST", "/guest/passport/redeem", null, { orgId: t.org, token: lan3.token })).status).toBe(200);
  });

  it("bộ gửi hỏng ⇒ 201 *chưa gửi*, token vừa đúc bị thu hồi, sổ có PASSPORT_TOKEN_REVOKED", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    dv.hong.passportLink = true;
    const r = await goi("POST", `/suppliers/${n.ncc}/passport-requests`, t.tc.cookie, { contactId: n.lh });
    expect(r.status, r.text).toBe(201);
    expect((r.body.yeuCau as { daGui: boolean }).daGui).toBe(false);
    const { rows } = await db.pool.query<{ thu_hoi: boolean }>("SELECT revoked_at IS NOT NULL AS thu_hoi FROM supplier_passport_tokens WHERE supplier_id = $1", [n.ncc]);
    expect(rows).toEqual([{ thu_hoi: true }]);
    const so = await db.pool.query("SELECT payload->>'reason' AS ly_do FROM audit_events WHERE org_id = $1 AND action = 'PASSPORT_TOKEN_REVOKED'", [t.org]);
    expect(so.rows).toEqual([{ ly_do: "LINK_SEND_FAILED" }]);
  });
});

describe("[S1.287 / S3.7a1 / ADR-081 ⑶] D — cô lập phiên Passport", () => {
  it("[INV-A5] phiên Passport của A thấy phiên bản của A và 0 hàng ở MỌI bảng RLS khác; đối chứng: kết nối người mua thấy cả hai nhà cung cấp", async () => {
    const t = await taoToChuc();
    const a = await ncc(t);
    const b = await ncc(t);
    const cookieA = await moPhien(t, a, (await yeuCau(t, a)).token!);
    const cookieB = await moPhien(t, b, (await yeuCau(t, b)).token!);
    expect((await goi("POST", "/passport/versions", cookieA, hoSo(a, "111122223333"))).status).toBe(201);
    expect((await goi("POST", "/passport/versions", cookieB, hoSo(b, "444455556666"))).status).toBe(201);
    // Qua HTTP: A đọc lại hồ sơ của A dù B nộp SAU — đường đọc của bộ điều phối chạy dưới `withPassportSession`, không dưới kết nối
    // chỉ gắn tổ chức (ở đó «phiên bản mới nhất» là của B).
    const cuaA = (await goi("GET", "/passport", cookieA)).body as { phienBanMoiNhat: { soTaiKhoanCuoi: string }; soPhienBan: number };
    expect([cuaA.phienBanMoiNhat.soTaiKhoanCuoi, cuaA.soPhienBan]).toEqual(["3333", 1]);
    const phienA = await sessionIdCua(cookieA);

    const { rows: bang } = await db.pool.query<{ ten: string }>(
      "SELECT c.relname AS ten FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND has_table_privilege('app_api', c.oid, 'SELECT') ORDER BY 1",
    );
    expect(bang.length, "bộ quét phải thấy các bảng RLS").toBeGreaterThan(40);
    const dem = async (moi: (fn: (c: pg.PoolClient) => Promise<Record<string, number>>) => Promise<Record<string, number>>): Promise<Record<string, number>> =>
      moi(async (c) => {
        const ra: Record<string, number> = {};
        for (const { ten } of bang) ra[ten] = Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM public.${ten}`)).rows[0]!.n);
        return ra;
      });
    const duoiPassport = await dem((fn) => withPassportSession(apiPool, t.org, phienA, fn));
    const khacKhong = Object.entries(duoiPassport).filter(([ten, n]) => n !== 0 && ten !== "supplier_passport_versions");
    expect(khacKhong, "phiên Passport đọc được bảng ngoài hồ sơ của mình").toEqual([]);
    expect(duoiPassport.supplier_passport_versions).toBe(1);
    const nccThay = await withPassportSession(apiPool, t.org, phienA, async (c) =>
      (await c.query<{ s: string }>("SELECT DISTINCT supplier_id AS s FROM public.supplier_passport_versions")).rows.map((r) => r.s),
    );
    expect(nccThay).toEqual([a.ncc]);
    // Đối chứng dương: kết nối người mua (chỉ gắn tổ chức) thấy cả hai phiên bản và các bảng khác có hàng.
    const duoiNguoiMua = await dem((fn) => withTenant(apiPool, t.org, fn));
    expect(duoiNguoiMua.supplier_passport_versions).toBe(2);
    expect(duoiNguoiMua.suppliers).toBeGreaterThanOrEqual(2);
    expect(duoiNguoiMua.passport_sessions).toBeGreaterThanOrEqual(2);
  });

  it("[INV-A5] phiên khách của LỜI MỜI (GUC khách đặt, GUC Passport rỗng) thấy 0 phiên bản Passport; GUC Passport của nhà cung cấp khác không mở gì", async () => {
    const t = await taoToChuc();
    const a = await ncc(t);
    const cookieA = await moPhien(t, a, (await yeuCau(t, a)).token!);
    expect((await goi("POST", "/passport/versions", cookieA, hoSo(a, "121212121212"))).status).toBe(201);
    const dem = (gucKhach: string, gucPassport: string): Promise<number> =>
      withTenant(apiPool, t.org, async (c) => {
        await c.query("SELECT pg_catalog.set_config('app.guest_session_id', $1, true), pg_catalog.set_config('app.passport_supplier_id', $2, true)", [
          gucKhach,
          gucPassport,
        ]);
        return Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM public.supplier_passport_versions")).rows[0]!.n);
      });
    const khach = "00000000-0000-4000-8000-0000000000aa";
    expect(await dem(khach, ""), "phiên khách lời mời").toBe(0);
    expect(await dem(khach, "00000000-0000-4000-8000-0000000000bb"), "GUC Passport của nhà cung cấp khác").toBe(0);
    expect(await dem(khach, a.ncc), "đối chứng: đúng cặp GUC của phiên Passport").toBe(1);
  });

  it("cookie không lẫn đối tượng: cookie Passport ở route khách và cookie khách ở route Passport đều 401", async () => {
    const t = await taoToChuc();
    const a = await ncc(t);
    const cookieA = await moPhien(t, a, (await yeuCau(t, a)).token!);
    const giaTri = cookieA.split("=")[1]!;
    expect((await goi("GET", "/guest/rfq", `${COOKIE_PHIEN_KHACH}=${giaTri}`)).status).toBe(401);
    expect((await goi("GET", "/passport", `${COOKIE_PHIEN_KHACH}=${giaTri}`)).status).toBe(401);
    expect((await goi("GET", "/passport", cookieA)).status).toBe(200);
    // Thoát: phiên thu hồi, cookie xoá.
    const thoat = await goi("POST", "/passport/logout", cookieA);
    expect(thoat.status).toBe(200);
    expect(thoat.setCookie.some((c) => c.startsWith(`${COOKIE_PHIEN_PASSPORT}=;`))).toBe(true);
    expect((await goi("GET", "/passport", cookieA)).status).toBe(401);
    // Lớp TRA COOKIE tự từ chối phiên đã thu hồi ở cả đường ghi — không dựa vào lớp sau (trigger trả 422, thoát lần hai trả 200).
    expect((await goi("POST", "/passport/versions", cookieA, hoSo(a, "112233445566"))).status).toBe(401);
    expect((await goi("POST", "/passport/logout", cookieA)).status).toBe(401);
  });
});

describe("[S1.287 / S3.7a1] E — trigger của năm bảng, ở tầng CSDL dưới `app_api`", () => {
  const loiCua = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => "KHONG LOI",
      (e: unknown) => String((e as Error).message),
    );

  it("[INV-E1] token RÀNG vào yêu cầu: đúc ở giao dịch khác bị từ chối; token thứ hai còn sống cho cùng nhà cung cấp bị từ chối", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const kq = await withTenant(apiPool, t.org, (c) => taoYeuCauPassport(c, t.org, { supplierId: n.ncc, contactId: n.lh, actorSessionId: t.tc.s }, auditPool));
    if (!kq.ok) throw new Error(kq.ma);
    const khacGiaoDich = await loiCua(
      withTenant(apiPool, t.org, (c) => ducTokenPassport(c, t.org, { requestId: kq.requestId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.tc.s })),
    );
    expect(khacGiaoDich).toMatch(/CUNG giao dich/u);
    // Một giao dịch, hai token thô: token thứ hai bị từ chối (tầng gói thu hồi trước — câu thô thì không).
    const haiToken = await loiCua(
      withTenant(apiPool, t.org, async (c) => {
        const k = await taoYeuCauPassport(c, t.org, { supplierId: n.ncc, contactId: n.lh, actorSessionId: t.tc.s }, auditPool);
        if (!k.ok) throw new Error(k.ma);
        await ducTokenPassport(c, t.org, { requestId: k.requestId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.tc.s });
        await c.query(
          "INSERT INTO supplier_passport_tokens (org_id, request_id, supplier_id, contact_id, token_hash, purpose, link_channel, expires_at, issued_by, issued_by_session_id) " +
            "VALUES ($1, $2, $3, $4, $5, 'PASSPORT_SUBMISSION', 'EMAIL', now() + interval '1 day', $6, $7)",
          [t.org, k.requestId, n.ncc, n.lh, randomBytes(32), t.tc.u, t.tc.s],
        );
      }),
    );
    expect(haiToken).toMatch(/link Passport dang song/u);
  });

  it("[INV-E2] OTP cùng lớp đích với kênh ĐÃ LƯU của link bị từ chối; phiên từ thách thức chưa đối chiếu, hay từ token đã thu hồi, bị từ chối", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const { token } = await yeuCau(t, n);
    const tokenId = (
      await db.pool.query<{ id: string }>("SELECT id FROM supplier_passport_tokens WHERE token_hash = $1", [createHash("sha256").update(token!, "utf8").digest()])
    ).rows[0]!.id;
    const chen = (kenh: string) =>
      withTenant(apiPool, t.org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO passport_otp_challenges (org_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at) " +
            "VALUES ($1, $2, $3, $4, $5, $6, 'v1', now() + interval '5 minutes') RETURNING id",
          [t.org, tokenId, n.lh, kenh, randomBytes(32), randomBytes(32)],
        ),
      );
    expect(await loiCua(chen("EMAIL"))).toMatch(/cung mot lop dich/u);
    const tt = (await chen("SMS")).rows[0]!.id;
    const moPhienTho = () =>
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO passport_sessions (org_id, supplier_id, contact_id, challenge_id, token_hash, verified_channel, expires_at) " +
            "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 hour')",
          [t.org, n.ncc, n.lh, tt, randomBytes(32)],
        ),
      );
    expect(await loiCua(moPhienTho())).toMatch(/chua duoc doi chieu/u);
    // Thách thức đối chiếu, token tiêu thụ — rồi bên mua thu hồi token (commit trước câu mở phiên): phiên không ra.
    await db.pool.query("UPDATE passport_otp_challenges SET consumed_at = now() WHERE id = $1", [tt]);
    await db.pool.query("UPDATE supplier_passport_tokens SET consumed_at = now(), revoked_at = now() WHERE id = $1", [tokenId]);
    expect(await loiCua(moPhienTho())).toMatch(/chua bi thu hoi/u);
    // Đối chứng: token tiêu thụ mà KHÔNG thu hồi ⇒ phiên ra — đổi bằng một token mới của một yêu cầu mới.
    const lan2 = await yeuCau(t, n);
    const cookie = await moPhien(t, n, lan2.token!);
    expect((await goi("GET", "/passport", cookie)).status).toBe(200);
  });

  it("[INV-A5] phiên bản: phiên đã thu hồi bị từ chối; phiên của A ghi cho B bị từ chối; năm phiên bản một phiên là trần", async () => {
    const t = await taoToChuc();
    const a = await ncc(t);
    const b = await ncc(t);
    const cookieA = await moPhien(t, a, (await yeuCau(t, a)).token!);
    const phienA = await sessionIdCua(cookieA);
    const nop = (supplierId: string, so: string) =>
      withTenant(apiPool, t.org, (c) => nopPhienBanPassport(c, t.org, { passportSessionId: phienA, supplierId, contactId: a.lh, hoSo: hoSo(a, so) }));
    expect(await loiCua(nop(b.ncc, "999988887777"))).toMatch(/nha cung cap khac/u);
    for (let i = 0; i < 5; i += 1) await nop(a.ncc, `10000000000${String(i)}`);
    expect(await loiCua(nop(a.ncc, "100000000009"))).toMatch(/tối đa năm phiên bản/u);
    await goi("POST", "/passport/logout", cookieA);
    expect(await loiCua(nop(a.ncc, "100000000008"))).toMatch(/đã hết hạn hay đã bị thu hồi/u);
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM supplier_passport_versions WHERE supplier_id = ANY($1::uuid[])", [[a.ncc, b.ncc]]);
    expect(rows[0]!.n).toBe("5");
  });
});

// =============================================================================================
// F — ĐỘT BIẾN LỚP CSDL: mỗi vế của năm trigger, hàm vị từ và policy nới bị tắt lúc chạy ⇒ lời từ chối tương ứng BIẾN MẤT (phép đo
// ở A–E thật sự tựa vào vế ấy). Khôi phục tự kiểm sha256 và NÉM khi lệch (khuôn S1.86).
// =============================================================================================
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

async function voiDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  await db.pool.query(goc.replace(cu, moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
    const sau = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
    if (sha(sau) !== sha(goc)) throw new Error(`khôi phục ${ham} lệch bản gốc`);
  }
}

const chenYeuCauTho = (t: ToChuc, n: Ncc, ai: Nguoi) =>
  withTenant(apiPool, t.org, (c) =>
    c.query(
      "INSERT INTO supplier_passport_requests (org_id, supplier_id, contact_id, ly_do, requested_by, requested_by_session_id) VALUES ($1, $2, $3, 'MANUAL', $4, $5)",
      [t.org, n.ncc, n.lh, ai.u, ai.s],
    ),
  );
const thanhCong = (p: Promise<unknown>): Promise<boolean> =>
  p.then(
    () => true,
    () => false,
  );
const tokenIdCua = async (token: string): Promise<string> =>
  (await db.pool.query<{ id: string }>("SELECT id FROM supplier_passport_tokens WHERE token_hash = $1", [createHash("sha256").update(token, "utf8").digest()])).rows[0]!
    .id;

describe("[S1.287 / S3.7a1] F — đột biến lớp CSDL", () => {
  it("vế K8a của hàm vị từ tắt ⇒ nhà cung cấp CHƯA xác minh nhận được yêu cầu (đối chứng: bật lại thì 422)", async () => {
    const t = await taoToChuc();
    const n = await ncc(t, { xacMinh: false });
    await voiDotBien("public.passport_chot_yeu_cau(uuid, uuid, uuid)", "IF NOT public.ncc_xac_minh_con_hieu_luc(p_org, p_ncc) THEN", "IF false THEN", async () => {
      expect((await yeuCau(t, n)).phanHoi.status).toBe(201);
    });
    const n2 = await ncc(t, { xacMinh: false });
    expect((await yeuCau(t, n2)).phanHoi.body.ma).toBe("PASSPORT_NCC_CHUA_XAC_MINH");
  });

  it("vế quyền của trigger yêu cầu tắt ⇒ người KHÔNG giữ `supplier.qualify` ghi được yêu cầu bằng câu thô (đối chứng: bị từ chối)", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    expect(await thanhCong(chenYeuCauTho(t, n, t.pm))).toBe(false);
    await voiDotBien("public.passport_kiem_yeu_cau()", "AND rp.permission_code = 'supplier.qualify') THEN", "AND rp.permission_code = 'supplier.qualify') AND false THEN", async () => {
      expect(await thanhCong(chenYeuCauTho(t, n, t.pm))).toBe(true);
    });
  });

  it("[INV-E1] vế CÙNG giao dịch của trigger token tắt ⇒ link đúc được cho một yêu cầu cũ", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const kq = await withTenant(apiPool, t.org, (c) => taoYeuCauPassport(c, t.org, { supplierId: n.ncc, contactId: n.lh, actorSessionId: t.tc.s }, auditPool));
    if (!kq.ok) throw new Error(kq.ma);
    const duc = () => withTenant(apiPool, t.org, (c) => ducTokenPassport(c, t.org, { requestId: kq.requestId, supplierId: n.ncc, contactId: n.lh, actorSessionId: t.tc.s }));
    await voiDotBien("public.passport_kiem_token()", "\n     OR yc_luc IS DISTINCT FROM now() THEN", " THEN", async () => {
      expect(await thanhCong(duc())).toBe(true);
    });
  });

  it("[INV-E2] vế khác lớp đích của trigger OTP tắt ⇒ OTP đi CÙNG hộp thư với link (đo ở câu ghi — lớp có thẩm quyền)", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const tokenId = await tokenIdCua((await yeuCau(t, n)).token!);
    await voiDotBien("public.passport_otp_kiem_kenh()", "IF public.otp_lop_dich(NEW.channel) = public.otp_lop_dich(tk_kenh) THEN", "IF false THEN", async () => {
      const ok = await thanhCong(
        withTenant(apiPool, t.org, (c) =>
          c.query(
            "INSERT INTO passport_otp_challenges (org_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at) " +
              "VALUES ($1, $2, $3, 'EMAIL', $4, $5, 'v1', now() + interval '5 minutes')",
            [t.org, tokenId, n.lh, randomBytes(32), randomBytes(32)],
          ),
        ),
      );
      expect(ok).toBe(true);
    });
  });

  it("[INV-E2] vế *chưa thu hồi* của trigger phiên tắt ⇒ phiên mở được từ một token đã bị thu hồi", async () => {
    const t = await taoToChuc();
    const n = await ncc(t);
    const tokenId = await tokenIdCua((await yeuCau(t, n)).token!);
    const tt = (
      await withTenant(apiPool, t.org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO passport_otp_challenges (org_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at) " +
            "VALUES ($1, $2, $3, 'SMS', $4, $5, 'v1', now() + interval '5 minutes') RETURNING id",
          [t.org, tokenId, n.lh, randomBytes(32), randomBytes(32)],
        ),
      )
    ).rows[0]!.id;
    await db.pool.query("UPDATE passport_otp_challenges SET consumed_at = now() WHERE id = $1", [tt]);
    await db.pool.query("UPDATE supplier_passport_tokens SET consumed_at = now(), revoked_at = now() WHERE id = $1", [tokenId]);
    const moPhienTho = () =>
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO passport_sessions (org_id, supplier_id, contact_id, challenge_id, token_hash, verified_channel, expires_at) " +
            "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 hour')",
          [t.org, n.ncc, n.lh, tt, randomBytes(32)],
        ),
      );
    expect(await thanhCong(moPhienTho())).toBe(false);
    await voiDotBien("public.passport_phien_kiem_danh_tinh()", " OR tk_thu_hoi IS NOT NULL THEN", " THEN", async () => {
      expect(await thanhCong(moPhienTho())).toBe(true);
    });
  });

  it("[INV-A5] vế *đúng nhà cung cấp* của trigger phiên bản tắt ⇒ phiên của A ghi hồ sơ của B", async () => {
    const t = await taoToChuc();
    const a = await ncc(t);
    const b = await ncc(t);
    const phienA = await sessionIdCua(await moPhien(t, a, (await yeuCau(t, a)).token!));
    const nopChoB = () =>
      withTenant(apiPool, t.org, (c) => nopPhienBanPassport(c, t.org, { passportSessionId: phienA, supplierId: b.ncc, contactId: a.lh, hoSo: hoSo(a, "246824682468") }));
    await voiDotBien("public.passport_kiem_phien_ban()", "IF ph_ncc IS DISTINCT FROM NEW.supplier_id THEN", "IF false THEN", async () => {
      expect(await thanhCong(nopChoB())).toBe(true);
    });
  });

  it("[INV-A5] policy nới thành mở hẳn ⇒ phiên Passport của A đọc được hồ sơ của B — phép đo cô lập tựa vào vế GUC dẫn xuất", async () => {
    const t = await taoToChuc();
    const a = await ncc(t);
    const b = await ncc(t);
    const cookieA = await moPhien(t, a, (await yeuCau(t, a)).token!);
    const cookieB = await moPhien(t, b, (await yeuCau(t, b)).token!);
    expect((await goi("POST", "/passport/versions", cookieA, hoSo(a, "135713571357"))).status).toBe(201);
    expect((await goi("POST", "/passport/versions", cookieB, hoSo(b, "975397539753"))).status).toBe(201);
    const phienA = await sessionIdCua(cookieA);
    const dem = () =>
      withPassportSession(apiPool, t.org, phienA, async (c) => Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM public.supplier_passport_versions")).rows[0]!.n));
    const docPolicy = async (): Promise<string> =>
      (
        await db.pool.query<{ q: string }>(
          "SELECT qual AS q FROM pg_policies WHERE tablename = 'supplier_passport_versions' AND policyname = 'supplier_passport_versions_khach'",
        )
      ).rows[0]!.q;
    const goc = await docPolicy();
    expect(await dem()).toBe(1);
    await db.pool.query("ALTER POLICY supplier_passport_versions_khach ON supplier_passport_versions USING (true)");
    try {
      expect(await dem()).toBe(2);
    } finally {
      await db.pool.query(`ALTER POLICY supplier_passport_versions_khach ON supplier_passport_versions USING (${goc})`);
      if (sha(await docPolicy()) !== sha(goc)) throw new Error("khôi phục policy lệch bản gốc");
    }
    expect(await dem()).toBe(1);
  });
});
