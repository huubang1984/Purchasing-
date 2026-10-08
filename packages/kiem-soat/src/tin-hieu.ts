import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type ActorType } from "@trustprocure/audit";
import {
  CHOT_VAO_SO,
  PERMISSIONS,
  laMaChot,
  listUserIdsWithPermission,
  maChotTuLoi,
  requirePermission,
  resolveSessionActor,
  tuChoiTheoChot,
} from "@trustprocure/identity";

// =============================================================================================
// [S1.203 / S3.6b1] TÍN HIỆU CHIA NHỎ GÓI (`PURCHASE_SPLITTING`) VÀ LẦN GHI NHẬN — spec S3 §4.6, §5.1 K10, §2.5 ⒁
//
// Tín hiệu được TÍNH bởi đúng một hàm SQL, `tin_hieu_chia_nho` (`088_tin_hieu_chia_nho`); gói này không giữ bản sao nào của
// phép tính (spec §2 hàng 6). Nó làm ba việc quanh hàm ấy:
//   ⑴ ghi ảnh chụp tín hiệu lúc gói nộp duyệt — `submitRfqForApproval` gọi, trong CÙNG giao dịch với câu nộp;
//   ⑵ ghi nhận tín hiệu — người giữ `rfq.approve`, không tạo, không nộp gói nào trong bằng chứng, không khai phiên bản chính
//      sách mà gói ghim, kèm lý do. Chủ dự án chốt ngày 2026-09-29: tín hiệu MỚI (bằng chứng đã đổi sau lần nộp) được lưu ở
//      đây, lúc ghi nhận, trong giao dịch thành công của chính nó — cạnh mở gói chỉ đọc và từ chối;
//   ⑶ đọc tín hiệu của một gói, kèm tín hiệu HIỆN TẠI và việc nó có cần ghi nhận không.
// Chốt ở cạnh mở gói (K10a, `rfq_chot_tin_hieu`) nằm ở `openRfq` của `@trustprocure/rfq`, cạnh K1.
//
// Bằng chứng, độ tin cậy, giải thích và mốc tính do trigger đặt, ngoài `GRANT`: không câu nào ở đây khai chúng.
// =============================================================================================

/** Lời từ chối nghiệp vụ của gói này — `422` với câu của nó (`apps/api/src/dispatch.ts`). */
export class KiemSoatError extends Error {
  override readonly name = "KiemSoatError";
}

/** Một lần ghi nhận của một tín hiệu. */
export interface GhiNhanTinHieu {
  readonly id: string;
  readonly lyDo: string;
  readonly nguoi: string;
  /** [S3.6b2] Họ tên người ghi nhận — để màn nói AI đã đọc tín hiệu, không bắt người duyệt tra một id. */
  readonly nguoiTen: string | null;
  readonly luc: Date;
}

/** Một hàng tín hiệu — ảnh chụp lúc tính — cùng các lần ghi nhận của nó. */
export interface TinHieu {
  readonly id: string;
  readonly loai: string;
  /** `NOP_DUYET` — tính lúc gói nộp duyệt; `GHI_NHAN` — tính lại lúc ghi nhận, khi bằng chứng đã đổi sau lần nộp. */
  readonly nguon: string;
  readonly bangChung: unknown;
  readonly doTinCay: string;
  readonly giaiThich: string;
  readonly tinhLuc: Date;
  readonly nguoiGhi: string;
  /** [S3.6b2] Họ tên người mà lần nộp hay lần ghi nhận của họ đã lưu hàng này. */
  readonly nguoiGhiTen: string | null;
  readonly ghiNhan: readonly GhiNhanTinHieu[];
}

/** [S3.6b2] Một gói mà một bằng chứng — hiện tại hay đã lưu — nhắc tới: tên và trạng thái, không một con số nào. */
export interface GoiTrongBangChung {
  readonly tieuDe: string;
  readonly trangThai: string;
}

/**
 * [S3.6b2] Người đang xem ghi nhận được tín hiệu HIỆN TẠI không, và vì sao không. Chỉ để MÀN nói trước — cổng vẫn là
 * `ghiNhanTinHieu` và trigger `governance_signal_acks_kiem_nguoi`. Không có nó, một người gây ra tín hiệu chỉ biết mình bị loại
 * sau khi bấm, và lần bấm ấy để một hàng `CONTROL_DENIED` cộng một lần vào trần từ chối của phiên (ADR-112).
 */
