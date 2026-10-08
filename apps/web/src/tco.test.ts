// [S1.9101 / S4.7b2] Phép tính thuần của thước TCO ở `/nop-thau` và `/mo-thau` (`tco.ts`).
import { describe, expect, it } from "vitest";
import {
  coThuocTco,
  docSoNgayKhai,
  docThuocTco,
  docTienKhai,
  loiOKhai,
  moTaMaThieu,
  moTaQuyDoi,
  moTaThanhPhan,
  oCanKhai,
  SO_NGAY_KHAI_TOI_DA,
  tenMa,
  truongKhai,
  type OKhai,
} from "./tco.js";

const THUOC_DU = {
  ma: ["gia", "van_chuyen", "nhap_khau", "chi_phi_thanh_toan", "chi_phi_tre"],
  thamSo: { chiPhiVonNam: "0.12", ngayThanhToanChuan: "60", tyLeTreNgay: "0.001" },
};
const O_TRONG: OKhai = { vanChuyen: "", nhapKhau: "", ngayThanhToan: "", ngayGiao: "" };
const CAN_DU = { vanChuyen: true, nhapKhau: true, ngayThanhToan: true, ngayGiao: true };

describe("docThuocTco — thân `GET /guest/rfq` thành thước", () => {
  it("đọc tập mã và ba tham số; tham số vắng hay không phải chuỗi ⇒ `null`", () => {
    expect(docThuocTco(THUOC_DU)).toEqual({ ma: THUOC_DU.ma, chiPhiVonNam: "0.12", ngayThanhToanChuan: "60", tyLeTreNgay: "0.001" });
    expect(docThuocTco({ ma: ["gia"], thamSo: { chiPhiVonNam: null, ngayThanhToanChuan: 60 } })).toEqual({
      ma: ["gia"],
      chiPhiVonNam: null,
      ngayThanhToanChuan: null,
      tyLeTreNgay: null,
    });
    expect(docThuocTco({ ma: ["gia"] })?.tyLeTreNgay).toBeNull();
  });

  it("hình dạng lạ ⇒ `null` (màn chỉ còn ô giá)", () => {
    for (const x of [null, undefined, "gia", 1, {}, { ma: "gia" }, { ma: ["gia", 1] }, { ma: null }]) expect(docThuocTco(x), JSON.stringify(x)).toBeNull();
  });
});

describe("oCanKhai — mỗi ô một mã", () => {
  it("ô theo mã bật; `gia` không đòi ô nào ngoài tổng; thước `null` ⇒ không ô nào", () => {
    expect(oCanKhai(docThuocTco(THUOC_DU))).toEqual(CAN_DU);
    expect(oCanKhai(docThuocTco({ ma: ["gia", "chi_phi_tre"] }))).toEqual({ vanChuyen: false, nhapKhau: false, ngayThanhToan: false, ngayGiao: true });
    expect(oCanKhai(docThuocTco({ ma: ["gia"] }))).toEqual({ vanChuyen: false, nhapKhau: false, ngayThanhToan: false, ngayGiao: false });
    expect(oCanKhai(null)).toEqual({ vanChuyen: false, nhapKhau: false, ngayThanhToan: false, ngayGiao: false });
  });
});

describe("docSoNgayKhai — bản chép miền của `bid_so_ngay` (`112` (6))", () => {
  it("số nguyên thập phân 0–3650, không số 0 đầu, cắt khoảng trắng hai đầu", () => {
    for (const [vao, ra] of [
      ["0", "0"],
      [" 45 ", "45"],
      ["3650", "3650"],
      ["3651", null],
      ["9999", null],
      ["10000", null],
      ["01", null],
      ["00", null],
      ["-1", null],
      ["+5", null],
      ["1.5", null],
      ["1e2", null],
      ["", null],
      ["٣", null],
    ] as const) {
      expect(docSoNgayKhai(vao), vao).toBe(ra);
    }
    expect(SO_NGAY_KHAI_TOI_DA).toBe(3650);
  });
});

describe("docTienKhai — ô tiền cùng quy ước ô đơn giá", () => {
  it("số nguyên đơn vị tiền, dấu chấm nhóm nghìn, bỏ số 0 đầu; tối đa 16 chữ số", () => {
    expect(docTienKhai("500.000")).toBe("500000");
    expect(docTienKhai("0")).toBe("0");
    expect(docTienKhai("000")).toBe("0");
    expect(docTienKhai("0012")).toBe("12");
    expect(docTienKhai("9999999999999999")).toBe("9999999999999999");
    expect(docTienKhai("10000000000000000"), "17 chữ số — ngoài miền tiền của lượt chấm").toBeNull();
    for (const x of ["", "-1", "1,5", "abc", "1.5"]) expect(docTienKhai(x), x).toBeNull();
  });
});

