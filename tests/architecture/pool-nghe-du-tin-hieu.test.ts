// ==============================================================================================
// [S1.84 / khoản 129 và khoản 173] MỌI POOL DỰNG TRONG `apps/` PHẢI NGHE ĐỦ HAI TÍN HIỆU
// MẤT-KHÔNG-AI-BIẾT.
//
// Hai tín hiệu ấy có chung một tính chất: chúng KHÔNG được ném cho ai, nên nếu không có người
// nghe thì chúng biến mất hoàn toàn.
//   ⑴ `release` mang `TenantError` mã `SESSION_STATE_LEFT` — `withTenant` huỷ một kết nối vì
//      trạng thái phiên còn sót sau giao dịch (khoản 118).
//   ⑵ sự kiện `SU_KIEN_LOI_KET_NOI_TOI_MUON` — lần lấy kết nối tới SAU trần `maxConnectWaitMs`,
//      người gọi đã nhận `CONNECT_WAIT_EXCEEDED` và đi (khoản 129).
//
// VÌ SAO CỔNG NÀY TỒN TẠI, và nó là cái giá chủ dự án chọn trả ngày 2026-09-19 (ADR-041): hình
// dạng "sự kiện trên pool" không đổi một chỗ gọi nào, nhưng nó dựa vào một lớp GẮN BẰNG TAY ở
// composition root — và lớp ấy ĐÃ bị quên một lần. Khoản 173 đo được: tới S1.83,
// `apps/api/src/composition.ts` gắn ⑴ cho cả hai pool còn `apps/unseal-worker` không gắn lần nào,
// nên cùng một sự cố để lại dấu ở `api` và không để lại gì ở tiến trình DUY NHẤT giải mã được
// phong bì. Một lớp quên được mà không ai biết thì không phải một lớp.
//
// PHÉP ĐỌC LÀ CÂY CÚ PHÁP, không phải biểu thức chính quy: một chuỗi trong chú thích hay một tên
// biến trùng chữ không được tính là một lời gọi. Cùng kỷ luật với `ghi-so-tu-choi-mot-duong.test.ts`.
//
// RANH GIỚI, nói ra: cổng đọc TÊN BIẾN trong CÙNG MỘT TỆP. Một pool dựng ở tệp này rồi truyền sang
// tệp khác để gắn listener sẽ bị tính là thiếu; hôm nay không ca nào như thế, và nếu có thì lời
// giải đúng là khai vào `NGOAI_LE` ngay dưới kèm lý do, chứ không phải nới phép đọc.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** Tệp MÃ SẢN XUẤT của `apps/` — bỏ test, bỏ `.d.ts`. `git ls-files` chứ không `readdirSync`: tệp dò tạm không được tính. */
const TEP_APP = git(["ls-files", "-z", "--", "apps/**/*.ts"])
  .split("\0")
  .filter((d) => d !== "" && !d.endsWith(".d.ts") && !/\.(test|int\.test)\.ts$/u.test(d));

/**
 * Chỗ được miễn, kèm LÝ DO. Rỗng hôm nay — giữ lại để lần nới tiếp theo phải viết ra lý do của nó
 * thay vì sửa phép đọc.
 */
const NGOAI_LE: readonly { readonly tep: string; readonly bien: string; readonly lyDo: string }[] = [];

/** Tên hàm nghe ⑴ và ⑵. Bí danh import bị bỏ qua có chủ đích — đổi tên lúc import là một lần nới phải thấy được. */
const NGHE_RELEASE = new Set(["ghiLogKetNoiHuy"]);
const NGHE_TOI_MUON = new Set(["ngheLoiKetNoiToiMuon", "ghiLogLoiKetNoiToiMuon"]);

interface HoSoTep {
  readonly tep: string;
  /** Tên biến được gán từ `createPool(...)`. */
  readonly poolDung: string[];
  /** Tên biến đã có người nghe ⑴ — qua hàm bọc, hay `<bien>.on("release", …)` viết thẳng. */
  readonly daNgheRelease: Set<string>;
  /** Tên biến đã có người nghe ⑵. */
  readonly daNgheToiMuon: Set<string>;
}

