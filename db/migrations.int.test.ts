import { migrate } from "@trustprocure/db";
import { startPostgres, withMigratedDatabase } from "@trustprocure/test-support";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

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
  // pg_db_role_setting, một bảng khác hẳn pg_roles.rolconfig. row_security=off tắt hẳn RLS
  // cho phiên đó, nên đây không phải chuyện nhỏ.
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
});
