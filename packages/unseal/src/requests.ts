// ==============================================================================================
// VÒNG ĐỜI MỘT YÊU CẦU MỞ THẦU (S1.6) — VÀ RANH GIỚI VỚI TẦNG CSDL
//
// Cùng khuôn ADR-014: *cái gì hỏng IM LẶNG thì xuống CSDL; cái gì hỏng ỒN ÀO thì ở ứng dụng*.
//
//   CSDL (019) giữ — và giữ MỘT MÌNH:
//     * C3 — chỉ yêu cầu mở thầu được khi RFQ đã CLOSED, kiểm ở lúc TẠO chứ không lúc chạy;
//     * D2 — người yêu cầu không tự duyệt, hai phiên khác nhau, đủ số phê duyệt của chính sách;
//     * bảng cạnh của chính yêu cầu, và `EXECUTED` là trạng thái không có cạnh nào đi ra;
//     * D4 — một yêu cầu break-glass sinh cảnh báo NGAY TRONG GIAO DỊCH tạo nó.
//
//   Gói này giữ:
//     * `assertTenantBound` trước mọi thứ;
//     * quyền (`rfq.unseal`, `rfq.unseal.approve`) — thứ CSDL không biết;
//     * cổng chính sách BỐN VẾ của D1 ở `gate.ts`;
//     * dấu vết kiểm toán và thứ tự các câu ghi.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { enqueueJob } from "@trustprocure/outbox";
import { assertUnsealAllowed, type UnsealGateReport } from "./gate.js";

/** `kind` của job mà worker tiêu thụ. Một hằng, một chỗ ở — worker đọc chính nó. */
export const UNSEAL_JOB_KIND = "UNSEAL_RFQ";

export class UnsealError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnsealError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function batBuocUuid(gia: string, ten: string): void {
  if (!UUID_PATTERN.test(gia)) {
    throw new UnsealError(`${ten} phải là UUID hợp lệ, nhận được: "${gia}".`);
  }
}

function batBuocLyDo(ly: string): string {
  const s = ly.trim();
  if (s.length === 0 || Buffer.byteLength(s, "utf8") > 2000) {
    throw new UnsealError("Lý do mở thầu phải khác rỗng và không quá 2000 byte.");
  }
  return s;
}

export interface UnsealRequestRecord {
  readonly id: string;
  readonly rfqId: string;
  readonly status: string;
  readonly breakGlass: boolean;
  readonly requestedBy: string;
}

interface HangYeuCau {
  readonly id: string;
  readonly rfq_id: string;
  readonly status: string;
  readonly break_glass: boolean;
  readonly requested_by: string;
}

const COT = "id, rfq_id, status, break_glass, requested_by";

function doiYeuCau(h: HangYeuCau): UnsealRequestRecord {
  return {
    id: h.id,
    rfqId: h.rfq_id,
    status: h.status,
    breakGlass: h.break_glass,
    requestedBy: h.requested_by,
  };
}

export interface RequestUnsealInput {
  readonly rfqId: string;
  readonly reason: string;
  readonly actorSessionId: string;
  /**
   * [D4] Đường break-glass. Nó KHÔNG phải một cờ "bỏ qua phê duyệt cho nhanh": nó đổi
   * đường đi, và cái giá là một cảnh báo mức cao sinh trong CÙNG giao dịch — bền (outbox) và
   * tức thì (`NOTIFY`), không có đường nào tắt. Xem mục (5) của migration 019.
   */
  readonly breakGlass?: boolean;
}

