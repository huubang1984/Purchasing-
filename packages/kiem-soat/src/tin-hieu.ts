import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type ActorType } from "@trustprocure/audit";
import { PERMISSIONS, laMaChot, requirePermission, resolveSessionActor, tuChoiTheoChot } from "@trustprocure/identity";

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
  readonly ghiNhan: readonly GhiNhanTinHieu[];
}

export interface TinHieuCuaGoi {
  /** Tín hiệu tính NGAY LÚC ĐỌC — `null` khi gói không có tín hiệu nào. */
  readonly hienTai: unknown;
  /** Gói đang chờ duyệt và tín hiệu hiện tại chưa có lần ghi nhận nào trên một tín hiệu có bằng chứng bằng nó. */
  readonly canGhiNhan: boolean;
  readonly tinHieu: readonly TinHieu[];
}

export interface KetQuaGhiNhan {
  readonly signalId: string;
  readonly ackId: string;
  /** Lần ghi nhận này đã phải lưu một tín hiệu mới, vì bằng chứng đã đổi sau lần nộp. */
  readonly tinHieuMoi: boolean;
}

const CAU_GHI_TIN_HIEU =
  "INSERT INTO public.governance_signals (org_id, rfq_id, loai, nguon, created_by, created_by_session_id) " +
  "SELECT $1::pg_catalog.uuid, $2::pg_catalog.uuid, 'PURCHASE_SPLITTING', $3::pg_catalog.text, $4::pg_catalog.uuid, $5::pg_catalog.uuid " +
  "WHERE public.tin_hieu_chia_nho($1::pg_catalog.uuid, $2::pg_catalog.uuid) IS NOT NULL RETURNING id";

const CAU_DOC_GOI =
  "SELECT r.status, public.tin_hieu_chia_nho(r.org_id, r.id) AS bang_chung, public.rfq_chot_tin_hieu(r.org_id, r.id) AS ly_do " +
  "FROM public.rfq_packages r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid";

/** Luật người ghi nhận trên tín hiệu HIỆN TẠI của gói — `$1` tổ chức, `$2` gói, `$3` người. */
const CAU_CHOT_NGUOI_GHI_NHAN =
  "SELECT public.tin_hieu_chot_nguoi_ghi_nhan($1::pg_catalog.uuid, " +
  "public.tin_hieu_chia_nho($1::pg_catalog.uuid, $2::pg_catalog.uuid), $3::pg_catalog.uuid) AS ly_do";

const CAU_TIM_TIN_HIEU =
  "SELECT s.id FROM public.governance_signals s " +
  "WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "AND s.bang_chung OPERATOR(pg_catalog.=) public.tin_hieu_chia_nho($1::pg_catalog.uuid, $2::pg_catalog.uuid) " +
  "ORDER BY s.tinh_luc DESC LIMIT 1";

const CAU_GHI_NHAN =
  "INSERT INTO public.governance_signal_acks (org_id, signal_id, ly_do, created_by, created_by_session_id) " +
  "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text, $4::pg_catalog.uuid, $5::pg_catalog.uuid) RETURNING id";

const CAU_DOC_TIN_HIEU =
  "SELECT s.id, s.loai, s.nguon, s.bang_chung, s.do_tin_cay, s.giai_thich, s.tinh_luc, s.created_by " +
  "FROM public.governance_signals s " +
  "WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "ORDER BY s.tinh_luc, s.id";

const CAU_DOC_GHI_NHAN =
  "SELECT a.id, a.signal_id, a.ly_do, a.created_by, a.created_at FROM public.governance_signal_acks a " +
  "JOIN public.governance_signals s ON s.org_id OPERATOR(pg_catalog.=) a.org_id AND s.id OPERATOR(pg_catalog.=) a.signal_id " +
  "WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "ORDER BY a.created_at, a.id";

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
  nguon: "NOP_DUYET" | "GHI_NHAN",
  actor: NguoiGoi,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(CAU_GHI_TIN_HIEU, [orgId, rfqId, nguon, actor.id, actor.sessionId]);
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
  const signalId = await ghiTinHieu(client, orgId, rfqId, "NOP_DUYET", actor);
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
 * ⑵ Ghi nhận tín hiệu HIỆN TẠI của một gói đang chờ duyệt. Thứ tự: quyền (`rfq.approve`, lần từ chối vào sổ
 * `PERMISSION_DENIED`) → lý do → trạng thái và tín hiệu hiện tại → luật người (`K10A_TU_GHI_NHAN`, `K10A_TAC_GIA_CHINH_SACH`,
 * vào sổ `CONTROL_DENIED`) → tín hiệu có bằng chứng bằng hiện tại, không có thì lưu một cái mới → lần ghi nhận → sổ. Trigger
 * `governance_signal_acks_kiem_nguoi` kiểm lại mọi luật trên câu ghi.
 */
