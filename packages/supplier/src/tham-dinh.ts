import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, maChotTuLoi, requirePermission, resolveSessionActor, tuChoiTheoChotTaiNguyen } from "@trustprocure/identity";
import { SupplierError } from "./suppliers.js";

// =============================================================================================
// [S1.293 / S3.7a2 / K8b · ADR-081 ⑵ ⑸ · ADR-164] THẨM ĐỊNH ĐẦY ĐỦ NHÀ CUNG CẤP — trên phiên bản Passport MỚI NHẤT
//
// Cấp hai của ADR-081 ⑵: bên mua xác nhận một phiên bản hồ sơ do nhà cung cấp nộp; chỉ đòi khi trao thầu ở bậc `tham_dinh_truoc_trao`.
// Câu hỏi *nhà cung cấp này có thẩm định còn hiệu lực không* là hàm SQL `ncc_tham_dinh_hien_hanh` (`124`), một phép tính, một chỗ ở;
// gói này chỉ ghi và đọc. Khuôn `xac-minh.ts` (K8a), ba lớp:
//   ⑴ `requirePermission(supplier.qualify)` — thiếu quyền là `PERMISSION_DENIED` (D5), trước mọi câu ghi;
//   ⑵ trigger `ncc_kiem_tham_dinh` — lớp có THẨM QUYỀN: người thẩm định khác người tạo hồ sơ và người liên hệ, không giữ `rfq.invite`,
//      không là người đã đề xuất hay đã ký trao thầu cho nhà cung cấp ấy; phiên bản thuộc nhà cung cấp và là MỚI NHẤT; MST khớp bản ghi;
//      xác minh K8a còn hiệu lực; tổ chức đã bật S3; thứ tự dưới khoá tư vấn hạt giống 7; hạn hiệu lực;
//   ⑶ ba nhánh luật người mang TÊN RÀNG BUỘC (`k8b_*`, `CHOT_THEO_RANG_BUOC`) — hàm này bắt chính lỗi ấy và ghi `CONTROL_DENIED` ở giao
//      dịch độc lập (K12) rồi ném lời từ chối có tên. Hai nhánh dữ liệu có tên riêng (`tham_dinh_phien_ban_khong_moi_nhat`,
//      `tham_dinh_mst_lech`, `tham_dinh_chua_xac_minh`) thành `SupplierError` nói người dùng phải làm gì — không vào sổ (ADR-060).
// =============================================================================================

/** Trạng thái thẩm định của một nhà cung cấp — hàng MỚI NHẤT theo `thu_tu`, cộng câu trả lời của hàm hiệu lực. */
export interface ThamDinhNhaCungCap {
  readonly supplierId: string;
  /** `null` khi chưa từng có hàng nào. */
  readonly loai: "QUALIFIED" | "REVOKED" | null;
  /** `ncc_tham_dinh_hien_hanh` khác NULL: hàng mới nhất là `QUALIFIED`, chưa hết hạn, trỏ phiên bản mới nhất, K8a còn hiệu lực. */
  readonly conHieuLuc: boolean;
  readonly hetHanAt: Date | null;
  readonly boi: string | null;
  readonly luc: Date | null;
  readonly lyDo: string | null;
  /** Thứ tự phiên bản Passport mà hàng mới nhất trỏ tới (`null` ở `REVOKED` hay chưa có hàng). */
  readonly phienBanThuTu: number | null;
  /** Thứ tự phiên bản Passport MỚI NHẤT của nhà cung cấp — khác `phienBanThuTu` là thẩm định đã thôi hiệu lực vì hồ sơ đổi. */
  readonly phienBanMoiNhatThuTu: number | null;
}

interface HangThamDinh {
  loai: "QUALIFIED" | "REVOKED" | null;
  con_hieu_luc: boolean;
  het_han_at: Date | null;
  created_by: string | null;
  created_at: Date | null;
  ly_do: string | null;
  phien_ban_thu_tu: string | null;
  phien_ban_moi_nhat: string | null;
}

/** Tài nguyên của lời từ chối K8b trong sổ: chính nhà cung cấp bị thẩm định. */
const TAI_NGUYEN = "SUPPLIER";

