import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, maChotTuLoi, requirePermission, resolveSessionActor, tuChoiTheoChot } from "@trustprocure/identity";
import { ghiTinHieuKhiDongSom, ghiTinHieuKhiNop } from "@trustprocure/kiem-soat";
import { enqueueJob } from "@trustprocure/outbox";
import {
  issueRfqKeyPair,
  revokeRfqKeyMaterial,
  type OrgKeyProvisioner,
} from "@trustprocure/sealed-envelope";
import {
  CAU_CHOT_CANH_TRANH,
  CAU_CHOT_CHU_KY_DOC_LAP,
  CAU_CHOT_CHU_KY_XUNG_DOT_MO,
  CAU_CHOT_NGAN_SACH,
  CAU_CHOT_NHOM_HANG,
  CAU_CHOT_TIN_HIEU,
  CAU_CHOT_XOAY_VONG_MO,
  CAU_CHOT_XOAY_VONG_NOP,
  kiemChot,
} from "./chot-kiem-soat.js";

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
// ~~C4 — PHẦN GÓI NÀY KHÔNG ĐÓNG ĐƯỢC: mệnh đề đòi "gia hạn ... có thông báo toàn bộ nhà cung~~
// ~~cấp đã mời". Lời mời là S1.3 và CHƯA TỒN TẠI, nên `extendRfqDeadline` hôm nay không gửi cho~~
// ~~ai cả. Vì vậy KHÔNG test nào ở S1.2 được mang nhãn `[INV-C4]`.~~
//
// **[S1.8] Câu trên hết hiệu lực, và nó hết hiệu lực vì ĐIỀU KIỆN nó nêu đã thành sự thật** —
// `rfq_invitations` ra đời ở S1.3. `extendRfqDeadline` nay xếp một job outbox cho MỖI lời mời,
// trong CÙNG giao dịch. Đó là hình dạng đúng của "thông báo" trong một hệ có outbox giao dịch:
// thứ được bảo đảm là *ý định gửi không bao giờ lạc khỏi lần ghi hạn mới*, không phải *thư đã
// tới*. Phần chênh ấy nằm ở §4 của C4 và không được nuốt vào ô ✅.
// =============================================================================================

export class RfqError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RfqError";
  }
}

/**
 * [C4 vế 5] `kind` của job thông báo gia hạn. ~~Một hằng, một chỗ ở — cùng khuôn `UNSEAL_JOB_KIND`.~~ **[S1.239 / khoản 161]** Chỗ
 * khai tập `kind` của kho là union `KindOutbox` (`@trustprocure/outbox`, đọc qua `JobInput["kind"]`); lời gọi `enqueueJob` viết
 * literal. Hằng này còn là khoá bảng handler của `api` (`apps/api/src/outbox-api.ts`).
 *
 * ~~Nó CHƯA có handler nào đăng ký, và đó là một phần chênh có tên ở §4 của C4: ở S1, mệnh đề đúng
 * ở mức *"ý định thông báo đã nằm cùng chỗ với lần ghi hạn mới"*, chưa đúng ở mức *"nhà cung cấp
 * đã biết"*. Chặng cuối là một tầng vận hành mà `apps/` chưa có.~~ **[S1.239 / khoản 161]** Thiu từ S1.91 (khoản 154):
 * handler nằm ở `buildApiOutboxHandlers` (`apps/api/src/outbox-api.ts`) — tiến trình duy nhất đọc được `supplier_contacts`.
 */
export const RFQ_DEADLINE_NOTICE_KIND = "RFQ_DEADLINE_EXTENDED_NOTICE";

