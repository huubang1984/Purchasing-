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
// [S1.9101 / S4.6b] VẾ ĐỌC (ADR-9201): bộ đọc giá dưới `bid.view` vào bằng MỘT tệp có lý do — `gia-ngoai.ts` — và ⑵ nay nói: `don_gia`
// chỉ được ĐỌC ở tệp ấy, đúng hai câu (lịch sử ngoài, mốc ngoài có số); câu đọc CỜ mốc ngoài của bảng benchmark không đọc giá. ⑷ mới:
// chỗ gọi của ba hàm đọc ghim theo KÝ HIỆU (khuôn `ban-ro-liet-ke.test.ts`) — chúng chỉ đi qua `benchmark-goi.ts`, mà các hàm của tệp
// ấy chỉ `doc-benchmark.ts` (cổng `bid.view`) gọi; lượt chấm không bật `kemNgoai`, nên nhãn ngoài không vào lượt chấm, bộ bằng chứng hay
// một phép đếm nào của cổng (e). Bộ dò `*` bỏ qua phép nhân có ghim (`OPERATOR(pg_catalog.*)`) — QT3 buộc mọi toán tử ghim schema.
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";

// [rà soát §S1.9101 THẤP-3] Cờ `i`: SQL không phân biệt hoa thường — `EXTERNAL_PURCHASE_HISTORY` hay `h.DON_GIA` vượt bản đầu.
const BANG = /\bexternal_(?:price_references|purchase_history)\b/iu;
const THU_MUC_MIGRATION = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** Tệp TypeScript sản xuất chạm hai bảng — và vì sao. */
const TEP_TS: Readonly<Record<string, string>> = {
  "packages/du-lieu-nen/src/du-lieu-ngoai.ts":
    "GHI (nhập lô, nhập tay, rút) dưới `item.manage`; ĐỌC lô và hàng KHÔNG đơn giá dưới cổng `item.manage` trong hàm",
  // [S1.9101 / S4.6b] Bộ đọc giá của ADR-096 ⑵ — người đọc `bid.view`: cổng ở `doc-benchmark.ts`, chỗ gọi ghim ở ca ⑷ dưới.
  "packages/du-lieu-nen/src/gia-ngoai.ts":
    "ĐỌC giá tại mốc mở giá cho dải lịch sử ngoài và mốc ngoài — sau cổng `bid.view` của `docBenchmark`/`docDaiBenchmark`",
};

/** Tệp DUY NHẤT được đọc `don_gia` của hai bảng, và số câu đọc nó ở đó. */
const TEP_DOC_GIA = "packages/du-lieu-nen/src/gia-ngoai.ts";
const SO_CAU_DOC_GIA = 2;

/**
 * Mọi cách một câu chạm hai bảng ĐỌC được giá — có viết tên cột hay không. Trả lý do (rỗng = sạch). `don_gia` chỉ được đứng trong danh
 * sách cột của câu `INSERT INTO public.external_… (…)`; sau `RETURNING` thì không.
 */
