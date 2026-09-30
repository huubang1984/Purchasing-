// ==============================================================================================
// [INV-L5] [S1.9101 / S4.4a] MỌI CHỖ CHẠM BẢNG BẢN RÕ `rfq_unsealed_bids` ĐƯỢC LIỆT KÊ BẰNG TÊN
//
// Spec S4 §4.5 [S1.159]: vị từ *"giá đã lộ"* trong thân `quan_sat_gia` là *"một luật một chỗ"*, KHÔNG phải ranh giới — `app_api`
// có `SELECT` mức bảng trên `rfq_unsealed_bids` (`019:459`), nên mã chạy dưới `app_api` bỏ qua được hàm (góc B⑧). Ranh giới thật
// là lớp này: một bộ đọc giá THỨ N — một báo cáo, một route, một công cụ — không vào được kho mà không đi qua một dòng dưới đây,
// và dòng ấy phải nói nó đọc gì và vì sao không cần hàm as-of.
//
// Spec viết *"hôm nay năm tệp —, và hàm mới là tệp thứ sáu"*. Đo lúc viết lớp này: NĂM tệp TypeScript (`anh-xa.ts` của S4.3a đã là
// tệp thứ năm, bộ ghi của worker là tệp thứ nhất) và BA hàm SQL (hai trigger luật ghi của `089` và `quan_sat_gia`).
//
// Phạm vi đọc: mọi câu SQL trong mã TypeScript SẢN XUẤT (`moiCauSql` của QT3 — ghép chuỗi nối bằng `+`, bỏ chú thích), thân
// CUỐI CÙNG của mọi hàm qua các migration theo thứ tự tên tệp, và mọi tệp `.sql`/`.js`/`.mjs`/`.cjs` khác đã theo dõi. Lớp CSDL
// (`lich-su-gia.int.test.ts`) đọc `pg_get_functiondef` của mọi hàm ở mọi schema không hệ thống, cùng mọi view và materialized view.
// Lớp này KHÔNG thấy SQL động ghép tên bảng từ mảnh (`'rfq_unsealed' || '_bids'`) hay tên bảng nội suy trong mã TypeScript — nói
// ra ở ADR-9201.
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";

const THU_MUC_MIGRATION = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const BANG = /\brfq_unsealed_bids\b/u;

/** Tệp TypeScript sản xuất chạm bảng bản rõ — và vì sao nó không đi qua `quan_sat_gia`. */
const TEP_TS: Readonly<Record<string, string>> = {
  "apps/unseal-worker/src/index.ts": "GHI — bộ ghi duy nhất, vai `app_unseal`, trong giao dịch mở thầu",
  "packages/unseal/src/comparison.ts": "ĐỌC — bảng so sánh của MỘT gói, cổng `bid.view` + trạng thái ≥ UNSEALED, mỗi lần đọc một hàng sổ",
  "packages/danh-gia/src/luot-danh-gia.ts": "ĐỌC — lượt chấm của MỘT gói (`docBaoGia`), cổng `evaluation.perform`",
  "packages/danh-gia/src/doc-bang-xep-hang.ts": "ĐỌC — bảng xếp hạng của MỘT gói, cổng `bid.view`",
  "packages/du-lieu-nen/src/anh-xa.ts": "TỒN TẠI — chỉ hỏi gói đã có hàng bản rõ chưa (L13), không đọc `payload`",
};

/** Hàm SQL có thân chạm bảng bản rõ. */
const HAM_SQL: Readonly<Record<string, string>> = {
  anh_xa_kiem_luat: "TỒN TẠI — L13: ánh xạ trên gói đã có bản rõ đòi lý do (`089`)",
  goi_y_kiem_luat: "TỒN TẠI — gợi ý trên gói đã có bản rõ chỉ do người giữ `item.manage` ghi (`089`)",
  quan_sat_gia: "ĐỌC — lịch sử giá xuyên gói, vị từ `gia_da_lo` và mốc trong thân (`9501`)",
};

const tepMigration = (): readonly string[] =>
  readdirSync(THU_MUC_MIGRATION)
    .filter((t) => /^\d{3,4}_.*\.sql$/u.test(t))
    .sort();

/**
 * Thân CUỐI CÙNG của mỗi hàm — migration sau đè migration trước, đúng thứ tự `migrate()` chạy. Khoá là tên không schema; hàm
 * ngoài `public.` mang tiền tố schema. Có hay không `OR REPLACE`, thân dấu `$…$` nào cũng được; phần đầu hàm không được vượt qua
 * một `CREATE` khác (lượt soi: một thân `BEGIN ATOMIC` không có `AS $…$`, và mẫu lười trượt sang thân của hàm KẾ TIẾP).
 */
