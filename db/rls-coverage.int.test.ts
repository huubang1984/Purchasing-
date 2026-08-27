import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Bảng GỐC của cây tenant: không có cột org_id vì chính `id` của nó LÀ tổ chức. Danh sách này
 * cố ý viết tay và ĐÓNG — thêm một bảng gốc mới là một quyết định phải nhìn thấy được, không
 * phải một suy luận tự động có thể sai âm thầm.
 *
 * [vòng fix 1 — M1] Danh sách này NHÂN BẢN ba nơi: đây, db/migration-shape.test.ts, và
 * VI_TU_BANG_TENANT trong db/migrations/hardening.always.sql. Vòng trước không có gì canh sự
 * đồng bộ đó, trong khi thân hàm app_current_org_id() nhân bản HAI nơi thì có (§R3) — task sau
 * thêm bảng gốc thứ hai và quên một bản sao là một lỗ IM LẶNG. Nay có test đồng bộ bên dưới.
 */
const BANG_GOC_TENANT = ["organizations"];

/**
 * [vòng fix 1 — CR1] Bản sao TypeScript của HINH_DANG_CHUAN trong hardening.always.sql — KHUÔN
 * CỦA DỰ ÁN, có hiệu lực TOÀN CỤC trên mọi bảng tenant.
 *
 * Vì sao là DANH SÁCH TRẮNG chứ không phải danh sách các dạng bị cấm: bản trước chỉ đòi biểu
 * thức NHẮC TỚI app_current_org_id() và không chứa chuỗi "IS NULL"/"coalesce" — nó không đòi
 * biểu thức RÀNG BUỘC gì cả. Bốn payload đo được đi lọt cả ba lớp, xem test đối kháng
 * "[CR1] bốn cách viết lại tương đương ngữ nghĩa..." ở db/migrations.int.test.ts.
 *
 * [vòng fix 2 — CR1] Vòng 1 có BỐN dòng: mỗi hình dạng hai biến thể (trần và 'public.'-đủ-tên)
 * để hứng việc pg_get_expr deparse THEO search_path của phiên đang đọc. Hai dòng 'public.' nay
 * bị XOÁ vì search_path của phiên phán xét đã được GHIM (packages/db/src/migrate.ts +
 * hardening.always.sql). Nới danh sách ra để chấp nhận mọi giá trị của một cấu hình chính là
 * cơ chế của lỗ hổng vòng 2: dạng TRẦN được duyệt vô điều kiện, mà dạng trần đúng là thứ một
 * hàm app_current_org_id() ở SCHEMA KHÁC sinh ra khi schema đó đứng trước trong search_path.
 *
 * Chỉ hai dòng, và đó là điều kiện để danh sách này AN TOÀN khi áp toàn cục: mỗi dòng RÀNG BUỘC
 * hàng về đúng tổ chức đang gắn. Hình dạng KHÔNG có tính chất đó đi qua NGOAI_LE_HINH_DANG.
 *
 * Có meta-test bên dưới đọc hardening.always.sql và đòi hai danh sách KHỚP NHAU, nên mở một
 * hình dạng mới bắt buộc phải sửa CẢ file SQL LẪN file này.
 */
const HINH_DANG_CHUAN: readonly (readonly [string, string])[] = [
  ["co_org_id", "(org_id = app_current_org_id())"],
  ["bang_goc", "(id = app_current_org_id())"],
];

/**
 * [vòng fix 2 — CR2] Bản sao TypeScript của NGOAI_LE_HINH_DANG — CỬA THEO ĐỐI TƯỢNG, khoá theo
 * (bảng, policy, phạm vi, biểu thức).
 *
 * Vòng 1 chỉ có MỘT danh sách khoá theo (pham_vi, bieu_thuc), tức TOÀN CỤC. Đo được: mô phỏng
 * đúng việc Task 6 sẽ phải làm — thêm một dòng cho policy riêng của app_unseal — rồi
 * "USING (true)" trên CHÍNH bảng users cũng lọt. Mở một hình dạng cho MỘT bảng pre-approve nó
 * cho MỌI bảng tenant hiện tại và tương lai. Nay một ngoại lệ chỉ có hiệu lực ĐÚNG NƠI được cấp.
 *
 * RỖNG là trạng thái đúng ở S0, và có test bên dưới đòi mỗi dòng ở đây phải ứng với một policy
 * CÓ THẬT — ngoại lệ chết (bảng/policy đã bị xoá) là ĐỎ, không phải rác im lặng.
 */
const NGOAI_LE_HINH_DANG: readonly (readonly [string, string, string, string])[] = [];

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
 *
 * [vòng fix 1 — CR2] relkind IN ('r','p'), KHÔNG chỉ 'r'. Bảng CHA phân mảnh là 'p' và vòng
 * trước hoàn toàn không thấy nó — xem test đối kháng "[CR2] bảng phân mảnh..." ở
 * db/migrations.int.test.ts để biết phép đo. Bảng NGOÀI ('f') cố ý KHÔNG nằm trong danh sách:
 * dữ liệu của nó ở cụm khác, RLS của PostgreSQL không áp được, nên bật cờ ở đây sẽ là một lời
 * hứa sai. Đó là một trục chưa được canh, đã khai ở báo cáo thay vì che bằng một cờ vô nghĩa.
 */
