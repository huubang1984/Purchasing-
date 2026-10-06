// [S1.9101 / S4.6b] PHÉP ĐO CỦA LÕI THUẦN DẢI LỊCH SỬ NGOÀI VÀ MỐC NGOÀI — mỗi luật một ca (`dai-ngoai.ts`; ADR-096 ⑷, ADR-149 ⑵ ⑶).
import { describe, expect, it } from "vitest";
import { NHOM_BENCHMARK_MAU, docNhomBenchmark, ganNhan } from "./benchmark.js";
import {
  chonMocNgoai,
  cuaSoNgayNgoai,
  lechPhanTram,
  ngayVnTuMicro,
  tinhDaiNgoai,
  truThangNgay,
  type HangLichSuNgoai,
  type HangMocNgoai,
} from "./dai-ngoai.js";

const NHOM = docNhomBenchmark(NHOM_BENCHMARK_MAU)!; // 12 tháng, sàn 3 gói / 3 nhà cung cấp, 5% / 10%
const micro = (iso: string): bigint => BigInt(Date.parse(iso)) * 1000n;
/** Mốc mở giá: 2026-10-06 09:00 giờ Việt Nam. */
const MOC = micro("2026-10-06T02:00:00Z");

let dem = 0;
const ls = (doi: Partial<HangLichSuNgoai> = {}): HangLichSuNgoai => {
  dem += 1;
  return {
    id: `h-${String(dem)}`,
    donGiaQuyDoi: "100",
    tienTe: "VND",
    ngayMua: "2026-06-01",
    nhaCungCap: `ncc ${String(dem)}`,
    nguon: "So mua 2026",
    ghiTruocMoc: true,
    rutTruocMoc: false,
    rutSauMoc: false,
    ...doi,
  };
};
const VAO = { tienTe: "VND", mocMoGia: MOC, nhom: NHOM };

describe("[INV-L15] [S1.9101 / S4.6b] ngày Việt Nam và cửa sổ ngày", () => {
  it("ngày của mốc theo UTC+7: 17:00Z là sang ngày mới, 16:59:59.999999Z thì chưa", () => {
    expect(ngayVnTuMicro(micro("2026-10-05T17:00:00Z"))).toBe("2026-10-06");
    expect(ngayVnTuMicro(micro("2026-10-05T17:00:00Z") - 1n)).toBe("2026-10-05");
    expect(ngayVnTuMicro(0n)).toBe("1970-01-01");
  });

  it("lùi tháng kẹp ngày cuối tháng — cùng luật `truThang`", () => {
    expect(truThangNgay("2026-03-31", 1)).toBe("2026-02-28");
    expect(truThangNgay("2024-03-31", 1)).toBe("2024-02-29");
    expect(truThangNgay("2026-01-15", 12)).toBe("2025-01-15");
    expect(truThangNgay("2026-10-06", 0)).toBe("2026-10-06");
    expect(() => truThangNgay("6/10/2026", 1)).toThrow(RangeError);
    expect(() => truThangNgay("2026-10-06", -1)).toThrow(RangeError);
  });

  it("cửa sổ của X: [ngày(mốc) − 12 tháng, ngày(mốc)]", () => {
    expect(cuaSoNgayNgoai(MOC, 12)).toEqual({ tu: "2025-10-06", den: "2026-10-06" });
  });
});

