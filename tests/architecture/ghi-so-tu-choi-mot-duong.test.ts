// ==============================================================================================
// [S1.68 / khoản 119, lượt soi 62a-6] MỘT ĐƯỜNG GHI SỔ TỪ CHỐI Ở GIAO DỊCH ĐỘC LẬP
//
// Khoản 119 gỡ ba chỗ tự gọi `withTenant(auditPool, …)` rồi `appendAuditEvent` — mỗi chỗ chép khuôn ghi sổ của `requirePermission` mà
// bỏ bọc lỗi của lần ghi. Tệp này giữ để khuôn ấy không mọc lại: trong mã sản xuất của `packages/*/src` và `apps/*/src`, chỉ
// `packages/identity/src/rbac.ts` — nơi có `requirePermission` và `throwAuditedDenial` — được gọi `withTenant` với đối số đầu mang tên
// `auditPool` (kể cả `deps.auditPool`, `ctx.auditPool`).
//
// PHÁT BIỂU ĐÚNG MỨC: đây là phép đọc ~~VĂN BẢN~~ [S1.72 / lượt soi 67a-3: cây cú pháp] theo tên. Nó bắt đúng hình dạng đã mọc ba lần. Nó KHÔNG bắt một bí danh
// (`const p = auditPool; withTenant(p, …)`), một pool đặt tên khác, hay một lần ghi sổ từ chối trên client người gọi (khoản 69). ~~Dòng~~
// ~~chú thích — bắt đầu bằng `//`, `*` hay `/*` — bị bỏ qua~~ [S1.72 / lượt soi 67d-7: chú thích không bao giờ là một nút của cây cú pháp], vì chính docstring của khoản 119 kể lại khuôn ấy.
//
// [S1.69 / khoản 120] Bản S1.68 so mẫu trên TỪNG dòng, nên một lời gọi xuống dòng sau `withTenant(` lọt qua — tự bắt khi bản vá khoản 120
// viết hai lời gọi của `rbac.ts` trên nhiều dòng và cổng thấy 0 tệp. Nay ~~các dòng chú thích bị bỏ trước~~ [lượt soi 63a-8] mọi chú thích
// (`//` cuối dòng, `/* */`) và nội dung chuỗi bị bỏ trước, rồi mẫu so trên cả văn bản còn lại; `\s*` của mẫu vắt qua dấu xuống dòng, và mẫu
// nhận cả `withTenant<…>(` lẫn khoảng trắng trước ngoặc. Test đầu tiên dưới đây ghim các dạng ấy bằng văn bản mẫu. ~~Vẫn KHÔNG bắt bí danh.~~
// [S1.72 / lượt soi ngang 66b-9] Mẫu nhận thêm tham số kiểu lồng ~~tới ba tầng~~ (`withTenant<Map<string, Array<number>>>(`) và optional chaining
// (`ctx?.auditPool`) — bản S1.69 lọt cả hai (đo bằng chính hai dạng ấy; test thứ hai dưới đây ghim). [S1.72 / lượt soi 67d-7] Hai đoạn trên kể
// phép đọc VĂN BẢN của S1.69 và của bản đầu S1.72; từ lượt soi 67a-3 cổng đọc cây cú pháp — chú thích và chuỗi không bao giờ là lời gọi, bí danh
// import được nhận, tham số kiểu không giới hạn tầng (đoạn cuối); bí danh qua biến vẫn mù.
//
// [S1.72 / khoản 121] Vế thứ hai của cùng một đường: MỌI lời tạo lỗi mang tên `…DeniedError` trong mã sản xuất phải nằm trong đối số của
// `throwAuditedDenial(` — tức lần từ chối vào sổ trước khi ném. Chỗ ném trần được phép ghi tên kèm lý do ở `CHO_TRAN_DUOC_PHEP`: cả hai là nơi
// `requirePermission` đã ghi `PERMISSION_DENIED` ở giao dịch độc lập. Đo trên master 298cd4e: chỗ ném trần `gate.ts` 2, `comparison.ts` 1,
// `rbac.ts` 1. PHÁT BIỂU ĐÚNG MỨC: phép đọc theo TÊN LỚP và theo lời gọi bao quanh gần nhất. Nó KHÔNG bắt một lần từ chối ném bằng lớp tên
// khác (`UnsealWorkerError` trần, `ComparisonError`), và coi một lỗi tạo trước rồi truyền qua biến là ném trần — tạo lỗi NGAY trong lời gọi.
// ~~Ngoặc tròn trong một biểu thức chính quy không được bỏ, nên có thể làm lệch phép đếm ngoặc — lệch về phía báo động, không về phía im lặng.~~
//
// [S1.72 / lượt soi 67a-3, 67a-4] Câu gạch trên sai: bộ bỏ chú thích và chuỗi viết tay không biết biểu thức chính quy — một dấu nháy trong
// `/"/u` mở một chuỗi giả và xoá mã thật phía sau tới dấu nháy kế tiếp, nên cả hai vế IM ở đoạn ấy (văn bản mẫu dưới đây, đỏ trên bản đầu).
// Hai phép đọc nay đọc CÂY CÚ PHÁP của TypeScript (`ts.createSourceFile`). Lời gọi trên auditPool: `withTenant`, bí danh import của nó, hay
// `.call`/`.apply` trên nó, với đối số pool — bỏ ngoặc, `!`, `as`, `satisfies`, `<T>x` — là `auditPool`, `.auditPool`, `?.auditPool`,
// `.#auditPool` hay `["auditPool"]`. Lời tạo `…DeniedError` phải là đối số — qua các biểu thức con, không qua câu lệnh hay ranh giới hàm — của
// một lời gọi `throwAuditedDenial` hay bí danh import của nó, và lời hứa của lời gọi ấy được `return`, `await`, hay là thân một hàm mũi tên.
// Chỗ ném trần được phép ghim theo tệp, HÀM BAO và lớp, không theo số lần mỗi tệp. PHÁT BIỂU ĐÚNG MỨC: vẫn theo TÊN — bí danh qua biến
// (`const p = deps.auditPool`), hàm bọc `withTenant` tên khác, lớp từ chối không mang hậu tố `DeniedError`, và một hàm bọc `throwAuditedDenial`
// bị gọi mà không `return`/`await` (`void tuChoi(…)`) thì mù.
//
// [S1.72 / lượt soi 67c-1, 67c-3, 67c-8] Hàm gọi qua thuộc tính mang đúng tên gốc (`tenancy.withTenant`, `identity.throwAuditedDenial`) được
// nhận bất kể vật chủ — bản hai chỉ nhận tên trần —, và đối số pool qua `??`, `||` hay toán tử ba ngôi là `auditPool` khi một nhánh là
// `auditPool`. Còn mù: `(0, withTenant)(…)`, `Reflect.apply`, đối số trải (`...args`), hàm gọi bằng chuỗi (`tenancy["withTenant"]`), bí danh
// qua biến hay qua re-export đổi tên ở mô-đun khác. Dương tính giả — đỏ ồn, không im: lời gọi `throwAuditedDenial` được `yield`, gán vào biến
// rồi `await`, bọc `as`, nằm trong `Promise.all([…])` hay trong một nhánh ba ngôi, và hàm bọc gọi qua biến. `void tuChoi(…)` lọt cả cổng lẫn
// lint: `@typescript-eslint/no-floating-promises` bỏ qua `void` theo mặc định (đọc; `eslint.config.js` bật luật mà không đặt tuỳ chọn).
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
/** [S1.72 / lượt soi 67a-3] Cây cú pháp của một văn bản mã: chú thích, chuỗi, template và biểu thức chính quy do bộ phân tích của TypeScript tách. */
function cayCuPhap(vanBan: string): ts.SourceFile {
  return ts.createSourceFile("mau.ts", vanBan, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function duyetCay(nut: ts.Node, lam: (n: ts.Node) => void): void {
  lam(nut);
  ts.forEachChild(nut, (con) => {
    duyetCay(con, lam);
  });
}

/** Tên cục bộ của một hàm được import: tên gốc và mọi bí danh `import { goc as biDanh }` trong tệp. */
function tenCucBo(sf: ts.SourceFile, goc: string): ReadonlySet<string> {
  const ra = new Set<string>([goc]);
  for (const cau of sf.statements) {
    if (!ts.isImportDeclaration(cau)) continue;
    const rang = cau.importClause?.namedBindings;
    if (rang === undefined || !ts.isNamedImports(rang)) continue;
    for (const pt of rang.elements) {
      if ((pt.propertyName ?? pt.name).text === goc) ra.add(pt.name.text);
    }
  }
  return ra;
}

/** Bỏ các lớp bọc không đổi giá trị của một biểu thức: ngoặc, `!`, `as`, `satisfies`, `<T>x`. */
function boBoc(e: ts.Expression): ts.Expression {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isNonNullExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x) ||
    ts.isTypeAssertionExpression(x)
  ) {
    x = x.expression;
  }
  return x;
}

