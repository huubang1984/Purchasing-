import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docHangHardening, khoiValues } from "./hardening-hang.js";

/**
 * [S1.44 / khoản nợ 88 ⑸ — lượt soi 33a INFO-8] Bộ giải hằng của hardening phải NÉM ồn ào ở mọi cú pháp nó không
 * hiểu, thay vì cho ra một câu SQL sai mà có thể vẫn chạy: bản trước cắt `pg_catalog.format(` ở dấu `)` ĐẦU TIÊN và
 * tách tham số bằng `,`, và thay `%n$s` bằng `replaceAll` chuỗi — một tham số chứa `)`, `,`, hay mẫu thay thế của
 * JS (`$&`, `$1`) cho ra văn bản khác thứ PostgreSQL sẽ chạy. Test này là T1 (không CSDL): hardening giả nhỏ, mỗi
 * ca một cú pháp.
 */
const HARDENING_GIA = `
  MAU constant text :=
    $q$%1$s.a = %2$s.b AND %1$s.c LIKE 'x%%'$q$;

  THUAN constant text := $q$SELECT 1$q$;

  GHEP constant text :=
    $q$[$q$ || pg_catalog.format(MAU, 'n', 'c') || $q$]$q$;

  LONG constant text :=
    $q$($q$ || THUAN || $q$) UNION ($q$ || GHEP || $q$)$q$;

  THIEU_THAM_SO constant text :=
    $q$$q$ || pg_catalog.format(MAU, 'n') || $q$$q$;

  NGOAC_TRONG_THAM_SO constant text :=
    $q$$q$ || pg_catalog.format(MAU, 'n)', 'c') || $q$$q$;

  PHAY_TRONG_THAM_SO constant text :=
    $q$$q$ || pg_catalog.format(MAU, 'n,c') || $q$$q$;

  MAU_THAY_THE_JS constant text :=
    $q$$q$ || pg_catalog.format(MAU, '$&', '$1') || $q$$q$;

  KHOANG_TRANG constant text :=
    $q$$q$ || pg_catalog.format(MAU, 'a b', 'c') || $q$$q$;

  CASE_KHONG_HIEU constant text :=
    CASE WHEN true THEN $q$a$q$ ELSE $q$b$q$ END;

  TRONG constant text :=
    $q$%1$s.x = %2$s.y$q$;

  NGOAI constant text :=
    $q$<$q$ || pg_catalog.format(TRONG, 'p', '%2$s') || $q$>$q$;

  BOC constant text :=
    $q$[$q$ || pg_catalog.format(NGOAI, 'a', 'b') || $q$]$q$;

  MAU_S constant text := $q$%1$s LIKE '%s'$q$;
  MAU_I constant text := $q$%I.%1$s$q$;
  MAU_LE constant text := $q$%1$s LIKE 'x%'$q$;

  DUNG_S constant text := $q$$q$ || pg_catalog.format(MAU_S, 'n') || $q$$q$;
  DUNG_I constant text := $q$$q$ || pg_catalog.format(MAU_I, 'n') || $q$$q$;
  DUNG_LE constant text := $q$$q$ || pg_catalog.format(MAU_LE, 'n') || $q$$q$;
`;

