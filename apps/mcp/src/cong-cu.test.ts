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
import { agentGoiDuoc } from "../../api/src/route-types.js";
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

  // ============================================================================================
  // [khoản 141 / ADR-039] HAI BẢNG, MỘT SỰ THẬT — và đây là chỗ chúng không trôi khỏi nhau được.
  //
  // Từ S1.75, `apps/api` tự biết route nào một phiên agent gọi được: trường `agent` trên
  // `BuyerReadRoute`/`BuyerSelfRoute`, đọc qua vị từ `agentGoiDuoc`. Bảng công cụ MCP là một lời
  // khai ĐỘC LẬP về cùng câu hỏi ấy. Hai lời khai độc lập về cùng một sự thật là đúng hình dạng
  // trôi mà kho này đã bắt ba lần — nên chúng bị buộc vào nhau ở đây, theo CẢ HAI chiều:
  //   → `apps/api` mở một route đọc cho agent mà MCP không có công cụ ⇒ đỏ;
  //   ← MCP có công cụ mà `apps/api` không cho phiên agent gọi ⇒ đỏ (công cụ ấy sẽ luôn 403).
  // ============================================================================================
  it("→← tập route agent đọc được KHỚP tập công cụ CẦN PHIÊN của MCP", () => {
    // So đúng nhóm: `agentGoiDuoc` chỉ phán về route NGƯỜI MUA, vì chỉ nhánh BUYER của bộ điều
    // phối mới đọc cookie phiên. Route PUBLIC (`/health`) không nhận chứng chỉ nào, nên nó nằm
    // ngoài phép so này và được canh bởi khẳng định `congKhai` ở trên. Lần chạy đầu của cổng này
    // đỏ vì gộp hai nhóm — giữ lại ghi chú vì đó là lằn ranh dễ lẫn nhất của cả vòng.
    const duongAgentDoc = ROUTES.filter((r) => agentGoiDuoc(r) && r.method === "GET")
      .map((r) => r.path)
      .sort();
    const congCuCanPhien = CONG_CU.filter((c) => !c.congKhai)
      .map((c) => c.path)
      .sort();
    expect(
      congCuCanPhien,
      "bảng công cụ MCP và vị từ `agentGoiDuoc` của apps/api đã lệch nhau — một công cụ không gọi " +
        "được sẽ luôn 403, và một route mở mà không có công cụ là một bề mặt không ai dùng tới",
    ).toEqual(duongAgentDoc);
    // Đối chứng: phép so trên không được rỗng ruột.
    expect(duongAgentDoc.length).toBeGreaterThan(5);
  });

  it("← ba đường KHÔNG PHƠI cũng bị apps/api từ chối, không chỉ vắng khỏi bảng công cụ", () => {
    // Vắng khỏi bảng công cụ chặn máy khách CỦA TA. Vế dưới đây mới là thứ chặn một máy khách
    // MCP tự viết cầm cùng chứng chỉ: `apps/api` từ chối, chứ không phải `apps/mcp` không hỏi.
    for (const duong of Object.keys(ROUTE_DOC_KHONG_PHOI)) {
      const route = ROUTES.find((r) => r.path === duong && r.method === "GET");
      expect(route, `apps/api không còn route GET nào tên ${duong}`).toBeDefined();
      expect(
        route === undefined ? null : agentGoiDuoc(route),
        `${duong} nằm trong ROUTE_DOC_KHONG_PHOI nhưng apps/api VẪN cho phiên agent gọi`,
      ).toBe(false);
    }
  });

  it("route GHI mà agent gọi được: đúng một đường, và nó là đăng xuất", () => {
    // [lượt soi đối kháng Đ-1] Route TỰ THÂN chạm chính chứng chỉ, nên nhóm ấy không được im
    // lặng: một `BuyerSelfRoute` thứ hai khai `agent: true` làm câu này đỏ và buộc người viết nói
    // ra vì sao một phiên agent được phép đổi trạng thái ấy.
    const ghiAgentGoiDuoc = ROUTES.filter((r) => agentGoiDuoc(r) && r.method !== "GET").map((r) => r.path);
    expect(ghiAgentGoiDuoc).toEqual(["/auth/logout"]);
  });

  it("đường PHÁT chứng chỉ agent KHÔNG được gọi bằng chính chứng chỉ agent", () => {
    // Vế chịu lực của cả khoản 141: một chứng chỉ agent không tự gia hạn và không tự nhân bản.
    const capPhien = ROUTES.find((r) => r.path === "/auth/agent-session");
    expect(capPhien, "apps/api không còn đường phát chứng chỉ agent").toBeDefined();
    expect(capPhien === undefined ? null : agentGoiDuoc(capPhien)).toBe(false);
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
