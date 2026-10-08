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
//   * hàng `CANCELLED` đưa về `EVALUATING`, và đó là lúc một đề xuất mới đi được;
//   * **[S1.231 / khoản 232 / ADR-133]** hàng `WITHDRAWN` — người đề xuất rút đề xuất CHƯA chữ ký của
//     mình — cũng đưa về `EVALUATING`: hàng rút không phải một award còn sống, và J7 mở lại sau nó.
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
// ~~Và khác `060`, tầng CSDL ở đây **không** canh vế ấy: `award_kiem_de_xuat` chỉ đòi lượt chấm
// thuộc đúng RFQ, không đòi nó là lượt mới nhất. Nên câu `ORDER BY e.created_at DESC` dưới đây là
// lớp **DUY NHẤT**~~ — một bất đối xứng có chủ ý ghi thành khoản **231**, không một chỗ bỏ sót:
// `060` cần lớp CSDL vì `rfq_bafo_rounds.evaluation_id` có `GRANT INSERT` cho `app_api` và một
// thân yêu cầu khai được nó; ở đây `evaluationId` không phải tham số của hàm nào, nên vectơ ấy
// chưa có đường. ~~Ngày nào có, khoản 231 là chỗ đã ghi cái giá.~~ **[S1.231 / khoản 231 ĐÓNG]**
// Từ `093`, `award_kiem_de_xuat` cũng đòi *không lượt chấm nào của RFQ mới hơn* (khuôn `060` mục (A),
// nhánh có tên `j5_luot_cham_khong_moi_nhat`): câu `ORDER BY e.created_at DESC` dưới đây nay là lớp
// THỨ HAI, và hai lớp nói cùng một câu như ở vòng BAFO. Ca đo khoá vế này nằm ở
// `luot-danh-gia.int.test.ts` — ca cũ đo lớp gói, ca `[khoản 231]` chèn thẳng một hàng trỏ lượt CŨ —
// cả hai đo SAU một chu kỳ BAFO, tức ở đúng thế giới có HAI lượt chấm.
//
// ----------------------------------------------------------------------------------------------
// HUỶ ĐÒI `po.approve`, KHÔNG PHẢI `award.recommend`
// ----------------------------------------------------------------------------------------------
// Một phép đo trên ma trận quyền: `award.recommend` do **BUYER · PROCUREMENT_MANAGER · FINANCE ·
// DIRECTOR** giữ, còn `po.approve` chỉ **FINANCE · DIRECTOR**. Nếu huỷ đi qua `award.recommend`
// thì một `BUYER` huỷ được một award **đã duyệt** rồi đề xuất người khác — tức phê duyệt kép bị
// tháo bằng cách bào mòn chứ không bằng cách vượt. Cổng huỷ vì thế là cổng của người **duyệt**.
//
// ~~Cái giá, nói thẳng: người đề xuất **không tự rút lại được** đề xuất của mình.~~ Đó là một quyền
// hẹp hơn và hợp lý, nhưng nó đòi một trạng thái thứ tư (`WITHDRAWN`) hoặc một cổng phụ thuộc
// trạng thái, và cả hai đều là thiết kế mới. ~~Không dựng ở vòng này — ghi thành khoản **232**.~~
// **[S1.231 / khoản 232 ĐÓNG — ADR-133]** Chủ dự án chốt hình ⒜: `rutDeXuatTraoThau` ghi hàng
// `WITHDRAWN` (`094`) dưới cổng `award.recommend` — cùng cổng với lần đề xuất, KHÔNG một cổng đọc dữ
// liệu nào ở `apps/api`. Ba vế ràng ở CSDL: hàng mới nhất là `PROPOSED`, người rút là người đề xuất
// (`acted_by`, cột dẫn xuất từ phiên), đề xuất có 0 chữ ký. Cổng huỷ giữ nguyên `po.approve`.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, laMaChot, maChotTuLoi, requirePermission, resolveSessionActor, tuChoiTheoChot } from "@trustprocure/identity";
import { nemTuChoi, type MaTuChoiTrangThai } from "./tu-choi-vao-so.js";

