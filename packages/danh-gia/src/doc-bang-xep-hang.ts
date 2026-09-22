// ==============================================================================================
// [S1.106 / S2.4] ĐỌC BẢNG XẾP HẠNG — VÀ NÓ PHẢI HIỆN THÀNH PHẦN, KHÔNG CHỈ CON SỐ
//
// Spec §8: *"bảng xếp hạng luôn hiện thành phần, để người đọc thấy con số nào đến từ đâu."* Đó
// không phải một yêu cầu trang trí: **J2** nói mỗi hàng xếp hạng tái lập được, và một màn hình
// chỉ hiện `effective_cost` biến J2 thành một lời hứa mà người mua không kiểm được. Cột
// `components` vì thế đi RA TỚI giao diện, không dừng ở CSDL.
//
// ----------------------------------------------------------------------------------------------
// CỔNG QUYỀN NẰM TRONG HÀM NÀY, VÀ LỜI GỌI PHẢI ĐỨNG THẲNG Ở ĐÂY
// ----------------------------------------------------------------------------------------------
// Khoản **33**: `cong-quyen-route.test.ts` đọc MÃ NGUỒN thân của từng hàm ở rổ `HAM_DOC_CO_QUYEN`
// và đòi nó thật sự gọi `requirePermission`. Gói lời gọi ấy vào một helper dùng chung sẽ làm phép
// đọc ấy KHÔNG THẤY GÌ — nên nó nằm nguyên ở đây, cùng khuôn `buildComparisonTable`.
//
// Mã quyền là `bid.view`, KHÔNG phải `evaluation.perform`: đọc một bảng xếp hạng là một lần TIẾT
// LỘ GIÁ, và nó phải chịu đúng cổng mà bảng so sánh chịu. Một người chấm được (`evaluation.perform`
// — năm trên sáu vai giữ nó) mà không được xem giá là một trạng thái có thật của sản phẩm.
// ==============================================================================================

import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";

/** Một thành phần đã quy đổi, đúng như nó nằm trong cột `components`. */
export interface ThanhPhanHien {
  readonly ma: string;
  readonly donVi: string;
  /** `null` khi hàng không mang `he_so`/`gia_tri` — `057` chỉ đòi `ma` và `tien`. */
  readonly heSo: string | null;
  readonly giaTri: string | null;
  readonly tien: string | null;
}

export interface HangBangXepHang {
  readonly bidVersionId: string;
  readonly supplierName: string;
  readonly effectiveCost: string | null;
  readonly rank: number | null;
  readonly components: readonly ThanhPhanHien[];
}

export interface BangXepHang {
  readonly evaluationId: string;
  readonly policyVersion: number;
  readonly currency: string;
  readonly evaluatedAt: Date;
  readonly rows: readonly HangBangXepHang[];
}

interface HangTho {
  readonly bid_version_id: string;
  readonly supplier_name: string;
  readonly effective_cost: string | null;
  readonly rank: number | null;
  readonly components: readonly ThanhPhanHienTho[];
}

interface ThanhPhanHienTho {
  readonly ma: string;
  readonly donVi?: string;
  readonly heSo?: string;
  readonly giaTri?: string;
  readonly tien: string | null;
}

export interface DocBangXepHangInput {
  readonly rfqId: string;
  readonly actorSessionId: string;
}

/**
 * Lượt chấm MỚI NHẤT của một gói thầu, cùng từng hàng và từng thành phần sinh ra con số.
 *
 * Trả `null` khi gói thầu chưa được chấm lần nào — một mảng rỗng ở đây sẽ nói dối: *"đã chấm, và
 * không ai trong bảng"* khác hẳn *"chưa chấm"*.
 *
 * **Vì sao lấy lượt MỚI NHẤT chứ không mọi lượt:** spec §4.3 nói `BAFO_CLOSED->EVALUATING` sinh
 * một `rfq_evaluations` THỨ HAI và hàng cũ ở lại nguyên vẹn. Màn chấm cần bảng ĐANG có hiệu lực;
 * còn *"vì sao xếp hạng đổi"* là một câu hỏi kiểm toán, và nó được trả lời bằng bộ xuất của S2.7
 * chứ không bằng một màn hình.
 */
