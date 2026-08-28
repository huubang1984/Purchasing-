import type pg from "pg";
import { withTenant } from "@trustprocure/tenancy";
import { OutboxError } from "./enqueue.js";

export interface OutboxJob {
  readonly id: string;
  readonly orgId: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  /**
   * Số lần job này ĐÃ ĐƯỢC THỬ, KỂ CẢ LẦN NÀY. `#claim` tăng bộ đếm rồi trả về giá trị đã
   * tăng, nên `attempts === 1` ở lần chạy đầu tiên. Xem "LỆCH KHỎI BRIEF (2/9)" ở
   * db/migrations/007_outbox.sql: brief đọc con số này như "số lần thử TRƯỚC lần này" ở một
   * chỗ và như "số lần đã thử" ở chỗ khác, và mâu thuẫn đó làm chính test của brief đỏ.
   */
  readonly attempts: number;
}

/**
 * Việc mà runner giao cho mã nghiệp vụ.
 *
 * ==========================================================================================
 * HỢP ĐỒNG VỀ `client` — ĐỌC TRƯỚC KHI VIẾT HANDLER ĐẦU TIÊN
 * ==========================================================================================
 * `client` đã được gắn ĐÚNG tổ chức của `job` và đang ở GIỮA một transaction. Ba giới hạn,
 * cả ba đều là hệ quả ĐO ĐƯỢC chứ không phải lời khuyên:
 *
 *   1. [vòng fix 1 Task 10 — MỤC 2] ĐỪNG dùng `SET` phạm vi PHIÊN. Dùng `SET LOCAL` (hoặc
 *      `set_config(..., true)`). `SET search_path`/`SET statement_timeout` không kèm `LOCAL`
 *      sống sót qua commit và đi theo kết nối — đo được: một handler đặt
 *      `SET statement_timeout = 1` làm job của TỔ CHỨC KHÁC trên cùng kết nối vào `FAILED`.
 *      Runner nay bật `destroyConnectionWhenDone` cho đúng transaction này, nên hậu quả bị
 *      chặn ở một kết nối bị vứt; nhưng thứ chặn nó là hàng rào, không phải handler.
 *   2. `client` mang TOÀN QUYỀN của `app_api` trên MỌI tổ chức, không riêng tổ chức của job.
 *      `app.org_id` là một GUC tuỳ biến thông thường: `set_config('app.org_id', <org khác>,
 *      true)` đổi được ngữ cảnh ngay giữa handler, đọc dữ liệu của tổ chức khác, rồi đặt lại
 *      — job vẫn `DONE` và KHÔNG để lại dấu vết nào. Giới hạn gốc có ghi ở
 *      packages/tenancy/src/with-tenant.ts; nó được NHẮC LẠI ở đây vì Task 10 là thứ biến nó
 *      từ một tai nạn thành một ĐIỂM MỞ RỘNG CÓ THIẾT KẾ. Lớp phòng thủ là code review và
 *      bất biến F, KHÔNG phải hàm nào trong gói này.
 *   3. Handler PHẢI idempotent (AT-LEAST-ONCE — xem docstring `JobRunner`), và phải chạy
 *      xong trong `handlerTimeoutMs`; quá hạn thì lượt chạy bị bỏ dở và job được hẹn lại.
 */
export type JobHandler = (job: OutboxJob, client: pg.PoolClient) => Promise<void>;

/**
 * Nguồn danh sách tổ chức mà runner phục vụ.
 *
 * ==========================================================================================
 * [vòng fix 1 Task 10 — MỤC 5] TÍNH CHẤT PHẢI CƯỠNG CHẾ Ở ĐÂY LÀ **ĐẦY ĐỦ + SỐNG**, KHÔNG
 * PHẢI **BÍ MẬT**
 * ==========================================================================================
 * Câu hỏi mà bản trước ghi vào sổ nợ ("ai được phép liệt kê mọi tổ chức, và bằng quyền gì?")
 * đúng nhưng THIẾU NỬA NGUY HIỂM HƠN. Nửa bí mật đã được đo là hẹp: `runOnceForOrg(orgId)`
 * chạy TRONG ngữ cảnh của chính tổ chức đó, nên một danh sách rò rỉ không mở đường đọc dữ
 * liệu nào — RLS vẫn cắt tập hàng ở tầng CSDL.
 *
 * Mối nguy thật đi theo CHIỀU NGƯỢC LẠI: một cổng BỎ SÓT một tổ chức làm job của tổ chức ấy
 * nằm im MÃI MÃI, IM LẶNG. Với B3 (job neo chuỗi kiểm toán) đó đúng là hình dạng "việc neo
 * chuỗi ngừng chạy mà không ai thấy gì đỏ" — cùng lớp hỏng hóc mà "LỆCH KHỎI BRIEF (1/9)"
 * của db/migrations/007_outbox.sql sinh ra để chống.
 *
 * HỢP ĐỒNG, nói thẳng để cài đặt sản phẩm không phải đoán:
 *   ĐẦY ĐỦ — trả về MỌI tổ chức có thể có job, không được lọc theo "tổ chức đang hoạt động",
 *            theo cache, hay theo ngữ cảnh tenant của người gọi;
 *   SỐNG   — một tổ chức MỚI tạo phải xuất hiện trong một số hữu hạn lượt poll; một danh
 *            sách tĩnh nạp lúc khởi động VI PHẠM vế này;
 *   BÍ MẬT — KHÔNG phải yêu cầu. Đừng đánh đổi hai vế trên để lấy nó.
 * Cài đặt nào không giữ được ĐẦY ĐỦ + SỐNG phải KÊU (ném), không được trả về danh sách cụt:
 * `runOnce()` báo lỗi của lister về `onPollError`, còn một danh sách cụt thì không ai thấy.
 *
 * Hôm nay CHƯA CÓ cài đặt sản phẩm nào (`apps/` còn rỗng). Đường cài đặt đã được đo là KHÔNG
 * cần role vượt RLS: một hàm `SECURITY DEFINER` do chủ sở hữu bảng sở hữu, `REVOKE FROM
 * PUBLIC` + `GRANT EXECUTE` cho đúng role runner, thân là `SELECT id FROM organizations` —
 * bán kính đúng bằng MỘT truy vấn trả về MỘT danh sách id, thay vì một THUỘC TÍNH ROLE có
 * bán kính "mọi bảng role này có hoặc SẼ CÓ quyền". CẢNH BÁO BẮT BUỘC nếu ai làm đường đó:
 * `hardening.always.sql` ghim THÂN hàm plpgsql theo một DANH SÁCH TÊN VIẾT TAY, nên hàm mới
 * KHÔNG được ghim và một `CREATE OR REPLACE` sau deploy sống sót qua `migrate()` (đo
 * end-to-end ở test `[T10-I]`). Hàm phải vào danh sách cưỡng chế thân hàm CÙNG LÚC với khi
 * nó ra đời, không phải sau.
 */
