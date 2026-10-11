// ==============================================================================================
// [S1.9101 / S3.9b / K12] BỘ ĐỌC CÂU `RAISE` TRONG THÂN HÀM PL/pgSQL
//
// Phép điều tra K12 (`db/dieu-tra-k12.int.test.ts`) phân loại MỌI chỗ từ chối của lược đồ: mỗi câu `RAISE` mức EXCEPTION trong thân
// cuối của mỗi hàm (`pg_proc.prosrc` sau `migrate()`). Bộ đọc này tách thân thành mã / chuỗi / chú thích trước khi tìm từ khoá — một
// chữ `RAISE` trong chú thích hay trong chuỗi thông điệp không phải một câu; một dấu `;` trong chuỗi không kết thúc câu; một dấu nháy
// trong chú thích không mở chuỗi. Văn bản mẫu đi qua từng nhánh ở đầu tệp test (khuôn `cong-van-ban-can-van-ban-mau`).
//
// Hình dạng đọc được (PL/pgSQL §43.9): `RAISE [mức] 'định dạng' [, đối số…] [USING tùy chọn = biểu thức, …]`,
// `RAISE [mức] tên_điều_kiện [USING …]`, `RAISE [mức] SQLSTATE 'xxxxx' [USING …]`, `RAISE [mức] USING tùy chọn = …`, và `RAISE;`
// (ném lại lỗi đang bắt — không phải chỗ từ chối mới).
// ==============================================================================================

export type MucRaise = "DEBUG" | "LOG" | "INFO" | "NOTICE" | "WARNING" | "EXCEPTION" | "NEM_LAI";

export interface CauRaise {
  readonly muc: MucRaise;
  /** Mã lỗi viết thường, không nháy: `check_violation`, `23514`… Không khai ⇒ `raise_exception` (P0001). */
  readonly errcode: string;
  /** `CONSTRAINT = '…'` là chuỗi hằng ⇒ tên; biểu thức ⇒ `null` và `rangBuocDong` mang biểu thức. */
  readonly rangBuoc: string | null;
  readonly rangBuocDong: string | null;
  /** Câu đã gộp khoảng trắng, bỏ chú thích — để báo lỗi đọc được. */
  readonly cau: string;
}

type Loai = "M" | "C" | "K"; // mã, chuỗi, chú thích

