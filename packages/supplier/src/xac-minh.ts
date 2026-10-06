import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, maChotTuLoi, requirePermission, resolveSessionActor, tuChoiTheoChotTaiNguyen } from "@trustprocure/identity";
import { SupplierError } from "./suppliers.js";

// =============================================================================================
// [S1.196 / S3.3a / K8a · ADR-081 ⑵] XÁC MINH NỘI BỘ NHÀ CUNG CẤP
//
// Cấp đầu của hai cấp ở ADR-081 ⑵: bên mua xác nhận MST, tên pháp lý và đích liên hệ của một hồ sơ; nhà cung cấp không làm
// gì. K2 (S3.3c) chỉ đếm nhà cung cấp có xác minh CÒN HIỆU LỰC — câu hỏi ấy là hàm SQL `ncc_xac_minh_con_hieu_luc` (`082`),
// một phép tính, một chỗ ở; gói này chỉ ghi và đọc.
//
// Ba lớp, thứ tự như mọi hàm ghi của kho:
//   ⑴ `requirePermission(supplier.qualify)` — thiếu quyền là `PERMISSION_DENIED` (D5), trước mọi câu ghi;
//   ⑵ trigger `ncc_kiem_xac_minh` — lớp có THẨM QUYỀN: người xác minh khác người tạo hồ sơ và người liên hệ, không giữ
//      `rfq.invite`, hồ sơ có MST và đang ACTIVE, tổ chức đã bật S3, thứ tự dưới khoá tư vấn, băm hồ sơ và hạn hiệu lực;
//   ⑶ hai nhánh luật người của trigger mang TÊN RÀNG BUỘC — hàm này bắt chính lỗi ấy và ghi `CONTROL_DENIED` ở giao dịch
//      độc lập (K12, ADR-084 ⑷) rồi ném lời từ chối có tên. Nhánh khác của trigger (chưa bật S3, không MST, chưa xác minh mà
//      thu hồi) nói cấu hình hay dữ liệu chưa sẵn sàng, không nói người dùng đi tắt — không vào sổ (ADR-060).
// =============================================================================================

/** Trạng thái xác minh của một nhà cung cấp — hàng MỚI NHẤT theo `thu_tu`, cộng câu trả lời của hàm hiệu lực. */
export interface XacMinhNhaCungCap {
  readonly supplierId: string;
  /** `null` khi chưa từng có hàng nào. */
  readonly loai: "VERIFIED" | "REVOKED" | null;
  /** `ncc_xac_minh_con_hieu_luc`: hàng mới nhất là `VERIFIED`, chưa hết hạn, và hồ sơ chưa đổi từ lúc xác minh. */
  readonly conHieuLuc: boolean;
  readonly hetHanAt: Date | null;
  readonly boi: string | null;
  readonly luc: Date | null;
  readonly lyDo: string | null;
}

interface HangXacMinh {
  loai: "VERIFIED" | "REVOKED" | null;
  con_hieu_luc: boolean;
  het_han_at: Date | null;
  created_by: string | null;
  created_at: Date | null;
  ly_do: string | null;
}

/** Tài nguyên của lời từ chối K8a trong sổ: chính nhà cung cấp bị xác minh. */
const TAI_NGUYEN = "SUPPLIER";

async function ghi(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly actorSessionId: string; readonly loai: "VERIFIED" | "REVOKED"; readonly lyDo: string | null },
  auditPool: pg.Pool,
): Promise<{ id: string; thu_tu: string; het_han_at: Date | null; bam_ho_so: string | null }> {
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.SUPPLIER_QUALIFY, resourceType: TAI_NGUYEN, resourceId: input.supplierId },
    auditPool,
  );
  // Lời từ chối của trigger huỷ giao dịch; hai nhánh luật người mang tên ràng buộc thì ghi `CONTROL_DENIED` ở giao dịch độc lập
  // rồi ném lời từ chối có tên — khuôn `approveRfq` (`packages/rfq`, ADR-108). Nhánh không tên đi thẳng.
  let hang: { id: string; thu_tu: string; het_han_at: Date | null; bam_ho_so: string | null } | undefined;
  try {
    const { rows } = await client.query<{ id: string; thu_tu: string; het_han_at: Date | null; bam_ho_so: string | null }>(
      `INSERT INTO public.supplier_verifications (org_id, supplier_id, loai, ly_do, created_by, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, thu_tu::pg_catalog.text AS thu_tu, het_han_at, pg_catalog.encode(bam_ho_so, 'hex') AS bam_ho_so`,
      [orgId, input.supplierId, input.loai, input.lyDo, actor.id, actor.sessionId],
    );
    hang = rows[0];
  } catch (loi) {
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChotTaiNguyen(auditPool, orgId, actor, { resourceType: TAI_NGUYEN, resourceId: input.supplierId }, ma, loi);
    throw loi;
  }
  if (hang === undefined) throw new SupplierError("Câu INSERT xác minh không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: input.loai === "VERIFIED" ? "SUPPLIER_VERIFIED" : "SUPPLIER_VERIFICATION_REVOKED",
    resourceType: "supplier",
    resourceId: input.supplierId,
    // Thứ tự của hàng — không MST, không tên, không đích liên hệ: sổ nói AI xác nhận KHI NÀO, hồ sơ nằm ở bảng nhà cung cấp.
    // Lý do thu hồi vào sổ như lý do trả gói về soạn thảo (`077`).
    payload: input.loai === "VERIFIED" ? { thuTu: hang.thu_tu } : { thuTu: hang.thu_tu, reason: input.lyDo },
  });
  return hang;
}

