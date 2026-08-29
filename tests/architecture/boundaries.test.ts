import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function depcruise(targets: string[]): { status: number; output: string } {
  const proc = spawnSync(
    "pnpm",
    ["exec", "depcruise", ...targets, "--config", ".dependency-cruiser.cjs"],
    { encoding: "utf8", shell: true },
  );
  return { status: proc.status ?? -1, output: `${proc.stdout}${proc.stderr}` };
}

/**
 * Chạy ĐÚNG script `pnpm depcruise` khai trong package.json thay vì một danh sách target tự
 * chọn. Fix round 4 (I1): hàng rào chỉ bảo vệ những thư mục thực sự nằm trong danh sách
 * cruise của script đó — `db/` từng bị bỏ sót trong khi tsconfig.json có include `db/**\/*.ts`
 * và `db/migrations.int.test.ts` tồn tại thật. Một probe gọi `depcruise(["db", ...])` trực
 * tiếp sẽ XANH ngay cả khi script vẫn thiếu `db`, tức là test trang trí. Chỉ khi chạy qua
 * chính script thì việc ai đó thu hẹp danh sách target mới làm test đỏ.
 */
function depcruiseTheoScript(): { status: number; output: string } {
  const proc = spawnSync("pnpm", ["run", "depcruise"], { encoding: "utf8", shell: true });
  return { status: proc.status ?? -1, output: `${proc.stdout}${proc.stderr}` };
}

/**
 * ĐO TẠI CHỖ xem hệ thống file có phân biệt hoa-thường không, thay vì suy từ `process.platform`.
 * Viết một file rồi thử nhìn lại nó bằng một cách viết hoa/thường khác: nhìn thấy nghĩa là
 * KHÔNG phân biệt.
 *
 * Vì sao ĐO chứ không SUY: cặp "hệ điều hành ↔ tính phân biệt hoa thường" không phải song ánh.
 * macOS mặc định APFS không phân biệt nhưng định dạng được thành phân biệt; Windows có thể bật
 * phân biệt hoa-thường cho từng thư mục (`fsutil file setCaseSensitiveInfo`) và mọi thư mục dưới
 * WSL đều phân biệt; Linux trên một ổ exFAT/NTFS gắn ngoài thì không. Suy từ `process.platform`
 * là ghim một bảo đảm vào một tiên đề chưa đo — đúng lớp lỗi mà lượt chạy CI đầu tiên bắt được.
 */
function heThongFilePhanBietHoaThuong(pThuMuc: string): boolean {
  const ten = "ZzDoPhanBietHoaThuong.tmp";
  const duongDan = `${pThuMuc}/${ten}`;
  writeFileSync(duongDan, "");
  try {
    return !existsSync(`${pThuMuc}/${ten.toLowerCase()}`);
  } finally {
    rmSync(duongDan, { force: true });
  }
}

