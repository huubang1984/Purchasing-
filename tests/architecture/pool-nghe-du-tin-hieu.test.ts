// ==============================================================================================
// [S1.84 / khoản 129 và khoản 173] MỌI POOL DỰNG TRONG `apps/` ~~PHẢI~~ **[S1.9171 / khoản 180] VÀ `tools/`** PHẢI NGHE
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
// không gắn gì (khoản 180) — vòng S1.9171 nới tầm quét và gắn.
//
// PHÉP ĐỌC LÀ CÂY CÚ PHÁP CÓ BINDER, không phải biểu thức chính quy: một chuỗi trong chú thích
// hay một tên biến trùng chữ không được tính là một lời gọi, và hai biến cùng tên ở hai hàm là
// hai pool. Cùng kỷ luật với `ghi-so-tu-choi-mot-duong.test.ts`; phần binder là chương trình
// TypeScript MỘT TỆP (`noResolve`, `noLib`): mỗi tên được phân giải về đúng khai báo của nó trong
// tệp, import được phân giải về (gói, tên xuất) nên bí danh không che được gì — nhưng không đi
// theo import ra ngoài tệp (đó là ranh giới ⑴ dưới đây).
//
// BA RANH GIỚI, nói ra — một cổng im lặng bỏ qua một vùng mã là một cổng nói dối về phạm vi của
// chính nó (khoản 176; bản đầu của khối này viết ĐÚNG MỘT trong ba, lượt soi ngang 74 đo ra):
//   ⑴ PHÉP ĐỌC GÓI TRONG MỘT TỆP. Pool và người nghe phải cùng tệp. Người nghe được tính: `<pool>.on("release", …)`
//      viết thẳng; `ngheLoiKetNoiToiMuon(<pool>, …)` import từ `@trustprocure/tenancy` (bí danh vẫn thấy); hai hàm bọc
//      `ghiLogKetNoiHuy` / `ghiLogLoiKetNoiToiMuon` CHỈ khi import từ `./mo-ta-loi.js` (composition root của `api`) —
//      thân hai hàm ấy không được đọc, cổng TIN chúng theo đường import. [S1.9143 / khoản 183] Cổng này chỉ đo SỰ CÓ MẶT của
//      lời gọi gắn; THÂN của bốn bộ nghe (hai hàm bọc của `api`, `ghiKetNoiHuy`/`ghiLoiToiMuon` của worker) đo bằng hành vi trên
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
//      và không test nào đỏ vì thế — khoản 9471). Tệp chưa `git add` không được quét — `git ls-files` là chủ ý để tệp dò tạm
//      không lọt vào.
//   ⑶ HÌNH DẠNG NHẬN DIỆN: một pool là `createPool(…)` của `@trustprocure/db` (tên trần, bí danh, hay qua `import * as`) hoặc
//      `new Pool(…)` của `pg` (`import pg from`, `import * as`, `import { Pool as … }`) — phân giải theo import, không theo
//      chữ. Nó được gán vào một biến, một thuộc tính lớp (`private readonly q = new pg.Pool(…)` hay `this.q = …`), hoặc
//      KHÔNG gán vào đâu (trả về thẳng, truyền làm đối số): pool không tên mang tên `<khong-ten:dòng>` và phải có một dòng
//      `NGOAI_LE` cho nó — fail-closed, không vô hình. Tên pool là `<hàm, phương thức hay lớp lồng nhau>.<biến>`, nên ba
//      `const pool` ở ba hàm của `tools/neo-so-kiem-toan/src/index.ts` là ba pool, và `NGOAI_LE` trỏ được đúng một. Không
//      thấy: pool lấy từ một hàm TỰ VIẾT ở tệp khác (`layPool()`) — chỗ dựng của nó nằm ở tệp kia và bị tính ở đó là pool
//      không tên; `import x = require("pg")` (cấm bởi `verbatimModuleSyntax` + ESM).
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

  // Lượt 1: chỗ DỰNG pool, khoá theo ký hiệu được gán; pool không tên đứng riêng.
  const theoKyHieu = new Map<ts.Symbol, HoSoPool>();
  const khongTen: HoSoPool[] = [];
  const timDung = (n: ts.Node): void => {
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && laDungPool(n, ch)) {
      const kh = kyHieuDuocGan(n, ch);
      if (kh === undefined) {
        const dong = cay.getLineAndCharacterOfPosition(n.getStart(cay)).line + 1;
        khongTen.push({ ten: ghepTen(duongPhamVi(n), `<khong-ten:${String(dong)}>`), ngheRelease: false, ngheToiMuon: false, quaWithTenant: false });
      } else if (!theoKyHieu.has(kh)) {
        theoKyHieu.set(kh, { ten: tenTheoPhamVi(kh), ngheRelease: false, ngheToiMuon: false, quaWithTenant: false });
      }
    }
    ts.forEachChild(n, timDung);
  };
  timDung(cay);

  // Lượt 2: người nghe và lời gọi `withTenant`, trỏ về pool qua ký hiệu của đối số.
  const timNghe = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const goi = n.expression;
      const doiSoDau = n.arguments[0];
      if (ts.isIdentifier(goi) && doiSoDau !== undefined) {
        const kh = kyHieuCuaBieuThuc(doiSoDau, ch);
        const p = kh === undefined ? undefined : theoKyHieu.get(kh);
        if (p !== undefined) {
          const ng = nguonImportCua(ch.getSymbolAtLocation(goi));
          if (laNguon(ng, TEP_HAM_BOC_API, HAM_BOC_NGHE_RELEASE)) p.ngheRelease = true;
          if (laNguon(ng, TEP_HAM_BOC_API, HAM_BOC_NGHE_TOI_MUON) || laNguon(ng, GOI_TENANCY, "ngheLoiKetNoiToiMuon")) p.ngheToiMuon = true;
          if (laNguon(ng, GOI_TENANCY, "withTenant")) p.quaWithTenant = true;
        }
      }
      // `<pool>.on("release", …)` / `this.<pool>.on("release", …)` viết thẳng
      if (ts.isPropertyAccessExpression(goi) && goi.name.text === "on" && doiSoDau !== undefined && ts.isStringLiteralLike(doiSoDau) && doiSoDau.text === "release") {
        const kh = kyHieuCuaBieuThuc(goi.expression, ch);
        const p = kh === undefined ? undefined : theoKyHieu.get(kh);
        if (p !== undefined) p.ngheRelease = true;
      }
    }
    ts.forEachChild(n, timNghe);
  };
  timNghe(cay);

  return { tep, pool: [...theoKyHieu.values(), ...khongTen], loiCuPhap };
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

