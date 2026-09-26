// ==============================================================================================
// [ADR-076] DANH SÁCH TÊN MÀ VPC PROD ĐƯỢC PHÂN GIẢI — MỘT DANH SÁCH ĐÓNG, VÀ NÓ PHẢI KHỚP MÃ
//
// DNS Firewall của stack 90 chỉ cho phân giải một danh sách tên; mọi tên khác NXDOMAIN, ghi log, cảnh báo ⑸ của stack 60.
// Hai kiểu hỏng mà không test ứng dụng nào thấy:
//   • danh sách NỚI ra — một wildcard `*.amazonaws.com` hay `*.s3…` mở lại đường tuồn dữ liệu qua bucket của người lạ;
//   • danh sách THIẾU — mã thêm một đích HTTPS mới (một URL hằng trong adapter) mà quên khai ⇒ prod NXDOMAIN.
// Nên ghim:
//   ⑴ danh sách đúng tập ADR-076 chọn, không wildcard; mọi host `https://…` hằng trong adapter của api có mặt;
//   ⑵ quy tắc ALLOW (100) đứng trước quy tắc chặn (200), chặn mặc định BLOCK/NXDOMAIN, fail-closed, chống sửa;
//   ⑶ tên alarm ở stack 90 và mẫu bắt ở stack 60 là MỘT tên; topic cho rule ⑸ publish;
//   ⑷ SMS qua endpoint `sms-voice`, api ra internet chỉ 443.
// Đọc bằng regex như `hinh-dang-alb.test.ts` — cái giá (bám cách viết) là chủ đích.
// ==============================================================================================

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const TF90 = doc("infra/terraform/90-ecs/main.tf");
const TF60 = doc("infra/terraform/60-canh-bao/main.tf");

function khoi(tf: string, loai: string, ten: string): string {
  const batDau = tf.indexOf(`resource "${loai}" "${ten}" {\n`);
  expect(batDau, `không tìm thấy ${loai}.${ten}`).toBeGreaterThan(-1);
  return tf.slice(batDau, tf.indexOf("\n}\n", batDau) + 2);
}

function danhSachTen(): string[] {
  const m = /\n {2}ten_duoc_phan_giai = \[\n([\s\S]*?)\n {2}\]\n/u.exec(TF90);
  expect(m, "không đọc được local.ten_duoc_phan_giai").not.toBeNull();
  return (m?.[1] ?? "")
    .split("\n")
    .map((d) => d.trim().replace(/,$/u, ""))
    .filter((d) => d !== "");
}

describe("[ADR-076] DNS Firewall của VPC prod", () => {
  it("⑴ danh sách tên đúng tập đã chọn, không wildcard", () => {
    expect(danhSachTen()).toEqual([
      '"kms.${local.region}.amazonaws.com"',
      '"api.ecr.${local.region}.amazonaws.com"',
      '"${local.prod}.dkr.ecr.${local.region}.amazonaws.com"',
      '"logs.${local.region}.amazonaws.com"',
      '"secretsmanager.${local.region}.amazonaws.com"',
      '"sts.${local.region}.amazonaws.com"',
      '"email.${local.region}.amazonaws.com"',
      '"sms-voice.${local.region}.amazonaws.com"',
      '"prod-${local.region}-starport-layer-bucket.s3.${local.region}.amazonaws.com"',
      '"${module.chung.bucket.anchor}.s3.${local.region}.amazonaws.com"',
      "aws_db_instance.tp.address",
      '"business.openapi.zalo.me"',
      '"oauth.zaloapp.com"',
    ]);
    for (const t of danhSachTen()) expect(t, t).not.toMatch(/\*/u);
  });

  it("⑴ mọi host `https://…` hằng trong adapter của api nằm trong danh sách", () => {
    const thuMuc = fileURLToPath(new URL("../../apps/api/src/adapters/", import.meta.url));
    const host = new Set<string>();
    for (const tep of readdirSync(thuMuc)) {
      if (!tep.endsWith(".ts") || tep.endsWith(".test.ts")) continue;
      for (const m of doc(`apps/api/src/adapters/${tep}`).matchAll(/"https:\/\/([a-z0-9.-]+)[/"]/gu)) host.add(m[1] ?? "");
    }
    expect(host.size).toBeGreaterThan(0);
    const ds = danhSachTen();
    for (const h of host) expect(ds, h).toContain(`"${h}"`);
  });

  it("⑵ ALLOW 100 trước chặn 200; chặn mặc định BLOCK/NXDOMAIN; fail-closed; chống sửa; gắn vào VPC", () => {
    const choPhep = khoi(TF90, "aws_route53_resolver_firewall_rule", "cho_phep");
    expect(choPhep).toMatch(/\n {2}priority += 100\n/u);
    expect(choPhep).toMatch(/\n {2}action += "ALLOW"\n/u);
    expect(choPhep).toMatch(/duoc_phep\.id\n/u);
    const chan = khoi(TF90, "aws_route53_resolver_firewall_rule", "chan_con_lai");
    expect(chan).toMatch(/\n {2}priority += 200\n/u);
    expect(chan).toMatch(/moi_ten\.id\n/u);
    expect(chan).toMatch(/\n {2}action += var\.che_do_dns\n/u);
    expect(chan).toMatch(/"NXDOMAIN"/u);
    expect(khoi(TF90, "aws_route53_resolver_firewall_domain_list", "moi_ten")).toMatch(/domains = \["\*"\]/u);
    expect(TF90).toMatch(/variable "che_do_dns" \{[\s\S]*?default += "BLOCK"/u);
    const ganVao = khoi(TF90, "aws_route53_resolver_firewall_rule_group_association", "tp");
    expect(ganVao).toMatch(/vpc_id += aws_vpc\.tp\.id/u);
    expect(ganVao).toMatch(/mutation_protection += "ENABLED"/u);
    expect(khoi(TF90, "aws_route53_resolver_firewall_config", "tp")).toMatch(/firewall_fail_open = "DISABLED"/u);
    expect(khoi(TF90, "aws_route53_resolver_query_log_config_association", "tp")).toMatch(/aws_vpc\.tp\.id/u);
  });

  it("⑶ một tên alarm cho cả hai stack; topic cho rule ⑸ publish; prod chuyển sang audit", () => {
    const ten90 = /\n {2}ten_alarm_dns = "([^"]+)"/u.exec(TF90)?.[1];
    const ten60 = /\n {2}ten_alarm_dns = "([^"]+)"/u.exec(TF60)?.[1];
    expect(ten90).toBe("tp-dns-bi-chan");
    expect(ten60).toBe(ten90);
    expect(khoi(TF90, "aws_cloudwatch_metric_alarm", "dns_bi_chan")).toMatch(/alarm_name += local\.ten_alarm_dns/u);
    expect(khoi(TF60, "aws_sns_topic_policy", "canh_bao_khoa")).toMatch(/aws_cloudwatch_event_rule\.dns_bi_chan_audit\.arn/u);
    expect(khoi(TF60, "aws_cloudwatch_event_target", "dns_bi_chan_prod")).toMatch(/arn += local\.bus_audit_arn/u);
  });

  it("⑷ SMS qua endpoint sms-voice; api ra internet chỉ 443", () => {
    expect(TF90).toMatch(/var\.sms == null \? \[\] : \["sms-voice"\]/u);
    const ra = khoi(TF90, "aws_vpc_security_group_egress_rule", "api_internet");
    expect(ra).toMatch(/from_port += 443\n/u);
    expect(ra).toMatch(/to_port += 443\n/u);
  });
});
