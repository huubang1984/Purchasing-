// =============================================================================================
// [khoản nợ 34] CẢNH BÁO BREAK-GLASS NAY CÓ NGƯỜI NHẬN — VÀ MỘT LẦN HỎNG THÔI IM LẶNG
//
// Ba điều được đo ở đây, và điều thứ ba là điều khó nhất:
//   ⑴ một job `BREAK_GLASS_UNSEAL_ALERT` thật sự tới được một adapter gửi, và để lại một bản ghi
//     `BREAK_GLASS_ALERT_DELIVERED`;
//   ⑵ một lần gửi HỎNG làm job thất bại và `onJobFailure` được gọi — không nuốt;
//   ⑶ ~~MỌI `kind` được enqueue ở đâu đó trong kho HOẶC có handler ở đây, HOẶC nằm trong
//     `KIND_KHONG_NHAN` kèm lý do.~~ **[S1.81 / khoản 154]** MỌI `kind` được enqueue ở đâu đó
//     trong kho phải có handler ở MỘT TIẾN TRÌNH NÀO ĐÓ (worker hoặc api, đối chiếu bảng handler
//     THẬT), hoặc được khai trong `KIND_KHONG_NGUOI_NHAN` kèm một khoản CÒN MỞ.
//
// Vế ⑶ là vế chống *"hàng rào tự làm mù mình bằng một danh sách tên"* — cùng khuôn khoản nợ 3,
// 16 và 33, và lần này lớp canh được dựng CÙNG LÚC với thứ nó canh chứ không sau.
//
// **[S1.81] Và chính vế ⑶ đã tự làm mù mình theo đúng lớp nó chống.** Câu hỏi cũ — *"worker này
// đã quyết định chưa"* — xanh với `RFQ_DEADLINE_EXTENDED_NOTICE` suốt từ 2026-09-05, trong khi
// không tiến trình nào trong kho nhận nó. Cổng hỏi sai câu, và một cổng hỏi sai câu xanh hơn một
// cổng không tồn tại. Câu hỏi mới đối chiếu với `Object.keys` của cả hai bảng handler.
// =============================================================================================

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { KIND_KHONG_NGUOI_NHAN, enqueueJob, type JobFailureReport } from "@trustprocure/outbox";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
// [S1.81 / khoản 154] Import TƯƠNG ĐỐI xuyên app, cùng lý do và cùng tiền lệ với
// `kich-ban-41-http.int.test.ts`: cổng dưới đây phải đọc bảng handler THẬT của cả hai tiến trình
// bằng `Object.keys`, không bằng một biểu thức chính quy trên văn bản — một handler thêm vào bằng
// spread hay bằng khoá tính toán vô hình với mọi phép quét văn bản. Test là nơi duy nhất nối hai
// app; `@trustprocure/api` KHÔNG được thành dependency của worker (đường chạy worker không chạm api).
import { buildApiOutboxHandlers } from "../../api/src/outbox-api.js";
import { dichVuTest } from "../../api/src/test-services.js";
import {
  BREAK_GLASS_ALERT_KIND,
  KIND_KHONG_NHAN,
  UNSEAL_JOB_KIND,
  buildUnsealWorkerHandlers,
  createUnsealWorkerRunner,
  type BreakGlassAlert,
} from "./composition.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** [S1.82] Lỗi của chính vòng poll — gom lại để không lượt nào nuốt nó trong im lặng. */
const hongPoll: unknown[] = [];
const GOC = fileURLToPath(new URL("../../../", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let auditUnsealPool: pg.Pool;
let orgA: string;

/** Bộ mở bọc giả — không lượt nào của file này chạy tới đường mở thầu thật. */
const boMoBocGia = {
  name: "khong-dung-toi",
  openOrgKey: () => Promise.reject(new Error("khong nen goi toi day")),
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
  auditUnsealPool = db.poolAs("app_unseal");
  expect(orgA).not.toBe("");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await auditUnsealPool?.end().catch(() => undefined);
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
        auditPool: auditUnsealPool,
        alertSink: {
          name: "adapter-cua-test",
          deliver: (a) => {
            daNhan.push(a);
            return Promise.resolve();
          },
        },
        onJobFailure: (r) => hong.push(r),
      },
      {
        // [S1.82 / khoản 116] Hai vế này BẮT BUỘC. Các lượt dưới gọi `runOnceForOrg` tường minh
        // nên nguồn danh sách tổ chức không được dùng tới; khai nó ra để hợp đồng ở tầng
        // composition đọc được, và để một ngày ai đó đổi sang `runOnce()` thì không phải đi tìm.
        listOrganizations: () => [orgA],
        onPollError: (e) => hongPoll.push(e),
        pollIntervalMs: 1000,
      },
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
        auditPool: auditUnsealPool,
        alertSink: {
          name: "adapter-hong",
          deliver: () => Promise.reject(new Error("SMTP tu choi")),
        },
        onJobFailure: (r) => hong.push(r),
      },
      {
        // [S1.82 / khoản 116] Hai vế này BẮT BUỘC. Các lượt dưới gọi `runOnceForOrg` tường minh
        // nên nguồn danh sách tổ chức không được dùng tới; khai nó ra để hợp đồng ở tầng
        // composition đọc được, và để một ngày ai đó đổi sang `runOnce()` thì không phải đi tìm.
        listOrganizations: () => [orgA],
        onPollError: (e) => hongPoll.push(e),
        pollIntervalMs: 1000, maxAttempts: 1,
      },
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

    // [S1.81 / khoản 154] CÂU HỎI CỦA CỔNG NÀY ĐÃ ĐỔI, và cái cũ là một lớp canh tự làm mù mình.
    //
    // Bản tới S1.80 hỏi *"worker này đã QUYẾT ĐỊNH `kind` ấy chưa"* — có handler, hoặc có một
    // dòng trong `KIND_KHONG_NHAN`. Đo được rằng câu ấy không đủ: `RFQ_DEADLINE_EXTENDED_NOTICE`
    // nằm trong `KIND_KHONG_NHAN` kèm lý do đúng (*"thuộc app gửi, không thuộc worker"*) nên cổng
    // XANH, trong khi `apps/api` chỉ đăng ký `LOGIN_LINK_SEND` — tức KHÔNG tiến trình nào trong
    // kho nhận nó. Một lời bào chữa trỏ sang một tiến trình khác mà không ai đối chiếu với tiến
    // trình ấy là một lời bào chữa không kiểm được.
    //
    // Nay cổng hỏi *"có tiến trình nào NHẬN không"*, và nó đối chiếu với bảng handler THẬT của cả
    // hai tiến trình bằng `Object.keys`. Chỉ còn một đường bào chữa: `KIND_KHONG_NGUOI_NHAN` ở
    // `@trustprocure/outbox`, và mỗi dòng ở đó phải trỏ tới một khoản CÒN MỞ (vế ⑶ dưới).
    const handlerWorker = Object.keys(
      buildUnsealWorkerHandlers({
        unwrapper: boMoBocGia,
        auditPool: auditUnsealPool,
        alertSink: { name: "x", deliver: () => Promise.resolve() },
        onJobFailure: () => undefined,
      }),
    );
    const handlerApi = Object.keys(buildApiOutboxHandlers(dichVuTest().services));
    // Chống rỗng ruột ở vế mới: hai bảng handler phải THẬT SỰ không rỗng và không trùng nhau.
    expect(handlerWorker.length, "bảng handler của worker rỗng — phép đối chiếu vô nghĩa").toBeGreaterThan(0);
    expect(handlerApi.length, "bảng handler của api rỗng — phép đối chiếu vô nghĩa").toBeGreaterThan(0);
    const coNguoiNhan = new Set([...handlerWorker, ...handlerApi]);

    // ⑴ mọi `kind` enqueue được phải có người nhận, hoặc được KHAI là mồ côi.
    const khongAiNhan = [...kind].filter(
      (k) => !coNguoiNhan.has(k) && !Object.hasOwn(KIND_KHONG_NGUOI_NHAN, k),
    );
    expect(
      khongAiNhan,
      "Một `kind` được enqueue ở đâu đó nhưng KHÔNG tiến trình nào có handler cho nó, và nó " +
        "cũng KHÔNG được khai trong KIND_KHONG_NGUOI_NHAN. Đường ĐÚNG là viết handler ở tiến " +
        "trình giữ đủ quyền cho nó. Khai vào sổ mồ côi là đường TẠM, và nó đòi một khoản còn " +
        "mở giữ chặng cuối — xem packages/outbox/src/so-kind-mo-coi.ts.",
    ).toEqual([]);

    // ⑵ hai rổ không giao nhau. Vế này là vế GIẾT VIỆC: một `kind` vừa khai mồ côi vừa có
    // handler ở tiến trình khác sẽ bị tiến trình khai sổ nhặt rồi ghi thẳng `FAILED`/`NO_HANDLER`
    // trước khi tiến trình có handler kịp chạm tới — đúng lỗi mà cả vòng S1.81 tồn tại để vá,
    // chỉ khác là lần này do một dòng khai tường minh.
    const vuaNhanVuaMoCoi = [...coNguoiNhan].filter((k) => Object.hasOwn(KIND_KHONG_NGUOI_NHAN, k));
    expect(
      vuaNhanVuaMoCoi,
      "Một `kind` vừa có handler vừa được khai mồ côi. Tiến trình khai sổ sẽ GIẾT job của tiến " +
        "trình có handler: nó claim job ấy (kind nằm trong mảng lọc) rồi ghi NO_HANDLER, bỏ cuộc " +
        "ngay lượt thử thứ nhất. Xoá dòng khỏi KIND_KHONG_NGUOI_NHAN.",
    ).toEqual([]);

    // ⑶ mỗi dòng của sổ mồ côi phải trỏ tới một khoản CÒN MỞ. Một `kind` mồ côi VĨNH VIỄN là một
    // tính năng chết, không phải một trạng thái ổn định — và khoản đóng mà sổ còn trỏ tới là
    // đúng lớp "lời khai ngoài sổ không ai đối chiếu" của khoản 151.
    const so = readFileSync(join(GOC, "docs/STATE.md"), "utf8");
    for (const [k, lyDo] of Object.entries(KIND_KHONG_NGUOI_NHAN)) {
      const soKhoan = /khoản (\d+)/.exec(lyDo)?.[1];
      expect(soKhoan, `lý do của \`${k}\` không nêu số khoản: ${lyDo}`).toBeDefined();
      const hang = so.split(/\r?\n/).find((d) => d.startsWith(`| ${String(soKhoan)} |`));
      expect(hang, `docs/STATE.md không có hàng cho khoản ${String(soKhoan)} (\`${k}\`)`).toBeDefined();
      expect(
        hang,
        `khoản ${String(soKhoan)} không còn MỞ, nhưng \`${k}\` vẫn được khai mồ côi. Hoặc viết ` +
          "handler cho nó, hoặc mở lại khoản giữ chặng cuối của nó.",
      ).toContain("**[MỞ]**");
    }
  });

  it("[khoản nợ 34] hai rổ không giao nhau — một `kind` không thể vừa nhận vừa không nhận", () => {
    const coHandler = Object.keys(
      buildUnsealWorkerHandlers({
        unwrapper: boMoBocGia,
        auditPool: auditUnsealPool,
        alertSink: { name: "x", deliver: () => Promise.resolve() },
        onJobFailure: () => undefined,
      }),
    );
    for (const k of coHandler) expect(Object.hasOwn(KIND_KHONG_NHAN, k)).toBe(false);
  });
});

