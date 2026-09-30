// ==============================================================================================
// [S1.9115 / khoản 161 · 170] `kind` CỦA OUTBOX: KHAI Ở MỘT CHỖ, VIẾT LITERAL Ở MỌI LỜI GỌI — VÀ GƯƠNG TEST CỦA RUNNER `api`
//
// Khoản 161 (§S1.81): cổng khoản 34 (`apps/unseal-worker/src/composition.int.test.ts`) tìm tập `kind` của kho bằng ba mẫu VĂN BẢN —
// `enqueueJob(… kind: "X")`, một hằng tên `…_KIND = "X"`, một `INSERT INTO outbox_jobs` viết tay — nên một `kind` truyền qua biến tên
// khác, qua template hay qua chuỗi ghép lọt cả ba; khi không runner nào có nó trong mảng lọc, job nằm `PENDING` im lặng. Đo trước trên
// `ba269ae` (§S1.9115 mục 3): ba lời gọi `kind: loaiViec` · `` kind: `THU_TEMPLATE_${so}` `` · `kind: [...].join("_")` trong một tệp sản
// xuất ⇒ cổng khoản 34 2/2 XANH, `tsc` thoát 0; và hình dạng ⑴ của phép quét khớp 0 lời gọi — mọi lời gọi thật truyền một hằng.
//
// Lớp đúng, không phải một mẫu thứ tư: `JobInput.kind` là union `KindOutbox` khai ở ĐÚNG MỘT chỗ (`packages/outbox/src/enqueue.ts`), nên
// tsc từ chối một `kind` ngoài tập ở mọi chỗ gọi; và tệp này đòi ở mọi lời gọi `enqueueJob` trong mã SẢN XUẤT `kind` là một LITERAL
// chuỗi — không biến, không hằng (kể cả hằng import), không template có biến, không ghép, không ép kiểu — để kiểu không bị qua mặt bằng
// `as`/`any` và để `kind` đọc được ngay tại chỗ gọi. Ba vế:
//   ⑴ union: `type KindOutbox` là union các literal chuỗi, mỗi cái khớp CHECK của `007` (`^[A-Z][A-Z0-9_]{0,63}$`), theo bảng chữ cái
//      (dạng duy nhất để so với `095`, ADR-134), không trùng; `JobInput.kind` mang đúng kiểu ấy, bắt buộc;
//   ⑵ lời gọi: mọi tham chiếu tới `enqueueJob` trong mã sản xuất — tên trần, bí danh import, thuộc tính của vật chủ bất kỳ
//      (`outbox.enqueueJob`) — là HÀM ĐƯỢC GỌI TRỰC TIẾP: không gán vào biến, không truyền đi, không phá cấu trúc, không
//      `.call`/`.apply`/`.bind`, không gọi bằng chuỗi, không re-export đổi tên. Lời gọi không mang tham số kiểu, đúng ba đối số không
//      trải; đối số thứ ba là object literal không trải, có đúng một `kind: "<LITERAL>"` (chỉ ngoặc tròn được bỏ), và literal ấy thuộc
//      union — vế sau bắt cả một `@ts-expect-error`/`@ts-ignore` che một `kind` lạ. Một hàm BỌC (`xep(c, o, k)` gọi
//      `enqueueJob(c, o, { kind: k })`) không lách được: lời gọi bên trong nó mang `kind` không literal, hay một `job` không phải object;
//   ⑶ văn bản mẫu cho từng hình dạng, kể cả ba hình dạng của phép đo trước.
// Cổng khoản 34 đọc CHÍNH union này thay cho hai mẫu văn bản TypeScript cũ, vẫn quét `INSERT` viết tay (hình dạng ⑶ cũ — trigger `019`).
//
// Khoản 170 (§S1.83, khối cuối tệp): `apps/api/src/test-services.ts` dựng runner của TEST và tự khai *"giống HỆT `composition.ts`, và
// phải giống"* — không lớp nào đối chiếu. Từ S1.222 (khoản 168) dòng `kindKhongNguoiNhan` rời CẢ HAI tệp, và vế khoản 168 của
// `apps/api/src/composition.int.test.ts` đỏ khi `composition.ts` khai lại (đo lại ở §S1.9115: `FAILED`/1 thay vì `PENDING`/0). Chiều còn
// lại — gương test lệch bản thật — vẫn mù: thêm dòng ấy CHỈ ở `test-services.ts` ⇒ `tsc` 0, api `composition.int` 21/21 xanh. Khối cuối
// đối chiếu DÂY NỐI MẢNG LỌC của hai lời `new JobRunner(…)`: biểu thức bảng handler, nguồn import của hàm dựng nó, và mọi lần tên
// `kindKhongNguoiNhan` xuất hiện trong mã của hai tệp.
//
// PHÁT BIỂU ĐÚNG MỨC: đọc theo TÊN và HÌNH DẠNG cú pháp (`ts.createSourceFile`, khuôn `ghi-so-tu-choi-mot-duong.test.ts` của S1.72), không
// theo kiểu. Mù với: `eval`/`Function`, tên tính lúc chạy (`outbox["enqueue" + "Job"]`, `Reflect.get`), và mã ngoài
// `packages|apps|tools/*/src` — tệp test không đọc: chúng được phép gọi với `kind` thử qua một kiểu nới
// (`packages/outbox/src/outbox.int.test.ts`). Một `INSERT INTO outbox_jobs` viết tay — SQL, hay câu lệnh trong mã TS ngoài `enqueueJob` —
// không qua kiểu nào: cổng khoản 34 chỉ đọc MỘT dạng của nó (`(org_id, kind, …) VALUES (…, '<LITERAL>'`); các dạng khác lọt, đo ở lượt tự
// soi §S1.9115 — khoản 9415. Vế 170 không đọc xuyên một phần trải mà tên `kindKhongNguoiNhan` không xuất hiện trong tệp (trải một hằng
// import từ mô-đun khác).
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
/** Chỗ khai DUY NHẤT của union. */
const TEP_KHAI = "packages/outbox/src/enqueue.ts";
const TEN_UNION = "KindOutbox";
const TEN_HAM = "enqueueJob";
/** CHECK của `outbox_jobs.kind` (`007_outbox.sql`). */
const HINH_DANG_KIND = /^[A-Z][A-Z0-9_]{0,63}$/u;