export type OrganizationLister = () => Promise<readonly string[]> | readonly string[];

/**
 * Lý do một lần chạy job không thành công.
 *   `HANDLER_ERROR`        handler đã chạy và ném.
 *   `HANDLER_TIMEOUT`      handler chưa xong khi hết `handlerTimeoutMs`; lượt chạy bị bỏ dở.
 *   `NO_HANDLER`           không có handler cho `kind` này — lỗi CẤU HÌNH, bỏ cuộc ngay.
 *   `OUTCOME_NOT_WRITTEN`  câu ghi kết cục chạm 0 hàng, nên runner này KHÔNG ghi gì vào hàng
 *                          đó. Mã này chỉ tới quan sát viên, KHÔNG BAO GIỜ vào CSDL —
 *                          `outbox_jobs.last_failure_reason` cố ý không có giá trị tương ứng
 *                          (không có hàng nào để ghi thì không có giá trị nào ghi được).
 *
 * [vòng fix 1 Task 10 — MỤC 6/M1] Mã này TỪNG tên là `LEASE_LOST`, và cái tên ấy SAI: nó gộp
 * BA nguyên nhân khác hẳn nhau dưới một chẩn đoán chỉ đúng cho MỘT trong ba, nên người vận
 * hành đi tìm một cuộc đua không tồn tại. Vị từ của câu ghi kết cục là
 * `(id, org_id, status = 'RUNNING', attempts = <giá trị đã claim>)`; nó chạm 0 hàng khi:
 *   (a) hạn thuê ĐÃ mất thật và runner khác đã claim lại (`attempts` đã tăng) — ca duy nhất
 *       mà cái tên cũ mô tả đúng;
 *   (b) chính handler đã đổi hàng đó trong transaction của nó (nó có `UPDATE` mức cột);
 *   (c) một người ghi khác của CÙNG tổ chức đã đổi `status`/`attempts` — xem khối
 *       "HỆ QUẢ ĐÃ BIẾT VÀ ĐƯỢC CHẤP NHẬN" ở db/migrations/007_outbox.sql: `app_api` sửa
 *       được hàng đợi của chính tổ chức mình.
 * Đo: cả ba ca đều báo `LEASE_LOST` trong khi hạn thuê CHƯA hề mất. Tên mới phát biểu đúng
 * thứ QUAN SÁT ĐƯỢC (kết cục không ghi được), không phát biểu một nguyên nhân đoán ra.
 */
export type JobFailureReason =
  | "HANDLER_ERROR"
  | "HANDLER_TIMEOUT"
  | "NO_HANDLER"
  | "OUTCOME_NOT_WRITTEN";

/**
 * Báo cáo gửi tới `onJobFailure`.
 *
 * [CẤM LOG] `cause` là lỗi GỐC do handler ném và nó CÓ THỂ mang giá, token, mã OTP — chính vì
 * thế nó KHÔNG đi vào CSDL và KHÔNG đi vào bất kỳ `console.*` nào của gói này. Nó tới đây, và
 * chỉ tới đây. Chính sách khử nhạy cảm của log là việc của composition root; một thư viện hàng
 * đợi không biết trường nào của một payload nghiệp vụ là bí mật.
 */
export interface JobFailureReport {
  readonly jobId: string;
  readonly orgId: string;
  readonly kind: string;
  readonly attempts: number;
  readonly reason: JobFailureReason;
  /** `true` nếu job vừa chuyển sang `FAILED` (hết lượt hoặc bỏ cuộc ngay). */
  readonly gaveUp: boolean;
  readonly cause: unknown;
}

