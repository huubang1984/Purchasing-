// ==============================================================================================
// [S1.260 / S4.5c1] PHÉP ĐO CHO CHỮ BENCHMARK CỦA MÀN `/mo-thau` — nhãn theo đúng chữ spec S4 §4.6, thành phần dải, độ phủ theo giá
// trị (§2.5 ⒁), chữ của dải và của các trạng thái không nhãn.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import {
  chuCoMocNgoai,
  chuCotNgoai,
  chuDai,
  chuDaiNgoai,
  chuLech,
  chuMocNgoai,
  chuNhan,
  chuNhanNgoai,
  chuThanhPhan,
  chuTrangThai,
  doPhu,
  ngayVn,
  soDai,
  tomTatNhan,
  type DongBenchmark,
  type DongNgoai,
} from "./benchmark.js";

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

  it("[rà soát S4.5c1] phong bì là chữ của nhà cung cấp: thành tiền dạng số đọc qua chữ của nó; dạng khác không phần trăm, không ném", () => {
    expect(doPhu(ba, [{ lineNo: 1, amount: 600 }, { lineNo: 2, amount: "300.00" }, { lineNo: 3, amount: 100 }]).phanTramGiaTri).toBe("70,0");
    for (const amount of [null, undefined, { x: 1 }, true, 1e21, -5]) {
      expect(doPhu(ba, [{ lineNo: 1, amount }]).phanTramGiaTri, JSON.stringify(amount) ?? "undefined").toBeNull();
    }
    expect(doPhu(ba, [{ lineNo: "1", amount: "600.00" }, { lineNo: 2, amount: "400.00" }]).phanTramGiaTri, "số dòng dạng chữ không khớp dòng nào").toBe("0,0");
  });
});

