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
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { DenialAuditFailedError, moTaLoiKhongGiaTri } from "@trustprocure/identity";
import { TenantError, withTenant } from "@trustprocure/tenancy";
import { KIND_KHONG_NGUOI_NHAN, enqueueJob, type JobFailureReport } from "@trustprocure/outbox";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
// [S1.81 / khoản 154] Import TƯƠNG ĐỐI xuyên app, cùng lý do và cùng tiền lệ với
// `kich-ban-41-http.int.test.ts`: cổng dưới đây phải đọc bảng handler THẬT của cả hai tiến trình
// bằng `Object.keys`, không bằng một biểu thức chính quy trên văn bản — một handler thêm vào bằng
// spread hay bằng khoá tính toán vô hình với mọi phép quét văn bản. Test là nơi duy nhất nối hai
// app; `@trustprocure/api` KHÔNG được thành dependency của worker (đường chạy worker không chạm api).
import { buildApiOutboxHandlers } from "../../api/src/outbox-api.js";
import { dichVuTest } from "../../api/src/test-services.js";
// [S1.9151 / khoản 166] Bộ mô tả lỗi của TIẾN TRÌNH `api`, để vế cuối tệp đối chiếu dòng log của
// worker với chuỗi mà `api` cho CÙNG một lỗi. Cùng lý do và cùng tiền lệ với hai dòng trên: test
// là nơi duy nhất nối hai app.
import { moTaLoiKhongGiaTri as moTaLoiCuaApi } from "../../api/src/mo-ta-loi.js";
import { docCauHinh } from "./cau-hinh.js";
import { taoTienTrinhUnsealWorker } from "./tien-trinh.js";
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
/** [khoản 166] Chuỗi kết nối của vai ĐĂNG NHẬP thật của worker, cho vế dựng tiến trình từ cấu hình. */
let urlLogin: string;
let thuMucCanhBao: string;
const KHOA_32 = Buffer.alloc(32, 3).toString("base64");

function doiNguoiDung(chuoi: string, nguoi: string, matKhau: string): string {
  const u = new URL(chuoi);
  u.username = nguoi;
  u.password = matKhau;
  return u.toString();
}

/** Cùng khuôn `tien-trinh.int.test.ts`: cấu hình tối thiểu để `docCauHinh` dựng được tiến trình. */
function moiTruong(ghiDe: Record<string, string> = {}): Record<string, string> {
  return {
    TRUSTPROCURE_DATABASE_URL: urlLogin,
    TRUSTPROCURE_DB_POOL_MAX: "2",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
    TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
    TRUSTPROCURE_ALERT_DIR: thuMucCanhBao,
    ...ghiDe,
  };
}

/** Cùng câu với `apps/api/src/log-tu-choi-mat.int.test.ts`: khoá tư vấn ghi sổ của tổ chức đang được cầm chưa. */
async function demKhoaGiuDuoc(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted " +
      "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [org],
  );
  return rows[0]?.n ?? -1;
}

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
  // [khoản 166] Vai đăng nhập thật của worker — `docCauHinh` từ chối URL superuser theo TÊN.
  await db.pool.query("CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk-unseal' IN ROLE app_unseal");
  urlLogin = doiNguoiDung(db.connectionString, "app_unseal_login", "mk-unseal");
  thuMucCanhBao = mkdtempSync(join(tmpdir(), "tp-canh-bao-166-"));
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

