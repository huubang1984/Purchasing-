import { TU_CHOI_GUC_SOM, createPool, migrate } from "@trustprocure/db";
import {
  startPostgres,
  withMigratedDatabase,
  type TestDatabase,
} from "@trustprocure/test-support";
import { readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { docHangHardening as docHangHardeningTu } from "./hardening-hang.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * [Task 8] Trạng thái CHUẨN của hai mục (E1)/(E2): cả hai hàm D3 còn nguyên thân + proconfig, và
 * cả hai trigger còn đó ở đúng hình dạng (FOR EACH ROW, AFTER INSERT OR UPDATE = tgtype 21) với
 * `tgenabled = 'A'` (ENABLE ALWAYS).
 *
 * Cố ý viết ĐỘC LẬP với hậu điều kiện trong hardening.always.sql thay vì trích lại nó: một phép
 * kiểm sao chép nguyên văn thứ nó đang kiểm sẽ xanh cùng lúc với thứ đó, kể cả khi cả hai sai.
 * `prosrc LIKE '%award.recommend%'` là vế bắt đường trôi nguy hiểm nhất — thân bị thay bằng
 * "BEGIN RETURN NULL; END" giữ nguyên tên hàm, tên trigger, tgfoid và tgenabled.
 */
async function trangThaiD3DungChuan(db: TestDatabase): Promise<boolean> {
  const { rows } = await db.pool.query<{ ok: boolean | null }>(
    "SELECT bool_and(t.ok) AS ok FROM (" +
      "  SELECT (p.proconfig = ARRAY['search_path=pg_catalog']" +
      "          AND p.prosrc LIKE '%award.recommend%'" +
      "          AND p.prosecdef IS FALSE" +
      "          AND EXISTS (SELECT 1 FROM pg_trigger tg" +
      "                       WHERE tg.tgrelid = to_regclass(x.bang)" +
      "                         AND tg.tgname = x.ten_trigger" +
      "                         AND NOT tg.tgisinternal" +
      "                         AND tg.tgfoid = p.oid" +
      "                         AND tg.tgenabled = 'A'" +
      "                         AND tg.tgtype = 21)) AS ok" +
      "    FROM (VALUES ('public.kiem_tra_phan_tach_nhiem_vu()', 'public.user_roles'," +
      "                  'user_roles_phan_tach_nhiem_vu')," +
      "                 ('public.kiem_tra_ma_tran_quyen()', 'public.role_permissions'," +
      "                  'role_permissions_ma_tran_quyen')) AS x(ham, bang, ten_trigger)" +
      "    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(x.ham)" +
      ") t",
  );
  return rows[0]?.ok === true;
}

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

/** Đổi user/password của một connection string, giữ nguyên host/port/database. */
function doiNguoiDung(pChuoiKetNoi: string, pTenRole: string, pMatKhau: string): string {
  const url = new URL(pChuoiKetNoi);
  url.username = pTenRole;
  url.password = pMatKhau;
  return url.toString();
}

interface MembershipConLai {
  nhom: string;
  thanh_vien: string;
  admin_option: boolean;
}

/**
 * [CR2-T3] Mọi tư cách thành viên còn sót chạm tới BỐN role được canh — hai role ứng dụng và
 * hai role đăng nhập được đưa vào danh sách trắng. Đọc cả `admin_option` vì một membership
 * hợp lệ kèm ADMIN OPTION vẫn là bàn đạp: chủ thể đó tự cấp được app_api cho bất kỳ ai.
 */
const CAU_MEMBERSHIP_CON_LAI =
  "SELECT nhom.rolname AS nhom, thanh_vien.rolname AS thanh_vien, am.admin_option " +
  "  FROM pg_auth_members am " +
  "  JOIN pg_roles nhom ON nhom.oid = am.roleid " +
  "  JOIN pg_roles thanh_vien ON thanh_vien.oid = am.member " +
  " WHERE nhom.rolname IN ('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login') " +
  "    OR thanh_vien.rolname IN ('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login') " +
  " ORDER BY 1, 2";

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
    // [S1.11] Ngân sách riêng: ca này dựng một container MỚI rồi chạy trọn 37 migration + ba lượt
    // hardening. Đo được: ~5 s khi chạy ba file; ~21 s trong `test:int` đầy đủ; chạm trần 30 s khi
    // `pnpm evidence` chạy cả hai tầng (đỏ hai lượt liên tiếp, không khẳng định nào sai). Các ca
    // sau trong file này cũng ở 25–30 s dưới cùng tải — chúng là cùng một ngân sách.
  }, 120_000);

  it("app_current_org_id trả NULL khi chưa gắn tổ chức — fail-closed", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    });
    // [ADR-016/017/018] Timeout tường minh 120s. Test này dựng MỘT container rồi chạy TOÀN BỘ
    // migration đánh số; số file đi từ 7 (S0) lên 16, và ở lần chạy TOÀN BỘ bộ test — nơi nhiều
    // file test tranh nhau Docker — nó vượt mặc định 30s. Nó xanh khi chạy riêng, tức đây là một
    // ngưỡng quá chật chứ không phải một hồi quy hiệu năng. Mọi test nặng khác trong file này đã
    // mang timeout tường minh 120–180s từ S0; test đầu tiên chỉ đơn giản chưa cần tới hôm nay.
  }, 120_000);

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

      // [Task 4] Từ khi 002 tạo policy RLS gọi hàm này, chính Postgres từ chối DROP thường:
      // "cannot drop function app_current_org_id() because other objects depend on it".
      // Đây là một lớp bảo vệ MỚI, có được miễn phí nhờ phụ thuộc catalog — không phải do
      // hardening. Khẳng định nó ở đây để nếu ai đó gỡ policy đi (làm hàm lại DROP được),
      // test này đỏ và bắt người sửa phải nhìn lại.
      await expect(db.pool.query("DROP FUNCTION public.app_current_org_id()")).rejects.toThrow(
        /other objects depend on it/i,
      );

      // Đường đi lọt là CASCADE — và nó kéo theo TOÀN BỘ policy. Hàm được hardening dựng lại,
      // nhưng policy thì KHÔNG (002 đã nằm trong schema_migrations). Xem test riêng bên dưới
      // về hình dạng policy: migrate() phải GÃY ỒN ÀO chứ không đi tiếp im lặng.
      await db.pool.query("DROP FUNCTION public.app_current_org_id() CASCADE");
      const loiCascade = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loiCascade).not.toBeNull();
      expect(loiCascade!.message).toContain("hình dạng policy RLS của bảng tenant");

      // Hàm vẫn được dựng lại trong chính lần chạy đó (câu lệnh cưỡng chế ở BƯỚC 2 chạy trước
      // khi BƯỚC 4 ném lỗi) — nhưng cả transaction bị rollback theo, nên phải khôi phục policy
      // rồi mới migrate lại được. Đây chính là đánh đổi đã công bố ở hardening.always.sql.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.app_current_org_id() RETURNS uuid LANGUAGE sql STABLE " +
          "AS $ac$ SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid $ac$",
      );
      // [Task 5] Danh sách này KHÔNG viết tay: từ khi 003 thêm hai bảng sổ, một danh sách cứng
      // sẽ khôi phục thiếu và test đỏ vì lý do không liên quan tới thứ nó đang đo. Đọc thẳng
      // tập bảng tenant từ catalog cho nó tự lớn theo lược đồ.
      // [S1.14 / 042] ~~Vế `org_id ... OR relname = 'organizations'` KHÔNG phải trang trí: nó là đúng~~
      // ~~`VI_TU_BANG_TENANT` của hardening.~~ **[S1.20 / review lượt 12, L4] Câu vừa gạch nay SAI:**
      // `VI_TU_BANG_TENANT` không còn vế `relname` — bảng gốc suy từ *đích của khoá ngoại `org_id`
      // MỘT CỘT trỏ tới cột `id`* (ADR-028). Bản sao ở đây phải đi theo, nếu không thì ngày có bảng
      // gốc tenant THỨ HAI, vòng khôi phục bên dưới sẽ không dựng policy cho nó và `migrate()` gãy
      // vì một lý do KHÔNG liên quan tới thứ test này đang đo.
      // Từ 042 có một bảng BẬT RLS mà KHÔNG thuộc cây tenant
      // (`caller_rate_limits` — bộ đếm theo người gọi, không `org_id`); policy của nó không nhắc tới
      // `app_current_org_id()` nên `DROP ... CASCADE` ở trên không chạm, và dựng cho nó một policy
      // `id = app_current_org_id()` là dựng một policy trên cột không tồn tại.
      const { rows: bangTenant } = await db.pool.query<{ ten: string; cot: string }>(
        "SELECT c.relname AS ten, " +
          "       CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid " +
          "                          AND a.attname = 'org_id' AND a.attnum > 0 " +
          "                          AND NOT a.attisdropped) THEN 'org_id' ELSE 'id' END AS cot " +
          "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
          " WHERE n.nspname = 'public' AND c.relrowsecurity " +
          "   AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid " +
          "                 AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped) " +
          "        OR EXISTS (SELECT 1 FROM pg_constraint fk " +
          "                     JOIN pg_class fkb ON fkb.oid = fk.conrelid " +
          "                     JOIN pg_namespace fkn ON fkn.oid = fkb.relnamespace " +
          "                    WHERE fk.confrelid = c.oid AND fk.contype = 'f' " +
          "                      AND fkn.nspname = 'public' " +
          "                      AND array_length(fk.conkey, 1) = 1 " +
          "                      AND EXISTS (SELECT 1 FROM pg_attribute fka " +
          "                                   WHERE fka.attrelid = fkb.oid " +
          "                                     AND fka.attnum = fk.conkey[1] " +
          "                                     AND fka.attname = 'org_id' " +
          "                                     AND NOT fka.attisdropped) " +
          "                      AND EXISTS (SELECT 1 FROM pg_attribute fkd " +
          "                                   WHERE fkd.attrelid = c.oid " +
          "                                     AND fkd.attnum = fk.confkey[1] " +
          "                                     AND fkd.attname = 'id' " +
          "                                     AND NOT fkd.attisdropped))) ORDER BY 1",
      );
      expect(bangTenant.length, "không có bảng tenant nào để khôi phục").toBeGreaterThan(1);
      for (const { ten, cot } of bangTenant) {
        await db.pool.query(
          `CREATE POLICY ${ten}_tenant_isolation ON ${ten} ` +
            `USING (${cot} = app_current_org_id()) WITH CHECK (${cot} = app_current_org_id())`,
        );
      }
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

  // [S1.11 / 037 / review H3-4] Cùng đánh đổi với R3, cho vị từ `la_duong_ung_dung(name)`: thân
  // hàm nằm ở 037 VÀ ở hardening. Đọc bằng regex riêng (hàm này có `SET search_path`, nên regex
  // của R3 cố ý KHÔNG khớp nó — R3 vẫn đòi đúng một định nghĩa mỗi file).
  it("[S1.11] định nghĩa la_duong_ung_dung(name) trong 037 và trong hardening.always.sql khớp nhau, và khớp hậu điều kiện", () => {
    const docThan = (tenFile: string): string => {
      const duongDan = fileURLToPath(new URL(`./migrations/${tenFile}`, import.meta.url));
      const noiDung = readFileSync(duongDan, "utf8");
      const khop = [
        ...noiDung.matchAll(
          /FUNCTION public\.la_duong_ung_dung\(ten_vai pg_catalog\.name\) RETURNS boolean\s+LANGUAGE sql STABLE\s+SET search_path = pg_catalog\s+AS \$(\w*)\$([\s\S]*?)\$\1\$/g,
        ),
      ];
      expect(khop, tenFile).toHaveLength(1);
      return khop[0]![2]!.replace(/\s+/g, " ").trim();
    };
    const than037 = docThan("037_vai_ung_dung_la_thanh_vien.sql");
    expect(docThan("hardening.always.sql")).toBe(than037);
    // Hậu điều kiện so `prosrc` đã chuẩn hoá với một chuỗi viết tay — chuỗi ấy phải là chính thân này.
    const hardening = readFileSync(fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url)), "utf8");
    const hau = /\$than\$(SELECT pg_catalog\.pg_has_role[^$]*)\$than\$/.exec(hardening)?.[1];
    expect(hau).toBe(than037);
  });

  it("[S1.11] hardening khôi phục thân la_duong_ung_dung(name) bị thay và ACL bị nới ở lần migrate() sau", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      // Đột biến đúng như vai-tro.int.test.ts: vị từ chỉ đọc tên — hai trigger đăng nhập im lặng trên đường sản xuất.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.la_duong_ung_dung(ten_vai pg_catalog.name) RETURNS boolean LANGUAGE sql STABLE " +
          "SET search_path = pg_catalog AS $x$ SELECT current_user OPERATOR(pg_catalog.=) ten_vai $x$",
      );
      await db.pool.query("GRANT EXECUTE ON FUNCTION public.la_duong_ung_dung(pg_catalog.name) TO PUBLIC");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows } = await db.pool.query<{ than: string; pub: boolean; api: boolean }>(
        `SELECT btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS than,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub,
                has_function_privilege('app_api', p.oid, 'EXECUTE') AS api
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.la_duong_ung_dung(pg_catalog.name)')`,
      );
      expect(rows[0]?.than).toContain("pg_has_role(current_user, ten_vai, 'USAGE')");
      expect(rows[0]?.than).toContain("r.rolsuper");
      expect(rows[0]?.pub).toBe(false);
      expect(rows[0]?.api).toBe(true);
    } finally {
      await db.stop();
    }
  });

  // [S1.13 / sổ nợ 51 / review H4-7] Năm hàm trigger của 039/040/041 và sáu trigger của chúng được
  // hardening ghim THÂN + định nghĩa trigger, cùng khuôn `la_duong_ung_dung` (chỉ canh khi hàm đã tồn
  // tại). Hai lớp đo: (1) tĩnh — thân trong migration và thân trong hardening khớp nhau, và hậu điều
  // kiện `$than$` là chính thân ấy; (2) trôi — thay thân thành no-op, DROP một trigger, DISABLE một
  // trigger ⇒ `migrate()` khôi phục cả ba.
  // [review H5-5] Thêm 013 (thân, không ghim 21 trigger), 029/032 qua bản 037, và hai trigger danh tính 040.
  const HAM_51: readonly { ham: string; migration: string; trigger: readonly string[] }[] = [
    {
      ham: "kiem_danh_tinh_theo_phien",
      migration: "013_actor_from_session.sql",
      // [review H6-6] MƯỜI CHÍN trigger — viết ra để phép kiểm "mỗi trigger có định nghĩa ghim" có
      // việc; hai trigger còn lại của hàm này thuộc 040 và được ghim ở mục `mfa_reset_kiem_quyen`.
      trigger: [
        "org_procurement_policies_kiem_danh_tinh",
        "rfq_budgets_kiem_danh_tinh",
        "rfq_invitation_tokens_kiem_danh_tinh",
        "rfq_invitations_kiem_danh_tinh",
        "rfq_invitations_kiem_nguoi_thu_hoi",
        "rfq_items_kiem_danh_tinh",
        "rfq_key_material_kiem_danh_tinh",
        "rfq_key_material_kiem_nguoi_thu_hoi",
        "rfq_key_material_kiem_nguoi_xoa",
        "rfq_packages_kiem_nguoi_dong",
        "rfq_packages_kiem_nguoi_huy",
        "rfq_packages_kiem_nguoi_mo",
        "rfq_packages_kiem_nguoi_nop",
        "supplier_contacts_kiem_danh_tinh",
        "suppliers_kiem_danh_tinh",
        "unseal_approvals_kiem_danh_tinh",
        "unseal_requests_kiem_danh_tinh",
        "unseal_requests_kiem_nguoi_dieu_phoi",
        "unseal_requests_kiem_nhan_chung",
      ],
    },
    { ham: "sessions_kiem_mfa_khi_tao", migration: "037_vai_ung_dung_la_thanh_vien.sql", trigger: ["sessions_kiem_mfa_khi_tao"] },
    { ham: "mfa_credentials_khoa_ho_so_da_xac_nhan", migration: "037_vai_ung_dung_la_thanh_vien.sql", trigger: ["mfa_credentials_khoa_ho_so_da_xac_nhan"] },
    { ham: "sessions_kiem_totp_gan_day", migration: "039_phien_can_totp_gan_day.sql", trigger: ["sessions_kiem_totp_gan_day"] },
    { ham: "mfa_reset_kiem_quyen", migration: "040_dat_lai_totp_hai_nguoi.sql", trigger: ["mfa_reset_requests_kiem_quyen_yeu_cau", "mfa_reset_requests_kiem_quyen_duyet", "mfa_reset_requests_kiem_danh_tinh", "mfa_reset_requests_kiem_danh_tinh_duyet"] },
    { ham: "mfa_reset_kiem_chuyen_trang_thai", migration: "040_dat_lai_totp_hai_nguoi.sql", trigger: ["mfa_reset_requests_kiem_chuyen_trang_thai"] },
    { ham: "mfa_credentials_xoa_can_yeu_cau", migration: "040_dat_lai_totp_hai_nguoi.sql", trigger: ["mfa_credentials_xoa_can_yeu_cau"] },
    { ham: "outbox_jobs_xoa_payload_dang_nhap", migration: "041_outbox_payload_dang_nhap_xoa_sau_xong.sql", trigger: ["outbox_jobs_xoa_payload_dang_nhap"] },
  ];

  // [S1.15 / sổ nợ 56] BA MƯƠI LĂM hàm còn lại, ghim trong cùng khuôn. `migration` là file ĐÁNH SỐ
  // LỚN NHẤT định nghĩa hàm ấy — bảy hàm ở đây được `CREATE OR REPLACE` nhiều lần, và ghim nhầm bản
  // cũ làm `migrate()` LÙI hàm về bản ấy ở MỌI lần chạy. Có phép kiểm riêng bên dưới cho đúng điều đó.
  const HAM_56: readonly { ham: string; migration: string; trigger: readonly string[] }[] = [
    // [S1.20 / sổ nợ 16] `047` định nghĩa lại thân hàm này (thông điệp đọc `TG_OP`) và thêm BA
    // trigger `_chan_truncate` — nên bản ghim phải trỏ sang `047`, đúng quy tắc "migration CUỐI
    // CÙNG" mà chính khoản nợ 56 dựng ra. Sáu trigger, không phải ba.
    { ham: "bid_chi_ghi_them", migration: "047_chi_ghi_them_chan_truncate.sql", trigger: ["bid_receipts_chan_truncate", "bid_receipts_chi_ghi_them", "rfq_unsealed_bids_chan_truncate", "rfq_unsealed_bids_chi_ghi_them", "vendor_bid_versions_chan_truncate", "vendor_bid_versions_chi_ghi_them"] },
    { ham: "bid_dat_so_phien_ban", migration: "018_vendor_bids.sql", trigger: ["a_vendor_bid_versions_dat_so_phien_ban"] },
    { ham: "bid_kiem_han_nop", migration: "018_vendor_bids.sql", trigger: ["vendor_bid_versions_kiem_han_nop"] },
    { ham: "bid_kiem_phien_khach", migration: "018_vendor_bids.sql", trigger: ["vendor_bid_versions_kiem_phien_khach"] },
    { ham: "bid_phai_co_bien_nhan", migration: "018_vendor_bids.sql", trigger: ["vendor_bid_versions_phai_co_bien_nhan"] },
    { ham: "chinh_sach_phien_ban_tang_dan", migration: "035_phien_ban_chinh_sach_lien_tuc.sql", trigger: ["org_procurement_policies_phien_ban_tang_dan"] },
    { ham: "guest_session_kiem_danh_tinh", migration: "012_invitation_hardening.sql", trigger: ["guest_sessions_kiem_danh_tinh"] },
    { ham: "kiem_tra_nguong_khong_cung_tay_nguoi_dung", migration: "033_policy_manage_khong_cung_tay.sql", trigger: ["user_roles_nguong_khong_cung_tay"] },
    { ham: "kiem_tra_nguong_khong_cung_tay_vai_tro", migration: "033_policy_manage_khong_cung_tay.sql", trigger: ["role_permissions_nguong_khong_cung_tay"] },
    { ham: "loi_moi_khong_song_lai", migration: "022_security_review_s1.sql", trigger: ["rfq_invitations_khong_song_lai"] },
    { ham: "otp_go_khoa_khong_xoa_dau_vet", migration: "024_moi_lai_va_tran_chi_phi.sql", trigger: ["invitation_otp_go_khoa_khong_xoa_dau_vet"] },
    { ham: "otp_kiem_kenh_khac_link", migration: "022_security_review_s1.sql", trigger: ["invitation_otp_kiem_kenh"] },
    { ham: "rfq_budgets_chi_sua_khi_soan", migration: "014_procurement_policy.sql", trigger: ["rfq_budgets_chi_sua_khi_soan"] },
    { ham: "rfq_gia_han_khong_hoi_sinh", migration: "022_security_review_s1.sql", trigger: ["rfq_packages_gia_han_khong_hoi_sinh"] },
    { ham: "rfq_items_cam_truncate", migration: "011_rfq_hardening.sql", trigger: ["rfq_items_cam_truncate"] },
    { ham: "rfq_items_chi_sua_khi_soan", migration: "011_rfq_hardening.sql", trigger: ["rfq_items_chi_sua_khi_soan"] },
    { ham: "rfq_key_material_bat_bien", migration: "026_xoa_mat_ma_vat_lieu_khoa.sql", trigger: ["rfq_key_material_bat_bien"] },
    { ham: "rfq_khoa_chi_sinh_luc_mo", migration: "017_rfq_key_material.sql", trigger: ["rfq_key_material_chi_sinh_luc_mo"] },
    { ham: "rfq_khoa_chi_thu_hoi_khi_huy", migration: "017_rfq_key_material.sql", trigger: ["rfq_key_material_chi_thu_hoi_khi_huy"] },
    { ham: "rfq_khoa_phai_di_kem_lan_mo", migration: "017_rfq_key_material.sql", trigger: ["rfq_key_material_phai_di_kem_lan_mo"] },
    { ham: "rfq_kiem_chuyen_trang_thai", migration: "011_rfq_hardening.sql", trigger: ["rfq_packages_kiem_chuyen_trang_thai"] },
    { ham: "rfq_kiem_khoa_khi_mo", migration: "017_rfq_key_material.sql", trigger: ["rfq_packages_kiem_khoa_khi_mo"] },
    { ham: "rfq_kiem_nguoi_duyet", migration: "011_rfq_hardening.sql", trigger: ["rfq_approvals_kiem_nguoi_duyet"] },
    { ham: "rfq_kiem_nguoi_tao", migration: "011_rfq_hardening.sql", trigger: ["rfq_packages_kiem_nguoi_tao"] },
    { ham: "rfq_kiem_nguong_phe_duyet_kep", migration: "014_procurement_policy.sql", trigger: ["rfq_packages_kiem_nguong_phe_duyet_kep"] },
    { ham: "rfq_kiem_yeu_cau_mo_thau", migration: "019_unseal.sql", trigger: ["rfq_packages_kiem_yeu_cau_mo_thau"] },
    { ham: "thu_hoi_don_dieu", migration: "012_invitation_hardening.sql", trigger: ["guest_sessions_thu_hoi_don_dieu", "invitation_otp_thu_hoi_don_dieu", "rfq_invitation_tokens_thu_hoi_don_dieu", "rfq_invitations_thu_hoi_don_dieu", "user_login_tokens_thu_hoi_don_dieu"] },
    { ham: "unseal_canh_bao_break_glass", migration: "019_unseal.sql", trigger: ["unseal_requests_canh_bao_break_glass"] },
    { ham: "unseal_dieu_phoi_mot_lan", migration: "022_security_review_s1.sql", trigger: ["unseal_requests_dieu_phoi_mot_lan"] },
    { ham: "unseal_kiem_chuyen_trang_thai", migration: "019_unseal.sql", trigger: ["unseal_requests_kiem_chuyen_trang_thai"] },
    { ham: "unseal_kiem_du_phe_duyet", migration: "022_security_review_s1.sql", trigger: ["unseal_requests_kiem_du_phe_duyet"] },
    { ham: "unseal_kiem_nguoi_duyet", migration: "019_unseal.sql", trigger: ["unseal_approvals_kiem_nguoi_duyet"] },
    { ham: "unseal_kiem_rfq_da_dong", migration: "019_unseal.sql", trigger: ["unseal_requests_kiem_rfq_da_dong"] },
    { ham: "unseal_kiem_yeu_cau_khi_ghi_ban_ro", migration: "019_unseal.sql", trigger: ["rfq_unsealed_bids_kiem_yeu_cau"] },
    { ham: "users_thu_hoi_phien_khi_dinh_chi", migration: "034_dinh_chi_thu_hoi_phien.sql", trigger: ["users_thu_hoi_phien_khi_dinh_chi"] },
  ];

  /** Mọi hàm trigger được hardening ghim — hai khối, một khuôn. */
  const HAM_GHIM = [...HAM_51, ...HAM_56];

  it("[S1.13 / nợ 51 · S1.15 / nợ 56] ~~năm~~ ~~tám~~ BỐN MƯƠI BA thân hàm trigger trong migration và trong hardening.always.sql khớp nhau, và khớp hậu điều kiện $than$", () => {
    const docFile = (tenFile: string): string => readFileSync(fileURLToPath(new URL(`./migrations/${tenFile}`, import.meta.url)), "utf8");
    const hardening = docFile("hardening.always.sql");
    const chuanHoa = (s: string): string => s.replace(/\s+/g, " ").trim();
    for (const { ham, migration, trigger } of HAM_GHIM) {
      const reMig = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${ham}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql\\s+SET search_path = [^\\n]+?\\s+AS \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`, "g");
      const khopMig = [...docFile(migration).matchAll(reMig)];
      expect(khopMig, `${ham} trong ${migration}`).toHaveLength(1);
      const thanMig = chuanHoa(khopMig[0]![2]!);
      const reHard = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${ham}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql SET search_path = [^\\n]+? AS \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`, "g");
      const khopHard = [...hardening.matchAll(reHard)];
      expect(khopHard, `${ham} trong hardening`).toHaveLength(1);
      expect(chuanHoa(khopHard[0]![2]!), ham).toBe(thanMig);
      // Hậu điều kiện: `$than$...$than$` đầu tiên SAU mục mang tên hàm là chính thân đã chuẩn hoá.
      const viTri = hardening.indexOf(`hàm + trigger ${ham} (`);
      expect(viTri, `mục hardening cho ${ham}`).toBeGreaterThan(0);
      const hau = /\$than\$([\s\S]*?)\$than\$/.exec(hardening.slice(viTri))?.[1];
      expect(hau, ham).toBe(thanMig);
      // Và mỗi trigger có một định nghĩa ghim (`$def$...$def$`) trong cùng mục.
      // Cắt tới mục KẾ TIẾP, không cắt theo số byte: mục 013 mang 19 khối trigger nên mọi hằng số
      // byte đều là một cái bẫy chờ sẵn.
      const ketMuc = hardening.indexOf("$q$hàm + trigger ", viTri + 20);
      const than = hardening.slice(viTri, ketMuc === -1 ? undefined : ketMuc);
      // [S1.15 / nợ 56] `CONSTRAINT TRIGGER` cũng là một trigger, và hai cái trong lược đồ này là
      // constraint trigger (`vendor_bid_versions_phai_co_bien_nhan` — 018,
      // `rfq_key_material_phai_di_kem_lan_mo` — 017: cả hai DEFERRABLE INITIALLY DEFERRED, tức
      // chúng canh ở thời điểm COMMIT). Bản trước tìm đúng chuỗi `CREATE TRIGGER `, nên khi khối
      // ghim của nợ 56 mang chúng vào, phép kiểm này đỏ vì một lý do SAI — nó không thấy trigger,
      // trong khi trigger có mặt và đúng.
      for (const t of trigger) {
        expect(than, `${t} trong mục ${ham}`).toMatch(
          new RegExp(String.raw`CREATE (?:CONSTRAINT )?TRIGGER ${t} `),
        );
      }
    }
  });

  // [S1.15 / sổ nợ 56] Bản ghim phải trỏ vào định nghĩa CUỐI CÙNG, không phải định nghĩa đầu tiên.
  //
  // Đây là một lớp mà bốn vòng trước KHÔNG có, và nó không phải lo xa: bảy trong ba mươi lăm hàm
  // vừa ghim được `CREATE OR REPLACE` nhiều lần (`otp_kiem_kenh_khac_link` ba lần). Hardening chạy
  // TRƯỚC vòng migration đánh số, và migration cũ đã có dòng trong `schema_migrations` nên không
  // chạy lại — nên một bản ghim trỏ vào thân CŨ làm `migrate()` LÙI hàm về thân ấy ở MỌI lần triển
  // khai, vĩnh viễn, trong im lặng. Test đồng bộ ở trên KHÔNG bắt được ca đó: nó so hardening với
  // đúng file được khai, và hai bên khớp nhau hoàn hảo — chỉ là khớp vào bản sai.
  it("[S1.15 / nợ 56] migration ghi trong mỗi mục ghim là migration CUỐI CÙNG định nghĩa hàm ấy", () => {
    const thuMuc = fileURLToPath(new URL("./migrations", import.meta.url));
    const tenFile = readdirSync(thuMuc)
      .filter((f) => /^\d{3}_.*\.sql$/u.test(f))
      .sort();
    for (const { ham, migration } of HAM_GHIM) {
      const dinhNghiaO = tenFile.filter((f) =>
        new RegExp(String.raw`CREATE (?:OR REPLACE )?FUNCTION public\.${ham}\(\)`).test(
          readFileSync(`${thuMuc}/${f}`, "utf8"),
        ),
      );
      expect(dinhNghiaO, `không migration nào định nghĩa ${ham}`).not.toEqual([]);
      expect(dinhNghiaO.at(-1), `${ham}: hardening ghim ${migration} nhưng bản CUỐI ở ${dinhNghiaO.at(-1)}`).toBe(
        migration,
      );
    }
  });

  // [S1.15 / sổ nợ 56 / 045] MỌI trigger trong `public` ở trạng thái ALWAYS — suy từ tính chất, không
  // từ danh sách tên. `043` nâng mười chín cái, `045` nâng ba mươi bảy cái còn lại; sau đó câu phát
  // biểu đúng của lược đồ là "không còn trigger ORIGIN nào", và một migration tương lai thêm một
  // trigger ORIGIN sẽ ĐỎ ở đây thay vì lặng lẽ nhận độ mạnh thấp hơn hàng xóm của nó.
  it("[S1.15 / nợ 56] không trigger nào trong public còn ở ORIGIN — 'replica' không bỏ qua được cái nào", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows } = await db.pool.query<{ ten: string; bang: string; en: string }>(
        `SELECT t.tgname AS ten, c.relname AS bang, t.tgenabled::text AS en
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT t.tgisinternal
          ORDER BY 1`,
      );
      // Chốt chống rỗng ruột trước: nếu truy vấn không thấy trigger nào thì khẳng định dưới vô nghĩa.
      expect(rows.length).toBeGreaterThanOrEqual(80);
      expect(rows.filter((r) => r.en !== "A").map((r) => `${r.bang}.${r.ten}:${r.en}`)).toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ============================================================================================
  // [S1.14 / sổ nợ 54 / review H5-5] DANH SÁCH GHIM KHÔNG ĐƯỢC TỰ LÀM MÙ MÌNH
  //
  // Hardening ghim thân hàm trigger theo một danh sách VIẾT TAY. Hai lần trước, danh sách ấy thiếu
  // đúng thứ vừa được thêm (H4-7 rồi H5-5), và không lớp nào kêu — vì không có gì so danh sách với
  // THỰC TẾ. Test này là lớp ấy: tập hàm `RETURNS trigger` trong `public` phải bằng ĐÚNG
  //   (hàm được hardening nhắc tới) ∪ (danh sách loại trừ dưới đây),
  // và hai tập không giao nhau. Thêm một hàm trigger mới mà không ghim cũng không khai ⇒ ĐỎ.
  //
  // LOẠI TRỪ NGHĨA LÀ GÌ Ở ĐÂY — nói thẳng: **chưa ghim**, không phải "không cần ghim". ~~Cả 35 hàm
  // dưới đây canh một bất biến thật ở CSDL và đều thuộc cùng lớp trôi R3 (một `CREATE OR REPLACE
  // FUNCTION … BEGIN RETURN NEW; END` sau triển khai làm chúng no-op và sống qua `migrate()`).
  // Chúng nằm ở **sổ nợ 56**, và thứ tự đóng đã ghi ở đó. Giá trị mỗi dòng là thứ hàm ấy canh —
  // viết ra để lần ghim sau không phải đọc lại bảy migration.~~
  //
  // [S1.15] Ba mươi lăm dòng ấy đã đi hết: sổ nợ 56 đóng, danh sách RỖNG, và khẳng định bên dưới
  // giữ cho nó rỗng. Câu định nghĩa ở trên GIỮ NGUYÊN vì nó vẫn đúng cho ngày có dòng thứ nhất
  // quay lại: loại trừ là CHƯA ghim.
  const HAM_TRIGGER_KHONG_GHIM: Readonly<Record<string, string>> = {
    // [S1.15 / sổ nợ 56] RỖNG, và rỗng là trạng thái ĐÚNG kể từ vòng này: ba mươi lăm dòng từng
    // đứng ở đây nay có mục ghim thật trong `hardening.always.sql`. Danh sách KHÔNG bị xoá đi cùng
    // với nợ 56 vì nó vẫn là cửa duy nhất cho ngày có một hàm trigger mà ghim thân là sai — nhưng
    // mở cửa ấy nay là một quyết định phải viết ra ở HAI chỗ (dòng ở đây, và con số 0 bên dưới).
  };

  it("[S1.14 / nợ 54] mọi hàm RETURNS trigger trong public: hoặc hardening có canh, hoặc nằm trong danh sách loại trừ CÓ LÝ DO", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows } = await db.pool.query<{ ten: string }>(
        `SELECT p.proname AS ten FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'public' AND p.prorettype = 'pg_catalog.trigger'::regtype ORDER BY 1`,
      );
      const trongCsdl = rows.map((r) => r.ten);
      // Tập "hardening có canh" KHÔNG viết tay: rút thẳng từ file hardening rồi giao với tập hàm
      // trigger thật. Viết tay ở đây là dựng lại đúng cái mù.
      //
      // [review H6-3] Rút theo HÌNH DẠNG của một mục ghim, KHÔNG theo một lần nhắc tên. Bản trước
      // dùng mọi `to_regprocedure('public.X()')`, tức một hàm chỉ xuất hiện trong tiền điều kiện của
      // mục KHÁC cũng được tính là "đã ghim" — và khi ấy nó vừa ở `ghim` vừa ở danh sách loại trừ,
      // nên cách rẻ nhất để test xanh trở lại là XOÁ nó khỏi danh sách loại trừ. Test khi đó tự mời
      // người sửa nói dối, đúng hình dạng cái mù mà nợ 54 tồn tại để đóng.
      const hardening = readFileSync(fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url)), "utf8");
      // Tiêu chí: hardening có CÂU SỬA dựng lại thân hàm ấy, VÀ có nhắc nó trong một câu phán xét/
      // tiền điều kiện. Một lần nhắc tên đơn độc (tiền điều kiện của mục khác) KHÔNG còn đủ.
      const ghim = trongCsdl.filter(
        (t) =>
          hardening.includes(`CREATE OR REPLACE FUNCTION public.${t}() RETURNS trigger`) &&
          hardening.includes(`to_regprocedure('public.${t}()')`),
      );
      // Và danh sách viết tay `HAM_51` không được trôi ra ngoài tập ấy.
      expect(HAM_51.map((h) => h.ham).filter((h) => !ghim.includes(h)), "HAM_51 có tên không còn được ghim").toEqual([]);
      const loaiTru = Object.keys(HAM_TRIGGER_KHONG_GHIM);
      expect(ghim.filter((t) => loaiTru.includes(t)), "một hàm không được vừa ghim vừa loại trừ").toEqual([]);
      expect([...ghim, ...loaiTru].sort()).toEqual([...trongCsdl].sort());
      // [S1.15 / sổ nợ 56] Vế MẠNH HƠN, và là vế đóng khoản nợ ấy: danh sách loại trừ RỖNG, tức
      // phép hợp ở trên nay là "tập ghim BẰNG tập thật". Thêm một dòng vào `HAM_TRIGGER_KHONG_GHIM`
      // làm khẳng định này ĐỎ — cố ý: đó là MỞ LẠI sổ nợ 56, và nó phải được viết ra ở STATE chứ
      // không lặng lẽ thành một dòng trong một map.
      expect(
        loaiTru,
        "sổ nợ 56 đã đóng — mọi hàm trigger đều có mục ghim. Thêm một loại trừ là MỞ LẠI khoản nợ ấy",
      ).toEqual([]);
      for (const [ten, lyDo] of Object.entries(HAM_TRIGGER_KHONG_GHIM)) {
        expect(lyDo.length, `loại trừ ${ten} phải có lý do`).toBeGreaterThan(10);
      }
      // [S1.15 / review H7-2] Vòng ngay trên nay chạy 0 lần (danh sách RỖNG — sổ nợ 56), tức nó là
      // MÃ CHẾT: bỏ nó đi không test nào đỏ. Cùng khuôn `[I2]` đã dùng khi `NGOAI_LE_HINH_DANG` còn
      // rỗng — đo THẲNG quy tắc thay vì chờ ca dùng đầu tiên xuất hiện lúc không ai còn nhìn.
      const quyTacLyDo = (m: Readonly<Record<string, string>>): string[] =>
        Object.entries(m)
          .filter(([, lyDo]) => lyDo.length <= 10)
          .map(([ten]) => ten);
      expect(quyTacLyDo({ ham_gia: "canh mọi thứ, thật đấy" })).toEqual([]);
      expect(quyTacLyDo({ ham_gia: "vì thế" }), "lý do rỗng ruột phải bị bắt").toEqual(["ham_gia"]);
      // [review H6-6] Trục THỨ HAI của cùng cái mù: tập TRIGGER. `kiem_danh_tinh_theo_phien` chạy
      // trên nhiều bảng, nên một migration tương lai gắn trigger thứ 22 mà không khai sẽ đi qua phép
      // kiểm hàm ở trên mà không ai thấy. Tập trigger của nó phải bằng ĐÚNG (19 ghim ở mục 013) ∪
      // (2 ghim ở mục `mfa_reset_kiem_quyen`).
      //
      // [S1.15 / review H7-1] Vế ấy nay áp cho MỌI hàm được ghim, không riêng một hàm. H6-6 đóng
      // đúng cái mù nó thấy — trên hàm chạy trên nhiều bảng — nhưng để nguyên cùng cái mù ấy cho
      // bốn mươi hai hàm còn lại: mục ghim chỉ đòi các trigger ĐÃ KHAI phải tồn tại, nên gắn thêm
      // một trigger cho một hàm đã ghim (vd. `bid_chi_ghi_them` lên một bảng mới) đi qua mọi lớp
      // trong im lặng, và trigger ấy KHÔNG có định nghĩa ghim nào canh. Suy từ CSDL, không từ danh sách.
      const { rows: moiTrigger } = await db.pool.query<{ ham: string; ten: string }>(
        `SELECT p.proname AS ham, t.tgname AS ten
           FROM pg_trigger t
           JOIN pg_proc p ON p.oid = t.tgfoid
           JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE NOT t.tgisinternal AND ns.nspname = 'public'
          ORDER BY 1, 2`,
      );
      // So theo TÊN chứ không theo (hàm → tập trigger của hàm ấy), và đó không phải sự tiện tay:
      // hai trigger `mfa_reset_requests_kiem_danh_tinh*` CHẠY `kiem_danh_tinh_theo_phien` nhưng được
      // ghim trong mục của `mfa_reset_kiem_quyen` (chúng ra đời ở 040 cùng bảng ấy). Khoá theo hàm
      // sẽ báo đỏ đúng cặp ấy vì một lý do sai. Tính chất CẦN giữ là: mỗi trigger đang chạy một hàm
      // ĐÃ GHIM phải có một định nghĩa `$def$` ở đâu đó trong khối ghim, và ngược lại.
      const hamDaGhim = new Set(HAM_GHIM.map((h) => h.ham));
      const trigThat = moiTrigger
        .filter((r) => hamDaGhim.has(r.ham))
        .map((r) => r.ten)
        .sort();
      const trigKhai = HAM_GHIM.flatMap((h) => [...h.trigger]).sort();
      expect(
        trigKhai.filter((t, i) => trigKhai.indexOf(t) !== i),
        "một tên trigger khai ở hai mục — bản ghim nào có hiệu lực là không đọc được",
      ).toEqual([]);
      expect(trigThat, "trigger có thật mà mục ghim không khai — không định nghĩa nào canh nó").toEqual(
        trigKhai,
      );
      const { rows: trg } = await db.pool.query<{ ten: string }>(
        `SELECT t.tgname AS ten FROM pg_trigger t
          WHERE NOT t.tgisinternal AND t.tgfoid = to_regprocedure('public.kiem_danh_tinh_theo_phien()')
          ORDER BY 1`,
      );
      const daKhai = [
        ...(HAM_51.find((h) => h.ham === "kiem_danh_tinh_theo_phien")?.trigger ?? []),
        "mfa_reset_requests_kiem_danh_tinh",
        "mfa_reset_requests_kiem_danh_tinh_duyet",
      ];
      expect(trg.map((r) => r.ten).sort()).toEqual([...daKhai].sort());
      // Chốt chống rỗng ruột: tập ghim phải có thật, và tổng phải là con số đã đo.
      // ~~cả hai tập đều phải có thật~~ — tập loại trừ nay RỖNG có chủ đích (sổ nợ 56).
      expect(ghim.length).toBe(trongCsdl.length);
      expect(trongCsdl.length).toBeGreaterThanOrEqual(48);
    } finally {
      await db.stop();
    }
  }, 180_000);

  it("[S1.13 / nợ 51] hardening khôi phục thân hàm trigger bị thay thành no-op, trigger bị DROP, trigger bị DISABLE, và [H5-2] hàm bị DROP … CASCADE ở lần migrate() sau", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      // Ba đột biến, ba hàm khác nhau — mỗi cái là một ca R3 đã đo: sống qua migrate() nếu không ghim.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.mfa_reset_kiem_chuyen_trang_thai() RETURNS trigger LANGUAGE plpgsql " +
          "SET search_path = pg_catalog AS $x$ BEGIN RETURN NEW; END $x$",
      );
      await db.pool.query("DROP TRIGGER outbox_jobs_xoa_payload_dang_nhap ON public.outbox_jobs");
      await db.pool.query("ALTER TABLE public.sessions DISABLE TRIGGER sessions_kiem_totp_gan_day");
      await db.pool.query("CREATE OR REPLACE FUNCTION public.mfa_reset_kiem_quyen() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN RETURN NEW; END $x$");
      // [review H5-2] DROP … CASCADE xoá cả hàm lẫn trigger: với tiền điều kiện "hàm đã tồn tại" mục hardening
      // im lặng bỏ qua; với "migration nguồn đã áp dụng" nó dựng lại. [H5-5] Thêm 029-qua-037 và trigger danh tính 040.
      await db.pool.query("DROP FUNCTION public.mfa_credentials_xoa_can_yeu_cau() CASCADE");
      await db.pool.query("DROP FUNCTION public.sessions_kiem_mfa_khi_tao() CASCADE");
      await db.pool.query("DROP TRIGGER mfa_reset_requests_kiem_danh_tinh_duyet ON public.mfa_reset_requests");
      // [S1.14 / nợ 54] Một trong MƯỜI CHÍN trigger danh tính của 013 (ở đây: 019) — chúng nằm rải
      // bảy migration và tới S1.14 mới được ghim định nghĩa.
      await db.pool.query("DROP TRIGGER unseal_requests_kiem_danh_tinh ON public.unseal_requests");
      // [S1.15 / nợ 56] Ba đột biến trên nhóm ba mươi lăm hàm vừa ghim, mỗi cái một hình dạng khác:
      // ⑴ máy trạng thái RFQ thành no-op (thân hàm — bản NGUỒN ở 011, không phải 009);
      // ⑵ một trigger append-only bị DROP;
      // ⑶ một trigger bị HẠ từ ALWAYS xuống ORIGIN — ca mà `043`/`045` tồn tại để chặn, và là ca mà
      //    bản ghim `tgenabled = 'A'` là lớp DUY NHẤT nhìn thấy.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.rfq_kiem_chuyen_trang_thai() RETURNS trigger LANGUAGE plpgsql " +
          "SET search_path = pg_catalog, public AS $x$ BEGIN RETURN NEW; END $x$",
      );
      await db.pool.query("DROP TRIGGER vendor_bid_versions_chi_ghi_them ON public.vendor_bid_versions");
      await db.pool.query(
        "ALTER TABLE public.unseal_requests ENABLE REPLICA TRIGGER unseal_requests_kiem_chuyen_trang_thai",
      );
      // [review H6-7] `caller_rate_limits` (042) nằm NGOÀI cây tenant, nên mục (A) của hardening
      // không với tới nó: trước H6-7, hai câu dưới đây sống qua mọi lần `migrate()`.
      await db.pool.query("ALTER TABLE public.caller_rate_limits DISABLE ROW LEVEL SECURITY");
      await db.pool.query("DROP POLICY caller_rate_limits_khach ON public.caller_rate_limits");
      // [S1.15 / sổ nợ 57] Policy dọn của `otp_rate_limits` (044). Nó KHÔNG được nguồn (i) của
      // `CAU_POLICY_SAI` che: nguồn ấy chỉ kêu khi bảng hết sạch policy PERMISSIVE, mà bảng này còn
      // policy cách ly. Gỡ nó đi thì mọi lớp im lặng và thứ duy nhất đổi là bộ dọn xoá 0 hàng —
      // tức sổ nợ 57 quay lại mà không ai kêu.
      await db.pool.query("DROP POLICY otp_rate_limits_don_cua_so_cu ON public.otp_rate_limits");
      expect((await db.pool.query<{ o: string | null }>("SELECT to_regprocedure('public.mfa_credentials_xoa_can_yeu_cau()')::text AS o")).rows[0]?.o).toBeNull();
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows: dungLai } = await db.pool.query<{ ten: string; than: string; trg: string }>(
        `SELECT p.proname AS ten, btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS than,
                (SELECT string_agg(t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS trg
           FROM pg_proc p WHERE p.proname IN ('mfa_credentials_xoa_can_yeu_cau', 'sessions_kiem_mfa_khi_tao') ORDER BY 1`,
      );
      expect(dungLai.map((h) => [h.ten, h.trg])).toEqual([
        ["mfa_credentials_xoa_can_yeu_cau", "mfa_credentials_xoa_can_yeu_cau:A"],
        ["sessions_kiem_mfa_khi_tao", "sessions_kiem_mfa_khi_tao:A"],
      ]);
      expect(dungLai[0]?.than).toContain("040");
      expect(dungLai[1]?.than).toContain("la_duong_ung_dung");
      const { rows: danhTinh } = await db.pool.query<{ enabled: string; def: string }>(
        "SELECT t.tgenabled::text AS enabled, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgname = 'mfa_reset_requests_kiem_danh_tinh_duyet' AND NOT t.tgisinternal",
      );
      expect(danhTinh).toHaveLength(1);
      expect(danhTinh[0]?.enabled).toBe("A");
      expect(danhTinh[0]?.def).toContain("kiem_danh_tinh_theo_phien('approved_by', 'approved_by_session_id')");
      const { rows: dt013 } = await db.pool.query<{ enabled: string; def: string }>(
        "SELECT t.tgenabled::text AS enabled, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgname = 'unseal_requests_kiem_danh_tinh' AND NOT t.tgisinternal",
      );
      expect(dt013).toHaveLength(1);
      // ~~`O`, không phải `A`~~ [review H6-4 / 043] `A`: cùng bất biến D với hai trigger của 040, nên
      // cùng độ mạnh — `'O'` là trạng thái `session_replication_role = 'replica'` bỏ qua.
      expect(dt013[0]?.enabled).toBe("A");
      expect(dt013[0]?.def).toContain("kiem_danh_tinh_theo_phien('requested_by', 'requested_by_session_id')");
      // [S1.15 / nợ 56] Ba đột biến của nhóm ba mươi lăm hàm, dựng lại đủ cả ba trục.
      const { rows: n56 } = await db.pool.query<{ than: string; trg: string | null }>(
        `SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) AS than,
                (SELECT string_agg(t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgname)
                   FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS trg
           FROM pg_proc p WHERE p.oid = to_regprocedure('public.rfq_kiem_chuyen_trang_thai()')`,
      );
      expect(n56[0]?.than, "thân máy trạng thái RFQ bị thay thành no-op").toContain("Chuyen trang thai");
      expect(n56[0]?.trg).toBe("rfq_packages_kiem_chuyen_trang_thai:A");
      const { rows: n56b } = await db.pool.query<{ ten: string; en: string }>(
        `SELECT t.tgname AS ten, t.tgenabled::text AS en FROM pg_trigger t
          WHERE NOT t.tgisinternal
            AND t.tgname IN ('vendor_bid_versions_chi_ghi_them', 'unseal_requests_kiem_chuyen_trang_thai')
          ORDER BY 1`,
      );
      expect(n56b).toEqual([
        { ten: "unseal_requests_kiem_chuyen_trang_thai", en: "A" },
        { ten: "vendor_bid_versions_chi_ghi_them", en: "A" },
      ]);
      const { rows: bucket } = await db.pool.query<{ rls: boolean; force: boolean; pol: string | null }>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                (SELECT string_agg(p.polname, ',' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid) AS pol
           FROM pg_class c WHERE c.oid = to_regclass('public.caller_rate_limits')`,
      );
      expect(bucket[0], "RED THẬT trước H6-7: RLS của bảng ngoài cây tenant không ai dựng lại").toEqual({
        rls: true,
        force: true,
        pol: "caller_rate_limits_khach",
      });
      // [S1.15 / sổ nợ 57] Dựng lại ĐÚNG policy, không chỉ MỘT policy cùng tên: lệnh, role và cả
      // biểu thức. Một bản dựng lại rộng hơn (vd. thiếu vế `window_start`) sẽ xoá cửa sổ đang đếm.
      const { rows: donCu } = await db.pool.query<{ lenh: string; vai: string | null; using: string }>(
        `SELECT p.polcmd::text AS lenh,
                (SELECT string_agg(r.rolname::text, ',' ORDER BY r.rolname COLLATE "C")
                   FROM pg_roles r WHERE r.oid = ANY(p.polroles)) AS vai,
                pg_get_expr(p.polqual, p.polrelid) AS using
           FROM pg_policy p
          WHERE p.polrelid = to_regclass('public.otp_rate_limits')
            AND p.polname = 'otp_rate_limits_don_cua_so_cu'`,
      );
      expect(donCu, "policy dọn của 044 phải được dựng lại").toHaveLength(1);
      expect(donCu[0]?.lenh).toBe("d");
      expect(donCu[0]?.vai).toBe("app_api");
      expect(donCu[0]?.using).toBe(
        "((NULLIF(current_setting('app.org_id'::text, true), ''::text) IS NULL) AND " +
          "(window_start < (now() - make_interval(secs => (1800)::double precision))))",
      );
      const { rows: ham } = await db.pool.query<{ ten: string; than: string; cfg: string | null }>(
        `SELECT p.proname AS ten, btrim(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) AS than, array_to_string(p.proconfig, ',') AS cfg
           FROM pg_proc p WHERE p.proname IN ('mfa_reset_kiem_chuyen_trang_thai', 'mfa_reset_kiem_quyen') ORDER BY 1`,
      );
      expect(ham.map((h) => h.ten)).toEqual(["mfa_reset_kiem_chuyen_trang_thai", "mfa_reset_kiem_quyen"]);
      expect(ham[0]?.than).toContain("cac cot yeu cau la bat bien (040)");
      expect(ham[1]?.than).toContain("user.mfa_reset");
      expect(ham[1]?.cfg).toBe("search_path=pg_catalog");
      const { rows: trg } = await db.pool.query<{ ten: string; enabled: string }>(
        `SELECT t.tgname AS ten, t.tgenabled AS enabled FROM pg_trigger t
          WHERE NOT t.tgisinternal AND t.tgname IN ('outbox_jobs_xoa_payload_dang_nhap', 'sessions_kiem_totp_gan_day') ORDER BY 1`,
      );
      expect(trg).toEqual([
        { ten: "outbox_jobs_xoa_payload_dang_nhap", enabled: "A" },
        { ten: "sessions_kiem_totp_gan_day", enabled: "A" },
      ]);
      // Hành vi thật sau khôi phục: một job LOGIN_LINK_SEND xong thì payload về {} (041 sống lại).
      const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('X', 'x') RETURNING id")).rows[0]!.id;
      const { rows: job } = await db.pool.query<{ id: string }>(
        "INSERT INTO outbox_jobs (org_id, kind, payload) VALUES ($1, 'LOGIN_LINK_SEND', '{\"email\":\"a@b\"}') RETURNING id",
        [org],
      );
      await db.pool.query("UPDATE outbox_jobs SET status = 'DONE', finished_at = now() WHERE id = $1", [job[0]!.id]);
      const { rows: sau } = await db.pool.query<{ payload: unknown }>("SELECT payload FROM outbox_jobs WHERE id = $1", [job[0]!.id]);
      expect(sau[0]?.payload).toEqual({});
    } finally {
      await db.stop();
    }
  }, 180_000);

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

      // [S1.51 / khoản nợ 92 — lượt soi 44 CAO-1] KỲ VỌNG LẬT CÓ CHỦ ĐÍCH. Bản trước: lượt deploy ấy chữa xong rồi ĐI
      // THẲNG. Nay nó chữa xong rồi DỪNG, và lượt sau mới đi thẳng. Lý do: một hàng mức database mang GIÁ TRỊ ĐÚNG là
      // biện pháp giảm nhẹ hợp lệ CHE một độc ở tầng thấp hơn (`postgresql.conf`/`ALTER SYSTEM`, xếp dưới `database`);
      // lượt sửa gỡ hàng che vô điều kiện, còn phiên deploy thì vẫn thấy giá trị cũ (chốt lúc mở kết nối) ⇒ phiên này
      // KHÔNG đọc được giá trị thật sau khi gỡ. Vế "chữa được" thì không đổi — nó vẫn được đo, ngay dưới.
      const loiLan1 = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loiLan1, "lượt sửa gỡ hàng mức database ⇒ lượt ấy dừng, đòi kết nối mới").not.toBeNull();
      expect(loiLan1!.message).toContain("lượt sửa vừa gỡ cấu hình mức database của GUC vận hành");

      const sau = await db.pool.query<{ s: string[] | null }>(
        "SELECT setconfig AS s FROM pg_db_role_setting WHERE setrole = 0",
      );
      expect(sau.rows[0]?.s ?? null, "lượt SỬA vẫn chạy và vẫn reset — đó là điều mục này đo").toBeNull();
      await expect(migrate(db.pool, MIGRATIONS_DIR), "lượt kế trên kết nối mới đi thẳng").resolves.toEqual([]);
    } finally {
      await db.stop();
    }
  });

  // [S1.34 / khoản nợ 78] CHE TÊN qua search_path — ADR-036 hàng 16. Đo trước khi vá (PostgreSQL 16):
  // app_api tạo được bảng tạm (TEMP đến từ PUBLIC, `datacl` NULL), và `sessions` trần rơi vào bảng
  // tạm: SELECT đếm 0 khi public.sessions có 1 hàng, UPDATE 0 hàng không lỗi; bảng tạm sống hết đời
  // KẾT NỐI pool. Test này đo CẢ cơ chế lẫn lớp, cùng một CSDL: lớp đã đóng ⇒ mở lại bằng tay ⇒ cơ
  // chế lộ ra ⇒ migrate() đóng lại ⇒ 42501.
  it("[khoản nợ 78] app_api không tạo được bảng tạm che tên — hardening thu hồi TEMP trên database, và thu hồi lại khi bị cấp lại (PUBLIC hay đích danh)", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
      const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('no78', 'no78') RETURNING id")).rows[0]!.id;
      const nguoi = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'a@no78.vn', 'a') RETURNING id", [org])).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
        [org, nguoi, Buffer.alloc(32, 7)],
      );
      const api = db.poolAs("app_api");
      const loiCua = async (chay: () => Promise<unknown>): Promise<string | null> => {
        try {
          await chay();
          return null;
        } catch (e) {
          return (e as { code?: string }).code ?? "?";
        }
      };
      const quyenTemp = async (): Promise<Record<string, boolean>> => {
        const { rows } = await db.pool.query<{ vai: string; temp: boolean }>(
          "SELECT r.rolname AS vai, pg_catalog.has_database_privilege(r.rolname, pg_catalog.current_database(), 'TEMP') AS temp " +
            "FROM pg_roles r WHERE r.rolname IN ('app_api', 'app_unseal') ORDER BY 1",
        );
        return Object.fromEntries(rows.map((r) => [r.vai, r.temp]));
      };

      // (1) Lớp đã đóng ngay sau migrate(): không vai ứng dụng nào còn TEMP, và CREATE TEMP là 42501.
      expect(await quyenTemp()).toEqual({ app_api: false, app_unseal: false });
      const c = await api.connect();
      try {
        await c.query("SELECT set_config('app.org_id', $1, false)", [org]);
        expect(await loiCua(() => c.query("CREATE TEMP TABLE sessions (id int)")), "TEMP đã bị thu hồi").toBe("42501");
        expect((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM sessions")).rows[0]?.n).toBe("1");

        // (2) Mở lại bằng tay đúng như trước khi có lớp (mặc định của PostgreSQL: PUBLIC có TEMP) — và
        //     cơ chế lộ ra: bảng tạm che `sessions` cho mọi câu viết trần trên kết nối này.
        await db.pool.query(`GRANT TEMP ON DATABASE "${tenDb}" TO PUBLIC`);
        expect(await quyenTemp()).toEqual({ app_api: true, app_unseal: true });
        expect(await loiCua(() => c.query("CREATE TEMP TABLE sessions (id int)"))).toBeNull();
        expect((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM sessions")).rows[0]?.n, "bảng tạm che bảng thật").toBe("0");
        expect((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM public.sessions")).rows[0]?.n, "qualify thì thấy").toBe("1");
        expect((await c.query("UPDATE sessions SET id = id")).rowCount, "UPDATE trần: 0 hàng, không lỗi").toBe(0);
        await c.query("DROP TABLE pg_temp.sessions");
      } finally {
        c.release();
      }

      // (3) migrate() thu hồi lại — cả cấp qua PUBLIC lẫn cấp đích danh — và WARNING nói rõ đang tự chữa.
      await db.pool.query(`GRANT TEMP ON DATABASE "${tenDb}" TO app_api`);
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await quyenTemp()).toEqual({ app_api: false, app_unseal: false });
      const c2 = await api.connect();
      try {
        expect(await loiCua(() => c2.query("CREATE TEMP TABLE sessions (id int)"))).toBe("42501");
        expect(await loiCua(() => c2.query("CREATE TEMP VIEW zz AS SELECT 1"))).toBe("42501");
        expect(await loiCua(() => c2.query("CREATE TEMP SEQUENCE zz_s"))).toBe("42501");
      } finally {
        c2.release();
      }

      // (4) [lượt soi 24, NHẸ-2] Bảng tạm tạo TRƯỚC khi lớp thu hồi TEMP sống hết đời kết nối: đo — cùng
      //     kết nối, sau REVOKE, `sessions` trần vẫn đếm 0. Cửa sổ ấy đóng ở tầng app: mỗi lần giao client,
      //     vai-tro.ts `DISCARD TEMP` cùng câu với SET ROLE — client lấy lại từ pool (cùng kết nối vật lý,
      //     đo bằng pg_backend_pid) không còn bảng tạm.
      await db.pool.query(`GRANT TEMP ON DATABASE "${tenDb}" TO PUBLIC`);
      const c3 = await api.connect();
      let pid: string | undefined;
      try {
        pid = (await c3.query<{ p: string }>("SELECT pg_backend_pid()::text AS p")).rows[0]?.p;
        await c3.query("SELECT set_config('app.org_id', $1, false)", [org]);
        await c3.query("CREATE TEMP TABLE sessions (id int)");
        await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
        expect(await quyenTemp()).toEqual({ app_api: false, app_unseal: false });
        expect((await c3.query<{ n: string }>("SELECT count(*)::text AS n FROM sessions")).rows[0]?.n, "bảng tạm có sẵn SỐNG qua REVOKE trên cùng kết nối").toBe("0");
      } finally {
        // [lượt soi 25b, NẶNG-1] Bản S1.34 để c3 ngoài finally: một assert đỏ ở trên giữ client lại và
        // db.stop() (pool.end() chờ client) treo tới timeout — trái lời khai "không rò pool" của lượt soi 24 #11.
        c3.release();
      }
      const c4 = await api.connect();
      try {
        expect((await c4.query<{ p: string }>("SELECT pg_backend_pid()::text AS p")).rows[0]?.p, "cùng kết nối vật lý").toBe(pid);
        await c4.query("SELECT set_config('app.org_id', $1, false)", [org]);
        expect((await c4.query<{ n: string }>("SELECT count(*)::text AS n FROM sessions")).rows[0]?.n, "DISCARD TEMP lúc giao client đã xoá bảng tạm").toBe("1");
      } finally {
        c4.release();
      }
    } finally {
      await db.stop();
    }
  });

  // Nửa PHÁN XÉT của khoản 78: `"$user"` đứng trước `public` trong search_path mặc định, nên một schema
  // trùng tên vai — app_api, app_unseal, hay một role đăng nhập là thành viên của chúng — che bảng thật
  // y như bảng tạm. Đo: schema `app_api` chứa `sessions` ⇒ SELECT trần đếm 0. Hardening cố ý KHÔNG tự
  // DROP (schema có thể chứa đối tượng); nó gãy và nêu tên.
  it("[khoản nợ 78] schema trùng tên vai ứng dụng hay role đăng nhập thành viên làm migrate() GÃY nêu tên — và không tự xoá", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('no78b', 'no78b') RETURNING id")).rows[0]!.id;
      const nguoi = (await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, 'b@no78.vn', 'b') RETURNING id", [org])).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
        [org, nguoi, Buffer.alloc(32, 8)],
      );
      await db.pool.query("CREATE SCHEMA app_api; CREATE TABLE app_api.sessions (id int); GRANT USAGE ON SCHEMA app_api TO app_api; GRANT SELECT ON app_api.sessions TO app_api");
      // Cơ chế: đúng cái tên `sessions` rơi vào schema "$user".
      const c = await db.poolAs("app_api").connect();
      try {
        await c.query("SELECT set_config('app.org_id', $1, false)", [org]);
        expect((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM sessions")).rows[0]?.n, "schema app_api che public").toBe("0");
        expect((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM public.sessions")).rows[0]?.n).toBe("1");
      } finally {
        c.release();
      }
      // Lớp: gãy, nêu tên, không xoá.
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi).not.toBeNull();
      expect(loi!.message).toContain('schema trùng tên một vai');
      expect(loi!.message).toContain("schema che public qua \"$user\": app_api —");
      expect((await db.pool.query("SELECT 1 FROM pg_namespace WHERE nspname = 'app_api'")).rowCount, "hardening không được tự DROP schema").toBe(1);
      await db.pool.query("DROP SCHEMA app_api CASCADE");

      // Theo TÍNH CHẤT thành viên (bắc cầu), không theo tên: một role đăng nhập là thành viên hợp lệ của
      // app_api (cặp trong danh sách trắng của hardening) mà có schema trùng tên cũng bị nêu — "$user" chỉ
      // trỏ tới nó khi kết nối KHÔNG ở SET ROLE (RESET ROLE do injection, phiên trực tiếp): phòng thủ chiều sâu.
      await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'x'; GRANT app_api TO app_api_login; CREATE SCHEMA app_api_login");
      const loi2 = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi2?.message ?? "").toContain("schema che public qua \"$user\": app_api_login —");
      await db.pool.query("DROP SCHEMA app_api_login");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // [lượt soi 24, NẶNG-1] Tiền đề "app_api không tạo được schema" nay được GIỮ, không chỉ đo: CREATE ON
      // DATABASE trôi ⇒ app_api TỰ dựng schema trùng tên (che BỀN, cho mọi kết nối) — migrate() thu hồi
      // CREATE ngay ở lượt sửa dù lượt phán xét gãy vì schema; gỡ schema bằng tay xong, app_api không dựng
      // lại được nữa.
      const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
      const loiCua = async (chay: () => Promise<unknown>): Promise<string | null> => {
        try {
          await chay();
          return null;
        } catch (e) {
          return (e as { code?: string }).code ?? "?";
        }
      };
      const coCreate = async (): Promise<boolean> =>
        (await db.pool.query<{ c: boolean }>("SELECT pg_catalog.has_database_privilege('app_api', pg_catalog.current_database(), 'CREATE') AS c")).rows[0]!.c;
      expect(await coCreate()).toBe(false);
      await db.pool.query(`GRANT CREATE ON DATABASE "${tenDb}" TO app_api`);
      const cApi = await db.poolAs("app_api").connect();
      try {
        expect(await loiCua(() => cApi.query("CREATE SCHEMA app_api; CREATE TABLE app_api.sessions (id int)")), "có CREATE thì tự dựng được").toBeNull();
        await cApi.query("SELECT set_config('app.org_id', $1, false)", [org]);
        expect((await cApi.query<{ n: string }>("SELECT count(*)::text AS n FROM sessions")).rows[0]?.n, "schema tự dựng che public").toBe("0");
      } finally {
        cApi.release();
      }
      const loi3 = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi3?.message ?? "").toContain("schema che public qua \"$user\": app_api —");
      expect(await coCreate(), "CREATE bị thu hồi ở lượt sửa dù lượt phán xét gãy").toBe(false);
      await db.pool.query("DROP SCHEMA app_api CASCADE");
      const cApi2 = await db.poolAs("app_api").connect();
      try {
        expect(await loiCua(() => cApi2.query("CREATE SCHEMA app_api"))).toBe("42501");
      } finally {
        cApi2.release();
      }
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // [lượt soi 24, NHẸ-3] Đường `SET search_path` trong phiên chỉ che được tên khi vai có USAGE ở một
      // schema KHÁC chứa quan hệ TRÙNG TÊN với public. Phán xét đúng cơ chế ấy — không phải "không USAGE
      // ngoài public" (bản đầu, gãy hai fixture hợp lệ của chính tệp này: `khac`, `gia`). Đối chứng: schema
      // có USAGE mà không quan hệ trùng tên thì đi qua.
      await db.pool.query("CREATE SCHEMA zz_khac; CREATE TABLE zz_khac.khong_trung (id int); GRANT USAGE ON SCHEMA zz_khac TO app_api");
      await expect(migrate(db.pool, MIGRATIONS_DIR), "USAGE không trùng tên không phải lỗi").resolves.toEqual([]);
      await db.pool.query("CREATE TABLE zz_khac.sessions (id int)");
      const loi4 = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi4?.message ?? "").toContain("quan hệ trùng tên public: app_api -> zz_khac.sessions");
      await db.pool.query("DROP SCHEMA zz_khac CASCADE");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
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

  // ==========================================================================
  // [CR2-T3] BƯỚC 1 của hardening trước đây gỡ MỌI membership chạm tới app_api/app_unseal,
  // kể cả membership HỢP LỆ. Vì cả 001 lẫn hardening đều cưỡng chế hai role đó là NOLOGIN,
  // cách DUY NHẤT để ứng dụng hành động dưới danh nghĩa app_api là một role ĐĂNG NHẬP là
  // thành viên của nó — đúng thứ bị BƯỚC 1 xoá ở MỌI lần migrate(). Nghĩa là kiến trúc role
  // mà chính 001 mô tả không dựng được.
  //
  // Bản vá: BƯỚC 1 phân biệt bằng một DANH SÁCH TRẮNG CẶP ĐÓNG viết thẳng trong SQL —
  // (app_api, app_api_login) và (app_unseal, app_unseal_login), và chỉ khi membership đó
  // KHÔNG kèm ADMIN OPTION. Mọi membership khác chạm tới bốn role được canh đều bị gỡ.
  //
  // Rủi ro đã biết của mọi danh sách trắng: viết rộng quá thì một membership độc lọt qua.
  // Test này là mặt đối kháng của rủi ro đó — nó dựng NĂM biến thể membership lạ, mỗi biến
  // thể tấn công một cách nới lỏng khác nhau mà một bản vá ẩu sẽ mắc phải:
  //   (1) tên bắt chước giao ước "*_login" nhưng không có trong danh sách — bản vá dựa vào
  //       HẬU TỐ thay vì danh sách cặp sẽ cho lọt;
  //   (2) đúng hai role trong danh sách nhưng SAI CẶP (app_api_login vào app_unseal) — bản
  //       vá miễn trừ theo TẬP ROLE thay vì theo CẶP sẽ cho lọt;
  //   (3) bắc cầu VÀO: app_api_login là thành viên của một nhóm bất kỳ — bản vá chỉ canh
  //       app_api/app_unseal (không mở rộng vùng canh sang chính role đăng nhập) sẽ cho lọt,
  //       và nhóm đó cho app_api_login mọi quyền của nó;
  //   (4) bắc cầu RA: một role khác là thành viên của app_api_login — kế thừa bắc cầu toàn
  //       bộ quyền của app_api;
  //   (5) đúng cặp hợp lệ nhưng kèm ADMIN OPTION — app_api_login tự cấp được app_api cho
  //       bất kỳ ai, biến một miễn trừ hẹp thành bàn đạp.
  // Cả năm phải bị gỡ; đúng hai cặp hợp lệ phải còn nguyên. Đó là hai chiều của cùng một
  // phép đo, cố ý gộp vào MỘT khẳng định về TẬP membership còn lại để không có góc mù.
  it("[CR2-T3] giữ membership hợp lệ của role đăng nhập dự án và gỡ mọi membership lạ", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // Hợp lệ — đây chính là cách duy nhất ứng dụng chạy được dưới danh nghĩa app_api.
      await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api' IN ROLE app_api");
      await db.pool.query(
        "CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk-unseal' IN ROLE app_unseal",
      );

      // (1) bắt chước giao ước đặt tên
      await db.pool.query("CREATE ROLE ke_gian_login NOLOGIN");
      await db.pool.query("GRANT app_api TO ke_gian_login");
      // (2) sai cặp
      await db.pool.query("GRANT app_unseal TO app_api_login");
      // (3) bắc cầu vào
      await db.pool.query("CREATE ROLE nhom_xau NOLOGIN");
      await db.pool.query("GRANT nhom_xau TO app_api_login");
      // (4) bắc cầu ra
      await db.pool.query("CREATE ROLE ke_tan_cong NOLOGIN");
      await db.pool.query("GRANT app_api_login TO ke_tan_cong");
      // (5) đúng cặp nhưng kèm ADMIN OPTION
      await db.pool.query("GRANT app_api TO app_api_login WITH ADMIN OPTION");

      const truoc = await db.pool.query<MembershipConLai>(CAU_MEMBERSHIP_CON_LAI);
      expect(truoc.rows).toHaveLength(6); // 2 hợp lệ + 4 lạ (cặp (5) trùng cặp hợp lệ)
      expect(
        truoc.rows.find((r) => r.thanh_vien === "app_api_login" && r.nhom === "app_api")
          ?.admin_option,
      ).toBe(true);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<MembershipConLai>(CAU_MEMBERSHIP_CON_LAI);
      expect(sau.rows).toEqual([
        { nhom: "app_api", thanh_vien: "app_api_login", admin_option: false },
        { nhom: "app_unseal", thanh_vien: "app_unseal_login", admin_option: false },
      ]);
    } finally {
      await db.stop();
    }
  });

  // [CR2-T3] Đưa hai role đăng nhập vào danh sách trắng là đưa thêm HAI CHỦ THỂ TIN CẬY vào
  // hệ thống: từ giờ ai chiếm được app_api_login là có mọi quyền của app_api. Vì vậy hardening
  // phải canh luôn thuộc tính của chúng — "ALTER ROLE app_api_login BYPASSRLS" vô hiệu hoá
  // TOÀN BỘ RLS mà Task 4 dựng lên, và một danh sách trắng không kèm phép canh này chỉ dời
  // lỗ hổng sang một cái tên khác.
  //
  // Cố ý KHÔNG cưỡng chế LOGIN/NOLOGIN và KHÔNG đụng tới mật khẩu: hardening không được biến
  // thành thứ làm rớt đăng nhập của ứng dụng đang chạy. Test khẳng định cả hai vế — đặc quyền
  // bị tước VÀ role vẫn đăng nhập được bằng đúng mật khẩu cũ.
  it("[CR2-T3] tước SUPERUSER/BYPASSRLS khỏi role đăng nhập dự án mà không làm mất khả năng đăng nhập", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "CREATE ROLE app_api_login LOGIN BYPASSRLS SUPERUSER CREATEDB CREATEROLE NOINHERIT " +
          "PASSWORD 'mk-api' IN ROLE app_api",
      );

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolcanlogin: boolean;
      }>(
        "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin " +
          "FROM pg_roles WHERE rolname = 'app_api_login'",
      );
      expect(rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: true,
        rolcanlogin: true,
      });

      // Đăng nhập thật, không chỉ đúng trên giấy catalog.
      const poolDangNhap = createPool(doiNguoiDung(db.connectionString, "app_api_login", "mk-api"), 2);
      try {
        const { rows: r } = await poolDangNhap.query<{ u: string }>(
          "SELECT current_user AS u",
        );
        expect(r[0]?.u).toBe("app_api_login");
      } finally {
        await poolDangNhap.end();
      }
    } finally {
      await db.stop();
    }
  });

  // [CR2-T3] Cùng lớp trôi với [fix I5] nhưng trên hai chủ thể mới: cấu hình phiên gắn vào
  // role đăng nhập (toàn cụm qua pg_roles.rolconfig, và riêng database qua
  // pg_db_role_setting). Hai bảng catalog KHÁC NHAU, "RESET ALL" trần chỉ chạm bảng thứ nhất.
  it("[CR2-T3] xoá rolconfig toàn cụm và cấu hình IN DATABASE của role đăng nhập dự án", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: d } = await db.pool.query<{ ten: string }>("SELECT current_database() AS ten");
      const tenDb = d[0]!.ten;

      await db.pool.query("CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk' IN ROLE app_unseal");
      await db.pool.query("ALTER ROLE app_unseal_login SET search_path = ke_gian, public");
      await db.pool.query(
        `ALTER ROLE app_unseal_login IN DATABASE "${tenDb}" SET row_security = off`,
      );

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ toan_cum: string[] | null; trong_db: string[] | null }>(
        "SELECT r.rolconfig AS toan_cum, " +
          "(SELECT s.setconfig FROM pg_db_role_setting s " +
          "  WHERE s.setrole = r.oid " +
          "    AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())" +
          ") AS trong_db " +
          "FROM pg_roles r WHERE r.rolname = 'app_unseal_login'",
      );
      expect(rows[0]).toEqual({ toan_cum: null, trong_db: null });
    } finally {
      await db.stop();
    }
  });

  // ==========================================================================
  // [S7b/S11-T3] Trôi ở tầng RLS. Policy và cờ RLS nằm trong migration ĐÁNH SỐ nên chỉ chạy
  // một lần; mọi thay đổi sau triển khai trước đây tồn tại vĩnh viễn và không gì phát hiện.
  // ==========================================================================

  // (A) Cờ RLS: TỰ CHỮA, và cố ý viết TỔNG QUÁT theo pg_attribute nên bảng của mọi task sau
  // được phủ mà không ai phải thêm dòng nào. Test dựng cả hai nửa của cùng lớp trôi — tắt hẳn
  // RLS, và bỏ riêng FORCE — trên cả bảng có org_id lẫn bảng gốc của cây tenant.
  it("[INV-F1] hardening bật lại ENABLE/FORCE ROW LEVEL SECURITY bị tắt sau triển khai", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("ALTER TABLE users DISABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY");

      const truoc = await db.pool.query<{ ten: string; bat: boolean; cuong_che: boolean }>(
        "SELECT relname AS ten, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
          "FROM pg_class WHERE relname IN ('users','organizations') ORDER BY 1",
      );
      expect(truoc.rows).toEqual([
        { ten: "organizations", bat: true, cuong_che: false },
        { ten: "users", bat: false, cuong_che: true },
      ]);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const sau = await db.pool.query<{ ten: string; bat: boolean; cuong_che: boolean }>(
        "SELECT relname AS ten, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
          "FROM pg_class WHERE relname IN ('users','organizations') ORDER BY 1",
      );
      expect(sau.rows).toEqual([
        { ten: "organizations", bat: true, cuong_che: true },
        { ten: "users", bat: true, cuong_che: true },
      ]);
    } finally {
      await db.stop();
    }
  });

  // (A) tiếp: vị từ nhận diện bảng tenant đọc pg_attribute nên nó phủ CẢ BẢNG CHƯA TỒN TẠI ở
  // thời điểm viết file này — đây là nửa "tổng quát" mà một danh sách bảng viết tay sẽ bỏ sót
  // ở mọi task sau. Một bảng mới có org_id, không RLS, không policy phải bị BẮT, không đi lọt.
  //
  // Kết quả ĐO ĐƯỢC: migrate() GÃY chứ không "âm thầm bật hộ rồi đi tiếp". Đó là hành vi ĐÚNG:
  // một bảng có org_id mà không có policy là bảng từ chối tất cả, tức một lược đồ hỏng, và nó
  // chỉ phát sinh khi ai đó tạo bảng bằng tay hoặc viết một migration vi phạm S7b — cả hai đều
  // phải dừng deploy. Ghi lại ở đây để không ai đọc mục (A) như một lời hứa "mọi trôi RLS đều
  // tự chữa": nó tự chữa khi policy còn nguyên, và chỉ khi đó.
  //
  // [vòng fix 1 — I3] Vòng trước ghi thêm ở đây rằng "cả file nằm trong MỘT transaction nên
  // phần (A) đã sửa cũng rollback theo". Điều đó ĐÃ HẾT ĐÚNG và test nay đo ngược lại: lượt SỬA
  // commit trong transaction riêng TRƯỚC lượt PHÁN XÉT, nên cờ RLS mà (A) bật SỐNG SÓT qua lần
  // migrate() gãy. Đây là khẳng định về triệu chứng "fail-closed kéo theo cả sửa chữa thành
  // công" của bẫy Task 3.
  it("[INV-F1] bảng MỚI có org_id mà không RLS, không policy làm migrate() GÃY, không đi lọt", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("CREATE TABLE bang_moi_quen_rls (id int, org_id uuid NOT NULL)");

      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi).not.toBeNull();
      expect(loi!.message).toContain("hình dạng policy RLS của bảng tenant");
      expect(loi!.message).toContain("bang_moi_quen_rls");

      // [vòng fix 1 — I3] Sửa chữa của lượt SỬA không bị phán xét kéo theo.
      const coSua = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bang_moi_quen_rls'",
      );
      expect(
        coSua.rows[0],
        "phán xét hỏng đã rollback luôn phần (A) đã sửa — đúng bẫy 'fail-closed biến trôi tự " +
          "lành thành deploy chặn' của Task 3.",
      ).toEqual({ bat: true, cuong_che: true });

      // Và sau khi bảng có policy đúng khuôn, mục (A) tự bật cờ RLS hộ — nửa "tự chữa" thật sự.
      await db.pool.query(
        "CREATE POLICY bang_moi_quen_rls_tenant_isolation ON bang_moi_quen_rls " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bang_moi_quen_rls'",
      );
      expect(rows[0]).toEqual({ bat: true, cuong_che: true });
    } finally {
      await db.stop();
    }
  });

  // (B) Hình dạng policy: CHỈ PHÁT HIỆN. Ba đột biến, mỗi cái là một dạng bị cấm ở S11-T3 hoặc
  // một cách xoá sạch phòng thủ. Cả ba trước bản vá đều đi qua migrate() mà không ai biết.
  it("[INV-F1] migrate() GÃY khi policy RLS bị sửa sang dạng fail-open hoặc bị xoá", async () => {
    const kichBan: [string, string[]][] = [
      // USING (true): RLS còn bật, còn policy, mà không chặn gì cả.
      ["USING (true)", ["ALTER POLICY users_tenant_isolation ON users USING (true)"]],
      // Dạng bị cấm số (1) của S11-T3 — mở toang đúng lúc chưa gắn tổ chức.
      [
        "app_current_org_id() IS NULL OR ...",
        [
          "ALTER POLICY users_tenant_isolation ON users " +
            "USING (app_current_org_id() IS NULL OR org_id = app_current_org_id())",
        ],
      ],
      // Dạng bị cấm số (2) — cùng lỗ hổng, viết bằng coalesce.
      [
        "coalesce(...)",
        [
          "ALTER POLICY users_tenant_isolation ON users " +
            "USING (org_id = coalesce(app_current_org_id(), org_id))",
        ],
      ],
      // Xoá sạch: bảng còn RLS, không còn policy -> từ chối tất cả, và không bao giờ trở lại.
      ["DROP POLICY", ["DROP POLICY users_tenant_isolation ON users"]],
    ];

    for (const [nhan, cauLenh] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        for (const cau of cauLenh) await db.pool.query(cau);

        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `đột biến "${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("hình dạng policy RLS của bảng tenant");
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 1 — CR1] DANH SÁCH ĐEN -> DANH SÁCH TRẮNG
  // ==========================================================================================
  // Bốn payload dưới đây ĐI LỌT hoàn toàn im lặng (HARDENING_EXIT=0) trên bản trước, và hai
  // reviewer độc lập tìm ra chúng bằng những payload khác nhau. Chẩn đoán đo được và quan
  // trọng: vấn đề KHÔNG phải "regex trên chuỗi thì yếu" — pg_get_expr CHUẨN HOÁ lại cây phân
  // tích, nên "IS NOT DISTINCT FROM NULL" bị deparse thành "IS NULL" và bị bắt, "USING (true)"
  // cũng bị bắt. Vấn đề là LIỆT KÊ CÁI XẤU: phép kiểm cũ chỉ đòi biểu thức NHẮC TỚI
  // app_current_org_id(), nó không đòi biểu thức RÀNG BUỘC gì cả.
  it("[CR1] bốn cách viết lại tương đương ngữ nghĩa của fail-open đều làm migrate() GÃY", async () => {
    const kichBan: [string, string][] = [
      // (1) Hằng true nối bằng OR — vô hiệu hoá toàn bộ vế bên trái.
      ["OR true", "org_id = app_current_org_id() OR true"],
      // (2) ĐÚNG dạng bị cấm số (1) của S11-T3, viết bằng IS DISTINCT FROM. PostgreSQL deparse
      //     nó thành "NOT (... IS NOT NULL)" nên chuỗi "is null" không xuất hiện.
      [
        "IS DISTINCT FROM NULL",
        "org_id = app_current_org_id() OR NOT (app_current_org_id() IS DISTINCT FROM NULL)",
      ],
      // (3) fail-OPEN qua nhánh ELSE của CASE.
      [
        "CASE ... ELSE true",
        "CASE WHEN app_current_org_id()::text > '' THEN org_id = app_current_org_id() ELSE true END",
      ],
      // (4) Cửa hậu tinh vi nhất: fail-CLOSED khi CHƯA gắn tổ chức (nên nó QUA LUÔN mọi test
      //     hành vi hiện có), mở toang khi ĐÃ gắn — tổ chức A đọc được dữ liệu của B.
      [
        "x = x OR ...",
        "app_current_org_id() = app_current_org_id() OR org_id = app_current_org_id()",
      ],
    ];

    for (const [nhan, bieuThuc] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        await db.pool.query(
          `ALTER POLICY users_tenant_isolation ON users USING (${bieuThuc})`,
        );

        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `payload "${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("hình dạng biểu thức KHÔNG nằm trong danh sách được duyệt");
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // (B) Mặt còn lại — không được BÁO NHẦM. Một phép kiểm quá tay biến hardening thành thứ cản
  // trở deploy trên một lược đồ hoàn toàn đúng, và đó là cách nhanh nhất để người vận hành gỡ
  // bỏ nó.
  //
  // [vòng fix 1 — CR1] Rủi ro báo nhầm của khuôn DANH SÁCH TRẮNG khác hẳn khuôn cũ: nó không
  // nằm ở tên cột chứa chuỗi con nữa (không còn regex nào), mà ở chỗ pg_get_expr có deparse ổn
  // định hay không. Ba cách viết dưới đây có CÙNG cây phân tích với policy chuẩn nhưng khác
  // hẳn về mặt văn bản; đã đo trên PostgreSQL 16.15 rằng cả ba deparse ra ĐÚNG MỘT chuỗi.
  // Nếu một phiên bản PostgreSQL sau này đổi cách deparse, test này đỏ TRƯỚC khi production
  // gãy — đó là công việc của nó.
  it("[CR1] các cách viết khác nhau của CÙNG một cây phân tích không bị báo nhầm", async () => {
    const cachViet = [
      "(  org_id   =   app_current_org_id()  )", // khoảng trắng thừa
      "((org_id = app_current_org_id()))", // ngoặc thừa
      "org_id = public.app_current_org_id()", // hàm ghi đủ schema
      "users.org_id = app_current_org_id()", // cột ghi đủ tên bảng
    ];

    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      for (const bieuThuc of cachViet) {
        await db.pool.query(
          `ALTER POLICY users_tenant_isolation ON users USING (${bieuThuc}) ` +
            "WITH CHECK (org_id = app_current_org_id())",
        );
        const { rows } = await db.pool.query<{ e: string }>(
          "SELECT pg_get_expr(polqual, polrelid) AS e FROM pg_policy WHERE polname = 'users_tenant_isolation'",
        );
        expect(rows[0]!.e, `deparse của "${bieuThuc}" không còn ổn định`).toBe(
          "(org_id = app_current_org_id())",
        );
        await expect(
          migrate(db.pool, MIGRATIONS_DIR),
          `cách viết "${bieuThuc}" bị báo nhầm`,
        ).resolves.toEqual([]);
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 1 — CR2] BẢNG CHA PHÂN MẢNH (relkind = 'p')
  // ==========================================================================================
  // Bảng báo giá phân mảnh theo org_id là thiết kế gần như chắc chắn của task sau, nên lỗ này
  // phải đóng TRƯỚC task đó. Test đo HAI nửa, cố ý tách bạch:
  //   (a) LỖ HỔNG CÓ THẬT — với lược đồ viết ĐÚNG KHUÔN PostgreSQL (RLS + policy trên CHA, lá
  //       thừa hưởng), một role đã gắn tổ chức A đọc THẲNG lá của tổ chức B thấy nguyên dữ
  //       liệu của B. Đây là phát hiện MỚI của vòng này: "viết đúng khuôn" vẫn hở, vì lá là
  //       một bảng có tên gọi được.
  //   (b) HARDENING ĐÓNG ĐƯỢC — mục (A) bật ENABLE + FORCE trên CHA lẫn mọi LÁ, và mục (B)
  //       KHÔNG báo nhầm lá vì lá không có policy riêng (đó là khuôn đúng của PostgreSQL).
  it("[CR2] bảng phân mảnh: lá đọc thẳng bỏ qua RLS trước khi vá, hardening bật RLS cho cả cha lẫn lá", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      // Khuôn PostgreSQL chuẩn: RLS + policy đặt trên CHA, không đặt gì trên lá.
      await db.pool.query(
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL, gia int) PARTITION BY LIST (org_id)",
      );
      await db.pool.query(`CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('${orgA}')`);
      await db.pool.query(`CREATE TABLE bao_gia_b PARTITION OF bao_gia FOR VALUES IN ('${orgB}')`);
      await db.pool.query("ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      // [S1.38 / khoản nợ 83⑵, lượt soi 29 NẶNG-2] GRANT lên LÁ chỉ có nghĩa cho đọc THẲNG lá — và sau khi
      // mục (A) bật RLS trên lá, đọc thẳng là 0 hàng không lỗi: đúng ca hardening nay phán xét. Fixture giữ
      // GRANT trên lá để ĐO điều ấy (nửa (b)), rồi thu hồi để đối chứng đi qua.
      await db.pool.query("GRANT SELECT ON bao_gia, bao_gia_a, bao_gia_b TO app_api");
      await db.pool.query(
        `INSERT INTO bao_gia VALUES (1,'${orgA}',100), (2,'${orgB}',999)`,
      );

      // (a) Trạng thái TRƯỚC khi hardening chạm vào: lá không có RLS.
      const truoc = await db.pool.query<{ ten: string; loai: string; bat: boolean }>(
        "SELECT relname AS ten, relkind AS loai, relrowsecurity AS bat FROM pg_class " +
          "WHERE relname LIKE 'bao_gia%' ORDER BY 1",
      );
      expect(truoc.rows).toEqual([
        { ten: "bao_gia", loai: "p", bat: true },
        { ten: "bao_gia_a", loai: "r", bat: false },
        { ten: "bao_gia_b", loai: "r", bat: false },
      ]);

      const apiPool = db.poolAs("app_api");
      const doc = async (bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY 1`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      expect(await doc("bao_gia"), "đọc qua CHA phải chỉ thấy hàng của tổ chức A").toEqual([100]);
      expect(
        await doc("bao_gia_b"),
        "nếu phép đo này rỗng nghĩa là lá đã tự chịu RLS — lỗ hổng CR2 không còn tồn tại và " +
          "cả nửa (b) của test này là thừa. Đo lại trước khi kết luận.",
      ).toEqual([999]);

      // (b) hardening: bật RLS cho lá (BƯỚC 2 tự chữa) — và [S1.38] PHÁN XÉT quyền SELECT trực tiếp trên lá
      //     không policy nào phủ (khoản 83⑵): lá không policy riêng là khuôn ĐÚNG chừng nào không ai cấp quyền
      //     đọc thẳng nó. Thu hồi quyền trên lá ⇒ đi qua.
      const loiLa = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiLa, "GRANT trực tiếp lên lá không policy phải bị khoản 83⑵ bắt").not.toBeNull();
      expect(loiLa!.message).toContain("public.bao_gia_b/app_api/SELECT: quyền đã cấp mà không policy PERMISSIVE nào phủ");
      expect(loiLa!.message).not.toContain("bao_gia/app_api");
      const sau = await db.pool.query<{ ten: string; bat: boolean; cuong_che: boolean }>(
        "SELECT relname AS ten, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
          "FROM pg_class WHERE relname LIKE 'bao_gia%' ORDER BY 1",
      );
      expect(sau.rows).toEqual([
        { ten: "bao_gia", bat: true, cuong_che: true },
        { ten: "bao_gia_a", bat: true, cuong_che: true },
        { ten: "bao_gia_b", bat: true, cuong_che: true },
      ]);
      expect(await doc("bao_gia_b"), "đọc thẳng lá của tổ chức khác phải trả 0 hàng").toEqual([]);
      expect(await doc("bao_gia"), "đường đọc thật (qua CHA) không được hỏng").toEqual([100]);
      await db.pool.query("REVOKE SELECT ON bao_gia_a, bao_gia_b FROM app_api");
      await expect(migrate(db.pool, MIGRATIONS_DIR), "lá không quyền riêng: khuôn chuẩn đi qua").resolves.toEqual([]);
      await expect(doc("bao_gia_b"), "không quyền ⇒ ồn ào, không im lặng").rejects.toThrow(/permission denied/u);
      expect(await doc("bao_gia"), "đường đọc thật (qua CHA) vẫn đúng").toEqual([100]);
      await apiPool.end();
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 1 — I2] BA ĐƯỜNG ĐỌC VÒNG QUA RLS
  // ==========================================================================================
  // Đo với chủ sở hữu superuser — ĐÚNG kịch bản CI của chính repo này, vì migrate() chạy bằng
  // superuser. Cả ba đường đều EXIT=0 im lặng trên bản trước. Test đi qua migrate() THẬT chứ
  // không viết lại truy vấn phát hiện: viết lại là tự chấm bài mình.
  it("[I2] VIEW/MATVIEW/SECURITY DEFINER trên bảng tenant đều làm migrate() GÃY, cửa security_invoker thì không", async () => {
    const kichBan: [string, string, string | null][] = [
      // [nhãn, câu lệnh dựng, câu lệnh MỞ CỬA hợp lệ (null = không có cửa kỹ thuật)]
      [
        "VIEW mặc định (PG15+ security_invoker = false)",
        "CREATE VIEW moi_nguoi AS SELECT * FROM users",
        "ALTER VIEW moi_nguoi SET (security_invoker = true)",
      ],
      ["MATERIALIZED VIEW", "CREATE MATERIALIZED VIEW mv_nguoi AS SELECT * FROM users", null],
      [
        "hàm SECURITY DEFINER",
        "CREATE FUNCTION doc_het() RETURNS SETOF users LANGUAGE sql SECURITY DEFINER " +
          "AS 'SELECT * FROM users'",
        null,
      ],
    ];

    for (const [nhan, dung, moCua] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        await db.pool.query(dung);

        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `"${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("đọc vòng qua RLS");

        if (moCua !== null) {
          await db.pool.query(moCua);
          await expect(
            migrate(db.pool, MIGRATIONS_DIR),
            `cửa "${moCua}" phải làm hardening im lặng trở lại`,
          ).resolves.toEqual([]);
        }
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 1 — I3] BA LƯỢT: mỗi triệu chứng một khẳng định
  // ==========================================================================================
  it("[I3] hardening phán xét CHÍNH migration vừa được đưa vào, không chỉ lần deploy sau", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-i3-"));
    try {
      for (const f of ["hardening.always.sql", "001_roles_and_functions.sql", "002_organizations_and_users.sql"]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      // 003 tạo một bảng có org_id với policy fail-open — đúng thứ (B) sinh ra để bắt — và
      // CỐ Ý quên ENABLE/FORCE, để có một thứ cho lượt SỬA sửa được. Không có nửa "quên" đó thì
      // triệu chứng (3) không phân biệt được: bảng chỉ xuất hiện SAU lượt 1, nên chỉ lượt 2 mới
      // có gì để sửa, và chỉ khi lượt 2 COMMIT tách khỏi lượt 3 thì sửa chữa mới sống sót.
      await writeFile(
        join(thuMucTam, "003_bang_hong.sql"),
        "CREATE TABLE bang_hong (id int, org_id uuid NOT NULL);\n" +
          "CREATE POLICY bang_hong_p ON bang_hong USING (org_id = app_current_org_id() OR true) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON bang_hong TO app_api;\n",
        "utf8",
      );

      // Triệu chứng (1): LẦN CHẠY ĐẦU phải gãy. Trên bản trước, lần này QUA im lặng vì hardening
      // chạy TRƯỚC 003 nên nó chưa hề thấy bảng đó tồn tại.
      const loi = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "migration hỏng đi lọt ngay ở lần deploy đưa nó vào").not.toBeNull();
      expect(loi!.message).toContain("bang_hong");

      // Triệu chứng (3): phán xét hỏng KHÔNG rollback các sửa chữa của lượt SỬA. 003 đã commit
      // trong transaction riêng của nó, và cờ RLS do lượt 2 bật vẫn còn.
      const daGhi = await db.pool.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      expect(daGhi.rows.map((r) => r.version)).toContain("003_bang_hong.sql");

      const co = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bang_hong'",
      );
      expect(
        co.rows[0],
        "cờ RLS mà lượt SỬA bật đã bị lượt PHÁN XÉT kéo rollback theo — hai lượt vẫn đang nằm " +
          "chung một transaction.",
      ).toEqual({ bat: true, cuong_che: true });
      // Nhãn lượt trong thông báo: người trực đêm phải đọc được lỗi đến từ lượt nào.
      expect(loi!.message).toContain("(phan_xet)");

      // Triệu chứng (2): vá được bằng một migration MỚI, không phải sửa tay trên cụm.
      await writeFile(
        join(thuMucTam, "004_sua_policy.sql"),
        "ALTER POLICY bang_hong_p ON bang_hong USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["004_sua_policy.sql"]);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 120_000);

  it("[I3] lượt SỬA không phán xét, và chế độ lạ thì GÃY thay vì im lặng thành no-op", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const sql = await readFile(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
      await db.pool.query("ALTER POLICY users_tenant_isolation ON users USING (true)");

      const chay = async (cheDo: string): Promise<string | null> => {
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT set_config('app.hardening_che_do', $1, true)", [cheDo]);
          await client.query(sql);
          await client.query("COMMIT");
          return null;
        } catch (e) {
          await client.query("ROLLBACK").catch(() => undefined);
          return (e as Error).message;
        } finally {
          client.release();
        }
      };

      // Lược đồ ĐANG hỏng, nhưng lượt 'sua' phải đi qua — đó là thứ cho phép một migration vá
      // lỗi tới được đích thay vì kẹt sau một hàng rào chạy quá sớm.
      expect(await chay("sua"), "lượt SỬA không được phán xét").toBeNull();
      expect(await chay("phan_xet")).toContain("hình dạng biểu thức KHÔNG nằm trong danh sách");
      // Một lỗi chính tả trong migrate.ts không được âm thầm biến phán xét thành no-op.
      expect(await chay("day_du_typo")).toContain("không hợp lệ");
    } finally {
      await db.stop();
    }
  });

  // ==========================================================================================
  // [vòng fix 2 — CR1] DANH SÁCH TRẮNG BỊ VƯỢT BẰNG search_path
  // ==========================================================================================
  // Vòng 1 tự phát hiện rằng pg_get_expr deparse THEO search_path của phiên đang đọc, rồi xử lý
  // bằng cách NỚI danh sách trắng ra để chứa cả hai dạng. Nới ra chính là cơ chế của lỗ hổng
  // này: dạng TRẦN được duyệt VÔ ĐIỀU KIỆN, mà dạng trần đúng là thứ một hàm
  // app_current_org_id() ở SCHEMA KHÁC sinh ra khi schema đó đứng trước trong search_path của
  // phiên đọc. Đây là rò rỉ XUYÊN TỔ CHỨC thật, ổn định qua mọi lần migrate().
  //
  // Test đo BA nửa, cố ý tách bạch:
  //   (a) LỖ HỔNG CÓ THẬT — dưới search_path thù địch, chính policy đó deparse ra ĐÚNG chuỗi
  //       mà danh sách trắng duyệt, trong khi nó THẬT SỰ gọi hàm của schema lạ, và app_api gắn
  //       tổ chức A đọc được người dùng của tổ chức B.
  //   (b) GHIM ĐÓNG ĐƯỢC — migrate() chạy trên một kết nối MỚI (nên nó THỪA HƯỞNG rolconfig thù
  //       địch, không được cứu nhờ một client cũ trong pool) vẫn CHẶN, vì nó tự ghim search_path.
  //   (d) KHÔNG BÁO NHẦM — lược đồ sạch dưới cùng rolconfig thù địch vẫn đi qua.
  it("[CR1] danh sách trắng không bị vượt bằng search_path của phiên phán xét", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1,'a@a.com','A'), ($2,'vip@b.com','B')",
        [orgA, orgB],
      );

      // Đúng payload của re-reviewer: một app_current_org_id() GIẢ ở schema khác, trả về tổ
      // chức B bất kể phiên gắn tổ chức nào.
      await db.pool.query("CREATE SCHEMA gia");
      await db.pool.query(
        "CREATE FUNCTION gia.app_current_org_id() RETURNS uuid LANGUAGE sql STABLE AS " +
          `'SELECT ''${orgB}''::uuid'`,
      );
      await db.pool.query("GRANT USAGE ON SCHEMA gia TO PUBLIC");

      const khach = await db.pool.connect();
      try {
        await khach.query("SET search_path TO gia, public");
        await khach.query(
          "ALTER POLICY users_tenant_isolation ON public.users " +
            "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
        );
      } finally {
        khach.release();
      }
      // rolconfig của role deploy — KHÔNG nằm trong vùng canh của hardening (nó chỉ reset
      // rolconfig của BỐN role ứng dụng và search_path ở mức DATABASE), nên đây là chặn 0%.
      const { rows: ai } = await db.pool.query<{ u: string }>("SELECT current_user AS u");
      await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, public`);

      // (a) Lỗ hổng có thật. Kết nối MỚI mới thừa hưởng rolconfig, nên đo trên pool mới.
      const poolThuDich = createPool(db.connectionString, 2);
      try {
        const { rows } = await poolThuDich.query<{ sp: string; e: string }>(
          "SELECT current_setting('search_path') AS sp, " +
            "       pg_get_expr(polqual, polrelid) AS e " +
            "  FROM pg_policy WHERE polname = 'users_tenant_isolation'",
        );
        expect(rows[0]!.sp).toContain("gia");
        expect(
          rows[0]!.e,
          "nếu phép đo này KHÔNG ra chuỗi trần thì payload đã hỏng và cả test này rỗng ruột",
        ).toBe("(org_id = app_current_org_id())");

        const apiPool = db.poolAs("app_api");
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows: doc } = await client.query<{ email: string }>(
            "SELECT email FROM public.users ORDER BY 1",
          );
          expect(
            doc.map((r) => r.email),
            "policy đang gọi gia.app_current_org_id — nếu phép đo này chỉ thấy a@a.com thì lỗ " +
              "hổng không tồn tại và nửa (b) là thừa. Đo lại trước khi kết luận.",
          ).toEqual(["vip@b.com"]);
        } finally {
          client.release();
        }

        // (b) migrate() trên kết nối THỪA HƯỞNG rolconfig thù địch vẫn phải CHẶN.
        const loi = await migrate(poolThuDich, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, "policy gọi hàm của schema lạ đi lọt qua migrate()").not.toBeNull();
        expect(loi!.message).toContain("gia.app_current_org_id()");

        // (c) LỚP GHIM THỨ HAI, đo riêng: chạy hardening.always.sql BẰNG TAY (psql -f) trên
        // một phiên có search_path thù địch — đường đi KHÔNG qua migrate.ts nên nó không được
        // hưởng dòng "SET search_path" ở đó. Chỉ lần ghim trong CHÍNH file SQL cứu được ca này.
        // Không có nửa này thì việc gỡ lần ghim trong SQL là một đột biến SỐNG SÓT (đã đo).
        // Pool RIÊNG, chưa từng đi qua migrate(): kết nối trong poolThuDich đã bị migrate() đặt
        // "SET search_path = public" và giữ nguyên giá trị đó khi quay lại pool (hành vi có chủ
        // đích, ghi ở migrate.ts) — dùng lại nó ở đây sẽ làm phép đo rỗng ruột.
        //
        // Kịch bản thù địch ở đây MẠNH HƠN ở (a)/(b) một bậc, và cố ý: 'gia' đặt TRƯỚC
        // pg_catalog, cộng một pg_catalog.current_setting GIẢ. Đã đo là quy tắc "pg_catalog
        // được tìm ngầm trước" PHÁ ĐƯỢC đúng bằng cách này (current_setting trả 'BI_CUOP').
        // Nó tấn công khối DECLARE của hardening.always.sql — khối chạy TRƯỚC lần ghim trong
        // chính file đó, nên chỉ việc ghi đủ "pg_catalog." trong DECLARE mới cứu được.
        await db.pool.query(
          "CREATE FUNCTION gia.current_setting(text, boolean) RETURNS text LANGUAGE sql " +
            "IMMUTABLE AS 'SELECT ''BI_CUOP'''",
        );
        await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, pg_catalog, public`);

        const sqlHardening = await readFile(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
        const poolTay = createPool(db.connectionString, 1);
        const bangTay = await poolTay.connect();
        let loiBangTay: string | null = null;
        try {
          await bangTay.query("BEGIN");
          await bangTay.query("SELECT pg_catalog.set_config('app.hardening_che_do', 'phan_xet', true)");
          const { rows: sp } = await bangTay.query<{ sp: string; cuop: string }>(
            "SELECT pg_catalog.current_setting('search_path') AS sp, " +
              "       current_setting('bat_ky', true) AS cuop",
          );
          expect(sp[0]!.sp, "phiên chạy tay phải đang mang search_path thù địch").toContain("gia");
          expect(
            sp[0]!.cuop,
            "pg_catalog.current_setting chưa bị cướp — kịch bản thù địch hỏng, phép đo rỗng ruột",
          ).toBe("BI_CUOP");
          await bangTay.query(sqlHardening);
          await bangTay.query("COMMIT");
        } catch (e) {
          await bangTay.query("ROLLBACK").catch(() => undefined);
          loiBangTay = (e as Error).message;
        } finally {
          bangTay.release();
          await poolTay.end();
        }
        expect(
          loiBangTay,
          "chạy hardening.always.sql bằng tay dưới search_path thù địch KHÔNG bắt được policy " +
            "gọi hàm của schema lạ — lần ghim trong chính file SQL, hoặc phần ghi đủ " +
            '"pg_catalog." trong khối DECLARE, đã mất tác dụng.',
        ).toContain("gia.app_current_org_id()");

        await db.pool.query("DROP FUNCTION gia.current_setting(text, boolean)");
        await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, public`);

        // (d) Không báo nhầm: chữa policy về khuôn chuẩn thì cùng rolconfig đó vẫn đi qua.
        await db.pool.query(
          "ALTER POLICY users_tenant_isolation ON public.users " +
            "USING (org_id = public.app_current_org_id()) " +
            "WITH CHECK (org_id = public.app_current_org_id())",
        );
        await expect(migrate(poolThuDich, MIGRATIONS_DIR)).resolves.toEqual([]);
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [vòng fix 2 — Minor] Cùng nghiệm với CR1, triệu chứng khác: "CREATE TABLE IF NOT EXISTS
  // schema_migrations" tạo bảng ở schema ĐẦU TIÊN của search_path. Dưới rolconfig thù địch, bản
  // trước tạo gia.schema_migrations, thấy bảng rỗng, rồi ÁP LẠI TOÀN BỘ 001/002 vào schema lạ —
  // idempotency của migrate() tự vỡ mà không ai báo.
  it("[Minor] migrate() dưới search_path thù địch vẫn đặt lược đồ vào public và vẫn idempotent", async () => {
    const db = await startPostgres();
    try {
      const { rows: ai } = await db.pool.query<{ u: string }>("SELECT current_user AS u");
      await db.pool.query("CREATE SCHEMA gia");
      await db.pool.query(`ALTER ROLE ${ai[0]!.u} SET search_path = gia, public`);

      const poolThuDich = createPool(db.connectionString, 2);
      try {
        const lan1 = await migrate(poolThuDich, MIGRATIONS_DIR);
        expect(lan1).toEqual([
          "001_roles_and_functions.sql",
          "002_organizations_and_users.sql",
          "003_audit_events.sql",
          "004_audit_chain_functions.sql",
          "005_identity.sql",
          "006_sessions_and_mfa.sql",
          "007_outbox.sql",
          "008_suppliers.sql",
          "009_rfq.sql",
          "010_invitations.sql",
          "011_rfq_hardening.sql",
          "012_invitation_hardening.sql",
          "013_actor_from_session.sql",
          "014_procurement_policy.sql",
          "015_otp_pepper.sql",
          "016_rfq_actor_from_session.sql",
          "017_rfq_key_material.sql",
          "018_vendor_bids.sql",
          "019_unseal.sql",
          "020_comparison.sql",
          "021_ciphertext_audit.sql",
          "022_security_review_s1.sql",
          "023_rfq_open_cancel_permissions.sql",
          "024_moi_lai_va_tran_chi_phi.sql",
          "025_worker_doc_hang_doi.sql",
          "026_xoa_mat_ma_vat_lieu_khoa.sql",
          "027_phien_khach_co_lap.sql",
          "028_khoa_cong_khai_cho_khach.sql",
          "029_dang_nhap_nguoi_mua.sql",
          "030_policy_manage.sql",
          "031_ghi_danh_lai_totp.sql",
          "032_khoa_ho_so_totp_da_xac_nhan.sql",
          "033_policy_manage_khong_cung_tay.sql",
          "034_dinh_chi_thu_hoi_phien.sql",
          "035_phien_ban_chinh_sach_lien_tuc.sql",
          "036_loi_moi_contact_thuoc_supplier.sql",
          "037_vai_ung_dung_la_thanh_vien.sql",
          "038_han_muc_nguoi_goi_dang_nhap.sql",
          "039_phien_can_totp_gan_day.sql",
          "040_dat_lai_totp_hai_nguoi.sql",
          "041_outbox_payload_dang_nhap_xoa_sau_xong.sql",
          "042_bucket_nguoi_goi_toan_cuc.sql",
          "043_danh_tinh_theo_phien_enable_always.sql",
          "044_don_bucket_otp.sql",
          "045_trigger_con_lai_enable_always.sql",
          "046_chi_so_cua_so_otp.sql",
          "047_chi_ghi_them_chan_truncate.sql",
          "048_email_nguoi_dung_chu_thuong.sql",
        ]);
        // Lần hai KHÔNG được áp lại gì — đó chính là tính chất bị vỡ.
        await expect(migrate(poolThuDich, MIGRATIONS_DIR)).resolves.toEqual([]);

        const { rows } = await db.pool.query<{ nsp: string; rel: string }>(
          "SELECT n.nspname AS nsp, c.relname AS rel FROM pg_class c " +
            "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
            " WHERE c.relname IN ('schema_migrations','users','organizations') AND c.relkind = 'r' " +
            " ORDER BY 2, 1",
        );
        expect(rows).toEqual([
          { nsp: "public", rel: "organizations" },
          { nsp: "public", rel: "schema_migrations" },
          { nsp: "public", rel: "users" },
        ]);
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 2 — CR2] CỬA CỦA DANH SÁCH TRẮNG PHẢI THEO ĐỐI TƯỢNG, KHÔNG TOÀN CỤC
  // ==========================================================================================
  // Mô phỏng ĐÚNG việc Task 6 sẽ phải làm — mở một hình dạng riêng cho một bảng — rồi đo rằng
  // việc đó KHÔNG pre-approve cùng hình dạng ấy cho bảng khác. Trên bản vòng 1 (khoá theo
  // (pham_vi, bieu_thuc)) nửa (b) dưới đây ĐI LỌT: "USING (true)" trên CHÍNH bảng users cũng
  // được duyệt. Cách hợp lệ để dùng hệ thống chính là cách làm nó yếu đi trên toàn cục.
  //
  // Test sửa hardening.always.sql trong một THƯ MỤC TẠM (không đụng cây làm việc) vì thứ đang
  // được kiểm là chính cơ chế cửa, không phải nội dung danh sách hiện tại.
  it("[CR2] mở một hình dạng cho MỘT bảng không mở nó cho bảng khác", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-cr2-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      // 003 dựng đúng thứ Task 6 cần: một bảng tenant có policy riêng cho app_unseal.
      await writeFile(
        join(thuMucTam, "003_bang_rieng.sql"),
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n" +
          "CREATE POLICY bao_gia_unseal ON bao_gia FOR SELECT TO app_unseal USING (true);\n" +
          "GRANT SELECT ON bao_gia TO app_api, app_unseal;\n",
        "utf8",
      );

      // Chưa mở cửa: hình dạng "true" phải BỊ CHẶN.
      const loiTruoc = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loiTruoc, "USING (true) chưa được cấp ngoại lệ mà vẫn đi lọt").not.toBeNull();
      expect(loiTruoc!.message).toContain("bao_gia.bao_gia_unseal");

      // Mở cửa cho ĐÚNG (bao_gia, bao_gia_unseal).
      const duongDanHardening = join(thuMucTam, "hardening.always.sql");
      const sqlGoc = await readFile(duongDanHardening, "utf8");
      // [vòng fix 3 — I2] Cửa nay khoá SÁU cột. Cố ý KHÔNG so khớp nguyên văn khoảng trắng
      // của file SQL (một lần xuống dòng trong danh sách sẽ làm test vỡ vì lý do vô nghĩa):
      // bắt đúng dòng giữ chỗ RỖNG rồi chèn dòng ngoại lệ ngay sau nó.
      // [S1.15 / sổ nợ 57] Danh sách nay KHÔNG còn rỗng (044 cấp dòng đầu tiên), nên mẫu cũ —
      // bắt cả `))` đóng danh sách — hết khớp. Neo vào ĐÚNG dòng giữ chỗ RỖNG và chèn ngay sau
      // nó: cách ấy đúng với danh sách rỗng lẫn danh sách đã có dòng thật.
      const sqlDaMo = sqlGoc.replace(
        /\(VALUES \('', '', '', '', '', ''\),/,
        "(VALUES ('', '', '', '', '', ''),\n" +
          "         ('bao_gia', 'bao_gia_unseal', 'r', 'app_unseal', 'co_org_id', 'true'),",
      );
      expect(sqlDaMo, "không tìm thấy NGOAI_LE_HINH_DANG để mở cửa trong bản sao tạm").not.toBe(
        sqlGoc,
      );
      await writeFile(duongDanHardening, sqlDaMo, "utf8");

      // (a) Cửa hoạt động: đúng bảng + đúng policy đó nay đi qua. 003 đã được ghi vào
      // schema_migrations ngay ở lần chạy hỏng bên trên (lượt 1 không phán xét — khuôn ba
      // lượt), nên lần này không có migration nào mới được áp.
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([]);

      // (b) VÀ nó KHÔNG lan sang bảng khác. Đây là nửa mà bản vòng 1 để lọt.
      await db.pool.query("ALTER POLICY users_tenant_isolation ON users USING (true)");
      const loiSau = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(
        loiSau,
        "USING (true) trên users đi lọt vì một ngoại lệ cấp cho bảng KHÁC — cửa vẫn đang là " +
          "toàn cục chứ không theo đối tượng.",
      ).not.toBeNull();
      expect(loiSau!.message).toContain("users.users_tenant_isolation");
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 3 — I2] CỬA THEO-ĐỐI-TƯỢNG PHẢI THU HẸP THEO **LỆNH** VÀ **ROLE**
  // ==========================================================================================
  // Vòng 2 khoá cửa theo (bang, polname) rồi mô tả nó bằng "policy riêng FOR SELECT TO
  // app_unseal" — hai chiều mà khoá KHÔNG có. Test đo đủ ba nửa cho mỗi trục: cửa hoạt động
  // đúng chỗ được cấp; LỖ HÀNH VI có thật khi đổi trục đó; migrate() nay CHẶN.
  it("[I2] ngoại lệ cấp cho (FOR SELECT, TO app_unseal) hết hiệu lực khi đổi role hay đổi lệnh", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-i2v3-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await writeFile(
        join(thuMucTam, "003_bang_rieng.sql"),
        "CREATE TABLE bao_gia (gia int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n" +
          "CREATE POLICY bao_gia_unseal ON bao_gia FOR SELECT TO app_unseal USING (true);\n" +
          "GRANT SELECT ON bao_gia TO app_api, app_unseal;\n",
        "utf8",
      );
      const duongDanHardening = join(thuMucTam, "hardening.always.sql");
      const sqlGoc = await readFile(duongDanHardening, "utf8");
      // [S1.15 / sổ nợ 57] Danh sách nay KHÔNG còn rỗng (044 cấp dòng đầu tiên), nên mẫu cũ —
      // bắt cả `))` đóng danh sách — hết khớp. Neo vào ĐÚNG dòng giữ chỗ RỖNG và chèn ngay sau
      // nó: cách ấy đúng với danh sách rỗng lẫn danh sách đã có dòng thật.
      const sqlDaMo = sqlGoc.replace(
        /\(VALUES \('', '', '', '', '', ''\),/,
        "(VALUES ('', '', '', '', '', ''),\n" +
          "         ('bao_gia', 'bao_gia_unseal', 'r', 'app_unseal', 'co_org_id', 'true'),",
      );
      expect(sqlDaMo, "không tìm thấy NGOAI_LE_HINH_DANG để mở cửa trong bản sao tạm").not.toBe(
        sqlGoc,
      );
      await writeFile(duongDanHardening, sqlDaMo, "utf8");

      // Cửa cấp cho ĐÚNG (bảng, policy, lệnh 'r', role app_unseal) -> đi qua.
      await expect(
        migrate(db.pool, thuMucTam),
        "cửa cấp đúng đối tượng mà vẫn bị chặn — khoá đang chặt tới mức vô dụng",
      ).resolves.toEqual([
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_bang_rieng.sql",
      ]);

      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query("INSERT INTO bao_gia (gia, org_id) VALUES (100,$1), (999,$2)", [
        orgA,
        orgB,
      ]);

      const apiPool = db.poolAs("app_api");
      const docDuoi = async (org: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [org]);
          const { rows } = await client.query<{ gia: number }>(
            "SELECT gia FROM bao_gia ORDER BY 1",
          );
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      expect(await docDuoi(orgA), "trạng thái nền đã sai trước khi đo").toEqual([100]);

      // ---- TRỤC 1: đổi ROLE. Ngoại lệ cấp cho app_unseal, policy chuyển sang app_api.
      await db.pool.query("ALTER POLICY bao_gia_unseal ON bao_gia TO app_api");
      expect(
        await docDuoi(orgA),
        "nếu phép đo này chỉ thấy [100] thì lỗ theo trục ROLE không tồn tại và nửa dưới là " +
          "thừa — đo lại trước khi kết luận",
      ).toEqual([100, 999]);
      const loiRole = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(
        loiRole,
        "đổi role của policy mà ngoại lệ VẪN duyệt — cửa chưa khoá theo role",
      ).not.toBeNull();
      expect(loiRole!.message).toContain("bao_gia.bao_gia_unseal");

      // ---- TRỤC 2: trả lại role, đổi LỆNH từ SELECT sang ALL.
      await db.pool.query("ALTER POLICY bao_gia_unseal ON bao_gia TO app_unseal");
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([]);
      await db.pool.query("DROP POLICY bao_gia_unseal ON bao_gia");
      await db.pool.query(
        "CREATE POLICY bao_gia_unseal ON bao_gia FOR ALL TO app_unseal " +
          "USING (true) WITH CHECK (true)",
      );
      const loiLenh = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(
        loiLenh,
        "đổi lệnh của policy mà ngoại lệ VẪN duyệt — cửa chưa khoá theo lệnh",
      ).not.toBeNull();
      expect(loiLenh!.message).toContain("bao_gia.bao_gia_unseal");
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [S1.51 / khoản nợ 92] BA GUC VẬN HÀNH GẮN SẴN TỪ NGUỒN NGOÀI MỨC DATABASE — PHÁN XÉT
  // ==========================================================================================
  it("[khoản nợ 92] GUC vận hành gắn sẵn: ALTER ROLE ALL / ALTER ROLE <vai> / IN DATABASE / ALTER SYSTEM đều bị bắt — kể cả khi một hàng ưu tiên CAO che hàng ấy (lượt soi 43 NẶNG-1); nguồn database vẫn do ba mục kề TỰ CHỮA rồi migrate() mới chặn ĐÚNG lượt ấy và đi thẳng ở lượt sau; ALTER SYSTEM SET search_path chặn ở phép đọc TRƯỚC lúc ghim; câu SET còn sót trong phiên do vế setting bắt; giá trị ĐÚNG thì đi qua; migrate() từ chối SỚM (NẶNG-3)", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
      const HARDENING = readFileSync(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
      const CAU92 = docHangHardeningTu(HARDENING, "CAU_GUC_VAN_HANH_GAN_SAN");
      const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
      const chayMoi = async (): Promise<Error | null> => {
        // GUC vận hành áp lúc MỞ PHIÊN, nên mỗi phép đo phải trên một kết nối mới — cùng bài học S1.47 (c).
        const p = createPool(db.connectionString, 1);
        try {
          return await loiCua(migrate(p, MIGRATIONS_DIR));
        } finally {
          await p.end();
        }
      };
      const TU_CHOI_SOM = TU_CHOI_GUC_SOM;
      /** Lớp bắt là phép TỪ CHỐI SỚM (hai GUC đọc được) HAY mục 92 ở BƯỚC 3 — tuỳ phiên deploy có thừa kế giá trị không. */
      const bat92 = (loi: Error | null, ghiChu: string): void => {
        expect(loi, ghiChu).not.toBeNull();
        expect(
          loi!.message.includes(TU_CHOI_SOM) || loi!.message.includes("(khoản 92)"),
          `${ghiChu}: ${loi!.message.slice(0, 200)}`,
        ).toBe(true);
      };
      /** Nhánh CATALOG của mục 92, chạy trực tiếp — không phụ thuộc phiên deploy thấy gì. */
      const nhanh92 = async (doan: string, ghiChu: string): Promise<void> => {
        const rows = (await db.pool.query<{ mo_ta: string }>(CAU92)).rows.map((r) => r.mo_ta);
        expect(
          rows.some((m) => m.startsWith(doan)),
          `${ghiChu}; đã thấy: ${JSON.stringify(rows.map((m) => m.slice(0, 80)))}`,
        ).toBe(true);
      };
      const sach92 = async (ghiChu: string): Promise<void> => {
        expect((await db.pool.query<{ mo_ta: string }>(CAU92)).rows.map((r) => r.mo_ta), ghiChu).toEqual([]);
      };
      await sach92("lược đồ thật sau migrate(): không hàng nào");

      // (a) ALTER ROLE ALL SET — hàng (setrole 0, setdatabase 0): ba mục kề lọc `setdatabase = <db>` nên mù.
      await db.pool.query("ALTER ROLE ALL SET row_security = off");
      await nhanh92("mọi vai, mọi database (ALTER ROLE ALL): GUC vận hành row_security", "nhánh catalog phải thấy ALTER ROLE ALL");
      bat92(await chayMoi(), "ALTER ROLE ALL SET row_security phải bị chặn");

      // (a') [lượt soi 43 NẶNG-1] HÀNG CHE: một hàng ưu tiên CAO HƠN mang cùng tên làm `pg_settings` của phiên chỉ thấy
      //      hàng ấy. Bản đầu (chỉ có nhánh `pg_settings`) ĐI QUA và tàn dư `global` sống sót; nhánh catalog vẫn thấy cả hai.
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET row_security = on`);
      await nhanh92("mọi vai, mọi database (ALTER ROLE ALL): GUC vận hành row_security", "hàng che không được giấu hàng ALL");
      // Hàng che là hàng mức database ⇒ lượt sửa gỡ nó ⇒ lượt ấy DỪNG trước vòng migration đánh số (lượt soi 44 CAO-1);
      // hàng `ALTER ROLE ALL` thì không ai gỡ, nên lượt KẾ mới là lượt nêu tên nó ra.
      const loiChe1 = await chayMoi();
      expect(loiChe1, "hàng che bị gỡ ⇒ lượt ấy phải dừng").not.toBeNull();
      expect(loiChe1!.message, `hàng che: ${loiChe1!.message.slice(0, 200)}`).toContain(
        "lượt sửa vừa gỡ cấu hình mức database của GUC vận hành",
      );
      bat92(await chayMoi(), "hàng che: lượt kế phải nêu hàng ALTER ROLE ALL còn lại");
      await db.pool.query(`ALTER DATABASE "${tenDb}" RESET row_security`);
      await db.pool.query("ALTER ROLE ALL RESET row_security");
      expect(await chayMoi(), "đối chứng: RESET cả hai ⇒ đi qua").toBeNull();

      // (a'') [lượt soi 43 NHẸ-5] nguồn `user` và `database user` — hai nguồn khả dĩ nhất trong đời thật; và `search_path`
      //       chỉ được canh ở nhánh catalog (nhánh pg_settings không bao giờ thấy nó — NẶNG-2).
      // Hàng của VAI ỨNG DỤNG — phạm vi của nhánh ⒜ sau lượt soi 44 NẶNG-4 (đúng tập `VI_TU_HANG_CAU_HINH_UNG_DUNG` mà
      // mục khoản 87 dùng). Hai điều cùng đúng ở đây, và vế này tồn tại để nói rõ ai là lớp nào: nhánh catalog THẤY hàng
      // ấy, CÒN bốn mục `RESET ALL` từ S0 thì CHỮA nó ngay ở lượt SỬA nên `migrate()` đi qua. Tức mục 92 là lớp catalog
      // cho hàng mà bốn mục kia không với tới — `ALTER ROLE ALL` ở vế (a) — chứ không phải lớp duy nhất.
      await db.pool.query("ALTER ROLE app_api SET search_path = ke_gian, public");
      await nhanh92("vai app_api (toàn cụm): GUC vận hành search_path", "nhánh catalog phải thấy ALTER ROLE <vai ứng dụng> SET");
      expect(await chayMoi(), "bốn mục RESET ALL tự chữa hàng của vai ứng dụng ở lượt SỬA").toBeNull();
      expect(
        (await db.pool.query<{ c: string[] | null }>("SELECT rolconfig AS c FROM pg_roles WHERE rolname = 'app_api'")).rows[0]!.c,
        "phép đo không rỗng ruột: lượt SỬA thật sự đã dọn rolconfig",
      ).toBeNull();
      await db.pool.query(`ALTER ROLE app_api IN DATABASE "${tenDb}" SET session_replication_role = replica`);
      await nhanh92(`vai app_api IN DATABASE ${tenDb}: GUC vận hành session_replication_role`, "nhánh catalog phải thấy IN DATABASE");
      expect(await chayMoi(), "mục `cấu hình IN DATABASE của app_api` tự chữa hàng ấy").toBeNull();
      await sach92("gỡ hết ⇒ nhánh catalog rỗng");

      // (b) ALTER DATABASE SET — nguồn `database`: ba mục kề TỰ CHỮA, mục 92 cố ý im ở CẢ HAI nhánh, và phép từ chối
      //     SỚM cũng cố ý MÙ nguồn này: từ chối trước lượt sửa thì `ALTER DATABASE … RESET` không bao giờ chạy, ba mục
      //     thành mã chết (ADR-028 §2⑷) và cụm dính vĩnh viễn. Phiên deploy vẫn mang `replica` (giá trị mức database áp
      //     lúc MỞ kết nối, RESET giữa phiên không gỡ) nên phép đọc THỨ HAI — sau lượt sửa, trước vòng migration đánh
      //     số — mới là chỗ chặn. Ba điều phải cùng đúng: chữa xong, chặn đúng lượt ấy, lượt sau đi thẳng.
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET session_replication_role = replica`);
      const pDb = createPool(db.connectionString, 1);
      try {
        expect(
          (await pDb.query<{ source: string }>("SELECT source FROM pg_settings WHERE name = 'session_replication_role'")).rows[0],
          "phép đo không rỗng ruột: kết nối mới phải thấy nguồn `database`",
        ).toEqual({ source: "database" });
        expect(
          (await pDb.query<{ mo_ta: string }>(CAU92)).rows.map((r) => r.mo_ta),
          "nguồn `database` là việc của ba mục kề — mục 92 không nhận, kể cả trên phiên đang dính",
        ).toEqual([]);
      } finally {
        await pDb.end();
      }
      const loiDb = await chayMoi();
      expect(loiDb, "nguồn database: phải chặn vòng migration đánh số SAU lượt sửa").not.toBeNull();
      expect(loiDb!.message, `nguồn database: ${loiDb!.message.slice(0, 200)}`).toContain(
        "lượt sửa vừa gỡ cấu hình mức database của GUC vận hành",
      );
      expect(
        (await db.pool.query(`SELECT 1 FROM pg_db_role_setting WHERE setrole = 0 AND setdatabase = (SELECT oid FROM pg_database WHERE datname = '${tenDb}')`)).rowCount,
        "ba mục kề đã RESET hàng mức database — lượt sửa CÓ chạy, không bị phép từ chối sớm cắt",
      ).toBe(0);
      expect(await chayMoi(), "đã chữa ⇒ lượt deploy kế trên kết nối mới đi thẳng, không kẹt vĩnh viễn").toBeNull();

      // (c) ALTER SYSTEM + pg_reload_conf: nguồn `configuration file`, KHÔNG để lại hàng catalog nào ⇒ nhánh pg_settings bắt.
      await db.pool.query("ALTER SYSTEM SET session_replication_role = replica");
      await db.pool.query("SELECT pg_reload_conf()");
      const pSys = createPool(db.connectionString, 1);
      try {
        const { rows } = await pSys.query<{ reset_val: string; source: string }>(
          "SELECT reset_val, source FROM pg_settings WHERE name = 'session_replication_role'",
        );
        expect(rows[0], "ALTER SYSTEM phải có hiệu lực trên kết nối mới — không thì phép đo rỗng ruột").toEqual({
          reset_val: "replica",
          source: "configuration file",
        });
        bat92(await loiCua(migrate(pSys, MIGRATIONS_DIR)), "ALTER SYSTEM SET session_replication_role phải bị chặn");
      } finally {
        await pSys.end();
      }
      await db.pool.query("ALTER SYSTEM RESET session_replication_role");
      await db.pool.query("SELECT pg_reload_conf()");
      expect(await chayMoi(), "đối chứng: ALTER SYSTEM RESET ⇒ đi qua").toBeNull();

      // (d) [lượt soi 43 NHẸ-4] GIÁ TRỊ ĐÚNG thì đi qua — vế "khác giá trị dự án đòi" là load-bearing, không phải trang trí.
      await db.pool.query("ALTER SYSTEM SET row_security = on");
      await db.pool.query("SELECT pg_reload_conf()");
      const pOn = createPool(db.connectionString, 1);
      try {
        const { rows } = await pOn.query<{ reset_val: string; source: string }>(
          "SELECT reset_val, source FROM pg_settings WHERE name = 'row_security'",
        );
        expect(rows[0], "phép đo không rỗng ruột: nguồn đã đổi, giá trị vẫn đúng").toEqual({
          reset_val: "on",
          source: "configuration file",
        });
        expect(await loiCua(migrate(pOn, MIGRATIONS_DIR)), "giá trị ĐÚNG dự án đòi ⇒ đi qua dù nguồn lạ").toBeNull();
      } finally {
        await pOn.end();
      }
      await db.pool.query("ALTER SYSTEM RESET row_security");
      await db.pool.query("SELECT pg_reload_conf()");

      // (f) [S1.51 — đo mới] `ALTER SYSTEM SET search_path`: KHÔNG để lại hàng catalog (nhánh ⒜ mù) và migrate() ghim
      //     search_path ngay khi mở phiên nên tới BƯỚC 3 `source` đã hoá `session` còn `reset_val` vẫn độc — nhánh ⒝ cũng
      //     không phân biệt được nó với hàng mức database vừa chữa xong. Chỗ duy nhất còn phân biệt được là phép đọc
      //     TRƯỚC lúc ghim trong migrate(). Nếu phép đọc ấy biến mất, ca này lọt hoàn toàn.
      await db.pool.query("ALTER SYSTEM SET search_path = 'ke_gian, public'");
      await db.pool.query("SELECT pg_reload_conf()");
      const pSp = createPool(db.connectionString, 1);
      try {
        expect(
          (await pSp.query<{ reset_val: string; source: string }>("SELECT reset_val, source FROM pg_settings WHERE name = 'search_path'")).rows[0],
          "phép đo không rỗng ruột: kết nối mới phải mở với search_path độc",
        ).toEqual({ reset_val: '"ke_gian, public"', source: "configuration file" });
      } finally {
        await pSp.end();
      }
      const loiSp = await chayMoi();
      expect(loiSp, "ALTER SYSTEM SET search_path phải bị chặn").not.toBeNull();
      expect(loiSp!.message, `search_path: ${loiSp!.message.slice(0, 200)}`).toContain("search_path");
      await db.pool.query("ALTER SYSTEM RESET search_path");
      await db.pool.query("SELECT pg_reload_conf()");
      expect(await chayMoi(), "đối chứng: ALTER SYSTEM RESET search_path ⇒ đi qua").toBeNull();

      // (g) [S1.51 — đo mới] VẾ SETTING của nhánh ⒝: một câu `SET` còn sót trong CHÍNH phiên deploy. `reset_val` KHÔNG đổi
      //     theo `SET` (đo) nên vế reset_val mù hẳn ca này — ca nguy hiểm nhất là một migration đánh số chạy
      //     `SET session_replication_role = replica` rồi quên `RESET`, và lượt phán xét cuối của migrate() chạy sau nó,
      //     trong cùng phiên. Đo trực tiếp trên một kết nối riêng vì migrate() không nhận được câu SET từ bên ngoài.
      const pSot = createPool(db.connectionString, 1);
      try {
        await pSot.query("SET session_replication_role = replica");
        expect(
          (await pSot.query<{ reset_val: string; setting: string }>("SELECT reset_val, setting FROM pg_settings WHERE name = 'session_replication_role'")).rows[0],
          "phép đo không rỗng ruột: SET đổi setting mà không đụng reset_val",
        ).toEqual({ reset_val: "origin", setting: "replica" });
        const moTa = (await pSot.query<{ mo_ta: string }>(CAU92)).rows.map((r) => r.mo_ta);
        expect(
          moTa.some((m) => m.startsWith("phiên deploy hiện tại (nguồn session)") && m.includes("session_replication_role")),
          `vế setting phải thấy câu SET còn sót; đã thấy: ${JSON.stringify(moTa.map((m) => m.slice(0, 60)))}`,
        ).toBe(true);
      } finally {
        await pSot.end();
      }
      await sach92("phiên khác không dính câu SET của phiên kia");

      // (h) [S1.51 — đo mới] PHẠM VI của nhánh ⒜: một hàng `IN DATABASE <db khác>` KHÔNG phiên nào của database này nhận
      //     được, nên nêu nó ra là chặn deploy trên một cụm HỢP LỆ (ADR-028 §3). Bản đầu không có vế phạm vi và ĐÃ nêu nó.
      await db.pool.query("DROP DATABASE IF EXISTS zz_db_khac92");
      await db.pool.query("CREATE DATABASE zz_db_khac92");
      await db.pool.query("DROP ROLE IF EXISTS zz_vai_khac92; CREATE ROLE zz_vai_khac92 NOLOGIN");
      try {
        await db.pool.query("ALTER ROLE zz_vai_khac92 IN DATABASE zz_db_khac92 SET row_security = off");
        expect(
          (await db.pool.query("SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = 'zz_db_khac92'")).rowCount,
          "phép đo không rỗng ruột: hàng catalog của database kia phải tồn tại",
        ).toBe(1);
        await sach92("hàng IN DATABASE của database KHÁC không áp được cho phiên nào ở đây ⇒ không được nêu");
        expect(await chayMoi(), "hàng của database khác không được chặn deploy").toBeNull();
      } finally {
        await db.pool.query("ALTER ROLE zz_vai_khac92 IN DATABASE zz_db_khac92 RESET row_security");
        await db.pool.query("DROP DATABASE IF EXISTS zz_db_khac92");
        await db.pool.query("DROP ROLE IF EXISTS zz_vai_khac92");
      }

      // (i) [lượt soi 44 CAO-1] HÀNG CHE Ở MỨC DATABASE MANG GIÁ TRỊ ĐÚNG. `ALTER SYSTEM` đặt độc ở tầng `file`;
      //     `ALTER DATABASE … SET <giá trị đúng>` — một biện pháp giảm nhẹ HỢP LỆ của người vận hành — che nó, vì
      //     PostgreSQL xếp `database` trên `file`. Phiên deploy thấy giá trị ĐÚNG ⇒ mọi phép đọc trong phiên im; lượt SỬA
      //     thì gỡ hàng che VÔ ĐIỀU KIỆN ⇒ bản đầu deploy XANH và mọi phiên ứng dụng mở sau đó chạy dưới `replica`.
      //     Lớp chặn là: lượt sửa có gỡ hàng mức database nào thì DỪNG và đòi phiên mới — phiên mới đọc được nguồn thật.
      await db.pool.query("ALTER SYSTEM SET session_replication_role = replica");
      await db.pool.query("SELECT pg_reload_conf()");
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET session_replication_role = origin`);
      const pChe = createPool(db.connectionString, 1);
      try {
        expect(
          (await pChe.query<{ setting: string; source: string }>("SELECT setting, source FROM pg_settings WHERE name = 'session_replication_role'")).rows[0],
          "phép đo không rỗng ruột: hàng che phải thắng hàng file",
        ).toEqual({ setting: "origin", source: "database" });
        expect(
          (await pChe.query<{ mo_ta: string }>(CAU92)).rows.map((r) => r.mo_ta),
          "mục 92 nhìn phiên này thấy mọi thứ đúng — đó chính là lý do lớp chặn không thể là mục 92",
        ).toEqual([]);
      } finally {
        await pChe.end();
      }
      const loiChe = await chayMoi();
      expect(loiChe, "hàng che bị lượt sửa gỡ ⇒ phải DỪNG, không được đi tiếp").not.toBeNull();
      expect(loiChe!.message, `hàng che: ${loiChe!.message.slice(0, 220)}`).toContain(
        "lượt sửa vừa gỡ cấu hình mức database của GUC vận hành",
      );
      const pSau = createPool(db.connectionString, 1);
      try {
        expect(
          (await pSau.query<{ setting: string; source: string }>("SELECT setting, source FROM pg_settings WHERE name = 'session_replication_role'")).rows[0],
          "sau khi hàng che bị gỡ, độc ở tầng file lộ ra — đây là thứ lượt deploy kế phải thấy",
        ).toEqual({ setting: "replica", source: "configuration file" });
      } finally {
        await pSau.end();
      }
      bat92(await chayMoi(), "lượt kế: độc ALTER SYSTEM lộ ra và phải bị chặn");
      await db.pool.query("ALTER SYSTEM RESET session_replication_role");
      await db.pool.query("SELECT pg_reload_conf()");
      expect(await chayMoi(), "đối chứng: gỡ hết ⇒ đi qua").toBeNull();

      // (k) [lượt soi 44 NẶNG-3] `search_path = 'public'` — cấu hình AN TOÀN HƠN mặc định, và là cách một cụm tự chữa
      //     khoản 78 — phải deploy được. Bản đầu so nguyên văn `'"$user", public'` nên chặn nó VĨNH VIỄN, không cửa ra.
      await db.pool.query("ALTER SYSTEM SET search_path = 'public'");
      await db.pool.query("SELECT pg_reload_conf()");
      expect(await chayMoi(), "search_path = 'public' là hợp lệ ⇒ không được chặn deploy").toBeNull();
      // ĐO: `ALTER SYSTEM SET search_path = 'a, b'` (một chuỗi) tạo ra MỘT schema tên `"a, b"`, không phải hai phần tử —
      // muốn hai phần tử phải viết danh sách trần. Đây cũng là lý do độc ở vế (f) ăn được: nó đẩy `public` ra khỏi đường.
      await db.pool.query("ALTER SYSTEM SET search_path = pg_catalog, public");
      await db.pool.query("SELECT pg_reload_conf()");
      expect(await chayMoi(), "search_path = pg_catalog, public cũng hợp lệ").toBeNull();
      await db.pool.query("ALTER SYSTEM RESET search_path");
      await db.pool.query("SELECT pg_reload_conf()");

      // (l) [lượt soi 44 NHẸ-5] `session_replication_role = local` bắn ĐÚNG tập trigger như `origin` ⇒ không được chặn.
      await db.pool.query("ALTER SYSTEM SET session_replication_role = local");
      await db.pool.query("SELECT pg_reload_conf()");
      expect(await chayMoi(), "`local` không đổi hành vi trigger ⇒ không được chặn deploy").toBeNull();
      await db.pool.query("ALTER SYSTEM RESET session_replication_role");
      await db.pool.query("SELECT pg_reload_conf()");

      // (m) [lượt soi 44 NẶNG-4] Vai THỨ BA (không phải vai ứng dụng, không phải `ALTER ROLE ALL`) đặt search_path riêng:
      //     một quy ước cá nhân không chạm phiên ứng dụng nào ⇒ không được chặn deploy.
      await db.pool.query("DROP ROLE IF EXISTS zz_dba92; CREATE ROLE zz_dba92 NOLOGIN");
      try {
        await db.pool.query("ALTER ROLE zz_dba92 SET search_path = dba, public");
        await sach92("vai thứ ba có search_path riêng không phải việc của mục 92");
        expect(await chayMoi(), "vai thứ ba không được chặn deploy").toBeNull();
      } finally {
        await db.pool.query("ALTER ROLE zz_dba92 RESET search_path");
        await db.pool.query("DROP ROLE IF EXISTS zz_dba92");
      }

      // (e) options= trên chuỗi kết nối: `createPool` của dự án TỪ CHỐI thẳng tham số ấy — hàng rào có sẵn, và là lý do
      //     đường này không mở cho tiến trình nào của kho. Nguồn `client` không đo được ở tầng test này (`pg` chỉ là
      //     import kiểu, không dựng nổi pool ngoài `createPool`) — nói ra thay vì khẳng định suông.
      const url = new URL(db.connectionString);
      url.searchParams.set("options", "-c row_security=off");
      expect(() => createPool(url.toString(), 1), "createPool cấm `options` trong chuỗi kết nối").toThrow(/options/u);
    } finally {
      await db.stop();
    }
  }, 300_000);

  // ==========================================================================================
  // [S1.48 / lượt soi ngang 40a H1] migrate() TỪ CHỐI TRƯỚC LƯỢT SỬA khi phiên deploy mang GUC app.*
  // ==========================================================================================
  it("[S1.48 / 40a H1] ALTER DATABASE … SET app.org_id ⇒ migrate() trên kết nối mới từ chối TRƯỚC lượt sửa: migration đánh số mới KHÔNG chạy, không dòng schema_migrations, thông điệp nêu tên không nêu giá trị; RESET ⇒ kết nối mới chạy, bảng có", async () => {
    const db = await startPostgres();
    const tmp = await mkdtemp(join(tmpdir(), "tp-h1-"));
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      for (const f of await readdir(MIGRATIONS_DIR)) await copyFile(join(MIGRATIONS_DIR, f), join(tmp, f));
      await writeFile(join(tmp, "999_zz_h1.sql"), "CREATE TABLE public.zz_h1 (x int);\n", "utf8");
      const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
      const guc = "00000000-0000-4000-8000-000000000048";
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET app.org_id = '${guc}'`);
      const poolMoi = createPool(db.connectionString, 1);
      try {
        const loi = await migrate(poolMoi, tmp).then(() => null, (e: Error) => e);
        expect(loi, "phiên deploy mang app.org_id phải bị từ chối").not.toBeNull();
        expect(loi!.message).toContain(`${TU_CHOI_GUC_SOM} — app.org_id`);
        expect(loi!.message).not.toContain(guc);
        // Bản trước S1.48: 999 đã chạy dưới B và đã ghi checksum, rồi mục 87 mới NÉM.
        expect((await db.pool.query("SELECT 1 FROM pg_class WHERE relname = 'zz_h1'")).rowCount, "migration đánh số không được chạy").toBe(0);
        expect((await db.pool.query("SELECT 1 FROM schema_migrations WHERE version LIKE '999%'")).rowCount).toBe(0);
      } finally {
        await poolMoi.end();
      }
      await db.pool.query(`ALTER DATABASE "${tenDb}" RESET app.org_id`);
      const poolSau = createPool(db.connectionString, 1);
      try {
        await expect(migrate(poolSau, tmp)).resolves.toEqual(["999_zz_h1.sql"]);
        expect((await db.pool.query("SELECT 1 FROM pg_class WHERE relname = 'zz_h1'")).rowCount).toBe(1);
      } finally {
        await poolSau.end();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await db.stop();
    }
  }, 240_000);

  // ==========================================================================================
  // [S1.47 / khoản nợ 87] GUC TUỲ BIẾN (app.*) GẮN SẴN Ở MỨC DATABASE — PHÁN XÉT, KHÔNG TỰ RESET
  // ==========================================================================================
  // Lượt soi ngang 33a #1: `ALTER DATABASE d SET app.org_id = <B>` lật [INV-F1] "chưa gắn ⇒ 0 hàng" thành
  // "⇒ tổ chức B" cho mọi câu ngoài withTenant; ba mục "đặt ở mức database" chỉ ghim ba tên. Mục khoản 87 phán
  // xét theo tính chất (tên GUC có dấu chấm) và KHÔNG tự RESET vì vai deploy thường không làm được — vế (c) đo.
  it("[khoản nợ 87] ALTER DATABASE … SET app.org_id (superuser) ⇒ migrate() NÉM ở mục khoản 87 mà không in giá trị, GUC còn nguyên (không tự RESET); RESET ⇒ đi qua; ALTER ROLE app_api SET app.* ⇒ RESET ALL tự chữa, mục im; vai deploy thường (chủ database, CREATEROLE, không superuser) bị 42501 ở SET lẫn RESET GUC placeholder — lý do mục không tự sửa — trong khi GUC thường thì được", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
      const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
      const setconfigDb = async (): Promise<string[] | null> =>
        (await db.pool.query<{ s: string[] | null }>("SELECT setconfig AS s FROM pg_db_role_setting WHERE setrole = 0")).rows[0]?.s ?? null;
      const guc = "00000000-0000-4000-8000-000000000087";
      const HARDENING = readFileSync(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
      const CAU87 = docHangHardeningTu(HARDENING, "CAU_GUC_TUY_BIEN_GAN_SAN");
      // [S1.48 / 40a H1] migrate() nay TỪ CHỐI SỚM khi CHÍNH phiên deploy mang một trong bốn GUC lõi (kết nối mở sau ALTER
      // DATABASE SET thừa kế giá trị; migrate() huỷ client mỗi lượt nên lượt kế thường là phiên mới). Với bốn tên ấy, lớp bắt là
      // phép từ chối sớm HAY mục 87 ở BƯỚC 3 — tuỳ phiên có thừa kế hay không; nhánh ⒜/⒜′ được đo bằng câu phán xét chạy
      // trực tiếp (không phụ thuộc phiên). `bat87` chấp nhận một trong hai thông điệp cho tên `app.org_id`.
      const TU_CHOI_SOM = `${TU_CHOI_GUC_SOM} — app.org_id`;
      const bat87 = (loi: Error | null, doanA: string, ghiChu: string): void => {
        expect(loi, ghiChu).not.toBeNull();
        expect(loi!.message.includes(TU_CHOI_SOM) || loi!.message.includes(doanA), `${ghiChu}: ${loi!.message.slice(0, 300)}`).toBe(true);
        expect(loi!.message, "không in giá trị").not.toContain(guc);
      };
      const nhanhA = async (pool: pg.Pool | pg.PoolClient, doan: string, ghiChu: string): Promise<void> => {
        const rows = (await pool.query<{ mo_ta: string }>(CAU87)).rows.map((r) => r.mo_ta);
        expect(rows.some((m) => m.startsWith(doan)), `${ghiChu}; đã thấy: ${JSON.stringify(rows)}`).toBe(true);
        expect(rows.join(" | "), "không in giá trị").not.toContain(guc);
      };

      // (a) mức database — phán xét, không tự RESET, không in giá trị.
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET app.org_id = '${guc}'`);
      const loi = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      bat87(loi, `database ${tenDb}: GUC tuỳ biến app.org_id gắn sẵn`, "GUC tuỳ biến gắn sẵn ở mức database phải bị bắt");
      await nhanhA(db.pool, `database ${tenDb}: GUC tuỳ biến app.org_id gắn sẵn`, "nhánh ⒜ (câu phán xét chạy trực tiếp)");
      expect(await setconfigDb(), "hardening không tự RESET GUC placeholder").toEqual([`app.org_id=${guc}`]);
      await db.pool.query(`ALTER DATABASE "${tenDb}" RESET app.org_id`);
      await expect(migrate(db.pool, MIGRATIONS_DIR), "đối chứng: RESET ⇒ đi qua").resolves.toEqual([]);

      // (b) vai có tên: bốn mục RESET ALL đứng TRƯỚC và tự chữa — mục 87 im (kề nhau, không chồng).
      await db.pool.query(`ALTER ROLE app_api SET app.guest_session_id = '${guc}'`);
      await db.pool.query(`ALTER ROLE app_api IN DATABASE "${tenDb}" SET app.org_id = '${guc}'`);
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect((await db.pool.query<{ c: string[] | null }>("SELECT rolconfig AS c FROM pg_roles WHERE rolname = 'app_api'")).rows[0]!.c).toBeNull();
      expect((await db.pool.query("SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'app_api'")).rowCount).toBe(0);
      // Câu phán xét chạy trong test: nhánh (b) THẤY hàng của vai khi chưa ai RESET (chống rỗng ruột cho dây an toàn).
      await db.pool.query(`ALTER ROLE app_api SET app.guest_rfq_id = '${guc}'`);
      const { rows: thay } = await db.pool.query<{ mo_ta: string }>(docHangHardeningTu(HARDENING, "CAU_GUC_TUY_BIEN_GAN_SAN"));
      expect(thay.map((r) => r.mo_ta.split(" —")[0])).toEqual(["vai app_api (toàn cụm): GUC tuỳ biến app.guest_rfq_id gắn sẵn"]);
      await db.pool.query("ALTER ROLE app_api RESET ALL");
      // GUC vận hành KHÔNG dấu chấm không thuộc mục (I3: hàng xóm không được chặn deploy vĩnh viễn).
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET DateStyle = 'ISO, DMY'`);
      expect(await db.pool.query<{ mo_ta: string }>(docHangHardeningTu(HARDENING, "CAU_GUC_TUY_BIEN_GAN_SAN")).then((r) => r.rows)).toEqual([]);
      await db.pool.query(`ALTER DATABASE "${tenDb}" RESET DateStyle`);

      // (a′) [lượt soi 39 NHẸ-1] `ALTER ROLE ALL SET` — hàng (setrole 0, setdatabase 0): bị bắt VÀ có tên riêng (bản đầu: mo_ta NULL,
      //      thông điệp "SAI ()"); ba mục kề (row_security/…) không thấy hàng ấy — khoản 92.
      await db.pool.query(`ALTER ROLE ALL SET app.org_id = '${guc}'`);
      const loiAll = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      bat87(loiAll, "mọi vai, mọi database (ALTER ROLE ALL): GUC tuỳ biến app.org_id gắn sẵn", "ALTER ROLE ALL phải bị bắt");
      await nhanhA(db.pool, "mọi vai, mọi database (ALTER ROLE ALL): GUC tuỳ biến app.org_id gắn sẵn", "nhánh ⒜′ (câu phán xét chạy trực tiếp)");
      await db.pool.query("ALTER ROLE ALL RESET app.org_id");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // (e) [lượt soi 39 NHẸ-5] proconfig của hàm trong lược đồ dự án.
      await db.pool.query(`CREATE FUNCTION public.zz_f87(x int) RETURNS int LANGUAGE sql SET app.org_id = '${guc}' AS 'SELECT 1'`);
      const loiHam = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loiHam!.message).toContain("hàm public.zz_f87(x integer) (proconfig): GUC tuỳ biến app.org_id gắn sẵn cho thân hàm");
      await db.pool.query("DROP FUNCTION public.zz_f87(int)");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // (c′) [lượt soi 39 NẶNG-2] ALTER SYSTEM: postgresql.auto.conf — pg_db_role_setting SẠCH; placeholder KHÔNG có ở
      //      pg_settings (thăm dò S1.47) nên nhánh ⒞ đọc current_setting trên tập tên policy/hàm dự án đọc, trong phiên
      //      deploy (kết nối MỚI sau pg_reload_conf). PG16: placeholder phải có trong phiên trước khi ALTER SYSTEM.
      const c1 = await db.pool.connect();
      try {
        await c1.query(`SET app.org_id = '${guc}'`);
        await c1.query(`ALTER SYSTEM SET app.org_id = '${guc}'`);
        await c1.query("SELECT pg_reload_conf()");
      } finally {
        c1.release();
      }
      const poolSys = createPool(db.connectionString, 1);
      try {
        const { rows: nguon } = await poolSys.query<{ v: string | null; ps: number }>(
          "SELECT current_setting('app.org_id', true) AS v, (SELECT count(*)::int FROM pg_settings WHERE name = 'app.org_id') AS ps",
        );
        expect(nguon[0], "ALTER SYSTEM phải có hiệu lực trên kết nối mới, và placeholder vắng ở pg_settings (đo)").toEqual({ v: guc, ps: 0 });
        expect(await setconfigDb(), "pg_db_role_setting sạch — bản đầu mù ở đây").toBeNull();
        // [S1.48 / 40a H1] migrate() nay TỪ CHỐI SỚM (trước lượt sửa) cho bốn GUC lõi; nhánh ⒞ ở BƯỚC 3 vẫn đứng cho tập tên
        // rộng hơn — đo bằng câu phán xét chạy trực tiếp trên chính phiên ấy.
        const loiSys = await loiCua(migrate(poolSys, MIGRATIONS_DIR));
        expect(loiSys, "ALTER SYSTEM SET app.org_id phải bị từ chối").not.toBeNull();
        expect(loiSys!.message).toContain(`${TU_CHOI_GUC_SOM} — app.org_id`);
        expect(loiSys!.message).not.toContain(guc);
        const cauSys = (await poolSys.query<{ mo_ta: string }>(docHangHardeningTu(HARDENING, "CAU_GUC_TUY_BIEN_GAN_SAN"))).rows.map((r) => r.mo_ta);
        expect(cauSys.some((m) => m.startsWith("phiên deploy hiện tại: GUC app.org_id có giá trị mà không hàng pg_db_role_setting nào của phiên ứng dụng mang nó")), `nhánh ⒞ phải thấy; đã thấy: ${JSON.stringify(cauSys)}`).toBe(true);
        expect(cauSys.join(" | ")).not.toContain(guc);
        await poolSys.query("ALTER SYSTEM RESET app.org_id");
        await poolSys.query("SELECT pg_reload_conf()");
      } finally {
        await poolSys.end();
      }
      const poolSau = createPool(db.connectionString, 1);
      try {
        await expect(migrate(poolSau, MIGRATIONS_DIR), "kết nối mới sau ALTER SYSTEM RESET: đi qua").resolves.toEqual([]);
      } finally {
        await poolSau.end();
      }

      // (c) vai deploy thường: 42501 ở SET lẫn RESET GUC placeholder — lý do mục phán xét thay vì tự sửa; GUC thường thì được.
      // migrate() huỷ client sau mỗi lượt, nên lượt kế mở PHIÊN MỚI — mở trong cửa sổ `ALTER DATABASE SET` thì mang giá trị ấy
      // cả sau RESET (giá trị mức database áp lúc mở phiên; đo — nhánh ⒞ kêu đúng). Đối chứng vì thế phải trên kết nối mới,
      // như một lượt deploy thật.
      const urlTk = await dungRoleTrienKhaiThuong(db);
      let poolTk = createPool(urlTk, 1);
      const ketNoiMoi = async (): Promise<void> => {
        await poolTk.end();
        poolTk = createPool(urlTk, 1);
      };
      try {
        const ma = async (q: string): Promise<string | null> => {
          try { await poolTk.query(q); return null; } catch (e) { return (e as { code?: string }).code ?? "?"; }
        };
        expect(await ma(`ALTER DATABASE "${tenDb}" SET app.org_id = '${guc}'`), "chủ database thường SET placeholder").toBe("42501");
        await db.pool.query(`ALTER DATABASE "${tenDb}" SET app.org_id = '${guc}'`);
        expect(await ma(`ALTER DATABASE "${tenDb}" RESET app.org_id`), "chủ database thường RESET placeholder").toBe("42501");
        // Deploy dưới vai ấy: từ chối sớm (phiên mới thừa kế) hay NÉM ở mục 87 — không gãy thô; ⒜ đo trực tiếp dưới vai thường.
        const loiTk = await loiCua(migrate(poolTk, MIGRATIONS_DIR));
        bat87(loiTk, `database ${tenDb}: GUC tuỳ biến app.org_id gắn sẵn`, "dưới vai deploy thường phải bị bắt");
        await nhanhA(poolTk, `database ${tenDb}: GUC tuỳ biến app.org_id gắn sẵn`, "nhánh ⒜ dưới vai deploy thường");
        await db.pool.query(`ALTER DATABASE "${tenDb}" RESET app.org_id`);
        expect(await ma(`ALTER DATABASE "${tenDb}" SET DateStyle = 'ISO, DMY'`), "GUC thường: chủ database đặt được").toBeNull();
        expect(await ma(`ALTER DATABASE "${tenDb}" RESET DateStyle`)).toBeNull();
        // Phiên mở trong cửa sổ SET vẫn mang app.org_id sau RESET ⇒ migrate() từ chối sớm (S1.48 H1); nhánh ⒞ cũng thấy — đo
        // trực tiếp; kết nối mới ⇒ đi qua.
        const loiCu = await loiCua(migrate(poolTk, MIGRATIONS_DIR));
        expect(loiCu!.message).toContain(`${TU_CHOI_GUC_SOM} — app.org_id`);
        const cauCu = (await poolTk.query<{ mo_ta: string }>(docHangHardeningTu(HARDENING, "CAU_GUC_TUY_BIEN_GAN_SAN"))).rows.map((r) => r.mo_ta);
        expect(cauCu.some((m) => m.startsWith("phiên deploy hiện tại: GUC app.org_id có giá trị mà không hàng pg_db_role_setting nào")), "nhánh ⒞ dưới vai deploy thường").toBe(true);
        await ketNoiMoi();
        await expect(migrate(poolTk, MIGRATIONS_DIR), "đối chứng dưới vai deploy thường (kết nối mới)").resolves.toEqual([]);

        // (b′) [lượt soi 39 NHẸ-3] RESET ALL dưới vai thường GIỮ IM LẶNG phần tử placeholder: mục "rolconfig toàn cụm của app_api"
        //      và mục 87 cùng đỏ, một nguyên nhân; rolconfig còn nguyên. Superuser RESET ⇒ đi qua.
        await db.pool.query(`ALTER ROLE app_api SET app.org_id = '${guc}'`);
        const loiReset = await loiCua(migrate(poolTk, MIGRATIONS_DIR));
        expect(loiReset, "vai deploy thường không RESET được placeholder trên app_api").not.toBeNull();
        expect(loiReset!.message).toContain("rolconfig toàn cụm của app_api");
        expect(loiReset!.message).toContain("vai app_api (toàn cụm): GUC tuỳ biến app.org_id gắn sẵn");
        // [S1.51 / lượt soi 44 NHẸ-3] Thông điệp deploy đi vào log CI: TÊN thì được, GIÁ TRỊ thì không. Trước vòng này ô
        // mô tả của mục "rolconfig toàn cụm" in nguyên `app.org_id=<uuid>` — định danh tổ chức rò ra một nơi lưu lâu hơn
        // và đọc được bởi nhiều người hơn chính CSDL. Khẳng định này là thứ giữ cho nó không quay lại.
        expect(loiReset!.message, "thông điệp chỉ mang TÊN GUC, không mang giá trị").not.toContain(guc);
        expect((await db.pool.query<{ c: string[] | null }>("SELECT rolconfig AS c FROM pg_roles WHERE rolname = 'app_api'")).rows[0]!.c).toEqual([`app.org_id=${guc}`]);
        await db.pool.query("ALTER ROLE app_api RESET ALL");
        await expect(migrate(poolTk, MIGRATIONS_DIR)).resolves.toEqual([]);

        // (d) [lượt soi 39 NHẸ-2] GRANT SET ON PARAMETER (PG15+): vai thường SET/RESET được placeholder ở mức database ⇒ năng lực bền,
        //     bị nhánh pg_parameter_acl bắt bất kể grantee; sau REVOKE lại 42501.
        await db.pool.query("GRANT SET ON PARAMETER app.org_id TO trien_khai");
        const loiAcl = await loiCua(migrate(poolTk, MIGRATIONS_DIR));
        expect(loiAcl!.message).toContain("quyền trên tham số app.org_id cấp cho trien_khai (pg_parameter_acl)");
        expect(await ma(`ALTER DATABASE "${tenDb}" SET app.org_id = '${guc}'`), "được GRANT SET: chủ database thường ĐẶT được placeholder").toBeNull();
        const loiCaHai = await loiCua(migrate(poolTk, MIGRATIONS_DIR));
        bat87(loiCaHai, `database ${tenDb}: GUC tuỳ biến app.org_id gắn sẵn`, "sau GRANT + SET của vai thường phải bị bắt");
        await nhanhA(poolTk, `database ${tenDb}: GUC tuỳ biến app.org_id gắn sẵn`, "nhánh ⒜ sau SET của vai thường");
        expect(await ma(`ALTER DATABASE "${tenDb}" RESET app.org_id`), "được GRANT SET: RESET được").toBeNull();
        await db.pool.query("REVOKE SET ON PARAMETER app.org_id FROM trien_khai");
        expect(await ma(`ALTER DATABASE "${tenDb}" SET app.org_id = '${guc}'`), "sau REVOKE: lại 42501").toBe("42501");
        await ketNoiMoi();
        await expect(migrate(poolTk, MIGRATIONS_DIR), "đối chứng cuối (kết nối mới)").resolves.toEqual([]);
      } finally {
        await poolTk.end();
      }
    } finally {
      await db.stop();
    }
  }, 300000);

  // ==========================================================================================
  // [vòng fix 3 — I3] GHIM CẢ MÔI TRƯỜNG LEX/SO KHỚP, KHÔNG CHỈ search_path
  // ==========================================================================================
  // Vòng 2 ghim search_path và DỪNG. Đo được: "ALTER DATABASE d SET
  // standard_conforming_strings = off" làm migrate() BLOCKED VĨNH VIỄN (lần 1, 2, 3 đều hỏng),
  // kèm chẩn đoán SAI đổ lỗi cho hàm app_current_org_id() trong khi hàm hoàn toàn đúng. Đường
  // sửa duy nhất khi ấy là sửa TAY trên cụm — vi phạm thẳng quy tắc số 1 của dự án.
  // Test đo CẢ HAI mặt: deploy đi qua, VÀ chuỗi deparse mà danh sách trắng so khớp không đổi
  // theo DateStyle/TimeZone/IntervalStyle/bytea_output.
  it("[I3] năm GUC thù địch đặt ở mức DATABASE không chặn deploy, và không đổi chuỗi deparse", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const tenDb = (await db.pool.query<{ ten: string }>("SELECT current_database() AS ten"))
        .rows[0]!.ten;

      for (const dat of [
        "standard_conforming_strings = off",
        "DateStyle = 'German, DMY'",
        "IntervalStyle = 'sql_standard'",
        "TimeZone = 'Asia/Tokyo'",
        "bytea_output = 'escape'",
      ]) {
        await db.pool.query(`ALTER DATABASE "${tenDb}" SET ${dat}`);
      }

      // GUC mức DATABASE chỉ áp cho kết nối MỚI — pool cũ đã mở kết nối rồi.
      const poolMoi = createPool(db.connectionString);
      try {
        expect(
          (
            await poolMoi.query<{ v: string }>(
              "SELECT pg_catalog.current_setting('standard_conforming_strings') AS v",
            )
          ).rows[0]!.v,
          "GUC thù địch không có hiệu lực trên kết nối mới — phép đo dưới đây rỗng ruột",
        ).toBe("off");

        // (a) Deploy vẫn đi qua. Trước bản vá: BLOCKED với "thân/thuộc tính hàm khác bản
        //     chuẩn — prosrc hiện tại: ... pg_catalog.current_ etting(..." (mất chữ 's').
        await expect(
          migrate(poolMoi, MIGRATIONS_DIR),
          "một GUC hàng xóm chặn được deploy VĨNH VIỄN — đường sửa duy nhất là sửa tay trên cụm",
        ).resolves.toEqual([]);

        // (b) Chuỗi deparse ổn định. Một policy chứa hằng ngày/giờ/interval/bytea phải bị CHẶN
        //     với chuỗi kết xuất theo ISO/UTC/postgres/hex, KHÔNG theo GUC của cụm.
        await poolMoi.query(
          "CREATE TABLE bao_gia (org_id uuid NOT NULL, han date, moc timestamptz, " +
            "  keo interval, dau bytea)",
        );
        await poolMoi.query(
          "CREATE POLICY bg ON bao_gia USING (org_id = app_current_org_id() " +
            "  AND han > DATE '2020-01-02' AND moc > TIMESTAMPTZ '2020-01-02 03:04:05+00' " +
            // '\\x01'::bytea cho ra CÙNG một hằng dưới cả hai giá trị scs — đã đo: với scs=off
            // chuỗi lex thành đúng một byte 0x01 rồi byteain nhận nó ở dạng escape; với scs=on
            // byteain đọc bốn ký tự "\\x01" ở dạng hex. Cùng kết quả.
            // (decode('01','hex') KHÔNG dùng được: PostgreSQL không gấp nó thành hằng, biểu
            //  thức lưu lại vẫn là lời gọi hàm — đã thử và đo.)
            "  AND keo > INTERVAL '1 day 2 hours' AND dau <> '\\x01'::bytea) " +
            "WITH CHECK (org_id = app_current_org_id())",
        );
        const loi = await migrate(poolMoi, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, "policy ngoài danh sách trắng đi lọt").not.toBeNull();
        for (const mong of [
          "'2020-01-02'::date",
          "'2020-01-02 03:04:05+00'",
          "'1 day 02:00:00'::interval",
          "'\\x01'::bytea",
        ]) {
          expect(
            loi!.message,
            "pg_get_expr kết xuất hằng theo GUC của cụm — chuỗi mà danh sách trắng so khớp " +
              "đổi theo cấu hình mà kẻ khác chọn",
          ).toContain(mong);
        }
      } finally {
        await poolMoi.end();
      }
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 3 — Minor] CON CHÁU INHERITS Ở SCHEMA KHÁC 'public'
  // ==========================================================================================
  // Vòng 2 gỡ bộ lọc nspname cho view/matview/SECDEF nhưng GIỮ NGUYÊN cho bảng. Bất đối xứng
  // đó là một lỗ thật. Test đo cả hai nửa: hàng của tổ chức B đọc được qua con ở schema khác
  // TRƯỚC khi mục (A) chạm tới nó, và fail-closed sau đó.
  it("[Minor] con INHERITS ở schema KHÁC public cũng được bật ENABLE/FORCE — [S1.40] cặp INHERITS chưa khai bị mục 82⑴ NÉM, miễn policy riêng còn nguyên", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "CREATE TABLE bao_gia (gia int, org_id uuid NOT NULL);" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY;" +
          "ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());" +
          "GRANT SELECT ON bao_gia TO app_api;",
      );
      await db.pool.query(
        "CREATE SCHEMA khac;" +
          "CREATE TABLE khac.con_khac () INHERITS (public.bao_gia);" +
          "GRANT USAGE ON SCHEMA khac TO app_api;" +
          "GRANT SELECT ON khac.con_khac TO app_api;",
      );
      await db.pool.query("INSERT INTO khac.con_khac (gia, org_id) VALUES (777, $1)", [orgB]);

      const co = async (): Promise<{ bat: boolean; cuong_che: boolean }> =>
        (
          await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
            "SELECT c.relrowsecurity AS bat, c.relforcerowsecurity AS cuong_che " +
              "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
              " WHERE n.nspname = 'khac' AND c.relname = 'con_khac'",
          )
        ).rows[0]!;
      expect(
        await co(),
        "CREATE TABLE ... INHERITS đã tự bật RLS — phép đo dưới đây rỗng ruột",
      ).toEqual({ bat: false, cuong_che: false });

      const apiPool = db.poolAs("app_api");
      const docThangCon = async (org: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [org]);
          const { rows } = await client.query<{ gia: number }>("SELECT gia FROM khac.con_khac");
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      // (a) Lỗ HÀNH VI có thật: gắn tổ chức A đọc thẳng con thấy hàng 777 CỦA TỔ CHỨC B.
      expect(await docThangCon(orgA)).toEqual([777]);

      // (b) migrate() bật cờ (BƯỚC 2), đọc thẳng con trở thành fail-closed — và [S1.38 / khoản nợ 83⑵, lượt soi
      //     29 NẶNG-2] chính trạng thái ấy (quyền SELECT trên con mà RLS từ chối tất cả) bị PHÁN XÉT: 0 hàng
      //     không lỗi là cơ chế ADR-036 hàng 6, không phải thiết kế. Thu hồi quyền trên con ⇒ đi qua.
      const loiCon = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiCon, "GRANT trực tiếp lên con không policy phải bị khoản 83⑵ bắt").not.toBeNull();
      expect(loiCon!.message).toContain("khac.con_khac/app_api/SELECT: quyền đã cấp mà không policy PERMISSIVE nào phủ");
      expect(loiCon!.message, "[S1.40 / khoản nợ 82⑴] cặp INHERITS chưa khai bị mục kế thừa bắt cùng lượt").toContain(
        "khac.con_khac INHERITS public.bao_gia: cặp kế thừa cổ điển",
      );
      expect(await co()).toEqual({ bat: true, cuong_che: true });
      expect(await docThangCon(orgA)).toEqual([]);
      await db.pool.query("REVOKE SELECT ON khac.con_khac FROM app_api");
      // ~~con không quyền riêng: đi qua~~ [S1.40 / khoản nợ 82⑴] kỳ vọng LẬT có chủ đích: 83⑵ im, nhưng cặp INHERITS
      // chưa khai vẫn bị mục kế thừa NÉM. ([lượt soi 31, NHẸ-2] [CR1] không soi ngoài public, nên "không dòng [CR1] cho
      // con_khac" là khẳng định rỗng ruột — bằng chứng miễn policy riêng nằm ở test con_tt và ở `public.g` của khoản 84.)
      const loiKeThua = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiKeThua, "cặp INHERITS chưa khai phải bị mục 82⑴ bắt").not.toBeNull();
      expect(loiKeThua!.message).not.toContain("con_khac/app_api");
      expect(loiKeThua!.message).toContain("khac.con_khac INHERITS public.bao_gia: cặp kế thừa cổ điển");

      // (c) Đường đọc THẬT — qua CHA — vẫn đúng: tổ chức B thấy hàng của mình, A không thấy.
      const quaCha = async (org: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [org]);
          const { rows } = await client.query<{ gia: number }>("SELECT gia FROM bao_gia ORDER BY 1");
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      expect(await quaCha(orgB)).toEqual([777]);
      expect(await quaCha(orgA)).toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [S1.40 / khoản nợ 84, lượt soi 29 INFO-9] CHÁU HAI BẬC Ở SCHEMA KHÁC — LA_CUA_BANG_TENANT ĐỆ QUY
  // ==========================================================================================
  // Vế "con của bảng tenant" từng chỉ nhìn cặp cha–con TRỰC TIẾP. Người soi 29 viết đường đo, chưa ai chạy:
  // k.c2 INHERITS (k.c1), k.c1 INHERITS (public.bao_gia) — mục (A) không bật RLS trên k.c2, GRANT SELECT lên
  // k.c2 ⇒ đọc thẳng cháu thấy hàng mọi tổ chức. Test đo cả hai nửa: lỗ RÒ có thật trước khi mục (A) chạm,
  // và fail-closed sau đó nhờ vế đệ quy.
  it("[khoản nợ 84] cháu HAI BẬC ở schema khác public (k.c2 INHERITS k.c1 INHERITS public.bao_gia) cũng được bật ENABLE/FORCE — LA_CUA_BANG_TENANT đệ quy; lỗ RÒ đo TRƯỚC migrate() (bản một bậc trước S1.40 đo bằng đột biến m1, biên bản 55 ⑷)", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "CREATE TABLE bao_gia (gia int, org_id uuid NOT NULL);" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY;" +
          "ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());" +
          "GRANT SELECT ON bao_gia TO app_api;" +
          "CREATE SCHEMA k;" +
          "CREATE TABLE k.c1 () INHERITS (public.bao_gia);" +
          "CREATE TABLE k.c2 () INHERITS (k.c1);" +
          "CREATE TABLE public.g () INHERITS (k.c1);" +
          "GRANT USAGE ON SCHEMA k TO app_api;" +
          "GRANT SELECT ON k.c2 TO app_api;",
      );
      await db.pool.query("INSERT INTO k.c2 (gia, org_id) VALUES (777, $1)", [orgB]);

      const co = async (bang: string): Promise<{ bat: boolean; cuong_che: boolean }> =>
        (
          await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
            "SELECT c.relrowsecurity AS bat, c.relforcerowsecurity AS cuong_che " +
              "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
              " WHERE n.nspname = 'k' AND c.relname = $1",
            [bang],
          )
        ).rows[0]!;
      expect(await co("c2"), "CREATE TABLE ... INHERITS đã tự bật RLS — phép đo dưới đây rỗng ruột").toEqual({ bat: false, cuong_che: false });

      const apiPool = db.poolAs("app_api");
      const docThang = async (org: string, bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [org]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang}`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      // (a) Lỗ RÒ có thật: gắn tổ chức A đọc thẳng CHÁU thấy hàng 777 CỦA TỔ CHỨC B.
      expect(await docThang(orgA, "k.c2")).toEqual([777]);

      // (b) migrate(): BƯỚC 2 (mục A) bật cờ trên CẢ con lẫn cháu nhờ vế đệ quy; lượt phán xét NÉM ở 82⑴ (ba cặp chưa
      //     khai) và 83⑵ (quyền trên cháu không policy phủ). [lượt soi 31, NHẸ-2] [CR1] không soi ngoài public nên "không
      //     dòng [CR1] cho k.c1/k.c2" là rỗng ruột; ca chịu lực của vế đệ quy ở nguồn (i) là `public.g INHERITS (k.c1)` —
      //     bảng tenant ở public (có org_id) không policy riêng: trước S1.40 [CR1] NÉM "g: không có policy PERMISSIVE"
      //     (cha trực tiếp k.c1 không phải bảng tenant public), nay được miễn vì tổ tiên public.bao_gia là bảng tenant.
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi).not.toBeNull();
      expect(await co("c1")).toEqual({ bat: true, cuong_che: true });
      expect(await co("c2"), "cháu HAI BẬC phải được mục (A) bật — vế đệ quy của LA_CUA_BANG_TENANT").toEqual({ bat: true, cuong_che: true });
      expect(loi!.message).toContain("k.c2/app_api/SELECT: quyền đã cấp mà không policy PERMISSIVE nào phủ");
      expect(loi!.message).toContain("k.c1 INHERITS public.bao_gia: cặp kế thừa cổ điển");
      expect(loi!.message).toContain("k.c2 INHERITS k.c1: cặp kế thừa cổ điển");
      expect(loi!.message).toContain("public.g INHERITS k.c1: cặp kế thừa cổ điển");
      expect(loi!.message, "cháu ở public được miễn policy riêng nhờ vế đệ quy — đột biến một bậc đỏ ở đây").not.toContain(
        "g: không có policy PERMISSIVE",
      );
      // (ràng buộc yếu — chỉ có nghĩa khi cháu đã bật RLS: 83⑶ không gọi cháu là "ngoài tập tenant")
      expect(loi!.message).not.toContain("bảng bật RLS ngoài tập tenant");
      expect(await docThang(orgA, "k.c2"), "đọc thẳng cháu nay fail-closed").toEqual([]);

      // (c) Đường đọc THẬT — qua GỐC — vẫn đúng: B thấy hàng của mình ở cháu, A không.
      expect(await docThang(orgB, "public.bao_gia")).toEqual([777]);
      expect(await docThang(orgA, "public.bao_gia")).toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [S1.41 / khoản nợ 85] BẢNG org_id NGOÀI public, KHÔNG TREO DƯỚI TENANT, KHÔNG RLS — hai kẽ của lượt soi 31
  // ==========================================================================================
  // Kẽ ⑴: con INHERITS của bảng tenant bị NO INHERIT giữa hai lần deploy — không hàng pg_inherits (82⑴ im), chưa
  // từng qua mục (A) nên không RLS. Kẽ ⑵: lá phân mảnh ngoài public tạo-và-DETACH giữa hai lần deploy — cùng
  // hình dạng. Trước S1.41: migrate() đi qua, app_api gắn tổ chức A đọc thẳng thấy hàng của B. Nay: NÉM ở khoản 85.
  it("[khoản nợ 85] con NO INHERIT và lá DETACH ngoài public giữa hai lần deploy: lỗ RÒ đo TRƯỚC migrate(); migrate() NÉM ở mục khoản 85 (bản trước S1.41 đi qua — đo bằng đột biến, biên bản 56 ⑷); con đã qua mục (A) (có RLS) thì là việc của 83⑶", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "CREATE TABLE bao_gia (gia int, org_id uuid NOT NULL) PARTITION BY LIST (org_id);" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY; ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());" +
          "CREATE TABLE cha_ke (gia int, org_id uuid NOT NULL);" +
          "ALTER TABLE cha_ke ENABLE ROW LEVEL SECURITY; ALTER TABLE cha_ke FORCE ROW LEVEL SECURITY;" +
          "CREATE POLICY cha_ke_tenant_isolation ON cha_ke " +
          "  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());" +
          "CREATE SCHEMA k; GRANT USAGE ON SCHEMA k TO app_api;" +
          // kẽ ⑵: lá ngoài public, tạo rồi DETACH trước khi migrate() nào chạm tới
          "CREATE TABLE k.la PARTITION OF bao_gia DEFAULT;" +
          "ALTER TABLE bao_gia DETACH PARTITION k.la;" +
          // kẽ ⑴: con ngoài public, INHERITS rồi NO INHERIT trước khi migrate() nào chạm tới
          "CREATE TABLE k.con () INHERITS (cha_ke);" +
          "ALTER TABLE k.con NO INHERIT cha_ke;" +
          "GRANT SELECT ON k.la, k.con TO app_api;",
      );
      await db.pool.query("INSERT INTO k.la (gia, org_id) VALUES (777, $1)", [orgB]);
      await db.pool.query("INSERT INTO k.con (gia, org_id) VALUES (888, $1)", [orgB]);

      const apiPool = db.poolAs("app_api");
      const docThang = async (org: string, bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [org]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang}`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };
      // (a) Lỗ RÒ có thật ở cả hai kẽ: tổ chức A đọc thẳng thấy hàng của B.
      expect(await docThang(orgA, "k.la")).toEqual([777]);
      expect(await docThang(orgA, "k.con")).toEqual([888]);

      // (b) migrate(): không mục nào trước S1.41 chạm hai bảng này (không pg_inherits, không RLS, ngoài public) —
      //     nay khoản 85 NÉM đúng cả hai; không dòng 82⑴, không dòng 83⑶.
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "hai bảng org_id ngoài public không RLS phải bị khoản 85 bắt").not.toBeNull();
      expect(loi!.message).toContain("Hardening không sửa được 1 mục");
      expect(loi!.message).toContain("k.la: bảng có cột org_id ngoài public, không treo dưới bảng tenant nào và không bật RLS — chưa khai (khoản 85)");
      expect(loi!.message).toContain("k.con: bảng có cột org_id ngoài public");
      // Lỗ vẫn mở cho tới khi ai đó sửa — mục này PHÁN XÉT, không tự chữa (ADR-028 §2⑵): nói ra.
      expect(await docThang(orgA, "k.la")).toEqual([777]);

      // (c) Biến thể "đã qua mục (A)": con còn treo khi migrate() chạy ⇒ (A) bật RLS ⇒ sau NO INHERIT nó là bảng RLS
      //     ngoài tenant — 83⑶ bắt, 85 im. Hai mục kề nhau phủ kín hai đường thời gian.
      await db.pool.query("DROP TABLE k.la; DROP TABLE k.con; CREATE TABLE k.con2 () INHERITS (cha_ke)");
      const loiTreo = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiTreo!.message, "còn treo: 82⑴ kêu, 85 im").toContain("k.con2 INHERITS public.cha_ke");
      expect(loiTreo!.message).not.toContain("(khoản 85)");
      await db.pool.query("ALTER TABLE k.con2 NO INHERIT cha_ke");
      const loiSau = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiSau!.message, "đã qua (A) rồi tách: 83⑶").toContain("k.con2: bảng bật RLS ngoài tập tenant chưa khai (khoản 83⑶)");
      expect(loiSau!.message).not.toContain("(khoản 85)");
      // (d) [lượt soi 32, INFO-5] Chuỗi đầy đủ của lượt soi 31 NHẸ-1, đo chứ không suy: RENAME con cũ, dựng con mới CÙNG
      //     TÊN kế thừa cha (tái dùng tên), rồi DISABLE RLS con cũ — con cũ mang RLS thì 83⑶, tắt RLS thì 85; con mới là
      //     cặp chưa khai nên 82⑴ (danh sách thật rỗng; với cặp đã khai, 82⑴ im và con cũ là thứ duy nhất còn lộ).
      await db.pool.query("ALTER TABLE k.con2 RENAME TO con2_cu; CREATE TABLE k.con2 () INHERITS (cha_ke)");
      const loiTen = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiTen!.message).toContain("k.con2_cu: bảng bật RLS ngoài tập tenant chưa khai (khoản 83⑶)");
      expect(loiTen!.message).toContain("k.con2 INHERITS public.cha_ke");
      expect(loiTen!.message).not.toContain("(khoản 85)");
      await db.pool.query("ALTER TABLE k.con2_cu DISABLE ROW LEVEL SECURITY");
      const loiTat = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiTat!.message, "con cũ tắt RLS: đúng hình dạng 85").toContain("k.con2_cu: bảng có cột org_id ngoài public");
      expect(loiTat!.message).not.toContain("k.con2_cu: bảng bật RLS");
      await db.pool.query("DROP TABLE k.con2; DROP TABLE k.con2_cu");
      await expect(migrate(db.pool, MIGRATIONS_DIR), "đối chứng: gỡ ⇒ đi qua").resolves.toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [S1.42 / lượt soi 33b NẶNG-2] BẢNG TẠM KẾ THỪA BẢNG TENANT — phép đo nháp S1.40 thành test thật
  // ==========================================================================================
  // S1.40 lọc pg_temp ở vế con cháu của VI_TU_CAN_CO_RLS và ở 82⑴ (theo con) rồi ghi "(đo)" ở sáu tài liệu — mà kho
  // không tái lập được: không test nào dựng `CREATE TEMP TABLE … INHERITS`. Test này là địa chỉ của lời "(đo)" ấy:
  // (a) bảng tạm của phiên A là của riêng phiên — phiên khác và app_api đọc qua cha KHÔNG thấy hàng của nó;
  // (b) migrate() từ phiên khác đi qua: không phán `pg_temp_N.zz_tam` (mục (A) không ALTER, 82⑴ không kêu).
  // Đột biến đo ở biên bản 57: bỏ MAU_SCHEMA_DU_AN ở vế con cháu ⇒ (A) ALTER bảng tạm phiên khác (0A000, BƯỚC 2 nuốt)
  // rồi phán "pg_temp_N.zz_tam (enable=false…)"; bỏ ở 82⑴ ⇒ "pg_temp_N.zz_tam INHERITS public.bao_gia" chưa khai.
  it("[S1.42 / lượt soi 33b] bảng TẠM kế thừa bảng tenant là của riêng phiên: phiên khác không thấy hàng qua cha, migrate() đi qua không phán bảng tạm", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "CREATE TABLE bao_gia (gia int, org_id uuid NOT NULL);" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY; ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;" +
          "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());" +
          "GRANT SELECT ON bao_gia TO app_api;",
      );
      const giu = await db.pool.connect();
      try {
        await giu.query("CREATE TEMP TABLE zz_tam () INHERITS (public.bao_gia)");
        await giu.query("INSERT INTO zz_tam (gia, org_id) VALUES (777, $1)", [orgB]);
        const ns = (await giu.query<{ n: string }>(
          "SELECT n.nspname AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'zz_tam'",
        )).rows[0]!.n;
        expect(ns).toMatch(/^pg_temp_\d+$/u);
        // (a) của riêng phiên
        expect((await giu.query<{ gia: number }>("SELECT gia FROM public.bao_gia")).rows.map((r) => r.gia), "phiên giữ thấy hàng của nó qua cha").toEqual([777]);
        expect((await db.pool.query<{ gia: number }>("SELECT gia FROM public.bao_gia")).rows, "phiên khác (superuser) không thấy").toEqual([]);
        const api = await db.poolAs("app_api").connect();
        try {
          await api.query("SELECT set_config('app.org_id', $1, false)", [orgB]);
          expect((await api.query<{ gia: number }>("SELECT gia FROM public.bao_gia")).rows, "app_api gắn đúng tổ chức B cũng không thấy").toEqual([]);
        } finally {
          api.release();
        }
        // (b) migrate() từ phiên khác: đi qua, không phán bảng tạm
        await expect(migrate(db.pool, MIGRATIONS_DIR), "bảng tạm không vào tập (A), không vào 82⑴").resolves.toEqual([]);
        const co = await db.pool.query<{ bat: boolean }>(
          "SELECT c.relrowsecurity AS bat FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'zz_tam'",
          [ns],
        );
        expect(co.rows[0], "mục (A) không chạm bảng tạm của phiên khác").toEqual({ bat: false });
      } finally {
        giu.release();
      }
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [S1.43 / khoản nợ 89 + 86] DANH TÍNH ĐỐI TƯỢNG CANH — chú thích neo theo oid + tên đã khai + hình dạng sổ (ADR-037)
  // ==========================================================================================
  // Lượt soi ngang 33 đo hai đường đi qua MỌI lớp vì lớp nào cũng nhận diện đối tượng bằng thứ chủ bảng tái tạo
  // được — tên hay hình dạng. Bản đầu của vòng (bảng app_private.neo_danh_tinh + migration 049) bị hồ sơ N2 của
  // chính tệp này bác (12 test đỏ: vai deploy không USAGE app_private) và lượt soi 34 bác thêm (bảng neo do chủ thể
  // bị canh sở hữu; khôi phục logic cấp oid mới; tự gỡ mở đường chép bảng). Bản này: ba kênh — xem chú thích hardening.
  const KHACH_NULL_027 = "((NULLIF(current_setting('app.guest_session_id', true), ''))::uuid IS NULL)";
  const neoCua = async (pool: TestDatabase["pool"], bang: string): Promise<string | null> =>
    (await pool.query<{ n: string | null }>("SELECT obj_description($1::regclass, 'pg_class') AS n", [bang])).rows[0]!.n;
  /** Chú thích neo ĐÚNG của một bảng, dựng từ catalog bằng cùng công thức MAU_NEO (kèm attnum cột org_id nếu có). */
  const neoMong = async (pool: TestDatabase["pool"], bang: string): Promise<string> =>
    (await pool.query<{ n: string }>(
      "SELECT 'neo: ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || coalesce((SELECT ' org_id#' || a.attnum::text FROM pg_attribute a " +
        "WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped), '') AS n " +
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1::regclass",
      [bang],
    )).rows[0]!.n;

  it("[khoản nợ 89] đổi tên bảng sổ, gỡ trigger, dựng bảng cùng tên cùng hình dạng: migrate() NÉM ở mục danh tính — chú thích theo oid nêu tên cũ và oid bảng lạ, vế hình dạng sổ bắt bản sao — kể cả khi policy sót đã xoá (83⑴ im) và khi chú thích đã bị gỡ; đối chứng: đổi lại ⇒ đi qua", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const neoSo = await neoMong(db.pool, "public.audit_events");
      expect(neoSo).toMatch(/^neo: public\.audit_events org_id#\d+$/u);
      expect(await neoCua(db.pool, "public.audit_events"), "lượt sửa đã ghi neo cho bảng sổ").toBe(neoSo);
      const org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id")).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('x'::bytea))",
        [org],
      );
      await db.pool.query(`
        ALTER TABLE public.audit_events RENAME TO audit_events_cu;
        DROP TRIGGER audit_events_chan_update ON public.audit_events_cu;
        DROP TRIGGER audit_events_chan_delete ON public.audit_events_cu;
        DROP TRIGGER audit_events_chan_truncate ON public.audit_events_cu;
        DROP TRIGGER audit_events_noi_chuoi ON public.audit_events_cu;
        CREATE TABLE public.audit_events (LIKE public.audit_events_cu INCLUDING ALL);
        ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
        CREATE POLICY audit_events_tenant_isolation ON public.audit_events USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
        GRANT SELECT ON public.audit_events TO app_api, app_unseal;
      `);
      expect(await neoCua(db.pool, "public.audit_events_cu"), "chú thích đi theo oid").toBe(neoSo);
      expect(await neoCua(db.pool, "public.audit_events"), "LIKE … INCLUDING ALL không chép chú thích bảng").toBeNull();
      const oidMoi = (await db.pool.query<{ o: string }>("SELECT 'public.audit_events'::regclass::oid::text AS o")).rows[0]!.o;

      // (a) còn policy sót trên bảng cũ: 83⑴ kêu, và mục danh tính cũng kêu — hai lớp độc lập.
      const loiA = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiA).not.toBeNull();
      expect(loiA!.message).toContain(`public.audit_events_cu: mang neo "${neoSo}" nhưng tên hiện tại là public.audit_events_cu`);
      expect(loiA!.message).toContain(`tên đã neo hiện do oid ${oidMoi} giữ — một trong hai là bản sao`);
      expect(loiA!.message).toContain("public.audit_events_cu: mang bộ ba cột chuỗi sổ (seq, prev_hash, hash) nhưng không phải public.audit_events");
      expect(loiA!.message).toContain("(khoản 83⑴)");
      // (b) xoá policy sót — đường đo của lượt soi 33a #5: TRƯỚC S1.43 migrate() đi qua; nay còn mục danh tính.
      await db.pool.query("DROP POLICY audit_events_khach ON public.audit_events_cu");
      const loiB = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiB, "xoá policy sót: 83⑴ im, mục danh tính phải là lớp còn lại").not.toBeNull();
      expect(loiB!.message).not.toContain("(khoản 83⑴)");
      expect(loiB!.message).toContain(`public.audit_events_cu: mang neo "${neoSo}" nhưng tên hiện tại là public.audit_events_cu`);
      // Lượt sửa vẫn chạy trọn; lịch sử ở bảng cũ. ~~bảng MỚI được ghi neo và D2 dựng trigger lên nó~~ [S1.45 / khoản nợ 90]
      // LỚP SỬA ĐỨNG YÊN TRÊN BẢN SAO ở cả hai mục: bảng gốc còn giữ danh tính `neo: public.audit_events` (chú thích theo oid)
      // nên (i) lượt ghi neo KHÔNG trao neo cho bản sao (lượt soi 37 NHẸ-4 — nếu trao, sau khi bảng gốc mất neo bản sao đã sẵn
      // neo hợp lệ và mọi vế im), bản sao ở lại ⑶; (ii) bản sao không thuộc `bang_so` nên D2 không dựng trigger. Lớp PHÁN XÉT
      // chặn; thông điệp "KHÔNG TỒN TẠI như một BẢNG THẬT" nêu đúng nguyên nhân thứ tư (lượt soi 37 NHẸ-2).
      // Đột biến (bỏ hai vế danh tính khỏi `bang_so`) ⇒ bản sao nhận đủ bốn trigger — đúng hành vi trước S1.45.
      expect(await neoCua(db.pool, "public.audit_events"), "[khoản 90] lượt ghi neo không trao neo cho bản chiếm tên").toBeNull();
      expect(loiB!.message).toContain("audit_events: bảng sổ chỉ-ghi-thêm KHÔNG TỒN TẠI như một BẢNG THẬT");
      expect(loiB!.message).toContain("[khoản 90] quan hệ đang mang tên ấy KHÔNG giữ danh tính nhất quán theo kênh ①");
      expect((await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM public.audit_events_cu")).rows[0]!.n).toBe("1");
      const demTrigger = async (bang: string): Promise<number> =>
        (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal", [bang])).rows[0]!.n;
      expect(await demTrigger("public.audit_events"), "[khoản 90] D2 không dựng trigger lên bản sao khi bảng gốc còn giữ danh tính").toBe(0);
      // (dòng dưới là tài liệu, không phải chứng cứ của vòng: bảng gốc đã ngoài danh sách tên từ trước và fixture tự gỡ trigger)
      expect(await demTrigger("public.audit_events_cu"), "bảng gốc không còn tên đã khai, không trigger canh: ngoài bang_so lẫn bang_al").toBe(0);
      // (c) ranh giới nói thẳng: chủ bảng gỡ chú thích của bảng cũ ⇒ vế ⑴ im, nhưng vế ⑷ (hình dạng sổ) vẫn bắt.
      await db.pool.query("COMMENT ON TABLE public.audit_events_cu IS NULL");
      const loiC = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiC, "gỡ chú thích: vế hình dạng sổ phải còn").not.toBeNull();
      expect(loiC!.message).not.toContain("nhưng tên hiện tại là public.audit_events_cu");
      expect(loiC!.message).toContain("public.audit_events_cu: mang bộ ba cột chuỗi sổ (seq, prev_hash, hash)");
      // Ranh giới nói ra: lượt sửa ghi-lấp neo cho bảng cũ DƯỚI TÊN HIỆN TẠI (nó là bảng tenant theo tính chất) — kênh ①
      // mạnh bằng quyền sở hữu; thứ còn giữ ca này là kênh ③ (hình dạng) ở trên và kênh ② (tên đã khai) cho bảng tenant.
      expect(await neoCua(db.pool, "public.audit_events_cu")).toBe(await neoMong(db.pool, "public.audit_events_cu"));
      // [S1.45 / khoản nợ 90] Cùng ranh giới ấy ở lớp SỬA: bảng gốc thôi giữ danh tính `public.audit_events` (neo ghi-lấp dưới
      // tên mới) ⇒ không ai giữ tên nữa ⇒ lượt ghi neo trao neo cho bản sao và nó LÀ `bang_so` theo hai vế ⇒ D2 dựng đủ bốn
      // trigger lên nó. Kênh ① mạnh bằng quyền sở hữu ở cả hai lớp; deploy vẫn bị kênh ③ chặn ở trên.
      expect(await neoCua(db.pool, "public.audit_events")).toBe(await neoMong(db.pool, "public.audit_events"));
      expect(await demTrigger("public.audit_events"), "[khoản 90] ranh giới: danh tính rơi ⇒ D2 chữa bản sao").toBe(4);
      // (c2) [lượt soi 35, CAO-1] đổi tên một cột PHỤ của bản sao: "đủ 15 cột" thoát, bộ ba chuỗi thì không.
      await db.pool.query("ALTER TABLE public.audit_events_cu RENAME COLUMN user_agent TO ua");
      const loiC2 = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiC2, "hình dạng không bỏ được: bộ ba chuỗi vẫn bắt bản sao").not.toBeNull();
      expect(loiC2!.message).toContain("public.audit_events_cu: mang bộ ba cột chuỗi sổ (seq, prev_hash, hash)");
      await db.pool.query("ALTER TABLE public.audit_events_cu RENAME COLUMN ua TO user_agent");
      // (d) đối chứng: bỏ bảng lạ, đổi lại tên, dựng lại policy khuôn 027 (b1), và — đúng như thông điệp bảo khi đổi có
      //     chủ ý — đặt lại chú thích neo ⇒ D2 dựng lại trigger, đi qua.
      await db.pool.query(`
        DROP TABLE public.audit_events;
        ALTER TABLE public.audit_events_cu RENAME TO audit_events;
        COMMENT ON TABLE public.audit_events IS NULL;
        CREATE POLICY audit_events_khach ON public.audit_events AS RESTRICTIVE USING ${KHACH_NULL_027} WITH CHECK ${KHACH_NULL_027};
      `);
      await expect(migrate(db.pool, MIGRATIONS_DIR), "đối chứng: danh tính về đúng chỗ ⇒ đi qua").resolves.toEqual([]);
      expect(await neoCua(db.pool, "public.audit_events")).toBe(neoSo);
      expect((await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_trigger WHERE tgrelid = 'public.audit_events'::regclass AND NOT tgisinternal")).rows[0]!.n).toBe("4");
      // (e) [S1.45 / khoản nợ 90 — vế ⒜ đo riêng, lượt soi 37 CAO-1] Chú thích KHÁC trên chính bảng sổ thật (kênh dành riêng
      //     bị chiếm) + một trigger canh bị gỡ: danh tính không nhất quán ⇒ D2 KHÔNG tự chữa (3 trigger còn nguyên), deploy bị
      //     chặn ở ⑶ ("chưa mang neo"/chú thích chiếm chỗ) và ở vế "KHÔNG TỒN TẠI" của D2. Đột biến bỏ riêng ⒜ ⇒ D2 dựng lại
      //     trigger (4) dưới một chú thích lạ. Đối chứng: đặt lại neo ⇒ D2 chữa, đi qua. Trái lại, SET SCHEMA giữ neo
      //     `public.` thì vẫn được chữa — test [vòng fix 1 — CR2a] (8 trigger ở schema mới) giữ đánh đổi ấy.
      await db.pool.query("COMMENT ON TABLE public.audit_events IS 'ghi chú lạ'; DROP TRIGGER audit_events_chan_delete ON public.audit_events");
      const loiE = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiE, "chú thích lạ trên sổ thật: phải NÉM").not.toBeNull();
      expect(loiE!.message).toContain("[khoản 90] quan hệ đang mang tên ấy KHÔNG giữ danh tính nhất quán theo kênh ①");
      expect(await demTrigger("public.audit_events"), "[khoản 90 ⒜] D2 không chữa dưới chú thích lạ").toBe(3);
      await db.pool.query(`COMMENT ON TABLE public.audit_events IS '${neoSo}'`);
      await expect(migrate(db.pool, MIGRATIONS_DIR), "đặt lại neo ⇒ D2 chữa, đi qua").resolves.toEqual([]);
      expect(await demTrigger("public.audit_events")).toBe(4);

      // (f) [S1.48 / lượt soi ngang 40a I5] DECOY cùng tên ở schema khác chép NGUYÊN chú thích neo của sổ thật: đi qua ⒜
      //     (dạng `public.<sổ>`) và ⒝ (không ai mang `neo: zz_kho.audit_events`) trong khi ⒝ loại sổ THẬT ⇒ bản S1.45 D2 chữa
      //     decoy, đứng yên trên sổ thật. Nay ⒝′ (không quan hệ khác mang ĐÚNG chuỗi neo của mình): cả hai đứng yên — decoy
      //     0 trigger, sổ thật giữ nguyên số trigger đang thiếu (3), ⑴ chặn nêu decoy.
      const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
      await db.pool.query("CREATE SCHEMA zz_kho; CREATE TABLE zz_kho.audit_events (LIKE public.audit_events INCLUDING ALL)");
      const neoThat = (await db.pool.query<{ n: string }>("SELECT obj_description('public.audit_events'::regclass, 'pg_class') AS n")).rows[0]!.n;
      expect(neoThat).toMatch(/^neo: public\.audit_events/u);
      await db.pool.query(`COMMENT ON TABLE zz_kho.audit_events IS '${neoThat.replaceAll("'", "''")}'`);
      await db.pool.query("DROP TRIGGER audit_events_chan_delete ON public.audit_events");
      const loiDecoy = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loiDecoy, "decoy cùng neo phải bị ⑴ chặn").not.toBeNull();
      expect(loiDecoy!.message).toContain("zz_kho.audit_events: mang neo");
      expect(await demTrigger("zz_kho.audit_events"), "D2 không được chữa decoy (bản S1.45: 4)").toBe(0);
      expect(await demTrigger("public.audit_events"), "sổ thật cũng đứng yên (⒝ loại vì decoy mang neo nêu tên nó)").toBe(3);
      await db.pool.query("DROP SCHEMA zz_kho CASCADE");
      expect(await loiCua(migrate(db.pool, MIGRATIONS_DIR)), "gỡ decoy ⇒ đi qua, D2 chữa sổ thật").toBeNull();
      expect(await demTrigger("public.audit_events")).toBe(4);
    } finally {
      await db.stop();
    }
  }, 180_000);

  it("[khoản nợ 86 — nửa đo được] users: đổi tên cột org_id/tắt RLS/xoá policy ⇒ NÉM (chú thích ⑵ và tên đã khai ⑹); đổi tên bảng ⇒ NÉM (⑴ và ⑸); CHÉP bảng bỏ cột org_id rồi đè lên tên cũ (dữ liệu không mất — lượt soi 34 NẶNG-3) ⇒ NÉM (⑹); đối chứng đổi lại ⇒ đi qua", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const neoUsers = await neoMong(db.pool, "public.users");
      expect(await neoCua(db.pool, "public.users"), "bảng tenant được ghi neo ở lượt sửa").toBe(neoUsers);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query("INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')", [orgA, orgB]);
      await db.pool.query("INSERT INTO users (org_id, email, full_name) VALUES ($1,'a@a','A'), ($2,'b1@b','B1')", [orgA, orgB]);
      const docApi = async (): Promise<string[]> => {
        const api = await db.poolAs("app_api").connect();
        try {
          await api.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          return (await api.query<{ email: string }>("SELECT email FROM users ORDER BY 1")).rows.map((r) => r.email);
        } finally {
          api.release();
        }
      };

      // (a) đường đo của lượt soi 33a #6 — TRƯỚC S1.43 migrate() đi qua và app_api gắn A đọc thấy B.
      await db.pool.query(
        "ALTER TABLE public.users RENAME COLUMN org_id TO to_chuc; ALTER TABLE public.users DISABLE ROW LEVEL SECURITY; " +
          "DROP POLICY users_tenant_isolation ON public.users; DROP POLICY users_khach ON public.users",
      );
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "bảng tenant mang neo rời tập theo hình dạng phải bị bắt").not.toBeNull();
      expect(loi!.message).toContain("public.users: mang neo nhưng KHÔNG CÒN là bảng tenant theo tính chất");
      expect(loi!.message).toContain("public.users: bảng tenant đã khai (migration 002_organizations_and_users) KHÔNG CÒN là bảng tenant theo tính chất");
      // Nói ra: mục PHÁN XÉT — lỗ vẫn mở tới khi có migration sửa; deploy bị chặn là lớp.
      expect(await docApi()).toEqual(["a@a", "b1@b"]);
      // (b) đối chứng: đổi lại tên cột, dựng lại hai policy ⇒ (A) bật lại RLS, đi qua.
      await db.pool.query(`
        ALTER TABLE public.users RENAME COLUMN to_chuc TO org_id;
        CREATE POLICY users_tenant_isolation ON public.users USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
        CREATE POLICY users_khach ON public.users AS RESTRICTIVE USING ${KHACH_NULL_027} WITH CHECK ${KHACH_NULL_027};
      `);
      await expect(migrate(db.pool, MIGRATIONS_DIR), "đối chứng: đổi lại ⇒ đi qua").resolves.toEqual([]);
      expect(await docApi()).toEqual(["a@a"]);

      // (c) đổi TÊN bảng tenant đã khai (giữ oid): trước S1.43 users_cu là bảng tenant hợp lệ với mọi lớp — nay NÉM hai vế.
      await db.pool.query("ALTER TABLE public.users RENAME TO users_cu");
      const loiTen = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiTen!.message).toContain(`public.users_cu: mang neo "${neoUsers}" nhưng tên hiện tại là public.users_cu`);
      expect(loiTen!.message).toContain("public.users: bảng tenant đã khai (migration 002_organizations_and_users) KHÔNG CÒN dưới tên ấy");
      await db.pool.query("ALTER TABLE public.users_cu RENAME TO users");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // (e) [lượt soi 35, NẶNG-5] đổi tên cột org_id rồi ADD cột org_id MỚI mang cùng một giá trị, dựng lại policy đúng
      //     khuôn trên cột mới: tên ✓, tenant theo tính chất ✓, [CR1] ✓ — trước bản bốn đi qua, app_api gắn A thấy mọi hàng.
      //     Kênh ① nay neo cả attnum của cột org_id ⇒ ⑵′.
      await db.pool.query(`
        ALTER TABLE public.users RENAME COLUMN org_id TO to_chuc;
        ALTER TABLE public.users ADD COLUMN org_id uuid NOT NULL DEFAULT '${orgA}';
        DROP POLICY users_tenant_isolation ON public.users; DROP POLICY users_khach ON public.users;
        CREATE POLICY users_tenant_isolation ON public.users USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
        CREATE POLICY users_khach ON public.users AS RESTRICTIVE USING ${KHACH_NULL_027} WITH CHECK ${KHACH_NULL_027};
      `);
      const loiCot = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiCot, "cột org_id bị thay bằng cột mới phải bị bắt").not.toBeNull();
      expect(loiCot!.message).toMatch(/public\.users: cột org_id đã neo là attnum \d+ nhưng cột org_id hiện tại là attnum \d+/u);
      expect(await docApi(), "lỗ RÒ có thật cho tới khi deploy sửa").toEqual(["a@a", "b1@b"]);
      await db.pool.query(`
        DROP POLICY users_tenant_isolation ON public.users; DROP POLICY users_khach ON public.users;
        ALTER TABLE public.users DROP COLUMN org_id; ALTER TABLE public.users RENAME COLUMN to_chuc TO org_id;
        CREATE POLICY users_tenant_isolation ON public.users USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
        CREATE POLICY users_khach ON public.users AS RESTRICTIVE USING ${KHACH_NULL_027} WITH CHECK ${KHACH_NULL_027};
      `);
      await expect(migrate(db.pool, MIGRATIONS_DIR), "đối chứng: cột dữ liệu về đúng attnum ⇒ đi qua").resolves.toEqual([]);

      // (d) CHÉP bảng bỏ cột org_id rồi đè lên tên cũ — dữ liệu KHÔNG mất, chú thích không đi theo (bảng mới), bảng mới
      //     không org_id nên không vị từ nào nhận. Chỉ tên đã khai (⑹) còn nhìn thấy nó.
      await db.pool.query(
        "CREATE TABLE public.users_moi AS SELECT id, org_id AS to_chuc, email, full_name, status, created_at FROM public.users; " +
          "DROP TABLE public.users CASCADE; ALTER TABLE public.users_moi RENAME TO users; GRANT SELECT ON public.users TO app_api",
      );
      expect(await neoCua(db.pool, "public.users")).toBeNull();
      const loiChep = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiChep, "bảng chép đè lên tên đã khai phải bị bắt").not.toBeNull();
      expect(loiChep!.message).toContain("public.users: bảng tenant đã khai (migration 002_organizations_and_users) KHÔNG CÒN là bảng tenant theo tính chất");
      expect(await docApi(), "lỗ RÒ có thật cho tới khi deploy sửa — phán xét, không tự chữa").toEqual(["a@a", "b1@b"]);
    } finally {
      await db.stop();
    }
  }, 240_000);

  it("[khoản nợ 89 — ranh giới] bảng tenant KHÔNG khai (fixture): được ghi neo, DROP rồi dựng lại cùng tên đi qua (cố ý); chú thích khác chiếm chỗ trên bảng đã khai ⇒ NÉM; bản sao sổ ở schema khác ⇒ NÉM theo hình dạng; tập rút gọn 001/002 chỉ phán tên của migration đã áp và đi qua", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-neo-"));
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const dungBaoGia = "CREATE TABLE bao_gia (gia int, org_id uuid NOT NULL); ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY; ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY; " +
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())";
      await db.pool.query(dungBaoGia);
      expect(await neoCua(db.pool, "public.bao_gia")).toBeNull();
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await neoCua(db.pool, "public.bao_gia"), "bảng tenant theo tính chất được ghi neo dù không khai").toBe(await neoMong(db.pool, "public.bao_gia"));
      const oid1 = (await db.pool.query<{ o: string }>("SELECT 'public.bao_gia'::regclass::oid::text AS o")).rows[0]!.o;
      await db.pool.query("DROP TABLE bao_gia");
      await db.pool.query(dungBaoGia);
      await expect(migrate(db.pool, MIGRATIONS_DIR), "tên KHÔNG khai: DROP + dựng lại cùng tên đi qua (ranh giới nói ra — bảng khai thì ⑸/⑹)").resolves.toEqual([]);
      expect((await db.pool.query<{ o: string }>("SELECT 'public.bao_gia'::regclass::oid::text AS o")).rows[0]!.o).not.toBe(oid1);
      expect(await neoCua(db.pool, "public.bao_gia")).toBe(await neoMong(db.pool, "public.bao_gia"));
      // Chú thích khác chiếm chỗ trên bảng ĐÃ KHAI: lượt sửa không ghi đè, vế ⑶ nêu ra.
      await db.pool.query("COMMENT ON TABLE public.users IS 'người dùng'");
      const loiChu = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiChu!.message).toContain('public.users: bảng tenant đã khai (migration 002_organizations_and_users) CHƯA MANG NEO (chú thích hiện tại: "người dùng" — chú thích bảng là kênh neo');
      await db.pool.query("COMMENT ON TABLE public.users IS NULL");
      await expect(migrate(db.pool, MIGRATIONS_DIR), "gỡ chú thích lạ ⇒ lượt sửa neo lại ⇒ đi qua").resolves.toEqual([]);
      // Bản sao sổ ở schema khác (đủ 15 cột) — vế ⑷ không tựa vào chú thích lẫn tên.
      await db.pool.query("CREATE SCHEMA kho; CREATE TABLE kho.so_chep (LIKE public.audit_events INCLUDING ALL)");
      const loiChep = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiChep!.message).toContain("kho.so_chep: mang bộ ba cột chuỗi sổ (seq, prev_hash, hash) nhưng không phải public.audit_events");
      await db.pool.query("DROP TABLE kho.so_chep");
      // [lượt soi 35, NẶNG-4] bản sao bảng mốc neo cũng có vế hình dạng riêng.
      await db.pool.query("CREATE TABLE kho.moc_chep (LIKE public.audit_chain_anchors INCLUDING ALL)");
      const loiMoc = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiMoc!.message).toContain("kho.moc_chep: mang bộ ba cột mốc neo (seq, hash, anchored_at) nhưng không phải public.audit_chain_anchors");
      await db.pool.query("DROP TABLE kho.moc_chep");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      // Tập rút gọn (001/002): chỉ users/organizations có migration đã áp — hai bảng ấy được neo, các tên khác im — đi qua.
      const db2 = await startPostgres();
      try {
        for (const f of ["hardening.always.sql", "001_roles_and_functions.sql", "002_organizations_and_users.sql"]) {
          await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
        }
        await migrate(db2.pool, thuMucTam);
        await expect(migrate(db2.pool, thuMucTam)).resolves.toEqual([]);
        expect(await neoCua(db2.pool, "public.users")).toBe(await neoMong(db2.pool, "public.users"));
        expect(await neoCua(db2.pool, "public.organizations"), "gốc tenant (đích khoá ngoại org_id) cũng mang neo, không attnum").toBe("neo: public.organizations");
      } finally {
        await db2.stop();
      }
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 240_000);

  // [lượt soi 35, CAO-2] Đường NÂNG CẤP là một hồ sơ cần test riêng: cụm đã bootstrap TRƯỚC S1.43 (bảng thuộc superuser),
  // deploy bằng vai không sở hữu ⇒ lượt sửa không ghi được neo ⇒ ⑶ chặn deploy đầu tiên, nêu đúng lối ra. Ba test N2 cũ xanh
  // vì bootstrap của chúng đã chạy hardening S1.43 bằng superuser; test này gỡ neo để mô phỏng cụm cũ.
  it("[fix round 4 — N2] nhánh 4 · S1.43: cụm bootstrap trước S1.43 + vai deploy không sở hữu bảng ⇒ migrate() GÃY ở đúng vế ⑶ (chưa mang neo, nêu lối ra); chủ bảng chạy một lần ⇒ vai deploy đi qua", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      // Mô phỏng cụm cũ: gỡ mọi chú thích neo do bootstrap vừa ghi.
      const { rows: bang } = await db.pool.query<{ t: string }>(
        "SELECT (quote_ident(n.nspname) || '.' || quote_ident(c.relname)) AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
          "WHERE obj_description(c.oid, 'pg_class') LIKE 'neo: %'",
      );
      expect(bang.length, "bootstrap đã ghi neo cho mọi bảng tenant/sổ").toBeGreaterThanOrEqual(29);
      for (const b of bang) await db.pool.query(`COMMENT ON TABLE ${b.t} IS NULL`);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        const loi = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
        expect(loi, "vai deploy không sở hữu bảng: không ghi được neo ⇒ phải GÃY nói ra, không im").not.toBeNull();
        expect(loi!.message).toContain("Hardening không sửa được 1 mục");
        expect(loi!.message).toContain("public.users: bảng tenant đã khai (migration 002_organizations_and_users) CHƯA MANG NEO — chú thích neo bị gỡ, oid mới (bảng dựng lại/chép đè), hay lượt sửa không sở hữu bảng (cụm bootstrap trước S1.43: chạy migrate() một lần bằng chủ bảng/superuser để ghi neo)");
        // Lối ra đúng như thông điệp: chủ bảng (superuser) chạy một lần ⇒ neo được ghi ⇒ vai deploy đi qua.
        await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR), "sau khi chủ bảng ghi neo, vai deploy đi qua").resolves.toEqual([]);
      } finally {
        await poolTrienKhai.end();
      }
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 2 — I3] MỤC (C) KHÔNG ĐƯỢC TỰ GIỚI HẠN VÀO 'public'
  // ==========================================================================================
  // Vòng 1 sinh ra mục (C) kèm sẵn bộ lọc tự làm mù mình. Test đo cả HAI nửa cho mỗi đường:
  // lỗ hổng HÀNH VI có thật (app_api gắn tổ chức A đọc được dữ liệu của B qua đối tượng ở
  // schema khác), và migrate() nay CHẶN nó.
  it("[I3] VIEW/hàm SECURITY DEFINER ở schema KHÁC public cũng bị bắt", async () => {
    const kichBan: [string, string, string][] = [
      // [nhãn, câu lệnh dựng, câu đọc vòng]
      [
        "VIEW ở schema khác",
        "CREATE SCHEMA bao_cao; CREATE VIEW bao_cao.moi_nguoi AS SELECT * FROM public.users; " +
          "GRANT USAGE ON SCHEMA bao_cao TO app_api; GRANT SELECT ON bao_cao.moi_nguoi TO app_api",
        "SELECT email FROM bao_cao.moi_nguoi ORDER BY 1",
      ],
      [
        "hàm SECURITY DEFINER ở schema khác",
        "CREATE SCHEMA tien_ich; CREATE FUNCTION tien_ich.doc_het() RETURNS SETOF public.users " +
          "LANGUAGE sql SECURITY DEFINER AS 'SELECT * FROM public.users'; " +
          "GRANT USAGE ON SCHEMA tien_ich TO app_api; " +
          "GRANT EXECUTE ON FUNCTION tien_ich.doc_het() TO app_api",
        "SELECT email FROM tien_ich.doc_het() ORDER BY 1",
      ],
    ];

    for (const [nhan, dung, doc] of kichBan) {
      const db = await startPostgres();
      try {
        await migrate(db.pool, MIGRATIONS_DIR);
        const orgA = "00000000-0000-4000-8000-00000000000a";
        const orgB = "00000000-0000-4000-8000-00000000000b";
        await db.pool.query(
          "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
          [orgA, orgB],
        );
        await db.pool.query(
          "INSERT INTO users (org_id, email, full_name) VALUES ($1,'a@a.com','A'), ($2,'vip@b.com','B')",
          [orgA, orgB],
        );
        await db.pool.query(dung);

        // (a) Lỗ hổng HÀNH VI có thật: tổ chức A đọc được cả hai tổ chức.
        const apiPool = db.poolAs("app_api");
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ email: string }>(doc);
          expect(
            rows.map((r) => r.email),
            `"${nhan}": nếu phép đo này chỉ thấy a@a.com thì đường đọc vòng không tồn tại và ` +
              "cả nửa (b) là thừa. Đo lại trước khi kết luận.",
          ).toEqual(["a@a.com", "vip@b.com"]);
        } finally {
          client.release();
        }

        // (b) migrate() CHẶN.
        const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, `"${nhan}" đi lọt qua migrate()`).not.toBeNull();
        expect(loi!.message).toContain("đọc vòng qua RLS");
      } finally {
        await db.stop();
      }
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 2 — I4 / vòng fix 3 — I4] POLICY "AS RESTRICTIVE" LÀ PHÒNG THỦ CHẶT HƠN
  // ==========================================================================================
  // Vòng 1 chặn nó — cấm một lớp phòng thủ chặt hơn là phản tác dụng rõ ràng. Vòng 2 TUYÊN BỐ
  // đã gỡ nhưng chỉ gỡ được cho một trong ba nhánh, và fixture của nó chỉ dựng đúng ca đi qua
  // nên không ai thấy. Test nay đo CẢ BẢY hình dạng RESTRICTIVE mà PostgreSQL cho phép viết,
  // VÀ đường lách hiển nhiên (đổi chính policy cách ly sang RESTRICTIVE để né phép soi hình
  // dạng) vẫn bị chặn bởi "phải có ít nhất một policy PERMISSIVE".
  it("[I4] BẢY hình dạng policy AS RESTRICTIVE đều đi qua, nhưng không né được phép soi hình dạng", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // (a) Phòng thủ chiều sâu. [vòng fix 3 — I4] Vòng 2 chỉ dựng ĐÚNG MỘT ca — ca CÓ cả hai
      // vế tường minh — nên nó không thấy rằng hai nhánh "thiếu vế" của CAU_POLICY_SAI không
      // có `p.polpermissive`. Đã đo TRƯỚC bản vá vòng 3, bốn khuôn dưới đây BỊ CHẶN:
      //   FOR ALL USING(...)  ·  FOR UPDATE USING(...)      -> "thiếu vế WITH CHECK"
      //   FOR ALL WITH CHECK  ·  FOR UPDATE WITH CHECK      -> "thiếu vế USING"
      // Hai trong số đó (FOR ALL USING, FOR UPDATE USING) là khuôn SQL thường gặp NHẤT.
      const hinhDang: [string, string][] = [
        ["r_all_uc", "FOR ALL USING (status <> 'DISABLED') WITH CHECK (status <> 'DISABLED')"],
        ["r_all_u", "FOR ALL USING (status <> 'DISABLED')"],
        ["r_all_c", "FOR ALL WITH CHECK (status <> 'DISABLED')"],
        ["r_upd_u", "FOR UPDATE USING (status <> 'DISABLED')"],
        ["r_upd_c", "FOR UPDATE WITH CHECK (status <> 'DISABLED')"],
        ["r_ins_c", "FOR INSERT WITH CHECK (status <> 'DISABLED')"],
        ["r_sel_u", "FOR SELECT USING (status <> 'DISABLED')"],
      ];
      for (const [ten, than] of hinhDang) {
        await db.pool.query(`CREATE POLICY ${ten} ON users AS RESTRICTIVE ${than}`);
      }
      // Chốt fixture: bảy policy RESTRICTIVE THẬT SỰ tồn tại, nếu không cả (a) rỗng ruột.
      // [khoản nợ 29] Phép đếm hẹp lại còn ĐÚNG policy của fixture (`r_...`). Trước `027`, `users`
      // không có policy RESTRICTIVE nào ngoài fixture nên một phép đếm trần là đủ; nay nó có
      // `users_khach`, và một phép đếm trần sẽ trôi theo mọi policy khách thêm về sau. Khẳng định
      // vẫn ĐỎ khi một policy fixture không dựng được — đó là toàn bộ việc của nó.
      expect(
        (
          await db.pool.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM pg_policy " +
              " WHERE polrelid = 'users'::regclass AND NOT polpermissive " +
              "   AND polname LIKE 'r|_%' ESCAPE '|'",
          )
        ).rows[0]!.n,
      ).toBe("7");
      // ~~migrate() phải đi qua — "hàng rào đang cấm một lớp phòng thủ CHẶT HƠN"~~ [S1.38 / khoản nợ 83⑴]
      // Ý gốc GIỮ NGUYÊN: [CR1] không được chặn RESTRICTIVE vì hình dạng — thông điệp không có nhánh
      // "thiếu vế". Nhưng ADR-036 hàng 5 (S1.32) đã quyết: một RESTRICTIVE CHƯA KHAI có thể là
      // `USING (false)` — câu ghi của app_api ra 0 hàng không lỗi — nên mục "policy thuộc đúng một lớp"
      // chặn deploy cho tới khi bảy policy này được khai đủ sáu cột (hoặc theo khuôn 027). Đo: trước
      // S1.38 migrate() đi qua với cả bảy.
      const loiA = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiA, "RESTRICTIVE chưa khai phải bị mục khoản 83⑴ chặn").not.toBeNull();
      expect(loiA!.message, "[CR1] không phải mục chặn").not.toContain("thiếu vế");
      for (const [ten] of hinhDang) {
        expect(loiA!.message).toContain(`public.users.${ten}: policy RESTRICTIVE không thuộc lớp nào (khoản 83⑴)`);
      }

      // (b) Đường lách: biến chính policy cách ly thành RESTRICTIVE để biểu thức khỏi bị soi.
      for (const [ten] of hinhDang) {
        await db.pool.query(`DROP POLICY ${ten} ON users`);
      }
      await db.pool.query("DROP POLICY users_tenant_isolation ON users");
      await db.pool.query(
        "CREATE POLICY users_tenant_isolation ON users AS RESTRICTIVE " +
          "USING (true) WITH CHECK (true)",
      );
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "bảng không còn policy PERMISSIVE nào mà vẫn đi lọt").not.toBeNull();
      expect(loi!.message).toContain("không có policy PERMISSIVE nào");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 2 — I6] "ĐÚNG TẠI MỘT THỜI ĐIỂM": ATTACH PARTITION SAU migrate()
  // ==========================================================================================
  // Mục (A) của hardening đúng TẠI THỜI ĐIỂM migrate() chạy. Một job VẬN HÀNH xoay vòng phân
  // mảnh gắn thêm lá SAU đó, và lá mới không có RLS. Test này KHÔNG khẳng định lỗ đã đóng —
  // nó ĐO cửa sổ phơi và khẳng định đúng tính chất giảm nhẹ mà dự án thật sự có: lần deploy KẾ
  // TIẾP tự chữa. Đóng ở tầng lược đồ đã cân nhắc và LOẠI BỎ (event trigger đòi SUPERUSER, mà
  // role deploy thật của dự án không có — thêm hậu điều kiện cho nó là chặn deploy vĩnh viễn
  // trên production). Xem ghi chú (A) ở đầu hardening.always.sql.
  it("[I6] ATTACH PARTITION sau migrate() để hở tới lần deploy kế — và lần đó tự chữa", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );
      await db.pool.query(
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL, gia int) PARTITION BY LIST (org_id)",
      );
      await db.pool.query(`CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('${orgA}')`);
      await db.pool.query("ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("GRANT SELECT ON bao_gia TO app_api");
      await db.pool.query(`INSERT INTO bao_gia VALUES (1,'${orgA}',100)`);
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // Job vận hành xoay vòng phân mảnh: tạo lá RỜI rồi ATTACH — SAU khi migrate() đã xong.
      // [S1.38 / khoản nợ 83⑵] GRANT lên lá vừa gắn chỉ để ĐO cửa sổ phơi (đọc thẳng lá thấy 999); sau khi
      // mục (A) bật RLS cho lá, chính GRANT ấy là ca "quyền không policy nào phủ" và bị phán xét — thu hồi
      // ⇒ đi qua.
      await db.pool.query("CREATE TABLE bao_gia_b (id int, org_id uuid NOT NULL, gia int)");
      await db.pool.query(`INSERT INTO bao_gia_b VALUES (2,'${orgB}',999)`);
      await db.pool.query(
        `ALTER TABLE bao_gia ATTACH PARTITION bao_gia_b FOR VALUES IN ('${orgB}')`,
      );
      await db.pool.query("GRANT SELECT ON bao_gia_b TO app_api");

      const apiPool = db.poolAs("app_api");
      const doc = async (bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY 1`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };

      // (a) CỬA SỔ PHƠI, đo chứ không giấu: lá vừa gắn chưa có RLS.
      const truoc = await db.pool.query<{ bat: boolean }>(
        "SELECT relrowsecurity AS bat FROM pg_class WHERE relname = 'bao_gia_b'",
      );
      expect(truoc.rows[0]!.bat).toBe(false);
      expect(await doc("bao_gia"), "đường đọc qua CHA vẫn đúng").toEqual([100]);
      expect(
        await doc("bao_gia_b"),
        "nếu phép đo này rỗng thì ATTACH đã tự kế thừa RLS — cửa sổ phơi không tồn tại và cả " +
          "ghi chú (A) về trục thời gian phải viết lại. Đo lại trước khi kết luận.",
      ).toEqual([999]);

      // (b) TÍNH CHẤT GIẢM NHẸ THẬT SỰ CÓ: lần deploy kế tiếp tự chữa (BƯỚC 2 bật RLS cho lá) — và [S1.38]
      //     PHÁN XÉT quyền đọc thẳng lá không policy nào phủ (khoản 83⑵), vì sau khi bật RLS nó là 0 hàng im lặng.
      const loiLa = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiLa, "GRANT trực tiếp lên lá vừa gắn phải bị khoản 83⑵ bắt").not.toBeNull();
      expect(loiLa!.message).toContain("public.bao_gia_b/app_api/SELECT: quyền đã cấp mà không policy PERMISSIVE nào phủ");
      const sau = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'bao_gia_b'",
      );
      expect(sau.rows[0]).toEqual({ bat: true, cuong_che: true });
      expect(await doc("bao_gia_b"), "đọc thẳng lá của tổ chức khác phải trả 0 hàng").toEqual([]);
      expect(await doc("bao_gia"), "đường đọc thật (qua CHA) không được hỏng").toEqual([100]);
      await db.pool.query("REVOKE SELECT ON bao_gia_b FROM app_api");
      await expect(migrate(db.pool, MIGRATIONS_DIR), "lá không quyền riêng: đi qua").resolves.toEqual([]);
      await expect(doc("bao_gia_b"), "không quyền ⇒ ồn ào").rejects.toThrow(/permission denied/u);
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 2 — Minor] HAI QUAN HỆ CHA-CON CÒN LẠI: INHERITS và DETACH PARTITION
  // ==========================================================================================
  // Vòng 1 miễn trừ "phải có policy riêng" theo đúng một tiêu chí: c.relispartition. Hai hệ quả
  // đo được, ngược chiều nhau, và test này khoá cả hai:
  //   (a) CON CHÁU "INHERITS" cổ điển KHÔNG có relispartition -> vòng 1 chặn deploy MỌI LẦN
  //       trên một lược đồ PostgreSQL coi là hợp lệ. Đã đo rằng miễn trừ là AN TOÀN: policy của
  //       CHA có hiệu lực với hàng của con khi đọc QUA CHA, và đọc THẲNG con sau khi mục (A)
  //       bật RLS + FORCE cho 0 hàng.
  //   (b) DETACH PARTITION lấy relispartition đi -> bảng tách ra KHÔNG còn được miễn, và đó là
  //       ĐÚNG: nó đã là một bảng tenant độc lập. Nhưng phải chứng minh nó không thành ngõ cụt
  //       "sửa tay trên cụm" — đường ra là một migration MỚI, đúng như khuôn ba lượt hứa.
  it("[Minor] con cháu INHERITS được miễn policy riêng; DETACH PARTITION thì không, và vá được bằng migration mới — [S1.40] cặp INHERITS chưa khai bị mục 82⑴ NÉM, miễn policy riêng còn nguyên", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-ke-thua-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);
      const orgA = "00000000-0000-4000-8000-00000000000a";
      const orgB = "00000000-0000-4000-8000-00000000000b";
      await db.pool.query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')",
        [orgA, orgB],
      );

      // ---- (a) INHERITS ------------------------------------------------------------------
      await db.pool.query("CREATE TABLE cha_tt (id int, org_id uuid NOT NULL, gia int)");
      await db.pool.query("ALTER TABLE cha_tt ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE cha_tt FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY cha_tt_tenant_isolation ON cha_tt " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("CREATE TABLE con_tt () INHERITS (cha_tt)");
      await db.pool.query("GRANT SELECT ON cha_tt TO app_api");
      await db.pool.query(`INSERT INTO cha_tt VALUES (1,'${orgA}',100)`);
      await db.pool.query(`INSERT INTO con_tt VALUES (2,'${orgB}',999)`);

      const apiPool = db.poolAs("app_api");
      const doc = async (bang: string): Promise<number[]> => {
        const client = await apiPool.connect();
        try {
          await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
          const { rows } = await client.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY 1`);
          return rows.map((r) => r.gia);
        } finally {
          client.release();
        }
      };

      // ~~migrate() đi qua: "con cháu INHERITS làm hardening GÃY — một lược đồ PostgreSQL coi là hợp lệ đang chặn deploy
      // vĩnh viễn"~~ [S1.40 / khoản nợ 82⑴] kỳ vọng LẬT có chủ đích: migrate() nay NÉM — nhưng ở MỤC KẾ THỪA (cặp INHERITS
      // chưa khai), KHÔNG ở [CR1] "không có policy PERMISSIVE". Miễn policy riêng cho con cháu (LA_CUA_BANG_TENANT) — điều
      // test này đo từ vòng fix 2 — còn nguyên. Khác "chặn vĩnh viễn": cửa ra là khai cặp vào KE_THUA_KHAI kèm lý do.
      const loiKeThua = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);
      expect(loiKeThua, "cặp INHERITS chưa khai phải bị mục 82⑴ bắt").not.toBeNull();
      expect(loiKeThua!.message).toContain("public.con_tt INHERITS public.cha_tt: cặp kế thừa cổ điển");
      expect(loiKeThua!.message, "miễn policy riêng cho con cháu vẫn còn — [CR1] không kêu về con_tt").not.toContain(
        "con_tt: không có policy PERMISSIVE",
      );
      const co = await db.pool.query<{ bat: boolean; cuong_che: boolean }>(
        "SELECT relrowsecurity AS bat, relforcerowsecurity AS cuong_che FROM pg_class " +
          "WHERE relname = 'con_tt'",
      );
      expect(co.rows[0], "miễn trừ chỉ an toàn khi mục (A) vẫn bật RLS + FORCE cho con").toEqual({
        bat: true,
        cuong_che: true,
      });
      expect(await doc("cha_tt"), "đọc QUA CHA phải chỉ thấy hàng của tổ chức A").toEqual([100]);
      await expect(doc("con_tt"), "con không quyền riêng: đọc thẳng ồn ào").rejects.toThrow(/permission denied/u);
      // [S1.38 / khoản nợ 83⑵, lượt soi 29 NẶNG-2] cấp quyền thẳng lên con ⇒ đọc thẳng fail-closed 0 hàng
      // không lỗi ⇒ hardening PHÁN XÉT; thu hồi ⇒ đi qua.
      await db.pool.query("GRANT SELECT ON con_tt TO app_api");
      const loiCon = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);
      expect(loiCon).not.toBeNull();
      expect(loiCon!.message).toContain("public.con_tt/app_api/SELECT: quyền đã cấp mà không policy PERMISSIVE nào phủ");
      expect(await doc("con_tt"), "đọc THẲNG con là fail-closed — đúng cái mục 83⑵ bắt").toEqual([]);
      await db.pool.query("REVOKE SELECT ON con_tt FROM app_api");
      const loiSauThuHoi = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);
      expect(loiSauThuHoi, "[S1.40] thu hồi quyền: 83⑵ im, 82⑴ vẫn kêu").not.toBeNull();
      expect(loiSauThuHoi!.message).not.toContain("con_tt/app_api");
      expect(loiSauThuHoi!.message).toContain("public.con_tt INHERITS public.cha_tt");
      // [lượt soi 33a, NHẸ-7] Đối chứng DƯƠNG cho khẳng định phủ định ở trên: [CR1] nguồn (i) CÓ THỂ kêu về một bảng
      // tenant ở public không policy — chỉ con cháu được miễn. Không có dòng này, "không kêu về con_tt" là rỗng ruột.
      await db.pool.query("CREATE TABLE zz_doc (id int, org_id uuid NOT NULL)");
      const loiDoc = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);
      expect(loiDoc!.message, "bảng tenant public không policy, không phải con cháu ⇒ [CR1] kêu").toContain("zz_doc: không có policy PERMISSIVE");
      expect(loiDoc!.message, "cùng lượt, con cháu vẫn được miễn").not.toContain("con_tt: không có policy PERMISSIVE");
      await db.pool.query("DROP TABLE zz_doc");
      // Dọn cặp kế thừa trước nửa (b) để các lượt migrate() của (b) đo đúng DETACH PARTITION, không kèm mục 82⑴.
      await db.pool.query("DROP TABLE con_tt");
      await expect(migrate(db.pool, thuMucTam), "đối chứng: không còn cặp ⇒ đi qua").resolves.toEqual([]);

      // ---- (b) DETACH PARTITION ------------------------------------------------------------
      await db.pool.query(
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL, gia int) PARTITION BY LIST (org_id)",
      );
      await db.pool.query(`CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('${orgA}')`);
      await db.pool.query("ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY bao_gia_tenant_isolation ON bao_gia " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("GRANT SELECT ON bao_gia TO app_api");
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([]);

      await db.pool.query("ALTER TABLE bao_gia DETACH PARTITION bao_gia_a");
      const loi = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "bảng vừa DETACH là bảng tenant độc lập không policy mà vẫn đi lọt").not.toBeNull();
      expect(loi!.message).toContain("bao_gia_a: không có policy PERMISSIVE nào");

      // Đường ra KHÔNG phải sửa tay trên cụm: một migration mới tới được đích vì lượt 1 không
      // phán xét. Đây chính là điều phải chứng minh để phép kiểm này không thành ngõ cụt.
      await writeFile(
        join(thuMucTam, "003_policy_cho_bang_tach.sql"),
        "CREATE POLICY bao_gia_a_tenant_isolation ON bao_gia_a " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([
        "003_policy_cho_bang_tach.sql",
      ]);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 120_000);
  // ==========================================================================================
  // [T5] SỔ KIỂM TOÁN CHỈ-GHI-THÊM — ba đường trôi im lặng, cả ba tự chữa
  // ==========================================================================================
  // Bất biến B4 nằm ở một hàm và sáu trigger do 003_audit_events.sql tạo ĐÚNG MỘT LẦN. Task 3
  // đã trả giá đúng lớp lỗi này hai lần (R3 với thân hàm, I3 với cờ RLS): thứ chỉ chạy một lần
  // thì trôi vĩnh viễn, vì file đã nằm trong schema_migrations.
  it("[T5] thân hàm chan_sua_xoa() bị thay bằng RETURN NEW được cưỡng chế lại ở lần migrate() sau", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('x'::bytea))",
        [org[0]!.id],
      );

      // Đột biến: thân hàm thành đúng "RETURN NEW;". Một phép kiểm dạng "hàm còn tồn tại
      // không" hay "trigger còn đó không" xanh hết — hàm vẫn tên đó, sáu trigger vẫn nguyên.
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.chan_sua_xoa() RETURNS trigger " +
          "LANGUAGE plpgsql AS $ac$ BEGIN RETURN NEW; END $ac$",
      );

      // Đo hậu quả TRƯỚC khi vá, để không ai nghi ngờ đột biến này là vô hại.
      await expect(
        db.pool.query("UPDATE audit_events SET action = 'SUA_TROM'"),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(db.pool.query("TRUNCATE audit_events")).resolves.toBeTruthy();
      const trong = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events",
      );
      expect(trong.rows[0]!.n, "sổ kiểm toán đã bị xoá sạch mà không một lỗi nào").toBe("0");

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('x'::bytea))",
        [org[0]!.id],
      );
      for (const cau of [
        "UPDATE audit_events SET action = 'SUA_TROM'",
        "DELETE FROM audit_events",
        "TRUNCATE audit_events",
      ]) {
        await expect(db.pool.query(cau), cau).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);
      }
    } finally {
      await db.stop();
    }
  }, 120_000);

  // Năm cách vô hiệu hoá trigger, bốn trong số đó GIỮ NGUYÊN TÊN trigger nên chúng đi lọt mọi
  // phép kiểm dạng "trigger còn đó không". Tất cả đã đo là chạy trên PostgreSQL 16.15.
  it("[T5] đổi hàm, DROP TRIGGER, DISABLE, ENABLE REPLICA, WHEN (false) và UPDATE OF đều được phục hồi", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const ghi = async (seq: number): Promise<void> => {
        await db.pool.query(
          "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
            "VALUES ($1, $2, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256($3::bytea))",
          [org[0]!.id, seq, `e${seq}`],
        );
      };
      await ghi(1);

      // Hàm trigger "hiền lành" dùng cho đột biến đổi tgfoid bên dưới. Nó KHÔNG phải
      // SECURITY DEFINER nên nó không kích hoạt mục (C) của hardening — đúng ý: đột biến này
      // phải đi lọt mọi lớp KHÁC để chứng minh chính vế tgfoid là thứ bắt được nó.
      await db.pool.query(
        "CREATE FUNCTION nop_tg() RETURNS trigger LANGUAGE plpgsql AS $n$ BEGIN RETURN NEW; END $n$",
      );

      // [đột biến M11-M13] Ba đột biến ĐẦU dùng "CREATE OR REPLACE TRIGGER", và câu lệnh đó
      // RESET tgenabled về 'O'. Bản đầu của test này dừng ở đó, và hậu quả đo được là ba vế
      // riêng của hardening (tgfoid, tgqual, tgattr) trở thành MÃ CHẾT: xoá vế nào cũng vẫn
      // xanh, vì vế tgenabled bắt hộ. Kẻ tấn công cẩn thận thì đặt lại ENABLE ALWAYS — nên
      // fixture phải làm đúng thế, nếu không nó tự vô hiệu hoá chính phép đo.
      const datLaiAlways =
        "; ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_update";
      const cacDotBien: [string, string, string][] = [
        [
          "đổi trigger sang gọi hàm khác (và đặt lại ENABLE ALWAYS)",
          "CREATE OR REPLACE TRIGGER audit_events_chan_update BEFORE UPDATE ON audit_events " +
            "FOR EACH ROW EXECUTE FUNCTION nop_tg()" + datLaiAlways,
          "UPDATE audit_events SET action = 'SUA_TROM'",
        ],
        [
          "DROP TRIGGER",
          "DROP TRIGGER audit_events_chan_update ON audit_events",
          "UPDATE audit_events SET action = 'SUA_TROM'",
        ],
        [
          "DISABLE TRIGGER",
          "ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete",
          "DELETE FROM audit_events",
        ],
        [
          "ENABLE REPLICA TRIGGER",
          "ALTER TABLE audit_events ENABLE REPLICA TRIGGER audit_events_chan_truncate",
          "TRUNCATE audit_events",
        ],
        [
          "WHEN (false) (và đặt lại ENABLE ALWAYS)",
          "CREATE OR REPLACE TRIGGER audit_events_chan_update BEFORE UPDATE ON audit_events " +
            "FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.chan_sua_xoa()" + datLaiAlways,
          "UPDATE audit_events SET action = 'SUA_TROM'",
        ],
        [
          "UPDATE OF <cột> (và đặt lại ENABLE ALWAYS)",
          "CREATE OR REPLACE TRIGGER audit_events_chan_update BEFORE UPDATE OF payload " +
            "ON audit_events FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa()" + datLaiAlways,
          "UPDATE audit_events SET action = 'SUA_TROM'",
        ],
      ];

      for (const [nhan, cauDotBien, cauTanCong] of cacDotBien) {
        await db.pool.query("TRUNCATE audit_events").catch(() => undefined);
        const con = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM audit_events",
        );
        if (con.rows[0]!.n === "0") await ghi(1);

        await db.pool.query(cauDotBien);
        // Chứng minh đột biến THẬT SỰ mở được đường — không có nửa này thì "migrate() phục hồi"
        // chỉ chứng minh migrate() không làm hỏng gì.
        const truoc = await db.pool
          .query(cauTanCong)
          .then(() => "THÀNH CÔNG", (e: Error) => e.message);
        expect(truoc, `${nhan}: đột biến không mở được đường nào — fixture tự vô hiệu hoá`).toBe(
          "THÀNH CÔNG",
        );

        await expect(migrate(db.pool, MIGRATIONS_DIR), nhan).resolves.toEqual([]);

        const con2 = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM audit_events",
        );
        if (con2.rows[0]!.n === "0") await ghi(1);
        const sau = await db.pool
          .query(cauTanCong)
          .then(() => "THÀNH CÔNG", (e: Error) => e.message);
        expect(sau, nhan).toMatch(/chỉ-ghi-thêm|append-only/i);
      }

      // Và trạng thái cuối là ENABLE ALWAYS trên cả TÁM trigger — không phải chỉ "tồn tại".
      // [Task 6] Tám chứ không sáu: 004 thêm audit_events_noi_chuoi và (vòng fix 1 — IM4)
      // audit_chain_anchors_moc_neo vào `can_co` của lớp C.
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " WHERE NOT t.tgisinternal AND c.relname IN ('audit_events','audit_chain_anchors') " +
          "   AND t.tgenabled = 'A' AND t.tgqual IS NULL AND t.tgattr::text = ''",
      );
      expect(rows[0]!.n).toBe("8");
    } finally {
      await db.stop();
    }
  }, 180_000);

  // [T5] Vế "bảng sổ phải tồn tại như một BẢNG THẬT trong public" của CAU_TRIGGER_CHAN_SAI. Và
  // câu trả lời QT1 cho nó — ai sửa được, bằng cách nào, trong bao lâu: một migration MỚI, không
  // phải sửa tay trên cụm, vì lượt SỬA không phán xét nên vòng migration đánh số luôn tới đích.
  // [vòng fix 1 — CR2] Vế này ở vòng trước chỉ nổ khi MỘT bảng còn và bảng kia mất; nay nó phủ
  // cả "mất cả hai" và "bị thay bằng VIEW" — xem ba test [vòng fix 1 — CR2*] bên dưới.
  it("[T5] mất MỘT bảng sổ làm migrate() GÃY, và vá được bằng một migration mới", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-t5-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_audit_events.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);

      await db.pool.query("DROP TABLE audit_chain_anchors CASCADE");
      const loi = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "mất một nửa lược đồ sổ kiểm toán mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("audit_chain_anchors");
      expect(loi!.message).toContain("KHÔNG TỒN TẠI");

      await writeFile(
        join(thuMucTam, "004_dung_lai_moc_neo.sql"),
        "CREATE TABLE audit_chain_anchors (\n" +
          "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n" +
          "  org_id uuid NOT NULL REFERENCES organizations(id),\n" +
          "  seq bigint NOT NULL CHECK (seq > 0),\n" +
          "  hash bytea NOT NULL CHECK (octet_length(hash) = 32),\n" +
          "  anchored_at timestamptz NOT NULL DEFAULT now(),\n" +
          "  UNIQUE (org_id, seq));\n" +
          "ALTER TABLE audit_chain_anchors ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE audit_chain_anchors FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY audit_anchors_tenant_isolation ON audit_chain_anchors\n" +
          "  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON audit_chain_anchors TO app_api, app_unseal;\n",
        "utf8",
      );
      // Cố ý KHÔNG viết CREATE TRIGGER trong 004: lớp C phải tự dựng lại ba trigger cho bảng
      // vừa xuất hiện. Nếu nó không làm, lượt PHÁN XÉT của CHÍNH lần chạy này sẽ gãy.
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["004_dung_lai_moc_neo.sql"]);

      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " WHERE NOT t.tgisinternal AND c.relname = 'audit_chain_anchors' AND t.tgenabled = 'A'",
      );
      // [vòng fix 1 — IM4] BỐN chứ không ba: bảng vừa dựng lại mang ĐÚNG hình dạng bảng neo
      // (org_id, seq, hash, anchored_at và KHÔNG có prev_hash/occurred_at/payload/action), nên
      // lớp C dựng cho nó cả `audit_chain_anchors_moc_neo`. Đó chính là vế "vị từ hình dạng"
      // của [IM2] làm việc theo chiều THUẬN.
      expect(rows[0]!.n).toBe("4");
      await expect(db.pool.query("TRUNCATE audit_chain_anchors")).rejects.toThrow(
        /chỉ-ghi-thêm|append-only/i,
      );
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // [vòng fix 1] BỐN GIỚI HẠN TẦM NHÌN CỦA LỚP C — mỗi cái một test đối kháng
  // ==========================================================================================
  // Vòng trước canh SÁU CÁI TÊN TRIGGER nó biết, trong schema public, trên relkind r/p, và chỉ
  // nổ khi MỘT bảng sổ mất. Bốn test dưới đây dựng lại ĐÚNG payload mà reviewer đã đo, và tất cả
  // đều ĐỎ trên bản trước bản vá.

  // [CR1] Phát hiện nặng nhất của Task 5: trigger/rule LẠ nuốt sự kiện audit trong im lặng và để
  // lại một chuỗi hash LIỀN MẠCH MÀ THIẾU SỰ KIỆN — bộ kiểm chứng của Task 6 sẽ báo HỢP LỆ.
  it("[vòng fix 1 — CR1] trigger BEFORE INSERT lạ và RULE DO INSTEAD NOTHING nuốt sự kiện audit, và bị gỡ", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const orgId = org[0]!.id;
      const ghi = async (seq: number, action: string): Promise<number | null> => {
        const r = await db.pool.query(
          "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
            "VALUES ($1, $2, 'SYSTEM', $3, 'TEST', decode(repeat('00',32),'hex'), sha256($4::bytea))",
          [orgId, seq, action, `e${seq}`],
        );
        return r.rowCount;
      };

      await db.pool.query(
        "CREATE FUNCTION public.nuot_co_chon() RETURNS trigger LANGUAGE plpgsql AS " +
          "$f$ BEGIN RETURN NULL; END $f$",
      );
      await db.pool.query(
        "CREATE TRIGGER aaa_nuot_chon BEFORE INSERT ON audit_events FOR EACH ROW " +
          "WHEN (NEW.action = 'MO_NIEM_PHONG') EXECUTE FUNCTION public.nuot_co_chon()",
      );
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER aaa_nuot_chon");
      await db.pool.query(
        "CREATE RULE r_ins AS ON INSERT TO audit_chain_anchors DO INSTEAD NOTHING",
      );

      // Fixture phải chứng minh nó tấn công được TRƯỚC khi kết luận gì về bản vá.
      expect(
        await ghi(1, "MO_NIEM_PHONG"),
        "trigger lạ không nuốt nổi gì — fixture tự vô hiệu hoá",
      ).toBe(0);
      expect(await ghi(2, "XEM_BAO_CAO")).toBe(1);
      const neo = await db.pool.query(
        "INSERT INTO audit_chain_anchors (org_id, seq, hash) VALUES ($1, 1, sha256('n'::bytea))",
        [orgId],
      );
      expect(neo.rowCount, "RULE không nuốt nổi gì — fixture tự vô hiệu hoá").toBe(0);

      // Và đây là điều làm nó nguy hiểm hơn xoá hàng: sổ TRÔNG NHƯ nguyên vẹn.
      const conLai = await db.pool.query<{ action: string }>(
        "SELECT action FROM audit_events ORDER BY seq",
      );
      expect(conLai.rows.map((r) => r.action)).toEqual(["XEM_BAO_CAO"]);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      expect(await ghi(3, "MO_NIEM_PHONG"), "trigger lạ vẫn còn nuốt sự kiện").toBe(1);
      const neo2 = await db.pool.query(
        "INSERT INTO audit_chain_anchors (org_id, seq, hash) VALUES ($1, 2, sha256('n2'::bytea))",
        [orgId],
      );
      expect(neo2.rowCount, "RULE vẫn còn nuốt mốc neo").toBe(1);

      const { rows: conSot } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " WHERE c.relname = 'audit_events' AND NOT t.tgisinternal AND t.tgname = 'aaa_nuot_chon'",
      );
      expect(conSot[0]!.n).toBe("0");
      const { rows: rule } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_rewrite rw JOIN pg_class c ON c.oid = rw.ev_class " +
          " WHERE c.relname = 'audit_chain_anchors' AND rw.rulename <> '_RETURN'",
      );
      expect(rule[0]!.n).toBe("0");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [CR2] Ba mặt của cùng một lỗ, nay đóng bằng MỘT vị từ. Ba container riêng vì cả ba đều phá
  // huỷ lược đồ theo cách không hoàn tác được trong cùng một database.
  it("[vòng fix 1 — CR2a] ALTER TABLE ... SET SCHEMA cả hai bảng sổ không còn đi lọt im lặng", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('x'::bytea))",
        [org[0]!.id],
      );

      await db.pool.query("CREATE SCHEMA kho_toi");
      await db.pool.query("ALTER TABLE audit_events SET SCHEMA kho_toi");
      await db.pool.query("ALTER TABLE audit_chain_anchors SET SCHEMA kho_toi");
      // Ở schema mới, chủ sở hữu tự gỡ trigger rồi viết lại lịch sử.
      await db.pool.query("DROP TRIGGER audit_events_chan_delete ON kho_toi.audit_events");
      await expect(
        db.pool.query("DELETE FROM kho_toi.audit_events"),
        "đột biến không mở được đường nào — fixture tự vô hiệu hoá",
      ).resolves.toMatchObject({ rowCount: 1 });

      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "cả hai bảng sổ rời khỏi public mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("KHÔNG TỒN TẠI như một BẢNG THẬT");
      expect(loi!.message).toContain("audit_events");
      expect(loi!.message).toContain("audit_chain_anchors");

      // Và lớp C vẫn với tới được bảng ở schema mới: trigger bị gỡ đã được dựng lại.
      // [Task 6] Tám: ba trigger chỉ-ghi-thêm cho mỗi bảng, cộng audit_events_noi_chuoi và
      // audit_chain_anchors_moc_neo. Vế lọc theo HÌNH DẠNG ([vòng fix 1 — IM2]) vẫn nhận cả hai
      // bảng ở schema mới — đó là điều mà một vế lọc theo `nspname='public'` sẽ đánh mất.
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " JOIN pg_namespace n ON n.oid = c.relnamespace " +
          " WHERE n.nspname = 'kho_toi' AND NOT t.tgisinternal AND t.tgenabled = 'A'",
      );
      expect(rows[0]!.n).toBe("8");
    } finally {
      await db.stop();
    }
  }, 120_000);

  it("[vòng fix 1 — CR2b] thay bảng sổ bằng một VIEW cùng tên không còn đi lọt im lặng", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("DROP TABLE audit_events CASCADE");
      await db.pool.query(
        "CREATE VIEW audit_events WITH (security_invoker = true) AS " +
          "SELECT id, org_id, seq, hash, anchored_at AS occurred_at FROM audit_chain_anchors",
      );
      // Đúng chỗ khiến ca này nguy hiểm hơn DROP: MỌI truy vấn sổ vẫn chạy, sổ chỉ TRÔNG NHƯ RỖNG.
      const { rows: dem } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events",
      );
      expect(dem[0]!.n).toBe("0");
      const { rows: kind } = await db.pool.query<{ relkind: string }>(
        "SELECT relkind FROM pg_class WHERE relname = 'audit_events'",
      );
      expect(kind[0]!.relkind, "fixture tự vô hiệu hoá: bảng không bị thay bằng view").toBe("v");

      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "bảng sổ bị thay bằng VIEW mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("audit_events");
      expect(loi!.message).toContain("KHÔNG TỒN TẠI như một BẢNG THẬT");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [CR2c] Ca mà vòng trước CỐ Ý bỏ ngỏ, với lý do "hậu điều kiện vô điều kiện sẽ đòi 003 có mặt
  // ở MỌI lược đồ". Lý do đó chỉ đúng cho MỘT cách hiện thực. Test này khẳng định CẢ HAI VẾ: mất
  // cả hai bảng thì GÃY, mà thư mục migration rút gọn (001/002) thì VẪN QUA — nếu chỉ khẳng định
  // vế đầu, một hậu điều kiện vô điều kiện cũng xanh và cả bộ test còn lại mới là chỗ vỡ.
  it("[vòng fix 1 — CR2c] mất CẢ HAI bảng sổ làm migrate() GÃY, nhưng thư mục chỉ có 001/002 vẫn QUA", async () => {
    const db = await startPostgres();
    const thuMucDay = await mkdtemp(join(tmpdir(), "tp-cr2c-day-"));
    const thuMucGon = await mkdtemp(join(tmpdir(), "tp-cr2c-gon-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_audit_events.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucDay, f));
        if (!f.startsWith("003")) await copyFile(join(MIGRATIONS_DIR, f), join(thuMucGon, f));
      }
      await migrate(db.pool, thuMucDay);
      await db.pool.query("DROP TABLE audit_events CASCADE");
      await db.pool.query("DROP TABLE audit_chain_anchors CASCADE");

      const loi = await migrate(db.pool, thuMucDay).then(() => null, (e: Error) => e);
      expect(loi, "mất CẢ HAI bảng sổ mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("audit_events");
      expect(loi!.message).toContain("audit_chain_anchors");

      // Vế đối chứng, trên một database SẠCH: không có dòng 003_* trong schema_migrations nên
      // vế canh phải NẰM IM.
      const db2 = await startPostgres();
      try {
        await expect(migrate(db2.pool, thuMucGon)).resolves.toEqual([
          "001_roles_and_functions.sql",
          "002_organizations_and_users.sql",
        ]);
        await expect(migrate(db2.pool, thuMucGon)).resolves.toEqual([]);
      } finally {
        await db2.stop();
      }
    } finally {
      await rm(thuMucDay, { recursive: true, force: true });
      await rm(thuMucGon, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // [CR3] Kịch bản LIỀN mà reviewer suy ra từ hai phép đo: DISABLE một trigger rồi cắm một
  // CONSTRAINT TRIGGER trùng tên cái khác. Trên bản chưa vá, câu tự chữa CREATE OR REPLACE
  // TRIGGER ném 42710 ở LƯỢT SỬA — tức TRƯỚC vòng migration đánh số — nên migrate() chết vĩnh
  // viễn và lớp C tự khoá mình lại: "cửa sổ phơi tới lần deploy kế" thành VĨNH VIỄN.
  it("[vòng fix 1 — CR3] CONSTRAINT TRIGGER trùng tên không còn làm migrate() gãy vĩnh viễn", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('x'::bytea))",
        [org[0]!.id],
      );

      await db.pool.query("DROP TRIGGER audit_events_chan_delete ON audit_events");
      await db.pool.query(
        "CREATE CONSTRAINT TRIGGER audit_events_chan_delete AFTER DELETE ON audit_events " +
          "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa()",
      );
      await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_update");
      await expect(
        db.pool.query("UPDATE audit_events SET action = 'SUA_TROM'"),
        "đột biến không mở được đường nào — fixture tự vô hiệu hoá",
      ).resolves.toMatchObject({ rowCount: 1 });

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      for (const cau of [
        "UPDATE audit_events SET action = 'SUA_TROM'",
        "DELETE FROM audit_events",
      ]) {
        await expect(db.pool.query(cau), cau).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);
      }
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " WHERE c.relname = 'audit_events' AND NOT t.tgisinternal " +
          "   AND t.tgenabled = 'A' AND t.tgconstraint = 0",
      );
      // [Task 6] Bốn: ba trigger chỉ-ghi-thêm + audit_events_noi_chuoi.
      expect(rows[0]!.n).toBe("4");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [CR3 — BẤT BIẾN CỦA BƯỚC 2] Lời hứa "migrate() luôn chạy được hết vòng migration đánh số" là
  // NỀN của cả đường thoát QT1 của dự án, và nó xứng đáng có một phép kiểm RIÊNG không phụ thuộc
  // vào việc bản vá CR3 có đúng hay không. Test này dựng một câu lệnh cưỡng chế ném lỗi KHÁC
  // 42501 một cách BỀN VỮNG (ADD CONSTRAINT UNIQUE trên bảng đang có hàng trùng -> 23505) rồi
  // khẳng định: (a) 004_*.sql VẪN chạy tới đích, (b) lỗi vẫn ồn ào ở lượt PHÁN XÉT, (c) một
  // migration mới vá được. Nếu BƯỚC 2 quay lại chỉ nuốt 42501, cả ba vế cùng đỏ.
  it("[vòng fix 1 — CR3] câu lệnh cưỡng chế ném lỗi KHÁC 42501 vẫn để migration đánh số chạy tới đích", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-cr3-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_audit_events.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const orgId = org[0]!.id;

      // Dựng trạng thái mà câu cưỡng chế của mục (D3) KHÔNG THỂ sửa: bỏ ràng buộc duy nhất rồi
      // tạo hai hàng trùng (org_id, seq) — "ALTER TABLE ... ADD CONSTRAINT UNIQUE" khi đó ném
      // 23505 (unique_violation), không phải 42501.
      await db.pool.query("ALTER TABLE audit_events DROP CONSTRAINT audit_events_org_id_seq_key");
      // [Task 6] Phải gỡ trigger nối chuỗi trước: nó GHI ĐÈ seq vô điều kiện (kể cả với
      // superuser), nên nếu để nguyên thì hai câu dưới cho seq 1 và 2 và fixture không dựng nổi
      // trạng thái "hai hàng cùng (org_id, seq)" mà test này cần. Lượt 'sua' của migrate() phía
      // sau tự bật lại nó — đó chính là điều mục (D2) hứa.
      await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_noi_chuoi");
      for (const nhan of ["a", "b"]) {
        await db.pool.query(
          "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
            "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256($2::bytea))",
          [orgId, nhan],
        );
      }
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_noi_chuoi");
      const { rows: demTrung } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND seq = 1",
        [orgId],
      );
      expect(demTrung[0]!.n, "fixture tự vô hiệu hoá: không dựng nổi hai hàng cùng seq").toBe("2");

      await writeFile(
        join(thuMucTam, "004_danh_dau.sql"),
        "CREATE TABLE dau_moc_004 (id int PRIMARY KEY);\n",
        "utf8",
      );
      const loi = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);

      // (b) vẫn ồn ào, và ồn ào ở LƯỢT PHÁN XÉT chứ không phải lượt sửa.
      expect(loi, "chuỗi hash rẽ nhánh mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("phan_xet");
      expect(loi!.message).toContain("UNIQUE (org_id, seq)");

      // (a) và đây là vế quan trọng nhất: 004 VẪN CHẠY TỚI ĐÍCH dù câu cưỡng chế đã ném lỗi.
      const { rows: moc } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_class WHERE relname = 'dau_moc_004'",
      );
      expect(
        moc[0]!.n,
        "migrate() chết TRƯỚC vòng migration đánh số — đường vá bằng migration mới không tới được",
      ).toBe("1");

      // (c) vá được bằng một migration MỚI, không phải sửa tay trên cụm. Chính lớp A chặn DELETE
      // nên migration vá phải tự tắt trigger trong transaction của nó — đó là quyền của chủ sở
      // hữu bảng, và là đường sửa duy nhất đúng cho một hàng trùng đã lọt vào sổ.
      await writeFile(
        join(thuMucTam, "005_don_trung_seq.sql"),
        "ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete;\n" +
          "DELETE FROM audit_events a USING audit_events b\n" +
          " WHERE a.org_id = b.org_id AND a.seq = b.seq AND a.ctid > b.ctid;\n" +
          "ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_delete;\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["005_don_trung_seq.sql"]);
      const { rows: con } = await db.pool.query<{ conname: string }>(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'audit_events'::regclass " +
          "  AND contype = 'u'",
      );
      expect(
        con.map((r) => r.conname),
        "lớp C phải phục hồi ràng buộc duy nhất ngay trong lần chạy vá",
      ).toEqual(["audit_events_org_id_seq_key"]);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 120_000);

  // [CR3 — BẤT BIẾN CỦA BƯỚC 2, mũi thứ hai] Test "23505" ở trên KHÔNG còn đo BƯỚC 2 sau khi mỗi
  // đơn vị sửa chữa được bọc trong khối con BEGIN/EXCEPTION riêng: câu ADD CONSTRAINT nay bị khối
  // con bắt trước, nên nó đo lớp trong chứ không đo lớp ngoài. Đúng bài học "một bản vá an ninh
  // có thể làm một test an ninh KHÁC mất tác dụng mà vẫn xanh" — đã đo bằng đột biến (N10 sống
  // sót). Mũi này nhắm vào câu lệnh cưỡng chế KHÔNG có khối con: mục (D1). Payload đo được:
  //     DROP FUNCTION public.chan_sua_xoa() CASCADE;                    -- kéo theo 6 trigger
  //     CREATE FUNCTION public.chan_sua_xoa() RETURNS int ...;          -- đổi kiểu trả về
  //     CREATE VIEW v_phu AS SELECT public.chan_sua_xoa();              -- tạo phụ thuộc
  //   -> "DROP FUNCTION" ném 2BP01 (dependent objects still exist), và CREATE OR REPLACE thì ném
  //      "cannot change return type". Cả hai KHÁC 42501.
  it("[vòng fix 1 — CR3] lỗi 2BP01 từ câu lệnh cưỡng chế của mục (D1) không chặn vòng migration đánh số", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-cr3b-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_audit_events.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);

      await db.pool.query("DROP FUNCTION public.chan_sua_xoa() CASCADE");
      await db.pool.query(
        "CREATE FUNCTION public.chan_sua_xoa() RETURNS int LANGUAGE plpgsql AS " +
          "$v$ BEGIN RETURN 1; END $v$",
      );
      await db.pool.query("CREATE VIEW v_phu AS SELECT public.chan_sua_xoa() AS x");

      await writeFile(
        join(thuMucTam, "004_danh_dau_2bp01.sql"),
        "CREATE TABLE moc_2bp01 (id int PRIMARY KEY);\n",
        "utf8",
      );
      const loi = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);
      expect(loi, "hàm chặn bị thay kiểu trả về mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("phan_xet");
      expect(loi!.message).toContain("định nghĩa hàm public.chan_sua_xoa()");

      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_class WHERE relname = 'moc_2bp01'",
      );
      expect(
        rows[0]!.n,
        "một lỗi KHÁC 42501 ở BƯỚC 2 đã kéo migrate() chết TRƯỚC vòng migration đánh số — " +
          "đường vá bằng migration mới không tới được",
      ).toBe("1");

      // Đường sửa bằng migration MỚI: gỡ phụ thuộc rồi để lớp C dựng lại hàm và sáu trigger.
      await writeFile(
        join(thuMucTam, "005_go_phu_thuoc.sql"),
        "DROP VIEW v_phu;\nDROP FUNCTION public.chan_sua_xoa();\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["005_go_phu_thuoc.sql"]);
      await expect(db.pool.query("TRUNCATE audit_events")).rejects.toThrow(
        /chỉ-ghi-thêm|append-only/i,
      );
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // [CR4] Vòng trước suy "bảng chỉ-ghi-thêm" QUA TRIGGER rồi TỰ TẠO NỐT cả ba trigger còn thiếu.
  // Kịch bản Task 7 hoàn toàn hợp lệ (bảng báo giá chống XOÁ nhưng vẫn cần UPDATE) vì thế hỏng
  // IM LẶNG. Test này thay test "[T5] bảng chỉ-ghi-thêm KHÔNG có trong danh sách vẫn được canh"
  // của vòng trước: vế nhận diện qua trigger được GIỮ (nó vẫn bắt được trôi) nhưng CHỈ PHÁN XÉT.
  it("[vòng fix 1 — CR4] migrate() KHÔNG tự áp đặt chỉ-ghi-thêm lên bảng ngoài danh sách, mà báo lỗi kèm hướng dẫn", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("CREATE TABLE bao_gia (id bigserial PRIMARY KEY, trang_thai text)");
      await db.pool.query(
        "CREATE TRIGGER bao_gia_chan_delete BEFORE DELETE ON bao_gia FOR EACH ROW " +
          "EXECUTE FUNCTION public.chan_sua_xoa()",
      );
      await db.pool.query("INSERT INTO bao_gia (trang_thai) VALUES ('nhap')");
      await expect(
        db.pool.query("UPDATE bao_gia SET trang_thai = 'da_nop'"),
        "fixture tự vô hiệu hoá: bảng này phải UPDATE được TRƯỚC migrate()",
      ).resolves.toMatchObject({ rowCount: 1 });

      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "migrate() im lặng đổi ngữ nghĩa một lược đồ hợp lệ").not.toBeNull();
      expect(loi!.message).toContain("bao_gia_chan_update");
      expect(loi!.message).toContain("BANG_CHI_GHI_THEM");
      expect(loi!.message).toContain("một hàm trigger KHÁC");

      // VÀ — vế quan trọng nhất — migrate() KHÔNG tự tạo trigger nào cho bảng này.
      const { rows } = await db.pool.query<{ ten: string }>(
        "SELECT t.tgname AS ten FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " WHERE c.relname = 'bao_gia' AND NOT t.tgisinternal ORDER BY 1",
      );
      expect(rows.map((r) => r.ten)).toEqual(["bao_gia_chan_delete"]);
      await expect(db.pool.query("UPDATE bao_gia SET trang_thai = 'x'")).resolves.toMatchObject({
        rowCount: 1,
      });

      // Đường thoát viết trong thông báo phải THẬT SỰ đi được: gỡ trigger -> migrate() QUA lại.
      await db.pool.query("DROP TRIGGER bao_gia_chan_delete ON bao_gia");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // NỬA CÒN LẠI của bản vá CR4: vế nhận diện qua trigger vẫn phải BẮT ĐƯỢC trôi, nếu không
      // "chỉ phán xét, không tự chữa" chỉ là cách nói khác của "gỡ bỏ một phép kiểm". Bảng ngoài
      // danh sách mang ĐỦ ba trigger mà bị DISABLE một cái thì migrate() phải nói ra.
      await db.pool.query("CREATE TABLE so_ngoai (id bigserial PRIMARY KEY, noi_dung text)");
      for (const [hauTo, sk, pv] of [
        ["update", "UPDATE", "FOR EACH ROW"],
        ["delete", "DELETE", "FOR EACH ROW"],
        ["truncate", "TRUNCATE", "FOR EACH STATEMENT"],
      ] as const) {
        await db.pool.query(
          `CREATE TRIGGER so_ngoai_chan_${hauTo} BEFORE ${sk} ON so_ngoai ${pv} ` +
            "EXECUTE FUNCTION public.chan_sua_xoa()",
        );
        await db.pool.query(`ALTER TABLE so_ngoai ENABLE ALWAYS TRIGGER so_ngoai_chan_${hauTo}`);
      }
      await db.pool.query("INSERT INTO so_ngoai (noi_dung) VALUES ('x')");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      await db.pool.query("ALTER TABLE so_ngoai DISABLE TRIGGER so_ngoai_chan_update");
      await expect(
        db.pool.query("UPDATE so_ngoai SET noi_dung = 'y'"),
        "đột biến không mở được đường nào — fixture tự vô hiệu hoá",
      ).resolves.toMatchObject({ rowCount: 1 });

      const loiSoNgoai = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(
        loiSoNgoai,
        "mất một trigger trên bảng ngoài danh sách mà migrate() vẫn QUA",
      ).not.toBeNull();
      expect(loiSoNgoai!.message).toContain("so_ngoai.so_ngoai_chan_update");
      expect(loiSoNgoai!.message).toContain("BANG_CHI_GHI_THEM");

      // [vòng fix 1 — CR3] Vế `tgconstraint <> 0` phải có TÊN GỌI RIÊNG trong thông báo, không
      // được để trạng thái nguy hiểm nhất của mục này bị báo dưới cái tên "sai tgtype". Trên bảng
      // ngoài danh sách thì không có tự chữa nào chen vào nên đây là chỗ đo được vế đó; bỏ vế ấy
      // khỏi hardening làm khẳng định dưới đây ĐỎ.
      await db.pool.query("DROP TRIGGER so_ngoai_chan_delete ON so_ngoai");
      await db.pool.query(
        "CREATE CONSTRAINT TRIGGER so_ngoai_chan_delete AFTER DELETE ON so_ngoai " +
          "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa()",
      );
      const loiRangBuoc = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiRangBuoc).not.toBeNull();
      expect(loiRangBuoc!.message).toContain("so_ngoai.so_ngoai_chan_delete");
      expect(loiRangBuoc!.message).toContain("CONSTRAINT TRIGGER");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [vòng fix 1 — QT1 cho ba mục MỚI] "Ai sửa được nó, bằng cách nào, trong bao lâu" khi role
  // deploy KHÔNG sở hữu bảng sổ. Test này tồn tại vì một lý do đo được chứ không phải cho đủ bộ:
  // bốn vế HẬU ĐIỀU KIỆN mới (trigger lạ, rule, relpersistence, ACL) SỐNG SÓT đột biến khi chỉ có
  // các test chạy dưới superuser — vì ở đó CÂU LỆNH CƯỠNG CHẾ sửa xong trước khi hậu điều kiện kịp
  // nói gì. Hai lớp che nhau, đúng bài học đã trả giá ở Task 4. Dưới role deploy không sở hữu
  // bảng, câu cưỡng chế nhận 42501 và bị nuốt, nên hậu điều kiện là lớp DUY NHẤT còn lại — đây
  // là chỗ đo được nó, và cũng là câu trả lời QT1: migrate() GÃY ỒN ÀO kèm quyền cần có, thay vì
  // đi tiếp im lặng.
  // [vòng fix 2 — diện phủ] Mở rộng sang ba hậu điều kiện còn lại của các mục Task 5 thêm vào:
  // thân hàm chặn (D1), hình dạng sáu trigger (D2), và ràng buộc UNIQUE (D3). Xem chú thích trong
  // thân test.
  it("[vòng fix 1+2 — QT1] role deploy không sở hữu bảng sổ: cả BẢY đường trôi của nhóm (D) đều làm migrate() GÃY kèm quyền cần có", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Đối chứng: không trôi thì deploy thường vẫn QUA. Không có nửa này, một test "GÃY" chỉ
        // chứng minh role đó không deploy nổi bất cứ gì.
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);

        await db.pool.query(
          "CREATE FUNCTION public.nuot_co_chon() RETURNS trigger LANGUAGE plpgsql AS " +
            "$f$ BEGIN RETURN NULL; END $f$",
        );
        await db.pool.query(
          "CREATE TRIGGER aaa_nuot_chon BEFORE INSERT ON audit_events FOR EACH ROW " +
            "EXECUTE FUNCTION public.nuot_co_chon()",
        );
        await db.pool.query(
          "CREATE RULE r_ins AS ON INSERT TO audit_chain_anchors DO INSTEAD NOTHING",
        );
        await db.pool.query("ALTER TABLE audit_events SET UNLOGGED");
        await db.pool.query("GRANT DELETE ON audit_events TO app_api");

        // [vòng fix 2 — diện phủ] Quy tắc mới: MỖI hậu điều kiện hardening mới phải có ĐÚNG MỘT
        // test chạy dưới role deploy mà câu cưỡng chế tương ứng nhận 42501. Vòng 1 chỉ phủ được
        // bốn vế (trigger lạ, rule, relpersistence, ACL); ba vế còn lại của các mục Task 5 thêm
        // vào chỉ được đo dưới SUPERUSER, nơi câu cưỡng chế sửa xong trước khi hậu điều kiện kịp
        // nói gì. Ba mũi dưới đây đóng nốt: (D1) thân hàm chặn — CREATE OR REPLACE FUNCTION trên
        // hàm đã tồn tại đòi QUYỀN SỞ HỮU; (D2) HÌNH DẠNG sáu trigger; (D3) UNIQUE (org_id, seq).
        await db.pool.query(
          "CREATE OR REPLACE FUNCTION public.chan_sua_xoa() RETURNS trigger LANGUAGE plpgsql " +
            "SET search_path = pg_catalog AS $ham$ BEGIN RETURN NEW; END $ham$",
        );
        await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_update");
        await db.pool.query(
          "ALTER TABLE audit_events DROP CONSTRAINT audit_events_org_id_seq_key",
        );

        const loi = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
        expect(loi, "bảy đường trôi trên bảng sổ mà migrate() vẫn QUA").not.toBeNull();
        expect(loi!.message).toContain("TRIGGER LẠ trên bảng sổ");
        expect(loi!.message).toContain("RULE trên bảng sổ");
        expect(loi!.message).toContain("UNLOGGED");
        expect(loi!.message).toContain("quyền DELETE cấp cho app_api");
        expect(loi!.message).toContain("định nghĩa hàm public.chan_sua_xoa()");
        expect(loi!.message).toContain("audit_events.audit_events_chan_update: tgenabled=D");
        expect(loi!.message).toContain("thiếu ràng buộc UNIQUE (org_id, seq)");
        expect(loi!.message).toContain("Cần quyền");

        // Và trôi vẫn còn NGUYÊN: migrate() gãy chứ không "sửa được một nửa" rồi im.
        const { rows } = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
            " WHERE c.relname = 'audit_events' AND t.tgname = 'aaa_nuot_chon'",
        );
        expect(rows[0]!.n).toBe("1");
      } finally {
        await poolTrienKhai.end();
      }

      // Đường sửa: một chủ thể CÓ quyền sở hữu chạy migrate() -> tự chữa hết trong một lần.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [Task 6] HAI MỤC MỚI CỦA NHÓM (D): định nghĩa audit_compute_hash và noi_chuoi_kiem_toan
  // ==========================================================================================
  // Vì sao (D1a) là mục quan trọng nhất mà Task 6 thêm vào lớp C, đo chứ không suy: bộ kiểm chứng
  // chuỗi TÍNH LẠI băm bằng CHÍNH hàm audit_compute_hash. Thay thân hàm đó là làm cho mọi hàng
  // băm ra cùng một giá trị — chuỗi vẫn "khớp" ở mọi mắt xích và bộ kiểm chứng báo HỢP LỆ, trong
  // khi nội dung không còn bị ràng buộc bởi băm nào. Không lớp nào khác bắt được: trigger vẫn
  // đúng tên, đúng hàm, đúng tgtype, đúng tgenabled.
  it("[Task 6] thay thân audit_compute_hash làm chuỗi mất ý nghĩa, và lớp C phục hồi ở lần migrate() kế", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const vaCham = async (): Promise<boolean> => {
        const { rows } = await db.pool.query<{ trung: boolean }>(
          "SELECT audit_compute_hash(decode(repeat('00',32),'hex'), " +
            "'33333333-3333-3333-3333-333333333333'::uuid, " +
            "'11111111-1111-1111-1111-111111111111'::uuid, 1::bigint, now(), 'USER', NULL, " +
            "'A', 'T', NULL, '{}'::jsonb, NULL, NULL, NULL) " +
            "= audit_compute_hash(decode(repeat('00',32),'hex'), " +
            "'33333333-3333-3333-3333-333333333333'::uuid, " +
            "'11111111-1111-1111-1111-111111111111'::uuid, 2::bigint, now(), 'USER', NULL, " +
            "'B', 'T', NULL, '{}'::jsonb, NULL, NULL, NULL) AS trung",
        );
        return rows[0]!.trung;
      };
      expect(await vaCham(), "hai sự kiện khác nhau không được cho cùng một băm").toBe(false);

      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.audit_compute_hash(p_prev_hash bytea, p_id uuid, " +
          "p_org_id uuid, p_seq bigint, p_occurred_at timestamptz, p_actor_type text, " +
          "p_actor_id uuid, p_action text, p_resource_type text, p_resource_id uuid, " +
          "p_payload jsonb, p_request_id uuid, p_ip inet, p_user_agent text) RETURNS bytea " +
          "LANGUAGE sql IMMUTABLE AS $f$ SELECT sha256(''::bytea) $f$",
      );
      expect(
        await vaCham(),
        "fixture tự vô hiệu hoá: thay thân hàm mà băm vẫn phân biệt được hai sự kiện",
      ).toBe(true);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await vaCham(), "lớp C phải phục hồi thân hàm băm").toBe(false);

      // Và mệnh đề SET (bản vá QT2) cũng phải quay lại — nó nằm trong hậu điều kiện, không phải
      // trong thân hàm, nên một đột biến chỉ so prosrc sẽ bỏ sót nó.
      const { rows: cauHinh } = await db.pool.query<{ proconfig: string[] }>(
        "SELECT p.proconfig FROM pg_proc p WHERE p.proname = 'audit_compute_hash'",
      );
      expect(cauHinh[0]!.proconfig).toEqual([
        "search_path=pg_catalog",
        "DateStyle=ISO, YMD",
        "TimeZone=UTC",
        "lc_time=C",
      ]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // [cạm bẫy 6 / quy tắc bắt buộc] MỖI hậu điều kiện hardening mới phải có ĐÚNG MỘT test chạy
  // dưới role deploy mà câu cưỡng chế tương ứng nhận 42501 — nếu không, một đột biến xoá hậu
  // điều kiện vẫn sống sót vì câu cưỡng chế (chạy dưới superuser trong mọi test khác) sửa xong
  // trước khi hậu điều kiện kịp nói gì. Hai mục MỚI của Task 6 được đóng ở đây.
  it("[Task 6 — QT1] role deploy không sở hữu hai hàm chuỗi: cả hai đường trôi làm migrate() GÃY kèm quyền cần có", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Đối chứng: không trôi thì deploy thường vẫn QUA.
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);

        // Hai hàm do superuser tạo ra ở lần migrate() đầu, nên role deploy KHÔNG sở hữu chúng và
        // "CREATE OR REPLACE FUNCTION" của lượt sửa nhận 42501 — hậu điều kiện là lớp duy nhất
        // còn lại.
        await db.pool.query(
          "CREATE OR REPLACE FUNCTION public.audit_compute_hash(p_prev_hash bytea, p_id uuid, " +
            "p_org_id uuid, p_seq bigint, p_occurred_at timestamptz, p_actor_type text, " +
            "p_actor_id uuid, p_action text, p_resource_type text, p_resource_id uuid, " +
            "p_payload jsonb, p_request_id uuid, p_ip inet, p_user_agent text) RETURNS bytea " +
            "LANGUAGE sql IMMUTABLE AS $f$ SELECT sha256(''::bytea) $f$",
        );
        await db.pool.query(
          "CREATE OR REPLACE FUNCTION public.noi_chuoi_kiem_toan() RETURNS trigger " +
            "LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
        );

        const loi = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
        expect(loi, "hai hàm chuỗi bị thay thân mà migrate() vẫn QUA").not.toBeNull();
        expect(loi!.message).toContain("định nghĩa hàm public.audit_compute_hash(...)");
        expect(loi!.message).toContain("định nghĩa hàm public.noi_chuoi_kiem_toan()");
        expect(loi!.message).toContain("Cần quyền");

        // Và trôi vẫn còn NGUYÊN: migrate() gãy chứ không sửa được một nửa rồi im.
        const { rows } = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_proc p WHERE p.proname = 'noi_chuoi_kiem_toan' " +
            "  AND p.proconfig IS NULL",
        );
        expect(rows[0]!.n).toBe("1");
      } finally {
        await poolTrienKhai.end();
      }

      // Đường sửa: một chủ thể CÓ quyền sở hữu chạy migrate() -> tự chữa hết trong một lần.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows: sau } = await db.pool.query<{ proconfig: string[] }>(
        "SELECT p.proconfig FROM pg_proc p WHERE p.proname = 'noi_chuoi_kiem_toan'",
      );
      expect(sau[0]!.proconfig).toEqual(["search_path=pg_catalog"]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [vòng fix 1] BỐN MỤC MỚI: (D1c) audit_append, (D1d) chot_moc_neo, đếm overload, ACL INSERT
  // ==========================================================================================

  /**
   * [vòng fix 1 — CR3] `public.audit_append` là ĐƯỜNG GHI DUY NHẤT của sổ và vòng trước KHÔNG
   * canh nó chút nào. Test dựng lại ĐÚNG payload reviewer đo được: thay hàm bằng một bản
   * plpgsql NUỐT CÓ CHỌN LỌC và trả seq/hash GIẢ nhìn rất thật.
   *
   * Ba vế: (a) fixture thật sự tấn công được; (b) không lớp nào khác của dự án bắt được —
   * verifyAuditChain vẫn xanh trên sổ thiếu sự kiện; (c) lớp C phục hồi ở lần migrate() kế.
   */
  it("[vòng fix 1 — CR3] thay thân audit_append nuốt sự kiện CÓ CHỌN LỌC, và lớp C phục hồi", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const orgId = org[0]!.id;
      // [S1.47 / khoản nợ 87 ⒞] app.org_id đặt ở phạm vi PHIÊN trên chính db.pool rồi migrate() cùng pool ⇒ phiên deploy
      // mang app.org_id ⇒ mục 87 phán (đúng — đo trong lượt evidence S1.47). Deploy thật không đặt GUC ấy; test dùng client
      // riêng và HUỶ nó trước khi trả về pool.
      const ghi = async (hanhDong: string): Promise<void> => {
        const cGhi = await db.pool.connect();
        try {
          await cGhi.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
          await cGhi.query(
            "SELECT * FROM public.audit_append($1, 'SYSTEM', NULL, $2, 'T', NULL, '{}'::jsonb, " +
              "NULL, NULL, NULL)",
            [orgId, hanhDong],
          );
        } finally {
          cGhi.release(true);
        }
      };
      await ghi("BINH_THUONG_1");

      // Kẻ tấn công: cùng chữ ký, ĐỔI NGÔN NGỮ sang plpgsql để có chỗ đặt mệnh đề nuốt.
      await db.pool.query(
        `CREATE OR REPLACE FUNCTION public.audit_append(
           p_org_id uuid, p_actor_type text, p_actor_id uuid, p_action text,
           p_resource_type text, p_resource_id uuid, p_payload jsonb, p_request_id uuid,
           p_ip inet, p_user_agent text)
         RETURNS TABLE (id uuid, seq bigint, prev_hash bytea, hash bytea,
                        occurred_at timestamptz)
         LANGUAGE plpgsql AS $f$
         BEGIN
           IF p_action LIKE 'BI_MAT%' THEN
             -- nuot su kien, tra ve mot ban ghi GIA nhin rat that
             RETURN QUERY SELECT gen_random_uuid(), 999::bigint,
                                 sha256('a'::bytea), sha256('b'::bytea), now();
             RETURN;
           END IF;
           RETURN QUERY
             INSERT INTO public.audit_events (org_id, actor_type, actor_id, action,
                        resource_type, resource_id, payload, request_id, ip, user_agent)
             VALUES (p_org_id, p_actor_type, p_actor_id, p_action, p_resource_type,
                     p_resource_id, coalesce(p_payload, '{}'::jsonb), p_request_id, p_ip,
                     p_user_agent)
             RETURNING audit_events.id, audit_events.seq, audit_events.prev_hash,
                       audit_events.hash, audit_events.occurred_at;
         END $f$`,
      );

      // (a) fixture thật sự tấn công được: người gọi THẤY một lần ghi audit thành công...
      const cNuot = await db.pool.connect();
      try {
        await cNuot.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
        const { rows: nuot } = await cNuot.query<{ seq: string }>(
          "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'BI_MAT_XOA_THAU', 'T', NULL, " +
            "'{}'::jsonb, NULL, NULL, NULL)",
          [orgId],
        );
        expect(nuot[0]!.seq).toBe("999");
      } finally {
        cNuot.release(true); // [S1.47] phiên mang app.org_id không được trở về pool trước migrate()
      }
      // ...trong khi KHÔNG có gì được ghi.
      const { rows: dem } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
        [orgId],
      );
      expect(dem[0]!.n).toBe("1");

      // (b) và ngôn ngữ đã đổi — vế mà một hậu điều kiện chỉ so prosrc sẽ bỏ sót.
      const { rows: ngonNgu } = await db.pool.query<{ lanname: string }>(
        "SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang " +
          " WHERE p.oid = to_regprocedure('public.audit_append(uuid, text, uuid, text, text, " +
          "uuid, jsonb, uuid, inet, text)')",
      );
      expect(ngonNgu[0]!.lanname).toBe("plpgsql");

      // (c) lớp C phục hồi trong một lần migrate().
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows: sau } = await db.pool.query<{ lanname: string; prosrc: string }>(
        "SELECT l.lanname, p.prosrc FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang " +
          " WHERE p.oid = to_regprocedure('public.audit_append(uuid, text, uuid, text, text, " +
          "uuid, jsonb, uuid, inet, text)')",
      );
      expect(sau[0]!.lanname).toBe("sql");
      expect(sau[0]!.prosrc).not.toContain("nuot su kien");
      await ghi("BI_MAT_XOA_THAU");
      const { rows: demSau } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
        [orgId],
      );
      expect(demSau[0]!.n).toBe("2");
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — CR3, QT1 (a)] Đường 42P13 của (D1c). Hàm này RETURNS TABLE, nên prorettype
   * LUÔN là `record` — một vế điều kiện chỉ so prorettype sẽ MÙ với "đổi tên/kiểu cột trả về",
   * và câu CREATE OR REPLACE khi đó ném 42P13. Vế điều kiện thật so cả proargnames.
   */
  it("[vòng fix 1 — CR3] đổi HÌNH DẠNG TRẢ VỀ của audit_append vẫn tự chữa được (không 42P13 kẹt)", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "DROP FUNCTION public.audit_append(uuid, text, uuid, text, text, uuid, jsonb, uuid, " +
          "inet, text)",
      );
      await db.pool.query(
        `CREATE FUNCTION public.audit_append(
           p_org_id uuid, p_actor_type text, p_actor_id uuid, p_action text,
           p_resource_type text, p_resource_id uuid, p_payload jsonb, p_request_id uuid,
           p_ip inet, p_user_agent text)
         RETURNS TABLE (khac_han uuid, so bigint)
         LANGUAGE sql AS $f$ SELECT gen_random_uuid(), 1::bigint $f$`,
      );

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows } = await db.pool.query<{ proargnames: string[] }>(
        "SELECT p.proargnames FROM pg_proc p " +
          " WHERE p.oid = to_regprocedure('public.audit_append(uuid, text, uuid, text, text, " +
          "uuid, jsonb, uuid, inet, text)')",
      );
      expect(rows[0]!.proargnames.slice(-5)).toEqual([
        "id",
        "seq",
        "prev_hash",
        "hash",
        "occurred_at",
      ]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — IM4] (D1d): thân `chot_moc_neo` bị thay bằng "RETURN NEW" trần trả lại đúng
   * bậc tự do mà IM4 vừa đóng — bên ghi chọn được seq/hash của mốc neo.
   */
  it("[vòng fix 1 — IM4] thay thân chot_moc_neo mở lại đường neo giả, và lớp C phục hồi", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const orgId = org[0]!.id;
      // [S1.47 / khoản nợ 87 ⒞] client riêng, huỷ trước migrate() — xem chú thích ở test CR3 ngay trên.
      const cGhi = await db.pool.connect();
      try {
        await cGhi.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
        await cGhi.query(
          "SELECT * FROM public.audit_append($1, 'SYSTEM', NULL, 'X', 'T', NULL, '{}'::jsonb, " +
            "NULL, NULL, NULL)",
          [orgId],
        );
      } finally {
        cGhi.release(true);
      }

      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.chot_moc_neo() RETURNS trigger " +
          "LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
      );
      const { rows: gia } = await db.pool.query<{ seq: string }>(
        "INSERT INTO audit_chain_anchors (org_id, seq, hash) VALUES ($1, 999999, " +
          "sha256('gia'::bytea)) RETURNING seq",
        [orgId],
      );
      expect(gia[0]!.seq, "fixture tự vô hiệu hoá: neo giả không vào được").toBe("999999");

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows: sau } = await db.pool.query<{ proconfig: string[]; prosrc: string }>(
        "SELECT p.proconfig, p.prosrc FROM pg_proc p " +
          " WHERE p.oid = to_regprocedure('public.chot_moc_neo()')",
      );
      expect(sau[0]!.proconfig).toEqual(["search_path=pg_catalog"]);
      expect(sau[0]!.prosrc).toContain("dau_seq");

      // Và đường neo giả đã đóng lại.
      const { rows: lai } = await db.pool.query<{ seq: string }>(
        "INSERT INTO audit_chain_anchors (org_id, seq, hash) VALUES ($1, 888888, " +
          "sha256('gia'::bytea)) RETURNING seq",
        [orgId],
      );
      expect(lai[0]!.seq).toBe("1");
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — M4] F-4 nói đúng điều kiện. Payload là ĐÚNG cái reviewer đo được: một overload
   * CÙNG SỐ THAM SỐ đổi ĐÚNG MỘT KIỂU (text -> varchar) rồi DROP bản chuẩn — hết khớp chính xác
   * nên overload thắng phân giải bằng ép kiểu ngầm.
   */
  it("[vòng fix 1 — M4] overload của audit_compute_hash làm migrate() GÃY ỒN ÀO, và migration mới gỡ được", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "CREATE FUNCTION public.audit_compute_hash(p_prev_hash bytea, p_id uuid, " +
          "p_org_id uuid, p_seq bigint, p_occurred_at timestamptz, p_actor_type varchar, " +
          "p_actor_id uuid, p_action text, p_resource_type text, p_resource_id uuid, " +
          "p_payload jsonb, p_request_id uuid, p_ip inet, p_user_agent text) RETURNS bytea " +
          "LANGUAGE sql IMMUTABLE AS $f$ SELECT sha256('gia'::bytea) $f$",
      );

      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "một overload ép kiểu được sống sót qua deploy trong im lặng").not.toBeNull();
      expect(loi!.message).toContain("không có overload lạ của bốn hàm chuỗi kiểm toán");
      expect(loi!.message).toContain("ĐÚNG 4 hàm");

      // [QT1] Không chặn deploy vĩnh viễn: đường sửa đi được, và nó KHÔNG phải "sửa tay trên
      // cụm" — bản chuẩn vẫn còn nguyên (mục này CỐ Ý không tự chữa, xem [CR4]).
      await db.pool.query(
        "DROP FUNCTION public.audit_compute_hash(bytea, uuid, uuid, bigint, timestamptz, " +
          "varchar, uuid, text, text, uuid, jsonb, uuid, inet, text)",
      );
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — M1] Lớp (A) của Task 6 — "REVOKE INSERT trên ba cột chuỗi" — nay được canh.
   * Trước bản vá, một "GRANT INSERT (seq, prev_hash, hash) TO app_api" SỐNG SÓT MỌI DEPLOY.
   */
  it("[vòng fix 1 — M1] GRANT INSERT trên cột chuỗi bị thu hồi lại ở lần migrate() kế", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "GRANT INSERT (seq, prev_hash, hash) ON audit_events TO app_api",
      );
      await db.pool.query("GRANT INSERT (seq, hash) ON audit_chain_anchors TO app_unseal");

      const demCot = async (): Promise<string> => {
        const { rows } = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_class c " +
            " JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 " +
            " CROSS JOIN LATERAL aclexplode(att.attacl) a " +
            " WHERE c.relname IN ('audit_events','audit_chain_anchors') " +
            "   AND att.attname IN ('seq','prev_hash','hash') AND a.privilege_type = 'INSERT'",
        );
        return rows[0]!.n;
      };
      expect(await demCot(), "fixture tự vô hiệu hoá: GRANT không tạo dòng ACL nào").toBe("5");

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await demCot(), "lớp C phải thu hồi lại quyền INSERT trên ba cột chuỗi").toBe("0");
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — IM5] Sửa chữa không được IM LẶNG. Đòn tấn công nặng nhất vào hệ thống kiểm
   * toán (thay thân hàm băm + ghi lại mọi hash cho khớp) trước bản vá này không để lại tín hiệu
   * ở ĐÂU: migrate() báo MIGRATE OK, không một warning nào, và báo động duy nhất
   * (verifyAuditChain) thì không được gọi ở đâu ngoài test.
   */
  it("[vòng fix 1 — IM5] lượt SỬA phát WARNING nêu ĐÚNG mục đang trôi trước khi tự chữa", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query(
        "CREATE OR REPLACE FUNCTION public.audit_compute_hash(p_prev_hash bytea, p_id uuid, " +
          "p_org_id uuid, p_seq bigint, p_occurred_at timestamptz, p_actor_type text, " +
          "p_actor_id uuid, p_action text, p_resource_type text, p_resource_id uuid, " +
          "p_payload jsonb, p_request_id uuid, p_ip inet, p_user_agent text) RETURNS bytea " +
          "LANGUAGE sql IMMUTABLE AS $f$ SELECT sha256(''::bytea) $f$",
      );

      const poolBat = createPool(db.connectionString, 2);
      const canhBao: string[] = [];
      poolBat.on("connect", (client) => {
        client.on("notice", (thongBao) => {
          if (thongBao.message !== undefined) canhBao.push(thongBao.message);
        });
      });
      try {
        await expect(migrate(poolBat, MIGRATIONS_DIR)).resolves.toEqual([]);
      } finally {
        await poolBat.end();
      }

      const gop = canhBao.join("\n");
      expect(gop, "trôi trên hàm băm mà lượt sửa không nói gì").toContain(
        'mục "định nghĩa hàm public.audit_compute_hash(...)" ở trạng thái SAI TRƯỚC khi sửa',
      );
      // Và thông báo mang CHẨN ĐOÁN thật, không chỉ tên mục — đó là thứ người vận hành cần.
      expect(gop).toContain("prosrc hiện tại");
      // Vế chống rỗng ruột: một mục KHÔNG trôi thì KHÔNG được có warning (nếu không, tín hiệu
      // này chìm trong nhiễu và trở thành vô dụng — đúng chế độ hỏng mà nó sinh ra để đóng).
      expect(gop).not.toContain('mục "định nghĩa hàm public.chot_moc_neo()" ở trạng thái SAI');
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — IM2] BIẾN THỂ IM LẶNG: một bảng trùng tên QUA ĐƯỢC MỌI PHÉP KIỂM của Task 5
   * (có org_id, seq, UNIQUE (org_id, seq), LOGGED). Trước bản vá, migrate() THÀNH CÔNG — không
   * lỗi không warning — rồi mọi INSERT vào bảng đó ném 'record "new" has no field "occurred_at"'
   * VĨNH VIỄN. Đây là chiều hỏng mà [CR4] cấm: migrate() tự tay đổi ngữ nghĩa một bảng.
   */
  it("[vòng fix 1 — IM2] bảng trùng tên QUA MỌI PHÉP KIỂM Task 5 vẫn GHI ĐƯỢC sau migrate() — [S1.41] fixture có org_id ngoài public bị mục 85 NÉM, lượt sửa vẫn trọn", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("CREATE SCHEMA bao_cao");
      await db.pool.query(
        "CREATE TABLE bao_cao.audit_events (id bigserial PRIMARY KEY, " +
          "org_id uuid NOT NULL, seq bigint NOT NULL, UNIQUE (org_id, seq))",
      );

      // ~~migrate() đi qua~~ [S1.41 / khoản nợ 85] kỳ vọng LẬT có chủ đích: bao_cao.audit_events có cột org_id, ngoài
      // public, không treo dưới bảng tenant, không RLS — đúng hình dạng khoản 85 ⇒ NÉM ở ĐÚNG MỘT mục ấy. Lượt SỬA
      // vẫn chạy trọn trước lượt phán xét, nên hai phép đo dưới (ba trigger cưỡng chế, INSERT ghi được) còn nguyên.
      const loiBc = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loiBc, "bảng org_id ngoài public không RLS phải bị khoản 85 bắt").not.toBeNull();
      expect(loiBc!.message).toContain("Hardening không sửa được 1 mục");
      expect(loiBc!.message).toContain("bao_cao.audit_events: bảng có cột org_id ngoài public");

      // Lớp C VẪN cưỡng chế ba trigger chỉ-ghi-thêm cho bảng trùng tên (đó là đánh đổi CÓ CHỦ Ý
      // của việc bỏ khoá cứng nspname='public' — xem BANG_CHI_GHI_THEM)...
      const { rows } = await db.pool.query<{ ten: string }>(
        "SELECT t.tgname AS ten FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          " JOIN pg_namespace n ON n.oid = c.relnamespace " +
          " WHERE n.nspname = 'bao_cao' AND NOT t.tgisinternal ORDER BY 1",
      );
      expect(rows.map((r) => r.ten)).toEqual([
        "audit_events_chan_delete",
        "audit_events_chan_truncate",
        "audit_events_chan_update",
      ]);

      // ...nhưng nó KHÔNG cắm trigger nối chuỗi, nên đường GHI của bảng đó vẫn mở. Trước Task 6
      // bảng này ghi được; sau Task 6 (bản chưa vá) thì không. Bất biến ấy được mua lại ở đây.
      await expect(
        db.pool.query(
          "INSERT INTO bao_cao.audit_events (org_id, seq) VALUES " +
            "('11111111-1111-1111-1111-111111111111'::uuid, 1)",
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [cạm bẫy 6 / quy tắc bắt buộc] MỖI hậu điều kiện mới phải có ĐÚNG MỘT test chạy dưới role
   * deploy mà câu cưỡng chế tương ứng nhận 42501. BỐN mục mới của vòng fix 1 được đóng ở đây:
   * (D1c) audit_append, (D1d) chot_moc_neo, đếm overload, và ACL INSERT theo cột.
   */
  it("[vòng fix 1 — QT1] role deploy không sở hữu: bốn mục MỚI đều làm migrate() GÃY kèm quyền cần có", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Đối chứng: không trôi thì deploy thường vẫn QUA.
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);

        // Bốn đường trôi, mỗi đường một mục. Cả ba hàm do superuser tạo ở lần migrate() đầu nên
        // role deploy không sở hữu chúng -> CREATE OR REPLACE nhận 42501 và hậu điều kiện là
        // lớp DUY NHẤT còn lại. Mục đếm overload thì vốn KHÔNG tự chữa.
        await db.pool.query(
          `CREATE OR REPLACE FUNCTION public.audit_append(
             p_org_id uuid, p_actor_type text, p_actor_id uuid, p_action text,
             p_resource_type text, p_resource_id uuid, p_payload jsonb, p_request_id uuid,
             p_ip inet, p_user_agent text)
           RETURNS TABLE (id uuid, seq bigint, prev_hash bytea, hash bytea,
                          occurred_at timestamptz)
           LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$`,
        );
        await db.pool.query(
          "CREATE OR REPLACE FUNCTION public.chot_moc_neo() RETURNS trigger " +
            "LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
        );
        // Overload: hàm trigger KHÔNG khai tham số được ("trigger functions cannot have
        // declared arguments" — đã đo), nên mũi này dùng `audit_append`, cùng nằm trong bốn tên
        // mà mục đếm canh.
        await db.pool.query(
          "CREATE FUNCTION public.audit_append(uuid) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$",
        );
        // ACL: role deploy KHÔNG sở hữu bảng sổ (postgres tạo), nên REVOKE nhận 42501.
        await db.pool.query("GRANT INSERT (seq) ON audit_events TO app_api");

        const loi = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi, "bốn đường trôi mà migrate() vẫn QUA").not.toBeNull();
        for (const phan of [
          "định nghĩa hàm public.audit_append(...)",
          "định nghĩa hàm public.chot_moc_neo()",
          "không có overload lạ của bốn hàm chuỗi kiểm toán",
          "quyền GHI trên bảng sổ kiểm toán",
          "Cần quyền",
        ]) {
          expect(loi!.message, `thiếu phần "${phan}"`).toContain(phan);
        }
      } finally {
        await poolTrienKhai.end();
      }

      // Đường sửa: một chủ thể CÓ quyền chạy migrate() -> tự chữa hết, trừ overload (cố ý
      // không tự chữa: DROP tự động một hàm không biết là đúng bẫy [CR4]).
      await db.pool.query("DROP FUNCTION public.audit_append(uuid)");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — IM7] BỀ MẶT MỚI CỦA TASK 6: `noi_chuoi_kiem_toan()` lấy một
   * `pg_advisory_xact_lock` khoá theo TỔ CHỨC, phạm vi TRANSACTION. Một phiên bị chiếm mở
   * transaction, ghi một sự kiện, rồi GIỮ — cả tổ chức mất khả năng ghi audit, và dưới G4
   * ("mọi thao tác khoá sinh audit") mất luôn khả năng làm thao tác khoá.
   *
   * Bốn vế:
   *   (a) khoá THẬT SỰ nối tiếp hoá: nạn nhân CÙNG tổ chức bị chặn;
   *   (b) lock_timeout của createPool biến "treo vô hạn" thành một lỗi ồn ào ở đúng dòng khoá;
   *   (c) cô lập xuyên tổ chức GIỮ ĐƯỢC — tổ chức khác ghi bình thường (đúng thiết kế);
   *   (d) migrate() vô hiệu hoá hai timeout cho kết nối của nó rồi TRẢ LẠI trước khi nhả client
   *       — không có vế (d) thì một client mang lock_timeout=0 nằm lại trong pool ứng dụng.
   */
  it("[vòng fix 1 — IM7] khoá tư vấn theo tổ chức: lock_timeout của pool biến treo vô hạn thành lỗi ồn ào", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a'), ('B','b') RETURNING id",
      );
      const orgA = org[0]!.id;
      const orgB = org[1]!.id;

      // (d) nửa đầu: pool ứng dụng mang hai GUC, và migrate() vừa chạy trên chính pool đó
      // KHÔNG được để lại lock_timeout = 0.
      const poolUngDung = createPool(db.connectionString, 4, { lockTimeoutMs: 2_000 });
      try {
        await expect(migrate(poolUngDung, MIGRATIONS_DIR)).resolves.toEqual([]);
        const { rows: guc } = await poolUngDung.query<{ lock_timeout: string }>(
          "SHOW lock_timeout",
        );
        expect(guc[0]!.lock_timeout, "migrate() để lại lock_timeout=0 trên client của pool").toBe(
          "2s",
        );

        // (a) + (b): kẻ chiếm giữ khoá của orgA.
        const keChiem = await poolUngDung.connect();
        try {
          await keChiem.query("BEGIN");
          await keChiem.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
          await keChiem.query(
            "SELECT * FROM public.audit_append($1, 'SYSTEM', NULL, 'CHIEM', 'T', NULL, " +
              "'{}'::jsonb, NULL, NULL, NULL)",
            [orgA],
          );

          const nanNhan = await poolUngDung.connect();
          try {
            await nanNhan.query("BEGIN");
            await nanNhan.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
            const loi = await nanNhan
              .query(
                "SELECT * FROM public.audit_append($1, 'SYSTEM', NULL, 'NAN_NHAN', 'T', NULL, " +
                  "'{}'::jsonb, NULL, NULL, NULL)",
                [orgA],
              )
              .then(() => "THÀNH CÔNG", (e: Error) => e.message);
            expect(loi, "khoá tư vấn không nối tiếp hoá được hai lần ghi cùng tổ chức").toMatch(
              /lock timeout/i,
            );
            await nanNhan.query("ROLLBACK");
          } finally {
            nanNhan.release();
          }

          // (c) tổ chức KHÁC không bị chạm tới.
          const khacToChuc = await poolUngDung.connect();
          try {
            await khacToChuc.query("BEGIN");
            await khacToChuc.query("SELECT set_config('app.org_id', $1, true)", [orgB]);
            const { rows: ok } = await khacToChuc.query<{ seq: string }>(
              "SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'KHAC', 'T', NULL, " +
                "'{}'::jsonb, NULL, NULL, NULL)",
              [orgB],
            );
            expect(ok[0]!.seq).toBe("1");
            await khacToChuc.query("COMMIT");
          } finally {
            khacToChuc.release();
          }

          await keChiem.query("ROLLBACK");
        } finally {
          keChiem.release();
        }
      } finally {
        await poolUngDung.end();
      }
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [vòng fix 1 — IM7, nửa còn lại] `migrate()` PHẢI tự vô hiệu hoá `lock_timeout` trên kết nối
   * của chính nó. Không có dòng đó, hai `migrate()` đồng thời trên một pool mang `lock_timeout`
   * ngắn làm tiến trình thứ hai **huỷ ngay tại `pg_advisory_lock`** — tức bản vá IM7 vừa phá
   * đúng cơ chế chống-đua mà `migrate()` dựa vào từ Task 1.
   *
   * Đo chứ không suy: `lock_timeout` áp CẢ CHO KHOÁ TƯ VẤN (tài liệu nói "table, index, row, or
   * other database object" — "other" ở đây bao gồm advisory lock; test này là phép đo).
   */
  it("[vòng fix 1 — IM7] hai migrate() đồng thời trên pool có lock_timeout ngắn vẫn nối tiếp nhau, không huỷ", async () => {
    const db = await startPostgres();
    try {
      // 200ms: ngắn hơn HẲN một lượt migrate() đầy đủ, nên nếu migrate() không tự vô hiệu hoá
      // nó thì tiến trình thua cuộc CHẮC CHẮN bị huỷ ở pg_advisory_lock.
      const poolA = createPool(db.connectionString, 2, { lockTimeoutMs: 200 });
      const poolB = createPool(db.connectionString, 2, { lockTimeoutMs: 200 });
      try {
        const [a, b] = await Promise.all([
          migrate(poolA, MIGRATIONS_DIR),
          migrate(poolB, MIGRATIONS_DIR),
        ]);
        // Đúng một bên áp dụng bộ migration đánh số; bên kia thấy chúng đã có.
        // [Task 8] 5 = số migration đánh số hiện có. Đọc từ thư mục thay vì ghi cứng: con số
        // này không phải thứ test đang canh (nó canh "đúng MỘT trong hai lượt áp dụng"), nên
        // ghi cứng chỉ làm nó đỏ ở mọi task thêm migration.
        const soMigration = (await readdir(MIGRATIONS_DIR)).filter(
          (f) => f.endsWith(".sql") && !f.endsWith(".always.sql"),
        ).length;
        expect([a.length, b.length].sort((x, y) => x - y)).toEqual([0, soMigration]);
      } finally {
        await poolA.end();
        await poolB.end();
      }
    } finally {
      await db.stop();
    }
  }, 180_000);

  // [CR5 + IM5] Trạng thái VẬT LÝ. Cả hai đường đều tự chữa; cả hai đều không đi qua một trigger
  // nào nên vòng trước hoàn toàn không thấy.
  it("[vòng fix 1 — CR5/IM5] SET UNLOGGED và DROP CONSTRAINT UNIQUE (org_id, seq) đều được phục hồi", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const orgId = org[0]!.id;
      // [Task 6] `chen` tạm gỡ trigger nối chuỗi: nó ghi đè seq vô điều kiện, nên không có nó
      // thì fixture không dựng nổi trạng thái "hai hàng cùng (org_id, seq)" mà test này cần —
      // và cũng không đo được rằng ràng buộc duy nhất đã BIẾN MẤT. Trạng thái trigger được trả
      // lại NGUYÊN VẸN (ENABLE ALWAYS, không phải ENABLE trần) sau mỗi lần chèn.
      const chen = async (seq: number, nhan: string): Promise<string> => {
        await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_noi_chuoi");
        try {
          return await db.pool
            .query(
              "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
                "VALUES ($1, $2, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256($3::bytea))",
              [orgId, seq, nhan],
            )
            .then(() => "THÀNH CÔNG", (e: Error) => e.message);
        } finally {
          await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_noi_chuoi");
        }
      };

      await db.pool.query("ALTER TABLE audit_events SET UNLOGGED");
      await db.pool.query("ALTER TABLE audit_events DROP CONSTRAINT audit_events_org_id_seq_key");
      expect(await chen(1, "a")).toBe("THÀNH CÔNG");
      expect(
        await chen(1, "b"),
        "đột biến không mở được đường nào — ràng buộc duy nhất vẫn còn hiệu lực",
      ).toBe("THÀNH CÔNG");
      const { rows: truoc } = await db.pool.query<{ relpersistence: string }>(
        "SELECT relpersistence FROM pg_class WHERE relname = 'audit_events'",
      );
      expect(truoc[0]!.relpersistence, "fixture tự vô hiệu hoá: bảng vẫn LOGGED").toBe("u");

      // Chuỗi hash đã RẼ NHÁNH: hai hàng cùng (org_id, seq). migrate() phải nói ra chứ không im.
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "hai hàng cùng (org_id, seq) mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("UNIQUE (org_id, seq)");

      // Nhưng LOGGED thì tự chữa được ngay trong chính lần chạy đó — hai chế độ hỏng độc lập.
      const { rows: sau } = await db.pool.query<{ relpersistence: string }>(
        "SELECT relpersistence FROM pg_class WHERE relname = 'audit_events'",
      );
      expect(sau[0]!.relpersistence).toBe("p");

      // Dọn hàng trùng bằng đúng đường mà thông báo ngụ ý (chủ sở hữu tắt trigger, sửa, bật lại)
      // rồi migrate() phải phục hồi nốt ràng buộc duy nhất.
      await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete");
      await db.pool.query(
        "DELETE FROM audit_events a USING audit_events b " +
          " WHERE a.org_id = b.org_id AND a.seq = b.seq AND a.ctid > b.ctid",
      );
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_delete");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      const { rows: con } = await db.pool.query<{ conname: string }>(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'audit_events'::regclass " +
          "  AND contype = 'u'",
      );
      expect(con.map((r) => r.conname)).toEqual(["audit_events_org_id_seq_key"]);
      expect(await chen(1, "c")).toMatch(/duplicate key|unique/i);
    } finally {
      await db.stop();
    }
  }, 180_000);

  // [IM2] Lớp B là lớp DUY NHẤT còn đứng trong đúng cửa sổ phơi mà 003 thừa nhận — và vòng trước
  // là lớp DUY NHẤT không được canh, với một lý do đo được là sai. Test này khẳng định cả hai vế.
  it("[vòng fix 1 — IM2] GRANT UPDATE/DELETE trên bảng sổ bị thu hồi lại ở lần migrate() kế tiếp", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const { rows: org } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('A','a') RETURNING id",
      );
      const orgId = org[0]!.id;
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('x'::bytea))",
        [orgId],
      );

      await db.pool.query("GRANT DELETE, UPDATE ON audit_events TO app_api");
      await db.pool.query("GRANT UPDATE (payload) ON audit_events TO app_unseal");
      await db.pool.query("GRANT TRUNCATE ON audit_chain_anchors TO PUBLIC");

      // Nửa (a): chứng minh lớp B THẬT SỰ đang giữ cửa. Tắt trigger rồi để app_api xoá — nếu
      // lớp B không tồn tại, ba hàng audit bốc hơi. Đây chính là phép đo bác bỏ "lớp REVOKE chỉ
      // mua một câu lệnh dừng sớm hơn".
      const apiPool = db.poolAs("app_api");
      const con = await apiPool.connect();
      try {
        await con.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
        await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete");
        const xoaDuoc = await con
          .query("DELETE FROM audit_events")
          .then((r) => `DELETE ${r.rowCount}`, (e: Error) => e.message);
        expect(
          xoaDuoc,
          "fixture tự vô hiệu hoá: GRANT không mở được đường nào ngay cả khi trigger đã tắt",
        ).toBe("DELETE 1");
      } finally {
        con.release();
      }
      // Dựng lại một hàng để phần sau còn đo được.
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_delete");
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 2, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00',32),'hex'), sha256('y'::bytea))",
        [orgId],
      );

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows } = await db.pool.query<{ ai: string; quyen: string; cot: string | null }>(
        "SELECT coalesce(vai.rolname::text, 'PUBLIC') AS ai, a.privilege_type AS quyen, " +
          "       NULL::text AS cot " +
          "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
          "  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a " +
          "  LEFT JOIN pg_roles vai ON vai.oid = a.grantee " +
          " WHERE n.nspname = 'public' " +
          "   AND c.relname IN ('audit_events','audit_chain_anchors') " +
          "   AND a.grantee <> c.relowner " +
          "   AND a.privilege_type IN ('UPDATE','DELETE','TRUNCATE') " +
          "UNION ALL " +
          "SELECT coalesce(vai.rolname::text, 'PUBLIC'), a.privilege_type, att.attname " +
          "  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
          "  JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 " +
          "                       AND NOT att.attisdropped " +
          "  CROSS JOIN LATERAL aclexplode(att.attacl) a " +
          "  LEFT JOIN pg_roles vai ON vai.oid = a.grantee " +
          " WHERE n.nspname = 'public' " +
          "   AND c.relname IN ('audit_events','audit_chain_anchors') " +
          "   AND a.grantee <> c.relowner AND a.privilege_type = 'UPDATE'",
      );
      expect(rows).toEqual([]);

      // Và không thu hồi quá tay: INSERT theo cột của app_api trên payload phải còn nguyên.
      const { rows: conLai } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_attribute att " +
          "  CROSS JOIN LATERAL aclexplode(att.attacl) a " +
          "  JOIN pg_roles vai ON vai.oid = a.grantee " +
          " WHERE att.attrelid = 'audit_events'::regclass AND att.attname = 'payload' " +
          "   AND vai.rolname = 'app_api' AND a.privilege_type = 'INSERT'",
      );
      expect(conLai[0]!.n).toBe("1");
    } finally {
      await db.stop();
    }
  }, 120_000);

  // ==========================================================================================
  // VÒNG FIX 2
  // ==========================================================================================

  // [vòng fix 2 — CR1] Vòng 1 tuyên bố bất biến "lượt SỬA không gãy" ở PHẠM VI TỆP nhưng chỉ cài
  // đặt nó ở BƯỚC 2; BƯỚC 0/1/1b vẫn chỉ nuốt 42501 và nằm trong CÙNG transaction, nên chúng tái
  // tạo NGUYÊN VẸN ngõ cụt CR3. Mũi này nhắm thẳng vào BƯỚC 1: "REVOKE <nhóm> FROM <thành viên>"
  // ném 2BP01 (dependent privileges exist) khi thành viên đã CẤP TIẾP nhóm đó. Trước vá, đo được
  // migrate() chết ở LƯỢT SỬA và 004_*.sql không bao giờ chạy tới (count = 0).
  it("[vòng fix 2 — CR1] lỗi 2BP01 ở BƯỚC 1 vẫn để migration đánh số chạy tới đích", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-f2cr1-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_audit_events.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);

      await db.pool.query("CREATE ROLE nhom_la NOLOGIN");
      await db.pool.query("CREATE ROLE ke_ba NOLOGIN");
      await db.pool.query("GRANT nhom_la TO app_api WITH ADMIN OPTION");
      await db.pool.query("SET ROLE app_api; GRANT nhom_la TO ke_ba; RESET ROLE");

      // Nửa "fixture cũng phải chịu đột biến": nếu app_api KHÔNG cấp tiếp được thì câu REVOKE của
      // BƯỚC 1 chẳng ném gì và cả test này chỉ chứng minh một đường không tồn tại.
      const { rows: phuThuoc } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_auth_members am " +
          "  JOIN pg_roles g ON g.oid = am.grantor JOIN pg_roles m ON m.oid = am.member " +
          " WHERE g.rolname = 'app_api' AND m.rolname = 'ke_ba'",
      );
      expect(
        phuThuoc[0]!.n,
        "fixture tự vô hiệu hoá: app_api chưa cấp tiếp nhóm nào nên REVOKE không thể ném 2BP01",
      ).toBe("1");

      await writeFile(
        join(thuMucTam, "004_moc_buoc1.sql"),
        "CREATE TABLE moc_buoc1 (id int PRIMARY KEY);\n",
        "utf8",
      );
      const loi = await migrate(db.pool, thuMucTam).then(() => null, (e: Error) => e);
      expect(loi, "membership lạ còn nguyên mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain("phan_xet");
      expect(loi!.message).toContain("tư cách thành viên LẠ");

      const { rows: moc } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_class WHERE relname = 'moc_buoc1'",
      );
      expect(
        moc[0]!.n,
        "một lỗi KHÁC 42501 ở BƯỚC 1 đã kéo migrate() chết TRƯỚC vòng migration đánh số — " +
          "đường vá bằng migration mới không tới được",
      ).toBe("1");

      // Đường thoát QT1, đo chứ không suy: chỉ CASCADE gỡ được nút. "REVOKE ... FROM ke_ba" chạy
      // dưới role deploy là no-op im lặng (grantor là app_api), và "GRANTED BY app_api" bị từ chối
      // ("permission denied to revoke privileges granted by role").
      await writeFile(
        join(thuMucTam, "005_go_nhom_la.sql"),
        "REVOKE nhom_la FROM app_api CASCADE;\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["005_go_nhom_la.sql"]);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // [vòng fix 2 — I1] Mặc định-ĐÓNG của CR1 gỡ trigger lạ khỏi bảng sổ, và trước vòng này nó làm
  // thế trong IM LẶNG: một 004_*.sql tạo trigger hợp lệ cho Task 6 sẽ bị lượt sửa kế tiếp gỡ mất,
  // migrate() báo MIGRATE OK, và vì 004 đã nằm trong schema_migrations nên migration đó bốc hơi
  // VĨNH VIỄN. Đúng chế độ hỏng mà CR4 vừa bị xử, theo chiều ngược lại — gỡ một trigger khỏi sổ
  // kiểm toán vừa là bản vá vừa là SỰ KIỆN AN NINH.
  // Nửa thứ hai canh bộ lọc `tgparentid = 0`: bản sao trigger trên PHÂN MẢNH phải được để yên, vì
  // DROP TRIGGER trên nó ném 2BP01 — tức bỏ bộ lọc là tự tái tạo bẫy CR3. Trước vòng này chính bộ
  // lọc ấy KHÔNG có test nào canh (đột biến X2 sống sót).
  it("[vòng fix 2 — I1] gỡ trigger/rule lạ khỏi bảng sổ luôn ỒN ÀO, và bản sao trigger phân mảnh được để yên — [S1.41] fixture kho.* có org_id ngoài public bị mục 85 NÉM, lượt sửa vẫn trọn", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);

      // (a) đúng hình dạng một migration hợp lệ của Task 6.
      await db.pool.query(
        "CREATE FUNCTION public.neo_chuoi() RETURNS trigger LANGUAGE plpgsql AS " +
          "$f$ BEGIN RETURN NEW; END $f$",
      );
      await db.pool.query(
        "CREATE TRIGGER audit_events_neo_chuoi BEFORE INSERT ON audit_events FOR EACH ROW " +
          "EXECUTE FUNCTION public.neo_chuoi()",
      );
      await db.pool.query("CREATE RULE r_la AS ON UPDATE TO audit_chain_anchors DO INSTEAD NOTHING");

      // (b) một bảng TRÙNG TÊN là PHÂN MẢNH của bảng khác: bản sao trigger mang tgparentid <> 0.
      await db.pool.query(
        "CREATE FUNCTION public.nuot_la() RETURNS trigger LANGUAGE plpgsql AS " +
          "$f$ BEGIN RETURN NULL; END $f$",
      );
      await db.pool.query("CREATE SCHEMA kho");
      await db.pool.query(
        "CREATE TABLE kho.cha (org_id uuid NOT NULL, seq bigint NOT NULL) PARTITION BY RANGE (seq)",
      );
      await db.pool.query(
        "CREATE TABLE kho.audit_events PARTITION OF kho.cha FOR VALUES FROM (1) TO (1000)",
      );
      await db.pool.query(
        "CREATE TRIGGER cha_nuot BEFORE INSERT ON kho.cha FOR EACH ROW " +
          "EXECUTE FUNCTION public.nuot_la()",
      );
      // Nửa đối chứng: một trigger lạ THẬT (tgparentid = 0) trên chính bảng phân mảnh đó — nếu nó
      // cũng sống sót thì test chỉ chứng minh vế trigger lạ đã tắt, không chứng minh gì khác.
      await db.pool.query(
        "CREATE TRIGGER la_that BEFORE INSERT ON kho.audit_events FOR EACH ROW " +
          "EXECUTE FUNCTION public.nuot_la()",
      );

      const poolBat = createPool(db.connectionString, 2);
      const canhBao: string[] = [];
      poolBat.on("connect", (client) => {
        client.on("notice", (thongBao) => {
          if (thongBao.message !== undefined) canhBao.push(thongBao.message);
        });
      });
      try {
        // ~~migrate() đi qua~~ [S1.41 / khoản nợ 85] kỳ vọng LẬT có chủ đích: kho.cha và kho.audit_events có cột org_id,
        // ngoài public, không treo dưới bảng tenant, không RLS — đúng hình dạng khoản 85 ⇒ NÉM ở ĐÚNG MỘT mục ấy.
        // Lượt SỬA vẫn chạy trọn trước lượt phán xét, nên mọi phép đo dưới đây (thông báo, trigger, INSERT) còn nguyên.
        const loiKho = await migrate(poolBat, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
        expect(loiKho, "bảng org_id ngoài public không RLS phải bị khoản 85 bắt").not.toBeNull();
        expect(loiKho!.message).toContain("Hardening không sửa được 1 mục");
        expect(loiKho!.message).toContain("kho.cha: bảng có cột org_id ngoài public");
        expect(loiKho!.message).toContain("kho.audit_events: bảng có cột org_id ngoài public");
      } finally {
        await poolBat.end();
      }

      const gop = canhBao.join("\n");
      expect(gop, "gỡ một trigger khỏi sổ kiểm toán mà không nói gì").toContain(
        "đã GỠ trigger lạ audit_events_neo_chuoi trên audit_events",
      );
      expect(gop).toContain("đã GỠ rule lạ r_la trên audit_chain_anchors");
      expect(gop).toContain("đã GỠ trigger lạ la_that trên kho.audit_events");

      const { rows: conLaiPm } = await db.pool.query<{ ten: string; cha: string }>(
        "SELECT t.tgname AS ten, t.tgparentid::text AS cha FROM pg_trigger t " +
          " WHERE t.tgrelid = 'kho.audit_events'::regclass AND NOT t.tgisinternal ORDER BY 1",
      );
      expect(
        conLaiPm.map((r) => r.ten),
        "bản sao trigger phân mảnh phải được để yên: DROP TRIGGER trên nó ném 2BP01",
      ).toEqual([
        "audit_events_chan_delete",
        "audit_events_chan_truncate",
        "audit_events_chan_update",
        // [vòng fix 1 — IM2] `audit_events_noi_chuoi` KHÔNG còn ở đây, và đó là bản vá.
        // Bản trước khoá vế lọc theo `relname IN ('audit_events')` trong khi `bang_al` CỐ Ý
        // nhận bảng ở MỌI schema, nên lớp C tự cắm trigger nối chuỗi lên bảng này — một bảng
        // chỉ có (org_id, seq). Hệ quả đo được: INSERT vào nó ném 'record "new" has no field
        // "prev_hash"' VĨNH VIỄN, trong khi migrate() báo OK. Trước Task 6 bảng trùng tên chỉ
        // bị chặn UPDATE/DELETE/TRUNCATE — INSERT vẫn chạy. Nay vế lọc là VỊ TỪ HÌNH DẠNG
        // (đủ 15 cột của sổ), nên bảng này không lọt.
        "cha_nuot",
      ]);

      // Vế ĐO, không phải vế suy: câu INSERT vào bảng trùng tên khác hình dạng KHÔNG còn ném
      // lỗi hình dạng sau migrate(). (rowCount là 0 vì chính fixture cắm `cha_nuot` RETURN NULL
      // lên bảng cha — đó là thứ test này đang bảo toàn, không phải thứ nó đang đo. Điều đang
      // đo là KHÔNG CÓ 'record "new" has no field ...'.)
      const loiChen = await db.pool
        .query(
          "INSERT INTO kho.audit_events (org_id, seq) VALUES " +
            "('11111111-1111-1111-1111-111111111111'::uuid, 1)",
        )
        .then(() => null, (e: Error) => e.message);
      expect(loiChen, "bảng trùng tên KHÁC hình dạng bị lớp C khoá ghi vĩnh viễn").toBeNull();
      expect(conLaiPm.find((r) => r.ten === "cha_nuot")!.cha).not.toBe("0");

      const { rows: daGo } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t " +
          " WHERE t.tgrelid = 'audit_events'::regclass AND t.tgname = 'audit_events_neo_chuoi'",
      );
      expect(daGo[0]!.n).toBe("0");
    } finally {
      await db.stop();
    }
  }, 180_000);

  // [vòng fix 2 — I2] Mục (D4) — thứ vừa sinh ra ở vòng 1 để canh ACL — mang vào đúng cái lớp
  // "lớp C tự khoá mình lại" mà CR3 vừa phải gỡ: thiếu CASCADE thì một tác nhân TRONG mô hình
  // khoá được deploy bằng MỘT câu lệnh, và vòng lặp không bao giờ tháo được nút vì "REVOKE ...
  // FROM ben_thu_ba" chạy dưới role deploy là NO-OP IM LẶNG (grantor là app_api).
  it("[vòng fix 2 — I2] GRANT OPTION rồi cấp tiếp vẫn được mục (D4) tự chữa", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      await db.pool.query("CREATE ROLE ben_thu_ba NOLOGIN");
      await db.pool.query("GRANT UPDATE ON audit_events TO app_api WITH GRANT OPTION");
      await db.pool.query("SET ROLE app_api; GRANT UPDATE ON audit_events TO ben_thu_ba; RESET ROLE");
      // Nhánh MỨC CỘT phải đi qua một role KHÔNG có quyền mức bảng, nếu không nó không đo được
      // gì: đo được rằng "REVOKE UPDATE ... ON <bảng> FROM app_api CASCADE" ở mức BẢNG cuốn theo
      // luôn cả quyền UPDATE mức CỘT của app_api lẫn dòng cấp tiếp dẫn xuất từ nó — tức nhánh cột
      // bị nhánh bảng che. app_unseal chỉ được cấp ở mức cột nên nó tách hai nhánh ra.
      await db.pool.query("GRANT UPDATE (action) ON audit_events TO app_unseal WITH GRANT OPTION");
      await db.pool.query(
        "SET ROLE app_unseal; GRANT UPDATE (action) ON audit_events TO ben_thu_ba; RESET ROLE",
      );

      // Fixture phải THẬT SỰ dựng được thế bí: phải tồn tại dòng ACL do app_api/app_unseal cấp
      // tiếp, ở CẢ HAI mức.
      const { rows: truoc } = await db.pool.query<{ muc: string; n: string }>(
        "SELECT 'bang' AS muc, count(*)::text AS n FROM pg_class c " +
          "  CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles g ON g.oid = a.grantor " +
          " WHERE c.oid = 'audit_events'::regclass AND g.rolname = 'app_api' " +
          "UNION ALL " +
          "SELECT 'cot', count(*)::text FROM pg_attribute att " +
          "  CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles g ON g.oid = a.grantor " +
          " WHERE att.attrelid = 'audit_events'::regclass AND att.attname = 'action' " +
          "   AND g.rolname = 'app_unseal'",
      );
      expect(
        truoc,
        "fixture tự vô hiệu hoá: không có quyền nào được cấp tiếp nên REVOKE không ném 2BP01",
      ).toEqual([
        { muc: "bang", n: "1" },
        { muc: "cot", n: "1" },
      ]);

      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      const { rows: quyenConSai } = await db.pool.query<{ ai: string; quyen: string }>(
        "SELECT coalesce(vai.rolname::text, 'PUBLIC') AS ai, a.privilege_type AS quyen " +
          "  FROM pg_class c " +
          "  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a " +
          "  LEFT JOIN pg_roles vai ON vai.oid = a.grantee " +
          " WHERE c.oid = 'audit_events'::regclass AND a.grantee <> c.relowner " +
          "   AND a.privilege_type IN ('UPDATE','DELETE','TRUNCATE') " +
          "UNION ALL " +
          "SELECT coalesce(vai.rolname::text, 'PUBLIC'), a.privilege_type FROM pg_attribute att " +
          "  CROSS JOIN LATERAL aclexplode(att.attacl) a " +
          "  LEFT JOIN pg_roles vai ON vai.oid = a.grantee " +
          " WHERE att.attrelid = 'audit_events'::regclass AND att.attnum > 0 " +
          "   AND a.privilege_type = 'UPDATE'",
      );
      expect(
        quyenConSai,
        "quyền cấp tiếp cho bên thứ ba vẫn còn — vòng lặp (D4) không tháo được nút",
      ).toEqual([]);

      // Không thu hồi quá tay, và lần chạy kế tiếp vẫn sạch (idempotent).
      const { rows: insConLai } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_attribute att " +
          "  CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles vai ON vai.oid = a.grantee " +
          " WHERE att.attrelid = 'audit_events'::regclass AND att.attname = 'payload' " +
          "   AND vai.rolname = 'app_api' AND a.privilege_type = 'INSERT'",
      );
      expect(insConLai[0]!.n).toBe("1");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    } finally {
      await db.stop();
    }
  }, 120_000);

  // [vòng fix 2 — I3] Bỏ khoá cứng nspname='public' (CR2a) làm `bang_so` nhận bảng ở MỌI schema,
  // nên một thông báo gọi bảng bằng relname trần trở thành CÂU ĐỐ: người trực đêm đọc
  // "audit_events.audit_events_chan_update: trigger KHÔNG TỒN TẠI" trong khi bảng đang sai nằm ở
  // một schema khác. Đây là thông báo của một deploy ĐANG BỊ CHẶN, nên nó phải nói đúng bảng nào.
  it("[vòng fix 2 — I3] thông báo của lớp C gọi bảng sổ bằng tên ĐỦ SCHEMA", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);

        await db.pool.query("CREATE ROLE nguoi_khac NOLOGIN");
        await db.pool.query("CREATE SCHEMA bao_cao AUTHORIZATION nguoi_khac");
        await db.pool.query(
          "CREATE TABLE bao_cao.audit_events (id int PRIMARY KEY, org_id uuid, seq bigint)",
        );
        await db.pool.query("ALTER TABLE bao_cao.audit_events OWNER TO nguoi_khac");

        const loi = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
        expect(loi, "một bảng tên audit_events ở schema lạ mà migrate() vẫn QUA").not.toBeNull();
        expect(
          loi!.message,
          "thông báo không nói bảng nào — chữ bao_cao không xuất hiện ở đâu cả",
        ).toContain("bao_cao.audit_events.audit_events_chan_update");
        expect(loi!.message).toContain("bao_cao.audit_events: thiếu ràng buộc UNIQUE");
        // Bảng sổ THẬT trong public vẫn được gọi bằng tên trần (search_path đã ghim), nên thông
        // báo không dài thêm cho ca thường.
        expect(loi!.message).not.toContain("public.audit_events");
      } finally {
        await poolTrienKhai.end();
      }

      // QT1 cho ca này, đo chứ không suy: role deploy KHÔNG sở hữu bao_cao nên không có đường sửa
      // nào từ trong database — cần một chủ thể sở hữu schema đó (hoặc superuser) gỡ bảng đi.
      await db.pool.query("DROP TABLE bao_cao.audit_events");
      const poolSauSua = createPool(csTrienKhai, 2);
      try {
        await expect(migrate(poolSauSua, MIGRATIONS_DIR)).resolves.toEqual([]);
      } finally {
        await poolSauSua.end();
      }
    } finally {
      await db.stop();
    }
  }, 180_000);

  /**
   * [Task 6 — vòng fix 2 — I1] VỊ TỪ HÌNH DẠNG BIẾN TRÔI FAIL-CLOSED THÀNH FAIL-OPEN.
   *
   * Bản vá IM2 của vòng fix 1 đổi vế lọc của `can_co` từ TÊN BẢNG sang HÌNH DẠNG (đủ 15 tên
   * cột). Điều đó đóng bẫy [CR4] theo một chiều và mở nó theo chiều kia: đổi tên hoặc xoá MỘT
   * trong 15 cột làm `public.audit_events` rớt khỏi `can_co`, nên lớp C không dựng lại trigger
   * nối chuỗi nữa — và migrate() báo "MIGRATE OK []", không lỗi không warning.
   *
   * Test này đo BA điều, và điều thứ hai là điều dễ nói quá nhất nên nó được đo tường minh:
   *   (a) migrate() nay GÃY ỒN ÀO, nêu đúng cột nào thiếu;
   *   (b) mục (D5) KHÔNG đóng cửa sổ phơi — trong cửa sổ đó bên ghi VẪN tự chọn được
   *       seq/prev_hash/hash. Nó chỉ biến "im lặng vĩnh viễn" thành "ồn ào ngay lần deploy này";
   *   (c) và nó KHÔNG tự sửa lược đồ (bẫy [CR4]) — đường sửa là một migration đánh số MỚI, thứ
   *       chạy TRƯỚC lượt phán xét nên vá xong trong CÙNG một lần deploy.
   */
  it("[Task 6 — vòng fix 2 — I1] đổi tên cột bảng sổ làm migrate() GÃY ỒN ÀO, và migration mới vá trong CÙNG lần deploy", async () => {
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-t6-hinhdang-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
        "003_audit_events.sql",
        "004_audit_chain_functions.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await migrate(db.pool, thuMucTam);
      const { rows: toChuc } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('T6', 't6') RETURNING id",
      );
      const org = toChuc[0]!.id;

      // Tác nhân: chủ sở hữu bảng. Hai câu này là toàn bộ cú tấn công.
      await db.pool.query("ALTER TABLE audit_events RENAME COLUMN user_agent TO ua");
      await db.pool.query("DROP TRIGGER audit_events_noi_chuoi ON audit_events");

      const loi = await migrate(db.pool, thuMucTam).then(
        () => null,
        (e: Error) => e,
      );
      expect(
        loi,
        "đổi tên MỘT cột làm bảng sổ mất lớp nối chuỗi mà migrate() vẫn báo OK",
      ).not.toBeNull();
      expect(loi!.message).toContain("hình dạng cột của bảng sổ chính tắc");
      expect(loi!.message).toContain(
        "public.audit_events: hình dạng cột đã TRÔI — thiếu {user_agent}",
      );

      // (b) Cửa sổ phơi CÓ THẬT và (D5) không đóng nó — nói ra thay vì để người đọc suy.
      const { rows: hangGia } = await db.pool.query<{ seq: string }>(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 500, 'SYSTEM', 'KHONG_NOI_CHUOI', 'T', sha256('bia'::bytea), " +
          "sha256('dat'::bytea)) RETURNING seq",
        [org],
      );
      expect(
        Number(hangGia[0]!.seq),
        "trigger đã bị gỡ nên bên ghi tự chọn seq — (D5) là PHÁT HIỆN, không phải ngăn chặn",
      ).toBe(500);

      // (c) KHÔNG tự sửa lược đồ.
      const { rows: conUa } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_attribute " +
          " WHERE attrelid = 'public.audit_events'::regclass AND attname = 'ua' " +
          "   AND attnum > 0 AND NOT attisdropped",
      );
      expect(conUa[0]!.n, "mục (D5) TỰ SỬA lược đồ — đúng bẫy [CR4]").toBe("1");

      // QT1: migration đánh số mới, vá trong CÙNG một lần migrate().
      await writeFile(
        join(thuMucTam, "005_tra_lai_ten_cot.sql"),
        "ALTER TABLE audit_events RENAME COLUMN ua TO user_agent;\n",
        "utf8",
      );
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual(["005_tra_lai_ten_cot.sql"]);

      const { rows: tg } = await db.pool.query<{ tgname: string; tgenabled: string }>(
        "SELECT t.tgname, t.tgenabled FROM pg_trigger t " +
          " WHERE t.tgrelid = 'public.audit_events'::regclass AND NOT t.tgisinternal " +
          " ORDER BY 1",
      );
      expect(tg.map((r) => r.tgname)).toContain("audit_events_noi_chuoi");
      expect(tg.every((r) => r.tgenabled === "A")).toBe(true);

      // Và đường ghi đóng lại: bên ghi không chọn được seq nữa.
      const { rows: sauVa } = await db.pool.query<{ seq: string }>(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          "VALUES ($1, 9000, 'SYSTEM', 'DA_NOI_LAI', 'T', sha256('x'::bytea), " +
          "sha256('y'::bytea)) RETURNING seq",
        [org],
      );
      expect(Number(sauVa[0]!.seq)).toBe(501);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  /**
   * [Task 6 — vòng fix 2 — I1] Ba vế còn lại của mục (D5), gộp một container:
   *   (a) bảng MỐC NEO cùng khuôn — đổi tên `anchored_at` cũng gãy ồn ào;
   *   (b) THÊM cột thì AN TOÀN (vị từ đếm sự CÓ MẶT của 15 tên, không đếm tổng số cột) — đây là
   *       ranh giới của bảo đảm, viết ra để không ai đọc rộng hơn;
   *   (c) hai đường nâng cấp 001/002 và 001/002/003 vẫn QUA — hậu điều kiện mới có tiền điều
   *       kiện `to_regclass(...) IS NOT NULL`, và đó đúng là chỗ mục (D1c) của vòng trước đã vấp.
   */
  it("[Task 6 — vòng fix 2 — I1 · S1.20] (D5): bảng neo cùng khuôn, ~~THÊM cột thì an toàn~~ THÊM cột thì hardening KÊU chứ không HỎNG, hai đường nâng cấp vẫn QUA", async () => {
    const db = await startPostgres();
    const d12 = await mkdtemp(join(tmpdir(), "tp-t6-d12-"));
    const d123 = await mkdtemp(join(tmpdir(), "tp-t6-d123-"));
    try {
      // (c) hai đường nâng cấp
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(d12, f));
        await copyFile(join(MIGRATIONS_DIR, f), join(d123, f));
      }
      await copyFile(
        join(MIGRATIONS_DIR, "003_audit_events.sql"),
        join(d123, "003_audit_events.sql"),
      );
      await expect(migrate(db.pool, d12), "chưa có bảng sổ mà (D5) đã phán xét").resolves.toEqual([
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]);
      await expect(migrate(db.pool, d123), "có 003 chưa có 004 mà (D5) gãy").resolves.toEqual([
        "003_audit_events.sql",
      ]);
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([
        "004_audit_chain_functions.sql",
        "005_identity.sql",
        "006_sessions_and_mfa.sql",
        "007_outbox.sql",
        "008_suppliers.sql",
        "009_rfq.sql",
        "010_invitations.sql",
        "011_rfq_hardening.sql",
        "012_invitation_hardening.sql",
        "013_actor_from_session.sql",
        "014_procurement_policy.sql",
        "015_otp_pepper.sql",
        "016_rfq_actor_from_session.sql",
        "017_rfq_key_material.sql",
        "018_vendor_bids.sql",
        "019_unseal.sql",
        "020_comparison.sql",
        "021_ciphertext_audit.sql",
        "022_security_review_s1.sql",
        "023_rfq_open_cancel_permissions.sql",
        "024_moi_lai_va_tran_chi_phi.sql",
        "025_worker_doc_hang_doi.sql",
        "026_xoa_mat_ma_vat_lieu_khoa.sql",
        "027_phien_khach_co_lap.sql",
        "028_khoa_cong_khai_cho_khach.sql",
        "029_dang_nhap_nguoi_mua.sql",
        "030_policy_manage.sql",
        "031_ghi_danh_lai_totp.sql",
        "032_khoa_ho_so_totp_da_xac_nhan.sql",
        "033_policy_manage_khong_cung_tay.sql",
        "034_dinh_chi_thu_hoi_phien.sql",
        "035_phien_ban_chinh_sach_lien_tuc.sql",
        "036_loi_moi_contact_thuoc_supplier.sql",
        "037_vai_ung_dung_la_thanh_vien.sql",
        "038_han_muc_nguoi_goi_dang_nhap.sql",
        "039_phien_can_totp_gan_day.sql",
        "040_dat_lai_totp_hai_nguoi.sql",
        "041_outbox_payload_dang_nhap_xoa_sau_xong.sql",
        "042_bucket_nguoi_goi_toan_cuc.sql",
        "043_danh_tinh_theo_phien_enable_always.sql",
        "044_don_bucket_otp.sql",
        "045_trigger_con_lai_enable_always.sql",
        "046_chi_so_cua_so_otp.sql",
        "047_chi_ghi_them_chan_truncate.sql",
        "048_email_nguoi_dung_chu_thuong.sql",
      ]);

      // ~~(b) THÊM cột: an toàn, và trigger nối chuỗi vẫn ở nguyên chỗ.~~
      //
      // [S1.20 / sổ nợ 16] **CÂU VỪA GẠCH ĐÚNG MỘT NỬA, VÀ NỬA KIA LÀ MỘT LỖ.** Nó đúng ở tầng nó
      // được viết ra để đo: vị từ hình dạng (`MAU_HINH_DANG_SO`) là một phép ĐẾM, nên thêm cột
      // không làm hardening tưởng đây là bảng khác và không làm nó cắm/gỡ trigger sai — đó là
      // `[CR4]`, và vế ấy VẪN ĐÚNG (khẳng định trigger bên dưới không đổi một chữ).
      //
      // Nhưng nó bị ĐỌC như *"thêm cột vào sổ kiểm toán là chuyện an toàn"*, và câu đó SAI:
      // `noi_chuoi_kiem_toan()` băm ĐÚNG 15 trường, nên **mọi cột thứ 16 là nội dung sống trong sổ
      // mà chuỗi hash KHÔNG phủ** — sửa nó không làm chuỗi gãy và `verifyAuditChain` không thấy gì.
      // Đo được trước S1.20: `ALTER TABLE audit_events ADD COLUMN payload_plaintext text` →
      // `MIGRATE OK`, `applied=[]`, không mục nào chạm. Cái tên ấy là đúng hình dạng của **A2**.
      //
      // NAY: thêm cột KHÔNG làm hardening HỎNG — nó làm hardening **KÊU**. Hai vế được đo riêng.
      await db.pool.query("ALTER TABLE audit_events ADD COLUMN ghi_chu text");
      const loiCotThua = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loiCotThua, "cột ngoài chuỗi hash mà migrate() vẫn QUA").not.toBeNull();
      expect(loiCotThua!.message).toContain(
        "public.audit_events: có cột NGOÀI chuỗi hash — {ghi_chu}",
      );
      // Và vế S0 vẫn đứng: hardening KHÔNG cắm/gỡ trigger sai vì một cột lạ.
      const { rows: tg } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t " +
          " WHERE t.tgrelid = 'public.audit_events'::regclass AND NOT t.tgisinternal " +
          "   AND t.tgname = 'audit_events_noi_chuoi'",
      );
      expect(tg[0]!.n).toBe("1");
      await db.pool.query("ALTER TABLE audit_events DROP COLUMN ghi_chu");
      // Đối chứng dương: gỡ cột xong thì deploy đi qua lại ngay.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);

      // (a) bảng MỐC NEO cùng khuôn.
      await db.pool.query("ALTER TABLE audit_chain_anchors RENAME COLUMN anchored_at TO neo_luc");
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "đổi tên cột bảng neo mà migrate() vẫn QUA").not.toBeNull();
      expect(loi!.message).toContain(
        "public.audit_chain_anchors: hình dạng cột đã TRÔI — thiếu {anchored_at}",
      );
      await db.pool.query("ALTER TABLE audit_chain_anchors RENAME COLUMN neo_luc TO anchored_at");
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
    } finally {
      await rm(d12, { recursive: true, force: true });
      await rm(d123, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);

  // ==========================================================================================
  // [Task 8] HAI MỤC MỚI CỦA NHÓM (E): hàm + trigger phân tách nhiệm vụ (D3).
  //
  // Cả hai mục canh CÙNG MỘT bất biến ở hai tầng, và cả hai đều là "trigger được tạo MỘT LẦN
  // trong một migration đánh số" — đúng lớp trôi mà nhóm (D) của Task 5/6 đã mô tả. Bốn đường
  // trôi đã biết, và test dưới đây đi hết cả bốn cho từng tầng.
  // ==========================================================================================

  it("[Task 8 — (E1)/(E2)] bốn đường trôi của trigger D3 đều được lượt SỬA dựng lại", async () => {
    await withMigratedDatabase(async (db) => {
      const cacCa: [string, string][] = [
        ["DROP TRIGGER", "DROP TRIGGER user_roles_phan_tach_nhiem_vu ON public.user_roles"],
        [
          "DISABLE TRIGGER",
          "ALTER TABLE public.user_roles DISABLE TRIGGER user_roles_phan_tach_nhiem_vu",
        ],
        [
          "hạ ENABLE ALWAYS xuống ORIGIN",
          "ALTER TABLE public.user_roles ENABLE TRIGGER user_roles_phan_tach_nhiem_vu",
        ],
        [
          "thay THÂN hàm thành no-op",
          "CREATE OR REPLACE FUNCTION public.kiem_tra_phan_tach_nhiem_vu() RETURNS trigger " +
            "LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$",
        ],
        [
          "thay THÂN hàm ma trận thành no-op",
          "CREATE OR REPLACE FUNCTION public.kiem_tra_ma_tran_quyen() RETURNS trigger " +
            "LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$",
        ],
        [
          "DROP TRIGGER ma trận",
          "DROP TRIGGER role_permissions_ma_tran_quyen ON public.role_permissions",
        ],
      ];

      for (const [nhan, cauTroi] of cacCa) {
        await db.pool.query(cauTroi);
        // Chống rỗng ruột: câu gây trôi phải THẬT SỰ làm hậu điều kiện sai. Không có vế này,
        // một câu viết sai (vd. sai tên trigger) sẽ cho test xanh mà chẳng chứng minh gì.
        expect(await trangThaiD3DungChuan(db), `${nhan}: câu gây trôi không đổi được gì`).toBe(
          false,
        );
        await expect(migrate(db.pool, MIGRATIONS_DIR), nhan).resolves.toEqual([]);
        expect(await trangThaiD3DungChuan(db), `${nhan}: lượt SỬA không dựng lại được`).toBe(true);
      }
    });
  }, 180_000);

  it("[Task 8 — QT1] role deploy không sở hữu: THÂN hàm và TRIGGER D3 sai đều làm migrate() GÃY", async () => {
    // Đây là mũi ĐỘT BIẾN KẾT HỢP mà bài học S10 của Task 6 đòi: chỉ đổi chủ sở hữu thì hậu
    // điều kiện VẪN ĐÚNG và mục vẫn qua (một mũi đơn lớp "sống sót mà không có nghĩa gì"); chỉ
    // làm hỏng thân thì lượt SỬA tự chữa và mục cũng qua. Phải làm CẢ HAI thì hậu điều kiện mới
    // là lớp duy nhất còn lại.
    //
    // [FIXTURE CŨNG PHẢI CHỊU ĐỘT BIẾN] Bản đầu của test này thay hàm bằng
    //     CREATE OR REPLACE FUNCTION ... LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$
    // tức MẤT LUÔN "SET search_path = pg_catalog". Đo được: đột biến "gỡ vế so THÂN hàm khỏi
    // hậu điều kiện (E1)" khi ấy SỐNG SÓT — vì vế `proconfig` một mình đã đủ bắt fixture. Fixture
    // tấn công HAI tính chất cùng lúc nên nó không đo được tính chất nào. Nay nó GIỮ NGUYÊN
    // proconfig/prosecdef/prolang/prorettype và CHỈ đổi thân — đúng cách một kẻ tấn công muốn
    // núp dưới một hàm "trông vẫn đúng" sẽ làm, và là cách duy nhất để vế so THÂN là vế DUY NHẤT
    // còn lại.
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR);
      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // Đối chứng: không trôi thì deploy thường vẫn QUA (nếu vế này đỏ, mục mới đang đòi một
        // quyền deploy mà lược đồ đúng không có — đúng cái bẫy QT1 cấm).
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);

        // ---- ĐƯỜNG TRÔI 1: THÂN hàm bị thay, MỌI thuộc tính khác giữ nguyên -----------------
        for (const ten of ["kiem_tra_phan_tach_nhiem_vu", "kiem_tra_ma_tran_quyen"]) {
          await db.pool.query(
            `CREATE OR REPLACE FUNCTION public.${ten}() RETURNS trigger ` +
              "LANGUAGE plpgsql SET search_path = pg_catalog AS $f$ BEGIN RETURN NULL; END $f$",
          );
        }
        // Chống rỗng ruột: hàm phải TRÔNG VẪN ĐÚNG ở mọi thuộc tính ngoài thân.
        const { rows: thuocTinh } = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_proc p " +
            " WHERE p.proname IN ('kiem_tra_phan_tach_nhiem_vu', 'kiem_tra_ma_tran_quyen') " +
            "   AND p.proconfig = ARRAY['search_path=pg_catalog'] AND p.prosecdef IS FALSE",
        );
        expect(thuocTinh[0]!.n, "fixture đổi cả thuộc tính -> nó đo vế khác").toBe("2");

        const loi1 = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi1, "hai hàm D3 bị thay THÂN mà migrate() vẫn QUA").not.toBeNull();
        expect(loi1!.message).toContain(
          "hàm + trigger phân tách nhiệm vụ (D3) trên public.user_roles",
        );
        expect(loi1!.message).toContain(
          "hàm + trigger ma trận quyền (D3) trên public.role_permissions",
        );
        expect(loi1!.message).toContain("Cần quyền");
        // Trôi vẫn còn NGUYÊN: migrate() gãy chứ không sửa một nửa rồi im.
        expect(await trangThaiD3DungChuan(db)).toBe(false);

        // Chủ thể CÓ quyền sở hữu chạy migrate() -> tự chữa hết trong một lần.
        await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
        expect(await trangThaiD3DungChuan(db)).toBe(true);

        // ---- ĐƯỜNG TRÔI 2: TRIGGER bị gỡ, hàm còn nguyên ------------------------------------
        // Hai bảng do superuser tạo nên role deploy KHÔNG sở hữu chúng: câu CREATE TRIGGER của
        // lượt SỬA nhận 42501 ("must be owner of relation"), và vế TRIGGER trong hậu điều kiện
        // là lớp DUY NHẤT còn lại. Không có đường trôi này, vế đó là mã chết — đã đo: gỡ nó khỏi
        // (E1) thì toàn bộ test "[Task 8]" vẫn XANH.
        await db.pool.query(
          "DROP TRIGGER user_roles_phan_tach_nhiem_vu ON public.user_roles; " +
            "DROP TRIGGER role_permissions_ma_tran_quyen ON public.role_permissions",
        );
        const loi2 = await migrate(poolTrienKhai, MIGRATIONS_DIR).then(
          () => null,
          (e: Error) => e,
        );
        expect(loi2, "hai trigger D3 bị gỡ mà migrate() vẫn QUA").not.toBeNull();
        expect(loi2!.message).toContain(
          "hàm + trigger phân tách nhiệm vụ (D3) trên public.user_roles",
        );
        expect(loi2!.message).toContain(
          "hàm + trigger ma trận quyền (D3) trên public.role_permissions",
        );
        expect(loi2!.message).toContain("(KHÔNG CÓ)");
        expect(await trangThaiD3DungChuan(db)).toBe(false);
      } finally {
        await poolTrienKhai.end();
      }

      // Đường sửa cuối: chủ sở hữu chạy migrate() -> tự chữa hết.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
      expect(await trangThaiD3DungChuan(db)).toBe(true);
    } finally {
      await db.stop();
    }
  }, 180_000);

  it("[Task 8 — (E1)/(E2)] trên lược đồ chỉ có 001/002, hai mục MỚI nằm im", async () => {
    // Vế điều kiện `to_regclass(...) IS NOT NULL` không phải trang trí: các test tích hợp của
    // dự án dùng thư mục migration rút gọn, và một mục đòi `public.user_roles` tồn tại sẽ ném
    // 42P01 ở BƯỚC 3 — tức migrate() chết trên một lược đồ hoàn toàn hợp lệ.
    const db = await startPostgres();
    const thuMucTam = await mkdtemp(join(tmpdir(), "tp-t8-rutgon-"));
    try {
      for (const f of [
        "hardening.always.sql",
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]) {
        await copyFile(join(MIGRATIONS_DIR, f), join(thuMucTam, f));
      }
      await expect(migrate(db.pool, thuMucTam)).resolves.toEqual([
        "001_roles_and_functions.sql",
        "002_organizations_and_users.sql",
      ]);
      // Và hardening KHÔNG được tự tạo ra hàm nào cho một bảng chưa tồn tại.
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_proc p " +
          " WHERE p.proname IN ('kiem_tra_phan_tach_nhiem_vu', 'kiem_tra_ma_tran_quyen')",
      );
      expect(rows[0]!.n).toBe("0");
      // Nâng cấp lên đủ bộ trong CÙNG một cụm vẫn chạy được và dựng đủ hai mục.
      await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([
        "003_audit_events.sql",
        "004_audit_chain_functions.sql",
        "005_identity.sql",
        "006_sessions_and_mfa.sql",
        "007_outbox.sql",
        "008_suppliers.sql",
        "009_rfq.sql",
        "010_invitations.sql",
        "011_rfq_hardening.sql",
        "012_invitation_hardening.sql",
        "013_actor_from_session.sql",
        "014_procurement_policy.sql",
        "015_otp_pepper.sql",
        "016_rfq_actor_from_session.sql",
        "017_rfq_key_material.sql",
        "018_vendor_bids.sql",
        "019_unseal.sql",
        "020_comparison.sql",
        "021_ciphertext_audit.sql",
        "022_security_review_s1.sql",
        "023_rfq_open_cancel_permissions.sql",
        "024_moi_lai_va_tran_chi_phi.sql",
        "025_worker_doc_hang_doi.sql",
        "026_xoa_mat_ma_vat_lieu_khoa.sql",
        "027_phien_khach_co_lap.sql",
        "028_khoa_cong_khai_cho_khach.sql",
        "029_dang_nhap_nguoi_mua.sql",
        "030_policy_manage.sql",
        "031_ghi_danh_lai_totp.sql",
        "032_khoa_ho_so_totp_da_xac_nhan.sql",
        "033_policy_manage_khong_cung_tay.sql",
        "034_dinh_chi_thu_hoi_phien.sql",
        "035_phien_ban_chinh_sach_lien_tuc.sql",
        "036_loi_moi_contact_thuoc_supplier.sql",
        "037_vai_ung_dung_la_thanh_vien.sql",
        "038_han_muc_nguoi_goi_dang_nhap.sql",
        "039_phien_can_totp_gan_day.sql",
        "040_dat_lai_totp_hai_nguoi.sql",
        "041_outbox_payload_dang_nhap_xoa_sau_xong.sql",
        "042_bucket_nguoi_goi_toan_cuc.sql",
        "043_danh_tinh_theo_phien_enable_always.sql",
        "044_don_bucket_otp.sql",
        "045_trigger_con_lai_enable_always.sql",
        "046_chi_so_cua_so_otp.sql",
        "047_chi_ghi_them_chan_truncate.sql",
        "048_email_nguoi_dung_chu_thuong.sql",
      ]);
      expect(await trangThaiD3DungChuan(db)).toBe(true);
    } finally {
      await rm(thuMucTam, { recursive: true, force: true });
      await db.stop();
    }
  }, 180_000);
  // ==========================================================================
  // [vòng fix 2 — MỤC C] (E3) DƯỚI ROLE DEPLOY: BỎ QUA, VÀ BỎ QUA CÓ CÔNG BỐ.
  //
  // (E3) là lớp deploy-time DUY NHẤT của bản vá C1 (bất biến D3, trục (b) — định nghĩa vai trò
  // đổi mà không ai ghi vào `user_roles`). Trên chính khuôn deploy mà bộ test này ghim làm
  // khuôn production ("[fix round 4 — N2] nhánh 1"), role deploy KHÔNG có SELECT trên
  // `roles`/`role_permissions`, nên guard `has_table_privilege` cho (E3) BỎ QUA HOÀN TOÀN.
  // Trước vòng fix 2, KHÔNG một dòng nào trong commit nói ra điều đó và KHÔNG test nào chạy
  // (E3) dưới role deploy. Test này khoá ĐỦ BỐN điều, và ba trong bốn là ÂM TÍNH:
  //   (a) hồ sơ quyền của role deploy đúng như mô tả (fixture tự chứng minh);
  //   (b) migrate() KHÔNG NÉM — bẫy QT1 (42501 giết deploy trên lược đồ đúng) VẪN được tránh;
  //   (c) nó CÓ CÔNG BỐ việc bỏ qua, và lời công bố đó TỚI ĐƯỢC người gọi qua `onThongBao`;
  //   (d) lớp phán xét thật KHÔNG chạy — không có WARNING "PHÂN TÁCH NHIỆM VỤ (D3)" nào, DÙ
  //       vi phạm [FO2] đang nằm sẵn trong bảng. Đây là vế nói ra sự thật khó chịu.
  // Đối chứng dương ở cuối: CÙNG cơ sở dữ liệu đó, CÙNG vi phạm đó, migrate() bằng role ĐỌC
  // ĐƯỢC bảng thì (E3) bắn đúng cảnh báo — nên (d) không phải vì (E3) rỗng ruột.
  // ==========================================================================
  it("[khoản nợ 88 — lượt soi 36 #3, ĐO] HỒ SƠ N3 (cụm TRỐNG, vai deploy CREATEROLE không superuser chạy migrate() ĐẦU TIÊN): BƯỚC 0 tạo app_api/app_unseal dưới vai ấy nên PostgreSQL 16 cấp cho nó membership ngầm chỉ-admin (INHERIT FALSE, SET FALSE, grantor là superuser bootstrap) — với tập vai theo USAGE/SET, mọi migration đánh số đi qua và vai deploy KHÔNG lọt tập; deploy dừng ở lượt PHÁN XÉT với đúng một mục có tên (membership lạ không tự gỡ được) và lối ra; superuser REVOKE một lần ⇒ đi qua", async () => {
    // Trước S1.44 (tập theo 'MEMBER'): vai deploy lọt tập ⇒ mục "quyền CREATE/TEMP trên database của vai ứng dụng và
    // mọi thành viên" THU HỒI CREATE của chính chủ database ở lượt sửa ⇒ 001 gãy "permission denied for database" — một
    // lỗi thô, không tên mục (đo: đột biến trả VAI_KET_NOI_UNG_DUNG về 'MEMBER' làm test này đỏ ở 001). Tiền tồn từ
    // S1.34; S1.44 làm nó lộ ra vì ⑵ dùng chung tập.
    const db = await startPostgres();
    try {
      const { rows } = await db.pool.query<{ ten_db: string }>("SELECT current_database() AS ten_db");
      await db.pool.query("CREATE ROLE trien_khai LOGIN CREATEROLE PASSWORD 'mat-khau-trien-khai'");
      await db.pool.query(`ALTER DATABASE "${rows[0]!.ten_db}" OWNER TO trien_khai`);
      const poolTrienKhai = createPool(doiNguoiDung(db.connectionString, "trien_khai", "mat-khau-trien-khai"), 2);
      try {
        // Tiền đề: vai deploy sở hữu database ⇒ có CREATE trên nó (CREATE SCHEMA app_private ở 001 và ở hardening cần).
        const tienDe = (await db.pool.query<{ chu: string; tao: boolean }>(
          "SELECT pg_get_userbyid(d.datdba) AS chu, has_database_privilege('trien_khai', d.datname, 'CREATE') AS tao " +
            "FROM pg_database d WHERE d.datname = current_database()",
        )).rows[0]!;
        expect(tienDe).toEqual({ chu: "trien_khai", tao: true });
        const thongBao: string[] = [];
        let kq = "OK";
        try {
          await migrate(poolTrienKhai, MIGRATIONS_DIR, { onThongBao: (tb) => thongBao.push(`${tb.severity}|${tb.message}`) });
        } catch (e) {
          kq = `NÉM: ${(e as Error).message}`;
        }
        // (a) Lượt SỬA đi qua và MỌI migration đánh số được áp bởi chính vai deploy — 001 không còn gãy.
        const daAp = (await db.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM public.schema_migrations")).rows[0]!.n;
        expect(daAp, "mọi migration đánh số đã áp").toBeGreaterThan(40);
        expect(tienDe.tao && (await db.pool.query<{ tao: boolean }>("SELECT has_database_privilege('trien_khai', current_database(), 'CREATE') AS tao")).rows[0]!.tao,
          "vai deploy vẫn còn CREATE trên database — hardening không được thu hồi quyền của chủ database").toBe(true);
        // (b) Hồ sơ: app_api/app_unseal do trien_khai tạo ⇒ membership ngầm chỉ-admin, và BƯỚC 1 KHÔNG tự gỡ được (grantor là
        //     superuser bootstrap) — WARNING nói đúng điều ấy.
        const mem = (await db.pool.query<{ nhom: string; tv: string; admin: boolean; ke_thua: boolean; dat: boolean }>(
          "SELECT r.rolname AS nhom, m.rolname AS tv, am.admin_option AS admin, am.inherit_option AS ke_thua, am.set_option AS dat " +
            "FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member " +
            "WHERE r.rolname IN ('app_api', 'app_unseal') ORDER BY 1, 2",
        )).rows;
        expect(mem).toEqual([
          { nhom: "app_api", tv: "trien_khai", admin: true, ke_thua: false, dat: false },
          { nhom: "app_unseal", tv: "trien_khai", admin: true, ke_thua: false, dat: false },
        ]);
        expect(thongBao.some((t) => /has not been granted membership in role "app_api" by role "trien_khai"/u.test(t)), "BƯỚC 1 nói ra việc không gỡ được").toBe(true);
        // (c) Tập vai theo USAGE/SET KHÔNG chứa vai deploy (membership chỉ-admin không phải kết nối ứng dụng); ⑵ rỗng.
        const HARDENING = readFileSync(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8");
        const tap = (await db.pool.query<{ rolname: string }>(docHangHardeningTu(HARDENING, "VAI_KET_NOI_UNG_DUNG"))).rows.map((r) => r.rolname).sort();
        expect(tap, "vai deploy không phải kết nối ứng dụng").toEqual(["app_api", "app_unseal"]);
        expect((await db.pool.query<{ mo_ta: string }>(docHangHardeningTu(HARDENING, "CAU_PHU_LENH_SAI"))).rows).toEqual([]);
        // (d) Deploy DỪNG ở lượt phán xét — đúng MỘT mục, có tên, có lối ra — không phải lỗi thô ở 001.
        expect(kq).toMatch(/^NÉM: Hardening hardening\.always\.sql \(phan_xet\) thất bại: Hardening không sửa được 1 mục:/u);
        expect(kq).toContain('- "tư cách thành viên LẠ của app_api/app_unseal và role đăng nhập của chúng": còn sót (app_api -> trien_khai; app_unseal -> trien_khai). Cần quyền: ADMIN OPTION trên các role đó hoặc SUPERUSER.');
        // (e) Lối ra đúng như thông báo: superuser gỡ hai membership ngầm một lần ⇒ migrate() dưới vai deploy đi qua.
        await db.pool.query("REVOKE app_api FROM trien_khai; REVOKE app_unseal FROM trien_khai");
        await expect(migrate(poolTrienKhai, MIGRATIONS_DIR)).resolves.toEqual([]);
      } finally {
        await poolTrienKhai.end();
      }
    } finally {
      await db.stop();
    }
  }, 300_000);

  it("[C1-E3-BO-QUA] (E3) dưới role deploy: bỏ qua, KHÔNG ném, và bỏ qua CÓ CÔNG BỐ", async () => {
    const db = await startPostgres();
    try {
      await migrate(db.pool, MIGRATIONS_DIR); // bootstrap bằng superuser, đúng một lần

      // Vi phạm [FO2] THẬT: FINANCE nhận thêm `rfq.unseal`. Trigger mức VAI TRÒ không bắn (một
      // mình FINANCE vẫn không ôm trọn chuỗi) — đó chính là trục (b) mà (E3) sinh ra để thấy.
      await expect(
        db.pool.query(
          "INSERT INTO role_permissions (role_code, permission_code) VALUES ('FINANCE','rfq.unseal')",
        ),
      ).resolves.toBeDefined();

      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        // (a) HỒ SƠ ROLE DEPLOY — fixture phải chứng minh tiền đề trước khi kết luận.
        const { rows: hoSo } = await poolTrienKhai.query<{
          rp: boolean;
          r: boolean;
          su: boolean;
          ten: string;
        }>(
          "SELECT has_table_privilege(current_user,'public.role_permissions','SELECT') AS rp, " +
            "       has_table_privilege(current_user,'public.roles','SELECT') AS r, " +
            "       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, " +
            "       current_user::text AS ten",
        );
        expect(hoSo[0]!.ten).toBe("trien_khai");
        expect(hoSo[0]!.su, "role deploy KHÔNG được là superuser — nếu là, phép đo rỗng ruột").toBe(
          false,
        );
        expect(hoSo[0]!.rp, "role deploy KHÔNG được có SELECT trên role_permissions").toBe(false);
        expect(hoSo[0]!.r, "role deploy KHÔNG được có SELECT trên roles").toBe(false);

        // (b) + (c): migrate() KHÔNG ném, và lời "tôi đang bỏ qua" tới được người gọi.
        const thongBao: string[] = [];
        await expect(
          migrate(poolTrienKhai, MIGRATIONS_DIR, {
            onThongBao: (tb) => thongBao.push(`${tb.severity}|${tb.message}`),
          }),
        ).resolves.toEqual([]);
        expect(
          thongBao.some((d) => d.includes("(E3): BỎ QUA phép kiểm ma trận quyền")),
          `(E3) bỏ qua TRONG IM LẶNG. Đã nhận: ${JSON.stringify(thongBao)}`,
        ).toBe(true);

        // (d) VÀ ĐÂY LÀ SỰ THẬT KHÓ CHỊU: lớp phán xét thật KHÔNG chạy, dù vi phạm nằm sẵn.
        expect(
          thongBao.some((d) => d.includes("PHÂN TÁCH NHIỆM VỤ (D3)")),
          "trên khuôn deploy chuẩn, (E3) KHÔNG phán xét — nếu vế này đổi, phải sửa cả 005 §(3)",
        ).toBe(false);
      } finally {
        await poolTrienKhai.end();
      }

      // ĐỐI CHỨNG DƯƠNG: cùng CSDL, cùng vi phạm, role ĐỌC ĐƯỢC bảng -> (E3) bắn thật.
      const thongBaoSuper: string[] = [];
      await expect(
        migrate(db.pool, MIGRATIONS_DIR, {
          onThongBao: (tb) => thongBaoSuper.push(`${tb.severity}|${tb.message}`),
        }),
      ).resolves.toEqual([]);
      expect(
        thongBaoSuper.some((d) => d.includes("PHÂN TÁCH NHIỆM VỤ (D3)")),
        `(E3) KHÔNG bắn dù đọc được bảng và vi phạm nằm sẵn — phép đo (d) ở trên rỗng ruột. ` +
          `Đã nhận: ${JSON.stringify(thongBaoSuper)}`,
      ).toBe(true);
      expect(
        thongBaoSuper.some((d) => d.includes("(E3): BỎ QUA phép kiểm ma trận quyền")),
        "role đọc được bảng thì KHÔNG được đi vào nhánh bỏ qua",
      ).toBe(false);
    } finally {
      await db.stop();
    }
  }, 300_000);
  // ==========================================================================
  // [vòng fix 1 Task 10 — MỤC 1] (E4) CẤM LOG: MỘT MỤC CẢNH BÁO, KHÔNG PHẢI MỘT MỤC TỰ SỬA
  //
  // Ba vế, và vế thứ ba là vế QUYẾT ĐỊNH:
  //   (a) cấu hình MẶC ĐỊNH -> KHÔNG có cảnh báo (E4) nào — chống rỗng ruột theo chiều ngược;
  //   (b) bật đúng một GUC -> (E4) bắn, và migrate() KHÔNG NÉM (không chặn deploy);
  //   (c) phép đo biện minh cho việc KHÔNG viết mục tự sửa: dưới role deploy chuẩn của dự án
  //       (DB owner + CREATEROLE, KHÔNG superuser), `ALTER DATABASE ... SET
  //       log_parameter_max_length` ném 42501. Một mục TỰ SỬA cho GUC ấy sẽ có hậu điều kiện
  //       không bao giờ đúng lại được -> "Hardening không sửa được 1 mục" -> CHẶN DEPLOY VĨNH
  //       VIỄN vì một cấu hình NGOÀI TẦM VỚI của migrate().
  // ==========================================================================
  it("[T10-E4] (E4) CẤM LOG cảnh báo mà KHÔNG chặn deploy, và tự sửa là bất khả — có phép đo", async () => {
    const db = await startPostgres();
    try {
      // (a) MẶC ĐỊNH: log_parameter_max_length_on_error = 0, log_min_duration_statement = -1.
      const mangA: string[] = [];
      await expect(
        migrate(db.pool, MIGRATIONS_DIR, {
          onThongBao: (tb) => mangA.push(`${tb.severity}|${tb.message}`),
        }),
      ).resolves.toBeDefined();
      expect(
        mangA.some((d) => d.includes("(E4)")),
        `cấu hình mặc định KHÔNG được sinh cảnh báo (E4). Đã nhận: ${JSON.stringify(mangA)}`,
      ).toBe(false);

      const tenDb = (
        await db.pool.query<{ d: string }>("SELECT current_database() AS d")
      ).rows[0]!.d;

      // (b) BẬT nhánh LỖI: một câu lệnh lỗi bất kỳ sẽ ghi cả tham số bind vào log máy chủ, và
      //     `outbox_jobs.payload` đi qua đúng một tham số bind của enqueueJob.
      await db.pool.query(
        `ALTER DATABASE "${tenDb}" SET log_parameter_max_length_on_error = -1`,
      );
      // `ALTER DATABASE ... SET` chỉ áp cho phiên MỞ SAU nó, nên phải mở một pool MỚI —
      // `db.pool` đang giữ những kết nối có từ trước. Đây cũng là lý do một mục hardening ở mức
      // database KHÔNG bảo vệ được phiên đang chạy, chỉ phiên kế tiếp.
      const poolMoiB = createPool(db.connectionString, 2);
      try {
        const mangB: string[] = [];
        await expect(
          migrate(poolMoiB, MIGRATIONS_DIR, {
            onThongBao: (tb) => mangB.push(`${tb.severity}|${tb.message}`),
          }),
        ).resolves.toEqual([]);
        expect(
          mangB.some((d) => d.includes("(E4): CẤM LOG — log_parameter_max_length_on_error")),
          `(E4) KHÔNG bắn dù GUC đã bật. Đã nhận: ${JSON.stringify(mangB)}`,
        ).toBe(true);
      } finally {
        await poolMoiB.end();
        await db.pool.query(
          `ALTER DATABASE "${tenDb}" RESET log_parameter_max_length_on_error`,
        );
      }

      // (b2) NHÁNH NẶNG NHẤT — câu lệnh THÀNH CÔNG cũng ghi tham số. Nó cần HAI GUC cùng lúc,
      //      và mặc định của `log_parameter_max_length` đã là -1 (= GHI ĐẦY ĐỦ), nên chỉ cần
      //      bật log theo thời lượng là đủ. Đây là vế chạm đường app_api BÌNH THƯỜNG.
      await db.pool.query(`ALTER DATABASE "${tenDb}" SET log_min_duration_statement = 0`);
      const poolMoiC = createPool(db.connectionString, 2);
      try {
        const mangC: string[] = [];
        await expect(
          migrate(poolMoiC, MIGRATIONS_DIR, {
            onThongBao: (tb) => mangC.push(`${tb.severity}|${tb.message}`),
          }),
        ).resolves.toEqual([]);
        expect(
          mangC.some((d) => d.includes("(E4): CẤM LOG — log_parameter_max_length =")),
          `(E4) KHÔNG bắn ở nhánh câu lệnh THÀNH CÔNG. Đã nhận: ${JSON.stringify(mangC)}`,
        ).toBe(true);
      } finally {
        await poolMoiC.end();
        await db.pool.query(`ALTER DATABASE "${tenDb}" RESET log_min_duration_statement`);
      }

      // (c) PHÉP ĐO BIỆN MINH. `log_parameter_max_length` có pg_settings.context = 'superuser'.
      const { rows: boiCanh } = await db.pool.query<{ c: string }>(
        "SELECT context AS c FROM pg_settings WHERE name = 'log_parameter_max_length'",
      );
      expect(boiCanh[0]!.c).toBe("superuser");

      const csTrienKhai = await dungRoleTrienKhaiThuong(db);
      const poolTrienKhai = createPool(csTrienKhai, 2);
      try {
        await expect(
          poolTrienKhai.query(`ALTER DATABASE "${tenDb}" SET log_parameter_max_length = 0`),
        ).rejects.toMatchObject({ code: "42501" });
        // ĐỐI CHỨNG DƯƠNG: cùng role đó ĐẶT ĐƯỢC GUC có context = 'user', nên 42501 ở trên
        // không phải vì role không sở hữu database.
        await expect(
          poolTrienKhai.query(
            `ALTER DATABASE "${tenDb}" SET log_parameter_max_length_on_error = 0`,
          ),
        ).resolves.toBeDefined();
      } finally {
        await poolTrienKhai.end();
        await db.pool.query(`ALTER DATABASE "${tenDb}" RESET log_parameter_max_length_on_error`);
      }
    } finally {
      await db.stop();
    }
  }, 300_000);
});
