import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, maChotTuLoi, requirePermission, resolveSessionActor, tuChoiTheoChot } from "@trustprocure/identity";
import { KiemSoatError } from "./tin-hieu.js";

// =============================================================================================
// [S1.9101 / S3.4a / K9] KHAI BÁO XUNG ĐỘT LỢI ÍCH — spec S3 §4.5, §5.1 K9, §8.7; ADR-082 ⒄, ADR-9201
//
// Một khai báo là một lời khai có chủ thể (dẫn xuất từ phiên), thời điểm, phiên và BĂM DANH SÁCH MỜI lúc khai (`rfq_bam_danh_sach`
// — cùng băm người duyệt ký, K4b). `KHONG_XUNG_DOT` chỉ có hiệu lực khi băm ấy bằng băm hiện tại; `CO_XUNG_DOT` trỏ một nhà cung cấp
// có lời mời của gói và là VĨNH VIỄN cho gói ấy. Thứ K9 tạo ra là TRÁCH NHIỆM, không phải phát hiện: người nói dối vẫn đi qua, nhưng
// để lại một lời khai sai có tên (§8.7 — dòng PRODUCT §5).
//
// Gói này làm hai việc quanh bảng `coi_declarations` (`9501_khai_bao_xung_dot`):
//   ⑴ khai — người giữ `coi.declare` (mọi vai sắp quyết); luật ghi ở trigger `coi_kiem_khai_bao`: tổ chức đã bật, băm do trigger
//      đặt, nhà cung cấp phải có lời mời, không gỡ được một `CO_XUNG_DOT` — nhánh ấy mang tên ràng buộc, hàm bắt chính lỗi và ghi
//      `CONTROL_DENIED` ở giao dịch độc lập (ADR-114);
//   ⑵ đọc khai báo của CHÍNH người gọi, kèm câu trả lời HIỆN TẠI của hàm vị từ `coi_chot_hanh_dong` — màn (S3.4b) nói trước thay vì
//      để một cú bấm sai vào sổ. Khai báo của người khác không ra ngoài đây (K11).
// Bảy cổng K9 (chữ ký mở gói, lượt chấm, đề xuất/huỷ trao thầu, chữ ký duyệt trao thầu, xác minh, ghi nhận) là trigger ở bảy bảng;
// các gói chủ bảng bắt lỗi có tên — không gói nào gọi gói này để hỏi trước.
// =============================================================================================

export type TrangThaiXungDot = "KHONG_XUNG_DOT" | "CO_XUNG_DOT";

/** Một hàng khai báo. */
export interface KhaiBaoXungDot {
  readonly id: string;
  readonly rfqId: string;
  readonly trangThai: TrangThaiXungDot;
  readonly supplierId: string | null;
  readonly ghiChu: string | null;
  /** Băm danh sách mời lúc khai, hex — so với `danhSachBamHienTai` để biết lời khai còn nói về danh sách này không. */
  readonly danhSachBam: string;
  readonly luc: Date;
}

/** Khai báo của CHÍNH người gọi trên một gói, và chốt K9 đang nói gì về họ. */
export interface KhaiBaoXungDotCuaToi {
  readonly rfqId: string;
  readonly khaiBao: readonly KhaiBaoXungDot[];
  /** Băm danh sách mời HIỆN TẠI, hex. */
  readonly danhSachBamHienTai: string;
  /** Bậc ghim của gói có bật `khai_xung_dot` không; gói không bậc ghim coi như ĐÒI (fail-closed, cùng K5). Tổ chức chưa bật: `false`. */
  readonly bacDoiKhai: boolean;
  /** Mã của `coi_chot_hanh_dong` cho người gọi lúc đọc — `null` là đi qua được mọi cổng K9. */
  readonly chot: string | null;
}

const CAU_KHAI =
  "INSERT INTO public.coi_declarations (org_id, rfq_id, user_id, session_id, trang_thai, supplier_id, ghi_chu) " +
  "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid, $5::pg_catalog.text, " +
  "$6::pg_catalog.uuid, $7::pg_catalog.text) " +
  "RETURNING id, rfq_id, trang_thai, supplier_id, ghi_chu, pg_catalog.encode(danh_sach_bam, 'hex') AS danh_sach_bam, created_at";

const CAU_DOC =
  "SELECT d.id, d.rfq_id, d.trang_thai, d.supplier_id, d.ghi_chu, pg_catalog.encode(d.danh_sach_bam, 'hex') AS danh_sach_bam, d.created_at " +
  "FROM public.coi_declarations d " +
  "WHERE d.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND d.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
  "AND d.user_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid ORDER BY d.created_at, d.id";

/** Băm hiện tại, bậc có đòi khai không, và chốt cho người `$3` — cùng hàm vị từ mà bảy cổng hỏi, nên màn và cổng không trôi nhau. */
const CAU_HIEN_TAI =
  "SELECT pg_catalog.encode(public.rfq_bam_danh_sach(r.id), 'hex') AS bam, " +
  "public.to_chuc_da_bat_s3(r.org_id) AND coalesce((public.rfq_bac_ghim(r.org_id, r.id) OPERATOR(pg_catalog.->>) 'khai_xung_dot')::pg_catalog.bool, true) AS doi, " +
  "public.coi_chot_hanh_dong(r.org_id, r.id, $3::pg_catalog.uuid) AS chot " +
  "FROM public.rfq_packages r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid";

