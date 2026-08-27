import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker");
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker");
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker");
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
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker");
    } finally {
      rmSync(path, { force: true });
    }
  }, 60000);

  it("mã nguồn hiện tại không vi phạm quy tắc nào", () => {
    expect(depcruise(["packages", "apps", "tools", "tests"]).status).toBe(0);
  }, 60000);
});
