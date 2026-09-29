// [S1.9101 / S4.2b] Đường đọc và ghi của màn `/du-lieu` ở tầng gói — trên Postgres thật.
//
//   ⑴ `lietKeHangChuan` — phiên bản MỚI NHẤT của từng hàng, tìm trên dạng sạch, xếp theo mã, có trần, hàng ngừng dùng vẫn hiện;
//   ⑵ `docChiTietHangChuan` — mọi phiên bản, và CHỈ bí danh / quy đổi riêng đang hiệu lực của đúng hàng ấy, kèm tác giả;
//   ⑶ bí danh đơn vị của tổ chức — khai, đổi (hàng mới thắng), rút (rơi về bí danh chung), cổng `item.manage` ở CSDL, sổ;
//   ⑷ `rutBiDanhHang` với `hangChuanId` — không rút được bí danh đang trỏ sang hàng khác.
// Mọi phép ghi đi qua `withTenant` trên pool `app_api` và hàm của gói, như `hang-chuan.int.test.ts`.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { TRAN_LIET_KE_HANG_CHUAN } from "./hang-chuan.js";
import {
  DuLieuNenError,
  docChiTietHangChuan,
  docDanhMucDonVi,
  khaiBiDanhDonVi,
  khaiBiDanhHang,
  khaiQuyDoiRieng,
  lietKeHangChuan,
  quyDoiDonVi,
  rutBiDanhDonVi,
  rutBiDanhHang,
  rutQuyDoiRieng,
  taoHangChuan,
  taoPhienBanHangChuan,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let api: pg.Pool;
let orgA: string;
let orgB: string;
let quanLyA: { nguoi: string; phien: string };
let quanLyB: { nguoi: string; phien: string };
let kyThuatA: { nguoi: string; phien: string };

async function taoNguoi(orgId: string, vai: readonly string[], hoTen = "Nguoi"): Promise<{ nguoi: string; phien: string }> {
  const nguoi = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id", [
      orgId,
      `${randomBytes(4).toString("hex")}@vidu.vn`,
      hoTen,
    ])
  ).rows[0]!.id;
  const phien = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id",
      [orgId, nguoi, randomBytes(32)],
    )
  ).rows[0]!.id;
  for (const v of vai) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgId, nguoi, v]);
  return { nguoi, phien };
}

async function maLoi(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DuLieuNenError) return e.ma;
    return (e as { code?: string }).code ?? "KHONG_MA";
  }
  return "KHONG_NEM";
}

const trong = <T>(orgId: string, viec: (c: pg.PoolClient) => Promise<T>): Promise<T> => withTenant(api, orgId, viec);

