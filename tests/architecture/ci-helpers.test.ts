import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// dependency-cruiser-ci.cjs là module CJS thuần, không nằm trong "include" của tsconfig.json
// (không thể compile bằng tsc/typescript-eslint) — createRequire() là cách chuẩn để require()
// một module CJS từ trong file ESM, không phụ thuộc cơ chế interop của bundler nào.
const require = createRequire(import.meta.url);

interface CiHelpers {
  ci: (literal: string) => string;
  ciFile: (literal: string) => string;
  ciPrefix: (literal: string) => string;
}

const { ci, ciFile, ciPrefix } = require("../../dependency-cruiser-ci.cjs") as CiHelpers;

// Fix round 3, phát hiện N6: bản trước chỉ escape dấu "." rồi mới kiểm tra chữ cái, để lọt
// 11 ký tự đặc biệt khác của regex (| + * ? ^ $ { } ( ) [ ] \) đi qua nguyên văn. Với một
// literal chứa ký tự đó, `ci()` sinh ra cú pháp regex THẬT thay vì ký tự literal — kết quả là
// NỚI RỘNG quy tắc (khớp nhiều hơn dự định) hoặc làm quy tắc KHÔNG BAO GIỜ khớp chính literal
// gốc của nó (im lặng vô hiệu hóa). Cả hai đều là lỗi nghiêm trọng cho một hàm sinh regex bảo
// vệ ranh giới bảo mật — nó phải SIẾT, không được NỚI.
describe("dependency-cruiser-ci: ci()/ciFile()/ciPrefix() phải escape đúng mọi ký tự đặc biệt của regex", () => {
  const CAC_KY_TU_DAC_BIET: Array<{ ten: string; input: string }> = [
    { ten: "dấu gạch đứng (|)", input: "a|b" },
    { ten: "dấu cộng (+)", input: "a+b" },
    { ten: "dấu sao (*)", input: "a*b" },
    { ten: "dấu hỏi (?)", input: "a?b" },
    { ten: "lượng từ ({n})", input: "a{2}b" },
    { ten: "route Next.js dạng [param]", input: "apps/web/src/app/[orgId]/page.tsx" },
    { ten: "dấu đô la ($)", input: "a$b" },
    { ten: "dấu mũ (^)", input: "a^b" },
    { ten: "cặp ngoặc tròn ()", input: "a(b)c" },
    { ten: "dấu gạch chéo ngược (\\)", input: `a${String.fromCharCode(92)}b` },
  ];

  it.each(CAC_KY_TU_DAC_BIET)(
    "ciFile() khớp CHÍNH XÁC literal chứa $ten, không khớp gì khác",
    ({ input }) => {
      const regex = new RegExp(ciFile(input));
      // Phải tự khớp chính nó — nếu không, quy tắc dùng literal này sẽ không bao giờ bắn,
      // im lặng vô hiệu hóa hàng rào.
      expect(regex.test(input)).toBe(true);
    },
  );

  it("ciFile(\"a|b\") KHÔNG được khớp \"a\" hay \"b\" đứng riêng (nới rộng do | không escape)", () => {
    const regex = new RegExp(ciFile("a|b"));
    expect(regex.test("a")).toBe(false);
    expect(regex.test("b")).toBe(false);
    expect(regex.test("a|b")).toBe(true);
  });

  it("ciFile(\"a+b\") KHÔNG được khớp \"ab\" hay \"aaab\" (nới rộng do + không escape)", () => {
    const regex = new RegExp(ciFile("a+b"));
    expect(regex.test("ab")).toBe(false);
    expect(regex.test("aaab")).toBe(false);
    expect(regex.test("a+b")).toBe(true);
  });

  it("ciFile() với route [orgId] không được khớp một chuỗi orgId thật (nới rộng do [] không escape)", () => {
    // Trước khi sửa, "[orgId]" (không escape "[" và "]") bị hiểu là MỘT character-class chứa
    // các ký tự o,r,g,i,d,O,R,G,I,D — khớp một KÝ TỰ ĐƠN bất kỳ trong tập đó, hoàn toàn khác
    // với việc khớp chuỗi literal "[orgId]".
    const literal = "apps/web/src/app/[orgId]/page.tsx";
    const regex = new RegExp(ciFile(literal));
    expect(regex.test("apps/web/src/app/o/page.tsx")).toBe(false);
    expect(regex.test("apps/web/src/app/[orgId]/page.tsx")).toBe(true);
  });

  it("ci() với chuỗi rỗng trả về chuỗi rỗng", () => {
    expect(ci("")).toBe("");
  });

  it("ciPrefix() với tiền tố không rỗng chỉ khớp đúng tiền tố đó, không khớp mọi thứ", () => {
    const regex = new RegExp(ciPrefix("apps/unseal-worker/"));
    expect(regex.test("apps/unseal-worker/src/index.ts")).toBe(true);
    expect(regex.test("apps/khac/src/index.ts")).toBe(false);
  });

  it("chuyển đổi hoa/thường: ciFile() khớp mọi cách viết hoa/thường của literal chữ-số-thường", () => {
    const regex = new RegExp(ciFile("packages/crypto-keys/src/local-dev-shared.ts"));
    expect(regex.test("packages/crypto-keys/src/local-dev-shared.ts")).toBe(true);
    expect(regex.test("packages/crypto-keys/src/Local-Dev-Shared.ts")).toBe(true);
    expect(regex.test("PACKAGES/CRYPTO-KEYS/SRC/LOCAL-DEV-SHARED.TS")).toBe(true);
    expect(regex.test("packages/crypto-keys/src/local_dev_shared.ts")).toBe(false);
  });
});
