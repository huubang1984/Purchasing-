// ==============================================================================================
// [INV-H21] QT3 CÓ LỚP MÁY — VÀ NÓ CANH ĐÚNG THỨ NGUY HIỂM NHẤT: CÂU SQL GHIM NỬA VỜI
//
// ----------------------------------------------------------------------------------------------
// KHOẢN NỢ 8, NGUYÊN VĂN: *"Không lớp máy nào cưỡng chế quy ước QT3; chú thích + test là tất cả
// những gì đang giữ nó."* Nó là khoản nợ S0 nặng nhất còn lại tính tới S1.21.
// ----------------------------------------------------------------------------------------------
//
// QT3 nói: mọi câu SQL chạy dưới một `search_path` mà dự án KHÔNG kiểm soát phải ghim đủ **bốn
// trục** — tên hàm (`pg_catalog.now()`), toán tử (`OPERATOR(pg_catalog.=)`), ép kiểu
// (`::pg_catalog.uuid`) và tên bảng (`public.sessions`). Cả bốn đã được ĐO là cướp được trên
// PostgreSQL 16 ở chính kho này (Task 8 vòng fix 1–3, Task 9 §I-3).
//
// ----------------------------------------------------------------------------------------------
// [S1.24] CHỦ THỂ NAY LÀ **MỌI CÂU**. Khoản nợ 62 đóng: 63 câu còn lại đã được ghim trong một
// lượt, nên phép lọc `daGhim` và mốc `TRAN_TOI_DA` không còn chỗ đứng — giữ chúng lại sau khi
// phần dư đã hết là để lại một cánh cửa mở có khoá treo lủng lẳng.
//
// Ba con số của lượt di trú, vì chúng nói về CHÍNH LỚP NÀY chứ không riêng mã sản xuất: sổ nợ
// khai **80** câu "chưa ghim gì", đo lại được **9** trong đó KHÔNG PHẢI SQL (thông báo lỗi tiếng
// Việt mở đầu bằng `INSERT` — bộ đọc chỉ đòi chuỗi BẮT ĐẦU bằng một từ khoá) và **8** câu không
// có gì để ghim (`SET lock_timeout = 0`, `SET ROLE $1`, `SELECT current_user`). Việc thật là
// **63**. Chín thông báo kia được SỬA CHỖ GỌI chứ không nới bộ đọc: một hàng rào an ninh thà kêu
// nhầm còn hơn bỏ sót, và giá của lần kêu nhầm này là chín câu văn.
//
// Khối dưới đây giữ nguyên chữ vì nó vẫn đúng về THỨ TỰ ƯU TIÊN — vòng S1.22 chọn câu ghim nửa
// vời trước là chọn đúng, và lý do ấy không mất giá trị khi phần dư đã hết:
// ----------------------------------------------------------------------------------------------
// ~~VÌ SAO CHỦ THỂ LÀ *"CÂU ĐÃ GHIM MỘT THỨ"* CHỨ KHÔNG PHẢI *"MỌI CÂU"*~~
// ----------------------------------------------------------------------------------------------
// Đo trước vòng S1.22 trên toàn bộ mã sản xuất có SQL: **13 câu ghim NỬA VỜI**, và phần dư là
// những câu chưa ghim trục nào.
//
// ~~Nếu chủ thể là *"mọi câu"* thì lớp này đòi một cuộc di trú 200+ chỗ trong một vòng — đúng thứ
// khoản nợ 29 cảnh báo.~~ Con số **200+** ấy cũng là một ước lượng chưa đo: việc thật hoá ra là
// **63** câu, và nó đi hết trong một vòng. Nhưng **câu ghim nửa vời là chiều hỏng ĐẮT NHẤT**, và
// lý do không phải số học:
//
//   • một câu ghim KHÔNG GÌ trông đúng như nó là — chưa được bảo vệ, và người đọc thấy ngay;
//   • một câu ghim NỬA VỜI **đọc như đã được bảo vệ**. Nó mang `OPERATOR(pg_catalog.=)` ở ba chỗ
//     và một `=` trần ở chỗ thứ tư; mắt người trượt qua, và bảo đảm thì hỏng ở đúng chỗ trần.
//
// Đó là cùng một hình dạng với *"xanh giả"*: thứ tệ hơn một lỗ hổng là một lỗ hổng trông như đã
// được vá. Nên tính chất chịu lực của tệp này là: **ghim thì phải ghim ĐỦ.**
//
// ----------------------------------------------------------------------------------------------
// PHẠM VI, NÓI RA THAY VÌ ĐỂ NGƯỜI ĐỌC TỰ SUY (review lượt 14, H14-M8)
// ----------------------------------------------------------------------------------------------
// Lớp này đọc **tệp `.ts` sản xuất** dưới `packages|apps|tools` + `/src/`. Nó **KHÔNG** phủ
// `db/migrations/*.sql` và `hardening.always.sql`, và đó là một lựa chọn có lý do đo được, không
// phải một chỗ quên: chúng chạy trên kết nối của `migrate()`, nơi câu lệnh ĐẦU TIÊN là
// `SET search_path = public` (`packages/db/src/migrate.ts`) — một `search_path` KHÔNG nêu tên
// `pg_catalog`, tức `pg_catalog` được tìm ngầm TRƯỚC TIÊN và không trục nào cướp được. Thứ giữ
// cho tiền đề ấy đứng là vế thứ hai của chính tệp này.
//
// ----------------------------------------------------------------------------------------------
// VẾ THỨ HAI: ĐIỀU KIỆN TIÊN QUYẾT CỦA MỌI CA CƯỚP ĐÃ ĐO
// ----------------------------------------------------------------------------------------------
// Cả ba ca cướp trong sổ đều cần MỘT tiền đề: `search_path` của phiên phải NÊU TÊN `pg_catalog` ở
// vị trí SAU. Ba đường đưa tiền đề ấy vào: `rolconfig` (hardening ép `rolconfig IS NULL` MỖI
// deploy — đã canh), tham số `options` của chuỗi kết nối (`createPool` từ chối — đã canh), và
// **một câu chạm `search_path` do chính mã ứng dụng phát ra (KHÔNG lớp nào canh)**.
//
// Vế thứ hai đóng đường thứ ba. Nó kiểm theo *"câu này có nhắc tới `search_path` không"* chứ
// KHÔNG theo một cú pháp — review lượt 14 (H14-3) chỉ ra bản đầu chỉ khớp `SET search_path` và bỏ
// lọt `SET LOCAL search_path`, `SET SESSION search_path` và `set_config('search_path', …)`, trong
// khi `SET LOCAL` và `set_config` đều là khuôn ĐANG DÙNG của chính kho này.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { moiCauSql, type CauSql } from "./qt3-doc-sql.js";
import { NGU_PHAP_KHONG_GHIM, TU_KHOA_SAU_FROM, TU_KHOA_TRUOC_NGOAC } from "./qt3-tu-vung.js";

