import { createPool, migrate } from "@trustprocure/db";
import {
  startPostgres,
  withMigratedDatabase,
  type TestDatabase,
} from "@trustprocure/test-support";
import { readFileSync } from "node:fs";
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

      await db.pool.query("DROP FUNCTION public.app_current_org_id()");
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
});
