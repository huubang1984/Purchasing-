// ==============================================================================================
// [S1.255 / khoản 325] NHỮNG ĐIỀU KHÔNG ĐƯỢC TUYÊN BỐ — TRÊN CHÍNH GIAO DIỆN SẢN PHẨM
//
// `docs/PRODUCT.md` §5 cấm một danh sách câu, và nói rõ ràng buộc ấy *"áp cho cả marketing lẫn giao diện
// sản phẩm. Vi phạm là lỗi sản phẩm, không phải chuyện câu chữ."* Tới vòng này không lớp nào đọc giao diện
// theo danh sách ấy, và chân trang của `/nop-thau` — màn nhà cung cấp, hàng 2–7 của kịch bản trình diễn
// (kế hoạch pilot giả lập §5; phút 5–25 của buổi bậc 1, `docs/BUOI-BAC-1.md` §3) — viết từ S1.89: *"giá được
// mã hoá trong trình duyệt, máy chủ không đọc được"*. Đó là hàng *"Kể cả chúng tôi cũng không xem được"* nói
// bằng chữ khác: ADR-002 chọn mô hình đe doạ tầng 1+2, và nhà vận hành vẫn giải mã được. Người phát hiện là
// lượt đi thử bậc 1 trên trình duyệt thật (biên bản §S1.255), không phải một cổng.
//
// Lớp này đòi: không văn bản nào người dùng thấy ở `apps/web` khớp một luật dưới đây, MỖI hàng của bảng §5
// có ĐÚNG MỘT luật (thêm hàng mà không thêm luật ⇒ đỏ), và mỗi luật khớp chính câu cấm của hàng mình.
//
// PHÁT BIỂU ĐÚNG MỨC:
// - Đọc: tệp `git ls-files` dưới `apps/web/` đuôi `.html`, `.js`, `.ts` (bỏ `*.test.ts`). Với HTML: chữ giữa
//   các thẻ (bỏ chú thích, `<script>`, `<style>`) và năm thuộc tính có thể hiện ra (`placeholder`, `title`,
//   `aria-label`, `alt`, `value`). Với JS/TS: mọi chuỗi và mẫu chuỗi trong cây cú pháp (`ts.createSourceFile`,
//   không phải regex trên dòng — chú thích tự rơi ra), và một chuỗi nối bằng `+` — kể cả trong ngoặc — đọc
//   thành MỘT câu.
// - KHÔNG đọc: câu lỗi do `apps/api` hay các gói trả về (trang in chúng qua `loiCua`), thông điệp lỗi của
//   `packages/sealed-envelope` mà `/nop-thau` in ra, tài liệu, README, email/SMS/Zalo do bộ gửi tin dựng; và
//   KHÔNG nối các mảnh của một câu dựng qua nhiều lệnh (`x += "…"`) — mỗi mảnh đọc riêng. Một câu cấm ở đó
//   thì lớp này xanh — nói ra.
// - Luật là biểu thức chính quy trên tiếng Việt có dấu: nó bắt câu cấm và các biến thể đã gặp, không bắt
//   MỌI cách nói cùng ý. Một cách nói mới lọt qua thì thêm mẫu dương và sửa luật, không nới cổng.
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/** Một luật: hàng nào của PRODUCT.md §5 (nguyên văn cột *Không nói*, không ngoặc kép), và biểu thức bắt nó. */
interface Luat {
  readonly hang: string;
  readonly bat: RegExp;
}

/** Chủ ngữ của lời khai *"không ai/kể cả chúng tôi đọc được"* — người vận hành, hệ thống, hay chính sản phẩm. */
const CHU_THE = String.raw`(?:máy chủ|chúng tôi|hệ thống|nhà vận hành|bên vận hành|nền tảng|TrustProcure|quản trị viên)`;
// Không có "thấy": *"hệ thống không thấy vòng nào đang mở"* (`nop-thau.js`, gói BAFO lệch dữ liệu) là câu về dữ liệu, không
// phải lời khai năng lực — đo ở lượt chạy đầu của lớp này, câu ấy nằm ở mẫu âm.
const DONG_TU_DOC = String.raw`(?:đọc|xem|giải mã|biết)`;

