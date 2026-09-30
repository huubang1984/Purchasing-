// [S1.204 / S4.3a] Chuẩn hoá và ánh xạ hạng mục sang hàng chuẩn (spec S4 §4.4, §5.1 L2 · L3 · L13; §2.5 ⒁ ⒂).
//
// Ba đường GHI, mọi đường cùng khuôn `hang-chuan.ts` — tenant đã gắn, tác giả dẫn xuất từ phiên, một hàng sổ kiểm toán trong
// CÙNG giao dịch, lần từ chối của CSDL thành `DuLieuNenError` có mã:
//   ⑴ `chuanHoaGoi` — một lượt chuẩn hoá cho mọi dòng CHƯA có ánh xạ hiệu lực của một gói đã rời DRAFT. Dòng mà chuỗi đã làm
//      sạch trùng một bí danh còn hiệu lực → `TU_DONG`; dòng còn lại → một hàng gợi ý (`GOI_Y`/`CAN_DUYET`) do lõi thuần tính.
//      Người gọi là người nộp duyệt (S4.3b chạy lượt này SAU lần nộp, giao dịch riêng) hoặc người quản lý dữ liệu (chuẩn hoá
//      hồi tố). Trên gói đã có bản rõ, CSDL chỉ nhận người giữ `item.manage`, và `TU_DONG` mang mã `CHUAN_HOA_HOI_TO`.
//   ⑵ `ghiAnhXa` — người quản lý dữ liệu DUYỆT một dòng sang một hàng chuẩn, hoặc BÁC (hàng chuẩn `NULL` = *"không có hàng
//      chuẩn tương ứng"*); tuỳ chọn khai bí danh cho chính chuỗi ấy trong cùng giao dịch, để hàng đợi *học*.
//   ⑶ `taoHangChuanVaAnhXa` — tạo một hàng chuẩn mới rồi duyệt dòng sang nó.
//   Hai thao tác còn lại của hàng đợi (V2.1 §14) là hàm đã có của S4.2a: sửa thuộc tính = `taoPhienBanHangChuan`, khai bí danh =
//   `khaiBiDanhHang`; sau đó một lượt `chuanHoaGoi` biến dòng khớp bí danh thành `TU_DONG`.
//
// Hàng HIỆU LỰC của một dòng là hàng mới nhất theo `seq` trong những hàng có `hang_muc_bam` bằng băm HIỆN TẠI của dòng —
// gói về DRAFT và sửa dòng thì ánh xạ và gợi ý cũ tự thôi (khuôn C-1 của `011`).
//
// Làm sạch chuỗi chỉ ở SQL (`chuoi_sach`); lõi TypeScript nhận chuỗi đã sạch (§2.5 ⒄).
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";
import { PHIEN_BAN_BO_CHUAN_HOA, chuanHoa, type KetQuaChuanHoa, type UngVienHangChuan } from "./chuan-hoa.js";
import { DuLieuNenError, ghiDuLieuNen, khaiBiDanhHang, taoHangChuan, type TaoHangChuanInput } from "./hang-chuan.js";

/** Mã lý do cố định của `TU_DONG` trên gói đã có bản rõ (§2.5 ⒂). */
export const LY_DO_CHUAN_HOA_HOI_TO = "CHUAN_HOA_HOI_TO";

/** Trần của hàng đợi — khuôn `lietKeHangChuan`: `router.ts` không đọc query (E6), nên không phân trang ở máy chủ. */
const TRAN_HANG_DOI = 500;

/**
 * Khoá tư vấn của bí danh trong tổ chức — ĐÚNG khoá `du_lieu_nen_dat_thu_tu` giữ khi ghi `item_aliases`, và khoá đầu tiên
 * trigger `…_bat_bien` của hai bảng mới lấy. Hàm gói lấy nó trước cả phép đọc: quyết định `TU_DONG` đọc bí danh dưới đúng khoá
 * mà CSDL kiểm lại, và mọi giao dịch của tầng này khoá bí danh TRƯỚC mọi bảng khác (không vòng chờ).
 */
