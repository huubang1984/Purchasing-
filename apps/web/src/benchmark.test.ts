// ==============================================================================================
// [S1.260 / S4.5c1] PHÉP ĐO CHO CHỮ BENCHMARK CỦA MÀN `/mo-thau` — nhãn theo đúng chữ spec S4 §4.6, thành phần dải, độ phủ theo giá
// trị (§2.5 ⒁), chữ của dải và của các trạng thái không nhãn.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { chuDai, chuNhan, chuThanhPhan, chuTrangThai, doPhu, soDai, tomTatNhan, type DongBenchmark } from "./benchmark.js";

const DONG: DongBenchmark = {
  bidVersionId: "b-1",
  lineNo: 1,
  nhan: "BINH_THUONG",
  chieu: null,
  lyDo: null,
  soGoi: 5,
  soNcc: 4,
  soGoiCungNguoiTao: 1,
  soQuanSatHoiTo: 2,
  soLoaiTienTe: 0,
  soLoaiGia0: 0,
  hoiTo: [],
};
const voi = (doi: Partial<DongBenchmark>): DongBenchmark => ({ ...DONG, ...doi });

describe("[S1.260 / S4.5c1] chữ của nhãn — spec S4 §4.6", () => {
  it("BINH_THUONG nói 'trong dải lịch sử nội bộ' kèm quy mô — không nói 'sạch' hay 'tốt'", () => {
    const c = chuNhan(DONG);
    expect(c).toBe("trong dải lịch sử nội bộ (5 gói, 4 nhà cung cấp)");
    expect(c).not.toMatch(/sạch|tốt/u);
  });

  it("LECH_CAO trên là 'Giá bất thường — nên xem xét'; dưới là 'thấp bất thường' dẫn tới làm rõ, KHÔNG phải căn cứ loại", () => {
    expect(chuNhan(voi({ nhan: "LECH_CAO", chieu: "TREN" }))).toBe("Giá bất thường — nên xem xét");
    const duoi = chuNhan(voi({ nhan: "LECH_CAO", chieu: "DUOI" }));
    expect(duoi).toMatch(/^Thấp bất thường/u);
    expect(duoi).toContain("làm rõ");
    expect(duoi).toContain("không phải căn cứ loại");
    expect(duoi).not.toMatch(/tốt/u);
  });

  it("LECH_VUA nói chiều; CHUA_DU_LICH_SU không con số; KHONG_DO_DUOC nói lý do; nhãn lạ in nguyên mã", () => {
    expect(chuNhan(voi({ nhan: "LECH_VUA", chieu: "TREN" }))).toContain("cao hơn");
    expect(chuNhan(voi({ nhan: "LECH_VUA", chieu: "DUOI" }))).toContain("thấp hơn");
    expect(chuNhan(voi({ nhan: "CHUA_DU_LICH_SU", soGoi: 2, soNcc: 2 }))).toBe("chưa đủ lịch sử để so (2 gói, 2 nhà cung cấp)");
    expect(chuNhan(voi({ nhan: "KHONG_DO_DUOC", lyDo: "CHUA_ANH_XA" }))).toBe("không đo được — dòng chưa ánh xạ về hàng chuẩn nào");
    expect(chuNhan(voi({ nhan: "KHONG_DO_DUOC", lyDo: "LY_DO_MOI" }))).toBe("không đo được — LY_DO_MOI");
    expect(chuNhan(voi({ nhan: "NHAN_MOI" }))).toBe("NHAN_MOI");
  });
});

describe("[S1.260 / S4.5c1] thành phần dải — n gói · m nhà cung cấp · k gói cùng người tạo · h quan sát hồi tố", () => {
  it("đủ bốn vế đúng thứ tự spec; số bị loại và cờ hồi tố của chính dòng nói ra khi có", () => {
    expect(chuThanhPhan(DONG)).toBe("5 gói · 4 nhà cung cấp · 1 gói do chính người tạo gói này lập · 2 quan sát ánh xạ hồi tố");
    const c = chuThanhPhan(voi({ soLoaiTienTe: 3, soLoaiGia0: 1, hoiTo: ["ANH_XA", "QUY_DOI"] }));
    expect(c).toContain("(đã loại 3 khác tiền tệ, 1 đơn giá 0)");
    expect(c).toContain("Dòng này đọc ánh xạ, quy đổi ghi SAU mốc mở giá");
  });

  it("dòng không đo được không có thành phần dải", () => {
    expect(chuThanhPhan(voi({ nhan: "KHONG_DO_DUOC", lyDo: "LECH_TONG", soGoi: null, soNcc: null }))).toBe("—");
  });
});

