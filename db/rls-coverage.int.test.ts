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
 * [vòng fix 2 — CR2 / vòng fix 3 — I2] Bản sao TypeScript của NGOAI_LE_HINH_DANG — CỬA THEO
 * ĐỐI TƯỢNG, khoá theo SÁU cột: (bảng, policy, lệnh, vai trò, phạm vi, biểu thức).
 *
 * Vòng 1 chỉ có MỘT danh sách khoá theo (pham_vi, bieu_thuc), tức TOÀN CỤC. Vòng 2 thu về
 * (bảng, policy) — nhưng vẫn KHÔNG theo LỆNH và ROLE, trong khi chính ghi chú của nó mô tả cửa
 * bằng "policy riêng FOR SELECT TO app_unseal". Đo được trên PostgreSQL 16.15: cửa cấp cho
 * (bao_gia, bg_unseal) rồi "ALTER POLICY bg_unseal ON bao_gia TO app_api" -> hardening VẪN
 * DUYỆT, và app_api gắn tổ chức A đọc bao_gia ra giá của tổ chức B. Nay đổi lệnh HAY đổi role
 * đều làm dòng ngoại lệ hết khớp.
 *
 * `lenh` là pg_policy.polcmd nguyên văn ('*' ALL, 'r' SELECT, 'a' INSERT, 'w' UPDATE,
 * 'd' DELETE). `vai_tro` là tên role sắp xếp nối bằng ','; policy áp cho PUBLIC ghi 'PUBLIC'
 * (polroles = {0}, OID 0 không có hàng trong pg_roles — nếu để nó thành chuỗi rỗng thì chỗ
 * RỘNG NHẤT lại trùng giá trị giữ chỗ của dòng rỗng trong file SQL).
 *
 * RỖNG là trạng thái đúng ở S0, và có test bên dưới đòi mỗi dòng ở đây phải ứng với một policy
 * CÓ THẬT — ngoại lệ chết (bảng/policy đã bị xoá) là ĐỎ, không phải rác im lặng.
 */
type DongNgoaiLe = readonly [
  bang: string,
  polname: string,
  lenh: string,
  vaiTro: string,
  phamVi: string,
  bieuThuc: string,
];
const NGOAI_LE_HINH_DANG: readonly DongNgoaiLe[] = [];

/** Danh tính của một policy đủ để so với một dòng ngoại lệ. */
type DanhTinhPolicy = { ten_bang: string; ten_policy: string; lenh: string; vai_tro: string };

/** MỘT dòng ngoại lệ có khớp MỘT policy đang chạy không — SÁU cột, không phải bốn. */
function dongKhopPolicy(
  dong: DongNgoaiLe,
  hang: DanhTinhPolicy,
  phamVi: string,
  bieuThuc: string,
): boolean {
  const [bang, pol, lenh, vaiTro, pv, bt] = dong;
  return (
    bang === hang.ten_bang &&
    pol === hang.ten_policy &&
    lenh === hang.lenh &&
    vaiTro === hang.vai_tro &&
    pv === phamVi &&
    bt === bieuThuc
  );
}

/** Có dòng ngoại lệ nào duyệt biểu thức này cho đúng policy này không. */
function ngoaiLeKhop(hang: DanhTinhPolicy, phamVi: string, bieuThuc: string): boolean {
  return NGOAI_LE_HINH_DANG.some((dong) => dongKhopPolicy(dong, hang, phamVi, bieuThuc));
}

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

/**
 * [vòng fix 3 — I2] Bản sao TypeScript của BIEU_THUC_VAI_TRO trong hardening.always.sql.
 * COLLATE "C" để thứ tự không phụ thuộc collation của database.
 */
const CAU_VAI_TRO =
  "       array_to_string(ARRAY(SELECT coalesce(r.rolname::text, 'PUBLIC') " +
  "                               FROM unnest(p.polroles) AS o(oid) " +
  "                               LEFT JOIN pg_roles r ON r.oid = o.oid " +
  "                              ORDER BY coalesce(r.rolname::text, 'PUBLIC') COLLATE \"C\"), ',') " +
  "         AS vai_tro, ";

interface HangPolicy {
  ten_bang: string;
  ten_policy: string;
  lenh: string;
  /** [vòng fix 3 — I2] Tên role của policy, sắp xếp nối ','; PUBLIC ghi 'PUBLIC'. */
  vai_tro: string;
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

