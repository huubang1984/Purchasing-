// ==============================================================================================
// [INV-H21] MỌI DANH SÁCH MIỄN TRỪ CỦA QT3 ĐƯỢC **ĐO**, KHÔNG ĐƯỢC TIN
//
// `qt3-ghim-schema.test.ts` bỏ qua ba nhúm tên khi đi tìm chỗ chưa ghim schema. Một danh sách
// miễn trừ viết tay với một lý do viết tay là đúng hình dạng mà ADR-027 và ADR-028 cấm — nên tệp
// này hỏi PostgreSQL THẬT thay vì tin lời chú thích.
//
// ⑴ `NGU_PHAP_KHONG_GHIM` — cấu trúc ngữ pháp. Phép đo: **không** có hàm nào cùng tên trong
//    `pg_catalog`, tức `pg_catalog.<tên>(…)` không phân giải được, tức cách viết hợp lệ DUY NHẤT
//    là viết trần. Phép đo này đã bác **năm** dòng của bản đầu (`extract`, `substring`, `overlay`,
//    `position`, `normalize` — cả năm CÓ hàm thật, tức cả năm PHẢI bị ghim).
//
// ⑵ `TU_KHOA_TRUOC_NGOAC` — từ khoá đứng trước `(` mà không phải lời gọi hàm. Review lượt 14
//    (H14-4) chỉ ra danh sách này **không được đo bằng gì cả** ở bản đầu, và trong nó có
//    `unnest`, `generate_series`, `left`, `right` — bốn HÀM THẬT của `pg_catalog`. Mã sản xuất thì
//    GHIM `unnest` (`packages/db/src/vai-tro.ts` viết `pg_catalog.unnest(…)`) vì nó cướp được,
//    trong khi lớp canh lại MIỄN nó. Nay nó chịu CẢ HAI phép đo: phải là từ khoá thật, và phải
//    không có hàm cùng tên.
//
// ⑶ `TU_KHOA_SAU_FROM` — từ khoá đứng sau `FROM`/`JOIN`/… mà không phải tên bảng. Ở vị trí ấy
//    một tên trùng tên hàm là chuyện bình thường (`FROM generate_series(…)`), nên chỉ vế "phải là
//    từ khoá thật" áp dụng.
// ==============================================================================================

import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";
import { NGU_PHAP_KHONG_GHIM, TU_KHOA_SAU_FROM, TU_KHOA_TRUOC_NGOAC } from "./qt3-tu-vung.js";

/** Năm tên bản đầu miễn NHẦM — chúng ở đây làm RĂNG cho phép đo ⑴. */
const DA_BI_BAC: readonly string[] = ["extract", "substring", "overlay", "position", "normalize"];

