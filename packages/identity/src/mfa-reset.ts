// ==============================================================================================
// [sổ nợ 40 / migration 040 / ADR-022 §3] ĐẶT LẠI TOTP — hai người, hồ sơ bị XOÁ
//
//   requestMfaReset   người có `user.mfa_reset` yêu cầu, lý do bắt buộc, hết hạn 24 giờ
//   approveMfaReset   người KHÁC (khác người, khác phiên) phê duyệt; cùng giao dịch: xoá hồ sơ TOTP,
//                     thu hồi mọi phiên còn sống, đánh dấu đã tiêu thụ, ghi sổ
//
// Ba vế CSDL giữ (040): yêu cầu ≠ duyệt (CHECK); danh tính là dẫn xuất của phiên (013); `app_api`
// chỉ xoá được hồ sơ khi có yêu cầu đã duyệt chưa tiêu thụ. Mã dưới đây gọi đúng thứ tự, và một
// lần THỬ tự duyệt để lại dấu vết ở sổ kiểm toán qua pool độc lập — cùng khuôn `approveUnseal`.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { withTenant } from "@trustprocure/tenancy";
import { PERMISSIONS } from "./permissions.js";
import { requirePermission } from "./rbac.js";
import { resolveSessionActor } from "./session-actor.js";

export const MFA_RESET_TTL_HOURS = 24;

export class MfaResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaResetError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface MfaResetRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: "PENDING" | "APPROVED" | "CANCELLED";
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly consumedAt: Date | null;
}

interface Hang {
  readonly id: string;
  readonly user_id: string;
  readonly status: "PENDING" | "APPROVED" | "CANCELLED";
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly expires_at: Date;
  readonly approved_by: string | null;
  readonly approved_at: Date | null;
  readonly consumed_at: Date | null;
}

const COT = "id, user_id, status, requested_by, requested_at, expires_at, approved_by, approved_at, consumed_at";

function banGhi(h: Hang): MfaResetRequestRecord {
  return {
    id: h.id,
    userId: h.user_id,
    status: h.status,
    requestedBy: h.requested_by,
    requestedAt: h.requested_at,
    expiresAt: h.expires_at,
    approvedBy: h.approved_by,
    approvedAt: h.approved_at,
    consumedAt: h.consumed_at,
  };
}

function batBuocUuid(v: string, ten: string): void {
  if (!UUID_RE.test(v)) throw new MfaResetError(`${ten} phải là UUID hợp lệ`);
}

export interface RequestMfaResetInput {
  readonly userId: string;
  readonly reason: string;
  readonly actorSessionId: string;
}

export async function requestMfaReset(
  client: pg.PoolClient,
  orgId: string,
  input: RequestMfaResetInput,
  auditPool: pg.Pool,
): Promise<MfaResetRequestRecord> {
  await assertTenantBound(client, orgId, "requestMfaReset");
  batBuocUuid(input.userId, "userId");
  const reason = input.reason.trim();
  if (reason === "" || Buffer.byteLength(reason, "utf8") > 2000) throw new MfaResetError("lý do phải có, tối đa 2000 byte");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.USER_MFA_RESET, resourceType: "USER", resourceId: input.userId },
    auditPool,
  );
  const { rows } = await client.query<Hang>(
    `INSERT INTO public.mfa_reset_requests (org_id, user_id, reason, requested_by, requested_by_session_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COT}`,
    [orgId, input.userId, reason, actor.id, actor.sessionId],
  );
  const h = rows[0];
  if (h === undefined) throw new MfaResetError("không tạo được yêu cầu");
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "MFA_RESET_REQUESTED",
    resourceType: "USER",
    resourceId: input.userId,
    // KHÔNG mang `reason`: đó là chỗ chi tiết sự cố (mất máy, nghi bị lộ) nằm.
    payload: { requestId: h.id, expiresAt: h.expires_at.toISOString() },
  });
  return banGhi(h);
}

export interface ApproveMfaResetInput {
  readonly requestId: string;
  readonly actorSessionId: string;
}