/**
 * ~~Mốc ghim của PHẦN DƯ — khoản nợ 62.~~ **[S1.24] MỐC ĐÃ ĐƯỢC GỠ, VÌ PHẦN DƯ ĐÃ HẾT.**
 *
 * ~~Số câu SQL trong mã sản xuất chưa ghim một trục nào. Con số này chỉ được ĐI XUỐNG.~~ Một mốc
 * chỉ-đi-xuống là hàng rào của một cuộc di trú ĐANG chạy; khi số về 0 thì giữ nó lại chỉ còn tác
 * dụng cho phép quay lui. Luật nay là điều kiện chặt hơn và không có tham số: **mọi câu, đủ bốn
 * trục** — xem `it("MỌI câu SQL …")` bên dưới.
 *
 * Số câu SQL và số tệp mà bộ đọc PHẢI thấy — đóng đinh sát số đo, không phải một cái sàn lỏng.
 *
 * **[S1.24] 148 → 139, và con số này ĐI XUỐNG một cách hợp lệ:** chín chuỗi rời khỏi tập vì chúng
 * chưa bao giờ là SQL — thông báo lỗi tiếng Việt mở đầu bằng `INSERT`. Chúng được sửa ở CHỖ GỌI
 * (`"Câu INSERT … không trả về hàng nào"`), không phải bằng cách nới bộ đọc. Một cái sàn tụt vì
 * bộ đọc mù đi là một cái sàn hỏng; cái sàn này tụt vì tập chủ thể đúng lên.
 */
