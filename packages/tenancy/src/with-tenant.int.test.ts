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
  it("[INV-F2] không chuyển được hàng của mình sang org_id của tổ chức khác", async () => {
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("UPDATE users SET org_id = $1 WHERE email = $2", [
          orgB,
          "a@example.com",
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);

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
