// [ADR-065] Năm bộ gửi SES: đúng lệnh, đúng địa chỉ gửi, chỉ kênh EMAIL, đích đơn, thư chữ thuần —
// đo trên một SES GIẢ. Không đo xác minh domain hay IAM thật (stack 80-ses).
import { SendEmailCommand, SESv2Client, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";
import { describe, expect, it } from "vitest";
import { GuiSesError, taoBoGuiSes, type SesGuiThu } from "./gui-ses.js";

class SesGia implements SesGuiThu {
  readonly lenh: SendEmailCommand[] = [];
  constructor(private readonly loi?: Error) {}
  send(lenh: SendEmailCommand): Promise<SendEmailCommandOutput> {
    this.lenh.push(lenh);
    return this.loi === undefined ? Promise.resolve({ $metadata: {}, MessageId: "m-1" }) : Promise.reject(this.loi);
  }
}

const BASE = "https://mua.vidu.vn";
const TU = "noreply@thu.vidu.vn";
const ORG = "11111111-1111-4111-8111-111111111111";

function than(l: SendEmailCommand): string {
  return l.input.Content?.Simple?.Body?.Text?.Data ?? "";
}

describe("[ADR-065] bộ gửi SES của api", () => {
  it("SESv2Client thật thoả mặt tối thiểu (phép kiểm kiểu, không gọi mạng)", () => {
    const c = new SESv2Client({ region: "ap-southeast-1" });
    const s: SesGuiThu = c;
    expect(s).toBe(c);
    c.destroy();
  });

  it("năm bộ gửi: từ đúng địa chỉ, tới đúng một đích, tiêu đề hằng, thân chữ thuần mang đúng link/mã", async () => {
    const ses = new SesGia();
    const g = taoBoGuiSes({ client: ses, tuDiaChi: TU, baseUrl: BASE, configurationSet: "tp-thu" });
    await g.loginLinkSender.send({ orgId: ORG, email: "a@vidu.vn", token: "tok-dang-nhap" });
    await g.invitationLinkSender.send({ orgId: ORG, invitationId: "i1", channel: "EMAIL", destination: "b@vidu.vn", token: "tok-moi" });
    await g.otpSender.send({ channel: "EMAIL", destination: "c@vidu.vn", code: "123456" });
    await g.approvalNoticeSender.send({ orgId: ORG, email: "d@vidu.vn", rfqId: "r1", unsealRequestId: "u1", token: null });
    await g.deadlineNoticeSender.send({ orgId: ORG, invitationId: "i1", channel: "EMAIL", destination: "e@vidu.vn", newDeadlineAt: "2026-10-01T10:00:00Z" });
    expect(ses.lenh).toHaveLength(5);
    for (const l of ses.lenh) {
      expect(l.input.FromEmailAddress).toBe(TU);
      expect(l.input.Destination?.ToAddresses).toHaveLength(1);
      expect(l.input.ConfigurationSetName).toBe("tp-thu");
      expect(l.input.Content?.Simple?.Body?.Html).toBeUndefined();
      expect(l.input.Content?.Simple?.Subject?.Data).toMatch(/^TrustProcure — /u);
    }
    expect(ses.lenh.map((l) => l.input.Destination?.ToAddresses?.[0])).toEqual(["a@vidu.vn", "b@vidu.vn", "c@vidu.vn", "d@vidu.vn", "e@vidu.vn"]);
    expect(than(ses.lenh[0]!)).toContain(`${BASE}/login#tok-dang-nhap`);
    expect(than(ses.lenh[1]!)).toContain(`${BASE}/i#tok-moi`);
    expect(than(ses.lenh[2]!)).toContain("123456");
    expect(than(ses.lenh[3]!)).toContain(`${BASE}/login`);
    expect(than(ses.lenh[3]!)).not.toContain("#");
    expect(than(ses.lenh[4]!)).toContain("2026-10-01T10:00:00Z");
  });

  it("kênh SMS/ZALO_ZNS ⇒ NÉM trước khi gọi SES — không rơi về kênh khác", async () => {
    const ses = new SesGia();
    const g = taoBoGuiSes({ client: ses, tuDiaChi: TU, baseUrl: BASE });
    await expect(g.otpSender.send({ channel: "SMS", destination: "0901234567", code: "1" })).rejects.toThrow(/SMS.*ADR-065/u);
    await expect(
      g.invitationLinkSender.send({ orgId: ORG, invitationId: "i", channel: "ZALO_ZNS", destination: "0901234567", token: "t" }),
    ).rejects.toThrow(GuiSesError);
    await expect(
      g.deadlineNoticeSender.send({ orgId: ORG, invitationId: "i", channel: "SMS", destination: "0901", newDeadlineAt: "x" }),
    ).rejects.toThrow(GuiSesError);
    expect(ses.lenh).toHaveLength(0);
  });

  it("đích không phải MỘT địa chỉ đơn (dấu phẩy, CR/LF, ngoặc nhọn, rỗng) ⇒ NÉM trước khi gọi SES", async () => {
    const ses = new SesGia();
    const g = taoBoGuiSes({ client: ses, tuDiaChi: TU, baseUrl: BASE });
    for (const den of ["a@vidu.vn,b@x.vn", "a@vidu.vn\r\nBcc: x@y.vn", "Ten <a@vidu.vn>", "", "khong-email"]) {
      await expect(g.loginLinkSender.send({ orgId: ORG, email: den, token: "t" })).rejects.toThrow(GuiSesError);
    }
    expect(ses.lenh).toHaveLength(0);
    expect(() => taoBoGuiSes({ client: ses, tuDiaChi: "sai", baseUrl: BASE })).toThrow(GuiSesError);
  });

  it("SES từ chối ⇒ GuiSesError, lỗi gốc ở cause — việc outbox thất bại, không nuốt", async () => {
    const goc = new Error("MessageRejected");
    const g = taoBoGuiSes({ client: new SesGia(goc), tuDiaChi: TU, baseUrl: BASE });
    const loi = await g.loginLinkSender.send({ orgId: ORG, email: "a@vidu.vn", token: "t" }).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(GuiSesError);
    expect((loi as GuiSesError).cause).toBe(goc);
    expect((loi as GuiSesError).message).not.toContain("a@vidu.vn");
  });
});
