// ==============================================================================================
// [S1.9102 / ADR-9202] Công cụ khởi tạo tổ chức trên Postgres THẬT, dưới ĐÚNG vai `app_khoi_tao` (role đăng nhập
// `app_khoi_tao_login` như tools/chay-migrate dựng) — hàm `khoiTao` và dòng lệnh `pnpm khoi-tao`.
//
//   ⑴ tạo tổ chức: đúng hàng, đúng vai, email hạ chữ bằng hàm của CSDL, sổ bắt đầu ở seq 1 và kiểm chứng được, KHÔNG dữ
//      liệu cá nhân trong sổ; người dùng đầu tiên xin được link đăng nhập (đường `issueLoginToken` của `/auth/link`).
//   ⑵ thêm người: nối tiếp chuỗi sổ của tổ chức đã có.
//   ⑶ mọi lỗi rollback TRỌN — slug trùng, email trùng, tổ hợp vai trái luật, tổ chức không tồn tại — và thông điệp nêu vị
//      trí, không nêu email hay họ tên.
//   ⑷ dòng lệnh: stdout một dòng mang mã tổ chức; stdout/stderr không mang email hay họ tên; thoát 1 khi hỏng. **[lượt soi]**
//      Ba đường vào: lệnh `node` mà task sẽ chạy, script `pnpm khoi-tao` (`--silent`), và đường Secrets Manager — đường PROD —
//      trên một máy chủ Secrets Manager GIẢ trong tiến trình test (`AWS_ENDPOINT_URL_SECRETS_MANAGER`).
// ==============================================================================================
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAuditEvent, verifyAuditChain } from "@trustprocure/audit";
import { issueLoginToken } from "@trustprocure/identity";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { MA_VAI, docBanKhai } from "./ban-khai.js";
import { KhoiTaoError, khoiTao } from "./khoi-tao.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const GOC = fileURLToPath(new URL("../../../", import.meta.url));
const MAT_KHAU = "mk-khoi-tao-cong-cu";

let db: TestDatabase;
let pool: pg.Pool;
let urlKhoiTao: string;
let thuMuc: string;

const nguoi = (email: string, vai: string[], hoTen = "Nguyễn Văn Thử") => ({ email, hoTen, vai });
const banKhaiTao = (slug: string, ds: unknown[]) => JSON.stringify({ cheDo: "tao", toChuc: { ten: `Công ty ${slug}`, slug }, nguoi: ds });
const banKhaiThem = (orgId: string, ds: unknown[]) => JSON.stringify({ cheDo: "them-nguoi", toChuc: { id: orgId }, nguoi: ds });

/** Bảy người theo cỡ "đủ" của pilot giả lập (docs/DE-XUAT-TAO-TO-CHUC.md mục 2). */
const BAY_NGUOI = [
  nguoi("buyer@khach.vn", ["BUYER"]),
  nguoi("PM.Mot@Khach.vn", ["PROCUREMENT_MANAGER"]),
  nguoi("pm.hai@khach.vn", ["PROCUREMENT_MANAGER"]),
  nguoi("pm.ba@khach.vn", ["PROCUREMENT_MANAGER", "TECHNICAL"]),
  nguoi("gd.mot@khach.vn", ["DIRECTOR"]),
  nguoi("gd.hai@khach.vn", ["DIRECTOR"]),
  nguoi("ketoan@khach.vn", ["FINANCE"]),
];

async function dem(orgId: string): Promise<{ to_chuc: number; nguoi: number; vai: number; so: number }> {
  const { rows } = await db.pool.query<{ to_chuc: number; nguoi: number; vai: number; so: number }>(
    "SELECT (SELECT count(*)::int FROM organizations WHERE id = $1) AS to_chuc, (SELECT count(*)::int FROM users WHERE org_id = $1) AS nguoi, " +
      "(SELECT count(*)::int FROM user_roles WHERE org_id = $1) AS vai, (SELECT count(*)::int FROM audit_events WHERE org_id = $1) AS so",
    [orgId],
  );
  return rows[0]!;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  await db.pool.query(`CREATE ROLE app_khoi_tao_login LOGIN PASSWORD '${MAT_KHAU}' IN ROLE app_khoi_tao`);
  const u = new URL(db.connectionString);
  u.username = "app_khoi_tao_login";
  u.password = MAT_KHAU;
  urlKhoiTao = u.toString();
  pool = createPool(urlKhoiTao, 1, { role: "app_khoi_tao" });
  thuMuc = mkdtempSync(join(tmpdir(), "khoi-tao-"));
}, 240_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await db?.stop();
  if (thuMuc !== undefined) rmSync(thuMuc, { recursive: true, force: true });
});

