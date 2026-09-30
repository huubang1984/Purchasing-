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
import { KetNoiNhiemError, TU_CHOI_KET_NOI_NHIEM, khangDinhPhienDangNhapUngDung } from "./vai-tro.js";

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

// ==============================================================================================
// [S1.59 / khoản nợ 99] MỖI LẦN LẤY CLIENT CỦA POOL CÓ VAI ĐỌC LẠI BA GUC VẬN HÀNH — VÀ TỪ CHỐI KẾT NỐI CÒN MỞ GIAO DỊCH
//
// `withTenant` đọc lại ba GUC vận hành sau giao dịch của nó (khoản 96 ⑵), nhưng mã chạy câu trên pool NGOÀI hàm ấy — hai bộ dọn nền,
// phép kiểm vai của auditPool, phép kiểm lúc khởi động — không có lớp nào, và kết nối mà mã ấy để nhiễm quay về pool rồi giao cho
// người dùng kế tiếp. Lớp mới đặt ở chỗ MỌI đường đều đi qua: `ganVaiTroChoPool`, cùng câu `current_user` đã có ở mỗi lần lấy client —
// không thêm vòng đi-về. `session_replication_role` và `row_security` xét theo TÍNH CHẤT; search path HIỆU LỰC (`current_schemas(false)`,
// cùng cách đọc của withTenant — [INV-H21] chỉ cho migrate.ts nêu tên GUC ấy trong SQL, lượt soi 52 NẶNG-1) so với mốc đọc ở lần lấy
// ĐẦU TIÊN của chính kết nối vật lý ấy, nên mặc định phiên hợp lệ khác mặc định máy chủ vẫn qua; trạng thái giao dịch đọc từ client
// (không vòng đi-về) phải là rảnh. Kết nối nhiễm bị huỷ và lời gọi NÉM `KetNoiNhiemError` — người gọi không bao giờ nhận nó. Đo trên kết
// nối đăng nhập thật (`app_api_login`), pool một kết nối để đo pid.
// ==============================================================================================
describe("[S1.59 / khoản nợ 99] mỗi lần lấy client của pool có vai đọc lại ba GUC vận hành — kết nối nhiễm bị huỷ, lời gọi NÉM", () => {
  interface TrangThai {
    pid: number;
    vai: string;
    rls: string;
    luoc_do: string;
  }
  const poolMot = (): pg.Pool => {
    const p = createPool(urlLogin, 1, { role: "app_api" });
    poolMo.push(p);
    return p;
  };
  const trangThai = async (p: pg.Pool): Promise<TrangThai> =>
    (
      await p.query<TrangThai>(
        "SELECT pg_backend_pid()::int AS pid, current_setting('session_replication_role') AS vai, " +
          "current_setting('row_security') AS rls, current_schemas(false)::text AS luoc_do",
      )
    ).rows[0]!;
  /** Lấy client, chạy câu làm nhiễm, trả client về pool — đúng hình dạng của một đường ngoài withTenant. */
  const nhiemRoiTra = async (p: pg.Pool, cau: string): Promise<number> => {
    const c = await p.connect();
    try {
      await c.query(cau);
      return (await c.query<{ pid: number }>("SELECT pg_backend_pid()::int AS pid")).rows[0]!.pid;
    } finally {
      c.release();
    }
  };
  const loiKhiLay = (lan: Promise<unknown>): Promise<Error | null> =>
    lan.then(
      (kq) => {
        (kq as { release?: () => void }).release?.();
        return null;
      },
      (e: Error) => e,
    );

  beforeAll(async () => {
    await db.pool.query(`
      CREATE SCHEMA zz99;
      GRANT USAGE ON SCHEMA zz99 TO app_api;
      CREATE FUNCTION zz99.dat_vai_sao_chep(gia_tri text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
        AS $$BEGIN PERFORM set_config('session_replication_role', gia_tri, false); END$$;
      REVOKE EXECUTE ON FUNCTION zz99.dat_vai_sao_chep(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION zz99.dat_vai_sao_chep(text) TO app_api;
    `);
  });

  afterAll(async () => {
    await db.pool.query("DROP SCHEMA IF EXISTS zz99 CASCADE");
  });

  it("row_security = off để lại trên kết nối ⇒ lần lấy kế (pool.connect) NÉM KetNoiNhiemError nêu row_security, kết nối bị huỷ; lần sau là kết nối mới, sạch", async () => {
    const p = poolMot();
    const pid = await nhiemRoiTra(p, "SET row_security = off");
    const loi = await loiKhiLay(p.connect());
    expect(loi, "bản trước bản vá: client nhiễm được giao ra").not.toBeNull();
    expect(loi).toBeInstanceOf(KetNoiNhiemError);
    expect(loi!.name, "tên riêng — ~~log chỉ ghi tên lỗi~~ [S1.67] lớp này không mang mã nên dòng log chỉ có tên (lượt soi 52 NHẸ-2)").toBe("KetNoiNhiemError");
    expect(loi!.message).toContain(TU_CHOI_KET_NOI_NHIEM);
    expect(loi!.message).toContain("row_security");
    const sau = await trangThai(p);
    expect(sau.pid, "kết nối nhiễm bị huỷ").not.toBe(pid);
    expect(sau.rls).toBe("on");
  });

  it("session_replication_role = replica do hàm SECURITY DEFINER để lại ⇒ lần lấy kế qua pool.query (đường callback) NÉM nêu session_replication_role, kết nối bị huỷ", async () => {
    const p = poolMot();
    const pid = await nhiemRoiTra(p, "SELECT zz99.dat_vai_sao_chep('replica')");
    const loi = await loiKhiLay(p.query("SELECT 1"));
    expect(loi, "bản trước bản vá: câu chạy dưới replica").not.toBeNull();
    expect(loi).toBeInstanceOf(KetNoiNhiemError);
    expect(loi!.message).toContain(TU_CHOI_KET_NOI_NHIEM);
    expect(loi!.message).toContain("session_replication_role");
    const sau = await trangThai(p);
    expect(sau.pid).not.toBe(pid);
    expect(sau.vai).toBe("origin");
  });

  it("search path phạm vi phiên sang một schema đọc được ⇒ lần lấy kế NÉM nêu search path hiệu lực, kết nối bị huỷ; kết nối mới về đúng mốc", async () => {
    const p = poolMot();
    const truoc = await trangThai(p);
    const pid = await nhiemRoiTra(p, "SET search_path = zz99, public");
    expect(pid, "tiền đề: cùng kết nối vật lý").toBe(truoc.pid);
    const loi = await loiKhiLay(p.connect());
    expect(loi, "bản trước bản vá: client giao ra dưới search path lạ").not.toBeNull();
    expect(loi).toBeInstanceOf(KetNoiNhiemError);
    expect(loi!.message).toContain(TU_CHOI_KET_NOI_NHIEM);
    expect(loi!.message).toContain("search path hiệu lực");
    const sau = await trangThai(p);
    expect(sau.pid).not.toBe(pid);
    expect(sau.luoc_do).toBe(truoc.luoc_do);
  });

  it("kết nối trả về pool khi ĐANG MỞ GIAO DỊCH ⇒ lần lấy kế NÉM trước khi SET ROLE chạy trong giao dịch của người trước, kết nối bị huỷ (lượt soi 52 INFO-2)", async () => {
    const p = poolMot();
    const c = await p.connect();
    let pid = 0;
    try {
      pid = (await c.query<{ pid: number }>("SELECT pg_backend_pid()::int AS pid")).rows[0]!.pid;
      await c.query("BEGIN");
      await c.query("SELECT 1");
    } finally {
      c.release();
    }
    const loi = await loiKhiLay(p.connect());
    expect(loi, "bản trước bản vá: SET ROLE chạy bên trong giao dịch cũ và client được giao ra").not.toBeNull();
    expect(loi).toBeInstanceOf(KetNoiNhiemError);
    expect(loi!.message).toContain("đang mở giao dịch");
    const sau = await trangThai(p);
    expect(sau.pid, "kết nối còn mở giao dịch bị huỷ").not.toBe(pid);
  });

  it("ĐỐI CHỨNG: SET LOCAL row_security và search path trong giao dịch đã COMMIT, session_replication_role = local — lần lấy kế giao client bình thường, kết nối được GIỮ", async () => {
    const p = poolMot();
    const truoc = await trangThai(p);
    const c = await p.connect();
    try {
      await c.query("BEGIN; SET LOCAL row_security = off; SET LOCAL search_path = zz99, public; COMMIT");
      await c.query("SELECT zz99.dat_vai_sao_chep('local')");
    } finally {
      c.release();
    }
    const sau = await trangThai(p);
    expect(sau.pid, "kết nối sạch theo tính chất không bị huỷ").toBe(truoc.pid);
    // ~~expect(sau.vai).toBe("local")~~ [S1.215 / khoản 104] lớp lấy client nay RESET ALL SAU khi đọc: `local` không bị phán (đọc thấy
    // trước khi dọn — khẳng định pid ở trên là vế chịu lực) nhưng người kế tiếp nhận lại mặc định phiên `origin`.
    expect(sau.vai).toBe("origin");
    expect(sau.rls).toBe("on");
    expect(sau.luoc_do).toBe(truoc.luoc_do);
  });

  it("mặc định phiên của vai đăng nhập đặt row_security = off ⇒ lần lấy ĐẦU của kết nối mới NÉM, và chẩn đoán nói MẶC ĐỊNH PHIÊN chứ không nói nhiễm phạm vi phiên (lượt soi 52 NHẸ-1)", async () => {
    await db.pool.query("ALTER ROLE app_api_login SET row_security = off");
    try {
      const p = poolMot();
      const loi = await loiKhiLay(p.connect());
      expect(loi, "tính chất xét cả ở lần lấy đầu — chưa câu nào chạy trên kết nối").not.toBeNull();
      expect(loi).toBeInstanceOf(KetNoiNhiemError);
      expect(loi!.message).toContain("row_security");
      expect(loi!.message).toContain("MẶC ĐỊNH PHIÊN");
    } finally {
      await db.pool.query("ALTER ROLE app_api_login RESET row_security");
    }
  });

  // [khoản 109] Ca này từng được ghim như HỢP LỆ: `zz99, public` là "một mặc định phiên hợp lệ khác mặc định máy chủ", nên phép so
  // tương đối lấy nó làm mốc và giữ kết nối. Khoản 109 đo rằng đó chính là lỗ: một schema lạ đứng TRƯỚC `public` là phần CẤM, bất
  // biến, và cả lớp này sinh ra để chặn nó. Tên test giữ vế còn đúng — mốc là của CHÍNH kết nối cho phần KHÔNG cấm (schema sau
  // `public`) — còn vế "zz99 trước public được giữ" đổi thành NÉM ngay ở lần lấy ĐẦU.
  it("mặc định phiên của vai đăng nhập: schema lạ TRƯỚC public ⇒ NÉM ngay lần lấy đầu (khoản 109); schema SAU public ⇒ mốc là của CHÍNH kết nối, các lần lấy kế giữ kết nối", async () => {
    await db.pool.query("ALTER ROLE app_api_login SET search_path = zz99, public");
    try {
      const loi = await loiKhiLay(poolMot().connect());
      expect(loi, "phần CẤM được kiểm tuyệt đối — kể cả khi chưa có mốc").toBeInstanceOf(KetNoiNhiemError);
      expect(loi!.message).toContain("schema lạ đứng trước public");
      expect(loi!.message, "chỉ TÊN điều bị vi phạm, không tên schema").not.toContain("zz99");
    } finally {
      await db.pool.query("ALTER ROLE app_api_login RESET search_path");
    }
    await db.pool.query("ALTER ROLE app_api_login SET search_path = public, zz99");
    try {
      const p = poolMot();
      const a = await trangThai(p);
      const b = await trangThai(p);
      expect(a.luoc_do, "tiền đề: mặc định phiên có hiệu lực").toBe("{public,zz99}");
      expect(b.pid, "so với một hằng thay vì mốc của kết nối thì kết nối hợp lệ này bị huỷ oan").toBe(a.pid);
    } finally {
      await db.pool.query("ALTER ROLE app_api_login RESET search_path");
    }
  });

  // [khoản 109 — lượt soi ngang 59a-4] `public, pg_catalog` đặt `pg_catalog` SAU `public`, nên PostgreSQL thôi tìm nó ngầm ở đầu:
  // một `public.lower(text)` thắng `pg_catalog.lower(text)` với tên trần. Đo trước bản vá: lấy client không ném, `lower('ABC')`
  // ra `CUOP`. Nay NÉM ở lần lấy đầu, và không câu nào của người gọi chạy trên kết nối ấy.
  it("[khoản 109] mặc định vai `public, pg_catalog` (59a-4) ⇒ lần lấy ĐẦU NÉM, trước khi `public.lower` kịp cướp tên trần", async () => {
    await db.pool.query(
      "CREATE FUNCTION public.lower(text) RETURNS text LANGUAGE sql AS $f$SELECT 'CUOP'::text$f$; " +
        "GRANT EXECUTE ON FUNCTION public.lower(text) TO app_api; " +
        "ALTER ROLE app_api_login SET search_path = public, pg_catalog",
    );
    try {
      const loi = await loiKhiLay(poolMot().query("SELECT lower('ABC') AS x"));
      expect(loi).toBeInstanceOf(KetNoiNhiemError);
      expect(loi!.message).toContain("pg_catalog sau public");
    } finally {
      await db.pool.query("ALTER ROLE app_api_login RESET search_path; DROP FUNCTION public.lower(text)");
    }
  });

  // [khoản 109 — lượt soi ngang 59a-2] `ALTER SYSTEM` đặt độc rồi nạp lại: không hàng mức vai hay database nào, deploy không thấy
  // gì. Đo trước bản vá: pool ứng dụng mới lấy client không lỗi với `{ke_gian,public}`. Nay NÉM.
  it("[khoản 109] `ALTER SYSTEM SET search_path = ke_gian, public` + reload (59a-2) ⇒ pool ứng dụng mới NÉM ở lần lấy đầu", async () => {
    await db.pool.query("CREATE SCHEMA ke_gian; GRANT USAGE ON SCHEMA ke_gian TO app_api");
    await db.pool.query("ALTER SYSTEM SET search_path = ke_gian, public");
    await db.pool.query("SELECT pg_reload_conf()");
    try {
      const loi = await loiKhiLay(poolMot().connect());
      expect(loi).toBeInstanceOf(KetNoiNhiemError);
      expect(loi!.message).toContain("schema lạ đứng trước public");
    } finally {
      await db.pool.query("ALTER SYSTEM RESET search_path");
      await db.pool.query("SELECT pg_reload_conf()");
      await db.pool.query("DROP SCHEMA ke_gian");
    }
  });

  it('RANH GIỚI, ghim: DDL đổi search path HIỆU LỰC của mọi kết nối — schema trùng tên vai mà "$user" trỏ tới, GRANT USAGE — thì lần lấy kế của mỗi kết nối pool NÉM một lần và huỷ nó (cùng cách so của withTenant ⑵); kết nối mới lấy mốc mới và được giữ', async () => {
    const p = poolMot();
    const truoc = await trangThai(p);
    await db.pool.query("CREATE SCHEMA app_api; GRANT USAGE ON SCHEMA app_api TO app_api");
    try {
      const loi = await loiKhiLay(p.connect());
      expect(loi, "so search path hiệu lực nên DDL đổi nó là lệch mốc").toBeInstanceOf(KetNoiNhiemError);
      expect(loi!.message).toContain("search path hiệu lực");
      const moi = await trangThai(p);
      expect(moi.pid).not.toBe(truoc.pid);
      expect(moi.luoc_do, "tiền đề: search path hiệu lực đổi thật").toBe("{app_api,public}");
      expect((await trangThai(p)).pid, "kết nối mới lấy mốc mới và được giữ").toBe(moi.pid);
    } finally {
      await db.pool.query("DROP SCHEMA app_api CASCADE");
    }
  });
});

