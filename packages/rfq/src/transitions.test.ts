import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RFQ_STATUSES, RFQ_TRANSITIONS } from "./rfq.js";

// =============================================================================================
// BẢNG CẠNH TỒN TẠI HAI NƠI — VÀ MỘT LỚP CANH SỰ ĐỒNG BỘ
//
// `CANH_HOP_LE` trong 009 là lớp CƯỠNG CHẾ. `RFQ_TRANSITIONS` trong rfq.ts là bản sao ĐỂ ĐỌC.
// Nhân bản có chủ đích, nhưng lệch nhau thì không vô hại: giao diện dựng từ bản TS sẽ mời người
// dùng bấm một nút mà CSDL từ chối, hoặc giấu một nút mà CSDL cho phép. Cả hai đều là lỗi báo cho
// người dùng một mô hình sai về hệ thống.
//
// Cùng khuôn `HINH_DANG_CHUAN` (db/rls-coverage.int.test.ts ↔ hardening.always.sql) và
// `TAX_CODE_PATTERN` (packages/supplier ↔ 008).
// =============================================================================================

const DUONG_DAN_009 = fileURLToPath(new URL("../../../db/migrations/009_rfq.sql", import.meta.url));

/** Bóc các chuỗi 'A->B' trong khối `CANH_HOP_LE constant text[] := ARRAY[...]` của 009. */
function bocCanhTuSql(): string[] {
  const sql = readFileSync(DUONG_DAN_009, "utf8");
  const khoi = /CANH_HOP_LE constant text\[\] :=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(sql);
  if (khoi?.[1] === undefined) {
    throw new Error(
      "Không tìm thấy khối CANH_HOP_LE trong 009_rfq.sql. Nếu bảng cạnh đã được viết lại bằng " +
        "một cách khác, lớp canh này phải được viết lại CÙNG LÚC — không được xoá.",
    );
  }
  return [...khoi[1].matchAll(/'([A-Z_]+->[A-Z_]+)'/g)].map((m) => m[1] as string).sort();
}

describe("bảng cạnh của máy trạng thái RFQ", () => {
  it("bản TS và bảng cạnh trong 009 là MỘT — hai bản sao không được trôi khỏi nhau", () => {
    const tuTs = RFQ_TRANSITIONS.map(([tu, den]) => `${tu}->${den}`).sort();
    const tuSql = bocCanhTuSql();

    // Chống rỗng ruột: một regex hỏng trả mảng rỗng cũng "khớp" với một mảng rỗng.
    expect(tuSql.length).toBeGreaterThan(0);
    expect(tuTs).toEqual(tuSql);
  });

  it("`CLOSED->OPEN` KHÔNG có mặt — cạnh quan trọng nhất là cạnh không tồn tại", () => {
    // Nêu ĐÍCH DANH thay vì để nó nằm im trong phép so sánh ở trên: nếu ai đó thêm cạnh này, test
    // trên cũng đỏ, nhưng thông báo sẽ là "hai mảng khác nhau" thay vì tên của thứ vừa bị phá.
    // Một RFQ mở lại sau khi đã đóng thì phong bì đã nộp vẫn nằm đó — tính niêm phong mất trong
    // im lặng.
    expect(bocCanhTuSql()).not.toContain("CLOSED->OPEN");
    expect(RFQ_TRANSITIONS.some(([tu, den]) => tu === "CLOSED" && den === "OPEN")).toBe(false);
  });

  it("mọi trạng thái trong bảng cạnh đều nằm trong tập trạng thái hợp lệ", () => {
    const hopLe = new Set<string>(RFQ_STATUSES);
    const la = RFQ_TRANSITIONS.flat().filter((s) => !hopLe.has(s));
    expect(la).toEqual([]);
  });
});
