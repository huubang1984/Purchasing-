// [S1.9101 / S4.7c2] Phép quy đổi TCO (`DAC-TA.md` §9) và cam kết của đề xuất (§10) trong bộ kiểm — hai lớp, mỗi chỗ lệch gọi tên.
import { describe, expect, it } from "vitest";
import { DAC_TA, chiPhiThanhToan, chiPhiTre } from "@trustprocure/danh-gia";
import type { BoBangChung, CamKetDoc, HangBundle, ThanhPhanLuu, TraoThauBundle } from "./bo.js";
import { chiPhiThanhToanLai, chiPhiTreLai, chiaNgan, hangGiaLai } from "./doc-lap/quy-doi-lai.js";
import { docThapPhan, tinhLai, vietThapPhan, xepHangLai, khongTinhDuoc, type ThanhPhanChinhSachDoc } from "./doc-lap/tinh-lai.js";
import { kiemBo } from "./kiem.js";
import { QUY_DOI_THAT, type QuyDoiHamThuan } from "./kiem-tco.js";

const MOT = "1.0000";
const CS: readonly ThanhPhanChinhSachDoc[] = [
  { ma: "gia", don_vi: "TIEN", he_so: MOT },
  { ma: "van_chuyen", don_vi: "TIEN", he_so: MOT },
  { ma: "chi_phi_thanh_toan", don_vi: "TIEN", he_so: MOT },
  { ma: "chi_phi_tre", don_vi: "TIEN", he_so: MOT },
];
const THAM_SO = { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "60", ty_le_tre_ngay: "0.001" } as const;
const SO_NGAY_GIAO = 14;
const NGUON = "đồng hồ của cơ sở dữ liệu lúc ghi";

/** Một hàng ĐÚNG, dựng bằng chính phép quy đổi của lượt chấm — như `luot-danh-gia.ts` ghi. */
function hangTco(id: string, tong: string, freight: string, ngayTra: number, ngayGiao: number): Omit<HangBundle, "rank"> {
  const tt = chiPhiThanhToan(tong, 60, ngayTra, THAM_SO.chi_phi_von_nam);
  const tre = chiPhiTre(tong, SO_NGAY_GIAO, ngayGiao, THAM_SO.ty_le_tre_ngay);
  const giaTri: Record<string, string> = { gia: tong, van_chuyen: freight, chi_phi_thanh_toan: tt, chi_phi_tre: tre };
  const kq = tinhLai(CS, CS.map((c) => ({ ma: c.ma, giaTri: giaTri[c.ma] ?? null })));
  if (khongTinhDuoc(kq)) throw new Error("fixture sai");
  const nguon: Record<string, Record<string, string>> = {
    chi_phi_thanh_toan: { coSo: tong, ngayKhai: String(ngayTra), ngayChuan: "60", tyLe: "0.12" },
    chi_phi_tre: { coSo: tong, ngayKhai: String(ngayGiao), ngayYeuCau: String(SO_NGAY_GIAO), tyLe: "0.001" },
  };
  const components: ThanhPhanLuu[] = kq.components.map((c) => ({
    ma: c.ma,
    donVi: "TIEN",
    heSo: MOT,
    giaTri: giaTri[c.ma] ?? "",
    tien: c.tien,
    ...(nguon[c.ma] === undefined ? {} : { nguon: nguon[c.ma] }),
  }));
  return { bidVersionId: id, supplierName: `NCC ${id}`, effectiveCost: kq.effectiveCost, components, maThieu: null };
}

/**
 * Ba báo giá: A giá 100.00 trả đúng kỳ chuẩn, giao đúng hạn; B giá 90.00 trả đúng kỳ, giao trễ 100 ngày (chi phí trễ 9.00); C giá
 * 95.00 trả ngay (60 ngày trước kỳ chuẩn ⇒ chi phí thanh toán 1.87). Hạng tính từ fixture, không gõ tay.
 */
function hangMau(): HangBundle[] {
  const tho = [hangTco("bA", "100.00", "0.00", 60, 14), hangTco("bB", "90.00", "0.00", 60, 114), hangTco("bC", "95.00", "0.00", 0, 14)];
  const xep = xepHangLai(tho.map((h) => h.effectiveCost));
  return tho.map((h, i) => ({ ...h, rank: xep[i] ?? null }));
}

