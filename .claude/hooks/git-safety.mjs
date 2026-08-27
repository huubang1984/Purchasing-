#!/usr/bin/env node
// PreToolUse hook: chặn lệnh git phá hủy.
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN, không cho qua.
// Bài học từ sự cố jq (spec §8.1): biện pháp kiểm soát thất bại phải thất bại theo hướng an toàn.
//
// Fix round 2 (review sau round 1 — [INV-H6]): round 1 tokenize dòng lệnh rồi tách
// thành TỪNG lời gọi git theo ranh giới toán tử shell (&&, ||, ;, |, &, xuống dòng),
// sau đó bóc tuỳ chọn toàn cục (-C/-c) đứng trước subcommand. Thiết kế đó bắn nhầm vào
// cú pháp nhân bản mô tả tệp kiểu N>&M: ký tự "&" trần trong "2>&1" bị tokenizer coi là
// toán tử chạy nền, cắt đứt việc thu thập token của lời gọi git ngay giữa chừng — vd
// "git 2>&1 reset --hard HEAD~1" bị tách thành hai mảnh, "reset --hard" không bao giờ
// được gắn lại vào lời gọi git nào, không quy tắc nào nhìn thấy nó → exit 0 sai.
//
// Sau hai vòng vá liên tiếp (Finding 1 vòng review đầu, rồi đúng bug tương tự ở vòng
// này) mô hình hoá chính xác ngữ pháp shell (toán tử nào là ranh giới, cờ nào ăn thêm
// token) đã chứng minh là một trò chơi vá lỗ liên tục — sửa bốn lỗ vòng 1, mở lỗ thứ
// năm. Đổi hẳn triết lý: bỏ việc xác định "token nào thuộc lời gọi git nào" và "đâu là
// subcommand", chỉ hỏi câu dễ trả lời hơn — dòng lệnh này có chứa đồng thời các dấu
// hiệu của MỘT thao tác git phá huỷ hay không, bất kể chúng nằm ở đâu, thuộc lời gọi
// nào, hay bị chuyển hướng/toán tử gì xen vào. Token hoá tối giản (chỉ tách theo
// khoảng trắng, bóc dấu nháy đơn/kép) — không còn khái niệm "toán tử" hay "ranh giới
// lời gọi" nữa, nên không còn gì để tách nhầm.
//
// Đánh đổi CHỦ ĐỘNG chấp nhận (thiên về chặn, đúng bản chất một hàng rào an toàn: chặn
// nhầm mất mười giây, cho qua sai mất việc — xem "Đánh đổi đã biết" trong
// task-1-report.md, mục Fix round 2, để biết danh sách đầy đủ và lý do từng cái):
//   - "git -C . restore foo.txt" bị chặn oan: giá trị "." của -C trùng với dấu hiệu
//     "restore ." dù không liên quan. -C . vốn là no-op (mặc định đã là thư mục hiện
//     tại), tổ hợp này hiếm và luôn có thể thay bằng bỏ hẳn "-C .".
//   - Hai lời gọi git tách biệt trong cùng một chuỗi lệnh ghép (vd "git checkout main
//     && git log -- file") có thể bị chặn nếu tín hiệu của một quy tắc nằm rải ở lời
//     gọi này còn tín hiệu khác nằm ở lời gọi kia — chấp nhận được vì Claude Code có
//     thể tách thành hai lệnh Bash riêng nếu bị chặn nhầm.
// Không phát hiện lệnh phá hủy giấu trong command substitution (`$(...)`, backtick) —
// giới hạn đã ghi nhận từ round 1, vẫn ngoài phạm vi các vòng review đã có tới nay.

