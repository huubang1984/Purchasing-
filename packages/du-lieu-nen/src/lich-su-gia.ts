// ==============================================================================================
// [S1.251 / S4.4b] ĐỌC LỊCH SỬ GIÁ CỦA MỘT HÀNG CHUẨN — đường đọc DUY NHẤT của `public.quan_sat_gia` từ mã ứng dụng (spec S4 §4.5,
// §3.5; §5.1 L6; ADR-140).
//
// CỔNG `bid.view` (spec §4.5): lịch sử giá là giá SAU mở thầu, và cổng của dữ liệu ấy đã là `bid.view` — cùng cổng của
// `buildComparisonTable` và `docBangXepHang`. Cổng nằm TRONG hàm (rổ `HAM_DOC_CO_QUYEN` của `cong-quyen-route.test.ts`): mục
// đích duy nhất của hàm là kiểm soát TIẾT LỘ. Lần từ chối vào sổ qua `auditPool` (`PERMISSION_DENIED`, giao dịch độc lập).
//
// MỐC = `now()` của giao dịch đọc: không `?moc=` (router cắt query, E6), không phân trang — p95 dưới ngưỡng giả định 500 ms tới
// khoảng 1.200 quan sát mỗi hàng chuẩn (biên bản §S1.235, `tools/do-lich-su-gia`). Hàm LUÔN truyền `p_hang_chuan`: đọc hết tổ
// chức mất 84–88 s ở quy mô đo.
//
// VỊ TỪ BÍ MẬT không nằm ở đây: gói chưa mở niêm phong, vòng BAFO đang mở hay đã đóng mà chưa mở niêm phong, gói huỷ, lời mời
// thu hồi — `gia_da_lo` và thân `quan_sat_gia` (`096`, L5). Phiên khách và phiên Passport ra 0 hàng nhờ RLS theo NGƯỜI GỌI
// (`SECURITY INVOKER`); route lại chỉ mở cho phiên người mua (`audience: "BUYER"`).
//
// HÌNH DẠNG (chủ dự án chốt 2026-10-01): MỌI quan sát của hàng chuẩn tại mốc kèm `trangThai`, `hoiTo`, `sauMoc`, cộng số đếm
// theo trạng thái; chỉ `supplierId` — không tên nhà cung cấp, không `payload`. Số là CHUỖI thập phân của SQL, không qua `double`.
//
// SỔ: mỗi lần đọc THÀNH CÔNG một hàng `PRICE_HISTORY_READ` trên CHÍNH `client`, sau mọi câu đọc — cùng khuôn và cùng lý do với
// `COMPARISON_VIEWED` (ADR-102): ghi hỏng thì NÉM, giao dịch của người gọi ROLLBACK, và lịch sử không đi ra. Payload chỉ
// `{ itemId, soQuanSat, viewedBySessionId }` — không một con số giá nào.
// ==============================================================================================
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { docHangChuan } from "./hang-chuan.js";

/** Sáu trạng thái của `quan_sat_gia`, đúng thứ tự ưu tiên của thân hàm (`096`). */
export const TRANG_THAI_QUAN_SAT = [
  "KHONG_DOC_DUOC",
  "LECH_TONG",
  "LECH_TIEN_TE",
  "CHUA_ANH_XA",
  "KHONG_QUY_DOI_DUOC",
  "HOP_LE",
] as const;
export type TrangThaiQuanSat = (typeof TRANG_THAI_QUAN_SAT)[number];

/** Một quan sát: một (gói, nhà cung cấp, dòng) — định danh là cặp (`bidVersionId`, `lineNo`). */
export interface QuanSatGia {
  readonly rfqId: string;
  readonly supplierId: string;
  readonly bidVersionId: string;
  readonly lineNo: number;
  /** Mốc mở giá của gói chứa quan sát. */
  readonly ngayQuanSat: Date;
  readonly anhXaId: string | null;
  readonly thanhTien: string | null;
  /** Số lượng NGƯỜI MUA viết trên dòng — đơn giá chia cho nó, không cho số trong phong bì. */
  readonly soLuong: string;
  readonly donVi: string;
  readonly donGia: string | null;
  readonly donViGoc: string | null;
  readonly heSo: string | null;
  /** Chỉ khi `HOP_LE`. */
  readonly donGiaQuyDoi: string | null;
  readonly tienTe: string | null;
  readonly trangThai: TrangThaiQuanSat;
  /** Loại hàng nền đã dùng mà ghi SAU mốc của chính gói chứa quan sát. */
  readonly hoiTo: readonly string[];
  /** Số hàng nền mới hơn mà lần đọc tại mốc đã bỏ qua, theo loại. */
  readonly sauMoc: Readonly<Record<string, number>>;
}

