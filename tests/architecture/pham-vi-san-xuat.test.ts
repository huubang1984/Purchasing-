// ==============================================================================================
// [khoản nợ 21] HẠ TẦNG KIỂM THỬ KHÔNG ĐƯỢC LỌT VÀO PHẠM VI SẢN XUẤT — VÀ LỚP CANH LÀ ĐÂY
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// `packages/test-support` khai `@testcontainers/postgresql` trong `dependencies` suốt từ Task 3
// tới lượt CI đầu tiên. Thứ làm nó lộ ra KHÔNG phải một lớp canh nào — mà là **hai advisory HIGH
// trên `undici`**, một sự trùng hợp. Gỡ hai advisory ấy đi thì `pnpm audit --prod` im lặng và cả
// cây testcontainers vẫn nằm nguyên trong đồ thị sản xuất.
//
// Nói cho đúng hình dạng: `pnpm audit --prod` đo **lỗ hổng đã biết**, không đo **phạm vi**. Dùng
// nó làm lớp canh phạm vi là mượn một phép đo để nói một bảo đảm khác — đúng thứ QT2 cấm.
//
// ----------------------------------------------------------------------------------------------
// BA VẾ, VÀ VẾ THỨ HAI SUY TỪ TÍNH CHẤT CHỨ KHÔNG TỪ MỘT DANH SÁCH TÊN
// ----------------------------------------------------------------------------------------------
//   ⑴ **Tập phụ thuộc NGOÀI ở phạm vi sản xuất được GHIM.** Hôm nay đúng hai: `pg` và
//     `pg-connection-string`. Đây là chỗ một danh sách ghim là ĐÚNG hình dạng — thêm một thư viện
//     ngoài vào sản phẩm phải là một hành vi có chủ đích, và nó phải đi qua một lần sửa test.
//
//   ⑵ **Gói CHỈ-DÙNG-CHO-TEST không được nằm trong `dependencies` của bất kỳ ai.** "Chỉ dùng cho
//     test" KHÔNG phải một danh sách tên: một gói workspace được xếp vào rổ ấy khi MỌI tệp import
//     nó đều là tệp test. Một `packages/x-support` mới ra đời mai sau tự động rơi vào rổ này mà
//     không ai phải nhớ thêm tên nó vào đâu — đó là điểm khác biệt với ba lần *"hàng rào tự làm
//     mù mình bằng một danh sách tên"* đã bắt được ở dự án này.
//
//   ⑶ **Phụ thuộc phát triển của gốc không được xuất hiện ở `dependencies` của bất kỳ gói nào.**
//     `vitest`, `typescript`, `dependency-cruiser`, `fast-check` — mỗi cái đều là một đường
//     testcontainers thứ hai đang chờ.
//
// Vế ⑵ ĐÃ TÌM RA MỘT LỖ NGAY LẦN CHẠY ĐẦU: `apps/unseal-worker` khai `@trustprocure/test-support`
// trong `dependencies`. `pnpm audit --prod` không kêu — vì sau lần sửa Task 3, `test-support` tự
// nó không còn phụ thuộc ngoài nào để mà có advisory. Tức khoản nợ 21 mô tả đúng cơ chế, và cơ
// chế ấy đã tái diễn một lần nữa mà không ai thấy.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Phụ thuộc NGOÀI được phép có mặt ở phạm vi sản xuất.
 *
 * Đo một lần bằng `pnpm list -r --prod --depth 0`, và giữ đúng bằng test này. Thêm một dòng vào
 * đây là một quyết định kiến trúc, không phải một lần dọn dẹp.
 */
const NGOAI_DUOC_PHEP_O_SAN_XUAT: readonly string[] = ["pg", "pg-connection-string"];