async function taoHang(orgId: string, phien: string, ma: string, ten: string, donViGoc = "kg"): Promise<string> {
  return (await trong(orgId, (c) => taoHangChuan(c, orgId, { ma, donViGoc, ten, actorSessionId: phien }))).id;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'mdl-a'), ('Cong ty B', 'mdl-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  quanLyA = await taoNguoi(orgA, ["DATA_STEWARD"], "Nguyen Quan Ly");
  quanLyB = await taoNguoi(orgB, ["DATA_STEWARD"]);
  kyThuatA = await taoNguoi(orgA, ["TECHNICAL"]);
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.9101 / S4.2b] ⑴ liệt kê hàng chuẩn", () => {
  it("phiên bản MỚI NHẤT của từng hàng, xếp theo mã; hàng ngừng dùng vẫn có mặt; tổ chức khác không thấy", async () => {
    const d12 = await taoHang(orgA, quanLyA.phien, "LK-THEP-D12", "Thép cây D12");
    await taoHang(orgA, quanLyA.phien, "LK-BU-LONG-M24", "Bu lông neo M24", "cai");
    await trong(orgA, (c) => taoPhienBanHangChuan(c, orgA, { hangChuanId: d12, ten: "Thép cây D12 Hòa Phát", trangThai: "NGUNG_DUNG", actorSessionId: quanLyA.phien }));
    await taoHang(orgB, quanLyB.phien, "LK-CUA-B", "Hàng của tổ chức B");

    const { hangChuan: ds, conNua } = await trong(orgA, (c) => lietKeHangChuan(c, orgA, { q: "LK" }));
    expect(conNua).toBe(false);
    expect(ds.map((h) => h.ma)).toEqual(["LK-BU-LONG-M24", "LK-THEP-D12"]);
    const d = ds.find((h) => h.ma === "LK-THEP-D12")!;
    expect(d.ten).toBe("Thép cây D12 Hòa Phát");
    expect(d.trangThai).toBe("NGUNG_DUNG");
    expect(d.donViGoc).toBe("kg");
  });

  it("`q` so trên dạng SẠCH của mã và tên: bỏ dấu, không phân biệt hoa thường, dấu gạch là khoảng trắng", async () => {
    await taoHang(orgA, quanLyA.phien, "TK-XI-MANG-PCB40", "Xi măng Nghi Sơn PCB40");
    const theo = async (q: string): Promise<string[]> => (await trong(orgA, (c) => lietKeHangChuan(c, orgA, { q }))).hangChuan.map((h) => h.ma);
    expect(await theo("xi mang")).toContain("TK-XI-MANG-PCB40");
    expect(await theo("NGHI SƠN")).toContain("TK-XI-MANG-PCB40");
    expect(await theo("tk xi")).toContain("TK-XI-MANG-PCB40");
    expect(await theo("xi-măng-nghi")).toContain("TK-XI-MANG-PCB40");
    expect(await theo("xi mang ha tien")).toEqual([]);
    expect(await theo("   ")).toEqual(expect.arrayContaining(["TK-XI-MANG-PCB40", "LK-THEP-D12"]));
  });

  it("trần: đúng `TRAN_LIET_KE_HANG_CHUAN` hàng thì `conNua` false; thêm một hàng thì vẫn chừng ấy hàng, `conNua` true", async () => {
    // Gieo thẳng dưới vai chủ bảng — lượt đo này về câu ĐỌC, và 501 lần gọi gói là 501 hàng sổ không ai đọc.
    await db.pool.query(
      "WITH h AS (INSERT INTO canonical_items (org_id, ma, don_vi_goc, tac_gia, session_id) " +
        "SELECT $1, 'TRAN-' || lpad(g::text, 3, '0'), 'kg', $2, $3 FROM generate_series(0, $4 - 1) g RETURNING id, ma) " +
        "INSERT INTO canonical_item_versions (org_id, canonical_item_id, ten, tac_gia, session_id) SELECT $1, h.id, 'Hang ' || h.ma, $2, $3 FROM h",
      [orgB, quanLyB.nguoi, quanLyB.phien, TRAN_LIET_KE_HANG_CHUAN],
    );
    const du = await trong(orgB, (c) => lietKeHangChuan(c, orgB, { q: "tran" }));
    expect(du.hangChuan).toHaveLength(TRAN_LIET_KE_HANG_CHUAN);
    expect(du.conNua).toBe(false);
    await taoHang(orgB, quanLyB.phien, "TRAN-ZZZ", "Hang tran thua");
    const thua = await trong(orgB, (c) => lietKeHangChuan(c, orgB, { q: "tran" }));
    expect(thua.hangChuan).toHaveLength(TRAN_LIET_KE_HANG_CHUAN);
    expect(thua.hangChuan[0]!.ma).toBe("TRAN-000");
    expect(thua.hangChuan.some((h) => h.ma === "TRAN-ZZZ")).toBe(false);
    expect(thua.conNua).toBe(true);
  });
});

