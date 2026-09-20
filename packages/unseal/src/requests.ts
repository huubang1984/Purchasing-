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
import { PERMISSIONS, listUserIdsWithPermission, requirePermission, resolveSessionActor, throwAuditedDenial } from "@trustprocure/identity";
import { enqueueJob } from "@trustprocure/outbox";
import { assertUnsealAllowed, type UnsealGateReport } from "./gate.js";

/** `kind` của job mà worker tiêu thụ. Một hằng, một chỗ ở — worker đọc chính nó. */
export const UNSEAL_JOB_KIND = "UNSEAL_RFQ";
/** [S1.91 / khoản 194] Việc BÁO cho người duyệt rằng có một yêu cầu mở thầu đang chờ họ. */
export const UNSEAL_NOTICE_KIND = "UNSEAL_APPROVAL_NOTICE";

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

/**
 * [S1.90 / khoản 190] BẢN ĐỌC của một yêu cầu mở thầu — RECORD cộng hai con số đếm.
 *
 * Hai trường này KHÔNG nằm ở `UnsealRequestRecord` vì `COT` được dùng trong `RETURNING` của ba
 * câu ghi, và một `RETURNING` mang truy vấn con là một câu khác hẳn về chi phí lẫn về ngữ nghĩa
 * khoá. Đường ĐỌC trả bản rộng; đường GHI trả bản hẹp rồi người gọi đọc lại nếu cần số mới.
 *
 * `requiredApprovals` gọi ĐÚNG hàm mà cổng `assertUnsealAllowed` gọi
 * (`public.unseal_so_phe_duyet_can`) — cố ý, để màn hình và cổng không bao giờ nói hai ngưỡng
 * khác nhau. Một bản sao của quy tắc ngưỡng ở tầng đọc là một bản sao sẽ lệch.
 */
export interface UnsealRequestView extends UnsealRequestRecord {
  readonly approvalCount: number;
  readonly requiredApprovals: number;
}

interface HangYeuCauXem extends HangYeuCau {
  /** `pg_catalog.count(*)` là `bigint`; `pg` trả nó về dưới dạng chuỗi. */
  readonly so_phe_duyet: string;
  readonly can_phe_duyet: number;
}

const COT_XEM = `r.id, r.rfq_id, r.status, r.break_glass, r.requested_by,
            (SELECT pg_catalog.count(*) FROM public.unseal_approvals a
              WHERE a.unseal_request_id OPERATOR(pg_catalog.=) r.id
                AND a.org_id OPERATOR(pg_catalog.=) r.org_id) AS so_phe_duyet,
            public.unseal_so_phe_duyet_can(r.rfq_id) AS can_phe_duyet`;

