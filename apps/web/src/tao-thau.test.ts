// ==============================================================================================
// [S1.191 / S3.2c2] PHÉP ĐO CHO CÁC PHÉP TÍNH CỦA MÀN TẠO GÓI THẦU
//
// Mỗi hàm một bảng ca: hai luồng (tổ chức chưa bật, đã bật) × các trạng thái gói mà máy chủ phân biệt. Ca âm của từng
// nút neo vào CHÍNH luật của máy chủ — K4a chỉ cho thu hồi ở DRAFT, lối gửi lại chỉ chạy khi gói nhận báo giá, cạnh về
// DRAFT chỉ ở PENDING_APPROVAL của tổ chức đã bật —, không vào hàm.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import {
  TRAN_LY_DO_BYTE,
  baoSauKhiMo,
  baoSauKhiMoi,
  hangNganSach,
  hienTraVe,
  loiLyDo,
  nhanLoiMoi,
  nhanTrangThaiLoiMoi,
  nutLoiMoi,
  thuTuBuoc,
  tuDocNganSach,
} from "./tao-thau.js";

const TRANG_THAI_GOI = ["DRAFT", "PENDING_APPROVAL", "OPEN", "CLOSED", "BAFO_OPEN", "AWARDED", "CANCELLED"] as const;

describe("[S1.191 / S3.2c2] thứ tự bước", () => {
  it("tổ chức đã bật: mời (b5) TRƯỚC ngân sách và phê duyệt (b4); chưa bật: thứ tự MVP1", () => {
    expect(thuTuBuoc(true)).toEqual(["b2", "b3", "b5", "b4"]);
    expect(thuTuBuoc(false)).toEqual(["b2", "b3", "b4", "b5"]);
  });
});

describe("[S1.191 / S3.2c2] nhãn trạng thái lời mời", () => {
  it("năm trạng thái của CHECK `076` nói bằng lời; lạ thì nguyên văn; rỗng hay không phải chuỗi thì gạch", () => {
    expect(["UNSENT", "SENT", "REVOKED", "ACCEPTED", "DECLINED"].map(nhanTrangThaiLoiMoi)).toEqual(["chưa gửi", "đã gửi", "đã thu hồi", "đã nhận", "đã từ chối"]);
    expect(nhanTrangThaiLoiMoi("LA")).toBe("LA");
    expect(nhanTrangThaiLoiMoi("")).toBe("—");
    expect(nhanTrangThaiLoiMoi(undefined)).toBe("—");
  });

  it("[S1.193 / K6] nhãn «mời sau khi ký» chỉ khi cờ là `true` — cờ lạ, thiếu hay `false` thì chỉ trạng thái", () => {
    expect(nhanLoiMoi("SENT", true)).toBe("đã gửi · mời sau khi ký");
    expect(nhanLoiMoi("UNSENT", true)).toBe("chưa gửi · mời sau khi ký");
    for (const co of [false, undefined, null, "true", 1]) expect(nhanLoiMoi("UNSENT", co), String(co)).toBe("chưa gửi");
  });
});

describe("[S1.191 / S3.2c2] hai nút của một dòng lời mời", () => {
  it("tổ chức chưa bật: cả hai nút ở mọi trạng thái gói — hợp đồng MVP1, máy chủ tự từ chối", () => {
    for (const g of TRANG_THAI_GOI) expect(nutLoiMoi(false, g, false), g).toEqual({ guiLai: true, thuHoi: true });
  });

  it("tổ chức đã bật: thu hồi ĐÚNG ở DRAFT (K4a); gửi lại ĐÚNG khi gói nhận báo giá — OPEN, BAFO_OPEN", () => {
    const ra = Object.fromEntries(TRANG_THAI_GOI.map((g) => [g, nutLoiMoi(true, g, false)]));
    expect(ra).toEqual({
      DRAFT: { guiLai: false, thuHoi: true },
      PENDING_APPROVAL: { guiLai: false, thuHoi: false },
      OPEN: { guiLai: true, thuHoi: false },
      CLOSED: { guiLai: false, thuHoi: false },
      BAFO_OPEN: { guiLai: true, thuHoi: false },
      AWARDED: { guiLai: false, thuHoi: false },
      CANCELLED: { guiLai: false, thuHoi: false },
    });
  });

  it("lời mời đã thu hồi: không nút nào, ở cả hai luồng", () => {
    for (const daBat of [false, true]) {
      for (const g of TRANG_THAI_GOI) expect(nutLoiMoi(daBat, g, true), `${String(daBat)} ${g}`).toEqual({ guiLai: false, thuHoi: false });
    }
  });
});

describe("[S1.191 / S3.2c2] câu báo sau một lần mời", () => {
  it("UNSENT không nhãn (mời ở DRAFT): không lỗi, nói link CHƯA đi và đi lúc mở gói", () => {
    const b = baoSauKhiMoi({ status: "UNSENT", moiSauKhiKy: false });
    expect(b.loi).toBe(false);
    expect(b.chu).toMatch(/CHƯA đi/u);
    expect(b.chu).toMatch(/mở/u);
  });

  it("UNSENT có nhãn (mời thêm ở OPEN, gửi hỏng): LỖI, chỉ đường «Gửi lại link»", () => {
    const b = baoSauKhiMoi({ status: "UNSENT", moiSauKhiKy: true });
    expect(b.loi).toBe(true);
    expect(b.chu).toMatch(/Gửi lại link/u);
  });

  it("SENT (MVP1, hay mời thêm ở OPEN gửi được): câu cũ", () => {
    for (const moiSauKhiKy of [false, true]) {
      const b = baoSauKhiMoi({ status: "SENT", moiSauKhiKy });
      expect(b).toEqual({ loi: false, chu: "Đã mời. Link đi thẳng tới bộ gửi — màn này không bao giờ thấy mã mời." });
    }
  });
});

