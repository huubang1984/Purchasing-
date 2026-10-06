// ==============================================================================================
// [S1.9101 / S4.6a] MỐC GIÁ NGOÀI VÀ LỊCH SỬ MUA NGOÀI HỆ THỐNG — ĐƯỜNG GHI VÀ DANH SÁCH KHÔNG CỘT GIÁ (spec S4 §4.7; ADR-096;
// ADR-9201; L1 · L3 · L15)
//
// GHI — cùng ba bước của `hang-chuan.ts`: `assertTenantBound`, tác giả dẫn xuất từ phiên (ADR-016); câu INSERT vào bảng chỉ-ghi-
// thêm (`seq`, `ghi_luc` do trigger khuôn L1 đặt; người ghi phải giữ `item.manage`; luật ghi `du_lieu_ngoai_kiem_ghi` từ chối đơn vị
// không quy đổi được); một hàng sổ trong CÙNG giao dịch. Một lần nhập — tay hay một lần dán — là MỘT lô (`lo_nhap_id`) và MỘT hàng
// sổ (ADR-096 ⑸); lô tất-cả-hoặc-không.
//
// PHÂN GIẢI Ở SQL, MỘT LẦN CHO CẢ LÔ: mã hàng → hàng chuẩn của tổ chức; chuỗi đơn vị → KHOÁ (mã danh mục nếu chuỗi quy về một mã —
// luật `maDanhMuc` của người quản lý dữ liệu —, không thì chuỗi đã làm sạch); khoá → quy đổi được sang đơn vị gốc không (lõi
// `quy_doi_da_giai`, L4). Tầng gói hỏi TRƯỚC để trả lỗi theo DÒNG; trigger hỏi LẠI khi ghi — tầng có thẩm quyền.
//
// ĐỌC: người quản lý dữ liệu mù giá (ADR-097 ⑺) và cổng đọc GIÁ của hai bảng là `bid.view` (ADR-096 ⑵) — chủ dự án chốt 2026-10-06:
// màn `/du-lieu` hiện hàng đã nhập KHÔNG CỘT GIÁ. Hai hàm đọc dưới đây giữ cổng `item.manage` TRONG hàm (rổ `HAM_DOC_CO_QUYEN`) và
// không câu nào chọn `don_gia` — lớp `bang-ngoai-liet-ke.test.ts` ghim điều đó. Bộ đọc giá (`bid.view`) là của S4.6b.
//
// SỔ: không một con số giá nào — payload chỉ loại, cách nhập, số dòng, số hàng chuẩn (`audit_events_payload_khong_mang_gia`).
// ==============================================================================================
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import {
  cauLoiDong,
  docCsvNgoai,
  docNgay,
  laDonGia,
  type DongNgoaiDaDoc,
  type LoaiDuLieuNgoai,
  type LoiDongNgoai,
  type MaLoiDong,
} from "./csv-ngoai.js";
import { DuLieuNenError, ghiDuLieuNen } from "./hang-chuan.js";

export type CachNhapNgoai = "TAY" | "DAN_CSV";

export type KetQuaNhapNgoai =
  | { readonly nhan: true; readonly loai: LoaiDuLieuNgoai; readonly loNhapId: string; readonly soDong: number; readonly soHangChuan: number }
  | { readonly nhan: false; readonly loai: LoaiDuLieuNgoai; readonly loi: readonly LoiDongNgoai[] };

/** Một dòng đã phân giải: hàng chuẩn và khoá đơn vị. */
interface DongDaGiai {
  readonly hangChuanId: string;
  readonly donGia: string;
  readonly khoaDonVi: string;
  readonly tienTe: string;
  readonly ngay: string;
  readonly nguon: string;
  readonly nhaCungCap: string | null;
}

const HANH_DONG_NHAP: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI: "EXTERNAL_PRICE_REFERENCES_IMPORTED",
  LICH_SU_NGOAI: "EXTERNAL_PURCHASE_HISTORY_IMPORTED",
};
const HANH_DONG_RUT: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI: "EXTERNAL_PRICE_REFERENCES_WITHDRAWN",
  LICH_SU_NGOAI: "EXTERNAL_PURCHASE_HISTORY_WITHDRAWN",
};

