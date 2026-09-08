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
import { moiCauSql, type CauSql } from "./qt3-doc-sql.js";

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
