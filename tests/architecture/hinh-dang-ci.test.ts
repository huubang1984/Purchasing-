// ==============================================================================================
// [khoản nợ 20 + 27] HÌNH DẠNG CỦA `ci.yml` LÀ MỘT BẢO ĐẢM — NÊN NÓ PHẢI CÓ MỘT MỐC CHẾT
//
// Hai khoản nợ khác nhau nhưng cùng một chỗ ở, và cùng một cách hỏng: chúng được đóng bằng cách
// SỬA MỘT TỆP CẤU HÌNH, và một tệp cấu hình không có lớp nào canh thì lặng lẽ quay về hình dạng
// cũ ở lần dọn dẹp kế tiếp. Hai khẳng định dưới đây là mốc chết của hai lần sửa ấy.
//
//   ⑴ [khoản nợ 20] T1+T2 phải chạy trên NHIỀU HƠN MỘT hệ điều hành. Gỡ `windows-latest` đi là
//     quay lại đúng trạng thái mà một bảo đảm chỉ đúng trên Linux không ai bắt được.
//
//   ⑵ [khoản nợ 27] Bước audit phụ thuộc — thứ DUY NHẤT trong `t0` gọi ra ngoài mạng — không được
//     nằm chung job với bốn cổng tĩnh. Gộp lại là để một lần `ERR_SOCKET_TIMEOUT` tới
//     `registry.npmjs.org` che mất kết quả của `tsc`, `eslint`, `depcruise` và `gitleaks`, đúng
//     như đã xảy ra hai lần ngày 2026-09-04.
//
// Đọc `ci.yml` bằng regex chứ không bằng một bộ phân tích YAML: dự án không có phụ thuộc YAML
// nào, và thêm một cái chỉ để đọc bốn dòng là đổi phạm vi phụ thuộc để mua sự tiện. Cái giá phải
// trả được nói ra: phép đọc này bám vào CÁCH VIẾT, nên một lần định dạng lại `ci.yml` có thể làm
// nó đỏ. Đỏ vì cách viết đổi thì sửa hai dòng ở đây; đỏ vì `windows-latest` biến mất thì đó đúng
// là việc nó sinh ra để làm.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Chuẩn hoá xuống dòng TRƯỚC khi đo. `.gitattributes` cố ý chỉ ghim `*.sql` và
// `evidence/INV-matrix.md` (khoản nợ 10), nên một checkout MỚI trên Windows với
// `core.autocrlf=true` cho `ci.yml` dạng CRLF — và `\n  t0:\n` không còn khớp. Đã xảy ra thật:
// run 33978573210, job windows-latest đỏ cả ba khẳng định với "không tìm thấy job", trong khi
// máy phát triển (worktree có sẵn file LF) xanh. Bảo đảm này nói về HÌNH DẠNG của ci.yml, không
// về byte xuống dòng của nó — nên phép đo phải mù với byte ấy.
const CI = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)),
  "utf8",
).replace(/\r\n/gu, "\n");

/** Thân của một job, từ dòng khai tên job tới job kế tiếp cùng mức thụt đầu dòng. */
function thanJob(ten: string): string {
  const batDau = CI.indexOf(`\n  ${ten}:\n`);
  expect(batDau, `không tìm thấy job "${ten}" trong ci.yml`).toBeGreaterThan(-1);
  const sau = CI.slice(batDau + 1);
  const ketThuc = sau.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/u);
  return ketThuc === -1 ? sau : sau.slice(0, ketThuc);
}

