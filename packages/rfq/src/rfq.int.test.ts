import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  RfqError,
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createRfq,
  extendRfqDeadline,
  getRfq,
  listRfqItems,
  openRfq,
  submitRfqForApproval,
} from "./rfq.js";

// =============================================================================================
// S1.2 — MÁY TRẠNG THÁI RFQ, ĐO TRÊN POSTGRES THẬT DƯỚI ROLE `app_api`
//
// Mọi phép đo chạy qua `db.poolAs("app_api")`. Superuser BỎ QUA RLS (đã đo ở 002), nên một test
// cô lập tổ chức chạy dưới superuser xanh VÌ LÝ DO SAI.
//
// Phép đo quan trọng nhất của file này KHÔNG đi qua gói `rfq`: nó chạy `UPDATE` thẳng bằng SQL.
// Đó là điểm của ADR-014 — nếu máy trạng thái nằm ở TypeScript, một câu SQL trong script vận
// hành đi vòng qua nó mà không lớp nào kêu.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const ACTOR = { type: "SYSTEM" } as const;
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const MAI_SAU_XA = new Date(Date.now() + 14 * 24 * 3600 * 1000);

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;
/** u1 tạo RFQ; u2 và u3 là hai người duyệt. */
let u1: string, u2: string, u3: string;
/** s2/s3 là phiên của u2/u3; s2b là phiên THỨ HAI của u2. */
let s2: string, s3: string, s2b: string;

async function taoPhien(orgId: string, userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** RFQ ở DRAFT kèm một hạng mục — điểm xuất phát của hầu hết phép đo dưới đây. */
async function rfqNhap(orgId = orgA, requiresDualApproval = false): Promise<string> {
  return withTenant(apiPool, orgId, async (c) => {
    const r = await createRfq(c, orgId, {
      title: "Mua thep tam",
      deadlineAt: MAI_SAU,
      requiresDualApproval,
      createdBy: u1,
      actor: ACTOR,
    });
    await addRfqItem(c, orgId, {
      rfqId: r.id,
      lineNo: 1,
      description: "Thep tam SS400 3mm",
      quantity: "100.0000",
      unit: "tam",
      actor: ACTOR,
    });
    return r.id;
  });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);

  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
      "('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  orgB = orgs.rows[1]?.id ?? "";

  const users = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES " +
      "($1, 'u1@vidu.vn', 'Nguoi tao'), ($1, 'u2@vidu.vn', 'Nguoi duyet 1'), " +
      "($1, 'u3@vidu.vn', 'Nguoi duyet 2') RETURNING id",
    [orgA],
  );
  u1 = users.rows[0]?.id ?? "";
  u2 = users.rows[1]?.id ?? "";
  u3 = users.rows[2]?.id ?? "";

  s2 = await taoPhien(orgA, u2);
  s3 = await taoPhien(orgA, u3);
  s2b = await taoPhien(orgA, u2);

  expect([orgA, orgB, u1, u2, u3, s2, s3, s2b].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("máy trạng thái — cưỡng chế ở tầng CSDL, không ở tầng ứng dụng", () => {
  it("ĐI VÒNG QUA ỨNG DỤNG: `UPDATE ... SET status='OPEN'` trên RFQ đã CLOSED bị TRIGGER chặn", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
      await closeRfq(c, orgA, { rfqId, reason: "het han", actor: ACTOR });
    });

    // KHÔNG gọi hàm nào của gói `rfq`. Đây là phép đo duy nhất chứng minh lớp nằm ở CSDL.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN' WHERE id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/Chuyen trang thai RFQ khong hop le: CLOSED -> OPEN/);

    const sau = await withTenant(apiPool, orgA, (c) => getRfq(c, orgA, rfqId));
    expect(sau?.status).toBe("CLOSED");
  });

  it("ĐỐI CHỨNG ĐỘT BIẾN: gỡ trigger đi thì CHÍNH câu UPDATE ấy ĐI LỌT", async () => {
    // Không có phép đo này, test trên xanh kể cả khi thứ chặn là một thứ khác — một CHECK, một
    // quyền cột, hay một sự trùng hợp. Ở đây trigger bị gỡ, cùng câu lệnh chạy lại, và nó QUA.
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
      await closeRfq(c, orgA, { rfqId, reason: "het han", actor: ACTOR });
    });

    await db.pool.query("DROP TRIGGER rfq_packages_kiem_chuyen_trang_thai ON rfq_packages");
    try {
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN' WHERE id = $1", [rfqId]),
      );
      expect(
        rowCount,
        "Nếu câu này VẪN bị chặn sau khi gỡ trigger thì thứ đang chặn KHÔNG phải trigger, và " +
          "test ở trên đang đo nhầm đối tượng.",
      ).toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai BEFORE UPDATE ON rfq_packages " +
          "FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_chuyen_trang_thai()",
      );
      // Trả RFQ về CLOSED để không rò trạng thái sang test khác.
      await db.pool.query("UPDATE rfq_packages SET status = 'CLOSED' WHERE id = $1", [rfqId]);
    }
  });

  it("mọi cạnh HỢP LỆ đi được — đối chứng dương, chống quy tắc chặn-tất-cả", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
      await closeRfq(c, orgA, { rfqId, reason: "het han", actor: ACTOR });
      // Hai cạnh cuối chưa có hàm sản phẩm (S1.6 và S2), nên đo thẳng bằng SQL.
      await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
    });
    const sau = await withTenant(apiPool, orgA, (c) => getRfq(c, orgA, rfqId));
    expect(sau?.status).toBe("EVALUATING");
  });

  it("bỏ qua một bậc cũng bị chặn: DRAFT -> OPEN không phải một cạnh", async () => {
    const rfqId = await rfqNhap();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now() WHERE id = $1", [
          rfqId,
        ]),
      ),
    ).rejects.toThrow(/DRAFT -> OPEN/);
  });

  it("không mở được RFQ không có hạng mục nào", async () => {
    const rfqId = await withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, {
        title: "RFQ rong",
        deadlineAt: MAI_SAU,
        requiresDualApproval: false,
        createdBy: u1,
        actor: ACTOR,
      });
      await submitRfqForApproval(c, orgA, { rfqId: r.id, actor: ACTOR });
      return r.id;
    });

    await expect(
      withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actor: ACTOR })),
    ).rejects.toThrow(/khong co hang muc nao/);
  });
});

