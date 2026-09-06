// ==============================================================================================
// [S1.11 / migration 037 / sổ nợ 50] ĐƯỜNG SẢN XUẤT ĐĂNG NHẬP BẰNG app_api_login — VÀ HAI LỚP
// ĐĂNG NHẬP (029, 032) PHẢI NHÌN THẤY NÓ
//
// Mọi phép đo dưới `app_api` của dự án chạy qua `poolAs("app_api")`: mỗi client `SET ROLE` trước
// khi được giao ra, `current_user = 'app_api'`. Tiến trình thật thì đăng nhập bằng một role thành
// viên INHERIT (`app_api_login`, hardening CAP_HOP_LE) — có TOÀN BỘ quyền của app_api nhưng
// `current_user` là tên KHÁC. Hai trigger 029/032 điều kiện theo `current_user = 'app_api'` nên,
// trước 037, chúng IM LẶNG đúng trên đường ấy. File này đo cả hai lớp đóng:
//   ⑴ CSDL — 037: vị từ `la_duong_ung_dung('app_api')` (kế thừa quyền + không superuser); đột biến
//      trả vị từ về tên cũ ⇒ app_api_login KHÔNG SET ROLE chèn được phiên thiếu MFA (RED thật).
//   ⑵ Ứng dụng — `createPool(..., { role: "app_api" })`: mọi client giao ra ĐANG là app_api, kể cả
//      sau một `RESET ROLE`; role đăng nhập không phải thành viên ⇒ ném ồn ào, không giao client.
// ==============================================================================================
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";
import { khangDinhPhienDangNhapUngDung } from "./vai-tro.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** Thân ĐÚNG của vị từ, chép nguyên văn từ 037 — dùng để khôi phục sau đột biến. */
const THAN_037 = `CREATE OR REPLACE FUNCTION public.la_duong_ung_dung(ten_vai pg_catalog.name) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
AS $ham$
  SELECT pg_catalog.pg_has_role(current_user, ten_vai, 'USAGE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles r
        WHERE r.rolname OPERATOR(pg_catalog.=) current_user AND r.rolsuper
     )
$ham$`;

/** Đột biến: vị từ CŨ của 029/032 — chỉ nhìn thấy đúng cái tên `app_api`. */
const THAN_CU = `CREATE OR REPLACE FUNCTION public.la_duong_ung_dung(ten_vai pg_catalog.name) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
AS $ham$
  SELECT current_user OPERATOR(pg_catalog.=) ten_vai
$ham$`;

let db: TestDatabase;
let urlLogin: string;
let urlKhongThanhVien: string;
let org: string;
let nguoi: string;
const poolMo: pg.Pool[] = [];

function doiNguoiDung(chuoi: string, ten: string, matKhau: string): string {
  const url = new URL(chuoi);
  url.username = ten;
  url.password = matKhau;
  return url.toString();
}

function pool(url: string, role?: "app_api"): pg.Pool {
  const p = createPool(url, 2, role === undefined ? {} : { role });
  poolMo.push(p);
  return p;
}

/** Cùng khuôn `withTenant` (GUC phạm vi giao dịch) nhưng viết tay, để gói `db` không mọc cạnh tới `tenancy`. */
async function trongToChuc<T>(p: pg.Pool, viec: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
    const kq = await viec(c);
    await c.query("COMMIT");
    return kq;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const chenPhienThieuMfa = (p: pg.Pool) =>
  trongToChuc(p, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id",
      [org, nguoi, randomBytes(32)],
    ),
  );

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('To chuc', 'to-chuc') RETURNING id")).rows[0]!.id;
  nguoi = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, 'a@vidu.vn', 'A', 'ACTIVE') RETURNING id",
      [org],
    )
  ).rows[0]!.id;
  // Đúng câu hardening.always.sql mô tả cho vận hành: role đăng nhập, thành viên của app_api, INHERIT mặc định.
  await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api' IN ROLE app_api");
  await db.pool.query("CREATE ROLE khong_thanh_vien LOGIN PASSWORD 'mk-ktv'");
  urlLogin = doiNguoiDung(db.connectionString, "app_api_login", "mk-api");
  urlKhongThanhVien = doiNguoiDung(db.connectionString, "khong_thanh_vien", "mk-ktv");
}, 180000);

