// ==============================================================================================
// [S1.66 / lượt soi ngang 59a-8] THÔNG ĐIỆP DEPLOY NÊU TÊN, KHÔNG IN GIÁ TRỊ — bốn mục canh policy của hardening
//
// Bài học S1.51 ⑷: thông điệp lỗi deploy là bề mặt rò dữ liệu — tên thì được, giá trị thì không, và chuẩn ấy áp cho MỌI mục cùng
// lớp. Mục 83⑴ (`CAU_POLICY_LOP_SAI`) in NGUYÊN VĂN biểu thức USING và WITH CHECK của policy chưa khai, và S1.55 mở tầm của mục
// ra mọi lược đồ dự án. Đo (bản nháp của lượt soi 59, lược đồ thật, trước bản vá): policy `USING (org_id = '11111111-…'::uuid)`
// ngoài `public` ⇒ thông điệp mang nguyên UUID ấy. Hằng trong một policy có thể là UUID của một tổ chức, một địa chỉ email, một
// mã — và thông điệp đi thẳng vào log deploy. Người viết đo cùng lớp ở ba mục nữa: [CR1] (`CAU_POLICY_SAI`), mục RLS + policy
// khách của `caller_rate_limits` (042), mục policy dọn của `otp_rate_limits` (044). Mục 044 còn một lỗi riêng, đo: mô tả nối
// `'…' || p.polcmd` (kiểu "char") nên ném 42725 mỗi khi policy tồn tại mà lệch — thông điệp riêng của mục chưa từng in ra.
// ==============================================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docHangHardening } from "./hardening-hang.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(new URL("./migrations/hardening.always.sql", import.meta.url), "utf8");
const HANG_SO = "11111111-2222-4333-8444-555555555591";
const EMAIL = "bi-mat-59@vidu.vn";

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.66 / lượt soi ngang 59a-8] thông điệp của các mục canh policy nêu TÊN, không in biểu thức", () => {
  it("83⑴: policy PERMISSIVE chưa khai ngoài public mang một UUID trong USING và một email trong WITH CHECK ⇒ thông điệp nêu tên policy, không mang giá trị nào", async () => {
    await db.pool.query("CREATE SCHEMA zz_tb59");
    await db.pool.query("CREATE TABLE zz_tb59.t (org_id uuid, email text)");
    await db.pool.query("ALTER TABLE zz_tb59.t ENABLE ROW LEVEL SECURITY");
    await db.pool.query(`CREATE POLICY zz_pol59 ON zz_tb59.t USING (org_id = '${HANG_SO}'::uuid) WITH CHECK (email = '${EMAIL}')`);
    try {
      const moTa = (await db.pool.query<{ mo_ta: string }>(docHangHardening(HARDENING, "CAU_POLICY_LOP_SAI"))).rows
        .map((r) => r.mo_ta)
        .filter((m) => m.includes("zz_pol59"));
      expect(moTa, "mục 83⑴ phải nêu policy chưa khai — không thì phép đo rỗng ruột").toHaveLength(1);
      expect(moTa[0]).toContain("zz_tb59.t.zz_pol59");
      expect(moTa[0]).not.toContain(HANG_SO);
      expect(moTa[0]).not.toContain(EMAIL);
    } finally {
      await db.pool.query("DROP SCHEMA zz_tb59 CASCADE");
    }
  });

  it("[CR1]: policy PERMISSIVE sai hình dạng trên bảng tenant mang một UUID ⇒ thông điệp của CAU_POLICY_SAI nêu tên, không in biểu thức", async () => {
    await db.pool.query(`CREATE POLICY zz_cr1_59 ON public.suppliers USING (org_id = '${HANG_SO}'::uuid) WITH CHECK (org_id = '${HANG_SO}'::uuid)`);
    try {
      const moTa = (await db.pool.query<{ mo_ta: string }>(docHangHardening(HARDENING, "CAU_POLICY_SAI"))).rows
        .map((r) => r.mo_ta)
        .filter((m) => m.includes("zz_cr1_59"));
      expect(moTa, "[CR1] phải nêu policy sai hình dạng — không thì phép đo rỗng ruột").toHaveLength(1);
      expect(moTa[0]).toContain("suppliers.zz_cr1_59");
      expect(moTa[0]).toContain("hình dạng biểu thức KHÔNG nằm trong danh sách được duyệt");
      expect(moTa[0]).not.toContain(HANG_SO);
    } finally {
      await db.pool.query("DROP POLICY zz_cr1_59 ON public.suppliers");
    }
  });

  it("042 + 044: policy của hai bảng hạn mức lệch (caller_rate_limits thêm một policy; policy dọn của otp_rate_limits bị dựng lại với hằng) ⇒ migrate() NÉM, thông điệp nêu cả hai mục mà không in biểu thức nào", async () => {
    await db.pool.query("CREATE POLICY zz_them_59 ON public.caller_rate_limits USING (hits = 5959591)");
    await db.pool.query("DROP POLICY otp_rate_limits_don_cua_so_cu ON public.otp_rate_limits");
    await db.pool.query(`CREATE POLICY otp_rate_limits_don_cua_so_cu ON public.otp_rate_limits FOR DELETE TO app_api USING (org_id = '${HANG_SO}'::uuid)`);
    try {
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "hai mục canh policy phải NÉM — không thì phép đo rỗng ruột").not.toBeNull();
      expect(loi!.message).toContain("RLS/policy của caller_rate_limits lệch");
      // Đo trước bản vá: mô tả của mục 044 ném 42725 nên mục chỉ báo "KHÔNG ĐÁNH GIÁ ĐƯỢC".
      expect(loi!.message).toContain("policy dọn của otp_rate_limits lệch");
      expect(loi!.message).not.toContain("42725");
      expect(loi!.message).not.toContain("5959591");
      expect(loi!.message).not.toContain(HANG_SO);
    } finally {
      await db.pool.query("DROP POLICY IF EXISTS zz_them_59 ON public.caller_rate_limits");
      await db.pool.query("DROP POLICY IF EXISTS otp_rate_limits_don_cua_so_cu ON public.otp_rate_limits");
      await migrate(db.pool, MIGRATIONS_DIR);
    }
  });
});
