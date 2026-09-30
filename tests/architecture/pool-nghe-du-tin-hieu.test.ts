// ==============================================================================================
// [S1.84 / khoản 129 và khoản 173] MỌI POOL DỰNG TRONG `apps/` ~~PHẢI~~ **[S1.227 / khoản 180] VÀ `tools/`** PHẢI NGHE
// ĐỦ HAI TÍN HIỆU MẤT-KHÔNG-AI-BIẾT.
//
// Hai tín hiệu ấy có chung một tính chất: chúng KHÔNG được ném cho ai, nên nếu không có người
// nghe thì chúng biến mất hoàn toàn.
//   ⑴ `release` mang `TenantError` mã `SESSION_STATE_LEFT` — `withTenant` huỷ một kết nối vì
//      trạng thái phiên còn sót sau giao dịch (khoản 118).
//   ⑵ sự kiện `SU_KIEN_LOI_KET_NOI_TOI_MUON` — lần lấy kết nối tới SAU trần `maxConnectWaitMs`,
//      người gọi đã nhận `CONNECT_WAIT_EXCEEDED` và đi (khoản 129).
//
// VÌ SAO CỔNG NÀY TỒN TẠI, và nó là cái giá chủ dự án chọn trả ngày 2026-09-19 (ADR-041): hình
// dạng "sự kiện trên pool" không đổi một chỗ gọi nào, nhưng nó dựa vào một lớp GẮN BẰNG TAY ở
// composition root — và lớp ấy ĐÃ bị quên một lần. Khoản 173 đo được: tới S1.83,
// `apps/api/src/composition.ts` gắn ⑴ cho cả hai pool còn `apps/unseal-worker` không gắn lần nào,
// nên cùng một sự cố để lại dấu ở `api` và không để lại gì ở tiến trình DUY NHẤT giải mã được
// phong bì. Một lớp quên được mà không ai biết thì không phải một lớp. Và nó bị quên LẦN THỨ HAI
// ở ngoài tầm quét: tới S1.87, `tools/neo-so-kiem-toan` dựng hai pool đi qua `withTenant` mà
// không gắn gì (khoản 180) — vòng S1.227 nới tầm quét và gắn.
//
// PHÉP ĐỌC LÀ CÂY CÚ PHÁP CÓ BINDER, không phải biểu thức chính quy: một chuỗi trong chú thích
// hay một tên biến trùng chữ không được tính là một lời gọi, và hai biến cùng tên ở hai hàm là
// hai pool. Cùng kỷ luật với `ghi-so-tu-choi-mot-duong.test.ts`; phần binder là chương trình
// TypeScript MỘT TỆP (`noResolve`, `noLib`): mỗi tên được phân giải về đúng khai báo của nó trong
// tệp, import được phân giải về (gói, tên xuất) nên bí danh không che được gì — nhưng không đi
// theo import ra ngoài tệp (đó là ranh giới ⑴ dưới đây).
//
// ~~BA RANH GIỚI~~ [S1.238 / khoản 274] BỐN RANH GIỚI, nói ra — một cổng im lặng bỏ qua một vùng mã là một cổng nói dối về phạm vi của
// chính nó (khoản 176; bản đầu của khối này viết ĐÚNG MỘT trong ba, lượt soi ngang 74 đo ra):
//   ⑴ PHÉP ĐỌC GÓI TRONG MỘT TỆP. Pool và người nghe phải cùng tệp. Người nghe được tính: `<pool>.on("release", …)`
//      viết thẳng; `ngheLoiKetNoiToiMuon(<pool>, …)` import từ `@trustprocure/tenancy` (bí danh vẫn thấy); hai hàm bọc
//      `ghiLogKetNoiHuy` / `ghiLogLoiKetNoiToiMuon` CHỈ khi import từ `./mo-ta-loi.js` (composition root của `api`) —
//      thân hai hàm ấy không được đọc, cổng TIN chúng theo đường import. [S1.221 / khoản 183] Cổng này chỉ đo SỰ CÓ MẶT của
//      lời gọi gắn [S1.238 / khoản 274] (và CHỖ của nó — ranh giới ⑷); THÂN của bốn bộ nghe (hai hàm bọc của `api`, `ghiKetNoiHuy`/`ghiLoiToiMuon` của worker) đo bằng hành vi trên
//      pool thật ở `apps/api/src/loi-ket-noi-toi-muon.int.test.ts` và `apps/unseal-worker/src/loi-ket-noi-toi-muon.int.test.ts` —
//      không thì một thân no-op vẫn qua cổng. Một pool dựng ở tệp này rồi truyền sang tệp khác
//      để gắn listener bị tính là THIẾU — và lời giải đúng là gắn ở tệp dựng pool (`tools/khoi-tao-to-chuc/src/index.ts`
//      làm thế: pool đi qua `withTenant` ở `khoi-tao.ts`, listener gắn ở `index.ts`), không phải nới phép đọc. Bản đầu của
//      khối gắn listener ở worker viết bằng một vòng lặp và cổng ĐỎ vì phép đọc theo TÊN không thấy biến vòng lặp; với
//      binder, một vòng lặp `for (const p of [pool, auditPool]) p.on(…)` VẪN đỏ — `p` là một biến khác — và đó là chủ ý:
//      mỗi pool một dòng gắn, đọc được bằng mắt.
//   ⑵ THƯ MỤC: `git ls-files -- "apps/**/*.ts" "tools/**/*.ts"`, bỏ test và `.d.ts`. `packages/` đứng ngoài tầm — hôm nay
//      ở đó có đúng ba chỗ dựng pool: `packages/db/src/pool.ts` (chính `createPool`, không có gì để nghe) và hai pool của
//      `packages/test-support/src/postgres.ts` (hạ tầng test; ⑴ phát trên chúng khi mã được test để sót trạng thái phiên,
//      và không test nào đỏ vì thế — khoản 281). Tệp chưa `git add` không được quét — `git ls-files` là chủ ý để tệp dò tạm
//      không lọt vào.
//   ⑶ HÌNH DẠNG NHẬN DIỆN: một pool là `createPool(…)` của `@trustprocure/db` (tên trần, bí danh, hay qua `import * as`) hoặc
//      `new Pool(…)` của `pg` (`import pg from`, `import * as`, `import { Pool as … }`) — phân giải theo import, không theo
//      chữ. Nó được gán vào một biến, một thuộc tính lớp (`private readonly q = new pg.Pool(…)` hay `this.q = …`), hoặc
//      KHÔNG gán vào đâu (trả về thẳng, truyền làm đối số): pool không tên mang tên `<khong-ten:dòng>` và phải có một dòng
//      `NGOAI_LE` cho nó — fail-closed, không vô hình. Tên pool là `<hàm, phương thức hay lớp lồng nhau>.<biến>`, nên ba
//      `const pool` ở ba hàm của `tools/neo-so-kiem-toan/src/index.ts` là ba pool, và `NGOAI_LE` trỏ được đúng một. Không
//      thấy: pool lấy từ một hàm TỰ VIẾT ở tệp khác (`layPool()`) — chỗ dựng của nó nằm ở tệp kia và bị tính ở đó là pool
//      không tên; `import x = require("pg")` (cấm bởi `verbatimModuleSyntax` + ESM).
//   ⑷ [S1.238 / khoản 274] CHỖ GẮN: một lời gọi gắn chỉ được TÍNH khi nó là một CÂU LỆNH RIÊNG (`<pool>.on("release", …);`,
//      `ngheLoiKetNoiToiMuon(<pool>, …);`, hàm bọc của `api`) đứng trong CÙNG danh sách câu lệnh với câu lệnh dựng pool, SAU nó, và
//      không câu lệnh nào ở giữa có lối ra (`return`, `throw`, `break`/`continue` ra khỏi câu ấy — lối ra trong hàm con không tính)
//      hay DÙNG pool (trừ chính các lời gọi gắn khác của nó — lượt soi đối kháng: một `for (;;) { await withTenant(pool, …) }` ở giữa
//      không có lối ra cú pháp mà lời gọi gắn sau nó là mã chết) — tức pool không chạy một bước nào trước khi được nghe, và lời gọi gắn
//      chạy mỗi lần dòng dựng chạy. Lồng trong `if`/`try`/vòng lặp/hàm con/khối trần, sau `return`/`throw`, nằm trong
//      một biểu thức (`c && nghe(pool)`), hay đứng trước dòng dựng ⇒ KHÔNG tính (`ganSaiCho` nói vì sao), và pool ấy hiện ở danh sách
//      thiếu. Đo trên cây cú pháp đã có binder, theo DÒNG DỰNG chứ không theo biến: gán lại cùng biến là một dòng dựng mới cần lời gọi
//      gắn của riêng nó; pool khai bằng khởi tạo trường lớp (`private q = new pg.Pool()`) không có khối câu lệnh nào ⇒ gán trong
//      constructor rồi gắn cùng khối. Trước S1.238 cổng nhận lời gọi gắn Ở BẤT KỲ ĐÂU trong tệp — `ghiLogLoiKetNoiToiMuon(pool, …)`
//      trong `if (false) {}` hay sau `return` vẫn qua (khoản 274, tách từ khoản 183). Không thấy: một câu lệnh ở giữa NÉM ngầm (một
//      lời gọi ném) thì lời gọi gắn không chạy — khi ấy tiến trình cũng không lên (hai composition root dựng pool đồng bộ, `main.ts`
//      bắt và thoát); `process.exit()` hay một hàm trả `never` ở giữa không phải lối ra cú pháp.
//
// `NGOAI_LE` CÓ RĂNG (khoản 182): mỗi dòng phải trỏ một pool có thật (tên theo phạm vi), có lý do, và pool ấy KHÔNG được
// truyền vào `withTenant` trong tệp — vì `withTenant` là nguồn phát DUY NHẤT của cả hai tín hiệu, nên "không đi qua
// withTenant" là lý do miễn duy nhất kiểm được. Các phép kiểm là hàm thuần, và đối chứng trong bộ nhớ dựng dòng miễn giả,
// tệp mẫu không nghe, tệp mẫu hai hàm cùng tên biến… rồi đòi từng phép kiểm ĐỎ — thay cho sàn `≥ 2` tệp của bản đầu, thứ
// đặt đúng bằng con số hôm nay và không bao giờ kêu.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** Tệp MÃ SẢN XUẤT của `apps/` và `tools/` — bỏ test, bỏ `.d.ts`. `git ls-files` chứ không `readdirSync`: tệp dò tạm không được tính. */
const TEP_QUET = git(["ls-files", "-z", "--", "apps/**/*.ts", "tools/**/*.ts"])
  .split("\0")
  .filter((d) => d !== "" && !d.endsWith(".d.ts") && !/\.(test|int\.test)\.ts$/u.test(d));

