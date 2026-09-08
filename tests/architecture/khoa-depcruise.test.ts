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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Trên Windows, `import "D:\..."` ném ERR_UNSUPPORTED_ESM_URL_SCHEME — phải là một URL file://.
const KHOA_URL = new URL("./khoa-depcruise.ts", import.meta.url).href;
const GIU_MS = 400;

const thuMuc = mkdtempSync(join(tmpdir(), "trustprocure-do-khoa-"));
afterAll(() => rmSync(thuMuc, { recursive: true, force: true }));

/** Kịch bản con: giữ (hoặc không giữ) khoá đúng `GIU_MS` mili-giây rồi in ra hai mốc thời gian. */
function vietKichBan(coKhoa: boolean): string {
  const tep = join(thuMuc, coKhoa ? "co-khoa.mjs" : "khong-khoa.mjs");
  const than = [
    `import { voiKhoaDepcruise } from ${JSON.stringify(KHOA_URL)};`,
    "const ngu = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
    "const lam = () => { const batDau = Date.now(); ngu(" + String(GIU_MS) + "); ",
    "  return { batDau, ketThuc: Date.now() }; };",
    coKhoa
      ? "const kq = voiKhoaDepcruise(lam);"
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
