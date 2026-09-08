// ==============================================================================================
// [khoản nợ 59] KHOÁ `depcruise` PHẢI THẬT SỰ NỐI TIẾP HAI TIẾN TRÌNH — ĐO, KHÔNG TIN
//
// Bản vá của khoản nợ 59 là một khoá liên tiến trình. Một khoá KHÔNG khoá được thì tệ hơn không
// có khoá: nó biến một lỗi thấy được thành một lỗi thỉnh thoảng, và dán lên đó một cái tên làm
// người đọc yên tâm. Nên tệp này đo chính cái khoá ấy, và đo bằng HAI TIẾN TRÌNH THẬT — đúng cấu
// hình mà vitest dựng ra khi chạy `boundaries.test.ts` và `routes.test.ts` song song.
//
// Phép đo có hai vế, và vế thứ hai mới làm vế thứ nhất có nghĩa:
//   ⑴ CÓ khoá  ⇒ hai khoảng thời gian KHÔNG chồng lấn;
//   ⑵ KHÔNG khoá ⇒ hai khoảng thời gian CÓ chồng lấn.
// Thiếu ⑵ thì ⑴ chỉ chứng minh hai tiến trình tình cờ không gặp nhau.
// ==============================================================================================

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { voiKhoaDepcruise } from "./khoa-depcruise.js";

// Trên Windows, `import "D:\..."` ném ERR_UNSUPPORTED_ESM_URL_SCHEME — phải là một URL file://.
const KHOA_URL = new URL("./khoa-depcruise.ts", import.meta.url).href;
const GIU_MS = 400;

const thuMuc = mkdtempSync(join(tmpdir(), "trustprocure-do-khoa-"));
afterAll(() => rmSync(thuMuc, { recursive: true, force: true }));

/**
 * Đường khoá RIÊNG cho phép đo. Bản đầu để hai tiến trình con dùng đường khoá SẢN XUẤT, và điều đó
 * làm chính phép đo này ĐỎ trong lượt gộp `pnpm test` (hết giờ 60 000 ms) trong khi chạy riêng thì
 * xanh trong 4,6 giây: hai đứa con phải xếp hàng sau những lượt `depcruise` TOÀN KHO thật của
 * `boundaries.test.ts`, mà một lượt như thế giữ khoá hàng chục giây.
 *
 * Đây đúng khuôn đã gặp hai lần (S1.22 tệp container thứ 39, S1.24 tệp thứ 32): một khả năng ĐỎ có
 * sẵn, và vòng này thêm đủ tệp để nó phát ra. Tính chất cần chứng minh — *"khoá nối tiếp được hai
 * tiến trình"* — không phụ thuộc vào việc dùng ĐƯỜNG NÀO, nên tranh chấp với cây nguồn thật ở đây
 * là NHIỄU, không phải tín hiệu.
 */
const KHOA_DO = join(thuMuc, "phep-do.lock");

/** Kịch bản con: giữ (hoặc không giữ) khoá đúng `GIU_MS` mili-giây rồi in ra hai mốc thời gian. */
function vietKichBan(coKhoa: boolean): string {
  const tep = join(thuMuc, coKhoa ? "co-khoa.mjs" : "khong-khoa.mjs");
  const than = [
    `import { voiKhoaDepcruise } from ${JSON.stringify(KHOA_URL)};`,
    "const ngu = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
    "const lam = () => { const batDau = Date.now(); ngu(" + String(GIU_MS) + "); ",
    "  return { batDau, ketThuc: Date.now() }; };",
    coKhoa
      ? `const kq = voiKhoaDepcruise(lam, ${JSON.stringify(KHOA_DO)});`
      : "const kq = lam();",
    "process.stdout.write(JSON.stringify(kq));",
  ].join("\n");
  writeFileSync(tep, than);
  return tep;
}

interface Khoang {
  readonly batDau: number;
  readonly ketThuc: number;
}

