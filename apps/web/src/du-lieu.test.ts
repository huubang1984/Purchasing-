// ==============================================================================================
// [S1.199 / S4.2b] PHÉP ĐO CHO CÁC PHÉP TÍNH CỦA MÀN DỮ LIỆU NỀN
//
// Ba biểu thức của màn (khoá thuộc tính, mã hàng chuẩn, hệ số) chép từ CSDL và gói: ca đầu đối chiếu chúng với NGUỒN — đọc
// `083_hang_chuan.sql` và `hang-chuan.ts` —, nên một lần sửa luật ở máy chủ mà quên màn làm test này đỏ thay vì làm màn nói sai.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cauVaiQuanLy,
  docThuocTinh,
  docTrongYeu,
  heSoHopLe,
  locHangChuan,
  locHangDoi,
  luaChonHangChuan,
  maHopLe,
  moTaQuyDoi,
  docLoiLo,
  khoangNgay,
  moTaLoiDong,
  nhanGoiY,
  phanTram,
  thanLoVuotTran,
  TIEU_DE_MAU,
  vietThuocTinh,
} from "./du-lieu.js";

const nguon = (duong: string): string => readFileSync(new URL(`../../../${duong}`, import.meta.url), "utf8");

describe("[S1.199 / S4.2b] ba biểu thức của màn khớp nguồn của chúng", () => {
  it("khoá thuộc tính và mã hàng chuẩn là đúng biểu thức của `CHECK` trong `083`; hệ số là đúng `HE_SO` của gói", () => {
    const mig = nguon("db/migrations/083_hang_chuan.sql");
    const man = nguon("apps/web/src/du-lieu.ts");
    const goi = nguon("packages/du-lieu-nen/src/hang-chuan.ts");
    expect(mig).toContain('like_regex "^[a-z][a-z0-9_]{0,39}$"');
    expect(man).toContain("const KHOA = /^[a-z][a-z0-9_]{0,39}$/u;");
    expect(mig).toContain("ma ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'");
    expect(man).toContain("const MA = /^[A-Z0-9][A-Z0-9._-]{0,39}$/u;");
    const heSoGoi = /const HE_SO = (\/.+\/u);/u.exec(goi)?.[1];
    expect(heSoGoi).toBeDefined();
    expect(man).toContain(`const HE_SO = ${heSoGoi ?? "?"};`);
  });
});

describe("[S1.199 / S4.2b] ô thuộc tính", () => {
  it("đọc mỗi dòng một cặp, bỏ dòng trống, giữ nguyên giá trị có dấu hai chấm", () => {
    expect(docThuocTinh("mac: CB300\n\n nha_san_xuat :  Hòa Phát \nkich_thuoc: 1500x6000: tấm")).toEqual({
      ok: true,
      thuocTinh: { mac: "CB300", nha_san_xuat: "Hòa Phát", kich_thuoc: "1500x6000: tấm" },
    });
    expect(docThuocTinh("")).toEqual({ ok: true, thuocTinh: {} });
  });

  it("từ chối có số dòng: thiếu dấu hai chấm, khoá viết hoa hay có dấu, giá trị rỗng, khoá trùng", () => {
    for (const [chu, dong] of [
      ["mac CB300", "dòng 1"],
      ["mac: CB300\nMac: CB400", "dòng 2"],
      ["mác: CB300", "dòng 1"],
      ["mac:", "dòng 1"],
      ["mac: a\nmac: b", "dòng 2"],
      [": CB300", "dòng 1"],
    ] as const) {
      const kq = docThuocTinh(chu);
      expect(kq.ok, chu).toBe(false);
      if (!kq.ok) expect(kq.loi, chu).toContain(dong);
    }
  });

  it("viết lại theo thứ tự khoá, và đọc lại ra đúng object", () => {
    const tt = { mac: "CB300", day_mm: "10" };
    expect(vietThuocTinh(tt)).toBe("day_mm: 10\nmac: CB300");
    expect(docThuocTinh(vietThuocTinh(tt))).toEqual({ ok: true, thuocTinh: tt });
  });

  it("trọng yếu: phân cách dấu phẩy, bỏ trùng và rỗng; khoá không có trong thuộc tính ⇒ từ chối, nêu tên", () => {
    expect(docTrongYeu(" mac , day_mm,, mac", { mac: "x", day_mm: "y" })).toEqual({ ok: true, khoa: ["mac", "day_mm"] });
    expect(docTrongYeu("", {})).toEqual({ ok: true, khoa: [] });
    const kq = docTrongYeu("mac, tieu_chuan", { mac: "x" });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.loi).toContain("tieu_chuan");
  });
});