/** [C3] Tạo một yêu cầu mở thầu. RFQ phải đã CLOSED — và CSDL là lớp nói điều đó. */
export async function requestUnseal(
  client: pg.PoolClient,
  orgId: string,
  input: RequestUnsealInput,
  auditPool: pg.Pool,
): Promise<UnsealRequestRecord> {
  await assertTenantBound(client, orgId, "requestUnseal");
  batBuocUuid(input.rfqId, "rfqId");
  const reason = batBuocLyDo(input.reason);
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_UNSEAL,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  const { rows } = await client.query<HangYeuCau>(
    `INSERT INTO unseal_requests
       (org_id, rfq_id, reason, break_glass, requested_by, requested_by_session_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COT}`,
    [orgId, input.rfqId, reason, input.breakGlass ?? false, actor.id, actor.sessionId],
  );
  const h = rows[0];
  if (h === undefined) throw new UnsealError("Không ghi được yêu cầu mở thầu.");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: h.break_glass ? "UNSEAL_REQUESTED_BREAK_GLASS" : "UNSEAL_REQUESTED",
    resourceType: "unseal_request",
    resourceId: h.id,
    payload: { rfqId: input.rfqId, reason },
  });
  return doiYeuCau(h);
}

export interface ApproveUnsealInput {
  readonly unsealRequestId: string;
  /** [ADR-016] Phiên của chính người duyệt. Trigger 019 đòi nó khớp chủ phiên. */
  readonly actorSessionId: string;
}

/**
 * [D2] Ghi một phê duyệt, rồi chuyển yêu cầu sang `APPROVED` khi đã đủ ngưỡng.
 *
 * `UPDATE ... WHERE status = 'PENDING'` chứ không đọc-rồi-ghi: hai người duyệt đồng thời sẽ có
 * đúng một câu UPDATE thắng, và người thua thấy `rowCount = 0` — không phải một cuộc đua đọc.
 * Trigger `unseal_requests_kiem_du_phe_duyet` là lớp có thẩm quyền cho phép đếm.
 */
export async function approveUnseal(
  client: pg.PoolClient,
  orgId: string,
  input: ApproveUnsealInput,
  auditPool: pg.Pool,
): Promise<UnsealRequestRecord> {
  await assertTenantBound(client, orgId, "approveUnseal");
  batBuocUuid(input.unsealRequestId, "unsealRequestId");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_UNSEAL_APPROVE,
      resourceType: "UNSEAL_REQUEST",
      resourceId: input.unsealRequestId,
    },
    auditPool,
  );

  await client.query(
    `INSERT INTO unseal_approvals
       (org_id, unseal_request_id, approver_user_id, approver_session_id)
     VALUES ($1, $2, $3, $4)`,
    [orgId, input.unsealRequestId, actor.id, actor.sessionId],
  );

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "UNSEAL_APPROVED",
    resourceType: "unseal_request",
    resourceId: input.unsealRequestId,
  });

  // Đủ ngưỡng chưa là câu hỏi của CSDL. Thử chuyển; trigger từ chối nếu chưa đủ, và ca ấy KHÔNG
  // phải lỗi — nó là "còn chờ người thứ hai". Phân biệt bằng cách đếm trước, không bằng bắt lỗi:
  // nuốt một `check_violation` sẽ nuốt cả những lý do khác cùng mã lỗi.
  const { rows: dem } = await client.query<{ can: number; co: string }>(
    `SELECT public.unseal_so_phe_duyet_can(r.rfq_id) AS can,
            (SELECT count(*) FROM unseal_approvals a
              WHERE a.unseal_request_id = r.id AND a.org_id = r.org_id) AS co
       FROM unseal_requests r WHERE r.id = $1`,
    [input.unsealRequestId],
  );
  const d = dem[0];
  if (d !== undefined && Number(d.co) >= d.can) {
    const { rows } = await client.query<HangYeuCau>(
      `UPDATE unseal_requests SET status = 'APPROVED', approved_at = now()
        WHERE id = $1 AND status = 'PENDING' RETURNING ${COT}`,
      [input.unsealRequestId],
    );
    const h = rows[0];
    if (h !== undefined) return doiYeuCau(h);
  }

  const { rows } = await client.query<HangYeuCau>(
    `SELECT ${COT} FROM unseal_requests WHERE id = $1`,
    [input.unsealRequestId],
  );
  const h = rows[0];
  if (h === undefined) throw new UnsealError("Không tìm thấy yêu cầu mở thầu sau khi phê duyệt.");
  return doiYeuCau(h);
}

