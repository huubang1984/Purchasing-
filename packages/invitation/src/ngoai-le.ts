import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, maChotTuLoi, requirePermission, resolveSessionActor, tuChoiTheoChot } from "@trustprocure/identity";
import { InvitationError } from "./invitation.js";

// =============================================================================================
// [S1.9101 / S3.3b · spec S3 §4.4 · K4a] NGOẠI LỆ CẠNH TRANH
//
// Một ngoại lệ là LỜI GIẢI TRÌNH vì sao danh sách mời không đủ cạnh tranh — một nhà cung cấp (`SINGLE_SOURCE`), ít hơn ngưỡng
// (`LIMITED_COMPETITION`), hay không thoả luân phiên (`ROTATION`). Nó là một phần của danh sách mời: nằm trong băm mà người
// duyệt ký (`rfq_bam_danh_sach`, `9501`), nên người duyệt ký lên cả lời giải trình. Quyền lập là `rfq.invite` (ADR-084 ⑵) — chốt
// không phải quyền lập mà là chữ ký độc lập; S3.3c nối K2 và K5 vào đây.
//
// Ba lớp, thứ tự như mọi hàm ghi của kho:
//   ⑴ `requirePermission(rfq.invite)` — thiếu quyền là `PERMISSION_DENIED` (D5), trước mọi câu ghi;
//   ⑵ hình dạng ở đây trước (mã, độ dài, sàn `OTHER`) để người dùng nhận lời có tên thay vì lỗi CHECK — CSDL vẫn là lớp chặn;
//   ⑶ trigger `ngoai_le_kiem` — lớp có THẨM QUYỀN: tổ chức đã bật S3, người ghi giữ `rfq.invite`, gói ở DRAFT. Nhánh DRAFT mang
//      TÊN RÀNG BUỘC `k4a_ngoai_le_sai_trang_thai`: hàm này bắt chính lỗi ấy và ghi `CONTROL_DENIED` ở giao dịch độc lập (K12).
//
// Chỉ ghi thêm: rút một ngoại lệ là một hàng `RUT` trỏ về nó, kèm lý do; không hàng nào bị sửa.
// =============================================================================================

/** Ba loại của danh sách mời — đường ghi của S3.3b. Hai loại còn lại của CHECK (`9501`) thuộc trao thầu (S3.5) và OPEN (S3.6). */
export const LOAI_NGOAI_LE = ["SINGLE_SOURCE", "LIMITED_COMPETITION", "ROTATION"] as const;
export type LoaiNgoaiLe = (typeof LOAI_NGOAI_LE)[number];

/** Tập ĐÓNG của mã lý do (spec §4.4, V2.1 §12 11.2). */
export const MA_LY_DO_NGOAI_LE = [
  "PROPRIETARY_TECHNOLOGY",
  "EXISTING_CONTRACT",
  "EMERGENCY",
  "NO_ALTERNATIVE",
  "COMPATIBILITY",
  "REGULATORY",
  "OTHER",
] as const;
export type MaLyDoNgoaiLe = (typeof MA_LY_DO_NGOAI_LE)[number];

/** Trần giải trình và lý do rút, tính bằng BYTE UTF-8 — cùng số với CHECK của `9501`. */
export const TRAN_GIAI_TRINH_BYTE = 2000;
/** Sàn giải trình của mã `OTHER`, BYTE UTF-8 sau khi cắt khoảng trắng — chủ dự án chốt 2026-09-29. */
export const SAN_GIAI_TRINH_OTHER_BYTE = 100;

export interface NgoaiLeCanhTranh {
  readonly id: string;
  readonly rfqId: string;
  readonly loai: LoaiNgoaiLe;
  readonly maLyDo: MaLyDoNgoaiLe;
  readonly giaiTrinh: string;
  readonly lapBoi: string;
  readonly lapLuc: Date;
  /** `null` khi ngoại lệ còn sống. */
  readonly rut: { readonly boi: string; readonly luc: Date; readonly lyDo: string } | null;
}

interface HangNgoaiLe {
  id: string;
  rfq_id: string;
  loai: LoaiNgoaiLe;
  ma_ly_do: MaLyDoNgoaiLe;
  giai_trinh: string;
  created_by: string;
  created_at: Date;
  rut_boi: string | null;
  rut_luc: Date | null;
  rut_ly_do: string | null;
}

function doByte(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function chuoiCatBatBuoc(giaTri: string, ten: string): string {
  const t = giaTri.trim();
  if (t === "") throw new InvitationError(`Cần ${ten}.`);
  if (doByte(t) > TRAN_GIAI_TRINH_BYTE) throw new InvitationError(`${ten} dài quá ${String(TRAN_GIAI_TRINH_BYTE)} byte.`);
  return t;
}

async function ghi(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly rfqId: string;
    readonly actorSessionId: string;
    readonly hanhDong: "LAP" | "RUT";
    readonly ngoaiLeId: string | null;
    readonly loai: LoaiNgoaiLe | null;
    readonly maLyDo: MaLyDoNgoaiLe | null;
    readonly giaiTrinh: string;
  },
  auditPool: pg.Pool,
): Promise<string> {
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.RFQ_INVITE, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  let id: string | undefined;
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO public.rfq_sourcing_exceptions
         (org_id, rfq_id, hanh_dong, ngoai_le_id, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [orgId, input.rfqId, input.hanhDong, input.ngoaiLeId, input.loai, input.maLyDo, input.giaiTrinh, actor.id, actor.sessionId],
    );
    id = rows[0]?.id;
  } catch (loi) {
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }
  if (id === undefined) throw new InvitationError("Câu INSERT ngoại lệ không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: input.hanhDong === "LAP" ? "SOURCING_EXCEPTION_CREATED" : "SOURCING_EXCEPTION_WITHDRAWN",
    resourceType: "RFQ",
    resourceId: input.rfqId,
    // Loại và mã lý do vào sổ; giải trình nằm ở bảng và trong băm danh sách mà người duyệt ký. Lý do rút vào sổ như lý do trả gói
    // về soạn thảo (`077`).
    payload:
      input.hanhDong === "LAP"
        ? { exceptionId: id, loai: input.loai, maLyDo: input.maLyDo }
        : { exceptionId: input.ngoaiLeId, reason: input.giaiTrinh },
  });
  return id;
}

