// ==============================================================================================
// [S1.210 / khoản 117 / ADR-124] THÔNG ĐIỆP CỦA HARDENING NÊU TÊN VÀ VÂN TAY — KHÔNG NỐI THÂN HÀM,
// ĐỊNH NGHĨA TRIGGER, GIÁ TRỊ `proconfig` HAY `SQLERRM` VÀO Ô MÔ TẢ, CỘT `mo_ta`, RAISE HAY BẢN GOM
//
// Chuẩn S1.51 ⑷: thông điệp deploy là bề mặt rò dữ liệu — tên thì được, giá trị thì không. S1.66 vá bốn mục canh
// policy (`db/thong-diep-khong-gia-tri.int.test.ts`); cùng lớp, đếm trên `hardening.always.sql` ở đầu vòng này: 94 ô
// mô tả nối `prosrc` đã chuẩn hoá khoảng trắng, 94 nối giá trị `proconfig`, 71 nối `pg_get_triggerdef`, 22 RAISE/bản gom
// nối `SQLERRM`. Đo (thân khoản 117, PostgreSQL 16): `ALTER FUNCTION public.app_current_org_id() SET app.org_id = '<uuid>'`
// rồi `migrate()` ⇒ WARNING của lượt sửa mang `config=app.org_id=<uuid>`; thân hàm mang hằng UUID ⇒ WARNING mang nguyên
// thân; một điều kiện ném 22P02 ⇒ WARNING mang `invalid input syntax for type uuid: "<giá trị>"`.
//
// Chủ dự án chốt nhánh ⑴ (2026-09-30): in DẤU VÂN TAY thay cho thân hàm và định nghĩa trigger, `proconfig` chỉ in TÊN GUC,
// `SQLERRM` thay bằng `SQLSTATE` — và cổng này cấm nối trở lại. Cách tra thân hàm từ vân tay: ADR-124 và chú thích đầu
// khối `bang` của hardening.
//
// PHÉP QUÉT là hàm thuần trên văn bản (`quetHardening`), BỐN BỀ MẶT:
//   ⑴ Ô MÔ TẢ (ô thứ 5) của MỌI hàng `bang` — tách hàng/ô bằng bộ đọc tôn trọng dollar-quote, chuỗi và chú thích; hàng
//      không đúng 6 ô hay cú pháp lạ ⇒ NÉM, không xanh trên tập rỗng (cùng kỷ luật `hardening-co-ly-do.test.ts`).
//   ⑵ CỘT `mo_ta` của mọi `SELECT … AS mo_ta` — các mục phán xét ngoài `bang` in mô tả qua cột ấy.
//   ⑶ MỌI câu `RAISE WARNING|EXCEPTION|NOTICE|…`, kể cả trong các khối DO lồng của ô câu sửa và trong thân hàm ghim.
//   ⑷ MỌI `loi_gom := loi_gom || format(…)` — bản gom của BƯỚC 3.
// Trên BỀ MẶT MÃ (chuỗi thành `'LIT'`, chú thích bỏ, mọi thẻ dollar-quote gỡ), sau khi GỠ đúng ba khuôn được phép
// (`VAN_TAY_PROSRC`, `VAN_TAY_TRIGGER`, `TEN_PROCONFIG` — so nguyên văn, không nới), còn lại một tên trong danh sách
// cấm là ĐỎ. Cộng một vế TOÀN TỆP: `SQLERRM`, `MESSAGE_TEXT`, `PG_EXCEPTION_*` không được có mặt ngoài chú thích — đường
// lấy lại thông điệp lỗi qua `GET STACKED DIAGNOSTICS` cũng đóng. Cột điều kiện / hậu điều kiện (ô 2, 4) CỐ Ý không quét:
// chúng SO SÁNH thân hàm, proconfig, pg_get_triggerdef với bản chuẩn — đó là phép phán xét, không phải thông điệp.
//
// ⑸ [S1.244 / khoản 288] BÍ DANH. Bốn bề mặt trên đọc TÊN, không đọc luồng dữ liệu: mục khoản 259 đọc `pg_get_triggerdef`
// qua bí danh `dinh_nghia` của hằng `CAU_TRIGGER_LA_DU_AN` — khai ở nơi khác, nối vào ô mô tả và RAISE bằng `t.dinh_nghia`,
// `r.dinh_nghia` — nên cổng XANH trên một mục in nguyên định nghĩa trigger (đo trước của khoản 288). Nay phép quét dựng thêm
// tập BÍ DANH MANG GIÁ TRỊ trên toàn tệp: mọi tên cột mà một truy vấn con, một CTE hay một danh sách VALUES phơi ra — mục
// select có `AS <tên>` hay bí danh ngầm, nhánh UNION/INTERSECT/EXCEPT theo vị trí, danh sách cột `t(c1, …)` và `WITH t(c1, …)`
// theo vị trí — mà biểu thức (sau khi gỡ ba khuôn được phép) nhắc một tên cấm hay một bí danh mang giá trị khác (điểm bất
// động). Bề mặt để dò là mã CỦA HARDENING: mảnh `$q$` và khối `DO $…$`; thân hàm (`$ham$`, `$fn…$`) và bản chuẩn (`$than$`,
// `$def$`) là literal — bí danh trong thân một hàm ghim thuộc về hàm, không phải cột mà hardening đọc rồi in. Một tham chiếu cột
// tới bí danh mang giá trị trong bốn bề mặt ⑴–⑷ là ĐỎ: `… nối <bí danh> — bí danh mang <tên cấm gốc>`. Bí danh mang giá trị mà
// không đi tới bề mặt nào thì được (hôm nay: `van_ban` ← `pp.prosrc`, chỉ vào `regexp_matches` để rút TÊN GUC).
//
// CHỖ THU HẸP, NÓI RA (⑸): tên bí danh là toàn cục trong tệp — một cột trùng tên ở truy vấn khác cũng bị coi là mang giá trị
// (chiều kêu nhầm; cửa ra là đổi tên); tên cột MẶC ĐỊNH của một mục không bí danh (`left(…)`, `btrim(…)`, `?column?`), cột của
// hàm trả bảng trong FROM (`unnest`, `regexp_matches`), biến PL/pgSQL (`SELECT … INTO v`, `v := …`), ép cả hàng (`t::text`,
// `row_to_json(t)`) và cột catalog thô (`tgqual::text`) nằm ngoài tầm ⑸ — đo bằng văn bản mẫu ở lượt soi đối kháng của §S1.244
// (cổng xanh trên cả sáu kênh; hardening hôm nay không in qua kênh nào): khoản 301.
//
// CHỖ THU HẸP, NÓI RA: một cột mô tả không tên `mo_ta` nằm ngoài tầm ⑵; các cờ `provolatile`/`prosecdef`/`tgenabled`,
// `pg_get_function_identity_arguments` (kiểu tham số — tên) và ba GUC log ở (E4) cố ý được phép; thân hàm ghim trong
// hardening bị quét ở ⑶ như mã của chính tệp (hôm nay: không thân nào nối tên cấm). Danh sách cấm là ĐÚNG SÁU TÊN của khoản
// 117 — không `pg_get_constraintdef`/`pg_get_ruledef`/`pg_get_viewdef`/`prosqlbody`: phép quét đọc cả ô nên một vị từ LỌC
// (hàng khoản 105 so `pg_get_constraintdef` trong ô mô tả) sẽ bị nhầm là nối; mở rộng đòi một bộ đọc biết đâu là biểu thức
// chuỗi — ghi ở biên bản §S1.210 mục 7.
//
// VĂN BẢN MẪU ĐỘT BIẾN ĐỎ (từng vế một fixture ở cuối tệp): trả một ô mô tả về
//   `'… — prosrc hiện tại: ' || btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))`
// ⇒ `hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối prosrc`; trả `config=' || coalesce(array_to_string(p.proconfig,…`
// ⇒ `… nối proconfig` (kể cả khi nhãn vẫn ghi "chỉ tên GUC" — cổng đọc mã, không đọc nhãn); trả `':def=' || pg_get_triggerdef(t.oid)`
// ⇒ `… nối pg_get_triggerdef`; trả `SQLERRM` vào một RAISE ⇒ `RAISE WARNING (câu 1) nối SQLERRM` VÀ vế toàn tệp đỏ.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HARDENING = readFileSync(new URL("../../db/migrations/hardening.always.sql", import.meta.url), "utf8").replace(/\r\n/gu, "\n");

