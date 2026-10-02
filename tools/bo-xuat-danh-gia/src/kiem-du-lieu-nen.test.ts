// ==============================================================================================
// [S1.9101 / S4.5c2] KIỂM LỚP DỮ LIỆU NỀN — hai lớp, và phép đo rằng lớp độc lập không phải trang trí (ADR-059 ⒞)
//
// Bundle dựng tay trên dữ liệu thiết kế của `DAC-TA.md` §8 (bộ của S4.5b): mốc so 105, dòng 105 trong dải, dòng 130 bất thường trên,
// một dòng chưa ánh xạ. Mỗi đột biến sửa MỘT chỗ của bundle và phải đỏ ở đúng lời báo của nó. Ca cuối dựng một thế giới mà LÕI có lỗi
// (trung vị gói tính bằng trung bình): hàng đã lưu mang nhãn sai của lõi ấy, lớp gọi hàm thuần đi CÙNG lỗi và thấy khớp — chỉ lớp
// độc lập đỏ. Phép so ngẫu nhiên đo rằng trên dữ liệu lành hai lớp đồng ý.
// ==============================================================================================

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAC_TA } from "@trustprocure/danh-gia";
import type { BoBangChung, DongBenchmarkDoc, DuLieuNenDoc, QuanSatDoc } from "./bo.js";
import { kiemBo } from "./kiem.js";
import { HAM_THUAN_BENCHMARK_THAT, type TinhBenchmarkHamThuan } from "./kiem-du-lieu-nen.js";
import { tinhLaiDong } from "./doc-lap/benchmark-lai.js";

const MOC = "2026-09-30T00:00:00.000000Z";
const NGAY = "2026-03-01T08:00:00.000000Z";
const NHOM = {
  cua_so_thang: "12",
  san_goi: "3",
  san_ncc: "3",
  nguong_lech_vua: "0.05",
  nguong_lech_cao: "0.10",
  phuong_phap: "TRUNG_VI_THEO_GOI_V1",
};
const HC = "hc-thep";

const qs = (ma: string, goi: string, ncc: string, gia: string, tuy: Partial<QuanSatDoc> = {}): QuanSatDoc => ({
  ma,
  goi,
  ncc,
  ngay: NGAY,
  gia,
  tienTe: "VND",
  cungNguoiTao: false,
  hoiTo: [],
  ...tuy,
});

const BANG: readonly QuanSatDoc[] = [
  qs("q1", "g1", "n1", "100"),
  qs("q2", "g1", "n2", "120"),
  qs("q3", "g2", "n3", "105", { cungNguoiTao: true }),
  qs("q4", "g3", "n4", "90", { hoiTo: ["ANH_XA"] }),
  qs("q5", "g3", "n5", "110", { hoiTo: ["ANH_XA"] }),
  qs("q6", "g4", "n6", "0"),
];

const DO_DUOC = {
  lyDo: null,
  hangChuan: HC,
  tienTe: "VND",
  cuaSoTu: "2025-09-30T00:00:00.000000Z",
  soQuanSat: 5,
  soGoi: 3,
  soNcc: 5,
  soGoiCungNguoiTao: 1,
  soQuanSatHoiTo: 2,
  soLoaiTienTe: 0,
  soLoaiGia0: 1,
  hoiTo: [],
  anhXa: null,
} as const;

const dong = (lineNo: number, sua: Partial<DongBenchmarkDoc>): DongBenchmarkDoc => ({
  bidVersionId: "bv-1",
  lineNo,
  nhan: "BINH_THUONG",
  chieu: null,
  ...DO_DUOC,
  giaDong: { trangThai: "HOP_LE", gia: "105", tienTe: "VND", hangChuan: HC, hoiTo: [] },
  ...sua,
});

const KHONG_DO = {
  nhan: "KHONG_DO_DUOC",
  chieu: null,
  lyDo: "CHUA_ANH_XA",
  hangChuan: null,
  tienTe: null,
  cuaSoTu: null,
  soQuanSat: null,
  soGoi: null,
  soNcc: null,
  soGoiCungNguoiTao: null,
  soQuanSatHoiTo: null,
  soLoaiTienTe: null,
  soLoaiGia0: null,
  giaDong: null,
} as const;

