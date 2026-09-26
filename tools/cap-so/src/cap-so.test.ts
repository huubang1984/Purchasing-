// ==============================================================================================
// tools/cap-so — phép đo của lệnh cấp số.
//
// Hai tầng. Tầng thuần chạy từng hàm trên chuỗi. Tầng kho dựng một kho git TẠM ngoài cây nguồn
// (không ghi gì vào `docs/` thật) và đi đúng hai kịch bản mà lệnh sinh ra để giải:
//   ① một nhánh cấp số lần đầu;
//   ② hai nhánh cùng cấp số trên một master, một nhánh merge trước — nhánh kia merge master, gỡ
//      xung đột bằng chính lệnh, cấp lại, và mọi dạng tham chiếu (kể cả số trần trong dải `…`)
//      theo đúng số mới.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bangRong,
  banSoTam,
  capNhatKhai,
  capNhatTongKet,
  capSo,
  CapSoError,
  demLai,
  docDiff,
  docTrailer,
  giaiXungDotKhai,
  HO_KHAI_HANDOFF,
  HO_KHAI_STATE,
  kiem,
  laCapThaySo,
  laTepThuong,
  thaySoTam,
  thuHoiTheoToken,
  vietSoTiengViet,
  vietTrailer,
  type BangCap,
} from "./index.js";

function bang(cap: Partial<Record<keyof BangCap, ReadonlyArray<readonly [number, number]>>>): BangCap {
  const b = bangRong();
  for (const [d, cacCap] of Object.entries(cap) as Array<[keyof BangCap, ReadonlyArray<readonly [number, number]>]>) {
    for (const [tam, that] of cacCap) b[d].set(tam, that);
  }
  return b;
}

const BANG_A = bang({ vong: [[9101, 141]], adr: [[9201, 83], [9203, 85]], khoan: [[9401, 243]], migration: [[9501, 68]] });

describe("thay số tạm", () => {
  it("mọi dạng — có tiền tố, trong dải `…`, tên tệp, số trần trong đấu huyền", () => {
    expect(thaySoTam("S1.9101 · ADR-9201…9203 · khoản 9401 · `9501_moi.sql` · `9501`:12", BANG_A)).toBe(
      "S1.141 · ADR-083…085 · khoản 243 · `068_moi.sql` · `068`:12",
    );
  });

  it("số không có trong bảng đứng yên — kể cả số rơi vào dải tạm", () => {
    expect(thaySoTam("chạy riêng 9412 ms, ADR-9202, 19201, 92010", BANG_A)).toBe("chạy riêng 9412 ms, ADR-9202, 19201, 92010");
  });
});

describe("trailer Cap-So", () => {
  it("viết rồi đọc lại ra đúng bảng", () => {
    const t = vietTrailer(BANG_A);
    expect(t).toBe("Cap-So: vong 9101=141; adr 9201=083 9203=085; khoan 9401=243; migration 9501=068");
    expect(vietTrailer(docTrailer(t.slice("Cap-So:".length)))).toBe(t);
  });

  it("ném khi dãy lạ, cặp sai hình dạng, số tạm ngoài dải của dãy, số thật trong dải tạm", () => {
    expect(() => docTrailer("khac 9101=1")).toThrow(/dãy lạ/);
    expect(() => docTrailer("adr 9201-83")).toThrow(/sai hình dạng/);
    expect(() => docTrailer("adr 9101=83")).toThrow(/dải số tạm/);
    expect(() => docTrailer("adr 9201=9202")).toThrow(/không phải số thật/);
  });
});

