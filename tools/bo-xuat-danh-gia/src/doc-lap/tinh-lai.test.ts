// ===============================================================================================
// [S1.114 / S2.7 / ADR-059 ⒝] LỚP TÍNH LẠI ĐỘC LẬP — ĐO THEO `DAC-TA.md`, KHÔNG THEO MÃ CỦA DỰ ÁN
//
// Tệp này CỐ Ý không import `@trustprocure/danh-gia`: nó đo bản cài độc lập so với ĐẶC TẢ, từng
// mục một. Phép đo *hai lớp có khớp nhau không* nằm ở `../kiem.test.ts`, và nó là một câu hỏi
// KHÁC — trộn hai câu ấy vào một tệp là cách nhanh nhất để mất vế chịu lực của ADR-059.
//
// (Quy tắc `g17-kiem-doc-lap-khong-cham-danh-gia` cưỡng chế điều đó cho cả thư mục `doc-lap/`,
// nên tệp này cũng nằm trong tầm — và đó là chủ ý.)
// ===============================================================================================

import { describe, expect, it } from "vitest";
import {
  cong,
  docThapPhan,
  khongTinhDuoc,
  nhan,
  soSanh,
  thuVe,
  tinhLai,
  vietThapPhan,
  xepHangLai,
  type SoThapPhan,
  type ThanhPhanChinhSachDoc,
} from "./tinh-lai.js";

const GIA: ThanhPhanChinhSachDoc = { ma: "gia", don_vi: "TIEN", he_so: "1.0000" };

/** Đọc một số của bảng ca — NÉM khi không đọc được, để một ca viết sai không đi tiếp im lặng. */
function so(chuoi: string): SoThapPhan {
  const x = docThapPhan(chuoi);
  if (x === null) throw new Error(`ca của bảng viết sai: docThapPhan từ chối "${chuoi}"`);
  return x;
}

describe("`DAC-TA.md` §1–§2 — đọc và viết số thập phân", () => {
  it.each(["", " ", "1.2.3", "1,2", "abc", "1e3", "+1", "0x10", "Infinity", "NaN"])(
    "từ chối %j",
    (chuoi) => {
      expect(docThapPhan(chuoi)).toBeNull();
    },
  );

  it.each([
    ["0", "0"],
    ["0.00", "0.00"],
    ["-0.00", "0.00"],
    ["000123.45", "123.45"],
    ["-000123.45", "-123.45"],
    ["1.0000", "1.0000"],
  ])("đọc rồi viết lại %j ra %j", (vao, ra) => {
    expect(vietThapPhan(so(vao))).toBe(ra);
  });

  it("`-0` viết là `0` — bảng xếp hạng không có hai số không", () => {
    expect(vietThapPhan(nhan(so("-0.01"), so("0.0000")))).toBe("0.000000");
  });
});

describe("`DAC-TA.md` §4 — luật làm tròn NỬA-RA-XA-0", () => {
  // Bảng này là ĐÚNG bảng in trong `DAC-TA.md`. Một người ngoài đọc đặc tả rồi cài lại sẽ đo
  // chính bốn ca này; nếu chúng rời nhau thì đặc tả và mã đã trôi khỏi nhau.
  it.each([
    ["0.005000", "0.01"],
    ["-0.005000", "-0.01"],
    ["0.004999", "0.00"],
    ["-0.004999", "0.00"],
  ])("thu %j về 2 chữ số ra %j", (vao, ra) => {
    expect(vietThapPhan(thuVe(so(vao), 2))).toBe(ra);
  });

  it("KHÁC nửa-lên đúng ở SỐ ÂM — một bảng ca toàn số dương không phân biệt được", () => {
    // Nửa-LÊN cho `-0.005` ra `0.00`; nửa-ra-xa-0 cho `-0.01`. Đây là cả lý do bảng trên mang
    // ca âm, và là cùng bài học mà `nuaXuCases` của `packages/danh-gia` đã ghi.
    expect(vietThapPhan(thuVe(so("-0.005000"), 2))).toBe("-0.01");
    expect(vietThapPhan(thuVe(so("0.005000"), 2))).toBe("0.01");
  });

  it("thuVe KHÔNG nới tỉ lệ", () => {
    expect(() => thuVe(so("1.00"), 4)).toThrow(RangeError);
  });
});

