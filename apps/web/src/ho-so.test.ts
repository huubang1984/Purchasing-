// [S1.287 / S3.7a1 / ADR-081] Hàm thuần của màn `/ho-so` — kiểm form trước khi gửi, che số tài khoản, dòng tóm tắt.
import { describe, expect, it } from "vitest";
import { cheSoTaiKhoan, chuanHoaSoTaiKhoan, dongPhienBan, kiemHoSo, tachDanhSach, TRAN_DANH_SACH_HO_SO, type ONhap } from "./ho-so.js";

const DU: ONhap = {
  legalName: "  Công ty Thép A ",
  taxCode: "0101010101",
  nguoiDaiDien: "Ông B",
  diaChi: "Hà Nội",
  nganHang: "VCB",
  soTaiKhoan: "0011.2233-4455",
  chungNhan: "ISO 9001\r\n\r\n  ISO 14001  \n",
  nhomHang: "",
};

describe("[S1.287 / S3.7a1] ho-so — kiểm form", () => {
  it("form đủ ⇒ thân đã cắt, số tài khoản chỉ còn chữ số, danh sách một mục mỗi dòng (bỏ dòng trống)", () => {
    expect(kiemHoSo(DU)).toEqual({
      loi: null,
      than: {
        legalName: "Công ty Thép A",
        taxCode: "0101010101",
        nguoiDaiDien: "Ông B",
        diaChi: "Hà Nội",
        nganHang: "VCB",
        soTaiKhoan: "001122334455",
        chungNhan: ["ISO 9001", "ISO 14001"],
        nhomHang: [],
      },
    });
  });

  it("mỗi ô thiếu hay sai ra câu lỗi gọi tên Ô — theo thứ tự trên màn, không nhắc lại giá trị", () => {
    const loi = (o: Partial<ONhap>): string | null => kiemHoSo({ ...DU, ...o }).loi;
    expect(loi({ legalName: " " })).toBe("Thiếu tên pháp lý.");
    expect(loi({ taxCode: "" })).toBe("Thiếu mã số thuế.");
    expect(loi({ taxCode: "01010101" })).toMatch(/^Mã số thuế phải là 10 chữ số/u);
    expect(loi({ taxCode: "0101010101-001" })).toBeNull();
    expect(loi({ nguoiDaiDien: "" })).toBe("Thiếu người đại diện.");
    expect(loi({ soTaiKhoan: "12345" })).toBe("Số tài khoản phải gồm 6–20 chữ số.");
    expect(loi({ soTaiKhoan: "12345a789" })).toBe("Số tài khoản phải gồm 6–20 chữ số.");
    expect(loi({ soTaiKhoan: "1".repeat(21) })).toBe("Số tài khoản phải gồm 6–20 chữ số.");
    expect(loi({ diaChi: "x".repeat(1001) })).toBe("Địa chỉ dài quá.");
    expect(loi({ chungNhan: Array.from({ length: TRAN_DANH_SACH_HO_SO + 1 }, (_, i) => `CN${String(i)}`).join("\n") })).toBe(
      `Tối đa ${String(TRAN_DANH_SACH_HO_SO)} mục chứng nhận.`,
    );
    expect(loi({ nhomHang: "y".repeat(201) })).toBe("Một mục nhóm hàng dài quá.");
    // Trần là BYTE, không ký tự: 100 chữ có dấu (2 byte) vượt trần 200 byte.
    expect(loi({ nganHang: "ă".repeat(101) })).toBe("Ngân hàng dài quá.");
  });

  it("chuẩn hoá và tách danh sách", () => {
    expect(chuanHoaSoTaiKhoan(" 12 34.56-78 ")).toBe("12345678");
    expect(tachDanhSach("a\r\nb\n\n c ")).toEqual(["a", "b", "c"]);
  });
});

describe("[S1.287 / S3.7a1] ho-so — hiện phiên bản đã nộp", () => {
  it("số tài khoản CHỈ hiện bốn số cuối đã che; giá trị lạ hiện `—`, không ném", () => {
    expect(cheSoTaiKhoan("6789")).toBe("•••• 6789");
    expect(cheSoTaiKhoan("123456789")).toBe("—");
    expect(cheSoTaiKhoan(null)).toBe("—");
    const dong = dongPhienBan({ thuTu: 3, legalName: "Thép A", taxCode: "0101010101", soTaiKhoanCuoi: "6789", chungNhan: ["ISO 9001"], nhomHang: [] });
    expect(dong).toContainEqual(["Phiên bản", "#3"]);
    expect(dong).toContainEqual(["Số tài khoản", "•••• 6789"]);
    expect(dong).toContainEqual(["Nhóm hàng", "—"]);
    expect(dongPhienBan(null)).toEqual([]);
  });
});
