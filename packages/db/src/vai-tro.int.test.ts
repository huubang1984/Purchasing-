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
    expect(loi!.name, "tên riêng — log chỉ ghi tên lỗi (lượt soi 52 NHẸ-2)").toBe("KetNoiNhiemError");
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
    expect(sau.vai).toBe("local");
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

  it("mặc định phiên của vai đăng nhập đặt search path hợp lệ khác mặc định máy chủ ⇒ mốc là của CHÍNH kết nối: các lần lấy kế giữ kết nối", async () => {
    await db.pool.query("ALTER ROLE app_api_login SET search_path = zz99, public");
    try {
      const p = poolMot();
      const a = await trangThai(p);
      const b = await trangThai(p);
      expect(a.luoc_do, "tiền đề: mặc định phiên có hiệu lực").toBe("{zz99,public}");
      expect(b.pid, "so với một hằng thay vì mốc của kết nối thì kết nối hợp lệ này bị huỷ oan").toBe(a.pid);
    } finally {
      await db.pool.query("ALTER ROLE app_api_login RESET search_path");
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