function boVoi(sua: (d: DuLieuNenDoc) => DuLieuNenDoc = (d) => d): BoBangChung {
  const duLieuNen: DuLieuNenDoc = {
    phuongPhap: "TRUNG_VI_THEO_GOI_V1",
    nguonThoiGian: "đồng hồ CSDL",
    goiX: "gX",
    hangMuc: [{ lineNo: 1, moTa: "Thep D10", donVi: "kg", soLuong: "10.0000" }],
    bangQuanSat: [{ mocMoGia: MOC, hangChuan: HC, tuNgay: "2025-08-30T00:00:00.000000Z", quanSat: BANG }],
    luotCham: [
      {
        evaluationId: "ev-1",
        chinhSachBenchmark: NHOM,
        mocMoGia: MOC,
        docLuc: "2026-10-01T00:00:00.000000Z",
        dong: [
          dong(1, {}),
          dong(2, { ...KHONG_DO }),
          dong(3, { nhan: "LECH_CAO", chieu: "TREN", giaDong: { trangThai: "HOP_LE", gia: "130", tienTe: "VND", hangChuan: HC, hoiTo: [] } }),
        ],
        dauVao: [{ hangChuan: HC, tienTe: "VND", quanSat: ["q1", "q2", "q3", "q4", "q5"] }],
        dauVaoThieu: 0,
      },
    ],
  };
  return {
    dang: "trustprocure/bo-bang-chung-danh-gia",
    phienBan: 2,
    dacTaPhienBan: 2,
    dacTaSha256: "khong-doc-o-tang-nay",
    orgId: "org-1",
    rfqId: "rfq-1",
    xuatLuc: { giaTri: "2026-10-02T00:00:00.000Z", nguon: "đồng hồ tiến trình xuất" },
    luotCham: [
      {
        evaluationId: "ev-1",
        policyId: "pol-1",
        policyVersion: 1,
        currency: "VND",
        chinhSachThanhPhan: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }],
        taoLuc: { giaTri: "2026-10-01T00:00:00.000Z", nguon: "đồng hồ CSDL" },
        hang: [
          {
            bidVersionId: "bv-1",
            supplierName: "NCC 1",
            effectiveCost: "1000.00",
            rank: 1,
            components: [{ ma: "gia", donVi: "TIEN", heSo: "1.0000", giaTri: "1000.00", tien: "1000.00" }],
          },
        ],
      },
    ],
    traoThau: [],
    duLieuNen: sua(duLieuNen),
  };
}

const suaLuot = (f: (l: DuLieuNenDoc["luotCham"][number]) => DuLieuNenDoc["luotCham"][number]) => (d: DuLieuNenDoc): DuLieuNenDoc => ({
  ...d,
  luotCham: d.luotCham.map(f),
});

describe("[INV-L7] [S1.9101 / S4.5c2] lớp dữ liệu nền — bundle lành", () => {
  it("ba dòng ĐẠT, không lời báo; kết luận của cả bundle ĐẠT", () => {
    const kq = kiemBo(boVoi(), DAC_TA);
    expect(kq.duLieuNen).toMatchObject({ soDong: 3, soDat: 3, soLech: 0, loi: [] });
    expect(kq.dat).toBe(true);
  });

  it("bundle không mang lớp này (`null`) ⇒ kết luận chỉ của lớp chấm thầu", () => {
    const kq = kiemBo({ ...boVoi(), duLieuNen: null }, DAC_TA);
    expect(kq.duLieuNen).toBeNull();
    expect(kq.dat).toBe(true);
  });
});

