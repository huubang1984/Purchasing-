import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUPPLIER_LEVELS, TAX_CODE_PATTERN } from "./suppliers.js";

// =============================================================================================
// HAI BẢN SAO CỦA MỘT LUẬT — VÀ MỘT LỚP CANH SỰ ĐỒNG BỘ CỦA CHÚNG
//
// Hình dạng MST được viết HAI nơi: `CHECK (tax_code ~ '...')` ở 008 và `TAX_CODE_PATTERN` ở
// suppliers.ts. Sự nhân bản là CÓ CHỦ ĐÍCH — CSDL là lớp có thẩm quyền (nó chặn cả đường không
// đi qua gói này), còn lớp TypeScript tồn tại để người dùng nhận "sai định dạng" thay vì một mã
// 23514 của Postgres.
//
// Nhưng "có chủ đích" KHÔNG làm cho việc lệch nhau trở nên vô hại: nếu bản TS nới ra mà bản SQL
// thì không, ứng dụng sẽ nhận về một lỗi ràng buộc thô ở đúng ca mà nó tưởng đã xử lý; nếu bản
// SQL nới ra mà bản TS thì không, một giá trị hợp lệ bị từ chối ở tầng ngoài mà không ai biết
// tại sao. Đây đúng khuôn "viết nguyên lý ở một nơi, quên áp ở nơi kia" mà 002 đã vấp hai lần
// (CR3 với `organizations.slug`, rồi lại với `users_pkey` cách đó 50 dòng).
//
// Dự án đã có một khuôn cho tình huống này: `HINH_DANG_CHUAN` ở db/rls-coverage.int.test.ts là
// bản sao TypeScript của một hằng trong hardening.always.sql, và có meta-test đòi hai bên KHỚP.
// Khối dưới đây là cùng cơ chế, cỡ nhỏ hơn nhiều.
// =============================================================================================

const DUONG_DAN_008 = fileURLToPath(
  new URL("../../../db/migrations/008_suppliers.sql", import.meta.url),
);

/** Bóc biểu thức regex trong `tax_code ~ '...'` của 008 — đọc file thật, không chép tay. */
function bocRegexTuSql(): string {
  const sql = readFileSync(DUONG_DAN_008, "utf8");
  const khop = /tax_code\s*~\s*'([^']+)'/.exec(sql);
  if (khop?.[1] === undefined) {
    throw new Error(
      "Không tìm thấy `tax_code ~ '...'` trong 008_suppliers.sql. Nếu CHECK đã được viết lại " +
        "bằng một cách khác, lớp canh này phải được viết lại cùng lúc — không được xoá.",
    );
  }
  return khop[1];
}

describe("hình dạng MST", () => {
  it("biểu thức ở 008 và TAX_CODE_PATTERN là MỘT — hai bản sao không được phép trôi khỏi nhau", () => {
    expect(bocRegexTuSql()).toBe(TAX_CODE_PATTERN.source);
  });

  it("nhận đúng hai hình dạng MST Việt Nam, và chỉ hai", () => {
    expect(TAX_CODE_PATTERN.test("0101010101")).toBe(true);
    expect(TAX_CODE_PATTERN.test("0101010101-001")).toBe(true);

    for (const xau of [
      "", // rỗng
      "010101010", // 9 chữ số
      "01010101011", // 11 chữ số
      "0101010101-01", // đuôi 2 chữ số
      "0101010101-0011", // đuôi 4 chữ số
      "010101010a", // có chữ cái
      " 0101010101", // khoảng trắng đầu — `chuanHoaMst` cắt trước khi kiểm, nên regex phải từ chối
      "0101010101 ", // khoảng trắng cuối
      "0101010101\n", // NEO CUỐI. Ca này ở đây vì một giả định của tôi ĐÃ BỊ PHÉP ĐO BÁC BỎ:
      "0101010101\r\n", // tôi chờ `$` của JS khớp TRƯỚC một `\n` cuối chuỗi (hành vi của Python
      "0101010101\n0202020202", // và của PCRE), tức bản TS sẽ NHẬN thứ mà `~` của Postgres TỪ
      //                           CHỐI. Đo trên Node 22: cả ba ca đều `false` — không có cờ `m`
      //                           thì `$` của JS chỉ khớp ở CUỐI CHUỖI. Không có phân kỳ nào để
      //                           ghi vào sổ nợ, và ba ca này ở lại để khoá kết luận đó.
    ]) {
      expect(TAX_CODE_PATTERN.test(xau), `phải từ chối: ${JSON.stringify(xau)}`).toBe(false);
    }
  });

  it("Level 2 KHÔNG nằm trong tập hợp lệ — ADR-013 mục 4 đòi một ADR mới cho nó", () => {
    expect([...SUPPLIER_LEVELS]).toEqual([0, 1]);
    expect((SUPPLIER_LEVELS as readonly number[]).includes(2)).toBe(false);
  });
});