export const RFQ_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "OPEN",
  "CLOSED",
  "UNSEALED",
  "EVALUATING",
  // [S1.108 / S2.5 / 059] Ba giá trị MỚI của vòng BAFO. `BAFO_UNSEALED` KHÔNG có trong spec §4.3
  // — spec khai `BAFO_CLOSED->EVALUATING` thẳng — và nó được thêm vì lượt soi hình dạng đo được
  // rằng nối thẳng bỏ mất vế *"phong bì vòng hai đã đi qua cổng bốn vế"*. Xem đầu `059`.
  "BAFO_OPEN",
  "BAFO_CLOSED",
  "BAFO_UNSEALED",
  // [S1.110 / S2.6 / 061] Trạng thái thứ MƯỜI MỘT, và nghĩa của nó là một quyết định của chủ dự
  // án ngày 2026-09-22 (§8.3): `AWARDED` nghĩa là *ĐANG CÓ một award còn sống*, không *đã từng
  // trao thầu*. Nhờ nghĩa ấy trạng thái RFQ là ẢNH của hàng `rfq_awards` mới nhất, nên J7 và máy
  // trạng thái đọc CÙNG một sự thật — và khi award bị huỷ thì RFQ có đường về `EVALUATING`.
  "AWARDED",
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
  // [S1.108 / S2.5 / 059] Chu trình BAFO: bốn cạnh, không ba. Ảnh của
  // `OPEN->CLOSED->UNSEALED->EVALUATING`, nên `BAFO_UNSEALED` đứng đúng chỗ `UNSEALED` đứng.
  ["EVALUATING", "BAFO_OPEN"],
  ["BAFO_OPEN", "BAFO_CLOSED"],
  ["BAFO_CLOSED", "BAFO_UNSEALED"],
  ["BAFO_UNSEALED", "EVALUATING"],
  // [S1.110 / S2.6 / 061] Hai cạnh của trao thầu. `AWARDED->EVALUATING` là đường VỀ, và nó tồn
  // tại để `AWARDED` không thành trạng thái HÚT thứ ba (khoản 225 giữ hai cái đầu).
  ["EVALUATING", "AWARDED"],
  ["AWARDED", "EVALUATING"],
  // [S1.108] Cạnh huỷ thứ tư, và nó suy ra từ ảnh: `OPEN->CANCELLED` CÓ nên
  // `BAFO_OPEN->CANCELLED` có. ~~`BAFO_CLOSED` và `BAFO_UNSEALED` KHÔNG có, đúng như `CLOSED` và
  // `UNSEALED` không có — khoản 225 giữ câu hỏi ấy mở cho CẢ HAI cặp cùng lúc.~~ [S1.165] Cả hai cặp
  // nay có — cuối bảng.
  ["BAFO_OPEN", "CANCELLED"],
  // [S1.107 / lượt soi ngang 77 — CAO ①, 058] Cạnh MỚI: trước nó `EVALUATING` không có một
  // cạnh ra nào, và S1.106 vừa mở cửa VÀO nó ra HTTP cho năm trên ~~sáu~~ **[S1.241 / khoản 270]** bảy vai hôm nay (sáu lúc
  // S1.106; `083` thêm `DATA_STEWARD`, không giữ `evaluation.perform` — ghim ở `ma-tran-quyen.test.ts` ca «khoản 220 ⒝»).
  ["EVALUATING", "CANCELLED"],
  // [S1.165 / khoản 225, 071] BỐN cạnh huỷ sau khi đóng — `CLOSED`, `UNSEALED` và hai ảnh BAFO của
  // chúng thôi là trạng thái hút. Chúng đòi `cancel_reason` ở chính trigger (vế (i) của `071`).
  ["CLOSED", "CANCELLED"],
  ["UNSEALED", "CANCELLED"],
  ["BAFO_CLOSED", "CANCELLED"],
  ["BAFO_UNSEALED", "CANCELLED"],
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
  /**
   * [S1.201 / S3.6a] Nhóm hàng của gói — tuỳ chọn lúc tạo, đổi được ở DRAFT bằng `datNhomHangChoGoi`. Ở tổ chức đã bật S3, gói
   * không nhóm hàng không rời DRAFT (`THIEU_NHOM_HANG`). Chỉ gán được nhóm còn dùng của chính tổ chức (trigger + khoá ngoại).
   */
  readonly categoryId?: string | null;
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
  /**
   * [S1.165 / khoản 225] Lý do huỷ mà người huỷ viết — `null` khi gói chưa huỷ, và cho các gói huỷ
   * trước vòng ấy (lý do của chúng chỉ nằm trong hàng sổ `RFQ_CANCELLED`). Nhà cung cấp ĐỌC được nó
   * (`GET /guest/rfq`), nên nó là một lời nói với bên ngoài, không phải ghi chú nội bộ.
   */
  readonly cancelReason: string | null;
  /** [S1.201 / S3.6a] Nhóm hàng — `null` cho gói chưa gán, kể cả mọi gói trước vòng ấy. Khoá sau DRAFT. */
  readonly categoryId: string | null;
  /**
   * [S1.198 / khoản 256] Số lần gói đã nộp duyệt — trigger `rfq_packages_dem_lan_nop` đếm ở cạnh DRAFT→PENDING_APPROVAL, bên
   * gọi không đặt được. Người duyệt gửi lại ĐÚNG con số đã thấy (`ApproveRfqInput.lanNopDaXem`): ở tổ chức đã bật, lời duyệt khác
   * lần nộp hiện tại bị từ chối — gói được trả về, sửa và nộp lại sau lúc người ấy xem thì chữ ký không rơi lên thứ họ chưa xem.
   */
  readonly lanNop: number;
  /**
   * [S1.284 / S4.7b1] Số ngày giao yêu cầu (`112_tco`) — `null` khi gói chưa khai. Chỉ đổi ở DRAFT (trigger
   * `rfq_packages_so_ngay_giao`), và nằm trong chữ ký phê duyệt: người duyệt phải THẤY nó ở màn duyệt.
   */
  readonly soNgayGiao: number | null;
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
  cancel_reason: string | null;
  category_id: string | null;
  lan_nop: number;
  so_ngay_giao: number | null;
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
  "opened_at, closed_at, cancelled_at, cancel_reason, category_id, lan_nop, so_ngay_giao";
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
    cancelReason: h.cancel_reason,
    categoryId: h.category_id,
    lanNop: h.lan_nop,
    soNgayGiao: h.so_ngay_giao,
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
    `SELECT ${COT_RFQ} FROM public.rfq_packages WHERE id OPERATOR(pg_catalog.=) $1`,
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
  const { rows } = await client
    .query<HangRfq>(
      `INSERT INTO public.rfq_packages
         (org_id, title, deadline_at, created_by, created_by_session_id, category_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COT_RFQ}`,
      [orgId, title, input.deadlineAt ?? null, actor.id, actor.sessionId, input.categoryId ?? null],
    )
    .catch(nemLoiNhomHang);
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("Câu INSERT rfq_packages không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_CREATED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload:
      hang.category_id === null
        ? { requiresDualApproval: hang.requires_dual_approval }
        : { requiresDualApproval: hang.requires_dual_approval, categoryId: hang.category_id },
  });

  return doiRfq(hang);
}

/**
 * [S1.201 / S3.6a] Lời từ chối của CSDL về nhóm hàng của gói, đổi thành lời có tên: nhánh *nhóm đã ngừng dùng* của trigger
 * `rfq_packages_nhom_hang` mang tên ràng buộc, khoá ngoại theo (tổ chức, nhóm) mang tên của nó — một nhóm của tổ chức khác là
 * KHÔNG TÌM THẤY, như mọi thứ ngoài RLS. Lỗi khác đi nguyên.
 */
function nemLoiNhomHang(loi: unknown): never {
  const { code, constraint } = (loi ?? {}) as { code?: unknown; constraint?: unknown };
  if (code === "23514" && constraint === "nhom_hang_da_ngung_dung") {
    throw new RfqError("Nhóm hàng này đã ngừng dùng — chọn một nhóm hàng khác.");
  }
  if (code === "23503" && constraint === "rfq_packages_category_fkey") {
    throw new RfqError("Không tìm thấy nhóm hàng trong tổ chức đang gắn.");
  }
  throw loi;
}

/**
 * [S1.201 / S3.6a] Gán hay đổi nhóm hàng của một gói ĐANG SOẠN. Lớp chặn cuối là trigger `rfq_packages_nhom_hang`
 * (`085_nhom_hang`): cột chỉ đổi ở DRAFT, và chỉ nhận nhóm còn dùng — dưới khoá chia sẻ theo nhóm, nên một lần ngừng dùng chen
 * vào thì xếp hàng. Vế `AND status = 'DRAFT'` là khuôn [H-3]: gói đã rời DRAFT là lời từ chối trạng thái có tên, không phải
 * một lần ghi đè im lặng.
 */
export async function datNhomHangChoGoi(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly categoryId: string; readonly actorSessionId: string },
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "datNhomHangChoGoi");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const { rows } = await client
    .query<HangRfq>(
      `UPDATE public.rfq_packages SET category_id = $2
        WHERE id OPERATOR(pg_catalog.=) $1 AND status OPERATOR(pg_catalog.=) 'DRAFT' RETURNING ${COT_RFQ}`,
      [input.rfqId, input.categoryId],
    )
    .catch(nemLoiNhomHang);
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không còn ở trạng thái soạn thảo");
  }
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_CATEGORY_SET",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { categoryId: input.categoryId },
  });
  return doiRfq(hang);
}

