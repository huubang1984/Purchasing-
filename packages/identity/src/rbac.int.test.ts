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
  SEPARATION_OF_DUTIES_CHAIN,
  requirePermission,
} from "./index.js";
// [vòng fix 1 — F6] `hasPermission` CỐ Ý không còn ở barrel công khai (xem khối chú thích ở
// ./index.ts). Nó vẫn là hợp đồng nội bộ của gói và vẫn phải có test, nên import THẲNG từ
// module — đúng thứ mà mã ngoài gói không làm được.
import { hasPermission } from "./rbac.js";

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

        // [vòng fix 1 — M2] INSERT cũng phải bị chặn, và trước vòng này chỉ `role_permissions`
        // được đo. Phủ không đều là một lỗ ĐO ĐƯỢC ở tầng đột biến: một
        // `GRANT INSERT ON roles TO app_api` cắm vào 005 SỐNG SÓT qua toàn bộ bộ test. Và nó
        // không vô hại — chèn được vào `roles` là tạo được một vai trò mà `role_permissions`
        // sau đó tham chiếu tới, tức mở đúng trục (b) của D3 từ một hướng khác.
        const cauChen: Record<string, string> = {
          permissions: "INSERT INTO public.permissions (code, description) VALUES ('x.y', 'z')",
          roles: "INSERT INTO public.roles (code, name) VALUES ('KE_GIAN', 'ke gian')",
          role_permissions:
            "INSERT INTO public.role_permissions (role_code, permission_code) VALUES ('BUYER', 'audit.read')",
        };
        await expect(c.query(cauChen[bang]!)).rejects.toMatchObject({ code: "42501" });
      } finally {
        c.release();
      }
    });
  }

  // [vòng fix 1 — V1-M14] LỖ PHỦ ĐO ĐƯỢC BẰNG ĐỘT BIẾN KẾT HỢP. Trước test này, vô hiệu hoá
  // THÂN trigger mức VAI TRÒ ở CẢ HAI lớp cùng lúc (005_identity.sql `$tmt$` và hằng
  // THAN_MA_TRAN của hardening.always.sql) SỐNG SÓT qua toàn bộ 215 test tích hợp: meta-test
  // §R3 chỉ so hai bản với NHAU nên một đột biến ĐỐI XỨNG đi lọt, và không test HÀNH VI nào
  // từng bắt trigger ấy phải NÉM. Mọi test D3 hiện có đo trigger mức NGƯỜI DÙNG, hoặc đo GRANT
  // (42501 vì thiếu quyền bảng) — hai thứ khác hẳn.
  //
  // Chạy dưới SUPERUSER là CỐ Ý và cần thiết: app_api không có INSERT trên bảng này (đúng thiết
  // kế), nên mọi lời gọi của app_api dừng ở tầng GRANT và KHÔNG BAO GIỜ chạm tới trigger. Muốn
  // đo trigger thì phải qua được lớp quyền trước.
  it("[INV-D3] trigger mức VAI TRÒ NÉM khi một vai trò sắp ôm trọn chuỗi", async () => {
    const chuoi = [...SEPARATION_OF_DUTIES_CHAIN];
    const bonBuoc = chuoi.slice(0, 4);
    const buocCuoi = chuoi[4]!;
    const { rows: truoc } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM role_permissions",
    );
    try {
      // (a) CHỐNG RỖNG RUỘT: bốn bước đầu đi lọt, nên "ném" ở (b) là do TRỌN CHUỖI chứ không
      //     phải vì mọi INSERT vào bảng này đều hỏng.
      await expect(
        db.pool.query(
          `INSERT INTO role_permissions (role_code, permission_code)
           SELECT 'TECHNICAL', t.ma FROM unnest($1::text[]) AS t(ma)`,
          [bonBuoc],
        ),
      ).resolves.toBeDefined();

      // (b) Bước thứ NĂM làm TECHNICAL ôm trọn chuỗi -> trigger phải ném.
      const loi = await db.pool
        .query("INSERT INTO role_permissions (role_code, permission_code) VALUES ('TECHNICAL', $1)", [
          buocCuoi,
        ])
        .then(
          () => null,
          (e: unknown) => e as { code?: string; message?: string },
        );
      expect(loi, "trigger mức vai trò KHÔNG ném — thân hàm đã bị vô hiệu hoá").not.toBeNull();
      expect(loi?.code).toBe("42501");
      expect(loi?.message).toContain("Phân tách nhiệm vụ (D3)");
      expect(loi?.message).toContain("TECHNICAL");
    } finally {
      await db.pool.query(
        "DELETE FROM role_permissions WHERE role_code = 'TECHNICAL' AND permission_code = ANY($1::text[])",
        [chuoi],
      );
    }
    // Ma trận phải trở lại NGUYÊN TRẠNG — test này dùng chung CSDL với cả file.
    const { rows: sau } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM role_permissions",
    );
    expect(sau[0]!.n).toBe(truoc[0]!.n);
  });

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
        "INSERT INTO users (org_id, email, full_name, status) VALUES " +
          "($1, 'buyer@a.com', 'Buyer', 'ACTIVE'), " +
          "($1, 'dinhchi@a.com', 'Dinh chi', 'SUSPENDED') RETURNING id",
        [org],
      );
      const buyer = u[0]!.id;
      const nguoiDinhChi = u[1]!.id;
      await dbRieng.pool.query(
        "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER'), ($1, $3, 'DIRECTOR')",
        [org, buyer, nguoiDinhChi],
      );

      // Schema thù địch. [vòng fix 2 — MỤC E] Bản trước chỉ che `role_permissions`, nên hai
      // trong ba tên bảng của `hasPermission` KHÔNG được đo và mũi đột biến "bỏ `public.` khỏi
      // `user_roles`" SỐNG SÓT. Nay che CẢ BA tên bảng mà truy vấn nhắc tới, mỗi bảng bóng mang
      // một đường leo thang KHÁC NHAU, để mỗi tên bảng có mốc chết riêng.
      await dbRieng.pool.query("CREATE SCHEMA doc; GRANT USAGE ON SCHEMA doc TO PUBLIC");
      await dbRieng.pool.query(
        "CREATE TABLE doc.role_permissions (role_code text, permission_code text); " +
          "INSERT INTO doc.role_permissions VALUES ('BUYER', 'rfq.unseal'); " +
          "GRANT SELECT ON doc.role_permissions TO PUBLIC",
      );
      // `doc.user_roles` KHÔNG có RLS: nó cấp thẳng DIRECTOR cho BUYER, tức mở đúng đường mà
      // vế nối `public.user_roles` chịu lực (cô lập tổ chức + tập vai trò thật).
      // Tham số + nhiều câu lệnh trong MỘT query() là "cannot insert multiple commands into a
      // prepared statement" — tách ra, đừng nội suy chuỗi.
      await dbRieng.pool.query(
        "CREATE TABLE doc.user_roles (org_id uuid, user_id uuid, role_code text)",
      );
      await dbRieng.pool.query("INSERT INTO doc.user_roles VALUES ($1, $2, 'DIRECTOR')", [
        org,
        buyer,
      ]);
      await dbRieng.pool.query("GRANT SELECT ON doc.user_roles TO PUBLIC");
      // `doc.users` khai người ĐANG BỊ ĐÌNH CHỈ là ACTIVE — đường leo thang riêng của vế
      // `JOIN public.users`, thứ mà một bảng bóng `user_roles`/`role_permissions` không chạm tới.
      await dbRieng.pool.query("CREATE TABLE doc.users (id uuid, org_id uuid, status text)");
      await dbRieng.pool.query(
        "INSERT INTO doc.users VALUES ($1, $2, 'ACTIVE'), ($3, $2, 'ACTIVE')",
        [buyer, org, nguoiDinhChi],
      );
      await dbRieng.pool.query("GRANT SELECT ON doc.users TO PUBLIC");
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
        const bicuop = await poolThuDich.query<{
          tran: number;
          du: number;
          ur_tran: number;
          ur_du: number;
          us_tran: number;
          us_du: number;
        }>(
          "SELECT (SELECT count(*)::int FROM role_permissions WHERE role_code = 'BUYER' " +
            "          AND permission_code = 'rfq.unseal') AS tran, " +
            "       (SELECT count(*)::int FROM public.role_permissions WHERE role_code = 'BUYER' " +
            "          AND permission_code = 'rfq.unseal') AS du, " +
            "       (SELECT count(*)::int FROM user_roles WHERE role_code = 'DIRECTOR' " +
            "          AND user_id = $1) AS ur_tran, " +
            "       (SELECT count(*)::int FROM public.user_roles WHERE role_code = 'DIRECTOR' " +
            "          AND user_id = $1) AS ur_du, " +
            "       (SELECT count(*)::int FROM users WHERE id = $2 AND status = 'ACTIVE') AS us_tran, " +
            "       (SELECT count(*)::int FROM public.users WHERE id = $2 AND status = 'ACTIVE') AS us_du",
          [buyer, nguoiDinhChi],
        );
        expect(bicuop.rows[0]!.tran, "role_permissions TRẦN không bị cướp — phép đo rỗng ruột").toBe(1);
        expect(bicuop.rows[0]!.du, "role_permissions ĐỦ SCHEMA lại bị cướp — phép đo rỗng ruột").toBe(0);
        expect(bicuop.rows[0]!.ur_tran, "user_roles TRẦN không bị cướp — phép đo rỗng ruột").toBe(1);
        expect(bicuop.rows[0]!.ur_du, "user_roles ĐỦ SCHEMA lại bị cướp — phép đo rỗng ruột").toBe(0);
        expect(bicuop.rows[0]!.us_tran, "users TRẦN không bị cướp — phép đo rỗng ruột").toBe(1);
        expect(bicuop.rows[0]!.us_du, "users ĐỦ SCHEMA lại bị cướp — phép đo rỗng ruột").toBe(0);

        // Và đây là điều phải đúng: hasPermission viết tên ĐỦ SCHEMA nên nó KHÔNG bị cướp.
        // Vế này chết nếu `role_permissions` HOẶC `user_roles` mất `public.`.
        expect(
          await withTenant(poolThuDich, org, (c) =>
            hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.RFQ_UNSEAL }),
          ),
        ).toBe(false);
        // [vòng fix 2 — MỤC E] Mốc chết riêng của vế `JOIN public.users`: `doc.users` khai người
        // bị đình chỉ là ACTIVE, nên bỏ `public.` khỏi ĐÚNG vế đó là người SUSPENDED duyệt được
        // PO. Không có vế này, mũi đột biến đó sống sót.
        expect(
          await withTenant(poolThuDich, org, (c) =>
            hasPermission(c, {
              userId: nguoiDinhChi,
              orgId: org,
              permission: PERMISSIONS.PO_APPROVE,
            }),
          ),
          "người SUSPENDED duyệt được PO nhờ một bảng `users` bóng",
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

// ==============================================================================================
// [vòng fix 1 — A3b] TẦNG CSDL HÔM NAY CHO PHÉP MỘT NGƯỜI DÙNG TỰ GÁN VAI TRÒ CHO CHÍNH MÌNH
//
// 005_identity.sql cấp app_api `INSERT (org_id, user_id, role_code)` + `DELETE` trên `user_roles`
// với lý do "là việc của ứng dụng" — một câu đọc như thể có phép kiểm quyền chắn ở đó. Test này
// ĐO trạng thái thật, và nó CỐ Ý khẳng định rằng khe hở CÒN MỞ: nếu ai đó sau này đóng nó (thêm
// một trigger, hoặc thu hồi GRANT), test này đỏ và người đó phải cập nhật cả khối [A3b] ở 005.
// Đó là mục đích — một khe hở có tên không được phép biến mất khỏi hồ sơ trong im lặng.
// ==============================================================================================
describe("[A3b] tự nâng quyền qua user_roles", () => {
  it("một người dùng thường TỰ GÁN được vai trò cho mình — khe hở CÒN MỞ, có chủ ý ghi ra", async () => {
    const { rows: u } = await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'a3b@a.com', 'A3b') RETURNING id",
      [orgId],
    );
    const nan = u[0]!.id;
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [
      orgId,
      nan,
    ]);

    // ĐỐI CHỨNG TRƯỚC: trigger D3 KHÔNG rỗng ruột — tổ hợp làm trọn chuỗi vẫn bị chặn.
    await expect(
      withTenant(apiPool, orgId, (c) =>
        c.query("INSERT INTO public.user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DIRECTOR')", [
          orgId,
          nan,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    // VÀ ĐÂY LÀ KHE HỞ: một tổ hợp KHÔNG trọn chuỗi đi lọt, và nó mua đúng những quyền nặng nhất.
    await expect(
      withTenant(apiPool, orgId, (c) =>
        c.query("INSERT INTO public.user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'FINANCE')", [
          orgId,
          nan,
        ]),
      ),
    ).resolves.toBeDefined();

    for (const quyen of [PERMISSIONS.PO_APPROVE, PERMISSIONS.AUDIT_READ, PERMISSIONS.BID_VIEW]) {
      expect(
        await withTenant(apiPool, orgId, (c) => hasPermission(c, { userId: nan, orgId, permission: quyen })),
        `sau khi tự gán FINANCE, người dùng vừa tự cấp cho mình quyền ${quyen}`,
      ).toBe(true);
    }

    // Và từ vựng để VIẾT được cổng gác nay đã có, mặc định fail-CLOSED (chưa vai trò nào giữ nó).
    expect(
      await withTenant(apiPool, orgId, (c) =>
        hasPermission(c, { userId: nan, orgId, permission: PERMISSIONS.ROLE_GRANT }),
      ),
    ).toBe(false);
    expect(
      await withTenant(apiPool, orgId, (c) =>
        hasPermission(c, { userId: uid("DIRECTOR"), orgId, permission: PERMISSIONS.ROLE_GRANT }),
      ),
    ).toBe(false);
  });
});

describe("[vòng fix 1] mặt tiền requirePermission", () => {
  it("[F7] resourceType KHÔNG phải mã định danh viết hoa thì bị TỪ CHỐI trước khi chạm CSDL", async () => {
    // Cột `resource_type` đi thẳng vào sổ chỉ-ghi-thêm và nằm vĩnh viễn trong chuỗi băm. Trước
    // vòng này nó là chuỗi TỰ DO: một chuỗi mang giá chào thầu và một mã OTP đi lọt trọn vẹn.
    for (const xau of [
      "Bao gia 1.500.000 VND cua NCC A",
      "OTP 448120 cho phien mo thau",
      "rfq",
      "RFQ; DROP TABLE",
      "",
      "A".repeat(65),
    ]) {
      await expect(
        withTenant(apiPool, orgId, (c) =>
          requirePermission(
            c,
            { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: xau },
            auditPool,
          ),
        ),
      ).rejects.toThrow(/resourceType phải là MÃ ĐỊNH DANH/);
    }

    // Đối chứng: hình dạng hợp lệ vẫn đi tới đúng lớp lỗi cũ (từ chối quyền), không bị chặn oan.
    for (const tot of ["RFQ", "PURCHASE_ORDER", "A", "A".repeat(64)]) {
      await expect(
        withTenant(apiPool, orgId, (c) =>
          requirePermission(
            c,
            { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: tot },
            auditPool,
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    }

    // Và phép kiểm phải chạy CẢ trên đường CHO QUA — nếu chỉ kiểm ở nhánh từ chối thì một lời
    // gọi sai hình dạng chỉ lộ ra khi tình cờ có người thiếu quyền.
    await expect(
      withTenant(apiPool, orgId, (c) =>
        requirePermission(
          c,
          {
            userId: uid("DIRECTOR"),
            orgId,
            permission: PERMISSIONS.RFQ_UNSEAL,
            resourceType: "gia 1500000",
          },
          auditPool,
        ),
      ),
    ).rejects.toThrow(/resourceType phải là MÃ ĐỊNH DANH/);
  });

  it("[F7] thông báo lỗi KHÔNG nội suy giá trị bị từ chối — cấm log giá/OTP", async () => {
    const bimat = "OTP 448120 gia 1500000";
    const loi = await withTenant(apiPool, orgId, (c) =>
      requirePermission(
        c,
        { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: bimat },
        auditPool,
      ),
    ).catch((e: Error) => e);
    expect(loi).toBeInstanceOf(Error);
    expect((loi as Error).message).not.toContain("448120");
    expect((loi as Error).message).not.toContain("1500000");
  });

  it("[F9] auditPool chạy dưới role SUPERUSER bị TỪ CHỐI, không nhận im lặng", async () => {
    // db.pool là pool superuser của Testcontainers. Trước vòng này nó được nhận không một tiếng
    // động, và một kết nối superuser BỎ QUA cả RLS lẫn FORCE RLS — tức vế WITH CHECK trên
    // audit_events không còn cưỡng chế gì trên đúng đường ghi sổ.
    const loi = await withTenant(apiPool, orgId, (c) =>
      requirePermission(
        c,
        { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: "RFQ" },
        db.pool,
      ),
    ).catch((e: Error) => e);
    expect(loi).toBeInstanceOf(PermissionAuditFailedError);
    expect((loi as Error).message).toMatch(/SUPERUSER|BYPASSRLS/);
    // Fail-CLOSED: lần từ chối gốc vẫn được giữ nguyên bên trong.
    expect((loi as PermissionAuditFailedError).denial).toBeInstanceOf(PermissionDeniedError);
    // Đối chứng: cùng lời gọi với auditPool ĐÚNG quyền vẫn cho ra PermissionDeniedError.
    await expect(
      withTenant(apiPool, orgId, (c) =>
        requirePermission(
          c,
          { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: "RFQ" },
          auditPool,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("[MỤC E] tầng dưới ném thứ KHÔNG phải Error: nêu KIỂU, KHÔNG nội suy GIÁ TRỊ", async () => {
    // Bản vá M4 của vòng fix 1 đóng một lỗ thật ("cause.message === undefined" làm thông báo
    // thành "...: undefined") nhưng đóng nó bằng `String(loi)`, tức nội suy chính giá trị lạ
    // vào một thông báo ĐI VÀO LOG — mâu thuẫn với kỷ luật F7 viết cách đó ~40 dòng trong cùng
    // file ("cố ý KHÔNG nội suy giá trị nhận được: nó có thể chính là thứ không được phép ghi
    // ra"). Bán kính nhỏ (chỉ giá trị do pg/withTenant/mã người gọi ném) nhưng cùng một lớp.
    //
    // Fixture: một `auditPool` GIẢ ném một chuỗi nguyên thuỷ mang đúng thứ bị cấm log. Nó phải
    // đi lọt qua `khangDinhGhiDuocDocLap` (không cạn chỗ) rồi ném ở `khangDinhAuditPoolDungQuyen`.
    const biMat = "OTP 448120 token abc gia 1500000";
    const poolGia = {
      idleCount: 1,
      totalCount: 0,
      options: { max: 5 },
      waitingCount: 0,
      query: (): never => {
        // CỐ Ý ném thứ KHÔNG phải Error — đó chính là ca đang được đo, nên quy tắc lint
        // only-throw-error phải được tắt ĐÚNG một dòng ở đây chứ không nới ở cấu hình.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw biMat;
      },
    } as unknown as pg.Pool;

    const loi = await withTenant(apiPool, orgId, (c) =>
      requirePermission(
        c,
        { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL, resourceType: "RFQ" },
        poolGia,
      ),
    ).catch((e: unknown) => e);

    expect(loi).toBeInstanceOf(PermissionAuditFailedError);
    const thongDiep = (loi as Error).message;
    // (a) Thứ M4 THẬT SỰ mua được vẫn còn: chẩn đoán KHÔNG phải "undefined".
    expect(thongDiep).not.toMatch(/undefined/);
    expect(thongDiep).toMatch(/typeof = string/);
    // (b) Và giá trị lạ KHÔNG nằm trong thông báo — kể cả từng mảnh của nó.
    expect(thongDiep).not.toContain(biMat);
    for (const manh of ["448120", "1500000", "token abc"]) {
      expect(thongDiep, `mảnh "${manh}" lọt vào thông báo đi log`).not.toContain(manh);
    }
    // (c) Fail-CLOSED không đổi, và giá trị gốc vẫn tới được người điều tra qua chuỗi `cause`.
    expect((loi as PermissionAuditFailedError).denial).toBeInstanceOf(PermissionDeniedError);
    expect(((loi as Error).cause as Error | undefined)?.cause).toBe(biMat);
  });
});

// ==============================================================================================
// [vòng fix 1 — C1] KHE HỞ TRỤC (b): SỬA `role_permissions` LÀM MỘT NGƯỜI ĐANG CÓ SẴN NẮM TRỌN
// CHUỖI, VÀ KHÔNG TRIGGER NÀO BẮN
//
// Test này CỐ Ý khẳng định rằng khe hở CÒN TỒN TẠI ở tầng CSDL. Nó không phải một test hồi quy
// cho một bản vá — nó là HỒ SƠ ĐO ĐƯỢC của một dư lượng có tên, để không ai sau này im lặng
// tuyên bố D3 đã được cưỡng chế đầy đủ. Nếu ai đó đóng được khe hở này (một trigger nhìn thấy
// dữ liệu, một lớp mới), test này đỏ và người đó phải cập nhật khối "[vòng fix 1 — C1]" ở
// 005_identity.sql §(3), hằng THAN_MA_TRAN và mục (E2)/(E3) của hardening.always.sql.
//
// Đồng thời nó đo lớp DUY NHẤT có mặt ở thời điểm deploy — mục (E3) — và đo cả hai mặt của nó:
// im lặng trên ma trận đúng, và phát WARNING trên ma trận đã bị sửa.
// ==============================================================================================
describe("[C1-KHE-HỞ] trục thứ hai của D3", () => {
  /** Số bước của chuỗi D3 mà `userId` với tới được, đếm bằng SUPERUSER. */
  async function demBuoc(dbRieng: TestDatabase, userId: string): Promise<number> {
    const { rows } = await dbRieng.pool.query<{ n: string }>(
      `SELECT count(DISTINCT rp.permission_code)::text AS n
         FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code
        WHERE ur.user_id = $1 AND rp.permission_code = ANY($2::text[])`,
      [userId, [...SEPARATION_OF_DUTIES_CHAIN]],
    );
    return Number(rows[0]?.n ?? "0");
  }

  /** Chạy lượt PHÁN XÉT của hardening.always.sql và gom mọi WARNING nó phát ra. */
  async function warningCuaLuotPhanXet(dbRieng: TestDatabase): Promise<string[]> {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(`${MIGRATIONS}/hardening.always.sql`, "utf8");
    const c = await dbRieng.pool.connect();
    const canhBao: string[] = [];
    const nghe = (n: { message?: string }): void => {
      canhBao.push(n.message ?? "");
    };
    c.on("notice", nghe);
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_catalog.set_config('app.hardening_che_do', 'phan_xet', true)");
      await c.query(sql);
      await c.query("COMMIT");
    } finally {
      c.off("notice", nghe);
      c.release();
    }
    return canhBao;
  }

  it("thêm MỘT quyền cho MỘT vai trò làm một người sẵn có nắm trọn chuỗi — không lớp CSDL nào chặn", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      const { rows: o } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('C1', 'c1') RETURNING id",
      );
      const org = o[0]!.id;
      const { rows: u } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'c1@a.com', 'C1') RETURNING id",
        [org],
      );
      const nan = u[0]!.id;

      // BUYER + FINANCE = 4/5. Hợp lệ hôm nay, và trigger mức người dùng CHO QUA — đúng thiết kế.
      await dbRieng.pool.query(
        "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1,$2,'BUYER'),($1,$2,'FINANCE')",
        [org, nan],
      );
      expect(await demBuoc(dbRieng, nan), "tiền đề: người này CHƯA trọn chuỗi").toBe(4);

      // Lượt phán xét trên ma trận ĐÚNG phải IM LẶNG về D3 — chống rỗng ruột cho khẳng định sau.
      expect(
        (await warningCuaLuotPhanXet(dbRieng)).filter((m) => m.includes("(E3)")),
        "trên ma trận mặc định, mục (E3) không được kêu — nếu kêu thì mốc ghim đã sai",
      ).toEqual([]);

      // TRỤC (b): thêm ĐÚNG MỘT hàng vào role_permissions. Đây là đường "sửa bằng một migration
      // đánh số MỚI" mà chính 005 tuyên bố là đường an toàn duy nhất.
      await expect(
        dbRieng.pool.query(
          "INSERT INTO role_permissions (role_code, permission_code) VALUES ('FINANCE', 'rfq.unseal')",
        ),
        "trigger mức VAI TRÒ không bắn: FINANCE riêng lẻ vẫn chưa ôm trọn chuỗi",
      ).resolves.toBeDefined();

      // Đối chứng chống rỗng ruột cho câu trên: FINANCE riêng lẻ THẬT SỰ chưa trọn chuỗi.
      const { rows: rieng } = await dbRieng.pool.query<{ n: string }>(
        `SELECT count(DISTINCT permission_code)::text AS n FROM role_permissions
          WHERE role_code = 'FINANCE' AND permission_code = ANY($1::text[])`,
        [[...SEPARATION_OF_DUTIES_CHAIN]],
      );
      expect(Number(rieng[0]!.n)).toBeLessThan(SEPARATION_OF_DUTIES_CHAIN.length);

      // VÀ NGƯỜI KIA GIỜ NẮM TRỌN CHUỖI.
      expect(await demBuoc(dbRieng, nan), "D3 đã bị phá").toBe(SEPARATION_OF_DUTIES_CHAIN.length);

      const poolRieng = dbRieng.poolAs("app_api");
      try {
        for (const quyen of SEPARATION_OF_DUTIES_CHAIN) {
          expect(
            await withTenant(poolRieng, org, (c) =>
              hasPermission(c, { userId: nan, orgId: org, permission: quyen }),
            ),
            `tầng ứng dụng cũng trả lời "có" cho ${quyen}`,
          ).toBe(true);
        }
      } finally {
        await poolRieng.end();
      }

      // migrate() ĐẦY ĐỦ chạy lại: KHÔNG NÉM, và vi phạm VẪN CÒN. Đây là mặt fail-open của (E2).
      await expect(migrate(dbRieng.pool, MIGRATIONS)).resolves.toBeDefined();
      expect(await demBuoc(dbRieng, nan), "sau migrate() đầy đủ vẫn còn nguyên").toBe(
        SEPARATION_OF_DUTIES_CHAIN.length,
      );

      // LỚP DUY NHẤT NHÌN THẤY: mục (E3) — và nó CHỈ phát WARNING, đúng như đã ghi.
      const canhBao = (await warningCuaLuotPhanXet(dbRieng)).filter((m) => m.includes("(E3)"));
      expect(canhBao.length, "mục (E3) phải kêu lên").toBe(1);
      expect(canhBao[0]).toContain("BUYER+FINANCE");
      expect(canhBao[0]).toContain("PHÂN TÁCH NHIỆM VỤ (D3)");

      // ĐỐI CHỨNG: trigger mức NGƯỜI DÙNG vẫn sống và vẫn có răng trên đường THẲNG.
      const { rows: u2 } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'c1b@a.com', 'C1b') RETURNING id",
        [org],
      );
      await dbRieng.pool.query(
        "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1,$2,'PROCUREMENT_MANAGER')",
        [org, u2[0]!.id],
      );
      await expect(
        dbRieng.pool.query(
          "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1,$2,'DIRECTOR')",
          [org, u2[0]!.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await dbRieng.stop();
    }
  }, 300_000);

  it("[F2] MỘT VAI TRÒ ôm trọn chuỗi NẰM SẴN đi qua migrate() im lặng — chỉ (E3) thấy", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      // Gỡ trigger để mô phỏng "vi phạm đã nằm sẵn từ trước khi lớp canh tồn tại", rồi để
      // migrate() dựng lại trigger. Đây đúng là khuôn nâng cấp một cụm đang chạy.
      await dbRieng.pool.query("DROP TRIGGER role_permissions_ma_tran_quyen ON role_permissions");
      await dbRieng.pool.query(
        `INSERT INTO role_permissions (role_code, permission_code)
         SELECT 'TECHNICAL', t.ma FROM unnest($1::text[]) AS t(ma)
          WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp
                             WHERE rp.role_code = 'TECHNICAL' AND rp.permission_code = t.ma)`,
        [[...SEPARATION_OF_DUTIES_CHAIN]],
      );

      await expect(migrate(dbRieng.pool, MIGRATIONS)).resolves.toBeDefined();

      // Trigger được dựng lại ĐÚNG CHUẨN...
      const { rows: tg } = await dbRieng.pool.query<{ tgenabled: string }>(
        `SELECT tgenabled FROM pg_trigger
          WHERE tgrelid = 'public.role_permissions'::regclass
            AND tgname = 'role_permissions_ma_tran_quyen'`,
      );
      expect(tg[0]?.tgenabled, "ENABLE ALWAYS được dựng lại").toBe("A");

      // ...mà vi phạm VẪN NGUYÊN. Đó là phạm vi thật của (E2): hàng MỚI, không phải hàng cũ.
      const { rows: con } = await dbRieng.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM role_permissions
          WHERE role_code = 'TECHNICAL' AND permission_code = ANY($1::text[])`,
        [[...SEPARATION_OF_DUTIES_CHAIN]],
      );
      expect(Number(con[0]!.n)).toBe(SEPARATION_OF_DUTIES_CHAIN.length);

      const canhBao = (await warningCuaLuotPhanXet(dbRieng)).filter((m) => m.includes("(E3)"));
      expect(canhBao.length, "mục (E3) là lớp deploy-time DUY NHẤT thấy hàng cũ").toBe(1);
      // Phủ ĐƠN LẺ hiện ra dưới dạng cặp (X, X) — xem lập luận `r1.code <= r2.code` ở (E3).
      expect(canhBao[0]).toContain("TECHNICAL+TECHNICAL");
    } finally {
      await dbRieng.stop();
    }
  }, 300_000);
});

// ==============================================================================================
// [vòng fix 1 — F3] TOÁN TỬ `=` CƯỚP ĐƯỢC, VÀ THỨ ĐANG CHẶN KHÔNG PHẢI THỨ §7.5 CŨ NÓI
//
// Test "[QT3] bảng bị che" ở trên đo trục TÊN BẢNG. Trục TOÁN TỬ là một trục KHÁC và nặng hơn:
// một `=` bị cướp làm MỌI vế so sánh trả `true`, tức `hasPermission` trả `true` cho MỌI quyền
// của MỌI người. Test này dựng đúng kịch bản phản chứng mà reviewer an ninh đo được — GHIM
// `search_path` cho `app_current_org_id()`, đúng thứ QT3 khuyến khích — và khẳng định rằng nhờ
// `OPERATOR(pg_catalog.=)`, D1 KHÔNG còn phụ thuộc vào tính chất tình cờ `proconfig IS NULL`.
//
// [vòng fix 2 — MỤC B] FIXTURE CŨ CHỈ CHỊU ĐƯỢC 2/5 MŨI ĐỘT BIẾN, VÀ ĐÓ LÀ LỖI CỦA FIXTURE
// CHỨ KHÔNG PHẢI CỦA PHÉP KHẲNG ĐỊNH. Bản trước có ĐÚNG một tổ chức, MỘT người dùng, MỘT vai
// trò. `hasPermission` có NĂM vế `=`; ba trong năm vế đó chỉ phân biệt được khi có NHIỀU HƠN
// một người và NHIỀU HƠN một trạng thái, nên gỡ `OPERATOR(pg_catalog.=)` khỏi chúng vẫn cho
// kết quả y hệt và mũi đột biến SỐNG SÓT. Đo lại trên fixture ba người ở dưới, mỗi vế một mũi:
//     nguyên bản (HEAD):          A/po.approve=false  S/po.approve=false  B/po.approve=true
//     `WHERE ur.user_id` trần:    A/po.approve=TRUE   S/po.approve=TRUE      <- D1 SỤP
//     `u.status` trần:            S/po.approve=TRUE                 <- người ĐÌNH CHỈ có quyền
//     `JOIN users.id` trần:       S/po.approve=TRUE
//     `rp.role_code` trần:        A/po.approve=TRUE
//     `rp.permission_code` trần:  A/po.approve=TRUE
// Ba trục mà fixture phải mang, vì mỗi trục khoá một vế khác nhau:
//     A = REQUESTER, ACTIVE     — người YẾU: bắt mọi vế làm rò quyền của người khác sang A
//     B = DIRECTOR,  ACTIVE     — người MẠNH: đối chứng dương, giữ phép đo khỏi rỗng ruột
//     S = DIRECTOR,  SUSPENDED  — người BỊ ĐÌNH CHỈ: khoá riêng vế `u.status`
// ==============================================================================================
describe("[QT3] hasPermission dưới TOÁN TỬ thù địch", () => {
  it("[INV-D1] `=` bị cướp KHÔNG cấp thêm quyền nào, kể cả khi app_current_org_id() đã ghim search_path", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      const { rows: o } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('F3', 'f3') RETURNING id",
      );
      const org = o[0]!.id;
      const { rows: u } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name, status) VALUES " +
          "($1, 'f3@a.com', 'F3 buyer', 'ACTIVE'), " +
          "($1, 'yeu@a.com', 'A yeu', 'ACTIVE'), " +
          "($1, 'manh@a.com', 'B manh', 'ACTIVE'), " +
          "($1, 'dinhchi@a.com', 'S dinh chi', 'SUSPENDED') RETURNING id",
        [org],
      );
      const buyer = u[0]!.id;
      const nguoiYeu = u[1]!.id;
      const nguoiManh = u[2]!.id;
      const nguoiDinhChi = u[3]!.id;
      for (const [nguoi, vai] of [
        [buyer, "BUYER"],
        [nguoiYeu, "REQUESTER"],
        [nguoiManh, "DIRECTOR"],
        [nguoiDinhChi, "DIRECTOR"],
      ] as const) {
        await dbRieng.pool.query(
          "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)",
          [org, nguoi, vai],
        );
      }
      // Tiền đề của cả ba trục, khẳng định thay vì giả định: DIRECTOR giữ `po.approve`,
      // REQUESTER thì KHÔNG. Nếu ma trận quyền đổi, test này phải đỏ ở đây chứ không ở dưới.
      const { rows: tienDe } = await dbRieng.pool.query<{ director: number; requester: number }>(
        "SELECT count(*) FILTER (WHERE role_code = 'DIRECTOR')::int AS director, " +
          "       count(*) FILTER (WHERE role_code = 'REQUESTER')::int AS requester " +
          "  FROM role_permissions WHERE permission_code = 'po.approve'",
      );
      expect(tienDe[0]!.director, "DIRECTOR phải giữ po.approve").toBe(1);
      expect(tienDe[0]!.requester, "REQUESTER KHÔNG được giữ po.approve").toBe(0);
      const { rows: tt } = await dbRieng.pool.query<{ status: string }>(
        "SELECT status FROM users WHERE id = $1",
        [nguoiDinhChi],
      );
      expect(tt[0]!.status, "người bị đình chỉ phải THẬT SỰ mang SUSPENDED").toBe("SUSPENDED");

      await dbRieng.pool.query("CREATE SCHEMA doc; GRANT USAGE ON SCHEMA doc TO PUBLIC");
      for (const kieu of ["uuid", "text"]) {
        await dbRieng.pool.query(
          `CREATE FUNCTION doc.luon_dung_${kieu}(${kieu}, ${kieu}) RETURNS boolean
             LANGUAGE sql IMMUTABLE AS 'SELECT true'`,
        );
        await dbRieng.pool.query(
          `CREATE OPERATOR doc.= (LEFTARG=${kieu}, RIGHTARG=${kieu}, FUNCTION=doc.luon_dung_${kieu})`,
        );
      }
      await dbRieng.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk' IN ROLE app_api");
      // `pg_catalog` NÊU TÊN ở vị trí SAU. Nếu không nêu, nó được tìm NGẦM TRƯỚC và toán tử
      // KHÔNG cướp được (đã đo) — vế `bicuop` dưới đây khoá đúng tiền đề đó.
      await dbRieng.pool.query(
        "ALTER ROLE app_api_login SET search_path = doc, pg_catalog, public",
      );

      const url = new URL(dbRieng.connectionString);
      url.username = "app_api_login";
      url.password = "mk";
      const poolThuDich = createPool(url.toString(), 2);
      try {
        // FIXTURE PHẢI CHỨNG MINH NÓ TẤN CÔNG ĐƯỢC. Không có vế này, mọi khẳng định dưới đây
        // xanh kể cả khi schema `doc` hoàn toàn vô hại.
        const bicuop = await poolThuDich.query<{ cuop: boolean; du: boolean }>(
          "SELECT ('11111111-1111-1111-1111-111111111111'::uuid " +
            "        = '22222222-2222-2222-2222-222222222222'::uuid) AS cuop, " +
            "       ('11111111-1111-1111-1111-111111111111'::uuid " +
            "        OPERATOR(pg_catalog.=) '22222222-2222-2222-2222-222222222222'::uuid) AS du",
        );
        expect(bicuop.rows[0]!.cuop, "toán tử TRẦN không bị cướp — phép đo rỗng ruột").toBe(true);
        expect(bicuop.rows[0]!.du, "toán tử ĐỦ SCHEMA lại bị cướp — phép đo rỗng ruột").toBe(false);

        const doBaQuyen = async (): Promise<boolean[]> =>
          withTenant(poolThuDich, org, async (c) => [
            await hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.PO_APPROVE }),
            await hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.RFQ_UNSEAL }),
            await hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.AUDIT_READ }),
          ]);

        // (a) Trạng thái HÔM NAY: `app_current_org_id()` KHÔNG ghim search_path, nên `NULLIF`
        //     bên trong nó phân giải `=` dưới search_path NGƯỜI GỌI; toán tử thù địch làm nó
        //     sập về NULL, RLS không thấy hàng nào, và `assertTenantBound` NÉM TRƯỚC khi truy
        //     vấn quyền chạy. Fail-CLOSED — nhưng là TÌNH CỜ, và đó chính là điều phải nói ra:
        //     lớp đang chịu lực ở nhánh này KHÔNG phải `hasPermission`.
        await expect(doBaQuyen()).rejects.toThrow(/phiên đang gắn tổ chức \(chưa gắn/);

        // (b) PHÉP ĐO PHẢN CHỨNG: ghim search_path cho app_current_org_id() — đúng thứ QT3
        //     khuyến khích và đúng thứ 005 đã làm cho hai hàm trigger D3. Trước bản vá
        //     `OPERATOR(pg_catalog.=)`, ba giá trị này là [true, true, true] và D1 sụp hoàn toàn.
        await dbRieng.pool.query(
          "ALTER FUNCTION public.app_current_org_id() SET search_path = pg_catalog",
        );
        try {
          const { rows: pc } = await dbRieng.pool.query<{ p: string | null }>(
            "SELECT array_to_string(proconfig, ',') AS p FROM pg_proc " +
              "WHERE oid = 'public.app_current_org_id()'::regprocedure",
          );
          expect(pc[0]?.p, "tiền đề của phép đo phản chứng phải THẬT SỰ được đặt").toBe(
            "search_path=pg_catalog",
          );
          expect(await doBaQuyen()).toEqual([false, false, false]);
          // Đối chứng: quyền THẬT vẫn đọc đúng, nên "false" ở trên không phải vì truy vấn hỏng.
          expect(
            await withTenant(poolThuDich, org, (c) =>
              hasPermission(c, { userId: buyer, orgId: org, permission: PERMISSIONS.RFQ_CREATE }),
            ),
          ).toBe(true);

          // ============================================================================
          // [vòng fix 2 — MỤC B] BA TRỤC MÀ FIXTURE MỘT-NGƯỜI KHÔNG PHÂN BIỆT ĐƯỢC.
          // Mỗi khẳng định dưới đây là mốc chết của ÍT NHẤT một mũi đột biến "gỡ
          // OPERATOR(pg_catalog.=) khỏi đúng một vế"; cả năm vế đều có mốc chết.
          // ============================================================================
          const quyen = async (nguoi: string, ma: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) =>
            withTenant(poolThuDich, org, (c) =>
              hasPermission(c, { userId: nguoi, orgId: org, permission: ma }),
            );

          // TRỤC 1 — người YẾU không mượn được quyền của người khác. Khoá `WHERE ur.user_id`,
          // `rp.role_code` và `rp.permission_code`.
          expect(
            await quyen(nguoiYeu, PERMISSIONS.PO_APPROVE),
            "REQUESTER mượn được po.approve của DIRECTOR trong cùng tổ chức",
          ).toBe(false);
          expect(
            await quyen(nguoiYeu, PERMISSIONS.RFQ_UNSEAL),
            "REQUESTER mượn được rfq.unseal của DIRECTOR trong cùng tổ chức",
          ).toBe(false);

          // TRỤC 2 — người BỊ ĐÌNH CHỈ mất quyền ngay. Khoá `u.status` và `JOIN users.id`.
          expect(
            await quyen(nguoiDinhChi, PERMISSIONS.PO_APPROVE),
            "người SUSPENDED vẫn duyệt được PO",
          ).toBe(false);

          // TRỤC 3 — ĐỐI CHỨNG DƯƠNG. Không có vế này, cả khối trên xanh kể cả khi truy vấn
          // hỏng hoàn toàn và trả `false` cho mọi thứ.
          expect(
            await quyen(nguoiManh, PERMISSIONS.PO_APPROVE),
            "DIRECTOR ĐANG HOẠT ĐỘNG phải duyệt được PO — nếu vế này đỏ thì phép đo rỗng ruột",
          ).toBe(true);
        } finally {
          await dbRieng.pool.query("ALTER FUNCTION public.app_current_org_id() RESET search_path");
        }
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await dbRieng.stop();
    }
  }, 300_000);
});
