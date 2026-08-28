import type pg from "pg";

/**
 * Lỗi thuộc về GIAO THỨC của gói outbox, phân biệt với lỗi do Postgres hay handler ném.
 * Cố ý KHÔNG nội suy giá trị đầu vào nào vào `message`: thông báo lỗi đi vào log, và khuôn
 * "ném dữ liệu đầu vào vào message" là thứ được sao chép sang chỗ mà dữ liệu ĐÚNG LÀ bí mật
 * (giá thầu, token, mã OTP). Cùng lý do đã ghi ở packages/tenancy/src/with-tenant.ts.
 */
export class OutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxError";
  }
}

export interface JobInput {
  /**
   * Loại việc. Ràng buộc CẤU TRÚC ở tầng CSDL: `^[A-Z][A-Z0-9_]{0,63}$` (xem 007_outbox.sql).
   * Đây là một NHÃN mà `app_api` đọc lại được, không phải chỗ chứa dữ liệu.
   */
  readonly kind: string;
  /** Nội dung của việc. Dữ liệu nghiệp vụ tuỳ ý, nằm trong tổ chức, được RLS che. */
  readonly payload?: Record<string, unknown>;
  /**
   * Khoá chống trùng theo nghiệp vụ. Job cùng `(org, kind, dedupeKey)` chỉ tồn tại MỘT bản
   * ĐANG CHƯA KẾT THÚC. Khoá được TRẢ LẠI khi job tới `DONE` hoặc `FAILED` — xem
   * "LỆCH KHỎI BRIEF (1/9)" ở db/migrations/007_outbox.sql để biết vì sao vế đó là bắt buộc
   * chứ không phải một sự nới lỏng.
   */
  readonly dedupeKey?: string | null;
  /** Sớm nhất được phép chạy. Mặc định là ngay. */
  readonly runAfter?: Date | null;
}

// ============================================================================================
// [QT3] MỌI CÂU SQL TRONG GÓI NÀY GHIM ĐỦ `pg_catalog.` CHO HÀM, `OPERATOR(pg_catalog.=)` CHO
// TOÁN TỬ, VÀ `::pg_catalog.<kiểu>` CHO ÉP KIỂU.
//
// Lý do KHÔNG giống lý do của db/migrations/007_outbox.sql, và sự bất đối xứng đó là có đo:
// `migrate()` ghim `SET search_path = public` (KHÔNG nêu `pg_catalog`) làm câu lệnh đầu tiên
// trên kết nối của nó, nên trong file migration `pg_catalog` được tìm NGẦM TRƯỚC TIÊN. Gói này
// chạy trên pool ỨNG DỤNG, dùng chung với mã nghiệp vụ, dưới một `search_path` mà dự án KHÔNG
// kiểm soát. Ba trục đã được ĐO là khai thác được ở đúng hoàn cảnh đó:
//   (i)   toán tử — tên đủ schema KHÔNG bảo vệ toán tử; một `=` thù địch trong schema đứng
//         trước lật được phán xét (Task 8 vòng fix 2, tái lập end-to-end);
//   (ii)  tên KIỂU — `CREATE TYPE ... AS ENUM` + `CREATE CAST ... AS IMPLICIT` lật được phán
//         xét, tái lập end-to-end trên mã sản phẩm (Task 9 §I-3);
//   (iii) hình dạng `search_path` — nêu tên `pg_catalog` Ở VỊ TRÍ SAU chính là thứ phá quy tắc
//         tìm ngầm (Task 8 vòng fix 3, Mục 1).
// KHÔNG có lớp máy nào cưỡng chế quy ước này (khoản nợ số 1 mà Task 9 bàn giao); nó ở đây bằng
// kỷ luật, và điều đó được nói ra thay vì hứa suông.
//
// `coalesce` cố ý viết TRẦN: nó là CẤU TRÚC NGỮ PHÁP chứ không phải một hàm trong pg_catalog,
// nên `pg_catalog.coalesce(...)` ném 42883 — đã đo ở Task 8 vòng fix 2. Cùng lý do đó, nó cũng
// KHÔNG cướp được.
//
// MỘT CHỖ MÀ VIỆC GHIM LÀ BẮT BUỘC CHỨ KHÔNG PHẢI PHÒNG XA, VÀ NÓ ĐƯỢC TÌM RA BẰNG PHÉP ĐO:
// vị từ của mệnh đề `ON CONFLICT ... WHERE` phải KHỚP với vị từ của chỉ mục riêng phần thì
// PostgreSQL mới suy ra được chỉ mục trọng tài. Vị từ của chỉ mục đã phân giải sang OID lúc DDL
// (dưới `search_path` của `migrate()`), nên nếu câu này viết `status IN (...)` TRẦN thì dưới
// một `search_path` thù địch nó phân giải sang một toán tử KHÁC, phép suy thất bại, và
// `enqueueJob` ném 42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
// specification" — GIỮA transaction nghiệp vụ. Đã đo đúng như thế khi viết test
// "[QT3] ghim toán tử dưới một search_path thù địch": bản TRẦN ném, bản ghim chạy. Fail-CLOSED,
// nhưng là một đường DoS trên mọi lần xếp hàng, nên nó được đóng chứ không được ghi vào sổ nợ.
// ============================================================================================

