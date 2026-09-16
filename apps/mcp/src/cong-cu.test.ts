// ==============================================================================================
// CỔNG ĐỐI CHIẾU BẢNG CÔNG CỤ MCP ↔ `ROUTES` CỦA `apps/api`
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO BẢNG CÔNG CỤ KHÔNG IMPORT `ROUTES` Ở ĐƯỜNG CHẠY
// ----------------------------------------------------------------------------------------------
// Cách hiển nhiên là `apps/mcp` import `ROUTES` rồi lọc — một nguồn, không bản sao. Nó SAI ở hai
// chỗ đo được:
//
//   ⑴ `ROUTES` mang HANDLER. Import nó kéo `routes/**` → `@trustprocure/{rfq,supplier,invitation,
//      bidding,identity,unseal}` vào đồ thị phụ thuộc của một tiến trình mà cả thiết kế là để nó
//      KHÔNG chạm nghiệp vụ. "App chỉ nói HTTP" mà lại nạp mọi gói nghiệp vụ là một câu tự phản.
//   ⑵ `tests/architecture/pham-vi-san-xuat.test.ts` vế ⑷ (lượt soi 67a-2) dựa trên *"app là lá,
//      không mã sản xuất nào import nó"* để miễn cả `apps/` khỏi phép đọc. Một app import app
//      khác ở mã SẢN XUẤT làm tiền đề ấy sai — trong im lặng.
//
// Nên bảng công cụ là DỮ LIỆU THUẦN trong `cong-cu.ts`, và tệp này là lớp suy ra: nó đọc `ROUTES`
// (import tương đối xuyên app — đúng chỗ kho cho phép, xem `apps/unseal-worker/src/
// kich-ban-41-http.int.test.ts:32) và đối chiếu HAI CHIỀU. Khuôn giống `evidence/INV-matrix.md`:
// tệp là dữ liệu, cổng là nơi nó không trôi được.
//
// HAI CHIỀU, và cả hai đều phải đỏ được:
//   → thêm một route ĐỌC vào `apps/api` mà quên công cụ ⇒ đỏ (bảng không tự làm mù mình);
//   ← thêm một công cụ trỏ route GHI, route không tồn tại, hay route của khách ⇒ đỏ.
//
// DÒNG QUAN TRỌNG NHẤT CỦA TỆP NÀY là khẳng định `/rfqs/:rfqId/comparison` KHÔNG được phơi. Đó là
// bảng so sánh GIÁ sau mở thầu — thứ toàn bộ sản phẩm sinh ra để bảo vệ. Chủ dự án chọn không phơi
// nó ngày 2026-09-17 (ADR-038). Một lần "tiện tay" thêm nó vào bảng công cụ sẽ làm tệp này đỏ.
// ==============================================================================================

import { describe, expect, it } from "vitest";
// Import TƯƠNG ĐỐI xuyên app, có chủ đích: `@trustprocure/api` không có alias vitest (xem
// `vitest.config.ts`), và `apps/mcp` cố ý KHÔNG khai nó ở `dependencies` — đường chạy của MCP
// không chạm api bằng mã, chỉ bằng HTTP. Test là nơi duy nhất nối hai app.
import { ROUTES } from "../../api/src/routes.js";
import { CONG_CU, ROUTE_DOC_KHONG_PHOI, thamSoCuaDuong } from "./cong-cu.js";

/** Khoá đối chiếu của một route: `GET /rfqs/:rfqId`. Cặp (method, path) là duy nhất — router đòi thế. */
const khoa = (method: string, duong: string): string => `${method} ${duong}`;

/**
 * Route mà MCP ĐƯỢC PHÉP phơi, suy từ tính chất chứ không từ một danh sách tên:
 * người mua ĐỌC (`mutates: false`) hoặc công khai (`/health`). Đường của khách (`GUEST`) và đường
 * vô danh (`ANON`) không có ở đây — chúng mang token trong thân và thuộc về nhà cung cấp.
 */
const ROUTE_DUOC_PHEP = ROUTES.filter(
  (r) => (r.audience === "BUYER" && r.mutates === false) || r.audience === "PUBLIC",
);

