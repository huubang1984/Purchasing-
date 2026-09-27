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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tenDauCho, thuMucDauCho, voiKhoaDepcruise, voiKhoaDepcruiseAsync } from "./khoa-depcruise.js";

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

// ==============================================================================================
// [khoản 222] MŨI ĐO THỨ NĂM — VÀ NÓ ĐẾN TỪ CI, KHÔNG TỪ MỘT LƯỢT SOI
//
// PR #105, run 35625587011: `T1+T2 (windows-latest)` đỏ ĐÚNG MỘT CA ở PROBE của
// `apps/api/src/routes.test.ts` — `EPERM: operation not permitted, mkdir '…/depcruise.lock'` —
// trong khi ubuntu-latest, T0, T0b và T3 của CÙNG commit đều xanh, và `pnpm test` ở máy (cũng
// Windows) xanh hai lượt.
//
// RANH GIỚI CỦA PHÉP ĐO NÀY, nói ra vì nó quyết định cách đọc kết quả: sự kiện của hệ điều hành
// — `mkdir` vào một thư mục *đang chờ xoá* trả `ERROR_ACCESS_DENIED`, libuv map thành `EPERM` —
// KHÔNG được tái lập ở đây, và không dựng lại theo ý muốn được. Bằng chứng nó xảy ra là ca đỏ
// trên CI. Thứ ĐƯỢC đo là bốn quyết định của lớp khoá khi lỗi ấy tới, và cả bốn cần thiết: thiếu
// ⑵ thì bản vá đổi một lần đỏ ngay thành một lần chờ `HAN_CHO_MS`; thiếu ⑶ và ⑷ thì nó tha cả
// lỗi quyền thật, tức mở lại đúng cái treo im mà mục ⑴ của khoá đóng.
//
// Ba trong bốn mũi khẳng định SỐ LẦN GỌI `mkdir` chứ không khẳng định thời gian: "ném ngay" đo
// bằng đồng hồ là một lời khai mà một máy CI đang tải nặng bẻ được.
// ==============================================================================================

/** Lỗi hệ thống ĐÚNG HÌNH DẠNG của libuv: một `Error` mang `code`. */
function loiHeThong(ma: "EPERM" | "EACCES", duong: string): Error {
  const cau = ma === "EPERM" ? "operation not permitted" : "permission denied";
  return Object.assign(new Error(`${ma}: ${cau}, mkdir '${duong}'`), { code: ma });
}

/**
 * Cửa `tao` tiêm: ném `ma` đúng `soLanNem` lượt đầu rồi để `mkdir` thật làm việc, và ĐẾM số lần
 * được gọi — con số ấy là thứ phân biệt "ném ngay" với "ném sau khi đã chờ".
 */
function taoTiemLoi(
  ma: "EPERM" | "EACCES",
  soLanNem: number,
): { readonly tao: (duong: string) => void; readonly goi: () => number } {
  let conNem = soLanNem;
  let dem = 0;
  return {
    tao: (duong: string) => {
      dem += 1;
      if (conNem > 0) {
        conNem -= 1;
        throw loiHeThong(ma, duong);
      }
      mkdirSync(duong, { recursive: false });
    },
    goi: () => dem,
  };
}

