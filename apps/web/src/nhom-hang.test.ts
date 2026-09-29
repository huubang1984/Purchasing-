import { describe, expect, it } from "vitest";
import { chuanMa, docNhomHang, hienDatNhomHang, loiMa, luaChonNhomHang, nhanNhomHangCuaGoi, nhanTrangThaiNhom, nutDoiTrangThai } from "./nhom-hang.js";

// [S1.9101 / S3.6a] Phép tính thuần của hai màn chạm nhóm hàng — `/nhom-hang` và ô chọn ở `/tao-thau`.

const DS = [
  { id: "a", ma: "THEP", ten: "Thép", conDung: true },
  { id: "b", ma: "CU", ten: "Cũ", conDung: false },
] as const;

describe("S3.6a — nhóm hàng trên màn", () => {
  it("docNhomHang bỏ phần tử sai hình dạng, không vẽ thứ nó không hiểu", () => {
    expect(docNhomHang({ nhomHang: [...DS, { id: 1, ma: "X", ten: "X", conDung: true }, null, { id: "c", ma: "Y", ten: "Y" }] })).toEqual(DS);
    expect(docNhomHang(null)).toEqual([]);
    expect(docNhomHang({ nhomHang: "khong" })).toEqual([]);
  });

  it("mã: cắt khoảng trắng, viết hoa; khuôn cùng CHECK của `9501` — chữ có dấu, ký tự đầu lạ, dài quá 32 bị nói trước", () => {
    expect(chuanMa("  thep-01 ")).toBe("THEP-01");
    expect(loiMa(" thep-01 ")).toBeNull();
    expect(loiMa("A".repeat(32))).toBeNull();
    expect(loiMa("A".repeat(33))).not.toBeNull();
    expect(loiMa("thép")).not.toBeNull();
    expect(loiMa("-THEP")).not.toBeNull();
    expect(loiMa("   ")).toBe("Nhập mã nhóm hàng.");
  });

  it("trạng thái và nút mỗi dòng: đang dùng ⇒ Ngừng dùng gửi `false`; đã ngừng ⇒ Dùng lại gửi `true`", () => {
    expect(nhanTrangThaiNhom(true)).toBe("đang dùng");
    expect(nhanTrangThaiNhom(false)).toBe("đã ngừng dùng");
    expect(nutDoiTrangThai(true)).toEqual({ nhan: "Ngừng dùng", conDungMoi: false });
    expect(nutDoiTrangThai(false)).toEqual({ nhan: "Dùng lại", conDungMoi: true });
  });

  it("ô chọn: dòng trống, rồi nhóm còn dùng; nhóm đã ngừng chỉ hiện khi gói đang giữ nó, có nhãn", () => {
    expect(luaChonNhomHang(DS, null)).toEqual([
      { value: "", nhan: "— chọn nhóm hàng —" },
      { value: "a", nhan: "THEP — Thép" },
    ]);
    expect(luaChonNhomHang(DS, "b").map((l) => l.nhan)).toEqual(["— chọn nhóm hàng —", "THEP — Thép", "CU — Cũ (đã ngừng dùng)"]);
  });

  it("nhóm của gói nói bằng lời; chưa có ⇒ null; id lạ ⇒ nói là không đọc được", () => {
    expect(nhanNhomHangCuaGoi(DS, "a")).toBe("THEP — Thép");
    expect(nhanNhomHangCuaGoi(DS, "b")).toBe("CU — Cũ (đã ngừng dùng)");
    expect(nhanNhomHangCuaGoi(DS, null)).toBeNull();
    expect(nhanNhomHangCuaGoi(DS, "z")).toBe("(nhóm hàng không đọc được)");
  });

  it("nút Đặt nhóm hàng chỉ ở tổ chức đã bật, gói DRAFT", () => {
    expect(hienDatNhomHang(true, "DRAFT")).toBe(true);
    expect(hienDatNhomHang(true, "PENDING_APPROVAL")).toBe(false);
    expect(hienDatNhomHang(false, "DRAFT")).toBe(false);
  });
});