  // [vòng fix 2 — CR2 / vòng fix 3 — I2] Meta-test của CỬA THEO ĐỐI TƯỢNG. Cùng khuôn, SÁU cột
  // thay vì hai — nên Task 6 mở một hình dạng riêng cho app_unseal buộc phải sửa CẢ HAI file,
  // và dòng đó ghi rõ nó có hiệu lực ở BẢNG NÀO, POLICY NÀO, LỆNH NÀO, CHO ROLE NÀO.
  it("[CR2] danh sách ngoại lệ theo đối tượng trong hardening.always.sql khớp bản trong test", () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/hardening.always.sql`, "utf8");
    const khoi =
      /NGOAI_LE_HINH_DANG constant text :=\s*\$q\$\(VALUES([\s\S]*?)\)\s*AS g\(([^)]*)\)/.exec(sql);
    expect(khoi, "không tìm thấy NGOAI_LE_HINH_DANG trong hardening.always.sql").not.toBeNull();

    // [vòng fix 3 — I2] KHOÁ CHÍNH DANH SÁCH CỘT, không chỉ nội dung. Ở S0 danh sách RỖNG,
    // nên nếu chỉ so nội dung thì bỏ bớt một cột khỏi khoá vẫn cho ra [] === [] và đi lọt im
    // lặng — đúng lớp "phép kiểm không thể đo vì lược đồ chưa có ca đó". Sáu tên cột này LÀ
    // các trục mà một ngoại lệ bị giới hạn vào; mất một trục là nới hàng rào.
    expect(
      khoi![2]!.split(",").map((t) => t.trim()),
      "cột khoá của NGOAI_LE_HINH_DANG đã đổi — mỗi cột là một trục thu hẹp ngoại lệ",
    ).toEqual(["bang", "polname", "lenh", "vai_tro", "pham_vi", "bieu_thuc"]);

    // [vòng fix 3 — I2] SÁU cột. Meta-test này là thứ buộc Task 6 sửa CẢ HAI file khi mở một
    // hình dạng, và là thứ sẽ ĐỎ nếu ai đó lặng lẽ bỏ bớt một cột khỏi khoá ở một bên.
    const tuSql = [
      ...khoi![1]!.matchAll(
        /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
      ),
    ]
      // Dòng RỖNG là chỗ giữ chỗ của danh sách trống trong SQL (VALUES không cho phép 0 hàng),
      // không phải một ngoại lệ. polname không bao giờ rỗng nên nó không khớp policy nào.
      .filter((m) => m[2] !== "")
      .map((m) => [m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!] as const);
    expect(tuSql).toEqual(NGOAI_LE_HINH_DANG);
  });

  // [vòng fix 3 — I2] Ở S0 NGOAI_LE_HINH_DANG RỖNG, nên toàn bộ logic so khớp sáu cột là MÃ
  // CHẾT với mọi test chạy trên lược đồ thật: bỏ vế "lenh" hay vế "vai_tro" khỏi hàm khớp
  // không làm test nào đỏ. Đó đúng là lớp đột biến sống sót mà vòng này phải đóng, nên đóng
  // bằng một phép đo TRỰC TIẾP trên hàm khớp thay vì chờ Task 6 tạo ra ca dùng đầu tiên.
  it("[I2] khớp ngoại lệ đòi ĐỦ SÁU cột — lệch một cột là hết khớp", () => {
    const dong = [
      "bao_gia",
      "bg_unseal",
      "r",
      "app_unseal",
      "co_org_id",
      "true",
    ] as const satisfies DongNgoaiLe;
    const policy = {
      ten_bang: "bao_gia",
      ten_policy: "bg_unseal",
      lenh: "r",
      vai_tro: "app_unseal",
    };
    expect(
      dongKhopPolicy(dong, policy, "co_org_id", "true"),
      "khớp đúng sáu cột mà vẫn trượt — cửa đang chặt tới mức vô dụng",
    ).toBe(true);

    const lech: [string, () => boolean][] = [
      ["bảng", () => dongKhopPolicy(dong, { ...policy, ten_bang: "users" }, "co_org_id", "true")],
      ["policy", () => dongKhopPolicy(dong, { ...policy, ten_policy: "khac" }, "co_org_id", "true")],
      ["lệnh", () => dongKhopPolicy(dong, { ...policy, lenh: "*" }, "co_org_id", "true")],
      ["role", () => dongKhopPolicy(dong, { ...policy, vai_tro: "app_api" }, "co_org_id", "true")],
      ["phạm vi", () => dongKhopPolicy(dong, policy, "bang_goc", "true")],
      ["biểu thức", () => dongKhopPolicy(dong, policy, "co_org_id", "(1 = 1)")],
    ];
    for (const [nhan, do_] of lech) {
      expect(do_(), `lệch cột "${nhan}" mà ngoại lệ VẪN khớp — trục đó không nằm trong khoá`).toBe(
        false,
      );
    }
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
            CAU_VAI_TRO +
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

    // [vòng fix 3 — I2] Cột `vai_tro` phải ĐỌC RA ĐƯỢC, nếu không cả khoá sáu cột chỉ là
    // trang trí. Mọi policy ở S0 đều áp cho PUBLIC (polroles = {0}), và OID 0 KHÔNG có hàng
    // trong pg_roles — viết truy vấn theo kiểu JOIN thẳng sẽ cho ra chuỗi RỖNG, tức chỗ RỘNG
    // NHẤT lại trùng giá trị giữ chỗ của dòng rỗng trong file SQL.
    expect(
      [...new Set(rows.map((r) => r.vai_tro))],
      "vai_tro không kết xuất được PUBLIC — khoá sáu cột đang so bằng chuỗi rỗng",
    ).toEqual(["PUBLIC"]);

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
          ngoaiLeKhop(hang, phamVi, bieuThuc);
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
    // [vòng fix 3 — đột biến X2] Bản sao của nhánh miễn trừ RESTRICTIVE nằm CÁCH bản trong
    // "[INV-F1] mọi biểu thức policy..." đúng 66 dòng, và vòng 2 chỉ dựng fixture cho bản kia.
    // Đo được: xoá "if (!hang.cho_phep) continue" Ở ĐÂY thì 19/19 test VẪN XANH — mã chết ở S0.
    // Nay chính test này cũng chạy trong một transaction có sẵn một policy RESTRICTIVE với biểu
    // thức NGOÀI danh sách trắng, nên bỏ nhánh miễn trừ là ĐỎ ở CẢ HAI chỗ.
    const client = await db.pool.connect();
    let rows: HangPolicy[];
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE POLICY users_chan_bi_khoa ON users AS RESTRICTIVE " +
          "USING (status <> 'DISABLED') WITH CHECK (status <> 'DISABLED')",
      );
      rows = (
        await client.query<HangPolicy>(
          "SELECT c.relname AS ten_bang, p.polname AS ten_policy, p.polcmd AS lenh, " +
            "       p.polpermissive AS cho_phep, " +
            CAU_VAI_TRO +
            "       pg_get_expr(p.polqual, p.polrelid) AS bieu_thuc_using, " +
            "       pg_get_expr(p.polwithcheck, p.polrelid) AS bieu_thuc_with_check " +
            "  FROM pg_policy p " +
            "  JOIN pg_class c ON c.oid = p.polrelid " +
            "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
            " WHERE n.nspname = 'public' AND c.relname = ANY($1)",
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
        if (!ngoaiLeKhop(hang, phamVi, bieuThuc)) dangDung.add(`${phamVi}|${bieuThuc}`);
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
    const { rows } = await db.pool.query<HangPolicy>(
      "SELECT c.relname AS ten_bang, p.polname AS ten_policy, p.polcmd AS lenh, " +
        "       p.polpermissive AS cho_phep, " +
        CAU_VAI_TRO +
        "       pg_get_expr(p.polqual, p.polrelid) AS bieu_thuc_using, " +
        "       pg_get_expr(p.polwithcheck, p.polrelid) AS bieu_thuc_with_check " +
        "  FROM pg_policy p " +
        "  JOIN pg_class c ON c.oid = p.polrelid " +
        "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
        " WHERE n.nspname = 'public'",
    );
    // [vòng fix 3 — I2] Khớp đủ SÁU cột: một ngoại lệ cấp cho FOR SELECT TO app_unseal mà
    // policy đã bị ALTER sang TO app_api cũng là ngoại lệ CHẾT, không chỉ khi bảng/policy mất.
    const chet = NGOAI_LE_HINH_DANG.filter(
      (dong) =>
        !rows.some((r) =>
          [r.bieu_thuc_using, r.bieu_thuc_with_check].some(
            (bt) => bt !== null && dongKhopPolicy(dong, r, dong[4], bt),
          ),
        ),
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
    // [Task 5] Hai bảng sổ kiểm toán chỉ có SELECT ở MỨC BẢNG — INSERT của chúng cũng là quyền
    // CỘT (đóng oracle audit_events_pkey, cùng khuôn users). Bất biến B4 ("không role nào có
    // UPDATE/DELETE/TRUNCATE trên bảng sổ") KHÔNG được khẳng định ở đây: view này lọc theo
    // grantee nên nó mù với PUBLIC, và nó mù hẳn với quyền cột. Phép kiểm có thẩm quyền cho B4
    // đọc pg_class.relacl + pg_attribute.attacl ở db/audit-append-only.int.test.ts.
    // [Task 8] Bốn bảng mới của 005. Ba vắng mặt là load-bearing và mỗi cái trả lời câu hỏi
    // "ai sửa được ma trận quyền, bằng đường nào?":
    //   `permissions`, `roles`, `role_permissions` chỉ SELECT -> một app_api BỊ CHIẾM không tự
    //     cấp quyền cho vai trò của mình được; đường sửa DUY NHẤT là một migration đánh số mới.
    //     Đó là bất biến D3 nhìn từ phía quyền, và nó là lệch có chủ đích khỏi bản kế hoạch
    //     (bản đó cấp SELECT/INSERT/UPDATE/DELETE trên cả ba).
    //   `user_roles` có SELECT + DELETE ở mức bảng, INSERT là quyền CỘT (xem test [M5] dưới) —
    //     gán/thu hồi vai trò LÀ việc của ứng dụng, sửa MA TRẬN thì không.
    //   Không cấp gì cho app_unseal trên cả bốn: `hasPermission` nối qua `users`, mà app_unseal
    //     không có quyền đọc `users` (quyết định của 002), nên một GRANT ở đây sẽ là quyền
    //     không dùng được — đúng thứ 002 đã từ chối cấp "cho chắc".
    // [Task 9] Hai bảng mới của 006 chỉ hiện SELECT ở MỨC BẢNG: INSERT/UPDATE của chúng đều là
    // quyền CỘT (xem test [M5] dưới). Và app_unseal KHÔNG có dòng nào mới ở đây dù nó ĐƯỢC cấp
    // quyền trên `sessions` và `users` — vì quyền đó cấp theo CỘT, thứ view này MÙ hoàn toàn.
    // Đó chính là lý do khẳng định này một mình KHÔNG đủ.
    expect(rows).toEqual([
      { grantee: "app_api", bang: "audit_chain_anchors", quyen: "SELECT" },
      { grantee: "app_api", bang: "audit_events", quyen: "SELECT" },
      // [S1.5] `bid_receipts` co SELECT o MUC BANG, con `vendor_bid_versions` thi KHONG — va bat
      // doi xung ay la mot quyet dinh: bien nhan chua mot BAM cua ciphertext, con phong bi thi
      // chua chinh ciphertext. `app_api` phai doc lai duoc bien nhan cho nha cung cap; no khong
      // co viec gi voi phong bi.
      { grantee: "app_api", bang: "bid_receipts", quyen: "SELECT" },
      // [S1.3] Nam bang moi cua 010. `otp_rate_limits` la bang DUY NHAT co DELETE o muc bang,
      // va do la mot quyen THAT SU nguy hiem duoc cap CO Y THUC: mot api BI CHIEM xoa sach bang
      // nay la tat duoc E3(2). Khong tranh duoc neu giu E3 o tang ung dung - bo GRANT la bo luon
      // co che (dung han muc phai xoa duoc cua so cu), va thu hep xuong mot ham SECURITY DEFINER
      // la thu muc (C) cua hardening.always.sql CAM. Cung han che cau truc da ghi cho E3(1).
      { grantee: "app_api", bang: "guest_sessions", quyen: "SELECT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", quyen: "SELECT" },
      { grantee: "app_api", bang: "mfa_credentials", quyen: "SELECT" },
      { grantee: "app_api", bang: "org_procurement_policies", quyen: "SELECT" },
      { grantee: "app_api", bang: "organizations", quyen: "SELECT" },
      { grantee: "app_api", bang: "otp_rate_limits", quyen: "DELETE,SELECT" },
      // [Task 10] `outbox_jobs` của 007 chỉ hiện SELECT ở MỨC BẢNG: INSERT/UPDATE của nó đều là
      // quyền CỘT (xem test [M5] dưới). Và app_unseal KHÔNG có dòng nào — cố ý, và đó là một
      // LỆCH khỏi brief (brief cấp SELECT/INSERT/UPDATE mức bảng cho CẢ HAI role). Hôm nay
      // `apps/` rỗng nên runtime mở thầu không có dòng mã nào đọc hay ghi outbox; một quyền cấp
      // "cho chắc" là một quyền không ai gỡ ra nữa (khuôn 002 với `organizations`, 006 với
      // `sessions.expires_at`). Vì KHÔNG cấp gì, file 007 cũng KHÔNG làm khoản [NỢ ADR-006] xanh
      // vì lý do sai — test đảo chiều đang canh nó vẫn đúng.
      { grantee: "app_api", bang: "outbox_jobs", quyen: "SELECT" },
      { grantee: "app_api", bang: "permissions", quyen: "SELECT" },
      // [S1.2] Ba bang moi cua 009. `rfq_items` co DELETE o MUC BANG va do la lech co chu dinh
      // so voi hai bang kia: sua danh sach hang muc luc con DRAFT la viec binh thuong va no chi
      // bieu dien duoc bang DELETE. Thu gioi han NO theo trang thai cua RFQ cha la trigger
      // `rfq_items_chi_sua_khi_soan`, khong phai quyen — quyen khong biet trang thai.
      //
      // `rfq_approvals` KHONG co UPDATE lan DELETE cho bat ky role nao: mot chu ky phe duyet sua
      // duoc hay rut lai duoc trong im lang thi no khong phai chu ky.
      { grantee: "app_api", bang: "rfq_approvals", quyen: "SELECT" },
      { grantee: "app_api", bang: "rfq_budgets", quyen: "SELECT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", quyen: "SELECT" },
      { grantee: "app_api", bang: "rfq_invitations", quyen: "SELECT" },
      // [011] `rfq_items` mat DELETE o muc bang, `suppliers`/`supplier_contacts` mat UPDATE theo
      // cot: trong toan kho ma khong co mot cau nao dung chung. Nguyen tac do CHINH 008 phat
      // bieu — mot quyen cap 'cho chac' la mot quyen khong ai go ra nua — duoc ap cho app_unseal
      // va bi bo qua cho app_api. He qua cu the: `supplier_contacts.phone` LA kenh da dang ky cua
      // E2, va mot api bi chiem doi duoc so nhan OTP bang mot cau UPDATE ma KHONG sinh mot ban
      // ghi kiem toan nao.
      { grantee: "app_api", bang: "rfq_items", quyen: "SELECT" },
      { grantee: "app_api", bang: "rfq_packages", quyen: "SELECT" },
      { grantee: "app_api", bang: "rfq_unsealed_bids", quyen: "SELECT" },
      { grantee: "app_api", bang: "role_permissions", quyen: "SELECT" },
      { grantee: "app_api", bang: "roles", quyen: "SELECT" },
      { grantee: "app_api", bang: "sessions", quyen: "SELECT" },
      { grantee: "app_api", bang: "supplier_contacts", quyen: "SELECT" },
      { grantee: "app_api", bang: "suppliers", quyen: "SELECT" },
      // [S1.1] Hai bảng mới của 008 cũng chỉ hiện SELECT ở MỨC BẢNG — INSERT/UPDATE của chúng
      // đều là quyền CỘT. Và app_unseal KHÔNG có dòng nào ở đây, cũng không có dòng nào ở test
      // [M5] bên dưới: đó là ADR-013 mục 5 (hai bảng này chứa DỮ LIỆU CÁ NHÂN của người liên hệ,
      // và runtime mở thầu không có việc gì với sổ nhà cung cấp). Khác với `sessions`/`users`,
      // ở đây "không có dòng nào" là KẾT LUẬN ĐẦY ĐỦ chứ không phải hệ quả của việc view này mù
      // với quyền cột.
      // [S1.6] `unseal_requests`/`unseal_approvals` chi SELECT o muc bang; INSERT/UPDATE cua
      // chung deu la quyen COT. Va `rfq_unsealed_bids` — cho DUY NHAT ban ro duoc phep ton tai —
      // co SELECT cho app_api nhung KHONG co INSERT: `api` khong giai ma duoc nen no khong co gi
      // de ghi, va mot GRANT INSERT o day se cho phep no BIA mot ban ro.
      { grantee: "app_api", bang: "unseal_approvals", quyen: "SELECT" },
      { grantee: "app_api", bang: "unseal_requests", quyen: "SELECT" },
      { grantee: "app_api", bang: "user_roles", quyen: "DELETE,SELECT" },
      { grantee: "app_api", bang: "users", quyen: "SELECT" },
      { grantee: "app_api", bang: "vendor_bids", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "audit_chain_anchors", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "audit_events", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "organizations", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "rfq_unsealed_bids", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "unseal_approvals", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "unseal_requests", quyen: "SELECT" },
    ]);
  });

  // [vòng fix 1 — M5] Khẳng định trên đọc role_table_grants nên nó MÙ với quyền CỘT. Đã đo:
  // sau bản vá CR3, "GRANT UPDATE (name) ON organizations TO app_api" KHÔNG còn xuất hiện dòng
  // UPDATE nào trong role_table_grants — quyền cột chỉ hiện ở role_column_grants. Nghĩa là nếu
  // chỉ giữ khẳng định trên thì nó xanh VÌ LÝ DO SAI, và một "GRANT UPDATE (slug)" thêm vào sau
  // này sẽ đi qua im lặng. Đây là lớp khoá đúng chỗ đó.
  // [S1.2] MỘT KHE HỞ CỦA HAI KHẲNG ĐỊNH TRÊN, VÀ 009 VỪA MỞ RỘNG NÓ.
  //
  // `role_table_grants` mù với quyền CỘT (đã đo, xem [M5] ngay dưới); còn [M5] thì lọc
  // `privilege_type <> 'SELECT'` vì SELECT theo cột là hệ quả cơ học của GRANT SELECT cả bảng.
  // Giao của hai vế ấy là một VÙNG MÙ: **một GRANT SELECT THEO CỘT không xuất hiện ở khẳng định
  // nào.** `users` (006) đã nằm trong vùng đó, và 009 đưa `rfq_packages` vào cùng chỗ.
  //
  // Vì sao nó đáng đóng ngay chứ không ghi vào sổ nợ: cột được cấp cho `app_unseal` chính là
  // thứ trả lời câu hỏi của cổng chính sách S1.6 ("RFQ này đã CLOSED chưa" — C3, D1 vế 3).
  // Một `GRANT SELECT (title)` thêm vào sau này sẽ đi qua HOÀN TOÀN im lặng.
  it("[S1.2] quyền SELECT theo CỘT của app_unseal đúng bằng danh sách đã quyết định", async () => {
    const { rows } = await db.pool.query<{ bang: string; cot: string }>(
      "SELECT table_name AS bang, column_name AS cot " +
        "  FROM information_schema.role_column_grants " +
        " WHERE table_schema = 'public' AND grantee = 'app_unseal' " +
        "   AND privilege_type = 'SELECT' " +
        "   AND table_name NOT IN (SELECT table_name FROM information_schema.role_table_grants " +
        "                           WHERE table_schema = 'public' AND grantee = 'app_unseal' " +
        "                             AND privilege_type = 'SELECT') " +
        " ORDER BY 1, 2",
    );
    // Loại các bảng mà app_unseal có SELECT ở MỨC BẢNG (audit_events, ...): ở đó một dòng cho
    // mỗi cột là hệ quả cơ học, khoá chúng ở đây sẽ vỡ mỗi lần thêm cột. Còn lại đúng những
    // bảng mà quyền đọc được cắt THEO CỘT — và đó là những quyết định phải nhìn thấy được.
    expect(rows).toEqual([
      // [S1.4 / 017] `rfq_key_material` la bang DAU TIEN ma app_unseal doc duoc mot cot ma
      // app_api KHONG doc duoc. `wrapped_private_key` o day chinh la thu dong khoan [NO ADR-006]
      // ben duoi — xem test "[ADR-006] khong role nao bao trum role kia".
      // [S1.6] BA cot cua `rfq_invitations`, khong hon: worker phai di tu `vendor_bids` toi
      // `rfq_packages` va duong duy nhat la qua bang nay. `supplier_id`, `contact_id`,
      // `link_channel`, `status` KHONG duoc cap — worker khong co viec gi voi danh tinh NCC.
      { bang: "rfq_invitations", cot: "id" },
      { bang: "rfq_invitations", cot: "org_id" },
      { bang: "rfq_invitations", cot: "rfq_id" },
      { bang: "rfq_key_material", cot: "algorithm" },
      { bang: "rfq_key_material", cot: "created_at" },
      { bang: "rfq_key_material", cot: "id" },
      { bang: "rfq_key_material", cot: "key_version" },
      { bang: "rfq_key_material", cot: "org_id" },
      { bang: "rfq_key_material", cot: "public_key" },
      { bang: "rfq_key_material", cot: "revoked_at" },
      { bang: "rfq_key_material", cot: "rfq_id" },
      { bang: "rfq_key_material", cot: "wrapped_private_key" },
      { bang: "rfq_packages", cot: "id" },
      { bang: "rfq_packages", cot: "org_id" },
      { bang: "rfq_packages", cot: "status" },
      { bang: "sessions", cot: "expires_at" },
      { bang: "sessions", cot: "id" },
      { bang: "sessions", cot: "mfa_verified_at" },
      { bang: "sessions", cot: "org_id" },
      { bang: "sessions", cot: "revoked_at" },
      { bang: "sessions", cot: "user_id" },
      { bang: "users", cot: "id" },
      { bang: "users", cot: "org_id" },
      { bang: "users", cot: "status" },
      // [S1.5] `vendor_bid_versions.envelope` la cot THU HAI trong du an ma `app_unseal` doc duoc
      // con `app_api` thi khong (cot dau la `rfq_key_material.wrapped_private_key`). Y nghia manh
      // hon o day: mot `api` bi chiem hoan toan cung khong rut duoc phong bi niem phong ra de
      // tan cong ngoai tuyen ve sau.
      { bang: "vendor_bid_versions", cot: "bid_id" },
      { bang: "vendor_bid_versions", cot: "envelope" },
      { bang: "vendor_bid_versions", cot: "id" },
      { bang: "vendor_bid_versions", cot: "org_id" },
      { bang: "vendor_bid_versions", cot: "submitted_at" },
      { bang: "vendor_bid_versions", cot: "version" },
      { bang: "vendor_bids", cot: "id" },
      { bang: "vendor_bids", cot: "invitation_id" },
      { bang: "vendor_bids", cot: "org_id" },
    ]);
  });

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
    // [Task 5] Bốn vắng mặt nữa trên hai bảng sổ, mỗi cái đóng một đường đi:
    //   `id`          KHÔNG có INSERT -> audit_events_pkey/audit_chain_anchors_pkey không dùng
    //                                    làm oracle xuyên tổ chức được (đã đo: INSERT mang id
    //                                    CÓ THẬT của tổ chức khác và id không ai dùng trả về
    //                                    CÙNG một "permission denied for table audit_events").
    //   `occurred_at` KHÔNG có gì      -> dấu thời gian do CSDL đóng; bên ghi chọn được
    //   `anchored_at` KHÔNG có gì         occurred_at là một sổ sắp xếp lại được theo ý mình.
    //   Và KHÔNG có UPDATE trên bất kỳ cột nào của hai bảng đó — đó chính là bất biến B4.
    // [Task 6] Ba vắng mặt MỚI trên audit_events — `seq`, `prev_hash`, `hash`: 004 thu hồi
    //   INSERT trên đúng ba cột đó. Đường đi mà chúng đóng: một app_api bị chiếm CHIẾM TRƯỚC
    //   giá trị seq kế tiếp và chặn việc ghi sổ. Ca nặng nhất đã đo là seq = 2^63-1 — mọi lần
    //   ghi sau vỡ với "bigint out of range" VĨNH VIỄN, mà B4 lại cấm DELETE nên không ai gỡ
    //   được hàng đó ở đường DML thường. Ba cột nay do trigger audit_events_noi_chuoi đặt.
    // [vòng fix 1 — IM4] HAI vắng mặt MỚI trên audit_chain_anchors — `seq` và `hash`: 004 §(5)
    //   thu hồi INSERT trên chúng và cắm trigger audit_chain_anchors_moc_neo dẫn xuất hai giá
    //   trị đó từ đầu chuỗi hiện tại. Đường đi mà chúng đóng: app_api chèn được một MỐC NEO GIẢ
    //   vào chính bộ kiểm chứng — VĨNH VIỄN, vì trigger append-only của B4 chặn gỡ bỏ kể cả bởi
    //   chủ sở hữu bảng trên đường DML — và việc chiếm trước (org, seq) làm recordChainAnchor
    //   trả null mãi mãi, tức việc NEO THẬT âm thầm thành no-op.
    expect(rows).toEqual([
      { grantee: "app_api", bang: "audit_chain_anchors", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "action", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "actor_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "actor_type", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "ip", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "payload", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "request_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "resource_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "resource_type", quyen: "INSERT" },
      { grantee: "app_api", bang: "audit_events", cot: "user_agent", quyen: "INSERT" },
      // [S1.5] Bien nhan: BON cot INSERT va KHONG cot nao UPDATE. `bid_receipts` chi co HAI cot
      // mang du lieu — van ban chinh tac va chu ky cua no; moi thu khac nam TRONG van ban da ky.
      { grantee: "app_api", bang: "bid_receipts", cot: "bid_version_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "bid_receipts", cot: "canonical_text", quyen: "INSERT" },
      { grantee: "app_api", bang: "bid_receipts", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "bid_receipts", cot: "signature", quyen: "INSERT" },
      // [S1.3] `guest_sessions` - CHI `revoked_at` co UPDATE. `otp_verified_at` KHONG sua duoc:
      // no la moc tra loi "phien nay qua OTP luc nao", va mot moc sua duoc la mot moc khong
      // dung de phan xet duoc. `verified_contact_id` cung khong - viet lai danh tinh da xac thuc
      // chinh la thu E5 sinh ra de chan.
      // [C2, 012] `challenge_id`: phien khach TRO TOI thach thuc da doi chieu, va trigger doi
      // `verified_contact_id`/`verified_channel` KHOP voi hang do. Khong co cot nay, danh tinh
      // da xac thuc la mot LOI KHAI cua nguoi goi.
      { grantee: "app_api", bang: "guest_sessions", cot: "challenge_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "guest_sessions", cot: "expires_at", quyen: "INSERT" },
      { grantee: "app_api", bang: "guest_sessions", cot: "invitation_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "guest_sessions", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "guest_sessions", cot: "revoked_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "guest_sessions", cot: "token_hash", quyen: "INSERT" },
      { grantee: "app_api", bang: "guest_sessions", cot: "verified_channel", quyen: "INSERT" },
      { grantee: "app_api", bang: "guest_sessions", cot: "verified_contact_id", quyen: "INSERT" },
      // [S1.3] `invitation_otp_challenges` - `code_hash` chi INSERT: mot ma OTP sua duoc sau khi
      // phat la mot ma khong dung mot lan duoc. `channel` cung chi INSERT: trigger so kenh OTP
      // voi kenh magic link chay o BEFORE INSERT, nen mot cot `channel` sua duoc sau do se lam
      // phep kiem ay chi dung tai thoi diem chen (ADR-015 muc 1).
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "channel", quyen: "INSERT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "code_hash", quyen: "INSERT" },
      // [C1/H1, 012] `contact_id` va `token_id`: dich nhan OTP DOC TU CSDL va phat OTP DOI TOKEN.
      // `destination_hash` ghi lai dich DA THAT SU DUNG — ban truoc khong luu, nen "khong lop nao,
      // o bat ky thoi diem nao, biet ma da di toi dau".
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "consumed_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "contact_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "destination_hash", quyen: "INSERT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "expires_at", quyen: "INSERT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "failed_attempts", quyen: "UPDATE" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "invitation_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "locked_until", quyen: "UPDATE" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "org_id", quyen: "INSERT" },
      // [ADR-018 / 015] Phien ban pepper da dung cho CA HAI bam cua hang nay. NOT NULL: mot hang
      // khong noi duoc no bam bang gi la mot hang khong doi chieu duoc — va no chet trong IM LANG,
      // vi mot bam khong khop trong y het mot bam sai.
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "pepper_version", quyen: "INSERT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", cot: "token_id", quyen: "INSERT" },
      // [Task 9] `mfa_credentials` — bốn vắng mặt là load-bearing, mỗi cái đóng một đường đi:
      //   `id`                 KHÔNG INSERT -> mfa_credentials_pkey không làm oracle xuyên tổ
      //                                        chức được (khuôn users_pkey ở 002).
      //   `last_used_counter`  KHÔNG INSERT -> hồ sơ không ra đời với một bộ đếm dùng-một-lần
      //                                        do bên ghi chọn; chọn một giá trị lớn là vô hiệu
      //                                        hoá vế (2) của E3 VĨNH VIỄN.
      //   `confirmed_at`       KHÔNG INSERT -> trạng thái "đã xác nhận" chỉ tới bằng một mã đúng.
      //   `secret_wrapped`/`secret_key_version` KHÔNG có UPDATE (và bảng không có DELETE ở
      //                                        role_table_grants) -> một app_api bị chiếm không
      //                                        thay được bí mật MFA của người đã đăng ký.
      { grantee: "app_api", bang: "mfa_credentials", cot: "confirmed_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "failed_attempts", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "kind", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "last_used_counter", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "locked_until", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "secret_key_version", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "secret_wrapped", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "user_id", quyen: "INSERT" },
      // [ADR-017 / 014] Chinh sach mua sam: CHI GHI THEM. Khong UPDATE, khong DELETE — sua duoc
      // nguong cua mot phien ban DA DUNG nghia la phan loai cua moi RFQ cu doi theo ma khong ai
      // biet, tuc "tai lap duoc" thanh mot loi hua rong. Do la toan bo co che.
      { grantee: "app_api", bang: "org_procurement_policies", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "org_procurement_policies", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "org_procurement_policies", cot: "currency", quyen: "INSERT" },
      { grantee: "app_api", bang: "org_procurement_policies", cot: "dual_approval_threshold", quyen: "INSERT" },
      { grantee: "app_api", bang: "org_procurement_policies", cot: "effective_from", quyen: "INSERT" },
      { grantee: "app_api", bang: "org_procurement_policies", cot: "org_id", quyen: "INSERT" },
      // [S1.7] Cột chế độ nghiêm của A6. Nó vào tập INSERT chứ KHÔNG vào tập UPDATE: bảng này
      // chỉ ghi thêm, và đổi chính sách nghĩa là thêm một phiên bản — xem 014 và 020.
      { grantee: "app_api", bang: "org_procurement_policies", cot: "strict_blind_mode", quyen: "INSERT" },
      { grantee: "app_api", bang: "org_procurement_policies", cot: "version", quyen: "INSERT" },
      { grantee: "app_api", bang: "organizations", cot: "name", quyen: "UPDATE" },
      { grantee: "app_api", bang: "otp_rate_limits", cot: "bucket_hash", quyen: "INSERT" },
      { grantee: "app_api", bang: "otp_rate_limits", cot: "bucket_kind", quyen: "INSERT" },
      { grantee: "app_api", bang: "otp_rate_limits", cot: "hits", quyen: "INSERT" },
      { grantee: "app_api", bang: "otp_rate_limits", cot: "hits", quyen: "UPDATE" },
      { grantee: "app_api", bang: "otp_rate_limits", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "otp_rate_limits", cot: "window_start", quyen: "INSERT" },
      // [Task 10] `outbox_jobs` — bốn nhóm vắng mặt, mỗi nhóm đóng một đường đi:
      //   `id`/`created_at`          KHÔNG có gì -> `outbox_jobs_pkey` không dùng làm oracle
      //                                            xuyên tổ chức được (khuôn `users_pkey` ở
      //                                            002), và dấu thời gian TẠO do CSDL đóng
      //                                            (khuôn `occurred_at` ở 003).
      //   `status`/`attempts`/`last_failure_reason` KHÔNG có INSERT -> một job không RA ĐỜI đã
      //                                            `DONE`, đã mang sẵn số lần thử, hay đã mang
      //                                            sẵn một lý do thất bại.
      //   `lease_expires_at`/`finished_at` KHÔNG có INSERT -> hai CHECK của 007 buộc chúng NULL
      //                                            ở trạng thái PENDING, nên cấp chúng chỉ mở
      //                                            một đường ghi không dùng được.
      //   `org_id`/`kind`/`payload`/`dedupe_key` KHÔNG có UPDATE -> không đường nào chuyển một
      //                                            job sang tổ chức khác, đổi loại việc, hay
      //                                            sửa nội dung một job đã nằm trong hàng đợi.
      //   Và KHÔNG có DELETE ở mức bảng: một job đi tới trạng thái cuối, không biến mất.
      { grantee: "app_api", bang: "outbox_jobs", cot: "attempts", quyen: "UPDATE" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "dedupe_key", quyen: "INSERT" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "finished_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "kind", quyen: "INSERT" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "last_failure_reason", quyen: "UPDATE" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "lease_expires_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "payload", quyen: "INSERT" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "run_after", quyen: "INSERT" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "run_after", quyen: "UPDATE" },
      { grantee: "app_api", bang: "outbox_jobs", cot: "status", quyen: "UPDATE" },
      // [S1.2] `rfq_approvals` (009) — chi INSERT, dung bon cot. Khong UPDATE, khong DELETE.
      { grantee: "app_api", bang: "rfq_approvals", cot: "approver_user_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_approvals", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_approvals", cot: "rfq_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_approvals", cot: "session_id", quyen: "INSERT" },
      // [S1.3] `rfq_invitation_tokens` - `token_hash` chi INSERT. Mot token doi duoc gia tri la
      // mot token khong thu hoi duoc that (E1).
      // [ADR-017 / 014] Ngan sach du tinh cua nguoi mua. UPDATE co, nhung bi trigger
      // `rfq_budgets_chi_sua_khi_soan` gioi han vao luc RFQ con o DRAFT — sua duoc bang chung SAU
      // khi nguoi duyet da ky nghia la bang chung noi mot dang con quyet dinh da ra mot neo.
      { grantee: "app_api", bang: "rfq_budgets", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "currency", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "currency", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "estimated_value", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "estimated_value", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "policy_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "policy_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_budgets", cot: "rfq_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "consumed_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "expires_at", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "invitation_id", quyen: "INSERT" },
      // [ADR-016 / 013] Hai cot ky ten cua nguoi PHAT token. Duc mot credential bearer la thao
      // tac dang ghi so nhat cua ca goi invitation, nen no la cho te nhat de con mot loi khai.
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "issued_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "issued_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "purpose", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "revoked_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_invitation_tokens", cot: "token_hash", quyen: "INSERT" },
      // [S1.3] `rfq_invitations` - `contact_id` va `link_channel` KHONG co UPDATE. Doi nguoi nhan
      // hay doi kenh cua mot loi moi DA GUI la gui mot loi moi KHAC; va mot `link_channel` sua
      // duoc sau khi OTP da phat lam trigger so hai kenh tro thanh mot phep kiem chi dung tai
      // thoi diem chen.
      { grantee: "app_api", bang: "rfq_invitations", cot: "contact_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "invited_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "invited_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "link_channel", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "revoked_at", quyen: "UPDATE" },
      // [ADR-016 / 013] UPDATE, khong phai INSERT: thu hoi la mot lan sua hang co san. Khong co
      // hai cot nay, "ai da thu hoi loi moi" chi so kiem toan tra loi duoc — va so kiem toan
      // nhan dau vao la loi khai, tuc khong lop nao biet.
      { grantee: "app_api", bang: "rfq_invitations", cot: "revoked_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "revoked_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "rfq_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "status", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_invitations", cot: "supplier_id", quyen: "INSERT" },
      // [ADR-016 / 016] Hang muc RFQ mang chu ky nguoi them.
      { grantee: "app_api", bang: "rfq_items", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "description", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "line_no", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "quantity", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "rfq_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_items", cot: "unit", quyen: "INSERT" },
      // [S1.4 / 017] `wrapped_private_key` co INSERT o day va KHONG co dong SELECT nao tuong ung
      // trong khang dinh tren — do la bat doi xung "ghi duoc ma khong doc duoc", cau chiu luc cua
      // migration 017. `id` va `created_at` vang mat: chung dung DEFAULT, va nho the chi muc
      // PRIMARY KEY khong thanh oracle xuyen to chuc (H14).
      { grantee: "app_api", bang: "rfq_key_material", cot: "algorithm", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "key_version", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "public_key", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_reason", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "rfq_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "wrapped_private_key", quyen: "INSERT" },
      // [H-1, 011] `created_by_session_id`: RFQ mang phien cua chinh nguoi tao, va trigger doi
      // `sessions.user_id = created_by`. Khong co cot nay, `created_by` la mot LOI KHAI va D2 tut
      // tu 'hai nguoi khac nguoi tao' xuong 'mot nguoi khac nguoi tao'.
      // [H-4, 011] `early_close_reason`: dong som la mot hanh vi CO TEN, khong phai mot `reason`
      // chi di vao payload kiem toan.
      { grantee: "app_api", bang: "rfq_packages", cot: "cancelled_at", quyen: "UPDATE" },
      // [ADR-016 / 016] Bon canh chuyen trang thai mang CHU KY. Khong phai sieu du lieu trang
      // tri: *Separation of Duties* (PRODUCT §4.1) va *Open ≠ Award* (§4.3) treo vao dung bon cau
      // hoi nay, va truoc 016 khong cau nao tra loi duoc TU DU LIEU.
      { grantee: "app_api", bang: "rfq_packages", cot: "cancelled_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "cancelled_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "closed_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "closed_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "closed_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_packages", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_packages", cot: "deadline_at", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_packages", cot: "deadline_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "early_close_reason", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "opened_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "opened_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "opened_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_packages", cot: "requires_dual_approval", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_packages", cot: "requires_dual_approval", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "status", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "submitted_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "submitted_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_packages", cot: "title", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_packages", cot: "title", quyen: "UPDATE" },
      // [S1.2] `rfq_items` — `org_id` va `rfq_id` chi INSERT: khong duong nao chuyen mot hang
      // muc sang RFQ khac hay sang to chuc khac.
      // [S1.2] `rfq_packages` — `status` co UPDATE va no BUOC phai co de ung dung lam viec.
      // Ke tu giay do, `UPDATE ... SET status='OPEN'` tren mot RFQ da CLOSED la MOT DONG SQL,
      // khong phai mot cuoc tan cong; trigger `rfq_packages_kiem_chuyen_trang_thai` la thu duy
      // nhat dung giua. Do la toan bo lap luan cua ADR-014, doc tu phia quyen.
      // `created_by` chi INSERT, `created_at` khong co gi, `org_id` chi INSERT.
      // [Task 9] `sessions` — ba vắng mặt là load-bearing:
      //   `id`              KHÔNG INSERT -> sessions_pkey không làm oracle được.
      //   `created_at`      KHÔNG có gì   -> dấu thời gian do CSDL đóng (khuôn occurred_at/003).
      //   `mfa_verified_at` KHÔNG INSERT (chỉ UPDATE) -> một phiên không RA ĐỜI ở trạng thái
      //                                    "đã xác thực hai lớp"; trạng thái đó phải tới bằng
      //                                    một câu lệnh riêng, viết ra thành chữ.
      //   `expires_at`      KHÔNG có UPDATE -> không gia hạn phiên trượt vô hạn.
      { grantee: "app_api", bang: "sessions", cot: "expires_at", quyen: "INSERT" },
      { grantee: "app_api", bang: "sessions", cot: "ip", quyen: "INSERT" },
      { grantee: "app_api", bang: "sessions", cot: "mfa_verified_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "sessions", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "sessions", cot: "revoked_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "sessions", cot: "token_hash", quyen: "INSERT" },
      { grantee: "app_api", bang: "sessions", cot: "user_agent", quyen: "INSERT" },
      { grantee: "app_api", bang: "sessions", cot: "user_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "email", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "full_name", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "phone", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "status", quyen: "INSERT" },
      { grantee: "app_api", bang: "supplier_contacts", cot: "supplier_id", quyen: "INSERT" },
      // [ADR-016 / 013] Ban S1.1 KHONG co mot cot nao ghi ai tao hang. Cau hoi "ai da them nha
      // cung cap nay" vi vay khong tra loi duoc TU DU LIEU — chi tra loi duoc tu mot so kiem
      // toan ma chinh no nhan dau vao la loi khai.
      { grantee: "app_api", bang: "suppliers", cot: "created_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "suppliers", cot: "created_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "suppliers", cot: "legal_name", quyen: "INSERT" },
      { grantee: "app_api", bang: "suppliers", cot: "level", quyen: "INSERT" },
      { grantee: "app_api", bang: "suppliers", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "suppliers", cot: "status", quyen: "INSERT" },
      { grantee: "app_api", bang: "suppliers", cot: "tax_code", quyen: "INSERT" },
      // [S1.1] `supplier_contacts` (008). Ba vắng mặt, mỗi cái đóng một đường đi:
      //   `id`/`created_at` KHÔNG có gì  -> khuôn `users_pkey` ở 002 và `occurred_at` ở 003.
      //   `org_id`          chỉ INSERT   -> không đường nào chuyển một người liên hệ sang tổ
      //                                     chức khác.
      //   `supplier_id`     chỉ INSERT   -> chuyển một người liên hệ sang nhà cung cấp khác
      //                                     không phải sửa hồ sơ; đó là xoá một người và tạo
      //                                     một người khác.
      // [S1.1] `suppliers` (008). `tax_code` CÓ cả INSERT lẫn UPDATE, và điều đó AN TOÀN đúng
      // vì ràng buộc duy nhất mà nó tham gia đã dẫn đầu bằng `org_id` — nếu ai đó đổi ràng buộc
      // ấy thành `UNIQUE (tax_code)` toàn cục thì chính hai dòng này biến nó thành một oracle
      // xuyên tổ chức. Lớp canh cho mối nối đó: db/unique-oracle.int.test.ts [INV-H14].
      // [Task 8] `user_roles` cấp INSERT theo CỘT, và `granted_at` vắng mặt là load-bearing:
      // dấu thời gian do CSDL đóng, bên ghi chọn được nó là một sổ gán vai trò sắp xếp lại được
      // theo ý mình (cùng khuôn `occurred_at` ở 003 và `created_at` ở 002). KHÔNG có UPDATE trên
      // bất kỳ cột nào: mọi thay đổi biểu diễn được bằng DELETE + INSERT, và một UPDATE
      // `role_code` là đường đi mà trigger D3 khó soi nhất trong khi không mua thêm năng lực nào.
      { grantee: "app_api", bang: "unseal_approvals", cot: "approver_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_approvals", cot: "approver_user_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_approvals", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_approvals", cot: "unseal_request_id", quyen: "INSERT" },
      // KHONG mot dong UPDATE hay DELETE nao tren `unseal_approvals`: mot chu ky da dat xuong thi
      // khong rut lai bang cach xoa dong. Duong dung la HUY yeu cau — mot hanh vi co ten, co moc.
      { grantee: "app_api", bang: "unseal_requests", cot: "approved_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "break_glass", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "cancelled_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "reason", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "requested_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "requested_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "rfq_id", quyen: "INSERT" },
      // `status` co UPDATE nhung KHONG co INSERT: mot yeu cau khong duoc RA DOI da o APPROVED.
      { grantee: "app_api", bang: "unseal_requests", cot: "status", quyen: "UPDATE" },
      { grantee: "app_api", bang: "user_roles", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "user_roles", cot: "role_code", quyen: "INSERT" },
      { grantee: "app_api", bang: "user_roles", cot: "user_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "email", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "email", quyen: "UPDATE" },
      { grantee: "app_api", bang: "users", cot: "full_name", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "full_name", quyen: "UPDATE" },
      { grantee: "app_api", bang: "users", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "status", quyen: "INSERT" },
      { grantee: "app_api", bang: "users", cot: "status", quyen: "UPDATE" },
      // [S1.5] `envelope` co INSERT o day va KHONG co dong SELECT nao tuong ung o khang dinh tren
      // — bat doi xung "ghi duoc ma khong doc duoc", lan thu HAI trong du an. `version` vang mat
      // vi trigger dat no; `submitted_at` vang mat vi DEFAULT dat no. Va KHONG mot dong UPDATE
      // hay DELETE nao tren ca hai bang bao gia: do la bat bien B1 nhin tu phia quyen.
      { grantee: "app_api", bang: "vendor_bid_versions", cot: "bid_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "vendor_bid_versions", cot: "envelope", quyen: "INSERT" },
      { grantee: "app_api", bang: "vendor_bid_versions", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "vendor_bid_versions", cot: "submitted_by_guest_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "vendor_bids", cot: "invitation_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "vendor_bids", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_chain_anchors", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "action", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "actor_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "actor_type", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "ip", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "payload", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "request_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "resource_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "resource_type", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "audit_events", cot: "user_agent", quyen: "INSERT" },
      // [S1.6] BON dong duoi day la toan bo quyen GHI cua tien trinh mo thau, va chung la hinh
      // dang cua ADR-006 trong mot bang quyen: no GHI ban ro (`rfq_unsealed_bids`), no TUYEN BO
      // ket qua (`rfq_packages.status`, `unseal_requests.status`), va no khong lam gi khac.
      // `rfq_packages.status` la dong trong nguy hiem nhat — xem khoi giai thich o dau 019.
      { grantee: "app_unseal", bang: "rfq_packages", cot: "status", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "rfq_unsealed_bids", cot: "bid_version_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "rfq_unsealed_bids", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "rfq_unsealed_bids", cot: "payload", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "rfq_unsealed_bids", cot: "unseal_request_id", quyen: "INSERT" },
      { grantee: "app_unseal", bang: "unseal_requests", cot: "executed_at", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "unseal_requests", cot: "status", quyen: "UPDATE" },
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

  // ~~[NỢ ADR-006] Ràng buộc toàn cục "không role nào bao trùm role kia" ĐANG BỊ VI PHẠM ở S0, và~~
  // ~~nó KHÔNG thoả được bằng bất kỳ thao tác nào trong Task 4: quyền duy nhất của app_unseal là~~
  // ~~SELECT trên organizations, mà app_api cũng có; kể cả gỡ sạch quyền thì tập rỗng vẫn là tập~~
  // ~~con. Nó chỉ có nội dung khi app_unseal được cấp quyền ĐỘC QUYỀN trên bảng khoá riêng RFQ.~~
  //
  // ~~Khẳng định dưới đây cố ý ĐẢO CHIỀU — nó khẳng định trạng thái VI PHẠM là đúng-lúc-này. Khi~~
  // ~~task khoá riêng RFQ cấp quyền độc quyền cho app_unseal, test này ĐỎ NGAY, và người sửa nó~~
  // ~~phải lật `true` thành `false` và xoá ghi chú này.~~ Nếu thay bằng một khẳng định thuận chiều
  // (hoặc không có gì, như vòng trước) thì thời điểm ràng buộc trở nên thoả được sẽ trôi qua
  // trong im lặng — đúng cách một khoản nợ kiến trúc biến mất khỏi tầm nhìn.
  //
  // ============================================================================================
  // [S1.4 / 017] KHOẢN NỢ NÀY ĐÃ ĐÓNG, VÀ NÓ ĐÓNG ĐÚNG CÁCH NÓ ĐƯỢC HẸN — BẰNG MỘT LẦN ĐỎ.
  // ============================================================================================
  // Migration 017 cấp `SELECT (wrapped_private_key) ON rfq_key_material TO app_unseal` và KHÔNG
  // cấp cột ấy cho `app_api`. Ngay lượt chạy đầu sau khi 017 áp, test này ĐỎ với đúng thông điệp
  // nó tự viết cho tương lai từ Task 4 — không phải vì ai nhớ ra, mà vì một phép đo phát hiện
  // thế giới đã đổi. Giữ nguyên văn cũ (đã gạch) để đối chiếu.
  //
  // Bản mới đo MẠNH HƠN bản cũ, và đây là chỗ dễ làm ẩu nhất: chỉ lật `true` thành `false` sẽ cho
  // ra một test XANH VÌ MỘT LÝ DO YẾU — "app_unseal không phải tập con" đúng ngay cả khi
  // `app_api` bao trùm hoàn toàn app_unseal ở mọi chỗ khác. Ràng buộc thật của ADR-006 là
  // **KHÔNG ROLE NÀO BAO TRÙM ROLE KIA**, tức HAI vế, nên bản mới đo cả hai vế và neo mỗi vế vào
  // một khoá cụ thể để nó không xanh vì phép đo bỏ sót.
  it("[ADR-006] không role nào bao trùm role kia — app_unseal độc quyền đọc khoá riêng RFQ", async () => {
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
    // [Task 5] Chống rỗng ruột lớp hai, và đây là lý do nó được thêm: Task 5 cấp cho app_unseal
    // quyền trên hai bảng MỚI, GIỐNG HỆT quyền của app_api. Nếu câu truy vấn ở trên vì lý do
    // nào đó không nhìn thấy hai bảng đó (nó gộp role_table_grants với role_column_grants, và
    // quyền INSERT của bảng sổ CHỈ tồn tại ở vế thứ hai), khẳng định "bao trùm" vẫn xanh —
    // nhưng xanh vì phép đo bỏ sót, không vì trạng thái đúng. Neo nó vào một khoá cụ thể.
    // [Task 6] Neo đổi từ "audit_events.hash:INSERT" sang "audit_events.action:INSERT": 004 thu
    // hồi INSERT trên `hash` của CẢ HAI role, nên khoá cũ không còn tồn tại và phép chống-rỗng-
    // ruột này sẽ đỏ vì một lý do KHÔNG liên quan tới thứ nó canh. `action` là cột ghi được của
    // bảng sổ mà cả hai role còn giữ, nên nó tiếp tục làm đúng việc cũ.
    expect(
      cuaUnseal,
      "phép đo bỏ sót quyền CỘT trên bảng sổ — khoản nợ này sẽ xanh vì lý do sai",
    ).toContain("audit_events.action:INSERT");
    const cuaUnsealTap = new Set(cuaUnseal);
    const chiUnsealCo = cuaUnseal.filter((k) => !cuaApi.has(k));
    const chiApiCo = [...cuaApi].filter((k) => !cuaUnsealTap.has(k));

    // Vế 1 — app_unseal KHÔNG là tập con của app_api. Neo vào đúng cột làm nên khoản nợ này:
    // nếu ai đó cấp thêm `SELECT (wrapped_private_key)` cho `app_api` thì vế này đỏ, và nó đỏ
    // vì một sự thật an ninh chứ không vì một con số đếm được.
    expect(
      chiUnsealCo,
      "app_unseal không còn quyền nào riêng — ADR-006 lại thành một lời khai",
    ).toContain("rfq_key_material.wrapped_private_key:SELECT");
    expect(cuaApi.has("rfq_key_material.wrapped_private_key:SELECT")).toBe(false);

    // Vế 2 — và app_api cũng KHÔNG là tập con của app_unseal. Không có vế này, một lần "gỡ sạch
    // quyền của app_api" vẫn cho test xanh.
    expect(chiApiCo.length).toBeGreaterThan(0);
    expect(chiApiCo).toContain("rfq_key_material.wrapped_private_key:INSERT");
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
