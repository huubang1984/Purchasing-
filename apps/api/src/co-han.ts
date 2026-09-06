// ==============================================================================================
// apps/api/src/co-han.ts — TRẦN THỜI GIAN cho việc chạy NGOÀI CSDL (sau commit, KMS)
//
// `statement_timeout` (createPool) huỷ một câu lệnh treo; nó không huỷ một `await` không bao giờ
// giải quyết. Hai chỗ trong `api` có `await` như thế: việc sau commit (gửi mail — review H2-7) và
// hai lời gọi KMS TRONG giao dịch (`wrapTotpSecret` ở `/auth/redeem`, `openTotpSecret` ở
// `/auth/totp` — sổ nợ 38, "cùng dòng"). Một KMS treo giữ kết nối pool tới `idle_in_transaction_
// session_timeout` (60 s) — trần ở đây ngắn hơn nhiều, và lỗi mang TÊN riêng để log đọc được.
// Chúng vẫn chạy trong giao dịch — đó là phần chênh còn lại, nói ra ở ADR-022 §1.
// ==============================================================================================

import type { TotpSecretUnsealer } from "@trustprocure/identity";
import type { ApiServices, TotpSecretWrapper } from "./route-types.js";

export class QuaHanError extends Error {
  constructor(ten: string, thongDiep: string) {
    super(thongDiep);
    this.name = ten;
  }
}

/** `viec()` đua với một đồng hồ; thua thì ném lỗi mang tên `tenLoi` — promise gốc bị bỏ, không đợi. */
export function coHan<T>(viec: () => Promise<T>, ms: number, tenLoi: string): Promise<T> {
  let dongHo: NodeJS.Timeout | undefined;
  const het = new Promise<never>((_ok, hong) => {
    dongHo = setTimeout(() => hong(new QuaHanError(tenLoi, "qua han")), ms);
  });
  return Promise.race([viec(), het]).finally(() => clearTimeout(dongHo));
}

export const KMS_TIMEOUT_MS_MAC_DINH = 5000;

/** Bọc hai adapter KMS của `services` bằng trần thời gian; các trường khác giữ nguyên tham chiếu. */
export function boiTranKms<S extends Pick<ApiServices, "totpSecretWrapper" | "totpSecretUnsealer">>(services: S, ms: number): S {
  const wrapper: TotpSecretWrapper = {
    name: services.totpSecretWrapper.name,
    wrapTotpSecret: (orgId, secret) => coHan(() => services.totpSecretWrapper.wrapTotpSecret(orgId, secret), ms, "KmsQuaHan"),
  };
  const unsealer: TotpSecretUnsealer = {
    kind: "TOTP_SECRET_UNSEALER",
    name: services.totpSecretUnsealer.name,
    openTotpSecret: (orgId, wrapped) => coHan(() => services.totpSecretUnsealer.openTotpSecret(orgId, wrapped), ms, "KmsQuaHan"),
  };
  return { ...services, totpSecretWrapper: wrapper, totpSecretUnsealer: unsealer };
}