async function khoaBiDanh(client: pg.PoolClient, orgId: string): Promise<void> {
  await client.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('item_aliases|' OPERATOR(pg_catalog.||) $1::pg_catalog.text, 3))",
    [orgId],
  );
}

/**
 * Gói phải có trong tổ chức và đã rời DRAFT — cùng câu hỏi trigger hỏi, hỏi trước để lượt rỗng không để lại hàng sổ. Khoá hàng gói
 * `FOR SHARE` ngay đây, TRƯỚC mọi lần ghi sổ của giao dịch (khoản 126: khoá hàng trước, khoá tư vấn ghi sổ sau): worker mở thầu và
 * mọi cạnh trạng thái khoá hàng gói rồi mới ghi sổ, nên một hàm ở đây ghi sổ trước (khai bí danh, tạo hàng chuẩn) rồi mới chờ hàng
 * gói ở trigger là một vòng chờ. Cùng khoá ấy giữ cho phép đọc *"gói đã có bản rõ chưa"* ở dưới không đổi tới hết giao dịch.
 */
async function kiemGoiDaNop(client: pg.PoolClient, orgId: string, rfqId: string): Promise<void> {
  const { rows } = await client.query<{ status: string }>(
    "SELECT p.status FROM public.rfq_packages p WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid FOR SHARE",
    [orgId, rfqId],
  );
  const status = rows[0]?.status;
  if (status === undefined || status === "DRAFT") {
    throw new DuLieuNenError("GOI_CON_SOAN", "gói còn soạn thảo — chỉ ánh xạ hạng mục của gói đã nộp duyệt (GOI_CON_SOAN)");
  }
}

async function goiCoBanRo(client: pg.PoolClient, orgId: string, rfqId: string): Promise<boolean> {
  const { rows } = await client.query<{ co: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM public.rfq_unsealed_bids ub " +
      "JOIN public.unseal_requests ur ON ur.org_id OPERATOR(pg_catalog.=) ub.org_id AND ur.id OPERATOR(pg_catalog.=) ub.unseal_request_id " +
      "WHERE ur.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND ur.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid) AS co",
    [orgId, rfqId],
  );
  return rows[0]?.co === true;
}

/** Tập ứng viên: mọi hàng chuẩn ĐANG DÙNG (phiên bản mới nhất), kèm bí danh còn hiệu lực — mọi chuỗi đã sạch sẵn. */
async function docTapUngVien(client: pg.PoolClient, orgId: string): Promise<UngVienHangChuan[]> {
  const { rows } = await client.query<{
    id: string;
    ma: string;
    ten_sach: string;
    thuoc_tinh: Record<string, string>;
    thuoc_tinh_trong_yeu: string[];
    bi_danh: string[];
  }>(
    "WITH v AS (SELECT DISTINCT ON (v.canonical_item_id) v.canonical_item_id, v.ten, v.thuoc_tinh, v.thuoc_tinh_trong_yeu, v.trang_thai " +
      "FROM public.canonical_item_versions v WHERE v.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "ORDER BY v.canonical_item_id, v.seq DESC) " +
      "SELECT i.id, i.ma, public.chuoi_sach(v.ten) AS ten_sach, v.thuoc_tinh, v.thuoc_tinh_trong_yeu, " +
      "coalesce((SELECT pg_catalog.array_agg(x.bi_danh_sach ORDER BY x.bi_danh_sach) FROM (" +
      "SELECT DISTINCT ON (a.bi_danh_sach) a.bi_danh_sach, a.canonical_item_id, a.rut FROM public.item_aliases a " +
      "WHERE a.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid ORDER BY a.bi_danh_sach, a.seq DESC) x " +
      "WHERE x.canonical_item_id OPERATOR(pg_catalog.=) i.id AND NOT x.rut), '{}') AS bi_danh " +
      "FROM public.canonical_items i JOIN v ON v.canonical_item_id OPERATOR(pg_catalog.=) i.id " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND v.trang_thai OPERATOR(pg_catalog.=) 'DANG_DUNG' " +
      "ORDER BY i.ma",
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    ma: r.ma,
    tenSach: r.ten_sach,
    biDanhSach: r.bi_danh,
    thuocTinh: r.thuoc_tinh,
    thuocTinhTrongYeu: r.thuoc_tinh_trong_yeu,
  }));
}

