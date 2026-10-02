// ==============================================================================================
// [S1.9101 / S4.5c1] BENCHMARK HIỆN ĐÚNG Ở NHỮNG TRẠNG THÁI BẢNG SO SÁNH MỞ — VÀ HAI TẬP ẤY KHOÁ NHAU Ở ĐÂY (L6; ADR-9201)
//
// Chủ dự án chốt 2026-10-01: ở `BAFO_OPEN`/`BAFO_CLOSED` benchmark ĐÓNG, như route bảng so sánh. `docBenchmark` không import được
// `COMPARISON_ALLOWED_STATUSES` (`packages/danh-gia` không phụ thuộc `packages/unseal`), nên tập của nó là một bản CHÉP. Một bản chép
// không đối chiếu thì trôi (ADR-029): mở bảng so sánh ở trạng thái mới mà quên benchmark, hay ngược lại, thì đỏ ở đây.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { TRANG_THAI_BENCHMARK_HIEN, TRANG_THAI_VONG_CHAO_LAI } from "@trustprocure/danh-gia";
import { RFQ_STATUSES } from "@trustprocure/rfq";
import { COMPARISON_ALLOWED_STATUSES } from "@trustprocure/unseal";

describe("[INV-L6] [S1.9101 / S4.5c1] benchmark hiện đúng ở các trạng thái bảng so sánh mở", () => {
  it("tập trạng thái benchmark hiện = tập trạng thái bảng so sánh mở", () => {
    expect([...TRANG_THAI_BENCHMARK_HIEN].sort()).toEqual([...COMPARISON_ALLOWED_STATUSES].sort());
  });

  it("hai trạng thái vòng chào lại là trạng thái THẬT của gói và nằm NGOÀI tập hiện — đối chứng: tập không rỗng", () => {
    expect(TRANG_THAI_VONG_CHAO_LAI.length).toBeGreaterThan(0);
    for (const t of TRANG_THAI_VONG_CHAO_LAI) {
      expect(RFQ_STATUSES).toContain(t);
      expect(TRANG_THAI_BENCHMARK_HIEN as readonly string[]).not.toContain(t);
    }
  });
});
