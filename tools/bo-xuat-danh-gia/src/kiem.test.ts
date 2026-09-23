// ===============================================================================================
// [S1.114 / S2.7 / ADR-059 §*Đo bằng gì*] KIỂM BỘ BẰNG CHỨNG — BA MŨI ĐỘT BIẾN, VÀ MŨI THỨ BA LÀ
// LÝ DO ADR-059 TỒN TẠI
//
// ⒜ và ⒝: sửa bundle mà không sửa con số đã lưu ⇒ ĐỎ ở CẢ HAI lớp.
// ⒞: một lỗi làm tròn NẰM TRONG `chiPhiHieuDung` ⇒ lớp gọi hàm thuần nói ĐẠT, chỉ lớp độc lập
//    nói LỆCH. Đây là mệnh đề chịu lực của ADR-059, và nó được ĐO chứ không được khai.
//
// Vì sao ⒞ đo được: `kiemBo` nhận lớp ⑴ làm THAM SỐ. Bundle của bài đo ấy được dựng TỪ đầu ra của
// hàm có lỗi — tức nó là bundle mà một hệ thống mang lỗi ấy sẽ xuất ra — rồi cả hai lớp cùng đọc
// nó. Không có điểm tiêm thì câu *"lỗi tự tái lập chính nó"* chỉ là một câu trong tài liệu.
// ===============================================================================================

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BoBangChung, HangBundle, ThanhPhanLuu } from "./bo.js";
import { DAC_TA } from "./dac-ta.js";
import { HAM_THUAN_THAT, kiemBo, type TinhHamThuan } from "./kiem.js";
import {
  khongTinhDuoc,
  tinhLai,
  vietThapPhan,
  docThapPhan,
  nhan,
  type ThanhPhanChinhSachDoc,
} from "./doc-lap/tinh-lai.js";

const GIA: ThanhPhanChinhSachDoc = { ma: "gia", don_vi: "TIEN", he_so: "1.2345" };

/**
 * Một `chiPhiHieuDung` MANG LỖI LÀM TRÒN: cắt cụt thay vì nửa-ra-xa-0.
 *
 * Đây là mô hình của mũi ⒞. Lỗi được đặt ở ĐÚNG chỗ ADR-059 nói tới — bước làm tròn từng thành
 * phần — và nó là lỗi rẻ nhất để viết nhầm: `Math.trunc` thay cho luật của Postgres, hay một phép
 * chia số nguyên quên cộng nửa.
 */
const HAM_THUAN_CAT_CUT: TinhHamThuan = (chinhSach, dauVao) => {
  const theoMa = new Map(dauVao.map((d) => [d.ma, d.giaTri]));
  let tongXu = 0n;
  const components: { ma: string; donVi: string; tien: string | null }[] = [];
  for (const c of chinhSach) {
    if (c.don_vi === "DIEM") {
      components.push({ ma: c.ma, donVi: c.don_vi, tien: null });
      continue;
    }
    const g = theoMa.get(c.ma);
    if (g === undefined) return { lyDo: "THIEU_DAU_VAO", ma: c.ma };
    // Tích ở tỉ lệ 10^6, rồi CẮT CỤT về 10^2 — không cộng nửa. Đó là cả cái lỗi.
    const xu = (BigInt(g.replace(".", "")) * BigInt(c.he_so.replace(".", ""))) / 10_000n;
    tongXu += xu;
    components.push({ ma: c.ma, donVi: c.don_vi, tien: xuRaChuoi(xu) });
  }
  return { effectiveCost: xuRaChuoi(tongXu), components };
};

function xuRaChuoi(xu: bigint): string {
  const am = xu < 0n;
  const t = am ? -xu : xu;
  return `${am ? "-" : ""}${t / 100n}.${String(t % 100n).padStart(2, "0")}`;
}

function hang(bidVersionId: string, thanhPhan: readonly ThanhPhanLuu[], effectiveCost: string | null, rank: number | null): HangBundle {
  return { bidVersionId, supplierName: `NCC ${bidVersionId}`, effectiveCost, rank, components: thanhPhan };
}

const NGUON = "đồng hồ của cơ sở dữ liệu lúc ghi — nguồn thời gian CHƯA được chứng thực (khoản 196)";

