// ==============================================================================================
// [S1.9102 / khoản 117 / ADR-9202] THÔNG ĐIỆP CỦA HARDENING NÊU TÊN VÀ VÂN TAY — KHÔNG NỐI THÂN HÀM,
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
// `SQLERRM` thay bằng `SQLSTATE` — và cổng này cấm nối trở lại. Cách tra thân hàm từ vân tay: ADR-9202 và chú thích đầu
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
// CHỖ THU HẸP, NÓI RA: một cột mô tả không tên `mo_ta` nằm ngoài tầm ⑵; các cờ `provolatile`/`prosecdef`/`tgenabled`,
// `pg_get_function_identity_arguments` (kiểu tham số — tên) và ba GUC log ở (E4) cố ý được phép; thân hàm ghim trong
// hardening bị quét ở ⑶ như mã của chính tệp (hôm nay: không thân nào nối tên cấm). Danh sách cấm là ĐÚNG SÁU TÊN của khoản
// 117 — không `pg_get_constraintdef`/`pg_get_ruledef`/`pg_get_viewdef`/`prosqlbody`: phép quét đọc cả ô nên một vị từ LỌC
// (hàng khoản 105 so `pg_get_constraintdef` trong ô mô tả) sẽ bị nhầm là nối; mở rộng đòi một bộ đọc biết đâu là biểu thức
// chuỗi — ghi ở biên bản §S1.9102 mục 7.
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

/** Danh sách vi phạm — rỗng là xanh. Cú pháp lạ ⇒ NÉM. */
export function quetHardening(sql: string): string[] {
  const loi: string[] = [];
  for (const h of tachHang(sql)) for (const t of tenCam(beMatMa(h.o[4]!))) loi.push(`hàng "${h.ten}": ô mô tả nối ${t}`);
  const ma = beMatMa(sql);
  let k = 0;
  for (const m of ma.matchAll(RE_MO_TA)) {
    k += 1;
    for (const t of tenCam(bieuThucMoTa(ma, m.index))) loi.push(`cột mo_ta (câu ${k}) nối ${t}`);
  }
  k = 0;
  for (const m of ma.matchAll(RE_RAISE)) {
    k += 1;
    for (const t of tenCam(m[2]!)) loi.push(`RAISE ${m[1]} (câu ${k}) nối ${t}`);
  }
  k = 0;
  for (const m of ma.matchAll(RE_GOM)) {
    k += 1;
    for (const t of tenCam(m[1]!)) loi.push(`bản gom (câu ${k}) nối ${t}`);
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

describe("[S1.9102 / khoản 117] thông điệp của hardening nêu tên và vân tay, không in giá trị", () => {
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
    // Đầu vòng S1.9102: 94 / 71 / 94. Sàn "≥" để một hàng ghim mới không làm cổng đỏ vì lý do lạ; về 0 thì phép quét mù.
    expect(tk.vanTayProsrc).toBeGreaterThanOrEqual(90);
    expect(tk.vanTayTrigger).toBeGreaterThanOrEqual(60);
    expect(tk.tenProconfig).toBeGreaterThanOrEqual(90);
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
