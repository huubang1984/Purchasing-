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
//
// [S1.72 / khoản 121] VẾ ⑷: gói workspace mà mã SẢN XUẤT import lúc chạy phải nằm ở `dependencies` của chính gói. Quy tắc depcruise
// `khong-phu-thuoc-devdep-trong-src` chỉ bắn trên cạnh `npm-dev`, mà gói workspace đi qua `paths` của tsconfig: `apps/unseal-worker`
// import `@trustprocure/identity` lúc chạy (`assertFreshMfa`, từ S1.6) trong khi khai nó ở `devDependencies`, và t0 trên master 298cd4e
// xanh. ~~Gói mà mọi nơi import đều là test (vế ⑵) được miễn — "mã sản xuất" của nó là hạ tầng kiểm thử; [lượt soi 67a-2] trừ gói dưới
// `apps/`: app là lá, không mã sản xuất nào import nó, nên một lần nhắc tên app trong một tệp test đủ đưa cả app vào rổ miễn — và mỗi app có
// mã sản xuất phải có tệp được đọc. [lượt soi 67c-5] Tool cũng là lá, và chạy lúc vận hành (`pnpm neo`): rổ miễn chỉ nhận gói dưới `packages/`,
// và mỗi tool có mã sản xuất cũng phải có tệp được đọc.~~ [S1.9191 / khoản 223] Rổ miễn của vế ⑷ là LỜI KHAI, không phải phép suy: phép đếm của
// vế ⑵ xếp một gói KHÔNG AI IMPORT Ở MÃ SẢN XUẤT vào cùng rổ với gói chỉ test dùng, nên `packages/danh-gia` sống hai vòng với hai phụ thuộc lúc
// chạy không khai mà bốn cổng xanh trọn (§S1.106). Nay MỌI gói dưới `packages/`, `apps/`, `tools/` đều được đọc; chỉ gói tự khai
// `"trustprocure": { "testOnly": true }` trong `package.json` của nó — hôm nay `packages/test-support` — được miễn; lời khai chỉ có nghĩa dưới
// `packages/` (app và tool là lá chạy lúc vận hành — lượt soi 67a-2, 67c-5) và phải được phép đếm của vế ⑵ xác nhận. Mỗi lá có mã sản xuất
// phải có tệp được đọc. `import type`/`export type` không tính: TypeScript xoá chúng. [lượt soi 67a-1] Ngoặc chỉ mang kiểu nội
// tuyến (`import { type A } from …`) VẪN tính: câu import còn lại và gói vẫn được nạp — đo (§S1.72): dưới `node --experimental-transform-types`,
// cách `apps/api` chạy, `import { type A } from "./x.ts"` chạy `x.ts`. PHÁT BIỂU ĐÚNG MỨC: ~~phép đọc theo dòng bắt đầu bằng `import`/`export` và theo `import("…")` có đối số là~~
// ~~chuỗi;~~ [lượt soi 67c-7] phép đọc cây cú pháp: câu `import`/`export` có nguồn, `import x = require(…)` và `import("…")` có đối số là chuỗi;
// một `import(` động mang biến, hay `require(…)` và `createRequire`, thì mù.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Phụ thuộc NGOÀI được phép có mặt ở phạm vi sản xuất.
 *
 * Đo một lần bằng `pnpm list -r --prod --depth 0`, và giữ đúng bằng test này. Thêm một dòng vào
 * đây là một quyết định kiến trúc, không phải một lần dọn dẹp.
 */
// [ADR-062] `@aws-sdk/client-kms`: adapter aws-kms của cặp khoá tổ chức (`packages/crypto-keys`)
// — ADR-009 chọn AWS KMS, và SDK chính hãng là thứ duy nhất ký SigV4 cho lời gọi ấy; tự viết một
// bộ ký là thêm mã mật mã mà dự án phải tự canh. Cây phụ thuộc bắc cầu của nó (`@smithy/*`,
// `@aws-crypto/*`…) do bước audit T0b đo, không liệt kê ở đây: test này chỉ xét phụ thuộc TRỰC TIẾP.
// [ADR-065] `@aws-sdk/client-sesv2`: bộ gửi thư thật của `api` và cảnh báo break-glass của worker —
// cùng lý do với client-kms (SDK chính hãng ký SigV4; không tự viết).
// [ADR-069] `@aws-sdk/client-pinpoint-sms-voice-v2`: kênh SMS của `api`. `@aws-sdk/client-secrets-manager`: kho token
// Zalo ZNS của `api` — token xoay vòng nên phải ĐỌC VÀ GHI lúc chạy, không bơm một lần qua biến môi trường được.
// [ADR-071] `@aws-sdk/client-s3` + `@aws-sdk/client-sts`: job neo (`tools/neo-so-kiem-toan`) mượn tp-anchor-writer và ghi
// bucket neo ở tài khoản audit.
// [ADR-089] `@aws-sdk/client-sns`: Lambda `tp-canh-dang-ky` (`tools/canh-dang-ky`, stack 60) liệt kê đăng ký của hai topic
// cảnh báo ở audit. Runtime Lambda cung cấp SDK — không đóng gói; phụ thuộc ở đây là cho kiểu và test.
const NGOAI_DUOC_PHEP_O_SAN_XUAT: readonly string[] = [
  "@aws-sdk/client-kms",
  "@aws-sdk/client-pinpoint-sms-voice-v2",
  "@aws-sdk/client-s3",
  "@aws-sdk/client-secrets-manager",
  "@aws-sdk/client-sesv2",
  "@aws-sdk/client-sns",
  "@aws-sdk/client-sts",
  "pg",
  "pg-connection-string",
];

