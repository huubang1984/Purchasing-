// ==============================================================================================
// [S1.114 / S2.7 / ADR-059] ĐỌC MỌI THỨ BUNDLE CẦN, TỪ CƠ SỞ DỮ LIỆU — NỬA *XUẤT*
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

import type pg from "pg";
import type { MocThoiGian, LuotChamBundle, TraoThauBundle } from "./bo.js";
import type { ThanhPhanChinhSachDoc } from "./doc-lap/tinh-lai.js";

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
  readonly eval_components: readonly ThanhPhanChinhSachDoc[] | null;
}

interface HangDong {
  readonly bid_version_id: string;
  readonly supplier_name: string;
  readonly effective_cost: string | null;
  readonly rank: number | null;
  readonly components: readonly Record<string, unknown>[];
}

interface HangAward {
  readonly id: string;
  readonly evaluation_id: string;
  readonly bid_version_id: string;
  readonly status: string;
  readonly reason: string;
  readonly acted_at: Date;
}

/** Chép một phần tử `components` NGUYÊN VĂN, chỉ phán xử kiểu chứ không đổi cách viết khoá. */
function chepThanhPhan(tho: Record<string, unknown>): {
  ma: string;
  donVi?: string;
  heSo?: string;
  giaTri?: string;
  tien: string | null;
} {
  const lay = (ten: string): string | undefined => {
    const gt = tho[ten];
    return typeof gt === "string" ? gt : undefined;
  };
  const tien = tho["tien"];
  return {
    ma: lay("ma") ?? "",
    donVi: lay("donVi"),
    heSo: lay("heSo"),
    giaTri: lay("giaTri"),
    tien: typeof tien === "string" ? tien : null,
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
            o.eval_components
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
              l.components
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
      taoLuc: moc(l.created_at),
      hang: dong.map((d) => ({
        bidVersionId: d.bid_version_id,
        supplierName: d.supplier_name,
        effectiveCost: d.effective_cost,
        rank: d.rank,
        components: d.components.map(chepThanhPhan),
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
  const { rows } = await client.query<HangAward>(
    `SELECT a.id,
            a.evaluation_id,
            a.bid_version_id,
            a.status,
            a.reason,
            a.acted_at
       FROM public.rfq_awards a
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
  }));
}
