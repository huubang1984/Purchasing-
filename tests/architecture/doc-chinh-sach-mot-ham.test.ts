// ==============================================================================================
// [S1.9101 / S3.1a] MỌI CÂU SQL ĐỌC CHÍNH SÁCH MUA SẮM ĐI QUA `chinh_sach_hieu_luc` HOẶC THEO MỘT
// `policy_id` ĐÃ GHIM — KHÔNG CÂU NÀO TỰ CHỌN PHIÊN BẢN
//
// Lúc làm S3.1a, bốn chỗ tự chọn phiên bản hiện hành theo ba luật khác nhau; hai chỗ ở TypeScript
// (`getActiveProcurementPolicy`, `docChinhSach`). Chủ dự án chọn hợp nhất về MỘT hàm SQL, vì một
// phiên bản có bậc chưa có chữ ký thứ hai không được có hiệu lực ở BẤT KỲ chỗ nào (ADR-082 ⑺). Nửa
// CSDL của phép kiểm này đứng ở `packages/rfq/src/bac-chinh-sach.int.test.ts` (tổng điều tra hàm);
// nửa này đọc mã TypeScript bằng cùng bộ đọc của [INV-H21], nên một câu ghép bằng `+` không lọt.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";

type Lop = "GHI" | "QUA_HAM" | "THEO_ID";

/** Một câu chạm bảng chính sách thuộc đúng một lớp; `null` là câu TỰ CHỌN phiên bản. */
function lopCua(sql: string): Lop | null {
  if (/^\s*INSERT\s+INTO\s+public\.org_procurement_policies\b/iu.test(sql)) return "GHI";
  if (/\bpublic\.chinh_sach_hieu_luc\s*\(/u.test(sql)) return "QUA_HAM";
  if (/\bJOIN\s+public\.org_procurement_policies\s+(\w+)\s+ON\s+\1\.id\s+OPERATOR\(pg_catalog\.=\)\s+\w+\.policy_id\b/iu.test(sql)) {
    return "THEO_ID";
  }
  return null;
}

/** Tệp sản xuất có câu chạm bảng chính sách — tập KHAI, để một tệp mới phải trả lời câu hỏi của lớp. */
const TEP_DA_KHAI: readonly string[] = [
  "packages/danh-gia/src/bo-bang-chung.ts",
  "packages/danh-gia/src/doc-bang-xep-hang.ts",
  "packages/danh-gia/src/luot-danh-gia.ts",
  "packages/danh-gia/src/vong-bafo.ts",
  "packages/rfq/src/procurement-policy.ts",
  "tools/gieo-demo/src/index.ts",
];

describe("[S1.9101] đọc chính sách mua sắm qua MỘT hàm", () => {
  const cau = moiCauSql().filter((c) => /\borg_procurement_policies\b/u.test(c.sql));

  it("không câu SQL nào của mã sản xuất tự chọn phiên bản chính sách; tập tệp chạm bảng là tập đã khai", () => {
    expect(cau.length, "bộ đọc không thấy câu nào chạm bảng — đang mù").toBeGreaterThan(0);
    expect(
      cau.filter((c) => lopCua(c.sql) === null).map((c) => `${c.tep}:${c.dong}`),
      "Câu này đọc org_procurement_policies mà không qua public.chinh_sach_hieu_luc(org, lúc) và không theo một policy_id đã ghim — " +
        "tức nó tự chọn phiên bản, và một phiên bản có bậc chưa ký sẽ có hiệu lực ở đây (ADR-082 ⑺).",
    ).toEqual([]);
    expect([...new Set(cau.map((c) => c.tep))].sort()).toEqual([...TEP_DA_KHAI].sort());
    // Hai chỗ đọc chính sách HIỆN HÀNH của TypeScript — đúng hai chỗ mà S3.1a hợp nhất.
    for (const tep of ["packages/rfq/src/procurement-policy.ts", "packages/danh-gia/src/luot-danh-gia.ts"]) {
      expect(cau.some((c) => c.tep === tep && lopCua(c.sql) === "QUA_HAM"), tep).toBe(true);
    }
  });

  it("đối chứng: hai câu TRƯỚC S3.1a — `getActiveProcurementPolicy` và `docChinhSach` — bị bộ phân loại bắt", () => {
    expect(
      lopCua(
        "SELECT id, version FROM public.org_procurement_policies " +
          "WHERE effective_from OPERATOR(pg_catalog.<=) pg_catalog.now() ORDER BY version DESC LIMIT 1",
      ),
    ).toBeNull();
    expect(
      lopCua(
        "SELECT o.id, o.version, o.eval_components FROM public.org_procurement_policies o " +
          "WHERE o.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid ORDER BY o.version DESC LIMIT 1",
      ),
    ).toBeNull();
  });
});
