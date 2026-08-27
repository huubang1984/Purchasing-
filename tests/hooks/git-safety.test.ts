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

function chanDungMongDoi(command: string): void {
  const { status, stderr } = runHook(bashPayload(command));
  expect(status).toBe(2);
  expect(stderr).toMatch(/git-safety/);
}

function choQuaMongDoi(command: string): void {
  expect(runHook(bashPayload(command)).status).toBe(0);
}

const H1_RESET_HARD = ["git reset --hard HEAD~1", "cd /tmp && git reset --hard"];

const H2_CLEAN_FORCE = ["git clean -fd", "git clean -xdf", "git clean --force"];

const H3_DAY_EP_BUOC = [
  "git push --force origin main",
  "git push -f origin main",
  "git push --force-with-lease origin main",
  // Tổ hợp cờ ngắn gộp chung — Finding "cùng lớp lỗi" đã kiểm chứng: exit 0 trên bản cũ.
  "git push -uf origin main",
  "git push -fu origin main",
];

const H4_XOA_THAY_DOI_CUC_BO = ["git checkout -- .", "git restore --staged ."];

const H5_VIET_LAI_LICH_SU = [
  "git branch -D feature/foo",
  "git branch --delete --force feature/foo",
  "git filter-branch --tree-filter true HEAD",
  "git stash clear",
  "git stash drop",
  "git reflog expire --expire=now --all",
  "git update-ref -d refs/heads/main",
];

// Finding 1 (review sau Task 1): tuỳ chọn toàn cục của git (-C, -c, --no-pager, ...)
// chen giữa "git" và subcommand từng vô hiệu hoá TOÀN BỘ 10 quy tắc cùng lúc. Cờ bọc
// nháy đơn và nhóm tiền tố restore không đủ rộng là cùng một lớp lỗi (khớp theo vị trí
// liền kề trên chuỗi thô). Mọi case dưới đây đã kiểm chứng bằng thực nghiệm: exit 0
// trên hook trước fix, exit 2 sau fix (xem task-1-report.md, mục "Fix round 1").
const H6_TUY_CHON_TOAN_CUC_BYPASS = [
  "git -C . reset --hard HEAD~1",
  "git -c core.pager=cat reset --hard HEAD~1",
  "git --no-pager reset --hard HEAD~1",
  "git -C . -c user.name=x --no-pager reset --hard HEAD~1",
  "git reset '--hard' HEAD~1",
  "git restore --source=HEAD~3 -- .",
  // Biến thể đối kháng: "-c" đứng SAU subcommand phải KHÔNG bị bóc như tuỳ chọn toàn
  // cục (đó là nghĩa riêng của subcommand, vd "git commit -c <ref>") — nếu bóc nhầm,
  // "--hard" phía sau sẽ bị nuốt theo và quy tắc lại bị vô hiệu hoá kiểu mới.
  "git reset -c --hard HEAD~1",
];

const H7_CHO_QUA = [
  "git status",
  "git log --oneline",
  "git add -A",
  "git commit -m 'feat: something'",
  "git push origin feature/foo",
  "git reset HEAD~1",
  "npm run build",
  // Tuỳ chọn toàn cục của git dùng cho việc bình thường — không được cản trở.
  "git -C repo status",
  "git -c core.editor=vim commit -m 'msg'",
  "git --no-pager log --oneline",
  "git -C . push origin feature/foo",
  "git restore --staged package.json",
  "git branch -d merged-branch",
  // Regression cho phần bóc "-C <dir>": giá trị đi kèm -C không được lẫn vào đối số
  // thật của subcommand — nếu lẫn, "." (giá trị của -C) sẽ bị hiểu nhầm là target
  // của "restore .", chặn oan một lệnh hoàn toàn vô hại.
  "git -C . restore foo.txt",
];

describe("git-safety hook", () => {
  describe("[INV-H1] git reset --hard bị chặn với mã thoát 2", () => {
    it.each(H1_RESET_HARD)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H2] git clean -f* bị chặn", () => {
    it.each(H2_CLEAN_FORCE)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H3] đẩy ép buộc bị chặn, gồm cờ ngắn gộp", () => {
    it.each(H3_DAY_EP_BUOC)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H4] lệnh xoá bỏ thay đổi cục bộ bị chặn", () => {
    it.each(H4_XOA_THAY_DOI_CUC_BO)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H5] lệnh viết lại lịch sử bị chặn", () => {
    it.each(H5_VIET_LAI_LICH_SU)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H6] tuỳ chọn toàn cục của git không được vô hiệu hoá quy tắc nào", () => {
    it.each(H6_TUY_CHON_TOAN_CUC_BYPASS)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H7] lệnh git vô hại được cho qua", () => {
    it.each(H7_CHO_QUA)("cho qua: %s", choQuaMongDoi);
  });

  describe("[INV-H10] fail-closed", () => {
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
});