describe("[S1.9102 / ADR-9202] ⑴ tạo tổ chức", () => {
  it("bảy người, tám vai, một giao dịch; email hạ chữ bằng hàm CSDL; sổ 1 + 7 + 8 hàng, kiểm chứng được, không dữ liệu cá nhân", async () => {
    const kq = await khoiTao(pool, docBanKhai(banKhaiTao("thep-viet", BAY_NGUOI), "tao"));
    expect(kq).toMatchObject({ cheDo: "tao", soNguoi: 7, soVai: 8 });
    expect(await dem(kq.orgId)).toEqual({ to_chuc: 1, nguoi: 7, vai: 8, so: 1 + 7 + 8 });
    const { rows: org } = await db.pool.query<{ name: string; slug: string }>("SELECT name, slug FROM organizations WHERE id = $1", [kq.orgId]);
    expect(org).toEqual([{ name: "Công ty thep-viet", slug: "thep-viet" }]);
    const { rows: u } = await db.pool.query<{ email: string; status: string }>("SELECT email, status FROM users WHERE org_id = $1 ORDER BY email", [kq.orgId]);
    expect(u.map((r) => r.email)).toContain("pm.mot@khach.vn");
    expect(new Set(u.map((r) => r.status))).toEqual(new Set(["ACTIVE"]));
    const { rows: so } = await db.pool.query<{ seq: string; action: string; actor_type: string; actor_id: string | null; payload: unknown }>(
      "SELECT seq::text, action, actor_type, actor_id, payload FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [kq.orgId],
    );
    expect(so[0]).toEqual({ seq: "1", action: "ORG_CREATED", actor_type: "SYSTEM", actor_id: null, payload: { slug: "thep-viet", nguon: "tp-khoi-tao" } });
    expect(so.filter((r) => r.action === "USER_CREATED")).toHaveLength(7);
    expect(so.filter((r) => r.action === "ROLE_GRANTED").map((r) => (r.payload as { roleCode: string }).roleCode).sort()).toEqual(
      ["BUYER", "DIRECTOR", "DIRECTOR", "FINANCE", "PROCUREMENT_MANAGER", "PROCUREMENT_MANAGER", "PROCUREMENT_MANAGER", "TECHNICAL"],
    );
    expect(new Set(so.map((r) => r.actor_type))).toEqual(new Set(["SYSTEM"]));
    // [lượt soi] Cùng `resourceType` với các đường khác của kho (`USER` ở mfa-reset và route người mua): lịch sử sổ của một
    // người không bị tách làm hai loại tài nguyên.
    const { rows: loai } = await db.pool.query<{ action: string; resource_type: string }>(
      "SELECT DISTINCT action, resource_type FROM audit_events WHERE org_id = $1 ORDER BY 1",
      [kq.orgId],
    );
    expect(loai).toEqual([
      { action: "ORG_CREATED", resource_type: "ORGANIZATION" },
      { action: "ROLE_GRANTED", resource_type: "USER" },
      { action: "USER_CREATED", resource_type: "USER" },
    ]);
    // [lượt soi] `resource_id` của từng hàng sổ do CÔNG CỤ ghi: tổ chức cho ORG_CREATED, đúng người cho USER_CREATED, và cặp
    // (người, vai) của ROLE_GRANTED trùng khít `user_roles` — không có nó, sổ không còn kể ai nhận vai nào.
    const { rows: tai } = await db.pool.query<{ action: string; resource_id: string | null; vai: string | null }>(
      "SELECT action, resource_id, payload ->> 'roleCode' AS vai FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [kq.orgId],
    );
    const { rows: nd } = await db.pool.query<{ id: string }>("SELECT id FROM users WHERE org_id = $1 ORDER BY id", [kq.orgId]);
    const { rows: ur } = await db.pool.query<{ cap: string }>("SELECT user_id || ':' || role_code AS cap FROM user_roles WHERE org_id = $1 ORDER BY 1", [kq.orgId]);
    expect(tai.filter((r) => r.action === "ORG_CREATED").map((r) => r.resource_id)).toEqual([kq.orgId]);
    expect(tai.filter((r) => r.action === "USER_CREATED").map((r) => r.resource_id).sort()).toEqual(nd.map((r) => r.id));
    expect(tai.filter((r) => r.action === "ROLE_GRANTED").map((r) => `${String(r.resource_id)}:${String(r.vai)}`).sort()).toEqual(ur.map((r) => r.cap));
    const toanSo = JSON.stringify(so);
    expect(toanSo, "sổ chỉ-ghi-thêm không mang email").not.toMatch(/khach\.vn/iu);
    expect(toanSo, "sổ chỉ-ghi-thêm không mang họ tên").not.toContain("Nguyễn");
    const kiem = await withTenant(db.poolAs("app_api"), kq.orgId, (c) => verifyAuditChain(c, kq.orgId, { externalAnchors: [] }));
    expect(kiem.checked).toBe(16);
    expect(kiem.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
    // Người dùng đầu tiên xin được link đăng nhập bằng email viết hoa — đường của `POST /auth/link` (ADR-107), tra bằng hàm CSDL.
    const t = await withTenant(db.poolAs("app_api"), kq.orgId, (c) => issueLoginToken(c, kq.orgId, { email: "PM.Mot@KHACH.vn" }));
    expect(t.ok).toBe(true);
  });

  it("danh mục vai của công cụ khớp bảng `roles` thật", async () => {
    const { rows } = await db.pool.query<{ code: string }>("SELECT code FROM roles ORDER BY code");
    expect(rows.map((r) => r.code)).toEqual([...MA_VAI].sort());
  });

  it("[lượt soi] email mang một điểm mã mà JS và CSDL hạ KHÁC nhau: cất bằng hàm CSDL, người ấy xin được link bằng đúng chuỗi đã khai", async () => {
    const email = "\u24B6.Test@Khach-Unicode.vn"; // Ⓐ — CIRCLED LATIN CAPITAL LETTER A
    const { rows: ha } = await db.pool.query<{ pg: string }>("SELECT pg_catalog.lower($1::text) AS pg", [email]);
    // Tiền đề của phép đo: nếu hai hàm hạ GIỐNG nhau trên máy chủ này thì ca này không đo gì — nói ra, không xanh giả.
    expect(ha[0]!.pg, "tiền đề: pg_catalog.lower() và toLowerCase() phải lệch nhau trên điểm mã này").not.toBe(email.toLowerCase());
    const kq = await khoiTao(pool, docBanKhai(banKhaiTao("unicode-email", [nguoi(email, ["BUYER"])]), "tao"));
    const { rows } = await db.pool.query<{ email: string }>("SELECT email FROM users WHERE org_id = $1", [kq.orgId]);
    expect(rows).toEqual([{ email: ha[0]!.pg }]);
    const t = await withTenant(db.poolAs("app_api"), kq.orgId, (c) => issueLoginToken(c, kq.orgId, { email }));
    expect(t.ok, "người ấy xin được link đăng nhập bằng email như đã khai").toBe(true);
  });
});

describe("[S1.9102 / ADR-9202] ⑵ thêm người", () => {
  it("thêm vào tổ chức ĐÃ CÓ sổ: chuỗi nối tiếp, không đụng người cũ", async () => {
    const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Co san', 'co-san') RETURNING id")).rows[0]!.id;
    await withTenant(db.poolAs("app_api"), org, (c) => appendAuditEvent(c, org, { actorType: "USER", action: "E0", resourceType: "TEST" }));
    const kq = await khoiTao(pool, docBanKhai(banKhaiThem(org, [nguoi("moi@co-san.vn", ["FINANCE"]), nguoi("moi2@co-san.vn", ["TECHNICAL", "REQUESTER"])]), "them-nguoi"));
    expect(kq).toEqual({ cheDo: "them-nguoi", orgId: org, soNguoi: 2, soVai: 3 });
    const { rows } = await db.pool.query<{ seq: string; action: string }>("SELECT seq::text, action FROM audit_events WHERE org_id = $1 ORDER BY seq", [org]);
    expect(rows.map((r) => `${r.seq}:${r.action}`)).toEqual(["1:E0", "2:USER_CREATED", "3:ROLE_GRANTED", "4:USER_CREATED", "5:ROLE_GRANTED", "6:ROLE_GRANTED"]);
    const kiem = await withTenant(db.poolAs("app_api"), org, (c) => verifyAuditChain(c, org, { externalAnchors: [] }));
    expect(kiem.checked).toBe(6);
  });
});

describe("[S1.9102 / ADR-9202] ⑶ mọi lỗi rollback TRỌN, thông điệp nêu vị trí không nêu giá trị", () => {
  it.each([
    ["tổ hợp vai D3 ở người thứ 2", [nguoi("a@d3.vn", ["BUYER"]), nguoi("bimat.d3@d3.vn", ["PROCUREMENT_MANAGER", "DIRECTOR"], "Tên Bí Mật D3")], /người thứ 2: bị từ chối \(mã 42501/u],
    ["tổ hợp vai 033", [nguoi("bimat.033@d3.vn", ["FINANCE", "BUYER"], "Tên Bí Mật 033")], /người thứ 1: bị từ chối \(mã 42501/u],
    ["email trùng khác hoa thường trong CÙNG bản khai", [nguoi("bimat.trung@d3.vn", ["BUYER"]), nguoi("Bimat.Trung@D3.vn", ["BUYER"])], /người thứ 2: trùng email với người thứ 1/u],
  ])("%s ⇒ KhoiTaoError/BanKhaiError, không hàng nào của tổ chức mới nằm lại", async (ten, ds, mau) => {
    const slug = `rollback-${String(ten.length)}-${String(JSON.stringify(ds).length)}`;
    let loi: unknown;
    try {
      await khoiTao(pool, docBanKhai(banKhaiTao(slug, ds), "tao"));
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(Error);
    expect((loi as Error).message).toMatch(mau);
    expect((loi as Error).message).not.toMatch(/bimat/iu);
    expect((loi as Error).message).not.toContain("Tên Bí Mật");
    // [lượt soi] 42501 cũng là "permission denied": nguyên nhân phải là CHÍNH trigger (thông điệp không đi ra ngoài, chỉ đo ở đây).
    const nguyenNhan = (loi as { cause?: { message?: string } }).cause?.message ?? "";
    if (ten === "tổ hợp vai D3 ở người thứ 2") expect(nguyenNhan).toMatch(/Phân tách nhiệm vụ \(D3\)/u);
    if (ten === "tổ hợp vai 033") expect(nguyenNhan).toMatch(/\(D2, 033\)/u);
    const { rows } = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM organizations WHERE slug = $1", [slug]);
    expect(rows[0]!.n).toBe(0);
  });

  it("slug đã có ⇒ 'slug đã có tổ chức dùng', không người nào được tạo", async () => {
    await khoiTao(pool, docBanKhai(banKhaiTao("slug-trung", [nguoi("x@slug.vn", ["BUYER"])]), "tao"));
    const truoc = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
    await expect(khoiTao(pool, docBanKhai(banKhaiTao("slug-trung", [nguoi("y@slug.vn", ["BUYER"])]), "tao"))).rejects.toThrow(
      /tổ chức: slug đã có tổ chức dùng/u,
    );
    const sau = await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
    expect(sau.rows[0]!.n).toBe(truoc.rows[0]!.n);
  });

  it("thêm người: email đã có trong tổ chức ⇒ lỗi ở đúng người, người trước đó cũng không nằm lại; tổ chức không tồn tại ⇒ nói thẳng", async () => {
    const kq = await khoiTao(pool, docBanKhai(banKhaiTao("co-nguoi", [nguoi("da.co@co-nguoi.vn", ["BUYER"])]), "tao"));
    const truoc = await dem(kq.orgId);
    await expect(
      khoiTao(pool, docBanKhai(banKhaiThem(kq.orgId, [nguoi("moi@co-nguoi.vn", ["TECHNICAL"]), nguoi("Da.Co@co-nguoi.vn", ["TECHNICAL"])]), "them-nguoi")),
    ).rejects.toThrow(/người thứ 2: email đã có trong tổ chức/u);
    expect(await dem(kq.orgId), "rollback trọn: người thứ nhất không nằm lại").toEqual(truoc);
    const khongCo = "0f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const loi = await khoiTao(pool, docBanKhai(banKhaiThem(khongCo, [nguoi("a@x.vn", ["BUYER"])]), "them-nguoi")).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(KhoiTaoError);
    expect((loi as Error).message).toMatch(/người thứ 1: tổ chức không tồn tại/u);
  });
});

describe("[S1.9102 / lượt soi] lỗi của lần GHI SỔ cũng nêu vị trí và mã", () => {
  it("khoá chuỗi sổ của tổ chức bị giữ quá trần ⇒ KhoiTaoError 'lỗi tạm (mã 55P03 …)', rollback trọn, chạy lại được", async () => {
    const kq = await khoiTao(pool, docBanKhai(banKhaiTao("giu-khoa-so", [nguoi("dau@giu-khoa.vn", ["BUYER"])]), "tao"));
    const truoc = await dem(kq.orgId);
    const giu = await db.pool.connect();
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [kq.orgId]);
      const loi = await khoiTao(pool, docBanKhai(banKhaiThem(kq.orgId, [nguoi("bimat.cho@giu-khoa.vn", ["TECHNICAL"], "Tên Bí Mật Chờ")]), "them-nguoi")).catch(
        (e: unknown) => e,
      );
      expect(loi).toBeInstanceOf(KhoiTaoError);
      expect((loi as Error).message).toMatch(/^người thứ 1: lỗi tạm \(mã 55P03/u);
      expect((loi as Error).message).not.toMatch(/bimat|Tên Bí Mật/u);
    } finally {
      await giu.query("ROLLBACK");
      giu.release();
    }
    expect(await dem(kq.orgId), "rollback trọn").toEqual(truoc);
    await khoiTao(pool, docBanKhai(banKhaiThem(kq.orgId, [nguoi("bimat.cho@giu-khoa.vn", ["TECHNICAL"])]), "them-nguoi"));
    expect((await dem(kq.orgId)).nguoi).toBe(truoc.nguoi + 1);
  }, 30_000);
});

describe("[S1.9102 / ADR-9202] ⑷ dòng lệnh — lệnh `node` của task, script `pnpm khoi-tao`, đường Secrets Manager", () => {
  const chayLenh = (args: string[], env: Record<string, string>) =>
    spawnSync(
      process.execPath,
      ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./tools/khoi-tao-to-chuc/register-ts-resolve.mjs", "tools/khoi-tao-to-chuc/src/index.ts", ...args],
      { cwd: GOC, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", ...env }, timeout: 60_000 },
    );
  /** Cùng lệnh, KHÔNG chặn vòng sự kiện — cho ca mà chính tiến trình test phải trả lời lời gọi của công cụ (máy chủ SM giả). */
  const chayLenhBatDongBo = (args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((xong, hong) => {
      const p = spawn(
        process.execPath,
        ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./tools/khoi-tao-to-chuc/register-ts-resolve.mjs", "tools/khoi-tao-to-chuc/src/index.ts", ...args],
        { cwd: GOC, env: { PATH: process.env["PATH"] ?? "", ...env } },
      );
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
      p.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
      const hen = setTimeout(() => { p.kill(); }, 60_000);
      p.on("error", hong);
      p.on("close", (status) => { clearTimeout(hen); xong({ status, stdout, stderr }); });
    });

  it("thành công: một dòng mang mã tổ chức, không email, không họ tên; thoát 0", async () => {
    const tep = join(thuMuc, "tao.json");
    writeFileSync(tep, banKhaiTao("qua-dong-lenh", [nguoi("rieng.tu@dong-lenh.vn", ["BUYER"], "Họ Tên Riêng Tư")]));
    const r = chayLenh(["tao", "--ban-khai-tep", tep], { DATABASE_URL: urlKhoiTao });
    expect(r.status, r.stderr).toBe(0);
    const m = /^\[khoi-tao\] tao: to chuc ([0-9a-f-]{36}), 1 nguoi, 1 vai\n$/u.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    expect(await dem(m![1]!)).toEqual({ to_chuc: 1, nguoi: 1, vai: 1, so: 3 });
    for (const dau of [r.stdout, r.stderr]) {
      expect(dau).not.toContain("rieng.tu");
      expect(dau).not.toContain("Họ Tên Riêng Tư");
    }
  });

  it("[lượt soi] script `pnpm khoi-tao` chạy được — cùng đầu ra (`--silent` bỏ hai dòng tiêu đề của pnpm)", async () => {
    // Mọi ca khác spawn `node …` như task; ca này đi qua script của package.json — khoản nợ 23 ra đời đúng từ khoảng chênh ấy.
    const tep = join(thuMuc, "qua-pnpm.json");
    writeFileSync(tep, banKhaiTao("qua-pnpm", [nguoi("qua.pnpm@dong-lenh.vn", ["BUYER"])]));
    const r = spawnSync("pnpm", ["--silent", "khoi-tao", "tao", "--ban-khai-tep", tep], {
      cwd: GOC, encoding: "utf8", env: { ...process.env, DATABASE_URL: urlKhoiTao }, timeout: 120_000, shell: true,
    });
    expect(r.status, r.stderr).toBe(0);
    const m = /^\[khoi-tao\] tao: to chuc ([0-9a-f-]{36}), 1 nguoi, 1 vai\n$/u.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    expect(await dem(m![1]!)).toEqual({ to_chuc: 1, nguoi: 1, vai: 1, so: 3 });
  }, 120_000);

  it("[lượt soi] đường Secrets Manager trên máy chủ GIẢ: hỏi ĐÚNG tên dưới tiền tố, một lần; dòng kết quả mang VersionId đã đọc; lỗi của SM chỉ in TÊN lỗi", async () => {
    const hoi: { target: string; than: Record<string, unknown> }[] = [];
    const PHIEN_BAN = "0f1e2d3c-4b5a-4968-8776-655443322110";
    let traLoi: (ten: string) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
    const sv = createServer((req, res) => {
      let than = "";
      req.on("data", (c: Buffer) => { than += c.toString("utf8"); });
      req.on("end", () => {
        const o = JSON.parse(than === "" ? "{}" : than) as Record<string, unknown>;
        hoi.push({ target: String(req.headers["x-amz-target"]), than: o });
        const r = traLoi(String(o["SecretId"]));
        res.statusCode = r.status;
        res.setHeader("content-type", "application/x-amz-json-1.1");
        res.end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>((xong) => { sv.listen(0, "127.0.0.1", xong); });
    const env = {
      DATABASE_URL: urlKhoiTao,
      TRUSTPROCURE_KHOI_TAO_REGION: "ap-southeast-1",
      AWS_ENDPOINT_URL_SECRETS_MANAGER: `http://127.0.0.1:${String((sv.address() as AddressInfo).port)}`,
      AWS_ACCESS_KEY_ID: "kiem-thu",
      AWS_SECRET_ACCESS_KEY: "kiem-thu",
      AWS_EC2_METADATA_DISABLED: "true",
    };
    try {
      traLoi = (ten) => ({
        status: 200,
        body: { ARN: `arn:aws:secretsmanager:ap-southeast-1:000000000000:secret:${ten}-AbCdEf`, Name: ten, VersionId: PHIEN_BAN,
          SecretString: banKhaiTao("qua-sm", [nguoi("qua.sm@dong-lenh.vn", ["BUYER"], "Họ Tên Qua SM")]) },
      });
      const r = await chayLenhBatDongBo(["tao", "--ban-khai-secret", "tp/khoi-tao/ban-khai/qua-sm"], env);
      expect(r.status, r.stderr).toBe(0);
      expect(hoi).toEqual([{ target: "secretsmanager.GetSecretValue", than: { SecretId: "tp/khoi-tao/ban-khai/qua-sm" } }]);
      const m = new RegExp(`^\\[khoi-tao\\] tao: to chuc ([0-9a-f-]{36}), 1 nguoi, 1 vai, ban khai phien ban ${PHIEN_BAN}\\n$`, "u").exec(r.stdout);
      expect(m, r.stdout).not.toBeNull();
      expect(await dem(m![1]!)).toEqual({ to_chuc: 1, nguoi: 1, vai: 1, so: 3 });
      for (const dau of [r.stdout, r.stderr]) {
        expect(dau).not.toContain("qua.sm");
        expect(dau).not.toContain("Họ Tên Qua SM");
      }

      // SM từ chối ⇒ thoát 1, stderr nêu TÊN lỗi của SDK — không ARN, không thông điệp của SM.
      hoi.length = 0;
      traLoi = () => ({ status: 400, body: { __type: "ResourceNotFoundException", message: "khong thay arn:aws:secretsmanager:bi-mat-la" } });
      const hong = await chayLenhBatDongBo(["tao", "--ban-khai-secret", "tp/khoi-tao/ban-khai/khong-co"], env);
      expect(hong.status).toBe(1);
      expect(hong.stderr).toMatch(/^\[khoi-tao\] HONG: không đọc được bí mật bản khai \(ResourceNotFoundException\)\n$/u);
      expect(hong.stderr).not.toContain("arn:");
      expect(hoi.map((h) => h.than["SecretId"])).toEqual(["tp/khoi-tao/ban-khai/khong-co"]);
    } finally {
      await new Promise<void>((xong) => { sv.close(() => { xong(); }); });
    }
  }, 120_000);

  it("hỏng: thoát 1, stderr một dòng nêu vị trí; không email, không họ tên, không thông điệp gốc của Postgres", () => {
    const tep = join(thuMuc, "hong.json");
    writeFileSync(tep, banKhaiTao("hong-dong-lenh", [nguoi("rieng.tu2@dong-lenh.vn", ["PROCUREMENT_MANAGER", "DIRECTOR"], "Họ Tên Riêng Tư Hai")]));
    const r = chayLenh(["tao", "--ban-khai-tep", tep], { DATABASE_URL: urlKhoiTao });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^\[khoi-tao\] HONG: người thứ 1: bị từ chối \(mã 42501/u);
    expect(r.stderr).not.toContain("rieng.tu2");
    expect(r.stderr).not.toContain("Họ Tên Riêng Tư Hai");
    expect(r.stderr).not.toMatch(/Phân tách nhiệm vụ|D3\):/u);
    // [lượt soi] Lỗi pg KHÔNG có tên (ở đây: sai mật khẩu, 28P01) ⇒ in tên lỗi kèm SQLSTATE — không thông điệp gốc, không URL.
    const saiMk = new URL(urlKhoiTao);
    saiMk.password = "sai-mat-khau-hoan-toan";
    const hong = chayLenh(["tao", "--ban-khai-tep", tep], { DATABASE_URL: saiMk.toString() });
    expect(hong.status).toBe(1);
    expect(hong.stderr).toMatch(/^\[khoi-tao\] HONG: error \(ma 28P01\)\n$/u);
    expect(hong.stderr).not.toContain("sai-mat-khau");
    // Thiếu DATABASE_URL, lệnh sai, bản khai lệch lệnh ⇒ thoát 1, nêu đúng lý do.
    expect(chayLenh(["tao", "--ban-khai-tep", tep], {}).stderr).toMatch(/thiếu biến môi trường DATABASE_URL/u);
    expect(chayLenh(["xoa", "--ban-khai-tep", tep], { DATABASE_URL: urlKhoiTao }).stderr).toMatch(/lệnh phải là/u);
    expect(chayLenh(["them-nguoi", "--ban-khai-tep", tep], { DATABASE_URL: urlKhoiTao }).stderr).toMatch(/nhưng lệnh là "them-nguoi"/u);
  });
});