interface DongMien {
  readonly tep: string;
  /** Tên theo phạm vi — đúng chuỗi mà `HoSoPool.ten` in ra. */
  readonly pool: string;
  readonly lyDo: string;
}

/**
 * Chỗ được miễn, kèm LÝ DO — và lý do duy nhất kiểm được là "không đi qua `withTenant`" (vế `kiemNgoaiLe` đòi thế).
 * Mỗi dòng ứng với một pool có thật; một dòng chết là cổng đỏ.
 */
const NGOAI_LE: readonly DongMien[] = [
  {
    tep: "tools/neo-so-kiem-toan/src/index.ts",
    pool: "lietKeToChuc.pool",
    lyDo:
      "[ADR-072] pool của `lich` chạy đúng MỘT câu `pool.query(public.outbox_danh_sach_to_chuc())` để liệt kê tổ chức — " +
      "câu hỏi 'những tổ chức nào' đứng trước 'tổ chức nào' nên không gắn được tenant (khai ở " +
      "`duong-sql-ngoai-with-tenant.test.ts` vế ⒞). Không đi qua `withTenant` thì không có nguồn phát: ⑴ chỉ `withTenant` " +
      "huỷ bằng SESSION_STATE_LEFT, ⑵ chỉ `withTenant` có `maxConnectWaitMs`. Hai pool `xuat`/`kiem` cùng tệp thì nghe đủ.",
  },
  {
    tep: "tools/chay-migrate/src/index.ts",
    pool: "chay.pool",
    lyDo:
      "[ADR-066] pool DEPLOY của vai master RDS: `migrate()` rồi CREATE/ALTER ROLE trên một client mượn thẳng; " +
      "`@trustprocure/db` không phụ thuộc `tenancy` và tool không import `withTenant`, nên hai tín hiệu không có nguồn phát.",
  },
  {
    tep: "tools/pilot-gia-lap/src/csdl.ts",
    pool: "CsdlDacQuyen.mo.pool",
    lyDo:
      "[ADR-101] pool đặc quyền của pilot giả lập: mọi câu đi qua `cau` (`pool.query`) và `migrate()`; `tools/pilot-gia-lap` " +
      "không import `@trustprocure/tenancy` — không `withTenant`, không nguồn phát. Mọi bước nghiệp vụ đi qua HTTP của `apps/api`.",
  },
];

const GOI_DB = "@trustprocure/db";
const GOI_TENANCY = "@trustprocure/tenancy";
const GOI_PG = "pg";
/** Hai hàm bọc của composition root `api` — được TIN theo đường import (ranh giới ⑴), không đọc thân. */
const TEP_HAM_BOC_API = "./mo-ta-loi.js";
const HAM_BOC_NGHE_RELEASE = "ghiLogKetNoiHuy";
const HAM_BOC_NGHE_TOI_MUON = "ghiLogLoiKetNoiToiMuon";

interface HoSoPool {
  /** Tên theo phạm vi: `<hàm, phương thức hay lớp lồng nhau>.<biến>`; pool không gán vào tên nào mang `<khong-ten:dòng>`. */
  readonly ten: string;
  ngheRelease: boolean;
  ngheToiMuon: boolean;
  /** Pool là đối số đầu của một lời gọi `withTenant` (import từ tenancy) trong tệp — nguồn phát của cả hai tín hiệu. */
  quaWithTenant: boolean;
}

