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
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";

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
let s1: string, s2: string, s3: string, s2b: string;

/**
 * [H-2, vòng sửa sau review an ninh] Phiên phải mang `mfa_verified_at`: trigger `rfq_kiem_nguoi_duyet`
 * (011) nay từ chối phiên hết hạn, bị thu hồi, hoặc chưa qua MFA. Bản 009 chỉ đọc `user_id`, nên
 * một phiên ĐÃ BỊ THU HỒI vì nghi ngờ chiếm đoạt vẫn ký được một phê duyệt — quy trình ứng phó sự
 * cố "thu hồi hết phiên của người này" không đóng được đường phê duyệt.
 */
async function taoPhien(orgId: string, userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** RFQ ở DRAFT kèm một hạng mục — điểm xuất phát của hầu hết phép đo dưới đây. */
// [ADR-017] `requiresDualApproval` khong con la mot co tu khai. RFQ luon ra doi o `true`, va
// duong DUY NHAT ha no xuong `false` la `setRfqBudget` — thu phai tro toi mot chinh sach co that
// va de CSDL tinh phep so. Tham so cua helper nay vi vay DOI NGHIA: no khong con DAT mot co, no
// chon mot SO TIEN nam duoi hay tren nguong. Nguong cua orgA la 100 trieu, dat o beforeAll.
async function rfqNhap(orgId = orgA, requiresDualApproval = false): Promise<string> {
  return withTenant(apiPool, orgId, async (c) => {
    const r = await createRfq(c, orgId, {
      title: "Mua thep tam",
      deadlineAt: MAI_SAU,
      createdBy: u1,
      createdBySessionId: s1,
      actor: ACTOR,
    });
    await setRfqBudget(c, orgId, {
      rfqId: r.id,
      estimatedValue: requiresDualApproval ? "200000000.00" : "1000000.00",
      currency: "VND",
      actorSessionId: s1,
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

  s1 = await taoPhien(orgA, u1);
  s2 = await taoPhien(orgA, u2);
  s3 = await taoPhien(orgA, u3);
  s2b = await taoPhien(orgA, u2);

  expect([orgA, orgB, u1, u2, u3, s1, s2, s3, s2b].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");

  // [ADR-017] Chinh sach cua orgA: nguong 100 trieu VND. Moi RFQ cua bo test nay di qua no.
  await withTenant(apiPool, orgA, (c) =>
    createProcurementPolicy(c, orgA, {
      version: 1,
      dualApprovalThreshold: "100000000.00",
      currency: "VND",
      actorSessionId: s1,
    }),
  );
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
      // [Vòng sửa sau review an ninh] Lượt đo này ĐÃ ĐỔI KẾT QUẢ, và đổi theo hướng tốt. Trước
      // 011, gỡ trigger đi thì câu UPDATE ĐI LỌT (rowCount = 1) — đó là bằng chứng trigger là
      // lớp duy nhất. Sau 011 nó vẫn đỏ, nhưng bằng một lớp KHÁC có tên:
      // rfq_chua_dong_thi_khong_co_moc_dong, một CHECK đóng chiều ngược mà 009 để trống (status
      // quay về OPEN trong khi closed_at vẫn NOT NULL).
      //
      // Giữ nguyên phép đo thay vì xoá, và khẳng định ĐÚNG thứ đang chặn: hai lớp độc lập cùng
      // canh một cạnh là kết quả mong muốn, nhưng nó phải được NÓI RA — không được để một test
      // cũ xanh vì một lý do khác với lý do nó được viết.
      const loi = await withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN' WHERE id = $1", [rfqId]),
      ).then(
        () => null,
        (e: unknown) => e as { constraint?: string },
      );
      expect(loi?.constraint).toBe("rfq_chua_dong_thi_khong_co_moc_dong");

      // ... và khi CẢ HAI lớp bị vô hiệu (gỡ trigger + xoá mốc đóng), câu ấy ĐI LỌT. Đây mới là
      // vế chứng minh không có lớp thứ ba nào đang âm thầm gánh.
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN', closed_at = NULL WHERE id = $1", [
          rfqId,
        ]),
      );
      expect(rowCount).toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai BEFORE UPDATE ON rfq_packages " +
          "FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_chuyen_trang_thai()",
      );
      // Trả RFQ về CLOSED để không rò trạng thái sang test khác.
      // Dọn: trả cả trạng thái LẪN mốc đóng, vì lượt đo trên đã xoá mốc. Không có vế thứ hai,
      // chính câu dọn này đỏ vì `rfq_da_dong_thi_co_moc_dong` — đã vấp phải khi chạy lại.
      await db.pool.query(
        "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now() WHERE id = $1",
        [rfqId],
      );
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
        createdBy: u1,
        createdBySessionId: s1,
        actor: ACTOR,
      });
      await setRfqBudget(c, orgA, {
        rfqId: r.id,
        estimatedValue: "1000000.00",
        currency: "VND",
        actorSessionId: s1,
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
    ).rejects.toThrow(/can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 1/);

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
    ).rejects.toThrow(/Khong duoc rut ngan hay xoa deadline/);
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
    ).rejects.toThrow(/Chi doi duoc deadline khi RFQ dang DRAFT hoac OPEN/);
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
    ).rejects.toThrow(/Chi sua duoc hang muc khi RFQ con o DRAFT/);

    // [011] Quyền DELETE trên `rfq_items` ĐÃ BỊ THU HỒI: trong toàn kho mã không có một câu
    // DELETE nào, và một quyền cấp "cho chắc" là một quyền không ai gỡ ra nữa. Nay câu này chết ở
    // TẦNG QUYỀN, sớm hơn trigger một bậc — và đó là lớp mạnh hơn, không phải lớp khác.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("DELETE FROM rfq_items WHERE rfq_id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/permission denied/);

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
    ).rejects.toThrow(/không ở trạng thái nguồn hợp lệ/);
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
    // [H-3] Câu UPDATE nay ghim trạng thái nguồn, nên nó chạm 0 hàng và hàm ném TRƯỚC khi trigger
    // kịp nói gì. Cạnh `CLOSED->CANCELLED` vẫn không có trong bảng cạnh — test "đi vòng qua ứng
    // dụng" ở trên mới là chỗ đo trigger.
    ).rejects.toThrow(/không ở trạng thái nguồn hợp lệ/);
  });
});

