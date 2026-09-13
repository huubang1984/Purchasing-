// ==============================================================================================
// [S1.68 / khoản 119, lượt soi 62a-6] MỘT ĐƯỜNG GHI SỔ TỪ CHỐI Ở GIAO DỊCH ĐỘC LẬP
//
// Khoản 119 gỡ ba chỗ tự gọi `withTenant(auditPool, …)` rồi `appendAuditEvent` — mỗi chỗ chép khuôn ghi sổ của `requirePermission` mà
// bỏ bọc lỗi của lần ghi. Tệp này giữ để khuôn ấy không mọc lại: trong mã sản xuất của `packages/*/src` và `apps/*/src`, chỉ
// `packages/identity/src/rbac.ts` — nơi có `requirePermission` và `throwAuditedDenial` — được gọi `withTenant` với đối số đầu mang tên
// `auditPool` (kể cả `deps.auditPool`, `ctx.auditPool`).
//
// PHÁT BIỂU ĐÚNG MỨC: đây là phép đọc VĂN BẢN theo tên. Nó bắt đúng hình dạng đã mọc ba lần. Nó KHÔNG bắt một bí danh
// (`const p = auditPool; withTenant(p, …)`), một pool đặt tên khác, hay một lần ghi sổ từ chối trên client người gọi (khoản 69). Dòng
// chú thích — bắt đầu bằng `//`, `*` hay `/*` — bị bỏ qua, vì chính docstring của khoản 119 kể lại khuôn ấy.
//
// [S1.69 / khoản 120] Bản S1.68 so mẫu trên TỪNG dòng, nên một lời gọi xuống dòng sau `withTenant(` lọt qua — tự bắt khi bản vá khoản 120
// viết hai lời gọi của `rbac.ts` trên nhiều dòng và cổng thấy 0 tệp. Nay ~~các dòng chú thích bị bỏ trước~~ [lượt soi 63a-8] mọi chú thích
// (`//` cuối dòng, `/* */`) và nội dung chuỗi bị bỏ trước, rồi mẫu so trên cả văn bản còn lại; `\s*` của mẫu vắt qua dấu xuống dòng, và mẫu
// nhận cả `withTenant<…>(` lẫn khoảng trắng trước ngoặc. Test đầu tiên dưới đây ghim các dạng ấy bằng văn bản mẫu. Vẫn KHÔNG bắt bí danh.
// ==============================================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const MAU_GOI = /withTenant\s*(?:<[^>]*>)?\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*auditPool\b/u;

/**
 * Văn bản mã với chú thích và NỘI DUNG chuỗi thay bằng khoảng trắng — giữ nguyên độ dài và xuống dòng. Chép từ `boChuThichVaChuoi` của
 * census khoản 99 (`duong-sql-ngoai-with-tenant.test.ts`): hai tệp test không import lẫn nhau.
 */
function boChuThichVaChuoi(ma: string): string {
  const ra = ma.split("");
  const trang = (tu: number, den: number): void => {
    for (let k = tu; k < den && k < ra.length; k += 1) if (ra[k] !== "\n") ra[k] = " ";
  };
  let i = 0;
  while (i < ma.length) {
    const c = ma[i]!;
    const ke = ma[i + 1];
    if (c === "/" && ke === "/") {
      const j = ma.indexOf("\n", i);
      const den = j < 0 ? ma.length : j;
      trang(i, den);
      i = den;
      continue;
    }
    if (c === "/" && ke === "*") {
      const j = ma.indexOf("*/", i + 2);
      const den = j < 0 ? ma.length : j + 2;
      trang(i, den);
      i = den;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < ma.length && ma[j] !== c) {
        if (ma[j] === "\\") j += 1;
        j += 1;
      }
      trang(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return ra.join("");
}

/**
 * [S1.69 / khoản 120, lượt soi 63a-8] Bỏ chú thích và nội dung chuỗi, rồi so mẫu trên CẢ văn bản — lời gọi viết trên nhiều dòng, chú thích chen
 * giữa, tham số kiểu hay khoảng trắng trước ngoặc vẫn bị bắt; một chuỗi mang mẫu thì không.
 */
function coLoiGoiTrenAuditPool(vanBan: string): boolean {
  return MAU_GOI.test(boChuThichVaChuoi(vanBan));
}

function tepTs(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === "dist") continue;
    const duong = join(thuMuc, ten);
    if (statSync(duong).isDirectory()) ra.push(...tepTs(duong));
    else if (ten.endsWith(".ts") && !ten.endsWith(".test.ts")) ra.push(duong);
  }
  return ra;
}

function maSanXuat(): string[] {
  const ra: string[] = [];
  for (const vung of ["packages", "apps"]) {
    for (const goi of readdirSync(join(GOC, vung))) {
      const src = join(GOC, vung, goi, "src");
      if (statSync(join(GOC, vung, goi)).isDirectory() && readdirSync(join(GOC, vung, goi)).includes("src")) ra.push(...tepTs(src));
    }
  }
  return ra;
}

describe("[INV-D5] [S1.68 / khoản 119] một đường ghi sổ từ chối ở giao dịch độc lập", () => {
  it("[INV-D5] [S1.69 / khoản 120] phép đọc bắt lời gọi viết trên nhiều dòng, kể cả khi một dòng chú thích chen giữa; dòng chú thích kể lại khuôn không tính", () => {
    expect(coLoiGoiTrenAuditPool("await withTenant(auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(\n  deps.auditPool,\n  orgId,\n  fn,\n);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(\n  // ghi so tu choi\n  ctx.auditPool,\n  orgId,\n  fn,\n);")).toBe(true);
    // [S1.69 / tự bắt ⑸] Khối JSDoc thật chứ không một dòng ` *` đứng rời: bộ bỏ chú thích đọc theo cú pháp, và mã TypeScript không có dòng ấy.
    expect(coLoiGoiTrenAuditPool("// withTenant(auditPool, orgId, fn)\n/**\n * withTenant(auditPool, …)\n */\nawait withTenant(pool, orgId, fn);")).toBe(false);
    // [lượt soi 63a-8] Bốn dạng bản trước lọt, và một chuỗi mang mẫu.
    expect(coLoiGoiTrenAuditPool("await withTenant( // ghi so\n  auditPool,\n  orgId,\n  fn,\n);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(/* so */ auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant<void>(auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant (auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool('const mau = "withTenant(auditPool, orgId, fn)";')).toBe(false);
  });

  it("[INV-D5] chỉ packages/identity/src/rbac.ts gọi withTenant trên auditPool trong mã sản xuất — và phép đọc có tệp để đọc", () => {
    const tep = maSanXuat();
    const coMau = tep
      .filter((duong) => coLoiGoiTrenAuditPool(readFileSync(duong, "utf8")))
      .map((duong) => relative(GOC, duong).split(sep).join("/"))
      .sort();
    expect(tep.length, "chống rỗng ruột: không đọc được tệp mã sản xuất nào").toBeGreaterThan(50);
    expect(coMau, "withTenant trên auditPool mọc lại ngoài rbac.ts — dùng throwAuditedDenial").toEqual(["packages/identity/src/rbac.ts"]);
  });
});