interface HoSoTep {
  readonly tep: string;
  readonly pool: readonly HoSoPool[];
  /** Số lỗi cú pháp — một tệp không đọc trọn được thì cổng phải kêu chứ không im. */
  readonly loiCuPhap: number;
  /**
   * [S1.238 / khoản 274] Lời gọi gắn trỏ đúng một pool nhưng KHÔNG được tính vì sai chỗ (ranh giới ⑷) — `<dòng> <pool>: <tín hiệu> —
   * <vì sao>`. Chỉ để chẩn đoán: pool ấy vẫn hiện ở danh sách thiếu nếu không lời gọi nào khác tính cho nó.
   */
  readonly ganSaiCho: readonly string[];
}

/** [S1.238 / khoản 274] Một DÒNG DỰNG pool: mỗi dòng cần lời gọi gắn của riêng nó (gán lại cùng biến là một dòng dựng khác). */
interface ChoDung {
  readonly dong: number;
  /** Câu lệnh chứa dòng dựng, con TRỰC TIẾP của một danh sách câu lệnh; `null` khi không có (khởi tạo trường lớp, thân `if` không ngoặc…). */
  readonly cau: ts.Statement | null;
  release: boolean;
  toiMuon: boolean;
}

/** Nguồn của một tên đã import: gói và tên xuất (bí danh đã bỏ); `default` cho import mặc định, `*` cho `import * as`. */
interface NguonImport {
  readonly goi: string;
  readonly ten: string;
}

function chuoiModule(e: ts.Expression): string {
  return ts.isStringLiteralLike(e) ? e.text : "";
}

function nguonImportCua(kyHieu: ts.Symbol | undefined): NguonImport | null {
  const d = kyHieu?.declarations?.[0];
  if (d === undefined) return null;
  if (ts.isImportSpecifier(d)) {
    const clause = d.parent.parent;
    if (d.isTypeOnly || clause.isTypeOnly) return null;
    return { goi: chuoiModule(clause.parent.moduleSpecifier), ten: (d.propertyName ?? d.name).text };
  }
  if (ts.isNamespaceImport(d)) {
    return d.parent.isTypeOnly ? null : { goi: chuoiModule(d.parent.parent.moduleSpecifier), ten: "*" };
  }
  if (ts.isImportClause(d)) {
    return d.isTypeOnly ? null : { goi: chuoiModule(d.parent.moduleSpecifier), ten: "default" };
  }
  return null;
}

function laNguon(ng: NguonImport | null, goi: string, ten: string): boolean {
  return ng !== null && ng.goi === goi && ng.ten === ten;
}

/** Ranh giới ⑶: `createPool(…)` của `@trustprocure/db` hay `new Pool(…)` của `pg`, phân giải theo import. */
function laDungPool(n: ts.CallExpression | ts.NewExpression, ch: ts.TypeChecker): boolean {
  const goi = n.expression;
  if (ts.isCallExpression(n)) {
    if (ts.isIdentifier(goi)) return laNguon(nguonImportCua(ch.getSymbolAtLocation(goi)), GOI_DB, "createPool");
    if (ts.isPropertyAccessExpression(goi) && ts.isIdentifier(goi.expression) && goi.name.text === "createPool") {
      return laNguon(nguonImportCua(ch.getSymbolAtLocation(goi.expression)), GOI_DB, "*");
    }
    return false;
  }
  if (ts.isIdentifier(goi)) return laNguon(nguonImportCua(ch.getSymbolAtLocation(goi)), GOI_PG, "Pool");
  if (ts.isPropertyAccessExpression(goi) && ts.isIdentifier(goi.expression) && goi.name.text === "Pool") {
    const ng = nguonImportCua(ch.getSymbolAtLocation(goi.expression));
    return laNguon(ng, GOI_PG, "default") || laNguon(ng, GOI_PG, "*");
  }
  return false;
}

/** Ký hiệu của một biểu thức trỏ pool: tên trần, hay `this.<thuộc tính>`. */
function kyHieuCuaBieuThuc(e: ts.Expression, ch: ts.TypeChecker): ts.Symbol | undefined {
  if (ts.isIdentifier(e)) return ch.getSymbolAtLocation(e);
  if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword) return ch.getSymbolAtLocation(e.name);
  return undefined;
}

/** Nút mà giá trị của `n` được gán vào, đi lên xuyên `as`, `satisfies`, `!` và ngoặc. */
function kyHieuDuocGan(n: ts.Node, ch: ts.TypeChecker): ts.Symbol | undefined {
  let x: ts.Node = n;
  while (
    ts.isParenthesizedExpression(x.parent) ||
    ts.isAsExpression(x.parent) ||
    ts.isSatisfiesExpression(x.parent) ||
    ts.isNonNullExpression(x.parent)
  ) {
    x = x.parent;
  }
  const cha = x.parent;
  if ((ts.isVariableDeclaration(cha) || ts.isPropertyDeclaration(cha)) && ts.isIdentifier(cha.name)) return ch.getSymbolAtLocation(cha.name);
  if (ts.isBinaryExpression(cha) && cha.operatorToken.kind === ts.SyntaxKind.EqualsToken) return kyHieuCuaBieuThuc(cha.left, ch);
  return undefined;
}

/** `<hàm, phương thức hay lớp lồng nhau>` bao quanh `n`, ngoài vào trong; hàm gán vào biến (`const chay = async () => …`) lấy tên biến. */
function duongPhamVi(n: ts.Node): string {
  const ten: string[] = [];
  for (let x: ts.Node | undefined = n.parent; x !== undefined; x = x.parent) {
    if (ts.isFunctionDeclaration(x) || ts.isMethodDeclaration(x) || ts.isClassDeclaration(x)) {
      if (x.name !== undefined && ts.isIdentifier(x.name)) ten.unshift(x.name.text);
    } else if (ts.isConstructorDeclaration(x)) {
      ten.unshift("constructor");
    } else if ((ts.isFunctionExpression(x) || ts.isArrowFunction(x)) && ts.isVariableDeclaration(x.parent) && ts.isIdentifier(x.parent.name)) {
      ten.unshift(x.parent.name.text);
    }
  }
  return ten.join(".");
}

function ghepTen(duong: string, bien: string): string {
  return duong === "" ? bien : `${duong}.${bien}`;
}

/**
 * [S1.238 / khoản 274] Danh sách câu lệnh mà `cau` là con TRỰC TIẾP — thân khối, tệp, module, `case`/`default`; `undefined` khi cha của
 * nó không giữ một danh sách (thân `if`/vòng lặp không ngoặc, câu có nhãn).
 */
function danhSachCauLenh(cau: ts.Node): readonly ts.Statement[] | undefined {
  const cha = cau.parent;
  if (ts.isBlock(cha) || ts.isSourceFile(cha) || ts.isModuleBlock(cha) || ts.isCaseClause(cha) || ts.isDefaultClause(cha)) return cha.statements;
  return undefined;
}

/** [S1.238 / khoản 274] Câu lệnh chứa một biểu thức dựng pool: `const p = createPool(…);` hay `this.p = new pg.Pool(…);` — `null` khi khác. */
function cauLenhDung(n: ts.Node): ts.Statement | null {
  let x: ts.Node = n;
  while (ts.isParenthesizedExpression(x.parent) || ts.isAsExpression(x.parent) || ts.isSatisfiesExpression(x.parent) || ts.isNonNullExpression(x.parent)) {
    x = x.parent;
  }
  const cha = x.parent;
  if (ts.isVariableDeclaration(cha) && ts.isVariableDeclarationList(cha.parent) && ts.isVariableStatement(cha.parent.parent)) return cha.parent.parent;
  if (ts.isBinaryExpression(cha) && cha.operatorToken.kind === ts.SyntaxKind.EqualsToken && cha.right === x) {
    let y: ts.Node = cha;
    while (ts.isParenthesizedExpression(y.parent)) y = y.parent;
    if (ts.isExpressionStatement(y.parent)) return y.parent;
  }
  return null;
}