export interface JobRunnerOptions {
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly retryDelaySeconds?: number;
  readonly pollIntervalMs?: number;
  /**
   * Hạn thuê của một lần claim. Hết hạn mà job vẫn ở `RUNNING` thì runner BẤT KỲ nhặt lại
   * được — xem "LỆCH KHỎI BRIEF (3/9)" ở db/migrations/007_outbox.sql.
   */
  readonly leaseSeconds?: number;
  /**
   * Trần thời gian cho MỘT lần chạy handler. Mặc định `leaseSeconds * 1000`, và trần cứng
   * cũng là `leaseSeconds * 1000` — xem "[vòng fix 1 Task 10 — MỤC 3]" ở `runOnceForOrg`.
   */
  readonly handlerTimeoutMs?: number;
  /** Nguồn danh sách tổ chức. BẮT BUỘC nếu gọi `runOnce()` hoặc `start()`. */
  readonly listOrganizations?: OrganizationLister;
  /** Quan sát viên. MẶC ĐỊNH IM LẶNG — gói này không tự ghi log bao giờ. */
  readonly onJobFailure?: (report: JobFailureReport) => void;
  /** Quan sát viên cho lỗi của chính vòng poll (mất kết nối, lister ném). Mặc định im lặng. */
  readonly onPollError?: (error: unknown) => void;
}

