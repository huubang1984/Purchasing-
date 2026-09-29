// ==============================================================================================
// [S1.9101 / S4.2b] ROUTE DỮ LIỆU NỀN QUA HTTP — hàng chuẩn, bí danh, quy đổi riêng, bí danh đơn vị.
//
//   ⑴ [INV-L3] cổng ghi ở tầng ứng dụng: người giữ vai KHÁC (FINANCE — mang `policy.manage`, `po.approve`…) gọi tám route ghi ⇒ 403,
//      mỗi lần một hàng PERMISSION_DENIED mang `resource_type` của route, không hàng dữ liệu nào ra đời. Lượt quét [INV-H17] của
//      `buyer.int.test.ts` đo cùng cổng bằng một phiên KHÔNG vai; ca này đo vai thật mà spec §8.10 nói tổ chức nhỏ sẽ muốn dùng;
//   ⑵ trọn đường của người quản lý dữ liệu: tạo, phiên bản, bí danh, quy đổi riêng, bí danh đơn vị, rút — mỗi lần ghi đọc lại
//      qua route đọc, và `quy_doi_don_vi` thấy đúng thứ vừa khai;
//   ⑶ đọc: mọi người mua của tổ chức đọc được, `choGhi` nói đúng người, tổ chức khác không thấy;
//   ⑷ từ chối có tên đi ra 422 với mã, không 500; tham số đường dẫn sai hình dạng là 404.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { quyDoiDonVi } from "@trustprocure/du-lieu-nen";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { ROUTES } from "./routes.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let orgA: string;
let orgB: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;

interface Nguoi {
  readonly id: string;
  readonly cookie: string;
}

async function nguoi(org: string, roles: readonly string[], hoTen = "Nguoi"): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
    [org, `${randomBytes(4).toString("hex")}@vidu.vn`, hoTen],
  );
  const id = rows[0]?.id ?? "";
  for (const r of roles) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, r]);
  const token = randomBytes(32).toString("base64url");
  await db.pool.query(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
    [org, id, createHash("sha256").update(token, "utf8").digest()],
  );
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
}

interface PhanHoi {
  readonly status: number;
  readonly text: string;
  readonly body: Record<string, unknown>;
}

