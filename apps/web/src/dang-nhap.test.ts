// ==============================================================================================
// [S1.240 / khoản 282, 268] PHÉP ĐO CHO MODULE BƯỚC 1 CỦA ~~BỐN~~ [S1.249 / khoản 291] NĂM TRANG NGƯỜI MUA — PHẦN THUẦN VÀ LỜI KHAI BỘ ID
//
// Hành vi trên DOM (Tiếp, Vào, khối link gần đây, «còn nữa») đo ở `phuc-vu.test.ts`, trên CẢ ~~BỐN~~ [S1.249 / khoản 291] NĂM trang
// thật chạy trong `node:vm`. Tệp này đo ba thứ đứng một mình:
//   ⑴ phép tính thuần — đọc ô tổ chức (ADR-107), câu của từng link (khoản 195), câu «còn nữa» (khoản 268);
//   ⑵ lời khai «cùng bộ id» — ~~bốn~~ [S1.249 / khoản 291] năm tệp HTML (`du-lieu.html` là tệp thứ năm) khai ĐỦ id mà module gắn
//      vào, đúng trạng thái ẩn lúc tải. DOM giả của `phuc-vu.test.ts` dựng phần tử thiếu theo yêu cầu, nên một nút VẮNG MẶT trong
//      HTML vẫn "bấm" được ở đó — vế này là thứ bắt được nó;
//   ⑶ cửa sổ 7 ngày mà câu trên màn nói khớp hằng của máy chủ (`packages/identity/src/login.ts`), đọc bằng VĂN BẢN nguồn chứ không
//      import — một cạnh `apps/web` → gói máy chủ là cạnh depcruise phải bless (cùng lập luận vế khoản 198 của `phuc-vu.test.ts`).
// ==============================================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUA_SO_NGAY_LINK_GAN_DAY,
  ID_AN_LUC_TAI,
  ID_BUOC_MOT,
  LA_UUID,
  SAI_TO_CHUC,
  cauLinkGanDay,
  docMaToChuc,
  hangLinkGanDay,
  moTaLinkDangNhap,
} from "./dang-nhap.js";

const ORG = "11111111-1111-4111-8111-111111111111";
// [S1.249 / khoản 291] ~~`BON_TRANG` — bốn trang người mua~~ Năm trang: `/du-lieu` (S4.2b) gắn cùng module, cùng bộ id.
const NAM_TRANG = ["mo-thau", "tao-thau", "nhom-hang", "chinh-sach", "du-lieu"] as const;

describe("[S1.240 / khoản 282] đọc ô tổ chức — một bản cho bốn trang (ADR-107)", () => {
  it("UUID trơn, nguyên link cũ, `#<orgId>`, khoảng trắng ⇒ UUID; rỗng ⇒ chuỗi rỗng; sai hình dạng ⇒ null", () => {
    expect(docMaToChuc(ORG)).toBe(ORG);
    expect(docMaToChuc(`  https://mua.vidu.vn/tao-thau#${ORG}:tokTokTokTokTokTok_-1 `)).toBe(ORG);
    expect(docMaToChuc(`#${ORG}`)).toBe(ORG);
    expect(docMaToChuc(ORG.toUpperCase())).toBe(ORG.toUpperCase());
    expect(docMaToChuc("   ")).toBe("");
    expect(docMaToChuc("cong-ty-a")).toBeNull();
    expect(docMaToChuc(`${ORG}x`)).toBeNull();
    expect(LA_UUID.test(ORG)).toBe(true);
    expect(SAI_TO_CHUC).toMatch(/^Mã tổ chức có dạng 00000000-0000-0000-0000-000000000000 /u);
  });
});

