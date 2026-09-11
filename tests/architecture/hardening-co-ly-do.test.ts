// ==============================================================================================
// [INV-H19] [S1.49 / khoản nợ 93] MỌI PHÁN XÉT CỦA HARDENING PHẢI CÓ MỘT DÒNG LÝ DO TRONG MỘT ADR
//
// Lượt soi ngang 33b đề xuất cổng này; ba vòng sau (S1.46–S1.48) thêm ba mục phán xét mới mà ADR-036 §2 —
// chính tệp TỰ KHAI là *nguồn* của mọi cơ chế — không có hàng nào cho chúng, và không phép kiểm nào bắt
// (lượt soi ngang 40b #1). Một mục chặn được deploy của cả cụm mà không ai ghi VÌ SAO nó tồn tại là đúng
// thứ ADR-029 gọi là lời khai thiu, theo chiều ngược: mã có mà tài liệu không.
//
// CHỦ THỂ SUY TỪ TÍNH CHẤT, KHÔNG TỪ TÊN (ADR-028 §2⑴, ADR-035) — và lượt soi 41 CAO-1 bác bản đầu của
// vòng này vì nó lấy chủ thể là HÌNH DẠNG CHUỖI của ô hậu điều kiện, tức chỉ đổi trục của "theo tên":
// hai mục phán xét thật viết THẲNG SQL ở hậu điều kiện (`schema trùng tên một vai…`, `không có overload
// lạ…`) nằm ngoài tầm, trong khi bốn hàng TỰ CHỮA bị đếm nhầm là phán xét. Tính chất THẬT, đọc được ngay
// trong tệp và đúng ADR-028 §2⑵, là **ô CÂU SỬA có phải no-op không**: mảng `bang` chia làm hai loại —
// tự chữa (câu sửa là một câu DDL đơn điệu) và phán xét (`SELECT 1`, cố ý không sửa gì).
//
// BỐN VẾ:
//   ⑴ Bộ đọc dựng lại `bang` thành N hàng × 6 ô (tôn trọng dollar-quote lồng và chú thích `--`). Parse
//     hỏng ⇒ NÉM, không xanh trên một tập rỗng — vế chống mù SUY TỪ CHÍNH TỆP, không ghim tay (40b #2,
//     lượt soi 41 NẶNG-3: sàn `= 24` của bản đầu không đóng được đúng ca "mọc thêm một mục khuôn khác").
//   ⑵ Mục PHÁN XÉT := ô câu sửa là một literal no-op đóng (`SELECT 1`, `DO $x$ BEGIN END $x$`). Một
//     literal ngắn không mang từ khoá DDL nào là khuôn no-op LẠ ⇒ NÉM.
//   ⑶ KHOÁ TRA CỨU của mỗi mục phán xét: tên hằng ở ô hậu điều kiện nếu có, ngược lại TÊN MỤC (ô đầu).
//     Mọi hằng đứng ở ô hậu điều kiện của một hàng TỰ CHỮA cũng bị đòi: chúng phán xét thật, chỉ kèm
//     thêm một lượt sửa đơn điệu (`CAU_NEO_SAI`, `CAU_TRIGGER_CHAN_SAI`, `CAU_BANG_SO_VAT_LY`,
//     `CAU_QUYEN_BANG_SO_MO_TA`).
//   ⑷ Hai phán xét sống NGOÀI `bang` (lượt soi 41 CAO-2): BƯỚC 3 chạy `CAU_MEMBERSHIP_LA` và
//     `CAU_ADMIN_LA` thẳng vào `loi_gom` trước vòng lặp. Chủ thể của bản đầu loại chúng theo cấu tạo.
//
// VÙNG TRA CỨU là ba khối ADR có thẩm quyền — ADR-028 (ranh giới tự chữa/phán xét), ADR-036 (danh mục
// cơ chế), ADR-037 (danh tính) — SAU KHI bỏ mọi đoạn đã gạch `~~…~~`. Cả tệp `DECISIONS.md` thì rỗng
// ruột: lượt soi 41 NẶNG-1 chỉ ra `CAU_DOC_VONG` chỉ được nhắc như một dấu ngoặc phụ, và một tên bỏ
// trong §5 *"Thứ ADR này KHÔNG làm"* cũng qua. So bằng biên từ, không `includes`: `CAU_POLICY_SAI_2`
// không được làm `CAU_POLICY_SAI` xanh giả.
//
// CHỖ THU HẸP, NÓI RA (lượt soi 41 NẶNG-4): trục là TÍNH CHẤT nên chín hằng `CAU_*` chỉ dùng ở ô CÂU
// SỬA hay làm câu phụ trợ — `CAU_QUYEN_BANG_SO_SAI`, `CAU_NEO_SUA`, `CAU_TRIGGER_LA`, `CAU_RULE_LA`,
// `CAU_CAP_PHU_CHUOI`, `CAU_TEN_GUC_DU_AN_DOC`, `CAU_KHOA_NGOAI_TOI_TENANT`, `CAU_QUAN_HE_TRUNG_TEN`,
// `CAU_HINH_DANG_CHINH_TAC` khi nó đứng ở ô khác — KHÔNG bị cổng đòi dù mang hậu tố `_SAI`. Hình dạng
// mã ghi ở khoản nợ 93 (`^  (CAU_[A-Z_0-9]+_SAI) constant text :=`) đòi chúng; bản này cố ý không, vì
// một hằng chỉ dùng để SỬA không chặn deploy của ai.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
/** Chuẩn hoá EOL: checkout Windows cho CRLF, mọi khuôn dưới đây viết theo LF (khoản nợ 10). */
const docTep = (duong: string): string => readFileSync(join(GOC, duong), "utf8").replace(/\r\n/gu, "\n");

