// ==============================================================================================
// S1.7 — BẢNG SO SÁNH SAU MỞ THẦU, VÀ SỐ BÁO GIÁ ĐÃ NHẬN
//
// Hai hàm ở file này là hai mặt của cùng một câu hỏi: **một con số suy ra từ giá được phép xuất
// hiện lúc nào?** A4 trả lời cho các trường phái sinh (min/max/trung bình/đếm dưới ngân
// sách/sắp theo giá); A6 trả lời cho một con số còn không cần tới giá — số báo giá đã nhận.
//
// ----------------------------------------------------------------------------------------------
// [A4] VÌ SAO CỔNG Ở ĐÂY LÀ LỚP THỨ HAI, KHÔNG PHẢI LỚP THỨ NHẤT
// ----------------------------------------------------------------------------------------------
// Lớp thứ nhất là SỰ VẮNG MẶT CỦA DỮ LIỆU, và nó mạnh hơn mọi câu `if`: trước lúc mở thầu,
// `rfq_unsealed_bids` KHÔNG CÓ HÀNG NÀO, `app_api` KHÔNG ĐỌC ĐƯỢC `vendor_bid_versions.envelope`,
// và không role nào của dự án vừa giải mã được vừa trả lời được một truy vấn của người mua. Một
// `avg()` viết bởi người chưa đọc tài liệu nào cũng không có gì để cộng.
//
// `buildComparisonTable` là lớp thứ hai, và nó tồn tại vì lớp thứ nhất KHÔNG chặn được đúng một
// thứ: một RFQ đã `UNSEALED` rồi bị đưa NGƯỢC về một trạng thái trước đó. Bảng cạnh của 009 không
// cho cạnh ấy, nhưng cổng ở đây không phụ thuộc vào việc bảng cạnh mãi mãi đúng.
//
// ----------------------------------------------------------------------------------------------
// KHÔNG MỘT PHÉP TÍNH TIỀN NÀO CHẠY TRONG TIẾN TRÌNH NÀY
// ----------------------------------------------------------------------------------------------
// `min`, `max`, `avg`, và phép so với ngân sách đều chạy ở Postgres trên `numeric`, rồi về đây
// dưới dạng CHUỖI. Không có `parseFloat` nào ở file này, và đó là chủ đích: xem khối *"vì sao
// phép tính tiền ở SQL"* ở đầu `db/migrations/020_comparison.sql`.
// ==============================================================================================

import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";

/**
 * Hai trạng thái mà một bảng so sánh được phép tồn tại.
 *
 * `EVALUATING` có mặt vì bảng so sánh là ĐẦU VÀO của việc chấm thầu, không phải một màn hình
 * xem một lần: đóng nó lại ngay sau `UNSEALED` sẽ làm người chấm không xem lại được thứ họ đang
 * chấm. Mọi trạng thái khác — kể cả `CLOSED`, tức đã hết hạn nộp nhưng CHƯA mở — bị từ chối.
 */
export const COMPARISON_ALLOWED_STATUSES = ["UNSEALED", "EVALUATING"] as const;

/** Ba trạng thái mà "số báo giá đã nhận" không còn là bí mật: hạn nộp đã qua và RFQ đã đóng. */
const TRANG_THAI_DA_DONG = new Set(["CLOSED", "UNSEALED", "EVALUATING"]);

export class ComparisonDeniedError extends Error {
  constructor(
    /** Trạng thái THẬT của RFQ lúc bị từ chối — để thông báo nói được vì sao, không chỉ nói không. */
    readonly rfqStatus: string,
    message: string,
  ) {
    super(message);
    this.name = "ComparisonDeniedError";
  }
}

export class ComparisonError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ComparisonError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Một dòng của bảng so sánh.
 *
 * `payload` đi ra NGUYÊN VẸN chứ không bị lọc xuống vài trường: hình dạng một báo giá là việc của
 * sản phẩm (019 đã từ chối hứa trước về nó), nên lớp này KHÔNG được quyết hộ rằng trường nào đáng
 * xem. `totalAmount` là thứ DUY NHẤT được rút ra, và chỉ vì các phép tổng hợp cần nó.
 */
export interface ComparisonRow {
  readonly bidId: string;
  readonly bidVersionId: string;
  readonly version: number;
  readonly submittedAt: Date;
  readonly supplierId: string;
  readonly supplierLegalName: string;
  readonly payload: Record<string, unknown>;
  /** Số tiền dạng CHUỖI thập phân, hoặc `null` nếu bản rõ không nói ra một con số hợp lệ. */
  readonly totalAmount: string | null;
  readonly currency: string | null;
}

