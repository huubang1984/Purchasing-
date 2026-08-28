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

  // ==========================================================================================
  // [vòng fix 1 — I4] GHIM, KHÔNG NỚI — DƯ LƯỢNG THẬT LÀ **CR ĐƠN LẺ**, KHÔNG PHẢI `\r\n`
  //
  // Commit của PHẦN 0 phát biểu dư lượng là "một `\r\n` nằm TRONG một chuỗi ký tự SQL" và nói
  // `.gitattributes` đóng nó ("làm những byte đó biểu diễn được ổn định"). CẢ HAI VẾ SAI, và
  // sai theo HAI HƯỚNG NGƯỢC NHAU. Đo trong một kho Git sạch có đúng dòng `*.sql text eol=lf`,
  // với file chứa cả `a\rb` lẫn `c\r\nd`:
  //
  //   ca `\r\n`  : git XOÁ CR  (cảnh báo "CRLF will be replaced by LF"). Blob và mọi checkout
  //                mới đều là `c\nd`. Tức KHÔNG "ổn định" — nó bị ÂM THẦM ĐỔI NGỮ NGHĨA SQL.
  //   ca CR ĐƠN LẺ: git GIỮ NGUYÊN BYTE qua cả blob lẫn `git clone` mới
  //                (`git ls-files --eol` -> `i/-text w/-text`).
  //   migrationChecksum(): 'a\rb' và 'a\nb' cho CÙNG một giá trị (đo trực tiếp).
  //
  // => Hai văn bản migration KHÁC BYTE, cùng commit được, cùng checkout ổn định được, CÙNG
  //    CHECKSUM. `[fix S7]` mù với đúng cặp đó, và đường mở ra chính là nhánh `/\r\n?/` (thay
  //    vì `/\r\n/`) mà migrate.ts biện minh như một ĐIỂM MẠNH. Đúng khuôn QT2: một bảo đảm bị
  //    NỚI để mua một phép kiểm, và bậc tự do mới không vào sổ.
  //
  // BẢN VÁ LÀ GHIM, KHÔNG PHẢI NỚI: cấm hẳn byte `\r` trong file migration. Chuẩn hoá vẫn giữ
  // nguyên (nó là thứ đóng lỗ CRLF liên nền tảng); phép kiểm này đóng khoảng trống mà việc
  // chuẩn hoá tạo ra, ở lớp TRƯỚC KHI COMMIT.
  //
  // [QT1 — ai sửa được, bằng cách nào, trong bao lâu] Bất kỳ lập trình viên nào, bằng cách xoá
  // byte CR, TRƯỚC khi commit. Nó đỏ ở CI và trên máy lập trình viên, và KHÔNG BAO GIỜ đỏ trên
  // cụm production — nó không kết nối CSDL, không đọc `schema_migrations`, không chạy trong
  // `migrate()`. Chọn tầng TEST chứ không phải tầng `migrate()` chính vì thế: một phép kiểm
  // tương tự đặt trong `migrate()` sẽ biến một byte thừa thành một cụm không deploy được.
  // ==========================================================================================
  it("[vòng fix 1 — I4] KHÔNG file migration nào được chứa byte CR", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const thuMuc = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
    const cacFile = (await readdir(thuMuc)).filter((f) => f.endsWith(".sql")).sort();

    expect(cacFile.length, "không có file migration nào — phép kiểm rỗng ruột").toBeGreaterThan(0);

    // Đọc dạng BYTE, không phải chuỗi đã giải mã: mục đích là canh byte 0x0D, và một bước giải
    // mã ở giữa là một chỗ nữa để phép kiểm nói về thứ khác với thứ nằm trên đĩa.
    const coCr: string[] = [];
    for (const ten of cacFile) {
      const byte = await readFile(`${thuMuc}/${ten}`);
      const soCr = byte.filter((b) => b === 0x0d).length;
      if (soCr > 0) coCr.push(`${ten} (${String(soCr)} byte CR)`);
    }

    expect(
      coCr,
      "File migration chứa byte CR. Hai văn bản khác nhau đúng ở những byte đó băm ra CÙNG " +
        "checksum, nên `[fix S7]` không phát hiện được việc sửa một migration ĐÃ ÁP DỤNG theo " +
        "trục ấy — và với CR đơn lẻ, Git giữ nguyên byte nên nó tồn tại được lâu dài. Xoá CR " +
        "(chuyển file về LF thuần) trước khi commit.",
    ).toEqual([]);
  });

  it("[vòng fix 1 — I4] phép kiểm CR KHÔNG rỗng ruột — một nội dung có CR phải bị bắt", async () => {
    // Fixture cũng phải chịu đột biến: nếu vòng đếm trên viết sai (vd. so với 0x0a), test kia
    // vẫn xanh trên một cây sạch. Ca đối chứng này chứng minh phép đếm THẬT SỰ bắt được — và
    // nó đo cả hai hình dạng, vì chúng là hai lớp lỗi khác nhau (xem khối chú thích trên).
    const { Buffer } = await import("node:buffer");
    for (const [nhan, noiDung] of [
      ["CR đơn lẻ", "SELECT 'a\rb';\n"],
      ["CRLF", "SELECT 1;\r\n"],
    ] as const) {
      const soCr = Buffer.from(noiDung, "utf8").filter((b) => b === 0x0d).length;
      expect(soCr, nhan).toBeGreaterThan(0);
    }
    expect(Buffer.from("SELECT 1;\n", "utf8").filter((b) => b === 0x0d).length).toBe(0);
  });
});