/** Gắn mỗi ký tự một loại. Chú thích khối lồng nhau như PostgreSQL; chuỗi `E'…'` nhận `\'`. */
export function tachLoai(than: string): Loai[] {
  const ra: Loai[] = new Array<Loai>(than.length).fill("M");
  let i = 0;
  const laDinhDanh = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_$]/u.test(c);
  while (i < than.length) {
    const c = than[i];
    const k = than[i + 1];
    if (c === "-" && k === "-") {
      while (i < than.length && than[i] !== "\n") ra[i++] = "K";
      continue;
    }
    if (c === "/" && k === "*") {
      let sau = 0;
      while (i < than.length) {
        if (than[i] === "/" && than[i + 1] === "*") { ra[i] = ra[i + 1] = "K"; i += 2; sau += 1; continue; }
        if (than[i] === "*" && than[i + 1] === "/") { ra[i] = ra[i + 1] = "K"; i += 2; sau -= 1; if (sau === 0) break; continue; }
        ra[i++] = "K";
      }
      continue;
    }
    // [lượt soi §S1.9101 THẤP] Định danh trong nháy kép (`"it's"`) — một dấu nháy đơn bên trong không mở chuỗi. Gắn loại MÃ: tên cột hay
    // biến không phải thông điệp, nhưng phải đi qua trọn khối để không đảo trạng thái.
    if (c === "\"") {
      i += 1;
      while (i < than.length) {
        if (than[i] === "\"" && than[i + 1] === "\"") { i += 2; continue; }
        if (than[i] === "\"") { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === "'") {
      const thoat = (than[i - 1] === "E" || than[i - 1] === "e") && !laDinhDanh(than[i - 2]);
      ra[i++] = "C";
      while (i < than.length) {
        if (thoat && than[i] === "\\") { ra[i] = "C"; if (i + 1 < than.length) ra[i + 1] = "C"; i += 2; continue; }
        if (than[i] === "'" && than[i + 1] === "'") { ra[i] = ra[i + 1] = "C"; i += 2; continue; }
        if (than[i] === "'") { ra[i++] = "C"; break; }
        ra[i++] = "C";
      }
      continue;
    }
    if (c === "$" && !laDinhDanh(than[i - 1])) {
      const m = /^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u.exec(than.slice(i));
      if (m !== null) {
        const the = m[0];
        const het = than.indexOf(the, i + the.length);
        const cuoi = het < 0 ? than.length : het + the.length;
        for (let j = i; j < cuoi; j += 1) ra[j] = "C";
        i = cuoi;
        continue;
      }
    }
    i += 1;
  }
  return ra;
}

const MUC: readonly MucRaise[] = ["DEBUG", "LOG", "INFO", "NOTICE", "WARNING", "EXCEPTION"];

/** Đọc một chuỗi hằng bắt đầu ở `vi` (dấu nháy) trong `cau` — trả nội dung đã bỏ nháy và vị trí sau nó. */
function docChuoi(cau: string, vi: number): { readonly giaTri: string; readonly sau: number } {
  let i = vi + 1;
  let ra = "";
  while (i < cau.length) {
    if (cau[i] === "'" && cau[i + 1] === "'") { ra += "'"; i += 2; continue; }
    if (cau[i] === "'") return { giaTri: ra, sau: i + 1 };
    ra += cau[i];
    i += 1;
  }
  return { giaTri: ra, sau: i };
}

/** Thân hàm với chú thích thành khoảng trắng (chuỗi giữ nguyên) — để một `RETURN 'MÃ'` bị chú thích không còn là mã sống. */
export function boChuThich(than: string): string {
  const loai = tachLoai(than);
  return than.split("").map((c, i) => (loai[i] === "K" ? " " : c)).join("");
}

/** Mọi câu `RAISE` của một thân hàm, theo thứ tự xuất hiện. */
export function docRaise(than: string): CauRaise[] {
  const loai = tachLoai(than);
  // Chú thích thành khoảng trắng; chuỗi giữ nguyên — vị trí khớp `loai`. [lượt soi §S1.9101 THẤP] Theo ĐƠN VỊ UTF-16 (`split("")`), cùng
  // phép đánh chỉ số của `tachLoai` — `[...s]` đi theo điểm mã và lệch một ô sau mỗi ký tự ngoài mặt phẳng cơ bản.
  const sach = than.split("").map((c, i) => (loai[i] === "K" ? " " : c)).join("");
  const ra: CauRaise[] = [];
  const re = /\bRAISE\b/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sach)) !== null) {
    const dau = m.index;
    if (loai[dau] !== "M") continue;
    const truoc = sach[dau - 1];
    if (truoc !== undefined && /[\p{L}\p{N}_.]/u.test(truoc)) continue;
    let het = dau;
    while (het < sach.length && !(sach[het] === ";" && loai[het] === "M")) het += 1;
    const cauGoc = sach.slice(dau, het);
    // Bản mặt nạ: nội dung chuỗi thành `x` (giữ nháy, giữ vị trí) — tìm từ khoá không bao giờ trúng chữ trong thông điệp.
    const matNa = cauGoc.split("").map((c, j) => (loai[dau + j] === "C" && c !== "'" ? "x" : c)).join("");
    const conLai = matNa.slice(5).trimStart();
    const lechDau = matNa.length - conLai.length;
    if (conLai.trim() === "") {
      ra.push({ muc: "NEM_LAI", errcode: "", rangBuoc: null, rangBuocDong: null, cau: "RAISE" });
      continue;
    }
    const tuDau = /^([A-Za-z_]+)/u.exec(conLai)?.[1]?.toUpperCase();
    const muc: MucRaise = tuDau !== undefined && (MUC as readonly string[]).includes(tuDau) ? (tuDau as MucRaise) : "EXCEPTION";
    let vi = lechDau + (tuDau !== undefined && (MUC as readonly string[]).includes(tuDau) ? tuDau.length : 0);
    while (/\s/u.test(matNa[vi] ?? "")) vi += 1;
    let errcode: string | null = null;
    // `RAISE [mức] SQLSTATE 'xxxxx'` hay `RAISE [mức] tên_điều_kiện` (không phải chuỗi, không phải USING).
    const sauMuc = matNa.slice(vi);
    const sqlstate = /^SQLSTATE\s+'/iu.exec(sauMuc);
    if (sqlstate !== null) {
      errcode = docChuoi(cauGoc, vi + sqlstate[0].length - 1).giaTri.toLowerCase();
    } else {
      const dieuKien = /^([A-Za-z_][A-Za-z0-9_]*)/u.exec(sauMuc)?.[1];
      if (dieuKien !== undefined && dieuKien.toUpperCase() !== "USING") errcode = dieuKien.toLowerCase();
    }
    const using = /\bUSING\b/iu.exec(matNa.slice(vi));
    let rangBuoc: string | null = null;
    let rangBuocDong: string | null = null;
    if (using !== null) {
      const tuUsing = vi + using.index + using[0].length;
      const docTuyChon = (ten: string): { readonly chuoi: string | null; readonly bieuThuc: string | null } | null => {
        const t = new RegExp(String.raw`\b${ten}\s*=\s*`, "iu").exec(matNa.slice(tuUsing));
        if (t === null) return null;
        const batDau = tuUsing + t.index + t[0].length;
        if (cauGoc[batDau] === "'") {
          // [lượt soi §S1.9101 THẤP] Chuỗi hằng ĐỨNG MỘT MÌNH mới là tên: `'k1_' || x` là một biểu thức — tên lúc chạy khác `k1_`.
          const ch = docChuoi(cauGoc, batDau);
          if (/^\s*(?:,|$)/u.test(matNa.slice(ch.sau))) return { chuoi: ch.giaTri, bieuThuc: null };
        }
        // Biểu thức: tới dấu phẩy ở cấp ngoặc 0 ngoài chuỗi.
        let j = batDau;
        let ngoac = 0;
        while (j < matNa.length) {
          const c = matNa[j];
          if (c === "(") ngoac += 1;
          else if (c === ")") ngoac -= 1;
          else if (c === "," && ngoac === 0) break;
          j += 1;
        }
        return { chuoi: null, bieuThuc: cauGoc.slice(batDau, j).replace(/\s+/gu, " ").trim() };
      };
      const ec = docTuyChon("ERRCODE");
      if (ec !== null) errcode = (ec.chuoi ?? ec.bieuThuc ?? "").toLowerCase();
      const rb = docTuyChon("CONSTRAINT");
      if (rb !== null) {
        rangBuoc = rb.chuoi;
        rangBuocDong = rb.bieuThuc;
      }
    }
    ra.push({ muc, errcode: errcode ?? "raise_exception", rangBuoc, rangBuocDong, cau: cauGoc.replace(/\s+/gu, " ").trim().slice(0, 240) });
  }
  return ra;
}
