import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type ActorType } from "@trustprocure/audit";

// =============================================================================================
// RFQ VÀ MÁY TRẠNG THÁI (S1.2) — VÀ RANH GIỚI VỚI TẦNG CSDL, GHIM TƯỜNG MINH
//
// ADR-014 chia việc theo tiêu chí *cái gì hỏng IM LẶNG thì xuống CSDL; cái gì hỏng ỒN ÀO thì ở
// ứng dụng*. Gói này là NỬA TRÊN của ranh giới đó, và nó KHÔNG lặp lại nửa dưới:
//
//   CSDL (009) giữ — và giữ MỘT MÌNH:
//     * tập trạng thái hợp lệ (`CHECK`);
//     * BẢNG CẠNH: mọi cặp không có trong `CANH_HOP_LE` đều bị `RAISE EXCEPTION`, đặc biệt là
//       cạnh KHÔNG tồn tại `CLOSED -> OPEN`;
//     * deadline không bao giờ lùi, và chỉ đổi được khi RFQ còn DRAFT/PENDING_APPROVAL/OPEN;
//     * điều kiện mở: có ≥ 1 hạng mục, và đủ 2 phê duyệt nếu RFQ cần;
//     * người tạo không được tự duyệt, phiên dẫn ra phải thuộc về chính người duyệt.
//
//   Gói này giữ:
//     * `assertTenantBound` trước mọi thứ;
//     * thứ tự các câu ghi trong một transaction;
//     * LÝ DO (C4 vế 3) và DẤU VẾT KIỂM TOÁN (C4 vế 4) — hai thứ CSDL không đòi được;
//     * chuyển đổi kiểu và thông báo lỗi đọc được.
//
// HỆ QUẢ PHẢI ĐỌC KỸ: các hàm dưới đây KHÔNG kiểm lại cạnh trước khi UPDATE. Đó là CÓ CHỦ ĐÍCH —
// một phép kiểm ở đây chỉ canh được đường đi qua đây, còn trigger canh MỌI đường, kể cả một câu
// `UPDATE` viết tay trong một script vận hành. Lặp lại phép kiểm ở tầng này sẽ mua thêm đúng một
// thứ: một thông báo lỗi đẹp hơn, đổi lấy hai bản sao của cùng một bảng cạnh phải giữ đồng bộ.
//
// C4 — PHẦN GÓI NÀY KHÔNG ĐÓNG ĐƯỢC: mệnh đề đòi "gia hạn ... có thông báo toàn bộ nhà cung cấp
// đã mời". Lời mời là S1.3 và CHƯA TỒN TẠI, nên `extendRfqDeadline` hôm nay không gửi cho ai cả.
// Vì vậy KHÔNG test nào ở S1.2 được mang nhãn `[INV-C4]`.
// =============================================================================================

export class RfqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RfqError";
  }
}

export const RFQ_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "OPEN",
  "CLOSED",
  "UNSEALED",
  "EVALUATING",
  "CANCELLED",
] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

/**
 * BẢN SAO TypeScript của `CANH_HOP_LE` trong 009 — dùng để ĐỌC (dựng giao diện, giải thích), KHÔNG
 * dùng để CƯỠNG CHẾ. Có test đọc thẳng file SQL và đòi hai bên khớp nhau, nên một cạnh mới thêm ở
 * một bên mà quên bên kia sẽ đỏ. Cùng khuôn `HINH_DANG_CHUAN` ở db/rls-coverage.int.test.ts và
 * `TAX_CODE_PATTERN` ở packages/supplier.
 */
export const RFQ_TRANSITIONS: readonly (readonly [RfqStatus, RfqStatus])[] = [
  ["DRAFT", "PENDING_APPROVAL"],
  ["PENDING_APPROVAL", "OPEN"],
  ["OPEN", "CLOSED"],
  ["CLOSED", "UNSEALED"],
  ["UNSEALED", "EVALUATING"],
  ["DRAFT", "CANCELLED"],
  ["PENDING_APPROVAL", "CANCELLED"],
  ["OPEN", "CANCELLED"],
];

export interface RfqActor {
  readonly type: ActorType;
  readonly id?: string | null;
}

export interface CreateRfqInput {
  readonly title: string;
  readonly deadlineAt?: Date | null;
  /** Mặc định `true` — mặc định ĐÓNG, cùng giá trị với DEFAULT của cột ở 009. */
  readonly requiresDualApproval?: boolean;
  readonly createdBy: string;
  readonly actor: RfqActor;
}

export interface RfqRecord {
  readonly id: string;
  readonly title: string;
  readonly status: RfqStatus;
  readonly deadlineAt: Date | null;
  readonly requiresDualApproval: boolean;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;
  readonly cancelledAt: Date | null;
}

export interface AddRfqItemInput {
  readonly rfqId: string;
  readonly lineNo: number;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly actor: RfqActor;
}

export interface RfqItemRecord {
  readonly id: string;
  readonly rfqId: string;
  readonly lineNo: number;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
}

