// ==============================================================================================
// [ADR-074 / khoản 196] CÁCH ĐO `ClockDrift` CỦA README — PHẦN CHẠY ĐƯỢC KHÔNG CẦN AWS
//
// APPLY-LAN-DAU 6.7 đo nguồn thời gian bằng một task `tp-migrate` chạy một lần với `command` ghi đè (README, "Nguồn thời
// gian", bước 1). Lệnh ấy chỉ có kết quả thật trên Fargate, nhưng ba điều kiện của nó hỏng được trong im lặng từ kho:
//   ⑴ `name` trong `clockdrift.json` phải là tên container của task `migrate` ở stack 90 — lệch thì `run-task` từ chối;
//   ⑵ đích `migrate` của `deploy/Dockerfile` KHÔNG có ENTRYPOINT — có thì `command` thành đối số của công cụ migrate;
//   ⑶ lệnh in đúng một dòng `CLOCKDRIFT {…}` từ endpoint metadata v4 — đo ở đây trên một endpoint giả, chạy đúng argv
//      của tệp (không shell, như ECS chuyển `command` khi image không có ENTRYPOINT).
// ==============================================================================================

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const README = doc("infra/terraform/README.md");
const TF90 = doc("infra/terraform/90-ecs/main.tf");
const DOCKER = doc("deploy/Dockerfile");

interface GhiDe {
  readonly containerOverrides: readonly { readonly name: string; readonly command: readonly string[] }[];
}

function tepClockdrift(): GhiDe {
  const muc = README.slice(README.indexOf("## Nguồn thời gian"));
  const dong = muc.split("\n").find((d) => d.trimStart().startsWith('{"containerOverrides"'));
  expect(dong, 'README "Nguồn thời gian" không còn dòng clockdrift.json').toBeDefined();
  return JSON.parse(dong?.trim() ?? "null") as GhiDe;
}

function chay(argv: readonly string[], bienMoiTruong: Record<string, string>): Promise<{ ma: number; ra: string }> {
  return new Promise((xong) => {
    execFile(process.execPath, argv.slice(1), { env: { ...process.env, ...bienMoiTruong } }, (e, ra) => {
      xong({ ma: typeof e?.code === "number" ? e.code : 0, ra });
    });
  });
}

describe("[ADR-074] cách đo ClockDrift của README", () => {
  const ghiDe = tepClockdrift();

  it("⑴ tên container trong clockdrift.json là tên container của task migrate ở stack 90", () => {
    expect(ghiDe.containerOverrides).toHaveLength(1);
    const ho = /\bmigrate\s*=\s*\{\s*ho\s*=\s*"([^"]+)"/u.exec(TF90)?.[1];
    expect(ho).toBe("tp-migrate");
    // Tên container của mọi task definition là họ của nó — đổi dòng này thì ⑴ phải đọc tên ở chỗ mới.
    expect(TF90).toMatch(/container_definitions = jsonencode\(\[\{\n\s+name\s+= each\.value\.ho\n/u);
    expect(ghiDe.containerOverrides[0]?.name).toBe(ho);
  });

  it("⑵ đích migrate của Dockerfile chỉ có CMD — `command` thay trọn lệnh", () => {
    const batDau = DOCKER.indexOf("FROM ${NODE_IMAGE} AS migrate\n");
    expect(batDau).toBeGreaterThan(-1);
    const sau = DOCKER.slice(batDau + 1);
    const khoi = sau.slice(0, sau.indexOf("\nFROM ") === -1 ? undefined : sau.indexOf("\nFROM "));
    expect(khoi).not.toMatch(/^ENTRYPOINT\b/mu);
    expect(khoi).toMatch(/^CMD \[/mu);
    expect(ghiDe.containerOverrides[0]?.command[0]).toBe("node");
  });

  it("⑶ trên một endpoint metadata v4 giả, lệnh in đúng một dòng CLOCKDRIFT mang trạng thái đồng bộ", async () => {
    const DRIFT = { ClockErrorBound: 0.5458234999999999, ReferenceTimestamp: "2026-10-01T11:00:00Z", ClockSynchronizationStatus: "SYNCHRONIZED" };
    const may = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(req.url === "/v4/abc/task" ? JSON.stringify({ Family: "tp-migrate", LaunchType: "FARGATE", ClockDrift: DRIFT }) : "{}");
    });
    await new Promise<void>((xong) => may.listen(0, "127.0.0.1", xong));
    try {
      const { port } = may.address() as AddressInfo;
      const kq = await chay(ghiDe.containerOverrides[0]?.command ?? [], { ECS_CONTAINER_METADATA_URI_V4: `http://127.0.0.1:${port}/v4/abc` });
      expect(kq.ma).toBe(0);
      expect(kq.ra).toBe(`CLOCKDRIFT ${JSON.stringify(DRIFT)}\n`);
    } finally {
      may.close();
    }
  });
});