describe("cặp dòng của một lần cấp cũ", () => {
  it("số tạm → số thật là một cặp", () => {
    expect(laCapThaySo("## ADR-9201 — x (khoản 9401)", "## ADR-083 — x (khoản 243)", BANG_A, [])).toBe(true);
  });

  it("số thật của lần cấp TRƯỚC → số thật của lần này cũng là một cặp", () => {
    const cu = bang({ adr: [[9201, 83]] });
    const moi = bang({ adr: [[9201, 84]] });
    expect(laCapThaySo("ADR-083 và ADR-001", "ADR-084 và ADR-001", moi, [cu])).toBe(true);
  });

  it("bản số tạm chỉ đổi ĐÚNG những vị trí lần cấp đã thay — số của master trên cùng dòng đứng nguyên", () => {
    const cu = bang({ vong: [[9101, 3]], adr: [[9201, 3]] });
    const moi = bang({ vong: [[9101, 4]], adr: [[9201, 4]] });
    expect(banSoTam("ADR-003, S1.3; lời khai **[S1.3] ba ADR**", "ADR-004, S1.4; lời khai **[S1.3] ba ADR**", moi, [cu])).toBe(
      "ADR-9201, S1.9101; lời khai **[S1.3] ba ADR**",
    );
  });

  it("lời khai đếm đổi, chữ đổi, hay số không do bảng cấp — không phải cặp", () => {
    expect(laCapThaySo("**82 ADR**", "**83 ADR**", BANG_A, [])).toBe(false);
    expect(laCapThaySo("## ADR-9201 — x", "## ADR-083 — y", BANG_A, [])).toBe(false);
    expect(laCapThaySo("ADR-9201", "ADR-9201", BANG_A, [])).toBe(false);
  });
});

describe("thu hồi theo token", () => {
  it("dạng có tiền tố về số tạm; số trần mơ hồ đứng yên", () => {
    const duoi = new Set(["_moi.sql"]);
    expect(thuHoiTheoToken("S1.141, ADR-083, khoản nợ 243, `068_moi.sql`, `068_khac.sql`, `068`", BANG_A, duoi, false)).toBe(
      "S1.9101, ADR-9201, khoản nợ 9401, `9501_moi.sql`, `068_khac.sql`, `068`",
    );
  });

  it("tiền tố vòng của lời khai đếm đứng ngoài phép thu hồi", () => {
    expect(thuHoiTheoToken("S1.141 · **[S1.141] 84 ADR** · **[S1.141] 243 khoản, trong đó 94 còn mở**", BANG_A, new Set(), false)).toBe(
      "S1.9101 · **[S1.141] 84 ADR** · **[S1.141] 243 khoản, trong đó 94 còn mở**",
    );
  });

  it("hàng sổ nợ chỉ thu hồi trong STATE", () => {
    expect(thuHoiTheoToken("| 243 | **[MỞ]** x |", BANG_A, new Set(), true)).toBe("| 9401 | **[MỞ]** x |");
    expect(thuHoiTheoToken("| 243 | **[MỞ]** x |", BANG_A, new Set(), false)).toBe("| 243 | **[MỞ]** x |");
  });
});

describe("số đếm bằng chữ", () => {
  it.each([
    [0, "không"], [1, "một"], [4, "bốn"], [5, "năm"], [10, "mười"], [11, "mười một"], [14, "mười bốn"],
    [15, "mười lăm"], [20, "hai mươi"], [21, "hai mươi mốt"], [24, "hai mươi tư"], [25, "hai mươi lăm"],
    [82, "tám mươi hai"], [99, "chín mươi chín"],
  ])("%i → %s", (n, chu) => {
    expect(vietSoTiengViet(n)).toBe(chu);
  });

  it("ngoài 0–99 trả null", () => {
    expect(vietSoTiengViet(100)).toBeNull();
    expect(vietSoTiengViet(-1)).toBeNull();
  });
});

