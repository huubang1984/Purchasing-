import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  JobRunner,
  enqueueJob,
  type JobFailureReport,
  type JobHandler,
  type OutboxJob,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgId: string;
let orgKhac: string;
let demToChuc = 0;

interface HangOutbox {
  id: string;
  org_id: string;
  kind: string;
  status: string;
  attempts: number;
  last_failure_reason: string | null;
  run_after: Date;
  lease_expires_at: Date | null;
  finished_at: Date | null;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
}

/**
 * MỖI TEST MỘT TỔ CHỨC MỚI. Không phải sự sạch sẽ tuỳ thích: runner nhặt việc theo TỔ CHỨC, nên
 * một job PENDING còn sót của test trước sẽ lọt vào lô của test sau và làm mọi phép ĐẾM sai —
 * và sai theo hướng KHÓ THẤY (số lớn hơn kỳ vọng, không phải nhỏ hơn).
 */
async function toChucMoi(): Promise<string> {
  demToChuc += 1;
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`To chuc ${demToChuc}`, `t10-${demToChuc}`],
  );
  return rows[0]!.id;
}

/** Đọc hàng bằng phiên SIÊU NGƯỜI DÙNG — quan sát, không phải đường sản phẩm. */
async function docHang(pId: string): Promise<HangOutbox> {
  const { rows } = await db.pool.query<HangOutbox>(
    "SELECT * FROM outbox_jobs WHERE id = $1::uuid",
    [pId],
  );
  const hang = rows[0];
  if (!hang) throw new Error(`không tìm thấy hàng outbox ${pId}`);
  return hang;
}

/**
 * Chờ tới khi hàng ĐẠT ĐÚNG trạng thái mong đợi, quan sát được ở CSDL — KHÔNG "ngủ rồi đi
 * tiếp". Hết thời gian là ĐỎ, không phải đi tiếp: một cửa sổ đua không ép được thì test sau nó
 * đo một thứ khác với thứ nó nói.
 */
async function choTrangThai(pId: string, pStatus: string, pAttempts: number): Promise<void> {
  for (let i = 0; i < 800; i += 1) {
    const { rows } = await db.pool.query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM outbox_jobs WHERE id = $1::uuid",
      [pId],
    );
    if (rows[0]?.status === pStatus && rows[0].attempts === pAttempts) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  const cuoi = await docHang(pId);
  throw new Error(
    `hết thời gian chờ trạng thái ${pStatus}/${String(pAttempts)} — hiện là ` +
      `${cuoi.status}/${String(cuoi.attempts)}`,
  );
}

// ------------------------------------------------------------------------------------------
// DỌN DẸP TẤT ĐỊNH CHO CÁC TEST DÙNG CỔNG.
// Ba test ép cửa sổ đua bằng một CỔNG do chính test giữ. Nếu một khẳng định đỏ TRƯỚC câu mở
// cổng, promise của runner treo VĨNH VIỄN và nó đang GIỮ MỘT CLIENT của `apiPool` (max 3) —
// ba test sau đó chết đói vì hết kết nối. Đo được trong lúc chạy đột biến: một mũi làm ĐỎ đúng
// HAI khẳng định lại báo 14 test đỏ, tức 12 lỗi GIẢ che mất tín hiệu thật.
// Khối `afterEach` dưới đây mở mọi cổng và chờ mọi lượt chạy kết thúc, nên một test đỏ chỉ làm
// đỏ CHÍNH NÓ.
// ------------------------------------------------------------------------------------------
const CONG: (() => void)[] = [];
const LUOT: Promise<unknown>[] = [];

function taoCong(): [Promise<void>, () => void] {
  let mo: () => void = () => {};
  const cong = new Promise<void>((resolve) => {
    mo = resolve;
  });
  CONG.push(mo);
  return [cong, mo];
}

function theoDoi<T>(p: Promise<T>): Promise<T> {
  LUOT.push(p.catch(() => undefined));
  return p;
}

async function xepHang(pOrg: string, pJob: Parameters<typeof enqueueJob>[2]): Promise<string> {
  return withTenant(apiPool, pOrg, (client) => enqueueJob(client, pOrg, pJob));
}

/** Runner phục vụ ĐÚNG một tổ chức, dùng cho các test gọi `runOnce()` theo khuôn brief. */
function runnerChoMotToChuc(
  handlers: Readonly<Record<string, JobHandler>>,
  options: ConstructorParameters<typeof JobRunner>[2] = {},
  pOrg?: string,
): JobRunner {
  const org = pOrg ?? orgId;
  return new JobRunner(apiPool, handlers, { listOrganizations: () => [org], ...options });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
}, 180_000);

beforeEach(async () => {
  orgId = await toChucMoi();
  orgKhac = await toChucMoi();
});

afterEach(async () => {
  for (const mo of CONG) mo();
  CONG.length = 0;
  await Promise.allSettled(LUOT);
  LUOT.length = 0;
});

afterAll(async () => {
  await db?.stop();
});