// =============================================================================================
// [ADR-017] NGƯỠNG PHÊ DUYỆT KÉP — CHÍNH SÁCH THEO TỔ CHỨC, CÓ PHIÊN BẢN, TÁI LẬP ĐƯỢC
//
// Trước migration 014, `requires_dual_approval` là một cờ NGƯỜI GỌI đặt và không một dòng mã nào
// tính nó. Khối này đo bốn thứ: phân loại chạy đúng, hạ cờ mà KHÔNG có bằng chứng thì bị chặn ở
// tầng CSDL, phân loại cũ KHÔNG đổi khi chính sách xoay, và bằng chứng không sửa được sau khi
// RFQ rời DRAFT.
// =============================================================================================
describe("chính sách mua sắm và ngưỡng phê duyệt kép", () => {
  it("ĐỐI CHỨNG DƯƠNG: dưới ngưỡng thì hạ được cờ; trên ngưỡng thì KHÔNG", async () => {
    const duoi = await rfqNhap(orgA, false);
    const tren = await rfqNhap(orgA, true);

    const { rows } = await db.pool.query<{ id: string; requires_dual_approval: boolean }>(
      "SELECT id, requires_dual_approval FROM rfq_packages WHERE id = ANY($1::uuid[])",
      [[duoi, tren]],
    );
    const theoId = new Map(rows.map((h) => [h.id, h.requires_dual_approval]));
    expect(theoId.get(duoi)).toBe(false);
    expect(theoId.get(tren)).toBe(true);
  });

  it("bằng chứng được LƯU, và nó trỏ tới đúng phiên bản chính sách đã dùng", async () => {
    const rfqId = await rfqNhap(orgA, false);
    const { rows } = await db.pool.query<{ estimated_value: string; version: number }>(
      "SELECT b.estimated_value, p.version FROM rfq_budgets b " +
        " JOIN org_procurement_policies p ON p.id = b.policy_id WHERE b.rfq_id = $1",
      [rfqId],
    );
    // Đây là câu trả lời cho "vì sao RFQ này chỉ cần một phê duyệt". Trước 014 nó không tồn tại.
    expect(rows[0]?.estimated_value).toBe("1000000.00");
    expect(rows[0]?.version).toBe(1);
  });

  it("LỚP CÓ THẨM QUYỀN Ở CSDL: hạ cờ bằng SQL VIẾT TAY rồi nộp duyệt bị TRIGGER chặn", async () => {
    const rfqId = await rfqNhap(orgA, true);

    // Đi vòng qua `setRfqBudget`: đây là chỗ duy nhất chứng minh lớp nằm ở CSDL. Câu UPDATE này
    // THÀNH CÔNG — hạ cờ khi còn DRAFT là hợp lệ về lược đồ.
    await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE rfq_packages SET requires_dual_approval = false WHERE id = $1", [rfqId]),
    );

    // Nhưng cạnh đi vào vòng phê duyệt thì đòi BẰNG CHỨNG, và bằng chứng nói ngược lại.
    await expect(
      withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR })),
    ).rejects.toThrow(/phai can hai phe duyet/);
  });

  it("KHÔNG có ngân sách nào thì cũng không hạ cờ được — mặc định ĐÓNG", async () => {
    const rfqId = await withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, {
        title: "RFQ khong ngan sach",
        deadlineAt: MAI_SAU,
        createdBy: u1,
        createdBySessionId: s1,
        actor: ACTOR,
      });
      await addRfqItem(c, orgA, {
        rfqId: r.id,
        lineNo: 1,
        description: "Mot hang muc",
        quantity: "1.0000",
        unit: "cai",
        actor: ACTOR,
      });
      await c.query("UPDATE rfq_packages SET requires_dual_approval = false WHERE id = $1", [r.id]);
      return r.id;
    });

    await expect(
      withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR })),
    ).rejects.toThrow(/chua co ngan sach va chinh sach/);
  });

  it("TÁI LẬP ĐƯỢC: xoay chính sách sang phiên bản mới KHÔNG đổi phân loại của RFQ cũ", async () => {
    const cu = await rfqNhap(orgA, false);

    // Phiên bản 2 hạ ngưỡng xuống dưới giá trị của RFQ trên. Nếu phân loại được tính lại từ
    // "chính sách hiện hành", RFQ cũ sẽ đổi nghĩa sau lưng mọi người.
    await withTenant(apiPool, orgA, (c) =>
      createProcurementPolicy(c, orgA, {
        version: 2,
        dualApprovalThreshold: "500000.00",
        currency: "VND",
        actorSessionId: s1,
      }),
    );

    const { rows } = await db.pool.query<{ requires_dual_approval: boolean; version: number }>(
      "SELECT r.requires_dual_approval, p.version FROM rfq_packages r " +
        " JOIN rfq_budgets b ON b.rfq_id = r.id " +
        " JOIN org_procurement_policies p ON p.id = b.policy_id WHERE r.id = $1",
      [cu],
    );
    expect(rows[0]?.requires_dual_approval).toBe(false);
    expect(rows[0]?.version).toBe(1);
  });

  it("chính sách KHÔNG SỬA ĐƯỢC — `app_api` không có UPDATE, và đó là toàn bộ cơ chế", async () => {
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE org_procurement_policies SET dual_approval_threshold = 1 WHERE version = 1"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("bằng chứng không sửa được sau khi RFQ rời DRAFT", async () => {
    const rfqId = await rfqNhap(orgA, false);
    await withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR }));

    await expect(
      withTenant(apiPool, orgA, (c) =>
        setRfqBudget(c, orgA, {
          rfqId,
          estimatedValue: "999.00",
          currency: "VND",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(/DRAFT/);
  });

  it("ĐỘT BIẾN: gỡ trigger ngưỡng thì cờ hạ bằng tay ĐI LỌT vào vòng phê duyệt", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE rfq_packages SET requires_dual_approval = false WHERE id = $1", [rfqId]),
    );

    await db.pool.query(
      "DROP TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep ON rfq_packages",
    );
    try {
      await withTenant(apiPool, orgA, (c) =>
        submitRfqForApproval(c, orgA, { rfqId, actor: ACTOR }),
      );
      const { rows } = await db.pool.query<{ status: string }>(
        "SELECT status FROM rfq_packages WHERE id = $1",
        [rfqId],
      );
      expect(rows[0]?.status, "không có trigger thì bằng chứng chỉ là một hàng dữ liệu").toBe(
        "PENDING_APPROVAL",
      );
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep BEFORE UPDATE ON rfq_packages " +
          " FOR EACH ROW WHEN (NEW.status IN ('PENDING_APPROVAL', 'OPEN') " +
          "   AND NEW.status IS DISTINCT FROM OLD.status) " +
          " EXECUTE FUNCTION public.rfq_kiem_nguong_phe_duyet_kep()",
      );
    }
  });

  it("số tiền KHÔNG vào sổ kiểm toán — ngân sách rò xuống bên bán là NEO GIÁ", async () => {
    const rfqId = await rfqNhap(orgA, false);
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE resource_id = $1 AND action = 'RFQ_BUDGET_SET'",
      [rfqId],
    );
    const p = rows[0]?.payload ?? {};
    expect(Object.keys(p).sort()).toEqual(["policyVersion", "requiresDualApproval"]);
    expect(JSON.stringify(p)).not.toContain("1000000");
  });

  it("`estimated_value` KHÔNG nằm trên `rfq_packages` — bảng không có cột thì không có gì để nhớ", async () => {
    // Lớp thay cho thứ ADR-017 mục 4 hứa mà KHÔNG cài được: đường khách và đường người mua dùng
    // CHUNG một role CSDL (`app_api`), nên không thu hẹp quyền theo cột cho riêng đường khách
    // được. Bảng riêng là thứ thay thế được, và test này ghim nó.
    const { rows } = await db.pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns " +
        " WHERE table_schema = 'public' AND table_name = 'rfq_packages' " +
        "   AND (column_name LIKE '%value%' OR column_name LIKE '%price%' " +
        "        OR column_name LIKE '%budget%' OR column_name LIKE '%amount%')",
    );
    expect(rows.map((h) => h.column_name)).toEqual([]);
  });
});
