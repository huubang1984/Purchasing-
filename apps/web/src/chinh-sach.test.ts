// ==============================================================================================
// [S1.169 / S3.1c] PHÉP ĐO CHO HAI PHÉP TÍNH CỦA MÀN KHAI CHÍNH SÁCH
//
// Hai đối chứng neo vào CHÍNH spec, không vào hàm: bậc 2 mặc định ra 7 người (§7), và bật `award_vai_khac_nhau` ở bậc
// ấy ra 8 (§4.1, câu về `award_vai_khac_nhau`). Còn lại là bảng ca biên của ngưỡng kép — so bằng số nguyên đồng, một
// phép so `double` sai ở đúng mép ấy — và mỗi cảnh báo của §8.1 ⑵ một ca dương, một ca âm.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import {
  BAC_MAC_DINH,
  BENCHMARK_MAC_DINH,
  NGUONG_KEP_MAC_DINH,
  TRONG_SO_MAC_DINH,
  canhBaoBenchmark,
  canhBaoChinhSach,
  canhBaoTrongSo,
  moTaTrongSo,
  soNguoiToiThieu,
  trongSoChamDuoc,
  type Bac,
  type KetQuaBac,
} from "./chinh-sach.js";

function nguoi(kq: KetQuaBac | undefined): { tong: number; finance: number; muaSam: number; giamDoc: number; s: number } {
  if (kq?.loai !== "NGUOI") throw new Error(`không phải kết quả NGUOI: ${JSON.stringify(kq)}`);
  return { tong: kq.nguoi.tong, finance: kq.nguoi.finance, muaSam: kq.nguoi.muaSam, giamDoc: kq.nguoi.giamDoc, s: kq.nguoi.chuKyMoGoi };
}

function doiBac(i: number, doi: Partial<Bac>): Bac[] {
  return BAC_MAC_DINH.map((b, j) => (j === i ? { ...b, ...doi } : b));
}

describe("[S1.169 / S3.1c] số người tối thiểu theo bảng vai §7", () => {
  it("mặc định §4.1 với ngưỡng kép 1 tỷ: bậc 0 và 1 cần 5 người, bậc 2 cần ĐÚNG 7 — con số §7 tự nêu; bậc 3 là đấu thầu chính thức", () => {
    const kq = soNguoiToiThieu(BAC_MAC_DINH, NGUONG_KEP_MAC_DINH);
    expect(nguoi(kq[0])).toEqual({ tong: 5, finance: 2, muaSam: 2, giamDoc: 1, s: 1 });
    expect(nguoi(kq[1])).toEqual({ tong: 5, finance: 2, muaSam: 2, giamDoc: 1, s: 1 });
    expect(nguoi(kq[2])).toEqual({ tong: 7, finance: 2, muaSam: 3, giamDoc: 2, s: 2 });
    expect(kq[3]).toEqual({ tuSoTien: 10000000000, loai: "DAU_THAU_CHINH_THUC" });
  });

  it("bật `award_vai_khac_nhau` ở bậc 2 thì cần thêm ĐÚNG một người FINANCE — câu của spec §4.1", () => {
    const kq = soNguoiToiThieu(doiBac(2, { award_vai_khac_nhau: true }), NGUONG_KEP_MAC_DINH);
    expect(nguoi(kq[2])).toEqual({ tong: 8, finance: 3, muaSam: 3, giamDoc: 2, s: 2 });
  });

  it("ngưỡng kép so bằng số nguyên đồng, ở đúng mép: đầu trên của bậc 1 là 1 tỷ", () => {
    // Đầu trên LỚN HƠN ngưỡng ⇒ bậc chứa một gói ≥ ngưỡng ⇒ hai chữ ký.
    expect(nguoi(soNguoiToiThieu(BAC_MAC_DINH, "999999999.99")[1]).s).toBe(2);
    // Đầu trên BẰNG hay NHỎ HƠN ngưỡng ⇒ mọi gói của bậc dưới ngưỡng ⇒ một chữ ký.
    expect(nguoi(soNguoiToiThieu(BAC_MAC_DINH, "1000000000.00")[1]).s).toBe(1);
    expect(nguoi(soNguoiToiThieu(BAC_MAC_DINH, "1000000000.01")[1]).s).toBe(1);
    // Bậc cuối không có đầu trên: luôn chứa một gói ≥ ngưỡng.
    const haiBac: Bac[] = [BAC_MAC_DINH[0]!, BAC_MAC_DINH[1]!];
    expect(nguoi(soNguoiToiThieu(haiBac, "9999999999999999.99")[1]).s).toBe(2);
    // Ngưỡng hạ xuống 100 triệu: bậc 1 cần hai chữ ký mở gói và hai phê duyệt mở niêm phong ⇒ 7.
    expect(nguoi(soNguoiToiThieu(BAC_MAC_DINH, "100000000.00")[1])).toEqual({ tong: 7, finance: 2, muaSam: 3, giamDoc: 2, s: 2 });
  });

  it("người ký trao thầu dùng lại người đã có trước, trừ tác giả chính sách và người thẩm định", () => {
    // Chỉ FINANCE ký, hai chữ ký, có thẩm định: F1 và F2 đều bị loại ⇒ thêm hai người FINANCE.
    const chiF = soNguoiToiThieu(doiBac(2, { award_vai: ["FINANCE"] }), NGUONG_KEP_MAC_DINH);
    expect(nguoi(chiF[2])).toEqual({ tong: 9, finance: 4, muaSam: 3, giamDoc: 2, s: 2 });
    // Không thẩm định: F2 ký được ⇒ chỉ thêm một.
    const khongThamDinh = soNguoiToiThieu(doiBac(2, { award_vai: ["FINANCE"], tham_dinh_truoc_trao: false }), NGUONG_KEP_MAC_DINH);
    expect(nguoi(khongThamDinh[2])).toEqual({ tong: 8, finance: 3, muaSam: 3, giamDoc: 2, s: 2 });
    // Bậc một chữ ký mở gói (một DIRECTOR) mà trao thầu cần hai DIRECTOR ⇒ thêm một DIRECTOR.
    const haiGiamDoc = soNguoiToiThieu(doiBac(1, { award_so_chu_ky: 2, award_vai: ["DIRECTOR"] }), NGUONG_KEP_MAC_DINH);
    expect(nguoi(haiGiamDoc[1])).toEqual({ tong: 6, finance: 2, muaSam: 2, giamDoc: 2, s: 1 });
  });

  it("cấu hình không thực hiện được thì nói thẳng, không trả một con số", () => {
    const kq = soNguoiToiThieu(doiBac(2, { award_vai_khac_nhau: true, award_vai: ["DIRECTOR"] }), NGUONG_KEP_MAC_DINH);
    expect(kq[2]?.loai).toBe("KHONG_KHA_THI");
  });
});