const LUAT: readonly Luat[] = [
  { hang: "Triệt tiêu hoàn toàn gian lận", bat: /triệt tiêu[^.!?;]{0,40}gian lận/iu },
  { hang: "IP trùng = thông đồng", bat: /(?:IP\s+trùng|trùng\s+(?:địa chỉ\s+)?IP)\s*(?:=|là|nghĩa là|tức là)\s*(?:thông đồng|gian lận)/iu },
  // "Giá thấp nhất KHÔNG đồng nghĩa…" (bước 4 của `/login`) đứng ngoài: sau "giá thấp nhất" phải là ngay động từ khẳng định.
  { hang: "Giá thấp nhất = nhà cung cấp tốt nhất", bat: /giá thấp nhất\s*(?:=|là|nghĩa là|tức là|đồng nghĩa(?:\s+với)?)\s*(?:nhà cung cấp\s+)?tốt nhất/iu },
  { hang: "AI phát hiện gian lận", bat: /\bAI\b[^.!?;]{0,20}phát hiện[^.!?;]{0,20}gian lận/u },
  {
    hang: "Kể cả chúng tôi cũng không xem được",
    bat: new RegExp(
      String.raw`${CHU_THE}[^.!?;]{0,40}?không\s+(?:thể\s+|hề\s+)?${DONG_TU_DOC}` +
        String.raw`|(?:không ai|kể cả chúng tôi|ngay cả chúng tôi)[^.!?;]{0,40}?${DONG_TU_DOC}\s+được`,
      "iu",
    ),
  },
  { hang: "Vòng BAFO giữ kín giá của bạn với người mua", bat: /giữ kín[^.!?;]{0,40}(?:với|khỏi)\s+(?:người|bên)\s+mua/iu },
  { hang: "Hai người ký thì không ai trao thầu cho người quen được", bat: /không ai[^.!?;]{0,40}trao thầu cho người quen/iu },
  { hang: "Chống được thông đồng giữa người mua và nhà cung cấp", bat: /chống(?:\s+được)?\s+(?:việc\s+)?thông đồng/iu },
  { hang: "Chuẩn hoá dữ liệu chống thao túng giá", bat: /chống(?:\s+được)?\s+(?:việc\s+)?thao túng/iu },
];

/** Mẫu dương ngoài chính câu của hàng: những biến thể đã gặp hay dễ gặp. */
const MAU_DUONG: readonly (readonly [string, string])[] = [
  ["Kể cả chúng tôi cũng không xem được", "Lát cắt demo — giá được mã hoá trong trình duyệt, máy chủ không đọc được."],
  ["Kể cả chúng tôi cũng không xem được", "Ngay cả nhà vận hành cũng không thể giải mã báo giá của bạn."],
  ["Kể cả chúng tôi cũng không xem được", "Không ai đọc được giá của bạn trước hạn nộp."],
  ["Kể cả chúng tôi cũng không xem được", "Hệ thống không hề biết giá anh/chị chào."],
  ["Giá thấp nhất = nhà cung cấp tốt nhất", "Giá thấp nhất là tốt nhất."],
  ["Chống được thông đồng giữa người mua và nhà cung cấp", "Sản phẩm chống thông đồng."],
];

/** Mẫu âm: câu THẬT của giao diện (hay câu thay thế §5 cho phép) mà một luật lỏng tay sẽ bắt nhầm. */
const MAU_AM: readonly string[] = [
  "Giá thấp nhất không đồng nghĩa nhà cung cấp tốt nhất. Bảng này so GIÁ CHÀO; xếp hạng theo chi phí hiệu dụng là bước 5.",
  "Đã vào với người dùng 38748cb0…. Phiên nằm trong cookie HttpOnly, JavaScript không đọc được nó.",
  "Đã xếp việc cho tiến trình mở thầu. Tiến trình `api` không có khoá để tự giải mã.",
  "3 báo giá sẽ dự thầu (không kể lời mời đã thu hồi). Không một mức giá nào đọc được ở đây.",
  "Gói thầu đang ở vòng BAFO nhưng hệ thống không thấy vòng nào đang mở — dữ liệu gói thầu không nhất quán. Báo giá CHƯA được gửi; báo cho bên mua.",
  "Mọi lần truy cập đều để lại dấu vết bất biến",
  "Lát cắt demo — giá được niêm phong ngay trong trình duyệt trước khi gửi đi. Mọi lần truy cập đều để lại dấu vết bất biến.",
  "Giảm khả năng can thiệp vào báo giá",
  "Làm việc móc nối đắt hơn và để lại dấu đọc được",
  "Phát hiện dấu hiệu bất thường",
];

/** Các hàng của bảng §5 — nguyên văn ô đầu, bỏ đánh dấu Markdown và ngoặc kép. */
function hangBangMuc5(): string[] {
  const md = readFileSync(`${GOC}docs/PRODUCT.md`, "utf8").replace(/\r\n/gu, "\n");
  const dau = md.indexOf("\n## 5. ");
  const cuoi = md.indexOf("\n## ", dau + 1);
  expect(dau, "PRODUCT.md mất mục 5").toBeGreaterThan(0);
  const muc = md.slice(dau, cuoi);
  return muc
    .split("\n")
    .filter((d) => d.startsWith("| ") && !d.startsWith("| Không nói") && !/^\|\s*-/u.test(d))
    .map((d) => d.split("|")[1] ?? "");
}