describe("[INV-L15] [INV-L1] [S1.9101 / S4.6b] dải lịch sử ngoài — cùng phương pháp, gói là (ngày mua, nhà cung cấp)", () => {
  it("trung vị các trung vị gói và [Q1, Q3] chính xác; hai dòng cùng (ngày, nhà cung cấp) là MỘT gói", () => {
    const hang = [
      ls({ donGiaQuyDoi: "100", nhaCungCap: "a", ngayMua: "2026-05-01" }),
      ls({ donGiaQuyDoi: "300", nhaCungCap: "a", ngayMua: "2026-05-01" }), // gói (05-01, a): trung vị 200
      ls({ donGiaQuyDoi: "150", nhaCungCap: "b" }),
      ls({ donGiaQuyDoi: "250", nhaCungCap: "c" }),
      ls({ donGiaQuyDoi: "400", nhaCungCap: "a", ngayMua: "2026-07-01" }), // cùng nhà cung cấp, khác ngày: gói thứ năm
    ];
    const d = tinhDaiNgoai(hang, VAO);
    expect([d.soDong, d.soGoi, d.soNcc]).toEqual([5, 4, 3]);
    expect(d.duSan).toBe(true);
    // Trung vị gói: 150, 200, 250, 400 ⇒ Q1 187.5, trung vị 225, Q3 287.5.
    expect(d.mocSo).toEqual({ q1: "187.5", trungVi: "225", q3: "287.5" });
    expect(ganNhan("225", d, NHOM)).toEqual({ nhan: "BINH_THUONG", chieu: null });
    expect(ganNhan("247", d, NHOM)).toEqual({ nhan: "LECH_VUA", chieu: "TREN" });
    expect(ganNhan("190", d, NHOM)).toEqual({ nhan: "LECH_CAO", chieu: "DUOI" });
  });

  it("sàn: đủ gói mà thiếu nhà cung cấp ⇒ không con số; sàn là của phiên bản ghim", () => {
    const motNcc = [ls({ nhaCungCap: "a", ngayMua: "2026-05-01" }), ls({ nhaCungCap: "a", ngayMua: "2026-05-02" }), ls({ nhaCungCap: "a", ngayMua: "2026-05-03" })];
    const d = tinhDaiNgoai(motNcc, VAO);
    expect([d.soGoi, d.soNcc, d.duSan, d.mocSo]).toEqual([3, 1, false, null]);
    expect(ganNhan("100", d, NHOM)).toEqual({ nhan: "CHUA_DU_LICH_SU", chieu: null });
    const san1 = docNhomBenchmark({ ...NHOM_BENCHMARK_MAU, san_goi: "1", san_ncc: "1" })!;
    expect(tinhDaiNgoai(motNcc, { ...VAO, nhom: san1 }).duSan).toBe(true);
  });

  it("L1: hàng ghi sau mốc không vào (đếm GHI); rút trước mốc không vào; rút SAU mốc vẫn vào (đếm RUT)", () => {
    const hang = [
      ls({ donGiaQuyDoi: "100" }),
      ls({ donGiaQuyDoi: "110" }),
      ls({ donGiaQuyDoi: "120", rutSauMoc: true }),
      ls({ donGiaQuyDoi: "9999", rutTruocMoc: true }),
      ls({ donGiaQuyDoi: "1", ghiTruocMoc: false }),
      ls({ donGiaQuyDoi: "1", ghiTruocMoc: false, tienTe: "USD" }), // khác tiền tệ: không đếm vào GHI của dải VND
    ];
    const d = tinhDaiNgoai(hang, VAO);
    expect(d.soDong).toBe(3);
    expect(d.mocSo?.trungVi).toBe("110");
    expect(d.sauMoc).toEqual({ GHI: 1, RUT: 1 });
  });

  it("cửa sổ ngày tính cả hai đầu; ngoài cửa sổ bỏ im (không đếm)", () => {
    const hang = [
      ls({ ngayMua: "2025-10-06" }),
      ls({ ngayMua: "2026-10-06" }),
      ls({ ngayMua: "2025-10-05" }),
      ls({ ngayMua: "2026-10-07" }),
      ls({ ngayMua: "2025-10-05", ghiTruocMoc: false }),
    ];
    const d = tinhDaiNgoai(hang, VAO);
    expect([d.soDong, d.cuaSoTu, d.denNgay, d.soLoaiTienTe, d.sauMoc.GHI]).toEqual([2, "2025-10-06", "2026-10-06", 0, 0]);
  });

  it("khác tiền tệ ⇒ loại, đếm; không quy đổi được tại mốc ⇒ loại, đếm; nguồn khác nhau sắp tăng", () => {
    const hang = [
      ls({ tienTe: "USD" }),
      ls({ donGiaQuyDoi: null }),
      ls({ nguon: "B" }),
      ls({ nguon: "A" }),
      ls({ nguon: "B" }),
    ];
    const d = tinhDaiNgoai(hang, VAO);
    expect([d.soDong, d.soLoaiTienTe, d.soLoaiKhongQuyDoi]).toEqual([3, 1, 1]);
    expect(d.nguon).toEqual(["A", "B"]);
  });

  it("đơn giá quy đổi không dương là dữ liệu hỏng — NÉM, không đoán", () => {
    expect(() => tinhDaiNgoai([ls({ donGiaQuyDoi: "0" })], VAO)).toThrow(/không dương/u);
  });

  it("[rà soát §S1.9101 THẤP-4] ngày khác dạng YYYY-MM-DD (vd. DateStyle lệch) ⇒ NÉM, không lặng lẽ rơi khỏi cửa sổ", () => {
    expect(() => tinhDaiNgoai([ls({ ngayMua: "01/06/2026" })], VAO)).toThrow(RangeError);
    expect(() => chonMocNgoai([mn({ ngayHieuLuc: "06/01/2026" })], VAO_MOC)).toThrow(RangeError);
  });
});

