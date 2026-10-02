// ==============================================================================================
// [S1.262 / S4.5c2] KIỂM LỚP DỮ LIỆU NỀN — hai lớp, và phép đo rằng lớp độc lập không phải trang trí (ADR-059 ⒞)
//
// Bundle dựng tay trên dữ liệu thiết kế của `DAC-TA.md` §8 (bộ của S4.5b): mốc so 105, dòng 105 trong dải, dòng 130 bất thường trên,
// một dòng chưa ánh xạ. Mỗi đột biến sửa MỘT chỗ của bundle và phải đỏ ở đúng lời báo của nó. Ca cuối dựng một thế giới mà LÕI có lỗi
// (trung vị gói tính bằng trung bình): hàng đã lưu mang nhãn sai của lõi ấy, lớp gọi hàm thuần đi CÙNG lỗi và thấy khớp — chỉ lớp
// độc lập đỏ. Phép so ngẫu nhiên đo rằng trên dữ liệu lành hai lớp đồng ý.
// ==============================================================================================

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAC_TA } from "@trustprocure/danh-gia";
import { docBo, type BoBangChung, type DongBenchmarkDoc, type DuLieuNenDoc, type QuanSatDoc } from "./bo.js";
import { kiemBo } from "./kiem.js";
import { HAM_THUAN_BENCHMARK_THAT, type TinhBenchmarkHamThuan } from "./kiem-du-lieu-nen.js";
import { tinhLaiDong } from "./doc-lap/benchmark-lai.js";

const MOC = "2026-09-30T00:00:00.000000Z";
/** Ngày trơn — §8.2: quan sát ngoài ngày biên ra ở dạng NGÀY. */
const NGAY = "2026-03-01";
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

const AX = {
  anhXaId: "ax-1",
  hangChuan: HC,
  nguon: "NGUOI_DUYET",
  lyDo: null,
  tacGia: { userId: "u-ql", hoTen: "Nguoi quan ly" },
  ghiLuc: "2026-09-01T00:00:00.000000Z",
} as const;

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
  anhXa: AX,
} as const;

