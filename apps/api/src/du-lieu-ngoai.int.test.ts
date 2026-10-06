// ==============================================================================================
// [S1.9101 / S4.6a] ROUTE MỐC GIÁ NGOÀI VÀ LỊCH SỬ MUA NGOÀI HỆ THỐNG QUA HTTP (spec S4 §3.5, §4.7; ADR-096; ADR-9201).
//
//   ⑴ [INV-L3] mười route: bảy route ghi khai `item.manage`, ba route đọc khai `agent: false`. Người PROCUREMENT_MANAGER (giữ
//      `bid.view` — người THẤY giá) gọi cả mười ⇒ 403: ghi bị cổng của bộ điều phối chặn, đọc bị cổng TRONG hàm đọc chặn (ADR-096 ⑵:
//      người đọc giá không phải người nhập, và danh sách lô là màn của người nhập). Mỗi lần một hàng PERMISSION_DENIED, không hàng
//      dữ liệu nào ra đời;
//   ⑵ [INV-L1] trọn đường của người quản lý dữ liệu: dán lô ⇒ 201, lô sai ⇒ 422 mang lỗi THEO DÒNG, nhập tay ⇒ 201, danh sách và
//      hàng của lô đọc lại KHÔNG một con số giá nào, rút dòng, rút cả lô;
//   ⑶ tổ chức khác không thấy lô; tham số đường dẫn sai hình dạng ⇒ 404; thân thiếu trường ⇒ 422, không 500.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { ROUTES_DU_LIEU_NGOAI } from "./routes/du-lieu-ngoai.js";
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
let quanLyB: Nguoi;
let thayGia: Nguoi;
let hangId: string;

/** Đơn giá có chữ ký riêng — không chuỗi con nào của một thân trả về được mang nó. */
const GIA_MOC = "48213.77";
const GIA_LICH_SU = "39127.41";
const GIA_TAY = "51904.29";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'dn-a'), ('Cong ty B', 'dn-b') RETURNING id",
  );
  orgA = rows[0]?.id ?? "";
  orgB = rows[1]?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dichVuTest().services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  quanLy = await nguoi(orgA, ["DATA_STEWARD"], "Tran Quan Ly");
  quanLyB = await nguoi(orgB, ["DATA_STEWARD"]);
  thayGia = await nguoi(orgA, ["PROCUREMENT_MANAGER"]);
  const tao = await goi("POST", "/items", quanLy, { ma: "THEP-D10", donViGoc: "kg", ten: "Thép cây D10" });
  expect(tao.status, tao.text).toBe(201);
  hangId = (tao.body.hangChuan as { id: string }).id;
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const BANG = ["external_price_references", "external_purchase_history"];

describe("[S1.9101 / S4.6a] ⑴ cổng `item.manage` — ghi ở bộ điều phối, đọc trong hàm", () => {
  it("mười route: bảy route ghi khai `item.manage`, ba route đọc khai `agent: false`; cả mười có trong ROUTES", () => {
    expect(ROUTES_DU_LIEU_NGOAI).toHaveLength(10);
    for (const r of ROUTES_DU_LIEU_NGOAI) expect(ROUTES, `${r.method} ${r.path}`).toContain(r);
    const ghi = ROUTES_DU_LIEU_NGOAI.filter((r) => "mutates" in r && r.mutates);
    expect(ghi).toHaveLength(7);
    for (const r of ghi) expect("permission" in r ? r.permission : null, `${r.method} ${r.path}`).toBe("item.manage");
    const doc = ROUTES_DU_LIEU_NGOAI.filter((r) => !("mutates" in r && r.mutates));
    expect(doc.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /external-data/batches",
      "GET /external-references/batches/:batchId",
      "GET /external-purchase-history/batches/:batchId",
    ]);
    for (const r of doc) expect("agent" in r ? r.agent : null, `${r.method} ${r.path}`).toBe(false);
  });

  it("[INV-L3] người giữ `bid.view` gọi mười route ⇒ 403 cả mười, mỗi lần một hàng PERMISSION_DENIED, không hàng dữ liệu nào", async () => {
    const soTuChoi = async (): Promise<number> =>
      Number(
        (await db.pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
          [orgA, thayGia.id],
        )).rows[0]?.n,
      );
    const truocSo = await soTuChoi();
    const truoc = await Promise.all(BANG.map((b) => dem(b, orgA)));
    const ca: [string, string, unknown][] = [
      ["POST", `/items/${hangId}/external-references`, { donGia: "1", donVi: "kg", tienTe: "VND", ngayHieuLuc: "2026-01-01", nguon: "x" }],
      ["POST", "/external-references/import", { vanBan: "x" }],
      ["POST", "/external-purchase-history/import", { vanBan: "x" }],
      ["POST", `/external-references/batches/${UUID0}/withdraw`, undefined],
      ["POST", `/external-purchase-history/batches/${UUID0}/withdraw`, undefined],
      ["POST", `/external-references/${UUID0}/withdraw`, undefined],
      ["POST", `/external-purchase-history/${UUID0}/withdraw`, undefined],
      ["GET", "/external-data/batches", undefined],
      ["GET", `/external-references/batches/${UUID0}`, undefined],
      ["GET", `/external-purchase-history/batches/${UUID0}`, undefined],
    ];
    for (const [m, p, b] of ca) {
      const r = await goi(m, p, thayGia, b);
      expect(r.status, `${m} ${p}: ${r.text}`).toBe(403);
    }
    expect((await soTuChoi()) - truocSo).toBe(10);
    expect(await Promise.all(BANG.map((b) => dem(b, orgA)))).toEqual(truoc);
  });
});

