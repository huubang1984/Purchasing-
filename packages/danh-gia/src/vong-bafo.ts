// ==============================================================================================
// [S1.109 / S2.5 tầng người dùng] VÒNG BAFO — LỚP CÓ TRẠNG THÁI
//
// `059` dựng bảng, bốn cạnh và ba trigger canh; `060` thêm vế *"lượt chấm mới nhất"*. Tệp này là
// đường sản xuất đi qua chúng — và cho tới vòng này, **không đường nào đi qua**, đúng thứ khoản
// **227** ghi là một ranh giới được chọn chứ không một chỗ bỏ sót.
//
// ----------------------------------------------------------------------------------------------
// `evaluationId` KHÔNG PHẢI MỘT THAM SỐ, VÀ ĐÓ LÀ MỘT QUYẾT ĐỊNH
// ----------------------------------------------------------------------------------------------
// `moVongBafo` **suy** lượt đánh giá từ gói thầu — lượt mới nhất — thay vì nhận nó từ người gọi.
// Tầng CSDL đã đòi đúng vế ấy từ `060`, nên đây là lớp thứ HAI chứ không phải lớp duy nhất; hai
// lớp canh cùng một tính chất, và lớp dưới là lớp có thẩm quyền. Lý do có cả hai: một cổng chỉ ở
// route là lớp NÔNG (khoản **220**), còn một cổng chỉ ở CSDL thì thông điệp của nó không nói được
// cho người dùng biết phải làm gì.
//
// ----------------------------------------------------------------------------------------------
// ĐÓNG VÒNG BAFO KHÔNG DÙNG LẠI ĐƯỢC `closeRfq`, VÀ PHÉP ĐO NÓI VÌ SAO
// ----------------------------------------------------------------------------------------------
// `closeRfq` ghi `closed_at`, `closed_by` và `early_close_reason` lên `rfq_packages`
// (`packages/rfq/src/rfq.ts`), còn `rfq_packages.closed_at` là sự thật kiểm toán của vòng MỘT —
// bốn ràng buộc mốc mà `059` dựng lại đều cho một RFQ ở `BAFO_*` có `closed_at` sẵn. Tham số hoá
// `closeRfq` cho BAFO là **ghi đè im lặng giờ đóng thầu vòng một**. Nên đóng vòng BAFO là một hàm
// riêng, và nó chạm ĐÚNG hai chỗ: `rfq_bafo_rounds.closed_at` và `rfq_packages.status`.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";

/** Lý do máy đọc được của một lần từ chối ở lớp này — cùng khuôn `LyDoTuChoiLuot`. */
export type LyDoTuChoiVong =
  | "RFQ_KHONG_MO_VONG_DUOC"
  | "CHUA_CHAM_LAN_NAO"
  | "CHINH_SACH_TAT_BAFO"
  | "KHONG_CO_VONG_DANG_MO";

export class VongBafoTuChoiError extends Error {
  constructor(
    readonly lyDo: LyDoTuChoiVong,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "VongBafoTuChoiError";
  }
}

export interface VongBafo {
  readonly bafoRoundId: string;
  readonly rfqId: string;
  readonly evaluationId: string;
  readonly roundNo: number;
  readonly topN: number;
  readonly deadlineAt: Date;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
}

/**
 * Thứ NHÀ CUNG CẤP được thấy — đúng hai trường.
 *
 * Hai lớp canh hai thứ KHÁC NHAU, và không lớp nào chép lại luật của lớp kia: policy
 * `rfq_bafo_rounds_khach` (`060`) canh HÀNG nào ra khỏi CSDL — chỉ vòng của gói thầu mà phiên
 * khách đang gắn; kiểu này canh TRƯỜNG nào ra khỏi tiến trình. `topN` (mấy người qua được vòng
 * một) và `openedBy` là tin cạnh tranh thật, nên chúng không có mặt ở đây.
 */
export interface VongBafoKhach {
  readonly roundNo: number;
  readonly deadlineAt: Date;
}

