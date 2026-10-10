// ==============================================================================================
// [S1.114 / S2.7 / ADR-059] ĐỌC MỌI THỨ BUNDLE CẦN, TỪ CƠ SỞ DỮ LIỆU — NỬA *XUẤT*
//
// ----------------------------------------------------------------------------------------------
// [mảnh 1 / màn xuất bằng chứng] VÌ SAO TỆP NÀY Ở ĐÂY, VÀ HAI ĐƯỜNG GỌI NÓ
// ----------------------------------------------------------------------------------------------
// Tệp này sinh ra ở `tools/bo-xuat-danh-gia/src/doc-tu-csdl.ts`. Vòng dựng màn xuất bằng chứng
// chuyển nó xuống gói, vì bundle nay có HAI đường xuất phải ra CÙNG byte:
//   ⑴ `pnpm bang-chung xuat` — công cụ vận hành, giữ `DATABASE_URL`, KHÔNG hỏi quyền ai;
//   ⑵ `GET /rfqs/:rfqId/evidence-bundle` của `apps/api` — dưới phiên một con người, qua
//      `xuatBoBangChung` ở cuối tệp, mang cổng quyền đứng THẲNG trong thân hàm (khoản 33).
// Cả hai gọi `dungBoBangChung`, nên việc tuần tự hoá JSON cũng nằm ở đây: hai bản `JSON.stringify`
// ở hai nơi là hai bundle có thể khác nhau một khoảng trắng, và `dacTaSha256` thì chỉ canh ĐẶC TẢ.
//
// Nửa *ĐỌC* (`docBo` và các kiểu phía người kiểm) CỐ Ý ở lại `tools/bo-xuat-danh-gia/src/bo.ts`:
// người kiểm không được mượn định nghĩa hình dạng của chính người bị kiểm. Bốn hằng số tên/phiên
// bản vì vậy có HAI bản, và `tools/bo-xuat-danh-gia/src/hang-so-khop.test.ts` đòi chúng bằng nhau.
//
// ----------------------------------------------------------------------------------------------
// MỌI LƯỢT CHẤM, KHÔNG PHẢI LƯỢT MỚI NHẤT
// ----------------------------------------------------------------------------------------------
// `docBangXepHang` (màn hình) cố ý chỉ lấy lượt chấm MỚI NHẤT, và chú thích của chính nó viết:
// *"vì sao xếp hạng đổi là một câu hỏi kiểm toán, và nó được trả lời bằng bộ xuất của S2.7"*.
// Đây là bộ xuất ấy, nên nó lấy **mọi** lượt — cũ trước mới sau.
//
// Điều đó không phải sự đầy đủ cho vui: một vòng BAFO sinh một `rfq_evaluations` THỨ HAI và hàng
// cũ ở lại nguyên vẹn (spec §4.3). Một bundle chỉ mang lượt mới nhất sẽ, sau một vòng BAFO, KHÔNG
// chứa nổi bảng xếp hạng mà một award cũ trỏ tới — và nó sẽ im lặng về chuyện ấy.
//
// ----------------------------------------------------------------------------------------------
// CHÍNH SÁCH ĐỌC THEO `policy_id` CỦA TỪNG LƯỢT, KHÔNG PHẢI BẢN MỚI NHẤT
// ----------------------------------------------------------------------------------------------
// `rfq_evaluations.policy_id` ghi ĐÚNG phiên bản đã dùng. Đọc "bản mới nhất" ở đây sẽ làm bundle
// mang một bộ trọng số KHÁC bộ đã sinh ra con số — và bộ kiểm sẽ báo LỆCH trên một hệ thống hoàn
// toàn đúng. Cùng một `he_so` dưới hai phiên bản cho hai con số; đó là cả lý do bảng ⑴ của
// ADR-059 đòi phiên bản chính sách nằm trong bundle.
//
// ----------------------------------------------------------------------------------------------
// MỌI MỐC THỜI GIAN ĐI KÈM NGUỒN
// ----------------------------------------------------------------------------------------------
// Khoản **196** (rổ A): đồng hồ cơ sở dữ liệu đã lệch 6 giờ 22 phút sau một đêm máy ngủ, và không
// lớp nào khai nguồn thời gian hay canh nó lệch. Phép tính của `DAC-TA.md` KHÔNG đọc đồng hồ, nên
// khiếm khuyết ấy không chạm được một con số nào — nhưng các mốc thời gian thì có thật trong
// bundle, và chúng đi kèm một câu nói đúng chúng đáng tin tới đâu. Ghi một mốc trần là mời người
// đọc tin vào thứ dự án chưa dám tin.
// ==============================================================================================

