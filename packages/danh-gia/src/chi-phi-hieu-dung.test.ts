// ===============================================================================================
// [S1.104 / S2.2] HÀM THUẦN CHI PHÍ HIỆU DỤNG — J1 LÀ MỘT PHÉP LỌC ĐO ĐƯỢC, KHÔNG PHẢI MỘT LỜI HỨA
//
// Luật làm tròn được đối chiếu với Postgres ở `nua-xu.int.test.ts`; tệp này đo phần CÒN LẠI: vế
// lọc của J1, chỗ làm tròn (từng thành phần rồi cộng), và mọi lối từ chối.
// ===============================================================================================

import { describe, expect, it } from "vitest";
import {
  SO_LE_HE_SO,
  SO_LE_TIEN,
  docSo,
  laTuChoi,
  lamTron,
  tinhChiPhiHieuDung,
  vietSo,
  type ThanhPhanChinhSach,
} from "./chi-phi-hieu-dung.js";

/** Bắt nhánh THÀNH CÔNG và nói rõ khi nó không phải — `laTuChoi` là cửa duy nhất. */
function phaiRaSo(kq: ReturnType<typeof tinhChiPhiHieuDung>) {
  if (laTuChoi(kq)) throw new Error(`mong một kết quả, nhận từ chối ${kq.lyDo}${kq.ma === undefined ? "" : ` (${kq.ma})`}`);
  return kq;
}

/** Bắt nhánh TỪ CHỐI. */
function phaiTuChoi(kq: ReturnType<typeof tinhChiPhiHieuDung>) {
  if (!laTuChoi(kq)) throw new Error(`mong một từ chối, nhận ${kq.effectiveCost}`);
  return kq;
}

const GIA: ThanhPhanChinhSach = { ma: "gia", donVi: "TIEN", heSo: "1.0000" };

describe("[S1.104 / S2.2] đọc và viết số — không một `number` nào chạm tiền", () => {
  it.each([
    ["0", 2, 0n],
    ["0.00", 2, 0n],
    ["12.34", 2, 1234n],
    ["-12.34", 2, -1234n],
    ["-0.01", 2, -1n],
    ["1.2345", 4, 12345n],
    ["9999999999.99", 2, 999999999999n],
  ])("`docSo(%s, %i)` = %s", (chuoi, soLe, mong) => {
    expect(docSo(chuoi, soLe)).toBe(mong);
  });

  it.each([
    ["1.234", 2, "phần lẻ DÀI hơn tỉ lệ — cắt cụt âm thầm là đúng khoản 218 ở một chỗ mới"],
    ["", 2, "chuỗi rỗng"],
    ["abc", 2, "không phải số"],
    ["1,5", 2, "dấu phẩy không phải dấu thập phân của `numeric`"],
    ["1.5e3", 2, "ký hiệu mũ"],
    ["--1", 2, "hai dấu trừ"],
    ["+1", 2, "dấu cộng tường minh"],
  ])("`docSo(%s, %i)` = null — %s", (chuoi, soLe) => {
    expect(docSo(chuoi, soLe)).toBeNull();
  });

  it.each([
    [0n, 2, "0.00"],
    [1234n, 2, "12.34"],
    [-1234n, 2, "-12.34"],
    [-1n, 2, "-0.01"],
    [12345n, 4, "1.2345"],
  ])("`vietSo(%s, %i)` = %s", (v, soLe, mong) => {
    expect(vietSo(v, soLe)).toBe(mong);
  });

  it("`lamTron` NÉM khi bị đòi nới tỉ lệ — một phép nới im lặng là một số tự bịa chữ số", () => {
    expect(() => lamTron(1n, 2, 4)).toThrow(RangeError);
  });
});

