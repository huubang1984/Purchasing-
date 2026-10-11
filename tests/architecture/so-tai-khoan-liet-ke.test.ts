// ==============================================================================================
// [S1.287 / S3.7a1 / ADR-081] SỐ TÀI KHOẢN CỦA HỒ SƠ PASSPORT — RANH GIỚI CỘT Ở TẦNG MÃ
//
// Spec S3 §4.8: số tài khoản ngân hàng có *"quyền theo CỘT, không vào log, không vào bộ bằng chứng"*. Chủ dự án chốt (2026-10-08, sau
// lượt soi hình dạng): bảo vệ bằng RANH GIỚI CỘT Ở TẦNG MÃ, khuôn `don_gia` (`bang-ngoai-liet-ke.test.ts`), không mã hoá. `app_api` có
// `SELECT` mức bảng — mọi người đọc đều chạy dưới vai ấy, nên REVOKE cột thì không ai đọc được, và SECURITY DEFINER bị hardening (C)
// cấm. Ranh giới thật là lớp này:
//   ⑴ tệp TypeScript sản xuất có câu SQL chạm `supplier_passport_versions` đúng bằng danh sách;
//   ⑵ `so_tai_khoan` chỉ được ĐỌC ở `packages/supplier/src/passport.ts`, đúng BA câu — bốn số cuối cho phiên Passport, số đầy đủ của
//      phiên bản mới nhất sau `supplier.qualify`, bốn số cuối và cờ *đổi tài khoản* của lịch sử; không câu nào đọc cả hàng; câu INSERT
//      mang cột trong danh sách cột, không sau `RETURNING`;
//   ⑶ không migration nào ngoài tệp dựng bảng và tệp ghim nhắc tên cột — nên không view, hàm hay trigger nào đọc nó;
//   ⑷ bộ bằng chứng (`bo-bang-chung.ts`) không chạm bảng Passport; payload sổ của hai tệp Passport không mang khoá số tài khoản.
// Vẫn là lớp chữ: một câu SQL dựng động vượt qua nó. Rủi ro còn lại nói ra ở ADR-159: log tham số của Postgres và bản sao lưu.
// ==============================================================================================
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moiCauSql } from "./qt3-doc-sql.js";

const BANG = /\bsupplier_passport_versions\b/iu;
const COT = /\bso_tai_khoan\b/iu;
const GOC = fileURLToPath(new URL("../../", import.meta.url));
const THU_MUC_MIGRATION = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** Tệp TypeScript sản xuất chạm bảng phiên bản hồ sơ — và vì sao. */
const TEP_TS: Readonly<Record<string, string>> = {
  "packages/supplier/src/passport.ts":
    "GHI phiên bản (phiên Passport); ĐỌC của nhà cung cấp (bốn số cuối) và của bên mua sau `supplier.qualify` (số đầy đủ, hàng sổ)",
  // [S1.293 / S3.7a2 / K8b] Thẩm định đọc thứ tự phiên bản (mới nhất hay không) — không đọc cột hồ sơ nào.
  "packages/supplier/src/tham-dinh.ts": "ĐỌC `thu_tu` của phiên bản được thẩm định và của phiên bản mới nhất",
  // [S1.293 / S3.7a2] Fixture test: GHI một phiên bản thô trên pool chủ cụm — số tài khoản trong danh sách cột, không sau RETURNING.
  "packages/test-support/src/passport-tho.ts": "GHI phiên bản thô cho fixture thẩm định (pool chủ cụm, một giao dịch)",
};
/** Tệp có câu INSERT mang `so_tai_khoan` trong danh sách cột — đường nộp thật và fixture thô. */
const TEP_GHI_SO = ["packages/supplier/src/passport.ts", "packages/test-support/src/passport-tho.ts"];
const TEP_DOC_SO = "packages/supplier/src/passport.ts";
const SO_CAU_DOC_SO = 3;