interface HangDaClaim {
  id: string;
  org_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Ném khi câu ghi kết cục chạm 0 hàng. KHÔNG xuất ra khỏi gói — nó là một tín hiệu nội bộ
 * giữa `runOnceForOrg` và khối bắt lỗi của chính nó. Xem `JobFailureReason` để biết vì sao
 * tên này KHÔNG còn là `LeaseLostError`.
 */
class KetCucKhongGhiDuocError extends Error {
  constructor() {
    super("câu ghi kết cục chạm 0 hàng");
    this.name = "KetCucKhongGhiDuocError";
  }
}

/**
 * Ném khi handler chưa xong lúc hết `handlerTimeoutMs`. Cũng KHÔNG xuất ra khỏi gói.
 */
class HetGioHandlerError extends Error {
  constructor(pMs: number) {
    // Nội suy đúng MỘT con số do CHÍNH mã này giữ (một tuỳ chọn đã qua `khangDinhTrong`),
    // không phải dữ liệu người dùng — cùng khuôn với RangeError của `khangDinhTrong`.
    super(`handler chưa xong sau ${String(pMs)} ms`);
    this.name = "HetGioHandlerError";
  }
}

// ============================================================================================
// [QT3] Xem khối cùng tên ở packages/outbox/src/enqueue.ts. Mọi câu dưới đây ghim đủ ba trục.
//
// VÀ MỘT VẾ NỮA, ĐÂY LÀ VẾ CHỊU LỰC: mọi câu đều mang `org_id = $<orgId>` TƯỜNG MINH dù RLS đã
// cắt tập hàng. Task 8 (vòng xác minh fix 2, Phát hiện #2) ĐO được rằng câu "RLS đã giới hạn
// tập hàng" là VÔ ĐIỀU KIỆN và SAI với phiên superuser/BYPASSRLS: gỡ đúng vế ghim ấy khỏi một
// truy vấn của gói audit làm tập hàng TRÀN RA NGOÀI TỔ CHỨC (checked = 3 -> 10). Ở đây hậu quả
// nặng hơn một bước, vì runner không chỉ ĐỌC: thiếu vế đó, một `JobRunner` chạy trên pool
// superuser (đúng thứ brief đề nghị) sẽ claim job của tổ chức KHÁC rồi giao cho handler kèm
// `app.org_id` của tổ chức ĐANG XÉT — tức chạy việc của B dưới ngữ cảnh của A.
// ============================================================================================

const CAU_CLAIM = `
  UPDATE public.outbox_jobs AS j
     SET status = 'RUNNING',
         attempts = j.attempts OPERATOR(pg_catalog.+) 1,
         lease_expires_at = pg_catalog.clock_timestamp()
             OPERATOR(pg_catalog.+) pg_catalog.make_interval(secs => $3::pg_catalog.float8)
   WHERE j.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND j.id OPERATOR(pg_catalog.=) ANY (
           SELECT s.id
             FROM public.outbox_jobs s
            WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
              AND ((s.status OPERATOR(pg_catalog.=) 'PENDING'::pg_catalog.text
                    AND s.run_after OPERATOR(pg_catalog.<=) pg_catalog.clock_timestamp())
                OR (s.status OPERATOR(pg_catalog.=) 'RUNNING'::pg_catalog.text
                    AND s.lease_expires_at OPERATOR(pg_catalog.<) pg_catalog.clock_timestamp()))
            ORDER BY s.run_after, s.id
            LIMIT $2::pg_catalog.int4
            FOR UPDATE SKIP LOCKED)
  RETURNING j.id, j.org_id, j.kind, j.payload, j.attempts`;

// Vế `attempts = $3` là hàng rào chống GHI ĐÈ SAU KHI MẤT HẠN THUÊ: một runner bị treo quá
// `leaseSeconds` quay lại thì job đã được runner khác claim và `attempts` đã tăng, nên câu này
// chạm 0 hàng thay vì đánh dấu DONE cho một lần chạy không còn ai công nhận.
const CAU_XONG = `
  UPDATE public.outbox_jobs
     SET status = 'DONE',
         lease_expires_at = NULL,
         finished_at = pg_catalog.clock_timestamp()
   WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND org_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
     AND status OPERATOR(pg_catalog.=) 'RUNNING'::pg_catalog.text
     AND attempts OPERATOR(pg_catalog.=) $3::pg_catalog.int4`;

// `run_after` được GIỮ NGUYÊN trên nhánh bỏ cuộc — xem "LỆCH KHỎI BRIEF (7/9)": ghi đè nó bằng
// `now() + 0` chỉ xoá lịch gốc của một hàng ở trạng thái cuối, tức xoá đúng thứ người điều tra
// một job chết cần đọc.
const CAU_KET_CUC = `
  UPDATE public.outbox_jobs
     SET status = CASE WHEN $4::pg_catalog.bool THEN 'FAILED' ELSE 'PENDING' END,
         last_failure_reason = $5::pg_catalog.text,
         run_after = CASE WHEN $4::pg_catalog.bool THEN run_after
                          ELSE pg_catalog.clock_timestamp() OPERATOR(pg_catalog.+)
                               pg_catalog.make_interval(secs => $6::pg_catalog.float8) END,
         lease_expires_at = NULL,
         finished_at = CASE WHEN $4::pg_catalog.bool
                            THEN pg_catalog.clock_timestamp() ELSE NULL END
   WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
     AND org_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
     AND status OPERATOR(pg_catalog.=) 'RUNNING'::pg_catalog.text
     AND attempts OPERATOR(pg_catalog.=) $3::pg_catalog.int4`;

// ============================================================================================
// TRẦN CỦA MỌI THAM SỐ MẶT TIỀN — QT2, và đây là bài học ĐÃ TRẢ GIÁ của Task 9 §I4: `window` và
// `maxFailedAttempts` từng do người gọi truyền KHÔNG CÓ CẬN TRÊN, và đo được rằng một giá trị
// lớn biến một bảo đảm an ninh thành vô nghĩa (window = 200000 -> mã 30 phút tuổi được chấp
// nhận, 8,7 giây CPU trong MỘT lời gọi). Ở đây các trần rẻ hơn nhiều nhưng cùng khuôn:
//   batchSize        quá lớn -> một transaction claim giữ khoá trên cả hàng đợi;
//   maxAttempts      quá lớn -> một job hỏng vĩnh viễn quay vòng mãi, không bao giờ vào FAILED;
//   pollIntervalMs   quá nhỏ -> vòng poll biến thành vòng bận;
//   leaseSeconds     quá lớn -> đúng lỗ mà lease sinh ra để đóng, chỉ chậm hơn.
// Các con số là CHÍNH SÁCH, không phải kết quả đo — nói ra thay vì để người đọc tưởng ngược lại.
// ============================================================================================
export const MAX_BATCH_SIZE = 1000;
export const MAX_ATTEMPTS_LIMIT = 100;
export const MAX_RETRY_DELAY_SECONDS = 86_400;
export const MIN_POLL_INTERVAL_MS = 10;
export const MAX_POLL_INTERVAL_MS = 3_600_000;
export const MAX_LEASE_SECONDS = 3_600;
/**
 * Trần TUYỆT ĐỐI của `handlerTimeoutMs`. Trần THẬT còn hẹp hơn — `leaseSeconds * 1000` — và
 * hằng này chỉ tồn tại để phép kiểm tham số có một cận trên viết ra được khi `leaseSeconds`
 * ở giá trị lớn nhất.
 */
export const MAX_HANDLER_TIMEOUT_MS = MAX_LEASE_SECONDS * 1000;

function khangDinhTrong(pTen: string, pGiaTri: number, pMin: number, pMax: number): number {
  if (!Number.isInteger(pGiaTri) || pGiaTri < pMin || pGiaTri > pMax) {
    // Nội suy TÊN tuỳ chọn và hai cận — cả ba là hằng của chính mã này, không phải dữ liệu
    // người dùng. Giá trị bị từ chối KHÔNG được nội suy, cùng khuôn với OutboxError.
    throw new RangeError(`JobRunner: tuỳ chọn "${pTen}" phải là số nguyên trong [${pMin}, ${pMax}].`);
  }
  return pGiaTri;
}

/**
 * Chạy các job đã nằm trong outbox.
 *
 * ==========================================================================================
 * RUNNER CHẠY TRONG NGỮ CẢNH TENANT — KHÔNG CÓ POOL NÀO VƯỢT RLS Ở ĐÂY
 * ==========================================================================================
 * Brief đề nghị `JobRunner` nhận một pool "có quyền vượt RLS" (trong test là superuser của
 * Testcontainers, khi triển khai thật là một role `app_worker` có `BYPASSRLS`). Ba lý do đã đo
 * để KHÔNG làm thế — xem "LỆCH KHỎI BRIEF (4/9)" ở db/migrations/007_outbox.sql và các test
 * `[T10-D]`. Tóm tắt: siêu người dùng KHÁC role có BYPASSRLS (nó còn bỏ qua FORCE RLS, ACL mức
 * cột và mọi GRANT), nên một bộ test chạy trên pool ấy không đo được một dòng nào của khuôn
 * triển khai thật; và `BYPASSRLS` là thuộc tính của ROLE chứ không theo từng bảng, nên "chỉ cấp
 * quyền trên outbox_jobs" giới hạn bán kính bằng GRANT, KHÔNG bằng BYPASSRLS.
 *
 * Thay vào đó: `pool` là pool ỨNG DỤNG bình thường (`app_api`), và mọi câu lệnh chạy bên trong
 * `withTenant(pool, orgId, ...)`. Ba hệ quả, cả ba là điều mong muốn:
 *   * claim, handler và câu ghi kết cục đều chịu RLS + FORCE RLS + GRANT mức cột;
 *   * handler nhận một `client` ĐÃ gắn đúng tổ chức, nên mã nghiệp vụ nó gọi không cần biết gì
 *     về outbox;
 *   * runner KHÔNG tự đọc được danh sách tổ chức (`organizations` cũng bật RLS).
 *
 * Hệ quả thứ ba là CÁI GIÁ, và nó được trả bằng một CỔNG chứ không bằng một role vượt RLS:
 * `options.listOrganizations` do composition root tiêm vào. Hôm nay KHÔNG có cài đặt sản phẩm
 * nào cho cổng đó vì `apps/` còn rỗng — cùng tình trạng với `TotpSecretUnsealer` của Task 9, và
 * được ghi vào sổ nợ thay vì bị che.
 *
 * ==========================================================================================
 * AT-LEAST-ONCE — HỢP ĐỒNG VỚI NGƯỜI VIẾT HANDLER
 * ==========================================================================================
 * Handler PHẢI idempotent. Một handler chạy quá `leaseSeconds` sẽ thấy job của mình bị runner
 * khác nhặt lại. Đó là tính chất của MỌI hàng đợi có đường thu hồi; lựa chọn thay thế (không
 * thu hồi) là at-most-once kèm rò rỉ VĨNH VIỄN khi tiến trình chết giữa chừng.
 * Cái mã này mua được, và nó không tầm thường: câu ghi kết cục mang vế `attempts = <giá trị đã
 * claim>`, nên runner ĐÃ MẤT hạn thuê không ghi đè được kết cục do runner mới đặt, và công việc
 * CSDL của nó bị rollback (nó nằm cùng transaction với câu đánh dấu DONE).
 */
export class JobRunner {
  readonly #pool: pg.Pool;
  readonly #handlers: Readonly<Record<string, JobHandler>>;
  readonly #batchSize: number;
  readonly #maxAttempts: number;
  readonly #retryDelaySeconds: number;
  readonly #pollIntervalMs: number;
  readonly #leaseSeconds: number;
  readonly #handlerTimeoutMs: number;
  readonly #listOrganizations: OrganizationLister | undefined;
  readonly #onJobFailure: ((report: JobFailureReport) => void) | undefined;
  readonly #onPollError: ((error: unknown) => void) | undefined;
  #timer: NodeJS.Timeout | null = null;
  #dangChay = false;
  /**
   * Điểm bắt đầu của lượt duyệt tổ chức KẾ TIẾP — xem vế (c) của "[vòng fix 1 Task 10 —
   * MỤC 3]" ở `runOnce()`.
   */
  #diemXoayVong = 0;

