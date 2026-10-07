// [S1.279 / S4.7a / L8] Lõi TCO: luật kiểm phiên bản lúc chấm, hai công thức quy đổi (chính xác, làm tròn một lần), và ô thiếu gọi
// tên. Hàm thuần — mọi ca chạy không CSDL.
import { describe, expect, it } from "vitest";
import { tinhChiPhiHieuDung, type ThanhPhanChinhSach } from "./chi-phi-hieu-dung.js";
import {
  THAM_SO_TRONG,
  chiPhiThanhToan,
  chiPhiTre,
  dauVaoTco,
  docNhomTco,
  kiemChinhSachTco,
  laThieuOKhai,
  type OKhai,
  type ThamSoTco,
} from "./tco.js";

const tien = (ma: string, heSo = "1.0000"): ThanhPhanChinhSach => ({ ma, donVi: "TIEN", heSo });
const DU_THAM_SO: ThamSoTco = { chiPhiVonNam: "0.12", ngayThanhToanChuan: "60", tyLeTreNgay: "0.001" };
const DU_MA = [tien("gia"), tien("van_chuyen"), tien("nhap_khau"), tien("chi_phi_thanh_toan"), tien("chi_phi_tre")];
const O_DU: OKhai = {
  tongTien: "1000000.00",
  phiVanChuyen: "25000.00",
  chiPhiNhapKhau: "0.00",
  soNgayThanhToan: 30,
  soNgayGiaoKhai: 20,
};

describe("[INV-L8] kiemChinhSachTco — phiên bản chấm được hay không, gọi tên mã", () => {
  it("đủ năm mã có nguồn, hệ số 1 viết nhiều cách, đủ tham số ⇒ chấm được", () => {
    expect(kiemChinhSachTco(DU_MA, DU_THAM_SO, 14)).toBeNull();
    expect(kiemChinhSachTco([tien("gia", "1"), tien("van_chuyen", "1.0")], THAM_SO_TRONG, null)).toBeNull();
    // Luồng MVP1: chỉ `gia`, không tham số, không số ngày giao.
    expect(kiemChinhSachTco([tien("gia")], THAM_SO_TRONG, null)).toBeNull();
  });

  it("điểm phi giá, `chat_luong`, `thue`, mã lạ ⇒ THANH_PHAN_CHUA_CO_NGUON gọi đúng mã", () => {
    const diem: ThanhPhanChinhSach = { ma: "kt", donVi: "DIEM", heSo: "2.0000" };
    expect(kiemChinhSachTco([tien("gia"), diem], THAM_SO_TRONG, null)).toMatchObject({ lyDo: "THANH_PHAN_CHUA_CO_NGUON", ma: "kt" });
    const cl = kiemChinhSachTco([tien("gia"), tien("chat_luong")], THAM_SO_TRONG, null);
    expect(cl).toMatchObject({ lyDo: "THANH_PHAN_CHUA_CO_NGUON", ma: "chat_luong" });
    expect(cl?.cau).toContain("S5");
    const thue = kiemChinhSachTco([tien("gia"), tien("thue")], THAM_SO_TRONG, null);
    expect(thue).toMatchObject({ lyDo: "THANH_PHAN_CHUA_CO_NGUON", ma: "thue" });
    expect(thue?.cau).toContain("ADR-097");
    expect(kiemChinhSachTco([tien("gia"), tien("bao_hanh")], THAM_SO_TRONG, null)).toMatchObject({
      lyDo: "THANH_PHAN_CHUA_CO_NGUON",
      ma: "bao_hanh",
    });
  });

  it("hệ số mã tiền khác 1, trùng mã, thiếu `gia` ⇒ CHINH_SACH_TCO_SAI", () => {
    expect(kiemChinhSachTco([tien("gia", "2.0000")], THAM_SO_TRONG, null)).toMatchObject({ lyDo: "CHINH_SACH_TCO_SAI", ma: "gia" });
    expect(kiemChinhSachTco([tien("gia"), tien("van_chuyen", "0.9999")], THAM_SO_TRONG, null)).toMatchObject({
      lyDo: "CHINH_SACH_TCO_SAI",
      ma: "van_chuyen",
    });
    expect(kiemChinhSachTco([tien("gia"), tien("gia")], THAM_SO_TRONG, null)).toMatchObject({ lyDo: "CHINH_SACH_TCO_SAI", ma: "gia" });
    expect(kiemChinhSachTco([tien("van_chuyen")], THAM_SO_TRONG, null)).toMatchObject({ lyDo: "CHINH_SACH_TCO_SAI", ma: null });
  });

  it("mã quy đổi thiếu tham số, hay `chi_phi_tre` thiếu số ngày giao của gói ⇒ THANH_PHAN_CHUA_CO_NGUON gọi mã ấy", () => {
    const tt = [tien("gia"), tien("chi_phi_thanh_toan")];
    expect(kiemChinhSachTco(tt, { ...DU_THAM_SO, chiPhiVonNam: null }, null)).toMatchObject({ ma: "chi_phi_thanh_toan" });
    expect(kiemChinhSachTco(tt, { ...DU_THAM_SO, ngayThanhToanChuan: null }, null)).toMatchObject({ ma: "chi_phi_thanh_toan" });
    const tre = [tien("gia"), tien("chi_phi_tre")];
    expect(kiemChinhSachTco(tre, { ...DU_THAM_SO, tyLeTreNgay: null }, 14)).toMatchObject({ ma: "chi_phi_tre" });
    expect(kiemChinhSachTco(tre, DU_THAM_SO, null)).toMatchObject({ lyDo: "THANH_PHAN_CHUA_CO_NGUON", ma: "chi_phi_tre" });
    // Tham số thừa không làm hỏng gì: phiên bản khai tỷ lệ mà không bật mã thì vẫn chấm được.
    expect(kiemChinhSachTco([tien("gia")], DU_THAM_SO, null)).toBeNull();
  });
});

