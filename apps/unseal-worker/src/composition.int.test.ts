// =============================================================================================
// [khoản nợ 34] CẢNH BÁO BREAK-GLASS NAY CÓ NGƯỜI NHẬN — VÀ MỘT LẦN HỎNG THÔI IM LẶNG
//
// Ba điều được đo ở đây, và điều thứ ba là điều khó nhất:
//   ⑴ một job `BREAK_GLASS_UNSEAL_ALERT` thật sự tới được một adapter gửi, và để lại một bản ghi
//     `BREAK_GLASS_ALERT_DELIVERED`;
//   ⑵ một lần gửi HỎNG làm job thất bại và `onJobFailure` được gọi — không nuốt;
//   ⑶ MỌI `kind` được enqueue ở đâu đó trong kho HOẶC có handler ở đây, HOẶC nằm trong
//     `KIND_KHONG_NHAN` kèm lý do. Một `kind` thứ ba ra đời mà không ai quyết định làm test ĐỎ.
//
// Vế ⑶ là vế chống *"hàng rào tự làm mù mình bằng một danh sách tên"* — cùng khuôn khoản nợ 3,
// 16 và 33, và lần này lớp canh được dựng CÙNG LÚC với thứ nó canh chứ không sau.
// =============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { enqueueJob, type JobFailureReport } from "@trustprocure/outbox";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  BREAK_GLASS_ALERT_KIND,
  KIND_KHONG_NHAN,
  UNSEAL_JOB_KIND,
  buildUnsealWorkerHandlers,
  createUnsealWorkerRunner,
  type BreakGlassAlert,
} from "./composition.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const GOC = fileURLToPath(new URL("../../../", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;

