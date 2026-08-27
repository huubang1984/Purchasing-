#!/usr/bin/env node
// PreToolUse hook: chặn lệnh git phá hủy.
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN, không cho qua.
// Bài học từ sự cố jq (spec §8.1): biện pháp kiểm soát thất bại phải thất bại theo hướng an toàn.

const DESTRUCTIVE = [
  { re: /\bgit\s+reset\s+--hard\b/, ten: "git reset --hard" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, ten: "git clean -f" },
  { re: /\bgit\s+push\b[^|;&]*\s(-f|--force)\b/, ten: "git push --force" },
  { re: /\bgit\s+checkout\s+--\s/, ten: "git checkout -- <path>" },
  { re: /\bgit\s+restore\s+(--staged\s+|--worktree\s+)*\.(\s|$)/, ten: "git restore ." },
  { re: /\bgit\s+branch\s+-D\b/, ten: "git branch -D" },
  { re: /\bgit\s+filter-branch\b/, ten: "git filter-branch" },
  { re: /\bgit\s+stash\s+(clear|drop)\b/, ten: "git stash clear/drop" },
  { re: /\bgit\s+reflog\s+expire\b/, ten: "git reflog expire" },
  { re: /\bgit\s+update-ref\s+-d\b/, ten: "git update-ref -d" },
];

function chan(lyDo) {
  process.stderr.write(`git-safety: ${lyDo}\n`);
  process.exit(2);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("error", () => chan("không đọc được stdin — chặn theo nguyên tắc fail-closed."));
process.stdin.on("end", () => {
  let command;
  try {
    const payload = JSON.parse(raw);
    command = payload?.tool_input?.command;
  } catch {
    chan("payload hook không phải JSON hợp lệ — chặn theo nguyên tắc fail-closed.");
  }

  if (typeof command !== "string") {
    chan("không tìm thấy tool_input.command dạng chuỗi — chặn theo nguyên tắc fail-closed.");
  }

  const hit = DESTRUCTIVE.find((entry) => entry.re.test(command));
  if (hit) {
    chan(
      `chặn lệnh git phá hủy (${hit.ten}). Nếu thực sự cần, hãy tự chạy thủ công ` +
        `— xem CLAUDE.md, Core Engineering Rules > Git safety.`,
    );
  }

  process.exit(0);
});
