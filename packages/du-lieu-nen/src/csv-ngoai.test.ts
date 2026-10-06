// [S1.9101 / S4.6a] Bộ đọc văn bản dán của mốc ngoài và lịch sử ngoài hệ thống — thuần, không CSDL (spec S4 §4.7; ADR-096 ⑸).
// Mỗi luật hình dạng một ca, cộng phép đo rằng KHÔNG câu lỗi nào lặp lại giá trị của ô (người nhập mù giá không đọc lại được giá).
import { describe, expect, it } from "vitest";
import { cauLoiDong, chuanHoaTenCot, docCsvNgoai, docNgay, laDonGia, TRAN_DONG_MOT_LO, type KetQuaDocCsv } from "./csv-ngoai.js";

const loiCua = (kq: KetQuaDocCsv): readonly { dong: number; cot: string | null; ma: string }[] =>
  kq.hopLe ? [] : kq.loi.map(({ dong, cot, ma }) => ({ dong, cot, ma }));

describe("[INV-L15] [S1.9101 / S4.6a] đọc văn bản dán — dòng hợp lệ", () => {
  it("tiêu đề tiếng Việt có dấu, thứ tự tự do, phân cách phẩy; mã hàng hạ chữ được nâng; ngày DD/MM/YYYY thành ISO", () => {
    const kq = docCsvNgoai(
      "MOC_NGOAI",
      "Nguồn,Mã hàng,Đơn giá,Đơn vị,Tiền tệ,Ngày hiệu lực\n" + "Bao gia Hoa Phat,thep-d10,15500,kg,vnd,15/01/2026\n",
    );
    expect(kq).toEqual({
      hopLe: true,
      dong: [
        { dong: 2, maHang: "THEP-D10", donGia: "15500", donVi: "kg", tienTe: "VND", ngay: "2026-01-15", nguon: "Bao gia Hoa Phat", nhaCungCap: null },
      ],
    });
  });

  it("dán thẳng từ bảng tính: TAB, CRLF, BOM, dòng trống bỏ qua; số dòng trong kết quả là số dòng VẬT LÝ", () => {
    const kq = docCsvNgoai(
      "LICH_SU_NGOAI",
      "﻿ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_mua\tnha_cung_cap\tnguon\r\n\r\nTHEP-D10\t15200.50\tcây\tVND\t2025-11-20\tCông ty A\tSổ mua 2025\r\n",
    );
    expect(kq.hopLe && kq.dong.map((d) => [d.dong, d.donGia, d.donVi, d.nhaCungCap])).toEqual([[3, "15200.50", "cây", "Công ty A"]]);
  });

  it("ô trong ngoặc kép mang dấu phẩy và ngoặc kép kép (RFC 4180); dấu chấm phẩy làm phân cách khi tiêu đề dùng nó", () => {
    const phay = docCsvNgoai(
      "LICH_SU_NGOAI",
      'ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon\nTHEP-D10,15000,kg,VND,2025-01-02,"Cong ty ""Thep"", Ha Noi",so cai\n',
    );
    expect(phay.hopLe && phay.dong[0]!.nhaCungCap).toBe('Cong ty "Thep", Ha Noi');
    const chamPhay = docCsvNgoai("MOC_NGOAI", "ma_hang;don_gia;don_vi;tien_te;ngay_hieu_luc;nguon\nTHEP-D10;12.75;kg;USD;2026-02-01;LME\n");
    expect(chamPhay.hopLe && chamPhay.dong[0]).toMatchObject({ donGia: "12.75", tienTe: "USD", nguon: "LME" });
  });

  it("tên cột khác của cùng cột: `ma_hang_chuan`, `don_vi_tinh`, `ncc`", () => {
    expect(chuanHoaTenCot("Mã hàng chuẩn")).toBe("ma_hang_chuan");
    expect(chuanHoaTenCot("  Đơn vị tính ")).toBe("don_vi_tinh");
    const kq = docCsvNgoai("LICH_SU_NGOAI", "ma_hang_chuan,don_gia,don_vi_tinh,tien_te,ngay_mua,ncc,nguon\nA1,1,kg,VND,2025-01-01,X,Y\n");
    expect(kq.hopLe).toBe(true);
  });
});

