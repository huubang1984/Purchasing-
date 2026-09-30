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
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
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

// ==============================================================================================
// [S1.9102 / khoản 117] CÙNG LỚP VỚI BỐN MỤC POLICY Ở TRÊN — CÁC MỤC CANH THÂN HÀM/TRIGGER VÀ HAI WARNING "KHÔNG ĐÁNH GIÁ ĐƯỢC"
//
// Đo trước bản vá (thân khoản 117, S1.66 lượt soi 59a-8 mở rộng; đo lại trên cây 69e743e): ⑴ `ALTER FUNCTION
// public.app_current_org_id() SET app.org_id = '<uuid>'` rồi `migrate()` dưới superuser ⇒ đi qua (tự chữa) nhưng WARNING của
// lượt sửa mang `config=app.org_id=<uuid>`; ⑵ thân hàm thay bằng một thân mang hằng UUID ⇒ WARNING mang nguyên thân cùng UUID;
// ⑶ như ⑴ dưới một vai deploy không sở hữu hàm ⇒ `migrate()` NÉM, bản gom mang `config=app.org_id=<uuid>`; ⑷ một điều kiện
// hay hậu điều kiện ném 22P02 ⇒ WARNING "không đánh giá được …" và bản gom mang `SQLERRM` = `invalid input syntax for type
// uuid: "<giá trị>"`; ⑸ trigger dựng lại với mệnh đề WHEN mang UUID ⇒ WARNING mang nguyên `pg_get_triggerdef`. Chủ dự án
// chốt nhánh ⑴ (2026-09-30): VÂN TAY thay thân hàm và định nghĩa trigger, `proconfig` chỉ in TÊN GUC, `SQLERRM` → `SQLSTATE`.
// Vân tay = left(encode(sha256(convert_to(<văn bản>, 'UTF8')), 'hex'), 16) — ca ⑵ và ⑸ tính lại đúng công thức ấy (trong
// CSDL và ngoài CSDL bằng node:crypto) và đòi WARNING mang đúng vân tay của văn bản HIỆN TẠI: chẩn đoán của IM5 còn dùng
// được, chỉ là tra qua vân tay (ADR-9202) thay vì đọc thẳng trong log. Cổng T1: `tests/architecture/hardening-khong-in-gia-tri.test.ts`.
// ==============================================================================================
describe("[S1.9102 / khoản 117] thông điệp của các mục canh thân hàm/trigger và WARNING 'không đánh giá được' nêu TÊN và VÂN TAY — không in prosrc, giá trị proconfig, định nghĩa trigger hay SQLERRM", () => {
  const UUID = "11111111-2222-4333-8444-555555559102";
  const MUC_HAM = 'mục "định nghĩa hàm app_current_org_id()" ở trạng thái SAI TRƯỚC khi sửa';

  /** Công thức tra của ADR-9202, chạy trong CSDL — đúng thứ người vận hành gõ trong psql. */
  const vanTayCua = async (vanBan: string): Promise<string> => {
    const { rows } = await db.pool.query<{ vt: string }>(
      "SELECT left(encode(sha256(convert_to($1, 'UTF8')), 'hex'), 16) AS vt",
      [vanBan],
    );
    return rows[0]!.vt;
  };

  /** `migrate()` kèm kênh thông báo: gom mọi WARNING/NOTICE của lượt sửa; lỗi (nếu có) trả về thay vì ném. */
  const migrateNghe = async (pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<{ readonly loi: Error | null; readonly gop: string }> => {
    const canhBao: string[] = [];
    const loi = await migrate(pool, dir, {
      onThongBao: (t) => {
        canhBao.push(t.message);
      },
    }).then(
      () => null,
      (e: Error) => e,
    );
    return { loi, gop: canhBao.join("\n") };
  };

  /** Đoạn văn bản quanh chỗ mang `giaTri` (rỗng nếu không có) — lần đỏ NÓI RA đúng chỗ rò, không chỉ "not to contain". */
  const doanMang = (van: string, giaTri: string): string => {
    const k = van.indexOf(giaTri);
    return k < 0 ? "" : van.slice(Math.max(0, k - 200), k + giaTri.length + 40);
  };

  it("⑴ ALTER FUNCTION app_current_org_id() SET app.org_id = <uuid> rồi migrate() dưới superuser ⇒ tự chữa (proconfig về NULL); WARNING của lượt sửa nêu mục và TÊN GUC, không mang UUID", async () => {
    await db.pool.query(`ALTER FUNCTION public.app_current_org_id() SET app.org_id = '${UUID}'`);
    try {
      const { loi, gop } = await migrateNghe(db.pool);
      expect(loi, "superuser tự chữa được — migrate() phải đi qua").toBeNull();
      expect(gop, "phép đo rỗng ruột: mục ghim hàm phải phát WARNING SAI TRƯỚC khi sửa").toContain(MUC_HAM);
      expect(doanMang(gop, UUID), "WARNING của lượt sửa mang giá trị GUC").toBe("");
      expect(gop).toContain("config(chỉ tên GUC)=app.org_id");
      const { rows } = await db.pool.query<{ proconfig: string[] | null }>(
        "SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.app_current_org_id()')",
      );
      expect(rows[0]!.proconfig, "lượt sửa đưa proconfig về NULL").toBeNull();
    } finally {
      await db.pool.query("ALTER FUNCTION public.app_current_org_id() RESET ALL");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    }
  });

  it("⑵ thân hàm thay bằng một thân mang hằng UUID ⇒ migrate() dưới superuser tự chữa; WARNING mang VÂN TAY của thân HIỆN TẠI (tính lại được trong và ngoài CSDL), không mang thân hàm hay UUID", async () => {
    const than = `SELECT '${UUID}'::uuid`;
    await db.pool.query(`CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid LANGUAGE sql STABLE AS $f$ ${than} $f$`);
    try {
      const { loi, gop } = await migrateNghe(db.pool);
      expect(loi).toBeNull();
      expect(gop).toContain(MUC_HAM);
      expect(doanMang(gop, UUID), "WARNING của lượt sửa mang thân hàm cùng hằng UUID").toBe("");
      expect(gop).not.toContain(than);
      const vanTay = await vanTayCua(than);
      expect(vanTay, "công thức tra cho 16 ký tự hex").toMatch(/^[0-9a-f]{16}$/u);
      expect(createHash("sha256").update(than, "utf8").digest("hex").slice(0, 16), "công thức tra tính được ngoài CSDL").toBe(vanTay);
      expect(gop, "WARNING phải mang vân tay của thân hiện tại — chẩn đoán IM5 vẫn tra được").toContain(`vân tay prosrc hiện tại: ${vanTay}`);
    } finally {
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    }
  });

  it("⑸ trigger sessions_kiem_mfa_khi_tao dựng lại với mệnh đề WHEN mang UUID ⇒ migrate() dưới superuser tự chữa; WARNING mang tên trigger, cờ enabled và VÂN TAY của định nghĩa HIỆN TẠI, không mang định nghĩa hay UUID", async () => {
    await db.pool.query(
      "DROP TRIGGER sessions_kiem_mfa_khi_tao ON public.sessions; " +
        `CREATE TRIGGER sessions_kiem_mfa_khi_tao BEFORE INSERT ON public.sessions FOR EACH ROW WHEN (NEW.org_id = '${UUID}'::uuid) EXECUTE FUNCTION public.sessions_kiem_mfa_khi_tao(); ` +
        "ALTER TABLE public.sessions ENABLE ALWAYS TRIGGER sessions_kiem_mfa_khi_tao",
    );
    try {
      const { rows } = await db.pool.query<{ def: string }>(
        "SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.sessions') AND t.tgname = 'sessions_kiem_mfa_khi_tao'",
      );
      const def = rows[0]!.def;
      expect(def, "fixture: định nghĩa hiện tại phải mang UUID — không thì phép đo rỗng ruột").toContain(UUID);
      const { loi, gop } = await migrateNghe(db.pool);
      expect(loi).toBeNull();
      expect(gop).toContain('mục "hàm + trigger sessions_kiem_mfa_khi_tao (029/037)" ở trạng thái SAI TRƯỚC khi sửa');
      expect(doanMang(gop, UUID), "WARNING của lượt sửa mang định nghĩa trigger cùng hằng UUID").toBe("");
      expect(gop).not.toContain("WHEN (");
      expect(gop).toContain(`sessions_kiem_mfa_khi_tao:enabled=A:vân tay def=${await vanTayCua(def)}`);
    } finally {
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    }
  });

  it("⑷ một mục có ĐIỀU KIỆN và một mục có HẬU ĐIỀU KIỆN ném lỗi mang giá trị (22P02) ⇒ hai WARNING của lượt sửa và bản gom của lượt phán xét nêu tên mục và SQLSTATE, không mang giá trị hay thông điệp lỗi", async () => {
    const tam = mkdtempSync(join(tmpdir(), "tp-hardening-117-"));
    try {
      cpSync(MIGRATIONS_DIR, tam, { recursive: true });
      const moc = "  bang text[][] := ARRAY[\n";
      expect(HARDENING.split(moc).length, "mốc chèn phải duy nhất").toBe(2);
      // Ép kiểu một literal mang giá trị sang uuid: 22P02, và SQLERRM là `invalid input syntax for type uuid: "<giá trị>"`.
      const nem = `('bi-mat-117-${UUID}')::uuid IS NOT NULL`;
      const tiem =
        moc +
        `    ARRAY[$q$mục thử 117 điều kiện ném$q$, $q$${nem}$q$, $q$SELECT 1$q$, $q$true$q$, $q$'x'$q$, $q$không gì$q$],\n` +
        `    ARRAY[$q$mục thử 117 hậu điều kiện ném$q$, $q$true$q$, $q$SELECT 1$q$, $q$${nem}$q$, $q$'x'$q$, $q$không gì$q$],\n`;
      // split/join, không `String.replace` — vế thay chứa `$'`, mẫu "phần sau chỗ khớp" của JS (bài học khoản 88 ⑸).
      writeFileSync(join(tam, "hardening.always.sql"), HARDENING.split(moc).join(tiem));
      const { loi, gop } = await migrateNghe(db.pool, tam);
      expect(loi, "hai mục tiêm phải làm lượt phán xét NÉM").not.toBeNull();
      for (const [nhan, van] of [["WARNING của lượt sửa", gop], ["bản gom của lượt phán xét", loi!.message]] as const) {
        expect(doanMang(van, "bi-mat-117"), `${nhan} mang giá trị làm ném (qua SQLERRM)`).toBe("");
        expect(van).not.toContain(UUID);
        expect(van).not.toContain("invalid input syntax");
      }
      expect(gop).toContain('không đánh giá được ĐIỀU KIỆN của mục "mục thử 117 điều kiện ném": SQLSTATE 22P02');
      expect(gop).toContain('không đánh giá được hậu điều kiện của mục "mục thử 117 hậu điều kiện ném" trước khi sửa: SQLSTATE 22P02');
      expect(loi!.message).toContain('- "mục thử 117 điều kiện ném": KHÔNG ĐÁNH GIÁ ĐƯỢC — điều kiện, hậu điều kiện hay mô tả ném SQLSTATE 22P02;');
      expect(loi!.message).toContain('- "mục thử 117 hậu điều kiện ném": KHÔNG ĐÁNH GIÁ ĐƯỢC — điều kiện, hậu điều kiện hay mô tả ném SQLSTATE 22P02;');
      // Đối chứng: kho thật đi qua trên cùng CSDL — hai mục tiêm không để lại gì.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    } finally {
      rmSync(tam, { recursive: true, force: true });
    }
  });

  it("⑶ như ⑴ dưới một vai deploy không sở hữu hàm (CREATEROLE, chủ database, không superuser) ⇒ migrate() NÉM; bản gom và WARNING nêu mục, vân tay và TÊN GUC, không mang UUID", async () => {
    const { rows } = await db.pool.query<{ ten_db: string; chu: string }>("SELECT current_database() AS ten_db, current_user AS chu");
    const { ten_db: tenDb, chu } = rows[0]!;
    // Cùng bốn câu dựng vai deploy thường của `db/migrations.int.test.ts` (N2, S1.86): CREATEROLE + chủ database + schema_migrations
    // + EXECUTE pg_advisory_lock(bigint) — không sở hữu hàm nào của 001.
    await db.pool.query("CREATE ROLE zz_trien_khai_117 LOGIN CREATEROLE PASSWORD 'mat-khau-117'");
    await db.pool.query(`ALTER DATABASE "${tenDb}" OWNER TO zz_trien_khai_117`);
    await db.pool.query("GRANT ALL ON TABLE public.schema_migrations TO zz_trien_khai_117");
    await db.pool.query("GRANT EXECUTE ON FUNCTION pg_catalog.pg_advisory_lock(bigint) TO zz_trien_khai_117");
    const url = new URL(db.connectionString);
    url.username = "zz_trien_khai_117";
    url.password = "mat-khau-117";
    const poolTrienKhai = createPool(url.toString(), 2);
    try {
      await db.pool.query(`ALTER FUNCTION public.app_current_org_id() SET app.org_id = '${UUID}'`);
      const { loi, gop } = await migrateNghe(poolTrienKhai);
      expect(loi, "vai deploy không sở hữu hàm: không tự chữa được ⇒ phải NÉM có tên").not.toBeNull();
      expect(doanMang(loi!.message, UUID), "bản gom của lượt phán xét mang giá trị GUC").toBe("");
      expect(doanMang(gop, UUID), "WARNING của lượt sửa mang giá trị GUC").toBe("");
      expect(loi!.message).toContain('"định nghĩa hàm app_current_org_id()": trạng thái hiện tại SAI (thân/thuộc tính hàm khác bản chuẩn — vân tay prosrc hiện tại: ');
      expect(loi!.message).toContain("config(chỉ tên GUC)=app.org_id");
    } finally {
      await poolTrienKhai.end();
      await db.pool.query("ALTER FUNCTION public.app_current_org_id() RESET ALL");
      await db.pool.query(`ALTER DATABASE "${tenDb}" OWNER TO "${chu}"`);
      await db.pool.query("DROP OWNED BY zz_trien_khai_117");
      await db.pool.query("DROP ROLE zz_trien_khai_117");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    }
  });
});
