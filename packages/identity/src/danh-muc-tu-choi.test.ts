// ==============================================================================================
// [S1.9161 / khoản 189, 179] BA DANH MỤC ĐÓNG CỦA DÒNG LOG TỪ CHỐI BẰNG TẬP HẰNG Ở CHỖ GỌI — ĐO TRÊN CÂY CÚ PHÁP
//
// `rbac.ts` canh dòng log của một lần từ chối MẤT SỔ bằng phép THUỘC-TẬP (khoản 189): `action`, `resourceType` và vế cổng phải có
// tên trong `DANH_MUC_HANH_DONG_TU_CHOI`, `DANH_MUC_LOAI_TAI_NGUYEN`, `DANH_MUC_VE_CONG`, không thì ra `HANG_LA`. Một tập đóng mua
// "giá trị không ra được dòng log" bằng cái giá "một tên CHƯA KHAI cũng không ra được" — và cái giá ấy chỉ chấp nhận được khi có một
// lớp đòi danh mục PHỦ mọi chỗ gọi; không thì dòng log của lần từ chối mới nhất là `HANG_LA` mà không cổng nào kêu.
//
// Tệp này là lớp ấy, và phép đo đi HAI CHIỀU (bằng nhau, không chỉ chứa): tập hằng ở chỗ gọi == danh mục. Chiều "danh mục thiếu" là
// chiều nguy hiểm; chiều "danh mục thừa" giữ cho danh mục không phát biểu rộng hơn thứ đo được.
//
// Nguồn đọc, theo cây cú pháp TypeScript (`ts.createSourceFile` — chú thích và chuỗi không bao giờ là một lời gọi; cùng cách với
// `tests/architecture/ghi-so-tu-choi-mot-duong.test.ts`), trong mã sản xuất `packages/*/src`, `apps/*/src`, `tools/*/src` (không
// `*.test.ts`, không `*.d.ts`):
//   ⑴ `action` và `resourceType` của đối số sự kiện ở MỌI lời gọi `throwAuditedDenial(…)`;
//   ⑵ `resourceType` của đối số yêu cầu ở MỌI lời gọi `requirePermission(…)`; lời gọi của bộ điều phối truyền `route.resourceType`,
//      và đó là chỗ DUY NHẤT được truyền như thế, nên
//   ⑶ `resourceType` của mọi đối tượng route (có `path` và `resourceType`) trong `apps/api/src/routes/`;
//   ⑷ ba từ vựng vế: `UNSEAL_CLAUSES` (`packages/unseal/src/gate.ts`), `UnsealExecutionClause` (`apps/unseal-worker/src/index.ts`),
//      `RFQ_STATUSES` (`packages/rfq/src/rfq.ts`) — gói identity không import được ba nguồn ấy (chúng phụ thuộc gói này), nên danh mục
//      vế là bản CHÉP, và tệp này đòi bản chép bằng nguồn;
//   ⑸ [khoản 179] tập tệp có lời gọi `throwAuditedDenial` truyền đối số thứ năm (vế) đúng bằng ba tệp đã khai;
//   ⑹ [bước 0 đợt 2 / S1.196] `resourceType` ở đối số tài nguyên của MỌI lời gọi một HÀM BỌC đã khai (`HAM_BOC`) — hàm ấy truyền
//      `<thamSo>.resourceType` cho `throwAuditedDenial`, và dạng ấy chỉ được chấp nhận trong đúng tệp định nghĩa của nó; hàm bọc thứ hai
//      chưa khai ⇒ ĐỎ ở chính chỗ truyền.
// Một hằng là chuỗi viết tại chỗ, hoặc một `const` cấp tệp mang chuỗi viết tại chỗ trong CÙNG tệp; dạng khác ⇒ ĐỎ kèm tệp:dòng —
// không đoán, không bỏ qua.
//
// PHÁT BIỂU ĐÚNG MỨC: theo TÊN hàm (`requirePermission`, `throwAuditedDenial`, kể cả gọi qua thuộc tính) và theo hình dạng "đối số là
// một đối tượng viết tại chỗ". Một hàm bọc tên khác, hay một sự kiện dựng ở nơi khác rồi truyền qua biến, thì tệp này KHÔNG thấy —
// nó chỉ đỏ với đối tượng viết tại chỗ mà thuộc tính không giải được. Hai cổng khác giữ phần còn lại: `ghi-so-tu-choi-mot-duong` đòi
// mọi `…DeniedError` được tạo NGAY trong đối số của `throwAuditedDenial`, và `cong-quyen-route` đòi thân hàm gọi `requirePermission`
// trực tiếp.
// ==============================================================================================
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DANH_MUC_HANH_DONG_TU_CHOI, DANH_MUC_LOAI_TAI_NGUYEN, DANH_MUC_VE_CONG } from "./rbac.js";