function cayCuPhap(vanBan: string, ten = "mau.ts"): ts.SourceFile {
  return ts.createSourceFile(ten, vanBan, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function duyetCay(nut: ts.Node, lam: (n: ts.Node) => void): void {
  lam(nut);
  ts.forEachChild(nut, (con) => {
    duyetCay(con, lam);
  });
}

/** Bỏ ngoặc tròn — và CHỈ ngoặc: `as`, `<T>x`, `!`, `satisfies` là khẳng định kiểu, không phải một literal. */
function boNgoac(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** Bỏ khoảng trắng — dạng so sánh của một đoạn mã (định dạng lại không phải một thay đổi). */
function gon(n: ts.Node, sf: ts.SourceFile): string {
  return n.getText(sf).replace(/\s+/gu, "");
}

// ----------------------------------------------------------------------------------------------
// ⑴ Union
// ----------------------------------------------------------------------------------------------

export interface UnionKind {
  readonly thanhVien: readonly string[];
  readonly viPham: readonly string[];
}

/** Đọc `type KindOutbox` và kiểu của `JobInput.kind` từ văn bản của `enqueue.ts`. */
export function docUnionKind(vanBan: string): UnionKind {
  const sf = cayCuPhap(vanBan, "enqueue.ts");
  const khai = sf.statements.filter((c): c is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(c) && c.name.text === TEN_UNION);
  const viPham: string[] = [];
  if (khai.length !== 1) viPham.push(`\`type ${TEN_UNION}\` phải khai ĐÚNG MỘT lần ở cấp tệp — thấy ${String(khai.length)}`);
  const kieu = khai.length === 1 ? khai[0]!.type : undefined;
  const thanhVien: string[] = [];
  for (const t of kieu === undefined ? [] : ts.isUnionTypeNode(kieu) ? kieu.types : [kieu]) {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) thanhVien.push(t.literal.text);
    else viPham.push(`thành viên không phải literal chuỗi: \`${t.getText(sf)}\``);
  }
  for (const k of thanhVien) if (!HINH_DANG_KIND.test(k)) viPham.push(`"${k}" không khớp CHECK của 007 (^[A-Z][A-Z0-9_]{0,63}$)`);
  const trung = thanhVien.filter((k, i) => thanhVien.indexOf(k) !== i);
  if (trung.length > 0) viPham.push(`thành viên trùng: ${trung.join(", ")}`);
  if (thanhVien.join("\n") !== [...thanhVien].sort().join("\n")) {
    viPham.push("thành viên không theo bảng chữ cái — một dạng duy nhất để so với tập của `095` (ADR-134)");
  }
  const jobInput = sf.statements.find((c): c is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(c) && c.name.text === "JobInput");
  const kind = jobInput?.members.find((m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText(sf) === "kind");
  const kieuKind = kind?.type;
  if (
    kind === undefined ||
    kind.questionToken !== undefined ||
    kieuKind === undefined ||
    !ts.isTypeReferenceNode(kieuKind) ||
    kieuKind.typeName.getText(sf) !== TEN_UNION
  ) {
    viPham.push(`\`JobInput.kind\` phải mang kiểu \`${TEN_UNION}\`, bắt buộc — thấy \`${kind === undefined ? "(không có)" : kind.getText(sf)}\``);
  }
  return { thanhVien, viPham };
}

// ----------------------------------------------------------------------------------------------
// ⑵ Lời gọi
// ----------------------------------------------------------------------------------------------

export interface LoiGoi {
  readonly ham: string;
  readonly kind: string;
}

export interface KetQuaDocLoiGoi {
  readonly goi: readonly LoiGoi[];
  readonly viPham: readonly string[];
}

/** Tên cục bộ của `enqueueJob` trong một tệp: tên gốc và mọi bí danh `import { enqueueJob as x }`. */
function tenCucBo(sf: ts.SourceFile): ReadonlySet<string> {
  const ra = new Set<string>([TEN_HAM]);
  for (const cau of sf.statements) {
    if (!ts.isImportDeclaration(cau)) continue;
    const rang = cau.importClause?.namedBindings;
    if (rang === undefined || !ts.isNamedImports(rang)) continue;
    for (const pt of rang.elements) if ((pt.propertyName ?? pt.name).text === TEN_HAM) ra.add(pt.name.text);
  }
  return ra;
}

/** Tên hàm bao gần nhất CÓ TÊN — khai báo hàm, phương thức, hàm gán cho một biến hay cho một thuộc tính; `(cấp tệp)` nếu không có. */
function tenHamBao(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name !== undefined) return p.name.getText();
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && (ts.isVariableDeclaration(p.parent) || ts.isPropertyAssignment(p.parent))) {
      return p.parent.name.getText();
    }
  }
  return "(cấp tệp)";
}

