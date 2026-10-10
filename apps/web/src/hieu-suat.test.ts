import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COT_HIEU_SUAT, TRUONG_DUOI_SAN, docHieuSuat, oCuaHang, phanTramTuPhanVan, thoiLuongGiay, tomTat, type HieuSuatMan } from "./hieu-suat.js";

// [S1.9101 / S3.8b] Phép trình bày thuần của màn `/hieu-suat` (spec S3 §4.9, K11; ADR-163).

const DU: HieuSuatMan = {
  supplierId: "s-1",
  tenNhaCungCap: "Thép Đông Anh",
  soGoiMoi: 6,
  soGoiNop: 5,
  tyLePhanHoiPhanVan: 8333,
  trungViPhanHoiGiay: 7500,
  soLanSua: 3,
  soGoiXepHang: 5,
  hangTrungVi: 2,
  khoangCachTrungViPhanVan: 1250,
  soLanVaoBafo: 1,
  soLanThang: 1,
  tyLeThangPhanVan: 2000,
  chuaDuLichSu: [],
};

/** Một nhà cung cấp dưới sàn: hai gói được mời, một gói nộp, chưa xếp hạng — máy chủ giữ lại cả năm trường. */
const DUOI: HieuSuatMan = {
  ...DU,
  supplierId: "s-2",
  tenNhaCungCap: "Vật liệu Phú Mỹ",
  soGoiMoi: 2,
  soGoiNop: 1,
  tyLePhanHoiPhanVan: null,
  trungViPhanHoiGiay: null,
  soLanSua: 0,
  soGoiXepHang: 0,
  hangTrungVi: null,
  khoangCachTrungViPhanVan: null,
  soLanVaoBafo: 0,
  soLanThang: 0,
  tyLeThangPhanVan: null,
  chuaDuLichSu: [...TRUONG_DUOI_SAN],
};