describe("[S1.9101 / S4.6a] ⑵ [INV-L1] trọn đường của người quản lý dữ liệu — không thân trả về nào mang giá", () => {
  it("dán lô sai ⇒ 422 với lỗi theo dòng, không hàng nào; lô đúng ⇒ 201; nhập tay ⇒ 201; danh sách, hàng của lô không con số giá nào; rút dòng, rút lô", async () => {
    const sai = await goi("POST", "/external-references/import", quanLy, {
      vanBan: `ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon\nTHEP-D10,${GIA_MOC},kg,VND,2026-01-15,Bang gia\nKHONG-CO,1,kg,EUR,2026-01-15,X\n`,
    });
    expect(sai.status, sai.text).toBe(422);
    expect((sai.body.loi as { dong: number; cot: string | null; ma: string }[]).map(({ dong, cot, ma }) => ({ dong, cot, ma }))).toEqual([
      { dong: 3, cot: "tien_te", ma: "TIEN_TE_SAI" },
    ]);
    expect(sai.text).not.toContain(GIA_MOC);
    expect(await dem("external_price_references", orgA)).toBe(0);

    const moc = await goi("POST", "/external-references/import", quanLy, {
      vanBan: `ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_hieu_luc\tnguon\nTHEP-D10\t${GIA_MOC}\tkg\tVND\t15/01/2026\tBang gia HP\nTHEP-D10\t${GIA_MOC}\tt\tVND\t2026-02-01\tBang gia HP\n`,
    });
    expect(moc.status, moc.text).toBe(201);
    expect(moc.body.lo).toMatchObject({ loai: "MOC_NGOAI", soDong: 2, soHangChuan: 1 });
    expect(moc.text).not.toContain(GIA_MOC);
    const loMoc = (moc.body.lo as { loNhapId: string }).loNhapId;

    const lichSu = await goi("POST", "/external-purchase-history/import", quanLy, {
      vanBan: `ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon\nTHEP-D10,${GIA_LICH_SU},kg,VND,2025-11-20,"Cong ty A, Ha Noi",So mua 2025\n`,
    });
    expect(lichSu.status, lichSu.text).toBe(201);
    const loLichSu = (lichSu.body.lo as { loNhapId: string }).loNhapId;

    const tay = await goi("POST", `/items/${hangId}/external-references`, quanLy, {
      donGia: GIA_TAY, donVi: "kg", tienTe: "USD", ngayHieuLuc: "2026-03-01", nguon: "LME",
    });
    expect(tay.status, tay.text).toBe(201);
    expect(tay.text).not.toContain(GIA_TAY);

    const ds = await goi("GET", "/external-data/batches", quanLy);
    expect(ds.status, ds.text).toBe(200);
    const lo = ds.body.lo as { loai: string; loNhapId: string; soDong: number; soDongConHieuLuc: number; tuNgay: string; denNgay: string }[];
    expect(lo.map((l) => [l.loai, l.soDong, l.soDongConHieuLuc, l.tuNgay, l.denNgay]).sort()).toEqual([
      ["LICH_SU_NGOAI", 1, 1, "2025-11-20", "2025-11-20"],
      ["MOC_NGOAI", 1, 1, "2026-03-01", "2026-03-01"],
      ["MOC_NGOAI", 2, 2, "2026-01-15", "2026-02-01"],
    ]);
    for (const gia of [GIA_MOC, GIA_LICH_SU, GIA_TAY]) expect(ds.text, gia).not.toContain(gia);

    const hangMoc = await goi("GET", `/external-references/batches/${loMoc}`, quanLy);
    expect(hangMoc.status, hangMoc.text).toBe(200);
    const hang = (hangMoc.body.lo as { hang: { id: string; maHang: string; donVi: string; daRut: boolean }[] }).hang;
    expect(hang.map((h) => [h.maHang, h.donVi, h.daRut])).toEqual([
      ["THEP-D10", "kg", false],
      ["THEP-D10", "t", false],
    ]);
    expect(hangMoc.text).not.toContain(GIA_MOC);
    expect(Object.keys(hangMoc.body.lo as object).sort()).toEqual(["hang", "loNhapId", "loai"]);
    const hangLs = await goi("GET", `/external-purchase-history/batches/${loLichSu}`, quanLy);
    expect((hangLs.body.lo as { hang: { nhaCungCap: string }[] }).hang.map((h) => h.nhaCungCap)).toEqual(["Cong ty A, Ha Noi"]);
    expect(hangLs.text).not.toContain(GIA_LICH_SU);
    // Lô của bảng này đọc qua đường của bảng kia ⇒ 404: hai bảng không lẫn nhau.
    expect((await goi("GET", `/external-purchase-history/batches/${loMoc}`, quanLy)).status).toBe(404);

    const rutDong = await goi("POST", `/external-references/${hang[0]?.id ?? ""}/withdraw`, quanLy);
    expect(rutDong.status, rutDong.text).toBe(201);
    expect(rutDong.body.rut).toEqual({ soDong: 1 });
    const lan2 = await goi("POST", `/external-references/${hang[0]?.id ?? ""}/withdraw`, quanLy);
    expect(lan2.status, lan2.text).toBe(422);
    const rutLo = await goi("POST", `/external-references/batches/${loMoc}/withdraw`, quanLy);
    expect(rutLo.status, rutLo.text).toBe(201);
    expect(rutLo.body.rut).toEqual({ soDong: 1 });
    const sau = await goi("GET", `/external-references/batches/${loMoc}`, quanLy);
    expect((sau.body.lo as { hang: { daRut: boolean }[] }).hang.map((h) => h.daRut)).toEqual([true, true]);
    // Rút là hàng MỚI: bảng có 2 + 1 hàng dữ liệu và 2 hàng rút; không UPDATE, không DELETE.
    expect(await dem("external_price_references", orgA)).toBe(5);
  });
});