/**
 * [S1.238 / khoản 274] Nút đầu tiên trong `cau` (không vào hàm con hay lớp) chuyển điều khiển RA KHỎI `cau`: `return`, `throw`, và
 * `break`/`continue` mà đích của nó nằm ngoài `cau` (một `break` của vòng lặp con, hay tới một nhãn khai trong `cau`, thì không). `null`
 * khi không có. `throw` trong một `try` có `catch` ngay trong `cau` vẫn bị tính — fail-closed, lời giải là dời lời gọi gắn lên.
 */
function loiRaTrong(cau: ts.Statement): ts.Node | null {
  let ra: ts.Node | null = null;
  const duyet = (n: ts.Node, trongVong: boolean, trongSwitch: boolean, nhan: ReadonlySet<string>): void => {
    if (ra !== null || ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) {
      ra = n;
      return;
    }
    if (ts.isBreakStatement(n) && (n.label === undefined ? !(trongVong || trongSwitch) : !nhan.has(n.label.text))) {
      ra = n;
      return;
    }
    if (ts.isContinueStatement(n) && (n.label === undefined ? !trongVong : !nhan.has(n.label.text))) {
      ra = n;
      return;
    }
    const vong = trongVong || ts.isIterationStatement(n, false);
    const sw = trongSwitch || ts.isSwitchStatement(n);
    const nhanCon = ts.isLabeledStatement(n) ? new Set([...nhan, n.label.text]) : nhan;
    ts.forEachChild(n, (con) => {
      duyet(con, vong, sw, nhanCon);
    });
  };
  duyet(cau, false, false, new Set());
  return ra;
}

/** Tên theo phạm vi của một ký hiệu đã gán pool — thuộc tính khai ở tham số constructor lấy tên lớp, không lấy `constructor`. */
function tenTheoPhamVi(kh: ts.Symbol): string {
  const d = kh.declarations?.[0];
  if (d === undefined) return kh.name;
  const duong = duongPhamVi(d);
  return ghepTen(ts.isParameter(d) && ts.isConstructorDeclaration(d.parent) ? duong.replace(/\.constructor$/u, "") : duong, kh.name);
}