/**
 * Các trường PHÁI SINH — đúng danh sách mà mệnh đề A4 cấm xuất hiện trước mở thầu.
 *
 * Chúng nằm trong CÙNG một đối tượng với `rows` chứ không ở một hàm riêng, và đó là chủ đích:
 * một hàm `getBidStatistics(rfqId)` riêng lẻ là đúng thứ mà một lập trình viên có thiện chí sẽ
 * gọi từ màn hình danh sách RFQ — và lúc ấy A4 hỏng mà không ai sửa một dòng nào của file này.
 * Ở đây, muốn có `min` thì phải đi qua cổng đã từ chối mọi RFQ chưa mở thầu.
 */
export interface ComparisonAggregates {
  /** Số dòng đọc ra được một số tiền hợp lệ. */
  readonly parsed: number;
  /** Số dòng KHÔNG đọc ra được — vẫn nằm trong `rows`, không bị vứt đi. */
  readonly unparsed: number;
  readonly currency: string | null;
  /**
   * `true` khi các báo giá đọc được KHÔNG cùng một đơn vị tiền. Lúc ấy `min`/`max`/`average`/
   * `belowBudget` đều là `null`: `min(1000 USD, 2000 VND)` là một con số không có nghĩa, và
   * hiển thị nó ra còn tệ hơn không hiển thị gì.
   */
  readonly currencyMismatch: boolean;
  readonly min: string | null;
  readonly max: string | null;
  readonly average: string | null;
  /** Số báo giá không vượt ngân sách dự tính; `null` khi RFQ không có ngân sách hoặc lệch tiền tệ. */
  readonly belowBudget: number | null;
}

export interface ComparisonTable {
  readonly rfqId: string;
  readonly rfqStatus: string;
  /** Sắp theo giá TĂNG DẦN, dòng không đọc được giá xuống cuối rồi sắp theo tên nhà cung cấp. */
  readonly rows: readonly ComparisonRow[];
  readonly aggregates: ComparisonAggregates;
}

export type BidCountDisclosure =
  | { readonly disclosed: true; readonly count: number }
  | {
      readonly disclosed: false;
      readonly reason: "STRICT_BLIND_BEFORE_CLOSE";
      readonly rfqStatus: string;
    };

interface HangTrangThai {
  readonly status: string;
}

interface HangDong {
  readonly bid_id: string;
  readonly bid_version_id: string;
  readonly version: number;
  readonly submitted_at: Date;
  readonly supplier_id: string;
  readonly legal_name: string;
  readonly payload: Record<string, unknown>;
  readonly total_amount: string | null;
  readonly currency: string | null;
}

interface HangTongHop {
  readonly currency: string | null;
  readonly n: number;
  readonly gia_min: string | null;
  readonly gia_max: string | null;
  readonly gia_tb: string | null;
  readonly duoi_ngan_sach: number | null;
}

export interface ComparisonInput {
  readonly rfqId: string;
  /** [ADR-016] Phiên của CHÍNH người đọc. Danh tính — và vì thế quyền — là dẫn xuất của nó. */
  readonly actorSessionId: string;
}

/**
 * [REVIEW AN NINH S1.6 — MED-5] BẢNG GIÁ SAU MỞ THẦU LÀ MỘT THỨ CÓ QUYỀN, KHÔNG PHẢI MỘT THỨ AI
 * GẮN ĐÚNG TỔ CHỨC CŨNG ĐỌC ĐƯỢC.
 *
 * Tới trước vòng sửa này, hai hàm dưới đây chỉ gọi `assertTenantBound` rồi kiểm trạng thái RFQ.
 * Hệ quả: `bid.view` — một mã quyền CÓ THẬT trong `permissions.ts` và trong 005 — **không được
 * cưỡng chế ở một dòng mã nào của cả dự án**; `grep` cho 0 hit ngoài test. Một người dùng vai
 * `TECHNICAL` hay `REQUESTER` không phân biệt được với một `DIRECTOR`, và một phiên khách thì
 * chỉ bị ngăn bởi việc CHƯA CÓ route nào — tức bởi sự vắng mặt của tính năng, không bởi một lớp.
 *
 * A1 vẫn đúng như câu chữ của nó (trước mở thầu không có gì để trả về). Thứ thiếu là uỷ quyền
 * SAU mở thầu, và đó là chỗ A5 sẽ đổ vào khi `app_guest` ra đời (khoản nợ 29).
 */