/** Tên của một thuộc tính object; `null` cho tên tính toán (`[x]: …`). */
function tenThuocTinh(ten: ts.PropertyName): string | null {
  if (ts.isComputedPropertyName(ten)) return null;
  return ten.text;
}

/**
 * Một tên `enqueueJob` (hay bí danh) ở vị trí KHÔNG phải tham chiếu giá trị: tên sau dấu chấm (đọc riêng như thuộc tính), tên thuộc
 * tính/phương thức khai trong object, lớp hay kiểu, import/export, khai báo hàm, và mọi chỗ bên trong một nút KIỂU (`typeof enqueueJob`).
 */
function khongPhaiThamChieu(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p)) &&
    p.name === id
  ) {
    return true;
  }
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  for (let x: ts.Node | undefined = p; x !== undefined; x = x.parent) if (ts.isTypeNode(x)) return true;
  return false;
}

/** Tên đọc được của chỗ một tham chiếu rơi vào khi nó không phải hàm được gọi. */
function moTaChoDung(p: ts.Node): string {
  if (ts.isVariableDeclaration(p)) return "gán vào biến";
  if (ts.isPropertyAccessExpression(p)) return `truy cập \`.${p.name.text}\` — gọi gián tiếp`;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) return "truyền làm đối số";
  if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) return "đặt vào object";
  if (ts.isBindingElement(p)) return "phá cấu trúc thành bí danh";
  if (ts.isArrayLiteralExpression(p)) return "đặt vào mảng";
  if (ts.isBinaryExpression(p)) return "vế của một biểu thức (gán, phẩy, logic)";
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return "trả về";
  if (ts.isExportAssignment(p)) return "export default";
  if (ts.isAsExpression(p) || ts.isTypeAssertionExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p)) return "ép kiểu hàm";
  return ts.SyntaxKind[p.kind];
}

/** Hình dạng của một giá trị `kind` không phải literal, gọi tên để lần đỏ nói đúng lỗ. */
function moTaKind(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return "tên (biến hay hằng)";
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return "thuộc tính";
  if (ts.isTemplateExpression(e)) return "template có biến";
  if (ts.isBinaryExpression(e)) return "phép toán (ghép chuỗi, ??, ||)";
  if (ts.isCallExpression(e)) return "lời gọi";
  if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)) return "ép kiểu";
  if (ts.isSatisfiesExpression(e)) return "satisfies";
  if (ts.isNonNullExpression(e)) return "khẳng định non-null";
  if (ts.isConditionalExpression(e)) return "ba ngôi";
  return ts.SyntaxKind[e.kind];
}