/**
 * Phân giải cả lô ở MỘT câu: hàng chuẩn (`NULL` nếu không có), khoá đơn vị, kết quả quy đổi khoá → đơn vị gốc tại
 * `clock_timestamp()` — cùng mốc với trigger ghi ngay sau. Lô dán: hàng chuẩn theo MÃ. Hai câu khác nhau ĐÚNG một dòng (khoá nối
 * hàng chuẩn) — viết trọn để bộ phân tích SQL (`qt3-cu-phap`) đọc được từng câu.
 */
const CAU_PHAN_GIAI_THEO_MA =
  "SELECT d.i::pg_catalog.int4 AS i, ci.id AS hang_chuan_id, k.khoa, " +
  "CASE WHEN ci.id IS NULL OR k.khoa OPERATOR(pg_catalog.=) '' THEN NULL ELSE " +
  "(SELECT q.ma FROM public.quy_doi_da_giai($1::pg_catalog.uuid, ci.id, " +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) k.khoa), k.khoa, ci.don_vi_goc, ci.don_vi_goc, " +
  "pg_catalog.clock_timestamp()) q) END AS ket_qua " +
  "FROM ROWS FROM (pg_catalog.unnest($2::pg_catalog.text[]), pg_catalog.unnest($3::pg_catalog.text[])) " +
  "WITH ORDINALITY AS d(ma_hang, don_vi, i) " +
  "LEFT JOIN public.canonical_items ci ON ci.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND ci.ma OPERATOR(pg_catalog.=) d.ma_hang " +
  "CROSS JOIN LATERAL (SELECT coalesce(" +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) public.chuoi_sach(d.don_vi)), " +
  "public.don_vi_tai($1::pg_catalog.uuid, d.don_vi, pg_catalog.clock_timestamp()), public.chuoi_sach(d.don_vi)) AS khoa) k " +
  "ORDER BY d.i";
/** Nhập tay trên trang một hàng chuẩn: hàng chuẩn theo ID (`$4`). */
const CAU_PHAN_GIAI_THEO_ID =
  "SELECT d.i::pg_catalog.int4 AS i, ci.id AS hang_chuan_id, k.khoa, " +
  "CASE WHEN ci.id IS NULL OR k.khoa OPERATOR(pg_catalog.=) '' THEN NULL ELSE " +
  "(SELECT q.ma FROM public.quy_doi_da_giai($1::pg_catalog.uuid, ci.id, " +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) k.khoa), k.khoa, ci.don_vi_goc, ci.don_vi_goc, " +
  "pg_catalog.clock_timestamp()) q) END AS ket_qua " +
  "FROM ROWS FROM (pg_catalog.unnest($2::pg_catalog.text[]), pg_catalog.unnest($3::pg_catalog.text[])) " +
  "WITH ORDINALITY AS d(ma_hang, don_vi, i) " +
  "LEFT JOIN public.canonical_items ci ON ci.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND ci.id OPERATOR(pg_catalog.=) $4::pg_catalog.uuid " +
  "CROSS JOIN LATERAL (SELECT coalesce(" +
  "(SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) public.chuoi_sach(d.don_vi)), " +
  "public.don_vi_tai($1::pg_catalog.uuid, d.don_vi, pg_catalog.clock_timestamp()), public.chuoi_sach(d.don_vi)) AS khoa) k " +
  "ORDER BY d.i";