/** [S1.279 / S4.7a] Miền của số ngày giao yêu cầu — khớp `CHECK` `rfq_packages_so_ngay_giao_mien` (`112`). */
export const SO_NGAY_GIAO_TOI_DA = 3650;

/**
 * [S1.279 / S4.7a / L16] Đặt, đổi hay xoá (`null`) số ngày giao yêu cầu của một gói ĐANG SOẠN — cơ sở của chi phí trễ giao
 * (`chi_phi_tre`, spec S4 §4.8). Lớp chặn cuối là trigger `rfq_packages_so_ngay_giao` (`112_tco`): cột chỉ đổi ở DRAFT. Vế
 * `AND status = 'DRAFT'` là khuôn [H-3] của `datNhomHangChoGoi`. Con số nằm trong chữ ký phê duyệt (băm riêng của `112` (3)): gói trả
 * về DRAFT rồi đổi số ngày giao thì chữ ký cũ không mở được nó nữa.
 */
export async function datSoNgayGiao(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly soNgayGiao: number | null; readonly actorSessionId: string },
): Promise<{ readonly rfqId: string; readonly soNgayGiao: number | null }> {
  await assertTenantBound(client, orgId, "datSoNgayGiao");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const n = input.soNgayGiao;
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > SO_NGAY_GIAO_TOI_DA)) {
    throw new RfqError(`số ngày giao yêu cầu phải là số nguyên từ 1 đến ${String(SO_NGAY_GIAO_TOI_DA)}`);
  }
  const { rows } = await client.query<{ id: string; so_ngay_giao: number | null }>(
    `UPDATE public.rfq_packages SET so_ngay_giao = $2::pg_catalog.int4
      WHERE id OPERATOR(pg_catalog.=) $1 AND status OPERATOR(pg_catalog.=) 'DRAFT' RETURNING id, so_ngay_giao`,
    [input.rfqId, n],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError("không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không còn ở trạng thái soạn thảo");
  }
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_DELIVERY_DAYS_SET",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { soNgayGiao: hang.so_ngay_giao },
  });
  return { rfqId: hang.id, soNgayGiao: hang.so_ngay_giao };
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
    `INSERT INTO public.rfq_items (org_id, rfq_id, line_no, description, quantity, unit,
                            created_by, created_by_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COT_ITEM}`,
    [orgId, input.rfqId, input.lineNo, description, input.quantity, unit, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("Câu INSERT rfq_items không trả về hàng nào");

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
    `SELECT ${COT_RFQ} FROM public.rfq_packages WHERE id OPERATOR(pg_catalog.=) $1`,
    [rfqId],
  );
  const hang = rows[0];
  return hang === undefined ? null : doiRfq(hang);
}

/**
 * [S1.286 / S4.7b2 / L16] Thước TCO chụp lúc vào OPEN (`112` (4), `117`): tập mã thành phần của phiên bản ghim theo thứ tự chính sách,
 * và nhóm khoá `tco` của cùng phiên bản (`{}` khi phiên bản không khai). `null` khi gói chưa có ảnh chụp (chưa mở, mở trước S4.5a, hay
 * phiên bản ghim không khai trọng số). KHÔNG nằm trong `RfqRecord` — mọi route trả `RfqRecord`, kể cả route agent: tham số quy đổi chỉ đi
 * ra ở route khách, lọc theo mã bật (rà soát §S1.286 — THẤP-3; `/policy/versions` vẫn `agent: false`).
 */
export interface ThuocTcoGoi {
  readonly ma: readonly string[];
  readonly thamSo: Readonly<Record<string, string>>;
}

export async function docThuocTcoGoi(client: pg.PoolClient, orgId: string, rfqId: string): Promise<ThuocTcoGoi | null> {
  await assertTenantBound(client, orgId, "docThuocTcoGoi");
  const { rows } = await client.query<{ ma: string[] | null; tham_so: Record<string, string> | null }>(
    "SELECT tco_ma_ghim AS ma, tco_tham_so_ghim AS tham_so FROM public.rfq_packages WHERE id OPERATOR(pg_catalog.=) $1",
    [rfqId],
  );
  const h = rows[0];
  if (h === undefined || h.ma === null) return null;
  return { ma: h.ma, thamSo: h.tham_so ?? {} };
}

export async function listRfqItems(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<RfqItemRecord[]> {
  await assertTenantBound(client, orgId, "listRfqItems");
  const { rows } = await client.query<HangItem>(
    `SELECT ${COT_ITEM} FROM public.rfq_items WHERE rfq_id OPERATOR(pg_catalog.=) $1 ORDER BY line_no`,
    [rfqId],
  );
  return rows.map(doiItem);
}

export async function submitRfqForApproval(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "submitRfqForApproval");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  // [S1.166 / S3.1b / K1 · K12] Chốt ngân sách TRƯỚC câu ghi: cùng hàm vị từ mà trigger ở cạnh
  // (`072_bac_cua_goi`) gọi lại, nên đường thuận ném một lời từ chối CÓ TÊN — và vào sổ khi bảng nói thế —
  // còn trigger chỉ tự nói khi có tranh chấp thật (một lần ký chính sách chen vào giữa hai câu).
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_NGAN_SACH, [orgId, input.rfqId]);
  // [S1.201 / S3.6a] Chốt nhóm hàng, cùng khuôn: hàm vị từ `rfq_chot_nhom_hang` hỏi trên hàng DRAFT, trigger ở cạnh hỏi lại
  // trên giá trị MỚI của cột. Sau K1: gói thiếu cả hai nhận lời từ chối về ngân sách trước.
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_NHOM_HANG, [orgId, input.rfqId]);
  // [S1.269 / S3.3c2 / K2] Cạnh tranh tối thiểu, cùng khuôn — sau K1 vì hàm vị từ đọc bậc mà ngân sách ghim (gói thiếu ngân sách
  // nhận lời từ chối của K1). Trigger `rfq_packages_kiem_so_ncc_khi_nop` hỏi lại dưới READ COMMITTED.
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_CANH_TRANH, [orgId, input.rfqId]);
  // [S1.270 / S3.3d / K3] Xoay vòng, cùng khuôn, sau K2 — cùng thứ tự hai trigger ở cạnh.
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_XOAY_VONG_NOP, [orgId, input.rfqId]);

  const { rows } = await client.query<HangRfq>(
    // [H-3] `AND status = 'DRAFT'`: không có vế này, gọi lại hàm trên một RFQ đã ở trạng thái
    // đích là một lần ghi đè IM LẶNG — kiểm (a) của trigger bỏ qua vì status không đổi.
    `UPDATE public.rfq_packages SET status = 'PENDING_APPROVAL',
            submitted_by = $2, submitted_by_session_id = $3
      WHERE id OPERATOR(pg_catalog.=) $1 AND status OPERATOR(pg_catalog.=) 'DRAFT' RETURNING ${COT_RFQ}`,
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
  // [S1.203 / S3.6b1] Ảnh chụp tín hiệu chia nhỏ lúc gói vừa rời DRAFT, cùng giao dịch (spec §4.6: *"tính ở
  // DRAFT→PENDING_APPROVAL"*). Không chặn gì; tổ chức chưa bật hay gói không có tín hiệu thì không ghi gì.
  await ghiTinHieuKhiNop(client, orgId, hang.id, actor);
  return doiRfq(hang);
}

