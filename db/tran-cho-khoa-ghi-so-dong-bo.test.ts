// =============================================================================================
// [S1.71 / khoản 123, lượt soi 65a-8 ⑷] TRẦN CHỜ KHOÁ GHI SỔ: 050 VÀ HARDENING (D1b) MANG CÙNG MỘT GIÁ TRỊ — KIỂM TĨNH
//
// Trần 2 s trên `public.noi_chuoi_kiem_toan()` có hai chỗ viết: migration 050 (`ALTER FUNCTION … SET lock_timeout`) sở hữu nó theo TÊN,
// và hardening mục (D1b) tạo lại hàm với cùng mệnh đề ở mỗi `migrate()` và đòi đúng `proconfig`. Lượt sửa của hardening chạy cả SAU vòng
// migration đánh số, nên gỡ hay đổi trần ở 050 thì hàm vẫn được tạo lại với giá trị của (D1b) — không test nào trên CSDL thật đỏ vì riêng
// việc ấy; đổi ở (D1b) thì `migrate()` đầu tiên gãy ở lượt phán xét (đo bằng đột biến, §S1.71). Kiểm tĩnh này là lớp thấy được hai chỗ
// lệch nhau: tệp .sql mà người đọc lịch sử migration thấy phải nói đúng giá trị
// đang chạy — cùng lý do với §R3 của `db/audit-append-only.int.test.ts`.
// =============================================================================================

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function doc(ten: string): string {
  return readFileSync(new URL(`./migrations/${ten}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

describe("[S1.71 / khoản 123] trần chờ khoá ghi sổ: 050 và hardening (D1b) cùng một giá trị", () => {
  it("050 chỉ chứa đúng câu đặt trần 2 s trên hàm nối chuỗi", () => {
    const cau = doc("050_tran_cho_khoa_ghi_so.sql")
      .replace(/--[^\n]*/g, "")
      .trim();
    expect(cau).toBe("ALTER FUNCTION public.noi_chuoi_kiem_toan() SET lock_timeout = '2s';");
  });

  it("hardening (D1b) tạo lại hàm với trần 2 s và đòi đúng proconfig ấy", () => {
    const ht = doc("hardening.always.sql");
    expect(ht).toContain(
      "LANGUAGE plpgsql SET search_path = pg_catalog SET lock_timeout = '2s' AS $tnc$$q$ || THAN_NOI_CHUOI || $q$$tnc$;",
    );
    expect(ht).toContain("AND p.proconfig = ARRAY['search_path=pg_catalog', 'lock_timeout=2s']");
  });

  it("không tệp migration đánh số nào còn chỗ trống ⟦…⟧ của bản nháp", () => {
    // [lượt soi 65c-2] `migrate()` ghi checksum của tệp đánh số khi áp: chỗ trống sót lại thì sửa sau là lệch checksum. Test đầu bỏ chú
    // thích trước khi so, nên không thấy chỗ trống nằm trong chú thích.
    const tep = readdirSync(new URL("./migrations/", import.meta.url)).filter((ten) => /^\d{3}_.*\.sql$/.test(ten));
    expect(tep.length).toBeGreaterThanOrEqual(50);
    expect(tep.filter((ten) => doc(ten).includes("⟦"))).toEqual([]);
  });
});
