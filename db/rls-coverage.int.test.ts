import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docHangHardening as docHangHardeningTu, khoiValues } from "./hardening-hang.js";

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
 * ~~RỖNG là trạng thái đúng ở S0~~, và có test bên dưới đòi mỗi dòng ở đây phải ứng với một policy
 * CÓ THẬT — ngoại lệ chết (bảng/policy đã bị xoá) là ĐỎ, không phải rác im lặng.
 *
 * [S1.15 / sổ nợ 57] Danh sách hết rỗng: `044` cấp dòng ĐẦU TIÊN, cho policy dọn cửa sổ cũ của
 * `otp_rate_limits`. Lập luận đầy đủ ở đầu `044_don_bucket_otp.sql` và cạnh chính dòng ấy trong
 * `hardening.always.sql`. Điều đáng ghi ở ĐÂY: từ hôm nay, logic khớp sáu cột không còn là mã
 * chết — nó có một ca dùng thật, nên đột biến "bỏ một trục khỏi hàm khớp" nay đỏ ở HAI chỗ.
 */
type DongNgoaiLe = readonly [
  bang: string,
  polname: string,
  lenh: string,
  vaiTro: string,
  phamVi: string,
  bieuThuc: string,
];
const NGOAI_LE_HINH_DANG: readonly DongNgoaiLe[] = [
  [
    "otp_rate_limits",
    "otp_rate_limits_don_cua_so_cu",
    "d",
    "app_api",
    "co_org_id",
    "((NULLIF(current_setting('app.org_id'::text, true), ''::text) IS NULL) AND " +
      "(window_start < (now() - make_interval(secs => (1800)::double precision))))",
  ],
];

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

  // ~~[vòng fix 1 — M1] Danh sách bảng GỐC tenant nhân bản BA nơi. Đây là test đồng bộ, đúng~~
  // ~~khuôn §R3 đã dùng cho thân hàm app_current_org_id() (nhân bản HAI nơi và CÓ test). Không có~~
  // ~~nó, task sau thêm bảng gốc thứ hai rồi quên một bản sao là một lỗ IM LẶNG: hardening sẽ~~
  // ~~không bật RLS cho bảng đó, hoặc lớp tĩnh sẽ không đòi POLICY/GRANT cho nó.~~
  //
  // [S1.20 / sổ nợ 16] **BẢN SAO THỨ BA KHÔNG CÒN TỒN TẠI, và đó là điểm của vòng này.**
  // `VI_TU_BANG_TENANT` từng giấu `OR relname IN ('organizations')` bên trong một vị từ tính-chất;
  // nay nó SUY bảng gốc từ *đích của một khoá ngoại MỘT CỘT tên `org_id`*. Không còn danh sách nào
  // ở đó để đồng bộ — nên phép so ba-nơi được thay bằng thứ MẠNH HƠN: **tập suy ra từ CSDL THẬT
  // phải bằng hai danh sách viết tay còn lại.** Câu hỏi cũ (*"ba bản sao có khớp nhau không?"*)
  // là câu hỏi về văn bản; câu hỏi mới (*"danh sách viết tay có còn đúng với lược đồ không?"*) là
  // câu hỏi về sự thật, và nó bắt được cả ca mà cả ba bản sao cùng SAI.
  it("[M1 / S1.20] danh sách bảng GỐC tenant khớp hai nơi nhân bản CÒN LẠI, và khớp tập SUY TỪ lược đồ thật", async () => {
    // Bỏ dòng CHÚ THÍCH trước khi tìm: `hardening.always.sql` giữ nguyên văn câu cũ trong một khối
    // `--` để người sau đọc được lịch sử, và một phép tìm thô sẽ khớp vào chính khối ấy. Đã tự vấp
    // — cùng họ với bài học "gạch bỏ tại chỗ, giữ nguyên văn": quy ước ấy làm mọi phép tìm THÔ
    // trên file này thành một cái bẫy.
    const maHardening = readFileSync(`${MIGRATIONS_DIR}/hardening.always.sql`, "utf8")
      .split("\n")
      .filter((d) => !d.trimStart().startsWith("--"))
      .join("\n");
    expect(
      maHardening.includes("relname IN ('organizations')"),
      "VI_TU_BANG_TENANT không được quay lại nhận bảng gốc theo TÊN",
    ).toBe(false);

    const tsShape = readFileSync(
      fileURLToPath(new URL("./migration-shape.test.ts", import.meta.url)),
      "utf8",
    );
    const khopShape = /const BANG_GOC_TENANT = \[([^\]]*)\]/.exec(tsShape);
    expect(khopShape, "không tìm thấy BANG_GOC_TENANT trong migration-shape.test.ts").not.toBeNull();
    const tuShape = [...khopShape![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
    expect(tuShape).toEqual([...BANG_GOC_TENANT].sort());

    // Vế mạnh: đúng cái vị từ hardening dùng, chạy trên lược đồ thật.
    const { rows } = await db.pool.query<{ goc: string }>(
      `SELECT DISTINCT ref.relname AS goc
         FROM pg_constraint fk
         JOIN pg_class fkb ON fkb.oid = fk.conrelid
         JOIN pg_class ref ON ref.oid = fk.confrelid
         JOIN pg_namespace fkn ON fkn.oid = fkb.relnamespace
        WHERE fk.contype = 'f' AND fkn.nspname = 'public'
          AND array_length(fk.conkey, 1) = 1
          AND EXISTS (SELECT 1 FROM pg_attribute fka
                       WHERE fka.attrelid = fkb.oid AND fka.attnum = fk.conkey[1]
                         AND fka.attname = 'org_id' AND NOT fka.attisdropped)
        ORDER BY 1`,
    );
    expect(
      rows.map((r) => r.goc),
      "tập bảng gốc SUY TỪ lược đồ thật phải bằng danh sách viết tay",
    ).toEqual([...BANG_GOC_TENANT].sort());
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
    // [S1.15 / sổ nợ 57] Bản trước đọc mỗi ô bằng `'([^']*)'`, tức nó CHỈ đọc được ô không có
    // nháy đơn bên trong — đúng với danh sách RỖNG, sai ngay với dòng đầu tiên: biểu thức của
    // `044` mang `''app.org_id''`. Ô ở đây là một chuỗi SQL, nên đọc nó theo đúng luật của chuỗi
    // SQL: nháy đơn NHÂN ĐÔI là một ký tự, và ô kết thúc ở nháy đơn KHÔNG theo sau bởi nháy đơn.
    // Viết lười (`*?`) cộng `(?!')` thay vì tham: tham thì `)` sau ô cuối vẫn khớp `[^']` và bộ
    // đọc trượt sang dòng sau.
    const CHUOI_SQL = String.raw`'((?:[^']|'')*?)'(?!')`;
    const DONG_SAU_COT = new RegExp(
      String.raw`\(\s*` + Array(6).fill(CHUOI_SQL).join(String.raw`\s*,\s*`) + String.raw`\s*\)`,
      "g",
    );
    const tuSql = [...khoi![1]!.matchAll(DONG_SAU_COT)]
      // Dòng RỖNG là chỗ giữ chỗ của danh sách trống trong SQL (VALUES không cho phép 0 hàng),
      // không phải một ngoại lệ. polname không bao giờ rỗng nên nó không khớp policy nào.
      .filter((m) => m[2] !== "")
      .map(
        (m) =>
          [m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!].map((o) => o.replace(/''/g, "'")) as unknown as DongNgoaiLe,
      );
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
      // [khoản nợ 29] `toBe(1)` HẾT ĐÚNG kể từ `027`: lược đồ nay CÓ policy RESTRICTIVE thật
      // (một `<bảng>_khach` cho mỗi bảng có RLS), nên phép đếm không còn là 1. Thứ khẳng định
      // này thật sự muốn nói là *"fixture ĐÃ được dựng"*, và nói thẳng điều ấy MẠNH HƠN đếm:
      // một phép đếm ≥ 1 sẽ xanh nhờ policy của `027` kể cả khi `CREATE POLICY` ở trên im lặng
      // không chạy. Nên đòi ĐÍCH DANH policy fixture.
      expect(
        rows.filter((r) => !r.cho_phep).map((r) => r.ten_policy),
        "fixture RESTRICTIVE không dựng được — nhánh miễn trừ lại thành mã chết",
      ).toContain("users_chan_bi_khoa");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // [vòng fix 3 — I2] Cột `vai_tro` phải ĐỌC RA ĐƯỢC, nếu không cả khoá sáu cột chỉ là
    // trang trí. ~~Mọi policy ở S0 đều áp cho PUBLIC (polroles = {0})~~, và OID 0 KHÔNG có hàng
    // trong pg_roles — viết truy vấn theo kiểu JOIN thẳng sẽ cho ra chuỗi RỖNG, tức chỗ RỘNG
    // NHẤT lại trùng giá trị giữ chỗ của dòng rỗng trong file SQL.
    // [S1.15 / sổ nợ 57] Nay có HAI giá trị: `044` là policy đầu tiên viết `TO app_api`. Khẳng
    // định vì thế MẠNH HƠN bản cũ — nó đo được cả nhánh PUBLIC (OID 0, không có hàng trong
    // pg_roles) LẪN nhánh role thật, và một bản kết xuất chỉ đúng một nhánh nay sẽ đỏ.
    expect(
      [...new Set(rows.map((r) => r.vai_tro))].sort(),
      "vai_tro không kết xuất được PUBLIC — khoá sáu cột đang so bằng chuỗi rỗng",
    ).toEqual(["PUBLIC", "app_api"]);

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
      // [khoản nợ 29] `toBe(1)` HẾT ĐÚNG kể từ `027`: lược đồ nay CÓ policy RESTRICTIVE thật
      // (một `<bảng>_khach` cho mỗi bảng có RLS), nên phép đếm không còn là 1. Thứ khẳng định
      // này thật sự muốn nói là *"fixture ĐÃ được dựng"*, và nói thẳng điều ấy MẠNH HƠN đếm:
      // một phép đếm ≥ 1 sẽ xanh nhờ policy của `027` kể cả khi `CREATE POLICY` ở trên im lặng
      // không chạy. Nên đòi ĐÍCH DANH policy fixture.
      expect(
        rows.filter((r) => !r.cho_phep).map((r) => r.ten_policy),
        "fixture RESTRICTIVE không dựng được — nhánh miễn trừ lại thành mã chết",
      ).toContain("users_chan_bi_khoa");
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
      // [S1.14 / 042 / sổ nợ 55] `caller_rate_limits` là bảng NGOÀI cây tenant (không `org_id`):
      // bộ đếm theo người gọi phải chung cho tổ chức thật lẫn tổ chức lạ, nếu không 429 là một
      // oracle tồn tại tổ chức. DELETE mức bảng cho bộ dọn — cùng đánh đổi đã ghi ở 010.
      { grantee: "app_api", bang: "caller_rate_limits", quyen: "DELETE,SELECT" },
      { grantee: "app_api", bang: "guest_sessions", quyen: "SELECT" },
      { grantee: "app_api", bang: "invitation_otp_challenges", quyen: "SELECT" },
      // [040 / sổ nợ 40] DELETE: đường đặt lại TOTP — trigger `mfa_credentials_xoa_can_yeu_cau` chỉ cho
      // qua khi có yêu cầu đã duyệt chưa tiêu thụ; không có trigger ấy thì GRANT này là một lỗ.
      { grantee: "app_api", bang: "mfa_credentials", quyen: "DELETE,SELECT" },
      { grantee: "app_api", bang: "mfa_reset_requests", quyen: "SELECT" },
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
      // [S1.10.4 / 029] token đăng nhập người mua: SELECT mức bảng; INSERT/UPDATE theo cột (xem dưới).
      { grantee: "app_api", bang: "user_login_tokens", quyen: "SELECT" },
      { grantee: "app_api", bang: "user_roles", quyen: "DELETE,SELECT" },
      { grantee: "app_api", bang: "users", quyen: "SELECT" },
      { grantee: "app_api", bang: "vendor_bids", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "audit_chain_anchors", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "audit_events", quyen: "SELECT" },
      // [025, khoản nợ 34] `app_unseal` nay ĐỌC được hàng đợi. 007 viết *"cố ý KHÔNG cấp gì
      // cho app_unseal — kể cả SELECT"*, và câu ấy đúng cho tới khi có hai `kind` mà chỉ
      // tiến trình này chạy được. Cố ý KHÔNG có `INSERT`: một tiến trình vừa tự xếp việc
      // vừa tự chạy việc là một tiến trình tự cấp việc cho mình.
      { grantee: "app_unseal", bang: "organizations", quyen: "SELECT" },
      { grantee: "app_unseal", bang: "outbox_jobs", quyen: "SELECT" },
      // [022, review an ninh S1.6 MED-2] BA dòng của `app_unseal` ĐÃ BỊ THU HỒI, và mỗi dòng
      // biến mất là một câu:
      //   `rfq_unsealed_bids` — 019 tự viết *"nó KHÔNG đọc lại được"* rồi cấp SELECT ngay 30
      //     dòng dưới. Worker chỉ INSERT. Để lại quyền ấy là để một tiến trình `app_unseal` bị
      //     chiếm đọc HÀNG LOẠT mọi báo giá đã mở, không tốn một lần mở bọc khoá nào.
      //   `unseal_approvals` — worker không truy vấn bảng này một lần nào.
      //   `unseal_requests`  — thu xuống quyền CỘT (xem test [S1.2] bên dưới); `reason` bị gỡ,
      //     và với break-glass thì `reason` chính là chỗ chi tiết sự cố nằm.
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
      // [S1.8 / 021] `bid_receipts` la bang thu hai ma quyen doc bi cat theo COT cho app_unseal,
      // va no o day vi mot ly do KHAC han `rfq_key_material`: khong phai de GIU BI MAT ma de
      // JOB TOAN VEN cua B5 chay duoc. `signature` vang mat co chu dich — kiem chu ky la viec
      // cua NHA CUNG CAP (B2), khong phai cua mot tien trinh may chu.
      { bang: "bid_receipts", cot: "bid_version_id" },
      { bang: "bid_receipts", cot: "canonical_text" },
      { bang: "bid_receipts", cot: "id" },
      { bang: "bid_receipts", cot: "org_id" },
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
      // [022] `unseal_requests` chuyển từ SELECT mức BẢNG xuống ĐÚNG sáu cột worker đọc.
      // `reason`, `break_glass`, và mọi mốc thời gian khác KHÔNG được cấp.
      { bang: "unseal_requests", cot: "dispatched_by" },
      { bang: "unseal_requests", cot: "dispatched_by_session_id" },
      { bang: "unseal_requests", cot: "id" },
      { bang: "unseal_requests", cot: "org_id" },
      { bang: "unseal_requests", cot: "rfq_id" },
      { bang: "unseal_requests", cot: "status" },
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
      // [S1.8, migration 021] `app_unseal` nay doc duoc BON cot cua bang nay — nhung day la danh
      // sach quyen GHI (truy van tren loc `privilege_type <> 'SELECT'`), nen chung nam o test
      // "[S1.2] quyen SELECT theo COT cua app_unseal" chu khong o day.
      // [S1.3] `guest_sessions` - CHI `revoked_at` co UPDATE. `otp_verified_at` KHONG sua duoc:
      // no la moc tra loi "phien nay qua OTP luc nao", va mot moc sua duoc la mot moc khong
      // dung de phan xet duoc. `verified_contact_id` cung khong - viet lai danh tinh da xac thuc
      // chinh la thu E5 sinh ra de chan.
      // [C2, 012] `challenge_id`: phien khach TRO TOI thach thuc da doi chieu, va trigger doi
      // `verified_contact_id`/`verified_channel` KHOP voi hang do. Khong co cot nay, danh tinh
      // da xac thuc la mot LOI KHAI cua nguoi goi.
      // [S1.14 / 042] Ba cột INSERT được, chỉ `hits` UPDATE được: một hàng đã ghi không đổi được
      // khoá băm lẫn mốc cửa sổ, nên không ai dời một bộ đếm sang cửa sổ khác.
      { grantee: "app_api", bang: "caller_rate_limits", cot: "bucket_hash", quyen: "INSERT" },
      { grantee: "app_api", bang: "caller_rate_limits", cot: "hits", quyen: "INSERT" },
      { grantee: "app_api", bang: "caller_rate_limits", cot: "hits", quyen: "UPDATE" },
      { grantee: "app_api", bang: "caller_rate_limits", cot: "window_start", quyen: "INSERT" },
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
      // [S1.10.7 / 031 / review M-5] app_api THAY được bí mật — vế "chỉ khi chưa xác nhận" do UPDATE ở
      // login.ts giữ (WHERE confirmed_at IS NULL), có đột biến. Hồ sơ đã xác nhận vẫn bất biến ở tầng app.
      { grantee: "app_api", bang: "mfa_credentials", cot: "secret_key_version", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "secret_wrapped", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "secret_wrapped", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_credentials", cot: "user_id", quyen: "INSERT" },
      // [040 / sổ nợ 40] mfa_reset_requests: cột yêu cầu chỉ INSERT (bất biến bởi trigger), cột duyệt và
      // tiêu thụ chỉ UPDATE (máy trạng thái bởi trigger); `id`, `requested_at`, `expires_at` không cấp.
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "approved_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "approved_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "approved_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "consumed_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "reason", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "requested_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "requested_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "status", quyen: "UPDATE" },
      { grantee: "app_api", bang: "mfa_reset_requests", cot: "user_id", quyen: "INSERT" },
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
      // [khoan no 26 / 026] BON dong MOI, va chung la mot NOI QUYEN phai nhin thay duoc.
      // `017` co y KHONG cap `UPDATE (wrapped_private_key)` cho app_api va goi su vang mat ay
      // la load-bearing. `026` cap no — nhung chi de GHI `NULL`: trigger
      // `rfq_key_material_bat_bien` tu choi moi gia tri moi khac NULL, va app_api VAN khong
      // doc duoc cot nay. Ghi duoc, chi ghi duoc NULL, va chi mot lan: hinh dang cua mot nut
      // PHA HUY, khong phai mot nut SUA. Ba cot `purged_*` la dau vet cua lan pha huy ay.
      { grantee: "app_api", bang: "rfq_key_material", cot: "purged_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "purged_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "purged_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "revoked_reason", quyen: "UPDATE" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "rfq_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "wrapped_private_key", quyen: "INSERT" },
      { grantee: "app_api", bang: "rfq_key_material", cot: "wrapped_private_key", quyen: "UPDATE" },
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
      // [ADR-020 mục 2 / 029] `mfa_verified_at` NAY CÓ INSERT — ĐẢO NGƯỢC câu Task 9 ở trên, và ghi ra
      // vì sao: ADR-020 đòi "không có đăng nhập nửa chừng" — một hàng `sessions` do app_api tạo phải
      // ĐÃ MFA ngay lúc chèn (trigger `sessions_kiem_mfa_khi_tao` ép), nên trạng thái "đã xác thực hai
      // lớp" tới trong CÙNG câu INSERT chứ không bằng "một câu lệnh riêng". Vế UPDATE giữ nguyên cho
      // `assertFreshMfa`/xác thực lại. Nguyên văn Task 9 giữ ở khối trên để đối chiếu.
      { grantee: "app_api", bang: "sessions", cot: "mfa_verified_at", quyen: "INSERT" },
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
      // [022, review S1.6 HIGH-2a] Nhân chứng của break-glass: nó bỏ qua NGƯỠNG, không bỏ qua
      // NGƯỜI THỨ HAI.
      { grantee: "app_api", bang: "unseal_requests", cot: "break_glass_witness_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "break_glass_witness_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "break_glass_witness_user_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "break_glass_witness_user_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "cancelled_at", quyen: "UPDATE" },
      // [022, review S1.6 HIGH-3] Mốc ĐIỀU PHỐI — thứ để worker hỏi lại được vế 2 của D1.
      { grantee: "app_api", bang: "unseal_requests", cot: "dispatched_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "dispatched_by", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "dispatched_by_session_id", quyen: "UPDATE" },
      { grantee: "app_api", bang: "unseal_requests", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "reason", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "requested_by", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "requested_by_session_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "unseal_requests", cot: "rfq_id", quyen: "INSERT" },
      // `status` co UPDATE nhung KHONG co INSERT: mot yeu cau khong duoc RA DOI da o APPROVED.
      { grantee: "app_api", bang: "unseal_requests", cot: "status", quyen: "UPDATE" },
      // [S1.10.4 / 029] user_login_tokens: cùng khuôn rfq_invitation_tokens — token_hash chỉ INSERT,
      // consumed_at chỉ UPDATE (đơn điệu bởi trigger), không có revoked_at.
      { grantee: "app_api", bang: "user_login_tokens", cot: "consumed_at", quyen: "UPDATE" },
      { grantee: "app_api", bang: "user_login_tokens", cot: "expires_at", quyen: "INSERT" },
      { grantee: "app_api", bang: "user_login_tokens", cot: "org_id", quyen: "INSERT" },
      { grantee: "app_api", bang: "user_login_tokens", cot: "purpose", quyen: "INSERT" },
      { grantee: "app_api", bang: "user_login_tokens", cot: "token_hash", quyen: "INSERT" },
      { grantee: "app_api", bang: "user_login_tokens", cot: "user_id", quyen: "INSERT" },
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
      // [025] Sáu cột vòng đời mà runner ghi — đúng bằng bộ của `app_api`, không hơn.
      { grantee: "app_unseal", bang: "outbox_jobs", cot: "attempts", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "outbox_jobs", cot: "finished_at", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "outbox_jobs", cot: "last_failure_reason", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "outbox_jobs", cot: "lease_expires_at", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "outbox_jobs", cot: "run_after", quyen: "UPDATE" },
      { grantee: "app_unseal", bang: "outbox_jobs", cot: "status", quyen: "UPDATE" },
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
      // [khoản nợ 29 / 027] CỐ Ý KHÔNG cấp gì thêm cho hàm phiên khách, và sự vắng mặt ấy là
      // một khẳng định: policy khách của `027` viết THẲNG `pg_catalog.current_setting(...)`
      // chứ không gọi một hàm của dự án, nên nó KHÔNG thêm một khớp nối quyền nào lên các
      // role. Bản đầu của `027` thì có, và chính khẳng định này cùng hai khẳng định ở
      // `audit-append-only` và `outbox` đã ĐỎ THẬT với `permission denied for function
      // app_current_guest_session_id` — ba lần đỏ ấy là lý do `027` được viết lại. Nếu ai đó
      // đưa một hàm trở lại vị từ policy, dòng này lại đỏ.
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

// ===============================================================================================
// [S1.32 / khoản nợ 76] BA TỔNG ĐIỀU TRA CHO CƠ CHẾ THỨ BA LÀM MỘT CÂU GHI TRẢ 0 HÀNG MÀ KHÔNG LỖI
//
// ADR-036 liệt kê MỌI cơ chế PostgreSQL có thể làm một câu ghi trả 0 hàng không lỗi. Với RLS có
// ba đường, và cả ba đều đứng ngoài lớp hình dạng [CR1] — lớp ấy chỉ soi policy PERMISSIVE trên
// bảng tenant, và cố ý bỏ qua RESTRICTIVE vì *"restrictive chỉ thu hẹp, không phải lỗ rò"*. Đúng
// cho câu hỏi RÒ; sai cho câu hỏi IM LẶNG:
//   ⑴ policy RESTRICTIVE `USING (false)` — đo trên PostgreSQL 16: `CREATE POLICY … AS RESTRICTIVE
//      FOR UPDATE USING (false)` trên `suppliers` ⇒ `migrate()` OK, policy còn nguyên, và app_api
//      trong tenant UPDATE ra 0 hàng, không lỗi;
//   ⑵ một bảng bật RLS mà KHÔNG policy PERMISSIVE nào phủ (lệnh, vai) trong khi quyền ĐÃ cấp —
//      mặc định-từ-chối của RLS: 0 hàng cho UPDATE/DELETE, không lỗi (đo: 87/87 tổ hợp hôm nay có
//      policy — khoảng trống, chưa phải lỗ);
//   ⑶ RLS bật trên một bảng NGOÀI tập tenant — lớp hình dạng không soi nó (đo: 2 bảng, một là gốc
//      tenant, một có mục hardening riêng).
// Cả ba đóng theo khuôn ADR-035: liệt kê RỘNG theo `pg_policy`/`pg_class`, buộc phân loại, đỏ cả
// hai chiều. Danh sách khai sinh từ trạng thái đo được tại `22de5fc` rồi đóng băng.
// ===============================================================================================

/** Vế "không phải phiên khách" — nửa đầu của mọi policy RESTRICTIVE do 027 dựng. */
const KHACH_NULL = "((NULLIF(current_setting('app.guest_session_id'::text, true), ''::text))::uuid IS NULL)";
const khachHoac = (ve: string): string =>
  `(((NULLIF(current_setting('app.guest_session_id'::text, true), ''::text))::uuid IS NULL) OR ${ve})`;
const veGuest = (cot: string, thietLap: string): string =>
  `(${cot} = (NULLIF(current_setting('${thietLap}'::text, true), ''::text))::uuid)`;

interface PolicyRestrictiveKhai {
  readonly lenh: string;
  readonly vai_tro: string;
  readonly using: string;
  readonly with_check: string;
}

/**
 * MỌI policy RESTRICTIVE của dự án, khoá theo `lược đồ.bảng.policy` [lượt soi 22] và bốn cột (lệnh, vai, USING, WITH CHECK)
 * nguyên văn `pg_get_expr`. 21 bảng chỉ mang vế "không phải phiên khách"; 8 bảng khách được đọc
 * thêm nới theo một cột. Một RESTRICTIVE mới — kể cả `USING (false)` — không có ở đây là ĐỎ.
 */
const POLICY_RESTRICTIVE_DA_KHAI: Readonly<Record<string, PolicyRestrictiveKhai>> = (() => {
  const chiKhach = (bang: string): [string, PolicyRestrictiveKhai] => [
    `public.${bang}.${bang}_khach`,
    { lenh: "*", vai_tro: "PUBLIC", using: KHACH_NULL, with_check: KHACH_NULL },
  ];
  const khachNoi = (bang: string, using: string, with_check = using): [string, PolicyRestrictiveKhai] => [
    `public.${bang}.${bang}_khach`,
    { lenh: "*", vai_tro: "PUBLIC", using, with_check },
  ];
  return Object.fromEntries([
    ...[
      "audit_chain_anchors", "audit_events", "invitation_otp_challenges", "mfa_credentials",
      "mfa_reset_requests", "org_procurement_policies", "organizations", "otp_rate_limits",
      "outbox_jobs", "rfq_approvals", "rfq_budgets", "rfq_invitation_tokens", "rfq_unsealed_bids",
      "sessions", "supplier_contacts", "suppliers", "unseal_approvals", "unseal_requests",
      "user_login_tokens", "user_roles", "users",
    ].map(chiKhach),
    khachNoi("bid_receipts", khachHoac("(bid_version_id IN ( SELECT v.id\n   FROM vendor_bid_versions v))")),
    khachNoi("guest_sessions", khachHoac(veGuest("id", "app.guest_session_id"))),
    khachNoi("rfq_invitations", khachHoac(veGuest("id", "app.guest_invitation_id"))),
    khachNoi("rfq_items", khachHoac(veGuest("rfq_id", "app.guest_rfq_id"))),
    khachNoi("rfq_key_material", khachHoac(veGuest("rfq_id", "app.guest_rfq_id")), KHACH_NULL),
    khachNoi("rfq_packages", khachHoac(veGuest("id", "app.guest_rfq_id"))),
    khachNoi("vendor_bid_versions", khachHoac("(bid_id IN ( SELECT b.id\n   FROM vendor_bids b))")),
    khachNoi("vendor_bids", khachHoac(veGuest("invitation_id", "app.guest_invitation_id"))),
  ]);
})();

/** Bảng bật RLS mà KHÔNG thuộc tập tenant (không org_id, không phải gốc) — mỗi tên phải có lý do. */
const BANG_RLS_NGOAI_TENANT: readonly string[] = [
  // 6195 của hardening.always.sql ghim riêng: RLS + FORCE + đúng một policy. Không có org_id vì
  // nó đếm theo NGƯỜI GỌI, xuyên tổ chức.
  "public.caller_rate_limits",
];

const CAU_POLICY_RESTRICTIVE =
  "SELECT n.nspname || '.' || c.relname AS ten_bang, p.polname AS ten_policy, p.polcmd AS lenh, " +
  CAU_VAI_TRO +
  "       pg_get_expr(p.polqual, p.polrelid) AS bieu_thuc_using, " +
  "       pg_get_expr(p.polwithcheck, p.polrelid) AS bieu_thuc_with_check " +
  "  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
  " WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND NOT p.polpermissive ORDER BY 1, 2";

/**
 * Phủ lệnh: mỗi (bảng RLS, vai ứng dụng, quyền SELECT/INSERT/UPDATE/DELETE đã cấp — ở mức bảng HAY
 * mức cột) phải có ít nhất một policy PERMISSIVE áp cho vai ấy (hoặc PUBLIC) ở lệnh ấy (hoặc ALL).
 */
const CAU_PHU_LENH = `
  WITH vai AS (SELECT r.rolname, r.oid FROM pg_roles r WHERE r.rolname IN ('app_api', 'app_unseal')),
  -- [lượt soi 22, H1] grantee = 0 là PUBLIC: không có hàng trong pg_roles, nên một JOIN thẳng LÀM RỚT
  -- nó — GRANT UPDATE ... TO PUBLIC cấp quyền hiệu dụng cho cả hai vai mà census không thấy. Nay mỗi
  -- entry PUBLIC nhân ra cho TỪNG vai.
  quyen AS (
    SELECT c.oid, n.nspname || '.' || c.relname AS ten_bang, vai.rolname, a.privilege_type
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      JOIN vai ON a.grantee = 0 OR a.grantee = vai.oid
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    UNION
    SELECT c.oid, n.nspname || '.' || c.relname, vai.rolname, a.privilege_type
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
      CROSS JOIN LATERAL aclexplode(att.attacl) a
      JOIN vai ON a.grantee = 0 OR a.grantee = vai.oid
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
  )
  SELECT q.ten_bang, q.rolname AS vai, q.privilege_type AS quyen,
         -- Khớp vai theo OID đúng tên (không xét kế thừa): policy TO nhom mà app_api là thành viên
         -- sẽ ĐỎ dù có phủ — chiều an toàn; hardening gỡ mọi tư cách thành viên lạ nên ca ấy chỉ là
         -- trạng thái tạm giữa hai deploy [lượt soi 22, L2].
         EXISTS (SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = q.oid AND p.polpermissive
                    AND (p.polroles = '{0}'::oid[]
                         OR (SELECT r.oid FROM pg_roles r WHERE r.rolname = q.rolname) = ANY (p.polroles))
                    AND (p.polcmd = '*' OR p.polcmd = CASE q.privilege_type
                           WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END)) AS co_policy
    FROM quyen q ORDER BY 1, 2, 3`;

describe("[S1.32 / khoản nợ 76] RLS như một cơ chế làm câu ghi trả 0 hàng mà không lỗi", () => {
  it("[INV-F1] TỔNG ĐIỀU TRA policy RESTRICTIVE: mọi policy phải được khai đủ bốn cột, đỏ cả hai chiều", async () => {
    const { rows } = await db.pool.query<HangPolicy>(CAU_POLICY_RESTRICTIVE);
    expect(rows.length, "câu truy vấn đang mù — 027 dựng ít nhất 29 policy RESTRICTIVE").toBeGreaterThan(20);
    const that = new Map(rows.map((r) => [`${r.ten_bang}.${r.ten_policy}`, r]));
    // Chiều 1: policy có thật mà chưa khai, hoặc khai LỆCH một cột.
    const lech: string[] = [];
    for (const [khoa, r] of that) {
      const khai = POLICY_RESTRICTIVE_DA_KHAI[khoa];
      if (!khai) {
        lech.push(`${khoa}: CHƯA KHAI`);
        continue;
      }
      const cot = [
        ["lenh", r.lenh, khai.lenh],
        ["vai_tro", r.vai_tro, khai.vai_tro],
        ["using", r.bieu_thuc_using, khai.using],
        ["with_check", r.bieu_thuc_with_check, khai.with_check],
      ].filter(([, a, b]) => a !== b);
      if (cot.length) lech.push(`${khoa}: lệch ${cot.map(([t, a]) => `${t}=${a}`).join(" | ")}`);
    }
    expect(
      lech,
      "Một policy RESTRICTIVE chưa khai hoặc đã đổi. RESTRICTIVE chỉ thu hẹp nên [CR1] không soi hình dạng " +
        "của nó — nhưng `USING (false)` thu hẹp về RỖNG: mọi UPDATE/DELETE của ứng dụng trả 0 hàng, không " +
        "lỗi, và bảng thành chỉ-ghi-thêm mà H19 không thấy. Khai đủ bốn cột vào POLICY_RESTRICTIVE_DA_KHAI " +
        "sau khi đọc biểu thức, hoặc gỡ policy.",
    ).toEqual([]);
    // Chiều 2: dòng khai thiu.
    expect(Object.keys(POLICY_RESTRICTIVE_DA_KHAI).filter((k) => !that.has(k)), "khai một policy CSDL không còn có").toEqual([]);
  });

  it("[INV-F1] ĐO: RESTRICTIVE USING (false) làm app_api ghi ra 0 hàng không lỗi — ~~sống qua migrate(), tổng điều tra là lớp duy nhất thấy~~ [S1.38] migrate() NÉM ở mục khoản 83⑴, và tổng điều tra vẫn thấy", async () => {
    const { rows: tc } = await db.pool.query<{ id: string }>("SELECT id FROM organizations ORDER BY slug LIMIT 1");
    const orgA = tc[0]!.id;
    // Dọn TRƯỚC (một lần chạy đổ trước có thể để lại) và dọn SAU, trong `finally` [lượt soi 22, M1].
    const don = async (): Promise<void> => {
      await db.pool.query("DROP POLICY IF EXISTS zz_chan ON users");
      await db.pool.query("DELETE FROM users WHERE email = 'zz-76@vidu.vn'");
    };
    await don();
    try {
      // `users`: app_api có UPDATE (email, full_name, status) từ 002 — một đường sản xuất thật.
      const { rows: u } = await db.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'zz-76@vidu.vn', 'zz') RETURNING id", [orgA]);
      const userId = u[0]!.id;
      await db.pool.query("CREATE POLICY zz_chan ON users AS RESTRICTIVE FOR UPDATE USING (false)");
      // (a) ~~hardening không thấy — đúng như [CR1] tự khai~~ [S1.38 / khoản nợ 83⑴] [CR1] vẫn không soi
      //     RESTRICTIVE (đúng cho câu hỏi RÒ), nhưng mục "policy thuộc đúng một lớp" nay chặn deploy: một
      //     RESTRICTIVE chưa khai là đúng cơ chế 0-hàng-không-lỗi này. Đo: trước S1.38 migrate() đi qua.
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(() => null, (e: Error) => e);
      expect(loi, "RESTRICTIVE chưa khai phải làm migrate() NÉM").not.toBeNull();
      expect(loi!.message).toContain("public.users.zz_chan: policy RESTRICTIVE không thuộc lớp nào (khoản 83⑴)");
      expect(loi!.message, "[CR1] không phải mục chặn — nó cố ý không soi RESTRICTIVE").not.toContain("thiếu vế");
      // (b) hành vi dưới app_api trong tenant: đọc được hàng, UPDATE ra 0 hàng, KHÔNG lỗi.
      const client = await apiPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
        const thay = await client.query("SELECT 1 FROM users WHERE id = $1", [userId]);
        expect(thay.rowCount, "app_api vẫn ĐỌC được hàng (policy chỉ chặn UPDATE)").toBe(1);
        const sua = await client.query("UPDATE users SET full_name = 'zz 2' WHERE id = $1", [userId]);
        expect(sua.rowCount, "UPDATE dưới app_api phải ra 0 hàng — IM LẶNG, không lỗi").toBe(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      // (c) tổng điều tra thấy nó, ở đúng một tên.
      const { rows } = await db.pool.query<HangPolicy>(CAU_POLICY_RESTRICTIVE);
      expect(rows.map((r) => `${r.ten_bang}.${r.ten_policy}`).filter((k) => !(k in POLICY_RESTRICTIVE_DA_KHAI))).toEqual(["public.users.zz_chan"]);
    } finally {
      await don();
    }
  });

  it("[INV-F1] PHỦ LỆNH: mọi quyền SELECT/INSERT/UPDATE/DELETE đã cấp cho app_api/app_unseal trên bảng RLS đều có policy PERMISSIVE phủ — mặc-định-từ-chối của RLS là 0 hàng không lỗi", async () => {
    const { rows } = await db.pool.query<{ ten_bang: string; vai: string; quyen: string; co_policy: boolean }>(CAU_PHU_LENH);
    expect(rows.length, "câu truy vấn đang mù — hôm nay có 87 tổ hợp (bảng, vai, quyền)").toBeGreaterThan(50);
    expect(
      rows.filter((r) => !r.co_policy).map((r) => `${r.ten_bang}/${r.vai}/${r.quyen}`),
      "Quyền đã cấp nhưng không policy PERMISSIVE nào phủ (lệnh, vai): RLS mặc định TỪ CHỐI — SELECT/UPDATE/" +
        "DELETE trả 0 hàng không lỗi, INSERT ném. Một bảng như thế là chỉ-ghi-thêm (hoặc chỉ-đọc) trong im " +
        "lặng. Thêm policy cho lệnh ấy, hoặc thu hồi quyền.",
    ).toEqual([]);

    // Mũi răng, trong một giao dịch rồi hoàn tác: bảng RLS có quyền UPDATE mà không policy.
    // Hai cách cấp: đích danh app_api, và qua PUBLIC — cách thứ hai từng vô hình [lượt soi 22, H1].
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE zz_rong (id int PRIMARY KEY, org_id uuid NOT NULL); " +
          "ALTER TABLE zz_rong ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_rong FORCE ROW LEVEL SECURITY; " +
          "GRANT SELECT ON zz_rong TO app_api; GRANT UPDATE ON zz_rong TO PUBLIC",
      );
      const { rows: sau } = await client.query<{ ten_bang: string; vai: string; quyen: string; co_policy: boolean }>(CAU_PHU_LENH);
      expect(sau.filter((r) => !r.co_policy).map((r) => `${r.ten_bang}/${r.vai}/${r.quyen}`).sort()).toEqual([
        "public.zz_rong/app_api/SELECT",
        "public.zz_rong/app_api/UPDATE",
        "public.zz_rong/app_unseal/UPDATE",
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("[INV-F1] TỔNG ĐIỀU TRA bảng bật RLS ngoài tập tenant: mỗi tên phải có lý do, đỏ cả hai chiều", async () => {
    const CAU_RLS = "SELECT n.nspname AS luoc_do, c.relname AS ten_bang FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      " WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r', 'p') AND c.relrowsecurity ORDER BY 1, 2";
    // `bangTenant` chỉ biết tên trần trong `public` — một bảng RLS ở lược đồ khác luôn là "ngoài".
    const ngoaiTenant = (rs: readonly { luoc_do: string; ten_bang: string }[]): string[] =>
      rs.filter((r) => !(r.luoc_do === "public" && bangTenant.includes(r.ten_bang))).map((r) => `${r.luoc_do}.${r.ten_bang}`);
    const { rows } = await db.pool.query<{ luoc_do: string; ten_bang: string }>(CAU_RLS);
    expect(rows.length, "câu truy vấn đang mù — hôm nay có 30 bảng bật RLS").toBeGreaterThan(20);
    const ngoai = ngoaiTenant(rows);
    expect(
      ngoai.filter((t) => !BANG_RLS_NGOAI_TENANT.includes(t)),
      "Bảng bật RLS mà không có org_id và không phải gốc tenant: lớp hình dạng [CR1] KHÔNG soi policy của " +
        "nó, nên một `USING (false)` ở đây vô hình. Khai tên kèm lý do vào BANG_RLS_NGOAI_TENANT.",
    ).toEqual([]);
    expect(BANG_RLS_NGOAI_TENANT.filter((t) => !ngoai.includes(t)), "khai một bảng không còn ngoài tenant").toEqual([]);
    // Đối chứng dương, hoàn tác: một bảng không org_id bật RLS phải rơi vào "ngoài tenant".
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TABLE zz_ngoai (id int PRIMARY KEY); ALTER TABLE zz_ngoai ENABLE ROW LEVEL SECURITY");
      const { rows: sau } = await client.query<{ luoc_do: string; ten_bang: string }>(CAU_RLS);
      expect(ngoaiTenant(sau).filter((t) => !BANG_RLS_NGOAI_TENANT.includes(t))).toEqual(["public.zz_ngoai"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

// ===============================================================================================
// [S1.38 / khoản nợ 83 — nửa RLS ⑴⑵⑶] BA TỔNG ĐIỀU TRA Ở TRÊN NAY CÓ MỤC HARDENING
//
// ADR-036 §3⑶ (S1.37): cơ chế mà chủ bảng không superuser tạo được và catalog phân biệt được tĩnh thì
// PHẢI có mục hardening. Ba mục ở `hardening.always.sql` cùng nhãn. Khối này giữ HAI thứ:
//   (a) HAI BẢN KHỚP — danh sách khai trong hardening (POLICY_RESTRICTIVE_KHAI, POLICY_KHAC_KHAI,
//       BANG_RLS_NGOAI_TENANT_KHAI) bằng bản ở đây, đo bằng văn bản (cùng khuôn meta-test [CR1]/[CR2]);
//   (b) CÂU PHÁN XÉT CỦA HARDENING chạy TRONG test — `docHangHardening` giải các hằng `$q$…$q$ ||
//       NAME || pg_catalog.format(…)` thành SQL rồi chạy trên cùng CSDL: hôm nay rỗng, và với fixture
//       trong giao dịch nó phải thấy ĐÚNG những gì tổng điều tra ở test thấy. Rồi `migrate()` NÉM với
//       fixture ngoài giao dịch — lớp sản xuất, đỏ đo được từng mục.
// ===============================================================================================

const HARDENING_SQL = readFileSync(`${MIGRATIONS_DIR}/hardening.always.sql`, "utf8");

/** [S1.39] Bộ giải hằng nay ở `db/hardening-hang.ts` (dùng chung với `hardening-suy-tu-tinh-chat.int.test.ts`). */
const docHangHardening = (ten: string): string => docHangHardeningTu(HARDENING_SQL, ten);

const lit = (v: string): string => `'${v.replaceAll("'", "''")}'`;

/** Policy KHÁC (không PERMISSIVE-trên-tenant, không RESTRICTIVE): bảy cột nguyên văn — bản ở hardening phải bằng. */
const POLICY_KHAC_DA_KHAI: readonly (readonly [string, string, string, string, string, string, string])[] = [
  ["caller_rate_limits", "caller_rate_limits_khach", "PERMISSIVE", "*", "PUBLIC", KHACH_NULL, KHACH_NULL],
];

describe("[S1.38 / khoản nợ 83 — nửa RLS] ba tổng điều tra RLS có mục hardening", () => {
  it("[INV-F1] HAI BẢN KHỚP: POLICY_RESTRICTIVE_KHAI trong hardening bằng các biến thể ngoài khuôn chuẩn của POLICY_RESTRICTIVE_DA_KHAI; POLICY_KHAC_KHAI và BANG_RLS_NGOAI_TENANT_KHAI bằng bản ở đây", () => {
    // Khuôn chuẩn (b1) — `<bảng>_khach`, ALL, PUBLIC, hai vế = "không phải phiên khách" — hardening nhận
    // theo TÍNH CHẤT, không cần khai; chỉ tám biến thể nới theo cột mới phải khai đủ sáu cột.
    const bienThe = Object.entries(POLICY_RESTRICTIVE_DA_KHAI)
      .filter(([, k]) => k.using !== KHACH_NULL || k.with_check !== KHACH_NULL)
      .map(([khoa, k]) => {
        const [, bang, polname] = khoa.split(".");
        return [bang!, polname!, k.lenh, k.vai_tro, k.using, k.with_check] as const;
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(bienThe.length, "027 nới tám bảng khách").toBe(8);
    const khoiRestrictive =
      "(VALUES\n" + bienThe.map((r) => "         (" + r.map(lit).join(", ") + ")").join(",\n") +
      "\n       ) AS g(bang, polname, lenh, vai_tro, bieu_thuc_using, bieu_thuc_with_check)";
    // [lượt soi 29, NHẸ-5] so với CHÍNH hằng (qua bộ giải), không phải văn bản thô cả tệp — một bản sao thiu
    // trong chú thích không thoả được cổng này.
    expect(docHangHardening("POLICY_RESTRICTIVE_KHAI"), "POLICY_RESTRICTIVE_KHAI phải BẰNG bản sinh từ test").toBe(khoiRestrictive);
    const khoiKhac =
      "(VALUES\n" + POLICY_KHAC_DA_KHAI.map((r) => "         (" + r.map(lit).join(", ") + ")").join(",\n") +
      "\n       ) AS k(bang, polname, loai, lenh, vai_tro, bieu_thuc_using, bieu_thuc_with_check)";
    expect(docHangHardening("POLICY_KHAC_KHAI"), "POLICY_KHAC_KHAI phải BẰNG bản ở test").toBe(khoiKhac);
    const khoiNgoai = "(VALUES " + BANG_RLS_NGOAI_TENANT.map((t) => { const [n, r] = t.split("."); return `(${lit(n!)}, ${lit(r!)})`; }).join(", ") + ") AS b(nspname, relname)";
    expect(docHangHardening("BANG_RLS_NGOAI_TENANT_KHAI"), "BANG_RLS_NGOAI_TENANT_KHAI phải BẰNG bản ở test").toBe(khoiNgoai);
    // Bộ giải hằng phải giải được cả ba câu phán xét — và phải NÉM trước cú pháp nó không hiểu (đối chứng:
    // NEO_003 định nghĩa bằng CASE), để một hằng viết kiểu khác là đỏ ồn ào chứ không xanh mù [lượt soi 29, INFO-11].
    for (const ten of ["CAU_POLICY_LOP_SAI", "CAU_PHU_LENH_SAI", "CAU_RLS_NGOAI_TENANT_SAI"]) {
      expect(docHangHardening(ten).length).toBeGreaterThan(200);
    }
    expect(() => docHangHardening("NEO_003")).toThrow(/cú pháp lạ|không thấy hằng/u);
  });

  it("[INV-F1] [khoản nợ 88 — lượt soi 33a #2, 36 #1/#2] ⑵ tập vai = TÍNH CHẤT ∪ TÊN ĐÃ GHIM, quyền theo kế thừa: vai lạ thành viên app_api + GRANT DELETE trực tiếp ⇒ bản bốn tên IM; app_api_login BỊ GỠ membership + GRANT ⇒ bản chỉ-tính-chất IM; quyền qua NHÓM ⇒ bản grantee-trực-tiếp IM — câu hợp thấy cả ba", async () => {
    const phu = docHangHardening("CAU_PHU_LENH_SAI");
    const vai = docHangHardening("VAI_KET_NOI_UNG_DUNG");
    const veTinhChat = `r.rolname IN (SELECT v.rolname FROM (${vai}) v)`;
    expect(phu, "⑵ phải lấy tập vai từ VAI_KET_NOI_UNG_DUNG").toContain(veTinhChat);
    // [lượt soi 36 #1] và HỢP bốn tên đã ghim — qua hằng ROLE_CANH (một bản), không phải bản chép thứ ba.
    const veTen = `OR r.rolname IN ${docHangHardening("ROLE_CANH")}`;
    expect(phu, "⑵ phải hợp ROLE_CANH").toContain(veTen);
    expect(phu.split("'app_api_login'").length, "bốn tên xuất hiện đúng một lần (qua ROLE_CANH)").toBe(2);
    // Ba bản đối chứng dựng từ chính câu mới (split/join — vế thay không được đi qua `$` của String.replace):
    //   bản BỐN TÊN (S1.38–S1.43): vế tính chất thay bằng bốn tên; bản CHỈ TÍNH CHẤT (bản đầu S1.44): bỏ vế tên đã ghim;
    //   bản GRANTEE TRỰC TIẾP: pg_has_role(…) thay bằng a.grantee = vai.oid.
    const phuCu = phu.split(veTinhChat).join("r.rolname IN ('app_api', 'app_unseal', 'app_api_login', 'app_unseal_login')");
    const phuChiTinhChat = phu.split(veTen).join("");
    const veKeThua = "OR pg_catalog.pg_has_role(vai.oid, CASE WHEN a.grantee = 0 THEN vai.oid ELSE a.grantee END, 'USAGE')";
    expect(phu.split(veKeThua).length, "hai nhánh quyen (bảng, cột) đều xét kế thừa").toBe(3);
    const phuTrucTiep = phu.split(veKeThua).join("OR a.grantee = vai.oid");
    for (const b of [phuCu, phuChiTinhChat, phuTrucTiep]) expect(b).not.toBe(phu);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      // Vai lạ được cấp app_api (điều BƯỚC 1 của hardening gỡ ở lượt SỬA — nhưng ⑵ không được TỰA vào đó): membership
      // và bảng đều nằm trong giao dịch, ROLLBACK trả mọi thứ.
      await client.query("CREATE ROLE zz_vai88 NOLOGIN; GRANT app_api TO zz_vai88");
      await client.query(
        "CREATE TABLE zz_t88 (id int PRIMARY KEY, org_id uuid NOT NULL); " +
        "ALTER TABLE zz_t88 ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_t88 FORCE ROW LEVEL SECURITY; " +
        "CREATE POLICY zz_t88_doc ON zz_t88 FOR SELECT TO app_api USING (true); " +
        "GRANT SELECT, DELETE ON zz_t88 TO zz_vai88",
      );
      const ten = (r: { mo_ta: string }): string => r.mo_ta.split(":")[0]!;
      const thay = async (cau: string): Promise<string[]> => (await client.query<{ mo_ta: string }>(cau)).rows.map(ten).sort();
      // (a) SELECT của zz_vai88 được policy cho app_api phủ (has_privs_of_role bắc cầu); DELETE thì không policy nào phủ.
      expect(await thay(phu), "tính chất: thấy đúng một dòng").toEqual(["public.zz_t88/zz_vai88/DELETE"]);
      expect(await thay(phuCu), "bốn tên viết tay: IM").toEqual([]);
      // Tập vai theo tính chất CHỨA hai vai ứng dụng lẫn vai lạ (hai vai đăng nhập không tồn tại ở CSDL test: hardening
      // CỐ Ý không tạo chúng — xem đầu tệp; dưới đây dựng app_api_login trong giao dịch để đo đúng ca của lượt soi 36 #1).
      const tap = (await client.query<{ rolname: string }>(vai)).rows.map((r) => r.rolname);
      for (const t of ["app_api", "app_unseal", "zz_vai88"]) expect(tap, t).toContain(t);
      // (b) [lượt soi 36 #1 NẶNG] app_api_login BỊ GỠ membership (ADMIN OPTION làm được) rồi nhận GRANT trực tiếp: kết nối
      //     thật vẫn mang tên ấy, policy TO app_api không phủ ⇒ 0 hàng không lỗi — bản chỉ-tính-chất không còn thấy nó.
      await client.query("CREATE ROLE app_api_login NOLOGIN; GRANT SELECT ON zz_t88 TO app_api_login");
      expect(await thay(phu), "tên đã ghim: thấy app_api_login dù không membership").toEqual(["public.zz_t88/app_api_login/SELECT", "public.zz_t88/zz_vai88/DELETE"]);
      expect(await thay(phuChiTinhChat), "chỉ tính chất: IM về app_api_login").toEqual(["public.zz_t88/zz_vai88/DELETE"]);
      // đối chứng: cấp lại membership ⇒ policy TO app_api phủ ⇒ dòng biến mất
      await client.query("GRANT app_api TO app_api_login");
      expect(await thay(phu), "có membership: policy phủ").toEqual(["public.zz_t88/zz_vai88/DELETE"]);
      // (c) [lượt soi 36 #2] quyền tới qua NHÓM: GRANT UPDATE cho nhóm mà app_api là thành viên — app_api (và mọi thành viên
      //     kế thừa của nó: app_api_login, zz_vai88) có UPDATE thật mà không policy UPDATE nào; bản grantee-trực-tiếp im.
      await client.query("CREATE ROLE zz_nhom88 NOLOGIN; GRANT zz_nhom88 TO app_api; GRANT UPDATE ON zz_t88 TO zz_nhom88");
      expect(await thay(phu), "kế thừa: thấy UPDATE qua nhóm cho cả ba").toEqual([
        "public.zz_t88/app_api/UPDATE", "public.zz_t88/app_api_login/UPDATE", "public.zz_t88/zz_vai88/DELETE", "public.zz_t88/zz_vai88/UPDATE",
      ]);
      const moTa = (await client.query<{ mo_ta: string }>(phu)).rows.map((r) => r.mo_ta);
      expect(moTa.find((m) => m.startsWith("public.zz_t88/app_api/UPDATE")), "mô tả nêu đường tới quyền").toContain("(qua zz_nhom88)");
      expect(moTa.find((m) => m.startsWith("public.zz_t88/zz_vai88/DELETE")), "quyền trực tiếp: không nêu đường").not.toContain("(qua ");
      expect(await thay(phuTrucTiep), "grantee trực tiếp: IM về quyền qua nhóm").toEqual(["public.zz_t88/zz_vai88/DELETE"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("[INV-F1] CÂU PHÁN XÉT CỦA HARDENING chạy trong test: hôm nay rỗng cả ba; với fixture trong giao dịch, nó thấy đúng những gì tổng điều tra ở test thấy", async () => {
    const lop = docHangHardening("CAU_POLICY_LOP_SAI");
    const phu = docHangHardening("CAU_PHU_LENH_SAI");
    const ngoai = docHangHardening("CAU_RLS_NGOAI_TENANT_SAI");
    for (const [ten, cau] of [["⑴", lop], ["⑵", phu], ["⑶", ngoai]] as const) {
      expect((await db.pool.query<{ mo_ta: string }>(cau)).rows.map((r) => r.mo_ta), `hardening ${ten} phải rỗng trên lược đồ hợp lệ`).toEqual([]);
    }
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      // ⑴ RESTRICTIVE chưa khai, và một PERMISSIVE trên bảng RLS ngoài tenant chưa khai.
      await client.query("CREATE POLICY zz_r ON users AS RESTRICTIVE FOR UPDATE USING (false)");
      await client.query("CREATE POLICY zz_p ON caller_rate_limits FOR SELECT USING (true)");
      const l1 = (await client.query<{ mo_ta: string }>(lop)).rows.map((r) => r.mo_ta.split(":")[0]);
      expect(l1.sort()).toEqual(["public.caller_rate_limits.zz_p", "public.users.zz_r"]);
      // ⑴ và khuôn chuẩn (b1): một `<bảng>_khach` mới đúng khuôn 027 KHÔNG cần khai.
      await client.query("CREATE TABLE zz_moi (id int PRIMARY KEY, org_id uuid NOT NULL); " +
        "CREATE POLICY zz_moi_khach ON zz_moi AS RESTRICTIVE USING " + KHACH_NULL + " WITH CHECK " + KHACH_NULL);
      expect((await client.query<{ mo_ta: string }>(lop)).rows.map((r) => r.mo_ta.split(":")[0]).sort()).toEqual(["public.caller_rate_limits.zz_p", "public.users.zz_r"]);
      // ⑴ [lượt soi 29, NHẸ-3] `<bảng>_khach` THIẾU một vế (WITH CHECK-only) không được nhận là khuôn chuẩn.
      await client.query("CREATE TABLE zz_moi2 (id int PRIMARY KEY, org_id uuid NOT NULL); " +
        "CREATE POLICY zz_moi2_khach ON zz_moi2 AS RESTRICTIVE WITH CHECK " + KHACH_NULL);
      expect((await client.query<{ mo_ta: string }>(lop)).rows.map((r) => r.mo_ta.split(":")[0]).sort()).toEqual(["public.caller_rate_limits.zz_p", "public.users.zz_r", "public.zz_moi2.zz_moi2_khach"]);
      // ⑵ [lượt soi 29, NHẸ-6] thu hẹp VAI của policy cách ly trên bảng THẬT: [CR1] không khoá vai — đi qua;
      //    ⑵ là thứ bắt (mọi quyền của app_api trên users mất phủ).
      await client.query("ALTER POLICY users_tenant_isolation ON users TO app_unseal");
      // (zz_moi/zz_moi2 ở trên là bảng tenant chưa có policy PERMISSIVE — nguồn (i) của [CR1] kêu, đúng; chỉ soi users.)
      expect((await client.query<{ mo_ta: string }>(docHangHardening("CAU_POLICY_SAI"))).rows.map((r) => r.mo_ta).filter((m) => m.startsWith("users")), "[CR1] không khoá vai").toEqual([]);
      const phuUsers = (await client.query<{ mo_ta: string }>(phu)).rows.map((r) => r.mo_ta.split(":")[0]);
      expect(phuUsers).toContain("public.users/app_api/SELECT");
      expect(phuUsers).toContain("public.users/app_api/UPDATE");
      await client.query("ALTER POLICY users_tenant_isolation ON users TO PUBLIC");
      // ⑵ [lượt soi 29, NẶNG-2] con INHERITS của bảng tenant CÓ GRANT riêng KHÔNG được miễn: đọc thẳng con là
      //    truy cập duy nhất cần quyền ấy, và RLS (mục A bật) từ chối trong im lặng.
      await client.query("CREATE TABLE zz_con () INHERITS (users); ALTER TABLE zz_con ENABLE ROW LEVEL SECURITY; GRANT SELECT ON zz_con TO app_api");
      expect((await client.query<{ mo_ta: string }>(phu)).rows.map((r) => r.mo_ta.split(":")[0])).toEqual(["public.zz_con/app_api/SELECT"]);
      await client.query("DROP TABLE zz_con");
      // ⑵ cùng fixture với tổng điều tra PHỦ LỆNH ở trên: ba tổ hợp, cả đích danh lẫn qua PUBLIC.
      await client.query("CREATE TABLE zz_rong (id int PRIMARY KEY, org_id uuid NOT NULL); " +
        "ALTER TABLE zz_rong ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_rong FORCE ROW LEVEL SECURITY; " +
        "GRANT SELECT ON zz_rong TO app_api; GRANT UPDATE ON zz_rong TO PUBLIC");
      expect((await client.query<{ mo_ta: string }>(phu)).rows.map((r) => r.mo_ta.split(":")[0]).sort()).toEqual([
        "public.zz_rong/app_api/SELECT", "public.zz_rong/app_api/UPDATE", "public.zz_rong/app_unseal/UPDATE",
      ]);
      // ⑶ cùng fixture với tổng điều tra NGOÀI TENANT ở trên.
      await client.query("CREATE TABLE zz_ngoai (id int PRIMARY KEY); ALTER TABLE zz_ngoai ENABLE ROW LEVEL SECURITY");
      expect((await client.query<{ mo_ta: string }>(ngoai)).rows.map((r) => r.mo_ta.split(":")[0])).toEqual(["public.zz_ngoai"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("[INV-F1] ĐO: migrate() NÉM ở đúng mục cho từng cơ chế — bảng RLS có quyền mà không policy (⑵), bảng RLS ngoài tenant (⑶); và khoản 82⑵: policy caller_rate_limits ghim NGUYÊN VĂN, `false AND …` không còn đi qua", async () => {
    const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
    // ⑵ — fixture NGOÀI giao dịch để migrate() (kết nối khác) thấy được; dọn trong finally.
    await db.pool.query("DROP TABLE IF EXISTS zz_rong83");
    await db.pool.query("CREATE TABLE zz_rong83 (id int PRIMARY KEY, org_id uuid NOT NULL); " +
      "ALTER TABLE zz_rong83 ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_rong83 FORCE ROW LEVEL SECURITY; " +
      "CREATE POLICY zz_rong83_tenant_isolation ON zz_rong83 USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id()); " +
      "GRANT SELECT ON zz_rong83 TO app_unseal");
    try {
      // Bảng tenant hợp lệ với [CR1] (policy đúng khuôn) nhưng app_unseal có SELECT mà policy chỉ cho PUBLIC?
      // Không — policy PUBLIC phủ cả app_unseal. Thu hẹp policy về app_api để app_unseal hụt phủ:
      await db.pool.query("ALTER POLICY zz_rong83_tenant_isolation ON zz_rong83 TO app_api");
      const loi2 = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi2, "quyền SELECT của app_unseal không policy nào phủ phải làm migrate() NÉM").not.toBeNull();
      expect(loi2!.message).toContain("public.zz_rong83/app_unseal/SELECT: quyền đã cấp mà không policy PERMISSIVE nào phủ (lệnh, vai) (khoản 83⑵)");
      await db.pool.query("REVOKE SELECT ON zz_rong83 FROM app_unseal");
      // [lượt soi 29, NHẸ-6] [CR1] KHÔNG khoá vai (HINH_DANG_CHUAN toàn cục) — policy TO app_api đi qua [CR1];
      // dựng lại về PUBLIC chỉ để đối chứng đi qua sạch cả ⑵.
      await db.pool.query("ALTER POLICY zz_rong83_tenant_isolation ON zz_rong83 TO PUBLIC");
      expect(await loiCua(migrate(db.pool, MIGRATIONS_DIR)), "đối chứng: thu hồi quyền ⇒ đi qua").toBeNull();
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS zz_rong83");
    }
    // ⑶
    await db.pool.query("DROP TABLE IF EXISTS zz_ngoai83");
    await db.pool.query("CREATE TABLE zz_ngoai83 (id int PRIMARY KEY); ALTER TABLE zz_ngoai83 ENABLE ROW LEVEL SECURITY");
    try {
      const loi3 = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi3, "bảng RLS ngoài tenant chưa khai phải làm migrate() NÉM").not.toBeNull();
      expect(loi3!.message).toContain("public.zz_ngoai83: bảng bật RLS ngoài tập tenant chưa khai (khoản 83⑶)");
      await db.pool.query("ALTER TABLE zz_ngoai83 DISABLE ROW LEVEL SECURITY");
      expect(await loiCua(migrate(db.pool, MIGRATIONS_DIR)), "đối chứng: tắt RLS ⇒ đi qua").toBeNull();
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS zz_ngoai83");
    }
    // 82⑵ — [lượt soi 25a #7] bản cũ ghim bằng LIKE '%app.guest_session_id%' nên `false AND …` đi qua (đo, S1.35).
    const veGia = "(false AND NULLIF(current_setting('app.guest_session_id', true), '') IS NULL)";
    await db.pool.query(`ALTER POLICY caller_rate_limits_khach ON caller_rate_limits USING ${veGia} WITH CHECK ${veGia}`);
    try {
      const loi4 = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi4, "policy caller_rate_limits bị đổi thành false AND … phải làm migrate() NÉM").not.toBeNull();
      expect(loi4!.message).toContain("RLS/policy của caller_rate_limits lệch");
      // và mục ⑴ cũng thấy nó (không còn khớp bảy cột đã khai) — hai lớp cho một ca, nêu tên cả hai.
      expect(loi4!.message).toContain("public.caller_rate_limits.caller_rate_limits_khach: policy PERMISSIVE không thuộc lớp nào (khoản 83⑴)");
    } finally {
      // Mục caller_rate_limits chỉ DỰNG khi policy vắng: xoá rồi để migrate() dựng lại bản chuẩn.
      await db.pool.query("DROP POLICY IF EXISTS caller_rate_limits_khach ON caller_rate_limits");
      await migrate(db.pool, MIGRATIONS_DIR);
    }
    expect((await db.pool.query<{ mo_ta: string }>(docHangHardening("CAU_POLICY_LOP_SAI"))).rows, "sau khi dựng lại, ⑴ phải rỗng").toEqual([]);
    // [lượt soi 29, NHẸ-7] giữ nguyên hai vế mà đổi VAI: mục riêng phải tự bắt (không tựa vào ⑴/⑵).
    await db.pool.query("ALTER POLICY caller_rate_limits_khach ON caller_rate_limits TO app_unseal");
    try {
      const loi5 = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi5, "đổi vai của policy caller_rate_limits phải làm migrate() NÉM").not.toBeNull();
      expect(loi5!.message).toContain("RLS/policy của caller_rate_limits lệch");
    } finally {
      await db.pool.query("ALTER POLICY caller_rate_limits_khach ON caller_rate_limits TO PUBLIC");
    }
    expect(await loiCua(migrate(db.pool, MIGRATIONS_DIR)), "đối chứng: về PUBLIC ⇒ đi qua").toBeNull();
  }, 180000); // [S1.40] sáu lần migrate(): hạn 180 s như các test ĐO ở hardening-suy-tu-tinh-chat — hạn mặc định 30 s chạm ngưỡng dưới tải song song của evidence (đo: 30014 ms)
});

// ===============================================================================================
// [S1.41 / khoản nợ 85] BẬC TỰ DO "BẢNG CÓ org_id NGOÀI public KHÔNG TREO DƯỚI BẢNG TENANT" — ĐÓNG
//
// Vị từ bảng tenant chỉ nhận public; con cháu ngoài public vào tập qua pg_inherits (S1.40 đệ quy). Còn lại một
// hình dạng không lớp nào chạm: bảng có cột org_id, ngoài public, không treo dưới bảng tenant, KHÔNG bật RLS —
// (A) không bật, [CR1] không soi, 83⑵/83⑶ không thấy. Lượt soi 31 đọc ra ba kẽ cùng đổ về đó. Mục hardening
// CAU_ORG_ID_NGOAI_PUBLIC_SAI + BANG_ORG_ID_NGOAI_PUBLIC_KHAI (rỗng): bắt hình dạng ấy phải khai — không nới
// VI_TU_BANG_TENANT (bán kính nổ). Bật RLS lên nó thì rơi sang 83⑶: hai mục kề nhau, không chồng.
// ===============================================================================================

/** [S1.41] `schema.bảng` có org_id ngoài public, ngoài tập tenant, không RLS — RỖNG là lời khai; bản hardening: BANG_ORG_ID_NGOAI_PUBLIC_KHAI. */
const BANG_ORG_ID_NGOAI_PUBLIC_DA_KHAI: readonly string[] = [];

describe("[S1.41 / khoản nợ 85] bảng có org_id ngoài public không treo dưới bảng tenant", () => {
  const ten = async (c: pg.PoolClient | pg.Pool, q: string): Promise<string[]> =>
    (await c.query<{ mo_ta: string }>(q)).rows.map((r) => r.mo_ta.split(":")[0]!).sort();

  it("[INV-F1] HAI BẢN KHỚP và CÂU PHÁN XÉT chạy trong test: rỗng hôm nay; fixture trong giao dịch — bảng org_id ngoài public bị thấy, không org_id / bật RLS (sang 83⑶) / treo dưới tenant thì không; NO INHERIT và DETACH PARTITION làm bảng rơi vào mục; chiều ngược bắt dòng khai thiu", async () => {
    expect(docHangHardening("BANG_ORG_ID_NGOAI_PUBLIC_KHAI")).toBe(
      khoiValues(BANG_ORG_ID_NGOAI_PUBLIC_DA_KHAI.map((t) => t.split(".") as [string, string]), "oi", ["nspname", "relname"]),
    );
    const cau = docHangHardening("CAU_ORG_ID_NGOAI_PUBLIC_SAI");
    const ngoai = docHangHardening("CAU_RLS_NGOAI_TENANT_SAI");
    expect(cau.length).toBeGreaterThan(400);
    // [lượt soi 32, NHẸ-3] hình dạng 85 là MỘT hằng, hai chiều cùng tham chiếu; vế "có cột org_id" là MỘT hằng dùng
    // chung với vị từ tenant — nới một nơi thì nơi kia đi theo.
    expect(HARDENING_SQL).toMatch(/\n  CAU_ORG_ID_NGOAI_PUBLIC_SAI constant text :=[\s\S]*?VI_TU_HINH_DANG_85[\s\S]*?VI_TU_HINH_DANG_85[\s\S]*?\$q\$;/u);
    const hinhDang = docHangHardening("VI_TU_HINH_DANG_85");
    expect(cau.split(hinhDang).length - 1, "hai chiều cùng một hình dạng").toBe(2);
    const coOrgId = docHangHardening("MAU_VI_TU_CO_ORG_ID").replaceAll("%1$s", "c");
    expect(hinhDang).toContain(coOrgId);
    expect(docHangHardening("VI_TU_BANG_TENANT"), "vị từ tenant dùng cùng vế org_id").toContain(coOrgId);
    // [lượt soi 32, NHẸ-2 + điều 2 mang sang] KHUÔN SENTINEL: mọi danh sách khai RỖNG là một hàng toàn chuỗi rỗng, và
    // chiều ngược của mục dùng nó PHẢI chắn `<> ''` — to_regclass('""."" ') im trên PG 16 nhờ đường soft-error, ném 42601
    // trên PG ≤ 15; xanh phải nhờ mã. Kiểm bằng văn bản trên cả năm danh sách của tệp hardening, không cần chạy SQL.
    // [lượt soi 33a, INFO-9] quét MỌI hằng `*_KHAI` của tệp thay vì ghim năm tên: danh sách nào RỖNG (hàng sentinel) thì chiều
    // ngược của mục dùng nó phải chắn `<> ''` trên một cột của chính khối VALUES ấy; danh sách có hàng thì không cần.
    const tatCaKhai = [...HARDENING_SQL.matchAll(/\n  ([A-Z_]+_KHAI) constant text :=/gu)].map((m) => m[1]!);
    expect(tatCaKhai.length, "câu quét đang mù").toBeGreaterThanOrEqual(8);
    let soRong = 0;
    for (const danhSach of tatCaKhai) {
      const khoi = docHangHardening(danhSach);
      const sentinel = /^\(VALUES \(''(?:, '')*\)\) AS (\w+)\(([^)]*)\)$/u.exec(khoi);
      if (!sentinel) continue;
      soRong++;
      const [, biDanh, cotChuoi] = sentinel;
      const cot = cotChuoi!.split(",").map((t) => t.trim()).join("|");
      expect(HARDENING_SQL, `${danhSach}: chiều ngược phải chắn hàng sentinel`).toMatch(
        new RegExp(`FROM \\$q\\$ \\|\\| ${danhSach} \\|\\| \\$q\\$\\n(?:\\s*--[^\\n]*\\n)*\\s+WHERE ${biDanh}\\.(?:${cot}) <> ''`, "u"),
      );
    }
    expect(soRong, "hôm nay tám danh sách rỗng (S1.46 BANG_KHOA_NGOAI_TENANT_KHAI, S1.47 GUC_TUY_BIEN_KHAI, S1.51 GUC_VAN_HANH_KHAI)").toBe(8);
    expect(await ten(db.pool, cau), "lược đồ thật không có bảng org_id ngoài public").toEqual([]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`
        CREATE SCHEMA zz_s;
        CREATE TABLE zz_s.t (id int, org_id uuid NOT NULL);
        CREATE TABLE zz_s.t_khong (id int);
        CREATE TABLE zz_s.t_rls (id int, org_id uuid NOT NULL);
        ALTER TABLE zz_s.t_rls ENABLE ROW LEVEL SECURITY;
        CREATE TABLE zz_s.con () INHERITS (public.users);
        CREATE TABLE public.zz_pp (id int, org_id uuid NOT NULL) PARTITION BY LIST (org_id);
        CREATE TABLE zz_s.la PARTITION OF public.zz_pp DEFAULT;
      `);
      expect(await ten(c, cau), "chỉ bảng org_id ngoài public, không RLS, không treo dưới tenant").toEqual(["zz_s.t"]);
      expect(await ten(c, ngoai), "bảng org_id ngoài public ĐÃ bật RLS là việc của 83⑶").toEqual(["zz_s.t_rls"]);
      // Kẽ ⑴ (lượt soi 31 NHẸ-1) và ⑵ (NHẸ-3): tách khỏi cây tenant là rơi vào mục — cùng cơ chế ADR-036 hàng 22.
      await c.query("ALTER TABLE zz_s.con NO INHERIT public.users; ALTER TABLE public.zz_pp DETACH PARTITION zz_s.la");
      expect(await ten(c, cau)).toEqual(["zz_s.con", "zz_s.la", "zz_s.t"]);
      // Cửa ra hợp lệ: đưa về public (thành bảng tenant, [CR1] đòi policy) hay bật RLS (83⑶ đòi khai).
      await c.query("ALTER TABLE zz_s.t SET SCHEMA public; ALTER TABLE zz_s.con ENABLE ROW LEVEL SECURITY");
      expect(await ten(c, cau)).toEqual(["zz_s.la"]);
      expect(await ten(c, ngoai)).toEqual(["zz_s.con", "zz_s.t_rls"]);
      // Chiều ngược: giả lập một dòng khai (danh sách thật rỗng) — khai zz_s.la khi nó đang đúng hình dạng ⇒ im;
      // bật RLS lên nó ⇒ dòng khai thiu.
      const khai = cau.replaceAll("(VALUES ('', '')) AS oi(", "(VALUES ('zz_s', 'la')) AS oi(");
      expect(khai.split("'la'").length - 1, "khối khai phải được thay ở CẢ HAI chiều").toBe(2);
      expect(await ten(c, khai)).toEqual([]);
      // [S1.48 / lượt soi ngang 40a H3] Chiều ngược chạy được dưới vai KHÔNG có USAGE trên zz_s: "bảng còn tồn tại" đọc bằng
      // JOIN catalog, không bằng to_regclass (phân giải tên ⇒ 42501 dưới N2 ⇒ "KHÔNG ĐÁNH GIÁ ĐƯỢC" mãi). Đột biến trả lại
      // to_regclass ⇒ đỏ 42501 ở đây.
      await c.query("CREATE ROLE zz_khong_usage; SET ROLE zz_khong_usage");
      expect(await ten(c, khai), "vai không USAGE trên schema vẫn đánh giá được chiều ngược").toEqual([]);
      await c.query("RESET ROLE");
      await c.query("ALTER TABLE zz_s.la ENABLE ROW LEVEL SECURITY");
      expect((await c.query<{ mo_ta: string }>(khai)).rows.map((r) => r.mo_ta)).toEqual([
        expect.stringContaining("khai zz_s.la là bảng org_id ngoài public không RLS (khoản 85) mà CSDL không có bảng như thế"),
      ]);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[INV-F1] ĐO: bảng org_id ngoài public không RLS — app_api gắn tổ chức A đọc được hàng của B qua một GRANT (lỗ RÒ), và migrate() NÉM ở mục khoản 85; bật RLS ⇒ mục im, 83⑶ kêu; DROP ⇒ đi qua", async () => {
    const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
    const orgA = "00000000-0000-4000-8000-00000000008a";
    const orgB = "00000000-0000-4000-8000-00000000008b";
    await db.pool.query("DROP SCHEMA IF EXISTS zz_s85 CASCADE");
    await db.pool.query(
      "CREATE SCHEMA zz_s85; CREATE TABLE zz_s85.t (gia int, org_id uuid NOT NULL); " +
        "GRANT USAGE ON SCHEMA zz_s85 TO app_api; GRANT SELECT ON zz_s85.t TO app_api",
    );
    try {
      await db.pool.query("INSERT INTO zz_s85.t VALUES (777, $1)", [orgB]);
      const apiPool = db.poolAs("app_api");
      const client = await apiPool.connect();
      try {
        await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
        expect((await client.query<{ gia: number }>("SELECT gia FROM zz_s85.t")).rows.map((r) => r.gia), "lỗ RÒ có thật").toEqual([777]);
      } finally {
        client.release();
      }
      const loi = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi, "bảng org_id ngoài public không RLS phải bị khoản 85 bắt").not.toBeNull();
      expect(loi!.message).toContain("zz_s85.t: bảng có cột org_id ngoài public, không treo dưới bảng tenant nào và không bật RLS — chưa khai (khoản 85)");
      await db.pool.query("ALTER TABLE zz_s85.t ENABLE ROW LEVEL SECURITY");
      const loiRls = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loiRls).not.toBeNull();
      expect(loiRls!.message, "bật RLS: mục 85 im").not.toContain("(khoản 85)");
      expect(loiRls!.message, "bật RLS: 83⑶ đòi khai").toContain("zz_s85.t: bảng bật RLS ngoài tập tenant chưa khai (khoản 83⑶)");
    } finally {
      await db.pool.query("DROP SCHEMA IF EXISTS zz_s85 CASCADE");
    }
    expect(await loiCua(migrate(db.pool, MIGRATIONS_DIR)), "đối chứng: gỡ ⇒ đi qua").toBeNull();
  }, 180000);
});

// ===============================================================================================
// [S1.46 / khoản nợ 86 — nửa gốc] BẢNG ĐA TỔ CHỨC ĐẶT TÊN CỘT KHÁC org_id — ĐÓNG BẰNG ĐƯỜNG TÍNH CHẤT
//
// Vị từ tenant ghim TÊN cột org_id (public); khoản 85 cũng ghim tên ấy (ngoài public). Bảng MỚI `(gia int, to_chuc uuid
// REFERENCES public.organizations(id))` — ở k hay ở public — không thuộc vị từ nào: (A) không bật, [CR1] không soi, 85
// không thấy, 83⑵/83⑶ không thấy; một GRANT mở hàng của mọi tổ chức. S1.43 (ADR-037) chỉ đóng nửa ĐO ĐƯỢC (bảng đã khai
// rời tập); nửa GỐC cần tính chất: khoá ngoại MỘT cột — của chính bảng hay của một tổ tiên INHERITS (lượt soi 38 A2) — tới
// một BẢNG TENANT theo tính chất (không chỉ gốc: `nguoi uuid REFERENCES users(id)` buộc hàng vào tổ chức gián tiếp, lượt soi
// 38 A1 — bản đầu chỉ nhận gốc và gọi users là "bảng thường") trên bảng KHÔNG có cột org_id, không RLS, ngoài tập tenant ⇒
// CAU_KHOA_NGOAI_TENANT_SAI + BANG_KHOA_NGOAI_TENANT_KHAI (rỗng). Ba mục 85 / 86 / 83⑶ rời nhau theo (có org_id, có khoá ngoại
// tới bảng tenant, relrowsecurity). Ranh giới nói ra: cột uuid TRẦN (không khoá ngoại), khoá ngoại nhiều cột, và khoá ngoại tới
// một bảng đã khai ở 85/86 (bậc kế trên đồ thị khoá ngoại) không tính — không tính chất catalog nào nhận diện (33a #13 cùng lớp).
// ===============================================================================================

/** [S1.46] `schema.bảng` không org_id, có khoá ngoại tới bảng tenant, không RLS — RỖNG là lời khai; bản hardening: BANG_KHOA_NGOAI_TENANT_KHAI. */
const BANG_KHOA_NGOAI_TENANT_DA_KHAI: readonly string[] = [];

describe("[S1.46 / khoản nợ 86 — nửa gốc] bảng không org_id có khoá ngoại tới bảng tenant", () => {
  const ten = async (c: pg.PoolClient | pg.Pool, q: string): Promise<string[]> =>
    (await c.query<{ mo_ta: string }>(q)).rows.map((r) => r.mo_ta.split(":")[0]!).sort();

  it("[INV-F1] HAI BẢN KHỚP, đích khoá ngoại là vị từ tenant (một hằng, khai triển gn/g); câu phán xét chạy trong test: rỗng hôm nay; fixture — khoá ngoại tới organizations LẪN tới users bị thấy ở k LẪN public, con INHERITS thừa cột không thừa khoá ngoại vẫn bị thấy, có org_id sang 85, bật RLS sang 83⑶, uuid trần thì không; đổi tên cột thành org_id là cửa ra; chiều ngược bắt dòng khai thiu", async () => {
    expect(docHangHardening("BANG_KHOA_NGOAI_TENANT_KHAI")).toBe(
      khoiValues(BANG_KHOA_NGOAI_TENANT_DA_KHAI.map((t) => t.split(".") as [string, string]), "kt", ["nspname", "relname"]),
    );
    const cau = docHangHardening("CAU_KHOA_NGOAI_TENANT_SAI");
    const cau85 = docHangHardening("CAU_ORG_ID_NGOAI_PUBLIC_SAI");
    const ngoai = docHangHardening("CAU_RLS_NGOAI_TENANT_SAI");
    expect(cau.length).toBeGreaterThan(400);
    // Hình dạng 86 là MỘT hằng, hai chiều cùng tham chiếu (bài học lượt 30 NHẸ-2 / 32 NHẸ-3).
    expect(HARDENING_SQL).toMatch(/\n  CAU_KHOA_NGOAI_TENANT_SAI constant text :=[\s\S]*?VI_TU_HINH_DANG_86[\s\S]*?VI_TU_HINH_DANG_86[\s\S]*?\$q\$;/u);
    const hinhDang = docHangHardening("VI_TU_HINH_DANG_86");
    expect(cau.split(hinhDang).length - 1, "hai chiều cùng một hình dạng").toBe(2);
    // Vế "có cột org_id" phủ định — cùng hằng với vị từ tenant và với 85: ba mục rời nhau nhờ cùng một văn bản.
    const coOrgId = docHangHardening("MAU_VI_TU_CO_ORG_ID").replaceAll("%1$s", "c");
    expect(hinhDang).toContain(`NOT ${coOrgId}`);
    expect(docHangHardening("VI_TU_HINH_DANG_85")).toContain(coOrgId);
    // Đích khoá ngoại = vị từ BẢNG TENANT (public, có org_id hay là gốc) khai triển với bí danh gn/g — cùng hằng với
    // VI_TU_BANG_TENANT (n/c): nới định nghĩa "bảng tenant" thì đích của mục này đi theo.
    const mauTenant = docHangHardening("MAU_VI_TU_BANG_TENANT");
    expect(docHangHardening("VI_TU_BANG_TENANT")).toBe(mauTenant.replaceAll("%1$s", "n").replaceAll("%2$s", "c"));
    const toiTenant = docHangHardening("CAU_KHOA_NGOAI_TOI_TENANT");
    expect(toiTenant).toContain(mauTenant.replaceAll("%1$s", "gn").replaceAll("%2$s", "g"));
    expect(toiTenant, "xét cả khoá ngoại của tổ tiên INHERITS").toContain("WITH RECURSIVE to_tien(con, cha)");
    expect(hinhDang).toContain(`EXISTS (${toiTenant})`);
    expect(cau.split(toiTenant).length - 1, "câu tới bảng tenant dùng ở cả hai chiều (vị từ) và ở mô tả").toBe(3);
    expect(await ten(db.pool, cau), "lược đồ thật không có bảng khoá ngoại tới bảng tenant mà thiếu org_id").toEqual([]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`
        CREATE SCHEMA zz_s;
        CREATE TABLE zz_s.t (gia int, to_chuc uuid NOT NULL REFERENCES public.organizations(id));
        CREATE TABLE public.zz_t86 (gia int, to_chuc uuid REFERENCES public.organizations(id));
        CREATE TABLE zz_s.t_org (gia int, org_id uuid NOT NULL, to_chuc uuid REFERENCES public.organizations(id));
        CREATE TABLE zz_s.t_rls (gia int, to_chuc uuid REFERENCES public.organizations(id));
        ALTER TABLE zz_s.t_rls ENABLE ROW LEVEL SECURITY;
        CREATE TABLE zz_s.t_users (gia int, nguoi uuid REFERENCES public.users(id));
        CREATE TABLE zz_s.t_tran (gia int, to_chuc uuid NOT NULL);
        CREATE TABLE zz_s.t2 (gia int, to_chuc uuid, CONSTRAINT t2_goc FOREIGN KEY (to_chuc) REFERENCES public.organizations(id));
        CREATE TABLE zz_s.con86 (them int) INHERITS (zz_s.t2);
        CREATE TABLE zz_s.t_hop (gia int, to_chuc uuid, nguoi uuid, FOREIGN KEY (to_chuc, nguoi) REFERENCES public.users (org_id, id));
      `);
      // Ở public LẪN ngoài public — vị từ tenant không nhận nên cả hai đều là việc của mục này. Khoá ngoại tới users (bảng
      // tenant, không phải gốc) cùng lớp (38 A1). con86 thừa cột to_chuc mà không thừa khoá ngoại (38 A2) — thấy qua tổ tiên.
      // [S1.48 / lượt soi ngang 40a H2] khoá ngoại HỢP THÀNH (to_chuc, nguoi) → users (org_id, id) — đúng quy ước khoá ngoại của
      // kho — cũng buộc hàng vào tổ chức; bản S1.46 miễn nhiều cột và gọi là ranh giới: sai.
      expect(await ten(c, cau), "bảng không org_id có khoá ngoại tới bảng tenant, không RLS").toEqual([
        "public.zz_t86", "zz_s.con86", "zz_s.t", "zz_s.t2", "zz_s.t_hop", "zz_s.t_users",
      ]);
      const moTa = (await c.query<{ mo_ta: string }>(cau)).rows.map((r) => r.mo_ta);
      expect(moTa).toEqual(expect.arrayContaining([
        expect.stringContaining("zz_s.t: bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua to_chuc -> public.organizations) và không bật RLS — chưa khai (khoản 86)"),
        expect.stringContaining("zz_s.t_users: bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua nguoi -> public.users) và không bật RLS"),
        expect.stringContaining("zz_s.con86: bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua to_chuc -> public.organizations)"),
        expect.stringContaining("zz_s.t_hop: bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua (to_chuc, nguoi) -> public.users)"),
      ]));
      expect(await ten(c, cau85), "có cột org_id ⇒ khoản 85, không phải 86").toEqual(["zz_s.t_org"]);
      expect(await ten(c, ngoai), "bật RLS ⇒ 83⑶").toContain("zz_s.t_rls");
      // Cửa ra hợp lệ: đổi tên cột thành org_id — ngoài public rơi sang 85, ở public thành bảng tenant ([CR1] đòi policy).
      await c.query("ALTER TABLE zz_s.t RENAME COLUMN to_chuc TO org_id; ALTER TABLE public.zz_t86 RENAME COLUMN to_chuc TO org_id");
      expect(await ten(c, cau)).toEqual(["zz_s.con86", "zz_s.t2", "zz_s.t_hop", "zz_s.t_users"]);
      expect(await ten(c, cau85)).toEqual(["zz_s.t", "zz_s.t_org"]);
      const { rows: tenant } = await c.query<{ t: string }>(
        `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${docHangHardening("VI_TU_BANG_TENANT")} AND c.relname = 'zz_t86'`,
      );
      expect(tenant.map((r) => r.t), "public + org_id = bảng tenant theo tính chất").toEqual(["zz_t86"]);
      // Chiều ngược: giả lập một dòng khai (danh sách thật rỗng) — khai zz_s.t2 khi nó đang đúng hình dạng ⇒ hết dòng t2 (con86
      // là đối tượng riêng, vẫn phải khai); gỡ khoá ngoại ⇒ dòng khai thiu, và cả t2 lẫn con86 rơi về cột uuid trần — ranh giới
      // nói ra: không mục nào thấy nữa.
      const khai = cau.replaceAll("(VALUES ('', '')) AS kt(", "(VALUES ('zz_s', 't2')) AS kt(");
      expect(khai.split("'t2'").length - 1, "khối khai phải được thay ở CẢ HAI chiều").toBe(2);
      expect(await ten(c, khai)).toEqual(["zz_s.con86", "zz_s.t_hop", "zz_s.t_users"]);
      await c.query("ALTER TABLE zz_s.t2 DROP CONSTRAINT t2_goc");
      expect((await c.query<{ mo_ta: string }>(khai)).rows.map((r) => r.mo_ta.split(":")[0]!).sort()).toEqual(["khai zz_s.t2 là bảng không org_id có khoá ngoại tới bảng tenant, không RLS (khoản 86) mà CSDL không có bảng như thế — dòng khai thiu (bảng đã có cột org_id, đã bật RLS, hay đã bỏ khoá ngoại)", "zz_s.t_hop", "zz_s.t_users"]);
      expect(await ten(c, cau), "cột uuid trần (t2 và con86): ngoài tầm mọi mục (ranh giới nói ra)").toEqual(["zz_s.t_hop", "zz_s.t_users"]);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[INV-F1] ĐO: bảng không org_id có khoá ngoại tới bảng tenant, ở k và ở public — app_api gắn tổ chức A đọc được hàng của B qua một GRANT (lỗ RÒ), và migrate() NÉM ở mục khoản 86 cho CẢ HAI; bật RLS ⇒ mục im, 83⑶ kêu; DROP ⇒ đi qua", async () => {
    const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
    const { rows: tc } = await db.pool.query<{ id: string }>("SELECT id FROM organizations ORDER BY slug");
    const [orgA, orgB] = [tc[0]!.id, tc[1]!.id];
    expect(orgA).not.toBe(orgB);
    await db.pool.query("DROP SCHEMA IF EXISTS zz_s86 CASCADE; DROP TABLE IF EXISTS public.zz_t86");
    await db.pool.query(
      "CREATE SCHEMA zz_s86; CREATE TABLE zz_s86.t (gia int, to_chuc uuid NOT NULL REFERENCES public.organizations(id)); " +
        "CREATE TABLE public.zz_t86 (gia int, to_chuc uuid NOT NULL REFERENCES public.organizations(id)); " +
        "GRANT USAGE ON SCHEMA zz_s86 TO app_api; GRANT SELECT ON zz_s86.t TO app_api; GRANT SELECT ON public.zz_t86 TO app_api",
    );
    try {
      await db.pool.query("INSERT INTO zz_s86.t VALUES (777, $1)", [orgB]);
      await db.pool.query("INSERT INTO public.zz_t86 VALUES (778, $1)", [orgB]);
      const client = await apiPool.connect();
      try {
        await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
        expect((await client.query<{ gia: number }>("SELECT gia FROM zz_s86.t")).rows.map((r) => r.gia), "lỗ RÒ ngoài public có thật").toEqual([777]);
        expect((await client.query<{ gia: number }>("SELECT gia FROM public.zz_t86")).rows.map((r) => r.gia), "lỗ RÒ ở public có thật").toEqual([778]);
      } finally {
        client.release();
      }
      const loi = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi, "bảng khoá ngoại tới bảng tenant không org_id không RLS phải bị khoản 86 bắt").not.toBeNull();
      expect(loi!.message).toContain("zz_s86.t: bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua to_chuc -> public.organizations) và không bật RLS — chưa khai (khoản 86)");
      expect(loi!.message).toContain("public.zz_t86: bảng không có cột org_id nhưng có khoá ngoại tới bảng tenant (qua to_chuc -> public.organizations) và không bật RLS — chưa khai (khoản 86)");
      expect(loi!.message, "không dòng 85").not.toContain("(khoản 85)");
      await db.pool.query("ALTER TABLE zz_s86.t ENABLE ROW LEVEL SECURITY; DROP TABLE public.zz_t86");
      const loiRls = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loiRls).not.toBeNull();
      expect(loiRls!.message, "bật RLS: mục 86 im").not.toContain("(khoản 86)");
      expect(loiRls!.message, "bật RLS: 83⑶ đòi khai").toContain("zz_s86.t: bảng bật RLS ngoài tập tenant chưa khai (khoản 83⑶)");
    } finally {
      await db.pool.query("DROP SCHEMA IF EXISTS zz_s86 CASCADE; DROP TABLE IF EXISTS public.zz_t86");
    }
    expect(await loiCua(migrate(db.pool, MIGRATIONS_DIR)), "đối chứng: gỡ ⇒ đi qua").toBeNull();
  }, 180000);
});

// ===============================================================================================
// [S1.43 / khoản nợ 89 + 86] DANH TÍNH ĐỐI TƯỢNG CANH — bản khai tên bảng tenant phải bằng tập theo tính chất
// ===============================================================================================
describe("[S1.43 / khoản nợ 89 + 86] danh tính đối tượng canh", () => {
  it("[INV-F1] HAI BẢN KHỚP: BANG_TENANT_KHAI của hardening bằng tập VI_TU_BANG_TENANT trên lược đồ thật, mỗi dòng trỏ đúng migration đã CREATE TABLE bảng ấy; câu phán xét chạy trong test — rỗng hôm nay, thấy đúng bảng đổi tên cột", async () => {
    const khai = docHangHardening("BANG_TENANT_KHAI");
    const dong = [...khai.matchAll(/\('(\w+)', '(\w+)', '(\d{3}_\w+)'\)/gu)].map((m) => ({ nsp: m[1]!, ten: m[2]!, mig: m[3]! }));
    expect(dong.length, "bản khai đang rỗng — bộ đọc mù").toBeGreaterThan(20);
    const { rows } = await db.pool.query<{ t: string }>(
      `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${docHangHardening("VI_TU_BANG_TENANT")} ORDER BY 1`,
    );
    expect(dong.map((d) => `${d.nsp}.${d.ten}`).sort(), "bảng tenant theo tính chất phải được khai đủ, và không khai thừa").toEqual(rows.map((r) => r.t).sort());
    const tep = readdirSync(MIGRATIONS_DIR);
    for (const d of dong) {
      const f = tep.find((x) => x === `${d.mig}.sql`);
      expect(f, `${d.ten}: tệp migration ${d.mig}.sql phải tồn tại — khai theo TÊN TỆP, không theo tiền tố`).toBeDefined();
      expect(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"), `${d.ten}: migration ${d.mig} phải là nơi CREATE TABLE`).toMatch(
        new RegExp(`^CREATE TABLE (public\\.)?${d.ten}\\b`, "mu"),
      );
    }
    const cau = docHangHardening("CAU_NEO_SAI");
    expect((await db.pool.query<{ mo_ta: string }>(cau)).rows, "lược đồ thật: không dòng nào").toEqual([]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE public.mfa_credentials RENAME COLUMN org_id TO to_chuc");
      const thay = (await c.query<{ mo_ta: string }>(cau)).rows.map((r) => r.mo_ta.split(":")[0]).sort();
      expect(thay, "đổi tên cột org_id: vế ⑵ (chú thích: hết là tenant) và ⑹ (tên đã khai) cùng thấy; ⑵′ chỉ có nghĩa khi còn là tenant").toEqual(["public.mfa_credentials", "public.mfa_credentials"]);
      // [lượt soi 35, NẶNG-5] thêm cột org_id MỚI: bảng lại là tenant theo tính chất (⑵/⑹ im) — chỉ attnum đã neo còn thấy.
      await c.query("ALTER TABLE public.mfa_credentials ADD COLUMN org_id uuid");
      const thayCot = (await c.query<{ mo_ta: string }>(cau)).rows.map((r) => r.mo_ta);
      expect(thayCot).toHaveLength(1);
      expect(thayCot[0]).toMatch(/^public\.mfa_credentials: cột org_id đã neo là attnum \d+ nhưng cột org_id hiện tại là attnum \d+/u);
      // [S1.48 / lượt soi ngang 40a I6] bản sao PHÂN MẢNH của sổ (relkind 'p') mang bộ ba cột chuỗi: ⑷ thấy cha (bản S1.43 chỉ 'r').
      await c.query("CREATE SCHEMA zz_s; CREATE TABLE zz_s.so_pm (seq bigint, prev_hash bytea, hash bytea, k int) PARTITION BY RANGE (seq)");
      const thayPm = (await c.query<{ mo_ta: string }>(cau)).rows.map((r) => r.mo_ta);
      expect(thayPm.some((m) => m.startsWith("zz_s.so_pm: mang bộ ba cột chuỗi sổ")), `⑷ phải thấy bản sao phân mảnh; đã thấy: ${JSON.stringify(thayPm)}`).toBe(true);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[S1.48 / lượt soi ngang 40b #2] số policy `_khach` đếm từ CATALOG, không từ lời khai: RESTRICTIVE = MỘT cho MỖI bảng tenant theo tính chất (khuôn 027 — hardening dựng, không phải chỉ các CREATE POLICY trong migration: 21/11/10 đều là con số thiu) + 1 PERMISSIVE (042 caller_rate_limits)", async () => {
    const viTuTenant = docHangHardening("VI_TU_BANG_TENANT");
    const { rows } = await db.pool.query<{ restrictive: number; permissive: number; tenant: number }>(
      "SELECT count(*) FILTER (WHERE NOT polpermissive)::int AS restrictive, count(*) FILTER (WHERE polpermissive)::int AS permissive, " +
        `       (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${viTuTenant}) AS tenant ` +
        "  FROM pg_policy WHERE polname LIKE '%\\_khach'",
    );
    expect(rows[0]!.permissive).toBe(1);
    expect(rows[0]!.restrictive, "một policy RESTRICTIVE _khach cho mỗi bảng tenant").toBe(rows[0]!.tenant);
    expect(rows[0]!.tenant).toBeGreaterThanOrEqual(29);
  });
});

// ===============================================================================================
// [S1.50 / khoản nợ 91] CỬA RA "BẬT RLS ⇒ KHAI 83⑶" KHÔNG CÒN LÀ CỬA YẾU
//
// Thông điệp của 85 và 86 chỉ người sửa vào cửa ra "bật RLS rồi khai ở 83⑶". Lượt soi 38 A3 đọc ra hai chỗ
// hở của cửa ấy: ⑴ `ENABLE` không áp cho CHỦ BẢNG, và mục (A) chỉ FORCE tập tenant, nên bảng đi cửa ra đọc
// /ghi được trọn bởi chính chủ nó; ⑵ mục (C) chỉ soi view/matview đọc BẢNG TENANT, nên một VIEW không
// `security_invoker` trên bảng đã khai là vô hình — và view chạy dưới quyền CHỦ VIEW, thường là chủ bảng.
// Hai chỗ ấy gặp nhau thành một đường đọc xuyên tổ chức cho vai ứng dụng. Nay: (C) nhận đích là MỌI bảng
// bật RLS trong lược đồ dự án, và một mục TỰ CHỮA bật FORCE trên bảng đã khai (FORCE là đơn điệu).
// ===============================================================================================
describe("[S1.50 / khoản nợ 91] cửa ra 83⑶: FORCE và view không security_invoker", () => {
  // [lượt soi 42 CAO-2] Chủ bảng và chủ view phải là một vai KHÔNG superuser: superuser (và BYPASSRLS) bỏ
  // qua RLS ở MỌI cấu hình, nên một fixture thuộc `postgres` không phân biệt được ENABLE với FORCE — bản đầu
  // của vòng đo dưới superuser và quy sai nguyên nhân của lỗ rò. Hồ sơ thật của dự án là chủ bảng THƯỜNG
  // (vai deploy `trien_khai`), nên fixture phải giống nó.
  const CHU = "zz_chu91";
  const orgA = "00000000-0000-4000-8000-000000000091";
  const orgB = "00000000-0000-4000-8000-000000000092";

  const dungFixture = async (): Promise<void> => {
    await db.pool.query(`DROP SCHEMA IF EXISTS zz_s91 CASCADE; DROP ROLE IF EXISTS ${CHU}`);
    await db.pool.query(`CREATE ROLE ${CHU} NOSUPERUSER NOBYPASSRLS`);
    await db.pool.query(`CREATE SCHEMA zz_s91 AUTHORIZATION ${CHU}`);
    await db.pool.query(
      `SET ROLE ${CHU}; ` +
        "CREATE TABLE zz_s91.t (gia int, to_chuc uuid NOT NULL); " +
        "ALTER TABLE zz_s91.t ENABLE ROW LEVEL SECURITY; " +
        "CREATE POLICY p ON zz_s91.t USING (to_chuc = public.app_current_org_id()); " +
        "CREATE VIEW zz_s91.v AS SELECT * FROM zz_s91.t; " +
        "GRANT USAGE ON SCHEMA zz_s91 TO app_api; " +
        // GRANT cả trên BẢNG: lỗ rò dưới đây không phải chuyện "mượn quyền chủ view" mà đúng chuyện BỎ QUA RLS.
        "GRANT SELECT ON zz_s91.v, zz_s91.t TO app_api; RESET ROLE",
    );
    await db.pool.query("INSERT INTO zz_s91.t VALUES (777, $1), (888, $2)", [orgA, orgB]);
  };
  const doQuaView = async (bang: string): Promise<number[]> => {
    const c = await db.poolAs("app_api").connect();
    try {
      await c.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
      return (await c.query<{ gia: number }>(`SELECT gia FROM ${bang} ORDER BY gia`)).rows.map((r) => r.gia);
    } finally {
      c.release(true);
    }
  };

  it("[INV-F1] ĐO: bảng RLS của một chủ KHÔNG superuser chỉ ENABLE — app_api đọc thấy hàng của MỌI tổ chức qua view non-invoker (lỗ RÒ); hardening TỰ BẬT FORCE ở lượt SỬA ⇒ cùng view chỉ còn trả hàng của tổ chức đang gắn", async () => {
    await dungFixture();
    try {
      expect(await doQuaView("zz_s91.v"), "lỗ RÒ có thật: ENABLE không áp cho chủ bảng, view chạy dưới quyền chủ").toEqual([777, 888]);
      expect(await doQuaView("zz_s91.t"), "đọc THẲNG bảng thì RLS áp — lỗ nằm ở đường view, không ở quyền").toEqual([777]);
      // migrate() NÉM ở 83⑶ (bảng RLS ngoài tenant chưa khai) — nhưng lượt SỬA đã COMMIT trước đó và FORCE đã bật.
      await migrate(db.pool, MIGRATIONS_DIR).catch(() => undefined);
      const { rows } = await db.pool.query<{ f: boolean }>(
        "SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'zz_s91.t'::regclass",
      );
      expect(rows[0]!.f, "lượt SỬA phải FORCE bảng RLS ngoài tenant — kể cả khi 83⑶ còn đang chặn").toBe(true);
      expect(await doQuaView("zz_s91.v"), "sau FORCE: chủ bảng cũng chịu RLS ⇒ view non-invoker hết rò").toEqual([777]);
    } finally {
      await db.pool.query(`DROP SCHEMA IF EXISTS zz_s91 CASCADE; DROP ROLE IF EXISTS ${CHU}`);
    }
  }, 180000);

  it("[INV-F1] ĐO: mục (C) thấy MỌI view/matview của lược đồ dự án — kể cả CHUỖI VIEW LỒNG và VIEW ĐỌC QUA HÀM mà vế đích cũ bỏ sót; migrate() NÉM nêu đúng tên; security_invoker ⇒ im", async () => {
    const cauC = docHangHardening("CAU_DOC_VONG");
    const ten = async (): Promise<string[]> =>
      (await db.pool.query<{ mo_ta: string }>(cauC)).rows.map((r) => r.mo_ta.split(":")[0]!).sort();
    const loiCua = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);
    expect(await ten(), "lược đồ thật không có view/matview nào").toEqual([]);
    await dungFixture();
    try {
      await db.pool.query(
        `SET ROLE ${CHU}; ` +
          // ⑴ chuỗi view lồng: v1 ĐÃ invoker, v2 thì không — vế đích cũ nhìn thấy đích của v2 là một VIEW nên im.
          "CREATE VIEW zz_s91.v1 WITH (security_invoker = true) AS SELECT * FROM zz_s91.t; " +
          "CREATE VIEW zz_s91.v2 AS SELECT * FROM zz_s91.v1; " +
          // ⑵ view đọc qua HÀM: rule phụ thuộc pg_proc, không phụ thuộc bảng; view không chiếu org_id.
          "CREATE FUNCTION zz_s91.f() RETURNS SETOF zz_s91.t LANGUAGE sql AS 'SELECT * FROM zz_s91.t'; " +
          "CREATE VIEW zz_s91.v3 AS SELECT gia FROM zz_s91.f(); " +
          "CREATE MATERIALIZED VIEW zz_s91.mv AS SELECT * FROM zz_s91.t; RESET ROLE",
      );
      expect(await ten(), "(C) phải thấy cả bốn — v1 đã invoker nên được tha").toEqual([
        "zz_s91.mv", "zz_s91.v", "zz_s91.v2", "zz_s91.v3",
      ]);
      // Lớp SẢN XUẤT: migrate() NÉM và nêu nguyên văn thông điệp (chuẩn của tệp này, lượt soi 42 NHẸ-4).
      const loi = await loiCua(migrate(db.pool, MIGRATIONS_DIR));
      expect(loi).not.toBeNull();
      expect(loi!.message).toContain("zz_s91.v3: VIEW trong lược đồ dự án mà thiếu \"WITH (security_invoker = true)\"");
      expect(loi!.message).toContain("zz_s91.mv: MATERIALIZED VIEW trong lược đồ dự án");
      // Cửa ra: đặt cờ ⇒ mục im. `yes` là boolean hợp lệ của PostgreSQL và phải được nhận (lượt soi 42 NHẸ-3).
      await db.pool.query(
        `SET ROLE ${CHU}; ALTER VIEW zz_s91.v SET (security_invoker = yes); ` +
          "ALTER VIEW zz_s91.v2 SET (security_invoker = true); " +
          "ALTER VIEW zz_s91.v3 SET (security_invoker = true); DROP MATERIALIZED VIEW zz_s91.mv; RESET ROLE",
      );
      expect(await ten(), "cờ đặt rồi thì mục im — kể cả khi viết `= yes`").toEqual([]);
    } finally {
      await db.pool.query(`DROP SCHEMA IF EXISTS zz_s91 CASCADE; DROP ROLE IF EXISTS ${CHU}`);
    }
  }, 180000);
});

// ===============================================================================================
// [S1.53 / khoản nợ 94] 83⑵ CHO CHỦ BẢNG — SAU FORCE, CHỦ BẢNG ĐỌC/GHI 0 HÀNG KHÔNG LỖI
//
// Khoản 91 FORCE mọi bảng bật RLS của lược đồ dự án, nên CHỦ BẢNG chịu RLS như mọi vai; 83⑵ chỉ soi tập vai ứng dụng.
// ĐO trước khi viết (thăm dò S1.53, PostgreSQL 16): chủ KHÔNG superuser, bảng FORCE, policy duy nhất `TO app_api` ⇒
// SELECT ra 0 dù bảng có 2 hàng, UPDATE và DELETE báo 0 hàng không lỗi, INSERT ném 42501; policy cấp cho một NHÓM mà chủ
// là thành viên thì phủ. Lược đồ thật: cả 30 bảng RLS có policy PERMISSIVE `TO PUBLIC` ở mọi lệnh ⇒ mục không chặn gì.
// ===============================================================================================
describe("[S1.53 / khoản nợ 94] chủ bảng sau FORCE: mọi lệnh phải có policy PERMISSIVE phủ chủ bảng", () => {
  // Chủ bảng KHÔNG superuser — cùng bài học lượt soi 42 CAO-2: superuser/BYPASSRLS bỏ qua RLS ở mọi cấu hình.
  const CHU = "zz_chu94";
  const NHOM = "zz_nhom94";
  const donDep = async (): Promise<void> => {
    await db.pool.query(
      `DROP SCHEMA IF EXISTS zz_s94 CASCADE; DROP ROLE IF EXISTS ${CHU}; DROP ROLE IF EXISTS ${NHOM}; DROP ROLE IF EXISTS zz_su94`,
    );
  };
  const dungFixture = async (): Promise<void> => {
    await donDep();
    await db.pool.query(`CREATE ROLE ${CHU} NOSUPERUSER NOBYPASSRLS; CREATE ROLE ${NHOM} NOLOGIN`);
    await db.pool.query(`CREATE SCHEMA zz_s94 AUTHORIZATION ${CHU}`);
    await db.pool.query(
      `SET ROLE ${CHU}; ` +
        "CREATE TABLE zz_s94.t (id int); INSERT INTO zz_s94.t VALUES (1), (2); " +
        "ALTER TABLE zz_s94.t ENABLE ROW LEVEL SECURITY; " +
        "CREATE POLICY p_api ON zz_s94.t TO app_api USING (true) WITH CHECK (true); RESET ROLE",
    );
  };
  const nhan = async (): Promise<string[]> =>
    (await db.pool.query<{ mo_ta: string }>(docHangHardening("CAU_PHU_LENH_CHU_BANG_SAI"))).rows
      .map((r) => r.mo_ta.split(":")[0]!)
      .sort();
  const duoiChu = async <T extends pg.QueryResultRow>(sql: string): Promise<pg.QueryResult<T>> => {
    const c = await db.pool.connect();
    try {
      await c.query(`SET ROLE ${CHU}`);
      return await c.query<T>(sql);
    } finally {
      await c.query("RESET ROLE");
      c.release();
    }
  };
  const BON_LENH = [
    "zz_s94.t/zz_chu94 (chủ bảng)/DELETE",
    "zz_s94.t/zz_chu94 (chủ bảng)/INSERT",
    "zz_s94.t/zz_chu94 (chủ bảng)/SELECT",
    "zz_s94.t/zz_chu94 (chủ bảng)/UPDATE",
  ];

  it("[INV-F1] ĐO: chủ bảng KHÔNG superuser, bảng FORCE, policy chỉ TO app_api ⇒ SELECT/UPDATE/DELETE 0 hàng không lỗi, INSERT ném; mục 94 nêu đủ bốn lệnh và migrate() NÉM nêu nó", async () => {
    // [lượt soi 46 NHẸ-4a] Trên cụm test mọi bảng thật thuộc `postgres` (superuser), nên `nhan()` rỗng ở đây là RỖNG RUỘT —
    // mục loại chủ superuser. Khẳng định chịu lực là census KHÔNG phụ thuộc chủ bảng ngay dưới: mọi bảng RLS của lược đồ thật
    // có policy PERMISSIVE `TO PUBLIC` ở cả bốn lệnh, nên chủ bảng nào cũng được phủ — kể cả vai deploy thường của hồ sơ N3
    // (test N3 ở migrations.int.test.ts: `trien_khai` sở hữu cả lược đồ và migrate() đi qua).
    const { rows: thieuPublic } = await db.pool.query<{ thieu: string }>(
      "SELECT n.nspname || '.' || c.relname || '/' || g.lenh AS thieu FROM pg_class c " +
        "JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN (VALUES ('r'), ('a'), ('w'), ('d')) g(lenh) " +
        "WHERE c.relrowsecurity AND c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
        "AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname NOT LIKE 'zz%' " +
        "AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive " +
        "AND p.polcmd::text IN (g.lenh, '*') AND p.polroles = '{0}')",
    );
    expect(thieuPublic.map((r) => r.thieu), "census: mọi bảng RLS thật có policy PERMISSIVE TO PUBLIC ở cả bốn lệnh").toEqual([]);
    expect(await nhan(), "và mục im trên lược đồ thật").toEqual([]);
    await dungFixture();
    try {
      // Lượt SỬA của khoản 91 bật FORCE; migrate() vẫn NÉM — ở 83⑶ (bảng ngoài tenant chưa khai) VÀ ở mục 94.
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      const { rows } = await db.pool.query<{ f: boolean }>(
        "SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'zz_s94.t'::regclass",
      );
      expect(rows[0]!.f, "phép đo không rỗng ruột: lượt SỬA phải FORCE bảng").toBe(true);
      expect(
        (await duoiChu<{ n: number }>("SELECT count(*)::int AS n FROM zz_s94.t")).rows[0]!.n,
        "chủ bảng đọc 0 hàng dù bảng có 2 — không lỗi",
      ).toBe(0);
      expect((await duoiChu("UPDATE zz_s94.t SET id = id")).rowCount, "UPDATE 0 hàng không lỗi").toBe(0);
      expect((await duoiChu("DELETE FROM zz_s94.t WHERE id > 0")).rowCount, "DELETE 0 hàng không lỗi").toBe(0);
      const maInsert = await duoiChu("INSERT INTO zz_s94.t VALUES (3)").then(
        () => null,
        (e: { code?: string }) => e.code,
      );
      expect(maInsert, "INSERT thì ném").toBe("42501");
      expect(await nhan(), "mục 94 nêu đủ bốn lệnh").toEqual(BON_LENH);
      expect(loi, "migrate() phải NÉM").not.toBeNull();
      expect(loi!.message, "lớp sản xuất nêu nguyên văn").toContain("zz_s94.t/zz_chu94 (chủ bảng)/SELECT");
    } finally {
      await donDep();
    }
  }, 180000);

  it("[INV-F1] ĐO: policy cho NHÓM mà chủ là thành viên thì phủ ĐÚNG lệnh ấy (has_privs_of_role); policy TO PUBLIC phủ hết; chủ superuser đứng ngoài", async () => {
    await dungFixture();
    try {
      await migrate(db.pool, MIGRATIONS_DIR).catch(() => undefined);
      expect(await nhan(), "phép đo không rỗng ruột: đủ bốn lệnh trước khi phủ").toEqual(BON_LENH);
      await db.pool.query(`GRANT ${NHOM} TO ${CHU}`);
      await db.pool.query(`SET ROLE ${CHU}; CREATE POLICY p_nhom ON zz_s94.t FOR SELECT TO ${NHOM} USING (true); RESET ROLE`);
      expect(await nhan(), "SELECT được phủ QUA NHÓM; ba lệnh còn lại vẫn nêu").toEqual(
        BON_LENH.filter((d) => !d.endsWith("/SELECT")),
      );
      expect(
        (await duoiChu<{ n: number }>("SELECT count(*)::int AS n FROM zz_s94.t")).rows[0]!.n,
        "và RLS đồng ý: chủ đọc thấy 2 hàng qua nhóm",
      ).toBe(2);
      await db.pool.query(`SET ROLE ${CHU}; CREATE POLICY p_all ON zz_s94.t USING (true) WITH CHECK (true); RESET ROLE`);
      expect(await nhan(), "policy TO PUBLIC phủ mọi lệnh").toEqual([]);
      await db.pool.query(
        `SET ROLE ${CHU}; DROP POLICY p_all ON zz_s94.t; DROP POLICY p_nhom ON zz_s94.t; DROP POLICY p_api ON zz_s94.t; RESET ROLE`,
      );
      expect(await nhan(), "gỡ hết policy ⇒ lại đủ bốn").toEqual(BON_LENH);
      // [lượt soi 46 NHẸ-4b] Gỡ CẢ p_api trước khi đổi chủ: với chủ superuser, pg_has_role(chủ, app_api) luôn đúng nên p_api
      // đã "phủ" bốn lệnh và vế loại superuser không còn gì để chịu lực — bản đầu rỗng ruột đúng ở vế nó mang tên.
      // Và chủ mới phải là SUPERUSER **NOBYPASSRLS**: vai bootstrap mang CẢ BYPASSRLS, nên đổi chủ sang nó thì vế BYPASSRLS che
      // mất vế superuser — lượt đột biến đầu của bản hai cho thấy bỏ vế superuser vẫn XANH (bắt ở lượt đột biến, không ở lượt soi).
      expect(
        (await db.pool.query<{ bp: boolean }>("SELECT rolbypassrls AS bp FROM pg_roles WHERE rolname = current_user")).rows[0]!.bp,
        "vì sao phải dựng vai riêng: vai bootstrap mang cả BYPASSRLS",
      ).toBe(true);
      await db.pool.query("DROP ROLE IF EXISTS zz_su94; CREATE ROLE zz_su94 SUPERUSER NOBYPASSRLS");
      expect(
        (await db.pool.query<{ su: boolean; bp: boolean }>("SELECT rolsuper AS su, rolbypassrls AS bp FROM pg_roles WHERE rolname = 'zz_su94'")).rows[0],
        "phép đo không rỗng ruột: superuser KHÔNG BYPASSRLS",
      ).toEqual({ su: true, bp: false });
      await db.pool.query("ALTER TABLE zz_s94.t OWNER TO zz_su94");
      expect(await nhan(), "chủ superuser bỏ qua RLS ở mọi cấu hình — không có 0 hàng nào để báo").toEqual([]);
    } finally {
      await donDep();
    }
  }, 180000);

  it("[INV-F1] ĐO: các vế lọc chịu lực — RESTRICTIVE không tính là phủ; chủ BYPASSRLS, bảng NO FORCE, bảng tắt RLS (cờ FORCE còn), bảng thuộc extension đứng ngoài", async () => {
    await dungFixture();
    await db.pool.query("ALTER TABLE zz_s94.t FORCE ROW LEVEL SECURITY");
    try {
      expect(await nhan(), "phép đo không rỗng ruột: đủ bốn lệnh").toEqual(BON_LENH);
      // [lượt soi 46 NHẸ-4c] RESTRICTIVE một mình không trao hàng nào — PostgreSQL chỉ lấy hàng khi có một PERMISSIVE đi qua.
      await db.pool.query(`SET ROLE ${CHU}; CREATE POLICY r_all ON zz_s94.t AS RESTRICTIVE USING (true) WITH CHECK (true); RESET ROLE`);
      expect(await nhan(), "RESTRICTIVE TO PUBLIC không phủ").toEqual(BON_LENH);
      expect(
        (await duoiChu<{ n: number }>("SELECT count(*)::int AS n FROM zz_s94.t")).rows[0]!.n,
        "và RLS đồng ý: vẫn 0 hàng",
      ).toBe(0);
      await db.pool.query(`SET ROLE ${CHU}; DROP POLICY r_all ON zz_s94.t; RESET ROLE`);

      await db.pool.query("DROP ROLE IF EXISTS zz_bp94; CREATE ROLE zz_bp94 NOSUPERUSER BYPASSRLS");
      await db.pool.query("ALTER TABLE zz_s94.t OWNER TO zz_bp94");
      expect(await nhan(), "chủ BYPASSRLS bỏ qua RLS — không có 0 hàng nào để báo").toEqual([]);
      await db.pool.query(`ALTER TABLE zz_s94.t OWNER TO ${CHU}`);
      await db.pool.query("DROP OWNED BY zz_bp94; DROP ROLE zz_bp94");
      expect(await nhan(), "trả chủ ⇒ lại đủ bốn").toEqual(BON_LENH);

      await db.pool.query("ALTER TABLE zz_s94.t NO FORCE ROW LEVEL SECURITY");
      expect(await nhan(), "không FORCE ⇒ chủ bỏ qua RLS").toEqual([]);
      await db.pool.query("ALTER TABLE zz_s94.t FORCE ROW LEVEL SECURITY");

      await db.pool.query("ALTER TABLE zz_s94.t DISABLE ROW LEVEL SECURITY");
      const { rows: co } = await db.pool.query<{ rls: boolean; force: boolean }>(
        "SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE oid = 'zz_s94.t'::regclass",
      );
      expect(co[0], "phép đo không rỗng ruột: tắt RLS mà cờ FORCE vẫn còn").toEqual({ rls: false, force: true });
      expect(await nhan(), "tắt RLS ⇒ không có RLS nào để áp").toEqual([]);
      await db.pool.query("ALTER TABLE zz_s94.t ENABLE ROW LEVEL SECURITY");
      expect(await nhan(), "bật lại ⇒ lại đủ bốn").toEqual(BON_LENH);

      await db.pool.query("ALTER EXTENSION plpgsql ADD TABLE zz_s94.t");
      try {
        expect(await nhan(), "bảng thuộc extension là việc của extension").toEqual([]);
      } finally {
        await db.pool.query("ALTER EXTENSION plpgsql DROP TABLE zz_s94.t");
      }
      expect(await nhan(), "gỡ khỏi extension ⇒ lại đủ bốn").toEqual(BON_LENH);
    } finally {
      await donDep();
    }
  }, 180000);

  it("[INV-F1] ĐO: bảng CON của cha bật RLS đi qua cha nên đứng ngoài (qua cha ra hàng, thẳng lá ra 0 — ranh giới nói ra); lệnh chủ bảng đã tự REVOKE thì không bị đòi (ném 42501, ồn)", async () => {
    await dungFixture();
    try {
      await db.pool.query(
        `SET ROLE ${CHU}; ` +
          "CREATE TABLE zz_s94.p (id int, k int) PARTITION BY LIST (k); " +
          "CREATE TABLE zz_s94.p_a PARTITION OF zz_s94.p FOR VALUES IN (1); " +
          "INSERT INTO zz_s94.p VALUES (1, 1), (2, 1); " +
          "ALTER TABLE zz_s94.p ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_s94.p FORCE ROW LEVEL SECURITY; " +
          "ALTER TABLE zz_s94.p_a ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_s94.p_a FORCE ROW LEVEL SECURITY; " +
          "CREATE POLICY p_all ON zz_s94.p USING (true) WITH CHECK (true); RESET ROLE",
      );
      const cuaP = async (): Promise<string[]> => (await nhan()).filter((d) => d.startsWith("zz_s94.p"));
      expect(await cuaP(), "[lượt soi 46 NẶNG-1] cha có policy TO PUBLIC, lá đi qua cha ⇒ không nêu").toEqual([]);
      expect(
        (await duoiChu<{ n: number }>("SELECT count(*)::int AS n FROM zz_s94.p")).rows[0]!.n,
        "chủ đọc QUA CHA ra 2",
      ).toBe(2);
      expect(
        (await duoiChu<{ n: number }>("SELECT count(*)::int AS n FROM zz_s94.p_a")).rows[0]!.n,
        "ranh giới nói ra: đọc THẲNG lá ra 0",
      ).toBe(0);
      await db.pool.query("ALTER TABLE zz_s94.p DETACH PARTITION zz_s94.p_a");
      expect(await cuaP(), "tách lá thành bảng đứng riêng ⇒ vế loại bảng con là vế chịu lực").toEqual([
        "zz_s94.p_a/zz_chu94 (chủ bảng)/DELETE",
        "zz_s94.p_a/zz_chu94 (chủ bảng)/INSERT",
        "zz_s94.p_a/zz_chu94 (chủ bảng)/SELECT",
        "zz_s94.p_a/zz_chu94 (chủ bảng)/UPDATE",
      ]);

      await db.pool.query(
        `SET ROLE ${CHU}; ` +
          "CREATE TABLE zz_s94.s (id int); INSERT INTO zz_s94.s VALUES (1); " +
          "ALTER TABLE zz_s94.s ENABLE ROW LEVEL SECURITY; ALTER TABLE zz_s94.s FORCE ROW LEVEL SECURITY; " +
          "CREATE POLICY s_doc ON zz_s94.s FOR SELECT USING (true); " +
          "CREATE POLICY s_ghi ON zz_s94.s FOR INSERT WITH CHECK (true); " +
          `REVOKE UPDATE, DELETE ON zz_s94.s FROM ${CHU}; RESET ROLE`,
      );
      const cuaS = async (): Promise<string[]> => (await nhan()).filter((d) => d.startsWith("zz_s94.s/"));
      expect(await cuaS(), "[lượt soi 46 NHẸ-2] chủ đã tự REVOKE UPDATE, DELETE ⇒ hai lệnh ấy không bị đòi").toEqual([]);
      const maUpdate = await duoiChu("UPDATE zz_s94.s SET id = id").then(
        () => null,
        (e: { code?: string }) => e.code,
      );
      expect(maUpdate, "và lệnh bị thu hồi thì ném — ồn, không im").toBe("42501");
      await db.pool.query(`GRANT UPDATE ON zz_s94.s TO ${CHU}`);
      expect(await cuaS(), "cấp lại UPDATE mà không policy phủ ⇒ UPDATE bị nêu").toEqual(["zz_s94.s/zz_chu94 (chủ bảng)/UPDATE"]);
    } finally {
      await donDep();
    }
  }, 180000);
});

// ===============================================================================================
// [S1.48 / lượt soi ngang 40a H4] TẬP TÊN GUC MÀ MÃ DỰ ÁN ĐỌC VÀO (nhánh ⒞ khoản 87) — census + regex
// ===============================================================================================
describe("[S1.48 / lượt soi ngang 40a H4] CAU_TEN_GUC_DU_AN_DOC", () => {
  const RX_LITERAL = /current_setting\s*\(\s*'([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)'/giu;

  it("[INV-F1] CENSUS: mọi literal current_setting('x.y' trong db/migrations/*.sql thuộc tập trên lược đồ thật; regex nhận hoa/thường, khoảng trắng, chữ số; BEGIN ATOMIC, DEFAULT cột và CHECK cũng vào tập", async () => {
    const trongTep = new Set<string>();
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^\d{3}_.*\.sql$/u.test(x))) {
      for (const m of readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8").matchAll(RX_LITERAL)) trongTep.add(m[1]!.toLowerCase());
    }
    expect(trongTep.size, "câu quét đang mù").toBeGreaterThanOrEqual(4);
    const cau = docHangHardening("CAU_TEN_GUC_DU_AN_DOC");
    const tapThat = new Set((await db.pool.query<{ ten: string }>(cau)).rows.map((r) => r.ten));
    for (const t of trongTep) expect(tapThat.has(t), `literal ${t} trong migrations không thuộc tập của hardening`).toBe(true);
    expect(tapThat.has("app.org_id")).toBe(true);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`
        CREATE SCHEMA zz_s;
        CREATE FUNCTION zz_s.f_hoa() RETURNS text LANGUAGE sql AS $$ SELECT CURRENT_SETTING ( 'app.rfq_v2', true ) $$;
        CREATE FUNCTION zz_s.f_atomic() RETURNS text BEGIN ATOMIC SELECT current_setting('app.atomic_x', true); END;
        CREATE TABLE zz_s.d (x text DEFAULT current_setting('app.mac_dinh_x', true), y text CHECK (y <> current_setting('app.check_x', true)));
      `);
      const sau = new Set((await c.query<{ ten: string }>(cau)).rows.map((r) => r.ten));
      for (const t of ["app.rfq_v2", "app.atomic_x", "app.mac_dinh_x", "app.check_x"]) expect(sau.has(t), `thiếu ${t}`).toBe(true);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);
});
