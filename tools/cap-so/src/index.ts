// ==============================================================================================
// tools/cap-so — SỐ HIỆU CẤP LÚC MERGE, KHÔNG CẤP LÚC VIẾT
//
// GỐC CỦA CHUYỆN TRÙNG SỐ. Bốn dãy số — vòng `S1.N`, `ADR-N`, khoản nợ, migration `NNN_` — từng
// được cấp trên NHÁNH theo luật S1.111: "đo max trên mọi nhánh đang sống rồi +1". Luật ấy không có
// khoá: hai nhánh đo cùng một lúc thì ra cùng một số, nhánh nào merge trước giữ số, nhánh sau đổi
// tay. Tới S1.140 đã sáu lần, mỗi lần ~12 tệp và ~200 dòng, và lần nào cũng sót một dải số lệch.
//
// CÁCH SỬA: nhánh KHÔNG cấp số. Nó viết SỐ TẠM ở một dải mà số thật không bao giờ chạm tới, và lệnh
// này thay chúng bằng max(base)+1… SAU khi nhánh đã merge `origin/master`, tức lúc nó đã thấy mọi
// số mà master đã cấp:
//
//   vòng       S1.91NN          ADR         ADR-92NN
//   khoản nợ   94NN             migration   95NN_ten.sql
//
// NN = 01, 02, … theo thứ tự nhánh tạo ra chúng. Dải được chọn bằng phép đo: không số tự nhiên nào
// của kho rơi vào 91xx, 92xx, 94xx, 95xx (90xx có `9000` ms, 93xx có thời gian đo, 99xx có `9999`).
// Số tạm KHÔNG BAO GIỜ tới master — CI chạy `pnpm cap-so --kiem` trên commit merge của PR.
//
// BA CHẾ ĐỘ
//   pnpm cap-so           cấp số: gỡ xung đột ở lời khai đếm (nếu có), thu hồi lần cấp cũ của nhánh,
//                         cấp lại từ base, đổi tên migration, viết lại lời khai đếm, kiểm trùng.
//   pnpm cap-so --dem     chỉ gỡ xung đột lời khai và viết lại lời khai đếm — cho lúc còn số tạm mà
//                         `pnpm test` ([INV-H20]) cần lời khai khớp sổ.
//   pnpm cap-so --kiem    cho CI: đỏ nếu cây còn số tạm hay có số trùng.
//
// VÌ SAO CÓ TRAILER `Cap-So:`. Nhánh thua một cuộc đua (PR khác merge trước với cùng số) phải cấp
// LẠI. Số thật trong văn bản thì mơ hồ — `083` trần có thể là bất cứ gì — nên lệnh không đoán: nó
// đọc lại commit đã mang trailer, lấy từng cặp dòng trước/sau của lần cấp ấy, và trả dòng về đúng
// bản số tạm. Dòng nào đã bị sửa sau lần cấp thì mới rơi xuống thu hồi theo token có tiền tố
// (`ADR-N`, `S1.N`, `khoản N`, tên tệp migration).
//
// RANH GIỚI NÓI RA
//   - Chỉ những dòng NHÁNH thêm (so với base) bị viết lại; dòng của master không bao giờ bị đụng.
//   - Vòng không có chỗ khai duy nhất như đầu mục ADR hay hàng sổ nợ, nên `--kiem` không bắt được
//     hai PR cùng dùng một số vòng thật. Chỉ bật "Require branches to be up to date" trên GitHub mới
//     đóng hẳn cuộc đua giữa hai PR cùng cấp số trên một master.
//   - `tools/cap-so/` đứng ngoài mọi phép thay và phép quét: chính nó chứa số tạm làm dữ liệu test.
// ==============================================================================================

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

// ---- Bốn dãy và dải số tạm ------------------------------------------------------------------

export type Day = "vong" | "adr" | "khoan" | "migration";
export const CAC_DAY: readonly Day[] = ["vong", "adr", "khoan", "migration"];

export const DAI_SO_TAM: Readonly<Record<Day, { readonly tu: number; readonly den: number }>> = {
  vong: { tu: 9101, den: 9199 },
  adr: { tu: 9201, den: 9299 },
  khoan: { tu: 9401, den: 9499 },
  migration: { tu: 9501, den: 9599 },
};

/** Số thật luôn nhỏ hơn mốc này; mọi phép đo max trên base bỏ qua số từ mốc trở lên. */
const MOC_SO_TAM = 9000;

export function dayCuaSoTam(n: number): Day | null {
  for (const d of CAC_DAY) if (n >= DAI_SO_TAM[d].tu && n <= DAI_SO_TAM[d].den) return d;
  return null;
}

/** ADR và migration viết ba chữ số (`ADR-083`, `068_…`); vòng và khoản viết trần. */
export function dinhDang(day: Day, n: number): string {
  return day === "adr" || day === "migration" ? String(n).padStart(3, "0") : String(n);
}

/** Một lần cấp: với mỗi dãy, số tạm → số thật. */
export type BangCap = Readonly<Record<Day, ReadonlyMap<number, number>>>;

export function bangRong(): Record<Day, Map<number, number>> {
  return { vong: new Map(), adr: new Map(), khoan: new Map(), migration: new Map() };
}

function bangTrong(bang: BangCap): boolean {
  return CAC_DAY.every((d) => bang[d].size === 0);
}

// ---- Trailer `Cap-So:` ---------------------------------------------------------------------

const KHOA_TRAILER = "Cap-So:";

/** `Cap-So: vong 9101=141; adr 9201=083` — dãy rỗng không ghi. */
export function vietTrailer(bang: BangCap): string {
  const phan = CAC_DAY.filter((d) => bang[d].size > 0).map((d) => {
    const cap = [...bang[d]].sort((a, b) => a[0] - b[0]).map(([tam, that]) => `${tam}=${dinhDang(d, that)}`);
    return `${d} ${cap.join(" ")}`;
  });
  return `${KHOA_TRAILER} ${phan.join("; ")}`;
}

/** Đọc phần sau `Cap-So:`. NÉM khi sai hình dạng — một bảng đọc nhầm là một lần thu hồi nhầm. */
export function docTrailer(than: string): BangCap {
  const bang = bangRong();
  for (const phan of than.split(";").map((p) => p.trim()).filter((p) => p !== "")) {
    const [ten, ...cap] = phan.split(/\s+/);
    if (!CAC_DAY.includes(ten as Day)) throw new Error(`trailer ${KHOA_TRAILER} có dãy lạ: ${JSON.stringify(ten)}`);
    const day = ten as Day;
    for (const c of cap) {
      const m = /^(\d+)=(\d+)$/.exec(c);
      if (m === null) throw new Error(`trailer ${KHOA_TRAILER} có cặp sai hình dạng: ${JSON.stringify(c)}`);
      const [tam, that] = [Number(m[1]), Number(m[2])];
      if (dayCuaSoTam(tam) !== day) throw new Error(`trailer ${KHOA_TRAILER}: ${tam} không nằm trong dải số tạm của ${day}`);
      if (that >= MOC_SO_TAM) throw new Error(`trailer ${KHOA_TRAILER}: ${that} không phải số thật`);
      bang[day].set(tam, that);
    }
  }
  return bang;
}

// ---- Thay số -------------------------------------------------------------------------------

const SO_TAM_TRAN = /(?<!\d)(9[1245]\d\d)(?!\d)/g;