interface DongGoi {
  readonly line_no: number;
  readonly sach: string;
  readonly da_co: boolean;
  readonly hang_bi_danh: string | null;
  readonly tac_gia_bi_danh: string | null;
}

/** Mọi dòng của gói: chuỗi đã sạch, đã có ánh xạ hiệu lực chưa, bí danh còn hiệu lực (nếu có) trỏ về hàng nào. */
async function docDongGoi(client: pg.PoolClient, orgId: string, rfqId: string): Promise<DongGoi[]> {
  const { rows } = await client.query<DongGoi>(
    "SELECT i.line_no, public.chuoi_sach(i.description) AS sach, " +
      "EXISTS (SELECT 1 FROM public.rfq_item_mappings m WHERE m.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND m.rfq_id OPERATOR(pg_catalog.=) i.rfq_id AND m.line_no OPERATOR(pg_catalog.=) i.line_no " +
      "AND m.hang_muc_bam OPERATOR(pg_catalog.=) public.rfq_hang_muc_bam(i.org_id, i.rfq_id, i.line_no)) AS da_co, " +
      "a.hang_bi_danh, a.tac_gia_bi_danh " +
      "FROM public.rfq_items i LEFT JOIN LATERAL (" +
      "SELECT CASE WHEN a.rut THEN NULL ELSE a.canonical_item_id END AS hang_bi_danh, a.tac_gia AS tac_gia_bi_danh " +
      "FROM public.item_aliases a WHERE a.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND a.bi_danh_sach OPERATOR(pg_catalog.=) public.chuoi_sach(i.description) ORDER BY a.seq DESC LIMIT 1) a ON true " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND i.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY i.line_no",
    [orgId, rfqId],
  );
  return rows;
}

async function docTapLoaiTru(client: pg.PoolClient, orgId: string, rfqId: string): Promise<Set<string>> {
  const { rows } = await client.query<{ n: string }>(
    "SELECT public.rfq_tap_loai_tru($1::pg_catalog.uuid, $2::pg_catalog.uuid) AS n",
    [orgId, rfqId],
  );
  return new Set(rows.map((r) => r.n));
}

/**
 * Ghi một hàng gợi ý cho dòng, trừ khi gợi ý mới nhất (đúng băm, đúng phiên bản) đã y hệt. Trả `true` khi đã ghi. Dùng chung cho
 * lượt chuẩn hoá và cho lần duyệt: luật ⒁ của CSDL đọc gợi ý đã LƯU, nên lần duyệt ghi kết quả vừa tính trước khi ghi ánh xạ.
 */
async function ghiGoiY(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  lineNo: number,
  sach: string,
  k: KetQuaChuanHoa,
  actor: { readonly id: string; readonly sessionId: string },
): Promise<boolean> {
  const dauVao = JSON.stringify(dauVaoGoiY(sach, k));
  const { rows: cu } = await client.query<{ giong: boolean }>(
    "SELECT g.ket_qua OPERATOR(pg_catalog.=) $4::pg_catalog.text AND g.dau_vao OPERATOR(pg_catalog.=) $5::pg_catalog.jsonb AS giong " +
      "FROM public.rfq_item_goi_y g WHERE g.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "AND g.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid AND g.line_no OPERATOR(pg_catalog.=) $3::pg_catalog.int4 " +
      "AND g.hang_muc_bam OPERATOR(pg_catalog.=) public.rfq_hang_muc_bam($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.int4) " +
      "AND g.phien_ban_bo_chuan_hoa OPERATOR(pg_catalog.=) $6::pg_catalog.int4 ORDER BY g.seq DESC LIMIT 1",
    [orgId, rfqId, lineNo, k.ketQua, dauVao, k.phienBan],
  );
  if (cu[0]?.giong === true) return false;
  await client.query(
    "INSERT INTO public.rfq_item_goi_y (org_id, rfq_id, line_no, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, " +
      "tac_gia, session_id) VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.int4, $4::pg_catalog.text, " +
      "$5::pg_catalog.numeric, $6::pg_catalog.int4, $7::pg_catalog.jsonb, $8::pg_catalog.uuid, $9::pg_catalog.uuid)",
    [orgId, rfqId, lineNo, k.ketQua, String(k.doTinCay), k.phienBan, dauVao, actor.id, actor.sessionId],
  );
  return true;
}