function docCaHangHayGia(sql: string): string[] {
  const ly: string[] = [];
  const chen = /^\s*INSERT\s+INTO\s+public\.external_\w+\s*\(([^)]*)\)/iu.exec(sql);
  const [dau, duoi] = chen === null ? ["", sql] : [chen[0], sql.slice(chen[0].length)];
  const [than, traVe] = duoi.split(/\bRETURNING\b/iu, 2) as [string, string | undefined];
  if (/\bdon_gia\b/iu.test(than)) ly.push("đọc don_gia");
  if (traVe !== undefined && /\bdon_gia\b|\*/iu.test(traVe)) ly.push("RETURNING mang don_gia");
  const boDem = (dau + than).replace(/\bcount\s*\(\s*\*\s*\)/giu, "count()").replace(/OPERATOR\(pg_catalog\.\*\)/gu, "OPERATOR(nhan)");
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

  it("[INV-L15] `don_gia` của hai bảng chỉ được ĐỌC ở bộ đọc giá `bid.view` (`gia-ngoai.ts`, đúng hai câu); không câu nào đọc cả hàng", () => {
    const cau = moiCauSql().filter((c) => BANG.test(c.sql));
    expect(cau.length, "bộ đọc mù: không thấy câu nào chạm hai bảng").toBeGreaterThan(5);
    const ngoaiBoDocGia = cau.filter((c) => c.tep !== TEP_DOC_GIA);
    expect(ngoaiBoDocGia.flatMap((c) => docCaHangHayGia(c.sql).map((ly) => `${c.tep}:${String(c.dong)} ${ly}`))).toEqual([]);
    // [S1.9101 / S4.6b] Ở bộ đọc giá: đọc `don_gia` bằng TÊN cột thì được, đọc cả hàng thì không — mọi lý do khác của bộ dò vẫn đỏ.
    const boDocGia = cau.filter((c) => c.tep === TEP_DOC_GIA);
    expect(
      boDocGia.flatMap((c) =>
        docCaHangHayGia(c.sql)
          .filter((ly) => ly !== "đọc don_gia")
          .map((ly) => `${c.tep}:${String(c.dong)} ${ly}`),
      ),
    ).toEqual([]);
    expect(boDocGia.filter((c) => docCaHangHayGia(c.sql).includes("đọc don_gia")).length, "số câu đọc giá của bộ đọc").toBe(SO_CAU_DOC_GIA);
    // Câu đọc CỜ mốc ngoài của bảng benchmark không đọc giá (chủ dự án chốt 2026-10-06: cờ ở bảng, số ở *Xem dải*).
    expect(boDocGia.filter((c) => /FROM public\.external_price_references/iu.test(c.sql) && !/\bdon_gia\b/iu.test(c.sql)).length).toBe(1);
    // Chống rỗng ruột: hai câu INSERT dữ liệu CÓ mang `don_gia`, và câu liệt kê lô thì không.
    expect(cau.filter((c) => /^\s*INSERT/iu.test(c.sql) && /\bdon_gia\b/iu.test(c.sql)).length).toBe(2);
  });

  it("[INV-L15] [S1.9101 / S4.6b] ba hàm đọc giá chỉ đi qua `benchmark-goi.ts`, và các hàm ấy chỉ `doc-benchmark.ts` (cổng `bid.view`) gọi; lượt chấm không bật `kemNgoai`", () => {
    const goc = fileURLToPath(new URL("../../", import.meta.url));
    const tepSanXuat = execFileSync("git", ["ls-files"], { cwd: goc, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/u)
      .filter((t) => /^(packages|apps|tools)\/.*\/src\/.*\.[cm]?[jt]s$/u.test(t) && !t.includes(".test."));
    const nhac = (ten: string): string[] =>
      tepSanXuat.filter((t) => new RegExp(`\\b${ten}\\b`, "u").test(readFileSync(`${goc}${t}`, "utf8"))).sort();
    const BO_DOC = "packages/du-lieu-nen/src/gia-ngoai.ts";
    const GOI = "packages/du-lieu-nen/src/benchmark-goi.ts";
    const CUA = "packages/du-lieu-nen/src/index.ts";
    const DOC_BM = "packages/danh-gia/src/doc-benchmark.ts";
    for (const ten of ["docLichSuNgoaiTaiMoc", "docMocNgoaiTaiMoc", "docMocNgoaiCo"]) {
      expect(nhac(ten), ten).toEqual([GOI, BO_DOC].sort());
    }
    expect(nhac("docCoMocNgoai")).toEqual([GOI, CUA, DOC_BM].sort());
    expect(nhac("kemNgoai")).toEqual([GOI, DOC_BM].sort());
    expect(nhac("tinhDaiDong")).toEqual([GOI, CUA, DOC_BM].sort());
    const docBm = readFileSync(`${goc}${DOC_BM}`, "utf8");
    expect(docBm.match(/permission: PERMISSIONS\.BID_VIEW/gu)?.length).toBe(2);
  });

  it("[INV-L15] [rà soát §S1.9101 THẤP-3] tên bảng viết HOA vẫn là chạm hai bảng", () => {
    expect(BANG.test("SELECT h.id FROM public.EXTERNAL_PURCHASE_HISTORY h")).toBe(true);
    expect(BANG.test("'EXTERNAL_PRICE_REFERENCES_IMPORTED'"), "mã hành động sổ không phải tên bảng").toBe(false);
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
      // [rà soát §S1.9101 THẤP-3] Viết hoa vẫn là đọc giá.
      [`SELECT h.DON_GIA FROM ${E} h`, "đọc don_gia"],
    ] as const) {
      expect(docCaHangHayGia(sql), sql).toContain(ly);
    }
    expect(docCaHangHayGia(`SELECT pg_catalog.count(*) FROM ${E} h WHERE h.org_id = $1`)).toEqual([]);
    // [S1.9101 / S4.6b] Phép nhân có ghim không phải đọc cả hàng; một `*` trần cạnh nó thì vẫn là.
    expect(docCaHangHayGia(`SELECT h.id, ($1::pg_catalog.int8 OPERATOR(pg_catalog.*) 2) FROM ${E} h`)).toEqual([]);
    expect(docCaHangHayGia(`SELECT h.*, ($1::pg_catalog.int8 OPERATOR(pg_catalog.*) 2) FROM ${E} h`)).toContain("đọc cả hàng (*)");
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