const CAU_CHEN: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI:
    "INSERT INTO public.external_price_references (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_hieu_luc, nguon, " +
    "lo_nhap_id, tac_gia, session_id) " +
    "SELECT $1::pg_catalog.uuid, d.hang, d.gia::pg_catalog.numeric, d.don_vi, d.tien_te, d.ngay::pg_catalog.date, d.nguon, " +
    "$2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid " +
    "FROM ROWS FROM (pg_catalog.unnest($5::pg_catalog.uuid[]), pg_catalog.unnest($6::pg_catalog.text[]), " +
    "pg_catalog.unnest($7::pg_catalog.text[]), pg_catalog.unnest($8::pg_catalog.text[]), pg_catalog.unnest($9::pg_catalog.text[]), " +
    "pg_catalog.unnest($10::pg_catalog.text[])) WITH ORDINALITY AS d(hang, gia, don_vi, tien_te, ngay, nguon, i) ORDER BY d.i",
  LICH_SU_NGOAI:
    "INSERT INTO public.external_purchase_history (org_id, canonical_item_id, don_gia, don_vi, tien_te, ngay_mua, nha_cung_cap_text, " +
    "nguon, lo_nhap_id, tac_gia, session_id) " +
    "SELECT $1::pg_catalog.uuid, d.hang, d.gia::pg_catalog.numeric, d.don_vi, d.tien_te, d.ngay::pg_catalog.date, d.ncc, d.nguon, " +
    "$2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid " +
    "FROM ROWS FROM (pg_catalog.unnest($5::pg_catalog.uuid[]), pg_catalog.unnest($6::pg_catalog.text[]), " +
    "pg_catalog.unnest($7::pg_catalog.text[]), pg_catalog.unnest($8::pg_catalog.text[]), pg_catalog.unnest($9::pg_catalog.text[]), " +
    "pg_catalog.unnest($10::pg_catalog.text[]), pg_catalog.unnest($11::pg_catalog.text[])) " +
    "WITH ORDINALITY AS d(hang, gia, don_vi, tien_te, ngay, nguon, ncc, i) " +
    "ORDER BY d.i",
};

/** Hàng dữ liệu CÒN HIỆU LỰC của một hàng hay một lô — không hàng rút nào trỏ về nó. */
const CAU_CON_HIEU_LUC: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI:
    "SELECT h.id FROM public.external_price_references h " +
    "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND h.rut_cua IS NULL " +
    "AND (h.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid OR h.lo_nhap_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid) " +
    "AND NOT EXISTS (SELECT 1 FROM public.external_price_references r " +
    "WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id AND r.rut_cua OPERATOR(pg_catalog.=) h.id) ORDER BY h.seq",
  LICH_SU_NGOAI:
    "SELECT h.id FROM public.external_purchase_history h " +
    "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND h.rut_cua IS NULL " +
    "AND (h.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid OR h.lo_nhap_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid) " +
    "AND NOT EXISTS (SELECT 1 FROM public.external_purchase_history r " +
    "WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id AND r.rut_cua OPERATOR(pg_catalog.=) h.id) ORDER BY h.seq",
};

const CAU_RUT: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI:
    "INSERT INTO public.external_price_references (org_id, rut_cua, tac_gia, session_id) " +
    "SELECT $1::pg_catalog.uuid, d.id, $3::pg_catalog.uuid, $4::pg_catalog.uuid " +
    "FROM pg_catalog.unnest($2::pg_catalog.uuid[]) WITH ORDINALITY AS d(id, i) ORDER BY d.i",
  LICH_SU_NGOAI:
    "INSERT INTO public.external_purchase_history (org_id, rut_cua, tac_gia, session_id) " +
    "SELECT $1::pg_catalog.uuid, d.id, $3::pg_catalog.uuid, $4::pg_catalog.uuid " +
    "FROM pg_catalog.unnest($2::pg_catalog.uuid[]) WITH ORDINALITY AS d(id, i) ORDER BY d.i",
};

