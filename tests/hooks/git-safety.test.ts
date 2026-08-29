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

// Finding 1 (review sau Task 1, round 1): tuỳ chọn toàn cục của git (-C, -c,
// --no-pager, ...) chen giữa "git" và subcommand từng vô hiệu hoá TOÀN BỘ 10 quy tắc
// cùng lúc. Cờ bọc nháy đơn và nhóm tiền tố restore không đủ rộng là cùng một lớp lỗi
// (khớp theo vị trí liền kề trên chuỗi thô). Mọi case dưới đây đã kiểm chứng bằng thực
// nghiệm: exit 0 trên hook trước fix, exit 2 sau fix (xem task-1-report.md, "Fix round 1").
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

// Finding round 2: bản vá round 1 (giữ ranh giới lời gọi bằng toán tử shell rồi bóc
// tuỳ chọn toàn cục) bị bắn nhầm bởi cú pháp nhân bản mô tả tệp — ký tự "&" trần trong
// "2>&1"/"&>"/">&2" bị hiểu nhầm là toán tử chạy nền, cắt đứt việc thu thập token của
// lời gọi git giữa chừng. Đã kiểm chứng bằng thực nghiệm trên chính hook round 1
// (commit 71066b6): "git 2>&1 reset --hard HEAD~1" và "git &>/dev/null reset --hard
// HEAD~1" exit 0 sai — chuyển hướng đặt TRƯỚC các token phá huỷ mới bắn nhầm; đặt sau
// vẫn bị chặn đúng (giữ lại 3 case đó để làm regression, chứng minh không hồi quy dù
// hook đã đổi hẳn thiết kế ở round 2). Xem task-1-report.md, "Fix round 2".
const H6_CHUYEN_HUONG_BYPASS = [
  "git 2>&1 reset --hard HEAD~1",
  "git &>/dev/null reset --hard HEAD~1",
  "git >&2 clean -fd",
  // Ba case này vốn đã đúng ngay ở round 1 (chuyển hướng đặt SAU token phá huỷ) — giữ
  // lại làm regression cho round 2, chứng minh thiết kế mới không làm hỏng cái đang đúng.
  "git reset --hard HEAD~1 2>&1",
  "git push --force origin main 2>&1",
  "git reset --hard HEAD~1 >&2",
];

// Round 2, kiểm tra thêm ngoài yêu cầu tối thiểu (heredoc, ";;", nháy ghép liền không
// khoảng trắng) — coordinator nêu đây là những thứ "có thể mở lỗ khác" nếu còn cố mô
// hình hoá ngữ pháp shell. Thiết kế thiên về chặn (dò token bất kỳ đâu, không phân
// biệt toán tử) miễn nhiễm với cả ba theo cấu trúc, không cần biết riêng từng cú pháp.
const H6_CU_PHAP_SHELL_KHAC = [
  "cat <<'EOF'\ngit reset --hard\nEOF",
  "case $x in a) git reset --hard HEAD~1 ;; esac",
  // Nháy đơn ghép liền nhau không khoảng trắng nối lại thành --hard.
  "git reset --h'a'r'd' HEAD~1",
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
  // -C dùng với thư mục KHÔNG trùng "." — không đụng đánh đổi đã biết ở dưới.
  "git -C repo restore foo.txt",
  // Round 2: chuyển hướng thông thường không được cản trở việc bình thường.
  "git status 2>&1",
  "git log --oneline 2>&1",
  "npm run build 2>&1",
];

// Round 2 (fix H6): đổi thiết kế thiên về chặn — dò tín hiệu phá huỷ trên TOÀN BỘ
// token của dòng lệnh, không còn xác định "token nào thuộc lời gọi git nào" hay "đâu
// là subcommand". Đánh đổi CHỦ ĐỘNG chấp nhận, không phải bug: hai lệnh dưới đây vốn vô
// hại nhưng giờ bị chặn, vì lý do nêu ở từng dòng. Xem task-1-report.md, "Fix round 2",
// mục "Đánh đổi đã biết" để có lý giải đầy đủ vì sao được chấp nhận thay vì sửa tiếp.
const H6_DANH_DOI_DA_BIET = [
  // Giá trị "." của "-C" (nghĩa là "chạy như đang ở thư mục hiện tại" — vốn là no-op,
  // luôn có thể bỏ hẳn "-C .") trùng với dấu hiệu "restore ." dù không liên quan.
  "git -C . restore foo.txt",
  // Hai lời gọi git tách biệt trong một chuỗi lệnh ghép: tín hiệu "checkout" ở lời gọi
  // đầu và "--" ở lời gọi sau (không liên quan tới checkout) cộng lại thành dương tính
  // giả. Có thể tách thành hai lệnh Bash riêng nếu Claude Code bị chặn nhầm kiểu này.
  "git checkout main && git log -- file.txt",
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

  describe("[INV-H6] chuyển hướng (2>&1, &>, >&2) không được vô hiệu hoá quy tắc nào", () => {
    it.each(H6_CHUYEN_HUONG_BYPASS)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H6] cú pháp shell khác (heredoc, ;;, nháy ghép liền) không vô hiệu hoá quy tắc", () => {
    it.each(H6_CU_PHAP_SHELL_KHAC)("chặn: %s", chanDungMongDoi);
  });

  describe("[INV-H7] lệnh git vô hại được cho qua", () => {
    it.each(H7_CHO_QUA)("cho qua: %s", choQuaMongDoi);

    it("cho qua: git commit -m với message nhắc tới \"git reset --hard\" trong nháy kép", () => {
      choQuaMongDoi('git commit -m "note: dont run git reset --hard"');
    });
  });

  describe("[INV-H6] đánh đổi đã biết của thiết kế thiên về chặn — CHẶN chủ đích, không phải bug", () => {
    it.each(H6_DANH_DOI_DA_BIET)("chặn (đánh đổi chấp nhận được): %s", chanDungMongDoi);
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