const HARDENING = docTep("db/migrations/hardening.always.sql");
const QUYET_DINH = docTep("docs/DECISIONS.md");

/** Mốc một hàng của `bang`: mảng con thụt đúng bốn dấu cách. `bang` là mảng DUY NHẤT của tệp dùng khuôn này. */
const RE_MOC_HANG = /\n {4}ARRAY\[/gu;
/** Khuôn NO-OP ĐÓNG của ô câu sửa — ADR-028 §2⑵ "phán xét thì không sửa gì". */
const RE_NOOP = /^(?:SELECT 1|DO \$[A-Za-z_0-9]*\$ ?BEGIN END ?\$[A-Za-z_0-9]*\$)$/u;
/** Từ khoá của một câu sửa THẬT — dùng để phân biệt "tự chữa" với "khuôn no-op lạ". */
const RE_CO_DDL =
  /\b(CREATE|ALTER|DROP|REVOKE|GRANT|COMMENT|SET|RESET|INSERT|UPDATE|DELETE|TRUNCATE|SECURITY|EXECUTE|FOR |LOOP|IF )/u;
/**
 * Hằng được nối vào ô hậu điều kiện Ở VỊ TRÍ MỘT QUAN HỆ — `FROM ($q$ || X || $q$)` hay
 * `EXISTS (SELECT 1 $q$ || X || $q$)`. Đó là tính chất của một CÂU liệt kê vi phạm.
 *
 * Phân biệt với hằng đứng ở vị trí GIÁ TRỊ SO SÁNH (`prosrc = $q$ || THAN_PHAN_TACH || $q$`): mười
 * hằng `THAN_*` / `CHU_KY_*` / `TEN_COT_GHI` / `KHACH_KHONG_PHIEN_LIT` là VĂN BẢN CHUẨN để so, không
 * phải một cơ chế cần lý do trong ADR-036 — bản đầu của vế này quét mọi định danh và đòi cả chúng.
 */
const RE_HANG_QUAN_HE =
  /(?:FROM|EXISTS)\s*\(\s*(?:SELECT 1\s*)?\$q\$\s*\|\|\s*([A-Z][A-Z_0-9]{4,})\s*\|\|/gu;
/**
 * Phán xét sống NGOÀI `bang`: BƯỚC 3 chạy một câu thẳng rồi đẩy kết quả vào `loi_gom` — tức CHẶN
 * DEPLOY (lượt soi 41 CAO-2). Vế `loi_gom` là bắt buộc: `CAU_CAP_PHU_CHUOI` (phân tách nhiệm vụ D3)
 * đi cùng khuôn `INTO con_sot` nhưng chỉ `RAISE WARNING` — cố ý không chặn deploy, nên nó không phải
 * một phán xét và cổng không đòi dòng lý do cho nó.
 */
const RE_NGOAI_BANG =
  /EXECUTE [\s\S]{0,300}?\|\| (CAU_[A-Z_0-9]+) \|\|[\s\S]{0,300}?INTO con_sot;[\s\S]{0,600}?(?:loi_gom := loi_gom|RAISE EXCEPTION USING ERRCODE)/gu;
// [S1.57 / khoản nợ 100 — lượt soi 50 NHẸ-3] Vế `RAISE EXCEPTION USING ERRCODE`: lượt `truoc_vong` chạy một câu thẳng rồi
// RAISE — chặn deploy TRƯỚC vòng đánh số, cũng ngoài `bang`, và không qua `loi_gom`. Bản đầu của vòng chỉ đòi vế `loi_gom`
// nên phán xét duy nhất của hardening chạy trước vòng không bị cổng đòi dòng lý do nào. (E3) `RAISE WARNING` vẫn đứng ngoài.

/**
 * Tách một hàng của `bang` thành các Ô: dấu phẩy ở mức ngoặc 0, ngoài mọi dollar-quote.
 *
 * Tôn trọng `$q$…$q$` LẪN các thẻ lồng (`$tg$`, `$vl$`, `$ac$`, `$than$`, `$fn56$`…) và bỏ chú thích
 * `--` tới hết dòng — hai thứ mà một phép `split(",")` sẽ vấp ngay ở hàng đầu tiên.
 */
export function tachO(hang: string): readonly string[] {
  const o: string[] = [];
  let cur = "";
  let i = 0;
  let sau = 0;
  let the: string | null = null;
  while (i < hang.length) {
    if (the !== null) {
      if (hang.startsWith(the, i)) {
        cur += the;
        i += the.length;
        the = null;
      } else {
        cur += hang[i];
        i += 1;
      }
      continue;
    }
    const mo = /^\$[A-Za-z_0-9]*\$/u.exec(hang.slice(i));
    if (mo) {
      the = mo[0];
      cur += mo[0];
      i += mo[0].length;
      continue;
    }
    const c = hang[i]!;
    if (c === "-" && hang[i + 1] === "-") {
      const j = hang.indexOf("\n", i);
      i = j < 0 ? hang.length : j;
      continue;
    }
    if (c === "(" || c === "[") sau += 1;
    else if (c === ")" || c === "]") sau -= 1;
    else if (c === "," && sau === 0) {
      o.push(cur.trim());
      cur = "";
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim() !== "") o.push(cur.trim());
  return o;
}

/** Nội dung của một ô là literal `$q$…$q$` ĐƠN, hay `null` nếu ô là biểu thức nối/lời gọi hàm. */
function literalDon(o: string): string | null {
  if (!o.startsWith("$q$") || !o.endsWith("$q$")) return null;
  const trong = o.slice(3, -3);
  return trong.includes("$q$") ? null : trong.trim();
}

export interface HangBang {
  readonly o: readonly string[];
  readonly ten: string;
  readonly phanXet: boolean;
}

/** Dựng lại `bang` thành N hàng × 6 ô. NÉM ở mọi chỗ không parse được — mù thì phải ồn ào. */
export function docBang(hardening: string): readonly HangBang[] {
  const moc = [...hardening.matchAll(RE_MOC_HANG)].map((m) => m.index);
  if (moc.length < 100) {
    throw new Error(`bộ đọc chỉ thấy ${moc.length} hàng của \`bang\`, phải ≥ 100 — khuôn mảng đã đổi, cổng đang MÙ`);
  }
  const hang: HangBang[] = [];
  for (const [k, a] of moc.entries()) {
    const b = moc[k + 1] ?? hardening.length;
    const than = hardening.slice(a + "\n    ARRAY[".length, b);
    const dong = than.indexOf("\n    ]");
    if (dong < 0) throw new Error(`hàng \`bang\` thứ ${k + 1} không có dấu đóng \`]\` thụt bốn dấu cách`);
    const o = tachO(than.slice(0, dong));
    if (o.length !== 6) {
      throw new Error(`hàng \`bang\` thứ ${k + 1} tách ra ${o.length} ô, phải là 6 — bộ đọc ô hỏng: ${o[0]?.slice(0, 60)}`);
    }
    const ten = literalDon(o[0]!);
    if (ten === null || ten === "") throw new Error(`hàng \`bang\` thứ ${k + 1} không đọc được TÊN MỤC`);
    const cauSua = literalDon(o[2]!);
    let phanXet = false;
    if (cauSua !== null) {
      const gon = cauSua.replaceAll(/\s+/gu, " ").trim();
      if (RE_NOOP.test(gon)) phanXet = true;
      else if (!RE_CO_DDL.test(gon)) {
        throw new Error(`hàng "${ten}": câu sửa "${gon.slice(0, 60)}" không phải khuôn no-op đã biết mà cũng không mang câu DDL nào — khuôn LẠ, phải khai trước khi cổng tin`);
      }
    }
    hang.push({ o, ten, phanXet });
  }
  return hang;
}

/** Ba khối ADR có thẩm quyền, bỏ mọi đoạn đã gạch — đó mới là "dòng lý do". */
export function vungTraCuu(quyetDinh: string): string {
  const dong = quyetDinh.split("\n");
  const khoi = (tieuDe: string): string => {
    const dau = dong.findIndex((l) => l.startsWith(tieuDe));
    if (dau < 0) throw new Error(`không tìm thấy "${tieuDe}" trong docs/DECISIONS.md`);
    const sau = dong.findIndex((l, i) => i > dau && l.startsWith("## "));
    return dong.slice(dau, sau < 0 ? dong.length : sau).join("\n");
  };
  return ["## ADR-028", "## ADR-036", "## ADR-037"].map(khoi).join("\n").replaceAll(/~~[\s\S]*?~~/gu, "");
}

export function viPhamPhanXetKhongCoLyDo(hardening: string, quyetDinh: string): readonly string[] {
  const vung = vungTraCuu(quyetDinh);
  // Định danh hằng so bằng BIÊN TỪ (`CAU_POLICY_SAI_2` không được làm `CAU_POLICY_SAI` xanh giả);
  // TÊN MỤC là câu tiếng Việt mang `(`, `)`, `"`, `$` — ký tự đặc biệt của regex — nên so nguyên văn.
  const laDinhDanh = (t: string): boolean => /^[A-Z][A-Z_0-9]+$/u.test(t);
  const coTen = (t: string): boolean =>
    laDinhDanh(t) ? new RegExp(`(?<![A-Za-z_0-9])${t}(?![A-Za-z_0-9])`, "u").test(vung) : vung.includes(t);
  const loi: string[] = [];
  const hang = docBang(hardening);
  const canTra = new Map<string, string>(); // khoá tra cứu -> mô tả chỗ dùng

  for (const h of hang) {
    const dinhDanh = [...h.o[3]!.matchAll(RE_HANG_QUAN_HE)].map((m) => m[1]!);
    for (const d of dinhDanh) canTra.set(d, `hằng ở ô hậu điều kiện của mục "${h.ten.slice(0, 60)}"`);
    if (h.phanXet && dinhDanh.length === 0) {
      canTra.set(h.ten, "TÊN MỤC của một mục phán xét viết thẳng SQL ở hậu điều kiện");
    }
  }
  for (const m of hardening.matchAll(RE_NGOAI_BANG)) {
    canTra.set(m[1]!, "phán xét chạy thẳng ngoài mảng `bang` — vào `loi_gom` ở BƯỚC 3, hay RAISE … ERRCODE ở lượt `truoc_vong`");
  }
  if (canTra.size < 20) {
    loi.push(`chỉ thu được ${canTra.size} khoá tra cứu, phải ≥ 20 — bộ đọc ô hay khuôn hậu điều kiện đã đổi, cổng đang MÙ`);
  }
  for (const [t, cho] of [...canTra].sort(([a], [b]) => a.localeCompare(b))) {
    if (!coTen(t)) {
      loi.push(
        `"${t.slice(0, 70)}" (${cho}) KHÔNG có dòng lý do trong ADR-028 / ADR-036 / ADR-037 (bỏ vùng đã gạch) — ` +
          "mỗi phán xét chặn được deploy phải có một dòng lý do đọc được — khoản nợ 93",
      );
    }
  }
  return loi;
}

// ==============================================================================================

describe("[INV-H19] hardening: mọi phán xét có một dòng lý do trong ADR", () => {
  it("[S1.49 / khoản nợ 93] mọi mục PHÁN XÉT và mọi hằng ở ô hậu điều kiện đều có dòng lý do", () => {
    expect(viPhamPhanXetKhongCoLyDo(HARDENING, QUYET_DINH)).toEqual([]);
  });

  it("[S1.49] bộ đọc dựng lại `bang` đúng hình dạng: mỗi hàng 6 ô, và số mục phán xét khớp số câu sửa no-op của tệp", () => {
    const hang = docBang(HARDENING);
    expect(hang.length).toBeGreaterThanOrEqual(100);
    for (const h of hang) expect(h.o, `mục "${h.ten.slice(0, 40)}"`).toHaveLength(6);
    // Đối chứng độc lập với bộ đọc ô: đếm thẳng số literal no-op trong tệp.
    const soNoop =
      HARDENING.split("$q$SELECT 1$q$").length - 1 + HARDENING.split("$q$DO $hd$ BEGIN END $hd$$q$").length - 1;
    expect(hang.filter((h) => h.phanXet)).toHaveLength(soNoop);
    expect(soNoop).toBeGreaterThanOrEqual(20);
  });

  it("[S1.49 / lượt soi 41 CAO-1] đột biến — một mục PHÁN XÉT MỚI viết thẳng SQL ở hậu điều kiện, không có dòng lý do, thì ĐỎ", () => {
    // Đúng ca đã sinh ra khoản nợ 93: hardening MỌC THÊM một mục. Bản đầu của vòng xanh giả ở đây.
    const neo = "\n    ARRAY[\n      $q$schema app_private tồn tại$q$,";
    expect(HARDENING.split(neo)).toHaveLength(2);
    const them =
      "\n    ARRAY[\n      $q$zz mục phán xét mới chưa ai ghi lý do$q$,\n      $q$true$q$,\n      $q$SELECT 1$q$,\n" +
      "      $q$NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'zz')$q$,\n      $q$'zz'$q$,\n      $q$SUPERUSER$q$\n    ],";
    // Hàm thay thế, KHÔNG chuỗi: `them` chứa `$q$'zz'$q$` và `$'` là mẫu thay thế của JS ("phần sau
    // match") — cùng cái bẫy đã đo ở S1.44. Bản chuỗi cắt mất một ô và bộ đọc thấy 9 ô.
    const hong = HARDENING.replace(neo, () => them + neo);
    expect(viPhamPhanXetKhongCoLyDo(hong, QUYET_DINH)).toEqual([
      expect.stringContaining("zz mục phán xét mới chưa ai ghi lý do"),
    ]);
  });

  it("[S1.49 / lượt soi 41 CAO-2] đột biến — phán xét NGOÀI `bang` (loi_gom ở BƯỚC 3) mất dòng lý do thì ĐỎ", () => {
    const hong = QUYET_DINH.replace("CAU_MEMBERSHIP_LA", "CAU_MEMBERSHIP_XX");
    expect(hong).not.toBe(QUYET_DINH);
    expect(viPhamPhanXetKhongCoLyDo(HARDENING, hong)).toEqual([
      expect.stringContaining("CAU_MEMBERSHIP_LA"),
    ]);
  });

  it("[S1.57 / khoản nợ 100 — lượt soi 50 NHẸ-3] đột biến — phán xét NGOÀI `bang` chặn bằng RAISE … ERRCODE (lượt truoc_vong) mất dòng lý do thì ĐỎ", () => {
    const hong = QUYET_DINH.replaceAll("CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI", "CAU_PHU_LENH_VAI_CHAY_MIGRATION_XX");
    expect(hong).not.toBe(QUYET_DINH);
    expect(viPhamPhanXetKhongCoLyDo(HARDENING, hong)).toEqual([
      expect.stringContaining("CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI"),
    ]);
  });

  it("[S1.49 / lượt soi 41 NẶNG-1] đột biến — dòng lý do bị GẠCH `~~…~~` thì ĐỎ, và tên chỉ nằm ngoài ba khối ADR cũng ĐỎ", () => {
    const dong = QUYET_DINH.split("\n").find((l) => l.includes("CAU_NEO_SAI"))!;
    const gach = QUYET_DINH.replace(dong, `~~${dong}~~`);
    expect(viPhamPhanXetKhongCoLyDo(HARDENING, gach)).toEqual([expect.stringContaining("CAU_NEO_SAI")]);
  });

  it("[S1.49 / lượt soi 41 NẶNG-3] đột biến — khuôn của `bang` đổi (bộ đọc thấy 0 hàng) thì NÉM, không xanh", () => {
    const hong = HARDENING.replaceAll("\n    ARRAY[", "\n     ARRAY[");
    expect(hong).not.toBe(HARDENING);
    expect(() => viPhamPhanXetKhongCoLyDo(hong, QUYET_DINH)).toThrow(/cổng đang MÙ/u);
  });

  it("[S1.49] đột biến — một câu sửa mang khuôn NO-OP LẠ thì NÉM, không được lặng lẽ xếp vào tự chữa", () => {
    const hong = HARDENING.replace("$q$SELECT 1$q$,", "$q$SELECT 2$q$,");
    expect(hong).not.toBe(HARDENING);
    expect(() => docBang(hong)).toThrow(/khuôn LẠ/u);
  });
});
