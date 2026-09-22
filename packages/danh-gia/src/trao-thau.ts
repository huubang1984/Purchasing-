// ==============================================================================================
// [S1.110 / S2.6] TRAO THẦU — LỚP CÓ TRẠNG THÁI
//
// `061` dựng hai bảng chỉ-ghi-thêm, hai cạnh trạng thái và năm trigger canh (**J3 · J5 · J7**).
// Tệp này là đường sản xuất đi qua chúng. Nó là hành động **cuối** của sản phẩm, và hành động duy
// nhất mà spec §7 đòi đúng hai con người khác nhau bấm.
//
// ----------------------------------------------------------------------------------------------
// `AWARDED` NGHĨA LÀ *"ĐANG CÓ MỘT AWARD CÒN SỐNG"*, KHÔNG PHẢI *"ĐÃ TRAO THẦU"*
// ----------------------------------------------------------------------------------------------
// Chủ dự án chốt 2026-09-22 (§8.3): huỷ award đưa RFQ **về `EVALUATING`**. Nên `AWARDED` nói về
// sự tồn tại của một hàng còn sống, chứ không về một kết cục. Hệ quả kéo theo, và chúng buộc phải
// khớp với `award_kiem_mot_award_song`:
//
//   * hàng `PROPOSED` đặt trạng thái RFQ sang `AWARDED` — J7 coi một đề xuất đang chờ là *còn
//     sống*, nên trạng thái RFQ phải nói cùng một câu;
//   * hàng `APPROVED` **không đổi** trạng thái RFQ — nó đã ở `AWARDED`;
//   * hàng `CANCELLED` đưa về `EVALUATING`, và đó là lúc một đề xuất mới đi được.
//
// Nếu `PROPOSED` KHÔNG đặt `AWARDED`, thì giữa lúc đề xuất và lúc duyệt, RFQ đứng ở `EVALUATING`
// — và `moVongBafo` mở được một vòng BAFO **dưới chân một đề xuất đang chờ duyệt**, tức danh sách
// mà đề xuất ấy dựa trên bị tính lại. Hai lớp phải nói cùng một câu, và đây là lớp phải nhường.
//
// ----------------------------------------------------------------------------------------------
// `evaluationId` KHÔNG PHẢI MỘT THAM SỐ — CÙNG BÀI HỌC `060` VỪA HỌC
// ----------------------------------------------------------------------------------------------
// Award mang **lượt chấm nào** nó dựa trên (khoá ngoại hợp thành của `061`, vế cấu trúc của J5).
// Nhận `evaluationId` từ người gọi là nhận đúng vectơ mà `060` vừa đóng cho vòng BAFO: sau một
// chu kỳ BAFO có HAI lượt chấm, một `evaluationId` khai từ ngoài chọn được bảng xếp hạng **TRƯỚC**
// BAFO. Nên nó được **suy** — lượt mới nhất — y như `moVongBafo`.
//
// Và khác `060`, tầng CSDL ở đây **không** canh vế ấy: `award_kiem_de_xuat` chỉ đòi lượt chấm
// thuộc đúng RFQ, không đòi nó là lượt mới nhất. Nên câu `ORDER BY e.created_at DESC` dưới đây là
// lớp **DUY NHẤT** — một bất đối xứng có chủ ý ghi thành khoản **231**, không một chỗ bỏ sót:
// `060` cần lớp CSDL vì `rfq_bafo_rounds.evaluation_id` có `GRANT INSERT` cho `app_api` và một
// thân yêu cầu khai được nó; ở đây `evaluationId` không phải tham số của hàm nào, nên vectơ ấy
// chưa có đường. Ngày nào có, khoản 231 là chỗ đã ghi cái giá. Ca đo khoá vế này nằm ở
// `luot-danh-gia.int.test.ts`, đo SAU một chu kỳ BAFO — tức ở đúng thế giới có HAI lượt chấm.
//
// ----------------------------------------------------------------------------------------------
// HUỶ ĐÒI `po.approve`, KHÔNG PHẢI `award.recommend`
// ----------------------------------------------------------------------------------------------
// Một phép đo trên ma trận quyền: `award.recommend` do **BUYER · PROCUREMENT_MANAGER · FINANCE ·
// DIRECTOR** giữ, còn `po.approve` chỉ **FINANCE · DIRECTOR**. Nếu huỷ đi qua `award.recommend`
// thì một `BUYER` huỷ được một award **đã duyệt** rồi đề xuất người khác — tức phê duyệt kép bị
// tháo bằng cách bào mòn chứ không bằng cách vượt. Cổng huỷ vì thế là cổng của người **duyệt**.
//
// Cái giá, nói thẳng: người đề xuất **không tự rút lại được** đề xuất của mình. Đó là một quyền
// hẹp hơn và hợp lý, nhưng nó đòi một trạng thái thứ tư (`WITHDRAWN`) hoặc một cổng phụ thuộc
// trạng thái, và cả hai đều là thiết kế mới. Không dựng ở vòng này — ghi thành khoản **232**.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";