function dauVaoGoiY(sach: string, k: KetQuaChuanHoa): Record<string, unknown> {
  return { chuoiSach: sach, thuocTinh: k.thuocTinh, ungVien: k.ungVien };
}

export interface KetQuaLuotChuanHoa {
  readonly phienBan: number;
  /** Dòng vừa nhận ánh xạ `TU_DONG`. */
  readonly tuDong: number;
  /** Dòng vừa nhận một hàng gợi ý mới, theo kết quả. */
  readonly goiY: number;
  readonly canDuyet: number;
  /** Dòng đã có ánh xạ hiệu lực — không đụng. */
  readonly daCo: number;
  /** Dòng mà gợi ý mới nhất đã y hệt — không ghi thêm hàng trùng. */
  readonly khongDoi: number;
}

/**
 * Một lượt chuẩn hoá cho một gói (⑴ ở đầu tệp). Lượt chạy lại được: dòng đã có ánh xạ hiệu lực không đụng; dòng mà gợi ý mới
 * nhất (đúng băm, đúng phiên bản) đã y hệt thì không ghi thêm.
 */
export async function chuanHoaGoi(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actorSessionId: string },
): Promise<KetQuaLuotChuanHoa> {
  await assertTenantBound(client, orgId, "chuanHoaGoi");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await khoaBiDanh(client, orgId);
  await kiemGoiDaNop(client, orgId, input.rfqId);
  const coBanRo = await goiCoBanRo(client, orgId, input.rfqId);
  const loaiTru = await docTapLoaiTru(client, orgId, input.rfqId);
  // Bí danh do một người TRONG tập loại trừ khai không tự động ánh xạ được (trigger từ chối): dòng ấy đi đường gợi ý.
  const dong = (await docDongGoi(client, orgId, input.rfqId)).map((d) =>
    d.tac_gia_bi_danh !== null && loaiTru.has(d.tac_gia_bi_danh) ? { ...d, hang_bi_danh: null } : d,
  );
  const tap = dong.some((d) => !d.da_co && d.hang_bi_danh === null) ? await docTapUngVien(client, orgId) : [];

  let tuDong = 0;
  let goiY = 0;
  let canDuyet = 0;
  let daCo = 0;
  let khongDoi = 0;
  await ghiDuLieuNen(async () => {
    for (const d of dong) {
      if (d.da_co) {
        daCo++;
        continue;
      }
      if (d.hang_bi_danh !== null) {
        await client.query(
          "INSERT INTO public.rfq_item_mappings (org_id, rfq_id, line_no, nguon, canonical_item_id, do_tin_cay, " +
            "phien_ban_bo_chuan_hoa, dau_vao, ly_do, tac_gia, session_id) VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, " +
            "$3::pg_catalog.int4, 'TU_DONG', $4::pg_catalog.uuid, 1, $5::pg_catalog.int4, $6::pg_catalog.jsonb, $7::pg_catalog.text, " +
            "$8::pg_catalog.uuid, $9::pg_catalog.uuid)",
          [
            orgId,
            input.rfqId,
            d.line_no,
            d.hang_bi_danh,
            PHIEN_BAN_BO_CHUAN_HOA,
            JSON.stringify({ chuoiSach: d.sach, biDanhSach: d.sach }),
            coBanRo ? LY_DO_CHUAN_HOA_HOI_TO : null,
            actor.id,
            actor.sessionId,
          ],
        );
        tuDong++;
        continue;
      }
      const k = chuanHoa(d.sach, tap);
      if (!(await ghiGoiY(client, orgId, input.rfqId, d.line_no, d.sach, k, actor))) {
        khongDoi++;
        continue;
      }
      if (k.ketQua === "GOI_Y") goiY++;
      else canDuyet++;
    }
  });

  const ketQua = { phienBan: PHIEN_BAN_BO_CHUAN_HOA, tuDong, goiY, canDuyet, daCo, khongDoi };
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_ITEMS_NORMALIZED",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    payload: { ...ketQua, hoiTo: coBanRo },
  });
  return ketQua;
}