/**
 * [S1.186 / S3.2b1 / K4a · ADR-084 ⑵] Trả một gói đang chờ duyệt về `DRAFT` — đường DUY NHẤT để đổi danh sách mời hay nội
 * dung sau khi nộp duyệt, và chỉ ở tổ chức đã bật S3 (chủ dự án chốt ngày 2026-09-27). Lớp chặn cuối là trigger
 * `rfq_packages_tra_ve_nhap_chi_khi_bat_s3` (`077_tra_ve_nhap`).
 *
 * AI: người TẠO gói (giữ `rfq.create`) rút về để sửa, hoặc người giữ `rfq.approve` trả về thay vì không ký. Hai nhánh là hai lần
 * `requirePermission`, nên mỗi lần từ chối vào sổ (D5) — `hasPermission` không ra mặt tiền gói, vì một cổng quyền im lặng là đúng
 * thứ nó được giấu đi để tránh. Hệ quả, nói ra: người tạo gói đã mất `rfq.create` mà còn giữ `rfq.approve` bị từ chối ở nhánh
 * người tạo. Không vai nào hôm nay rơi vào ca ấy — mọi vai giữ `rfq.approve` cũng giữ `rfq.create`, và test ghim điều ấy.
 *
 * LÝ DO bắt buộc (chủ dự án chốt ngày 2026-09-28) và nằm trong sổ, không trong cột: cạnh này đi được nhiều lần, một cột chỉ giữ
 * lần cuối (`016` §(3)). Không xoá chữ ký nào — chữ ký cũ mất hiệu lực bằng băm khi nội dung hay danh sách đổi (K4b).
 * **[S1.198 / khoản 257]** Người, phiên, lần nộp bị trả và lý do nay CŨNG nằm trong CSDL — một hàng `rfq_tra_ve` chèn trước câu đổi
 * trạng thái, mà cạnh đòi (`087_lan_nop_da_xem`): K4b đọc nó để bỏ chữ ký của chính người trả về. Hàng sổ giữ nguyên.
 *
 * Tổ chức chưa bật: lời từ chối có tên và KHÔNG vào sổ — nó nói cấu hình chưa sẵn sàng, không nói người dùng đi sai (ADR-060).
 */
