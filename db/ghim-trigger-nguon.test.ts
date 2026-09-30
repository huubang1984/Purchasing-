// ===============================================================================================
// [S1.9172 / khoản 214] CHỖ GHIM ⑵ CỦA HARDENING PHẢI VIẾT BẰNG CHÍNH TẢ NGUỒN — SO TĨNH VỚI CÂU
// `CREATE TRIGGER` CỦA MIGRATION CUỐI ĐỊNH NGHĨA NÓ
//
// Mỗi trigger hardening tự chữa có ba chỗ ghim (khoản 211, `tests/architecture/hardening-co-ly-do.test.ts`):
// ⑴ `pg_get_triggerdef` trong ĐIỀU KIỆN sửa, ⑵ câu `CREATE TRIGGER` sẽ CHẠY trong CÂU SỬA, ⑶
// `pg_get_triggerdef` trong VỊ TỪ phán xét. ⑴/⑶ là đầu ra canonical của PostgreSQL và PHẢI viết như
// thế, vì hardening so chúng nguyên văn với `pg_get_triggerdef` trong cụm. ⑵ thì KHÔNG được so với gì
// cả — nó là mã chạy — và S1.100 đo được rằng nhiều ⑵ được viết TỪ đầu ra canonical (`new.a`, `=`,
// `'OPEN'::text`, `= ANY (ARRAY[…])`, `BEFORE DELETE OR UPDATE`) chứ không từ nguồn migration (`NEW.a`,
// `OPERATOR(pg_catalog.=)`, `'OPEN'`, `IN (…)`, `BEFORE UPDATE OR DELETE`). Hai chính tả ấy cài ra CÙNG
// một trigger — cổng ĐỘNG `db/ghim-trigger-tu-chua.int.test.ts` đo bằng chính PostgreSQL — nhưng không
// ai, người hay cổng, đối chiếu được ⑵ với migration bằng mắt hay bằng văn bản; và một bộ chuẩn hoá SQL
// viết tay để so hai chính tả là thứ S1.72 đã trả giá một lần.
//
// VÌ SAO CỔNG NÀY ĐỨNG ĐƯỢC SAU S1.9172, và chỉ sau đó: đo trên `561158e` — chủ thể 146 tên (148 kể cả
// hai `CREATE CONSTRAINT TRIGGER`, nằm ngoài chủ thể); 15 chỗ ⑵ lệch chính tả nguồn (4 `BEFORE DELETE OR
// UPDATE`, 1 `BEFORE INSERT OR DELETE OR UPDATE`, 10 mệnh đề `WHEN` canonical); 109 chỉ khác dấu `public.`
// trước tên bảng; 22 trùng từng chữ. 15 chỗ ấy được viết lại bằng chính tả nguồn (sau: 0 lệch, 124 chỉ khác
// `public.`, 22 trùng) — cổng động `db/ghim-trigger-tu-chua.int.test.ts` 4/4 vẫn xanh, tức PostgreSQL cài ra
// đúng ⑴/⑶ — nên phép chuẩn hoá ở đây chỉ còn HAI luật cơ khí, mỗi luật có một lý do đo được:
//   · KHOẢNG TRẮNG (gộp; cắt quanh `(` `)` `,`): migration viết nhiều dòng, câu sửa viết một dòng;
//   · LƯỢC ĐỒ `public.` trước tên BẢNG sau `ON` và tên HÀM sau `EXECUTE FUNCTION`: hardening qualify
//     `public.` (lớp thứ ba cho che tên, H21), migration viết trần dưới `search_path` mà `migrate()` ghim.
// Cố ý KHÔNG chuẩn hoá: hoa/thường từ khoá, `=` ↔ `OPERATOR(pg_catalog.=)`, `'x'` ↔ `'x'::text`, `IN (…)`
// ↔ `= ANY (ARRAY[…])`, thứ tự sự kiện — đó chính là những lệch mà cổng phải ĐỎ, và cách sửa là viết
// lại ⑵ theo nguồn, không phải nới cổng.
//
// CHỖ CỔNG NÀY KHÔNG TỚI, nói ra: nó so VĂN BẢN, không so ngữ nghĩa. Một ⑵ cài ra đúng trigger nhưng
// khác chữ với nguồn thì ĐỎ (cố ý — đó là khoản 214); một ⑵ đúng chữ với nguồn mà ⑴/⑶ đã ghim bản khác
// thì cổng này XANH và cổng động đỏ — hai cổng bổ sung nhau, không thay nhau. Chủ thể là tên có văn bản
// ghim `$def$CREATE TRIGGER`, cùng chủ thể với cổng ba chỗ ghim; hai `CREATE CONSTRAINT TRIGGER` và hai
// trigger ghim bằng THUỘC TÍNH (câu sửa của chúng dùng `CREATE OR REPLACE`) nằm ngoài, như ở đó.
// ===============================================================================================

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const THU_MUC = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Sàn chống MÙ, đóng đinh SÁT số đo (146 trên `561158e`): một con số tụt xuống nghĩa là bộ đọc hỏng, không
 * phải hardening bớt trigger.
 */