describe("[S1.216 / khoản 195 · S1.240 / khoản 268] câu của khối link đăng nhập gần đây", () => {
  const L = { createdAt: "2026-09-30T08:00:00Z", expiresAt: "2026-09-30T08:15:00Z" };

  it("mỗi trạng thái một câu; giờ viết cho người đọc, không chuỗi ISO; danh sách rỗng ⇒ một dòng «chưa có»", () => {
    expect(moTaLinkDangNhap({ ...L, consumedAt: "2026-09-30T08:03:00Z", status: "CONSUMED" })).toMatch(/^đã dùng lúc /u);
    expect(moTaLinkDangNhap({ ...L, consumedAt: null, status: "EXPIRED" })).toMatch(/^hết hạn lúc .+, chưa dùng$/u);
    expect(moTaLinkDangNhap({ ...L, consumedAt: null, status: "PENDING" })).toMatch(/^còn hiệu lực tới .+, chưa dùng$/u);
    const hang = hangLinkGanDay([{ ...L, consumedAt: null, status: "PENDING" }, { ...L, consumedAt: "2026-09-30T08:03:00Z", status: "CONSUMED" }]);
    expect(hang.map(([k]) => k.startsWith("Link lúc "))).toEqual([true, true]);
    for (const [k, v] of hang) expect(`${k} ${v}`).not.toMatch(/T\d\d:\d\d:\d\dZ/u);
    expect(hangLinkGanDay([])).toEqual([["Link đăng nhập gần đây", "chưa có"]]);
  });

  it("[khoản 268] câu nói cửa sổ 7 ngày ở MỌI lần; «Còn nữa» chỉ khi cắt, nối sau câu thường và nói số link đang hiện", () => {
    const du = cauLinkGanDay(false, 3);
    expect(du).toMatch(/7 ngày/u);
    expect(du).toMatch(/không phải bạn/u);
    expect(du).toMatch(/báo ngay/u);
    expect(du).not.toMatch(/Còn nữa/u);
    const cat = cauLinkGanDay(true, 100);
    expect(cat.startsWith(du), "câu «còn nữa» không được thay câu nói việc phải làm").toBe(true);
    expect(cat).toMatch(/Còn nữa/u);
    expect(cat).toMatch(/100 link mới nhất/u);
    expect(cauLinkGanDay(true, 7)).toMatch(/7 link mới nhất/u);
  });
});

describe("[S1.240 / khoản 282] ~~bốn~~ [S1.249 / khoản 291] năm trang khai ĐỦ bộ id mà bước 1 gắn vào", () => {
  for (const trang of NAM_TRANG) {
    it(`${trang}.html: mỗi id của ID_BUOC_MOT đúng một lần, phần tử ẩn lúc tải đúng như khai, ô mã và nút Vào nằm trong khoi-ma sau nút Tiếp`, () => {
      const html = readFileSync(new URL(`../trang/${trang}.html`, import.meta.url), "utf8");
      for (const id of ID_BUOC_MOT) {
        expect(html.split(`id="${id}"`).length - 1, `${trang}.html: id="${id}"`).toBe(1);
      }
      for (const id of ID_AN_LUC_TAI) {
        const the = new RegExp(`<\\w+[^>]*\\sid="${id}"[^>]*>`, "u").exec(html)?.[0] ?? "";
        expect(the, `${trang}.html: #${id} phải ẩn lúc tải`).toMatch(/\shidden(?=[\s>])/u);
      }
      const khoi = /<div id="khoi-ma" hidden>([\s\S]*?)<\/div>/u.exec(html)?.[1] ?? "";
      expect(khoi, `${trang}.html: ô mã sáu số phải nằm trong khoi-ma`).toMatch(/\sid="ma"/u);
      expect(khoi, `${trang}.html: nút Vào phải nằm trong khoi-ma`).toMatch(/\sid="nut-vao"/u);
      expect(html.indexOf('id="nut-ghi-danh"'), `${trang}.html: nút Tiếp phải đứng trước ô mã`).toBeLessThan(html.indexOf('id="khoi-ma"'));
    });
  }
});

describe("[S1.240 / khoản 268] cửa sổ nói trên màn khớp cửa sổ của máy chủ", () => {
  it("CUA_SO_NGAY_LINK_GAN_DAY bằng hằng cửa sổ của `listRecentLoginTokens` — đọc văn bản nguồn, không import", () => {
    const nguon = readFileSync(new URL("../../../packages/identity/src/login.ts", import.meta.url), "utf8");
    const m = /^const CUA_SO_LINK_GAN_DAY_NGAY = (\d+);$/mu.exec(nguon);
    expect(m, "login.ts không còn hằng CUA_SO_LINK_GAN_DAY_NGAY — câu «7 ngày» trên màn không còn gì để khớp").not.toBeNull();
    expect(Number(m?.[1])).toBe(CUA_SO_NGAY_LINK_GAN_DAY);
  });
});
