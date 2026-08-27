#!/usr/bin/env node
// PreToolUse hook: chặn Edit/Write vào file bí mật hoặc thông tin xác thực.
// Khớp theo phần mở rộng và tên file thay vì khớp chuỗi con, để tránh chặn nhầm
// (ví dụ "monkey.ts" từng bị bộ pattern chuỗi con của bản .sh cũ đe dọa chặn).
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN.

import { basename, extname } from "node:path";

const SECRET_EXTS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk", ".asc", ".gpg"]);

const SECRET_BASENAMES = new Set([
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
  "credentials.json", "secrets.yml", "secrets.yaml",
  ".npmrc", ".pgpass", ".netrc", ".htpasswd",
]);

const SECRET_FRAGMENTS = [
  "/.aws/credentials",
  "/.ssh/",
  "/.gnupg/",
  "/.claude/settings.json",
  "/.claude/settings.local.json",
];

const ENV_ALLOWED = new Set([".env.example", ".env.sample", ".env.template"]);

function chan(lyDo) {
  process.stderr.write(`protect-secrets: ${lyDo}\n`);
  process.exit(2);
}

function laFileBiMat(rawPath) {
  const p = rawPath.replaceAll("\\", "/");
  const base = basename(p);

  if (base === ".env" || (base.startsWith(".env.") && !ENV_ALLOWED.has(base))) return true;
  if (SECRET_BASENAMES.has(base)) return true;
  if (SECRET_EXTS.has(extname(base).toLowerCase())) return true;
  if (SECRET_FRAGMENTS.some((fragment) => p.includes(fragment))) return true;

  return false;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("error", () => chan("không đọc được stdin — chặn theo nguyên tắc fail-closed."));
process.stdin.on("end", () => {
  let filePath;
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path;
  } catch {
    chan("payload hook không phải JSON hợp lệ — chặn theo nguyên tắc fail-closed.");
  }

  if (typeof filePath !== "string" || filePath.length === 0) {
    chan("không tìm thấy tool_input.file_path dạng chuỗi — chặn theo nguyên tắc fail-closed.");
  }

  if (laFileBiMat(filePath)) {
    chan(
      `${filePath} là file bí mật hoặc thông tin xác thực — hãy tự sửa thủ công ` +
        `(xem CLAUDE.md, Roles > Security Reviewer).`,
    );
  }

  process.exit(0);
});