/** Mọi cách một câu chạm bảng ĐỌC được số tài khoản. Trả lý do (rỗng = sạch). */
function docSo(sql: string): string[] {
  const ly: string[] = [];
  const chen = /^\s*INSERT\s+INTO\s+public\.supplier_passport_versions\s*\(([^)]*)\)/iu.exec(sql);
  const [dau, duoi] = chen === null ? ["", sql] : [chen[0], sql.slice(chen[0].length)];
  const [than, traVe] = duoi.split(/\bRETURNING\b/iu, 2) as [string, string | undefined];
  if (COT.test(than)) ly.push("đọc so_tai_khoan");
  if (traVe !== undefined && (COT.test(traVe) || /\*/u.test(traVe))) ly.push("RETURNING mang so_tai_khoan");
  const boDem = (dau + than).replace(/\bcount\s*\(\s*\*\s*\)/giu, "count()").replace(/OPERATOR\(pg_catalog\.\*\)/gu, "OPERATOR(nhan)");
  if (/\*/u.test(boDem)) ly.push("đọc cả hàng (*)");
  if (/\b(?:to_jsonb?|row_to_json|jsonb?_agg|jsonb?_build_(?:object|array)|array_agg|hstore|json_populate_record)\s*\(/iu.test(than)) {
    ly.push("hàm đóng gói hàng");
  }
  for (const m of than.matchAll(/\bsupplier_passport_versions\s+(?:AS\s+)?([a-z_]\w*)/giu)) {
    const b = m[1]!;
    if (/^(?:WHERE|JOIN|ON|LEFT|INNER|CROSS|GROUP|ORDER|LIMIT|UNION)$/iu.test(b)) continue;
    const thoi = new RegExp(String.raw`(?:\b${b}\s*::|[(,]\s*${b}\s*[),]|SELECT\s+${b}\s+FROM)`, "iu");
    if (thoi.test(than)) ly.push(`bí danh ${b} dùng như cả hàng`);
  }
  return ly;
}

/**
 * Câu có đọc số ĐẦY ĐỦ không: mỗi lần nhắc `v.so_tai_khoan` phải là bốn số cuối (`right(…, 4)`) hay một phép so với phiên bản trước
 * (`… IS DISTINCT FROM pg_catalog.lag(…)`, đối số của `lag`) — mọi lần nhắc khác là đọc số đầy đủ.
 */