const SAN_SO_CHU_THE = 140;

/** Hai thẻ dollar-quote bọc VĂN BẢN ĐÃ GHIM (⑴/⑶ và thân hàm), không bọc mã sẽ chạy — cùng danh sách với cổng ba chỗ ghim. */
const THE_GHIM = ["$def$", "$than$"] as const;

/** Bỏ chú thích `--…` và `/* … *​/` đứng NGOÀI chuỗi `'…'` và ngoài dollar-quote; thân dollar-quote giữ nguyên. */
export function boChuThichSql(sql: string): string {
  let ra = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        j += 1;
      }
      ra += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const the = /^\$[A-Za-z_0-9]*\$/u.exec(sql.slice(i));
    if (the) {
      const cuoi = sql.indexOf(the[0], i + the[0].length);
      if (cuoi < 0) throw new Error(`dollar-quote ${the[0]} không đóng`);
      ra += sql.slice(i, cuoi + the[0].length);
      i = cuoi + the[0].length;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i);
      i = j < 0 ? sql.length : j + 2;
      continue;
    }
    ra += c;
    i += 1;
  }
  return ra;
}

/**
 * Mọi câu `CREATE [OR REPLACE] [CONSTRAINT] TRIGGER <tên> … ;` của một văn bản, theo tên; tên định nghĩa
 * nhiều lần thì bản SAU thắng (đúng cách PostgreSQL chạy một tệp từ trên xuống). Dấu `;` kết câu là dấu
 * đứng ngoài chuỗi `'…'`.
 */
export function docCauTrigger(sql: string): ReadonlyMap<string, string> {
  const ra = new Map<string, string>();
  for (const m of sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([A-Za-z_][A-Za-z_0-9]*)\b/gu)) {
    let i = m.index + m[0].length;
    let trongChuoi = false;
    while (i < sql.length) {
      if (sql[i] === "'") trongChuoi = !trongChuoi;
      else if (sql[i] === ";" && !trongChuoi) break;
      i += 1;
    }
    ra.set(m[1]!, sql.slice(m.index, i));
  }
  return ra;
}

/**
 * Chuẩn hoá HAI luật, không hơn: khoảng trắng, và lược đồ `public.` trước tên bảng sau `ON` / tên hàm sau
 * `EXECUTE FUNCTION`. Mọi khác biệt còn lại là một lệch chính tả mà cổng phải nêu.
 */
export function chuanHoaCauTrigger(cau: string): string {
  return cau
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/;$/u, "")
    .replace(/\s*([(),])\s*/gu, "$1")
    .replace(/\bON public\.([A-Za-z_][A-Za-z_0-9]*)/u, "ON $1")
    .replace(/\bEXECUTE FUNCTION public\.([A-Za-z_][A-Za-z_0-9]*)\(/u, "EXECUTE FUNCTION $1(");
}