import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { DAC_TA, DAC_TA_PHIEN_BAN } from "./dac-ta.js";
import { docLopDuLieuNen, type DuLieuNenBundle } from "./lop-du-lieu-nen.js";

export const DANG_BUNDLE = "trustprocure/bo-bang-chung-danh-gia";
/**
 * [S1.262 / S4.5c2] `2`: thêm lớp dữ liệu nền (`duLieuNen`). Bộ kiểm chỉ đọc đúng phiên bản nó cài.
 * [S1.9101 / S4.7c2] `3`: phép quy đổi TCO tính lại được (`nguon` của mã quy đổi, `maThieu`, `goiTco`) và cam kết của mỗi đề xuất
 * trao thầu (`traoThau[].camKet`) — `DAC-TA.md` §9, §10.
 */
export const PHIEN_BAN_BUNDLE = 3;
export const TEP_DU_LIEU = "bo-bang-chung.json";
export const TEP_DAC_TA = "DAC-TA.md";

/** Một mốc thời gian, cùng NGUỒN của nó — xem khoản 196 và khối đầu tệp. */
export interface MocThoiGian {
  readonly giaTri: string;
  readonly nguon: string;
}

/** Một phần tử `eval_components` của chính sách — cách viết khoá của `057`, chép nguyên văn. */
export interface ThanhPhanChinhSachBundle {
  readonly ma: string;
  readonly don_vi: string;
  readonly he_so: string;
}

/** Một phần tử của `components` — NGUYÊN VĂN như cơ sở dữ liệu giữ. */
export interface ThanhPhanLuu {
  readonly ma: string;
  readonly donVi?: string;
  readonly heSo?: string;
  readonly giaTri?: string;
  readonly tien: string | null;
  /**
   * [S1.9101 / S4.7c2] Phép tính của mã quy đổi (`chi_phi_thanh_toan`, `chi_phi_tre`) — cơ sở, ngày khai, ngày chuẩn hay yêu cầu, tỷ
   * lệ — chép nguyên văn như lượt chấm ghi (`luot-danh-gia.ts`); vắng ở mã không quy đổi. `DAC-TA.md` §9.
   */
  readonly nguon?: Readonly<Record<string, string>>;
}

export interface HangBundle {
  readonly bidVersionId: string;
  readonly supplierName: string;
  readonly effectiveCost: string | null;
  readonly rank: number | null;
  readonly components: readonly ThanhPhanLuu[];
  /** [S1.9101 / S4.7c2] Mã thiếu ô khai của hàng không hạng (`ma_thieu`, `112`) — `null` khi hàng đủ ô. */
  readonly maThieu: readonly string[] | null;
}

export interface LuotChamBundle {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly currency: string;
  readonly chinhSachThanhPhan: readonly ThanhPhanChinhSachBundle[];
  /**
   * [S1.262 / rà soát S4.5c2] Phiên bản chính sách của lượt chấm CÓ cấu hình nhóm `benchmark` — khi ấy lớp dữ liệu nền PHẢI mang
   * lượt chấm này; bộ kiểm đỏ nếu thiếu (một bundle bỏ cả lớp không được qua như một bundle không có gì để kiểm).
   */
  readonly coBenchmark: boolean;
  readonly taoLuc: MocThoiGian;
  readonly hang: readonly HangBundle[];
}

/**
 * [S1.9101 / S4.7c2] Ảnh chụp TCO của gói lúc mở (`112` (5), `117`): tập mã và nhóm khoá `tco` của phiên bản ghim, số ngày giao yêu
 * cầu. Thước mà mọi `nguon` của mọi lượt chấm phải khớp — `DAC-TA.md` §9.
 */
export interface GoiTcoBundle {
  readonly tapMa: readonly string[] | null;
  /** Nhóm khoá `tco` nguyên văn (`chi_phi_von_nam`, `ngay_thanh_toan_chuan`, `ty_le_tre_ngay`) — `null` khi phiên bản không cấu hình. */
  readonly thamSo: Readonly<Record<string, string>> | null;
  readonly soNgayGiao: number | null;
}

