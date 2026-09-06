// ==============================================================================================
// [khoản nợ 34] NƠI HAI `kind` CÓ NGƯỜI NHẬN — VÀ NƠI MỘT LẦN HỎNG THÔI IM LẶNG
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// `019` sinh một cảnh báo `BREAK_GLASS_UNSEAL_ALERT` trong CÙNG giao dịch tạo một yêu cầu
// break-glass — bền, và kèm `pg_notify` để tức thì. Cả hai vế ấy đã được đo.
//
// Thứ KHÔNG được đo, và review an ninh S1.6 (HIGH-2b) chỉ ra: **không ai tiêu thụ nó.** `grep`
// toàn kho cho `BREAK_GLASS_UNSEAL_ALERT` ra đúng hai chỗ — chính migration và một test. Và tệ
// hơn *"chưa nối"*: `JobRunner` ghi một job KHÔNG CÓ HANDLER thẳng sang `FAILED` với lý do
// `NO_HANDLER`, còn `onJobFailure` thì **mặc định im lặng**. Nên hôm nay cảnh báo mức cao được
// tạo ra rồi bị đánh dấu chết, không một tiếng động.
//
// D4 nói *"không bao giờ im lặng"*. Vế ấy đúng ở tầng SINH và sai ở tầng GIAO.
//
// ----------------------------------------------------------------------------------------------
// BA THỨ FILE NÀY LÀM, VÀ MỘT THỨ NÓ CỐ Ý KHÔNG LÀM
// ----------------------------------------------------------------------------------------------
//   ✔ đăng ký handler cho `UNSEAL_RFQ` và `BREAK_GLASS_UNSEAL_ALERT`;
//   ✔ ép `onJobFailure` thành THAM SỐ BẮT BUỘC — một composition root không nuốt lỗi được nữa;
//   ✔ bắt mọi `kind` mới phải được QUYẾT ĐỊNH, không được rơi vào im lặng (xem `KIND_KHONG_NHAN`).
//
//   ✘ **KHÔNG** tự chọn cách gửi. `BreakGlassAlertSink` là một cổng phải TIÊM vào: gửi email,
//     gọi PagerDuty, hay đẩy Slack là quyết định của hạ tầng đích, và một mặc định "ghi log cho
//     có" ở đây sẽ đúng thứ làm người ta tưởng cảnh báo đã tới tay ai đó.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent } from "@trustprocure/audit";
import { JobRunner, type JobFailureReport, type JobHandler } from "@trustprocure/outbox";
import type { KeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";
import { executeUnsealRequest } from "./index.js";

/** `kind` của cảnh báo break-glass. Một hằng, một chỗ ở — 019 mục (5) là bên còn lại. */
export const BREAK_GLASS_ALERT_KIND = "BREAK_GLASS_UNSEAL_ALERT";
/** `kind` của job mở thầu. Bản sao đọc-được của `UNSEAL_JOB_KIND` ở `@trustprocure/unseal`. */
export const UNSEAL_JOB_KIND = "UNSEAL_RFQ";

/**
 * Các `kind` mà worker này CỐ Ý không nhận — và mỗi dòng là một quyết định, không phải một lần
 * quên.
 *
 * Danh sách tồn tại để lớp canh ở `composition.int.test.ts` có hai lựa chọn thay vì một: mỗi
 * `kind` được enqueue ở đâu đó trong kho phải HOẶC có handler ở đây, HOẶC nằm ở đây kèm lý do.
 * Một `kind` thứ ba ra đời mà không ai quyết định sẽ làm test ấy ĐỎ.
 */
export const KIND_KHONG_NHAN: Readonly<Record<string, string>> = {
  // Thông báo gia hạn hạn nộp đi TỚI NHÀ CUNG CẤP, qua email hoặc SMS. Tiến trình này chạy dưới
  // `app_unseal` — role KHÔNG đọc được `supplier_contacts`, tức nó không biết gửi tới đâu, và
  // việc cấp thêm quyền ấy sẽ mở đúng thứ ADR-006 dựng cả một role riêng để đóng.
  RFQ_DEADLINE_EXTENDED_NOTICE: "đường thông báo nhà cung cấp — thuộc app gửi, không thuộc worker",
};

export interface BreakGlassAlert {
  readonly orgId: string;
  readonly unsealRequestId: string;
  readonly rfqId: string;
  readonly severity: string;
}

/**
 * Cổng GỬI cảnh báo. Phải tiêm vào; không có mặc định.
 *
 * `deliver` được phép NÉM: một lần gửi hỏng phải làm job thất bại và được thử lại, chứ không
 * được nuốt. Đó là toàn bộ khác biệt giữa *"cảnh báo bền"* và *"cảnh báo đã tới"*.
 */
export interface BreakGlassAlertSink {
  /** Tên adapter, để bản ghi kiểm toán nói được cảnh báo đã đi đường nào. */
  readonly name: string;
  deliver(alert: BreakGlassAlert): Promise<void>;
}

export interface UnsealWorkerDeps {
  readonly unwrapper: KeyUnwrapper;
  readonly alertSink: BreakGlassAlertSink;
  /**
   * BẮT BUỘC, và đó là điểm của khoản nợ 34.
   *
   * `JobRunnerOptions.onJobFailure` là TUỲ CHỌN và mặc định IM LẶNG — hợp lý cho một thư viện
   * hàng đợi, tai hại cho tiến trình duy nhất giữ khả năng giải mã. Ở đây nó không tuỳ chọn được.
   *
   * [CẤM LOG] `report.cause` là lỗi GỐC do handler ném và nó CÓ THỂ mang giá hoặc bản rõ —
   * `runner.ts` ghi rõ điều đó. Người cài đặt hàm này chịu trách nhiệm khử nhạy cảm.
   */
  readonly onJobFailure: (report: JobFailureReport) => void;
}

function docChuoi(payload: Record<string, unknown>, khoa: string): string {
  const v = payload[khoa];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`payload thiếu trường "${khoa}"`);
  }
  return v;
}