/** Tên của mọi trigger có văn bản ghim `$def$CREATE TRIGGER …$def$` — chủ thể của cổng, cùng chủ thể với cổng ba chỗ ghim. */
export function tenGhimDef(hardening: string): readonly string[] {
  const ten = new Set<string>();
  for (const m of hardening.matchAll(/\$def\$CREATE TRIGGER ([A-Za-z_][A-Za-z_0-9]*)\b/gu)) ten.add(m[1]!);
  return [...ten].sort((a, b) => a.localeCompare(b));
}

/**
 * ⑵ — câu `CREATE TRIGGER` của mọi CÂU SỬA, theo tên, đọc trên bề mặt mã CHẠY của hardening: bỏ mọi vùng
 * `$def$…$def$` / `$than$…$than$` (văn bản ghim, không phải mã) rồi bỏ chú thích `--` tới hết dòng — thân
 * các ô `$q$…$q$` là PL/pgSQL sẽ được EXECUTE, nên chú thích trong đó cũng là chú thích. Số lần xuất hiện
 * LẺ của một thẻ ghim ⇒ NÉM: dollar-quote hở, bộ đọc đang mù. Một tên có HAI câu sửa ⇒ NÉM: hình dạng lạ.
 */
export function cauSuaCua(hardening: string): ReadonlyMap<string, string> {
  let sach = hardening;
  for (const the of THE_GHIM) {
    const phan = sach.split(the);
    if (phan.length % 2 === 0) throw new Error(`số lần xuất hiện của \`${the}\` là LẺ (${phan.length - 1}) — dollar-quote hở, bộ đọc đang MÙ`);
    sach = phan.filter((_, i) => i % 2 === 0).join("\n");
  }
  sach = sach.replaceAll(/--[^\n]*/gu, "");
  const ra = new Map<string, string>();
  for (const m of sach.matchAll(/\bCREATE TRIGGER ([A-Za-z_][A-Za-z_0-9]*)\b/gu)) {
    const ten = m[1]!;
    let i = m.index + m[0].length;
    let trongChuoi = false;
    while (i < sach.length) {
      if (sach[i] === "'") trongChuoi = !trongChuoi;
      else if (sach[i] === ";" && !trongChuoi) break;
      i += 1;
    }
    if (ra.has(ten)) throw new Error(`\`${ten}\`: có HAI câu sửa \`CREATE TRIGGER\` trong hardening — hình dạng lạ, bộ đọc không phân xử`);
    ra.set(ten, sach.slice(m.index, i));
  }
  return ra;
}

export interface KetQuaGhimNguon {
  /** Mỗi dòng một chỗ ghim ⑵ lệch nguồn, gọi tên trigger, kèm hai văn bản đã chuẩn hoá. */
  readonly viPham: readonly string[];
  /** Số tên trong chủ thể (có `$def$`). */
  readonly soChuThe: number;
  /** Trong đó: số ⑵ trùng nguồn TỪNG CHỮ (chỉ khác khoảng trắng), không cần luật `public.`. */
  readonly soTrungTungChu: number;
}

/**
 * So ⑵ của mọi tên trong chủ thể với câu `CREATE TRIGGER` cùng tên của migration CUỐI (theo thứ tự tên tệp,
 * đúng thứ tự `migrate()` áp) sau chuẩn hoá. `migrations` là tên tệp → nội dung; chỉ tệp đánh số, không `.always.sql`.
 */
