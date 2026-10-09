// ==============================================================================================
// [S1.209 / khoản 135] VIỆC SAU COMMIT — CLOSURE KHÔNG CHẠM `ctx.client`, VÀ HÀM GHI TRONG `bu`/`khiXong` NẰM TRONG MÃ QUYỀN CỦA ROUTE
//
// Việc sau commit — thường (`afterCommit`), có bù (`afterCommitCoBu`), theo lô (`afterCommitLoGui`) — chạy khi giao dịch của bộ điều
// phối đã COMMIT và kết nối của handler đã về pool (`apps/api/src/dispatch.ts`). Closure ấy do handler viết nên nó THẤY `ctx`, gồm
// `ctx.client`: một closure dùng `ctx.client` chạy câu lệnh trên một kết nối rảnh, hay đang ở trong giao dịch của yêu cầu KHÁC, dưới
// GUC của tổ chức KHÁC. Và phần bù (`bu`) cùng việc xong (`khiXong`) chạy trong giao dịch MỚI, KHÔNG đi qua cổng quyền lần nữa: nó
// làm việc dưới mã quyền route đã kiểm, nên chỉ được gọi hàm ghi mà chính mã quyền ấy phủ. Tới S1.209, cả hai điều chỉ có docstring
// của `route-types.ts` canh (lượt soi 64a-7, 64a-8); §S1.95 đếm *"đúng HAI chỗ đăng ký"* — lời khai ấy đã thiu: hôm nay là NĂM (một
// `afterCommit` ở `routes/anon.ts`, ba `afterCommitCoBu` và một `afterCommitLoGui` ở `routes/buyer.ts`), và vế dưới đếm lại.
//
// VÌ SAO LÀ MỘT CỔNG ĐỌC CÂY CÚ PHÁP CHỨ KHÔNG PHẢI KIỂU: đề xuất *"truyền cho closure một ngữ cảnh không có `client`"* KHÔNG chặn được
// gì lúc biên dịch — closure bắt `ctx` theo PHẠM VI TỪ VỰNG của handler, không qua tham số; đổi kiểu của tham số closure không đổi thứ
// nó nhìn thấy. TypeScript không có cách nói *"hàm này không được đóng lên biến kia"*. Nên lớp canh là một phép đọc cây cú pháp
// (`ts.createSourceFile`, cùng khuôn `ghi-so-tu-choi-mot-duong.test.ts`), tách thành hàm thuần để đo được bằng văn bản mẫu.
//
// HAI VẾ, mỗi vế trên MỌI lời gọi `<ctx>.afterCommit*(…)` trong `apps/api/src/routes/**` (tệp đã vào kho, không test):
//   ⑴ Trong đối số của lời gọi: không `<ctx>.client` (kể cả `?.`, `["client"]`), không bí danh của nó khai trong handler
//      (`const c = ctx.client`, `const { client } = ctx`, `const { client: c } = ctx`), và không truyền nguyên `<ctx>` cho ai
//      (một hàm nhận cả `ctx` thì cổng không đọc xuyên qua được — fail-closed).
//   ⑵ Trong `bu` và `khiXong` (của việc có bù, và của từng lần gửi trong lô): mọi lời gọi hàm GÓI (tên import từ `@trustprocure/*`)
//      phải nằm trong `HAM_BU_THEO_MA_QUYEN[<mã quyền của route>]` — bảng ĐÓNG dưới đây, khoá là khoá của `PERMISSIONS`, đọc từ
//      chính `permission: PERMISSIONS.X` của route bao quanh. Route không có mã quyền (tự thân, vô danh) thì không hàm gói nào được
//      gọi ở đó. Và: không SQL tay (`.query(`), không gọi hàm cục bộ (cổng không đọc xuyên qua nó). Cả hai là fail-closed: thứ không
//      đọc được thì đỏ, không im.
//      [S1.238 / khoản 264] Và mọi lời gọi QUA THUỘC TÍNH (`x.f(…)`, `x["f"](…)`, kể cả `new x.F(…)`): vật chủ là namespace import
//      từ `@trustprocure/*` (`import * as inv`) ⇒ đọc NHƯ TÊN GÓI, `inv.f` đi qua đúng bảng trên; vật chủ thuộc TẬP TRẮNG nhỏ, có tên —
//      `Promise`, `JSON`, `Array`, `Object` (tên toàn cục, không khai trong tệp) và tham số kết nối của CHÍNH hàm bù (`bu: async
//      (client) => …`; `.query` trên nó vẫn là SQL tay) ⇒ sạch; MỌI vật chủ khác — một biến, `ctx.services.x`, kết quả một lời gọi,
//      một thuộc tính tính toán — và mọi hình dạng lời gọi khác (`(0, f)(…)`, `import(…)`) ⇒ ĐỎ. Tên phân giải theo KÝ HIỆU (chương
//      trình TypeScript một tệp có binder, cùng khuôn `pool-nghe-du-tin-hieu.test.ts`), không theo chữ: `const Promise = …` hay
//      `const client = …` che tập trắng thì không còn là tập trắng, và một biến cục bộ che tên import (`const revokeInvitation =
//      createSupplier`) là hàm cục bộ.
//   ⑶ VIẾT TẠI CHỖ: đối số của lời gọi đăng ký phải là một hàm hay một object literal, và `viec`/`gui`/`bu`/`khiXong` phải là hàm viết
//      ngay tại thuộc tính (cho phép `undefined`, và biểu thức ba ngôi mà mỗi nhánh là hàm/`undefined` — hình dạng `khiXong` của
//      `POST /invitations/:invitationId/reissue`). Một closure tạo ở NGOÀI rồi truyền vào (`const v = () => …; ctx.afterCommit(v)`,
//      `bu: thuHoi`, `{ bu }`) là thứ hai vế trên không đọc xuyên qua được, nên đỏ — không im.
//
// PHÁT BIỂU ĐÚNG MỨC: cổng đọc theo TÊN và theo HÌNH DẠNG cú pháp. Nó mù với `ctx` đi qua `this`, `arguments`, `eval`~~, và với một hàm
// gói gọi qua thuộc tính của vật chủ (`goi.revokeInvitation(…)`, `import * as goi` — không import tên trần thì không nhận ra là hàm
// gói; luật *"gọi hàm cục bộ"* chỉ bắt vật chủ là tên trần, còn qua thuộc tính thì mù — khoản 264)~~ **[S1.238 / khoản 264]** (lời
// gọi qua thuộc tính nay fail-closed ở ⑵ — xem trên). Vế ⑵ KHÔNG kiểm `viec`/`gui`
// (phần gửi) theo mã quyền: chúng gọi bộ gửi tiêm vào, không cầm `client` nào. [S1.238 / khoản 264] Vế ⑵ chỉ thấy lời gọi VIẾT RA
// (`f(…)`, `new F(…)`, `` f`…` ``): lời gọi NGẦM — getter, `await` trên một thenable, bộ lặp của `for…of`/spread, ép kiểu gọi
// `toString`, và một hàm cục bộ khai NGOÀI hàm bù truyền làm callback cho phương thức của tập trắng (`Array.from([client], f)`,
// `JSON.parse(s, f)`) — không phải một lời gọi hàm ghi viết ra, nên không được đọc (lượt soi đối kháng đo bốn hình dạng ấy: 0 vi
// phạm — khoản 289); hôm nay không `bu`/`khiXong` thật nào có vòng lặp, getter, spread hay callback.
// Mỗi lỗ nói ra ở đây là một lỗ, không phải một lời khai đã đóng.
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@trustprocure/identity";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

