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
 * Giới hạn nói ra (lượt soi 29 INFO-11): cắt `pg_catalog.format(` ở dấu `)` ĐẦU TIÊN — đúng chừng nào tham
 * số không chứa ngoặc; chỉ nhận hằng thụt đúng hai khoảng trắng.
 */
export function docHangHardening(hardeningSql: string, ten: string): string {
  const dau = hardeningSql.indexOf(`\n  ${ten} constant text :=`);
  if (dau < 0) throw new Error(`không thấy hằng ${ten} trong hardening.always.sql`);
  let i = hardeningSql.indexOf(":=", dau) + 2;
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
      const cuoi = hardeningSql.indexOf(")", i);
      const [mau, ...thamSo] = hardeningSql
        .slice(i + "pg_catalog.format(".length, cuoi)
        .split(",")
        .map((t) => t.trim().replace(/^'|'$/gu, ""));
      let van = docHangHardening(hardeningSql, mau!);
      thamSo.forEach((t, k) => {
        van = van.replaceAll(`%${k + 1}$s`, t);
      });
      ra += van.replaceAll("%%", "%");
      i = cuoi + 1;
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