export async function returnRfqToDraft(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly reason: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "returnRfqToDraft");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows: goi } = await client.query<{ created_by: string; da_bat: boolean }>(
    `SELECT p.created_by, public.to_chuc_da_bat_s3(p.org_id) AS da_bat
       FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $1`,
    [input.rfqId],
  );
  const g = goi[0];
  if (g === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }
  if (!g.da_bat) throw new RfqError("chỉ tổ chức đã bật S3 mới trả gói về nháp được");

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: g.created_by === actor.id ? PERMISSIONS.RFQ_CREATE : PERMISSIONS.RFQ_APPROVE,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );
  const reason = batBuoc(input.reason, "reason", 2000);

  // [S1.198 / khoản 257] Khoá hàng gói rồi hỏi trạng thái TRƯỚC khi chèn hàng trả về: trigger của `rfq_tra_ve` từ chối gói không
  // chờ duyệt bằng một lỗi CSDL, còn lời từ chối trạng thái của hàm này là một `RfqError` có tên — giữ nguyên hợp đồng ấy.
  const { rows: khoa } = await client.query<{ status: string }>(
    `SELECT p.status FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $1 FOR NO KEY UPDATE`,
    [input.rfqId],
  );
  if (khoa[0]?.status !== "PENDING_APPROVAL") {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }
  await client.query(
    `INSERT INTO public.rfq_tra_ve (org_id, rfq_id, returned_by, returned_by_session_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, input.rfqId, actor.id, actor.sessionId, reason],
  );

  const { rows } = await client.query<HangRfq>(
    // [H-3] `AND status = 'PENDING_APPROVAL'`, cùng lý do với `submitRfqForApproval`: gọi lại trên một gói đã ở DRAFT là
    // một lần ghi IM LẶNG nếu thiếu vế này — trigger bỏ qua vì status không đổi — và sổ sẽ mang một lần trả về không có.
    `UPDATE public.rfq_packages SET status = 'DRAFT'
      WHERE id OPERATOR(pg_catalog.=) $1 AND status OPERATOR(pg_catalog.=) 'PENDING_APPROVAL' RETURNING ${COT_RFQ}`,
    [input.rfqId],
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
    action: "RFQ_RETURNED_TO_DRAFT",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: { reason },
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
  /**
   * [S1.198 / khoản 256] Lần nộp mà người duyệt đã XEM (`RfqRecord.lanNop` của lần đọc gói). Trigger `rfq_approvals_so_lan_nop`
   * khoá hàng gói rồi so: tổ chức đã bật — bắt buộc, khác lần nộp hiện tại thì từ chối (gói đã được trả về và nộp lại sau lúc ấy);
   * tổ chức chưa bật — tuỳ chọn, gửi thì phải đúng, không gửi thì như MVP1. Hàm này KHÔNG tự điền: điền lần nộp hiện tại thay người
   * duyệt là đúng lỗ mà cột này đóng.
   */
  readonly lanNopDaXem?: number;
}

export async function approveRfq(
  client: pg.PoolClient,
  orgId: string,
  input: ApproveRfqInput,
  auditPool: pg.Pool,
): Promise<void> {
  await assertTenantBound(client, orgId, "approveRfq");
  const actor = await resolveSessionActor(client, orgId, input.sessionId);

  try {
    await client.query(
      `INSERT INTO public.rfq_approvals (org_id, rfq_id, approver_user_id, session_id, lan_nop_da_xem)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, input.rfqId, actor.id, actor.sessionId, input.lanNopDaXem ?? null],
    );
  } catch (loi) {
    // [S1.167 / khoản 247 / ADR-104] D2 ở bước DUYỆT GÓI — người tạo tự duyệt, phiên không hợp lệ, phiên của người khác — sống
    // ở trigger `rfq_kiem_nguoi_duyet` (`011`): `RAISE … (D2)` với 23514 huỷ giao dịch, nên trước vòng này lần vi phạm không để lại
    // hàng sổ nào (`pnpm pilot:gia-lap`: người tạo tự duyệt gói ⇒ 422 *"(D2)"*, 0 hàng). ~~Cùng khuôn nhánh D2 của `approveUnseal`:
    // ghi ở `auditPool` rồi ném lại CHÍNH lỗi của trigger, nên mã 422 và thông điệp không đổi; trigger vẫn là lớp có thẩm quyền.~~
    // **[S1.180 / ADR-108]** Vẫn bắt chính lỗi của trigger — trigger vẫn là lớp có thẩm quyền — nhưng nhận ra nó bằng TÊN RÀNG
    // BUỘC (`074_tu_choi_co_ten.sql`), không bằng hậu tố *"(D2"*, và từ chối theo chốt: một hàng `CONTROL_DENIED` mang mã ở giao
    // dịch độc lập rồi `ChotKiemSoatError` (422, thông điệp của bảng `CHOT_VAO_SO`) mang lỗi `pg` ở `cause`.
    // Lần từ chối vì TRẠNG THÁI (gói không ở `PENDING_APPROVAL`) không mang tên và đi thẳng như cũ.
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }

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
export interface OpenRfqInput {
  readonly rfqId: string;
  /** [ADR-016] Phiên của chính người mở. */
  readonly actorSessionId: string;
  /**
   * [ADR-019 / C5 / ADR-062] Bộ sinh cặp khoá TỔ CHỨC. Nó là THAM SỐ BẮT BUỘC, và đó là điểm đáng
   * đọc của hàm này: mở một RFQ mà không sinh cặp khoá cho nó là một việc KHÔNG diễn đạt được nữa.
   * Khoá riêng RFQ được bọc bằng khoá công khai tổ chức; bộ sinh chỉ được gọi ở lần mở đầu tiên.
   *
   * Kiểu này được `@trustprocure/sealed-envelope` chuyển tiếp, nên `packages/rfq` KHÔNG có một
   * cạnh phụ thuộc nào tới `@trustprocure/crypto-keys`.
   */
  readonly orgKeys: OrgKeyProvisioner;
}

/**
 * [C5] Mở RFQ VÀ sinh vật liệu khoá — trong CÙNG một giao dịch, theo CÙNG một thứ tự, mỗi lần.
 *
 * Thứ tự ở đây không phải một sở thích: migration 017 đòi RFQ còn ở `PENDING_APPROVAL` lúc INSERT
 * khoá (vế "không sớm hơn") và đòi nó đã sang `OPEN` lúc COMMIT (vế "không mồ côi"). Đảo hai câu
 * lệnh dưới đây thì CSDL từ chối — nên thứ tự này được cưỡng chế, không được ghi nhớ.
 *
 * Người gọi phải mở giao dịch. Hàm này KHÔNG tự `BEGIN`: nếu nó tự mở, hai câu lệnh dưới sẽ nằm
 * trong một giao dịch KHÁC với phần việc còn lại của người gọi, và vế "cùng giao dịch" trở thành
 * một lời khai thay vì một sự thật.
 */