export async function docBangXepHang(
  client: pg.PoolClient,
  orgId: string,
  input: DocBangXepHangInput,
  auditPool: pg.Pool,
): Promise<BangXepHang | null> {
  await assertTenantBound(client, orgId, "docBangXepHang");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  // [khoản 33] Lời gọi này đứng THẲNG ở đây, không qua helper — xem khối đầu tệp.
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.BID_VIEW,
      // [S1.107 / lượt soi ngang 77 — ②] `RFQ`, KHÔNG `RFQ_EVALUATION` — xem lý do đầy đủ ở
      // `luot-danh-gia.ts`. Cặp (loại, id) đi nguyên văn vào hàng sổ `PERMISSION_DENIED`.
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  // `created_at` đi ra dưới dạng `Date` của `pg`, không qua `to_char`: quy ước của kho là thế
  // (`packages/rfq`, `packages/supplier`), và một chuỗi `to_char` mang `OF` cho `+07` — dạng
  // mà `Date.parse` KHÔNG buộc phải hiểu, nên nó là một cái bẫy đặt ở tầng giao diện.
  const { rows: luot } = await client.query<{ id: string; version: number; currency: string; created_at: Date }>(
    `SELECT e.id,
            o.version,
            e.currency,
            e.created_at
       FROM public.rfq_evaluations e
       JOIN public.org_procurement_policies o ON o.id OPERATOR(pg_catalog.=) e.policy_id
                                            AND o.org_id OPERATOR(pg_catalog.=) e.org_id
      WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND e.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1`,
    [orgId, input.rfqId],
  );
  const l = luot[0];
  if (l === undefined) return null;

  // `rank NULLS LAST`: báo giá không đọc được giá xuống cuối bảng chứ không lên đầu — `ORDER BY`
  // của Postgres đặt `NULL` LỚN NHẤT theo mặc định ASC, nhưng viết ra thay vì dựa vào mặc định.
  const { rows } = await client.query<HangTho>(
    `SELECT l.bid_version_id,
            s.legal_name AS supplier_name,
            l.effective_cost::pg_catalog.text AS effective_cost,
            l.rank,
            l.components
       FROM public.rfq_evaluation_lines l
       JOIN public.rfq_unsealed_bids u   ON u.bid_version_id OPERATOR(pg_catalog.=) l.bid_version_id
                                        AND u.org_id OPERATOR(pg_catalog.=) l.org_id
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

  return {
    evaluationId: l.id,
    policyVersion: l.version,
    currency: l.currency,
    evaluatedAt: l.created_at,
    rows: rows.map((r) => ({
      bidVersionId: r.bid_version_id,
      supplierName: r.supplier_name,
      effectiveCost: r.effective_cost,
      rank: r.rank,
      components: r.components.map((c) => ({
        ma: c.ma,
        // `don_vi` KHÔNG bắt buộc trong `components` (`057` chỉ đòi `ma` và `tien`). Khi nó
        // vắng, suy đúng LUẬT mà trigger `kiem_thanh_phan_theo_chinh_sach` dùng để đối chiếu
        // với chính sách: `tien` null là `DIEM`, có giá trị là `TIEN`. Suy theo luật của CSDL,
        // không theo một mặc định cho tiện.
        donVi: c.donVi ?? (c.tien === null ? "DIEM" : "TIEN"),
        // `he_so` và `gia_tri` thì KHÔNG suy được từ đâu cả, nên `null` đi thẳng ra giao diện
        // và hiện thành một gạch ngang. Một `"1.0000"` bịa ở đây là bịa ra đúng thứ J2 phải
        // kiểm được.
        heSo: c.heSo ?? null,
        giaTri: c.giaTri ?? null,
        tien: c.tien,
      })),
    })),
  };
}
