// [ADR-069] Kênh SMS — đo trên client GIẢ: đúng lệnh, đúng danh tính gửi, TRANSACTIONAL, thân ASCII một đoạn GSM-7.
import { PinpointSMSVoiceV2Client, SendTextMessageCommand, type SendTextMessageCommandOutput } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { describe, expect, it } from "vitest";
import { taoBoGuiSms, type SmsGuiTin } from "./gui-sms.js";
import { GuiKenhError } from "./kenh-so.js";

class SmsGia implements SmsGuiTin {
  readonly lenh: SendTextMessageCommand[] = [];
  constructor(private readonly loi?: Error) {}
  send(lenh: SendTextMessageCommand): Promise<SendTextMessageCommandOutput> {
    this.lenh.push(lenh);
    return this.loi === undefined ? Promise.resolve({ $metadata: {}, MessageId: "m-1" }) : Promise.reject(this.loi);
  }
}

const SO = "+84901234567";

describe("[ADR-069] bộ gửi SMS", () => {
  it("PinpointSMSVoiceV2Client thật thoả mặt tối thiểu (phép kiểm kiểu, không gọi mạng)", () => {
    const c = new PinpointSMSVoiceV2Client({ region: "ap-southeast-1" });
    const s: SmsGuiTin = c;
    expect(s).toBe(c);
    c.destroy();
  });

  it("ba loại tin: đúng đích, danh tính gửi, TRANSACTIONAL, configuration set; thân mang mã/link/hạn", async () => {
    const sms = new SmsGia();
    const g = taoBoGuiSms({ client: sms, danhTinhGui: "TRUSTPROC", configurationSet: "tp-sms" });
    await g.guiOtp(SO, "123456");
    await g.guiLoiMoi(SO, "https://app.vidu.vn/i#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd");
    await g.guiGiaHan(SO, "2026-10-01T10:00:00.000Z");
    expect(sms.lenh).toHaveLength(3);
    for (const l of sms.lenh) {
      expect(l.input.DestinationPhoneNumber).toBe(SO);
      expect(l.input.OriginationIdentity).toBe("TRUSTPROC");
      expect(l.input.MessageType).toBe("TRANSACTIONAL");
      expect(l.input.ConfigurationSetName).toBe("tp-sms");
      const than = l.input.MessageBody ?? "";
      // ASCII in được ⇒ GSM-7, không UCS-2; một đoạn 160 ký tự (lời mời có link dài vẫn trong một đoạn).
      expect(than, than).toMatch(/^[\x20-\x7e]+$/u);
      expect(than.length, than).toBeLessThanOrEqual(160);
    }
    expect(sms.lenh[0]!.input.MessageBody).toContain("123456");
    expect(sms.lenh[1]!.input.MessageBody).toContain("/i#AbCd");
    expect(sms.lenh[2]!.input.MessageBody).toContain("2026-10-01T10:00:00.000Z");
  });

  it("dịch vụ từ chối ⇒ GuiKenhError với lỗi gốc ở cause, thông điệp không mang số", async () => {
    const goc = new Error("ThrottlingException");
    const g = taoBoGuiSms({ client: new SmsGia(goc), danhTinhGui: "TRUSTPROC" });
    const loi = await g.guiOtp(SO, "1").catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(GuiKenhError);
    expect((loi as Error).cause).toBe(goc);
    expect((loi as Error).message).not.toContain("901234567");
  });
});