describe("lời khai đếm", () => {
  const SO = { adr: 83, khoanTong: 243, khoanMo: 94, migration: 68 };

  it("viết lại lời khai SỐNG, giữ dạng và tiền tố; lời khai đã gạch hay trong đoạn mã đứng yên", () => {
    const van =
      "~~**[S1.138] tám mươi mốt ADR**~~ **[S1.139] tám mươi hai ADR** · **[S1.139] TÁM MƯƠI HAI ADR** · " +
      "**[S1.139] 82 ADR** · `**[S1.93] 48 ADR**` · **[S1.140] 242 khoản, trong đó 93 còn mở** · " +
      "**[S1.140] 67 migration đánh số**";
    expect(capNhatKhai(van, SO, HO_KHAI_HANDOFF)).toBe(
      "~~**[S1.138] tám mươi mốt ADR**~~ **[S1.139] tám mươi ba ADR** · **[S1.139] TÁM MƯƠI BA ADR** · " +
        "**[S1.139] 83 ADR** · `**[S1.93] 48 ADR**` · **[S1.140] 243 khoản, trong đó 94 còn mở** · " +
        "**[S1.140] 68 migration đánh số**",
    );
  });

  it("STATE chỉ viết lại số ADR — lời khai khoản nợ trong nhật ký là số đo của vòng ấy", () => {
    expect(capNhatKhai("**82 ADR** · **82 khoản, 16 còn mở**", SO, HO_KHAI_STATE)).toBe("**83 ADR** · **82 khoản, 16 còn mở**");
  });

  it("vùng chết tính lại sau mỗi lượt thay — lượt trước đổi độ dài văn bản", () => {
    // "hai" → "ba" ngắn đi một ký tự; đo vùng chết trên bản CŨ thì lời khai khoản nợ, sát ngay sau
    // một đoạn mã, trông như nằm trong đoạn mã ấy và bị bỏ qua.
    expect(capNhatKhai("**tám mươi hai ADR** `x`**242 khoản, trong đó 93 còn mở**`y`**67 migration đánh số**", SO, HO_KHAI_HANDOFF)).toBe(
      "**tám mươi ba ADR** `x`**243 khoản, trong đó 94 còn mở**`y`**68 migration đánh số**",
    );
  });

  it("từ 100 trở lên, lời khai bằng chữ chuyển sang chữ số", () => {
    expect(capNhatKhai("**chín mươi chín ADR**", { ...SO, adr: 100 }, HO_KHAI_STATE)).toBe("**100 ADR**");
  });
});

const SO_NO = `## Nợ kỹ thuật

| # | Khoản | Trỏ |
|---|---|---|
| 1 | **[ĐÓNG]** xong | \`a\` |
| 2 | **[MỞ]** chờ người | \`a\` |
| 9401 | **[MỞ]** mới | \`a\` |

**CÒN MỞ TÍNH TỚI HEAD:** 2

Trong ~~**không**~~ **một** khoản ấy, **một** không phải việc của mã nguồn (2 chờ người), và **không** thì có
hình dạng mã nguồn.

## Khác
`;

describe("dòng tổng kết và đoạn đếm", () => {
  it("suy lại từ bảng: danh sách mở, tổng, ngoài mã, có mã", () => {
    const ra = capNhatTongKet(SO_NO);
    expect(ra).toContain("**CÒN MỞ TÍNH TỚI HEAD:** 2 · 9401\n");
    expect(ra).toContain("Trong ~~**không**~~ **hai** khoản ấy, **một** không phải việc của mã nguồn (2 chờ người), và **một** thì có");
  });

  it("vùng chết của đoạn đếm tính lại sau mỗi lượt thay", () => {
    // Tổng "không" → "hai" ngắn đi hai ký tự; đo trên bản cũ thì "**không** thì có" rơi vào vùng của
    // "~~**hai**~~" ngay trước nó và không được viết lại.
    const lech = SO_NO.replace("Trong ~~**không**~~ **một**", "Trong ~~**không**~~ **không**").replace(
      "và **không** thì có",
      "và ~~**hai**~~ **không** thì có",
    );
    expect(capNhatTongKet(lech)).toContain("Trong ~~**không**~~ **hai** khoản ấy, **một** không phải việc của mã nguồn (2 chờ người), và ~~**hai**~~ **một** thì có");
  });

  it("đã khớp thì không đổi một byte", () => {
    const khop = capNhatTongKet(SO_NO);
    expect(capNhatTongKet(khop)).toBe(khop);
  });
});