interface HangKhaiBao {
  id: string;
  rfq_id: string;
  trang_thai: TrangThaiXungDot;
  supplier_id: string | null;
  ghi_chu: string | null;
  danh_sach_bam: string;
  created_at: Date;
}

function doiHang(h: HangKhaiBao): KhaiBaoXungDot {
  return { id: h.id, rfqId: h.rfq_id, trangThai: h.trang_thai, supplierId: h.supplier_id, ghiChu: h.ghi_chu, danhSachBam: h.danh_sach_bam, luc: h.created_at };
}

/**
 * ⑴ Khai báo xung đột lợi ích của CHÍNH người gọi trên một gói. `CO_XUNG_DOT` đòi `supplierId` (một nhà cung cấp có lời mời của
 * gói); `KHONG_XUNG_DOT` không nhận `supplierId`. Ghi chú tuỳ chọn, cắt khoảng trắng, trần 2000 byte.
 */
export async function khaiBaoXungDot(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly rfqId: string;
    readonly trangThai: string;
    readonly supplierId?: string | null;
    readonly ghiChu?: string | null;
    readonly actorSessionId: string;
  },
  auditPool: pg.Pool,
): Promise<KhaiBaoXungDot> {
  await assertTenantBound(client, orgId, "khaiBaoXungDot");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.COI_DECLARE, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  if (input.trangThai !== "KHONG_XUNG_DOT" && input.trangThai !== "CO_XUNG_DOT") {
    throw new KiemSoatError("Trạng thái khai báo phải là KHONG_XUNG_DOT hoặc CO_XUNG_DOT.");
  }
  const supplierId = input.supplierId ?? null;
  if (input.trangThai === "CO_XUNG_DOT" && supplierId === null) {
    throw new KiemSoatError("Khai có xung đột lợi ích thì phải nêu nhà cung cấp.");
  }
  if (input.trangThai === "KHONG_XUNG_DOT" && supplierId !== null) {
    throw new KiemSoatError("Khai không xung đột lợi ích thì không nêu nhà cung cấp nào.");
  }
  const ghiChu = input.ghiChu === undefined || input.ghiChu === null ? null : input.ghiChu.trim();
  if (ghiChu !== null && ghiChu === "") throw new KiemSoatError("Ghi chú khai báo trống thì bỏ trường, không gửi chuỗi rỗng.");
  if (ghiChu !== null && Buffer.byteLength(ghiChu, "utf8") > 2000) throw new KiemSoatError("Ghi chú khai báo dài quá 2000 byte.");

  let hang: HangKhaiBao | undefined;
  try {
    ({ rows: [hang] } = await client.query<HangKhaiBao>(CAU_KHAI, [orgId, input.rfqId, actor.id, actor.sessionId, input.trangThai, supplierId, ghiChu]));
  } catch (loi) {
    // Nhánh *không gỡ được một CO_XUNG_DOT* của trigger `coi_kiem_khai_bao` mang tên ràng buộc (ADR-114): một hàng `CONTROL_DENIED`
    // ở giao dịch độc lập rồi lời từ chối có tên. Nhánh khác (tổ chức chưa bật, nhà cung cấp không có lời mời) nói cấu hình hay dữ
    // liệu chưa sẵn sàng — đi thẳng (ADR-060).
    const ma = maChotTuLoi(loi);
    if (ma !== null) await tuChoiTheoChot(auditPool, orgId, actor, input.rfqId, ma, loi);
    throw loi;
  }
  if (hang === undefined) throw new KiemSoatError("Câu khai báo không trả về hàng nào.");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "COI_DECLARED",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    // Trạng thái và nhà cung cấp — không ghi chú: lời khai sai để lại dấu bằng chính hàng khai báo (§8.7), sổ chỉ cần nói AI khai GÌ.
    payload: { declarationId: hang.id, trangThai: hang.trang_thai, supplierId: hang.supplier_id },
  });
  return doiHang(hang);
}

/** ⑵ Khai báo của CHÍNH người gọi trên một gói, kèm băm hiện tại và câu trả lời của chốt K9 cho họ. Không ghi sổ. */
export async function docKhaiBaoXungDot(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<KhaiBaoXungDotCuaToi> {
  await assertTenantBound(client, orgId, "docKhaiBaoXungDot");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.COI_DECLARE, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  const hienTai = (await client.query<{ bam: string; doi: boolean; chot: string | null }>(CAU_HIEN_TAI, [orgId, input.rfqId, actor.id])).rows[0];
  if (hienTai === undefined) throw new KiemSoatError("Không tìm thấy gói thầu trong tổ chức đang gắn.");
  const { rows } = await client.query<HangKhaiBao>(CAU_DOC, [orgId, input.rfqId, actor.id]);
  return { rfqId: input.rfqId, khaiBao: rows.map(doiHang), danhSachBamHienTai: hienTai.bam, bacDoiKhai: hienTai.doi, chot: hienTai.chot };
}