interface HangRfq {
  id: string;
  title: string;
  status: RfqStatus;
  deadline_at: Date | null;
  requires_dual_approval: boolean;
  created_by: string;
  created_at: Date;
  opened_at: Date | null;
  closed_at: Date | null;
  cancelled_at: Date | null;
}

interface HangItem {
  id: string;
  rfq_id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit: string;
}

const COT_RFQ =
  "id, title, status, deadline_at, requires_dual_approval, created_by, created_at, " +
  "opened_at, closed_at, cancelled_at";
const COT_ITEM = "id, rfq_id, line_no, description, quantity, unit";

function doiRfq(h: HangRfq): RfqRecord {
  return {
    id: h.id,
    title: h.title,
    status: h.status,
    deadlineAt: h.deadline_at,
    requiresDualApproval: h.requires_dual_approval,
    createdBy: h.created_by,
    createdAt: h.created_at,
    openedAt: h.opened_at,
    closedAt: h.closed_at,
    cancelledAt: h.cancelled_at,
  };
}

function doiItem(h: HangItem): RfqItemRecord {
  return {
    id: h.id,
    rfqId: h.rfq_id,
    lineNo: h.line_no,
    description: h.description,
    quantity: h.quantity,
    unit: h.unit,
  };
}

/** Cắt khoảng trắng, từ chối rỗng. KHÔNG nội suy giá trị vào thông báo (quy ước của dự án). */
function batBuoc(giaTri: string, ten: string, gioiHan: number): string {
  const cat = giaTri.trim();
  if (cat.length === 0) throw new RfqError(`${ten} không được rỗng`);
  if (Buffer.byteLength(cat, "utf8") > gioiHan) {
    throw new RfqError(`${ten} dài quá ${gioiHan} byte`);
  }
  return cat;
}

async function docRfq(client: pg.PoolClient, rfqId: string): Promise<HangRfq> {
  const { rows } = await client.query<HangRfq>(
    `SELECT ${COT_RFQ} FROM rfq_packages WHERE id = $1`,
    [rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    // Phân biệt "không có" với "không thấy" là bất khả ở đây, và đó KHÔNG phải thiếu sót: RLS cắt
    // tập hàng nên một RFQ của tổ chức khác trông y hệt một RFQ không tồn tại. Đó là hành vi
    // ĐÚNG — phân biệt được hai ca ấy chính là một oracle xuyên tổ chức.
    throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn");
  }
  return hang;
}

export async function createRfq(
  client: pg.PoolClient,
  orgId: string,
  input: CreateRfqInput,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "createRfq");

  const title = batBuoc(input.title, "title", 500);
  const requiresDual = input.requiresDualApproval ?? true;

  const { rows } = await client.query<HangRfq>(
    `INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COT_RFQ}`,
    [orgId, title, input.deadlineAt ?? null, requiresDual, input.createdBy],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("INSERT rfq_packages không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_CREATED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { requiresDualApproval: requiresDual },
  });

  return doiRfq(hang);
}

export async function addRfqItem(
  client: pg.PoolClient,
  orgId: string,
  input: AddRfqItemInput,
): Promise<RfqItemRecord> {
  await assertTenantBound(client, orgId, "addRfqItem");

  const description = batBuoc(input.description, "description", 2000);
  const unit = batBuoc(input.unit, "unit", 50);
  if (!Number.isInteger(input.lineNo) || input.lineNo < 1) {
    throw new RfqError("line_no phải là số nguyên dương");
  }

  const { rows } = await client.query<HangItem>(
    `INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COT_ITEM}`,
    [orgId, input.rfqId, input.lineNo, description, input.quantity, unit],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("INSERT rfq_items không trả về hàng nào");
  return doiItem(hang);
}

export async function getRfq(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<RfqRecord | null> {
  await assertTenantBound(client, orgId, "getRfq");
  const { rows } = await client.query<HangRfq>(
    `SELECT ${COT_RFQ} FROM rfq_packages WHERE id = $1`,
    [rfqId],
  );
  const hang = rows[0];
  return hang === undefined ? null : doiRfq(hang);
}

export async function listRfqItems(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<RfqItemRecord[]> {
  await assertTenantBound(client, orgId, "listRfqItems");
  const { rows } = await client.query<HangItem>(
    `SELECT ${COT_ITEM} FROM rfq_items WHERE rfq_id = $1 ORDER BY line_no`,
    [rfqId],
  );
  return rows.map(doiItem);
}

export async function submitRfqForApproval(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actor: RfqActor },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "submitRfqForApproval");

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET status = 'PENDING_APPROVAL' WHERE id = $1 RETURNING ${COT_RFQ}`,
    [input.rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_SUBMITTED_FOR_APPROVAL",
    resourceType: "rfq_package",
    resourceId: hang.id,
  });
  return doiRfq(hang);
}

export interface ApproveRfqInput {
  readonly rfqId: string;
  readonly approverUserId: string;
  /**
   * Phiên của CHÍNH người duyệt. Trigger `rfq_kiem_nguoi_duyet` ở 009 đòi
   * `sessions.user_id = approver_user_id`, nên truyền phiên của người khác vào đây bị CSDL từ
   * chối — không phải bị hàm này từ chối. Vế "hai phiên khác nhau" của D2 do
   * `UNIQUE (org_id, rfq_id, session_id)` giữ.
   */
  readonly sessionId: string;
  readonly actor: RfqActor;
}

export async function approveRfq(
  client: pg.PoolClient,
  orgId: string,
  input: ApproveRfqInput,
): Promise<void> {
  await assertTenantBound(client, orgId, "approveRfq");

  await client.query(
    `INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id)
     VALUES ($1, $2, $3, $4)`,
    [orgId, input.rfqId, input.approverUserId, input.sessionId],
  );

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_APPROVED",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    payload: { approverUserId: input.approverUserId },
  });
}

/**
 * PENDING_APPROVAL → OPEN.
 *
 * `opened_at = now()` dùng đồng hồ của POSTGRES, không của Node — ADR-005. Mọi mốc thời gian có
 * giá trị phán xét trong hệ này đều lấy từ cùng một đồng hồ; một `new Date()` ở tầng ứng dụng là
 * đồng hồ của một máy khác, và độ lệch giữa hai máy là thứ không ai đo trong lúc chạy.
 */
export async function openRfq(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actor: RfqActor },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "openRfq");

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET status = 'OPEN', opened_at = now()
      WHERE id = $1 RETURNING ${COT_RFQ}`,
    [input.rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_OPENED",
    resourceType: "rfq_package",
    resourceId: hang.id,
  });
  return doiRfq(hang);
}

