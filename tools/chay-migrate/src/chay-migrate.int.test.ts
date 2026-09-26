// [ADR-066] Task migrate: sau migrate(), hai vai đăng nhập tồn tại — [ADR-072 phần 1] ba, thêm app_neo_login của job neo — ĐĂNG NHẬP ĐƯỢC bằng mật khẩu lấy
// từ URL, thuộc đúng nhóm, không mạnh hơn nhóm — và chạy lại thì ĐẶT LẠI mật khẩu (xoay secret).
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { ChayMigrateError, damBaoVaiDangNhap, docCauHinh, docVaiTuUrl } from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const mk = (): string => randomBytes(24).toString("base64url");

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

async function dangNhap(ten: string, matKhau: string): Promise<{ ok: boolean; nhom: string[] }> {
  const u = new URL(db.connectionString);
  u.username = ten;
  u.password = matKhau;
  const c = new pg.Client({ connectionString: u.toString() });
  try {
    await c.connect();
  } catch {
    return { ok: false, nhom: [] };
  }
  try {
    const { rows } = await c.query<{ rolname: string }>(
      "SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = current_user",
    );
    return { ok: true, nhom: rows.map((r) => r.rolname) };
  } finally {
    await c.end();
  }
}

describe("[ADR-066] chay-migrate — vai đăng nhập của api và worker", () => {
  it("tạo vai, đăng nhập được, thuộc đúng nhóm, không thuộc tính mạnh; chạy lại ⇒ mật khẩu mới có hiệu lực, cũ thôi", async () => {
    const c = await db.pool.connect();
    try {
      const mk1 = mk();
      expect(await damBaoVaiDangNhap(c, { ten: "app_api_login", nhom: "app_api", matKhau: mk1 })).toBe("tao");
      expect(await dangNhap("app_api_login", mk1)).toEqual({ ok: true, nhom: ["app_api"] });
      const { rows } = await c.query<{ s: boolean; b: boolean; cr: boolean }>(
        "SELECT rolsuper AS s, rolbypassrls AS b, rolcreaterole AS cr FROM pg_roles WHERE rolname = 'app_api_login'",
      );
      expect(rows[0]).toEqual({ s: false, b: false, cr: false });

      const mk2 = mk();
      expect(await damBaoVaiDangNhap(c, { ten: "app_api_login", nhom: "app_api", matKhau: mk2 })).toBe("cap-nhat");
      expect((await dangNhap("app_api_login", mk2)).ok).toBe(true);
      expect((await dangNhap("app_api_login", mk1)).ok).toBe(false);

      const mk3 = mk();
      await damBaoVaiDangNhap(c, { ten: "app_unseal_login", nhom: "app_unseal", matKhau: mk3 });
      expect(await dangNhap("app_unseal_login", mk3)).toEqual({ ok: true, nhom: ["app_unseal"] });
      // [ADR-072 phần 1] Vai đăng nhập thứ ba: job neo, thành viên app_neo và CHỈ app_neo.
      const mk4 = mk();
      expect(await damBaoVaiDangNhap(c, { ten: "app_neo_login", nhom: "app_neo", matKhau: mk4 })).toBe("tao");
      expect(await dangNhap("app_neo_login", mk4)).toEqual({ ok: true, nhom: ["app_neo"] });
      // Lần migrate() kế (deploy sau) KHÔNG gỡ ba membership ấy — chúng là cặp hardening chấp nhận.
      await migrate(db.pool, MIGRATIONS_DIR);
      expect((await dangNhap("app_unseal_login", mk3)).nhom).toEqual(["app_unseal"]);
      expect((await dangNhap("app_neo_login", mk4)).nhom).toEqual(["app_neo"]);
    } finally {
      c.release();
    }
  }, 240_000);

  it("lỗi của câu tạo vai không lộ mật khẩu: thông điệp chỉ mang mã Postgres", async () => {
    const c = await db.pool.connect();
    try {
      const bimat = mk();
      const loi = await damBaoVaiDangNhap(c, { ten: "app_api_login", nhom: "nhom_khong_ton_tai", matKhau: bimat }).catch((e: unknown) => e);
      expect(loi).toBeInstanceOf(ChayMigrateError);
      expect((loi as Error).message).toMatch(/mã 42704/u);
      expect((loi as Error).message).not.toContain(bimat);
    } finally {
      c.release();
    }
  });
});

describe("[ADR-066] chay-migrate — cấu hình", () => {
  it("URL sai vai, mật khẩu ngắn, thiếu biến ⇒ ném nêu tên biến, không nêu giá trị", () => {
    expect(() => docVaiTuUrl("X", "postgres://postgres:" + "a".repeat(30) + "@h/db", "app_api_login", "app_api")).toThrow(/X phải đăng nhập/u);
    expect(() => docVaiTuUrl("X", "postgres://app_api_login:ngan@h/db", "app_api_login", "app_api")).toThrow(/24 ký tự/u);
    expect(() => docCauHinh({})).toThrow(/TRUSTPROCURE_MIGRATE_DB_HOST/u);
    // [ADR-072 phần 1] URL của job neo BẮT BUỘC, và phải đăng nhập đúng `app_neo_login` — URL của api dán nhầm vào đó thì ném.
    expect(() => docVaiTuUrl("TRUSTPROCURE_NEO_DATABASE_URL", "postgres://app_api_login:" + "a".repeat(30) + "@h/db", "app_neo_login", "app_neo")).toThrow(/TRUSTPROCURE_NEO_DATABASE_URL phải đăng nhập bằng vai "app_neo_login"/u);
    const v = docVaiTuUrl("X", `postgres://app_api_login:${encodeURIComponent("p@ss/word+" + "x".repeat(20))}@h/db`, "app_api_login", "app_api");
    expect(v.matKhau).toBe("p@ss/word+" + "x".repeat(20));
  });

  it("[ADR-072 phần 1] thiếu TRUSTPROCURE_NEO_DATABASE_URL ⇒ ném nêu đúng tên biến; đủ ⇒ ba vai theo thứ tự api, worker, neo", () => {
    const url = (ten: string): string => `postgres://${ten}:${"m".repeat(30)}@h/db`;
    const env = {
      TRUSTPROCURE_MIGRATE_DB_HOST: "h",
      TRUSTPROCURE_MIGRATE_DB_NAME: "db",
      TRUSTPROCURE_MIGRATE_DB_USER: "chu",
      TRUSTPROCURE_MIGRATE_DB_PASSWORD: "mk",
      // Nội dung không quan trọng ở đây — docCauHinh chỉ đọc tệp; chính tệp test này đọc được.
      TRUSTPROCURE_MIGRATE_DB_CA_FILE: fileURLToPath(import.meta.url),
      TRUSTPROCURE_API_DATABASE_URL: url("app_api_login"),
      TRUSTPROCURE_WORKER_DATABASE_URL: url("app_unseal_login"),
    };
    expect(() => docCauHinh(env)).toThrow(/TRUSTPROCURE_NEO_DATABASE_URL/u);
    const ch = docCauHinh({ ...env, TRUSTPROCURE_NEO_DATABASE_URL: url("app_neo_login") });
    expect(ch.vai.map((v) => [v.ten, v.nhom])).toEqual([
      ["app_api_login", "app_api"],
      ["app_unseal_login", "app_unseal"],
      ["app_neo_login", "app_neo"],
    ]);
  });
});
