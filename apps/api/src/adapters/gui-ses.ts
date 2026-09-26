// ==============================================================================================
// apps/api/src/adapters/gui-ses.ts — NĂM BỘ GỬI CỦA `api` QUA AMAZON SES (ADR-065)
//
// Cài đặt thật của năm cổng gửi mà hộp thư dev (`hop-thu-dev.ts`) đứng thay: link đăng nhập, link mời
// thầu, mã OTP, thông báo duyệt mở thầu, thông báo gia hạn. Mỗi tin là một `SendEmail` của SESv2 từ
// ĐÚNG MỘT địa chỉ gửi đã cấu hình — IAM của `tp-api` chỉ cho `ses:SendEmail` với `ses:FromAddress`
// ấy (stack Terraform `80-ses`).
//
// BA QUYẾT ĐỊNH, mỗi cái có test:
//   ⑴ CHỈ KÊNH EMAIL. Liên hệ khai kênh SMS hay ZALO_ZNS thì bộ gửi NÉM — việc outbox thất bại ồn ào,
//      không rơi về hộp thư dev, không gửi nhầm sang một kênh khác. SMS/Zalo là một lát cắt riêng.
//   ⑵ THƯ CHỮ THUẦN, không HTML: nội dung có token và mã, và một thân HTML là một bề mặt tiêm mà thư
//      này không cần. Tiêu đề là HẰNG — không một byte đầu vào nào đi vào dòng tiêu đề.
//   ⑶ ĐÍCH phải là một địa chỉ email đơn, không CR/LF, không dấu phẩy — một đích mang hai địa chỉ là
//      một lần gửi token cho người thứ hai. Kiểm ở đây, trước khi gọi SES.
//
// Lỗi của SES đi ra dưới dạng NÉM với lỗi gốc ở `cause` — bộ điều phối sau commit ghi TÊN lỗi, không
// ghi thông điệp (có thể mang địa chỉ). Không chỗ nào trong tệp này ghi log.
// ==============================================================================================

import { SendEmailCommand, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";
import type { HopThuDev } from "./hop-thu-dev.js";

/** Mặt tối thiểu của `SESv2Client` mà adapter cần — client thật thoả nó; test tiêm bản giả. */
export interface SesGuiThu {
  send(lenh: SendEmailCommand): Promise<SendEmailCommandOutput>;
}

export interface TuyChonGuiSes {
  readonly client: SesGuiThu;
  /** Địa chỉ gửi đã xác minh ở SES, vd `noreply@<domain>`. */
  readonly tuDiaChi: string;
  /** Gốc URL công khai đã kiểm ở `cau-hinh.ts` (không dấu `/` cuối). */
  readonly baseUrl: string;
  /** Configuration set của SES (theo dõi bounce/complaint). Tuỳ chọn. */
  readonly configurationSet?: string;
}

export class GuiSesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GuiSesError";
  }
}

const TEN = "ses";
// Một địa chỉ đơn: không khoảng trắng, không CR/LF, không dấu phẩy/chấm phẩy/ngoặc nhọn.
const EMAIL = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,253}\.[^\s@,;<>"]{2,63}$/u;

export function laDiaChiEmail(s: string): boolean {
  return s.length <= 320 && EMAIL.test(s);
}

export function taoBoGuiSes(tuyChon: TuyChonGuiSes): HopThuDev {
  if (!laDiaChiEmail(tuyChon.tuDiaChi)) throw new GuiSesError("địa chỉ gửi SES không hợp lệ");

  const gui = async (den: string, tieuDe: string, than: string): Promise<void> => {
    if (!laDiaChiEmail(den)) throw new GuiSesError("đích không phải một địa chỉ email đơn hợp lệ");
    try {
      await tuyChon.client.send(
        new SendEmailCommand({
          FromEmailAddress: tuyChon.tuDiaChi,
          Destination: { ToAddresses: [den] },
          Content: {
            Simple: {
              Subject: { Data: tieuDe, Charset: "UTF-8" },
              Body: { Text: { Data: than, Charset: "UTF-8" } },
            },
          },
          ...(tuyChon.configurationSet === undefined ? {} : { ConfigurationSetName: tuyChon.configurationSet }),
        }),
      );
    } catch (loi) {
      throw new GuiSesError("SES SendEmail thất bại", { cause: loi });
    }
  };

  const chiEmail = (kenh: string): void => {
    if (kenh !== "EMAIL") {
      throw new GuiSesError(`kênh ${kenh} chưa có adapter gửi thật — bộ gửi SES chỉ gửi EMAIL (ADR-065)`);
    }
  };

  const CHAN =
    "\n\nThư này được gửi tự động từ TrustProcure. Không trả lời thư này. " +
    "Nếu bạn không yêu cầu, hãy bỏ qua — không chia sẻ đường dẫn hay mã cho bất kỳ ai.";

  return {
    loginLinkSender: {
      name: TEN,
      send: (m) =>
        gui(
          m.email,
          "TrustProcure — đường dẫn đăng nhập",
          `Đường dẫn đăng nhập của bạn (dùng một lần, có hạn):\n${tuyChon.baseUrl}/login#${m.token}${CHAN}`,
        ),
    },
    invitationLinkSender: {
      name: TEN,
      send: async (m) => {
        chiEmail(m.channel);
        await gui(
          m.destination,
          "TrustProcure — lời mời tham gia báo giá",
          `Bạn được mời tham gia một gói báo giá trên TrustProcure.\n` +
            `Mở đường dẫn sau để xem lời mời và nộp báo giá:\n${tuyChon.baseUrl}/i#${m.token}${CHAN}`,
        );
      },
    },
    otpSender: {
      name: TEN,
      send: async (m) => {
        chiEmail(m.channel);
        await gui(m.destination, "TrustProcure — mã xác minh", `Mã xác minh của bạn: ${m.code}\nMã có hạn ngắn và chỉ dùng một lần.${CHAN}`);
      },
    },
    approvalNoticeSender: {
      name: TEN,
      send: (m) =>
        gui(
          m.email,
          "TrustProcure — yêu cầu duyệt mở thầu",
          `Có một yêu cầu mở thầu cần bạn duyệt (gói ${m.rfqId}, yêu cầu ${m.unsealRequestId}).\n` +
            (m.token === null
              ? `Hãy đăng nhập TrustProcure để duyệt: ${tuyChon.baseUrl}/login`
              : `Đăng nhập để duyệt:\n${tuyChon.baseUrl}/login#${m.token}`) +
            CHAN,
        ),
    },
    deadlineNoticeSender: {
      name: TEN,
      send: async (m) => {
        chiEmail(m.channel);
        await gui(
          m.destination,
          "TrustProcure — hạn nộp báo giá đã được gia hạn",
          `Hạn nộp báo giá của lời mời bạn đã nhận được gia hạn tới ${m.newDeadlineAt} (UTC).${CHAN}`,
        );
      },
    },
  };
}