describe("[INV-L7] [S1.9101 / S4.5c2] lớp dữ liệu nền — mỗi đột biến đỏ ở đúng lời báo", () => {
  const lech = (bo: BoBangChung): string => {
    const kq = kiemBo(bo, DAC_TA);
    expect(kq.dat).toBe(false);
    return [...(kq.duLieuNen?.loi ?? []), ...(kq.duLieuNen?.dong.flatMap((d) => d.noi) ?? [])].join("\n");
  };

  it("nhãn đã lưu đổi (130 khai trong dải) ⇒ LỆCH ở `nhan` và `chieu`", () => {
    const bo = boVoi(suaLuot((l) => ({ ...l, dong: l.dong.map((d) => (d.lineNo === 3 ? { ...d, nhan: "BINH_THUONG", chieu: null } : d)) })));
    expect(lech(bo)).toMatch(/dòng 3: `nhan` đã lưu "BINH_THUONG", tính lại ra "LECH_CAO"/u);
  });

  it("đơn giá của quan sát đổi (105 → 112, 90 → 120) ⇒ mốc so 105 → 112, nhãn dòng 1 lệch", () => {
    // Trung vị của ba trung vị gói chỉ dời khi gói GIỮA dời: đổi một giá ở gói ngoài (120 → 200) không đổi mốc — và bộ kiểm ĐÚNG
    // khi nói ĐẠT ở đó. Hai giá dưới đây dời mốc sang 112: |105 − 112| = 7 > 0,05·112 ⇒ lệch vừa dưới.
    const doi: Record<string, string> = { q3: "112", q4: "120" };
    const bo = boVoi((d) => ({
      ...d,
      bangQuanSat: d.bangQuanSat.map((b) => ({ ...b, quanSat: b.quanSat.map((q) => ({ ...q, gia: doi[q.ma] ?? q.gia })) })),
    }));
    expect(lech(bo)).toMatch(/dòng 1: `nhan` đã lưu "BINH_THUONG", tính lại ra "LECH_VUA"/u);
    const ngoai = boVoi((d) => ({
      ...d,
      bangQuanSat: d.bangQuanSat.map((b) => ({ ...b, quanSat: b.quanSat.map((q) => (q.ma === "q2" ? { ...q, gia: "200" } : q)) })),
    }));
    expect(kiemBo(ngoai, DAC_TA).dat, "đổi giá ở gói ngoài không dời trung vị — bộ kiểm không được báo nhầm").toBe(true);
  });

  it("đầu vào đã lưu thiếu một quan sát ⇒ hai tập khác nhau; `dauVaoThieu > 0` ⇒ lời báo §8.6", () => {
    expect(lech(boVoi(suaLuot((l) => ({ ...l, dauVao: [{ ...l.dauVao[0]!, quanSat: ["q1", "q2", "q3", "q4"] }] }))))).toMatch(
      /có 4 quan sát, tính lại ra 5 — hai tập khác nhau/u,
    );
    expect(lech(boVoi(suaLuot((l) => ({ ...l, dauVaoThieu: 2 }))))).toMatch(/2 đầu vào đã lưu không còn trong bảng quan sát/u);
  });

  it("số đếm đã lưu đổi; cờ hồi tố của dòng khác giá của dòng ⇒ LỆCH gọi đúng tên trường", () => {
    expect(lech(boVoi(suaLuot((l) => ({ ...l, dong: l.dong.map((d) => (d.lineNo === 1 ? { ...d, soNcc: 4 } : d)) }))))).toMatch(
      /dòng 1: `soNcc` đã lưu 4, tính lại ra 5/u,
    );
    expect(lech(boVoi(suaLuot((l) => ({ ...l, dong: l.dong.map((d) => (d.lineNo === 1 ? { ...d, hoiTo: ["QUY_DOI"] } : d)) }))))).toMatch(
      /cờ hồi tố đã lưu \[QUY_DOI\]/u,
    );
  });

  it("dòng của một báo giá không có trong bảng xếp hạng; lượt chấm không có ở lớp chấm thầu ⇒ lời báo mức lớp", () => {
    expect(lech(boVoi(suaLuot((l) => ({ ...l, dong: l.dong.map((d) => ({ ...d, bidVersionId: d.lineNo === 2 ? "bv-la" : d.bidVersionId })) }))))).toMatch(
      /báo giá bv-la có nhãn benchmark mà không có trong bảng xếp hạng/u,
    );
    expect(lech(boVoi(suaLuot((l) => ({ ...l, evaluationId: "ev-la" }))))).toMatch(/lượt chấm ev-la KHÔNG có ở lớp chấm thầu/u);
  });

  it("dòng đo được mà thiếu bảng quan sát của (mốc, hàng chuẩn) ⇒ không tính lại được", () => {
    expect(lech(boVoi((d) => ({ ...d, bangQuanSat: [] })))).toMatch(/không có bảng quan sát/u);
  });

  it("lớp gọi hàm thuần có lỗi (luôn BINH_THUONG) ⇒ HAI LỚP BẤT ĐỒNG — dù hàng đã lưu đúng", () => {
    const sai: TinhBenchmarkHamThuan = (q, v) => ({ ...HAM_THUAN_BENCHMARK_THAT(q, v), nhan: "BINH_THUONG", chieu: null });
    const kq = kiemBo(boVoi(), DAC_TA, undefined, sai);
    expect(kq.dat).toBe(false);
    expect(kq.duLieuNen?.dong.flatMap((d) => d.noi).join("\n")).toMatch(/dòng 3: HAI LỚP BẤT ĐỒNG/u);
  });
});