/** Biểu thức, sau khi bỏ lớp bọc, là một tên trần thuộc tập tên cho trước. */
function laTen(e: ts.Expression, ten: ReadonlySet<string>): boolean {
  const x = boBoc(e);
  return ts.isIdentifier(x) && ten.has(x.text);
}

/**
 * [S1.72 / lượt soi 67c-1] Hàm gọi, sau khi bỏ lớp bọc, là hàm đích: tên trần hay bí danh import của nó, hoặc thuộc tính mang đúng tên gốc trên
 * bất kỳ vật chủ nào (`tenancy.withTenant`, `identity.throwAuditedDenial`).
 */
function laHamDich(e: ts.Expression, ten: ReadonlySet<string>, goc: string): boolean {
  const x = boBoc(e);
  return laTen(x, ten) || (ts.isPropertyAccessExpression(x) && x.name.text === goc);
}

/**
 * Đối số pool là `auditPool` — tên trần, `.auditPool`, `?.auditPool`, `.#auditPool` hay `["auditPool"]`. [S1.72 / lượt soi 67c-1] Qua `??`, `||`
 * hay toán tử ba ngôi thì một nhánh là `auditPool` là đủ.
 */
function laAuditPool(e: ts.Expression | undefined): boolean {
  if (e === undefined) return false;
  const x = boBoc(e);
  if (ts.isIdentifier(x)) return x.text === "auditPool";
  if (ts.isPropertyAccessExpression(x)) return x.name.text === "auditPool" || x.name.text === "#auditPool";
  if (ts.isElementAccessExpression(x)) {
    const khoa = x.argumentExpression;
    return (ts.isStringLiteral(khoa) || ts.isNoSubstitutionTemplateLiteral(khoa)) && khoa.text === "auditPool";
  }
  if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return laAuditPool(x.left) || laAuditPool(x.right);
  }
  if (ts.isConditionalExpression(x)) return laAuditPool(x.whenTrue) || laAuditPool(x.whenFalse);
  return false;
}