describe("loiOKhai — ô bắt buộc trên form (ADR-156 ⑶)", () => {
  it("đủ ô ⇒ im; ô không cần khai thì không xét", () => {
    expect(loiOKhai(CAN_DU, { vanChuyen: "0", nhapKhau: "1.000", ngayThanhToan: "30", ngayGiao: "0" })).toBeNull();
    expect(loiOKhai({ vanChuyen: false, nhapKhau: false, ngayThanhToan: false, ngayGiao: true }, { ...O_TRONG, ngayGiao: "7" })).toBeNull();
    expect(loiOKhai({ vanChuyen: false, nhapKhau: false, ngayThanhToan: false, ngayGiao: false }, O_TRONG)).toBeNull();
  });

  it("ô trống gọi tên ô ĐẦU TIÊN, nói ghi 0 và hậu quả", () => {
    expect(loiOKhai(CAN_DU, O_TRONG)).toBe(
      "Phí vận chuyển là ô bắt buộc của gói này — không có khoản ấy thì ghi 0. Thiếu ô thì báo giá không được xếp hạng.",
    );
    expect(loiOKhai(CAN_DU, { vanChuyen: "0", nhapKhau: "0", ngayThanhToan: "0", ngayGiao: "  " })).toBe(
      "Số ngày giao hàng là ô bắt buộc của gói này — không có khoản ấy thì ghi 0. Thiếu ô thì báo giá không được xếp hạng.",
    );
  });

  it("ô không đọc được gọi tên ô và miền", () => {
    expect(loiOKhai(CAN_DU, { vanChuyen: "1,5", nhapKhau: "0", ngayThanhToan: "0", ngayGiao: "0" })).toBe(
      'Phí vận chuyển "1,5" không đọc được: số nguyên đơn vị tiền, dấu chấm chỉ nhóm nghìn.',
    );
    expect(loiOKhai(CAN_DU, { vanChuyen: "0", nhapKhau: "0", ngayThanhToan: "3651", ngayGiao: "0" })).toBe(
      'Số ngày thanh toán "3651" không đọc được: số ngày nguyên từ 0 đến 3650.',
    );
  });
});

describe("truongKhai — trường của phong bì, đúng bốn khoá bộ đọc SQL đọc", () => {
  it("chỉ ô cần khai, dạng chuẩn; ô không cần khai không có khoá dù người gõ", () => {
    expect(truongKhai(CAN_DU, { vanChuyen: "1.500.000", nhapKhau: "0", ngayThanhToan: "60", ngayGiao: "45" })).toEqual({
      freight: "1500000",
      importCost: "0",
      paymentDays: "60",
      leadTimeDays: "45",
    });
    expect(truongKhai({ vanChuyen: false, nhapKhau: false, ngayThanhToan: true, ngayGiao: false }, { vanChuyen: "9", nhapKhau: "9", ngayThanhToan: "30", ngayGiao: "9" })).toEqual({
      paymentDays: "30",
    });
    expect(truongKhai(CAN_DU, O_TRONG), "ô không đọc được không có khoá — `loiOKhai` đã chặn trước").toEqual({});
  });
});

