// ==============================================================================================
// [S1.9101 / S4.6b] BỘ ĐỌC GIÁ CỦA HAI BẢNG NGOÀI TẠI MỘT MỐC — đường ĐỌC của L15 (spec S4 §4.6, §4.7; ADR-096 ⑵ ⑷; ADR-149 ⑹; ADR-9201).
//
// KHÔNG CỔNG Ở ĐÂY, nói ra — cùng tư thế `benchmark-goi.ts`: ba hàm của tệp là phép ĐỌC chỉ `benchmark-goi.ts` gọi — khi tính bản lưu
// của bảng so sánh, khi đọc cờ mốc ngoài của bảng, và khi bấm *Xem dải* —, mà các hàm ấy chỉ `packages/danh-gia/src/doc-benchmark.ts`
// gọi, sau cổng `bid.view` (người đọc giá của hai bảng là `bid.view`, ADR-096 ⑵).
// `tests/architecture/bang-ngoai-liet-ke.test.ts` liệt kê tệp này, ghim chỗ gọi theo ký hiệu, và đòi `don_gia` chỉ được ĐỌC ở đây.
//
// MỌI hàng dữ liệu của hàng chuẩn đi ra — kể cả hàng ghi sau mốc và hàng đã rút — mỗi hàng mang ba cờ thời điểm so với mốc; luật L1 nằm
// ở lõi thuần `dai-ngoai.ts`. Đơn giá quy đổi về đơn vị gốc TẠI MỐC bằng lõi `quy_doi_da_giai` (L4), khoá đơn vị đúng như trigger ghi
// `du_lieu_ngoai_kiem_ghi` của `109` hỏi (mã danh mục nếu cột `don_vi` là một mã, không thì chính chuỗi đã làm sạch).
// Thời điểm qua lại bằng MICRO GIÂY kể từ epoch — khuôn `benchmark-goi.ts`.
// ==============================================================================================
import type pg from "pg";
import type { HangLichSuNgoai, HangMocNgoai } from "./dai-ngoai.js";

// Ba câu viết TRỌN, không ghép bằng `${…}`: bộ đọc SQL của lớp máy (`tests/architecture/qt3-doc-sql.ts`) ghép chuỗi liền kề nối bằng `+`
// và không thấy nội suy. Mốc (`$3`, micro giây) thành `timestamptz` bằng cùng biểu thức của `benchmark-goi.ts`.

/** Lịch sử mua ngoài của các hàng chuẩn `$2` — CÓ đơn giá quy đổi tại mốc. */
const CAU_LICH_SU_NGOAI =
  "SELECT h.id, h.canonical_item_id, h.tien_te, h.ngay_mua::pg_catalog.text AS ngay_mua, " +
  "public.chuoi_sach(h.nha_cung_cap_text) AS nha_cung_cap, h.nguon, " +
  "(h.ghi_luc OPERATOR(pg_catalog.<) m.moc) AS ghi_truoc, " +
  "EXISTS (SELECT 1 FROM public.external_purchase_history r WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND r.rut_cua OPERATOR(pg_catalog.=) h.id AND r.ghi_luc OPERATOR(pg_catalog.<) m.moc) AS rut_truoc, " +
  "EXISTS (SELECT 1 FROM public.external_purchase_history r WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND r.rut_cua OPERATOR(pg_catalog.=) h.id AND r.ghi_luc OPERATOR(pg_catalog.>=) m.moc) AS rut_sau, " +
  "(h.don_gia OPERATOR(pg_catalog./) q.he_so)::pg_catalog.text AS don_gia_quy_doi " +
  "FROM public.external_purchase_history h CROSS JOIN (SELECT 'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+) " +
  "($3::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval) AS moc) m " +
  "JOIN public.canonical_items ci ON ci.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND ci.id OPERATOR(pg_catalog.=) h.canonical_item_id " +
  "CROSS JOIN LATERAL public.quy_doi_da_giai(h.org_id, h.canonical_item_id, " +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) h.don_vi), h.don_vi, " +
  "ci.don_vi_goc, ci.don_vi_goc, m.moc) q " +
  "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
  "AND h.canonical_item_id OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.uuid[]) AND h.rut_cua IS NULL " +
  "ORDER BY h.canonical_item_id, h.seq";