/** Phân giải và ghi một lô đã đọc. Lỗi theo dòng thì trả `nhan: false`, không ghi gì. */
async function ghiLo(
  client: pg.PoolClient,
  orgId: string,
  loai: LoaiDuLieuNgoai,
  dong: readonly DongNgoaiDaDoc[],
  cachNhap: CachNhapNgoai,
  actor: Awaited<ReturnType<typeof resolveSessionActor>>,
  hangChuanCoDinh: string | null,
): Promise<KetQuaNhapNgoai> {
  const { rows } = await client.query<{ i: number; hang_chuan_id: string | null; khoa: string; ket_qua: string | null }>(
    hangChuanCoDinh === null ? CAU_PHAN_GIAI_THEO_MA : CAU_PHAN_GIAI_THEO_ID,
    hangChuanCoDinh === null
      ? [orgId, dong.map((d) => d.maHang), dong.map((d) => d.donVi)]
      : [orgId, dong.map((d) => d.maHang), dong.map((d) => d.donVi), hangChuanCoDinh],
  );
  const loi: LoiDongNgoai[] = [];
  const daGiai: DongDaGiai[] = [];
  const them = (so: number, cot: string, ma: MaLoiDong): void => {
    loi.push({ dong: so, cot, ma, cau: cauLoiDong(ma) });
  };
  for (const [i, d] of dong.entries()) {
    const r = rows[i];
    if (r === undefined || r.i !== i + 1) throw new Error("câu phân giải lô trả thiếu hàng");
    if (r.hang_chuan_id === null) {
      them(d.dong, "ma_hang", "KHONG_CO_HANG_CHUAN");
      continue;
    }
    if (r.khoa === "") {
      them(d.dong, "don_vi", "DON_VI_RONG");
      continue;
    }
    if (r.ket_qua === null || r.ket_qua === "KHONG_QUY_DOI_DUOC") {
      them(d.dong, "don_vi", "DON_VI_KHONG_QUY_DOI_DUOC");
      continue;
    }
    daGiai.push({
      hangChuanId: r.hang_chuan_id,
      donGia: d.donGia,
      khoaDonVi: r.khoa,
      tienTe: d.tienTe,
      ngay: d.ngay,
      nguon: d.nguon,
      nhaCungCap: d.nhaCungCap,
    });
  }
  if (loi.length > 0) return { nhan: false, loai, loi };

  const loNhapId = randomUUID();
  return ghiDuLieuNen(async () => {
    const thamSo: unknown[] = [
      orgId,
      loNhapId,
      actor.id,
      actor.sessionId,
      daGiai.map((d) => d.hangChuanId),
      daGiai.map((d) => d.donGia),
      daGiai.map((d) => d.khoaDonVi),
      daGiai.map((d) => d.tienTe),
      daGiai.map((d) => d.ngay),
      daGiai.map((d) => d.nguon),
    ];
    if (loai === "LICH_SU_NGOAI") thamSo.push(daGiai.map((d) => d.nhaCungCap));
    const { rowCount } = await client.query(CAU_CHEN[loai], thamSo);
    if (rowCount !== daGiai.length) throw new Error("câu chèn lô dữ liệu ngoài ghi thiếu hàng");
    const soHangChuan = new Set(daGiai.map((d) => d.hangChuanId)).size;
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: HANH_DONG_NHAP[loai],
      resourceType: "external_data_batch",
      resourceId: loNhapId,
      payload: { loai, cachNhap, soDong: daGiai.length, soHangChuan },
    });
    return { nhan: true, loai, loNhapId, soDong: daGiai.length, soHangChuan };
  });
}

export interface NhapDuLieuNgoaiInput {
  readonly loai: LoaiDuLieuNgoai;
  /** Văn bản dán vào ô — CSV hay TSV có dòng tiêu đề (`csv-ngoai.ts`). */
  readonly vanBan: string;
  readonly actorSessionId: string;
}

/** Nhập một lô bằng văn bản dán. Lô tất-cả-hoặc-không: lỗi ở bất kỳ dòng nào ⇒ `nhan: false` kèm MỌI lỗi, không ghi gì. */
export async function nhapDuLieuNgoai(client: pg.PoolClient, orgId: string, input: NhapDuLieuNgoaiInput): Promise<KetQuaNhapNgoai> {
  await assertTenantBound(client, orgId, "nhapDuLieuNgoai");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const doc = docCsvNgoai(input.loai, input.vanBan);
  if (!doc.hopLe) return { nhan: false, loai: input.loai, loi: doc.loi };
  return ghiLo(client, orgId, input.loai, doc.dong, "DAN_CSV", actor, null);
}

export interface KhaiMocNgoaiInput {
  readonly hangChuanId: string;
  /** Chuỗi thập phân — không qua `number` (ADR-053 ⑴). */
  readonly donGia: string;
  readonly donVi: string;
  readonly tienTe: string;
  /** `YYYY-MM-DD` hoặc `DD/MM/YYYY`. */
  readonly ngayHieuLuc: string;
  readonly nguon: string;
  readonly actorSessionId: string;
}

