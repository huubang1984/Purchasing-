// ==============================================================================================
// [INV-H21] MỖI CÂU SQL SẢN XUẤT ĐƯỢC CHÍNH PostgreSQL PHÂN TÍCH — LỚP CANH HAI CHIỀU
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO TỆP NÀY TỒN TẠI: MỘT LỚP CANH MỘT CHIỀU ĐỂ LỌT HAI MƯƠI CÂU HỎNG
// ----------------------------------------------------------------------------------------------
// `qt3-ghim-schema.test.ts` bắt **THIẾU ghim**. Nó không bắt **GHIM SAI** — và vòng S1.24 chứng
// minh khoảng cách ấy đắt đến mức nào: một bộ ghim tự động viết lại 63 câu, cả `tsc`, `eslint`,
// `depcruise` lẫn chính H21 đều XANH, và review an ninh lượt 15 đọc tay ra **20 câu hỏng**:
//
//   • 10 chỗ dấu `=` của PHÉP GÁN trong `SET` bị ghim (`SET opened_by OPERATOR(pg_catalog.=) $2`)
//     — ngữ pháp `set_clause` của PostgreSQL chỉ nhận token `=` trần ⇒ 42601;
//   •  6 chỗ văn bản câu lệnh bị NHÂN ĐÔI (`… WHERE id = $1SELECT … WHERE id = $1`);
//   •  2 chỗ `pg_catalog.extract(epoch FROM …)` — `EXTRACT(field FROM x)` là ngữ pháp riêng,
//     không gọi được bằng tên đủ schema (khuôn đúng nằm sẵn ở migration 039: `date_part`);
//   •  2 chỗ ĐỔI CÂY PHÂN TÍCH vì `OPERATOR(...)` luôn mang độ ưu tiên *"toán tử bất kỳ"*, nên
//     `a = b ->> 'k'` thành `(a = b) ->> 'k'` ⇒ 42883.
//
// Không lỗi nào trong 20 lỗi ấy là lỗi TypeScript: SQL là **chuỗi**, và chuỗi thì trình biên dịch
// không đọc. Thứ duy nhất đọc được chúng là PostgreSQL. Nên tệp này đưa từng câu cho chính nó.
//
// ----------------------------------------------------------------------------------------------
// PHÉP ĐO: `PREPARE` — phân tích cú pháp + phân tích ngữ nghĩa, KHÔNG chạy
// ----------------------------------------------------------------------------------------------
// `PREPARE` phân giải tên bảng, tên hàm, toán tử và kiểu — tức đúng bốn trục QT3 — mà **không
// thực thi** câu lệnh, nên không có hàng nào bị đọc hay ghi. Nó chỉ nhận DML; câu tiện ích
// (`SET`, `CREATE`, `GRANT`, `DO`) nằm ngoài, và số ấy được ĐẾM ra chứ không im lặng.
// ==============================================================================================

import { withMigratedDatabase } from "@trustprocure/test-support";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { moiCauSql, tepNguonCoSql, type CauSql } from "./qt3-doc-sql.js";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/** `PREPARE` chỉ nhận DML. Câu tiện ích được đếm riêng, không được bỏ im. */
const RE_DML = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|VALUES)\b/i;

/**
 * SQLSTATE nói *"câu đã phân tích xong, chỉ thiếu KIỂU của tham số"* — không phải câu hỏng.
 *
 * `SELECT $1 AS dich FROM public.supplier_contacts` là SQL hợp lệ; PostgreSQL chỉ không đoán được
 * `$1` là kiểu gì khi không có ngữ cảnh. Ứng dụng thì có: nó truyền giá trị kèm kiểu suy từ cột.
 * Coi mã này là ĐẠT là một nhượng bộ có tên, không phải một chỗ lờ đi.
 */
const KIEU_KHONG_XAC_DINH = new Set(["42P18", "42P08"]);

/** Số câu DML tối thiểu phải đo được — không có nó thì một bộ lọc hỏng làm test rỗng ruột. */
const SO_DML_TOI_THIEU = 100;

/**
 * [S1.107 / lượt soi ngang 77 — ④] SÀN THEO TỆP — người canh THẬT cho tính đầy đủ của bộ đọc.
 *
 * `SO_DML_TOI_THIEU` ở trên là một con số VIẾT CỨNG, và lượt soi 77 đo ra rằng nó đã trôi: hôm nay
 * bộ đọc rút được **173** câu DML từ 115 tệp, nên một hồi quy nuốt mất 42% số câu vẫn đi lọt. Nó
 * cũng là người canh DUY NHẤT — không có một census vét cạn nào cho tập câu SQL, khác hẳn `GRANT`
 * hay policy.
 *
 * Vị từ dưới đây không viết cứng gì cả: **mỗi tệp nguồn có lời gọi `.query(` phải đóng góp ít
 * nhất MỘT câu**. Nó bắt đúng lớp hỏng mà con số kia bỏ sót — bộ đọc mù một hình dạng chuỗi, một
 * kiểu nối, một tệp — và nó tự chặt hơn theo kho thay vì thiu dần.
 */