/**
 * Xác minh một nhà cung cấp. Người gọi giữ `supplier.qualify`; trigger đòi thêm: không giữ `rfq.invite`, không tạo hồ sơ hay
 * người liên hệ nào của nó, hồ sơ có MST và ACTIVE, tổ chức đã bật S3. Hạn hiệu lực = lúc ghi + `tham_dinh_hieu_luc_thang` của
 * phiên bản chính sách hiệu lực (chủ dự án chốt 2026-09-29). Xác minh lại một nhà cung cấp đã xác minh là một hàng MỚI — gia hạn.
 */
export async function xacMinhNhaCungCap(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly actorSessionId: string; readonly bamDaXem: string },
  auditPool: pg.Pool,
): Promise<XacMinhNhaCungCap> {
  await assertTenantBound(client, orgId, "xacMinhNhaCungCap");
  const bamDaXem = input.bamDaXem.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(bamDaXem)) throw new SupplierError("Thiếu băm hồ sơ đã xem — đọc lại hồ sơ nhà cung cấp rồi xác minh.");
  const hang = await ghi(
    client,
    orgId,
    { supplierId: input.supplierId, actorSessionId: input.actorSessionId, loai: "VERIFIED", lyDo: null },
    auditPool,
  );
  // [S1.273 / S3.3e1 — lượt soi CAO-2] Lần xác minh rơi lên ĐÚNG hồ sơ người xác minh đã thấy: băm do trigger tính lúc chèn (`082`)
  // khác băm màn đã hiện ⇒ hồ sơ (tên, MST, trạng thái, hay một người liên hệ) đã đổi giữa lúc xem và lúc bấm. Ném — giao dịch của
  // lời gọi rollback, không hàng xác minh nào ở lại.
  if (hang.bam_ho_so !== bamDaXem) {
    throw new SupplierError("Hồ sơ nhà cung cấp đã đổi từ lúc bạn xem (tên, mã số thuế hay người liên hệ) — đọc lại rồi xác minh.");
  }
  return await docXacMinhNhaCungCap(client, orgId, input.supplierId);
}

/** Thu hồi xác minh — lý do bắt buộc, trần 2000 byte (CHECK ở `082`). Chỉ thu hồi được khi hàng mới nhất là `VERIFIED`. */
export async function thuHoiXacMinhNhaCungCap(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly reason: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<XacMinhNhaCungCap> {
  await assertTenantBound(client, orgId, "thuHoiXacMinhNhaCungCap");
  const lyDo = input.reason.trim();
  if (lyDo === "") throw new SupplierError("Cần lý do thu hồi xác minh.");
  if (Buffer.byteLength(lyDo, "utf8") > 2000) throw new SupplierError("Lý do thu hồi dài quá 2000 byte.");
  await ghi(client, orgId, { supplierId: input.supplierId, actorSessionId: input.actorSessionId, loai: "REVOKED", lyDo }, auditPool);
  return await docXacMinhNhaCungCap(client, orgId, input.supplierId);
}

/** Trạng thái xác minh hiện tại của một nhà cung cấp trong tổ chức đang gắn. Không đọc được nhà cung cấp ⇒ ném. */
export async function docXacMinhNhaCungCap(client: pg.PoolClient, orgId: string, supplierId: string): Promise<XacMinhNhaCungCap> {
  await assertTenantBound(client, orgId, "docXacMinhNhaCungCap");
  const { rows } = await client.query<HangXacMinh>(
    `SELECT v.loai, public.ncc_xac_minh_con_hieu_luc(s.org_id, s.id) AS con_hieu_luc,
            v.het_han_at, v.created_by, v.created_at, v.ly_do
       FROM public.suppliers s
       LEFT JOIN LATERAL (
         SELECT x.loai, x.het_han_at, x.created_by, x.created_at, x.ly_do
           FROM public.supplier_verifications x
          WHERE x.org_id OPERATOR(pg_catalog.=) s.org_id AND x.supplier_id OPERATOR(pg_catalog.=) s.id
          ORDER BY x.thu_tu DESC
          LIMIT 1) v ON true
      WHERE s.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid`,
    [supplierId],
  );
  const h = rows[0];
  if (h === undefined) throw new SupplierError("Không tìm thấy nhà cung cấp trong tổ chức đang gắn.");
  return {
    supplierId,
    loai: h.loai,
    conHieuLuc: h.con_hieu_luc,
    hetHanAt: h.het_han_at,
    boi: h.created_by,
    luc: h.created_at,
    lyDo: h.ly_do,
  };
}

/** [S1.273 / S3.3e1] Một người liên hệ trên màn xác minh — đủ để người xác minh thấy link mời sẽ đi tới ai, và ai đã thêm nó. */
export interface NguoiLienHeXacMinh {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly themBoi: string | null;
  readonly themBoiTen: string | null;
}

/** [S1.273 / S3.3e1] Hồ sơ một nhà cung cấp trên màn xác minh: trạng thái, băm hồ sơ hiện tại, và mọi người liên hệ. */
export interface HoSoXacMinh {
  readonly supplierId: string;
  readonly legalName: string;
  readonly taxCode: string | null;
  readonly status: string;
  readonly xacMinh: XacMinhNhaCungCap;
  /** `ncc_bam_xac_minh` lúc đọc, hex — lần xác minh gửi lại đúng chuỗi này (`bamDaXem`). */
  readonly bamHoSo: string;
  /** Hàng mới nhất là `VERIFIED` nhưng hồ sơ đã đổi từ lúc ấy — xác minh thôi hiệu lực vì hồ sơ, không vì hạn. */
  readonly doiSauXacMinh: boolean;
  readonly boiTen: string | null;
  readonly contacts: readonly NguoiLienHeXacMinh[];
}

interface HangHoSoXacMinh {
  id: string;
  legal_name: string;
  tax_code: string | null;
  status: string;
  loai: "VERIFIED" | "REVOKED" | null;
  con_hieu_luc: boolean;
  het_han_at: Date | null;
  created_by: string | null;
  boi_ten: string | null;
  created_at: Date | null;
  ly_do: string | null;
  bam_hien_tai: string;
  bam_luc_xac_minh: string | null;
  contacts: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    status: string;
    created_at: string;
    created_by: string | null;
    them_boi_ten: string | null;
  }[];
}

