// ==============================================================================================
// [S1.262 / S4.5c2] LỚP TÍNH LẠI ĐỘC LẬP CỦA NHÃN BENCHMARK — đo trên DỮ LIỆU THIẾT KẾ của `DAC-TA.md` §8, không trên đầu ra của lõi
//
// Bộ dữ liệu là bộ của S4.5b (`benchmark.int.test.ts`): ba gói lịch sử có trung vị {110, 105, 100} ⇒ mốc so 105; một gói đơn giá 0
// (đếm), một quan sát USD (đếm), một quan sát ngoài cửa sổ, một quan sát của chính gói X. Tệp test nằm trong `doc-lap/` nên cũng dưới
// `g17-`: nó không import lõi — phép so với lõi ở `kiem-du-lieu-nen.test.ts`.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { luiThang, tinhLaiDong, type NhomTinh, type QuanSatTinh } from "./benchmark-lai.js";

const MOC = "2026-09-30T00:00:00.000000Z";
const TRONG = "2026-03-01T08:00:00.000000Z";
const NHOM: NhomTinh = { cua_so_thang: "12", san_goi: "3", san_ncc: "3", nguong_lech_vua: "0.05", nguong_lech_cao: "0.10" };

let dem = 0;
function q(goi: string, ncc: string, gia: string, tuy: Partial<QuanSatTinh> = {}): QuanSatTinh {
  dem += 1;
  return { ma: `q${String(dem)}`, goi, ncc, ngay: TRONG, gia, tienTe: "VND", cungNguoiTao: false, hoiTo: [], ...tuy };
}

const BANG: readonly QuanSatTinh[] = [
  q("g1", "n1", "100"),
  q("g1", "n2", "120.00"),
  q("g2", "n3", "105", { cungNguoiTao: true }),
  q("g3", "n4", "90", { hoiTo: ["ANH_XA"] }),
  q("g3", "n5", "110", { hoiTo: ["ANH_XA"] }),
  q("g4", "n6", "0.0000"),
  q("g5", "n7", "4.5", { tienTe: "USD" }),
  q("g6", "n8", "999", { ngay: "2025-09-29T23:59:59.999999Z" }),
  q("gX", "n9", "1", { ngay: "2026-09-29T00:00:00.000000Z" }),
];
const VAO = { goiX: "gX", mocMoGia: MOC, nhom: NHOM };
const gia = (p: string) => ({ trangThai: "HOP_LE", gia: p, tienTe: "VND" });

describe("[INV-L7] [S1.262 / S4.5c2] §8.3 — lùi tháng theo lịch UTC, kẹp ngày cuối tháng", () => {
  it("ba ca của bảng trong DAC-TA, năm nhuận theo luật 4/100/400, qua ranh năm", () => {
    expect(luiThang("2026-03-31T09:15:00.123456Z", 1)).toBe("2026-02-28T09:15:00.123456Z");
    expect(luiThang("2024-03-31T00:00:00.000000Z", 1)).toBe("2024-02-29T00:00:00.000000Z");
    expect(luiThang("2026-01-15T23:59:59.999999Z", 12)).toBe("2025-01-15T23:59:59.999999Z");
    expect(luiThang("2100-03-31T00:00:00.000000Z", 1)).toBe("2100-02-28T00:00:00.000000Z");
    expect(luiThang("2000-03-31T00:00:00.000000Z", 1)).toBe("2000-02-29T00:00:00.000000Z");
    expect(luiThang("2026-01-31T05:00:00.000001Z", 2)).toBe("2025-11-30T05:00:00.000001Z");
    expect(luiThang("2026-05-31T00:00:00.000000Z", 60)).toBe("2021-05-31T00:00:00.000000Z");
  });
});