/** Lý do máy đọc được của một lần từ chối ở lớp này — cùng khuôn `LyDoTuChoiVong`. */
export type LyDoTuChoiTraoThau =
  | "RFQ_KHONG_DE_XUAT_DUOC"
  | "CHUA_CHAM_LAN_NAO"
  | "KHONG_CO_DE_XUAT_DANG_CHO"
  | "KHONG_CO_AWARD_CON_SONG";

export class TraoThauTuChoiError extends Error {
  constructor(
    readonly lyDo: LyDoTuChoiTraoThau,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "TraoThauTuChoiError";
  }
}

export type TrangThaiTraoThau = "PROPOSED" | "APPROVED" | "CANCELLED";

/** Một hàng sự kiện của `rfq_awards` — KHÔNG mang một mức giá nào. */
export interface TraoThau {
  readonly awardId: string;
  readonly rfqId: string;
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly status: TrangThaiTraoThau;
  readonly reason: string;
  readonly actedBy: string;
  readonly actedAt: Date;
}

/** Một chữ ký duyệt. `approver_session_id` KHÔNG ra khỏi tiến trình — nó là tin về phiên. */
export interface ChuKyDuyet {
  readonly approverUserId: string;
  readonly approvedAt: Date;
}

export interface TraoThauDayDu extends TraoThau {
  readonly approvals: readonly ChuKyDuyet[];
}

export interface DeXuatTraoThauInput {
  readonly rfqId: string;
  readonly bidVersionId: string;
  readonly reason: string;
  readonly actorSessionId: string;
}

export interface DuyetTraoThauInput {
  /**
   * Gói thầu mà lời gọi TỰ KHAI, và nó được ĐỐI CHIẾU với `rfq_id` của hàng award.
   *
   * Không phải một tham số thừa: `resourceType`/`resourceId` của `requirePermission` chỉ đi vào
   * HÀNG SỔ `PERMISSION_DENIED` (xem `moVongBafo`), nên một `awardId` của gói thầu KHÁC trong
   * cùng tổ chức làm route ghi một hàng sổ gọi tên gói thầu A cho một hành động trên gói thầu B.
   * Đó không phải một lần vượt cổng, nhưng nó là một câu SAI trong sổ kiểm toán — đúng thứ sổ ấy
   * tồn tại để không có.
   */
  readonly rfqId: string;
  readonly awardId: string;
  readonly actorSessionId: string;
}

export interface HuyTraoThauInput {
  readonly rfqId: string;
  readonly reason: string;
  readonly actorSessionId: string;
}

export interface DocTraoThauInput {
  readonly rfqId: string;
  readonly actorSessionId: string;
}

interface HangAward {
  readonly id: string;
  readonly rfq_id: string;
  readonly evaluation_id: string;
  readonly bid_version_id: string;
  readonly status: TrangThaiTraoThau;
  readonly reason: string;
  readonly acted_by: string;
  readonly acted_at: Date;
}

