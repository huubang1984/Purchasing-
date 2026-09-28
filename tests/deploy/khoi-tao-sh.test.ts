// ==============================================================================================
// [S1.9103 / ADR-111] `deploy/trien-khai.sh` — HAI LỆNH CỦA WORKFLOW KHỞI TẠO, ĐO BẰNG `aws` GIẢ
//
//   ⑴ `kiem-khoi-tao` (job `build`, không quyền AWS): không cần biến AWS, không gọi `aws`, in bảng người duyệt duyệt.
//   ⑵ Luật đầu vào của script là luật của `docThamSo` — cùng một bộ đầu vào, hai phía nhận/từ chối như nhau. Người duyệt
//      duyệt bảng của script; task chạy theo `docThamSo`; hai luật trôi xa nhau là duyệt một đằng, chạy một nẻo.
//   ⑶ `khoi-tao`: lệnh của task mang ĐÚNG sáu đầu vào đã duyệt; thứ tự run → chờ → đọc mã thoát → XOÁ bí mật → đọc log;
//      xoá bằng `--force-delete-without-recovery` và chỉ khi task thoát 0.
//   ⑷ Task hỏng ⇒ không xoá, dặn bí mật CÒN; xoá hỏng ⇒ thoát 1 và nói giao dịch đã commit; đầu vào sai ⇒ không gọi `aws`.
//   ⑸ Chỉ dòng log khớp TRỌN mẫu kết quả được chép sang tóm tắt của run.
// Script chạy trên runner Linux của GitHub, nên test chạy bash thật; Windows không có môi trường ấy — bỏ qua ở đó.
// ==============================================================================================
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { docThamSo } from "../../tools/khoi-tao-to-chuc/src/index.js";

const SCRIPT = fileURLToPath(new URL("../../deploy/trien-khai.sh", import.meta.url));
const PB = "0f1e2d3c-4b5a-4968-8776-655443322110";
const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TASK = "arn:aws:ecs:ap-southeast-1:942091277863:task/tp-prod/0123456789abcdef0123456789abcdef";

const thuMuc = mkdtempSync(join(tmpdir(), "khoi-tao-sh-"));
afterAll(() => { rmSync(thuMuc, { recursive: true, force: true }); });

// `aws` giả: ghi mỗi lời gọi thành một mảng JSON, trả lời theo biến AWS_GIA_* của ca test.
const AWS_GIA = `#!/usr/bin/env bash
printf '%s\\0' "$@" | jq -Rsc 'split("\\u0000")[:-1]' >> "$AWS_GIA_GOI"
case "$1 $2" in
  "ecs run-task") echo '{"task":"${TASK}","loi":0}' ;;
  "ecs wait") exit 0 ;;
  "ecs describe-tasks") printf '{"ma": %s, "ly_do": "Essential container in task exited"}\\n' "\${AWS_GIA_MA:-0}" ;;
  "secretsmanager delete-secret")
    if [ "\${AWS_GIA_XOA_HONG:-}" = 1 ]; then echo "An error occurred (AccessDeniedException)" >&2; exit 254; fi
    echo "tp/khoi-tao/ban-khai/x" ;;
  "logs filter-log-events") printf '%s\\n' "\${AWS_GIA_LOG:-[]}" ;;
  *) echo "aws gia: lenh la $*" >&2; exit 99 ;;
esac
`;
const binGia = join(thuMuc, "bin");
spawnSync("mkdir", ["-p", binGia]);
writeFileSync(join(binGia, "aws"), AWS_GIA);
chmodSync(join(binGia, "aws"), 0o755);

interface DauVao { CHE_DO: string; BI_MAT: string; PHIEN_BAN: string; TO_CHUC: string; SO_NGUOI: string; SO_VAI: string }
const TOT: DauVao = { CHE_DO: "tao", BI_MAT: "tp/khoi-tao/ban-khai/thep-viet", PHIEN_BAN: PB, TO_CHUC: "thep-viet", SO_NGUOI: "3", SO_VAI: "4" };
const AWS_ENV = { AWS_REGION: "ap-southeast-1", TAI_KHOAN: "942091277863", CLUSTER: "tp-prod", SUBNETS: "subnet-0a1b,subnet-2c3d", SG_KHOI_TAO: "sg-0abc123" };