describe("[khoản nợ 20 + 27] hình dạng của ci.yml", () => {
  it("[khoản nợ 20] job T1+T2 chạy trên NHIỀU HƠN MỘT hệ điều hành", () => {
    const than = thanJob("t1-t2");
    const cacOs = [...than.matchAll(/\b(ubuntu-latest|windows-latest|macos-latest)\b/gu)].map(
      (m) => m[1],
    );
    const rieng = [...new Set(cacOs)].sort();
    expect(
      rieng.length,
      "T1+T2 lại chỉ chạy trên một hệ điều hành. Một bảo đảm chỉ đúng trên hệ đó thì không lớp " +
        "nào bắt được — đúng khoản nợ 20.",
    ).toBeGreaterThan(1);
    expect(rieng).toContain("ubuntu-latest");
    expect(rieng).toContain("windows-latest");
  });

  it("[khoản nợ 27] bước audit KHÔNG nằm chung job với các cổng tĩnh", () => {
    const t0 = thanJob("t0");
    expect(
      t0,
      "`pnpm audit` quay lại job t0. Nó là bước DUY NHẤT ở đó gọi ra ngoài mạng, nên một lần " +
        "gián đoạn của registry sẽ lại che mất kết quả của tsc/eslint/depcruise/gitleaks.",
    ).not.toMatch(/pnpm audit/u);

    // Và nó phải còn TỒN TẠI ở đâu đó, ở dạng CỔNG CHẶN. Tách ra không được biến thành gỡ bỏ:
    // `continue-on-error` trên chính bước chặn là fail-open và im lặng.
    const audit = thanJob("t0b-audit");
    expect(audit).toMatch(/pnpm audit --prod --audit-level high/u);
    const dongChan = audit
      .split(/\r?\n/)
      .findIndex((d) => d.includes("pnpm audit --prod --audit-level high"));
    const sauDongChan = audit.split(/\r?\n/).slice(dongChan + 1, dongChan + 3).join("\n");
    expect(sauDongChan, "cổng chặn không được đeo continue-on-error").not.toMatch(
      /continue-on-error:\s*true/u,
    );
  });

  it("bốn cổng tĩnh vẫn còn nguyên trong t0", () => {
    // Chống rỗng ruột cho khẳng định trên: "t0 không chứa pnpm audit" cũng đúng nếu ai đó xoá
    // sạch job t0.
    const t0 = thanJob("t0");
    // [S1.145 / khoản 115] gitleaks rời t0 sang job riêng `t0c-bi-mat` — khẳng định nó còn tồn tại
    // nằm ở khối dưới, không ở đây.
    for (const buoc of ["pnpm typecheck", "pnpm lint", "pnpm depcruise"]) {
      expect(t0, `cổng tĩnh "${buoc}" biến mất khỏi t0`).toContain(buoc);
    }
  });
});

// ==============================================================================================
// [S1.145 / khoản 115] QUYỀN CỦA `ci.yml` — BÀI HỌC KHOẢN NỢ 67 ÁP CHO WORKFLOW CHẠY TRÊN MỌI PR
//
//   ⑶ quyền mặc định của workflow là `contents: read` — khai TƯỜNG MINH, không lấy theo thiết lập
//     kho (`default_workflow_permissions`), thứ đổi được mà không một dòng nào của tệp này đổi;
//   ⑷ mọi `actions/checkout` mang `persist-credentials: false`;
//   ⑸ một job có `run:` hay cài phụ thuộc thì KHÔNG chạm `secrets.` hay `github.token` — bí mật chỉ
//     sống trong job không chạy mã của cây phụ thuộc;
//   ⑹ job quét bí mật tồn tại, không cài đặt, không `run:`, và quyền chỉ đọc.
// Cùng cách đọc regex như trên; dòng chú thích nguyên dòng bị bỏ trước khi đo để một câu giải
// thích nhắc tên `secrets.GITHUB_TOKEN` không làm đỏ (hay làm xanh) phép đo.
// ==============================================================================================

/** Dòng có nghĩa: bỏ dòng trống và dòng chú thích nguyên dòng. */
const coNghia = (van: string): string[] =>
  van.split("\n").filter((d) => d.trim() !== "" && !d.trimStart().startsWith("#"));

/** Tên mọi job dưới `jobs:` (mức thụt hai dấu cách). */
function tenCacJob(): string[] {
  const dong = coNghia(CI);
  return dong
    .slice(dong.indexOf("jobs:") + 1)
    .filter((d) => /^ {2}[a-z0-9][a-z0-9-]*:$/u.test(d))
    .map((d) => d.trim().slice(0, -1));
}