/** Mọi tham chiếu tới `enqueueJob` trong một văn bản mã: lời gọi đọc được `kind` literal, và vi phạm của vế ⑵. */
export function docLoiGoi(vanBan: string, tep: string, union: ReadonlySet<string>): KetQuaDocLoiGoi {
  const sf = cayCuPhap(vanBan, tep);
  const ten = tenCucBo(sf);
  const goi: LoiGoi[] = [];
  const viPham: string[] = [];
  const bao = (n: ts.Node, loi: string): void => {
    viPham.push(`${tep} › ${tenHamBao(n)} › ${loi}`);
  };

  const xetLoiGoi = (c: ts.CallExpression): void => {
    if (c.typeArguments !== undefined) {
      bao(c, "lời gọi mang tham số kiểu");
      return;
    }
    if (c.arguments.length !== 3 || c.arguments.some((d) => ts.isSpreadElement(d))) {
      bao(c, "cần đúng ba đối số, không trải");
      return;
    }
    const job = boNgoac(c.arguments[2]!);
    if (!ts.isObjectLiteralExpression(job)) {
      bao(c, `đối số thứ ba không phải object literal (${moTaKind(job)}) — kind không đọc được tại chỗ gọi`);
      return;
    }
    if (job.properties.some((p) => ts.isSpreadAssignment(p))) {
      bao(c, "object trải (`...`) — kind có thể bị ghi đè, không đọc được tại chỗ gọi");
      return;
    }
    // Tên tính toán (`[x]: …`) có thể là `kind`: tính vào, để lần đỏ gọi tên nó thay vì bỏ qua.
    const cacKind = job.properties.filter((p) => p.name !== undefined && (tenThuocTinh(p.name) ?? "kind") === "kind");
    if (cacKind.length !== 1) {
      bao(c, `cần đúng một thuộc tính \`kind\` — thấy ${String(cacKind.length)} (tên tính toán cũng tính)`);
      return;
    }
    const pk = cacKind[0]!;
    if (!ts.isPropertyAssignment(pk) || ts.isComputedPropertyName(pk.name)) {
      const hinh = ts.isShorthandPropertyAssignment(pk) ? "viết tắt `{ kind }` — một biến" : ts.isPropertyAssignment(pk) ? "tên tính toán" : "phương thức hay accessor";
      bao(c, `kind phải viết \`kind: "<LITERAL>"\` — thấy ${hinh}`);
      return;
    }
    const v = boNgoac(pk.initializer);
    if (!ts.isStringLiteral(v) && !ts.isNoSubstitutionTemplateLiteral(v)) {
      bao(c, `kind không phải literal (${moTaKind(v)}): \`${pk.initializer.getText(sf)}\``);
      return;
    }
    if (!union.has(v.text)) {
      bao(c, `kind "${v.text}" không thuộc union ${TEN_UNION} (${TEP_KHAI}) — tsc bị che (@ts-expect-error/@ts-ignore)?`);
      return;
    }
    goi.push({ ham: tenHamBao(c), kind: v.text });
  };

  const xetThamChieu = (thamChieu: ts.Expression): void => {
    // Đi lên qua ngoặc: `(enqueueJob)(…)` vẫn là lời gọi trực tiếp.
    let con: ts.Node = thamChieu;
    let p: ts.Node = thamChieu.parent;
    while (ts.isParenthesizedExpression(p)) {
      con = p;
      p = p.parent;
    }
    if (ts.isCallExpression(p) && p.expression === con) {
      xetLoiGoi(p);
      return;
    }
    bao(thamChieu, `\`${thamChieu.getText(sf)}\` không phải lời gọi trực tiếp (${moTaChoDung(p)}) — cổng không đọc được kind qua đường ấy`);
  };

  duyetCay(sf, (n) => {
    // Re-export ĐỔI TÊN (`export { enqueueJob as xep }`, hay `export { xep }` của một bí danh) là một bí danh ra mô-đun khác — ở đó
    // `xep(…)` không mang tên nào cổng này nhận ra. Re-export giữ tên (`index.ts` của gói) thì người import vẫn gọi bằng tên gốc.
    if (ts.isExportSpecifier(n) && ten.has((n.propertyName ?? n.name).text) && n.name.text !== TEN_HAM) {
      bao(n, `\`${n.getText(sf)}\` — re-export đổi tên: một bí danh ra mô-đun khác, cổng không đọc được lời gọi qua nó`);
      return;
    }
    if (ts.isIdentifier(n) && ten.has(n.text) && !khongPhaiThamChieu(n)) xetThamChieu(n);
    else if (ts.isPropertyAccessExpression(n) && n.name.text === TEN_HAM) xetThamChieu(n);
    else if (ts.isElementAccessExpression(n)) {
      const khoa = n.argumentExpression;
      if ((ts.isStringLiteral(khoa) || ts.isNoSubstitutionTemplateLiteral(khoa)) && khoa.text === TEN_HAM) {
        bao(n, `\`${n.getText(sf)}\` — gọi bằng chuỗi`);
      }
    }
  });
  return { goi, viPham };
}

/**
 * Tệp mã sản xuất dưới `packages|apps|tools/<gói>/src`: tệp `.ts` ĐÃ TRACK, trừ tệp test — cùng lý do `git ls-files` của
 * `ghi-so-tu-choi-mot-duong.test.ts` (tệp dò tạm của test khác không được đọc). Ranh giới: tệp mới chưa `git add` thì cổng không thấy khi
 * chạy cục bộ; trên CI mọi tệp đều đã track.
 */