/**
 * Bảng handler của worker. Tách khỏi `createUnsealWorkerRunner` để test đọc được TẬP `kind` mà
 * không phải dựng một pool.
 */
export function buildUnsealWorkerHandlers(
  deps: UnsealWorkerDeps,
): Readonly<Record<string, JobHandler>> {
  return {
    [UNSEAL_JOB_KIND]: async (job, client) => {
      await executeUnsealRequest(client, job.orgId, {
        unsealRequestId: docChuoi(job.payload, "unsealRequestId"),
        unwrapper: deps.unwrapper,
      });
    },
    [BREAK_GLASS_ALERT_KIND]: async (job, client) => {
      const alert: BreakGlassAlert = {
        orgId: job.orgId,
        unsealRequestId: docChuoi(job.payload, "unsealRequestId"),
        rfqId: docChuoi(job.payload, "rfqId"),
        severity: typeof job.payload["severity"] === "string" ? job.payload["severity"] : "HIGH",
      };
      // GỬI TRƯỚC, GHI SỔ SAU, và thứ tự ấy là load-bearing: một bản ghi
      // `BREAK_GLASS_ALERT_DELIVERED` ghi trước lúc gửi là một bản ghi nói dối nếu lần gửi hỏng.
      // Cái giá của thứ tự này được ghi ra: gửi xong mà giao dịch rollback thì job chạy lại và
      // cảnh báo được gửi HAI LẦN. Với một cảnh báo mức cao, gửi thừa tốt hơn gửi thiếu.
      await deps.alertSink.deliver(alert);
      await appendAuditEvent(client, job.orgId, {
        actorType: "SERVICE",
        actorId: null,
        action: "BREAK_GLASS_ALERT_DELIVERED",
        resourceType: "UNSEAL_REQUEST",
        resourceId: alert.unsealRequestId,
        // KHÔNG mang `reason` của yêu cầu: đó là chỗ chi tiết sự cố nằm, và sổ kiểm toán không
        // phải nơi nó rò ra một lần nữa.
        payload: { kenh: deps.alertSink.name, severity: alert.severity },
      });
    },
  };
}

/**
 * Dựng runner của worker mở thầu.
 *
 * `pool` PHẢI là pool của role `app_unseal`: `executeUnsealRequest` mở bọc khoá và ghi bản rõ,
 * và cả hai là quyền mà chỉ role ấy có. Một pool `app_api` truyền vào đây hỏng ỒN ÀO với
 * `permission denied` — không âm thầm.
 */
export function createUnsealWorkerRunner(
  pool: pg.Pool,
  deps: UnsealWorkerDeps,
  options: { readonly pollIntervalMs?: number; readonly maxAttempts?: number } = {},
): JobRunner {
  return new JobRunner(pool, buildUnsealWorkerHandlers(deps), {
    ...options,
    onJobFailure: deps.onJobFailure,
  });
}