export async function openRfq(
  client: pg.PoolClient,
  orgId: string,
  input: OpenRfqInput,
  auditPool: pg.Pool,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "openRfq");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  // [khoản nợ 31] TRƯỚC lần đúc khoá, không sau: `issueRfqKeyPair` ghi một hàng
  // `rfq_key_material` và một bản ghi kiểm toán, và một lần từ chối sau đó chỉ dọn được chúng
  // bằng rollback của người gọi — thứ hàm này không kiểm soát.
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_OPEN,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );
  // [S1.281 / S3.4a / K9] Chữ ký của người đã khai CÓ xung đột không đếm — hỏi TRƯỚC K5 và K10a, cùng thứ tự trigger ở cạnh (tên
  // `…_kiem_chu_ky_xung_dot_khi_mo` xếp trước `…_kiem_danh_sach_khi_mo` của K4b): lời có tên chỉ khi K9 làm thiếu chữ ký; thiếu vì lý
  // do khác thì K4b nói ở câu UPDATE, không hàng sổ.
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_CHU_KY_XUNG_DOT_MO, [orgId, input.rfqId]);
  // [S1.269 / S3.3c2 / K5] Chữ ký độc lập, cùng khuôn, TRƯỚC K10a — cùng thứ tự với hai trigger ở cạnh (tên `…_kiem_doc_lap_khi_mo`
  // xếp trước `…_kiem_tin_hieu_khi_mo`).
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_CHU_KY_DOC_LAP, [orgId, input.rfqId]);
  // [S1.203 / S3.6b1] K10a, cùng khuôn K1: hỏi hàm vị từ `rfq_chot_tin_hieu` TRƯỚC `issueRfqKeyPair` (khoản 31) — lần từ chối ghi
  // sổ ở giao dịch độc lập, và câu ghi sổ của lần đúc khoá giữ khoá chuỗi của tổ chức tới COMMIT. Trigger ở cạnh hỏi lại.
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_TIN_HIEU, [orgId, input.rfqId]);
  // [S1.270 / S3.3d / K3 · lượt soi hình dạng T5] Khoá chính sách ĐỘC QUYỀN của tổ chức TRƯỚC lần đúc khoá: lần đúc ghi sổ (khoá chuỗi
  // sổ, seed 0) và trigger `102` ở cạnh lấy khoá này sau đó — thứ tự cũ 0 → 2 ngược với ký phiên bản chính sách (2 → 0), đủ cho một
  // deadlock. Nay mọi đường lấy 2 → 0. Khoá ấy cũng xếp hàng mọi lần mở trong tổ chức, nên K3 hỏi dưới nó thấy gói vừa mở trước.
  await client.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::pg_catalog.uuid::pg_catalog.text, 2))",
    [orgId],
  );
  // [S1.270 / S3.3d / K3] Xoay vòng ở cạnh mở — cửa sổ chỉ đếm gói ĐÃ MỞ, nên các gói nộp song song cùng một bộ nhà cung cấp đều
  // qua lúc nộp; sau K10a, cùng thứ tự trigger (`…_kiem_xoay_vong_khi_mo` cuối cạnh).
  await kiemChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_XOAY_VONG_MO, [orgId, input.rfqId]);
  // [S1.279 / S4.7a / L16] Phiên bản sắp ghim tính chi phí trễ mà gói chưa khai số ngày giao ⇒ từ chối CẤU HÌNH có tên, TRƯỚC lần đúc
  // khoá (khoản 31). Dưới khoá chính sách vừa lấy, nên phiên bản hiệu lực không đổi giữa câu này và trigger `rfq_packages_tco_khi_mo`
  // — trigger hỏi lại cùng câu trên phiên bản đã ghim. Không vào sổ (L12: từ chối vì cấu hình chưa sẵn sàng).
  // `LATERAL`: hàm chọn phiên bản chạy MỘT lần (rà soát §S1.279 — THẤP-9), không một lần mỗi hàng chính sách của tổ chức.
  const { rows: tco } = await client.query<{ thieu: boolean; da_bat: boolean }>(
    `SELECT (p.so_ngay_giao IS NULL
             AND pg_catalog.jsonb_path_exists(o.eval_components, '$[*] ? (@.ma == "chi_phi_tre")')) AS thieu,
            public.to_chuc_da_bat_s3(p.org_id) AS da_bat
       FROM public.rfq_packages p
      CROSS JOIN LATERAL (SELECT public.chinh_sach_hieu_luc(p.org_id, pg_catalog.clock_timestamp()) AS id) g
       JOIN public.org_procurement_policies o
         ON o.org_id OPERATOR(pg_catalog.=) p.org_id AND o.id OPERATOR(pg_catalog.=) g.id
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.rfqId],
  );
  if (tco[0]?.thieu === true) {
    // [rà soát §S1.279 — TRUNG-5] Tổ chức chưa bật S3 không có cạnh về DRAFT (`077`): lời từ chối không được chỉ một lối không có.
    throw new RfqError(
      "Phiên bản chính sách đang hiệu lực tính chi phí trễ giao, mà gói thầu chưa khai số ngày giao yêu cầu (L16) — " +
        (tco[0].da_bat
          ? "trả gói về soạn thảo để khai số ngày giao, rồi nộp duyệt lại."
          : "số ngày giao chỉ khai được khi soạn, và gói đã nộp duyệt không trả về soạn thảo được ở tổ chức chưa bật kiểm soát S3: " +
            "gói này chỉ còn lối huỷ; khai số ngày giao cho gói soạn mới."),
    );
  }

  // Sinh khoá TRƯỚC lần UPDATE. Xem khối chú thích trên.
  await issueRfqKeyPair(client, orgId, {
    rfqId: input.rfqId,
    actorSessionId: input.actorSessionId,
    orgKeys: input.orgKeys,
  });

  const { rows } = await client.query<HangRfq>(
    `UPDATE public.rfq_packages SET status = 'OPEN', opened_at = pg_catalog.now(),
            opened_by = $2, opened_by_session_id = $3
      WHERE id OPERATOR(pg_catalog.=) $1 AND status OPERATOR(pg_catalog.=) 'PENDING_APPROVAL' RETURNING ${COT_RFQ}`,
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
    `UPDATE public.rfq_packages
        SET status = 'CLOSED', closed_at = pg_catalog.now(),
            early_close_reason = CASE WHEN pg_catalog.now() OPERATOR(pg_catalog.<) deadline_at THEN $2::pg_catalog.text ELSE NULL END,
            closed_by = $3, closed_by_session_id = $4
      WHERE id OPERATOR(pg_catalog.=) $1 AND status OPERATOR(pg_catalog.=) 'OPEN' RETURNING ${COT_RFQ}`,
    [input.rfqId, reason, actor.id, actor.sessionId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "không tìm thấy RFQ trong tổ chức đang gắn, hoặc nó không ở trạng thái nguồn hợp lệ",
    );
  }

  // [S1.9101 / S3.6c / K10c] Ảnh chụp tín hiệu ĐÓNG SỚM — SAU câu đóng, TRƯỚC hàng sổ. Đóng đúng hạn, không luồng báo giá nào, hay tổ
  // chức chưa bật thì `tin_hieu_dong_som` trả NULL và không hàng nào được ghi; đóng sớm khi đã có báo giá chặn CHỮ KÝ duyệt trao thầu
  // tới khi một người giữ `po.approve` ngoài gói đọc nó — vế *"phê duyệt riêng khi đã có báo giá"* mà `011` §(H-4) hoãn.
  await ghiTinHieuKhiDongSom(client, orgId, hang.id, actor);

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
 *   (5) THÔNG BÁO cho toàn bộ nhà cung cấp đã mời -> ~~**KHÔNG CÓ**. Lời mời là S1.3.~~
 *       **[S1.8] ĐÃ CÓ.** Một job outbox cho MỖI hàng `rfq_invitations` của RFQ, ghi trong CÙNG
 *       giao dịch với `UPDATE` và với bản ghi kiểm toán — nên một lần gia hạn không bao giờ tồn
 *       tại mà không có ý định thông báo đi kèm, và một lần gia hạn BỊ TỪ CHỐI (rút ngắn, sai
 *       trạng thái) không để lại job nào.
 *
 * ~~Vì (5) trống, C4 CHƯA ĐƯỢC PHỦ và không test nào ở S1.2 được mang nhãn `[INV-C4]`.~~ Câu ấy
 * hết hiệu lực ở S1.8; phần CHÊNH còn lại — *"gửi"* khác *"tới tay"* — nằm ở §4 của C4.
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

  // [S1.151 / khoản 127] `docRfq` còn ở đây chỉ để giữ lời từ chối "không tìm thấy RFQ" cho một RFQ không thấy được (RLS) — nó KHÔNG còn
  // là nguồn của phép so hạn, cũng không là nguồn của `truoc`.
  await docRfq(client, input.rfqId);

  // [REVIEW AN NINH S1.7 — MED-1] Hạn mới phải LỚN HƠN hạn cũ, không chỉ "không nhỏ hơn".
  //
  // Trigger của 011 chặn `NEW < OLD`; nó KHÔNG chặn `NEW = OLD`, và kiểm (c) của nó có vế bảo vệ
  // `NEW IS DISTINCT FROM OLD` nên với hạn BẰNG NHAU thì phép kiểm trạng thái cũng không chạy.
  // Hệ quả đo được từ chính hai câu ấy: gọi hàm này với ĐÚNG hạn hiện tại trên một RFQ đã
  // `CLOSED`, `UNSEALED` hay `CANCELLED` sẽ đi lọt cả hai lớp, rồi ghi một bản ghi kiểm toán
  // *"RFQ_DEADLINE_EXTENDED"* cho một lần gia hạn KHÔNG XẢY RA — vào một bảng chỉ ghi thêm, sau
  // khi mở thầu, tức đúng lúc sổ kiểm toán đang bị đọc để phán xử — cộng một thông báo gửi cho
  // toàn bộ nhà cung cấp của một RFQ đã đóng.
  //
  // Đây là phép kiểm ở tầng ỨNG DỤNG cho một điều CSDL cố ý không nói: CSDL cấm LÙI, nó không
  // định nghĩa "gia hạn" là gì. Định nghĩa ấy là của hàm này.
  // ~~[S1.72 / lượt soi ngang 66c-5] Phép kiểm này đọc hàng KHÔNG khoá: hai lần gia hạn ĐỒNG THỜI tới cùng một hạn cùng qua, lần sau chờ khoá
  // hàng ở câu UPDATE rồi ghi `RFQ_DEADLINE_EXTENDED` cho một lần gia hạn không đổi gì (đọc, lượt soi 65c-8) — khoản 127.~~
  //
  // [S1.151 / khoản 127 — ĐÓNG] Phép so nay nằm TRONG CHÍNH câu ghi, không ở một phép đọc trước nó. Bản trước so trên hàng `docRfq` đọc
  // KHÔNG khoá; hai lần gia hạn đồng thời tới cùng hạn D1 đều thấy D0, đều qua; lần sau chờ khoá hàng ở `UPDATE`, rồi ghi D1 lên D1 và ghi
  // `RFQ_DEADLINE_EXTENDED` với `truoc` = D0 cho một lần gia hạn không đổi gì. Nay:
  //   * vị từ `p.deadline_at IS NULL OR p.deadline_at < $2` tự tham chiếu HÀNG ĐÍCH, nên dưới READ COMMITTED lần sau chờ khoá hàng rồi
  //     EvalPlanQual đánh giá LẠI nó trên tuple ĐÃ cập nhật (D1 < D1 sai) ⇒ 0 hàng ⇒ `RfqError` cùng lời với ca tuần tự. Vế `IS NULL`
  //     giữ nguyên hành vi cũ: `deadline_at` được NULL ở DRAFT/CANCELLED (CHECK của 009), và bản cũ cho gia hạn khi hạn cũ là NULL;
  //   * `truoc` lấy từ CTE `cu` khoá hàng `FOR NO KEY UPDATE` (khuôn `taoLuotDanhGia`): khoá chờ lần kia COMMIT rồi trả phiên bản MỚI
  //     NHẤT, và từ lúc CTE giữ khoá không ai đổi được hàng tới câu UPDATE — nên `cu.truoc` đúng là hạn ngay trước lần ghi này.
  //     (`RETURNING` trần trả giá trị MỚI, không dùng được cho `truoc`.) KHÔNG đưa phép so vào CTE: CTE không được tính lại khi
  //     EvalPlanQual chạy — cạm bẫy đã ghi ở khối chú thích trên `CAU_DAT_COC` của `packages/identity/src/mfa-credentials.ts`; vị từ ở `WHERE` trên `p` mới là thứ được tính lại.
  //   * Lần từ chối này KHÔNG ghi sổ — y như lần từ chối tuần tự trước đây (ADR-060: `RfqError` của hàm này không thuộc bảy mã chuỗi, và
  //     hàm không nhận `auditPool`); giao dịch của người gọi rollback, không để lại hạn, sổ hay job nào.
  const { rows } = await client.query<HangRfq & { truoc: Date | null }>(
    `WITH cu AS (
       SELECT c.deadline_at AS truoc FROM public.rfq_packages c
        WHERE c.id OPERATOR(pg_catalog.=) $1
        FOR NO KEY UPDATE
     )
     UPDATE public.rfq_packages p SET deadline_at = $2
       FROM cu
      WHERE p.id OPERATOR(pg_catalog.=) $1
        AND (p.deadline_at IS NULL OR p.deadline_at OPERATOR(pg_catalog.<) $2)
     RETURNING ${COT_RFQ}, cu.truoc`,
    [input.rfqId, input.newDeadlineAt],
  );
  const hang = rows[0];
  if (hang === undefined) {
    throw new RfqError(
      "gia hạn phải đẩy hạn nộp RA XA hơn hạn hiện tại; hạn bằng nhau không phải một lần gia hạn",
    );
  }

  // [C4 vế 5] MỘT job cho MỖI lời mời, trong CÙNG giao dịch. Đọc danh sách người nhận từ CSDL
  // ngay tại đây chứ không nhận nó làm tham số: một tham số `recipients` là một danh sách mà
  // người gọi có thể rút ngắn, và lúc ấy mệnh đề *"toàn bộ nhà cung cấp đã mời"* thành một lời
  // hứa của người gọi. Ở đây nó là một câu `SELECT`.
  //
  // KHÔNG lọc theo `status` của lời mời: một nhà cung cấp đã từ chối vẫn được biết hạn đã đổi —
  // họ có thể đổi ý, và giấu thông tin ấy đi là một cách thiên vị người còn lại.
  //
  // `dedupe_key` mang cả hạn MỚI: gia hạn hai lần là hai thông báo, còn một lần retry của cùng
  // giao dịch là một. Payload KHÔNG mang `reason` — lý do là văn bản tự do của người mua và nó
  // có thể chứa một con số (xem DƯ LƯỢNG ở trên); nó thuộc sổ kiểm toán, không thuộc thứ gửi ra
  // ngoài cho nhà cung cấp.
  const moc = hang.deadline_at?.toISOString() ?? "";
  const { rows: loiMoi } = await client.query<{ id: string }>(
    "SELECT id FROM public.rfq_invitations WHERE rfq_id OPERATOR(pg_catalog.=) $1 ORDER BY id",
    [hang.id],
  );
  for (const lm of loiMoi) {
    await enqueueJob(client, orgId, {
      // [S1.239 / khoản 161] `kind` LITERAL tại chỗ gọi (union `KindOutbox`; hằng `RFQ_DEADLINE_NOTICE_KIND` là khoá bảng handler của
      // `api`) — cổng tests/architecture/kind-outbox-mot-cho.test.ts.
      kind: "RFQ_DEADLINE_EXTENDED_NOTICE",
      payload: { rfqId: hang.id, invitationId: lm.id, newDeadlineAt: moc },
      dedupeKey: `deadline:${hang.id}:${lm.id}:${moc}`,
    });
  }

  // [S1.71 / khoản 123, lượt soi 65a-7] Xếp job TRƯỚC lần ghi sổ: lần ghi sổ đầu của giao dịch lấy khoá tư vấn ghi sổ của tổ chức
  // (`noi_chuoi_kiem_toan()`) và giữ nó tới COMMIT, nên mỗi lời mời xếp SAU lần ghi sổ kéo dài thời gian giữ khoá — đo trên tiến trình
  // `api` thật, bản trước: 50 / 200 / 400 lời mời giữ khoá 21 / 104 / 225 ms (§S1.71) —, trong khi mọi lần ghi sổ khác của tổ chức
  // chờ khoá ấy tối đa 2 s (050). Job và bản ghi vẫn cùng giao dịch: hỏng ở đâu thì cả hai cùng rollback.
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_DEADLINE_EXTENDED",
    resourceType: "rfq_package",
    resourceId: hang.id,
    payload: {
      reason,
      truoc: hang.truoc?.toISOString() ?? null,
      sau: hang.deadline_at?.toISOString() ?? null,
    },
  });

  // [S1.71 / khoản 123, lượt soi 65c-1] ĐỌC LẠI lời mời SAU lần ghi sổ. Câu SELECT ở trên chạy TRƯỚC lúc chờ khoá ghi sổ, nên nó không
  // thấy một lời mời mà giao dịch tạo ra đã ghi sổ (`createInvitation` ghi `INVITATION_CREATED` trong cùng giao dịch) nhưng chỉ COMMIT
  // trong lúc lần ghi sổ ở trên chờ khoá — bản trước ghi sổ rồi mới đọc nên thấy nó. Từ lúc lần ghi sổ ở trên lấy được khoá, giao dịch
  // này giữ khoá tới COMMIT: lời mời nào đã ghi sổ trước lúc ấy thì đã COMMIT và câu đọc dưới thấy; lời mời nào tới lần ghi sổ sau lúc ấy
  // thì chờ giao dịch này COMMIT, hay gãy ở trần 2 s — cùng bảo đảm với bản trước (đọc). Bình thường không có hàng mới, nên phần giữ khoá
  // chỉ thêm một câu đọc.
  const daXep = new Set(loiMoi.map((lm) => lm.id));
  const { rows: loiMoiSauGhiSo } = await client.query<{ id: string }>(
    "SELECT id FROM public.rfq_invitations WHERE rfq_id OPERATOR(pg_catalog.=) $1 ORDER BY id",
    [hang.id],
  );
  for (const lm of loiMoiSauGhiSo) {
    if (!daXep.has(lm.id)) {
      await enqueueJob(client, orgId, {
        kind: "RFQ_DEADLINE_EXTENDED_NOTICE",
        payload: { rfqId: hang.id, invitationId: lm.id, newDeadlineAt: moc },
        dedupeKey: `deadline:${hang.id}:${lm.id}:${moc}`,
      });
    }
  }

  return doiRfq(hang);
}

export async function cancelRfq(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly reason: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<RfqRecord> {
  await assertTenantBound(client, orgId, "cancelRfq");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  // [khoản nợ 31] Đây là vế NẶNG của khoản nợ ấy: huỷ thì thu hồi TOÀN BỘ vật liệu khoá của
  // RFQ, 017 cấm bỏ dấu thu hồi, và worker lọc `revoked_at IS NULL`. Một lời gọi không có phép
  // kiểm nào ở đây làm báo giá của một gói thầu VĨNH VIỄN không mở được.
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_CANCEL,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );
  const reason = batBuoc(input.reason, "reason", 2000);

  // [S1.165 / khoản 225] Danh sách trắng thêm BỐN trạng thái nguồn — `CLOSED`, `UNSEALED` và hai ảnh
  // BAFO — cùng lúc bảng cạnh của `071` thêm bốn cạnh; hai lớp đổi trong CÙNG vòng, như `058`. Trước
  // vòng ấy, một gói bị từ chối chấm vì lệch tiền tệ (khoản 244) đứng yên ở `UNSEALED` mãi mãi. Lý do
  // nay đi vào `cancel_reason` cho MỌI lần huỷ — nhà cung cấp đọc nó ở trang nộp thầu —, và trigger
  // đòi nó ở bốn cạnh mới dù lời gọi này đã `batBuoc` rồi: một đường ghi thứ hai không được quên nó.

  const { rows } = await client.query<HangRfq>(
    `UPDATE public.rfq_packages SET status = 'CANCELLED', cancelled_at = pg_catalog.now(),
            cancelled_by = $2, cancelled_by_session_id = $3, cancel_reason = $4
      WHERE id OPERATOR(pg_catalog.=) $1
        AND status IN ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'BAFO_OPEN', 'EVALUATING',
                       'CLOSED', 'UNSEALED', 'BAFO_CLOSED', 'BAFO_UNSEALED')
        RETURNING ${COT_RFQ}`,
    [input.rfqId, actor.id, actor.sessionId, reason],
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

  // [G4, vế "huỷ"] Thu hồi vật liệu khoá SAU khi RFQ đã sang CANCELLED — trigger
  // `rfq_key_material_chi_thu_hoi_khi_huy` (017) đòi đúng thứ tự này. Với RFQ còn DRAFT hay
  // PENDING_APPROVAL thì không có khoá nào và lời gọi này là một no-op trả về 0.
  await revokeRfqKeyMaterial(client, orgId, {
    rfqId: input.rfqId,
    reason,
    actorSessionId: input.actorSessionId,
  });
  return doiRfq(hang);
}