export interface NguoiXemTinHieu {
  readonly ghiNhanDuoc: boolean;
  /** Câu nói vì sao không — `null` khi ghi nhận được, hay khi không có gì cần ghi nhận. */
  readonly lyDo: string | null;
}

/** [S1.285 / S3.6d] Loại tín hiệu — hai loại, hai cạnh bị chặn, hai quyền của cạnh (ADR-084 ⑵). */
export type LoaiTinHieu = "PURCHASE_SPLITTING" | "ESTIMATE_UNDERSTATED";

/** [S1.285 / S3.6d / K10b] Tín hiệu khai thấp ước lượng của gói — phần `/mo-thau` cần, cùng hình dạng với phần chia nhỏ. */
export interface TinHieuKhaiThap {
  /** Tín hiệu tính NGAY LÚC ĐỌC — `null` khi gói không có đề xuất đang sống hay số tiền trao không khai thấp. */
  readonly hienTai: unknown;
  /** Gói có đề xuất và tín hiệu hiện tại chưa có lần ghi nhận nào trên một tín hiệu có bằng chứng bằng nó — chữ ký trao thầu bị chặn. */
  readonly canGhiNhan: boolean;
  readonly nguoiXem: NguoiXemTinHieu;
  /** Số người giữ `po.approve` mà luật người cho ghi nhận; `null` khi không có gì cần ghi nhận. */
  readonly soNguoiGhiNhanDuoc: number | null;
}

export interface TinHieuCuaGoi {
  /** Tín hiệu tính NGAY LÚC ĐỌC — `null` khi gói không có tín hiệu nào. */
  readonly hienTai: unknown;
  /** Gói đang chờ duyệt và tín hiệu hiện tại chưa có lần ghi nhận nào trên một tín hiệu có bằng chứng bằng nó. */
  readonly canGhiNhan: boolean;
  readonly tinHieu: readonly TinHieu[];
  /** [S3.6b2] Mọi gói mà bằng chứng hiện tại hay một bằng chứng đã lưu nhắc tới, theo id. */
  readonly goi: Readonly<Record<string, GoiTrongBangChung>>;
  readonly nguoiXem: NguoiXemTinHieu;
  /**
   * [S3.6b2] Số người giữ `rfq.approve` mà luật người cho ghi nhận tín hiệu hiện tại — `0` là tổ chức kẹt (spec §8.10);
   * `null` khi không có gì cần ghi nhận.
   */
  readonly soNguoiGhiNhanDuoc: number | null;
  /** [S1.285 / S3.6d / K10b] Tín hiệu khai thấp ước lượng — loại thứ hai, chặn chữ ký trao thầu thay vì cạnh mở gói. */
  readonly khaiThap: TinHieuKhaiThap;
}

/** [S3.6b2] Câu màn nói khi người đang xem không giữ quyền của cạnh bị chặn. */
const CAN_QUYEN_GHI_NHAN = "Ghi nhận tín hiệu cần quyền duyệt gói thầu.";
const CAN_QUYEN_GHI_NHAN_KT = "Ghi nhận tín hiệu khai thấp cần quyền duyệt trao thầu.";
/** Quyền của cạnh bị chặn theo loại (ADR-084 ⑵): `rfq.approve` ở mở gói, `po.approve` ở chữ ký trao thầu. */
const QUYEN_THEO_LOAI = {
  PURCHASE_SPLITTING: PERMISSIONS.RFQ_APPROVE,
  ESTIMATE_UNDERSTATED: PERMISSIONS.PO_APPROVE,
} as const satisfies Readonly<Record<LoaiTinHieu, unknown>>;

export interface KetQuaGhiNhan {
  readonly signalId: string;
  readonly ackId: string;
  /** Lần ghi nhận này đã phải lưu một tín hiệu mới, vì bằng chứng đã đổi sau lần nộp. */
  readonly tinHieuMoi: boolean;
}

