import type pg from "pg";

// ============================================================================================
// [ADR-083] ĐO TỒN ĐỌNG CỦA HÀNG ĐỢI — MỘT TỔ CHỨC, MỘT CÂU, TRONG `withTenant`
//
// Câu hỏi mà cảnh báo nghiệp vụ cần trả lời: *"có ai đang rút hàng đợi không?"*. Runner chết,
// bị treo, hay chạy mà không nhặt được `kind` nào đều để lại CÙNG một dấu: job `PENDING` đã tới
// hạn (`run_after <= now()`) nằm yên và già đi. Nên phép đo là TUỔI của job quá hạn LÂU NHẤT
// (giây) cùng SỐ job quá hạn — không phải độ dài hàng đợi: một hàng đợi dài mà đang chạy là khoẻ,
// một job duy nhất nằm yên một giờ là hỏng.
//
// PHẠM VI, NÓI RA: `RUNNING` hết hạn thuê KHÔNG được đếm. Nó là việc runner sẽ nhặt lại
// (`CAU_CLAIM` của `runner.ts`), và nếu không ai nhặt thì chính các job `PENDING` sau nó cũng già
// đi — tín hiệu vẫn tới, chỉ qua hàng khác. Thêm vế ấy là thêm một định nghĩa "tồn đọng" thứ hai
// mà ngưỡng cảnh báo phải hiểu.
//
// Câu chạy dưới `withTenant`, nên RLS `outbox_jobs_tenant_isolation` (007) đã giới hạn tập hàng
// về tổ chức đang gắn. Vế `org_id = $1` là BẢN SAO PHÒNG THỦ, viết THÊM chứ không viết THAY —
// cùng khuôn `CAU_CLAIM`: bảo đảm của RLS không áp cho phiên không chịu RLS. Chỉ mục riêng phần
// `outbox_jobs_claim_idx (org_id, run_after) WHERE status = 'PENDING'` phủ đúng vị từ này.
//
// [QT3] Ghim đủ bốn trục như mọi câu của gói. `coalesce` viết TRẦN là ngữ pháp — xem
// `enqueue.ts`. `date_part('epoch', …)` chứ không `EXTRACT(epoch FROM …)`: dạng ngữ pháp không
// ghim được (`tests/architecture/qt3-tu-vung.ts`).
// ============================================================================================
const CAU_TON_DONG = `
  SELECT pg_catalog.count(*)::pg_catalog.int8 AS so_job,
         coalesce(pg_catalog.floor(pg_catalog.date_part('epoch',
                    pg_catalog.now() OPERATOR(pg_catalog.-) pg_catalog.min(j.run_after))),
                  0)::pg_catalog.int8 AS giay
    FROM public.outbox_jobs AS j
   WHERE j.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND j.status OPERATOR(pg_catalog.=) 'PENDING'::pg_catalog.text
     AND j.run_after OPERATOR(pg_catalog.<=) pg_catalog.now()`;

/** Tồn đọng của MỘT tổ chức. `giay` = 0 và `soJob` = 0 khi không có job quá hạn nào. */
export interface TonDong {
  /** Tuổi của job `PENDING` quá hạn lâu nhất, giây nguyên (`now() - min(run_after)`). */
  readonly giay: number;
  /** Số job `PENDING` đã tới hạn mà chưa ai nhặt. */
  readonly soJob: number;
}

/**
 * Đo tồn đọng của tổ chức `orgId`. PHẢI gọi bằng một `client` của `withTenant(pool, orgId, …)` —
 * cùng hợp đồng với `enqueueJob`: `orgId` là tổ chức đang gắn trên client ấy.
 *
 * Chỉ ĐỌC, và chỉ trả hai con số: không `kind`, không `payload`, không id — nên kết quả đi thẳng
 * vào log được mà không mang giá trị nghiệp vụ nào.
 */
export async function doTonDong(client: pg.PoolClient, orgId: string): Promise<TonDong> {
  const { rows } = await client.query<{ so_job: string; giay: string }>(CAU_TON_DONG, [orgId]);
  const hang = rows[0];
  // Một câu tổng hợp không `GROUP BY` luôn trả đúng một hàng; thiếu hàng là một bất biến vỡ.
  if (!hang) throw new Error("cau do ton dong khong tra hang nao");
  // `int8` về tay dưới dạng chuỗi (node-postgres không tự ép để khỏi mất chính xác). Hai giá trị
  // này nhỏ hơn 2^53 rất xa, nên `Number` là đúng.
  return { giay: Number(hang.giay), soJob: Number(hang.so_job) };
}