/**
 * [S1.69 / khoản 120, lượt soi 63a-8; S1.72 / lượt soi 67a-3, 67a-4] Có lời gọi `withTenant` — hay bí danh import của nó, hay `.call`/`.apply`
 * trên nó — với đối số pool là `auditPool` không. Đọc cây cú pháp: chú thích, chuỗi và biểu thức chính quy không bao giờ là một lời gọi.
 * [lượt soi 67c-1] `withTenant` là thuộc tính của một vật chủ bất kỳ cũng tính.
 */
function coLoiGoiTrenAuditPool(vanBan: string): boolean {
  const sf = cayCuPhap(vanBan);
  const ten = tenCucBo(sf, "withTenant");
  let co = false;
  duyetCay(sf, (n) => {
    if (co || !ts.isCallExpression(n)) return;
    const goi = boBoc(n.expression);
    if (laHamDich(goi, ten, "withTenant")) {
      co = laAuditPool(n.arguments[0]);
    } else if (ts.isPropertyAccessExpression(goi) && laHamDich(goi.expression, ten, "withTenant")) {
      if (goi.name.text === "call") co = laAuditPool(n.arguments[1]);
      const mang = n.arguments[1];
      if (goi.name.text === "apply" && mang !== undefined) {
        const m = boBoc(mang);
        co = ts.isArrayLiteralExpression(m) && laAuditPool(m.elements[0]);
      }
    }
  });
  return co;
}

/** Một lời tạo `…DeniedError` không đi qua đường ghi sổ. */
interface ChoNemTran {
  readonly lop: string;
  readonly ham: string;
  readonly vi: "ném trần" | "lời hứa không return hay await";
}

/** Tên lớp của một lời `new` mang hậu tố `DeniedError`, hay null. */
function tenLopTuChoi(n: ts.Node): string | null {
  if (!ts.isNewExpression(n)) return null;
  const lop = boBoc(n.expression);
  let ten = "";
  if (ts.isIdentifier(lop)) ten = lop.text;
  else if (ts.isPropertyAccessExpression(lop)) ten = lop.name.text;
  return /DeniedError$/u.test(ten) ? ten : null;
}