/** Lời có tên cho ba nhánh dữ liệu của trigger — không vào sổ. */
const LOI_DU_LIEU: Readonly<Record<string, string>> = {
  tham_dinh_phien_ban_khong_moi_nhat: "Nhà cung cấp đã nộp phiên bản hồ sơ mới hơn — đọc lại hồ sơ Passport rồi thẩm định phiên bản mới nhất.",
  tham_dinh_mst_lech: "Mã số thuế trong hồ sơ Passport khác mã số thuế của bản ghi nhà cung cấp — không thẩm định được (ADR-081 ⑴).",
  tham_dinh_chua_xac_minh: "Nhà cung cấp chưa có xác minh còn hiệu lực — xác minh (K8a) trước, rồi thẩm định.",
};

async function ghi(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly supplierId: string;
    readonly actorSessionId: string;
    readonly loai: "QUALIFIED" | "REVOKED";
    readonly passportVersionId: string | null;
    readonly lyDo: string | null;
  },
  auditPool: pg.Pool,
): Promise<{ id: string; thu_tu: string; het_han_at: Date | null }> {
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.SUPPLIER_QUALIFY, resourceType: TAI_NGUYEN, resourceId: input.supplierId },
    auditPool,
  );
  let hang: { id: string; thu_tu: string; het_han_at: Date | null } | undefined;
  try {
    const { rows } = await client.query<{ id: string; thu_tu: string; het_han_at: Date | null }>(
      `INSERT INTO public.supplier_qualifications (org_id, supplier_id, loai, passport_version_id, ly_do, created_by, created_by_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, thu_tu::pg_catalog.text AS thu_tu, het_han_at`,
      [orgId, input.supplierId, input.loai, input.passportVersionId, input.lyDo, actor.id, actor.sessionId],
    );
    hang = rows[0];
  } catch (loi) {
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChotTaiNguyen(auditPool, orgId, actor, { resourceType: TAI_NGUYEN, resourceId: input.supplierId }, ma, loi);
    const rangBuoc = (loi as { constraint?: unknown }).constraint;
    const loiCoTen = typeof rangBuoc === "string" ? LOI_DU_LIEU[rangBuoc] : undefined;
    if (loiCoTen !== undefined) throw new SupplierError(loiCoTen);
    throw loi;
  }
  if (hang === undefined) throw new SupplierError("Câu INSERT thẩm định không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: input.loai === "QUALIFIED" ? "SUPPLIER_QUALIFIED" : "SUPPLIER_QUALIFICATION_REVOKED",
    resourceType: "supplier",
    resourceId: input.supplierId,
    // Thứ tự của hàng và id phiên bản — không một trường hồ sơ nào: sổ nói AI thẩm định phiên bản NÀO khi nào.
    payload:
      input.loai === "QUALIFIED"
        ? { thuTu: hang.thu_tu, passportVersionId: input.passportVersionId }
        : { thuTu: hang.thu_tu, reason: input.lyDo },
  });
  return hang;
}