describe("D2 — phê duyệt kép ở phía RFQ", () => {
  it("RFQ cần hai phê duyệt KHÔNG mở được khi mới có một", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await approveRfq(c, orgA, { rfqId, approverUserId: u2, sessionId: s2, actor: ACTOR });
    });

    await expect(
      withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actor: ACTOR })),
    ).rejects.toThrow(/can 2 phe duyet, moi co 1/);

    // ... và mở được ngay khi có người thứ hai. Vế dương là bắt buộc: không có nó, một trigger
    // luôn từ chối cũng làm test trên xanh.
    await withTenant(apiPool, orgA, (c) =>
      approveRfq(c, orgA, { rfqId, approverUserId: u3, sessionId: s3, actor: ACTOR }),
    );
    const mo = await withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actor: ACTOR }));
    expect(mo.status).toBe("OPEN");
    expect(mo.openedAt).not.toBeNull();
  });

  it("người TẠO RFQ không được là một trong hai người duyệt", async () => {
    const rfqId = await rfqNhap(orgA, true);
    const s1 = await taoPhien(orgA, u1);
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, approverUserId: u1, sessionId: s1, actor: ACTOR }),
      ),
    ).rejects.toThrow(/Nguoi tao RFQ khong duoc la mot trong hai nguoi duyet/);
  });

  it("một người không duyệt được hai lần, kể cả từ hai phiên khác nhau", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await approveRfq(c, orgA, { rfqId, approverUserId: u2, sessionId: s2, actor: ACTOR });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, approverUserId: u2, sessionId: s2b, actor: ACTOR }),
      ),
    ).rejects.toThrow(/rfq_approvals_mot_nguoi_mot_lan|duplicate key/);
  });

  it("phiên được dẫn ra phải THUỘC VỀ người duyệt — mượn phiên của người khác bị chặn", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR }),
    );

    // u3 duyệt nhưng dẫn ra phiên của u2. Không có phép kiểm này, ràng buộc "hai phiên khác nhau"
    // chỉ đòi hai chuỗi uuid khác nhau và một người có hai phiên vẫn đi qua.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, approverUserId: u3, sessionId: s2, actor: ACTOR }),
      ),
    ).rejects.toThrow(/Phien duoc dan ra khong thuoc ve nguoi duyet/);
  });

  it("chỉ phê duyệt được RFQ đang ở PENDING_APPROVAL", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, approverUserId: u2, sessionId: s2, actor: ACTOR }),
      ),
    ).rejects.toThrow(/dang o PENDING_APPROVAL, RFQ nay dang DRAFT/);
  });
});

