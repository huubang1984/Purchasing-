import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";
import { RfqError } from "./rfq.js";

// =============================================================================================
// ADR-017 — NGƯỠNG PHÊ DUYỆT KÉP LÀ CHÍNH SÁCH THEO TỔ CHỨC, VÀ PHÂN LOẠI PHẢI TÁI LẬP ĐƯỢC
//
// Trước file này, `rfq_packages.requires_dual_approval` là một cờ mà NGƯỜI GỌI đặt: `createRfq`
// nhận `requiresDualApproval ?? true` và không một dòng mã nào tính nó. Mặc định `true` đúng là
// mặc định đóng — nhưng D2 (*"RFQ vượt ngưỡng cần 2 phê duyệt"*) khi ấy chưa có NGƯỠNG nào cả.
//
// ---------------------------------------------------------------------------------------------
// AI TÍNH PHÉP SO — VÀ VÌ SAO CÂU TRẢ LỜI KHÔNG PHẢI "TYPESCRIPT"
// ---------------------------------------------------------------------------------------------
// ADR-017 mục 2 viết "ứng dụng tính, CSDL lưu kết luận". Cài đặt này giữ nguyên phần TRÁCH NHIỆM
// — ứng dụng chọn chính sách, ghi ngân sách, và ra lệnh phân loại — nhưng đặt PHÉP SO ở SQL, qua
// `public.rfq_can_phe_duyet_kep`. Hai lý do, cả hai đều cụ thể:
//
//   ⑴ Trigger `rfq_packages_kiem_nguong_phe_duyet_kep` (014) BẮT BUỘC phải có phép so ấy để cưỡng
//      chế. Nếu TypeScript giữ một bản thứ hai, đó là hai bản sao của một luật — đúng thứ đã hỏng
//      hai lần ở 002 và đúng thứ `tax-code.test.ts` phải dựng một meta-test để canh.
//   ⑵ Tiền trong JavaScript là `double`. `numeric(18,2)` của Postgres thì không. Một phép so tiền
//      viết ở JS là một phép so SAI theo một cách khó thấy.
//
// Đây là một THU HẸP có ghi tên so với chữ của ADR-017, không phải một sự đi chệch: kết luận vẫn
// được LƯU ở `rfq_packages`, và bằng chứng vẫn được lưu ở `rfq_budgets`.
// =============================================================================================

export const CURRENCIES = ["VND", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface ProcurementPolicyRecord {
  readonly id: string;
  readonly version: number;
  /** Chuỗi, không phải `number`: `numeric(18,2)` không đi lọt qua `double` mà còn nguyên. */
  readonly dualApprovalThreshold: string;
  readonly currency: Currency;
  readonly effectiveFrom: Date;
}

export interface CreateProcurementPolicyInput {
  readonly version: number;
  readonly dualApprovalThreshold: string;
  readonly currency: Currency;
  readonly actorSessionId: string;
}

interface HangChinhSach {
  id: string;
  version: number;
  dual_approval_threshold: string;
  currency: Currency;
  effective_from: Date;
}

const COT_CHINH_SACH = "id, version, dual_approval_threshold, currency, effective_from";

function doiChinhSach(h: HangChinhSach): ProcurementPolicyRecord {
  return {
    id: h.id,
    version: h.version,
    dualApprovalThreshold: h.dual_approval_threshold,
    currency: h.currency,
    effectiveFrom: h.effective_from,
  };
}

/**
 * Hình dạng một số tiền thập phân không dấu, tối đa hai chữ số lẻ.
 *
 * Phép kiểm HÌNH DẠNG, không phải phép kiểm giá trị: `numeric(18,2)` ở CSDL là lớp có thẩm quyền,
 * và nó cũng là lớp duy nhất chặn được `NaN`/`Infinity` — hai giá trị mà `numeric` NHẬN, và
 * `NaN > 0` là TRUE trong Postgres. Dự án đã đo điều đó một lần ở `rfq_items.quantity`.
 */
export const MONEY_PATTERN = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/;

function batBuocTien(giaTri: string, ten: string): string {
  const cat = giaTri.trim();
  if (!MONEY_PATTERN.test(cat)) {
    throw new RfqError(`${ten} phải là số thập phân không âm, tối đa 2 chữ số lẻ`);
  }
  return cat;
}

/**
 * Thêm MỘT PHIÊN BẢN chính sách. Không có hàm sửa, và đó là toàn bộ cơ chế: `app_api` không có
 * `UPDATE`/`DELETE` trên bảng này (014). Sửa được ngưỡng của một phiên bản đã dùng nghĩa là phân
 * loại của mọi RFQ cũ đổi theo mà không ai biết — tức "tái lập được" thành một lời hứa rỗng.
 */
export async function createProcurementPolicy(
  client: pg.PoolClient,
  orgId: string,
  input: CreateProcurementPolicyInput,
): Promise<ProcurementPolicyRecord> {
  await assertTenantBound(client, orgId, "createProcurementPolicy");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new RfqError("version phải là số nguyên dương");
  }
  const nguong = batBuocTien(input.dualApprovalThreshold, "dualApprovalThreshold");
  if (!CURRENCIES.includes(input.currency)) {
    throw new RfqError("currency chỉ nhận VND hoặc USD");
  }

  const { rows } = await client.query<HangChinhSach>(
    `INSERT INTO org_procurement_policies
       (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id)
     VALUES ($1, $2, $3::numeric, $4, $5, $6) RETURNING ${COT_CHINH_SACH}`,
    [orgId, input.version, nguong, input.currency, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("INSERT org_procurement_policies không trả về hàng");

  // `payload` mang NGƯỠNG. Đây là ngoại lệ có lý do với thói quen "không đưa số vào sổ": ngưỡng
  // KHÔNG phải giá thầu và không thuộc bí mật nào của A3/A4 — nó là một tham số quản trị, và một
  // lần đổi ngưỡng là đúng loại sự kiện mà kiểm toán viên cần thấy ngay trong sổ.
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "PROCUREMENT_POLICY_CREATED",
    resourceType: "procurement_policy",
    resourceId: hang.id,
    payload: { version: hang.version, threshold: nguong, currency: hang.currency },
  });

  return doiChinhSach(hang);
}