describe("gỡ xung đột", () => {
  it("khối chỉ khác ở lời khai và hàng sổ nợ mỗi phía thêm: hàng của cả hai, dòng của master", () => {
    const van = [
      "| 2 | **[MỞ]** x | `a` |",
      "<<<<<<< HEAD",
      "| 4 | **[MỞ]** của nhánh | `a` |",
      "",
      "**CÒN MỞ TÍNH TỚI HEAD:** 2 · 4",
      "=======",
      "| 3 | **[MỞ]** của master | `a` |",
      "",
      "**CÒN MỞ TÍNH TỚI HEAD:** 2 · 3",
      ">>>>>>> master",
      "",
      "<<<<<<< HEAD",
      "**[S1.4] 4 ADR**",
      "=======",
      "**[S1.4] 3 ADR**",
      ">>>>>>> master",
    ].join("\n");
    const kq = giaiXungDotKhai(van, "khai");
    expect(kq).toMatchObject({ daGiai: 2, conLai: 0 });
    expect(kq.van).toBe(
      ["| 2 | **[MỞ]** x | `a` |", "| 3 | **[MỞ]** của master | `a` |", "| 4 | **[MỞ]** của nhánh | `a` |", "",
        "**CÒN MỞ TÍNH TỚI HEAD:** 2 · 3", "", "**[S1.4] 3 ADR**"].join("\n"),
    );
  });

  it("phía master còn viết lối cũ (gạch số cũ, nối số mới với tiền tố vòng khác): vẫn là khối chỉ khác ở lời khai", () => {
    const van = [
      "<<<<<<< HEAD",
      "- Thiết kế, ~~**[S1.137] bảy mươi chín ADR**~~ **[S1.139] tám mươi ba ADR** (ADR-011).",
      "=======",
      "- Thiết kế, ~~**[S1.137] bảy mươi chín ADR**~~ ~~**[S1.139] tám mươi hai ADR**~~ **[S1.141] tám mươi ba ADR** (ADR-011).",
      ">>>>>>> origin/master",
    ].join("\n");
    expect(giaiXungDotKhai(van, "khai")).toEqual({
      van: "- Thiết kế, ~~**[S1.137] bảy mươi chín ADR**~~ ~~**[S1.139] tám mươi hai ADR**~~ **[S1.141] tám mươi ba ADR** (ADR-011).",
      daGiai: 1,
      conLai: 0,
    });
    // Chữ SỐNG khác nhau thì vẫn là việc của người gỡ.
    expect(giaiXungDotKhai(van.replace("(ADR-011).\n=", "(ADR-012).\n="), "khai")).toMatchObject({ daGiai: 0, conLai: 1 });
  });

  it("khác ở chỗ khác, hay cùng sửa MỘT khoản hai cách — để nguyên", () => {
    const khacChu = "<<<<<<< HEAD\nchữ của nhánh\n=======\nchữ của master\n>>>>>>> master";
    expect(giaiXungDotKhai(khacChu, "khai")).toMatchObject({ daGiai: 0, conLai: 1, van: khacChu });
    const cungKhoan = "<<<<<<< HEAD\n| 3 | **[ĐÓNG]** a | `a` |\n=======\n| 3 | **[MỞ]** a | `a` |\n>>>>>>> master";
    expect(giaiXungDotKhai(cungKhoan, "khai")).toMatchObject({ daGiai: 0, conLai: 1 });
    expect(giaiXungDotKhai(cungKhoan, "khai", new Set([1, 2, 3]))).toMatchObject({ daGiai: 0, conLai: 1 });
  });

  it("hai khoản MỚI cùng số (bản gốc chung không có số ấy): giữ cả hai, của master trước", () => {
    const vaSo = "<<<<<<< HEAD\n| 3 | **[MỞ]** của nhánh | `a` |\n=======\n| 3 | **[MỞ]** của master | `a` |\n>>>>>>> master";
    expect(giaiXungDotKhai(vaSo, "khai", new Set([1, 2])).van).toBe(
      "| 3 | **[MỞ]** của master | `a` |\n| 3 | **[MỞ]** của nhánh | `a` |",
    );
  });

  it("nối cuối tệp: giữ cả hai, của master trước; khối không ở cuối thì để nguyên", () => {
    const cuoi = "# D\n<<<<<<< HEAD\n## ADR-004 — nhánh\n=======\n## ADR-003 — master\n>>>>>>> master\n";
    expect(giaiXungDotKhai(cuoi, "noi-cuoi").van).toBe("# D\n## ADR-003 — master\n\n## ADR-004 — nhánh\n");
    const giua = "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> master\nsau";
    expect(giaiXungDotKhai(giua, "noi-cuoi")).toMatchObject({ daGiai: 0, conLai: 1 });
  });
});

