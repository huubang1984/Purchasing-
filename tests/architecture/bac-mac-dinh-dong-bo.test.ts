// ==============================================================================================
// [S1.174 / S3.1d] MẶC ĐỊNH §4.1 CỦA SPEC S3 Ở HAI CHỖ CHÉP — VÀ HAI CHỖ ẤY KHOÁ NHAU Ở ĐÂY
//
// `apps/web/src/chinh-sach.ts` (`BAC_MAC_DINH`) là mẫu điền sẵn của màn `/chinh-sach`; `tools/gieo-demo/src/chinh-sach-demo.ts`
// (`BAC_DEMO`) là ma trận `pnpm gieo:demo --s3` khai. Công cụ không import được app (app là lá — `pham-vi-san-xuat.test.ts`),
// và màn không import được gói ngoài các mô-đun nó phục vụ, nên hai bản là hai tệp. Cùng khuôn khoá bản chép của
// `packages/rfq/src/tien-te-dong-bo.test.ts`: một bản chép không được đối chiếu thì trôi (ADR-029).
// ==============================================================================================

import { describe, expect, it } from "vitest";
import {
  BAC_MAC_DINH,
  BAFO_TOP_N_MAC_DINH,
  BENCHMARK_MAC_DINH,
  MUC_MAC_DINH,
  NGUONG_KEP_MAC_DINH,
  MAU_CHI_PHI_VON,
  MAU_NGAY_THANH_TOAN,
  MAU_TY_LE_TRE,
  MA_TCO,
  TRONG_SO_MAC_DINH,
  loiTrongSo,
  thanhPhanTuMa,
  trongSoChamDuoc,
  type NhomTco,
  type ThanhPhanTrongSo,
} from "../../apps/web/src/chinh-sach.js";
import { MA_CO_NGUON, MA_THANH_PHAN_GIA, docNhomTco, kiemChinhSachTco } from "@trustprocure/danh-gia";
import { NHOM_BENCHMARK_MAU, docNhomBenchmark } from "@trustprocure/du-lieu-nen";
import { BAC_DEMO, BAFO_TOP_N_DEMO, MUC_DEMO, TRONG_SO_DEMO } from "../../tools/gieo-demo/src/chinh-sach-demo.js";

describe("[S1.174 / S3.1d] mặc định §4.1 — màn /chinh-sach và gieo:demo --s3 khai CÙNG một chính sách", () => {
  it("ma trận bậc trùng từng ô, và hai cột mức cùng ngưỡng kép trùng nhau", () => {
    expect(BAC_DEMO).toEqual(BAC_MAC_DINH);
    expect([MUC_DEMO.chiaNhoCuaSoNgay, MUC_DEMO.thamDinhHieuLucThang, MUC_DEMO.nguongKep]).toEqual([
      MUC_MAC_DINH.chiaNhoCuaSoNgay,
      MUC_MAC_DINH.thamDinhHieuLucThang,
      NGUONG_KEP_MAC_DINH,
    ]);
  });

  it("chống rỗng ruột: bốn bậc, bậc cuối là đấu thầu chính thức — so hai mảng rỗng thì cũng bằng nhau", () => {
    expect(BAC_DEMO.map((b) => [b.tu_so_tien, b.dau_thau_chinh_thuc])).toEqual([
      [0, false],
      [100000000, false],
      [1000000000, false],
      [10000000000, true],
    ]);
  });

  // [S1.256 / S4.5b] Nhóm khoá `benchmark` (spec S4 §4.1): mẫu của màn là bản chép của mẫu ở gói — `gieo:demo` import thẳng bản ở
  // gói, nên hai bản là đủ. Và mẫu phải đọc được bởi chính bộ đọc của lượt chấm: một mẫu mà `docNhomBenchmark` từ chối là mẫu hỏng.
  it("[S1.256 / S4.5b] mẫu nhóm khoá `benchmark` của màn trùng mẫu của gói, và bộ đọc của lượt chấm nhận nó", () => {
    expect(BENCHMARK_MAC_DINH).toEqual(NHOM_BENCHMARK_MAU);
    expect(docNhomBenchmark(BENCHMARK_MAC_DINH)).not.toBeNull();
  });

  // [S1.258 / khoản 329] Trọng số chấm: mẫu của màn trùng mẫu `gieo:demo` khai (mà kịch bản 41 và lượt diễn tập chấm được), và
  // phép kiểm vế hẹp của màn neo vào mã thành phần của chính lượt chấm — đổi mã ở `luot-danh-gia.ts` mà quên màn thì đỏ ở đây.
  it("[S1.258 / khoản 329] mẫu trọng số và BAFO top-N của màn trùng gieo:demo, và vế hẹp của màn dùng đúng mã của lượt chấm", () => {
    expect(TRONG_SO_MAC_DINH).toEqual(TRONG_SO_DEMO);
    expect(BAFO_TOP_N_MAC_DINH).toBe(BAFO_TOP_N_DEMO);
    expect(TRONG_SO_MAC_DINH.map((t) => [t.ma, t.don_vi])).toEqual([[MA_THANH_PHAN_GIA, "TIEN"]]);
    expect(trongSoChamDuoc([{ ma: MA_THANH_PHAN_GIA, don_vi: "TIEN", he_so: "1" }])).toBe(true);
    expect(trongSoChamDuoc([{ ma: `${MA_THANH_PHAN_GIA}_khac`, don_vi: "TIEN", he_so: "1" }])).toBe(false);
  });
});

