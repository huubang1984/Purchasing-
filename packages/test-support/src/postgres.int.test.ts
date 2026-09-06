import pg from "pg";
import { describe, expect, it } from "vitest";
import { startPostgres, withMigratedDatabase } from "./postgres.js";

// Bản sửa của [fix C1]: poolAs() từng "bắn rồi quên" SET ROLE (`void client.query(...)`),
// khiến (a) role sai crash cả tiến trình Node do unhandled rejection thay vì test fail
// sạch, và (b) câu SET ROLE chạy chồng lấn với câu lệnh thật của người gọi trên cùng một
// client vì không ai chờ nó xong. Bộ test dưới đây tấn công đúng hai lỗ đó.
//
// Không tự gọi .end() trên pool trả về từ poolAs() trong các test này: pool đó đã được
// `db`/`withMigratedDatabase` theo dõi và tự đóng khi kết thúc — gọi .end() thêm lần nữa
// ném lỗi "Called end on pool more than once" (tự kiểm chứng khi viết test này).
describe("poolAs — pool chạy dưới role khác", () => {
  it("từ chối vai trò không nằm trong danh sách cho phép, không chạm DB", async () => {
    const db = await startPostgres();
    try {
      expect(() => db.poolAs("role_gia_mao; DROP TABLE audit_events;")).toThrow(
        /vai trò không hợp lệ/,
      );
    } finally {
      await db.stop();
    }
  });

  // [fix round 2] Bản trước dùng Promise.all(5 câu đồng thời) trên MỘT pool RỖNG (max: 3) —
  // vì pool chưa có client rảnh nào, mọi lời gọi đều mở KẾT NỐI MỚI, nên test này không phân
  // biệt được bản có lỗi I3 (chỉ gán role đúng cho kết nối mới) với bản đã sửa (gán lại role
  // ở MỌI lần lấy client). Đã tự đột biến kiểm chứng: cách viết cũ sống sót khi bỏ cơ chế
  // tái khẳng định role cho client tái sử dụng. Sửa bằng cách chạy TUẦN TỰ (không Promise.all)
  // để ép pool tái dùng ĐÚNG MỘT client rảnh cho cả 5 câu — đây mới là điều kiện thật sự cần
  // đúng role trên client được tái sử dụng.
  it("role hợp lệ: 5 câu lệnh tuần tự trên cùng một client rảnh được tái dùng đều thấy đúng role", async () => {
    await withMigratedDatabase(async (db) => {
      const apiPool = db.poolAs("app_api");
      for (let lan = 0; lan < 5; lan += 1) {
        const { rows } = await apiPool.query<{ vai_tro: string }>(
          "SELECT current_user AS vai_tro",
        );
        expect(rows[0]?.vai_tro).toBe("app_api");
      }
    });
  });

  it("SET ROLE thất bại (role chưa tồn tại trên cluster) làm query() reject rõ ràng, không crash tiến trình", async () => {
    // Cố ý dùng startPostgres() TRẦN — chưa chạy migrate() nên app_api chưa tồn tại trên
    // cluster này. Đây chính là kịch bản khiến bản lỗi trước tạo unhandled rejection.
    const db = await startPostgres();
    try {
      const rolePool = db.poolAs("app_api");
      await expect(rolePool.query("SELECT 1")).rejects.toThrow();
    } finally {
      await db.stop();
    }
  });

  it("app_api gọi được app_current_org_id() sau khi migration cấp lại EXECUTE đã bị REVOKE khỏi PUBLIC", async () => {
    await withMigratedDatabase(async (db) => {
      const apiPool = db.poolAs("app_api");
      const { rows } = await apiPool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    });
  });

  // [fix I3] onConnect/'connect' của pg-pool chỉ chạy cho kết nối VẬT LÝ MỚI, không chạy lại
  // khi pool tái dùng một client rảnh. Mô phỏng đúng kịch bản đầu độc: lấy client, tự RESET
  // ROLE trên đó (mô phỏng bất kỳ ai/đoạn code nào lỡ chạy RESET ROLE hoặc DISCARD ALL), trả
  // lại pool, rồi lấy lại — pg-pool ưu tiên trả CHÍNH client rảnh đó cho lần connect() kế tiếp
  // (không có ai khác tranh chấp pool trong test này), nên đây là phép thử xác định, không
  // phải xác suất.
  it("[fix I3] RESET ROLE trên client rồi trả lại pool không đầu độc lần lấy client kế tiếp", async () => {
    await withMigratedDatabase(async (db) => {
      const apiPool = db.poolAs("app_api");

      const client1 = await apiPool.connect();
      await client1.query("RESET ROLE");
      const { rows: kiemTraDaBiReset } = await client1.query<{ vai_tro: string }>(
        "SELECT current_user AS vai_tro",
      );
      expect(kiemTraDaBiReset[0]?.vai_tro).not.toBe("app_api"); // xác nhận RESET ROLE có hiệu lực
      client1.release();

      const { rows } = await apiPool.query<{ vai_tro: string }>("SELECT current_user AS vai_tro");
      expect(rows[0]?.vai_tro).toBe("app_api");
    });
  });
});

