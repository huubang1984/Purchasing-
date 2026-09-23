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

import { createHash } from "node:crypto";
import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { DAC_TA } from "./dac-ta.js";

export const DANG_BUNDLE = "trustprocure/bo-bang-chung-danh-gia";
export const PHIEN_BAN_BUNDLE = 1;
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
}

export interface HangBundle {
  readonly bidVersionId: string;
  readonly supplierName: string;
  readonly effectiveCost: string | null;
  readonly rank: number | null;
  readonly components: readonly ThanhPhanLuu[];
}

export interface LuotChamBundle {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly currency: string;
  readonly chinhSachThanhPhan: readonly ThanhPhanChinhSachBundle[];
  readonly taoLuc: MocThoiGian;
  readonly hang: readonly HangBundle[];
}

export interface TraoThauBundle {
  readonly awardId: string;
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly status: string;
  readonly reason: string;
  readonly actedAt: MocThoiGian;
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
  /** Mọi lượt chấm của gói thầu, cũ trước mới sau — KHÔNG chỉ lượt mới nhất. */
  readonly luotCham: readonly LuotChamBundle[];
  readonly traoThau: readonly TraoThauBundle[];
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
): Promise<BoBangChungDaXuat | null> {
  const luotCham = await docMoiLuotCham(client, orgId, rfqId);
  if (luotCham.length === 0) return null;
  const traoThau = await docMoiTraoThau(client, orgId, rfqId);

  const bo: BoBangChung = {
    dang: DANG_BUNDLE,
    phienBan: PHIEN_BAN_BUNDLE,
    dacTaPhienBan: 1,
    // Băm của BYTE UTF-8, không của chuỗi JS: kho chạy `core.autocrlf=true`, và người ghi đĩa phải
    // ghi đúng `Buffer.from(…, "utf8")` của văn bản này — cùng bài học với `trich`.
    dacTaSha256: createHash("sha256").update(Buffer.from(DAC_TA, "utf8")).digest("hex"),
    orgId,
    rfqId,
    xuatLuc: { giaTri: xuatLuc.toISOString(), nguon: NGUON_DONG_HO_XUAT },
    luotCham,
    traoThau,
  };

  return {
    tep: {
      [TEP_DU_LIEU]: `${JSON.stringify(bo, null, 2)}\n`,
      [TEP_DAC_TA]: DAC_TA,
    },
    soLuotCham: luotCham.length,
    soHang: luotCham.reduce((t, l) => t + l.hang.length, 0),
    soTraoThau: traoThau.length,
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

  return dungBoBangChung(client, orgId, input.rfqId, new Date());
}