const GOC = fileURLToPath(new URL("../../../", import.meta.url));
const THU_MUC_ROUTE = "apps/api/src/routes/";
/** Chỗ DUY NHẤT được truyền `route.resourceType` cho cổng quyền — bảng route ⑶ là phần giải của nó. */
const TEP_DIEU_PHOI = "apps/api/src/dispatch.ts";
/** [khoản 179] Ba chỗ gọi truyền vế — đóng; thêm một chỗ là một quyết định và phải sửa cả đây lẫn docstring của `throwAuditedDenial`. */
const TEP_TRUYEN_VE = ["apps/unseal-worker/src/index.ts", "packages/unseal/src/comparison.ts", "packages/unseal/src/gate.ts"];
/**
 * ⑹ Hàm BỌC truyền `resourceType` từ tham số tới `throwAuditedDenial` — danh sách ĐÓNG, thêm một hàm là một quyết định. Bộ đọc lấy
 * `resourceType` ở đối số thứ `viTri` (đếm từ 0) của mọi lời gọi hàm ấy, và chỉ chấp nhận `<thamSo>.resourceType` bên trong `tep`.
 */
const HAM_BOC = {
  tuChoiTheoChotTaiNguyen: { tep: "packages/identity/src/chot-kiem-soat.ts", thamSo: "taiNguyen", viTri: 3 },
} as const;
const NGUON_VE = {
  UNSEAL_CLAUSES: "packages/unseal/src/gate.ts",
  UnsealExecutionClause: "apps/unseal-worker/src/index.ts",
  RFQ_STATUSES: "packages/rfq/src/rfq.ts",
} as const;

/** Kết quả đọc MỘT tệp. `khongGiai` là danh sách `tệp:dòng lý do` — mỗi dòng là một chỗ bộ đọc không dám đoán. */
interface KetQuaDoc {
  readonly hanhDong: ReadonlySet<string>;
  readonly loaiTaiNguyen: ReadonlySet<string>;
  readonly route: ReadonlySet<string>;
  readonly soGoiTuChoi: number;
  readonly soGoiCongQuyen: number;
  readonly truyenVe: boolean;
  readonly dungRoute: boolean;
  /** ⑹ Tệp này truyền `<thamSo>.resourceType` của một hàm bọc đã khai (chỉ tệp định nghĩa hàm ấy được). */
  readonly dungBoc: boolean;
  /** ⑹ Số lời gọi hàm bọc trong tệp. */
  readonly soGoiBoc: number;
  readonly khongGiai: readonly string[];
}

function cayCuPhap(ten: string, vanBan: string): ts.SourceFile {
  return ts.createSourceFile(ten, vanBan, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function duyetCay(nut: ts.Node, lam: (n: ts.Node) => void): void {
  lam(nut);
  ts.forEachChild(nut, (con) => duyetCay(con, lam));
}

function tenHam(n: ts.CallExpression): string | undefined {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function boAsConst(e: ts.Expression): ts.Expression {
  return ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? boAsConst(e.expression) : e;
}

/** Giá trị của một `const TEN = "chuỗi"` (có thể `as const`) ở cấp tệp — không theo import, không theo biểu thức. */
function chuoiCapTep(sf: ts.SourceFile, ten: string): string | undefined {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === ten && d.initializer !== undefined) {
        const init = boAsConst(d.initializer);
        if (ts.isStringLiteral(init)) return init.text;
      }
    }
  }
  return undefined;
}