/**
 * Thay mọi số tạm có trong bảng bằng số thật, trong MỘT lượt — không dây chuyền (083 → 084 rồi
 * 084 → 085 không xảy ra được). Số tạm dạng trần cũng được thay (`ADR-9201…9203`, `` `9501` ``),
 * và chỉ khi nó có trong bảng: một `9412 ms` không phải khoản đã khai thì đứng yên.
 */
export function thaySoTam(dong: string, bang: BangCap): string {
  return dong.replace(SO_TAM_TRAN, (toan, so: string) => {
    const n = Number(so);
    const day = dayCuaSoTam(n);
    const moi = day === null ? undefined : bang[day].get(n);
    return day === null || moi === undefined ? toan : dinhDang(day, moi);
  });
}

function dao(bang: ReadonlyMap<number, number>): Map<number, number> {
  return new Map([...bang].map(([tam, that]) => [that, tam]));
}

/**
 * Đưa số THẬT của một lần cấp cũ về số tạm, chỉ ở các dạng CÓ TIỀN TỐ. Số trần (`083`) mơ hồ nên
 * không đụng — những dòng chưa sửa sau lần cấp đã được trả về nguyên văn bằng cặp dòng trước đó.
 */
export function thuHoiTheoToken(
  dong: string,
  bang: BangCap,
  duoiMigrationCuaNhanh: ReadonlySet<string>,
  laSoNo: boolean,
): string {
  const vong = dao(bang.vong);
  const adr = dao(bang.adr);
  const khoan = dao(bang.khoan);
  const migration = dao(bang.migration);
  let ra = dong
    .replace(/S1\.(\d+)(?!\d)/g, (toan, so: string) => {
      const tam = vong.get(Number(so));
      return tam === undefined ? toan : `S1.${tam}`;
    })
    .replace(/ADR-(\d+)(?!\d)/g, (toan, so: string) => {
      const tam = adr.get(Number(so));
      return tam === undefined ? toan : `ADR-${tam}`;
    })
    .replace(/(khoản(?: nợ)?\s+)(\d+)(?!\d)/g, (toan, dau: string, so: string) => {
      const tam = khoan.get(Number(so));
      return tam === undefined ? toan : `${dau}${tam}`;
    });
  if (laSoNo) {
    ra = ra.replace(/^(\s*\|\s*)(\d+)(\s*\|)/, (toan, a: string, so: string, b: string) => {
      const tam = khoan.get(Number(so));
      return tam === undefined ? toan : `${a}${tam}${b}`;
    });
  }
  return ra.replace(/(?<!\d)(\d+)(_[A-Za-z0-9_]+\.sql)/g, (toan, so: string, duoi: string) => {
    const tam = migration.get(Number(so));
    return tam === undefined || !duoiMigrationCuaNhanh.has(duoi) ? toan : `${tam}${duoi}`;
  });
}

/**
 * `truoc` → `sau` có phải MỘT CẶP THAY SỐ của lần cấp `bang` không: hai dòng chỉ khác nhau ở các
 * chuỗi chữ số, và mỗi chỗ khác là một số `bang` cấp — từ số tạm của nó, hoặc từ số thật mà một lần
 * cấp CŨ hơn đã cấp cho cùng số tạm ấy. Một lời khai đếm đổi `82 → 83` không qua được phép này, và
 * không cần qua: lời khai được tính lại từ sổ.
 */
export function laCapThaySo(truoc: string, sau: string, bang: BangCap, cacBangCu: readonly BangCap[]): boolean {
  if (truoc === sau) return false;
  const a = truoc.split(/(\d+)/);
  const b = sau.split(/(\d+)/);
  if (a.length !== b.length) return false;
  const nguon = new Map<string, Set<string>>();
  for (const d of CAC_DAY) {
    for (const [tam, that] of bang[d]) {
      const dich = dinhDang(d, that);
      const tap = nguon.get(dich) ?? new Set<string>();
      tap.add(String(tam));
      for (const cu of cacBangCu) {
        const thatCu = cu[d].get(tam);
        if (thatCu !== undefined) tap.add(dinhDang(d, thatCu));
      }
      nguon.set(dich, tap);
    }
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (i % 2 === 0) return false;
    if (!(nguon.get(b[i]!)?.has(a[i]!) ?? false)) return false;
  }
  return true;
}

// ---- Sổ nợ (`docs/STATE.md`) ---------------------------------------------------------------

const TIEU_DE_SO_NO = "## Nợ kỹ thuật";
const NHAN_TONG_KET = "**CÒN MỞ TÍNH TỚI HEAD:**";
const RE_HANG_SO_NO = /^\|\s*(\d+)\s*\|/;
const RE_NHAN_TRANG_THAI = /\*\*\[(ĐÓNG|MỞ|NỬA)\]\*\*/;

/** Chỉ số dòng [tu, den) của mục sổ nợ; `null` khi không có mục ấy. */
export function khoiSoNo(dong: readonly string[]): { readonly tu: number; readonly den: number } | null {
  const tu = dong.findIndex((l) => l.startsWith(TIEU_DE_SO_NO));
  if (tu < 0) return null;
  const sau = dong.findIndex((l, i) => i > tu && l.startsWith("## "));
  return { tu, den: sau < 0 ? dong.length : sau };
}

export interface HangSoNo {
  readonly so: number;
  readonly chiSo: number;
  readonly dong: boolean;
}

/** Hàng sổ nợ — cùng cách đọc với `[INV-H20]`: ô thứ hai là thân, nhãn trạng thái nằm trong thân. */
export function cacHangSoNo(dong: readonly string[]): readonly HangSoNo[] {
  const khoi = khoiSoNo(dong);
  if (khoi === null) return [];
  const ra: HangSoNo[] = [];
  for (let i = khoi.tu; i < khoi.den; i += 1) {
    const l = dong[i]!;
    const m = RE_HANG_SO_NO.exec(l);
    if (m === null) continue;
    const o = l.split(/(?<!\\)\|/);
    const than = (o[2] ?? "").trim();
    ra.push({ so: Number(m[1]), chiSo: i, dong: RE_NHAN_TRANG_THAI.exec(than)?.[1] === "ĐÓNG" });
  }
  return ra;
}

// ---- Lời khai đếm --------------------------------------------------------------------------

/**
 * Vùng CHẾT của một văn bản — đoạn mã và đoạn đã gạch — theo đúng thứ tự `[INV-H20]` bóc chúng:
 * bỏ đoạn mã trước, rồi mới ghép cặp `~~`. Một lời khai nằm trong vùng chết là lịch sử hay trích
 * dẫn, không được viết lại.
 */