  constructor(
    pool: pg.Pool,
    handlers: Readonly<Record<string, JobHandler>>,
    options: JobRunnerOptions = {},
  ) {
    this.#pool = pool;
    this.#handlers = handlers;
    this.#batchSize = khangDinhTrong("batchSize", options.batchSize ?? 10, 1, MAX_BATCH_SIZE);
    this.#maxAttempts = khangDinhTrong(
      "maxAttempts",
      options.maxAttempts ?? 5,
      1,
      MAX_ATTEMPTS_LIMIT,
    );
    this.#retryDelaySeconds = khangDinhTrong(
      "retryDelaySeconds",
      options.retryDelaySeconds ?? 30,
      0,
      MAX_RETRY_DELAY_SECONDS,
    );
    this.#pollIntervalMs = khangDinhTrong(
      "pollIntervalMs",
      options.pollIntervalMs ?? 1000,
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS,
    );
    this.#leaseSeconds = khangDinhTrong("leaseSeconds", options.leaseSeconds ?? 60, 1, MAX_LEASE_SECONDS);
    // [vòng fix 1 Task 10 — MỤC 3] Trần của handler bị CHẶN TRÊN bởi chính hạn thuê, và điều
    // đó MIỄN PHÍ VỀ NGỮ NGHĨA: một handler chạy quá hạn thuê sẽ thấy job của mình đã bị runner
    // khác claim lại, nên câu ghi kết cục của nó chạm 0 hàng — kết cục của lượt ấy đằng nào
    // cũng bị từ chối. Cho phép một trần lớn hơn hạn thuê chỉ mua thêm thời gian chờ một kết
    // quả không ai công nhận.
    this.#handlerTimeoutMs = khangDinhTrong(
      "handlerTimeoutMs",
      options.handlerTimeoutMs ?? this.#leaseSeconds * 1000,
      1,
      this.#leaseSeconds * 1000,
    );
    this.#listOrganizations = options.listOrganizations;
    this.#onJobFailure = options.onJobFailure;
    this.#onPollError = options.onPollError;
  }

  /**
   * Lấy và xử lý một lô job của ĐÚNG MỘT tổ chức. Đây là nguyên thuỷ; `runOnce()` chỉ là vòng
   * lặp trên nó.
   *
   * Trả về số job mà LẦN CHẠY NÀY đã ghi được kết cục — thành công, hẹn thử lại, hoặc bỏ cuộc.
   * Job mà câu ghi kết cục chạm 0 hàng KHÔNG được tính, vì kết cục của nó do người khác ghi.
   *
   * [vòng fix 1 Task 10 — MỤC 6/M4] `orgId` là THAM SỐ TUỲ Ý và phương thức này CÔNG KHAI: nó
   * KHÔNG đối chiếu với `listOrganizations`, và cố ý thế — `runOnce()` là vòng lặp trên nó chứ
   * không phải cổng gác của nó. Vì sao điều đó không mở đường rò: mọi câu lệnh chạy trong
   * `withTenant(pool, orgId, ...)` dưới `app_api`, nên RLS + FORCE RLS + GRANT mức cột quyết
   * định thấy được gì; một `orgId` không tồn tại hoặc không phải của người gọi cho ra 0 hàng,
   * không phải dữ liệu của người khác. Hệ quả còn lại là VẬN HÀNH: gọi thẳng phương thức này
   * cho một tập tổ chức CỤT làm những tổ chức còn lại không được phục vụ — xem hợp đồng ĐẦY
   * ĐỦ + SỐNG ở `OrganizationLister`.
   *
   * ==========================================================================================
   * [vòng fix 1 Task 10 — MỤC 3] HÀNG RÀO THỜI GIAN CỦA HANDLER — HAI NỬA, VÀ MỘT CA NGOÀI TẦM
   * ==========================================================================================
   * Bản trước `await handler(...)` KHÔNG có trần nào. Đo: một handler treo làm tổ chức đứng
   * SAU trong danh sách KHÔNG được phục vụ chút nào sau 3 giây; `stop()` tự tài liệu là không
   * huỷ lượt đang chạy. Nay có hai nửa, và chúng chặn hai lớp hỏng hóc KHÁC NHAU:
   *   * nửa CSDL — `statement_timeout` phạm vi LOCAL đặt trên chính transaction của handler:
   *     một câu lệnh treo (khoá, truy vấn nặng, `pg_sleep`) bị PostgreSQL huỷ, và kết nối được
   *     trả lại. Đây là nửa DUY NHẤT gỡ được một kết nối đang bận.
   *   * nửa JS — `Promise.race`: một handler treo NGOÀI CSDL (gọi HTTP quên timeout, một
   *     `await` không bao giờ giải quyết) không sinh câu lệnh nào để `statement_timeout` huỷ.
   * CA NGOÀI TẦM, nói ra thay vì để người đọc tưởng đã kín: một handler CỐ Ý phát câu lệnh
   * ngắn liên tục trong vòng lặp vô hạn ĐI QUA cả hai nửa (mỗi câu đều dưới trần, và hàng đợi
   * câu lệnh của client không bao giờ rỗng để `ROLLBACK` chen vào). Handler là mã NỘI BỘ, nên
   * đường phòng thủ ở đó là code review; hàng rào này nhắm những cách hỏng THẬT SỰ HAY GẶP.
   */
  async runOnceForOrg(orgId: string): Promise<number> {
    const daClaim = await withTenant(this.#pool, orgId, async (client) => {
      const { rows } = await client.query<HangDaClaim>(CAU_CLAIM, [
        orgId,
        this.#batchSize,
        this.#leaseSeconds,
      ]);
      return rows;
    });

    let xong = 0;
    for (const hang of daClaim) {
      const job: OutboxJob = {
        id: hang.id,
        orgId: hang.org_id,
        kind: hang.kind,
        payload: hang.payload,
        attempts: hang.attempts,
      };

      const handler = this.#handlers[job.kind];
      if (!handler) {
        // Không có handler là lỗi CẤU HÌNH, không phải lỗi tạm thời — bỏ cuộc ngay thay vì thử
        // lại mãi và che mất vấn đề. Đây cũng là vế "job không treo": một `kind` lạ đi tới
        // trạng thái cuối, nên nó không chiếm khoá chống trùng và không quay vòng vô hạn.
        if (await this.#ghiKetCuc(job, "NO_HANDLER", true, undefined)) xong += 1;
        continue;
      }

      try {
        await withTenant(
          this.#pool,
          job.orgId,
          async (client) => {
            // Nửa CSDL của hàng rào thời gian. `set_config(..., true)` = `SET LOCAL`, nên nó
            // biến mất cùng transaction và KHÔNG đi theo kết nối. Ghim `pg_catalog.` cùng lý do
            // với mọi câu khác của gói này (khối [QT3]).
            await client.query("SELECT pg_catalog.set_config('statement_timeout', $1, true)", [
              String(this.#handlerTimeoutMs),
            ]);
            await this.#chayCoHanGio(handler(job, client));
            // Đánh dấu DONE trong CÙNG transaction với công việc của handler: hoặc cả hai cùng
            // được ghi, hoặc không cái nào. Không có cửa sổ nào mà handler đã ghi xong còn job
            // vẫn ở RUNNING.
            const ketQua = await client.query(CAU_XONG, [job.id, job.orgId, job.attempts]);
            if (ketQua.rowCount !== 1) throw new KetCucKhongGhiDuocError();
          },
          // [vòng fix 1 Task 10 — MỤC 2] ĐÂY là transaction DUY NHẤT của gói giao `client` cho
          // mã của người khác, nên nó là chỗ DUY NHẤT bật cờ huỷ kết nối. Hai transaction kia
          // (claim, ghi kết cục) chỉ chạy SQL của chính runner.
          { destroyConnectionWhenDone: true },
        );
        xong += 1;
      } catch (loi) {
        if (loi instanceof KetCucKhongGhiDuocError) {
          this.#baoLoi(job, "OUTCOME_NOT_WRITTEN", false, loi);
          continue;
        }
        // [CẤM LOG] `loi` KHÔNG được nội suy vào SQL, không vào CSDL, không vào console. Chỉ
        // MÃ LÝ DO thuộc tập đóng đi vào `last_failure_reason` (ép bằng CHECK ở 007), còn lỗi
        // gốc đi tới `onJobFailure`. Xem "LỆCH KHỎI BRIEF (5/9)" ở 007_outbox.sql.
        //
        // [vòng fix 1 Task 10 — MỤC 6/M5] KHỐI NÀY RỘNG, VÀ ĐIỀU ĐÓ ĐƯỢC NÓI RA THAY VÌ ĐỂ
        // NGƯỜI ĐỌC TƯỞNG NGƯỢC LẠI: nó bắt MỌI lỗi của `withTenant` — mất kết nối, lỗi RLS,
        // lỗi cú pháp trong SQL của chính runner — và ghi tất cả thành `HANDLER_ERROR`, đốt
        // một lượt thử. Sau `maxAttempts` job vào `FAILED` và KHÔNG có đường tự động nào đưa nó
        // về `PENDING`; đường sửa hôm nay là một `UPDATE` tay (và phải đặt lại CẢ `status` lẫn
        // `finished_at` vì hai CHECK khoá chúng với nhau). Vì sao chưa đóng: phân loại "lỗi hạ
        // tầng" với "lỗi nghiệp vụ" phải dựa trên một DANH SÁCH mã lỗi PostgreSQL, và một danh
        // sách như thế tự nó là một hàng rào tự làm mù mình bằng danh sách tên — đúng lớp
        // khiếm khuyết mà `[T10-D]` vế (c) vừa đo trên hardening. Nó cần một quyết định riêng,
        // không phải một dòng thêm ở đây. Sổ nợ §5.
        const lyDo = loi instanceof HetGioHandlerError ? "HANDLER_TIMEOUT" : "HANDLER_ERROR";
        const boCuoc = job.attempts >= this.#maxAttempts;
        if (await this.#ghiKetCuc(job, lyDo, boCuoc, loi)) xong += 1;
      }
    }

    return xong;
  }

  /**
   * Một lượt trên MỌI tổ chức mà `listOrganizations` trả về.
   *
   * ==========================================================================================
   * [vòng fix 1 Task 10 — MỤC 3] MỘT TỔ CHỨC KHÔNG ĐƯỢC LÀM ĐỨNG CẢ DANH SÁCH
   * ==========================================================================================
   * Bản trước KHÔNG có `try/catch` quanh `runOnceForOrg`, nên lỗi của tổ chức ĐẦU TIÊN dừng
   * cả lượt. Đo: với một lỗi thường trực ("permission denied for table outbox_jobs" trên tổ
   * chức đầu), danh sách ĐÃ PHỤC VỤ = []. Trong `start()` lỗi ấy đi tới `onPollError` — MẶC
   * ĐỊNH IM LẶNG — rồi lượt sau lặp lại y hệt: runner chết MÃI MÃI ở tổ chức đầu tiên và
   * KHÔNG BAO GIỜ phục vụ các tổ chức phía sau, không một tiếng động. Với B3 (job neo chuỗi
   * kiểm toán) đó là "việc neo chuỗi của MỌI tổ chức ngừng chạy vì MỘT tổ chức" — đúng hình
   * dạng fail-OPEN, IM LẶNG mà "LỆCH KHỎI BRIEF (1/9)" của 007_outbox.sql viết ra để chống,
   * chỉ ở một tầng khác.
   *
   * Ba vế của bản vá:
   *   (a) trần thời gian cho handler — xem `runOnceForOrg`;
   *   (b) `try/catch` TỪNG tổ chức rồi ĐI TIẾP, báo về `onPollError`. Lỗi của CHÍNH lister
   *       vẫn ném ra ngoài: không có danh sách thì không có gì để đi tiếp, và nuốt nó đúng là
   *       lớp "im lặng" đang bị vá;
   *   (c) XOAY VÒNG điểm bắt đầu giữa các lượt. Không có nó, (b) mới chỉ sửa được ca "tổ chức
   *       đầu NÉM"; ca "tổ chức đầu CHẬM" vẫn ăn hết ngân sách thời gian của mọi lượt và các
   *       tổ chức cuối danh sách vẫn đói. Xoay vòng biến một sự đói VĨNH VIỄN thành một độ trễ
   *       CÓ CẬN.
   * Cái này KHÔNG mua được, nói ra thay vì hứa suông: nó vẫn là một lượt TUẦN TỰ. Tổng thời
   * gian một lượt vẫn là tổng của mọi tổ chức, nên `handlerTimeoutMs * batchSize * số tổ chức`
   * là cận trên thật của một chu kỳ. Chạy song song là một quyết định khác (bán kính pool,
   * thứ tự khoá) và nó KHÔNG được ra ở đây.
   */
  async runOnce(): Promise<number> {
    const nguon = this.#listOrganizations;
    if (!nguon) {
      throw new OutboxError(
        "JobRunner.runOnce() cần tuỳ chọn `listOrganizations`. Runner chạy trong ngữ cảnh " +
          "tenant nên nó KHÔNG tự đọc được danh sách tổ chức — đó là hệ quả cố ý của việc " +
          "không dùng role vượt RLS. Dùng runOnceForOrg(orgId) nếu bên gọi đã biết tổ chức.",
      );
    }
    const danhSach = await nguon();
    if (danhSach.length === 0) return 0;

    const batDau = this.#diemXoayVong % danhSach.length;
    this.#diemXoayVong = (batDau + 1) % danhSach.length;

    let tong = 0;
    for (let i = 0; i < danhSach.length; i += 1) {
      const orgId = danhSach[(batDau + i) % danhSach.length]!;
      try {
        tong += await this.runOnceForOrg(orgId);
      } catch (loi) {
        // Quan sát viên là mã của người khác — nó ném thì lượt này KHÔNG được đổ theo, y hệt
        // khuôn `#baoLoi`. Nuốt có chủ đích, và nói ra.
        try {
          this.#onPollError?.(loi);
        } catch {
          /* quan sát viên hỏng không được làm hỏng hàng đợi */
        }
      }
    }
    return tong;
  }

  /**
   * Bắt đầu vòng poll. KHÔNG ghi log — lỗi của một lượt đi tới `onPollError`, mặc định im lặng.
   * Gọi lần thứ hai khi đang chạy là no-op (không dựng hai vòng trên cùng một runner).
   */
  start(): void {
    if (this.#dangChay) return;
    this.#dangChay = true;
    const nhip = async (): Promise<void> => {
      if (!this.#dangChay) return;
      try {
        await this.runOnce();
      } catch (loi) {
        this.#onPollError?.(loi);
      }
      if (this.#dangChay) this.#timer = setTimeout(() => void nhip(), this.#pollIntervalMs);
    };
    void nhip();
  }

  /**
   * Dừng vòng poll. Nói đúng mức: nó ngăn lượt KẾ TIẾP được hẹn, KHÔNG huỷ lượt đang chạy dở —
   * lượt ấy chạy hết rồi mới thấy cờ. Một job đang trong tay handler vẫn chạy tới cùng.
   */
  stop(): void {
    this.#dangChay = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * Ghi kết cục trong một transaction RIÊNG. Phải riêng: transaction của handler đã rollback,
   * nên mọi câu ghi trong đó cũng biến mất.
   * Trả về `true` nếu câu lệnh thật sự chạm hàng — `false` nghĩa là hạn thuê đã mất.
   */
  async #ghiKetCuc(
    job: OutboxJob,
    lyDo: Exclude<JobFailureReason, "OUTCOME_NOT_WRITTEN">,
    boCuoc: boolean,
    nguyenNhan: unknown,
  ): Promise<boolean> {
    const ketQua = await withTenant(this.#pool, job.orgId, (client) =>
      client.query(CAU_KET_CUC, [
        job.id,
        job.orgId,
        job.attempts,
        boCuoc,
        lyDo,
        this.#retryDelaySeconds,
      ]),
    );
    if (ketQua.rowCount !== 1) {
      this.#baoLoi(job, "OUTCOME_NOT_WRITTEN", false, nguyenNhan);
      return false;
    }
    this.#baoLoi(job, lyDo, boCuoc, nguyenNhan);
    return true;
  }

  /**
   * Nửa JS của hàng rào thời gian — xem `runOnceForOrg`. Bộ đếm giờ LUÔN được dọn, kể cả trên
   * đường thành công: một `setTimeout` còn sống giữ tiến trình Node không thoát được, và một
   * runner để lại một bộ đếm cho MỖI job là một rò rỉ đo được ngay trên đường đi bình thường.
   */
  async #chayCoHanGio(viec: Promise<void>): Promise<void> {
    let dongHo: NodeJS.Timeout | undefined;
    const hetGio = new Promise<never>((_, reject) => {
      dongHo = setTimeout(() => {
        reject(new HetGioHandlerError(this.#handlerTimeoutMs));
      }, this.#handlerTimeoutMs);
    });
    try {
      await Promise.race([viec, hetGio]);
    } finally {
      if (dongHo) clearTimeout(dongHo);
      // Lời hứa THUA cuộc đua vẫn còn sống và vẫn có thể ném về sau. Một `rejection` không ai
      // bắt sẽ giết cả tiến trình Node (cùng lớp lỗ với listener 'error' của pg-pool đã đóng ở
      // packages/tenancy/src/with-tenant.ts). Gắn một người nghe rỗng, KHÔNG phải để bỏ qua —
      // nguyên nhân thật đã đi tới `onJobFailure` qua `HetGioHandlerError`.
      void viec.catch(() => undefined);
    }
  }

  #baoLoi(job: OutboxJob, lyDo: JobFailureReason, boCuoc: boolean, nguyenNhan: unknown): void {
    // Quan sát viên là mã của người khác: nó ném thì runner KHÔNG được đổ theo. Nuốt có chủ
    // đích, và nói ra — cùng khuôn `onThongBao` của migrate() (Task 8 vòng fix 2).
    try {
      this.#onJobFailure?.({
        jobId: job.id,
        orgId: job.orgId,
        kind: job.kind,
        attempts: job.attempts,
        reason: lyDo,
        gaveUp: boCuoc,
        cause: nguyenNhan,
      });
    } catch {
      /* quan sát viên hỏng không được làm hỏng hàng đợi */
    }
  }
}