// ============================================================================================
// 1. MẪU TRANSACTIONAL OUTBOX — ĐIỀU DUY NHẤT BẢNG NÀY TỒN TẠI ĐỂ LÀM
// ============================================================================================
describe("transactional outbox", () => {
  it("job được ghi trong cùng transaction với nghiệp vụ", async () => {
    await withTenant(apiPool, orgId, async (client) => {
      await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
        orgId,
        `cung-transaction-${demToChuc}@example.com`,
        "Nguoi dung",
      ]);
      await enqueueJob(client, orgId, { kind: "GUI_THONG_BAO", payload: { toi: "nguoi-dung" } });
    });

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM outbox_jobs WHERE org_id = $1 AND kind = 'GUI_THONG_BAO'",
      [orgId],
    );
    expect(rowCount).toBe(1);
  });

  it("rollback nghiệp vụ thì job cũng biến mất", async () => {
    await expect(
      withTenant(apiPool, orgId, async (client) => {
        await enqueueJob(client, orgId, { kind: "KHONG_BAO_GIO_CHAY" });
        throw new Error("loi co y");
      }),
    ).rejects.toThrow("loi co y");

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM outbox_jobs WHERE org_id = $1 AND kind = 'KHONG_BAO_GIO_CHAY'",
      [orgId],
    );
    expect(rowCount).toBe(0);
  });

  it("dedupeKey ngăn tạo trùng job khi bản cũ CHƯA kết thúc", async () => {
    const ids = await withTenant(apiPool, orgId, async (client) => [
      await enqueueJob(client, orgId, { kind: "NEO_CHUOI", dedupeKey: "neo-ngay-2026-08-27" }),
      await enqueueJob(client, orgId, { kind: "NEO_CHUOI", dedupeKey: "neo-ngay-2026-08-27" }),
    ]);

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM outbox_jobs WHERE org_id = $1 AND kind = 'NEO_CHUOI'",
      [orgId],
    );
    expect(rowCount).toBe(1);
    // Và lời gọi thứ hai phải trả về ID CỦA BẢN ĐANG CHỜ, không phải ném hay trả rỗng — nếu
    // không, "không tạo trùng" xanh vì một lý do khác hẳn (lỗi bị nuốt).
    expect(ids[1]).toBe(ids[0]);
  });

  it("[T10-A] khoá chống trùng ĐƯỢC TRẢ LẠI khi job vào trạng thái cuối", async () => {
    // Bản của brief đặt chỉ mục duy nhất `WHERE dedupe_key IS NOT NULL`, tức áp cho CẢ `DONE`
    // lẫn `FAILED`, dưới một chú thích nói ngược lại ("chỉ áp cho job chưa kết thúc"). Hậu quả:
    // một job neo chuỗi kiểm toán dedupe theo NGÀY, thất bại vĩnh viễn MỘT LẦN, chiếm khoá đó
    // MÃI MÃI và việc neo chuỗi ngừng chạy trong im lặng.
    const khoa = "neo-ngay-2026-08-28";

    // (a) Bản đầu tiên thất bại tới cùng.
    const idHong = await xepHang(orgId, { kind: "NEO_CHUOI_HONG", dedupeKey: khoa });
    const runnerHong = runnerChoMotToChuc(
      { NEO_CHUOI_HONG: () => Promise.reject(new Error("that bai co y")) },
      { maxAttempts: 1, retryDelaySeconds: 0 },
    );
    await runnerHong.runOnce();
    expect((await docHang(idHong)).status).toBe("FAILED");

    // (b) Khoá được TRẢ LẠI — bản mới xếp hàng được...
    const idCho = await xepHang(orgId, { kind: "NEO_CHUOI_HONG", dedupeKey: khoa });
    expect(idCho).not.toBe(idHong);
    // ...VẾ CHỐNG RỖNG RUỘT: và trong khi bản mới CHƯA kết thúc thì khoá THẬT SỰ bị chiếm.
    // Không có vế này, (b) xanh y hệt khi chỉ mục duy nhất bị xoá hẳn.
    const idTrung = await xepHang(orgId, { kind: "NEO_CHUOI_HONG", dedupeKey: khoa });
    expect(idTrung).toBe(idCho);

    // (c) Và bản mới CHẠY ĐƯỢC — điều mà bản của brief làm không thể.
    let daChay = 0;
    const runnerTot = runnerChoMotToChuc({
      NEO_CHUOI_HONG: () => {
        daChay += 1;
        return Promise.resolve();
      },
    });
    expect(await runnerTot.runOnce()).toBe(1);
    expect(daChay).toBe(1);
    expect((await docHang(idCho)).status).toBe("DONE");
  });

  it("[INV-F1] job của tổ chức A vô hình với tổ chức B, và không ai chèn hộ ai", async () => {
    const idCuaA = await xepHang(orgId, { kind: "RIENG_CUA_A" });

    const demTu = async (pOrg: string): Promise<number> =>
      withTenant(apiPool, pOrg, async (client) => {
        const { rows } = await client.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM outbox_jobs WHERE id = $1::uuid",
          [idCuaA],
        );
        return Number(rows[0]!.n);
      });

    // (a) Đọc: phiên gắn tổ chức B không thấy hàng của A; chống rỗng ruột bằng chính A.
    expect(await demTu(orgKhac)).toBe(0);
    expect(await demTu(orgId)).toBe(1);

    // (b) Ghi: phiên gắn tổ chức B KHÔNG xếp được hàng mang org_id của A (vế WITH CHECK).
    await expect(
      withTenant(apiPool, orgKhac, (client) => enqueueJob(client, orgId, { kind: "MAO_DANH" })),
    ).rejects.toThrow(/row-level security/i);

    // (c) Runner của B không nhặt việc của A.
    let cham = 0;
    const runnerB = runnerChoMotToChuc(
      {
        RIENG_CUA_A: () => {
          cham += 1;
          return Promise.resolve();
        },
      },
      {},
      orgKhac,
    );
    expect(await runnerB.runOnce()).toBe(0);
    expect(cham).toBe(0);
    expect((await docHang(idCuaA)).status).toBe("PENDING");
  });

  it("`kind` bị chặn CẤU TRÚC — cột nhãn không phải kho lưu trữ tuỳ ý", async () => {
    // Bài học Task 8 §F7: `audit_events.resource_type` là chuỗi tự do đi thẳng vào sổ, và một
    // chuỗi chứa giá + mã OTP đi lọt qua nó. `kind` là cột cùng hạng và nay có ràng buộc.
    await expect(xepHang(orgId, { kind: "gia thau: 12345000 VND" })).rejects.toThrow(
      /outbox_jobs_kind_check|check constraint/i,
    );
    // Đối chứng dương: một nhãn hợp lệ vẫn qua.
    await expect(xepHang(orgId, { kind: "NHAN_HOP_LE" })).resolves.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ============================================================================================
// 2. RUNNER
// ============================================================================================
describe("job runner", () => {
  it("runner xử lý job và đánh dấu hoàn thành", async () => {
    const daXuLy: OutboxJob[] = [];
    const id = await xepHang(orgId, { kind: "VIEC_A", payload: { so: 7 } });

    const runner = runnerChoMotToChuc({
      VIEC_A: (job) => {
        daXuLy.push(job);
        return Promise.resolve();
      },
    });

    expect(await runner.runOnce()).toBe(1);
    expect(daXuLy[0]?.payload).toEqual({ so: 7 });
    // `attempts` mà handler nhìn thấy là SỐ LẦN ĐÃ THỬ KỂ CẢ LẦN NÀY — xem LỆCH 2/9.
    expect(daXuLy[0]?.attempts).toBe(1);
    expect(daXuLy[0]?.orgId).toBe(orgId);

    const hang = await docHang(id);
    expect(hang.status).toBe("DONE");
    expect(hang.lease_expires_at).toBeNull();
    expect(hang.finished_at).not.toBeNull();
  });

  it("handler nhận client ĐÃ GẮN đúng tổ chức, và công việc của nó commit CÙNG lúc với DONE", async () => {
    const email = `handler-${demToChuc}@example.com`;
    const id = await xepHang(orgId, { kind: "GHI_NGHIEP_VU" });
    let orgTrongHandler: string | null = null;

    const runner = new JobRunner(
      apiPool,
      {
        GHI_NGHIEP_VU: async (job, client) => {
          const { rows } = await client.query<{ org: string | null }>(
            "SELECT current_setting('app.org_id', true) AS org",
          );
          orgTrongHandler = rows[0]?.org ?? null;
          // Ghi nghiệp vụ bằng CHÍNH client đó — không cần withTenant lồng, và RLS vẫn ràng
          // buộc nó (đây là điều mà một pool vượt RLS sẽ đánh mất).
          await client.query(
            "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)",
            [job.orgId, email, "Nguoi do handler tao"],
          );
        },
      },
      { listOrganizations: () => [orgId] },
    );

    expect(await runner.runOnce()).toBe(1);
    expect(orgTrongHandler).toBe(orgId);
    expect((await docHang(id)).status).toBe("DONE");
    const { rowCount } = await db.pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    expect(rowCount).toBe(1);
  });

  it("handler ném SAU khi đã ghi thì công việc của nó BIẾN MẤT cùng với dấu DONE", async () => {
    // Vế thứ hai của cùng một tính chất, và là vế thật sự chịu lực: nếu câu đánh dấu DONE nằm ở
    // một transaction KHÁC (khuôn của brief dùng `this.#pool` cho mọi câu), sẽ có một cửa sổ mà
    // handler đã ghi xong còn job vẫn PENDING — hoặc ngược lại.
    const email = `bien-mat-${demToChuc}@example.com`;
    const id = await xepHang(orgId, { kind: "GHI_ROI_NEM" });
    const runnerNem = new JobRunner(
      apiPool,
      {
        GHI_ROI_NEM: async (job, client) => {
          await client.query(
            "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)",
            [job.orgId, email, "Khong bao gio ton tai"],
          );
          throw new Error("that bai co y");
        },
      },
      { listOrganizations: () => [orgId], maxAttempts: 1, retryDelaySeconds: 0 },
    );

    await runnerNem.runOnce();
    expect((await docHang(id)).status).toBe("FAILED");
    const { rowCount } = await db.pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    expect(rowCount).toBe(0);
  });

  it("[T10-B] maxAttempts là SỐ LẦN THỬ: 3 lần thử, attempts = 3, rồi FAILED", async () => {
    // Brief tính ngưỡng bằng `attempts + 1 >= maxAttempts` TRÊN một giá trị đã tăng, nên với
    // `maxAttempts: 3` nó bỏ cuộc sau HAI lần thử với `attempts = 2` — và chính test của brief
    // (`toBe(3)`) đỏ trên chính mã của brief. Sửa NGƯỠNG, giữ test, vì "maxAttempts là số lần
    // thử tối đa" là cách đọc duy nhất người vận hành sẽ dùng.
    const id = await xepHang(orgId, { kind: "LUON_LOI" });
    let soLanGoiHandler = 0;
    const runner = runnerChoMotToChuc(
      {
        LUON_LOI: () => {
          soLanGoiHandler += 1;
          return Promise.reject(new Error("that bai co y"));
        },
      },
      { maxAttempts: 3, retryDelaySeconds: 0 },
    );

    const chuoiTrangThai: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await runner.runOnce();
      chuoiTrangThai.push((await docHang(id)).status);
    }

    expect(chuoiTrangThai).toEqual(["PENDING", "PENDING", "FAILED"]);
    expect(soLanGoiHandler).toBe(3);
    const hang = await docHang(id);
    expect(hang.attempts).toBe(3);
    expect(hang.last_failure_reason).toBe("HANDLER_ERROR");
    // Lượt thứ tư KHÔNG được chạm vào hàng đã ở trạng thái cuối.
    expect(await runner.runOnce()).toBe(0);
    expect(soLanGoiHandler).toBe(3);
  });

  it("job chưa tới hạn runAfter thì chưa được lấy", async () => {
    const id = await xepHang(orgId, {
      kind: "CHUA_TOI_HAN",
      runAfter: new Date(Date.now() + 3_600_000),
    });
    const runner = runnerChoMotToChuc({ CHUA_TOI_HAN: () => Promise.resolve() });
    expect(await runner.runOnce()).toBe(0);
    expect((await docHang(id)).status).toBe("PENDING");
  });

  it("hai runner chạy song song không xử lý trùng một job", async () => {
    const kind = "KHONG_TRUNG";
    await withTenant(apiPool, orgId, async (client) => {
      for (let i = 0; i < 12; i += 1) {
        await enqueueJob(client, orgId, { kind, payload: { i } });
      }
    });

    let soLanXuLy = 0;
    const handler = {
      [kind]: () => {
        soLanXuLy += 1;
        return Promise.resolve();
      },
    };
    const a = runnerChoMotToChuc(handler, { batchSize: 12 });
    const b = runnerChoMotToChuc(handler, { batchSize: 12 });

    const [x, y] = await Promise.all([a.runOnce(), b.runOnce()]);
    expect(x + y).toBe(12);
    expect(soLanXuLy).toBe(12);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs " +
        " WHERE org_id = $1 AND kind = $2 AND status = 'DONE'",
      [orgId, kind],
    );
    expect(Number(rows[0]!.n)).toBe(12);
  });

  // ------------------------------------------------------------------------------------------
  // [vòng fix 1 — MỤC 6 / đặc tả IMPORTANT 2] `SKIP LOCKED` NAY CÓ MỐC CHẾT
  //
  // Test ngay trên KHÔNG canh được `SKIP LOCKED`, và điều đó đã được ĐO: gỡ `SKIP LOCKED` khỏi
  // `CAU_CLAIM` để lại `FOR UPDATE` trần và cả bộ test VẪN XANH. Cơ chế: runner B CHẶN tới khi
  // transaction claim của A commit, rồi EvalPlanQual đánh giá lại vị từ, thấy `status='RUNNING'`
  // còn hạn thuê, và trả 0 hàng. `x + y` VẪN bằng 12. Tức test trên chứng minh "không xử lý
  // TRÙNG" (vế đó đã được mua bằng `attempts`), KHÔNG chứng minh "nhặt các lô RỜI NHAU".
  //
  // Test này ép đúng cái vế còn thiếu, và ép TẤT ĐỊNH bằng một CỔNG do chính test giữ — cùng
  // khuôn nhóm `[T10-C]`, và cố ý KHÔNG dựa vào `Promise.all` cầu may:
  //   * một transaction NGOÀI (phiên siêu người dùng) giữ khoá hàng trên ĐÚNG SÁU job;
  //   * runner chạy với `batchSize: 12`.
  // Với `SKIP LOCKED`: nó bỏ qua sáu hàng bị khoá và xử lý ĐÚNG sáu hàng còn lại, NGAY.
  // Với `FOR UPDATE` trần: nó CHẶN cho tới khi transaction ngoài kết thúc.
  // Mốc chết là một KHẲNG ĐỊNH, không phải một timeout của harness: cuộc đua với đồng hồ được
  // giải bằng `expect(ketQua).not.toBe("TREO")`.
  // ------------------------------------------------------------------------------------------
  it("[T10-N] FOR UPDATE SKIP LOCKED: runner BỎ QUA hàng đang bị khoá thay vì CHẶN sau nó", async () => {
    const kind = "SKIP_LOCKED";
    const ids: string[] = [];
    await withTenant(apiPool, orgId, async (client) => {
      for (let i = 0; i < 12; i += 1) {
        ids.push(await enqueueJob(client, orgId, { kind, payload: { i } }));
      }
    });
    const biKhoa = ids.slice(0, 6);
    const conLai = ids.slice(6);

    const nguoiGiuKhoa = await db.pool.connect();
    const daXuLy: string[] = [];
    try {
      await nguoiGiuKhoa.query("BEGIN");
      const { rows: daKhoa } = await nguoiGiuKhoa.query<{ id: string }>(
        "SELECT id FROM outbox_jobs WHERE id = ANY($1::uuid[]) FOR UPDATE",
        [biKhoa],
      );
      // Vế chống rỗng ruột: cổng phải THẬT SỰ đang giữ sáu hàng, nếu không mọi thứ dưới đây đo
      // một cửa sổ không tồn tại.
      expect(daKhoa).toHaveLength(6);

      const runner = runnerChoMotToChuc(
        {
          [kind]: (job: OutboxJob) => {
            daXuLy.push(job.id);
            return Promise.resolve();
          },
        },
        { batchSize: 12 },
      );
      let dongHo: NodeJS.Timeout | undefined;
      const canhBaoTreo = new Promise<string>((resolve) => {
        dongHo = setTimeout(() => {
          resolve("TREO");
        }, 5_000);
      });
      const ketQua = await Promise.race([theoDoi(runner.runOnce()), canhBaoTreo]);
      if (dongHo) clearTimeout(dongHo);

      expect(ketQua).not.toBe("TREO");
      expect(ketQua).toBe(6);
      expect([...daXuLy].sort()).toEqual([...conLai].sort());
    } finally {
      await nguoiGiuKhoa.query("ROLLBACK").catch(() => undefined);
      nguoiGiuKhoa.release();
    }
  }, 60_000);

  // ------------------------------------------------------------------------------------------
  // [vòng fix 1 — MỤC 6 / đặc tả MINOR 3] MỐC CHẾT CHO `ORDER BY` CỦA `#claim`
  //
  // Mũi "bỏ `ORDER BY s.run_after, s.id`" SỐNG SÓT ở vòng trước, tức "job đến hạn TRƯỚC được
  // chạy TRƯỚC" là một tính chất được viết ra mà không ai đo. Nó không phải trang trí: thiếu nó,
  // một hàng đợi đang tồn đọng phục vụ theo thứ tự VẬT LÝ, nên job cũ nhất có thể bị bỏ đói tuỳ
  // theo kế hoạch truy vấn.
  // Thứ tự CHÈN ở đây cố ý NGƯỢC với thứ tự `run_after`, nếu không thì "thứ tự vật lý" và "thứ
  // tự FIFO" trùng nhau và test đo một mệnh đề rỗng.
  // ------------------------------------------------------------------------------------------
  it("[T10-O] job đến hạn SỚM NHẤT được nhặt trước, kể cả khi nó được chèn SAU", async () => {
    const kind = "THU_TU";
    const bay = new Date(Date.now() - 3_600_000);
    const nhan: { nhan: string; tre: number }[] = [
      { nhan: "moi-nhat", tre: 10_000 },
      { nhan: "cu-nhat", tre: 600_000 },
      { nhan: "o-giua", tre: 60_000 },
    ];
    await withTenant(apiPool, orgId, async (client) => {
      for (const m of nhan) {
        await enqueueJob(client, orgId, {
          kind,
          payload: { nhan: m.nhan },
          runAfter: new Date(bay.getTime() - m.tre),
        });
      }
    });

    const daChay: string[] = [];
    const runner = runnerChoMotToChuc(
      {
        [kind]: (job: OutboxJob) => {
          daChay.push(String(job.payload["nhan"]));
          return Promise.resolve();
        },
      },
      { batchSize: 1 },
    );
    await runner.runOnce();
    await runner.runOnce();
    await runner.runOnce();
    expect(daChay).toEqual(["cu-nhat", "o-giua", "moi-nhat"]);
  }, 60_000);

  it("kind lạ chuyển sang FAILED chứ không treo — job không phải cơ chế quyết định", async () => {
    // KHÔNG mang thẻ [INV-C2]: xem LỆCH KHỎI BRIEF (9/9) ở db/migrations/007_outbox.sql và
    // packages/outbox/src/nhan-bat-bien.test.ts. Test này đo một tính chất THẬT của runner —
    // thiếu handler là lỗi CẤU HÌNH nên bỏ cuộc ngay thay vì thử lại mãi — nhưng chủ ngữ của
    // C2 (RFQ, deadline, báo giá muộn) chưa tồn tại trong 001–007.
    const id = await xepHang(orgId, { kind: "KHONG_CO_HANDLER" });
    const baoCao: JobFailureReport[] = [];
    const runner = runnerChoMotToChuc({}, { maxAttempts: 1, onJobFailure: (r) => baoCao.push(r) });
    expect(await runner.runOnce()).toBe(1);

    const hang = await docHang(id);
    expect(hang.status).toBe("FAILED");
    expect(hang.last_failure_reason).toBe("NO_HANDLER");
    // Bỏ cuộc NGAY nghĩa là một lần thử duy nhất, không phải "hết maxAttempts lượt".
    expect(hang.attempts).toBe(1);
    expect(baoCao.map((r) => `${r.reason}/${String(r.gaveUp)}`)).toEqual(["NO_HANDLER/true"]);
    // Và nó KHÔNG còn chiếm chỗ trong hàng đợi: một lượt nữa không nhặt lại nó.
    expect(await runner.runOnce()).toBe(0);
  });

  it("[T10-J] `run_after` được GIỮ NGUYÊN khi job vào FAILED", async () => {
    // Brief ghi đè `run_after = now() + 0` cả trên nhánh bỏ cuộc, tức xoá lịch gốc của một hàng
    // ở trạng thái cuối — đúng thứ người điều tra một job chết cần đọc.
    const hen = new Date(Date.now() - 60_000);
    const id = await xepHang(orgId, { kind: "GIU_LICH_GOC", runAfter: hen });
    const truoc = await docHang(id);

    const runner = runnerChoMotToChuc(
      { GIU_LICH_GOC: () => Promise.reject(new Error("that bai co y")) },
      { maxAttempts: 1, retryDelaySeconds: 0 },
    );
    await runner.runOnce();

    const sau = await docHang(id);
    expect(sau.status).toBe("FAILED");
    expect(sau.run_after.getTime()).toBe(truoc.run_after.getTime());
    expect(sau.finished_at).not.toBeNull();
    expect(sau.lease_expires_at).toBeNull();
  });

  it("nhánh THỬ LẠI thì `run_after` được đẩy về tương lai — đối chứng cho test trên", async () => {
    // Không có vế này, "run_after giữ nguyên" xanh y hệt khi mã KHÔNG BAO GIỜ đụng tới run_after
    // — tức khi cả cơ chế hoãn thử lại đã chết.
    const id = await xepHang(orgId, { kind: "HOAN_THU_LAI" });
    const truoc = await docHang(id);
    const runner = runnerChoMotToChuc(
      { HOAN_THU_LAI: () => Promise.reject(new Error("that bai co y")) },
      { maxAttempts: 5, retryDelaySeconds: 3600 },
    );
    await runner.runOnce();
    const sau = await docHang(id);
    expect(sau.status).toBe("PENDING");
    expect(sau.run_after.getTime()).toBeGreaterThan(truoc.run_after.getTime() + 3_000_000);
  });
});

