import pg from "pg";
import { describe, expect, it } from "vitest";
import { createPool } from "./pool.js";
import { VAI_UNG_DUNG, ganVaiTroChoPool, laVaiUngDung } from "./vai-tro.js";

describe("[S1.11] vai ứng dụng gắn được vào pool là một danh sách ĐÓNG", () => {
  it("chỉ hai role NOLOGIN của 001; role đăng nhập và superuser không nằm trong danh sách", () => {
    expect([...VAI_UNG_DUNG]).toEqual(["app_api", "app_unseal"]);
    expect(laVaiUngDung("app_api")).toBe(true);
    expect(laVaiUngDung("app_unseal")).toBe(true);
    for (const x of ["app_api_login", "postgres", "APP_API", "app_api; DROP ROLE app_api", ""]) {
      expect(laVaiUngDung(x), x).toBe(false);
    }
  });

  it("ganVaiTroChoPool từ chối một tên ngoài danh sách TRƯỚC khi chạm Postgres", () => {
    const pool = new pg.Pool({ host: "127.0.0.1", port: 1, max: 1 });
    expect(() => ganVaiTroChoPool(pool, "app_api_login" as unknown as "app_api")).toThrow(/vai không hợp lệ/u);
    // Không kết nối nào được mở: pool vẫn trống.
    expect(pool.totalCount).toBe(0);
  });

  it("createPool không có `role` KHÔNG bọc connect — hành vi S0 giữ nguyên", () => {
    const pool = createPool("postgres://u:p@127.0.0.1:5432/db");
    // `connect` gốc của pg-pool là phương thức trên prototype; bản bọc là thuộc tính riêng của instance.
    expect(Object.hasOwn(pool, "connect")).toBe(false);
    const coVai = createPool("postgres://u:p@127.0.0.1:5432/db", 1, { role: "app_api" });
    expect(Object.hasOwn(coVai, "connect")).toBe(true);
  });
});
