// ==============================================================================================
// [S1.66 / lượt soi ngang 59b-2] BỘ DỌN NỀN MƯỢN CLIENT PHẢI NGHE 'error' — HỒI QUY CỦA S1.59
//
// S1.59 (khoản 99) chuyển `donBucketNguoiGoiCu` từ một `pool.query` tự commit sang `pool.connect()` + giao dịch tường minh để
// gác COMMIT dưới replica. `pool.query` gắn `client.once('error')` suốt câu lệnh; một client MƯỢN qua `pool.connect()` thì không
// có listener nào (pg-pool gỡ listener rảnh khi giao client ra), và `pg` phát sự kiện 'error' trên client khi kết nối đứt ngoài
// ý muốn. Không ai nghe ⇒ Node ném ⇒ tiến trình `api` chết cùng mọi tổ chức đang được phục vụ — đúng lỗ [fix I1] mà
// `withTenant` và `migrate()` tự đóng. `donOtpRateLimitsCu` mang cùng hình dạng từ trước S1.59.
//
// Đo trên PostgreSQL 16 (bản nháp của lượt soi 59, trước bản vá): tiến trình con chạy bộ dọn trên `createPool(…, 1, { role:
// "app_api" })`, câu DELETE bị một trigger làm chậm, superuser `pg_terminate_backend` backend ấy ⇒ tiến trình con thoát mã 1 với
// "Unhandled 'error' event … Connection terminated unexpectedly"; đối chứng `pool.query` cùng câu ⇒ tiến trình sống, lỗi 57P01
// đi ra qua promise. Người ngắt ngoài đời: người vận hành huỷ một câu dọn chậm (số hàng của `caller_rate_limits` do người gọi
// vô danh chọn), hay một lần chuyển dự phòng rơi vào đúng lúc bộ dọn đang mượn kết nối.
// ==============================================================================================
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const XUONG = String.fromCharCode(10);

// Hook ESM tự chứa: specifier ".js" không thấy thì thử ".ts" — cùng quy tắc với `ts-resolve-hook.mjs` của tiến trình dev, CHÉP
// chứ không trỏ sang `apps/` hay `tools/`: một phép đo của gói không được dựa vào tệp của một ứng dụng.
const HOOK = [
  "export async function resolve(specifier, context, nextResolve) {",
  "  try {",
  "    return await nextResolve(specifier, context);",
  "  } catch (error) {",
  '    if (specifier.endsWith(".js") && error && error.code === "ERR_MODULE_NOT_FOUND") {',
  '      return nextResolve(specifier.slice(0, -3) + ".ts", context);',
  "    }",
  "    throw error;",
  "  }",
  "}",
].join(XUONG);
const DANG_KY = ['import { register } from "node:module";', 'register("./hook.mjs", import.meta.url);'].join(XUONG);
const KICH_BAN = [
  'import { pathToFileURL } from "node:url";',
  "const GOC = process.env.GOC_KHO;",
  'const { createPool } = await import(pathToFileURL(GOC + "/packages/db/src/index.ts").href);',
  'const inv = await import(pathToFileURL(GOC + "/packages/invitation/src/invitation.ts").href);',
  'const pool = createPool(process.env.URL_CSDL, 1, { role: "app_api" });',
  'console.log("bat-dau");',
  "try {",
  '  const n = process.env.BO_DON === "otp" ? await inv.donOtpRateLimitsCu(pool) : await inv.donBucketNguoiGoiCu(pool);',
  '  console.log("xong", n);',
  "} catch (e) {",
  '  console.log("loi-di-ra", e && e.code);',
  "}",
  "await new Promise((r) => setTimeout(r, 1000));",
  'console.log("song");',
  "await pool.end().catch(() => {});",
  "process.exit(0);",
].join(XUONG);

