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

const CI = readFileSync(fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)), "utf8");

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
    for (const buoc of ["pnpm typecheck", "pnpm lint", "pnpm depcruise", "gitleaks-action"]) {
      expect(t0, `cổng tĩnh "${buoc}" biến mất khỏi t0`).toContain(buoc);
    }
  });
});
