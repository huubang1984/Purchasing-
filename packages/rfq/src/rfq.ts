import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";

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
  // [C-1, 011] Cạnh MỚI: sau khi hạng mục chỉ sửa được ở DRAFT, phải có đường quay lại.
  ["PENDING_APPROVAL", "DRAFT"],
  ["PENDING_APPROVAL", "OPEN"],
  ["OPEN", "CLOSED"],
  ["CLOSED", "UNSEALED"],
  ["UNSEALED", "EVALUATING"],
  ["DRAFT", "CANCELLED"],
  ["PENDING_APPROVAL", "CANCELLED"],
  ["OPEN", "CANCELLED"],
];

// ===========================================================================================
// [ADR-016] `RfqActor` ĐÃ BỊ XOÁ — VÀ NÓ LÀ HẠNG MỤC CÒN LẠI CÓ TÊN CỦA LƯỢT CÀI 2026-08-30
//
// ADR-016 mục 3 từng viết rằng hai gói kia phải đi theo đường mà `RfqActor` "đã đi". Câu ấy SAI
// và đã bị gạch bỏ tại chỗ: thứ đi đúng đường ở vòng sửa S1.2 là **cột `created_by`**. Tám hàm
// export của gói này tới trước lượt sửa ấy VẪN nhận `actor` — một object hai trường mà người gọi
// tự khai — rồi ghi thẳng vào sổ kiểm toán.
//
// Tức gói này mang ĐÚNG khiếm khuyết mà MEDIUM-3 nêu cho `packages/supplier`. Nó không bị lượt
// review nào gọi tên vì mỗi lượt chỉ nhìn MỘT hạng mục — và đó là một giới hạn của hình thức
// review, đáng ghi hơn bản thân khiếm khuyết.
//
// `createdBy` và `approverUserId` cũng biến mất, vì cả hai là DẪN XUẤT đã được CSDL cưỡng chế:
// `rfq_kiem_nguoi_tao` (011) đòi `sessions.user_id = created_by`, và `rfq_kiem_nguoi_duyet` (011)
// đòi `sessions.user_id = approver_user_id`. Hai tham số mà trigger đã ép bằng chủ phiên là hai
// chỗ để gõ nhầm, không phải hai bậc tự do.
// ===========================================================================================

export interface CreateRfqInput {
  readonly title: string;
  readonly deadlineAt?: Date | null;
  // [ADR-017] `requiresDualApproval` ĐÃ BỊ GỠ khỏi chữ ký này. Nó từng là một cờ mà NGƯỜI GỌI
  // đặt, và không một dòng mã nào tính nó — tức D2 ("RFQ vượt ngưỡng cần 2 phê duyệt") chưa có
  // NGƯỠNG nào cả. RFQ nay luôn ra đời ở `true` (DEFAULT của cột, 009), và đường DUY NHẤT hạ nó
  // xuống là `setRfqBudget` — thứ phải trỏ tới một chính sách có thật và để CSDL tính phép so.
  /**
   * [H-1, review an ninh S1.2] Phiên của CHÍNH người tạo. Không có nó, `createdBy` là một LỜI KHAI:
   * Mallory gọi `createRfq({ createdBy: idCuaBob, actor: Mallory })` rồi tự duyệt được, vì trigger
   * so `Bob = Mallory` -> sai -> cho qua. D2 tụt từ "hai người khác người tạo" xuống "một người".
   * Trigger `rfq_packages_kiem_nguoi_tao` (011) đòi `sessions.user_id = created_by`, nên cột ấy
   * nay là DẪN XUẤT chứ không phải lời khai.
   */
  readonly createdBySessionId: string;
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
  /** [ADR-016] Phiên của CHÍNH người thao tác. Danh tính là dẫn xuất của nó. */
  readonly actorSessionId: string;
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

  const actor = await resolveSessionActor(client, orgId, input.createdBySessionId);
  const title = batBuoc(input.title, "title", 500);