/** Tên hàm bao gần nhất CÓ TÊN — khai báo hàm, phương thức, hay hàm gán cho một biến; `(cấp tệp)` nếu không có. */
function tenHamBao(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name !== undefined) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent)) return p.parent.name.getText();
  }
  return "(cấp tệp)";
}

/** Câu lệnh, khối, lớp hay hàm — ranh giới mà một lời tạo đi qua thì không còn là đối số của lời gọi nào. */
function laRanhGioi(p: ts.Node): boolean {
  return (
    ts.isSourceFile(p) ||
    ts.isBlock(p) ||
    ts.isClassLike(p) ||
    ts.isFunctionLike(p) ||
    (p.kind >= ts.SyntaxKind.FirstStatement && p.kind <= ts.SyntaxKind.LastStatement)
  );
}

/**
 * [S1.72 / khoản 121; lượt soi 67a-3, 67a-4] Mọi lời tạo `…DeniedError` KHÔNG nằm trong đối số của một lời gọi `throwAuditedDenial` (hay bí danh
 * import của nó) mà lời hứa được `return`, `await` hay là thân một hàm mũi tên. Đi lên từ lời tạo qua các biểu thức con tới lời gọi đầu tiên
 * nhận nó làm ĐỐI SỐ; gặp ranh giới trước đó thì lời tạo là ném trần. [lượt soi 67c-1] `throwAuditedDenial` là thuộc tính của một vật chủ bất kỳ
 * cũng tính.
 */
function choNemTran(vanBan: string): ChoNemTran[] {
  const sf = cayCuPhap(vanBan);
  const ten = tenCucBo(sf, "throwAuditedDenial");
  const ra: ChoNemTran[] = [];
  duyetCay(sf, (n) => {
    const lop = tenLopTuChoi(n);
    if (lop === null) return;
    let con: ts.Node = n;
    let p: ts.Node = n.parent;
    let goi: ts.CallExpression | undefined;
    while (!laRanhGioi(p)) {
      if (ts.isCallExpression(p) && con.pos >= p.arguments.pos && con.end <= p.arguments.end) {
        goi = p;
        break;
      }
      con = p;
      p = p.parent;
    }
    const ham = tenHamBao(n);
    if (goi === undefined || !laHamDich(goi.expression, ten, "throwAuditedDenial")) {
      ra.push({ lop, ham, vi: "ném trần" });
      return;
    }
    let cha: ts.Node = goi.parent;
    while (ts.isParenthesizedExpression(cha)) cha = cha.parent;
    if (!ts.isReturnStatement(cha) && !ts.isAwaitExpression(cha) && !ts.isArrowFunction(cha)) {
      ra.push({ lop, ham, vi: "lời hứa không return hay await" });
    }
  });
  return ra;
}

/** [S1.72 / khoản 121] Tên lớp của các chỗ ném trần — phép đọc mà văn bản mẫu dùng. */
function loiTuChoiNemTran(vanBan: string): string[] {
  return choNemTran(vanBan).map((x) => x.lop);
}

/** Số lời tạo `…DeniedError` trong một văn bản — cho chốt chống rỗng ruột. */
function demLoiTaoTuChoi(vanBan: string): number {
  let dem = 0;
  duyetCay(cayCuPhap(vanBan), (n) => {
    if (tenLopTuChoi(n) !== null) dem += 1;
  });
  return dem;
}

/**
 * [S1.72 / khoản 121; lượt soi 67a-4] Chỗ ném `…DeniedError` trần ĐƯỢC PHÉP — ghim theo tệp, hàm bao và lớp, mỗi dòng một quyết định kèm lý do,
 * cùng khuôn `KIND_KHONG_NHAN` của worker. Bản đầu ghim SỐ LẦN mỗi tệp: dời vế PERMISSION của cổng sang một hàm ở tệp khác rồi thêm một chỗ ném
 * trần mới vào `gate.ts` thì số lần không đổi và cổng xanh.
 */
