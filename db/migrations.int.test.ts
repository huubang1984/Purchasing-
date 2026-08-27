import { describe, expect, it } from "vitest";
import { withMigratedDatabase } from "@trustprocure/test-support";

// Không gắn mã [INV-*] cho hai test dưới đây: TEST-PLAN §2 nhóm F (F1: ràng buộc org_id
// qua RLS) và nhóm B (B4: REVOKE UPDATE/DELETE trên audit_events) là bất biến mà migration
// này CHUẨN BỊ nền tảng cho — hàm app_current_org_id() sẽ được các policy RLS ở migration
// sau gọi — nhưng migration 001 chưa tạo bảng nào có org_id hay bảng audit_events. Gắn
// [INV-F1] hoặc [INV-B4] ở đây sẽ là bằng chứng giả: chưa có RLS policy nào, chưa có
// audit_events nào để kiểm chứng hành vi cưỡng chế thật. Test thật cho F1/B4 thuộc về các
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
});