describe("[khoản 222] `EPERM` trên một cái TÊN ĐANG TỒN TẠI là TRANH CHẤP, không phải lỗi quyền", () => {
  it("⑴ một nhịp `EPERM` rồi thôi ⇒ VÀO ĐƯỢC — đúng ca *pending delete* của Windows", { timeout: 20_000 }, async () => {
    // Dựng đúng hình dạng của ca đỏ trên CI: thư mục khoá CÓ TRÊN ĐĨA (nên cái tên tồn tại) và
    // chủ của nó đã chết (nên nó là rác, đúng như một thư mục vừa bị `rmdir` bỏ lại).
    const duong = join(thuMuc, "eperm-mot-nhip.lock");
    mkdirSync(duong, { recursive: true });
    writeFileSync(join(duong, "pid"), String(await pidDaChet()), "utf8");

    const t = taoTiemLoi("EPERM", 1);
    // Trước bản vá dòng này ném `EPERM` ra ngoài — đó CHÍNH LÀ ca đỏ của `T1+T2 (windows-latest)`.
    expect(voiKhoaDepcruise(() => "vao-duoc", duong, t.tao)).toBe("vao-duoc");
    expect(t.goi(), "phải thử lại sau nhịp EPERM chứ không ném").toBe(2);
    expect(existsSync(duong), "nhả khoá xong mà thư mục còn đó").toBe(false);
  });

  it("⑵ `EPERM` LIÊN TIẾP ⇒ ném CHÍNH LỖI GỐC, và ném trong cửa sổ ngắn chứ không chờ 180 giây", { timeout: 60_000 }, () => {
    // Chủ khoá CÒN SỐNG ⇒ không có gì để thu hồi, nên vòng chỉ còn chờ. Nếu `EPERM` được tha VÔ
    // HẠN thì chỗ này chờ hết `HAN_CHO_MS` rồi ném lỗi HẠN CHỜ — một thông điệp không hề nói ra
    // `EPERM`, tức người đọc mất chẩn đoán duy nhất.
    const duong = join(thuMuc, "eperm-lien-tiep.lock");
    mkdirSync(duong, { recursive: true });
    writeFileSync(join(duong, "pid"), String(process.pid), "utf8");

    const t = taoTiemLoi("EPERM", Number.MAX_SAFE_INTEGER);
    const truoc = Date.now();
    expect(() => voiKhoaDepcruise(() => 1, duong, t.tao)).toThrow(/EPERM/u);
    expect(Date.now() - truoc, "một mã lỗi được tha KHÔNG được thành một lần chờ 180 giây").toBeLessThan(30_000);
    // Và cửa sổ phải THẬT: gỡ nó đi thì lượt đầu tiên đã ném, tức `mkdir` chỉ được gọi một lần.
    expect(t.goi(), "không có cửa sổ nhẫn nại nào — bản vá đã bị gỡ").toBeGreaterThan(5);
    rmSync(duong, { recursive: true, force: true });
  });

  it("⑶ `EPERM` trên một cái tên KHÔNG tồn tại ⇒ ném NGAY — lỗi quyền thật vẫn là lỗi thật", { timeout: 20_000 }, () => {
    const duong = join(thuMuc, "eperm-khong-co-ten.lock"); // CỐ Ý không tạo
    const t = taoTiemLoi("EPERM", Number.MAX_SAFE_INTEGER);
    expect(() => voiKhoaDepcruise(() => 1, duong, t.tao)).toThrow(/EPERM/u);
    expect(t.goi(), "đã chờ một cái tên không hề tồn tại").toBe(1);
  });

  it("⑷ ĐỐI CHỨNG: `EACCES` trên cái tên ĐANG TỒN TẠI vẫn ném NGAY — bản vá hẹp đúng một mã lỗi", { timeout: 20_000 }, () => {
    // Thiếu vế này, bản vá xanh y hệt với một phiên bản tha MỌI lỗi khi đường dẫn có trên đĩa —
    // tức mở lại đúng cái treo im mà mục ⑴ đóng, chỉ hẹp hơn một chút.
    const duong = join(thuMuc, "eacces-co-ten.lock");
    mkdirSync(duong, { recursive: true });
    writeFileSync(join(duong, "pid"), String(process.pid), "utf8");

    const t = taoTiemLoi("EACCES", Number.MAX_SAFE_INTEGER);
    expect(() => voiKhoaDepcruise(() => 1, duong, t.tao)).toThrow(/EACCES/u);
    expect(t.goi(), "`EACCES` bị tha — bản vá rộng hơn chẩn đoán").toBe(1);
    rmSync(duong, { recursive: true, force: true });
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

// ==============================================================================================
// [khoản 249] ⑹ NGƯỜI ĐẾN TRƯỚC ĐƯỢC TRƯỚC — xem khối ⑹ trong `khoa-depcruise.ts`
//
// PR #176, run 36325198665: `T1+T2 (windows-latest)` đỏ đúng một ca — PROBE `g9-` của
// `apps/api/src/routes.test.ts` chờ khoá quá 180 s — vì `boundaries.test.ts` nhả rồi giành lại khoá ở
// mỗi test, suốt 194,5 s, và người chờ không bao giờ tới lượt.
//
// RANH GIỚI CỦA CÁC PHÉP ĐO DƯỚI, nói ra vì nó quyết định cách đọc chúng: chiều âm trên hai tiến trình
// thật — "không nhường thì người chờ ĐÓI" — là một đua tranh XÁC SUẤT. Khe giữa lần nhả và lần giành
// lại dưới một mili-giây, người chờ hỏi mỗi 50 ms, nên mỗi vòng nó có cỡ khe/50 ms cơ may lọt vào: một
// khẳng định "đói" viết trên hai tiến trình thật là một test chập chờn, đúng thứ khoản nợ 59 sinh ra để
// diệt. Nên chiều âm đo ở CƠ CHẾ gây đói, và đo tất định: một tiến trình giữ-nhả liên tục mà không
// nhường thì giành lại MỌI lượt trong khi có người xếp hàng trước nó. Chiều dương đo cả hai cách — bằng
// dấu chờ dựng tay, và bằng một người chờ thật chen được vào giữa vòng giữ-nhả của một tiến trình khác.
// ==============================================================================================

/** Kịch bản con: chờ tín hiệu `choTruoc` (nếu có), rồi giữ-nhả khoá `soVong` lượt liền, mỗi lượt `giuMs`. */
function vietKichBanGiuNhaLienTuc(): string {
  const tep = join(thuMuc, "giu-nha-lien-tuc.mjs");
  writeFileSync(
    tep,
    [
      'import { existsSync, writeFileSync } from "node:fs";',
      `import { voiKhoaDepcruise } from ${JSON.stringify(KHOA_URL)};`,
      "const [duong, soVong, giuMs, nhuong, choTruoc, baoDangGiu] = process.argv.slice(2);",
      "const ngu = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
      'if (choTruoc !== "-") while (!existsSync(choTruoc)) ngu(10);',
      "const khoiDong = Date.now();",
      "const cac = [];",
      "for (let i = 0; i < Number(soVong); i += 1) {",
      "  cac.push(voiKhoaDepcruise(() => {",
      "    const batDau = Date.now();",
      '    if (i === 0 && baoDangGiu !== "-") writeFileSync(baoDangGiu, "");',
      "    ngu(Number(giuMs));",
      "    return { batDau, ketThuc: Date.now() };",
      '  }, duong, undefined, { hanChoMs: 60000, nhuong: nhuong === "1" }));',
      "}",
      "process.stdout.write(JSON.stringify({ khoiDong, cac }));",
    ].join("\n"),
  );
  return tep;
}

/** Kịch bản con: báo sẵn sàng, chờ tới khi người kia đang giữ khoá, rồi giành MỘT lượt. */
function vietKichBanNguoiCho(): string {
  const tep = join(thuMuc, "nguoi-cho.mjs");
  writeFileSync(
    tep,
    [
      'import { existsSync, writeFileSync } from "node:fs";',
      `import { voiKhoaDepcruise } from ${JSON.stringify(KHOA_URL)};`,
      "const [duong, baoSanSang, choDangGiu] = process.argv.slice(2);",
      "const ngu = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);",
      'writeFileSync(baoSanSang, "");',
      "while (!existsSync(choDangGiu)) ngu(10);",
      "const den = Date.now();",
      "const kq = voiKhoaDepcruise(() => { const batDau = Date.now(); ngu(50); return { batDau, ketThuc: Date.now() }; }, duong);",
      "process.stdout.write(JSON.stringify({ den, ...kq }));",
    ].join("\n"),
  );
  return tep;
}

function chayCon<T>(tep: string, thamSo: readonly string[]): Promise<T> {
  return new Promise((giaiQuyet, tuChoi) => {
    const con = spawn(process.execPath, ["--experimental-transform-types", tep, ...thamSo], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ra = "";
    let loi = "";
    con.stdout.on("data", (d: Buffer) => (ra += d.toString()));
    con.stderr.on("data", (d: Buffer) => (loi += d.toString()));
    con.on("close", (ma) => {
      if (ma !== 0) tuChoi(new Error(`tiến trình con thoát ${String(ma)}: ${loi}`));
      else giaiQuyet(JSON.parse(ra) as T);
    });
  });
}

/** Dựng tay dấu của một người chờ ĐẾN TRƯỚC, còn sống (chủ là tiến trình test), và giữ tim nó đập. */
function datDauGia(duongKhoa: string, pid: number = process.pid): { readonly duong: string; readonly thoi: () => void } {
  mkdirSync(thuMucDauCho(duongKhoa), { recursive: true });
  const duong = join(thuMucDauCho(duongKhoa), tenDauCho(Date.now() - 1_000, pid, 0));
  writeFileSync(duong, "", "utf8");
  const tim = setInterval(() => {
    const bayGio = new Date();
    try {
      utimesSync(duong, bayGio, bayGio);
    } catch {
      // dấu đã được gỡ
    }
  }, 100);
  return {
    duong,
    thoi: () => {
      clearInterval(tim);
      rmSync(duong, { force: true });
    },
  };
}

describe("[khoản 249] khoá xếp hàng: người đến trước được trước", () => {
  it("người đến sau KHÔNG giành khi có một người chờ còn sống đến trước — mà xếp hàng sau họ", { timeout: 30_000 }, async () => {
    const duong = join(thuMuc, "nhuong-dau-song.lock");
    const gia = datDauGia(duong);
    const truoc = Date.now();
    setTimeout(gia.thoi, 1_500);
    let dauTrongHang = 0;
    setTimeout(() => (dauTrongHang = readdirSync(thuMucDauCho(duong)).length), 700);
    const cho = await voiKhoaDepcruiseAsync(() => Date.now() - truoc, duong);
    expect(dauTrongHang, "lượt đến sau phải đặt dấu của nó SAU dấu kia").toBe(2);
    expect(cho, "khoá trống mà vẫn phải chờ người đến trước rời hàng").toBeGreaterThanOrEqual(1_400);
    expect(readdirSync(thuMucDauCho(duong)), "giành được rồi thì dấu của mình phải đi").toEqual([]);
  });

  it("ĐỐI CHỨNG: `nhuong: false` — đúng khoá cũ — giành ngay dù có người xếp hàng trước", { timeout: 30_000 }, async () => {
    const duong = join(thuMuc, "khong-nhuong.lock");
    const gia = datDauGia(duong);
    const truoc = Date.now();
    const cho = await voiKhoaDepcruiseAsync(() => Date.now() - truoc, duong, { hanChoMs: 60_000, nhuong: false });
    gia.thoi();
    expect(cho, "khoá cũ không nhìn hàng chờ — đây là cơ chế làm người chờ đói").toBeLessThan(1_000);
  });

  it("dấu NGỪNG TIM bị bỏ qua nhưng không bị xoá; dấu của tiến trình ĐÃ CHẾT bị dọn", { timeout: 30_000 }, async () => {
    const duongNgung = join(thuMuc, "dau-ngung-tim.lock");
    const ngung = datDauGia(duongNgung);
    ngung.thoi(); // dừng tim…
    writeFileSync(ngung.duong, "", "utf8"); // …rồi đặt lại tệp với mốc tim cũ hơn hạn
    const cu = new Date(Date.now() - 60_000);
    utimesSync(ngung.duong, cu, cu);
    const t1 = Date.now();
    expect(await voiKhoaDepcruiseAsync(() => Date.now() - t1, duongNgung)).toBeLessThan(1_000);
    expect(existsSync(ngung.duong), "dấu ngừng tim có thể chỉ là chủ chậm — không được xoá").toBe(true);

    const duongChet = join(thuMuc, "dau-chu-chet.lock");
    const chet = datDauGia(duongChet, await pidDaChet());
    const t2 = Date.now();
    expect(await voiKhoaDepcruiseAsync(() => Date.now() - t2, duongChet)).toBeLessThan(1_000);
    expect(existsSync(chet.duong), "dấu của một tiến trình đã chết phải được dọn").toBe(false);
    chet.thoi();
  });

  it("hạn chờ vẫn NÉM khi người đứng trước không bao giờ rời hàng — và dấu của lượt ném cũng đi", { timeout: 30_000 }, async () => {
    const duong = join(thuMuc, "han-khi-xep-hang.lock");
    const gia = datDauGia(duong);
    const truoc = Date.now();
    await expect(voiKhoaDepcruiseAsync(() => 1, duong, { hanChoMs: 1_000, nhuong: true })).rejects.toThrow(
      /chờ khoá depcruise quá 1000 ms/u,
    );
    expect(Date.now() - truoc, "ném ở hạn, không treo").toBeLessThan(10_000);
    expect(readdirSync(thuMucDauCho(duong)), "chỉ còn dấu của người đứng trước").toEqual([basename(gia.duong)]);
    gia.thoi();
  });

  it("một tiến trình giữ-nhả liên tục NHƯỜNG người đang xếp hàng; không nhường thì giành lại MỌI lượt", { timeout: 60_000 }, async () => {
    const tep = vietKichBanGiuNhaLienTuc();
    type KetQua = { readonly khoiDong: number; readonly cac: readonly Khoang[] };

    const duongNhuong = join(thuMuc, "giu-nha-nhuong.lock");
    const gia = datDauGia(duongNhuong);
    // Mốc rời hàng đo ở CHÍNH tiến trình test, cùng đồng hồ máy với tiến trình con — không đo từ lúc
    // sinh con, vì thời gian khởi động của `node` trên một runner chậm ăn mất một phần khoảng chờ.
    let roiHang = Number.POSITIVE_INFINITY;
    setTimeout(() => {
      roiHang = Date.now();
      gia.thoi();
    }, 2_500);
    const nhuong = await chayCon<KetQua>(tep, [duongNhuong, "5", "100", "1", "-", "-"]);
    expect(nhuong.khoiDong, "đối chứng hỏng: tiến trình con lên SAU lúc người xếp hàng rời đi").toBeLessThan(roiHang);
    expect(nhuong.cac, "đủ năm lượt giữ sau khi tới lượt").toHaveLength(5);
    expect(
      nhuong.cac[0]!.batDau,
      "người giữ-nhả phải đợi người xếp hàng trước nó rời hàng",
    ).toBeGreaterThanOrEqual(roiHang);

    const duongKhong = join(thuMuc, "giu-nha-khong-nhuong.lock");
    const gia2 = datDauGia(duongKhong);
    const khong = await chayCon<KetQua>(tep, [duongKhong, "5", "100", "0", "-", "-"]);
    const conXepHang = existsSync(gia2.duong);
    gia2.thoi();
    expect(conXepHang, "đối chứng hỏng: người xếp hàng đã rời hàng giữa chừng").toBe(true);
    expect(khong.cac, "khoá cũ: đủ năm lượt giữ trong khi có người xếp hàng trước").toHaveLength(5);
    expect(khong.cac[0]!.batDau - khong.khoiDong, "khoá cũ giành ngay, không nhìn hàng chờ").toBeLessThan(1_000);
  });

  it("HAI TIẾN TRÌNH THẬT: người chờ chen được vào giữa vòng giữ-nhả, không phải chờ trọn vòng", { timeout: 60_000 }, async () => {
    const duong = join(thuMuc, "hai-tien-trinh-xep-hang.lock");
    const sanSang = join(thuMuc, "nguoi-cho-san-sang");
    const dangGiu = join(thuMuc, "giu-nha-dang-giu");
    const [h, w] = await Promise.all([
      chayCon<{ readonly khoiDong: number; readonly cac: readonly Khoang[] }>(vietKichBanGiuNhaLienTuc(), [
        duong,
        "10",
        "250",
        "1",
        sanSang,
        dangGiu,
      ]),
      chayCon<Khoang & { readonly den: number }>(vietKichBanNguoiCho(), [duong, sanSang, dangGiu]),
    ]);
    // Loại trừ vẫn nguyên: lượt của người chờ không chồng lấn lượt nào của người kia.
    for (const k of h.cac) expect(chongLan(k, w), JSON.stringify({ k, w })).toBe(false);
    // Công bằng: từ lúc người chờ đến tới lúc nó vào, người kia mở THÊM nhiều nhất một lượt — lượt ấy
    // chỉ có khi nó giành lại đúng trong khe trước khi người chờ kịp đặt dấu.
    const chenTruoc = h.cac.filter((k) => k.batDau > w.den && k.batDau < w.batDau).length;
    expect(chenTruoc, `người chờ bị chen: ${JSON.stringify({ h: h.cac, w })}`).toBeLessThanOrEqual(1);
    // Và nó vào GIỮA vòng, không phải sau lượt cuối: người kia còn giữ tiếp nhiều lượt sau nó.
    const sauNguoiCho = h.cac.filter((k) => k.batDau >= w.ketThuc).length;
    expect(sauNguoiCho, "người chờ chỉ vào được khi vòng giữ-nhả đã hết — tức vẫn đói").toBeGreaterThanOrEqual(7);
  });
});
