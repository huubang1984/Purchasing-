#!/usr/bin/env node
// PreToolUse hook: chặn lệnh git phá hủy.
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN, không cho qua.
// Bài học từ sự cố jq (spec §8.1): biện pháp kiểm soát thất bại phải thất bại theo hướng an toàn.
//
// Fix round 1 (review sau Task 1 — [INV-H6]): bản đầu neo pattern theo \bgit\s+<subcommand>,
// tức đòi subcommand đứng ngay sau "git" trên chuỗi thô. Bốn lớp bypass đã kiểm chứng
// bằng thực nghiệm:
//   1) tuỳ chọn toàn cục của git chen vào giữa — "git -C . reset --hard" — vô hiệu hoá
//      TOÀN BỘ 10 quy tắc cùng lúc, không riêng một quy tắc.
//   2) cờ bị bọc trong dấu nháy đơn — "git reset '--hard' HEAD~1".
//   3) tổ hợp cờ ngắn gộp chung — "git push -uf origin main".
//   4) nhóm tiền tố cờ không đủ rộng — "git restore --source=<rev> -- .".
// Sửa bằng cách tokenize dòng lệnh theo ngữ nghĩa shell tối giản (tách theo && || ; |
// và xuống dòng làm ranh giới lời gọi; bóc dấu nháy đơn/kép), rồi với MỖI lời gọi
// "git ...": bóc các tuỳ chọn toàn cục đứng TRƯỚC subcommand (chỉ -C/-c cần bóc kèm
// giá trị đi theo — các cờ toàn cục khác như --no-pager, --bare không ăn thêm token
// nên không cần liệt kê hết), xác định subcommand, rồi tìm token liên quan bất kỳ đâu
// trong phần đối số còn lại — không còn đòi vị trí liền kề với "git" hay với nhau.
//
// Giới hạn đã biết (ngoài phạm vi các bypass đã kiểm chứng ở vòng review này): không
// phát hiện lệnh git phá hủy giấu trong command substitution, ví dụ
// `git commit -m "$(git reset --hard)"` hay dùng backtick. Ghi nhận trong task-1-report.md.

// --- Tokenizer shell tối giản: đủ dùng để phát hiện bypass, không phải shell đầy đủ. ---
const KY_TU_TOAN_TU_DON = new Set(["&", "|", ";", "\n"]);

function tachTokenDongLenh(cmd) {
  const tokens = [];
  let i = 0;
  const n = cmd.length;
  let dang = "";
  let coDang = false;

  const day = () => {
    if (coDang) {
      tokens.push({ loai: "tu", giaTri: dang });
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

    if (c === "&" && cmd[i + 1] === "&") {
      day();
      tokens.push({ loai: "toan_tu", giaTri: "&&" });
      i += 2;
      continue;
    }
    if (c === "|" && cmd[i + 1] === "|") {
      day();
      tokens.push({ loai: "toan_tu", giaTri: "||" });
      i += 2;
      continue;
    }
    if (KY_TU_TOAN_TU_DON.has(c)) {
      day();
      tokens.push({ loai: "toan_tu", giaTri: c });
      i++;
      continue;
    }

    coDang = true;
    dang += c;
    i++;
  }
  day();
  return tokens;
}

// Với mỗi token "git" đứng riêng, lấy các token kiểu "tu" theo sau cho tới token
// "toan_tu" tiếp theo (hoặc hết chuỗi) — đó là toàn bộ đối số của MỘT lời gọi git.
function layCacDoanGoiGit(tokens) {
  const doans = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].loai === "tu" && tokens[i].giaTri === "git") {
      const doan = [];
      let j = i + 1;
      while (j < tokens.length && tokens[j].loai === "tu") {
        doan.push(tokens[j].giaTri);
        j++;
      }
      doans.push(doan);
    }
  }
  return doans;
}

