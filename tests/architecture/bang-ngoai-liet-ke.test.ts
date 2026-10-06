// ==============================================================================================
// [INV-L15] [S1.272 / S4.6a] MỌI CHỖ CHẠM HAI BẢNG GIÁ NGOÀI ĐƯỢC LIỆT KÊ BẰNG TÊN — và chưa câu nào ĐỌC giá
//
// `external_price_references` và `external_purchase_history` là hai bảng giá không phải báo giá (ADR-054, ADR-095 ⑸): vai ghi
// `app_api` qua người giữ `item.manage`, cổng đọc GIÁ `bid.view` (ADR-096 ⑵). `app_api` có `SELECT` mức bảng — khuôn mọi bảng nền
// —, nên ranh giới thật là lớp này, cùng khuôn `ban-ro-liet-ke.test.ts` của bảng bản rõ:
//   ⑴ tệp TypeScript sản xuất có câu SQL chạm hai bảng đúng bằng danh sách, mỗi tệp một lý do;
//   ⑵ ở vòng S4.6a không câu nào đọc `don_gia` — cột ấy chỉ xuất hiện trong câu INSERT. Bộ đọc giá dưới `bid.view` là của S4.6b, và
//      nó vào đây bằng một dòng có lý do;
//   ⑶ L15 — *"không một phép đếm nào của cổng (e) đọc nó"*: không migration nào ngoài tệp dựng bảng và tệp ghim nhắc tên hai bảng,
//      nên không view, hàm hay phép đếm SQL nào đọc chúng mà không qua lớp này.
// [rà soát §S1.272 THẤP-3] Bản đầu chỉ tìm chữ `don_gia`, nên `SELECT h.*`, `to_jsonb(h)`, `h::text` và `RETURNING don_gia` của một
// câu INSERT đi qua — đọc giá mà không viết tên cột. Nay ⑵ cấm thêm mọi cách đọc CẢ HÀNG (`*` ngoài `count(*)`, hàm đóng gói hàng,
// bí danh của bảng đứng một mình hay ép kiểu), cấm `don_gia` sau `RETURNING` và ngoài danh sách cột của câu INSERT; ⑶ cấm mọi
// `FROM`/`JOIN` hai bảng trong MỌI migration, kể cả tệp dựng bảng và tệp ghim. Vẫn là lớp chữ: một câu SQL dựng động vượt qua nó.
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

/**
 * Mọi cách một câu chạm hai bảng ĐỌC được giá — có viết tên cột hay không. Trả lý do (rỗng = sạch). `don_gia` chỉ được đứng trong danh
 * sách cột của câu `INSERT INTO public.external_… (…)`; sau `RETURNING` thì không.
 */
function docCaHangHayGia(sql: string): string[] {
  const ly: string[] = [];
  const chen = /^\s*INSERT\s+INTO\s+public\.external_\w+\s*\(([^)]*)\)/iu.exec(sql);
  const [dau, duoi] = chen === null ? ["", sql] : [chen[0], sql.slice(chen[0].length)];
  const [than, traVe] = duoi.split(/\bRETURNING\b/iu, 2) as [string, string | undefined];
  if (/\bdon_gia\b/u.test(than)) ly.push("đọc don_gia");
  if (traVe !== undefined && /\bdon_gia\b|\*/u.test(traVe)) ly.push("RETURNING mang don_gia");
  const boDem = (dau + than).replace(/\bcount\s*\(\s*\*\s*\)/giu, "count()");
  if (/\*/u.test(boDem)) ly.push("đọc cả hàng (*)");
  if (/\b(?:to_jsonb?|row_to_json|jsonb?_agg|jsonb?_build_(?:object|array)|array_agg|hstore|json_populate_record)\s*\(/iu.test(than)) {
    ly.push("hàm đóng gói hàng");
  }
  for (const m of than.matchAll(/\bexternal_(?:price_references|purchase_history)\s+(?:AS\s+)?([a-z_]\w*)/giu)) {
    const b = m[1]!;
    if (/^(?:WHERE|JOIN|ON|LEFT|INNER|CROSS|GROUP|ORDER|LIMIT|UNION)$/iu.test(b)) continue;
    const thoi = new RegExp(String.raw`(?:\b${b}\s*::|[(,]\s*${b}\s*[),]|SELECT\s+${b}\s+FROM)`, "iu");
    if (thoi.test(than)) ly.push(`bí danh ${b} dùng như cả hàng`);
  }
  return ly;
}

