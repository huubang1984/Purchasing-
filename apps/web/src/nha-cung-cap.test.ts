// ==============================================================================================
// [S1.9101 / S3.3e1] PHÉP ĐO CHO CÁC PHÉP TÍNH CỦA MÀN XÁC MINH NHÀ CUNG CẤP
//
// Màn hiện mọi người liên hệ, nói vì sao một xác minh thôi hiệu lực và đánh dấu người liên hệ thêm SAU lần xác minh gần nhất (lượt
// soi CAO-2). Ca âm neo vào luật máy chủ: hồ sơ không ACTIVE hay không MST không xác minh được (`082`), thu hồi chỉ khi hàng mới nhất
// là VERIFIED, lý do thu hồi bắt buộc và trần 2000 byte.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { docHoSo, dongNguoiLienHe, loiLyDoThuHoi, nhanXacMinh, nutHoSo, themSauXacMinh, type HoSoMan } from "./nha-cung-cap.js";

const BAM = "a".repeat(64);
const hoSoTho = (o: Record<string, unknown> = {}, xm: Record<string, unknown> = {}): Record<string, unknown> => ({
  supplierId: "s-1",
  legalName: "Thép A",
  taxCode: "0101010101",
  status: "ACTIVE",
  xacMinh: { supplierId: "s-1", loai: "VERIFIED", conHieuLuc: true, hetHanAt: "2027-06-01T00:00:00.000Z", boi: "u-tc", luc: "2026-10-01T00:00:00.000Z", lyDo: null, ...xm },
  bamHoSo: BAM,
  doiSauXacMinh: false,
  boiTen: "Tài chính hai",
  contacts: [
    { id: "c-1", fullName: "Chị Lan", email: "lan@thep.vn", phone: "0901234567", status: "ACTIVE", createdAt: "2026-09-20T00:00:00.000Z", themBoi: "u-n", themBoiTen: "Người nhập" },
  ],
  ...o,
});
const mot = (o: Record<string, unknown> = {}, xm: Record<string, unknown> = {}): HoSoMan => docHoSo({ hoSo: [hoSoTho(o, xm)] })[0]!;

describe("[S1.9101 / S3.3e1] đọc thân GET /supplier-verifications", () => {
  it("hồ sơ đúng hình dạng vào bảng; băm không phải 64 ký tự hex, thiếu khối xác minh hay thiếu mảng người liên hệ ⇒ bị bỏ", () => {
    const ds = docHoSo({
      hoSo: [
        hoSoTho(),
        hoSoTho({ supplierId: "s-2", bamHoSo: "khong-phai-hex" }),
        hoSoTho({ supplierId: "s-3", bamHoSo: "A".repeat(64) }),
        hoSoTho({ supplierId: "s-4", xacMinh: null }),
        hoSoTho({ supplierId: "s-5", contacts: "x" }),
      ],
    });
    expect(ds.map((h) => h.supplierId)).toEqual(["s-1"]);
    expect(docHoSo(null)).toEqual([]);
    expect(docHoSo({ hoSo: "x" })).toEqual([]);
  });

  it("người liên hệ sai hình dạng bị bỏ; trường thiếu thành giá trị trung tính", () => {
    const h = mot({ contacts: [{ id: "c-1", email: "a@b.vn" }, { email: "khong-id@b.vn" }] });
    expect(h.contacts).toEqual([{ id: "c-1", fullName: "—", email: "a@b.vn", phone: null, status: "—", createdAt: "", themBoiTen: null }]);
  });
});

