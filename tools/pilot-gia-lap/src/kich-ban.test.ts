import { describe, expect, it } from "vitest";
import { HO_SO, coQuyen, hoSo } from "./ho-so.js";
import { DANH_MUC, canHaiChuKy, giaChao, giaVongMot, kiemDanhMuc, kiemKichBan, xepHang, type KichBan } from "./kich-ban.js";

const layKb = (ma: string): KichBan => {
  const kb = DANH_MUC.find((k) => k.ma === ma);
  if (kb === undefined) throw new Error(`thiếu ${ma}`);
  return kb;
};

describe("danh mục kịch bản — kiểm TRƯỚC khi chạy", () => {
  it("toàn bộ danh mục chạy được: mỗi bước giao cho một vai giữ quyền, không vi phạm D2/J3 vô ý", () => {
    expect(kiemDanhMuc()).toEqual([]);
  });

  it("phủ cả hai tổ chức, mọi trạng thái dừng, và mọi nhánh chủ dự án chọn", () => {
    expect(new Set(DANH_MUC.map((k) => k.toChuc))).toEqual(new Set(["SX", "XD"]));
    expect(new Set(DANH_MUC.map((k) => k.dungO))).toEqual(
      new Set(["PENDING_APPROVAL", "OPEN", "UNSEAL_PENDING", "AWARD_PROPOSED", "CANCELLED", "AWARD_APPROVED"]),
    );
    expect(DANH_MUC.some((k) => k.bafo !== undefined)).toBe(true);
    expect(DANH_MUC.some((k) => k.huyTraoThau !== undefined)).toBe(true);
    expect(DANH_MUC.some((k) => k.giaHan !== undefined)).toBe(true);
    expect(DANH_MUC.some((k) => k.thuHoi !== undefined)).toBe(true);
    expect(DANH_MUC.some((k) => k.baoGia.some((b) => (b.suaLai?.length ?? 0) > 0))).toBe(true);
    expect(DANH_MUC.filter((k) => k.cham === true).map((k) => k.ma)).toEqual(["SX-06"]);
    expect(DANH_MUC.some((k) => canHaiChuKy(hoSo(k.toChuc), k))).toBe(true);
    expect(DANH_MUC.some((k) => !canHaiChuKy(hoSo(k.toChuc), k))).toBe(true);
  });

  it("mọi kiểm soát có ít nhất một kịch bản bật nó", () => {
    for (const khoa of ["tuDuyetGoi", "tuDuyetMo", "j3", "tuDuyetTraoThau", "khongXem", "muTruocMo", "nopSauHuy"] as const) {
      expect(DANH_MUC.some((k) => k.kiem[khoa] !== undefined), khoa).toBe(true);
    }
  });

  it("ĐỘT BIẾN — bộ kiểm có răng: mỗi lỗi danh mục thường gặp đều bị bắt", () => {
    const goc = layKb("SX-01");
    const dotBien: readonly [string, KichBan, RegExp][] = [
      ["người tạo tự duyệt gói", { ...goc, vai: { ...goc.vai, duyetGoi: ["nv"] } }, /không có rfq\.approve|D2/u],
      ["người điều phối đề xuất", { ...goc, vai: { ...goc.vai, deXuat: "tp" } }, /J3/u],
      ["người đề xuất tự duyệt", { ...goc, vai: { ...goc.vai, deXuat: "ktt", duyetTraoThau: "ktt" } }, /người duyệt trao thầu là người đề xuất/u],
      ["BUYER duyệt mở thầu", { ...goc, vai: { ...goc.vai, duyetMo: ["nv"] } }, /rfq\.unseal\.approve/u],
      ["thiếu chữ ký gói trên ngưỡng", { ...goc, goi: { ...goc.goi, nganSach: "900000000.00" } }, /cần 2 chữ ký/u],
      ["hai nhà cung cấp cùng giá", { ...goc, baoGia: goc.baoGia.map((b) => ({ ...b, heSo: 1000 })) }, /cùng tổng giá/u],
      ["báo giá không được mời", { ...goc, baoGia: [...goc.baoGia, { ncc: "S6", heSo: 1111 }] }, /không được mời/u],
      ["hạn nộp dưới sàn", { ...goc, goi: { ...goc.goi, hanNopPhut: 30 } }, /dưới 62 phút/u],
      ["khongXem có quyền xem", { ...goc, kiem: { ...goc.kiem, khongXem: "ktt" } }, /có bid\.view/u],
      ["người không tồn tại", { ...goc, vai: { ...goc.vai, cham: "khong-ai" } }, /không có người/u],
    ];
    for (const [ten, kb, mau] of dotBien) {
      const loi = kiemKichBan(kb);
      expect(loi.some((l) => mau.test(l)), `${ten}: ${JSON.stringify(loi)}`).toBe(true);
    }
  });

  it("giá chào tính trước, xác định, và tổng khớp tổng các dòng", () => {
    const kb = layKb("SX-01");
    const hs = hoSo("SX");
    const g = giaChao(hs, kb, 970);
    expect(g.lines).toHaveLength(4);
    expect(g).toEqual(giaChao(hs, kb, 970));
    // Tính tay: 20 × 11 640 000 + 40 × 1 940 000 + 5000 × 6 310 + 262,5 × 37 350 = 351 754 375,00
    expect(g.totalAmount).toBe("351754375.00");
    const xh = xepHang(giaVongMot(hs, kb));
    expect(xh[0]).toBe("S1");
    expect(xh).toHaveLength(4);
  });

  it("ĐỘ SẮC của phép so từng chữ số: mọi gói có báo giá đều có tổng KHÔNG tròn nghìn, và có gói mang hàng xu", () => {
    // Đột biến ở biên bản vòng này: bảng so sánh làm tròn tổng tới nghìn đồng SỐNG SÓT trên dữ liệu tròn nghìn.
    const tong = DANH_MUC.flatMap((k) => [...giaVongMot(hoSo(k.toChuc), k).values()]);
    expect(tong.length).toBeGreaterThan(20);
    const tronNghin = tong.filter((t) => t.endsWith("000.00"));
    expect(tronNghin.length, `tổng tròn nghìn: ${tronNghin.join(", ")}`).toBeLessThanOrEqual(tong.length / 4);
    for (const k of DANH_MUC.filter((x) => x.baoGia.length > 0)) {
      const g = [...giaVongMot(hoSo(k.toChuc), k).values()];
      expect(g.some((t) => !t.endsWith("000.00")), k.ma).toBe(true);
    }
    expect(tong.some((t) => !t.endsWith(".00"))).toBe(true);
  });

  it("giá vòng một lấy phiên bản CUỐI và bỏ lần nộp trễ", () => {
    const hs = hoSo("SX");
    const sx02 = giaVongMot(hs, layKb("SX-02"));
    expect(sx02.get("S5")).toBe(giaChao(hs, layKb("SX-02"), 960).totalAmount);
    expect(giaVongMot(hs, layKb("SX-06")).has("S5")).toBe(false);
  });

  it("hồ sơ giả lập tự khai là giả lập: tên, tên miền, mã số thuế", () => {
    for (const hs of HO_SO) {
      expect(hs.ten.startsWith("[GIẢ LẬP]"), hs.ten).toBe(true);
      expect(hs.tenMien.endsWith(".invalid")).toBe(true);
      for (const n of hs.nhaCungCap) {
        expect(n.tenPhapLy.startsWith("[GL]"), n.tenPhapLy).toBe(true);
        expect(n.tenMien.endsWith(".invalid")).toBe(true);
        expect(n.mst).toMatch(/^0000000\d{3}$/u);
      }
      expect(hs.nguoi.some((n) => n.vai === "FINANCE")).toBe(true);
      expect(hs.nguoi.filter((n) => n.vai === "DIRECTOR").length).toBeGreaterThanOrEqual(2);
      expect(hs.nguoi.filter((n) => coQuyen(n.vai, "rfq.approve")).length).toBeGreaterThanOrEqual(3);
    }
  });
});
