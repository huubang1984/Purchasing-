// ==============================================================================================
// ENTRY POINT PHẢI ĐƯỢC CHẠY THẬT — BÀI HỌC CỦA KHOẢN NỢ 23, KHÔNG PHẢI MỘT PHÉP THỬ CHO ĐỦ
//
// `tools/do-webcrypto/phuc-vu-va-dot-bien.mjs` nằm trong kho nhiều tuần, được nhắc tên trong ba
// tài liệu, và khi ai đó cầm lên thì nó ném `ENOENT` ở dòng đầu — nó đọc một tên tệp không còn
// tồn tại. Không test nào bắt được, vì không test nào CHẠY nó.
//
// Nên file này không import hàm nào của công cụ. Nó `spawn` đúng dòng lệnh mà một người vận hành
// sẽ gõ, với đúng bộ biến môi trường mà tài liệu nêu, và đọc mã thoát cùng stdout. Thứ được đo là
// TIẾN TRÌNH, không phải một hàm.
// ==============================================================================================

import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { withTenant } from "@trustprocure/tenancy";
import { appendAuditEvent } from "@trustprocure/audit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS = join(GOC, "db", "migrations");
// `--import` nhận một URL hoặc một specifier tương đối, KHÔNG nhận một đường dẫn Windows tuyệt
// đối: `D:\...` bị đọc thành một URL với scheme "d:" và Node ném ERR_UNSUPPORTED_ESM_URL_SCHEME.
// Đo được ngay lượt chạy đầu của file này — đúng thứ mà một entry point không ai chạy sẽ giấu.
const DANG_KY = pathToFileURL(
  join(GOC, "tools", "neo-so-kiem-toan", "register-ts-resolve.mjs"),
).href;
const KICH_BAN = join(GOC, "tools", "neo-so-kiem-toan", "src", "index.ts");

let db: TestDatabase;
let thuMuc: string;
let org: string;
let bienMoiTruong: Record<string, string>;

function chay(...thamSo: string[]): { ma: number; ra: string; loi: string } {
  const kq = spawnSync(
    execPath,
    ["--experimental-transform-types", "--import", DANG_KY, KICH_BAN, ...thamSo],
    { env: { ...process.env, ...bienMoiTruong }, encoding: "utf8", cwd: GOC },
  );
  return { ma: kq.status ?? -1, ra: kq.stdout ?? "", loi: kq.stderr ?? "" };
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  thuMuc = await mkdtemp(join(tmpdir(), "tp-neo-cli-"));

  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  bienMoiTruong = {
    DATABASE_URL: db.connectionString,
    TRUSTPROCURE_NEO_KHO: thuMuc,
    TRUSTPROCURE_NEO_KID: "neo-cli",
    TRUSTPROCURE_NEO_KHOA_RIENG: Buffer.from(privateKey).toString("base64"),
    TRUSTPROCURE_NEO_KHOA_CONG_KHAI: `neo-cli=${Buffer.from(publicKey).toString("base64")}`,
    // Công cụ đi qua `assertLocalDevAllowed`; một tiến trình phải KHAI adapter nó dùng.
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    NODE_ENV: "test",
  };

  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
    ["neo-cli"],
  );
  org = rows[0]!.id;

  const apiPool = db.poolAs("app_api");
  await withTenant(apiPool, org, async (client) => {
    for (let i = 0; i < 3; i += 1) {
      await appendAuditEvent(client, org, {
        actorType: "USER",
        action: `E${i}`,
        resourceType: "TEST",
      });
    }
  });
}, 180_000);

afterAll(async () => {
  await db?.stop();
  if (thuMuc !== undefined) await rm(thuMuc, { recursive: true, force: true });
});