let dem = 0;
function chay(lenh: string[], env: Record<string, string>): { status: number | null; stdout: string; stderr: string; goi: string[][] } {
  dem += 1;
  const goi = join(thuMuc, `goi-${String(dem)}.jsonl`);
  writeFileSync(goi, "");
  const r = spawnSync("bash", [SCRIPT, ...lenh], {
    encoding: "utf8",
    env: { PATH: `${binGia}${delimiter}${process.env["PATH"] ?? ""}`, AWS_GIA_GOI: goi, SO_LAN_DOC_LOG: "2", CHO_DOC_LOG_GIAY: "0", ...env },
    timeout: 30_000,
  });
  const dong = readFileSync(goi, "utf8").split("\n").filter((d) => d !== "");
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, goi: dong.map((d) => JSON.parse(d) as string[]) };
}

const tsNhan = (d: DauVao): boolean => {
  try {
    docThamSo([d.CHE_DO, "--ban-khai-secret", d.BI_MAT, "--phien-ban", d.PHIEN_BAN, "--to-chuc", d.TO_CHUC, "--so-nguoi", d.SO_NGUOI, "--so-vai", d.SO_VAI]);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === "win32")("[S1.9103] trien-khai.sh — kiem-khoi-tao và khoi-tao", () => {
  it("⑴ kiem-khoi-tao: không biến AWS, không gọi aws; in bảng sáu dòng đã duyệt", () => {
    const r = chay(["kiem-khoi-tao"], { ...TOT });
    expect(r.status, r.stderr).toBe(0);
    expect(r.goi).toEqual([]);
    for (const dong of ["| Chế độ | `tao` |", "| Bí mật bản khai | `tp/khoi-tao/ban-khai/thep-viet` |", `| Phiên bản (VersionId) | \`${PB}\` |`,
      "| Tổ chức (slug của tổ chức MỚI) | `thep-viet` |", "| Số người | 3 |", "| Tổng số vai (cặp người–vai) | 4 |"]) {
      expect(r.stdout).toContain(dong);
    }
    const them = chay(["kiem-khoi-tao"], { ...TOT, CHE_DO: "them-nguoi", TO_CHUC: ORG });
    expect(them.stdout).toContain(`| Tổ chức (mã tổ chức ĐÃ CÓ) | \`${ORG}\` |`);
    expect(chay(["kiem-khoi-tao", "thua"], { ...TOT }).status).toBe(1);
  });

  it("⑵ luật đầu vào của script = luật của docThamSo, trên cùng một bộ đầu vào", () => {
    const ca: Partial<DauVao>[] = [
      {}, { CHE_DO: "them-nguoi", TO_CHUC: ORG }, { CHE_DO: "xoa" }, { CHE_DO: "" },
      { BI_MAT: "tp/khoi-tao/ban-khai/" }, { BI_MAT: "tp/khoi-tao/database-url" }, { BI_MAT: "tp/khoi-tao/ban-khai/a b" },
      { BI_MAT: "tp/khoi-tao/ban-khai/$(id)" }, { BI_MAT: "tp/khoi-tao/ban-khai/a/b_c+d=e.f@g-h" }, { BI_MAT: "tp/khoi-tao/ban-khai/á" },
      { BI_MAT: "tp/khoi-tao/ban-khai/x\ny" },
      { PHIEN_BAN: "a".repeat(31) }, { PHIEN_BAN: "a".repeat(32) }, { PHIEN_BAN: "a".repeat(64) }, { PHIEN_BAN: "a".repeat(65) },
      { PHIEN_BAN: `${"a".repeat(31)}_` }, { PHIEN_BAN: `-${"a".repeat(31)}` }, { PHIEN_BAN: `--${"a".repeat(30)}` },
      { PHIEN_BAN: PB.toUpperCase() }, { PHIEN_BAN: `${PB}\n` },
      { TO_CHUC: "ab" }, { TO_CHUC: "abc" }, { TO_CHUC: "a".repeat(63) }, { TO_CHUC: "a".repeat(64) }, { TO_CHUC: "Thep-Viet" },
      { TO_CHUC: "thep_viet" }, { TO_CHUC: "-thep" }, { TO_CHUC: "thep-" }, { TO_CHUC: ORG }, { TO_CHUC: "thep viet" },
      { TO_CHUC: "--thep" }, { TO_CHUC: "thep-viet\nx" },
      { CHE_DO: "them-nguoi", TO_CHUC: "thep-viet" }, { CHE_DO: "them-nguoi", TO_CHUC: ORG.toUpperCase() },
      { CHE_DO: "them-nguoi", TO_CHUC: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }, { CHE_DO: "them-nguoi", TO_CHUC: "3f2504e0-4f89-41d3-ca0c-0305e82c3301" },
      { SO_NGUOI: "0" }, { SO_NGUOI: "1", SO_VAI: "1" }, { SO_NGUOI: "50", SO_VAI: "300" }, { SO_NGUOI: "51", SO_VAI: "60" },
      { SO_NGUOI: "01" }, { SO_NGUOI: "1.0" }, { SO_NGUOI: "" }, { SO_NGUOI: " 3" }, { SO_NGUOI: "3 " }, { SO_NGUOI: "+3" },
      { SO_NGUOI: "٣" }, { SO_NGUOI: "3\n" }, { SO_NGUOI: "9999999999999999999999" },
      { SO_VAI: "2" }, { SO_VAI: "3" }, { SO_VAI: "18" }, { SO_VAI: "19" }, { SO_VAI: "04" }, { SO_VAI: "4e0" }, { SO_VAI: "" },
    ];
    const lech: string[] = [];
    let nhan = 0;
    for (const c of ca) {
      const d = { ...TOT, ...c };
      const sh = chay(["kiem-khoi-tao"], { ...d });
      expect(sh.goi).toEqual([]);
      if ((sh.status === 0) !== tsNhan(d)) lech.push(`${JSON.stringify(c)}: script ${String(sh.status)}, docThamSo ${String(tsNhan(d))}`);
      if (sh.status === 0) nhan += 1;
    }
    expect(lech).toEqual([]);
    // Bộ ca phải có cả hai phía — một bộ toàn từ chối thì phép so rỗng nghĩa.
    expect(nhan).toBeGreaterThanOrEqual(10);
    expect(ca.length - nhan).toBeGreaterThanOrEqual(30);
  });

  it("⑶ khoi-tao thành công: lệnh mang đúng sáu đầu vào; run → chờ → mã thoát → xoá (không khôi phục) → log; in dòng kết quả", () => {
    const ketQua = `[khoi-tao] tao: to chuc ${ORG}, 3 nguoi, 4 vai, ban khai phien ban ${PB}`;
    const r = chay(["khoi-tao", "arn:aws:ecs:ap-southeast-1:942091277863:task-definition/tp-khoi-tao:7"], {
      ...TOT, ...AWS_ENV, AWS_GIA_LOG: JSON.stringify(["[khoi-tao] dong khac", ketQua]),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual([
      "ecs run-task", "ecs wait", "ecs describe-tasks", "secretsmanager delete-secret", "logs filter-log-events",
    ]);
    const run = r.goi[0]!;
    const overrides = JSON.parse(run[run.indexOf("--overrides") + 1]!) as unknown;
    expect(overrides).toEqual({ containerOverrides: [{ name: "tp-khoi-tao", command: [
      "tao", "--ban-khai-secret", TOT.BI_MAT, "--phien-ban", PB, "--to-chuc", "thep-viet", "--so-nguoi", "3", "--so-vai", "4"] }] });
    expect(run).toContain("tp-prod");
    expect(run).toContain("awsvpcConfiguration={subnets=[subnet-0a1b,subnet-2c3d],securityGroups=[sg-0abc123],assignPublicIp=DISABLED}");
    expect(r.goi[3]).toEqual(["secretsmanager", "delete-secret", "--secret-id", TOT.BI_MAT, "--force-delete-without-recovery", "--query", "Name", "--output", "text"]);
    expect(r.goi[4]).toContain("tp-khoi-tao/tp-khoi-tao/0123456789abcdef0123456789abcdef");
    expect(r.goi[4]).toContain("/tp/khoi-tao");
    expect(r.stdout).toContain(`- Dòng kết quả: \`${ketQua}\``);
    expect(r.stdout).toContain(`- Bí mật \`${TOT.BI_MAT}\`: đã xoá, không cửa sổ khôi phục`);
    expect(r.stdout).toContain("/login#<mã tổ chức ở dòng trên>");
    expect(r.stdout).not.toContain("dong khac");
  });

  it("⑷ task thoát ≠ 0 (hay không có mã): KHÔNG xoá, không đọc log; dặn bí mật CÒN và lệnh xoá tay", () => {
    for (const ma of ["1", "null"]) {
      const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, AWS_GIA_MA: ma });
      expect(r.status).toBe(1);
      expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual(["ecs run-task", "ecs wait", "ecs describe-tasks"]);
      expect(r.stderr).toContain(`LOI: khoi-tao thoát mã ${ma}`);
      expect(r.stderr).toContain(`Bí mật ${TOT.BI_MAT} CÒN`);
      expect(r.stderr).toContain(`aws secretsmanager delete-secret --secret-id ${TOT.BI_MAT} --force-delete-without-recovery`);
    }
  });

  it("⑷ xoá hỏng sau khi task thoát 0: thoát 1, nói giao dịch ĐÃ commit; không đọc log", () => {
    const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, AWS_GIA_XOA_HONG: "1" });
    expect(r.status).toBe(1);
    expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual(["ecs run-task", "ecs wait", "ecs describe-tasks", "secretsmanager delete-secret"]);
    expect(r.stderr).toContain(`LOI: xoá bí mật ${TOT.BI_MAT} hỏng`);
    expect(r.stderr).toContain("Task đã thoát 0 (giao dịch đã commit) nhưng XOÁ bí mật hỏng");
  });

  it("⑷ đầu vào sai ở job chay (giá trị đổi giữa hai job, hay tiêm lệnh) ⇒ dừng TRƯỚC mọi lời gọi aws", () => {
    for (const c of [{ TO_CHUC: "$(id)" }, { SO_VAI: "1; rm -rf /" }, { BI_MAT: "tp/khoi-tao/database-url" }, { PHIEN_BAN: "khong" }]) {
      const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, ...c });
      expect(r.status, JSON.stringify(c)).toBe(1);
      expect(r.goi).toEqual([]);
    }
    expect(chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, SG_KHOI_TAO: "" }).goi).toEqual([]);
  });

  it("⑸ chỉ dòng khớp TRỌN mẫu kết quả được chép; không có ⇒ nói không đọc được, vẫn thoát 0 (bí mật đã xoá)", () => {
    const la = [
      `[khoi-tao] tao: to chuc ${ORG}, 3 nguoi, 4 vai, ban khai phien ban ${PB} [bam vao day](https://ke-gian.example)`,
      `x[khoi-tao] tao: to chuc ${ORG}, 3 nguoi, 4 vai, ban khai phien ban ${PB}`,
      "[khoi-tao] HONG: loi gi do",
    ];
    const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, AWS_GIA_LOG: JSON.stringify(la) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.goi.filter((g) => g[0] === "logs")).toHaveLength(2);
    expect(r.stdout).toContain("- Không đọc được dòng kết quả sau 2 lần — đọc log `/tp/khoi-tao`, luồng `tp-khoi-tao/tp-khoi-tao/0123456789abcdef0123456789abcdef`.");
    expect(r.stdout).not.toContain("ke-gian");
    expect(r.stdout).toContain("đã xoá");
  });
});