/**
 * [S1.9101 / S4.3b / ADR-9201] Lượt chuẩn hoá SAU lần nộp duyệt (spec §4.4) — route nộp duyệt đăng ký nó chạy sau commit, trong một
 * giao dịch riêng, dưới phiên người nộp. Chỉ chạy ở tổ chức có ít nhất MỘT hàng chuẩn đang dùng: tổ chức chưa khai gì chạy đúng hành vi
 * hôm nay (spec §2.3) — không hàng gợi ý, không hàng sổ, và cụm test MVP1 xanh nguyên văn. Trả `null` khi không chạy.
 */
export async function chuanHoaSauNop(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actorSessionId: string },
): Promise<KetQuaLuotChuanHoa | null> {
  await assertTenantBound(client, orgId, "chuanHoaSauNop");
  const { rows } = await client.query<{ co: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM public.canonical_items i WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "AND (SELECT v.trang_thai FROM public.canonical_item_versions v WHERE v.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND v.canonical_item_id OPERATOR(pg_catalog.=) i.id ORDER BY v.seq DESC LIMIT 1) OPERATOR(pg_catalog.=) 'DANG_DUNG') AS co",
    [orgId],
  );
  if (rows[0]?.co !== true) return null;
  return chuanHoaGoi(client, orgId, input);
}

export interface GhiAnhXaInput {
  readonly rfqId: string;
  readonly lineNo: number;
  /** `null` = BÁC: *"không có hàng chuẩn tương ứng"* — quyết định tường minh, khác với chưa ánh xạ. */
  readonly hangChuanId: string | null;
  /** Bắt buộc khi gói đã có bản rõ (L13), và khi bác một dòng đã từng có gợi ý `GOI_Y` (§2.5 ⒁). */
  readonly lyDo?: string | null;
  /** Khai chuỗi đã làm sạch của dòng thành bí danh của hàng chuẩn ấy, cùng giao dịch — hàng đợi *học*. */
  readonly taoBiDanh?: boolean;
  readonly actorSessionId: string;
}

/**
 * Người quản lý dữ liệu duyệt hoặc bác một dòng (⑵ ở đầu tệp). CSDL là lớp chặn: người ghi giữ `item.manage` và nằm ngoài tập
 * loại trừ của gói (L3), lý do khi gói đã có bản rõ (L13). `dau_vao` là kết quả của lõi dưới bộ luật hiện hành, tính lại ngay
 * lúc duyệt — đủ để một lượt kiểm toán sau đọc *"ánh xạ dòng này sang D32 trong khi mô tả ghi D10"* (§8.2).
 */