/** Chữ người dùng thấy trong một tệp HTML: giữa các thẻ, cộng năm thuộc tính có thể hiện ra. */
function chuCuaHtml(html: string): string[] {
  const sach = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ");
  const thuocTinh = [...sach.matchAll(/\s(?:placeholder|title|aria-label|alt|value)="([^"]*)"/giu)].map((m) => m[1] ?? "");
  const giuaThe = sach
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
  return [giuaThe, ...thuocTinh];
}

/** Chữ của một nút chuỗi: chuỗi trơn, mẫu chuỗi (phần tĩnh), hay `undefined` khi không phải chuỗi. */
function chuCuaNut(n: ts.Node): string | undefined {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" … ");
  return undefined;
}

/** Trải một chuỗi `a + b + c` thành các toán hạng, theo thứ tự. */
function traiCong(n: ts.Expression): ts.Expression[] {
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...traiCong(n.left), ...traiCong(n.right)];
  if (ts.isParenthesizedExpression(n)) return traiCong(n.expression);
  return [n];
}

const laCong = (n: ts.Node): n is ts.BinaryExpression => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;

/** Cha thật của một nút — leo qua mọi lớp ngoặc: `return ("a " + "b")` có gốc chuỗi là phép `+` trong ngoặc. */
function chaQuaNgoac(n: ts.Node): ts.Node {
  let c = n.parent;
  while (ts.isParenthesizedExpression(c)) c = c.parent;
  return c;
}

