// [S1.256 / S4.5b] [INV-L7] Lõi thuần của benchmark: số thập phân chính xác, phân vị, cửa sổ tháng, dải, nhãn — bảng ca của spec S4
// §6 (*"tập lẻ, tập chẵn, dưới sàn, có quan sát của chính gói, …"*) cộng phép so với một bản cài tham chiếu bằng phân số.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  NHOM_BENCHMARK_MAU,
  docNhomBenchmark,
  ganNhan,
  tinhDai,
  truThang,
  type NhomBenchmark,
  type QuanSatBenchmark,
} from "./benchmark.js";
import { chiaLuyThua2, chuoiThapPhan, docThapPhan, nhanNguyen, phanViTu, sapTang, soSanh } from "./so-thap-phan.js";

const NHOM: NhomBenchmark = docNhomBenchmark(NHOM_BENCHMARK_MAU)!;
const us = (iso: string): bigint => BigInt(Date.parse(iso)) * 1000n;
const MOC = us("2026-10-01T03:00:00.000Z");

let dem = 0;
function qs(rfqId: string, supplierId: string, gia: string | null, them: Partial<QuanSatBenchmark> = {}): QuanSatBenchmark {
  dem += 1;
  return {
    rfqId,
    supplierId,
    bidVersionId: `bv-${String(dem)}`,
    lineNo: 1,
    anhXaId: `ax-${String(dem)}`,
    ngayQuanSat: us("2026-06-01T00:00:00.000Z"),
    trangThai: gia === null ? "KHONG_DOC_DUOC" : "HOP_LE",
    donGiaQuyDoi: gia,
    tienTe: "VND",
    hoiTo: [],
    goiCungNguoiTao: false,
    ...them,
  };
}

describe("[INV-L7] số thập phân chính xác", () => {
  it("đọc và viết lại chuỗi `numeric`; từ chối số mũ, NaN, khoảng trắng", () => {
    expect(chuoiThapPhan(docThapPhan("33.3333333333333333"))).toBe("33.3333333333333333");
    expect(chuoiThapPhan(docThapPhan("1.500"))).toBe("1.5");
    expect(chuoiThapPhan(docThapPhan("-0.000"))).toBe("0");
    expect(chuoiThapPhan(docThapPhan("0.05"))).toBe("0.05");
    expect(chuoiThapPhan(chiaLuyThua2(docThapPhan("3"), 2))).toBe("0.75");
    for (const sai of ["1e3", "NaN", "Infinity", " 1", "", "1.", ".5", "+1"]) expect(() => docThapPhan(sai)).toThrow();
  });

  it("trung vị: tập lẻ ra phần tử giữa, tập chẵn ra trung bình hai phần tử giữa — chính xác, không `double`", () => {
    const d = (xs: string[]) => sapTang(xs.map(docThapPhan));
    expect(chuoiThapPhan(phanViTu(d(["3", "1", "2"]), 2))).toBe("2");
    expect(chuoiThapPhan(phanViTu(d(["1", "2", "3", "4"]), 2))).toBe("2.5");
    expect(chuoiThapPhan(phanViTu(d(["0.1", "0.2"]), 2))).toBe("0.15");
    expect(chuoiThapPhan(phanViTu(d(["10000000000000000.01", "10000000000000000.02"]), 2))).toBe("10000000000000000.015");
    // `percentile_cont(0.25)` của {1, 2, 3, 4} = 1.75; của {1..5} = 2.
    expect(chuoiThapPhan(phanViTu(d(["1", "2", "3", "4"]), 1))).toBe("1.75");
    expect(chuoiThapPhan(phanViTu(d(["1", "2", "3", "4"]), 3))).toBe("3.25");
    expect(chuoiThapPhan(phanViTu(d(["1", "2", "3", "4", "5"]), 1))).toBe("2");
    expect(chuoiThapPhan(phanViTu(d(["7"]), 3))).toBe("7");
    expect(() => phanViTu([], 2)).toThrow();
  });

  it("phân vị khớp một bản cài tham chiếu bằng PHÂN SỐ trên mọi dãy (fast-check)", () => {
    // Tham chiếu: vị trí h = p·(n−1) dưới dạng phân số, giá trị = x_⌊h⌋ + (h − ⌊h⌋)·(x_⌊h⌋+1 − x_⌊h⌋), mọi thứ là bigint/10^6.
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 1, maxLength: 40 }), fc.constantFrom(1, 2, 3), (xs, tu) => {
        const sap = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const n = sap.length;
        const tuSo = BigInt(tu * (n - 1));
        const lo = Number(tuSo / 4n);
        const du = tuSo % 4n;
        const a = sap[lo]!;
        const b = sap[Math.min(lo + 1, n - 1)]!;
        // giá trị × 4 × 10^6 (đơn vị gốc là 10^-6)
        const thamChieuX4 = a * 4n + du * (b - a);
        const ket = phanViTu(sapTang(sap.map((v) => ({ m: v, s: 6 }))), tu as 1 | 2 | 3);
        expect(soSanh(nhanNguyen(ket, 4), { m: thamChieuX4, s: 6 })).toBe(0);
      }),
      { numRuns: 500 },
    );
  });
});

