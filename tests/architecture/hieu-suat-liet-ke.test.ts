// ==============================================================================================
// [S1.291 / S3.8a / K11] VIEW HIỆU SUẤT NHÀ CUNG CẤP — MỘT ĐƯỜNG ĐỌC, CÓ TÊN
//
// Spec S3 §4.9, §5.1 K11; ADR-163. `app_api` có SELECT trên `supplier_performance` (mọi mã ứng dụng chạy dưới vai ấy), và cổng
// `bid.view` nằm ở tầng gói — CSDL không biết người gọi là ai (kho không có GUC người dùng nào; kế hoạch §5 phán ⑤). Một bộ đọc thứ hai
// — một báo cáo, một route khác — đọc view mà không cổng thì mọi lớp khác vẫn xanh. Lớp này giữ đường đọc ấy là MỘT và có tên:
//   ⑴ tệp TypeScript sản xuất nhắc tên view đúng bằng một: `packages/kiem-soat/src/hieu-suat.ts`;
//   ⑵ ký hiệu `docHieuSuatNhaCungCap` chỉ ở nơi định nghĩa, mặt tiền gói, route của nó và câu khai `agent: false` của MCP;
//   ⑶ hàm ấy hỏi `bid.view` đúng một lần và ghi `SUPPLIER_PERFORMANCE_READ`;
//   ⑷ không migration nào ngoài tệp dựng view và tệp ghim nhắc tên view — nên không hàm SQL, view lồng hay trigger nào đọc nó.
// Vẫn là lớp chữ: một câu SQL dựng động vượt qua nó — cùng giới hạn của `so-tai-khoan-liet-ke.test.ts`, nói ra ở ADR-163.
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const VIEW = /\bsupplier_performance\b/u;
const TEP_DOC = "packages/kiem-soat/src/hieu-suat.ts";

/** Tệp đã theo dõi của git — không `readdirSync`: cổng khác dựng tệp dò tạm trong `apps/`, `packages/` lúc chạy. */
const tepGit = (): string[] =>
  execFileSync("git", ["ls-files"], { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/u)
    .filter((t) => t !== "");

const tepSanXuat = (): string[] => tepGit().filter((t) => /^(packages|apps|tools)\/.*\/src\/.*\.[cm]?[jt]s$/u.test(t) && !t.includes(".test."));
const nhac = (tep: readonly string[], mau: RegExp): string[] => tep.filter((t) => mau.test(readFileSync(`${GOC}${t}`, "utf8"))).sort();

describe("[INV-K11] view hiệu suất — một đường đọc, có tên", () => {
  it("[INV-K11] ⑴ tệp TypeScript sản xuất nhắc `supplier_performance` đúng bằng một", () => {
    expect(nhac(tepSanXuat(), VIEW), "đọc hiệu suất thì gọi `docHieuSuatNhaCungCap` (cổng `bid.view`, hàng sổ)").toEqual([TEP_DOC]);
  });

  it("[INV-K11] ⑵ `docHieuSuatNhaCungCap` chỉ ở nơi định nghĩa, mặt tiền gói, route `/supplier-performance` và câu khai `agent: false` của MCP", () => {
    // `apps/mcp/src/cong-cu.ts` nhắc tên hàm trong CHUỖI khai vì sao route `agent: false` (khuôn `docLichSuGia`, `docBenchmark`) — không gọi.
    expect(nhac(tepSanXuat(), /\bdocHieuSuatNhaCungCap\b/u)).toEqual(
      [TEP_DOC, "packages/kiem-soat/src/index.ts", "apps/api/src/routes/hieu-suat.ts", "apps/mcp/src/cong-cu.ts"].sort(),
    );
  });

  it("[INV-K11] ⑶ hàm đọc hỏi `bid.view` đúng một lần và ghi `SUPPLIER_PERFORMANCE_READ`", () => {
    const than = readFileSync(`${GOC}${TEP_DOC}`, "utf8");
    expect(than.match(/permission: PERMISSIONS\.BID_VIEW\b/gu)?.length).toBe(1);
    expect(than).toMatch(/action: "SUPPLIER_PERFORMANCE_READ"/u);
  });

  it("[INV-K11] ⑷ không migration nào ngoài tệp dựng view và tệp ghim nhắc `supplier_performance`", () => {
    const migration = tepGit().filter((t) => /^db\/migrations\/.*\.sql$/u.test(t));
    const nhacView = nhac(migration, VIEW);
    expect(nhacView.filter((t) => !/^db\/migrations\/\d+_hieu_suat_nha_cung_cap\.sql$/u.test(t))).toEqual(["db/migrations/hardening.always.sql"]);
    expect(nhacView.filter((t) => /_hieu_suat_nha_cung_cap\.sql$/u.test(t)), "tiền đề: tệp dựng view phải được thấy").toHaveLength(1);
  });

  it("ĐỐI CHỨNG của bộ dò: biên từ — `supplier_performance_x` không bị đếm, `public.supplier_performance` thì có", () => {
    expect(VIEW.test("FROM public.supplier_performance p")).toBe(true);
    expect(VIEW.test("FROM public.supplier_performance_x p")).toBe(false);
    expect(VIEW.test('"supplier_performance"')).toBe(true);
  });
});