const HAM_DANG_KY = ["afterCommit", "afterCommitCoBu", "afterCommitLoGui"] as const;
type HamDangKy = (typeof HAM_DANG_KY)[number];
const HAM_BU = ["bu", "khiXong"] as const;
/** Thuộc tính phải là hàm viết TẠI CHỖ (vế ⑶): cả phần gửi lẫn phần bù — thứ không viết tại chỗ thì hai vế trên không đọc được. */
const HAM_TAI_CHO = ["viec", "gui", "bu", "khiXong"] as const;

/**
 * BẢNG ĐÓNG — mã quyền của route (khoá của `PERMISSIONS`) ⇒ những hàm GÓI mà `bu`/`khiXong` của việc sau commit route ấy đăng ký được
 * gọi. Thêm một dòng là một QUYẾT ĐỊNH: hàm ấy ghi gì, và mã quyền ấy có thật sự phủ lần ghi ấy không.
 *
 *   RFQ_OPEN   — `POST /rfqs/:rfqId/open` (ADR-113): gửi hỏng ⇒ thu hồi token vừa đúc; gửi được ⇒ lời mời `UNSENT→SENT`.
 *   RFQ_INVITE — `POST /rfqs/:rfqId/invitations` và `POST /invitations/:invitationId/reissue` (khoản 124, ADR-110, ADR-113): gửi hỏng ⇒
 *                thu hồi lời mời (MVP1) hay thu hồi token vừa đúc (S3); gửi được ⇒ `UNSENT→SENT`.
 */
const HAM_BU_THEO_MA_QUYEN: Readonly<Record<string, readonly string[]>> = {
  RFQ_OPEN: ["danhDauDaGui", "revokeMagicLinkToken"],
  RFQ_INVITE: ["danhDauDaGui", "revokeInvitation", "revokeMagicLinkToken"],
  // [S1.9101 / S3.7a1] `POST /suppliers/:supplierId/passport-requests`: gửi link Passport hỏng ⇒ thu hồi token vừa đúc (ADR-110).
  SUPPLIER_QUALIFY: ["thuHoiTokenPassport"],
};
/** Gói xuất từng hàm của bảng trên — để bảng là một phép đo trên export thật, không phải một danh sách tên. */
const GOI_CUA_HAM_BU: Readonly<Record<string, string>> = {
  danhDauDaGui: "@trustprocure/invitation",
  revokeInvitation: "@trustprocure/invitation",
  revokeMagicLinkToken: "@trustprocure/invitation",
  thuHoiTokenPassport: "@trustprocure/invitation",
};
/** Hàm toàn cục được gọi trần trong `bu`/`khiXong` mà không phải hàm cục bộ của tệp. */
const HAM_TOAN_CUC = new Set(["String", "Number", "Boolean", "Array", "Object", "Promise", "Symbol", "BigInt", "Date", "Error"]);
/**
 * [S1.238 / khoản 264] TẬP TRẮNG vật chủ của lời gọi qua thuộc tính trong `bu`/`khiXong` — tên toàn cục (không khai trong tệp) không
 * mang năng lực ghi nào của kho. Cộng MỘT vật chủ không nằm ở đây vì nó không có tên cố định: tham số kết nối của chính hàm bù.
 */
const VAT_CHU_TOAN_CUC = new Set(["Promise", "JSON", "Array", "Object"]);

export interface ChoDangKy {
  readonly tep: string;
  readonly dong: number;
  readonly ham: HamDangKy;
  /** `METHOD /path` của route bao quanh, hay `?` khi không tìm thấy route. */
  readonly route: string;
  /** Khoá của `PERMISSIONS` đọc từ `permission: PERMISSIONS.X`; `null` khi route không khai mã quyền (tự thân, vô danh, khách). */
  readonly maQuyen: string | null;
  /** Tên các hàm bù (`bu`, `khiXong`) tìm thấy trong đối số, theo thứ tự xuất hiện. */
  readonly hamBu: readonly string[];
}

export interface KetQuaDoc {
  readonly choDangKy: readonly ChoDangKy[];
  readonly viPham: readonly string[];
}

/**
 * ~~`cayCuPhap` — chỉ cây cú pháp.~~ [S1.238 / khoản 264] Chương trình TypeScript MỘT TỆP (`noResolve`, `noLib`), cùng khuôn
 * `pool-nghe-du-tin-hieu.test.ts`: binder phân giải mỗi tên về đúng khai báo của nó trong tệp (import ⇒ gói và tên xuất, kể cả
 * `import * as`), nên vế ⑵ đọc theo KÝ HIỆU — một biến cục bộ che một tên import hay một tên của tập trắng không lừa được nó. Không
 * đi theo import ra ngoài tệp; tên toàn cục (`Promise`, `JSON`…) không có khai báo nào trong tệp vì không nạp lib.
 */
function docChuongTrinh(vanBan: string, ten: string): { readonly sf: ts.SourceFile; readonly ch: ts.TypeChecker } {
  const tuyChon: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
  };
  const host = ts.createCompilerHost(tuyChon, true);
  host.getSourceFile = (f, l) => (f === ten ? ts.createSourceFile(ten, vanBan, l, true, ts.ScriptKind.TS) : undefined);
  host.fileExists = (f) => f === ten;
  host.readFile = (f) => (f === ten ? vanBan : undefined);
  host.writeFile = () => undefined;
  const chuongTrinh = ts.createProgram({ rootNames: [ten], options: tuyChon, host });
  const sf = chuongTrinh.getSourceFile(ten);
  if (sf === undefined) throw new Error(`không dựng được cây cú pháp của ${ten}`);
  return { sf, ch: chuongTrinh.getTypeChecker() };
}

/** Bỏ các lớp bọc không đổi giá trị: ngoặc, `!`, `as`, `satisfies`, `<T>x`. */
function boBoc(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) {
    x = x.expression;
  }
  return x;
}

/**
 * ~~`tenImportGoi(sf)` — bản đồ TÊN cục bộ ⇒ tên gốc, chỉ `import { a as b }`.~~ [S1.238 / khoản 264] Nguồn của MỘT ký hiệu: gói và
 * tên xuất nếu khai báo của nó là một import giá trị (bí danh đã bỏ; `*` cho `import * as`, `default` cho import mặc định); `null`
 * cho mọi khai báo khác (biến, tham số, hàm cục bộ) và cho tên không khai trong tệp.
 */
interface NguonImport {
  readonly goi: string;
  readonly ten: string;
}

function nguonImportCua(kyHieu: ts.Symbol | undefined): NguonImport | null {
  const d = kyHieu?.declarations?.[0];
  if (d === undefined) return null;
  const tuGoi = (e: ts.Expression): string => (ts.isStringLiteralLike(e) ? e.text : "");
  if (ts.isImportSpecifier(d)) {
    const menhDe = d.parent.parent;
    return d.isTypeOnly || menhDe.isTypeOnly ? null : { goi: tuGoi(menhDe.parent.moduleSpecifier), ten: (d.propertyName ?? d.name).text };
  }
  if (ts.isNamespaceImport(d)) return d.parent.isTypeOnly ? null : { goi: tuGoi(d.parent.parent.moduleSpecifier), ten: "*" };
  if (ts.isImportClause(d)) return d.isTypeOnly ? null : { goi: tuGoi(d.parent.moduleSpecifier), ten: "default" };
  return null;
}

const laGoiKho = (ng: NguonImport | null): ng is NguonImport => ng !== null && ng.goi.startsWith("@trustprocure/");

/** Tên KHÔNG khai trong tệp — toàn cục (không nạp lib nên không có khai báo nào), không bị một khai báo cục bộ che. */
function laToanCuc(kyHieu: ts.Symbol | undefined, sf: ts.SourceFile): boolean {
  return !(kyHieu?.declarations ?? []).some((d) => d.getSourceFile() === sf);
}