/**
 * Lập một ngoại lệ cạnh tranh cho gói ở DRAFT. Mã `OTHER` đòi giải trình ít nhất 100 byte sau khi cắt khoảng trắng.
 */
export async function lapNgoaiLe(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly rfqId: string;
    readonly loai: string;
    readonly maLyDo: string;
    readonly giaiTrinh: string;
    readonly actorSessionId: string;
  },
  auditPool: pg.Pool,
): Promise<NgoaiLeCanhTranh> {
  await assertTenantBound(client, orgId, "lapNgoaiLe");
  if (!(LOAI_NGOAI_LE as readonly string[]).includes(input.loai)) {
    throw new InvitationError(`Loại ngoại lệ phải là một trong: ${LOAI_NGOAI_LE.join(", ")}.`);
  }
  if (!(MA_LY_DO_NGOAI_LE as readonly string[]).includes(input.maLyDo)) {
    throw new InvitationError(`Mã lý do phải là một trong: ${MA_LY_DO_NGOAI_LE.join(", ")}.`);
  }
  const giaiTrinh = chuoiCatBatBuoc(input.giaiTrinh, "Giải trình");
  if (input.maLyDo === "OTHER" && doByte(giaiTrinh) < SAN_GIAI_TRINH_OTHER_BYTE) {
    throw new InvitationError(
      `Mã lý do OTHER cần giải trình ít nhất ${String(SAN_GIAI_TRINH_OTHER_BYTE)} byte — nói rõ vì sao không mã nào khác đúng.`,
    );
  }
  const id = await ghi(
    client,
    orgId,
    {
      rfqId: input.rfqId,
      actorSessionId: input.actorSessionId,
      hanhDong: "LAP",
      ngoaiLeId: null,
      loai: input.loai as LoaiNgoaiLe,
      maLyDo: input.maLyDo as MaLyDoNgoaiLe,
      giaiTrinh,
    },
    auditPool,
  );
  const ngoaiLe = (await docNgoaiLe(client, orgId, input.rfqId)).find((n) => n.id === id);
  if (ngoaiLe === undefined) throw new InvitationError("Không đọc lại được ngoại lệ vừa lập.");
  return ngoaiLe;
}

/** Rút một ngoại lệ còn sống của gói ở DRAFT — lý do bắt buộc. */
export async function rutNgoaiLe(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly exceptionId: string; readonly reason: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<NgoaiLeCanhTranh> {
  await assertTenantBound(client, orgId, "rutNgoaiLe");
  const lyDo = chuoiCatBatBuoc(input.reason, "Lý do rút ngoại lệ");
  await ghi(
    client,
    orgId,
    {
      rfqId: input.rfqId,
      actorSessionId: input.actorSessionId,
      hanhDong: "RUT",
      ngoaiLeId: input.exceptionId,
      loai: null,
      maLyDo: null,
      giaiTrinh: lyDo,
    },
    auditPool,
  );
  const ngoaiLe = (await docNgoaiLe(client, orgId, input.rfqId)).find((n) => n.id === input.exceptionId);
  if (ngoaiLe === undefined) throw new InvitationError("Không đọc lại được ngoại lệ vừa rút.");
  return ngoaiLe;
}

/** Mọi ngoại lệ đã lập của một gói trong tổ chức đang gắn, kèm lần rút nếu có — cũ trước. */
export async function docNgoaiLe(client: pg.PoolClient, orgId: string, rfqId: string): Promise<NgoaiLeCanhTranh[]> {
  await assertTenantBound(client, orgId, "docNgoaiLe");
  const { rows } = await client.query<HangNgoaiLe>(
    `SELECT e.id, e.rfq_id, e.loai, e.ma_ly_do, e.giai_trinh, e.created_by, e.created_at,
            r.created_by AS rut_boi, r.created_at AS rut_luc, r.giai_trinh AS rut_ly_do
       FROM public.rfq_sourcing_exceptions e
       LEFT JOIN public.rfq_sourcing_exceptions r
              ON r.org_id OPERATOR(pg_catalog.=) e.org_id AND r.ngoai_le_id OPERATOR(pg_catalog.=) e.id
      WHERE e.rfq_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND e.hanh_dong OPERATOR(pg_catalog.=) 'LAP'
      ORDER BY e.created_at, e.id`,
    [rfqId],
  );
  return rows.map((h) => ({
    id: h.id,
    rfqId: h.rfq_id,
    loai: h.loai,
    maLyDo: h.ma_ly_do,
    giaiTrinh: h.giai_trinh,
    lapBoi: h.created_by,
    lapLuc: h.created_at,
    rut: h.rut_boi === null || h.rut_luc === null || h.rut_ly_do === null ? null : { boi: h.rut_boi, luc: h.rut_luc, lyDo: h.rut_ly_do },
  }));
}