// [fix Minor] stop() dùng "Promise.all" + "await pool.end()" trần trước đây: nếu người gọi
// đã tự end() một rolePool trả về từ poolAs() TRƯỚC KHI gọi stop(), pool.end() ném "Called
// end on pool more than once", Promise.all reject ngay, và "container.stop()" không bao giờ
// chạy — rò rỉ container Testcontainers thật. Vấp phải đúng lỗi này khi tự dựng ca kiểm cho
// nó, y như review độc lập mô tả.
describe("stop() — dọn dẹp bền vững dù một pool con đã tự end() trước", () => {
  it("[fix Minor] stop() vẫn dừng container dù apiPool đã tự end() trước khi gọi stop()", async () => {
    const db = await startPostgres();
    const apiPool = db.poolAs("app_api");
    await apiPool.end(); // người gọi tự ý end() trước — đúng kịch bản gây lỗi

    await expect(db.stop()).resolves.toBeUndefined(); // KHÔNG được ném lỗi

    // Xác nhận container THẬT đã dừng, không chỉ "không ném lỗi": kết nối mới tới đúng
    // connectionString phải thất bại vì không còn gì đang lắng nghe ở đó.
    const poolThuNoiLai = new pg.Pool({
      connectionString: db.connectionString,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      await expect(poolThuNoiLai.query("SELECT 1")).rejects.toThrow();
    } finally {
      await poolThuNoiLai.end().catch(() => {});
    }
  });
});

// ==============================================================================================
// [khoản nợ 28] PHÉP ĐO CÓ RĂNG — VÀ RĂNG ẤY ĐƯỢC CHỨNG MINH BẰNG MỘT CA RÒ RỈ DỰNG SẴN
//
// Khoản nợ 28 nói *"phải được ĐO chứ không được sửa mù"*. Một khẳng định canh rò rỉ kết nối mà
// chưa bao giờ thấy một rò rỉ thật thì không phân biệt được với `expect(true).toBe(true)`. Nên
// ca dưới đây RÒ RỈ CÓ CHỦ ĐÍCH — đúng hình dạng đã gây `57P01` trên CI: một pool do bộ test tự
// dựng, không đi qua `poolAs()`, nên `stop()` không biết đường đóng nó.
// ==============================================================================================
describe("[khoản nợ 28] stop() ĐO được kết nối còn sống, và vẫn dừng container", () => {
  it("một pool do bộ test TỰ dựng và quên đóng làm `stop()` ném — nêu pid, KHÔNG nêu câu lệnh", async () => {
    const db = await startPostgres();
    const poolRoRi = new pg.Pool({ connectionString: db.connectionString, max: 1 });
    // Pool bị bỏ quên sẽ nhận `error` khi backend của nó bị giết lúc container dừng. Không nuốt
    // ở đây thì chính test này sập tiến trình vì "unhandled error" — đúng cái nó đang tố cáo.
    poolRoRi.on("error", () => undefined);
    try {
      // Mở một kết nối THẬT và giữ nó: `new pg.Pool` một mình chưa nối tới đâu cả.
      await poolRoRi.query("SELECT 1");

      let loi: Error | undefined;
      try {
        await db.stop();
      } catch (e) {
        loi = e as Error;
      }

      expect(loi, "stop() phải ném — nếu không, phép đo của khoản nợ 28 rỗng ruột").toBeDefined();
      expect(loi?.message).toMatch(/khoản nợ 28/);
      expect(loi?.message, "phải chỉ được ra AI còn sống, không chỉ nói rằng có ai đó").toMatch(
        /pid=\d+/,
      );
      // [CẤM LOG] Câu lệnh của backend còn sống có thể mang giá hoặc bản rõ. Thông điệp lỗi đi
      // thẳng vào log CI, nên cột `query` không được có mặt — kể cả câu vô hại của test này.
      expect(loi?.message, "thông điệp KHÔNG được mang câu lệnh của backend").not.toMatch(
        /SELECT 1/,
      );

      // QUYẾT ĐỊNH ⑵ của khối lý do trong `postgres.ts`, đo ở đây: khẳng định KHÔNG được rò rỉ
      // container thật. Ném là ném SAU khi đã dừng.
      const poolThuNoiLai = new pg.Pool({
        connectionString: db.connectionString,
        max: 1,
        connectionTimeoutMillis: 2000,
      });
      poolThuNoiLai.on("error", () => undefined);
      try {
        await expect(poolThuNoiLai.query("SELECT 1")).rejects.toThrow();
      } finally {
        await poolThuNoiLai.end().catch(() => undefined);
      }
    } finally {
      await poolRoRi.end().catch(() => undefined);
    }
  }, 120_000);

  it("lỗi của THÂN HÀM thắng lỗi dọn dẹp trong `withMigratedDatabase`", async () => {
    // Phép đo mới ném từ `stop()`, và `stop()` chạy ở đường dọn dẹp. Một `finally` trần sẽ NUỐT
    // lỗi gốc — tức lớp canh rò rỉ che mất đúng thứ bộ test đang tìm. Ca này ép cả hai lỗi xảy
    // ra cùng lúc và đòi lỗi của thân hàm là lỗi người gọi nhìn thấy.
    let poolRoRi: pg.Pool | undefined;
    try {
      await expect(
        withMigratedDatabase(async (db) => {
          poolRoRi = new pg.Pool({ connectionString: db.connectionString, max: 1 });
          poolRoRi.on("error", () => undefined);
          await poolRoRi.query("SELECT 1");
          throw new Error("LOI-GOC-CUA-THAN-HAM");
        }),
      ).rejects.toThrow(/LOI-GOC-CUA-THAN-HAM/);
    } finally {
      await poolRoRi?.end().catch(() => undefined);
    }
  }, 120_000);
});
