import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/protect-secrets.mjs", import.meta.url));

function runHook(payload: string): { status: number; stderr: string } {
  const proc = spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
  return { status: proc.status ?? -1, stderr: proc.stderr };
}

function writePayload(filePath: string): string {
  return JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } });
}

const BLOCKED = [
  "D:/Claude/TrustProcure/.env",
  "D:/Claude/TrustProcure/.env.local",
  "D:/Claude/TrustProcure/.env.production",
  "D:\\Claude\\TrustProcure\\.env",
  "/home/u/app/server.pem",
  "/home/u/app/private.key",
  "/home/u/certs/bundle.p12",
  "/home/u/certs/bundle.pfx",
  "/home/u/certs/store.jks",
  "/home/u/certs/store.keystore",
  "/home/u/.ssh/id_rsa",
  "/home/u/.ssh/id_ed25519",
  "/home/u/.aws/credentials",
  "/home/u/app/credentials.json",
  "/home/u/app/secrets.yml",
  "/home/u/app/secrets.yaml",
  "/home/u/.npmrc",
  "/home/u/.pgpass",
  "/home/u/.netrc",
  "/home/u/.claude/settings.json",
  "/home/u/.claude/settings.local.json",
];

const ALLOWED = [
  "D:/Claude/TrustProcure/src/index.ts",
  "D:/Claude/TrustProcure/.env.example",
  "D:/Claude/TrustProcure/.env.sample",
  "D:/Claude/TrustProcure/.env.template",
  "D:/Claude/TrustProcure/docs/STATE.md",
  "D:/Claude/TrustProcure/packages/identity/src/monkey.ts",
  "D:/Claude/TrustProcure/db/migrations/001_roles.sql",
];

describe("protect-secrets hook", () => {
  it.each(BLOCKED)("chặn: %s", (filePath) => {
    const { status, stderr } = runHook(writePayload(filePath));
    expect(status).toBe(2);
    expect(stderr).toMatch(/protect-secrets/);
  });

  it.each(ALLOWED)("cho qua: %s", (filePath) => {
    expect(runHook(writePayload(filePath)).status).toBe(0);
  });

  it("fail-closed khi JSON hỏng", () => {
    expect(runHook("{ hong").status).toBe(2);
  });

  it("fail-closed khi thiếu file_path", () => {
    expect(runHook(JSON.stringify({ tool_name: "Write", tool_input: {} })).status).toBe(2);
  });

  it("fail-closed khi file_path không phải chuỗi", () => {
    expect(runHook(JSON.stringify({ tool_input: { file_path: null } })).status).toBe(2);
  });
});
