// ==============================================================================================
// [ADR-075] HEADER BẢO MẬT Ở ALB — BỐN DÒNG TRONG MỘT TỆP TERRAFORM, KHÔNG CÓ LỚP NÀO KHÁC ĐO CHÚNG
//
// HSTS chỉ ALB đặt được cho MỌI phản hồi (kể cả 502/503 do chính ALB sinh). Một lần "dọn" listener làm rơi dòng ấy
// thì không test ứng dụng nào đỏ — nên ghim ở đây:
//   ⑴ listener HTTPS mang đủ bốn thuộc tính với đúng giá trị ADR-075 chọn;
//   ⑵ KHÔNG có CSP ở ALB (ALB ghi đè header cùng tên của target — CSP chi tiết của web sẽ mất);
//   ⑶ X-Frame-Options DENY nói cùng một điều với `frame-ancestors 'none'` của web; nosniff trùng giá trị app đặt;
//   ⑷ listener HTTP chỉ chuyển hướng 301 sang HTTPS — không phục vụ gì qua kênh không có HSTS.
// Đọc bằng regex như `hinh-dang-deploy.test.ts` — cái giá (bám cách viết) là chủ đích.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const TF = doc("infra/terraform/90-ecs/main.tf");

function khoi(loai: string, ten: string): string {
  const batDau = TF.indexOf(`resource "${loai}" "${ten}" {\n`);
  expect(batDau, `không tìm thấy ${loai}.${ten}`).toBeGreaterThan(-1);
  const ketThuc = TF.indexOf("\n}\n", batDau);
  return TF.slice(batDau, ketThuc + 2);
}

describe("[ADR-075] header bảo mật ở ALB", () => {
  const https = khoi("aws_lb_listener", "https");

  it("⑴ listener HTTPS đặt HSTS 1 năm + includeSubDomains (không preload), nosniff, DENY, tắt Server", () => {
    expect(https).toMatch(
      /\n {2}routing_http_response_strict_transport_security_header_value += "max-age=31536000; includeSubDomains"\n/u,
    );
    expect(https).not.toMatch(/preload/u);
    expect(https).toMatch(/\n {2}routing_http_response_x_content_type_options_header_value += "nosniff"\n/u);
    expect(https).toMatch(/\n {2}routing_http_response_x_frame_options_header_value += "DENY"\n/u);
    expect(https).toMatch(/\n {2}routing_http_response_server_enabled += false\n/u);
  });

  it("⑵ không listener nào đặt CSP hay CORS ở ALB", () => {
    expect(TF).not.toMatch(/routing_http_response_content_security_policy_header_value/u);
    expect(TF).not.toMatch(/routing_http_response_access_control_/u);
  });

  it("⑶ ALB và app nói cùng một điều", () => {
    const web = doc("apps/web/src/phuc-vu.ts");
    const api = doc("apps/api/src/server.ts");
    expect(web).toMatch(/"frame-ancestors 'none'"/u);
    expect(web).toMatch(/"x-content-type-options": "nosniff"/u);
    expect(api).toMatch(/"x-content-type-options": "nosniff"/u);
  });

  it("⑷ listener HTTP chỉ chuyển hướng 301 sang HTTPS", () => {
    const http = khoi("aws_lb_listener", "http");
    expect(http).toMatch(/\n {2}port += 80\n/u);
    expect(http).toMatch(/type = "redirect"/u);
    expect(http).toMatch(/protocol += "HTTPS"/u);
    expect(http).toMatch(/status_code = "HTTP_301"/u);
    expect(http).not.toMatch(/forward|fixed-response/u);
    expect([...TF.matchAll(/resource "aws_lb_listener" "/gu)]).toHaveLength(2);
  });
});