const dong = (lineNo: number, sua: Partial<DongBenchmarkDoc>): DongBenchmarkDoc => ({
  bidVersionId: "bv-1",
  lineNo,
  nhan: "BINH_THUONG",
  chieu: null,
  ...DO_DUOC,
  giaDong: { anhXaId: "ax-1", trangThai: "HOP_LE", gia: "105", tienTe: "VND", hangChuan: HC, hoiTo: [] },
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
  anhXa: null,
} as const;

function boVoi(sua: (d: DuLieuNenDoc) => DuLieuNenDoc = (d) => d): BoBangChung {
  const duLieuNen: DuLieuNenDoc = {
    phuongPhap: "TRUNG_VI_THEO_GOI_V1",
    nguonThoiGian: "đồng hồ CSDL",
    goiX: "gX",
    hangMuc: [1, 2, 3].map((lineNo) => ({ lineNo, moTa: `Dong ${String(lineNo)}`, donVi: "kg", soLuong: "10.0000" })),
    bangQuanSat: [{ mocMoGia: MOC, hangChuan: HC, tuNgay: "2025-09-30T00:00:00.000000Z", quanSat: BANG }],
    luotCham: [
      {
        evaluationId: "ev-1",
        chinhSachBenchmark: NHOM,
        mocMoGia: MOC,
        docLuc: "2026-10-01T00:00:00.000000Z",
        dong: [
          dong(1, {}),
          dong(2, { ...KHONG_DO }),
          dong(3, { nhan: "LECH_CAO", chieu: "TREN", giaDong: { anhXaId: "ax-1", trangThai: "HOP_LE", gia: "130", tienTe: "VND", hangChuan: HC, hoiTo: [] } }),
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
        coBenchmark: true,
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

describe("[INV-L7] [S1.262 / S4.5c2] lớp dữ liệu nền — bundle lành", () => {
  it("ba dòng ĐẠT, không lời báo; kết luận của cả bundle ĐẠT", () => {
    const kq = kiemBo(boVoi(), DAC_TA);
    expect(kq.duLieuNen).toMatchObject({ soDong: 3, soDat: 3, soLech: 0, loi: [] });
    expect(kq.dat).toBe(true);
  });

  it("bundle không mang lớp này (`null`) và không lượt chấm nào cấu hình benchmark ⇒ kết luận chỉ của lớp chấm thầu", () => {
    const bo = boVoi();
    const kq = kiemBo({ ...bo, luotCham: bo.luotCham.map((l) => ({ ...l, coBenchmark: false })), duLieuNen: null }, DAC_TA);
    expect(kq.duLieuNen).toBeNull();
    expect(kq.dat).toBe(true);
  });
});

describe("[INV-L7] [S1.262 / S4.5c2] lớp dữ liệu nền — mỗi đột biến đỏ ở đúng lời báo", () => {
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

describe("[INV-L7] [S1.262 / S4.5c2] ADR-059 ⒞ — một lỗi NẰM TRONG lõi chỉ lớp độc lập bắt được", () => {
  // Thế giới có lỗi: lõi lấy trung vị gói bằng TRUNG BÌNH. Gói g1 {100, 120} vẫn 110, nhưng thêm một gói {100, 100, 160} ⇒ trung vị
  // thật 100, trung bình 120. Bốn gói {110, 105, 100, 100} ⇒ mốc thật 102,5; bản lỗi {110, 105, 100, 120} ⇒ 107,5. Dòng 112: thật
  // |9,5| > 5,125 ⇒ LECH_VUA TREN; bản lỗi |4,5| ≤ 5,375 ⇒ BINH_THUONG. Hàng đã lưu mang nhãn CỦA BẢN LỖI.
  const them = [qs("q7", "g5", "n7", "100"), qs("q8", "g5", "n8", "100"), qs("q9", "g5", "n9", "160")];
  // Lõi lỗi, thu về đúng đầu ra của nó cho dòng duy nhất của thế giới này (phép đột biến THẬT trên `tinhDai` nằm ở biên bản).
  const loiTrungBinh: TinhBenchmarkHamThuan = () => ({
    nhan: "BINH_THUONG",
    chieu: null,
    dauVao: ["q1", "q2", "q3", "q4", "q5", "q7", "q8", "q9"],
    cuaSoTu: "2025-09-30T00:00:00.000000Z",
    soDem: [8, 4, 8, 1, 2, 0, 1],
  });
  const boLoi = boVoi((d) => ({
    ...d,
    hangMuc: d.hangMuc.slice(0, 1),
    bangQuanSat: d.bangQuanSat.map((b) => ({ ...b, quanSat: [...b.quanSat, ...them] })),
    luotCham: d.luotCham.map((l) => ({
      ...l,
      dong: [
        dong(1, {
          giaDong: { anhXaId: "ax-1", trangThai: "HOP_LE", gia: "112", tienTe: "VND", hangChuan: HC, hoiTo: [] },
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

describe("[INV-L7] [S1.262 / S4.5c2] trên dữ liệu lành, hai lớp đồng ý — 400 bộ ngẫu nhiên", () => {
  const giaArb = fc
    .tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 9999 }))
    .map(([n, l]) => `${String(n)}.${String(l).padStart(4, "0")}`);
  const ngayArb = fc
    .tuple(fc.integer({ min: 2023, max: 2026 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
    .chain(([y, m, d]) =>
      fc
        .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 999999 }))
        .map(
          ([h, us]) =>
            `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:15:00.${String(us).padStart(6, "0")}Z`,
        ),
    );
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

  it("nhãn, chiều, cửa sổ, bảy số đếm và tập đầu vào của lớp gọi hàm thuần BẰNG của bản cài độc lập — bốn mốc, kể cả cuối tháng", () => {
    fc.assert(
      fc.property(
        quanSatArb,
        giaArb,
        fc.constantFrom("0.05", "0.1", "0.0001"),
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom(MOC, "2026-03-31T09:15:00.123456Z", "2024-02-29T23:59:59.999999Z", "2025-12-31T00:00:00.000000Z"),
        (ds, gia, vua, cuaSo, san, moc) => {
          const quanSat = ds.map((q, i) => ({ ...q, ma: `q${String(i)}` }));
          const nhom = { ...NHOM, cua_so_thang: String(cuaSo), san_goi: String(san), san_ncc: String(san), nguong_lech_vua: vua, nguong_lech_cao: "0.5" };
          const tinh = tinhLaiDong({ trangThai: "HOP_LE", gia, tienTe: "VND" }, quanSat, { goiX: "gX", mocMoGia: moc, nhom });
          const ht = HAM_THUAN_BENCHMARK_THAT(quanSat, { goiX: "gX", mocMoGia: moc, nhom, tienTe: "VND", gia });
          expect([ht.nhan, ht.chieu, ht.cuaSoTu]).toEqual([tinh.nhan, tinh.chieu, tinh.cuaSoTu]);
          expect(ht.soDem).toEqual([
            tinh.soQuanSat,
            tinh.soGoi,
            tinh.soNcc,
            tinh.soGoiCungNguoiTao,
            tinh.soQuanSatHoiTo,
            tinh.soLoaiTienTe,
            tinh.soLoaiGia0,
          ]);
          expect([...ht.dauVao].sort()).toEqual([...(tinh.dauVao ?? [])].sort());
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("[INV-L7] [S1.262 / rà soát S4.5c2] đủ hàng, ánh xạ khớp, ngày biên, bộ đọc", () => {
  const baoLoi = (bo: BoBangChung): string => {
    const kq = kiemBo(bo, DAC_TA);
    expect(kq.dat).toBe(false);
    return [...(kq.duLieuNen?.loi ?? []), ...(kq.duLieuNen?.dong.flatMap((d) => d.noi) ?? [])].join("\n");
  };

  it("lượt chấm cấu hình benchmark mà bundle bỏ cả lớp (`null`) ⇒ ĐỎ — không qua như một bundle không có gì để kiểm", () => {
    expect(baoLoi({ ...boVoi(), duLieuNen: null })).toMatch(/lớp dữ liệu nền VẮNG mà 1 lượt chấm/u);
  });

  it("lớp mang lượt chấm mà chính sách của nó KHÔNG cấu hình benchmark ⇒ ĐỎ", () => {
    const bo = boVoi();
    expect(baoLoi({ ...bo, luotCham: bo.luotCham.map((l) => ({ ...l, coBenchmark: false })) })).toMatch(/KHÔNG cấu hình benchmark/u);
  });

  it("lượt chấm thứ hai (sau BAFO) cấu hình benchmark mà lớp chỉ mang lượt đầu ⇒ ĐỎ gọi tên lượt thiếu", () => {
    const bo = boVoi();
    const hai = { ...bo.luotCham[0]!, evaluationId: "ev-2" };
    expect(baoLoi({ ...bo, luotCham: [...bo.luotCham, hai] })).toMatch(/lượt chấm ev-2 có phiên bản chính sách cấu hình benchmark mà lớp dữ liệu nền không mang nó/u);
  });

  it("bớt một hàng (dòng LECH_CAO của báo giá) ⇒ THIẾU; nhân đôi một hàng ⇒ TRÙNG", () => {
    expect(baoLoi(boVoi(suaLuot((l) => ({ ...l, dong: l.dong.filter((d) => d.lineNo !== 3) }))))).toMatch(/THIẾU hàng benchmark cho \(báo giá:dòng\) bv-1:3/u);
    expect(baoLoi(boVoi(suaLuot((l) => ({ ...l, dong: [...l.dong, l.dong[0]!] }))))).toMatch(/hàng benchmark TRÙNG \(bv-1:1\)/u);
  });

  it("hàng ánh xạ đã lưu khác hàng hiệu lực tại lúc chấm; dòng không ánh xạ mà mang ánh xạ hay cờ hồi tố; hàng chuẩn lệch ⇒ ĐỎ", () => {
    const sua = (f: (d: DongBenchmarkDoc) => DongBenchmarkDoc) => boVoi(suaLuot((l) => ({ ...l, dong: l.dong.map(f) })));
    expect(baoLoi(sua((d) => (d.lineNo === 1 ? { ...d, anhXa: { ...AX, anhXaId: "ax-khac" } } : d)))).toMatch(
      /dòng 1: hàng ánh xạ đã lưu ax-khac KHÁC hàng hiệu lực tại lúc chấm ax-1/u,
    );
    expect(baoLoi(sua((d) => (d.lineNo === 2 ? { ...d, anhXa: AX } : d)))).toMatch(/dòng 2: dòng không có ánh xạ hiệu lực/u);
    expect(baoLoi(sua((d) => (d.lineNo === 2 ? { ...d, hoiTo: ["ANH_XA"] } : d)))).toMatch(/dòng 2: dòng không có ánh xạ hiệu lực/u);
    expect(baoLoi(sua((d) => (d.lineNo === 1 ? { ...d, hangChuan: "hc-khac" } : d)))).toMatch(/dòng 1: hàng chuẩn của hàng đã lưu/u);
  });

  it("§8.2: một quan sát mang NGÀY TRƠN trên ngày biên (ngày của mốc mở giá) ⇒ không tính lại được — ĐỎ có tên", () => {
    const bo = boVoi((d) => ({
      ...d,
      bangQuanSat: d.bangQuanSat.map((b) => ({ ...b, quanSat: [...b.quanSat, qs("q9", "g9", "n9", "100", { ngay: MOC.slice(0, 10) })] })),
    }));
    expect(baoLoi(bo)).toMatch(/quan sát q9 mang ngày trơn 2026-09-30 trên một ngày biên/u);
  });

  it("bộ đọc từ chối có địa chỉ: phương pháp lạ, sàn 0 hay quá 50, cửa sổ quá 60 tháng, ngưỡng vừa ≥ cao, `dauVaoThieu` âm, đơn giá quá 64 ký tự, ngày sai dạng", () => {
    const tho = (): unknown => JSON.parse(JSON.stringify(boVoi())) as unknown;
    expect(() => docBo(tho())).not.toThrow();
    /** Đặt (hay xoá, `gt === undefined`) giá trị tại một đường dẫn của bản JSON — không ép kiểu `any`. */
    const thu = (duong: readonly (string | number)[], gt: unknown, mau: RegExp): void => {
      const goc = tho();
      let o = goc as Record<string | number, unknown>;
      for (const k of duong.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
      const cuoi = duong.at(-1)!;
      if (gt === undefined) delete o[cuoi];
      else o[cuoi] = gt;
      expect(() => docBo(goc)).toThrow(mau);
    };
    const NHOM_DUONG = ["duLieuNen", "luotCham", 0, "chinhSachBenchmark"] as const;
    thu([...NHOM_DUONG, "phuong_phap"], "KHAC", /chinhSachBenchmark\.phuong_phap/u);
    thu(["duLieuNen", "phuongPhap"], "KHAC", /duLieuNen\.phuongPhap/u);
    thu([...NHOM_DUONG, "san_goi"], "0", /san_goi.*số nguyên 1–50/u);
    thu([...NHOM_DUONG, "san_ncc"], "51", /san_ncc.*số nguyên 1–50/u);
    thu([...NHOM_DUONG, "cua_so_thang"], "61", /cua_so_thang.*số nguyên 1–60/u);
    thu([...NHOM_DUONG, "nguong_lech_vua"], "0.10", /0 < nguong_lech_vua < nguong_lech_cao/u);
    thu(["duLieuNen", "luotCham", 0, "dauVaoThieu"], -1, /dauVaoThieu.*không âm/u);
    thu(["duLieuNen", "bangQuanSat", 0, "quanSat", 0, "gia"], "1".repeat(65), /quanSat\[0\]\.gia/u);
    thu(["duLieuNen", "bangQuanSat", 0, "quanSat", 0, "ngay"], "2026-03-01T08:00Z", /quanSat\[0\]\.ngay/u);
    thu(["luotCham", 0, "coBenchmark"], undefined, /coBenchmark/u);
  });
});