export interface LichSuGia {
  readonly itemId: string;
  readonly moc: Date;
  readonly quanSat: readonly QuanSatGia[];
  readonly soTheoTrangThai: Readonly<Record<TrangThaiQuanSat, number>>;
}

export interface DocLichSuGiaInput {
  readonly itemId: string;
  readonly actorSessionId: string;
}

interface HangQuanSat {
  readonly moc: Date;
  readonly rfq_id: string;
  readonly supplier_id: string;
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly ngay_quan_sat: Date;
  readonly anh_xa_id: string | null;
  readonly thanh_tien: string | null;
  readonly so_luong: string;
  readonly don_vi: string;
  readonly don_gia: string | null;
  readonly don_vi_goc: string | null;
  readonly he_so: string | null;
  readonly don_gia_quy_doi: string | null;
  readonly tien_te: string | null;
  readonly trang_thai: TrangThaiQuanSat;
  readonly hoi_to: string[];
  readonly sau_moc: Record<string, number>;
}

/**
 * Lịch sử giá của một hàng chuẩn tại mốc BÂY GIỜ. `null` khi hàng chuẩn không có trong tổ chức — sau cổng quyền, nên người
 * không giữ `bid.view` không dò được hàng nào tồn tại (dù danh sách hàng chuẩn không phải bí mật với người mua).
 */
export async function docLichSuGia(
  client: pg.PoolClient,
  orgId: string,
  input: DocLichSuGiaInput,
  auditPool: pg.Pool,
): Promise<LichSuGia | null> {
  await assertTenantBound(client, orgId, "docLichSuGia");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.BID_VIEW,
      resourceType: "CANONICAL_ITEM",
      resourceId: input.itemId,
    },
    auditPool,
  );
  if ((await docHangChuan(client, orgId, input.itemId)) === null) return null;

  const { rows: mocHang } = await client.query<{ moc: Date }>("SELECT pg_catalog.now() AS moc");
  const moc = mocHang[0]?.moc;
  if (moc === undefined) throw new Error("câu đọc mốc không trả hàng nào");
  const { rows } = await client.query<HangQuanSat>(
    "SELECT q.rfq_id, q.supplier_id, q.bid_version_id, q.line_no, q.ngay_quan_sat, q.anh_xa_id, " +
      "q.thanh_tien::pg_catalog.text AS thanh_tien, q.so_luong::pg_catalog.text AS so_luong, q.don_vi, " +
      "q.don_gia::pg_catalog.text AS don_gia, q.don_vi_goc, q.he_so::pg_catalog.text AS he_so, " +
      "q.don_gia_quy_doi::pg_catalog.text AS don_gia_quy_doi, q.tien_te, q.trang_thai, q.hoi_to, q.sau_moc " +
      "FROM public.quan_sat_gia(pg_catalog.now(), $1::pg_catalog.uuid) q " +
      "ORDER BY q.ngay_quan_sat, q.rfq_id, q.supplier_id, q.line_no",
    [input.itemId],
  );

  const soTheoTrangThai = Object.fromEntries(TRANG_THAI_QUAN_SAT.map((t) => [t, 0])) as Record<TrangThaiQuanSat, number>;
  for (const r of rows) soTheoTrangThai[r.trang_thai] += 1;

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "PRICE_HISTORY_READ",
    resourceType: "CANONICAL_ITEM",
    resourceId: input.itemId,
    payload: { itemId: input.itemId, soQuanSat: rows.length, viewedBySessionId: input.actorSessionId },
  });

  return {
    itemId: input.itemId,
    moc,
    quanSat: rows.map((r) => ({
      rfqId: r.rfq_id,
      supplierId: r.supplier_id,
      bidVersionId: r.bid_version_id,
      lineNo: r.line_no,
      ngayQuanSat: r.ngay_quan_sat,
      anhXaId: r.anh_xa_id,
      thanhTien: r.thanh_tien,
      soLuong: r.so_luong,
      donVi: r.don_vi,
      donGia: r.don_gia,
      donViGoc: r.don_vi_goc,
      heSo: r.he_so,
      donGiaQuyDoi: r.don_gia_quy_doi,
      tienTe: r.tien_te,
      trangThai: r.trang_thai,
      hoiTo: r.hoi_to,
      sauMoc: r.sau_moc,
    })),
    soTheoTrangThai,
  };
}