function camKetDung(h: HangBundle, hang: readonly HangBundle[], giaiTrinh: string | null): CamKetDoc {
  const tienGia = (x: HangBundle): string | null => x.components.find((c) => c.ma === "gia")?.tien ?? null;
  const hangGia = hangGiaLai(hang.map((x) => ({ bidVersionId: x.bidVersionId, rank: x.rank, tienGia: tienGia(x) })), h.bidVersionId);
  return {
    hangTco: h.rank ?? 0,
    hangGia,
    effectiveCost: h.effectiveCost ?? "",
    components: h.components,
    khai: {
      freight: h.components.find((c) => c.ma === "van_chuyen")?.giaTri ?? null,
      importCost: null,
      paymentDays: Number(h.components.find((c) => c.ma === "chi_phi_thanh_toan")?.nguon?.["ngayKhai"]),
      leadTimeDays: Number(h.components.find((c) => c.ma === "chi_phi_tre")?.nguon?.["ngayKhai"]),
    },
    tapMa: CS.map((c) => c.ma),
    thamSo: THAM_SO,
    soNgayGiao: SO_NGAY_GIAO,
    giaiTrinhLechHang: giaiTrinh,
    chupLuc: { giaTri: "2026-10-10T01:00:00.000Z", nguon: NGUON },
  };
}

function deXuat(bid: string, camKet: CamKetDoc | null, status = "PROPOSED"): TraoThauBundle {
  return {
    awardId: `aw-${bid}`,
    evaluationId: "ev-1",
    bidVersionId: bid,
    status,
    reason: "de xuat",
    actedAt: { giaTri: "2026-10-10T01:00:00.000Z", nguon: NGUON },
    camKet,
  };
}

function bo(hang: readonly HangBundle[], traoThau: readonly TraoThauBundle[] = [], goiTco?: BoBangChung["goiTco"]): BoBangChung {
  return {
    dang: "trustprocure/bo-bang-chung-danh-gia",
    phienBan: 3,
    dacTaPhienBan: 3,
    dacTaSha256: "khong-doc-o-tang-nay",
    orgId: "org-1",
    rfqId: "rfq-1",
    xuatLuc: { giaTri: "2026-10-10T02:00:00.000Z", nguon: "đồng hồ tiến trình xuất" },
    goiTco: goiTco ?? { tapMa: CS.map((c) => c.ma), thamSo: THAM_SO, soNgayGiao: SO_NGAY_GIAO },
    luotCham: [
      {
        evaluationId: "ev-1",
        policyId: "pol-1",
        policyVersion: 4,
        currency: "VND",
        chinhSachThanhPhan: CS,
        coBenchmark: false,
        taoLuc: { giaTri: "2026-10-10T00:00:00.000Z", nguon: NGUON },
        hang,
      },
    ],
    traoThau,
    duLieuNen: null,
  };
}

/** Thay MỘT trường của MỘT thành phần của MỘT hàng — bundle bị sửa đúng một chỗ. */
function suaThanhPhan(hang: readonly HangBundle[], bid: string, ma: string, sua: (c: ThanhPhanLuu) => ThanhPhanLuu): HangBundle[] {
  return hang.map((h) => (h.bidVersionId !== bid ? h : { ...h, components: h.components.map((c) => (c.ma === ma ? sua(c) : c)) }));
}

