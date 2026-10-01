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
  TRONG_SO_MAC_DINH,
  trongSoChamDuoc,
} from "../../apps/web/src/chinh-sach.js";
import { MA_THANH_PHAN_GIA } from "@trustprocure/danh-gia";
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

  // [S1.9101 / khoản 329] Trọng số chấm: mẫu của màn trùng mẫu `gieo:demo` khai (mà kịch bản 41 và lượt diễn tập chấm được), và
  // phép kiểm vế hẹp của màn neo vào mã thành phần của chính lượt chấm — đổi mã ở `luot-danh-gia.ts` mà quên màn thì đỏ ở đây.
  it("[S1.9101 / khoản 329] mẫu trọng số và BAFO top-N của màn trùng gieo:demo, và vế hẹp của màn dùng đúng mã của lượt chấm", () => {
    expect(TRONG_SO_MAC_DINH).toEqual(TRONG_SO_DEMO);
    expect(BAFO_TOP_N_MAC_DINH).toBe(BAFO_TOP_N_DEMO);
    expect(TRONG_SO_MAC_DINH.map((t) => [t.ma, t.don_vi])).toEqual([[MA_THANH_PHAN_GIA, "TIEN"]]);
    expect(trongSoChamDuoc([{ ma: MA_THANH_PHAN_GIA, don_vi: "TIEN", he_so: "1" }])).toBe(true);
    expect(trongSoChamDuoc([{ ma: `${MA_THANH_PHAN_GIA}_khac`, don_vi: "TIEN", he_so: "1" }])).toBe(false);
  });
});