export interface MoVongBafoInput {
  readonly rfqId: string;
  readonly deadlineAt: Date;
  readonly actorSessionId: string;
}

export interface DongVongBafoInput {
  readonly rfqId: string;
  readonly actorSessionId: string;
}

interface HangVong {
  readonly id: string;
  readonly rfq_id: string;
  readonly evaluation_id: string;
  readonly round_no: number;
  readonly top_n: number;
  readonly deadline_at: Date;
  readonly opened_at: Date;
  readonly closed_at: Date | null;
}

const COT_VONG =
  "id, rfq_id, evaluation_id, round_no, top_n, deadline_at, opened_at, closed_at";

function doiVong(h: HangVong): VongBafo {
  return {
    bafoRoundId: h.id,
    rfqId: h.rfq_id,
    evaluationId: h.evaluation_id,
    roundNo: h.round_no,
    topN: h.top_n,
    deadlineAt: h.deadline_at,
    openedAt: h.opened_at,
    closedAt: h.closed_at,
  };
}

/**
 * Mở một vòng BAFO trên một gói thầu ĐANG Ở `EVALUATING`, và chuyển nó sang `BAFO_OPEN`.
 *
 * Cổng quyền là `rfq.bafo.open` — mã RIÊNG, chỉ `PROCUREMENT_MANAGER` (ADR-055). Mở vòng BAFO là
 * hành động duy nhất của sản phẩm mà người bấm ĐÃ BIẾT giá của mọi người, nên nó không đi chung
 * với `evaluation.perform` (năm trên sáu vai giữ mã ấy — khoản 220).
 */