describe("[INV-H21] ba danh sách miễn trừ của QT3, đo trên PostgreSQL thật", () => {
  let db: TestDatabase;
  let coHam: ReadonlySet<string>;
  let laTuKhoa: ReadonlySet<string>;

  beforeAll(async () => {
    db = await startPostgres();
    const ungVien = [
      ...NGU_PHAP_KHONG_GHIM,
      ...TU_KHOA_TRUOC_NGOAC,
      ...TU_KHOA_SAU_FROM,
      ...DA_BI_BAC,
      "count",
      "now",
      "lower",
    ];
    const { rows: ham } = await db.pool.query<{ proname: string }>(
      `SELECT DISTINCT p.proname
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) p.pronamespace
        WHERE n.nspname OPERATOR(pg_catalog.=) 'pg_catalog'
          AND p.proname OPERATOR(pg_catalog.=) ANY($1::pg_catalog.text[])`,
      [ungVien],
    );
    coHam = new Set(ham.map((r) => r.proname));
    const { rows: tk } = await db.pool.query<{ word: string }>(
      "SELECT word FROM pg_catalog.pg_get_keywords()",
    );
    laTuKhoa = new Set(tk.map((r) => r.word));
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("⑴ mọi tên trong `NGU_PHAP_KHONG_GHIM` KHÔNG được có hàm nào trong pg_catalog", () => {
    expect(
      NGU_PHAP_KHONG_GHIM.filter((t) => coHam.has(t)),
      "những tên này CÓ hàm trong pg_catalog, tức chúng ghim được — miễn chúng là mở một lỗ",
    ).toEqual([]);
  });

  it("⑴ RĂNG: năm tên đã bị bác bỏ THẬT SỰ có hàm trong pg_catalog", () => {
    // Không có khẳng định này thì phép kiểm trên xanh cả khi `coHam` rỗng vì một lý do vớ vẩn.
    for (const t of [...DA_BI_BAC, "count", "now", "lower"]) {
      expect(coHam.has(t), `${t} phải có hàm trong pg_catalog`).toBe(true);
    }
  });

  it("⑵ [H14-4] mọi tên trong `TU_KHOA_TRUOC_NGOAC` là TỪ KHOÁ và KHÔNG có hàm cùng tên", () => {
    expect(
      TU_KHOA_TRUOC_NGOAC.filter((t) => coHam.has(t)),
      "một HÀM THẬT nằm trong danh sách miễn ⇒ nó được viết trần mà lớp canh im lặng",
    ).toEqual([]);
    expect(TU_KHOA_TRUOC_NGOAC.filter((t) => !laTuKhoa.has(t))).toEqual([]);
  });

  it("⑶ mọi tên trong `TU_KHOA_SAU_FROM` là TỪ KHOÁ thật của PostgreSQL", () => {
    expect(TU_KHOA_SAU_FROM.filter((t) => !laTuKhoa.has(t))).toEqual([]);
  });

  it("mọi tên kiểu ĐÃ GHIM trong mã sản xuất phải là một kiểu THẬT của pg_catalog", async () => {
    // Phép đo này ra đời từ một lần ĐỎ: vòng sửa ghim `$2::pg_catalog.int` — và `int` là ĐƯỜNG CÚ
    // PHÁP, không phải tên kiểu trong catalog (tên thật là `int4`). Câu ấy ném 42704, `/guest/otp/
    // verify` trả 500 thay vì 401, và chỉ tầng T3 bắt được.
    //
    // Hình dạng của lỗi đáng nhớ hơn bản thân lỗi: một lớp canh đòi `::pg_catalog.<t>` cho mọi
    // `::<t>` sẽ DẠY người ta viết `::pg_catalog.int`, vì `::int` là cách viết tự nhiên. Nên vế
    // "tên kiểu ghim phải TỒN TẠI" thuộc về chính lớp ấy.
    // Đọc CHUỖI SQL của mã sản xuất, KHÔNG grep văn bản thô: bản đầu grep cả chú thích, và chú
    // thích của chính tệp này (kể lại ca `$2::pg_catalog.int`) tự tố cáo mình — phép đo ĐỎ trên
    // một cái tên chỉ tồn tại trong một câu văn kể chuyện.
    const ten = [
      ...new Set(
        moiCauSql()
          .flatMap((c) => [...c.sql.matchAll(/::pg_catalog[.]([a-z0-9_]+)/gi)])
          .map((m) => m[1]!.toLowerCase()),
      ),
    ];
    expect(ten.length, "không thấy tên kiểu nào — phép kiểm rỗng ruột").toBeGreaterThan(5);
    const { rows } = await db.pool.query<{ typname: string }>(
      `SELECT t.typname
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) t.typnamespace
        WHERE n.nspname OPERATOR(pg_catalog.=) 'pg_catalog'
          AND t.typname OPERATOR(pg_catalog.=) ANY($1::pg_catalog.text[])`,
      [ten],
    );
    const co = new Set(rows.map((r) => r.typname));
    expect(ten.filter((t) => !co.has(t)), "tên kiểu ghim mà pg_catalog KHÔNG có").toEqual([]);
    // RĂNG: `int` là đường cú pháp — nó KHÔNG phải một kiểu trong catalog.
    const { rows: khong } = await db.pool.query<{ n: string }>(
      `SELECT pg_catalog.count(*)::pg_catalog.text AS n
         FROM pg_catalog.pg_type t
         JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) t.typnamespace
        WHERE n.nspname OPERATOR(pg_catalog.=) 'pg_catalog'
          AND t.typname OPERATOR(pg_catalog.=) 'int'`,
    );
    expect(khong[0]?.n).toBe("0");
  });

  it("ĐỐI CHỨNG: `pg_catalog.coalesce(...)` thật sự KHÔNG chạy, còn `coalesce(...)` thì chạy", async () => {
    await expect(db.pool.query("SELECT pg_catalog.coalesce(1, 2)")).rejects.toMatchObject({
      code: "42883",
    });
    const { rows } = await db.pool.query<{ n: number }>("SELECT coalesce(NULL, 7) AS n");
    expect(rows[0]?.n).toBe(7);
  });

  it("ĐỐI CHỨNG NGƯỢC: `pg_catalog.now()` chạy — nên `now()` trần LÀ một chỗ ghim được", async () => {
    const { rows } = await db.pool.query<{ ok: boolean }>(
      "SELECT pg_catalog.now() IS NOT NULL AS ok",
    );
    expect(rows[0]?.ok).toBe(true);
  });
});
