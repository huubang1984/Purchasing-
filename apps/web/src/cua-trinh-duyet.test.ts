// ==============================================================================================
// [ADR-044] CỬA TRÌNH DUYỆT PHẢI NẠP ĐƯỢC VÀO MỘT TRANG WEB — ĐO BẰNG CÂY IMPORT THẬT
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// `apps/web` phục vụ `packages/sealed-envelope/src/browser.ts` và hai tệp trong cây phụ thuộc của
// nó cho trình duyệt. Không một lớp nào ngăn ai đó, ba tháng nữa, thêm một dòng
// `import pg from "pg"` vào `format.ts` để tiện một việc ở phía máy chủ. Hậu quả không phải một
// test đỏ: hậu quả là **trang nộp thầu trắng màn hình ở nhà cung cấp**, và nó chỉ lộ ra khi có
// người mở trang thật. Mọi test máy chủ vẫn xanh, vì trên máy chủ `pg` nạp được.
//
// Cùng lớp lỗi với "một bảo đảm chỉ đúng trên MỘT hệ điều hành" (Handoff §7): thứ hỏng nằm ở một
// môi trường mà không lượt chạy nào của CI đi qua.
//
// ----------------------------------------------------------------------------------------------
// PHÉP ĐO — BA TÍNH CHẤT, ĐỌC CÂY CÚ PHÁP CHỨ KHÔNG ĐỌC MỘT DANH SÁCH TÊN
// ----------------------------------------------------------------------------------------------
//   ⑴ Đóng bắc cầu: đi từ `browser.ts` theo mọi `import`/`export … from`, tập tệp tới được phải
//      TRÙNG KHỚP `MODULE_TRINH_DUYET` của `apps/web`. Thừa hay thiếu đều đỏ — thiếu thì trang
//      gãy ở `import`, thừa thì máy chủ phục vụ một tệp không ai cần.
//   ⑵ Không tệp nào trong cây mang một import GIÁ TRỊ tới `node:*`, tới `pg`, hay tới một gói
//      `@trustprocure/*` khác. `import type` thì được: `verbatimModuleSyntax` xoá nó lúc biên
//      dịch, và `format.ts` dựa đúng vào tính chất ấy để mượn kiểu WebCrypto của Node.
//   ⑶ Sau khi gỡ kiểu bằng CHÍNH bộ gỡ mà máy chủ dùng, mã ra không còn một chuỗi `node:` nào ở
//      vị trí specifier. Đây là vế kiểm ĐẦU RA, không kiểm ý định — nó bắt được cả trường hợp cú
//      pháp lọt qua ⑵ vì một dạng viết mà bộ đọc cây chưa nghĩ tới.
//
// Vì sao ⑵ và ⑶ cùng tồn tại: ⑵ đọc Ý ĐỊNH của mã nguồn và cho thông điệp lỗi chỉ đúng tệp; ⑶ đọc
// THỨ TRÌNH DUYỆT NHẬN. Một trong hai vế một mình đều để lọt đúng một nửa của lớp lỗi này.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MODULE_TRINH_DUYET } from "./phuc-vu.js";

const GOC = new URL("../../../packages/sealed-envelope/src/", import.meta.url);

function docNguon(ten: string): string {
  return readFileSync(new URL(`${ten}.ts`, GOC), "utf8");
}

interface Canh {
  readonly specifier: string;
  readonly chiKieu: boolean;
}

/** Mọi `import`/`export … from` của một tệp, kèm cờ "chỉ là kiểu". */
function cacCanh(nguon: string, ten: string): readonly Canh[] {
  const sf = ts.createSourceFile(`${ten}.ts`, nguon, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const ra: Canh[] = [];
  for (const n of sf.statements) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const chiKieu =
        n.importClause?.isTypeOnly === true ||
        (n.importClause?.namedBindings !== undefined &&
          ts.isNamedImports(n.importClause.namedBindings) &&
          n.importClause.namedBindings.elements.length > 0 &&
          n.importClause.namedBindings.elements.every((e) => e.isTypeOnly));
      ra.push({ specifier: n.moduleSpecifier.text, chiKieu });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      const chiKieu =
        n.isTypeOnly ||
        (n.exportClause !== undefined &&
          ts.isNamedExports(n.exportClause) &&
          n.exportClause.elements.length > 0 &&
          n.exportClause.elements.every((e) => e.isTypeOnly));
      ra.push({ specifier: n.moduleSpecifier.text, chiKieu });
    }
  }
  return ra;
}

