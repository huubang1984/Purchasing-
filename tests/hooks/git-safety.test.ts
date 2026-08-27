import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/git-safety.mjs", import.meta.url));

function runHook(payload: string): { status: number; stderr: string } {
  const proc = spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
  return { status: proc.status ?? -1, stderr: proc.stderr };
}

function bashPayload(command: string): string {
  return JSON.stringify({ tool_name: "Bash", tool_input: { command } });
}

const BLOCKED = [
  "git reset --hard HEAD~1",
  "git clean -fd",
  "git clean -xdf",
  "git push --force origin main",
  "git push -f origin main",
  "git push --force-with-lease origin main",
  "git checkout -- .",
  "git restore --staged .",
  "git branch -D feature/foo",
  "git filter-branch --tree-filter true HEAD",
  "git stash clear",
  "git stash drop",
  "git reflog expire --expire=now --all",
  "git update-ref -d refs/heads/main",
  "cd /tmp && git reset --hard",
];

const ALLOWED = [
  "git status",
  "git log --oneline",
  "git add -A",
  "git commit -m 'feat: something'",
  "git push origin feature/foo",
  "git reset HEAD~1",
  "npm run build",
];

describe("git-safety hook", () => {
  it.each(BLOCKED)("chặn: %s", (command) => {
    const { status, stderr } = runHook(bashPayload(command));
    expect(status).toBe(2);
    expect(stderr).toMatch(/git-safety/);
  });

  it.each(ALLOWED)("cho qua: %s", (command) => {
    expect(runHook(bashPayload(command)).status).toBe(0);
  });

  it("fail-closed khi JSON hỏng", () => {
    expect(runHook("{ khong-phai-json").status).toBe(2);
  });

  it("fail-closed khi stdin rỗng", () => {
    expect(runHook("").status).toBe(2);
  });

  it("fail-closed khi thiếu tool_input", () => {
    expect(runHook(JSON.stringify({ tool_name: "Bash" })).status).toBe(2);
  });

  it("fail-closed khi command không phải chuỗi", () => {
    expect(runHook(JSON.stringify({ tool_input: { command: 42 } })).status).toBe(2);
  });
});