/** [S1.9101 / S4.7c2] Bốn ô khai của báo giá được đề xuất, qua đúng bộ đọc của lượt chấm (`121`). */
export interface KhaiCamKetBundle {
  readonly freight: string | null;
  readonly importCost: string | null;
  readonly paymentDays: number | null;
  readonly leadTimeDays: number | null;
}

/** [S1.9101 / S4.7c2] Cam kết TCO CSDL chụp lúc đề xuất (`rfq_award_cam_ket`, `121`) — điều khoản cam kết của bộ, `DAC-TA.md` §10. */
export interface CamKetBundle {
  readonly hangTco: number;
  readonly hangGia: number | null;
  readonly effectiveCost: string;
  readonly components: readonly ThanhPhanLuu[];
  readonly khai: KhaiCamKetBundle;
  readonly tapMa: readonly string[] | null;
  readonly thamSo: Readonly<Record<string, string>> | null;
  readonly soNgayGiao: number | null;
  /** Lời giải trình lệch hạng NGUYÊN VĂN (chủ dự án chốt 2026-10-10) — sổ chỉ ghi cờ, bộ mang văn bản sau hai cổng của lần xuất. */
  readonly giaiTrinhLechHang: string | null;
  readonly chupLuc: MocThoiGian;
}

export interface TraoThauBundle {
  readonly awardId: string;
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly status: string;
  readonly reason: string;
  readonly actedAt: MocThoiGian;
  /** [S1.9101 / S4.7c2] `null` ở mọi hàng không phải đề xuất, và ở đề xuất có trước S4.7c1 (không lấp ngược). */
  readonly camKet: CamKetBundle | null;
}

export interface BoBangChung {
  readonly dang: string;
  readonly phienBan: number;
  readonly dacTaPhienBan: number;
  /** SHA-256 hex của ĐÚNG byte UTF-8 của `DAC-TA.md` đi kèm. */
  readonly dacTaSha256: string;
  readonly orgId: string;
  readonly rfqId: string;
  readonly xuatLuc: MocThoiGian;
  /** [S1.9101 / S4.7c2] Ảnh chụp TCO của gói lúc mở — `DAC-TA.md` §9. */
  readonly goiTco: GoiTcoBundle;
  /** Mọi lượt chấm của gói thầu, cũ trước mới sau — KHÔNG chỉ lượt mới nhất. */
  readonly luotCham: readonly LuotChamBundle[];
  readonly traoThau: readonly TraoThauBundle[];
  /**
   * [S1.262 / S4.5c2] Lớp dữ liệu nền — benchmark giá của mọi lượt chấm, tính lại được từ đơn giá đã quy đổi (`DAC-TA.md` §8).
   * `null` khi không lượt chấm nào có hàng benchmark (phiên bản ghim chưa cấu hình nhóm `benchmark`).
   */
  readonly duLieuNen: DuLieuNenBundle | null;
}

/** Câu đi kèm MỌI mốc thời gian đọc từ cơ sở dữ liệu. Xem khối đầu tệp và khoản 196. */
export const NGUON_DONG_HO_CSDL =
  "đồng hồ của cơ sở dữ liệu lúc ghi — nguồn thời gian CHƯA được chứng thực (khoản 196); " +
  "đủ để đối chiếu thứ tự các sự kiện trong bundle này, không đủ để phán xử đúng hạn hay quá hạn";

function moc(t: Date): MocThoiGian {
  return { giaTri: t.toISOString(), nguon: NGUON_DONG_HO_CSDL };
}

interface HangLuot {
  readonly id: string;
  readonly policy_id: string;
  readonly version: number;
  readonly currency: string;
  readonly created_at: Date;
  readonly eval_components: readonly ThanhPhanChinhSachBundle[] | null;
  readonly co_benchmark: boolean;
}

interface HangDong {
  readonly bid_version_id: string;
  readonly supplier_name: string;
  readonly effective_cost: string | null;
  readonly rank: number | null;
  readonly components: readonly Record<string, unknown>[];
  readonly ma_thieu: readonly string[] | null;
}

