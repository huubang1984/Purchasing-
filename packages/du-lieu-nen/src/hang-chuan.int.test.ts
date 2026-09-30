// [S1.197 / S4.2a] Hàng chuẩn, vai quản lý dữ liệu mù giá, quy đổi riêng — trên Postgres thật.
//
// Ba nhóm, mỗi nhóm một bất biến của spec S4 §5.1:
//   L3 (vế vai)  — `item.manage` chỉ ở `DATA_STEWARD`, không đứng cùng năm mã thấy giá hay cầm thứ bị đo, ở vai và ở người;
//                  và người ghi dữ liệu nền phải giữ nó (cổng CSDL `du_lieu_nen_kiem_quyen_ghi`).
//   L1           — bốn bảng mới mang khuôn nền của `079`; tổng điều tra ở `don-vi.int.test.ts` đòi đủ năm bảng.
//   L4 (vế ⑵)    — quy đổi riêng: một cạnh của ĐÚNG hàng chuẩn, ghi trước mốc, ghép quy đổi chung ở hai đầu, cả chiều ngược;
//                  hai cạnh cùng dùng được là mơ hồ ⇒ `KHONG_QUY_DOI_DUOC` (ADR-116).
// Mọi phép ghi đi qua ĐÚNG đường ứng dụng: `withTenant` trên pool `app_api` và hàm của gói; vai chủ bảng chỉ để dựng người, gán
// vai, và đột biến.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  DuLieuNenError,
  KHONG_QUY_DOI_DUOC,
  docHangChuan,
  khaiBiDanhHang,
  khaiQuyDoiRieng,
  quyDoiDonVi,
  rutBiDanhHang,
  rutQuyDoiRieng,
  taoHangChuan,
  taoPhienBanHangChuan,
  type KetQuaQuyDoi,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let api: pg.Pool;
let orgA: string;
let orgB: string;
let quanLyA: { nguoi: string; phien: string };
let quanLyB: { nguoi: string; phien: string };
let kyThuatA: { nguoi: string; phien: string };