describe("S3.8b — màn hiệu suất nhà cung cấp", () => {
  it("docHieuSuat: thân đúng hình dạng ra nguyên; hàng sai hình dạng bị bỏ; tên trường lạ trong chuaDuLichSu bị lọc; thân sai ⇒ null", () => {
    const than = { hieuSuat: { sanLichSu: 5, nhaCungCap: [DU, DUOI] } };
    expect(docHieuSuat(than)).toEqual({ sanLichSu: 5, nhaCungCap: [DU, DUOI], soHangBoQua: 0 });
    const hong = [
      { ...DU, supplierId: 1 },
      { ...DU, soGoiMoi: -1 },
      { ...DU, soGoiNop: 1.5 },
      { ...DU, soLanSua: "3" },
      { ...DU, tyLePhanHoiPhanVan: "8333" },
      { ...DU, hangTrungVi: -2 },
      { ...DU, chuaDuLichSu: "tyLeThangPhanVan" },
      null,
      "khong",
    ];
    expect(docHieuSuat({ hieuSuat: { sanLichSu: 5, nhaCungCap: [...hong, DU] } })).toEqual({ sanLichSu: 5, nhaCungCap: [DU], soHangBoQua: hong.length });
    expect(docHieuSuat({ hieuSuat: { sanLichSu: 5, nhaCungCap: [{ ...DU, chuaDuLichSu: ["hangTrungVi", "giaTien", 3] }] } })?.nhaCungCap[0]?.chuaDuLichSu)
      .toEqual(["hangTrungVi"]);
    // Khoảng cách là `numeric` ở CSDL: một số hữu hạn lớn hơn mọi số nguyên an toàn vẫn là một hàng đọc được.
    expect(docHieuSuat({ hieuSuat: { sanLichSu: 5, nhaCungCap: [{ ...DU, khoangCachTrungViPhanVan: 9999999999999990000 }] } })?.nhaCungCap)
      .toHaveLength(1);
    for (const sai of [null, {}, { hieuSuat: null }, { hieuSuat: { sanLichSu: 0, nhaCungCap: [] } }, { hieuSuat: { sanLichSu: 5 } }, { hieuSuat: { sanLichSu: "5", nhaCungCap: [] } }]) {
      expect(docHieuSuat(sai), JSON.stringify(sai)).toBeNull();
    }
  });

  it("phanTramTuPhanVan: phần vạn thành phần trăm, dấu phẩy, bỏ số 0 thừa, nhóm nghìn; trên MAX_SAFE_INTEGER nói cận dưới", () => {
    expect(phanTramTuPhanVan(10000)).toBe("100%");
    expect(phanTramTuPhanVan(0)).toBe("0%");
    expect(phanTramTuPhanVan(6667)).toBe("66,67%");
    expect(phanTramTuPhanVan(1250)).toBe("12,5%");
    expect(phanTramTuPhanVan(5)).toBe("0,05%");
    expect(phanTramTuPhanVan(123456789)).toBe("1.234.567,89%");
    expect(phanTramTuPhanVan(Number.MAX_SAFE_INTEGER)).toBe("90.071.992.547.409,91%");
    // Lượt soi THẤP-6 của S3.8a: 0,01 cạnh 10 nghìn tỷ — số đi qua JSON là một double đã mất chữ số cuối.
    expect(phanTramTuPhanVan(9999999999999990000)).toBe("hơn 90.071.992.547.409,91%");
  });

  it("thoiLuongGiay: hai đơn vị lớn nhất, bỏ đơn vị nhỏ bằng 0", () => {
    expect(thoiLuongGiay(0)).toBe("0 giây");
    expect(thoiLuongGiay(45)).toBe("45 giây");
    expect(thoiLuongGiay(60)).toBe("1 phút");
    expect(thoiLuongGiay(125)).toBe("2 phút 5 giây");
    expect(thoiLuongGiay(3600)).toBe("1 giờ");
    expect(thoiLuongGiay(7500)).toBe("2 giờ 5 phút");
    expect(thoiLuongGiay(86400)).toBe("1 ngày");
    expect(thoiLuongGiay(93600)).toBe("1 ngày 2 giờ");
  });

  it("oCuaHang: đủ lịch sử ⇒ mười hai ô số mô tả, nhãn đúng thứ tự cột", () => {
    const o = oCuaHang(DU, 5);
    expect(o.map((x) => x.nhan)).toEqual([...COT_HIEU_SUAT]);
    expect(o.map((x) => x.noiDung)).toEqual([
      "Thép Đông Anh",
      "6 gói",
      "5 gói",
      "83,33%",
      "2 giờ 5 phút",
      "3",
      "5 gói",
      "hạng 2",
      "chi phí cao hơn hạng nhất 12,5%",
      "1 lần",
      "1 gói",
      "20%",
    ]);
  });

  it("oCuaHang: trường máy chủ giữ lại ⇒ «chưa đủ lịch sử» kèm mẫu số của CHÍNH chỉ số ấy; số đếm vẫn hiện", () => {
    expect(oCuaHang(DUOI, 5).map((x) => x.noiDung)).toEqual([
      "Vật liệu Phú Mỹ",
      "2 gói",
      "1 gói",
      "chưa đủ lịch sử (2/5 gói)",
      "chưa đủ lịch sử (1/5 gói)",
      "0",
      "0 gói",
      "chưa đủ lịch sử (0/5 gói)",
      "chưa đủ lịch sử (0/5 gói)",
      "0 lần",
      "0 gói",
      "chưa đủ lịch sử (0/5 gói)",
    ]);
    // Chỉ một trường bị giữ: các ô khác vẫn là số. Màn KHÔNG tự xét sàn — nó đọc đúng danh sách máy chủ trả.
    const motTruong = oCuaHang({ ...DU, hangTrungVi: null, chuaDuLichSu: ["hangTrungVi"] }, 5).map((x) => x.noiDung);
    expect(motTruong[7]).toBe("chưa đủ lịch sử (5/5 gói)");
    expect(motTruong[3]).toBe("83,33%");
  });

  it("oCuaHang: không bị giữ mà vẫn rỗng ⇒ «—»; khoảng cách 0 ⇒ «bằng hạng nhất»", () => {
    const o = oCuaHang({ ...DU, khoangCachTrungViPhanVan: null }, 5).map((x) => x.noiDung);
    expect(o[8]).toBe("—");
    expect(oCuaHang({ ...DU, khoangCachTrungViPhanVan: 0 }, 5)[8]?.noiDung).toBe("bằng hạng nhất");
  });

  it("tomTat: bảng trống nói vì sao; bảng có hàng đếm người đủ sàn ở mọi chỉ số; hàng bị bỏ được nói ra", () => {
    expect(tomTat({ sanLichSu: 5, nhaCungCap: [], soHangBoQua: 0 })).toMatch(/^Chưa nhà cung cấp nào có gói đã mở niêm phong/u);
    expect(tomTat({ sanLichSu: 5, nhaCungCap: [DU, DUOI], soHangBoQua: 0 })).toMatch(/^2 nhà cung cấp có gói đã mở niêm phong; 1 người đủ 5 gói ở mọi chỉ số\./u);
    expect(tomTat({ sanLichSu: 7, nhaCungCap: [DU], soHangBoQua: 0 })).toMatch(/1 người đủ 7 gói/u);
    expect(tomTat({ sanLichSu: 5, nhaCungCap: [DU], soHangBoQua: 2 })).toMatch(/ 2 hàng của bảng vừa nhận sai hình dạng nên không hiện\.$/u);
    expect(tomTat({ sanLichSu: 5, nhaCungCap: [], soHangBoQua: 3 })).toBe("Không hàng nào hiện được. 3 hàng của bảng vừa nhận sai hình dạng nên không hiện.");
  });

  it("tiêu đề cột của hieu-suat.html trùng COT_HIEU_SUAT, đúng thứ tự", () => {
    const html = readFileSync(new URL("../trang/hieu-suat.html", import.meta.url), "utf8");
    const bang = /<table class="xep" id="bang-hieu-suat">([\s\S]*?)<\/thead>/u.exec(html)?.[1] ?? "";
    expect([...bang.matchAll(/<th>([^<]*)<\/th>/gu)].map((m) => m[1])).toEqual([...COT_HIEU_SUAT]);
  });

  // Spec S3 §2.2 ⑶: tín hiệu không phải phán quyết. Kho chưa có luật chung cấm chữ đánh giá (bảng §5 của `docs/PRODUCT.md` không có
  // hàng ấy), nên phép quét này chỉ đọc ba tệp của màn và chữ mà module sinh ra.
  it("ngôn ngữ mô tả: không chữ đánh giá nào trong ba tệp của màn hay trong chữ module sinh ra", () => {
    // [lượt soi §S1.9101 THẤP-2] Thêm bảy chữ; khoảng trắng gộp về một dấu cách trước khi quét — cụm hai chữ xuống dòng trong HTML vẫn bị bắt.
    const CAM = /(?<![\p{L}\p{M}\p{N}])(?:tốt|kém|xấu|yếu kém|đáng ngờ|nghi ngờ|khả nghi|bất thường|gian lận|uy tín|đáng tin|tin cậy|xuất sắc|rủi ro|cảnh báo|xếp loại|hàng đầu|điểm số|khuyến nghị|nên chọn)(?![\p{L}\p{M}\p{N}])/iu;
    const gon = (chu: string): string => chu.normalize("NFC").replace(/\s+/gu, " ");
    // Đối chứng dương và âm trên văn bản mẫu: biên chữ theo Unicode, không theo `\b` ASCII.
    for (const mau of ["nhà cung cấp tốt", "Kém", "đáng ngờ.", "(uy tín)", "rủi ro cao", "đáng\n      ngờ", "Cảnh báo:"]) expect(CAM.test(gon(mau)), mau).toBe(true);
    for (const mau of ["tốtx", "điểm", "thời điểm", "xếp hạng", "tiền tệ", "chủ yếu"]) expect(CAM.test(gon(mau)), mau).toBe(false);
    const tep = ["../trang/hieu-suat.html", "../trang/hieu-suat.js", "./hieu-suat.ts"].map((t) => readFileSync(new URL(t, import.meta.url), "utf8"));
    const sinh = [DU, DUOI].flatMap((h) => oCuaHang(h, 5).map((x) => x.noiDung))
      .concat(tomTat({ sanLichSu: 5, nhaCungCap: [DU, DUOI], soHangBoQua: 1 }), tomTat({ sanLichSu: 5, nhaCungCap: [], soHangBoQua: 0 }));
    for (const chu of [...tep, ...sinh]) expect(CAM.exec(gon(chu))?.[0] ?? null).toBeNull();
  });
});
