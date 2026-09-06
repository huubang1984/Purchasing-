// [sổ nợ 41] `X-Forwarded-For` chỉ được tin từ một proxy đã khai, và chỉ phần proxy ấy ghi thêm.
import { describe, expect, it } from "vitest";
import { chuanHoaDiaChi, khoaNguoiGoi, taoDanhSachTinCay, taoDocDiaChi } from "./dia-chi.js";

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

  it("[review H4-9] tiền tố quá rộng (v4 < /8, v6 < /7) ⇒ ném lúc dựng — 'cả Internet là proxy' là lỗi cấu hình; ULA fc00::/7 vẫn hợp lệ", () => {
    expect(() => taoDanhSachTinCay(["0.0.0.0/0"])).toThrow(/quá rộng/u);
    expect(() => taoDanhSachTinCay(["10.0.0.0/7"])).toThrow(/quá rộng/u);
    expect(() => taoDanhSachTinCay(["::/0"])).toThrow(/quá rộng/u);
    expect(() => taoDanhSachTinCay(["2000::/6"])).toThrow(/quá rộng/u);
    expect(() => taoDanhSachTinCay(["10.0.0.0/8", "fc00::/7", "fd00::/8", "2001:db8::/32"])).not.toThrow();
  });

  it("[review H4-9] proxy ghi `ip:port` hay `[v6]:port` ⇒ bỏ cổng, không rơi về socket (cả tổ chức chung một bucket)", () => {
    const doc = taoDocDiaChi(["10.0.0.0/8"]);
    expect(doc(yc("10.0.0.2", "203.0.113.9:51234"))).toBe("203.0.113.9");
    expect(doc(yc("10.0.0.2", "[2001:db8::5]:51234"))).toBe("2001:db8::5");
    expect(doc(yc("10.0.0.2", "1.1.1.1:1, 203.0.113.9:2"))).toBe("203.0.113.9");
    expect(doc(yc("10.0.0.2:4000", "203.0.113.9"))).toBe("203.0.113.9");
    expect(chuanHoaDiaChi("[::ffff:192.168.0.1]:80")).toBe("192.168.0.1");
    // IPv6 trần vẫn là IPv6 trần: không cắt sau dấu hai chấm cuối.
    expect(chuanHoaDiaChi("2001:db8::5")).toBe("2001:db8::5");
    expect(doc(yc("10.0.0.2", "203.0.113.9:abc"))).toBe("10.0.0.2");
  });

  it("[review H4-4] khoá bucket: IPv6 gom về /64 (mọi cách viết), IPv4 và địa chỉ hỏng giữ nguyên", () => {
    expect(khoaNguoiGoi("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
    expect(khoaNguoiGoi("2001:db8:1:2::1")).toBe("2001:0db8:0001:0002::/64");
    expect(khoaNguoiGoi("2001:DB8:1:2::ffff")).toBe(khoaNguoiGoi("2001:db8:1:2::1"));
    expect(khoaNguoiGoi("2001:db8:1:3::1")).not.toBe(khoaNguoiGoi("2001:db8:1:2::1"));
    expect(khoaNguoiGoi("::1")).toBe("0000:0000:0000:0000::/64");
    expect(khoaNguoiGoi("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
    expect(khoaNguoiGoi("64:ff9b::192.0.2.1")).toBe("0064:ff9b:0000:0000::/64");
    expect(khoaNguoiGoi("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(khoaNguoiGoi("203.0.113.9")).toBe("203.0.113.9");
    expect(khoaNguoiGoi("")).toBe("");
    expect(khoaNguoiGoi("rac")).toBe("rac");
  });
});