/** Đọc MỘT tệp từ văn bản — dùng cho tệp thật lẫn tệp mẫu trong bộ nhớ của đối chứng. */
function docVanBan(tep: string, vanBan: string): HoSoTep {
  const tuyChon: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(tuyChon, true);
  host.getSourceFile = (f, l) => (f === tep ? ts.createSourceFile(tep, vanBan, l, true, ts.ScriptKind.TS) : undefined);
  host.fileExists = (f) => f === tep;
  host.readFile = (f) => (f === tep ? vanBan : undefined);
  host.writeFile = () => undefined;
  const chuongTrinh = ts.createProgram({ rootNames: [tep], options: tuyChon, host });
  const ch = chuongTrinh.getTypeChecker();
  const cay = chuongTrinh.getSourceFile(tep);
  if (cay === undefined) throw new Error(`không dựng được cây cú pháp của ${tep}`);
  const loiCuPhap = chuongTrinh.getSyntacticDiagnostics(cay).length;

  const dongCua = (n: ts.Node): number => cay.getLineAndCharacterOfPosition(n.getStart(cay)).line + 1;

  // Lượt 1: chỗ DỰNG pool, khoá theo ký hiệu được gán; pool không tên đứng riêng.
  // [S1.238 / khoản 274] Và mỗi DÒNG DỰNG của một ký hiệu, cùng câu lệnh chứa nó — ranh giới ⑷ đo lời gọi gắn theo dòng dựng.
  const theoKyHieu = new Map<ts.Symbol, HoSoPool>();
  const choDungCua = new Map<ts.Symbol, ChoDung[]>();
  const khongTen: HoSoPool[] = [];
  const timDung = (n: ts.Node): void => {
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && laDungPool(n, ch)) {
      const kh = kyHieuDuocGan(n, ch);
      if (kh === undefined) {
        khongTen.push({ ten: ghepTen(duongPhamVi(n), `<khong-ten:${String(dongCua(n))}>`), ngheRelease: false, ngheToiMuon: false, quaWithTenant: false });
      } else {
        if (!theoKyHieu.has(kh)) theoKyHieu.set(kh, { ten: tenTheoPhamVi(kh), ngheRelease: false, ngheToiMuon: false, quaWithTenant: false });
        const cau = cauLenhDung(n);
        const ds = choDungCua.get(kh) ?? [];
        ds.push({ dong: dongCua(n), cau: cau !== null && danhSachCauLenh(cau) !== undefined ? cau : null, release: false, toiMuon: false });
        choDungCua.set(kh, ds);
      }
    }
    ts.forEachChild(n, timDung);
  };
  timDung(cay);

  /**
   * [S1.238 / khoản 274] Lời gọi GẮN cho một pool đã biết: `(ký hiệu pool, tín hiệu)`, hay `null`. Một chỗ nhận diện cho cả lượt 2 lẫn
   * phép kiểm "câu lệnh ở giữa là chính một lời gọi gắn của pool ấy".
   */
  const laLoiGoiGan = (n: ts.CallExpression): { readonly kh: ts.Symbol; readonly tinHieu: "release" | "toiMuon" } | null => {
    const goi = n.expression;
    const doiSoDau = n.arguments[0];
    if (doiSoDau === undefined) return null;
    if (ts.isIdentifier(goi)) {
      const kh = kyHieuCuaBieuThuc(doiSoDau, ch);
      if (kh === undefined || !theoKyHieu.has(kh)) return null;
      const ng = nguonImportCua(ch.getSymbolAtLocation(goi));
      if (laNguon(ng, TEP_HAM_BOC_API, HAM_BOC_NGHE_RELEASE)) return { kh, tinHieu: "release" };
      if (laNguon(ng, TEP_HAM_BOC_API, HAM_BOC_NGHE_TOI_MUON) || laNguon(ng, GOI_TENANCY, "ngheLoiKetNoiToiMuon")) return { kh, tinHieu: "toiMuon" };
      return null;
    }
    // `<pool>.on("release", …)` / `this.<pool>.on("release", …)` viết thẳng
    if (ts.isPropertyAccessExpression(goi) && goi.name.text === "on" && ts.isStringLiteralLike(doiSoDau) && doiSoDau.text === "release") {
      const kh = kyHieuCuaBieuThuc(goi.expression, ch);
      return kh !== undefined && theoKyHieu.has(kh) ? { kh, tinHieu: "release" } : null;
    }
    return null;
  };
  /** Câu lệnh `cau` là CHÍNH một lời gọi gắn của pool `kh` (một câu lệnh biểu thức, lời gọi đứng trần). */
  const laCauGanCua = (cau: ts.Statement, kh: ts.Symbol): boolean => {
    if (!ts.isExpressionStatement(cau)) return false;
    let e = cau.expression;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    return ts.isCallExpression(e) && laLoiGoiGan(e)?.kh === kh;
  };
  /** Nút đầu tiên trong `cau` (kể cả trong hàm con) trỏ ký hiệu `kh` — một lần DÙNG pool; `null` khi không có. */
  const dungKyHieu = (cau: ts.Node, kh: ts.Symbol): ts.Node | null => {
    let ra: ts.Node | null = null;
    const duyet = (n: ts.Node): void => {
      if (ra !== null) return;
      if (ts.isIdentifier(n) && ch.getSymbolAtLocation(n) === kh) {
        ra = n;
        return;
      }
      ts.forEachChild(n, duyet);
    };
    duyet(cau);
    return ra;
  };

  // [S1.238 / khoản 274] Ranh giới ⑷: lời gọi gắn chỉ được tính cho dòng dựng GẦN NHẤT phía trước nó trong CÙNG danh sách câu lệnh, khi
  // nó là một câu lệnh riêng và không câu lệnh nào ở giữa có lối ra — hay DÙNG pool trước khi nó được nghe (lượt soi đối kháng:
  // `for (;;) { await withTenant(pool, …) }` ở giữa không có lối ra cú pháp, lời gọi gắn sau nó là mã chết mà pool vẫn chạy không người
  // nghe). Trả `null` khi đã tính; không thì lý do (vào `ganSaiCho`).
  const ganSaiCho: string[] = [];
  const tinhGan = (kh: ts.Symbol, loiGoi: ts.CallExpression, tinHieu: "release" | "toiMuon"): void => {
    const cacCho = choDungCua.get(kh) ?? [];
    const lyDo = ((): string | null => {
      let x: ts.Node = loiGoi;
      while (ts.isParenthesizedExpression(x.parent)) x = x.parent;
      const cauGan = x.parent;
      if (!ts.isExpressionStatement(cauGan)) return "lời gọi gắn nằm TRONG một biểu thức, không đứng thành câu lệnh riêng";
      const ds = danhSachCauLenh(cauGan);
      if (ds === undefined) return "câu lệnh gắn không nằm trong một khối câu lệnh (thân `if`/vòng lặp không ngoặc, câu có nhãn)";
      const j = ds.indexOf(cauGan);
      let i = -1;
      let cho: ChoDung | undefined;
      for (const c of cacCho) {
        const k = c.cau === null ? -1 : ds.indexOf(c.cau);
        if (k !== -1 && k < j && k > i) {
          i = k;
          cho = c;
        }
      }
      const dongDung = cacCho.map((c) => String(c.dong)).join(", ");
      if (cho === undefined) {
        return cacCho.some((c) => c.cau !== null && ds.includes(c.cau))
          ? `đứng TRƯỚC dòng dựng pool (dòng ${dongDung})`
          : `không cùng khối câu lệnh với dòng dựng pool (dòng ${dongDung}) — lồng trong if/try/vòng lặp/hàm con, hay ở khối khác`;
      }
      for (let k = i + 1; k < j; k += 1) {
        const cau = ds[k]!;
        const ra = loiRaTrong(cau);
        if (ra !== null) return `sau một lối ra (${ts.SyntaxKind[ra.kind]} ở dòng ${String(dongCua(ra))}) nằm giữa dòng dựng (dòng ${String(cho.dong)}) và lời gọi gắn`;
        const dung = laCauGanCua(cau, kh) ? null : dungKyHieu(cau, kh);
        if (dung !== null) return `pool được DÙNG ở dòng ${String(dongCua(dung))} trước lời gọi gắn — giữa dòng dựng (dòng ${String(cho.dong)}) và nó chỉ được có lời gọi gắn khác của chính pool ấy`;
      }
      cho[tinHieu] = true;
      return null;
    })();
    if (lyDo !== null) ganSaiCho.push(`${String(dongCua(loiGoi))} ${theoKyHieu.get(kh)?.ten ?? kh.name}: ${tinHieu} — ${lyDo}`);
  };

  // Lượt 2: người nghe và lời gọi `withTenant`, trỏ về pool qua ký hiệu của đối số.
  const timNghe = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const goi = n.expression;
      const doiSoDau = n.arguments[0];
      // ~~`p.ngheRelease = true` / `p.ngheToiMuon = true` theo sự có mặt~~ [S1.238 / khoản 274] tính theo dòng dựng (`tinhGan`).
      const gan = laLoiGoiGan(n);
      if (gan !== null) tinhGan(gan.kh, n, gan.tinHieu);
      if (ts.isIdentifier(goi) && doiSoDau !== undefined) {
        const kh = kyHieuCuaBieuThuc(doiSoDau, ch);
        const p = kh === undefined ? undefined : theoKyHieu.get(kh);
        if (p !== undefined && laNguon(nguonImportCua(ch.getSymbolAtLocation(goi)), GOI_TENANCY, "withTenant")) p.quaWithTenant = true;
      }
    }
    ts.forEachChild(n, timNghe);
  };
  timNghe(cay);

  // [S1.238 / khoản 274] Một pool nghe đủ một tín hiệu khi MỌI dòng dựng của nó có lời gọi gắn được tính.
  for (const [kh, p] of theoKyHieu) {
    const cacCho = choDungCua.get(kh) ?? [];
    p.ngheRelease = cacCho.length > 0 && cacCho.every((c) => c.release);
    p.ngheToiMuon = cacCho.length > 0 && cacCho.every((c) => c.toiMuon);
  }

  return { tep, pool: [...theoKyHieu.values(), ...khongTen], loiCuPhap, ganSaiCho };
}

function doc(tep: string): HoSoTep {
  return docVanBan(tep, readFileSync(join(GOC, tep), "utf8"));
}

// ---- Ba phép kiểm là hàm THUẦN trên hồ sơ và danh sách miễn — để đối chứng dựng đầu vào giả rồi đòi đỏ. ----

function duocMien(ngoaiLe: readonly DongMien[], tep: string, pool: string): boolean {
  return ngoaiLe.some((x) => x.tep === tep && x.pool === pool);
}

function timThieu(hoSo: readonly HoSoTep[], ngoaiLe: readonly DongMien[], tinHieu: "release" | "toiMuon"): string[] {
  return hoSo.flatMap((h) =>
    h.pool
      .filter((p) => !(tinHieu === "release" ? p.ngheRelease : p.ngheToiMuon) && !duocMien(ngoaiLe, h.tep, p.ten))
      .map((p) => `${h.tep}: ${p.ten}`),
  );
}

/** Mỗi dòng miễn: trỏ một pool có thật, có lý do, và pool ấy không đi qua `withTenant` trong tệp. */
function kiemNgoaiLe(ngoaiLe: readonly DongMien[], hoSo: readonly HoSoTep[]): string[] {
  const loi: string[] = [];
  for (const x of ngoaiLe) {
    const p = hoSo.find((h) => h.tep === x.tep)?.pool.find((q) => q.ten === x.pool);
    if (p === undefined) loi.push(`${x.tep}: ${x.pool} — không có pool nào tên ấy (dòng miễn chết)`);
    else if (p.quaWithTenant) loi.push(`${x.tep}: ${x.pool} — đi qua withTenant trong tệp, không được miễn`);
    if (x.lyDo.trim() === "") loi.push(`${x.tep}: ${x.pool} — thiếu lý do`);
  }
  return loi;
}

