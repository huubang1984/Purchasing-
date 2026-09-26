// ==============================================================================================
// [ADR-077] CẢNH BÁO VẬN HÀNH — MỌI SERVICE, MỌI TARGET GROUP CÓ ALARM, VÀ MỌI ALARM CÓ ĐƯỜNG THƯ
//
// Alarm ở prod (stack 90) chỉ thành thư nhờ stack 60 ⑹ bắt THEO TIỀN TỐ `tp-van-hanh-`. Ba kiểu hỏng im lặng:
//   • thêm một service / target group mới mà quên alarm của nó;
//   • đặt tên alarm lệch tiền tố — alarm kêu mà không ai nhận thư;
//   • đổi tiền tố ở một stack mà không đổi ở stack kia.
// Nên ghim:
//   ⑴ mọi `aws_cloudwatch_metric_alarm` của stack 90 (trừ alarm DNS của ADR-076, có đường riêng ⑸) mang tiền tố;
//   ⑵ tiền tố là MỘT chuỗi ở hai stack; mẫu ⑹ bắt cả ALARM lẫn OK; topic cho rule ⑹ publish; prod chuyển sang audit;
//   ⑶ mọi `aws_ecs_service` có mặt trong `service_van_hanh`, mọi `aws_lb_target_group` có mặt trong `tg_van_hanh`;
//      Container Insights bật (alarm thiếu task đọc metric của nó);
//   ⑷ "không còn target khoẻ" và "thiếu task" coi THIẾU DỮ LIỆU là vi phạm — service biến mất thì metric cũng mất.
// ==============================================================================================

import { readFileSync } from "node:fs";
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

const tenTaiNguyen = (tf: string, loai: string): string[] =>
  [...tf.matchAll(new RegExp(`resource "${loai}" "([a-z0-9_]+)" \\{`, "gu"))].map((m) => m[1] ?? "");

function khoiLocal(ten: string): string {
  const m = new RegExp(`\\n {2}${ten} = (?:\\{|\\[)\\n([\\s\\S]*?)\\n {2}(?:\\}|\\])`, "u").exec(TF90);
  expect(m, `không đọc được local.${ten}`).not.toBeNull();
  return m?.[1] ?? "";
}

describe("[ADR-077] cảnh báo vận hành", () => {
  it("⑴ mọi alarm của stack 90 (trừ DNS ⑸) mang tiền tố tp-van-hanh-", () => {
    const alarm = tenTaiNguyen(TF90, "aws_cloudwatch_metric_alarm");
    expect(alarm.length).toBeGreaterThanOrEqual(8);
    for (const a of alarm) {
      if (a === "dns_bi_chan") continue;
      expect(khoi(TF90, "aws_cloudwatch_metric_alarm", a), a).toMatch(/\n {2}alarm_name += "\$\{local\.tien_to_van_hanh\}/u);
    }
  });

  it("⑵ một tiền tố cho hai stack; ⑹ bắt ALARM và OK; topic cho publish; prod chuyển sang audit", () => {
    const t90 = /\n {2}tien_to_van_hanh = "([^"]+)"/u.exec(TF90)?.[1];
    const t60 = /\n {2}tien_to_van_hanh = "([^"]+)"/u.exec(TF60)?.[1];
    expect(t90).toBe("tp-van-hanh-");
    expect(t60).toBe(t90);
    expect(TF60).toMatch(/alarmName = \[\{ prefix = local\.tien_to_van_hanh \}\]/u);
    expect(TF60).toMatch(/state += \{ value = \["ALARM", "OK"\] \}/u);
    expect(khoi(TF60, "aws_sns_topic_policy", "canh_bao_khoa")).toMatch(/aws_cloudwatch_event_rule\.van_hanh_audit\.arn/u);
    expect(khoi(TF60, "aws_cloudwatch_event_target", "van_hanh_prod")).toMatch(/arn += local\.bus_audit_arn/u);
    expect(khoi(TF60, "aws_cloudwatch_event_target", "van_hanh_audit")).toMatch(/arn += aws_sns_topic\.canh_bao_khoa\.arn/u);
  });

  it("⑶ mọi service ECS và mọi target group đều có alarm; Container Insights bật", () => {
    const service = khoiLocal("service_van_hanh");
    for (const s of tenTaiNguyen(TF90, "aws_ecs_service")) expect(service, s).toMatch(new RegExp(`aws_ecs_service\\.${s}\\.name`, "u"));
    const tg = khoiLocal("tg_van_hanh");
    for (const t of tenTaiNguyen(TF90, "aws_lb_target_group")) expect(tg, t).toMatch(new RegExp(`aws_lb_target_group\\.${t}$`, "mu"));
    expect(khoi(TF90, "aws_ecs_cluster", "tp")).toMatch(/name += "containerInsights"\n {4}value = "enabled"/u);
  });

  it("⑷ hết target khoẻ và thiếu task: thiếu dữ liệu là vi phạm", () => {
    for (const a of ["tg_het_target", "task_thieu"]) {
      expect(khoi(TF90, "aws_cloudwatch_metric_alarm", a), a).toMatch(/treat_missing_data += "breaching"/u);
    }
  });
});