describe("C4 — deadline (phần cưỡng chế được ở S1.2)", () => {
  it("deadline KHÔNG lùi được, kể cả khi RFQ còn DRAFT — dạng MẠNH HƠN mệnh đề", async () => {
    const rfqId = await rfqNhap();
    const somHon = new Date(MAI_SAU.getTime() - 24 * 3600 * 1000);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: somHon,
          reason: "khach giuc",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/Khong duoc rut ngan deadline/);
  });

  it("gia hạn khi đang OPEN thì được, và nó để lại lý do trong sổ kiểm toán", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
      await extendRfqDeadline(c, orgA, {
        rfqId,
        newDeadlineAt: MAI_SAU_XA,
        reason: "nha cung cap xin them thoi gian",
        actor: ACTOR,
      });
    });

    const { rows } = await db.pool.query<{ payload: { reason?: string } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_DEADLINE_EXTENDED' " +
        "  AND resource_id = $2",
      [orgA, rfqId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload.reason).toBe("nha cung cap xin them thoi gian");
  });

  it("gia hạn KHÔNG được nữa sau khi RFQ đã CLOSED", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
      await closeRfq(c, orgA, { rfqId, reason: "het han", actor: ACTOR });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: MAI_SAU_XA,
          reason: "mo lai",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/Chi doi duoc deadline khi RFQ dang DRAFT, PENDING_APPROVAL hoac OPEN/);
  });

  it("gia hạn KHÔNG có lý do bị từ chối ở tầng ứng dụng", async () => {
    const rfqId = await rfqNhap();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: MAI_SAU_XA,
          reason: "   ",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(RfqError);
  });
});

describe("hạng mục chỉ sửa được khi RFQ còn soạn", () => {
  it("thêm/sửa/xoá hạng mục bị chặn sau khi RFQ đã OPEN", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        addRfqItem(c, orgA, {
          rfqId,
          lineNo: 2,
          description: "Them dong sau khi da mo",
          quantity: "1.0000",
          unit: "cai",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/Khong sua duoc hang muc cua RFQ dang o trang thai OPEN/);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("DELETE FROM rfq_items WHERE rfq_id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/Khong sua duoc hang muc cua RFQ dang o trang thai OPEN/);

    const conNguyen = await withTenant(apiPool, orgA, (c) => listRfqItems(c, orgA, rfqId));
    expect(conNguyen.length).toBe(1);
  });
});

describe("cô lập tổ chức", () => {
  it("[INV-F1] RFQ của tổ chức A không nhìn thấy được từ phiên của tổ chức B", async () => {
    const rfqId = await rfqNhap();
    const tuA = await withTenant(apiPool, orgA, (c) => getRfq(c, orgA, rfqId));
    const tuB = await withTenant(apiPool, orgB, (c) => getRfq(c, orgB, rfqId));
    expect(tuA?.id).toBe(rfqId);
    expect(tuB).toBeNull();
  });

  it("[INV-F1] hạng mục cũng bị cắt theo tổ chức", async () => {
    const rfqId = await rfqNhap();
    const tuA = await withTenant(apiPool, orgA, (c) => listRfqItems(c, orgA, rfqId));
    const tuB = await withTenant(apiPool, orgB, (c) => listRfqItems(c, orgB, rfqId));
    expect(tuA.length).toBe(1);
    expect(tuB).toEqual([]);
  });
});

describe("huỷ RFQ", () => {
  it("huỷ được từ DRAFT, và sau khi huỷ thì không đi tiếp được", async () => {
    const rfqId = await rfqNhap();
    const huy = await withTenant(apiPool, orgA, (c) =>
      cancelRfq(c, orgA, { rfqId, reason: "khong con nhu cau", actor: ACTOR }),
    );
    expect(huy.status).toBe("CANCELLED");
    expect(huy.cancelledAt).not.toBeNull();

    await expect(
      withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR })),
    ).rejects.toThrow(/CANCELLED -> PENDING_APPROVAL/);
  });

  it("KHÔNG huỷ được RFQ đã CLOSED — cạnh đó không có trong bảng cạnh", async () => {
    // Có chủ đích, và nó theo đúng docs/ARCHITECTURE.md §6: ba mũi tên tới CANCELLED xuất phát từ
    // DRAFT, PENDING_APPROVAL và OPEN. Sau CLOSED thì phong bì đã nộp đang nằm trong hệ thống, và
    // "huỷ" lúc đó là một nghiệp vụ khác cần thiết kế riêng, không phải một cạnh thêm vào.
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR });
      await openRfq(c, orgA, { rfqId, actor: ACTOR });
      await closeRfq(c, orgA, { rfqId, reason: "het han", actor: ACTOR });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        cancelRfq(c, orgA, { rfqId, reason: "doi y", actor: ACTOR }),
      ),
    ).rejects.toThrow(/CLOSED -> CANCELLED/);
  });
});