function doiYeuCauXem(h: HangYeuCauXem): UnsealRequestView {
  return {
    ...doiYeuCau(h),
    approvalCount: Number(h.so_phe_duyet),
    requiredApprovals: h.can_phe_duyet,
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
  /**
   * [REVIEW AN NINH S1.6 — HIGH-2a] Phiên của NGƯỜI LÀM CHỨNG cho một yêu cầu break-glass.
   *
   * BẮT BUỘC khi `breakGlass` bật. Break-glass bỏ qua NGƯỠNG — đó là lý do nó tồn tại — nhưng
   * nó không được bỏ qua NHÂN CHỨNG: tới trước vòng sửa này, một yêu cầu break-glass đi tới
   * `APPROVED` với KHÔNG một hàng phê duyệt nào, và chính người yêu cầu điều phối được nó. Một
   * người sở hữu trọn chuỗi, và lớp bù duy nhất là một cảnh báo mà chưa ai tiêu thụ.
   *
   * Trigger `unseal_kiem_du_phe_duyet` (022) đòi nhân chứng khác người yêu cầu VÀ khác phiên —
   * đúng hai vế mà `unseal_kiem_nguoi_duyet` đòi ở đường thường.
   */
  readonly breakGlassWitnessSessionId?: string;
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

  const breakGlass = input.breakGlass ?? false;
  let nhanChung: { id: string; sessionId: string } | null = null;
  if (breakGlass) {
    if (input.breakGlassWitnessSessionId === undefined) {
      throw new UnsealError("Break-glass phải có phiên của người làm chứng (D3).");
    }
    const nc = await resolveSessionActor(client, orgId, input.breakGlassWitnessSessionId);
    nhanChung = { id: nc.id, sessionId: nc.sessionId };
  } else if (input.breakGlassWitnessSessionId !== undefined) {
    // Một nhân chứng trên một yêu cầu KHÔNG break-glass là một hàng nói dối về đường nó đã đi.
    throw new UnsealError("Chỉ yêu cầu break-glass mới mang người làm chứng.");
  }

  const { rows } = await client.query<HangYeuCau>(
    `INSERT INTO public.unseal_requests
       (org_id, rfq_id, reason, break_glass, requested_by, requested_by_session_id,
        break_glass_witness_user_id, break_glass_witness_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COT}`,
    [
      orgId,
      input.rfqId,
      reason,
      breakGlass,
      actor.id,
      actor.sessionId,
      nhanChung?.id ?? null,
      nhanChung?.sessionId ?? null,
    ],
  );
  const h = rows[0];
  if (h === undefined) throw new UnsealError("Không ghi được yêu cầu mở thầu.");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: h.break_glass ? "UNSEAL_REQUESTED_BREAK_GLASS" : "UNSEAL_REQUESTED",
    resourceType: "unseal_request",
    resourceId: h.id,
    payload: {
      rfqId: input.rfqId,
      reason,
      ...(nhanChung === null ? {} : { breakGlassWitnessUserId: nhanChung.id }),
    },
  });

  // [S1.91 / khoản 194] BÁO CHO NGƯỜI DUYỆT — vì tới trước vòng này KHÔNG AI BÁO CHO HỌ CẢ.
  //
  // Mở thầu đòi HAI người (D2), và cho tới S1.90 `requestUnseal` không xếp một việc nào: người duyệt
  // thứ hai chỉ biết có việc chờ mình nếu một con người khác nhắn cho họ. Lượt đi thử 2026-09-20 chỉ
  // đi được tới cuối vì script gieo phát sẵn link cho cả ba vai — một tính chất của công cụ demo,
  // không phải của sản phẩm. Đo lại ở S1.91: bốn chỗ `enqueueJob` trong toàn mã sản xuất, không chỗ
  // nào báo cho người duyệt.
  //
  // NGƯỜI YÊU CẦU BỊ LOẠI khỏi danh sách, và đó không phải phép lịch sự: D2 nói họ không duyệt được,
  // nên một tin báo *"có việc chờ anh"* gửi cho chính họ là một tin sai.
  //
  // `dedupeKey` theo cặp (yêu cầu, người nhận): một kẻ tạo rồi huỷ yêu cầu liên tục không rải được
  // tin — và vì mỗi tin mang một mã đăng nhập (ADR-046), vế chống rải ấy là vế an ninh chứ không
  // phải vế lịch sự. Trần thứ hai nằm ở `LOGIN_MAX_TOKENS_PER_WINDOW` của chính `issueLoginToken`,
  // mà handler đi qua thay vì tự phát mã.
  const nguoiDuyet = await listUserIdsWithPermission(client, orgId, PERMISSIONS.RFQ_UNSEAL_APPROVE);
  for (const userId of nguoiDuyet) {
    if (userId === actor.id) continue;
    await enqueueJob(client, orgId, {
      kind: UNSEAL_NOTICE_KIND,
      payload: { unsealRequestId: h.id, rfqId: input.rfqId, userId },
      dedupeKey: `unseal-notice:${h.id}:${userId}`,
    });
  }

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
/**
 * [S1.85 / khoản 147] Hai trigger D2 của `019` nói "không" bằng `RAISE` — phân loại theo NGUYÊN VĂN thông điệp của chúng.
 *
 * Bộ lọc cũ có BA vế và **hai** trong ba là vế chết (đo, §S1.78 rồi §S1.85):
 *
 *   ~~`phai o mot PHIEN khac`~~   — câu `RAISE` thật của `019:226` là `Phe duyet phai den tu mot PHIEN KHAC voi phien da yeu cau (D2)`.
 *                                  Chuỗi cũ khớp một câu `RAISE` KHÁC, của nhánh break-glass trên bảng `unseal_requests` — một trigger
 *                                  khác trên một bảng khác, không bao giờ nổ từ câu `INSERT INTO unseal_approvals` này.
 *   ~~`mot lan tren mot yeu cau`~~ — `grep -rn 'mot lan tren mot yeu cau' db/ packages/ apps/` chỉ trả về đúng dòng regex ấy. Ca nó định
 *                                  bắt là hai ràng buộc UNIQUE của `019`, và chúng ném `23505` mang TÊN RÀNG BUỘC, không mang chuỗi ấy —
 *                                  nay là việc của `laTrungPheDuyet`.
 *
 * VẾ PHIÊN GIỮ LẠI DÙ HÔM NAY KHÔNG TỚI ĐƯỢC, và lý do phải nói ra thay vì để nó thành một vế chết thứ hai: danh tính người duyệt là
 * DẪN XUẤT của phiên (`actor.id` và `actor.sessionId` cùng đến từ `resolveSessionActor`), nên `approver_session_id = phien_yeu_cau` kéo
 * theo `approver_user_id = nguoi_yeu_cau`, và vế TỰ PHÊ DUYỆT ở trên nó trong thân trigger nổ trước. Đo được ở tầng CSDL (§S1.85): ghép
 * "người khác, cùng phiên" bằng một câu INSERT thẳng thì vế phiên NỔ — nó sống ở `019`, chỉ là `approveUnseal` không dựng được ca ấy.
 * Sửa chuỗi cho ĐÚNG là rẻ và giữ D5 đứng nếu tầng trên đổi; xoá nó là bỏ một lớp vì hôm nay không ai với tới.
 *
 * `export` KHỎI TỆP (không khỏi gói — `index.ts` không nêu nó, và `barrel-exports.test.ts` giữ điều đó) vì một vế KHÔNG tới được
 * qua đường sản xuất thì không phép đo hành vi nào ghim được nó, và một vế không ai ghim là một vế sắp chết lần nữa. Thay vào đó
 * `loc-vi-pham-d2.test.ts` ĐỌC `db/migrations/019_unseal.sql`, rút NGUYÊN VĂN các câu `RAISE` của `unseal_kiem_nguoi_duyet()` và
 * đòi vị từ này khớp đúng hai câu D2 — cùng khuôn §R3 với `ma-tran-quyen.test.ts`. Đột biến đo được (§S1.85): trả chuỗi cũ về thì
 * test ấy ĐỎ; trước vòng này không test nào đỏ, và đó chính là cách hai vế chết sống được năm vòng.
 */