describe("[S1.9101 / S4.2b] ⑵ chi tiết hàng chuẩn", () => {
  it("mọi phiên bản mới nhất trước; chỉ bí danh và quy đổi ĐANG hiệu lực của đúng hàng này; tác giả là họ tên", async () => {
    const d10 = await taoHang(orgA, quanLyA.phien, "CT-THEP-D10", "Thép cây D10");
    const d32 = await taoHang(orgA, quanLyA.phien, "CT-THEP-D32", "Thép cây D32");
    await trong(orgA, (c) => taoPhienBanHangChuan(c, orgA, { hangChuanId: d10, ten: "Thép cây D10 CB300", actorSessionId: quanLyA.phien }));
    for (const b of ["thep d10 hp", "d10 hoa phat", "chuyen sang d32"]) {
      await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: d10, biDanh: b, actorSessionId: quanLyA.phien }));
    }
    // Một bí danh bị RÚT, một bí danh bị KHAI LẠI sang hàng khác — cả hai không còn là của D10.
    await trong(orgA, (c) => rutBiDanhHang(c, orgA, { biDanh: "d10 hoa phat", actorSessionId: quanLyA.phien }));
    await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: d32, biDanh: "chuyen sang d32", actorSessionId: quanLyA.phien }));
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: d10, tuDonVi: "cây", sangDonVi: "kg", heSo: "7.22", actorSessionId: quanLyA.phien }));
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: d10, tuDonVi: "bó", sangDonVi: "kg", heSo: "1000", actorSessionId: quanLyA.phien }));
    await trong(orgA, (c) => rutQuyDoiRieng(c, orgA, { hangChuanId: d10, tuDonVi: "bó", sangDonVi: "kg", actorSessionId: quanLyA.phien }));
    // Khai lại cùng cặp — hàng mới nhất theo `seq` là hệ số hiệu lực.
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: d10, tuDonVi: "cây", sangDonVi: "kg", heSo: "7.2", actorSessionId: quanLyA.phien }));

    const ct = (await trong(orgA, (c) => docChiTietHangChuan(c, orgA, d10)))!;
    expect(ct.hangChuan.ten).toBe("Thép cây D10 CB300");
    expect(ct.phienBan.map((p) => p.ten)).toEqual(["Thép cây D10 CB300", "Thép cây D10"]);
    expect(Number(ct.phienBan[0]!.seq)).toBeGreaterThan(Number(ct.phienBan[1]!.seq));
    expect(ct.phienBan[0]!.tacGia).toBe("Nguyen Quan Ly");
    expect(ct.biDanh.map((b) => b.biDanhSach)).toEqual(["thep d10 hp"]);
    expect(ct.biDanh[0]!.tacGia).toBe("Nguyen Quan Ly");
    expect(ct.quyDoi.map((q) => [q.tuDonVi, q.sangDonVi, Number(q.heSo)])).toEqual([["cay", "kg", 7.2]]);
    expect(Number.isNaN(Date.parse(ct.quyDoi[0]!.ghiLuc))).toBe(false);

    const ct32 = (await trong(orgA, (c) => docChiTietHangChuan(c, orgA, d32)))!;
    expect(ct32.biDanh.map((b) => b.biDanhSach)).toEqual(["chuyen sang d32"]);
  });

  it("id không có, hay của tổ chức khác ⇒ `null`", async () => {
    const cuaB = await taoHang(orgB, quanLyB.phien, "CT-CUA-B", "Hàng B");
    expect(await trong(orgA, (c) => docChiTietHangChuan(c, orgA, cuaB))).toBeNull();
    expect(await trong(orgA, (c) => docChiTietHangChuan(c, orgA, "3f2504e0-4f89-11d3-9a0c-0305e82c3301"))).toBeNull();
  });
});

