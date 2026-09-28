// [S1.182 / ADR-111] Mỗi vai đăng nhập mà task migrate dựng phải có URL trong CHÍNH task definition của nó: thêm một vai
// vào `docCauHinh` mà quên `bi_mat.migrate` của stack 90 ⇒ mọi test xanh, còn `tp-migrate` trên prod chết ở lần chạy đầu
// ("thiếu biến môi trường …"). Test đọc chữ của hai tệp, không gọi Terraform.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string => readFileSync(new URL(`../../../${duong}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n");

describe("[S1.182] tools/chay-migrate khớp task definition `tp-migrate` của stack 90", () => {
  it("mỗi URL vai mà docCauHinh đòi là một secret của bi_mat.migrate, trỏ một data secret có khai", () => {
    const tf = doc("infra/terraform/90-ecs/main.tf");
    const bien = [...doc("tools/chay-migrate/src/index.ts").matchAll(/docVaiTuUrl\("([A-Z_]+)", bat\(env, "\1"\)/gu)].map((m) => m[1] ?? "");
    expect(bien).toEqual([
      "TRUSTPROCURE_API_DATABASE_URL",
      "TRUSTPROCURE_WORKER_DATABASE_URL",
      "TRUSTPROCURE_NEO_DATABASE_URL",
      "TRUSTPROCURE_KHOI_TAO_DATABASE_URL",
    ]);
    const khoi = /\n {2}bi_mat = \{[\s\S]*?\n {4}migrate = \[\n([\s\S]*?)\n {4}\]/u.exec(tf)?.[1] ?? "";
    expect(khoi).toContain("TRUSTPROCURE_MIGRATE_DB_PASSWORD");
    for (const b of bien) {
      const du = new RegExp(`\\{ name = "${b}", valueFrom = data\\.aws_secretsmanager_secret\\.([a-z_]+)\\.arn \\}`, "u").exec(khoi);
      expect(du, b).not.toBeNull();
      expect(tf, b).toMatch(new RegExp(`^data "aws_secretsmanager_secret" "${du?.[1] ?? ""}" \\{ name = "[^"]+" \\}$`, "mu"));
    }
  });
});