describe("[INV-L15] [S1.9101 / S4.6a] đọc văn bản dán — từ chối, theo dòng, không lặp lại ô", () => {
  const TIEU_DE = "ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon";

  it("lô rỗng; chỉ tiêu đề; quá trần số dòng", () => {
    expect(loiCua(docCsvNgoai("MOC_NGOAI", ""))).toEqual([{ dong: 1, cot: null, ma: "LO_RONG" }]);
    expect(loiCua(docCsvNgoai("MOC_NGOAI", `${TIEU_DE}\n\n`))).toEqual([{ dong: 1, cot: null, ma: "LO_RONG" }]);
    const qua = `${TIEU_DE}\n${"A1,1,kg,VND,2026-01-01,X\n".repeat(TRAN_DONG_MOT_LO + 1)}`;
    expect(loiCua(docCsvNgoai("MOC_NGOAI", qua))).toEqual([{ dong: 1, cot: null, ma: "QUA_NHIEU_DONG" }]);
    const vua = `${TIEU_DE}\n${"A1,1,kg,VND,2026-01-01,X\n".repeat(TRAN_DONG_MOT_LO)}`;
    expect(docCsvNgoai("MOC_NGOAI", vua).hopLe).toBe(true);
  });

  it("tiêu đề: thiếu cột, cột lạ (một cột *VAT* bị lờ đi là một con số tưởng đã vào), cột trùng — mọi lỗi cùng lúc", () => {
    expect(loiCua(docCsvNgoai("MOC_NGOAI", "ma_hang,don_gia,don_gia,tien_te,VAT,nguon\nA1,1,1,VND,10,X\n"))).toEqual([
      { dong: 1, cot: "don_gia", ma: "COT_TRUNG" },
      { dong: 1, cot: "vat", ma: "COT_LA" },
      { dong: 1, cot: "don_vi", ma: "THIEU_COT" },
      { dong: 1, cot: "ngay_hieu_luc", ma: "THIEU_COT" },
    ]);
    // Lịch sử ngoài đòi thêm ngày mua và nhà cung cấp, và không nhận ngày hiệu lực.
    expect(loiCua(docCsvNgoai("LICH_SU_NGOAI", `${TIEU_DE}\nA1,1,kg,VND,2026-01-01,X\n`)).map((l) => `${l.ma}:${String(l.cot)}`)).toEqual([
      "COT_LA:ngay_hieu_luc",
      "THIEU_COT:ngay_mua",
      "THIEU_COT:nha_cung_cap",
    ]);
  });

  it("đơn giá: dấu chấm thập phân, dương, không phân cách nghìn — cả hai cách viết nghìn đều từ chối", () => {
    for (const sai of ["1,234.5", "1.234,5", "0", "0.00", "-5", "1e6", "12.", ".5", "1 000", "abc", ""]) {
      const vanBan = `ma_hang;don_gia;don_vi;tien_te;ngay_hieu_luc;nguon\nA1;${sai};kg;VND;2026-01-01;X\n`;
      expect(loiCua(docCsvNgoai("MOC_NGOAI", vanBan)), sai).toEqual([{ dong: 2, cot: "don_gia", ma: "DON_GIA_SAI_HINH_DANG" }]);
    }
    expect(["15500", "12.75", "0.5", "1.000001"].every(laDonGia)).toBe(true);
    expect(laDonGia("1.0000001")).toBe(false);
  });

  it("ngày có thật: 29/02 năm nhuận theo 4/100/400; 30/02, 31/04, tháng 13 từ chối", () => {
    expect(docNgay("29/02/2024")).toBe("2024-02-29");
    expect(docNgay("2000-02-29")).toBe("2000-02-29");
    expect(docNgay("2100-02-29")).toBeNull();
    expect(docNgay("30/02/2025")).toBeNull();
    expect(docNgay("31/04/2025")).toBeNull();
    expect(docNgay("2025-13-01")).toBeNull();
    expect(docNgay("1/2/2025")).toBe("2025-02-01");
    expect(docNgay("2025/02/01")).toBeNull();
  });

  it("mỗi dòng sai mang ĐỦ lỗi của nó, đúng số dòng vật lý; dòng đúng không vào kết quả khi lô sai (tất-cả-hoặc-không)", () => {
    const kq = docCsvNgoai(
      "LICH_SU_NGOAI",
      "ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon\n" +
        "A1,100,kg,VND,2025-01-01,X,Y\n" +
        "\n" +
        "a b,1.234,5,,EUR,31/02/2025,,\n" +
        'A2,"1,5,kg\n' +
        "A3,1,kg,VND,2025-01-01\n",
    );
    expect(loiCua(kq)).toEqual([
      { dong: 4, cot: null, ma: "SO_O_SAI" },
      { dong: 5, cot: null, ma: "NGOAC_KEP_HO" },
      { dong: 6, cot: null, ma: "SO_O_SAI" },
    ]);
    const tungO = docCsvNgoai(
      "LICH_SU_NGOAI",
      "ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon\n" + "a b,1.234.5, ,EUR,31/02/2025, , \n",
    );
    expect(loiCua(tungO)).toEqual([
      { dong: 2, cot: "ma_hang", ma: "MA_HANG_SAI_HINH_DANG" },
      { dong: 2, cot: "don_gia", ma: "DON_GIA_SAI_HINH_DANG" },
      { dong: 2, cot: "don_vi", ma: "DON_VI_RONG" },
      { dong: 2, cot: "tien_te", ma: "TIEN_TE_SAI" },
      { dong: 2, cot: "ngay_mua", ma: "NGAY_SAI_HINH_DANG" },
      { dong: 2, cot: "nguon", ma: "NGUON_SAI_HINH_DANG" },
      { dong: 2, cot: "nha_cung_cap", ma: "NHA_CUNG_CAP_SAI_HINH_DANG" },
    ]);
  });

  it("KHÔNG câu lỗi nào lặp lại giá trị của ô — một đơn giá sai không quay lại màn của người mù giá", () => {
    const giaDoc = "987654321.123456789";
    const kq = docCsvNgoai("MOC_NGOAI", `${TIEU_DE}\nA1,${giaDoc},kg,VND,2026-01-01,X\n`);
    expect(kq.hopLe).toBe(false);
    expect(JSON.stringify(kq)).not.toContain(giaDoc);
    expect(cauLoiDong("DON_GIA_SAI_HINH_DANG")).not.toMatch(/987/u);
  });
});