const CAU_PHU_RLS =
  "SELECT c.relname AS ten_bang, c.relrowsecurity AS bat, c.relforcerowsecurity AS cuong_che " +
  "  FROM pg_class c " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  " WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') " +
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
  it("[INV-F1] mọi bảng/bảng cha phân mảnh trong public có org_id đều bật ENABLE và FORCE row level security", async () => {
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
        "FROM pg_class WHERE relname = ANY($1) AND relkind IN ('r', 'p') ORDER BY 1",
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

  // [vòng fix 1 — CR2] Test này KHOÁ vế relkind của CAU_PHU_RLS, đúng khuôn test
  // "phải dùng pg_attribute" ở trên: nó chạy CHÍNH hằng số đó chứ không viết lại một bản tương
  // đương. Cần nó vì lược đồ THẬT ở S0 chưa có bảng phân mảnh nào, nên nếu ai đó thu relkind
  // về 'r' thì không một khẳng định nào khác trong repo đỏ — đã đo đúng điều đó bằng đột biến
  // trước khi viết test này (V3b sống sót).
  it("[CR2] truy vấn phủ RLS thấy được BẢNG CHA phân mảnh (relkind = 'p'), không chỉ bảng thường", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE bang_cha_quen_rls (id int, org_id uuid) PARTITION BY LIST (org_id)",
      );
      await client.query(
        "CREATE TABLE bang_cha_quen_rls_a PARTITION OF bang_cha_quen_rls " +
          "FOR VALUES IN ('00000000-0000-4000-8000-00000000000a')",
      );

      const { rows } = await client.query<{ ten_bang: string }>(
        `SELECT ten_bang FROM (${CAU_PHU_RLS}) t WHERE NOT bat OR NOT cuong_che ORDER BY 1`,
      );
      expect(
        rows.map((r) => r.ten_bang),
        "Bảng CHA phân mảnh vô hình với truy vấn phủ RLS. Policy của lá KHÔNG được áp khi truy " +
          "vấn đi qua cha — đã đo: tổ chức A đọc qua cha thấy cả giá của tổ chức B.",
      ).toEqual(["bang_cha_quen_rls", "bang_cha_quen_rls_a"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  // [vòng fix 1 — M1] Danh sách bảng GỐC tenant nhân bản BA nơi. Đây là test đồng bộ, đúng
  // khuôn §R3 đã dùng cho thân hàm app_current_org_id() (nhân bản HAI nơi và CÓ test). Không có
  // nó, task sau thêm bảng gốc thứ hai rồi quên một bản sao là một lỗ IM LẶNG: hardening sẽ
  // không bật RLS cho bảng đó, hoặc lớp tĩnh sẽ không đòi POLICY/GRANT cho nó.
  it("[M1] danh sách bảng GỐC tenant khớp nhau ở cả ba nơi nhân bản", () => {
    const sqlHardening = readFileSync(`${MIGRATIONS_DIR}/hardening.always.sql`, "utf8");
    const khopSql = /relname IN \(([^)]*)\)\)\$q\$/.exec(sqlHardening);
    expect(khopSql, "không tìm thấy danh sách bảng gốc trong VI_TU_BANG_TENANT").not.toBeNull();
    const tuSql = [...khopSql![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();

    const tsShape = readFileSync(
      fileURLToPath(new URL("./migration-shape.test.ts", import.meta.url)),
      "utf8",
    );
    const khopShape = /const BANG_GOC_TENANT = \[([^\]]*)\]/.exec(tsShape);
    expect(khopShape, "không tìm thấy BANG_GOC_TENANT trong migration-shape.test.ts").not.toBeNull();
    const tuShape = [...khopShape![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();

    expect(tuSql).toEqual([...BANG_GOC_TENANT].sort());
    expect(tuShape).toEqual([...BANG_GOC_TENANT].sort());
  });

  // [vòng fix 1 — CR1] META-TEST của danh sách trắng hình dạng. Đúng khuôn hàng rào G1 ở
  // Task 7: hằng số sống ở SQL (nơi nó có hiệu lực trong production), và một bản sao ở đây,
  // và hai bản BẮT BUỘC khớp nhau. Hệ quả cố ý: mở một hình dạng policy mới là một thay đổi
  // phải xuất hiện trong diff của CẢ HAI file, không thể lọt qua bằng một dòng SQL lặng lẽ.
  it("[CR1] danh sách trắng hình dạng policy trong hardening.always.sql khớp bản trong test", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/hardening.always.sql`, "utf8");
    const khoi = /HINH_DANG_CHUAN constant text :=\s*\$q\$\(VALUES([\s\S]*?)\)\s*AS h\(/.exec(sql);
    expect(khoi, "không tìm thấy HINH_DANG_CHUAN trong hardening.always.sql").not.toBeNull();

    const tuSql = [...khoi![1]!.matchAll(/\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g)].map(
      (m) => [m[1]!, m[2]!] as const,
    );
    expect(tuSql).toEqual(HINH_DANG_CHUAN);
  });

  // [vòng fix 2 — CR2] Meta-test của CỬA THEO ĐỐI TƯỢNG. Cùng khuôn, bốn cột thay vì hai — nên
  // Task 6 mở một hình dạng riêng cho app_unseal buộc phải sửa CẢ HAI file, và dòng đó ghi rõ
  // nó có hiệu lực ở BẢNG NÀO, POLICY NÀO.
  it("[CR2] danh sách ngoại lệ theo đối tượng trong hardening.always.sql khớp bản trong test", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/hardening.always.sql`, "utf8");
    const khoi = /NGOAI_LE_HINH_DANG constant text :=\s*\$q\$\(VALUES([\s\S]*?)\)\s*AS g\(/.exec(sql);
    expect(khoi, "không tìm thấy NGOAI_LE_HINH_DANG trong hardening.always.sql").not.toBeNull();

    const tuSql = [
      ...khoi![1]!.matchAll(/\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g),
    ]
      // Dòng RỖNG là chỗ giữ chỗ của danh sách trống trong SQL (VALUES không cho phép 0 hàng),
      // không phải một ngoại lệ. polname không bao giờ rỗng nên nó không khớp policy nào.
      .filter((m) => m[2] !== "")
      .map((m) => [m[1]!, m[2]!, m[3]!, m[4]!] as const);
    expect(tuSql).toEqual(NGOAI_LE_HINH_DANG);
  });

  // [vòng fix 1 — CR1] Hình dạng biểu thức policy, khoá bằng DANH SÁCH TRẮNG. Đọc pg_policy chứ
  // không đọc file .sql: thứ có hiệu lực là cái đang nằm trong catalog, và một policy tạo tay
  // sau triển khai cũng phải chịu cùng ràng buộc.
  //
  // [vòng fix 2 — I4] Test chạy TRONG một transaction có dựng sẵn một policy AS RESTRICTIVE
  // với biểu thức NGOÀI danh sách trắng, rồi ROLLBACK. Không có nó, nhánh "bỏ qua RESTRICTIVE"
  // là mã chết ở S0 (lược đồ hiện tại không có policy restrictive nào) — đúng dạng đột biến
  // "không test nào thấy vì lược đồ chưa có ca đó" mà vòng 1 đã bị hai lần. Đã đo: bỏ nhánh
  // miễn trừ mà không có fixture này thì KHÔNG test nào đỏ.
  it("[INV-F1] mọi biểu thức policy của bảng tenant nằm trong danh sách trắng hình dạng", async () => {
    const client = await db.pool.connect();
    await client.query("BEGIN");
    let rows: HangPolicy[];
    try {
      await client.query(
        "CREATE POLICY users_chan_bi_khoa ON users AS RESTRICTIVE " +
          "USING (status <> 'DISABLED') WITH CHECK (status <> 'DISABLED')",
      );
      rows = (
        await client.query<HangPolicy>(
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
        )
      ).rows;
      expect(
        rows.filter((r) => !r.cho_phep).length,
        "fixture RESTRICTIVE không dựng được — nhánh miễn trừ lại thành mã chết",
      ).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // Không có policy nào thì mọi khẳng định dưới đây rỗng ruột — chốt trước.
    const bangCoPolicy = new Set(rows.map((r) => r.ten_bang));
    expect([...bangCoPolicy].sort()).toEqual(bangTenant);

    // Bảng nào so với hình dạng nào: bảng có cột org_id so với 'co_org_id', bảng gốc của cây
    // tenant (id của nó LÀ tổ chức) so với 'bang_goc'.
    const coOrgId = new Set(
      (
        await db.pool.query<{ ten_bang: string }>(
          `SELECT ten_bang FROM (${CAU_PHU_RLS}) t`,
        )
      ).rows.map((r) => r.ten_bang),
    );

    const viPham: string[] = [];
    for (const hang of rows) {
      const nhan = `${hang.ten_bang}.${hang.ten_policy}`;
      const phamVi = coOrgId.has(hang.ten_bang) ? "co_org_id" : "bang_goc";

      // (3) Vế kiểm HÀNG MỚI phải viết tường minh với các lệnh CÓ hàng mới. Postgres có dùng
      // lại USING làm WITH CHECK khi bỏ trống (đã đo), nhưng dựa vào hành vi mặc định đó nghĩa
      // là người kiểm toán phải NHỚ nó, và nó biến mất ngay khi ai đó tách policy theo lệnh.
      // Cố ý KHÔNG đòi với 'r' (SELECT) và 'd' (DELETE): PostgreSQL TỪ CHỐI cú pháp đó
      // ("WITH CHECK cannot be applied to SELECT or DELETE").
      if (["*", "a", "w"].includes(hang.lenh) && hang.bieu_thuc_with_check === null) {
        viPham.push(`${nhan}: policy cho lệnh "${hang.lenh}" thiếu WITH CHECK tường minh`);
      }

      // [vòng fix 2 — I4] Policy AS RESTRICTIVE KHÔNG bị soi hình dạng. Nó chỉ THU HẸP tập
      // hàng (AND với OR của các policy PERMISSIVE) nên không biểu thức nào đặt vào đó mở thêm
      // được một hàng. Vòng 1 chặn nó, tức cấm một lớp phòng thủ CHẶT HƠN. Vế bảo vệ vẫn còn:
      // khẳng định "mọi bảng tenant phải có policy" bên trên và mục (i) của hardening đòi ít
      // nhất một policy PERMISSIVE, còn mọi policy PERMISSIVE vẫn phải khớp danh sách.
      if (!hang.cho_phep) continue;

      for (const [ten, bieuThuc] of [
        ["USING", hang.bieu_thuc_using],
        ["WITH CHECK", hang.bieu_thuc_with_check],
      ] as const) {
        if (bieuThuc === null) continue;

        // DANH SÁCH TRẮNG: biểu thức đã deparse phải khớp NGUYÊN VĂN một hình dạng được duyệt —
        // hoặc khuôn chuẩn (toàn cục), hoặc một ngoại lệ cấp cho ĐÚNG bảng và policy này. Mọi
        // thứ khác là sai, không cần biết nó viết ra sao.
        const duocDuyet =
          HINH_DANG_CHUAN.some(([pv, bt]) => pv === phamVi && bt === bieuThuc) ||
          NGOAI_LE_HINH_DANG.some(
            ([bang, pol, pv, bt]) =>
              bang === hang.ten_bang && pol === hang.ten_policy && pv === phamVi && bt === bieuThuc,
          );
        if (!duocDuyet) {
          viPham.push(
            `${nhan}: ${ten} = ${bieuThuc} — hình dạng không nằm ` +
              `trong danh sách được duyệt cho phạm vi "${phamVi}". Mở hình dạng mới bằng cách ` +
              "thêm một dòng vào HINH_DANG_CHUAN (nếu nó tự ràng buộc tenant và đúng cho MỌI " +
              "bảng) hoặc NGOAI_LE_HINH_DANG (nếu chỉ đúng cho bảng+policy này), ở CẢ " +
              "hardening.always.sql LẪN file test này.",
          );
        }
      }
    }

    expect(viPham).toEqual([]);
  });

  // [vòng fix 2 — I5] MỌI DÒNG TRONG DANH SÁCH TRẮNG PHẢI LOAD-BEARING.
  //
  // Đây là góc mù mà re-reviewer tìm ra và bảng 23 đột biến §15 KHÔNG có: hai dòng
  // 'public.'-đủ-tên của vòng 1 KHÔNG có test nào phủ — xoá cả hai khỏi hardening.always.sql
  // VÀ khỏi file này (meta-test vẫn khớp) thì pnpm test:int VẪN 86/86. Một đột biến SỐNG SÓT
  // im lặng. Và chính hai dòng đó là thứ làm lỗ hổng CR1-v2 chạy được.
  //
  // Phép kiểm: tập hình dạng ĐANG ĐƯỢC DÙNG bởi các policy PERMISSIVE thật trên bảng tenant
  // (sau khi trừ đi những gì cửa theo-đối-tượng đã phủ) phải BẰNG ĐÚNG HINH_DANG_CHUAN. Hai
  // chiều đều có ý nghĩa:
  //   thừa  -> một dòng trong danh sách trắng không ai dùng: nó chỉ mở rộng bề mặt tấn công.
  //   thiếu -> một hình dạng đang chạy mà không được duyệt (trùng với test trên, cố ý).
  it("[I5] danh sách trắng hình dạng đúng bằng tập hình dạng ĐANG được dùng — không dòng thừa", async () => {
    const { rows } = await db.pool.query<HangPolicy>(
      "SELECT c.relname AS ten_bang, p.polname AS ten_policy, p.polcmd AS lenh, " +
        "       p.polpermissive AS cho_phep, " +
        "       pg_get_expr(p.polqual, p.polrelid) AS bieu_thuc_using, " +
        "       pg_get_expr(p.polwithcheck, p.polrelid) AS bieu_thuc_with_check " +
        "  FROM pg_policy p " +
        "  JOIN pg_class c ON c.oid = p.polrelid " +
        "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
        " WHERE n.nspname = 'public' AND c.relname = ANY($1)",
      [bangTenant],
    );
    expect(rows.length, "không có policy nào thì phép kiểm này rỗng ruột").toBeGreaterThan(0);

    const coOrgId = new Set(
      (await db.pool.query<{ ten_bang: string }>(`SELECT ten_bang FROM (${CAU_PHU_RLS}) t`)).rows.map(
        (r) => r.ten_bang,
      ),
    );

    const dangDung = new Set<string>();
    for (const hang of rows) {
      if (!hang.cho_phep) continue; // RESTRICTIVE không bị soi hình dạng — xem test trên.
      const phamVi = coOrgId.has(hang.ten_bang) ? "co_org_id" : "bang_goc";
      for (const bieuThuc of [hang.bieu_thuc_using, hang.bieu_thuc_with_check]) {
        if (bieuThuc === null) continue;
        const daCoNgoaiLe = NGOAI_LE_HINH_DANG.some(
          ([bang, pol, pv, bt]) =>
            bang === hang.ten_bang && pol === hang.ten_policy && pv === phamVi && bt === bieuThuc,
        );
        if (!daCoNgoaiLe) dangDung.add(`${phamVi}|${bieuThuc}`);
      }
    }

    expect(
      [...dangDung].sort(),
      "Danh sách trắng toàn cục KHÔNG bằng tập hình dạng đang chạy. Một dòng thừa là bề mặt " +
        "tấn công mở sẵn mà không ai dùng; một dòng thiếu là policy đang chạy ngoài khuôn.",
    ).toEqual(HINH_DANG_CHUAN.map(([pv, bt]) => `${pv}|${bt}`).sort());
  });

  // [vòng fix 2 — CR2] Mặt còn lại của cửa theo-đối-tượng: một ngoại lệ CHẾT (bảng hoặc policy
  // đã bị đổi/xoá) phải ĐỎ, không được nằm lại im lặng. Ở S0 danh sách RỖNG nên phép kiểm này
  // chỉ khoá khuôn; nó có nội dung ngay khi Task 6 thêm dòng đầu tiên.
  it("[CR2] mỗi ngoại lệ hình dạng ứng với một policy CÓ THẬT — không có ngoại lệ chết", async () => {
    const { rows } = await db.pool.query<{ khoa: string }>(
      "SELECT c.relname || '|' || p.polname || '|' || " +
        "       coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || " +
        "       coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS khoa " +
        "  FROM pg_policy p " +
        "  JOIN pg_class c ON c.oid = p.polrelid " +
        "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
        " WHERE n.nspname = 'public'",
    );
    const chet = NGOAI_LE_HINH_DANG.filter(
      ([bang, pol, , bt]) =>
        !rows.some((r) => {
          const [rBang, rPol, rUsing, rCheck] = r.khoa.split("|");
          return rBang === bang && rPol === pol && (rUsing === bt || rCheck === bt);
        }),
    );
    expect(chet, "ngoại lệ hình dạng không ứng với policy nào đang tồn tại").toEqual([]);
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
  //   - [CR3] app_api CHỈ có UPDATE trên đúng cột `name` của organizations, không phải UPDATE
  //     cả bảng: UPDATE trên `slug` (UNIQUE toàn cục) là một oracle xuyên tổ chức. Xem khối
  //     giải thích trên CREATE TABLE organizations ở 002 và test đối kháng bên dưới.
  it("quyền bảng của app_api/app_unseal đúng bằng những gì đã quyết định, không hơn", async () => {
    const { rows } = await db.pool.query<{ grantee: string; bang: string; quyen: string }>(
      "SELECT grantee, table_name AS bang, string_agg(privilege_type, ',' ORDER BY privilege_type) AS quyen " +
        "  FROM information_schema.role_table_grants " +
        " WHERE table_schema = 'public' AND grantee IN ('app_api', 'app_unseal') " +
        " GROUP BY 1, 2 ORDER BY 1, 2",
    );
    // [vòng fix 2 — Minor] users chỉ còn SELECT ở MỨC BẢNG: INSERT/UPDATE nay là quyền CỘT
    // (đóng oracle users_pkey — xem 002). Chính vì thế khẳng định này KHÔNG đủ một mình, và
    // test [M5] ngay dưới là lớp bắt buộc chứ không phải lớp trang trí.
    expect(rows).toEqual([
      { grantee: "app_api", bang: "organizations", quyen: "SELECT" },
      { grantee: "app_api", bang: "users", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "organizations", quyen: "SELECT" },
    ]);
  });

  // [vòng fix 1 — M5] Khẳng định trên đọc role_table_grants nên nó MÙ với quyền CỘT. Đã đo:
  // sau bản vá CR3, "GRANT UPDATE (name) ON organizations TO app_api" KHÔNG còn xuất hiện dòng
  // UPDATE nào trong role_table_grants — quyền cột chỉ hiện ở role_column_grants. Nghĩa là nếu
  // chỉ giữ khẳng định trên thì nó xanh VÌ LÝ DO SAI, và một "GRANT UPDATE (slug)" thêm vào sau
  // này sẽ đi qua im lặng. Đây là lớp khoá đúng chỗ đó.
  it("[M5] quyền CỘT của app_api/app_unseal đúng bằng những gì đã quyết định", async () => {
    const { rows } = await db.pool.query<{ grantee: string; bang: string; cot: string; quyen: string }>(
      "SELECT grantee, table_name AS bang, column_name AS cot, privilege_type AS quyen " +
        "  FROM information_schema.role_column_grants " +
        " WHERE table_schema = 'public' AND grantee IN ('app_api', 'app_unseal') " +
        "   AND privilege_type <> 'SELECT' " +
        " ORDER BY 1, 2, 3, 4",
    );
    // Chỉ liệt kê quyền GHI: SELECT theo cột là hệ quả cơ học của GRANT SELECT cả bảng (một
    // dòng cho MỖI cột) nên khoá nó ở đây chỉ nhân bản khẳng định trên và vỡ ở mọi lần thêm cột.
    // [vòng fix 2 — Minor] users nay cũng cấp theo CỘT. Ba vắng mặt là load-bearing, không
    // phải sự tình cờ, và mỗi cái đóng một đường đi:
    //   `id`         KHÔNG có INSERT  -> users_pkey không dùng làm oracle xuyên tổ chức được
    //                                    (INSERT với id CÓ THẬT của tổ chức khác và với id
    //                                    không ai dùng nay trả CÙNG một "permission denied").
    //   `org_id`     KHÔNG có UPDATE  -> không chuyển được một hàng sang tổ chức khác.
    //   `created_at` KHÔNG có gì      -> đã có DEFAULT; quyền không dùng tới thì không cấp.
    expect(rows).toEqual([
      { grantee: "app_api", bang: "organizations", cot: "name", quyen: "UPDATE" },
      { grantee: "app_api", bang: "users", cot: "email", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "email", quyen: "UPDATE" },
      { grantee: "app_api", bang: "users", cot: "full_name", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "full_name", quyen: "UPDATE" },
      { grantee: "app_api", bang: "users", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "status", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "status", quyen: "UPDATE" },
    ]);
  });

  // [vòng fix 1 — M5] Cùng góc mù, hướng khác: cả hai view trên đều lọc theo grantee, nên một
  // "GRANT ... TO PUBLIC" (mọi role trong database, kể cả role sẽ được tạo sau) không hiện ra ở
  // bất kỳ khẳng định nào. Bảng nghiệp vụ KHÔNG được cấp gì cho PUBLIC.
  it("[M5] không bảng nghiệp vụ nào trong public cấp quyền cho PUBLIC", async () => {
    const { rows } = await db.pool.query<{ bang: string; quyen: string }>(
      "SELECT table_name AS bang, privilege_type AS quyen " +
        "  FROM information_schema.role_table_grants " +
        " WHERE table_schema = 'public' AND grantee = 'PUBLIC' ORDER BY 1, 2",
    );
    expect(rows).toEqual([]);
  });

  // [NỢ ADR-006] Ràng buộc toàn cục "không role nào bao trùm role kia" ĐANG BỊ VI PHẠM ở S0, và
  // nó KHÔNG thoả được bằng bất kỳ thao tác nào trong Task 4: quyền duy nhất của app_unseal là
  // SELECT trên organizations, mà app_api cũng có; kể cả gỡ sạch quyền thì tập rỗng vẫn là tập
  // con. Nó chỉ có nội dung khi app_unseal được cấp quyền ĐỘC QUYỀN trên bảng khoá riêng RFQ.
  //
  // Khẳng định dưới đây cố ý ĐẢO CHIỀU — nó khẳng định trạng thái VI PHẠM là đúng-lúc-này. Khi
  // task khoá riêng RFQ cấp quyền độc quyền cho app_unseal, test này ĐỎ NGAY, và người sửa nó
  // phải lật `true` thành `false` và xoá ghi chú này. Nếu thay bằng một khẳng định thuận chiều
  // (hoặc không có gì, như vòng trước) thì thời điểm ràng buộc trở nên thoả được sẽ trôi qua
  // trong im lặng — đúng cách một khoản nợ kiến trúc biến mất khỏi tầm nhìn.
  it("[NỢ ADR-006] app_unseal vẫn là tập con quyền của app_api — chưa thoả được ở S0", async () => {
    const { rows } = await db.pool.query<{ grantee: string; khoa: string }>(
      "SELECT grantee, table_name || ':' || privilege_type AS khoa " +
        "  FROM information_schema.role_table_grants " +
        " WHERE table_schema = 'public' AND grantee IN ('app_api', 'app_unseal') " +
        "UNION ALL " +
        "SELECT grantee, table_name || '.' || column_name || ':' || privilege_type " +
        "  FROM information_schema.role_column_grants " +
        " WHERE table_schema = 'public' AND grantee IN ('app_api', 'app_unseal')",
    );
    const cuaApi = new Set(rows.filter((r) => r.grantee === "app_api").map((r) => r.khoa));
    const cuaUnseal = rows.filter((r) => r.grantee === "app_unseal").map((r) => r.khoa);

    expect(cuaUnseal.length).toBeGreaterThan(0); // chống rỗng ruột
    const baoTrum = cuaUnseal.every((k) => cuaApi.has(k));
    expect(
      baoTrum,
      "app_unseal đã có quyền mà app_api KHÔNG có — ràng buộc ADR-006 nay THOẢ ĐƯỢC. Lật " +
        "khẳng định này thành false và xoá ghi chú [NỢ ADR-006].",
    ).toBe(true);
  });

  // [vòng fix 1 — CR3] TEST ĐỐI KHÁNG cho oracle slug. Đây là lỗ DUY NHẤT khai thác được ngay
  // ở b009ddc: RLS bật đầy đủ, tenant context đúng, không injection, không IDOR — mà một
  // UPDATE hợp pháp trên hàng của CHÍNH MÌNH vẫn trả lời được câu hỏi "tổ chức X có trên sàn
  // không", qua chính thông báo lỗi của ràng buộc UNIQUE toàn cục.
  //
  // Phép đo phải SẮC: nó không đủ khi chỉ kiểm "UPDATE slug thất bại". Điều cần chứng minh là
  // hai truy vấn — một nhắm slug CÓ THẬT của tổ chức khác, một nhắm slug KHÔNG AI DÙNG — trả
  // về CÙNG MỘT thông báo, tức kênh phụ có băng thông bằng không.
  it("[CR3] app_api không dùng được ràng buộc UNIQUE của slug làm oracle xuyên tổ chức", async () => {
    const { rows: toChuc } = await db.pool.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM organizations ORDER BY slug",
    );
    const orgA = toChuc[0]!;
    const slugCuaB = toChuc[1]!.slug;
    expect(slugCuaB).not.toBe(orgA.slug); // chống rỗng ruột: phải có hai tổ chức thật

    const client = await apiPool.connect();
    try {
      await client.query("SELECT set_config('app.org_id', $1, false)", [orgA.id]);

      const thu = async (slug: string): Promise<string> =>
        client
          .query("UPDATE organizations SET slug = $1 WHERE id = app_current_org_id()", [slug])
          .then(() => "THÀNH CÔNG")
          .catch((loi: Error) => loi.message);

      const slugTonTai = await thu(slugCuaB);
      const slugKhongAiDung = await thu("khong-ai-dung-slug-nay-bao-gio");

      expect(
        slugTonTai,
        "UPDATE slug thành công hoặc báo lỗi trùng khoá — cả hai đều là oracle. app_api chỉ " +
          "được UPDATE đúng cột `name` (xem 002).",
      ).toMatch(/permission denied/i);
      expect(
        slugKhongAiDung,
        `Hai truy vấn trả về thông báo KHÁC NHAU — đó chính là oracle nhị phân: ` +
          `[${slugTonTai}] vs [${slugKhongAiDung}]`,
      ).toBe(slugTonTai);

      // Và mặt còn lại: bản vá không được làm hỏng đường đi hợp lệ.
      await expect(
        client.query("UPDATE organizations SET name = $1 WHERE id = app_current_org_id()", [
          "Ten Moi",
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      // Trả lại tên cũ để các test khác không phụ thuộc thứ tự chạy.
      await db.pool.query("UPDATE organizations SET name = 'Cong ty A' WHERE id = $1", [orgA.id]);
      client.release();
    }
  });

  // [vòng fix 2 — Minor] CÙNG LỚP VỚI CR3, trên users_pkey. Nguyên lý "ràng buộc duy nhất toàn
  // cục rò rỉ xuyên tổ chức qua chính thông báo lỗi" được viết ngay trong khối CREATE TABLE
  // users (002:119-122) rồi KHÔNG áp cho `id` của chính bảng đó — đúng khuôn "viết nguyên lý ở
  // đây, quên áp cách đó 50 dòng" mà CR3 vừa sửa cho organizations.slug.
  //
  // Khai thác thực tế ≈ 0 (id sinh bằng gen_random_uuid, 122 bit — không đoán được như slug),
  // nên phép đo này khoá KHUÔN chứ không phải một lỗ đang cháy. Vẫn phải SẮC như CR3: chứng
  // minh hai truy vấn — một nhắm id CÓ THẬT của tổ chức khác, một nhắm id không ai dùng — trả
  // về CÙNG MỘT thông báo, tức kênh phụ có băng thông bằng không.
  it("[Minor] app_api không dùng được ràng buộc users_pkey làm oracle xuyên tổ chức", async () => {
    const { rows: toChuc } = await db.pool.query<{ id: string }>(
      "SELECT id FROM organizations ORDER BY slug",
    );
    const orgA = toChuc[0]!.id;
    const { rows: nguoiCuaB } = await db.pool.query<{ id: string }>(
      "SELECT u.id FROM users u WHERE u.org_id = $1",
      [toChuc[1]!.id],
    );
    expect(nguoiCuaB.length, "chống rỗng ruột: tổ chức B phải có người").toBeGreaterThan(0);

    const client = await apiPool.connect();
    try {
      await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);

      const thu = async (id: string, email: string): Promise<string> =>
        client
          .query(
            "INSERT INTO users (id, org_id, email, full_name) VALUES ($1, app_current_org_id(), $2, 'X')",
            [id, email],
          )
          .then(() => "THÀNH CÔNG")
          .catch((loi: Error) => loi.message);

      const idTonTai = await thu(nguoiCuaB[0]!.id, "do-1@example.com");
      const idKhongAiDung = await thu(
        "00000000-0000-4000-8000-0000000000ff",
        "do-2@example.com",
      );

      expect(
        idTonTai,
        "INSERT ghi thẳng `id` thành công hoặc báo trùng khoá — cả hai đều là oracle. app_api " +
          "chỉ được INSERT các cột (org_id, email, full_name, status), xem 002.",
      ).toMatch(/permission denied/i);
      expect(
        idKhongAiDung,
        `Hai truy vấn trả về thông báo KHÁC NHAU — đó chính là oracle nhị phân: ` +
          `[${idTonTai}] vs [${idKhongAiDung}]`,
      ).toBe(idTonTai);

      // Mặt còn lại: bản vá không được làm hỏng đường đi hợp lệ của ứng dụng.
      await expect(
        client.query(
          "INSERT INTO users (org_id, email, full_name) VALUES (app_current_org_id(), $1, 'X')",
          ["duong-hop-le@example.com"],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        client.query("UPDATE users SET status = 'SUSPENDED' WHERE email = $1", [
          "duong-hop-le@example.com",
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
      // Và `org_id` KHÔNG được UPDATE: chuyển một hàng sang tổ chức khác không phải đường đi
      // hợp lệ nào của app_api.
      await expect(
        client.query("UPDATE users SET org_id = $1 WHERE email = $2", [
          toChuc[1]!.id,
          "duong-hop-le@example.com",
        ]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      // Dọn CẢ hai email dò: nếu bản vá bị gỡ, một trong hai INSERT dò SẼ thành công và để lại
      // hàng thừa làm các test đếm hàng phía sau đỏ vì lý do sai.
      await db.pool.query(
        "DELETE FROM users WHERE email IN ('duong-hop-le@example.com', 'do-1@example.com', 'do-2@example.com')",
      );
      client.release();
    }
  });

  // [vòng fix 1 — I2] Đường đọc VÒNG QUA RLS qua VIEW.
  //
  // PHẠM VI CỦA TEST NÀY, mô tả theo thứ ĐO ĐƯỢC chứ không theo thứ đã thiết kế: nó đo (a) lỗ
  // hổng có thật — view mặc định của PG15+ đọc xuyên tổ chức — và (b) "WITH (security_invoker
  // = true)" thật sự đóng lỗ đó về mặt HÀNH VI. Nó KHÔNG đo được rằng hardening bắt được:
  // truy vấn phát hiện ở đây là một bản viết lại, nên vô hiệu hoá mục (C) của
  // hardening.always.sql KHÔNG làm test này đỏ (đã đo bằng đột biến V6 — test này SỐNG SÓT).
  // Phần cưỡng chế được đo ở "[I2] VIEW/MATVIEW/SECURITY DEFINER ... làm migrate() GÃY" trong
  // db/migrations.int.test.ts, chạy qua migrate() THẬT.
  it("[I2] VIEW/MATVIEW/SECURITY DEFINER trên bảng tenant bị hardening bắt, view security_invoker thì không", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE VIEW moi_nguoi AS SELECT * FROM users");
      await client.query("GRANT SELECT ON moi_nguoi TO app_api");
      const { rows: org } = await client.query<{ id: string }>(
        "SELECT id FROM organizations ORDER BY slug LIMIT 1",
      );
      await client.query("SET LOCAL ROLE app_api");
      await client.query("SELECT set_config('app.org_id', $1, true)", [org[0]!.id]);

      const quaBang = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM users");
      const quaView = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM moi_nguoi",
      );
      expect(Number(quaBang.rows[0]!.n)).toBe(1);
      expect(
        Number(quaView.rows[0]!.n),
        "VIEW mặc định của PG15+ (security_invoker = false) đọc dưới quyền CHỦ SỞ HỮU — nếu " +
          "phép đo này bằng 1 thì lỗ hổng đã biến mất và cả mục (C) của hardening là thừa.",
      ).toBe(2);

      await client.query("RESET ROLE");
      const cauDocVong =
        "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        " WHERE n.nspname = 'public' AND c.relkind IN ('v','m') AND c.relname = 'moi_nguoi' " +
        "   AND coalesce(array_to_string(c.reloptions, ','), '') " +
        "         !~* '\\msecurity_invoker\\s*=\\s*(true|on|1)\\M'";
      const truoc = await client.query<{ n: number }>(cauDocVong);
      expect(truoc.rows[0]!.n, "view chưa bật security_invoker phải bị đếm là vi phạm").toBe(1);

      await client.query("ALTER VIEW moi_nguoi SET (security_invoker = true)");
      const sau = await client.query<{ n: number }>(cauDocVong);
      expect(sau.rows[0]!.n, "view đã bật security_invoker KHÔNG được bắt nhầm").toBe(0);

      // Và cửa đó thật sự đóng lỗ hổng, không chỉ làm hardening im: đo lại HÀNH VI.
      await client.query("SET LOCAL ROLE app_api");
      const quaViewSau = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM moi_nguoi",
      );
      expect(Number(quaViewSau.rows[0]!.n)).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
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