export async function ghiAnhXa(
  client: pg.PoolClient,
  orgId: string,
  input: GhiAnhXaInput,
): Promise<{ readonly seq: string }> {
  await assertTenantBound(client, orgId, "ghiAnhXa");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await khoaBiDanh(client, orgId);
  await kiemGoiDaNop(client, orgId, input.rfqId);
  const { rows: dongRows } = await client.query<{ sach: string }>(
    "SELECT public.chuoi_sach(i.description) AS sach FROM public.rfq_items i " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND i.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "AND i.line_no OPERATOR(pg_catalog.=) $3::pg_catalog.int4",
    [orgId, input.rfqId, input.lineNo],
  );
  const sach = dongRows[0]?.sach;
  if (sach === undefined) throw new DuLieuNenError("KHONG_CO_HANG_MUC", "gói không có dòng này (KHONG_CO_HANG_MUC)");
  const k = chuanHoa(sach, await docTapUngVien(client, orgId));
  const doTinCay = input.hangChuanId === null ? null : (k.ungVien.find((u) => u.hangChuanId === input.hangChuanId)?.diem ?? null);

  return ghiDuLieuNen(async () => {
    // Kết quả vừa tính vào bảng gợi ý TRƯỚC ánh xạ: luật ⒁ của CSDL đọc gợi ý đã lưu, và một lần bác trên dòng chưa qua lượt
    // chuẩn hoá — hay qua lượt khi danh mục còn thiếu — phải thấy đúng điều lõi vừa nói.
    await ghiGoiY(client, orgId, input.rfqId, input.lineNo, sach, k, actor);
    if (input.taoBiDanh === true && input.hangChuanId !== null && sach !== "") {
      await khaiBiDanhHang(client, orgId, { hangChuanId: input.hangChuanId, biDanh: sach, actorSessionId: input.actorSessionId });
    }
    const hang = (
      await client.query<{ seq: string }>(
        "INSERT INTO public.rfq_item_mappings (org_id, rfq_id, line_no, nguon, canonical_item_id, do_tin_cay, " +
          "phien_ban_bo_chuan_hoa, dau_vao, ly_do, tac_gia, session_id) VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, " +
          "$3::pg_catalog.int4, 'NGUOI_DUYET', $4::pg_catalog.uuid, $5::pg_catalog.numeric, $6::pg_catalog.int4, $7::pg_catalog.jsonb, " +
          "$8::pg_catalog.text, $9::pg_catalog.uuid, $10::pg_catalog.uuid) RETURNING seq::pg_catalog.text AS seq",
        [
          orgId,
          input.rfqId,
          input.lineNo,
          input.hangChuanId,
          doTinCay === null ? null : String(doTinCay),
          k.phienBan,
          JSON.stringify(dauVaoGoiY(sach, k)),
          input.lyDo ?? null,
          actor.id,
          actor.sessionId,
        ],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn rfq_item_mappings không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "RFQ_ITEM_MAPPED",
      resourceType: "rfq_package",
      resourceId: input.rfqId,
      payload: {
        lineNo: input.lineNo,
        nguon: "NGUOI_DUYET",
        hangChuanId: input.hangChuanId,
        coLyDo: input.lyDo != null,
        taoBiDanh: input.taoBiDanh === true && input.hangChuanId !== null,
        seq: hang.seq,
      },
    });
    return { seq: hang.seq };
  });
}

/** Tạo một hàng chuẩn mới rồi duyệt dòng sang nó (⑶ ở đầu tệp), trong giao dịch của người gọi. */
export async function taoHangChuanVaAnhXa(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly rfqId: string;
    readonly lineNo: number;
    readonly hangChuan: Omit<TaoHangChuanInput, "actorSessionId">;
    readonly lyDo?: string | null;
    readonly taoBiDanh?: boolean;
    readonly actorSessionId: string;
  },
): Promise<{ readonly hangChuanId: string; readonly seq: string }> {
  await assertTenantBound(client, orgId, "taoHangChuanVaAnhXa");
  await khoaBiDanh(client, orgId);
  await kiemGoiDaNop(client, orgId, input.rfqId);
  const moi = await taoHangChuan(client, orgId, { ...input.hangChuan, actorSessionId: input.actorSessionId });
  const { seq } = await ghiAnhXa(client, orgId, {
    rfqId: input.rfqId,
    lineNo: input.lineNo,
    hangChuanId: moi.id,
    lyDo: input.lyDo ?? null,
    taoBiDanh: input.taoBiDanh ?? false,
    actorSessionId: input.actorSessionId,
  });
  return { hangChuanId: moi.id, seq };
}