let db: TestDatabase;
let thuMuc: string;
let orgId: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgId = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty 59b2', 'cong-ty-59b2') RETURNING id")).rows[0]!.id;
  // Trigger làm chậm câu DELETE của bộ dọn đủ lâu để một superuser kịp ngắt đúng backend đang chạy nó.
  await db.pool.query("CREATE FUNCTION public.zz_cham_59() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN PERFORM pg_catalog.pg_sleep(10); RETURN OLD; END$f$");
  await db.pool.query("CREATE TRIGGER zz_cham_59 BEFORE DELETE ON public.caller_rate_limits FOR EACH ROW EXECUTE FUNCTION public.zz_cham_59()");
  await db.pool.query("CREATE TRIGGER zz_cham_59 BEFORE DELETE ON public.otp_rate_limits FOR EACH ROW EXECUTE FUNCTION public.zz_cham_59()");
  thuMuc = await mkdtemp(join(tmpdir(), "tp-bo-don-59-"));
  await writeFile(join(thuMuc, "hook.mjs"), HOOK);
  await writeFile(join(thuMuc, "dang-ky.mjs"), DANG_KY);
  await writeFile(join(thuMuc, "con.mjs"), KICH_BAN);
}, 180000);

afterAll(async () => {
  if (thuMuc !== undefined) await rm(thuMuc, { recursive: true, force: true });
  await db?.stop();
});

/** Chạy một bộ dọn trong tiến trình con, ngắt backend của câu DELETE giữa chừng, trả về cách tiến trình kết thúc. */
async function ngatGiuaCauDon(boDon: "bucket" | "otp"): Promise<{ daNgat: boolean; ma: number | null; stdout: string; stderr: string }> {
  const bang = boDon === "otp" ? "otp_rate_limits" : "caller_rate_limits";
  await db.pool.query(`ALTER TABLE public.${bang} DISABLE TRIGGER zz_cham_59`);
  await db.pool.query(`DELETE FROM public.${bang}`);
  await db.pool.query(`ALTER TABLE public.${bang} ENABLE TRIGGER zz_cham_59`);
  if (boDon === "otp") {
    await db.pool.query(
      "INSERT INTO public.otp_rate_limits (org_id, bucket_kind, bucket_hash, window_start, hits) VALUES ($1, 'CALLER', $2, now() - interval '1 day', 1)",
      [orgId, Buffer.alloc(32, 7)],
    );
  } else {
    await db.pool.query("INSERT INTO public.caller_rate_limits (bucket_hash, window_start, hits) VALUES ($1, now() - interval '1 day', 1)", [Buffer.alloc(32, 8)]);
  }
  const con = spawn(process.execPath, ["--experimental-transform-types", "--import", pathToFileURL(join(thuMuc, "dang-ky.mjs")).href, join(thuMuc, "con.mjs")], {
    cwd: GOC_KHO,
    env: { ...process.env, GOC_KHO, URL_CSDL: db.connectionString, BO_DON: boDon },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  con.stdout.on("data", (d: Buffer) => {
    stdout += d.toString("utf8");
  });
  con.stderr.on("data", (d: Buffer) => {
    stderr += d.toString("utf8");
  });
  const thoat = new Promise<number | null>((xong) => con.once("exit", (ma) => xong(ma)));
  let daNgat = false;
  const hetHan = Date.now() + 60_000;
  while (!daNgat && Date.now() < hetHan) {
    const { rows } = await db.pool.query<{ pid: number }>(
      "SELECT pid FROM pg_catalog.pg_stat_activity WHERE state = 'active' AND query LIKE $1 AND pid <> pg_catalog.pg_backend_pid()",
      [`DELETE FROM public.${bang}%`],
    );
    if (rows.length > 0) {
      await db.pool.query("SELECT pg_catalog.pg_terminate_backend($1)", [rows[0]!.pid]);
      daNgat = true;
    } else {
      await new Promise((xong) => setTimeout(xong, 50));
    }
  }
  const ma = await thoat;
  return { daNgat, ma, stdout, stderr };
}

describe("[S1.66 / lượt soi ngang 59b-2] bộ dọn nền: backend bị ngắt giữa câu DELETE thì tiến trình vẫn sống, lỗi đi ra qua promise", () => {
  for (const boDon of ["bucket", "otp"] as const) {
    it(`${boDon === "bucket" ? "donBucketNguoiGoiCu" : "donOtpRateLimitsCu"}: không "Unhandled 'error' event", tiến trình con thoát 0 sau khi nhận lỗi`, async () => {
      const kq = await ngatGiuaCauDon(boDon);
      expect(kq.daNgat, "phép đo không ngắt được backend nào — kịch bản rỗng ruột").toBe(true);
      expect(kq.stderr).not.toContain("Unhandled 'error' event");
      expect(kq.stdout).toContain("loi-di-ra");
      expect(kq.stdout).toContain("song");
      expect(kq.ma).toBe(0);
    }, 120000);
  }
});
