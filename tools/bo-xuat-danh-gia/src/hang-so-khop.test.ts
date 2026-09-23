// ==============================================================================================
// [mảnh 1 / màn xuất bằng chứng] HAI BẢN CỦA BỐN HẰNG SỐ PHẢI BẰNG NHAU
//
// Nửa XUẤT của bundle xuống `packages/danh-gia` để `apps/api` gọi được; nửa KIỂM ở lại `bo.ts` vì
// người kiểm không mượn định nghĩa hình dạng của người bị kiểm. Cái giá: tên dạng, phiên bản và
// hai tên tệp có HAI bản. Tệp này là lớp đối chiếu chúng — không có nó, đổi một bên là một bundle
// mà chính công cụ của dự án từ chối đọc, và không cổng nào nói trước.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import * as xuat from "@trustprocure/danh-gia";
import * as kiem from "./bo.js";

describe("[mảnh 1] hằng số của nửa xuất và nửa kiểm", () => {
  it("bốn hằng số bằng nhau từng chữ", () => {
    expect(xuat.DANG_BUNDLE).toBe(kiem.DANG_BUNDLE);
    expect(xuat.PHIEN_BAN_BUNDLE).toBe(kiem.PHIEN_BAN_BUNDLE);
    expect(xuat.TEP_DU_LIEU).toBe(kiem.TEP_DU_LIEU);
    expect(xuat.TEP_DAC_TA).toBe(kiem.TEP_DAC_TA);
  });
});