describe("[S1.9101 / S4.6a] ⑶ ranh giới tổ chức, hình dạng đường và thân", () => {
  it("tổ chức B không thấy lô của A; hàng chuẩn của A không ghi được từ B ⇒ 422; id sai hình dạng ⇒ 404; thân thiếu trường ⇒ 422", async () => {
    const dsB = await goi("GET", "/external-data/batches", quanLyB);
    expect(dsB.status, dsB.text).toBe(200);
    expect(dsB.body).toEqual({ lo: [], conNua: false });
    const loA = ((await goi("GET", "/external-data/batches", quanLy)).body.lo as { loai: string; loNhapId: string }[]).find((l) => l.loai === "MOC_NGOAI");
    expect(loA).toBeDefined();
    expect((await goi("GET", `/external-references/batches/${loA?.loNhapId ?? ""}`, quanLyB)).status).toBe(404);
    const rutB = await goi("POST", `/external-references/batches/${loA?.loNhapId ?? ""}/withdraw`, quanLyB);
    expect(rutB.status, rutB.text).toBe(422);
    const ghiB = await goi("POST", `/items/${hangId}/external-references`, quanLyB, {
      donGia: "1", donVi: "kg", tienTe: "VND", ngayHieuLuc: "2026-01-01", nguon: "x",
    });
    expect(ghiB.status, ghiB.text).toBe(422);
    expect(await Promise.all(BANG.map((b) => dem(b, orgB)))).toEqual([0, 0]);

    expect((await goi("GET", "/external-references/batches/khong-phai-uuid", quanLy)).status).toBe(404);
    expect((await goi("POST", "/external-references/khong-phai-uuid/withdraw", quanLy)).status).toBe(404);
    expect((await goi("POST", "/items/khong-phai-uuid/external-references", quanLy, {})).status).toBe(404);
    const thieu = await goi("POST", "/external-references/import", quanLy, {});
    expect(thieu.status, thieu.text).toBe(422);
    const thieuGia = await goi("POST", `/items/${hangId}/external-references`, quanLy, { donVi: "kg", tienTe: "VND", ngayHieuLuc: "2026-01-01", nguon: "x" });
    expect(thieuGia.status, thieuGia.text).toBe(422);
    const donViSai = await goi("POST", `/items/${hangId}/external-references`, quanLy, {
      donGia: "1", donVi: "m", tienTe: "VND", ngayHieuLuc: "2026-01-01", nguon: "x",
    });
    expect(donViSai.status, donViSai.text).toBe(422);
  });
});
