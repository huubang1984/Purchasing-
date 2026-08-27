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

  // [fix S1] Trước bản vá, migration chỉ tạo role NẾU CHƯA TỒN TẠI (IF NOT EXISTS ...
  // CREATE ROLE) và không bao giờ áp lại thuộc tính — đúng "tình cờ" trên DB trống. Test
  // này khẳng định mọi cờ đặc quyền của cả hai role đều bị khoá cứng về false, và không có
  // rolconfig kế thừa (vd. search_path bị đặt sẵn cho mục đích khác).
  it("[fix S1] thuộc tính đặc quyền của app_api/app_unseal đều bị khoá cứng về false", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolcanlogin: boolean;
        rolreplication: boolean;
        rolconfig: string[] | null;
      }>(
        "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, " +
          "rolreplication, rolconfig FROM pg_roles " +
          "WHERE rolname IN ('app_api', 'app_unseal') ORDER BY rolname",
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolcanlogin: false,
          rolreplication: false,
        });
        expect(row.rolconfig).toBeNull();
      }

      const { rowCount } = await db.pool.query(
        "SELECT 1 FROM pg_auth_members m " +
          "JOIN pg_roles a ON a.oid = m.roleid " +
          "JOIN pg_roles b ON b.oid = m.member " +
          "WHERE a.rolname IN ('app_api', 'app_unseal') OR b.rolname IN ('app_api', 'app_unseal')",
      );
      expect(rowCount).toBe(0);
    });
  });

  // [fix S1] Test đối kháng thật cho lỗ hổng: dựng sẵn app_api với BYPASSRLS + SUPERUSER +
  // LOGIN (mô phỏng role dùng chung cluster, ops tạo tay, hoặc quên gỡ sau khi debug), rồi
  // chạy migration thật của dự án và khẳng định các đặc quyền đó bị tước sạch. Nếu migration
  // quay lại dùng "IF NOT EXISTS ... CREATE ROLE" mà không ALTER lại, test này sẽ đỏ vì
  // role vẫn giữ BYPASSRLS — đúng cơ chế phát hiện hồi quy mà S1 yêu cầu.
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
      }>("SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'app_api'");

      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
    } finally {
      await db.stop();
    }
  });
});