describe("[S1.9101 / S4.7c2] lớp độc lập của phép quy đổi — §9.1, §9.2", () => {
  it("[INV-J2] ca tay: 30 ngày sớm × 12 %/năm × 100.00 ÷ 365 = 0.9863… ⇒ 0.99; trễ 100 ngày × 0.001 × 100.00 = 10.00; sớm/đúng hạn ⇒ 0.00", () => {
    expect(chiPhiThanhToanLai("100.00", "30", "60", "0.12")).toBe("0.99");
    expect(chiPhiTreLai("100.00", "110", "10", "0.001")).toBe("10.00");
    expect(chiPhiThanhToanLai("100.00", "90", "60", "0.12"), "trả sau kỳ chuẩn — max(0, …)").toBe("0.00");
    expect(chiPhiTreLai("100.00", "5", "10", "0.001"), "giao sớm — max(0, …)").toBe("0.00");
  });

  it("[INV-J2] đúng MỘT lần làm tròn nửa-ra-xa-0 trên giá trị đúng: 1 × 0.0025 × 730.00 ÷ 365 = 0.005 ⇒ 0.01; 0.004999… ⇒ 0.00", () => {
    expect(chiPhiThanhToanLai("730.00", "0", "1", "0.0025")).toBe("0.01");
    // 1 × 0.0025 × 729.99 ÷ 365 = 0.004999… — đuôi của thương cắt cụt cùng dư, không làm tròn hai lần.
    expect(chiPhiThanhToanLai("729.99", "0", "1", "0.0025")).toBe("0.00");
    expect(chiPhiTreLai("0.50", "1", "0", "0.01")).toBe("0.01");
  });

  it("chia ngắn giữ thêm chữ số lẻ, cắt cụt — không làm tròn", () => {
    const x = docThapPhan("1.00");
    if (x === null) throw new Error("fixture");
    expect(vietThapPhan(chiaNgan(x, 3, 2))).toBe("0.3333");
  });

  it("đầu vào không đọc được ⇒ null (kết luận, không ném)", () => {
    expect(chiPhiThanhToanLai("-1.00", "0", "60", "0.12")).toBeNull();
    expect(chiPhiThanhToanLai("100.00", "1.5", "60", "0.12")).toBeNull();
    expect(chiPhiTreLai("100.00", "10", "abc", "0.001")).toBeNull();
  });

  it("[INV-J2] 20 000 bộ ngẫu nhiên: lớp độc lập (mảng chữ số, chia ngắn) bằng lớp hàm thuần (bigint) ở cả hai mã", () => {
    let hat = 7;
    const ngau = (n: number): number => {
      hat = (hat * 1103515245 + 12345) % 2 ** 31;
      return hat % n;
    };
    for (let i = 0; i < 20_000; i += 1) {
      const coSo = `${String(ngau(10_000_000))}.${String(ngau(100)).padStart(2, "0")}`;
      const tyLeNam = `0.${String(ngau(10_000)).padStart(4, "0")}`;
      const tyLeNgay = `0.${String(ngau(1_000_000)).padStart(6, "0")}`;
      const a = ngau(400);
      const b = ngau(400);
      expect(chiPhiThanhToanLai(coSo, String(a), String(b), tyLeNam), `${coSo} ${String(a)} ${String(b)} ${tyLeNam}`).toBe(
        chiPhiThanhToan(coSo, b, a, tyLeNam),
      );
      expect(chiPhiTreLai(coSo, String(a), String(b), tyLeNgay), `${coSo} ${String(a)} ${String(b)} ${tyLeNgay}`).toBe(
        chiPhiTre(coSo, b, a, tyLeNgay),
      );
    }
  });
});