describe("đọc diff", () => {
  it("dòng thêm theo số dòng bản sau, cặp dòng theo hunk, đổi tên", () => {
    const diff = [
      "diff --git a/x.md b/x.md",
      "--- a/x.md",
      "+++ b/x.md",
      "@@ -3 +3 @@",
      "-ADR-9201",
      "+ADR-083",
      "@@ -9,0 +10,2 @@",
      "+một",
      "+hai",
      "diff --git a/db/9501_a.sql b/db/068_a.sql",
      "similarity index 90%",
      "rename from db/9501_a.sql",
      "rename to db/068_a.sql",
      "--- a/db/9501_a.sql",
      "+++ b/db/068_a.sql",
      "@@ -1 +1 @@",
      "--- 9501_a.sql",
      "+-- 068_a.sql",
    ].join("\n");
    const [x, sql] = docDiff(diff);
    expect(x).toEqual({ truoc: "x.md", sau: "x.md", dongThem: [3, 10, 11], capDong: [["ADR-9201", "ADR-083"]] });
    expect(sql).toEqual({ truoc: "db/9501_a.sql", sau: "db/068_a.sql", dongThem: [1], capDong: [["-- 9501_a.sql", "-- 068_a.sql"]] });
  });
});

// ---- Kho git tạm ---------------------------------------------------------------------------

const khoDaDung: string[] = [];
afterEach(() => {
  for (const k of khoDaDung.splice(0)) rmSync(k, { recursive: true, force: true });
});