  // [ADR-017] Cột `requires_dual_approval` cố ý KHÔNG có trong danh sách: `DEFAULT true` của 009
  // là mặc định ĐÓNG, và không viết nó ra ở đây làm cho "chỉ `setRfqBudget` hạ được nó" thành một
  // câu đúng theo hình dạng của mã, không phải theo trí nhớ của người đọc.
  const { rows } = await client.query<HangRfq>(
    `INSERT INTO rfq_packages
       (org_id, title, deadline_at, created_by, created_by_session_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COT_RFQ}`,
    [orgId, title, input.deadlineAt ?? null, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("INSERT rfq_packages không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_CREATED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { requiresDualApproval: hang.requires_dual_approval },
  });

  return doiRfq(hang);
}

export async function addRfqItem(
  client: pg.PoolClient,
  orgId: string,
  input: AddRfqItemInput,
): Promise<RfqItemRecord> {
  await assertTenantBound(client, orgId, "addRfqItem");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const description = batBuoc(input.description, "description", 2000);
  const unit = batBuoc(input.unit, "unit", 50);
  if (!Number.isInteger(input.lineNo) || input.lineNo < 1) {
    throw new RfqError("line_no phải là số nguyên dương");
  }

  const { rows } = await client.query<HangItem>(
    `INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit,
                            created_by, created_by_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COT_ITEM}`,
    [orgId, input.rfqId, input.lineNo, description, input.quantity, unit, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("INSERT rfq_items không trả về hàng nào");

  // [C-1 mục 5] Bản S1.2 KHÔNG ghi kiểm toán cho hạng mục, nên bước "thêm 20 dòng sau khi đã có
  // hai phê duyệt" không nhìn thấy được kể cả khi có người đọc sổ. Băm nội dung (011) nay chặn
  // hẳn đường ấy, nhưng dấu vết vẫn phải có: sổ kiểm toán là thứ trả lời "đã có gì xảy ra".
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_ITEM_ADDED",
    resourceType: "rfq_item",
    resourceId: hang.id,
    payload: { rfqId: hang.rfq_id, lineNo: hang.line_no },
  });

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
  input: { readonly rfqId: string; readonly actorSessionId: string },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "submitRfqForApproval");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows } = await client.query<HangRfq>(
    // [H-3] `AND status = 'DRAFT'`: không có vế này, gọi lại hàm trên một RFQ đã ở trạng thái
    // đích là một lần ghi đè IM LẶNG — kiểm (a) của trigger bỏ qua vì status không đổi.
    `UPDATE rfq_packages SET status = 'PENDING_APPROVAL',
            submitted_by = $2, submitted_by_session_id = $3
      WHERE id = $1 AND status = 'DRAFT' RETURNING ${COT_RFQ}`,
    [input.rfqId, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_SUBMITTED_FOR_APPROVAL",
    resourceType: "rfq_package",
    resourceId: hang.id,
  });
  return doiRfq(hang);
}

export interface ApproveRfqInput {
  readonly rfqId: string;
  /**
   * Phiên của CHÍNH người duyệt. Trigger `rfq_kiem_nguoi_duyet` ở 009 đòi
   * `sessions.user_id = approver_user_id`, nên truyền phiên của người khác vào đây bị CSDL từ
   * chối — không phải bị hàm này từ chối. Vế "hai phiên khác nhau" của D2 do
   * `UNIQUE (org_id, rfq_id, session_id)` giữ.
   */
  readonly sessionId: string;
}

export async function approveRfq(
  client: pg.PoolClient,
  orgId: string,
  input: ApproveRfqInput,
): Promise<void> {
  await assertTenantBound(client, orgId, "approveRfq");
  const actor = await resolveSessionActor(client, orgId, input.sessionId);

  await client.query(
    `INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id)
     VALUES ($1, $2, $3, $4)`,
    [orgId, input.rfqId, actor.id, actor.sessionId],
  );

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_APPROVED",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    payload: { approverUserId: actor.id },
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
  input: { readonly rfqId: string; readonly actorSessionId: string },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "openRfq");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET status = 'OPEN', opened_at = now(),
            opened_by = $2, opened_by_session_id = $3
      WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING ${COT_RFQ}`,
    [input.rfqId, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
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
  /** [ADR-016] Phiên của CHÍNH người đóng. Đóng thầu là một hành vi có chủ thể. */
  readonly actorSessionId: string;
}

export async function closeRfq(
  client: pg.PoolClient,
  orgId: string,
  input: CloseRfqInput,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "closeRfq");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const reason = batBuoc(input.reason, "reason", 2000);

  const { rows } = await client.query<HangRfq>(
    // [H-4] `early_close_reason` được đặt CHỈ khi đóng trước hạn — trigger (h) của 011 đòi nó
    // tường minh ở đúng ca ấy. Đóng đúng hạn không đòi gì thêm, và hai ca có mức rủi ro khác hẳn
    // nhau nên chúng không được gộp vào một tham số như bản S1.2 đã làm.
    `UPDATE rfq_packages
        SET status = 'CLOSED', closed_at = now(),
            early_close_reason = CASE WHEN now() < deadline_at THEN $2::text ELSE NULL END,
            closed_by = $3, closed_by_session_id = $4
      WHERE id = $1 AND status = 'OPEN' RETURNING ${COT_RFQ}`,
    [input.rfqId, reason, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
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
  /**
   * [ADR-016] Phiên của CHÍNH người gia hạn. KHÔNG có cột ký tên nào cho đường này — nó sửa
   * `deadline_at` mà không đổi `status`, nên không có cạnh để treo một `WHEN`. Xem khối §(3)
   * của migration 016: một cột `deadline_changed_by` chỉ giữ được LẦN CUỐI, tức trả lời SAI câu
   * hỏi kiểm toán thật ("đã bị đẩy mấy lần, bởi ai"). Câu trả lời đúng là sổ kiểm toán.
   */
  readonly actorSessionId: string;
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
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const reason = batBuoc(input.reason, "reason", 2000);

  const truoc = await docRfq(client, input.rfqId);

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1 RETURNING ${COT_RFQ}`,
    [input.rfqId, input.newDeadlineAt],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
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
  input: { readonly rfqId: string; readonly reason: string; readonly actorSessionId: string },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "cancelRfq");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const reason = batBuoc(input.reason, "reason", 2000);

  const { rows } = await client.query<HangRfq>(
    `UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now(),
            cancelled_by = $2, cancelled_by_session_id = $3
      WHERE id = $1 AND status IN ('DRAFT', 'PENDING_APPROVAL', 'OPEN') RETURNING ${COT_RFQ}`,
    [input.rfqId, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_CANCELLED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { reason },
  });
  return doiRfq(hang);
}