describe("[S1.9101 / S4.7c2] bộ kiểm trên bundle TCO — §9", () => {
  it("[INV-J2] bundle lành lặn ĐẠT; sáu thành phần quy đổi được tính lại", () => {
    const kq = kiemBo(bo(hangMau()), DAC_TA);
    expect(kq.loiBo).toEqual([]);
    expect(kq.hang.flatMap((h) => h.noi)).toEqual([]);
    expect(kq).toMatchObject({ dat: true, soHang: 3, soDat: 3, soQuyDoi: 6 });
  });

  it("[INV-J2] `giaTri` quy đổi bị sửa (cộng một xu) ⇒ LỆCH ở cả hai lớp, gọi tên mã — dù phép cộng §3 vẫn khớp", () => {
    const h = suaThanhPhan(hangMau(), "bB", "chi_phi_tre", (c) => ({ ...c, giaTri: "9.01", tien: "9.01" }));
    // Sửa luôn tổng để §3 khớp: chỗ duy nhất sai là phép quy đổi.
    const hh = h.map((x) => (x.bidVersionId === "bB" ? { ...x, effectiveCost: "99.01" } : x));
    const kq = kiemBo(bo(hh), DAC_TA);
    expect(kq.dat).toBe(false);
    const noi = kq.hang.find((x) => x.bidVersionId === "bB")?.noi ?? [];
    expect(noi.join("\n")).toMatch(/lớp độc lập: giaTri của thành phần "chi_phi_tre" đã lưu 9\.01, tính lại ra 9\.00/u);
    expect(noi.join("\n")).toMatch(/lớp hàm thuần: giaTri của thành phần "chi_phi_tre"/u);
  });

  it("[INV-J2] `nguon` lệch thước của gói — tỷ lệ, ngày chuẩn, ngày yêu cầu, cơ sở — mỗi chỗ một câu gọi tên bước của §9.3", () => {
    const ca: readonly [string, (c: ThanhPhanLuu) => ThanhPhanLuu, RegExp][] = [
      ["chi_phi_thanh_toan", (c) => ({ ...c, nguon: { ...c.nguon, tyLe: "0.10" } }), /nguon\.tyLe 0\.10 khác goiTco\.thamSo\.chi_phi_von_nam/u],
      ["chi_phi_thanh_toan", (c) => ({ ...c, nguon: { ...c.nguon, ngayChuan: "45" } }), /nguon\.ngayChuan 45 khác/u],
      ["chi_phi_tre", (c) => ({ ...c, nguon: { ...c.nguon, ngayYeuCau: "30" } }), /nguon\.ngayYeuCau 30 khác goiTco\.soNgayGiao 14/u],
      ["chi_phi_tre", (c) => ({ ...c, nguon: { ...c.nguon, coSo: "80.00" } }), /nguon\.coSo 80\.00 khác giaTri của "gia" 90\.00/u],
    ];
    for (const [ma, sua, mau] of ca) {
      const kq = kiemBo(bo(suaThanhPhan(hangMau(), "bB", ma, sua)), DAC_TA);
      expect(kq.dat, String(mau)).toBe(false);
      expect((kq.hang.find((x) => x.bidVersionId === "bB")?.noi ?? []).join("\n")).toMatch(mau);
    }
  });

  it("[INV-J2] mã quy đổi mất `nguon`, hay `nguon` sai khoá ⇒ LỆCH (§9.3 bước 1); hàng có số mang `maThieu` ⇒ LỆCH (§9.4)", () => {
    const mat = kiemBo(bo(suaThanhPhan(hangMau(), "bA", "chi_phi_tre", (c) => ({ ma: c.ma, donVi: c.donVi, heSo: c.heSo, giaTri: c.giaTri, tien: c.tien }))), DAC_TA);
    expect(mat.hang.find((x) => x.bidVersionId === "bA")?.noi.join("\n")).toMatch(/không mang `nguon`/u);
    const khoa = kiemBo(
      bo(suaThanhPhan(hangMau(), "bA", "chi_phi_tre", (c) => ({ ...c, nguon: { coSo: "100.00", ngayKhai: "14", tyLe: "0.001" } }))),
      DAC_TA,
    );
    expect(khoa.hang.find((x) => x.bidVersionId === "bA")?.noi.join("\n")).toMatch(/cần đúng khoá coSo,ngayKhai,ngayYeuCau,tyLe/u);
    const thieu = kiemBo(bo(hangMau().map((h) => (h.bidVersionId === "bC" ? { ...h, maThieu: ["chi_phi_tre"] } : h))), DAC_TA);
    expect(thieu.hang.find((x) => x.bidVersionId === "bC")?.noi.join("\n")).toMatch(/mang maThieu \[chi_phi_tre\] \(§9\.4\)/u);
  });

  it("[INV-L16] tập mã của lượt chấm khác `goiTco.tapMa` ⇒ lỗi bundle gọi tên lượt chấm", () => {
    const kq = kiemBo(bo(hangMau(), [], { tapMa: ["gia", "van_chuyen", "chi_phi_tre", "chi_phi_thanh_toan"], thamSo: THAM_SO, soNgayGiao: 14 }), DAC_TA);
    expect(kq.dat).toBe(false);
    expect(kq.loiBo.join("\n")).toMatch(/lượt chấm ev-1: tập mã \[gia, van_chuyen, chi_phi_thanh_toan, chi_phi_tre\] khác goiTco\.tapMa/u);
  });

  it("[INV-J2] lớp hàm thuần cắt cụt chi phí thanh toán của C (1.87 → 1.86) ⇒ HAI LỚP BẤT ĐỒNG", () => {
    const sai: QuyDoiHamThuan = {
      ...QUY_DOI_THAT,
      thanhToan: (coSo, ngayKhai, ngayChuan, tyLe) => {
        const dung = QUY_DOI_THAT.thanhToan(coSo, ngayKhai, ngayChuan, tyLe);
        return dung === "1.87" ? "1.86" : dung;
      },
    };
    const kq = kiemBo(bo(hangMau()), DAC_TA, undefined, undefined, sai);
    expect(kq.dat).toBe(false);
    expect(kq.hang.find((x) => x.bidVersionId === "bC")?.noi.join("\n")).toMatch(
      /HAI LỚP BẤT ĐỒNG: lớp độc lập nói ĐẠT, lớp hàm thuần nói LỆCH/u,
    );
  });
});

