// ==============================================================================================
// [S1.86 / khoản 128] NGƯỜI GIỮ KHOÁ GHI SỔ CỦA TỔ CHỨC — AI GIỮ ĐƯỢC, VÀ GIỮ ĐƯỢC BAO LÂU.
//
// `noi_chuoi_kiem_toan()` nối chuỗi sổ kiểm toán dưới `pg_advisory_xact_lock(hashtextextended(
// <tổ chức>, 0))`, và `050` cho người CHỜ một trần 2 s. Trần ấy bảo vệ người CHỜ; nó không đuổi
// người GIỮ. Khoản 128 hỏi: có cận thời gian nào cho người giữ không?
//
// ĐO TRÊN HEAD TRƯỚC MỤC HARDENING CỦA VÒNG NÀY (§S1.86), Postgres thật, vai `app_api`:
//
//     GUC pool app_api: idle_session_timeout=0 iits=1min statement_timeout=15s lock_timeout=15s
//     sau khi lay khoa MUC PHIEN:             granted=1  state=idle
//     lan ghi so trong khi bi giu:            55P03 o 2 005 ms
//     sau 3 s dung yen (iits ep xuong 500ms): state=idle  granted=1      <- GUC KHONG voi toi
//     lan ghi so sau 3 s:                     55P03 o 2 004 ms
//     ham khoa tu van: 21 ham, app_api goi duoc 21
//
// Hai vế, và chúng KHÁC NHAU về bản chất:
//   ⒜ MỘT PHIÊN CỐ Ý giữ khoá mức PHIÊN. Phiên ấy không ở trong giao dịch, nên
//      `idle_in_transaction_session_timeout` không bao giờ chạm tới nó, và pool không đặt
//      `idle_session_timeout` (đo: giá trị là `0`). Vế này ĐÓNG được bằng quyền — mục hardening
//      "quyền gọi hàm khoá tư vấn MỨC PHIÊN của vai ứng dụng" của vòng này.
//   ⒝ MỘT GIAO DỊCH HỢP LỆ đã ghi sổ rồi còn làm việc tiếp. Nó giữ khoá suốt đời nó, và KHÔNG
//      `REVOKE` nào chạm tới: `noi_chuoi_kiem_toan()` là SECURITY **INVOKER** (đo: `prosecdef =
//      false`, chủ `postgres`), nên vai ứng dụng BUỘC phải giữ `pg_advisory_xact_lock`. Chủ dự án
//      chọn NHẬN VÀ GHI RA ngày 2026-09-19 (ADR-042) — khoản 178. Vế ⓶ dưới đây là PHÉP ĐO của
//      ranh giới ấy, không phải test hồi quy của một bản vá.
// ==============================================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TU_CHOI_KHOA_MIGRATE, createPool, migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/** Bốn tên hàm LẤY khoá tư vấn mức PHIÊN — khớp nguyên văn danh sách của mục hardening. */
const TEN_HAM_LAY_KHOA_PHIEN = ["pg_advisory_lock", "pg_advisory_lock_shared", "pg_try_advisory_lock", "pg_try_advisory_lock_shared"];

let db: TestDatabase;
let orgA: string;

/** Lần ghi sổ của một tổ chức, KHÔNG qua `packages/tenancy` — `packages/db` và `packages/tenancy` không phụ thuộc nhau. */
async function ghiSo(pool: pg.Pool, org: string, action: string): Promise<{ ok: boolean; code: string; ms: number }> {
  const c = await pool.connect();
  const batDau = Date.now();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
    await c.query("SELECT * FROM public.audit_append($1,'USER',NULL,$2,'RFQ',NULL,'{}'::jsonb,NULL,NULL,NULL)", [org, action]);
    await c.query("COMMIT");
    return { ok: true, code: "", ms: Date.now() - batDau };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    const ma = (e as { code?: unknown }).code;
    return { ok: false, code: typeof ma === "string" ? ma : (e as Error).name, ms: Date.now() - batDau };
  } finally {
    c.release();
  }
}

async function trangThaiPhien(pid: number): Promise<string> {
  const { rows } = await db.pool.query<{ state: string }>(
    "SELECT a.state::text AS state FROM pg_catalog.pg_stat_activity a WHERE a.pid = $1",
    [pid],
  );
  return rows[0]?.state ?? "(khong con phien)";
}