// ===============================================================================================
// [S1.72 / khoản 121] ĐƯỜNG CHẠY THẬT CỦA LẦN TỪ CHỐI LÚC GIẢI MÃ: MỖI LƯỢT THỬ MỘT HÀNG SỔ
//
// Đo trên master 298cd4e, trước bản vá (§S1.72): job UNSEAL_RFQ trên một yêu cầu bị từ chối — ba lượt thử, ba báo cáo `onJobFailure`, job
// FAILED, 0 hàng sổ. Runner không phân biệt lần từ chối với lỗi hạ tầng (khối `HANDLER_ERROR` của `runner.ts`), nên một lần từ chối xác
// định vẫn đốt đủ `maxAttempts` lượt — và từ khoản 121 mỗi lượt để lại một `UNSEAL_EXECUTION_DENIED`. Test ghim hệ quả ấy.
// ===============================================================================================
describe("[INV-D5] [S1.72 / khoản 121] job mở thầu bị worker từ chối để lại dấu vết ở mỗi lượt thử", () => {
  it("[INV-D5] job UNSEAL_RFQ trên yêu cầu không tìm thấy ⇒ mỗi lượt thử một `UNSEAL_EXECUTION_DENIED` và một báo cáo `onJobFailure`; hết lượt thì job FAILED", async () => {
    const id = randomUUID();
    const hong: JobFailureReport[] = [];
    const runner = createUnsealWorkerRunner(
      unsealPool,
      {
        unwrapper: boMoBocGia,
        auditPool: auditUnsealPool,
        alertSink: { name: "khong-dung-toi", deliver: () => Promise.resolve() },
        onJobFailure: (r) => hong.push(r),
      },
      {
        // [S1.82 / khoản 116] Hai vế này BẮT BUỘC. Các lượt dưới gọi `runOnceForOrg` tường minh
        // nên nguồn danh sách tổ chức không được dùng tới; khai nó ra để hợp đồng ở tầng
        // composition đọc được, và để một ngày ai đó đổi sang `runOnce()` thì không phải đi tìm.
        listOrganizations: () => [orgA],
        onPollError: (e) => hongPoll.push(e),
        maxAttempts: 2,
      },
    );
    const jobId = await withTenant(apiPool, orgA, (c) =>
      enqueueJob(c, orgA, { kind: UNSEAL_JOB_KIND, payload: { unsealRequestId: id }, dedupeKey: `unseal:${id}` }),
    );
    const dem = async (): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_EXECUTION_DENIED' AND resource_id = $2",
        [orgA, id],
      );
      return Number(rows[0]?.n ?? "-1");
    };

    await runner.runOnceForOrg(orgA);
    expect(hong.length).toBe(1);
    expect(await dem(), "lượt thử đầu bị từ chối mà không vào sổ").toBe(1);

    // Lượt thử lại chờ `retryDelaySeconds` (30 s mặc định): kéo `run_after` về hiện tại thay vì chờ.
    await db.pool.query("UPDATE outbox_jobs SET run_after = now() WHERE id = $1", [jobId]);
    await runner.runOnceForOrg(orgA);
    expect(hong.length).toBe(2);
    expect(await dem(), "mỗi lượt thử là một lần từ chối — và một hàng sổ").toBe(2);
    const { rows } = await db.pool.query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM outbox_jobs WHERE id = $1",
      [jobId],
    );
    expect(rows[0]).toEqual({ status: "FAILED", attempts: 2 });
  });
});