export function viPhamGhimNguon(hardening: string, migrations: ReadonlyMap<string, string>): KetQuaGhimNguon {
  const chuThe = tenGhimDef(hardening);
  const cauSua = cauSuaCua(hardening);
  const nguon = new Map<string, { readonly tep: string; readonly cau: string }>();
  for (const tep of [...migrations.keys()].sort((a, b) => a.localeCompare(b))) {
    for (const [ten, cau] of docCauTrigger(boChuThichSql(migrations.get(tep)!))) nguon.set(ten, { tep, cau });
  }
  const viPham: string[] = [];
  let soTrungTungChu = 0;
  for (const ten of chuThe) {
    const sua = cauSua.get(ten);
    if (sua === undefined) {
      viPham.push(`\`${ten}\`: có văn bản ghim \`$def$\` mà không câu sửa \`CREATE TRIGGER\` nào cài nó — chỗ ghim ⑵ thiếu`);
      continue;
    }
    const n = nguon.get(ten);
    if (n === undefined) {
      viPham.push(`\`${ten}\`: không migration đánh số nào có \`CREATE TRIGGER ${ten}\` — chỗ ghim ⑵ không có nguồn để đối chiếu`);
      continue;
    }
    const a = chuanHoaCauTrigger(sua);
    const b = chuanHoaCauTrigger(n.cau);
    if (a !== b) {
      viPham.push(`\`${ten}\`: chỗ ghim ⑵ lệch chính tả nguồn (${n.tep})\n    ⑵    : ${a}\n    nguồn: ${b}`);
      continue;
    }
    if (sua.replace(/\s+/gu, " ").trim() === n.cau.replace(/\s+/gu, " ").trim()) soTrungTungChu += 1;
  }
  return { viPham, soChuThe: chuThe.length, soTrungTungChu };
}

function docThatCuaKho(): { readonly hardening: string; readonly migrations: ReadonlyMap<string, string> } {
  const doc = (tep: string): string => readFileSync(join(THU_MUC, tep), "utf8").replace(/\r\n/gu, "\n");
  const migrations = new Map<string, string>();
  for (const tep of readdirSync(THU_MUC)) {
    if (/^\d{3,4}_.*\.sql$/u.test(tep) && !tep.endsWith(".always.sql")) migrations.set(tep, doc(tep));
  }
  return { hardening: doc("hardening.always.sql"), migrations };
}

// ---- Văn bản mẫu cho các ca âm/dương: một mục hardening đủ ba chỗ ghim, cùng khuôn với tệp thật. ----

/** Một mục ghim đủ ⑴ ⑵ ⑶ cho trigger `zz_canh` với câu sửa ⑵ tuỳ ý. */
function mauHardening(cauSua: string, def = "CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW WHEN ((new.a IS NOT NULL)) EXECUTE FUNCTION f()"): string {
  return (
    "  bang := ARRAY[\n" +
    "    ARRAY[$q$mục thử$q$, $q$true$q$,\n" +
    "      $q$DO $fn$ BEGIN\n" +
    "           IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'zz_canh'\n" +
    `                             AND pg_get_triggerdef(t.oid) = $def$${def}$def$) THEN\n` +
    "             DROP TRIGGER IF EXISTS zz_canh ON public.zz; -- dựng lại\n" +
    `             ${cauSua};\n` +
    "             ALTER TABLE public.zz ENABLE ALWAYS TRIGGER zz_canh;\n" +
    "           END IF; END $fn$$q$,\n" +
    `      $q$EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'zz_canh' AND pg_get_triggerdef(t.oid) = $def$${def}$def$)$q$,\n` +
    "      $q$không gì$q$, $q$mô tả$q$]\n" +
    "  ];\n"
  );
}

const NGUON_ZZ = "CREATE TRIGGER zz_canh\n  BEFORE UPDATE ON zz\n  FOR EACH ROW\n  WHEN (NEW.a IS NOT NULL)\n  EXECUTE FUNCTION public.f();\n";
const MIGRATION_ZZ: ReadonlyMap<string, string> = new Map([["010_zz.sql", "-- CREATE TRIGGER zz_canh trong chú thích không tính\n" + NGUON_ZZ]]);

