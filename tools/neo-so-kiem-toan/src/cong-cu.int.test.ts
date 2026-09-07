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
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

// ==============================================================================================
// [ADR-026 §5⑶ / S1.19] CÔNG THỨC KIỂM BẰNG `openssl(1)` — THỨ CHƯA AI TRONG KHO NÀY CHẠY
//
// Lượt review thứ chín (H9-9) bắt được một câu rộng hơn phép đo: *"kiểm toán viên kiểm được
// artefact này mà không cần một dòng mã nào của chúng ta"*. Thứ ĐÃ đo khi ấy là chữ ký kiểm được
// bằng `createVerify` của `node:crypto`. Thứ CHƯA đo là **ba thao tác ở giữa**:
//
//   ⑴ tách `text` ra khỏi dòng JSONL — chuỗi trong tệp mang `\n` ở dạng escape;
//   ⑵ `base64 -d` cho `sig` để lấy lại đúng chuỗi byte DER;
//   ⑶ đổi SPKI DER sang PEM.
//
// Ba thao tác ấy là toàn bộ khoảng cách giữa *"định dạng OpenSSL kiểm được"* và *"kiểm toán viên
// cầm tệp JSONL và kiểm được"*. Câu bị hạ ở bốn chỗ tại S1.17; khối này là thứ mua nó lại.
//
// ----------------------------------------------------------------------------------------------
// CÁI KHỐI NÀY KHÔNG CHỨNG MINH, nói ngay để không ai đọc rộng hơn
// ----------------------------------------------------------------------------------------------
// Nó **KHÔNG** chứng minh chữ ký được kiểm bởi một cài đặt mật mã ĐỘC LẬP. `node:crypto` gọi
// OpenSSL bên dưới, nên `createVerify` và `openssl dgst` chia nhau phần lớn cùng một khối mã.
// Thứ mới ở đây là **CÔNG THỨC**: một chuỗi thao tác của con người, chạy trên đúng những tệp mà
// một kiểm toán viên sẽ có trong tay, bằng một chương trình KHÁC tiến trình đã tạo ra chúng.
//
// FAIL-CLOSED, KHÔNG SKIP: nếu `openssl` không có trên máy chạy test, khối này ĐỎ. Một phép đo
// bị bỏ qua trong im lặng là đúng thứ đã sinh ra khoản nợ 23.
// ==============================================================================================
describe("công thức kiểm mốc neo bằng openssl(1) — ADR-026 §5⑶", () => {
  let orgSsl: string;
  let raSsl: string;

  function openssl(...thamSo: string[]): { ma: number; ra: string; loi: string } {
    const kq = spawnSync("openssl", thamSo, { encoding: "utf8" });
    return { ma: kq.status ?? -1, ra: kq.stdout ?? "", loi: kq.stderr ?? "" };
  }

  beforeAll(async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
      ["neo-cli-openssl"],
    );
    orgSsl = rows[0]!.id;
    const apiPool = db.poolAs("app_api");
    await withTenant(apiPool, orgSsl, async (client) => {
      for (let i = 0; i < 4; i += 1) {
        await appendAuditEvent(client, orgSsl, {
          actorType: "USER",
          action: `SSL${i}`,
          resourceType: "TEST",
        });
      }
    });
    raSsl = join(thuMuc, "ra-openssl");
  }, 60_000);

  it("[INV-B3] trich xuất ba tệp và `openssl dgst -sha256 -verify` nói Verified OK", async () => {
    // Fail-closed: thiếu openssl thì ĐỎ, không skip. Xem khối đầu.
    expect(
      openssl("version").ma,
      "không chạy được `openssl version` — phép đo này KHÔNG được bỏ qua trong im lặng, vì nó là " +
        "vế duy nhất chứng minh CÔNG THỨC tách artefact ra khỏi nơi cất chạy được",
    ).toBe(0);

    expect(chay("xuat", "--org", orgSsl).ma).toBe(0);

    const trich = chay("trich", "--org", orgSsl, "--ra", raSsl);
    expect(trich.loi, "bộ trích không được ném").not.toMatch(/Error/);
    expect(trich.ma).toBe(0);

    const vanBan = join(raSsl, `neo-${orgSsl}-seq4.txt`);
    const chuKy = join(raSsl, `neo-${orgSsl}-seq4.sig`);
    const khoa = join(raSsl, "khoa-neo-cli.pem");
    for (const p of [vanBan, chuKy, khoa]) {
      expect((await stat(p)).isFile(), `${p} phải tồn tại`).toBe(true);
    }

    // Ba tính chất của artefact mà công thức đứng trên, khẳng định riêng để một lượt đỏ nói được
    // NÓ hỏng ở đâu thay vì chỉ nói "openssl từ chối".
    const txt = await readFile(vanBan, "utf8");
    expect(txt.endsWith("\n"), "văn bản chính tắc kết thúc bằng đúng một \\n").toBe(true);
    expect(txt, "không được có CR — một lần dịch xuống dòng là một chữ ký hỏng").not.toContain("\r");
    expect((await readFile(khoa, "utf8")).startsWith("-----BEGIN PUBLIC KEY-----\n")).toBe(true);

    // CÔNG THỨC. Đúng dòng lệnh mà `trich` in ra cho người vận hành.
    const kq = openssl("dgst", "-sha256", "-verify", khoa, "-signature", chuKy, vanBan);
    expect(`${kq.ra}${kq.loi}`, "openssl phải nói Verified OK").toContain("Verified OK");
    expect(kq.ma).toBe(0);

    // Và dòng lệnh ấy phải được IN RA, không để người vận hành tự đoán.
    expect(trich.ra).toContain("openssl dgst -sha256 -verify");
  }, 120_000);

  it("[INV-B3] ba đối chứng ÂM: sửa văn bản, sửa chữ ký, sai khoá ⇒ openssl TỪ CHỐI", async () => {
    const vanBan = join(raSsl, `neo-${orgSsl}-seq4.txt`);
    const chuKy = join(raSsl, `neo-${orgSsl}-seq4.sig`);
    const khoa = join(raSsl, "khoa-neo-cli.pem");

    // Không có ba vế này, vế dương ở trên chỉ chứng minh openssl chạy được — không chứng minh nó
    // đang PHÁN XÉT gì. Cùng khuôn ba đối chứng âm của `receipt.test.ts`.
    const goc = await readFile(vanBan);
    const sua = join(raSsl, "sua-van-ban.txt");
    // Đổi đúng MỘT ký tự của trường `chain_hash`, giữ nguyên độ dài và hình dạng: một bản ghi
    // vẫn hợp lệ về cú pháp nhưng đã KHÁC thứ được ký.
    await writeFile(sua, goc.toString("utf8").replace(/chain_hash=(.)/, (_, c: string) => `chain_hash=${c === "a" ? "b" : "a"}`));
    const caA = openssl("dgst", "-sha256", "-verify", khoa, "-signature", chuKy, sua);
    expect(caA.ma, "văn bản bị sửa mà openssl vẫn nhận ⇒ phép đo này rỗng ruột").not.toBe(0);
    expect(`${caA.ra}${caA.loi}`).toContain("Verification failure");

    const sigGoc = await readFile(chuKy);
    const sigHong = Buffer.from(sigGoc);
    sigHong.writeUInt8(sigHong.readUInt8(sigHong.length - 1) ^ 0xff, sigHong.length - 1);
    const sigSua = join(raSsl, "sua-chu-ky.sig");
    await writeFile(sigSua, sigHong);
    const caB = openssl("dgst", "-sha256", "-verify", khoa, "-signature", sigSua, vanBan);
    expect(caB.ma, "chữ ký bị sửa mà openssl vẫn nhận ⇒ phép đo này rỗng ruột").not.toBe(0);

    const { publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const khoaLa = join(raSsl, "khoa-la.pem");
    const b64 = Buffer.from(publicKey).toString("base64");
    await writeFile(
      khoaLa,
      `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`,
    );
    const caC = openssl("dgst", "-sha256", "-verify", khoaLa, "-signature", chuKy, vanBan);
    expect(caC.ma, "khoá LẠ mà openssl vẫn nhận ⇒ phép đo này rỗng ruột").not.toBe(0);
  }, 120_000);

  it("[INV-B3] trich KHÔNG cần DATABASE_URL — tách artefact là một thao tác NGOẠI TUYẾN", () => {
    // Tính chất này không phải một sự tiện tay. Một kiểm toán viên cầm tệp JSONL và vòng khoá
    // công khai phải dựng lại được ba tệp ấy MÀ KHÔNG có quyền vào cơ sở dữ liệu — nếu khâu tách
    // đòi `DATABASE_URL` thì thứ gọi là "artefact độc lập" vẫn phải đi qua hệ thống bị kiểm.
    const cu = bienMoiTruong["DATABASE_URL"]!;
    bienMoiTruong["DATABASE_URL"] = "";
    try {
      const kq = chay("trich", "--org", orgSsl, "--ra", join(thuMuc, "ra-khong-db"));
      expect(kq.loi, "trich không được đòi DATABASE_URL").not.toContain("DATABASE_URL");
      expect(kq.ma).toBe(0);
    } finally {
      bienMoiTruong["DATABASE_URL"] = cu;
    }
  }, 60_000);

  it("[INV-B3] trich KHÔNG tách artefact ra khỏi một nơi cất đang hỏng", async () => {
    // Quyết định ⑴ của khối `trich`. Một artefact tách ra từ một nơi cất có bản ghi không kiểm
    // được là một artefact TRÔNG SẠCH HƠN nơi nó đến — và nó sẽ đi vào tay kiểm toán viên đúng
    // như thế, vì `openssl` chỉ phán xét ba tệp trước mặt nó, không biết gì về tệp JSONL.
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
      ["neo-cli-kho-hong"],
    );
    const orgHong = rows[0]!.id;
    const apiPool = db.poolAs("app_api");
    await withTenant(apiPool, orgHong, (client) =>
      appendAuditEvent(client, orgHong, { actorType: "USER", action: "E", resourceType: "TEST" }),
    );
    expect(chay("xuat", "--org", orgHong).ma).toBe(0);

    // Bản ghi hỏng đứng SAU một bản ghi tốt: nếu `trich` chỉ kiểm bản ghi nó sắp tách thì nó vẫn
    // xanh, và vế fail-closed trở thành trang trí.
    await writeFile(join(thuMuc, `${orgHong}.jsonl`), '{"text":"khong ky","sig":"AA"}\n', {
      flag: "a",
    });

    const kq = chay("trich", "--org", orgHong, "--ra", join(thuMuc, "ra-kho-hong"));
    expect(kq.ma).toBe(1);
    expect(kq.loi).toContain("không kiểm được");
  }, 60_000);

  it("trich từ chối một --seq không có trong nơi cất, thay vì im lặng lấy mốc gần nhất", () => {
    const kq = chay("trich", "--org", orgSsl, "--ra", join(thuMuc, "ra-seq-la"), "--seq", "999");
    expect(kq.ma).toBe(1);
    expect(kq.loi).toContain("999");
  }, 60_000);
});
