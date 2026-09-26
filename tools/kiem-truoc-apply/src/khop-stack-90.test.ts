// Luật của tool phải khớp CHÍNH stack 90 và hướng dẫn apply: thêm một secret, một kho ECR, một image hay đổi tên biến
// mà quên tool ⇒ tool xanh trong khi plan đỏ (hoặc task chết lúc chạy). Test đọc chữ của các tệp, không gọi Terraform.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KHO_ECR, SECRET_LUON_CAN, SECRET_ZALO, TEN_ANH, digestHopLe, laGiuCho, type BienStack90 } from "./luat.js";
import { BIEU_THUC_CONSOLE } from "./nguon.js";

const doc = (duong: string): string => readFileSync(new URL(`../../../${duong}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n");
const TF90 = doc("infra/terraform/90-ecs/main.tf");
const HUONG_DAN = doc("docs/APPLY-LAN-DAU.md");

describe("tool kiem-truoc-apply khớp stack 90", () => {
  it("SECRET_LUON_CAN = mọi data aws_secretsmanager_secret của stack 90; secret Zalo là tên api đọc và stack 85 tạo", () => {
    const trongTf = [...TF90.matchAll(/^data "aws_secretsmanager_secret" "[a-z_]+" \{ name = "([^"]+)" \}$/gmu)].map((m) => m[1]);
    expect([...trongTf].sort()).toEqual([...SECRET_LUON_CAN].sort());
    expect(TF90).toContain(`{ name = "TRUSTPROCURE_ZALO_SECRET_ID", value = "${SECRET_ZALO}" }`);
    expect(doc("infra/terraform/85-sms-zalo/main.tf")).toContain(`"${SECRET_ZALO}"`);
  });

  it("KHO_ECR = for_each của aws_ecr_repository.tp; TEN_ANH = khoá của var.anh", () => {
    const kho = /resource "aws_ecr_repository" "tp" \{\n {2}for_each += toset\(\[([^\]]+)\]\)/u.exec(TF90)?.[1];
    expect(kho).toBeDefined();
    expect([...(kho ?? "").matchAll(/"([^"]+)"/gu)].map((m) => m[1]).sort()).toEqual(Object.values(KHO_ECR).sort());
    const kieu = /variable "anh" \{[\s\S]*?type += object\(\{ ([^}]+) \}\)/u.exec(TF90)?.[1];
    expect([...(kieu ?? "").matchAll(/([a-z_]+) = string/gu)].map((m) => m[1]).sort()).toEqual([...TEN_ANH].sort());
  });

  it("mọi var.X trong biểu thức console là một biến khai ở stack 90", () => {
    const bien = [...BIEU_THUC_CONSOLE.matchAll(/var\.([a-z_]+)/gu)].map((m) => m[1] ?? "");
    expect(bien.length).toBeGreaterThanOrEqual(9);
    for (const b of bien) expect(TF90, b).toContain(`variable "${b}" {`);
  });

  it("giá trị giữ chỗ trong mẫu prod.tfvars của hướng dẫn đều bị bắt", () => {
    const mau = /```hcl\n([\s\S]*?)```/u.exec(HUONG_DAN.slice(HUONG_DAN.indexOf("`prod.tfvars`")))?.[1] ?? "";
    expect(mau).toContain("anh = {");
    const chuoi = [...mau.matchAll(/^\s*(ten_mien|api|tu_api)\s*=\s*"([^"]+)"/gmu)].map((m) => [m[1], m[2]] as const);
    expect(chuoi.length).toBe(2);
    for (const [ten, v] of chuoi) {
      if (ten === "api") {
        const bien = { anh: { api: v } } as unknown as BienStack90;
        expect(digestHopLe(bien, { prod: "942091277863", region: "ap-southeast-1" }, "api"), v).toBeNull();
      } else expect(laGiuCho(v ?? ""), v).toBe(true);
    }
    for (const dc of [...mau.matchAll(/"(<[^"]*)"/gu)].map((m) => m[1] ?? "")) expect(laGiuCho(dc), dc).toBe(true);
  });

  it("hướng dẫn apply gọi tool trước plan của 6.4 và khi bật api / worker", () => {
    const lenh = "pnpm kiem-truoc-apply --var-file infra\\terraform\\90-ecs\\prod.tfvars";
    const lan = HUONG_DAN.split(lenh).length - 1;
    expect(lan).toBeGreaterThanOrEqual(1);
    const vi = HUONG_DAN.indexOf(lenh);
    expect(vi).toBeGreaterThan(HUONG_DAN.indexOf("### 6.4"));
    expect(vi).toBeLessThan(HUONG_DAN.indexOf("terraform plan -var-file prod.tfvars -out plan.tfplan"));
  });
});
