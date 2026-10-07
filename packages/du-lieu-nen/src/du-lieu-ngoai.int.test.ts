// [S1.272 / S4.6a] Mốc giá ngoài và lịch sử mua ngoài hệ thống — đường ghi, rút, danh sách không cột giá, trên Postgres thật
// (spec S4 §4.7, §5.1 L1 · L3 · L15; ADR-096; ADR-149).
//
// Bốn nhóm:
//   ⑴ đường ứng dụng — lô dán và nhập tay ghi đúng, một lô một hàng sổ không mang giá; lô sai không ghi gì và trả lỗi theo dòng;
//   ⑵ rút — một hàng, cả lô; rút lại thì không còn gì; danh sách nói hàng nào đã rút;
//   ⑶ luật ở CSDL, dưới `app_api` bằng câu SQL THÔ — tầng có thẩm quyền: đơn vị không quy đổi được, rút một hàng rút, rút hai lần,
//      sửa/xoá, người không giữ `item.manage`, `seq`/`ghi_luc` ngoài GRANT, hàng rút mang dữ liệu, đơn giá `NaN`, xuyên tổ chức;
//   ⑷ đọc — người quản lý dữ liệu thấy lô và hàng KHÔNG đơn giá; người giữ `bid.view` mà không giữ `item.manage` bị từ chối và vào sổ.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { PermissionDeniedError } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  DuLieuNenError,
  docLoDuLieuNgoai,
  khaiMocNgoai,
  khaiQuyDoiRieng,
  lietKeLoDuLieuNgoai,
  nhapDuLieuNgoai,
  rutDuLieuNgoai,
  taoHangChuan,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let api: pg.Pool;
let orgA: string;
let orgB: string;
let quanLyA: { nguoi: string; phien: string };
let quanLyB: { nguoi: string; phien: string };
let kyThuatA: { nguoi: string; phien: string };
let muaA: { nguoi: string; phien: string };
let thep = "";

async function taoNguoi(orgId: string, vai: readonly string[]): Promise<{ nguoi: string; phien: string }> {
  const nguoi = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi Quan Ly') RETURNING id", [
      orgId,
      `${randomBytes(4).toString("hex")}@vidu.vn`,
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

async function loiCua(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DuLieuNenError) return e.ma;
    if (e instanceof PermissionDeniedError) return "PERMISSION_DENIED";
    const l = e as { code?: string; constraint?: string };
    return l.constraint ?? l.code ?? "KHONG_MA";
  }
  return "KHONG_NEM";
}

const trong = <T>(orgId: string, viec: (c: pg.PoolClient) => Promise<T>): Promise<T> => withTenant(api, orgId, viec);