// ============================================================================================
// 3. [T10-C] HẠN THUÊ — ĐƯỜNG THU HỒI, VÀ CÂU TRẢ LỜI CHO QT1
// ============================================================================================
describe("[T10-C] hạn thuê", () => {
  it("job kẹt ở RUNNING vì tiến trình chết được nhặt lại KHI hạn thuê đã qua, và KHÔNG trước đó", async () => {
    // Fixture dựng lại ĐÚNG trạng thái mà một tiến trình chết giữa chừng để lại: hàng ở RUNNING,
    // hạn thuê đã đặt, không ai đang làm. Bản của brief không có gì đưa hàng này ra khỏi RUNNING
    // — câu trả lời QT1 khi đó là "một người vận hành chạy UPDATE tay trên cụm production".
    const id = await xepHang(orgId, { kind: "TIEN_TRINH_CHET" });
    await db.pool.query(
      "UPDATE outbox_jobs SET status = 'RUNNING', attempts = 1, " +
        "lease_expires_at = clock_timestamp() + interval '1 hour' WHERE id = $1::uuid",
      [id],
    );

    let soLanChay = 0;
    const runner = runnerChoMotToChuc({
      TIEN_TRINH_CHET: () => {
        soLanChay += 1;
        return Promise.resolve();
      },
    });

    // (a) VẾ CHỐNG RỖNG RUỘT: hạn thuê CÒN thì KHÔNG ai được nhặt. Không có vế này, (b) xanh y
    //     hệt khi `#claim` nhặt MỌI hàng RUNNING bất kể hạn thuê — tức khi hai runner giẫm lên
    //     nhau ở mọi lượt.
    expect(await runner.runOnce()).toBe(0);
    expect(soLanChay).toBe(0);

    // (b) Hạn thuê đã qua -> nhặt lại được, KHÔNG cần câu lệnh tay nào.
    await db.pool.query(
      "UPDATE outbox_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' " +
        " WHERE id = $1::uuid",
      [id],
    );
    expect(await runner.runOnce()).toBe(1);
    expect(soLanChay).toBe(1);

    const hang = await docHang(id);
    expect(hang.status).toBe("DONE");
    // Lần nhặt lại TĂNG bộ đếm — nên một job làm runner chết mãi vẫn đi tới FAILED chứ không
    // quay vòng vô hạn.
    expect(hang.attempts).toBe(2);
  });

  it("runner ĐÃ MẤT hạn thuê không ghi đè được kết cục của runner mới", async () => {
    // Cửa sổ ép TẤT ĐỊNH bằng một cổng do test giữ, KHÔNG nhờ lịch biểu — cùng kỷ luật với
    // T9-C ("test chốt request A BÊN TRONG cổng mở bí mật").
    const id = await xepHang(orgId, { kind: "MAT_HAN_THUE" });
    const [cong, moCong] = taoCong();

    const baoCaoA: JobFailureReport[] = [];
    const runnerA = runnerChoMotToChuc(
      { MAT_HAN_THUE: () => cong },
      { onJobFailure: (r) => baoCaoA.push(r) },
    );
    const chayA = theoDoi(runnerA.runOnce());

    // Chờ tới khi A ĐÃ claim thật (quan sát được ở CSDL), không "ngủ rồi đi tiếp".
    await choTrangThai(id, "RUNNING", 1);

    // Hạn thuê của A hết; B nhặt lại và làm xong.
    await db.pool.query(
      "UPDATE outbox_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' " +
        " WHERE id = $1::uuid",
      [id],
    );
    let bDaChay = 0;
    const runnerB = runnerChoMotToChuc({
      MAT_HAN_THUE: () => {
        bDaChay += 1;
        return Promise.resolve();
      },
    });
    expect(await runnerB.runOnce()).toBe(1);
    expect(bDaChay).toBe(1);

    // Bây giờ mới thả A ra.
    moCong();
    expect(await chayA, "A không được TÍNH job mà nó đã mất").toBe(0);

    const hang = await docHang(id);
    expect(hang.status).toBe("DONE");
    expect(hang.attempts, "kết cục thuộc về B, không phải A").toBe(2);
    expect(baoCaoA.map((r) => r.reason)).toEqual(["OUTCOME_NOT_WRITTEN"]);
    // Và mã OUTCOME_NOT_WRITTEN KHÔNG BAO GIỜ vào CSDL — CHECK của 007 cố ý không có giá trị
    // đó. [vòng fix 1 — MỤC 6/M1] Đây LÀ ca (a) của mã ấy: hạn thuê mất THẬT. Cái tên cũ
    // (`LEASE_LOST`) sai vì nó phát biểu ca (a) cho CẢ ba ca — xem `JobFailureReason`.
    expect(hang.last_failure_reason).toBeNull();
  }, 60_000);

  it("runner ĐÃ MẤT hạn thuê không cướp lại được job mà runner mới ĐANG chạy", async () => {
    // Vế thứ hai của cùng hàng rào, và là vế FAIL-OPEN chứ không phải dư thừa: ở test trên,
    // runner mới đã làm XONG nên `status = 'DONE'` một mình đã đủ chặn A. Ở đây runner mới
    // vẫn ĐANG chạy (`status = 'RUNNING'`), nên thứ duy nhất còn phân biệt hai runner là vế
    // `attempts = <giá trị đã claim>`. Không có nó, câu ghi kết cục của A ĐẨY job của B về
    // PENDING/FAILED trong khi B còn đang làm — tức job chạy hai lần VÀ trạng thái nói dối.
    const id = await xepHang(orgId, { kind: "CUOP_LAI" });
    const [congA, moA] = taoCong();
    const [congB, moB] = taoCong();

    const baoCaoA: JobFailureReport[] = [];
    const runnerA = runnerChoMotToChuc(
      {
        CUOP_LAI: async () => {
          await congA;
          throw new Error("that bai co y");
        },
      },
      { maxAttempts: 5, retryDelaySeconds: 0, onJobFailure: (r) => baoCaoA.push(r) },
    );
    const chayA = theoDoi(runnerA.runOnce());
    await choTrangThai(id, "RUNNING", 1);

    await db.pool.query(
      "UPDATE outbox_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' " +
        " WHERE id = $1::uuid",
      [id],
    );
    const runnerB = runnerChoMotToChuc({ CUOP_LAI: () => congB });
    const chayB = theoDoi(runnerB.runOnce());
    await choTrangThai(id, "RUNNING", 2);

    // A thất bại và cố ghi kết cục — nhưng job không còn của nó.
    moA();
    expect(await chayA).toBe(0);
    expect(baoCaoA.map((r) => r.reason)).toEqual(["OUTCOME_NOT_WRITTEN"]);
    const giua = await docHang(id);
    expect(giua.status, "job vẫn thuộc về B, KHÔNG bị A đẩy về PENDING/FAILED").toBe("RUNNING");
    expect(giua.attempts).toBe(2);
    expect(giua.last_failure_reason).toBeNull();

    // Rồi B làm xong bình thường.
    moB();
    expect(await chayB).toBe(1);
    const cuoi = await docHang(id);
    expect(cuoi.status).toBe("DONE");
    expect(cuoi.attempts).toBe(2);
  }, 60_000);

  it("runner ĐÃ MẤT hạn thuê không ĐÁNH DẤU DONE đè lên runner mới ĐANG chạy", async () => {
    // Vế thứ ba, và nó canh một câu KHÁC hai vế trên: câu đánh dấu DONE. Ở đây runner cũ THÀNH
    // CÔNG (không ném), nên nhánh lỗi không chạy; thứ duy nhất phân biệt nó với runner mới là vế
    // `attempts = <giá trị đã claim>` trong CÂU XONG. Không có vế đó, A commit công việc của
    // mình VÀ đóng job trong khi B còn đang chạy chính job ấy — job chạy hai lần, sổ nói một lần.
    const email = `mat-han-thue-${demToChuc}@example.com`;
    const id = await xepHang(orgId, { kind: "XONG_MUON" });
    const [congA, moA] = taoCong();
    const [congB, moB] = taoCong();

    const baoCaoA: JobFailureReport[] = [];
    const runnerA = new JobRunner(
      apiPool,
      {
        XONG_MUON: async (job, client) => {
          await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
            job.orgId,
            email,
            "Cong viec cua runner da mat han thue",
          ]);
          await congA;
        },
      },
      { listOrganizations: () => [orgId], onJobFailure: (r) => baoCaoA.push(r) },
    );
    const chayA = theoDoi(runnerA.runOnce());
    await choTrangThai(id, "RUNNING", 1);

    await db.pool.query(
      "UPDATE outbox_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' " +
        " WHERE id = $1::uuid",
      [id],
    );
    const runnerB = runnerChoMotToChuc({ XONG_MUON: () => congB });
    const chayB = theoDoi(runnerB.runOnce());
    await choTrangThai(id, "RUNNING", 2);

    // A "làm xong" — nhưng job không còn của nó.
    moA();
    expect(await chayA).toBe(0);
    expect(baoCaoA.map((r) => r.reason)).toEqual(["OUTCOME_NOT_WRITTEN"]);
    const giua = await docHang(id);
    expect(giua.status, "A KHÔNG được đóng job của B").toBe("RUNNING");
    expect(giua.attempts).toBe(2);
    expect(giua.finished_at).toBeNull();
    // Và công việc CSDL của A biến mất cùng với nó — nó nằm trong transaction bị rollback.
    const { rowCount } = await db.pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
    expect(rowCount, "công việc của runner đã mất hạn thuê phải bị rollback").toBe(0);

    moB();
    expect(await chayB).toBe(1);
    const cuoi = await docHang(id);
    expect(cuoi.status).toBe("DONE");
    expect(cuoi.attempts).toBe(2);
  }, 60_000);
});

