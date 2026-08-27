import { describe, expect, it } from "vitest";
import { startPostgres, withMigratedDatabase } from "./postgres.js";

// Bản sửa của [fix C1]: poolAs() từng "bắn rồi quên" SET ROLE (`void client.query(...)`),
// khiến (a) role sai crash cả tiến trình Node do unhandled rejection thay vì test fail
// sạch, và (b) câu SET ROLE chạy chồng lấn với câu lệnh thật của người gọi trên cùng một
// client vì không ai chờ nó xong. Bộ test dưới đây tấn công đúng hai lỗ đó.
//
// Không tự gọi .end() trên pool trả về từ poolAs() trong các test này: pool đó đã được
// `db`/`withMigratedDatabase` theo dõi và tự đóng khi kết thúc — gọi .end() thêm lần nữa
// ném lỗi "Called end on pool more than once" (tự kiểm chứng khi viết test này).
describe("poolAs — pool chạy dưới role khác", () => {
  it("từ chối vai trò không nằm trong danh sách cho phép, không chạm DB", async () => {
    const db = await startPostgres();
    try {
      expect(() => db.poolAs("role_gia_mao; DROP TABLE audit_events;")).toThrow(
        /vai trò không hợp lệ/,
      );
    } finally {
      await db.stop();
    }
  });

  it("role hợp lệ: mọi câu lệnh trên pool đều thấy current_user đúng bằng role đó", async () => {
    await withMigratedDatabase(async (db) => {
      const apiPool = db.poolAs("app_api");
      const ketQua = await Promise.all(
        Array.from({ length: 5 }, () =>
          apiPool.query<{ vai_tro: string }>("SELECT current_user AS vai_tro"),
        ),
      );
      for (const { rows } of ketQua) {
        expect(rows[0]?.vai_tro).toBe("app_api");
      }
    });
  });

  it("SET ROLE thất bại (role chưa tồn tại trên cluster) làm query() reject rõ ràng, không crash tiến trình", async () => {
    // Cố ý dùng startPostgres() TRẦN — chưa chạy migrate() nên app_api chưa tồn tại trên
    // cluster này. Đây chính là kịch bản khiến bản lỗi trước tạo unhandled rejection.
    const db = await startPostgres();
    try {
      const rolePool = db.poolAs("app_api");
      await expect(rolePool.query("SELECT 1")).rejects.toThrow();
    } finally {
      await db.stop();
    }
  });

  it("app_api gọi được app_current_org_id() sau khi migration cấp lại EXECUTE đã bị REVOKE khỏi PUBLIC", async () => {
    await withMigratedDatabase(async (db) => {
      const apiPool = db.poolAs("app_api");
      const { rows } = await apiPool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    });
  });
});
