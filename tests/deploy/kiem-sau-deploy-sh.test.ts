// ==============================================================================================
// [ADR-078 / S1.252] `deploy/kiem-sau-deploy.sh worker` — ĐO BẰNG `aws` GIẢ
//
// Job `worker` của pipeline chỉ thay task definition (`update-service`), KHÔNG đổi số task: số task là `so_ban_worker` của
// stack 90 (APPLY-LAN-DAU 8.2). Bản trước chỉ so `runningCount = desiredCount`, nên một worker CHƯA BẬT (0/0) qua kiểm — job
// xanh mà không worker nào chạy, và alarm thiếu task chỉ tồn tại khi `so_ban_worker > 0`. Nay muốn 0 task là HỎNG.
// Script chạy trên runner Linux của GitHub, nên test chạy bash thật; Windows không có môi trường ấy — bỏ qua ở đó.
// ==============================================================================================
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../deploy/kiem-sau-deploy.sh", import.meta.url));

// `aws` giả: trả lời hai lệnh mà `worker` gọi, theo biến AWS_GIA_* của ca test.
const AWS_GIA = `#!/usr/bin/env bash
case "$1 $2" in
  "ecs describe-services") printf '{"chay": %s, "muon": %s}\\n' "$AWS_GIA_CHAY" "$AWS_GIA_MUON" ;;
  "logs filter-log-events") echo "\${AWS_GIA_DONG:-0}" ;;
  *) echo "aws gia: lenh la $*" >&2; exit 99 ;;
esac
`;
let thuMuc = "";
let binGia = "";

function worker(chay: string, muon: string, dong = "0"): { status: number | null; stderr: string } {
  const r = spawnSync("bash", [SCRIPT, "worker"], {
    encoding: "utf8",
    env: {
      PATH: `${binGia}${delimiter}${process.env["PATH"] ?? ""}`,
      AWS_REGION: "ap-southeast-1", CLUSTER: "tp-prod", BAT_DAU_MS: "1790000000000", CHO_WORKER_GIAY: "0",
      AWS_GIA_CHAY: chay, AWS_GIA_MUON: muon, AWS_GIA_DONG: dong,
    },
    timeout: 30_000,
  });
  return { status: r.status, stderr: r.stderr };
}

describe.skipIf(process.platform === "win32")("[ADR-078] kiem-sau-deploy.sh worker", () => {
  beforeAll(() => {
    thuMuc = mkdtempSync(join(tmpdir(), "kiem-sau-deploy-"));
    binGia = join(thuMuc, "bin");
    mkdirSync(binGia);
    writeFileSync(join(binGia, "aws"), AWS_GIA);
    chmodSync(join(binGia, "aws"), 0o755);
  });
  afterAll(() => rmSync(thuMuc, { recursive: true, force: true }));

  it("đủ task, log sạch ⇒ đạt", () => {
    const r = worker("1", "1");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("dat: tp-unseal-worker 1/1 task");
  });

  it("[S1.252] muốn 0 task (worker chưa bật) ⇒ HỎNG và nói cách bật — không còn là 0/0 xanh", () => {
    const r = worker("0", "0");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("so_ban_worker");
    expect(r.stderr).toContain("APPLY-LAN-DAU 8.2");
  });

  it("thiếu task, hay có dòng lỗi khởi động ⇒ HỎNG như trước", () => {
    expect(worker("0", "1").stderr).toContain("chạy 0/1 task");
    expect(worker("1", "1", "2").stderr).toContain("2 dòng lỗi khởi động");
    expect(worker("0", "1").status).toBe(1);
  });
});