function tachTuDongLenh(cmd) {
  const tuList = [];
  let i = 0;
  const n = cmd.length;
  let dang = "";
  let coDang = false;

  const day = () => {
    if (coDang) {
      tuList.push(dang);
      dang = "";
      coDang = false;
    }
  };

  while (i < n) {
    const c = cmd[i];

    if (c === "'") {
      coDang = true;
      i++;
      while (i < n && cmd[i] !== "'") {
        dang += cmd[i];
        i++;
      }
      i++;
      continue;
    }

    if (c === '"') {
      coDang = true;
      i++;
      while (i < n && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < n && '"\\$`'.includes(cmd[i + 1])) {
          dang += cmd[i + 1];
          i += 2;
        } else {
          dang += cmd[i];
          i++;
        }
      }
      i++;
      continue;
    }

    if (c === "\\" && i + 1 < n) {
      coDang = true;
      dang += cmd[i + 1];
      i += 2;
      continue;
    }

    if (/\s/.test(c)) {
      day();
      i++;
      continue;
    }

    // Không còn phân loại "toán tử" — mọi ký tự khác (kể cả &, |, ;, >, <) cứ gộp vào
    // từ hiện tại. Nhờ vậy "2>&1", "&>", ">&2" luôn là MỘT token duy nhất, vô hại,
    // không còn khả năng bị hiểu nhầm thành ranh giới cắt đứt lời gọi git.
    coDang = true;
    dang += c;
    i++;
  }
  day();
  return tuList;
}

function coTu(danhSachTu, tu) {
  return danhSachTu.includes(tu);
}

function coTuBatDauBang(danhSachTu, tienTo) {
  return danhSachTu.some((t) => t.startsWith(tienTo));
}

// Tổ hợp cờ ngắn gộp chung kiểu "-uf", "-fd", "-xdf": một dấu gạch ngang, nhiều chữ
// cái, gộp lại vẫn có nghĩa như từng cờ đứng riêng (chuẩn getopt mà git dùng).
function coFlagNganGomChu(danhSachTu, chuCai) {
  return danhSachTu.some((t) => /^-[a-zA-Z]+$/.test(t) && t.includes(chuCai));
}

const RULES = [
  {
    ten: "git reset --hard",
    khop: (t) => coTu(t, "git") && coTu(t, "reset") && coTu(t, "--hard"),
  },
  {
    ten: "git clean -f",
    khop: (t) => coTu(t, "git") && coTu(t, "clean") && (coTu(t, "--force") || coFlagNganGomChu(t, "f")),
  },
  {
    ten: "git push --force",
    khop: (t) =>
      coTu(t, "git") &&
      coTu(t, "push") &&
      (coTu(t, "--force") || coTuBatDauBang(t, "--force") || coFlagNganGomChu(t, "f")),
  },
  {
    ten: "git checkout -- <path>",
    khop: (t) => coTu(t, "git") && coTu(t, "checkout") && coTu(t, "--"),
  },
  {
    ten: "git restore .",
    khop: (t) => coTu(t, "git") && coTu(t, "restore") && coTu(t, "."),
  },
  {
    ten: "git branch -D",
    khop: (t) =>
      coTu(t, "git") &&
      coTu(t, "branch") &&
      (coTu(t, "-D") || (coTu(t, "--delete") && coTu(t, "--force"))),
  },
  {
    ten: "git filter-branch",
    khop: (t) => coTu(t, "git") && coTu(t, "filter-branch"),
  },
  {
    ten: "git stash clear/drop",
    khop: (t) => coTu(t, "git") && coTu(t, "stash") && (coTu(t, "clear") || coTu(t, "drop")),
  },
  {
    ten: "git reflog expire",
    khop: (t) => coTu(t, "git") && coTu(t, "reflog") && coTu(t, "expire"),
  },
  {
    ten: "git update-ref -d",
    khop: (t) => coTu(t, "git") && coTu(t, "update-ref") && coTu(t, "-d"),
  },
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

  const danhSachTu = tachTuDongLenh(command);
  const hit = RULES.find((rule) => rule.khop(danhSachTu));
  if (hit) {
    chan(
      `chặn lệnh git phá hủy (${hit.ten}). Nếu thực sự cần, hãy tự chạy thủ công ` +
        `— xem CLAUDE.md, Core Engineering Rules > Git safety.`,
    );
  }

  process.exit(0);
});
