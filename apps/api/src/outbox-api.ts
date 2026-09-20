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
// `issueLoginToken` giữ — job thứ sáu chạy xong mà không gửi gì. ~~At-least-once: một lần gửi hỏng
// làm job thất bại và chạy lại; lần chạy lại phát MỘT token mới (token trước còn hiệu lực tới khi
// hết hạn, chưa từng rời tiến trình) — hạn mức 5/15 phút chặn đường lạm dụng.~~ [sổ nợ 53] Gửi là
// việc SAU COMMIT (xem `SEND_TIMEOUT_MS`): token commit trước, gửi sau, không thử lại.
//
// `KIND_KHONG_NHAN` của apps/unseal-worker liệt kê kind này kèm lý do: worker mở thầu chạy dưới
// `app_unseal`, không đọc được `users`, và cũng không phải nơi giữ bộ gửi.
// ==============================================================================================

import { HE_THONG_MAX_TOKENS_PER_WINDOW, issueLoginToken } from "@trustprocure/identity";
import { getInvitationNoticeTarget } from "@trustprocure/invitation";
import type { JobHandler } from "@trustprocure/outbox";
import { RFQ_DEADLINE_NOTICE_KIND } from "@trustprocure/rfq";
import { UNSEAL_NOTICE_KIND } from "@trustprocure/unseal";
import { coHan } from "./co-han.js";
import type { ApiServices } from "./route-types.js";

export const LOGIN_LINK_SEND_KIND = "LOGIN_LINK_SEND";

/**
 * [review H4-10] Trần RIÊNG cho bộ gửi, ngắn hơn lease của runner (60 s). ~~Phần chênh còn lại,
 * nói ra ở ADR-022 §1: gửi vẫn nằm TRONG giao dịch của job (at-least-once — `send` xong mà kết cục
 * không ghi được ⇒ email đã đi mang token bị rollback, rồi một email thứ hai).~~ [sổ nợ 53 / ADR-023]
 * `send` nay là VIỆC SAU COMMIT: handler phát token trong giao dịch và TRẢ VỀ hàm gửi; runner gọi
 * hàm ấy sau khi token + dấu DONE đã commit, ngoài giao dịch, không giữ kết nối. Link trong email
 * vì thế luôn trỏ tới một token đã tồn tại. Đổi lại: gửi hỏng ⇒ `AFTER_COMMIT_FAILED`, không thử
 * lại (token nằm đó tới hết hạn, chưa từng rời tiến trình; người dùng gọi lại `/auth/link`).
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

export function buildApiOutboxHandlers(
  services: Pick<ApiServices, "loginLinkSender" | "approvalNoticeSender" | "deadlineNoticeSender">,
): Readonly<Record<string, JobHandler>> {
  return {
    [LOGIN_LINK_SEND_KIND]: async (job, client) => {
      const email = docChuoi(job.payload, "email");
      const kq = await issueLoginToken(client, job.orgId, { email });
      // Không có người dùng / bị hạn mức: job xong, không gửi gì — và không ai ngoài sổ biết.
      if (!kq.ok) return;
      return () => coHan(() => services.loginLinkSender.send({ orgId: job.orgId, email: kq.email, token: kq.token }), SEND_TIMEOUT_MS, "BoGuiQuaHan");
    },
    [UNSEAL_NOTICE_KIND]: async (job, client) => {
      const userId = docChuoi(job.payload, "userId");
      const rfqId = docChuoi(job.payload, "rfqId");
      const unsealRequestId = docChuoi(job.payload, "unsealRequestId");
      // Email đọc TỪ HÀNG `users`, không từ payload — cùng kỷ luật H14-6 của `issueLoginToken`.
      const { rows } = await client.query<{ email: string }>(
        `SELECT u.email FROM public.users u
          WHERE u.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
            AND u.status OPERATOR(pg_catalog.=) 'ACTIVE'`,
        [userId],
      );
      const email = rows[0]?.email;
      // Người dùng đã bị vô hiệu hoá giữa lúc xếp việc và lúc chạy: job XONG, không gửi gì.
      if (email === undefined) return;
      // Hạn mức chặn ⇒ tin VẪN đi, chỉ không mang mã. Hợp đồng ở `ApprovalNoticeSender`.
      //
      // [S1.93 / khoản 199] `tranRieng` là cả bản vá của một khoản CAO. Lần phát này do NGƯỜI KHÁC
      // kích hoạt (ai giữ `rfq.unseal` cũng tạo được yêu cầu mở thầu), nên nó không được phép tiêu
      // ngân sách mà chủ hộp thư cần để TỰ vào. Trước vòng này nó tiêu chung, và lượt soi ngang 75
      // tái lập hậu quả trong 3 giây: 5 mã mỗi người duyệt, rồi `/auth/link` của họ trả 200 mà
      // không gửi gì — hai người duyệt bị khoá khỏi hệ thống bởi MỘT người. §S1.93.
      const kq = await issueLoginToken(client, job.orgId, { email, tranRieng: HE_THONG_MAX_TOKENS_PER_WINDOW });
      const token = kq.ok ? kq.token : null;
      const den = kq.ok ? kq.email : email;
      return () =>
        coHan(
          () => services.approvalNoticeSender.send({ orgId: job.orgId, email: den, rfqId, unsealRequestId, token }),
          SEND_TIMEOUT_MS,
          "BoGuiQuaHan",
        );
    },
    [RFQ_DEADLINE_NOTICE_KIND]: async (job, client) => {
      const invitationId = docChuoi(job.payload, "invitationId");
      const newDeadlineAt = docChuoi(job.payload, "newDeadlineAt");
      const dich = await getInvitationNoticeTarget(client, job.orgId, invitationId);
      // Lời mời đã thu hồi, hay không có địa chỉ ở kênh đã chọn: job XONG, không gửi gì.
      if (dich === null) return;
      return () =>
        coHan(
          () =>
            services.deadlineNoticeSender.send({
              orgId: job.orgId,
              invitationId,
              channel: dich.channel,
              destination: dich.destination,
              newDeadlineAt,
            }),
          SEND_TIMEOUT_MS,
          "BoGuiQuaHan",
        );
    },
  };
}
