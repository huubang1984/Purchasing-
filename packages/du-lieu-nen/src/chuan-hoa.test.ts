// [S1.204 / S4.3a / L2] Bảng ca của bộ luật chuẩn hoá, GHIM THEO PHIÊN BẢN (spec S4 §4.4, §2.5 ㉓). Đổi luật mà không thêm
// phiên bản mới thì bảng này đỏ — đó là điều làm *"tái lập được"* có nghĩa: một hàng gợi ý mang phiên bản 1 tính lại dưới
// bộ luật 1 ra đúng thứ đã lưu.
import { describe, expect, it } from "vitest";
import {
  NGUONG_GOI_Y,
  NGUONG_TU_DONG,
  PHIEN_BAN_BO_CHUAN_HOA,
  SO_UNG_VIEN,
  chuanHoa,
  type UngVienHangChuan,
} from "./chuan-hoa.js";

const TAP: readonly UngVienHangChuan[] = [
  {
    id: "a",
    ma: "THEP-D10",
    tenSach: "thep van d10",
    biDanhSach: ["thep d10 hoa phat"],
    thuocTinh: { kich_thuoc: "10" },
    thuocTinhTrongYeu: ["kich_thuoc"],
  },
  { id: "b", ma: "THEP-D12", tenSach: "thep van d12", biDanhSach: [], thuocTinh: { kich_thuoc: "12" }, thuocTinhTrongYeu: ["kich_thuoc"] },
  { id: "c", ma: "XI-MANG-PCB40", tenSach: "xi mang pcb40", biDanhSach: ["xi mang ha tien"], thuocTinh: {}, thuocTinhTrongYeu: [] },
  { id: "d", ma: "ONG-D90", tenSach: "ong nhua d90", biDanhSach: [], thuocTinh: { kich_thuoc: "90" }, thuocTinhTrongYeu: [] },
  { id: "e", ma: "LUOI-B40", tenSach: "luoi thep b40", biDanhSach: [], thuocTinh: { kich_thuoc: "40" }, thuocTinhTrongYeu: ["kich_thuoc"] },
  {
    id: "f",
    ma: "ONG-MK-21",
    tenSach: "ong thep ma kem den hoa phat tieu chuan astm phi 21",
    biDanhSach: [],
    thuocTinh: { kich_thuoc: "21" },
    thuocTinhTrongYeu: ["kich_thuoc"],
  },
];

type Ca = readonly [
  vao: string,
  ketQua: "GOI_Y" | "CAN_DUYET",
  doTinCay: number,
  thuocTinh: Readonly<Record<string, string>>,
  ungVien: readonly (readonly [string, number])[],
];