const RE_GOI_QUERY = /\.query\s*(?:<[^>]*>)?\s*\(/u;

/**
 * Tệp có `.query(` mà bộ đọc KHÔNG rút được câu nào — mỗi dòng một lý do, cùng khuôn
 * `CHO_TRAN_DUOC_PHEP` và `ROUTE_DOC_KHONG_PHOI`. Một danh sách miễn trừ chỉ đứng được khi nó
 * cũng bị canh: khẳng định thứ hai đòi mỗi dòng ở đây trỏ một tệp CÓ THẬT còn gọi `.query(`.
 */
const TEP_CHI_DIEU_KHIEN_GIAO_DICH: readonly { readonly tep: string; readonly lyDo: string }[] = [
  {
    tep: "apps/api/src/routes/auth.ts",
    lyDo:
      "hai câu duy nhất là `SAVEPOINT xep_hang` và `ROLLBACK TO SAVEPOINT xep_hang` — điều khiển " +
      "giao dịch, và PostgreSQL KHÔNG `PREPARE` được chúng, nên bộ đọc bỏ qua là ĐÚNG chứ không sót",
  },
];

interface Loi {
  readonly cau: CauSql;
  readonly ma: string;
  readonly loi: string;
}

/** Thay chỗ nội suy của TypeScript bằng một biểu thức hợp lệ để PostgreSQL còn phân tích được. */
function thayNoiSuy(sql: string): string {
  return sql.replace(/\$NOI_SUY/g, "1");
}

describe("[INV-H21] mỗi câu SQL sản xuất được PostgreSQL phân tích", () => {
  it(
    "PREPARE từng câu: không câu nào hỏng cú pháp, sai tên, sai kiểu hay đổi cây phân tích",
    { timeout: 300_000 },
    async () => {
      const tatCa = moiCauSql();
      const dml = tatCa.filter((c) => RE_DML.test(c.sql));
      const tienIch = tatCa.length - dml.length;

      const loi: Loi[] = [];
      await withMigratedDatabase(async (db) => {
        const client = await db.pool.connect();
        try {
          // Đo phải có RĂNG trước khi đo thật: hai câu dưới đây là HAI trong 20 lỗi của chính
          // vòng này, viết nguyên dạng. Nếu chúng không ném thì phép đo bên dưới vô nghĩa.
          for (const [ten, xau] of [
            ["gán trong SET bị ghim", "UPDATE public.rfq_packages SET opened_by OPERATOR(pg_catalog.=) $1 WHERE id OPERATOR(pg_catalog.=) $2"],
            ["độ ưu tiên của OPERATOR()", "SELECT 1 FROM public.rfq_unsealed_bids u WHERE u.org_id OPERATOR(pg_catalog.=) u.payload OPERATOR(pg_catalog.->>) 'k'"],
          ] as const) {
            let nem = false;
            try {
              await client.query(`PREPARE rang_${ten.length} AS ${xau}`);
            } catch {
              nem = true;
            }
            expect(nem, `mũi răng "${ten}" KHÔNG ném — phép đo dưới đây rỗng ruột`).toBe(true);
          }

          let i = 0;
          for (const cau of dml) {
            i += 1;
            try {
              await client.query(`PREPARE tp_${i} AS ${thayNoiSuy(cau.sql)}`);
              await client.query(`DEALLOCATE tp_${i}`);
            } catch (e) {
              const ma = String((e as { code?: string }).code ?? "");
              if (KIEU_KHONG_XAC_DINH.has(ma)) continue;
              loi.push({ cau, ma, loi: (e as Error).message });
            }
          }
        } finally {
          client.release();
        }
      });

      // [S1.107 / lượt soi ngang 77 — ④] SÀN THEO TỆP, xem khối khai ở trên.
      const tepCoQuery = tepNguonCoSql().filter((t) => RE_GOI_QUERY.test(readFileSync(join(GOC, t), "utf8")));
      const tepCoCau = new Set(tatCa.map((c) => c.tep));
      const mienTru = new Set(TEP_CHI_DIEU_KHIEN_GIAO_DICH.map((x) => x.tep));
      expect(tepCoQuery.length, "chống rỗng ruột: không thấy tệp nào gọi `.query(`").toBeGreaterThan(20);
      expect(
        tepCoQuery.filter((t) => !tepCoCau.has(t) && !mienTru.has(t)),
        "tệp có lời gọi `.query(` mà bộ đọc không rút được câu nào — bộ đọc đang mù một hình dạng",
      ).toEqual([]);
      expect(
        [...mienTru].filter((t) => !tepCoQuery.includes(t)),
        "một dòng miễn trừ trỏ vào tệp không còn gọi `.query(` — dòng ấy che mất một tệp THẬT mai sau",
      ).toEqual([]);

      expect(dml.length, "quá ít câu DML — bộ lọc đang nuốt mất chủ thể").toBeGreaterThanOrEqual(
        SO_DML_TOI_THIEU,
      );
      expect(tienIch, "phải có câu tiện ích, không thì bộ đọc đang bỏ sót").toBeGreaterThan(0);
      expect(
        loi.map((l) => `${l.cau.tep}:${l.cau.dong} [${l.ma}] ${l.loi}`),
        `${loi.length}/${dml.length} câu KHÔNG phân tích được`,
      ).toEqual([]);
    },
  );
});