// ----------------------------------------------------------------------------------------------
// MỌI CÂU SQL DƯỚI ĐÂY VIẾT NỘI TUYẾN — KHÔNG MỘT HẰNG NÀO ĐƯỢC NỘI SUY VÀO
// ----------------------------------------------------------------------------------------------
// Bản đầu của tệp này gom danh sách cột vào ba hằng rồi nội suy chúng. `[INV-H21]`
// (`tests/architecture/qt3-cu-phap.int.test.ts`) `PREPARE` từng câu SQL sản xuất trên một cụm
// thật, và nó thay mỗi `${...}` bằng một HẰNG — nên ba câu `INSERT` thành
// `INSERT INTO public.rfq_awards 1 VALUES 1`, và cổng ĐỎ với `syntax error at or near "1"`.
//
// Phần đáng ghi hơn là hai câu KHÔNG đỏ: `SELECT ${COT_AWARD} FROM …` thành `SELECT 1 FROM …`, một
// câu phân tích được — nên cổng XANH trong khi nó đọc một câu KHÁC hẳn câu sẽ chạy. Đó là *cổng
// xanh vì phạm vi*, và nó khó thấy hơn một lần đỏ. Nên tám cột được lặp ở mỗi câu, cố ý.

function doiAward(h: HangAward): TraoThau {
  return {
    awardId: h.id,
    rfqId: h.rfq_id,
    evaluationId: h.evaluation_id,
    bidVersionId: h.bid_version_id,
    status: h.status,
    reason: h.reason,
    actedBy: h.acted_by,
    actedAt: h.acted_at,
  };
}

/**
 * Hàng award MỚI NHẤT của một gói thầu.
 *
 * `ORDER BY acted_at DESC, id DESC` là **đúng câu** mà `award_kiem_mot_award_song` dùng, và nó
 * phải đúng từng chữ: hai câu khác nhau ở ca hoà mốc cho hai "hàng mới nhất" khác nhau, và khi đó
 * lớp trên báo một chuyện còn lớp dưới cưỡng chế một chuyện khác. Chỉ mục
 * `rfq_awards_theo_goi_thau` phục vụ đúng thứ tự này.
 */