// [S1.284 / S4.7b1] Màn `/chinh-sach` chép luật L8 của lượt chấm (`kiemChinhSachTco`, S4.7a) — trừ vế số ngày giao, là của gói. Hai
// bản phải ra CÙNG phán quyết và CÙNG câu trên mọi ca: một bản chép không được đối chiếu thì trôi (ADR-029), và màn sẽ im trước một
// phiên bản mà lượt chấm từ chối — đúng kiểm soát giả §2.5 ㉒ muốn nói ra.
describe("[S1.284 / S4.7b1] [INV-L8] luật L8 của màn /chinh-sach là bản chép của lượt chấm", () => {
  const g = (ma: string, don_vi = "TIEN", he_so = "1.0000"): ThanhPhanTrongSo => ({ ma, don_vi, he_so });
  const CA: readonly (readonly [string, readonly ThanhPhanTrongSo[], NhomTco | null])[] = [
    ["mẫu", TRONG_SO_MAC_DINH, null],
    ["năm mã đủ tham số", thanhPhanTuMa(MA_CO_NGUON), { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "60", ty_le_tre_ngay: "0.001" }],
    ["năm mã thiếu tham số", thanhPhanTuMa(MA_CO_NGUON), null],
    ["thanh toán thiếu kỳ", thanhPhanTuMa(["chi_phi_thanh_toan"]), { chi_phi_von_nam: "0.12" }],
    ["trễ thiếu tỉ lệ", thanhPhanTuMa(["chi_phi_tre"]), { chi_phi_von_nam: "0.12", ngay_thanh_toan_chuan: "60" }],
    ["điểm", [g("gia"), g("ky_thuat", "DIEM", "0.5")], null],
    ["chất lượng", [g("gia"), g("chat_luong")], null],
    ["thuế", [g("gia"), g("thue")], null],
    ["mã lạ", [g("gia"), g("bao_hanh")], null],
    ["constructor", [g("gia"), g("constructor")], null],
    ["trùng", [g("gia"), g("gia")], null],
    ["thiếu giá", [g("van_chuyen")], null],
    ["rỗng", [], null],
    ["hệ số 1 viết ngắn", [g("gia", "TIEN", "1")], null],
    ["hệ số 1.0", [g("gia", "TIEN", "1.0")], null],
    ["hệ số 2.5", [g("gia", "TIEN", "2.5")], null],
    ["hệ số năm chữ số lẻ", [g("gia", "TIEN", "1.00000")], null],
    ["hệ số âm", [g("gia", "TIEN", "-1")], null],
  ];
  it.each(CA)("%s", (_ten, tp, tco) => {
    const mayChu = kiemChinhSachTco(
      tp.map((t) => ({ ma: t.ma, donVi: t.don_vi as "TIEN" | "DIEM", heSo: t.he_so })),
      docNhomTco(tco),
      30,
    );
    expect(loiTrongSo(tp, tco)).toBe(mayChu === null ? null : mayChu.cau);
    expect(trongSoChamDuoc(tp, tco)).toBe(mayChu === null);
  });

  it("tập mã của màn là tập mã có nguồn của lượt chấm, cùng thứ tự", () => {
    expect(MA_TCO.map((m) => m.ma)).toEqual([...MA_CO_NGUON]);
  });
});

// [rà soát §S1.284 — THẤP-2] Miền ba tham số của màn là bản chép của `CHECK` `org_procurement_policies_tco_hinh_dang`: mỗi mẫu có mặt
// NGUYÊN VĂN trong `112_tco.sql`, đúng khoá của nó. Đổi mẫu ở một bên thì đỏ ở đây.
describe("[S1.284 / S4.7b1] miền tham số TCO của màn là bản chép của CHECK `112`", () => {
  it("ba mẫu like_regex có mặt nguyên văn, mỗi mẫu ở đúng khoá", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../db/migrations/112_tco.sql", import.meta.url), "utf8");
    for (const [khoa, mau] of [
      ["chi_phi_von_nam", MAU_CHI_PHI_VON],
      ["ngay_thanh_toan_chuan", MAU_NGAY_THANH_TOAN],
      ["ty_le_tre_ngay", MAU_TY_LE_TRE],
    ] as const) {
      expect(sql).toContain(`'$.${khoa} ? (!(@ like_regex "${mau}")`);
    }
  });
});

