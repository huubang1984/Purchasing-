// ==============================================================================================
// apps/api/src/co-han.ts — TRẦN THỜI GIAN cho việc chạy NGOÀI CSDL (sau commit, KMS)
//
// `statement_timeout` (createPool) huỷ một câu lệnh treo; nó không huỷ một `await` không bao giờ
// giải quyết. Hai chỗ trong `api` có `await` như thế: việc sau commit (gửi mail — review H2-7) và
// ~~hai~~ ba lời gọi KMS TRONG giao dịch (`wrapTotpSecret` ở `/auth/redeem`, `openTotpSecret` ở
// `/auth/totp` — sổ nợ 38, "cùng dòng"; [review H4-8] và `rfqKeyWrapper.wrap` ở `openRfq`). Một KMS treo giữ kết nối pool tới `idle_in_transaction_
// session_timeout` (60 s) — trần ở đây ngắn hơn nhiều, và lỗi mang TÊN riêng để log đọc được.
// Chúng vẫn chạy trong giao dịch — đó là phần chênh còn lại, nói ra ở ADR-022 §1.
// ==============================================================================================

import type { KeyWrapper } from "@trustprocure/crypto-keys";
import type { TotpSecretUnsealer } from "@trustprocure/identity";
import type { ApiServices, TotpSecretWrapper } from "./route-types.js";

export class QuaHanError extends Error {
  constructor(ten: string, thongDiep: string) {
    super(thongDiep);
    this.name = ten;
  }
}

/**
 * `viec()` đua với một đồng hồ; thua thì ném lỗi mang tên `tenLoi` — promise gốc bị bỏ, không đợi.
 * [review H5-4] `viec()` NÉM ĐỒNG BỘ (một adapter viết `send(m) { if (...) throw ...; }`) cũng phải
 * thành một reject: bản trước gọi `viec()` ngay trong tham số của `Promise.race`, nên ném đồng bộ làm
 * `race` không bao giờ được dựng, đồng hồ không bị dọn, và `het` reject không ai bắt sau `ms` — một
 * `unhandledRejection` giết cả tiến trình `api` vì một lỗi lập trình ở adapter.
 */
export function coHan<T>(viec: () => Promise<T>, ms: number, tenLoi: string): Promise<T> {
  let dongHo: NodeJS.Timeout | undefined;
  const het = new Promise<never>((_ok, hong) => {
    dongHo = setTimeout(() => hong(new QuaHanError(tenLoi, "qua han")), ms);
  });
  return Promise.race([Promise.resolve().then(viec), het]).finally(() => clearTimeout(dongHo));
}

export const KMS_TIMEOUT_MS_MAC_DINH = 5000;

/**
 * Bọc ~~hai~~ BA adapter KMS của `services` bằng trần thời gian; các trường khác giữ nguyên tham chiếu.
 * [review H4-8] `rfqKeyWrapper.wrap` (openRfq) cũng là một lời gọi KMS TRONG giao dịch — cái thứ ba.
 */
export function boiTranKms<S extends Pick<ApiServices, "totpSecretWrapper" | "totpSecretUnsealer" | "rfqKeyWrapper">>(services: S, ms: number): S {
  const rfq: KeyWrapper = {
    name: services.rfqKeyWrapper.name,
    wrap: (orgId, plaintext) => coHan(() => services.rfqKeyWrapper.wrap(orgId, plaintext), ms, "KmsQuaHan"),
  };
  const wrapper: TotpSecretWrapper = {
    name: services.totpSecretWrapper.name,
    wrapTotpSecret: (orgId, secret) => coHan(() => services.totpSecretWrapper.wrapTotpSecret(orgId, secret), ms, "KmsQuaHan"),
  };
  const unsealer: TotpSecretUnsealer = {
    kind: "TOTP_SECRET_UNSEALER",
    name: services.totpSecretUnsealer.name,
    openTotpSecret: (orgId, wrapped) => coHan(() => services.totpSecretUnsealer.openTotpSecret(orgId, wrapped), ms, "KmsQuaHan"),
  };
  return { ...services, rfqKeyWrapper: rfq, totpSecretWrapper: wrapper, totpSecretUnsealer: unsealer };
}