export interface MfaResetOutcome extends MfaResetRequestRecord {
  /** Có hồ sơ TOTP để xoá không — một người chưa từng ghi danh cũng đặt lại được (không có gì để xoá). */
  readonly credentialDeleted: boolean;
  readonly sessionsRevoked: number;
}

export async function approveMfaReset(
  client: pg.PoolClient,
  orgId: string,
  input: ApproveMfaResetInput,
  auditPool: pg.Pool,
): Promise<MfaResetOutcome> {
  await assertTenantBound(client, orgId, "approveMfaReset");
  batBuocUuid(input.requestId, "requestId");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.USER_MFA_RESET, resourceType: "MFA_RESET_REQUEST", resourceId: input.requestId },
    auditPool,
  );

  let h: Hang | undefined;
  try {
    const { rows } = await client.query<Hang>(
      `UPDATE public.mfa_reset_requests
          SET status = 'APPROVED', approved_by = $3, approved_by_session_id = $4, approved_at = pg_catalog.clock_timestamp()
        WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $2
          AND status OPERATOR(pg_catalog.=) 'PENDING'
        RETURNING ${COT}`,
      [input.requestId, orgId, actor.id, actor.sessionId],
    );
    h = rows[0];
  } catch (loi) {
    // CHECK `khong_tu_duyet` / `phien_khac` (040): một lần THỬ vi phạm phải để lại dấu vết dù giao dịch
    // này rollback — cùng khuôn `UNSEAL_APPROVAL_DENIED`. Phân loại theo tên ràng buộc trong thông điệp.
    const van = loi instanceof Error ? loi.message : "";
    if (/khong_tu_duyet|phien_khac/u.test(van)) {
      await withTenant(auditPool, orgId, (c) =>
        appendAuditEvent(c, orgId, {
          actorType: actor.type,
          actorId: actor.id,
          action: "MFA_RESET_APPROVAL_DENIED",
          resourceType: "MFA_RESET_REQUEST",
          resourceId: input.requestId,
          payload: { viPham: "D2" },
        }),
      );
    }
    throw loi;
  }
  if (h === undefined) throw new MfaResetError("yêu cầu đặt lại TOTP không ở trạng thái PENDING, hoặc không thuộc tổ chức này");

  // Xoá hồ sơ — trigger 040 chỉ cho qua vì yêu cầu trên vừa được duyệt trong CÙNG giao dịch.
  const xoa = await client.query(
    "DELETE FROM public.mfa_credentials WHERE org_id OPERATOR(pg_catalog.=) $1 AND user_id OPERATOR(pg_catalog.=) $2 AND kind OPERATOR(pg_catalog.=) 'TOTP'",
    [orgId, h.user_id],
  );
  // Mọi phiên còn sống của người ấy chết cùng hồ sơ: một phiên cũ sống qua lần đặt lại là một phiên
  // không còn ai chứng minh được — cùng lý do 034 thu hồi phiên khi đình chỉ.
  const thuHoi = await client.query(
    "UPDATE public.sessions SET revoked_at = pg_catalog.clock_timestamp() WHERE org_id OPERATOR(pg_catalog.=) $1 AND user_id OPERATOR(pg_catalog.=) $2 AND revoked_at IS NULL",
    [orgId, h.user_id],
  );
  const { rows: xong } = await client.query<Hang>(
    `UPDATE public.mfa_reset_requests SET consumed_at = pg_catalog.clock_timestamp()
      WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $2 RETURNING ${COT}`,
    [h.id, orgId],
  );
  const cuoi = xong[0] ?? h;
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "MFA_RESET_APPROVED",
    resourceType: "USER",
    resourceId: h.user_id,
    payload: { requestId: h.id, requestedBy: h.requested_by, credentialDeleted: (xoa.rowCount ?? 0) > 0, sessionsRevoked: thuHoi.rowCount ?? 0 },
  });
  return { ...banGhi(cuoi), credentialDeleted: (xoa.rowCount ?? 0) > 0, sessionsRevoked: thuHoi.rowCount ?? 0 };
}