// [S1.285 / S3.6d] `$6` là LOẠI; tín hiệu hiện tại theo loại đọc qua `tin_hieu_hien_tai` (`116`) — một chỗ cho cả gói lẫn trigger.
const CAU_GHI_TIN_HIEU =
  "INSERT INTO public.governance_signals (org_id, rfq_id, loai, nguon, created_by, created_by_session_id) " +
  "SELECT $1::pg_catalog.uuid, $2::pg_catalog.uuid, $6::pg_catalog.text, $3::pg_catalog.text, $4::pg_catalog.uuid, $5::pg_catalog.uuid " +
  "WHERE public.tin_hieu_hien_tai($1::pg_catalog.uuid, $2::pg_catalog.uuid, $6::pg_catalog.text) IS NOT NULL RETURNING id";

const CAU_DOC_GOI =
  "SELECT r.status, public.tin_hieu_chia_nho(r.org_id, r.id) AS bang_chung, public.rfq_chot_tin_hieu(r.org_id, r.id) AS ly_do, " +
  "public.tin_hieu_khai_thap(r.org_id, r.id) AS bang_chung_kt, public.award_chot_tin_hieu(r.org_id, r.id) AS ly_do_kt " +
  "FROM public.rfq_packages r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid";

/** Luật người ghi nhận trên tín hiệu HIỆN TẠI của gói — `$1` tổ chức, `$2` gói, `$3` người, `$4` loại. */
const CAU_CHOT_NGUOI_GHI_NHAN =
  "SELECT public.tin_hieu_chot_nguoi_ghi_nhan($1::pg_catalog.uuid, " +
  "public.tin_hieu_hien_tai($1::pg_catalog.uuid, $2::pg_catalog.uuid, $4::pg_catalog.text), $3::pg_catalog.uuid) AS ly_do";

const CAU_TIM_TIN_HIEU =
  "SELECT s.id FROM public.governance_signals s " +
  "WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "AND s.loai OPERATOR(pg_catalog.=) $3::pg_catalog.text " +
  "AND s.bang_chung OPERATOR(pg_catalog.=) public.tin_hieu_hien_tai($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text) " +
  "ORDER BY s.tinh_luc DESC LIMIT 1";

const CAU_GHI_NHAN =
  "INSERT INTO public.governance_signal_acks (org_id, signal_id, ly_do, created_by, created_by_session_id) " +
  "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text, $4::pg_catalog.uuid, $5::pg_catalog.uuid) RETURNING id";

const CAU_DOC_TIN_HIEU =
  "SELECT s.id, s.loai, s.nguon, s.bang_chung, s.do_tin_cay, s.giai_thich, s.tinh_luc, s.created_by, u.full_name AS nguoi_ten " +
  "FROM public.governance_signals s LEFT JOIN public.users u ON u.id OPERATOR(pg_catalog.=) s.created_by " +
  "WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "ORDER BY s.tinh_luc, s.id";

const CAU_DOC_GHI_NHAN =
  "SELECT a.id, a.signal_id, a.ly_do, a.created_by, a.created_at, u.full_name AS nguoi_ten FROM public.governance_signal_acks a " +
  "JOIN public.governance_signals s ON s.org_id OPERATOR(pg_catalog.=) a.org_id AND s.id OPERATOR(pg_catalog.=) a.signal_id " +
  "LEFT JOIN public.users u ON u.id OPERATOR(pg_catalog.=) a.created_by " +
  "WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "ORDER BY a.created_at, a.id";

/** [S3.6b2] Tên và trạng thái các gói mà bằng chứng nhắc tới — `$2` là mảng id. Không cột tiền nào. */
const CAU_DOC_GOI_BANG_CHUNG =
  "SELECT r.id, r.title, r.status FROM public.rfq_packages r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.uuid[])";

/**
 * [S3.6b2] Luật người trên tín hiệu HIỆN TẠI, cho từng người trong mảng `$3` — cùng hàm với `CAU_CHOT_NGUOI_GHI_NHAN`, nên màn và
 * cổng không trôi khỏi nhau. Chỉ đọc: không câu nào ở đây ghi sổ.
 */
const CAU_LUAT_NGUOI_NHIEU =
  "SELECT n.id::pg_catalog.text AS id, public.tin_hieu_chot_nguoi_ghi_nhan($1::pg_catalog.uuid, " +
  "public.tin_hieu_hien_tai($1::pg_catalog.uuid, $2::pg_catalog.uuid, $4::pg_catalog.text), n.id) AS ly_do " +
  "FROM pg_catalog.unnest($3::pg_catalog.uuid[]) AS n(id)";