export interface DongHangDoi {
  readonly rfqId: string;
  readonly tieuDe: string;
  readonly lineNo: number;
  readonly moTa: string;
  readonly donVi: string;
  readonly soLuong: string;
  /** Gợi ý hiện hành (đúng băm hiện tại) — `null` khi dòng chưa qua lượt chuẩn hoá nào. */
  readonly goiY: {
    readonly ketQua: "GOI_Y" | "CAN_DUYET";
    readonly doTinCay: string;
    readonly phienBan: number;
    readonly ungVien: readonly { readonly hangChuanId: string; readonly ma: string; readonly diem: number }[];
    /** Họ tên người ghi hàng gợi ý — trước khi có bản rõ, người nộp duyệt ghi được gợi ý; người duyệt phải thấy ai đã nói. */
    readonly tacGia: string;
  } | null;
}

/**
 * Hàng đợi của người quản lý dữ liệu (spec §4.4): dòng của gói đã rời DRAFT, không huỷ, CHƯA có ánh xạ hiệu lực, kèm gợi ý hiện
 * hành. Không mang giá — chỉ mô tả, đơn vị, số lượng mà người mua đã viết. Tối đa 500 dòng, cũ trước.
 */
export async function docHangDoi(
  client: pg.PoolClient,
  orgId: string,
): Promise<{ readonly dong: readonly DongHangDoi[]; readonly conNua: boolean }> {
  await assertTenantBound(client, orgId, "docHangDoi");
  const { rows } = await client.query<{
    rfq_id: string;
    title: string;
    line_no: number;
    description: string;
    unit: string;
    quantity: string;
    ket_qua: "GOI_Y" | "CAN_DUYET" | null;
    do_tin_cay: string | null;
    phien_ban: number | null;
    dau_vao: { ungVien?: { hangChuanId: string; ma: string; diem: number }[] } | null;
    tac_gia: string | null;
  }>(
    "SELECT p.id AS rfq_id, p.title, i.line_no, i.description, i.unit, i.quantity::pg_catalog.text AS quantity, " +
      "g.ket_qua, g.do_tin_cay::pg_catalog.text AS do_tin_cay, g.phien_ban_bo_chuan_hoa AS phien_ban, g.dau_vao, g.tac_gia " +
      "FROM public.rfq_items i " +
      "JOIN public.rfq_packages p ON p.org_id OPERATOR(pg_catalog.=) i.org_id AND p.id OPERATOR(pg_catalog.=) i.rfq_id " +
      "LEFT JOIN LATERAL (SELECT g.ket_qua, g.do_tin_cay, g.phien_ban_bo_chuan_hoa, g.dau_vao, u.full_name AS tac_gia " +
      "FROM public.rfq_item_goi_y g JOIN public.users u ON u.org_id OPERATOR(pg_catalog.=) g.org_id AND u.id OPERATOR(pg_catalog.=) g.tac_gia " +
      "WHERE g.org_id OPERATOR(pg_catalog.=) i.org_id AND g.rfq_id OPERATOR(pg_catalog.=) i.rfq_id " +
      "AND g.line_no OPERATOR(pg_catalog.=) i.line_no " +
      "AND g.hang_muc_bam OPERATOR(pg_catalog.=) public.rfq_hang_muc_bam(i.org_id, i.rfq_id, i.line_no) " +
      "ORDER BY g.seq DESC LIMIT 1) g ON true " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND p.status OPERATOR(pg_catalog.<>) ALL (ARRAY['DRAFT', 'CANCELLED']) " +
      "AND NOT EXISTS (SELECT 1 FROM public.rfq_item_mappings m WHERE m.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND m.rfq_id OPERATOR(pg_catalog.=) i.rfq_id AND m.line_no OPERATOR(pg_catalog.=) i.line_no " +
      "AND m.hang_muc_bam OPERATOR(pg_catalog.=) public.rfq_hang_muc_bam(i.org_id, i.rfq_id, i.line_no)) " +
      "ORDER BY p.created_at, p.id, i.line_no LIMIT $2::pg_catalog.int4",
    [orgId, TRAN_HANG_DOI + 1],
  );
  const dong = rows.slice(0, TRAN_HANG_DOI).map(
    (r): DongHangDoi => ({
      rfqId: r.rfq_id,
      tieuDe: r.title,
      lineNo: r.line_no,
      moTa: r.description,
      donVi: r.unit,
      soLuong: r.quantity,
      goiY:
        r.ket_qua === null || r.do_tin_cay === null || r.phien_ban === null
          ? null
          : { ketQua: r.ket_qua, doTinCay: r.do_tin_cay, phienBan: r.phien_ban, ungVien: r.dau_vao?.ungVien ?? [], tacGia: r.tac_gia ?? "" },
    }),
  );
  return { dong, conNua: rows.length > TRAN_HANG_DOI };
}

