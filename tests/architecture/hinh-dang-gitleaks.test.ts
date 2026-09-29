// ==============================================================================================
// [S1.9191 / khoản 132] CẤU HÌNH CỦA BƯỚC QUÉT BÍ MẬT LÀ MỘT BẢO ĐẢM — NÊN NÓ PHẢI CÓ MỘT MỐC CHẾT
//
// `hinh-dang-ci.test.ts` chỉ đòi chuỗi `gitleaks-action` có mặt trong job `t0c-bi-mat`;
// `tep-van-ban-git.test.ts` canh để gitleaks đọc được mọi tệp. Không tệp `.ts` nào của kho nhắc tới
// `.gitleaks.toml` hay `.gitleaksignore` (đo §S1.72): thêm `paths = [...]` vào `[allowlist]`, chèn một
// `[[rules]]` ghi đè, hay tạo `.gitleaksignore` — mỗi thứ đủ biến một khoá mẫu dưới `apps/` thành
// 0 leak — và mọi cổng tĩnh vẫn xanh. `pnpm t0` cục bộ KHÔNG chạy gitleaks (chú thích đầu
// `.gitleaks.toml`), nên lớp duy nhất nhìn thấy cấu hình ấy trước lượt CI là một phép đọc văn bản.
//
// Hình dạng ghim, đúng lời khai ở đầu `.gitleaks.toml` (S1.43): giữ TOÀN BỘ luật mặc định
// (`[extend] useDefault = true`, không khoá nào khác — `path` là cách kéo một cấu hình khác vào);
// `[allowlist]` chỉ có `regexTarget = "secret"` với ĐÚNG MỘT regex (cộng `description`), không
// `paths`, không `commits`, không `stopwords`; không `[[rules]]`; không khối lạ. Regex ấy phải NEO hai
// đầu, khớp đúng thứ nó sinh ra để miễn (tên tệp migration `NNN_ten`) và KHÔNG khớp một chuỗi có
// hình dạng khoá — mẫu khoá dựng LÚC CHẠY bằng `repeat`, để chính tệp này không mang một chuỗi hình
// khoá cho gitleaks bắt. `.gitleaksignore` (hôm nay không có) chỉ được tồn tại khi khai kèm lý do ở
// `GITLEAKSIGNORE_DA_KHAI`, và một lời khai không có tệp là lời khai thiu — đỏ theo cả hai chiều. Job
// `t0c-bi-mat` không được trỏ `GITLEAKS_CONFIG` đi nơi khác: ghim `.gitleaks.toml` là vô nghĩa nếu
// lượt quét đọc một tệp khác.
//
// Đọc TOML bằng một bộ đọc theo dòng chứ không bằng thư viện: dự án không có phụ thuộc TOML nào,
// và thêm một cái để đọc mười dòng là đổi phạm vi phụ thuộc để mua sự tiện. Cái giá, nói ra: bộ đọc
// ĐÓNG — một dòng nó không hiểu làm nó NÉM (đỏ ồn ào), không bỏ qua; regex Go được thử bằng RegExp
// của JS, nên cú pháp Go mà JS không có cũng NÉM thay vì xanh mù. Mỗi vế có một đột biến đỏ trên
// văn bản mẫu ở cuối tệp; phép kiểm là hàm thuần nhận chuỗi.
// ==============================================================================================

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GOC = new URL("../../", import.meta.url);
const TOML = readFileSync(new URL(".gitleaks.toml", GOC), "utf8").replace(/\r\n/gu, "\n");
const CI = readFileSync(new URL(".github/workflows/ci.yml", GOC), "utf8").replace(/\r\n/gu, "\n");

/**
 * `.gitleaksignore` được phép tồn tại CHỈ KHI có một dòng ở đây nói vì sao. Hôm nay: rỗng, và tệp không
 * có. Một dòng ở đây mà tệp không có là lời khai thiu — cũng đỏ.
 */
const GITLEAKSIGNORE_DA_KHAI: readonly { readonly lyDo: string }[] = [];

/** Chuỗi hình khoá dựng lúc chạy — không một literal hình khoá nào nằm trong tệp để gitleaks bắt. */
const MAU_BI_MAT: readonly string[] = [
  `AKIA${"A".repeat(16)}`, // khoá truy cập AWS
  `ghp_${"a".repeat(36)}`, // token GitHub
  "f".repeat(40), // hex 40 (SHA-1 / token chung)
  `sk_live_${"x".repeat(24)}`, // khoá thanh toán
  `${"0123456789".repeat(3)}_${"a".repeat(64)}`, // dài quá 60 sau gạch dưới — không phải tên migration
];