describe("[S1.9172 / khoản 214] chỗ ghim ⑵ viết bằng chính tả nguồn — so tĩnh với migration cuối", () => {
  it("mọi chỗ ghim ⑵ của hardening khớp câu CREATE TRIGGER của migration cuối định nghĩa nó, sau chuẩn hoá khoảng trắng và lược đồ public", () => {
    const { hardening, migrations } = docThatCuaKho();
    const kq = viPhamGhimNguon(hardening, migrations);
    expect(kq.viPham).toEqual([]);
  });

  it("số đo của chủ thể: tập trigger có `$def$` không tụt dưới sàn, và mọi tên đều có ⑵ lẫn nguồn", () => {
    const { hardening, migrations } = docThatCuaKho();
    const kq = viPhamGhimNguon(hardening, migrations);
    expect(kq.soChuThe, "số trigger có văn bản ghim `$def$CREATE TRIGGER`").toBeGreaterThanOrEqual(SAN_SO_CHU_THE);
    // Chống mù của chính bộ đọc ⑵: chủ thể phải là tập con của tập câu sửa đọc được.
    const cauSua = cauSuaCua(hardening);
    expect(tenGhimDef(hardening).filter((t) => !cauSua.has(t))).toEqual([]);
  });

  it("MẪU DƯƠNG: ⑵ chỉ khác nguồn ở khoảng trắng và dấu `public.` thì KHÔNG vi phạm; trùng từng chữ được đếm riêng", () => {
    const kq = viPhamGhimNguon(
      mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW WHEN (NEW.a IS NOT NULL) EXECUTE FUNCTION public.f()"),
      MIGRATION_ZZ,
    );
    expect(kq).toEqual({ viPham: [], soChuThe: 1, soTrungTungChu: 0 });
    const trung = viPhamGhimNguon(mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON zz FOR EACH ROW WHEN (NEW.a IS NOT NULL) EXECUTE FUNCTION public.f()"), MIGRATION_ZZ);
    expect(trung).toEqual({ viPham: [], soChuThe: 1, soTrungTungChu: 1 });
  });

  it("MẪU ÂM: ⑵ viết bằng đầu ra canonical (`new.a`, `'x'::text`, `= ANY (ARRAY[…])`, `BEFORE DELETE OR UPDATE`) thì ĐỎ và gọi tên trigger", () => {
    const canonical = [
      "CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW WHEN ((new.a IS NOT NULL)) EXECUTE FUNCTION public.f()",
      "CREATE TRIGGER zz_canh BEFORE DELETE OR UPDATE ON public.zz FOR EACH ROW WHEN (NEW.a IS NOT NULL) EXECUTE FUNCTION public.f()",
    ];
    for (const cau of canonical) {
      const kq = viPhamGhimNguon(mauHardening(cau), MIGRATION_ZZ);
      expect(kq.viPham, cau).toHaveLength(1);
      expect(kq.viPham[0]).toContain("`zz_canh`: chỗ ghim ⑵ lệch chính tả nguồn (010_zz.sql)");
    }
    // `=` ↔ `OPERATOR(pg_catalog.=)`, `'x'` ↔ `'x'::text`, `IN` ↔ `= ANY (ARRAY[…])`: cố ý KHÔNG chuẩn hoá — ĐỎ.
    const nguonBang = new Map([
      ["011_zz.sql", "CREATE TRIGGER zz_canh BEFORE UPDATE ON zz FOR EACH ROW WHEN (NEW.s OPERATOR(pg_catalog.=) 'OPEN' AND NEW.k IN ('A', 'B')) EXECUTE FUNCTION public.f();"],
    ]);
    const kq = viPhamGhimNguon(
      mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW WHEN (((new.s = 'OPEN'::text) AND (new.k = ANY (ARRAY['A'::text, 'B'::text])))) EXECUTE FUNCTION public.f()"),
      nguonBang,
    );
    expect(kq.viPham).toHaveLength(1);
    expect(kq.viPham[0]).toContain("OPERATOR(pg_catalog.=)");
  });

  it("MẪU ÂM: nguồn là migration CUỐI — ⑵ khớp bản cũ mà migration mới định nghĩa lại thì ĐỎ; khớp bản mới thì xanh", () => {
    const hai = new Map([
      ["010_zz.sql", NGUON_ZZ],
      ["055_zz_moi.sql", "DROP TRIGGER zz_canh ON zz;\nCREATE TRIGGER zz_canh BEFORE INSERT OR UPDATE ON zz FOR EACH ROW EXECUTE FUNCTION public.f();\n"],
    ]);
    const cu = viPhamGhimNguon(mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW WHEN (NEW.a IS NOT NULL) EXECUTE FUNCTION public.f()"), hai);
    expect(cu.viPham).toHaveLength(1);
    expect(cu.viPham[0]).toContain("(055_zz_moi.sql)");
    const moi = viPhamGhimNguon(mauHardening("CREATE TRIGGER zz_canh BEFORE INSERT OR UPDATE ON public.zz FOR EACH ROW EXECUTE FUNCTION public.f()"), hai);
    expect(moi.viPham).toEqual([]);
  });

  it("MẪU ÂM: không nguồn, hay có `$def$` mà không câu sửa nào cài — ĐỎ; văn bản trong `$def$` KHÔNG được đọc như một câu sửa", () => {
    expect(viPhamGhimNguon(mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW WHEN (NEW.a IS NOT NULL) EXECUTE FUNCTION public.f()"), new Map()).viPham[0]).toContain(
      "không có nguồn",
    );
    // Đúng cái bẫy: `$def$` mang chuỗi `CREATE TRIGGER zz_canh`. Câu sửa thật bị đổi tên ⇒ ⑵ của `zz_canh` thiếu, phải ĐỎ chứ không
    // được lấy văn bản ghim làm câu sửa rồi xanh giả.
    const thieu = viPhamGhimNguon(mauHardening("CREATE TRIGGER zz_khac BEFORE UPDATE ON public.zz FOR EACH ROW EXECUTE FUNCTION public.f()"), MIGRATION_ZZ);
    expect(thieu.viPham).toHaveLength(1);
    expect(thieu.viPham[0]).toContain("chỗ ghim ⑵ thiếu");
  });

  it("bộ đọc NÉM ồn ào thay vì xanh mù: thẻ ghim hở, hay một tên có hai câu sửa", () => {
    expect(() => cauSuaCua(mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW EXECUTE FUNCTION public.f()") + "$def$")).toThrow(/LẺ/u);
    const hai = mauHardening("CREATE TRIGGER zz_canh BEFORE UPDATE ON public.zz FOR EACH ROW EXECUTE FUNCTION public.f()") + "\n$q$CREATE TRIGGER zz_canh AFTER INSERT ON public.zz FOR EACH ROW EXECUTE FUNCTION public.f();$q$\n";
    expect(() => cauSuaCua(hai)).toThrow(/HAI câu sửa/u);
    expect(() => boChuThichSql("SELECT $x$ hở")).toThrow(/không đóng/u);
  });

  it("chuẩn hoá đúng hai luật: khoảng trắng và `public.`; chú thích trong nguồn không tính, dấu `;` trong chuỗi không kết câu", () => {
    expect(chuanHoaCauTrigger("CREATE TRIGGER t\n  BEFORE UPDATE ON public.x\n  FOR EACH ROW EXECUTE FUNCTION public.f( 'a', 'b' );")).toBe(
      "CREATE TRIGGER t BEFORE UPDATE ON x FOR EACH ROW EXECUTE FUNCTION f('a','b')",
    );
    // Tên `public.` trong mệnh đề WHEN không bị đụng: luật chỉ áp cho bảng sau ON và hàm sau EXECUTE FUNCTION.
    expect(chuanHoaCauTrigger("CREATE TRIGGER t BEFORE UPDATE ON x FOR EACH ROW WHEN (public.g(NEW.a)) EXECUTE FUNCTION f()")).toContain("WHEN(public.g(NEW.a))");
    const cau = docCauTrigger(boChuThichSql("-- CREATE TRIGGER a BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f();\nCREATE TRIGGER b BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f('a;b'); SELECT 1;"));
    expect([...cau.keys()]).toEqual(["b"]);
    expect(cau.get("b")).toBe("CREATE TRIGGER b BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f('a;b')");
  });
});