describe("[INV-L15] [S1.272 / S4.6a] hai bảng giá ngoài — mọi chỗ chạm có tên", () => {
  it("[INV-L15] tệp TypeScript sản xuất có câu SQL chạm hai bảng đúng bằng danh sách", () => {
    const tep = [...new Set(moiCauSql().filter((c) => BANG.test(c.sql)).map((c) => c.tep))].sort();
    expect(tep, "tệp mới chạm bảng giá ngoài: thêm một dòng CÓ LÝ DO vào TEP_TS — đọc giá thì dưới `bid.view` và kèm hàng sổ").toEqual(
      Object.keys(TEP_TS).sort(),
    );
  });

  it("[INV-L15] không câu nào ĐỌC `don_gia` của hai bảng — cột ấy chỉ ở câu INSERT (bộ đọc giá `bid.view` là của S4.6b)", () => {
    const cau = moiCauSql().filter((c) => BANG.test(c.sql));
    expect(cau.length, "bộ đọc mù: không thấy câu nào chạm hai bảng").toBeGreaterThan(5);
    expect(cau.flatMap((c) => docCaHangHayGia(c.sql).map((ly) => `${c.tep}:${String(c.dong)} ${ly}`))).toEqual([]);
    // Chống rỗng ruột: hai câu INSERT dữ liệu CÓ mang `don_gia`, và câu liệt kê lô thì không.
    expect(cau.filter((c) => /^\s*INSERT/iu.test(c.sql) && /\bdon_gia\b/u.test(c.sql)).length).toBe(2);
  });

  it("[INV-L15] ĐỐI CHỨNG của bộ dò đọc-cả-hàng: mỗi cách đọc giá không viết tên cột đều bị nêu; câu thật của vòng này thì không", () => {
    const E = "public.external_price_references";
    for (const [sql, ly] of [
      [`SELECT h.* FROM ${E} h`, "đọc cả hàng (*)"],
      [`SELECT * FROM ${E}`, "đọc cả hàng (*)"],
      [`SELECT pg_catalog.to_jsonb(h) FROM ${E} h`, "hàm đóng gói hàng"],
      [`SELECT row_to_json(h) FROM ${E} AS h`, "hàm đóng gói hàng"],
      [`SELECT h::text FROM ${E} h`, "bí danh h dùng như cả hàng"],
      [`SELECT x.id FROM t x WHERE x.v IN (SELECT r FROM ${E} r)`, "bí danh r dùng như cả hàng"],
      [`SELECT h.don_gia FROM ${E} h`, "đọc don_gia"],
      [`INSERT INTO ${E} (org_id, don_gia) SELECT $1, $2 RETURNING id, don_gia`, "RETURNING mang don_gia"],
      [`INSERT INTO ${E} (org_id, don_gia) SELECT o.org_id, o.don_gia FROM ${E} o`, "đọc don_gia"],
    ] as const) {
      expect(docCaHangHayGia(sql), sql).toContain(ly);
    }
    expect(docCaHangHayGia(`SELECT pg_catalog.count(*) FROM ${E} h WHERE h.org_id = $1`)).toEqual([]);
    expect(docCaHangHayGia(`INSERT INTO ${E} (org_id, don_gia) SELECT $1, ($2::pg_catalog.text[])[d.i] FROM pg_catalog.unnest($3) d(x, i) RETURNING id`)).toEqual([]);
  });

  it("[INV-L15] L15 — không migration nào, kể cả tệp dựng bảng và tệp ghim, ĐỌC hai bảng (`FROM`/`JOIN`)", () => {
    const doc = readdirSync(THU_MUC_MIGRATION)
      .filter((t) => t.endsWith(".sql"))
      .flatMap((t) =>
        [...readFileSync(`${THU_MUC_MIGRATION}${t}`, "utf8").matchAll(/\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:public\.)?external_(?:price_references|purchase_history)\b/giu)].map(
          (m) => `${t}: ${m[0]}`,
        ),
      );
    expect(doc, "một hàm, view hay phép đếm trong migration đọc bảng giá ngoài — cổng (e) không được đếm lịch sử ngoài (L15)").toEqual([]);
  });

  it("[INV-L15] L15 — không migration nào ngoài tệp dựng bảng và tệp ghim nhắc tên hai bảng: không view, hàm hay phép đếm SQL đọc chúng", () => {
    const tep = readdirSync(THU_MUC_MIGRATION)
      .filter((t) => t.endsWith(".sql"))
      .filter((t) => BANG.test(readFileSync(`${THU_MUC_MIGRATION}${t}`, "utf8")))
      .sort();
    expect(tep, "migration mới đọc bảng giá ngoài: cổng (e) không được đếm lịch sử ngoài hệ thống (ADR-096 ⑷, L15)").toEqual([
      "109_du_lieu_ngoai.sql",
      "hardening.always.sql",
    ]);
  });
});