describe("[S1.260 / S4.5c1] tóm tắt cho bảng xếp hạng, trạng thái không nhãn, chữ của dải", () => {
  it("tóm tắt đếm theo nhóm, tách bất thường cao và thấp, bỏ nhóm rỗng", () => {
    expect(
      tomTatNhan([voi({}), voi({ nhan: "LECH_CAO", chieu: "TREN" }), voi({ nhan: "LECH_CAO", chieu: "DUOI" }), voi({ nhan: "KHONG_DO_DUOC" })]),
    ).toBe("1 trong dải · 1 bất thường (cao) · 1 thấp bất thường · 1 không đo được");
    expect(tomTatNhan([])).toBe("—");
  });

  it("năm trạng thái không nhãn có câu; CO thì null", () => {
    expect(chuTrangThai({ trangThai: "CO" })).toBeNull();
    expect(chuTrangThai({ trangThai: "THU_LAI", rfqStatus: "UNSEALED" })).toContain("Bấm đọc lại");
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

describe("[S1.276 / S4.6b] lịch sử mua ngoài hệ thống và mốc ngoài — nhãn RIÊNG ghi rõ nguồn, mốc chỉ độ lệch", () => {
  const NGOAI: DongNgoai = {
    bidVersionId: "b-1",
    lineNo: 1,
    nhan: "BINH_THUONG",
    chieu: null,
    soDong: 7,
    soGoi: 5,
    soNcc: 4,
    soLoaiTienTe: 0,
    soLoaiKhongQuyDoi: 0,
  };
  const ngoai = (doi: Partial<DongNgoai>): DongNgoai => ({ ...NGOAI, ...doi });

  it("mọi nhãn ngoài nói nguồn; không câu nào là chữ của dải nội bộ; thấp bất thường dẫn tới làm rõ, không căn cứ loại", () => {
    for (const [nhan, chieu] of [
      ["BINH_THUONG", null],
      ["LECH_VUA", "TREN"],
      ["LECH_VUA", "DUOI"],
      ["LECH_CAO", "TREN"],
      ["LECH_CAO", "DUOI"],
      ["CHUA_DU_LICH_SU", null],
    ] as const) {
      const c = chuNhanNgoai(ngoai({ nhan, chieu }));
      expect(c, nhan).toContain("lịch sử mua ngoài hệ thống, do người quản lý dữ liệu nhập");
      expect(c, nhan).not.toContain("nội bộ");
      expect(c, nhan).not.toMatch(/sạch|tốt/u);
    }
    expect(chuNhanNgoai(NGOAI)).toBe(
      "trong dải lịch sử mua ngoài hệ thống, do người quản lý dữ liệu nhập (5 lần mua theo ngày và nhà cung cấp, 4 nhà cung cấp)",
    );
    const duoi = chuNhanNgoai(ngoai({ nhan: "LECH_CAO", chieu: "DUOI" }));
    expect(duoi).toMatch(/^Thấp bất thường/u);
    expect(duoi).toContain("không phải căn cứ loại");
    expect(chuNhanNgoai(ngoai({ nhan: "LECH_VUA", chieu: "DUOI" }))).toMatch(/^thấp hơn/u);
    expect(chuNhanNgoai(ngoai({ nhan: "NHAN_MOI" }))).toBe("NHAN_MOI");
  });

  it("cột Lịch sử ngoài: dòng không đo được là gạch; bản lưu trước S4.6b nói ra; không có hàng thì gạch", () => {
    expect(chuCotNgoai([NGOAI], "b-1", 1, false)).toBe("—");
    expect(chuCotNgoai(null, "b-1", 1, true)).toBe("bản benchmark này tính trước khi có lịch sử ngoài — xem ở «Xem dải»");
    expect(chuCotNgoai([NGOAI], "b-2", 1, true)).toBe("—");
    expect(chuCotNgoai([NGOAI], "b-1", 1, true)).toBe(chuNhanNgoai(NGOAI));
  });

  it("cờ mốc ngoài: nguồn và ngày theo kiểu Việt Nam, không con số; độ lệch có dấu, dấu phẩy thập phân", () => {
    expect(chuCoMocNgoai(undefined)).toBe("—");
    expect(chuCoMocNgoai({ nguon: "Bảng giá nhà máy", ngayHieuLuc: "2026-01-05" })).toBe(
      "có mốc ngoài (Bảng giá nhà máy, hiệu lực 05/01/2026) — số và độ lệch ở «Xem dải»",
    );
    expect(ngayVn("2026-1-5")).toBe("2026-1-5");
    expect(chuLech("12.3")).toBe("+12,3%");
    expect(chuLech("-4.5")).toBe("−4,5%");
    expect(chuLech("0.0")).toBe("0,0%");
    expect(chuLech(null)).toBe("—");
  });

  it("dải ngoài của Xem dải: số khi đủ sàn, không số khi dưới sàn; cửa sổ, ba nguồn đầu, loại, ghi/rút sau mốc, lệch bản lưu", () => {
    const d = {
      tienTe: "VND",
      cuaSoTu: "2025-10-01",
      denNgay: "2026-10-01",
      duSan: true,
      q1: "100",
      trungVi: "110.5",
      q3: "120",
      soDong: 9,
      soGoi: 6,
      soNcc: 3,
      soLoaiTienTe: 2,
      soLoaiKhongQuyDoi: 1,
      nguon: ["A", "B", "C", "D", "E"],
      sauMoc: { GHI: 2, RUT: 1 },
      khopBanLuu: false,
    };
    const c = chuDaiNgoai(d, "kg");
    expect(c).toMatch(/^Q1 100,00 · trung vị 110,50 · Q3 120,00 VND\/kg \(9 dòng, 6 lần mua theo ngày và nhà cung cấp, 3 nhà cung cấp\)/u);
    expect(c).toContain("Ngày mua từ 01/10/2025 tới 01/10/2026");
    expect(c).toContain("Nguồn (lời khai của người nhập): A; B; C; và 2 nguồn khác");
    expect(c).toContain("Đã loại 2 khác tiền tệ, 1 không quy đổi được đơn vị");
    expect(c).toContain("2 dòng nhập SAU mốc mở giá (dải này không dùng); 1 dòng đã vào dải bị rút SAU mốc mở giá (dải này vẫn dùng)");
    expect(c).toContain("CẢNH BÁO: nhãn ngoài tính lại KHÁC bản lưu");
    const duoiSan = chuDaiNgoai({ ...d, duSan: false, q1: null, trungVi: null, q3: null, nguon: [], sauMoc: { GHI: 0, RUT: 0 }, soLoaiTienTe: 0, soLoaiKhongQuyDoi: 0, khopBanLuu: null }, null);
    expect(duoiSan).toBe(
      "chưa đủ lịch sử ngoài — không con số nào (9 dòng, 6 lần mua theo ngày và nhà cung cấp, 3 nhà cung cấp). Ngày mua từ 01/10/2025 tới 01/10/2026",
    );
  });

  it("mốc ngoài của Xem dải: con số theo đơn vị gốc, nguồn, ngày, KHÔNG nhãn; không có mốc; mốc rút sau mốc mở giá vẫn là mốc", () => {
    const m = { tienTe: "VND", moc: { nguon: "Báo giá Hòa Bình", ngayHieuLuc: "2026-09-01", donGiaQuyDoi: "15500" }, ghiSauMoc: 0, rutSauMoc: false };
    expect(chuMocNgoai(m, "kg")).toBe("15.500,00 VND/kg (Báo giá Hòa Bình, hiệu lực 01/09/2026) — chỉ để so độ lệch, không sinh nhãn");
    expect(chuMocNgoai({ ...m, rutSauMoc: true, ghiSauMoc: 1 }, "kg")).toContain(
      "Mốc này đã bị rút SAU mốc mở giá — vẫn là mốc của gói này. 1 mốc nhập SAU mốc mở giá (không dùng)",
    );
    expect(chuMocNgoai({ ...m, moc: null }, "kg")).toBe("không có mốc ngoài trong cửa sổ");
    expect(chuMocNgoai(m, "kg")).not.toMatch(/bất thường|lệch vừa|trong dải/u);
  });
});
