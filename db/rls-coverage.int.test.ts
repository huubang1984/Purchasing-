import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Bảng GỐC của cây tenant: không có cột org_id vì chính `id` của nó LÀ tổ chức. Danh sách này
 * cố ý viết tay và ĐÓNG — thêm một bảng gốc mới là một quyết định phải nhìn thấy được, không
 * phải một suy luận tự động có thể sai âm thầm.
 */
const BANG_GOC_TENANT = ["organizations"];

/**
 * [S7b-T3] Truy vấn phủ RLS. Cố ý dùng pg_attribute chứ KHÔNG dùng information_schema.columns.
 *
 * Đã tự kiểm chứng trên PostgreSQL 16.15 — hai câu KHÔNG tương đương. information_schema.columns
 * chỉ hiện cột mà role ĐANG CHẠY có quyền trên bảng chứa nó. Đo trực tiếp với một bảng có org_id,
 * KHÔNG bật RLS, KHÔNG cấp quyền gì cho app_api, chạy dưới app_api:
 *     bản information_schema -> 0 hàng  (báo "mọi thứ đều ổn" — âm tính giả)
 *     bản pg_attribute       -> 1 hàng  (bắt đúng bảng thiếu RLS)
 * Nghĩa là đúng những bảng NGUY HIỂM NHẤT — bảng chưa ai kịp cấp quyền, thường là bảng mới —
 * lại là những bảng bản information_schema bỏ sót. Có test riêng khoá phép đo này bên dưới.
 *
 * `attnum > 0 AND NOT attisdropped` là bắt buộc: attnum <= 0 là cột hệ thống, và một cột org_id
 * đã DROP vẫn còn hàng trong pg_attribute với attisdropped = true và tên đã bị đổi.
 */
const CAU_PHU_RLS =
  "SELECT c.relname AS ten_bang, c.relrowsecurity AS bat, c.relforcerowsecurity AS cuong_che " +
  "  FROM pg_class c " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  " WHERE n.nspname = 'public' AND c.relkind = 'r' " +
  "   AND EXISTS (SELECT 1 FROM pg_attribute a " +
  "                WHERE a.attrelid = c.oid AND a.attname = 'org_id' " +
  "                  AND a.attnum > 0 AND NOT a.attisdropped) " +
  " ORDER BY 1";

interface HangPhuRls {
  ten_bang: string;
  bat: boolean;
  cuong_che: boolean;
}

interface HangPolicy {
  ten_bang: string;
  ten_policy: string;
  lenh: string;
  cho_phep: boolean;
  bieu_thuc_using: string | null;
  bieu_thuc_with_check: string | null;
}

let db: TestDatabase;
let apiPool: pg.Pool;
/** Mọi bảng chịu ràng buộc tenant: bảng có org_id, cộng các bảng gốc của cây tenant. */
let bangTenant: string[];

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);

  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
      "('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  await db.pool.query(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3), ($4, $5, $6)",
    [rows[0]!.id, "a@example.com", "Nguoi A", rows[1]!.id, "b@example.com", "Nguoi B"],
  );

  const phu = await db.pool.query<HangPhuRls>(CAU_PHU_RLS);
  bangTenant = [...new Set([...phu.rows.map((r) => r.ten_bang), ...BANG_GOC_TENANT])].sort();
  apiPool = db.poolAs("app_api");
});

afterAll(async () => {
  await db?.stop();
});