interface Manifest {
  readonly duongDan: string;
  readonly ten: string;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

function docManifest(): Manifest[] {
  return execFileSync("git", ["ls-files", "package.json", "*/*/package.json"], {
    cwd: GOC,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((t) => t.length > 0)
    .map((t) => {
      const noiDung = JSON.parse(readFileSync(join(GOC, t), "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return {
        duongDan: t,
        ten: noiDung.name ?? t,
        dependencies: noiDung.dependencies ?? {},
        devDependencies: noiDung.devDependencies ?? {},
      };
    });
}

const laTepTest = (t: string): boolean => /\.test\.[cm]?ts$/u.test(t);

/**
 * Những gói workspace mà MỌI nơi import đều là tệp test — suy từ tính chất, không từ tên.
 *
 * Một gói không ai import thì KHÔNG rơi vào rổ này: "không có người dùng nào" và "chỉ có người
 * dùng là test" là hai điều khác nhau, và gộp chúng lại sẽ tố cáo nhầm một gói mới chưa nối dây.
 */
function goiChiDungChoTest(tenGoiWorkspace: readonly string[]): string[] {
  const nguoiDung = new Map<string, { test: number; sanXuat: number }>();
  for (const ten of tenGoiWorkspace) nguoiDung.set(ten, { test: 0, sanXuat: 0 });

  const cacTep = execFileSync("git", ["ls-files", "*.ts", "*.mts", "*.mjs"], {
    cwd: GOC,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((t) => t.length > 0);

  for (const t of cacTep) {
    const noiDung = readFileSync(join(GOC, t), "utf8");
    for (const ten of tenGoiWorkspace) {
      // Chỉ tính lời gọi import THẬT, không tính một lần nhắc tên trong chú thích: specifier
      // luôn nằm giữa cặp nháy và bắt đầu bằng đúng tên gói.
      // Chỉ thoát đúng các ký tự CÓ NGHĨA trong regex. Thoát bừa `@` hay `/` ném ngay dưới cờ
      // `u` ("Invalid escape") — đã tự vấp một lần khi viết hàm này.
      const mau = new RegExp(
        String.raw`["']${ten.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:/[^"']*)?["']`,
        "u",
      );
      if (!mau.test(noiDung)) continue;
      const o = nguoiDung.get(ten);
      if (o === undefined) continue;
      if (laTepTest(t)) o.test += 1;
      else o.sanXuat += 1;
    }
  }
  return [...nguoiDung.entries()]
    .filter(([, o]) => o.test > 0 && o.sanXuat === 0)
    .map(([ten]) => ten)
    .sort();
}

describe("[khoản nợ 21] phạm vi sản xuất là một tính chất ĐƯỢC ĐO, không phải một sự may mắn", () => {
  const manifest = docManifest();
  const tenWorkspace = manifest
    .filter((m) => m.duongDan !== "package.json")
    .map((m) => m.ten)
    .sort();

  it("không gói nào khai một phụ thuộc NGOÀI ngoài danh sách đã ghim", () => {
    const viPham: string[] = [];
    let daKiem = 0;
    for (const m of manifest) {
      for (const ten of Object.keys(m.dependencies)) {
        if (ten.startsWith("@trustprocure/")) continue;
        daKiem += 1;
        if (!NGOAI_DUOC_PHEP_O_SAN_XUAT.includes(ten)) {
          viPham.push(
            `${m.duongDan}: "${ten}" nằm ở \`dependencies\` — tức PHẠM VI SẢN XUẤT. Nếu nó là hạ ` +
              `tầng kiểm thử, chuyển sang \`devDependencies\`; nếu nó thật sự là thư viện sản ` +
              `phẩm, thêm vào NGOAI_DUOC_PHEP_O_SAN_XUAT và nói rõ vì sao.`,
          );
        }
      }
    }
    expect(daKiem, "không thấy phụ thuộc ngoài nào — phép quét đã hỏng, không phải kho đã sạch")
      .toBeGreaterThan(5);
    expect(viPham).toEqual([]);
  });

  it("gói CHỈ-DÙNG-CHO-TEST không nằm trong `dependencies` của bất kỳ ai", () => {
    const chiTest = goiChiDungChoTest(tenWorkspace);
    // Chống rỗng ruột theo cả hai chiều: phép suy phải THẤY được ít nhất một gói như thế (nếu
    // không, nó chỉ đang trả về mảng rỗng), và phải KHÔNG gom cả kho vào rổ ấy.
    expect(chiTest, "phép suy 'chỉ dùng cho test' không thấy gói nào — nó đã hỏng").not.toEqual([]);
    expect(chiTest.length, "cả kho rơi vào rổ test ⇒ phép suy quá rộng").toBeLessThan(
      tenWorkspace.length,
    );

    const viPham: string[] = [];
    for (const m of manifest) {
      for (const ten of Object.keys(m.dependencies)) {
        if (chiTest.includes(ten)) {
          viPham.push(
            `${m.duongDan}: "${ten}" nằm ở \`dependencies\`, nhưng MỌI nơi import nó đều là tệp ` +
              `test. Nó thuộc \`devDependencies\`. Đây đúng khuôn đã kéo cả cây testcontainers ` +
              `vào phạm vi sản xuất ở Task 3, và \`pnpm audit --prod\` KHÔNG bắt được vì gói này ` +
              `không có advisory nào để mà kêu.`,
          );
        }
      }
    }
    expect(viPham).toEqual([]);
  });

  it("phụ thuộc phát triển của gốc không lọt vào `dependencies` của gói nào", () => {
    const goc = manifest.find((m) => m.duongDan === "package.json");
    expect(goc, "không đọc được package.json gốc").toBeDefined();
    const cuaGoc = Object.keys(goc?.devDependencies ?? {});
    expect(cuaGoc.length, "gốc không có devDependencies nào — phép đo rỗng ruột").toBeGreaterThan(3);

    const viPham: string[] = [];
    for (const m of manifest) {
      if (m.duongDan === "package.json") continue;
      for (const ten of Object.keys(m.dependencies)) {
        if (cuaGoc.includes(ten)) viPham.push(`${m.duongDan}: "${ten}" là công cụ phát triển`);
      }
    }
    expect(viPham).toEqual([]);
  });
});