describe("[INV-L8] hai công thức quy đổi — chính xác, nửa-ra-xa-0, một lần", () => {
  it("chi phí thanh toán: (60 − 30) × 12 %/năm / 365 × 1 000 000 = 9 863,01 (9 863,0136…)", () => {
    expect(chiPhiThanhToan("1000000.00", 60, 30, "0.12")).toBe("9863.01");
  });
  it("chi phí thanh toán: trả muộn hơn kỳ chuẩn không là một khoản giảm trừ — 0", () => {
    expect(chiPhiThanhToan("1000000.00", 60, 90, "0.12")).toBe("0.00");
    expect(chiPhiThanhToan("1000000.00", 60, 60, "0.12")).toBe("0.00");
  });
  it("chi phí thanh toán: ca ĐÚNG nửa xu làm tròn RA XA 0; sát hai bên nửa xu đi về phía gần", () => {
    // 1 ngày × 50 %/năm / 365 × 3,65 = 0,005 đúng ⇒ 0,01 — một phép cắt cụt ra 0,00.
    expect(chiPhiThanhToan("3.65", 1, 0, "0.5")).toBe("0.01");
    // 1,83 / 365 = 0,00501… ⇒ 0,01; 1,82 / 365 = 0,00498… ⇒ 0,00.
    expect(chiPhiThanhToan("1.83", 1, 0, "1")).toBe("0.01");
    expect(chiPhiThanhToan("1.82", 1, 0, "1")).toBe("0.00");
  });
  it("chi phí trễ: (20 − 14) × 0,1 %/ngày × 1 000 000 = 6 000,00; giao sớm hơn yêu cầu = 0", () => {
    expect(chiPhiTre("1000000.00", 14, 20, "0.001")).toBe("6000.00");
    expect(chiPhiTre("1000000.00", 14, 10, "0.001")).toBe("0.00");
  });
  it("chi phí trễ: sáu chữ số lẻ của tỷ lệ đi trọn vào phép tính", () => {
    // 3 × 0,000125 × 333,33 = 0,12499875 ⇒ 0,12.
    expect(chiPhiTre("333.33", 0, 3, "0.000125")).toBe("0.12");
  });
  it("tỷ lệ hay tổng không đọc được ⇒ NÉM, không ra một con số (bộ đọc SQL và CHECK đã lọc trước)", () => {
    expect(() => chiPhiTre("1000000.00", 14, 20, "0.0000001")).toThrow(RangeError);
    expect(() => chiPhiThanhToan("abc", 60, 30, "0.12")).toThrow(RangeError);
  });
});