describe("[INV-L7] cửa sổ tháng — lịch UTC, kẹp ngày cuối tháng, giữ micro giây", () => {
  it("lùi 1, 12, 60 tháng", () => {
    expect(truThang(us("2026-10-01T03:00:00.000Z") + 123n, 12)).toBe(us("2025-10-01T03:00:00.000Z") + 123n);
    expect(truThang(us("2026-03-31T23:59:59.999Z"), 1)).toBe(us("2026-02-28T23:59:59.999Z"));
    expect(truThang(us("2028-03-31T00:00:00.000Z"), 1)).toBe(us("2028-02-29T00:00:00.000Z"));
    expect(truThang(us("2026-01-15T00:00:00.000Z"), 60)).toBe(us("2021-01-15T00:00:00.000Z"));
    expect(truThang(us("2026-05-31T12:00:00.000Z"), 3)).toBe(us("2026-02-28T12:00:00.000Z"));
  });
});

describe("[INV-L7] dải `TRUNG_VI_THEO_GOI_V1`", () => {
  const vao = { rfqId: "X", tienTe: "VND", mocMoGia: MOC, nhom: NHOM };

  it("mỗi gói một trung vị; mốc so là trung vị các trung vị gói; dải [Q1, Q3] trên các trung vị gói", () => {
    const d = tinhDai(
      [
        qs("A", "s1", "100"),
        qs("A", "s2", "300"), // trung vị A = 200
        qs("B", "s3", "210"),
        qs("C", "s1", "190"),
        qs("C", "s4", "250"),
        qs("C", "s5", "1000"), // trung vị C = 250
      ],
      vao,
    );
    expect(d).toMatchObject({ soGoi: 3, soNcc: 5, soQuanSat: 6, duSan: true });
    expect(d.mocSo).toEqual({ q1: "205", trungVi: "210", q3: "230" });
  });

  it("dưới sàn gói hay sàn nhà cung cấp ⇒ không con số nào; đầu vào vẫn giữ", () => {
    const haiGoi = tinhDai([qs("A", "s1", "100"), qs("B", "s2", "110"), qs("B", "s3", "120")], vao);
    expect(haiGoi).toMatchObject({ soGoi: 2, soNcc: 3, duSan: false, mocSo: null });
    expect(haiGoi.dauVao).toHaveLength(3);
    // Ba gói nhưng chỉ hai nhà cung cấp — cùng hai người báo giá ba gói (khuôn cartel nhỏ, §2.4 ⑾).
    const haiNcc = tinhDai([qs("A", "s1", "100"), qs("B", "s2", "110"), qs("C", "s1", "120")], vao);
    expect(haiNcc).toMatchObject({ soGoi: 3, soNcc: 2, duSan: false, mocSo: null });
    expect(ganNhan("1000000", haiNcc, NHOM)).toEqual({ nhan: "CHUA_DU_LICH_SU", chieu: null });
  });

  it("loại: không HOP_LE, CHÍNH gói X, ngoài cửa sổ (đầu đóng, cuối mở); ĐẾM: khác tiền tệ, đơn giá 0", () => {
    const cuaSoTu = truThang(MOC, 12);
    const d = tinhDai(
      [
        qs("A", "s1", "100"),
        qs("B", "s2", "100"),
        qs("C", "s3", "100"),
        qs("D", "s4", null),
        qs("X", "s5", "1"),
        qs("E", "s6", "100", { ngayQuanSat: cuaSoTu - 1n }),
        qs("F", "s7", "100", { ngayQuanSat: cuaSoTu }),
        qs("G", "s8", "100", { ngayQuanSat: MOC }),
        qs("H", "s9", "100", { tienTe: "USD" }),
        qs("I", "s10", "0"),
        qs("I", "s11", "0.000"),
      ],
      vao,
    );
    expect(d).toMatchObject({ soGoi: 4, soNcc: 4, soLoaiTienTe: 1, soLoaiGia0: 2, cuaSoTu });
    expect(d.dauVao.map((q) => q.rfqId).sort()).toEqual(["A", "B", "C", "F"]);
  });

  it("đếm k gói cùng người tạo và h quan sát hồi tố", () => {
    const d = tinhDai(
      [
        qs("A", "s1", "100", { goiCungNguoiTao: true }),
        qs("A", "s2", "100", { goiCungNguoiTao: true, hoiTo: ["ANH_XA"] }),
        qs("B", "s3", "100", { hoiTo: ["QUY_DOI", "ANH_XA"] }),
        qs("C", "s4", "100"),
      ],
      vao,
    );
    expect(d).toMatchObject({ soGoiCungNguoiTao: 1, soQuanSatHoiTo: 2 });
  });
});