function maSanXuat(): string[] {
  return execFileSync("git", ["ls-files", "--deduplicate", "*.ts"], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter((t) => /^(?:packages|apps|tools)\/[^/]+\/src\/.+\.ts$/u.test(t) && !t.endsWith(".test.ts"));
}

const LOI_LOI_GOI =
  "Một lời gọi `enqueueJob` trong mã sản xuất không mang `kind` là literal của union. Viết `kind: \"<KIND>\"` ngay tại chỗ gọi; kind " +
  `mới thì thêm vào union \`${TEN_UNION}\` (${TEP_KHAI}), viết handler ở ĐÚNG MỘT tiến trình và thêm migration \`ALTER POLICY\` (ADR-134). ` +
  "Hằng, biến, template, ghép, ép kiểu hay bí danh là đường khoản 161 đã đo: kind lọt mọi phép quét và job nằm PENDING im lặng.";

describe("[S1.9115 / khoản 161] `kind` của outbox khai ở MỘT chỗ và viết LITERAL ở mọi lời gọi `enqueueJob`", () => {
  const union = docUnionKind(readFileSync(join(GOC, TEP_KHAI), "utf8"));

  it("⑴ `type KindOutbox` ở enqueue.ts là union literal chuỗi — khớp CHECK của 007, theo bảng chữ cái, không trùng — và `JobInput.kind` mang đúng kiểu ấy", () => {
    expect(union.viPham, `${TEP_KHAI}: tập kind của kho phải là MỘT union khai ở đây (khoản 161)`).toEqual([]);
    expect(union.thanhVien, "chống rỗng ruột: bộ đọc không thấy kind mở thầu trong union").toContain("UNSEAL_RFQ");
  });

  it("⑵ mọi tham chiếu tới `enqueueJob` trong mã sản xuất là lời gọi trực tiếp với `kind: \"<LITERAL>\"` thuộc union — và phép đọc có lời gọi thật để đọc", () => {
    const tep = maSanXuat();
    const tap = new Set(union.thanhVien);
    const goi: string[] = [];
    const viPham: string[] = [];
    for (const t of tep) {
      const van = readFileSync(join(GOC, t), "utf8");
      // Mọi hình dạng mà vế ⑵ nhận ra đều mang nguyên chữ `enqueueJob` (tên gốc có ở dòng import của bí danh): lọc để không dựng cây vô ích.
      if (!van.includes(TEN_HAM)) continue;
      const kq = docLoiGoi(van, t, tap);
      for (const g of kq.goi) goi.push(`${t} › ${g.ham} › ${g.kind}`);
      viPham.push(...kq.viPham);
    }
    expect(tep.length, "chống rỗng ruột: không đọc được tệp mã sản xuất nào").toBeGreaterThan(50);
    expect(viPham, LOI_LOI_GOI).toEqual([]);
    // Chống rỗng ruột: lời gọi xếp job mở thầu của `dispatchUnseal` — đường mở thầu của kịch bản §11 — phải được đọc ra literal.
    expect(goi, "chống rỗng ruột: phép đọc không thấy lời gọi thật nào").toContain("packages/unseal/src/requests.ts › dispatchUnseal › UNSEAL_RFQ");
  });

  it("⑶ văn bản mẫu — bộ đọc union: literal theo bảng chữ cái thì đọc được; `string`, template, trùng, sai thứ tự, sai CHECK, `JobInput.kind: string` thì ĐỎ", () => {
    const tot = 'export type KindOutbox = "A_B" | "C_D";\nexport interface JobInput {\n  readonly kind: KindOutbox;\n}';
    expect(docUnionKind(tot)).toEqual({ thanhVien: ["A_B", "C_D"], viPham: [] });
    // Hình dạng của cây trước vòng này: không union, `kind: string`.
    expect(docUnionKind("export interface JobInput {\n  readonly kind: string;\n}").viPham.join("\n")).toContain("ĐÚNG MỘT lần");
    expect(docUnionKind(tot.replace("KindOutbox;", "string;")).viPham.join("\n")).toContain("`JobInput.kind` phải mang kiểu");
    expect(docUnionKind(tot.replace("readonly kind", "readonly kind?")).viPham.join("\n")).toContain("bắt buộc");
    expect(docUnionKind('type KindOutbox = string;\ninterface JobInput { readonly kind: KindOutbox }').viPham.join("\n")).toContain("không phải literal");
    expect(docUnionKind('type KindOutbox = "A_B" | `C_${string}`;\ninterface JobInput { readonly kind: KindOutbox }').viPham.join("\n")).toContain(
      "không phải literal",
    );
    expect(docUnionKind(tot.replace('"A_B" | "C_D"', '"C_D" | "A_B"')).viPham.join("\n")).toContain("bảng chữ cái");
    expect(docUnionKind(tot.replace('"A_B" | "C_D"', '"A_B" | "A_B"')).viPham.join("\n")).toContain("trùng");
    expect(docUnionKind(tot.replace('"A_B" | "C_D"', '"A_B" | "c_d"')).viPham.join("\n")).toContain("CHECK");
  });

  it("⑶ văn bản mẫu — lời gọi: literal đọc được (kể cả bí danh import, vật chủ bất kỳ, ngoặc); ba hình dạng của phép đo trước và mọi cách viết khác kind thì ĐỎ", () => {
    const tap = new Set(["UNSEAL_RFQ", "LOGIN_LINK_SEND"]);
    const doc = (s: string): KetQuaDocLoiGoi => docLoiGoi(s, "mau.ts", tap);
    expect(doc('await enqueueJob(c, o, { kind: "UNSEAL_RFQ", payload: { a: 1 }, dedupeKey: k });')).toEqual({
      goi: [{ ham: "(cấp tệp)", kind: "UNSEAL_RFQ" }],
      viPham: [],
    });
    expect(doc("async function xep() {\n  await enqueueJob(c, o, { kind: `LOGIN_LINK_SEND` });\n}").goi).toEqual([{ ham: "xep", kind: "LOGIN_LINK_SEND" }]);
    expect(doc('import { enqueueJob as xep } from "@trustprocure/outbox";\nawait xep(c, o, { kind: "UNSEAL_RFQ" });').goi.length).toBe(1);
    expect(doc('import * as outbox from "@trustprocure/outbox";\nawait outbox.enqueueJob(c, o, { kind: "UNSEAL_RFQ" });').goi.length).toBe(1);
    expect(doc('const kq = (enqueueJob)(c, o, ({ kind: ("UNSEAL_RFQ") }));').goi.length).toBe(1);
    const do_ = (s: string, mong: string): void => {
      const kq = doc(s);
      expect(kq.goi, s).toEqual([]);
      expect(kq.viPham.join("\n"), s).toContain(mong);
    };
    // Ba hình dạng của phép đo trước (§S1.9115 mục 3) — lọt ba mẫu văn bản cũ và lọt tsc khi `kind` còn là `string`.
    do_('const loaiViec = "THU_LOT_161";\nawait enqueueJob(c, o, { kind: loaiViec });', "tên (biến hay hằng)");
    do_("await enqueueJob(c, o, { kind: `THU_TEMPLATE_${so}` });", "template có biến");
    do_('await enqueueJob(c, o, { kind: ["THU", "JOIN", "161"].join("_") });', "lời gọi");
    // Hình dạng mà hình dạng ⑴ cũ bắt NHẦM thành kind `THU_` (đo trước).
    do_('await enqueueJob(c, o, { kind: "THU_" + "GHEP_161" });', "phép toán");
    // Hình dạng của mọi lời gọi sản xuất trước vòng này: một hằng — kể cả hằng mang hậu tố `_KIND`.
    do_('import { UNSEAL_JOB_KIND } from "./x.js";\nawait enqueueJob(c, o, { kind: UNSEAL_JOB_KIND });', "tên (biến hay hằng)");
    do_("await enqueueJob(c, o, { kind: KIND.UNSEAL });", "thuộc tính");
    do_('await enqueueJob(c, o, { kind: x as "UNSEAL_RFQ" });', "ép kiểu");
    do_('await enqueueJob(c, o, { kind: <"UNSEAL_RFQ">x });', "ép kiểu");
    do_('await enqueueJob(c, o, { kind: "UNSEAL_RFQ" as "UNSEAL_RFQ" });', "ép kiểu");
    do_('await enqueueJob(c, o, { kind: "UNSEAL_RFQ" satisfies string });', "satisfies");
    do_('await enqueueJob(c, o, { kind: co ? "UNSEAL_RFQ" : "LOGIN_LINK_SEND" });', "ba ngôi");
    do_("await enqueueJob(c, o, { kind });", "viết tắt");
    do_('await enqueueJob(c, o, { ["kind"]: "UNSEAL_RFQ" });', "tên tính toán");
    do_('await enqueueJob(c, o, { ...goc, kind: "UNSEAL_RFQ" });', "object trải");
    do_('await enqueueJob(c, o, { kind: "UNSEAL_RFQ", ...ghiDe });', "object trải");
    do_("await enqueueJob(c, o, { payload: {} });", "đúng một thuộc tính `kind`");
    do_("await enqueueJob(c, o, job);", "không phải object literal");
    // Hàm BỌC không lách được: lời gọi bên trong nó mang kind qua tham số — hay cả `job` qua tham số.
    do_("export async function xep(c: C, o: string, k: K): Promise<string> {\n  return enqueueJob(c, o, { kind: k });\n}", "tên (biến hay hằng)");
    do_("export function xep(c: C, o: string, job: J): Promise<string> {\n  return enqueueJob(c, o, job);\n}", "không phải object literal");
    do_("await enqueueJob(...thamSo);", "không trải");
    do_('await enqueueJob<string>(c, o, { kind: "UNSEAL_RFQ" });', "tham số kiểu");
    do_('// @ts-expect-error — kind lạ\nawait enqueueJob(c, o, { kind: "THU_LA_161" });', "không thuộc union");
    // Tham chiếu không phải lời gọi trực tiếp: cổng không đọc được kind qua các đường này, nên chính đường ấy là vi phạm.
    do_("const xep = enqueueJob;", "gán vào biến");
    do_('await enqueueJob.call(null, c, o, { kind: "UNSEAL_RFQ" });', "gọi gián tiếp");
    do_('await enqueueJob.apply(null, [c, o, { kind: "UNSEAL_RFQ" }]);', "gọi gián tiếp");
    do_("const xep = outbox.enqueueJob.bind(null);", "gọi gián tiếp");
    do_("await Promise.all(viec.map((v) => v)).then(() => enqueueJob);", "trả về");
    do_("await Reflect.apply(enqueueJob, null, [c, o, j]);", "truyền làm đối số");
    do_("const { enqueueJob: xep } = outbox;", "phá cấu trúc");
    // Không `await (…)(…)` ở đầu câu: văn bản mẫu không import hay export là một script, nơi đó là lời gọi hàm tên `await` (bài học §S1.72).
    do_('const kq = (0, enqueueJob)(c, o, { kind: "UNSEAL_RFQ" });', "biểu thức");
    do_('await outbox["enqueueJob"](c, o, { kind: "UNSEAL_RFQ" });', "gọi bằng chuỗi");
    do_('import { enqueueJob as xep } from "@trustprocure/outbox";\nconst goiLai = xep;', "gán vào biến");
    // Lượt tự soi §S1.9115: re-export đổi tên — lời gọi `xep(…)` ở mô-đun kia không mang tên nào cổng nhận ra.
    do_('export { enqueueJob as xepViec } from "@trustprocure/outbox";', "re-export đổi tên");
    do_('import { enqueueJob as xep } from "@trustprocure/outbox";\nexport { xep };', "re-export đổi tên");
    // Đối chứng: chú thích, JSDoc, chuỗi, import/export và vị trí KIỂU không phải tham chiếu giá trị.
    expect(
      doc(
        '// enqueueJob(c, o, { kind: bien })\n/** enqueueJob(c, o, { kind: bien }) */\nconst s = "enqueueJob(c, o, { kind: bien })";\n' +
          'import { enqueueJob } from "@trustprocure/outbox";\nexport { enqueueJob } from "./enqueue.js";\n' +
          "type J = Parameters<typeof enqueueJob>[2];\nconst o = { enqueueJob: 1 };",
      ),
    ).toEqual({ goi: [], viPham: [] });
    // Và chính khai báo hàm ở enqueue.ts.
    expect(doc("export async function enqueueJob(client: C, orgId: string, job: JobInput): Promise<string> {\n  return '';\n}")).toEqual({ goi: [], viPham: [] });
  });
});

// ----------------------------------------------------------------------------------------------
// Khoản 170 — gương test của runner `api`
// ----------------------------------------------------------------------------------------------

export interface DayNoiLoc {
  /** Số lời `new JobRunner(…)` trong tệp — vế đòi đúng một. */
  readonly soRunner: number;
  /** Đối số thứ hai (bảng handler) của lời `new JobRunner(…)` đầu tiên, bỏ khoảng trắng. */
  readonly bangHandler: string | null;
  /** Mô-đun mà hàm dựng bảng handler được import từ đó; `(cục bộ)` khi không import. */
  readonly nguonHandler: string | null;
  /** Mọi lần tên `kindKhongNguoiNhan` xuất hiện trong MÃ của tệp (không chú thích), mỗi lần là nút cha bỏ khoảng trắng, đã sắp. */
  readonly kindKhongNguoiNhan: readonly string[];
}

/** Dây nối mảng lọc `kind` của runner dựng trong một tệp: bảng handler (vế `Object.keys`) và sổ `kindKhongNguoiNhan` (vế hợp). */
export function docDayNoiLoc(vanBan: string): DayNoiLoc {
  const sf = cayCuPhap(vanBan);
  const runner: ts.NewExpression[] = [];
  const kindKhongNguoiNhan: string[] = [];
  duyetCay(sf, (n) => {
    if (ts.isNewExpression(n)) {
      const lop = boNgoac(n.expression);
      if ((ts.isIdentifier(lop) && lop.text === "JobRunner") || (ts.isPropertyAccessExpression(lop) && lop.name.text === "JobRunner")) runner.push(n);
    }
    if (ts.isIdentifier(n) && n.text === "kindKhongNguoiNhan") kindKhongNguoiNhan.push(gon(n.parent, sf));
  });
  const bang = runner[0]?.arguments?.[1];
  let nguonHandler: string | null = null;
  if (bang !== undefined) {
    const x = boNgoac(bang);
    const ham = ts.isCallExpression(x) && ts.isIdentifier(x.expression) ? x.expression.text : null;
    nguonHandler = "(cục bộ)";
    for (const cau of sf.statements) {
      if (!ts.isImportDeclaration(cau) || ham === null) continue;
      const rang = cau.importClause?.namedBindings;
      if (rang !== undefined && ts.isNamedImports(rang) && rang.elements.some((pt) => pt.name.text === ham)) {
        nguonHandler = ts.isStringLiteral(cau.moduleSpecifier) ? cau.moduleSpecifier.text : cau.moduleSpecifier.getText(sf);
      }
    }
  }
  return {
    soRunner: runner.length,
    bangHandler: bang === undefined ? null : gon(bang, sf),
    nguonHandler,
    kindKhongNguoiNhan: kindKhongNguoiNhan.sort(),
  };
}

const LOI_GUONG =
  "Runner của TEST (`apps/api/src/test-services.ts`) và runner THẬT (`apps/api/src/composition.ts`) lệch nhau ở dây nối mảng lọc `kind`: " +
  "bảng handler hay `kindKhongNguoiNhan`. Runner test nhặt loại việc khác runner thật thì mọi test đi qua `outboxTest` đo một đường không " +
  "ai chạy (khoản 149, 170). Sửa CẢ HAI tệp cùng lúc — và nhớ vế khoản 168 (`apps/api/src/composition.int.test.ts`): sổ mồ côi do worker " +
  "khai, `api` không khai.";

describe("[S1.9115 / khoản 170] runner của test `api` (`test-services.ts`) là gương của runner thật (`composition.ts`) ở dây nối mảng lọc `kind`", () => {
  it("hai lời `new JobRunner(…)` có cùng bảng handler (cùng nguồn import) và cùng mọi lần `kindKhongNguoiNhan` xuất hiện trong mã", () => {
    const that = docDayNoiLoc(readFileSync(join(GOC, "apps/api/src/composition.ts"), "utf8"));
    const guong = docDayNoiLoc(readFileSync(join(GOC, "apps/api/src/test-services.ts"), "utf8"));
    expect(that.soRunner, "chống rỗng ruột: composition.ts phải dựng ĐÚNG một runner — cổng không biết so runner nào").toBe(1);
    expect(guong.soRunner, "chống rỗng ruột: test-services.ts phải dựng ĐÚNG một runner — cổng không biết so runner nào").toBe(1);
    expect(that.bangHandler, "chống rỗng ruột: bảng handler của runner thật").toBe("buildApiOutboxHandlers(services)");
    expect(guong, LOI_GUONG).toEqual(that);
  });

  it("văn bản mẫu — gương lệch ở bảng handler, ở nguồn import, hay ở `kindKhongNguoiNhan` (kể cả qua một object trải) thì KHÁC; tuỳ chọn khác của test thì không", () => {
    const that =
      'import { buildApiOutboxHandlers } from "./outbox-api.js";\n' +
      "const runner = new JobRunner(pool, buildApiOutboxHandlers(services), {\n  pollIntervalMs: 5000,\n  listOrganizations: () => [...a],\n  onJobFailure: f,\n});";
    const guong =
      'import { buildApiOutboxHandlers } from "./outbox-api.js";\n' +
      "const runner = new JobRunner(pool, buildApiOutboxHandlers(services), { ...tuyChon, onJobFailure: (b) => { loi.push(b); } });";
    expect(docDayNoiLoc(guong)).toEqual(docDayNoiLoc(that));
    expect(docDayNoiLoc(that)).toEqual({
      soRunner: 1,
      bangHandler: "buildApiOutboxHandlers(services)",
      nguonHandler: "./outbox-api.js",
      kindKhongNguoiNhan: [],
    });
    const dong = "kindKhongNguoiNhan: Object.keys(KIND_KHONG_NGUOI_NHAN),";
    // Đo trước (§S1.9115 mục 3): dòng CHỈ ở gương — tsc 0, api composition.int 21/21 xanh.
    expect(docDayNoiLoc(guong.replace("{ ...tuyChon,", `{ ...tuyChon, ${dong}`))).not.toEqual(docDayNoiLoc(that));
    // Dòng CHỈ ở bản thật — vế khoản 168 cũng đỏ ở chiều này.
    expect(docDayNoiLoc(that.replace("pollIntervalMs: 5000,", `pollIntervalMs: 5000, ${dong}`))).not.toEqual(docDayNoiLoc(guong));
    // Cả hai cùng khai: gương khớp — phán xét về việc `api` có được khai hay không là của vế khoản 168, không của cổng này.
    expect(docDayNoiLoc(guong.replace("{ ...tuyChon,", `{ ...tuyChon, ${dong}`))).toEqual(
      docDayNoiLoc(that.replace("pollIntervalMs: 5000,", `pollIntervalMs: 5000, ${dong}`)),
    );
    // Sổ mồ côi đi qua một object riêng rồi trải vào tuỳ chọn: tên vẫn xuất hiện trong mã của tệp.
    expect(docDayNoiLoc(`const them = { ${dong} };\n${guong.replace("{ ...tuyChon,", "{ ...tuyChon, ...them,")}`).kindKhongNguoiNhan).toEqual([
      "kindKhongNguoiNhan:Object.keys(KIND_KHONG_NGUOI_NHAN)",
    ]);
    // Bảng handler của gương rộng hơn bản thật, hay dựng từ một mô-đun khác.
    expect(docDayNoiLoc(guong.replace("buildApiOutboxHandlers(services), {", "{ ...buildApiOutboxHandlers(services), THU: h }, {"))).not.toEqual(
      docDayNoiLoc(that),
    );
    expect(docDayNoiLoc(guong.replace("./outbox-api.js", "./outbox-thu.js")).nguonHandler).toBe("./outbox-thu.js");
    // Hai runner trong một tệp: vế thật đòi đúng một.
    expect(docDayNoiLoc(`${that}\nconst r2 = new outbox.JobRunner(pool, h, {});`).soRunner).toBe(2);
    // Chú thích kể lại dòng cũ không phải mã.
    expect(docDayNoiLoc(`${guong}\n// ~~${dong}~~`).kindKhongNguoiNhan).toEqual([]);
  });
});
