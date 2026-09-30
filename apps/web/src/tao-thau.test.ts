// ==============================================================================================
// [S1.191 / S3.2c2] PHÉP ĐO CHO CÁC PHÉP TÍNH CỦA MÀN TẠO GÓI THẦU
//
// Mỗi hàm một bảng ca: hai luồng (tổ chức chưa bật, đã bật) × các trạng thái gói mà máy chủ phân biệt. Ca âm của từng
// nút neo vào CHÍNH luật của máy chủ — K4a chỉ cho thu hồi ở DRAFT, lối gửi lại chỉ chạy khi gói nhận báo giá, cạnh về
// DRAFT chỉ ở PENDING_APPROVAL của tổ chức đã bật —, không vào hàm.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import {
  KHUNG_TIN_HIEU_RONG,
  TRAN_LY_DO_BYTE,
  baoSauKhiMo,
  baoSauKhiMoi,
  hangNganSach,
  hienTraVe,
  khungTinHieu,
  loiLyDo,
  loiLyDoGhiNhan,
  nhanLoiMoi,
  nhanTrangThaiGoi,
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

describe("[S1.200 / khoản 258] ngân sách ở lần đọc gói", () => {
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

// =============================================================================================
// [S3.6b2 / K10a] KHUNG TÍN HIỆU CHIA NHỎ GÓI. Thân mẫu dựng đúng hình dạng `lietKeTinHieu` trả qua JSON: mốc là chuỗi ISO,
// bằng chứng là jsonb của `tin_hieu_chia_nho` (khoá theo thứ tự của jsonb).
// =============================================================================================

const BC = { can: 1000000000, goi: ["g1", "g2", "g3"], loai: "PURCHASE_SPLITTING", nhom_hang: "n1", chinh_sach: "p2", cua_so_ngay: 30 };
const GOI = {
  g1: { tieuDe: "Thep 480", trangThai: "OPEN" },
  g2: { tieuDe: "Thep 470", trangThai: "OPEN" },
  g3: { tieuDe: "Thep 490", trangThai: "PENDING_APPROVAL" },
};
const hangLuuLucNop = (ghiNhan: unknown[] = []) => ({
  id: "s1", loai: "PURCHASE_SPLITTING", nguon: "NOP_DUYET", bangChung: BC, doTinCay: "XAC_DINH", giaiThich: "x",
  tinhLuc: "2026-09-30T01:00:00.000Z", nguoiGhi: "u-pm", nguoiGhiTen: "Anh Soạn", ghiNhan,
});
const than = (tinHieu: Record<string, unknown>) => ({ tinHieu: { hienTai: BC, canGhiNhan: true, tinHieu: [hangLuuLucNop()], goi: GOI, nguoiXem: { ghiNhanDuoc: true, lyDo: null }, soNguoiGhiNhanDuoc: 2, ...tinHieu } });

describe("[S3.6b2 / K10a] khung tín hiệu chia nhỏ", () => {
  it("chờ ghi nhận, người đang xem ghi nhận được: tóm tắt nói tập, cửa sổ và cận; bảng gói theo bằng chứng hiện tại, xếp theo tên, đánh dấu gói này; mời bấm", () => {
    const k = khungTinHieu(than({}), "g3");
    expect(k.hien).toBe(true);
    expect(k.tomTat).toBe(
      "Gói này nằm trong 3 gói cùng nhóm hàng nộp duyệt trong 30 ngày, mỗi gói dưới cận 1.000.000.000 mà tổng chạm cận ấy. Gói chỉ mở " +
        "được sau khi một người giữ quyền duyệt — không tạo, không nộp gói nào trong tập ấy — đọc tín hiệu và ghi nhận nó, kèm lý do.",
    );
    expect(k.goi).toEqual([
      { id: "g2", tieuDe: "Thep 470", trangThai: "đã mở", laGoiNay: false },
      { id: "g1", tieuDe: "Thep 480", trangThai: "đã mở", laGoiNay: false },
      { id: "g3", tieuDe: "Thep 490", trangThai: "chờ duyệt", laGoiNay: true },
    ]);
    expect(k.lichSu).toEqual([{ luc: "2026-09-30T01:00:00.000Z", noiDung: "Anh Soạn nộp duyệt; tín hiệu được ghi lúc nộp (3 gói, cận 1.000.000.000)." }]);
    expect([k.choGhiNhan, k.khongDuoc]).toEqual([true, null]);
  });

  it("chờ ghi nhận, người đang xem KHÔNG ghi nhận được: không mời bấm, nói đúng câu của máy chủ", () => {
    const lyDo = "Người tạo hay người nộp một gói trong tín hiệu không ghi nhận được tín hiệu ấy.";
    const k = khungTinHieu(than({ nguoiXem: { ghiNhanDuoc: false, lyDo } }), "g3");
    expect([k.hien, k.choGhiNhan, k.khongDuoc]).toEqual([true, false, lyDo]);
    // Máy chủ nói ghi nhận được mà tín hiệu không còn chờ ⇒ không mời bấm (không có gì để ghi nhận).
    expect(khungTinHieu(than({ canGhiNhan: false }), "g3").choGhiNhan).toBe(false);
    // Thân lạ ở chỗ người xem ⇒ không mời bấm, không bịa câu.
    expect([khungTinHieu(than({ nguoiXem: null }), "g3").choGhiNhan, khungTinHieu(than({ nguoiXem: null }), "g3").khongDuoc]).toEqual([false, null]);
  });

  it("§8.10: không ai trong tổ chức ghi nhận được ⇒ tóm tắt nói tổ chức kẹt; một người thì không", () => {
    expect(khungTinHieu(than({ soNguoiGhiNhanDuoc: 0 }), "g3").tomTat).toContain("Trong tổ chức hiện không ai ghi nhận được tín hiệu này");
    expect(khungTinHieu(than({ soNguoiGhiNhanDuoc: 1 }), "g3").tomTat).not.toContain("không ai ghi nhận được");
  });

  it("đã ghi nhận trên bằng chứng BẰNG hiện tại: tóm tắt nói tín hiệu không chặn nữa; lịch sử có lần ghi nhận với tên và lý do", () => {
    const k = khungTinHieu(
      than({
        canGhiNhan: false,
        nguoiXem: { ghiNhanDuoc: false, lyDo: null },
        soNguoiGhiNhanDuoc: null,
        tinHieu: [hangLuuLucNop([{ id: "a1", lyDo: "Ba cong trinh", nguoi: "u-pm3", nguoiTen: "Chị Duyệt", luc: "2026-09-30T02:00:00.000Z" }])],
      }),
      "g3",
    );
    expect(k.tomTat).toContain("Tín hiệu đã được ghi nhận — nó không chặn lần mở gói nữa.");
    expect(k.lichSu.map((d) => d.noiDung)).toEqual([
      "Anh Soạn nộp duyệt; tín hiệu được ghi lúc nộp (3 gói, cận 1.000.000.000).",
      "Chị Duyệt ghi nhận: «Ba cong trinh».",
    ]);
    expect([k.choGhiNhan, k.khongDuoc]).toEqual([false, null]);
  });

  it("bằng chứng TRÔI: ghi nhận cũ trên tập cũ không phải ghi nhận của tập hiện tại; hàng `GHI_NHAN` nói tập đã đổi", () => {
    const cu = { ...BC, goi: ["g0", "g1", "g2", "g3"] };
    const k = khungTinHieu(
      than({
        tinHieu: [
          { ...hangLuuLucNop([{ id: "a1", lyDo: "cu", nguoi: "u", nguoiTen: "Chị Duyệt", luc: "2026-09-30T02:00:00.000Z" }]), bangChung: cu },
          { ...hangLuuLucNop(), id: "s2", nguon: "GHI_NHAN", nguoiGhiTen: "Chị Duyệt", tinhLuc: "2026-09-30T03:00:00.000Z" },
        ],
      }),
      "g3",
    );
    expect(k.tomTat).toContain("Gói chỉ mở được sau khi");
    expect(k.goi.map((g) => g.id), "bảng gói vẽ bằng chứng HIỆN TẠI").toEqual(["g2", "g1", "g3"]);
    expect(k.lichSu.map((d) => d.noiDung)).toEqual([
      "Anh Soạn nộp duyệt; tín hiệu được ghi lúc nộp (4 gói, cận 1.000.000.000).",
      "Chị Duyệt ghi nhận: «cu».",
      "Chị Duyệt ghi nhận khi tập gói đã đổi sau lần nộp — tín hiệu được ghi lại theo tập hiện tại (3 gói, cận 1.000.000.000).",
    ]);
  });

  it("tín hiệu lúc nộp không còn đúng (hiện tại `null`): khung vẫn hiện, nói không cần ghi nhận, bảng gói vẽ hàng đã lưu mới nhất", () => {
    const k = khungTinHieu(than({ hienTai: null, canGhiNhan: false, nguoiXem: { ghiNhanDuoc: false, lyDo: null }, soNguoiGhiNhanDuoc: null }), "g3");
    expect(k.hien).toBe(true);
    expect(k.tomTat).toBe("Tín hiệu ghi lúc nộp không còn đúng: tập gói hiện tại không chạm cận nào, nên lần mở gói không cần ghi nhận.");
    expect(k.goi.map((g) => g.id)).toEqual(["g2", "g1", "g3"]);
    expect(k.choGhiNhan).toBe(false);
  });

  it("gói không có tín hiệu nào, hay thân lạ: khung rỗng, ẩn; tên gói thiếu thì dùng id, trạng thái lạ nói nguyên văn", () => {
    expect(khungTinHieu({ tinHieu: { hienTai: null, canGhiNhan: false, tinHieu: [], goi: {}, nguoiXem: { ghiNhanDuoc: false, lyDo: null }, soNguoiGhiNhanDuoc: null } }, "g")).toEqual(KHUNG_TIN_HIEU_RONG);
    for (const la of [null, undefined, "x", {}, { tinHieu: null }, { tinHieu: [] }]) expect(khungTinHieu(la, "g")).toEqual(KHUNG_TIN_HIEU_RONG);
    const k = khungTinHieu(than({ goi: { g1: { tieuDe: "Thep 480", trangThai: "LA" } } }), "g3");
    expect(k.goi).toEqual([
      { id: "g2", tieuDe: "g2", trangThai: "—", laGoiNay: false },
      { id: "g3", tieuDe: "g3", trangThai: "—", laGoiNay: true },
      { id: "g1", tieuDe: "Thep 480", trangThai: "LA", laGoiNay: false },
    ]);
  });

  it("bảng gói xếp theo TÊN, không theo id của bằng chứng (lượt đi thử T4 thấy «2, 1, 3»): số trong tên so theo giá trị, cùng tên thì theo id", () => {
    const goi = {
      g1: { tieuDe: "Goi 10", trangThai: "OPEN" },
      g2: { tieuDe: "Goi 9", trangThai: "OPEN" },
      g3: { tieuDe: "Goi 9", trangThai: "PENDING_APPROVAL" },
    };
    expect(khungTinHieu(than({ goi }), "g3").goi.map((g) => g.id)).toEqual(["g2", "g3", "g1"]);
    expect(khungTinHieu(than({ goi, hienTai: { ...BC, goi: ["g3", "g2", "g1"] } }), "g3").goi.map((g) => g.id), "không phụ thuộc thứ tự vào").toEqual(["g2", "g3", "g1"]);
  });

  it("trạng thái gói nói bằng lời", () => {
    expect(["DRAFT", "PENDING_APPROVAL", "OPEN", "CLOSED", "UNSEALED", "CANCELLED", "", 7].map(nhanTrangThaiGoi)).toEqual([
      "đang soạn", "chờ duyệt", "đã mở", "đã đóng", "đã mở thầu", "đã huỷ", "—", "—",
    ]);
  });

  it("lý do ghi nhận: bắt buộc sau khi cắt khoảng trắng, trần tính bằng BYTE như máy chủ", () => {
    expect(loiLyDoGhiNhan("   ")).toBe("Cần ghi lý do ghi nhận — lý do vào sổ kiểm toán cùng tên người ghi nhận.");
    expect(loiLyDoGhiNhan(" Ba cong trinh ")).toBeNull();
    expect(loiLyDoGhiNhan("a".repeat(TRAN_LY_DO_BYTE))).toBeNull();
    expect(loiLyDoGhiNhan("ệ".repeat(Math.floor(TRAN_LY_DO_BYTE / 3) + 1))).toContain("Lý do dài quá");
  });
});