let demMoc = 0;
const mn = (doi: Partial<HangMocNgoai> = {}): HangMocNgoai => {
  demMoc += 1;
  return {
    id: `m-${String(demMoc)}`,
    tienTe: "VND",
    ngayHieuLuc: "2026-09-01",
    nguon: "Bang gia",
    seq: String(demMoc),
    quyDoiDuoc: true,
    ghiTruocMoc: true,
    rutTruocMoc: false,
    rutSauMoc: false,
    ...doi,
  };
};
const VAO_MOC = { tienTe: "VND", mocMoGia: MOC, cuaSoThang: 12 };

describe("[INV-L15] [INV-L1] [S1.9101 / S4.6b] mốc ngoài — mới nhất trong cửa sổ, cùng tiền tệ, quy đổi được, L1", () => {
  it("ngày hiệu lực mới nhất ≤ ngày(mốc); ngày sau mốc và trước cửa sổ bỏ qua", () => {
    const a = mn({ ngayHieuLuc: "2026-08-01" });
    const b = mn({ ngayHieuLuc: "2026-10-06" });
    const sau = mn({ ngayHieuLuc: "2026-10-07" });
    const cu = mn({ ngayHieuLuc: "2025-10-05" });
    expect(chonMocNgoai([a, b, sau, cu], VAO_MOC).moc?.id).toBe(b.id);
    expect(chonMocNgoai([cu, sau], VAO_MOC).moc).toBeNull();
  });

  it("trùng ngày hiệu lực ⇒ hàng nhập sau (seq lớn hơn, so số không so chữ)", () => {
    const chin = mn({ ngayHieuLuc: "2026-09-01", seq: "9" });
    const muoi = mn({ ngayHieuLuc: "2026-09-01", seq: "10" });
    expect(chonMocNgoai([muoi, chin], VAO_MOC).moc?.id).toBe(muoi.id);
    expect(chonMocNgoai([chin, muoi], VAO_MOC).moc?.id).toBe(muoi.id);
  });

  it("mốc mới nhất không quy đổi được hay khác tiền tệ ⇒ chọn mốc cũ hơn quy đổi được, cùng tiền tệ", () => {
    const cu = mn({ ngayHieuLuc: "2026-07-01" });
    const khongQuyDoi = mn({ ngayHieuLuc: "2026-09-20", quyDoiDuoc: false });
    const usd = mn({ ngayHieuLuc: "2026-09-25", tienTe: "USD" });
    expect(chonMocNgoai([cu, khongQuyDoi, usd], VAO_MOC).moc?.id).toBe(cu.id);
  });

  it("L1: mốc ghi sau mốc mở giá không dùng (đếm); rút trước mốc bỏ; rút SAU mốc vẫn là mốc, nói ra", () => {
    const giu = mn({ ngayHieuLuc: "2026-08-01" });
    const ghiSau = mn({ ngayHieuLuc: "2026-09-30", ghiTruocMoc: false });
    const rutTruoc = mn({ ngayHieuLuc: "2026-09-15", rutTruocMoc: true });
    expect(chonMocNgoai([giu, ghiSau, rutTruoc], VAO_MOC)).toEqual({ moc: giu, ghiSauMoc: 1, rutSauMoc: false });
    const rutSau = mn({ ngayHieuLuc: "2026-09-20", rutSauMoc: true });
    expect(chonMocNgoai([giu, rutSau], VAO_MOC)).toEqual({ moc: rutSau, ghiSauMoc: 0, rutSauMoc: true });
  });
});

describe("[INV-L15] [S1.9101 / S4.6b] độ lệch so với mốc — phần trăm một chữ số lẻ, nửa-ra-xa-0, chính xác", () => {
  it("dương, âm, bằng, khác số chữ số lẻ", () => {
    expect(lechPhanTram("18600", "18000")).toBe("3.3");
    expect(lechPhanTram("17000", "18000")).toBe("-5.6");
    expect(lechPhanTram("100", "100.00")).toBe("0.0");
    expect(lechPhanTram("25000.125", "18000")).toBe("38.9");
    expect(lechPhanTram("0.5", "0.25")).toBe("100.0");
  });

  it("nửa làm tròn ra xa 0 ở cả hai chiều; một số âm làm tròn về 0 không thành `-0.0`", () => {
    expect(lechPhanTram("100.05", "100")).toBe("0.1");
    expect(lechPhanTram("99.95", "100")).toBe("-0.1");
    expect(lechPhanTram("100.04", "100")).toBe("0.0");
    expect(lechPhanTram("99.99", "100")).toBe("0.0");
  });

  it("mốc không dương ⇒ ném", () => {
    expect(() => lechPhanTram("1", "0")).toThrow(RangeError);
  });
});