export interface AnhXaDong {
  readonly lineNo: number;
  /**
   * `TU_DONG` / `NGUOI_DUYET`: có ánh xạ hiệu lực (hàng chuẩn có thể `null` = *"không có hàng chuẩn tương ứng"*).
   * `CHO_DUYET`: có gợi ý, chưa ánh xạ. `CHUA_CHUAN_HOA`: chưa qua lượt nào (hay dòng đã sửa sau lượt cuối).
   */
  readonly trangThai: "TU_DONG" | "NGUOI_DUYET" | "CHO_DUYET" | "CHUA_CHUAN_HOA";
  readonly hangChuan: { readonly id: string; readonly ma: string } | null;
  readonly lyDo: string | null;
}

/** Trạng thái ánh xạ từng dòng của một gói — màn `/tao-thau` của S4.3b đọc nó (spec §3.5). */
export async function docAnhXaGoi(client: pg.PoolClient, orgId: string, rfqId: string): Promise<readonly AnhXaDong[]> {
  await assertTenantBound(client, orgId, "docAnhXaGoi");
  const { rows } = await client.query<{
    line_no: number;
    nguon: "TU_DONG" | "NGUOI_DUYET" | null;
    canonical_item_id: string | null;
    ma: string | null;
    ly_do: string | null;
    co_goi_y: boolean;
  }>(
    "SELECT i.line_no, m.nguon, m.canonical_item_id, c.ma, m.ly_do, " +
      "EXISTS (SELECT 1 FROM public.rfq_item_goi_y g WHERE g.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND g.rfq_id OPERATOR(pg_catalog.=) i.rfq_id AND g.line_no OPERATOR(pg_catalog.=) i.line_no " +
      "AND g.hang_muc_bam OPERATOR(pg_catalog.=) public.rfq_hang_muc_bam(i.org_id, i.rfq_id, i.line_no)) AS co_goi_y " +
      "FROM public.rfq_items i " +
      "LEFT JOIN LATERAL (SELECT m.nguon, m.canonical_item_id, m.ly_do FROM public.rfq_item_mappings m " +
      "WHERE m.org_id OPERATOR(pg_catalog.=) i.org_id AND m.rfq_id OPERATOR(pg_catalog.=) i.rfq_id " +
      "AND m.line_no OPERATOR(pg_catalog.=) i.line_no " +
      "AND m.hang_muc_bam OPERATOR(pg_catalog.=) public.rfq_hang_muc_bam(i.org_id, i.rfq_id, i.line_no) " +
      "ORDER BY m.seq DESC LIMIT 1) m ON true " +
      "LEFT JOIN public.canonical_items c ON c.org_id OPERATOR(pg_catalog.=) i.org_id AND c.id OPERATOR(pg_catalog.=) m.canonical_item_id " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND i.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY i.line_no",
    [orgId, rfqId],
  );
  return rows.map((r) => ({
    lineNo: r.line_no,
    trangThai: r.nguon ?? (r.co_goi_y ? "CHO_DUYET" : "CHUA_CHUAN_HOA"),
    hangChuan: r.canonical_item_id === null || r.ma === null ? null : { id: r.canonical_item_id, ma: r.ma },
    lyDo: r.ly_do,
  }));
}