export function laViPhamD2TheoThongDiep(loi: Error): boolean {
  return /khong duoc tu phe duyet|phai den tu mot PHIEN KHAC/iu.test(loi.message);
}

/**
 * [S1.85 / khoản 147] MỘT NGƯỜI — HAY MỘT PHIÊN — PHÊ DUYỆT LẦN THỨ HAI: `23505` trên `unseal_approvals`.
 *
 * Trigger CHO QUA ca này (yêu cầu còn PENDING, người duyệt khác người yêu cầu, phiên khác phiên yêu cầu); thứ chặn nó là hai ràng buộc
 * UNIQUE của `019`. Tới trước vòng này bộ lọc thông điệp không khớp `23505` nào, nên lỗi rơi thẳng xuống `throw loi` và một lần THỬ vi
 * phạm D2 để lại **0 hàng** `UNSEAL_APPROVAL_DENIED` — cùng lớp lỗi với khoản 32 / 119 / 121, ở một đường mà cổng `[INV-D5]` không phủ.
 *
 * ĐỌC `code` VÀ `constraint`, KHÔNG ĐỌC `message`: thông điệp `23505` do PostgreSQL viết và mang TÊN BẢNG cùng tên ràng buộc, còn
 * `DETAIL` của nó mang GIÁ TRỊ HÀNG — `Key (org_id, unseal_request_id, approver_user_id)=(…)` — tức đúng thứ A2 cấm đọc vào một nhánh
 * ghi log. `code` và `constraint` là hai trường riêng mà `pg` điền sẵn (đo, §S1.85).
 *
 * `053` đặt tên hai ràng buộc ấy; trước đó chúng VÔ DANH và mang tên PostgreSQL tự sinh — một dẫn xuất của danh sách cột, bị cắt ở 63
 * byte. Danh sách dưới đây là ĐÓNG và nó khớp nguyên văn `053`; `unseal.int.test.ts` ghim rằng `unseal_approvals` không có ràng buộc
 * UNIQUE nào NGOÀI hai tên này, nên một ràng buộc thứ ba không lặng lẽ đổi nghĩa của "23505 ở đây".
 */
