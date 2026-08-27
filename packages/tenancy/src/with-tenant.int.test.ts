import { createPool, migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantError, withTenant } from "./with-tenant.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);

  const themToChuc = async (ten: string, slug: string): Promise<string> => {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [ten, slug],
    );
    return rows[0]!.id;
  };
  orgA = await themToChuc("Cong ty A", "cong-ty-a");
  orgB = await themToChuc("Cong ty B", "cong-ty-b");

  await db.pool.query(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3), ($4, $5, $6)",
    [orgA, "a@example.com", "Nguoi A", orgB, "b@example.com", "Nguoi B"],
  );

  apiPool = db.poolAs("app_api");
});

afterAll(async () => {
  await db?.stop();
});

describe("cô lập tổ chức", () => {
  it("[INV-F1] chỉ thấy hàng của tổ chức đang gắn", async () => {
    const emails = await withTenant(apiPool, orgA, async (client) => {
      const { rows } = await client.query<{ email: string }>("SELECT email FROM users");
      return rows.map((r) => r.email);
    });
    expect(emails).toEqual(["a@example.com"]);
  });

  it("[INV-F1] không thấy hàng của tổ chức khác dù truy vấn không có WHERE org_id", async () => {
    const count = await withTenant(apiPool, orgB, async (client) => {
      const { rows } = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM users");
      return rows[0]!.n;
    });
    expect(count).toBe("1");
  });

  it("[INV-F2] biết ID hợp lệ của tổ chức khác vẫn không đọc được", async () => {
    const idNguoiKhac = (
      await db.pool.query<{ id: string }>("SELECT id FROM users WHERE org_id = $1", [orgB])
    ).rows[0]!.id;

    const timThay = await withTenant(apiPool, orgA, async (client) => {
      const { rowCount } = await client.query("SELECT 1 FROM users WHERE id = $1", [idNguoiKhac]);
      return rowCount;
    });
    expect(timThay).toBe(0);
  });

  it("[INV-F1] không ghi được hàng mang org_id của tổ chức khác", async () => {
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
          orgB,
          "gian-lan@example.com",
          "Ke gian",
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  // [INV-F2] Mặt thứ hai của cùng lỗ hổng ghi: UPDATE. Chặn được INSERT mang org_id lạ mà
  // không chặn được "chuyển nhà" một hàng của MÌNH sang tổ chức khác thì kẻ tấn công vẫn tiêm
  // được dữ liệu vào tổ chức khác, chỉ mất thêm một bước. Đây chính là nửa mà một policy
  // thiếu vế kiểm hàng-mới sẽ bỏ sót.
  //
  // [vòng fix 2 — Minor] Nay CÓ HAI lớp chặn độc lập, và test đo RIÊNG từng lớp thay vì gộp:
  //   lớp 1 — QUYỀN CỘT: 002 không cấp `UPDATE (org_id)` cho app_api (bản vá oracle users_pkey
  //           cấp quyền theo cột, và `org_id` cố ý nằm ngoài vế UPDATE). Chặn ngay ở quyền.
  //   lớp 2 — RLS: kể cả khi ai đó cấp lại `UPDATE (org_id)`, policy vẫn chặn.
  // Gộp hai lớp vào một khẳng định "rejects" là cách nhanh nhất để lớp 2 âm thầm chết mà không
  // ai biết: sau bản vá quyền cột, thông báo lỗi đến từ lớp 1 nên một policy hỏng vẫn xanh.
  //
  // [vòng fix 3 — Minor] LỚP 2 KHÔNG ĐO CÁI NÓ TỪNG NÓI LÀ ĐANG ĐO. Bản vòng 2 gắn nhãn
  // "RLS WITH CHECK" và bình luận "vế WITH CHECK của policy đã mất tác dụng". SAI: với policy
  // FOR ALL trên bảng đang FORCE RLS, PostgreSQL kiểm HÀNG MỚI của UPDATE bằng cả policy
  // SELECT, mà policy đó sinh ra từ vế USING. Đã đo trên PostgreSQL 16.15, trong một
  // transaction rồi ROLLBACK:
  //     WITH CHECK đổi thành (true) -> UPDATE org_id sang tổ chức khác VẪN "new row violates
  //                                    row-level security policy"     (chặn bởi USING)
  //     WITH CHECK đổi thành (true) -> INSERT org_id của tổ chức khác THÀNH CÔNG
  //                                                                   (chặn bởi WITH CHECK)
  //     bỏ luôn vế USING            -> UPDATE 1                       (rò thật)
  // Đây là lỗi HỒ SƠ KIỂM TOÁN chứ không phải lỗ hổng — bảo vệ thật vẫn còn. Nhưng nó là LẦN
  // TÁI PHÁT của chính bài học "test xanh vì lý do sai", nằm BÊN TRONG bản vá cho bài học đó.
  // Nay test ĐO từng cơ chế và GỌI ĐÚNG TÊN nó, thay vì đổi fixture sang policy tách lệnh —
  // đã đo là cách ấy KHÔNG làm WITH CHECK load-bearing (policy SELECT vẫn bắt trước).
  it("[INV-F2] không chuyển được hàng của mình sang org_id của tổ chức khác", async () => {
    // Lớp 1 — quyền cột.
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("UPDATE users SET org_id = $1 WHERE email = $2", [
          orgB,
          "a@example.com",
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);

    // Lớp 2 — RLS, đo TÁCH KHỎI lớp 1: cấp tạm `UPDATE (org_id)` trong một transaction rồi
    // ROLLBACK, nên phép đo không để lại quyền nào trên cụm test.
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("GRANT UPDATE (org_id) ON users TO app_api");
      await client.query("SET LOCAL ROLE app_api");
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await expect(
        client.query("UPDATE users SET org_id = $1 WHERE email = $2", [orgB, "a@example.com"]),
        "có quyền cột rồi mà RLS không chặn — chính sách cách ly đã mất tác dụng",
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // Lớp 2, NỬA CÒN LẠI: vế nào của policy đang gánh việc gì. Hai phép đo dưới đây là thứ
    // biến nhãn "WITH CHECK" từ một lời khai thành một con số.
    const client2 = await db.pool.connect();
    try {
      await client2.query("BEGIN");
      await client2.query("GRANT UPDATE (org_id) ON users TO app_api");
      await client2.query("ALTER POLICY users_tenant_isolation ON users WITH CHECK (true)");
      await client2.query("SET LOCAL ROLE app_api");
      await client2.query("SELECT set_config('app.org_id', $1, true)", [orgA]);

      // (i) UPDATE vẫn bị chặn dù WITH CHECK đã vô hiệu -> vế chặn ở đây là USING.
      //     SAVEPOINT vì một câu lệnh lỗi làm hỏng cả transaction, mà (ii) còn phải chạy tiếp.
      await client2.query("SAVEPOINT truoc_update");
      await expect(
        client2.query("UPDATE users SET org_id = $1 WHERE email = $2", [orgB, "a@example.com"]),
        "WITH CHECK vô hiệu mà UPDATE lọt -> USING không còn kiểm hàng mới; đọc lại ghi chú",
      ).rejects.toThrow(/row-level security/i);
      await client2.query("ROLLBACK TO SAVEPOINT truoc_update");

      // (ii) INSERT thì LỌT -> vế WITH CHECK mới là vế load-bearing ở đường ghi mới, và đó
      //      là điều mà test "[INV-F1] không ghi được hàng mang org_id của tổ chức khác" ở
      //      trên thật sự đang đo.
      const chen = await client2.query(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)",
        [orgB, "do-luong@example.com", "Do luong"],
      );
      expect(
        chen.rowCount,
        "WITH CHECK vô hiệu mà INSERT vẫn bị chặn -> nó không load-bearing ở đâu cả, và test " +
          "INSERT ở trên đang xanh vì lý do khác",
      ).toBe(1);
    } finally {
      await client2.query("ROLLBACK");
      client2.release();
    }

    const { rows } = await db.pool.query<{ org_id: string }>(
      "SELECT org_id FROM users WHERE email = 'a@example.com'",
    );
    expect(rows[0]?.org_id).toBe(orgA);
  });

  it("[INV-F1] không gắn tổ chức thì không thấy gì — fail-closed", async () => {
    const client = await apiPool.connect();
    try {
      const { rowCount } = await client.query("SELECT 1 FROM users");
      expect(rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  // [INV-F1] Cùng bất biến fail-closed nhưng ở phía GHI. Nếu policy được viết theo dạng bị cấm
  // "app_current_org_id() IS NULL OR ..." thì phiên chưa gắn tổ chức KHÔNG chỉ đọc được tất cả
  // — nó còn ghi được vào tổ chức bất kỳ. Test đọc ở trên một mình không bắt được nửa này.
  it("[INV-F1] không gắn tổ chức thì không ghi được — fail-closed cả phía ghi", async () => {
    const client = await apiPool.connect();
    try {
      await expect(
        client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
          orgA,
          "khong-gan@example.com",
          "Khong gan",
        ]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      client.release();
    }
  });

  // [vòng fix 1 — I1] Đường rò mà phép kiểm command tag KHÔNG bắt được: `COMMIT` chạy NGOÀI
  // transaction cũng trả về tag "COMMIT" (chỉ kèm warning). Nên nếu `fn` tự kết thúc transaction
  // rồi đặt app.org_id ở phạm vi PHIÊN, withTenant() trả về BÌNH THƯỜNG và giá trị sống sót
  // trên client trả về pool — từ đó mọi truy vấn không qua withTenant() trên kết nối ấy chạy
  // dưới tổ chức sai, VĨNH VIỄN cho tới khi client bị huỷ.
  //
  // Phép đo phải SẮC: pool `max: 1` để lần connect() kế tiếp CHẮC CHẮN là cùng backend nếu
  // client không bị huỷ. Khẳng định là "lần dùng kế tiếp KHÔNG mang theo tổ chức của lần trước"
  // — bất kể điều đó đạt được bằng cách nào — vì đó mới là bất biến, không phải cơ chế.
  it("[I1] fn tự commit rồi đặt app.org_id phạm vi PHIÊN không rò sang lần dùng kết nối kế tiếp", async () => {
    const poolMotClient = createPool(db.connectionString, 1);
    try {
      const truoc = await poolMotClient.query<{ pid: number }>(
        "SELECT pg_backend_pid()::int AS pid",
      );

      await withTenant(poolMotClient, orgA, async (client) => {
        await client.query("COMMIT"); // fn tự kết thúc transaction của withTenant
        await client.query("SELECT set_config('app.org_id', $1, false)", [orgB]); // PHẠM VI PHIÊN
      });

      const client = await poolMotClient.connect();
      try {
        const { rows } = await client.query<{ org: string | null; pid: number }>(
          "SELECT app_current_org_id() AS org, pg_backend_pid()::int AS pid",
        );
        expect(
          rows[0]?.org,
          "tổ chức của lần dùng trước còn sống trên kết nối trả về pool — mọi pool.query() " +
            "không qua withTenant() sau đó chạy dưới tổ chức SAI.",
        ).toBeNull();
        // Chứng minh phép đo không rỗng ruột: kết nối phải THẬT SỰ bị thay, không phải GUC
        // ngẫu nhiên trống trên cùng backend.
        expect(rows[0]?.pid).not.toBe(truoc.rows[0]!.pid);
      } finally {
        client.release();
      }
    } finally {
      await poolMotClient.end();
    }
  });

  it("biến app.org_id không rò sang lần dùng kết nối kế tiếp", async () => {
    await withTenant(apiPool, orgA, async (client) => {
      await client.query("SELECT 1");
    });
    const client = await apiPool.connect();
    try {
      const { rows } = await client.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    } finally {
      client.release();
    }
  });

  it("rollback khi fn ném lỗi", async () => {
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
          orgA,
          "tam@example.com",
          "Tam",
        ]);
        throw new Error("loi co y");
      }),
    ).rejects.toThrow("loi co y");

    const { rowCount } = await db.pool.query("SELECT 1 FROM users WHERE email = 'tam@example.com'");
    expect(rowCount).toBe(0);
  });

  // Đã đo trên PostgreSQL 16.15 thật (pg@8.23.0): COMMIT trên một transaction ĐANG HỎNG không
  // báo lỗi — nó trả về command tag "ROLLBACK". Nghĩa là bản withTenant() chỉ gọi
  // client.query("COMMIT") rồi trả về sẽ báo THÀNH CÔNG cho người gọi trong khi mọi thay đổi
  // đã bị vứt. Kịch bản thật không hề hiếm: một try/catch phòng thủ đặt sai chỗ bên trong fn
  // nuốt lỗi của một truy vấn phụ, phần còn lại của fn chạy tiếp bình thường.
  it("báo lỗi khi transaction đã hỏng — COMMIT âm thầm biến thành ROLLBACK", async () => {
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
          orgA,
          "nuot-loi@example.com",
          "Nuot loi",
        ]);
        // fn NUỐT lỗi — transaction chuyển sang trạng thái aborted mà người gọi không biết.
        await client.query("SELECT 1 / 0").catch(() => undefined);
        return "co ve nhu thanh cong";
      }),
    ).rejects.toBeInstanceOf(TenantError);

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM users WHERE email = 'nuot-loi@example.com'",
    );
    expect(rowCount).toBe(0);
  });

  // Kết nối CHẾT ngay giữa transaction — backend bị terminate, mất mạng. Trong lúc client đang
  // checked-out, pg-pool KHÔNG gắn listener 'error' nào lên nó, nên sự kiện 'error' không ai
  // nghe sẽ GIẾT CẢ TIẾN TRÌNH Node. Đã tự đo bằng pg.Pool thật khi viết test này: "Emitted
  // 'error' event on Client instance" -> unhandled -> tiến trình thoát với exit code 1. Đây là
  // đúng lỗ hổng [fix I1] mà migrate() đã đóng, và withTenant() chạy trên MỌI request nên nó
  // phơi ra nhiều hơn hẳn. Test dùng db.pool (superuser): dưới app_api, pg_terminate_backend
  // bị từ chối ("permission denied to terminate process") nên không dựng được kịch bản này —
  // đã đo, và đó là lý do test này không đi qua poolAs().
  it("kết nối chết giữa transaction không giết tiến trình và không để client hỏng lại trong pool", async () => {
    const poolRieng = createPool(db.connectionString, 2);
    try {
      const loi = await withTenant(poolRieng, orgA, async (client) => {
        await client.query("SELECT pg_terminate_backend(pg_backend_pid())");
      }).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi).not.toBeNull();
      expect(
        poolRieng.totalCount,
        "Client đã hỏng vẫn nằm trong pool — lần lấy client kế tiếp sẽ nhận đúng kết nối chết đó.",
      ).toBe(0);

      // Và pool vẫn dùng được sau đó: một kết nối chết không được làm hỏng cả pool.
      const { rows } = await poolRieng.query<{ ok: number }>("SELECT 1 AS ok");
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await poolRieng.end();
    }
  });

  it("từ chối orgId không phải UUID", async () => {
    await expect(
      withTenant(apiPool, "'; DROP TABLE users; --", () => Promise.resolve(undefined)),
    ).rejects.toBeInstanceOf(TenantError);
  });

  // Thông báo lỗi đi vào log. orgId không phải bí mật, nhưng khuôn "nội suy thẳng dữ liệu
  // người dùng vào message" là thứ lan sang chỗ khác — nơi dữ liệu ĐÚNG LÀ bí mật. Giữ khuôn
  // an toàn ngay từ đây: message chỉ mô tả LOẠI lỗi, không mang theo giá trị.
  it("thông báo lỗi orgId không mang theo giá trị bị từ chối", async () => {
    const loi = await withTenant(apiPool, "khong-phai-uuid", () => Promise.resolve(undefined)).then(
      () => null,
      (e: Error) => e,
    );
    expect(loi).not.toBeNull();
    expect(loi!.message).not.toContain("khong-phai-uuid");
  });
});