// ==============================================================================================
// [S1.280 / S3.5a · spec S3 §4.7, §5.1 K7 · K2b · K5b] TRAO THẦU THEO BẬC — CHỮ KÝ SỐNG ĐỘC LẬP VỚI HÀNG `APPROVED`
//
// `113_trao_thau_theo_bac` đặt số chữ ký cần ở CSDL (`award_so_chu_ky_can` — bậc CAO HƠN trong hai bậc ước lượng và số tiền trao),
// vai người ký theo bậc, hậu kiểm số báo giá (K2b) và chữ ký độc lập (K5b). Tầng gói đi khuôn K1/K2/K5 (ADR-084 ⑷, ADR-147 ⑼): hỏi
// hàm vị từ TRƯỚC mọi tác dụng phụ — một mã ⇒ `CONTROL_DENIED` ở giao dịch độc lập —, còn trigger riêng ở cạnh hỏi lại làm lớp chặn
// cuối cho câu viết tay (bắt theo tên ràng buộc, `maChotTuLoi`). Bốn câu hỏi đứng ở đây, cạnh câu ghi, vì bộ đọc QT3 rút câu theo TỆP.
//
// Và điều khoản 242 ⑴ đo được (S1.139, S1.142): chữ ký và hàng `APPROVED` trong CÙNG giao dịch thì cần hai chữ ký là không bao giờ
// duyệt được. Nay `duyetTraoThau` ghi chữ ký, hỏi `award_du_chu_ky`, và CHỈ chèn hàng `APPROVED` khi đủ; chưa đủ thì đề xuất đứng
// yên ở `PROPOSED` với chữ ký còn đó, và lời trả về nói còn cần bao nhiêu. Tổ chức chưa bật S3: `award_so_chu_ky_can` trả 1, nên
// hành vi y như trước — một chữ ký, một hàng `APPROVED`, cùng lời gọi.
// ==============================================================================================
/** Chốt bậc — `$1` tổ chức, `$2` gói, `$3` phiên bản báo giá được chọn. */
const CAU_CHOT_BAC =
  "SELECT public.award_chot_bac($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid) AS ly_do";
/** Chốt hậu kiểm K2b — `$1` tổ chức, `$2` gói, `$3` lượt chấm của đề xuất, `$4` phiên bản báo giá. */
const CAU_CHOT_HAU_KIEM =
  "SELECT public.award_chot_hau_kiem($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid) AS ly_do";
/** Chốt người ký K7 — `$1` tổ chức, `$2` đề xuất, `$3` người ký. */
const CAU_CHOT_NGUOI_KY =
  "SELECT public.award_chot_nguoi_ky($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid) AS ly_do";
/** Chốt chữ ký độc lập K5b — `$1` tổ chức, `$2` đề xuất. */
const CAU_CHOT_DOC_LAP =
  "SELECT public.award_chot_doc_lap($1::pg_catalog.uuid, $2::pg_catalog.uuid) AS ly_do";
/** Số chữ ký cần và đủ chưa — `$1` tổ chức, `$2` đề xuất. Một phép tính ở CSDL, không bản đếm nào ở lớp này. */
const CAU_DU_CHU_KY =
  "SELECT public.award_so_chu_ky_can($1::pg_catalog.uuid, $2::pg_catalog.uuid) AS can, " +
  "public.award_du_chu_ky($1::pg_catalog.uuid, $2::pg_catalog.uuid) AS du";

/**
 * Hỏi một hàm vị từ rồi ném theo bảng `CHOT_VAO_SO` — cùng thân với `kiemChot` của `@trustprocure/rfq` (gói này không phụ thuộc
 * `rfq`, và một cạnh phụ thuộc mới chỉ để dùng chung mười dòng là một cạnh depcruise phải bless). Mã lạ ⇒ lỗi KHÔNG tên.
 */
async function hoiChot(
  client: pg.PoolClient,
  auditPool: pg.Pool,
  orgId: string,
  actor: { readonly type: "USER"; readonly id: string },
  rfqId: string,
  cau: string,
  thamSo: readonly unknown[],
): Promise<void> {
  const { rows } = await client.query<{ ly_do: string | null }>(cau, [...thamSo]);
  const ma = rows[0]?.ly_do ?? null;
  if (ma === null) return;
  if (!laMaChot(ma)) {
    throw new Error("hàm vị từ của chốt trao thầu trả một mã không có trong CHOT_VAO_SO — hai bên đã trôi khỏi nhau");
  }
  await tuChoiTheoChot(auditPool, orgId, actor, rfqId, ma);
}

// ==============================================================================================
// [S1.167 / khoản 247 / ADR-104] LẦN VI PHẠM J3 VÀO SỔ — Ở GIAO DỊCH ĐỘC LẬP, ~~RỒI NÉM LẠI CHÍNH LỖI CỦA TRIGGER~~
// **[S1.180 / ADR-108] RỒI NÉM LỜI TỪ CHỐI CỦA CHỐT**
//
// J3 sống ở hai trigger của `061` (`award_kiem_de_xuat`, thân từ `064`, và `award_kiem_nguoi_duyet`). Lần vi phạm là một `RAISE
// … (J3)` với SQLSTATE 23514: nó huỷ giao dịch của người gọi, nên trước vòng này không lối nào ghi được nó — `pnpm pilot:gia-lap`
// đo bốn lần 422 *"(J3)"*, 0 hàng sổ. Đây là đúng lớp dấu vết mà nguyên tắc 1 của `docs/PRODUCT.md` §4 cần: một người cố nắm hai
// mắt xích của chuỗi *tạo RFQ → điều phối mở thầu → đề xuất → duyệt*.
//
// VÌ SAO BẮT LỖI CỦA TRIGGER CHỨ KHÔNG KIỂM TRƯỚC Ở ĐÂY: trigger là lớp có thẩm quyền và nó đọc bảng lịch sử điều phối dưới
// đúng khoá của câu ghi. Chép vị từ ra TypeScript là hai nguồn sự thật cho một luật; bắt lỗi của nó thì sổ ghi đúng thứ CSDL đã
// từ chối. ~~Cùng khuôn nhánh D2 của `approveUnseal` (`packages/unseal/src/requests.ts`): `throwAuditedDenial` ghi ở `auditPool`
// rồi ném lại chính lỗi `pg`, nên mã 422 và thông điệp người dùng thấy KHÔNG đổi. Ghi hỏng ⇒ `DenialAuditFailedError` ⇒ 500.~~
//
// **[S1.180 / ADR-108]** Lớp của lần từ chối là `CONTROL_DENIED` — người vi phạm J3 có đủ quyền và đi đúng thứ tự, thứ chặn
// họ là một chốt (ADR-084 ⑸) — và nó được nhận ra bằng TÊN RÀNG BUỘC mà trigger đặt (`074_tu_choi_co_ten.sql`), không bằng
// hậu tố *"(J3)"* cùng đầu câu. `tuChoiTheoChot` ghi một hàng mang mã ở `auditPool` rồi ném `ChotKiemSoatError` (422, thông
// điệp của bảng `CHOT_VAO_SO`) mang lỗi `pg` ở `cause`. Ghi hỏng ⇒ `DenialAuditFailedError` ⇒ 500, như trước.
// ==============================================================================================

