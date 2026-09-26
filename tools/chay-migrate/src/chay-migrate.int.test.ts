// [ADR-066] Task migrate: sau migrate(), hai vai đăng nhập tồn tại, ĐĂNG NHẬP ĐƯỢC bằng mật khẩu lấy
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
      // Lần migrate() kế (deploy sau) KHÔNG gỡ hai membership ấy — chúng là cặp hardening chấp nhận.
      await migrate(db.pool, MIGRATIONS_DIR);
      expect((await dangNhap("app_unseal_login", mk3)).nhom).toEqual(["app_unseal"]);
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
    const v = docVaiTuUrl("X", `postgres://app_api_login:${encodeURIComponent("p@ss/word+" + "x".repeat(20))}@h/db`, "app_api_login", "app_api");
    expect(v.matKhau).toBe("p@ss/word+" + "x".repeat(20));
  });
});
