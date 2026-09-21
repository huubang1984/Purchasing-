// ==============================================================================================
// [S1.99 / khoản 206] PHÉP ĐO CHO SỐ TIỀN CỦA TRANG NỘP THẦU
//
// Vế trung tâm của tệp này là `describe("hiển thị và đọc vào phải là một")`: nó lấy ĐẦU RA của
// hàm hiển thị rồi đưa thẳng vào hàm đọc, và đòi ra lại đúng con số ban đầu. Đó là vế mà khiếm
// khuyết đã vi phạm — trang in `1.500.000,00` rồi đọc `1.500` thành một — và nó là vế duy nhất ở
// đây không thể qua được bằng cách chép lại chính lỗi ấy vào cả hai phía... trừ khi ai đó đổi cả
// hai phía cùng lúc, nên bảng ca cụ thể ngay dưới ghim từng dạng viết một.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { cong, donGiaNguoiGo, nhomSo, sangNguyen, thanhTien, tien } from "./so-tien.js";

describe("[S1.99 / khoản 206] đơn giá người gõ", () => {
  // Cột phải là thứ NGƯỜI VIỆT gõ định nói. Trang tự in dạng nhóm nghìn, nên nhận lại dạng ấy.
  it.each([
    ["1500000", "1500000"],
    ["1.500.000", "1500000"],
    ["1.500", "1500"],
    ["500", "500"],
    ["1.000.000.000", "1000000000"],
    ["  1.500  ", "1500"],
    ["0", "0"],
  ])("đọc %s thành %s", (go, mong) => {
    expect(donGiaNguoiGo(go)).toBe(mong);
  });

  // Mọi dạng mơ hồ phải bị TỪ CHỐI, không được đoán. `12.5` là ca đã im lặng ra `12`.
  it.each([
    ["12.5"],
    ["1.50"],
    ["1.5000"],
    ["12,5"],
    ["1,500,000"],
    ["1.500.00"],
    ["1234.567"],
    [""],
    ["   "],
    ["-1500"],
    ["1e6"],
    ["1 500"],
    ["abc"],
  ])("từ chối %s", (go) => {
    expect(donGiaNguoiGo(go)).toBeNull();
  });
});

describe("[S1.99 / khoản 206] hiển thị và đọc vào phải là một", () => {
  // Nếu một ngày ai đó đổi `nhomSo` sang dấu phẩy mà quên `donGiaNguoiGo`, vế này đỏ.
  it.each([["1"], ["12"], ["500"], ["1500"], ["1500000"], ["1000000000"], ["123456789"]])(
    "nhomSo(%s) đọc ngược lại ra chính nó",
    (n) => {
      expect(donGiaNguoiGo(nhomSo(n))).toBe(n);
    },
  );

  it("phần nguyên của một chuỗi tiền hiển thị đọc ngược lại được", () => {
    // `tien` in `1500000.00` thành `1.500.000,00`; phần trước dấu phẩy phải đọc lại ra 1500000.
    const hien = tien("1500000.00");
    expect(hien).toBe("1.500.000,00");
    expect(donGiaNguoiGo(hien.split(",")[0] ?? "")).toBe("1500000");
  });
});

describe("[S1.99 / khoản 206] chuỗi máy sinh ra", () => {
  it.each([
    ["2.0000", 4, 20000n],
    ["2", 4, 20000n],
    ["0.5000", 4, 5000n],
    ["1500000.00", 2, 150000000n],
    ["7", 0, 7n],
  ])("sangNguyen(%s, %i) = %s", (s, soLe, mong) => {
    expect(sangNguyen(s, soLe)).toBe(mong);
  });

  // Cắt cụt ÂM THẦM là khiếm khuyết cùng lớp ở phía chuỗi máy: `1.500` với soLe=0 từng ra `1n`.
  it.each([
    ["1.500", 0],
    ["12.5", 0],
    ["1.00001", 4],
    ["0.123", 2],
  ])("từ chối %s ở soLe=%i thay vì cắt cụt", (s, soLe) => {
    expect(sangNguyen(s, soLe)).toBeNull();
  });
});

describe("[S1.99 / khoản 206] thành tiền và cộng", () => {
  it("nhân số lượng thập phân với đơn giá nguyên, không qua double", () => {
    expect(thanhTien("2.0000", "1500000")).toBe("3000000.00");
    expect(thanhTien("0.5000", "1500001")).toBe("750000.50");
    // 0.1 + 0.2 của `double` là 0.30000000000000004; đường BigInt không có chỗ cho sai số ấy.
    expect(cong(["0.10", "0.20"])).toBe("0.30");
  });

  it("một đơn giá dạng người gõ phải đi qua donGiaNguoiGo TRƯỚC, không vào thẳng", () => {
    // Đây là hình dạng lỗi cũ, ghim lại để không ai nối thẳng ô nhập vào `thanhTien` lần nữa.
    expect(thanhTien("1.0000", "1.500")).toBeNull();
    const chuan = donGiaNguoiGo("1.500");
    expect(chuan).toBe("1500");
    expect(thanhTien("1.0000", chuan ?? "")).toBe("1500.00");
  });

  it("một dòng không đọc được làm cả tổng không đọc được", () => {
    expect(cong(["1500.00", null])).toBeNull();
    expect(cong(["1500.00", "abc"])).toBeNull();
  });
});