interface KhoiToml {
  /** `""` là mức gốc (trước khối đầu tiên). */
  readonly ten: string;
  readonly mang: boolean;
  readonly khoa: Map<string, string>;
}

/**
 * Bộ đọc TOML ĐÓNG, đủ cho `.gitleaks.toml`: đầu khối `[a]` / `[[a]]`, `khoá = giá trị`, mảng nhiều dòng
 * cân bằng ngoặc vuông ngoài chuỗi, chú thích `#` đứng đầu dòng. Dòng nào khác thì NÉM.
 */
function docToml(pVanBan: string): KhoiToml[] {
  const khoi: KhoiToml[] = [{ ten: "", mang: false, khoa: new Map() }];
  const dong = pVanBan.split("\n");
  for (let i = 0; i < dong.length; i += 1) {
    const d = dong[i]!.trim();
    if (d === "" || d.startsWith("#")) continue;
    const dauMang = /^\[\[([^\]]+)\]\]$/u.exec(d);
    const dauKhoi = /^\[([^\]]+)\]$/u.exec(d);
    if (dauMang !== null || dauKhoi !== null) {
      khoi.push({ ten: (dauMang ?? dauKhoi)![1]!.trim(), mang: dauMang !== null, khoa: new Map() });
      continue;
    }
    const cap = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/u.exec(d);
    if (cap === null) throw new Error(`.gitleaks.toml dòng ${i + 1}: cú pháp bộ đọc không hiểu — ${JSON.stringify(d)}`);
    let giaTri = cap[2]!;
    while (demNgoacMo(giaTri) > 0) {
      i += 1;
      if (i >= dong.length) throw new Error(`.gitleaks.toml: mảng của khoá ${cap[1]} không đóng`);
      giaTri += `\n${dong[i]!}`;
    }
    const hienTai = khoi[khoi.length - 1]!;
    if (hienTai.khoa.has(cap[1]!)) throw new Error(`.gitleaks.toml: khoá ${cap[1]} lặp trong khối [${hienTai.ten}]`);
    hienTai.khoa.set(cap[1]!, giaTri.trim());
  }
  return khoi;
}

const RE_CHUOI = /'''[\s\S]*?'''|"""[\s\S]*?"""|'[^']*'|"(?:[^"\\]|\\.)*"/gu;