describe("[S1.9101 / S3.3e1] trạng thái xác minh nói bằng lời", () => {
  it("còn hiệu lực kèm hạn và người xác minh; hồ sơ đổi sau xác minh; hết hạn; thu hồi kèm lý do; chưa xác minh", () => {
    expect(nhanXacMinh(mot())).toMatch(/^Đã xác minh, còn hiệu lực tới .* — Tài chính hai\.$/u);
    expect(nhanXacMinh(mot({ doiSauXacMinh: true }, { conHieuLuc: false }))).toMatch(/^Hết hiệu lực: hồ sơ đã đổi sau lần xác minh/u);
    expect(nhanXacMinh(mot({}, { conHieuLuc: false }))).toMatch(/^Hết hạn từ /u);
    expect(nhanXacMinh(mot({}, { loai: "REVOKED", conHieuLuc: false, lyDo: "MST sai" }))).toBe("Đã thu hồi: MST sai.");
    expect(nhanXacMinh(mot({}, { loai: null, conHieuLuc: false, luc: null }))).toBe("Chưa xác minh.");
  });
});

describe("[S1.9101 / S3.3e1 · lượt soi CAO-2] người liên hệ thêm sau lần xác minh gần nhất", () => {
  it("thêm sau ⇒ đánh dấu trên dòng; thêm trước ⇒ không; chưa từng xác minh ⇒ không người nào bị đánh dấu", () => {
    const h = mot({
      contacts: [
        { id: "c-1", fullName: "Chị Lan", email: "lan@thep.vn", phone: "0901", status: "ACTIVE", createdAt: "2026-09-20T00:00:00.000Z", themBoiTen: "Người nhập" },
        { id: "c-2", fullName: "Người lạ", email: "la@khac.vn", phone: null, status: "ACTIVE", createdAt: "2026-10-03T00:00:00.000Z", themBoiTen: "PM hai" },
      ],
    });
    expect(h.contacts.map((c) => themSauXacMinh(h, c))).toEqual([false, true]);
    expect(dongNguoiLienHe(h, h.contacts[1]!)).toMatch(/^Người lạ — la@khac\.vn, không số điện thoại · thêm bởi PM hai, .* · ⚠ thêm SAU lần xác minh gần nhất$/u);
    expect(dongNguoiLienHe(h, h.contacts[0]!)).not.toMatch(/⚠/u);
    const chuaXm = mot({}, { loai: null, conHieuLuc: false, luc: null });
    expect(themSauXacMinh(chuaXm, chuaXm.contacts[0]!)).toBe(false);
  });

  it("người liên hệ không ACTIVE nói trạng thái; không rõ người thêm thì nói thế", () => {
    const h = mot({ contacts: [{ id: "c-9", fullName: "Cũ", email: "cu@thep.vn", phone: "0902", status: "SUSPENDED", createdAt: "2026-09-01T00:00:00.000Z", themBoiTen: null }] });
    expect(dongNguoiLienHe(h, h.contacts[0]!)).toMatch(/^Cũ — cu@thep\.vn, 0902 · SUSPENDED · không rõ người thêm, /u);
  });
});

describe("[S1.9101 / S3.3e1] nút trên một hồ sơ", () => {
  it("xác minh chỉ khi hồ sơ ACTIVE và có MST (luật của `082`); thu hồi chỉ khi hàng mới nhất là VERIFIED", () => {
    expect(nutHoSo(mot())).toEqual({ xacMinh: true, thuHoi: true });
    expect(nutHoSo(mot({ status: "SUSPENDED" }))).toEqual({ xacMinh: false, thuHoi: true });
    expect(nutHoSo(mot({ taxCode: null }))).toEqual({ xacMinh: false, thuHoi: true });
    expect(nutHoSo(mot({}, { loai: "REVOKED", conHieuLuc: false }))).toEqual({ xacMinh: true, thuHoi: false });
    expect(nutHoSo(mot({}, { loai: null, conHieuLuc: false }))).toEqual({ xacMinh: true, thuHoi: false });
  });

  it("lý do thu hồi: bắt buộc sau khi cắt, trần 2000 byte UTF-8", () => {
    expect(loiLyDoThuHoi("  ")).toMatch(/^Cần lý do thu hồi/u);
    expect(loiLyDoThuHoi("ệ".repeat(667))).toMatch(/2000 byte/u);
    expect(loiLyDoThuHoi("ệ".repeat(666))).toBeNull();
  });
});