/** Mọi câu người dùng có thể thấy trong một tệp JS/TS: mỗi chuỗi, và mỗi chuỗi nối `+` thành MỘT câu. */
function chuCuaMa(ten: string, ma: string): string[] {
  const sf = ts.createSourceFile(ten, ma, ts.ScriptTarget.Latest, true, ten.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const ra: string[] = [];
  const di = (n: ts.Node): void => {
    // [lượt soi đối kháng] Bản đầu coi một phép `+` có cha là NGOẶC là không-phải-gốc, nên `return ("…" + "…")` không bao giờ được
    // nối (khuôn thật ở `apps/web/src/dong-ho-may-chu.ts`). Gốc của chuỗi là phép `+` mà cha thật — qua mọi lớp ngoặc — không phải `+`.
    if (laCong(n) && !laCong(chaQuaNgoac(n))) {
      const phan = traiCong(n).map((x) => chuCuaNut(x) ?? " … ");
      if (phan.some((p) => p !== " … ")) ra.push(phan.join(""));
    }
    const chu = chuCuaNut(n);
    if (chu !== undefined) ra.push(chu);
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/** Tệp giao diện được đọc: theo `git ls-files`, không theo thư mục (khoản của bộ dò `zzprobe-*`). */
function tepGiaoDien(): string[] {
  return execFileSync("git", ["ls-files", "apps/web"], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter((d) => /\.(?:html|js|ts)$/u.test(d) && !d.endsWith(".test.ts"))
    .sort();
}

function chuCuaTep(duong: string): string[] {
  const noiDung = readFileSync(`${GOC}${duong}`, "utf8");
  const cau = duong.endsWith(".html") ? chuCuaHtml(noiDung) : chuCuaMa(duong, noiDung);
  return cau.map((c) => c.normalize("NFC").replace(/\s+/gu, " ").trim()).filter((c) => c !== "");
}

function viPham(cau: string): string[] {
  return LUAT.filter((l) => l.bat.test(cau)).map((l) => l.hang);
}

/** Đoạn quanh chỗ khớp — một trang HTML đọc thành một khối dài, và đầu trang không nói gì về chỗ sai. */
function doanKhop(cau: string, bat: RegExp): string {
  const m = bat.exec(cau);
  if (m === null) return cau.slice(0, 160);
  return cau.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40);
}

describe("[S1.255 / khoản 325] giao diện không mang câu cấm của PRODUCT.md §5", () => {
  it("không văn bản nào người dùng thấy ở apps/web khớp một luật", () => {
    const sai: string[] = [];
    for (const duong of tepGiaoDien()) {
      for (const cau of chuCuaTep(duong)) {
        for (const l of LUAT.filter((x) => x.bat.test(cau))) sai.push(`${duong}: «…${doanKhop(cau, l.bat)}…» — hàng «${l.hang}»`);
      }
    }
    expect(sai, "câu cấm của PRODUCT.md §5 trên giao diện — viết lại bằng cột «Nói thay bằng»").toEqual([]);
  });

  it("mỗi hàng của bảng §5 có ĐÚNG MỘT luật, và câu của hàng nằm nguyên văn trong ô của hàng ấy", () => {
    const hang = hangBangMuc5();
    expect(hang, "số hàng của bảng §5 đổi: thêm (hay bỏ) luật tương ứng ở tệp này").toHaveLength(LUAT.length);
    for (const l of LUAT) {
      expect(hang.filter((o) => o.includes(l.hang)), `«${l.hang}» không còn đúng một ô của bảng §5`).toHaveLength(1);
    }
  });

  it.each(LUAT.map((l) => [l.hang, l] as const))("luật của «%s» bắt chính câu cấm của hàng mình, và chỉ luật ấy", (_ten, l) => {
    expect(viPham(l.hang)).toEqual([l.hang]);
  });

  it.each(MAU_DUONG)("mẫu dương của «%s»: «%s»", (hang, cau) => {
    expect(viPham(cau)).toContain(hang);
  });

  it.each(MAU_AM.map((c) => [c]))("mẫu âm không bị bắt: «%s»", (cau) => {
    expect(viPham(cau)).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: bộ đọc thấy đủ các trang, thấy chữ HTML, thuộc tính, chuỗi JS và chuỗi nối `+`", () => {
    const tep = tepGiaoDien();
    for (const t of ["apps/web/trang/nop-thau.html", "apps/web/trang/mo-thau.html", "apps/web/trang/mo-thau.js", "apps/web/src/dang-nhap.ts"]) {
      expect(tep, t).toContain(t);
    }
    const tatCa = (d: string) => chuCuaTep(d).join("\n");
    expect(tatCa("apps/web/trang/mo-thau.html")).toContain("Giá thấp nhất không đồng nghĩa nhà cung cấp tốt nhất");
    expect(tatCa("apps/web/trang/nop-thau.html"), "thuộc tính placeholder").toContain("mã trong link");
    // Câu của `CHUA_CO_YEU_CAU` (`mo-thau.js`) là HAI chuỗi nối `+`: phải đọc thành một câu, cắt ngang chỗ nối.
    expect(tatCa("apps/web/trang/mo-thau.js")).toContain("Dán mã gói thầu ở bước 2 rồi bấm Đọc — trang sẽ tự lấy yêu cầu đang treo");
  });

  it("bộ đọc tự kiểm: chú thích HTML/JS rơi ra, chuỗi trong mẫu chuỗi và chuỗi nối `+` bị bắt", () => {
    const html = `<p>An toàn.</p><!-- máy chủ không đọc được --><footer>Giá niêm phong</footer><input placeholder="Không ai xem được giá">`;
    expect(chuCuaHtml(html).flatMap(viPham)).toEqual(["Kể cả chúng tôi cũng không xem được"]);
    const js = [
      "// Kể cả chúng tôi cũng không xem được — chú thích, không phải chữ của màn",
      'const a = "Giá được niêm phong, " + "máy chủ " + "không đọc được.";',
      "const b = `Gói ${ten}: hệ thống không thể giải mã`;",
    ].join("\n");
    expect(chuCuaMa("x.js", js).flatMap(viPham)).toEqual(["Kể cả chúng tôi cũng không xem được", "Kể cả chúng tôi cũng không xem được"]);
  });

  it("bộ đọc tự kiểm: chuỗi `+` TRONG NGOẶC (kể cả ngoặc lồng) đọc thành một câu; thuộc tính `value` bị đọc", () => {
    const js = [
      'function a() { return ("Giá niêm phong, máy chủ " + "không đọc được giá."); }',
      'const b = "Giá niêm phong, " + ("nhà vận hành " + ("cũng " + "không thể giải mã"));',
    ].join("\n");
    expect(chuCuaMa("x.ts", js).flatMap(viPham)).toEqual(["Kể cả chúng tôi cũng không xem được", "Kể cả chúng tôi cũng không xem được"]);
    expect(chuCuaHtml(`<input id="x" value="Máy chủ không đọc được giá">`).flatMap(viPham)).toEqual(["Kể cả chúng tôi cũng không xem được"]);
    // Đối chứng trên tệp thật: `moTaLechMay` trả `( \`…\` + "…" )` — hai mảnh phải đọc thành một câu.
    expect(chuCuaTep("apps/web/src/dong-ho-may-chu.ts").join("\n")).toMatch(/so với giờ hệ thống\. Hạn nộp được tính theo giờ hệ thống/u);
  });
});
