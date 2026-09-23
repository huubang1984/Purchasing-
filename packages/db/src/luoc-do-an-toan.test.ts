// [khoản 109] Phần CẤM của search path hiệu lực — hàm thuần, bảng ca.
import { describe, expect, it } from "vitest";
import { tachMangVanBan, viPhamLuocDoTuyetDoi } from "./luoc-do-an-toan.js";

describe("[khoản 109] tách mảng văn bản PostgreSQL", () => {
  it("phần tử trần, có nháy, có thoát, và mảng rỗng", () => {
    expect(tachMangVanBan("{public}")).toEqual(["public"]);
    expect(tachMangVanBan("{pg_catalog,public}")).toEqual(["pg_catalog", "public"]);
    expect(tachMangVanBan('{"a b",public,"c\\"d"}')).toEqual(["a b", "public", 'c"d']);
    expect(tachMangVanBan("{}")).toEqual([]);
    expect(() => tachMangVanBan("public")).toThrow();
  });
});

describe("[khoản 109] ba điều cấm", () => {
  const hopLe: [string, string][] = [
    ["{public}", "app_api"],
    ["{pg_catalog,public}", "app_api"],
    // `"$user"` phân giải ra schema trùng tên vai — hợp lệ (ca DDL của vai-tro.int.test.ts).
    ["{app_api,public}", "app_api"],
    // Schema SAU public không bị cấm ở đây — phần ấy do phép so tương đối canh.
    ["{public,zz99}", "app_api"],
  ];
  it.each(hopLe)("%s dưới vai %s ⇒ hợp lệ", (luocDo, vai) => {
    expect(viPhamLuocDoTuyetDoi(luocDo, vai)).toBeNull();
  });

  const viPham: [string, string, RegExp][] = [
    // ⑴ ca 59a-2: ALTER SYSTEM đặt schema lạ đứng trước public
    ["{ke_gian,public}", "app_api", /schema lạ đứng trước public/u],
    // ⑴ schema trùng tên vai KHÁC không phải "$user" của phiên này
    ["{app_unseal,public}", "app_api", /schema lạ đứng trước public/u],
    // ⑵ ca 59a-4: mặc định vai `public, pg_catalog`
    ["{public,pg_catalog}", "app_api", /pg_catalog sau public/u],
    ["{pg_catalog}", "app_api", /không có public/u],
    ["{}", "app_api", /không có public/u],
    // nháy không cứu được tên lạ
    ['{"ke gian",public}', "app_api", /schema lạ/u],
  ];
  it.each(viPham)("%s dưới vai %s ⇒ vi phạm", (luocDo, vai, mau) => {
    expect(viPhamLuocDoTuyetDoi(luocDo, vai)).toMatch(mau);
  });

  it("mô tả KHÔNG in tên schema nào", () => {
    expect(viPhamLuocDoTuyetDoi("{ke_gian,public}", "app_api")).not.toContain("ke_gian");
  });
});