describe("[S1.9101 / S4.7c2] cam kết của đề xuất — §10", () => {
  /** Báo giá có hạng chi phí khác hạng giá — đề xuất nó phải có giải trình. */
  function lech(): { hang: HangBundle[]; bid: string } {
    const hang = hangMau();
    const tienGia = (x: HangBundle): string | null => x.components.find((c) => c.ma === "gia")?.tien ?? null;
    const bid = hang.find(
      (h) => hangGiaLai(hang.map((x) => ({ bidVersionId: x.bidVersionId, rank: x.rank, tienGia: tienGia(x) })), h.bidVersionId) !== h.rank,
    )?.bidVersionId;
    if (bid === undefined) throw new Error("fixture: cần một báo giá lệch hạng");
    return { hang, bid };
  }

  it("[INV-L8] cam kết khớp hàng, lệch hạng có giải trình ⇒ ĐẠT; đề xuất cũ không cam kết được ĐẾM, không đỏ", () => {
    const { hang, bid } = lech();
    const h = hang.find((x) => x.bidVersionId === bid) as HangBundle;
    const kq = kiemBo(bo(hang, [deXuat(bid, camKetDung(h, hang, "chon theo chi phi")), deXuat("bA", null)]), DAC_TA);
    expect(kq.camKet.loi).toEqual([]);
    expect(kq.camKet).toMatchObject({ soCamKet: 1, soDat: 1, soDeXuatKhongCamKet: 1 });
    expect(kq.dat).toBe(true);
  });

  it("[INV-L8] luật giải trình hai chiều: lệch hạng mà KHÔNG giải trình ⇒ ĐỎ; không lệch mà CÓ giải trình ⇒ ĐỎ", () => {
    const { hang, bid } = lech();
    const h = hang.find((x) => x.bidVersionId === bid) as HangBundle;
    const thieu = kiemBo(bo(hang, [deXuat(bid, camKetDung(h, hang, null))]), DAC_TA);
    expect(thieu.dat).toBe(false);
    expect(thieu.camKet.loi.join("\n")).toMatch(/mà KHÔNG có giải trình \(§10 bước 5\)/u);
    const khongLech = hang.find((x) => x.bidVersionId !== bid && camKetDung(x, hang, null).hangGia === x.rank) as HangBundle;
    const thua = kiemBo(bo(hang, [deXuat(khongLech.bidVersionId, camKetDung(khongLech, hang, "khong can"))]), DAC_TA);
    expect(thua.camKet.loi.join("\n")).toMatch(/mà có giải trình \(§10 bước 5\)/u);
  });

  it("[INV-L8] cam kết bị sửa đúng một chỗ ⇒ ĐỎ gọi tên trường: hạng chi phí, chi phí, thành phần, tham số, số ngày giao, lời khai, hạng giá", () => {
    const { hang, bid } = lech();
    const h = hang.find((x) => x.bidVersionId === bid) as HangBundle;
    const goc = camKetDung(h, hang, "chon theo chi phi");
    const ca: readonly [Partial<CamKetDoc>, RegExp][] = [
      [{ hangTco: (h.rank ?? 0) + 1 }, /hangTco \d+ khác hạng của hàng/u],
      [{ effectiveCost: "1.00" }, /effectiveCost 1\.00 khác của hàng/u],
      [{ components: h.components.slice(1) }, /components khác components của hàng/u],
      [{ thamSo: { ...THAM_SO, ty_le_tre_ngay: "0.002" } }, /thamSo khác goiTco\.thamSo/u],
      [{ soNgayGiao: 20 }, /soNgayGiao 20 khác goiTco\.soNgayGiao 14/u],
      [{ khai: { ...goc.khai, leadTimeDays: 1 } }, /khai\.leadTimeDays 1 khác nguon\.ngayKhai của "chi_phi_tre"/u],
      [{ khai: { ...goc.khai, freight: "7.00" } }, /khai\.freight 7\.00 khác giaTri của "van_chuyen"/u],
      [{ hangGia: (goc.hangGia ?? 0) + 1 }, /lớp độc lập: hangGia của cam kết/u],
    ];
    for (const [sua, mau] of ca) {
      const kq = kiemBo(bo(hang, [deXuat(bid, { ...goc, ...sua })]), DAC_TA);
      expect(kq.dat, String(mau)).toBe(false);
      expect(kq.camKet.loi.join("\n")).toMatch(mau);
    }
  });

  it("[INV-L8] hàng trao thầu không phải PROPOSED mà mang cam kết ⇒ ĐỎ", () => {
    const hang = hangMau();
    const h = hang[0] as HangBundle;
    const kq = kiemBo(bo(hang, [deXuat(h.bidVersionId, camKetDung(h, hang, null), "APPROVED")]), DAC_TA);
    expect(kq.camKet.loi.join("\n")).toMatch(/ở trạng thái APPROVED mà mang cam kết/u);
  });
});
