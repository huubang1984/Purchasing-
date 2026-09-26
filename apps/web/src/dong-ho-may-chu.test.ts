// [khoản 196 / ADR-074 phần 3] Phép tính giờ máy chủ của trang nộp thầu — thuần, không trình duyệt.
import { describe, expect, it } from "vitest";
import {
  conLaiMs,
  doLechMayChu,
  docDauThoiGian,
  moTaConLai,
  moTaKhoang,
  moTaLechMay,
} from "./dong-ho-may-chu.js";

describe("[khoản 196] docDauThoiGian — dạng chính tắc của biên nhận", () => {
  it("đọc sáu chữ số micro-giây, cắt về mili-giây", () => {
    expect(docDauThoiGian("2026-09-20T01:02:03.456789Z")).toBe(Date.UTC(2026, 8, 20, 1, 2, 3, 456));
  });

  it.each([undefined, null, 42, "", "2026-09-20T01:02:03Z", "2026-09-20T01:02:03.456Z", "2026-09-20 01:02:03.456789+00"])(
    "không đúng dạng ⇒ null: %s",
    (v) => {
      expect(docDauThoiGian(v)).toBeNull();
    },
  );
});

describe("[khoản 196] doLechMayChu — so với ĐIỂM GIỮA khứ hồi", () => {
  it("máy người dùng chậm 6 giờ 22 phút (cảnh 2026-09-20 ở phía ngược lại) ⇒ lệch dương đúng bằng ấy", () => {
    const may = Date.UTC(2026, 8, 20, 8, 0, 0, 0);
    const lech = 6 * 3600_000 + 22 * 60_000;
    // Gửi lúc (máy chủ − lệch − 200), nhận lúc (máy chủ − lệch + 200): điểm giữa đúng (máy chủ − lệch).
    expect(doLechMayChu("2026-09-20T08:00:00.000000Z", may - lech - 200, may - lech + 200)).toBe(lech);
  });

  it("KHÔNG so với lúc gửi hay lúc nhận: khứ hồi 4 giây không được thành lệch 2 giây", () => {
    const may = Date.UTC(2026, 8, 20, 8, 0, 0, 0);
    expect(doLechMayChu("2026-09-20T08:00:00.000000Z", may - 2000, may + 2000)).toBe(0);
  });

  it("gioMayChu hỏng ⇒ null, không đoán", () => {
    expect(doLechMayChu(undefined, 0, 10)).toBeNull();
    expect(doLechMayChu("hom qua", 0, 10)).toBeNull();
  });
});

describe("[khoản 196] conLaiMs — đếm theo giờ máy chủ ước tính", () => {
  it("máy chậm 10 phút ⇒ còn lại ÍT hơn thứ đồng hồ máy trần cho thấy đúng 10 phút", () => {
    const han = Date.UTC(2026, 8, 20, 10, 0, 0);
    const mayTran = han - 15 * 60_000; // đồng hồ máy trần nói: còn 15 phút
    const lech = 10 * 60_000; // máy chậm 10 phút
    expect(conLaiMs(han, lech, mayTran)).toBe(5 * 60_000);
    expect(conLaiMs(han, 0, mayTran)).toBe(15 * 60_000);
  });

  it("qua hạn theo giờ máy chủ dù đồng hồ máy trần còn hạn ⇒ âm", () => {
    const han = Date.UTC(2026, 8, 20, 10, 0, 0);
    expect(conLaiMs(han, 20 * 60_000, han - 60_000)).toBeLessThan(0);
  });
});

describe("[khoản 196] ba bộ mô tả", () => {
  it("moTaConLai", () => {
    expect(moTaConLai(0)).toBe("Đã quá hạn theo giờ hệ thống");
    expect(moTaConLai(-5)).toBe("Đã quá hạn theo giờ hệ thống");
    expect(moTaConLai(9_999)).toBe("Còn 00:00:09");
    expect(moTaConLai(2 * 86_400_000 + 3 * 3600_000 + 4 * 60_000 + 5_000)).toBe("Còn 2 ngày 03:04:05");
  });

  it("moTaKhoang", () => {
    expect(moTaKhoang(6 * 3600_000 + 22 * 60_000)).toBe("6 giờ 22 phút");
    expect(moTaKhoang(-(12 * 60_000 + 5_000))).toBe("12 phút 5 giây");
    expect(moTaKhoang(3_000)).toBe("3 giây");
  });

  it("moTaLechMay: dưới ngưỡng thì im, trên ngưỡng nói chiều và độ lớn", () => {
    expect(moTaLechMay(1999)).toBe("");
    expect(moTaLechMay(-2000)).toBe("");
    expect(moTaLechMay(6 * 3600_000 + 22 * 60_000)).toContain("chậm 6 giờ 22 phút");
    expect(moTaLechMay(-(5 * 60_000))).toContain("nhanh 5 phút 0 giây");
  });
});