async function taoNguoi(orgId: string, vai: readonly string[]): Promise<{ nguoi: string; phien: string }> {
  const nguoi = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi') RETURNING id", [
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

function quyDoi(orgId: string, hangChuanId: string | null, tu: string, sang: string, moc = new Date(Date.now() + 60_000)): Promise<KetQuaQuyDoi> {
  return trong(orgId, (c) => quyDoiDonVi(c, { orgId, hangChuanId, tu, sang, moc }));
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'hc-a'), ('Cong ty B', 'hc-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  quanLyA = await taoNguoi(orgA, ["DATA_STEWARD"]);
  quanLyB = await taoNguoi(orgB, ["DATA_STEWARD"]);
  kyThuatA = await taoNguoi(orgA, ["TECHNICAL"]);
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.197 / S4.2a] vai quản lý dữ liệu mù giá — L3 vế vai", () => {
  const LOAI_TRU = ["bid.view", "po.approve", "award.recommend", "rfq.create", "rfq.invite"] as const;

  it("[INV-L3] mức VAI: DATA_STEWARD không nhận thêm mã loại trừ nào; vai đang giữ mã loại trừ không nhận item.manage", async () => {
    for (const ma of LOAI_TRU) {
      expect(await maLoi(db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ('DATA_STEWARD', $1)", [ma])), ma).toBe("42501");
    }
    for (const vai of ["BUYER", "FINANCE", "DIRECTOR", "PROCUREMENT_MANAGER", "REQUESTER"]) {
      expect(await maLoi(db.pool.query("INSERT INTO role_permissions (role_code, permission_code) VALUES ($1, 'item.manage')", [vai])), vai).toBe("42501");
    }
    const { rows } = await db.pool.query<{ role_code: string }>("SELECT role_code FROM role_permissions WHERE permission_code = 'item.manage'");
    expect(rows.map((r) => r.role_code)).toEqual(["DATA_STEWARD"]);
  });

  it("[INV-L3] mức NGƯỜI: DATA_STEWARD chỉ ghép được với TECHNICAL — gán theo chiều nào cũng bị chặn", async () => {
    for (const vai of ["BUYER", "FINANCE", "DIRECTOR", "PROCUREMENT_MANAGER", "REQUESTER"]) {
      const coVaiTruoc = await taoNguoi(orgA, [vai]);
      expect(
        await maLoi(db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DATA_STEWARD')", [orgA, coVaiTruoc.nguoi])),
        `${vai} rồi DATA_STEWARD`,
      ).toBe("42501");
      const quanLy = await taoNguoi(orgA, ["DATA_STEWARD"]);
      expect(
        await maLoi(db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, quanLy.nguoi, vai])),
        `DATA_STEWARD rồi ${vai}`,
      ).toBe("42501");
    }
    // Đối chứng dương: TECHNICAL không giữ mã loại trừ nào.
    await taoNguoi(orgA, ["DATA_STEWARD", "TECHNICAL"]);
  });

  it("[INV-L3] cổng GHI: người không giữ item.manage không ghi được dữ liệu nền — qua hàm gói lẫn câu SQL viết tay", async () => {
    expect(
      await maLoi(
        trong(orgA, (c) =>
          taoHangChuan(c, orgA, { ma: "KHONG-QUYEN", donViGoc: "kg", ten: "Khong quyen", actorSessionId: kyThuatA.phien }),
        ),
      ),
    ).toBe("CAN_ITEM_MANAGE");
    const loi = await trong(orgA, (c) =>
      c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id) VALUES ($1, 'kien', 'cai', $2, $3)", [
        orgA,
        kyThuatA.nguoi,
        kyThuatA.phien,
      ]),
    ).then(
      () => null,
      (e: { code?: string; constraint?: string }) => e,
    );
    expect(loi).toMatchObject({ code: "42501", constraint: "du_lieu_nen_can_item_manage" });
  });

  it("[INV-L3] ĐỘT BIẾN — gỡ trigger mức người lúc chạy: FINANCE nhận được DATA_STEWARD; gỡ cổng ghi: người không quyền ghi được", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE user_roles DISABLE TRIGGER user_roles_quan_ly_du_lieu_mu_gia");
      const taiChinh = (
        await c.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'tc-dotbien@vidu.vn', 'TC') RETURNING id", [orgA])
      ).rows[0]!.id;
      await c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'FINANCE')", [orgA, taiChinh]);
      await c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DATA_STEWARD')", [orgA, taiChinh]);
      await c.query("ROLLBACK");

      await c.query("BEGIN");
      await c.query("ALTER TABLE uom_aliases DISABLE TRIGGER uom_aliases_kiem_quyen_ghi");
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id) VALUES ($1, 'kien', 'cai', $2, $3)", [
        orgA,
        kyThuatA.nguoi,
        kyThuatA.phien,
      ]);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

