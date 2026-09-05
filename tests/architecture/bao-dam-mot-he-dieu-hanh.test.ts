// ==============================================================================================
// [khoản nợ 20] MỘT BẢO ĐẢM CHỈ ĐÚNG TRÊN MỘT HỆ ĐIỀU HÀNH — NAY CÓ LỚP BẮT ĐƯỢC
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// Lượt CI đầu tiên tìm ra ĐÚNG MỘT ca — một `import` viết sai hoa-thường, vô hình trên Windows và
// chết trên Linux — và ca đó đã sửa. Thứ KHÔNG được sửa là **cơ chế phát hiện**: nó vẫn là *"chạy
// trên hệ điều hành thứ hai rồi xem cái gì đỏ"*. CI thì chỉ có `ubuntu-latest`, nên chiều ngược
// lại — một bảo đảm chỉ đúng trên Linux — hôm nay không lớp nào bắt được.
//
// ----------------------------------------------------------------------------------------------
// MỘT ĐIỀU TÔI ĐÃ ĐOÁN SAI, VÀ PHÉP ĐO ĐÃ SỬA LẠI
// ----------------------------------------------------------------------------------------------
// Bản đầu của file này canh **đường dẫn `import`** viết sai hoa-thường, với giả định `tsc` không
// thấy. Tôi đã đo thay vì tin: đổi `./comparison.js` thành `./Comparison.js` ở
// `packages/unseal/src/index.ts` — một module chỉ có ĐÚNG MỘT nơi import — rồi chạy `pnpm
// typecheck` trên chính máy Windows này:
//
//     error TS1261: Already included file name '.../Comparison.ts' differs from file name
//     '.../comparison.ts' only in casing.
//
// `tsc` bắt được, vì `include: packages/**/*.ts` đã kéo tệp vào chương trình dưới tên THẬT, nên
// nó luôn có một bản đối chiếu. Tức **trục `import` đã có chủ**, và thêm một lớp nữa cho nó chỉ
// là trang trí. Vế ấy đã bị gỡ khỏi file này.
//
// Thứ CÒN LẠI không có chủ, và đó là thứ file này đo:
//
//   ⑴ **Đường dẫn dạng CHUỖI lúc chạy.** `new URL("../../../db/migrations", import.meta.url)` và
//     họ hàng của nó không đi qua trình phân giải module, nên `tsc` mù hoàn toàn với chúng. Kho
//     này có hơn năm mươi chỗ như vậy — mọi bộ test tích hợp đều trỏ tới thư mục migration bằng
//     đúng cách ấy. Một chữ hoa sai ở đó chạy ngon trên Windows và ném `ENOENT` trên Linux, và
//     cách duy nhất phát hiện hôm nay là **đẩy lên rồi xem CI đỏ**.
//
//   ⑵ **Hai tệp trong cùng thư mục chỉ khác nhau hoa-thường.** Hợp lệ trên Linux; trên
//     Windows/macOS lần checkout thứ hai GHI ĐÈ lần thứ nhất và một tệp biến mất không tiếng
//     động. Đây là hướng ngược của cùng khoản nợ, và nó rẻ tới mức không đo mới là lạ.
//
// Lớp thứ hai của khoản nợ 20 nằm ngoài file này: job T1+T2 nay chạy trên CẢ `ubuntu-latest` lẫn
// `windows-latest` (`.github/workflows/ci.yml`). Hai lớp không thay thế nhau — ma trận bắt được
// thứ CHƯA AI BIẾT TÊN, file này bắt được thứ đã biết tên NGAY TRÊN MÁY, trước khi có commit.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