describe("docHangHardening — bộ giải hằng của hardening.always.sql", () => {
  it("giải literal, nối hằng, và format() với tham số bí danh: %n$s thay đúng vị trí, %% thành %", () => {
    expect(docHangHardening(HARDENING_GIA, "THUAN")).toBe("SELECT 1");
    expect(docHangHardening(HARDENING_GIA, "GHEP")).toBe("[n.a = c.b AND n.c LIKE 'x%']");
    expect(docHangHardening(HARDENING_GIA, "LONG")).toBe("(SELECT 1) UNION ([n.a = c.b AND n.c LIKE 'x%'])");
    // Mẫu CHUYỀN TIẾP: format() lồng truyền '%2$s' để format() bọc ngoài thay — đúng cách MAU_VI_TU_BANG_TENANT dùng
    // MAU_VI_TU_CO_ORG_ID trong hardening thật; là ca người soi nêu ("hôm nay đúng vì $s không phải mẫu JS").
    expect(docHangHardening(HARDENING_GIA, "NGOAI")).toBe("<p.x = %2$s.y>");
    expect(docHangHardening(HARDENING_GIA, "BOC")).toBe("[<p.x = b.y>]");
  });

  it("NÉM ồn ào ở mọi cú pháp không hiểu — không bao giờ trả về một câu SQL khác thứ PostgreSQL chạy", () => {
    expect(() => docHangHardening(HARDENING_GIA, "KHONG_CO")).toThrow(/không thấy hằng/u);
    // CASE: bộ giải đọc `CASE` như tên một hằng rồi không thấy nó — vẫn là NÉM, cùng khuôn với NEO_003 ở rls-coverage.
    expect(() => docHangHardening(HARDENING_GIA, "CASE_KHONG_HIEU")).toThrow(/cú pháp lạ|không thấy hằng/u);
    // tham số format() chỉ được là bí danh `'[A-Za-z_][A-Za-z0-9_]*'` — ngoặc, phẩy, khoảng trắng, mẫu thay thế JS đều NÉM
    for (const ten of ["NGOAC_TRONG_THAM_SO", "PHAY_TRONG_THAM_SO", "MAU_THAY_THE_JS", "KHOANG_TRANG"]) {
      expect(() => docHangHardening(HARDENING_GIA, ten), ten).toThrow(/cú pháp lạ ở pg_catalog\.format/u);
    }
    // mẫu %2$s không có tham số thứ hai: PostgreSQL ném "too few arguments for format()" — bộ giải cũng phải ném
    expect(() => docHangHardening(HARDENING_GIA, "THIEU_THAM_SO")).toThrow(/dùng %2\$s mà format\(\) ở hằng THIEU_THAM_SO chỉ truyền 1 tham số/u);
    // [lượt soi 36 #4] bộ giải ĐÓNG: `%s` (PostgreSQL thay tuần tự — bộ giải để nguyên là một câu KHÁC), `%I`, `%` lẻ ⇒ ném
    for (const ten of ["DUNG_S", "DUNG_I", "DUNG_LE"]) {
      expect(() => docHangHardening(HARDENING_GIA, ten), ten).toThrow(/có mẫu % ngoài văn phạm/u);
    }
  });

  it("đối chứng bằng chính hardening.always.sql: mọi tham số format() trong tệp là bí danh đơn, và mọi hằng dùng format() giải được", () => {
    const that = readFileSync(new URL("./migrations/hardening.always.sql", import.meta.url), "utf8");
    const ten = [...new Set([...that.matchAll(/\n  ([A-Z_0-9]+) +constant text :=/gu)].map((m) => m[1]!))];
    expect(ten.length).toBeGreaterThan(50);
    // Nguồn của một hằng: từ dòng khai tới dòng kế tiếp thụt đúng hai khoảng trắng (hằng kế, hay một chú thích).
    const nguon = (t: string): string => {
      const khai = new RegExp(`\\n  ${t} +constant text :=`, "u").exec(that)!;
      const than = that.slice(khai.index + khai[0].length);
      const cuoi = than.search(/\n  \S/u);
      return than.slice(0, cuoi < 0 ? undefined : cuoi);
    };
    const dungFormat = ten.filter((t) => /\|\|\s*pg_catalog\.format\([A-Z_0-9]+/u.test(nguon(t)));
    expect(dungFormat, "MAU_SCHEMA_DU_AN phải được khai triển ở nhiều hằng").toContain("VI_TU_BANG_CHI_GHI_THEM");
    expect(dungFormat.length).toBeGreaterThan(10);
    // Hằng LÀ MẪU cho một format() khác thì được mang `%n$s` (chuyền tiếp cho format() bọc ngoài — MAU_VI_TU_BANG_TENANT
    // bọc MAU_VI_TU_CO_ORG_ID); tính từ chính tệp, không miễn theo tiền tố tên [lượt soi 36 #4].
    const laMau = new Set([...that.matchAll(/pg_catalog\.format\(([A-Z_0-9]+)/gu)].map((m) => m[1]!));
    expect(laMau).toContain("MAU_SCHEMA_DU_AN");
    for (const t of dungFormat) {
      const van = docHangHardening(that, t);
      if (!laMau.has(t)) expect(van, t).not.toMatch(/%\d+\$s/u);
      expect(van.length, t).toBeGreaterThan(40);
    }
  });

  it("khoiValues: danh sách rỗng là một hàng toàn chuỗi rỗng; dấu nháy được nhân đôi", () => {
    expect(khoiValues([], "b", ["x", "y"])).toBe("(VALUES ('', '')) AS b(x, y)");
    expect(khoiValues([["a'b", "c"]], "b", ["x", "y"])).toBe("(VALUES\n         ('a''b', 'c')\n       ) AS b(x, y)");
  });
});