function thuocTinh(obj: ts.ObjectLiteralExpression, ten: string): ts.PropertyAssignment | undefined {
  return obj.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === ten,
  );
}

type GiaTri =
  | { readonly loai: "chuoi"; readonly gia: string }
  | { readonly loai: "route" }
  | { readonly loai: "boc" }
  | { readonly loai: "khong-giai"; readonly lyDo: string };

function docGiaTri(tep: string, sf: ts.SourceFile, obj: ts.ObjectLiteralExpression, ten: string): GiaTri {
  const p = thuocTinh(obj, ten);
  if (p === undefined) return { loai: "khong-giai", lyDo: `thiếu thuộc tính ${ten}` };
  const init = boAsConst(p.initializer);
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return { loai: "chuoi", gia: init.text };
  if (ts.isIdentifier(init)) {
    const gia = chuoiCapTep(sf, init.text);
    return gia === undefined ? { loai: "khong-giai", lyDo: `${ten}: hằng \`${init.text}\` không phải const chuỗi cấp tệp` } : { loai: "chuoi", gia };
  }
  if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression) && init.name.text === ten) {
    const goc = init.expression.text;
    if (goc === "route") return { loai: "route" };
    if (Object.values(HAM_BOC).some((h) => h.tep === tep && h.thamSo === goc)) return { loai: "boc" };
  }
  return { loai: "khong-giai", lyDo: `${ten}: biểu thức ${ts.SyntaxKind[init.kind]}` };
}

function dong(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

/** Đọc một tệp mã sản xuất theo ⑴ ⑵ ⑶ ⑸. `tep` là đường tương đối từ gốc kho, dùng dấu `/`. */
export function docTep(tep: string, vanBan: string): KetQuaDoc {
  const sf = cayCuPhap(tep, vanBan);
  const hanhDong = new Set<string>();
  const loaiTaiNguyen = new Set<string>();
  const route = new Set<string>();
  const khongGiai: string[] = [];
  let soGoiTuChoi = 0;
  let soGoiCongQuyen = 0;
  let truyenVe = false;
  let dungRoute = false;
  let dungBoc = false;
  let soGoiBoc = 0;
  const ghi = (n: ts.Node, obj: ts.ObjectLiteralExpression, ten: string, vao: Set<string>): void => {
    const g = docGiaTri(tep, sf, obj, ten);
    if (g.loai === "chuoi") vao.add(g.gia);
    else if (g.loai === "route") dungRoute = true;
    else if (g.loai === "boc") dungBoc = true;
    else khongGiai.push(`${tep}:${dong(sf, n)} ${g.lyDo}`);
  };
  duyetCay(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const ten = tenHam(n);
      if (ten === "throwAuditedDenial") {
        soGoiTuChoi += 1;
        const suKien = n.arguments[2];
        if (suKien !== undefined && ts.isObjectLiteralExpression(suKien)) {
          ghi(n, suKien, "action", hanhDong);
          ghi(n, suKien, "resourceType", loaiTaiNguyen);
        } else khongGiai.push(`${tep}:${dong(sf, n)} throwAuditedDenial: đối số sự kiện không phải đối tượng viết tại chỗ`);
        if (n.arguments.length >= 5) truyenVe = true;
      } else if (ten === "requirePermission") {
        soGoiCongQuyen += 1;
        const yeuCau = n.arguments[1];
        if (yeuCau !== undefined && ts.isObjectLiteralExpression(yeuCau)) ghi(n, yeuCau, "resourceType", loaiTaiNguyen);
        else khongGiai.push(`${tep}:${dong(sf, n)} requirePermission: đối số yêu cầu không phải đối tượng viết tại chỗ`);
      } else if (ten !== undefined && Object.hasOwn(HAM_BOC, ten)) {
        soGoiBoc += 1;
        const h = HAM_BOC[ten as keyof typeof HAM_BOC];
        const taiNguyen = n.arguments[h.viTri];
        if (taiNguyen !== undefined && ts.isObjectLiteralExpression(taiNguyen)) ghi(n, taiNguyen, "resourceType", loaiTaiNguyen);
        else khongGiai.push(`${tep}:${dong(sf, n)} ${ten}: đối số tài nguyên không phải đối tượng viết tại chỗ`);
      }
    }
    if (tep.startsWith(THU_MUC_ROUTE) && ts.isObjectLiteralExpression(n) && thuocTinh(n, "path") !== undefined && thuocTinh(n, "resourceType") !== undefined) {
      ghi(n, n, "resourceType", route);
    }
  });
  return { hanhDong, loaiTaiNguyen, route, soGoiTuChoi, soGoiCongQuyen, truyenVe, dungRoute, dungBoc, soGoiBoc, khongGiai };
}