interface HangAward {
  readonly id: string;
  readonly evaluation_id: string;
  readonly bid_version_id: string;
  readonly status: string;
  readonly reason: string;
  readonly acted_at: Date;
  // [S1.9101 / S4.7c2] Cam kết của hàng (LEFT JOIN) — `ck_co` false khi không có.
  readonly ck_co: boolean;
  readonly ck_hang_tco: number | null;
  readonly ck_hang_gia: number | null;
  readonly ck_effective_cost: string | null;
  readonly ck_components: readonly Record<string, unknown>[] | null;
  readonly ck_khai: Record<string, unknown> | null;
  readonly ck_tap_ma: readonly string[] | null;
  readonly ck_tham_so: unknown;
  readonly ck_so_ngay_giao: number | null;
  readonly ck_giai_trinh: string | null;
  readonly ck_chup_luc: Date | null;
}

/** Một object mọi giá trị là chuỗi, chép nguyên văn — `null` khi không phải hình dạng ấy (bộ kiểm khi ấy báo thiếu, không đoán). */
function chepChuoiTheoKhoa(tho: unknown): Readonly<Record<string, string>> | null {
  if (tho === null || typeof tho !== "object" || Array.isArray(tho)) return null;
  const ra: Record<string, string> = {};
  for (const [k, v] of Object.entries(tho as Record<string, unknown>)) {
    if (typeof v !== "string") return null;
    ra[k] = v;
  }
  return ra;
}

/** Chép một phần tử `components` NGUYÊN VĂN, chỉ phán xử kiểu chứ không đổi cách viết khoá. */
function chepThanhPhan(tho: Record<string, unknown>): ThanhPhanLuu {
  const lay = (ten: string): string | undefined => {
    const gt = tho[ten];
    return typeof gt === "string" ? gt : undefined;
  };
  const tien = tho["tien"];
  // [S1.9101 / S4.7c2] `nguon` của mã quy đổi đi kèm — vắng thì KHÔNG có khoá (bundle v2 không có khoá này ở mọi hàng).
  const nguon = tho["nguon"] === undefined ? null : chepChuoiTheoKhoa(tho["nguon"]);
  return {
    ma: lay("ma") ?? "",
    donVi: lay("donVi"),
    heSo: lay("heSo"),
    giaTri: lay("giaTri"),
    tien: typeof tien === "string" ? tien : null,
    ...(nguon === null ? {} : { nguon }),
  };
}

/**
 * Mọi lượt chấm của một gói thầu, cũ trước mới sau, cùng bộ trọng số ĐÃ DÙNG cho từng lượt.
 *
 * `client` phải đã gắn tenant (`withTenant`) — hàm này không tự gắn, cùng khuôn mọi đường đọc
 * khác của kho.
 */