describe("[S1.145 / khoản 115] quyền và bí mật của ci.yml", () => {
  const dong = coNghia(CI);

  it("⑶ mức workflow khai đúng `permissions: contents: read`, trước `jobs:`", () => {
    const i = dong.indexOf("permissions:");
    expect(i, "ci.yml không khai `permissions` ở mức workflow").toBeGreaterThan(-1);
    expect(i).toBeLessThan(dong.indexOf("jobs:"));
    // Khối con: mọi dòng thụt sâu hơn ngay sau `permissions:`.
    const khoi: string[] = [];
    for (const d of dong.slice(i + 1)) {
      if (!/^\s/u.test(d)) break;
      khoi.push(d.trim());
    }
    expect(khoi, "quyền mức workflow phải đúng MỘT dòng `contents: read`").toEqual(["contents: read"]);
  });

  it("⑶ không job nào xin quyền GHI", () => {
    const ghi = dong.filter((d) => /^\s+[a-z-]+:\s*write\s*$/u.test(d) || /write-all/u.test(d));
    expect(ghi).toEqual([]);
  });

  it("⑷ mọi `actions/checkout` mang `persist-credentials: false`", () => {
    let soCheckout = 0;
    for (const ten of tenCacJob()) {
      const than = coNghia(thanJob(ten));
      than.forEach((d, i) => {
        if (!/uses:\s*actions\/checkout@/u.test(d)) return;
        soCheckout += 1;
        const thut = d.search(/\S/u);
        // Các dòng của CÙNG bước: thụt sâu hơn dấu `-` của bước.
        const cuaBuoc: string[] = [];
        for (const sau of than.slice(i + 1)) {
          if (sau.search(/\S/u) <= thut) break;
          cuaBuoc.push(sau.trim());
        }
        expect(cuaBuoc, `checkout trong job "${ten}" giữ credential`).toContain(
          "persist-credentials: false",
        );
      });
    }
    // Chống rỗng ruột: sáu job, mỗi job một checkout.
    expect(soCheckout).toBe(tenCacJob().length);
  });

  it("⑸ job có `run:` hoặc cài phụ thuộc không chạm `secrets.` / `github.token`", () => {
    const coBiMat: string[] = [];
    for (const ten of tenCacJob()) {
      const than = coNghia(thanJob(ten)).join("\n");
      const chayMa = /^\s+(?:- )?run:/mu.test(than) || /pnpm\/action-setup|actions\/setup-node/u.test(than);
      const chamBiMat = /\bsecrets\.|\bgithub\.token\b/u.test(than);
      if (chamBiMat) coBiMat.push(ten);
      expect(
        chayMa && chamBiMat,
        `job "${ten}" vừa chạy mã (run:/cài phụ thuộc) vừa cầm bí mật — script vòng đời của cây ` +
          "phụ thuộc chạy cùng máy, cùng tài khoản với bước nhận bí mật (khoản 115).",
      ).toBe(false);
    }
    // Chống rỗng ruột: bí mật duy nhất hôm nay là token của gitleaks, và nó nằm đúng ở t0c-bi-mat.
    expect(coBiMat).toEqual(["t0c-bi-mat"]);
  });

  it("⑹ job quét bí mật tồn tại, không cài đặt, không `run:`, quyền chỉ đọc", () => {
    const than = thanJob("t0c-bi-mat");
    expect(than).toMatch(/name: T0c — quet bi mat/u);
    expect(than).toMatch(/uses: gitleaks\/gitleaks-action@v2/u);
    expect(than).toMatch(/fetch-depth: 0/u);
    const coNghiaThan = coNghia(than).join("\n");
    expect(coNghiaThan).not.toMatch(/pnpm|setup-node|actions\/cache/u);
    expect(coNghiaThan).not.toMatch(/^\s+(?:- )?run:/mu);
    // Chỉ hai bước: checkout rồi gitleaks.
    const buoc = coNghia(than).filter((d) => /^\s+- /u.test(d));
    expect(buoc.map((d) => d.trim().replace(/@.*/u, ""))).toEqual([
      "- uses: actions/checkout",
      "- name: Quet bi mat",
    ]);
    const dongThan = coNghia(than);
    const i = dongThan.findIndex((d) => d.trim() === "permissions:");
    expect(i, "t0c-bi-mat phải khai quyền ở mức job").toBeGreaterThan(-1);
    const thutQuyen = dongThan[i]?.search(/\S/u) ?? 0;
    const quyen: string[] = [];
    for (const d of dongThan.slice(i + 1)) {
      if (d.search(/\S/u) <= thutQuyen) break;
      quyen.push(d.trim());
    }
    expect(quyen).toEqual(["contents: read", "pull-requests: read"]);
  });

  it("tên job T0 không đổi — kiểm tra nhánh bám vào tên", () => {
    expect(thanJob("t0")).toMatch(/name: T0 — cổng tĩnh\n/u);
  });
});