export async function ghiNhanTinHieu(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly lyDo: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<KetQuaGhiNhan> {
  await assertTenantBound(client, orgId, "ghiNhanTinHieu");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.RFQ_APPROVE, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  const lyDo = input.lyDo.trim();
  if (lyDo === "") throw new KiemSoatError("Ghi lý do khi ghi nhận tín hiệu.");
  if (Buffer.byteLength(lyDo, "utf8") > 2000) throw new KiemSoatError("Lý do ghi nhận dài quá 2000 byte.");

  const goi = (await client.query<{ status: string; bang_chung: unknown }>(CAU_DOC_GOI, [orgId, input.rfqId])).rows[0];
  if (goi === undefined) throw new KiemSoatError("Không tìm thấy gói thầu trong tổ chức đang gắn.");
  if (goi.status !== "PENDING_APPROVAL") throw new KiemSoatError("Chỉ ghi nhận tín hiệu khi gói thầu đang chờ duyệt.");
  if (goi.bang_chung === null) throw new KiemSoatError("Gói thầu này không có tín hiệu nào cần ghi nhận.");

  await hoiChot(client, auditPool, orgId, actor, input.rfqId, CAU_CHOT_NGUOI_GHI_NHAN, [orgId, input.rfqId, actor.id]);

  let signalId = (await client.query<{ id: string }>(CAU_TIM_TIN_HIEU, [orgId, input.rfqId])).rows[0]?.id ?? null;
  const tinHieuMoi = signalId === null;
  if (signalId === null) signalId = await ghiTinHieu(client, orgId, input.rfqId, "GHI_NHAN", actor);
  if (signalId === null) throw new KiemSoatError("Gói thầu này không có tín hiệu nào cần ghi nhận.");

  const { rows } = await client
    .query<{ id: string }>(CAU_GHI_NHAN, [orgId, signalId, lyDo, actor.id, actor.sessionId])
    .catch((loi: unknown) => {
      const { code, constraint } = (loi ?? {}) as { code?: unknown; constraint?: unknown };
      if (code === "23505") throw new KiemSoatError("Bạn đã ghi nhận tín hiệu này rồi.");
      if (code === "23514" && constraint === "k10_bang_chung_da_doi") {
        throw new KiemSoatError("Bằng chứng của tín hiệu vừa đổi — đọc lại rồi ghi nhận tín hiệu hiện tại.");
      }
      if (code === "23514" && constraint === "k10_ghi_nhan_sai_trang_thai") {
        throw new KiemSoatError("Chỉ ghi nhận tín hiệu khi gói thầu đang chờ duyệt.");
      }
      throw loi;
    });
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
      payload: { signalId, loai: "PURCHASE_SPLITTING", nguon: "GHI_NHAN" },
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

/** ⑶ Tín hiệu của một gói: tín hiệu hiện tại, việc nó có cần ghi nhận không, và mọi hàng đã ghi cùng các lần ghi nhận. */
export async function lietKeTinHieu(client: pg.PoolClient, orgId: string, rfqId: string): Promise<TinHieuCuaGoi> {
  await assertTenantBound(client, orgId, "lietKeTinHieu");
  const goi = (await client.query<{ status: string; bang_chung: unknown; ly_do: string | null }>(CAU_DOC_GOI, [orgId, rfqId]))
    .rows[0];
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
    }>(CAU_DOC_TIN_HIEU, [orgId, rfqId])
  ).rows;
  const ghiNhan = (
    await client.query<{ id: string; signal_id: string; ly_do: string; created_by: string; created_at: Date }>(CAU_DOC_GHI_NHAN, [
      orgId,
      rfqId,
    ])
  ).rows;
  return {
    hienTai: goi.bang_chung,
    canGhiNhan: goi.status === "PENDING_APPROVAL" && goi.ly_do !== null,
    tinHieu: tinHieu.map((t) => ({
      id: t.id,
      loai: t.loai,
      nguon: t.nguon,
      bangChung: t.bang_chung,
      doTinCay: t.do_tin_cay,
      giaiThich: t.giai_thich,
      tinhLuc: t.tinh_luc,
      nguoiGhi: t.created_by,
      ghiNhan: ghiNhan
        .filter((a) => a.signal_id === t.id)
        .map((a) => ({ id: a.id, lyDo: a.ly_do, nguoi: a.created_by, luc: a.created_at })),
    })),
  };
}