async function demKhoaGhiSo(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted " +
      "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [org],
  );
  return rows[0]?.n ?? -1;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA =
    (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]
      ?.id ?? "";
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[INV-D5] [S1.86 / khoản 128] cận thời gian của người GIỮ khoá ghi sổ", { timeout: 180_000 }, () => {
  it("⓵ vai ứng dụng KHÔNG lấy được khoá tư vấn mức PHIÊN — `42501`, và đường ghi sổ hợp lệ vẫn đi qua", async () => {
    const poolApi = createPool(db.connectionString, 2, { role: "app_api" });
    try {
      const c = await poolApi.connect();
      let ma = "(khong nem)";
      try {
        await c.query("SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1::text, 0))", [orgA]);
      } catch (e) {
        ma = String((e as { code?: unknown }).code);
      } finally {
        c.release(new Error("huy client do"));
      }
      expect(ma, "trước mục hardening của vòng này: lấy được, rồi giữ vô thời hạn (§S1.86)").toBe("42501");

      // ĐỐI CHỨNG DƯƠNG, và nó là vế làm phép đo trên có nghĩa: một lần thu hồi QUÁ TAY — chạm
      // vào `*_xact_lock*` — làm vế này ĐỎ. Đường ghi sổ hợp lệ không nằm trong danh sách thu hồi.
      const l = await ghiSo(poolApi, orgA, "K128_HOP_LE");
      expect(l.ok, `đường ghi sổ hợp lệ KHÔNG được hỏng — nhận ${l.code}`).toBe(true);
    } finally {
      await poolApi.end().catch(() => undefined);
    }
  });

  it("⓶ vai ứng dụng CÒN giữ `*_xact_lock` — ranh giới của mục hardening, không phải một thiếu sót (khoản 178)", async () => {
    const poolGiu = createPool(db.connectionString, 1, { role: "app_api" });
    const poolGhi = createPool(db.connectionString, 2, { role: "app_api" });
    const giu = await poolGiu.connect();
    giu.on("error", () => undefined);
    try {
      const pid = (await giu.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0]!.pid;
      // Ngưỡng 1 s, quãng nghỉ 300 ms: nếu ngưỡng đếm TỔNG thời gian trong giao dịch thì nó đã nổ
      // nhiều lần. Nó đếm quãng idle LIÊN TỤC, nên giao dịch còn phát câu không bao giờ bị đuổi.
      await giu.query("SET idle_in_transaction_session_timeout = '1s'");
      await giu.query("BEGIN");
      await giu.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgA]);

      // NGƯỜI GIỮ VÀ NẠN NHÂN CHẠY CÙNG LÚC, và điều đó là load-bearing: bản đầu của vế này cho
      // người giữ nghỉ trong lúc nạn nhân chờ, nên chính `iits=1s` đuổi người giữ và lần ghi sổ ĐI
      // QUA ở 1 028 ms — một phép đo XANH nói ngược lại điều nó định nói. Người giữ phải BẬN suốt.
      let dungVongLap = false;
      const vongLap = (async () => {
        for (let i = 0; i < 40 && !dungVongLap; i += 1) {
          await new Promise<void>((x) => setTimeout(x, 300));
          await giu.query("SELECT 1");
        }
      })();
      const l = await ghiSo(poolGhi, orgA, "K128_DO_XACT");
      const st = await trangThaiPhien(pid);
      const gr = await demKhoaGhiSo(orgA);
      dungVongLap = true;
      await vongLap;

      expect({ st, gr }, "giao dịch còn phát câu không bao giờ đứng yên đủ lâu để bị đuổi").toEqual({
        st: "idle in transaction",
        gr: 1,
      });
      expect(l.code, "nạn nhân gãy 55P03 ở trần 2 s trong khi người giữ vẫn sống — khoản 178").toBe("55P03");
      await giu.query("ROLLBACK");
    } finally {
      giu.release(new Error("huy client do"));
      await poolGiu.end().catch(() => undefined);
      await poolGhi.end().catch(() => undefined);
    }
  });

  it("⓷ MỌI vai ứng dụng mất EXECUTE trên MỌI dạng đối số của bốn hàm lấy khoá mức phiên", async () => {
    const { rows } = await db.pool.query<{ mo_ta: string }>(
      "SELECT r.rolname || ' -> ' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS mo_ta " +
        "FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_proc p " +
        "JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
        "WHERE n.nspname = 'pg_catalog' AND p.proname = ANY($1::text[]) AND NOT r.rolsuper " +
        "  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles g WHERE g.rolname IN ('app_api','app_unseal') " +
        "                AND (pg_catalog.pg_has_role(r.oid, g.oid, 'USAGE') OR pg_catalog.pg_has_role(r.oid, g.oid, 'SET'))) " +
        "  AND pg_catalog.has_function_privilege(r.rolname, p.oid, 'EXECUTE') ORDER BY mo_ta",
      [TEN_HAM_LAY_KHOA_PHIEN],
    );
    expect(
      rows.map((x) => x.mo_ta),
      "một dạng đối số lọt lưới là một đường vòng nguyên vẹn — `pg_advisory_lock(integer, integer)` lấy CÙNG khoá",
    ).toEqual([]);

    // ĐỐI CHỨNG CHỐNG RỖNG RUỘT: phép đọc phải THẤY được các hàm ấy và thấy vai ứng dụng có thật.
    const { rows: co } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
        "WHERE n.nspname = 'pg_catalog' AND p.proname = ANY($1::text[])",
      [TEN_HAM_LAY_KHOA_PHIEN],
    );
    expect(co[0]?.n, "bốn tên × hai dạng đối số").toBe(8);
    const { rows: vai } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_catalog.pg_roles WHERE rolname IN ('app_api','app_unseal')",
    );
    expect(vai[0]?.n).toBe(2);
  });

  it("⓸ vai ĐANG chạy `migrate()` GIỮ LẠI `pg_advisory_lock(bigint)` — thiếu nó là chặn chính lần triển khai", () => {
    // `migrate()` lấy khoá ấy ở câu ĐẦU TIÊN, TRƯỚC khi `hardening.always.sql` chạy. Vế này đọc
    // NGUỒN của `migrate.ts` thay vì chép lại tên hàm: đổi cơ chế khoá của migrate mà quên mục
    // hardening thì vế này đỏ, chứ không phải lần triển khai kế tiếp mới đỏ.
    const nguon = readFileSync(fileURLToPath(new URL("../packages/db/src/migrate.ts", import.meta.url)), "utf8");
    const dung = new Set([...nguon.matchAll(/pg_catalog\.(pg_[a-z_]*advisory[a-z_]*)\(/gu)].map((m) => m[1] ?? ""));
    expect(dung, "migrate() dùng khoá MỨC PHIÊN — đổi cơ chế ấy thì mục hardening phải đổi theo").toEqual(
      new Set(["pg_advisory_lock", "pg_advisory_unlock"]),
    );

    // CÂU `GRANT` KHÔNG KIỂM ĐƯỢC BẮNG HÀNH VI Ở ĐÂY, và nói ra rẻ hơn giả vờ kiểm: cụm test
    // chạy `migrate()` dưới `postgres`, mà `postgres` là CHỦ của chính hàm `pg_advisory_lock`.
    // Nên `has_function_privilege` luôn true (superuser đi qua mọi phép kiểm), và `proacl` cũng luôn
    // mang một dòng cho `postgres` — dòng MẬC ĐỊNH của chủ hàm, có hay không câu `GRANT` cũng thế.
    // Đã ĐO: gỡ hẳn câu `GRANT` khỏi mục hardening thì cả hai phiên bản của vế này đều XANH (đột
    // biến M4, §S1.86). CÙNG LỚP LỖI với ADR-040 (*hàm SECURITY DEFINER TRẢ XANH trên CI mà 0
    // hàng ở cụm thật, vì migrate chạy superuser*). Nên vế này đọc NGUỒN của mục hardening — yếu
    // hơn một phép đo hành vi, nhưng nó là thứ DUY NHẤT giết được M4, và vế ⓹ dưới đo phần
    // còn lại (một vai NOSUPERUSER không có quyền, và một câu GRANT là đủ).
    const hardening = readFileSync(fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url)), "utf8");
    expect(
      hardening.includes("GRANT EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(bigint) TO %I', CURRENT_USER"),
      "mục hardening phải cấp lại `pg_advisory_lock(bigint)` cho vai ĐANG chạy migrate — thiếu câu ấy là chặn lần triển khai kế tiếp",
    ).toBe(true);
  });

  it("⓹ CÁI GIÁ VẬN HÀNH, đo chứ không khải: một vai NOSUPERUSER mới KHÔNG có `pg_advisory_lock(bigint)`, tức gãy ở câu ĐẦU TIÊN của `migrate()`", async () => {
    // Câu `GRANT ... TO CURRENT_USER` của mục hardening cấp cho vai ĐANG chạy migrate. Một vai
    // deploy KHÁC — hay một CSDL chưa từng áp mục này — không có nó, và `migrate()` lấy khoá ấy
    // TRƯỚC khi `hardening.always.sql` kịp chạy. Cùng khuôn hồ sơ N3 (*"superuser một lần ⇒ đi qua"*).
    // Đây là cái giá chủ dự án chọn trả ngày 2026-09-19 (ADR-042), và nó được ĐO chứ không được hứa.
    await db.pool.query("CREATE ROLE tp_deploy_thu NOSUPERUSER");
    try {
      const doc = async (): Promise<boolean> =>
        (
          await db.pool.query<{ co: boolean }>(
            "SELECT pg_catalog.has_function_privilege('tp_deploy_thu', 'pg_catalog.pg_advisory_lock(bigint)', 'EXECUTE') AS co",
          )
        ).rows[0]?.co ?? false;
      expect(await doc(), "vai deploy MỚI không tự có quyền — cần đúng một câu GRANT của superuser").toBe(false);
      await db.pool.query("GRANT EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(bigint) TO tp_deploy_thu");
      expect(await doc(), "và một câu GRANT là đủ — lối ra có thật, không phải một ngõ cụt").toBe(true);
    } finally {
      await db.pool.query("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(bigint) FROM tp_deploy_thu").catch(() => undefined);
      await db.pool.query("DROP ROLE IF EXISTS tp_deploy_thu").catch(() => undefined);
    }
  });

  it("⓺ LỐI RA PHẢI TỰ NÓI RA: một vai deploy chưa được cấp quyền chạy `migrate()` nhận đúng câu `GRANT` cần chạy, không phải `permission denied` trần trụi", async () => {
    // Câu `pg_advisory_lock` là câu ĐẦU TIÊN của `migrate()` chạm quyền, và nó chạy TRƯỚC
    // `hardening.always.sql` — nên ô *"quyền cần"* của hardening KHÔNG BAO GIỜ tới được người đọc ở
    // ca này. Đo (§S1.86): thiếu bẫy 42501 trong `migrate.ts`, thông điệp là `permission denied for
    // function pg_advisory_lock` — đúng nhưng không nói phải làm gì, và đó là dòng mà 17 hồ sơ deploy
    // của `db/migrations.int.test.ts` đã đỏ khi vòng này cài mục hardening.
    await db.pool.query("CREATE ROLE tp_deploy_128 LOGIN PASSWORD 'thu-128'");
    try {
      const url = new URL(db.connectionString);
      url.username = "tp_deploy_128";
      url.password = "thu-128";
      const poolDeploy = createPool(url.toString(), 1);
      try {
        const loi = await migrate(poolDeploy, MIGRATIONS_DIR).then(
          () => null,
          (e: unknown) => e as Error,
        );
        expect(loi, "vai deploy chưa được cấp phải KHÔNG chạy được migrate").not.toBeNull();
        expect(loi?.message, `nhận: ${String(loi?.message).slice(0, 200)}`).toBe(TU_CHOI_KHOA_MIGRATE);
        // Và nguyên nhân gốc vẫn tới được người điều tra qua `cause` — không nuốt.
        expect((loi?.cause as { code?: unknown } | undefined)?.code).toBe("42501");
        expect(loi?.message, "thông điệp phải nêu NGUYÊN VĂN câu lệnh cần chạy").toContain(
          "GRANT EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(bigint) TO",
        );
      } finally {
        await poolDeploy.end().catch(() => undefined);
      }
    } finally {
      await db.pool.query("DROP ROLE IF EXISTS tp_deploy_128").catch(() => undefined);
    }
  });
});