afterAll(async () => {
  await Promise.allSettled(poolMo.map((p) => p.end()));
  await db?.stop();
});

describe("[S1.11] createPool({ role }) — mọi client giao ra ĐANG là vai ấy", () => {
  it("không đặt `role`: current_user là app_api_login (đối chứng — đường sản xuất trước S1.11)", async () => {
    const { rows } = await pool(urlLogin).query<{ u: string }>("SELECT current_user AS u");
    expect(rows[0]?.u).toBe("app_api_login");
  });

  it("đặt `role: app_api`: current_user là app_api ở cả pool.query lẫn pool.connect, và SAU một RESET ROLE trên client được tái dùng", async () => {
    const p = pool(urlLogin, "app_api");
    const { rows } = await p.query<{ u: string }>("SELECT current_user AS u");
    expect(rows[0]?.u).toBe("app_api");
    const c1 = await p.connect();
    expect((await c1.query<{ u: string }>("SELECT current_user AS u")).rows[0]?.u).toBe("app_api");
    // Đầu độc client rồi trả lại pool — [fix I3]: lần lấy sau phải tái khẳng định, không tin client rảnh.
    await c1.query("RESET ROLE");
    expect((await c1.query<{ u: string }>("SELECT current_user AS u")).rows[0]?.u).toBe("app_api_login");
    c1.release();
    const c2 = await p.connect();
    try {
      expect((await c2.query<{ u: string }>("SELECT current_user AS u")).rows[0]?.u).toBe("app_api");
    } finally {
      c2.release();
    }
  });

  it("[review H3-1] khangDinhPhienDangNhapUngDung: superuser đã SET ROLE app_api ⇒ ném nêu SUPERUSER; app_api_login được GRANT app_unseal ⇒ ném; app_api_login sạch ⇒ qua", async () => {
    // Superuser: `SET ROLE app_api` thành công, `current_user` = app_api — lớp cũ hài lòng; lớp mới đọc session_user.
    const sieu = pool(db.connectionString, "app_api");
    const c1 = await sieu.connect();
    try {
      expect((await c1.query<{ u: string }>("SELECT current_user AS u")).rows[0]?.u).toBe("app_api");
      await expect(khangDinhPhienDangNhapUngDung(c1, "app_api")).rejects.toThrow(/SUPERUSER/u);
    } finally {
      c1.release();
    }
    const sach = pool(urlLogin, "app_api");
    const c2 = await sach.connect();
    try {
      await expect(khangDinhPhienDangNhapUngDung(c2, "app_api")).resolves.toBeUndefined();
      await db.pool.query("GRANT app_unseal TO app_api_login");
      try {
        await expect(khangDinhPhienDangNhapUngDung(c2, "app_api")).rejects.toThrow(/thành viên của app_unseal/u);
      } finally {
        await db.pool.query("REVOKE app_unseal FROM app_api_login");
      }
      await db.pool.query("ALTER ROLE app_api_login BYPASSRLS");
      try {
        await expect(khangDinhPhienDangNhapUngDung(c2, "app_api")).rejects.toThrow(/BYPASSRLS/u);
      } finally {
        await db.pool.query("ALTER ROLE app_api_login NOBYPASSRLS");
      }
    } finally {
      c2.release();
    }
  });

  it("role đăng nhập KHÔNG phải thành viên của app_api: lấy client NÉM (42501), không giao client, pool không rò", async () => {
    const p = pool(urlKhongThanhVien, "app_api");
    await expect(p.query("SELECT 1")).rejects.toMatchObject({ code: "42501" });
    await expect(p.connect()).rejects.toMatchObject({ code: "42501" });
    // Client bị `release(err)` — huỷ, không nằm lại trong pool dưới danh tính sai.
    expect(p.idleCount).toBe(0);
    expect(p.waitingCount).toBe(0);
  });
});