async function chayHaiTienTrinh(tep: string): Promise<readonly [Khoang, Khoang]> {
  const mot = (): Promise<Khoang> =>
    new Promise((giaiQuyet, tuChoi) => {
      const con = spawn(process.execPath, ["--experimental-transform-types", tep], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let ra = "";
      let loi = "";
      con.stdout.on("data", (d: Buffer) => (ra += d.toString()));
      con.stderr.on("data", (d: Buffer) => (loi += d.toString()));
      con.on("close", (ma) => {
        if (ma !== 0) tuChoi(new Error(`tiến trình con thoát ${String(ma)}: ${loi}`));
        else giaiQuyet(JSON.parse(ra) as Khoang);
      });
    });
  const [a, b] = await Promise.all([mot(), mot()]);
  return [a, b];
}

/** Hai khoảng chồng lấn khi mốc bắt đầu muộn hơn nằm TRƯỚC mốc kết thúc sớm hơn. */
function chongLan(a: Khoang, b: Khoang): boolean {
  return Math.max(a.batDau, b.batDau) < Math.min(a.ketThuc, b.ketThuc);
}

describe("[khoản nợ 59] khoá depcruise nối tiếp hai TIẾN TRÌNH thật", () => {
  it(
    "CÓ khoá ⇒ hai khoảng KHÔNG chồng lấn; KHÔNG khoá ⇒ CÓ chồng lấn",
    { timeout: 60_000 },
    async () => {
      // Vế ⑵ chạy TRƯỚC: nếu nó không chồng lấn thì máy này không dựng nổi tình huống đua tranh,
      // và vế ⑴ sẽ là một lời khai rỗng — phải biết điều đó trước khi đọc kết quả của vế ⑴.
      const [x, y] = await chayHaiTienTrinh(vietKichBan(false));
      expect(
        chongLan(x, y),
        "hai tiến trình KHÔNG khoá mà vẫn không chồng lấn — phép đo này không dựng được đua tranh",
      ).toBe(true);

      const [a, b] = await chayHaiTienTrinh(vietKichBan(true));
      expect(
        chongLan(a, b),
        `khoá KHÔNG nối tiếp được: ${JSON.stringify({ a, b })}`,
      ).toBe(false);

      // Và nối tiếp phải là nối tiếp THẬT, không phải hai lượt chạy nhanh tới mức không đo được:
      // tổng thời gian của hai lượt có khoá phải ít nhất bằng hai lần thời gian giữ.
      const tong = Math.max(a.ketThuc, b.ketThuc) - Math.min(a.batDau, b.batDau);
      expect(tong).toBeGreaterThanOrEqual(2 * GIU_MS);
    },
  );
});

// ==============================================================================================
// BỐN MŨI ĐO CHO BỐN CHỖ HỎNG MÀ REVIEW AN NINH LƯỢT 16 TÌM RA — xem khối chú thích ⑴–⑷ trong
// `khoa-depcruise.ts`. Mỗi mũi ĐỎ THẬT trên bản đầu tiên, và ba trong bốn đỏ bằng cách TREO chứ
// không bằng một khẳng định sai — nên chúng cần hạn `timeout` của chính `it()` làm lưới.
// ==============================================================================================
describe("[review lượt 16] khoá phải HỎNG TO chứ không được treo im", () => {
  it("⑴ đường khoá KHÔNG DÙNG ĐƯỢC ⇒ NÉM NGAY, không quay vòng vô hạn", { timeout: 20_000 }, () => {
    // Thư mục cha không tồn tại ⇒ `mkdirSync` ném ENOENT, KHÔNG phải EEXIST. Bản đầu nuốt lỗi ấy
    // bằng `catch {}` rồi `statSync` cũng ném, rồi `continue` nhảy vượt cả hạn lẫn giấc ngủ ⇒
    // quay 100% CPU vĩnh viễn, và vì hàm đồng bộ nên `timeout` của `it()` cũng không cứu được.
    // Đây đúng là ca `TMPDIR` trỏ vào thư mục đã bị dọn — không cần kẻ tấn công nào.
    const duong = join(thuMuc, "cha-khong-ton-tai", "depcruise.lock");
    const truoc = Date.now();
    expect(() => voiKhoaDepcruise(() => 1, duong)).toThrow(/ENOENT|no such file/i);
    // Không chỉ "có ném" mà còn "ném NGAY": một bản vá chỉ dời cái treo tới mốc 180 giây vẫn hỏng.
    expect(Date.now() - truoc, "phải ném ngay, không được chờ hết hạn").toBeLessThan(5_000);
  });

  it("⑶ khoá của một tiến trình ĐÃ CHẾT bị thu hồi NGAY — chiều dương", { timeout: 30_000 }, async () => {
    const duong = join(thuMuc, "chu-da-chet.lock");
    mkdirSync(duong, { recursive: true });
    // Một PID có thật và chắc chắn đã chết: lấy của một tiến trình con vừa thoát. Đáng tin hơn
    // hẳn một con số bịa, vốn có thể trùng một tiến trình đang sống.
    writeFileSync(join(duong, "pid"), String(await pidDaChet()), "utf8");

    const truoc = Date.now();
    expect(voiKhoaDepcruise(() => "vao-duoc", duong)).toBe("vao-duoc");
    // Bản đầu hỏi "khoá già hơn 300 giây chưa" nên nó phải chờ hết 180 giây rồi NÉM. Cơ chế mới
    // hỏi "chủ còn sống không" nên câu trả lời có ngay ở nhịp đầu tiên.
    expect(Date.now() - truoc, "chủ khoá đã chết thì không có gì để chờ").toBeLessThan(5_000);
  });

  it("⑶ khoá của một tiến trình CÒN SỐNG thì KHÔNG bị thu hồi — chiều âm", { timeout: 30_000 }, async () => {
    // Không có vế này thì vế trên xanh y hệt với một cơ chế "thu hồi mọi khoá gặp phải" — tức
    // không còn là khoá nữa.
    const duong = join(thuMuc, "chu-con-song.lock");
    mkdirSync(duong, { recursive: true });
    writeFileSync(join(duong, "pid"), String(process.pid), "utf8"); // tiến trình test: chắc chắn sống

    const con = spawn(process.execPath, ["--experimental-transform-types", vietKichBanChoKhoa(duong)], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const thoatSom = await new Promise<boolean>((giaiQuyet) => {
      const hen = setTimeout(() => giaiQuyet(false), 2_500);
      con.on("close", () => {
        clearTimeout(hen);
        giaiQuyet(true);
      });
    });
    con.kill();
    expect(thoatSom, "khoá của một tiến trình còn sống ĐÃ BỊ thu hồi — đó không còn là khoá").toBe(false);
  });

  it("⑶ lúc nhả, KHÔNG xoá khoá mà người khác đã giành lại", { timeout: 20_000 }, () => {
    const duong = join(thuMuc, "khoa-doi-chu.lock");
    voiKhoaDepcruise(() => {
      // Mô phỏng đúng ca hỏng của bản đầu: ta bị coi là chết, khoá bị thu hồi và người khác giành.
      writeFileSync(join(duong, "pid"), String(process.pid + 1), "utf8");
    }, duong);
    expect(existsSync(duong), "đã xoá khoá của NGƯỜI KHÁC — dựng lại đúng đua tranh cần đóng").toBe(true);
    rmSync(duong, { recursive: true, force: true });
  });

  it("gọi LỒNG không tự khoá chết chính mình", { timeout: 20_000 }, () => {
    const duong = join(thuMuc, "long-nhau.lock");
    expect(voiKhoaDepcruise(() => voiKhoaDepcruise(() => 42, duong), duong)).toBe(42);
    expect(existsSync(duong), "lượt lồng bên trong đã nhả khoá của lượt ngoài").toBe(false);
  });
});

/** PID của một tiến trình đã THOÁT — dùng làm chủ khoá chết trong phép đo chiều dương. */
async function pidDaChet(): Promise<number> {
  const con = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((giaiQuyet) => con.on("close", giaiQuyet));
  return con.pid ?? 999_999;
}

/** Kịch bản con chỉ cố GIÀNH một đường khoá cho trước rồi thoát ngay. */
function vietKichBanChoKhoa(duong: string): string {
  const tep = join(thuMuc, "cho-khoa.mjs");
  writeFileSync(
    tep,
    [
      `import { voiKhoaDepcruise } from ${JSON.stringify(KHOA_URL)};`,
      `voiKhoaDepcruise(() => 0, ${JSON.stringify(duong)});`,
    ].join("\n"),
  );
  return tep;
}
