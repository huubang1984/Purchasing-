import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { RfqError } from "./rfq.js";

// =============================================================================================
// [S1.9101 / S3.6a] NHÓM HÀNG — DANH SÁCH CỦA TỔ CHỨC (spec S3 §4.3)
//
// Nhóm hàng là KHOÁ của tín hiệu chia nhỏ (K10, S3.6b): tín hiệu gộp các gói cùng nhóm trong cửa sổ. Chủ dự án chốt ngày
// 2026-09-29: nhóm hàng chỉ tạo, ngừng dùng và dùng lại — mã và tên không sửa. Hai bảng CHỈ GHI THÊM (`9501_nhom_hang`):
// `procurement_categories` giữ mã và tên; `procurement_category_changes` giữ mỗi lần ngừng dùng hay dùng lại, và trạng thái là
// hàng mới nhất — câu hỏi DUY NHẤT về nó là hàm SQL `nhom_hang_con_dung`.
//
// Ba lớp, thứ tự như mọi hàm ghi của kho:
//   ⑴ `requirePermission(category.manage)` — thiếu quyền là `PERMISSION_DENIED` (D5), trước mọi câu ghi;
//   ⑵ trigger — lớp có THẨM QUYỀN: người ghi giữ `category.manage`, lần đổi trạng thái đi đúng chiều, thứ tự dưới khoá;
//   ⑶ hai nhánh chiều đổi của trigger mang TÊN RÀNG BUỘC — hàm dưới đổi chúng thành lời có tên. Chúng không phải chốt kiểm
//      soát (K12): ngừng dùng một nhóm đã ngừng là thao tác thừa, không phải một lần cố đi tắt — không vào sổ (ADR-060).
// =============================================================================================

export interface NhomHang {
  readonly id: string;
  readonly ma: string;
  readonly ten: string;
  /** `nhom_hang_con_dung`: hàng đổi mới nhất không phải `RETIRED`. Chỉ nhóm còn dùng mới gán được cho gói. */
  readonly conDung: boolean;
  readonly createdAt: Date;
}

interface HangNhomHang {
  id: string;
  ma: string;
  ten: string;
  con_dung: boolean;
  created_at: Date;
}

/** Mã là một định danh, không phải tên — cùng khuôn với `CHECK` của `9501_nhom_hang`. */
const MA_NHOM_HANG = /^[A-Z0-9][A-Z0-9_.-]{0,31}$/u;

/** Tài nguyên của lời từ chối quyền trong sổ. */
const TAI_NGUYEN = "PROCUREMENT_CATEGORY";

const COT =
  "c.id, c.ma, c.ten, public.nhom_hang_con_dung(c.org_id, c.id) AS con_dung, c.created_at";

function doi(h: HangNhomHang): NhomHang {
  return { id: h.id, ma: h.ma, ten: h.ten, conDung: h.con_dung, createdAt: h.created_at };
}

/**
 * Tạo một nhóm hàng. Mã viết HOA trước khi chèn — người khai gõ `thep` hay `THEP` là cùng một mã; trùng mã trong tổ chức là
 * lời từ chối có tên. Người gọi giữ `category.manage`; trigger đòi lại cùng mã ở người ghi.
 */
export async function taoNhomHang(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly ma: string; readonly ten: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<NhomHang> {
  await assertTenantBound(client, orgId, "taoNhomHang");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.CATEGORY_MANAGE, resourceType: TAI_NGUYEN },
    auditPool,
  );
  const ma = input.ma.trim().toUpperCase();
  if (!MA_NHOM_HANG.test(ma)) {
    throw new RfqError("Mã nhóm hàng gồm chữ, số và _ . -, bắt đầu bằng chữ hoặc số, tối đa 32 ký tự.");
  }
  const ten = input.ten.trim();
  if (ten === "") throw new RfqError("Tên nhóm hàng không được rỗng.");
  if (Buffer.byteLength(ten, "utf8") > 200) throw new RfqError("Tên nhóm hàng dài quá 200 byte.");

  const { rows } = await client
    .query<{ id: string; created_at: Date }>(
      `INSERT INTO public.procurement_categories (org_id, ma, ten, created_by, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [orgId, ma, ten, actor.id, actor.sessionId],
    )
    .catch((loi: unknown) => {
      const { code } = (loi ?? {}) as { code?: unknown };
      if (code === "23505") throw new RfqError("Mã nhóm hàng này đã có trong tổ chức.");
      throw loi;
    });
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("Câu INSERT nhóm hàng không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "CATEGORY_CREATED",
    resourceType: "procurement_category",
    resourceId: hang.id,
    payload: { ma },
  });
  return { id: hang.id, ma, ten, conDung: true, createdAt: hang.created_at };
}

/** Mọi nhóm hàng của tổ chức đang gắn, xếp theo mã — kể cả nhóm đã ngừng dùng, để màn nói được vì sao một nhóm không chọn được. */
export async function lietKeNhomHang(client: pg.PoolClient, orgId: string): Promise<readonly NhomHang[]> {
  await assertTenantBound(client, orgId, "lietKeNhomHang");
  const { rows } = await client.query<HangNhomHang>(
    `SELECT ${COT} FROM public.procurement_categories c ORDER BY c.ma`,
  );
  return rows.map(doi);
}

/**
 * Ngừng dùng (`conDung: false`) hay dùng lại (`true`) một nhóm hàng. Một hàng đổi MỚI, không sửa hàng nào. Gói đang giữ nhóm
 * ấy KHÔNG đổi và vẫn nộp duyệt được — ngừng dùng chỉ chặn lần GÁN mới (chủ dự án chốt ngày 2026-09-29).
 */
export async function doiTrangThaiNhomHang(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly categoryId: string; readonly conDung: boolean; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<NhomHang> {
  await assertTenantBound(client, orgId, "doiTrangThaiNhomHang");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.CATEGORY_MANAGE, resourceType: TAI_NGUYEN, resourceId: input.categoryId },
    auditPool,
  );
  await client
    .query(
      `INSERT INTO public.procurement_category_changes (org_id, category_id, loai, created_by, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, input.categoryId, input.conDung ? "REACTIVATED" : "RETIRED", actor.id, actor.sessionId],
    )
    .catch((loi: unknown) => {
      const { code, constraint } = (loi ?? {}) as { code?: unknown; constraint?: unknown };
      if (code === "23514" && constraint === "nhom_hang_ngung_dung_hai_lan") {
        throw new RfqError("Nhóm hàng này đã ngừng dùng rồi.");
      }
      if (code === "23514" && constraint === "nhom_hang_dung_lai_khi_dang_dung") {
        throw new RfqError("Nhóm hàng này đang dùng — không có gì để dùng lại.");
      }
      if (code === "23503") throw new RfqError("Không tìm thấy nhóm hàng trong tổ chức đang gắn.");
      throw loi;
    });

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: input.conDung ? "CATEGORY_REACTIVATED" : "CATEGORY_RETIRED",
    resourceType: "procurement_category",
    resourceId: input.categoryId,
  });
  const { rows } = await client.query<HangNhomHang>(
    `SELECT ${COT} FROM public.procurement_categories c WHERE c.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid`,
    [input.categoryId],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("Không tìm thấy nhóm hàng trong tổ chức đang gắn.");
  return doi(hang);
}