async function soHang(bang: "external_price_references" | "external_purchase_history", orgId: string): Promise<number> {
  return Number((await db.pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${bang} WHERE org_id = $1`, [orgId])).rows[0]!.n);
}

async function hangSo(orgId: string, action: string): Promise<{ payload: Record<string, unknown>; resource_id: string }[]> {
  return (
    await db.pool.query<{ payload: Record<string, unknown>; resource_id: string }>(
      "SELECT payload, resource_id FROM audit_events WHERE org_id = $1 AND action = $2 ORDER BY seq",
      [orgId, action],
    )
  ).rows;
}

const MOC_DAN =
  "Mã hàng,Đơn giá,Đơn vị,Tiền tệ,Ngày hiệu lực,Nguồn\n" +
  "THEP-D10,15500,Kg,VND,15/01/2026,Bao gia Hoa Phat thang 1\n" +
  "THEP-D10,111000.75,cây,VND,2026-02-01,Bang gia dai ly\n" +
  "CAT-VANG,350000,m3,VND,2026-01-20,Bao gia cat\n";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'ng-a'), ('Cong ty B', 'ng-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  quanLyA = await taoNguoi(orgA, ["DATA_STEWARD"]);
  quanLyB = await taoNguoi(orgB, ["DATA_STEWARD"]);
  kyThuatA = await taoNguoi(orgA, ["TECHNICAL"]);
  muaA = await taoNguoi(orgA, ["PROCUREMENT_MANAGER"]);
  thep = (await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "THEP-D10", donViGoc: "kg", ten: "Thep D10", actorSessionId: quanLyA.phien }))).id;
  await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "CAT-VANG", donViGoc: "m3", ten: "Cat vang", actorSessionId: quanLyA.phien }));
  await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: thep, tuDonVi: "cây", sangDonVi: "kg", heSo: "7.22", actorSessionId: quanLyA.phien }));
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe("[INV-L1] [INV-L15] [S1.272 / S4.6a] ⑴ đường ứng dụng — lô dán, nhập tay, một lô một hàng sổ không mang giá", () => {
  it("lô dán mốc ngoài: ba dòng, khoá đơn vị chuẩn hoá (`Kg`→`kg`, `cây`→`cay`), `seq` tăng, `ghi_luc` do trigger, một lô", async () => {
    const kq = await trong(orgA, (c) => nhapDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", vanBan: MOC_DAN, actorSessionId: quanLyA.phien }));
    expect(kq).toMatchObject({ nhan: true, loai: "MOC_NGOAI", soDong: 3, soHangChuan: 2 });
    const { rows } = await db.pool.query<{ ma: string; don_gia: string; don_vi: string; ngay: string; seq: string; lo: string; tac_gia: string; co_ghi_luc: boolean }>(
      "SELECT ci.ma, e.don_gia::text, e.don_vi, e.ngay_hieu_luc::text AS ngay, e.seq::text, e.lo_nhap_id AS lo, e.tac_gia, e.ghi_luc IS NOT NULL AS co_ghi_luc " +
        "FROM external_price_references e JOIN canonical_items ci ON ci.id = e.canonical_item_id WHERE e.org_id = $1 ORDER BY e.seq",
      [orgA],
    );
    expect(rows.map((r) => [r.ma, r.don_gia, r.don_vi, r.ngay])).toEqual([
      ["THEP-D10", "15500", "kg", "2026-01-15"],
      ["THEP-D10", "111000.75", "cay", "2026-02-01"],
      ["CAT-VANG", "350000", "m3", "2026-01-20"],
    ]);
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3]);
    expect(new Set(rows.map((r) => r.lo))).toEqual(new Set([kq.nhan ? kq.loNhapId : ""]));
    expect(rows.every((r) => r.co_ghi_luc && r.tac_gia === quanLyA.nguoi)).toBe(true);

    const so = await hangSo(orgA, "EXTERNAL_PRICE_REFERENCES_IMPORTED");
    expect(so).toHaveLength(1);
    expect(so[0]!.resource_id).toBe(kq.nhan ? kq.loNhapId : "");
    expect(so[0]!.payload).toEqual({ loai: "MOC_NGOAI", cachNhap: "DAN_CSV", soDong: 3, soHangChuan: 2 });
    expect(JSON.stringify(so[0]!.payload)).not.toMatch(/15500|111000|350000/u);
  });

  it("lô sai: KHÔNG ghi gì, không hàng sổ, mỗi lỗi một dòng — hàng chuẩn không có, đơn vị không quy đổi được, cùng lúc với lỗi hình dạng", async () => {
    const truoc = await soHang("external_price_references", orgA);
    const kq = await trong(orgA, (c) =>
      nhapDuLieuNgoai(c, orgA, {
        loai: "MOC_NGOAI",
        vanBan:
          "ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon\n" +
          "THEP-D10,15600,kg,VND,2026-03-01,ok\n" +
          "KHONG-CO,100,kg,VND,2026-03-01,x\n" +
          "THEP-D10,100,m3,VND,2026-03-01,x\n" +
          "CAT-VANG,100,bao,VND,2026-03-01,x\n" +
          "THEP-D10,100,---,VND,2026-03-01,x\n",
        actorSessionId: quanLyA.phien,
      }),
    );
    expect(kq.nhan ? [] : kq.loi.map((l) => `${String(l.dong)}:${String(l.cot)}:${l.ma}`)).toEqual([
      "3:ma_hang:KHONG_CO_HANG_CHUAN",
      "4:don_vi:DON_VI_KHONG_QUY_DOI_DUOC",
      "5:don_vi:DON_VI_KHONG_QUY_DOI_DUOC",
      "6:don_vi:DON_VI_RONG",
    ]);
    expect(await soHang("external_price_references", orgA)).toBe(truoc);
    expect(await hangSo(orgA, "EXTERNAL_PRICE_REFERENCES_IMPORTED")).toHaveLength(1);
    // Lỗi hình dạng đến TRƯỚC câu hỏi CSDL: lô có cả hai loại chỉ trả lỗi hình dạng — người nhập sửa văn bản rồi dán lại.
    const hinhDang = await trong(orgA, (c) =>
      nhapDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", vanBan: "ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon\nKHONG-CO,1.5.0,kg,VND,2026-03-01,x\n", actorSessionId: quanLyA.phien }),
    );
    expect(hinhDang.nhan ? [] : hinhDang.loi.map((l) => l.ma)).toEqual(["DON_GIA_SAI_HINH_DANG"]);
  });

  it("lô dán lịch sử ngoài: TAB, tên nhà cung cấp trong ngoặc kép mang dấu phẩy; một hàng sổ của loại ấy", async () => {
    const kq = await trong(orgA, (c) =>
      nhapDuLieuNgoai(c, orgA, {
        loai: "LICH_SU_NGOAI",
        vanBan:
          "ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_mua\tnha_cung_cap\tnguon\n" +
          'THEP-D10\t15200\tkg\tVND\t2025-11-20\t"Cong ty Thep A, chi nhanh 2"\tSo mua hang 2025\n' +
          "THEP-D10\t15400\tkg\tVND\t2025-12-05\tCong ty Thep B\tSo mua hang 2025\n",
        actorSessionId: quanLyA.phien,
      }),
    );
    expect(kq).toMatchObject({ nhan: true, soDong: 2, soHangChuan: 1 });
    const { rows } = await db.pool.query<{ ncc: string }>(
      "SELECT nha_cung_cap_text AS ncc FROM external_purchase_history WHERE org_id = $1 AND rut_cua IS NULL ORDER BY seq",
      [orgA],
    );
    expect(rows.map((r) => r.ncc)).toEqual(["Cong ty Thep A, chi nhanh 2", "Cong ty Thep B"]);
    expect((await hangSo(orgA, "EXTERNAL_PURCHASE_HISTORY_IMPORTED"))[0]!.payload).toEqual({
      loai: "LICH_SU_NGOAI",
      cachNhap: "DAN_CSV",
      soDong: 2,
      soHangChuan: 1,
    });
  });

  it("nhập tay một mốc trên trang hàng chuẩn: một lô một dòng, `cachNhap: TAY`; bốn lời từ chối có mã", async () => {
    const { loNhapId, hangId } = await trong(orgA, (c) =>
      khaiMocNgoai(c, orgA, { hangChuanId: thep, donGia: "16000", donVi: "kg", tienTe: "vnd", ngayHieuLuc: "2026-03-10", nguon: " Gia niem yet ", actorSessionId: quanLyA.phien }),
    );
    const { rows } = await db.pool.query<{ id: string; nguon: string; tien_te: string }>(
      "SELECT id, nguon, tien_te FROM external_price_references WHERE org_id = $1 AND lo_nhap_id = $2",
      [orgA, loNhapId],
    );
    // `hangId` là id của ĐÚNG hàng vừa ghi — đường sửa của người nhập mù giá là rút nó rồi nhập lại.
    expect(rows).toEqual([{ id: hangId, nguon: "Gia niem yet", tien_te: "VND" }]);
    expect((await hangSo(orgA, "EXTERNAL_PRICE_REFERENCES_IMPORTED")).at(-1)!.payload).toMatchObject({ cachNhap: "TAY", soDong: 1 });
    const nhap = (sua: Record<string, string>): Promise<string> =>
      loiCua(
        trong(orgA, (c) =>
          khaiMocNgoai(c, orgA, { hangChuanId: thep, donGia: "1", donVi: "kg", tienTe: "VND", ngayHieuLuc: "2026-03-10", nguon: "x", actorSessionId: quanLyA.phien, ...sua }),
        ),
      );
    expect(await nhap({ donVi: "m3" })).toBe("DON_VI_KHONG_QUY_DOI_DUOC");
    expect(await nhap({ donGia: "1,5" })).toBe("DON_GIA_SAI_HINH_DANG");
    // [rà soát §S1.272 CAO-1] `15.500` là mười lăm nghìn năm trăm trên bảng tính tiếng Việt — mơ hồ, từ chối có mã.
    expect(await nhap({ donGia: "15.500" })).toBe("DON_GIA_MO_HO");
    expect(await nhap({ ngayHieuLuc: "30/02/2026" })).toBe("NGAY_SAI_HINH_DANG");
    expect(await nhap({ hangChuanId: "00000000-0000-4000-8000-000000000000" })).toBe("KHONG_CO_HANG_CHUAN");
  });
});

describe("[INV-L1] [S1.272 / S4.6a] ⑵ rút — một hàng, cả lô; không xoá", () => {
  it("rút một hàng: hàng rút trỏ `rut_cua`, không mang dữ liệu; rút lại ⇒ KHONG_CO_HANG_DU_LIEU; rút lô chỉ rút hàng còn hiệu lực", async () => {
    const lo = (await db.pool.query<{ lo: string; id: string }>(
      "SELECT lo_nhap_id AS lo, id FROM external_price_references WHERE org_id = $1 AND rut_cua IS NULL ORDER BY seq LIMIT 1",
      [orgA],
    )).rows[0]!;
    expect(await trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", hangId: lo.id, actorSessionId: quanLyA.phien }))).toEqual({ soDong: 1 });
    const { rows } = await db.pool.query<{ canonical_item_id: string | null; don_gia: string | null }>(
      "SELECT canonical_item_id, don_gia FROM external_price_references WHERE org_id = $1 AND rut_cua = $2",
      [orgA, lo.id],
    );
    expect(rows).toEqual([{ canonical_item_id: null, don_gia: null }]);
    expect(await loiCua(trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", hangId: lo.id, actorSessionId: quanLyA.phien })))).toBe(
      "KHONG_CO_HANG_DU_LIEU",
    );
    // Lô ấy có ba hàng, một đã rút ⇒ rút lô viết đúng HAI hàng rút.
    expect(await trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", loNhapId: lo.lo, actorSessionId: quanLyA.phien }))).toEqual({
      soDong: 2,
    });
    expect(await loiCua(trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", loNhapId: lo.lo, actorSessionId: quanLyA.phien })))).toBe(
      "KHONG_CO_HANG_DU_LIEU",
    );
    const so = await hangSo(orgA, "EXTERNAL_PRICE_REFERENCES_WITHDRAWN");
    expect(so.map((s) => s.payload)).toEqual([
      { loai: "MOC_NGOAI", soDong: 1 },
      { loai: "MOC_NGOAI", soDong: 2 },
    ]);
    expect(so.map((s) => s.resource_id)).toEqual([lo.id, lo.lo]);
    // Một hàng của BẢNG KHÁC không rút được qua loại này.
    const lichSu = (await db.pool.query<{ id: string }>("SELECT id FROM external_purchase_history WHERE org_id = $1 LIMIT 1", [orgA])).rows[0]!.id;
    expect(await loiCua(trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", hangId: lichSu, actorSessionId: quanLyA.phien })))).toBe(
      "KHONG_CO_HANG_DU_LIEU",
    );
  });
});

describe("[INV-L1] [INV-L15] [S1.272 / S4.6a] ⑶ luật ở CSDL — câu SQL THÔ dưới `app_api`", () => {
  const tho = (orgId: string, sql: string, thamSo: readonly unknown[]): Promise<string> =>
    loiCua(trong(orgId, (c) => c.query(sql, [...thamSo])));
  const CHEN =
    "INSERT INTO external_price_references (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, lo_nhap_id, tac_gia, session_id) " +
    "VALUES ($1, $2, $3, $4, 'VND', '2026-01-01', 'x', gen_random_uuid(), $5, $6)";

  it("đơn vị không quy đổi được ⇒ từ chối có tên, kể cả khi tầng gói bị vòng qua; đơn vị chưa làm sạch cũng không lọt", async () => {
    expect(await tho(orgA, CHEN, [orgA, thep, "100", "m3", quanLyA.nguoi, quanLyA.phien])).toBe("du_lieu_ngoai_don_vi_khong_quy_doi_duoc");
    expect(await tho(orgA, CHEN, [orgA, thep, "100", "bao", quanLyA.nguoi, quanLyA.phien])).toBe("du_lieu_ngoai_don_vi_khong_quy_doi_duoc");
    // Trigger BEFORE chạy trước CHECK: chuỗi chưa làm sạch không khớp khoá nào nên luật quy đổi từ chối trước — CHECK
    // `…_don_vi_da_lam_sach` là lớp thứ hai, cho khoá sạch mà một trigger tắt sẽ để lọt.
    expect(await tho(orgA, CHEN, [orgA, thep, "100", "Kg", quanLyA.nguoi, quanLyA.phien])).toBe("du_lieu_ngoai_don_vi_khong_quy_doi_duoc");
    // Đối chứng dương: cùng câu với đơn vị quy đổi được (`g` cùng thứ nguyên với `kg`) đi qua.
    expect(await tho(orgA, CHEN, [orgA, thep, "100", "g", quanLyA.nguoi, quanLyA.phien])).toBe("KHONG_NEM");
  });

  it("đơn giá dương HỮU HẠN (`NaN` > 0 là đúng ở Postgres); hàng rút không mang dữ liệu; hàng dữ liệu đủ cột", async () => {
    expect(await tho(orgA, CHEN, [orgA, thep, "NaN", "kg", quanLyA.nguoi, quanLyA.phien])).toBe("external_price_references_don_gia_duong");
    expect(await tho(orgA, CHEN, [orgA, thep, "0", "kg", quanLyA.nguoi, quanLyA.phien])).toBe("external_price_references_don_gia_duong");
    const id = (await db.pool.query<{ id: string }>("SELECT id FROM external_price_references WHERE org_id = $1 AND rut_cua IS NULL LIMIT 1", [orgA])).rows[0]!.id;
    expect(
      await tho(
        orgA,
        "INSERT INTO external_price_references (org_id, rut_cua, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, lo_nhap_id, tac_gia, session_id) " +
          "VALUES ($1, $2, $3, 1, 'kg', 'VND', '2026-01-01', 'x', gen_random_uuid(), $4, $5)",
        [orgA, id, thep, quanLyA.nguoi, quanLyA.phien],
      ),
    ).toBe("external_price_references_hinh_dang");
    expect(
      await tho(
        orgA,
        "INSERT INTO external_price_references (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, tac_gia, session_id) " +
          "VALUES ($1, $2, 1, 'kg', 'VND', '2026-01-01', 'x', $3, $4)",
        [orgA, thep, quanLyA.nguoi, quanLyA.phien],
      ),
    ).toBe("external_price_references_hinh_dang");
  });

  it("[chủ dự án chốt sau rà soát §S1.272] ngày mua sau HÔM NAY (giờ Việt Nam) ⇒ từ chối có tên ở CSDL; hôm nay thì nhận; mốc ngoài ngày tương lai thì nhận", async () => {
    // Mỗi câu trong một giao dịch HUỶ ở cuối: hàng được nhận không thành lô thật, không làm lệch danh sách lô ở ⑷.
    const thoHuy = async (sql: string, thamSo: readonly unknown[]): Promise<string> => {
      let ma = "";
      await trong(orgA, async (c) => {
        ma = await loiCua(c.query(sql, [...thamSo]));
        throw new Error("huy");
      }).catch(() => undefined);
      return ma;
    };
    const CHEN_LS =
      "INSERT INTO external_purchase_history (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_mua, nha_cung_cap_text, nguon, lo_nhap_id, tac_gia, session_id) " +
      "VALUES ($1, $2, 1, 'kg', 'VND', (pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()) + '7 hours'::interval)::date + $3::int, 'X', 'x', gen_random_uuid(), $4, $5)";
    expect(await thoHuy(CHEN_LS, [orgA, thep, 1, quanLyA.nguoi, quanLyA.phien])).toBe("du_lieu_ngoai_ngay_mua_sau_hom_nay");
    expect(await thoHuy(CHEN_LS, [orgA, thep, 0, quanLyA.nguoi, quanLyA.phien])).toBe("KHONG_NEM");
    expect(
      await thoHuy(
        "INSERT INTO external_price_references (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, lo_nhap_id, tac_gia, session_id) " +
          "VALUES ($1, $2, 1, 'kg', 'VND', CURRENT_DATE + 400, 'x', gen_random_uuid(), $3, $4)",
        [orgA, thep, quanLyA.nguoi, quanLyA.phien],
      ),
    ).toBe("KHONG_NEM");
  });

  it("rút: một hàng rút trỏ về hàng rút ⇒ từ chối có tên; rút hai lần ⇒ UNIQUE; hàng không có ⇒ khoá ngoại", async () => {
    const RUT = "INSERT INTO external_purchase_history (org_id, rut_cua, tac_gia, session_id) VALUES ($1, $2, $3, $4)";
    const id = (await db.pool.query<{ id: string }>("SELECT id FROM external_purchase_history WHERE org_id = $1 AND rut_cua IS NULL ORDER BY seq LIMIT 1", [orgA])).rows[0]!.id;
    expect(await tho(orgA, RUT, [orgA, id, quanLyA.nguoi, quanLyA.phien])).toBe("KHONG_NEM");
    expect(await tho(orgA, RUT, [orgA, id, quanLyA.nguoi, quanLyA.phien])).toBe("external_purchase_history_org_id_rut_cua_key");
    const hangRut = (await db.pool.query<{ id: string }>("SELECT id FROM external_purchase_history WHERE org_id = $1 AND rut_cua = $2", [orgA, id])).rows[0]!.id;
    expect(await tho(orgA, RUT, [orgA, hangRut, quanLyA.nguoi, quanLyA.phien])).toBe("du_lieu_ngoai_rut_hang_rut");
    expect(await tho(orgA, RUT, [orgA, "00000000-0000-4000-8000-000000000000", quanLyA.nguoi, quanLyA.phien])).toBe(
      "external_purchase_history_org_id_rut_cua_fkey",
    );
  });

  it("chỉ-ghi-thêm: UPDATE, DELETE, TRUNCATE từ chối — kể cả dưới chủ bảng; `seq`, `ghi_luc` ngoài GRANT", async () => {
    for (const bang of ["external_price_references", "external_purchase_history"] as const) {
      expect(await tho(orgA, `UPDATE ${bang} SET nguon = 'sua' WHERE org_id = $1`, [orgA])).toBe("42501");
      expect(await tho(orgA, `DELETE FROM ${bang} WHERE org_id = $1`, [orgA])).toBe("42501");
      expect(await loiCua(db.pool.query(`UPDATE ${bang} SET nguon = 'sua'`))).not.toBe("KHONG_NEM");
      expect(await loiCua(db.pool.query(`DELETE FROM ${bang}`))).not.toBe("KHONG_NEM");
      expect(await loiCua(db.pool.query(`TRUNCATE ${bang}`))).not.toBe("KHONG_NEM");
    }
    expect(
      await tho(
        orgA,
        "INSERT INTO external_price_references (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, lo_nhap_id, tac_gia, session_id, ghi_luc) " +
          "VALUES ($1, $2, 1, 'kg', 'VND', '2026-01-01', 'x', gen_random_uuid(), $3, $4, now() - interval '1 year')",
        [orgA, thep, quanLyA.nguoi, quanLyA.phien],
      ),
    ).toBe("42501");
  });

  it("L3: người không giữ `item.manage` không ghi được, kể cả bằng câu thô; tác giả dẫn xuất từ phiên", async () => {
    expect(await tho(orgA, CHEN, [orgA, thep, "100", "kg", kyThuatA.nguoi, kyThuatA.phien])).toBe("du_lieu_nen_can_item_manage");
    expect(await tho(orgA, CHEN, [orgA, thep, "100", "kg", quanLyA.nguoi, kyThuatA.phien])).not.toBe("KHONG_NEM");
  });

  it("xuyên tổ chức: tổ chức B không thấy hàng của A, không rút được hàng của A, không ghi lên hàng chuẩn của A", async () => {
    expect(Number((await trong(orgB, (c) => c.query<{ n: string }>("SELECT count(*) AS n FROM external_price_references"))).rows[0]!.n)).toBe(0);
    const idA = (await db.pool.query<{ id: string }>("SELECT id FROM external_price_references WHERE org_id = $1 AND rut_cua IS NULL LIMIT 1", [orgA])).rows[0]!.id;
    expect(
      await tho(orgB, "INSERT INTO external_price_references (org_id, rut_cua, tac_gia, session_id) VALUES ($1, $2, $3, $4)", [orgB, idA, quanLyB.nguoi, quanLyB.phien]),
    ).toBe("external_price_references_org_id_rut_cua_fkey");
    expect(await tho(orgB, CHEN, [orgB, thep, "100", "kg", quanLyB.nguoi, quanLyB.phien])).toBe("external_price_references_org_id_canonical_item_id_fkey");
  });
});

describe("[INV-L15] [S1.272 / S4.6a] ⑷ đọc — lô và hàng KHÔNG đơn giá, cổng `item.manage`", () => {
  it("người quản lý dữ liệu: lô của cả hai bảng, mới nhất trước, với số còn hiệu lực; hàng của lô không có đơn giá", async () => {
    const { lo, conNua } = await trong(orgA, (c) => lietKeLoDuLieuNgoai(c, orgA, { actorSessionId: quanLyA.phien }, api));
    expect(conNua).toBe(false);
    expect(lo.map((l) => l.loai).sort()).toEqual(["LICH_SU_NGOAI", "MOC_NGOAI", "MOC_NGOAI", "MOC_NGOAI"]);
    const dan = lo.find((l) => l.loai === "MOC_NGOAI" && l.soDong === 3)!;
    expect(dan).toMatchObject({ soDongConHieuLuc: 0, soHangChuan: 2, tuNgay: "2026-01-15", denNgay: "2026-02-01" });
    expect(dan.tacGia).toEqual({ userId: quanLyA.nguoi, hoTen: "Nguoi Quan Ly" });
    const lichSu = lo.find((l) => l.loai === "LICH_SU_NGOAI")!;
    expect(lichSu).toMatchObject({ soDong: 2, soDongConHieuLuc: 1 });
    const hang = await trong(orgA, (c) => docLoDuLieuNgoai(c, orgA, { loai: "LICH_SU_NGOAI", loNhapId: lichSu.loNhapId, actorSessionId: quanLyA.phien }, api));
    expect(hang?.hang.map((h) => [h.maHang, h.donVi, h.ngay, h.nhaCungCap, h.daRut])).toEqual([
      ["THEP-D10", "kg", "2025-11-20", "Cong ty Thep A, chi nhanh 2", true],
      ["THEP-D10", "kg", "2025-12-05", "Cong ty Thep B", false],
    ]);
    const json = JSON.stringify({ lo, hang });
    expect(json).not.toMatch(/15200|15400|15500|111000|350000|16000|donGia|don_gia/u);
    expect(await trong(orgA, (c) => docLoDuLieuNgoai(c, orgA, { loai: "MOC_NGOAI", loNhapId: lichSu.loNhapId, actorSessionId: quanLyA.phien }, api))).toBeNull();
  });

  it("danh sách cắt ở 200 lô và NÓI ra: 201 lô ⇒ 200 lô mới nhất cùng `conNua`; lô cũ nhất là lô bị cắt", async () => {
    const hangB = (await trong(orgB, (c) => taoHangChuan(c, orgB, { ma: "THEP-B", donViGoc: "kg", ten: "Thep B", actorSessionId: quanLyB.phien }))).id;
    await trong(orgB, (c) =>
      c.query(
        "INSERT INTO external_price_references (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, lo_nhap_id, tac_gia, session_id) " +
          "SELECT $1, $2, 1, 'kg', 'VND', DATE '2026-01-01' + g, 'x', gen_random_uuid(), $3, $4 FROM generate_series(1, 201) g ORDER BY g",
        [orgB, hangB, quanLyB.nguoi, quanLyB.phien],
      ),
    );
    const { lo, conNua } = await trong(orgB, (c) => lietKeLoDuLieuNgoai(c, orgB, { actorSessionId: quanLyB.phien }, api));
    expect(conNua).toBe(true);
    expect(lo).toHaveLength(200);
    expect(lo.map((l) => l.tuNgay)).not.toContain("2026-01-02");
    expect(lo[0]?.tuNgay).toBe("2026-07-21");
  });

  it("người giữ `bid.view` không giữ `item.manage` ⇒ từ chối và một hàng PERMISSION_DENIED — danh sách này là của người nhập", async () => {
    const truoc = (await hangSo(orgA, "PERMISSION_DENIED")).length;
    expect(await loiCua(trong(orgA, (c) => lietKeLoDuLieuNgoai(c, orgA, { actorSessionId: muaA.phien }, api)))).toBe("PERMISSION_DENIED");
    expect((await hangSo(orgA, "PERMISSION_DENIED")).length).toBe(truoc + 1);
  });
});