function tenThuocTinh(n: ts.PropertyName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

/** Truy cập thuộc tính `client` trên biểu thức `x`: `x.client`, `x?.client`, `x["client"]`. */
function laClientCua(n: ts.Node, tenCtx: string): boolean {
  if (ts.isPropertyAccessExpression(n)) {
    const goc = boBoc(n.expression);
    return ts.isIdentifier(goc) && goc.text === tenCtx && n.name.text === "client";
  }
  if (ts.isElementAccessExpression(n)) {
    const goc = boBoc(n.expression);
    const khoa = n.argumentExpression;
    return ts.isIdentifier(goc) && goc.text === tenCtx && (ts.isStringLiteral(khoa) || ts.isNoSubstitutionTemplateLiteral(khoa)) && khoa.text === "client";
  }
  return false;
}

/** Route bao quanh: object literal gần nhất có ba thuộc tính `method`, `path`, `handler`. */
function routeBaoQuanh(n: ts.Node): ts.ObjectLiteralExpression | null {
  let x: ts.Node | undefined = n.parent;
  while (x !== undefined) {
    if (ts.isObjectLiteralExpression(x)) {
      const ten = new Set(x.properties.map((p) => (p.name === undefined ? null : tenThuocTinh(p.name))));
      if (ten.has("method") && ten.has("path") && ten.has("handler")) return x;
    }
    x = x.parent;
  }
  return null;
}

function thuocTinhCua(o: ts.ObjectLiteralExpression, ten: string): ts.Expression | null {
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && tenThuocTinh(p.name) === ten) return p.initializer;
  }
  return null;
}

function chuoiCua(e: ts.Expression | null): string {
  if (e === null) return "?";
  const x = boBoc(e);
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : "?";
}

/** Khoá của `PERMISSIONS` từ `permission: PERMISSIONS.X`; `null` khi không khai; `"?"` khi khai bằng hình dạng khác (không đọc được). */
function maQuyenCua(route: ts.ObjectLiteralExpression): string | null {
  const e = thuocTinhCua(route, "permission");
  if (e === null) return null;
  const x = boBoc(e);
  if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "PERMISSIONS") return x.name.text;
  return "?";
}

