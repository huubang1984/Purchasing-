import { createPool, migrate } from "@trustprocure/db";
import {
  startPostgres,
  withMigratedDatabase,
  type TestDatabase,
} from "@trustprocure/test-support";
import { readFileSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * [fix round 4 — N2] Dựng đúng kịch bản vận hành mà vòng 3 làm gãy: cụm được bootstrap bằng
 * SUPERUSER một lần, sau đó MỌI deploy chạy dưới một role thường — có CREATEROLE và sở hữu
 * database, nhưng KHÔNG phải superuser và KHÔNG tạo ra app_api/app_unseal nên không có
 * ADMIN OPTION trên chúng. Trả về connection string của role đó.
 */
async function dungRoleTrienKhaiThuong(db: TestDatabase): Promise<string> {
  const { rows } = await db.pool.query<{ ten_db: string }>("SELECT current_database() AS ten_db");
  const tenDb = rows[0]!.ten_db;
  await db.pool.query("CREATE ROLE trien_khai LOGIN CREATEROLE PASSWORD 'mat-khau-trien-khai'");
  await db.pool.query(`ALTER DATABASE "${tenDb}" OWNER TO trien_khai`);
  await db.pool.query("GRANT ALL ON TABLE schema_migrations TO trien_khai");

  const url = new URL(db.connectionString);
  url.username = "trien_khai";
  url.password = "mat-khau-trien-khai";
  return url.toString();
}

/** Đổi user/password của một connection string, giữ nguyên host/port/database. */
function doiNguoiDung(pChuoiKetNoi: string, pTenRole: string, pMatKhau: string): string {
  const url = new URL(pChuoiKetNoi);
  url.username = pTenRole;
  url.password = pMatKhau;
  return url.toString();
}

interface MembershipConLai {
  nhom: string;
  thanh_vien: string;
  admin_option: boolean;
}

/**
 * [CR2-T3] Mọi tư cách thành viên còn sót chạm tới BỐN role được canh — hai role ứng dụng và
 * hai role đăng nhập được đưa vào danh sách trắng. Đọc cả `admin_option` vì một membership
 * hợp lệ kèm ADMIN OPTION vẫn là bàn đạp: chủ thể đó tự cấp được app_api cho bất kỳ ai.
 */
const CAU_MEMBERSHIP_CON_LAI =
  "SELECT nhom.rolname AS nhom, thanh_vien.rolname AS thanh_vien, am.admin_option " +
  "  FROM pg_auth_members am " +
  "  JOIN pg_roles nhom ON nhom.oid = am.roleid " +
  "  JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member " +
  " WHERE nhom.rolname IN ('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login') " +
  "    OR thanh_vien.rolname IN ('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login') " +
  " ORDER BY 1, 2";

/**
 * [fix round 4] Ba đường trôi GRANT mà vòng 3 để hở, đọc thẳng từ catalog:
 *   a — app_api có USAGE trên schema app_private (tháo hàng rào của mọi hàm nhạy cảm sau này)
 *   b — PUBLIC có EXECUTE trên app_current_org_id() (lật ngược bản vá S2 của vòng 2)
 *   c — app_api có CREATE trên schema public
 * proacl IS NULL nghĩa là ACL mặc định, trong đó PUBLIC CÓ EXECUTE — nên NULL phải đọc ra
 * true ở cột b, không phải "không có dòng cấp nào nên coi như đã thu hồi".
 */
const CAU_TRUY_VAN_TROI =
  "SELECT has_schema_privilege('app_api','app_private','USAGE') AS a, " +
  "(SELECT p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) x " +
  "   WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') " +
  " FROM pg_proc p WHERE p.oid = to_regprocedure('public.app_current_org_id()')) AS b, " +
  "has_schema_privilege('app_api','public','CREATE') AS c";

// Không gắn mã [INV-*] cho các test dưới đây: TEST-PLAN §2 nhóm F (F1: ràng buộc org_id
// qua RLS) và nhóm B (B4: REVOKE UPDATE/DELETE trên audit_events) là bất biến mà migration
// này CHUẨN BỊ nền tảng cho — hàm app_current_org_id() và việc tước BYPASSRLS của hai role
// sẽ được các policy RLS/bảng audit_events ở migration sau dựa vào — nhưng migration 001
// chưa tạo bảng nào có org_id hay bảng audit_events. F1 đòi hỏi kiểm chứng bằng cách kết
// nối với app.org_id khác nhau trên một bảng có RLS thật rồi thấy 0 hàng; test ở đây không
// làm việc đó, nó chỉ kiểm chứng tiền đề "role không có khả năng bypass RLS ngay từ đầu".
// Gắn [INV-F1] hoặc [INV-B4] ở đây sẽ là bằng chứng giả — đúng loại sự cố mà Task 7 mắc
// phải khi gắn [INV-G2] cho một test kiểm chứng thứ khác. Test thật cho F1/B4 thuộc về các
// migration tạo bảng nghiệp vụ đầu tiên.
describe("migration của dự án", () => {
  it("áp dụng sạch trên cơ sở dữ liệu trống", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('app_api', 'app_unseal') ORDER BY rolname",
      );
      expect(rows.map((r) => r.rolname)).toEqual(["app_api", "app_unseal"]);
    });
  });

  it("app_current_org_id trả NULL khi chưa gắn tổ chức — fail-closed", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    });
  });

  // [fix round 2] Test đối kháng thật cho S1: dựng sẵn app_api với BYPASSRLS + SUPERUSER +
  // LOGIN (mô phỏng role dùng chung cluster, ops tạo tay, hoặc quên gỡ sau khi debug), rồi
  // chạy migration thật của dự án và khẳng định các đặc quyền đó bị tước sạch. Nếu migration
  // quay lại dùng "IF NOT EXISTS ... CREATE ROLE" mà không ALTER lại, test này đỏ vì role
  // vẫn giữ BYPASSRLS. Đã gộp thêm khẳng định rolconfig = NULL và pg_auth_members = 0 vào
  // ĐÚNG test đối kháng này (bản trước có một test riêng khẳng định hai điều đó trên DB
  // TRỐNG — controller chỉ ra decorative thật: CREATE ROLE ... NOLOGIN trên DB trống đã cho
  // mọi cờ false sẵn, không cần ALTER ROLE nào cũng qua được; tự mutation-test xác nhận đúng
  // vậy nên đã bỏ test đó, gộp khẳng định có ý nghĩa vào đây — nơi DB đã bị "bẩn" trước).
  it("[fix S1] tước BYPASSRLS/SUPERUSER/LOGIN khỏi role app_api đã tồn tại từ trước trên cluster", async () => {
    const db = await startPostgres();
    try {
      await db.pool.query(
        "CREATE ROLE app_api LOGIN BYPASSRLS SUPERUSER PASSWORD 'mat-khau-cu-tu-lan-debug-truoc'",
      );

      await migrate(db.pool, MIGRATIONS_DIR);

      const { rows } = await db.pool.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolconfig: string[] | null;
      }>(
        "SELECT rolsuper, rolbypassrls, rolcanlogin, rolconfig FROM pg_roles " +
          "WHERE rolname = 'app_api'",
      );

      expect(rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        rolconfig: null,
      });

      const { rowCount } = await db.pool.query(
        "SELECT 1 FROM pg_auth_members m " +
          "JOIN pg_roles a ON a.oid = m.roleid " +
          "JOIN pg_roles b ON b.oid = m.member " +
          "WHERE a.rolname IN ('app_api', 'app_unseal') OR b.rolname IN ('app_api', 'app_unseal')",
      );
      expect(rowCount).toBe(0);
    } finally {
      await db.stop();
    }
  });

  // [fix I5] "ALTER ROLE ... RESET ALL" (không IN DATABASE) chỉ xoá rolconfig áp dụng CHO
  // MỌI database, lưu ở pg_roles.rolconfig — không đụng tới membership. Dựng sẵn tư cách
  // thành viên của một nhóm có quyền đọc bảng nhạy cảm KHÔNG liên quan gì tới app_api, rồi
  // khẳng định migration cắt đứt đường kế thừa quyền đó.
  it("[fix I5] gỡ tư cách thành viên nhóm cũ khỏi app_api để không kế thừa quyền dư thừa", async () => {
    const db = await startPostgres();
    try {
      await db.pool.query("CREATE ROLE app_api NOLOGIN");
      await db.pool.query("CREATE ROLE nhom_cu_khong_lien_quan NOLOGIN");
      await db.pool.query("CREATE TABLE bang_bi_mat_cu (id int)");
      await db.pool.query("INSERT INTO bang_bi_mat_cu VALUES (1)");
      await db.pool.query("GRANT SELECT ON bang_bi_mat_cu TO nhom_cu_khong_lien_quan");
      await db.pool.query("GRANT nhom_cu_khong_lien_quan TO app_api");

      // Xác nhận lỗ hổng có thật TRƯỚC khi migrate — không giả định, đo trực tiếp.
      const clientTruoc = await db.pool.connect();
      try {
        await clientTruoc.query("SET ROLE app_api");
        const { rowCount } = await clientTruoc.query("SELECT * FROM bang_bi_mat_cu");
        expect(rowCount).toBe(1);
      } finally {
        await clientTruoc.query("RESET ROLE");
        clientTruoc.release();
      }

      await migrate(db.pool, MIGRATIONS_DIR);

      const clientSau = await db.pool.connect();
      try {
        await clientSau.query("SET ROLE app_api");
        await expect(clientSau.query("SELECT * FROM bang_bi_mat_cu")).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await clientSau.query("RESET ROLE");
        clientSau.release();
      }
    } finally {
      await db.stop();
    }
  });

  // [fix I5] "ALTER ROLE ... RESET ALL" (không IN DATABASE) KHÔNG đụng tới cấu hình đặt
  // riêng cho một database cụ thể qua "ALTER ROLE ... IN DATABASE d SET ..." — lưu ở
  // pg_db_role_setting, một bảng khác hẳn pg_roles.rolconfig.
  //
  // [fix round 4] Sửa phát biểu SAI của vòng trước ở đây: row_security=off KHÔNG "tắt hẳn
  // RLS cho phiên đó". Đã đo thật với app_api (không sở hữu bảng, không BYPASSRLS): truy
  // vấn bảng có RLS BÁO LỖI "query would be affected by row-level security policy for table
  // \"bi_mat\"", không đọc lọt hàng nào. Nó chỉ thật sự bỏ qua RLS cho ai vốn đã được miễn
  // (chủ sở hữu bảng, role BYPASSRLS). Vẫn phải RESET — một cấu hình an ninh trôi vào role
  // ứng dụng không ai cố ý đặt, và hậu quả là sự cố sẵn sàng ở mọi truy vấn chạm bảng có
  // RLS — nhưng lý do là VẬY, không phải "bypass RLS".
  it("[fix I5] xoá cấu hình IN DATABASE (vd. row_security=off) đặt sẵn trước migration", async () => {
    const db = await startPostgres();
    try {
      await db.pool.query("CREATE ROLE app_api NOLOGIN");
      const { rows: dbRows } = await db.pool.query<{ ten_db: string }>(
        "SELECT current_database() AS ten_db",
      );
      const tenDb = dbRows[0]!.ten_db;
      await db.pool.query(`ALTER ROLE app_api IN DATABASE "${tenDb}" SET row_security = off`);

      await migrate(db.pool, MIGRATIONS_DIR);

      const { rows } = await db.pool.query<{ setconfig: string[] | null }>(
        "SELECT s.setconfig FROM pg_db_role_setting s " +
          "JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'app_api'",
      );
      expect(rows[0]?.setconfig ?? null).toBeNull();
    } finally {
      await db.stop();
    }
  });

  // [fix I2] Bản vá I5 vòng trước chỉ REVOKE khi app_api/app_unseal là THÀNH VIÊN của nhóm
  // khác (chiều "vào"). Chiều ngược sống sót: một role KHÁC được cấp membership VÀO app_api/
  // app_unseal ("GRANT app_api TO ke_tan_cong") thì kế thừa mọi quyền của app_api/app_unseal.
  // Test [fix S1] đã khẳng định pg_auth_members = 0 hàng cho CẢ HAI chiều (WHERE ... OR ...)
  // nhưng fixture của nó chỉ dựng chiều "vào" — nửa khẳng định kia rỗng ruột. Test riêng này
  // dựng ĐÚNG chiều "ra" để không còn góc mù đó.
  it("[fix I2] gỡ tư cách thành viên CHIỀU NGƯỢC — role khác được cấp membership vào app_api/app_unseal", async () => {
    const db = await startPostgres();
    try {
      await db.pool.query("CREATE ROLE app_api NOLOGIN");
      await db.pool.query("CREATE ROLE app_unseal NOLOGIN");
      await db.pool.query("CREATE ROLE ke_tan_cong NOLOGIN");
      await db.pool.query("GRANT app_api TO ke_tan_cong");
      await db.pool.query("GRANT app_unseal TO ke_tan_cong");

      await migrate(db.pool, MIGRATIONS_DIR);

      const { rowCount } = await db.pool.query(
        "SELECT 1 FROM pg_auth_members m " +
          "JOIN pg_roles a ON a.oid = m.roleid " +
          "JOIN pg_roles b ON b.oid = m.member " +
          "WHERE a.rolname IN ('app_api', 'app_unseal') OR b.rolname IN ('app_api', 'app_unseal')",
      );
      expect(rowCount).toBe(0);
    } finally {
      await db.stop();
    }
  });

  // [fix I3] Mọi cưỡng chế S1/I2/I5 trước đây chỉ đúng TẠI THỜI ĐIỂM migration chạy lần đầu
  // — sau triển khai, một ALTER ROLE thủ công để gỡ lỗi (rồi quên gỡ lại) không bị phát hiện
  // hay tự sửa vì 001 đã ghi trong schema_migrations, không chạy lại. Test này gọi migrate()
  // HAI LẦN: lần đầu bootstrap sạch, sau đó dựng trôi thủ công (mô phỏng đúng kịch bản nêu
  // trên), rồi gọi migrate() LẦN HAI (không có migration đánh số mới nào để áp dụng) và
  // khẳng định trôi đã bị hardening.always.sql tự sửa lại.
  it("[fix I3] hardening tự sửa trôi cấu hình role ở lần gọi migrate() sau, không chỉ lúc bootstrap", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // Mô phỏng ai đó "gỡ lỗi" bằng BYPASSRLS sau triển khai rồi quên tắt lại.
      await db.pool.query("ALTER ROLE app_api BYPASSRLS");

      const ketQuaLan2 = await migrate(db.pool, MIGRATIONS_DIR);
      expect(ketQuaLan2).toEqual([]); // không có migration đánh số mới — 001 đã áp dụng rồi

      const { rows } = await db.pool.query<{ rolbypassrls: boolean }>(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_api'",
      );
      expect(rows[0]?.rolbypassrls).toBe(false);
    } finally {
      await db.stop();
    }
  });

  // [fix S2] Lớp REVOKE/GRANT theo hàm: PUBLIC mặc định có EXECUTE trên MỌI hàm mới, kể cả
  // app_current_org_id() vừa tạo — thu hồi tường minh rồi chỉ cấp lại cho hai role cần dùng.
  // Khẳng định bằng cách thử với một role KHÔNG PHẢI app_api/app_unseal.
  it("[fix S2] PUBLIC không còn EXECUTE trên app_current_org_id() sau khi migration REVOKE tường minh", async () => {
    await withMigratedDatabase(async (db) => {
      await db.pool.query("CREATE ROLE vai_tro_khong_lien_quan NOLOGIN");
      const client = await db.pool.connect();
      try {
        await client.query("SET ROLE vai_tro_khong_lien_quan");
        await expect(client.query("SELECT app_current_org_id()")).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await client.query("RESET ROLE");
        client.release();
      }
    });
  });

  // [fix S2] Lớp schema: app_private không cấp USAGE cho app_api/app_unseal, nên bất kỳ hàm
  // nào migration sau đặt vào đây đều không gọi trực tiếp được — kể cả khi PUBLIC vẫn "có"
  // EXECUTE theo mặc định cứng của Postgres (không ai REVOKE riêng cho hàm này). Mô phỏng
  // đúng kịch bản "migration sau quên REVOKE cho một hàm nhạy cảm mới".
  it("[fix S2] hàm mới trong schema app_private không gọi trực tiếp được bởi app_api dù quên REVOKE EXECUTE khỏi PUBLIC", async () => {
    await withMigratedDatabase(async (db) => {
      await db.pool.query(
        "CREATE FUNCTION app_private.ham_nhay_cam_gia_lap() RETURNS int " +
          "LANGUAGE sql AS $$ SELECT 777 $$",
      );

      const apiPool = db.poolAs("app_api");
      await expect(apiPool.query("SELECT app_private.ham_nhay_cam_gia_lap()")).rejects.toThrow(
        /permission denied for schema/,
      );
    });
  });

  // [fix S3] Đột biến trực tiếp: nếu ai đó bỏ "pg_catalog." trước current_setting trong
  // app_current_org_id(), hàm này sẽ dùng CURRENT_SETTING theo search_path của người gọi.
  // Dựng sẵn public.current_setting giả (trả UUID cố định dễ nhận biết) và đặt search_path
  // ưu tiên public — nếu bản vá đúng, app_current_org_id() vẫn đọc app.org_id thật, không bị
  // hàm giả "cướp". Đã tự kiểm chứng bằng Postgres 16 thật trước khi viết test này.
  it("[fix S3] app_current_org_id() không bị public.current_setting giả mạo cướp khi search_path ưu tiên public", async () => {
    await withMigratedDatabase(async (db) => {
      await db.pool.query(
        "CREATE FUNCTION public.current_setting(text, boolean) RETURNS text " +
          "LANGUAGE sql AS $$ SELECT 'deadbeef-dead-4ead-9ead-beefdeadbeef' $$",
      );

      const client = await db.pool.connect();
      try {
        await client.query("SET search_path = public, pg_catalog");
        await client.query("SET app.org_id = '11111111-1111-1111-1111-111111111111'");
        const { rows } = await client.query<{ org: string }>(
          "SELECT app_current_org_id() AS org",
        );
        expect(rows[0]?.org).toBe("11111111-1111-1111-1111-111111111111");
      } finally {
        await client.query("RESET search_path");
        await client.query("RESET app.org_id");
        client.release();
      }
    });
  });

  // [fix S3] Đột biến trực tiếp: nếu ai đó thêm "SET search_path = ..." vào định nghĩa hàm
  // (cách sửa SAI mà brief ban đầu cảnh báo), Postgres không còn nội tuyến (inline) được hàm
  // vào biểu thức truy vấn — mất khả năng dùng hàm như một giá trị có thể đẩy vào Index Cond
  // của trình lập kế hoạch. Dựng bảng có chỉ mục, ép không cho seq scan, rồi đọc thẳng văn
  // bản kế hoạch: nếu app_current_org_id() còn nội tuyến, EXPLAIN cho ra chính biểu thức bên
  // trong hàm (NULLIF/current_setting) ngay trong Index Cond thay vì lời gọi hàm như hộp đen.
  it("[fix S3] app_current_org_id() vẫn được Postgres nội tuyến vào Index Cond, không mất chỉ mục", async () => {
    await withMigratedDatabase(async (db) => {
      const client = await db.pool.connect();
      try {
        await client.query(
          "CREATE TABLE bang_kiem_tra_inline (id serial PRIMARY KEY, org_id uuid)",
        );
        await client.query(
          "INSERT INTO bang_kiem_tra_inline (org_id) " +
            "SELECT gen_random_uuid() FROM generate_series(1, 2000)",
        );
        await client.query(
          "CREATE INDEX idx_bang_kiem_tra_inline_org ON bang_kiem_tra_inline (org_id)",
        );
        await client.query("ANALYZE bang_kiem_tra_inline");
        await client.query("SET app.org_id = '11111111-1111-1111-1111-111111111111'");
        await client.query("SET enable_seqscan = off");

        const { rows } = await client.query<{ "QUERY PLAN": string }>(
          "EXPLAIN (COSTS OFF) SELECT * FROM bang_kiem_tra_inline WHERE org_id = app_current_org_id()",
        );
        const vanBanKeHoach = rows.map((r) => r["QUERY PLAN"]).join("\n");

        expect(vanBanKeHoach).toContain("Index Scan");
        // Bằng chứng nội tuyến thật: biểu thức BÊN TRONG hàm xuất hiện trực tiếp trong kế
        // hoạch — không phải chỉ tên hàm như một lời gọi hộp đen.
        expect(vanBanKeHoach).toContain("current_setting");
      } finally {
        await client.query("RESET enable_seqscan");
        await client.query("RESET app.org_id");
        client.release();
      }
    });
  });

  // [fix S4] Chốt hồi quy: nếu ai đó vô tình thêm lại "CREATE EXTENSION pgcrypto", test này
  // phải đỏ. Trước bản vá vòng này, không test nào phủ việc pgcrypto KHÔNG được cài.
  it("[fix S4] pgcrypto không được cài bởi migration", async () => {
    await withMigratedDatabase(async (db) => {
      const { rowCount } = await db.pool.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'",
      );
      expect(rowCount).toBe(0);
    });
  });

  // ==========================================================================
  // [fix round 4 — N2] Ba nhánh của khuôn "khoan dung với quyền, nghiêm khắc với trôi".
  // Vòng 3 biến migrate() thành thao tác ĐÒI SUPERUSER ở mọi lần gọi mà không công bố ở
  // đâu. Ba test dưới đây khoá cả ba nhánh; nếu biểu thức "trạng thái đã đúng" bị viết lỏng
  // thì nhánh 2 đỏ, nếu khoan dung quá tay thì nhánh 3 đỏ, nếu bỏ khoan dung thì nhánh 1 đỏ.
  // ==========================================================================

  it("[fix round 4 — N2] nhánh 1: KHÔNG trôi + role deploy không phải superuser → migrate() QUA", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR); // bootstrap bằng superuser, đúng một lần
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);

      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Không có migration đánh số mới nào — nhưng hardening.always.sql vẫn chạy. Trước
        // bản vá vòng 4 chỗ này ném "permission denied to alter role".
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);
      } finally {
        await poolTrienKhai.end();
      }
    } finally {
      await db.stop();
    }
  });

  it("[fix round 4 — N2] nhánh 2: CÓ trôi + role deploy không phải superuser → migrate() GÃY, nêu rõ cờ sai và quyền cần", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);

      // Trôi thật, đúng kịch bản S1: ai đó bật BYPASSRLS để gỡ lỗi rồi quên tắt.
      await db.pool.query("ALTER ROLE app_api BYPASSRLS");

      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Không được im lặng đi tiếp: trôi có thật và role deploy không sửa nổi.
        const loi = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi).not.toBeNull();
        expect(loi!.message).toContain("thuộc tính role app_api");
        expect(loi!.message).toContain("BYPASSRLS"); // cờ nào đang sai
        expect(loi!.message).toContain("Cần quyền"); // cần quyền gì để sửa
      } finally {
        await poolTrienKhai.end();
      }

      // Và trôi vẫn còn nguyên — migrate() gãy chứ không âm thầm "sửa được một nửa".
      const { rows } = await db.pool.query<{ rolbypassrls: boolean }>(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_api'",
      );
      expect(rows[0]?.rolbypassrls).toBe(true);
    } finally {
      await db.stop();
    }
  });

  it("[fix round 4 — N2] nhánh 3: CÓ trôi + role deploy là superuser → migrate() SỬA ĐƯỢC", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("ALTER ROLE app_api BYPASSRLS");

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ rolbypassrls: boolean }>(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_api'",
      );
      expect(rows[0]?.rolbypassrls).toBe(false);
    } finally {
      await db.stop();
    }
  });

  // [fix round 4] Ba đường trôi mà vòng 3 để hở. Đo trước khi vá: cả ba đều SỐNG SÓT qua
  // migrate() lần hai. Gộp vào một test vì chúng là cùng một lớp lỗ hổng (GRANT sau triển
  // khai không bị thu hồi lại) và cùng một bản vá (các dòng mới trong hardening.always.sql).
  it("[fix round 4] thu hồi lại ba đường trôi GRANT ở lần migrate() sau: app_private, EXECUTE cho PUBLIC, CREATE trên public", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      await db.pool.query("GRANT USAGE ON SCHEMA app_private TO app_api");
      await db.pool.query("GRANT EXECUTE ON FUNCTION app_current_org_id() TO PUBLIC");
      await db.pool.query("GRANT ALL ON SCHEMA public TO app_api");

      // Xác nhận trôi có thật TRƯỚC khi migrate lần hai — không giả định, đo trực tiếp.
      const truoc = await db.pool.query<{ a: boolean; b: boolean; c: boolean }>(CAU_TRUY_VAN_TROI);
      expect(truoc.rows[0]).toEqual({ a: true, b: true, c: true });

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<{ a: boolean; b: boolean; c: boolean }>(CAU_TRUY_VAN_TROI);
      expect(sau.rows[0]).toEqual({ a: false, b: false, c: false });

      // Thu hồi rồi thì hai role vẫn phải dùng được hàm — không "sửa" thành gãy ứng dụng.
      const apiPool = db.poolAs("app_api");
      const { rows } = await apiPool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    } finally {
      await db.stop();
    }
  });

  // [fix round 4 — N3] Role bị DROP rồi tạo lại giữa hai lần migrate(): hardening vòng 3
  // chữa được các CỜ của role mới, nhưng mọi GRANT do 001 cấp thì không bao giờ trở lại vì
  // 001 đã nằm trong schema_migrations. Kết quả là app_api tồn tại, đúng cờ, mà
  // has_function_privilege(...) = false — ứng dụng gãy im lặng ở mọi policy RLS.
  it("[fix round 4 — N3] app_api bị DROP rồi tạo lại vẫn lấy lại được USAGE public và EXECUTE app_current_org_id()", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // DROP OWNED BY thu hồi mọi quyền đã cấp cho role trong database này — đúng thứ xảy ra
      // khi ops xoá rồi tạo lại role.
      await db.pool.query("DROP OWNED BY app_api");
      await db.pool.query("DROP ROLE app_api");

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ e: boolean; u: boolean }>(
        "SELECT has_function_privilege('app_api','public.app_current_org_id()','EXECUTE') AS e, " +
          "has_schema_privilege('app_api','public','USAGE') AS u",
      );
      expect(rows[0]).toEqual({ e: true, u: true });

      // Và dùng được thật, không chỉ đúng trên giấy catalog.
      const apiPool = db.poolAs("app_api");
      const ketQua = await apiPool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(ketQua.rows[0]?.org).toBeNull();
    } finally {
      await db.stop();
    }
  });

  // [fix round 4 — Minor] "CREATE SCHEMA IF NOT EXISTS app_private" có trong 001 nhưng
  // không test nào phủ nó: xoá dòng đó đi thì không test nào đỏ (đột biến M6 sống sót).
  // Test [fix S2] về app_private tự tạo hàm trong schema đó nên nó đỏ vì lý do khác — lỗi
  // dựng fixture, không phải khẳng định về hàng rào. Test này khẳng định thẳng: schema tồn
  // tại VÀ hai role không có quyền gì trên nó.
  it("[fix round 4] schema app_private tồn tại và app_api/app_unseal không có USAGE lẫn CREATE trên nó", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{
        co_schema: boolean;
        api_usage: boolean;
        api_create: boolean;
        unseal_usage: boolean;
        unseal_create: boolean;
      }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_private') AS co_schema, " +
          "has_schema_privilege('app_api','app_private','USAGE') AS api_usage, " +
          "has_schema_privilege('app_api','app_private','CREATE') AS api_create, " +
          "has_schema_privilege('app_unseal','app_private','USAGE') AS unseal_usage, " +
          "has_schema_privilege('app_unseal','app_private','CREATE') AS unseal_create",
      );
      expect(rows[0]).toEqual({
        co_schema: true,
        api_usage: false,
        api_create: false,
        unseal_usage: false,
        unseal_create: false,
      });
    });
  });

  // ==========================================================================
  // [fix round 5] Vòng 4 fail-closed đúng chỗ nhưng sai thời điểm: nó xen kẽ "sửa" và
  // "phán xét", nên vài trôi TỰ CHỮA ĐƯỢC thành KẸT VĨNH VIỄN. Bảy test dưới đây khoá từng
  // ca một; tất cả đều có dạng "dựng trôi -> migrate() QUA -> trạng thái đã được phục hồi".
  // ==========================================================================

  // [fix round 5 — R1] Trôi qua NHÓM: app_api không được cấp trực tiếp gì trên app_private,
  // nó thừa hưởng USAGE từ nhom_xau. Vòng 4 chạy khối cưỡng chế TRƯỚC khối gỡ membership
  // nên hậu điều kiện bắt được quyền kế thừa trước khi nhóm kịp bị gỡ, rồi cả transaction
  // rollback — đo thật: "migrate -> GÃY, sau: {u:true, mem:true}", và thông báo bảo người
  // vận hành cần SUPERUSER trong khi họ ĐANG là superuser.
  it("[fix round 5 — R1] trôi qua nhóm tự chữa được: gỡ membership TRƯỚC rồi mới kiểm hậu điều kiện", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("CREATE ROLE nhom_xau NOLOGIN");
      await db.pool.query("GRANT USAGE ON SCHEMA app_private TO nhom_xau");
      await db.pool.query("GRANT nhom_xau TO app_api");

      const truoc = await db.pool.query<{ u: boolean }>(
        "SELECT has_schema_privilege('app_api','app_private','USAGE') AS u",
      );
      expect(truoc.rows[0]?.u).toBe(true); // lỗ hổng có thật, đo trực tiếp

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<{ u: boolean; mem: boolean }>(
        "SELECT has_schema_privilege('app_api','app_private','USAGE') AS u, " +
          "EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles b ON b.oid = m.member " +
          "WHERE b.rolname = 'app_api') AS mem",
      );
      expect(sau.rows[0]).toEqual({ u: false, mem: false });
    } finally {
      await db.stop();
    }
  });

  // [fix round 5 — R2] has_schema_privilege TÍNH CẢ quyền đến qua PUBLIC, nhưng vòng 4
  // REVOKE chỉ nhắm hai role. Kết quả là một ngõ cụt: đo thật, migrate GÃY NGAY CẢ DƯỚI
  // SUPERUSER và không bao giờ qua được, vì không câu lệnh nào thu hồi khỏi PUBLIC. Đây
  // chính là MẶC ĐỊNH của schema public trên PostgreSQL < 15 — một dump cũ khôi phục vào là
  // kẹt ngay.
  it("[fix round 5 — R2] trôi cấp cho PUBLIC cũng thu hồi được, không thành ngõ cụt", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
      await db.pool.query("GRANT USAGE ON SCHEMA app_private TO PUBLIC");

      const truoc = await db.pool.query<{ c: boolean; a: boolean }>(
        "SELECT has_schema_privilege('app_api','public','CREATE') AS c, " +
          "has_schema_privilege('app_api','app_private','USAGE') AS a",
      );
      expect(truoc.rows[0]).toEqual({ c: true, a: true });

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<{ c: boolean; a: boolean }>(
        "SELECT has_schema_privilege('app_api','public','CREATE') AS c, " +
          "has_schema_privilege('app_api','app_private','USAGE') AS a",
      );
      expect(sau.rows[0]).toEqual({ c: false, a: false });
    } finally {
      await db.stop();
    }
  });

  // [fix round 5 — R3] Phát hiện nặng nhất của vòng review này. Vòng 4 chỉ kiểm ACL của hàm,
  // không kiểm THÂN hàm — đo thật: sau "CREATE OR REPLACE" thay thân, migrate() báo QUA và
  // app_current_org_id() trả 00000000-0000-4000-8000-000000000001 cho MỌI phiên. Nghĩa là
  // vô hiệu hoá IM LẶNG toàn bộ RLS mà Task 4–10 sẽ dựng lên: mọi policy
  // "USING (org_id = app_current_org_id())" khớp đúng một tổ chức cố định cho tất cả.
  //
  // Thân hàm đối kháng ở đây cố ý BỌC bản gốc bằng COALESCE thay vì thay hẳn: nó vẫn chứa
  // đủ mọi chuỗi con của bản chuẩn (NULLIF, pg_catalog.current_setting, app.org_id) nên một
  // phép kiểm dạng "danh sách chuỗi con" sẽ cho lọt — trong khi nó biến hành vi fail-closed
  // thành fail-open, đúng thứ nguy hiểm nhất.
  it("[fix round 5 — R3] thân hàm app_current_org_id() bị thay (kể cả kiểu bọc fail-open) được cưỡng chế lại", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid " +
          "LANGUAGE sql STABLE AS $ac$ SELECT COALESCE(" +
          "NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid, " +
          "'00000000-0000-4000-8000-000000000001'::uuid) $ac$",
      );

      const truoc = await db.pool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(truoc.rows[0]?.org).toBe("00000000-0000-4000-8000-000000000001"); // fail-open

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // Fail-closed trở lại: chưa gắn tổ chức thì KHÔNG hàng nào khớp, không phải "khớp hết".
      const sau = await db.pool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(sau.rows[0]?.org).toBeNull();
    } finally {
      await db.stop();
    }
  });

  // [fix round 5 — R3] Ba biến thể khác cùng một họ, mỗi cái tấn công một thuộc tính riêng
  // mà hậu điều kiện phải canh — hàm biến mất, hàm mất tính STABLE và thành SECURITY
  // DEFINER, và hàm bị gắn "SET search_path" (mệnh đề chặn inlining: mất inlining là mất
  // chỉ mục trên mọi bảng có RLS).
  it("[fix round 5 — R3] DROP FUNCTION / SECURITY DEFINER / SET search_path đều được cưỡng chế lại", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // [Task 4] Từ khi 002 tạo policy RLS gọi hàm này, chính Postgres từ chối DROP thường:
      // "cannot drop function app_current_org_id() because other objects depend on it".
      // Đây là một lớp bảo vệ MỚI, có được miễn phí nhờ phụ thuộc catalog — không phải do
      // hardening. Khẳng định nó ở đây để nếu ai đó gỡ policy đi (làm hàm lại DROP được),
      // test này đỏ và bắt người sửa phải nhìn lại.
      await expect(db.pool.query("DROP FUNCTION public.app_current_org_id()")).rejects.toThrow(
        /other objects depend on it/i,
      );

      // Đường đi lọt là CASCADE — và nó kéo theo TOÀN BỘ policy. Hàm được hardening dựng lại,
      // nhưng policy thì KHÔNG (002 đã nằm trong schema_migrations). Xem test riêng bên dưới
      // về hình dạng policy: migrate() phải GÃY ỒN ÀO chứ không đi tiếp im lặng.
      await db.pool.query("DROP FUNCTION public.app_current_org_id() CASCADE");
      const loiCascade = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loiCascade).not.toBeNull();
      expect(loiCascade!.message).toContain("hình dạng policy RLS của bảng tenant");

      // Hàm vẫn được dựng lại trong chính lần chạy đó (câu lệnh cưỡng chế ở BƯỚC 2 chạy trước
      // khi BƯỚC 4 ném lỗi) — nhưng cả transaction bị rollback theo, nên phải khôi phục policy
      // rồi mới migrate lại được. Đây chính là đánh đổi đã công bố ở hardening.always.sql.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid LANGUAGE sql STABLE " +
          "AS $ac$ SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid $ac$",
      );
      for (const bang of ["organizations", "users"]) {
        const cot = bang === "organizations" ? "id" : "org_id";
        await db.pool.query(
          `CREATE POLICY ${bang}_tenant_isolation ON ${bang} ` +
            `USING (${cot} = app_current_org_id()) WITH CHECK (${cot} = app_current_org_id())`,
        );
      }
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const sauDrop = await db.pool.query<{ t: string | null }>(
        "SELECT to_regprocedure('public.app_current_org_id()')::text AS t",
      );
      expect(sauDrop.rows[0]?.t).toBe("app_current_org_id()");

      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid " +
          "LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_catalog AS $ac$ " +
          "SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid $ac$",
      );
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{
        provolatile: string;
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        "SELECT provolatile, prosecdef, proconfig FROM pg_proc " +
          "WHERE oid = to_regprocedure('public.app_current_org_id()')",
      );
      expect(rows[0]).toEqual({ provolatile: "s", prosecdef: false, proconfig: null });
    } finally {
      await db.stop();
    }
  });

  // [fix round 5 — R3] Đánh đổi của bản vá R3: định nghĩa hàm nay nằm ở HAI file. Test này
  // là thứ giữ cho đánh đổi đó an toàn — sửa một bên mà quên bên kia thì đỏ ngay, thay vì
  // để hardening âm thầm ghi đè bản trong 001 bằng một bản khác ở mỗi lần deploy.
  // Không cần container: chỉ đọc file.
  it("[fix round 5 — R3] định nghĩa app_current_org_id() trong 001 và trong hardening.always.sql khớp nhau", () => {
    const docThanHam = (tenFile: string): string => {
      const duongDan = fileURLToPath(new URL(`./migrations/${tenFile}`, import.meta.url));
      const noiDung = readFileSync(duongDan, "utf8");
      const khop = [...noiDung.matchAll(/LANGUAGE sql STABLE AS \$(\w*)\$([\s\S]*?)\$\1\$/g)];
      expect(khop).toHaveLength(1); // đúng một định nghĩa mỗi file, không hơn không kém
      return khop[0]![2]!.replace(/\s+/g, " ").trim();
    };

    const than001 = docThanHam("001_roles_and_functions.sql");
    expect(than001).toBe(
      "SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid",
    );
    expect(docThanHam("hardening.always.sql")).toBe(than001);
  });

  // [fix round 5 — R4] Vòng 4 dùng tiền điều kiện "schema tồn tại" cho dòng REVOKE, nên
  // schema mất là bỏ qua luôn — đo thật: migrate QUA, app_private không bao giờ trở lại (001
  // đã nằm trong schema_migrations). Test mới của vòng 4 dùng withMigratedDatabase trên DB
  // mới tinh nên chỉ phủ bootstrap, không phủ ca trôi này.
  it("[fix round 5 — R4] DROP SCHEMA app_private được tạo lại ở lần migrate() sau", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("DROP SCHEMA app_private CASCADE");

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ e: boolean; u: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='app_private') AS e, " +
          "has_schema_privilege('app_api','app_private','USAGE') AS u",
      );
      expect(rows[0]).toEqual({ e: true, u: false });
    } finally {
      await db.stop();
    }
  });

  // [fix round 5 — Minor] pg_db_role_setting còn hàng setrole = 0 — "ALTER DATABASE d SET"
  // áp cho MỌI role. Vòng 4 join r.rolname IN ('app_api','app_unseal') nên bỏ sót hẳn: đo
  // thật, migrate QUA và setconfig còn ["row_security=off"].
  it("[fix round 5] cấu hình đặt ở MỨC DATABASE (setrole = 0) cũng được reset", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: d } = await db.pool.query<{ ten: string }>(
        "SELECT current_database() AS ten",
      );
      const tenDb = d[0]!.ten;
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET row_security = off`);
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET search_path = ke_gian, public`);

      const truoc = await db.pool.query<{ s: string[] | null }>(
        "SELECT setconfig AS s FROM pg_db_role_setting WHERE setrole = 0",
      );
      expect(truoc.rows[0]?.s).toEqual(["row_security=off", "search_path=ke_gian, public"]);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<{ s: string[] | null }>(
        "SELECT setconfig AS s FROM pg_db_role_setting WHERE setrole = 0",
      );
      expect(sau.rows[0]?.s ?? null).toBeNull();
    } finally {
      await db.stop();
    }
  });

  // [fix round 5 — R3] Test PHÁT HIỆN, tách khỏi test PHỤC HỒI ở trên. Cần cả hai vì hai
  // test đó canh hai nửa khác nhau của bản vá và một nửa không suy ra nửa kia:
  //   - test phục hồi canh CÂU LỆNH (CREATE OR REPLACE chạy vô điều kiện ở BƯỚC 2);
  //   - test này canh HẬU ĐIỀU KIỆN (biểu thức "kiem_tra").
  // Tự kiểm chứng bằng đột biến trước khi viết test này: xoá hẳn phép so thân hàm khỏi
  // kiem_tra, hoặc xoá các kiểm provolatile/prosecdef/proconfig, thì test phục hồi VẪN XANH
  // — vì câu lệnh cưỡng chế sửa lại bất kể phép kiểm nói gì. Phép kiểm chỉ trở thành thứ
  // duy nhất còn tác dụng khi role deploy KHÔNG sửa nổi (không sở hữu hàm), và đó chính là
  // kịch bản dựng ở đây: bootstrap bằng superuser (hàm thuộc sở hữu postgres), deploy sau
  // chạy dưới role thường.
  it("[fix round 5 — R3] role deploy không sửa nổi thì thân/thuộc tính hàm sai phải GÃY, không đi tiếp im lặng", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Không trôi: deploy thường vẫn phải QUA (đối chứng cho hai phần dưới).
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);

        // (a) THÂN hàm sai — bọc fail-open, giữ nguyên mọi thuộc tính. Chỉ phép so thân hàm
        //     bắt được ca này.
        await db.pool.query(
          "CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid " +
            "LANGUAGE sql STABLE AS $ac$ SELECT COALESCE(" +
            "NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid, " +
            "'00000000-0000-4000-8000-000000000001'::uuid) $ac$",
        );
        const loiThan = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loiThan).not.toBeNull();
        expect(loiThan!.message).toContain("định nghĩa hàm app_current_org_id()");
        expect(loiThan!.message).toContain("Cần quyền");

        // (b) THUỘC TÍNH sai — thân hàm ĐÚNG nguyên văn bản chuẩn, chỉ đổi VOLATILE +
        //     SECURITY DEFINER + SET search_path. Chỉ các kiểm provolatile/prosecdef/
        //     proconfig bắt được ca này; phép so thân hàm thì không.
        await db.pool.query(
          "CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid " +
            "LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_catalog AS $ac$\n" +
            "  SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid\n" +
            "$ac$",
        );
        const loiThuocTinh = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loiThuocTinh).not.toBeNull();
        expect(loiThuocTinh!.message).toContain("định nghĩa hàm app_current_org_id()");
        expect(loiThuocTinh!.message).toContain("secdef=true");
      } finally {
        await poolTrienKhai.end();
      }
    } finally {
      await db.stop();
    }
  });

  // ==========================================================================
  // [CR2-T3] BƯỚC 1 của hardening trước đây gỡ MỌI membership chạm tới app_api/app_unseal,
  // kể cả membership HỢP LỆ. Vì cả 001 lẫn hardening đều cưỡng chế hai role đó là NOLOGIN,
  // cách DUY NHẤT để ứng dụng hành động dưới danh nghĩa app_api là một role ĐĂNG NHẬP là
  // thành viên của nó — đúng thứ bị BƯỚC 1 xoá ở MỌI lần migrate(). Nghĩa là kiến trúc role
  // mà chính 001 mô tả không dựng được.
  //
  // Bản vá: BƯỚC 1 phân biệt bằng một DANH SÁCH TRẮNG CẶP ĐÓNG viết thẳng trong SQL —
  // (app_api, app_api_login) và (app_unseal, app_unseal_login), và chỉ khi membership đó
  // KHÔNG kèm ADMIN OPTION. Mọi membership khác chạm tới bốn role được canh đều bị gỡ.
  //
  // Rủi ro đã biết của mọi danh sách trắng: viết rộng quá thì một membership độc lọt qua.
  // Test này là mặt đối kháng của rủi ro đó — nó dựng NĂM biến thể membership lạ, mỗi biến
  // thể tấn công một cách nới lỏng khác nhau mà một bản vá ẩu sẽ mắc phải:
  //   (1) tên bắt chước giao ước "*_login" nhưng không có trong danh sách — bản vá dựa vào
  //       HẬU TỐ thay vì danh sách cặp sẽ cho lọt;
  //   (2) đúng hai role trong danh sách nhưng SAI CẶP (app_api_login vào app_unseal) — bản
  //       vá miễn trừ theo TẬP ROLE thay vì theo CẶP sẽ cho lọt;
  //   (3) bắc cầu VÀO: app_api_login là thành viên của một nhóm bất kỳ — bản vá chỉ canh
  //       app_api/app_unseal (không mở rộng vùng canh sang chính role đăng nhập) sẽ cho lọt,
  //       và nhóm đó cho app_api_login mọi quyền của nó;
  //   (4) bắc cầu RA: một role khác là thành viên của app_api_login — kế thừa bắc cầu toàn
  //       bộ quyền của app_api;
  //   (5) đúng cặp hợp lệ nhưng kèm ADMIN OPTION — app_api_login tự cấp được app_api cho
  //       bất kỳ ai, biến một miễn trừ hẹp thành bàn đạp.
  // Cả năm phải bị gỡ; đúng hai cặp hợp lệ phải còn nguyên. Đó là hai chiều của cùng một
  // phép đo, cố ý gộp vào MỘT khẳng định về TẬP membership còn lại để không có góc mù.
  it("[CR2-T3] giữ membership hợp lệ của role đăng nhập dự án và gỡ mọi membership lạ", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // Hợp lệ — đây chính là cách duy nhất ứng dụng chạy được dưới danh nghĩa app_api.
      await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api' IN ROLE app_api");
      await db.pool.query(
        "CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk-unseal' IN ROLE app_unseal",
      );

      // (1) bắt chước giao ước đặt tên
      await db.pool.query("CREATE ROLE ke_gian_login NOLOGIN");
      await db.pool.query("GRANT app_api TO ke_gian_login");
      // (2) sai cặp
      await db.pool.query("GRANT app_unseal TO app_api_login");
      // (3) bắc cầu vào
      await db.pool.query("CREATE ROLE nhom_xau NOLOGIN");
      await db.pool.query("GRANT nhom_xau TO app_api_login");
      // (4) bắc cầu ra
      await db.pool.query("CREATE ROLE ke_tan_cong NOLOGIN");
      await db.pool.query("GRANT app_api_login TO ke_tan_cong");
      // (5) đúng cặp nhưng kèm ADMIN OPTION
      await db.pool.query("GRANT app_api TO app_api_login WITH ADMIN OPTION");

      const truoc = await db.pool.query<MembershipConLai>(CAU_MEMBERSHIP_CON_LAI);
      expect(truoc.rows).toHaveLength(6); // 2 hợp lệ + 4 lạ (cặp (5) trùng cặp hợp lệ)
      expect(
        truoc.rows.find((r) => r.thanh_vien === "app_api_login" && r.nhom === "app_api")
          ?.admin_option,
      ).toBe(true);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<MembershipConLai>(CAU_MEMBERSHIP_CON_LAI);
      expect(sau.rows).toEqual([
        { nhom: "app_api", thanh_vien: "app_api_login", admin_option: false },
        { nhom: "app_unseal", thanh_vien: "app_unseal_login", admin_option: false },
      ]);
    } finally {
      await db.stop();
    }
  });

  // [CR2-T3] Đưa hai role đăng nhập vào danh sách trắng là đưa thêm HAI CHỦ THỂ TIN CẬY vào
  // hệ thống: từ giờ ai chiếm được app_api_login là có mọi quyền của app_api. Vì vậy hardening
  // phải canh luôn thuộc tính của chúng — "ALTER ROLE app_api_login BYPASSRLS" vô hiệu hoá
  // TOÀN BỘ RLS mà Task 4 dựng lên, và một danh sách trắng không kèm phép canh này chỉ dời
  // lỗ hổng sang một cái tên khác.
  //
  // Cố ý KHÔNG cưỡng chế LOGIN/NOLOGIN và KHÔNG đụng tới mật khẩu: hardening không được biến
  // thành thứ làm rớt đăng nhập của ứng dụng đang chạy. Test khẳng định cả hai vế — đặc quyền
  // bị tước VÀ role vẫn đăng nhập được bằng đúng mật khẩu cũ.
  it("[CR2-T3] tước SUPERUSER/BYPASSRLS khỏi role đăng nhập dự án mà không làm mất khả năng đăng nhập", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "CREATE ROLE app_api_login LOGIN BYPASSRLS SUPERUSER CREATEDB CREATEROLE NOINHERIT " +
          "PASSWORD 'mk-api' IN ROLE app_api",
      );

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolcanlogin: boolean;
      }>(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin " +
          "FROM pg_roles WHERE rolname = 'app_api_login'",
      );
      expect(rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: true,
        rolcanlogin: true,
      });

      // Đăng nhập thật, không chỉ đúng trên giấy catalog.
      const poolDangNhap = createPool(doiNguoiDung(db.connectionString, "app_api_login", "mk-api"), 2);
      try {
        const { rows: r } = await poolDangNhap.query<{ u: string }>(
          "SELECT current_user AS u",
        );
        expect(r[0]?.u).toBe("app_api_login");
      } finally {
        await poolDangNhap.end();
      }
    } finally {
      await db.stop();
    }
  });

  // [CR2-T3] Cùng lớp trôi với [fix I5] nhưng trên hai chủ thể mới: cấu hình phiên gắn vào
  // role đăng nhập (toàn cụm qua pg_roles.rolconfig, và riêng database qua
  // pg_db_role_setting). Hai bảng catalog KHÁC NHAU, "RESET ALL" trần chỉ chạm bảng thứ nhất.
  it("[CR2-T3] xoá rolconfig toàn cụm và cấu hình IN DATABASE của role đăng nhập dự án", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: d } = await db.pool.query<{ ten: string }>("SELECT current_database() AS ten");
      const tenDb = d[0]!.ten;

      await db.pool.query("CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk' IN ROLE app_unseal");
      await db.pool.query("ALTER ROLE app_unseal_login SET search_path = ke_gian, public");
      await db.pool.query(
        `ALTER ROLE app_unseal_login IN DATABASE "${tenDb}" SET row_security = off`,
      );

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ toan_cum: string[] | null; trong_db: string[] | null }>(
        "SELECT r.rolconfig AS toan_cum, " +
          "(SELECT s.setconfig FROM pg_db_role_setting s " +
          "  WHERE s.setrole = r.oid " +
          "    AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())" +
          ") AS trong_db " +
          "FROM pg_roles r WHERE r.rolname = 'app_unseal_login'",
      );
      expect(rows[0]).toEqual({ toan_cum: null, trong_db: null });
    } finally {
      await db.stop();
    }
  });

  // ==========================================================================
  // [S7b/S11-T3] Trôi ở tầng RLS. Policy và cờ RLS nằm trong migration ĐÁNH SỐ nên chỉ chạy
  // một lần; mọi thay đổi sau triển khai trước đây tồn tại vĩnh viễn và không gì phát hiện.
  // ==========================================================================

  // (A) Cờ RLS: TỰ CHỮA, và cố ý viết TỔNG QUÁT theo pg_attribute nên bảng của mọi task sau
  // được phủ mà không ai phải thêm dòng nào. Test dựng cả hai nửa của cùng lớp trôi — tắt hẳn
  // RLS, và bỏ riêng FORCE — trên cả bảng có org_id lẫn bảng gốc của cây tenant.
  it("[INV-F1] hardening bật lại ENABLE/FORCE ROW LEVEL SECURITY bị tắt sau triển khai", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("ALTER TABLE users DISABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY");

      const truoc = await db.pool.query<{ ten: string; bat: boolean; cuong_che: boolean }>(
        "SELECT relname AS ten, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
          "FROM pg_class WHERE relname IN ('users','organizations') ORDER BY 1",
      );
      expect(truoc.rows).toEqual([
        { ten: "organizations", bat: true, cuong_che: false },
        { ten: "users", bat: false, cuong_che: true },
      ]);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<{ ten: string; bat: boolean; cuong_che: boolean }>(
        "SELECT relname AS ten, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
          "FROM pg_class WHERE relname IN ('users','organizations') ORDER BY 1",
      );
      expect(sau.rows).toEqual([
        { ten: "organizations", bat: true, cuong_che: true },
        { ten: "users", bat: true, cuong_che: true },
      ]);
    } finally {
      await db.stop();
    }
  });

  // (A) tiếp: vị từ nhận diện bảng tenant đọc pg_attribute nên nó phủ CẢ BẢNG CHƯA TỒN TẠI ở
  // thời điểm viết file này — đây là nửa "tổng quát" mà một danh sách bảng viết tay sẽ bỏ sót
  // ở mọi task sau. Một bảng mới có org_id, không RLS, không policy phải bị BẮT, không đi lọt.
  //
  // Kết quả ĐO ĐƯỢC: migrate() GÃY chứ không "âm thầm bật hộ rồi đi tiếp". Đó là hành vi ĐÚNG:
  // một bảng có org_id mà không có policy là bảng từ chối tất cả, tức một lược đồ hỏng, và nó
  // chỉ phát sinh khi ai đó tạo bảng bằng tay hoặc viết một migration vi phạm S7b — cả hai đều
  // phải dừng deploy. Ghi lại ở đây để không ai đọc mục (A) như một lời hứa "mọi trôi RLS đều
  // tự chữa": nó tự chữa khi policy còn nguyên, và chỉ khi đó.
  //
  // [vòng fix 1 — I3] Vòng trước ghi thêm ở đây rằng "cả file nằm trong MỘT transaction nên
  // phần (A) đã sửa cũng rollback theo". Điều đó ĐÃ HẾT ĐÚNG và test nay đo ngược lại: lượt SỬA
  // commit trong transaction riêng TRƯỚC lượt PHÁN XÉT, nên cờ RLS mà (A) bật SỐNG SÓT qua lần
  // migrate() gãy. Đây là khẳng định về triệu chứng "fail-closed kéo theo cả sửa chữa thành
  // công" của bẫy Task 3.
  it("[INV-F1] bảng MỚI có org_id mà không RLS, không policy làm migrate() GÃY, không đi lọt", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("CREATE TABLE bang_moi_quen_rls (id int, org_id uuid NOT NULL)");

      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi).not.toBeNull();
      expect(loi!.message).toContain("hình dạng policy RLS của bảng tenant");
      expect(loi!.message).toContain("bang_moi_quen_rls");

      // [vòng fix 1 — I3] Sửa chữa của lượt SỬA không bị phán xét kéo theo.
      const coSua = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bang_moi_quen_rls'",
      );
      expect(
        coSua.rows[0],
        "phán xét hỏng đã rollback luôn phần (A) đã sửa — đúng bẫy 'fail-closed biến trôi tự " +
          "lành thành deploy chặn' của Task 3.",
      ).toEqual({ bat: true, cuong_che: true });

      // Và sau khi bảng có policy đúng khuôn, mục (A) tự bật cờ RLS hộ — nửa "tự chữa" thật sự.
      await db.pool.query(
        "CREATE POLICY bang_moi_quen_rls_tenant_isolation ON bang_moi_quen_rls " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bang_moi_quen_rls'",
      );
      expect(rows[0]).toEqual({ bat: true, cuong_che: true });
    } finally {
      await db.stop();
    }
  });

  // (B) Hình dạng policy: CHỈ PHÁT HIỆN. Ba đột biến, mỗi cái là một dạng bị cấm ở S11-T3 hoặc
  // một cách xoá sạch phòng thủ. Cả ba trước bản vá đều đi qua migrate() mà không ai biết.
  it("[INV-F1] migrate() GÃY khi policy RLS bị sửa sang dạng fail-open hoặc bị xoá", async () => {
    const kichBan: [string, string[]][] = [
      // USING (true): RLS còn bật, còn policy, mà không chặn gì cả.
      ["USING (true)", ["ALTER POLICY users_tenant_isolation ON users USING (true)"]],
      // Dạng bị cấm số (1) của S11-T3 — mở toang đúng lúc chưa gắn tổ chức.
      [
        "app_current_org_id() IS NULL OR ...",
        [
          "ALTER POLICY users_tenant_isolation ON users " +
            "USING (app_current_org_id() IS NULL OR org_id = app_current_org_id())",
        ],
      ],
      // Dạng bị cấm số (2) — cùng lỗ hổng, viết bằng coalesce.
      [
        "coalesce(...)",
        [
          "ALTER POLICY users_tenant_isolation ON users " +
            "USING (org_id = coalesce(app_current_org_id(), org_id))",
        ],
      ],
      // Xoá sạch: bảng còn RLS, không còn policy -> từ chối tất cả, và không bao giờ trở lại.
      ["DROP POLICY", ["DROP POLICY users_tenant_isolation ON users"]],
    ];

    for (const [nhan, cauLenh] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        for (const cau of cauLenh) await db.pool.query(cau);

        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `đột biến "${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("hình dạng policy RLS của bảng tenant");
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 1 — CR1] DANH SÁCH ĐEN -> DANH SÁCH TRẮNG
  // ==========================================================================================
  // Bốn payload dưới đây ĐI LỌT hoàn toàn im lặng (HARDENING_EXIT=0) trên bản trước, và hai
  // reviewer độc lập tìm ra chúng bằng những payload khác nhau. Chẩn đoán đo được và quan
  // trọng: vấn đề KHÔNG phải "regex trên chuỗi thì yếu" — pg_get_expr CHUẨN HOÁ lại cây phân
  // tích, nên "IS NOT DISTINCT FROM NULL" bị deparse thành "IS NULL" và bị bắt, "USING (true)"
  // cũng bị bắt. Vấn đề là LIỆT KÊ CÁI XẤU: phép kiểm cũ chỉ đòi biểu thức NHẮC TỚI
  // app_current_org_id(), nó không đòi biểu thức RÀNG BUỘC gì cả.
  it("[CR1] bốn cách viết lại tương đương ngữ nghĩa của fail-open đều làm migrate() GÃY", async () => {
    const kichBan: [string, string][] = [
      // (1) Hằng true nối bằng OR — vô hiệu hoá toàn bộ vế bên trái.
      ["OR true", "org_id = app_current_org_id() OR true"],
      // (2) ĐÚNG dạng bị cấm số (1) của S11-T3, viết bằng IS DISTINCT FROM. PostgreSQL deparse
      //     nó thành "NOT (... IS NOT NULL)" nên chuỗi "is null" không xuất hiện.
      [
        "IS DISTINCT FROM NULL",
        "org_id = app_current_org_id() OR NOT (app_current_org_id() IS DISTINCT FROM NULL)",
      ],
      // (3) fail-OPEN qua nhánh ELSE của CASE.
      [
        "CASE ... ELSE true",
        "CASE WHEN app_current_org_id()::text > '' THEN org_id = app_current_org_id() ELSE true END",
      ],
      // (4) Cửa hậu tinh vi nhất: fail-CLOSED khi CHƯA gắn tổ chức (nên nó QUA LUÔN mọi test
      //     hành vi hiện có), mở toang khi ĐÃ gắn — tổ chức A đọc được dữ liệu của B.
      [
        "x = x OR ...",
        "app_current_org_id() = app_current_org_id() OR org_id = app_current_org_id()",
      ],
    ];

    for (const [nhan, bieuThuc] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        await db.pool.query(
          `ALTER POLICY users_tenant_isolation ON users USING (${bieuThuc})`,
        );

        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `payload "${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("hình dạng biểu thức KHÔNG nằm trong danh sách được duyệt");
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // (B) Mặt còn lại — không được BÁO NHẦM. Một phép kiểm quá tay biến hardening thành thứ cản
  // trở deploy trên một lược đồ hoàn toàn đúng, và đó là cách nhanh nhất để người vận hành gỡ
  // bỏ nó.
  //
  // [vòng fix 1 — CR1] Rủi ro báo nhầm của khuôn DANH SÁCH TRẮNG khác hẳn khuôn cũ: nó không
  // nằm ở tên cột chứa chuỗi con nữa (không còn regex nào), mà ở chỗ pg_get_expr có deparse ổn
  // định hay không. Ba cách viết dưới đây có CÙNG cây phân tích với policy chuẩn nhưng khác
  // hẳn về mặt văn bản; đã đo trên PostgreSQL 16.15 rằng cả ba deparse ra ĐÚNG MỘT chuỗi.
  // Nếu một phiên bản PostgreSQL sau này đổi cách deparse, test này đỏ TRƯỚC khi production
  // gãy — đó là công việc của nó.
  it("[CR1] các cách viết khác nhau của CÙNG một cây phân tích không bị báo nhầm", async () => {
    const cachViet = [
      "(  org_id   =   app_current_org_id()  )", // khoảng trắng thừa
      "((org_id = app_current_org_id()))", // ngoặc thừa
      "org_id = public.app_current_org_id()", // hàm ghi đủ schema
      "users.org_id = app_current_org_id()", // cột ghi đủ tên bảng
    ];

    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      for (const bieuThuc of cachViet) {
        await db.pool.query(
          `ALTER POLICY users_tenant_isolation ON users USING (${bieuThuc}) ` +
            "WITH CHECK (org_id = app_current_org_id())",
        );
        const { rows } = await db.pool.query<{ e: string }>(
          "SELECT pg_get_expr(polqual, polrelid) AS e FROM pg_policy WHERE polname = 'users_tenant_isolation'",
        );
        expect(rows[0]!.e, `deparse của "${bieuThuc}" không còn ổn định`).toBe(
          "(org_id = app_current_org_id())",
        );
        await expect(
          migrate(db.pool, MIGRATIONS_DIR),
          `cách viết "${bieuThuc}" bị báo nhầm`,
        ).resolves.toEqual([]);
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 1 — CR2] BẢNG CHA PHÂN MẢNH (relkind = 'p')
  // ==========================================================================================
  // Bảng báo giá phân mảnh theo org_id là thiết kế gần như chắc chắn của task sau, nên lỗ này
  // phải đóng TRƯỚC task đó. Test đo HAI nửa, cố ý tách bạch:
  //   (a) LỖ HỔNG CÓ THẬT — với lược đồ viết ĐÚNG KHUÔN PostgreSQL (RLS + policy trên CHA, lá
  //       thừa hưởng), một role đã gắn tổ chức A đọc THẲNG lá của tổ chức B thấy nguyên dữ
  //       liệu của B. Đây là phát hiện MỚI của vòng này: "viết đúng khuôn" vẫn hở, vì lá là
  //       một bảng có tên gọi được.
  //   (b) HARDENING ĐÓNG ĐƯỢC — mục (A) bật ENABLE + FORCE trên CHA lẫn mọi LÁ, và mục (B)
  //       KHÔNG báo nhầm lá vì lá không có policy riêng (đó là khuôn đúng của PostgreSQL).
  it("[CR2] bảng phân mảnh: lá đọc thẳng bỏ qua RLS trước khi vá, hardening bật RLS cho cả cha lẫn lá", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      // Khuôn PostgreSQL chuẩn: RLS + policy đặt trên CHA, không đặt gì trên lá.
      await db.pool.query(
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL, gia int) PARTITION BY LIST (org_id)",
      );
      await db.pool.query(`CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('${orgA}')`);
      await db.pool.query(`CREATE TABLE bao_gia_b PARTITION OF bao_gia FOR VALUES IN ('${orgB}')`);
      await db.pool.query("ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("GRANT SELECT ON bao_gia, bao_gia_a, bao_gia_b TO app_api");
      await db.pool.query(
        `INSERT INTO bao_gia VALUES (1,'${orgA}',100), (2,'${orgB}',999)`,
      );

      // (a) Trạng thái TRƯỚC khi hardening chạm vào: lá không có RLS.
      const truoc = await db.pool.query<{ ten: string; loai: string; bat: boolean }>(
        "SELECT relname AS ten, relkind AS loai, relrowsecurity AS bat FROM pg_class " +
          "WHERE relname LIKE 'bao_gia%' ORDER BY 1",
      );
      expect(truoc.rows).toEqual([
        { ten: "bao_gia", loai: "p", bat: true },
        { ten: "bao_gia_a", loai: "r", bat: false },
        { ten: "bao_gia_b", loai: "r", bat: false },
      ]);

      const apiPool = db.poolAs("app_api");
      const doc = async (bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY 1`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      expect(await doc("bao_gia"), "đọc qua CHA phải chỉ thấy hàng của tổ chức A").toEqual([100]);
      expect(
        await doc("bao_gia_b"),
        "nếu phép đo này rỗng nghĩa là lá đã tự chịu RLS — lỗ hổng CR2 không còn tồn tại và " +
          "cả nửa (b) của test này là thừa. Đo lại trước khi kết luận.",
      ).toEqual([999]);

      // (b) hardening: PHẢI qua (lá không policy riêng là khuôn ĐÚNG) và PHẢI bật RLS cho lá.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const sau = await db.pool.query<{ ten: string; bat: boolean; cuong_che: boolean }>(
        "SELECT relname AS ten, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
          "FROM pg_class WHERE relname LIKE 'bao_gia%' ORDER BY 1",
      );
      expect(sau.rows).toEqual([
        { ten: "bao_gia", bat: true, cuong_che: true },
        { ten: "bao_gia_a", bat: true, cuong_che: true },
        { ten: "bao_gia_b", bat: true, cuong_che: true },
      ]);
      expect(await doc("bao_gia_b"), "đọc thẳng lá của tổ chức khác phải trả 0 hàng").toEqual([]);
      expect(await doc("bao_gia"), "đường đọc thật (qua CHA) không được hỏng").toEqual([100]);
      await apiPool.end();
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 1 — I2] BA ĐƯỜNG ĐỌC VÒNG QUA RLS
  // ==========================================================================================
  // Đo với chủ sở hữu superuser — ĐÚNG kịch bản CI của chính repo này, vì migrate() chạy bằng
  // superuser. Cả ba đường đều EXIT=0 im lặng trên bản trước. Test đi qua migrate() THẬT chứ
  // không viết lại truy vấn phát hiện: viết lại là tự chấm bài mình.
  it("[I2] VIEW/MATVIEW/SECURITY DEFINER trên bảng tenant đều làm migrate() GÃY, cửa security_invoker thì không", async () => {
    const kichBan: [string, string, string | null][] = [
      // [nhãn, câu lệnh dựng, câu lệnh MỞ CỬA hợp lệ (null = không có cửa kỹ thuật)]
      [
        "VIEW mặc định (PG15+ security_invoker = false)",
        "CREATE VIEW moi_nguoi AS SELECT * FROM users",
        "ALTER VIEW moi_nguoi SET (security_invoker = true)",
      ],
      ["MATERIALIZED VIEW", "CREATE MATERIALIZED VIEW mv_nguoi AS SELECT * FROM users", null],
      [
        "hàm SECURITY DEFINER",
        "CREATE FUNCTION doc_het() RETURNS SETOF users LANGUAGE sql SECURITY DEFINER " +
          "AS 'SELECT * FROM users'",
        null,
      ],
    ];

    for (const [nhan, dung, moCua] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        await db.pool.query(dung);

        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `"${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("đọc vòng qua RLS");

        if (moCua !== null) {
          await db.pool.query(moCua);
          await expect(
            migrate(db.pool, MIGRATIONS_DIR),
            `cửa "${moCua}" phải làm hardening im lặng trở lại`,
          ).resolves.toEqual([]);
        }
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 1 — I3] BA LƯỢT: mỗi triệu chứng một khẳng định
  // ==========================================================================================
  it("[I3] hardening phán xét CHÍNH migration vừa được đưa vào, không chỉ lần deploy sau", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-i3-"));
    try {
      for (const f of ["hardening.always.sql", "001_roles_and_functions.sql", "002_organizations_and_users.sql"]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      // 003 tạo một bảng có org_id với policy fail-open — đúng thứ (B) sinh ra để bắt — và
      // CỐ Ý quên ENABLE/FORCE, để có một thứ cho lượt SỬA sửa được. Không có nửa "quên" đó thì
      // triệu chứng (3) không phân biệt được: bảng chỉ xuất hiện SAU lượt 1, nên chỉ lượt 2 mới
      // có gì để sửa, và chỉ khi lượt 2 COMMIT tách khỏi lượt 3 thì sửa chữa mới sống sót.
      await writeFile(
        join(thuMucTam, "003_bang_hong.sql"),
        "CREATE TABLE bang_hong (id int, org_id uuid NOT NULL);\n" +
          "CREATE POLICY bang_hong_p ON bang_hong USING (org_id = app_current_org_id() OR true) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON bang_hong TO app_api;\n",
        "utf8",
      );

      // Triệu chứng (1): LẦN CHẠY ĐẦU phải gãy. Trên bản trước, lần này QUA im lặng vì hardening
      // chạy TRƯỚC 003 nên nó chưa hề thấy bảng đó tồn tại.
      const loi = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "migration hỏng đi lọt ngay ở lần deploy đưa nó vào").not.toBeNull();
      expect(loi!.message).toContain("bang_hong");

      // Triệu chứng (3): phán xét hỏng KHÔNG rollback các sửa chữa của lượt SỬA. 003 đã commit
      // trong transaction riêng của nó, và cờ RLS do lượt 2 bật vẫn còn.
      const daGhi = await db.pool.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      expect(daGhi.rows.map((r) => r.version)).toContain("003_bang_hong.sql");

      const co = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bang_hong'",
      );
      expect(
        co.rows[0],
        "cờ RLS mà lượt SỬA bật đã bị lượt PHÁN XÉT kéo rollback theo — hai lượt vẫn đang nằm " +
          "chung một transaction.",
      ).toEqual({ bat: true, cuong_che: true });
      // Nhãn lượt trong thông báo: người trực đêm phải đọc được lỗi đến từ lượt nào.
      expect(loi!.message).toContain("(phan_xet)");

      // Triệu chứng (2): vá được bằng một migration MỚI, không phải sửa tay trên cụm.
      await writeFile(
        join(thuMucTam, "004_sua_policy.sql"),
        "ALTER POLICY bang_hong_p ON bang_hong USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["004_sua_policy.sql"]);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 120_000);

  it("[I3] lượt SỬA không phán xét, và chế độ lạ thì GÃY thay vì im lặng thành no-op", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const sql = await readFile(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
      await db.pool.query("ALTER POLICY users_tenant_isolation ON users USING (true)");

      const chay = async (cheDo: string): Promise<string | null> => {
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT set_config('app.hardening_che_do', $1, true)", [cheDo]);
          await client.query(sql);
          await client.query("COMMIT");
          return null;
        } catch (e) {
          await client.query("ROLLBACK").catch(() => undefined);
          return (e as Error).message;
        } finally {
          client.release();
        }
      };

      // Lược đồ ĐANG hỏng, nhưng lượt 'sua' phải đi qua — đó là thứ cho phép một migration vá
      // lỗi tới được đích thay vì kẹt sau một hàng rào chạy quá sớm.
      expect(await chay("sua"), "lượt SỬA không được phán xét").toBeNull();
      expect(await chay("phan_xet")).toContain("hình dạng biểu thức KHÔNG nằm trong danh sách");
      // Một lỗi chính tả trong migrate.ts không được âm thầm biến phán xét thành no-op.
      expect(await chay("day_du_typo")).toContain("không hợp lệ");
    } finally {
      await db.stop();
    }
  });

  // ==========================================================================================
  // [vòng fix 2 — CR1] DANH SÁCH TRẮNG BỊ VƯỢT BẰNG search_path
  // ==========================================================================================
  // Vòng 1 tự phát hiện rằng pg_get_expr deparse THEO search_path của phiên đang đọc, rồi xử lý
  // bằng cách NỚI danh sách trắng ra để chứa cả hai dạng. Nới ra chính là cơ chế của lỗ hổng
  // này: dạng TRẦN được duyệt VÔ ĐIỀU KIỆN, mà dạng trần đúng là thứ một hàm
  // app_current_org_id() ở SCHEMA KHÁC sinh ra khi schema đó đứng trước trong search_path của
  // phiên đọc. Đây là rò rỉ XUYÊN TỔ CHỨC thật, ổn định qua mọi lần migrate().
  //
  // Test đo BA nửa, cố ý tách bạch:
  //   (a) LỖ HỔNG CÓ THẬT — dưới search_path thù địch, chính policy đó deparse ra ĐÚNG chuỗi
  //       mà danh sách trắng duyệt, trong khi nó THẬT SỰ gọi hàm của schema lạ, và app_api gắn
  //       tổ chức A đọc được người dùng của tổ chức B.
  //   (b) GHIM ĐÓNG ĐƯỢC — migrate() chạy trên một kết nối MỚI (nên nó THỪA HƯỞNG rolconfig thù
  //       địch, không được cứu nhờ một client cũ trong pool) vẫn CHẶN, vì nó tự ghim search_path.
  //   (d) KHÔNG BÁO NHẦM — lược đồ sạch dưới cùng rolconfig thù địch vẫn đi qua.
  it("[CR1] danh sách trắng không bị vượt bằng search_path của phiên phán xét", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1,'a@a.com','A'), ($2,'vip@b.com','B')",
        [orgA, orgB],
      );

      // Đúng payload của re-reviewer: một app_current_org_id() GIẢ ở schema khác, trả về tổ
      // chức B bất kể phiên gắn tổ chức nào.
      await db.pool.query("CREATE SCHEMA gia");
      await db.pool.query(
        "CREATE FUNCTION gia.app_current_org_id() RETURNS uuid LANGUAGE sql STABLE AS " +
          `'SELECT ''${orgB}''::uuid'`,
      );
      await db.pool.query("GRANT USAGE ON SCHEMA gia TO PUBLIC");

      const khach = await db.pool.connect();
      try {
        await khach.query("SET search_path TO gia, public");
        await khach.query(
          "ALTER POLICY users_tenant_isolation ON public.users " +
            "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
        );
      } finally {
        khach.release();
      }
      // rolconfig của role deploy — KHÔNG nằm trong vùng canh của hardening (nó chỉ reset
      // rolconfig của BỐN role ứng dụng và search_path ở mức DATABASE), nên đây là chặn 0%.
      const { rows: ai } = await db.pool.query<{ u: string }>("SELECT current_user AS u");
      await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, public`);

      // (a) Lỗ hổng có thật. Kết nối MỚI mới thừa hưởng rolconfig, nên đo trên pool mới.
      const poolThuDich = createPool(db.connectionString, 2);
      try {
        const { rows } = await poolThuDich.query<{ sp: string; e: string }>(
          "SELECT current_setting('search_path') AS sp, " +
            "       pg_get_expr(polqual, polrelid) AS e " +
            "  FROM pg_policy WHERE polname = 'users_tenant_isolation'",
        );
        expect(rows[0]!.sp).toContain("gia");
        expect(
          rows[0]!.e,
          "nếu phép đo này KHÔNG ra chuỗi trần thì payload đã hỏng và cả test này rỗng ruột",
        ).toBe("(org_id = app_current_org_id())");

        const apiPool = db.poolAs("app_api");
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows: doc } = await client.query<{ email: string }>(
            "SELECT email FROM public.users ORDER BY 1",
          );
          expect(
            doc.map((r) => r.email),
            "policy đang gọi gia.app_current_org_id — nếu phép đo này chỉ thấy a@a.com thì lỗ " +
              "hổng không tồn tại và nửa (b) là thừa. Đo lại trước khi kết luận.",
          ).toEqual(["vip@b.com"]);
        } finally {
          client.release();
        }

        // (b) migrate() trên kết nối THỪA HƯỞNG rolconfig thù địch vẫn phải CHẶN.
        const loi = await migrate(poolThuDich, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, "policy gọi hàm của schema lạ đi lọt qua migrate()").not.toBeNull();
        expect(loi!.message).toContain("gia.app_current_org_id()");

        // (c) LỚP GHIM THỨ HAI, đo riêng: chạy hardening.always.sql BẰNG TAY (psql -f) trên
        // một phiên có search_path thù địch — đường đi KHÔNG qua migrate.ts nên nó không được
        // hưởng dòng "SET search_path" ở đó. Chỉ lần ghim trong CHÍNH file SQL cứu được ca này.
        // Không có nửa này thì việc gỡ lần ghim trong SQL là một đột biến SỐNG SÓT (đã đo).
        // Pool RIÊNG, chưa từng đi qua migrate(): kết nối trong poolThuDich đã bị migrate() đặt
        // "SET search_path = public" và giữ nguyên giá trị đó khi quay lại pool (hành vi có chủ
        // đích, ghi ở migrate.ts) — dùng lại nó ở đây sẽ làm phép đo rỗng ruột.
        //
        // Kịch bản thù địch ở đây MẠNH HƠN ở (a)/(b) một bậc, và cố ý: 'gia' đặt TRƯỚC
        // pg_catalog, cộng một pg_catalog.current_setting GIẢ. Đã đo là quy tắc "pg_catalog
        // được tìm ngầm trước" PHÁ ĐƯỢC đúng bằng cách này (current_setting trả 'BI_CUOP').
        // Nó tấn công khối DECLARE của hardening.always.sql — khối chạy TRƯỚC lần ghim trong
        // chính file đó, nên chỉ việc ghi đủ "pg_catalog." trong DECLARE mới cứu được.
        await db.pool.query(
          "CREATE FUNCTION gia.current_setting(text, boolean) RETURNS text LANGUAGE sql " +
            "IMMUTABLE AS 'SELECT ''BI_CUOP'''",
        );
        await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, pg_catalog, public`);

        const sqlHardening = await readFile(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
        const poolTay = createPool(db.connectionString, 1);
        const bangTay = await poolTay.connect();
        let loiBangTay: string | null = null;
        try {
          await bangTay.query("BEGIN");
          await bangTay.query("SELECT pg_catalog.set_config('app.hardening_che_do', 'phan_xet', true)");
          const { rows: sp } = await bangTay.query<{ sp: string; cuop: string }>(
            "SELECT pg_catalog.current_setting('search_path') AS sp, " +
              "       current_setting('bat_ky', true) AS cuop",
          );
          expect(sp[0]!.sp, "phiên chạy tay phải đang mang search_path thù địch").toContain("gia");
          expect(
            sp[0]!.cuop,
            "pg_catalog.current_setting chưa bị cướp — kịch bản thù địch hỏng, phép đo rỗng ruột",
          ).toBe("BI_CUOP");
          await bangTay.query(sqlHardening);
          await bangTay.query("COMMIT");
        } catch (e) {
          await bangTay.query("ROLLBACK").catch(() => undefined);
          loiBangTay = (e as Error).message;
        } finally {
          bangTay.release();
          await poolTay.end();
        }
        expect(
          loiBangTay,
          "chạy hardening.always.sql bằng tay dưới search_path thù địch KHÔNG bắt được policy " +
            "gọi hàm của schema lạ — lần ghim trong chính file SQL, hoặc phần ghi đủ " +
            '"pg_catalog." trong khối DECLARE, đã mất tác dụng.',
        ).toContain("gia.app_current_org_id()");

        await db.pool.query("DROP FUNCTION gia.current_setting(text, boolean)");
        await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, public`);

        // (d) Không báo nhầm: chữa policy về khuôn chuẩn thì cùng rolconfig đó vẫn đi qua.
        await db.pool.query(
          "ALTER POLICY users_tenant_isolation ON public.users " +
            "USING (org_id = public.app_current_org_id()) " +
            "WITH CHECK (org_id = public.app_current_org_id())",
        );
        await expect(migrate(poolThuDich, MIGRATIONS_DIR)).resolves.toEqual([]);
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [vòng fix 2 — Minor] Cùng nghiệm với CR1, triệu chứng khác: "CREATE TABLE IF NOT EXISTS
  // schema_migrations" tạo bảng ở schema ĐẦU TIÊN của search_path. Dưới rolconfig thù địch, bản
  // trước tạo gia.schema_migrations, thấy bảng rỗng, rồi ÁP LẠI TOÀN BỘ 001/002 vào schema lạ —
  // idempotency của migrate() tự vỡ mà không ai báo.
  it("[Minor] migrate() dưới search_path thù địch vẫn đặt lược đồ vào public và vẫn idempotent", async () => {
    const db = await startPostgres();
    try {
      const { rows: ai } = await db.pool.query<{ u: string }>("SELECT current_user AS u");
      await db.pool.query("CREATE SCHEMA gia");
      await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, public`);

      const poolThuDich = createPool(db.connectionString, 2);
      try {
        const lan1 = await migrate(poolThuDich, MIGRATIONS_DIR);
        expect(lan1).toEqual(["001_roles_and_functions.sql", "002_organizations_and_users.sql"]);
        // Lần hai KHÔNG được áp lại gì — đó chính là tính chất bị vỡ.
        await expect(migrate(poolThuDich, MIGRATIONS_DIR)).resolves.toEqual([]);

        const { rows } = await db.pool.query<{ nsp: string; rel: string }>(
          "SELECT n.nspname AS nsp, c.relname AS rel FROM pg_class c " +
            "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
            " WHERE c.relname IN ('schema_migrations','users','organizations') AND c.relkind = 'r' " +
            " ORDER BY 2, 1",
        );
        expect(rows).toEqual([
          { nsp: "public", rel: "organizations" },
          { nsp: "public", rel: "schema_migrations" },
          { nsp: "public", rel: "users" },
        ]);
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 2 — CR2] CỬA CỦA DANH SÁCH TRẮNG PHẢI THEO ĐỐI TƯỢNG, KHÔNG TOÀN CỤC
  // ==========================================================================================
  // Mô phỏng ĐÚNG việc Task 6 sẽ phải làm — mở một hình dạng riêng cho một bảng — rồi đo rằng
  // việc đó KHÔNG pre-approve cùng hình dạng ấy cho bảng khác. Trên bản vòng 1 (khoá theo
  // (pham_vi, bieu_thuc)) nửa (b) dưới đây ĐI LỌT: "USING (true)" trên CHÍNH bảng users cũng
  // được duyệt. Cách hợp lệ để dùng hệ thống chính là cách làm nó yếu đi trên toàn cục.
  //
  // Test sửa hardening.always.sql trong một THƯ MỤC TẠM (không đụng cây làm việc) vì thứ đang
  // được kiểm là chính cơ chế cửa, không phải nội dung danh sách hiện tại.
  it("[CR2] mở một hình dạng cho MỘT bảng không mở nó cho bảng khác", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-cr2-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      // 003 dựng đúng thứ Task 6 cần: một bảng tenant có policy riêng cho app_unseal.
      await writeFile(
        join(thuMucTam, "003_bang_rieng.sql"),
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n" +
          "CREATE POLICY bao_gia_unseal ON bao_gia FOR SELECT TO app_unseal USING (true);\n" +
          "GRANT SELECT ON bao_gia TO app_api, app_unseal;\n",
        "utf8",
      );

      // Chưa mở cửa: hình dạng "true" phải BỊ CHẶN.
      const loiTruoc = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loiTruoc, "USING (true) chưa được cấp ngoại lệ mà vẫn đi lọt").not.toBeNull();
      expect(loiTruoc!.message).toContain("bao_gia.bao_gia_unseal");

      // Mở cửa cho ĐÚNG (bao_gia, bao_gia_unseal).
      const duongDanHardening = join(thuMucTam, "hardening.always.sql");
      const sqlGoc = await readFile(duongDanHardening, "utf8");
      const sqlDaMo = sqlGoc.replace(
        "$q$(VALUES ('', '', '', '')) AS g(bang, polname, pham_vi, bieu_thuc)$q$",
        "$q$(VALUES ('', '', '', ''),\n" +
          "         ('bao_gia', 'bao_gia_unseal', 'co_org_id', 'true')\n" +
          "       ) AS g(bang, polname, pham_vi, bieu_thuc)$q$",
      );
      expect(sqlDaMo, "không tìm thấy NGOAI_LE_HINH_DANG để mở cửa trong bản sao tạm").not.toBe(
        sqlGoc,
      );
      await writeFile(duongDanHardening, sqlDaMo, "utf8");

      // (a) Cửa hoạt động: đúng bảng + đúng policy đó nay đi qua. 003 đã được ghi vào
      // schema_migrations ngay ở lần chạy hỏng bên trên (lượt 1 không phán xét — khuôn ba
      // lượt), nên lần này không có migration nào mới được áp.
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([]);

      // (b) VÀ nó KHÔNG lan sang bảng khác. Đây là nửa mà bản vòng 1 để lọt.
      await db.pool.query("ALTER POLICY users_tenant_isolation ON users USING (true)");
      const loiSau = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(
        loiSau,
        "USING (true) trên users đi lọt vì một ngoại lệ cấp cho bảng KHÁC — cửa vẫn đang là " +
          "toàn cục chứ không theo đối tượng.",
      ).not.toBeNull();
      expect(loiSau!.message).toContain("users.users_tenant_isolation");
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 2 — I3] MỤC (C) KHÔNG ĐƯỢC TỰ GIỚI HẠN VÀO 'public'
  // ==========================================================================================
  // Vòng 1 sinh ra mục (C) kèm sẵn bộ lọc tự làm mù mình. Test đo cả HAI nửa cho mỗi đường:
  // lỗ hổng HÀNH VI có thật (app_api gắn tổ chức A đọc được dữ liệu của B qua đối tượng ở
  // schema khác), và migrate() nay CHẶN nó.
  it("[I3] VIEW/hàm SECURITY DEFINER ở schema KHÁC public cũng bị bắt", async () => {
    const kichBan: [string, string, string][] = [
      // [nhãn, câu lệnh dựng, câu đọc vòng]
      [
        "VIEW ở schema khác",
        "CREATE SCHEMA bao_cao; CREATE VIEW bao_cao.moi_nguoi AS SELECT * FROM public.users; " +
          "GRANT USAGE ON SCHEMA bao_cao TO app_api; GRANT SELECT ON bao_cao.moi_nguoi TO app_api",
        "SELECT email FROM bao_cao.moi_nguoi ORDER BY 1",
      ],
      [
        "hàm SECURITY DEFINER ở schema khác",
        "CREATE SCHEMA tien_ich; CREATE FUNCTION tien_ich.doc_het() RETURNS SETOF public.users " +
          "LANGUAGE sql SECURITY DEFINER AS 'SELECT * FROM public.users'; " +
          "GRANT USAGE ON SCHEMA tien_ich TO app_api; " +
          "GRANT EXECUTE ON FUNCTION tien_ich.doc_het() TO app_api",
        "SELECT email FROM tien_ich.doc_het() ORDER BY 1",
      ],
    ];

    for (const [nhan, dung, doc] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        const orgA = "00000000-0000-4000-8000-00000000000a";
        const orgB = "00000000-0000-4000-8000-00000000000b";
        await db.pool.query(
          "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
          [orgA, orgB],
        );
        await db.pool.query(
          "INSERT INTO users (org_id, email, full_name) VALUES ($1,'a@a.com','A'), ($2,'vip@b.com','B')",
          [orgA, orgB],
        );
        await db.pool.query(dung);

        // (a) Lỗ hổng HÀNH VI có thật: tổ chức A đọc được cả hai tổ chức.
        const apiPool = db.poolAs("app_api");
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ email: string }>(doc);
          expect(
            rows.map((r) => r.email),
            `"${nhan}": nếu phép đo này chỉ thấy a@a.com thì đường đọc vòng không tồn tại và ` +
              "cả nửa (b) là thừa. Đo lại trước khi kết luận.",
          ).toEqual(["a@a.com", "vip@b.com"]);
        } finally {
          client.release();
        }

        // (b) migrate() CHẶN.
        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `"${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("đọc vòng qua RLS");
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 2 — I4] POLICY "AS RESTRICTIVE" LÀ PHÒNG THỦ CHẶT HƠN, KHÔNG PHẢI VI PHẠM
  // ==========================================================================================
  // Vòng 1 chặn nó — cấm một lớp phòng thủ chặt hơn là phản tác dụng rõ ràng. Test đo cả hai
  // chiều: nó đi qua được, VÀ đường lách hiển nhiên (đổi chính policy cách ly sang RESTRICTIVE
  // để né phép soi hình dạng) vẫn bị chặn bởi "phải có ít nhất một policy PERMISSIVE".
  it("[I4] policy AS RESTRICTIVE đi qua, nhưng không dùng được để né phép soi hình dạng", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // (a) Phòng thủ chiều sâu: thêm một RESTRICTIVE bên cạnh policy cách ly.
      await db.pool.query(
        "CREATE POLICY users_chan_bi_khoa ON users AS RESTRICTIVE " +
          "USING (org_id = app_current_org_id() AND status <> 'DISABLED') " +
          "WITH CHECK (org_id = app_current_org_id())",
      );
      await expect(
        migrate(db.pool, MIGRATIONS_DIR),
        "policy RESTRICTIVE hợp lệ bị chặn — hàng rào đang cấm một lớp phòng thủ CHẶT HƠN",
      ).resolves.toEqual([]);

      // (b) Đường lách: biến chính policy cách ly thành RESTRICTIVE để biểu thức khỏi bị soi.
      await db.pool.query("DROP POLICY users_chan_bi_khoa ON users");
      await db.pool.query("DROP POLICY users_tenant_isolation ON users");
      await db.pool.query(
        "CREATE POLICY users_tenant_isolation ON users AS RESTRICTIVE " +
          "USING (true) WITH CHECK (true)",
      );
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "bảng không còn policy PERMISSIVE nào mà vẫn đi lọt").not.toBeNull();
      expect(loi!.message).toContain("không có policy PERMISSIVE nào");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 2 — I6] "ĐÚNG TẠI MỘT THỜI ĐIỂM": ATTACH PARTITION SAU migrate()
  // ==========================================================================================
  // Mục (A) của hardening đúng TẠI THỜI ĐIỂM migrate() chạy. Một job VẬN HÀNH xoay vòng phân
  // mảnh gắn thêm lá SAU đó, và lá mới không có RLS. Test này KHÔNG khẳng định lỗ đã đóng —
  // nó ĐO cửa sổ phơi và khẳng định đúng tính chất giảm nhẹ mà dự án thật sự có: lần deploy KẾ
  // TIẾP tự chữa. Đóng ở tầng lược đồ đã cân nhắc và LOẠI BỎ (event trigger đòi SUPERUSER, mà
  // role deploy thật của dự án không có — thêm hậu điều kiện cho nó là chặn deploy vĩnh viễn
  // trên production). Xem ghi chú (A) ở đầu hardening.always.sql.
  it("[I6] ATTACH PARTITION sau migrate() để hở tới lần deploy kế — và lần đó tự chữa", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL, gia int) PARTITION BY LIST (org_id)",
      );
      await db.pool.query(`CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('${orgA}')`);
      await db.pool.query("ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("GRANT SELECT ON bao_gia, bao_gia_a TO app_api");
      await db.pool.query(`INSERT INTO bao_gia VALUES (1,'${orgA}',100)`);
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // Job vận hành xoay vòng phân mảnh: tạo lá RỜI rồi ATTACH — SAU khi migrate() đã xong.
      await db.pool.query("CREATE TABLE bao_gia_b (id int, org_id uuid NOT NULL, gia int)");
      await db.pool.query(`INSERT INTO bao_gia_b VALUES (2,'${orgB}',999)`);
      await db.pool.query(
        `ALTER TABLE bao_gia ATTACH PARTITION bao_gia_b FOR VALUES IN ('${orgB}')`,
      );
      await db.pool.query("GRANT SELECT ON bao_gia_b TO app_api");

      const apiPool = db.poolAs("app_api");
      const doc = async (bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY 1`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };

      // (a) CỬA SỔ PHƠI, đo chứ không giấu: lá vừa gắn chưa có RLS.
      const truoc = await db.pool.query<{ bat: boolean }>(
        "SELECT relrowsecurity AS bat FROM pg_class WHERE relname = 'bao_gia_b'",
      );
      expect(truoc.rows[0]!.bat).toBe(false);
      expect(await doc("bao_gia"), "đường đọc qua CHA vẫn đúng").toEqual([100]);
      expect(
        await doc("bao_gia_b"),
        "nếu phép đo này rỗng thì ATTACH đã tự kế thừa RLS — cửa sổ phơi không tồn tại và cả " +
          "ghi chú (A) về trục thời gian phải viết lại. Đo lại trước khi kết luận.",
      ).toEqual([999]);

      // (b) TÍNH CHẤT GIẢM NHẸ THẬT SỰ CÓ: lần deploy kế tiếp tự chữa, không cần ai nhớ gì.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const sau = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bao_gia_b'",
      );
      expect(sau.rows[0]).toEqual({ bat: true, cuong_che: true });
      expect(await doc("bao_gia_b"), "đọc thẳng lá của tổ chức khác phải trả 0 hàng").toEqual([]);
      expect(await doc("bao_gia"), "đường đọc thật (qua CHA) không được hỏng").toEqual([100]);
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 2 — Minor] HAI QUAN HỆ CHA-CON CÒN LẠI: INHERITS và DETACH PARTITION
  // ==========================================================================================
  // Vòng 1 miễn trừ "phải có policy riêng" theo đúng một tiêu chí: c.relispartition. Hai hệ quả
  // đo được, ngược chiều nhau, và test này khoá cả hai:
  //   (a) CON CHÁU "INHERITS" cổ điển KHÔNG có relispartition -> vòng 1 chặn deploy MỌI LẦN
  //       trên một lược đồ PostgreSQL coi là hợp lệ. Đã đo rằng miễn trừ là AN TOÀN: policy của
  //       CHA có hiệu lực với hàng của con khi đọc QUA CHA, và đọc THẲNG con sau khi mục (A)
  //       bật RLS + FORCE cho 0 hàng.
  //   (b) DETACH PARTITION lấy relispartition đi -> bảng tách ra KHÔNG còn được miễn, và đó là
  //       ĐÚNG: nó đã là một bảng tenant độc lập. Nhưng phải chứng minh nó không thành ngõ cụt
  //       "sửa tay trên cụm" — đường ra là một migration MỚI, đúng như khuôn ba lượt hứa.
  it("[Minor] con cháu INHERITS được miễn policy riêng; DETACH PARTITION thì không, và vá được bằng migration mới", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-ke-thua-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );

      // ---- (a) INHERITS ------------------------------------------------------------------
      await db.pool.query("CREATE TABLE cha_tt (id int, org_id uuid NOT NULL, gia int)");
      await db.pool.query("ALTER TABLE cha_tt ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE cha_tt FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY cha_tt_tenant_isolation ON cha_tt " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("CREATE TABLE con_tt () INHERITS (cha_tt)");
      await db.pool.query("GRANT SELECT ON cha_tt, con_tt TO app_api");
      await db.pool.query(`INSERT INTO cha_tt VALUES (1,'${orgA}',100)`);
      await db.pool.query(`INSERT INTO con_tt VALUES (2,'${orgB}',999)`);

      const apiPool = db.poolAs("app_api");
      const doc = async (bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY 1`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };

      await expect(
        migrate(db.pool, thuMucTam),
        "con cháu INHERITS làm hardening GÃY — một lược đồ PostgreSQL coi là hợp lệ đang chặn " +
          "deploy vĩnh viễn, đúng triệu chứng (3) của I3 lặp lại ở nhánh kế thừa",
      ).resolves.toEqual([]);
      const co = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'con_tt'",
      );
      expect(co.rows[0], "miễn trừ chỉ an toàn khi mục (A) vẫn bật RLS + FORCE cho con").toEqual({
        bat: true,
        cuong_che: true,
      });
      expect(await doc("cha_tt"), "đọc QUA CHA phải chỉ thấy hàng của tổ chức A").toEqual([100]);
      expect(await doc("con_tt"), "đọc THẲNG con phải fail-closed").toEqual([]);

      // ---- (b) DETACH PARTITION ------------------------------------------------------------
      await db.pool.query(
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL, gia int) PARTITION BY LIST (org_id)",
      );
      await db.pool.query(`CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('${orgA}')`);
      await db.pool.query("ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("GRANT SELECT ON bao_gia, bao_gia_a TO app_api");
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([]);

      await db.pool.query("ALTER TABLE bao_gia DETACH PARTITION bao_gia_a");
      const loi = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "bảng vừa DETACH là bảng tenant độc lập không policy mà vẫn đi lọt").not.toBeNull();
      expect(loi!.message).toContain("bao_gia_a: không có policy PERMISSIVE nào");

      // Đường ra KHÔNG phải sửa tay trên cụm: một migration mới tới được đích vì lượt 1 không
      // phán xét. Đây chính là điều phải chứng minh để phép kiểm này không thành ngõ cụt.
      await writeFile(
        join(thuMucTam, "003_policy_cho_bang_tach.sql"),
        "CREATE POLICY bao_gia_a_tenant_isolation ON bao_gia_a " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([
        "003_policy_cho_bang_tach.sql",
      ]);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 120_000);
});