/**
 * [khoản nợ 33] Hàm này CỐ Ý chỉ giải danh tính, KHÔNG gọi `requirePermission`.
 *
 * Bản đầu gói cả lời gọi ấy vào đây, và nó trông gọn hơn. Nhưng `cong-quyen-route.test.ts` đọc
 * MÃ NGUỒN của từng hàm ở rổ `HAM_DOC_CO_QUYEN` và đòi thân nó thật sự gọi `requirePermission` —
 * và với một helper dùng chung, phép đọc ấy KHÔNG THẤY GÌ. Hai đường sửa: dạy lớp canh đi theo
 * một tầng gián tiếp (tức lại suy từ một danh sách tên helper), hoặc để lời gọi nằm THẲNG trong
 * thân hàm được canh.
 *
 * Chọn đường thứ hai: hai lời gọi gần giống nhau đổi lấy một phép đo TRỰC TIẾP. Đây đúng chỗ mà
 * *"một lớp đo được"* đáng giá hơn *"một lớp gọn"*.
 */
async function nguoiDoc(
  client: pg.PoolClient,
  orgId: string,
  input: ComparisonInput,
  ten: string,
): Promise<{ id: string }> {
  batBuocUuid(input.actorSessionId, `${ten}.actorSessionId`);
  return resolveSessionActor(client, orgId, input.actorSessionId);
}

function batBuocUuid(gia: string, ten: string): void {
  if (!UUID_PATTERN.test(gia)) {
    throw new ComparisonError(`${ten} phải là UUID hợp lệ, nhận được: "${gia}".`);
  }
}

async function docTrangThai(client: pg.PoolClient, rfqId: string): Promise<string> {
  const { rows } = await client.query<HangTrangThai>(
    "SELECT status FROM rfq_packages WHERE id = $1",
    [rfqId],
  );
  const r = rows[0];
  if (r === undefined) {
    throw new ComparisonError("Không tìm thấy RFQ trong tổ chức đang gắn.");
  }
  return r.status;
}

/**
 * [A4] Dựng bảng so sánh của một RFQ — CHỈ khi RFQ đã được mở thầu.
 *
 * Mọi trường phái sinh mà mệnh đề A4 gọi tên đều nằm ở đây và KHÔNG có đường nào khác tới chúng
 * trong toàn dự án. Với RFQ chưa mở thầu, hàm này NÉM chứ không trả về một bảng rỗng: một bảng
 * rỗng là một câu trả lời, và "có bao nhiêu báo giá dưới ngân sách" trả lời bằng 0 vẫn là trả lời.
 */
export async function buildComparisonTable(
  client: pg.PoolClient,
  orgId: string,
  input: ComparisonInput,
  auditPool: pg.Pool,
): Promise<ComparisonTable> {
  await assertTenantBound(client, orgId, "buildComparisonTable");
  const { rfqId } = input;
  batBuocUuid(rfqId, "rfqId");
  const nguoiXem = await nguoiDoc(client, orgId, input, "buildComparisonTable");
  await requirePermission(
    client,
    {
      userId: nguoiXem.id,
      orgId,
      permission: PERMISSIONS.BID_VIEW,
      resourceType: "RFQ",
      resourceId: rfqId,
    },
    auditPool,
  );

  const trangThai = await docTrangThai(client, rfqId);
  if (!(COMPARISON_ALLOWED_STATUSES as readonly string[]).includes(trangThai)) {
    throw new ComparisonDeniedError(
      trangThai,
      `Bảng so sánh chỉ tồn tại sau khi mở thầu; RFQ đang ở ${trangThai} (A4).`,
    );
  }

  const { rows: dong } = await client.query<HangDong>(
    `SELECT v.bid_id,
            v.id                                         AS bid_version_id,
            v.version,
            v.submitted_at,
            s.id                                         AS supplier_id,
            s.legal_name,
            u.payload,
            bid_so_tien(u.payload->>'totalAmount')::text AS total_amount,
            u.payload->>'currency'                       AS currency
       FROM rfq_unsealed_bids u
       JOIN vendor_bid_versions v ON v.id = u.bid_version_id AND v.org_id = u.org_id
       JOIN vendor_bids b         ON b.id = v.bid_id         AND b.org_id = v.org_id
       JOIN rfq_invitations i     ON i.id = b.invitation_id  AND i.org_id = b.org_id
       JOIN suppliers s           ON s.id = i.supplier_id    AND s.org_id = i.org_id
      WHERE i.rfq_id = $1
      ORDER BY bid_so_tien(u.payload->>'totalAmount') ASC NULLS LAST, s.legal_name ASC`,
    [rfqId],
  );

  // Gom theo TIỀN TỆ chứ không gom một cục: nếu truy vấn trả về nhiều hơn một nhóm thì các phép
  // tổng hợp không có nghĩa, và đó là điều duy nhất phía TypeScript cần biết để quyết.
  const { rows: th } = await client.query<HangTongHop>(
    `SELECT u.payload->>'currency'                                     AS currency,
            count(*)::int                                              AS n,
            min(bid_so_tien(u.payload->>'totalAmount'))::text           AS gia_min,
            max(bid_so_tien(u.payload->>'totalAmount'))::text           AS gia_max,
            round(avg(bid_so_tien(u.payload->>'totalAmount')), 2)::text AS gia_tb,
            count(*) FILTER (
              WHERE ns.estimated_value IS NOT NULL
                AND ns.currency = u.payload->>'currency'
                AND bid_so_tien(u.payload->>'totalAmount') <= ns.estimated_value
            )::int                                                     AS duoi_ngan_sach
       FROM rfq_unsealed_bids u
       JOIN vendor_bid_versions v ON v.id = u.bid_version_id AND v.org_id = u.org_id
       JOIN vendor_bids b         ON b.id = v.bid_id         AND b.org_id = v.org_id
       JOIN rfq_invitations i     ON i.id = b.invitation_id  AND i.org_id = b.org_id
       LEFT JOIN rfq_budgets ns   ON ns.rfq_id = i.rfq_id    AND ns.org_id = i.org_id
      WHERE i.rfq_id = $1
        AND bid_so_tien(u.payload->>'totalAmount') IS NOT NULL
      GROUP BY u.payload->>'currency'`,
    [rfqId],
  );

  const doc = th.reduce((s, r) => s + r.n, 0);
  const lechTien = th.length > 1;
  const mot = th.length === 1 ? th[0] : undefined;

  return {
    rfqId,
    rfqStatus: trangThai,
    rows: dong.map((r) => ({
      bidId: r.bid_id,
      bidVersionId: r.bid_version_id,
      version: r.version,
      submittedAt: r.submitted_at,
      supplierId: r.supplier_id,
      supplierLegalName: r.legal_name,
      payload: r.payload,
      totalAmount: r.total_amount,
      currency: r.currency,
    })),
    aggregates: {
      parsed: doc,
      unparsed: dong.length - doc,
      currency: mot?.currency ?? null,
      currencyMismatch: lechTien,
      min: mot?.gia_min ?? null,
      max: mot?.gia_max ?? null,
      average: mot?.gia_tb ?? null,
      belowBudget: mot?.duoi_ngan_sach ?? null,
    },
  };
}