describe("ranh giới kiến trúc", () => {
  it("[INV-G1] chặn module ngoài unseal-worker import đường mở khóa", () => {
    const dir = "apps/tmp-probe/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.ts`,
      [
        'import type { KeyUnwrapper } from "../../../packages/crypto-keys/src/unwrap.js";',
        "export type Leaked = KeyUnwrapper;",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe"]);
      expect(status).not.toBe(0);
      // Fix round 3 (N8): dùng tên rule ĐẦY ĐỦ, không dùng tiền tố dùng chung cho ba rule.
      // Tiền tố lỏng sẽ pass ngay cả khi rule SAI bắn (rule khác trong cùng họ tên bắn nhầm).
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts");
    } finally {
      rmSync("apps/tmp-probe", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] chặn import tương đối bỏ qua unwrap.ts, đi thẳng vào local-dev-unwrapper.ts", () => {
    // Fix round 1 (C2): trước đây quy tắc chỉ canh unwrap.ts. Đi thẳng vào file cài đặt
    // bằng đường dẫn tương đối (bỏ qua entrypoint hoàn toàn) từng lọt qua không bị phát hiện.
    const dir = "apps/tmp-probe-unwrapper/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.ts`,
      [
        'import type { KeyUnwrapper } from "../../../packages/crypto-keys/src/local-dev-unwrapper.js";',
        "export type Leaked = KeyUnwrapper;",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-unwrapper"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts");
    } finally {
      rmSync("apps/tmp-probe-unwrapper", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] chặn import tương đối lấy deriveOrgKey từ local-dev-shared.ts", () => {
    // Fix round 1 (C2): deriveOrgKey + node:crypto là đủ để tự giải mã phong bì mà không
    // đụng unwrap.ts một lần nào. local-dev-shared.ts phải nằm trong vùng bị canh gác.
    const dir = "apps/tmp-probe-shared/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.ts`,
      [
        'import { deriveOrgKey } from "../../../packages/crypto-keys/src/local-dev-shared.js";',
        "export { deriveOrgKey };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-shared"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts");
    } finally {
      rmSync("apps/tmp-probe-shared", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] chặn import bare specifier @trustprocure/crypto-keys/unwrap từ package ngoài", () => {
    // Fix round 1 (C1): specifier dạng bare "@trustprocure/crypto-keys/unwrap" không resolve
    // đúng qua tsconfig "paths" (wildcard không xử lý được subpath lồng), nên trước đây lọt
    // qua quy tắc mà không bị phát hiện. enhancedResolveOptions.exportsFields sửa việc resolve;
    // probe này dùng lại package tools/bench-keyprovider (đã có node_modules workspace symlink
    // thật) qua một file KHÔNG nằm trong ngoại lệ đã khai báo, để phép thử phản ánh đúng cách
    // resolve module thật xảy ra trong dự án.
    const path = "tools/bench-keyprovider/src/tmp-probe-bare-specifier.ts";
    writeFileSync(
      path,
      [
        'import { createLocalDevUnwrapper } from "@trustprocure/crypto-keys/unwrap";',
        "export const leak = createLocalDevUnwrapper;",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["tools/bench-keyprovider"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts");
    } finally {
      rmSync(path, { force: true });
    }
  }, 60000);

  it("[INV-G1] quy tắc chặn local-dev-shared.ts không phân biệt hoa-thường", () => {
    // Fix round 2 (N1): Windows/macOS resolve file KHÔNG phân biệt hoa thường, nhưng regex
    // của quy tắc từng phân biệt hoa thường — "Local-Dev-Shared.ts" (sai hoa/thường) resolve
    // thành công (trường "resolved" của depcruise giữ nguyên hoa/thường viết trong specifier)
    // nhưng không khớp regex, nên lọt qua. File .mjs (không phải .ts) được chọn cố ý vì nó
    // cũng vô hình với tsc (tsconfig chỉ include **/*.ts) và với eslint trước khi thu hẹp
    // ignore — kết hợp cả ba lỗ cùng lúc, đúng như phát hiện gốc của reviewer.
    //
    // ===================================================================================
    // LẦN CHẠY CI ĐẦU TIÊN (run 33218397033, 2026-08-28) — LỚP KHIẾM KHUYẾT MỚI:
    // "MỘT BẢO ĐẢM CHỈ ĐÚNG TRÊN MỘT HỆ ĐIỀU HÀNH."
    //
    // Bản trước khẳng định VÔ ĐIỀU KIỆN rằng depcruise phải bắn. Trên `ubuntu-latest`, hệ
    // thống file PHÂN BIỆT hoa thường: import "Local-Dev-Shared.ts" KHÔNG resolve được, nên
    // không có cạnh phụ thuộc nào, nên không có vi phạm nào — `expected +0 not to be +0`.
    // Chú thích của chính test này (và docs/TEST-PLAN.md §... hàng G1) đã NÓI RA tính chất ấy,
    // nhưng khẳng định thì viết không điều kiện. Hiểm hoạ KHÔNG tồn tại trên Linux; chỉ có
    // khẳng định là sai. Đây là họ hàng của QT2 ("ghim cấu hình, đừng nới bảo đảm") ở trục
    // NỀN TẢNG: bảo đảm phụ thuộc một tính chất của môi trường thì phải ĐO tính chất đó.
    //
    // TEST NÀY TÁCH LÀM HAI VẾ, VÀ VẾ ĐẦU MỚI LÀ VẾ MANG BẢO ĐẢM:
    //   (1) TÍNH CHẤT CỦA CHÍNH QUY TẮC — regex `to.path` khớp cả cách viết sai hoa-thường.
    //       Đúng trên MỌI hệ điều hành, đo được ở mọi nơi, và nó CHÍNH LÀ thứ fix round 2 đã
    //       thêm (`ci()`/`ciFile()` trong dependency-cruiser-ci.cjs). Gỡ `ciFile()` khỏi
    //       LOCAL_DEV_SHARED_TS là vế này đỏ ở CẢ Linux LẪN Windows — tức bảo đảm chống hồi
    //       quy nay không còn treo vào hệ điều hành của người chạy.
    //   (2) VẾ ĐẦU-CUỐI qua depcruise CLI thật — chỉ chạy khi hệ thống file ĐO ĐƯỢC là KHÔNG
    //       phân biệt hoa thường, và khi bỏ qua thì CÔNG BỐ ra log chứ không im lặng.
    //
    // VÌ SAO KHÔNG DÙNG `ctx.skip()`: một test mang nhãn `[INV-XX]` bị bỏ qua làm cổng evidence
    // ĐỎ khi nó là test duy nhất của mã đó (tools/inv-matrix/src/danh-gia.ts: nhánh
    // `every(status === "skipped")` trả `chan: true`). Quan trọng hơn: vế (1) VẪN là một phép
    // đo thật trên Linux, nên bỏ qua CẢ test cũng là nói sai — theo chiều ngược lại.
    // ===================================================================================
    interface DepCruiseRule {
      name: string;
      to: { path?: string };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const rule = config.forbidden.find(
      (r) => r.name === "g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts",
    );
    if (!rule?.to.path) {
      throw new Error(
        "Không tìm thấy rule g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts (hoặc " +
          "nó không còn `to.path`) trong .dependency-cruiser.cjs",
      );
    }
    const dichHanChe = new RegExp(rule.to.path);

    // VẾ (1) — ĐỘC LẬP HỆ ĐIỀU HÀNH.
    expect(dichHanChe.test("packages/crypto-keys/src/Local-Dev-Shared.ts")).toBe(true);
    // Đối chứng dương: cách viết ĐÚNG vẫn khớp — nếu không, quy tắc đã hỏng theo chiều khác.
    expect(dichHanChe.test("packages/crypto-keys/src/local-dev-shared.ts")).toBe(true);
    // Đối chứng âm: KHÔNG phải một regex khớp-tất-cả. Không có vế này, `new RegExp("")` cũng
    // làm hai khẳng định trên xanh.
    expect(dichHanChe.test("packages/crypto-keys/src/local-dev-wrapper.ts")).toBe(false);

    // VẾ (2) — ĐẦU-CUỐI, có điều kiện, và điều kiện được ĐO chứ không SUY.
    const dir = "apps/tmp-probe-case/src";
    mkdirSync(dir, { recursive: true });
    try {
      if (heThongFilePhanBietHoaThuong(dir)) {
        console.warn(
          "[INV-G1] vế ĐẦU-CUỐI KHÔNG chạy: hệ thống file ĐO ĐƯỢC là PHÂN BIỆT hoa-thường " +
            `(platform=${process.platform}). Import sai hoa-thường không resolve được ở đây, ` +
            "nên không sinh cạnh phụ thuộc nào để quy tắc bắn — 'không có vi phạm' là kết quả " +
            "ĐÚNG, không phải hàng rào thủng. Hiểm hoạ chỉ tồn tại trên hệ thống file KHÔNG " +
            "phân biệt hoa-thường (máy phát triển Windows/macOS mặc định), và vế (1) ở trên — " +
            "regex quy tắc không phân biệt hoa-thường — đã chạy thật ở lượt này.",
        );
        return;
      }
      writeFileSync(
        `${dir}/leak.mjs`,
        [
          'import { deriveOrgKey } from "../../../packages/crypto-keys/src/Local-Dev-Shared.ts";',
          "export { deriveOrgKey };",
          "",
        ].join("\n"),
      );
      const { status, output } = depcruise(["apps/tmp-probe-case"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts");
    } finally {
      rmSync("apps/tmp-probe-case", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] local-dev-wrapper.ts KHÔNG được miễn trừ khỏi quy tắc chặn local-dev-unwrapper.ts", () => {
    // Fix round 2 (N2): fix round 1 miễn trừ local-dev-wrapper.ts khỏi TOÀN BỘ quy tắc (vì nó
    // cần import local-dev-shared.ts) — nhưng điều đó cũng vô tình miễn trừ nó khỏi việc import
    // local-dev-unwrapper.ts, thứ nó KHÔNG BAO GIỜ được phép chạm tới (cầu nối bắc từ mặt bọc
    // an toàn sang khả năng giải mã).
    //
    // Fix round 3 (N9): bản trước của test này CHỈNH SỬA TRỰC TIẾP file local-dev-wrapper.ts
    // thật trên đĩa (nối thêm một dòng re-export rồi phục hồi ở finally). Rủi ro thật: process
    // bị crash/kill giữa lúc ghi và finally, hoặc một worker vitest khác đang import CHÍNH module
    // đó cùng lúc (wrapper.test.ts, roundtrip.test.ts đều import nó) đọc phải nội dung đã bị sửa
    // giữa chừng — cả hai đều để lại trạng thái xấu trong cây làm việc hoặc gây flaky test.
    //
    // Vì quy tắc depcruise neo CHÍNH XÁC vào đường dẫn thật của local-dev-wrapper.ts
    // ("^packages/crypto-keys/src/local-dev-wrapper.ts$"), không có cách nào dựng một file
    // KHÁC ở một đường dẫn KHÁC để kiểm tra đúng "danh tính" này qua một lần chạy depcruise
    // CLI thật mà không đụng file gốc. Thay vào đó, test này đọc TĨNH cấu hình
    // .dependency-cruiser.cjs (không ghi gì ra đĩa, không có trạng thái chia sẻ với worker
    // khác) và xác nhận trực tiếp: regex `from.pathNot` của rule
    // "khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts" KHÔNG khớp đường dẫn
    // local-dev-wrapper.ts, trong khi vẫn khớp đúng hai đường dẫn thực sự được miễn trừ
    // (unwrap.ts và apps/unseal-worker/**) — kiểm chứng đúng bất biến, không đụng file thật.
    interface DepCruiseRule {
      name: string;
      from: { pathNot?: string | string[] };
      to: { path?: string };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const rule = config.forbidden.find(
      (r) => r.name === "g1-khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts",
    );
    if (!rule) {
      throw new Error(
        "Không tìm thấy rule g1-khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts trong .dependency-cruiser.cjs",
      );
    }
    const danhSachMienTru = Array.isArray(rule.from.pathNot)
      ? rule.from.pathNot
      : [rule.from.pathNot ?? ""];
    const regexMienTru = new RegExp(danhSachMienTru.join("|"));

    // KHÔNG được miễn trừ — đây chính là lỗ N2.
    expect(regexMienTru.test("packages/crypto-keys/src/local-dev-wrapper.ts")).toBe(false);
    // Đối chứng dương: hai module thực sự cần miễn trừ vẫn phải khớp, xác nhận regex hoạt
    // động (không phải một regex hỏng luôn trả false).
    expect(regexMienTru.test("packages/crypto-keys/src/unwrap.ts")).toBe(true);
    expect(regexMienTru.test("apps/unseal-worker/src/bat-ky-file-nao.ts")).toBe(true);
  });

  it("[INV-G1] chặn import ngược từ apps/unseal-worker (fix round 3, N5)", () => {
    // Ba rule khong-giai-ma-ngoai-unseal-worker-* miễn trừ apps/unseal-worker/** khỏi vai trò
    // "from" để nó được import unwrap.ts/local-dev-unwrapper.ts/local-dev-shared.ts — nhưng
    // không rule nào (trước fix round 3) cấm import NGƯỢC LẠI vào chính apps/unseal-worker/**.
    // Một module bên trong unseal-worker re-export khả năng mở khóa, module khác import lại
    // — hàng rào không kêu. Nguy hiểm nhất vì thư mục này CHƯA TỒN TẠI: khi nó ra đời, mọi
    // symbol nó export sẽ với tới được từ mọi app khác nếu không có rule này.
    mkdirSync("apps/unseal-worker/src", { recursive: true });
    writeFileSync(
      "apps/unseal-worker/src/zprobe-reexport.ts",
      [
        'export { createLocalDevUnwrapper } from "../../../packages/crypto-keys/src/unwrap.js";',
        "",
      ].join("\n"),
    );
    mkdirSync("apps/tmp-probe-uw-bridge/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-uw-bridge/src/leak.ts",
      [
        'import { createLocalDevUnwrapper } from "../../unseal-worker/src/zprobe-reexport.js";',
        "export { createLocalDevUnwrapper };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-import-nguoc-tu-apps-unseal-worker");
    } finally {
      rmSync("apps/unseal-worker", { recursive: true, force: true });
      rmSync("apps/tmp-probe-uw-bridge", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] chặn import ngược từ tools/bench-keyprovider/src (fix round 3, N5)", () => {
    // Cùng lớp lỗ hổng với apps/unseal-worker: tools/bench-keyprovider/src/index.ts được miễn
    // trừ để gọi unwrap.ts, nhưng không gì cấm import NGƯỢC LẠI vào bất kỳ file nào trong
    // tools/bench-keyprovider/src — kể cả file không liên quan gì tới mật mã, chỉ để chứng
    // minh chính bản thân cây thư mục này phải là đích hạn chế.
    writeFileSync("tools/bench-keyprovider/src/zprobe-plain.ts", "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-bench-bridge/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-bench-bridge/src/leak.ts",
      [
        'import { zplaceholder } from "../../../tools/bench-keyprovider/src/zprobe-plain.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-bench-bridge", "tools/bench-keyprovider"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-import-nguoc-tu-bench-keyprovider");
    } finally {
      rmSync("tools/bench-keyprovider/src/zprobe-plain.ts", { force: true });
      rmSync("apps/tmp-probe-bench-bridge", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] chặn import ngược từ roundtrip.test.ts (fix round 3, N5)", () => {
    // Cùng lớp lỗ hổng: roundtrip.test.ts được miễn trừ để tự import unwrap.ts kiểm chứng
    // vòng đời khóa, nhưng không gì cấm import NGƯỢC LẠI từ nó. Test này KHÔNG đụng tới nội
    // dung thật của roundtrip.test.ts (tránh đúng rủi ro N9 đã nêu ở trên) — chỉ cần viết một
    // import statement TRONG FILE PROBE nhắm tới roundtrip.test.ts; depcruise ghi nhận cạnh
    // phụ thuộc ở tầng cú pháp (parse import, không phải typecheck), nên tên import "không tồn
    // tại thật" vẫn đủ để tạo cạnh cần kiểm tra mà không cần sửa file gốc.
    mkdirSync("apps/tmp-probe-roundtrip-bridge/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-roundtrip-bridge/src/leak.ts",
      [
        'import { khongTonTaiThat } from "../../../packages/crypto-keys/src/roundtrip.test.js";',
        "export { khongTonTaiThat };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-roundtrip-bridge", "packages/crypto-keys"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-khong-import-nguoc-tu-roundtrip-test");
    } finally {
      rmSync("apps/tmp-probe-roundtrip-bridge", { recursive: true, force: true });
    }
  }, 60000);

  // ======================================================================================
  // Fix round 4 — ba probe thường trực cho CR1, CR2, I1 + hai bất biến chống tái diễn
  // ======================================================================================

  it("[INV-G1] chặn import thẳng vào local-dev-wrapper.ts từ ngoài package (CR1)", () => {
    // CR1: local-dev-wrapper.ts được miễn trừ vai trò `from` ở rule
    // g1-...-local-dev-shared-ts (nó cần deriveOrgKey để bọc khóa) nhưng qua ba vòng fix nó
    // vẫn KHÔNG phải đích hạn chế — module thứ tư bị sót. Hệ quả: thêm đúng một dòng
    // `export { deriveOrgKey } from "./local-dev-shared.js";` vào nó là mọi app import thẳng
    // được deriveOrgKey, và vì index.ts vốn đã re-export từ nó, cây cầu còn đi qua được cả
    // barrel công khai @trustprocure/crypto-keys.
    //
    // Probe này KHÔNG sửa nội dung local-dev-wrapper.ts (tránh đúng rủi ro N9): chỉ cần một
    // module NGOÀI package trỏ vào nó là quy tắc cửa công khai phải bắn — depcruise ghi nhận
    // cạnh ở tầng cú pháp nên tên import không cần tồn tại thật.
    const dir = "apps/tmp-probe-wrapper-door/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.ts`,
      [
        'import { deriveOrgKey } from "../../../packages/crypto-keys/src/local-dev-wrapper.js";',
        "export { deriveOrgKey };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-wrapper-door", "packages/crypto-keys"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai");
    } finally {
      rmSync("apps/tmp-probe-wrapper-door", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] module MỚI thêm vào packages/crypto-keys/src mặc định không với tới được từ ngoài", () => {
    // Đây là probe chống-tái-diễn quan trọng nhất của fix round 4. Ba vòng trước đều vá theo
    // ca cụ thể, nên mỗi module mới trong thư mục nhạy cảm lại mặc định HỞ cho tới khi ai đó
    // nhớ ra phải thêm quy tắc. Probe này dựng một file HOÀN TOÀN MỚI (không xuất hiện trong
    // bất kỳ quy tắc nào, không ai nghĩ trước tới) và xác nhận nó vẫn bị chặn — tức bất biến
    // đã đổi chiều từ "mặc định mở" sang "mặc định đóng".
    //
    // File probe trung tính (không dính gì tới mật mã) và mang tên riêng không module nào
    // import, nên không có rủi ro worker vitest khác đọc phải nội dung sửa dở như N9.
    const moduleMoi = "packages/crypto-keys/src/zzprobe-module-moi.ts";
    writeFileSync(moduleMoi, "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-module-moi/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-module-moi/src/leak.ts",
      [
        'import { zplaceholder } from "../../../packages/crypto-keys/src/zzprobe-module-moi.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-module-moi", "packages/crypto-keys"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai");
      expect(output).toContain("zzprobe-module-moi");
    } finally {
      rmSync(moduleMoi, { force: true });
      rmSync("apps/tmp-probe-module-moi", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] đường dẫn hợp lệ chứa chuỗi con 'dist' vẫn được quét (CR2)", () => {
    // CR2: options.exclude từng là regex KHÔNG NEO "(node_modules|dist|\\.next)", khớp chuỗi
    // con ở bất kỳ đâu — mọi module dưới apps/distribution/, district/, redistribute.ts…
    // bị loại khỏi cruise HOÀN TOÀN, hàng rào G1 tắt im lặng cho cả lớp đường dẫn hợp lệ đó.
    //
    // Probe cố ý dùng tên thư mục hợp lệ "apps/distribution" (KHÔNG phải "dist/") để kiểm
    // đúng bản chất lỗi: neo đoạn đường dẫn, chứ không phải "có loại trừ dist hay không".
    const dir = "apps/distribution/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.ts`,
      [
        'import { deriveOrgKey } from "../../../packages/crypto-keys/src/local-dev-shared.js";',
        "export { deriveOrgKey };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/distribution", "packages/crypto-keys"]);
      expect(status).not.toBe(0);
      // Khẳng định chính module đó ĐÃ được quét — nếu exclude lại nới ra, nó biến mất khỏi
      // đồ thị và không tên rule nào nhắc tới nó nữa.
      expect(output).toContain("apps/distribution/src/leak.ts");
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts");
    } finally {
      rmSync("apps/distribution", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-G1] thư mục db/ nằm trong danh sách cruise của script pnpm depcruise (I1)", () => {
    // I1: script depcruise từng là "depcruise packages apps tools tests" trong khi
    // tsconfig.json include db/**/*.ts và db/migrations.int.test.ts tồn tại thật — một file
    // db/*.ts import thẳng unwrap.ts cho EXIT=0 vì chưa từng được quét.
    //
    // Probe chạy qua CHÍNH script package.json (xem depcruiseTheoScript) nên nếu ai đó thu
    // hẹp danh sách target trở lại, test này đỏ. File probe đặt ở db/ gốc, KHÔNG đụng
    // db/migrations (lãnh thổ Task 3).
    const probe = "db/zzprobe-leak.ts";
    writeFileSync(
      probe,
      [
        'import { createLocalDevUnwrapper } from "../packages/crypto-keys/src/unwrap.js";',
        "export { createLocalDevUnwrapper };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruiseTheoScript();
      expect(status).not.toBe(0);
      expect(output).toContain("db/zzprobe-leak.ts");
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 120000);

  it("[INV-G1] mọi module được miễn trừ vai trò `from` đều đồng thời là đích hạn chế", () => {
    // BẤT BIẾN CHỐNG TÁI DIỄN (fix round 4). Ba vòng fix trước đều đóng đúng những lỗ được
    // reviewer chỉ ra rồi tự mở một lỗ cùng lớp, vì cơ chế là "nhớ mà làm": mỗi lần miễn trừ
    // một module khỏi vai trò `from`, người viết phải TỰ NHỚ biến module đó thành đích hạn
    // chế, nếu không nó vẫn re-export được và không quy tắc nào cấm import VÀO nó. CR1 chính
    // là lần thứ tư quên.
    //
    // Test này biến việc đó thành CƯỠNG CHẾ BẰNG MÁY: quét trực tiếp .dependency-cruiser.cjs,
    // lấy mọi quy tắc thuộc họ "g1-", giải mã ngược từng mục `from.pathNot` về đường dẫn
    // literal bằng unCi(), rồi kiểm chứng đường dẫn đó bị MỘT quy tắc "g1-" nào đó chặn
    // đường vào. Không cần ai nghĩ ra ca cụ thể; thêm miễn trừ mà quên đóng đường ra là đỏ.
    interface DepCruiseRule {
      name: string;
      from: { pathNot?: string | string[] };
      to: { path?: string | string[]; pathNot?: string | string[] };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const { ci, unCi } = require("../../dependency-cruiser-ci.cjs") as {
      ci: (s: string) => string;
      unCi: (s: string) => string;
    };

    const quyTacG1 = config.forbidden.filter((r) => r.name.startsWith("g1-"));
    // Đối chứng dương: nếu đổi giao ước đặt tên mà quên cập nhật test, danh sách rỗng sẽ làm
    // toàn bộ vòng lặp dưới thành vô nghĩa (test trang trí). Chặn trước khả năng đó.
    expect(quyTacG1.length).toBeGreaterThanOrEqual(8);

    const nhuMang = (v: string | string[] | undefined): string[] =>
      v === undefined ? [] : Array.isArray(v) ? v : [v];

    /** Dựng một đường dẫn ĐẠI DIỆN cho fragment regex do ciFile()/ciPrefix() sinh ra. */
    function duongDanDaiDien(pRegex: string): string {
      const coNeoCuoi = pRegex.endsWith("$");
      let than = pRegex;
      if (than.startsWith("^")) {
        than = than.slice(1);
      }
      if (coNeoCuoi) {
        than = than.slice(0, -1);
      }
      const literal = unCi(than);
      // Kiểm chứng round-trip: bắt buộc fragment phải do ci() sinh ra. Một regex viết tay
      // trong `from.pathNot` của quy tắc "g1-" sẽ làm assertion này đỏ — đúng ý đồ, vì
      // không giải mã ngược được thì cũng không kiểm chứng được nó có bị chặn đường vào hay
      // không, và một miễn trừ không kiểm chứng được là một miễn trừ không được phép tồn tại.
      expect("^" + ci(literal) + (coNeoCuoi ? "$" : "")).toBe(pRegex);
      return coNeoCuoi ? literal : literal + "zz-mau-dai-dien.ts";
    }

    /** Có quy tắc "g1-" nào biến đường dẫn này thành đích hạn chế không? */
    function laDichHanChe(pDuongDan: string): boolean {
      return quyTacG1.some((r) => {
        const dsPath = nhuMang(r.to.path);
        if (dsPath.length === 0 || !dsPath.some((p) => new RegExp(p).test(pDuongDan))) {
          return false;
        }
        return !nhuMang(r.to.pathNot).some((p) => new RegExp(p).test(pDuongDan));
      });
    }

    const thieuDichHanChe: string[] = [];
    for (const quyTac of quyTacG1) {
      for (const mienTru of nhuMang(quyTac.from.pathNot)) {
        const daiDien = duongDanDaiDien(mienTru);
        if (!laDichHanChe(daiDien)) {
          thieuDichHanChe.push(`${quyTac.name} miễn trừ ${daiDien} nhưng không ai chặn đường vào`);
        }
      }
    }
    expect(thieuDichHanChe).toEqual([]);

    // Đối chứng âm: hàm laDichHanChe() phải biết trả false, không phải hàm luôn-true.
    expect(laDichHanChe("apps/mot-app-binh-thuong/src/index.ts")).toBe(false);
    // Đối chứng dương cho ĐÚNG lỗ CR1: local-dev-wrapper.ts phải là đích hạn chế.
    expect(laDichHanChe("packages/crypto-keys/src/local-dev-wrapper.ts")).toBe(true);
  });

  it("[INV-G1] cửa công khai của packages/crypto-keys/src đúng bằng index.ts và unwrap.ts", () => {
    // Canary cho chính sách tối giản không thể suy ra bằng máy: quy tắc cửa công khai chỉ có
    // giá trị khi tập cửa được mở là NHỎ NHẤT có thể. Nếu ai đó nới `to.pathNot` để "cho qua"
    // một module nữa, đó là quyết định phải được nhìn thấy, không phải một dòng lặng lẽ.
    interface DepCruiseRule {
      name: string;
      to: { pathNot?: string | string[] };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const { ciFile } = require("../../dependency-cruiser-ci.cjs") as {
      ciFile: (s: string) => string;
    };
    const rule = config.forbidden.find(
      (r) => r.name === "g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai",
    );
    if (!rule) {
      throw new Error(
        "Không tìm thấy rule g1-crypto-keys-chi-index-va-unwrap-la-cua-cong-khai trong .dependency-cruiser.cjs",
      );
    }
    expect(rule.to.pathNot).toEqual([
      ciFile("packages/crypto-keys/src/index.ts"),
      ciFile("packages/crypto-keys/src/unwrap.ts"),
    ]);
  });

  // ======================================================================================
  // [vòng fix 1 Task 9 — MỤC 3] VÌ SAO NĂM TEST DƯỚI ĐÂY MANG `[INV-H11]` CHỨ KHÔNG PHẢI
  // `[INV-G2]`, VÀ MƯỜI TEST `[INV-G1]` Ở TRÊN THÌ GIỮ NGUYÊN
  //
  // Sổ đăng ký là docs/TEST-PLAN.md §2, không phải trực giác. Ở đó:
  //     G2 = "Mỗi RFQ một cặp khoá; lộ một RFQ không lan sang RFQ khác"
  //     G3 = "Xoay master key không làm mất khả năng giải mã báo giá cũ"
  // Năm test dưới đây (và bốn test `g3-` ở cuối file) đo QUY TẮC BIÊN GIỚI MODULE của
  // dependency-cruiser. Chúng không chạm một cặp khoá RFQ nào và không xoay một khoá nào. Bộ
  // sinh của Task 11 gom test theo MÃ (`/\[INV-([A-H]\d+)\]/g`), nên để nguyên là nộp cho
  // `evidence/INV-matrix.md` sáu dòng "passed" dưới hàng G3 mà bốn dòng không liên quan gì tới
  // xoay khoá — nặng hơn ca G2 của Task 7 vì test G2/G3 ĐÚNG NGHĨA vẫn tồn tại song song, nên
  // va chạm là VÔ HÌNH nếu không đọc tên. Lớp khiếm khuyết: "mốc chết giả đã dịch chỗ — nó
  // không còn ở TEST, nó ở NHÃN."
  //
  // MÃ MỚI, KHÔNG PHẢI MÃ MƯỢN: docs/TEST-PLAN.md §5 đã có sẵn nhóm H — "bất biến hàng rào" —
  // và một quy tắc biên giới depcruise LÀ một hàng rào, cùng hạng với hai hook `git-safety` /
  // `protect-secrets`. H11 và H12 được ĐĂNG KÝ ở §5 (không phải bịa ra ở đây), và chúng khớp
  // sẵn regex `[A-H]\d+` nên bộ sinh của Task 11 không phải đổi một dòng nào.
  //     H11 = biên giới module của packages/identity (họ quy tắc `g2-`)
  //     H12 = packages/identity KHÔNG có năng lực mật mã (họ quy tắc `g3-`)
  //
  // MƯỜI TEST `[INV-G1]` Ở TRÊN THÌ ĐÚNG và được giữ: G1 = "Private key RFQ không bao giờ ở
  // dạng rõ ngoài unseal-worker", và quy tắc `g1-` cưỡng chế CHÍNH bất biến đó — nhãn khớp thứ
  // được đo. Ở đây trục nghiệp vụ và trục hàng rào TRÙNG nhau; ở H11/H12 thì không.
  //
  // TÊN QUY TẮC depcruise (`g1-`/`g2-`/`g3-`) GIỮ NGUYÊN. Vấn đề nằm ở NHÃN TEST, không ở tên
  // quy tắc; đổi tên quy tắc sẽ chạm `.dependency-cruiser.cjs`, ba canary tự canh cấu hình, và
  // mọi thông báo lỗi đã được viện dẫn trong sổ tiến trình — tức trả một cái giá thật cho đúng
  // 0 bảo đảm.
  //
  // `[INV-G2]` LÀ LỖI TIỀN TỒN CỦA TASK 8, VÀ NÓ ĐƯỢC SỬA Ở ĐÂY chứ không để lại: Task 11 là
  // bên TIÊU THỤ ma trận này; để lại nghĩa là bắt Task 11 hoà giải một đầu vào đã biết là sai.
  //
  // *** HỆ QUẢ PHẢI NÓI RA, VÀ NÓ LÀ ĐIỂM QUAN TRỌNG NHẤT CỦA VIỆC ĐỔI NHÃN NÀY ***
  // Sau khi năm nhãn `[INV-G2]` rời khỏi file này, số test mang `[INV-G2]` trong TOÀN REPO là
  // **KHÔNG**. Đó KHÔNG phải một hồi quy — đó là sự thật hiện ra. G2 = "mỗi RFQ một cặp khoá; lộ
  // một RFQ không lan sang RFQ khác", và `packages/crypto-keys/src/roundtrip.test.ts:47` đã TỰ
  // GHI RA rằng nó cố ý KHÔNG gắn `[INV-G2]` vì "khoá theo RFQ" chưa tồn tại (thuộc S1). Tức
  // hàng G2 lẽ ra đã trống từ đầu, và năm test biên giới module đang LẤP nó bằng bằng chứng của
  // một bất biến khác. `evidence/INV-matrix.md` của Task 11 nay sẽ báo G2 = CHƯA PHỦ. Đó là câu
  // trả lời ĐÚNG, và nó chỉ nói được sau khi nhãn được sửa.
  // (Hai test `[INV-G3]` THẬT vẫn còn — `roundtrip.test.ts`, xoay master key — nên hàng G3 KHÔNG
  // trống, chỉ hết bốn dòng không liên quan.)
  // ======================================================================================
  // Vòng fix 2 (MỤC D) — CÙNG KHUÔN, ÁP CHO packages/identity/src/
  //
  // Bất đối xứng đo được tại HEAD 33985b8, ba đường tới CÙNG một symbol `hasPermission`:
  //     @trustprocure/identity              (barrel)  -> không có symbol
  //     @trustprocure/identity/src/rbac.js            -> depcruise CHẶN + tsc CHẶN (TS2307)
  //     ../../identity/src/rbac.js từ packages/audit  -> CHẠY ĐƯỢC, depcruise IM, tsc IM,
  //                                                      eslint IM
  // Tức lớp cưỡng chế duy nhất của vòng fix 1 (barrel-exports.test.ts canh TẬP EXPORT của cửa)
  // KHÔNG canh đường tương đối xuyên gói. Năm test dưới đây đóng đúng lớp đó, cùng khuôn
  // "mặc định đóng" mà crypto-keys đã dùng từ fix round 4.
  // ======================================================================================

  it("[INV-H11] chặn import TƯƠNG ĐỐI xuyên gói vào packages/identity/src/rbac.ts", () => {
    // ĐÚNG đường đi mà reviewer đo được là im lặng ở cả ba lớp.
    const probe = "packages/audit/src/zzprobe-duong-tuong-doi.ts";
    writeFileSync(
      probe,
      [
        'import { hasPermission } from "../../identity/src/rbac.js";',
        "export { hasPermission };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/audit", "packages/identity"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-duong-tuong-doi.ts");
      expect(output).toContain("g2-identity-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H11] module MỚI thêm vào packages/identity/src mặc định không với tới được từ ngoài", () => {
    // Probe chống-tái-diễn: file HOÀN TOÀN MỚI, không xuất hiện trong bất kỳ quy tắc nào. Nếu
    // ai đó sau này diễn đạt lại quy tắc theo kiểu "cấm từng cạnh", test này đỏ.
    const moduleMoi = "packages/identity/src/zzprobe-module-moi.ts";
    writeFileSync(moduleMoi, "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-identity-moi/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-identity-moi/src/leak.ts",
      [
        'import { zplaceholder } from "../../../packages/identity/src/zzprobe-module-moi.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-identity-moi", "packages/identity"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-module-moi");
      expect(output).toContain("g2-identity-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(moduleMoi, { force: true });
      rmSync("apps/tmp-probe-identity-moi", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H11] cửa index.ts VẪN đi qua được — đối chứng dương, chống quy tắc chặn-tất-cả", () => {
    // Không có vế này, hai test trên xanh kể cả khi quy tắc chặn LUÔN CẢ cửa hợp pháp, và bất
    // biến thu được sẽ là "không ai dùng được gói identity" chứ không phải thứ định canh.
    mkdirSync("apps/tmp-probe-identity-cua/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-identity-cua/src/dung.ts",
      [
        'import { requirePermission } from "../../../packages/identity/src/index.js";',
        "export { requirePermission };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-identity-cua", "packages/identity"]);
      expect(output).not.toContain("g2-identity-chi-index-la-cua-cong-khai");
      expect(status, `cửa hợp pháp bị chặn:\n${output}`).toBe(0);
    } finally {
      rmSync("apps/tmp-probe-identity-cua", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H11] mọi module được miễn trừ vai trò `from` ở họ g2- đều đồng thời là đích hạn chế", () => {
    // Bản sao chính xác của bất biến chống-tái-diễn ở họ "g1-", áp cho họ "g2-". Cùng lý do:
    // mỗi lần miễn trừ một module khỏi vai trò `from`, người viết phải TỰ NHỚ biến module đó
    // thành đích hạn chế — CR1 là lần thứ tư quên ở họ g1. Cưỡng chế bằng máy ngay từ quy tắc
    // g2- ĐẦU TIÊN, thay vì đợi tới lần quên đầu tiên.
    interface DepCruiseRule {
      name: string;
      from: { pathNot?: string | string[] };
      to: { path?: string | string[]; pathNot?: string | string[] };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const { ci, unCi } = require("../../dependency-cruiser-ci.cjs") as {
      ci: (s: string) => string;
      unCi: (s: string) => string;
    };

    const quyTacG2 = config.forbidden.filter((r) => r.name.startsWith("g2-"));
    // Đối chứng dương: danh sách rỗng sẽ làm cả vòng lặp dưới thành trang trí.
    expect(quyTacG2.length).toBeGreaterThanOrEqual(1);

    const nhuMang = (v: string | string[] | undefined): string[] =>
      v === undefined ? [] : Array.isArray(v) ? v : [v];

    function duongDanDaiDien(pRegex: string): string {
      const coNeoCuoi = pRegex.endsWith("$");
      let than = pRegex;
      if (than.startsWith("^")) than = than.slice(1);
      if (coNeoCuoi) than = than.slice(0, -1);
      const literal = unCi(than);
      expect("^" + ci(literal) + (coNeoCuoi ? "$" : "")).toBe(pRegex);
      return coNeoCuoi ? literal : literal + "zz-mau-dai-dien.ts";
    }

    function laDichHanChe(pDuongDan: string): boolean {
      return quyTacG2.some((r) => {
        const dsPath = nhuMang(r.to.path);
        if (dsPath.length === 0 || !dsPath.some((p) => new RegExp(p).test(pDuongDan))) return false;
        return !nhuMang(r.to.pathNot).some((p) => new RegExp(p).test(pDuongDan));
      });
    }

    const thieuDichHanChe: string[] = [];
    for (const quyTac of quyTacG2) {
      for (const mienTru of nhuMang(quyTac.from.pathNot)) {
        const daiDien = duongDanDaiDien(mienTru);
        if (!laDichHanChe(daiDien)) {
          thieuDichHanChe.push(`${quyTac.name} miễn trừ ${daiDien} nhưng không ai chặn đường vào`);
        }
      }
    }
    expect(thieuDichHanChe).toEqual([]);

    // Đối chứng âm: hàm laDichHanChe() phải biết trả false.
    expect(laDichHanChe("apps/mot-app-binh-thuong/src/index.ts")).toBe(false);
    // Đối chứng dương: đúng module nội bộ mà MỤC D sinh ra để canh.
    expect(laDichHanChe("packages/identity/src/rbac.ts")).toBe(true);
    // Và cửa công khai KHÔNG được là đích hạn chế.
    expect(laDichHanChe("packages/identity/src/index.ts")).toBe(false);
  });

  it("[INV-H11] cửa công khai của packages/identity/src đúng bằng index.ts", () => {
    // Canary cho chính sách tối giản, cùng khuôn với canary của crypto-keys: nới `to.pathNot`
    // để "cho qua" một module nữa là một quyết định phải được nhìn thấy.
    interface DepCruiseRule {
      name: string;
      to: { pathNot?: string | string[] };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const { ciFile } = require("../../dependency-cruiser-ci.cjs") as {
      ciFile: (s: string) => string;
    };
    const rule = config.forbidden.find((r) => r.name === "g2-identity-chi-index-la-cua-cong-khai");
    if (!rule) {
      throw new Error(
        "Không tìm thấy rule g2-identity-chi-index-la-cua-cong-khai trong .dependency-cruiser.cjs",
      );
    }
    expect(rule.to.pathNot).toEqual([ciFile("packages/identity/src/index.ts")]);
  });

  // ======================================================================================
  // TASK 9 (T9-A) — HỌ "g3-": packages/identity KHÔNG CÓ NĂNG LỰC MẬT MÃ
  //
  // Task 9 cần xác thực TOTP, mà xác thực TOTP đòi bí mật RÕ. Đường đi hiển nhiên là miễn trừ
  // packages/identity khỏi g1-...-unwrap-ts — đúng thứ QT2 cấm: nó biến một API server bị
  // chiếm thành một tiến trình GIẢI MÃ ĐƯỢC HỒ SƠ THẦU. Quy tắc g3- đi NGƯỢC LẠI (ghim thêm
  // một hàng rào thay vì nới hàng rào cũ), và bốn test dưới đây là lớp cưỡng chế của nó.
  // ======================================================================================

  it("[INV-H12] chặn packages/identity import mặt tiền BỌC của crypto-keys", () => {
    // Chặn cả đường BỌC — không chỉ đường MỞ — là toàn bộ nội dung của quy tắc: chính sự có
    // mặt của một cạnh identity -> crypto-keys là thứ biến việc nới G1 thành một dòng sửa nhỏ
    // trông vô hại. Probe dùng đường TƯƠNG ĐỐI để cạnh luôn resolve được bất kể package.json
    // của identity có khai dependency hay không.
    const probe = "packages/identity/src/zzprobe-mat-ma.ts";
    writeFileSync(
      probe,
      [
        'import { MasterKeyRing } from "../../crypto-keys/src/index.js";',
        "export { MasterKeyRing };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/identity", "packages/crypto-keys"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-mat-ma.ts");
      expect(output).toContain("g3-identity-khong-co-nang-luc-mat-ma");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H12] chặn packages/identity import đường MỞ khoá, và g1 vẫn bắn cùng lúc", () => {
    // Hai lớp phải cùng bắn ở đây, và điều đó phải được ĐO chứ không suy: nếu chỉ g3 bắn thì
    // gỡ g3 là đủ để mở đường; nếu chỉ g1 bắn thì g3 là trang trí trên đúng ca nguy hiểm nhất.
    const probe = "packages/identity/src/zzprobe-mo-khoa.ts";
    writeFileSync(
      probe,
      [
        'import type { KeyUnwrapper } from "../../crypto-keys/src/unwrap.js";',
        "export type Leaked = KeyUnwrapper;",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/identity", "packages/crypto-keys"]);
      expect(status).not.toBe(0);
      expect(output).toContain("g3-identity-khong-co-nang-luc-mat-ma");
      expect(output).toContain("g1-khong-giai-ma-ngoai-unseal-worker-unwrap-ts");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H12] gói KHÁC vẫn import được mặt tiền bọc — đối chứng dương, chống quy tắc chặn-tất-cả", () => {
    // Không có vế này, hai test trên xanh kể cả khi quy tắc chặn MỌI đường tới crypto-keys, và
    // bất biến thu được sẽ là "không ai bọc khoá được" chứ không phải thứ định canh. Cùng khuôn
    // đối chứng dương của [INV-H11] cho cửa index.ts.
    const probe = "packages/audit/src/zzprobe-boc-khoa.ts";
    writeFileSync(
      probe,
      [
        'import { MasterKeyRing } from "../../crypto-keys/src/index.js";',
        "export { MasterKeyRing };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/audit", "packages/crypto-keys"]);
      expect(output).not.toContain("g3-identity-khong-co-nang-luc-mat-ma");
      expect(status, `đường bọc khoá hợp lệ của một gói khác bị chặn:\n${output}`).toBe(0);
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H12] quy tắc g3- KHÔNG có miễn trừ nào, và đích của nó là CẢ gói crypto-keys", () => {
    // Canary cho chính sách, cùng khuôn hai canary của g1-/g2-. Ở họ g1-/g2- thứ nguy hiểm là
    // "miễn trừ một module khỏi vai trò `from` mà quên biến nó thành đích hạn chế"; ở đây thứ
    // nguy hiểm KHÁC HẲN và ngược chiều — một dòng `from.pathNot` hay một `to.pathNot` thêm vào
    // CHÍNH LÀ hành động nới hàng rào mà quy tắc này sinh ra để ngăn. Nên bất biến máy-đọc-được
    // là: họ g3- không được có bậc tự do nào.
    interface DepCruiseRule {
      name: string;
      from: { path?: string | string[]; pathNot?: string | string[] };
      to: { path?: string | string[]; pathNot?: string | string[] };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const { ciPrefix } = require("../../dependency-cruiser-ci.cjs") as {
      ciPrefix: (s: string) => string;
    };

    const quyTacG3 = config.forbidden.filter((r) => r.name.startsWith("g3-"));
    // Đối chứng dương: danh sách rỗng làm mọi khẳng định dưới thành trang trí.
    expect(quyTacG3.length).toBe(1);

    for (const quyTac of quyTacG3) {
      expect(
        quyTac.from.pathNot,
        `${quyTac.name} có miễn trừ — mỗi dòng miễn trừ ở họ g3- là một bước tới đúng kịch bản ` +
          "mà quy tắc này sinh ra để chặn (một API server giải mã được hồ sơ thầu).",
      ).toBeUndefined();
      expect(quyTac.to.pathNot, `${quyTac.name} mở một cửa vào crypto-keys`).toBeUndefined();
    }

    expect(quyTacG3[0]!.from.path).toBe(ciPrefix("packages/identity/src/"));
    // ĐÍCH là CẢ gói, không phải riêng thư mục src: một file crypto-keys nằm ngoài src (script,
    // cấu hình sinh mã) cũng không được là cây cầu.
    expect(quyTacG3[0]!.to.path).toBe(ciPrefix("packages/crypto-keys/"));
  });

  // ======================================================================================
  // TASK 10 vòng fix 1 (đặc tả IMPORTANT 1) — HỌ "g4-": packages/outbox CHỈ MỞ ĐÚNG index.ts
  //
  // LẦN THỨ BA cùng một lớp lỗ, và lần này nó được ĐO TRƯỚC khi bị khai thác. Phép đo của
  // reviewer đặc tả, tái lập được: một file `packages/audit/src/zz-probe-outbox-leak.ts` với
  // `import "../../outbox/src/runner.js"` đi lọt CẢ BA cổng — depcruise 0 vi phạm, `tsc` exit 0,
  // `eslint` exit 0 — trong khi bản bare specifier `@trustprocure/outbox/src/runner.js` bị chặn
  // ở CẢ HAI lớp. Danh sách trắng barrel khoá DANH SÁCH ở CỬA; nó không dựng BỨC TƯỜNG.
  // ======================================================================================

  it("[INV-H13] chặn import TƯƠNG ĐỐI xuyên gói vào packages/outbox/src/runner.ts", () => {
    // ĐÚNG probe mà reviewer đo được là im lặng ở cả ba lớp.
    const probe = "packages/audit/src/zzprobe-outbox-tuong-doi.ts";
    writeFileSync(
      probe,
      [
        'import { JobRunner } from "../../outbox/src/runner.js";',
        "export { JobRunner };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/audit", "packages/outbox"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-outbox-tuong-doi.ts");
      expect(output).toContain("g4-outbox-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H13] module MỚI thêm vào packages/outbox/src mặc định không với tới được từ ngoài", () => {
    // Tính chất mà `identity` có nhờ [INV-H11] và `outbox` KHÔNG có trước vòng fix này: một
    // module CHƯA TỒN TẠI cũng đã bị chặn, nên không ai phải nhớ thêm quy tắc khi viết file mới.
    const moduleMoi = "packages/outbox/src/zzprobe-module-moi.ts";
    writeFileSync(moduleMoi, "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-outbox-moi/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-outbox-moi/src/leak.ts",
      [
        'import { zplaceholder } from "../../../packages/outbox/src/zzprobe-module-moi.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-outbox-moi", "packages/outbox"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-module-moi");
      expect(output).toContain("g4-outbox-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(moduleMoi, { force: true });
      rmSync("apps/tmp-probe-outbox-moi", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H13] cửa index.ts VẪN đi qua được — đối chứng dương, chống quy tắc chặn-tất-cả", () => {
    // Không có vế này, hai test trên xanh kể cả khi quy tắc chặn LUÔN CẢ cửa hợp pháp, và bất
    // biến thu được sẽ là "không ai dùng được gói outbox".
    mkdirSync("apps/tmp-probe-outbox-cua/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-outbox-cua/src/dung.ts",
      [
        'import { enqueueJob } from "../../../packages/outbox/src/index.js";',
        "export { enqueueJob };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-outbox-cua", "packages/outbox"]);
      expect(output).not.toContain("g4-outbox-chi-index-la-cua-cong-khai");
      expect(status, `cửa hợp pháp bị chặn:\n${output}`).toBe(0);
    } finally {
      rmSync("apps/tmp-probe-outbox-cua", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H13] cửa công khai của packages/outbox/src đúng bằng index.ts", () => {
    // Canary cho chính sách tối giản, cùng khuôn với canary của crypto-keys và identity: nới
    // `to.pathNot` để "cho qua" một module nữa là một quyết định phải được NHÌN THẤY.
    interface DepCruiseRule {
      name: string;
      from: { pathNot?: string | string[] };
      to: { pathNot?: string | string[] };
    }
    const config = require("../../.dependency-cruiser.cjs") as { forbidden: DepCruiseRule[] };
    const { ciFile, ciPrefix } = require("../../dependency-cruiser-ci.cjs") as {
      ciFile: (s: string) => string;
      ciPrefix: (s: string) => string;
    };
    const hoG4 = config.forbidden.filter((r) => r.name.startsWith("g4-"));
    // Chống rỗng ruột: họ g4- phải TỒN TẠI. Nếu ai đó xoá quy tắc, ba test trên đỏ vì probe đi
    // lọt, còn test này đỏ vì danh sách rỗng — hai tín hiệu khác nhau cho hai cách hỏng.
    expect(hoG4.map((r) => r.name)).toEqual(["g4-outbox-chi-index-la-cua-cong-khai"]);
    expect(hoG4[0]!.to.pathNot).toEqual([ciFile("packages/outbox/src/index.ts")]);
    // VÀ: họ g4- KHÔNG có miễn trừ `from` nào ngoài chính thư mục được bảo vệ — bài học đã trả
    // giá bốn lần ở họ g1- (một module được miễn trừ vai trò `from` mà quên biến thành đích
    // hạn chế thì nó re-export được cả gói). Ở đây bất biến ấy được giữ bằng cách KHÔNG có bậc
    // tự do nào để quên.
    expect(hoG4[0]!.from.pathNot).toBe(ciPrefix("packages/outbox/src/"));
  });

  it("mã nguồn hiện tại không vi phạm quy tắc nào", () => {
    // Fix round 4 (I1): chạy qua chính script package.json thay vì danh sách target tự chọn,
    // để phạm vi kiểm luôn khớp phạm vi hàng rào thực sự bảo vệ trong CI.
    expect(depcruiseTheoScript().status).toBe(0);
  }, 120000);
});

// ==============================================================================================
// [INV-H15] BIÊN GIỚI MODULE CỦA packages/supplier — HỌ QUY TẮC `g5-`
//
// LẦN THỨ TƯ cùng một khuôn, và khác biệt đáng ghi: ba lần trước đều là VÁ XONG RỒI SỬA — lỗ
// được đo bằng một probe import tương đối xuyên gói đi lọt CẢ BA cổng (depcruise, tsc, eslint),
// rồi quy tắc mới mới được thêm. Lần này quy tắc ra đời CÙNG LÚC với gói.
//
// Hệ quả phải nói đúng mức: khoản nợ 17 ("bốn gói còn lại không có quy tắc biên giới") KHÔNG
// được đóng — `audit`, `db`, `tenancy`, `test-support` vẫn chưa có gì. Nó chỉ không lớn thêm.
//
// CỐ Ý KHÔNG có bản sao của test "[INV-H11] mọi module được miễn trừ vai trò `from` ... đều đồng
// thời là đích hạn chế" cho họ `g5-`: quy tắc này có ĐÚNG MỘT miễn trừ `from.pathNot`, và nó
// chính là thư mục đang được bảo vệ. Một test như vậy hôm nay sẽ XANH VÔ ĐIỀU KIỆN — tức là
// trang trí. Ngày họ `g5-` có miễn trừ thứ hai, test đó phải được viết CÙNG LÚC.
// ==============================================================================================
describe("biên giới module của packages/supplier", () => {
  it("[INV-H15] chặn import TƯƠNG ĐỐI xuyên gói vào packages/supplier/src", () => {
    const probe = "packages/audit/src/zzprobe-supplier-tuong-doi.ts";
    writeFileSync(
      probe,
      [
        'import { createSupplier } from "../../supplier/src/suppliers.js";',
        "export { createSupplier };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/audit", "packages/supplier"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-supplier-tuong-doi.ts");
      expect(output).toContain("g5-supplier-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H15] module MỚI thêm vào packages/supplier/src mặc định không với tới được từ ngoài", () => {
    const moduleMoi = "packages/supplier/src/zzprobe-module-moi.ts";
    writeFileSync(moduleMoi, "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-supplier-moi/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-supplier-moi/src/leak.ts",
      [
        'import { zplaceholder } from "../../../packages/supplier/src/zzprobe-module-moi.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-supplier-moi", "packages/supplier"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-module-moi");
      expect(output).toContain("g5-supplier-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(moduleMoi, { force: true });
      rmSync("apps/tmp-probe-supplier-moi", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H15] cửa index.ts VẪN đi qua được — đối chứng dương, chống quy tắc chặn-tất-cả", () => {
    mkdirSync("apps/tmp-probe-supplier-cua/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-supplier-cua/src/dung.ts",
      [
        'import { createSupplier } from "../../../packages/supplier/src/index.js";',
        "export { createSupplier };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-supplier-cua", "packages/supplier"]);
      expect(output).not.toContain("g5-supplier-chi-index-la-cua-cong-khai");
      expect(status, `cửa hợp pháp bị chặn:\n${output}`).toBe(0);
    } finally {
      rmSync("apps/tmp-probe-supplier-cua", { recursive: true, force: true });
    }
  }, 60000);
});

// ==============================================================================================
// [INV-H16] BIÊN GIỚI MODULE CỦA packages/rfq — HỌ QUY TẮC `g6-`
//
// Ba ca dưới đây là phần mà `tests/architecture/bien-gioi-goi.test.ts` KHÔNG mua được: lớp kia
// đòi quy tắc TỒN TẠI và có HÌNH DẠNG đúng, nó không chạy depcruise nên không chứng minh quy tắc
// CHẶN THẬT. Hai lớp bổ túc nhau, và cả hai là bắt buộc cho mỗi gói mới.
// ==============================================================================================
describe("biên giới module của packages/rfq", () => {
  it("[INV-H16] chặn import TƯƠNG ĐỐI xuyên gói vào packages/rfq/src", () => {
    const probe = "packages/audit/src/zzprobe-rfq-tuong-doi.ts";
    writeFileSync(
      probe,
      ['import { createRfq } from "../../rfq/src/rfq.js";', "export { createRfq };", ""].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/audit", "packages/rfq"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-rfq-tuong-doi.ts");
      expect(output).toContain("g6-rfq-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H16] module MỚI thêm vào packages/rfq/src mặc định không với tới được từ ngoài", () => {
    const moduleMoi = "packages/rfq/src/zzprobe-module-moi.ts";
    writeFileSync(moduleMoi, "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-rfq-moi/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-rfq-moi/src/leak.ts",
      [
        'import { zplaceholder } from "../../../packages/rfq/src/zzprobe-module-moi.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-rfq-moi", "packages/rfq"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-module-moi");
      expect(output).toContain("g6-rfq-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(moduleMoi, { force: true });
      rmSync("apps/tmp-probe-rfq-moi", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H16] cửa index.ts VẪN đi qua được — đối chứng dương", () => {
    mkdirSync("apps/tmp-probe-rfq-cua/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-rfq-cua/src/dung.ts",
      [
        'import { createRfq } from "../../../packages/rfq/src/index.js";',
        "export { createRfq };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-rfq-cua", "packages/rfq"]);
      expect(output).not.toContain("g6-rfq-chi-index-la-cua-cong-khai");
      expect(status, `cửa hợp pháp bị chặn:\n${output}`).toBe(0);
    } finally {
      rmSync("apps/tmp-probe-rfq-cua", { recursive: true, force: true });
    }
  }, 60000);
});

// ==============================================================================================
// [INV-H16] BIÊN GIỚI MODULE CỦA packages/invitation — HỌ QUY TẮC `g7-`
// ==============================================================================================
describe("biên giới module của packages/invitation", () => {
  it("[INV-H16] chặn import TƯƠNG ĐỐI xuyên gói vào packages/invitation/src", () => {
    const probe = "packages/audit/src/zzprobe-invitation-tuong-doi.ts";
    writeFileSync(
      probe,
      [
        'import { redeemMagicLink } from "../../invitation/src/invitation.js";',
        "export { redeemMagicLink };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["packages/audit", "packages/invitation"]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-invitation-tuong-doi.ts");
      expect(output).toContain("g7-invitation-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 60000);

  it("[INV-H16] module MỚI trong packages/invitation/src mặc định không với tới được từ ngoài", () => {
    const moduleMoi = "packages/invitation/src/zzprobe-module-moi.ts";
    writeFileSync(moduleMoi, "export const zplaceholder = 1;\n");
    mkdirSync("apps/tmp-probe-invitation-moi/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-invitation-moi/src/leak.ts",
      [
        'import { zplaceholder } from "../../../packages/invitation/src/zzprobe-module-moi.js";',
        "export { zplaceholder };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise([
        "apps/tmp-probe-invitation-moi",
        "packages/invitation",
      ]);
      expect(status).not.toBe(0);
      expect(output).toContain("zzprobe-module-moi");
      expect(output).toContain("g7-invitation-chi-index-la-cua-cong-khai");
    } finally {
      rmSync(moduleMoi, { force: true });
      rmSync("apps/tmp-probe-invitation-moi", { recursive: true, force: true });
    }
  }, 60000);

  it("[INV-H16] cửa index.ts VẪN đi qua được — đối chứng dương", () => {
    mkdirSync("apps/tmp-probe-invitation-cua/src", { recursive: true });
    writeFileSync(
      "apps/tmp-probe-invitation-cua/src/dung.ts",
      [
        'import { redeemMagicLink } from "../../../packages/invitation/src/index.js";',
        "export { redeemMagicLink };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise([
        "apps/tmp-probe-invitation-cua",
        "packages/invitation",
      ]);
      expect(output).not.toContain("g7-invitation-chi-index-la-cua-cong-khai");
      expect(status, `cửa hợp pháp bị chặn:\n${output}`).toBe(0);
    } finally {
      rmSync("apps/tmp-probe-invitation-cua", { recursive: true, force: true });
    }
  }, 60000);
});
