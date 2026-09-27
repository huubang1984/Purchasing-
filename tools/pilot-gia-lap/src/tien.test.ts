import { describe, expect, it } from "vitest";
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