/** Lý do máy đọc được của một lần từ chối ở lớp này — cùng khuôn `LyDoTuChoiVong`. */
// [S1.116 / khoản 239] Suy TỪ `MaTuChoiTrangThai` — xem `tu-choi-vao-so.ts`.
export type LyDoTuChoiTraoThau = Extract<
  MaTuChoiTrangThai,
  | "RFQ_KHONG_DE_XUAT_DUOC"
  | "CHUA_CHAM_LAN_NAO"
  | "KHONG_CO_DE_XUAT_DANG_CHO"
  | "KHONG_CO_AWARD_CON_SONG"
  // [S1.231 / khoản 232] hai lối từ chối của lần RÚT.
  | "KHONG_PHAI_NGUOI_DE_XUAT"
  | "DE_XUAT_DA_CO_CHU_KY"
  | "DA_KY_DE_XUAT_NAY"
>;

export class TraoThauTuChoiError extends Error {
  constructor(
    readonly lyDo: LyDoTuChoiTraoThau,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "TraoThauTuChoiError";
  }
}

// [S1.231 / khoản 232 / ADR-133] `WITHDRAWN` — trạng thái thứ tư (`094`): người đề xuất rút đề xuất chưa chữ ký.
export type TrangThaiTraoThau = "PROPOSED" | "APPROVED" | "CANCELLED" | "WITHDRAWN";

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
  /**
   * [S1.9101 / S3.4b / K9] Chữ ký này có đếm ở K7 (đủ chữ ký, hai vai) và K5b (độc lập) không — `false` khi người ký đã khai
   * `CO_XUNG_DOT` trên gói (kể cả SAU khi ký). Đọc từ CHÍNH hàm mà hai chốt đếm (`award_chu_ky_con_hieu_luc`, `9501`), không đếm
   * lại ở lớp này: màn nói *có M / cần N* trên chữ ký còn hiệu lực, và chỉ ra chữ ký nào không đếm.
   */
  readonly conHieuLuc: boolean;
}

export interface TraoThauDayDu extends TraoThau {
  readonly approvals: readonly ChuKyDuyet[];
  /**
   * [S1.280 / S3.5a] Số chữ ký mà đề xuất đang sống cần — `award_so_chu_ky_can` của bậc cao hơn (1 ở tổ chức chưa bật). `null` khi
   * gói không có hàng đề xuất nào. Màn đọc *cần N, có M* từ đây, không tự đếm.
   */
  readonly chuKyCan: number | null;
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
  /**
   * [S1.261 / khoản 335] Hàng award mà người huỷ ĐÃ ĐỌC — phải là hàng MỚI NHẤT của gói lúc huỷ, cùng khuôn
   * `DuyetTraoThauInput.awardId`. Trước vòng này hàm huỷ hàng mới nhất bất kể người gọi đã đọc hàng nào: giữa lần đọc và lần
   * huỷ, đề xuất kia rút được rồi một đề xuất KHÁC dựng lên, hay được duyệt — và lần huỷ ăn vào thứ người huỷ chưa thấy.
   * Hàng của gói KHÁC không bao giờ là hàng mới nhất của gói này, nên cùng một phép so cũng chặn id lạc gói.
   */
  readonly awardId: string;
  readonly reason: string;
  readonly actorSessionId: string;
}

/**
 * [S1.231 / khoản 232] Rút đề xuất — một lý do BẮT BUỘC, không `awardId` (hàng mới nhất là đích; `094` chỉ cho rút `PROPOSED`
 * của CHÍNH người gọi, 0 chữ ký). ~~Cùng hình dạng với huỷ.~~ **[S1.261 / khoản 335]** Huỷ nay mang `awardId`.
 */
