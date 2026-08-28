import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  PERMISSIONS,
  PermissionAuditFailedError,
  PermissionDeniedError,
  hasPermission,
  requirePermission,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
/** Pool nghiệp vụ — nơi transaction của người gọi sống. */
let apiPool: pg.Pool;
/** Pool RIÊNG dành cho việc ghi sổ lần từ chối. Xem docstring của requirePermission. */
let auditPool: pg.Pool;
let orgId: string;
let orgB: string;
const userIds = new Map<string, string>();

/** Tạo một người dùng mới trong `orgId` và gán đúng các vai trò được nêu. */
async function taoNguoiDung(email: string, vaiTro: readonly string[]): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
    [orgId, email, email],
  );
  const userId = rows[0]!.id;
  for (const ma of vaiTro) {
    await db.pool.query(
      "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)",
      [orgId, userId, ma],
    );
  }
  return userId;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");

  const { rows: orgs } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a'), ('Cong ty B', 'b') RETURNING id",
  );
  orgId = orgs[0]!.id;
  orgB = orgs[1]!.id;

  for (const role of ["REQUESTER", "BUYER", "TECHNICAL", "PROCUREMENT_MANAGER", "FINANCE", "DIRECTOR"]) {
    userIds.set(role, await taoNguoiDung(`${role.toLowerCase()}@example.com`, [role]));
  }
}, 240000);

afterAll(async () => {
  await auditPool?.end().catch(() => {});
  await apiPool?.end().catch(() => {});
  await db?.stop();
});

function uid(role: string): string {
  const id = userIds.get(role);
  if (id === undefined) throw new Error(`Chưa seed vai trò ${role}`);
  return id;
}

