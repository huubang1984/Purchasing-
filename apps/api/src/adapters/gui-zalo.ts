// ==============================================================================================
// apps/api/src/adapters/gui-zalo.ts — KÊNH ZALO ZNS (ADR-069)
//
// Gửi một tin ZNS = `POST https://business.openapi.zalo.me/message/template` với header `access_token`, thân
// `{ phone: "84…", template_id, template_data }`. Mỗi loại tin một template do Zalo duyệt TRƯỚC; tên tham
// số của template là hợp đồng giữa tệp này và người tạo template (README, stack 85):
//   OTP       `otp`        · lời mời  `duong_dan`   · gia hạn  `han_nop`
//
// TOKEN — phần khó của kênh này, và lý do nó có một KHO:
//   • access token sống ~25 giờ; refresh token sống ~3 tháng và DÙNG MỘT LẦN — mỗi lần làm mới trả về
//     một refresh token MỚI, cái cũ chết. Mất bản mới là mất quyền gửi của OA tới khi người vận hành cấp lại.
//   • Nên: đọc kho TRƯỚC khi làm mới (một task khác có thể vừa xoay), GHI kho NGAY sau khi làm mới và trước
//     khi dùng; làm mới thất bại thì đọc kho lần nữa — nếu refresh token trong kho đã khác cái mình vừa dùng,
//     một task khác đã thắng cuộc đua và token của nó dùng được.
//   • Trong một tiến trình, làm mới là single-flight: mười lần gửi cùng lúc chung một lời gọi làm mới.
//   • Hai task cùng làm mới ĐÚNG cùng lúc vẫn có thể giẫm nhau (Zalo không có phép so-và-đổi). Mặc định
//     `so_ban_api = 1`, và làm mới sớm 10 phút trước hạn thu hẹp cửa sổ — rủi ro còn lại ghi ở ADR-069.
//
// Không ghi log. Lỗi mang mã lỗi của Zalo và mã HTTP, không mang số điện thoại, token hay thân phản hồi.
// Lỗi MẤT refresh token có TÊN riêng (`ZaloTokenMatError`) vì bộ điều phối sau commit chỉ ghi tên lỗi.
// Đường dẫn API và hình dạng phản hồi theo tài liệu công khai của Zalo — CHƯA gọi thật từ kho này.
// ==============================================================================================

import { GuiKenhError, type BoGuiKenhSo } from "./kenh-so.js";

export interface TokenZalo {
  readonly appId: string;
  readonly secretKey: string;
  /** Rỗng = chưa có (lần đầu người vận hành chỉ nạp refresh token). */
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Mốc hết hạn của access token, epoch ms. */
  readonly hetHanLuc: number;
}

/** Nơi giữ token giữa các lần khởi động và giữa các task — Secrets Manager ở prod (`kho-token-zalo.ts`). */
export interface KhoTokenZalo {
  doc(): Promise<TokenZalo>;
  ghi(t: TokenZalo): Promise<void>;
}

/** ID template ZNS đã duyệt cho từng loại tin. */
export interface MauZns {
  readonly otp: string;
  readonly loiMoi: string;
  readonly giaHan: string;
}

export interface TuyChonGuiZalo {
  readonly kho: KhoTokenZalo;
  readonly mau: MauZns;
  readonly fetch?: typeof fetch;
  readonly bayGio?: () => number;
  /** Trần mỗi lời gọi HTTP. */
  readonly tranMs?: number;
}

export class ZaloTokenMatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZaloTokenMatError";
  }
}

export const URL_GUI_ZNS = "https://business.openapi.zalo.me/message/template";
export const URL_TOKEN_ZALO = "https://oauth.zaloapp.com/v4/oa/access_token";
const LAM_MOI_TRUOC_MS = 10 * 60_000;
const TRAN_MAC_DINH_MS = 10_000;