export interface RutDeXuatTraoThauInput {
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
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "RFQ_KHONG_DE_XUAT_DUOC",
        `Chỉ đề xuất trao thầu khi gói thầu đang ở EVALUATING; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
      ),
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
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "CHUA_CHAM_LAN_NAO",
        "Gói thầu này chưa có lượt chấm nào; một award phải trỏ tới một hàng xếp hạng nên không đề xuất được.",
      ),
    );
  }

  // [S1.280 / S3.5a] Hỏi trước hai chốt của cạnh đề xuất: bậc (gói không bậc ghim, tiền tệ lệch, bậc đấu thầu chính thức) và hậu
  // kiểm K2b — số nhóm có báo giá hợp lệ đã biết từ lúc chấm, nên ngoại lệ `LOW_ACTUAL_COMPETITION` phải có TRƯỚC đề xuất và mọi chữ ký
  // ký lên một gói đã có nó. Phiên bản báo giá không phải một báo giá đã mở của gói ⇒ hàm vị từ cho qua để J5 nói ở trigger.
  await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_BAC, [orgId, input.rfqId, input.bidVersionId]);
  await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_HAU_KIEM, [orgId, input.rfqId, lv.id, input.bidVersionId]);

  let award: HangAward[];
  try {
    ({ rows: award } = await client.query<HangAward>(
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
    ));
  } catch (loi) {
    // [S1.167 / khoản 247] J3 vế 2 và 3 sống ở trigger `award_kiem_de_xuat` (`061`, thân `064`): lần vi phạm huỷ giao dịch nên
    // trước vòng này không để lại hàng sổ nào. Ghi ở giao dịch ĐỘC LẬP rồi ném — xem khối đầu tệp ([S1.180] theo chốt).
    // [S1.231 / khoản 231] Vế J5 *lượt chấm mới nhất* của `093` đi cùng đường: tên `j5_luot_cham_khong_moi_nhat` có dòng ở
    // `CHOT_THEO_RANG_BUOC` (ADR-108), nên một lượt chấm sinh dưới chân câu chọn ở trên — chỉ tới được bằng một đường ghi thứ hai
    // — thành `ChotKiemSoatError` mang `J5_LUOT_CHAM_KHONG_MOI_NHAT` và một hàng `CONTROL_DENIED`.
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }

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
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "RFQ_KHONG_DE_XUAT_DUOC",
        "Trạng thái gói thầu đã đổi giữa lúc đề xuất trao thầu; đề xuất này không được ghi nhận.",
      ),
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
 * Số chữ ký cần sống ở **CSDL** ~~(`CHU_KY_CAN` trong `award_kiem_mot_award_song`), chốt là MỘT
 * (§7, 2026-09-22). Nên hàm này ghi chữ ký rồi ghi luôn hàng `APPROVED`~~; ~~nếu ngày nào con số ấy
 * thành hai, câu `INSERT` thứ hai từ chối với thông điệp gọi tên số chữ ký đang có, và lời gọi
 * của người duyệt thứ hai đi qua~~. **[S1.142 / khoản 242 ⑴] Vế vừa gạch SAI, và đã đo:** hai câu
 * `INSERT` nằm trong CÙNG một giao dịch, nên với `CHU_KY_CAN := 2` lời gọi đầu bị từ chối và chữ ký
 * của nó rơi theo giao dịch; người duyệt thứ hai gặp đúng lỗi ấy — trao thầu không bao giờ duyệt
 * được. ~~Hai chữ ký cần chữ ký sống độc lập với hàng `APPROVED` (S3.5).~~ **[S1.280 / S3.5a] Nay là
 * `award_so_chu_ky_can` (`113`): bậc CAO HƠN trong hai bậc ước lượng và số tiền trao, 1 ở tổ chức chưa bật. Hàm này ghi chữ ký,
 * hỏi `award_du_chu_ky`, và chỉ chèn hàng `APPROVED` khi đủ — chưa đủ thì chữ ký SỐNG và lời trả về nói còn cần bao nhiêu.** Không
 * có phép đếm nào ở lớp này — hai bản đếm là hai bản trôi.
 *
 * **[S1.263 / khoản 338]** Câu *"bị chặn ngay vì hàng ấy không còn `PROPOSED`"* ở trên nói về một hàng không bao giờ đổi —
 * `rfq_awards` chỉ-ghi-thêm, hàng đề xuất mang `PROPOSED` mãi mãi; thứ chặn là trigger `award_kiem_mot_award_song` đọc hàng MỚI
 * NHẤT, và nó chặn bằng một lỗi thô 23514 không tên, không hàng sổ. Nay hàm giữ khoá hàng RFQ (`FOR NO KEY UPDATE`) như rút, huỷ
 * và đề xuất, rồi đòi đề xuất được nêu là hàng mới nhất của gói; khác ⇒ `KHONG_CO_DE_XUAT_DANG_CHO` có tên. Khoá ấy là thứ đóng
 * giới hạn khoản 335 nói ra: không có nó, lần huỷ đọc hàng mới nhất khi hàng `APPROVED` của lần duyệt chưa commit, qua phép so id
 * của nó, rồi ăn vào hàng `APPROVED` ấy.
 */
export async function duyetTraoThau(
  client: pg.PoolClient,
  orgId: string,
  input: DuyetTraoThauInput,
  auditPool: pg.Pool,
): Promise<TraoThauDayDu> {
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
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_DE_XUAT_DANG_CHO",
        `Chỉ duyệt được một đề xuất đang ở PROPOSED; đề xuất này đang ở ${dx?.status ?? "(không tìm thấy)"}.`,
      ),
    );
  }
  // Đề xuất phải thuộc ĐÚNG gói thầu mà lời gọi khai — xem `DuyetTraoThauInput.rfqId`.
  if (dx.rfq_id !== input.rfqId) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_DE_XUAT_DANG_CHO",
        "Đề xuất trao thầu này không thuộc gói thầu được nêu trong đường dẫn.",
      ),
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

  // [S1.263 / khoản 338] Khoá hàng RFQ suốt hàm — cùng khuôn `deXuatTraoThau`/`huyTraoThau`/`rutDeXuatTraoThau` — rồi đề xuất
  // được nêu phải là hàng MỚI NHẤT của gói: một lần huỷ (hay rút rồi đề xuất lại) commit trước thì lần duyệt này từ chối có tên.
  await client.query(
    `SELECT p.id FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      FOR NO KEY UPDATE`,
    [orgId, input.rfqId],
  );
  const moiNhat = await awardMoiNhat(client, orgId, input.rfqId);
  if (moiNhat?.id !== dx.id) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_DE_XUAT_DANG_CHO",
        `Đề xuất này không còn là trao thầu mới nhất của gói — gói đã đổi từ lúc đọc (hàng mới nhất đang ở ${moiNhat?.status ?? "(không có)"}). ` +
          "Lần duyệt này không được ghi nhận; đọc lại trao thầu của gói rồi mới duyệt.",
      ),
    );
  }

  // [S1.280 / S3.5a] Một người ký rồi gọi lại khi đề xuất còn chờ chữ ký khác: lời có tên thay vì lỗi UNIQUE thô — chữ ký của
  // họ đã đếm, người cần ký là người KHÁC. (Đề xuất đã duyệt thì hàng mới nhất là `APPROVED` và vế trên đã nói.)
  const { rows: daKy } = await client.query<{ n: number }>(
    `SELECT pg_catalog.count(*)::pg_catalog.int4 AS n
       FROM public.rfq_award_approvals ap
      WHERE ap.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND ap.award_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND ap.approver_user_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid`,
    [orgId, dx.id, actor.id],
  );
  if ((daKy[0]?.n ?? 0) > 0) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "DA_KY_DE_XUAT_NAY",
        "Bạn đã ký đề xuất này; đề xuất còn chờ chữ ký của người KHÁC thuộc vai mà bậc của gói đòi.",
      ),
    );
  }

  // [S1.280 / S3.5a] Hỏi trước hai chốt của chữ ký: bậc (trigger chữ ký hỏi lại) và người ký — vai thuộc `award_vai` của bậc cao hơn,
  // không là tác giả phiên bản chính sách ghim (K7). Một mã ⇒ `CONTROL_DENIED` trước mọi câu ghi.
  await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_BAC, [orgId, dx.rfq_id, dx.bid_version_id]);
  await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_NGUOI_KY, [orgId, dx.id, actor.id]);

  try {
    await client.query(
      `INSERT INTO public.rfq_award_approvals
         (org_id, award_id, approver_user_id, approver_session_id)
       VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid)`,
      [orgId, dx.id, actor.id, input.actorSessionId],
    );
  } catch (loi) {
    // [S1.167 / khoản 247] J3 vế 1 — người đề xuất tự duyệt, hay phiên đã đề xuất đem đi duyệt — sống ở trigger
    // `award_kiem_nguoi_duyet` (`061`). Cùng lối ra với đường đề xuất: một hàng sổ ở giao dịch độc lập, rồi ~~chính lỗi trigger~~
    // **[S1.180]** lời từ chối của chốt. [S1.280] Và lớp chặn cuối của K7 ở trigger chữ ký (`113`) đi cùng lối.
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }

  // [S1.280 / S3.5a] Đủ chữ ký chưa — hỏi CSDL, không đếm ở đây (hai bản đếm là hai bản trôi). Chưa đủ ⇒ chữ ký vừa ghi SỐNG
  // (commit cùng giao dịch này), đề xuất đứng yên ở `PROPOSED`, và lời trả về mang đề xuất kèm số cần — đó chính là chỗ khoản 242 ⑴
  // đo được rằng bản cũ không bao giờ tới.
  const { rows: dem } = await client.query<{ can: number; du: boolean }>(CAU_DU_CHU_KY, [orgId, dx.id]);
  const can = dem[0]?.can ?? 1;
  const du = dem[0]?.du === true;

  // Đủ ⇒ hai chốt của cạnh duyệt: hậu kiểm K2b (lớp chặn cuối — ngoại lệ đã phải có từ lúc đề xuất) và chữ ký độc lập K5b — đọc
  // TẬP chữ ký kể cả chữ ký vừa ghi, nên hỏi SAU câu chèn và TRƯỚC mọi hàng sổ của giao dịch này: một hàng sổ giữ khoá chuỗi kiểm
  // toán của tổ chức tới khi commit (`050`), mà lần từ chối ghi `CONTROL_DENIED` ở giao dịch độc lập phải lấy đúng khoá ấy — hỏi sau
  // hàng sổ là tự khoá mình, ra `DenialAuditFailedError` (đo ở lượt đầu của `trao-thau-theo-bac.int.test.ts`). Một mã ⇒
  // `CONTROL_DENIED`, giao dịch này huỷ cùng chữ ký vừa ghi: người ký lại sau khi có người độc lập ký, hay sau khi gói được huỷ và đề
  // xuất lại với ngoại lệ (chủ dự án chốt phương án một giao dịch, 2026-10-07).
  if (du) {
    await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_HAU_KIEM, [orgId, dx.rfq_id, dx.evaluation_id, dx.bid_version_id]);
    await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_DOC_LAP, [orgId, dx.id]);
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_AWARD_SIGNED",
    resourceType: "rfq_award",
    resourceId: dx.id,
    payload: {
      rfqId: dx.rfq_id,
      evaluationId: dx.evaluation_id,
      bidVersionId: dx.bid_version_id,
      signedBySessionId: input.actorSessionId,
      chuKyCan: can,
    },
  });
  if (!du) {
    return docDayDu(client, orgId, dx, can);
  }

  // Hàng `APPROVED` phải chép ĐÚNG `evaluation_id`/`bid_version_id` của đề xuất —
  // `award_kiem_mot_award_song` từ chối nếu lệch, và vế ấy tồn tại để một hàng "duyệt" không nói
  // về một báo giá khác hẳn thứ đã được đề xuất.
  let award: HangAward[];
  try {
    ({ rows: award } = await client.query<HangAward>(
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
    ));
  } catch (loi) {
    // Lớp chặn cuối của cạnh APPROVED (`113`): mã chốt ⇒ hàng sổ ở giao dịch độc lập, cùng lối với chữ ký ở trên.
    // ~~[S1.281 / S3.4a / K9] Hàng `APPROVED` đòi ít nhất một chữ ký duyệt của người KHÔNG khai có xung đột — trigger
    // `rfq_awards_kiem_xung_dot` (`114`) đặt tên `k9_chu_ky_co_xung_dot`.~~ [S1.9101 / S3.4b] Nhánh ấy bỏ ở `9501`: `award_du_chu_ky`
    // (hỏi ở trên, và lại ở trigger K7 của cạnh này) nay đếm chữ ký KHÔNG xung đột, nên một chữ ký của người khai `CO_XUNG_DOT` sau
    // khi ký đơn giản là không đếm — đề xuất đứng yên ở `PROPOSED`, lời trả về đánh dấu chữ ký ấy (`conHieuLuc`).
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }
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
      chuKyCan: can,
    },
  });

  return docDayDu(client, orgId, a, can);
}

/**
 * [S1.280 / S3.5a] Hàng award kèm chữ ký của đề xuất đang sống và số chữ ký cần — hình dạng mà `duyetTraoThau` trả về ở CẢ hai lối
 * (chưa đủ: hàng `PROPOSED`; đủ: hàng `APPROVED`), cùng hình dạng `docTraoThau`. `deXuat` là hàng `PROPOSED` mới nhất của gói.
 */
async function docDayDu(client: pg.PoolClient, orgId: string, h: HangAward, chuKyCan: number | null): Promise<TraoThauDayDu> {
  const { rows: chuKy } = await client.query<{ approver_user_id: string; approved_at: Date; con_hieu_luc: boolean }>(
    `SELECT ap.approver_user_id, ap.approved_at,
            EXISTS (SELECT 1 FROM public.award_chu_ky_con_hieu_luc($1::pg_catalog.uuid, ap.award_id) k
                     WHERE k.nguoi OPERATOR(pg_catalog.=) ap.approver_user_id) AS con_hieu_luc
       FROM public.rfq_award_approvals ap
      WHERE ap.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND ap.award_id OPERATOR(pg_catalog.=) (
              SELECT dx.id
                FROM public.rfq_awards dx
               WHERE dx.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
                 AND dx.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
                 AND dx.status OPERATOR(pg_catalog.=) 'PROPOSED'
               ORDER BY dx.acted_at DESC, dx.id DESC
               LIMIT 1)
      ORDER BY ap.approved_at ASC`,
    [orgId, h.rfq_id],
  );
  return {
    ...doiAward(h),
    approvals: chuKy.map((c) => ({ approverUserId: c.approver_user_id, approvedAt: c.approved_at, conHieuLuc: c.con_hieu_luc })),
    chuKyCan,
  };
}

/**
 * HUỶ award còn sống của một gói thầu, và đưa gói ấy về `EVALUATING`.
 *
 * Cổng là `po.approve` — xem khối đầu tệp. `reason` BẮT BUỘC: `061` đặt `CHECK` *không rỗng* trên
 * MỌI hàng, kể cả hàng huỷ, và một lần huỷ không có lý do là đúng thứ D5 tồn tại để cấm.
 *
 * **[S1.261 / khoản 335]** Nhận `awardId` và chỉ huỷ khi nó là hàng MỚI NHẤT của gói — phép so đứng SAU khoá hàng RFQ
 * (`FOR NO KEY UPDATE`), nên rút, huỷ và đề xuất của người khác (cả ba giữ cùng khoá) không chen được vào giữa phép so và câu
 * `INSERT`. ~~Giới hạn, đọc từ mã chứ không đo: `duyetTraoThau` KHÔNG giữ khoá hàng RFQ, nên một lần duyệt CHÍNH đề xuất ấy chen
 * được vào khe ấy — khi đó hàng huỷ ăn vào hàng `APPROVED` vừa ghi, cùng báo giá (`award_kiem_mot_award_song` buộc hàng huỷ
 * nói về đúng báo giá của hàng mới nhất); không bao giờ vào một đề xuất hay báo giá khác.~~ **[S1.263 / khoản 338]** Đo bằng
 * hai lời gọi thật cùng lúc: đúng thế, và nay đóng — `duyetTraoThau` giữ cùng khoá ấy (ca ⑴ của `luot-danh-gia.int`).
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
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_AWARD_CON_SONG",
        `Chỉ huỷ được khi gói thầu đang ở AWARDED; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
      ),
    );
  }

  const truoc = await awardMoiNhat(client, orgId, input.rfqId);
  // [S1.231 / khoản 232] `WITHDRAWN` cũng không phải một award còn sống — cùng vế với trigger `094`.
  if (truoc === undefined || truoc.status === "CANCELLED" || truoc.status === "WITHDRAWN") {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_AWARD_CON_SONG",
        "Gói thầu đang ở AWARDED mà không có award nào còn sống — dữ liệu hỏng.",
      ),
    );
  }
  // [S1.261 / khoản 335] Huỷ ĐÚNG hàng người huỷ đã đọc — xem `HuyTraoThauInput.awardId`.
  if (truoc.id !== input.awardId) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_AWARD_CON_SONG",
        `Trao thầu được nêu không phải trao thầu mới nhất của gói này — gói đã đổi từ lúc đọc (hàng mới nhất đang ở ${truoc.status}), ` +
          "hoặc id thuộc gói khác. Lần huỷ này không được ghi nhận; đọc lại trao thầu của gói rồi mới huỷ.",
      ),
    );
  }

  let award: HangAward[];
  try {
    ({ rows: award } = await client.query<HangAward>(
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
    ));
  } catch (loi) {
    // [S1.281 / S3.4a / K9] Huỷ trao thầu là một cổng K9 (ADR-082 ⒄): trigger `rfq_awards_kiem_xung_dot` (`114`) hỏi
    // `coi_chot_hanh_dong` cho người huỷ và từ chối có tên — một hàng `CONTROL_DENIED` ở giao dịch độc lập rồi lời từ chối (ADR-114).
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }
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
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_AWARD_CON_SONG",
        "Trạng thái gói thầu đã đổi giữa lúc huỷ trao thầu; lần huỷ này không được ghi nhận.",
      ),
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
 * RÚT một đề xuất trao thầu CHƯA CÓ CHỮ KÝ — bởi chính người đã đề xuất — và đưa gói thầu về `EVALUATING`.
 *
 * [S1.231 / khoản 232 / ADR-133] Cổng là `award.recommend` — cùng cổng với lần đề xuất, KHÔNG phải một
 * cổng đọc dữ liệu: ba vế *hàng mới nhất là `PROPOSED`* · *người rút là người đề xuất* · *0 chữ ký* sống ở
 * `award_kiem_mot_award_song` (`094`), lớp có thẩm quyền, mỗi vế một tên ràng buộc. Ba phép kiểm dưới đây
 * chỉ làm thông điệp nói được VÌ SAO và để lại một hàng sổ mang mã (ADR-060: cả ba là dấu vết của một người
 * cố đi một bước của chuỗi *award → duyệt* không đúng thứ tự). Có chữ ký rồi thì rút không tháo được — chỉ
 * `huyTraoThau` (`po.approve`, ADR-057) — nên phê duyệt kép không bị bào mòn bằng đường này. `reason` BẮT
 * BUỘC như mọi hàng của `rfq_awards`.
 */