describe("[S1.104 / S2.2] J1 — chỉ khoản TIỀN đi vào `effective_cost`", () => {
  it("thành phần `DIEM` có mặt trong `components` nhưng `tien` là null và KHÔNG cộng vào tổng", () => {
    const kq = phaiRaSo(
      tinhChiPhiHieuDung(
        [GIA, { ma: "ky_thuat", donVi: "DIEM", heSo: "3.0000" }],
        [
          { ma: "gia", giaTri: "100.00" },
          { ma: "ky_thuat", giaTri: "80.00" },
        ],
      ),
    );
    expect(kq.effectiveCost, "80 × 3 = 240 KHÔNG được có mặt ở đây").toBe("100.00");
    expect(kq.components.map((c) => [c.ma, c.tien])).toEqual([
      ["gia", "100.00"],
      ["ky_thuat", null],
    ]);
  });

  it("thành phần `DIEM` KHÔNG bị vứt — vứt nó là nói dối về thứ chính sách đã khai", () => {
    const kq = phaiRaSo(
      tinhChiPhiHieuDung(
        [GIA, { ma: "ky_thuat", donVi: "DIEM", heSo: "3.0000" }],
        [
          { ma: "gia", giaTri: "1.00" },
          { ma: "ky_thuat", giaTri: "80.00" },
        ],
      ),
    );
    expect(kq.components, "S2.4 hiện bảng này lên màn; thiếu một dòng là một bảng nói dối").toHaveLength(2);
  });

  it("chính sách KHÔNG có một thành phần TIỀN nào thì TỪ CHỐI — một xếp hạng không có tiền là một xếp hạng không có nghĩa", () => {
    const kq = phaiTuChoi(
      tinhChiPhiHieuDung([{ ma: "ky_thuat", donVi: "DIEM", heSo: "1.0000" }], [{ ma: "ky_thuat", giaTri: "80.00" }]),
    );
    expect(kq.lyDo).toBe("KHONG_CO_THANH_PHAN_TIEN");
  });
});

describe("[S1.104 / S2.2] làm tròn TỪNG thành phần rồi CỘNG — chủ dự án chốt 2026-09-21", () => {
  it("tổng là phép CỘNG các `tien` đã làm tròn, không phải một lần làm tròn nữa", () => {
    // Hai thành phần, mỗi cái rơi đúng điểm hoà: 0.005 + 0.005.
    //   từng phần rồi cộng -> 0.01 + 0.01 = 0.02   (thứ hàm này phải trả)
    //   cộng rồi làm tròn  -> round(0.01, 2)  = 0.01
    const kq = phaiRaSo(
      tinhChiPhiHieuDung(
        [
          { ma: "a", donVi: "TIEN", heSo: "0.5000" },
          { ma: "b", donVi: "TIEN", heSo: "0.5000" },
        ],
        [
          { ma: "a", giaTri: "0.01" },
          { ma: "b", giaTri: "0.01" },
        ],
      ),
    );
    expect(kq.components.map((c) => c.tien)).toEqual(["0.01", "0.01"]);
    expect(kq.effectiveCost, "0.01 nghĩa là ai đó đã làm tròn TỔNG — đúng phương án KHÔNG được chọn").toBe("0.02");
  });

  it("bảng thành phần CỘNG RA đúng `effective_cost` — đây là toàn bộ vế dễ của J2", () => {
    const kq = phaiRaSo(
      tinhChiPhiHieuDung(
        [
          { ma: "gia", donVi: "TIEN", heSo: "1.0000" },
          { ma: "van_chuyen", donVi: "TIEN", heSo: "1.2345" },
          { ma: "giam_tru", donVi: "TIEN", heSo: "-0.5000" },
          { ma: "ky_thuat", donVi: "DIEM", heSo: "2.0000" },
        ],
        [
          { ma: "gia", giaTri: "1000.00" },
          { ma: "van_chuyen", giaTri: "37.77" },
          { ma: "giam_tru", giaTri: "99.99" },
          { ma: "ky_thuat", giaTri: "80.00" },
        ],
      ),
    );
    const cong = kq.components
      .map((c) => docSo(c.tien ?? "0.00", SO_LE_TIEN) ?? 0n)
      .reduce((s, v) => s + v, 0n);
    expect(vietSo(cong, SO_LE_TIEN), "kiểm toán viên cộng cột là ra — không cần biết luật làm tròn").toBe(
      kq.effectiveCost,
    );
  });

  it("một khoản GIẢM TRỪ kéo tổng xuống, và nó đi qua đúng luật nửa-ra-xa-0", () => {
    const kq = phaiRaSo(
      tinhChiPhiHieuDung(
        [GIA, { ma: "giam_tru", donVi: "TIEN", heSo: "-0.5000" }],
        [
          { ma: "gia", giaTri: "1.00" },
          { ma: "giam_tru", giaTri: "0.01" },
        ],
      ),
    );
    expect(kq.components[1]?.tien, "-0.005 → -0.01 (ra xa 0), không phải 0.00 (nửa-lên)").toBe("-0.01");
    expect(kq.effectiveCost).toBe("0.99");
  });
});

