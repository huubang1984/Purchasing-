// [khoản 165] Hàm băm của dấu kiểm — thuần, không CSDL.
import { describe, expect, it } from "vitest";
import { DauKiemVongKhoaLechError, tinhDauKiemKhoa } from "./dau-kiem-vong-khoa.js";

describe("[khoản 165] dấu kiểm của một khoá", () => {
  const a = Buffer.alloc(32, 1);
  const b = Buffer.alloc(32, 2);

  it("tất định, 32 byte, và KHÁC cho hai khoá khác nhau", () => {
    expect(tinhDauKiemKhoa(a).equals(tinhDauKiemKhoa(Buffer.from(a)))).toBe(true);
    expect(tinhDauKiemKhoa(a)).toHaveLength(32);
    expect(tinhDauKiemKhoa(a).equals(tinhDauKiemKhoa(b))).toBe(false);
  });

  it("dấu kiểm KHÔNG chứa byte của khoá", () => {
    const khoa = Buffer.from("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", "hex");
    expect(tinhDauKiemKhoa(khoa).includes(khoa.subarray(0, 8))).toBe(false);
  });

  it("thông điệp lỗi chỉ nêu TÊN vòng và TÊN phiên bản", () => {
    const loi = new DauKiemVongKhoaLechError("TRUSTPROCURE_MASTER_KEYS", ["v1", "v2"]);
    expect(loi.message).toContain('"v1", "v2"');
    expect(loi.message).toContain("TRUSTPROCURE_MASTER_KEYS");
    expect(loi.name).toBe("DauKiemVongKhoaLechError");
  });
});