/** Mốc ngoài của các hàng chuẩn `$2` — KHÔNG đọc đơn giá: chỉ đủ để chọn mốc và hiện CỜ ở bảng benchmark. */
const CAU_MOC_NGOAI_CO =
  "SELECT h.id, h.canonical_item_id, h.tien_te, h.ngay_hieu_luc::pg_catalog.text AS ngay_hieu_luc, h.nguon, " +
  "h.seq::pg_catalog.text AS seq, (h.ghi_luc OPERATOR(pg_catalog.<) m.moc) AS ghi_truoc, " +
  "EXISTS (SELECT 1 FROM public.external_price_references r WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND r.rut_cua OPERATOR(pg_catalog.=) h.id AND r.ghi_luc OPERATOR(pg_catalog.<) m.moc) AS rut_truoc, " +
  "EXISTS (SELECT 1 FROM public.external_price_references r WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND r.rut_cua OPERATOR(pg_catalog.=) h.id AND r.ghi_luc OPERATOR(pg_catalog.>=) m.moc) AS rut_sau, " +
  "(q.he_so IS NOT NULL) AS quy_doi_duoc " +
  "FROM public.external_price_references h CROSS JOIN (SELECT 'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+) " +
  "($3::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval) AS moc) m " +
  "JOIN public.canonical_items ci ON ci.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND ci.id OPERATOR(pg_catalog.=) h.canonical_item_id " +
  "CROSS JOIN LATERAL public.quy_doi_da_giai(h.org_id, h.canonical_item_id, " +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) h.don_vi), h.don_vi, " +
  "ci.don_vi_goc, ci.don_vi_goc, m.moc) q " +
  "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
  "AND h.canonical_item_id OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.uuid[]) AND h.rut_cua IS NULL " +
  "ORDER BY h.canonical_item_id, h.seq";

/** Mốc ngoài của các hàng chuẩn `$2` — CÓ đơn giá quy đổi tại mốc (*Xem dải*). */
const CAU_MOC_NGOAI_GIA =
  "SELECT h.id, h.canonical_item_id, h.tien_te, h.ngay_hieu_luc::pg_catalog.text AS ngay_hieu_luc, h.nguon, " +
  "h.seq::pg_catalog.text AS seq, (h.ghi_luc OPERATOR(pg_catalog.<) m.moc) AS ghi_truoc, " +
  "EXISTS (SELECT 1 FROM public.external_price_references r WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND r.rut_cua OPERATOR(pg_catalog.=) h.id AND r.ghi_luc OPERATOR(pg_catalog.<) m.moc) AS rut_truoc, " +
  "EXISTS (SELECT 1 FROM public.external_price_references r WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND r.rut_cua OPERATOR(pg_catalog.=) h.id AND r.ghi_luc OPERATOR(pg_catalog.>=) m.moc) AS rut_sau, " +
  "(q.he_so IS NOT NULL) AS quy_doi_duoc, " +
  "(h.don_gia OPERATOR(pg_catalog./) q.he_so)::pg_catalog.text AS don_gia_quy_doi " +
  "FROM public.external_price_references h CROSS JOIN (SELECT 'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+) " +
  "($3::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval) AS moc) m " +
  "JOIN public.canonical_items ci ON ci.org_id OPERATOR(pg_catalog.=) h.org_id " +
  "AND ci.id OPERATOR(pg_catalog.=) h.canonical_item_id " +
  "CROSS JOIN LATERAL public.quy_doi_da_giai(h.org_id, h.canonical_item_id, " +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) h.don_vi), h.don_vi, " +
  "ci.don_vi_goc, ci.don_vi_goc, m.moc) q " +
  "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
  "AND h.canonical_item_id OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.uuid[]) AND h.rut_cua IS NULL " +
  "ORDER BY h.canonical_item_id, h.seq";

export interface DocNgoaiTaiMocInput {
  readonly canonicalItemIds: readonly string[];
  /** Mốc mở giá của gói X, micro giây. */
  readonly mocMicro: bigint;
}