interface NguoiGoi {
  readonly type: ActorType;
  readonly id: string;
  readonly sessionId: string;
}

/**
 * Hỏi một hàm vị từ của chốt rồi ném theo `CHOT_VAO_SO` — khuôn `kiemChot` của `@trustprocure/rfq`, mà gói này không phụ thuộc
 * được (`rfq` với tới đường mở thầu). Gọi TRƯỚC mọi câu ghi: lần từ chối ghi sổ ở giao dịch độc lập, và một câu ghi sổ đã giữ
 * khoá chuỗi của tổ chức trong giao dịch này thì làm lần ghi ấy phải chờ.
 */
async function hoiChot(
  client: pg.PoolClient,
  auditPool: pg.Pool,
  orgId: string,
  actor: NguoiGoi,
  rfqId: string,
  cau: string,
  thamSo: readonly unknown[],
): Promise<void> {
  const { rows } = await client.query<{ ly_do: string | null }>(cau, [...thamSo]);
  const ma = rows[0]?.ly_do ?? null;
  if (ma === null) return;
  if (!laMaChot(ma)) {
    throw new Error("hàm vị từ của chốt trả một mã không có trong CHOT_VAO_SO — hai bên đã trôi khỏi nhau");
  }
  await tuChoiTheoChot(auditPool, orgId, actor, rfqId, ma);
}

async function ghiTinHieu(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  nguon: "NOP_DUYET" | "GHI_NHAN" | "DE_XUAT",
  actor: NguoiGoi,
  loai: LoaiTinHieu,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(CAU_GHI_TIN_HIEU, [orgId, rfqId, nguon, actor.id, actor.sessionId, loai]);
  return rows[0]?.id ?? null;
}

/**
 * ⑴ Ảnh chụp tín hiệu lúc gói vừa nộp duyệt — gọi SAU câu nộp, trong cùng giao dịch. Gói không có tín hiệu (hay tổ chức chưa bật)
 * thì không ghi gì và trả `null`. Không chặn gì: tín hiệu chỉ chặn lần MỞ gói khi chưa ai ghi nhận nó.
 */
export async function ghiTinHieuKhiNop(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  actor: NguoiGoi,
): Promise<string | null> {
  await assertTenantBound(client, orgId, "ghiTinHieuKhiNop");
  const signalId = await ghiTinHieu(client, orgId, rfqId, "NOP_DUYET", actor, "PURCHASE_SPLITTING");
  if (signalId !== null) {
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "GOVERNANCE_SIGNAL_RECORDED",
      resourceType: "rfq_package",
      resourceId: rfqId,
      payload: { signalId, loai: "PURCHASE_SPLITTING", nguon: "NOP_DUYET" },
    });
  }
  return signalId;
}

/**
 * [S1.285 / S3.6d / K10b] ⑴b Ảnh chụp tín hiệu KHAI THẤP lúc vừa đề xuất trao thầu — gọi SAU câu chèn đề xuất và sau cạnh
 * `EVALUATING->AWARDED`, trong cùng giao dịch, TRƯỚC mọi hàng sổ của đường đề xuất (hàng sổ giữ khoá chuỗi tới commit). Gói không
 * khai thấp (hay tổ chức chưa bật) thì không ghi gì và trả `null`. Không chặn gì: tín hiệu chặn CHỮ KÝ duyệt trao thầu khi chưa ai ghi
 * nhận nó (`award_chot_tin_hieu`).
 */
export async function ghiTinHieuKhiDeXuat(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  actor: NguoiGoi,
): Promise<string | null> {
  await assertTenantBound(client, orgId, "ghiTinHieuKhiDeXuat");
  const signalId = await ghiTinHieu(client, orgId, rfqId, "DE_XUAT", actor, "ESTIMATE_UNDERSTATED");
  if (signalId !== null) {
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "GOVERNANCE_SIGNAL_RECORDED",
      resourceType: "rfq_package",
      resourceId: rfqId,
      payload: { signalId, loai: "ESTIMATE_UNDERSTATED", nguon: "DE_XUAT" },
    });
  }
  return signalId;
}