// ==============================================================================================
// [S1.215 / khoản 104] TRẠNG THÁI PHIÊN NGOÀI BA GUC VẬN HÀNH KHÔNG ĐI THEO KẾT NỐI POOL SANG NGƯỜI DÙNG KẾ TIẾP
//
// Khoản 99 đọc ba GUC ở mỗi lần lấy client; mọi GUC phiên khác (ba GUC IM7 về 0 — đo S1.59; `TimeZone`, …) và trạng thái phiên ngoài
// GUC mà `DISCARD TEMP` không dọn (prepared statement, con trỏ WITH HOLD, kênh LISTEN, khoá tư vấn mức phiên) thì không. Hai hướng đo
// trên cụm cục bộ (PostgreSQL 16.13, đăng nhập `app_api_login`, trung vị của 2 000 lần, máy bốn lõi dùng chung — số ở §S1.215): PHÁN
// bằng một lần quét `pg_settings` (`source = 'session'` hay `setting <> reset_val`) ghép vào câu đọc giá thêm ~930 µs mỗi lần lấy — hơn
// ba lần CẢ lần lấy hiện hành (275 µs); đếm `pg_locks` thêm ~215 µs; ba bộ đếm prepared/con trỏ/LISTEN thêm ~65 µs. DỌN thì `RESET ALL`
// 37 µs một vòng đi-về, và bộ `CLOSE ALL; DEALLOCATE ALL; UNLISTEN *; pg_advisory_unlock_all()` ghép vào câu `SET ROLE` thêm ~10 µs.
// Nên lớp lấy client DỌN, không phán, thứ dọn được: bốn thứ ngoài GUC dọn vô điều kiện ngay trong câu `SET ROLE; DISCARD TEMP`; GUC phiên
// thì ĐỌC TRƯỚC (ba GUC vận hành, search path, TÊN bốn GUC tenant/khách — cùng câu) rồi `RESET ALL` SAU, và CHỈ khi bốn GUC tenant/khách
// RỖNG — giá trị có sẵn ở đó là tín hiệu của phép phân biệt mặc-định-phiên/rò-phiên bằng RESET của `withTenant` (khoản 87, S1.48), lớp
// này không được xoá. Ba GUC vận hành vẫn bị PHÁN như khoản 99 vì được đọc trước khi dọn. Vai ứng dụng không gọi được `pg_advisory_lock`
// (khoản 128 — đo 42501): đường còn lại là một hàm SECURITY DEFINER do migration dựng, dựng ở đây để đo; khoá thuộc về BACKEND nên nó ở
// lại trên kết nối sau khi hàm trả về.
// ==============================================================================================
describe("[S1.215 / khoản 104] trạng thái phiên NGOÀI ba GUC vận hành được DỌN ở mỗi lần lấy client — GUC phiên lạ, prepared statement, con trỏ WITH HOLD, kênh LISTEN, khoá tư vấn mức phiên; tín hiệu rò GUC tenant của withTenant giữ nguyên", () => {
  interface TrucNgoai {
    pid: number;
    st: string;
    lt: string;
    itx: string;
    tz: string;
    vai: string;
    con_tro: number;
    cau_chuan_bi: number;
    kenh_nghe: number;
    khoa: number;
    org: string | null;
  }
  const CAU_TRUC =
    "SELECT pg_backend_pid()::int AS pid, current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt, " +
    "current_setting('idle_in_transaction_session_timeout') AS itx, current_setting('TimeZone') AS tz, " +
    "current_setting('session_replication_role') AS vai, " +
    "(SELECT count(*) FROM pg_cursors)::int AS con_tro, (SELECT count(*) FROM pg_prepared_statements)::int AS cau_chuan_bi, " +
    "(SELECT count(*) FROM pg_listening_channels())::int AS kenh_nghe, " +
    "(SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid())::int AS khoa, " +
    "NULLIF(current_setting('app.org_id', true), '') AS org";
  const poolMot = (): pg.Pool => {
    const p = createPool(urlLogin, 1, { role: "app_api" });
    poolMo.push(p);
    return p;
  };
  /** Trạng thái mà NGƯỜI KẾ TIẾP thấy — đọc qua chính đường lấy client của pool. */
  const docTruc = async (p: pg.Pool): Promise<TrucNgoai> => (await p.query<TrucNgoai>(CAU_TRUC)).rows[0]!;
  /** Lấy client, làm nhiễm, đọc trạng thái NGAY SAU khi nhiễm (tiền đề), trả về pool — hình dạng của một đường ngoài withTenant. */
  const nhiemRoiTra = async (p: pg.Pool, cau: string): Promise<TrucNgoai> => {
    const c = await p.connect();
    try {
      await c.query(cau);
      return (await c.query<TrucNgoai>(CAU_TRUC)).rows[0]!;
    } finally {
      c.release();
    }
  };
  const loiKhiLay = (lan: Promise<unknown>): Promise<Error | null> =>
    lan.then(
      (kq) => {
        (kq as { release?: () => void }).release?.();
        return null;
      },
      (e: Error) => e,
    );

  beforeAll(async () => {
    // Cùng khuôn `zz99.dat_vai_sao_chep` của khoản 99 (schema ấy đã bị describe trên DROP ở afterAll của nó — dựng lại).
    await db.pool.query(`
      CREATE SCHEMA IF NOT EXISTS zz99;
      GRANT USAGE ON SCHEMA zz99 TO app_api;
      CREATE FUNCTION zz99.khoa_phien(k bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
        AS $$BEGIN PERFORM pg_advisory_lock(k); END$$;
      REVOKE EXECUTE ON FUNCTION zz99.khoa_phien(bigint) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION zz99.khoa_phien(bigint) TO app_api;
      CREATE FUNCTION zz99.dat_vai_sao_chep(gia_tri text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
        AS $$BEGIN PERFORM set_config('session_replication_role', gia_tri, false); END$$;
      REVOKE EXECUTE ON FUNCTION zz99.dat_vai_sao_chep(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION zz99.dat_vai_sao_chep(text) TO app_api;
    `);
  });

  afterAll(async () => {
    await db.pool.query("DROP SCHEMA IF EXISTS zz99 CASCADE");
  });

  it("ba GUC IM7 về 0 và TimeZone lạ ở phạm vi phiên ⇒ người kế tiếp thấy lại giá trị PGOPTIONS và TimeZone cũ trên CÙNG kết nối (RESET ALL sau khi đọc — dọn, không huỷ)", async () => {
    const p = poolMot();
    const truoc = await docTruc(p);
    expect([truoc.st, truoc.lt, truoc.itx], "tiền đề: PGOPTIONS của createPool có hiệu lực").toEqual(["15s", "15s", "1min"]);
    const nhiem = await nhiemRoiTra(
      p,
      "SET statement_timeout = 0; SET lock_timeout = 0; SET idle_in_transaction_session_timeout = 0; SET TimeZone = 'Asia/Ho_Chi_Minh'",
    );
    expect(nhiem.pid, "tiền đề: cùng kết nối vật lý").toBe(truoc.pid);
    expect([nhiem.st, nhiem.lt, nhiem.itx, nhiem.tz], "tiền đề: nhiễm thật ở phạm vi phiên").toEqual(["0", "0", "0", "Asia/Ho_Chi_Minh"]);
    const sau = await docTruc(p);
    expect([sau.st, sau.lt, sau.itx], "bản trước bản vá: người kế tiếp đọc 0/0/0 — biện pháp IM7 bị gỡ (đo S1.59)").toEqual(["15s", "15s", "1min"]);
    expect(sau.tz).toBe(truoc.tz);
    expect(sau.pid, "GUC phiên được DỌN, không phán — kết nối được giữ").toBe(truoc.pid);
  });

  it("khoá tư vấn MỨC PHIÊN do hàm SECURITY DEFINER lấy ⇒ người kế tiếp thấy 0 khoá trên CÙNG kết nối (pg_advisory_unlock_all trong câu SET ROLE)", async () => {
    const p = poolMot();
    const truoc = await docTruc(p);
    const nhiem = await nhiemRoiTra(p, "SELECT zz99.khoa_phien(104104)");
    expect(nhiem.khoa, "tiền đề: khoá phiên thật sự được giữ trên backend sau khi hàm trả về").toBe(1);
    const sau = await docTruc(p);
    expect(sau.khoa, "bản trước bản vá: khoá phiên của người trước đi theo kết nối sang người kế tiếp").toBe(0);
    expect(sau.pid).toBe(truoc.pid);
  });

  it.each([
    ["prepared statement", "PREPARE zz_104_p AS SELECT 1", "cau_chuan_bi"],
    ["con trỏ WITH HOLD", "BEGIN; DECLARE zz_104_c CURSOR WITH HOLD FOR SELECT 1; COMMIT", "con_tro"],
    ["kênh LISTEN", "LISTEN zz_104_kenh", "kenh_nghe"],
  ] as const)("%s để lại trên kết nối ⇒ người kế tiếp thấy 0 trên CÙNG kết nối (CLOSE ALL; DEALLOCATE ALL; UNLISTEN * trong câu SET ROLE — dọn, không huỷ)", async (ten, cau, cot) => {
    const p = poolMot();
    const nhiem = await nhiemRoiTra(p, cau);
    expect(nhiem[cot], `tiền đề: ${ten} ở lại trên kết nối sau khi trả về pool`).toBe(1);
    const sau = await docTruc(p);
    expect(sau[cot], `bản trước bản vá: ${ten} của người trước đi theo kết nối sang người kế tiếp`).toBe(0);
    expect(sau.pid, "dọn, không huỷ").toBe(nhiem.pid);
  });

  it("ĐỌC TRƯỚC, DỌN SAU: replica do hàm SECURITY DEFINER để lại cùng TimeZone lạ ⇒ lần lấy kế vẫn NÉM KetNoiNhiemError nêu session_replication_role (phán trước khi RESET ALL kịp gỡ), kết nối bị huỷ; kết nối mới sạch", async () => {
    const p = poolMot();
    // TimeZone mặc định của cụm đọc trên kết nối sạch, không viết cứng: `initdb` lấy theo máy — ~~`Etc/UTC` ở cụm cục bộ trên
    // Ubuntu~~ [S1.9130 / khoản 9401: cụm cục bộ nay khởi tạo dưới `TZ=UTC`, nên `UTC` như container; đọc trên kết nối sạch vẫn
    // giữ, vì máy khác có thể dựng cụm khác], `UTC` ở `postgres:16-alpine` của CI (T3 đỏ ở PR #216 vì hằng `Etc/UTC`).
    const truoc = await docTruc(p);
    expect(truoc.tz, "tiền đề: TimeZone mặc định khác giá trị làm nhiễm").not.toBe("Asia/Ho_Chi_Minh");
    const nhiem = await nhiemRoiTra(p, "SELECT zz99.dat_vai_sao_chep('replica'); SET TimeZone = 'Asia/Ho_Chi_Minh'");
    expect(nhiem.vai).toBe("replica");
    const loi = await loiKhiLay(p.connect());
    expect(loi, "đột biến 'RESET ALL trước khi đọc' làm replica biến mất trước phép phán của khoản 99").toBeInstanceOf(KetNoiNhiemError);
    expect(loi!.message).toContain(TU_CHOI_KET_NOI_NHIEM);
    expect(loi!.message).toContain("session_replication_role");
    const sau = await docTruc(p);
    expect(sau.pid).not.toBe(nhiem.pid);
    expect([sau.vai, sau.tz]).toEqual(["origin", truoc.tz]);
  });

  it("RANH GIỚI ghim (khoản 87): GUC tenant rò ở phạm vi phiên ⇒ KHÔNG RESET ALL, KHÔNG phán — GUC phiên khác trên cùng kết nối còn nguyên, tín hiệu rò còn nguyên cho withTenant phân biệt bằng RESET; bốn thứ ngoài GUC vẫn được dọn", async () => {
    const p = poolMot();
    const truoc = await docTruc(p);
    const nhiem = await nhiemRoiTra(
      p,
      "SELECT set_config('app.org_id', '00000000-0000-4000-8000-000000000104', false); SET statement_timeout = 0; LISTEN zz_104_ranh_gioi",
    );
    expect([nhiem.org, nhiem.st, nhiem.kenh_nghe]).toEqual(["00000000-0000-4000-8000-000000000104", "0", 1]);
    const sau = await docTruc(p);
    expect(sau.pid, "không phán: kết nối được giao ra").toBe(truoc.pid);
    expect(sau.org, "không dọn GUC: tín hiệu rò phiên còn nguyên cho withTenant (S1.48 / 40a NẶNG-1)").toBe("00000000-0000-4000-8000-000000000104");
    expect(sau.st, "nói ra: khi có GUC tenant thì GUC phiên khác cũng chưa được dọn ở lần lấy này").toBe("0");
    expect(sau.kenh_nghe, "chỉ RESET ALL là có điều kiện — kênh LISTEN vẫn được dọn trong câu SET ROLE").toBe(0);
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