describe("[S1.9101 / S4.2b] ⑶ bí danh đơn vị của tổ chức", () => {
  it("dạng mơ hồ do tổ chức tự khai: *\"MT\"* chưa khai thì không quy đổi; khai → `t`; khai lại → `m` thắng; rút ⇒ không quy đổi", async () => {
    const moc = (): Date => new Date(Date.now() + 60_000);
    const quyDoi = (tu: string, sang: string): Promise<string> =>
      trong(orgA, async (c) => (await quyDoiDonVi(c, { orgId: orgA, tu, sang, moc: moc() })).ma);
    expect(await quyDoi("MT", "kg")).toBe("KHONG_QUY_DOI_DUOC");

    const khai = await trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: " MT ", donVi: "tấn", actorSessionId: quanLyA.phien }));
    expect(khai.biDanhSach).toBe("mt");
    expect(khai.code).toBe("t");
    expect(await quyDoi("MT", "kg")).toBe("QUY_DOI_CHUNG");

    await trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: "mt", donVi: "m", actorSessionId: quanLyA.phien }));
    expect(await quyDoi("MT", "kg")).toBe("KHONG_QUY_DOI_DUOC");
    expect(await quyDoi("MT", "cm")).toBe("QUY_DOI_CHUNG");

    const dm = await trong(orgA, (c) => docDanhMucDonVi(c, orgA));
    expect(dm.biDanhToChuc.filter((b) => b.biDanhSach === "mt").map((b) => b.code)).toEqual(["m"]);
    expect(dm.biDanhToChuc.find((b) => b.biDanhSach === "mt")!.tacGia).toBe("Nguyen Quan Ly");

    await trong(orgA, (c) => rutBiDanhDonVi(c, orgA, { biDanh: "MT", actorSessionId: quanLyA.phien }));
    expect(await quyDoi("MT", "cm")).toBe("KHONG_QUY_DOI_DUOC");
    const sauRut = await trong(orgA, (c) => docDanhMucDonVi(c, orgA));
    expect(sauRut.biDanhToChuc.some((b) => b.biDanhSach === "mt")).toBe(false);
    expect(await maLoi(trong(orgA, (c) => rutBiDanhDonVi(c, orgA, { biDanh: "mt", actorSessionId: quanLyA.phien })))).toBe("KHONG_CO_BI_DANH");
  });

  it("rút bí danh của tổ chức đè lên bí danh CHUNG ⇒ chuỗi rơi về bí danh chung", async () => {
    await trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: "kgs", donVi: "g", actorSessionId: quanLyA.phien }));
    const dm = await trong(orgA, (c) => docDanhMucDonVi(c, orgA));
    expect(dm.biDanhChung.find((b) => b.biDanhSach === "kgs")?.code).toBe("kg");
    expect(dm.biDanhToChuc.find((b) => b.biDanhSach === "kgs")?.code).toBe("g");
    await trong(orgA, (c) => rutBiDanhDonVi(c, orgA, { biDanh: "kgs", actorSessionId: quanLyA.phien }));
    const heSo = await trong(orgA, (c) => quyDoiDonVi(c, { orgId: orgA, tu: "kgs", sang: "g", moc: new Date(Date.now() + 60_000) }));
    expect(heSo.quyDoiDuoc && Number(heSo.heSo)).toBe(1000);
  });

  it("từ chối có mã: đơn vị đóng gói, chuỗi rỗng sau làm sạch, người không giữ `item.manage`", async () => {
    expect(await maLoi(trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: "cay", donVi: "cây", actorSessionId: quanLyA.phien })))).toBe(
      "DON_VI_KHONG_CO_TRONG_DANH_MUC",
    );
    expect(await maLoi(trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: "!!!", donVi: "kg", actorSessionId: quanLyA.phien })))).toBe("CHUOI_RONG");
    expect(await maLoi(trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: "kilo", donVi: "kg", actorSessionId: kyThuatA.phien })))).toBe(
      "CAN_ITEM_MANAGE",
    );
  });

  it("mỗi lần khai và rút để lại đúng một hàng sổ trong cùng giao dịch, mang mã và `seq`", async () => {
    const k = await trong(orgA, (c) => khaiBiDanhDonVi(c, orgA, { biDanh: "Kilo gam", donVi: "kg", actorSessionId: quanLyA.phien }));
    const r = await trong(orgA, (c) => rutBiDanhDonVi(c, orgA, { biDanh: "kilo gam", actorSessionId: quanLyA.phien }));
    const { rows } = await db.pool.query<{ action: string; actor_id: string; resource_type: string; payload: Record<string, unknown> }>(
      "SELECT action, actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND resource_type = 'uom_alias' " +
        "AND payload->>'biDanhSach' = 'kilo gam' ORDER BY seq",
      [orgA],
    );
    expect(rows.map((h) => h.action)).toEqual(["UOM_ALIAS_DECLARED", "UOM_ALIAS_WITHDRAWN"]);
    expect(rows.every((h) => h.actor_id === quanLyA.nguoi)).toBe(true);
    expect(rows.map((h) => h.payload.seq)).toEqual([k.seq, r.seq]);
    expect(rows[0]!.payload.code).toBe("kg");
  });
});

describe("[S1.9101 / S4.2b] ⑷ rút bí danh hàng từ trang của một hàng chuẩn", () => {
  it("bí danh đang trỏ sang hàng khác ⇒ `KHONG_CO_BI_DANH`, không hàng nào được ghi; đúng hàng ⇒ rút được", async () => {
    const a = await taoHang(orgA, quanLyA.phien, "RUT-A", "Hàng A");
    const b = await taoHang(orgA, quanLyA.phien, "RUT-B", "Hàng B");
    await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: b, biDanh: "cua hang b", actorSessionId: quanLyA.phien }));
    const dem = async (): Promise<number> =>
      Number((await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM item_aliases WHERE org_id = $1", [orgA])).rows[0]!.n);
    const truoc = await dem();
    expect(await maLoi(trong(orgA, (c) => rutBiDanhHang(c, orgA, { biDanh: "cua hang b", hangChuanId: a, actorSessionId: quanLyA.phien })))).toBe(
      "KHONG_CO_BI_DANH",
    );
    expect(await dem()).toBe(truoc);
    await trong(orgA, (c) => rutBiDanhHang(c, orgA, { biDanh: "cua hang b", hangChuanId: b, actorSessionId: quanLyA.phien }));
    expect(await dem()).toBe(truoc + 1);
  });
});