/**
 * ⑵ Ghi nhận tín hiệu HIỆN TẠI của một gói đang chờ duyệt. Thứ tự: quyền (`rfq.approve`, lần từ chối vào sổ
 * `PERMISSION_DENIED`) → lý do → trạng thái và tín hiệu hiện tại → luật người (`K10A_TU_GHI_NHAN`, `K10A_TAC_GIA_CHINH_SACH`,
 * vào sổ `CONTROL_DENIED`) → tín hiệu có bằng chứng bằng hiện tại, không có thì lưu một cái mới → lần ghi nhận → sổ. Trigger
 * `governance_signal_acks_kiem_nguoi` kiểm lại mọi luật trên câu ghi.
 */
export async function ghiNhanTinHieu(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly lyDo: string; readonly actorSessionId: string; readonly loai?: LoaiTinHieu },
  auditPool: pg.Pool,
): Promise<KetQuaGhiNhan> {
  await assertTenantBound(client, orgId, "ghiNhanTinHieu");
  // [S1.285 / S3.6d] Hai loại, hai cạnh bị chặn: chia nhỏ — gói chờ duyệt, `rfq.approve`; khai thấp — gói có đề xuất, `po.approve`.
  const loai: LoaiTinHieu = input.loai ?? "PURCHASE_SPLITTING";
  const khaiThap = loai === "ESTIMATE_UNDERSTATED";
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: QUYEN_THEO_LOAI[loai], resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  const lyDo = input.lyDo.trim();
  if (lyDo === "") throw new KiemSoatError("Ghi lý do khi ghi nhận tín hiệu.");
  if (Buffer.byteLength(lyDo, "utf8") > 2000) throw new KiemSoatError("Lý do ghi nhận dài quá 2000 byte.");

  const goi = (await client.query<{ status: string; bang_chung: unknown; bang_chung_kt: unknown }>(CAU_DOC_GOI, [orgId, input.rfqId])).rows[0];
  if (goi === undefined) throw new KiemSoatError("Không tìm thấy gói thầu trong tổ chức đang gắn.");
  if (khaiThap) {
    if (goi.status !== "AWARDED") throw new KiemSoatError("Chỉ ghi nhận tín hiệu khai thấp khi gói thầu đang có đề xuất trao thầu.");
    if (goi.bang_chung_kt === null) throw new KiemSoatError("Gói thầu này không có tín hiệu khai thấp nào cần ghi nhận.");
  } else {
    if (goi.status !== "PENDING_APPROVAL") throw new KiemSoatError("Chỉ ghi nhận tín hiệu khi gói thầu đang chờ duyệt.");
    if (goi.bang_chung === null) throw new KiemSoatError("Gói thầu này không có tín hiệu nào cần ghi nhận.");
  }

  await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_NGUOI_GHI_NHAN, [orgId, input.rfqId, actor.id, loai]);

  let signalId = (await client.query<{ id: string }>(CAU_TIM_TIN_HIEU, [orgId, input.rfqId, loai])).rows[0]?.id ?? null;
  const tinHieuMoi = signalId === null;
  if (signalId === null) signalId = await ghiTinHieu(client, orgId, input.rfqId, "GHI_NHAN", actor, loai);
  if (signalId === null) throw new KiemSoatError("Gói thầu này không có tín hiệu nào cần ghi nhận.");

  let rows: readonly { id: string }[];
  try {
    ({ rows } = await client.query<{ id: string }>(CAU_GHI_NHAN, [orgId, signalId, lyDo, actor.id, actor.sessionId]));
  } catch (loi: unknown) {
    const { code, constraint } = (loi ?? {}) as { code?: unknown; constraint?: unknown };
    if (code === "23505") throw new KiemSoatError("Bạn đã ghi nhận tín hiệu này rồi.");
    if (code === "23514" && constraint === "k10_bang_chung_da_doi") {
      throw new KiemSoatError("Bằng chứng của tín hiệu vừa đổi — đọc lại rồi ghi nhận tín hiệu hiện tại.");
    }
    if (code === "23514" && constraint === "k10_ghi_nhan_sai_trang_thai") {
      throw new KiemSoatError(
        khaiThap ? "Chỉ ghi nhận tín hiệu khai thấp khi gói thầu đang có đề xuất trao thầu." : "Chỉ ghi nhận tín hiệu khi gói thầu đang chờ duyệt.",
      );
    }
    // [S1.281 / S3.4a / K9] Ghi nhận tín hiệu là một cổng K9 (ADR-082 ⒄): trigger `governance_signal_acks_kiem_xung_dot` (`114`)
    // từ chối có tên — một hàng `CONTROL_DENIED` ở giao dịch độc lập rồi lời từ chối của chốt (ADR-114).
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }
  const ackId = rows[0]?.id;
  if (ackId === undefined) throw new KiemSoatError("Câu ghi nhận không trả về hàng nào.");

  // Sổ SAU mọi lời từ chối có thể có: một câu ghi sổ giữ khoá chuỗi của tổ chức tới COMMIT.
  if (tinHieuMoi) {
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "GOVERNANCE_SIGNAL_RECORDED",
      resourceType: "rfq_package",
      resourceId: input.rfqId,
      payload: { signalId, loai, nguon: "GHI_NHAN" },
    });
  }
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "GOVERNANCE_SIGNAL_ACKNOWLEDGED",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    payload: { signalId, ackId, lyDo },
  });
  return { signalId, ackId, tinHieuMoi };
}