const LA_TUONG_DOI = (s: string): boolean => s.startsWith("./") || s.startsWith("../");
const TEN_TU_SPECIFIER = (s: string): string => s.replace(/^\.\//, "").replace(/\.js$/, "");

/** Đóng bắc cầu từ `browser.ts` theo các cạnh TƯƠNG ĐỐI (cạnh ngoài gói được vế ⑵ phán xét). */
function dongBacCau(): { readonly tep: ReadonlySet<string>; readonly canhNgoai: ReadonlyMap<string, readonly Canh[]> } {
  const tep = new Set<string>();
  const canhNgoai = new Map<string, readonly Canh[]>();
  const hangDoi = ["browser"];
  while (hangDoi.length > 0) {
    const ten = hangDoi.pop() ?? "";
    if (tep.has(ten)) continue;
    tep.add(ten);
    const canh = cacCanh(docNguon(ten), ten);
    canhNgoai.set(ten, canh.filter((c) => !LA_TUONG_DOI(c.specifier)));
    for (const c of canh) {
      if (LA_TUONG_DOI(c.specifier)) hangDoi.push(TEN_TU_SPECIFIER(c.specifier));
    }
  }
  return { tep, canhNgoai };
}

describe("[ADR-044] cửa trình duyệt của sealed-envelope", () => {
  it("⑴ đóng bắc cầu của browser.ts trùng khớp MODULE_TRINH_DUYET mà apps/web khai", () => {
    const { tep } = dongBacCau();
    expect([...tep].sort()).toEqual([...MODULE_TRINH_DUYET].sort());
  });

  it("⑵ không tệp nào trong cây mang import GIÁ TRỊ tới node:*, pg, hay một gói workspace khác", () => {
    const { canhNgoai } = dongBacCau();
    const viPham: string[] = [];
    for (const [ten, canh] of canhNgoai) {
      for (const c of canh) {
        if (c.chiKieu) continue;
        viPham.push(`${ten}.ts import giá trị từ "${c.specifier}"`);
      }
    }
    expect(viPham).toEqual([]);
  });

  it("⑶ mã đã gỡ kiểu — đúng thứ trình duyệt nhận — không còn specifier node: nào", () => {
    for (const ten of MODULE_TRINH_DUYET) {
      const js = stripTypeScriptTypes(docNguon(ten), { mode: "transform", sourceUrl: `/lib/${ten}.js` });
      // Không quét cả tệp: chữ "node:" xuất hiện hợp lệ trong chú thích và chuỗi. Chỉ quét ĐÚNG
      // vị trí specifier của một câu import/export còn sống sau khi gỡ kiểu.
      const conLai = [...js.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+["']([^"']+)["']/gu)].map((m) => m[1] ?? "");
      expect(conLai.filter((s) => s.startsWith("node:") || !s.startsWith(".")), `${ten}.js`).toEqual([]);
    }
  });

  it("⑵b đối chứng: một tệp CÓ import giá trị từ node:* thì vế ⑵ phải bắt được", () => {
    // Đột biến trên VĂN BẢN, không ghi ra đĩa — cùng kỷ luật với `[INV-H20]`.
    const gia = 'import { randomUUID } from "node:crypto";\nexport const x = randomUUID;\n';
    const canh = cacCanh(gia, "gia").filter((c) => !LA_TUONG_DOI(c.specifier) && !c.chiKieu);
    expect(canh.map((c) => c.specifier)).toEqual(["node:crypto"]);
  });

  it("⑵c đối chứng: `import type` KHÔNG bị tính là import giá trị — đó là cách format.ts mượn kiểu WebCrypto", () => {
    const that = 'import type { webcrypto } from "node:crypto";\nexport type A = webcrypto.CryptoKey;\n';
    const canh = cacCanh(that, "that").filter((c) => !LA_TUONG_DOI(c.specifier) && !c.chiKieu);
    expect(canh).toEqual([]);
    // Và vế thật phải đứng trên chính tệp thật: `format.ts` CÓ dòng ấy, và nó vẫn đi qua vế ⑵.
    expect(docNguon("format")).toContain('import type { webcrypto } from "node:crypto";');
  });
});

/** Đường tuyệt đối của gói, để thông điệp lỗi của một lượt chạy CI trỏ đúng chỗ. */
export const DUONG_GOI_NIEM_PHONG = fileURLToPath(GOC);
