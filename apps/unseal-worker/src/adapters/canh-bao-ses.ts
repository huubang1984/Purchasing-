// ==============================================================================================
// apps/unseal-worker/src/adapters/canh-bao-ses.ts — CẢNH BÁO BREAK-GLASS QUA AMAZON SES (ADR-065)
//
// Cài đặt thật của `BreakGlassAlertSink`: mỗi cảnh báo là MỘT `SendEmail` tới danh sách người nhận đã
// cấu hình, từ ĐÚNG MỘT địa chỉ gửi — IAM của `tp-unseal-worker` chỉ cho `ses:SendEmail` với
// `ses:FromAddress` ấy (stack `80-ses`), nên worker không gửi được thư mang danh nghĩa `api`.
//
// `deliver` NÉM khi SES từ chối: hợp đồng của cổng (composition.ts) đòi một lần gửi hỏng làm job
// thất bại và được thử lại — "cảnh báo bền" khác "cảnh báo đã tới" đúng ở đây. Thư chữ thuần, tiêu đề
// hằng; thân chỉ mang MÃ (tổ chức, gói thầu, yêu cầu) — không giá, không tên nhà cung cấp.
// ==============================================================================================

import { SendEmailCommand, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";
import type { BreakGlassAlert, BreakGlassAlertSink } from "../composition.js";

/** Mặt tối thiểu của `SESv2Client` — client thật thoả nó; test tiêm bản giả. */
export interface SesGuiCanhBao {
  send(lenh: SendEmailCommand): Promise<SendEmailCommandOutput>;
}

export interface TuyChonCanhBaoSes {
  readonly client: SesGuiCanhBao;
  readonly tuDiaChi: string;
  /** 1–50 người nhận (giới hạn một lần gửi của SES). */
  readonly denDiaChi: readonly string[];
  readonly configurationSet?: string;
}

export class CanhBaoSesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CanhBaoSesError";
  }
}

const EMAIL = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,253}\.[^\s@,;<>"]{2,63}$/u;

export function taoCanhBaoSes(tuyChon: TuyChonCanhBaoSes): BreakGlassAlertSink {
  if (!EMAIL.test(tuyChon.tuDiaChi)) throw new CanhBaoSesError("địa chỉ gửi SES không hợp lệ");
  if (tuyChon.denDiaChi.length === 0 || tuyChon.denDiaChi.length > 50) {
    throw new CanhBaoSesError("cảnh báo break-glass cần 1–50 người nhận");
  }
  for (const d of tuyChon.denDiaChi) if (!EMAIL.test(d)) throw new CanhBaoSesError("một người nhận cảnh báo không phải email hợp lệ");
  const nguoiNhan = [...tuyChon.denDiaChi];

  return {
    name: "ses",
    async deliver(alert: BreakGlassAlert): Promise<void> {
      const than =
        "MỘT YÊU CẦU MỞ THẦU KHẨN CẤP (BREAK-GLASS) VỪA ĐƯỢC THỰC THI.\n\n" +
        `Mức: ${alert.severity}\nTổ chức: ${alert.orgId}\nGói thầu: ${alert.rfqId}\nYêu cầu mở thầu: ${alert.unsealRequestId}\n\n` +
        "Nếu đây không phải một lần mở khẩn cấp đã được duyệt, kiểm tra ngay sổ kiểm toán và CloudTrail kms:Decrypt.";
      try {
        await tuyChon.client.send(
          new SendEmailCommand({
            FromEmailAddress: tuyChon.tuDiaChi,
            Destination: { ToAddresses: nguoiNhan },
            Content: {
              Simple: {
                Subject: { Data: "[TrustProcure] CẢNH BÁO: mở thầu khẩn cấp (break-glass)", Charset: "UTF-8" },
                Body: { Text: { Data: than, Charset: "UTF-8" } },
              },
            },
            ...(tuyChon.configurationSet === undefined ? {} : { ConfigurationSetName: tuyChon.configurationSet }),
          }),
        );
      } catch (loi) {
        throw new CanhBaoSesError("SES SendEmail cảnh báo break-glass thất bại", { cause: loi });
      }
    },
  };
}
