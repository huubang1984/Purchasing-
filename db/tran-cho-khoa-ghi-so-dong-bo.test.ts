// =============================================================================================
// [S1.71 / khoản 123, lượt soi 65a-8 ⑷] TRẦN CHỜ KHOÁ GHI SỔ: 050 VÀ HARDENING (D1b) MANG CÙNG MỘT GIÁ TRỊ — KIỂM TĨNH
//
// Trần 2 s trên `public.noi_chuoi_kiem_toan()` có hai chỗ viết: migration 050 (`ALTER FUNCTION … SET lock_timeout`) sở hữu nó theo TÊN,
// và hardening mục (D1b) tạo lại hàm với cùng mệnh đề ở mỗi `migrate()` và đòi đúng `proconfig`. Lượt sửa của hardening chạy cả SAU vòng
// migration đánh số, nên gỡ hay đổi trần ở 050 thì hàm vẫn được tạo lại với giá trị của (D1b) — không test nào trên CSDL thật đỏ vì riêng
// việc ấy; đổi ở (D1b) thì `migrate()` đầu tiên gãy ở lượt phán xét (đo bằng đột biến, §S1.71). Kiểm tĩnh này là lớp thấy được hai chỗ
// lệch nhau: tệp .sql mà người đọc lịch sử migration thấy phải nói đúng giá trị
// đang chạy — cùng lý do với §R3 của `db/audit-append-only.int.test.ts`.
//
// [S1.72 / lượt soi ngang 66a-2, lượt soi 67a-7] Trần đọc từ migration đánh số mới nhất đặt nó, bằng `tranTrongMigration`: ~~bỏ chú thích `--`,~~
// ~~gộp khoảng trắng, không phân biệt hoa thường; `=` hay `TO`, giá trị trong nháy hay số trần, `ALTER FUNCTION` hay mệnh đề SET của `CREATE~~
// ~~FUNCTION`. Tệp nhắc hàm cùng `lock_timeout` mà không đọc ra giá trị — RESET, SQL động — thì đỏ~~, thay vì lặng lẽ lấy giá trị của tệp cũ hơn.
// Ranh giới: phép đọc theo văn bản; một tệp mới nhất đặt trần qua một hàm bọc tên khác thì không thấy.
//
// [S1.72 / lượt soi 67c-4] Bản của lượt soi 67a-7 lấy khớp ĐẦU TIÊN của `set lock_timeout` trên cả tệp đã gộp: `SET lock_timeout` của phiên đứng
// trước che câu ALTER thật, `/* */` không được bỏ, RESET của phiên thành "không đọc được", và CREATE OR REPLACE không mệnh đề SET — xoá trần —
// thành "không nhắc". Nay tách câu lệnh theo `;` nằm ngoài chuỗi, dollar-quote và chú thích (`--`, `/* */` lồng nhau), và chỉ đọc câu
// `ALTER FUNCTION|ROUTINE` hay `CREATE [OR REPLACE] FUNCTION` trên hàm nối chuỗi: mệnh đề SET hay RESET sau cùng của câu thắng, câu sau cùng
// của tệp thắng; CREATE không mệnh đề SET, `TO DEFAULT`, `FROM CURRENT` và RESET là không đọc được. Câu khác mang chuỗi hay thân `$…$` nhắc
// cả tên hàm lẫn `lock_timeout` — SQL động — cũng là không đọc được, trừ COMMENT. Tập tệp là đúng tập `migrate()` áp. Ranh giới thêm: phép
// đọc theo từ vựng, không phải bộ phân tích SQL — SQL động ghép tên từ nhiều mảnh, hay tên hàm trong nháy kép viết hoa khác, thì không nhận;
// cách thoát `''` và `E'…'` của chuỗi không có văn bản mẫu riêng.
// =============================================================================================

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function doc(ten: string): string {
  return readFileSync(new URL(`./migrations/${ten}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Tệp migration đánh số, theo thứ tự tên mà `migrate()` áp. ~~[S1.72 / lượt soi 67a-7] `^\d{3,}_`, không `^\d{3}_`.~~ [S1.72 / lượt soi 67c-4] Đúng
 * tập của `migrate()` (`packages/db/src/migrate.ts`): mọi `.sql` không mang hậu tố `.always.sql`, xếp theo tên — tập của lượt soi 67a-7 bỏ sót
 * tệp `.sql` không mang số.
 */
function locTepDanhSo(ten: readonly string[]): string[] {
  return ten.filter((t) => t.endsWith(".sql") && !t.endsWith(".always.sql")).sort();
}

function tepDanhSo(): string[] {
  return locTepDanhSo(readdirSync(new URL("./migrations/", import.meta.url)));
}

/** [S1.72 / lượt soi 67a-7] Tệp nhắc trần trên hàm nối chuỗi mà không đọc ra giá trị. */
const KHONG_DOC_DUOC = "KHONG_DOC_DUOC";

const TEN_HAM = "noi_chuoi_kiem_toan";

/** [S1.72 / lượt soi 67c-4] Một từ vựng SQL: từ (chữ thường; định danh trong nháy kép giữ nguyên), nội dung chuỗi, thân dollar-quote, hay một dấu. */
interface TuSql {
  readonly loai: "tu" | "chuoi" | "than" | "dau";
  readonly giaTri: string;
}

/**
 * [S1.72 / lượt soi 67c-4] Tách văn bản SQL thành các câu lệnh, mỗi câu một dãy từ vựng. `;` chỉ tách câu khi nằm ngoài chuỗi, định danh trong nháy
 * kép, thân dollar-quote và chú thích; chú thích dòng và chú thích khối (lồng nhau) bị bỏ; chuỗi `E'…'` nhận dấu thoát.
 */
function cauLenhSql(vanBan: string): TuSql[][] {
  const TU = /[\p{L}_][\p{L}\p{N}_$]*|[0-9][0-9A-Za-z_.]*/uy;
  const THE = /\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/uy;
  const cau: TuSql[][] = [];
  let hienTai: TuSql[] = [];
  let i = 0;
  while (i < vanBan.length) {
    const c = vanBan.charAt(i);
    if (/\s/u.test(c)) {
      i += 1;
    } else if (vanBan.startsWith("--", i)) {
      const het = vanBan.indexOf("\n", i);
      i = het === -1 ? vanBan.length : het + 1;
    } else if (vanBan.startsWith("/*", i)) {
      let sau = 0;
      do {
        if (vanBan.startsWith("/*", i)) {
          sau += 1;
          i += 2;
        } else if (vanBan.startsWith("*/", i)) {
          sau -= 1;
          i += 2;
        } else {
          i += 1;
        }
      } while (sau > 0 && i < vanBan.length);
    } else if (c === ";") {
      if (hienTai.length > 0) cau.push(hienTai);
      hienTai = [];
      i += 1;
    } else if (c === "'" || ((c === "e" || c === "E") && vanBan.charAt(i + 1) === "'")) {
      const thoat = c !== "'";
      i += thoat ? 2 : 1;
      let giaTri = "";
      while (i < vanBan.length) {
        const d = vanBan.charAt(i);
        if (thoat && d === "\\") {
          giaTri += vanBan.charAt(i + 1);
          i += 2;
        } else if (d === "'" && vanBan.charAt(i + 1) === "'") {
          giaTri += "'";
          i += 2;
        } else if (d === "'") {
          i += 1;
          break;
        } else {
          giaTri += d;
          i += 1;
        }
      }
      hienTai.push({ loai: "chuoi", giaTri });
    } else if (c === '"') {
      const het = vanBan.indexOf('"', i + 1);
      hienTai.push({ loai: "tu", giaTri: vanBan.slice(i + 1, het === -1 ? vanBan.length : het) });
      i = het === -1 ? vanBan.length : het + 1;
    } else {
      THE.lastIndex = i;
      const the = c === "$" ? THE.exec(vanBan) : null;
      TU.lastIndex = i;
      const tu = the === null ? TU.exec(vanBan) : null;
      if (the !== null) {
        const dong = vanBan.indexOf(the[0], i + the[0].length);
        hienTai.push({ loai: "than", giaTri: vanBan.slice(i + the[0].length, dong === -1 ? vanBan.length : dong) });
        i = dong === -1 ? vanBan.length : dong + the[0].length;
      } else if (tu !== null) {
        hienTai.push({ loai: "tu", giaTri: tu[0].toLowerCase() });
        i += tu[0].length;
      } else {
        hienTai.push({ loai: "dau", giaTri: c });
        i += 1;
      }
    }
  }
  if (hienTai.length > 0) cau.push(hienTai);
  return cau;
}

/** [S1.72 / lượt soi 67c-4] Chỉ số ngay sau tên hàm nối chuỗi — `noi_chuoi_kiem_toan` hay `public.noi_chuoi_kiem_toan` — bắt đầu từ `i`, hay -1. */
function sauTenHam(t: readonly TuSql[], i: number): number {
  const la = (k: number, gt: string): boolean => t[k]?.loai === "tu" && t[k]?.giaTri === gt;
  if (la(i, "public") && t[i + 1]?.loai === "dau" && t[i + 1]?.giaTri === "." && la(i + 2, TEN_HAM)) return i + 3;
  return la(i, TEN_HAM) ? i + 1 : -1;
}

/**
 * [S1.72 / lượt soi 67c-4] Trần mà MỘT câu lệnh đặt trên hàm nối chuỗi: giá trị; `KHONG_DOC_DUOC` nếu câu xoá hay thay trần mà không đọc ra giá
 * trị — `CREATE [OR REPLACE] FUNCTION` không mệnh đề SET, `TO DEFAULT`, `FROM CURRENT`, RESET, hay SQL động; `null` nếu câu không chạm trần. Chỉ
 * câu `ALTER FUNCTION|ROUTINE` và `CREATE [OR REPLACE] FUNCTION` trên hàm ấy được đọc; thân hàm là một từ vựng nên SET bên trong không tính.
 */
function tranTrongCau(t: readonly TuSql[]): string | null {
  const tu = (k: number): string | undefined => (t[k]?.loai === "tu" ? t[k]?.giaTri : undefined);
  let batDau = -1;
  let laCreate = false;
  if (tu(0) === "alter" && (tu(1) === "function" || tu(1) === "routine")) batDau = sauTenHam(t, 2);
  if (tu(0) === "create") {
    const k = tu(1) === "or" && tu(2) === "replace" ? 3 : 1;
    if (tu(k) === "function") {
      batDau = sauTenHam(t, k + 1);
      laCreate = true;
    }
  }
  if (batDau === -1) {
    // SQL động: chuỗi hay thân `$…$` của câu nhắc cả tên hàm lẫn `lock_timeout` — trừ COMMENT, thứ không bao giờ chạy.
    const chu = t
      .filter((x) => x.loai === "chuoi" || x.loai === "than")
      .map((x) => x.giaTri.toLowerCase())
      .join("\n");
    return tu(0) !== "comment" && chu.includes(TEN_HAM) && chu.includes("lock_timeout") ? KHONG_DOC_DUOC : null;
  }
  let ket: string | null = laCreate ? KHONG_DOC_DUOC : null;
  for (let k = batDau; k < t.length; k += 1) {
    if (tu(k) === "reset" && (tu(k + 1) === "lock_timeout" || tu(k + 1) === "all")) ket = KHONG_DOC_DUOC;
    if (tu(k) !== "set" || tu(k + 1) !== "lock_timeout") continue;
    const noi = t[k + 2];
    const gt = t[k + 3];
    const coNoi = (noi?.loai === "dau" && noi.giaTri === "=") || (noi?.loai === "tu" && noi.giaTri === "to");
    ket = coNoi && gt !== undefined && (gt.loai === "chuoi" || (gt.loai === "tu" && gt.giaTri !== "default")) ? gt.giaTri : KHONG_DOC_DUOC;
  }
  return ket;
}

/**
 * [S1.72 / lượt soi ngang 66a-2, lượt soi 67a-7] Trần một tệp migration đặt trên `public.noi_chuoi_kiem_toan()`: giá trị; `null` nếu ~~tệp không~~
 * ~~nhắc hàm ấy cùng `lock_timeout`~~ [lượt soi 67c-4: không câu nào của tệp chạm trần của hàm]; `KHONG_DOC_DUOC` nếu ~~nhắc mà~~ [câu sau cùng chạm
 * trần mà] không đọc ra giá trị. Bản đầu của S1.72 chỉ khớp đúng `ALTER FUNCTION … SET lock_timeout = '…';`. [lượt soi 67c-4] Theo từng câu lệnh —
 * `tranTrongCau` —, câu sau cùng chạm trần thắng.
 */
function tranTrongMigration(vanBan: string): string | null {
  let ket: string | null = null;
  for (const cau of cauLenhSql(vanBan)) {
    const tran = tranTrongCau(cau);
    if (tran !== null) ket = tran;
  }
  return ket;
}

describe("[S1.71 / khoản 123] trần chờ khoá ghi sổ: 050 và hardening (D1b) cùng một giá trị", () => {
  it("050 chỉ chứa đúng câu đặt trần 2 s trên hàm nối chuỗi", () => {
    const cau = doc("050_tran_cho_khoa_ghi_so.sql")
      .replace(/--[^\n]*/g, "")
      .trim();
    expect(cau).toBe("ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '2s';");
  });

  it("hardening (D1b) tạo lại hàm với ĐÚNG trần mà migration đánh số mới nhất đặt, và đòi đúng proconfig ấy", () => {
    // [S1.72 / lượt soi ngang 66a-2] Bản S1.71 ghim hai literal viết tay ở hai `it`: đổi (D1b) thành '3s' cùng literal của test này thì hai
    // `it` vẫn xanh trong khi 050 nói 2 s — đúng chỗ lệch mà tên describe hứa bắt. Nay trần đọc từ migration đánh số mới nhất đặt nó.
    // [S1.72 / lượt soi 67a-7] Tệp mới nhất nhắc trần phải đọc ra được giá trị — không lặng lẽ lùi về giá trị của tệp cũ hơn.
    const cacTran = tepDanhSo()
      .map((ten) => [ten, tranTrongMigration(doc(ten))] as const)
      .filter((x): x is readonly [string, string] => x[1] !== null);
    const cuoi = cacTran.at(-1);
    expect(cuoi, "không migration đánh số nào đặt trần trên hàm nối chuỗi").toBeDefined();
    expect(cuoi?.[1], `${String(cuoi?.[0])} nhắc trần trên hàm nối chuỗi mà không đọc ra giá trị`).not.toBe(KHONG_DOC_DUOC);
    const tran = String(cuoi?.[1]);
    const ht = doc("hardening.always.sql");
    expect(ht).toContain(`LANGUAGE plpgsql SET search_path = pg_catalog SET lock_timeout = '${tran}' AS $tnc$$q$ || THAN_NOI_CHUOI || $q$$tnc$;`);
    expect(ht).toContain(`AND p.proconfig = ARRAY['search_path=pg_catalog', 'lock_timeout=${tran}']`);
  });

  it("[S1.72 / lượt soi 67a-7] phép đọc trần của một tệp migration: `=` hay `TO`, chữ thường, số trần, mệnh đề SET của CREATE FUNCTION đều đọc được; RESET hay SQL động thì báo không đọc được — không lặng lẽ lấy giá trị của tệp cũ hơn", () => {
    expect(tranTrongMigration("ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '2s';")).toBe("2s");
    expect(tranTrongMigration("alter function public.noi_chuoi_kiem_toan()\n  set lock_timeout to '3s';")).toBe("3s");
    expect(
      tranTrongMigration(
        "CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() RETURNS trigger LANGUAGE plpgsql\n" +
          "  SET search_path = pg_catalog SET lock_timeout = 3000 AS $f$ BEGIN RETURN NEW; END $f$;",
      ),
    ).toBe("3000");
    expect(tranTrongMigration("ALTER FUNCTION public.noi_chuoi_kiem_toan() RESET lock_timeout;")).toBe(KHONG_DOC_DUOC);
    expect(tranTrongMigration("ALTER FUNCTION public.noi_chuoi_kiem_toan() RESET ALL;")).toBe(KHONG_DOC_DUOC);
    expect(tranTrongMigration("DO $$ BEGIN EXECUTE 'ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = ''3s'''; END $$;")).toBe(
      KHONG_DOC_DUOC,
    );
    expect(tranTrongMigration("-- noi_chuoi_kiem_toan() SET lock_timeout = '9s'\nCREATE TABLE t (id int);")).toBeNull();
    expect(tranTrongMigration("CREATE TABLE t (id int);")).toBeNull();
  });

  it("[S1.72 / lượt soi 67c-4] phép đọc trần theo câu lệnh: SET và RESET của phiên, chú thích khối và SET trong thân hàm không tính; câu sau cùng của tệp thắng; CREATE OR REPLACE không mệnh đề SET xoá trần — báo không đọc được", () => {
    // Bản của lượt soi 67a-7 đọc khớp ĐẦU TIÊN của `set lock_timeout` trên cả tệp đã gộp, không bỏ `/* */`, và coi mọi RESET là không đọc được.
    expect(tranTrongMigration("SET lock_timeout = '2s';\nALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '3s';")).toBe("3s");
    expect(
      tranTrongMigration(
        "ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '3s';\nALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '2s';",
      ),
    ).toBe("2s");
    expect(
      tranTrongMigration(
        "/* ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '9s'; */\nALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '2s';",
      ),
    ).toBe("2s");
    expect(
      tranTrongMigration(
        "CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() RETURNS trigger LANGUAGE plpgsql\n" +
          "  AS $f$ BEGIN SET LOCAL lock_timeout = '9s'; RETURN NEW; END $f$ SET lock_timeout = '2s';",
      ),
    ).toBe("2s");
    // CREATE OR REPLACE gán lại mọi thuộc tính của hàm trừ chủ và quyền (đọc, tài liệu PostgreSQL): không mệnh đề SET là mất trần.
    expect(
      tranTrongMigration(
        "CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $tnc$ BEGIN RETURN NEW; END $tnc$;",
      ),
    ).toBe(KHONG_DOC_DUOC);
    expect(tranTrongMigration("SET LOCAL lock_timeout = '5s';\nRESET lock_timeout;\nGRANT EXECUTE ON FUNCTION public.noi_chuoi_kiem_toan() TO app_api;")).toBeNull();
    expect(tranTrongMigration("ALTER ROUTINE public.noi_chuoi_kiem_toan() SET lock_timeout = '3s';")).toBe("3s");
    expect(tranTrongMigration("ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout TO DEFAULT;")).toBe(KHONG_DOC_DUOC);
    expect(tranTrongMigration("ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout FROM CURRENT;")).toBe(KHONG_DOC_DUOC);
    expect(tranTrongMigration("ALTER FUNCTION public.noi_chuoi_kiem_toan() OWNER TO migrator;")).toBeNull();
    expect(tranTrongMigration("COMMENT ON FUNCTION public.noi_chuoi_kiem_toan() IS 'noi_chuoi_kiem_toan chờ khoá tối đa lock_timeout';")).toBeNull();
  });

  it("[S1.72 / lượt soi 67c-4] tập tệp đánh số là tập `migrate()` áp — mọi `.sql` không mang hậu tố `.always.sql`, xếp theo tên", () => {
    expect(locTepDanhSo(["051_b.sql", "hardening.always.sql", "050_a.sql", "zz_khong_so.sql", "ghi-chu.md", "1000_c.sql"])).toEqual([
      "050_a.sql",
      "051_b.sql",
      "1000_c.sql",
      "zz_khong_so.sql",
    ]);
  });

  it("không tệp migration đánh số nào còn chỗ trống ⟦…⟧ của bản nháp", () => {
    // [lượt soi 65c-2] `migrate()` ghi checksum của tệp đánh số khi áp: chỗ trống sót lại thì sửa sau là lệch checksum. Test đầu bỏ chú
    // thích trước khi so, nên không thấy chỗ trống nằm trong chú thích.
    const tep = tepDanhSo();
    expect(tep.length).toBeGreaterThanOrEqual(50);
    expect(tep.filter((ten) => doc(ten).includes("⟦"))).toEqual([]);
  });
});