/** Tên theo phạm vi phải là duy nhất trong tệp — nếu không, một dòng `NGOAI_LE` trỏ hai pool. */
function tenTrung(hoSo: readonly HoSoTep[]): string[] {
  return hoSo.flatMap((h) => {
    const dem = new Map<string, number>();
    for (const p of h.pool) dem.set(p.ten, (dem.get(p.ten) ?? 0) + 1);
    return [...dem].filter(([, n]) => n > 1).map(([ten]) => `${h.tep}: ${ten}`);
  });
}

const HO_SO_TAT_CA = TEP_QUET.map(doc);
const HO_SO = HO_SO_TAT_CA.filter((h) => h.pool.length > 0);

// ---- Tệp mẫu trong bộ nhớ cho đối chứng. Tên tệp `mau.ts` không nằm trong kho. ----
const MAU = "mau.ts";

const MAU_KHONG_NGHE = [
  'import { createPool } from "@trustprocure/db";',
  'import { withTenant } from "@trustprocure/tenancy";',
  "export async function chay(url: string): Promise<void> {",
  '  const pool = createPool(url, 1, { role: "app_api" });',
  '  await withTenant(pool, "org", async () => undefined);',
  "}",
].join("\n");

const MAU_HINH_DANG = [
  'import pg from "pg";',
  'import * as ns from "pg";',
  'import { Pool as Ho } from "pg";',
  'import { createPool as taoHo } from "@trustprocure/db";',
  'export const oNgoai = taoHo("u", 1, { role: "app_api" });',
  'export function a(): void { const p1 = taoHo("u", 1, { role: "app_api" }) as pg.Pool; void p1; }',
  "export class B {",
  "  private readonly q = new ns.Pool({});",
  "  r: pg.Pool | undefined;",
  "  static mo(): B { const pool = new Ho({}); void pool; return new B(); }",
  "  dung(): void { this.r = new pg.Pool({}); }",
  "}",
  'export function tra(): pg.Pool { return taoHo("u", 1, { role: "app_api" }); }',
].join("\n");

const MAU_HAI_HAM = [
  'import { createPool } from "@trustprocure/db";',
  'import { ngheLoiKetNoiToiMuon as nghe } from "@trustprocure/tenancy";',
  "export function a(u: string): void {",
  '  const pool = createPool(u, 1, { role: "app_api" });',
  '  pool.on("release", () => undefined);',
  "  nghe(pool, () => undefined);",
  "}",
  'export function b(u: string): void { const pool = createPool(u, 1, { role: "app_api" }); void pool; }',
].join("\n");

/**
 * Pool là thuộc tính lớp, khai bằng khởi tạo trường, gắn trong một phương thức. ~~Nghe đủ.~~ [S1.238 / khoản 274] THIẾU: khởi tạo trường
 * không có khối câu lệnh nào để lời gọi gắn đứng cùng, và `nghe()` chỉ chạy khi có người gọi — đúng hình dạng "gắn mà có thể không chạy"
 * của hàng 274. Hình dạng đủ là gán trong constructor rồi gắn ngay cùng khối (`MAU_LOP_GAN_TRONG_CONSTRUCTOR`).
 */
const MAU_LOP_NGHE_DU = [
  'import pg from "pg";',
  'import { ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";',
  "export class C {",
  "  private readonly q = new pg.Pool({});",
  '  nghe(): void { this.q.on("release", () => undefined); ngheLoiKetNoiToiMuon(this.q, () => undefined); }',
  "}",
].join("\n");

const MAU_LOP_GAN_TRONG_CONSTRUCTOR = [
  'import pg from "pg";',
  'import { ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";',
  "export class C {",
  "  private readonly q: pg.Pool;",
  '  constructor() {\n    this.q = new pg.Pool({});\n    this.q.on("release", () => undefined);\n    ngheLoiKetNoiToiMuon(this.q, () => undefined);\n  }',
  "}",
].join("\n");

/** [S1.238 / khoản 274] Lời gọi gắn bị bỏ vì sai chỗ, in kèm thông điệp đỏ của hai vế thiếu — để lần đỏ nói vì sao. */
function ganSaiChoCua(hoSo: readonly HoSoTep[]): string {
  const ds = hoSo.flatMap((h) => h.ganSaiCho.map((g) => `${h.tep}:${g}`));
  return ds.length === 0 ? "" : `\nlời gọi gắn KHÔNG được tính (ranh giới ⑷):\n${ds.join("\n")}`;
}

/** Hai hàm bọc của `api`: chỉ được tin khi import từ `./mo-ta-loi.js`. */
function mauHamBoc(tuTep: string): string {
  return [
    'import { createPool } from "@trustprocure/db";',
    `import { ghiLogKetNoiHuy, ghiLogLoiKetNoiToiMuon } from "${tuTep}";`,
    'const pool = createPool("u", 1, { role: "app_api" });',
    'ghiLogKetNoiHuy(pool, "pool");',
    'ghiLogLoiKetNoiToiMuon(pool, "pool");',
  ].join("\n");
}