/** Id các gói mà một bằng chứng nhắc tới — bằng chứng do hàm SQL dựng, nên hình dạng lạ là một lỗi, không phải một ca. */
function goiCuaBangChung(bangChung: unknown): string[] {
  if (bangChung === null) return [];
  const goi = (bangChung as { goi?: unknown }).goi;
  if (!Array.isArray(goi) || !goi.every((g): g is string => typeof g === "string")) {
    throw new Error("bằng chứng tín hiệu không mang mảng id gói — hàm SQL và gói đã trôi khỏi nhau");
  }
  return goi;
}

/**
 * [S3.6b2] Người đang xem ghi nhận được tín hiệu hiện tại không, và bao nhiêu người trong tổ chức ghi nhận được. Cùng thứ tự với
 * `ghiNhanTinHieu`: quyền của cạnh bị chặn trước, luật người sau. Quyền đọc bằng `listUserIdsWithPermission` — một DANH SÁCH để màn
 * nói, như `GET /items` của `/du-lieu` (S1.199) — chứ không mở `hasPermission` ra mặt tiền: không lời từ chối nào xảy ra ở đây, nên
 * cũng không hàng sổ nào.
 */
async function nguoiGhiNhanDuoc(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  nguoiXemId: string,
  loai: LoaiTinHieu = "PURCHASE_SPLITTING",
): Promise<{ readonly nguoiXem: NguoiXemTinHieu; readonly soNguoiGhiNhanDuoc: number }> {
  const nguoiDuyet = await listUserIdsWithPermission(client, orgId, QUYEN_THEO_LOAI[loai]);
  const hoi = [...new Set([...nguoiDuyet, nguoiXemId])];
  const luat = new Map(
    (await client.query<{ id: string; ly_do: string | null }>(CAU_LUAT_NGUOI_NHIEU, [orgId, rfqId, hoi, loai])).rows.map((r) => [
      r.id,
      r.ly_do,
    ]),
  );
  const maCua = (id: string): string | null => {
    if (!luat.has(id)) throw new Error("luật người không trả hàng cho một người đã hỏi");
    return luat.get(id) ?? null;
  };
  const soNguoiGhiNhanDuoc = nguoiDuyet.filter((id) => maCua(id) === null).length;
  if (!nguoiDuyet.includes(nguoiXemId)) {
    return { nguoiXem: { ghiNhanDuoc: false, lyDo: loai === "ESTIMATE_UNDERSTATED" ? CAN_QUYEN_GHI_NHAN_KT : CAN_QUYEN_GHI_NHAN }, soNguoiGhiNhanDuoc };
  }
  const ma = maCua(nguoiXemId);
  if (ma === null) return { nguoiXem: { ghiNhanDuoc: true, lyDo: null }, soNguoiGhiNhanDuoc };
  if (!laMaChot(ma)) throw new Error("luật người trả một mã không có trong CHOT_VAO_SO — hai bên đã trôi khỏi nhau");
  return { nguoiXem: { ghiNhanDuoc: false, lyDo: CHOT_VAO_SO[ma].thongDiep }, soNguoiGhiNhanDuoc };
}