/** Mọi `.ts` sản xuất dưới `<thư mục>/src` của từng gói/app/tool — không test, không `.d.ts`, không `node_modules`/`dist`. */
function tepSanXuat(): string[] {
  const ra: string[] = [];
  const duyet = (thuMuc: string): void => {
    for (const e of readdirSync(thuMuc, { withFileTypes: true })) {
      const duong = join(thuMuc, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "dist") duyet(duong);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
        ra.push(relative(GOC, duong).split(sep).join("/"));
      }
    }
  };
  for (const nhom of ["packages", "apps", "tools"]) {
    for (const e of readdirSync(join(GOC, nhom), { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(GOC, nhom, e.name, "src"))) duyet(join(GOC, nhom, e.name, "src"));
    }
  }
  return ra.sort();
}

/** ⑷ Một từ vựng vế ở nguồn: mảng chuỗi `as const` hay kiểu hợp của chuỗi trực tiếp, tìm theo tên ở cấp tệp. */
function tuVung(tep: string, ten: string): string[] {
  const sf = cayCuPhap(tep, readFileSync(join(GOC, tep), "utf8"));
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st) && st.name.text === ten) {
      const cac = ts.isUnionTypeNode(st.type) ? st.type.types : [st.type];
      return cac.map((t) => {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return t.literal.text;
        throw new Error(`${tep}: \`${ten}\` có một nhánh không phải chuỗi trực tiếp (${ts.SyntaxKind[t.kind]})`);
      });
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === ten && d.initializer !== undefined) {
          const init = boAsConst(d.initializer);
          if (!ts.isArrayLiteralExpression(init)) throw new Error(`${tep}: \`${ten}\` không phải mảng viết tại chỗ`);
          return init.elements.map((e) => {
            if (ts.isStringLiteral(e)) return e.text;
            throw new Error(`${tep}: \`${ten}\` có một phần tử không phải chuỗi trực tiếp (${ts.SyntaxKind[e.kind]})`);
          });
        }
      }
    }
  }
  throw new Error(`${tep}: không thấy \`${ten}\` ở cấp tệp — nguồn của danh mục vế đã dời hay đổi tên, sửa NGUON_VE`);
}

function sapXep(t: Iterable<string>): string[] {
  return [...t].sort();
}

// Đọc CẢ KHO một lần — mọi vế dưới đây đối chiếu trên cùng một kết quả.
const KET_QUA = tepSanXuat().map((tep) => [tep, docTep(tep, readFileSync(join(GOC, tep), "utf8"))] as const);
const hop = (lay: (k: KetQuaDoc) => ReadonlySet<string>): Set<string> => new Set(KET_QUA.flatMap(([, k]) => [...lay(k)]));

