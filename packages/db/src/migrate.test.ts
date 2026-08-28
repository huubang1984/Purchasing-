import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrationChecksum } from "./migrate.js";

// ============================================================================================
// [PHẦN 0 — lỗi tiền tồn từ Task 1] CHECKSUM MIGRATION PHẢI ĐỘC LẬP NỀN TẢNG
//
// `core.autocrlf=true` là mặc định của Git for Windows (đo trong worktree này:
// "file:C:/Program Files/Git/etc/gitconfig  core.autocrlf=true"), và repo KHÔNG có
// .gitattributes. Hệ quả đo được ngay tại HEAD 8927cc4, trước bản vá:
//
//   $ git ls-files --eol db/migrations/
//   i/lf  w/crlf  db/migrations/001_roles_and_functions.sql
//   i/lf  w/crlf  db/migrations/002_organizations_and_users.sql
//   i/lf  w/lf    db/migrations/003_audit_events.sql
//   i/lf  w/lf    db/migrations/004_audit_chain_functions.sql
//
// Blob trong Git là LF ở CẢ BỐN file; CÂY LÀM VIỆC thì lai — 001/002 là CRLF, 003/004 là LF.
// `migrate()` băm cái nó ĐỌC TỪ ĐĨA, nên checksum của cùng một commit khác nhau giữa hai
// checkout (đo bằng sha256 thật, 24 ký tự đầu):
//   001  CRLF 471fac22d8e55d741f21cd59   LF f4f638210c0291098f96a7a4
//   002  CRLF cf83769ef418fdc018339c7b   LF d7c58c8c0e612293f4bccf97
//
// Một CI Linux (LF) deploy vào DB từng migrate từ máy Windows (CRLF) — hoặc ngược lại — gãy
// với "Migration ... đã bị sửa nội dung sau khi áp dụng — checksum không khớp". `[fix S7]`
// chạy ĐÚNG thiết kế; thứ sai là ĐẦU VÀO của nó phụ thuộc nền tảng.
//
// Vì sao vá bằng cách chuẩn hoá TRONG hàm băm chứ không chỉ bằng .gitattributes: xem khối
// "CHUẨN HOÁ XUỐNG DÒNG" ở packages/db/src/migrate.ts.
// ============================================================================================

/** Cùng một migration, viết bằng ba quy ước xuống dòng khác nhau. */
const SQL_LF = "-- chú thích\nCREATE TABLE t (\n  id int\n);\n";
const SQL_CRLF = SQL_LF.replace(/\n/g, "\r\n");
const SQL_CR = SQL_LF.replace(/\n/g, "\r");

