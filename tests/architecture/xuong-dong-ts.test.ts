// ==============================================================================================
// [khoản nợ 10] MỌI TỆP TYPESCRIPT LÀ VĂN BẢN LF CHO GIT — KHI GIT GHI TỆP RA CÂY LÀM VIỆC
//
// `.gitattributes` từng ghim đúng hai thứ (`*.sql`, `evidence/INV-matrix.md`). Với `core.autocrlf=true` (mặc định của Git for
// Windows), một checkout MỚI cho `.ts` dạng CRLF (đo trên clone mới: 181 tệp), nên mọi bộ đọc chuỗi của cổng kiến trúc phải tự chịu
// hai kiểu xuống dòng. Hôm nay chúng đều tự chịu: đây là việc làm byte của checkout TẤT ĐỊNH, không phải một lần đỏ đã đo — run
// 33978573210 từng được dẫn làm chứng cứ, nhưng lần đỏ ấy là `ci.yml` CRLF, đã đóng ở bộ đọc (lượt soi 56 N1). Một tệp mang MỘT
// byte NUL thô (`apps/unseal-worker/src/index.ts`, trong regex gỡ U+0000) còn bị phép dò xuống dòng của Git (`ls-files --eol` báo
// `-text`) và ripgrep coi là nhị phân.
//
// Bốn khẳng định:
//   ⑴ mọi tệp TypeScript theo dõi (`.ts`, `.mts`, `.cts`, `.tsx`) mang `text` và `eol=lf` — tệp đầu tiên của một đuôi chưa có
//      dòng trong `.gitattributes` sẽ đỏ tới khi dòng ấy được thêm;
//   ⑵ không blob nào CRLF hay lai, và không tệp nào mang nội dung mà phép dò xuống dòng của Git gọi là nhị phân — ở blob lẫn cây
//      làm việc;
//   ⑶ phạm vi HẸP là chủ đích: `.md` và `.yml` không mang `text` hay `eol` (bắt cả một `* text=auto` đặt ở đầu tệp), `*.sql` vẫn
//      ghim `eol=lf`;
//   ⑷ CHỈ TRÊN CI: byte ở cây làm việc của mọi tệp TypeScript là LF. Job CI checkout mới, nên ⑷ đo thẳng lời khai của khoản này ở
//      mọi PR, cả trên windows-latest. Cục bộ ⑷ bỏ qua: `eol` có hiệu lực khi Git GHI tệp (clone mới, hay một commit làm tệp đổi),
//      và một cây làm việc CRLF có sẵn giữ nguyên byte tới lúc đó.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const MAU_TS = ["*.ts", "*.mts", "*.cts", "*.tsx"];

function git(args: readonly string[], input?: string): string {
  return execFileSync("git", args, { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, input });
}

const TEP_TS = git(["ls-files", "-z", "--", ...MAU_TS])
  .split("\0")
  .filter((d) => d !== "");

/** `git check-attr -z --stdin`: bộ ba `đường\0thuộc tính\0giá trị\0`. */
function thuocTinh(tep: readonly string[], ten: readonly string[]): Map<string, Map<string, string>> {
  const ra = git(["check-attr", "-z", "--stdin", ...ten], `${tep.join("\0")}\0`).split("\0");
  const bang = new Map<string, Map<string, string>>();
  for (let i = 0; i + 2 < ra.length; i += 3) {
    const m = bang.get(ra[i]!) ?? new Map<string, string>();
    m.set(ra[i + 1]!, ra[i + 2]!);
    bang.set(ra[i]!, m);
  }
  return bang;
}

/** `git ls-files --eol -z`: `i/<blob> w/<cây làm việc> attr/<…>\t<đường>`. */
function xuongDong(): { duong: string; i: string; w: string }[] {
  return git(["ls-files", "--eol", "-z", "--", ...MAU_TS])
    .split("\0")
    .filter((d) => d !== "")
    .map((d) => {
      const tab = d.indexOf("\t");
      const thongTin = d.slice(0, tab);
      return {
        duong: d.slice(tab + 1),
        i: /\bi\/(\S*)/u.exec(thongTin)?.[1] ?? "?",
        w: /\bw\/(\S*)/u.exec(thongTin)?.[1] ?? "?",
      };
    });
}

describe("[khoản nợ 10] tệp TypeScript là văn bản LF cho Git", () => {
  it("[khoản nợ 10] bộ đọc không rỗng ruột — thấy đủ tệp TypeScript theo dõi, gồm tệp từng mang byte NUL thô", () => {
    expect(TEP_TS.length).toBeGreaterThan(100);
    expect(TEP_TS).toContain("apps/unseal-worker/src/index.ts");
    expect(xuongDong()).toHaveLength(TEP_TS.length);
  });

  it("[khoản nợ 10] ⑴ mọi tệp TypeScript theo dõi (.ts, .mts, .cts, .tsx) mang text và eol=lf", () => {
    const bang = thuocTinh(TEP_TS, ["text", "eol"]);
    const sai = TEP_TS.filter((t) => bang.get(t)?.get("text") !== "set" || bang.get(t)?.get("eol") !== "lf").map(
      (t) => `${t}: text=${bang.get(t)?.get("text")} eol=${bang.get(t)?.get("eol")}`,
    );
    expect(sai).toEqual([]);
  });

  it("[khoản nợ 10] ⑵ không blob nào CRLF hay lai, không tệp nào mang nội dung mà phép dò xuống dòng của Git gọi là nhị phân", () => {
    const sai = xuongDong()
      .filter((e) => ["crlf", "mixed", "-text"].includes(e.i) || e.w === "-text")
      .map((e) => `${e.duong}: i/${e.i} w/${e.w}`);
    expect(sai).toEqual([]);
  });

  it("[khoản nợ 10] ⑶ phạm vi HẸP là chủ đích: .md và .yml không mang text hay eol, *.sql vẫn ghim eol=lf", () => {
    const tep = ["docs/STATE.md", ".github/workflows/ci.yml", "db/migrations/001_roles_and_functions.sql"];
    const bang = thuocTinh(tep, ["text", "eol"]);
    const doc = (t: string): string => `text=${bang.get(t)?.get("text")} eol=${bang.get(t)?.get("eol")}`;
    expect(doc("docs/STATE.md")).toBe("text=unspecified eol=unspecified");
    expect(doc(".github/workflows/ci.yml")).toBe("text=unspecified eol=unspecified");
    expect(bang.get("db/migrations/001_roles_and_functions.sql")?.get("eol")).toBe("lf");
  });

  it.runIf(process.env.CI === "true")(
    "[khoản nợ 10] ⑷ chỉ trên CI — checkout mới: byte ở cây làm việc của mọi tệp TypeScript theo dõi là LF",
    () => {
      const sai = xuongDong()
        .filter((e) => e.w !== "lf" && e.w !== "none")
        .map((e) => `${e.duong}: w/${e.w}`);
      expect(sai).toEqual([]);
    },
  );
});