const RANG_BUOC_TRUNG_PHE_DUYET: ReadonlySet<string> = new Set([
  "unseal_approvals_mot_nguoi_mot_lan",
  "unseal_approvals_mot_phien_mot_lan",
]);

function laTrungPheDuyet(loi: Error): boolean {
  const e = loi as { code?: unknown; constraint?: unknown };
  return e.code === "23505" && typeof e.constraint === "string" && RANG_BUOC_TRUNG_PHE_DUYET.has(e.constraint);
}

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

  // [khoản nợ 32] MỘT LẦN THỬ VI PHẠM D2 PHẢI ĐỂ LẠI DẤU VẾT.
  //
  // Hai trigger của 019 chặn tự-phê-duyệt và phê-duyệt-cùng-phiên, và chúng chặn ĐÚNG. Nhưng lời
  // từ chối của chúng làm ROLLBACK cả giao dịch này — kể cả bản ghi `UNSEAL_APPROVED` ở dưới —
  // nên tới trước vòng sửa này, một lần THỬ vi phạm D2 để lại **con số không** bản ghi. Cùng lỗ
  // với D5 mà cổng chính sách vừa vá.
  //
  // Phân loại theo THÔNG BÁO chứ không theo SQLSTATE, và đó là một thu hẹp phải nói ra: cả hai
  // trigger dùng chung `check_violation`, nên SQLSTATE không phân biệt được chúng với nhau hay
  // với một `CHECK` bất kỳ. Thông báo thì do chính 019 viết ra và có test đọc nó.
  // [S1.85 / khoản 147] Câu trên đúng cho hai vế TRIGGER và chỉ cho chúng. Vế thứ ba của lần từ chối D2 KHÔNG đến từ một trigger mà
  // từ hai ràng buộc UNIQUE của 019, và nó ném `23505` — xem `LA_TRUNG_PHE_DUYET` dưới đây.
  // [S1.77 / khoản 140] CÂU NÀY KHOÁ HÀNG YÊU CẦU, và chỗ khoá không nằm ở đây — nói ra vì việc nó
  // vô danh ở tệp này chính là thứ làm lượt soi 68a-1 mở nhầm khoản 140.
  //
  // `unseal_approvals` mang trigger `unseal_approvals_kiem_nguoi_duyet` (019, BEFORE INSERT), và thân
  // hàm của nó mở đầu bằng `SELECT … FROM public.unseal_requests … FOR NO KEY UPDATE`. Nên câu INSERT
  // dưới đây GIỮ khoá hàng yêu cầu ở mức `FOR NO KEY UPDATE` — TRƯỚC lần ghi sổ `UNSEAL_APPROVED` ở
  // dưới, và trước câu `UPDATE … SET status = 'APPROVED'` ở cuối hàm.
  //
  // Hệ quả: hàm này KHÔNG mang hình dạng của khoản 126 ("câu chờ khoá hàng SAU lần ghi sổ đầu"). Câu
  // `UPDATE` ở cuối chỉ xin lại ĐÚNG mức khoá giao dịch đã cầm từ đây (`FOR NO KEY UPDATE` — `status`
  // và `approved_at` không phải cột khoá), nên tập người giữ chặn được nó TRÙNG KHÍT tập người giữ
  // chặn được câu INSERT ở trên: không có khe nào để hàm này vừa cầm khoá ghi sổ vừa còn phải chờ
  // hàng. Đo ở `unseal.int.test.ts`, vế `[S1.77 / khoản 140]` — MỘT vế, dựng một người giữ nằm đúng
  // trên đường biên ấy (§S1.77 mục 2 ghi cả ba kịch bản đã chạy, chỉ vế này được giữ lại làm vế canh).
  // Dời câu INSERT này xuống SAU lần ghi sổ thì khoản 140 thành thật ngay, và vế ấy ĐỎ — đã đo.
  try {
    await client.query(
      `INSERT INTO public.unseal_approvals
         (org_id, unseal_request_id, approver_user_id, approver_session_id)
       VALUES ($1, $2, $3, $4)`,
      [orgId, input.unsealRequestId, actor.id, actor.sessionId],
    );
  } catch (loi) {
    // [S1.68 / khoản 119] Lần ghi đi qua `throwAuditedDenial`: ghi được ⇒ ném lại chính vi phạm D2; không ghi được ⇒
    // `DenialAuditFailedError` giữ vi phạm trong `denial`. Bản trước để lỗi của lần ghi thay chỗ vi phạm — đo qua HTTP, trigger chặn lần
    // ghi: RAISE 23514 ⇒ 422 mang thông điệp của trigger, RAISE TP119 ⇒ 500, EXECUTE thu hồi ⇒ 403, không hàng sổ nào (biên bản §S1.68).
    if (loi instanceof Error && (laViPhamD2TheoThongDiep(loi) || laTrungPheDuyet(loi))) {
      await throwAuditedDenial(
        auditPool,
        orgId,
        {
          actorType: actor.type,
          actorId: actor.id,
          action: "UNSEAL_APPROVAL_DENIED",
          resourceType: "UNSEAL_REQUEST",
          resourceId: input.unsealRequestId,
          // KHÔNG mang `reason` của yêu cầu: với break-glass đó là chỗ chi tiết sự cố nằm.
          payload: { viPham: "D2" },
        },
        loi,
      );
    }
    throw loi;
  }

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
            (SELECT pg_catalog.count(*) FROM public.unseal_approvals a
              WHERE a.unseal_request_id OPERATOR(pg_catalog.=) r.id
                AND a.org_id OPERATOR(pg_catalog.=) r.org_id) AS co
       FROM public.unseal_requests r
      WHERE r.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid`,
    [input.unsealRequestId],
  );
  const d = dem[0];
  if (d !== undefined && Number(d.co) >= d.can) {
    const { rows } = await client.query<HangYeuCau>(
      `UPDATE public.unseal_requests SET status = 'APPROVED', approved_at = pg_catalog.now()
        WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
          AND status OPERATOR(pg_catalog.=) 'PENDING' RETURNING ${COT}`,
      [input.unsealRequestId],
    );
    const h = rows[0];
    if (h !== undefined) return doiYeuCau(h);
  }

  const { rows } = await client.query<HangYeuCau>(
    `SELECT ${COT} FROM public.unseal_requests WHERE id OPERATOR(pg_catalog.=) $1`,
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

  // [REVIEW AN NINH S1.6 — HIGH-3 / MED-1] Ghi mốc ĐIỀU PHỐI trước khi xếp job, trong CÙNG giao
  // dịch. Không có ba cột này, worker không có gì để hỏi lại vế 2 của D1 lúc giải mã — và mở
  // thầu là hành động DUY NHẤT của hệ thống không thu hồi được.
  const dp = await client.query(
    "UPDATE public.unseal_requests SET dispatched_at = pg_catalog.now(), dispatched_by = $2, " +
      "dispatched_by_session_id = $3 WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $4 AND dispatched_at IS NULL",
    [bangChung.unsealRequestId, bangChung.userId, bangChung.sessionId, orgId],
  );
  if (dp.rowCount !== 1) {
    throw new UnsealError("Yêu cầu mở thầu này đã được điều phối rồi.");
  }

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
    // [REVIEW AN NINH S1.6 — MED-4] `breakGlass` phải có mặt. Không có nó, một lần điều phối
    // break-glass GIỐNG HỆT một lần điều phối đã đủ phê duyệt trong sổ kiểm toán, và D4
    // (*"không bao giờ im lặng"*) hỏng ở đúng bản ghi mà kiểm toán viên đọc đầu tiên.
    payload: {
      rfqId: bangChung.rfqId,
      clauses: [...bangChung.clauses],
      breakGlass: bangChung.breakGlass,
    },
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
    `UPDATE public.unseal_requests SET status = 'CANCELLED', cancelled_at = pg_catalog.now()
      WHERE id OPERATOR(pg_catalog.=) $1 AND status IN ('PENDING', 'APPROVED') RETURNING ${COT}`,
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
): Promise<UnsealRequestView | null> {
  await assertTenantBound(client, orgId, "getUnsealRequest");
  batBuocUuid(unsealRequestId, "unsealRequestId");
  const { rows } = await client.query<HangYeuCauXem>(
    `SELECT ${COT_XEM} FROM public.unseal_requests r
      WHERE r.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid`,
    [unsealRequestId],
  );
  const h = rows[0];
  return h === undefined ? null : doiYeuCauXem(h);
}

/**
 * [S1.90 / khoản 190] YÊU CẦU MỞ THẦU ĐANG MỞ CỦA MỘT GÓI THẦU — TÌM ĐƯỢC, KHÔNG PHẢI ĐOÁN ID.
 *
 * VÌ SAO ĐƯỜNG NÀY PHẢI TỒN TẠI, nói bằng một phép đo chứ không bằng một mong muốn: mở thầu đòi
 * HAI người, và hai người ấy ngồi ở hai máy. Trước vòng này, cách duy nhất để đọc một yêu cầu là
 * biết UUID của nó — mà UUID ấy chỉ hiện ra ở màn hình của người ĐÃ TẠO. Tức tính năng hai người
 * duyệt chỉ chạy được khi một người làm cả hai vai trên cùng một tab, và đó là đúng thứ D2 cấm.
 * Lượt đi thử 2026-09-20 vấp vào nó ở bước phê duyệt thứ nhất.
 *
 * KHÔNG CÓ MƠ HỒ "CÁI NÀO": `019` dựng index duy nhất một phần `unseal_requests_mot_yeu_cau_dang_mo`
 * trên `(org_id, rfq_id) WHERE status IN ('PENDING','APPROVED')`, nên mỗi gói thầu có NHIỀU NHẤT
 * MỘT yêu cầu đang mở. Câu dưới đây không `ORDER BY` và không `LIMIT` — nếu nó trả về hai hàng thì
 * index ấy đã chết, và im lặng chọn "cái mới nhất" sẽ giấu đúng cái chết ấy đi.
 *
 * KHÔNG CÓ CỔNG QUYỀN, cùng hạng với `getUnsealRequest` (rổ `HAM_CHI_DOC`): nó không tiết lộ một
 * mức giá nào, và người gọi đã phải qua `audience: BUYER` của tổ chức. Cái nó MỞ RỘNG là khả năng
 * TÌM — nên route gọi nó đóng cửa với tác tử chỉ-đọc, và lý do ấy ghi ở chính route.
 */
export async function getOpenUnsealForRfq(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<UnsealRequestView | null> {
  await assertTenantBound(client, orgId, "getOpenUnsealForRfq");
  batBuocUuid(rfqId, "rfqId");
  const { rows } = await client.query<HangYeuCauXem>(
    `SELECT ${COT_XEM} FROM public.unseal_requests r
      WHERE r.rfq_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND r.status IN ('PENDING', 'APPROVED')`,
    [rfqId],
  );
  if (rows.length > 1) {
    throw new UnsealError(
      `gói thầu ${rfqId} có ${rows.length} yêu cầu mở thầu đang mở — index unseal_requests_mot_yeu_cau_dang_mo đã không còn hiệu lực`,
    );
  }
  const h = rows[0];
  return h === undefined ? null : doiYeuCauXem(h);
}
