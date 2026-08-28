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

export type JobHandler = (job: OutboxJob, client: pg.PoolClient) => Promise<void>;

/** Nguồn danh sách tổ chức mà runner phục vụ — xem docstring của `JobRunner`. */
export type OrganizationLister = () => Promise<readonly string[]> | readonly string[];

/**
 * Lý do một lần chạy job không thành công.
 *   `HANDLER_ERROR` handler đã chạy và ném.
 *   `NO_HANDLER`    không có handler cho `kind` này — lỗi CẤU HÌNH, bỏ cuộc ngay.
 *   `LEASE_LOST`    hạn thuê đã hết và một runner khác đã nhặt job này; runner cũ KHÔNG ghi
 *                   gì vào hàng đó. Mã này chỉ tới quan sát viên, KHÔNG BAO GIỜ vào CSDL —
 *                   `outbox_jobs.last_failure_reason` cố ý không có giá trị tương ứng.
 */
export type JobFailureReason = "HANDLER_ERROR" | "NO_HANDLER" | "LEASE_LOST";

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
 * Ném khi câu ghi kết cục chạm 0 hàng: hạn thuê đã mất. KHÔNG xuất ra khỏi gói — nó là một
 * tín hiệu nội bộ giữa `runOnceForOrg` và khối bắt lỗi của chính nó.
 */
class LeaseLostError extends Error {
  constructor() {
    super("hạn thuê đã mất");
    this.name = "LeaseLostError";
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
  readonly #listOrganizations: OrganizationLister | undefined;
  readonly #onJobFailure: ((report: JobFailureReport) => void) | undefined;
  readonly #onPollError: ((error: unknown) => void) | undefined;
  #timer: NodeJS.Timeout | null = null;
  #dangChay = false;

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
    this.#listOrganizations = options.listOrganizations;
    this.#onJobFailure = options.onJobFailure;
    this.#onPollError = options.onPollError;
  }

  /**
   * Lấy và xử lý một lô job của ĐÚNG MỘT tổ chức. Đây là nguyên thuỷ; `runOnce()` chỉ là vòng
   * lặp trên nó.
   *
   * Trả về số job mà LẦN CHẠY NÀY đã ghi được kết cục — thành công, hẹn thử lại, hoặc bỏ cuộc.
   * Job bị mất hạn thuê giữa chừng KHÔNG được tính, vì kết cục của nó do runner khác ghi.
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
        await withTenant(this.#pool, job.orgId, async (client) => {
          await handler(job, client);
          // Đánh dấu DONE trong CÙNG transaction với công việc của handler: hoặc cả hai cùng
          // được ghi, hoặc không cái nào. Không có cửa sổ nào mà handler đã ghi xong còn job
          // vẫn ở RUNNING.
          const ketQua = await client.query(CAU_XONG, [job.id, job.orgId, job.attempts]);
          if (ketQua.rowCount !== 1) throw new LeaseLostError();
        });
        xong += 1;
      } catch (loi) {
        if (loi instanceof LeaseLostError) {
          this.#baoLoi(job, "LEASE_LOST", false, loi);
          continue;
        }
        // [CẤM LOG] `loi` KHÔNG được nội suy vào SQL, không vào CSDL, không vào console. Chỉ
        // MÃ LÝ DO thuộc tập đóng đi vào `last_failure_reason` (ép bằng CHECK ở 007), còn lỗi
        // gốc đi tới `onJobFailure`. Xem "LỆCH KHỎI BRIEF (5/9)" ở 007_outbox.sql.
        const boCuoc = job.attempts >= this.#maxAttempts;
        if (await this.#ghiKetCuc(job, "HANDLER_ERROR", boCuoc, loi)) xong += 1;
      }
    }

    return xong;
  }

  /** Một lượt trên MỌI tổ chức mà `listOrganizations` trả về. */
  async runOnce(): Promise<number> {
    const nguon = this.#listOrganizations;
    if (!nguon) {
      throw new OutboxError(
        "JobRunner.runOnce() cần tuỳ chọn `listOrganizations`. Runner chạy trong ngữ cảnh " +
          "tenant nên nó KHÔNG tự đọc được danh sách tổ chức — đó là hệ quả cố ý của việc " +
          "không dùng role vượt RLS. Dùng runOnceForOrg(orgId) nếu bên gọi đã biết tổ chức.",
      );
    }
    let tong = 0;
    for (const orgId of await nguon()) {
      tong += await this.runOnceForOrg(orgId);
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
    lyDo: Exclude<JobFailureReason, "LEASE_LOST">,
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
      this.#baoLoi(job, "LEASE_LOST", false, nguyenNhan);
      return false;
    }
    this.#baoLoi(job, lyDo, boCuoc, nguyenNhan);
    return true;
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