function tenBienCuaDoiSoDau(goi: ts.CallExpression): string | null {
  const d = goi.arguments[0];
  return d !== undefined && ts.isIdentifier(d) ? d.text : null;
}

function doc(tep: string): HoSoTep {
  const vanBan = readFileSync(join(GOC, tep), "utf8");
  const cay = ts.createSourceFile(tep, vanBan, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const poolDung: string[] = [];
  const daNgheRelease = new Set<string>();
  const daNgheToiMuon = new Set<string>();

  const duyet = (n: ts.Node): void => {
    // `const <ten> = createPool(...)`
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
      const kt = n.initializer;
      if (ts.isCallExpression(kt) && ts.isIdentifier(kt.expression) && kt.expression.text === "createPool") {
        poolDung.push(n.name.text);
      }
    }
    if (ts.isCallExpression(n)) {
      // `ghiLogKetNoiHuy(<bien>, …)` / `ngheLoiKetNoiToiMuon(<bien>, …)`
      if (ts.isIdentifier(n.expression)) {
        const ten = tenBienCuaDoiSoDau(n);
        if (ten !== null && NGHE_RELEASE.has(n.expression.text)) daNgheRelease.add(ten);
        if (ten !== null && NGHE_TOI_MUON.has(n.expression.text)) daNgheToiMuon.add(ten);
      }
      // `<bien>.on("release", …)` viết thẳng
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "on" &&
        ts.isIdentifier(n.expression.expression)
      ) {
        const d = n.arguments[0];
        if (d !== undefined && ts.isStringLiteralLike(d) && d.text === "release") {
          daNgheRelease.add(n.expression.expression.text);
        }
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(cay);
  return { tep, poolDung, daNgheRelease, daNgheToiMuon };
}

const HO_SO = TEP_APP.map(doc).filter((h) => h.poolDung.length > 0);

function duocMien(tep: string, bien: string): boolean {
  return NGOAI_LE.some((x) => x.tep === tep && x.bien === bien);
}

describe("[S1.84 / khoản 129, 173] pool của apps/ nghe đủ hai tín hiệu", () => {
  it("ĐỐI CHỨNG: phép đọc tìm ra được ít nhất hai tệp dựng pool — một phép đọc 0 tệp là một cổng rỗng ruột", () => {
    expect(HO_SO.map((h) => h.tep).sort().length).toBeGreaterThanOrEqual(2);
  });

  it("mọi pool dựng trong `apps/` có người nghe `release` (khoản 118 · 173)", () => {
    const thieu = HO_SO.flatMap((h) =>
      h.poolDung.filter((b) => !h.daNgheRelease.has(b) && !duocMien(h.tep, b)).map((b) => `${h.tep}: ${b}`),
    );
    expect(thieu, "pool không ai nghe `release` thì một kết nối bị huỷ vì trạng thái phiên còn sót là im lặng").toEqual([]);
  });

  it("mọi pool dựng trong `apps/` có người nghe lỗi-tới-muộn (khoản 129)", () => {
    const thieu = HO_SO.flatMap((h) =>
      h.poolDung.filter((b) => !h.daNgheToiMuon.has(b) && !duocMien(h.tep, b)).map((b) => `${h.tep}: ${b}`),
    );
    expect(thieu, "pool không ai nghe lỗi-tới-muộn thì kết nối nhiễm tới sau trần biến mất không dấu vết").toEqual([]);
  });

  it("mỗi dòng NGOAI_LE ứng với một pool CÓ THẬT — rác im lặng trong danh sách miễn là chỗ lần nới sau trốn vào", () => {
    const chet = NGOAI_LE.filter((x) => !HO_SO.some((h) => h.tep === x.tep && h.poolDung.includes(x.bien)));
    expect(chet).toEqual([]);
    expect(NGOAI_LE.filter((x) => x.lyDo.trim() === "")).toEqual([]);
  });
});