describe("moTaQuyDoi — lời cho nhà cung cấp, với chính tham số của thước", () => {
  it("gói chỉ chấm theo giá ⇒ rỗng", () => {
    expect(moTaQuyDoi(null, 30)).toEqual([]);
    expect(moTaQuyDoi(docThuocTco({ ma: ["gia"] }), 30)).toEqual([]);
  });

  it("đủ năm mã: câu đầu, câu cộng nguyên, hai câu quy đổi mang tham số và số ngày giao", () => {
    expect(moTaQuyDoi(docThuocTco(THUOC_DU), 30)).toEqual([
      "Bên mua xếp hạng báo giá theo tổng chi phí — tổng báo giá cộng các khoản dưới đây — tính theo lời khai của anh/chị. Mọi ô dưới đây " +
        "bắt buộc; không có khoản nào thì ghi 0.",
      "Phí vận chuyển và chi phí nhập khẩu được cộng nguyên vào tổng để so sánh.",
      "Chi phí thanh toán: kỳ thanh toán chuẩn của bên mua là 60 ngày. Mỗi ngày anh/chị đòi được trả SỚM hơn kỳ ấy được quy thành chi phí " +
        "vốn 0.12 một năm ÷ 365 × tổng báo giá, cộng vào tổng. Trả muộn hơn không được trừ.",
      "Chi phí trễ giao: số ngày giao yêu cầu là 30 ngày. Mỗi ngày anh/chị giao MUỘN hơn được quy thành 0.001 × tổng báo giá, cộng vào " +
        "tổng. Giao sớm hơn không được trừ.",
    ]);
  });

  it("chỉ chi phí trễ, số ngày giao vắng ⇒ gạch ngang thay vì bịa số", () => {
    const ra = moTaQuyDoi(docThuocTco({ ma: ["gia", "chi_phi_tre"], thamSo: { tyLeTreNgay: "0.002" } }), null);
    expect(ra).toHaveLength(2);
    expect(ra[1]).toContain("số ngày giao yêu cầu là — ngày");
    expect(ra[1]).toContain("quy thành 0.002 × tổng báo giá");
  });
});

describe("`/mo-thau` — phép tính cạnh con số, mã thiếu, cột hạng giá", () => {
  it("tenMa: tên của `MA_TCO`; mã lạ giữ nguyên", () => {
    expect(tenMa("chi_phi_tre")).toBe("Chi phí trễ giao");
    expect(tenMa("chat_luong")).toBe("chat_luong");
  });

  it("moTaThanhPhan: hai mã quy đổi viết phép tính với `nguon`; mã khai thẳng giữ dạng cũ", () => {
    expect(
      moTaThanhPhan(
        { ma: "chi_phi_thanh_toan", donVi: "TIEN", heSo: "1.0000", giaTri: "1933150.68", tien: "1933150.68", nguon: { coSo: "98000000.00", ngayKhai: "0", ngayChuan: "60", tyLe: "0.12" } },
        2,
      ),
    ).toBe("Chi phí thanh toán = max(0, kỳ chuẩn 60 − 0 ngày khai) × 0.12/năm ÷ 365 × 98000000.00 = 1933150.68 — tham số của chính sách phiên bản 2");
    expect(
      moTaThanhPhan(
        { ma: "chi_phi_tre", donVi: "TIEN", heSo: "1.0000", giaTri: "9.00", tien: "9.00", nguon: { coSo: "90.00", ngayKhai: "110", ngayYeuCau: "10", tyLe: "0.001" } },
        null,
      ),
    ).toBe("Chi phí trễ giao = max(0, 110 ngày khai − 10 ngày yêu cầu) × 0.001/ngày × 90.00 = 9.00");
    expect(moTaThanhPhan({ ma: "van_chuyen", donVi: "TIEN", heSo: "1.0000", giaTri: "5.00", tien: "5.00" }, 2)).toBe("van_chuyen · 5.00 × 1.0000 = 5.00 (TIEN)");
    expect(moTaThanhPhan({ ma: "chi_phi_tre", donVi: "TIEN", heSo: null, giaTri: null, tien: null }, 1), "mã quy đổi KHÔNG mang `nguon` ⇒ dạng cũ").toBe(
      "chi_phi_tre · — × — = — (TIEN)",
    );
  });

  it("moTaMaThieu: gọi tên và mã; tổng vượt miền nói bằng lời", () => {
    expect(moTaMaThieu(["van_chuyen", "chi_phi_tre"])).toBe("không hạng — thiếu: Vận chuyển (van_chuyen), Chi phí trễ giao (chi_phi_tre)");
    expect(moTaMaThieu(["TONG_VUOT_MIEN"])).toBe("không hạng — thiếu: tổng vượt miền tiền");
  });

  it("coThuocTco: một mã ngoài giá, hay một hàng thiếu ô ⇒ có; bảng chỉ giá ⇒ không", () => {
    expect(coThuocTco([{ components: [{ ma: "gia" }], maThieu: null }])).toBe(false);
    expect(coThuocTco([{ components: [{ ma: "gia" }] }, { components: [{ ma: "gia" }, { ma: "van_chuyen" }] }])).toBe(true);
    expect(coThuocTco([{ components: [], maThieu: ["chi_phi_tre"] }])).toBe(true);
    expect(coThuocTco([{ components: [], maThieu: [] }])).toBe(false);
    expect(coThuocTco([])).toBe(false);
  });
});
