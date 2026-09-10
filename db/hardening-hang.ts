/**
 * [S1.38 / S1.39 — khoản nợ 83] Giải một hằng `NAME constant text := <expr>;` của
 * `db/migrations/hardening.always.sql` thành SQL chạy được, để test chạy CHÍNH câu phán xét của hardening
 * trên cùng CSDL thay vì chỉ so văn bản.
 *
 * Cú pháp hiểu được — và CHỈ những thứ này: `$q$…$q$` là nguyên văn; `|| NAME ||` là hằng khác (đệ quy);
 * `pg_catalog.format(NAME, 'a', 'b')` thay `%1$s`/`%2$s` rồi `%%` → `%`. Dấu `;` chỉ kết thúc khi đứng
 * NGOÀI literal. Cố ý không hiểu gì khác: một hằng định nghĩa bằng CASE hay chú thích `--` giữa các mảnh
 * làm hàm này NÉM, tức test đỏ ồn ào chứ không xanh mù (đối chứng: `NEO_003`).
 *
 * ~~Giới hạn nói ra (lượt soi 29 INFO-11): cắt `pg_catalog.format(` ở dấu `)` ĐẦU TIÊN — đúng chừng nào tham
 * số không chứa ngoặc~~ [S1.44 / khoản nợ 88 ⑸ — lượt soi 33a INFO-8] Tham số của `format()` chỉ được là BÍ DANH
 * đơn `'[A-Za-z_][A-Za-z0-9_]*'` hoặc một mẫu `%n$s` chuyền tiếp cho format() bọc ngoài (cách MAU_VI_TU_BANG_TENANT
 * dùng MAU_VI_TU_CO_ORG_ID); ngoặc, phẩy, khoảng trắng hay mẫu thay thế của JS (`$&`, `$1`) trong tham số đều NÉM
 * thay vì cho ra một câu khác thứ PostgreSQL chạy; thay `%n$s` bằng split/join (không qua `replaceAll` chuỗi, vốn
 * hiểu `$` trong vế thay); mẫu `%n$s` với n lớn hơn số tham số NÉM trước khi thay — PostgreSQL ném "too few
 * arguments for format()" ở đúng chỗ ấy; mọi `%` khác ngoài `%n$s`/`%%` trong mẫu cũng NÉM (bộ giải đóng — lượt soi 36 #4).
 * Chỉ nhận hằng thụt đúng hai khoảng trắng (tên có thể đệm để canh cột). Test T1: `db/hardening-hang.test.ts`.
 */
export function docHangHardening(hardeningSql: string, ten: string): string {
  // Tên có thể được ĐỆM khoảng trắng để canh cột (`COT_NEO     constant text :=`) — [S1.44] bản trước đòi đúng một
  // khoảng trắng nên không thấy những hằng ấy.
  const khai = new RegExp(`\\n  ${ten}[ ]+constant text :=`, "u").exec(hardeningSql);
  if (!khai) throw new Error(`không thấy hằng ${ten} trong hardening.always.sql`);
  let i = khai.index + khai[0].length;
  let ra = "";
  for (;;) {
    while (/\s/u.test(hardeningSql[i]!)) i++;
    if (hardeningSql.startsWith("$q$", i)) {
      const cuoi = hardeningSql.indexOf("$q$", i + 3);
      ra += hardeningSql.slice(i + 3, cuoi);
      i = cuoi + 3;
    } else if (hardeningSql.startsWith("||", i)) {
      i += 2;
    } else if (hardeningSql.startsWith("pg_catalog.format(", i)) {
      const mo = i + "pg_catalog.format(".length;
      // Tham số: bí danh đơn, hoặc một mẫu `%n$s` CHUYỀN TIẾP cho format() bọc ngoài (MAU_VI_TU_BANG_TENANT truyền
      // '%2$s' vào MAU_VI_TU_CO_ORG_ID) — đúng hai hình dạng ấy, không gì khác.
      const m = /^([A-Z_0-9]+)((?:,\s*'(?:[A-Za-z_][A-Za-z0-9_]*|%\d+\$s)')*)\)/u.exec(hardeningSql.slice(mo));
      if (!m) throw new Error(`cú pháp lạ ở pg_catalog.format của hằng ${ten}: ${hardeningSql.slice(mo, mo + 60)}`);
      const thamSo = [...m[2]!.matchAll(/'([^']*)'/gu)].map((x) => x[1]!);
      let van = docHangHardening(hardeningSql, m[1]!);
      // Kiểm TRƯỚC khi thay: mẫu %n$s với n lớn hơn số tham số là "too few arguments for format()" ở PostgreSQL.
      for (const [, n] of van.matchAll(/%(\d+)\$s/gu)) {
        if (Number(n) > thamSo.length) {
          throw new Error(`hằng ${m[1]} dùng %${n}$s mà format() ở hằng ${ten} chỉ truyền ${thamSo.length} tham số`);
        }
      }
      thamSo.forEach((t, k) => {
        van = van.split(`%${k + 1}$s`).join(t);
      });
      // [lượt soi 36 #4] Bộ giải ĐÓNG: ngoài `%n$s` (đã thay, hoặc chuyền tiếp) và `%%` thì mọi `%` khác (`%s`, `%I`,
      // `%L`, `%` lẻ) là cú pháp không hiểu — `%s` cho ra một câu KHÁC thứ PostgreSQL chạy mà vẫn là SQL hợp lệ.
      if (van.split("%%").join("").replace(/%\d+\$s/gu, "").includes("%")) {
        throw new Error(`hằng ${m[1]} có mẫu % ngoài văn phạm (%n$s, %%) ở hằng ${ten}`);
      }
      ra += van.split("%%").join("%");
      i = mo + m[0].length;
    } else if (hardeningSql[i] === ";") {
      return ra;
    } else {
      const m = /^[A-Z_0-9]+/u.exec(hardeningSql.slice(i));
      if (!m) throw new Error(`cú pháp lạ ở hằng ${ten}: ${hardeningSql.slice(i, i + 40)}`);
      ra += docHangHardening(hardeningSql, m[0]);
      i += m[0].length;
    }
  }
}

/** Khối `(VALUES …) AS <bí danh>(<cột>)` đúng khuôn hardening; danh sách rỗng ghi một hàng toàn chuỗi rỗng. */
export function khoiValues(hang: readonly (readonly string[])[], biDanh: string, cot: readonly string[]): string {
  const lit = (v: string): string => `'${v.replaceAll("'", "''")}'`;
  const duoi = `) AS ${biDanh}(${cot.join(", ")})`;
  if (hang.length === 0) return `(VALUES (${cot.map(() => "''").join(", ")})${duoi}`;
  return "(VALUES\n" + hang.map((r) => "         (" + r.map(lit).join(", ") + ")").join(",\n") + "\n       " + duoi;
}