function docDayDu(sql: string): boolean {
  for (const m of sql.matchAll(/v\.so_tai_khoan/gu)) {
    const truoc = sql.slice(0, m.index).replace(/\s+$/u, "");
    const sau = sql.slice(m.index + m[0].length);
    if (/pg_catalog\.right\($/u.test(truoc) && /^\s*,\s*4\s*\)/u.test(sau)) continue;
    if (/pg_catalog\.lag\($/u.test(truoc)) continue;
    if (/coalesce\($/u.test(truoc) && /^\s+IS DISTINCT FROM pg_catalog\.lag\(v\.so_tai_khoan\)/u.test(sau)) continue;
    return true;
  }
  return false;
}

describe("[S1.287 / S3.7a1] số tài khoản Passport — mọi chỗ chạm có tên", () => {
  it("tệp TypeScript sản xuất có câu SQL chạm `supplier_passport_versions` đúng bằng danh sách", () => {
    const tep = [...new Set(moiCauSql().filter((c) => BANG.test(c.sql)).map((c) => c.tep))].sort();
    expect(tep, "tệp mới chạm bảng phiên bản Passport: thêm một dòng CÓ LÝ DO vào TEP_TS").toEqual(Object.keys(TEP_TS).sort());
  });

  it("`so_tai_khoan` chỉ được ĐỌC ở `passport.ts`, đúng ba câu; không câu nào đọc cả hàng; INSERT không trả số về", () => {
    const cau = moiCauSql().filter((c) => BANG.test(c.sql));
    expect(cau.length, "bộ đọc mù: không thấy câu nào chạm bảng").toBeGreaterThanOrEqual(4);
    expect(cau.filter((c) => c.tep !== TEP_DOC_SO).flatMap((c) => docSo(c.sql).map((ly) => `${c.tep}:${String(c.dong)} ${ly}`))).toEqual([]);
    const boDoc = cau.filter((c) => c.tep === TEP_DOC_SO);
    expect(
      boDoc.flatMap((c) =>
        docSo(c.sql)
          .filter((ly) => ly !== "đọc so_tai_khoan")
          .map((ly) => `${c.tep}:${String(c.dong)} ${ly}`),
      ),
    ).toEqual([]);
    expect(boDoc.filter((c) => docSo(c.sql).includes("đọc so_tai_khoan")).length, "số câu đọc số tài khoản").toBe(SO_CAU_DOC_SO);
    // Hai trong ba câu chỉ đọc BỐN SỐ CUỐI (và phép so lag của lịch sử); đúng MỘT câu đọc số đầy đủ.
    expect(boDoc.filter((c) => docDayDu(c.sql)).length, "câu đọc số ĐẦY ĐỦ").toBe(1);
    // Chống rỗng ruột: câu INSERT CÓ mang `so_tai_khoan` trong danh sách cột.
    expect(
      cau
        .filter((c) => /^\s*INSERT/iu.test(c.sql) && COT.test(c.sql))
        .map((c) => c.tep)
        .sort(),
    ).toEqual(TEP_GHI_SO);
  });

  it("không migration nào ngoài tệp dựng bảng và tệp ghim nhắc `so_tai_khoan` — không view, hàm hay trigger nào đọc nó", () => {
    const nhac: string[] = [];
    for (const ten of readdirSync(THU_MUC_MIGRATION).filter((t) => t.endsWith(".sql")).sort()) {
      const sach = readFileSync(`${THU_MUC_MIGRATION}${ten}`, "utf8")
        .split(/\r?\n/u)
        .map((d) => d.replace(/--.*$/u, ""))
        .join("\n");
      if (COT.test(sach)) nhac.push(ten);
    }
    expect(nhac.filter((t) => t !== "hardening.always.sql").length, "đúng một tệp dựng bảng nhắc cột").toBe(1);
    const dung = nhac.find((t) => t !== "hardening.always.sql")!;
    expect(dung).toMatch(/_passport_nha_cung_cap\.sql$/u);
    // Trong tệp dựng bảng: cột chỉ ở định nghĩa cột, CHECK hình dạng và GRANT INSERT — không ở thân hàm nào.
    const than = readFileSync(`${THU_MUC_MIGRATION}${dung}`, "utf8").replace(/--[^\n]*/gu, "");
    const dong = than.split(/\r?\n/u).filter((d) => COT.test(d)).map((d) => d.trim());
    expect(dong.every((d) => /^so_tai_khoan\s+text NOT NULL,$|^CONSTRAINT supplier_passport_versions_so_tai_khoan CHECK|^GRANT INSERT \(|so_tai_khoan,$/u.test(d)), dong.join("\n")).toBe(true);
    for (const ham of than.matchAll(/AS \$ham\$([\s\S]*?)\$ham\$/gu)) expect(COT.test(ham[1]!), "thân hàm đọc so_tai_khoan").toBe(false);
  });

  it("bộ bằng chứng không chạm bảng Passport; payload sổ của hai tệp Passport không mang khoá số tài khoản", () => {
    const boBangChung = readFileSync(`${GOC}packages/danh-gia/src/bo-bang-chung.ts`, "utf8");
    expect(/\b(?:supplier_passport_\w+|passport_sessions|passport_otp_challenges)\b/u.test(boBangChung)).toBe(false);
    for (const tep of ["packages/supplier/src/passport.ts", "packages/invitation/src/passport.ts"]) {
      const ma = readFileSync(`${GOC}${tep}`, "utf8");
      const payload = [...ma.matchAll(/payload:\s*\{([^}]*)\}/gu)].map((m) => m[1]!);
      expect(payload.length, `${tep}: bộ dò payload mù`).toBeGreaterThan(0);
      expect(payload.filter((p) => /soTaiKhoan|so_tai_khoan|bank|account/iu.test(p)), tep).toEqual([]);
    }
  });

  it("ĐỐI CHỨNG của bộ dò: mỗi cách đọc số không viết tên cột đều bị nêu; câu INSERT thật thì không", () => {
    const V = "public.supplier_passport_versions";
    for (const [sql, ly] of [
      [`SELECT v.* FROM ${V} v`, "đọc cả hàng (*)"],
      [`SELECT pg_catalog.to_jsonb(v) FROM ${V} v`, "hàm đóng gói hàng"],
      [`SELECT v::text FROM ${V} v`, "bí danh v dùng như cả hàng"],
      [`SELECT v.SO_TAI_KHOAN FROM ${V} v`, "đọc so_tai_khoan"],
      [`INSERT INTO ${V} (org_id, so_tai_khoan) VALUES ($1, $2) RETURNING so_tai_khoan`, "RETURNING mang so_tai_khoan"],
    ] as const) {
      expect(docSo(sql), sql).toContain(ly);
    }
    expect(docSo(`INSERT INTO ${V} (org_id, so_tai_khoan) VALUES ($1, $2) RETURNING thu_tu, created_at`)).toEqual([]);
    // Bộ phân biệt bốn-số-cuối / đầy đủ: hai dạng được phép thì không, mọi dạng khác thì có.
    expect(docDayDu(`SELECT pg_catalog.right(v.so_tai_khoan, 4) FROM ${V} v`)).toBe(false);
    expect(docDayDu(`SELECT coalesce(v.so_tai_khoan IS DISTINCT FROM pg_catalog.lag(v.so_tai_khoan) OVER (ORDER BY v.thu_tu), false) FROM ${V} v`)).toBe(false);
    expect(docDayDu(`SELECT pg_catalog.right(v.so_tai_khoan, 12) FROM ${V} v`)).toBe(true);
    expect(docDayDu(`SELECT coalesce(v.so_tai_khoan, '') FROM ${V} v`)).toBe(true);
    expect(docDayDu(`SELECT v.thu_tu, v.so_tai_khoan FROM ${V} v`)).toBe(true);
  });
});