describe("kiểm soát quyền theo vai trò", () => {
  it("[INV-D1] Procurement Manager có quyền mở thầu", async () => {
    const ok = await withTenant(apiPool, orgId, (c) =>
      hasPermission(c, {
        userId: uid("PROCUREMENT_MANAGER"),
        orgId,
        permission: PERMISSIONS.RFQ_UNSEAL,
      }),
    );
    expect(ok).toBe(true);
  });

  it("[INV-D1] Buyer KHÔNG có quyền mở thầu", async () => {
    const ok = await withTenant(apiPool, orgId, (c) =>
      hasPermission(c, { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL }),
    );
    expect(ok).toBe(false);
  });

  it("[INV-D3] Technical chỉ đánh giá, không tạo RFQ và không trao thầu", async () => {
    await withTenant(apiPool, orgId, async (c) => {
      const userId = uid("TECHNICAL");
      expect(
        await hasPermission(c, { userId, orgId, permission: PERMISSIONS.EVALUATION_PERFORM }),
      ).toBe(true);
      expect(await hasPermission(c, { userId, orgId, permission: PERMISSIONS.RFQ_CREATE })).toBe(
        false,
      );
      expect(
        await hasPermission(c, { userId, orgId, permission: PERMISSIONS.AWARD_RECOMMEND }),
      ).toBe(false);
    });
  });

  it("[INV-D3] chỉ Director và Finance được duyệt đơn mua hàng", async () => {
    await withTenant(apiPool, orgId, async (c) => {
      expect(
        await hasPermission(c, { userId: uid("DIRECTOR"), orgId, permission: PERMISSIONS.PO_APPROVE }),
      ).toBe(true);
      expect(
        await hasPermission(c, { userId: uid("FINANCE"), orgId, permission: PERMISSIONS.PO_APPROVE }),
      ).toBe(true);
      expect(
        await hasPermission(c, {
          userId: uid("PROCUREMENT_MANAGER"),
          orgId,
          permission: PERMISSIONS.PO_APPROVE,
        }),
      ).toBe(false);
      expect(
        await hasPermission(c, { userId: uid("BUYER"), orgId, permission: PERMISSIONS.PO_APPROVE }),
      ).toBe(false);
    });
  });

  it("requirePermission cho qua khi đủ quyền và KHÔNG ghi sổ gì", async () => {
    const truoc = await demSuKien(orgId);
    await expect(
      withTenant(apiPool, orgId, (c) =>
        requirePermission(
          c,
          {
            userId: uid("DIRECTOR"),
            orgId,
            permission: PERMISSIONS.RFQ_UNSEAL,
            resourceType: "RFQ",
          },
          auditPool,
        ),
      ),
    ).resolves.toBeUndefined();
    // D5 nói lần TỪ CHỐI phải được audit. Lần CHO QUA thuộc về nghiệp vụ gọi nó ghi, không
    // thuộc về hàm này — nếu nó cũng ghi, mỗi lần kiểm quyền là một lần lấy khoá ghi sổ của cả
    // tổ chức (xem ĐO-3/ĐO-4 trong docstring của requirePermission).
    expect(await demSuKien(orgId)).toBe(truoc);
  });

  // ==========================================================================================
  // ĐÂY LÀ TEST QUAN TRỌNG NHẤT CỦA FILE, và nó là chỗ đơn thuốc SAI.
  //
  // Test "[INV-D5]" trong brief chỉ khẳng định "có bản ghi kiểm toán" SAU khi lời gọi ném —
  // nhưng brief ghi audit bằng CHÍNH client của người gọi, mà `withTenant` ROLLBACK khi lỗi lan
  // ra. Đã đo trên PostgreSQL 16.15 (ĐO-2): trong transaction 1 bản ghi, sau ROLLBACK 0 bản
  // ghi. Nghĩa là chính test của brief cũng không thể xanh, và D5 KHÔNG được thoả.
  //
  // Khẳng định dưới đây kiểm ĐÚNG tính chất đó: bản ghi phải còn SAU KHI transaction người gọi
  // đã cuộn lại. Một bản cài đặt ghi trong transaction người gọi làm test này ĐỎ.
  // ==========================================================================================
  it("[INV-D5] từ chối vì thiếu quyền sinh bản ghi kiểm toán SỐNG SÓT qua rollback của người gọi", async () => {
    await expect(
      withTenant(apiPool, orgId, (c) =>
        requirePermission(
          c,
          {
            userId: uid("BUYER"),
            orgId,
            permission: PERMISSIONS.RFQ_UNSEAL,
            resourceType: "RFQ",
            resourceId: null,
            requestId: null,
          },
          auditPool,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const { rows } = await db.pool.query<{
      action: string;
      actor_id: string;
      payload: { permission: string };
    }>(
      `SELECT action, actor_id, payload FROM audit_events
        WHERE org_id = $1 AND action = 'PERMISSION_DENIED' ORDER BY seq DESC LIMIT 1`,
      [orgId],
    );
    expect(rows[0]?.action).toBe("PERMISSION_DENIED");
    expect(rows[0]?.actor_id).toBe(uid("BUYER"));
    expect(rows[0]?.payload.permission).toBe(PERMISSIONS.RFQ_UNSEAL);
  });

  it("[INV-D5] bản ghi từ chối vẫn còn khi người gọi CỐ Ý nuốt lỗi rồi rollback", async () => {
    // Đường đi thật của một handler viết phòng thủ: bắt PermissionDeniedError, trả 403, và
    // transaction nghiệp vụ bị cuộn lại. Với thiết kế của brief, đây là lúc bằng chứng biến mất.
    const truoc = await demTuChoi(orgId);
    await withTenant(apiPool, orgId, async (c) => {
      try {
        await requirePermission(
          c,
          {
            userId: uid("TECHNICAL"),
            orgId,
            permission: PERMISSIONS.PO_APPROVE,
            resourceType: "PURCHASE_ORDER",
          },
          auditPool,
        );
      } catch (loi) {
        expect(loi).toBeInstanceOf(PermissionDeniedError);
      }
      // Người gọi tự làm hỏng transaction để ép ROLLBACK.
      await c.query("SELECT 1").catch(() => undefined);
    });
    expect(await demTuChoi(orgId)).toBe(truoc + 1);
  });

  it("[INV-F1] người dùng của tổ chức khác không có quyền nào ở tổ chức này", async () => {
    const ok = await withTenant(apiPool, orgB, (c) =>
      hasPermission(c, { userId: uid("DIRECTOR"), orgId: orgB, permission: PERMISSIONS.RFQ_UNSEAL }),
    );
    expect(ok).toBe(false);
  });

  // Test ĐỐI KHÁNG cho dư lượng đã ghi ở 005: `user_roles` không ép org_id khớp users.org_id,
  // nên một app_api bị chiếm chèn được (tổ_chức_B, người_của_A, DIRECTOR). Hàng đó phải VÔ HIỆU,
  // và thứ làm nó vô hiệu là vế nối qua `public.users` dưới RLS — không phải một ràng buộc nào.
  it("[INV-F1] hàng user_roles trỏ tới người của tổ chức KHÁC là vô hiệu", async () => {
    const nguoiCuaA = uid("DIRECTOR");
    await withTenant(apiPool, orgB, async (c) => {
      // Chèn ĐƯỢC: WITH CHECK chỉ đòi org_id = tổ chức đang gắn, khoá ngoại users(id) chạy dưới
      // quyền hệ thống. Nếu câu này ném, phần còn lại của test mất ý nghĩa nên phải để nó nổi.
      await c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
        orgB,
        nguoiCuaA,
        "DIRECTOR",
      ]);
      const { rowCount } = await c.query("SELECT 1 FROM user_roles WHERE user_id = $1", [nguoiCuaA]);
      expect(rowCount, "chống rỗng ruột: hàng tấn công phải THẬT SỰ tồn tại").toBe(1);

      expect(
        await hasPermission(c, { userId: nguoiCuaA, orgId: orgB, permission: PERMISSIONS.PO_APPROVE }),
      ).toBe(false);

      await c.query("DELETE FROM user_roles WHERE user_id = $1", [nguoiCuaA]);
    });
  });

  it("[INV-D1] người dùng bị đình chỉ mất toàn bộ quyền", async () => {
    const userId = uid("DIRECTOR");
    await db.pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);
    try {
      const ok = await withTenant(apiPool, orgId, (c) =>
        hasPermission(c, { userId, orgId, permission: PERMISSIONS.RFQ_UNSEAL }),
      );
      expect(ok).toBe(false);
    } finally {
      await db.pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [userId]);
    }
  });

  // `orgId` phải là tham số CHỊU LỰC, không phải trang trí. Không có khẳng định tenant, lời gọi
  // này trả `false` — "không thấy gì" trông y hệt "không có quyền".
  it("hasPermission ném khi phiên đang gắn tổ chức KHÁC với orgId được hỏi", async () => {
    await expect(
      withTenant(apiPool, orgB, (c) =>
        hasPermission(c, {
          userId: uid("DIRECTOR"),
          orgId, // hỏi về tổ chức A trên một phiên gắn tổ chức B
          permission: PERMISSIONS.RFQ_UNSEAL,
        }),
      ),
    ).rejects.toThrow(/hasPermission: phiên đang gắn tổ chức/);
  });
});