describe("[S1.9161 / khoản 189] danh mục đóng của dòng log từ chối BẰNG tập hằng ở chỗ gọi", () => {
  it("ĐỐI CHỨNG trên văn bản mẫu: bộ đọc lấy chuỗi tại chỗ, hằng cấp tệp, `route.resourceType`, route, vế; và ĐỎ với thứ nó không giải được", () => {
    const mau = docTep(
      "packages/x/src/a.ts",
      `const ACT = "A_DENIED" as const;
       // throwAuditedDenial(p, o, { action: "TRONG_CHU_THICH", resourceType: "CHU_THICH" }, e)
       const s = 'throwAuditedDenial(p, o, { action: "TRONG_CHUOI" }, e)';
       export async function f(p, o, e, rt, route) {
         await throwAuditedDenial(p, o, { actorType: "USER", actorId: null, action: ACT, resourceType: "R1", payload: {} }, e);
         return identity.throwAuditedDenial(p, o, { action: "B_DENIED", resourceType: "R2", payload: {} }, e, "VE_1");
       }
       export async function g(c, p, route) {
         await requirePermission(c, { userId: "u", orgId: "o", permission: "x.y", resourceType: "R3" }, p);
         await requirePermission(c, { userId: "u", orgId: "o", permission: "x.y", resourceType: route.resourceType }, p);
         await requirePermission(c, { userId: "u", orgId: "o", permission: "x.y", resourceType: rt }, p);
       }`,
    );
    expect(sapXep(mau.hanhDong)).toEqual(["A_DENIED", "B_DENIED"]);
    expect(sapXep(mau.loaiTaiNguyen)).toEqual(["R1", "R2", "R3"]);
    expect([mau.soGoiTuChoi, mau.soGoiCongQuyen, mau.truyenVe, mau.dungRoute]).toEqual([2, 3, true, true]);
    expect(mau.khongGiai).toEqual(["packages/x/src/a.ts:11 resourceType: hằng `rt` không phải const chuỗi cấp tệp"]);

    const route = docTep(
      `${THU_MUC_ROUTE}b.ts`,
      `export const R = [
         { method: "POST", path: "/x", resourceType: "R4", handler: () => 1 },
         { method: "GET", path: "/y", handler: () => 1 },
         { resourceType: "khong_phai_route" },
         { path: "/z", resourceType: bien },
       ];`,
    );
    expect([sapXep(route.route), route.khongGiai]).toEqual([["R4"], [`${THU_MUC_ROUTE}b.ts:5 resourceType: hằng \`bien\` không phải const chuỗi cấp tệp`]]);
    // Cùng văn bản ngoài thư mục route thì không phải route.
    expect(docTep("packages/x/src/b.ts", `export const R = [{ path: "/x", resourceType: "R4" }];`).route.size).toBe(0);
  });

  it("⑹ ĐỐI CHỨNG trên văn bản mẫu: hàm bọc — `<thamSo>.resourceType` chỉ được trong tệp định nghĩa; chỗ gọi hàm bọc cho một tên", () => {
    const than = `export async function tuChoiTheoChotTaiNguyen(p, o, a, taiNguyen, ma) {
         return await throwAuditedDenial(p, o, { action: "CONTROL_DENIED", resourceType: taiNguyen.resourceType, payload: {} }, new Error(ma));
       }`;
    const dinhNghia = docTep(HAM_BOC.tuChoiTheoChotTaiNguyen.tep, than);
    expect([dinhNghia.dungBoc, dinhNghia.khongGiai, sapXep(dinhNghia.hanhDong)]).toEqual([true, [], ["CONTROL_DENIED"]]);
    // Cùng văn bản ở tệp khác: một hàm bọc CHƯA KHAI — đỏ ở chính chỗ truyền, không đoán.
    const noiKhac = docTep("packages/x/src/boc.ts", than);
    expect([noiKhac.dungBoc, noiKhac.khongGiai]).toEqual([false, ["packages/x/src/boc.ts:2 resourceType: biểu thức PropertyAccessExpression"]]);
    const goi = docTep(
      "packages/x/src/goi.ts",
      `const TN = "R9";
       export async function f(p, o, a, id, x) {
         await tuChoiTheoChotTaiNguyen(p, o, a, { resourceType: TN, resourceId: id }, "MA");
         await tuChoiTheoChotTaiNguyen(p, o, a, x, "MA");
       }`,
    );
    expect([goi.soGoiBoc, sapXep(goi.loaiTaiNguyen), goi.khongGiai]).toEqual([2, ["R9"], ["packages/x/src/goi.ts:4 tuChoiTheoChotTaiNguyen: đối số tài nguyên không phải đối tượng viết tại chỗ"]]);
  });

  it("⑹ trên kho: chỉ tệp định nghĩa hàm bọc truyền `<thamSo>.resourceType`, và hàm bọc có chỗ gọi ở gói supplier (K8a) lẫn identity", () => {
    expect(KET_QUA.filter(([, k]) => k.dungBoc).map(([t]) => t)).toEqual([HAM_BOC.tuChoiTheoChotTaiNguyen.tep]);
    const goi = KET_QUA.filter(([, k]) => k.soGoiBoc > 0).map(([t]) => t);
    expect(goi).toContain("packages/supplier/src/xac-minh.ts");
    expect(goi).toContain(HAM_BOC.tuChoiTheoChotTaiNguyen.tep);
  });

  it("bộ đọc thấy các chỗ gọi đã biết của kho, và không chỗ nào nó không giải được", () => {
    const tepGoi = KET_QUA.filter(([, k]) => k.soGoiTuChoi + k.soGoiCongQuyen > 0).map(([t]) => t);
    // Ba chỗ gọi mà tệp này ghim ở ⑸, cộng chính `rbac.ts` (nơi `requirePermission` gọi... không — nơi hai hàm được ĐỊNH NGHĨA,
    // không gọi) — đối chứng chống rỗng ruột không bằng một con số sàn mà bằng ba tên tệp cụ thể.
    for (const t of TEP_TRUYEN_VE) expect(tepGoi, `không thấy lời gọi nào ở ${t}`).toContain(t);
    expect(tepGoi).toContain(TEP_DIEU_PHOI);
    expect(KET_QUA.flatMap(([, k]) => k.khongGiai)).toEqual([]);
  });

  it("⑵⑶ chỉ bộ điều phối truyền `route.resourceType`, và bảng route đọc được ít nhất một route cho mỗi loại tài nguyên của bộ điều phối", () => {
    expect(KET_QUA.filter(([, k]) => k.dungRoute).map(([t]) => t)).toEqual([TEP_DIEU_PHOI]);
    expect(hop((k) => k.route).size).toBeGreaterThan(0);
  });

  it("⑴ tập `action` ở mọi lời gọi `throwAuditedDenial`, cộng `PERMISSION_DENIED` của cổng quyền, BẰNG `DANH_MUC_HANH_DONG_TU_CHOI`", () => {
    const o = hop((k) => k.hanhDong);
    o.add("PERMISSION_DENIED");
    expect(sapXep(o)).toEqual(sapXep(DANH_MUC_HANH_DONG_TU_CHOI));
  });

  it("⑴⑵⑶ tập `resourceType` ở mọi lời gọi hai hàm và ở bảng route BẰNG `DANH_MUC_LOAI_TAI_NGUYEN`", () => {
    const o = new Set([...hop((k) => k.loaiTaiNguyen), ...hop((k) => k.route)]);
    expect(sapXep(o)).toEqual(sapXep(DANH_MUC_LOAI_TAI_NGUYEN));
  });

  it("⑷ hợp ba từ vựng vế ở nguồn BẰNG `DANH_MUC_VE_CONG` — bản chép trong identity không lệch nguồn", () => {
    const o = new Set(Object.entries(NGUON_VE).flatMap(([ten, tep]) => tuVung(tep, ten)));
    expect(sapXep(o)).toEqual(sapXep(DANH_MUC_VE_CONG));
  });

  it("⑸ [khoản 179] đúng ba tệp truyền vế cho `throwAuditedDenial`: cổng mở thầu, bảng so sánh, worker lúc giải mã", () => {
    expect(KET_QUA.filter(([, k]) => k.truyenVe).map(([t]) => t)).toEqual(sapXep(TEP_TRUYEN_VE));
  });
});