describe("`DAC-TA.md` §3 — nhân dài và cộng", () => {
  it.each([
    ["100.00", "1.0000", "100.000000"],
    ["10.00", "1.2345", "12.345000"],
    ["0.01", "0.0001", "0.000001"],
    ["-10.00", "1.2345", "-12.345000"],
    ["10.00", "0.0000", "0.000000"],
  ])("%s × %s = %s", (a, b, ra) => {
    expect(vietThapPhan(nhan(so(a), so(b)))).toBe(ra);
  });

  it("số chữ số thập phân của tích là TỔNG hai số chữ số thập phân", () => {
    expect(vietThapPhan(nhan(so("1.00"), so("1.0000")))).toBe("1.000000");
  });

  it.each([
    ["1.00", "2.00", "3.00"],
    ["1.00", "-2.00", "-1.00"],
    ["-1.00", "2.00", "1.00"],
    ["-1.00", "-2.00", "-3.00"],
    ["1.00", "-1.00", "0.00"],
  ])("%s + %s = %s", (a, b, ra) => {
    expect(vietThapPhan(cong(so(a), so(b)))).toBe(ra);
  });

  it("cộng đòi cùng tỉ lệ — hai tỉ lệ khác nhau là một lỗi lập trình, không phải một mặc định", () => {
    expect(() => cong(so("1.00"), so("1.0000"))).toThrow(RangeError);
  });

  it.each([
    ["1.00", "2.00", -1],
    ["2.00", "1.00", 1],
    ["1.00", "1.00", 0],
    ["-1.00", "1.00", -1],
    ["-2.00", "-1.00", -1],
    ["0.00", "-0.00", 0],
  ])("so sánh %s với %s ra %d", (a, b, ra) => {
    expect(soSanh(so(a), so(b))).toBe(ra);
  });
});