async function awardMoiNhat(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<HangAward | undefined> {
  const { rows } = await client.query<HangAward>(
    `SELECT id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_at
       FROM public.rfq_awards
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY acted_at DESC, id DESC
      LIMIT 1`,
    [orgId, rfqId],
  );
  return rows[0];
}

/**
 * ĐỀ XUẤT trao thầu cho một báo giá, và chuyển gói thầu sang `AWARDED`.
 *
 * Cổng quyền là `award.recommend` — mắt xích thứ TƯ của chuỗi D3, nên `kiem_tra_phan_tach_nhiem_vu`
 * (005) đã canh ở mức người dùng lúc GÁN vai. Ba trigger của `061` canh tiếp ở mức HÀNH VI: J3
 * (người tạo RFQ và người điều phối mở thầu không đề xuất được), J5 (báo giá phải có
 * `effective_cost` đọc được ở đúng lượt chấm), J7 (tối đa một award còn sống).
 */
export async function deXuatTraoThau(
  client: pg.PoolClient,
  orgId: string,
  input: DeXuatTraoThauInput,
  auditPool: pg.Pool,
): Promise<TraoThau> {
  await assertTenantBound(client, orgId, "deXuatTraoThau");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.AWARD_RECOMMEND,
      // Cặp `RFQ`+rfqId, cùng khuôn `moVongBafo`: lúc cổng chạy, hàng award chưa tồn tại.
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  // `FOR NO KEY UPDATE` giữ hàng RFQ suốt hàm — cùng khuôn `moVongBafo`. Trigger
  // `award_kiem_mot_award_song` lấy thêm một khoá TƯ VẤN theo `rfq_id` ở câu `INSERT`, nên hai
  // giao dịch đồng thời xếp hàng ở đúng một điểm dù `app_api` không khoá được hàng award nào.
  const { rows: rfq } = await client.query<{ status: string }>(
    `SELECT p.status FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      FOR NO KEY UPDATE`,
    [orgId, input.rfqId],
  );
  const trangThai = rfq[0]?.status;
  if (trangThai !== "EVALUATING") {
    throw new TraoThauTuChoiError(
      "RFQ_KHONG_DE_XUAT_DUOC",
      `Chỉ đề xuất trao thầu khi gói thầu đang ở EVALUATING; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
    );
  }

  // LƯỢT CHẤM ĐƯỢC SUY, KHÔNG ĐƯỢC KHAI — xem khối đầu tệp, và lưu ý rằng đây là lớp DUY NHẤT.
  const { rows: luot } = await client.query<{ id: string }>(
    `SELECT e.id
       FROM public.rfq_evaluations e
      WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND e.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1`,
    [orgId, input.rfqId],
  );
  const lv = luot[0];
  if (lv === undefined) {
    throw new TraoThauTuChoiError(
      "CHUA_CHAM_LAN_NAO",
      "Gói thầu này chưa có lượt chấm nào; một award phải trỏ tới một hàng xếp hạng nên không đề xuất được.",
    );
  }

  const { rows: award } = await client.query<HangAward>(
    `INSERT INTO public.rfq_awards
       (org_id, rfq_id, evaluation_id, bid_version_id, status, reason,
        acted_by, acted_by_session_id)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid,
             $5::pg_catalog.text, $6::pg_catalog.text, $7::pg_catalog.uuid, $8::pg_catalog.uuid)
     RETURNING id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_at`,
    [
      orgId,
      input.rfqId,
      lv.id,
      input.bidVersionId,
      "PROPOSED",
      input.reason,
      actor.id,
      input.actorSessionId,
    ],
  );
  const a = award[0];
  if (a === undefined) throw new Error("Không ghi được đề xuất trao thầu.");

  // Cạnh `EVALUATING->AWARDED`. Vế `AND status = 'EVALUATING'` là lớp CÓ THẨM QUYỀN cho ca trạng
  // thái đổi giữa lần đọc ở trên và câu này; phép kiểm ở trên chỉ làm thông điệp nói được VÌ SAO.
  const doi = await client.query(
    `UPDATE public.rfq_packages
        SET status = 'AWARDED'
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND status OPERATOR(pg_catalog.=) 'EVALUATING'`,
    [orgId, input.rfqId],
  );
  if (doi.rowCount !== 1) {
    throw new TraoThauTuChoiError(
      "RFQ_KHONG_DE_XUAT_DUOC",
      "Trạng thái gói thầu đã đổi giữa lúc đề xuất trao thầu; đề xuất này không được ghi nhận.",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_AWARD_PROPOSED",
    resourceType: "rfq_award",
    resourceId: a.id,
    payload: {
      rfqId: input.rfqId,
      evaluationId: lv.id,
      bidVersionId: input.bidVersionId,
      reason: input.reason,
      proposedBySessionId: input.actorSessionId,
    },
  });

  return doiAward(a);
}

/**
 * PHÊ DUYỆT một đề xuất trao thầu — chữ ký, rồi hàng `APPROVED`. KHÔNG đổi trạng thái RFQ.
 *
 * Nhận `awardId` — KHÔNG chỉ `rfqId` — và đó là một quyết định: người duyệt ký lên **đúng đề xuất
 * họ đã đọc**. Giữa lúc màn hình hiện đề xuất và lúc người ấy bấm, đề xuất kia huỷ được và một đề
 * xuất KHÁC dựng lên; một lời gọi chỉ theo `rfqId` sẽ ký lên đề xuất mới trong im lặng, còn lời
 * gọi theo `awardId` thì bị chặn ngay vì hàng ấy không còn `PROPOSED`.
 *
 * Số chữ ký cần sống ở **CSDL** (`CHU_KY_CAN` trong `award_kiem_mot_award_song`), chốt là MỘT
 * (§7, 2026-09-22). Nên hàm này ghi chữ ký rồi ghi luôn hàng `APPROVED`; nếu ngày nào con số ấy
 * thành hai, câu `INSERT` thứ hai từ chối với thông điệp gọi tên số chữ ký đang có, và lời gọi
 * của người duyệt thứ hai đi qua. Không có phép đếm nào ở lớp này — hai bản đếm là hai bản trôi.
 */
export async function duyetTraoThau(
  client: pg.PoolClient,
  orgId: string,
  input: DuyetTraoThauInput,
  auditPool: pg.Pool,
): Promise<TraoThau> {
  await assertTenantBound(client, orgId, "duyetTraoThau");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows: deXuat } = await client.query<HangAward>(
    `SELECT id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_at
       FROM public.rfq_awards
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.awardId],
  );
  const dx = deXuat[0];
  if (dx === undefined || dx.status !== "PROPOSED") {
    throw new TraoThauTuChoiError(
      "KHONG_CO_DE_XUAT_DANG_CHO",
      `Chỉ duyệt được một đề xuất đang ở PROPOSED; đề xuất này đang ở ${dx?.status ?? "(không tìm thấy)"}.`,
    );
  }
  // Đề xuất phải thuộc ĐÚNG gói thầu mà lời gọi khai — xem `DuyetTraoThauInput.rfqId`.
  if (dx.rfq_id !== input.rfqId) {
    throw new TraoThauTuChoiError(
      "KHONG_CO_DE_XUAT_DANG_CHO",
      "Đề xuất trao thầu này không thuộc gói thầu được nêu trong đường dẫn.",
    );
  }

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.PO_APPROVE,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  await client.query(
    `INSERT INTO public.rfq_award_approvals
       (org_id, award_id, approver_user_id, approver_session_id)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid)`,
    [orgId, dx.id, actor.id, input.actorSessionId],
  );

  // Hàng `APPROVED` phải chép ĐÚNG `evaluation_id`/`bid_version_id` của đề xuất —
  // `award_kiem_mot_award_song` từ chối nếu lệch, và vế ấy tồn tại để một hàng "duyệt" không nói
  // về một báo giá khác hẳn thứ đã được đề xuất.
  const { rows: award } = await client.query<HangAward>(
    `INSERT INTO public.rfq_awards
       (org_id, rfq_id, evaluation_id, bid_version_id, status, reason,
        acted_by, acted_by_session_id)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid,
             $5::pg_catalog.text, $6::pg_catalog.text, $7::pg_catalog.uuid, $8::pg_catalog.uuid)
     RETURNING id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_at`,
    [
      orgId,
      dx.rfq_id,
      dx.evaluation_id,
      dx.bid_version_id,
      "APPROVED",
      dx.reason,
      actor.id,
      input.actorSessionId,
    ],
  );
  const a = award[0];
  if (a === undefined) throw new Error("Không ghi được lần phê duyệt trao thầu.");

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_AWARD_APPROVED",
    resourceType: "rfq_award",
    resourceId: a.id,
    payload: {
      rfqId: dx.rfq_id,
      proposalAwardId: dx.id,
      evaluationId: dx.evaluation_id,
      bidVersionId: dx.bid_version_id,
      approvedBySessionId: input.actorSessionId,
    },
  });

  return doiAward(a);
}