describe("[INV-L8] dauVaoTco — mỗi mã một nguồn; ô thiếu gọi tên, không lấy 0", () => {
  it("đủ ô ⇒ năm giá trị, hai mã quy đổi mang phép tính; tổng là phép cộng của chúng", () => {
    const kq = dauVaoTco(DU_MA, DU_THAM_SO, 14, O_DU);
    if (laThieuOKhai(kq)) throw new Error("không được thiếu");
    expect(kq.dauVao).toEqual([
      { ma: "gia", giaTri: "1000000.00" },
      { ma: "van_chuyen", giaTri: "25000.00" },
      { ma: "nhap_khau", giaTri: "0.00" },
      { ma: "chi_phi_thanh_toan", giaTri: "9863.01" },
      { ma: "chi_phi_tre", giaTri: "6000.00" },
    ]);
    expect(kq.nguon.get("chi_phi_thanh_toan")).toEqual({ coSo: "1000000.00", ngayKhai: "30", ngayChuan: "60", tyLe: "0.12" });
    expect(kq.nguon.get("chi_phi_tre")).toEqual({ coSo: "1000000.00", ngayKhai: "20", ngayYeuCau: "14", tyLe: "0.001" });
    const cp = tinhChiPhiHieuDung(DU_MA, kq.dauVao);
    expect(cp).toMatchObject({ effectiveCost: "1040863.01" });
  });

  it("ô vắng của một mã chính sách bật ⇒ báo giá ấy không có hạng, mọi mã thiếu được kể theo thứ tự chính sách", () => {
    const kq = dauVaoTco(DU_MA, DU_THAM_SO, 14, { ...O_DU, phiVanChuyen: null, soNgayGiaoKhai: null });
    expect(kq).toEqual({ maThieu: ["van_chuyen", "chi_phi_tre"] });
  });

  it("tổng không đọc được ⇒ `gia` thiếu; mã quy đổi có ô của chính nó thì KHÔNG bị kể là thiếu", () => {
    expect(dauVaoTco(DU_MA, DU_THAM_SO, 14, { ...O_DU, tongTien: null })).toEqual({ maThieu: ["gia"] });
  });

  it("chính sách chỉ `gia`: ô TCO thừa trong phong bì không được đọc — luồng MVP1 không đổi", () => {
    const kq = dauVaoTco([tien("gia")], THAM_SO_TRONG, null, O_DU);
    expect(kq).toEqual({ dauVao: [{ ma: "gia", giaTri: "1000000.00" }], nguon: new Map() });
    expect(dauVaoTco([tien("gia")], THAM_SO_TRONG, null, { ...O_DU, tongTien: null })).toEqual({ maThieu: ["gia"] });
  });

  it("[rà soát §S1.279 — CAO-3] mã quy đổi vượt trần `numeric(18, 2)` ⇒ mã ấy thiếu, không một con số không ghi được", () => {
    const tre = [tien("gia"), tien("chi_phi_tre")];
    // 3650 ngày × 10 %/ngày × gần 10^16 ⇒ gấp 365 lần trần.
    expect(
      dauVaoTco(tre, { ...DU_THAM_SO, tyLeTreNgay: "0.1" }, 0, { ...O_DU, tongTien: "9999999999999999.99", soNgayGiaoKhai: 3650 }),
    ).toEqual({ maThieu: ["chi_phi_tre"] });
    // Sát trần vẫn tính: 9 999 999 999 999 999,99 × 0,1 % = 9 999 999 999 999,99… ⇒ dưới trần.
    const kq = dauVaoTco(tre, DU_THAM_SO, 0, { ...O_DU, tongTien: "9999999999999999.99", soNgayGiaoKhai: 1 });
    expect(laThieuOKhai(kq)).toBe(false);
  });

  it("mã không có nguồn tới được đây là gọi sai thứ tự ⇒ NÉM", () => {
    expect(() => dauVaoTco([tien("gia"), tien("chat_luong")], THAM_SO_TRONG, null, O_DU)).toThrow(RangeError);
  });
});

describe("[INV-L8] mã trùng tên một thuộc tính của nguyên mẫu đối tượng", () => {
  it("`constructor`, `toString` ⇒ từ chối gọi tên như mọi mã lạ, không câu lẫn thân hàm (rà soát §S1.279 — THẤP-6)", () => {
    for (const ma of ["constructor", "toString", "__proto__"]) {
      const loi = kiemChinhSachTco([tien("gia"), tien(ma)], THAM_SO_TRONG, null);
      expect(loi?.lyDo, ma).toBe("THANH_PHAN_CHUA_CO_NGUON");
      expect(loi?.cau, ma).toContain("không có nguồn dữ liệu");
      expect(loi?.cau, ma).not.toContain("native code");
    }
  });
});

describe("docNhomTco — đọc ba chuỗi của cột `tco`", () => {
  it("NULL, không phải object, hay khoá không phải chuỗi ⇒ khoá ấy null", () => {
    expect(docNhomTco(null)).toEqual(THAM_SO_TRONG);
    expect(docNhomTco([1])).toEqual(THAM_SO_TRONG);
    expect(docNhomTco({ chi_phi_von_nam: 0.12, ty_le_tre_ngay: "0.001" })).toEqual({ ...THAM_SO_TRONG, tyLeTreNgay: "0.001" });
    expect(docNhomTco({ chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "60" })).toEqual({
      chiPhiVonNam: "0.12",
      ngayThanhToanChuan: "60",
      tyLeTreNgay: null,
    });
  });
});