describe("[INV-L7] [S1.262 / S4.5c2] §8.5 — một dòng trên dữ liệu thiết kế", () => {
  const SO_DEM = {
    tienTe: "VND",
    cuaSoTu: "2025-09-30T00:00:00.000000Z",
    soQuanSat: 5,
    soGoi: 3,
    soNcc: 5,
    soGoiCungNguoiTao: 1,
    soQuanSatHoiTo: 2,
    soLoaiTienTe: 1,
    soLoaiGia0: 1,
  };

  it("mốc so 105: 105 trong dải, 130 bất thường trên, 96 lệch vừa dưới; số đếm loại đúng X, ngoài cửa sổ, USD, giá 0", () => {
    expect(tinhLaiDong(gia("105"), BANG, VAO)).toMatchObject({ nhan: "BINH_THUONG", chieu: null, lyDo: null, ...SO_DEM });
    expect(tinhLaiDong(gia("130"), BANG, VAO)).toMatchObject({ nhan: "LECH_CAO", chieu: "TREN", ...SO_DEM });
    expect(tinhLaiDong(gia("96"), BANG, VAO)).toMatchObject({ nhan: "LECH_VUA", chieu: "DUOI", ...SO_DEM });
    expect(tinhLaiDong(gia("105"), BANG, VAO).dauVao).toEqual(["q1", "q2", "q3", "q4", "q5"]);
  });

  it("biên ngưỡng tính về phía nhẹ: |p − m| = 0,05·m là trong dải, = 0,10·m là lệch vừa; vượt một phần vạn thì lên bậc", () => {
    expect(tinhLaiDong(gia("110.25"), BANG, VAO).nhan).toBe("BINH_THUONG");
    expect(tinhLaiDong(gia("110.2501"), BANG, VAO)).toMatchObject({ nhan: "LECH_VUA", chieu: "TREN" });
    expect(tinhLaiDong(gia("94.5"), BANG, VAO)).toMatchObject({ nhan: "LECH_VUA", chieu: "DUOI" });
    expect(tinhLaiDong(gia("94.4999"), BANG, VAO)).toMatchObject({ nhan: "LECH_CAO", chieu: "DUOI" });
  });

  it("biên cửa sổ: đúng `cuaSoTu` thì vào, sớm hơn một micro giây thì không; đúng mốc mở giá thì không", () => {
    const them = [
      ...BANG,
      q("g7", "n10", "200", { ngay: "2025-09-30T00:00:00.000000Z" }),
      q("g8", "n11", "200", { ngay: MOC }),
    ];
    const kq = tinhLaiDong(gia("105"), them, VAO);
    expect(kq.soGoi).toBe(4);
    expect(kq.dauVao).toContain(them.at(-2)!.ma);
    expect(kq.dauVao).not.toContain(them.at(-1)!.ma);
  });

  it("dưới sàn ⇒ CHUA_DU_LICH_SU, không chiều, số đếm vẫn báo", () => {
    expect(tinhLaiDong(gia("105"), BANG, { ...VAO, nhom: { ...NHOM, san_goi: "4" } })).toMatchObject({
      nhan: "CHUA_DU_LICH_SU",
      chieu: null,
      ...SO_DEM,
    });
    expect(tinhLaiDong(gia("105"), BANG, { ...VAO, nhom: { ...NHOM, san_ncc: "6" } }).nhan).toBe("CHUA_DU_LICH_SU");
  });

  it("phân vị nội suy: trung vị gói chẵn là trung bình hai giữa; mốc so trên bốn gói ở vị trí 1,5", () => {
    // Gói a {1, 2, 3, 4} ⇒ 2,5 · b {101} · c {103} · d {110} ⇒ trung vị gói {2.5, 101, 103, 110} ⇒ 101 + 0,5·2 = 102.
    const bon = [
      q("a", "x1", "1"),
      q("a", "x1", "2"),
      q("a", "x2", "3"),
      q("a", "x2", "4"),
      q("b", "x3", "101"),
      q("c", "x4", "103"),
      q("d", "x5", "110"),
    ];
    expect(tinhLaiDong(gia("102"), bon, VAO).nhan).toBe("BINH_THUONG");
    expect(tinhLaiDong(gia("107.1"), bon, VAO).nhan).toBe("BINH_THUONG"); // |5,1| ≤ 5,1
    expect(tinhLaiDong(gia("107.11"), bon, VAO)).toMatchObject({ nhan: "LECH_VUA", chieu: "TREN" });
  });

  it("[rà soát S4.5c2] §8.2: ngày TRƠN ngoài ngày biên phán xử cửa sổ bằng ngày; ngày trơn TRÊN ngày biên ⇒ ném có tên", () => {
    const tron = [...BANG, q("g9", "n12", "104", { ngay: "2026-03-02" }), q("g10", "n13", "999", { ngay: "2025-09-29" })];
    const kq = tinhLaiDong(gia("105"), tron, VAO);
    expect(kq.dauVao).toContain(tron.at(-2)!.ma);
    expect(kq.dauVao).not.toContain(tron.at(-1)!.ma);
    expect(kq.soGoi).toBe(4);
    expect(() => tinhLaiDong(gia("105"), [...BANG, q("g11", "n14", "100", { ngay: "2026-09-30" })], VAO)).toThrow(/ngày trơn 2026-09-30 trên một ngày biên/u);
    expect(() => tinhLaiDong(gia("105"), [...BANG, q("g11", "n14", "100", { ngay: "2025-09-30" })], VAO)).toThrow(/ngày biên/u);
  });

  it("dòng không đo được: không ánh xạ ⇒ CHUA_ANH_XA; trạng thái khác HOP_LE ⇒ lý do là trạng thái; không số đếm nào", () => {
    expect(tinhLaiDong(null, BANG, VAO)).toEqual({
      nhan: "KHONG_DO_DUOC",
      chieu: null,
      lyDo: "CHUA_ANH_XA",
      tienTe: null,
      cuaSoTu: null,
      soQuanSat: null,
      soGoi: null,
      soNcc: null,
      soGoiCungNguoiTao: null,
      soQuanSatHoiTo: null,
      soLoaiTienTe: null,
      soLoaiGia0: null,
      dauVao: null,
    });
    expect(tinhLaiDong({ trangThai: "LECH_TONG", gia: null, tienTe: null }, BANG, VAO)).toMatchObject({
      nhan: "KHONG_DO_DUOC",
      lyDo: "LECH_TONG",
      soGoi: null,
    });
  });

  it("dòng USD so với dải USD: quan sát VND bị loại và đếm, kể cả quan sát VND giá 0", () => {
    const usd = [...BANG, ...["4", "5", "6"].map((g, i) => q(`u${String(i)}`, `m${String(i)}`, g, { tienTe: "USD" }))];
    // Trung vị gói USD {4.5, 4, 5, 6} ⇒ sắp {4, 4.5, 5, 6} ⇒ 4,75; |5 − 4,75| = 0,25 > 0,2375 ⇒ lệch vừa trên. Sáu quan sát VND
    // trong cửa sổ (kể cả đơn giá 0 — luật tiền tệ đứng TRƯỚC luật giá 0) bị loại và đếm.
    expect(tinhLaiDong({ trangThai: "HOP_LE", gia: "5", tienTe: "USD" }, usd, VAO)).toMatchObject({
      nhan: "LECH_VUA",
      chieu: "TREN",
      tienTe: "USD",
      soGoi: 4,
      soLoaiTienTe: 6,
      soLoaiGia0: 0,
    });
  });
});