// ============================================================================================
// [CR2-T3] Kiến trúc role mà 001 mô tả chỉ có nghĩa nếu dựng được THẬT. app_api là NOLOGIN, nên
// mọi test ở trên chạy qua db.poolAs("app_api") — tức một phiên SUPERUSER rồi "SET ROLE app_api".
// Điều đó đủ để RLS có hiệu lực (đã đo: RLS áp theo current_user), nhưng nó KHÔNG chứng minh
// được kiến trúc triển khai thật: phiên đó vẫn "RESET ROLE" về superuser được bất cứ lúc nào.
//
// Test dưới đây đi đường thật: một role ĐĂNG NHẬP là thành viên của app_api, kết nối bằng chính
// tài khoản đó, không có đường quay về superuser. Nó chỉ chạy được sau bản vá CR2-T3 — trước
// bản vá, migrate() xoá membership ở mỗi lần gọi nên role này không có quyền gì.
// ============================================================================================
describe("[CR2-T3] cô lập tổ chức dưới role đăng nhập thật, không phải SET ROLE từ superuser", () => {
  it("[INV-F1] app_api_login chỉ đọc được hàng của tổ chức đang gắn", async () => {
    await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api' IN ROLE app_api");
    // Chạy lại migrate() sau khi tạo role: đây chính là phép đo CR2-T3 — membership phải sống
    // sót qua một lần migrate() nữa, nếu không ứng dụng mất sạch quyền ở lần deploy kế tiếp.
    await migrate(db.pool, MIGRATIONS);

    const url = new URL(db.connectionString);
    url.username = "app_api_login";
    url.password = "mk-api";
    const poolDangNhap = createPool(url.toString(), 2);
    try {
      const dinhDanh = await poolDangNhap.query<{ hien_tai: string; phien: string }>(
        "SELECT current_user AS hien_tai, session_user AS phien",
      );
      expect(dinhDanh.rows[0]).toEqual({ hien_tai: "app_api_login", phien: "app_api_login" });

      const emails = await withTenant(poolDangNhap, orgA, async (client) => {
        const { rows } = await client.query<{ email: string }>("SELECT email FROM users");
        return rows.map((r) => r.email);
      });
      expect(emails).toEqual(["a@example.com"]);

      // Và không có đường vòng: role đăng nhập không phải superuser, không BYPASSRLS.
      const khongGan = await poolDangNhap.query("SELECT 1 FROM users");
      expect(khongGan.rowCount).toBe(0);
    } finally {
      await poolDangNhap.end();
    }
  });
});

