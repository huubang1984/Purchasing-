// ==============================================================================================
// [ADR-089] CANH ĐĂNG KÝ SNS — LAMBDA Ở AUDIT ĐỐI CHIẾU NGƯỜI NHẬN, BA ALARM TỚI CẢ HAI TOPIC
//
// Phép canh này chỉ có giá trị khi:
//   ⑴ Lambda chỉ LIỆT KÊ đăng ký, đúng trên hai topic cảnh báo — không Publish, không Subscribe/Unsubscribe;
//   ⑵ danh sách nó đối chiếu là CHÍNH hai biến người nhận mà các subscription dùng, và phủ MỌI subscription email của stack;
//   ⑶ tệp Terraform đóng gói là tệp SINH RA, handler trỏ đúng hàm xuất, mẫu metric filter là chữ `dongLog` in;
//   ⑷ ba alarm gửi ALARM và OK tới CẢ HAI topic, và policy của CẢ HAI topic cho ba alarm ấy publish.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const TF = doc("infra/terraform/60-canh-bao/main.tf");
const NGUON = doc("tools/canh-dang-ky/src/canh-dang-ky.ts");

function khoi(loai: string, ten: string): string {
  const batDau = TF.indexOf(`resource "${loai}" "${ten}" {\n`);
  expect(batDau, `không tìm thấy ${loai}.${ten}`).toBeGreaterThan(-1);
  return TF.slice(batDau, TF.indexOf("\n}\n", batDau) + 2);
}

const ALARM = ["dang_ky_hong", "canh_dang_ky_loi", "canh_dang_ky_khong_chay"] as const;

describe("[ADR-089] canh đăng ký SNS", () => {
  it("⑴ Lambda chỉ có sns:ListSubscriptionsByTopic trên hai topic cảnh báo, và ghi log của chính nó", () => {
    const cs = khoi("aws_iam_role_policy", "canh_dang_ky");
    const hanhDong = [...cs.matchAll(/Action += (\[[^\]]*\]|"[^"]+")/gu)].map((m) => m[1]);
    expect(hanhDong).toEqual(['"sns:ListSubscriptionsByTopic"', '["logs:CreateLogStream", "logs:PutLogEvents"]']);
    expect(cs).toMatch(/Resource = local\.topic_canh_bao\n/u);
    expect(TF).toMatch(/topic_canh_bao += \[aws_sns_topic\.canh_bao_khoa\.arn, aws_sns_topic\.van_hanh\.arn\]/u);
    expect(cs).not.toMatch(/sns:\*|Publish|Subscribe|SetSubscription/u);
  });

  it("⑵ MONG_DOI đọc đúng hai biến người nhận; mọi subscription email của stack đọc từ một trong hai biến ấy", () => {
    const ham = khoi("aws_lambda_function", "canh_dang_ky");
    expect(ham).toContain('{ topic = aws_sns_topic.canh_bao_khoa.arn, bien = "email_canh_bao", nhan = [var.email_canh_bao] }');
    expect(ham).toContain('{ topic = aws_sns_topic.van_hanh.arn, bien = "email_van_hanh", nhan = var.email_van_hanh }');
    const dangKy = [...TF.matchAll(/resource "aws_sns_topic_subscription" "([a-z_]+)" \{/gu)].map((m) => m[1]);
    expect(dangKy.sort()).toEqual(["email", "van_hanh"]);
    expect(khoi("aws_sns_topic_subscription", "email")).toMatch(/endpoint += var\.email_canh_bao\n/u);
    expect(khoi("aws_sns_topic_subscription", "van_hanh")).toMatch(/for_each += toset\(var\.email_van_hanh\)/u);
  });

  it("⑶ Terraform đóng gói tệp Lambda SINH RA; handler trỏ hàm xuất; mẫu metric filter là chữ dongLog in", () => {
    expect(khoi("aws_lambda_function", "canh_dang_ky")).toMatch(/handler += "canh-dang-ky\.handler"/u);
    expect(khoi("aws_lambda_function", "canh_dang_ky")).toMatch(/reserved_concurrent_executions = 1/u);
    expect(TF).toMatch(/source_file = "\$\{path\.module\}\/\.\.\/\.\.\/\.\.\/tools\/canh-dang-ky\/lambda\/canh-dang-ky\.mjs"/u);
    expect(doc("tools/canh-dang-ky/lambda/canh-dang-ky.mjs")).toMatch(/^export async function handler\(/mu);
    expect(khoi("aws_cloudwatch_event_rule", "canh_dang_ky")).toMatch(/schedule_expression = "rate\(6 hours\)"/u);
    const mau = /pattern += "\\"([^"\\]+)\\""/u.exec(khoi("aws_cloudwatch_log_metric_filter", "dang_ky_hong"))?.[1];
    expect(mau).toBe("DANG KY HONG");
    expect(NGUON.match(/ DANG KY HONG: /gu)?.length).toBe(2);
  });

  it("⑷ ba alarm gửi ALARM và OK tới cả hai topic; cả hai topic cho ba alarm publish; 'không chạy' coi thiếu dữ liệu là vi phạm", () => {
    for (const a of ALARM) {
      const k = khoi("aws_cloudwatch_metric_alarm", a);
      expect(k, a).toMatch(/alarm_actions += local\.topic_canh_bao\n/u);
      expect(k, a).toMatch(/ok_actions += local\.topic_canh_bao\n/u);
      for (const topic of ["canh_bao_khoa", "van_hanh"]) {
        expect(khoi("aws_sns_topic_policy", topic), `${topic} ← ${a}`).toContain(`aws_cloudwatch_metric_alarm.${a}.arn`);
      }
    }
    expect(khoi("aws_cloudwatch_metric_alarm", "canh_dang_ky_khong_chay")).toMatch(/treat_missing_data += "breaching"/u);
  });
});