describe("[S1.197 / S4.2a] hàng chuẩn — danh tính bất biến, phiên bản, bí danh — L1", () => {
  it("[INV-L1] tạo hàng chuẩn: danh tính + phiên bản đầu + hàng sổ trong CÙNG giao dịch; `seq` và `ghi_luc` do trigger đặt", async () => {
    const moi = await trong(orgA, (c) =>
      taoHangChuan(c, orgA, {
        ma: "THEP-D10",
        donViGoc: "Kg",
        ten: "Thép cây D10",
        thuocTinh: { nha_san_xuat: "Hoa Phat", kich_thuoc: "D10" },
        thuocTinhTrongYeu: ["kich_thuoc"],
        actorSessionId: quanLyA.phien,
      }),
    );
    expect(moi).toMatchObject({ ma: "THEP-D10", donViGoc: "kg" });
    const doc = await trong(orgA, (c) => docHangChuan(c, orgA, moi.id));
    expect(doc).toMatchObject({ ten: "Thép cây D10", trangThai: "DANG_DUNG", thuocTinhTrongYeu: ["kich_thuoc"], phienBanSeq: moi.phienBanSeq });
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'ITEM_CREATED' AND resource_id = $2",
      [orgA, moi.id],
    );
    expect(rows[0]!.n).toBe("1");
    const hang = (await db.pool.query<{ seq: string; ghi_luc: Date | null }>("SELECT seq::text, ghi_luc FROM canonical_items WHERE id = $1", [moi.id])).rows[0]!;
    expect(hang.ghi_luc).not.toBeNull();
    for (const cot of ["seq", "ghi_luc", "id"]) {
      const gia = cot === "seq" ? "99" : cot === "ghi_luc" ? "2000-01-01" : "00000000-0000-4000-8000-000000000002";
      expect(
        await maLoi(
          trong(orgA, (c) =>
            c.query(`INSERT INTO canonical_items (org_id, ma, don_vi_goc, tac_gia, session_id, ${cot}) VALUES ($1, 'X-${cot.toUpperCase()}', 'kg', $2, $3, $4)`, [
              orgA,
              quanLyA.nguoi,
              quanLyA.phien,
              gia,
            ]),
          ),
        ),
        `ứng dụng khai được cột ${cot}`,
      ).toBe("42501");
    }
  });

  it("[INV-L1] danh tính: đơn vị gốc phải thuộc danh mục (không đóng gói), mã viết hoa và duy nhất trong tổ chức, tổ chức khác dùng lại được", async () => {
    const tao = (orgId: string, ma: string, donViGoc: string, phien: string): Promise<unknown> =>
      trong(orgId, (c) => taoHangChuan(c, orgId, { ma, donViGoc, ten: "Hang", actorSessionId: phien }));
    expect(await maLoi(tao(orgA, "ONG-21", "cây", quanLyA.phien))).toBe("DON_VI_KHONG_CO_TRONG_DANH_MUC");
    expect(await maLoi(tao(orgA, "ong-21", "m", quanLyA.phien))).toBe("MA_SAI_HINH_DANG");
    await tao(orgA, "ONG-21", "m", quanLyA.phien);
    expect(await maLoi(tao(orgA, "ONG-21", "m", quanLyA.phien))).toBe("MA_DA_CO");
    await tao(orgB, "ONG-21", "m", quanLyB.phien);
  });

  it("[INV-L1] chỉ-ghi-thêm ở cả bốn bảng: `app_api` không UPDATE/DELETE; chủ bảng bị trigger chặn UPDATE, DELETE, TRUNCATE", async () => {
    // Trigger hàng chỉ chạy khi có hàng: mỗi bảng phải có ít nhất một hàng, không thì DELETE của chủ bảng đi qua mà không đo gì.
    await trong(orgA, async (c) => {
      const hc = await taoHangChuan(c, orgA, { ma: "CHI-GHI-THEM", donViGoc: "kg", ten: "Chi ghi them", actorSessionId: quanLyA.phien });
      await khaiBiDanhHang(c, orgA, { hangChuanId: hc.id, biDanh: "chi ghi them", actorSessionId: quanLyA.phien });
      await khaiQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "bao", sangDonVi: "kg", heSo: "25", actorSessionId: quanLyA.phien });
    });
    for (const bang of ["canonical_items", "canonical_item_versions", "item_aliases", "item_uom_conversions"]) {
      expect(await maLoi(trong(orgA, (c) => c.query(`UPDATE ${bang} SET tac_gia = tac_gia`))), `${bang} app_api UPDATE`).toBe("42501");
      expect(await maLoi(trong(orgA, (c) => c.query(`DELETE FROM ${bang}`))), `${bang} app_api DELETE`).toBe("42501");
      expect(await maLoi(db.pool.query(`UPDATE ${bang} SET tac_gia = tac_gia`)), `${bang} UPDATE`).toBe("23514");
      expect(await maLoi(db.pool.query(`DELETE FROM ${bang}`)), `${bang} DELETE`).toBe("23514");
      expect(await maLoi(db.pool.query(`TRUNCATE ${bang} CASCADE`)), `${bang} TRUNCATE`).toBe("23514");
    }
  });

  it("[INV-L1] sửa là một PHIÊN BẢN mới; thuộc tính là đối tượng phẳng khoá → chuỗi, thuộc tính trọng yếu phải có giá trị", async () => {
    const hc = await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "XI-MANG-PCB40", donViGoc: "t", ten: "Xi mang", actorSessionId: quanLyA.phien }));
    const pb = (thuocTinh: Record<string, unknown>, trongYeu: string[] = [], trangThai: "DANG_DUNG" | "NGUNG_DUNG" = "DANG_DUNG"): Promise<unknown> =>
      trong(orgA, (c) =>
        taoPhienBanHangChuan(c, orgA, {
          hangChuanId: hc.id,
          ten: "Xi măng PCB40",
          thuocTinh: thuocTinh as Record<string, string>,
          thuocTinhTrongYeu: trongYeu,
          trangThai,
          actorSessionId: quanLyA.phien,
        }),
      );
    expect(await maLoi(pb({ mac: 40 }))).toBe("THUOC_TINH_SAI_HINH_DANG");
    expect(await maLoi(pb({ Mac: "PCB40" }))).toBe("THUOC_TINH_SAI_HINH_DANG");
    expect(await maLoi(pb({ mac: "" }))).toBe("THUOC_TINH_SAI_HINH_DANG");
    expect(await maLoi(pb({ mac: "PCB40" }, ["tieu_chuan"]))).toBe("THUOC_TINH_SAI_HINH_DANG");
    await pb({ mac: "PCB40", tieu_chuan: "TCVN 6260" }, ["mac"], "NGUNG_DUNG");
    const doc = await trong(orgA, (c) => docHangChuan(c, orgA, hc.id));
    expect(doc).toMatchObject({ ten: "Xi măng PCB40", trangThai: "NGUNG_DUNG", thuocTinh: { mac: "PCB40", tieu_chuan: "TCVN 6260" }, donViGoc: "t" });
    expect(await trong(orgB, (c) => docHangChuan(c, orgB, hc.id)), "tổ chức khác không đọc được").toBeNull();
  });

  it("[INV-L1] bí danh hàng: làm sạch ở CSDL, hàng mới nhất theo `seq` thắng, rút thì hết; không trỏ được sang hàng của tổ chức khác", async () => {
    const [a, b] = await trong(orgA, async (c) => [
      await taoHangChuan(c, orgA, { ma: "BA-LAT-1", donViGoc: "cai", ten: "Bu lông M10", actorSessionId: quanLyA.phien }),
      await taoHangChuan(c, orgA, { ma: "BA-LAT-2", donViGoc: "cai", ten: "Bu lông M12", actorSessionId: quanLyA.phien }),
    ]);
    const khai = await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: a.id, biDanh: "Bu-lông  M10 ", actorSessionId: quanLyA.phien }));
    expect(khai.biDanhSach).toBe("bu long m10");
    await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: b.id, biDanh: "BU LONG M10", actorSessionId: quanLyA.phien }));
    const hienTai = async (): Promise<string | null> =>
      (
        await db.pool.query<{ id: string | null }>(
          "SELECT canonical_item_id AS id FROM item_aliases WHERE org_id = $1 AND bi_danh_sach = 'bu long m10' ORDER BY seq DESC LIMIT 1",
          [orgA],
        )
      ).rows[0]!.id;
    expect(await hienTai()).toBe(b.id);
    await trong(orgA, (c) => rutBiDanhHang(c, orgA, { biDanh: "bu long m10", actorSessionId: quanLyA.phien }));
    expect(await hienTai()).toBeNull();
    expect(await maLoi(trong(orgA, (c) => rutBiDanhHang(c, orgA, { biDanh: "bu long m10", actorSessionId: quanLyA.phien })))).toBe("KHONG_CO_BI_DANH");
    expect(await maLoi(trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: a.id, biDanh: " -- ", actorSessionId: quanLyA.phien })))).toBe("CHUOI_RONG");
    const cuaB = await trong(orgB, (c) => taoHangChuan(c, orgB, { ma: "BA-LAT-B", donViGoc: "cai", ten: "Bu lông", actorSessionId: quanLyB.phien }));
    expect(
      await maLoi(trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: cuaB.id, biDanh: "bu long b", actorSessionId: quanLyA.phien }))),
    ).toBe("KHONG_CO_HANG_CHUAN");
  });
});