describe("[S1.199 / S4.2b] mã và hệ số", () => {
  it("mã: viết hoa, chữ số chấm gạch; không chữ thường, không dấu, không quá 40 ký tự", () => {
    for (const ma of ["THEP-D10", "BU-LONG-NEO-M24-8.8", "X", "A_B"]) expect(maHopLe(ma), ma).toBe(true);
    for (const ma of ["thep-d10", "-THEP", "THÉP", "THEP D10", "", "A".repeat(41)]) expect(maHopLe(ma), ma).toBe(false);
  });

  it("hệ số: thập phân dương dùng dấu chấm; 0, âm, dấu phẩy, số mũ ⇒ không", () => {
    for (const h of ["7.22", "1", "0.617", "706.5"]) expect(heSoHopLe(h), h).toBe(true);
    for (const h of ["0", "0.000", "-1", "7,22", "1e3", "", ".5", "01"]) expect(heSoHopLe(h), h).toBe(false);
  });

  it("dòng quy đổi in nguyên chuỗi máy chủ, chỉ bỏ số 0 thừa sau dấu chấm", () => {
    expect(moTaQuyDoi({ tuDonVi: "cay", sangDonVi: "kg", heSo: "7.2200" })).toBe("1 cay = 7.22 kg");
    expect(moTaQuyDoi({ tuDonVi: "bo", sangDonVi: "cai", heSo: "1" })).toBe("1 bo = 1 cai");
    expect(moTaQuyDoi({ tuDonVi: "tam", sangDonVi: "kg", heSo: "700.000" })).toBe("1 tam = 700 kg");
    expect(moTaQuyDoi({ tuDonVi: "cuon", sangDonVi: "kg", heSo: "1000" })).toBe("1 cuon = 1000 kg");
  });
});

describe("[S1.199 / S4.2b] lọc hiển thị", () => {
  const DS = [
    { ma: "THEP-D10", ten: "Thép cây D10 Hòa Phát" },
    { ma: "XI-MANG-PCB40", ten: "Xi măng Nghi Sơn" },
    { ma: "DA-1X2", ten: "Đá 1x2" },
  ];
  it("bỏ dấu, không phân biệt hoa thường, trên cả mã và tên; ô rỗng ⇒ mọi dòng", () => {
    expect(locHangChuan(DS, "thep").map((h) => h.ma)).toEqual(["THEP-D10"]);
    expect(locHangChuan(DS, "HÒA PHÁT").map((h) => h.ma)).toEqual(["THEP-D10"]);
    expect(locHangChuan(DS, "da 1x2").map((h) => h.ma)).toEqual(["DA-1X2"]);
    expect(locHangChuan(DS, "pcb40").map((h) => h.ma)).toEqual(["XI-MANG-PCB40"]);
    expect(locHangChuan(DS, "   ")).toHaveLength(3);
    expect(locHangChuan(DS, "ton lanh")).toEqual([]);
  });
});