describe("[S1.84 → S1.227 / khoản 129, 173, 176, 180, 182] pool của apps/ và tools/ nghe đủ hai tín hiệu", () => {
  it("ĐỐI CHỨNG trong bộ nhớ: một tệp mẫu có pool đi qua withTenant mà không nghe gì ⇒ thiếu cả hai tín hiệu, và không miễn", () => {
    const hoSo = [docVanBan(MAU, MAU_KHONG_NGHE)];
    expect(hoSo[0]?.pool).toEqual([{ ten: "chay.pool", ngheRelease: false, ngheToiMuon: false, quaWithTenant: true }]);
    expect(timThieu(hoSo, [], "release")).toEqual(["mau.ts: chay.pool"]);
    expect(timThieu(hoSo, [], "toiMuon")).toEqual(["mau.ts: chay.pool"]);
    expect(timThieu(hoSo, NGOAI_LE, "release"), "NGOAI_LE thật không được miễn một tệp không tồn tại").toEqual(["mau.ts: chay.pool"]);
  });

  it("ĐỐI CHỨNG hình dạng (ranh giới ⑶): createPool dưới bí danh, new Pool của pg dưới ba kiểu import, thuộc tính lớp, pool không tên", () => {
    const hoSo = docVanBan(MAU, MAU_HINH_DANG);
    expect(hoSo.loiCuPhap).toBe(0);
    expect(hoSo.pool.map((p) => p.ten).sort()).toEqual(["B.mo.pool", "B.q", "B.r", "a.p1", "oNgoai", "tra.<khong-ten:13>"]);
    expect(timThieu([hoSo], [], "release")).toHaveLength(6);
    expect(
      timThieu([hoSo], [{ tep: MAU, pool: "tra.<khong-ten:13>", lyDo: "đối chứng" }], "release"),
      "pool không tên chỉ biến mất khỏi danh sách thiếu bằng một dòng miễn trỏ đúng tên nó",
    ).toHaveLength(5);
  });

  it("ĐỐI CHỨNG phạm vi: hai hàm cùng đặt tên `pool` là hai pool — hàm nghe đủ không che hàm không nghe; bí danh của ngheLoiKetNoiToiMuon vẫn thấy", () => {
    const hoSo = [docVanBan(MAU, MAU_HAI_HAM)];
    expect(timThieu(hoSo, [], "release")).toEqual(["mau.ts: b.pool"]);
    expect(timThieu(hoSo, [], "toiMuon")).toEqual(["mau.ts: b.pool"]);
  });

  it("ĐỐI CHỨNG: pool là thuộc tính lớp nghe qua `this.<pool>` thì đủ; hàm bọc của api chỉ được tin khi import từ ./mo-ta-loi.js", () => {
    // ~~`MAU_LOP_NGHE_DU`~~ [S1.238 / khoản 274] Khởi tạo trường + gắn trong phương thức nay THIẾU (ca riêng ở khối khoản 274); thuộc
    // tính lớp nghe qua `this.<pool>` vẫn đủ khi gán trong constructor và gắn cùng khối.
    const lop = [docVanBan(MAU, MAU_LOP_GAN_TRONG_CONSTRUCTOR)];
    expect(timThieu(lop, [], "release")).toEqual([]);
    expect(timThieu(lop, [], "toiMuon")).toEqual([]);
    const boc = [docVanBan(MAU, mauHamBoc(TEP_HAM_BOC_API))];
    expect(timThieu(boc, [], "release")).toEqual([]);
    expect(timThieu(boc, [], "toiMuon")).toEqual([]);
    const bocLa = [docVanBan(MAU, mauHamBoc("./khac.js"))];
    expect(timThieu(bocLa, [], "release"), "cùng tên hàm bọc nhưng import từ tệp khác thì không được tin").toEqual(["mau.ts: pool"]);
    expect(timThieu(bocLa, [], "toiMuon")).toEqual(["mau.ts: pool"]);
  });

  it("ĐỐI CHỨNG NGOAI_LE (khoản 182): dòng miễn giả trỏ pool không có ⇒ đỏ; thiếu lý do ⇒ đỏ; miễn một pool đi qua withTenant ⇒ đỏ", () => {
    const hoSo = [docVanBan(MAU, MAU_KHONG_NGHE), docVanBan(MAU.replace("mau", "hai"), MAU_HAI_HAM)];
    expect(kiemNgoaiLe([{ tep: MAU, pool: "khong.co", lyDo: "giả" }], hoSo)).toEqual(["mau.ts: khong.co — không có pool nào tên ấy (dòng miễn chết)"]);
    expect(kiemNgoaiLe([{ tep: "tep-khong-co.ts", pool: "chay.pool", lyDo: "giả" }], hoSo)).toHaveLength(1);
    expect(kiemNgoaiLe([{ tep: MAU, pool: "chay.pool", lyDo: "   " }], hoSo)).toEqual([
      "mau.ts: chay.pool — đi qua withTenant trong tệp, không được miễn",
      "mau.ts: chay.pool — thiếu lý do",
    ]);
    const hopLe = { tep: "hai.ts", pool: "b.pool", lyDo: "đối chứng: b.pool không đi qua withTenant" };
    expect(kiemNgoaiLe([hopLe], hoSo)).toEqual([]);
    expect(duocMien([hopLe], "hai.ts", "b.pool")).toBe(true);
    expect(duocMien([hopLe], "hai.ts", "a.pool")).toBe(false);
    expect(duocMien([], "hai.ts", "b.pool")).toBe(false);
    expect(timThieu(hoSo, [hopLe], "release"), "dòng miễn hợp lệ rút đúng một pool khỏi danh sách thiếu").toEqual(["mau.ts: chay.pool"]);
  });

  describe("[S1.238 / khoản 274] lời gọi gắn phải là một câu lệnh ở CÙNG khối với dòng dựng pool, sau nó, không lối ra ở giữa", () => {
    /** Một tệp mẫu: pool dựng trong hàm `chay`, `giua` là các câu lệnh giữa dòng dựng và hai lời gọi gắn, `boc` bọc hai lời gọi gắn. */
    const mauGan = (boc: (gan: string) => string, giua = ""): string =>
      [
        'import { createPool } from "@trustprocure/db";',
        'import { ngheLoiKetNoiToiMuon, withTenant } from "@trustprocure/tenancy";',
        "export async function chay(url: string, c: boolean): Promise<void> {",
        '  const pool = createPool(url, 1, { role: "app_api" });',
        giua,
        boc('pool.on("release", () => undefined);\n  ngheLoiKetNoiToiMuon(pool, () => undefined);'),
        '  await withTenant(pool, "org", async () => undefined);',
        "}",
      ].join("\n");
    const thieu = (vanBan: string): readonly string[][] => {
      const hoSo = [docVanBan(MAU, vanBan)];
      return [timThieu(hoSo, [], "release"), timThieu(hoSo, [], "toiMuon")];
    };
    const DU = [[], []];
    const THIEU_CA_HAI = [["mau.ts: chay.pool"], ["mau.ts: chay.pool"]];

    it("đối chứng dương: hai lời gọi gắn đứng ngay sau dòng dựng, cùng khối ⇒ đủ; có câu lệnh không lối ra ở giữa ⇒ vẫn đủ", () => {
      expect(thieu(mauGan((g) => `  ${g}`))).toEqual(DU);
      // `return` trong một hàm con ở giữa không phải lối ra của khối (dây nối thật: `onPoolError: (e) => …` của pool thứ hai).
      expect(thieu(mauGan((g) => `  ${g}`, "  const moTa = (e: unknown): string => { return String(e); };\n  void moTa;"))).toEqual(DU);
    });

    it("văn bản mẫu của hàng sổ: gắn trong `if (false) {}` ⇒ ĐỎ; gắn sau `return` ⇒ ĐỎ", () => {
      expect(thieu(mauGan((g) => `  if (false) {\n  ${g}\n  }`))).toEqual(THIEU_CA_HAI);
      expect(thieu(mauGan((g) => `  return;\n  ${g}`))).toEqual(THIEU_CA_HAI);
    });

    it("lồng trong `try`, vòng lặp, hàm con, khối trần, nhãn; nằm trong một biểu thức (`c && …`); sau `throw` — đều ĐỎ", () => {
      for (const boc of [
        (g: string) => `  try {\n  ${g}\n  } finally {\n  }`,
        (g: string) => `  for (let i = 0; i < 1; i += 1) {\n  ${g}\n  }`,
        (g: string) => `  const gan = (): void => {\n  ${g}\n  };\n  gan();`,
        (g: string) => `  {\n  ${g}\n  }`,
        (g: string) => `  nhan: {\n  ${g}\n  }`,
        (g: string) => `  if (c) throw new Error("x");\n  else {\n  ${g}\n  }`,
        (g: string) => `  throw new Error("x");\n  ${g}`,
      ]) {
        expect(thieu(mauGan(boc)), boc("<gắn>")).toEqual(THIEU_CA_HAI);
      }
      const bieuThuc = mauGan(() => '  c && pool.on("release", () => undefined);\n  void (c ? ngheLoiKetNoiToiMuon(pool, () => undefined) : 0);');
      expect(thieu(bieuThuc)).toEqual(THIEU_CA_HAI);
    });

    it("lối ra Ở GIỮA dòng dựng và lời gọi gắn — `if (c) return;`, `break` ra khỏi khối — ⇒ ĐỎ; `break` của một vòng lặp con ở giữa thì không phải lối ra", () => {
      expect(thieu(mauGan((g) => `  ${g}`, "  if (c) return;"))).toEqual(THIEU_CA_HAI);
      expect(thieu(mauGan((g) => `  ${g}`, "  for (const x of [1]) { if (x) break; }"))).toEqual(DU);
      const trongVong = [
        'import { createPool } from "@trustprocure/db";',
        'import { ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";',
        "export function chay(urls: string[]): void {",
        "  for (const url of urls) {",
        '    const pool = createPool(url, 1, { role: "app_api" });',
        "    if (url === '') break;",
        '    pool.on("release", () => undefined);',
        "    ngheLoiKetNoiToiMuon(pool, () => undefined);",
        "  }",
        "}",
      ].join("\n");
      expect(thieu(trongVong)).toEqual(THIEU_CA_HAI);
    });

    it("lượt soi đối kháng: pool được DÙNG giữa dòng dựng và lời gọi gắn — `withTenant` trước khi nghe, vòng lặp vô tận dùng pool (mã chết sau nó) — ⇒ ĐỎ; lời gọi gắn KIA của chính pool ở giữa thì không phải lần dùng", () => {
      expect(thieu(mauGan((g) => `  ${g}`, '  await withTenant(pool, "org", async () => undefined);'))).toEqual(THIEU_CA_HAI);
      expect(thieu(mauGan((g) => `  ${g}`, '  for (;;) {\n    await withTenant(pool, "org", async () => undefined);\n  }'))).toEqual(THIEU_CA_HAI);
      // Một hàm con ở giữa ĐÓNG lên pool là một lần dùng (fail-closed): ai gọi nó thì cổng không biết là trước hay sau lời gọi gắn.
      expect(thieu(mauGan((g) => `  ${g}`, "  const dung = (): unknown => pool;\n  void dung;"))).toEqual(THIEU_CA_HAI);
      const hoSo = docVanBan(MAU, mauGan((g) => `  ${g}`, '  await withTenant(pool, "org", async () => undefined);'));
      expect(hoSo.ganSaiCho.join("\n")).toMatch(/chay\.pool: release — pool được DÙNG ở dòng 5 trước lời gọi gắn/u);
      // Đối chứng: `pool.on("release", …)` đứng giữa dòng dựng và `ngheLoiKetNoiToiMuon(pool, …)` — hình dạng của mọi dây nối thật.
      expect(thieu(mauGan((g) => `  ${g}`))).toEqual(DU);
    });

    it("mỗi DÒNG DỰNG cần lời gọi gắn của riêng nó: gán lại cùng biến sau khi gắn ⇒ ĐỎ; gắn trước dòng dựng ⇒ ĐỎ; hai nhánh `if` dựng, gắn ở ngoài ⇒ ĐỎ", () => {
      const ganLai = mauGan((g) => `  ${g}\n  pool = createPool(url, 2, { role: "app_api" });`).replace("const pool", "let pool");
      expect(thieu(ganLai)).toEqual(THIEU_CA_HAI);
      const truoc = [
        'import { createPool } from "@trustprocure/db";',
        'import { ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";',
        'import type { Pool } from "pg";',
        "export function chay(url: string, c: boolean): Pool {",
        "  let pool: Pool | undefined;",
        '  if (c) pool = createPool(url, 1, { role: "app_api" });',
        '  else { pool = createPool(url, 2, { role: "app_api" }); }',
        '  pool.on("release", () => undefined);',
        "  ngheLoiKetNoiToiMuon(pool, () => undefined);",
        "  return pool;",
        "}",
      ].join("\n");
      expect(thieu(truoc)).toEqual(THIEU_CA_HAI);
    });

    it("pool là thuộc tính lớp: khởi tạo trường không có khối câu lệnh ⇒ ĐỎ dù một phương thức gắn qua `this`; gán trong constructor rồi gắn cùng khối ⇒ đủ", () => {
      expect(timThieu([docVanBan(MAU, MAU_LOP_NGHE_DU)], [], "release")).toEqual(["mau.ts: C.q"]);
      const hamDung = [
        'import pg from "pg";',
        'import { ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";',
        "export class D {",
        "  private readonly q: pg.Pool;",
        '  constructor() {\n    this.q = new pg.Pool({});\n    this.q.on("release", () => undefined);\n    ngheLoiKetNoiToiMuon(this.q, () => undefined);\n  }',
        "}",
      ].join("\n");
      expect(timThieu([docVanBan(MAU, hamDung)], [], "release")).toEqual([]);
      expect(timThieu([docVanBan(MAU, hamDung)], [], "toiMuon")).toEqual([]);
    });
  });

  it("phép quét thật đọc trọn mọi tệp (0 lỗi cú pháp), thấy pool ở CẢ apps/ lẫn tools/, và tên theo phạm vi là duy nhất trong tệp", () => {
    expect(HO_SO_TAT_CA.filter((h) => h.loiCuPhap > 0).map((h) => h.tep), "tệp không đọc trọn được thì cổng mù ở tệp ấy").toEqual([]);
    // Không phải một sàn theo con số hôm nay: nó chỉ bắt ca `git ls-files` trả rỗng cho một trong hai thư mục.
    expect(HO_SO.some((h) => h.tep.startsWith("apps/")), "không thấy pool nào trong apps/ — phép quét rỗng").toBe(true);
    expect(HO_SO.some((h) => h.tep.startsWith("tools/")), "không thấy pool nào trong tools/ — phép quét rỗng (khoản 180)").toBe(true);
    expect(tenTrung(HO_SO)).toEqual([]);
    // [S1.238 / khoản 274] Không lời gọi gắn nào trên kho thật bị bỏ vì sai chỗ: một lời gọi gắn chết (trong nhánh không chạy, sau lối
    // ra) cạnh lời gọi đúng là mã nói dối về thứ nó làm, dù pool vẫn nghe đủ nhờ lời gọi kia.
    expect(ganSaiChoCua(HO_SO_TAT_CA)).toBe("");
  });

  it("mọi pool dựng trong `apps/` và `tools/` có người nghe `release` (khoản 118 · 173 · 180)", () => {
    expect(
      timThieu(HO_SO, NGOAI_LE, "release"),
      `pool không ai nghe \`release\` thì một kết nối bị huỷ vì trạng thái phiên còn sót là im lặng${ganSaiChoCua(HO_SO)}`,
    ).toEqual([]);
  });

  it("mọi pool dựng trong `apps/` và `tools/` có người nghe lỗi-tới-muộn (khoản 129 · 180)", () => {
    expect(
      timThieu(HO_SO, NGOAI_LE, "toiMuon"),
      `pool không ai nghe lỗi-tới-muộn thì kết nối nhiễm tới sau trần biến mất không dấu vết${ganSaiChoCua(HO_SO)}`,
    ).toEqual([]);
  });

  it("mỗi dòng NGOAI_LE ứng với một pool CÓ THẬT, có lý do, và pool ấy không đi qua withTenant trong tệp (khoản 182)", () => {
    expect(kiemNgoaiLe(NGOAI_LE, HO_SO)).toEqual([]);
  });
});