const MAU_LOP_NGHE_DU = [
  'import pg from "pg";',
  'import { ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";',
  "export class C {",
  "  private readonly q = new pg.Pool({});",
  '  nghe(): void { this.q.on("release", () => undefined); ngheLoiKetNoiToiMuon(this.q, () => undefined); }',
  "}",
].join("\n");

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

describe("[S1.84 → S1.9171 / khoản 129, 173, 176, 180, 182] pool của apps/ và tools/ nghe đủ hai tín hiệu", () => {
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
    const lop = [docVanBan(MAU, MAU_LOP_NGHE_DU)];
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

  it("phép quét thật đọc trọn mọi tệp (0 lỗi cú pháp), thấy pool ở CẢ apps/ lẫn tools/, và tên theo phạm vi là duy nhất trong tệp", () => {
    expect(HO_SO_TAT_CA.filter((h) => h.loiCuPhap > 0).map((h) => h.tep), "tệp không đọc trọn được thì cổng mù ở tệp ấy").toEqual([]);
    // Không phải một sàn theo con số hôm nay: nó chỉ bắt ca `git ls-files` trả rỗng cho một trong hai thư mục.
    expect(HO_SO.some((h) => h.tep.startsWith("apps/")), "không thấy pool nào trong apps/ — phép quét rỗng").toBe(true);
    expect(HO_SO.some((h) => h.tep.startsWith("tools/")), "không thấy pool nào trong tools/ — phép quét rỗng (khoản 180)").toBe(true);
    expect(tenTrung(HO_SO)).toEqual([]);
  });

  it("mọi pool dựng trong `apps/` và `tools/` có người nghe `release` (khoản 118 · 173 · 180)", () => {
    expect(
      timThieu(HO_SO, NGOAI_LE, "release"),
      "pool không ai nghe `release` thì một kết nối bị huỷ vì trạng thái phiên còn sót là im lặng",
    ).toEqual([]);
  });

  it("mọi pool dựng trong `apps/` và `tools/` có người nghe lỗi-tới-muộn (khoản 129 · 180)", () => {
    expect(
      timThieu(HO_SO, NGOAI_LE, "toiMuon"),
      "pool không ai nghe lỗi-tới-muộn thì kết nối nhiễm tới sau trần biến mất không dấu vết",
    ).toEqual([]);
  });

  it("mỗi dòng NGOAI_LE ứng với một pool CÓ THẬT, có lý do, và pool ấy không đi qua withTenant trong tệp (khoản 182)", () => {
    expect(kiemNgoaiLe(NGOAI_LE, HO_SO)).toEqual([]);
  });
});