const CAU_CHEN = `
  INSERT INTO public.outbox_jobs (org_id, kind, payload, dedupe_key, run_after)
  VALUES ($1::pg_catalog.uuid,
          $2::pg_catalog.text,
          $3::pg_catalog.jsonb,
          $4::pg_catalog.text,
          coalesce($5::pg_catalog.timestamptz, pg_catalog.clock_timestamp()))
  ON CONFLICT (org_id, kind, dedupe_key)
    WHERE dedupe_key IS NOT NULL
      AND status OPERATOR(pg_catalog.=) ANY (ARRAY['PENDING'::pg_catalog.text,
                                                   'RUNNING'::pg_catalog.text])
    DO NOTHING
  RETURNING id`;

const CAU_TIM_BAN_TRUNG = `
  SELECT id FROM public.outbox_jobs
   WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND kind OPERATOR(pg_catalog.=) $2::pg_catalog.text
     AND dedupe_key OPERATOR(pg_catalog.=) $3::pg_catalog.text
     AND status OPERATOR(pg_catalog.=) ANY (ARRAY['PENDING', 'RUNNING']::pg_catalog.text[])
   LIMIT 1`;

/**
 * Ghi job vào outbox. PHẢI gọi bằng `client` của CHÍNH transaction nghiệp vụ — không phải một
 * kết nối khác. Đó là toàn bộ điểm của mẫu transactional outbox: nếu transaction nghiệp vụ
 * rollback thì ý định gửi thông báo cũng biến mất, và nếu nó commit thì ý định ấy đã nằm trong
 * cùng một lần ghi đĩa.
 *
 * `orgId` PHẢI là tổ chức đang gắn trên client đó. Không có phép kiểm nào ở đây cho điều ấy, và
 * KHÔNG CẦN: vế `WITH CHECK (org_id = app_current_org_id())` của policy từ chối hàng lệch tổ
 * chức ở tầng CSDL. Nói đúng mức — đó là một bảo đảm của RLS, nên nó KHÔNG áp cho một phiên
 * không chịu RLS (superuser, hoặc role có BYPASSRLS).
 *
 * Trả về id của job vừa tạo, hoặc id của job TRÙNG ĐANG CHƯA KẾT THÚC khi có `dedupeKey`.
 */
export async function enqueueJob(
  client: pg.PoolClient,
  orgId: string,
  job: JobInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(CAU_CHEN, [
    orgId,
    job.kind,
    JSON.stringify(job.payload ?? {}),
    job.dedupeKey ?? null,
    job.runAfter ?? null,
  ]);

  const daTao = rows[0];
  if (daTao) return daTao.id;

  // Tới đây thì `DO NOTHING` đã nuốt một xung đột, nên nhất định có `dedupeKey`. Câu tìm bản
  // trùng PHẢI mang cùng vế `status IN ('PENDING','RUNNING')` với chỉ mục: không có nó, một
  // khoá đã được TRẢ LẠI bởi một job `DONE` cũ sẽ làm hàm này trả về id của cái xác đó — tức
  // người gọi cầm một id không bao giờ chạy nữa và tưởng mình đã xếp hàng thành công.
  const { rows: dangCho } = await client.query<{ id: string }>(CAU_TIM_BAN_TRUNG, [
    orgId,
    job.kind,
    job.dedupeKey,
  ]);
  const trung = dangCho[0];
  if (!trung) {
    // Cố ý KHÔNG nội suy `kind`, `dedupeKey` hay `orgId` vào thông báo — xem OutboxError.
    throw new OutboxError(
      "Không ghi được job và cũng không tìm thấy bản trùng đang chờ. Nguyên nhân khả dĩ: " +
        "hàng trùng thuộc một tổ chức khác nên RLS che nó khỏi phiên này, hoặc nó vừa " +
        "chuyển sang trạng thái cuối giữa hai câu lệnh.",
    );
  }
  return trung.id;
}