/** Bộ luật 1. Một phiên bản mới thêm một bảng MỚI; bảng này không sửa. */
const BANG_CA_V1: readonly Ca[] = [
  // Tên trùng và kích thước trùng.
  ["thep van d10", "GOI_Y", 1, { kich_thuoc: "10" }, [["THEP-D10", 1], ["THEP-D12", 0.7333], ["LUOI-B40", 0.2273], ["ONG-MK-21", 0.1273], ["ONG-D90", 0.04]]],
  // Trùng một bí danh — vẫn là GỢI Ý ở lõi: `TU_DONG` là việc của CSDL (L2).
  ["thep d10 hoa phat", "GOI_Y", 1, { kich_thuoc: "10" }, [["THEP-D10", 1], ["THEP-D12", 0.2917], ["ONG-MK-21", 0.2885], ["LUOI-B40", 0.1852], ["XI-MANG-PCB40", 0.0625]]],
  // Kích thước khai mà không hàng nào có — mâu thuẫn với cả hai, không gợi ý.
  ["thep van d14", "CAN_DUYET", 0.7333, { kich_thuoc: "14" }, [["THEP-D10", 0.7333], ["THEP-D12", 0.7333], ["LUOI-B40", 0.2273], ["ONG-MK-21", 0.1273], ["ONG-D90", 0.04]]],
  // THIẾU thuộc tính trọng yếu: tên trùng tuyệt đối, bị chặn dưới NGUONG_TU_DONG — gợi ý, không chắc chắn.
  ["luoi thep b40", "GOI_Y", 0.94, {}, [["LUOI-B40", 0.94], ["THEP-D10", 0.2273], ["THEP-D12", 0.2273], ["ONG-MK-21", 0.0862], ["XI-MANG-PCB40", 0.0769]]],
  // MÂU THUẪN thuộc tính trọng yếu: chữ giống ~0,9, bị chặn dưới NGUONG_GOI_Y — không bao giờ là gợi ý.
  ["ong thep ma kem den hoa phat tieu chuan astm phi 27", "CAN_DUYET", 0.79, { kich_thuoc: "27" }, [["ONG-MK-21", 0.79], ["THEP-D10", 0.2885], ["XI-MANG-PCB40", 0.1404], ["THEP-D12", 0.1273], ["ONG-D90", 0.1071]]],
  // `phi 10 mm` → kích thước 10, trùng THEP-D10: thưởng khớp.
  ["thep phi 10 mm", "CAN_DUYET", 0.42, { kich_thuoc: "10" }, [["THEP-D10", 0.42], ["THEP-D12", 0.2174], ["LUOI-B40", 0.2083], ["ONG-MK-21", 0.1852], ["XI-MANG-PCB40", 0.0741]]],
  ["xi mang pcb40 bao 50kg", "CAN_DUYET", 0.6087, {}, [["XI-MANG-PCB40", 0.6087], ["LUOI-B40", 0.0882], ["ONG-MK-21", 0.0588], ["ONG-D90", 0.0286], ["THEP-D10", 0.025]]],
  // `90mm` → 90; ứng viên điểm 0 bị bỏ.
  ["ong nhua 90mm", "CAN_DUYET", 0.6, { kich_thuoc: "90" }, [["ONG-D90", 0.6], ["ONG-MK-21", 0.0862], ["XI-MANG-PCB40", 0.037]]],
  // Hai kích thước trong một chuỗi là mơ hồ: không trích.
  ["thep d10 d12", "CAN_DUYET", 0.6, {}, [["THEP-D10", 0.6], ["THEP-D12", 0.6], ["LUOI-B40", 0.25], ["ONG-MK-21", 0.1111], ["ONG-D90", 0.0435]]],
  ["gach the", "CAN_DUYET", 0.1579, {}, [["THEP-D10", 0.1579], ["THEP-D12", 0.1579], ["LUOI-B40", 0.15], ["ONG-MK-21", 0.0545], ["XI-MANG-PCB40", 0.0417]]],
  ["", "CAN_DUYET", 0, {}, []],
];

describe("[INV-L2] bộ luật chuẩn hoá bản 1 — bảng ca ghim theo phiên bản", () => {
  it("phiên bản hiện hành là 1 và bảng ca của nó có mặt — đổi hằng mà không thêm bảng thì đỏ", () => {
    expect(PHIEN_BAN_BO_CHUAN_HOA).toBe(1);
    expect([NGUONG_TU_DONG, NGUONG_GOI_Y, SO_UNG_VIEN]).toEqual([0.95, 0.8, 5]);
  });

  it.each(BANG_CA_V1)("%j", (vao, ketQua, doTinCay, thuocTinh, ungVien) => {
    const k = chuanHoa(vao, TAP, 1);
    expect(k).toEqual({
      phienBan: 1,
      ketQua,
      doTinCay,
      thuocTinh,
      ungVien: ungVien.map(([ma, diem]) => ({ hangChuanId: TAP.find((u) => u.ma === ma)?.id, ma, diem })),
    });
  });

  it("tất định: cùng đầu vào hai lần, và đảo thứ tự tập hàng chuẩn, cho cùng kết quả", () => {
    for (const [vao] of BANG_CA_V1) {
      expect(chuanHoa(vao, [...TAP].reverse())).toEqual(chuanHoa(vao, TAP));
    }
  });

  it("trả tối đa năm ứng viên, và mặc định chạy phiên bản hiện hành", () => {
    const nhieu: UngVienHangChuan[] = Array.from({ length: 9 }, (_, i) => ({
      id: `x${i}`,
      ma: `THEP-X${i}`,
      tenSach: `thep van x${i}`,
      biDanhSach: [],
      thuocTinh: {},
      thuocTinhTrongYeu: [],
    }));
    const k = chuanHoa("thep van", nhieu);
    expect(k.phienBan).toBe(PHIEN_BAN_BO_CHUAN_HOA);
    expect(k.ungVien).toHaveLength(SO_UNG_VIEN);
    // Hoà điểm thì theo mã.
    expect(k.ungVien.map((u) => u.ma)).toEqual(["THEP-X0", "THEP-X1", "THEP-X2", "THEP-X3", "THEP-X4"]);
  });

  it("phiên bản không có bộ luật thì NÉM — không tính lại một hàng cũ bằng luật khác", () => {
    expect(() => chuanHoa("thep van d10", TAP, 2)).toThrow(/phiên bản 2/u);
    expect(() => chuanHoa("thep van d10", TAP, 0)).toThrow(/phiên bản 0/u);
  });
});