interface Manifest {
  readonly duongDan: string;
  readonly ten: string;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  /** [S1.9191 / khoản 223] Gói TỰ KHAI mình chỉ dùng cho test: `"trustprocure": { "testOnly": true }` trong `package.json`. */
  readonly chiDungChoTest: boolean;
}

/** Tệp git theo dõi khớp các mẫu — cùng phép đọc cho manifest, cho phép đếm của vế ⑵ và cho vế ⑷. */
function tepGit(...pMau: string[]): string[] {
  return execFileSync("git", ["ls-files", "--deduplicate", ...pMau], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((t) => t.length > 0);
}

const docTepGoc = (t: string): string => readFileSync(join(GOC, t), "utf8");

function docManifest(): Manifest[] {
  return tepGit("package.json", "*/*/package.json").map((t) => {
    const noiDung = JSON.parse(docTepGoc(t)) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      trustprocure?: { testOnly?: unknown };
    };
    return {
      duongDan: t,
      ten: noiDung.name ?? t,
      dependencies: noiDung.dependencies ?? {},
      devDependencies: noiDung.devDependencies ?? {},
      chiDungChoTest: noiDung.trustprocure?.testOnly === true,
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
function goiChiDungChoTest(
  tenGoiWorkspace: readonly string[],
  cacTep: readonly string[] = tepGit("*.ts", "*.mts", "*.mjs"),
  doc: (t: string) => string = docTepGoc,
): string[] {
  const nguoiDung = new Map<string, { test: number; sanXuat: number }>();
  for (const ten of tenGoiWorkspace) nguoiDung.set(ten, { test: 0, sanXuat: 0 });

  for (const t of cacTep) {
    const noiDung = doc(t);
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

/**
 * [S1.72 / khoản 121] Tên gói `@trustprocure/*` mà một tệp import LÚC CHẠY. `import type`, `export type` ~~và ngoặc chỉ mang kiểu~~ bị bỏ;
 * `export * from`, import trần và `import("…")` động được tính. [lượt soi 67a-1] Ngoặc chỉ mang kiểu nội tuyến được tính — xem đầu tệp.
 * [lượt soi 67c-7] Đọc cây cú pháp của TypeScript thay cho mẫu theo dòng — mẫu ấy bỏ trọn câu import mang `;` trong chú thích giữa ngoặc, coi
 * tên mặc định `type` là chỉ mang kiểu, và không thấy `import x = require(…)` hay câu import không đứng đầu dòng.
 */
function importLucChay(vanBan: string): string[] {
  const ra = new Set<string>();
  const them = (e: ts.Expression | undefined): void => {
    if (e === undefined || !(ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) return;
    const goi = /^@trustprocure\/[a-z0-9-]+/u.exec(e.text)?.[0];
    if (goi !== undefined) ra.add(goi);
  };
  const duyet = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && n.importClause?.isTypeOnly !== true) them(n.moduleSpecifier);
    else if (ts.isExportDeclaration(n) && !n.isTypeOnly) them(n.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(n) && !n.isTypeOnly && ts.isExternalModuleReference(n.moduleReference)) them(n.moduleReference.expression);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) them(n.arguments[0]);
    ts.forEachChild(n, (con) => {
      duyet(con);
    });
  };
  duyet(ts.createSourceFile("mau.ts", vanBan, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return [...ra].sort();
}

/**
 * ~~[S1.72 / lượt soi 67a-2] Rổ miễn của vế ⑷: gói chỉ dùng cho test (vế ⑵), TRỪ gói dưới `apps/`.~~ App là lá — không mã sản xuất nào import nó —,
 * nên với phép đếm của vế ⑵ một lần nhắc tên app trong một tệp test đủ đưa cả app vào rổ, và vế ⑷ bỏ qua toàn bộ mã của app ấy.
 * [lượt soi 67c-5] CHỈ gói dưới `packages/`: tool cũng là lá, và chạy lúc vận hành — `pnpm neo` chạy `tools/neo-so-kiem-toan/src/index.ts`.
 *
 * [S1.9191 / khoản 223] Rổ miễn nay là LỜI KHAI: gói có `"trustprocure": { "testOnly": true }` trong `package.json` của nó, và chỉ dưới
 * `packages/`. Phép đếm của vế ⑵ không còn là nguồn của rổ miễn — nó xếp một gói KHÔNG AI IMPORT Ở MÃ SẢN XUẤT (một gói lá mới chưa nối
 * dây, như `packages/danh-gia` ở S1.104–S1.105) vào cùng rổ với gói chỉ test dùng, và vế ⑷ bỏ qua toàn bộ mã của gói ấy cho tới ngày có
 * người import — đúng lúc bốn vi phạm lộ ra cùng nhau. Lời khai được đo đối chiếu ở hai chiều: `khaiKhongKhop` đòi mỗi gói khai test-only
 * phải nằm trong rổ đo của vế ⑵ (khai để trốn vế ⑷ thì đỏ), `khaiSaiCho` đòi không app/tool nào mang lời khai ấy.
 */
function mienTruVe4(manifest: readonly Manifest[]): string[] {
  return manifest
    .filter((m) => m.chiDungChoTest && m.duongDan.startsWith("packages/"))
    .map((m) => m.ten)
    .sort();
}

/** App hay tool khai test-only: lá chạy lúc vận hành không thể chỉ dùng cho test — lời khai sai chỗ, không được tha im lặng. */
function khaiSaiCho(manifest: readonly Manifest[]): string[] {
  return manifest
    .filter((m) => m.chiDungChoTest && !m.duongDan.startsWith("packages/"))
    .map((m) => m.duongDan)
    .sort();
}

/** Gói khai test-only mà phép đếm của vế ⑵ KHÔNG xác nhận (có mã sản xuất import, hay không ai import). */
function khaiKhongKhop(daKhai: readonly string[], chiTestDo: readonly string[]): string[] {
  return daKhai.filter((ten) => !chiTestDo.includes(ten));
}

interface KetQuaVe4 {
  readonly daDoc: number;
  readonly soImport: number;
  /** Lá (`packages/x`, `apps/x`, `tools/x`) có ít nhất một tệp được đọc. */
  readonly laDaDoc: ReadonlySet<string>;
  readonly viPham: readonly string[];
}

/**
 * Lõi của vế ⑷, nhận đầu vào để đo được trên gói giả: mỗi tệp mã sản xuất của một gói KHÔNG trong rổ miễn được đọc, và mỗi import
 * `@trustprocure/*` lúc chạy của nó phải có ở `dependencies` của chính gói.
 */
function kiemVe4(manifest: readonly Manifest[], mien: readonly string[], cacTep: readonly string[], doc: (t: string) => string): KetQuaVe4 {
  const theoThuMuc = new Map(
    manifest.filter((m) => m.duongDan !== "package.json").map((m) => [m.duongDan.replace(/\/package\.json$/u, ""), m]),
  );
  let daDoc = 0;
  let soImport = 0;
  const viPham: string[] = [];
  const laDaDoc = new Set<string>();
  for (const t of cacTep) {
    const la = t.split("/").slice(0, 2).join("/");
    const m = theoThuMuc.get(la);
    if (m === undefined || mien.includes(m.ten)) continue;
    daDoc += 1;
    laDaDoc.add(la);
    for (const ten of importLucChay(doc(t))) {
      soImport += 1;
      if (ten === m.ten || Object.hasOwn(m.dependencies, ten)) continue;
      viPham.push(
        `${t}: import "${ten}" lúc chạy mà ${m.duongDan} không khai nó ở \`dependencies\`` +
          (Object.hasOwn(m.devDependencies, ten) ? " (đang ở devDependencies)" : ""),
      );
    }
  }
  return { daDoc, soImport, laDaDoc, viPham };
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

  it("[S1.72 / khoản 121] phép đọc import lúc chạy: nhiều dòng, `export * from`, import trần và động được tính; `import type`, `export type` không tính — [lượt soi 67a-1] ngoặc chỉ mang kiểu nội tuyến VẪN tính, vì câu import còn lại và gói vẫn được nạp", () => {
    expect(importLucChay('import { a,\n  b } from "@trustprocure/x";')).toEqual(["@trustprocure/x"]);
    expect(importLucChay('import { type A, b } from "@trustprocure/x/sub";')).toEqual(["@trustprocure/x"]);
    expect(
      importLucChay('export * from "@trustprocure/y";\nimport "@trustprocure/z";\nconst m = await import("@trustprocure/w");'),
    ).toEqual(["@trustprocure/w", "@trustprocure/y", "@trustprocure/z"]);
    expect(
      importLucChay('import type { A } from "@trustprocure/x";\nexport type { B } from "@trustprocure/y";\n// import { e } from "@trustprocure/q";'),
    ).toEqual([]);
    // [S1.72 / lượt soi 67a-1] Đo (§S1.72, `node --experimental-transform-types`, cách `apps/api` chạy): `import { type A } from "./x.ts"` ⇒ `x.ts` chạy.
    expect(importLucChay('import { type C, type D } from "@trustprocure/z";')).toEqual(["@trustprocure/z"]);
  });

  it("[S1.72 / lượt soi 67c-7] phép đọc import lúc chạy đọc cây cú pháp: `;` trong chú thích giữa ngoặc, tên mặc định mang tên `type`, `import x = require(…)` và câu import không đứng đầu dòng đều được tính; `import type x = require(…)`, `export type * from` không tính", () => {
    expect(importLucChay('import {\n  a, // ghi chu; co dau cham phay\n  b,\n} from "@trustprocure/q";')).toEqual(["@trustprocure/q"]);
    expect(importLucChay('import type from "@trustprocure/r";')).toEqual(["@trustprocure/r"]);
    expect(importLucChay('import s = require("@trustprocure/s");')).toEqual(["@trustprocure/s"]);
    expect(importLucChay('const a = 1; import { t } from "@trustprocure/t";')).toEqual(["@trustprocure/t"]);
    expect(importLucChay('import type u = require("@trustprocure/u");\nexport type * from "@trustprocure/v";')).toEqual([]);
  });

  it("[S1.72 / lượt soi 67a-2, 67c-5] [S1.9191 / khoản 223] rổ miễn của vế ⑷ chỉ nhận lời khai của gói dưới `packages/`: app hay tool khai test-only là khai sai chỗ; kho hôm nay chỉ `test-support` khai", () => {
    const gia = (duongDan: string): Manifest => ({
      duongDan,
      ten: `@trustprocure/${duongDan.split("/")[1]!}`,
      dependencies: {},
      devDependencies: {},
      chiDungChoTest: true,
    });
    const manifestGia = [gia("packages/ho-tro-gia/package.json"), gia("apps/app-gia/package.json"), gia("tools/tool-gia/package.json")];
    expect(mienTruVe4(manifestGia)).toEqual(["@trustprocure/ho-tro-gia"]);
    expect(khaiSaiCho(manifestGia)).toEqual(["apps/app-gia/package.json", "tools/tool-gia/package.json"]);
    expect(manifest.filter((m) => m.duongDan.startsWith("apps/")).length, "chống rỗng ruột: không đọc được manifest nào dưới apps/").toBeGreaterThanOrEqual(3);
    expect(manifest.filter((m) => m.duongDan.startsWith("tools/")).length, "chống rỗng ruột: không đọc được manifest nào dưới tools/").toBeGreaterThanOrEqual(3);
    expect(khaiSaiCho(manifest)).toEqual([]);
    expect(mienTruVe4(manifest)).toEqual(["@trustprocure/test-support"]);
  });

  it("[S1.9191 / khoản 223] gói khai test-only phải được phép đếm của vế ⑵ xác nhận — khai để trốn vế ⑷ thì đỏ", () => {
    const chiTest = goiChiDungChoTest(tenWorkspace);
    expect(khaiKhongKhop(mienTruVe4(manifest), chiTest)).toEqual([]);
    // Gói có mã sản xuất import nó, hay không ai import: khai test-only đều không đứng được.
    expect(khaiKhongKhop(["@trustprocure/db", "@trustprocure/goi-la-gia"], chiTest)).toEqual(["@trustprocure/db", "@trustprocure/goi-la-gia"]);
  });

  it("[S1.72 / khoản 121] gói workspace mà mã sản xuất import LÚC CHẠY phải nằm ở `dependencies` của chính gói — [S1.9191 / khoản 223] MỌI gói được đọc, chỉ gói tự khai test-only dưới `packages/` được miễn; mỗi lá có mã sản xuất phải có tệp được đọc", () => {
    const mien = mienTruVe4(manifest);
    expect(mien, "chống rỗng ruột: rổ miễn phải có gói tự khai (test-support)").not.toEqual([]);
    const cacTep = tepGit("*.ts").filter((t) => /^(?:packages|apps|tools)\/[^/]+\/src\/.+\.ts$/u.test(t) && !laTepTest(t));
    const { daDoc, soImport, laDaDoc, viPham } = kiemVe4(manifest, mien, cacTep, docTepGoc);
    expect(daDoc, "chống rỗng ruột: không đọc được tệp mã sản xuất nào").toBeGreaterThan(50);
    expect(soImport, "chống rỗng ruột: không thấy import @trustprocure/* lúc chạy nào").toBeGreaterThan(20);
    // [S1.72 / lượt soi 67a-2, 67c-5] Chống rỗng ruột theo từng lá — [S1.9191] nay cả gói: mất cả một lá khỏi phép đọc không làm hai chốt trên đỏ.
    const laCoMa = [...new Set(cacTep.map((t) => t.split("/").slice(0, 2).join("/")))].sort();
    expect(laCoMa.filter((a) => a.startsWith("packages/")).length, "chống rỗng ruột: không thấy mã sản xuất nào dưới packages/").toBeGreaterThanOrEqual(10);
    expect(laCoMa.filter((a) => a.startsWith("apps/")).length, "chống rỗng ruột: không thấy mã sản xuất nào dưới apps/").toBeGreaterThanOrEqual(3);
    expect(laCoMa.filter((a) => a.startsWith("tools/")).length, "chống rỗng ruột: không thấy mã sản xuất nào dưới tools/").toBeGreaterThanOrEqual(3);
    const duongDanMien = new Set(manifest.filter((m) => mien.includes(m.ten)).map((m) => m.duongDan.replace(/\/package\.json$/u, "")));
    expect(
      laCoMa.filter((a) => !laDaDoc.has(a) && !duongDanMien.has(a)),
      "một gói, app hay tool có mã sản xuất mà vế ⑷ không đọc tệp nào của nó",
    ).toEqual([]);
    expect(viPham).toEqual([]);
  });

  it("[S1.9191 / khoản 223] đỏ: gói lá KHÔNG AI IMPORT ở mã sản xuất mà thiếu khai phụ thuộc lúc chạy — phép đếm của vế ⑵ (rổ miễn cũ) tha nó, rổ miễn theo lời khai thì không", () => {
    const la: Manifest = {
      duongDan: "packages/goi-la-gia/package.json",
      ten: "@trustprocure/goi-la-gia",
      dependencies: {},
      devDependencies: {},
      chiDungChoTest: false,
    };
    const tep = ["packages/goi-la-gia/src/index.ts", "tests/goi-la-gia.test.ts"];
    const doc = (t: string): string =>
      t.endsWith(".test.ts") ? 'import { x } from "@trustprocure/goi-la-gia";\nx();\n' : 'import { ghiSo } from "@trustprocure/audit";\nexport const x = ghiSo;\n';
    // Đo trước: với phép đếm của vế ⑵, gói này là "chỉ dùng cho test" (một tệp test nhắc tên, không mã sản xuất nào import) — rổ miễn
    // cũ tha nó, và vế ⑷ đọc 0 tệp.
    const roMienCu = goiChiDungChoTest([la.ten], tep, doc);
    expect(roMienCu).toEqual([la.ten]);
    expect(kiemVe4([la], roMienCu, tep, doc)).toMatchObject({ daDoc: 0, viPham: [] });
    // Sau: rổ miễn theo lời khai — gói không khai gì thì bị đọc, và import không khai đỏ.
    expect(kiemVe4([la], mienTruVe4([la]), tep, doc)).toMatchObject({
      daDoc: 1,
      soImport: 1,
      viPham: ['packages/goi-la-gia/src/index.ts: import "@trustprocure/audit" lúc chạy mà packages/goi-la-gia/package.json không khai nó ở `dependencies`'],
    });
    // Khai đúng thì xanh; khai ở devDependencies thì đỏ và nói rõ.
    expect(kiemVe4([{ ...la, dependencies: { "@trustprocure/audit": "workspace:*" } }], [], tep, doc).viPham).toEqual([]);
    expect(kiemVe4([{ ...la, devDependencies: { "@trustprocure/audit": "workspace:*" } }], [], tep, doc).viPham[0]).toMatch(/\(đang ở devDependencies\)$/u);
  });
});