function git(goc: string, ...thamSo: string[]): string {
  return execFileSync("git", thamSo, { cwd: goc, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function ghi(goc: string, p: string, van: string): void {
  mkdirSync(dirname(join(goc, p)), { recursive: true });
  writeFileSync(join(goc, p), van, "utf8");
}

function doc(goc: string, p: string): string {
  return readFileSync(join(goc, p), "utf8");
}

function noi(goc: string, p: string, van: string): void {
  ghi(goc, p, doc(goc, p) + van);
}

/** Chèn `hang` ngay sau hàng sổ nợ cuối cùng. */
function themHang(goc: string, hang: string): void {
  const dong = doc(goc, "docs/STATE.md").split("\n");
  const cuoi = dong.findLastIndex((l) => /^\|\s*\d+\s*\|/.test(l));
  dong.splice(cuoi + 1, 0, hang);
  ghi(goc, "docs/STATE.md", dong.join("\n"));
}

function commit(goc: string, thongDiep: string): void {
  git(goc, "add", "-A");
  git(goc, "commit", "-q", "-m", thongDiep);
}

function dungKho(): string {
  const goc = mkdtempSync(join(tmpdir(), "cap-so-"));
  khoDaDung.push(goc);
  git(goc, "init", "-q", "-b", "master");
  git(goc, "config", "user.email", "cap-so@vidu.vn");
  git(goc, "config", "user.name", "cap-so");
  git(goc, "config", "core.autocrlf", "false");
  git(goc, "config", "merge.conflictStyle", "merge");
  ghi(goc, "docs/DECISIONS.md", "# DECISIONS\n\n## ADR-001 — một\n\nThân.\n\n## ADR-002 — hai\n\nThân.\n");
  ghi(
    goc,
    "docs/STATE.md",
    "# STATE\n\n- Thiết kế, **[S1.2] hai ADR** (ADR-001, ADR-002).\n\n" +
      SO_NO.replace("| 9401 | **[MỞ]** mới | `a` |\n", "").replace("Trong ~~**không**~~ **một**", "Trong **một**"),
  );
  ghi(
    goc,
    "Handoff.md",
    "# HANDOFF\n\n**[S1.2] 1 migration đánh số** — `db/migrations`.\n\n| Tệp | Gì |\n|---|---|\n" +
      "| `docs/STATE.md` | **[S1.2] 2 khoản, trong đó 1 còn mở** |\n| `docs/DECISIONS.md` | **[S1.2] 2 ADR** |\n",
  );
  ghi(goc, "db/migrations/001_mot.sql", "-- 001_mot.sql\nSELECT 1;\n");
  ghi(goc, "evidence/security-reviews.md", "# §S1.1 — một\n\nThân.\n\n# §S1.2 — hai\n\nThân.\n");
  commit(goc, "gốc");
  return goc;
}

/** Đủ dài để `git diff -M` nhận ra đổi tên khi dòng đầu đổi số — như một migration thật. */
const THAN_MIGRATION = Array.from({ length: 8 }, (_, k) => `SELECT ${k + 1} AS cot_${k + 1};\n`).join("");

/** Nhánh thêm `soAdr` ADR, một khoản, một migration, một vòng — bằng số tạm, như luật mới đòi. */
function lamViec(goc: string, ten: string, soAdr: number): void {
  git(goc, "checkout", "-q", "-b", ten, "master");
  for (let k = 1; k <= soAdr; k += 1) noi(goc, "docs/DECISIONS.md", `\n## ADR-920${k} — ${ten} ${k}\n\nThân ${ten}.\n`);
  const dai = soAdr > 1 ? `ADR-9201…920${soAdr}` : "ADR-9201";
  themHang(goc, `| 9401 | **[MỞ]** việc của ${ten} (${dai}, §S1.9101) | \`docs/DECISIONS.md\` |`);
  noi(goc, "evidence/security-reviews.md", `\n# §S1.9101 — ${ten}\n\n${dai}; khoản 9401; migration \`9501\` (\`9501_${ten}.sql\`).\n`);
  ghi(goc, `db/migrations/9501_${ten}.sql`, `-- 9501_${ten}.sql — [S1.9101 / ${dai}]\n${THAN_MIGRATION}`);
  demLai(goc);
  commit(goc, `${ten}: làm việc`);
}

function capVaCommit(goc: string, ten: string): string {
  const kq = capSo(goc, { base: "master" });
  expect(kq.trailer).not.toBeNull();
  commit(goc, `${ten}: cấp số\n\n${kq.trailer!}`);
  return kq.trailer!;
}

describe("kho thật — một nhánh cấp số lần đầu", () => {
  it("số tạm thành max(base)+1; tệp migration đổi tên; lời khai, dòng tổng kết, đoạn đếm theo sổ", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    const trailer = capVaCommit(goc, "a");
    expect(trailer).toBe("Cap-So: vong 9101=3; adr 9201=003; khoan 9401=3; migration 9501=002");

    expect(doc(goc, "docs/DECISIONS.md")).toContain("## ADR-003 — a 1");
    const state = doc(goc, "docs/STATE.md");
    expect(state).toContain("| 3 | **[MỞ]** việc của a (ADR-003, §S1.3) |");
    expect(state).toContain("**[S1.2] ba ADR**");
    expect(state).toContain("**CÒN MỞ TÍNH TỚI HEAD:** 2 · 3\n");
    expect(state).toContain("Trong **hai** khoản ấy, **một** không phải việc của mã nguồn");
    expect(state).toContain("và **một** thì có");
    expect(doc(goc, "evidence/security-reviews.md")).toContain("# §S1.3 — a\n\nADR-003; khoản 3; migration `002` (`002_a.sql`).");
    expect(existsSync(join(goc, "db/migrations/9501_a.sql"))).toBe(false);
    expect(doc(goc, "db/migrations/002_a.sql")).toContain("-- 002_a.sql — [S1.3 / ADR-003]");
    const handoff = doc(goc, "Handoff.md");
    expect(handoff).toContain("**[S1.2] 2 migration đánh số**");
    expect(handoff).toContain("**[S1.2] 3 khoản, trong đó 2 còn mở**");
    expect(handoff).toContain("**[S1.2] 3 ADR**");
    expect(kiem(goc)).toEqual([]);

    // Chạy lại trên cùng base: không đổi một byte.
    expect(capSo(goc, { base: "master" }).tepDaGhi).toEqual([]);
  });

  it("symlink chưa theo dõi (như `node_modules` trỏ đi nơi khác) không bị đọc như văn bản — kể cả tệp PHÍA SAU nó", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    // Tệp phía sau liên kết mang một số tạm không có chỗ khai: đọc nó là lệnh từ chối. Trên Linux git
    // chỉ liệt kê chính liên kết; trên Windows git đi xuyên junction và liệt kê `lien-ket/tep.md`.
    const dich = mkdtempSync(join(tmpdir(), "cap-so-dich-"));
    khoDaDung.push(dich);
    writeFileSync(join(dich, "tep.md"), "Xem ADR-9202.\n", "utf8");
    symlinkSync(dich, join(goc, "lien-ket"), "junction");
    expect(laTepThuong(goc, "lien-ket")).toBe(false);
    expect(laTepThuong(goc, "lien-ket/tep.md")).toBe(false);
    expect(laTepThuong(goc, "docs/STATE.md")).toBe(true);
    expect(capSo(goc, { base: "master" }).bang.adr.get(9201)).toBe(3);
  });

  it("nhánh chưa merge base thì từ chối, không ghi gì", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    git(goc, "checkout", "-q", "master");
    noi(goc, "docs/DECISIONS.md", "\n## ADR-003 — master\n\nThân.\n");
    commit(goc, "master đi trước");
    git(goc, "checkout", "-q", "a");
    expect(() => capSo(goc, { base: "master" })).toThrow(CapSoError);
    expect(git(goc, "status", "--porcelain")).toBe("");
  });

  it("số tạm có tiền tố mà không có chỗ khai thì từ chối", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    noi(goc, "evidence/security-reviews.md", "\nXem ADR-9209.\n");
    expect(() => capSo(goc, { base: "master" })).toThrow(/ADR.*9209|9209.*không có chỗ khai/);
  });
});