describe("[S1.197 / S4.2a] quy đổi riêng — L4 vế ⑵", () => {
  let d10: string;
  let d12: string;
  let sauKhiKhai: Date;

  beforeAll(async () => {
    [d10, d12] = await trong(orgA, async (c) => [
      (await taoHangChuan(c, orgA, { ma: "L4-THEP-D10", donViGoc: "kg", ten: "Thép D10", actorSessionId: quanLyA.phien })).id,
      (await taoHangChuan(c, orgA, { ma: "L4-THEP-D12", donViGoc: "kg", ten: "Thép D12", actorSessionId: quanLyA.phien })).id,
    ]);
    await trong(orgA, async (c) => {
      // 1 cây D10 (11,7 m) = 7,22 kg; 1 m D10 = 0,617 kg — ví dụ của spec §4.2.
      await khaiQuyDoiRieng(c, orgA, { hangChuanId: d10, tuDonVi: "Cây", sangDonVi: "kg", heSo: "7.22", actorSessionId: quanLyA.phien });
      await khaiQuyDoiRieng(c, orgA, { hangChuanId: d10, tuDonVi: "mét", sangDonVi: "kg", heSo: "0.617", actorSessionId: quanLyA.phien });
    });
    sauKhiKhai = new Date(Date.now() + 60_000);
  });

  const BANG_CA: ReadonlyArray<readonly [string, string, string | null, string]> = [
    ["cây", "kg", "7.22", "QUY_DOI_RIENG"],
    ["cây", "g", "7220", "QUY_DOI_RIENG"],
    ["kg", "cây", String(1 / 7.22), "QUY_DOI_RIENG"],
    ["tấn", "cây", String(1000 / 7.22), "QUY_DOI_RIENG"],
    ["mét", "kg", "0.617", "QUY_DOI_RIENG"],
    ["mm", "kg", "0.000617", "QUY_DOI_RIENG"],
    ["kg", "km", String(1 / 617), "QUY_DOI_RIENG"],
    // ⑴ đi trước: quy đổi chung không bị cạnh riêng che.
    ["kg", "g", "1000", "QUY_DOI_CHUNG"],
    // Hai cạnh riêng nối nhau không ghép: cây → kg → mét cần hai cạnh.
    ["cây", "mét", null, KHONG_QUY_DOI_DUOC],
    ["cuộn", "kg", null, KHONG_QUY_DOI_DUOC],
    ["cây", "cây", null, KHONG_QUY_DOI_DUOC],
    ["cây", "lít", null, KHONG_QUY_DOI_DUOC],
  ];

  const lech = async (hangChuanId: string | null, moc: Date, chay = quyDoi): Promise<string[]> => {
    const ra: string[] = [];
    for (const [tu, sang, heSo, ma] of BANG_CA) {
      const kq = await chay(orgA, hangChuanId, tu, sang, moc);
      const dung = heSo === null ? kq.ma === ma && !kq.quyDoiDuoc : kq.quyDoiDuoc && kq.ma === ma && Math.abs(Number(kq.heSo) / Number(heSo) - 1) < 1e-12;
      if (!dung) ra.push(`${tu}→${sang}: ${JSON.stringify(kq)}`);
    }
    return ra;
  };

  it("[INV-L4] bảng ca: đúng một cạnh riêng, ghép quy đổi chung ở hai đầu, cả chiều ngược; hai cạnh nối nhau thì không", async () => {
    expect(await lech(d10, sauKhiKhai)).toEqual([]);
  });

  it("[INV-L4] cạnh riêng là của ĐÚNG hàng chuẩn và ĐÚNG tổ chức: hàng khác, không hàng, tổ chức khác ⇒ KHONG_QUY_DOI_DUOC", async () => {
    for (const hang of [d12, null]) {
      expect(await quyDoi(orgA, hang, "cây", "kg", sauKhiKhai), String(hang)).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
    }
    expect(await quyDoi(orgB, d10, "cây", "kg", sauKhiKhai)).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
  });

  it("[INV-L4] TẠI MỐC: cạnh ghi sau mốc không được dùng; rút thì hết từ lần rút, lịch sử trước đó vẫn đọc được", async () => {
    // Nhập liệu nhận MÃ danh mục (`m`); chuỗi tự do của dòng RFQ thì không — nên phía quy đổi viết *"mét"*.
    const hc = await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "L4-ONG", donViGoc: "m", ten: "Ống", actorSessionId: quanLyA.phien }));
    const truocKhai = new Date();
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "cuộn", sangDonVi: "m", heSo: "50", actorSessionId: quanLyA.phien }));
    const giua = new Date(Date.now() + 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(await quyDoi(orgA, hc.id, "cuộn", "mét", truocKhai)).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
    const heSo = (kq: KetQuaQuyDoi): number | null => (kq.quyDoiDuoc ? Number(kq.heSo) : null);
    expect(heSo(await quyDoi(orgA, hc.id, "cuộn", "mét", giua))).toBe(50);
    await trong(orgA, (c) => rutQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "cuộn", sangDonVi: "m", actorSessionId: quanLyA.phien }));
    expect(await quyDoi(orgA, hc.id, "cuộn", "mét")).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
    expect(heSo(await quyDoi(orgA, hc.id, "cuộn", "mét", giua)), "lịch sử trước lần rút vẫn đọc được").toBe(50);
    expect(
      await maLoi(trong(orgA, (c) => rutQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "cuộn", sangDonVi: "m", actorSessionId: quanLyA.phien }))),
    ).toBe("KHONG_CO_QUY_DOI");
  });

  it("[INV-L4] hai cạnh cùng dùng được là MƠ HỒ ⇒ KHONG_QUY_DOI_DUOC — kể cả khi hai hệ số khớp nhau", async () => {
    const hc = await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "L4-MO-HO", donViGoc: "kg", ten: "Mơ hồ", actorSessionId: quanLyA.phien }));
    await trong(orgA, async (c) => {
      await khaiQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "cây", sangDonVi: "kg", heSo: "7.22", actorSessionId: quanLyA.phien });
      await khaiQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "cây", sangDonVi: "tấn", heSo: "0.00722", actorSessionId: quanLyA.phien });
    });
    expect(await quyDoi(orgA, hc.id, "cây", "kg")).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
  });

  it("[INV-L4] khai quy đổi riêng: hai đầu cùng thứ nguyên, đầu `sang` ngoài danh mục, hệ số không dương ⇒ từ chối có mã", async () => {
    const khai = (tu: string, sang: string, heSo: string): Promise<unknown> =>
      trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: d12, tuDonVi: tu, sangDonVi: sang, heSo, actorSessionId: quanLyA.phien }));
    expect(await maLoi(khai("kg", "g", "1000"))).toBe("QUY_DOI_CHUNG_DA_CO");
    expect(await maLoi(khai("mét", "cây", "0.1"))).toBe("DON_VI_KHONG_CO_TRONG_DANH_MUC");
    for (const heSo of ["0", "0.000", "-1", "1e3", "abc"]) expect(await maLoi(khai("cây", "kg", heSo)), heSo).toBe("HE_SO_SAI_HINH_DANG");
  });

  it("[INV-L4] ĐỘT BIẾN — bỏ vế `ghi_luc < p_moc` của cạnh riêng: cạnh ghi SAU mốc lọt vào quy đổi", async () => {
    const hc = await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "L4-DOT-BIEN", donViGoc: "kg", ten: "Đột biến", actorSessionId: quanLyA.phien }));
    const truoc = new Date();
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: hc.id, tuDonVi: "bao", sangDonVi: "kg", heSo: "50", actorSessionId: quanLyA.phien }));
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      // [S1.235 / S4.4a] Vế ấy nay ở LÕI `quy_doi_da_giai` (`096`, ADR-136) — `quy_doi_don_vi` chỉ giải hai chuỗi rồi gọi lõi.
      const than = (
        await c.query<{ src: string }>(
          "SELECT prosrc AS src FROM pg_proc WHERE oid = 'public.quy_doi_da_giai(uuid, uuid, text, text, text, text, timestamptz)'::regprocedure",
        )
      ).rows[0]!.src;
      expect(than, "vế đột biến phải có mặt để gỡ").toContain("AND c.ghi_luc < p_moc");
      await c.query(`CREATE OR REPLACE FUNCTION public.quy_doi_da_giai(
          p_org uuid, p_hang_chuan uuid, p_tu text, p_khoa_tu text, p_sang text, p_khoa_sang text, p_moc timestamptz)
          RETURNS TABLE (he_so numeric, ma text) LANGUAGE sql STABLE SET search_path = pg_catalog, public
          AS $ham$${than.replace("AND c.ghi_luc < p_moc", "")}$ham$`);
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      const kq = await quyDoiDonVi(c, { orgId: orgA, hangChuanId: hc.id, tu: "bao", sang: "kg", moc: truoc });
      expect(kq, "đột biến phải làm cạnh sau mốc lọt vào").toMatchObject({ quyDoiDuoc: true, ma: "QUY_DOI_RIENG" });
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    expect(await quyDoi(orgA, hc.id, "bao", "kg", truoc)).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
  });
});