export async function moVongBafo(
  client: pg.PoolClient,
  orgId: string,
  input: MoVongBafoInput,
  auditPool: pg.Pool,
): Promise<VongBafo> {
  await assertTenantBound(client, orgId, "moVongBafo");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_BAFO_OPEN,
      // Cặp `RFQ`+rfqId, cùng khuôn `taoLuotDanhGia`: lúc cổng chạy, vòng BAFO chưa tồn tại, nên
      // một `resource_id` mang id vòng là một câu SAI ghi vào sổ kiểm toán.
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  // `FOR NO KEY UPDATE` giữ hàng RFQ suốt hàm — cùng khuôn `taoLuotDanhGia`. Trigger
  // `bafo_kiem_vong` lấy lại đúng khoá ấy ở câu `INSERT`, nên thứ tự khoá không đổi.
  const { rows: rfq } = await client.query<{ status: string }>(
    `SELECT p.status FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      FOR NO KEY UPDATE`,
    [orgId, input.rfqId],
  );
  const trangThai = rfq[0]?.status;
  if (trangThai !== "EVALUATING") {
    throw new VongBafoTuChoiError(
      "RFQ_KHONG_MO_VONG_DUOC",
      `Chỉ mở được vòng BAFO khi gói thầu đang ở EVALUATING; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
    );
  }

  // LƯỢT ĐÁNH GIÁ ĐƯỢC SUY, KHÔNG ĐƯỢC KHAI — xem khối đầu tệp. `created_at DESC, id DESC` cho
  // một kết quả xác định kể cả ở ca hoà mốc; `060` thì đòi *không lượt nào mới hơn*, nên hai lớp
  // đồng ý ở mọi ca tới được.
  const { rows: luot } = await client.query<{ id: string; policy_id: string; bafo_top_n: number | null }>(
    `SELECT e.id, e.policy_id, o.bafo_top_n
       FROM public.rfq_evaluations e
       JOIN public.org_procurement_policies o ON o.id OPERATOR(pg_catalog.=) e.policy_id
                                            AND o.org_id OPERATOR(pg_catalog.=) e.org_id
      WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND e.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1`,
    [orgId, input.rfqId],
  );
  const lv = luot[0];
  if (lv === undefined) {
    throw new VongBafoTuChoiError(
      "CHUA_CHAM_LAN_NAO",
      "Gói thầu này chưa có lượt chấm nào; danh sách mời BAFO suy từ bảng xếp hạng nên không mở vòng được.",
    );
  }
  // `bafo_top_n = 0` là quy ước *"tổ chức này không dùng BAFO"* (`056`), và `CHECK (top_n > 0)`
  // của `059` sẽ từ chối. Bắt ở đây để câu trả lời gọi tên được cấu hình thay vì một lỗi ràng buộc.
  if (lv.bafo_top_n === null || lv.bafo_top_n === 0) {
    throw new VongBafoTuChoiError(
      "CHINH_SACH_TAT_BAFO",
      "Phiên bản chính sách mà lượt chấm này tính dưới khai bafo_top_n = 0 (hoặc chưa khai); " +
        "tổ chức không dùng BAFO cho gói thầu này.",
    );
  }

  const { rows: vong } = await client.query<HangVong>(
    `INSERT INTO public.rfq_bafo_rounds
       (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid,
             $5::pg_catalog.int4, $6::pg_catalog.timestamptz, $7::pg_catalog.uuid, $8::pg_catalog.uuid)
     RETURNING ${COT_VONG}`,
    [orgId, input.rfqId, lv.id, lv.policy_id, lv.bafo_top_n, input.deadlineAt, actor.id, input.actorSessionId],
  );
  const v = vong[0];
  if (v === undefined) throw new Error("Không ghi được vòng BAFO.");

  // Cạnh `EVALUATING->BAFO_OPEN`. Vế `AND status = 'EVALUATING'` là lớp CÓ THẨM QUYỀN cho ca
  // trạng thái đổi giữa lần đọc ở trên và câu này; phép kiểm ở trên chỉ làm thông điệp nói được
  // VÌ SAO. Cùng khuôn `taoLuotDanhGia`.
  const doi = await client.query(
    `UPDATE public.rfq_packages
        SET status = 'BAFO_OPEN'
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND status OPERATOR(pg_catalog.=) 'EVALUATING'`,
    [orgId, input.rfqId],
  );
  if (doi.rowCount !== 1) {
    throw new VongBafoTuChoiError(
      "RFQ_KHONG_MO_VONG_DUOC",
      "Trạng thái gói thầu đã đổi giữa lúc mở vòng BAFO; vòng này không được ghi nhận.",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_BAFO_ROUND_OPENED",
    resourceType: "rfq_bafo_round",
    resourceId: v.id,
    payload: {
      rfqId: input.rfqId,
      evaluationId: lv.id,
      policyId: lv.policy_id,
      roundNo: v.round_no,
      topN: v.top_n,
      deadlineAt: v.deadline_at.toISOString(),
      openedBySessionId: input.actorSessionId,
    },
  });

  return doiVong(v);
}

/**
 * Đóng vòng BAFO đang mở và chuyển RFQ sang `BAFO_CLOSED`.
 *
 * KHÔNG chạm `rfq_packages.closed_at` — xem khối đầu tệp. Hai câu trong cùng một giao dịch: một
 * vòng đóng mà trạng thái chưa đổi thì C1 kêu *"dữ liệu hỏng"*, và một trạng thái đổi mà vòng
 * chưa đóng thì chỉ mục bộ phận `rfq_bafo_rounds_mot_vong_dang_mo` chặn vòng kế tiếp. Cả hai đều
 * fail-closed, nhưng cả hai đều là trạng thái không nên tồn tại.
 */
export async function dongVongBafo(
  client: pg.PoolClient,
  orgId: string,
  input: DongVongBafoInput,
  auditPool: pg.Pool,
): Promise<VongBafo> {
  await assertTenantBound(client, orgId, "dongVongBafo");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.RFQ_BAFO_OPEN,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  const { rows: rfq } = await client.query<{ status: string }>(
    `SELECT p.status FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      FOR NO KEY UPDATE`,
    [orgId, input.rfqId],
  );
  const trangThai = rfq[0]?.status;
  if (trangThai !== "BAFO_OPEN") {
    throw new VongBafoTuChoiError(
      "KHONG_CO_VONG_DANG_MO",
      `Chỉ đóng được vòng BAFO khi gói thầu đang ở BAFO_OPEN; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
    );
  }

  const { rows: vong } = await client.query<HangVong>(
    `UPDATE public.rfq_bafo_rounds
        SET closed_at = pg_catalog.now()
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND closed_at IS NULL
     RETURNING ${COT_VONG}`,
    [orgId, input.rfqId],
  );
  const v = vong[0];
  if (v === undefined) {
    throw new VongBafoTuChoiError(
      "KHONG_CO_VONG_DANG_MO",
      "Gói thầu đang ở BAFO_OPEN mà không có vòng BAFO nào đang mở — dữ liệu hỏng.",
    );
  }

  const doi = await client.query(
    `UPDATE public.rfq_packages
        SET status = 'BAFO_CLOSED'
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND status OPERATOR(pg_catalog.=) 'BAFO_OPEN'`,
    [orgId, input.rfqId],
  );
  if (doi.rowCount !== 1) {
    throw new VongBafoTuChoiError(
      "KHONG_CO_VONG_DANG_MO",
      "Trạng thái gói thầu đã đổi giữa lúc đóng vòng BAFO; lần đóng này không được ghi nhận.",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_BAFO_ROUND_CLOSED",
    resourceType: "rfq_bafo_round",
    resourceId: v.id,
    payload: {
      rfqId: input.rfqId,
      roundNo: v.round_no,
      closedBySessionId: input.actorSessionId,
    },
  });

  return doiVong(v);
}