describe("`DAC-TA.md` §3 — chi phí hiệu dụng của một hàng", () => {
  it("một thành phần TIEN: làm tròn rồi cộng", () => {
    const kq = tinhLai([{ ma: "gia", don_vi: "TIEN", he_so: "1.2345" }], [{ ma: "gia", giaTri: "10.00" }]);
    expect(khongTinhDuoc(kq)).toBe(false);
    if (khongTinhDuoc(kq)) return;
    expect(kq.effectiveCost).toBe("12.35");
    expect(kq.components).toEqual([{ ma: "gia", donVi: "TIEN", tien: "12.35" }]);
  });

  it("LÀM TRÒN TỪNG THÀNH PHẦN rồi cộng — khác hẳn cộng rồi làm tròn một lần", () => {
    // Ba thành phần, mỗi cái lẻ đúng nửa xu. Từng-cái-rồi-cộng: 0.01 × 3 = 0.03.
    // Cộng-rồi-làm-tròn: 0.015 = 0.02. Chênh 0.01, đúng trần `n/2` xu mà `DAC-TA.md` §3 nói ra.
    const cs: ThanhPhanChinhSachDoc[] = [
      { ma: "a", don_vi: "TIEN", he_so: "0.0005" },
      { ma: "b", don_vi: "TIEN", he_so: "0.0005" },
      { ma: "c", don_vi: "TIEN", he_so: "0.0005" },
    ];
    const kq = tinhLai(cs, [
      { ma: "a", giaTri: "10.00" },
      { ma: "b", giaTri: "10.00" },
      { ma: "c", giaTri: "10.00" },
    ]);
    if (khongTinhDuoc(kq)) throw new Error("phải tính được");
    expect(kq.components.map((c) => c.tien)).toEqual(["0.01", "0.01", "0.01"]);
    expect(kq.effectiveCost).toBe("0.03");
  });

  it("thành phần DIEM có mặt trong bảng nhưng KHÔNG cộng vào tổng", () => {
    const kq = tinhLai(
      [GIA, { ma: "ky_thuat", don_vi: "DIEM", he_so: "1.0000" }],
      [
        { ma: "gia", giaTri: "100.00" },
        { ma: "ky_thuat", giaTri: "80.00" },
      ],
    );
    if (khongTinhDuoc(kq)) throw new Error("phải tính được");
    expect(kq.effectiveCost).toBe("100.00");
    expect(kq.components).toEqual([
      { ma: "gia", donVi: "TIEN", tien: "100.00" },
      { ma: "ky_thuat", donVi: "DIEM", tien: null },
    ]);
  });

  it("thứ tự thành phần theo CHÍNH SÁCH, không theo thứ tự hàng khai", () => {
    const kq = tinhLai(
      [
        { ma: "b", don_vi: "TIEN", he_so: "1.0000" },
        { ma: "a", don_vi: "TIEN", he_so: "1.0000" },
      ],
      [
        { ma: "a", giaTri: "1.00" },
        { ma: "b", giaTri: "2.00" },
      ],
    );
    if (khongTinhDuoc(kq)) throw new Error("phải tính được");
    expect(kq.components.map((c) => c.ma)).toEqual(["b", "a"]);
  });

  it.each<[string, ThanhPhanChinhSachDoc[], { ma: string; giaTri: string | null }[]]>([
    ["DAU_VAO_TRUNG_MA", [GIA], [{ ma: "gia", giaTri: "1.00" }, { ma: "gia", giaTri: "2.00" }]],
    ["DAU_VAO_THUA", [GIA], [{ ma: "gia", giaTri: "1.00" }, { ma: "la", giaTri: "2.00" }]],
    ["THIEU_DAU_VAO", [GIA], []],
    ["KHONG_CO_THANH_PHAN_TIEN", [{ ma: "gia", don_vi: "DIEM", he_so: "1.0000" }], [{ ma: "gia", giaTri: "1.00" }]],
    ["DON_VI_LA", [{ ma: "x", don_vi: "LA", he_so: "1.0000" }, GIA], [{ ma: "x", giaTri: "1.00" }, { ma: "gia", giaTri: "1.00" }]],
    ["HE_SO_KHONG_DOC_DUOC", [{ ma: "gia", don_vi: "TIEN", he_so: "x" }], [{ ma: "gia", giaTri: "1.00" }]],
    ["GIA_TRI_KHONG_DOC_DUOC", [GIA], [{ ma: "gia", giaTri: "x" }]],
    ["GIA_TRI_VANG", [GIA], [{ ma: "gia", giaTri: null }]],
  ])("từ chối với mã %s", (lyDo, cs, vao) => {
    const kq = tinhLai(cs, vao);
    expect(khongTinhDuoc(kq)).toBe(true);
    if (!khongTinhDuoc(kq)) return;
    expect(kq.lyDo).toBe(lyDo);
  });
});

describe("`DAC-TA.md` §5 — xếp hạng", () => {
  it("hạng bằng nhau cho giá bằng nhau, và hạng kế BỎ QUA đúng số chỗ đã chiếm", () => {
    expect(xepHangLai(["10.00", "20.00", "20.00", "30.00"])).toEqual([1, 2, 2, 4]);
  });

  it("hàng không có số nhận `null`, KHÔNG lên đầu và KHÔNG chiếm một hạng", () => {
    expect(xepHangLai(["20.00", null, "10.00"])).toEqual([2, null, 1]);
  });

  it("mọi hàng đều null ⇒ mọi hạng đều null", () => {
    expect(xepHangLai([null, null])).toEqual([null, null]);
  });

  it("so theo GIÁ TRỊ chứ không theo chuỗi — `9.00` rẻ hơn `10.00`", () => {
    // Một bản cài so chuỗi sẽ cho `10.00` đứng trước `9.00`. Ca này rẻ và nó đóng đúng lớp lỗi ấy.
    expect(xepHangLai(["10.00", "9.00"])).toEqual([2, 1]);
  });

  it("số âm xếp trước số dương", () => {
    expect(xepHangLai(["1.00", "-1.00", "0.00"])).toEqual([3, 1, 2]);
  });
});
