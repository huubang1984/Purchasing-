// [sổ nợ 41] `X-Forwarded-For` chỉ được tin từ một proxy đã khai, và chỉ phần proxy ấy ghi thêm.
import { describe, expect, it } from "vitest";
import { chuanHoaDiaChi, taoDanhSachTinCay, taoDocDiaChi } from "./dia-chi.js";

const yc = (socket: string, xff?: string | string[]) => ({ socket: { remoteAddress: socket }, headers: { "x-forwarded-for": xff } });

describe("[sổ nợ 41] địa chỉ người gọi", () => {
  it("không khai proxy ⇒ header bị BỎ QUA, luôn là socket (kể cả socket là 127.0.0.1)", () => {
    const doc = taoDocDiaChi([]);
    expect(doc(yc("127.0.0.1", "203.0.113.9"))).toBe("127.0.0.1");
    expect(doc(yc("::ffff:10.1.2.3", "203.0.113.9"))).toBe("10.1.2.3");
    expect(taoDocDiaChi([" "])(yc("10.0.0.1", "203.0.113.9"))).toBe("10.0.0.1");
  });

  it("socket là proxy tin cậy ⇒ lấy hop ngoài cùng bên PHẢI không thuộc danh sách; hop proxy bị bỏ qua", () => {
    const doc = taoDocDiaChi(["10.0.0.0/8", "127.0.0.1", "fd00::/8"]);
    expect(doc(yc("10.0.0.2", "203.0.113.9"))).toBe("203.0.113.9");
    // Khách tự ghi XFF giả "1.1.1.1" rồi proxy nối thêm địa chỉ thật của khách: giả bị bỏ, thật được lấy.
    expect(doc(yc("10.0.0.2", "1.1.1.1, 203.0.113.9"))).toBe("203.0.113.9");
    // Hai proxy tin cậy nối tiếp: bỏ cả hai, lấy khách.
    expect(doc(yc("10.0.0.2", "203.0.113.9, 10.0.0.3"))).toBe("203.0.113.9");
    expect(doc(yc("127.0.0.1", ["203.0.113.9", "10.0.0.7"]))).toBe("203.0.113.9");
    expect(doc(yc("fd00::1", "2001:db8::5"))).toBe("2001:db8::5");
    expect(doc(yc("::ffff:10.0.0.2", " 203.0.113.9 "))).toBe("203.0.113.9");
  });

  it("socket KHÔNG phải proxy tin cậy ⇒ header bị bỏ qua dù có khai danh sách", () => {
    const doc = taoDocDiaChi(["10.0.0.0/8"]);
    expect(doc(yc("203.0.113.50", "1.1.1.1"))).toBe("203.0.113.50");
  });

  it("header hỏng, rỗng, hay toàn proxy ⇒ socket (không đoán)", () => {
    const doc = taoDocDiaChi(["10.0.0.0/8"]);
    expect(doc(yc("10.0.0.2", "khong-phai-ip"))).toBe("10.0.0.2");
    expect(doc(yc("10.0.0.2", "203.0.113.9, rac"))).toBe("10.0.0.2");
    expect(doc(yc("10.0.0.2", ""))).toBe("10.0.0.2");
    expect(doc(yc("10.0.0.2"))).toBe("10.0.0.2");
    expect(doc(yc("10.0.0.2", "10.0.0.3, 10.0.0.4"))).toBe("10.0.0.2");
    expect(doc(yc("", "203.0.113.9"))).toBe("");
  });

  it("danh sách tin cậy: sai IP hay sai tiền tố ⇒ ném lúc dựng; chuẩn hoá IPv4 ánh xạ", () => {
    expect(() => taoDanhSachTinCay(["khong-ip"])).toThrow(/không phải địa chỉ IP/u);
    expect(() => taoDanhSachTinCay(["10.0.0.0/33"])).toThrow(/tiền tố/u);
    expect(() => taoDanhSachTinCay(["10.0.0.0/x"])).toThrow(/tiền tố/u);
    expect(() => taoDanhSachTinCay(["fd00::/129"])).toThrow(/tiền tố/u);
    expect(() => taoDanhSachTinCay(["10.0.0.0/8", "::ffff:192.168.0.1"])).not.toThrow();
    expect(chuanHoaDiaChi("::ffff:192.168.0.1")).toBe("192.168.0.1");
    expect(chuanHoaDiaChi("2001:db8::1")).toBe("2001:db8::1");
  });
});