/** Số `[` trừ số `]` NGOÀI chuỗi, sau khi bỏ chú thích cuối dòng. */
function demNgoacMo(pGiaTri: string): number {
  const khongChuoi = pGiaTri.replace(RE_CHUOI, "").replace(/#[^\n]*/gu, "");
  return (khongChuoi.match(/\[/gu) ?? []).length - (khongChuoi.match(/\]/gu) ?? []).length;
}

/** Nội dung các chuỗi trong một giá trị mảng: `['''a''', "b"]` → `["a", "b"]`. */
function cacChuoi(pGiaTri: string): string[] {
  return [...pGiaTri.matchAll(RE_CHUOI)].map((m) => {
    const s = m[0];
    if (s.startsWith("'''") || s.startsWith('"""')) return s.slice(3, -3);
    return s.slice(1, -1);
  });
}

const TEN_TEP_MIGRATION_MAU = "017_rfq_key_material";

/** Vi phạm hình dạng của một `.gitleaks.toml`; rỗng nghĩa là đúng khuôn ghim. */
export function kiemHinhDangGitleaks(pVanBan: string): string[] {
  const viPham: string[] = [];
  const khoi = docToml(pVanBan);
  const goc = khoi[0]!;
  for (const k of goc.khoa.keys()) if (k !== "title") viPham.push(`khoá lạ ở mức gốc: ${k}`);

  for (const k of khoi.slice(1)) {
    if (k.mang && k.ten === "rules") viPham.push("có [[rules]] — một luật ghi đè hay thêm vào bộ mặc định; kho chỉ dùng luật mặc định");
    else if (k.mang || !["extend", "allowlist"].includes(k.ten)) viPham.push(`khối lạ: [${k.mang ? `[${k.ten}]` : k.ten}]`);
  }

  const extend = khoi.find((k) => k.ten === "extend" && !k.mang);
  if (extend === undefined) viPham.push("thiếu [extend] useDefault = true — không có nó, bộ luật mặc định không được nạp");
  else {
    if (extend.khoa.get("useDefault") !== "true") viPham.push("[extend] phải có useDefault = true (giữ TOÀN BỘ luật mặc định)");
    for (const k of extend.khoa.keys()) if (k !== "useDefault") viPham.push(`[extend] có khoá lạ: ${k} — \`path\` kéo một cấu hình khác vào`);
  }

  const allow = khoi.find((k) => k.ten === "allowlist" && !k.mang);
  if (allow === undefined) viPham.push("thiếu [allowlist] regexTarget = \"secret\" với đúng một regex");
  else {
    for (const k of allow.khoa.keys()) {
      if (k === "paths") viPham.push("[allowlist] có paths — miễn theo TỆP là cách một khoá mẫu dưới apps/ thành 0 leak");
      else if (k === "commits") viPham.push("[allowlist] có commits — miễn theo COMMIT tha cả một lần lộ đã vào lịch sử");
      else if (!["description", "regexTarget", "regexes"].includes(k)) viPham.push(`[allowlist] có khoá lạ: ${k}`);
    }
    if (allow.khoa.get("regexTarget") !== '"secret"') viPham.push('[allowlist] regexTarget phải là "secret" — miễn theo phần-bị-coi-là-bí-mật, không theo cả dòng khớp');
    const regexes = cacChuoi(allow.khoa.get("regexes") ?? "");
    if (regexes.length !== 1) viPham.push(`[allowlist] regexes phải có ĐÚNG MỘT regex, thấy ${regexes.length}`);
    for (const r of regexes) {
      if (!r.startsWith("^") || !r.endsWith("$")) viPham.push(`regex miễn phải NEO hai đầu (^…$): ${r}`);
      const re = new RegExp(r, "u");
      if (!re.test(TEN_TEP_MIGRATION_MAU)) viPham.push(`regex miễn không khớp tên tệp migration ${TEN_TEP_MIGRATION_MAU} — thứ nó sinh ra để miễn`);
      for (const mau of MAU_BI_MAT) if (re.test(mau)) viPham.push(`regex miễn khớp một chuỗi hình khoá (${mau.length} ký tự, bắt đầu ${mau.slice(0, 4)}) — nó rộng hơn tên tệp migration`);
    }
  }
  return viPham;
}

/** `.gitleaksignore`: có tệp mà không lời khai, hay có lời khai mà không tệp, hay lời khai không nói gì — đều đỏ. */
export function kiemGitleaksignore(pCoTep: boolean, pDaKhai: readonly { readonly lyDo: string }[]): string[] {
  const viPham: string[] = [];
  if (pCoTep && pDaKhai.length === 0) viPham.push("có .gitleaksignore mà không dòng nào ở GITLEAKSIGNORE_DA_KHAI nói vì sao — tệp ấy tha một lần lộ theo dấu vân tay, im lặng");
  if (!pCoTep && pDaKhai.length > 0) viPham.push("GITLEAKSIGNORE_DA_KHAI có lời khai mà .gitleaksignore không tồn tại — lời khai thiu");
  for (const k of pDaKhai) if (k.lyDo.trim().length <= 40) viPham.push("lý do cho .gitleaksignore phải nói được điều gì (hơn 40 ký tự)");
  return viPham;
}

/** Thân của job `t0c-bi-mat` trong ci.yml, hoặc `null` nếu không có job ấy. */
function thanJobQuetBiMat(pCi: string): string | null {
  const batDau = pCi.indexOf("\n  t0c-bi-mat:\n");
  if (batDau === -1) return null;
  const sau = pCi.slice(batDau + 1);
  const ketThuc = sau.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/u);
  return ketThuc === -1 ? sau : sau.slice(0, ketThuc);
}