/** Nhập TAY một mốc ngoài của một hàng chuẩn — một lô một dòng. Sai hình dạng ⇒ `DuLieuNenError` có mã. */
export async function khaiMocNgoai(
  client: pg.PoolClient,
  orgId: string,
  input: KhaiMocNgoaiInput,
): Promise<{ readonly loNhapId: string }> {
  await assertTenantBound(client, orgId, "khaiMocNgoai");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const donGia = input.donGia.trim();
  if (!laDonGia(donGia)) throw new DuLieuNenError("DON_GIA_SAI_HINH_DANG", `${cauLoiDong("DON_GIA_SAI_HINH_DANG")} (DON_GIA_SAI_HINH_DANG)`);
  const tienTe = input.tienTe.trim().toUpperCase();
  if (tienTe !== "VND" && tienTe !== "USD") throw new DuLieuNenError("TIEN_TE_SAI", `${cauLoiDong("TIEN_TE_SAI")} (TIEN_TE_SAI)`);
  const ngay = docNgay(input.ngayHieuLuc.trim());
  if (ngay === null) throw new DuLieuNenError("NGAY_SAI_HINH_DANG", `${cauLoiDong("NGAY_SAI_HINH_DANG")} (NGAY_SAI_HINH_DANG)`);
  const nguon = input.nguon.trim();
  if (nguon.length < 1 || nguon.length > 500) {
    throw new DuLieuNenError("NGUON_SAI_HINH_DANG", `${cauLoiDong("NGUON_SAI_HINH_DANG")} (NGUON_SAI_HINH_DANG)`);
  }
  const kq = await ghiLo(
    client,
    orgId,
    "MOC_NGOAI",
    [{ dong: 1, maHang: "", donGia, donVi: input.donVi.trim(), tienTe, ngay, nguon, nhaCungCap: null }],
    "TAY",
    actor,
    input.hangChuanId,
  );
  if (!kq.nhan) {
    const ma = kq.loi[0]!.ma;
    const maLoi: DuLieuNenError["ma"] = ma === "KHONG_CO_HANG_CHUAN" ? "KHONG_CO_HANG_CHUAN" : ma === "DON_VI_RONG" ? "CHUOI_RONG" : "DON_VI_KHONG_QUY_DOI_DUOC";
    throw new DuLieuNenError(maLoi, `${kq.loi[0]!.cau} (${maLoi})`);
  }
  return { loNhapId: kq.loNhapId };
}

export interface RutDuLieuNgoaiInput {
  readonly loai: LoaiDuLieuNgoai;
  /** Rút đúng một hàng — hoặc… */
  readonly hangId?: string;
  /** …mọi hàng còn hiệu lực của một lô. Đúng một trong hai. */
  readonly loNhapId?: string;
  readonly actorSessionId: string;
}

/** Rút một hàng hay cả lô: mỗi hàng còn hiệu lực một hàng rút; một hàng sổ. Không còn gì để rút ⇒ `KHONG_CO_HANG_DU_LIEU`. */
export async function rutDuLieuNgoai(
  client: pg.PoolClient,
  orgId: string,
  input: RutDuLieuNgoaiInput,
): Promise<{ readonly soDong: number }> {
  await assertTenantBound(client, orgId, "rutDuLieuNgoai");
  if ((input.hangId === undefined) === (input.loNhapId === undefined)) {
    throw new Error("rutDuLieuNgoai cần đúng một trong hangId, loNhapId");
  }
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const { rows } = await client.query<{ id: string }>(CAU_CON_HIEU_LUC[input.loai], [
    orgId,
    input.hangId ?? null,
    input.loNhapId ?? null,
  ]);
  if (rows.length === 0) {
    throw new DuLieuNenError("KHONG_CO_HANG_DU_LIEU", "không có hàng dữ liệu ngoài nào còn hiệu lực ở đây để rút (KHONG_CO_HANG_DU_LIEU)");
  }
  return ghiDuLieuNen(async () => {
    const { rowCount } = await client.query(CAU_RUT[input.loai], [orgId, rows.map((r) => r.id), actor.id, actor.sessionId]);
    if (rowCount !== rows.length) throw new Error("câu rút dữ liệu ngoài ghi thiếu hàng");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: HANH_DONG_RUT[input.loai],
      resourceType: input.loNhapId !== undefined ? "external_data_batch" : "external_data_row",
      resourceId: input.loNhapId ?? input.hangId!,
      payload: { loai: input.loai, soDong: rows.length },
    });
    return { soDong: rows.length };
  });
}