/**
 * Chính sách đang có hiệu lực: phiên bản CAO NHẤT đã tới ngày hiệu lực.
 *
 * Trả `null` khi tổ chức chưa đặt chính sách nào — và người gọi PHẢI xử lý ca đó chứ không được
 * coi là "ngưỡng bằng 0". Ở `setRfqBudget` bên dưới, ca ấy là một lần NÉM.
 */
export async function getActiveProcurementPolicy(
  client: pg.PoolClient,
  orgId: string,
): Promise<ProcurementPolicyRecord | null> {
  await assertTenantBound(client, orgId, "getActiveProcurementPolicy");

  const { rows } = await client.query<HangChinhSach>(
    `SELECT ${COT_CHINH_SACH} FROM org_procurement_policies
      WHERE effective_from <= now() ORDER BY version DESC LIMIT 1`,
  );
  const hang = rows[0];
  return hang === undefined ? null : doiChinhSach(hang);
}

export interface SetRfqBudgetInput {
  readonly rfqId: string;
  readonly estimatedValue: string;
  readonly currency: Currency;
  readonly actorSessionId: string;
}

export interface RfqBudgetRecord {
  readonly rfqId: string;
  readonly estimatedValue: string;
  readonly currency: Currency;
  readonly policyId: string;
  /** Kết luận SAU khi phân loại — đọc lại từ `rfq_packages`, không phải thứ hàm này suy ra. */
  readonly requiresDualApproval: boolean;
}

/**
 * Đặt (hoặc sửa) ngân sách dự tính của một RFQ, rồi PHÂN LOẠI nó theo chính sách đang hiệu lực.
 *
 * Ba câu lệnh, một transaction của người gọi:
 *   ⑴ ghi bằng chứng (`rfq_budgets`) — trigger 014 đòi RFQ còn ở DRAFT;
 *   ⑵ đặt kết luận (`rfq_packages.requires_dual_approval`) từ `rfq_can_phe_duyet_kep`;
 *   ⑶ ghi sổ kiểm toán.
 *
 * Hàm này là đường DUY NHẤT hạ `requires_dual_approval` xuống `false`, và nó không hạ được nếu
 * bằng chứng không cho phép — vì chính CSDL tính phép so. `createRfq` không còn nhận cờ ấy nữa.
 */
export async function setRfqBudget(
  client: pg.PoolClient,
  orgId: string,
  input: SetRfqBudgetInput,
): Promise<RfqBudgetRecord> {
  await assertTenantBound(client, orgId, "setRfqBudget");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const giaTri = batBuocTien(input.estimatedValue, "estimatedValue");
  if (!CURRENCIES.includes(input.currency)) {
    throw new RfqError("currency chỉ nhận VND hoặc USD");
  }

  const chinhSach = await getActiveProcurementPolicy(client, orgId);
  if (chinhSach === null) {
    // FAIL-CLOSED, và nó phải NÉM chứ không được lặng lẽ để nguyên `true`: một RFQ đi tiếp với
    // "cần hai phê duyệt" mà người mua tưởng đã phân loại là một sự bất ngờ ở đúng lúc tệ nhất.
    throw new RfqError(
      "tổ chức chưa có chính sách mua sắm nào — không phân loại được ngưỡng phê duyệt kép",
    );
  }
  if (chinhSach.currency !== input.currency) {
    throw new RfqError(
      `đơn vị tiền tệ của ngân sách (${input.currency}) khác của chính sách (${chinhSach.currency})`,
    );
  }

  await client.query(
    `INSERT INTO rfq_budgets
       (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id)
     VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)
     ON CONFLICT (org_id, rfq_id) DO UPDATE
       SET estimated_value = EXCLUDED.estimated_value,
           currency = EXCLUDED.currency,
           policy_id = EXCLUDED.policy_id`,
    [orgId, input.rfqId, giaTri, input.currency, chinhSach.id, actor.id, actor.sessionId],
  );

  const { rows } = await client.query<{ requires_dual_approval: boolean }>(
    `UPDATE rfq_packages
        SET requires_dual_approval = public.rfq_can_phe_duyet_kep(id)
      WHERE id = $1 AND status = 'DRAFT'
      RETURNING requires_dual_approval`,
    [input.rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    // 0 hàng nghĩa là RFQ không còn ở DRAFT, hoặc thuộc tổ chức khác và bị RLS lọc. Hai ca cố ý
    // cùng một thông báo — phân biệt được chúng là một oracle xuyên tổ chức.
    throw new RfqError("không phân loại được: RFQ không còn ở DRAFT hoặc không thuộc tổ chức này");
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_BUDGET_SET",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    // `payload` mang KẾT LUẬN và phiên bản chính sách, KHÔNG mang số tiền: sổ kiểm toán đọc được
    // bởi mọi người có `audit.read`, còn ngân sách dự tính là thứ neo giá nếu rò xuống bên bán.
    payload: { policyVersion: chinhSach.version, requiresDualApproval: hang.requires_dual_approval },
  });

  return {
    rfqId: input.rfqId,
    estimatedValue: giaTri,
    currency: input.currency,
    policyId: chinhSach.id,
    requiresDualApproval: hang.requires_dual_approval,
  };
}