const CHO_TRAN_DUOC_PHEP: readonly { readonly tep: string; readonly ham: string; readonly lop: string; readonly lyDo: string }[] = [
  {
    tep: "packages/identity/src/rbac.ts",
    ham: "requirePermission",
    lop: "PermissionDeniedError",
    lyDo: "`requirePermission` tạo PermissionDeniedError, ghi PERMISSION_DENIED ở giao dịch độc lập rồi mới ném — nó chính là đường ghi sổ",
  },
  {
    tep: "packages/unseal/src/gate.ts",
    ham: "assertUnsealAllowed",
    lop: "UnsealDeniedError",
    lyDo: "vế PERMISSION bọc PermissionDeniedError mà `requirePermission` vừa ghi sổ; ghi thêm UNSEAL_DENIED là ghi hai lần một lần từ chối",
  },
];

/**
 * Tệp mã sản xuất dưới `packages/<gói>/src` và `apps/<gói>/src`: tệp `.ts` ĐÃ TRACK, trừ tệp test. [S1.72 / CI của PR #71] Bản trước đi cây
 * thư mục bằng `readdirSync`, nên đọc cả tệp dò mà test khác tạo tạm: `boundaries.test.ts` dựng rồi xoá `apps/tmp-probe/src/leak.ts`, và
 * T1+T2 trên ubuntu lẫn windows gãy `ENOENT` ở lần đọc một tệp đã bị xoá sau khi được liệt kê (suy luận: cửa sổ rộng ra vì phép đọc cây cú
 * pháp chậm hơn và test lời tạo `…DeniedError` đi cây thêm một lần). Đo cục bộ: một tệp chưa track gọi `withTenant(auditPool, …)` dưới
 * `apps/` làm test "chỉ rbac.ts" đỏ với bản đi cây thư mục, xanh với bản này. Ranh giới: tệp mã mới chưa `git add` thì cổng không đọc khi
 * chạy cục bộ — trên CI mọi tệp đều đã track.
 */