function boVoi(
  hangs: readonly HangBundle[],
  chinhSach: readonly ThanhPhanChinhSachDoc[] = [GIA],
  traoThau: BoBangChung["traoThau"] = [],
): BoBangChung {
  return {
    dang: "trustprocure/bo-bang-chung-danh-gia",
    phienBan: 1,
    dacTaPhienBan: 1,
    dacTaSha256: "khong-doc-o-tang-nay",
    orgId: "org-1",
    rfqId: "rfq-1",
    xuatLuc: { giaTri: "2026-09-23T00:00:00.000Z", nguon: "đồng hồ tiến trình xuất" },
    luotCham: [
      {
        evaluationId: "ev-1",
        policyId: "pol-1",
        policyVersion: 3,
        currency: "VND",
        chinhSachThanhPhan: chinhSach,
        taoLuc: { giaTri: "2026-09-22T00:00:00.000Z", nguon: NGUON },
        hang: hangs,
      },
    ],
    traoThau,
  };
}

/** Dựng một hàng ĐÚNG bằng chính lớp được đo — dùng cho các ca *bundle lành lặn*. */
function hangDung(id: string, giaTri: string, rank: number | null, cs: readonly ThanhPhanChinhSachDoc[] = [GIA]): HangBundle {
  const kq = tinhLai(cs, cs.map((c) => ({ ma: c.ma, giaTri })));
  if (khongTinhDuoc(kq)) throw new Error("fixture sai");
  return hang(
    id,
    kq.components.map((c) => {
      const t = cs.find((x) => x.ma === c.ma);
      return { ma: c.ma, donVi: c.donVi, heSo: t?.he_so, giaTri, tien: c.tien };
    }),
    kq.effectiveCost,
    rank,
  );
}

describe("bundle lành lặn", () => {
  it("[INV-J2] ĐẠT, và đếm đúng số hàng", () => {
    const kq = kiemBo(boVoi([hangDung("b1", "10.00", 1), hangDung("b2", "20.00", 2)]), DAC_TA);
    expect(kq.loiBo).toEqual([]);
    expect(kq).toMatchObject({ dat: true, soHang: 2, soDat: 2, soLech: 0, soKhongTaiLapDuoc: 0 });
  });

  it("hạng của báo giá được trao thầu được BÁO, không bị phán xử", () => {
    // `DAC-TA.md` §7: trao cho hàng hạng 2 KHÔNG phải một lỗi — bên mua có quyền, và bundle chỉ
    // phải làm cho điều đó THẤY ĐƯỢC.
    const kq = kiemBo(
      boVoi(
        [hangDung("b1", "10.00", 1), hangDung("b2", "20.00", 2)],
        [GIA],
        [
          {
            awardId: "aw-1",
            evaluationId: "ev-1",
            bidVersionId: "b2",
            status: "APPROVED",
            reason: "nhà cung cấp hạng 1 rút",
            actedAt: { giaTri: "2026-09-22T01:00:00.000Z", nguon: NGUON },
          },
        ],
      ),
      DAC_TA,
    );
    expect(kq.dat).toBe(true);
    expect(kq.hangTraoThau).toEqual([{ awardId: "aw-1", rank: 2 }]);
  });
});