// ============================================================================================
// [INV-D3] PHÂN TÁCH NHIỆM VỤ Ở MỨC NGƯỜI DÙNG — lớp mà brief không có.
//
// Sáu vai trò mặc định không vai nào ôm trọn chuỗi (lớp phán xét ở hardening canh việc đó).
// Nhưng `user_roles` là bảng app_api GHI ĐƯỢC, nên gán cho MỘT người cả PROCUREMENT_MANAGER
// lẫn DIRECTOR là đủ để một người nắm trọn chuỗi:
//   PROCUREMENT_MANAGER -> rfq.create, rfq.invite, rfq.unseal, award.recommend
//   DIRECTOR            -> po.approve (cộng rfq.unseal, award.recommend)
//   hợp lại             -> ĐỦ CẢ NĂM BƯỚC
// ============================================================================================
describe("[INV-D3] phân tách nhiệm vụ ở mức người dùng", () => {
  it("gán vai trò thứ hai làm một người nắm trọn chuỗi thì bị TỪ CHỐI", async () => {
    const userId = await taoNguoiDung("gom-quyen@example.com", []);
    await withTenant(apiPool, orgId, async (c) => {
      await c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
        orgId,
        userId,
        "PROCUREMENT_MANAGER",
      ]);
    });

    await expect(
      withTenant(apiPool, orgId, (c) =>
        c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
          orgId,
          userId,
          "DIRECTOR",
        ]),
      ),
    ).rejects.toThrow(/Phân tách nhiệm vụ \(D3\)/);

    // Vai trò thứ nhất một mình vẫn còn — trigger chỉ chặn hàng làm TRÒN chuỗi.
    const { rows } = await db.pool.query<{ role_code: string }>(
      "SELECT role_code FROM user_roles WHERE user_id = $1 ORDER BY 1",
      [userId],
    );
    expect(rows.map((r) => r.role_code)).toEqual(["PROCUREMENT_MANAGER"]);
  });

  it("gán CẢ HAI vai trò trong MỘT câu INSERT cũng bị từ chối", async () => {
    // Ca này là lý do trigger phải là AFTER ROW chứ không BEFORE ROW: trigger AFTER ROW được
    // xếp hàng và bắn ở CUỐI câu lệnh, nên nó nhìn thấy CẢ HAI hàng. Một BEFORE ROW xét từng
    // hàng khi hàng kia chưa tồn tại và cho lọt sạch.
    const userId = await taoNguoiDung("gom-quyen-1-cau@example.com", []);
    await expect(
      withTenant(apiPool, orgId, (c) =>
        c.query(
          "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER'), ($1, $2, 'DIRECTOR')",
          [orgId, userId],
        ),
      ),
    ).rejects.toThrow(/Phân tách nhiệm vụ \(D3\)/);

    const { rowCount } = await db.pool.query("SELECT 1 FROM user_roles WHERE user_id = $1", [
      userId,
    ]);
    expect(rowCount).toBe(0);
  });

  it("một tổ hợp vai trò KHÔNG tròn chuỗi vẫn gán được — phép kiểm không quá tay", async () => {
    // Chống "fail-closed quá tay": nếu trigger chặn mọi tổ hợp thì test trên xanh vì lý do sai.
    const userId = await taoNguoiDung("hai-vai-hop-le@example.com", []);
    await withTenant(apiPool, orgId, (c) =>
      c.query(
        "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER'), ($1, $2, 'TECHNICAL')",
        [orgId, userId],
      ),
    );
    const { rowCount } = await db.pool.query("SELECT 1 FROM user_roles WHERE user_id = $1", [
      userId,
    ]);
    expect(rowCount).toBe(2);
  });

  it("trigger chạy cả khi phiên đặt session_replication_role = replica (ENABLE ALWAYS)", async () => {
    // Không có ENABLE ALWAYS, một phiên đặt GUC này bỏ qua trigger ORIGIN. Đây là cùng đường
    // trôi mà 003 đã đóng cho sáu trigger sổ.
    const userId = await taoNguoiDung("replica@example.com", ["PROCUREMENT_MANAGER"]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL session_replication_role = 'replica'");
      await expect(
        c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DIRECTOR')", [
          orgId,
          userId,
        ]),
      ).rejects.toThrow(/Phân tách nhiệm vụ \(D3\)/);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

// ============================================================================================
// MA TRẬN QUYỀN LÀ DỮ LIỆU, VÀ DỮ LIỆU ẤY QUYẾT ĐỊNH AN NINH.
// Câu hỏi phải trả lời thẳng: AI ĐƯỢC SỬA `role_permissions`, VÀ BẰNG ĐƯỜNG NÀO?
// ============================================================================================
describe("ai sửa được ma trận quyền", () => {
  const cacBang = ["permissions", "roles", "role_permissions"] as const;

  for (const bang of cacBang) {
    it(`[INV-D3] app_api KHÔNG ghi được vào ${bang}`, async () => {
      const c = await apiPool.connect();
      try {
        // Chống rỗng ruột: đọc phải ĐƯỢC, nếu không thì "ghi bị chặn" có thể chỉ vì bảng không
        // tồn tại hay role không thấy schema.
        const { rowCount } = await c.query(`SELECT 1 FROM public.${bang} LIMIT 1`);
        expect(rowCount).toBe(1);

        await expect(c.query(`DELETE FROM public.${bang}`)).rejects.toMatchObject({ code: "42501" });
        await expect(
          c.query(`UPDATE public.${bang} SET ${bang === "permissions" ? "description" : bang === "roles" ? "name" : "permission_code"} = 'x'`),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        c.release();
      }
    });
  }

  it("[INV-D3] app_api không tự cấp thêm quyền cho vai trò của mình được", async () => {
    const c = await apiPool.connect();
    try {
      await expect(
        c.query(
          "INSERT INTO public.role_permissions (role_code, permission_code) VALUES ('BUYER', 'po.approve')",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      c.release();
    }
  });
});

// ============================================================================================
// HAI CẠM BẪY CỦA VIỆC GHI SỔ Ở TRANSACTION ĐỘC LẬP — cả hai đều là "treo vĩnh viễn" nếu không
// canh, và cả hai đều được biến thành một lỗi TỨC THÌ có chẩn đoán.
// ============================================================================================
describe("requirePermission không treo khi không ghi sổ độc lập được", () => {
  it("transaction người gọi ĐANG GIỮ khoá ghi sổ của tổ chức -> lỗi tức thì, không chờ lock_timeout", async () => {
    const batDau = Date.now();
    await expect(
      withTenant(apiPool, orgId, async (c) => {
        // Người gọi ghi sổ TRƯỚC khi kiểm quyền -> nắm pg_advisory_xact_lock của tổ chức.
        await c.query(
          "SELECT * FROM public.audit_append($1,'USER',NULL,'VIEC_KHAC','RFQ',NULL,'{}'::jsonb,NULL,NULL,NULL)",
          [orgId],
        );
        await requirePermission(
          c,
          { userId: uid("BUYER"), orgId, permission: PERMISSIONS.PO_APPROVE, resourceType: "RFQ" },
          auditPool,
        );
      }),
    ).rejects.toBeInstanceOf(PermissionAuditFailedError);
    // Không có vế canh, lời gọi này chờ tới `lock_timeout` (mặc định 15 giây của createPool) —
    // hoặc VÔ HẠN trên một pool không đặt lock_timeout, đúng như pool của test này.
    expect(Date.now() - batDau).toBeLessThan(5000);
  });

  it("auditPool hết chỗ -> lỗi tức thì thay vì chờ vô hạn ở pool.connect()", async () => {
    const poolNho = db.poolAs("app_api");
    const giu: pg.PoolClient[] = [];
    try {
      // Rút cạn pool (poolAs dựng pool với max: 3).
      for (let i = 0; i < poolNho.options.max; i += 1) giu.push(await poolNho.connect());
      expect(poolNho.idleCount).toBe(0);

      const batDau = Date.now();
      await expect(
        withTenant(apiPool, orgId, (c) =>
          requirePermission(
            c,
            { userId: uid("BUYER"), orgId, permission: PERMISSIONS.PO_APPROVE, resourceType: "RFQ" },
            poolNho,
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionAuditFailedError);
      expect(Date.now() - batDau).toBeLessThan(5000);
    } finally {
      for (const c of giu) c.release();
      await poolNho.end();
    }
  });

  it("PermissionAuditFailedError giữ nguyên lần từ chối gốc — không nuốt mất nó", async () => {
    const poolNho = db.poolAs("app_api");
    const giu: pg.PoolClient[] = [];
    try {
      for (let i = 0; i < poolNho.options.max; i += 1) giu.push(await poolNho.connect());
      const loi = await withTenant(apiPool, orgId, (c) =>
        requirePermission(
          c,
          { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: "RFQ" },
          poolNho,
        ),
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(loi).toBeInstanceOf(PermissionAuditFailedError);
      expect((loi as PermissionAuditFailedError).denial).toBeInstanceOf(PermissionDeniedError);
      expect((loi as PermissionAuditFailedError).denial.permission).toBe(PERMISSIONS.RFQ_UNSEAL);
      expect((loi as PermissionAuditFailedError).denial.userId).toBe(uid("BUYER"));
    } finally {
      for (const c of giu) c.release();
      await poolNho.end();
    }
  });
});

async function demSuKien(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1",
    [org],
  );
  return rows[0]?.n ?? -1;
}

async function demTuChoi(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED'",
    [org],
  );
  return rows[0]?.n ?? -1;
}

// ============================================================================================
// [QT3] `hasPermission` CHẠY DƯỚI search_path MÀ DỰ ÁN KHÔNG KIỂM SOÁT.
//
// `withTenant` GHIM tên hàm cho ba câu lệnh của CHÍNH NÓ, nhưng truy vấn do `fn` viết thì chạy
// dưới search_path của người gọi (nói rõ trong docstring của nó). Với `hasPermission`, thứ bị
// cướp không phải một HÀM mà là một BẢNG: dưới `search_path = doc, pg_catalog, public`, một tên
// trần `role_permissions` phân giải về `doc.role_permissions`.
//
// Đây là đường leo thang trực tiếp: kẻ dựng được schema đó cấp cho MỌI vai trò MỌI quyền mà
// không đụng tới một hàng nào trong `public`. Bản kế hoạch viết tên trần.
// ============================================================================================
describe("[QT3] hasPermission dưới search_path thù địch", () => {
  it("[INV-D1] bảng bị che ở schema đứng trước KHÔNG cấp thêm được quyền nào", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      const { rows: o } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
      );
      const org = o[0]!.id;
      const { rows: u } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'buyer@a.com', 'Buyer') RETURNING id",
        [org],
      );
      const buyer = u[0]!.id;
      await dbRieng.pool.query(
        "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')",
        [org, buyer],
      );

      // Schema thù địch: một `role_permissions` CÙNG TÊN cấp cho BUYER quyền mở thầu.
      await dbRieng.pool.query("CREATE SCHEMA doc; GRANT USAGE ON SCHEMA doc TO PUBLIC");
      await dbRieng.pool.query(
        "CREATE TABLE doc.role_permissions (role_code text, permission_code text); " +
          "INSERT INTO doc.role_permissions VALUES ('BUYER', 'rfq.unseal'); " +
          "GRANT SELECT ON doc.role_permissions TO PUBLIC",
      );
      await dbRieng.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk' IN ROLE app_api");
      await dbRieng.pool.query(
        "ALTER ROLE app_api_login SET search_path = doc, pg_catalog, public",
      );

      const url = new URL(dbRieng.connectionString);
      url.username = "app_api_login";
      url.password = "mk";
      const poolThuDich = createPool(url.toString(), 2);
      try {
        // FIXTURE PHẢI CHỨNG MINH NÓ TẤN CÔNG ĐƯỢC trước khi dùng để kết luận. Không có hai vế
        // này, test xanh kể cả khi schema `doc` hoàn toàn vô hại.
        expect(
          (await poolThuDich.query<{ search_path: string }>("SHOW search_path")).rows[0]!
            .search_path,
        ).toBe("doc, pg_catalog, public");
        const bicuop = await poolThuDich.query<{ tran: number; du: number }>(
          "SELECT (SELECT count(*)::int FROM role_permissions WHERE role_code = 'BUYER' " +
            "          AND permission_code = 'rfq.unseal') AS tran, " +
            "       (SELECT count(*)::int FROM public.role_permissions WHERE role_code = 'BUYER' " +
            "          AND permission_code = 'rfq.unseal') AS du",
        );
        expect(bicuop.rows[0]!.tran, "tên TRẦN không bị cướp — phép đo rỗng ruột").toBe(1);
        expect(bicuop.rows[0]!.du, "tên ĐỦ SCHEMA lại bị cướp — phép đo rỗng ruột").toBe(0);

        // Và đây là điều phải đúng: hasPermission viết tên ĐỦ SCHEMA nên nó KHÔNG bị cướp.
        expect(
          await withTenant(poolThuDich, org, (c) =>
            hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.RFQ_UNSEAL }),
          ),
        ).toBe(false);
        // Đối chứng: quyền THẬT của BUYER vẫn đọc đúng, nên "false" ở trên không phải vì truy
        // vấn hỏng hoàn toàn dưới search_path này.
        expect(
          await withTenant(poolThuDich, org, (c) =>
            hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.RFQ_CREATE }),
          ),
        ).toBe(true);
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await dbRieng.stop();
    }
  }, 240_000);
});