function tepTheoGit(...mau: string[]): string[] {
  return execFileSync("git", ["ls-files", ...mau], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((t) => t.length > 0);
}

/**
 * Đường dẫn `p` (tuyệt đối, nằm trong `GOC`) có khớp ĐÚNG hoa-thường với tên thật trên đĩa không.
 *
 * `existsSync` KHÔNG trả lời được câu này trên Windows/macOS — nó trả `true` cho mọi cách viết
 * hoa-thường, và đó chính là lý do khiếm khuyết này vô hình trên máy phát triển. Chỉ `readdirSync`
 * của thư mục cha mới nói ra tên THẬT, nên phép kiểm đi từng đoạn một, từ gốc kho xuống.
 */
function khopDungHoaThuong(p: string): boolean {
  const cacDoan = relative(GOC, p)
    .split(sep)
    .filter((d) => d.length > 0);
  // Ngoài phạm vi kho: không phải việc của lớp này, và cũng không có `readdir` nào để hỏi.
  if (cacDoan[0] === "..") return true;
  let hienTai = GOC;
  for (const doan of cacDoan) {
    let ten: string[];
    try {
      ten = readdirSync(hienTai);
    } catch {
      return false;
    }
    if (!ten.includes(doan)) return false;
    hienTai = join(hienTai, doan);
  }
  return true;
}

/** Mọi `new URL("<đường dẫn tương đối>", import.meta.url)` trong một tệp nguồn. */
function duongDanLucChay(noiDung: string): string[] {
  const ra: string[] = [];
  for (const m of noiDung.matchAll(
    /new URL\(\s*["'](\.[^"']*)["']\s*,\s*import\.meta\.url\s*\)/gu,
  )) {
    const s = m[1];
    if (s !== undefined) ra.push(s);
  }
  return ra;
}

describe("[khoản nợ 20] bảo đảm không được chỉ đúng trên một hệ điều hành", () => {
  it("mọi đường dẫn CHUỖI lúc chạy tồn tại VÀ khớp đúng hoa-thường", () => {
    const cacTep = tepTheoGit("*.ts", "*.mts", "*.mjs", "*.cjs");
    const sai: string[] = [];
    let daKiem = 0;

    for (const t of cacTep) {
      const duongDanTep = join(GOC, t);
      for (const spec of duongDanLucChay(readFileSync(duongDanTep, "utf8"))) {
        // `new URL("...", import.meta.url)` giải tương đối với chính TỆP, nên `../` đầu tiên mới
        // ra tới thư mục chứa nó. `resolve(dirname(tệp), spec)` cho đúng ngữ nghĩa ấy.
        const dich = resolve(dirname(duongDanTep), spec);
        daKiem += 1;
        if (!existsSync(dich)) {
          sai.push(`${t}: new URL("${spec}") trỏ tới ${relative(GOC, dich)} — KHÔNG tồn tại`);
          continue;
        }
        if (!khopDungHoaThuong(dich)) {
          sai.push(
            `${t}: new URL("${spec}") resolve tới ${relative(GOC, dich)} nhưng SAI HOA-THƯỜNG so ` +
              `với tên thật trên đĩa. Máy này mở được; Linux ném ENOENT. \`tsc\` KHÔNG thấy ` +
              `đường dẫn dạng chuỗi, nên đây là lớp duy nhất bắt được nó trước khi CI đỏ.`,
          );
        }
      }
    }

    // Chống rỗng ruột. Một lớp canh quét được 0 đường dẫn là một lớp canh xanh vĩnh viễn — đúng
    // khuôn hỏng đã bắt được ba lần ở dự án này. Sàn suy từ phép đếm THẬT ngày 2026-09-05
    // (hơn 50 lời gọi trong kho), đặt dưới nó một quãng để không đỏ vì một lần dọn dẹp bình thường.
    expect(daKiem, "phép quét không thấy đủ đường dẫn — regex đã thiu, không phải kho đã sạch")
      .toBeGreaterThan(30);
    expect(sai).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: chính phép kiểm ấy BÁC BỎ một đường dẫn sai hoa-thường", () => {
    // Không có vế này thì `khopDungHoaThuong` có thể chỉ đang trả `true` cho mọi thứ. Lấy một
    // đường dẫn CÓ THẬT rồi viết hoa lên: `existsSync` vẫn `true` trên Windows/macOS, còn phép
    // kiểm phải nói KHÔNG trên mọi nền tảng.
    const that = join(GOC, "db", "migrations");
    expect(existsSync(that), "thư mục mốc đã đổi tên — cập nhật đối chứng này").toBe(true);
    expect(khopDungHoaThuong(that)).toBe(true);
    expect(khopDungHoaThuong(join(GOC, "db", "Migrations"))).toBe(false);
    expect(khopDungHoaThuong(join(GOC, "DB", "migrations"))).toBe(false);
  });

  it("không hai tệp nào trong cùng thư mục chỉ khác nhau hoa-thường", () => {
    // Đo trên danh sách của `git` chứ không trên đĩa — vì trên chính máy này, một cặp như thế đã
    // bị hệ thống file làm cho vô hình rồi. Đây là chỗ duy nhất sự thật còn nguyên.
    const theoThuMuc = new Map<string, Map<string, string[]>>();
    for (const t of tepTheoGit()) {
      const thuMuc = t.includes("/") ? t.slice(0, t.lastIndexOf("/")) : ".";
      const ten = t.slice(t.lastIndexOf("/") + 1);
      const bang = theoThuMuc.get(thuMuc) ?? new Map<string, string[]>();
      const khoa = ten.toLowerCase();
      bang.set(khoa, [...(bang.get(khoa) ?? []), ten]);
      theoThuMuc.set(thuMuc, bang);
    }
    const dungDo: string[] = [];
    for (const [thuMuc, bang] of theoThuMuc) {
      for (const [, ten] of bang) {
        if (ten.length > 1) dungDo.push(`${thuMuc}/: ${ten.join(" ↔ ")}`);
      }
    }
    expect(theoThuMuc.size, "git ls-files không trả về gì — phép đo rỗng ruột").toBeGreaterThan(10);
    expect(dungDo).toEqual([]);
  });
});