/** Id phiên bản Passport của nhà cung cấp theo thứ tự; `null` khi không có. Đọc dưới RLS của phiên gọi. */
async function idPhienBan(client: pg.PoolClient, orgId: string, supplierId: string, thuTu: number): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT v.id FROM public.supplier_passport_versions v
      WHERE v.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND v.supplier_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND v.thu_tu OPERATOR(pg_catalog.=) $3::pg_catalog.int8`,
    [orgId, supplierId, thuTu],
  );
  return rows[0]?.id ?? null;
}

/**
 * Thẩm định một nhà cung cấp trên phiên bản Passport số `phienBanThuTu` — màn thẩm định đọc `docHoSoPassport` (thứ tự, không id) và gửi
 * lại đúng thứ tự người thẩm định đã xem; CSDL đòi nó là phiên bản MỚI NHẤT, nên một phiên bản nộp giữa lúc xem và lúc bấm bị từ chối có
 * tên (khuôn `bamDaXem` của K8a). Thẩm định lại một nhà cung cấp đã thẩm định là một hàng MỚI — gia hạn hay theo phiên bản mới.
 */
export async function thamDinhNhaCungCap(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly phienBanThuTu: number; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<ThamDinhNhaCungCap> {
  await assertTenantBound(client, orgId, "thamDinhNhaCungCap");
  if (!Number.isInteger(input.phienBanThuTu) || input.phienBanThuTu < 1) throw new SupplierError("Thứ tự phiên bản Passport phải là số nguyên dương.");
  const versionId = await idPhienBan(client, orgId, input.supplierId, input.phienBanThuTu);
  if (versionId === null) throw new SupplierError("Không tìm thấy phiên bản Passport ấy của nhà cung cấp — đọc lại hồ sơ rồi thẩm định.");
  await ghi(
    client,
    orgId,
    { supplierId: input.supplierId, actorSessionId: input.actorSessionId, loai: "QUALIFIED", passportVersionId: versionId, lyDo: null },
    auditPool,
  );
  return await docThamDinhNhaCungCap(client, orgId, input.supplierId);
}

/** Thu hồi thẩm định — lý do bắt buộc, trần 2000 byte (CHECK ở `124`). Chỉ thu hồi được khi hàng mới nhất là `QUALIFIED`. */
export async function thuHoiThamDinhNhaCungCap(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly reason: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<ThamDinhNhaCungCap> {
  await assertTenantBound(client, orgId, "thuHoiThamDinhNhaCungCap");
  const lyDo = input.reason.trim();
  if (lyDo === "") throw new SupplierError("Cần lý do thu hồi thẩm định.");
  if (Buffer.byteLength(lyDo, "utf8") > 2000) throw new SupplierError("Lý do thu hồi dài quá 2000 byte.");
  await ghi(
    client,
    orgId,
    { supplierId: input.supplierId, actorSessionId: input.actorSessionId, loai: "REVOKED", passportVersionId: null, lyDo },
    auditPool,
  );
  return await docThamDinhNhaCungCap(client, orgId, input.supplierId);
}

/** Trạng thái thẩm định hiện tại của một nhà cung cấp trong tổ chức đang gắn. Không đọc được nhà cung cấp ⇒ ném. */
export async function docThamDinhNhaCungCap(client: pg.PoolClient, orgId: string, supplierId: string): Promise<ThamDinhNhaCungCap> {
  await assertTenantBound(client, orgId, "docThamDinhNhaCungCap");
  const { rows } = await client.query<HangThamDinh>(
    `SELECT q.loai, public.ncc_tham_dinh_con_hieu_luc(s.org_id, s.id) AS con_hieu_luc, q.het_han_at, q.created_by, q.created_at, q.ly_do,
            v.thu_tu::pg_catalog.text AS phien_ban_thu_tu,
            (SELECT m.thu_tu::pg_catalog.text FROM public.supplier_passport_versions m
              WHERE m.org_id OPERATOR(pg_catalog.=) s.org_id AND m.supplier_id OPERATOR(pg_catalog.=) s.id
              ORDER BY m.thu_tu DESC LIMIT 1) AS phien_ban_moi_nhat
       FROM public.suppliers s
       LEFT JOIN LATERAL (SELECT x.loai, x.het_han_at, x.created_by, x.created_at, x.ly_do, x.passport_version_id
                            FROM public.supplier_qualifications x
                           WHERE x.org_id OPERATOR(pg_catalog.=) s.org_id AND x.supplier_id OPERATOR(pg_catalog.=) s.id
                           ORDER BY x.thu_tu DESC LIMIT 1) q ON true
       LEFT JOIN public.supplier_passport_versions v ON v.org_id OPERATOR(pg_catalog.=) s.org_id AND v.id OPERATOR(pg_catalog.=) q.passport_version_id
      WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND s.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, supplierId],
  );
  const h = rows[0];
  if (h === undefined) throw new SupplierError("Không tìm thấy nhà cung cấp.");
  return {
    supplierId,
    loai: h.loai,
    conHieuLuc: h.con_hieu_luc,
    hetHanAt: h.het_han_at,
    boi: h.created_by,
    luc: h.created_at,
    lyDo: h.ly_do,
    phienBanThuTu: h.phien_ban_thu_tu === null ? null : Number(h.phien_ban_thu_tu),
    phienBanMoiNhatThuTu: h.phien_ban_moi_nhat === null ? null : Number(h.phien_ban_moi_nhat),
  };
}