const SO_CAU_TOI_THIEU = 139;
const SO_TEP_TOI_THIEU = 27;

/**
 * Tệp DUY NHẤT được chạm `search_path`, và lý do KHÔNG được đo bằng độ dài câu văn.
 *
 * [review lượt 14, H14-M1] Bản đầu miễn theo TỆP và chỉ khẳng định `lyDo.length > 40` — tức mệnh
 * đề chịu lực (*"câu ấy không nêu tên `pg_catalog`"*) không được kiểm bởi bất cứ gì. Nay chính
 * VĂN BẢN của mọi câu được miễn phải chứng minh mệnh đề ấy: xem phép kiểm dưới.
 */
const DUOC_CHAM_SEARCH_PATH: Readonly<Record<string, string>> = {
  "packages/db/src/migrate.ts":
    "câu lệnh đầu tiên trên kết nối GIỮ KHOÁ của migrate(), và nó KHÔNG nêu `pg_catalog` — xem " +
    "khối `[fix vòng 2 — CR1]` tại chỗ",
};

export interface ViPhamGhim {
  readonly truc: "toán tử" | "tên hàm" | "ép kiểu" | "tên bảng";
  readonly ten: string;
  readonly nguCanh: string;
}

// [review lượt 14, H14-M3] `~ !~ ~* | & ^ #` thiếu ở bản đầu — `~` là toán tử so khớp biểu thức
// chính quy, cướp được y hệt `=`.
const RE_TOAN_TU = /(<=|>=|<>|!=|@>|<@|&&|>>|<<|\|\||!~\*?|~\*?|=|<|>|\+|-|\/|%|\||&|\^|#)/g;
// [H14-M2] cờ `i`: `NOW()`, `$1::UUID` phải bị bắt y như chữ thường.
const RE_HAM = /(?<![\w.])([a-z_][a-z0-9_]*)\(/gi;
const RE_EP_KIEU = /::\s*([a-z_][a-z0-9_.]*)/gi;
// [H14-M3] `CAST(x AS <kiểu>)` là trục ép kiểu thứ hai, và nó là trục đã tái lập được end-to-end.
const RE_CAST = /\bCAST\s*\([^)]*?\bAS\s+([a-z_][\w.]*)/gi;
// [H14-M4] `USING` (của `DELETE … USING`) và các động từ DDL vào cùng vị trí với FROM/JOIN.
const RE_BANG =
  /\b(?:FROM|JOIN|INTO|UPDATE|USING|TRUNCATE|REFERENCES|ALTER\s+TABLE)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)(?![\w.(])/gi;

/** Bỏ chú thích SQL và hằng chuỗi SQL — nội dung của chúng không phải tên cần phân giải. */
export function lamSach(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "'S'");
}

/**
 * Vị trí của những dấu `=` là PHÉP GÁN trong mệnh đề `SET` — chỉ CHÚNG là ngữ pháp.
 *
 * [review lượt 14, H14-1] Bản đầu miễn cả một KHOẢNG, nên mọi toán tử trong biểu thức bên phải
 * của phép gán cũng được miễn — `SET a = b + 1` không bị kêu, và khi không có `WHERE` theo sau
 * (ca `ON CONFLICT DO UPDATE SET …`) thì khoảng ấy kéo tới hết câu. Đó là lỗ đắt nhất của bản
 * đầu: `UPDATE invitation_otp_challenges SET failed_attempts = c.failed_attempts + 1,
 * locked_until = CASE WHEN c.failed_attempts + 1 >= $2 …` — bộ đếm khoá của E3 — sẽ đi qua trong
 * im lặng ngay khi tên bảng của nó được ghim.
 *
 * Nay chỉ dấu `=` ĐẦU TIÊN ở độ sâu ngoặc 0 của mỗi mục trong danh sách `SET` được miễn.
 */
function viTriGanTrongSet(sql: string): ReadonlySet<number> {
  const ra = new Set<number>();
  for (const m of sql.matchAll(/\bSET\b/gi)) {
    let i = m.index + m[0].length;
    let sau = 0;
    let choGan = true;
    while (i < sql.length) {
      const c = sql[i]!;
      if (c === "(") sau += 1;
      else if (c === ")") sau -= 1;
      else if (sau === 0) {
        if (c === ",") {
          choGan = true;
        } else if (
          c === "=" &&
          choGan &&
          !["<", ">", "!"].includes(sql[i - 1] ?? "") &&
          sql[i + 1] !== ">"
        ) {
          ra.add(i);
          choGan = false;
        } else if (/^\s(?:WHERE|FROM|RETURNING)\b/i.test(sql.slice(i, i + 11))) {
          break;
        }
      }
      i += 1;
    }
  }
  return ra;
}

/** Tên của mọi CTE — `WITH x AS (…)`. [H14-M4] Chúng KHÔNG phải bảng; đòi `public.x` là SQL sai. */
function tenCte(sql: string): ReadonlySet<string> {
  return new Set(
    [...sql.matchAll(/\b(?:WITH|,)\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((m) => m[1]!.toLowerCase()),
  );
}

/**
 * Che những chỗ ĐÃ GHIM để không đếm lại chúng như chỗ trần — và che bằng DẤU CÁCH.
 *
 * Bản đầu che bằng `#` và `@`; vòng sửa này thêm `#` vào `RE_TOAN_TU` (H14-M3), và kết quả là mọi
 * ký tự mặt nạ tự tố cáo mình là một toán tử trần — 44 câu ĐỎ vì chính cái mặt nạ. Một mặt nạ
 * phải là thứ bộ dò KHÔNG đọc được, nên nó là dấu cách.
 *
 * Và chỉ trục TOÁN TỬ mới cần mặt nạ: ba trục kia đã tự loại phần đã ghim bằng chính hình dạng
 * của chúng (`(?<![\w.])` cho tên hàm, `(?![\w.(])` cho tên bảng, tiền tố cho ép kiểu). Che
 * `public.sessions` bằng dấu cách sẽ làm `FROM public.sessions s` thành `FROM   s`, tức bộ dò đi
 * kết tội BÍ DANH `s` là một tên bảng trần.
 */
function cheToanTuDaGhim(sql: string): string {
  return sql
    .replace(/OPERATOR\(pg_catalog\.[^)]*\)/gi, (s) => " ".repeat(s.length))
    .replace(/=>/g, "  ");
}

export function viPhamGhim(sqlGoc: string): readonly ViPhamGhim[] {
  const sql = lamSach(sqlGoc);
  const che = cheToanTuDaGhim(sql);
  const gan = viTriGanTrongSet(che);
  const cte = tenCte(sql);
  const nc = (i: number): string => sql.slice(Math.max(0, i - 26), i + 12).replace(/\s+/g, " ");
  const ra: ViPhamGhim[] = [];

  for (const m of che.matchAll(RE_TOAN_TU)) {
    if (gan.has(m.index)) continue;
    ra.push({ truc: "toán tử", ten: m[1]!, nguCanh: nc(m.index) });
  }
  for (const m of sql.matchAll(RE_HAM)) {
    const ten = m[1]!.toLowerCase();
    if (TU_KHOA_TRUOC_NGOAC.includes(ten) || NGU_PHAP_KHONG_GHIM.includes(ten)) continue;
    // `… AS k(ten)` là bí danh bảng kèm danh sách cột, không phải lời gọi hàm.
    if (/\bAS\s+$/i.test(sql.slice(Math.max(0, m.index - 6), m.index))) continue;
    ra.push({ truc: "tên hàm", ten, nguCanh: nc(m.index) });
  }
  for (const m of sql.matchAll(RE_EP_KIEU)) {
    const kieu = m[1]!.toLowerCase();
    if (kieu.startsWith("pg_catalog.") || kieu.startsWith("public.")) continue;
    ra.push({ truc: "ép kiểu", ten: kieu, nguCanh: nc(m.index) });
  }
  for (const m of sql.matchAll(RE_CAST)) {
    const kieu = m[1]!.toLowerCase();
    if (kieu.startsWith("pg_catalog.") || kieu.startsWith("public.")) continue;
    ra.push({ truc: "ép kiểu", ten: kieu, nguCanh: nc(m.index) });
  }
  for (const m of sql.matchAll(RE_BANG)) {
    const ten = m[1]!.toLowerCase();
    if (TU_KHOA_SAU_FROM.includes(ten) || cte.has(ten)) continue;
    ra.push({ truc: "tên bảng", ten, nguCanh: nc(m.index) });
  }
  return ra;
}

/** Một câu ĐÃ GHIM ít nhất một trục — tức nó tự khai là đang đứng dưới QT3. */
export function daGhim(sql: string): boolean {
  return /OPERATOR\(pg_catalog\.|pg_catalog\.|public\./i.test(lamSach(sql));
}

/**
 * Câu chạm `search_path` — mọi cú pháp, không riêng `SET search_path`.
 *
 * Đọc SQL GỐC chứ không đọc `lamSach(sql)`: ở ca `set_config('search_path', …)` cái tên nằm bên
 * TRONG một hằng chuỗi, nên bản đã bỏ chuỗi không thấy gì — đúng ca mà đối chứng dương bắt được.
 */
function chamSearchPath(sql: string): boolean {
  return /\bsearch_path\b/i.test(sql);
}

// ==============================================================================================

const CAC_CAU = moiCauSql();

describe("[INV-H21] QT3: ghim thì phải ghim ĐỦ", () => {
  it("bộ đọc thấy đủ mã có SQL — nếu nó thấy quá ít thì mọi khẳng định dưới đây rỗng ruột", () => {
    expect(CAC_CAU.length).toBeGreaterThanOrEqual(SO_CAU_TOI_THIEU);
    expect(new Set(CAC_CAU.map((c) => c.tep)).size).toBeGreaterThanOrEqual(SO_TEP_TOI_THIEU);
  });

  it("bộ đọc GHÉP được câu nối bằng `+` — không thì nửa sau mọi câu như thế là vô hình", () => {
    // `packages/audit/src/writer.ts` là đường ghi DUY NHẤT của sổ kiểm toán và nó viết bằng nhiều
    // mảnh nối `+`. Nếu bộ đọc không ghép, `FROM public.audit_append(...)` nằm ngoài tầm nhìn.
    const cau = CAC_CAU.find(
      (c) => c.tep === "packages/audit/src/writer.ts" && c.sql.includes("audit_append"),
    );
    expect(cau, "không thấy câu ghi sổ kiểm toán — bộ đọc đang bỏ sót").toBeDefined();
    expect(cau!.sql).toMatch(/SELECT[\s\S]*FROM/i);
  });

  it("MỌI câu SQL trong mã sản xuất phải ghim ĐỦ BỐN TRỤC — không còn phần dư nào được miễn", () => {
    // [S1.24] Phép lọc `daGhim` đã bị GỠ khỏi đúng dòng này. Trước đó chủ thể là "câu đã tự khai
    // rằng nó đứng dưới QT3"; nay là mọi câu. Đó là toàn bộ nội dung của khoản nợ 62.
    const loi = CAC_CAU.map((c) => ({ c, v: viPhamGhim(c.sql) }))
      .filter((x) => x.v.length > 0)
      .map((x) => `${x.c.tep}:${x.c.dong} — ${x.v.map((v) => `${v.truc} \`${v.ten}\``).join(", ")}`);
    expect(loi).toEqual([]);
  });

  it("câu ghim NỬA VỜI vẫn bị bắt — hình dạng đắt nhất không mất chủ khi luật rộng ra", () => {
    // Luật mới bao luật cũ, nhưng một mệnh đề bị bao vẫn đáng có mũi đo riêng: nếu ai đó thu chủ
    // thể lại trong tương lai, mũi này ĐỎ trước khi con số tổng kịp đổi.
    const nuaVoi =
      "UPDATE public.sessions SET revoked_at = pg_catalog.now() " +
      "WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND org_id = $2";
    expect(viPhamGhim(nuaVoi).map((v) => `${v.truc} ${v.ten}`)).toEqual(["toán tử ="]);
  });

  it("ĐỐI CHỨNG DƯƠNG: gỡ MỘT ghim khỏi một câu thật thì ĐỎ, cho từng trục một", () => {
    const cau = CAC_CAU.find((c) => c.tep === "packages/identity/src/mfa.ts" && daGhim(c.sql));
    expect(cau, "mfa.ts phải có một câu đã ghim").toBeDefined();
    const sql = cau!.sql;
    expect(viPhamGhim(sql)).toEqual([]);
    // [review lượt 14, L14-3] `String.replace` với chuỗi không có mặt KHÔNG ném — nó trả nguyên
    // bản. Nên khẳng định chuỗi cần thay CÓ MẶT trước, không thì mũi đột biến rỗng ruột.
    for (const [cu, moi, truc] of [
      ["OPERATOR(pg_catalog.=)", "=", "toán tử"],
      ["pg_catalog.clock_timestamp(", "clock_timestamp(", "tên hàm"],
      ["::pg_catalog.uuid", "::uuid", "ép kiểu"],
      ["public.sessions", "sessions", "tên bảng"],
    ] as const) {
      expect(sql.includes(cu), `neo đột biến "${cu}" không có trong câu`).toBe(true);
      expect(viPhamGhim(sql.replace(cu, moi)).some((v) => v.truc === truc)).toBe(true);
    }
  });

  it("[H14-1] toán tử trong VẾ PHẢI của một phép gán `SET` KHÔNG được miễn", () => {
    // Chỉ dấu `=` gán là ngữ pháp. `+` và `>=` bên phải nó thì không, và đó đúng là hình dạng của
    // bộ đếm khoá E3 ở `packages/invitation/src/invitation.ts`.
    expect(viPhamGhim("UPDATE public.t SET a = 1, b = 2 WHERE id OPERATOR(pg_catalog.=) $1")).toEqual([]);
    expect(
      viPhamGhim("UPDATE public.t SET a = b + 1 WHERE id OPERATOR(pg_catalog.=) $1").map(
        (x) => `${x.truc} ${x.ten}`,
      ),
    ).toEqual(["toán tử +"]);
    // và ca KHÔNG có WHERE theo sau (ON CONFLICT DO UPDATE SET …) cũng phải bị soi
    expect(
      viPhamGhim("INSERT INTO public.t VALUES ($1) ON CONFLICT (id) DO UPDATE SET a = t.a + 1").map(
        (x) => `${x.truc} ${x.ten}`,
      ),
    ).toEqual(["toán tử +"]);
  });

  it("bộ dò KHÔNG kêu ở những chỗ NGỮ PHÁP — nếu nó kêu thì nó dạy người ta viết SQL sai", () => {
    expect(viPhamGhim("SELECT coalesce($1::pg_catalog.text, 'x')")).toEqual([]);
    expect(viPhamGhim("SELECT pg_catalog.make_interval(secs => $1::pg_catalog.int)")).toEqual([]);
    expect(viPhamGhim("SELECT * FROM pg_catalog.unnest($1::pg_catalog.text[]) AS k(ten)")).toEqual([]);
    // [H14-M4] tên CTE không phải tên bảng — đòi `public.x` ở đây là dạy người ta viết SQL sai.
    expect(viPhamGhim("WITH x AS (SELECT 1) SELECT * FROM x JOIN public.t ON TRUE")).toEqual([]);
  });

  it("[H14-M2/M3] chữ HOA và `CAST(x AS t)` cũng bị soi", () => {
    expect(viPhamGhim("SELECT NOW() FROM public.t").map((v) => v.truc)).toEqual(["tên hàm"]);
    expect(viPhamGhim("SELECT $1::UUID FROM public.t").map((v) => v.truc)).toEqual(["ép kiểu"]);
    expect(viPhamGhim("SELECT CAST($1 AS uuid) FROM public.t").map((v) => v.truc)).toEqual(["ép kiểu"]);
    expect(viPhamGhim("SELECT CAST($1 AS pg_catalog.uuid) FROM public.t")).toEqual([]);
  });

  it("[khoản nợ 62] ĐỘT BIẾN: một câu viết TRẦN HOÀN TOÀN nay ĐỎ — mốc cũ cho nó đi qua", () => {
    // Đây là mũi đo phân biệt luật MỚI với luật CŨ. Dưới `TRAN_TOI_DA`, câu này hợp lệ chừng nào
    // tổng số câu trần không vượt mốc — tức lớp canh im lặng trước đúng thứ nó tồn tại để canh.
    const tran = "SELECT id FROM sessions WHERE user_id = $1::uuid AND expires_at > now()";
    expect(new Set(viPhamGhim(tran).map((v) => v.truc))).toEqual(
      new Set(["tên bảng", "toán tử", "ép kiểu", "tên hàm"] as const),
    );
    // …và chính câu ấy, ghim đủ, thì SẠCH. Không có vế này thì mũi trên chỉ chứng minh bộ dò hay kêu.
    expect(
      viPhamGhim(
        "SELECT id FROM public.sessions WHERE user_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
          "AND expires_at OPERATOR(pg_catalog.>) pg_catalog.now()",
      ),
    ).toEqual([]);
  });

  it("[S1.24] `=>` là ĐỐI SỐ CÓ TÊN, không phải hai toán tử — bộ ghim của vòng đã sai đúng chỗ này", () => {
    // Bộ ghim tự động của vòng S1.24 biến `make_interval(secs => $4)` thành
    // `make_interval(secs OPERATOR(pg_catalog.=) OPERATOR(pg_catalog.>) $4)` — SQL hỏng, và chỉ
    // một lượt đọc lại bản đề xuất mới bắt được. Lớp canh phải nói rõ `=>` là ngữ pháp.
    expect(viPhamGhim("SELECT pg_catalog.make_interval(secs => $1::pg_catalog.int4)")).toEqual([]);
  });
});

describe("[INV-H21] điều kiện tiên quyết của mọi ca cướp: `search_path`", () => {
  it("chỉ `migrate.ts` được chạm `search_path`, và mọi câu được miễn phải KHÔNG nêu `pg_catalog`", () => {
    const cham = CAC_CAU.filter((c) => chamSearchPath(c.sql));
    expect(
      cham.length,
      "phải có ít nhất một câu chạm search_path, không thì phép kiểm rỗng ruột",
    ).toBeGreaterThan(0);

    const viPham = cham
      .filter((c) => DUOC_CHAM_SEARCH_PATH[c.tep] === undefined)
      .map((c) => `${c.tep}:${c.dong}`);
    expect(viPham).toEqual([]);

    // [H14-M1] MỆNH ĐỀ CHỊU LỰC được kiểm, không phải độ dài câu văn: một câu `search_path` được
    // miễn mà NÊU TÊN `pg_catalog` thì nó tạo ra đúng tiền đề của ca cướp.
    for (const c of cham) {
      expect(/\bpg_catalog\b/i.test(c.sql), `${c.tep}:${c.dong} nêu pg_catalog`).toBe(false);
    }
    const coSql = new Set(CAC_CAU.map((c) => c.tep));
    for (const tep of Object.keys(DUOC_CHAM_SEARCH_PATH)) {
      expect(coSql.has(tep), `${tep} không còn là tệp có SQL`).toBe(true);
    }
  });

  it("[H14-3] ĐỐI CHỨNG DƯƠNG: ba cú pháp khác nhau đều bị bắt", () => {
    for (const sql of [
      "SET search_path = doc, pg_catalog",
      "SET LOCAL search_path = doc, pg_catalog",
      "SELECT pg_catalog.set_config('search_path', 'doc, pg_catalog', false)",
    ]) {
      const gia: CauSql = { tep: "packages/rfq/src/rfq.ts", dong: 1, sql };
      expect(
        [gia]
          .filter((c) => chamSearchPath(c.sql))
          .filter((c) => DUOC_CHAM_SEARCH_PATH[c.tep] === undefined),
        sql,
      ).toHaveLength(1);
    }
  });
});