/** Mốc mở của `bang` — chuỗi DUY NHẤT trong tệp (cùng mốc mà `hardening-suy-tu-tinh-chat.int.test.ts` tiêm hàng thử). */
const MOC_BANG = "  bang text[][] := ARRAY[\n";

/**
 * BA KHUÔN ĐƯỢC PHÉP, viết trên BỀ MẶT MÃ (chuỗi đã thành 'LIT', khoảng trắng gộp một). So NGUYÊN VĂN, không nới: một biến
 * thể (đổi bí danh, bỏ `pg_catalog.`, băm thân chưa chuẩn hoá, cắt ít hơn 16 ký tự) là một khuôn khác và bị quét như nối
 * trần — cửa ra là đổi khuôn ở hardening VÀ ở đây trong cùng một commit, có lý do.
 */
export const VAN_TAY_PROSRC =
  "left(encode(pg_catalog.sha256(pg_catalog.convert_to(btrim(regexp_replace(p.prosrc, 'LIT', 'LIT', 'LIT')), 'LIT')), 'LIT'), 16)";
export const VAN_TAY_TRIGGER = "left(encode(pg_catalog.sha256(pg_catalog.convert_to(pg_get_triggerdef(t.oid), 'LIT')), 'LIT'), 16)";
export const TEN_PROCONFIG =
  "coalesce((SELECT string_agg(split_part(c.x, 'LIT', 1), 'LIT' ORDER BY c.k) FROM unnest(p.proconfig) WITH ORDINALITY AS c(x, k)), 'LIT')";

/**
 * Tên CẤM trong một bề mặt thông điệp: thân hàm, định nghĩa trigger/hàm, biểu thức, cấu hình hàm, thông điệp lỗi — đúng sáu
 * tên của khoản 117. Phép quét đọc CẢ Ô (kể cả một vị từ lọc trong ô mô tả), nên danh sách CỐ Ý không mở rộng sang các
 * `pg_get_*def` khác: hàng khoản 105 so `pg_get_constraintdef(c.oid) <> ck.dinh_nghia` ngay trong ô mô tả — một phép so, không
 * in — và một cổng không phân biệt được lọc với nối thì không được cấm tên ấy. Sáu tên dưới đây hôm nay không có phép lọc hợp
 * lệ nào trong ô mô tả, cột mo_ta, RAISE hay bản gom.
 */
const RE_CAM = /\b(prosrc|proconfig|pg_get_triggerdef|pg_get_expr|pg_get_functiondef|SQLERRM)\b/gu;
/** Đường lấy lại THÔNG ĐIỆP LỖI — cấm ở mọi vị trí ngoài chú thích, không riêng chỗ nối. */
const RE_CAM_TOAN_TEP = /\b(SQLERRM|MESSAGE_TEXT|PG_EXCEPTION_DETAIL|PG_EXCEPTION_HINT|PG_EXCEPTION_CONTEXT)\b/gu;
const RE_THE = /^\$[A-Za-z_][A-Za-z_0-9]*\$/u;
const RE_RAISE = /\bRAISE (WARNING|EXCEPTION|NOTICE|INFO|LOG|DEBUG)\b([^;]*);/gu;
const RE_GOM = /\bloi_gom := loi_gom \|\| format\(([^;]*)\);/gu;
const RE_MO_TA = /\bAS mo_ta\b/gu;
/** [S1.244 / khoản 288] Sàn chống mù của vế ⑸ — số ràng buộc bí danh đọc được trên tệp thật (đo ở đầu vòng S1.244). */
const SAN_RANG_BUOC = 1000;

/** Chỉ số NGAY SAU nháy đóng của chuỗi mở ở `i` (`''` là nháy thoát; `E'…'` thoát thêm bằng `\`). NÉM nếu không đóng. */
function cuoiChuoi(sql: string, i: number): number {
  const eString = sql[i - 1] === "E" && !/[A-Za-z0-9_]/u.test(sql[i - 2] ?? " ");
  let j = i + 1;
  for (;;) {
    if (j >= sql.length) throw new Error(`chuỗi mở ở ${i} không đóng`);
    const c = sql[j];
    if (eString && c === "\\") {
      j += 2;
      continue;
    }
    if (c === "'") {
      if (sql[j + 1] === "'") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
}

/**
 * BỀ MẶT MÃ của một đoạn SQL/PL-pgSQL: chú thích `--` bỏ, chuỗi thành `'LIT'`, MỌI thẻ dollar-quote gỡ (nội dung giữ —
 * khối DO lồng trong ô câu sửa, hằng `$q$…$q$`, thân chuẩn `$than$…$than$` đều là MÃ với phép quét này), khoảng trắng gộp.
 */
export function beMatMa(sql: string): string {
  let ra = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j;
      continue;
    }
    if (c === "'") {
      ra += "'LIT'";
      i = cuoiChuoi(sql, i);
      continue;
    }
    if (c === "$") {
      const the = RE_THE.exec(sql.slice(i, i + 64));
      if (the) {
        ra += " ";
        i += the[0].length;
        continue;
      }
    }
    ra += c;
    i += 1;
  }
  return ra.replace(/\s+/gu, " ");
}

interface HangBang {
  readonly ten: string;
  readonly o: readonly string[];
}

/**
 * Dựng lại `bang` thành N hàng × 6 ô trên VĂN BẢN GỐC: `$q$…$q$` và mọi dollar-quote là nguyên văn (dấu phẩy, ngoặc bên trong
 * không tính), chú thích `--` bỏ, dấu phẩy ở mức ngoặc 0 là biên ô. Sai hình dạng ở bất kỳ đâu ⇒ NÉM.
 */