async function goi(method: string, path: string, ai: Nguoi, body?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = { cookie: ai.cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${goc}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

async function dem(bang: string, org: string): Promise<number> {
  return Number((await db.pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${bang} WHERE org_id = $1`, [org])).rows[0]?.n ?? "-1");
}

let quanLy: Nguoi;
let taiChinh: Nguoi;
let quanLyB: Nguoi;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'dl-a'), ('Cong ty B', 'dl-b') RETURNING id",
  );
  orgA = rows[0]?.id ?? "";
  orgB = rows[1]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dichVuTest().services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  quanLy = await nguoi(orgA, ["DATA_STEWARD"], "Tran Quan Ly");
  taiChinh = await nguoi(orgA, ["FINANCE"]);
  quanLyB = await nguoi(orgB, ["DATA_STEWARD"]);
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("[S1.9101 / S4.2b] ⑴ cổng ghi `item.manage` ở tầng ứng dụng", () => {
  it("mười một route, đúng tám route ghi khai `item.manage`, ba route đọc khai `agent: false`", () => {
    const cuaDuLieu = ROUTES.filter((r) => /^\/(?:items|uom)(?:\/|$)/u.test(r.path));
    expect(cuaDuLieu).toHaveLength(11);
    expect(cuaDuLieu.every((r) => r.audience === "BUYER")).toBe(true);
    const ghi = cuaDuLieu.filter((r) => "mutates" in r && r.mutates);
    expect(ghi).toHaveLength(8);
    for (const r of ghi) expect("permission" in r ? r.permission : null, `${r.method} ${r.path}`).toBe("item.manage");
    for (const r of cuaDuLieu.filter((x) => !("mutates" in x && x.mutates))) {
      expect("agent" in r ? r.agent : null, `${r.method} ${r.path}`).toBe(false);
    }
  });

  it("[INV-L3] người FINANCE gọi tám route ghi ⇒ 403 cả tám, mỗi lần một hàng PERMISSION_DENIED, không hàng dữ liệu nào", async () => {
    const truocSo = Number(
      (await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'", [orgA, taiChinh.id]))
        .rows[0]?.n,
    );
    const bang = ["canonical_items", "canonical_item_versions", "item_aliases", "item_uom_conversions", "uom_aliases"];
    const truoc = await Promise.all(bang.map((b) => dem(b, orgA)));
    const ca: [string, string, unknown][] = [
      ["POST", "/items", { ma: "TC-1", donViGoc: "kg", ten: "X" }],
      ["POST", `/items/${UUID0}/versions`, { ten: "X" }],
      ["POST", `/items/${UUID0}/aliases`, { biDanh: "x" }],
      ["POST", `/items/${UUID0}/aliases/withdraw`, { biDanh: "x" }],
      ["POST", `/items/${UUID0}/conversions`, { tuDonVi: "cay", sangDonVi: "kg", heSo: "1" }],
      ["POST", `/items/${UUID0}/conversions/withdraw`, { tuDonVi: "cay", sangDonVi: "kg" }],
      ["POST", "/uom/aliases", { biDanh: "mt", donVi: "t" }],
      ["POST", "/uom/aliases/withdraw", { biDanh: "mt" }],
    ];
    for (const [m, p, b] of ca) {
      const r = await goi(m, p, taiChinh, b);
      expect(r.status, `${m} ${p}: ${r.text}`).toBe(403);
    }
    const { rows } = await db.pool.query<{ resource_type: string }>(
      "SELECT resource_type FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED' ORDER BY seq",
      [orgA, taiChinh.id],
    );
    expect(rows.length - truocSo).toBe(8);
    expect(rows.slice(truocSo).map((h) => h.resource_type)).toEqual([
      ...Array<string>(6).fill("CANONICAL_ITEM"),
      "UOM_ALIAS",
      "UOM_ALIAS",
    ]);
    expect(await Promise.all(bang.map((b) => dem(b, orgA)))).toEqual(truoc);
  });
});

describe("[S1.9101 / S4.2b] ⑵ trọn đường của người quản lý dữ liệu", () => {
  it("tạo → phiên bản → bí danh → quy đổi riêng → rút; mỗi bước đọc lại qua route, và `quy_doi_don_vi` thấy đúng thứ vừa khai", async () => {
    const tao = await goi("POST", "/items", quanLy, {
      ma: "THEP-D10", donViGoc: "kg", ten: "Thép cây D10", thuocTinh: { mac: "CB300", nha_san_xuat: "Hòa Phát" }, thuocTinhTrongYeu: ["mac"],
    });
    expect(tao.status, tao.text).toBe(201);
    const id = (tao.body.hangChuan as { id: string }).id;

    const ds = await goi("GET", "/items", quanLy);
    expect(ds.status, ds.text).toBe(200);
    expect(ds.body.choGhi).toBe(true);
    expect(ds.body.soNguoiQuanLy).toBe(1);
    expect(ds.body.conNua).toBe(false);
    expect((ds.body.hangChuan as { ma: string }[]).map((h) => h.ma)).toEqual(["THEP-D10"]);

    const pb = await goi("POST", `/items/${id}/versions`, quanLy, { ten: "Thép cây D10 CB300", thuocTinh: { mac: "CB300" }, thuocTinhTrongYeu: ["mac"] });
    expect(pb.status, pb.text).toBe(201);
    for (const biDanh of ["Thép Hòa Phát D10", "THEP D10 HP"]) {
      const r = await goi("POST", `/items/${id}/aliases`, quanLy, { biDanh });
      expect(r.status, r.text).toBe(201);
    }
    const qd = await goi("POST", `/items/${id}/conversions`, quanLy, { tuDonVi: "cây", sangDonVi: "kg", heSo: "7.22" });
    expect(qd.status, qd.text).toBe(201);
    expect(qd.body.quyDoi).toMatchObject({ tuDonVi: "cay", sangDonVi: "kg" });

    const ct = await goi("GET", `/items/${id}`, quanLy);
    expect(ct.status, ct.text).toBe(200);
    expect((ct.body.hangChuan as { ten: string }).ten).toBe("Thép cây D10 CB300");
    expect((ct.body.phienBan as unknown[]).length).toBe(2);
    expect((ct.body.biDanh as { biDanhSach: string; tacGia: string }[]).map((b) => [b.biDanhSach, b.tacGia])).toEqual([
      ["thep d10 hp", "Tran Quan Ly"],
      ["thep hoa phat d10", "Tran Quan Ly"],
    ]);
    expect((ct.body.quyDoi as { heSo: string }[]).map((q) => Number(q.heSo))).toEqual([7.22]);

    const moc = new Date(Date.now() + 60_000);
    const kq = await withTenant(apiPool, orgA, (c) => quyDoiDonVi(c, { orgId: orgA, hangChuanId: id, tu: "cây", sang: "g", moc }));
    expect(kq.quyDoiDuoc && kq.ma).toBe("QUY_DOI_RIENG");
    expect(kq.quyDoiDuoc && Number(kq.heSo)).toBe(7220);

    expect((await goi("POST", `/items/${id}/aliases/withdraw`, quanLy, { biDanh: "thep d10 hp" })).status).toBe(201);
    expect((await goi("POST", `/items/${id}/conversions/withdraw`, quanLy, { tuDonVi: "cây", sangDonVi: "kg" })).status).toBe(201);
    const sau = await goi("GET", `/items/${id}`, quanLy);
    expect((sau.body.biDanh as { biDanhSach: string }[]).map((b) => b.biDanhSach)).toEqual(["thep hoa phat d10"]);
    expect(sau.body.quyDoi).toEqual([]);
  });

  it("bí danh đơn vị: khai *\"MT\"* là tấn, đọc lại qua `/uom`, rút; lần thứ hai rút ⇒ 422 có tên", async () => {
    const k = await goi("POST", "/uom/aliases", quanLy, { biDanh: "MT", donVi: "tấn" });
    expect(k.status, k.text).toBe(201);
    expect(k.body.biDanh).toMatchObject({ biDanhSach: "mt", code: "t" });
    const dm = await goi("GET", "/uom", quanLy);
    expect(dm.status, dm.text).toBe(200);
    expect((dm.body.donVi as { code: string }[]).some((d) => d.code === "kg")).toBe(true);
    expect((dm.body.biDanhToChuc as { biDanhSach: string; code: string }[]).map((b) => [b.biDanhSach, b.code])).toEqual([["mt", "t"]]);
    expect((await goi("POST", "/uom/aliases/withdraw", quanLy, { biDanh: "mt" })).status).toBe(201);
    const lan2 = await goi("POST", "/uom/aliases/withdraw", quanLy, { biDanh: "mt" });
    expect(lan2.status, lan2.text).toBe(422);
    expect(lan2.text).toContain("không có bí danh đơn vị");
  });
});

describe("[S1.9101 / S4.2b] ⑶ đọc", () => {
  it("người FINANCE đọc được danh sách, chi tiết và danh mục đơn vị — `choGhi` false; tổ chức B không thấy hàng của A", async () => {
    const ds = await goi("GET", "/items", taiChinh);
    expect(ds.status, ds.text).toBe(200);
    expect(ds.body.choGhi).toBe(false);
    expect(ds.body.soNguoiQuanLy).toBe(1);
    const id = (ds.body.hangChuan as { id: string }[])[0]?.id ?? "";
    expect((await goi("GET", `/items/${id}`, taiChinh)).status).toBe(200);
    expect((await goi("GET", "/uom", taiChinh)).status).toBe(200);

    const b = await goi("GET", "/items", quanLyB);
    expect(b.body.hangChuan).toEqual([]);
    expect((await goi("GET", `/items/${id}`, quanLyB)).status).toBe(404);
  });
});

describe("[S1.9101 / S4.2b] ⑷ từ chối có tên", () => {
  it("mã sai hình dạng, mã trùng, đơn vị đóng gói làm đơn vị gốc, thuộc tính sai kiểu ⇒ 422, không 500", async () => {
    const ca: [unknown, string][] = [
      [{ ma: "thep-thuong", donViGoc: "kg", ten: "X" }, "MA_SAI_HINH_DANG"],
      [{ ma: "THEP-D10", donViGoc: "kg", ten: "X" }, "MA_DA_CO"],
      [{ ma: "THEP-D12", donViGoc: "cây", ten: "X" }, "đơn vị gốc"],
      [{ ma: "THEP-D12", donViGoc: "kg", ten: "X", thuocTinh: { Mac: "CB300" } }, "THUOC_TINH_SAI_HINH_DANG"],
      [{ ma: "THEP-D12", donViGoc: "kg", ten: "X", thuocTinh: ["CB300"] }, "thuocTinh"],
      [{ ma: "THEP-D12", donViGoc: "kg" }, "ten"],
    ];
    for (const [than, chu] of ca) {
      const r = await goi("POST", "/items", quanLy, than);
      expect(r.status, `${JSON.stringify(than)}: ${r.text}`).toBe(422);
      expect(r.text).toContain(chu);
    }
  });

  it("hàng chuẩn của tổ chức khác hay không có ⇒ 422 KHONG_CO_HANG_CHUAN khi ghi, 404 khi đọc; id sai hình dạng ⇒ 404", async () => {
    const cuaB = await goi("POST", "/items", quanLyB, { ma: "CUA-B", donViGoc: "kg", ten: "Hàng B" });
    const idB = (cuaB.body.hangChuan as { id: string }).id;
    const r = await goi("POST", `/items/${idB}/versions`, quanLy, { ten: "Chiếm" });
    expect(r.status, r.text).toBe(422);
    expect(r.text).toContain("KHONG_CO_HANG_CHUAN");
    expect((await goi("GET", `/items/${UUID0}`, quanLy)).status).toBe(404);
    expect((await goi("GET", "/items/khong-phai-uuid", quanLy)).status).toBe(404);
    expect((await goi("POST", "/items/khong-phai-uuid/aliases", quanLy, { biDanh: "x" })).status).toBe(404);
  });

  it("rút bí danh từ trang của hàng khác ⇒ 422, bí danh vẫn trỏ về hàng cũ", async () => {
    const ds = await goi("GET", "/items", quanLy);
    const d10 = (ds.body.hangChuan as { id: string; ma: string }[]).find((h) => h.ma === "THEP-D10")?.id ?? "";
    const khac = await goi("POST", "/items", quanLy, { ma: "THEP-D32", donViGoc: "kg", ten: "Thép cây D32" });
    const d32 = (khac.body.hangChuan as { id: string }).id;
    const r = await goi("POST", `/items/${d32}/aliases/withdraw`, quanLy, { biDanh: "thep hoa phat d10" });
    expect(r.status, r.text).toBe(422);
    const ct = await goi("GET", `/items/${d10}`, quanLy);
    expect((ct.body.biDanh as { biDanhSach: string }[]).map((b) => b.biDanhSach)).toEqual(["thep hoa phat d10"]);
  });

  it("quy đổi riêng giữa hai đơn vị cùng thứ nguyên và hệ số âm ⇒ 422 có tên", async () => {
    const ds = await goi("GET", "/items", quanLy);
    const d10 = (ds.body.hangChuan as { id: string; ma: string }[]).find((h) => h.ma === "THEP-D10")?.id ?? "";
    const cung = await goi("POST", `/items/${d10}/conversions`, quanLy, { tuDonVi: "tấn", sangDonVi: "kg", heSo: "1000" });
    expect(cung.status, cung.text).toBe(422);
    expect(cung.text).toContain("quy đổi chung đã có");
    const am = await goi("POST", `/items/${d10}/conversions`, quanLy, { tuDonVi: "cây", sangDonVi: "kg", heSo: "-1" });
    expect(am.status, am.text).toBe(422);
  });
});