describe("[037] hai lớp đăng nhập nhìn thấy app_api_login, không chỉ cái tên app_api", () => {
  it("[029 qua 037] app_api_login KHÔNG SET ROLE vẫn không chèn được phiên thiếu MFA; superuser thì được (đường test/vận hành không đổi)", async () => {
    await expect(chenPhienThieuMfa(pool(urlLogin))).rejects.toMatchObject({ code: "23514" });
    await expect(chenPhienThieuMfa(pool(urlLogin))).rejects.toThrow(/MFA/u);
    // Superuser: `pg_has_role` trả TRUE cho superuser với mọi role — vế `NOT rolsuper` là thứ giữ đường này mở.
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id",
      [org, nguoi, randomBytes(32)],
    );
    expect(rows).toHaveLength(1);
    await db.pool.query("DELETE FROM sessions WHERE id = $1", [rows[0]!.id]);
  });

  it("ĐỘT BIẾN: trả vị từ về `current_user = ten_vai` (thân cũ của 029/032) ⇒ app_api_login KHÔNG SET ROLE chèn ĐƯỢC phiên thiếu MFA; SET ROLE thì vẫn bị chặn; khôi phục ⇒ chặn lại", async () => {
    await db.pool.query(THAN_CU);
    try {
      const { rows } = await chenPhienThieuMfa(pool(urlLogin));
      expect(rows, "RED THẬT: lớp 029 im lặng trên đường sản xuất khi vị từ chỉ đọc tên").toHaveLength(1);
      await db.pool.query("DELETE FROM sessions WHERE id = $1", [rows[0]!.id]);
      // Đối chứng: cùng thân cũ, đường SET ROLE (đường mọi phép đo đã chạy) vẫn bị chặn — đó là lý do khe hở
      // không lộ ra ở một test nào trước S1.11.
      await expect(chenPhienThieuMfa(pool(urlLogin, "app_api"))).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.pool.query(THAN_037);
    }
    await expect(chenPhienThieuMfa(pool(urlLogin))).rejects.toMatchObject({ code: "23514" });
  });

  it("[032 qua 037] app_api_login KHÔNG SET ROLE không thay được bí mật TOTP của hồ sơ ĐÃ xác nhận; đột biến thân cũ ⇒ thay được", async () => {
    await db.pool.query(
      "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version, confirmed_at) VALUES ($1, $2, 'TOTP', '\\x01', 'v1', now())",
      [org, nguoi],
    );
    // Mỗi lần thử một GIÁ TRỊ KHÁC: UPDATE về cùng giá trị không đổi gì, `IS DISTINCT FROM` là FALSE và
    // trigger không kích — bài học H2-1 (auth.int.test.ts), lặp lại ở đây ngay lượt chạy đầu.
    const thay = (p: pg.Pool, gt: string) =>
      trongToChuc(p, (c) =>
        c.query<{ id: string }>("UPDATE mfa_credentials SET secret_wrapped = $3 WHERE org_id = $1 AND user_id = $2 RETURNING id", [
          org,
          nguoi,
          Buffer.from(gt, "hex"),
        ]),
      );
    await expect(thay(pool(urlLogin), "02")).rejects.toMatchObject({ code: "23514" });
    await expect(thay(pool(urlLogin), "02")).rejects.toThrow(/da xac nhan/u);
    await db.pool.query(THAN_CU);
    try {
      const { rows } = await thay(pool(urlLogin), "02");
      expect(rows, "RED THẬT: lớp 032 im lặng trên đường sản xuất khi vị từ chỉ đọc tên").toHaveLength(1);
    } finally {
      await db.pool.query(THAN_037);
    }
    await expect(thay(pool(urlLogin), "03")).rejects.toMatchObject({ code: "23514" });
  });

  it("vị từ không gọi được từ PUBLIC, gọi được từ app_api; và nó là STABLE, không SECURITY DEFINER", async () => {
    const { rows } = await db.pool.query<{ secdef: boolean; vol: string; pub: boolean; api: boolean }>(
      `SELECT p.prosecdef AS secdef, p.provolatile AS vol,
              has_function_privilege('khong_thanh_vien', p.oid, 'EXECUTE') AS pub,
              has_function_privilege('app_api', p.oid, 'EXECUTE') AS api
         FROM pg_proc p WHERE p.oid = to_regprocedure('public.la_duong_ung_dung(name)')`,
    );
    expect(rows[0]).toEqual({ secdef: false, vol: "s", pub: false, api: true });
  });
});