describe("[S1.191 / S3.2c2] câu báo sau lần mở gói", () => {
  it("tổ chức chưa bật: câu cũ, bất kể thân", () => {
    for (const ds of [[], ["x"], undefined]) expect(baoSauKhiMo(false, ds).loi).toBe(false);
    expect(baoSauKhiMo(false, []).chu).not.toMatch(/Link mời/u);
  });

  it("[S1.193] cả hai luồng nói «Đã mở gói» — mở THẦU là CLOSED→UNSEALED (spec S3 §3.3)", () => {
    for (const [daBat, ds] of [[false, []], [true, []], [true, ["a"]]] as const) {
      expect(baoSauKhiMo(daBat, ds).chu, `${String(daBat)} ${String(ds.length)}`).toMatch(/^Đã mở gói\. /u);
      expect(baoSauKhiMo(daBat, ds).chu).not.toMatch(/mở thầu/iu);
    }
  });

  it("tổ chức đã bật: rỗng ⇒ mọi link đã đi; không rỗng ⇒ LỖI, nói ĐÚNG số link chưa gửi", () => {
    const du = baoSauKhiMo(true, []);
    expect(du.loi).toBe(false);
    expect(du.chu).toMatch(/mọi nhà cung cấp/u);
    const b = baoSauKhiMo(true, ["a", "b"]);
    expect(b.loi).toBe(true);
    expect(b.chu).toMatch(/Nhưng 2 link mời CHƯA gửi được/u);
  });

  it("tổ chức đã bật mà thân không mang danh sách: coi như rỗng — máy chủ của S3.2b2 luôn trả mảng", () => {
    expect(baoSauKhiMo(true, undefined).loi).toBe(false);
  });
});

describe("[S1.191 / S3.2c2] nút trả về soạn thảo và lý do", () => {
  it("ĐÚNG khi tổ chức đã bật và gói đang PENDING_APPROVAL (`077`)", () => {
    for (const g of TRANG_THAI_GOI) {
      expect(hienTraVe(true, g), g).toBe(g === "PENDING_APPROVAL");
      expect(hienTraVe(false, g), g).toBe(false);
    }
  });

  it("lý do bắt buộc, cắt khoảng trắng, trần 2000 BYTE UTF-8 — cùng số và đơn vị với `returnRfqToDraft`", () => {
    expect(TRAN_LY_DO_BYTE).toBe(2000);
    expect(loiLyDo("")).not.toBeNull();
    expect(loiLyDo("   ")).not.toBeNull();
    expect(loiLyDo("Them nha cung cap thu nam")).toBeNull();
    expect(loiLyDo("a".repeat(2000))).toBeNull();
    expect(loiLyDo("a".repeat(2001))).toMatch(/2000/u);
    // 700 chữ "ế" là 700 ký tự nhưng 2100 byte: máy chủ từ chối, nên màn cũng phải từ chối.
    expect(loiLyDo("ế".repeat(700))).toMatch(/2000/u);
    expect(loiLyDo("ế".repeat(666))).toBeNull();
  });
});

describe("[S1.9101 / khoản 258] ngân sách ở lần đọc gói", () => {
  it("màn TỰ đọc chỉ khi người dùng là người tạo gói, ở mọi trạng thái; người khác đọc bằng nút — lần từ chối không thành nhịp đọc gói", () => {
    expect(tuDocNganSach("u1", "u1"), "người tạo").toBe(true);
    expect(tuDocNganSach("u2", "u1"), "người khác, kể cả người duyệt").toBe(false);
    expect(tuDocNganSach("", undefined), "chưa biết người dùng: không coi là người tạo").toBe(false);
    expect(tuDocNganSach("", ""), "userId rỗng khớp createdBy rỗng vẫn không phải người tạo").toBe(false);
    expect(tuDocNganSach("u1", null)).toBe(false);
  });

  it("năm hàng đúng năm thứ chữ ký ràng vào; gói chưa có ngân sách hay thân lạ thì gạch", () => {
    expect(
      hangNganSach({ estimatedValue: "150000000.00", currency: "VND", policyVersion: 2, tierTuSoTien: "100000000.00", requiresDualApproval: true }),
    ).toEqual([
      ["Giá trị ước lượng", "150000000.00"],
      ["Tiền tệ", "VND"],
      ["Phiên bản chính sách", "2"],
      ["Bậc từ", "100000000.00"],
      ["Cần hai người duyệt", "có"],
    ]);
    expect(hangNganSach({ estimatedValue: null, currency: null, policyVersion: null, tierTuSoTien: null, requiresDualApproval: false }).map((h) => h[1])).toEqual([
      null,
      null,
      null,
      null,
      "không",
    ]);
    expect(hangNganSach(undefined).map((h) => h[1])).toEqual([null, null, null, null, null]);
  });
});