describe("checksum migration", () => {
  it("[PHẦN 0] cùng nội dung với CRLF và với LF cho CÙNG checksum", () => {
    expect(SQL_CRLF).not.toBe(SQL_LF); // chống rỗng ruột: hai chuỗi THẬT SỰ khác byte
    expect(migrationChecksum(SQL_CRLF)).toBe(migrationChecksum(SQL_LF));
  });

  it("[PHẦN 0] CR đơn lẻ (quy ước Mac cổ điển) cũng quy về cùng checksum", () => {
    // `\r\n` -> `\n` một mình KHÔNG đủ: một file toàn `\r` vẫn băm ra giá trị thứ ba. Đây là
    // chỗ mà đơn thuốc ("chuẩn hoá xuống dòng") không nói rõ nên dễ viết hụt.
    expect(SQL_CR).not.toBe(SQL_LF);
    expect(migrationChecksum(SQL_CR)).toBe(migrationChecksum(SQL_LF));
  });

  it("[PHẦN 0] checksum của bản LF vẫn ĐÚNG BẰNG sha256 của chính byte LF — không đổi thuật toán", () => {
    // Bản vá chỉ được chuẩn hoá ĐẦU VÀO, không được đổi thuật toán băm: nếu nó đổi, mọi DB đã
    // migrate từ một checkout LF (tức mọi CI Linux) sẽ gãy ở lần deploy kế tiếp. Neo giá trị
    // vào sha256 trần của bản LF khoá đúng tính chất đó.
    expect(migrationChecksum(SQL_LF)).toBe(
      createHash("sha256").update(SQL_LF, "utf8").digest("hex"),
    );
  });

  it("[PHẦN 0 — hồi quy] sửa CHÚ THÍCH vẫn đổi checksum; chỉ xuống dòng là không tính", () => {
    // Bản vá KHÔNG được nới lỏng `[fix S7]` ra ngoài đúng một trục. Chú thích là ca đo được
    // của Task 6 ("sửa CHÚ THÍCH của một migration ĐÃ ÁP DỤNG = sửa migration đã áp dụng").
    const doiChuThich = SQL_LF.replace("-- chú thích", "-- chú thích khác");
    expect(migrationChecksum(doiChuThich)).not.toBe(migrationChecksum(SQL_LF));

    // Và mọi thay đổi nội dung thật khác vẫn đổi checksum.
    const doiNoiDung = SQL_LF.replace("id int", "id int, ten text");
    expect(migrationChecksum(doiNoiDung)).not.toBe(migrationChecksum(SQL_LF));

    // Khoảng trắng KHÁC xuống dòng cũng vẫn tính — chuẩn hoá không được lan sang trim/space.
    const themKhoangTrang = SQL_LF.replace("  id int", "    id int");
    expect(migrationChecksum(themKhoangTrang)).not.toBe(migrationChecksum(SQL_LF));
  });

  it("[PHẦN 0] .gitattributes khoá xuống dòng của mọi file .sql — lớp thứ hai phải load-bearing", async () => {
    // Không có khẳng định này, XOÁ .gitattributes là một đột biến KHÔNG GIẾT ĐƯỢC test nào:
    // `migrationChecksum()` một mình đã làm mọi test khác xanh. Mà .gitattributes không thừa —
    // nó đóng dư lượng "\r\n trong một chuỗi ký tự SQL" mà lớp băm cố ý không đóng (xem khối
    // chú thích trong chính file .gitattributes). Một lớp có tác dụng thật thì phải bị khoá;
    // một lớp không khoá được là một lớp không ai biết khi nào nó biến mất.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const noiDung = await readFile(
      fileURLToPath(new URL("../../../.gitattributes", import.meta.url)),
      "utf8",
    );
    const cacDong = noiDung
      .split(/\r\n?|\n/)
      .map((d) => d.trim())
      .filter((d) => d !== "" && !d.startsWith("#"));
    expect(
      cacDong,
      ".gitattributes phải khai đúng quy tắc xuống dòng cho file .sql — xem PHẦN 0.",
    ).toContain("*.sql text eol=lf");
  });

  it("[PHẦN 0] mọi file .sql THẬT của dự án đều băm ra giá trị của bản LF", async () => {
    // Phép kiểm hồi quy đọc CHÍNH các file migration của dự án: nếu ai đó gỡ bước chuẩn hoá,
    // test này đỏ trên bất kỳ checkout Windows nào (001/002 là CRLF trong cây làm việc) —
    // nhưng nó cũng phải đỏ trên checkout LF, nên nó tự dựng bản CRLF thay vì tin vào đĩa.
    const { readFile, readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const thuMuc = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
    const cacFile = (await readdir(thuMuc)).filter((f) => f.endsWith(".sql")).sort();

    expect(cacFile.length, "không có file migration nào — phép kiểm rỗng ruột").toBeGreaterThan(0);

    for (const ten of cacFile) {
      const noiDung = await readFile(`${thuMuc}/${ten}`, "utf8");
      const banLf = noiDung.replace(/\r\n?/g, "\n");
      const banCrlf = banLf.replace(/\n/g, "\r\n");
      expect(migrationChecksum(noiDung), `${ten}: checksum phụ thuộc xuống dòng`).toBe(
        migrationChecksum(banLf),
      );
      expect(migrationChecksum(banCrlf), `${ten}: checksum phụ thuộc xuống dòng`).toBe(
        migrationChecksum(banLf),
      );
    }
  });
});
