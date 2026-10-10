// ==============================================================================================
// [INV-L5] [S1.235 / S4.4a] MỌI CHỖ CHẠM BẢNG BẢN RÕ `rfq_unsealed_bids` ĐƯỢC LIỆT KÊ BẰNG TÊN
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
// ra ở ADR-136.
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
  // [S1.256 / S4.5b] Mốc mở giá của gói X — đúng định nghĩa `moc_goi` của `quan_sat_gia`; giá đi qua `quan_sat_gia` (dưới).
  "packages/du-lieu-nen/src/benchmark-goi.ts": "MỐC — `min(unsealed_at)` của gói đang xét, không đọc `payload`",
  // [rà soát S4.5c1] Lần mở thầu commit sau lúc giao dịch đọc bắt đầu thì phép tính bây giờ không thấy báo giá của nó ⇒ `THU_LAI`.
  "packages/danh-gia/src/doc-benchmark.ts": "MỐC — có phong bì của lần mở thầu mới nhất mở lúc `≥ now()` không (`THU_LAI`), không đọc `payload`",
};

/** Hàm SQL có thân chạm bảng bản rõ. */
const HAM_SQL: Readonly<Record<string, string>> = {
  anh_xa_kiem_luat: "TỒN TẠI — L13: ánh xạ trên gói đã có bản rõ đòi lý do (`089`)",
  // [S1.280 / S3.5a / K7] Số tiền và tiền tệ của báo giá ĐƯỢC CHỌN để phân bậc trao thầu — đọc qua `bid_so_tien`/`bid_currency`, không
  // trả dòng nào ra ngoài; người gọi là các hàm theo bậc của `113` dưới `app_api`, vốn đã đọc được bảng (góc B⑧).
  award_so_tien_trao: "ĐỌC — số tiền và tiền tệ của báo giá được chọn, để phân bậc trao thầu (K7, `113`)",
  // [S1.288 / S4.7c1 / L8] Bốn ô khai của báo giá ĐƯỢC ĐỀ XUẤT — qua đúng hai bộ đọc của lượt chấm (`bid_so_tien`, `bid_so_ngay`) —
  // chụp vào `rfq_award_cam_ket` dưới `app_api` lúc đề xuất; đọc ra chỉ qua `docCamKetTraoThau` dưới cổng `bid.view`.
  award_dien_cam_ket: "ĐỌC — bốn ô khai TCO của báo giá được đề xuất, chụp vào cam kết (L8, `121_cam_ket_trao_thau`)",
  goi_y_kiem_luat: "TỒN TẠI — gợi ý trên gói đã có bản rõ chỉ do người giữ `item.manage` ghi (`089`)",
  // [S1.9101 / J1] Luồng có phiên bản lớn hơn ĐÃ MỞ chưa — chỉ hỏi tồn tại, không đọc `payload`; chép luật một-hàng-một-luồng của `docBaoGia`.
  luot_cham_kiem_phien_ban: "TỒN TẠI — hàng chấm chỉ nhận phiên bản mới nhất đã mở của luồng (J1, `9501_hang_cham_phien_ban_moi_nhat`)",
  quan_sat_gia: "ĐỌC — lịch sử giá xuyên gói, vị từ `gia_da_lo` và mốc trong thân (`096`)",
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
    expect(tep, "tệp mới chạm bảng bản rõ: đọc lịch sử thì gọi `docLichSuGia` (cổng `bid.view`, hàng sổ), không thì thêm một dòng CÓ LÝ DO vào TEP_TS").toEqual(
      Object.keys(TEP_TS).sort(),
    );
  });

  it("[INV-L6] [S1.251 / lượt soi T2] chỉ `docLichSuGia` gọi `quan_sat_gia`/`gia_da_lo` từ mã TypeScript sản xuất — đường đọc DUY NHẤT, sau cổng `bid.view` và kèm hàng sổ", () => {
    // `app_api` có EXECUTE trên hai hàm (`096`), và `quan_sat_gia(now(), NULL)` trả giá của CẢ tổ chức. Một bộ đọc thứ hai — benchmark
    // của S4.5, một báo cáo — gọi hàm mà không có cổng thì mọi lớp khác vẫn xanh: lớp liệt kê ở trên chỉ thấy tên BẢNG bản rõ.
    const HAM = /\b(?:quan_sat_gia|gia_da_lo)\s*\(/u;
    const tep = [...new Set(moiCauSql().filter((c) => HAM.test(c.sql)).map((c) => c.tep))].sort();
    expect(tep, "tệp mới gọi hàm lịch sử giá: đi qua `docLichSuGia`, hay thêm tệp vào đây kèm cổng và hàng sổ của nó").toEqual([
      // [S1.256 / S4.5b] Benchmark của MỘT gói — không cổng trong tệp: hai chỗ gọi có cổng, ghim ở ca ngay dưới.
      "packages/du-lieu-nen/src/benchmark-goi.ts",
      "packages/du-lieu-nen/src/lich-su-gia.ts",
    ]);
  });

  it("[INV-L6] [S1.256 / S4.5b] `tinhBenchmarkGoi` chỉ được dùng ở hai chỗ có cổng — lượt chấm (`evaluation.perform`, không trả con số) và `docBenchmark` (`bid.view`, hàng sổ); `ghiBenchmarkLuotCham` chỉ ở lượt chấm", () => {
    // [lượt soi §S1.256 — GHI CHÚ-8] Quét theo KÝ HIỆU, không theo mẫu lời gọi: `import { tinhBenchmarkGoi as t }` hay
    // `const f = tinhBenchmarkGoi` vượt được một mẫu `tinhBenchmarkGoi(` — nhưng không vượt được việc tên ấy xuất hiện trong tệp.
    const goc = fileURLToPath(new URL("../../", import.meta.url));
    const tepSanXuat = execFileSync("git", ["ls-files"], { cwd: goc, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/u)
      .filter((t) => /^(packages|apps|tools)\/.*\/src\/.*\.[cm]?[jt]s$/u.test(t) && !t.includes(".test."));
    const nhac = (ten: string): string[] =>
      tepSanXuat.filter((t) => new RegExp(`\\b${ten}\\b`, "u").test(readFileSync(`${goc}${t}`, "utf8"))).sort();
    const NOI_DINH_NGHIA = ["packages/du-lieu-nen/src/benchmark-goi.ts", "packages/du-lieu-nen/src/index.ts"];
    expect(nhac("tinhBenchmarkGoi")).toEqual(
      [...NOI_DINH_NGHIA, "packages/danh-gia/src/doc-benchmark.ts", "packages/danh-gia/src/luot-danh-gia.ts"].sort(),
    );
    expect(nhac("ghiBenchmarkLuotCham")).toEqual([...NOI_DINH_NGHIA, "packages/danh-gia/src/luot-danh-gia.ts"].sort());
    // [S1.260 / S4.5c1] Bản lưu của bảng so sánh và *Xem dải* một dòng: chỗ dùng DUY NHẤT là `doc-benchmark.ts` — hai hàm đọc có cổng
    // `bid.view` và hàng sổ của riêng mình.
    expect(nhac("ghiBanLuuBenchmark")).toEqual([...NOI_DINH_NGHIA, "packages/danh-gia/src/doc-benchmark.ts"].sort());
    expect(nhac("tinhDaiDong")).toEqual([...NOI_DINH_NGHIA, "packages/danh-gia/src/doc-benchmark.ts"].sort());
    // [S1.262 / S4.5c2] Một lần đọc `quan_sat_gia` dùng chung: `tinhDaiDong` (cùng tệp định nghĩa) và lớp dữ liệu nền của bộ bằng
    // chứng — rồi lớp ấy chỉ `dungBoBangChung` gọi (sau cổng `audit.read` + `bid.view` của `xuatBoBangChung`, hay CLI vận hành).
    expect(nhac("docQuanSatTaiMoc")).toEqual([...NOI_DINH_NGHIA, "packages/danh-gia/src/lop-du-lieu-nen.ts"].sort());
    expect(nhac("docLopDuLieuNen")).toEqual(["packages/danh-gia/src/bo-bang-chung.ts", "packages/danh-gia/src/lop-du-lieu-nen.ts"]);
    const docBm = readFileSync(`${goc}packages/danh-gia/src/doc-benchmark.ts`, "utf8");
    expect(docBm.match(/permission: PERMISSIONS\.BID_VIEW/gu)?.length).toBe(2);
    expect(docBm).toMatch(/action: "BENCHMARK_READ"/u);
    expect(docBm).toMatch(/action: "BENCHMARK_BAND_READ"/u);
  });

  it.each(["packages/du-lieu-nen/src/anh-xa.ts", "packages/du-lieu-nen/src/benchmark-goi.ts"])(
    "[INV-L5] `%s` không câu nào chạm bảng bản rõ mà đọc `payload`",
    (tepTs) => {
      const cau = moiCauSql().filter((c) => c.tep === tepTs && BANG.test(c.sql));
      expect(cau.length).toBeGreaterThan(0);
      for (const c of cau) expect(c.sql, `${c.tep}:${String(c.dong)}`).not.toMatch(/\bpayload\b/u);
    },
  );

  it("[INV-L5] hàm SQL có thân chạm `rfq_unsealed_bids` đúng bằng danh sách", () => {
    const ham = [...thanCuoiCung()].filter(([, t]) => BANG.test(t)).map(([ten]) => ten).sort();
    expect(ham, "hàm mới chạm bảng bản rõ: thêm một dòng CÓ LÝ DO vào HAM_SQL").toEqual(Object.keys(HAM_SQL).sort());
  });

  it("[INV-L5] không migration nào dùng thân `BEGIN ATOMIC` — bộ đọc thân ở trên không thấy nó (lượt soi §S1.235)", () => {
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
    // `quy_doi_don_vi` định nghĩa ở `079`, `083` rồi `096`: bản cuối gọi lõi, không còn tự đọc `item_uom_conversions`.
    expect(than.get("quy_doi_don_vi")).toMatch(/quy_doi_da_giai/u);
    expect(than.get("quy_doi_don_vi")).not.toMatch(/item_uom_conversions/u);
    // Đối chứng dương: thân viết bằng dấu `$tbm$` (`004`) cũng đọc được — không chỉ `$ham$`.
    expect(than.get("audit_compute_hash")).toMatch(/sha256/u);
    expect(than.size).toBeGreaterThan(100);
  });
});