export function vungChet(van: string): ReadonlyArray<readonly [number, number]> {
  const vung: Array<readonly [number, number]> = [];
  let che = van;
  for (const re of [/```[\s\S]*?```/g, /``[^`]*``/g, /`[^`\n]*`/g]) {
    che = che.replace(re, (toan: string, viTri: number) => {
      vung.push([viTri, viTri + toan.length]);
      return " ".repeat(toan.length);
    });
  }
  for (const m of che.matchAll(/~~[\s\S]*?~~/g)) vung.push([m.index, m.index + m[0].length]);
  return vung;
}

function song(vung: ReadonlyArray<readonly [number, number]>, tu: number, den: number): boolean {
  return vung.every(([a, b]) => den <= a || tu >= b);
}

/** Văn bản CÒN HIỆU LỰC, đúng như `[INV-H20]` đọc: bỏ đoạn mã, rồi bỏ đoạn đã gạch. */
function conHieuLuc(van: string): string {
  return van
    .replace(/```[\s\S]*?```/g, "")
    .replace(/``[^`]*``/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/~~[\s\S]*?~~/g, "");
}

const DON_VI = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"] as const;
const DOC_DON_VI: Readonly<Record<string, number>> = {
  không: 0, một: 1, mốt: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, lăm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9,
};

/** Số đếm 0–99 viết bằng chữ, đúng dạng `[INV-H20]` đọc được; `null` ngoài dải ấy. */
export function vietSoTiengViet(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n === 0) return "không";
  const chuc = Math.floor(n / 10);
  const dv = n % 10;
  if (chuc === 0) return DON_VI[dv]!;
  const dau = chuc === 1 ? "mười" : `${DON_VI[chuc]!} mươi`;
  if (dv === 0) return dau;
  const cuoi = dv === 5 ? "lăm" : dv === 1 && chuc > 1 ? "mốt" : dv === 4 && chuc > 1 ? "tư" : DON_VI[dv]!;
  return `${dau} ${cuoi}`;
}

function docSoTiengViet(chu: string): number | null {
  const t = chu.trim().toLowerCase().split(/\s+/);
  if (t.length === 1) return t[0] === "mười" ? 10 : (DOC_DON_VI[t[0]!] ?? null);
  if (t[0] === "mười") {
    const dv = DOC_DON_VI[t[1]!];
    return t.length === 2 && dv !== undefined ? 10 + dv : null;
  }
  if (t[1] === "mươi") {
    const chuc = DOC_DON_VI[t[0]!];
    if (chuc === undefined) return null;
    if (t.length === 2) return chuc * 10;
    const dv = DOC_DON_VI[t[2]!];
    return t.length === 3 && dv !== undefined ? chuc * 10 + dv : null;
  }
  return null;
}

function docSo(chu: string): number | null {
  const t = chu.trim();
  return /^\d+$/.test(t) ? Number(t) : docSoTiengViet(t);
}

/** Viết `n` theo DẠNG của giá trị cũ: chữ số giữ chữ số, chữ giữ chữ (kể cả viết hoa). Chữ chỉ tới 99. */
function vietNhuCu(cu: string, n: number): string {
  if (/^\s*\d+\s*$/.test(cu)) return String(n);
  const chu = vietSoTiengViet(n);
  if (chu === null) return String(n);
  return cu === cu.toUpperCase() ? chu.toUpperCase() : chu;
}

export interface SoDem {
  readonly adr: number;
  readonly khoanTong: number;
  readonly khoanMo: number;
  readonly migration: number;
}

const RE_KHAI_ADR = /(\*\*(?:\[S[\d.]+\]\s*)?)([a-zà-ỹ ]+|\d+)( ADR\*\*)/giu;
const RE_KHAI_KHOAN = /(\*\*(?:\[S[\d.]+\]\s*)?)(\d+)( khoản(?: nợ)?,\s*(?:trong đó\s*)?)(\d+)( còn mở\*\*)/g;
const RE_KHAI_MIGRATION = /(\*\*(?:\[S[\d.]+\]\s*)?)(\d+)( migration đánh số\*\*)/g;

/** Họ lời khai mà `[INV-H20]` đối chiếu trên một tệp — lệnh viết lại ĐÚNG những họ ấy, không hơn. */
export interface HoKhai {
  readonly adr: boolean;
  readonly khoan: boolean;
  readonly migration: boolean;
}

/**
 * `docs/STATE.md` chỉ bị đối chiếu số ADR (P5): nhật ký của nó mang hàng chục lời khai khoản nợ
 * CŨ còn sống (`**82 khoản, 16 còn mở**` ở mục 53) — đó là số đo tại vòng ấy, không phải lời khai
 * về hôm nay, và viết lại chúng là xoá lịch sử. `Handoff.md` bị đối chiếu cả ba (P7–P9).
 */
export const HO_KHAI_STATE: HoKhai = { adr: true, khoan: false, migration: false };
export const HO_KHAI_HANDOFF: HoKhai = { adr: true, khoan: true, migration: true };

/**
 * Viết lại tại chỗ mọi lời khai đếm CÒN SỐNG thuộc các họ `ho` — `**[S1.x] N ADR**`, `**[S1.x] N
 * khoản, trong đó M còn mở**`, `**[S1.x] N migration đánh số**`. Tiền tố vòng đứng yên; chỉ con số
 * đổi, và chỉ khi nó sai. Không nối thêm chuỗi gạch: hai nhánh cùng sửa một dòng lịch sử là nguồn
 * xung đột mỗi lần merge.
 */
export function capNhatKhai(van: string, so: SoDem, ho: HoKhai): string {
  // Vùng chết tính lại trước MỖI lượt thay: lượt trước đổi độ dài văn bản ("tám mươi hai" → "tám
  // mươi ba"), và một vị trí đo trên bản cũ trỏ lệch trên bản mới.
  let ra = van;
  if (ho.adr) {
    const vung = vungChet(ra);
    ra = ra.replace(RE_KHAI_ADR, (toan: string, dau: string, gt: string, duoi: string, viTri: number) =>
      !song(vung, viTri, viTri + toan.length) || docSo(gt) === so.adr ? toan : `${dau}${vietNhuCu(gt, so.adr)}${duoi}`,
    );
  }
  if (ho.khoan) {
    const vung = vungChet(ra);
    ra = ra.replace(
      RE_KHAI_KHOAN,
      (toan: string, dau: string, tong: string, giua: string, mo: string, duoi: string, viTri: number) =>
        !song(vung, viTri, viTri + toan.length) || (Number(tong) === so.khoanTong && Number(mo) === so.khoanMo)
          ? toan
          : `${dau}${so.khoanTong}${giua}${so.khoanMo}${duoi}`,
    );
  }
  if (ho.migration) {
    const vung = vungChet(ra);
    ra = ra.replace(RE_KHAI_MIGRATION, (toan: string, dau: string, gt: string, duoi: string, viTri: number) =>
      !song(vung, viTri, viTri + toan.length) || Number(gt) === so.migration ? toan : `${dau}${so.migration}${duoi}`,
    );
  }
  return ra;
}

const RE_TONG_DOAN_DEM = /\*\*([^*]+)\*\*(?=\s+khoản ấy,)/g;
const RE_NGOAI_MA_DOAN_DEM = /\*\*([^*]+)\*\*(?=\s+không phải việc của mã nguồn)/g;
const RE_CO_MA_DOAN_DEM = /\*\*([^*]+)\*\*(?=\s+thì có)/g;
const RE_DOAN_DEM =
  /Trong\s+\*\*([^*]+)\*\*\s+khoản ấy,\s*\*\*([^*]+)\*\*\s+không phải việc của mã nguồn\s*\(([\s\S]*?)\),\s*và\s+\*\*([^*]+)\*\*\s+thì có/u;

/**
 * Dòng `**CÒN MỞ TÍNH TỚI HEAD:**` và đoạn đếm ngay dưới nó, suy lại từ bảng sổ nợ — đúng hai thứ
 * P3 và P12 của `[INV-H20]` đối chiếu. Hai nhánh cùng thêm một khoản là hai lần sửa cùng một dòng;
 * suy lại thay vì chép tay làm xung đột ấy thành việc của lệnh.
 */
export function capNhatTongKet(state: string): string {
  const dong = state.split("\n");
  const khoi = khoiSoNo(dong);
  if (khoi === null) return state;
  const hang = cacHangSoNo(dong);
  const mo = [...new Set(hang.filter((h) => !h.dong).map((h) => h.so))].sort((a, b) => a - b);
  const i = dong.findIndex((l, k) => k >= khoi.tu && k < khoi.den && l.startsWith(NHAN_TONG_KET));
  if (i < 0) return state;

  const cu = dong[i]!.slice(NHAN_TONG_KET.length).split("·").map((x) => Number(x.trim()));
  const giongNhau = cu.length === mo.length && [...cu].sort((a, b) => a - b).every((n, k) => n === mo[k]);
  if (!giongNhau) dong[i] = `${NHAN_TONG_KET} ${mo.join(" · ")}`;

  let dau = i + 1;
  while (dau < khoi.den && dong[dau]!.trim() === "") dau += 1;
  let cuoi = dau;
  while (cuoi < khoi.den && dong[cuoi]!.trim() !== "") cuoi += 1;
  const doan = dong.slice(dau, cuoi).join("\n");
  const m = RE_DOAN_DEM.exec(conHieuLuc(doan));
  if (m !== null) {
    const tapMo = new Set(mo);
    const ngoaiMa = new Set(
      [...m[3]!.matchAll(/(?<![\d.])(\d{1,3})(?![\d.])/g)].map((x) => Number(x[1])).filter((n) => tapMo.has(n)),
    ).size;
    const viet = (re: RegExp, n: number) => (van: string) => {
      const vung = vungChet(van);
      return van.replace(re, (toan: string, gt: string, viTri: number) => {
        if (!song(vung, viTri, viTri + toan.length) || docSoTiengViet(gt) === n) return toan;
        const chu = vietSoTiengViet(n);
        if (chu === null) throw new CapSoError(`đoạn đếm dưới "${NHAN_TONG_KET}" chỉ viết được số 0–99 bằng chữ, cần ${n}`);
        return `**${gt === gt.toUpperCase() ? chu.toUpperCase() : chu}**`;
      });
    };
    const moi = [viet(RE_TONG_DOAN_DEM, mo.length), viet(RE_NGOAI_MA_DOAN_DEM, ngoaiMa), viet(RE_CO_MA_DOAN_DEM, mo.length - ngoaiMa)]
      .reduce((van, f) => f(van), doan);
    dong.splice(dau, cuoi - dau, ...moi.split("\n"));
  }
  return dong.join("\n");
}

// ---- Xung đột ở lời khai đếm ---------------------------------------------------------------

function chuanHoaKhai(dong: string): string {
  return dong
    .replace(RE_KHAI_ADR, "$1‹›$3")
    .replace(RE_KHAI_KHOAN, "$1‹›$3‹›$5")
    .replace(RE_KHAI_MIGRATION, "$1‹›$3")
    .replace(/^(\*\*CÒN MỞ TÍNH TỚI HEAD:\*\*).*$/, "$1 ‹›")
    .replace(RE_TONG_DOAN_DEM, "**‹›**")
    .replace(RE_NGOAI_MA_DOAN_DEM, "**‹›**")
    .replace(RE_CO_MA_DOAN_DEM, "**‹›**");
}

/**
 * Trộn một khối xung đột của `docs/STATE.md`/`Handoff.md` khi hai phía chỉ khác nhau ở (a) lời khai
 * đếm và (b) hàng sổ nợ mỗi phía THÊM vào cùng một chỗ — đúng hình dạng của một cuộc đua cấp số:
 * hai nhánh cùng nối một khoản vào cuối bảng và cùng sửa dòng tổng kết ngay dưới. Kết quả: dòng của
 * master (phía sau `=======` khi merge master VÀO nhánh), với hàng của nhánh chèn ngay sau hàng của
 * master ở cùng chỗ. Con số trong lời khai được tính lại ngay sau đó. Hai hàng CÙNG SỐ mà bản gốc
 * chung (`soGoc`) không có là hai khoản mới va số — giữ cả hai, lệnh cấp lại số cho hàng của nhánh.
 * `null` khi hai phía khác nhau ở chỗ khác, hay cùng sửa MỘT khoản có sẵn theo hai cách (hoặc không
 * biết bản gốc để phân biệt) — việc ấy là của người gỡ.
 */
export function tronKhoiKhai(ta: readonly string[], ho: readonly string[], soGoc?: ReadonlySet<number>): string[] | null {
  const laHang = (l: string): boolean => RE_HANG_SO_NO.test(l);
  const doan = (ben: readonly string[]): { readonly chen: string[][]; readonly khung: string[] } => {
    const chen: string[][] = [[]];
    const khung: string[] = [];
    for (const l of ben) {
      if (laHang(l)) chen[chen.length - 1]!.push(l);
      else {
        khung.push(l);
        chen.push([]);
      }
    }
    return { chen, khung };
  };
  const a = doan(ta);
  const b = doan(ho);
  if (a.khung.map(chuanHoaKhai).join("\n") !== b.khung.map(chuanHoaKhai).join("\n")) return null;
  const soCua = (l: string): number => Number(RE_HANG_SO_NO.exec(l)![1]);
  const ra: string[] = [];
  for (let k = 0; k < b.chen.length; k += 1) {
    const cuaHo = b.chen[k]!;
    ra.push(...cuaHo);
    for (const l of a.chen[k]!) {
      const cungSo = cuaHo.find((h) => soCua(h) === soCua(l));
      if (cungSo === undefined || (cungSo !== l && soGoc !== undefined && !soGoc.has(soCua(l)))) ra.push(l);
      else if (cungSo !== l) return null;
    }
    if (k < b.khung.length) ra.push(b.khung[k]!);
  }
  return ra;
}

export type CachGiai = "khai" | "noi-cuoi";

/**
 * Gỡ những khối xung đột mà lệnh này sở hữu, để khối còn lại mới đến tay người:
 *   `khai`     (`docs/STATE.md`, `Handoff.md`) — xem `tronKhoiKhai`;
 *   `noi-cuoi` (`docs/DECISIONS.md`, `evidence/security-reviews.md`) — khối nằm ở CUỐI tệp, tức hai
 *              nhánh cùng nối một mục mới: giữ cả hai, của master trước.
 */
export function giaiXungDotKhai(
  van: string,
  cach: CachGiai = "khai",
  soGoc?: ReadonlySet<number>,
): { readonly van: string; readonly daGiai: number; readonly conLai: number } {
  const dong = van.split("\n");
  const ra: string[] = [];
  let daGiai = 0;
  let conLai = 0;
  for (let i = 0; i < dong.length; i += 1) {
    if (!dong[i]!.startsWith("<<<<<<< ")) {
      ra.push(dong[i]!);
      continue;
    }
    const khoi = [dong[i]!];
    const ta: string[] = [];
    const ho: string[] = [];
    let phan: "ta" | "goc" | "ho" = "ta";
    let j = i + 1;
    for (; j < dong.length; j += 1) {
      const l = dong[j]!;
      khoi.push(l);
      if (l.startsWith(">>>>>>> ")) break;
      if (phan === "ta" && l.startsWith("||||||| ")) phan = "goc";
      else if (phan !== "ho" && l === "=======") phan = "ho";
      else if (phan === "ta") ta.push(l);
      else if (phan === "ho") ho.push(l);
    }
    i = j;
    let tron: string[] | null = null;
    if (cach === "khai") tron = tronKhoiKhai(ta, ho, soGoc);
    else if (dong.slice(j + 1).every((l) => l.trim() === "")) {
      const can = ho.length > 0 && ta.length > 0 && ho[ho.length - 1]!.trim() !== "" && ta[0]!.trim() !== "";
      tron = [...ho, ...(can ? [""] : []), ...ta];
    }
    if (tron !== null) {
      ra.push(...tron);
      daGiai += 1;
    } else {
      ra.push(...khoi);
      conLai += 1;
    }
  }
  return { van: ra.join("\n"), daGiai, conLai };
}

// ---- Đọc diff ------------------------------------------------------------------------------

export interface TepTrongDiff {
  /** Đường trước (`--- a/…`), `null` với tệp mới. */
  readonly truoc: string | null;
  /** Đường sau (`+++ b/…`), `null` với tệp bị xoá. */
  readonly sau: string | null;
  /** Số dòng (từ 1) ở bản SAU của mọi dòng được thêm. */
  readonly dongThem: readonly number[];
  /** Cặp dòng trước → sau của những hunk có số dòng bớt bằng số dòng thêm. */
  readonly capDong: ReadonlyArray<readonly [string, string]>;
}

/** Đọc `git diff -U0` (có thể kèm `-M`). Dòng CRLF được bóc `\r` — so khớp theo nội dung, không theo đuôi dòng. */
export function docDiff(diff: string): readonly TepTrongDiff[] {
  const ra: Array<{ truoc: string | null; sau: string | null; dongThem: number[]; capDong: Array<readonly [string, string]> }> = [];
  let tep: (typeof ra)[number] | undefined;
  let bot: string[] = [];
  let them: string[] = [];
  let soDong = 0;
  const dongHunk = (): void => {
    if (tep !== undefined && bot.length > 0 && bot.length === them.length) {
      for (let k = 0; k < bot.length; k += 1) tep.capDong.push([bot[k]!, them[k]!]);
    }
    bot = [];
    them = [];
  };
  const duong = (l: string, tienTo: string): string | null => {
    const p = l.slice(4);
    return p === "/dev/null" ? null : p.startsWith(tienTo) ? p.slice(tienTo.length) : p;
  };
  // Dòng `--- `/`+++ ` chỉ là tiêu đề TRƯỚC hunk đầu của một tệp: trong hunk, `--- x` là dòng bị
  // bớt có nội dung `-- x` — chú thích SQL, thứ có ở đầu mọi migration.
  let trongHunk = false;
  for (const tho of diff.split("\n")) {
    const l = tho.endsWith("\r") ? tho.slice(0, -1) : tho;
    if (l.startsWith("diff --git ")) {
      dongHunk();
      trongHunk = false;
      tep = { truoc: null, sau: null, dongThem: [], capDong: [] };
      ra.push(tep);
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(l);
      if (m !== null) {
        tep.truoc = m[1]!;
        tep.sau = m[2]!;
      }
    } else if (tep === undefined) {
      continue;
    } else if (trongHunk && l.startsWith("+")) {
      tep.dongThem.push(soDong);
      them.push(l.slice(1));
      soDong += 1;
    } else if (trongHunk && l.startsWith("-")) {
      bot.push(l.slice(1));
    } else if (l.startsWith("new file mode")) {
      tep.truoc = null;
    } else if (l.startsWith("deleted file mode")) {
      tep.sau = null;
    } else if (l.startsWith("rename from ")) {
      tep.truoc = l.slice("rename from ".length);
    } else if (l.startsWith("rename to ")) {
      tep.sau = l.slice("rename to ".length);
    } else if (l.startsWith("--- ")) {
      tep.truoc = duong(l, "a/");
    } else if (l.startsWith("+++ ")) {
      tep.sau = duong(l, "b/");
    } else if (l.startsWith("@@ ")) {
      dongHunk();
      trongHunk = true;
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
      soDong = m === null ? 0 : Number(m[1]);
    }
  }
  dongHunk();
  return ra;
}

// ---- Git -----------------------------------------------------------------------------------

export class CapSoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapSoError";
  }
}

const THU_MUC_CONG_CU = "tools/cap-so";
const LOAI_TRU = `:(exclude)${THU_MUC_CONG_CU}`;
const TEP_QUYET_DINH = "docs/DECISIONS.md";
const TEP_STATE = "docs/STATE.md";
const TEP_HANDOFF = "Handoff.md";
const TEP_BIEN_BAN = "evidence/security-reviews.md";
const THU_MUC_MIGRATION = "db/migrations";
const RE_TEN_MIGRATION = /^(\d+)(_.+\.sql)$/;

function git(goc: string, thamSo: readonly string[]): string {
  return execFileSync("git", ["-c", "core.quotepath=false", ...thamSo], {
    cwd: goc,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

function gitThu(goc: string, thamSo: readonly string[]): { readonly ma: number; readonly ra: string } {
  const kq = spawnSync("git", ["-c", "core.quotepath=false", ...thamSo], {
    cwd: goc,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return { ma: kq.status ?? 1, ra: kq.stdout };
}

function laDuongCongCu(p: string): boolean {
  return p === THU_MUC_CONG_CU || p.startsWith(`${THU_MUC_CONG_CU}/`);
}

/** Tệp văn bản trên đĩa, đọc một lần, ghi một lần; CRLF được giữ nguyên khi ghi lại. */
class CayLamViec {
  private readonly bo = new Map<string, { dong: string[]; crlf: boolean; goc: string }>();

  constructor(private readonly goc: string) {}

  co(p: string): boolean {
    return this.bo.has(p) || existsSync(join(this.goc, p));
  }

  dong(p: string): string[] {
    let t = this.bo.get(p);
    if (t === undefined) {
      const van = readFileSync(join(this.goc, p), "utf8");
      const crlf = van.includes("\r\n");
      t = { dong: (crlf ? van.replace(/\r\n/g, "\n") : van).split("\n"), crlf, goc: van };
      this.bo.set(p, t);
    }
    return t.dong;
  }

  van(p: string): string {
    return this.dong(p).join("\n");
  }

  datVan(p: string, van: string): void {
    const t = this.bo.get(p);
    if (t === undefined) this.dong(p);
    this.bo.get(p)!.dong = van.split("\n");
  }

  /** Ghi mọi tệp đã đổi; trả danh sách đường đã ghi. */
  ghi(): readonly string[] {
    const daGhi: string[] = [];
    for (const [p, t] of this.bo) {
      const lf = t.dong.join("\n");
      const van = t.crlf ? lf.replace(/\n/g, "\r\n") : lf;
      if (van !== t.goc) {
        writeFileSync(join(this.goc, p), van, "utf8");
        daGhi.push(p);
      }
    }
    return daGhi;
  }
}

/** Số lớn nhất của mỗi dãy trên base, bỏ qua dải số tạm. */
function maxTrenBase(goc: string, base: string): Record<Day, number> {
  const lonNhat = (so: Iterable<number>): number => {
    let m = 0;
    for (const n of so) if (n < MOC_SO_TAM && n > m) m = n;
    return m;
  };
  const doc = (p: string): string => {
    const kq = gitThu(goc, ["show", `${base}:${p}`]);
    return kq.ma === 0 ? kq.ra : "";
  };
  const vong = gitThu(goc, ["grep", "-h", "-o", "-I", "-E", "S1\\.[0-9]+", base, "--", ".", LOAI_TRU]).ra;
  const tepMigration = gitThu(goc, ["ls-tree", "--name-only", `${base}:${THU_MUC_MIGRATION}`]).ra;
  return {
    vong: lonNhat([...vong.matchAll(/S1\.(\d+)/g)].map((m) => Number(m[1]))),
    adr: lonNhat([...doc(TEP_QUYET_DINH).matchAll(/^## ADR-(\d+)/gm)].map((m) => Number(m[1]))),
    khoan: lonNhat(cacHangSoNo(doc(TEP_STATE).replace(/\r\n/g, "\n").split("\n")).map((h) => h.so)),
    migration: lonNhat(
      tepMigration
        .split("\n")
        .map((t) => RE_TEN_MIGRATION.exec(t.trim())?.[1])
        .filter((s): s is string => s !== undefined)
        .map(Number),
    ),
  };
}

interface LanCapCu {
  readonly bang: BangCap;
  /** Đường sau → (dòng sau → dòng trước), chỉ những cặp đã qua `laCapThaySo`. */
  readonly capDong: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Đường sau → đường trước, cho tệp bị đổi tên trong lần cấp ấy. */
  readonly doiTen: ReadonlyMap<string, string>;
}

/** Các lần cấp cũ của nhánh, MỚI NHẤT trước: mọi commit trong `base..HEAD` mang trailer `Cap-So:`. */
function lichSuCap(goc: string, base: string): readonly LanCapCu[] {
  const log = git(goc, ["log", "--format=%H%x1f%B%x1e", `${base}..HEAD`]);
  const commit: Array<{ sha: string; bang: BangCap }> = [];
  for (const banGhi of log.split("\x1e")) {
    const [sha, than] = banGhi.split("\x1f");
    const m = /^Cap-So:[ \t]*(.*)$/m.exec(than ?? "");
    if (sha === undefined || sha.trim() === "" || m === null) continue;
    commit.push({ sha: sha.trim(), bang: docTrailer(m[1]!) });
  }
  return commit.map(({ sha, bang }, k) => {
    const cacBangCu = commit.slice(k + 1).map((c) => c.bang);
    const diff = git(goc, ["diff", "--no-color", "--no-ext-diff", "-M", "-U0", `${sha}^1`, sha, "--", ".", LOAI_TRU]);
    const capDong = new Map<string, Map<string, string>>();
    const doiTen = new Map<string, string>();
    for (const t of docDiff(diff)) {
      if (t.sau === null) continue;
      if (t.truoc !== null && t.truoc !== t.sau) doiTen.set(t.sau, t.truoc);
      for (const [truoc, sau] of t.capDong) {
        if (!laCapThaySo(truoc, sau, bang, cacBangCu)) continue;
        const theoTep = capDong.get(t.sau) ?? new Map<string, string>();
        theoTep.set(sau, truoc);
        capDong.set(t.sau, theoTep);
      }
    }
    return { bang, capDong, doiTen };
  });
}

/** Dòng NHÁNH thêm so với base: cây làm việc (kể cả tệp chưa theo dõi) so với base, không kể `tools/cap-so`. */
function dongCuaNhanh(goc: string, base: string): Map<string, Set<number>> {
  const ra = new Map<string, Set<number>>();
  const diff = git(goc, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "-U0", base, "--", ".", LOAI_TRU]);
  for (const t of docDiff(diff)) {
    if (t.sau === null || t.dongThem.length === 0) continue;
    ra.set(t.sau, new Set(t.dongThem));
  }
  const chuaTheoDoi = git(goc, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0");
  for (const p of chuaTheoDoi) {
    if (p === "" || laDuongCongCu(p)) continue;
    const buf = readFileSync(join(goc, p));
    if (buf.includes(0)) continue;
    const soDong = buf.toString("utf8").split("\n").length;
    ra.set(p, new Set(Array.from({ length: soDong }, (_, i) => i + 1)));
  }
  return ra;
}

// ---- Kiểm: số tạm còn sót và số trùng ------------------------------------------------------

function trung(so: readonly (number | string)[]): readonly string[] {
  const dem = new Map<string, number>();
  for (const n of so) dem.set(String(n), (dem.get(String(n)) ?? 0) + 1);
  return [...dem].filter(([, n]) => n > 1).map(([k]) => k);
}

function kiemTrung(cay: CayLamViec, tenMigration: readonly string[]): readonly string[] {
  const loi: string[] = [];
  if (cay.co(TEP_QUYET_DINH)) {
    for (const k of trung([...cay.van(TEP_QUYET_DINH).matchAll(/^## ADR-(\d+)/gm)].map((m) => Number(m[1])))) {
      loi.push(`${TEP_QUYET_DINH}: hai đầu mục ADR-${k.padStart(3, "0")}`);
    }
  }
  if (cay.co(TEP_STATE)) {
    for (const k of trung(cacHangSoNo(cay.dong(TEP_STATE)).map((h) => h.so))) loi.push(`${TEP_STATE}: hai hàng sổ nợ khoản ${k}`);
  }
  for (const k of trung(tenMigration.map((t) => RE_TEN_MIGRATION.exec(t)?.[1]).filter((s): s is string => s !== undefined).map(Number))) {
    loi.push(`${THU_MUC_MIGRATION}: hai migration cùng số ${k.padStart(3, "0")}`);
  }
  if (cay.co(TEP_BIEN_BAN)) {
    for (const k of trung([...cay.van(TEP_BIEN_BAN).matchAll(/^# §(S\d+\.\d+)(?!\d)/gm)].map((m) => m[1]!))) {
      loi.push(`${TEP_BIEN_BAN}: hai đầu mục §${k}`);
    }
  }
  return loi;
}

/** Cho CI: cây đang checkout không được còn số tạm, không được có số trùng. */
export function kiem(goc: string): readonly string[] {
  const loi: string[] = [];
  const sot = gitThu(goc, [
    "grep", "-n", "-I", "-E", "S1\\.91[0-9]{2}([^0-9]|$)|ADR-92[0-9]{2}([^0-9]|$)", "--", ".", LOAI_TRU,
  ]).ra;
  for (const l of sot.split("\n").filter((x) => x !== "")) loi.push(`còn số tạm: ${l.slice(0, 160)}`);
  const cay = new CayLamViec(goc);
  if (cay.co(TEP_STATE)) {
    for (const h of cacHangSoNo(cay.dong(TEP_STATE))) {
      if (dayCuaSoTam(h.so) === "khoan") loi.push(`còn số tạm: ${TEP_STATE}:${h.chiSo + 1} hàng sổ nợ khoản ${h.so}`);
    }
  }
  const tenMigration = git(goc, ["ls-files", THU_MUC_MIGRATION])
    .split("\n")
    .filter((p) => p !== "")
    .map((p) => p.slice(THU_MUC_MIGRATION.length + 1));
  for (const t of tenMigration) {
    const so = RE_TEN_MIGRATION.exec(t)?.[1];
    if (so !== undefined && dayCuaSoTam(Number(so)) === "migration") loi.push(`còn số tạm: ${THU_MUC_MIGRATION}/${t}`);
  }
  loi.push(...kiemTrung(cay, tenMigration));
  if (loi.length > 0) loi.push("PR còn số tạm hay số trùng: merge origin/master vào nhánh rồi chạy `pnpm cap-so`.");
  return loi;
}

// ---- Gỡ xung đột và viết lại lời khai ------------------------------------------------------

function tepXungDot(goc: string): readonly string[] {
  return git(goc, ["diff", "--name-only", "--diff-filter=U"]).split("\n").filter((p) => p !== "");
}

function giaiXungDot(goc: string, bao: string[]): void {
  const cachGiai: Readonly<Record<string, CachGiai>> = {
    [TEP_STATE]: "khai",
    [TEP_HANDOFF]: "khai",
    [TEP_QUYET_DINH]: "noi-cuoi",
    [TEP_BIEN_BAN]: "noi-cuoi",
  };
  for (const p of tepXungDot(goc)) {
    const cach = cachGiai[p];
    if (cach === undefined) continue;
    const van = readFileSync(join(goc, p), "utf8");
    const crlf = van.includes("\r\n");
    // Bản gốc chung của lần merge (`:1:`) cho biết một hàng sổ nợ cùng số ở hai phía là hai khoản MỚI va
    // số hay một khoản CŨ bị hai phía cùng sửa.
    const goc1 = gitThu(goc, ["show", `:1:${p}`]);
    const soGoc = new Set(cacHangSoNo(goc1.ra.replace(/\r\n/g, "\n").split("\n")).map((h) => h.so));
    const kq = giaiXungDotKhai(crlf ? van.replace(/\r\n/g, "\n") : van, cach, goc1.ma === 0 ? soGoc : undefined);
    if (kq.daGiai === 0) continue;
    writeFileSync(join(goc, p), crlf ? kq.van.replace(/\n/g, "\r\n") : kq.van, "utf8");
    if (kq.conLai === 0) git(goc, ["add", "--", p]);
    bao.push(`${p}: gỡ ${kq.daGiai} khối xung đột (lời khai đếm, hàng sổ nợ hay mục nối cuối tệp)`);
  }
  const conLai = tepXungDot(goc);
  if (conLai.length > 0) {
    throw new CapSoError(
      `còn xung đột phải gỡ tay: ${conLai.join(", ")}. Gỡ xong (số của nhánh để nguyên, lệnh sẽ cấp lại), ` +
        "`git add` rồi chạy lại `pnpm cap-so`.",
    );
  }
}

function soDem(cay: CayLamViec, tenMigration: readonly string[]): SoDem {
  const hang = cay.co(TEP_STATE) ? cacHangSoNo(cay.dong(TEP_STATE)) : [];
  return {
    adr: cay.co(TEP_QUYET_DINH) ? [...cay.van(TEP_QUYET_DINH).matchAll(/^## ADR-/gm)].length : 0,
    khoanTong: hang.length,
    khoanMo: hang.filter((h) => !h.dong).length,
    migration: new Set(tenMigration.map((t) => RE_TEN_MIGRATION.exec(t)?.[1]).filter((s) => s !== undefined)).size,
  };
}

function vietLaiKhai(cay: CayLamViec, tenMigration: readonly string[]): void {
  const so = soDem(cay, tenMigration);
  if (cay.co(TEP_STATE)) cay.datVan(TEP_STATE, capNhatKhai(capNhatTongKet(cay.van(TEP_STATE)), so, HO_KHAI_STATE));
  if (cay.co(TEP_HANDOFF)) cay.datVan(TEP_HANDOFF, capNhatKhai(cay.van(TEP_HANDOFF), so, HO_KHAI_HANDOFF));
}

function tenMigrationTrenDia(goc: string): string[] {
  const thuMuc = join(goc, THU_MUC_MIGRATION);
  return existsSync(thuMuc) ? readdirSync(thuMuc).filter((t) => t.endsWith(".sql")) : [];
}

// ---- Cấp số --------------------------------------------------------------------------------

export interface KetQuaCapSo {
  readonly bang: BangCap;
  readonly doiTen: ReadonlyArray<readonly [string, string]>;
  readonly tepDaGhi: readonly string[];
  readonly bao: readonly string[];
  readonly trailer: string | null;
}

export interface TuyChonCapSo {
  readonly base: string;
  /** Bảng cấp viết tay (`vong 9101=141; adr 9201=083`) cho số thật mà nhánh tự đặt trước khi có lệnh này. */
  readonly cu?: string;
}

export function capSo(goc: string, tuyChon: TuyChonCapSo): KetQuaCapSo {
  const { base } = tuyChon;
  if (gitThu(goc, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).ma !== 0) {
    throw new CapSoError(`không thấy ${base} — chạy \`git fetch origin master\` trước`);
  }
  const bao: string[] = [];
  giaiXungDot(goc, bao);

  const dangMerge = gitThu(goc, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).ma === 0;
  const daChua =
    gitThu(goc, ["merge-base", "--is-ancestor", base, "HEAD"]).ma === 0 ||
    (dangMerge && gitThu(goc, ["merge-base", "--is-ancestor", base, "MERGE_HEAD"]).ma === 0);
  if (!daChua) {
    throw new CapSoError(
      `nhánh chưa chứa ${base}: chạy \`git merge ${base}\` trước — số phải cấp SAU khi đã thấy mọi số của ${base}`,
    );
  }

  const max = maxTrenBase(goc, base);
  const dongNhanh = dongCuaNhanh(goc, base);
  const lich: LanCapCu[] = [...lichSuCap(goc, base)];
  if (tuyChon.cu !== undefined) lich.unshift({ bang: docTrailer(tuyChon.cu), capDong: new Map(), doiTen: new Map() });

  // Migration của nhánh: tệp đánh số mà base không có.
  const tenTrenBase = new Set(
    gitThu(goc, ["ls-tree", "--name-only", `${base}:${THU_MUC_MIGRATION}`]).ra.split("\n").map((t) => t.trim()),
  );
  const migrationNhanh = tenMigrationTrenDia(goc)
    .filter((t) => !tenTrenBase.has(t) && RE_TEN_MIGRATION.test(t))
    .map((t) => {
      const m = RE_TEN_MIGRATION.exec(t)!;
      return { ten: t, so: Number(m[1]), duoi: m[2]! };
    });
  const duoiNhanh = new Set(migrationNhanh.map((x) => x.duoi));

  // Bước 1 — thu hồi: trả mọi dòng của nhánh về bản số tạm.
  const cay = new CayLamViec(goc);
  for (const [p, cacDong] of dongNhanh) {
    const dong = cay.dong(p);
    for (const so of cacDong) {
      const i = so - 1;
      if (i < 0 || i >= dong.length) continue;
      let van = dong[i]!;
      let duong = p;
      for (const lan of lich) {
        const truoc = lan.capDong.get(duong)?.get(van);
        if (truoc !== undefined) {
          van = truoc;
          duong = lan.doiTen.get(duong) ?? duong;
          continue;
        }
        van = thuHoiTheoToken(van, lan.bang, duoiNhanh, p === TEP_STATE);
        break;
      }
      dong[i] = van;
    }
  }
  const tamCuaMigration = migrationNhanh.map((x) => {
    let so = x.so;
    if (dayCuaSoTam(so) !== "migration") {
      for (const lan of lich) {
        const tam = dao(lan.bang.migration).get(so);
        if (tam !== undefined) {
          so = tam;
          break;
        }
      }
    }
    return { ...x, tam: so };
  });

  // Bước 2 — gom số tạm đã khai.
  const loi: string[] = [];
  const khai = { vong: new Set<number>(), adr: new Set<number>(), khoan: new Set<number>(), migration: new Set<number>() };
  const dauMucAdr: number[] = [];
  const hangKhoan: number[] = [];
  for (const [p, cacDong] of dongNhanh) {
    const dong = cay.dong(p);
    const khoi = p === TEP_STATE ? khoiSoNo(dong) : null;
    for (const so of cacDong) {
      const l = dong[so - 1];
      if (l === undefined) continue;
      for (const m of l.matchAll(/S1\.(\d+)(?!\d)/g)) if (dayCuaSoTam(Number(m[1])) === "vong") khai.vong.add(Number(m[1]));
      const adr = /^## ADR-(\d+)(?!\d)/.exec(l);
      if (p === TEP_QUYET_DINH && adr !== null && dayCuaSoTam(Number(adr[1])) === "adr") dauMucAdr.push(Number(adr[1]));
      const hang = RE_HANG_SO_NO.exec(l);
      if (khoi !== null && so - 1 >= khoi.tu && so - 1 < khoi.den && hang !== null && dayCuaSoTam(Number(hang[1])) === "khoan") {
        hangKhoan.push(Number(hang[1]));
      }
    }
  }
  for (const k of trung(dauMucAdr)) loi.push(`${TEP_QUYET_DINH}: hai đầu mục ADR-${k}`);
  for (const k of trung(hangKhoan)) loi.push(`${TEP_STATE}: hai hàng sổ nợ khoản ${k}`);
  for (const k of trung(tamCuaMigration.filter((x) => dayCuaSoTam(x.tam) === "migration").map((x) => x.tam))) {
    loi.push(`${THU_MUC_MIGRATION}: hai migration cùng số tạm ${k}`);
  }
  for (const n of dauMucAdr) khai.adr.add(n);
  for (const n of hangKhoan) khai.khoan.add(n);
  for (const x of tamCuaMigration) if (dayCuaSoTam(x.tam) === "migration") khai.migration.add(x.tam);

  // Bước 3 — cấp: số tạm theo thứ tự → max(base)+1, +2, …
  const bang = bangRong();
  for (const d of CAC_DAY) [...khai[d]].sort((a, b) => a - b).forEach((tam, k) => bang[d].set(tam, max[d] + k + 1));

  for (const [p, cacDong] of dongNhanh) {
    const dong = cay.dong(p);
    for (const so of cacDong) {
      const i = so - 1;
      if (i < 0 || i >= dong.length) continue;
      const moi = thaySoTam(dong[i]!, bang);
      dong[i] = moi;
      for (const m of moi.matchAll(/(?<!\d)(9[1245]\d\d)(?!\d)/g)) {
        const d = dayCuaSoTam(Number(m[1]));
        const coTienTo =
          (d === "vong" && moi.slice(0, m.index).endsWith("S1.")) ||
          (d === "adr" && moi.slice(0, m.index).endsWith("ADR-")) ||
          (d === "khoan" && /khoản(?: nợ)?\s+$/.test(moi.slice(0, m.index))) ||
          (d === "migration" && /^_[A-Za-z0-9_]+\.sql/.test(moi.slice(m.index + 4)));
        if (coTienTo) loi.push(`${p}:${so}: số tạm ${m[1]} không có chỗ khai (đầu mục ADR, hàng sổ nợ hay tệp migration)`);
      }
    }
  }
  const doiTen: Array<readonly [string, string]> = [];
  for (const x of tamCuaMigration) {
    const that = bang.migration.get(x.tam);
    const moi = that === undefined ? x.ten : `${dinhDang("migration", that)}${x.duoi}`;
    if (moi !== x.ten) doiTen.push([`${THU_MUC_MIGRATION}/${x.ten}`, `${THU_MUC_MIGRATION}/${moi}`]);
  }
  const tenSauCung = tenMigrationTrenDia(goc).map((t) => {
    const cap = doiTen.find(([cu]) => cu === `${THU_MUC_MIGRATION}/${t}`);
    return cap === undefined ? t : cap[1].slice(THU_MUC_MIGRATION.length + 1);
  });

  // Bước 4 — lời khai đếm, rồi kiểm trùng trên kết quả.
  vietLaiKhai(cay, tenSauCung);
  loi.push(...kiemTrung(cay, tenSauCung));
  if (loi.length > 0) throw new CapSoError(`không ghi gì, vì:\n  - ${loi.join("\n  - ")}`);

  const tepDaGhi = cay.ghi();
  for (const [cu, moi] of doiTen) {
    if (gitThu(goc, ["ls-files", "--error-unmatch", "--", cu]).ma === 0) git(goc, ["mv", "--", cu, moi]);
    else renameSync(join(goc, cu), join(goc, moi));
  }
  return { bang, doiTen, tepDaGhi, bao, trailer: bangTrong(bang) ? null : vietTrailer(bang) };
}

/** `--dem`: chỉ gỡ xung đột lời khai và viết lại lời khai đếm, không cấp số. */
export function demLai(goc: string): { readonly tepDaGhi: readonly string[]; readonly bao: readonly string[] } {
  const bao: string[] = [];
  giaiXungDot(goc, bao);
  const cay = new CayLamViec(goc);
  vietLaiKhai(cay, tenMigrationTrenDia(goc));
  return { tepDaGhi: cay.ghi(), bao };
}

// ---- Dòng lệnh -----------------------------------------------------------------------------

const HUONG_DAN = `pnpm cap-so [--base <ref>] [--cu "<bảng>"]   cấp số cho mọi số tạm của nhánh
pnpm cap-so --dem                           chỉ viết lại lời khai đếm (còn số tạm)
pnpm cap-so --kiem                          cho CI: đỏ nếu còn số tạm hay số trùng

Số tạm: vòng S1.91NN · ADR-92NN · khoản 94NN · migration 95NN_ten.sql (NN = 01, 02, …).
Trình tự trước khi merge: git fetch origin master && git merge origin/master && pnpm cap-so,
rồi commit kết quả với dòng trailer lệnh in ra.`;

export function main(thamSo: readonly string[], goc: string): number {
  const coCo = (c: string): boolean => thamSo.includes(c);
  const giaTri = (c: string): string | undefined => {
    const i = thamSo.indexOf(c);
    return i < 0 ? undefined : thamSo[i + 1];
  };
  if (coCo("--help") || coCo("-h")) {
    stdout.write(`${HUONG_DAN}\n`);
    return 0;
  }
  try {
    if (coCo("--kiem")) {
      const loi = kiem(goc);
      for (const l of loi) console.error(l);
      if (loi.length === 0) stdout.write("cap-so --kiem: không còn số tạm, không có số trùng\n");
      return loi.length === 0 ? 0 : 1;
    }
    if (coCo("--dem")) {
      const kq = demLai(goc);
      for (const b of kq.bao) stdout.write(`${b}\n`);
      stdout.write(kq.tepDaGhi.length === 0 ? "lời khai đếm đã khớp\n" : `đã viết lại: ${kq.tepDaGhi.join(", ")}\n`);
      return 0;
    }
    const kq = capSo(goc, { base: giaTri("--base") ?? "origin/master", cu: giaTri("--cu") });
    for (const b of kq.bao) stdout.write(`${b}\n`);
    for (const d of CAC_DAY) {
      for (const [tam, that] of [...kq.bang[d]].sort((a, b) => a[0] - b[0])) stdout.write(`${d.padEnd(9)} ${tam} → ${dinhDang(d, that)}\n`);
    }
    for (const [cu, moi] of kq.doiTen) stdout.write(`đổi tên   ${cu} → ${moi}\n`);
    stdout.write(kq.tepDaGhi.length === 0 ? "không tệp nào đổi\n" : `đã ghi: ${kq.tepDaGhi.join(", ")}\n`);
    if (kq.trailer !== null) stdout.write(`\nThêm dòng này vào cuối thông điệp commit:\n${kq.trailer}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof CapSoError)) throw e;
    stderr.write(`cap-so: ${e.message}\n`);
    return 1;
  }
}

if (argv[1] !== undefined && fileURLToPath(import.meta.url) === argv[1]) {
  exit(main(argv.slice(2), git(cwd(), ["rev-parse", "--show-toplevel"]).trim()));
}