describe("[S1.199 / S4.2b] câu §8.10 của spec S4", () => {
  it("người giữ vai ⇒ không câu nào; chưa ai giữ ⇒ đòi một NGƯỜI MỚI; đã có người ⇒ nói chỉ xem được", () => {
    expect(cauVaiQuanLy(true, 1)).toBeNull();
    const chuaAi = cauVaiQuanLy(false, 0) ?? "";
    expect(chuaAi).toContain("DATA_STEWARD");
    expect(chuaAi).toContain("TECHNICAL");
    expect(chuaAi).toContain("Tài chính");
    expect(chuaAi).toContain("NGƯỜI MỚI");
    const daCo = cauVaiQuanLy(false, 2) ?? "";
    expect(daCo).toContain("2 người");
    expect(daCo).toContain("chỉ xem");
    expect(daCo).not.toContain("NGƯỜI MỚI");
  });
});

describe("[S1.234 / S4.3b] hàng đợi ánh xạ", () => {
  const GOI_Y = {
    ketQua: "GOI_Y",
    doTinCay: "0.9400",
    ungVien: [
      { hangChuanId: "h-12", ma: "THEP-D12", diem: 0.94 },
      { hangChuanId: "h-cu", ma: "THEP-CU", diem: 0.5 },
    ],
  };
  const HANG = [
    { id: "h-10", ma: "THEP-D10", ten: "Thép vằn D10", trangThai: "DANG_DUNG" },
    { id: "h-12", ma: "THEP-D12", ten: "Thép vằn D12", trangThai: "DANG_DUNG" },
    { id: "h-ngung", ma: "THEP-NGUNG", ten: "Thép ngừng", trangThai: "NGUNG_DUNG" },
  ];

  it("phần trăm: làm tròn; giá trị ngoài [0, 1] hay không phải số ⇒ —", () => {
    expect(phanTram("0.9400")).toBe("94%");
    expect(phanTram(0.795)).toBe("80%");
    expect(phanTram("1")).toBe("100%");
    expect(phanTram("abc")).toBe("—");
    expect(phanTram(1.2)).toBe("—");
  });

  it("cột gợi ý: kết quả, độ tin cậy, ứng viên đầu; không ứng viên; chưa chuẩn hoá", () => {
    expect(nhanGoiY(GOI_Y)).toBe("Gợi ý 94% — THEP-D12");
    expect(nhanGoiY({ ketQua: "CAN_DUYET", doTinCay: "0", ungVien: [] })).toBe("Cần duyệt — không có ứng viên");
    expect(nhanGoiY(null)).toContain("Chưa chuẩn hoá");
  });

  it("ô chọn: ứng viên trước theo thứ tự của lõi, rồi hàng đang dùng còn lại; hàng ngừng dùng không vào; ứng viên lạ vẫn liệt", () => {
    expect(luaChonHangChuan(GOI_Y, HANG)).toEqual([
      { id: "h-12", nhan: "THEP-D12 — Thép vằn D12 (94%)" },
      { id: "h-cu", nhan: "THEP-CU —  (50%)" },
      { id: "h-10", nhan: "THEP-D10 — Thép vằn D10" },
    ]);
    expect(luaChonHangChuan(null, HANG).map((x) => x.id)).toEqual(["h-10", "h-12"]);
  });

  it("[lượt soi S4.3b, L1] ứng viên của gợi ý đã lưu mà danh sách đang hiện nói là ngừng dùng thì bỏ", () => {
    const goiYCu = { ...GOI_Y, ungVien: [{ hangChuanId: "h-ngung", ma: "THEP-NGUNG", diem: 0.97 }, ...GOI_Y.ungVien] };
    expect(luaChonHangChuan(goiYCu, HANG).map((x) => x.id)).toEqual(["h-12", "h-cu", "h-10"]);
  });

  it("lọc hàng đợi theo mô tả hoặc tên gói, bỏ dấu", () => {
    const DS = [
      { tieuDe: "Mua thep quy IV", moTa: "Thép vằn D12" },
      { tieuDe: "Xay kho", moTa: "Gạch thẻ đỏ" },
    ];
    expect(locHangDoi(DS, "gach").map((d) => d.moTa)).toEqual(["Gạch thẻ đỏ"]);
    expect(locHangDoi(DS, "QUY IV").map((d) => d.moTa)).toEqual(["Thép vằn D12"]);
    expect(locHangDoi(DS, "")).toHaveLength(2);
  });
});