/**
 * [S1.273 / S3.3e1] Hồ sơ xác minh của MỌI nhà cung cấp trong tổ chức đang gắn, một câu — màn `/nha-cung-cap` của người giữ
 * `supplier.qualify`. Không cổng, cùng khuôn `docXacMinhNhaCungCap` (route đọc một nhà cung cấp): trạng thái xác minh và người liên
 * hệ đã đọc được qua hai route đọc không cổng; hàm này gộp chúng để màn không gọi N+1 lần. Không cho agent (route khai).
 */
export async function docHoSoXacMinh(client: pg.PoolClient, orgId: string): Promise<HoSoXacMinh[]> {
  await assertTenantBound(client, orgId, "docHoSoXacMinh");
  const { rows } = await client.query<HangHoSoXacMinh>(
    `SELECT s.id, s.legal_name, s.tax_code, s.status,
            v.loai, public.ncc_xac_minh_con_hieu_luc(s.org_id, s.id) AS con_hieu_luc,
            v.het_han_at, v.created_by, vu.full_name AS boi_ten, v.created_at, v.ly_do,
            pg_catalog.encode(public.ncc_bam_xac_minh(s.org_id, s.id), 'hex') AS bam_hien_tai,
            pg_catalog.encode(v.bam_ho_so, 'hex') AS bam_luc_xac_minh,
            coalesce((
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone, 'status', c.status,
                       'created_at', c.created_at, 'created_by', c.created_by, 'them_boi_ten', cu.full_name)
                     ORDER BY c.created_at, c.id)
                FROM public.supplier_contacts c
                LEFT JOIN public.users cu ON cu.id OPERATOR(pg_catalog.=) c.created_by AND cu.org_id OPERATOR(pg_catalog.=) c.org_id
               WHERE c.org_id OPERATOR(pg_catalog.=) s.org_id AND c.supplier_id OPERATOR(pg_catalog.=) s.id
            ), '[]'::pg_catalog.jsonb) AS contacts
       FROM public.suppliers s
       LEFT JOIN LATERAL (
         SELECT x.loai, x.het_han_at, x.created_by, x.created_at, x.ly_do, x.bam_ho_so
           FROM public.supplier_verifications x
          WHERE x.org_id OPERATOR(pg_catalog.=) s.org_id AND x.supplier_id OPERATOR(pg_catalog.=) s.id
          ORDER BY x.thu_tu DESC
          LIMIT 1) v ON true
       LEFT JOIN public.users vu ON vu.id OPERATOR(pg_catalog.=) v.created_by AND vu.org_id OPERATOR(pg_catalog.=) s.org_id
      ORDER BY s.legal_name, s.id`,
  );
  return rows.map((h) => ({
    supplierId: h.id,
    legalName: h.legal_name,
    taxCode: h.tax_code,
    status: h.status,
    xacMinh: {
      supplierId: h.id,
      loai: h.loai,
      conHieuLuc: h.con_hieu_luc,
      hetHanAt: h.het_han_at,
      boi: h.created_by,
      luc: h.created_at,
      lyDo: h.ly_do,
    },
    bamHoSo: h.bam_hien_tai,
    doiSauXacMinh: h.loai === "VERIFIED" && h.bam_luc_xac_minh !== h.bam_hien_tai,
    boiTen: h.boi_ten,
    contacts: h.contacts.map((c) => ({
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      status: c.status,
      createdAt: new Date(c.created_at),
      themBoi: c.created_by,
      themBoiTen: c.them_boi_ten,
    })),
  }));
}
