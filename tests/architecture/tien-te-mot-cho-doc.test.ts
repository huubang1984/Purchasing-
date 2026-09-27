// ==============================================================================================
// [INV-J8] [S1.163 / khoản 244] TIỀN TỆ CỦA BÁO GIÁ CHỈ ĐƯỢC ĐỌC QUA `public.bid_currency`
//
// Trước vòng S1.163, NĂM chỗ đọc `payload ->> 'currency'` trần — một ở lượt chấm, bốn ở bảng so
// sánh — và mỗi chỗ tự quyết `VNĐ` có phải `VND` không. Chúng quyết giống nhau (đều "không"), và đó
// là cả khoản 244: một nhà cung cấp gõ `VNĐ` làm lượt chấm của CẢ GÓI bị từ chối. Vòng ấy đưa năm chỗ
// qua MỘT hàm SQL. Lớp này giữ con số MỘT: một bộ đọc thứ sáu đọc chuỗi trần — `bid_don_gia` mà spec
// S4 §4.5 định viết là ứng viên gần nhất — sẽ đỏ ở đây thay vì âm thầm cho `VNĐ` và `VND` là hai đơn vị.
//
// Phạm vi đọc: mọi câu SQL trong mã TypeScript SẢN XUẤT (bộ đọc của QT3 — `moiCauSql`) và mọi tệp
// migration. `app_api` có `SELECT` cả bảng trên `rfq_unsealed_bids` (`019`), nên lớp CSDL không chặn
// được một bộ đọc trần; lớp này là lớp duy nhất.
// ==============================================================================================
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";

const THU_MUC_MIGRATION = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** Mọi lần đọc khoá `currency` bằng toán tử `->>`, ghim hay trần. */
const DOC_TIEN_TE = /(?:OPERATOR\(pg_catalog\.->>\)|->>)\s*'currency'/gu;

/** Lần đọc HỢP LỆ: ngay trong đối số của `public.bid_currency(`. */
const QUA_HAM = /public\.bid_currency\(\(\s*[a-z_]+\.payload\s+(?:OPERATOR\(pg_catalog\.->>\)|->>)\s*'currency'\s*\)\)/gu;

function viPham(noiDung: string): number {
  const tatCa = noiDung.match(DOC_TIEN_TE)?.length ?? 0;
  const hopLe = noiDung.match(QUA_HAM)?.length ?? 0;
  return tatCa - hopLe;
}

describe("[INV-J8] tiền tệ báo giá — một hàm đọc", () => {
  it("[INV-J8] mọi câu SQL sản xuất đọc `'currency'` của bản rõ đều đọc QUA `public.bid_currency`", () => {
    const cau = moiCauSql();
    const sai = cau.filter((c) => viPham(c.sql) !== 0).map((c) => `${c.tep}:${String(c.dong)}`);
    expect(sai, "chỗ đọc tiền tệ trần — gọi `public.bid_currency((u.payload OPERATOR(pg_catalog.->>) 'currency'))`").toEqual([]);

    // ĐỐI CHỨNG DƯƠNG: lớp này không xanh vì bộ đọc câu SQL mù. Hai bộ đọc đã biết phải được thấy, với
    // đủ năm lần đọc qua hàm — nếu con số này đổi, câu hỏi là *bộ đọc mới có đi qua hàm không*, và
    // phép kiểm ngay trên đã trả lời.
    const quaHam = cau.filter((c) => (c.sql.match(QUA_HAM)?.length ?? 0) > 0);
    const tep = [...new Set(quaHam.map((c) => c.tep))].sort();
    expect(tep).toEqual(["packages/danh-gia/src/luot-danh-gia.ts", "packages/unseal/src/comparison.ts"]);
    expect(quaHam.reduce((s, c) => s + (c.sql.match(QUA_HAM)?.length ?? 0), 0)).toBe(5);
  });

  it("[INV-J8] không migration nào đọc `'currency'` của bản rõ trần", () => {
    const sai = readdirSync(THU_MUC_MIGRATION)
      .filter((t) => t.endsWith(".sql"))
      // Bỏ chú thích `--` trước khi đếm: chính `070` nhắc lại câu đọc trần trong khối chú thích của nó.
      .filter((t) => viPham(readFileSync(`${THU_MUC_MIGRATION}${t}`, "utf8").replace(/--[^\n]*/gu, "")) !== 0);
    expect(sai).toEqual([]);
  });

  it("[INV-J8] bộ đếm tự kiểm: một câu trần bị đếm là vi phạm, một câu qua hàm thì không", () => {
    expect(viPham("SELECT (u.payload OPERATOR(pg_catalog.->>) 'currency') FROM x")).toBe(1);
    expect(viPham("SELECT u.payload ->> 'currency' FROM x")).toBe(1);
    expect(viPham("SELECT public.bid_currency((u.payload OPERATOR(pg_catalog.->>) 'currency')) FROM x")).toBe(0);
  });
});