export async function docMoiLuotCham(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<readonly LuotChamBundle[]> {
  const { rows: luot } = await client.query<HangLuot>(
    `SELECT e.id,
            e.policy_id,
            o.version,
            e.currency,
            e.created_at,
            o.eval_components,
            (o.benchmark IS NOT NULL) AS co_benchmark
       FROM public.rfq_evaluations e
       JOIN public.org_procurement_policies o ON o.id OPERATOR(pg_catalog.=) e.policy_id
                                            AND o.org_id OPERATOR(pg_catalog.=) e.org_id
      WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND e.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY e.created_at ASC, e.id ASC`,
    [orgId, rfqId],
  );

  const ra: LuotChamBundle[] = [];
  for (const l of luot) {
    // Cùng phép nối với `docBangXepHang`: tên nhà cung cấp đi ra để người đọc bundle biết hàng
    // nào của ai mà không phải tra một bảng khác — bundle TỰ ĐỦ là điều kiện ⒜ của ADR-059.
    const { rows: dong } = await client.query<HangDong>(
      `SELECT l.bid_version_id,
              s.legal_name AS supplier_name,
              l.effective_cost::pg_catalog.text AS effective_cost,
              l.rank,
              l.components,
              l.ma_thieu
         FROM public.rfq_evaluation_lines l
         JOIN public.vendor_bid_versions v ON v.id OPERATOR(pg_catalog.=) l.bid_version_id
                                          AND v.org_id OPERATOR(pg_catalog.=) l.org_id
         JOIN public.vendor_bids b         ON b.id OPERATOR(pg_catalog.=) v.bid_id
                                          AND b.org_id OPERATOR(pg_catalog.=) v.org_id
         JOIN public.rfq_invitations i     ON i.id OPERATOR(pg_catalog.=) b.invitation_id
                                          AND i.org_id OPERATOR(pg_catalog.=) b.org_id
         JOIN public.suppliers s           ON s.id OPERATOR(pg_catalog.=) i.supplier_id
                                          AND s.org_id OPERATOR(pg_catalog.=) i.org_id
        WHERE l.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
          AND l.evaluation_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        ORDER BY l.rank ASC NULLS LAST, s.legal_name ASC`,
      [orgId, l.id],
    );
    ra.push({
      evaluationId: l.id,
      policyId: l.policy_id,
      policyVersion: l.version,
      currency: l.currency,
      chinhSachThanhPhan: (l.eval_components ?? []).map((t) => ({
        ma: t.ma,
        don_vi: t.don_vi,
        he_so: t.he_so,
      })),
      coBenchmark: l.co_benchmark,
      taoLuc: moc(l.created_at),
      hang: dong.map((d) => ({
        bidVersionId: d.bid_version_id,
        supplierName: d.supplier_name,
        effectiveCost: d.effective_cost,
        rank: d.rank,
        components: d.components.map(chepThanhPhan),
        maThieu: d.ma_thieu,
      })),
    });
  }
  return ra;
}

/**
 * Mọi hàng `rfq_awards` của một gói thầu — kể cả `CANCELLED`.
 *
 * Một lần trao thầu bị HUỶ là một sự kiện kiểm toán viên cần thấy, không phải một sự kiện cần
 * giấu: *"ai được trao, rồi vì sao đổi"* là đúng câu hỏi mà bộ bằng chứng sinh ra để trả lời.
 */
export async function docMoiTraoThau(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<readonly TraoThauBundle[]> {
  // [S1.9101 / S4.7c2] Cam kết của hàng — chỉ hàng `PROPOSED` có (`121`), và đề xuất có trước S4.7c1 thì không (không lấp ngược).
  const { rows } = await client.query<HangAward>(
    `SELECT a.id,
            a.evaluation_id,
            a.bid_version_id,
            a.status,
            a.reason,
            a.acted_at,
            (k.award_id IS NOT NULL) AS ck_co,
            k.hang_tco AS ck_hang_tco,
            k.hang_gia AS ck_hang_gia,
            k.effective_cost::pg_catalog.text AS ck_effective_cost,
            k.components AS ck_components,
            k.khai AS ck_khai,
            k.tap_ma AS ck_tap_ma,
            k.tham_so AS ck_tham_so,
            k.so_ngay_giao AS ck_so_ngay_giao,
            k.giai_trinh_lech_hang AS ck_giai_trinh,
            k.chup_luc AS ck_chup_luc
       FROM public.rfq_awards a
       LEFT JOIN public.rfq_award_cam_ket k ON k.award_id OPERATOR(pg_catalog.=) a.id
                                           AND k.org_id OPERATOR(pg_catalog.=) a.org_id
      WHERE a.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND a.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY a.acted_at ASC, a.id ASC`,
    [orgId, rfqId],
  );
  return rows.map((r) => ({
    awardId: r.id,
    evaluationId: r.evaluation_id,
    bidVersionId: r.bid_version_id,
    status: r.status,
    reason: r.reason,
    actedAt: moc(r.acted_at),
    camKet: r.ck_co ? camKetCuaHang(r) : null,
  }));
}

function soHayNull(gt: unknown): number | null {
  return typeof gt === "number" && Number.isInteger(gt) ? gt : null;
}

function chuoiHayNull(gt: unknown): string | null {
  return typeof gt === "string" ? gt : null;
}

/** Hàng cam kết → `CamKetBundle`. Cột `NOT NULL` của `121` nên `hang_tco`, `effective_cost`, `chup_luc` luôn có khi hàng có. */
function camKetCuaHang(r: HangAward): CamKetBundle {
  const khai = r.ck_khai ?? {};
  return {
    hangTco: r.ck_hang_tco ?? 0,
    hangGia: r.ck_hang_gia,
    effectiveCost: r.ck_effective_cost ?? "",
    components: (r.ck_components ?? []).map(chepThanhPhan),
    khai: {
      freight: chuoiHayNull(khai["freight"]),
      importCost: chuoiHayNull(khai["importCost"]),
      paymentDays: soHayNull(khai["paymentDays"]),
      leadTimeDays: soHayNull(khai["leadTimeDays"]),
    },
    tapMa: r.ck_tap_ma,
    thamSo: chepChuoiTheoKhoa(r.ck_tham_so),
    soNgayGiao: r.ck_so_ngay_giao,
    giaiTrinhLechHang: r.ck_giai_trinh,
    chupLuc: moc(r.ck_chup_luc ?? new Date(0)),
  };
}

/** [S1.9101 / S4.7c2] Ảnh chụp TCO của gói lúc mở — `DAC-TA.md` §9. Gói không mở (bất khả khi đã có lượt chấm) cho ba `null`. */
export async function docGoiTco(client: pg.PoolClient, orgId: string, rfqId: string): Promise<GoiTcoBundle> {
  const { rows } = await client.query<{
    readonly tco_ma_ghim: readonly string[] | null;
    readonly tco_tham_so_ghim: unknown;
    readonly so_ngay_giao: number | null;
  }>(
    `SELECT r.tco_ma_ghim, r.tco_tham_so_ghim, r.so_ngay_giao
       FROM public.rfq_packages r
      WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, rfqId],
  );
  const r = rows[0];
  return {
    tapMa: r?.tco_ma_ghim ?? null,
    thamSo: chepChuoiTheoKhoa(r?.tco_tham_so_ghim ?? null),
    soNgayGiao: r?.so_ngay_giao ?? null,
  };
}

// ----------------------------------------------------------------------------------------------
// DỰNG BUNDLE — MỘT CHỖ DUY NHẤT CHO CẢ HAI ĐƯỜNG XUẤT
// ----------------------------------------------------------------------------------------------

/** Câu đi kèm `xuatLuc` — đồng hồ của TIẾN TRÌNH xuất, dù tiến trình ấy là CLI hay `apps/api`. */
export const NGUON_DONG_HO_XUAT =
  "đồng hồ của tiến trình xuất — KHÔNG được chứng thực; không đầu vào nào của phép tính";

/** Hai tệp của một bộ bằng chứng, đã tuần tự hoá — khoá là TÊN tệp, giá trị là văn bản UTF-8. */
export interface BoBangChungDaXuat {
  readonly tep: Readonly<Record<typeof TEP_DU_LIEU | typeof TEP_DAC_TA, string>>;
  readonly soLuotCham: number;
  readonly soHang: number;
  readonly soTraoThau: number;
  /** [S1.262 / S4.5c2] Số hàng kết quả benchmark (mọi lượt chấm) và số quan sát mang theo — 0 khi lớp dữ liệu nền rỗng. */
  readonly soDongBenchmark: number;
  readonly soQuanSat: number;
}

/**
 * Đọc và tuần tự hoá bộ bằng chứng của một gói thầu. `null` khi gói thầu chưa được chấm lần nào.
 *
 * KHÔNG hỏi quyền: người gọi là `pnpm bang-chung xuat` (giữ `DATABASE_URL`, tức đã đứng ngoài mọi
 * cổng ứng dụng) hoặc `xuatBoBangChung` ngay dưới, nơi cổng đứng. `client` phải đã gắn tenant.
 *
 * `null` chứ không một bundle rỗng: một thư mục trông như bộ bằng chứng mà không mang phép đo nào
 * tệ hơn không có thư mục nào — cùng luật với `kiemBo` từ chối một lượt kiểm không đo được gì.
 */
export async function dungBoBangChung(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  xuatLuc: Date,
  // [S1.262 / S4.5c2] Muối của các định danh băm ở lớp dữ liệu nền: NGẪU NHIÊN mỗi lần xuất, không lưu, không ghi vào bundle
  // (chủ dự án chốt 2026-10-02). Tham số chỉ để test dựng được hai lần xuất cùng muối.
  muoi: Buffer = randomBytes(32),
): Promise<BoBangChungDaXuat | null> {
  const luotCham = await docMoiLuotCham(client, orgId, rfqId);
  if (luotCham.length === 0) return null;
  const traoThau = await docMoiTraoThau(client, orgId, rfqId);
  const goiTco = await docGoiTco(client, orgId, rfqId);
  const duLieuNen = await docLopDuLieuNen(
    client,
    orgId,
    rfqId,
    luotCham.map((l) => l.evaluationId),
    muoi,
  );

  const bo: BoBangChung = {
    dang: DANG_BUNDLE,
    phienBan: PHIEN_BAN_BUNDLE,
    dacTaPhienBan: DAC_TA_PHIEN_BAN,
    // Băm của BYTE UTF-8, không của chuỗi JS: kho chạy `core.autocrlf=true`, và người ghi đĩa phải
    // ghi đúng `Buffer.from(…, "utf8")` của văn bản này — cùng bài học với `trich`.
    dacTaSha256: createHash("sha256").update(Buffer.from(DAC_TA, "utf8")).digest("hex"),
    orgId,
    rfqId,
    xuatLuc: { giaTri: xuatLuc.toISOString(), nguon: NGUON_DONG_HO_XUAT },
    goiTco,
    luotCham,
    traoThau,
    duLieuNen,
  };

  return {
    tep: {
      [TEP_DU_LIEU]: `${JSON.stringify(bo, null, 2)}\n`,
      [TEP_DAC_TA]: DAC_TA,
    },
    soLuotCham: luotCham.length,
    soHang: luotCham.reduce((t, l) => t + l.hang.length, 0),
    soTraoThau: traoThau.length,
    soDongBenchmark: duLieuNen?.luotCham.reduce((t, l) => t + l.dong.length, 0) ?? 0,
    soQuanSat: duLieuNen?.bangQuanSat.reduce((t, b) => t + b.quanSat.length, 0) ?? 0,
  };
}

export interface XuatBoBangChungInput {
  readonly rfqId: string;
  readonly actorSessionId: string;
}

/**
 * [mảnh 1 / màn xuất bằng chứng] Đường xuất dưới phiên một CON NGƯỜI — `GET /rfqs/:rfqId/evidence-bundle`.
 *
 * HAI cổng, cả hai đứng THẲNG trong thân (khoản 33 — `cong-quyen-route.test.ts` đọc thân hàm):
 *   ⑴ `audit.read` — *"Đọc và xuất sổ kiểm toán"* (`005`). Đây là mã của HÀNH ĐỘNG: xuất bằng chứng
 *      là việc của người kiểm toán, không của người trao thầu — `PROCUREMENT_MANAGER` chấm và đề xuất
 *      được nhưng KHÔNG tự xuất bằng chứng về chính việc mình làm;
 *   ⑵ `bid.view` — vì bundle mang `effectiveCost` và `components` của TỪNG báo giá, tức GIÁ. Hôm nay
 *      mọi vai giữ ⑴ cũng giữ ⑵ (`FINANCE`, `DIRECTOR`), nên ⑵ không rút quyền của ai. Nó ở đây cho
 *      ngày mai: một vai kiểm toán chỉ giữ `audit.read` sẽ KHÔNG đọc được giá qua cửa sau này mà
 *      không ai phải nhớ ra — đúng khuôn *mặc định đóng* của kho.
 */
export async function xuatBoBangChung(
  client: pg.PoolClient,
  orgId: string,
  input: XuatBoBangChungInput,
  auditPool: pg.Pool,
): Promise<BoBangChungDaXuat | null> {
  await assertTenantBound(client, orgId, "xuatBoBangChung");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.AUDIT_READ, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.BID_VIEW, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );

  // [S1.164 / khoản 245 / ADR-102] Bộ bằng chứng mang `effectiveCost` và `components` của TỪNG báo giá — một lượt đọc giá — nên
  // lần xuất để lại một hàng sổ, trên CHÍNH `client` và sau khi bộ đã dựng xong: ghi hỏng thì NÉM và bộ không đi ra. Bộ KHÔNG
  // chứa hàng nào của `audit_events`, nên hàng này không làm lệch byte giữa lần xuất qua HTTP và lần dựng của CLI
  // (`tools/bo-xuat-danh-gia` gọi thẳng `dungBoBangChung`, không đi qua đây). `null` — chưa có gì để xuất — không ghi.
  const bo = await dungBoBangChung(client, orgId, input.rfqId, new Date());
  if (bo !== null) {
    await appendAuditEvent(client, orgId, {
      actorType: "USER",
      actorId: actor.id,
      action: "EVIDENCE_BUNDLE_EXPORTED",
      resourceType: "RFQ",
      resourceId: input.rfqId,
      // [rà soát S4.5c2] Bộ nay mang đơn giá của các gói KHÁC (lớp dữ liệu nền) — sổ ghi quy mô của lần lộ ấy, không giá nào.
      payload: { exportedBySessionId: input.actorSessionId, soDongBenchmark: bo.soDongBenchmark, soQuanSat: bo.soQuanSat },
    });
  }
  return bo;
}