/**
 * ⑶ Tín hiệu của một gói: tín hiệu hiện tại, việc nó có cần ghi nhận không, mọi hàng đã ghi cùng các lần ghi nhận — và [S3.6b2]
 * thứ màn `/tao-thau` cần để người duyệt đọc được nó: tên và trạng thái các gói trong bằng chứng, họ tên người ghi, và người đang
 * xem (danh tính dẫn xuất từ phiên) ghi nhận được không. Chỉ đọc; không một số tiền nào.
 */
export async function lietKeTinHieu(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actorSessionId: string },
): Promise<TinHieuCuaGoi> {
  await assertTenantBound(client, orgId, "lietKeTinHieu");
  const nguoiXem = await resolveSessionActor(client, orgId, input.actorSessionId);
  const rfqId = input.rfqId;
  const goi = (
    await client.query<{ status: string; bang_chung: unknown; ly_do: string | null; bang_chung_kt: unknown; ly_do_kt: string | null }>(
      CAU_DOC_GOI,
      [orgId, rfqId],
    )
  ).rows[0];
  if (goi === undefined) throw new KiemSoatError("Không tìm thấy gói thầu trong tổ chức đang gắn.");
  const tinHieu = (
    await client.query<{
      id: string;
      loai: string;
      nguon: string;
      bang_chung: unknown;
      do_tin_cay: string;
      giai_thich: string;
      tinh_luc: Date;
      created_by: string;
      nguoi_ten: string | null;
    }>(CAU_DOC_TIN_HIEU, [orgId, rfqId])
  ).rows;
  const ghiNhan = (
    await client.query<{
      id: string;
      signal_id: string;
      ly_do: string;
      created_by: string;
      created_at: Date;
      nguoi_ten: string | null;
    }>(CAU_DOC_GHI_NHAN, [orgId, rfqId])
  ).rows;
  const idGoi = [...new Set([goi.bang_chung, goi.bang_chung_kt, ...tinHieu.map((t) => t.bang_chung)].flatMap(goiCuaBangChung))];
  const goiBangChung =
    idGoi.length === 0
      ? []
      : (await client.query<{ id: string; title: string; status: string }>(CAU_DOC_GOI_BANG_CHUNG, [orgId, idGoi])).rows;
  const canGhiNhan = goi.status === "PENDING_APPROVAL" && goi.ly_do !== null;
  const xem = canGhiNhan ? await nguoiGhiNhanDuoc(client, orgId, rfqId, nguoiXem.id) : null;
  // [S1.285 / S3.6d / K10b] Phần khai thấp: cùng khuôn, cạnh bị chặn là chữ ký trao thầu, quyền `po.approve`.
  const canGhiNhanKt = goi.status === "AWARDED" && goi.ly_do_kt !== null;
  const xemKt = canGhiNhanKt ? await nguoiGhiNhanDuoc(client, orgId, rfqId, nguoiXem.id, "ESTIMATE_UNDERSTATED") : null;
  return {
    hienTai: goi.bang_chung,
    canGhiNhan,
    khaiThap: {
      hienTai: goi.bang_chung_kt,
      canGhiNhan: canGhiNhanKt,
      nguoiXem: xemKt?.nguoiXem ?? { ghiNhanDuoc: false, lyDo: null },
      soNguoiGhiNhanDuoc: xemKt?.soNguoiGhiNhanDuoc ?? null,
    },
    tinHieu: tinHieu.map((t) => ({
      id: t.id,
      loai: t.loai,
      nguon: t.nguon,
      bangChung: t.bang_chung,
      doTinCay: t.do_tin_cay,
      giaiThich: t.giai_thich,
      tinhLuc: t.tinh_luc,
      nguoiGhi: t.created_by,
      nguoiGhiTen: t.nguoi_ten,
      ghiNhan: ghiNhan
        .filter((a) => a.signal_id === t.id)
        .map((a) => ({ id: a.id, lyDo: a.ly_do, nguoi: a.created_by, nguoiTen: a.nguoi_ten, luc: a.created_at })),
    })),
    goi: Object.fromEntries(goiBangChung.map((g) => [g.id, { tieuDe: g.title, trangThai: g.status }])),
    nguoiXem: xem?.nguoiXem ?? { ghiNhanDuoc: false, lyDo: null },
    soNguoiGhiNhanDuoc: xem?.soNguoiGhiNhanDuoc ?? null,
  };
}