describe("công cụ neo sổ kiểm toán — tiến trình thật", () => {
  it("[INV-B3] xuat rồi kiem: mã thoát 0, và kết luận kiểm toán XANH", () => {
    const xuat = chay("xuat", "--org", org);
    // KHÔNG khẳng định stderr RỖNG: `--experimental-transform-types` in một ExperimentalWarning
    // ra stderr ở mọi lượt chạy. Khẳng định đúng thứ cần khẳng định — không có lỗi nào.
    expect(xuat.loi, "bộ xuất không được ném").not.toMatch(/Error/);
    expect(xuat.ma).toBe(0);
    expect(xuat.ra).toContain("seq=3");

    const kiem = chay("kiem", "--org", org);
    expect(kiem.ma).toBe(0);
    expect(kiem.ra).toContain("ok=true");
    expect(kiem.ra).toContain("checked=3");
    expect(kiem.ra).toContain("neo=1");
  });

  it("[INV-B3] chưa xuất lần nào thì kiem KHÔNG xanh — nó là NOT_ANCHORED, không phải im lặng", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
      ["neo-cli-chua-neo"],
    );
    const orgKhac = rows[0]!.id;
    const apiPool = db.poolAs("app_api");
    await withTenant(apiPool, orgKhac, (client) =>
      appendAuditEvent(client, orgKhac, {
        actorType: "USER",
        action: "E",
        resourceType: "TEST",
      }),
    );

    const kiem = chay("kiem", "--org", orgKhac);
    expect(kiem.ma).toBe(1);
    expect(kiem.ra).toContain("ok=false");
    expect(kiem.ra).toContain("NOT_ANCHORED");
  });

  it("thiếu một biến môi trường bắt buộc thì thoát mã 1, không thoát 0 trong im lặng", () => {
    const cu = bienMoiTruong["TRUSTPROCURE_NEO_KHO"]!;
    bienMoiTruong["TRUSTPROCURE_NEO_KHO"] = "";
    try {
      const kq = chay("kiem", "--org", org);
      expect(kq.ma).toBe(1);
      expect(kq.loi).toContain("TRUSTPROCURE_NEO_KHO");
    } finally {
      bienMoiTruong["TRUSTPROCURE_NEO_KHO"] = cu;
    }
  });

  it("lệnh lạ in cách dùng và thoát mã 2", () => {
    const kq = chay("khong-co-lenh-nay");
    expect(kq.ma).toBe(2);
    // [review lượt 9 — H9-8] Bảng cách dùng phải in một lệnh CHẠY ĐƯỢC. Bản đầu in
    // `neo-so-kiem-toan xuat ...` — không `bin`, không script workspace, tức đúng lớp lỗi của
    // khoản nợ 23. Nay nó in `pnpm neo`, và `package.json` gốc có script ấy.
    expect(kq.loi).toContain("pnpm neo xuat");
  });

  it("[INV-B3] xuat TỪ CHỐI một mốc neo LÙI — cắt đuôi chết ồn ào ở thời điểm xuất", async () => {
    // ==========================================================================================
    // [review lượt 9 — H9-1 ⑵] `audit_events.seq` chỉ đi lên, nên một đầu chuỗi THẤP HƠN mốc neo
    // đã có nghĩa là cái sổ NGẮN ĐI. Với nơi cất chỉ-ghi-thêm còn nguyên, mốc cũ vẫn tố cáo vụ
    // cắt ở lần kiểm — nhưng nếu nơi cất vừa bị xoá thì mốc cũ không còn, và chính lượt ghi này
    // là thứ RỬA vụ cắt thành một gốc tin cậy mới. Bộ xuất ở đúng vị trí để nói ra điều đó vào
    // đúng lúc nó xảy ra.
    //
    // MỐC CHẾT: gỡ khối `if (dau.seq < cao)` trong `xuat` thì test này ĐỎ.
    // ==========================================================================================
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
      ["neo-cli-lui"],
    );
    const orgLui = rows[0]!.id;
    const apiPool = db.poolAs("app_api");
    await withTenant(apiPool, orgLui, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, orgLui, {
          actorType: "USER",
          action: `E${i}`,
          resourceType: "TEST",
        });
      }
    });

    expect(chay("xuat", "--org", orgLui).ma).toBe(0);

    // Kẻ tấn công cắt đuôi cái sổ. Trigger chặn DELETE nên phải tạm gỡ — đúng mô hình "tác nhân
    // đã vượt qua lớp trigger" mà `chain.int.test.ts` dùng.
    await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete");
    try {
      await db.pool.query("DELETE FROM audit_events WHERE org_id = $1 AND seq > 2", [orgLui]);
    } finally {
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_delete");
    }

    const lui = chay("xuat", "--org", orgLui);
    expect(lui.ma).toBe(1);
    expect(lui.loi).toContain("TU CHOI NEO");
    expect(lui.loi).toContain("seq=2");
    expect(lui.loi).toContain("seq=5");
  });

  it("[review lượt 9 — H9-7] một tổ chức hỏng KHÔNG làm mất trạng thái của tổ chức còn lại", async () => {
    // Bản đầu để `loadVerifiedAnchors` ném xuyên qua vòng lặp, nên một bản ghi hỏng ở tổ chức
    // đầu tiên biến một lượt kiểm 50 tổ chức thành một dòng lỗi duy nhất — và nếu ai đó "vá"
    // bằng cách bỏ tổ chức ấy ra khỏi danh sách thì tổ chức bị tấn công là tổ chức duy nhất
    // không được kiểm.
    const hong = "00000000-0000-4000-8000-000000000000";
    await writeFile(join(thuMuc, `${hong}.jsonl`), "{ khong phai json\n", { flag: "a" });

    const kq = chay("kiem", "--org", hong, "--org", org);
    expect(kq.ma).toBe(1);
    expect(kq.ra).toContain("KHONG KIEM DUOC");
    // Vế chịu lực: tổ chức thứ hai VẪN được kiểm và trạng thái của nó vẫn in ra.
    expect(kq.ra).toContain(`${org}\tok=true`);
  });

  it("[review lượt 9 — H9-1 ⑴] khoi-tao là thao tác TƯỜNG MINH, và xuat không tự dựng nơi cất", async () => {
    const chuaCo = join(thuMuc, "chua-ton-tai");
    const cu = bienMoiTruong["TRUSTPROCURE_NEO_KHO"]!;
    bienMoiTruong["TRUSTPROCURE_NEO_KHO"] = chuaCo;
    try {
      const truoc = chay("xuat", "--org", org);
      expect(truoc.ma).toBe(1);
      expect(truoc.loi).toContain("KHONG XUAT DUOC");
      expect(truoc.loi).toContain("tiền đề triển khai");

      const khoi = chay("khoi-tao");
      expect(khoi.ma).toBe(0);
      expect((await stat(chuaCo)).isDirectory()).toBe(true);

      expect(chay("xuat", "--org", org).ma).toBe(0);
    } finally {
      bienMoiTruong["TRUSTPROCURE_NEO_KHO"] = cu;
    }
  });
});