// ----------------------------------------------------------------------------------------------
// ĐỌC KHÔNG CỘT GIÁ — cổng `item.manage`
// ----------------------------------------------------------------------------------------------

/** Một lô đã nhập. */
export interface LoDuLieuNgoai {
  readonly loai: LoaiDuLieuNgoai;
  readonly loNhapId: string;
  readonly soDong: number;
  readonly soDongConHieuLuc: number;
  readonly soHangChuan: number;
  /** Ngày hiệu lực (mốc ngoài) hay ngày mua (lịch sử ngoài) sớm nhất và muộn nhất của lô. */
  readonly tuNgay: string;
  readonly denNgay: string;
  readonly tacGia: { readonly userId: string; readonly hoTen: string | null };
  readonly ghiLuc: Date;
}

/** Một hàng của một lô — KHÔNG đơn giá. */
export interface HangDuLieuNgoai {
  readonly id: string;
  readonly maHang: string;
  readonly donVi: string;
  readonly tienTe: string;
  readonly ngay: string;
  readonly nguon: string;
  readonly nhaCungCap: string | null;
  readonly daRut: boolean;
}

const CAU_LO =
  "SELECT 'MOC_NGOAI' AS loai, h.lo_nhap_id, pg_catalog.count(*)::pg_catalog.int4 AS so_dong, " +
  "pg_catalog.count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.external_price_references r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id AND r.rut_cua OPERATOR(pg_catalog.=) h.id))::pg_catalog.int4 AS so_con, " +
  "pg_catalog.count(DISTINCT h.canonical_item_id)::pg_catalog.int4 AS so_hang, " +
  "pg_catalog.min(h.ngay_hieu_luc)::pg_catalog.text AS tu_ngay, pg_catalog.max(h.ngay_hieu_luc)::pg_catalog.text AS den_ngay, " +
  "pg_catalog.min(h.tac_gia::pg_catalog.text) AS tac_gia, pg_catalog.min(h.ghi_luc) AS ghi_luc " +
  "FROM public.external_price_references h " +
  "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND h.rut_cua IS NULL GROUP BY h.lo_nhap_id " +
  "UNION ALL " +
  "SELECT 'LICH_SU_NGOAI', h.lo_nhap_id, pg_catalog.count(*)::pg_catalog.int4, " +
  "pg_catalog.count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.external_purchase_history r " +
  "WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id AND r.rut_cua OPERATOR(pg_catalog.=) h.id))::pg_catalog.int4, " +
  "pg_catalog.count(DISTINCT h.canonical_item_id)::pg_catalog.int4, " +
  "pg_catalog.min(h.ngay_mua)::pg_catalog.text, pg_catalog.max(h.ngay_mua)::pg_catalog.text, " +
  "pg_catalog.min(h.tac_gia::pg_catalog.text), pg_catalog.min(h.ghi_luc) " +
  "FROM public.external_purchase_history h " +
  "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND h.rut_cua IS NULL GROUP BY h.lo_nhap_id " +
  "ORDER BY ghi_luc DESC LIMIT 200";