/**
 * Vòng BAFO MỚI NHẤT của một gói thầu, `null` khi chưa có vòng nào.
 *
 * KHÔNG 404 và KHÔNG mảng rỗng khi chưa có vòng: *"gói thầu này chưa mở vòng BAFO nào"* là một câu
 * trả lời ĐÚNG, và màn chấm phải phân biệt nó với *"không có gói thầu ấy"* — cùng khuôn
 * `getOpenUnsealForRfq` (khoản 190).
 *
 * KHÔNG có cổng `bid.view`: hàng này không mang một mức giá nào. Nó mang `top_n`, và với một
 * người mua thì con số ấy suy được từ chính sách mà họ đọc được qua `GET /policy`.
 */
export async function docVongBafo(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<VongBafo | null> {
  await assertTenantBound(client, orgId, "docVongBafo");
  const { rows } = await client.query<HangVong>(
    `SELECT ${COT_VONG}
       FROM public.rfq_bafo_rounds
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY round_no DESC
      LIMIT 1`,
    [orgId, rfqId],
  );
  const h = rows[0];
  return h === undefined ? null : doiVong(h);
}

/**
 * Vòng BAFO ĐANG MỞ mà phiên khách được thấy — đúng hai trường, `null` khi không có.
 *
 * Câu này KHÔNG lọc theo `rfq_id` của khách: policy `rfq_bafo_rounds_khach` (`060`) đã làm việc
 * ấy, và lọc lại ở đây sẽ giấu mất một lần policy hỏng thay vì để nó lộ ra — cùng lập luận mà
 * `/guest/session` và `/guest/bids` đã ghi. Tham số `rfqId` vẫn được truyền vì một phiên khách
 * đang gắn đúng một gói thầu, và một câu không có vế `WHERE` nào thì không đọc được.
 */
export async function docVongBafoKhach(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<VongBafoKhach | null> {
  await assertTenantBound(client, orgId, "docVongBafoKhach");
  const { rows } = await client.query<{ round_no: number; deadline_at: Date }>(
    `SELECT round_no, deadline_at
       FROM public.rfq_bafo_rounds
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND closed_at IS NULL
      ORDER BY round_no DESC
      LIMIT 1`,
    [orgId, rfqId],
  );
  const h = rows[0];
  return h === undefined ? null : { roundNo: h.round_no, deadlineAt: h.deadline_at };
}