describe("[INV-L7] nhãn — biên đóng, chiều, nhân chéo", () => {
  // Mốc so 200 (ba gói một quan sát). Ngưỡng 0.05 ⇒ ±10; 0.10 ⇒ ±20.
  const dai = tinhDai([qs("A", "s1", "190"), qs("B", "s2", "200"), qs("C", "s3", "210")], {
    rfqId: "X",
    tienTe: "VND",
    mocMoGia: MOC,
    nhom: NHOM,
  });
  it.each([
    ["200", "BINH_THUONG", null],
    ["210", "BINH_THUONG", null],
    ["190", "BINH_THUONG", null],
    ["210.0000000001", "LECH_VUA", "TREN"],
    ["189.9999999999", "LECH_VUA", "DUOI"],
    ["220", "LECH_VUA", "TREN"],
    ["180", "LECH_VUA", "DUOI"],
    ["220.01", "LECH_CAO", "TREN"],
    ["0", "LECH_CAO", "DUOI"],
    ["5000000", "LECH_CAO", "TREN"],
  ] as const)("đơn giá %s ⇒ %s %s", (gia, nhan, chieu) => {
    expect(ganNhan(gia, dai, NHOM)).toEqual({ nhan, chieu });
  });
});

describe("[INV-L7] nhóm khoá `benchmark` của chính sách", () => {
  it("mẫu điền sẵn đọc được; `null` là chưa cấu hình", () => {
    expect(NHOM).toEqual({
      cuaSoThang: 12,
      sanGoi: 3,
      sanNcc: 3,
      nguongLechVua: "0.05",
      nguongLechCao: "0.10",
      phuongPhap: "TRUNG_VI_THEO_GOI_V1",
    });
    expect(docNhomBenchmark(null)).toBeNull();
  });

  it.each([
    ["mảng", []],
    ["thiếu khoá", { ...NHOM_BENCHMARK_MAU, san_ncc: undefined }],
    ["thừa khoá", { ...NHOM_BENCHMARK_MAU, x: "1" }],
    ["số JSON", { ...NHOM_BENCHMARK_MAU, cua_so_thang: 12 }],
    ["cửa sổ 61", { ...NHOM_BENCHMARK_MAU, cua_so_thang: "61" }],
    ["sàn 0", { ...NHOM_BENCHMARK_MAU, san_goi: "0" }],
    ["vừa = cao", { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: "0.10" }],
    ["vừa 0", { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: "0" }],
    ["cao > 10", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: "10.0001" }],
    ["năm chữ số lẻ", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: "0.12345" }],
    ["phương pháp lạ", { ...NHOM_BENCHMARK_MAU, phuong_phap: "TRUNG_VI_TU_PHAN_VI_V1" }],
  ])("%s ⇒ NÉM", (_ten, tho) => {
    const sach = JSON.parse(JSON.stringify(tho)) as unknown;
    expect(() => docNhomBenchmark(sach)).toThrow();
  });
});