function thanCuoiCung(): ReadonlyMap<string, string> {
  const than = new Map<string, string>();
  for (const t of tepMigration()) {
    const noiDung = readFileSync(`${THU_MUC_MIGRATION}${t}`, "utf8");
    for (const m of noiDung.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)\((?:(?!\bCREATE\s)[\s\S])*?\bAS\s+\$(\w*)\$([\s\S]*?)\$\3\$/gu,
    )) {
      const schema = m[1] ?? "public";
      than.set(schema === "public" ? m[2]! : `${schema}.${m[2]!}`, m[4]!);
    }
  }
  return than;
}

/** Tệp mã không phải TypeScript đã theo dõi — `.sql` ngoài `db/migrations`, `.js`/`.mjs`/`.cjs` — cũng chạm được bảng. */
const TEP_KHAC: Readonly<Record<string, string>> = {
  "tools/do-lich-su-gia/gieo.sql": "GHI — công cụ đo hiệu năng (T5 ⑷), chỉ chạy bằng `psql` trên CSDL THỬ",
};

describe("[INV-L5] bảng bản rõ — mọi chỗ chạm có tên", () => {
  it("[INV-L5] tệp TypeScript sản xuất có câu SQL chạm `rfq_unsealed_bids` đúng bằng danh sách", () => {
    const tep = [...new Set(moiCauSql().filter((c) => BANG.test(c.sql)).map((c) => c.tep))].sort();
    expect(tep, "tệp mới chạm bảng bản rõ: đọc lịch sử thì gọi `public.quan_sat_gia`, không thì thêm một dòng CÓ LÝ DO vào TEP_TS").toEqual(
      Object.keys(TEP_TS).sort(),
    );
  });

  it("[INV-L5] `anh-xa.ts` chỉ hỏi SỰ TỒN TẠI — không câu nào của nó đọc `payload`", () => {
    const cau = moiCauSql().filter((c) => c.tep === "packages/du-lieu-nen/src/anh-xa.ts" && BANG.test(c.sql));
    expect(cau.length).toBeGreaterThan(0);
    for (const c of cau) expect(c.sql, `${c.tep}:${String(c.dong)}`).not.toMatch(/\bpayload\b/u);
  });

  it("[INV-L5] hàm SQL có thân chạm `rfq_unsealed_bids` đúng bằng danh sách", () => {
    const ham = [...thanCuoiCung()].filter(([, t]) => BANG.test(t)).map(([ten]) => ten).sort();
    expect(ham, "hàm mới chạm bảng bản rõ: thêm một dòng CÓ LÝ DO vào HAM_SQL").toEqual(Object.keys(HAM_SQL).sort());
  });

  it("[INV-L5] không migration nào dùng thân `BEGIN ATOMIC` — bộ đọc thân ở trên không thấy nó (lượt soi §S1.9101)", () => {
    const co = tepMigration().filter((t) =>
      /\bBEGIN\s+ATOMIC\b/iu.test(readFileSync(`${THU_MUC_MIGRATION}${t}`, "utf8").replace(/--[^\n]*/gu, "")),
    );
    expect(co).toEqual([]);
  });

  it("[INV-L5] tệp mã khác TypeScript chạm `rfq_unsealed_bids` đúng bằng danh sách", () => {
    const goc = fileURLToPath(new URL("../../", import.meta.url));
    const tep = execFileSync("git", ["ls-files"], { cwd: goc, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/u)
      .filter((d) => /\.(?:sql|js|mjs|cjs)$/u.test(d) && !d.startsWith("db/migrations/") && !d.includes("node_modules/"))
      .filter((d) => BANG.test(readFileSync(`${goc}${d}`, "utf8")))
      .sort();
    expect(tep, "tệp mới chạm bảng bản rõ: thêm một dòng CÓ LÝ DO vào TEP_KHAC").toEqual(Object.keys(TEP_KHAC).sort());
  });

  it("[INV-L5] bộ đọc thân hàm tự kiểm: thân cuối cùng thắng, dấu `$…$` nào cũng đọc được", () => {
    const than = thanCuoiCung();
    // `quy_doi_don_vi` định nghĩa ở `079`, `083` rồi `9501`: bản cuối gọi lõi, không còn tự đọc `item_uom_conversions`.
    expect(than.get("quy_doi_don_vi")).toMatch(/quy_doi_da_giai/u);
    expect(than.get("quy_doi_don_vi")).not.toMatch(/item_uom_conversions/u);
    // Đối chứng dương: thân viết bằng dấu `$tbm$` (`004`) cũng đọc được — không chỉ `$ham$`.
    expect(than.get("audit_compute_hash")).toMatch(/sha256/u);
    expect(than.size).toBeGreaterThan(100);
  });
});