/** Bộ mở bọc giả — không lượt nào của file này chạy tới đường mở thầu thật. */
const boMoBocGia = {
  name: "khong-dung-toi",
  unwrap: () => Promise.reject(new Error("khong nen goi toi day")),
};

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
  expect(orgA).not.toBe("");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[INV-D4] cảnh báo break-glass có người nhận, và một lần hỏng không im lặng", () => {
  it("[INV-D4] job cảnh báo TỚI được adapter gửi, và để lại bản ghi ĐÃ GIAO", async () => {
    const daNhan: BreakGlassAlert[] = [];
    const hong: JobFailureReport[] = [];
    const runner = createUnsealWorkerRunner(
      unsealPool,
      {
        unwrapper: boMoBocGia,
        alertSink: {
          name: "adapter-cua-test",
          deliver: (a) => {
            daNhan.push(a);
            return Promise.resolve();
          },
        },
        onJobFailure: (r) => hong.push(r),
      },
      { pollIntervalMs: 1000 },
    );

    const jobId = await withTenant(apiPool, orgA, (c) =>
      enqueueJob(c, orgA, {
        kind: BREAK_GLASS_ALERT_KIND,
        payload: {
          unsealRequestId: "11111111-1111-4111-8111-111111111111",
          rfqId: "22222222-2222-4222-8222-222222222222",
          severity: "HIGH",
        },
      }),
    );
    await runner.runOnceForOrg(orgA);

    expect(hong, "không lượt nào được phép hỏng ở ca thuận").toEqual([]);
    expect(daNhan.length, "cảnh báo KHÔNG tới được adapter nào — đúng lỗ của khoản nợ 34").toBe(1);
    expect(daNhan[0]?.orgId).toBe(orgA);
    expect(daNhan[0]?.severity).toBe("HIGH");

    const { rows } = await db.pool.query<{ payload: { kenh: string } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'BREAK_GLASS_ALERT_DELIVERED'",
      [orgA],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload.kenh, "bản ghi phải nói cảnh báo đi ĐƯỜNG NÀO").toBe("adapter-cua-test");

    const { rows: tt } = await db.pool.query<{ status: string }>(
      "SELECT status FROM outbox_jobs WHERE id = $1",
      [jobId],
    );
    expect(tt[0]?.status).toBe("DONE");
  });

  it("[INV-D4] một lần GỬI HỎNG làm job thất bại VÀ gọi `onJobFailure` — không nuốt", async () => {
    // Đây là vế chịu lực của khoản nợ 34: `JobRunnerOptions.onJobFailure` là TUỲ CHỌN và mặc
    // định IM LẶNG. `UnsealWorkerDeps` ép nó thành bắt buộc, nên một composition root không còn
    // diễn đạt được cấu hình "hỏng trong im lặng".
    const hong: JobFailureReport[] = [];
    const runner = createUnsealWorkerRunner(
      unsealPool,
      {
        unwrapper: boMoBocGia,
        alertSink: {
          name: "adapter-hong",
          deliver: () => Promise.reject(new Error("SMTP tu choi")),
        },
        onJobFailure: (r) => hong.push(r),
      },
      { pollIntervalMs: 1000, maxAttempts: 1 },
    );

    await withTenant(apiPool, orgA, (c) =>
      enqueueJob(c, orgA, {
        kind: BREAK_GLASS_ALERT_KIND,
        payload: {
          unsealRequestId: "33333333-3333-4333-8333-333333333333",
          rfqId: "44444444-4444-4444-8444-444444444444",
        },
        dedupeKey: "canh-bao-hong",
      }),
    );
    await runner.runOnceForOrg(orgA);

    expect(hong.length, "một lần gửi hỏng KHÔNG được đi qua trong im lặng").toBe(1);
    expect(hong[0]?.kind).toBe(BREAK_GLASS_ALERT_KIND);
    expect(hong[0]?.gaveUp, "maxAttempts = 1 nên nó bỏ cuộc ngay").toBe(true);

    // Và KHÔNG có bản ghi "đã giao" nào: ghi sổ đứng SAU lần gửi, nên một lần gửi hỏng không để
    // lại một câu nói dối trong sổ kiểm toán.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events " +
        " WHERE org_id = $1 AND action = 'BREAK_GLASS_ALERT_DELIVERED' " +
        "   AND resource_id = '33333333-3333-4333-8333-333333333333'",
      [orgA],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[khoản nợ 34] MỌI `kind` được enqueue trong kho đều đã được QUYẾT ĐỊNH", () => {
    // Suy từ TÍNH CHẤT: quét mọi nguồn `.ts` và `.sql` tìm những chuỗi được dùng làm `kind`, rồi
    // đòi mỗi cái HOẶC có handler, HOẶC nằm trong `KIND_KHONG_NHAN`. Một `kind` mới ra đời mà
    // không ai quyết định sẽ ĐỎ ở đây — thay vì lặng lẽ thành `NO_HANDLER`.
    const cacTep = execFileSync("git", ["ls-files", "packages", "apps", "db"], {
      cwd: GOC,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter((t) => (t.endsWith(".ts") || t.endsWith(".sql")) && !t.includes(".test."));

    const kind = new Set<string>();
    for (const t of cacTep) {
      const noiDung = readFileSync(join(GOC, t), "utf8");
      // BA hình dạng THẬT trong kho, và ba là đủ vì mỗi cái tương ứng một cách enqueue có thật:
      //   ⑴ `kind: "X"`      — lời gọi `enqueueJob` phía TypeScript;
      //   ⑵ `..._KIND = "X"` — hằng được export rồi truyền vào chỗ khác;
      //   ⑶ `INSERT INTO public.outbox_jobs (org_id, kind, ...) VALUES (..., 'X', ...)` — trigger
      //      plpgsql, và nó luôn đặt `kind` ở ĐÚNG vị trí thứ hai của danh sách cột.
      //
      // Vế ⑶ bản đầu quét lỏng (`outbox_jobs` rồi bất kỳ chuỗi HOA nào trong 400 ký tự) và nó
      // nhặt luôn `PENDING`/`RUNNING` — tức lớp canh tự sinh việc cho mình. Nay nó bám vào CẤU
      // TRÚC câu lệnh chứ không vào khoảng cách.
      // Vế ⑴ phải bám vào `enqueueJob(`, không vào chữ `kind` một mình: dự án có những đối
      // tượng KHÁC cũng mang trường `kind` (`SEQ_GAP`, `LINK_BROKEN`, … của bộ kiểm chuỗi
      // kiểm toán), và bản đầu nhặt luôn chúng — một lớp canh tự sinh việc cho mình.
      for (const m of noiDung.matchAll(
        /enqueueJob\([\s\S]{0,400}?\bkind:\s*"([A-Z][A-Z0-9_]{2,63})"/g,
      )) {
        kind.add(m[1] ?? "");
      }
      for (const m of noiDung.matchAll(/_KIND\s*=\s*"([A-Z][A-Z0-9_]{2,63})"/g)) kind.add(m[1] ?? "");
      for (const m of noiDung.matchAll(
        /INSERT\s+INTO\s+(?:public\.)?outbox_jobs\s*\(\s*org_id\s*,\s*kind[^)]*\)\s*VALUES\s*\(\s*[^,]+,\s*'([A-Z][A-Z0-9_]{2,63})'/gi,
      )) {
        kind.add(m[1] ?? "");
      }
    }
    // Chống rỗng ruột: phép quét phải THẬT SỰ thấy hai `kind` đã biết.
    expect([...kind]).toContain(BREAK_GLASS_ALERT_KIND);
    expect([...kind]).toContain(UNSEAL_JOB_KIND);

    const coHandler = new Set(
      Object.keys(
        buildUnsealWorkerHandlers({
          unwrapper: boMoBocGia,
          alertSink: { name: "x", deliver: () => Promise.resolve() },
          onJobFailure: () => undefined,
        }),
      ),
    );
    const chuaQuyet = [...kind].filter(
      (k) => !coHandler.has(k) && !Object.hasOwn(KIND_KHONG_NHAN, k),
    );
    expect(
      chuaQuyet,
      "Một `kind` được enqueue ở đâu đó nhưng KHÔNG có handler và cũng KHÔNG nằm trong " +
        "KIND_KHONG_NHAN. Nếu worker này phải nhận nó, thêm handler; nếu không, thêm một dòng " +
        "vào KIND_KHONG_NHAN kèm lý do. Bỏ qua nghĩa là job ấy thành NO_HANDLER và chết trong " +
        "im lặng — đúng khoản nợ 34.",
    ).toEqual([]);
  });

  it("[khoản nợ 34] hai rổ không giao nhau — một `kind` không thể vừa nhận vừa không nhận", () => {
    const coHandler = Object.keys(
      buildUnsealWorkerHandlers({
        unwrapper: boMoBocGia,
        alertSink: { name: "x", deliver: () => Promise.resolve() },
        onJobFailure: () => undefined,
      }),
    );
    for (const k of coHandler) expect(Object.hasOwn(KIND_KHONG_NHAN, k)).toBe(false);
  });
});