describe("[S1.9101 / S4.6a] bước 7 — mốc giá ngoài và lịch sử mua ngoài hệ thống", () => {
  it("dòng tiêu đề mẫu của màn là ĐÚNG bộ cột của bộ đọc ở gói (`COT_THEO_LOAI` của `csv-ngoai.ts`) — sửa một bên là đỏ ở đây", () => {
    const goi = nguon("packages/du-lieu-nen/src/csv-ngoai.ts");
    const chung = /const COT_CHUNG = \[([^\]]+)\] as const;/u.exec(goi)?.[1];
    const moc = /MOC_NGOAI: \[\.\.\.COT_CHUNG, ([^\]]+)\]/u.exec(goi)?.[1];
    const lichSu = /LICH_SU_NGOAI: \[\.\.\.COT_CHUNG, ([^\]]+)\]/u.exec(goi)?.[1];
    const tach = (x: string | undefined): string[] => (x ?? "").split(",").map((c) => c.trim().replace(/^"|"$/gu, "")).filter((c) => c !== "");
    expect(tach(chung)).toHaveLength(5);
    expect(TIEU_DE_MAU.MOC_NGOAI.split("\t").sort()).toEqual([...tach(chung), ...tach(moc)].sort());
    expect(TIEU_DE_MAU.LICH_SU_NGOAI.split("\t").sort()).toEqual([...tach(chung), ...tach(lichSu)].sort());
  });

  it("thân 422 của lô bị từ chối thành câu theo dòng; dòng 1 là tiêu đề; một 422 khác (không `loi`) ⇒ null", () => {
    expect(moTaLoiDong({ dong: 3, cot: "don_vi", ma: "DON_VI_RONG", cau: "đơn vị trống" })).toBe("Dòng 3, cột don_vi: đơn vị trống");
    expect(moTaLoiDong({ dong: 1, cot: null, ma: "LO_RONG", cau: "lô rỗng" })).toBe("Dòng 1: lô rỗng");
    expect(
      docLoiLo({
        error: "lô bị từ chối: 2 lỗi",
        loi: [
          { dong: 1, cot: "vat", ma: "COT_LA", cau: "cột không thuộc mẫu" },
          { dong: 4, cot: null, ma: "SO_O_SAI", cau: "số ô khác tiêu đề" },
          { dong: "x", cau: 1 },
          null,
        ],
      }),
    ).toEqual(["Dòng 1, cột vat: cột không thuộc mẫu", "Dòng 4: số ô khác tiêu đề"]);
    expect(docLoiLo({ error: "thiếu trường \"vanBan\"" })).toBeNull();
    expect(docLoiLo(null)).toBeNull();
  });

  it("trần thân của màn là trần của API; đếm BYTE của thân JSON, không đếm ký tự — chữ có dấu nặng gấp ba", () => {
    expect(nguon("apps/api/src/router.ts")).toContain("export const TRAN_THAN_BYTE = 64 * 1024;");
    const vua = "a".repeat(64 * 1024 - JSON.stringify({ vanBan: "" }).length);
    expect(thanLoVuotTran(vua)).toBe(false);
    expect(thanLoVuotTran(`${vua}a`)).toBe(true);
    // "ạ" là 3 byte UTF-8: 22 000 ký tự ≈ 66 KB — vượt, dù chưa tới 64 × 1024 ký tự.
    expect(thanLoVuotTran("ạ".repeat(22_000))).toBe(true);
  });

  it("khoảng ngày của một lô: một ngày khi hai đầu trùng", () => {
    expect(khoangNgay("2025-11-20", "2025-12-05")).toBe("2025-11-20 → 2025-12-05");
    expect(khoangNgay("2026-01-15", "2026-01-15")).toBe("2026-01-15");
  });
});