describe("bảng công cụ MCP đối chiếu với ROUTES của apps/api", () => {
  it("phép đo không rỗng ruột: `ROUTES` và `CONG_CU` đều có mục", () => {
    // Đối chứng bắt buộc — một `ROUTES` rỗng (import hỏng, đổi tên export) làm MỌI khẳng định
    // dưới đây xanh trong khi không đo gì. Cùng lớp lỗi với `quetTepTs` rỗng ở cong-quyen-route.
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(ROUTE_DUOC_PHEP.length).toBeGreaterThan(0);
    expect(CONG_CU.length).toBeGreaterThan(0);
  });

  it("mọi công cụ là GET — MCP không có đường ghi nào", () => {
    expect(CONG_CU.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("← mọi công cụ trỏ tới một route CÓ THẬT và route ấy là route ĐỌC", () => {
    const duocPhep = new Set(ROUTE_DUOC_PHEP.map((r) => khoa(r.method, r.path)));
    const moiRoute = new Set(ROUTES.map((r) => khoa(r.method, r.path)));

    const khongTonTai = CONG_CU.filter((c) => !moiRoute.has(khoa(c.method, c.path)));
    expect(
      khongTonTai.map((c) => c.ten),
      "Công cụ trỏ tới một route KHÔNG có trong ROUTES — tên đường dẫn đã trôi khỏi apps/api.",
    ).toEqual([]);

    const khongDuocPhep = CONG_CU.filter((c) => !duocPhep.has(khoa(c.method, c.path)));
    expect(
      khongDuocPhep.map((c) => `${c.ten} → ${khoa(c.method, c.path)}`),
      "Công cụ trỏ tới một route ĐỔI TRẠNG THÁI, route của khách, hay route vô danh. MCP chỉ được " +
        "phơi đường ĐỌC của người mua — ADR-038.",
    ).toEqual([]);
  });

  it("→ mọi route đọc hoặc có công cụ, hoặc được khai KHÔNG PHƠI kèm lý do", () => {
    const coCongCu = new Set(CONG_CU.map((c) => khoa(c.method, c.path)));
    const boSot = ROUTE_DUOC_PHEP.filter(
      (r) => !coCongCu.has(khoa(r.method, r.path)) && ROUTE_DOC_KHONG_PHOI[r.path] === undefined,
    );
    expect(
      boSot.map((r) => khoa(r.method, r.path)),
      "apps/api có thêm một route ĐỌC mà bảng công cụ MCP không biết. Thêm công cụ, hoặc khai nó " +
        "vào ROUTE_DOC_KHONG_PHOI kèm lý do — im lặng không phải một lựa chọn.",
    ).toEqual([]);
  });

  it("danh sách KHÔNG PHƠI không tự làm mù mình: mỗi dòng trỏ một route có thật và có lý do", () => {
    const duongDoc = new Set(ROUTE_DUOC_PHEP.map((r) => r.path));
    for (const [duong, lyDo] of Object.entries(ROUTE_DOC_KHONG_PHOI)) {
      expect(
        duongDoc.has(duong),
        `ROUTE_DOC_KHONG_PHOI khai "${duong}" nhưng apps/api không còn route ĐỌC nào như thế — ` +
          "một dòng miễn trừ trỏ vào hư không là một dòng che mất route THẬT cùng tên mai sau.",
      ).toBe(true);
      expect(lyDo.length, `lý do của "${duong}" rỗng`).toBeGreaterThan(20);
    }
  });

  // Ba đường chủ dự án nói KHÔNG — đây là các dòng chịu lực của ADR-038. `it.each` khoá TỪNG
  // đường: một `it` duyệt mảng sẽ xanh khi hai trong ba còn đúng.
  it.each([
    { ten: "bảng so sánh GIÁ", duong: "/rfqs/:rfqId/comparison" },
    { ten: "số hồ sơ thầu đã nhận", duong: "/rfqs/:rfqId/bid-count" },
    { ten: "liên hệ của nhà cung cấp", duong: "/suppliers/:supplierId/contacts" },
  ])("KHÔNG phơi $ten ($duong)", ({ duong }) => {
    // Vế 1: nó vẫn là một route ĐỌC có thật của apps/api. Nếu câu này đỏ, đường dẫn đã đổi tên và
    // khẳng định dưới đây đang canh một cái tên chết — phải đọc lại ROUTES trước khi sửa.
    expect(
      ROUTE_DUOC_PHEP.map((r) => r.path),
      `apps/api không còn route đọc nào tên ${duong} — cập nhật cổng này.`,
    ).toContain(duong);
    // Vế 2: và không công cụ nào chạm tới nó.
    expect(CONG_CU.filter((c) => c.path === duong)).toEqual([]);
    // Vế 3: sự vắng mặt ấy là CÓ CHỦ Ý, có chữ ký trong mã.
    expect(ROUTE_DOC_KHONG_PHOI[duong]).toBeDefined();
  });

  it("cờ `congKhai` KHỚP `audience` của apps/api — không công cụ nào tự nhận là công khai", () => {
    // [lượt soi 69 L-6] Cờ này quyết định cookie phiên CÓ được gửi kèm hay không, nên nó không
    // được là một lời tự khai: nó phải khớp `audience` bên apps/api, đọc từ chính `ROUTES`.
    for (const c of CONG_CU) {
      const route = ROUTES.find((r) => r.method === c.method && r.path === c.path);
      expect(c.congKhai, `${c.ten} khai congKhai=${String(c.congKhai)}`).toBe(
        route?.audience === "PUBLIC",
      );
    }
    // Đối chứng: đúng một công cụ công khai hôm nay, nên vế trên không phải "mọi cái đều false".
    expect(CONG_CU.filter((c) => c.congKhai).map((c) => c.ten)).toEqual(["health"]);
  });

  it("tên công cụ là duy nhất và hợp lệ với MCP", () => {
    const ten = CONG_CU.map((c) => c.ten);
    expect(new Set(ten).size, "hai công cụ trùng tên — máy khách MCP sẽ gọi nhầm").toBe(ten.length);
    expect(ten.filter((t) => !/^[a-z][a-z0-9_]*$/u.test(t))).toEqual([]);
  });

  it("tham số của công cụ SUY từ đường dẫn, không khai tay", () => {
    expect(thamSoCuaDuong("/rfqs/:rfqId/items")).toEqual(["rfqId"]);
    expect(thamSoCuaDuong("/suppliers/:supplierId/contacts")).toEqual(["supplierId"]);
    expect(thamSoCuaDuong("/me")).toEqual([]);
    for (const c of CONG_CU) {
      expect(c.thamSo, `${c.ten} khai tham số khác với đường dẫn của nó`).toEqual(
        thamSoCuaDuong(c.path),
      );
    }
  });
});
