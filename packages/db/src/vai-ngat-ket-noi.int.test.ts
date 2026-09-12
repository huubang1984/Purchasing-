// ==============================================================================================
// [S1.66 / lượt soi 60a-3] BỘ BỌC VAI GIỮ CLIENT HAI VÒNG ĐI-VỀ TRƯỚC KHI GIAO — PHẢI NGHE 'error' TRONG LÚC ẤY
//
// `ganVaiTroChoPool` lấy client bằng `pool.connect` gốc rồi chạy `SET ROLE …; DISCARD TEMP` và một câu kiểm trước khi giao client
// cho người gọi. pg-pool gỡ listener rảnh khi giao client ra, người gọi (`withTenant`, hai bộ dọn, vòng khởi động) chỉ gắn listener
// của mình SAU khi lần lấy xong, và `pg` phát 'error' trên client khi kết nối kết thúc ngoài ý muốn — kể cả lúc không câu nào đang
// chạy. Không ai nghe trong hai vòng đi-về ấy thì tiến trình chết, ở MỌI lần lấy client của pool có vai. Người soi 60a đọc ra; test
// này đo nó: tiến trình con làm chậm câu SET ROLE ở phía client, tiến trình cha ngắt đúng backend ấy trong lúc chờ.
// ==============================================================================================
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { migrate } from "./migrate.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const XUONG = String.fromCharCode(10);

// Hook ESM tự chứa — cùng khuôn `packages/invitation/src/bo-don-ngat-ket-noi.int.test.ts`.
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
  'const pool = createPool(process.env.URL_CSDL, 1, { role: "app_api" });',
  // Làm chậm câu SET ROLE của bộ bọc ở PHÍA CLIENT: câu chưa gửi, kết nối rảnh ở máy chủ — đúng cửa sổ không câu nào đang chạy.
  'pool.on("connect", (client) => {',
  "  const goc = client.query.bind(client);",
  "  client.query = (...a) => {",
  '    if (typeof a[0] === "string" && a[0].startsWith("SET ROLE")) {',
  '      console.log("pid " + client.processID);',
  "      return new Promise((r) => setTimeout(r, 4000)).then(() => goc(...a));",
  "    }",
  "    return goc(...a);",
  "  };",
  "});",
  'console.log("bat-dau");',
  "try {",
  "  const c = await pool.connect();",
  '  console.log("lay-duoc");',
  "  c.release();",
  "} catch (e) {",
  '  console.log("loi-di-ra", e && (e.code || e.name));',
  "}",
  "await new Promise((r) => setTimeout(r, 1000));",
  'console.log("song");',
  "await pool.end().catch(() => {});",
  "process.exit(0);",
].join(XUONG);

let db: TestDatabase;
let thuMuc: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  thuMuc = await mkdtemp(join(tmpdir(), "tp-vai-ngat-60-"));
  await writeFile(join(thuMuc, "hook.mjs"), HOOK);
  await writeFile(join(thuMuc, "dang-ky.mjs"), DANG_KY);
  await writeFile(join(thuMuc, "con.mjs"), KICH_BAN);
}, 180000);

afterAll(async () => {
  if (thuMuc !== undefined) await rm(thuMuc, { recursive: true, force: true });
  await db?.stop();
});

describe("[S1.66 / lượt soi 60a-3] bộ bọc vai: backend bị ngắt trong lúc SET ROLE của lần lấy client thì tiến trình vẫn sống, lỗi đi ra qua promise", () => {
  it("createPool(…, { role }) — không \"Unhandled 'error' event\", tiến trình con thoát 0 sau khi lần lấy client ném", async () => {
    const con = spawn(process.execPath, ["--experimental-transform-types", "--import", pathToFileURL(join(thuMuc, "dang-ky.mjs")).href, join(thuMuc, "con.mjs")], {
      cwd: GOC_KHO,
      env: { ...process.env, GOC_KHO, URL_CSDL: db.connectionString },
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
      const m = /pid (\d+)/u.exec(stdout);
      if (m !== null) {
        await db.pool.query("SELECT pg_catalog.pg_terminate_backend($1)", [Number(m[1])]);
        daNgat = true;
      } else {
        await new Promise((xong) => setTimeout(xong, 50));
      }
    }
    const ma = await thoat;
    expect(daNgat, "phép đo không ngắt được backend nào — kịch bản rỗng ruột").toBe(true);
    expect(stderr).not.toContain("Unhandled 'error' event");
    expect(stdout).toContain("loi-di-ra");
    expect(stdout).not.toContain("lay-duoc");
    expect(stdout).toContain("song");
    expect(ma).toBe(0);
  }, 120000);
});