/** Bí danh của `<ctx>.client` khai trong thân handler: `const c = ctx.client`, `const { client } = ctx`, `const { client: c } = ctx`. */
function biDanhClient(handler: ts.Node, tenCtx: string): ReadonlySet<string> {
  const ra = new Set<string>();
  const duyet = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer !== undefined) {
      const kt = boBoc(n.initializer);
      if (ts.isIdentifier(n.name) && laClientCua(kt, tenCtx)) ra.add(n.name.text);
      if (ts.isObjectBindingPattern(n.name) && ts.isIdentifier(kt) && kt.text === tenCtx) {
        for (const pt of n.name.elements) {
          const goc = pt.propertyName === undefined ? (ts.isIdentifier(pt.name) ? pt.name.text : null) : tenThuocTinh(pt.propertyName);
          if (goc === "client" && ts.isIdentifier(pt.name)) ra.add(pt.name.text);
        }
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(handler);
  return ra;
}

function tenThamSo(f: ts.SignatureDeclaration): readonly string[] {
  const ra: string[] = [];
  const them = (b: ts.BindingName): void => {
    if (ts.isIdentifier(b)) ra.push(b.text);
    else for (const pt of b.elements) if (ts.isBindingElement(pt)) them(pt.name);
  };
  for (const p of f.parameters) them(p.name);
  return ra;
}

/** Vế ⑶: một hàm viết TẠI CHỖ — hàm/arrow, `undefined`, hay biểu thức ba ngôi mà mỗi nhánh là một trong hai thứ ấy. */
function laVietTaiCho(e: ts.Expression): boolean {
  const x = boBoc(e);
  if (ts.isFunctionLike(x)) return true;
  if (ts.isIdentifier(x) && x.text === "undefined") return true;
  if (ts.isConditionalExpression(x)) return laVietTaiCho(x.whenTrue) && laVietTaiCho(x.whenFalse);
  return false;
}

/**
 * Vế ⑴ trên MỘT cây con (một đối số của lời gọi đăng ký): `<ctx>.client`, bí danh của nó (trừ khi một hàm bên trong che tên ấy bằng tham
 * số), và `<ctx>` trần không phải vật chủ của một truy cập thuộc tính.
 */
function timChamClient(goc: ts.Node, tenCtx: string, biDanh: ReadonlySet<string>, ke: (loi: string) => void): void {
  const duyet = (n: ts.Node, bd: ReadonlySet<string>): void => {
    if (laClientCua(n, tenCtx)) {
      ke(`closure chạm \`${tenCtx}.client\``);
      return;
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      // `ctx.orgId`, `ctx.services.x.send`, `c.query` — vật chủ là một tên trần: đọc tên ấy (bí danh thì đỏ), KHÔNG coi là truyền nguyên.
      const vatChu = boBoc(n.expression);
      if (ts.isIdentifier(vatChu)) {
        if (bd.has(vatChu.text)) ke(`closure chạm bí danh \`${vatChu.text}\` của \`${tenCtx}.client\``);
      } else {
        duyet(n.expression, bd);
      }
      if (ts.isElementAccessExpression(n)) duyet(n.argumentExpression, bd);
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      if (ts.isComputedPropertyName(n.name)) duyet(n.name.expression, bd);
      duyet(n.initializer, bd);
      return;
    }
    if (ts.isFunctionLike(n)) {
      const che = new Set(bd);
      for (const t of tenThamSo(n)) che.delete(t);
      ts.forEachChild(n, (con) => {
        duyet(con, che);
      });
      return;
    }
    if (ts.isIdentifier(n)) {
      if (bd.has(n.text)) ke(`closure chạm bí danh \`${n.text}\` của \`${tenCtx}.client\``);
      else if (n.text === tenCtx) ke(`closure truyền nguyên \`${tenCtx}\` — cổng không đọc xuyên qua được`);
      return;
    }
    ts.forEachChild(n, (con) => {
      duyet(con, bd);
    });
  };
  duyet(goc, biDanh);
}

/**
 * Vế ⑵ trên MỘT hàm bù (`than`: hàm viết tại chỗ, ba ngôi của hai hàm, hay một phương thức): mọi lời gọi hàm gói phải nằm trong danh
 * sách của mã quyền; không SQL tay; không hàm cục bộ; và [S1.238 / khoản 264] mọi lời gọi qua thuộc tính phải có vật chủ là namespace
 * import của kho (đọc như tên gói) hay nằm trong tập trắng — còn lại, và mọi hình dạng lời gọi khác, ĐỎ. Mỗi tên đọc theo KÝ HIỆU (`ch`).
 */
function timHamGhiNgoaiQuyen(
  than: ts.Node,
  tenHam: string,
  maQuyen: string | null,
  ch: ts.TypeChecker,
  sf: ts.SourceFile,
  ke: (loi: string) => void,
): void {
  const duocPhep = maQuyen === null ? [] : (HAM_BU_THEO_MA_QUYEN[maQuyen] ?? []);
  const kiemHamGoi = (goc: string, qua: string): void => {
    if (maQuyen === null) ke(`\`${tenHam}\` gọi hàm gói \`${goc}\`${qua} trong route KHÔNG có mã quyền`);
    else if (maQuyen === "?") ke(`\`${tenHam}\` gọi hàm gói \`${goc}\`${qua} mà mã quyền của route không đọc được (không phải \`PERMISSIONS.X\`)`);
    else if (!duocPhep.includes(goc)) ke(`\`${tenHam}\` gọi hàm gói \`${goc}\`${qua} ngoài danh sách của mã quyền \`${maQuyen}\``);
  };
  // [S1.238 / khoản 264] Tham số kết nối: tham số ĐẦU của chính hàm bù (mỗi nhánh của ba ngôi là một hàm) — bộ chạy trao kết nối của
  // giao dịch mới ở đó. Theo KÝ HIỆU: một `const client` khai trong thân che nó thì là một ký hiệu khác.
  const thamSoKetNoi = new Set<ts.Symbol>();
  const gomHamGoc = (n: ts.Node): void => {
    const x = ts.isExpression(n) ? boBoc(n) : n;
    if (ts.isFunctionLike(x)) {
      const dau = x.parameters[0];
      const kh = dau !== undefined && ts.isIdentifier(dau.name) ? ch.getSymbolAtLocation(dau.name) : undefined;
      if (kh !== undefined) thamSoKetNoi.add(kh);
    } else if (ts.isConditionalExpression(x)) {
      gomHamGoc(x.whenTrue);
      gomHamGoc(x.whenFalse);
    }
  };
  gomHamGoc(than);
  const ngan = (n: ts.Node): string => {
    const t = n.getText(sf).replace(/\s+/gu, " ");
    return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  };
  const docLoiGoi = (bieuThuc: ts.Expression, dau: string): void => {
    const goi = boBoc(bieuThuc);
    if (ts.isIdentifier(goi)) {
      const kh = ch.getSymbolAtLocation(goi);
      const ng = nguonImportCua(kh);
      if (laGoiKho(ng) && ng.ten !== "*" && ng.ten !== "default") kiemHamGoi(ng.ten, "");
      else if (!(laToanCuc(kh, sf) && HAM_TOAN_CUC.has(goi.text))) ke(`\`${tenHam}\` gọi hàm cục bộ \`${goi.text}\` — cổng không đọc xuyên qua nó`);
      return;
    }
    if (ts.isPropertyAccessExpression(goi) || ts.isElementAccessExpression(goi)) {
      const thuocTinh = ts.isPropertyAccessExpression(goi)
        ? goi.name.text
        : ts.isStringLiteralLike(goi.argumentExpression)
          ? goi.argumentExpression.text
          : null;
      if (thuocTinh === "query") {
        ke(`\`${tenHam}\` chạy SQL tay (\`.query(\`) — không mã quyền nào phủ một câu lệnh viết tay`);
        return;
      }
      if (thuocTinh === null) {
        ke(`\`${tenHam}\` gọi qua thuộc tính tính toán \`${ngan(goi)}\` — cổng không đọc được tên hàm`);
        return;
      }
      const vatChu = boBoc(goi.expression);
      if (!ts.isIdentifier(vatChu)) {
        ke(`\`${tenHam}\` gọi \`${dau}${ngan(goi)}(…)\` qua thuộc tính của một biểu thức (vật chủ không phải tên trần) — cổng không đọc xuyên qua được`);
        return;
      }
      const kh = ch.getSymbolAtLocation(vatChu);
      const ng = nguonImportCua(kh);
      if (laGoiKho(ng) && ng.ten === "*") kiemHamGoi(thuocTinh, ` (qua namespace \`${vatChu.text}\`)`);
      else if (!((kh !== undefined && thamSoKetNoi.has(kh)) || (laToanCuc(kh, sf) && VAT_CHU_TOAN_CUC.has(vatChu.text)))) {
        ke(
          `\`${tenHam}\` gọi \`${dau}${ngan(goi)}(…)\` qua thuộc tính của vật chủ \`${vatChu.text}\` ngoài tập trắng ` +
            "(Promise, JSON, Array, Object, tham số kết nối của chính nó) — cổng không đọc xuyên qua được",
        );
      }
      return;
    }
    // Hàm gọi ngay tại chỗ: thân nó là con của nút này và được duyệt như mọi nút con.
    if (ts.isFunctionLike(goi)) return;
    ke(`\`${tenHam}\` gọi một biểu thức \`${ngan(goi)}\` — cổng không đọc được hàm nào được gọi`);
  };
  /** `x` đứng ở vị trí BỊ GỌI của một lời gọi (`x(…)`, `new x(…)`, `` x`…` ``), xuyên qua ngoặc, `!`, `as`, `satisfies`. */
  const laBiGoi = (x: ts.Node): boolean => {
    let y = x;
    while (
      ts.isParenthesizedExpression(y.parent) ||
      ts.isNonNullExpression(y.parent) ||
      ts.isAsExpression(y.parent) ||
      ts.isSatisfiesExpression(y.parent) ||
      ts.isTypeAssertionExpression(y.parent)
    ) {
      y = y.parent;
    }
    const cha = y.parent;
    return ((ts.isCallExpression(cha) || ts.isNewExpression(cha)) && cha.expression === y) || (ts.isTaggedTemplateExpression(cha) && cha.tag === y);
  };
  /**
   * [S1.238 / khoản 264] Một import giá trị của kho chỉ được xuất hiện trong hàm bù ở vị trí BỊ GỌI trực tiếp — tên trần `f(…)`, hay
   * vật chủ namespace của `ns.f(…)`. Mọi chỗ khác (đối số, gán, trả về, viết tắt `{ f }`) là một tham chiếu mà một hàm khác gọi hộ —
   * `Array.from([client], ncc.createSupplier)` đi qua tập trắng (`Array`) và không để lại lời gọi nào của `createSupplier` cho vế ⑵ đọc.
   */
  const kiemThamChieuGoi = (n: ts.Identifier): void => {
    const cha = n.parent;
    const kh = ts.isShorthandPropertyAssignment(cha) && cha.name === n ? ch.getShorthandAssignmentValueSymbol(cha) : ch.getSymbolAtLocation(n);
    const ng = nguonImportCua(kh);
    if (!laGoiKho(ng)) return;
    let y: ts.Node = n;
    while (ts.isParenthesizedExpression(y.parent) || ts.isNonNullExpression(y.parent) || ts.isAsExpression(y.parent)) y = y.parent;
    const laVatChuBiGoi = ng.ten === "*" && (ts.isPropertyAccessExpression(y.parent) || ts.isElementAccessExpression(y.parent)) && y.parent.expression === y && laBiGoi(y.parent);
    if (!(laBiGoi(n) && ng.ten !== "*") && !laVatChuBiGoi) {
      ke(`\`${tenHam}\` dùng \`${n.text}\` (import từ ${ng.goi}) không ở vị trí bị gọi trực tiếp — một hàm khác gọi nó thì cổng không thấy`);
    }
  };
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) docLoiGoi(n.expression, "");
    else if (ts.isNewExpression(n)) docLoiGoi(n.expression, "new ");
    else if (ts.isTaggedTemplateExpression(n)) docLoiGoi(n.tag, "");
    else if (ts.isIdentifier(n)) kiemThamChieuGoi(n);
    ts.forEachChild(n, duyet);
  };
  duyet(than);
}

