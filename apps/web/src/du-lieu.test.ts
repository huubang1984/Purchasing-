// ==============================================================================================
// [S1.199 / S4.2b] PHÉP ĐO CHO CÁC PHÉP TÍNH CỦA MÀN DỮ LIỆU NỀN
//
// Ba biểu thức của màn (khoá thuộc tính, mã hàng chuẩn, hệ số) chép từ CSDL và gói: ca đầu đối chiếu chúng với NGUỒN — đọc
// `083_hang_chuan.sql` và `hang-chuan.ts` —, nên một lần sửa luật ở máy chủ mà quên màn làm test này đỏ thay vì làm màn nói sai.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cauVaiQuanLy, docThuocTinh, docTrongYeu, heSoHopLe, locHangChuan, maHopLe, moTaQuyDoi, vietThuocTinh } from "./du-lieu.js";

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
