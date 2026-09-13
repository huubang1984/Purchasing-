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
// ==============================================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const MAU_GOI = /withTenant\(\s*(?:[A-Za-z_$][\w$]*\.)*auditPool\b/u;
const DONG_CHU_THICH = /^\s*(?:\/\/|\*|\/\*)/u;

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
  it("[INV-D5] chỉ packages/identity/src/rbac.ts gọi withTenant trên auditPool trong mã sản xuất — và phép đọc có tệp để đọc", () => {
    const tep = maSanXuat();
    const coMau = tep
      .filter((duong) => readFileSync(duong, "utf8").split("\n").some((dong) => !DONG_CHU_THICH.test(dong) && MAU_GOI.test(dong)))
      .map((duong) => relative(GOC, duong).split(sep).join("/"))
      .sort();
    expect(tep.length, "chống rỗng ruột: không đọc được tệp mã sản xuất nào").toBeGreaterThan(50);
    expect(coMau, "withTenant trên auditPool mọc lại ngoài rbac.ts — dùng throwAuditedDenial").toEqual(["packages/identity/src/rbac.ts"]);
  });
});