function maSanXuat(): string[] {
  return execFileSync("git", ["ls-files", "--deduplicate", "*.ts"], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter((t) => /^(?:packages|apps)\/[^/]+\/src\/.+\.ts$/u.test(t) && !t.endsWith(".test.ts"))
    .map((t) => join(GOC, t));
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

  it("[INV-D5] [S1.72 / lượt soi ngang 66b-9] phép đọc bắt tham số kiểu lồng nhau và optional chaining trước auditPool — bản S1.69 lọt cả hai", () => {
    expect(coLoiGoiTrenAuditPool("await withTenant<Array<string>>(auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(ctx?.auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant<Map<string, Array<number>>>(\n  deps?.auditPool,\n  orgId,\n  fn,\n);")).toBe(true);
    // Đối chứng: pool thường qua hai dạng ấy vẫn không tính.
    expect(coLoiGoiTrenAuditPool("await withTenant(ctx?.pool, orgId, fn);")).toBe(false);
    expect(coLoiGoiTrenAuditPool("await withTenant<Array<string>>(pool, orgId, fn);")).toBe(false);
  });

  it("[INV-D5] [S1.72 / lượt soi 67a-3, 67a-4] phép đọc lời gọi trên auditPool không lọt `!.`, `#auditPool`, ép kiểu, truy cập bằng chuỗi, tham số kiểu có `=>`, `.call`, bí danh import, và biểu thức chính quy mang dấu nháy đứng trước", () => {
    expect(coLoiGoiTrenAuditPool("await withTenant(ctx!.auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(auditPool!, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("class K {\n  #auditPool = p;\n  async f(): Promise<void> {\n    await withTenant(this.#auditPool, orgId, fn);\n  }\n}")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant((deps as Deps).auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool('await withTenant(deps["auditPool"], orgId, fn);')).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant<() => void>(auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant.call(null, auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool('import { withTenant as wt } from "@trustprocure/tenancy";\nawait wt(auditPool, orgId, fn);')).toBe(true);
    expect(coLoiGoiTrenAuditPool('const re = /"/u;\nawait withTenant(auditPool, orgId, fn);\nconst s = "x";')).toBe(true);
    // Đối chứng: biểu thức chính quy mang nháy đứng trước một chuỗi kể lại khuôn; hàm tên khác trên auditPool.
    expect(coLoiGoiTrenAuditPool('const re = /"/u;\nawait withTenant(pool, orgId, fn);\nconst s = "withTenant(auditPool, orgId, fn)";')).toBe(false);
    expect(coLoiGoiTrenAuditPool("await ghiSo(auditPool, orgId, fn);")).toBe(false);
  });

  it("[INV-D5] [S1.72 / lượt soi 67c-1, 67c-3] phép đọc lời gọi trên auditPool nhận hàm gọi qua thuộc tính (`tenancy.withTenant`), pool qua `??`, `||` hay toán tử ba ngôi, lớp bọc ở TẦNG NGOÀI của đối số lẫn hàm gọi — `as`, `satisfies`, `<T>x`, ngoặc — và `.apply`", () => {
    // [lượt soi 67c-1] Cây cú pháp của bản hai chỉ nhận tên trần; mẫu văn bản của bản đầu không neo trước `withTenant(` (đọc).
    expect(coLoiGoiTrenAuditPool('import * as tenancy from "@trustprocure/tenancy";\nawait tenancy.withTenant(deps.auditPool, orgId, fn);')).toBe(true);
    expect(coLoiGoiTrenAuditPool("await tenancy.withTenant.call(null, auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(deps.auditPool ?? pool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(pool || auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(ghiSo ? auditPool : pool, orgId, fn);")).toBe(true);
    // [lượt soi 67c-3] `ctx!.auditPool` và `(deps as Deps).auditPool` mang lớp bọc BÊN TRONG thuộc tính — không đi qua `boBoc` của đối số.
    expect(coLoiGoiTrenAuditPool("await withTenant(deps.auditPool as pg.Pool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(auditPool satisfies pg.Pool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant(<pg.Pool>auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant((auditPool), orgId, fn);")).toBe(true);
    // Không `await (withTenant)(…)`: văn bản mẫu không import hay export là một script, nơi `await (x)(…)` là lời gọi hàm tên `await` (tự bắt, §S1.72).
    expect(coLoiGoiTrenAuditPool("const kq = (withTenant)(auditPool, orgId, fn);")).toBe(true);
    expect(coLoiGoiTrenAuditPool("await withTenant.apply(null, [auditPool, orgId, fn]);")).toBe(true);
    // Đối chứng: pool thường qua cùng các dạng; hàm tên khác qua thuộc tính; `.apply` mà auditPool không đứng đầu mảng.
    expect(coLoiGoiTrenAuditPool("await tenancy.withTenant(pool, orgId, fn);")).toBe(false);
    expect(coLoiGoiTrenAuditPool("await withTenant(pool ?? pool2, orgId, fn);")).toBe(false);
    expect(coLoiGoiTrenAuditPool("await tenancy.ghiSo(auditPool, orgId, fn);")).toBe(false);
    expect(coLoiGoiTrenAuditPool("await withTenant.apply(null, [pool, auditPool]);")).toBe(false);
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

  it("[INV-D5] [S1.72 / khoản 121] phép đọc lời tạo `…DeniedError`: trong đối số của `throwAuditedDenial(` thì không tính, ném trần thì tính — kể cả xuống dòng, chú thích chen hay tên hàm chỉ được nhắc; chú thích và chuỗi kể lại khuôn không tính", () => {
    expect(loiTuChoiNemTran('throw new UnsealDeniedError("POLICY_GATE", "x");')).toEqual(["UnsealDeniedError"]);
    expect(
      loiTuChoiNemTran("return throwAuditedDenial(\n  auditPool,\n  orgId,\n  { action: a, payload: { clause } },\n  new UnsealDeniedError(clause, message),\n);"),
    ).toEqual([]);
    expect(loiTuChoiNemTran("await throwAuditedDenial(pool, org, taoSuKien(x), /* chen */ new ComparisonDeniedError(s, m));")).toEqual([]);
    expect(loiTuChoiNemTran('// throw new UnsealDeniedError("x")\n/**\n * new UnsealDeniedError(\n */\nconst s = "new UnsealDeniedError(";')).toEqual([]);
    expect(loiTuChoiNemTran('throw new UnsealDeniedError("PERMISSION", m, { cause: throwAuditedDenial });')).toEqual(["UnsealDeniedError"]);
    expect(loiTuChoiNemTran("const loi = new ComparisonDeniedError(s, m);\nawait throwAuditedDenial(pool, org, ev, loi);")).toEqual([
      "ComparisonDeniedError",
    ]);
    expect(loiTuChoiNemTran("await throwAuditedDenial(pool, org, ev, d);\nthrow new UnsealExecutionDeniedError(v, m);")).toEqual([
      "UnsealExecutionDeniedError",
    ]);
  });

  it("[INV-D5] [S1.72 / lượt soi 67a-3, 67a-4] phép đọc lời tạo `…DeniedError` không lọt biểu thức chính quy mang dấu nháy, đòi lời hứa của `throwAuditedDenial(` được return hay await, và nhận bí danh import của nó", () => {
    expect(loiTuChoiNemTran('const re = /"/u;\nthrow new UnsealDeniedError("POLICY_GATE", m);')).toEqual(["UnsealDeniedError"]);
    expect(loiTuChoiNemTran("void throwAuditedDenial(pool, org, ev, new UnsealDeniedError(v, m));")).toEqual(["UnsealDeniedError"]);
    expect(loiTuChoiNemTran("throwAuditedDenial(pool, org, ev, new UnsealDeniedError(v, m)).catch(() => undefined);")).toEqual(["UnsealDeniedError"]);
    expect(
      loiTuChoiNemTran('import { throwAuditedDenial as ghiTuChoi } from "@trustprocure/identity";\nreturn ghiTuChoi(pool, org, ev, new UnsealDeniedError(v, m));'),
    ).toEqual([]);
    expect(loiTuChoiNemTran("return Promise.reject(new UnsealDeniedError(v, m));")).toEqual(["UnsealDeniedError"]);
    expect(loiTuChoiNemTran("const s = `new UnsealDeniedError(x)`;")).toEqual([]);
    expect(loiTuChoiNemTran("const f = () => throwAuditedDenial(pool, org, ev, new ComparisonDeniedError(s, m));")).toEqual([]);
  });

  it("[INV-D5] [S1.72 / lượt soi 67c-1, 67c-3] phép đọc lời tạo `…DeniedError` nhận `throwAuditedDenial` gọi qua thuộc tính, bỏ ngoặc quanh lời gọi được return, và coi lời tạo trong một hàm mũi tên truyền làm đối số là ném trần", () => {
    // [lượt soi 67c-1] Dương tính giả của bản hai: lời gọi qua thuộc tính bị báo ném trần.
    expect(loiTuChoiNemTran("return identity.throwAuditedDenial(pool, org, ev, new UnsealDeniedError(v, m));")).toEqual([]);
    // [lượt soi 67c-3] Ngoặc quanh lời gọi được return; hàm mũi tên là ranh giới — lời tạo trong nó chạy vào lúc khác, không phải đối số đã ghi sổ.
    expect(loiTuChoiNemTran("return (throwAuditedDenial(pool, org, ev, new UnsealDeniedError(v, m)));")).toEqual([]);
    expect(loiTuChoiNemTran("return throwAuditedDenial(pool, org, ev, d, () => new UnsealDeniedError(v, m));")).toEqual(["UnsealDeniedError"]);
    // Đối chứng: hàm tên khác qua thuộc tính.
    expect(loiTuChoiNemTran("return identity.ghiSo(pool, org, ev, new UnsealDeniedError(v, m));")).toEqual(["UnsealDeniedError"]);
  });

  it("[INV-D5] [S1.72 / khoản 121] mọi `new …DeniedError(` trong mã sản xuất nằm trong đối số của `throwAuditedDenial(` — trừ hai chỗ `requirePermission` đã ghi sổ trước khi lỗi được tạo; [lượt soi 67a-4] lời hứa được return hay await, chỗ miễn ghim theo tệp, hàm bao và lớp", () => {
    const tep = maSanXuat();
    const tran: string[] = [];
    let tongLoiTao = 0;
    for (const duong of tep) {
      const van = readFileSync(duong, "utf8");
      tongLoiTao += demLoiTaoTuChoi(van);
      const ten = relative(GOC, duong).split(sep).join("/");
      for (const x of choNemTran(van)) tran.push(`${ten} › ${x.ham} › ${x.lop} — ${x.vi}`);
    }
    expect(tongLoiTao, "chống rỗng ruột: không thấy lời tạo …DeniedError nào — phép đọc đã hỏng").toBeGreaterThanOrEqual(5);
    expect(tran.sort(), "một lần từ chối ném trần mọc lại — tạo lỗi ngay trong lời gọi throwAuditedDenial và return hay await nó").toEqual(
      CHO_TRAN_DUOC_PHEP.map((c) => `${c.tep} › ${c.ham} › ${c.lop} — ném trần`).sort(),
    );
  });
});