/** Hàng lịch sử ngoài kèm hàng chuẩn của nó. */
export interface HangLichSuNgoaiCuaHang extends HangLichSuNgoai {
  readonly canonicalItemId: string;
}

/** Hàng mốc ngoài kèm hàng chuẩn — không con số. */
export interface HangMocNgoaiCuaHang extends HangMocNgoai {
  readonly canonicalItemId: string;
}

/** Hàng mốc ngoài kèm hàng chuẩn và đơn giá quy đổi tại mốc (`null` khi không quy đổi được). */
export interface HangMocNgoaiCoGia extends HangMocNgoaiCuaHang {
  readonly donGiaQuyDoi: string | null;
}

interface CotThoiDiem {
  readonly id: string;
  readonly canonical_item_id: string;
  readonly tien_te: string;
  readonly nguon: string;
  readonly ghi_truoc: boolean;
  readonly rut_truoc: boolean;
  readonly rut_sau: boolean;
}

const coThoiDiem = (r: CotThoiDiem) => ({
  id: r.id,
  canonicalItemId: r.canonical_item_id,
  tienTe: r.tien_te,
  nguon: r.nguon,
  ghiTruocMoc: r.ghi_truoc,
  rutTruocMoc: r.rut_truoc,
  rutSauMoc: r.rut_sau,
});

/** Mọi hàng dữ liệu lịch sử ngoài của các hàng chuẩn, quy đổi tại mốc. KHÔNG CỔNG (khối đầu tệp). */
export async function docLichSuNgoaiTaiMoc(
  client: pg.PoolClient,
  orgId: string,
  input: DocNgoaiTaiMocInput,
): Promise<readonly HangLichSuNgoaiCuaHang[]> {
  if (input.canonicalItemIds.length === 0) return [];
  const { rows } = await client.query<
    CotThoiDiem & { readonly ngay_mua: string; readonly nha_cung_cap: string; readonly don_gia_quy_doi: string | null }
  >(CAU_LICH_SU_NGOAI, [orgId, [...input.canonicalItemIds], input.mocMicro.toString()]);
  return rows.map((r) => ({ ...coThoiDiem(r), ngayMua: r.ngay_mua, nhaCungCap: r.nha_cung_cap, donGiaQuyDoi: r.don_gia_quy_doi }));
}

interface CotMoc extends CotThoiDiem {
  readonly ngay_hieu_luc: string;
  readonly seq: string;
  readonly quy_doi_duoc: boolean;
}

const hangMoc = (r: CotMoc): HangMocNgoaiCuaHang => ({
  ...coThoiDiem(r),
  ngayHieuLuc: r.ngay_hieu_luc,
  seq: r.seq,
  quyDoiDuoc: r.quy_doi_duoc,
});

/** Mọi hàng mốc ngoài của các hàng chuẩn tại mốc — KHÔNG đơn giá: chỉ để hiện cờ ở bảng benchmark. KHÔNG CỔNG (khối đầu tệp). */
export async function docMocNgoaiCo(
  client: pg.PoolClient,
  orgId: string,
  input: DocNgoaiTaiMocInput,
): Promise<readonly HangMocNgoaiCuaHang[]> {
  if (input.canonicalItemIds.length === 0) return [];
  const { rows } = await client.query<CotMoc>(CAU_MOC_NGOAI_CO, [orgId, [...input.canonicalItemIds], input.mocMicro.toString()]);
  return rows.map(hangMoc);
}

/** Mọi hàng mốc ngoài của các hàng chuẩn tại mốc, CÓ đơn giá quy đổi — *Xem dải*. KHÔNG CỔNG (khối đầu tệp). */
export async function docMocNgoaiTaiMoc(
  client: pg.PoolClient,
  orgId: string,
  input: DocNgoaiTaiMocInput,
): Promise<readonly HangMocNgoaiCoGia[]> {
  if (input.canonicalItemIds.length === 0) return [];
  const { rows } = await client.query<CotMoc & { readonly don_gia_quy_doi: string | null }>(CAU_MOC_NGOAI_GIA, [
    orgId,
    [...input.canonicalItemIds],
    input.mocMicro.toString(),
  ]);
  return rows.map((r) => ({ ...hangMoc(r), donGiaQuyDoi: r.don_gia_quy_doi }));
}