/**
 * [A6] Số báo giá đã nhận — và chế độ nghiêm giấu nó đi trước giờ đóng.
 *
 * HÌNH DẠNG TRẢ VỀ LÀ MỘT TUYÊN BỐ: `{ disclosed: false }` KHÔNG mang trường `count`. Một API trả
 * `{ count: 0 }` khi đang giấu là một API mà người gọi không phân biệt được "chưa ai nộp" với
 * "không được biết" — và một trong hai câu ấy là một câu rò rỉ.
 *
 * Và con số ấy KHÔNG ĐƯỢC ĐẾM khi đang giấu: hai truy vấn tách rời chứ không phải một truy vấn
 * rồi bỏ bớt trường. Thứ không bao giờ được đọc lên thì không lọt vào log, vào APM trace, hay
 * vào một thông báo lỗi mang cả đối tượng kết quả.
 */
export async function countReceivedBids(
  client: pg.PoolClient,
  orgId: string,
  input: ComparisonInput,
  auditPool: pg.Pool,
): Promise<BidCountDisclosure> {
  await assertTenantBound(client, orgId, "countReceivedBids");
  const { rfqId } = input;
  batBuocUuid(rfqId, "rfqId");
  const nguoiDem = await nguoiDoc(client, orgId, input, "countReceivedBids");
  await requirePermission(
    client,
    {
      userId: nguoiDem.id,
      orgId,
      permission: PERMISSIONS.BID_VIEW,
      resourceType: "RFQ",
      resourceId: rfqId,
    },
    auditPool,
  );

  const { rows } = await client.query<{ status: string; nghiem: boolean }>(
    "SELECT status, rfq_che_do_nghiem(id) AS nghiem FROM rfq_packages WHERE id = $1",
    [rfqId],
  );
  const r = rows[0];
  if (r === undefined) {
    throw new ComparisonError("Không tìm thấy RFQ trong tổ chức đang gắn.");
  }
  if (r.nghiem && !TRANG_THAI_DA_DONG.has(r.status)) {
    return { disclosed: false, reason: "STRICT_BLIND_BEFORE_CLOSE", rfqStatus: r.status };
  }

  const { rows: dem } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM vendor_bids b
       JOIN rfq_invitations i ON i.id = b.invitation_id AND i.org_id = b.org_id
      WHERE i.rfq_id = $1`,
    [rfqId],
  );
  return { disclosed: true, count: dem[0]?.n ?? 0 };
}