describe("ADR-059 ⒞ — ba mũi đột biến", () => {
  it("[INV-J2] ⒜ đổi một HỆ SỐ trong bundle mà không đổi `effectiveCost` ⇒ ĐỎ ở CẢ HAI lớp", () => {
    const bo = boVoi([hangDung("b1", "10.00", 1)], [{ ...GIA, he_so: "2.0000" }]);
    const kq = kiemBo(bo, DAC_TA);
    expect(kq.dat).toBe(false);
    expect(kq.soLech).toBe(1);
    const noi = kq.hang[0]?.noi.join("\n") ?? "";
    expect(noi).toContain("lớp độc lập");
    expect(noi).toContain("lớp hàm thuần");
    expect(noi).not.toContain("HAI LỚP BẤT ĐỒNG");
  });

  it("[INV-J2] ⒝ đổi `effectiveCost` đã lưu mà không đổi `components` ⇒ ĐỎ ở CẢ HAI lớp", () => {
    const g = hangDung("b1", "10.00", 1);
    const kq = kiemBo(boVoi([{ ...g, effectiveCost: "99.99" }]), DAC_TA);
    expect(kq.dat).toBe(false);
    const noi = kq.hang[0]?.noi.join("\n") ?? "";
    expect(noi).toContain("lớp độc lập: effectiveCost đã lưu 99.99, tính lại ra 12.35");
    expect(noi).toContain("lớp hàm thuần: effectiveCost đã lưu 99.99, tính lại ra 12.35");
    expect(noi).not.toContain("HAI LỚP BẤT ĐỒNG");
  });

  it("[INV-J2] ⒞ lỗi làm tròn NẰM TRONG `chiPhiHieuDung` ⇒ CHỈ lớp độc lập bắt được", () => {
    // Bundle được dựng từ đầu ra của hàm CÓ LỖI: đây là bundle mà một hệ thống mang lỗi ấy xuất
    // ra. `10.00 × 1.2345 = 12.345000`; nửa-ra-xa-0 cho `12.35`, cắt cụt cho `12.34`.
    const loi = HAM_THUAN_CAT_CUT([GIA], [{ ma: "gia", giaTri: "10.00" }]);
    if (khongTinhDuoc(loi)) throw new Error("fixture sai");
    expect(loi.effectiveCost).toBe("12.34");

    const bo = boVoi([
      hang(
        "b1",
        [{ ma: "gia", donVi: "TIEN", heSo: GIA.he_so, giaTri: "10.00", tien: "12.34" }],
        "12.34",
        1,
      ),
    ]);

    // ① Nếu CHỈ lớp gọi hàm thuần chạy, đột biến này SỐNG — hàm sai tự xác nhận con số sai.
    const chiHamThuan = kiemBo(bo, DAC_TA, HAM_THUAN_CAT_CUT);
    const noi = chiHamThuan.hang[0]?.noi.join("\n") ?? "";
    expect(noi).not.toContain("lớp hàm thuần:");

    // ② Nhưng lớp độc lập nói LỆCH, nên lượt kiểm ĐỎ — và thông điệp gọi tên đúng hình dạng lỗi.
    expect(chiHamThuan.dat).toBe(false);
    expect(noi).toContain("lớp độc lập: effectiveCost đã lưu 12.34, tính lại ra 12.35");
    expect(noi).toContain("hình dạng của một lỗi NẰM TRONG `chiPhiHieuDung`");

    // ③ Đối chứng: với hàm thuần THẬT, cùng bundle ấy đỏ ở cả hai lớp — tức phép đo ở ① đo đúng
    //    thứ nó nói, chứ không đo một bundle vốn dĩ không ai đọc được.
    const thuc = kiemBo(bo, DAC_TA);
    expect(thuc.hang[0]?.noi.join("\n") ?? "").toContain("lớp hàm thuần: effectiveCost đã lưu 12.34");
  });
});

describe("hai lớp phải KHỚP trên mọi đầu vào đọc được", () => {
  // Cùng khuôn `[INV-B4]`: hai bộ đọc độc lập, và thứ được đo là *hai bản có khớp nhau không*.
  // Một lần trôi khỏi nhau ở đây là một lần bộ kiểm sẽ báo "HAI LỚP BẤT ĐỒNG" trên dữ liệu thật.
  it("`tinhLai` và `tinhChiPhiHieuDung` ra CÙNG con số", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999_999_999 }),
        fc.integer({ min: 0, max: 99_999_999 }),
        (xu, heSoTho) => {
          const giaTri = xuRaChuoi(BigInt(xu));
          const he_so = `${String(Math.trunc(heSoTho / 10_000))}.${String(heSoTho % 10_000).padStart(4, "0")}`;
          const cs: ThanhPhanChinhSachDoc[] = [{ ma: "gia", don_vi: "TIEN", he_so }];
          const vao = [{ ma: "gia", giaTri }];
          const a = tinhLai(cs, vao);
          const b = HAM_THUAN_THAT(cs, vao);
          if (khongTinhDuoc(a) || khongTinhDuoc(b)) return khongTinhDuoc(a) && khongTinhDuoc(b);
          return a.effectiveCost === b.effectiveCost;
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("phép nhân của lớp độc lập khớp `bigint` trên bảng ca biên", () => {
    // Đối chứng thứ hai, KHÔNG đi qua `packages/danh-gia`: nhân dài trên mảng chữ số so với phép
    // nhân `bigint` của ngôn ngữ. Nếu cả hai lớp của kho cùng sai theo một lối, ca này vẫn đỏ.
    for (const [a, b] of [
      ["0.00", "0.0000"],
      ["0.01", "0.0001"],
      ["99999999999999.99", "9999.9999"],
      ["-99999999999999.99", "9999.9999"],
    ] as const) {
      const tich = nhan(docThapPhan(a)!, docThapPhan(b)!);
      const cho = BigInt(a.replace(".", "").replace("-", "")) * BigInt(b.replace(".", ""));
      const dau = a.startsWith("-") && cho !== 0n ? "-" : "";
      expect(vietThapPhan(tich).replace(".", "").replace(/^-?0+(?=\d)/u, "").replace("-", "")).toBe(
        String(cho).replace(/^0+(?=\d)/u, ""),
      );
      expect(vietThapPhan(tich).startsWith("-")).toBe(dau === "-");
    }
  });
});

