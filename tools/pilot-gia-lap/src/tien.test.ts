import { describe, expect, it } from "vitest";
import { SO_LE_HE_SO, SO_LE_TIEN, docSo, lamTron, vietSo } from "@trustprocure/danh-gia";
import { congTien, dinhDangVnd, donGiaChao, phanTram, soSanhTien, thanhTien } from "./tien.js";

describe("tiền — số nguyên lớn, không số thực", () => {
  it("thành tiền: số lượng bốn chữ số lẻ × đơn giá nguyên, hai chữ số lẻ", () => {
    expect(thanhTien("20.0000", "12000000")).toBe("240000000.00");
    expect(thanhTien("0.5000", "3")).toBe("1.50");
    expect(thanhTien("1.2345", "1")).toBe("1.23");
    expect(thanhTien("1.2350", "1")).toBe("1.24");
  });

  it("cộng không trôi như số thực: 0,1 + 0,2 = 0,30", () => {
    expect(congTien(["0.10", "0.20"])).toBe("0.30");
    expect(congTien(["999999999999.99", "0.01"])).toBe("1000000000000.00");
    expect(congTien([])).toBe("0.00");
  });

  it("đơn giá chào làm tròn tới 10 đồng, hệ số là phần nghìn nguyên", () => {
    expect(donGiaChao("12000000", 970)).toBe("11640000");
    expect(donGiaChao("6500", 1020)).toBe("6630");
    expect(donGiaChao("6500", 970)).toBe("6310");
    expect(donGiaChao("45000", 1000)).toBe("45000");
    expect(() => donGiaChao("45000", 97.5)).toThrow(RangeError);
    expect(() => donGiaChao("45000", 2000)).toThrow(RangeError);
  });

  it("so sánh và định dạng", () => {
    expect(soSanhTien("10.00", "9.99")).toBeGreaterThan(0);
    expect(soSanhTien("9.99", "10")).toBeLessThan(0);
    expect(soSanhTien("10.0", "10.00")).toBe(0);
    expect(dinhDangVnd("1440000000.00")).toBe("1.440.000.000");
    expect(dinhDangVnd("1234.50")).toBe("1.234,50");
    expect(phanTram("97.00", "100.00")).toBe("97,0%");
    expect(phanTram("1.00", "0.00")).toBe("—");
  });

  it("từ chối hình dạng lạ thay vì đoán", () => {
    expect(() => thanhTien("1,5", "1")).toThrow(RangeError);
    expect(() => congTien(["1.234"])).toThrow(RangeError);
    expect(() => thanhTien("1", "1.5")).toThrow(RangeError);
  });
});

// ==============================================================================================
// [S1.9181 / khoản 218] BẢN THỨ BA CỦA PHÉP THU VỀ XU PHẢI LÀ CÙNG MỘT LUẬT VỚI SẢN PHẨM
//
// Kho có ba chỗ thu `lượng × đơn giá` về hai chữ số: `apps/web/src/so-tien.ts` (trang nộp thầu),
// `lamTron` của `@trustprocure/danh-gia` (ghim bằng `pg_catalog.round(x, 2)` chạy thật ở
// `nua-xu.int.test.ts`), và `thanhTien` ở đây — tệp này từng khai *nửa-lên*. Trên miền không âm
// mà `SO_LUONG`/`DON_GIA` cưỡng chế, nửa-lên và nửa-ra-xa-0 là MỘT hàm; hai luật chỉ tách nhau ở
// số âm, và số âm không vào được. Khối này đo điều ấy thay vì đọc nó: khớp `lamTron` ở cả 100
// phần dư và ở bảng ca nửa xu, và dấu trừ bị từ chối — nên vế duy nhất hai luật khác nhau không
// có đầu vào. Bộ giả lập tự tính `amount` rồi so với bảng của sản phẩm *"tới từng chữ số"*
// (`chay-kich-ban.ts`): một luật lệch ở đây là một phép so tự cãi mình.
// ==============================================================================================
describe("[S1.9181 / khoản 218] thanhTien của bộ giả lập khớp lamTron của @trustprocure/danh-gia", () => {
  function cuaSanPham(luong: string, donGia: string): string {
    const a = docSo(luong, SO_LE_HE_SO);
    const b = docSo(donGia, 0);
    if (a === null || b === null) throw new Error("ca test sai dạng");
    return vietSo(lamTron(a * b, SO_LE_HE_SO, SO_LE_TIEN), SO_LE_TIEN);
  }

  it("khớp ở cả 100 phần dư của lượng × đơn giá mod 100", () => {
    for (let i = 0; i < 100; i++) {
      const luong = `0.${String(i).padStart(4, "0")}`;
      expect(thanhTien(luong, "1"), `phần dư ${String(i)}`).toBe(cuaSanPham(luong, "1"));
    }
  });

  it.each([
    ["0.0050", "1", "0.01"],
    ["0.0049", "1", "0.00"],
    ["0.0051", "1", "0.01"],
    ["0.0150", "1", "0.02"],
    ["0.0025", "2", "0.01"],
    ["1.2345", "2", "2.47"],
    ["1.2345", "7", "8.64"],
    ["0.3333", "3", "1.00"],
    ["999999999999.9999", "1", "1000000000000.00"],
  ])("bảng ca nửa xu: %s × %s = %s ở cả hai bản", (sl, dg, mong) => {
    expect(thanhTien(sl, dg)).toBe(mong);
    expect(cuaSanPham(sl, dg)).toBe(mong);
  });

  it("dấu trừ bị từ chối ở cả hai đầu vào — vế ÂM của luật (chỗ nửa-lên khác nửa-ra-xa-0) không có đầu vào", () => {
    expect(() => thanhTien("-0.0050", "1")).toThrow(RangeError);
    expect(() => thanhTien("0.0050", "-1")).toThrow(RangeError);
    // Luật của sản phẩm ở vế ấy: −0.0050 → −0.01 (ra xa 0), không phải 0.00 (nửa-lên).
    expect(cuaSanPham("-0.0050", "1")).toBe("-0.01");
  });
});