/** Job quét bí mật phải gọi gitleaks-action, và không đâu trong ci.yml được trỏ `GITLEAKS_CONFIG` sang tệp khác. */
export function kiemJobQuetBiMat(pCi: string): string[] {
  const viPham: string[] = [];
  const than = thanJobQuetBiMat(pCi);
  if (than === null) viPham.push("ci.yml không có job t0c-bi-mat");
  else if (!/uses:\s*gitleaks\/gitleaks-action@/u.test(than)) viPham.push("job t0c-bi-mat không gọi gitleaks/gitleaks-action");
  if (/\bGITLEAKS_CONFIG\b/u.test(pCi)) viPham.push("ci.yml đặt GITLEAKS_CONFIG — lượt quét sẽ đọc một tệp khác .gitleaks.toml đã ghim");
  return viPham;
}

describe("[khoản 132] hình dạng cấu hình gitleaks", () => {
  it("`.gitleaks.toml` của kho: useDefault = true; [allowlist] chỉ regexTarget = \"secret\" với đúng một regex neo hai đầu; không paths/commits/[[rules]]", () => {
    expect(docToml(TOML).map((k) => k.ten), "chống rỗng ruột: bộ đọc phải thấy đúng hai khối").toEqual(["", "extend", "allowlist"]);
    expect(kiemHinhDangGitleaks(TOML)).toEqual([]);
  });

  it("`.gitleaksignore` không tồn tại, và không lời khai nào thiu", () => {
    expect(kiemGitleaksignore(existsSync(new URL(".gitleaksignore", GOC)), GITLEAKSIGNORE_DA_KHAI)).toEqual([]);
  });

  it("job t0c-bi-mat gọi gitleaks-action và không trỏ GITLEAKS_CONFIG đi nơi khác", () => {
    expect(kiemJobQuetBiMat(CI)).toEqual([]);
  });

  // ------------------------------------------------------------------------------------------
  // ĐỐI CHỨNG ĐỎ — mỗi vế một đột biến trên chính văn bản của kho. `datBien` ném nếu đột biến không
  // đổi gì (một đối chứng không chạm văn bản là một đối chứng xanh vô nghĩa).
  // ------------------------------------------------------------------------------------------
  // Thay bằng HÀM, không bằng chuỗi: `$'` trong một regex TOML là mẫu thay thế đặc biệt của `String.replace` — đã tự vấp khi viết.
  const datBien = (pCu: string, pMoi: string, pGoc = TOML): string => {
    expect(pGoc, `đột biến không tìm thấy đoạn: ${pCu}`).toContain(pCu);
    return pGoc.replace(pCu, () => pMoi);
  };
  const doOMot = (pVanBan: string, pMau: RegExp): void => {
    const viPham = kiemHinhDangGitleaks(pVanBan);
    expect(viPham, `phải đỏ với ${pMau}`).toHaveLength(1);
    expect(viPham[0]).toMatch(pMau);
  };
  /** Regex miễn THẬT của kho, đọc từ chính tệp — đột biến dựng trên nó chứ không trên một bản chép. */
  const regexThat = (): string => {
    const [r] = cacChuoi(docToml(TOML).find((k) => k.ten === "allowlist")!.khoa.get("regexes")!);
    expect(r).toBeDefined();
    return r!;
  };

  it("đỏ: useDefault = false; thiếu [extend]; [extend] path = …", () => {
    doOMot(datBien("useDefault = true", "useDefault = false"), /useDefault = true/u);
    doOMot(datBien("[extend]\nuseDefault = true\n", ""), /thiếu \[extend\]/u);
    doOMot(datBien("useDefault = true", 'useDefault = true\npath = "khac.toml"'), /khoá lạ: path/u);
  });

  it("đỏ: [allowlist] có paths; có commits; có stopwords; regexTarget khác \"secret\"; hai regex; không regex; thiếu [allowlist]", () => {
    doOMot(datBien('regexTarget = "secret"', "regexTarget = \"secret\"\npaths = ['''apps/''']"), /có paths/u);
    doOMot(datBien('regexTarget = "secret"', 'regexTarget = "secret"\ncommits = ["deadbeef"]'), /có commits/u);
    doOMot(datBien('regexTarget = "secret"', 'regexTarget = "secret"\nstopwords = ["example"]'), /khoá lạ: stopwords/u);
    doOMot(datBien('regexTarget = "secret"', 'regexTarget = "match"'), /regexTarget/u);
    // Regex thứ hai là BẢN SAO của regex thật, để vế duy nhất đổi là số lượng.
    doOMot(datBien("regexes = [\n", `regexes = [\n  '''${regexThat()}''',\n`), /ĐÚNG MỘT regex, thấy 2/u);
    // Theo DÒNG, không `[\s\S]*?\]`: dấu `]` đầu tiên sau `regexes = [` nằm TRONG lớp ký tự của regex thật.
    const khongRegex = TOML.replace(/regexes = \[\n[^\n]*\n\]/u, "regexes = []");
    expect(khongRegex).not.toBe(TOML);
    doOMot(khongRegex, /ĐÚNG MỘT regex, thấy 0/u);
    const khongAllow = TOML.slice(0, TOML.indexOf("[allowlist]"));
    doOMot(khongAllow, /thiếu \[allowlist\]/u);
  });

  it("đỏ: regex miễn không neo; regex miễn rộng tới mức khớp một chuỗi hình khoá; regex không khớp tên tệp migration", () => {
    // Bỏ neo thì đỏ HAI vế: thiếu neo, và — hệ quả đo được — regex nay khớp một chuỗi hình khoá có `NNN_` ở giữa.
    const khongNeo = kiemHinhDangGitleaks(datBien(regexThat(), regexThat().slice(1, -1)));
    expect(khongNeo).toHaveLength(2);
    expect(khongNeo[0]).toMatch(/NEO hai đầu/u);
    expect(khongNeo[1]).toMatch(/khớp một chuỗi hình khoá/u);
    const rong = kiemHinhDangGitleaks(datBien(regexThat(), "^.*$"));
    expect(rong.length, "regex `^.*$` phải khớp mọi mẫu khoá").toBe(MAU_BI_MAT.length);
    for (const v of rong) expect(v).toMatch(/khớp một chuỗi hình khoá/u);
    doOMot(datBien(regexThat(), "^zz$"), /không khớp tên tệp migration/u);
  });

  it("đỏ: [[rules]] ghi đè; khối lạ; khoá lạ ở mức gốc; cú pháp bộ đọc không hiểu thì NÉM chứ không bỏ qua", () => {
    doOMot(`${TOML}\n[[rules]]\nid = "x"\ndescription = "y"\nregex = '''z'''\n`, /có \[\[rules\]\]/u);
    doOMot(`${TOML}\n[allowlist.them]\nx = 1\n`, /khối lạ/u);
    doOMot(datBien('title = "TrustProcure — gitleaks"', 'title = "TrustProcure — gitleaks"\nla = 1'), /khoá lạ ở mức gốc: la/u);
    expect(() => kiemHinhDangGitleaks(`${TOML}\nmot dong khong phai key = value\n`)).toThrow(/cú pháp bộ đọc không hiểu/u);
    expect(() => kiemHinhDangGitleaks(datBien("regexes = [\n", "regexes = [\n  '''(?P<x>a)$''',\n"))).toThrow();
  });

  it("đỏ: `.gitleaksignore` có mà không khai; khai mà không có; lý do rỗng — khai đúng thì xanh", () => {
    expect(kiemGitleaksignore(true, [])).toHaveLength(1);
    expect(kiemGitleaksignore(false, [{ lyDo: "một lý do đủ dài để nói được điều gì về lần tha này" }])).toHaveLength(1);
    expect(kiemGitleaksignore(true, [{ lyDo: "ngắn" }])).toHaveLength(1);
    expect(kiemGitleaksignore(true, [{ lyDo: "một lý do đủ dài để nói được điều gì về lần tha này" }])).toEqual([]);
  });

  it("đỏ: ci.yml đặt GITLEAKS_CONFIG; job không gọi gitleaks-action; không có job", () => {
    expect(kiemJobQuetBiMat(datBien('GITLEAKS_ENABLE_COMMENTS: "false"', 'GITLEAKS_ENABLE_COMMENTS: "false"\n          GITLEAKS_CONFIG: khac.toml', CI))).toEqual([
      "ci.yml đặt GITLEAKS_CONFIG — lượt quét sẽ đọc một tệp khác .gitleaks.toml đã ghim",
    ]);
    expect(kiemJobQuetBiMat(datBien("uses: gitleaks/gitleaks-action@v2", "run: echo quet", CI))).toEqual(["job t0c-bi-mat không gọi gitleaks/gitleaks-action"]);
    expect(kiemJobQuetBiMat(datBien("\n  t0c-bi-mat:\n", "\n  t0c-khac:\n", CI))).toEqual(["ci.yml không có job t0c-bi-mat"]);
  });
});
