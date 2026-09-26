// ==============================================================================================
// apps/api/src/adapters/kenh-so.ts — KÊNH SỐ ĐIỆN THOẠI (SMS, ZALO_ZNS): MẶT CHUNG VÀ ĐỊNH TUYẾN (ADR-069)
//
// Ba cổng gửi mang `channel` — lời mời, OTP, thông báo gia hạn — đi tới ĐÚNG adapter của kênh ấy:
// `EMAIL` về bộ gửi thư (SES), `SMS` về AWS End User Messaging, `ZALO_ZNS` về Zalo. Hai cổng không mang
// kênh (link đăng nhập, thông báo duyệt mở thầu) luôn là thư.
//
// Kênh chưa có adapter thì NÉM — cùng quy tắc ⑴ của ADR-065: việc outbox thất bại ồn ào, không rơi về
// một kênh khác. Rơi SMS về email là đúng thứ ADR-015 mục 1 cấm (OTP không đi cùng kênh với magic link).
//
// SỐ ĐIỆN THOẠI: `supplier_contacts.phone` nhận `^\+?[0-9]{8,15}$` (migration 008) — tức `+84…`, `84…`
// hay `0…`. Chuẩn hoá về E.164 ở đây, MỘT chỗ, trước khi bất kỳ adapter nào thấy số:
//   `+<số>`  giữ nguyên;  `0<số>`  là số trong nước VIỆT NAM ⇒ `+84<số>`;  còn lại  ⇒ `+<số>`.
// Số trong nước của nước khác (bắt đầu bằng 0) sẽ bị hiểu SAI thành số Việt Nam — sản phẩm hôm nay chỉ
// phục vụ Việt Nam, và câu này ở đây để người mở rộng sang nước khác thấy nó trước.
// ==============================================================================================

import type { HopThuDev } from "./hop-thu-dev.js";

/** Ba loại tin của một kênh số điện thoại. `soE164` đã chuẩn hoá (`+84…`). */
export interface BoGuiKenhSo {
  readonly name: string;
  guiOtp(soE164: string, ma: string): Promise<void>;
  guiLoiMoi(soE164: string, duongDan: string): Promise<void>;
  guiGiaHan(soE164: string, hanMoi: string): Promise<void>;
}

export class GuiKenhError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GuiKenhError";
  }
}

/** Chuẩn hoá về E.164. Ném khi không phải số — thông điệp KHÔNG mang số (có thể là dữ liệu cá nhân). */
export function chuanHoaE164(so: string): string {
  if (!/^\+?[0-9]{8,15}$/u.test(so)) throw new GuiKenhError("đích không phải một số điện thoại hợp lệ");
  const e164 = so.startsWith("+") ? so : so.startsWith("0") ? `+84${so.slice(1)}` : `+${so}`;
  if (!/^\+[1-9][0-9]{7,14}$/u.test(e164)) throw new GuiKenhError("đích không chuẩn hoá được về E.164");
  return e164;
}

export interface TuyChonTheoKenh {
  /** Bộ gửi thư — nhận mọi tin kênh `EMAIL` và hai cổng không mang kênh. */
  readonly email: HopThuDev;
  readonly sms?: BoGuiKenhSo;
  readonly zalo?: BoGuiKenhSo;
  readonly baseUrl: string;
}

export function taoBoGuiTheoKenh(t: TuyChonTheoKenh): HopThuDev {
  const kenhSo = (kenh: string): BoGuiKenhSo => {
    const b = kenh === "SMS" ? t.sms : kenh === "ZALO_ZNS" ? t.zalo : undefined;
    if (b === undefined) throw new GuiKenhError(`kênh ${kenh} chưa cấu hình adapter gửi (ADR-069)`);
    return b;
  };
  const ten = ["email", ...(t.sms === undefined ? [] : ["sms"]), ...(t.zalo === undefined ? [] : ["zalo"])].join("+");
  return {
    loginLinkSender: t.email.loginLinkSender,
    approvalNoticeSender: t.email.approvalNoticeSender,
    // `async`: kênh chưa bật hay số hỏng phải thành một Promise BỊ TỪ CHỐI như mọi lỗi gửi khác, không phải một
    // lần ném đồng bộ lọt qua người gọi chỉ `.catch()`.
    invitationLinkSender: {
      name: ten,
      send: async (m) => {
        if (m.channel === "EMAIL") return t.email.invitationLinkSender.send(m);
        return kenhSo(m.channel).guiLoiMoi(chuanHoaE164(m.destination), `${t.baseUrl}/i#${m.token}`);
      },
    },
    otpSender: {
      name: ten,
      send: async (m) => {
        if (m.channel === "EMAIL") return t.email.otpSender.send(m);
        return kenhSo(m.channel).guiOtp(chuanHoaE164(m.destination), m.code);
      },
    },
    deadlineNoticeSender: {
      name: ten,
      send: async (m) => {
        if (m.channel === "EMAIL") return t.email.deadlineNoticeSender.send(m);
        return kenhSo(m.channel).guiGiaHan(chuanHoaE164(m.destination), m.newDeadlineAt);
      },
    },
  };
}
