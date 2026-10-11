// ==============================================================================================
// [ADR-069] STACK 85 — SMS TUỲ CHỌN, ZALO LUÔN DỰNG ĐƯỢC
//
// [2026-10-10] Brandname SMS Việt Nam duyệt tính bằng tuần, còn Zalo OA có thể sẵn sàng trước. Bản trước bắt buộc
// `sender_id` và dựng sender ID vô điều kiện, nên kênh Zalo — secret `tp/api/zalo-oa` cùng quyền của `tp-api` trên
// nó — không apply được khi chưa có brandname. Phép canh này chỉ có giá trị khi:
//   ⑴ `sender_id` để trống được (mặc định null), và điều kiện kiểm chấp nhận null;
//   ⑵ MỌI tài nguyên SMS đi theo đúng một công tắc suy từ `sender_id`, output `sms` là null khi tắt;
//   ⑶ phần Zalo KHÔNG có công tắc nào — tắt SMS không được kéo Zalo theo.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TF = readFileSync(fileURLToPath(new URL("../../infra/terraform/85-sms-zalo/main.tf", import.meta.url)), "utf8").replace(
  /\r\n/gu,
  "\n",
);

function khoi(dau: string): string {
  const batDau = TF.indexOf(`${dau} {\n`);
  expect(batDau, `không tìm thấy ${dau}`).toBeGreaterThan(-1);
  return TF.slice(batDau, TF.indexOf("\n}\n", batDau) + 2);
}

const SMS = [
  'resource "aws_pinpointsmsvoicev2_sender_id" "vn"',
  'resource "aws_pinpointsmsvoicev2_configuration_set" "sms"',
  'data "aws_iam_policy_document" "sms"',
  'resource "aws_iam_role_policy" "sms"',
] as const;

const ZALO = [
  'resource "aws_secretsmanager_secret" "zalo"',
  'data "aws_iam_policy_document" "zalo"',
  'resource "aws_iam_role_policy" "zalo"',
] as const;

describe("[ADR-069] stack 85: SMS tuỳ chọn, Zalo luôn dựng", () => {
  it("⑴ sender_id mặc định null và điều kiện kiểm chấp nhận null", () => {
    const bien = khoi('variable "sender_id"');
    expect(bien).toMatch(/\n {2}default += null\n/u);
    expect(bien).toMatch(/condition += var\.sender_id == null \|\| can\(regex\(/u);
    expect(TF).toMatch(/\n {2}co_sms = var\.sender_id != null\n/u);
  });

  it.each(SMS)("⑵ %s đi theo công tắc co_sms", (dau) => {
    expect(khoi(dau)).toMatch(/\n {2}count += local\.co_sms \? 1 : 0\n/u);
  });

  it("⑵ output sms là null khi tắt SMS", () => {
    expect(khoi('output "sms"')).toMatch(/value = local\.co_sms \? \{[\s\S]*\} : null\n/u);
  });

  it.each(ZALO)("⑶ %s không có công tắc nào", (dau) => {
    expect(khoi(dau)).not.toMatch(/\b(count|for_each) *=/u);
  });
});
