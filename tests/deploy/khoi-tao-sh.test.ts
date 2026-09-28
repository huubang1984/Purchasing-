// ==============================================================================================
// [S1.9103 / ADR-111] `deploy/trien-khai.sh` — HAI LỆNH CỦA WORKFLOW KHỞI TẠO, ĐO BẰNG `aws` GIẢ
//
//   ⑴ `kiem-khoi-tao` (job `build`, không quyền AWS): không cần biến AWS, không gọi `aws`, in bảng người duyệt duyệt; người
//      bấm là bot thì dừng.
//   ⑵ Luật đầu vào của script là luật của `docThamSo` — cùng một bộ đầu vào, hai phía nhận/từ chối như nhau. Người duyệt
//      duyệt bảng của script; task chạy theo `docThamSo`; hai luật trôi xa nhau là duyệt một đằng, chạy một nẻo.
//   ⑶ `khoi-tao`: lệnh của task mang ĐÚNG các đầu vào đã duyệt; thứ tự run → chờ → đọc mã thoát → XOÁ bí mật; xoá bằng
//      `--force-delete-without-recovery` và chỉ khi task thoát 0; ~~đọc log~~ **[lượt soi]** kết quả suy từ đầu vào, KHÔNG đọc log.
//   ⑷ Task hỏng ⇒ không xoá, dặn bí mật CÒN; xoá hỏng ⇒ thoát 1 và nói giao dịch đã commit; đầu vào sai ⇒ không gọi `aws`.
//   ⑸ ~~Chỉ dòng log khớp TRỌN mẫu kết quả được chép sang tóm tắt của run.~~ **[lượt soi]** `kiem-nguoi-duyet`: lịch sử duyệt
//      của run phải có một NGƯỜI khác người bấm duyệt `prod-khoi-tao`.
//   ⑹ **[lượt soi]** `dang-ky tp-khoi-tao`: bản mới nhất bị cài biến, secret, lệnh hay root fs ghi được thì không nhân bản.
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
  "ecs describe-task-definition") printf '%s\\n' "\${AWS_GIA_TD}" ;;
  "ecs register-task-definition") echo "arn:aws:ecs:ap-southeast-1:942091277863:task-definition/tp-khoi-tao:8" ;;
  "secretsmanager delete-secret")
    if [ "\${AWS_GIA_XOA_HONG:-}" = 1 ]; then echo "An error occurred (AccessDeniedException)" >&2; exit 254; fi
    echo "tp/khoi-tao/ban-khai/x" ;;
  *) echo "aws gia: lenh la $*" >&2; exit 99 ;;
