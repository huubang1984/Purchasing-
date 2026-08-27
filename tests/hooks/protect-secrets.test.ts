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

function chanDungMongDoi(filePath: string): void {
  const { status, stderr } = runHook(writePayload(filePath));
  expect(status).toBe(2);
  expect(stderr).toMatch(/protect-secrets/);
}

function choQuaMongDoi(filePath: string): void {
  expect(runHook(writePayload(filePath)).status).toBe(0);
}

const H8_FILE_BI_MAT = [
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
  // Finding 2 (review sau Task 1): so khớp trước đây phân biệt hoa thường, nên các
  // biến thể dưới đây lọt qua trên hệ thống tệp không phân biệt hoa thường của
  // Windows dù đụng đúng file bí mật thật. Hai case đầu đã kiểm chứng bằng thực
  // nghiệm: exit 0 trên hook trước fix, exit 2 sau fix.
  "C:/x/.ENV",
  "C:/x/ID_RSA",
  "C:/x/Credentials.json",
  "C:/x/SECRETS.YML",
  "C:/x/.NPMRC",
  "D:/Claude/TrustProcure/Server.PEM",
  "/home/u/.SSH/ID_ED25519",
  "D:\\Claude\\TrustProcure\\.Env.Local",
];

const H9_CHO_QUA = [
  "D:/Claude/TrustProcure/src/index.ts",
  "D:/Claude/TrustProcure/.env.example",
  "D:/Claude/TrustProcure/.env.sample",
  "D:/Claude/TrustProcure/.env.template",
  "D:/Claude/TrustProcure/docs/STATE.md",
  "D:/Claude/TrustProcure/packages/identity/src/monkey.ts",
  "D:/Claude/TrustProcure/db/migrations/001_roles.sql",
  // Regression cho fix không phân biệt hoa thường: biến thể viết hoa của placeholder
  // được phép (.env.example) vẫn phải được cho qua, không bị chặn oan.
  "D:/Claude/TrustProcure/.ENV.EXAMPLE",
];

describe("protect-secrets hook", () => {
  describe("[INV-H8] ghi vào file bí mật bị chặn, không phân biệt hoa thường", () => {
    it.each(H8_FILE_BI_MAT)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H9] file nguồn thường và .env.example được cho qua", () => {
    it.each(H9_CHO_QUA)("cho qua: %s", choQuaMongDoi);
  });

  describe("[INV-H10] fail-closed", () => {
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
});