// Bóc tuỳ chọn toàn cục đứng TRƯỚC subcommand. -C và -c ăn thêm một token giá trị
// (vd "-C <dir>", "-c <key>=<value>") nên phải bóc cả hai; các cờ toàn cục khác
// (--no-pager, --bare, --paginate, ...) không ăn thêm token nên chỉ cần bóc một.
// Dừng ngay khi gặp token đầu tiên KHÔNG bắt đầu bằng "-" — đó là subcommand, và mọi
// thứ từ đó trở đi giữ nguyên (kể cả cờ "-c" mang nghĩa riêng của subcommand, như
// "git commit -c <ref>", không bị bóc nhầm vì vòng lặp đã dừng trước khi tới đó).
function boTuyChonToanCucGit(doan) {
  let i = 0;
  while (i < doan.length && doan[i].startsWith("-")) {
    if ((doan[i] === "-C" || doan[i] === "-c") && i + 1 < doan.length) {
      i += 2;
    } else {
      i += 1;
    }
  }
  return doan.slice(i);
}

function coToken(phan, tok) {
  return phan.includes(tok);
}

function coTokenBatDauBang(phan, tienTo) {
  return phan.some((t) => t.startsWith(tienTo));
}

// Tổ hợp cờ ngắn gộp chung kiểu "-uf", "-fd", "-xdf": một dấu gạch ngang, nhiều chữ
// cái, gộp lại vẫn có nghĩa như từng cờ đứng riêng (chuẩn getopt mà git dùng).
function coFlagNganGomChu(phan, chuCai) {
  return phan.some((t) => /^-[a-zA-Z]+$/.test(t) && t.includes(chuCai));
}

const RULES = [
  {
    ten: "git reset --hard",
    khop: (phanConLai) => phanConLai[0] === "reset" && coToken(phanConLai, "--hard"),
  },
  {
    ten: "git clean -f",
    khop: (phanConLai) =>
      phanConLai[0] === "clean" &&
      (coToken(phanConLai, "--force") || coFlagNganGomChu(phanConLai, "f")),
  },
  {
    ten: "git push --force",
    khop: (phanConLai) =>
      phanConLai[0] === "push" &&
      (coToken(phanConLai, "--force") ||
        coTokenBatDauBang(phanConLai, "--force") ||
        coFlagNganGomChu(phanConLai, "f")),
  },
  {
    ten: "git checkout -- <path>",
    khop: (phanConLai) => {
      if (phanConLai[0] !== "checkout") return false;
      const idx = phanConLai.indexOf("--");
      return idx !== -1 && idx < phanConLai.length - 1;
    },
  },
  {
    ten: "git restore .",
    khop: (phanConLai) => phanConLai[0] === "restore" && coToken(phanConLai, "."),
  },
  {
    ten: "git branch -D",
    khop: (phanConLai) =>
      phanConLai[0] === "branch" &&
      (coToken(phanConLai, "-D") ||
        (coToken(phanConLai, "--delete") && coToken(phanConLai, "--force"))),
  },
  {
    ten: "git filter-branch",
    khop: (phanConLai) => phanConLai[0] === "filter-branch",
  },
  {
    ten: "git stash clear/drop",
    khop: (phanConLai) =>
      phanConLai[0] === "stash" && (coToken(phanConLai, "clear") || coToken(phanConLai, "drop")),
  },
  {
    ten: "git reflog expire",
    khop: (phanConLai) => phanConLai[0] === "reflog" && coToken(phanConLai, "expire"),
  },
  {
    ten: "git update-ref -d",
    khop: (phanConLai) => phanConLai[0] === "update-ref" && coToken(phanConLai, "-d"),
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

  const doans = layCacDoanGoiGit(tachTokenDongLenh(command));
  for (const doan of doans) {
    const phanConLai = boTuyChonToanCucGit(doan);
    const hit = RULES.find((rule) => rule.khop(phanConLai));
    if (hit) {
      chan(
        `chặn lệnh git phá hủy (${hit.ten}). Nếu thực sự cần, hãy tự chạy thủ công ` +
          `— xem CLAUDE.md, Core Engineering Rules > Git safety.`,
      );
    }
  }

  process.exit(0);
});