esac
`;
const binGia = join(thuMuc, "bin");
spawnSync("mkdir", ["-p", binGia]);
writeFileSync(join(binGia, "aws"), AWS_GIA);
chmodSync(join(binGia, "aws"), 0o755);

interface DauVao {
  CHE_DO: string; BI_MAT: string; PHIEN_BAN: string; BAM: string; MA_TO_CHUC: string; TO_CHUC: string; SO_NGUOI: string; VAI: string;
  ACTOR: string; TRIGGERING_ACTOR: string;
}
const BAM = "ab".repeat(32);
const MA = "9b2d0c1e-8f7a-4b6c-9d5e-3a2b1c0d9e8f";
const TOT: DauVao = {
  CHE_DO: "tao", BI_MAT: "tp/khoi-tao/ban-khai/thep-viet", PHIEN_BAN: PB, BAM, MA_TO_CHUC: MA, TO_CHUC: "thep-viet", SO_NGUOI: "3",
  VAI: "BUYER=1,PROCUREMENT_MANAGER=2,DIRECTOR=1", ACTOR: "nguoi-bam", TRIGGERING_ACTOR: "nguoi-bam",
};
const THEM: Partial<DauVao> = { CHE_DO: "them-nguoi", MA_TO_CHUC: "", TO_CHUC: ORG };
const AWS_ENV = { AWS_REGION: "ap-southeast-1", TAI_KHOAN: "942091277863", CLUSTER: "tp-prod", SUBNETS: "subnet-0a1b,subnet-2c3d", SG_KHOI_TAO: "sg-0abc123" };

let dem = 0;
function chay(lenh: string[], env: Record<string, string>): { status: number | null; stdout: string; stderr: string; goi: string[][] } {
  dem += 1;
  const goi = join(thuMuc, `goi-${String(dem)}.jsonl`);
  writeFileSync(goi, "");
  const r = spawnSync("bash", [SCRIPT, ...lenh], {
    encoding: "utf8",
    env: { PATH: `${binGia}${delimiter}${process.env["PATH"] ?? ""}`, AWS_GIA_GOI: goi, ...env },
    timeout: 30_000,
  });
  const dong = readFileSync(goi, "utf8").split("\n").filter((d) => d !== "");
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, goi: dong.map((d) => JSON.parse(d) as string[]) };
}

const tsNhan = (d: DauVao): boolean => {
  try {
    docThamSo([d.CHE_DO, "--ban-khai-secret", d.BI_MAT, "--phien-ban", d.PHIEN_BAN, "--bam", d.BAM,
      ...(d.MA_TO_CHUC === "" ? [] : ["--ma-to-chuc", d.MA_TO_CHUC]), "--to-chuc", d.TO_CHUC, "--so-nguoi", d.SO_NGUOI, "--vai", d.VAI]);
    return true;
  } catch {
    return false;
  }
};

/** Task definition như stack 90 dựng cho họ tp-khoi-tao — mọi biến thể độc đổi đúng một chỗ của nó. */
const TD_TOT = {
  family: "tp-khoi-tao", taskRoleArn: "arn:aws:iam::942091277863:role/tp-khoi-tao", executionRoleArn: "arn:aws:iam::942091277863:role/tp-ecs-execution",
  networkMode: "awsvpc", requiresCompatibilities: ["FARGATE"], cpu: "256", memory: "512", revision: 7, status: "ACTIVE",
  containerDefinitions: [{
    name: "tp-khoi-tao", image: "942091277863.dkr.ecr.ap-southeast-1.amazonaws.com/tp-khoi-tao@sha256:" + "1".repeat(64), essential: true,
    readonlyRootFilesystem: true,
    environment: [{ name: "NODE_ENV", value: "production" }, { name: "TRUSTPROCURE_KHOI_TAO_REGION", value: "ap-southeast-1" }],
    secrets: [{ name: "DATABASE_URL", valueFrom: "arn:aws:secretsmanager:ap-southeast-1:942091277863:secret:tp/khoi-tao/database-url-AbC123" }],
    portMappings: [], logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": "/tp/khoi-tao", "awslogs-region": "ap-southeast-1", "awslogs-stream-prefix": "tp-khoi-tao" } },
  }],
};
type TD = typeof TD_TOT;
const doiContainer = (f: (c: Record<string, unknown>) => void): TD => {
  const td = JSON.parse(JSON.stringify(TD_TOT)) as TD;
  f(td.containerDefinitions[0] as unknown as Record<string, unknown>);
  return td;
};
const ANH = "942091277863.dkr.ecr.ap-southeast-1.amazonaws.com/tp-khoi-tao@sha256:" + "2".repeat(64);

describe.skipIf(process.platform === "win32")("[S1.9103] trien-khai.sh — kiem-khoi-tao, kiem-nguoi-duyet, khoi-tao, dang-ky tp-khoi-tao", () => {
  it("⑴ kiem-khoi-tao: không biến AWS, không gọi aws; in bảng đã duyệt; người bấm là bot ⇒ dừng", () => {
    const r = chay(["kiem-khoi-tao"], { ...TOT });
    expect(r.status, r.stderr).toBe(0);
    expect(r.goi).toEqual([]);
    for (const dong of ["| Người bấm | @nguoi-bam |", "| Chế độ | `tao` |", "| Bí mật bản khai | `tp/khoi-tao/ban-khai/thep-viet` |",
      `| Phiên bản (VersionId) | \`${PB}\` |`, `| SHA-256 của bản khai | \`${BAM}\` |`, "| Tổ chức (slug của tổ chức MỚI) | `thep-viet` |",
      `| Mã tổ chức | \`${MA}\` |`, "| Số người | 3 |", "| Số người theo vai | `BUYER=1,PROCUREMENT_MANAGER=2,DIRECTOR=1` |"]) {
      expect(r.stdout).toContain(dong);
    }
    const them = chay(["kiem-khoi-tao"], { ...TOT, ...THEM });
    expect(them.stdout).toContain(`| Tổ chức (mã tổ chức ĐÃ CÓ) | \`${ORG}\` |`);
    expect(them.stdout).toContain(`| Mã tổ chức | \`${ORG}\` |`);
    expect(chay(["kiem-khoi-tao", "thua"], { ...TOT }).status).toBe(1);
    for (const bot of [{ ACTOR: "github-actions[bot]", TRIGGERING_ACTOR: "github-actions[bot]" }, { TRIGGERING_ACTOR: "ung-dung-la[bot]" }, { ACTOR: "" }]) {
      const b = chay(["kiem-khoi-tao"], { ...TOT, ...bot });
      expect(b.status, JSON.stringify(bot)).toBe(1);
      expect(b.stdout).toBe("");
    }
  });

  it("⑵ luật đầu vào của script = luật của docThamSo, trên cùng một bộ đầu vào", () => {
    const ca: Partial<DauVao>[] = [
      {}, { ...THEM }, { CHE_DO: "xoa" }, { CHE_DO: "" },
      { BI_MAT: "tp/khoi-tao/ban-khai/" }, { BI_MAT: "tp/khoi-tao/database-url" }, { BI_MAT: "tp/khoi-tao/ban-khai/a b" },
      { BI_MAT: "tp/khoi-tao/ban-khai/$(id)" }, { BI_MAT: "tp/khoi-tao/ban-khai/nguyen.van.a@khach.vn" }, { BI_MAT: "tp/khoi-tao/ban-khai/a/b-c" },
      { BI_MAT: "tp/khoi-tao/ban-khai/á-b" }, { BI_MAT: "tp/khoi-tao/ban-khai/x\ny" }, { BI_MAT: "tp/khoi-tao/ban-khai/abc" },
      { BI_MAT: "tp/khoi-tao/ban-khai/ab" }, { BI_MAT: `tp/khoi-tao/ban-khai/${"a".repeat(63)}` }, { BI_MAT: `tp/khoi-tao/ban-khai/${"a".repeat(64)}` },
      { PHIEN_BAN: "a".repeat(31) }, { PHIEN_BAN: "a".repeat(32) }, { PHIEN_BAN: "a".repeat(64) }, { PHIEN_BAN: "a".repeat(65) },
      { PHIEN_BAN: `${"a".repeat(31)}_` }, { PHIEN_BAN: `-${"a".repeat(31)}` }, { PHIEN_BAN: `--${"a".repeat(30)}` },
      { PHIEN_BAN: PB.toUpperCase() }, { PHIEN_BAN: `${PB}\n` },
      { BAM: BAM.toUpperCase() }, { BAM: BAM.slice(1) }, { BAM: `${BAM}0` }, { BAM: "" }, { BAM: `${BAM.slice(1)}g` },
      { MA_TO_CHUC: "" }, { MA_TO_CHUC: MA.toUpperCase() }, { MA_TO_CHUC: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" },
      { ...THEM, MA_TO_CHUC: MA }, { MA_TO_CHUC: `${MA}\n` },
      { TO_CHUC: "ab" }, { TO_CHUC: "abc" }, { TO_CHUC: "a".repeat(63) }, { TO_CHUC: "a".repeat(64) }, { TO_CHUC: "Thep-Viet" },
      { TO_CHUC: "thep_viet" }, { TO_CHUC: "-thep" }, { TO_CHUC: "thep-" }, { TO_CHUC: ORG }, { TO_CHUC: "thep viet" },
      { TO_CHUC: "--thep" }, { TO_CHUC: "thep-viet\nx" },
      { ...THEM, TO_CHUC: "thep-viet" }, { ...THEM, TO_CHUC: ORG.toUpperCase() },
      { ...THEM, TO_CHUC: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }, { ...THEM, TO_CHUC: "3f2504e0-4f89-41d3-ca0c-0305e82c3301" },
      { SO_NGUOI: "0" }, { SO_NGUOI: "1", VAI: "BUYER=1" }, { SO_NGUOI: "50", VAI: "BUYER=50" }, { SO_NGUOI: "51", VAI: "BUYER=51" },
      { SO_NGUOI: "01" }, { SO_NGUOI: "1.0" }, { SO_NGUOI: "" }, { SO_NGUOI: " 3" }, { SO_NGUOI: "3 " }, { SO_NGUOI: "+3" },
      { SO_NGUOI: "٣" }, { SO_NGUOI: "3\n" }, { SO_NGUOI: "9999999999999999999999" },
      { VAI: "BUYER=3" }, { VAI: "BUYER=4" }, { VAI: "BUYER=2" }, { VAI: "BUYER=1,DIRECTOR=1" }, { VAI: "BUYER=1,DIRECTOR=2" },
      { VAI: "DIRECTOR=1,BUYER=2" }, { VAI: "BUYER=1,BUYER=2" }, { VAI: "BUYER=1,KHACH=2" }, { VAI: "buyer=3" }, { VAI: "BUYER=03" },
      { VAI: "BUYER=0,DIRECTOR=3" }, { VAI: "BUYER=3," }, { VAI: ",BUYER=3" }, { VAI: "BUYER=1,,DIRECTOR=2" }, { VAI: "BUYER=3\nDIRECTOR=1" },
      { VAI: "BUYER=3 " }, { VAI: "" }, { VAI: "BUYER" }, { VAI: "=3" }, { VAI: "BUYER==3" }, { VAI: "BUYER=٣" },
      { VAI: "REQUESTER=3,BUYER=3,TECHNICAL=3,PROCUREMENT_MANAGER=3,FINANCE=3,DIRECTOR=3" },
      { VAI: "REQUESTER=1,BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1,FINANCE=1,DIRECTOR=1" },
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
    expect(nhan).toBeGreaterThanOrEqual(15);
    expect(ca.length - nhan).toBeGreaterThanOrEqual(50);
  });

  it("⑶ khoi-tao thành công: lệnh mang đúng các đầu vào; run → chờ → mã thoát → xoá (không khôi phục); kết quả từ đầu vào, không log", () => {
    const r = chay(["khoi-tao", "arn:aws:ecs:ap-southeast-1:942091277863:task-definition/tp-khoi-tao:7"], { ...TOT, ...AWS_ENV });
    expect(r.status, r.stderr).toBe(0);
    expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual(["ecs run-task", "ecs wait", "ecs describe-tasks", "secretsmanager delete-secret"]);
    const run = r.goi[0]!;
    const overrides = JSON.parse(run[run.indexOf("--overrides") + 1]!) as unknown;
    expect(overrides).toEqual({ containerOverrides: [{ name: "tp-khoi-tao", command: [
      "tao", "--ban-khai-secret", TOT.BI_MAT, "--phien-ban", PB, "--bam", BAM, "--ma-to-chuc", MA,
      "--to-chuc", "thep-viet", "--so-nguoi", "3", "--vai", "BUYER=1,PROCUREMENT_MANAGER=2,DIRECTOR=1"] }] });
    expect(run).toContain("tp-prod");
    expect(run).toContain("awsvpcConfiguration={subnets=[subnet-0a1b,subnet-2c3d],securityGroups=[sg-0abc123],assignPublicIp=DISABLED}");
    expect(r.goi[3]).toEqual(["secretsmanager", "delete-secret", "--secret-id", TOT.BI_MAT, "--force-delete-without-recovery", "--query", "Name", "--output", "text"]);
    expect(r.stdout).toContain(`- Task \`${TASK}\`: thoát 0 — tao, tổ chức \`${MA}\`, 3 người, vai \`BUYER=1,PROCUREMENT_MANAGER=2,DIRECTOR=1\``);
    expect(r.stdout).toContain(`- Bí mật \`${TOT.BI_MAT}\` (phiên bản \`${PB}\`): đã xoá, không cửa sổ khôi phục`);
    expect(r.stdout).toContain(`/login#${MA}`);
    // Thêm người: không --ma-to-chuc; mã là to_chuc; không dặn gửi /login.
    const t = chay(["khoi-tao", "arn:td"], { ...TOT, ...THEM, ...AWS_ENV });
    expect(t.status, t.stderr).toBe(0);
    const cmd = (JSON.parse(t.goi[0]![t.goi[0]!.indexOf("--overrides") + 1]!) as { containerOverrides: { command: string[] }[] }).containerOverrides[0]!.command;
    expect(cmd).not.toContain("--ma-to-chuc");
    expect(cmd.slice(0, 1)).toEqual(["them-nguoi"]);
    expect(t.stdout).toContain(`them-nguoi, tổ chức \`${ORG}\``);
    expect(t.stdout).not.toContain("/login#");
  });

  it("⑷ task thoát ≠ 0 (hay không có mã): KHÔNG xoá; dặn bí mật CÒN, chạy lại an toàn, và lệnh xoá tay", () => {
    for (const ma of ["1", "null"]) {
      const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, AWS_GIA_MA: ma });
      expect(r.status).toBe(1);
      expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual(["ecs run-task", "ecs wait", "ecs describe-tasks"]);
      expect(r.stderr).toContain(`LOI: khoi-tao thoát mã ${ma}`);
      expect(r.stderr).toContain(`Bí mật ${TOT.BI_MAT} CÒN`);
      expect(r.stderr).toContain("lần chạy lại dừng ở 'slug đã có' / 'email đã có'");
      expect(r.stderr).toContain(`aws secretsmanager delete-secret --secret-id ${TOT.BI_MAT} --force-delete-without-recovery`);
    }
  });

  it("⑷ xoá hỏng sau khi task thoát 0: thoát 1, nói giao dịch ĐÃ commit", () => {
    const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, AWS_GIA_XOA_HONG: "1" });
    expect(r.status).toBe(1);
    expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual(["ecs run-task", "ecs wait", "ecs describe-tasks", "secretsmanager delete-secret"]);
    expect(r.stderr).toContain(`LOI: xoá bí mật ${TOT.BI_MAT} hỏng`);
    expect(r.stderr).toContain("Task đã thoát 0 (giao dịch đã commit) nhưng XOÁ bí mật hỏng");
  });

  it("⑷ đầu vào sai ở job chay (giá trị đổi giữa hai job, tiêm lệnh, người bấm là bot) ⇒ dừng TRƯỚC mọi lời gọi aws", () => {
    for (const c of [{ TO_CHUC: "$(id)" }, { VAI: "BUYER=1; rm -rf /" }, { BI_MAT: "tp/khoi-tao/database-url" }, { PHIEN_BAN: "khong" },
      { BAM: "khong" }, { MA_TO_CHUC: "" }, { TRIGGERING_ACTOR: "x[bot]" }, { SG_KHOI_TAO: "" }]) {
      const r = chay(["khoi-tao", "arn:td"], { ...TOT, ...AWS_ENV, ...c });
      expect(r.status, JSON.stringify(c)).toBe(1);
      expect(r.goi).toEqual([]);
    }
  });

  it("⑸ kiem-nguoi-duyet: phải có một NGƯỜI khác người bấm duyệt prod-khoi-tao; không biến AWS, không gọi aws", () => {
    const duyet = (login: string, o: { state?: string; env?: string; type?: string } = {}) =>
      ({ environments: [{ id: 1, name: o.env ?? "prod-khoi-tao" }], state: o.state ?? "approved", comment: "", user: { login, id: 2, type: o.type ?? "User" } });
    const thu = (ds: unknown[], env: Record<string, string> = {}) => {
      const tep = join(thuMuc, `duyet-${String(dem + 1)}.json`);
      writeFileSync(tep, JSON.stringify(ds));
      return chay(["kiem-nguoi-duyet", tep], { ACTOR: "nguoi-bam", TRIGGERING_ACTOR: "nguoi-bam", ...env });
    };
    const dung = thu([duyet("nguoi-duyet")]);
    expect(dung.status, dung.stderr).toBe(0);
    expect(dung.stdout).toBe("- Người duyệt: @nguoi-duyet\n");
    expect(dung.goi).toEqual([]);
    expect(thu([duyet("Nguoi-Bam"), duyet("nguoi-duyet")]).stdout).toBe("- Người duyệt: @nguoi-duyet\n");
    for (const [ds, env] of [
      [[], {}],                                                    // admin bỏ qua luật duyệt: không bản ghi nào
      [[duyet("nguoi-bam")], {}],                                  // tự duyệt
      [[duyet("NGUOI-BAM")], {}],                                  // login GitHub không phân biệt hoa thường
      [[duyet("nguoi-duyet", { state: "rejected" })], {}],
      [[duyet("nguoi-duyet", { env: "prod" })], {}],               // duyệt environment khác
      [[duyet("tro-ly[bot]", { type: "Bot" })], {}],
      [[duyet("nguoi-goc")], { ACTOR: "nguoi-goc", TRIGGERING_ACTOR: "nguoi-chay-lai" }], // người khởi run gốc duyệt lần chạy lại
      [[duyet("nguoi-duyet")], { ACTOR: "github-actions[bot]", TRIGGERING_ACTOR: "github-actions[bot]" }],
    ] as [unknown[], Record<string, string>][]) {
      const r = thu(ds, env);
      expect(r.status, JSON.stringify([ds, env])).toBe(1);
      expect(r.stdout).toBe("");
    }
    writeFileSync(join(thuMuc, "hong.json"), "khong phai json");
    expect(chay(["kiem-nguoi-duyet", join(thuMuc, "hong.json")], { ACTOR: "a", TRIGGERING_ACTOR: "a" }).status).toBe(1);
  });

  it("⑹ dang-ky tp-khoi-tao: bản mới nhất đúng hình dạng stack 90 thì nhân bản (chỉ đổi image); bị cài độc thì dừng trước khi đăng ký", () => {
    const dk = (td: unknown) => chay(["dang-ky", "tp-khoi-tao", ANH, "tp-khoi-tao"], { ...AWS_ENV, AWS_GIA_TD: JSON.stringify(td) });
    const tot = dk(TD_TOT);
    expect(tot.status, tot.stderr).toBe(0);
    expect(tot.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`)).toEqual(["ecs describe-task-definition", "ecs register-task-definition"]);
    const doc: Record<string, (c: Record<string, unknown>) => void> = {
      "NODE_OPTIONS": (c) => { (c["environment"] as unknown[]).push({ name: "NODE_OPTIONS", value: "--import=data:text/javascript,1" }); },
      "NODE_ENV khác": (c) => { (c["environment"] as { value: string }[])[0]!.value = "development"; },
      "region khác": (c) => { (c["environment"] as { value: string }[])[1]!.value = "us-east-1"; },
      "secret thêm": (c) => { (c["secrets"] as unknown[]).push({ name: "X", valueFrom: "arn:aws:secretsmanager:ap-southeast-1:942091277863:secret:tp/api/otp-peppers-AbC123" }); },
      "secret đổi nguồn": (c) => { (c["secrets"] as { valueFrom: string }[])[0]!.valueFrom = "arn:aws:secretsmanager:ap-southeast-1:942091277863:secret:rds!db-123-AbC123"; },
      "root fs ghi được": (c) => { c["readonlyRootFilesystem"] = false; },
      "không khai root fs": (c) => { delete c["readonlyRootFilesystem"]; },
      "privileged": (c) => { c["privileged"] = true; },
      "entryPoint": (c) => { c["entryPoint"] = ["sh", "-c"]; },
      "command": (c) => { c["command"] = ["tao"]; },
      "user root": (c) => { c["user"] = "root"; },
      "environmentFiles": (c) => { c["environmentFiles"] = [{ value: "arn:aws:s3:::x/y.env", type: "s3" }]; },
      "log group khác": (c) => { (c["logConfiguration"] as { options: Record<string, string> }).options["awslogs-group"] = "/tp/api"; },
    };
    for (const [ten, f] of Object.entries(doc)) {
      const r = dk(doiContainer(f));
      expect(r.status, ten).toBe(1);
      expect(r.stderr, ten).toContain("lệch hình dạng stack 90");
      expect(r.goi.map((g) => `${g[0] ?? ""} ${g[1] ?? ""}`), ten).toEqual(["ecs describe-task-definition"]);
    }
    const execKhac = { ...JSON.parse(JSON.stringify(TD_TOT)) as TD, executionRoleArn: "arn:aws:iam::942091277863:role/tp-api" };
    expect(dk(execKhac).status).toBe(1);
    const volume = { ...JSON.parse(JSON.stringify(TD_TOT)) as TD, volumes: [{ name: "v" }] };
    expect(dk(volume).status).toBe(1);
  });
});