export interface CloseRfqInput {
  readonly rfqId: string;
  /** C4/ARCHITECTURE §6: đóng sớm phải có lý do. Bắt buộc, kể cả khi đóng đúng hạn. */
  readonly reason: string;
  readonly actor: RfqActor;
}

export async function closeRfq(
  client: pg.PoolClient,
  orgId: string,
  input: CloseRfqInput,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "closeRfq");
  const reason = batBuoc(input.reason, "reason", 2000);

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET status = 'CLOSED', closed_at = now()
      WHERE id = $1 RETURNING ${COT_RFQ}`,
    [input.rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_CLOSED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { reason },
  });
  return doiRfq(hang);
}

export interface ExtendDeadlineInput {
  readonly rfqId: string;
  readonly newDeadlineAt: Date;
  readonly reason: string;
  readonly actor: RfqActor;
}

/**
 * Gia hạn. Ba trong bốn vế của C4 nằm ở đây hoặc ở 009; vế thứ tư thì KHÔNG:
 *   (1) không rút ngắn      -> trigger ở 009, và ở dạng MẠNH HƠN mệnh đề (cấm lùi ở mọi trạng thái);
 *   (2) chỉ khi đang OPEN   -> trigger ở 009 (nó cho phép cả DRAFT/PENDING_APPROVAL vì ở đó việc
 *                              đổi deadline là SOẠN THẢO, không phải gia hạn);
 *   (3) có lý do            -> hàm này, `reason` bắt buộc;
 *   (4) có audit            -> hàm này;
 *   (5) THÔNG BÁO cho toàn bộ nhà cung cấp đã mời -> **KHÔNG CÓ**. Lời mời là S1.3.
 *
 * Vì (5) trống, C4 CHƯA ĐƯỢC PHỦ và không test nào ở S1.2 được mang nhãn `[INV-C4]`.
 *
 * DƯ LƯỢNG của `reason`, nói thẳng: nó là VĂN BẢN TỰ DO đi vào `audit_events.payload`. `CHECK`
 * của 003 chặn KHOÁ mang giá ở mọi độ sâu, nó KHÔNG chặn một con số nằm trong GIÁ TRỊ — một lý do
 * viết "đối thủ chào 12 tỷ" sẽ nằm vĩnh viễn trong một bảng chỉ-ghi-thêm. Không lớp máy nào chặn
 * điều đó; lớp duy nhất là hướng dẫn người dùng và code review.
 */
export async function extendRfqDeadline(
  client: pg.PoolClient,
  orgId: string,
  input: ExtendDeadlineInput,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "extendRfqDeadline");
  const reason = batBuoc(input.reason, "reason", 2000);

  const truoc = await docRfq(client, input.rfqId);

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1 RETURNING ${COT_RFQ}`,
    [input.rfqId, input.newDeadlineAt],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_DEADLINE_EXTENDED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: {
      reason,
      truoc: truoc.deadline_at?.toISOString() ?? null,
      sau: hang.deadline_at?.toISOString() ?? null,
    },
  });
  return doiRfq(hang);
}

export async function cancelRfq(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly reason: string; readonly actor: RfqActor },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "cancelRfq");
  const reason = batBuoc(input.reason, "reason", 2000);

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = $1 RETURNING ${COT_RFQ}`,
    [input.rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "RFQ_CANCELLED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { reason },
  });
  return doiRfq(hang);
}
