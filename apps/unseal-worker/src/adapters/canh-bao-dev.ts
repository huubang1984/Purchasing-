// ==============================================================================================
// apps/unseal-worker/src/adapters/canh-bao-dev.ts — CỔNG GỬI CẢNH BÁO BREAK-GLASS, BẢN DEV
//
// `BreakGlassAlertSink` phải được TIÊM và cố ý KHÔNG có mặc định (`composition.ts`): gửi email,
// gọi PagerDuty hay đẩy Slack là quyết định của hạ tầng đích, và một mặc định *"ghi log cho có"*
// là đúng thứ làm người ta tưởng cảnh báo đã tới tay ai đó. Tệp này là bản DEV — thứ một máy phát
// triển cần, và thứ KHÔNG ĐƯỢC chạy ở sản xuất.
//
// Hàng rào là `assertLocalDevAllowed()` — CÙNG HÀM với ba adapter local-dev kia, không phải một
// bản chép (`crypto-keys/moi-truong.ts`: *"hai bản chép của một hàng rào là một bản sẽ trôi"*).
//
// VÌ SAO GHI TỆP, KHÔNG GHI LOG — và vế này KHÁC hộp thư dev của `api`: tin ở đây không mang
// token hay mã OTP, nhưng nó mang `unsealRequestId` và `rfqId` của một lần mở thầu KHẨN CẤP, tức
// nó nói ra rằng một gói thầu cụ thể đang bị mở ngoài quy trình. Đó là tín hiệu điều tra, không
// phải thứ để rải vào log của tiến trình. Thư mục do người vận hành chỉ định
// (`TRUSTPROCURE_ALERT_DIR`), quyền 0700/0600, và KHÔNG một byte nào của tin đi qua `console`.
//
// CỐ Ý KHÔNG mang `reason` của yêu cầu: đó là chỗ chi tiết sự cố nằm, và `composition.ts` đã ghi
// rằng sổ kiểm toán không phải nơi nó rò ra một lần nữa. Cổng gửi cũng không.
//
// `deliver` ĐƯỢC PHÉP NÉM, và phải ném khi ghi hỏng: một lần gửi hỏng phải làm job thất bại và
// được thử lại, chứ không được nuốt. Đó là toàn bộ khác biệt giữa *"cảnh báo bền"* và *"cảnh báo
// đã tới"*.
// ==============================================================================================

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertLocalDevAllowed } from "@trustprocure/crypto-keys";
import type { BreakGlassAlert, BreakGlassAlertSink } from "../composition.js";

/** Hình dạng đọc được bằng máy của một cảnh báo trong thư mục dev. */
export interface TinCanhBaoDev {
  readonly loai: "BREAK_GLASS_UNSEAL_ALERT";
  readonly orgId: string;
  readonly unsealRequestId: string;
  readonly rfqId: string;
  readonly severity: string;
  readonly luc: string;
}

export function taoCanhBaoDev(thuMuc: string): BreakGlassAlertSink {
  assertLocalDevAllowed();
  mkdirSync(thuMuc, { recursive: true, mode: 0o700 });
  // `mkdirSync` bỏ qua `mode` khi thư mục ĐÃ tồn tại — nên đặt lại, cùng khuôn hộp thư dev.
  chmodSync(thuMuc, 0o700);

  return {
    name: "dev-file",
    async deliver(alert: BreakGlassAlert): Promise<void> {
      const tin: TinCanhBaoDev = {
        loai: "BREAK_GLASS_UNSEAL_ALERT",
        orgId: alert.orgId,
        unsealRequestId: alert.unsealRequestId,
        rfqId: alert.rfqId,
        severity: alert.severity,
        luc: new Date().toISOString(),
      };
      // Ghi `.tmp` rồi `rename`: một bộ theo dõi thư mục không bao giờ đọc được nửa tệp.
      const ten = `break-glass-${alert.unsealRequestId}-${randomBytes(6).toString("hex")}.json`;
      const tam = join(thuMuc, `${ten}.tmp`);
      await writeFile(tam, JSON.stringify(tin, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(tam, join(thuMuc, ten));
    },
  };
}
