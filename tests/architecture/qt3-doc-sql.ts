// ==============================================================================================
// BỘ ĐỌC SQL TỪ MÃ TYPESCRIPT — TÁCH RA VÌ NÓ LÀ THỨ QUYẾT ĐỊNH [INV-H21] CÓ RĂNG HAY KHÔNG
//
// Review lượt 14 (H14-2) chỉ ra: bản đầu của bộ đọc lấy TỪNG chuỗi ký tự một rồi loại ngay chuỗi
// không mở đầu bằng từ khoá SQL. Một câu viết bằng `"SELECT …" + " FROM …" + " WHERE …"` bị chẻ
// thành mảnh 1 (một câu SQL cụt) và mảnh 2..n (**không tồn tại với lớp canh**). Bốn ca đang có
// trong mã sản xuất, hai trong số đó là đường an ninh:
//
//   packages/audit/src/writer.ts      — đường ghi DUY NHẤT của sổ kiểm toán: `FROM public.audit_append(…)`
//                                        nằm ở mảnh 2, tức gỡ `public.` ở đó thì lớp vẫn XANH;
//   packages/tenancy/src/with-tenant.ts — cổng phiên khách: `JOIN`, `WHERE`, `AND expires_at …`
//                                        đều ở mảnh 2-6;
//   packages/unseal/src/requests.ts    — vế `org_id = $4` của lần điều phối mở thầu ở mảnh 2.
//
// Nên bộ đọc phải là một BỘ TÁCH TỪ, không phải một biểu thức chính quy: nó đi qua mã một lần,
// biết mình đang ở trong chú thích hay trong chuỗi, và GHÉP những chuỗi liền kề nối bằng `+`
// thành MỘT câu trước khi lọc.
//
// Nó cũng đóng luôn hai lỗ nhỏ hơn của bản regex: chuỗi viết bằng NHÁY ĐƠN (H14-M7 — hôm nay kho
// không có ca nào, nhưng không lớp nào cấm) và một `//` nằm bên trong hằng chuỗi (H14-L4 — ví dụ
// `'https://…'` làm bản regex xoá nhầm phần còn lại của dòng).
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Tệp `.ts` SẢN XUẤT — nguồn là `git ls-files`, không phải cây thư mục.
 *
 * Dùng chung giữa lớp tĩnh và phép đo trên PostgreSQL thật: hai bản sao của cùng một phép lọc là
 * đúng thứ ADR-029 đặt tên.
 */
export function tepNguonCoSql(): readonly string[] {
  return execFileSync("git", ["ls-files"], { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/)
    .map((d) => d.replace(/\\/g, "/"))
    .filter(
      (d) =>
        d.endsWith(".ts") &&
        !d.includes(".test.") &&
        d.includes("/src/") &&
        (d.startsWith("packages/") || d.startsWith("apps/") || d.startsWith("tools/")),
    );
}

export interface CauSql {
  readonly tep: string;
  readonly dong: number;
  readonly sql: string;
}

interface MotChuoi {
  readonly dau: number;
  readonly cuoi: number;
  readonly noiDung: string;
}

/**
 * Đi qua mã TypeScript MỘT LẦN và trả về mọi hằng chuỗi (nháy đơn, nháy kép, dấu huyền), bỏ qua
 * chú thích. Không dùng biểu thức chính quy: `//` bên trong một chuỗi không phải chú thích, và
 * một dấu nháy bên trong chú thích không mở chuỗi.
 */
export function cacHangChuoi(ma: string): readonly MotChuoi[] {
  const ra: MotChuoi[] = [];
  let i = 0;
  while (i < ma.length) {
    const c = ma[i]!;
    const ke = ma[i + 1];
    if (c === "/" && ke === "/") {
      while (i < ma.length && ma[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && ke === "*") {
      i += 2;
      while (i < ma.length && !(ma[i] === "*" && ma[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const dau = i;
      i += 1;
      let noi = "";
      while (i < ma.length && ma[i] !== c) {
        if (ma[i] === "\\") {
          noi += ma[i + 1] ?? "";
          i += 2;
          continue;
        }
        // Nội suy `${…}` của template literal: giữ chỗ, không đọc vào trong.
        if (c === "`" && ma[i] === "$" && ma[i + 1] === "{") {
          let sau = 2;
          let sauDay = 1;
          while (i + sau < ma.length && sauDay > 0) {
            if (ma[i + sau] === "{") sauDay += 1;
            if (ma[i + sau] === "}") sauDay -= 1;
            sau += 1;
          }
          noi += "$NOI_SUY";
          i += sau;
          continue;
        }
        noi += ma[i];
        i += 1;
      }
      ra.push({ dau, cuoi: i + 1, noiDung: noi });
      i += 1;
      continue;
    }
    i += 1;
  }
  return ra;
}

const RE_KHOA_SQL =
  /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*\b(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|GRANT|REVOKE|SET|DO|TRUNCATE|MERGE|COPY|CALL|LOCK|EXPLAIN)\b/i;

/**
 * Ghép các hằng chuỗi LIỀN KỀ chỉ cách nhau bởi `+` và khoảng trắng — chúng là MỘT câu SQL.
 *
 * Đây là vế đóng H14-2. Không được thay bằng cách nới `RE_KHOA_SQL` để nhận cả `FROM`/`WHERE`:
 * làm thế thì mỗi mảnh thành một "câu" và mọi con số đếm câu mất nghĩa.
 */
export function docCauSql(ma: string, tep: string): readonly CauSql[] {
  const chuoi = cacHangChuoi(ma);
  const ra: CauSql[] = [];
  let i = 0;
  while (i < chuoi.length) {
    let j = i;
    let noi = chuoi[i]!.noiDung;
    while (j + 1 < chuoi.length && /^\s*\+\s*$/.test(ma.slice(chuoi[j]!.cuoi, chuoi[j + 1]!.dau))) {
      j += 1;
      noi += chuoi[j]!.noiDung;
    }
    if (noi.length >= 12 && RE_KHOA_SQL.test(noi)) {
      ra.push({ tep, dong: ma.slice(0, chuoi[i]!.dau).split("\n").length, sql: noi });
    }
    i = j + 1;
  }
  return ra;
}

/** Mọi câu SQL trong mã sản xuất — điểm vào dùng chung của cả hai lớp. */
export function moiCauSql(): readonly CauSql[] {
  return tepNguonCoSql().flatMap((t) => docCauSql(readFileSync(join(GOC, t), "utf8"), t));
}
