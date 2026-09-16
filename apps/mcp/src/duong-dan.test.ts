// ==============================================================================================
// THAM SỐ CỦA MỘT CÔNG CỤ MCP LÀ ĐẦU VÀO CỦA NGƯỜI LẠ — VÀ ĐÂY LÀ CHỖ ĐIỀU ĐÓ ĐƯỢC ĐO
//
// Bề mặt MCP chỉ có route ĐỌC (ADR-038), nhưng lời khai ấy chỉ đúng nếu đường dẫn gửi đi ĐÚNG là
// mẫu đã khai. Một tham số mang `/` biến `get_rfq` thành một công cụ đọc BẤT KỲ đường nào:
//
//   get_rfq(rfqId = "abc/comparison")            → GET /rfqs/abc/comparison   ← bảng so sánh GIÁ
//   get_rfq(rfqId = "../unseal/xyz")             → GET /unseal/xyz
//   get_supplier(supplierId = "x?foo=bar")       → query string do người lạ viết
//
// Tức toàn bộ ADR-038 treo vào hàm trong `duong-dan.ts`, không treo vào bảng công cụ. `encodeURI
// Component` là lời giải HIỀN: nó làm `/` thành `%2F` và đường dẫn vẫn hợp lệ. Ở đây chọn FAIL-
// CLOSED thay vì mã hoá — một `rfqId` có dấu gạch chéo KHÔNG phải một id người dùng gõ nhầm, nó
// là một lần thử, và một lần thử phải ồn ào chứ không được đi tiếp dưới dạng đã khử độc.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { CONG_CU } from "./cong-cu.js";
import { dungDuongDan, ThamSoError } from "./duong-dan.js";

const congCu = (ten: string) => {
  const c = CONG_CU.find((x) => x.ten === ten);
  if (c === undefined) throw new Error(`không có công cụ "${ten}" — test đang canh một tên chết`);
  return c;
};

describe("dựng đường dẫn từ công cụ và tham số", () => {
  it("công cụ không tham số trả đúng mẫu", () => {
    expect(dungDuongDan(congCu("me"), {})).toBe("/me");
    expect(dungDuongDan(congCu("health"), {})).toBe("/health");
  });

  it("thay đúng chỗ, giữ nguyên phần còn lại", () => {
    const id = "0b5f2f1e-1c3a-4a9d-9f0e-2c7d5a1b3e44";
    expect(dungDuongDan(congCu("get_rfq"), { rfqId: id })).toBe(`/rfqs/${id}`);
    expect(dungDuongDan(congCu("list_rfq_items"), { rfqId: id })).toBe(`/rfqs/${id}/items`);
    expect(dungDuongDan(congCu("get_supplier"), { supplierId: id })).toBe(`/suppliers/${id}`);
  });

  // ============================================================================================
  // CA CHẶN — mỗi ca là một đường đi tới `/rfqs/:rfqId/comparison` hay ra ngoài mẫu đã khai.
  // ============================================================================================
  it.each([
    { ten: "dấu gạch chéo — nhảy sang route khác", gt: "abc/comparison" },
    { ten: "đi lên — ../", gt: "../unseal/xyz" },
    { ten: "chỉ hai chấm", gt: ".." },
    { ten: "query string", gt: "x?foo=bar" },
    { ten: "fragment", gt: "x#frag" },
    { ten: "phần trăm đã mã hoá sẵn", gt: "abc%2Fcomparison" },
    { ten: "gạch chéo ngược", gt: "abc\\comparison" },
    { ten: "khoảng trắng", gt: "abc def" },
    { ten: "xuống dòng — chèn header", gt: "abc\nHost: evil" },
    // Ký tự NUL được DỰNG lúc chạy, không viết thô vào nguồn: một byte NUL trong tệp làm Git
    // gọi cả tệp là NHỊ PHÂN, và hai cổng (`tep-van-ban-git`, `xuong-dong-ts`) đo đúng điều đó.
    // Cùng lớp lỗi đã ghi ở `.gitattributes` — `apps/unseal-worker/src/index.ts` từng mang một.
    { ten: "byte NUL", gt: `abc${String.fromCharCode(0)}` },
    { ten: "rỗng", gt: "" },
    { ten: "quá dài", gt: "a".repeat(65) },
    { ten: "không phải chuỗi — số", gt: 42 },
    { ten: "không phải chuỗi — object", gt: { toString: () => "abc" } },
    { ten: "không phải chuỗi — null", gt: null },
  ])("từ chối tham số: $ten", ({ gt }) => {
    expect(() => dungDuongDan(congCu("get_rfq"), { rfqId: gt })).toThrow(ThamSoError);
  });

  it("thiếu tham số thì ném, không dựng một đường dẫn có `:rfqId` trong đó", () => {
    expect(() => dungDuongDan(congCu("get_rfq"), {})).toThrow(ThamSoError);
  });

  it("tham số LẠ thì ném — im lặng bỏ qua là im lặng chấp nhận một lời gọi không hiểu", () => {
    const id = "0b5f2f1e-1c3a-4a9d-9f0e-2c7d5a1b3e44";
    expect(() => dungDuongDan(congCu("get_rfq"), { rfqId: id, lung: "tung" })).toThrow(ThamSoError);
  });

  it("thông điệp lỗi nêu TÊN tham số, KHÔNG nêu giá trị", () => {
    // Cùng quy tắc ⑵ của `apps/api/src/cau-hinh.ts`: lỗi đi thẳng ra log và ra máy khách MCP.
    // Một id không phải bí mật, nhưng thói quen "in giá trị vào lỗi" là thứ sẽ in cả token ở
    // dòng tiếp theo của người sửa sau.
    const doc = "abc/comparison";
    try {
      dungDuongDan(congCu("get_rfq"), { rfqId: doc });
      expect.unreachable("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(ThamSoError);
      expect((e as Error).message).toContain("rfqId");
      expect((e as Error).message).not.toContain(doc);
    }
  });

  it("MỌI công cụ đều đi qua cùng lớp chặn — không công cụ nào có đường riêng", () => {
    // Phép đo theo TÍNH CHẤT: duyệt cả bảng, không liệt kê tên. Một công cụ mới có tham số mà
    // quên lớp chặn sẽ làm câu này đỏ mà không ai phải nhớ thêm nó vào đâu.
    for (const c of CONG_CU) {
      if (c.thamSo.length === 0) continue;
      const doc = Object.fromEntries(c.thamSo.map((t) => [t, "abc/comparison"]));
      expect(() => dungDuongDan(c, doc), `${c.ten} không chặn tham số mang dấu gạch chéo`).toThrow(
        ThamSoError,
      );
    }
  });
});