describe("[S1.169 / S3.1c] ba cảnh báo của §8.1 ⑵ — không chặn", () => {
  it("mặc định §4.1 không sinh cảnh báo nào", () => {
    expect(canhBaoChinhSach(BAC_MAC_DINH)).toEqual([]);
  });

  it("bậc trên bậc thấp nhất mà chỉ đòi MỘT nhà cung cấp", () => {
    const c = canhBaoChinhSach(doiBac(1, { so_ncc_toi_thieu: 1 }));
    expect(c.some((x) => x.includes("bậc từ 100.000.000 chỉ đòi 1 nhà cung cấp"))).toBe(true);
    // Bậc thấp nhất đòi 1 là hợp lệ, không cảnh báo.
    expect(canhBaoChinhSach(doiBac(0, { so_ncc_toi_thieu: 1 }))).toEqual([]);
  });

  it("một bậc LỎNG hơn bậc dưới nó — số nhà cung cấp hay số chữ ký trao thầu giảm khi giá trị tăng", () => {
    expect(canhBaoChinhSach(doiBac(2, { so_ncc_toi_thieu: 2 })).some((x) => x.includes("ÍT nhà cung cấp hơn"))).toBe(true);
    expect(canhBaoChinhSach(doiBac(2, { award_so_chu_ky: 1, award_vai_khac_nhau: false }))).toEqual([]);
    expect(canhBaoChinhSach(doiBac(1, { award_so_chu_ky: 2 })).some((x) => x.includes("ÍT chữ ký trao thầu"))).toBe(false);
    const giam = BAC_MAC_DINH.map((b, j) => (j === 1 ? { ...b, award_so_chu_ky: 2 } : j === 2 ? { ...b, award_so_chu_ky: 1 } : b));
    expect(canhBaoChinhSach(giam).some((x) => x.includes("ÍT chữ ký trao thầu"))).toBe(true);
  });

  it("`ky_danh_sach_moi` tắt ở MỌI bậc — một bậc bật là đủ để không cảnh báo", () => {
    const tatHet = BAC_MAC_DINH.map((b) => (b.dau_thau_chinh_thuc ? b : { ...b, ky_danh_sach_moi: false }));
    expect(canhBaoChinhSach(tatHet).some((x) => x.includes("Không bậc nào đòi ký danh sách mời"))).toBe(true);
    expect(canhBaoChinhSach(doiBac(1, { ky_danh_sach_moi: false })).some((x) => x.includes("Không bậc nào"))).toBe(false);
  });
});

