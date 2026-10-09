// ==============================================================================================
// [S1.191 / S3.2c2] PHÉP ĐO CHO CÁC PHÉP TÍNH CỦA MÀN TẠO GÓI THẦU
//
// Mỗi hàm một bảng ca: hai luồng (tổ chức chưa bật, đã bật) × các trạng thái gói mà máy chủ phân biệt. Ca âm của từng
// nút neo vào CHÍNH luật của máy chủ — K4a chỉ cho thu hồi ở DRAFT, lối gửi lại chỉ chạy khi gói nhận báo giá, cạnh về
// DRAFT chỉ ở PENDING_APPROVAL của tổ chức đã bật —, không vào hàm.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { RFQ_STATUSES, RFQ_TRANSITIONS, SO_NGAY_GIAO_TOI_DA as SO_NGAY_GIAO_TOI_DA_GOI } from "@trustprocure/rfq";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import * as GoiNgoaiLe from "@trustprocure/invitation";
import {
  SO_NGAY_GIAO_TOI_DA,
  canhBaoSoNgayGiao,
  docSoNgayGiao,
  hienDatSoNgayGiao,
  nhanSoNgayGiao,
  LOAI_NGOAI_LE,
  LOAI_NGOAI_LE_HAU_KIEM,
  MA_LY_DO_NGOAI_LE,
  SAN_GIAI_TRINH_OTHER_BYTE,
  TRAN_GIAI_TRINH_BYTE,
  chiDanChot,
  cungLanNop,
  docNhaCungCapChon,
  loaiNgoaiLeGoiY,
  loiGiaiTrinh,
  nhanCanhTranh,
  nhanCo,
  nhanLoaiNgoaiLe,
  nhanMaLyDo,
  nhanXacMinhNgan,
  tenKemMst,
  vanBanAnToan,
} from "./tao-thau.js";
import {
  KHUNG_TIN_HIEU_RONG,
  TRAN_LY_DO_BYTE,
  baoSauKhiMo,
  baoSauKhiMoi,
  hangNganSach,
  hienCotHangChuan,
  hienTraVe,
  khungTinHieu,
  loiLyDo,
  loiLyDoGhiNhan,
  nhanAnhXa,
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

/**
 * [S1.240 / khoản 276 / ADR-128] Trạng thái gói từ lần mở thầu đầu tiên — SUY từ máy trạng thái (`RFQ_TRANSITIONS` của
 * `@trustprocure/rfq`): `UNSEALED` và mọi trạng thái đi tới được từ nó, trừ `CANCELLED`. Cùng phép suy mà
 * `packages/invitation/src/invitation.int.test.ts` dùng để ghim `RFQ_STATUSES_AFTER_UNSEAL` — tập máy chủ chặn thu hồi —, nên
 * bảng dưới đo màn theo ĐÚNG tập ấy mà không import gói `invitation` (hằng ấy không đi qua cửa `index.ts` của gói).
 */
function sauMoThau(): ReadonlySet<string> {
  const toiDuoc = new Set<string>(["UNSEALED"]);
  for (let doi = true; doi; ) {
    doi = false;
    for (const [tu, den] of RFQ_TRANSITIONS) {
      if (toiDuoc.has(tu) && !toiDuoc.has(den)) {
        toiDuoc.add(den);
        doi = true;
      }
    }
  }
  toiDuoc.delete("CANCELLED");
  return toiDuoc;
}

describe("[S1.191 / S3.2c2] hai nút của một dòng lời mời", () => {
  it("tổ chức chưa bật: ~~cả hai nút ở mọi trạng thái gói~~ [S1.240 / khoản 276] *Gửi lại link* ở mọi trạng thái gói — hợp đồng MVP1, máy chủ tự từ chối; *Thu hồi* ẩn sau lần mở thầu", () => {
    const ra = Object.fromEntries(TRANG_THAI_GOI.map((g) => [g, nutLoiMoi(false, g, false)]));
    expect(ra).toEqual({
      DRAFT: { guiLai: true, thuHoi: true },
      PENDING_APPROVAL: { guiLai: true, thuHoi: true },
      OPEN: { guiLai: true, thuHoi: true },
      CLOSED: { guiLai: true, thuHoi: true },
      BAFO_OPEN: { guiLai: true, thuHoi: false },
      AWARDED: { guiLai: true, thuHoi: false },
      CANCELLED: { guiLai: true, thuHoi: true },
    });
  });

  // [S1.240 / khoản 276] Bảng ĐỦ mười một trạng thái của `RFQ_STATUSES`, hai luồng: *Thu hồi* không bao giờ hiện ở trạng thái mà máy
  // chủ chặn thu hồi (ADR-128 ③ — sau lần mở thầu đầu tiên), và ở tổ chức chưa bật thì hiện ở MỌI trạng thái còn lại (kể cả
  // `CANCELLED`: thu hồi ở đó vẫn là quyền đóng phiên khách — ADR-128). Tổ chức đã bật giữ luật K4a (chỉ DRAFT), vốn đã hẹp hơn.
  it("[S1.240 / khoản 276] *Thu hồi* ẩn ở ĐÚNG các trạng thái sau lần mở thầu (suy từ `RFQ_TRANSITIONS`) ở cả hai luồng; *Gửi lại link* không đổi", () => {
    const sau = sauMoThau();
    expect([...sau].sort(), "phép suy phải ra đúng sáu trạng thái ADR-128 ③ kể").toEqual(
      ["AWARDED", "BAFO_CLOSED", "BAFO_OPEN", "BAFO_UNSEALED", "EVALUATING", "UNSEALED"],
    );
    for (const g of RFQ_STATUSES) {
      expect(nutLoiMoi(false, g, false), `chưa bật · ${g}`).toEqual({ guiLai: true, thuHoi: !sau.has(g) });
      expect(nutLoiMoi(true, g, false).thuHoi, `đã bật · ${g}`).toBe(g === "DRAFT");
      expect(nutLoiMoi(true, g, false).guiLai, `đã bật · ${g}`).toBe(g === "OPEN" || g === "BAFO_OPEN");
    }
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

describe("[S1.234 / S4.3b] cột hàng chuẩn của bảng hạng mục", () => {
  it("năm trạng thái nói bằng lời; hồi tố và lý do bác hiện ra; trạng thái lạ ⇒ —", () => {
    expect(nhanAnhXa({ trangThai: "TU_DONG", hangChuan: { ma: "THEP-D10" }, lyDo: null })).toBe("Tự động — THEP-D10");
    expect(nhanAnhXa({ trangThai: "TU_DONG", hangChuan: { ma: "THEP-D10" }, lyDo: "CHUAN_HOA_HOI_TO" })).toBe("Tự động — THEP-D10 (chuẩn hoá hồi tố)");
    expect(nhanAnhXa({ trangThai: "NGUOI_DUYET", hangChuan: { ma: "THEP-D12" }, lyDo: null })).toBe("Đã duyệt — THEP-D12");
    expect(nhanAnhXa({ trangThai: "NGUOI_DUYET", hangChuan: null, lyDo: null })).toBe("Không có hàng chuẩn tương ứng");
    expect(nhanAnhXa({ trangThai: "NGUOI_DUYET", hangChuan: null, lyDo: "vat lieu dia phuong" })).toBe("Không có hàng chuẩn tương ứng — vat lieu dia phuong");
    expect(nhanAnhXa({ trangThai: "CHO_DUYET", hangChuan: null, lyDo: null })).toBe("Chờ người quản lý dữ liệu duyệt");
    expect(nhanAnhXa({ trangThai: "CHUA_CHUAN_HOA", hangChuan: null, lyDo: null })).toBe("Chưa chuẩn hoá");
    expect(nhanAnhXa({ trangThai: "LA", hangChuan: null, lyDo: null })).toBe("—");
  });
});

describe("[S1.234 / lượt soi S4.3b, L3] cột hàng chuẩn chỉ hiện khi nó nói được điều gì", () => {
  it("tổ chức có hàng chuẩn đang dùng ⇒ hiện; chưa có mà mọi dòng chưa chuẩn hoá ⇒ ẩn; còn ánh xạ cũ ⇒ hiện; thân lạ ⇒ ẩn", () => {
    expect(hienCotHangChuan({ coHangChuan: true, dong: [] })).toBe(true);
    expect(hienCotHangChuan({ coHangChuan: false, dong: [{ trangThai: "CHUA_CHUAN_HOA" }, { trangThai: "CHUA_CHUAN_HOA" }] })).toBe(false);
    expect(hienCotHangChuan({ coHangChuan: false, dong: [{ trangThai: "CHUA_CHUAN_HOA" }, { trangThai: "NGUOI_DUYET" }] })).toBe(true);
    for (const la of [undefined, null, {}, { coHangChuan: "true" }, { dong: "x" }]) expect(hienCotHangChuan(la), JSON.stringify(la)).toBe(false);
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
    // Không gì cần ghi nhận ⇒ không câu «vì sao không», kể cả khi thân còn mang một lý do.
    expect(khungTinHieu(than({ canGhiNhan: false, nguoiXem: { ghiNhanDuoc: false, lyDo } }), "g3").khongDuoc).toBeNull();
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

  it("gói không còn chờ mà tập gói đã đổi sau lần ghi nhận: lần ghi nhận trên tập CŨ không được nói là ghi nhận tập hiện tại", () => {
    const k = khungTinHieu(
      than({
        canGhiNhan: false,
        nguoiXem: { ghiNhanDuoc: false, lyDo: null },
        soNguoiGhiNhanDuoc: null,
        tinHieu: [{ ...hangLuuLucNop([{ id: "a1", lyDo: "cu", nguoi: "u", nguoiTen: "Chị Duyệt", luc: "2026-09-30T02:00:00.000Z" }]), bangChung: { ...BC, goi: ["g0", "g1", "g2", "g3"] } }],
      }),
      "g3",
    );
    expect(k.tomTat).toBe("Gói này nằm trong 3 gói cùng nhóm hàng nộp duyệt trong 30 ngày, mỗi gói dưới cận 1.000.000.000 mà tổng chạm cận ấy.");
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

// ==============================================================================================
// [S1.273 / S3.3e1] NGOẠI LỆ, NHÀ CUNG CẤP CÓ SẴN, CHỈ DẪN THEO MÃ CHỐT
// ==============================================================================================

describe("[S1.273 / S3.3e1] bản sao để đọc của ba tập đóng và hai trần — khớp hằng của gói máy chủ", () => {
  it("loại, mã lý do, sàn OTHER và trần giải trình đúng bằng `packages/invitation/src/ngoai-le.ts`", () => {
    expect([...LOAI_NGOAI_LE]).toEqual([...GoiNgoaiLe.LOAI_NGOAI_LE]);
    // [S1.282 / S3.5b] Loại hậu kiểm là tập RIÊNG ở cả hai bên — ô chọn của `/tao-thau` không mời lập nó ở DRAFT.
    expect([...LOAI_NGOAI_LE_HAU_KIEM]).toEqual([...GoiNgoaiLe.LOAI_NGOAI_LE_HAU_KIEM]);
    expect(LOAI_NGOAI_LE_HAU_KIEM.some((l) => (LOAI_NGOAI_LE as readonly string[]).includes(l))).toBe(false);
    expect([...MA_LY_DO_NGOAI_LE]).toEqual([...GoiNgoaiLe.MA_LY_DO_NGOAI_LE]);
    expect(SAN_GIAI_TRINH_OTHER_BYTE).toBe(GoiNgoaiLe.SAN_GIAI_TRINH_OTHER_BYTE);
    expect(TRAN_GIAI_TRINH_BYTE).toBe(GoiNgoaiLe.TRAN_GIAI_TRINH_BYTE);
  });

  it("mọi loại và mọi mã lý do có nhãn tiếng Việt; mã lạ nói nguyên văn", () => {
    for (const l of LOAI_NGOAI_LE) expect(nhanLoaiNgoaiLe(l)).not.toBe(l);
    for (const m of MA_LY_DO_NGOAI_LE) expect(nhanMaLyDo(m)).not.toBe(m);
    // [S1.282 / S3.5b] Loại hậu kiểm có nhãn từ vòng này (bảng của `/mo-thau` đọc nó); mã lạ vẫn nguyên văn.
    for (const l of LOAI_NGOAI_LE_HAU_KIEM) expect(nhanLoaiNgoaiLe(l)).not.toBe(l);
    expect(nhanLoaiNgoaiLe("LOW_ACTUAL_COMPETITION")).toBe("Cạnh tranh thực tế thấp (hậu kiểm)");
    expect(nhanLoaiNgoaiLe("LOAI_LA")).toBe("LOAI_LA");
    expect(nhanMaLyDo(undefined)).toBe("—");
  });
});

describe("[S1.273 / S3.3e1] giải trình ngoại lệ — cùng luật với hàm gói, đếm BYTE", () => {
  it("rỗng sau khi cắt, quá trần, OTHER dưới sàn ⇒ câu lỗi; đúng sàn ⇒ hợp lệ; mã khác không đòi sàn", () => {
    expect(loiGiaiTrinh("EMERGENCY", "   ")).toMatch(/^Cần giải trình/u);
    expect(loiGiaiTrinh("EMERGENCY", "a".repeat(2001))).toMatch(/2000 byte/u);
    expect(loiGiaiTrinh("EMERGENCY", "ngắn")).toBeNull();
    // 33 chữ «ệ» = 99 byte UTF-8 (3 byte mỗi chữ): dưới sàn tính bằng BYTE dù chỉ 33 ký tự; thêm một byte là đủ.
    expect(loiGiaiTrinh("OTHER", "ệ".repeat(33))).toMatch(/từ 100 byte trở lên \(hiện 99\)/u);
    expect(loiGiaiTrinh("OTHER", `${"ệ".repeat(33)}a`)).toBeNull();
  });
});

describe("[S1.273 / S3.3e1] loại ngoại lệ chọn sẵn theo số lời mời còn sống — khớp chặt của K2 (`107` ⑶)", () => {
  it("0 ⇒ không loại nào (danh sách rỗng không ngoại lệ nào cứu); 1 ⇒ SINGLE_SOURCE; từ 2 ⇒ LIMITED_COMPETITION", () => {
    expect([0, 1, 2, 5].map(loaiNgoaiLeGoiY)).toEqual([null, "SINGLE_SOURCE", "LIMITED_COMPETITION", "LIMITED_COMPETITION"]);
  });
});

describe("[S1.273 / S3.3e1] chỉ dẫn theo mã chốt — câu máy chủ vẫn đứng trước, câu này nói việc phải làm", () => {
  it("bốn mã của S3.3 có câu; người không giữ quyền mời được bảo nhờ người mời được (trừ K5 — việc của người duyệt)", () => {
    for (const ma of ["K2_THIEU_CANH_TRANH", "K2_DAU_THAU_CHINH_THUC", "K3_KHONG_XOAY_VONG", "K5_THIEU_CHU_KY_DOC_LAP"]) {
      expect(Object.hasOwn(CHOT_VAO_SO, ma), `${ma} là mã có thật của bảng`).toBe(true);
      expect(chiDanChot(ma, true), ma).not.toBeNull();
    }
    expect(chiDanChot("K2_THIEU_CANH_TRANH", false)).toMatch(/nhờ người tạo gói hay người giữ quyền mời/u);
    expect(chiDanChot("K2_THIEU_CANH_TRANH", true)).not.toMatch(/nhờ người tạo gói/u);
    expect(chiDanChot("K5_THIEU_CHU_KY_DOC_LAP", false)).not.toMatch(/nhờ người tạo gói/u);
  });

  it("K2: tên ngoại lệ của câu máy chủ quy về nhãn ô chọn, chỗ làm trên màn, danh sách rỗng không cứu được; K3: nhà cung cấp mới phải đếm được", () => {
    expect(chiDanChot("K2_THIEU_CANH_TRANH", true)).toMatch(/SINGLE_SOURCE là «Một nguồn duy nhất», LIMITED_COMPETITION là «Cạnh tranh hạn chế»/u);
    expect(chiDanChot("K2_THIEU_CANH_TRANH", true)).toMatch(/Danh sách rỗng thì không ngoại lệ nào cứu/u);
    expect(chiDanChot("K3_KHONG_XOAY_VONG", true)).toMatch(/cũng phải đếm được/u);
    expect(chiDanChot("K5_THIEU_CHU_KY_DOC_LAP", true)).toMatch(/^Nhờ một người giữ quyền duyệt/u);
  });

  it("[lượt đi thử T4] câu chỉ dẫn KHÔNG nhắc lại câu của máy chủ: không cụm sáu chữ nào của thông điệp lặp trong chỉ dẫn", () => {
    for (const ma of ["K2_THIEU_CANH_TRANH", "K2_DAU_THAU_CHINH_THUC", "K3_KHONG_XOAY_VONG", "K5_THIEU_CHU_KY_DOC_LAP"] as const) {
      const may = CHOT_VAO_SO[ma].thongDiep.toLowerCase().split(/\s+/u);
      const chiDan = (chiDanChot(ma, true) ?? "").toLowerCase();
      for (let i = 0; i + 6 <= may.length; i += 1) expect(chiDan, `${ma}: «${may.slice(i, i + 6).join(" ")}»`).not.toContain(may.slice(i, i + 6).join(" "));
    }
  });

  it("mã khác, không mã, kiểu lạ ⇒ null — màn chỉ in câu của máy chủ", () => {
    expect(chiDanChot("K1_THIEU_BAC", true)).toBeNull();
    expect(chiDanChot(undefined, true)).toBeNull();
    expect(chiDanChot(42, true)).toBeNull();
  });

  // [S1.282 / S3.5b] Tám mã của trao thầu theo bậc (ADR-154) có câu; chỉ K2b *thiếu cạnh tranh thực* là việc của người giữ quyền mời.
  const MA_TRAO_THAU = [
    "K7_KHONG_BAC_GHIM", "K7_LECH_TIEN_TE", "K7_DAU_THAU_CHINH_THUC", "K7_SAI_VAI", "K7_TAC_GIA_CHINH_SACH",
    "K2B_THIEU_CANH_TRANH_THUC", "K2B_NGOAI_LE_SAI_TRANG_THAI", "K5B_THIEU_CHU_KY_DOC_LAP",
  ] as const;
  it("[S1.282 / S3.5b] tám mã của trao thầu theo bậc có câu, không nhắc lại câu máy chủ; K2b trỏ khối «Ngoại lệ hậu kiểm» và chỉ nó nhờ người mời được", () => {
    for (const ma of MA_TRAO_THAU) {
      expect(Object.hasOwn(CHOT_VAO_SO, ma), `${ma} là mã có thật của bảng`).toBe(true);
      expect(chiDanChot(ma, true), ma).not.toBeNull();
      const may = CHOT_VAO_SO[ma].thongDiep.toLowerCase().split(/\s+/u);
      const chiDan = (chiDanChot(ma, true) ?? "").toLowerCase();
      for (let i = 0; i + 6 <= may.length; i += 1) expect(chiDan, `${ma}: «${may.slice(i, i + 6).join(" ")}»`).not.toContain(may.slice(i, i + 6).join(" "));
      if (ma === "K2B_THIEU_CANH_TRANH_THUC") {
        expect(chiDanChot(ma, true)).toMatch(/khối «Ngoại lệ hậu kiểm» ở bước 7/u);
        expect(chiDanChot(ma, true)).toMatch(/LOW_ACTUAL_COMPETITION/u);
        expect(chiDanChot(ma, false)).toMatch(/nhờ người tạo gói hay người giữ quyền mời/u);
      } else {
        expect(chiDanChot(ma, false), ma).toBe(chiDanChot(ma, true));
        expect(chiDanChot(ma, false), ma).not.toMatch(/nhờ người tạo gói/u);
      }
    }
    expect(chiDanChot("K5B_THIEU_CHU_KY_DOC_LAP", true)).toMatch(/^Chữ ký đã có vẫn còn\./u);
  });
});

describe("[S1.273 / S3.3e1 · lượt soi TRUNG-2] câu số NHÓM của K2", () => {
  it("đủ, chưa đủ, gói chưa có bậc; thân không mang khối ⇒ null", () => {
    expect(nhanCanhTranh({ soNhomDemDuoc: 2, toiThieu: 2 })).toMatch(/^Đếm được 2\/2 nhóm .* — đủ\. Nhà cung cấp chung mã số thuế gốc/u);
    expect(nhanCanhTranh({ soNhomDemDuoc: 1, toiThieu: 3 })).toMatch(/^Đếm được 1\/3 nhóm .* chưa đủ/u);
    expect(nhanCanhTranh({ soNhomDemDuoc: 1, toiThieu: null })).toMatch(/chưa có bậc chính sách/u);
    expect(nhanCanhTranh(null)).toBeNull();
    expect(nhanCanhTranh({ toiThieu: 2 })).toBeNull();
  });

  it("cờ từng ô: true/false nói bằng lời, null (tổ chức chưa bật) ⇒ «—»", () => {
    expect([nhanCo(true), nhanCo(false), nhanCo(null), nhanCo(undefined)]).toEqual(["có", "không", "—", "—"]);
  });
});

describe("[S1.273 / S3.3e1 · lượt soi CAO-1] cùng lần nộp", () => {
  it("chỉ hai số bằng nhau mới là cùng; thiếu một bên ⇒ coi như lệch", () => {
    expect(cungLanNop(2, 2)).toBe(true);
    expect(cungLanNop(2, 3)).toBe(false);
    expect(cungLanNop(undefined, 0)).toBe(false);
    expect(cungLanNop(1, null)).toBe(false);
  });
});

describe("[S1.273 / S3.3e1] ô chọn nhà cung cấp có sẵn", () => {
  it("chỉ hồ sơ ACTIVE, đúng hình dạng; MST null giữ null", () => {
    const ds = docNhaCungCapChon({
      suppliers: [
        { id: "a", legalName: "Thép A", taxCode: "0101010101", status: "ACTIVE" },
        { id: "b", legalName: "Thép B", taxCode: null, status: "ACTIVE" },
        { id: "c", legalName: "Thép C", taxCode: "0202020202", status: "SUSPENDED" },
        { id: 7, legalName: "hỏng", status: "ACTIVE" },
      ],
    });
    expect(ds.map((n) => [n.id, n.taxCode])).toEqual([["a", "0101010101"], ["b", null]]);
    expect(docNhaCungCapChon({})).toEqual([]);
  });

  it("tên kèm MST; tên mang ký tự đảo chiều chữ bị gỡ ký tự và đánh dấu; văn bản tự do cũng vậy", () => {
    expect(tenKemMst("Thép A", "0101010101")).toBe("Thép A — MST 0101010101");
    expect(tenKemMst("Thép B", null)).toBe("Thép B — không MST");
    expect(tenKemMst("Th\u202Eép", "1")).toBe("Thép — MST 1 [⚠ tên chứa ký tự đảo chiều chữ]");
    expect(vanBanAnToan("bình thường")).toBe("bình thường");
    expect(vanBanAnToan("a\u2066b")).toBe("ab [⚠ có ký tự đảo chiều chữ]");
    expect(vanBanAnToan(undefined)).toBe("—");
  });

  it("trạng thái xác minh một câu: còn hiệu lực (kèm hạn), hết hiệu lực, thu hồi, chưa xác minh, không đọc được", () => {
    expect(nhanXacMinhNgan({ loai: "VERIFIED", conHieuLuc: true, hetHanAt: "2027-01-01T00:00:00Z" })).toMatch(/^Đã xác minh, còn hiệu lực tới /u);
    expect(nhanXacMinhNgan({ loai: "VERIFIED", conHieuLuc: false })).toMatch(/^Xác minh đã hết hiệu lực/u);
    expect(nhanXacMinhNgan({ loai: "REVOKED", conHieuLuc: false })).toMatch(/^Xác minh đã bị thu hồi/u);
    expect(nhanXacMinhNgan({ loai: null, conHieuLuc: false })).toMatch(/^Chưa được xác minh/u);
    expect(nhanXacMinhNgan(null)).toBe("Không đọc được trạng thái xác minh.");
  });
});

describe("[S1.284 / S4.7b1] [INV-L16] số ngày giao yêu cầu ở /tao-thau", () => {
  it("biên của màn là biên của gói (CHECK `112`)", () => {
    expect(SO_NGAY_GIAO_TOI_DA).toBe(SO_NGAY_GIAO_TOI_DA_GOI);
  });

  it.each([
    ["", null],
    ["  ", null],
    [" 30 ", 30],
    ["1", 1],
    ["3650", 3650],
    ["3651", undefined],
    ["0", undefined],
    ["030", undefined],
    ["1.5", undefined],
    ["-3", undefined],
    ["1e3", undefined],
    ["ba", undefined],
  ])("ô %j ⇒ %j", (chuoi, mong) => {
    expect(docSoNgayGiao(chuoi)).toBe(mong);
  });

  it("ô chỉ ở DRAFT; nhãn mọi trạng thái", () => {
    expect(RFQ_STATUSES.filter((t) => hienDatSoNgayGiao(t))).toEqual(["DRAFT"]);
    expect([nhanSoNgayGiao(30), nhanSoNgayGiao(null), nhanSoNgayGiao(undefined)]).toEqual(["30 ngày", "chưa khai", "—"]);
  });

  it("cảnh báo chỉ khi gói chưa khai, ở DRAFT hay chờ duyệt, và một phiên bản hiệu lực hay mới hơn tính chi phí trễ", () => {
    const tre = { phienBan: [{ hieuLuc: true, evalComponents: [{ ma: "gia" }, { ma: "chi_phi_tre" }] }], daBat: false };
    expect(canhBaoSoNgayGiao(tre, null, "DRAFT")).toContain("Khai số ngày giao ở ô dưới");
    expect(canhBaoSoNgayGiao(tre, 30, "DRAFT")).toBeNull();
    expect(canhBaoSoNgayGiao(tre, undefined, "DRAFT")).toBeNull();
    expect(canhBaoSoNgayGiao(tre, null, "OPEN")).toBeNull();
    expect(canhBaoSoNgayGiao(tre, null, "PENDING_APPROVAL")).toContain("chỉ còn lối huỷ");
    expect(canhBaoSoNgayGiao({ ...tre, daBat: true }, null, "PENDING_APPROVAL")).toContain("trả gói về soạn thảo");
    expect(canhBaoSoNgayGiao(null, null, "DRAFT")).toBeNull();
    expect(canhBaoSoNgayGiao({ phienBan: [{ hieuLuc: true, evalComponents: null }] }, null, "DRAFT")).toBeNull();
    // Không phiên bản nào hiệu lực (mọi bản chờ ký) ⇒ xét mọi bản.
    expect(canhBaoSoNgayGiao({ phienBan: [{ hieuLuc: false, evalComponents: [{ ma: "chi_phi_tre" }] }] }, null, "DRAFT")).not.toBeNull();
  });
});

describe("[S1.284 / S4.7b1 — rà soát TRUNG-1] cảnh báo số ngày giao: phiên bản HIỆU LỰC khác phiên bản MỚI HƠN chưa hiệu lực", () => {
  const GIA = { hieuLuc: true, tiers: null, evalComponents: [{ ma: "gia" }] };
  const moiCoBac = { hieuLuc: false, tiers: [{}], evalComponents: [{ ma: "chi_phi_tre" }] };
  const moiKhongBac = { hieuLuc: false, tiers: null, evalComponents: [{ ma: "chi_phi_tre" }] };

  it("bản hiệu lực tính chi phí trễ ⇒ lời của openRfq; chỉ bản mới hơn ⇒ lời có điều kiện, không bao giờ *chỉ còn lối huỷ*", () => {
    expect(canhBaoSoNgayGiao({ phienBan: [{ ...GIA, evalComponents: [{ ma: "chi_phi_tre" }] }], daBat: false }, null, "PENDING_APPROVAL")).toContain(
      "Chính sách đang hiệu lực",
    );
    const draft = canhBaoSoNgayGiao({ phienBan: [moiCoBac, GIA], daBat: false }, null, "DRAFT");
    expect(draft).toContain("nếu nó có hiệu lực trước lúc gói mở");
    expect(draft).not.toContain("lối huỷ");
    expect(canhBaoSoNgayGiao({ phienBan: [moiCoBac, GIA], daBat: true }, null, "PENDING_APPROVAL")).toContain("khi ấy trả gói về soạn thảo");
  });

  it("tổ chức chưa bật, gói chờ duyệt: bản mới hơn CÓ bậc không chạm được gói (`097`) ⇒ im; bản KHÔNG bậc ⇒ *mở gói trước lúc ấy*", () => {
    expect(canhBaoSoNgayGiao({ phienBan: [moiCoBac, GIA], daBat: false }, null, "PENDING_APPROVAL")).toBeNull();
    const kb = canhBaoSoNgayGiao({ phienBan: [moiKhongBac, GIA], daBat: false }, null, "PENDING_APPROVAL");
    expect(kb).toContain("mở gói trước lúc ấy");
    expect(kb).not.toContain("lối huỷ");
  });
});