describe("[INV-L7] [S1.9101 / S4.5c2] ADR-059 ⒞ — một lỗi NẰM TRONG lõi chỉ lớp độc lập bắt được", () => {
  // Thế giới có lỗi: lõi lấy trung vị gói bằng TRUNG BÌNH. Gói g1 {100, 120} vẫn 110, nhưng thêm một gói {100, 100, 160} ⇒ trung vị
  // thật 100, trung bình 120. Bốn gói {110, 105, 100, 100} ⇒ mốc thật 102,5; bản lỗi {110, 105, 100, 120} ⇒ 107,5. Dòng 112: thật
  // |9,5| > 5,125 ⇒ LECH_VUA TREN; bản lỗi |4,5| ≤ 5,375 ⇒ BINH_THUONG. Hàng đã lưu mang nhãn CỦA BẢN LỖI.
  const them = [qs("q7", "g5", "n7", "100"), qs("q8", "g5", "n8", "100"), qs("q9", "g5", "n9", "160")];
  // Lõi lỗi, thu về đúng đầu ra của nó cho dòng duy nhất của thế giới này (phép đột biến THẬT trên `tinhDai` nằm ở biên bản).
  const loiTrungBinh: TinhBenchmarkHamThuan = () => ({
    nhan: "BINH_THUONG",
    chieu: null,
    dauVao: ["q1", "q2", "q3", "q4", "q5", "q7", "q8", "q9"],
  });
  const boLoi = boVoi((d) => ({
    ...d,
    bangQuanSat: d.bangQuanSat.map((b) => ({ ...b, quanSat: [...b.quanSat, ...them] })),
    luotCham: d.luotCham.map((l) => ({
      ...l,
      dong: [
        dong(1, {
          giaDong: { trangThai: "HOP_LE", gia: "112", tienTe: "VND", hangChuan: HC, hoiTo: [] },
          soQuanSat: 8,
          soGoi: 4,
          soNcc: 8,
        }),
      ],
      dauVao: [{ hangChuan: HC, tienTe: "VND", quanSat: ["q1", "q2", "q3", "q4", "q5", "q7", "q8", "q9"] }],
    })),
  }));

  it("chỉ lớp gọi hàm thuần chạy (lõi lỗi, cùng lỗi với hàng đã lưu) thì thấy khớp — phép đo rằng lớp ấy MÙ với lỗi này", () => {
    const d = boLoi.duLieuNen!.luotCham[0]!.dong[0]!;
    const ht = loiTrungBinh(boLoi.duLieuNen!.bangQuanSat[0]!.quanSat, {
      goiX: "gX",
      mocMoGia: MOC,
      nhom: NHOM,
      tienTe: "VND",
      gia: "112",
    });
    expect([ht.nhan, ht.chieu]).toEqual([d.nhan, d.chieu]);
  });

  it("bộ kiểm có lớp độc lập ⇒ ĐỎ: nhãn đã lưu BINH_THUONG, bản cài từ đặc tả ra LECH_VUA", () => {
    const kq = kiemBo(boLoi, DAC_TA, undefined, loiTrungBinh);
    expect(kq.dat).toBe(false);
    expect(kq.duLieuNen?.dong.flatMap((x) => x.noi).join("\n")).toMatch(/`nhan` đã lưu "BINH_THUONG", tính lại ra "LECH_VUA"/u);
  });
});

describe("[INV-L7] [S1.9101 / S4.5c2] trên dữ liệu lành, hai lớp đồng ý — 400 bộ ngẫu nhiên", () => {
  const giaArb = fc
    .tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 9999 }))
    .map(([n, l]) => `${String(n)}.${String(l).padStart(4, "0")}`);
  const ngayArb = fc
    .tuple(fc.integer({ min: 2024, max: 2026 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
    .map(([y, m, d]) => `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00.000001Z`);
  const quanSatArb = fc.array(
    fc.record({
      goi: fc.constantFrom("a", "b", "c", "d", "e", "gX"),
      ncc: fc.constantFrom("n1", "n2", "n3", "n4"),
      ngay: ngayArb,
      gia: fc.oneof(giaArb, fc.constant("0")),
      tienTe: fc.constantFrom("VND", "VND", "VND", "USD"),
      cungNguoiTao: fc.boolean(),
      hoiTo: fc.constantFrom([], ["ANH_XA"]),
    }),
    { maxLength: 25 },
  );

  it("nhãn, chiều và tập đầu vào của lớp gọi hàm thuần BẰNG của bản cài độc lập", () => {
    fc.assert(
      fc.property(
        quanSatArb,
        giaArb,
        fc.constantFrom("0.05", "0.1", "0.0001"),
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 3 }),
        (ds, gia, vua, cuaSo, san) => {
          const quanSat = ds.map((q, i) => ({ ...q, ma: `q${String(i)}` }));
          const nhom = { ...NHOM, cua_so_thang: String(cuaSo), san_goi: String(san), san_ncc: String(san), nguong_lech_vua: vua, nguong_lech_cao: "0.5" };
          const tinh = tinhLaiDong({ trangThai: "HOP_LE", gia, tienTe: "VND" }, quanSat, { goiX: "gX", mocMoGia: MOC, nhom });
          const ht = HAM_THUAN_BENCHMARK_THAT(quanSat, { goiX: "gX", mocMoGia: MOC, nhom, tienTe: "VND", gia });
          expect([ht.nhan, ht.chieu]).toEqual([tinh.nhan, tinh.chieu]);
          expect([...ht.dauVao].sort()).toEqual([...(tinh.dauVao ?? [])].sort());
        },
      ),
      { numRuns: 400 },
    );
  });
});
