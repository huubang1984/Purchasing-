// ==============================================================================================
// apps/api/src/outbox-api.ts — HANDLER OUTBOX CỦA TIẾN TRÌNH `api` (sổ nợ 38 / review M-1, M-7)
//
// `/auth/link` từng làm hai việc khác nhau cho hai loại email: có người dùng thì INSERT token rồi
// gửi; không thì một SELECT rồi về. Hai đường, hai RTT — một oracle liệt kê email, dù thân phản
// hồi giống hệt. Nay handler HTTP chỉ `enqueueJob(LOGIN_LINK_SEND, { email })` — MỘT INSERT cho
// MỌI email — và toàn bộ việc "email này có người không, phát token, gửi" chuyển vào đây, chạy
// SAU khi phản hồi đã về, dưới `JobRunner` (ADR-010) của chính tiến trình `api`.
//
// Payload mang THAM CHIẾU (email), không mang token (ADR-015 mục 3): token sinh ra ở đây, trong
// giao dịch của job, và đi thẳng tới bộ gửi. Hạn mức theo người dùng (5 token / 15 phút) vẫn do
// `issueLoginToken` giữ — job thứ sáu chạy xong mà không gửi gì. At-least-once: một lần gửi hỏng
// làm job thất bại và chạy lại; lần chạy lại phát MỘT token mới (token trước còn hiệu lực tới khi
// hết hạn, chưa từng rời tiến trình) — hạn mức 5/15 phút chặn đường lạm dụng.
//
// `KIND_KHONG_NHAN` của apps/unseal-worker liệt kê kind này kèm lý do: worker mở thầu chạy dưới
// `app_unseal`, không đọc được `users`, và cũng không phải nơi giữ bộ gửi.
// ==============================================================================================

import { issueLoginToken } from "@trustprocure/identity";
import type { JobHandler } from "@trustprocure/outbox";
import { coHan } from "./co-han.js";
import type { ApiServices } from "./route-types.js";

export const LOGIN_LINK_SEND_KIND = "LOGIN_LINK_SEND";

/**
 * [review H4-10] Trần RIÊNG cho bộ gửi, ngắn hơn lease của runner (60 s): một bộ gửi thật treo giữ
 * một kết nối pool `api` suốt thời gian ấy, và mười job treo là mọi HTTP 500. Phần chênh còn lại,
 * nói ra ở ADR-022 §1: gửi vẫn nằm TRONG giao dịch của job (at-least-once — `send` xong mà kết cục
 * không ghi được ⇒ email đã đi mang token bị rollback, rồi một email thứ hai).
 */
export const SEND_TIMEOUT_MS = 5000;

/** Trần độ dài email đi vào payload — cùng con số `issueLoginToken` chấp nhận. */
export const EMAIL_MAX_BYTES = 320;

function docChuoi(payload: Record<string, unknown>, khoa: string): string {
  const v = payload[khoa];
  if (typeof v !== "string" || v.length === 0 || v.length > EMAIL_MAX_BYTES) {
    throw new Error(`payload thiếu hoặc sai trường "${khoa}"`);
  }
  return v;
}

export function buildApiOutboxHandlers(services: Pick<ApiServices, "loginLinkSender">): Readonly<Record<string, JobHandler>> {
  return {
    [LOGIN_LINK_SEND_KIND]: async (job, client) => {
      const email = docChuoi(job.payload, "email");
      const kq = await issueLoginToken(client, job.orgId, { email });
      // Không có người dùng / bị hạn mức: job xong, không gửi gì — và không ai ngoài sổ biết.
      if (!kq.ok) return;
      await coHan(() => services.loginLinkSender.send({ orgId: job.orgId, email: kq.email, token: kq.token }), SEND_TIMEOUT_MS, "BoGuiQuaHan");
    },
  };
}