export function tachHang(sql: string): HangBang[] {
  const bat = sql.indexOf(MOC_BANG);
  if (bat < 0) throw new Error("không thấy mốc `bang text[][] := ARRAY[`");
  if (sql.indexOf(MOC_BANG, bat + 1) >= 0) throw new Error("mốc `bang` phải là duy nhất");
  let i = bat + MOC_BANG.length;
  const boQuaTrangVaChuThich = (): void => {
    for (;;) {
      while (i < sql.length && /\s/u.test(sql[i]!)) i += 1;
      if (sql.startsWith("--", i)) {
        const j = sql.indexOf("\n", i);
        i = j < 0 ? sql.length : j;
        continue;
      }
      return;
    }
  };
  const hang: HangBang[] = [];
  for (;;) {
    boQuaTrangVaChuThich();
    if (sql[i] === "]") break;
    if (!sql.startsWith("ARRAY[", i)) throw new Error(`cú pháp lạ trong bang ở ${i}: ${JSON.stringify(sql.slice(i, i + 40))}`);
    i += "ARRAY[".length;
    const o: string[] = [];
    let cur = "";
    let sau = 0;
    for (;;) {
      if (i >= sql.length) throw new Error("hàng của bang không đóng");
      const c = sql[i]!;
      if (c === "-" && sql[i + 1] === "-") {
        const j = sql.indexOf("\n", i);
        i = j < 0 ? sql.length : j;
        continue;
      }
      if (c === "'") {
        const j = cuoiChuoi(sql, i);
        cur += sql.slice(i, j);
        i = j;
        continue;
      }
      if (c === "$") {
        const the = RE_THE.exec(sql.slice(i, i + 64));
        if (the) {
          const dong = sql.indexOf(the[0], i + the[0].length);
          if (dong < 0) throw new Error(`dollar-quote ${the[0]} mở ở ${i} không đóng`);
          cur += sql.slice(i, dong + the[0].length);
          i = dong + the[0].length;
          continue;
        }
      }
      if (c === "(" || c === "[") sau += 1;
      else if (c === ")") sau -= 1;
      else if (c === "]") {
        if (sau === 0) {
          o.push(cur);
          i += 1;
          break;
        }
        sau -= 1;
      } else if (c === "," && sau === 0) {
        o.push(cur);
        cur = "";
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
    }
    if (o.length !== 6) throw new Error(`hàng ${JSON.stringify(o[0]?.trim().slice(0, 60))}: ${o.length} ô, phải là 6`);
    const ten = /^\s*\$q\$([\s\S]*?)\$q\$\s*$/u.exec(o[0]!)?.[1];
    if (ten === undefined) throw new Error(`ô tên của hàng không phải một literal $q$…$q$: ${JSON.stringify(o[0]!.slice(0, 60))}`);
    hang.push({ ten, o });
    boQuaTrangVaChuThich();
    if (sql[i] === ",") {
      i += 1;
      continue;
    }
    if (sql[i] === "]") break;
    throw new Error(`cú pháp lạ sau một hàng của bang ở ${i}: ${JSON.stringify(sql.slice(i, i + 40))}`);
  }
  return hang;
}

/** Biểu thức của cột `mo_ta`: từ `SELECT` gần nhất ở cùng mức ngoặc (đi lùi từ `AS mo_ta`) tới `AS mo_ta`. */
function bieuThucMoTa(ma: string, viTri: number): string {
  let sau = 0;
  for (let i = viTri - 1; i >= 0; i -= 1) {
    const c = ma[i];
    if (c === ")") sau += 1;
    else if (c === "(") {
      if (sau === 0) throw new Error(`AS mo_ta ở ${viTri}: gặp "(" trước SELECT`);
      sau -= 1;
    } else if (
      sau === 0 &&
      ma.startsWith("SELECT", i) &&
      !/[A-Za-z0-9_]/u.test(ma[i - 1] ?? " ") &&
      !/[A-Za-z0-9_]/u.test(ma[i + 6] ?? " ")
    ) {
      return ma.slice(i + 6, viTri);
    }
  }
  throw new Error(`AS mo_ta ở ${viTri}: không thấy SELECT`);
}

const goKhuonDuocPhep = (ma: string): string =>
  ma.split(VAN_TAY_PROSRC).join(" ").split(VAN_TAY_TRIGGER).join(" ").split(TEN_PROCONFIG).join(" ");
const tenCam = (ma: string): string[] => [...new Set([...goKhuonDuocPhep(ma).matchAll(RE_CAM)].map((m) => m[1]!))];

// ---------------------------------------------------------------------------------------------
// ⑸ [S1.244 / khoản 288] BÍ DANH MANG GIÁ TRỊ — bộ đọc select-list tối giản trên bề mặt mã
// ---------------------------------------------------------------------------------------------

/** Sáu tên cấm của khoản 117 — cùng tập `RE_CAM`, so từng token (phân biệt hoa thường như `RE_CAM`). */
const TEN_CAM: ReadonlySet<string> = new Set(["prosrc", "proconfig", "pg_get_triggerdef", "pg_get_expr", "pg_get_functiondef", "SQLERRM"]);

/** Thẻ dollar-quote đứng ngay sau `DO` (bỏ khoảng trắng) — thân khối DO là mã của hardening. */
function sauTuDo(s: string): boolean {
  let j = s.length - 1;
  while (j >= 0 && /\s/u.test(s[j]!)) j -= 1;
  return j >= 1 && /[Oo]/u.test(s[j]!) && /[Dd]/u.test(s[j - 1]!) && !/[A-Za-z0-9_]/u.test(s[j - 2] ?? " ");
}

/**
 * BỀ MẶT MÃ ĐỂ DÒ BÍ DANH: như `beMatMa`, nhưng chỉ mã CỦA HARDENING còn là mã — `$q$` (mảnh câu hardening dựng) và thân khối
 * `DO $…$` (thẻ đứng ngay sau `DO`, tới thẻ đóng cùng tên). Mọi dollar-quote khác — thân hàm `$ham$`/`$fn…$`, bản chuẩn
 * `$than$`/`$def$`, chữ ký `$ck$` — thành một literal `'LIT'`: bí danh trong thân một hàm ghim là mã của HÀM, không phải một
 * cột mà hardening đọc rồi in.
 */
export function beMatMaBiDanh(sql: string): string {
  let ra = "";
  let i = 0;
  const doDangMo = new Set<string>();
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j;
      continue;
    }
    if (c === "'") {
      ra += "'LIT'";
      i = cuoiChuoi(sql, i);
      continue;
    }
    if (c === "$") {
      const the = RE_THE.exec(sql.slice(i, i + 64))?.[0];
      if (the !== undefined) {
        if (the === "$q$" || doDangMo.delete(the)) {
          ra += " ";
          i += the.length;
          continue;
        }
        if (sauTuDo(ra)) {
          doDangMo.add(the);
          ra += " ";
          i += the.length;
          continue;
        }
        const dong = sql.indexOf(the, i + the.length);
        if (dong < 0) throw new Error(`dollar-quote ${the} mở ở ${i} không đóng`);
        ra += " 'LIT' ";
        i = dong + the.length;
        continue;
      }
    }
    ra += c;
    i += 1;
  }
  return ra.replace(/\s+/gu, " ");
}

interface Token {
  readonly t: string;
  /** Mức ngoặc: của `(`/`[` là mức TRƯỚC khi mở, của `)`/`]` là mức SAU khi đóng — cặp khớp có cùng mức. */
  readonly d: number;
}