// ============================================================================================
// 4. [T10-F] CẤM LOG — CỘT LÝ DO LÀ TẬP ĐÓNG, KHÔNG PHẢI VĂN BẢN TỰ DO
// ============================================================================================
describe("[T10-F] thông điệp lỗi không rò vào CSDL", () => {
  const GIA_THAU = "1284500000";
  const MA_OTP = "824193";

  it("lỗi của handler mang giá và mã OTP KHÔNG để lại một mảnh nào trong hàng outbox", async () => {
    const id = await xepHang(orgId, { kind: "RO_RI", payload: { rfq: "R-1" } });
    const baoCao: JobFailureReport[] = [];
    const runner = runnerChoMotToChuc(
      {
        RO_RI: () =>
          Promise.reject(new Error(`khong gui duoc thong bao: gia ${GIA_THAU} VND, otp ${MA_OTP}`)),
      },
      { maxAttempts: 1, retryDelaySeconds: 0, onJobFailure: (r) => baoCao.push(r) },
    );
    await runner.runOnce();

    // VẾ CHỐNG RỖNG RUỘT, đặt TRƯỚC: lỗi THẬT SỰ có mang bí mật. Không có nó, khẳng định dưới
    // xanh vì chuỗi tìm kiếm không tồn tại ở đâu cả.
    expect(baoCao).toHaveLength(1);
    const nguyenNhan = baoCao[0]?.cause;
    expect(nguyenNhan).toBeInstanceOf(Error);
    expect((nguyenNhan as Error).message).toContain(GIA_THAU);
    expect((nguyenNhan as Error).message).toContain(MA_OTP);

    // Quét TOÀN BỘ hàng, không chỉ cột nghi ngờ: một cột mới thêm sau này cũng bị soi.
    const { rows } = await db.pool.query<{ ca_hang: string }>(
      "SELECT outbox_jobs::text AS ca_hang FROM outbox_jobs WHERE id = $1::uuid",
      [id],
    );
    expect(rows[0]!.ca_hang).not.toContain(GIA_THAU);
    expect(rows[0]!.ca_hang).not.toContain(MA_OTP);
    expect(rows[0]!.ca_hang).not.toContain("khong gui duoc");
    expect((await docHang(id)).last_failure_reason).toBe("HANDLER_ERROR");
  });

  it("cột last_failure_reason TỪ CHỐI văn bản tự do — lớp ở tầng CSDL, không phải lời hứa", async () => {
    // Đây là điểm khác biệt với "runner cẩn thận": ràng buộc chặn MỌI người ghi, kể cả chủ sở
    // hữu bảng, kể cả một tác giả tương lai không đọc chú thích nào.
    //
    // [vòng fix 1 — MỤC 1] `payload` NAY MANG GIÁ, và test NHÌN `error.detail`. Bản trước để
    // payload là `{}` và chỉ khẳng định `code`, nên nó xanh VÌ DỮ LIỆU THỬ NGHÈO chứ không vì
    // một lớp bảo vệ: chính lỗi cưỡng chế 23514 mang `detail` = NGUYÊN CẢ HÀNG — gồm payload —
    // vào log máy chủ. Xem khối "[vòng fix 1 — MỤC 1]" ở db/migrations/007_outbox.sql.
    const id = await xepHang(orgId, {
      kind: "CHAN_VAN_BAN",
      payload: { bimat: Number(GIA_THAU) },
    });
    const VAN_BAN_TU_DO = `gia ${GIA_THAU}`;

    // (a) ĐƯỜNG `app_api`, RLS còn hiệu lực cho phiên: 23514, và KHÔNG có `detail`.
    let loiApi: { code?: string; detail?: string } | undefined;
    try {
      await withTenant(apiPool, orgId, (client) =>
        client.query("UPDATE outbox_jobs SET last_failure_reason = $2 WHERE id = $1::uuid", [
          id,
          VAN_BAN_TU_DO,
        ]),
      );
    } catch (loi) {
      loiApi = loi as { code?: string; detail?: string };
    }
    expect(loiApi?.code).toBe("23514");
    expect(loiApi?.detail ?? "").toBe("");

    // (b) ĐƯỜNG CHỦ SỞ HỮU. VẾ CHỐNG RỖNG RUỘT CỦA (a), và đồng thời là PHÉP ĐO của lệnh CẤM
    // LOG: `detail` KHÔNG rỗng, và nó mang CẢ payload LẪN văn bản tự do vừa bị từ chối ghi.
    // Sự im lặng ở (a) do `check_enable_rls(...) == RLS_ENABLED` mua — nó KHÔNG do CHECK mua,
    // và nó TẮT khi RLS/FORCE tắt hoặc khi phiên là superuser/BYPASSRLS.
    let loiChuSoHuu: { code?: string; detail?: string } | undefined;
    try {
      await db.pool.query("UPDATE outbox_jobs SET last_failure_reason = $2 WHERE id = $1::uuid", [
        id,
        VAN_BAN_TU_DO,
      ]);
    } catch (loi) {
      loiChuSoHuu = loi as { code?: string; detail?: string };
    }
    expect(loiChuSoHuu?.code).toBe("23514");
    expect(loiChuSoHuu?.detail ?? "").not.toBe("");
    expect(loiChuSoHuu?.detail ?? "").toContain(GIA_THAU);
    expect(loiChuSoHuu?.detail ?? "").toContain(VAN_BAN_TU_DO);

    // Đối chứng dương: một mã thuộc tập đóng vẫn ghi được, nên "23514" ở trên không phải vì cột
    // bị khoá hoàn toàn.
    await expect(
      db.pool.query(
        "UPDATE outbox_jobs SET last_failure_reason = 'HANDLER_ERROR' WHERE id = $1::uuid",
        [id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    // Và mã MỚI của vòng fix 1 cũng thuộc tập đóng — nếu không, "HANDLER_TIMEOUT" sẽ là một
    // giá trị runner ghi được ở tầng ứng dụng mà CHECK từ chối, tức một 23514 GIỮA transaction.
    await expect(
      db.pool.query(
        "UPDATE outbox_jobs SET last_failure_reason = 'HANDLER_TIMEOUT' WHERE id = $1::uuid",
        [id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    // Và `OUTCOME_NOT_WRITTEN` cố ý KHÔNG thuộc tập đóng: không có hàng nào để ghi thì không có
    // giá trị nào ghi được. Đây là vế chống rỗng ruột cho câu đó ở 007.
    await expect(
      db.pool.query(
        "UPDATE outbox_jobs SET last_failure_reason = 'OUTCOME_NOT_WRITTEN' WHERE id = $1::uuid",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

// ============================================================================================
// 5. [T10-D] HỒ SƠ VAI TRÒ — VÌ SAO KHUÔN CỦA BRIEF KHÔNG ĐO ĐƯỢC GÌ
// ============================================================================================
describe("[T10-D] runner chạy dưới hồ sơ vai trò THẬT", () => {
  it("pool của runner là app_api: rolsuper = false, rolbypassrls = false", async () => {
    const { rows } = await apiPool.query<{ ai: string; sieu: boolean; vuot: boolean }>(
      "SELECT current_user AS ai, r.rolsuper AS sieu, r.rolbypassrls AS vuot " +
        "  FROM pg_roles r WHERE r.rolname = current_user",
    );
    expect(rows[0]).toEqual({ ai: "app_api", sieu: false, vuot: false });
  });

  it("SIÊU NGƯỜI DÙNG ≠ ROLE CÓ BYPASSRLS: db.pool bỏ qua CẢ RLS LẪN mọi GRANT", async () => {
    // Vế (a) của LỆCH KHỎI BRIEF (4/9). Brief chạy runner trên `db.pool` và gọi đó là "phản ánh
    // đúng thiết kế triển khai thật".
    const { rows: sieu } = await db.pool.query<{ sieu: boolean }>(
      "SELECT r.rolsuper AS sieu FROM pg_roles r WHERE r.rolname = current_user",
    );
    expect(sieu[0]!.sieu, "tiền đề: db.pool ĐANG là siêu người dùng").toBe(true);

    // (i) Nó thấy hàng của MỌI tổ chức bất chấp FORCE RLS.
    await xepHang(orgId, { kind: "CUA_TO_CHUC_A" });
    await xepHang(orgKhac, { kind: "CUA_TO_CHUC_B" });
    const { rows: dem } = await db.pool.query<{ n: string }>(
      "SELECT count(DISTINCT org_id)::text AS n FROM outbox_jobs WHERE org_id = ANY($1::uuid[])",
      [[orgId, orgKhac]],
    );
    expect(Number(dem[0]!.n), "siêu người dùng nhìn thấy CẢ HAI tổ chức").toBe(2);

    // (ii) Nó bỏ qua cả GRANT. ~~app_unseal KHÔNG có quyền nào trên bảng này (xem [T10-G])~~ —
    //      câu ấy ĐÚNG cho tới migration `025`, thứ cấp cho `app_unseal` quyền ĐỌC và sáu cột
    //      vòng đời để nó tự nhặt được hai `kind` mà chỉ nó chạy được (khoản nợ 34). Vế được đo
    //      ở đây vì thế đổi sang quyền mà `app_unseal` VẪN KHÔNG có, và sẽ không bao giờ có:
    //      **INSERT**. Một tiến trình vừa tự xếp việc vừa tự chạy việc là một tiến trình tự cấp
    //      việc cho mình — với tiến trình DUY NHẤT giữ khả năng giải mã thì đó đúng thứ ADR-006
    //      dựng hai role để đóng.
    const unsealPool = db.poolAs("app_unseal");
    try {
      await expect(
        unsealPool.query(
          "INSERT INTO outbox_jobs (org_id, kind, payload) VALUES ($1, 'THU_XEP_VIEC', '{}'::jsonb)",
          [orgId],
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await unsealPool.end();
    }
    // Còn một phiên siêu người dùng thì chèn được như thường — tức một bộ test chạy trên pool ấy
    // xanh y hệt khi mọi GRANT bị thu hồi.
    await expect(
      db.pool.query(
        "INSERT INTO outbox_jobs (org_id, kind, payload) VALUES ($1, 'THU_XEP_VIEC', '{}'::jsonb)",
        [orgId],
      ),
    ).resolves.toBeDefined();
  });

  it("BYPASSRLS là thuộc tính của ROLE, không theo từng bảng — và migrate() KHÔNG canh role lạ", async () => {
    // Vế (b) của LỆCH KHỎI BRIEF (4/9). Hai role SONG SINH, GRANT y hệt nhau, khác đúng MỘT
    // thuộc tính — nên nếu kết quả khác nhau thì nguyên nhân là thuộc tính đó, không phải GRANT.
    await xepHang(orgId, { kind: "CUA_TO_CHUC_A" });
    await xepHang(orgKhac, { kind: "CUA_TO_CHUC_B" });
    await db.pool.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
      orgId,
      `nguoi-${demToChuc}@example.com`,
      "Nguoi dung",
    ]);

    const client = await db.pool.connect();
    try {
      await client.query("CREATE ROLE t10_vuot BYPASSRLS");
      await client.query("CREATE ROLE t10_thuong NOBYPASSRLS");
      await client.query("GRANT USAGE ON SCHEMA public TO t10_vuot, t10_thuong");
      await client.query("GRANT SELECT ON outbox_jobs, users TO t10_vuot, t10_thuong");

      const thuDuoiRole = async (role: string, cau: string): Promise<number | string> => {
        await client.query(`SET ROLE ${role}`);
        try {
          const { rows } = await client.query<{ n: string }>(cau);
          return Number(rows[0]!.n);
        } catch (loi) {
          return (loi as Error).message;
        } finally {
          await client.query("RESET ROLE");
        }
      };
      const demDuoiRole = async (role: string, cau: string): Promise<number> => {
        const kq = await thuDuoiRole(role, cau);
        if (typeof kq !== "number") throw new Error(`truy vấn dưới ${role} lỗi: ${kq}`);
        return kq;
      };

      const demOutbox = "SELECT count(DISTINCT org_id)::text AS n FROM outbox_jobs";

      // (0) PHÉP ĐO PHỤ, TỰ VẤP PHẢI KHI VIẾT TEST NÀY, và nó nói đúng điều đang được chứng
      //     minh: chưa cấp EXECUTE trên `app_current_org_id()` thì role THƯỜNG ném "permission
      //     denied for function app_current_org_id" — nó PHẢI đánh giá vị từ policy — trong khi
      //     role có BYPASSRLS trả về kết quả bình thường, vì policy KHÔNG BAO GIỜ được đánh giá
      //     cho nó. BYPASSRLS không "được cho qua policy", nó ĐI VÒNG QUA cả cơ chế.
      expect(await thuDuoiRole("t10_thuong", demOutbox)).toMatch(
        /permission denied for function app_current_org_id/,
      );
      expect(await demDuoiRole("t10_vuot", demOutbox)).toBeGreaterThan(1);

      // (1) Nay hai role GIỐNG HỆT NHAU về mọi quyền, khác đúng MỘT thuộc tính. Chưa gắn tổ
      //     chức: role thường thấy 0 (fail-closed), role vượt RLS thấy MỌI tổ chức.
      await client.query(
        "GRANT EXECUTE ON FUNCTION app_current_org_id() TO t10_vuot, t10_thuong",
      );
      expect(await demDuoiRole("t10_thuong", demOutbox)).toBe(0);
      expect(await demDuoiRole("t10_vuot", demOutbox)).toBeGreaterThan(1);

      // Và bán kính KHÔNG bị giới hạn bởi "chỉ cấp quyền trên outbox_jobs": cùng một thuộc tính
      // role mở ngay một đường đọc XUYÊN TỔ CHỨC trên MỌI bảng nó được cấp quyền, hôm nay hay
      // ở một migration S1 nào đó.
      const demUsers = "SELECT count(*)::text AS n FROM users";
      expect(await demDuoiRole("t10_thuong", demUsers)).toBe(0);
      expect(await demDuoiRole("t10_vuot", demUsers)).toBeGreaterThan(0);

      // VÀ KHÔNG LỚP NÀO KÊU: hardening.always.sql cưỡng chế NOBYPASSRLS cho ĐÚNG BỐN tên role
      // đã biết (app_api, app_unseal và hai role đăng nhập). Một role thứ năm có BYPASSRLS đi
      // qua migrate() không một tiếng động. Đó là lý do "tạo role app_worker có BYPASSRLS" là
      // một đường vòng RLS không ai canh, chứ không phải một dòng cấu hình vô hại.
      await expect(migrate(db.pool, MIGRATIONS)).resolves.toEqual([]);
      const { rows: sau } = await db.pool.query<{ vuot: boolean }>(
        "SELECT rolbypassrls AS vuot FROM pg_roles WHERE rolname = 't10_vuot'",
      );
      expect(sau[0]!.vuot).toBe(true);
    } finally {
      await client.query("RESET ROLE").catch(() => {});
      await client
        .query("REVOKE ALL ON outbox_jobs, users FROM t10_vuot, t10_thuong")
        .catch(() => {});
      await client
        .query("REVOKE ALL ON FUNCTION app_current_org_id() FROM t10_vuot, t10_thuong")
        .catch(() => {});
      await client.query("REVOKE ALL ON SCHEMA public FROM t10_vuot, t10_thuong").catch(() => {});
      await client.query("DROP ROLE IF EXISTS t10_vuot").catch(() => {});
      await client.query("DROP ROLE IF EXISTS t10_thuong").catch(() => {});
      client.release();
    }
  }, 120_000);

  it("runner trên pool SIÊU NGƯỜI DÙNG vẫn CHỈ nhặt việc của tổ chức được giao", async () => {
    // Đây là mốc chết của vế `org_id = $1` viết TƯỜNG MINH trong mọi câu của runner, dù RLS đã
    // cắt tập hàng. Bài học đo được của Task 8 (xác minh vòng fix 2, Phát hiện #2): câu "RLS đã
    // giới hạn tập hàng" là CÓ ĐIỀU KIỆN và SAI với phiên superuser/BYPASSRLS. Ở đây hậu quả
    // nặng hơn một bước so với ca của gói audit (chỉ RÒ BÁO CÁO): không có vế ghim, một runner
    // chạy trên pool superuser — ĐÚNG thứ brief đề nghị — sẽ CHẠY việc của tổ chức B dưới
    // `app.org_id` của tổ chức A.
    const { rows: sieu } = await db.pool.query<{ sieu: boolean }>(
      "SELECT r.rolsuper AS sieu FROM pg_roles r WHERE r.rolname = current_user",
    );
    expect(sieu[0]!.sieu, "tiền đề: pool này KHÔNG chịu RLS").toBe(true);

    const idA = await xepHang(orgId, { kind: "VIEC_CHUNG_KIND" });
    const idB = await xepHang(orgKhac, { kind: "VIEC_CHUNG_KIND" });

    const daNhan: string[] = [];
    const runner = new JobRunner(
      db.pool,
      {
        VIEC_CHUNG_KIND: (job) => {
          daNhan.push(job.orgId);
          return Promise.resolve();
        },
      },
      { listOrganizations: () => [orgId] },
    );

    expect(await runner.runOnce()).toBe(1);
    expect(daNhan).toEqual([orgId]);
    expect((await docHang(idA)).status).toBe("DONE");
    expect((await docHang(idB)).status, "job của tổ chức KHÁC không được đụng tới").toBe("PENDING");
  });

  it("pool app_api CHƯA GẮN TỔ CHỨC không thấy job nào — fail-closed", async () => {
    // Mặt tích cực của cùng quyết định: nếu ai đó dựng một JobRunner rồi quên nguồn tổ chức, nó
    // không âm thầm chạy việc của người khác — nó không thấy gì cả.
    await xepHang(orgId, { kind: "CO_HANG_THAT" });
    const { rows: that } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs",
    );
    expect(Number(that[0]!.n), "chống rỗng ruột: bảng KHÔNG rỗng").toBeGreaterThan(0);
    const { rows } = await apiPool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs",
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

// ============================================================================================
// 6. [T10-G] BỀ MẶT QUYỀN — ĐO BẰNG CÔNG CỤ KHÔNG MÙ
// ============================================================================================
describe("[T10-G] quyền trên outbox_jobs", () => {
  it("app_unseal có ĐÚNG bộ quyền của 025 — và KHÔNG có INSERT; PUBLIC vẫn trắng", async () => {
    // `information_schema.role_table_grants` MÙ với quyền mức CỘT (đã đo ở Task 8/9), nên phép
    // kiểm có thẩm quyền đọc pg_class.relacl + pg_attribute.attacl qua aclexplode, cộng PUBLIC
    // riêng, cộng role định sẵn riêng.
    const { rows: mucBang } = await db.pool.query<{ ai: string; quyen: string }>(
      "SELECT coalesce(r.rolname, 'PUBLIC') AS ai, x.privilege_type AS quyen " +
        "  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) AS x " +
        "  LEFT JOIN pg_roles r ON r.oid = x.grantee " +
        " WHERE c.oid = 'public.outbox_jobs'::regclass ORDER BY 1, 2",
    );
    const { rows: mucCot } = await db.pool.query<{ ai: string; cot: string; quyen: string }>(
      "SELECT coalesce(r.rolname, 'PUBLIC') AS ai, a.attname AS cot, x.privilege_type AS quyen " +
        "  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid " +
        "  CROSS JOIN LATERAL aclexplode(a.attacl) AS x " +
        "  LEFT JOIN pg_roles r ON r.oid = x.grantee " +
        " WHERE c.oid = 'public.outbox_jobs'::regclass AND a.attnum > 0 ORDER BY 1, 2, 3",
    );

    // Chống rỗng ruột: hai truy vấn PHẢI đọc ra thứ gì đó, nếu không "app_unseal vắng mặt" xanh
    // vì bảng ACL rỗng chứ không vì quyết định nào.
    expect(mucBang.length).toBeGreaterThan(0);
    expect(mucCot.length).toBeGreaterThan(0);

    // ~~`app_unseal` KHÔNG có một quyền nào.~~ Câu ấy đúng cho tới `025` — xem khối [T10-D].
    // Nay nó có ĐÚNG hai thứ, và mốc ghim đổi từ "không có gì" sang "đúng bằng thứ đã quyết".
    expect(
      mucBang.filter((h) => h.ai === "app_unseal").map((h) => h.quyen),
      "app_unseal chỉ được ĐỌC ở mức bảng — không INSERT, không DELETE, không TRUNCATE",
    ).toEqual(["SELECT"]);
    expect(
      mucCot
        .filter((h) => h.ai === "app_unseal")
        .map((h) => `${h.cot}:${h.quyen}`)
        .sort(),
      "đúng SÁU cột vòng đời mà runner ghi, không hơn",
    ).toEqual([
      "attempts:UPDATE",
      "finished_at:UPDATE",
      "last_failure_reason:UPDATE",
      "lease_expires_at:UPDATE",
      "run_after:UPDATE",
      "status:UPDATE",
    ]);
    // VẾ CHỊU LỰC, và nó là vế duy nhất của mốc ghim cũ còn nguyên: KHÔNG có `INSERT`, ở cả hai
    // mức. Đường xếp việc đi qua `dispatchUnseal` phía `api`, sau cổng bốn vế của D1.
    expect(
      [...mucBang, ...mucCot].filter(
        (h) => h.ai === "app_unseal" && h.quyen === "INSERT",
      ),
    ).toEqual([]);
    expect(mucBang.filter((h) => h.ai === "PUBLIC")).toEqual([]);
    expect(mucCot.filter((h) => h.ai === "PUBLIC")).toEqual([]);
    // Role định sẵn của PostgreSQL cũng không được cấp gì — chúng là đường vòng ai cũng quên.
    expect(mucBang.filter((h) => h.ai.startsWith("pg_"))).toEqual([]);
    expect(mucCot.filter((h) => h.ai.startsWith("pg_"))).toEqual([]);
    // Và hai role ứng dụng KHÔNG được là thành viên của một role đọc-tất-cả.
    const { rows: thanhVien } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_auth_members m " +
        "  JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles t ON t.oid = m.member " +
        " WHERE r.rolname IN ('pg_read_all_data', 'pg_write_all_data') " +
        "   AND t.rolname IN ('app_api', 'app_unseal')",
    );
    expect(Number(thanhVien[0]!.n)).toBe(0);
  });

  it("app_api chỉ GHI được đúng những cột đã quyết định", async () => {
    const { rows } = await db.pool.query<{ cot: string; quyen: string }>(
      "SELECT a.attname AS cot, x.privilege_type AS quyen " +
        "  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid " +
        "  CROSS JOIN LATERAL aclexplode(a.attacl) AS x " +
        "  JOIN pg_roles r ON r.oid = x.grantee " +
        " WHERE c.oid = 'public.outbox_jobs'::regclass AND a.attnum > 0 " +
        "   AND r.rolname = 'app_api' AND x.privilege_type <> 'SELECT' ORDER BY 1, 2",
    );
    expect(rows).toEqual([
      { cot: "attempts", quyen: "UPDATE" },
      { cot: "dedupe_key", quyen: "INSERT" },
      { cot: "finished_at", quyen: "UPDATE" },
      { cot: "kind", quyen: "INSERT" },
      { cot: "last_failure_reason", quyen: "UPDATE" },
      { cot: "lease_expires_at", quyen: "UPDATE" },
      { cot: "org_id", quyen: "INSERT" },
      { cot: "payload", quyen: "INSERT" },
      { cot: "run_after", quyen: "INSERT" },
      { cot: "run_after", quyen: "UPDATE" },
      { cot: "status", quyen: "UPDATE" },
    ]);
  });

  it("app_api KHÔNG chuyển được một job sang tổ chức khác, và KHÔNG xoá được job nào", async () => {
    const id = await xepHang(orgId, { kind: "KHONG_CHUYEN_DUOC" });
    await expect(
      withTenant(apiPool, orgId, (client) =>
        client.query("UPDATE outbox_jobs SET org_id = $2::uuid WHERE id = $1::uuid", [id, orgKhac]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(apiPool, orgId, (client) =>
        client.query("DELETE FROM outbox_jobs WHERE id = $1::uuid", [id]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ============================================================================================
// 7. [T10-I] VÌ SAO KHÔNG CÓ `updated_at` VÀ KHÔNG CÓ TRIGGER
// ============================================================================================
describe("[T10-I] mốc thời gian", () => {
  it("mỗi mốc có ĐÚNG MỘT ý nghĩa, và CHECK không cho biểu diễn hai câu chuyện", async () => {
    const id = await xepHang(orgId, { kind: "MOC_THOI_GIAN" });
    // PENDING: không hạn thuê, không mốc kết thúc.
    await expect(
      db.pool.query(
        "UPDATE outbox_jobs SET lease_expires_at = clock_timestamp() WHERE id = $1::uuid",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // DONE mà không có finished_at cũng không biểu diễn được.
    await expect(
      db.pool.query("UPDATE outbox_jobs SET status = 'DONE' WHERE id = $1::uuid", [id]),
    ).rejects.toMatchObject({ code: "23514" });
    // Đối chứng dương: bộ ba nhất quán thì ghi được.
    await expect(
      db.pool.query(
        "UPDATE outbox_jobs SET status = 'DONE', finished_at = clock_timestamp() " +
          " WHERE id = $1::uuid",
        [id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("một trigger `updated_at` sẽ KHÔNG được hardening canh — đo, không suy", async () => {
    // Đây là phép đo đứng sau quyết định KHÔNG thêm trigger (LỆCH KHỎI BRIEF 8/9).
    // `hardening.always.sql` cưỡng chế THÂN hàm plpgsql theo TÊN, từng hàm một, trong một danh
    // sách viết tay. Một hàm mới không nằm trong danh sách đó nên nó không được ghim ở lớp CÓ
    // THẨM QUYỀN; bảo đảm mà trigger mua được chỉ sống tới lần deploy kế tiếp.
    await db.pool.query(
      "CREATE FUNCTION t10_cham_updated_at() RETURNS trigger LANGUAGE plpgsql AS " +
        "$$ BEGIN NEW.ghi_chu := 'DA CHAM'; RETURN NEW; END $$",
    );
    await db.pool.query("CREATE TABLE t10_thu_trigger (id int PRIMARY KEY, ghi_chu text)");
    await db.pool.query(
      "CREATE TRIGGER t10_thu_trigger_cham BEFORE INSERT ON t10_thu_trigger " +
        " FOR EACH ROW EXECUTE FUNCTION t10_cham_updated_at()",
    );
    try {
      await db.pool.query("INSERT INTO t10_thu_trigger (id) VALUES (1)");
      const truoc = await db.pool.query<{ ghi_chu: string | null }>(
        "SELECT ghi_chu FROM t10_thu_trigger WHERE id = 1",
      );
      expect(truoc.rows[0]!.ghi_chu, "tiền đề: trigger ĐANG làm việc").toBe("DA CHAM");

      // Cú tấn công là MỘT câu lệnh, và nó là câu lệnh mà bất kỳ ai có quyền DDL viết được.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION t10_cham_updated_at() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$ BEGIN RETURN NEW; END $$",
      );
      await expect(migrate(db.pool, MIGRATIONS), "hardening không thấy gì").resolves.toEqual([]);

      await db.pool.query("INSERT INTO t10_thu_trigger (id) VALUES (2)");
      const sau = await db.pool.query<{ ghi_chu: string | null }>(
        "SELECT ghi_chu FROM t10_thu_trigger WHERE id = 2",
      );
      expect(sau.rows[0]!.ghi_chu, "thân hàm rỗng SỐNG SÓT qua migrate()").toBeNull();
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS t10_thu_trigger").catch(() => {});
      await db.pool.query("DROP FUNCTION IF EXISTS t10_cham_updated_at()").catch(() => {});
    }
  }, 120_000);
});


// ============================================================================================
// 8. [QT3] GHIM TOÁN TỬ — VÀ ĐÂY LÀ MỐC CHẾT CỦA NÓ, KHÔNG PHẢI MỘT LỜI HỨA
//
// Task 9 bàn giao khoản nợ nặng nhất của nó đúng ở đây: các ghim QT3 KHÔNG CÓ MỐC CHẾT trong
// khi trục ấy ĐÃ được tái lập end-to-end. Khối này trả nợ cho MỘT trục — toán tử so sánh của
// `timestamptz` — trên chính mã sản phẩm của gói outbox.
//
// VÌ SAO CHỌN `timestamptz` CHỨ KHÔNG PHẢI `text`, VÀ ĐÂY LÀ MỘT PHÉP ĐO CHỨ KHÔNG PHẢI KHẨU VỊ:
// bản đầu của test này cướp `=` của `text` (để đánh vào `status = 'PENDING'`). Kết quả: khẳng
// định "runner KHÔNG nhặt" XANH — VÌ MỘT LÝ DO KHÁC HẲN. `app_current_org_id()` có
// `NULLIF(current_setting(...), '')` bên trong, tức một phép so `text`, và hàm ấy bị
// hardening.always.sql CƯỠNG CHẾ `proconfig IS NULL` (không được ghim search_path). Nên một
// `text =` thù địch làm hàm đó sập về NULL, RLS không khớp hàng nào, và CẢ BẢNG biến mất khỏi
// tầm nhìn — kể cả đường GHI (`WITH CHECK` từ chối mọi hàng mới; đo được:
// "new row violates row-level security policy"). Test khi ấy sẽ XANH GIẢ: nó đo "RLS đã sập"
// chứ không đo "toán tử đã được ghim".
//   >>> Đây đúng là bài học "FIXTURE CŨNG PHẢI CHỊU ĐỘT BIẾN", và nó bắt được TRƯỚC khi một kết
//       luận sai được viết ra. Nó cũng là phép đo ĐỘC LẬP THỨ HAI cho phát hiện F3 của review
//       an ninh Task 8 ("app_current_org_id() fail-closed một cách TÌNH CỜ"), nay quan sát trên
//       một bảng khác và trên cả đường GHI.
// `timestamptz` không xuất hiện ở đâu trong `app_current_org_id()`, nên trục này cô lập đúng
// thứ cần đo: hai vế thời gian của `#claim` (`run_after <= now` và `lease_expires_at < now`).
// Một `<=`/`<` thù địch trả TRUE cho mọi cặp làm `#claim` nhặt CẢ job chưa tới hạn LẪN job mà
// một runner khác đang giữ hạn thuê — hai đường fail-open thật.
// ============================================================================================
describe("[QT3] ghim toán tử dưới một search_path thù địch", () => {
  it("toán tử `<=`/`<` thù địch KHÔNG làm runner nhặt job chưa tới hạn hay job đang có hạn thuê", async () => {
    const idTuongLai = await xepHang(orgId, {
      kind: "CHUA_TOI_HAN_QT3",
      runAfter: new Date(Date.now() + 3_600_000),
    });
    const idDangChay = await xepHang(orgId, { kind: "DANG_CHAY_QT3" });
    await db.pool.query(
      "UPDATE outbox_jobs SET status = 'RUNNING', attempts = 1, " +
        "lease_expires_at = clock_timestamp() + interval '1 hour' WHERE id = $1::uuid",
      [idDangChay],
    );
    const idToiHan = await xepHang(orgId, { kind: "TOI_HAN_QT3" });

    await db.pool.query("CREATE SCHEMA ke10");
    for (const ten of ["truoc_hoac_bang", "truoc"]) {
      await db.pool.query(
        `CREATE FUNCTION ke10.${ten}(pg_catalog.timestamptz, pg_catalog.timestamptz) ` +
          " RETURNS pg_catalog.bool LANGUAGE sql IMMUTABLE AS 'SELECT true'",
      );
    }
    await db.pool.query(
      "CREATE OPERATOR ke10.<= (LEFTARG = pg_catalog.timestamptz, " +
        " RIGHTARG = pg_catalog.timestamptz, FUNCTION = ke10.truoc_hoac_bang)",
    );
    await db.pool.query(
      "CREATE OPERATOR ke10.< (LEFTARG = pg_catalog.timestamptz, " +
        " RIGHTARG = pg_catalog.timestamptz, FUNCTION = ke10.truoc)",
    );
    await db.pool.query("GRANT USAGE ON SCHEMA ke10 TO app_api");

    // Vector: một `SET search_path` PHẠM VI PHIÊN do chính mã ứng dụng (hoặc một SQLi trong một
    // hàm) phát ra. Task 8 §F3 đã đo rằng nó SỐNG SÓT qua `withTenant` và Ở LẠI trên kết nối
    // trong pool — nên đây không phải một hoàn cảnh dựng lên, nó là hoàn cảnh đã ghi trong sổ.
    // `max: 1` để mọi truy vấn dùng LẠI đúng kết nối đã bị đầu độc; `SET ROLE` trước, vì
    // `ALTER ROLE ... SET` KHÔNG áp cho một phiên vào bằng `SET ROLE` (đã tự vấp phải: bản đầu
    // của test này dùng `ALTER ROLE app_api SET search_path` và fixture KHÔNG cướp được gì —
    // rolconfig chỉ áp lúc ĐĂNG NHẬP).
    const poolThuDich = createPool(db.connectionString, 1);
    try {
      await poolThuDich.query("SET ROLE app_api");
      await poolThuDich.query("SET search_path = ke10, pg_catalog, public");

      // VẾ CHỐNG RỖNG RUỘT, ĐẶT TRƯỚC, BA PHẦN: phiên đúng là app_api; search_path đúng là
      // chuỗi thù địch; và fixture TỰ CHỨNG MINH nó cướp được cả hai toán tử VÀ rằng cách viết
      // GHIM thì thoát. Không có ba vế này, mọi khẳng định bên dưới xanh vì tấn công không xảy
      // ra chứ không vì bản vá chịu lực.
      const { rows: hoSo } = await poolThuDich.query<{
        ai: string;
        duong: string;
        le_tran: boolean;
        le_ghim: boolean;
        lt_tran: boolean;
        lt_ghim: boolean;
      }>(
        "SELECT current_user AS ai, " +
          "  pg_catalog.array_to_string(pg_catalog.current_schemas(false), ',') AS duong, " +
          "  ('2100-01-01'::pg_catalog.timestamptz <= '2000-01-01'::pg_catalog.timestamptz) AS le_tran, " +
          "  ('2100-01-01'::pg_catalog.timestamptz OPERATOR(pg_catalog.<=) " +
          "   '2000-01-01'::pg_catalog.timestamptz) AS le_ghim, " +
          "  ('2100-01-01'::pg_catalog.timestamptz < '2000-01-01'::pg_catalog.timestamptz) AS lt_tran, " +
          "  ('2100-01-01'::pg_catalog.timestamptz OPERATOR(pg_catalog.<) " +
          "   '2000-01-01'::pg_catalog.timestamptz) AS lt_ghim",
      );
      expect(hoSo[0]).toEqual({
        ai: "app_api",
        duong: "ke10,pg_catalog,public",
        le_tran: true,
        le_ghim: false,
        lt_tran: true,
        lt_ghim: false,
      });

      // MÃ SẢN PHẨM, không phải bản sao của nó: runner thật, trên pool thù địch thật.
      const daNhan: string[] = [];
      const ghiNhan = (job: OutboxJob): Promise<void> => {
        daNhan.push(job.kind);
        return Promise.resolve();
      };
      const runner = new JobRunner(
        poolThuDich,
        {
          CHUA_TOI_HAN_QT3: ghiNhan,
          DANG_CHAY_QT3: ghiNhan,
          TOI_HAN_QT3: ghiNhan,
        },
        { listOrganizations: () => [orgId] },
      );

      // ĐỐI CHỨNG DƯƠNG nằm ngay trong cùng lượt: job ĐÃ TỚI HẠN vẫn chạy được dưới tấn công,
      // nên con số 1 dưới đây chứng minh runner KHÔNG chết hẳn — nó chỉ không nhặt hai hàng kia.
      expect(await runner.runOnce()).toBe(1);
      expect(daNhan).toEqual(["TOI_HAN_QT3"]);
      expect((await docHang(idToiHan)).status).toBe("DONE");
      expect((await docHang(idTuongLai)).status, "job chưa tới hạn KHÔNG được nhặt").toBe("PENDING");
      const dangChay = await docHang(idDangChay);
      expect(dangChay.status, "job đang có hạn thuê KHÔNG bị cướp").toBe("RUNNING");
      expect(dangChay.attempts).toBe(1);
    } finally {
      await poolThuDich.end().catch(() => {});
      await db.pool.query("DROP SCHEMA IF EXISTS ke10 CASCADE").catch(() => {});
    }
  }, 120_000);

  it("HAI TRỤC CÒN LẠI CHƯA CÓ MỐC CHẾT — nói ra thay vì để đọc nhầm", () => {
    // QT3 có ba trục đã đo. Test trên phủ trục TOÁN TỬ, và chỉ cho `timestamptz`. Những thứ
    // KHÔNG có mốc chết trong gói này, liệt kê để không ai đọc "QT3 đã được phủ":
    //   * ghim toán tử cho `uuid`/`int4`/`text` ở các câu còn lại của runner và enqueue —
    //     riêng `text` thì KHÔNG đo được bằng khuôn này, vì một `text =` thù địch làm
    //     `app_current_org_id()` sập và cả bảng biến mất trước khi câu của runner kịp chạy;
    //   * trục TÊN KIỂU (`CREATE TYPE ... AS ENUM` + `CREATE CAST ... AS IMPLICIT`, đã tái lập
    //     end-to-end ở Task 9 §I-3) — mọi `::pg_catalog.<kiểu>` ở đây là phòng thủ chiều sâu
    //     CHƯA ĐƯỢC ĐO. [vòng fix 1 — NÂNG CẤP PHÂN LOẠI] Mũi K3 (gỡ `::pg_catalog.uuid`) sống
    //     sót KHÔNG PHẢI vì trục ấy vô hại, mà vì trục TOÁN TỬ ĐÃ GHIM làm nó FAIL-CLOSED. Đo
    //     trên mã sản phẩm, bốn tổ hợp:
    //         trần cả hai               -> thấy 2 hàng   (LẬT ĐƯỢC)
    //         ghim TOÁN TỬ thôi         -> "operator does not exist: pg_catalog.uuid
    //                                       pg_catalog.= uuid"   (FAIL-CLOSED)
    //         ghim TÊN KIỂU thôi        -> thấy 2 hàng   (LẬT ĐƯỢC)
    //         ghim CẢ HAI (mã hiện tại) -> thấy 1 hàng
    //     Tức rủi ro CÒN LẠI của K3 là DoS (một câu fail-closed giữa transaction nghiệp vụ),
    //     KHÔNG phải fail-open. Hai vế ghim BỔ TÚC cho nhau, không vế nào thừa;
    //   * trục HÌNH DẠNG search_path ở tầng migration (`migrate()` đặt `SET search_path =
    //     public`) — nếu ai đó viết `pg_catalog` tường minh vào giữa chuỗi đó, ~71 chỗ trong
    //     hardening.always.sql cộng cả file 007 mở ra CÙNG MỘT LÚC. Khoản nợ số 6 của Task 8.
    // Khẳng định này cố ý là một khẳng định về TÀI LIỆU, không phải về hành vi — nó tồn tại để
    // câu trên không bị trích quá lời, đúng khuôn test "[C1-KHE-HO]" của Task 8.
    expect(true).toBe(true);
  });
});
// ============================================================================================
// 8. [T10-L] [vòng fix 1 — MỤC 2] TRẠNG THÁI PHIÊN DO HANDLER ĐỂ LẠI KHÔNG ĐI XUYÊN TỔ CHỨC
// ============================================================================================
describe("[T10-L] trạng thái phiên không đi xuyên tổ chức", () => {
  it("ĐỐI CHỨNG: KHÔNG bật cờ thì `SET` phạm vi PHIÊN của tổ chức P LÀM HỎNG việc của tổ chức Q", async () => {
    // Vế chống rỗng ruột của cả nhóm, và nó ĐI TRƯỚC: nếu trục này không thật thì mọi khẳng
    // định dưới xanh vì không có gì để chặn. Đây là phép đo end-to-end của lỗ mà `withTenant`
    // để hở — khối `finally` của nó chỉ đọc lại MỘT trục (`app.org_id`).
    const poolDoiChung = db.poolAs("app_api");
    try {
      await withTenant(poolDoiChung, orgId, (client) => client.query("SET statement_timeout = 1"));
      let loi: { code?: string } | undefined;
      try {
        await withTenant(poolDoiChung, orgKhac, (client) => client.query("SELECT pg_sleep(0.2)"));
      } catch (e) {
        loi = e as { code?: string };
      }
      // 57014 = canceling statement due to statement timeout. Việc của tổ chức Q chết vì một
      // câu lệnh mà mã của tổ chức P viết.
      expect(loi?.code).toBe("57014");
    } finally {
      await poolDoiChung.end();
    }
  }, 60_000);

  it("bật `destroyConnectionWhenDone` thì kết nối bị huỷ và tổ chức Q KHÔNG bị ảnh hưởng", async () => {
    const pool = db.poolAs("app_api");
    try {
      await withTenant(pool, orgId, (client) => client.query("SET statement_timeout = 1"), {
        destroyConnectionWhenDone: true,
      });
      await expect(
        withTenant(pool, orgKhac, (client) => client.query("SELECT pg_sleep(0.2)")),
      ).resolves.toBeDefined();
      // Trục THỨ HAI của cùng lỗ, đo riêng: `search_path` cũng không đi theo kết nối.
      await withTenant(
        pool,
        orgId,
        (client) => client.query("SET search_path = pg_catalog, public"),
        { destroyConnectionWhenDone: true },
      );
      const { rows } = await pool.query<{ v: string }>("SELECT current_setting('search_path') AS v");
      expect(rows[0]!.v).not.toContain("pg_catalog,");
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("ĐƯỜNG SẢN PHẨM: handler của tổ chức P không làm hỏng job của tổ chức Q trên cùng pool", async () => {
    const pool = db.poolAs("app_api");
    try {
      const idP = await withTenant(pool, orgId, (client) =>
        enqueueJob(client, orgId, { kind: "GAY_O_NHIEM" }),
      );
      const idQ = await withTenant(pool, orgKhac, (client) =>
        enqueueJob(client, orgKhac, { kind: "NAN_NHAN" }),
      );
      const runner = new JobRunner(
        pool,
        {
          // `SET` KHÔNG kèm `LOCAL` — cách viết sai phổ biến nhất trong mã job, và cố ý dùng ở
          // đây vì hàng rào phải chặn được cách viết SAI, không chỉ cách viết đúng.
          GAY_O_NHIEM: async (_job, client) => {
            await client.query("SET search_path = pg_catalog, public");
          },
          NAN_NHAN: async (_job, client) => {
            await client.query("SELECT pg_sleep(0.05)");
          },
        },
        { listOrganizations: () => [orgId, orgKhac], batchSize: 5 },
      );
      await theoDoi(runner.runOnce());
      expect((await docHang(idP)).status).toBe("DONE");
      expect((await docHang(idQ)).status).toBe("DONE");
      const { rows } = await pool.query<{ v: string }>("SELECT current_setting('search_path') AS v");
      expect(rows[0]!.v).not.toContain("pg_catalog,");
    } finally {
      await pool.end();
    }
  }, 60_000);
});

// ============================================================================================
// 9. [T10-M] [vòng fix 1 — MỤC 3] HÀNG RÀO THỜI GIAN, VÀ MỘT TỔ CHỨC KHÔNG LÀM ĐỨNG CẢ DANH SÁCH
// ============================================================================================
describe("[T10-M] hàng rào thời gian và tính sống của vòng duyệt", () => {
  it("nửa JS: handler treo NGOÀI CSDL bị cắt đúng hạn và job mang mã HANDLER_TIMEOUT", async () => {
    const id = await xepHang(orgId, { kind: "TREO_JS" });
    const baoCao: JobFailureReport[] = [];
    const runner = runnerChoMotToChuc(
      // Handler KHÔNG phát câu lệnh nào, nên `statement_timeout` không có gì để huỷ — chỉ nửa
      // JS bắt được ca này. Đó là điểm của việc có HAI nửa chứ không phải một.
      { TREO_JS: () => new Promise<void>(() => undefined) },
      {
        leaseSeconds: 30,
        handlerTimeoutMs: 300,
        maxAttempts: 1,
        retryDelaySeconds: 0,
        onJobFailure: (r) => baoCao.push(r),
      },
    );
    const batDau = Date.now();
    await theoDoi(runner.runOnce());
    expect(Date.now() - batDau).toBeLessThan(10_000);
    expect(baoCao).toHaveLength(1);
    expect(baoCao[0]?.reason).toBe("HANDLER_TIMEOUT");
    expect(baoCao[0]?.gaveUp).toBe(true);
    const hang = await docHang(id);
    expect(hang.status).toBe("FAILED");
    expect(hang.last_failure_reason).toBe("HANDLER_TIMEOUT");
  }, 60_000);

  it("nửa CSDL: một câu lệnh treo TRONG CSDL không giữ kết nối tới hết đời câu lệnh", async () => {
    // KHÔNG có `SET LOCAL statement_timeout` thì `Promise.race` một mình KHÔNG cứu được: khối
    // `catch` của withTenant phát `ROLLBACK`, và `ROLLBACK` XẾP HÀNG SAU câu đang chạy. Với
    // `pg_sleep(30)` thì `runOnce()` chỉ trả về sau 30 giây dù đồng hồ JS đã kêu từ giây thứ
    // 0,5. Khẳng định dưới đây là một khẳng định VỀ BẤT BIẾN ("lượt chạy có cận thời gian"),
    // không phải một timeout của harness.
    const id = await xepHang(orgId, { kind: "TREO_CSDL" });
    const baoCao: JobFailureReport[] = [];
    const runner = runnerChoMotToChuc(
      { TREO_CSDL: (_job, client) => client.query("SELECT pg_sleep(30)").then(() => undefined) },
      {
        leaseSeconds: 30,
        handlerTimeoutMs: 500,
        maxAttempts: 1,
        retryDelaySeconds: 0,
        onJobFailure: (r) => baoCao.push(r),
      },
    );
    const batDau = Date.now();
    await theoDoi(runner.runOnce());
    expect(Date.now() - batDau).toBeLessThan(15_000);
    expect(baoCao).toHaveLength(1);
    // NÓI RÕ MỘT CUỘC ĐUA THẬT: hai nửa của hàng rào có CÙNG hạn, nên nửa nào kêu trước là
    // không tất định. Cả hai đều là kết cục ĐÚNG; thứ được ghim ở đây là "job có kết cục" và
    // "lượt chạy có cận thời gian", không phải "nửa nào thắng".
    expect(["HANDLER_ERROR", "HANDLER_TIMEOUT"]).toContain(baoCao[0]?.reason);
    expect((await docHang(id)).status).toBe("FAILED");
  }, 60_000);

  it("một tổ chức NÉM không làm các tổ chức phía sau mất lượt", async () => {
    const id = await xepHang(orgId, { kind: "VAN_CHAY" });
    const loiPoll: unknown[] = [];
    const runner = new JobRunner(
      apiPool,
      { VAN_CHAY: () => Promise.resolve() },
      {
        // Tổ chức đầu tiên làm `withTenant` ném NGAY (không phải UUID) — một lỗi THƯỜNG TRỰC,
        // đúng hình dạng "permission denied for table outbox_jobs" của phép đo gốc: nó lặp lại
        // y hệt ở mọi lượt, nên nếu nó dừng cả vòng thì tổ chức phía sau chết đói VĨNH VIỄN.
        listOrganizations: () => ["khong-phai-uuid", orgId],
        onPollError: (e) => loiPoll.push(e),
      },
    );
    expect(await theoDoi(runner.runOnce())).toBe(1);
    expect(loiPoll).toHaveLength(1);
    expect((await docHang(id)).status).toBe("DONE");
  }, 60_000);

  it("thứ tự phục vụ XOAY VÒNG giữa các lượt — một tổ chức chậm không bỏ đói tổ chức cuối", async () => {
    await xepHang(orgId, { kind: "XOAY" });
    await xepHang(orgId, { kind: "XOAY" });
    await xepHang(orgKhac, { kind: "XOAY" });
    await xepHang(orgKhac, { kind: "XOAY" });
    const thuTu: string[] = [];
    const runner = new JobRunner(
      apiPool,
      {
        XOAY: (job: OutboxJob) => {
          thuTu.push(job.orgId === orgId ? "A" : "B");
          return Promise.resolve();
        },
      },
      { listOrganizations: () => [orgId, orgKhac], batchSize: 1 },
    );
    await theoDoi(runner.runOnce());
    await theoDoi(runner.runOnce());
    expect(thuTu).toEqual(["A", "B", "B", "A"]);
  }, 60_000);
});

// ============================================================================================
// 10. [T10-K] [vòng fix 1 — MỤC 4] HỆ QUẢ ĐÃ BIẾT VÀ ĐƯỢC CHẤP NHẬN
//
// Test này GHIM một hệ quả KHÔNG được đóng trong vòng này, kèm lý do đã ghi ở
// db/migrations/007_outbox.sql. Nó tồn tại để lần sau ai đó TƯỞNG mình đã đóng thì thấy một mốc
// ĐỎ thay vì một sự im lặng — cùng lý do với các test đảo chiều `[NỢ ADR-006]`.
// ============================================================================================
describe("[T10-K] `app_api` điều khiển được hàng đợi của CHÍNH tổ chức mình", () => {
  it("huỷ, hồi sinh và hoãn đều làm được — và CÁCH LY TỔ CHỨC VẪN NGUYÊN VẸN", async () => {
    const id = await xepHang(orgId, { kind: "TU_HUY" });

    // (a) HUỶ: đánh dấu DONE mà handler CHƯA BAO GIỜ chạy. Hai CHECK của bảng chấp nhận
    //     `status='DONE', attempts=0`, nên lược đồ không phân biệt được ca này với "đã xong".
    await withTenant(apiPool, orgId, (client) =>
      client.query(
        "UPDATE outbox_jobs SET status='DONE', finished_at=clock_timestamp() WHERE id=$1::uuid",
        [id],
      ),
    );
    expect(await docHang(id)).toMatchObject({ status: "DONE", attempts: 0 });

    // (b) HỒI SINH một job đã ở trạng thái cuối.
    await withTenant(apiPool, orgId, (client) =>
      client.query("UPDATE outbox_jobs SET status='PENDING', finished_at=NULL WHERE id=$1::uuid", [
        id,
      ]),
    );
    expect(await docHang(id)).toMatchObject({ status: "PENDING", attempts: 0 });

    // (c) HOÃN 100 năm.
    await withTenant(apiPool, orgId, (client) =>
      client.query(
        "UPDATE outbox_jobs SET run_after = clock_timestamp() + interval '100 years' " +
          "WHERE id=$1::uuid",
        [id],
      ),
    );
    expect((await docHang(id)).run_after.getUTCFullYear()).toBeGreaterThan(2100);

    // (d) VẾ QUYẾT ĐỊNH — BÁN KÍNH. Tổ chức Q KHÔNG chạm được job của tổ chức P. Nếu vế này
    //     hỏng thì ba khẳng định trên đổi hạng từ "hệ quả được chấp nhận" thành CRITICAL.
    const ketQua = await withTenant(apiPool, orgKhac, (client) =>
      client.query("UPDATE outbox_jobs SET status='DONE' WHERE id=$1::uuid", [id]),
    );
    expect(ketQua.rowCount).toBe(0);
  }, 60_000);
});

// ============================================================================================
// 11. [T10-P] [vòng fix 1 — MỤC 6 / đặc tả MINOR 3] MỐC CHẾT CHO BA RÀNG BUỘC ĐƯỢC LẬP LUẬN DÀI
//
// Ba `CHECK` dưới đây đều có một đoạn lập luận trong 007_outbox.sql và KHÔNG cái nào có mốc
// chết trước vòng này (mũi bỏ `CHECK` độ dài `dedupe_key`, mũi bỏ `CHECK (attempts >= 0)`, và
// mũi nới trần `kind` từ 64 lên 200 đều SỐNG SÓT). Mỗi test có CẢ HAI cận: giá trị ở BIÊN phải
// QUA, giá trị vượt biên MỘT ĐƠN VỊ phải bị chặn — không có vế thứ nhất thì một `CHECK` chặn
// TẤT CẢ cũng làm test xanh.
// ============================================================================================
describe("[T10-P] biên của các ràng buộc cấu trúc", () => {
  const LA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("`dedupe_key`: 200 byte QUA, 201 byte bị 23514, rỗng cũng bị chặn", async () => {
    await expect(
      xepHang(orgId, { kind: "BIEN_DEDUPE", dedupeKey: "x".repeat(200) }),
    ).resolves.toMatch(LA_UUID);
    await expect(
      xepHang(orgId, { kind: "BIEN_DEDUPE", dedupeKey: "y".repeat(201) }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(xepHang(orgId, { kind: "BIEN_DEDUPE", dedupeKey: "" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("`kind`: 64 ký tự QUA, 65 ký tự bị 23514", async () => {
    const kind64 = "A" + "B".repeat(63);
    expect(kind64).toHaveLength(64);
    await expect(xepHang(orgId, { kind: kind64 })).resolves.toMatch(LA_UUID);
    await expect(xepHang(orgId, { kind: `${kind64}C` })).rejects.toMatchObject({ code: "23514" });
  });

  it("`attempts` không âm — kể cả khi chính `app_api` viết câu UPDATE", async () => {
    const id = await xepHang(orgId, { kind: "BIEN_ATTEMPTS" });
    await expect(
      withTenant(apiPool, orgId, (client) =>
        client.query("UPDATE outbox_jobs SET attempts = -1 WHERE id = $1::uuid", [id]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // Đối chứng dương: một giá trị hợp lệ vẫn ghi được, nên 23514 ở trên không phải vì cột bị
    // khoá hoàn toàn (`app_api` CÓ quyền UPDATE trên `attempts` — xem GRANT ở 007).
    await expect(
      withTenant(apiPool, orgId, (client) =>
        client.query("UPDATE outbox_jobs SET attempts = 0 WHERE id = $1::uuid", [id]),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