describe("kho thật — hai nhánh cùng cấp số, một nhánh merge trước", () => {
  it("nhánh sau merge master, lệnh gỡ xung đột, thu hồi lần cấp cũ và cấp lại — mọi dạng tham chiếu theo số mới", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    capVaCommit(goc, "a");
    lamViec(goc, "b", 2);
    expect(capVaCommit(goc, "b")).toBe("Cap-So: vong 9101=3; adr 9201=003 9202=004; khoan 9401=3; migration 9501=002");

    // `a` vào master trước.
    git(goc, "checkout", "-q", "master");
    git(goc, "merge", "-q", "--ff-only", "a");
    expect(kiem(goc)).toEqual([]);

    // `b` merge master: trùng ADR-003, khoản 3, S1.3, migration 002 — và xung đột ở chỗ cả hai nối.
    git(goc, "checkout", "-q", "b");
    expect(() => git(goc, "merge", "-q", "master")).toThrow();
    const kq = capSo(goc, { base: "master" });
    expect(kq.bao.length).toBeGreaterThan(0);
    expect(vietTrailer(kq.bang)).toBe("Cap-So: vong 9101=4; adr 9201=004 9202=005; khoan 9401=4; migration 9501=003");
    commit(goc, `b: merge master, cấp lại\n\n${vietTrailer(kq.bang)}`);

    const quyetDinh = doc(goc, "docs/DECISIONS.md");
    expect(quyetDinh).toContain("## ADR-003 — a 1");
    expect(quyetDinh).toContain("## ADR-004 — b 1");
    expect(quyetDinh).toContain("## ADR-005 — b 2");
    const state = doc(goc, "docs/STATE.md");
    expect(state).toContain("| 3 | **[MỞ]** việc của a (ADR-003, §S1.3) |");
    expect(state).toContain("| 4 | **[MỞ]** việc của b (ADR-004…005, §S1.4) |");
    expect(state).toContain("**CÒN MỞ TÍNH TỚI HEAD:** 2 · 3 · 4\n");
    expect(state).toContain("**[S1.2] năm ADR**");
    const bienBan = doc(goc, "evidence/security-reviews.md");
    expect(bienBan).toContain("# §S1.3 — a\n\nADR-003; khoản 3; migration `002` (`002_a.sql`).");
    expect(bienBan).toContain("# §S1.4 — b\n\nADR-004…005; khoản 4; migration `003` (`003_b.sql`).");
    expect(doc(goc, "db/migrations/002_a.sql")).toContain("-- 002_a.sql — [S1.3 / ADR-003]");
    expect(doc(goc, "db/migrations/003_b.sql")).toContain("-- 003_b.sql — [S1.4 / ADR-004…005]");
    expect(existsSync(join(goc, "db/migrations/002_b.sql"))).toBe(false);
    expect(doc(goc, "Handoff.md")).toContain("**[S1.2] 3 migration đánh số**");
    expect(kiem(goc)).toEqual([]);

    // `b` vào master: sạch, không số trùng.
    git(goc, "checkout", "-q", "master");
    git(goc, "merge", "-q", "--ff-only", "b");
    expect(kiem(goc)).toEqual([]);
  });

  it("dòng sửa SAU lần cấp cũ vẫn được thu hồi theo token có tiền tố", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    capVaCommit(goc, "a");
    lamViec(goc, "b", 1);
    capVaCommit(goc, "b");
    noi(goc, "evidence/security-reviews.md", "\nThêm sau lần cấp: ADR-003 và S1.3.\n");
    commit(goc, "b: sửa thêm");

    git(goc, "checkout", "-q", "master");
    git(goc, "merge", "-q", "--ff-only", "a");
    git(goc, "checkout", "-q", "b");
    expect(() => git(goc, "merge", "-q", "master")).toThrow();
    capSo(goc, { base: "master" });
    expect(doc(goc, "evidence/security-reviews.md")).toContain("Thêm sau lần cấp: ADR-004 và S1.4.");
  });
});

