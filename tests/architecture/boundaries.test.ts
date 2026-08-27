import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker-unwrap-ts");
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts");
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts");
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker-unwrap-ts");
    } finally {
      rmSync(path, { force: true });
    }
  }, 60000);

  it("[INV-G1] chặn file .mjs import sai hoa-thường vào local-dev-shared.ts", () => {
    // Fix round 2 (N1): Windows/macOS resolve file KHÔNG phân biệt hoa thường, nhưng regex
    // của quy tắc từng phân biệt hoa thường — "Local-Dev-Shared.ts" (sai hoa/thường) resolve
    // thành công (trường "resolved" của depcruise giữ nguyên hoa/thường viết trong specifier)
    // nhưng không khớp regex, nên lọt qua. File .mjs (không phải .ts) được chọn cố ý vì nó
    // cũng vô hình với tsc (tsconfig chỉ include **/*.ts) và với eslint trước khi thu hẹp
    // ignore — kết hợp cả ba lỗ cùng lúc, đúng như phát hiện gốc của reviewer.
    const dir = "apps/tmp-probe-case/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.mjs`,
      [
        'import { deriveOrgKey } from "../../../packages/crypto-keys/src/Local-Dev-Shared.ts";',
        "export { deriveOrgKey };",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe-case"]);
      expect(status).not.toBe(0);
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts");
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
      (r) => r.name === "khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts",
    );
    if (!rule) {
      throw new Error(
        "Không tìm thấy rule khong-giai-ma-ngoai-unseal-worker-local-dev-unwrapper-ts trong .dependency-cruiser.cjs",
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
      expect(output).toContain("khong-import-nguoc-tu-apps-unseal-worker");
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
      expect(output).toContain("khong-import-nguoc-tu-bench-keyprovider");
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
      expect(output).toContain("khong-import-nguoc-tu-roundtrip-test");
    } finally {
      rmSync("apps/tmp-probe-roundtrip-bridge", { recursive: true, force: true });
    }
  }, 60000);

  it("mã nguồn hiện tại không vi phạm quy tắc nào", () => {
    expect(depcruise(["packages", "apps", "tools", "tests"]).status).toBe(0);
  }, 60000);
});
