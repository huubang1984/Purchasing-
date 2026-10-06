// ==============================================================================================
// [INV-L15] [S1.9101 / S4.6a] MỌI CHỖ CHẠM HAI BẢNG GIÁ NGOÀI ĐƯỢC LIỆT KÊ BẰNG TÊN — và chưa câu nào ĐỌC giá
//
// `external_price_references` và `external_purchase_history` là hai bảng giá không phải báo giá (ADR-054, ADR-095 ⑸): vai ghi
// `app_api` qua người giữ `item.manage`, cổng đọc GIÁ `bid.view` (ADR-096 ⑵). `app_api` có `SELECT` mức bảng — khuôn mọi bảng nền
// —, nên ranh giới thật là lớp này, cùng khuôn `ban-ro-liet-ke.test.ts` của bảng bản rõ:
//   ⑴ tệp TypeScript sản xuất có câu SQL chạm hai bảng đúng bằng danh sách, mỗi tệp một lý do;
//   ⑵ ở vòng S4.6a không câu nào đọc `don_gia` — cột ấy chỉ xuất hiện trong câu INSERT. Bộ đọc giá dưới `bid.view` là của S4.6b, và
//      nó vào đây bằng một dòng có lý do;
//   ⑶ L15 — *"không một phép đếm nào của cổng (e) đọc nó"*: không migration nào ngoài tệp dựng bảng và tệp ghim nhắc tên hai bảng,
//      nên không view, hàm hay phép đếm SQL nào đọc chúng mà không qua lớp này.
// Ranh giới nói ra: hai hàm trigger dùng chung (`du_lieu_nen_dat_thu_tu`, `du_lieu_ngoai_kiem_ghi`) chạm bảng bằng tên ĐỘNG
// (`TG_TABLE_NAME`) — lớp văn bản không thấy chúng; chúng chỉ đọc `seq` và `rut_cua`, và thân của chúng ghim ở hardening.
// ==============================================================================================
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";

const BANG = /\bexternal_(?:price_references|purchase_history)\b/u;
const THU_MUC_MIGRATION = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** Tệp TypeScript sản xuất chạm hai bảng — và vì sao. */
const TEP_TS: Readonly<Record<string, string>> = {
  "packages/du-lieu-nen/src/du-lieu-ngoai.ts":
    "GHI (nhập lô, nhập tay, rút) dưới `item.manage`; ĐỌC lô và hàng KHÔNG đơn giá dưới cổng `item.manage` trong hàm",
};

describe("[INV-L15] [S1.9101 / S4.6a] hai bảng giá ngoài — mọi chỗ chạm có tên", () => {
  it("[INV-L15] tệp TypeScript sản xuất có câu SQL chạm hai bảng đúng bằng danh sách", () => {
    const tep = [...new Set(moiCauSql().filter((c) => BANG.test(c.sql)).map((c) => c.tep))].sort();
    expect(tep, "tệp mới chạm bảng giá ngoài: thêm một dòng CÓ LÝ DO vào TEP_TS — đọc giá thì dưới `bid.view` và kèm hàng sổ").toEqual(
      Object.keys(TEP_TS).sort(),
    );
  });

  it("[INV-L15] không câu nào ĐỌC `don_gia` của hai bảng — cột ấy chỉ ở câu INSERT (bộ đọc giá `bid.view` là của S4.6b)", () => {
    const cau = moiCauSql().filter((c) => BANG.test(c.sql));
    expect(cau.length, "bộ đọc mù: không thấy câu nào chạm hai bảng").toBeGreaterThan(5);
    const docGia = cau.filter((c) => /\bdon_gia\b/u.test(c.sql) && !/^\s*INSERT\s+INTO\s+public\.external_/iu.test(c.sql));
    expect(docGia.map((c) => `${c.tep}:${String(c.dong)}`)).toEqual([]);
    // Chống rỗng ruột: hai câu INSERT dữ liệu CÓ mang `don_gia`, và câu liệt kê lô thì không.
    expect(cau.filter((c) => /^\s*INSERT/iu.test(c.sql) && /\bdon_gia\b/u.test(c.sql)).length).toBe(2);
  });

  it("[INV-L15] L15 — không migration nào ngoài tệp dựng bảng và tệp ghim nhắc tên hai bảng: không view, hàm hay phép đếm SQL đọc chúng", () => {
    const tep = readdirSync(THU_MUC_MIGRATION)
      .filter((t) => t.endsWith(".sql"))
      .filter((t) => BANG.test(readFileSync(`${THU_MUC_MIGRATION}${t}`, "utf8")))
      .sort();
    expect(tep, "migration mới đọc bảng giá ngoài: cổng (e) không được đếm lịch sử ngoài hệ thống (ADR-096 ⑷, L15)").toEqual([
      "9501_du_lieu_ngoai.sql",
      "hardening.always.sql",
    ]);
  });
});