describe("kho thật — master còn viết lời khai lối cũ, mang số vòng nhánh từng giữ", () => {
  /** `a` cấp số rồi sửa lời khai ADR theo lối cũ: gạch số cũ, nối số mới với tiền tố vòng của `a`. */
  function aLoiCu(goc: string): void {
    lamViec(goc, "a", 1);
    capVaCommit(goc, "a");
    ghi(goc, "docs/STATE.md", doc(goc, "docs/STATE.md").replace("**[S1.2] ba ADR**", "~~**[S1.2] hai ADR**~~ **[S1.3] ba ADR**"));
    commit(goc, "a: lời khai lối cũ");
    lamViec(goc, "b", 1);
    capVaCommit(goc, "b");
    git(goc, "checkout", "-q", "master");
    git(goc, "merge", "-q", "--ff-only", "a");
    git(goc, "checkout", "-q", "b");
    expect(() => git(goc, "merge", "-q", "master")).toThrow();
  }

  it("chạy lại khi chưa commit: không đổi một byte, tiền tố [S1.3] của master đứng nguyên", () => {
    const goc = dungKho();
    aLoiCu(goc);
    expect(vietTrailer(capSo(goc, { base: "master" }).bang)).toBe("Cap-So: vong 9101=4; adr 9201=004; khoan 9401=4; migration 9501=003");
    const state = doc(goc, "docs/STATE.md");
    expect(state).toContain("~~**[S1.2] hai ADR**~~ **[S1.3] bốn ADR**");
    expect(capSo(goc, { base: "master" }).tepDaGhi).toEqual([]);
    expect(doc(goc, "docs/STATE.md")).toBe(state);
  });

  it("dòng viết SAU lần cấp chưa commit, nhắc số master vừa lấy (S1.3, ADR-003): lần chạy sau không đụng", () => {
    const goc = dungKho();
    aLoiCu(goc);
    capSo(goc, { base: "master" });
    noi(goc, "evidence/security-reviews.md", "\nSau khi a vào master (S1.3, ADR-003) — nhánh này là S1.4, ADR-004.\n");
    capSo(goc, { base: "master" });
    expect(doc(goc, "evidence/security-reviews.md")).toContain("Sau khi a vào master (S1.3, ADR-003) — nhánh này là S1.4, ADR-004.");
  });

  it("commit mà quên trailer, rồi chạy lại: vẫn không đổi một byte", () => {
    const goc = dungKho();
    aLoiCu(goc);
    capSo(goc, { base: "master" });
    commit(goc, "b: merge master, quên trailer");
    const state = doc(goc, "docs/STATE.md");
    expect(capSo(goc, { base: "master" }).tepDaGhi).toEqual([]);
    expect(doc(goc, "docs/STATE.md")).toBe(state);
  });
});

describe("--kiem", () => {
  it("đỏ khi còn số tạm, và khi hai migration cùng số", () => {
    const goc = dungKho();
    lamViec(goc, "a", 1);
    const loi = kiem(goc);
    expect(loi.some((l) => l.includes("S1.9101"))).toBe(true);
    expect(loi.some((l) => l.includes("ADR-9201"))).toBe(true);
    expect(loi.some((l) => l.includes("hàng sổ nợ khoản 9401"))).toBe(true);
    expect(loi.some((l) => l.includes("9501_a.sql"))).toBe(true);

    const sach = dungKho();
    ghi(sach, "db/migrations/001_hai.sql", "SELECT 2;\n");
    commit(sach, "trùng");
    expect(kiem(sach).some((l) => l.includes("hai migration cùng số 001"))).toBe(true);
  });
});