/** Đọc MỘT văn bản mã: mọi lời gọi `<ctx>.afterCommit*(…)`, route bao quanh, và vi phạm của hai vế. Thuần — đo được bằng văn bản mẫu. */
export function docViecSauCommit(vanBan: string, tep = "mau.ts"): KetQuaDoc {
  const { sf, ch } = docChuongTrinh(vanBan, tep);
  const choDangKy: ChoDangKy[] = [];
  const viPham: string[] = [];
  const duyet = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const ham = n.expression.name.text;
      const vatChu = boBoc(n.expression.expression);
      if ((HAM_DANG_KY as readonly string[]).includes(ham) && ts.isIdentifier(vatChu)) {
        const tenCtx = vatChu.text;
        const dong = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const route = routeBaoQuanh(n);
        const tenRoute = route === null ? "?" : `${chuoiCua(thuocTinhCua(route, "method"))} ${chuoiCua(thuocTinhCua(route, "path"))}`;
        const maQuyen = route === null ? "?" : maQuyenCua(route);
        const handler = route === null ? null : thuocTinhCua(route, "handler");
        const dau = `${tep}:${String(dong)} ${ham} (${tenRoute})`;
        const ke = (loi: string): void => {
          viPham.push(`${dau}: ${loi}`);
        };
        if (route === null) ke("không tìm thấy route bao quanh — không đọc được mã quyền");
        const biDanh = handler === null ? new Set<string>() : biDanhClient(handler, tenCtx);
        const hamBu: string[] = [];
        for (const doiSo of n.arguments) {
          // Vế ⑶ ở đối số: một biến (`ctx.afterCommit(v)`) hay một lời gọi trả về closure thì hai vế dưới không đọc xuyên qua được.
          const gocDoiSo = boBoc(doiSo);
          if (!ts.isFunctionLike(gocDoiSo) && !ts.isObjectLiteralExpression(gocDoiSo)) {
            ke(`đối số của \`${ham}\` không viết TẠI CHỖ (không phải hàm hay object literal) — cổng không đọc xuyên qua biến`);
          }
          timChamClient(doiSo, tenCtx, biDanh, ke);
          const duyetBu = (m: ts.Node): void => {
            const tenM = ts.isPropertyAssignment(m) || ts.isMethodDeclaration(m) ? (tenThuocTinh(m.name) ?? "") : ts.isShorthandPropertyAssignment(m) ? m.name.text : "";
            const laTaiCho = (HAM_TAI_CHO as readonly string[]).includes(tenM);
            const laBu = (HAM_BU as readonly string[]).includes(tenM);
            if (laBu) hamBu.push(tenM);
            if (ts.isPropertyAssignment(m) && laTaiCho) {
              if (!laVietTaiCho(m.initializer)) ke(`\`${tenM}\` tham chiếu qua biến — phải viết TẠI CHỖ để cổng đọc được`);
              if (laBu) timHamGhiNgoaiQuyen(m.initializer, tenM, maQuyen, ch, sf, ke);
            } else if (ts.isMethodDeclaration(m) && laBu) {
              // ~~`m.body`~~ [S1.238 / khoản 264] Cả phương thức: tham số đầu của nó là tham số kết nối (tập trắng của vế ⑵).
              if (m.body !== undefined) timHamGhiNgoaiQuyen(m, tenM, maQuyen, ch, sf, ke);
            } else if (ts.isShorthandPropertyAssignment(m) && laTaiCho) {
              ke(`\`${tenM}\` tham chiếu qua biến — phải viết TẠI CHỖ để cổng đọc được`);
            }
            ts.forEachChild(m, duyetBu);
          };
          duyetBu(doiSo);
        }
        choDangKy.push({ tep, dong, ham: ham as HamDangKy, route: tenRoute, maQuyen, hamBu });
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return { choDangKy, viPham };
}

/** Tệp route của `apps/api` ĐÃ VÀO KHO, không test — cùng tiêu chí với `routes.test.ts` và `cong-quyen-route.test.ts`. */
function tepRoute(): readonly string[] {
  return execFileSync("git", ["ls-files", "--", "apps/api/src/routes"], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((d) => d.endsWith(".ts") && !d.includes(".test."))
    .map((d) => d.replace(/\\/g, "/"));
}

function docKho(): KetQuaDoc {
  const cho: ChoDangKy[] = [];
  const vp: string[] = [];
  for (const t of tepRoute()) {
    const kq = docViecSauCommit(readFileSync(join(GOC, t), "utf8").replace(/\r\n/gu, "\n"), t);
    cho.push(...kq.choDangKy);
    vp.push(...kq.viPham);
  }
  return { choDangKy: cho, viPham: vp };
}

// Văn bản mẫu: một route ghi có mã quyền `RFQ_INVITE`, viết theo đúng khuôn của `routes/buyer.ts`.
function mauRoute(tenCtx: string, thanHandler: string, dau = 'permission: PERMISSIONS.RFQ_INVITE, resourceType: "INVITATION",'): string {
  return [
    'import { PERMISSIONS } from "@trustprocure/identity";',
    'import { revokeInvitation, danhDauDaGui } from "@trustprocure/invitation";',
    'import { createSupplier } from "@trustprocure/supplier";',
    "export const R = [{",
    `  method: "POST", path: "/x", audience: "BUYER", mutates: true, ${dau}`,
    `  handler: async (${tenCtx}) => {`,
    thanHandler,
    "    return { status: 200, body: {} };",
    "  },",
    "}];",
  ].join("\n");
}

describe("[S1.209 / khoản 135] việc sau commit: closure không chạm `ctx.client`, hàm ghi trong `bu`/`khiXong` nằm trong mã quyền của route", () => {
  it("bảng `HAM_BU_THEO_MA_QUYEN` là một phép đo: mỗi khoá là khoá thật của `PERMISSIONS`, mỗi hàm là export thật của gói nó khai", async () => {
    for (const [ma, cacHam] of Object.entries(HAM_BU_THEO_MA_QUYEN)) {
      expect(Object.keys(PERMISSIONS), `\`${ma}\` không phải khoá của PERMISSIONS`).toContain(ma);
      expect(cacHam.length, `mã quyền \`${ma}\` có danh sách rỗng — xoá dòng đi thay vì để một dòng trống`).toBeGreaterThan(0);
      for (const h of cacHam) {
        const goi = GOI_CUA_HAM_BU[h];
        expect(goi, `hàm \`${h}\` không khai gói xuất nó`).toBeDefined();
        const mod = (await import(/* @vite-ignore */ goi ?? "")) as Record<string, unknown>;
        expect(typeof mod[h], `\`${h}\` không phải export hàm của ${goi ?? "?"}`).toBe("function");
      }
    }
  });

  it("`apps/api/src/routes/**` THẬT: không vi phạm nào — và phép đọc thấy đủ năm chỗ đăng ký của hôm nay (một thường, ba có bù, một lô)", () => {
    const kq = docKho();
    const ke = kq.choDangKy.map((c) => `${c.tep}:${String(c.dong)} ${c.ham} ${c.route} [${c.maQuyen ?? "không mã quyền"}] bù=${c.hamBu.join(",") || "-"}`).join("\n");
    expect(kq.viPham, `vi phạm trên bảng route thật\n${ke}`).toEqual([]);
    // Chống rỗng ruột, và là bản đếm lại lời khai §S1.95 "đúng HAI chỗ" — hôm nay NĂM: `anon.ts` 1 thường; `buyer.ts` 3 có bù + 1 lô.
    // Đòi "ít nhất" chứ không "đúng bằng": chỗ đăng ký thứ sáu phải đi qua cổng này, không phải đi sửa con số ở đây.
    const dem = (ham: HamDangKy): number => kq.choDangKy.filter((c) => c.ham === ham).length;
    expect(dem("afterCommit"), `afterCommit thường\n${ke}`).toBeGreaterThanOrEqual(1);
    expect(dem("afterCommitCoBu"), `afterCommitCoBu\n${ke}`).toBeGreaterThanOrEqual(3);
    expect(dem("afterCommitLoGui"), `afterCommitLoGui\n${ke}`).toBeGreaterThanOrEqual(1);
    expect(kq.choDangKy.length, ke).toBeGreaterThanOrEqual(5);
    // Mỗi chỗ có bù/lô phải mang ít nhất một `bu` mà cổng đọc được — nếu không, vế ⑵ xanh vì không thấy gì.
    for (const c of kq.choDangKy.filter((x) => x.ham !== "afterCommit")) {
      expect(c.hamBu, `${c.tep}:${String(c.dong)} ${c.ham}: không thấy \`bu\` nào`).toContain("bu");
      expect(c.maQuyen, `${c.tep}:${String(c.dong)}: việc có bù phải nằm trong route có mã quyền đọc được`).toMatch(/^[A-Z_]+$/u);
    }
    expect(kq.choDangKy.some((c) => c.hamBu.includes("khiXong")), `không chỗ nào có \`khiXong\` — ADR-113 đăng ký ít nhất một\n${ke}`).toBe(true);
    // Đối chứng cho phép đọc mã quyền: chỗ đăng ký của lần mở gói nằm dưới `RFQ_OPEN`, chỗ của lần mời dưới `RFQ_INVITE`.
    expect(kq.choDangKy.filter((c) => c.ham === "afterCommitLoGui").map((c) => c.maQuyen)).toEqual(["RFQ_OPEN"]);
    // [S1.9101 / S3.7a1] …và chỗ của lần gửi link Passport dưới `SUPPLIER_QUALIFY`.
    expect(new Set(kq.choDangKy.filter((c) => c.ham === "afterCommitCoBu").map((c) => c.maQuyen))).toEqual(new Set(["RFQ_INVITE", "SUPPLIER_QUALIFY"]));
  });

  describe("vế ⑴ — ĐỐI CHỨNG DƯƠNG bằng văn bản mẫu: closure với tới `ctx.client` thì ĐỎ", () => {
    it("`ctx.client` thẳng, `?.`, `[\"client\"]` — ở việc thường, việc có bù (trong `viec` lẫn `bu`) và lô", () => {
      const ca = [
        "    ctx.afterCommit(() => ctx.client.query('SELECT 1').then(() => undefined));",
        "    ctx.afterCommit(async () => { await ctx?.client.query('SELECT 1'); });",
        "    ctx.afterCommit(async () => { await ctx['client'].query('SELECT 1'); });",
        "    ctx.afterCommitCoBu({ viec: () => ctx.client.query('x').then(() => undefined), bu: async (c) => { await revokeInvitation(c, ctx.orgId, {}); }, phanHoiKhiHong: { status: 502, body: {} } });",
        "    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async () => { await revokeInvitation(ctx.client, ctx.orgId, {}); }, phanHoiKhiHong: { status: 502, body: {} } });",
        "    ctx.afterCommitLoGui({ lanGui: [{ khoa: 'a', gui: () => Promise.resolve(), khiXong: async () => { await danhDauDaGui(ctx.client, ctx.orgId, 'a'); }, bu: async (c) => { await revokeInvitation(c, ctx.orgId, {}); } }], phanHoi: (r) => r });",
      ];
      for (const than of ca) {
        const kq = docViecSauCommit(mauRoute("ctx", than));
        expect(kq.choDangKy, than).toHaveLength(1);
        expect(kq.viPham.join("\n"), than).toContain("chạm `ctx.client`");
      }
    });

    it("bí danh khai trong handler — `const c = ctx.client`, `const { client } = ctx`, `const { client: c } = ctx` — cũng bị bắt", () => {
      const ca = [
        "    const c = ctx.client;\n    ctx.afterCommit(async () => { await c.query('SELECT 1'); });",
        "    const { client } = ctx;\n    ctx.afterCommit(async () => { await client.query('SELECT 1'); });",
        "    const { client: c } = ctx;\n    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async () => { await revokeInvitation(c, ctx.orgId, {}); }, phanHoiKhiHong: { status: 502, body: {} } });",
      ];
      for (const than of ca) {
        expect(docViecSauCommit(mauRoute("ctx", than)).viPham.join("\n"), than).toContain("bí danh");
      }
    });

    it("tên ctx không phải `ctx` vẫn đọc được; tham số `client` của `bu` CHE bí danh cùng tên (không đỏ oan); truyền nguyên ctx thì đỏ", () => {
      // Tên khác: `c.client` trong closure của `c.afterCommit`.
      expect(docViecSauCommit(mauRoute("c", "    c.afterCommit(() => c.client.query('x').then(() => undefined));")).viPham.join("\n")).toContain("chạm `c.client`");
      // Che tên: handler khai `const { client } = ctx`, nhưng `bu: async (client) => …` dùng THAM SỐ của nó — đó là kết nối mới, hợp lệ.
      const che = "    const { client } = ctx;\n    await client.query('x');\n    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async (client) => { await revokeInvitation(client, ctx.orgId, {}); }, phanHoiKhiHong: { status: 502, body: {} } });";
      expect(docViecSauCommit(mauRoute("ctx", che)).viPham).toEqual([]);
      // Truyền nguyên ctx cho một hàm khác: cổng không đọc xuyên qua nên đỏ.
      const nguyen = "    ctx.afterCommit(() => guiGiup(ctx));";
      expect(docViecSauCommit(mauRoute("ctx", nguyen)).viPham.join("\n")).toContain("truyền nguyên `ctx`");
    });

    it("ĐỐI CHỨNG ÂM: closure chỉ đọc `ctx.orgId`, `ctx.actor.sessionId`, `ctx.services.*`, `ctx.auditPool` — như `routes/buyer.ts` — thì sạch", () => {
      const sach =
        "    ctx.afterCommitCoBu({ viec: () => ctx.services.invitationLinkSender.send({ orgId: ctx.orgId }), bu: async (client) => { await revokeInvitation(client, ctx.orgId, { actorSessionId: ctx.actor.sessionId }, ctx.auditPool); }, phanHoiKhiHong: { status: 502, body: {} } });";
      const kq = docViecSauCommit(mauRoute("ctx", sach));
      expect(kq.viPham).toEqual([]);
      expect(kq.choDangKy[0]).toMatchObject({ ham: "afterCommitCoBu", route: "POST /x", maQuyen: "RFQ_INVITE", hamBu: ["bu"] });
    });
  });

  describe("vế ⑵ — ĐỐI CHỨNG DƯƠNG bằng văn bản mẫu: hàm ghi trong `bu`/`khiXong` ngoài mã quyền của route thì ĐỎ", () => {
    /** Một việc có bù viết tại chỗ: thân `bu` (và tuỳ chọn thân `khiXong`) là tham số. */
    const viecCoBu = (thanBu: string, thanKhiXong?: string): string =>
      `    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async (client) => { ${thanBu} }, ${
        thanKhiXong === undefined ? "" : `khiXong: async (client) => { ${thanKhiXong} }, `
      }phanHoiKhiHong: { status: 502, body: {} } });`;
    const THU_HOI = "await revokeInvitation(client, ctx.orgId, {});";
    const TAO_NCC = "await createSupplier(client, ctx.orgId, {});";

    it("`bu` gọi `createSupplier` dưới `RFQ_INVITE` ⇒ đỏ, nêu tên hàm và mã quyền; cùng hàm ấy ở `khiXong` ⇒ đỏ", () => {
      const vp1 = docViecSauCommit(mauRoute("ctx", viecCoBu(TAO_NCC))).viPham.join("\n");
      expect(vp1).toContain("`bu` gọi hàm gói `createSupplier` ngoài danh sách của mã quyền `RFQ_INVITE`");
      const vp2 = docViecSauCommit(mauRoute("ctx", viecCoBu(THU_HOI, TAO_NCC))).viPham.join("\n");
      expect(vp2).toContain("`khiXong` gọi hàm gói `createSupplier` ngoài danh sách của mã quyền `RFQ_INVITE`");
    });

    it("ĐỐI CHỨNG ÂM: `bu` gọi `revokeInvitation` và `khiXong` gọi `danhDauDaGui` dưới `RFQ_INVITE` ⇒ sạch; bí danh import vẫn nhận ra tên gốc", () => {
      expect(docViecSauCommit(mauRoute("ctx", viecCoBu(THU_HOI, "await danhDauDaGui(client, ctx.orgId, 'a');"))).viPham).toEqual([]);
      const biDanh = mauRoute("ctx", viecCoBu("await taoNcc(client, ctx.orgId, {});")).replace(
        'import { createSupplier } from "@trustprocure/supplier";',
        'import { createSupplier as taoNcc } from "@trustprocure/supplier";',
      );
      expect(docViecSauCommit(biDanh).viPham.join("\n")).toContain("`createSupplier` ngoài danh sách");
    });

    it("route KHÔNG có mã quyền (tự thân) mà `bu` gọi một hàm gói ⇒ đỏ; mã quyền khai không phải `PERMISSIONS.X` ⇒ đỏ", () => {
      const tuThan = mauRoute("ctx", viecCoBu(THU_HOI), "self: true, agent: false, mfaTranDuongPhu: null,");
      expect(docViecSauCommit(tuThan).viPham.join("\n")).toContain("route KHÔNG có mã quyền");
      const chuoi = mauRoute("ctx", viecCoBu(THU_HOI), 'permission: "rfq.invite", resourceType: "INVITATION",');
      expect(docViecSauCommit(chuoi).viPham.join("\n")).toContain("mã quyền của route không đọc được");
    });

    it("SQL tay, hàm cục bộ, và `bu` tham chiếu qua biến — ba hình dạng cổng không đọc xuyên qua được — đều đỏ", () => {
      const sql = "    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async (client) => { await client.query('DELETE FROM x'); }, phanHoiKhiHong: { status: 502, body: {} } });";
      expect(docViecSauCommit(mauRoute("ctx", sql)).viPham.join("\n")).toContain("SQL tay");
      const cucBo = "    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async (client) => { await thuHoi(client); }, phanHoiKhiHong: { status: 502, body: {} } });";
      expect(docViecSauCommit(mauRoute("ctx", cucBo)).viPham.join("\n")).toContain("hàm cục bộ `thuHoi`");
      const bien = "    const bu = async (client) => { await revokeInvitation(client, ctx.orgId, {}); };\n    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu, phanHoiKhiHong: { status: 502, body: {} } });";
      expect(docViecSauCommit(mauRoute("ctx", bien)).viPham.join("\n")).toContain("tham chiếu qua biến");
    });

    it("`bu` của TỪNG lần gửi trong lô cũng bị đọc — `lanGui: links.map((l) => ({ …, bu }))` như `POST /rfqs/:rfqId/open`", () => {
      const lo = [
        "    ctx.afterCommitLoGui({",
        "      lanGui: links.map((l) => ({ khoa: l.id, gui: () => Promise.resolve(), khiXong: async (client) => { await danhDauDaGui(client, ctx.orgId, l.id); }, bu: async (client) => { await createSupplier(client, ctx.orgId, {}); } })),",
        "      phanHoi: (r) => r,",
        "    });",
      ].join("\n");
      const kq = docViecSauCommit(mauRoute("ctx", lo, 'permission: PERMISSIONS.RFQ_OPEN, resourceType: "RFQ",'));
      expect(kq.choDangKy[0]?.hamBu).toEqual(["khiXong", "bu"]);
      expect(kq.viPham.join("\n")).toContain("`bu` gọi hàm gói `createSupplier` ngoài danh sách của mã quyền `RFQ_OPEN`");
    });
  });

  describe("vế ⑶ — VIẾT TẠI CHỖ: closure tạo ở ngoài rồi truyền vào thì ĐỎ, dù thân nó có chạm gì hay không", () => {
    it("đối số của `afterCommit` là một biến; `viec`/`gui`/`bu` khai qua tên biến (không viết tắt) — đều đỏ, không cần đọc thân biến", () => {
      const v = "    const v = async () => { await ctx.client.query('x'); };\n    ctx.afterCommit(v);";
      expect(docViecSauCommit(mauRoute("ctx", v)).viPham.join("\n")).toContain("đối số của `afterCommit` không viết TẠI CHỖ");
      const buTen =
        "    const thuHoi = async (client) => { await revokeInvitation(client, ctx.orgId, {}); };\n    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: thuHoi, phanHoiKhiHong: { status: 502, body: {} } });";
      expect(docViecSauCommit(mauRoute("ctx", buTen)).viPham.join("\n")).toContain("`bu` tham chiếu qua biến");
      const viecTen =
        "    const guiSau = () => Promise.resolve();\n    ctx.afterCommitCoBu({ viec: guiSau, bu: async (client) => { await revokeInvitation(client, ctx.orgId, {}); }, phanHoiKhiHong: { status: 502, body: {} } });";
      expect(docViecSauCommit(mauRoute("ctx", viecTen)).viPham.join("\n")).toContain("`viec` tham chiếu qua biến");
      const guiTen =
        "    ctx.afterCommitLoGui({ lanGui: links.map((l) => ({ khoa: l.id, gui: guiMot, bu: async (client) => { await revokeInvitation(client, ctx.orgId, {}); } })), phanHoi: (r) => r });";
      expect(docViecSauCommit(mauRoute("ctx", guiTen)).viPham.join("\n")).toContain("`gui` tham chiếu qua biến");
    });

    it("ĐỐI CHỨNG ÂM: `khiXong` là ba ngôi mà mỗi nhánh là hàm hay `undefined` — như `POST /invitations/:invitationId/reissue` — thì sạch; hàm trong nhánh vẫn bị đọc theo mã quyền", () => {
      const baNgoi = (ham: string): string =>
        `    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async (client) => { await revokeInvitation(client, ctx.orgId, {}); }, khiXong: loi.status === "UNSENT" ? async (client) => { await ${ham}(client, ctx.orgId, 'a'); } : undefined, phanHoiKhiHong: { status: 502, body: {} } });`;
      const sach = docViecSauCommit(mauRoute("ctx", baNgoi("danhDauDaGui")));
      expect(sach.viPham).toEqual([]);
      expect(sach.choDangKy[0]?.hamBu).toEqual(["bu", "khiXong"]);
      expect(docViecSauCommit(mauRoute("ctx", baNgoi("createSupplier"))).viPham.join("\n")).toContain("`khiXong` gọi hàm gói `createSupplier` ngoài danh sách");
    });
  });

  describe("[S1.238 / khoản 264] vế ⑵ fail-closed với lời gọi qua thuộc tính: namespace import là tên gói, vật chủ ngoài tập trắng thì ĐỎ", () => {
    const vp = (vanBan: string): string => docViecSauCommit(vanBan).viPham.join("\n");
    /** Một việc có bù dưới `RFQ_INVITE`, thân `bu` là tham số; `dauHandler` là các câu đứng trước lời đăng ký. */
    const viecCoBu = (thanBu: string, dauHandler = ""): string =>
      `${dauHandler}    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async (client) => { ${thanBu} }, phanHoiKhiHong: { status: 502, body: {} } });`;
    const themImport = (vanBan: string, dong: string): string => `${dong}\n${vanBan}`;

    it("ba hình dạng của hàng sổ — namespace import gọi hàm ngoài mã quyền, vật chủ bất kỳ, `ctx.services…` — đều ĐỎ, nêu vật chủ", () => {
      const ns = themImport(mauRoute("ctx", viecCoBu("await ncc.createSupplier(client, ctx.orgId, {});")), 'import * as ncc from "@trustprocure/supplier";');
      expect(vp(ns)).toContain("`bu` gọi hàm gói `createSupplier` (qua namespace `ncc`) ngoài danh sách của mã quyền `RFQ_INVITE`");
      const vatChu = mauRoute("ctx", viecCoBu("await goi.revokeInvitation(client, ctx.orgId, {});", "    const goi = { revokeInvitation };\n"));
      expect(vp(vatChu)).toContain("`bu` gọi `goi.revokeInvitation(…)` qua thuộc tính của vật chủ `goi` ngoài tập trắng");
      const dichVu = mauRoute("ctx", viecCoBu("await ctx.services.loiMoi.thuHoi(client, ctx.orgId);"));
      expect(vp(dichVu)).toContain("`bu` gọi `ctx.services.loiMoi.thuHoi(…)` qua thuộc tính của một biểu thức");
    });

    it("namespace import từ `@trustprocure/*` được nhận NHƯ TÊN GÓI: trong danh sách của mã quyền ⇒ sạch; route không mã quyền ⇒ đỏ; `import *` từ gói ngoài `@trustprocure/*` ⇒ vật chủ lạ", () => {
      const sach = themImport(mauRoute("ctx", viecCoBu("await inv.revokeInvitation(client, ctx.orgId, {});")), 'import * as inv from "@trustprocure/invitation";');
      expect(docViecSauCommit(sach).viPham).toEqual([]);
      const tuThan = themImport(
        mauRoute("ctx", viecCoBu("await inv.revokeInvitation(client, ctx.orgId, {});"), "self: true, agent: false, mfaTranDuongPhu: null,"),
        'import * as inv from "@trustprocure/invitation";',
      );
      expect(vp(tuThan)).toContain("`bu` gọi hàm gói `revokeInvitation` (qua namespace `inv`) trong route KHÔNG có mã quyền");
      const ngoai = themImport(mauRoute("ctx", viecCoBu("await pgx.revokeInvitation(client);")), 'import * as pgx from "pg";');
      expect(vp(ngoai)).toContain("qua thuộc tính của vật chủ `pgx` ngoài tập trắng");
    });

    it("ĐỐI CHỨNG ÂM — tập trắng: `Promise.*`, `JSON.*`, `Array.*`, `Object.*` và tham số kết nối của chính `bu` (không `.query`) ⇒ sạch", () => {
      const sach = mauRoute(
        "ctx",
        viecCoBu(
          "await Promise.all([revokeInvitation(client, ctx.orgId, {})]); void JSON.stringify(Object.keys(Array.from([1]))); void client.escapeIdentifier('x');",
        ),
      );
      expect(docViecSauCommit(sach).viPham).toEqual([]);
    });

    it("tập trắng đọc theo KÝ HIỆU, không theo chữ: `Promise` hay `client` bị che bằng một biến cục bộ ⇒ ĐỎ; tên import bị che trong `bu` ⇒ hàm cục bộ", () => {
      const cheToanCuc = mauRoute("ctx", viecCoBu("const Promise = { revokeInvitation: createSupplier }; await Promise.revokeInvitation(client, ctx.orgId, {});"));
      expect(vp(cheToanCuc)).toContain("qua thuộc tính của vật chủ `Promise` ngoài tập trắng");
      const cheThamSo = mauRoute("ctx", viecCoBu("{ const client = { revokeInvitation: createSupplier }; await client.revokeInvitation(ctx.orgId); }"));
      expect(vp(cheThamSo)).toContain("qua thuộc tính của vật chủ `client` ngoài tập trắng");
      // `client` của HANDLER (bí danh `ctx.client`) không phải tham số kết nối của `bu`: vế ⑴ đỏ, và vế ⑵ cũng không coi nó là tập trắng.
      const khongPhaiThamSo = mauRoute("ctx", "    const { client } = ctx;\n    ctx.afterCommitCoBu({ viec: () => Promise.resolve(), bu: async () => { client.escapeIdentifier('x'); }, phanHoiKhiHong: { status: 502, body: {} } });");
      expect(vp(khongPhaiThamSo)).toContain("qua thuộc tính của vật chủ `client` ngoài tập trắng");
      const cheImport = mauRoute("ctx", viecCoBu("const revokeInvitation = createSupplier; await revokeInvitation(client, ctx.orgId, {});"));
      expect(vp(cheImport)).toContain("`bu` gọi hàm cục bộ `revokeInvitation`");
    });

    it("hình dạng lời gọi khác mà cổng không đọc được tên hàm — thuộc tính tính toán, `client[\"query\"]`, dấu phẩy, `new` qua namespace, import động — đều ĐỎ", () => {
      const nsDong = 'import * as inv from "@trustprocure/invitation";';
      expect(vp(themImport(mauRoute("ctx", viecCoBu("const k = 'revokeInvitation'; await inv[k](client, ctx.orgId, {});")), nsDong))).toContain("thuộc tính tính toán");
      expect(vp(mauRoute("ctx", viecCoBu("await client['query']('DELETE FROM x');")))).toContain("`bu` chạy SQL tay");
      expect(vp(themImport(mauRoute("ctx", viecCoBu("await (0, inv.revokeInvitation)(client, ctx.orgId, {});")), nsDong))).toContain("`bu` gọi một biểu thức");
      expect(vp(themImport(mauRoute("ctx", viecCoBu("new ncc.GhiNhaCungCap(client);")), 'import * as ncc from "@trustprocure/supplier";'))).toContain(
        "`bu` gọi hàm gói `GhiNhaCungCap` (qua namespace `ncc`) ngoài danh sách",
      );
      expect(vp(mauRoute("ctx", viecCoBu("const m = await import('@trustprocure/supplier'); await m.createSupplier(client, ctx.orgId, {});")))).toContain("`bu` gọi một biểu thức");
    });

    it("lách QUA tập trắng: hàm gói TRUYỀN cho một phương thức của tập trắng (`Array.from([client], f)`) hay viết tắt `{ f }` — không lời gọi nào để đọc — ĐỎ", () => {
      const nsDong = 'import * as ncc from "@trustprocure/supplier";';
      expect(vp(themImport(mauRoute("ctx", viecCoBu("await Promise.all(Array.from([client], ncc.createSupplier));")), nsDong))).toContain(
        "`bu` dùng `ncc` (import từ @trustprocure/supplier) không ở vị trí bị gọi trực tiếp",
      );
      expect(vp(mauRoute("ctx", viecCoBu("await Promise.all(Array.from([client], createSupplier));")))).toContain("`bu` dùng `createSupplier` (import từ @trustprocure/supplier)");
      expect(vp(mauRoute("ctx", viecCoBu("void JSON.stringify({ revokeInvitation });")))).toContain("`bu` dùng `revokeInvitation` (import từ @trustprocure/invitation)");
      // Đối chứng: cùng hàm gói, GỌI trực tiếp (tên trần hay qua namespace) trong đối số của tập trắng ⇒ sạch dưới mã quyền phủ nó.
      const sach = themImport(mauRoute("ctx", viecCoBu("await Promise.all([revokeInvitation(client, ctx.orgId, {}), inv.danhDauDaGui(client, ctx.orgId, 'a')]);")), 'import * as inv from "@trustprocure/invitation";');
      expect(docViecSauCommit(sach).viPham).toEqual([]);
    });
  });

  it("chú thích và chuỗi không bao giờ là một lời gọi: một `// ctx.afterCommit(() => ctx.client…)` trong chú thích không tạo chỗ đăng ký", () => {
    const chuThich = mauRoute("ctx", "    // ctx.afterCommit(() => ctx.client.query('x'));\n    const s = \"ctx.afterCommit(() => ctx.client)\";\n    void s;");
    const kq = docViecSauCommit(chuThich);
    expect(kq.choDangKy).toEqual([]);
    expect(kq.viPham).toEqual([]);
  });
});
