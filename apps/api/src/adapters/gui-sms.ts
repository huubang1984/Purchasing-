// ==============================================================================================
// apps/api/src/adapters/gui-sms.ts — KÊNH SMS QUA AWS END USER MESSAGING SMS (ADR-069)
//
// Mỗi tin là một `SendTextMessage` (pinpoint-sms-voice-v2) từ ĐÚNG MỘT danh tính gửi (sender ID đã đăng
// ký brandname ở Việt Nam) — IAM của `tp-api` chỉ cho `sms-voice:SendTextMessage` trên danh tính ấy
// (stack Terraform `85-sms-zalo`). Không khoá bí mật nào: quyền đi bằng IAM.
//
// NỘI DUNG KHÔNG DẤU, và đó là một lựa chọn có số: tiếng Việt có dấu buộc mã hoá UCS-2 — 70 ký tự một
// đoạn thay vì 160 của GSM-7 — nên một lời mời mang đường dẫn thành ba đoạn, trả ba lần tiền. Mọi thân tin
// ở đây là ASCII, và test giữ điều ấy. Nhà mạng Việt Nam còn đòi ĐĂNG KÝ MẪU nội dung cho brandname:
// đổi một câu ở đây là đổi một mẫu đã đăng ký (README, stack 85).
//
// Lỗi của dịch vụ đi ra dưới dạng NÉM với lỗi gốc ở `cause`; thông điệp không mang số điện thoại.
// ==============================================================================================

import { SendTextMessageCommand, type SendTextMessageCommandOutput } from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { GuiKenhError, type BoGuiKenhSo } from "./kenh-so.js";

/** Mặt tối thiểu của `PinpointSMSVoiceV2Client` — client thật thoả nó; test tiêm bản giả. */
export interface SmsGuiTin {
  send(lenh: SendTextMessageCommand): Promise<SendTextMessageCommandOutput>;
}

export interface TuyChonGuiSms {
  readonly client: SmsGuiTin;
  /** Sender ID hoặc ARN của nó — `OriginationIdentity`. */
  readonly danhTinhGui: string;
  readonly configurationSet?: string;
}

export function taoBoGuiSms(t: TuyChonGuiSms): BoGuiKenhSo {
  const gui = async (so: string, than: string): Promise<void> => {
    try {
      await t.client.send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: so,
          OriginationIdentity: t.danhTinhGui,
          MessageBody: than,
          MessageType: "TRANSACTIONAL",
          ...(t.configurationSet === undefined ? {} : { ConfigurationSetName: t.configurationSet }),
        }),
      );
    } catch (loi) {
      throw new GuiKenhError("SMS SendTextMessage thất bại", { cause: loi });
    }
  };
  return {
    name: "sms",
    guiOtp: (so, ma) => gui(so, `TrustProcure: ma xac minh ${ma}. Ma chi dung mot lan, het han nhanh. Khong chia se ma nay cho ai.`),
    guiLoiMoi: (so, duongDan) => gui(so, `TrustProcure: ban duoc moi tham gia bao gia. Mo duong dan de xem va nop: ${duongDan}`),
    guiGiaHan: (so, hanMoi) => gui(so, `TrustProcure: han nop bao gia cua loi moi ban nhan da duoc gia han toi ${hanMoi} (UTC).`),
  };
}