describe("phủ RLS", () => {
  it("[INV-F1] mọi bảng có org_id đều bật ENABLE và FORCE row level security", async () => {
    const { rows } = await db.pool.query<HangPhuRls>(CAU_PHU_RLS);

    expect(rows.length).toBeGreaterThan(0); // không bao giờ được rỗng ruột
    const thieu = rows.filter((r) => !r.bat || !r.cuong_che).map((r) => r.ten_bang);
    expect(
      thieu,
      `Bảng có org_id mà thiếu ENABLE hoặc FORCE ROW LEVEL SECURITY: ${thieu.join(", ")}. ` +
        "Cả hai phải nằm CÙNG file với CREATE TABLE của bảng đó (S7b-T3).",
    ).toEqual([]);
  });

  it("[INV-F1] mọi bảng gốc của cây tenant cũng bật ENABLE và FORCE", async () => {
    const { rows } = await db.pool.query<HangPhuRls>(
      "SELECT relname AS ten_bang, relrowsecurity AS bat, relforcerowsecurity AS cuong_che " +
        "FROM pg_class WHERE relname = ANY($1) AND relkind = 'r' ORDER BY 1",
      [BANG_GOC_TENANT],
    );
    expect(rows.map((r) => r.ten_bang)).toEqual([...BANG_GOC_TENANT].sort());
    expect(rows.filter((r) => !r.bat || !r.cuong_che)).toEqual([]);
  });

  // [S7b-T3] Test này KHOÁ chính lựa chọn câu truy vấn ở trên. Nếu ai đó "đơn giản hoá" nó về
  // information_schema.columns, phép đo dưới đây sẽ chỉ ra ngay rằng bản mới bỏ sót đúng loại
  // bảng nguy hiểm nhất. Toàn bộ chạy trong một transaction rồi ROLLBACK: bảng giả lập không
  // được để lại cho các test khác nhìn thấy.
  it("truy vấn phủ RLS phải dùng pg_attribute — information_schema.columns bỏ sót bảng mà role hiện tại không có quyền", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TABLE bang_moi_quen_bat_rls (id int, org_id uuid)");
      // KHÔNG cấp quyền gì cho app_api, KHÔNG bật RLS — đúng hình dạng một bảng mới bị quên.
      await client.query("SET LOCAL ROLE app_api");

      const banInformationSchema = await client.query<{ ten_bang: string }>(
        "SELECT c.relname AS ten_bang FROM pg_class c " +
          "JOIN pg_namespace n ON n.oid = c.relnamespace " +
          "WHERE n.nspname = 'public' AND c.relkind = 'r' " +
          "  AND EXISTS (SELECT 1 FROM information_schema.columns col " +
          "               WHERE col.table_schema = 'public' AND col.table_name = c.relname " +
          "                 AND col.column_name = 'org_id') " +
          "  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)",
      );
      // Cố ý chạy CHÍNH CAU_PHU_RLS chứ không viết lại một bản tương đương: nhờ vậy test này
      // RÀNG BUỘC hằng số đó. Ai "đơn giản hoá" CAU_PHU_RLS về information_schema sẽ làm test
      // này đỏ, thay vì âm thầm để phép phủ RLS trở thành âm tính giả.
      const banPgAttribute = await client.query<{ ten_bang: string }>(
        `SELECT ten_bang FROM (${CAU_PHU_RLS}) t WHERE NOT bat OR NOT cuong_che`,
      );

      expect(
        banInformationSchema.rows.map((r) => r.ten_bang),
        "Nếu khẳng định này đỏ nghĩa là information_schema.columns đã hết bỏ sót — hãy đo lại " +
          "trước khi kết luận, chứ đừng đổi câu truy vấn phủ RLS.",
      ).toEqual([]);
      expect(banPgAttribute.rows.map((r) => r.ten_bang)).toEqual(["bang_moi_quen_bat_rls"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  // [S11-T3] Ba dạng policy bị CẤM, khoá ở tầng hình DẠNG biểu thức. Đọc pg_policy chứ không
  // đọc file .sql: thứ có hiệu lực là cái đang nằm trong catalog, và một policy tạo tay sau
  // triển khai cũng phải chịu cùng ràng buộc.
  it("[INV-F1] policy của mọi bảng tenant không mang dạng fail-open bị cấm", async () => {
    const { rows } = await db.pool.query<HangPolicy>(
      "SELECT c.relname AS ten_bang, p.polname AS ten_policy, p.polcmd AS lenh, " +
        "       p.polpermissive AS cho_phep, " +
        "       pg_get_expr(p.polqual, p.polrelid) AS bieu_thuc_using, " +
        "       pg_get_expr(p.polwithcheck, p.polrelid) AS bieu_thuc_with_check " +
        "  FROM pg_policy p " +
        "  JOIN pg_class c ON c.oid = p.polrelid " +
        "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
        " WHERE n.nspname = 'public' AND c.relname = ANY($1) " +
        " ORDER BY 1, 2",
      [bangTenant],
    );

    // Không có policy nào thì mọi khẳng định dưới đây rỗng ruột — chốt trước.
    const bangCoPolicy = new Set(rows.map((r) => r.ten_bang));
    expect([...bangCoPolicy].sort()).toEqual(bangTenant);

    const viPham: string[] = [];
    for (const hang of rows) {
      const nhan = `${hang.ten_bang}.${hang.ten_policy}`;

      // (3) Vế kiểm HÀNG MỚI phải viết tường minh. Postgres có dùng lại USING làm WITH CHECK
      // khi bỏ trống (đã đo), nhưng dựa vào hành vi mặc định đó nghĩa là người kiểm toán phải
      // NHỚ nó, và nó biến mất ngay khi ai đó tách policy theo lệnh.
      if (["*", "a", "w"].includes(hang.lenh) && hang.bieu_thuc_with_check === null) {
        viPham.push(`${nhan}: policy cho lệnh "${hang.lenh}" thiếu WITH CHECK tường minh`);
      }

      for (const [ten, bieuThuc] of [
        ["USING", hang.bieu_thuc_using],
        ["WITH CHECK", hang.bieu_thuc_with_check],
      ] as const) {
        if (bieuThuc === null) continue;

        // (1) "app_current_org_id() IS NULL OR ..." — mở toang khi chưa gắn tenant.
        if (/\bis\s+null\b/i.test(bieuThuc)) {
          viPham.push(`${nhan}: ${ten} chứa phép thử IS NULL — dạng fail-open bị cấm`);
        }
        // (2) coalesce phục vụ cùng mục đích.
        if (/\bcoalesce\b/i.test(bieuThuc)) {
          viPham.push(`${nhan}: ${ten} chứa coalesce() — dạng fail-open bị cấm`);
        }
        // Policy phải THẬT SỰ ràng buộc theo tổ chức, không phải "true" hay một vị từ khác.
        if (!/\bapp_current_org_id\(\)/.test(bieuThuc)) {
          viPham.push(`${nhan}: ${ten} không nhắc tới app_current_org_id() — không ràng buộc tenant`);
        }
      }

      // Policy PERMISSIVE là mặc định và là thứ khuôn này dùng; một policy RESTRICTIVE lẫn vào
      // sẽ đổi hẳn ngữ nghĩa tổ hợp (AND thay vì OR) và phải là quyết định tường minh.
      if (!hang.cho_phep) {
        viPham.push(`${nhan}: policy RESTRICTIVE chưa được khuôn này xét tới`);
      }
    }

    expect(viPham).toEqual([]);
  });

  // [S11-T3] Mặt HÀNH VI của cùng ràng buộc, và là mặt không thể lách bằng cách viết lại biểu
  // thức cho khác chữ: chưa gắn tổ chức thì không đọc được hàng nào, trên MỌI bảng tenant.
  it("[INV-F1] chưa gắn tổ chức thì mọi bảng tenant trả 0 hàng — fail-closed", async () => {
    let tongHangThat = 0;
    const thay: string[] = [];

    for (const tenBang of bangTenant) {
      const thuc = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${tenBang}"`,
      );
      tongHangThat += Number(thuc.rows[0]!.n);

      const ketQua = await apiPool
        .query<{ n: string }>(`SELECT count(*)::text AS n FROM "${tenBang}"`)
        .then((r) => Number(r.rows[0]!.n))
        // Không có quyền gì trên bảng cũng là fail-closed — thậm chí còn chặt hơn.
        .catch((loi: Error) => (/permission denied/i.test(loi.message) ? 0 : Number.NaN));
      if (ketQua !== 0) thay.push(`${tenBang}: ${ketQua}`);
    }

    // Nếu mọi bảng đều rỗng thì "0 hàng" chẳng chứng minh gì — chốt chống rỗng ruột.
    expect(tongHangThat).toBeGreaterThan(0);
    expect(thay).toEqual([]);
  });

  // Quyền của hai role ứng dụng trên hai bảng này là một QUYẾT ĐỊNH, không phải một mặc định —
  // nên nó phải có khẳng định, nếu không mọi lần "cấp thêm cho chắc" về sau sẽ đi qua im lặng.
  // Ba điểm đang được khoá ở đây, mỗi điểm kèm lý do:
  //   - app_api KHÔNG có INSERT trên organizations: với WITH CHECK (id = app_current_org_id()),
  //     một hàng mới phải mang id BẰNG tổ chức đang gắn — mà tổ chức đó đã tồn tại. Quyền này
  //     không thể dùng được, và một tổ chức không được tự đẻ ra tổ chức khác.
  //   - app_unseal KHÔNG có quyền gì trên users: users chứa email và họ tên — dữ liệu cá nhân —
  //     mà runtime mở thầu không có việc gì phải đọc.
  //   - Không role nào có DELETE ở bất kỳ đâu: vòng đời người dùng đi qua cột status.
  it("quyền bảng của app_api/app_unseal đúng bằng những gì đã quyết định, không hơn", async () => {
    const { rows } = await db.pool.query<{ grantee: string; bang: string; quyen: string }>(
      "SELECT grantee, table_name AS bang, string_agg(privilege_type, ',' ORDER BY privilege_type) AS quyen " +
        "  FROM information_schema.role_table_grants " +
        " WHERE table_schema = 'public' AND grantee IN ('app_api', 'app_unseal') " +
        " GROUP BY 1, 2 ORDER BY 1, 2",
    );
    expect(rows).toEqual([
      { grantee: "app_api", bang: "organizations", quyen: "SELECT,UPDATE" },
      { grantee: "app_api", bang: "users", quyen: "INSERT,SELECT,UPDATE" },
      { grantee: "app_unseal", bang: "organizations", quyen: "SELECT" },
    ]);
  });

  // FORCE ROW LEVEL SECURITY chỉ có tác dụng với CHỦ SỞ HỮU bảng, và chỉ khi chủ sở hữu KHÔNG
  // phải superuser. Trong test, migrate() chạy bằng postgres (superuser) nên chủ sở hữu bỏ qua
  // RLS bất kể FORCE — nghĩa là không một test nào ở trên phân biệt được có FORCE hay không,
  // ngoài phép đọc cờ catalog. Test này dựng đúng kịch bản TRIỂN KHAI THẬT (role deploy là DB
  // owner thường, không superuser — xem "trien_khai" ở db/migrations.int.test.ts) để FORCE có
  // một khẳng định HÀNH VI, không chỉ một khẳng định trên giấy.
  //
  // Đã đo riêng trên PostgreSQL 16.15 để chắc phép đo này phân biệt được: cùng dữ liệu, cùng
  // policy, chủ sở hữu không phải superuser -> có FORCE đọc 1/2 hàng, không FORCE đọc 2/2.
  it("[INV-F1] FORCE ràng buộc cả CHỦ SỞ HỮU bảng khi chủ sở hữu không phải superuser", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE ROLE chu_so_huu_thuong NOSUPERUSER NOLOGIN");
      await client.query("GRANT USAGE ON SCHEMA public TO chu_so_huu_thuong");
      // Cấp EXECUTE để phép đo SẮC: nếu thiếu, policy không đánh giá được và câu truy vấn ném
      // "permission denied for function app_current_org_id" — cũng là fail-closed, nhưng khi đó
      // test không còn phân biệt được "policy chặn" với "role thiếu quyền phụ". Có EXECUTE thì
      // khác biệt giữa có FORCE và không FORCE hiện ra thẳng ở SỐ HÀNG: 0 so với tất cả.
      // (Ghi nhận phụ, đã đo trong chính lần chạy này: một role KHÔNG có EXECUTE trên
      // app_current_org_id() không truy vấn nổi bất kỳ bảng có RLS nào — bản vá S2 của 001 làm
      // mọi role mới mặc định không dùng được các bảng đó cho tới khi được cấp tường minh.)
      await client.query(
        "GRANT EXECUTE ON FUNCTION app_current_org_id() TO chu_so_huu_thuong",
      );
      for (const tenBang of bangTenant) {
        await client.query(`ALTER TABLE "${tenBang}" OWNER TO chu_so_huu_thuong`);
      }

      const truoc = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM users");
      expect(Number(truoc.rows[0]!.n)).toBeGreaterThan(0); // superuser vẫn thấy hết

      await client.query("SET LOCAL ROLE chu_so_huu_thuong");
      const sau = await client.query<{ u: string; n: string }>(
        "SELECT current_user AS u, count(*)::text AS n FROM users",
      );
      expect(sau.rows[0]?.u).toBe("chu_so_huu_thuong");
      expect(
        Number(sau.rows[0]!.n),
        "Chủ sở hữu bảng đọc được hàng khi chưa gắn tổ chức — FORCE ROW LEVEL SECURITY đã mất.",
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