// ============================================================================================
// [vòng fix 3 — I1] withTenant() DƯỚI MỘT search_path MÀ DỰ ÁN KHÔNG KIỂM SOÁT
// ============================================================================================
// Vòng 2 phát hiện quy tắc "pg_catalog được tìm NGẦM trước" PHÁ ĐƯỢC, ghi đủ "pg_catalog." cho
// hardening.always.sql, tự đánh dấu "MANG VÀO FINAL REVIEW" — rồi bỏ sót file bên cạnh.
// packages/db/src/migrate.ts tự GHIM search_path nên nó miễn nhiễm; withTenant() thì KHÔNG ghim
// được (nó chạy trên pool ứng dụng, dùng chung với mã nghiệp vụ) nên nó là đường DUY NHẤT trong
// repo chạy dưới search_path do người khác chọn.
//
// Dùng "?options=-c search_path=..." chứ không "ALTER ROLE ... SET search_path": đó là biến thể
// mà hardening KHÔNG BAO GIỜ phát hiện được (rolconfig sạch, pg_db_role_setting sạch), tức chặn
// 0% vĩnh viễn — khác với biến thể ALTER ROLE, vốn tự chữa ở lần deploy kế.
// ============================================================================================
describe("[I1] withTenant dưới search_path thù địch", () => {
  it("[INV-F1] hàm hệ thống bị che ở schema đứng trước không đổi được tổ chức đang gắn", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      const themToChuc = async (ten: string, slug: string): Promise<string> =>
        (
          await dbRieng.pool.query<{ id: string }>(
            "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
            [ten, slug],
          )
        ).rows[0]!.id;
      const a = await themToChuc("Cong ty A", "cong-ty-a");
      const b = await themToChuc("Cong ty B", "cong-ty-b");
      await dbRieng.pool.query(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1,'a@a.com','A'), ($2,'vip@b.com','B')",
        [a, b],
      );

      // Schema thù địch: hai hàm CÙNG CHỮ KÝ với bản trong pg_catalog.
      //   doc.set_config      -> luôn ghi tổ chức B, bất kể tham số
      //   doc.current_setting -> luôn trả '' (làm phép kiểm "còn sót" ở finally MÙ)
      await dbRieng.pool.query("CREATE SCHEMA doc; GRANT USAGE ON SCHEMA doc TO PUBLIC");
      // Hàm cướp phải GHI ĐÈ, không được "ghi giá trị lạ rồi vẫn chuyển tiếp tham số thật":
      // bản đầu tôi viết nó chuyển tiếp $1/$2 SAU khi ghi giá trị lạ, nên giá trị thật ghi
      // đè lại và ĐỘT BIẾN Y1 (bỏ "pg_catalog." ở dòng 84) SỐNG SÓT — fixture tự vô hiệu hoá
      // chính phép đo. Nay nó bỏ qua hẳn $1/$2.
      await dbRieng.pool.query(
        "CREATE FUNCTION doc.set_config(text, text, boolean) RETURNS text LANGUAGE sql AS " +
          "$f$SELECT pg_catalog.set_config('app.org_id', '" +
          b +
          "', $3)$f$",
      );
      await dbRieng.pool.query(
        "CREATE FUNCTION doc.current_setting(text, boolean) RETURNS text LANGUAGE sql AS " +
          "$f$SELECT ''::text$f$",
      );
      await dbRieng.pool.query(
        "CREATE ROLE app_api_login LOGIN PASSWORD 'mk-api' IN ROLE app_api",
      );
      // Dựng search_path thù địch bằng ALTER ROLE. Đã thử biến thể "?options=-c search_path=..."
      // TRƯỚC và đo được nó KHÔNG tới được Postgres qua createPool(): hàm đó cố ý chỉ chuyển
      // host/port/user/password/database/ssl RỜI RẠC cho pg.Pool và VỨT phần query string còn
      // lại (xem packages/db/src/pool.ts). Đó là một lớp giảm nhẹ có THẬT nhưng KHÔNG PHẢI thứ
      // test này canh — mọi mã dựng pg.Pool trực tiếp vẫn nhận `options`, và cả hai biến thể
      // đổ vào CÙNG một thứ: search_path của phiên. Nên canh ở đúng chỗ đó.
      await dbRieng.pool.query(
        "ALTER ROLE app_api_login SET search_path = doc, pg_catalog, public",
      );

      const url = new URL(dbRieng.connectionString);
      url.username = "app_api_login";
      url.password = "mk-api";
      const poolThuDich = createPool(url.toString(), 1);
      try {
        // Chốt tiền đề, nếu không cả test rỗng ruột: search_path THẬT SỰ thù địch, VÀ lời gọi
        // TRẦN thật sự bị cướp trong khi lời gọi ĐỦ TÊN thì không.
        expect(
          (await poolThuDich.query<{ search_path: string }>("SHOW search_path")).rows[0]!
            .search_path,
        ).toBe("doc, pg_catalog, public");
        // doc.set_config ghi app.org_id = tổ chức B như một TÁC DỤNG PHỤ, bất kể tham số.
        await poolThuDich.query("SELECT set_config('app.thu_nghiem', 'X', false)");
        const bicuop = await poolThuDich.query<{ that: string | null; tran: string | null }>(
          "SELECT pg_catalog.current_setting('app.org_id', true) AS that, " +
            "       current_setting('app.org_id', true) AS tran",
        );
        expect(
          bicuop.rows[0]!.that,
          "set_config TRẦN không bị cướp — quy tắc 'pg_catalog tìm ngầm trước' vẫn đúng ở cấu " +
            "hình này, nên phép đo dưới đây không chứng minh gì",
        ).toBe(b);
        expect(
          bicuop.rows[0]!.tran,
          "current_setting TRẦN không bị cướp — nửa thứ hai của phép đo sẽ rỗng ruột",
        ).toBe("");
        // Dọn lại trước phép đo chính: pool max=1 nên đây đúng là client sẽ được dùng tiếp.
        await poolThuDich.query("SELECT pg_catalog.set_config('app.org_id', '', false)");

        // PHÉP ĐO CHÍNH: withTenant gắn tổ chức A. Trước bản vá, đo được ["vip@b.com"].
        const emails = await withTenant(poolThuDich, a, async (client) => {
          const { rows } = await client.query<{ email: string }>("SELECT email FROM users");
          return rows.map((r) => r.email);
        });
        expect(
          emails,
          "withTenant(orgA) đọc ra dữ liệu của tổ chức khác — set_config trần bị cướp",
        ).toEqual(["a@a.com"]);

        // NỬA THỨ HAI — current_setting: doc.current_setting trả '' luôn, nên nếu withTenant
        // gọi current_setting TRẦN thì phép kiểm "còn sót" ở finally MÙ và kết nối bẩn quay
        // lại pool. pool max=1 nên lần connect() kế tiếp là cùng backend nếu client không bị huỷ.
        const truoc = await poolThuDich.query<{ pid: number }>(
          "SELECT pg_catalog.pg_backend_pid()::int AS pid",
        );
        await withTenant(poolThuDich, a, async (client) => {
          await client.query("COMMIT");
          await client.query("SELECT pg_catalog.set_config('app.org_id', $1, false)", [b]);
        });
        const sau = await poolThuDich.query<{ org: string | null; pid: number }>(
          "SELECT public.app_current_org_id() AS org, pg_catalog.pg_backend_pid()::int AS pid",
        );
        expect(
          sau.rows[0]!.org,
          "app.org_id còn sót trên kết nối trả về pool — current_setting trần bị che nên " +
            "phép kiểm ở finally không thấy gì",
        ).toBeNull();
        expect(sau.rows[0]!.pid).not.toBe(truoc.rows[0]!.pid);
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await dbRieng.stop();
    }
  }, 180_000);
});