async function docJson(ph: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const v: unknown = await ph.json();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Chỉ mã số — không một chuỗi nào từ phản hồi đi vào thông điệp lỗi. */
function maLoi(ph: Response, than: Record<string, unknown> | undefined): string {
  const ma = than?.error;
  return `HTTP ${ph.status}${typeof ma === "number" ? `, error ${ma}` : ""}`;
}

export function taoBoGuiZalo(t: TuyChonGuiZalo): BoGuiKenhSo {
  const goi = t.fetch ?? fetch;
  const bayGio = t.bayGio ?? Date.now;
  const tranMs = t.tranMs ?? TRAN_MAC_DINH_MS;
  let token: TokenZalo | undefined;
  let dangLamMoi: Promise<TokenZalo> | undefined;

  const conHan = (x: TokenZalo): boolean => x.accessToken !== "" && x.hetHanLuc - bayGio() > LAM_MOI_TRUOC_MS;

  async function lamMoi(): Promise<TokenZalo> {
    const hienTai = await t.kho.doc();
    if (conHan(hienTai)) return hienTai;
    let ph: Response;
    try {
      ph = await goi(URL_TOKEN_ZALO, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", secret_key: hienTai.secretKey },
        body: new URLSearchParams({ app_id: hienTai.appId, refresh_token: hienTai.refreshToken, grant_type: "refresh_token" }).toString(),
        signal: AbortSignal.timeout(tranMs),
      });
    } catch (loi) {
      throw new GuiKenhError("Zalo: không gọi được máy chủ cấp token", { cause: loi });
    }
    const than = await docJson(ph);
    const access = than?.access_token;
    const refresh = than?.refresh_token;
    const giay = Number(than?.expires_in);
    if (!ph.ok || typeof access !== "string" || access === "" || typeof refresh !== "string" || refresh === "" || !(giay > 0)) {
      const lai = await t.kho.doc();
      if (lai.refreshToken !== hienTai.refreshToken && conHan(lai)) return lai;
      throw new GuiKenhError(`Zalo: làm mới token thất bại (${maLoi(ph, than)})`);
    }
    const moi: TokenZalo = { ...hienTai, accessToken: access, refreshToken: refresh, hetHanLuc: bayGio() + giay * 1000 };
    try {
      await t.kho.ghi(moi);
    } catch (loi) {
      // Refresh token cũ đã chết. Giữ bản mới trong bộ nhớ để tiến trình này còn gửi được tới hết hạn access
      // token — nhưng kho đã lạc hậu, và lần khởi động sau sẽ không làm mới được.
      token = moi;
      throw new ZaloTokenMatError("Zalo: đã xoay token nhưng KHÔNG ghi được vào kho — phải cấp lại refresh token", { cause: loi });
    }
    return moi;
  }

  async function layToken(): Promise<TokenZalo> {
    if (token !== undefined && conHan(token)) return token;
    dangLamMoi ??= lamMoi().finally(() => {
      dangLamMoi = undefined;
    });
    token = await dangLamMoi;
    return token;
  }

  async function gui(soE164: string, templateId: string, data: Readonly<Record<string, string>>): Promise<void> {
    if (!soE164.startsWith("+84")) throw new GuiKenhError("Zalo ZNS chỉ gửi tới số Việt Nam (+84)");
    const tk = await layToken();
    let ph: Response;
    try {
      ph = await goi(URL_GUI_ZNS, {
        method: "POST",
        headers: { "content-type": "application/json", access_token: tk.accessToken },
        body: JSON.stringify({ phone: soE164.slice(1), template_id: templateId, template_data: data }),
        signal: AbortSignal.timeout(tranMs),
      });
    } catch (loi) {
      throw new GuiKenhError("Zalo: không gọi được API ZNS", { cause: loi });
    }
    const than = await docJson(ph);
    if (!ph.ok || than?.error !== 0) {
      // Token có thể đã bị thu hồi trước hạn: lần gửi sau đọc lại kho thay vì tin bộ nhớ.
      token = undefined;
      throw new GuiKenhError(`Zalo ZNS từ chối (${maLoi(ph, than)})`);
    }
  }

  return {
    name: "zalo-zns",
    guiOtp: (so, ma) => gui(so, t.mau.otp, { otp: ma }),
    guiLoiMoi: (so, duongDan) => gui(so, t.mau.loiMoi, { duong_dan: duongDan }),
    guiGiaHan: (so, hanMoi) => gui(so, t.mau.giaHan, { han_nop: hanMoi }),
  };
}
