#!/usr/bin/env node
// PreToolUse hook: chặn Edit/Write vào file bí mật hoặc thông tin xác thực.
// Khớp theo phần mở rộng và tên file thay vì khớp chuỗi con, để tránh chặn nhầm
// (ví dụ "monkey.ts" từng bị bộ pattern chuỗi con của bản .sh cũ đe dọa chặn).
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN.
//
// Fix round 1 (review sau Task 1, Finding 2 — [INV-H8]): so khớp basename/fragment
// trước đây phân biệt hoa thường, nên ".ENV" hay "ID_RSA" lọt qua trên hệ thống tệp
// không phân biệt hoa thường của Windows (và macOS mặc định) dù đụng đúng file thật
// ".env" / "id_rsa". Hạ chữ thường TOÀN BỘ trước khi so khớp — kể cả phần đường dẫn
// dùng cho SECRET_FRAGMENTS — không chỉ phần đuôi mở rộng như bản trước.

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
  const pThuong = p.toLowerCase();
  const base = basename(p);
  const baseThuong = base.toLowerCase();

  if (baseThuong === ".env" || (baseThuong.startsWith(".env.") && !ENV_ALLOWED.has(baseThuong))) return true;
  if (SECRET_BASENAMES.has(baseThuong)) return true;
  if (SECRET_EXTS.has(extname(base).toLowerCase())) return true;
  if (SECRET_FRAGMENTS.some((fragment) => pThuong.includes(fragment))) return true;

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