export interface DispatchUnsealInput {
  readonly unsealRequestId: string;
  readonly actorSessionId: string;
  readonly maxMfaAgeSeconds?: number;
}

/**
 * [D1] Điều phối một yêu cầu ĐÃ ĐƯỢC PHÊ DUYỆT sang worker — và đây là chỗ DUY NHẤT cổng chính
 * sách bốn vế chạy.
 *
 * Hàm này KHÔNG giải mã gì. Nó khẳng định bốn vế rồi đặt một job vào hàng đợi; ADR-006 nói
 * *"`api` không có quyền giải mã và chỉ được YÊU CẦU mở thầu qua hàng đợi"*, và dòng này là câu
 * ấy ở dạng mã.
 */
export async function dispatchUnseal(
  client: pg.PoolClient,
  orgId: string,
  input: DispatchUnsealInput,
  auditPool: pg.Pool,
): Promise<UnsealGateReport> {
  await assertTenantBound(client, orgId, "dispatchUnseal");
  const bangChung = await assertUnsealAllowed(
    client,
    orgId,
    {
      unsealRequestId: input.unsealRequestId,
      actorSessionId: input.actorSessionId,
      ...(input.maxMfaAgeSeconds === undefined ? {} : { maxMfaAgeSeconds: input.maxMfaAgeSeconds }),
    },
    auditPool,
  );

  await enqueueJob(client, orgId, {
    kind: UNSEAL_JOB_KIND,
    payload: { unsealRequestId: bangChung.unsealRequestId, rfqId: bangChung.rfqId },
    dedupeKey: `unseal:${bangChung.unsealRequestId}`,
  });

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: bangChung.userId,
    action: "UNSEAL_DISPATCHED",
    resourceType: "unseal_request",
    resourceId: bangChung.unsealRequestId,
    payload: { rfqId: bangChung.rfqId, clauses: [...bangChung.clauses] },
  });
  return bangChung;
}

export interface CancelUnsealInput {
  readonly unsealRequestId: string;
  readonly actorSessionId: string;
}

/**
 * Huỷ một yêu cầu mở thầu.
 *
 * Đây là đường DUY NHẤT dừng một yêu cầu đã gom phê duyệt, và nó tồn tại vì `unseal_approvals`
 * không cho xoá: rút lại một chữ ký bằng cách xoá dòng sẽ làm sổ kiểm toán nói dối về việc ai đã
 * từng đồng ý.
 */
export async function cancelUnseal(
  client: pg.PoolClient,
  orgId: string,
  input: CancelUnsealInput,
  auditPool: pg.Pool,
): Promise<UnsealRequestRecord> {
  await assertTenantBound(client, orgId, "cancelUnseal");
  batBuocUuid(input.unsealRequestId, "unsealRequestId");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_UNSEAL,
      resourceType: "UNSEAL_REQUEST",
      resourceId: input.unsealRequestId,
    },
    auditPool,
  );

  const { rows } = await client.query<HangYeuCau>(
    `UPDATE unseal_requests SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = $1 AND status IN ('PENDING', 'APPROVED') RETURNING ${COT}`,
    [input.unsealRequestId],
  );
  const h = rows[0];
  if (h === undefined) {
    throw new UnsealError(
      "không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn, hoặc nó không ở trạng thái huỷ được",
    );
  }
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "UNSEAL_CANCELLED",
    resourceType: "unseal_request",
    resourceId: h.id,
  });
  return doiYeuCau(h);
}

export async function getUnsealRequest(
  client: pg.PoolClient,
  orgId: string,
  unsealRequestId: string,
): Promise<UnsealRequestRecord | null> {
  await assertTenantBound(client, orgId, "getUnsealRequest");
  batBuocUuid(unsealRequestId, "unsealRequestId");
  const { rows } = await client.query<HangYeuCau>(
    `SELECT ${COT} FROM unseal_requests WHERE id = $1`,
    [unsealRequestId],
  );
  const h = rows[0];
  return h === undefined ? null : doiYeuCau(h);
}