/**
 * HUỶ award còn sống của một gói thầu, và đưa gói ấy về `EVALUATING`.
 *
 * Cổng là `po.approve` — xem khối đầu tệp. `reason` BẮT BUỘC: `061` đặt `CHECK` *không rỗng* trên
 * MỌI hàng, kể cả hàng huỷ, và một lần huỷ không có lý do là đúng thứ D5 tồn tại để cấm.
 */
export async function huyTraoThau(
  client: pg.PoolClient,
  orgId: string,
  input: HuyTraoThauInput,
  auditPool: pg.Pool,
): Promise<TraoThau> {
  await assertTenantBound(client, orgId, "huyTraoThau");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.PO_APPROVE,
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
  if (trangThai !== "AWARDED") {
    throw new TraoThauTuChoiError(
      "KHONG_CO_AWARD_CON_SONG",
      `Chỉ huỷ được khi gói thầu đang ở AWARDED; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
    );
  }

  const truoc = await awardMoiNhat(client, orgId, input.rfqId);
  if (truoc === undefined || truoc.status === "CANCELLED") {
    throw new TraoThauTuChoiError(
      "KHONG_CO_AWARD_CON_SONG",
      "Gói thầu đang ở AWARDED mà không có award nào còn sống — dữ liệu hỏng.",
    );
  }

  const { rows: award } = await client.query<HangAward>(
    `INSERT INTO public.rfq_awards
       (org_id, rfq_id, evaluation_id, bid_version_id, status, reason,
        acted_by, acted_by_session_id)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid,
             $5::pg_catalog.text, $6::pg_catalog.text, $7::pg_catalog.uuid, $8::pg_catalog.uuid)
     RETURNING id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_at`,
    [
      orgId,
      input.rfqId,
      truoc.evaluation_id,
      truoc.bid_version_id,
      "CANCELLED",
      input.reason,
      actor.id,
      input.actorSessionId,
    ],
  );
  const a = award[0];
  if (a === undefined) throw new Error("Không ghi được lần huỷ trao thầu.");

  // Cạnh `AWARDED->EVALUATING` — quyết định của chủ dự án ngày 2026-09-22 (§8.3). Gói thầu quay
  // về được chấm lại, và một đề xuất MỚI đi được vì J7 cho `PROPOSED` khi hàng mới nhất đã huỷ.
  const doi = await client.query(
    `UPDATE public.rfq_packages
        SET status = 'EVALUATING'
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND status OPERATOR(pg_catalog.=) 'AWARDED'`,
    [orgId, input.rfqId],
  );
  if (doi.rowCount !== 1) {
    throw new TraoThauTuChoiError(
      "KHONG_CO_AWARD_CON_SONG",
      "Trạng thái gói thầu đã đổi giữa lúc huỷ trao thầu; lần huỷ này không được ghi nhận.",
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_AWARD_CANCELLED",
    resourceType: "rfq_award",
    resourceId: a.id,
    payload: {
      rfqId: input.rfqId,
      truocDo: truoc.status,
      truocDoAwardId: truoc.id,
      reason: input.reason,
      cancelledBySessionId: input.actorSessionId,
    },
  });

  return doiAward(a);
}

/**
 * Award MỚI NHẤT của một gói thầu kèm chữ ký của nó, `null` khi chưa có hàng nào.
 *
 * KHÔNG 404 khi chưa có award: *"gói thầu này chưa có đề xuất trao thầu"* là một câu trả lời ĐÚNG
 * và màn hình phải phân biệt nó với *"không có gói thầu ấy"* — khuôn `docVongBafo` / khoản 190.
 *
 * ------------------------------------------------------------------------------------------
 * CỔNG QUYỀN LÀ `bid.view`, VÀ LỜI GỌI ĐỨNG THẲNG Ở ĐÂY (khoản 33)
 * ------------------------------------------------------------------------------------------
 * Hàng này không mang một con SỐ nào, nhưng nó mang **ai thắng** — và trong mua sắm, danh tính
 * người thắng là tin cạnh tranh cùng hạng với bảng xếp hạng. Nên nó chịu đúng cổng mà bảng xếp
 * hạng chịu, khuôn `docBangXepHang`.
 *
 * Ranh giới đo được và nói ra: `bid.view` do **PROCUREMENT_MANAGER · FINANCE · DIRECTOR** giữ,
 * còn `award.recommend` thì BUYER cũng giữ — nên một `BUYER` đề xuất được mà **không đọc lại
 * được** đề xuất của mình. Đó không phải một khiếm khuyết của vòng này: một `BUYER` cũng không
 * đọc được bảng xếp hạng để CHỌN báo giá, nên đường của họ đã hỏng từ trước award. Ma trận quyền
 * là chỗ phải sửa, không phải cổng này.
 */
export async function docTraoThau(
  client: pg.PoolClient,
  orgId: string,
  input: DocTraoThauInput,
  auditPool: pg.Pool,
): Promise<TraoThauDayDu | null> {
  await assertTenantBound(client, orgId, "docTraoThau");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.BID_VIEW,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  const rfqId = input.rfqId;
  const h = await awardMoiNhat(client, orgId, rfqId);
  if (h === undefined) return null;

  // Chữ ký thuộc về ĐỀ XUẤT, không về hàng mới nhất — `rfq_award_approvals.award_id` trỏ tới hàng
  // `PROPOSED`. Với một hàng `APPROVED`/`CANCELLED`, đề xuất tương ứng là hàng `PROPOSED` mới nhất
  // KHÔNG muộn hơn nó; `truoc_id` của trigger đọc cùng một thứ.
  const { rows: chuKy } = await client.query<{ approver_user_id: string; approved_at: Date }>(
    `SELECT ap.approver_user_id, ap.approved_at
       FROM public.rfq_award_approvals ap
       JOIN public.rfq_awards dx ON dx.org_id OPERATOR(pg_catalog.=) ap.org_id
                                AND dx.id OPERATOR(pg_catalog.=) ap.award_id
      WHERE ap.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND dx.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND dx.status OPERATOR(pg_catalog.=) 'PROPOSED'
        AND dx.acted_at OPERATOR(pg_catalog.<=) $3::pg_catalog.timestamptz
      ORDER BY ap.approved_at ASC`,
    [orgId, rfqId, h.acted_at],
  );

  return {
    ...doiAward(h),
    approvals: chuKy.map((c) => ({
      approverUserId: c.approver_user_id,
      approvedAt: c.approved_at,
    })),
  };
}