describe("[S1.256 / S4.5b] cảnh báo tĩnh của nhóm khoá `benchmark` — không chặn", () => {
  it("mẫu mặc định không cảnh báo gì; không cấu hình thì nói ra", () => {
    expect(canhBaoBenchmark(BENCHMARK_MAC_DINH)).toEqual([]);
    expect(canhBaoBenchmark(null)).toEqual([expect.stringContaining("KHÔNG cấu hình benchmark")]);
  });

  it.each([
    ["sàn gói 2", { san_goi: "2" }, "Sàn dưới 3"],
    ["sàn nhà cung cấp 1", { san_ncc: "1" }, "Sàn dưới 3"],
    ["ngưỡng vừa 0.2", { nguong_lech_vua: "0.2", nguong_lech_cao: "0.3" }, "20%"],
    ["cửa sổ 25 tháng", { cua_so_thang: "25" }, "dài hơn 24"],
    ["cửa sổ 2 tháng", { cua_so_thang: "2" }, "ngắn hơn 3"],
  ])("%s ⇒ một câu", (_ten, doi, chu) => {
    const c = canhBaoBenchmark({ ...BENCHMARK_MAC_DINH, ...doi });
    expect(c).toHaveLength(1);
    expect(c[0]).toContain(chu);
  });

  it("biên: sàn 3, ngưỡng vừa 0.1999, cửa sổ 24 và 3 không cảnh báo; giá trị không đọc được thì im — máy chủ nói", () => {
    expect(canhBaoBenchmark({ ...BENCHMARK_MAC_DINH, nguong_lech_vua: "0.1999", nguong_lech_cao: "0.3", cua_so_thang: "24" })).toEqual([]);
    expect(canhBaoBenchmark({ ...BENCHMARK_MAC_DINH, cua_so_thang: "3" })).toEqual([]);
    expect(canhBaoBenchmark({ ...BENCHMARK_MAC_DINH, nguong_lech_vua: "abc", san_goi: "x", cua_so_thang: "" })).toEqual([]);
  });
});

describe("[S1.9101 / khoản 329] trọng số chấm — vế hẹp, cảnh báo tĩnh, mô tả", () => {
  it("mẫu là vế hẹp lượt chấm đọc được và không cảnh báo; không khai thì nói hậu quả", () => {
    expect(trongSoChamDuoc(TRONG_SO_MAC_DINH)).toBe(true);
    expect(canhBaoTrongSo(TRONG_SO_MAC_DINH)).toEqual([]);
    expect(canhBaoTrongSo(null)).toEqual([expect.stringContaining("KHÔNG khai trọng số chấm")]);
  });

  it.each([
    ["mã khác", [{ ma: "diem", don_vi: "TIEN", he_so: "1" }]],
    ["đơn vị điểm", [{ ma: "gia", don_vi: "DIEM", he_so: "1" }]],
    ["hai thành phần", [{ ma: "gia", don_vi: "TIEN", he_so: "1" }, { ma: "ky_thuat", don_vi: "DIEM", he_so: "0.5" }]],
    ["mảng rỗng", []],
  ])("ngoài vế hẹp (%s) ⇒ một câu, và trongSoChamDuoc nói không", (_ten, tp) => {
    expect(trongSoChamDuoc(tp)).toBe(false);
    const c = canhBaoTrongSo(tp);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain("bị từ chối khi chấm");
  });

  it("hệ số khác 1 vẫn là vế hẹp — lượt chấm không đọc hệ số để chọn vế", () => {
    expect(canhBaoTrongSo([{ ma: "gia", don_vi: "TIEN", he_so: "2.5" }])).toEqual([]);
  });

  it("mô tả: chưa khai, top-N, top 0 là không BAFO", () => {
    expect(moTaTrongSo(null, null)).toBe("chưa khai");
    expect(moTaTrongSo(TRONG_SO_MAC_DINH, 2)).toBe("gia/TIEN ×1.0000 · BAFO top-2");
    expect(moTaTrongSo(TRONG_SO_MAC_DINH, 0)).toBe("gia/TIEN ×1.0000 · không BAFO");
  });
});