const RE_TOKEN = /'LIT'|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z_0-9$]*|\d+(?:\.\d+)?|::|:=|[<>=!~^&|#@%*+/?-]+|[()[\],;.:]/gu;

function tachToken(ma: string): Token[] {
  const ra: Token[] = [];
  let d = 0;
  for (const m of ma.matchAll(RE_TOKEN)) {
    const t = m[0];
    if (t === "(" || t === "[") {
      ra.push({ t, d });
      d += 1;
    } else if (t === ")" || t === "]") {
      d -= 1;
      ra.push({ t, d });
    } else ra.push({ t, d });
  }
  return ra;
}

const laTen = (t: string): boolean => /^[A-Za-z_][A-Za-z_0-9$]*$/u.test(t) || t.startsWith('"');
/** Tên như PostgreSQL hiểu: trần thì hạ thường, trong nháy kép thì giữ nguyên. */
const chuanHoaTen = (t: string): string => (t.startsWith('"') ? t.slice(1, -1).replaceAll('""', '"') : t.toLowerCase());

/** Từ khoá không bao giờ là bí danh ngầm, và không đứng trước bí danh ngầm như cuối một biểu thức (trừ END/NULL/TRUE/FALSE). */
const TU_KHOA: ReadonlySet<string> = new Set(
  (
    "select from into where group having window order limit offset fetch union intersect except loop then for as on join left " +
    "right full inner outer cross lateral and or not is null true false case when else end distinct all in exists between like " +
    "ilike similar using returning values with recursive over filter within asc desc nulls first last collate at zone escape " +
    "array row by to do if begin declare raise execute perform return language create replace function trigger table insert " +
    "update delete set grant revoke precision varying"
  ).split(" "),
);
/** Từ khoá kết thúc select-list ở cùng mức ngoặc. */
const DUNG_SELECT: ReadonlySet<string> = new Set(
  "from into where group having window order limit offset fetch union intersect except loop then for returning on".split(" "),
);
const NOI_NHANH: ReadonlySet<string> = new Set(["union", "intersect", "except"]);

/** Select-list của `SELECT` ở chỉ số `k`: các mục (tách phẩy cùng mức) và chỉ số token kết thúc. */
function danhSachChon(tok: readonly Token[], k: number): { readonly muc: readonly (readonly Token[])[]; readonly ket: number } {
  const d = tok[k]!.d;
  let j = k + 1;
  if (/^(distinct|all)$/iu.test(tok[j]?.t ?? "")) {
    j += 1;
    if (/^on$/iu.test(tok[j]?.t ?? "") && tok[j + 1]?.t === "(") {
      const dd = tok[j + 1]!.d;
      j += 2;
      while (j < tok.length && !(tok[j]!.t === ")" && tok[j]!.d === dd)) j += 1;
      j += 1;
    }
  }
  const muc: Token[][] = [];
  let cur: Token[] = [];
  for (; j < tok.length; j += 1) {
    const x = tok[j]!;
    if (x.d < d) break;
    if (x.d === d && (x.t === ";" || DUNG_SELECT.has(x.t.toLowerCase()))) break;
    if (x.d === d && x.t === ",") {
      muc.push(cur);
      cur = [];
      continue;
    }
    cur.push(x);
  }
  if (cur.length > 0) muc.push(cur);
  return { muc, ket: j };
}

/** Chuỗi nhánh `SELECT … UNION [ALL] SELECT …` bắt đầu ở `k`, cùng mức ngoặc: mỗi nhánh một select-list, và chỉ số các SELECT nối. */
function cacNhanh(tok: readonly Token[], k: number): { readonly nhanh: readonly (readonly (readonly Token[])[])[]; readonly noi: readonly number[] } {
  const nhanh: (readonly (readonly Token[])[])[] = [];
  const noi: number[] = [];
  const d = tok[k]!.d;
  const hetCau = (x: Token): boolean => x.d === d && (x.t === ";" || /^(loop|then)$/iu.test(x.t) || NOI_NHANH.has(x.t.toLowerCase()));
  let s = k;
  for (;;) {
    const { muc, ket } = danhSachChon(tok, s);
    nhanh.push(muc);
    // Qua FROM/WHERE/… của nhánh này, cùng mức: UNION/INTERSECT/EXCEPT ⇒ nhánh sau; `;`, LOOP, THEN hay ra khỏi mức ⇒ hết chuỗi.
    let j = ket;
    while (j < tok.length && tok[j]!.d >= d && !hetCau(tok[j]!)) j += 1;
    const x = tok[j];
    if (x === undefined || x.d !== d || !NOI_NHANH.has(x.t.toLowerCase())) break;
    j += 1;
    if (/^(all|distinct)$/iu.test(tok[j]?.t ?? "")) j += 1;
    if (tok[j]?.t.toLowerCase() !== "select" || tok[j]!.d !== d) break;
    noi.push(j);
    s = j;
  }
  return { nhanh, noi };
}

/** Tên cột mà một mục select phơi ra: `AS <tên>`, bí danh ngầm, hay tên cột của một tham chiếu cột trần (`a.b` ⇒ `b`). */
function tenCotCua(muc: readonly Token[]): { readonly ten: string; readonly bieuThuc: readonly Token[] } | null {
  const n = muc.length;
  const cuoi = muc[n - 1];
  if (cuoi === undefined || !laTen(cuoi.t)) return null;
  const d = cuoi.d;
  const truoc = muc[n - 2];
  if (truoc !== undefined && truoc.d === d && /^as$/iu.test(truoc.t)) return { ten: chuanHoaTen(cuoi.t), bieuThuc: muc.slice(0, n - 2) };
  if (truoc === undefined || truoc.t === ".") {
    // Tham chiếu cột trần: `x` hay `a.b.x` — tên cột giữ nguyên qua truy vấn.
    return muc.every((x, i) => (i % 2 === 0 ? laTen(x.t) : x.t === ".")) ? { ten: chuanHoaTen(cuoi.t), bieuThuc: muc } : null;
  }
  // Bí danh ngầm (không AS): mục kết thúc bằng một tên không phải từ khoá, đứng sau cuối một biểu thức — `)`, `]`, literal, số,
  // hay một tên (không phải kiểu nhiều chữ sau `::`, như `::double precision`).
  if (TU_KHOA.has(cuoi.t.toLowerCase()) || truoc.d !== d) return null;
  const cuoiBieuThuc =
    truoc.t === ")" ||
    truoc.t === "]" ||
    truoc.t === "'LIT'" ||
    /^\d/u.test(truoc.t) ||
    /^(end|null|true|false)$/iu.test(truoc.t) ||
    (laTen(truoc.t) && !TU_KHOA.has(truoc.t.toLowerCase()) && muc[n - 3]?.t !== "::");
  return cuoiBieuThuc ? { ten: chuanHoaTen(cuoi.t), bieuThuc: muc.slice(0, n - 1) } : null;
}

interface RangBuoc {
  /** Tên cột (đã chuẩn hoá như PostgreSQL). */
  readonly ten: string;
  /** Các token làm nên giá trị của cột ấy. */
  readonly bieuThuc: readonly Token[];
}

/** Chỉ số `(` khớp với `)` ở `j` (đi lùi). */
function moCua(tok: readonly Token[], j: number): number {
  for (let i = j - 1; i >= 0; i -= 1) if (tok[i]!.t === "(" && tok[i]!.d === tok[j]!.d) return i;
  return -1;
}

/** Danh sách tên trong `( a, b, … )` mở ở `o`; null nếu không đúng hình dạng ấy. Trả kèm chỉ số `)` đóng. */
function danhSachTen(tok: readonly Token[], o: number): { readonly ten: readonly string[]; readonly dong: number } | null {
  if (tok[o]?.t !== "(") return null;
  const ten: string[] = [];
  let j = o + 1;
  for (;;) {
    const x = tok[j];
    if (x === undefined || !laTen(x.t)) return null;
    ten.push(chuanHoaTen(x.t));
    const y = tok[j + 1];
    if (y?.t === ")") return { ten, dong: j + 1 };
    if (y?.t !== ",") return null;
    j += 2;
  }
}

/** Giá trị theo VỊ TRÍ của một truy vấn trong ngoặc mở ở `o`: `SELECT …` (mọi nhánh) hay `VALUES (…), (…)`. */
function giaTriTheoViTri(tok: readonly Token[], o: number): readonly (readonly Token[])[][] {
  const dau = tok[o + 1];
  if (dau?.t.toLowerCase() === "select") return cacNhanh(tok, o + 1).nhanh.map((m) => [...m]);
  if (dau?.t.toLowerCase() !== "values") return [];
  const hang: (readonly Token[])[][] = [];
  let j = o + 2;
  while (tok[j]?.t === "(") {
    const dd = tok[j]!.d;
    const phan: Token[][] = [[]];
    j += 1;
    while (j < tok.length && !(tok[j]!.t === ")" && tok[j]!.d === dd)) {
      if (tok[j]!.t === "," && tok[j]!.d === dd + 1) phan.push([]);
      else phan[phan.length - 1]!.push(tok[j]!);
      j += 1;
    }
    hang.push(phan);
    j += 1;
    if (tok[j]?.t !== ",") break;
    j += 1;
  }
  return hang;
}

/**
 * Mọi RÀNG BUỘC tên cột ← biểu thức trên bề mặt dò bí danh: ⑴ mục select có tên (AS, ngầm, tham chiếu cột trần), với nhánh
 * UNION/INTERSECT/EXCEPT nối vào tên của nhánh đầu theo vị trí; ⑵ danh sách cột `(…) [AS] t(c1, …)` của một truy vấn con hay
 * VALUES, và `WITH [RECURSIVE] t(c1, …) AS (…)` — theo vị trí. `SELECT` trong `GRANT`/`REVOKE`/`FOR SELECT` không phải truy vấn.
 */
export function rangBuocBiDanh(tok: readonly Token[]): RangBuoc[] {
  const ra: RangBuoc[] = [];
  const daNoi = new Set<number>();
  for (let k = 0; k < tok.length; k += 1) {
    if (tok[k]!.t.toLowerCase() !== "select" || daNoi.has(k)) continue;
    if (/^(grant|revoke|for|,)$/iu.test(tok[k - 1]?.t ?? "")) continue;
    const { nhanh, noi } = cacNhanh(tok, k);
    for (const j of noi) daNoi.add(j);
    const ten = nhanh[0]!.map((m) => tenCotCua(m)?.ten);
    for (const muc of nhanh) {
      muc.forEach((m, i) => {
        const t = ten[i];
        if (t !== undefined) ra.push({ ten: t, bieuThuc: tenCotCua(m)?.bieuThuc ?? m });
      });
    }
  }
  for (let j = 0; j < tok.length; j += 1) {
    const x = tok[j]!;
    // ⑵a — `(<truy vấn>) [AS] t(c1, …)`
    if (x.t === ")") {
      let k = j + 1;
      if (/^as$/iu.test(tok[k]?.t ?? "")) k += 1;
      const ds = laTen(tok[k]?.t ?? "") && !TU_KHOA.has(tok[k]!.t.toLowerCase()) ? danhSachTen(tok, k + 1) : null;
      if (ds !== null) {
        for (const hang of giaTriTheoViTri(tok, moCua(tok, j))) {
          hang.forEach((bt, i) => {
            const t = ds.ten[i];
            if (t !== undefined) ra.push({ ten: t, bieuThuc: bt });
          });
        }
      }
    }
    // ⑵b — `WITH [RECURSIVE] t(c1, …) AS (<truy vấn>)` và `, t(c1, …) AS (…)`
    if (laTen(x.t) && !TU_KHOA.has(x.t.toLowerCase()) && /^(with|recursive|,)$/iu.test(tok[j - 1]?.t ?? "")) {
      const ds = danhSachTen(tok, j + 1);
      if (ds !== null && /^as$/iu.test(tok[ds.dong + 1]?.t ?? "") && tok[ds.dong + 2]?.t === "(") {
        for (const hang of giaTriTheoViTri(tok, ds.dong + 2)) {
          hang.forEach((bt, i) => {
            const t = ds.ten[i];
            if (t !== undefined) ra.push({ ten: t, bieuThuc: bt });
          });
        }
      }
    }
  }
  return ra;
}

/** Token ở `i` là THAM CHIẾU CỘT: không là tên bảng/lược đồ (`t.`), tên hàm (`f(`), bí danh vừa khai (`AS t`) hay tên kiểu (`::t`). */
function laThamChieuCot(tok: readonly Token[], i: number): boolean {
  const sau = tok[i + 1]?.t;
  const truoc = tok[i - 1]?.t;
  if (sau === "." || sau === "(") return false;
  return !(truoc !== undefined && (/^as$/iu.test(truoc) || truoc === "::"));
}

/** Tên cấm gốc mà một dãy token mang: một tên cấm, hay một tham chiếu cột tới bí danh đã mang giá trị. */
function nguonGiaTri(tok: readonly Token[], mang: ReadonlyMap<string, string>): string | undefined {
  for (let i = 0; i < tok.length; i += 1) {
    const t = tok[i]!.t;
    if (TEN_CAM.has(t)) return t;
    if (laTen(t)) {
      const goc = mang.get(chuanHoaTen(t));
      if (goc !== undefined && laThamChieuCot(tok, i)) return goc;
    }
  }
  return undefined;
}

/**
 * Tập BÍ DANH MANG GIÁ TRỊ của cả tệp — điểm bất động: một tên cột mang giá trị khi biểu thức của nó (sau khi gỡ ba khuôn được
 * phép) nhắc một tên cấm, hay tham chiếu một cột đã mang giá trị. Trả tên → tên cấm gốc.
 */
export function biDanhMangGiaTri(sql: string): ReadonlyMap<string, string> {
  const rb = rangBuocBiDanh(tachToken(goKhuonDuocPhep(beMatMaBiDanh(sql))));
  const mang = new Map<string, string>();
  for (let doi = true; doi; ) {
    doi = false;
    for (const r of rb) {
      if (mang.has(r.ten)) continue;
      const goc = nguonGiaTri(r.bieuThuc, mang);
      if (goc !== undefined) {
        mang.set(r.ten, goc);
        doi = true;
      }
    }
  }
  return mang;
}

/** Tham chiếu cột tới một bí danh mang giá trị trong một bề mặt thông điệp — `<bí danh> — bí danh mang <tên cấm gốc>`. */
function biDanhTrong(be: string, mang: ReadonlyMap<string, string>): string[] {
  if (mang.size === 0) return [];
  const tok = tachToken(goKhuonDuocPhep(be));
  const ra = new Set<string>();
  tok.forEach((x, i) => {
    // Một tên cấm trần (cột `p.prosrc` đi qua nguyên tên) đã do `tenCam` nêu — không nêu lần hai.
    if (!laTen(x.t) || TEN_CAM.has(x.t)) return;
    const ten = chuanHoaTen(x.t);
    const goc = mang.get(ten);
    if (goc !== undefined && laThamChieuCot(tok, i)) ra.add(`${ten} — bí danh mang ${goc}`);
  });
  return [...ra];
}

/** Danh sách vi phạm — rỗng là xanh. Cú pháp lạ ⇒ NÉM. */
export function quetHardening(sql: string): string[] {
  const loi: string[] = [];
  // ⑸ [S1.244 / khoản 288] Mỗi bề mặt trả cả tên cấm nối thẳng lẫn tham chiếu tới bí danh mang giá trị.
  const mang = biDanhMangGiaTri(sql);
  const noi = (be: string): string[] => [...tenCam(be), ...biDanhTrong(be, mang)];
  for (const h of tachHang(sql)) for (const t of noi(beMatMa(h.o[4]!))) loi.push(`hàng "${h.ten}": ô mô tả nối ${t}`);
  const ma = beMatMa(sql);
  let k = 0;
  for (const m of ma.matchAll(RE_MO_TA)) {
    k += 1;
    for (const t of noi(bieuThucMoTa(ma, m.index))) loi.push(`cột mo_ta (câu ${k}) nối ${t}`);
  }
  k = 0;
  for (const m of ma.matchAll(RE_RAISE)) {
    k += 1;
    for (const t of noi(m[2]!)) loi.push(`RAISE ${m[1]} (câu ${k}) nối ${t}`);
  }
  k = 0;
  for (const m of ma.matchAll(RE_GOM)) {
    k += 1;
    for (const t of noi(m[1]!)) loi.push(`bản gom (câu ${k}) nối ${t}`);
  }
  const dem = new Map<string, number>();
  for (const m of ma.matchAll(RE_CAM_TOAN_TEP)) dem.set(m[1]!, (dem.get(m[1]!) ?? 0) + 1);
  for (const [t, n] of dem) loi.push(`${t} xuất hiện ${n} lần ngoài chú thích — thông điệp lỗi mang giá trị`);
  return loi;
}

/** Số đo chống rỗng ruột: phép quét phải NHÌN THẤY đủ bốn bề mặt và ba khuôn được phép. */
export function thongKe(sql: string): {
  readonly hang: number;
  readonly moTa: number;
  readonly raise: number;
  readonly gom: number;
  readonly vanTayProsrc: number;
  readonly vanTayTrigger: number;
  readonly tenProconfig: number;
  /** [S1.244 / khoản 288] Số ràng buộc tên cột ← biểu thức mà vế ⑸ đọc được trên bề mặt dò bí danh. */
  readonly rangBuoc: number;
  /** [S1.244 / khoản 288] Bí danh mang giá trị (tên → tên cấm gốc) — có mặt nhưng không tới bề mặt nào thì được. */
  readonly biDanhMang: ReadonlyMap<string, string>;
} {
  const hang = tachHang(sql);
  const oMoTa = hang.map((h) => beMatMa(h.o[4]!));
  const dem = (khuon: string): number => oMoTa.reduce((n, o) => n + o.split(khuon).length - 1, 0);
  const ma = beMatMa(sql);
  return {
    hang: hang.length,
    moTa: [...ma.matchAll(RE_MO_TA)].length,
    raise: [...ma.matchAll(RE_RAISE)].length,
    gom: [...ma.matchAll(RE_GOM)].length,
    vanTayProsrc: dem(VAN_TAY_PROSRC),
    vanTayTrigger: dem(VAN_TAY_TRIGGER),
    tenProconfig: dem(TEN_PROCONFIG),
    rangBuoc: rangBuocBiDanh(tachToken(goKhuonDuocPhep(beMatMaBiDanh(sql)))).length,
    biDanhMang: biDanhMangGiaTri(sql),
  };
}

// ---------------------------------------------------------------------------------------------
// Văn bản mẫu — một hàng ghim hàm tối giản, đúng khuôn 6 ô; ô mô tả là tham số.
// ---------------------------------------------------------------------------------------------
const hangMau = (moTa: string, ten = "định nghĩa hàm app_current_org_id()"): string =>
  `    ARRAY[\n      $q$${ten}$q$,\n      $q$true$q$,\n      $q$SELECT 1$q$,\n` +
  `      $q$(SELECT btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) = $than$SELECT 1$than$ AND p.proconfig IS NULL\n` +
  `           FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()'))$q$,\n` +
  `      $q$${moTa}$q$,\n      $q$quyền sở hữu hàm$q$\n    ]`;
const mau = (hang: readonly string[], them = ""): string => `${MOC_BANG}${hang.join(",\n")}\n  ];\n${them}`;
const MO_TA_CU =
  "coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — prosrc hiện tại: ' || btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g'))" +
  " || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(null)') FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()')), 'hàm không tồn tại')";
const MO_TA_MOI =
  "coalesce((SELECT 'thân/thuộc tính hàm khác bản chuẩn — vân tay prosrc hiện tại: '" +
  " || left(encode(pg_catalog.sha256(pg_catalog.convert_to(btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')), 'UTF8')), 'hex'), 16)" +
  " || ' config(chỉ tên GUC)=' || coalesce((SELECT string_agg(split_part(c.x, '=', 1), ',' ORDER BY c.k) FROM unnest(p.proconfig) WITH ORDINALITY AS c(x, k)), '(null)')" +
  " || ' | trigger=' || coalesce((SELECT string_agg(t.tgname || ':enabled=' || t.tgenabled::text || ':vân tay def='" +
  " || left(encode(pg_catalog.sha256(pg_catalog.convert_to(pg_get_triggerdef(t.oid), 'UTF8')), 'hex'), 16), '; ' ORDER BY t.tgname)" +
  " FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal), '(KHÔNG CÓ)')" +
  " FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()')), 'hàm không tồn tại')";

describe("[S1.210 / khoản 117] thông điệp của hardening nêu tên và vân tay, không in giá trị", () => {
  it("hardening.always.sql: không ô mô tả, cột mo_ta, RAISE hay bản gom nào nối prosrc, proconfig trần, pg_get_*def, pg_get_expr hay SQLERRM", () => {
    expect(quetHardening(HARDENING)).toEqual([]);
  });

  it("phép quét không rỗng ruột: thấy đủ hàng của bang (bằng số mốc `ARRAY[` thụt bốn), cột mo_ta, RAISE, bản gom; ba khuôn được phép có mặt", () => {
    const tk = thongKe(HARDENING);
    expect(tk.hang, "bộ đọc hàng không được bỏ sót: số hàng phải bằng số mốc").toBe(HARDENING.match(/\n {4}ARRAY\[/gu)?.length ?? 0);
    expect(tk.hang).toBeGreaterThanOrEqual(150);
    expect(tk.moTa).toBeGreaterThanOrEqual(50);
    expect(tk.raise).toBeGreaterThanOrEqual(30);
    expect(tk.gom).toBeGreaterThanOrEqual(3);
    // Đầu vòng S1.210: 94 / 71 / 94. Sàn "≥" để một hàng ghim mới không làm cổng đỏ vì lý do lạ; về 0 thì phép quét mù.
    expect(tk.vanTayProsrc).toBeGreaterThanOrEqual(90);
    expect(tk.vanTayTrigger).toBeGreaterThanOrEqual(60);
    expect(tk.tenProconfig).toBeGreaterThanOrEqual(90);
    // [S1.244 / khoản 288] Vế ⑸ không mù: đọc được ràng buộc bí danh trên tệp thật (đầu vòng S1.244: 1261; sàn SAN_RANG_BUOC),
    // và thấy bí danh mang giá trị có thật — `van_ban` ← `pp.prosrc`, chỉ đi vào `regexp_matches` để rút TÊN GUC, không tới bề
    // mặt nào (vì vậy vế đầu của khối này xanh; cùng loại: `bieu_thuc` ← `pg_get_expr`, chỉ để so). Bộ đọc select-list hỏng thì
    // tập này rỗng và phép quét ⑸ mù.
    expect(tk.rangBuoc).toBeGreaterThanOrEqual(SAN_RANG_BUOC);
    expect([...tk.biDanhMang.keys()]).toContain("van_ban");
    expect(tk.biDanhMang.get("van_ban")).toBe("prosrc");
  });

  it("văn bản mẫu — ô mô tả CŨ (nối prosrc đã chuẩn hoá và giá trị proconfig) ⇒ đỏ nêu tên hàng và hai tên cấm; ô mô tả MỚI (vân tay, tên GUC, vân tay def) ⇒ xanh", () => {
    expect(quetHardening(mau([hangMau(MO_TA_CU)]))).toEqual([
      'hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối prosrc',
      'hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối proconfig',
    ]);
    expect(quetHardening(mau([hangMau(MO_TA_MOI)]))).toEqual([]);
  });

  it("văn bản mẫu — nhãn 'chỉ tên GUC' mà mã vẫn nối giá trị proconfig ⇒ đỏ (cổng đọc mã, không đọc nhãn); trả ':def=' || pg_get_triggerdef ⇒ đỏ", () => {
    const nhanDungMaSai = MO_TA_MOI.replace(
      "coalesce((SELECT string_agg(split_part(c.x, '=', 1), ',' ORDER BY c.k) FROM unnest(p.proconfig) WITH ORDINALITY AS c(x, k)), '(null)')",
      "coalesce(array_to_string(p.proconfig, ','), '(null)')",
    );
    expect(nhanDungMaSai).toContain("config(chỉ tên GUC)=' || coalesce(array_to_string(p.proconfig");
    expect(quetHardening(mau([hangMau(nhanDungMaSai)]))).toEqual(['hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối proconfig']);
    const defTran = MO_TA_MOI.replace(
      "':vân tay def=' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(pg_get_triggerdef(t.oid), 'UTF8')), 'hex'), 16)",
      "':def=' || pg_get_triggerdef(t.oid)",
    );
    expect(defTran).toContain("':def=' || pg_get_triggerdef(t.oid)");
    expect(quetHardening(mau([hangMau(defTran)]))).toEqual(['hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối pg_get_triggerdef']);
  });

  it("văn bản mẫu — một khuôn 'gần đúng' (bỏ pg_catalog., băm thân chưa chuẩn hoá) không được coi là vân tay ⇒ đỏ", () => {
    const boPgCatalog = MO_TA_MOI.replace("pg_catalog.sha256(pg_catalog.convert_to(btrim", "sha256(convert_to(btrim");
    expect(quetHardening(mau([hangMau(boPgCatalog)]))).toEqual(['hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối prosrc']);
    const chuaChuanHoa = MO_TA_MOI.replace("pg_catalog.convert_to(btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')), 'UTF8')", "pg_catalog.convert_to(p.prosrc, 'UTF8')");
    expect(quetHardening(mau([hangMau(chuaChuanHoa)]))).toEqual(['hàng "định nghĩa hàm app_current_org_id()": ô mô tả nối prosrc']);
  });

  it("văn bản mẫu — cột mo_ta nối pg_get_expr ⇒ đỏ; RAISE WARNING nối SQLERRM ⇒ đỏ ở câu ấy VÀ ở vế toàn tệp; bản gom nối SQLERRM ⇒ đỏ; GET STACKED DIAGNOSTICS … MESSAGE_TEXT ⇒ đỏ toàn tệp", () => {
    const moTaBieuThuc =
      "  CAU_X constant text :=\n    $q$SELECT 'policy ' || p.polname || ': ' || pg_get_expr(p.polqual, p.polrelid) AS mo_ta FROM pg_policy p$q$;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], moTaBieuThuc))).toEqual(["cột mo_ta (câu 1) nối pg_get_expr"]);
    const raiseSqlerrm = "  RAISE WARNING 'Hardening: không đánh giá được ĐIỀU KIỆN của mục \"%\": % (%).', bang[i][1], SQLERRM, SQLSTATE;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], raiseSqlerrm))).toEqual([
      "RAISE WARNING (câu 1) nối SQLERRM",
      "SQLERRM xuất hiện 1 lần ngoài chú thích — thông điệp lỗi mang giá trị",
    ]);
    const gomSqlerrm = "  loi_gom := loi_gom || format('- \"%s\": ném %s (%s)', bang[i][1], SQLSTATE, SQLERRM);\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], gomSqlerrm))).toEqual([
      "bản gom (câu 1) nối SQLERRM",
      "SQLERRM xuất hiện 1 lần ngoài chú thích — thông điệp lỗi mang giá trị",
    ]);
    const stacked = "  GET STACKED DIAGNOSTICS loi_van_ban = MESSAGE_TEXT;\n  RAISE WARNING 'x: %', loi_van_ban;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], stacked))).toEqual(["MESSAGE_TEXT xuất hiện 1 lần ngoài chú thích — thông điệp lỗi mang giá trị"]);
    // Đối chứng: SQLSTATE và tên mục thì được; chữ SQLERRM trong CHUỖI hay CHÚ THÍCH không tính.
    const sach =
      "  -- SQLERRM không còn ở đây\n  RAISE WARNING 'Hardening: không đánh giá được ĐIỀU KIỆN của mục \"%\": SQLSTATE % (không in SQLERRM).', bang[i][1], SQLSTATE;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], sach))).toEqual([]);
  });

  it("bộ đọc hàng ĐÓNG: hàng thiếu ô, ô mô tả mở dollar-quote không đóng, hay cú pháp lạ giữa hai hàng ⇒ NÉM, không xanh mù; dấu phẩy và ngoặc trong $q$ không phải biên ô", () => {
    expect(() => quetHardening(mau(["    ARRAY[$q$a$q$, $q$true$q$, $q$SELECT 1$q$, $q$true$q$, $q$'x'$q$]"]))).toThrow(/5 ô, phải là 6/u);
    expect(() => quetHardening(mau(["    ARRAY[$q$a$q$, $q$true$q$, $q$SELECT 1$q$, $q$true$q$, $q$'x', $q$không gì$q$]"]))).toThrow(/không đóng/u);
    expect(() => quetHardening(mau([hangMau(MO_TA_MOI) + "\n    XYZ[$q$a$q$]"]))).toThrow(/cú pháp lạ/u);
    // Một ô tên mang dấu phẩy và ngoặc (như `hàm + trigger x (029/037)`) vẫn là MỘT ô; chú thích giữa hai ô bị bỏ.
    const coPhay = mau([
      "    ARRAY[\n      $q$hàm + trigger a, b (029/037)$q$, -- chú thích, có phẩy ($q$ không mở ở đây)\n      $q$true$q$, $q$SELECT 1$q$, $q$true$q$,\n      $q$" +
        MO_TA_MOI +
        "$q$, $q$không gì$q$]",
    ]);
    expect(tachHang(coPhay).map((h) => h.ten)).toEqual(["hàm + trigger a, b (029/037)"]);
    expect(quetHardening(coPhay)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// ⑸ [S1.244 / khoản 288] Văn bản mẫu — giá trị đi qua bí danh của CTE / truy vấn con / VALUES.
// ---------------------------------------------------------------------------------------------
/** Hằng hardening mẫu: `  <TÊN> constant text :=\n    $q$<câu>$q$;` — khuôn các hằng thật. */
const hang = (ten: string, cau: string): string => `  ${ten} constant text :=\n    $q$${cau}$q$;\n`;
/** Mục khoản 259 TRƯỚC vòng này, tái dựng: bí danh `dinh_nghia` mang `pg_get_triggerdef`, nối vào ô mô tả và RAISE qua `t.`/`r.`. */
const CAU_LA_CU = hang(
  "CAU_LA",
  "SELECT c.oid AS bang_oid, t.tgname::text AS ten, pg_catalog.pg_get_triggerdef(t.oid) AS dinh_nghia FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid",
);
const CAU_LA_MOI = hang(
  "CAU_LA",
  "SELECT c.oid AS bang_oid, t.tgname::text AS ten, left(encode(pg_catalog.sha256(pg_catalog.convert_to(pg_get_triggerdef(t.oid), 'UTF8')), 'hex'), 16) AS van_tay_dinh_nghia FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid",
);
const moTaLa = (cot: string): string =>
  `(SELECT string_agg(t.bang_oid::regclass::text || '.' || t.ten || ': TRIGGER LẠ — ' || t.${cot}, '; ') FROM ($q$ || CAU_LA || $q$) t)`;
const raiseLa = (cot: string): string => `  RAISE WARNING 'Hardening: đã GỠ trigger lạ % trên % (%).', r.ten, r.bang_oid::regclass, r.${cot};\n`;
const TEN_LA = "không trigger lạ trên bảng của dự án (mặc định-đóng, khoản 259)";

describe("[S1.244 / khoản 288] vế ⑸ — giá trị đi qua BÍ DANH của một CTE, truy vấn con hay danh sách VALUES", () => {
  it("mục khoản 259 TRƯỚC vòng này (bí danh `dinh_nghia` ← pg_get_triggerdef) ⇒ đỏ ở ô mô tả VÀ ở RAISE; bản sau vòng (bí danh mang VÂN TAY) ⇒ xanh", () => {
    expect(quetHardening(mau([hangMau(moTaLa("dinh_nghia"), TEN_LA)], CAU_LA_CU + raiseLa("dinh_nghia")))).toEqual([
      `hàng "${TEN_LA}": ô mô tả nối dinh_nghia — bí danh mang pg_get_triggerdef`,
      "RAISE WARNING (câu 1) nối dinh_nghia — bí danh mang pg_get_triggerdef",
    ]);
    expect(quetHardening(mau([hangMau(moTaLa("van_tay_dinh_nghia"), TEN_LA)], CAU_LA_MOI + raiseLa("van_tay_dinh_nghia")))).toEqual([]);
    // Khuôn vân tay đứng trong hằng — không phải ngay ở bề mặt — vẫn là khuôn được phép: gỡ trước khi dò bí danh.
    expect(biDanhMangGiaTri(mau([], CAU_LA_MOI)).has("van_tay_dinh_nghia")).toBe(false);
  });

  it("bí danh NGẦM (không AS), chuỗi hai tầng, cột mo_ta ⇒ đỏ nêu tên gốc; tên cột đi qua nguyên tên (`t.dinh_nghia`) cũng mang giá trị", () => {
    const ngam = hang("CAU_N", "SELECT t.tgname AS ten, pg_catalog.pg_get_triggerdef(t.oid) dn FROM pg_trigger t");
    const moTaN = hang("CAU_M", "SELECT x.ten || ': ' || x.dn AS mo_ta FROM ($q$ || CAU_N || $q$) x");
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], ngam + moTaN))).toEqual(["cột mo_ta (câu 1) nối dn — bí danh mang pg_get_triggerdef"]);
    const haiTang =
      hang("CAU_A", "SELECT p.oid AS oid_ham, p.prosrc AS than FROM pg_proc p") +
      hang("CAU_B", "SELECT a.oid_ham, a.than AS noi_dung FROM ($q$ || CAU_A || $q$) a") +
      "  RAISE WARNING 'Hardening: %', r.noi_dung;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], haiTang))).toEqual(["RAISE WARNING (câu 1) nối noi_dung — bí danh mang prosrc"]);
    const quaNguyenTen = hang("CAU_Q", "SELECT t.dinh_nghia FROM ($q$ || CAU_LA || $q$) t") + "  RAISE NOTICE '%', q.dinh_nghia;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], CAU_LA_CU + quaNguyenTen))).toEqual([
      "RAISE NOTICE (câu 1) nối dinh_nghia — bí danh mang pg_get_triggerdef",
    ]);
  });

  it("danh sách cột theo VỊ TRÍ — truy vấn con `(…) AS q(c1, c2)`, `WITH w(c) AS (…)`, nhánh UNION — ⇒ đỏ ở đúng cột; VALUES literal (khuôn hàng khoản 105) ⇒ xanh", () => {
    const dsCot =
      hang("CAU_P", "SELECT q.bt, q.ten FROM (SELECT pg_get_expr(p.polqual, p.polrelid), p.polname FROM pg_policy p) AS q(bt, ten)") +
      "  loi_gom := loi_gom || format('- %s: %s', r.ten, r.bt);\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], dsCot))).toEqual(["bản gom (câu 1) nối bt — bí danh mang pg_get_expr"]);
    const cte = hang("CAU_W", "WITH w(dn) AS (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t) SELECT w.dn AS mo_ta FROM w");
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], cte))).toEqual(["cột mo_ta (câu 1) nối dn — bí danh mang pg_get_triggerdef"]);
    const union =
      hang("CAU_U", "SELECT 'x' AS gia_tri FROM pg_class UNION ALL SELECT pg_get_expr(ad.adbin, ad.adrelid) FROM pg_attrdef ad") +
      "  RAISE WARNING '%', r.gia_tri;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], union))).toEqual(["RAISE WARNING (câu 1) nối gia_tri — bí danh mang pg_get_expr"]);
    const values = hang("CK", "(VALUES ('public', 'users', 'users_email_ascii', 'CHECK (email ~ x)')) AS ck(nspname, bang, conname, dinh_nghia)");
    const moTaCk = "(SELECT string_agg(ck.conname || ': ' || ck.dinh_nghia, '; ') FROM $q$ || CK || $q$)";
    expect(quetHardening(mau([hangMau(moTaCk)], values))).toEqual([]);
  });

  it("đối chứng — không đỏ nhầm: bí danh mang giá trị mà không tới bề mặt nào; bí danh trong THÂN HÀM ghim; tên trùng làm tên bảng hay tên kiểu", () => {
    const chiDeRut =
      hang("CAU_G", "SELECT DISTINCT lower(m[1]) AS ten FROM (SELECT pp.prosrc AS van_ban FROM pg_proc pp) x CROSS JOIN LATERAL regexp_matches(x.van_ban, 'y') m") +
      hang("CAU_GM", "SELECT g.ten || ' đọc vào' AS mo_ta FROM ($q$ || CAU_G || $q$) g");
    expect(biDanhMangGiaTri(mau([], chiDeRut)).get("van_ban")).toBe("prosrc");
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], chiDeRut))).toEqual([]);
    // `$ham$ … $ham$` là thân của một hàm: bí danh `ten` trong đó không phải cột mà hardening đọc — `t.ten` ở bề mặt vẫn xanh.
    const thanHam = hang("CAU_H", "CREATE OR REPLACE FUNCTION public.f() RETURNS text LANGUAGE sql AS $ham$ SELECT p.prosrc AS ten FROM pg_proc p $ham$");
    expect(quetHardening(mau([hangMau(moTaLa("van_tay_dinh_nghia"), TEN_LA)], CAU_LA_MOI + thanHam))).toEqual([]);
    expect(biDanhMangGiaTri(mau([], thanHam)).size).toBe(0);
    // Khối `DO $x$ … $x$` là mã của hardening: bí danh trong đó được đọc.
    const khoiDo = "  DO $x$ BEGIN FOR r IN SELECT pg_get_triggerdef(t.oid) AS dn FROM pg_trigger t LOOP RAISE WARNING '%', r.dn; END LOOP; END $x$;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], khoiDo))).toEqual(["RAISE WARNING (câu 1) nối dn — bí danh mang pg_get_triggerdef"]);
    // Bí danh mang giá trị làm TÊN BẢNG (`dn.x`), tên hàm (`dn(`), bí danh khai (`AS dn`) hay tên kiểu (`::dn`) — không phải tham chiếu cột.
    const khongPhaiCot = hang("CAU_D", "SELECT pg_get_triggerdef(t.oid) AS dn FROM pg_trigger t") + "  RAISE WARNING '% % %', dn.x, dn(1), 1::dn;\n";
    expect(quetHardening(mau([hangMau(MO_TA_MOI)], khongPhaiCot))).toEqual([]);
  });
});