const CAU_HANG_CUA_LO: Readonly<Record<LoaiDuLieuNgoai, string>> = {
  MOC_NGOAI:
    "SELECT h.id, ci.ma AS ma_hang, h.don_vi, h.tien_te, h.ngay_hieu_luc::pg_catalog.text AS ngay, h.nguon, " +
    "NULL::pg_catalog.text AS nha_cung_cap, EXISTS (SELECT 1 FROM public.external_price_references r " +
    "WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id AND r.rut_cua OPERATOR(pg_catalog.=) h.id) AS da_rut " +
    "FROM public.external_price_references h JOIN public.canonical_items ci " +
    "ON ci.org_id OPERATOR(pg_catalog.=) h.org_id AND ci.id OPERATOR(pg_catalog.=) h.canonical_item_id " +
    "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND h.lo_nhap_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid ORDER BY h.seq",
  LICH_SU_NGOAI:
    "SELECT h.id, ci.ma AS ma_hang, h.don_vi, h.tien_te, h.ngay_mua::pg_catalog.text AS ngay, h.nguon, " +
    "h.nha_cung_cap_text AS nha_cung_cap, EXISTS (SELECT 1 FROM public.external_purchase_history r " +
    "WHERE r.org_id OPERATOR(pg_catalog.=) h.org_id AND r.rut_cua OPERATOR(pg_catalog.=) h.id) AS da_rut " +
    "FROM public.external_purchase_history h JOIN public.canonical_items ci " +
    "ON ci.org_id OPERATOR(pg_catalog.=) h.org_id AND ci.id OPERATOR(pg_catalog.=) h.canonical_item_id " +
    "WHERE h.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND h.lo_nhap_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid ORDER BY h.seq",
};

/** Hai trăm lô gần nhất của cả hai bảng, mới nhất trước — không một con số giá nào. */
export async function lietKeLoDuLieuNgoai(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<readonly LoDuLieuNgoai[]> {
  await assertTenantBound(client, orgId, "lietKeLoDuLieuNgoai");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.ITEM_MANAGE, resourceType: "EXTERNAL_DATA_BATCH" },
    auditPool,
  );
  const { rows } = await client.query<{
    loai: LoaiDuLieuNgoai;
    lo_nhap_id: string;
    so_dong: number;
    so_con: number;
    so_hang: number;
    tu_ngay: string;
    den_ngay: string;
    tac_gia: string;
    ghi_luc: Date;
  }>(CAU_LO, [orgId]);
  const ten = new Map<string, string | null>();
  const nguoi = [...new Set(rows.map((r) => r.tac_gia))];
  if (nguoi.length > 0) {
    const { rows: u } = await client.query<{ id: string; full_name: string | null }>(
      "SELECT u.id::pg_catalog.text AS id, u.full_name FROM public.users u " +
        "WHERE u.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND u.id OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.uuid[])",
      [orgId, nguoi],
    );
    for (const x of u) ten.set(x.id, x.full_name);
  }
  return rows.map((r) => ({
    loai: r.loai,
    loNhapId: r.lo_nhap_id,
    soDong: r.so_dong,
    soDongConHieuLuc: r.so_con,
    soHangChuan: r.so_hang,
    tuNgay: r.tu_ngay,
    denNgay: r.den_ngay,
    tacGia: { userId: r.tac_gia, hoTen: ten.get(r.tac_gia) ?? null },
    ghiLuc: r.ghi_luc,
  }));
}

/** Các hàng của một lô — không đơn giá. `null` khi lô không có trong tổ chức (sau cổng quyền). */
export async function docLoDuLieuNgoai(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly loai: LoaiDuLieuNgoai; readonly loNhapId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<{ readonly loai: LoaiDuLieuNgoai; readonly loNhapId: string; readonly hang: readonly HangDuLieuNgoai[] } | null> {
  await assertTenantBound(client, orgId, "docLoDuLieuNgoai");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.ITEM_MANAGE, resourceType: "EXTERNAL_DATA_BATCH", resourceId: input.loNhapId },
    auditPool,
  );
  const { rows } = await client.query<{
    id: string;
    ma_hang: string;
    don_vi: string;
    tien_te: string;
    ngay: string;
    nguon: string;
    nha_cung_cap: string | null;
    da_rut: boolean;
  }>(CAU_HANG_CUA_LO[input.loai], [orgId, input.loNhapId]);
  if (rows.length === 0) return null;
  return {
    loai: input.loai,
    loNhapId: input.loNhapId,
    hang: rows.map((r) => ({
      id: r.id,
      maHang: r.ma_hang,
      donVi: r.don_vi,
      tienTe: r.tien_te,
      ngay: r.ngay,
      nguon: r.nguon,
      nhaCungCap: r.nha_cung_cap,
      daRut: r.da_rut,
    })),
  };
}