export async function rutDeXuatTraoThau(
  client: pg.PoolClient,
  orgId: string,
  input: RutDeXuatTraoThauInput,
  auditPool: pg.Pool,
): Promise<TraoThau> {
  await assertTenantBound(client, orgId, "rutDeXuatTraoThau");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.AWARD_RECOMMEND,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  // `FOR NO KEY UPDATE` giữ hàng RFQ suốt hàm — cùng khuôn `deXuatTraoThau`/`huyTraoThau`.
  const { rows: rfq } = await client.query<{ status: string }>(
    `SELECT p.status FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      FOR NO KEY UPDATE`,
    [orgId, input.rfqId],
  );
  const trangThai = rfq[0]?.status;
  if (trangThai !== "AWARDED") {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_DE_XUAT_DANG_CHO",
        `Chỉ rút được khi gói thầu đang ở AWARDED với một đề xuất đang chờ; gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
      ),
    );
  }

  const truoc = await awardMoiNhat(client, orgId, input.rfqId);
  if (truoc === undefined || truoc.status !== "PROPOSED") {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_DE_XUAT_DANG_CHO",
        `Chỉ rút được một đề xuất đang ở PROPOSED; hàng mới nhất đang ở ${truoc?.status ?? "(chưa có đề xuất nào)"}.`,
      ),
    );
  }
  // Phép so CON NGƯỜI: `acted_by` là cột dẫn xuất từ phiên (`013`), `actor.id` cũng dẫn từ phiên đang gọi.
  if (truoc.acted_by !== actor.id) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_PHAI_NGUOI_DE_XUAT",
        "Chỉ người đã đề xuất mới rút được đề xuất của mình; người khác thì huỷ qua cổng po.approve.",
      ),
    );
  }
  const { rows: chuKy } = await client.query<{ n: number }>(
    `SELECT pg_catalog.count(*)::pg_catalog.int4 AS n
       FROM public.rfq_award_approvals ap
      WHERE ap.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND ap.award_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, truoc.id],
  );
  if ((chuKy[0]?.n ?? 0) > 0) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "DE_XUAT_DA_CO_CHU_KY",
        "Đề xuất này đã có chữ ký duyệt nên không rút được — chỉ huỷ được, và huỷ đòi po.approve.",
      ),
    );
  }

  // Hàng `WITHDRAWN` chép ĐÚNG `evaluation_id`/`bid_version_id` của đề xuất — vế *cùng báo giá* của `061`.
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
      "WITHDRAWN",
      input.reason,
      actor.id,
      input.actorSessionId,
    ],
  );
  const a = award[0];
  if (a === undefined) throw new Error("Không ghi được lần rút đề xuất trao thầu.");

  // Cạnh `AWARDED->EVALUATING` — cùng cạnh mà lần huỷ đi (ADR-057): không award nào còn sống.
  const doi = await client.query(
    `UPDATE public.rfq_packages
        SET status = 'EVALUATING'
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND status OPERATOR(pg_catalog.=) 'AWARDED'`,
    [orgId, input.rfqId],
  );
  if (doi.rowCount !== 1) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new TraoThauTuChoiError(
        "KHONG_CO_DE_XUAT_DANG_CHO",
        "Trạng thái gói thầu đã đổi giữa lúc rút đề xuất; lần rút này không được ghi nhận.",
      ),
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_AWARD_WITHDRAWN",
    resourceType: "rfq_award",
    resourceId: a.id,
    payload: {
      rfqId: input.rfqId,
      proposalAwardId: truoc.id,
      evaluationId: truoc.evaluation_id,
      bidVersionId: truoc.bid_version_id,
      reason: input.reason,
      withdrawnBySessionId: input.actorSessionId,
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
  // `PROPOSED`. Với một hàng `APPROVED`/`CANCELLED`/`WITHDRAWN`, đề xuất tương ứng là hàng `PROPOSED` mới nhất
  // KHÔNG muộn hơn nó; `truoc_id` của trigger đọc cùng một thứ.
  // [S1.231 / khoản 232] ~~Câu cũ JOIN MỌI hàng `PROPOSED` không muộn hơn hàng mới nhất~~ — sau một chu kỳ
  // `PROPOSED(chữ ký)→APPROVED→CANCELLED→PROPOSED`, đề xuất MỚI bị gán chữ ký của chu kỳ TRƯỚC, và nút
  // «Rút đề xuất» (đọc `approvals`) ẩn sai. Nay chọn ĐÚNG MỘT hàng: `PROPOSED` mới nhất của gói thầu, cùng
  // khoá sắp xếp với `awardMoiNhat`. Vế *không muộn hơn `h`* là THỪA — `h` là hàng mới nhất nên mọi hàng
  // `PROPOSED` đều không muộn hơn nó — và còn là một bẫy: đưa `h.acted_at` (một `Date` của JS, độ chính
  // xác mili-giây) trở lại SQL so với cột micro-giây thì chính hàng mới nhất bị loại (đo: ca `docTraoThau
  // đọc chữ ký của ĐÚNG đề xuất mới nhất` đỏ với bản đầu của vá). Không tham số thời gian đi qua JS.
  // [S1.280 / S3.5a] Số chữ ký cần của đề xuất ấy — CSDL tính (`award_so_chu_ky_can`), `null` khi gói chưa có đề xuất nào.
  const { rows: can } = await client.query<{ can: number | null }>(
    `SELECT public.award_so_chu_ky_can($1::pg_catalog.uuid, dx.id) AS can
       FROM public.rfq_awards dx
      WHERE dx.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND dx.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND dx.status OPERATOR(pg_catalog.=) 'PROPOSED'
      ORDER BY dx.acted_at DESC, dx.id DESC
      LIMIT 1`,
    [orgId, rfqId],
  );
  return docDayDu(client, orgId, h, can[0]?.can ?? null);
}
