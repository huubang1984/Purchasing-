// ==============================================================================================
// [ADR-079] CHÍNH SÁCH VPC ENDPOINT — KHÔNG ENDPOINT NÀO RƠI VỀ FULLACCESS MẶC ĐỊNH
//
// Một `aws_vpc_endpoint` không có `policy` là FullAccess: mọi credential, mọi tài nguyên của mọi tài khoản. Không test
// ứng dụng nào thấy điều đó. Nên ghim:
//   ⑴ MỌI `aws_vpc_endpoint` của stack 90 mang `policy`;
//   ⑵ endpoint giao diện: người gọi `StringEquals` và tài nguyên `StringEqualsIfExists` trên đúng [prod, audit];
//      không Deny/Allow nào khác lọt vào tài liệu;
//   ⑶ S3 gateway: đúng hai quyền — GetObject trên bucket lớp ECR, Get/Put/List trên bucket neo; không `s3:*`; gắn cả
//      bảng định tuyến riêng lẫn bảng của api.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TF = readFileSync(fileURLToPath(new URL("../../infra/terraform/90-ecs/main.tf", import.meta.url)), "utf8").replace(
  /\r\n/gu,
  "\n",
);

function khoi(loai: string, ten: string): string {
  const batDau = TF.indexOf(`resource "${loai}" "${ten}" {\n`);
  expect(batDau, `không tìm thấy ${loai}.${ten}`).toBeGreaterThan(-1);
  return TF.slice(batDau, TF.indexOf("\n}\n", batDau) + 2);
}

function local(ten: string): string {
  const batDau = TF.indexOf(`\n  ${ten} = jsonencode({\n`);
  expect(batDau, `không tìm thấy local.${ten}`).toBeGreaterThan(-1);
  return TF.slice(batDau, TF.indexOf("\n  })\n", batDau) + 6);
}

describe("[ADR-079] chính sách VPC endpoint", () => {
  it("⑴ mọi aws_vpc_endpoint mang policy", () => {
    const ten = [...TF.matchAll(/resource "aws_vpc_endpoint" "([a-z0-9_]+)" \{/gu)].map((m) => m[1] ?? "");
    expect(ten.length).toBeGreaterThanOrEqual(2);
    for (const t of ten) expect(khoi("aws_vpc_endpoint", t), t).toMatch(/\n {2}policy += local\.chinh_sach_/u);
    expect(khoi("aws_vpc_endpoint", "giao_dien")).toMatch(/policy += local\.chinh_sach_endpoint\n/u);
    expect(khoi("aws_vpc_endpoint", "s3")).toMatch(/policy += local\.chinh_sach_s3\n/u);
  });

  it("⑵ endpoint giao diện: vành đai theo tài khoản [prod, audit]", () => {
    expect(TF).toMatch(/\n {2}tai_khoan_duoc_phep = \[local\.prod, module\.chung\.account\.audit\]\n/u);
    const cs = local("chinh_sach_endpoint");
    expect([...cs.matchAll(/Sid +=/gu)]).toHaveLength(1);
    expect(cs).toMatch(/Effect += "Allow"/u);
    expect(cs).toMatch(/StringEquals += \{ "aws:PrincipalAccount" = local\.tai_khoan_duoc_phep \}/u);
    expect(cs).toMatch(/StringEqualsIfExists = \{ "aws:ResourceAccount" = local\.tai_khoan_duoc_phep \}/u);
  });

  it("⑶ S3 gateway: đúng hai bucket, không s3:*, gắn cả bảng của api", () => {
    const cs = local("chinh_sach_s3");
    expect([...cs.matchAll(/Sid +=/gu)].map((m) => m.index)).toHaveLength(2);
    expect(cs).not.toMatch(/"s3:\*"|Action += "\*"/u);
    const taiNguyen = [...cs.matchAll(/arn:aws:s3:::([^"]+)"/gu)].map((m) => m[1]);
    expect(taiNguyen).toEqual([
      "${local.bucket_lop_ecr}/*",
      "${module.chung.bucket.anchor}",
      "${module.chung.bucket.anchor}/*",
    ]);
    expect(cs).toMatch(/Action += "s3:GetObject"\n {8}Resource += "arn:aws:s3:::\$\{local\.bucket_lop_ecr\}\/\*"/u);
    expect(cs).toMatch(/Action += \["s3:GetObject", "s3:PutObject", "s3:ListBucket"\]/u);
    expect(khoi("aws_vpc_endpoint", "s3")).toMatch(/route_table_ids += \[aws_route_table\.rieng\.id, aws_route_table\.api\.id\]/u);
  });
});