describe("[S1.104 / S2.2] mọi lối KHÔNG ra số đều gọi tên được chỗ hỏng", () => {
  it("thiếu đầu vào cho một mã chính sách khai", () => {
    const kq = phaiTuChoi(tinhChiPhiHieuDung([GIA, { ma: "van_chuyen", donVi: "TIEN", heSo: "1.0000" }], [{ ma: "gia", giaTri: "1.00" }]));
    expect([kq.lyDo, kq.ma]).toEqual(["THIEU_DAU_VAO", "van_chuyen"]);
  });

  it("đầu vào mang một mã chính sách KHÔNG khai — im lặng bỏ qua là một con số không ai giải thích được", () => {
    const kq = phaiTuChoi(
      tinhChiPhiHieuDung(
        [GIA],
        [
          { ma: "gia", giaTri: "1.00" },
          { ma: "bi_an", giaTri: "9.99" },
        ],
      ),
    );
    expect([kq.lyDo, kq.ma]).toEqual(["DAU_VAO_THUA", "bi_an"]);
  });

  it("hai đầu vào cùng một mã — lấy cái nào cũng là một phép đoán", () => {
    const kq = phaiTuChoi(
      tinhChiPhiHieuDung(
        [GIA],
        [
          { ma: "gia", giaTri: "1.00" },
          { ma: "gia", giaTri: "2.00" },
        ],
      ),
    );
    expect([kq.lyDo, kq.ma]).toEqual(["DAU_VAO_TRUNG_MA", "gia"]);
  });

  it("hệ số không đọc được", () => {
    const kq = phaiTuChoi(tinhChiPhiHieuDung([{ ma: "gia", donVi: "TIEN", heSo: "1.23456" }], [{ ma: "gia", giaTri: "1.00" }]));
    expect([kq.lyDo, kq.ma]).toEqual(["HE_SO_KHONG_DOC_DUOC", "gia"]);
  });

  it("giá trị không đọc được — `numeric` NHẬN `NaN`, hàm thuần thì không", () => {
    const kq = phaiTuChoi(tinhChiPhiHieuDung([GIA], [{ ma: "gia", giaTri: "NaN" }]));
    expect([kq.lyDo, kq.ma]).toEqual(["GIA_TRI_KHONG_DOC_DUOC", "gia"]);
  });

  it("chính sách RỖNG là ca `KHONG_CO_THANH_PHAN_TIEN`, không phải tổng bằng 0", () => {
    const kq = phaiTuChoi(tinhChiPhiHieuDung([], []));
    expect(kq.lyDo, "một chính sách rỗng cho tổng 0 là một báo giá miễn phí").toBe("KHONG_CO_THANH_PHAN_TIEN");
  });

  it("hàm KHÔNG ném ở bất kỳ lối nào trên — người mua đọc câu từ chối, không đọc stack trace", () => {
    expect(() => tinhChiPhiHieuDung([GIA], [{ ma: "gia", giaTri: "Infinity" }])).not.toThrow();
    expect(SO_LE_TIEN + SO_LE_HE_SO, "tích ở tỉ lệ 10^6 — ba chữ số thừa là chỗ luật làm tròn nói").toBe(6);
  });
});