// ===============================================================================================
// [S1.9151 / khoản 166] MỘT BỘ MÔ TẢ LỖI CHO CẢ HAI TIẾN TRÌNH — ĐO TRÊN TIẾN TRÌNH WORKER DỰNG TỪ CẤU HÌNH
//
// Khoản 166 (§S1.82): `moTaLoiKhongGiaTri` có HAI bản. Bản đầy đủ ở `apps/api/src/mo-ta-loi.ts` nêu
// thêm MỘT tầng `cause` cho lỗi không có trường `code` (khoản 119) và nhận `TenantError` theo lớp;
// bản rút gọn ~5 dòng ở `tien-trinh.ts` của tiến trình này — vì mã CHẠY của worker không import được
// `apps/api` (`g1-`) — thì không. Hệ quả: một `DenialAuditFailedError`, đúng lớp lỗi khoản 121 dựng
// cho tiến trình NÀY, ra dòng log không có SQLSTATE của lần ghi sổ đã hỏng ở worker, trong khi ở `api`
// cùng lỗi ấy ra `… <- error 55P03`. Tức tiến trình DUY NHẤT giải mã được lại có chẩn đoán nghèo hơn.
//
// Cảnh dựng cùng khuôn `apps/api/src/log-tu-choi-mat.int.test.ts` (§S1.85): một giao dịch khác giữ
// khoá ghi sổ của tổ chức quá trần 2 s của `050`; job `UNSEAL_RFQ` trên một yêu cầu không tìm thấy bị
// từ chối, lần ghi `UNSEAL_EXECUTION_DENIED` ở `auditPool` gãy `55P03`, handler ném
// `DenialAuditFailedError` mang lỗi ấy ở `cause`, và `onJobFailure` của `tien-trinh.ts` ghi dòng.
// Vế đối chiếu: bộ mô tả của `api` cho một lỗi CÙNG HÌNH DẠNG phải cho đúng phần đuôi của dòng ấy.
// ===============================================================================================
describe("[INV-A2] [S1.9151 / khoản 166] dòng log của worker mô tả lỗi bằng CÙNG một hàm với api", () => {
  it("lần ghi sổ từ chối của worker gãy 55P03 ⇒ dòng `outbox` của tiến trình thật mang tên lớp bọc, hai hằng đóng và `<- error 55P03` — đúng chuỗi bộ mô tả của api cho cùng lỗi; không mang giá trị nào", async () => {
    const poolGiuKhoa = createPool(db.connectionString, 1, { role: "app_api" });
    let thaKhoa: () => void = () => {};
    const choTha = new Promise<void>((xong) => {
      thaKhoa = xong;
    });
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong({ TRUSTPROCURE_OUTBOX_POLL_MS: "200" })));
    let giuKhoa: Promise<void> | undefined;
    const id = randomUUID();
    let jobId = "";
    try {
      giuKhoa = withTenant(poolGiuKhoa, orgA, async (c) => {
        await c.query(
          "SELECT * FROM public.audit_append($1,'USER',NULL,'K166_GIU_KHOA','RFQ',NULL,'{}'::jsonb,NULL,NULL,NULL)",
          [orgA],
        );
        await choTha;
      });
      // Chờ tới khi khoá THẬT SỰ được cầm — không thì lần ghi sổ đi qua và test xanh mà không đo gì.
      const han = Date.now() + 5000;
      for (;;) {
        if ((await demKhoaGiuDuoc(orgA)) >= 1) break;
        if (Date.now() > han) throw new Error("het 5000ms ma khoa ghi so cua to chuc chua duoc cam");
        await new Promise<void>((xong) => setTimeout(xong, 20));
      }
      jobId = await withTenant(apiPool, orgA, (c) =>
        enqueueJob(c, orgA, { kind: UNSEAL_JOB_KIND, payload: { unsealRequestId: id }, dedupeKey: `unseal:${id}` }),
      );
      await tt.batDau();
      const het = Date.now() + 20_000;
      let dong: string | undefined;
      while (dong === undefined && Date.now() < het) {
        await new Promise((x) => setTimeout(x, 100));
        dong = log.find((d) => d.startsWith("[unseal-worker] outbox UNSEAL_RFQ "));
      }
      thaKhoa();
      await giuKhoa;
      expect(dong, JSON.stringify(log)).toBeDefined();

      // Lỗi CÙNG HÌNH DẠNG với lỗi worker vừa ném: lớp bọc của khoản 121, hai hằng đóng, `cause` là lỗi
      // Postgres mang `55P03`. Thông điệp cố ý mang giá trị để vế A2 dưới có thứ để bắt.
      const cungLoi = new DenialAuditFailedError(
        "UNSEAL_EXECUTION_DENIED",
        "UNSEAL_REQUEST",
        new Error(`tu choi mang ${id}`),
        Object.assign(new Error(`canceling statement due to lock timeout ${orgA}`), { name: "error", code: "55P03" }),
      );
      expect(moTaLoiCuaApi(cungLoi)).toBe("DenialAuditFailedError UNSEAL_EXECUTION_DENIED UNSEAL_REQUEST <- error 55P03");
      expect(dong, "worker phải mô tả lỗi ĐÚNG như api mô tả cùng lỗi ấy — kể cả tầng `cause`").toBe(
        `[unseal-worker] outbox UNSEAL_RFQ HANDLER_ERROR ${moTaLoiCuaApi(cungLoi)}`,
      );
      // A2: không id yêu cầu, không id tổ chức, không id job, không thông điệp của lỗi Postgres.
      for (const giaTri of [id, orgA, jobId, "lock timeout"]) expect(dong).not.toContain(giaTri);
      // Và `TenantError` — lớp mà bản rút gọn của worker không nhận theo lớp — đi qua cùng luật.
      expect(moTaLoiCuaApi(new TenantError("SESSION_STATE_LEFT", `thong diep mang ${orgA}`))).toBe("TenantError SESSION_STATE_LEFT");
      // Và bản của `api` LÀ bản dùng chung của identity mà `tien-trinh.ts` gọi — không phải hai hàm tình cờ cho cùng chuỗi.
      expect(moTaLoiCuaApi).toBe(moTaLoiKhongGiaTri);
      // Job về PENDING chờ lượt thử lại (maxAttempts mặc định 5) — đúng hệ quả đã ghi ở khoản 121.
      const { rows } = await db.pool.query<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM outbox_jobs WHERE id = $1",
        [jobId],
      );
      expect(rows[0]).toEqual({ status: "PENDING", attempts: 1 });
    } finally {
      thaKhoa();
      await giuKhoa?.catch(() => undefined);
      await tt.dung();
      console.error = cu;
      await poolGiuKhoa.end().catch(() => undefined);
    }
  }, 60_000);
});