describe("[S1.260 / S4.5c1] độ phủ — phần giá trị trên dòng đo được (§2.5 ⒁)", () => {
  const ba = [voi({ lineNo: 1 }), voi({ lineNo: 2, nhan: "CHUA_DU_LICH_SU" }), voi({ lineNo: 3, nhan: "LECH_CAO", chieu: "TREN" })];

  it("đếm dòng đo được và tính phần trăm GIÁ TRỊ, không phần trăm số dòng; CHUA_DU_LICH_SU không phủ", () => {
    const p = doPhu(ba, [
      { lineNo: 1, amount: "600.00" },
      { lineNo: 2, amount: "300.00" },
      { lineNo: 3, amount: "100.00" },
    ]);
    expect(p).toEqual({ soDoDuoc: 2, soDong: 3, phanTramGiaTri: "70,0" });
  });

  it("cắt xuống ở một chữ số lẻ; thành tiền không đọc được hay tổng 0 ⇒ không phần trăm", () => {
    expect(doPhu([voi({ lineNo: 1 })], [{ lineNo: 1, amount: "1.00" }, { lineNo: 2, amount: "2.00" }]).phanTramGiaTri).toBe("33,3");
    expect(doPhu(ba, [{ lineNo: 1, amount: "abc" }]).phanTramGiaTri).toBeNull();
    expect(doPhu(ba, [{ lineNo: 1, amount: "0.00" }]).phanTramGiaTri).toBeNull();
  });
});

describe("[S1.260 / S4.5c1] tóm tắt cho bảng xếp hạng, trạng thái không nhãn, chữ của dải", () => {
  it("tóm tắt đếm theo nhóm, tách bất thường cao và thấp, bỏ nhóm rỗng", () => {
    expect(
      tomTatNhan([voi({}), voi({ nhan: "LECH_CAO", chieu: "TREN" }), voi({ nhan: "LECH_CAO", chieu: "DUOI" }), voi({ nhan: "KHONG_DO_DUOC" })]),
    ).toBe("1 trong dải · 1 bất thường (cao) · 1 thấp bất thường · 1 không đo được");
    expect(tomTatNhan([])).toBe("—");
  });

  it("bốn trạng thái không nhãn có câu; CO thì null", () => {
    expect(chuTrangThai({ trangThai: "CO" })).toBeNull();
    expect(chuTrangThai({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" })).toContain("Vòng chào lại");
    expect(chuTrangThai({ trangThai: "KHONG_HIEN", rfqStatus: "AWARDED" })).toContain("AWARDED");
    expect(chuTrangThai({ trangThai: "CHUA_CAU_HINH", policyVersion: 3 })).toContain("Phiên bản chính sách 3");
    expect(chuTrangThai({ trangThai: "CHUA_CAU_HINH", policyVersion: null })).toContain("không ghim");
  });

  it("số của dải làm tròn nửa-ra-xa-0 về hai chữ số lẻ, nhóm nghìn kiểu Việt Nam", () => {
    expect(soDai("12500")).toBe("12.500,00");
    expect(soDai("12500.125")).toBe("12.500,13");
    expect(soDai("12500.124999")).toBe("12.500,12");
    expect(soDai("0.5")).toBe("0,50");
    expect(soDai(null)).toBe("—");
  });

  it("dải đủ sàn có ba số và đơn vị; dưới sàn không con số; SAU_MOC và lệch bản lưu nói ra", () => {
    const d = { tienTe: "VND", duSan: true, q1: "100", trungVi: "120.5", q3: "130", soGoi: 5, soNcc: 4, sauMoc: {}, khopBanLuu: true };
    expect(chuDai(d, "kg")).toBe("Q1 100,00 · trung vị 120,50 · Q3 130,00 VND/kg (5 gói, 4 nhà cung cấp)");
    expect(chuDai({ ...d, duSan: false, q1: null, trungVi: null, q3: null }, "kg")).not.toMatch(/\d+,\d\d/u);
    expect(chuDai({ ...d, sauMoc: { ANH_XA: 2, QUY_DOI: 0 } }, "kg")).toContain("2 ánh xạ");
    expect(chuDai({ ...d, khopBanLuu: false }, "kg")).toContain("KHÁC bản lưu");
  });
});
