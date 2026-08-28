import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { JobRunner, enqueueJob, type JobFailureReport, type OutboxJob } from "./index.js";

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
  handlers: Readonly<Record<string, (job: OutboxJob) => Promise<void>>>,
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
    expect(baoCaoA.map((r) => r.reason)).toEqual(["LEASE_LOST"]);
    // Và mã LEASE_LOST KHÔNG BAO GIỜ vào CSDL — CHECK của 007 cố ý không có giá trị đó.
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
    expect(baoCaoA.map((r) => r.reason)).toEqual(["LEASE_LOST"]);
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
    expect(baoCaoA.map((r) => r.reason)).toEqual(["LEASE_LOST"]);
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
    const id = await xepHang(orgId, { kind: "CHAN_VAN_BAN" });
    await expect(
      db.pool.query("UPDATE outbox_jobs SET last_failure_reason = $2 WHERE id = $1::uuid", [
        id,
        `gia ${GIA_THAU}`,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    // Đối chứng dương: một mã thuộc tập đóng vẫn ghi được, nên "23514" ở trên không phải vì cột
    // bị khoá hoàn toàn.
    await expect(
      db.pool.query(
        "UPDATE outbox_jobs SET last_failure_reason = 'HANDLER_ERROR' WHERE id = $1::uuid",
        [id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
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

    // (ii) Nó bỏ qua cả GRANT: app_unseal KHÔNG có quyền nào trên bảng này (xem [T10-G]), nhưng
    //      một phiên siêu người dùng đọc được như thường. Một bộ test chạy trên pool ấy vì thế
    //      xanh y hệt khi mọi GRANT bị thu hồi.
    const unsealPool = db.poolAs("app_unseal");
    try {
      await expect(unsealPool.query("SELECT 1 FROM outbox_jobs LIMIT 1")).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await unsealPool.end();
    }
    await expect(db.pool.query("SELECT 1 FROM outbox_jobs LIMIT 1")).resolves.toBeDefined();
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
  it("app_unseal KHÔNG có một quyền nào — mức BẢNG lẫn mức CỘT, và PUBLIC cũng vậy", async () => {
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

    expect(mucBang.filter((h) => h.ai === "app_unseal")).toEqual([]);
    expect(mucCot.filter((h) => h.ai === "app_unseal")).toEqual([]);
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
    //     CHƯA ĐƯỢC ĐO;
    //   * trục HÌNH DẠNG search_path ở tầng migration (`migrate()` đặt `SET search_path =
    //     public`) — nếu ai đó viết `pg_catalog` tường minh vào giữa chuỗi đó, ~71 chỗ trong
    //     hardening.always.sql cộng cả file 007 mở ra CÙNG MỘT LÚC. Khoản nợ số 6 của Task 8.
    // Khẳng định này cố ý là một khẳng định về TÀI LIỆU, không phải về hành vi — nó tồn tại để
    // câu trên không bị trích quá lời, đúng khuôn test "[C1-KHE-HO]" của Task 8.
    expect(true).toBe(true);
  });
});
