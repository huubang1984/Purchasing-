// ==============================================================================================
// apps/api/src/adapters/hop-thu-dev.ts — HỘP THƯ DEV: ba bộ gửi ghi ra ĐĨA, mỗi tin một tệp
//
// Ba cổng gửi (`LoginLinkSender`, `InvitationLinkSender`, `OtpSender`) phải được TIÊM và không có
// mặc định. Hôm nay kho chưa có một bộ gửi thật nào (SMTP/SES/SMS là hạ tầng chưa có — ADR-009,
// sổ nợ 38), nên tiến trình chạy thật chỉ có MỘT adapter: hộp thư dev — thứ mọi máy phát triển
// cần (đọc link và mã OTP mà không cần mail) và thứ KHÔNG ĐƯỢC chạy ở sản xuất. Hàng rào là
// `assertLocalDevAllowed()` — cùng hàm với ba adapter local-dev kia, không phải một bản chép.
// [review H3-2] Nói cho đúng cơ chế: hàng rào ấy đọc `TRUSTPROCURE_KEY_ADAPTER` (biến của bộ KHOÁ)
// và `NODE_ENV`; từ S1.11, `local-dev` + `NODE_ENV=production` là mâu thuẫn và bị chặn trừ khi có
// `TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS=1` — vì cấu hình của `api` BẮT BUỘC khai `local-dev`, nên trước
// đó mọi cấu hình khởi động được đều mở cửa cho hộp thư này. Một khẳng định dương RIÊNG cho bộ gửi
// (`TRUSTPROCURE_SENDER_ADAPTER` đã có tên) là việc của ngày có bộ gửi thật.
//
// VÌ SAO GHI TỆP, KHÔNG GHI LOG: token đăng nhập, magic link và mã OTP là credential; E6/A2 đòi
// chúng không vào log của tiến trình, và `auth.int.test.ts` đo `console.error` cho đúng điều ấy.
// Hộp thư dev là "hộp thư" — nó nằm ở một thư mục do người vận hành chỉ định (`TRUSTPROCURE_DEV_MAILBOX_DIR`),
// quyền 0700/0600, và không một byte nào của tin đi qua `console`.
//
// Dạng link theo ADR-020 mục 3: token ở FRAGMENT — `/login#<token>` (người mua), `/i#<token>`
// (nhà cung cấp). Trình duyệt không gửi fragment lên máy chủ, không vào log truy cập, không vào
// `Referer`. Mã OTP đi riêng, không kèm link.
// ==============================================================================================

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertLocalDevAllowed } from "@trustprocure/crypto-keys";
import type { InvitationLinkSender, LoginLinkSender, OtpSender } from "../route-types.js";

export interface HopThuDev {
  readonly loginLinkSender: LoginLinkSender;
  readonly invitationLinkSender: InvitationLinkSender;
  readonly otpSender: OtpSender;
}

export interface TuyChonHopThuDev {
  readonly thuMuc: string;
  /** Gốc URL công khai đã kiểm ở `cau-hinh.ts` (không dấu `/` cuối). */
  readonly baseUrl: string;
}

/** Tin trong hộp thư dev — hình dạng đọc được bằng máy, để test và người phát triển cùng đọc một thứ. */
export type TinHopThuDev =
  | { readonly loai: "LOGIN_LINK"; readonly orgId: string; readonly den: string; readonly duongLink: string; readonly luc: string }
  | {
      readonly loai: "INVITATION_LINK";
      readonly orgId: string;
      readonly invitationId: string;
      readonly kenh: string;
      readonly den: string;
      readonly duongLink: string;
      readonly luc: string;
    }
  | { readonly loai: "OTP"; readonly kenh: string; readonly den: string; readonly ma: string; readonly luc: string };

const TEN = "dev-mailbox";

export function taoHopThuDev(tuyChon: TuyChonHopThuDev): HopThuDev {
  assertLocalDevAllowed();
  mkdirSync(tuyChon.thuMuc, { recursive: true, mode: 0o700 });
  // [review H3-3] `mode` của mkdirSync chỉ áp cho thư mục MỚI; một thư mục có sẵn 0755 giữ nguyên 0755.
  // Siết lại tường minh (POSIX; Windows không có mode).
  if (process.platform !== "win32") chmodSync(tuyChon.thuMuc, 0o700);
  // Tên tệp sắp xếp theo THỨ TỰ GỬI kể cả khi hai tin rơi cùng mili-giây: một số thứ tự trong tiến
  // trình đứng trước phần ngẫu nhiên (CI Linux nhanh hơn Windows đủ để ba tin cùng `Date.now()`, và
  // test đọc tệp theo tên đã sort — đỏ ngẫu nhiên ở lượt CI đầu của S1.12).
  let thuTu = 0;
  const ghi = async (tin: TinHopThuDev): Promise<void> => {
    thuTu += 1;
    const tep = join(tuyChon.thuMuc, `${Date.now()}-${String(thuTu).padStart(6, "0")}-${randomBytes(4).toString("hex")}.json`);
    await writeFile(tep, JSON.stringify(tin), { mode: 0o600, flag: "wx" });
  };
  const luc = (): string => new Date().toISOString();
  return {
    loginLinkSender: {
      name: TEN,
      send: (m) => ghi({ loai: "LOGIN_LINK", orgId: m.orgId, den: m.email, duongLink: `${tuyChon.baseUrl}/login#${m.token}`, luc: luc() }),
    },
    invitationLinkSender: {
      name: TEN,
      send: (m) =>
        ghi({
          loai: "INVITATION_LINK",
          orgId: m.orgId,
          invitationId: m.invitationId,
          kenh: m.channel,
          den: m.destination,
          duongLink: `${tuyChon.baseUrl}/i#${m.token}`,
          luc: luc(),
        }),
    },
    otpSender: {
      name: TEN,
      send: (m) => ghi({ loai: "OTP", kenh: m.channel, den: m.destination, ma: m.code, luc: luc() }),
    },
  };
}
