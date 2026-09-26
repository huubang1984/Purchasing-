// ==============================================================================================
// [ADR-084] CANH MỐC NEO THEO TỪNG TỔ CHỨC — LAMBDA Ở AUDIT, BA ALARM, VÀ HỢP ĐỒNG DÒNG LOG
//
// Phép canh này đứng NGOÀI prod để prod không tắt được nó; nó chỉ còn giá trị khi:
//   ⑴ Lambda chỉ ĐỌC — đúng `s3:ListBucket` dưới `so-kiem-toan/`, không Get/Put/Delete nào;
//   ⑵ tệp Lambda Terraform đóng gói là tệp SINH RA từ nguồn, và handler trỏ đúng tên hàm xuất;
//   ⑶ mẫu metric filter là chữ mà `dongLog` thật sự in;
//   ⑷ có ba đường thư: thiếu mốc, Lambda lỗi, Lambda không chạy (thiếu dữ liệu = vi phạm) — và topic cho cả ba publish.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const TF = doc("infra/terraform/60-canh-bao/main.tf");
const NGUON = doc("tools/neo-so-kiem-toan/src/canh-moc-neo.ts");

function khoi(loai: string, ten: string): string {
  const batDau = TF.indexOf(`resource "${loai}" "${ten}" {\n`);
  expect(batDau, `không tìm thấy ${loai}.${ten}`).toBeGreaterThan(-1);
  return TF.slice(batDau, TF.indexOf("\n}\n", batDau) + 2);
}

describe("[ADR-084] canh mốc neo theo từng tổ chức", () => {
  it("⑴ Lambda chỉ có s3:ListBucket dưới so-kiem-toan/ và ghi log của chính nó", () => {
    const cs = khoi("aws_iam_role_policy", "canh_moc_neo");
    const hanhDong = [...cs.matchAll(/Action += (\[[^\]]*\]|"[^"]+")/gu)].map((m) => m[1]);
    expect(hanhDong).toEqual(['"s3:ListBucket"', '["logs:CreateLogStream", "logs:PutLogEvents"]']);
    expect(cs).toMatch(/"s3:prefix" = \["so-kiem-toan\/", "so-kiem-toan\/\*"\]/u);
    expect(cs).not.toMatch(/s3:\*|GetObject|PutObject|Delete/u);
    expect(TF.match(/aws_iam_role_policy_attachment/gu)).toBeNull();
  });

  it("⑵ Terraform đóng gói tệp Lambda SINH RA; handler trỏ đúng hàm xuất; bucket và ngưỡng từ một chỗ", () => {
    expect(khoi("aws_lambda_function", "canh_moc_neo")).toMatch(/handler += "canh-moc-neo\.handler"/u);
    expect(TF).toMatch(/source_file = "\$\{path\.module\}\/\.\.\/\.\.\/\.\.\/tools\/neo-so-kiem-toan\/lambda\/canh-moc-neo\.mjs"/u);
    expect(doc("tools/neo-so-kiem-toan/lambda/canh-moc-neo.mjs")).toMatch(/^export async function handler\(/mu);
    const ham = khoi("aws_lambda_function", "canh_moc_neo");
    expect(ham).toMatch(/BUCKET_NEO = module\.chung\.bucket\.anchor/u);
    expect(ham).toMatch(/NGUONG_GIO = tostring\(local\.nguong_gio_neo\)/u);
    expect(ham).toMatch(/reserved_concurrent_executions = 1/u);
    expect(khoi("aws_cloudwatch_event_rule", "canh_moc_neo")).toMatch(/schedule_expression = "rate\(6 hours\)"/u);
  });

  it("⑶ mẫu metric filter là chữ dongLog in; tiền tố khoá khớp nơi cất S3", () => {
    const mau = /pattern += "\\"([^"\\]+)\\""/u.exec(khoi("aws_cloudwatch_log_metric_filter", "moc_neo_to_chuc"))?.[1];
    expect(mau).toBe("THIEU MOC NEO");
    expect(NGUON).toContain(`THIEU MOC NEO trong \${String(nguongGio)} gio`);
    expect(NGUON).toMatch(/export const TIEN_TO_SO_NEO = "so-kiem-toan\/";/u);
    expect(doc("tools/neo-so-kiem-toan/src/aws.ts")).toMatch(/const TIEN_TO_SO = "so-kiem-toan";/u);
  });

  it("⑷ ba alarm đều gửi thư ALARM và OK; 'không chạy' coi thiếu dữ liệu là vi phạm; topic cho publish", () => {
    for (const a of ["moc_neo_to_chuc", "canh_moc_neo_loi", "canh_moc_neo_khong_chay"]) {
      const k = khoi("aws_cloudwatch_metric_alarm", a);
      expect(k, a).toMatch(/alarm_actions += \[aws_sns_topic\.canh_bao_khoa\.arn\]/u);
      expect(k, a).toMatch(/ok_actions += \[aws_sns_topic\.canh_bao_khoa\.arn\]/u);
      expect(khoi("aws_sns_topic_policy", "canh_bao_khoa"), a).toContain(`aws_cloudwatch_metric_alarm.${a}.arn`);
    }
    expect(khoi("aws_cloudwatch_metric_alarm", "canh_moc_neo_khong_chay")).toMatch(/treat_missing_data += "breaching"/u);
  });
});