describe("lối từ chối ở mức bundle", () => {
  it("đặc tả đi kèm KHÁC ⇒ kết luận không áp cho bundle ấy", () => {
    const kq = kiemBo(boVoi([hangDung("b1", "10.00", 1)]), `${DAC_TA}\nmột dòng thêm vào`);
    expect(kq.dat).toBe(false);
    expect(kq.loiBo.join("\n")).toContain("đi kèm KHÁC đặc tả bộ kiểm này cài");
  });

  it("hàng thiếu `giaTri` ⇒ KHÔNG TÁI LẬP ĐƯỢC, đếm riêng, không lẫn vào ĐẠT", () => {
    const kq = kiemBo(
      boVoi([hangDung("b1", "10.00", 1), hang("b2", [{ ma: "gia", tien: "24.69" }], "24.69", 2)]),
      DAC_TA,
    );
    expect(kq).toMatchObject({ soHang: 2, soDat: 1, soLech: 0, soKhongTaiLapDuoc: 1 });
    expect(kq.hang[1]?.noi.join("")).toContain("`057` không cưỡng chế trường ấy");
    // Một hàng không tái lập được KHÔNG làm cả bundle đỏ; nó chỉ không được đếm là ĐẠT.
    expect(kq.dat).toBe(true);
  });

  it("KHÔNG hàng nào tái lập được ⇒ KHÔNG ĐẠT — `every()` trên mảng rỗng in ✓", () => {
    const kq = kiemBo(boVoi([hang("b1", [{ ma: "gia", tien: "24.69" }], "24.69", 1)]), DAC_TA);
    expect(kq.dat).toBe(false);
    expect(kq.loiBo.join("\n")).toContain("KHÔNG một hàng nào tái lập được");
  });

  it("hạng đã lưu KHÁC hạng tính lại ⇒ ĐỎ ở mức bundle", () => {
    const g = hangDung("b1", "10.00", 1);
    const h = hangDung("b2", "20.00", 2);
    const kq = kiemBo(boVoi([g, { ...h, rank: 1 }]), DAC_TA);
    expect(kq.dat).toBe(false);
    expect(kq.loiBo.join("\n")).toContain("đã lưu hạng 1, tính lại ra 2");
  });

  it("trao thầu trỏ một lượt chấm KHÔNG có trong bundle ⇒ ĐỎ", () => {
    const kq = kiemBo(
      boVoi(
        [hangDung("b1", "10.00", 1)],
        [GIA],
        [
          {
            awardId: "aw-1",
            evaluationId: "ev-KHONG-CO",
            bidVersionId: "b1",
            status: "APPROVED",
            reason: "r",
            actedAt: { giaTri: "2026-09-22T01:00:00.000Z", nguon: NGUON },
          },
        ],
      ),
      DAC_TA,
    );
    expect(kq.dat).toBe(false);
    expect(kq.loiBo.join("\n")).toContain("KHÔNG có trong bundle");
  });

  it("trao thầu trỏ một báo giá không có trong bảng xếp hạng ⇒ ĐỎ", () => {
    const kq = kiemBo(
      boVoi(
        [hangDung("b1", "10.00", 1)],
        [GIA],
        [
          {
            awardId: "aw-1",
            evaluationId: "ev-1",
            bidVersionId: "b-LA",
            status: "APPROVED",
            reason: "r",
            actedAt: { giaTri: "2026-09-22T01:00:00.000Z", nguon: NGUON },
          },
        ],
      ),
      DAC_TA,
    );
    expect(kq.dat).toBe(false);
    expect(kq.loiBo.join("\n")).toContain("không có trong bảng xếp hạng");
  });

  it("hàng mang một thành phần chính sách KHÔNG khai ⇒ ĐỎ", () => {
    const g = hangDung("b1", "10.00", 1);
    const kq = kiemBo(
      boVoi([
        { ...g, components: [...g.components, { ma: "la", giaTri: "1.00", tien: "1.00" }] },
      ]),
      DAC_TA,
    );
    expect(kq.dat).toBe(false);
    expect(kq.hang[0]?.noi.join("\n")).toContain("DAU_VAO_THUA");
  });
});
