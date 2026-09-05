// =============================================================================================
// S1.6 — CỔNG CHÍNH SÁCH MỞ THẦU, ĐO TRÊN POSTGRES THẬT
//
// Phép đo trung tâm của file này là phép đo mà rủi ro số 5 của kế hoạch S1 đặt tên trước: **đo
// PHÉP HỘI, không đo bốn phép kiểm rời.** Với mỗi vế i của D1, dựng một trạng thái mà CHỈ vế i
// sai, rồi đòi cổng từ chối VÀ gọi đúng tên vế i. Nếu một vế bị quên trong cài đặt, test của vế
// ấy thấy cổng CHO QUA — tức nó đỏ, đúng như một lượt đột biến trên trigger.
//
// Fixture dựng bằng SQL viết tay, không gọi `@trustprocure/rfq` hay `@trustprocure/sealed-envelope`:
// giữ `packages/unseal` không có một cạnh phụ thuộc nào nó không cần lúc chạy.
// =============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  UNSEAL_CLAUSES,
  UnsealDeniedError,
  approveUnseal,
  assertUnsealAllowed,
  cancelUnseal,
  dispatchUnseal,
  requestUnseal,
} from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

let db: TestDatabase;
let apiPool: pg.Pool;
/** Pool ghi sổ kiểm toán của `requirePermission` — phải là `app_api`, không phải superuser:
 * `audit_append` chạy dưới RLS và `WITH CHECK (org_id = app_current_org_id())`. */
let auditPool: pg.Pool;
let orgA: string;
/** uYc yêu cầu (PROCUREMENT_MANAGER), uD1/uD2 duyệt (DIRECTOR), uKhong không có quyền nào. */
let uYc: string, uD1: string, uD2: string, uKhong: string;
let sYc: string, sD1: string, sD2: string, sKhong: string, sYcB: string;
let csA: string;

async function taoNguoi(email: string, vaiTro: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)",
    [orgA, id, vaiTro],
  );
  return id;
}

async function taoPhien(userId: string, mfaTuoiGiay = 0): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now() - make_interval(secs => $4)) " +
      "RETURNING id",
    [orgA, userId, randomBytes(32), mfaTuoiGiay],
  );
  return rows[0]?.id ?? "";
}

/** RFQ đã CLOSED — điểm xuất phát hợp lệ của một yêu cầu mở thầu. */
async function taoRfqDaDong(capKep = false): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, $3, $4, $5) RETURNING id",
    [orgA, MAI_SAU, capKep, uYc, sYc],
  );
  const rfqId = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [orgA, rfqId, uYc, sYc],
  );
  if (!capKep) {
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, " +
        "created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
      [orgA, rfqId, csA, uYc, sYc],
    );
  }
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, " +
      "submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  if (capKep) {
    // Hai phê duyệt RFQ (khác với phê duyệt MỞ THẦU) để cạnh PENDING_APPROVAL -> OPEN đi được.
    for (const [u, s] of [
      [uD1, sD1],
      [uD2, sD2],
    ] as const) {
      await db.pool.query(
        "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) " +
          "VALUES ($1, $2, $3, $4)",
        [orgA, rfqId, u, s],
      );
    }
  }
  // Vật liệu khoá — 017 đòi nó tồn tại lúc mở, và đòi nó sinh TRONG giao dịch mở.
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, " +
        "wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), uYc, sYc],
    );
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, " +
        "opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), " +
      "early_close_reason = 'dong som de kiem tra', closed_by = $2, closed_by_session_id = $3 " +
      "WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  return rfqId;
}

/** Một yêu cầu mở thầu ĐÃ ĐƯỢC PHÊ DUYỆT trên một RFQ dưới ngưỡng (cần 1 phê duyệt). */
async function yeuCauDaDuyet(): Promise<{ rfqId: string; requestId: string }> {
  const rfqId = await taoRfqDaDong();
  const yc = await withTenant(apiPool, orgA, (c) =>
    requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau", actorSessionId: sYc }, auditPool),
  );
  await withTenant(apiPool, orgA, (c) =>
    approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
  );
  return { rfqId, requestId: yc.id };
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";

  uYc = await taoNguoi("yc@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi("d1@vidu.vn", "DIRECTOR");
  uD2 = await taoNguoi("d2@vidu.vn", "DIRECTOR");
  uKhong = await taoNguoi("khong@vidu.vn", "TECHNICAL");

  sYc = await taoPhien(uYc);
  sYcB = await taoPhien(uYc);
  sD1 = await taoPhien(uD1);
  sD2 = await taoPhien(uD2);
  sKhong = await taoPhien(uKhong);

  const cs = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [orgA, uYc, sYc],
  );
  csA = cs.rows[0]?.id ?? "";
  expect([orgA, uYc, uD1, uD2, uKhong, sYc, sD1, sD2, sKhong, sYcB, csA].filter((x) => x === ""))
    .toEqual([]);
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

// ===============================================================================================
// [INV-D1] BỐN VẾ, MỘT HÀM — VÀ MỖI VẾ ĐƯỢC ĐO RIÊNG BẰNG MỘT TRẠNG THÁI CHỈ SAI ĐÚNG VẾ ẤY
// ===============================================================================================
describe("[INV-D1] cổng chính sách mở thầu là một PHÉP HỘI bốn vế", () => {
  it("[INV-D1] ĐỐI CHỨNG DƯƠNG: cả bốn vế đúng thì cổng cho qua và nói ra đủ bốn tên", async () => {
    const { requestId, rfqId } = await yeuCauDaDuyet();
    const bangChung = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    expect(bangChung.rfqId).toBe(rfqId);
    expect(bangChung.userId).toBe(uYc);
    // Bốn tên, đủ và đúng thứ tự của mệnh đề. Không có vế này, một cổng chỉ chạy ba vế vẫn trả
    // về một đối tượng trông hợp lệ.
    expect(bangChung.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);
    expect(UNSEAL_CLAUSES.length).toBe(4);
  });

  it("[INV-D1] vế 1 SAI MỘT MÌNH: không có quyền `rfq.unseal` -> PERMISSION", async () => {
    const { requestId } = await yeuCauDaDuyet();
    // uKhong có phiên hợp lệ, MFA mới, RFQ đã CLOSED, yêu cầu đã APPROVED — chỉ thiếu quyền.
    const loi = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sKhong }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e as UnsealDeniedError,
    );
    expect(loi).toBeInstanceOf(UnsealDeniedError);
    expect(loi?.clause).toBe("PERMISSION");
  });

  it("[INV-D1] vế 2 SAI MỘT MÌNH: MFA quá cũ -> MFA_FRESH", async () => {
    const { requestId } = await yeuCauDaDuyet();
    const sCu = await taoPhien(uYc, 3600); // MFA cách đây một giờ, cửa sổ là 15 phút
    const loi = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sCu }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e as UnsealDeniedError,
    );
    expect(loi).toBeInstanceOf(UnsealDeniedError);
    expect(loi?.clause).toBe("MFA_FRESH");
  });

  it("[INV-D1] vế 3 SAI MỘT MÌNH: RFQ không còn CLOSED -> RFQ_CLOSED", async () => {
    const { requestId, rfqId } = await yeuCauDaDuyet();
    // Đưa RFQ về OPEN để CHỈ vế 3 sai. Cạnh `CLOSED -> OPEN` không tồn tại trong bảng cạnh, nên
    // đây là một thao tác DỰNG FIXTURE, không phải một đường đi của sản phẩm — trigger máy trạng
    // thái bị vô hiệu hoá đúng trong lúc dựng, còn cổng ĐANG ĐƯỢC ĐO thì nguyên vẹn.
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    try {
      // `closed_at`/`early_close_reason` phải về NULL cùng lúc: CHECK
      // `rfq_chua_dong_thi_khong_co_moc_dong` (011) là một bất biến TRÊN DỮ LIỆU và nó đúng kể cả
      // khi trigger máy trạng thái đang tắt — một lớp không tắt được cùng lớp kia.
      await db.pool.query(
        "UPDATE rfq_packages SET status = 'OPEN', closed_at = NULL, early_close_reason = NULL " +
          "WHERE id = $1",
        [rfqId],
      );
    } finally {
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    }

    const loi = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e as UnsealDeniedError,
    );
    expect(loi).toBeInstanceOf(UnsealDeniedError);
    expect(loi?.clause).toBe("RFQ_CLOSED");
  });

  it("[INV-D1] vế 4 SAI MỘT MÌNH: yêu cầu chưa được phê duyệt -> POLICY_GATE", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau", actorSessionId: sYc }, auditPool),
    );
    const loi = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: yc.id, actorSessionId: sYc }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e as UnsealDeniedError,
    );
    expect(loi).toBeInstanceOf(UnsealDeniedError);
    expect(loi?.clause).toBe("POLICY_GATE");
  });

  it("[INV-D5] một lần từ chối vì thiếu quyền để lại bản ghi kiểm toán", async () => {
    const { requestId } = await yeuCauDaDuyet();
    const { rows: truoc } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'PERMISSION_DENIED'",
    );
    await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sKhong }, auditPool),
    ).catch(() => undefined);
    const { rows: sau } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'PERMISSION_DENIED'",
    );
    expect(Number(sau[0]?.n ?? 0)).toBe(Number(truoc[0]?.n ?? 0) + 1);
  });
});

// ===============================================================================================
// [INV-C3] MỞ THẦU CHỈ HỢP LỆ KHI RFQ ĐÃ CLOSED
// ===============================================================================================
describe("[INV-C3] không yêu cầu mở thầu được khi RFQ chưa đóng", () => {
  it("[INV-C3] RFQ đang OPEN thì không tạo được yêu cầu mở thầu", async () => {
    const rfqId = await taoRfqDaDong();
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    try {
      // `closed_at`/`early_close_reason` phải về NULL cùng lúc: CHECK
      // `rfq_chua_dong_thi_khong_co_moc_dong` (011) là một bất biến TRÊN DỮ LIỆU và nó đúng kể cả
      // khi trigger máy trạng thái đang tắt — một lớp không tắt được cùng lớp kia.
      await db.pool.query(
        "UPDATE rfq_packages SET status = 'OPEN', closed_at = NULL, early_close_reason = NULL " +
          "WHERE id = $1",
        [rfqId],
      );
    } finally {
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
    }
    await expect(
      withTenant(apiPool, orgA, (c) =>
        requestUnseal(c, orgA, { rfqId, reason: "som qua", actorSessionId: sYc }, auditPool),
      ),
    ).rejects.toThrow(/Chi yeu cau mo thau duoc khi RFQ da CLOSED/);
  });

  it("[INV-C3] ĐỐI CHỨNG DƯƠNG: RFQ đã CLOSED thì tạo được", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio", actorSessionId: sYc }, auditPool),
    );
    expect(yc.status).toBe("PENDING");
  });

  it("[INV-C3] cạnh CLOSED -> UNSEALED bị chặn khi chưa có yêu cầu được phê duyệt", async () => {
    const rfqId = await taoRfqDaDong();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/chua co yeu cau mo thau da duoc phe duyet/);
  });
});

// ===============================================================================================
// [INV-D2] HAI NGƯỜI KHÁC NHAU, HAI PHIÊN KHÁC NHAU, KHÔNG PHẢI NGƯỜI YÊU CẦU
// ===============================================================================================
describe("[INV-D2] phê duyệt mở thầu", () => {
  it("[INV-D2] người yêu cầu KHÔNG tự phê duyệt được", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio", actorSessionId: sYc }, auditPool),
    );
    // uYc là PROCUREMENT_MANAGER nên không có `rfq.unseal.approve`; để đo ĐÚNG vế "không tự
    // duyệt" chứ không vế quyền, đi thẳng bằng SQL viết tay — lớp có thẩm quyền là trigger.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, " +
            "approver_session_id) VALUES ($1, $2, $3, $4)",
          [orgA, yc.id, uYc, sYc],
        ),
      ),
    ).rejects.toThrow(/khong duoc tu phe duyet/);
  });

  it("[INV-D2] phê duyệt từ CHÍNH PHIÊN đã yêu cầu bị chặn, kể cả khi người khác", async () => {
    // Ca này là ca mà ràng buộc "hai người khác nhau" KHÔNG thấy: một người khác, nhưng dùng lại
    // đúng phiên đã tạo yêu cầu. Kế hoạch S1 §3 từng ghi rằng vế phiên "không cưỡng chế được ở
    // tầng CSDL" — xem khối mở đầu mục (2) của migration 019 để biết vì sao câu ấy nay sai.
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio", actorSessionId: sYc }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, " +
            "approver_session_id) VALUES ($1, $2, $3, $4)",
          [orgA, yc.id, uD1, sYc],
        ),
      ),
    ).rejects.toThrow(/khong khop chu phien|PHIEN KHAC/);
  });

  it("[INV-D2] một người phê duyệt HAI LẦN chỉ tính một — ràng buộc duy nhất chặn", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sD1 }, auditPool),
      ),
    ).rejects.toThrow();
  });

  it("[INV-D2] RFQ VƯỢT NGƯỠNG cần ĐỦ HAI phê duyệt mới sang APPROVED", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    const sauMot = await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
    );
    expect(sauMot.status, "một phê duyệt KHÔNG đủ cho RFQ vượt ngưỡng").toBe("PENDING");

    const sauHai = await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD2 }, auditPool),
    );
    expect(sauHai.status).toBe("APPROVED");
  });

  it("[INV-D2] lật `status` sang APPROVED bằng SQL viết tay khi chưa đủ phê duyệt bị TỪ CHỐI", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1",
          [yc.id],
        ),
      ),
    ).rejects.toThrow(/can 2 phe duyet, moi co 0/);
  });

  it("[INV-D2] ĐỘT BIẾN: gỡ trigger đếm phê duyệt thì chính câu UPDATE ấy ĐI LỌT", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    await db.pool.query("DROP TRIGGER unseal_requests_kiem_du_phe_duyet ON unseal_requests");
    try {
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query(
          "UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1",
          [yc.id],
        ),
      );
      expect(rowCount, "không có trigger thì một yêu cầu KHÔNG ai duyệt vẫn sang APPROVED").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER unseal_requests_kiem_du_phe_duyet BEFORE UPDATE ON unseal_requests " +
          " FOR EACH ROW WHEN (NEW.status = 'APPROVED' AND NEW.status IS DISTINCT FROM OLD.status) " +
          " EXECUTE FUNCTION public.unseal_kiem_du_phe_duyet()",
      );
    }
  });

  it("[INV-D2] một RFQ chỉ có MỘT yêu cầu đang mở — ngưỡng không bị chia đôi", async () => {
    const rfqId = await taoRfqDaDong();
    await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "lan mot", actorSessionId: sYc }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        requestUnseal(c, orgA, { rfqId, reason: "lan hai", actorSessionId: sYcB }, auditPool),
      ),
    ).rejects.toThrow();
  });

  it("huỷ yêu cầu rồi tạo lại được — đó là đường DUY NHẤT rút lại một phê duyệt", async () => {
    const { requestId, rfqId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      cancelUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    const lai = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "lam lai", actorSessionId: sYc }, auditPool),
    );
    expect(lai.status).toBe("PENDING");

    // ... và phê duyệt cũ VẪN CÒN trong sổ. Rút lại không có nghĩa là xoá dấu vết ai đã đồng ý.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM unseal_approvals WHERE unseal_request_id = $1",
      [requestId],
    );
    expect(rows[0]?.n).toBe("1");
  });
});

// ===============================================================================================
// [INV-D4] BREAK-GLASS ĐI ĐƯỜNG RIÊNG, VÀ NÓ KHÔNG BAO GIỜ IM LẶNG
// ===============================================================================================
describe("[INV-D4] break-glass", () => {
  it("[INV-D4] một yêu cầu break-glass sinh cảnh báo BỀN ngay trong giao dịch tạo nó", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(
        c,
        orgA,
        { rfqId, reason: "su co: giam doc yeu cau mo gap", actorSessionId: sYc, breakGlass: true },
        auditPool,
      ),
    );
    expect(yc.breakGlass).toBe(true);

    const { rows } = await db.pool.query<{ kind: string; payload: { severity: string } }>(
      "SELECT kind, payload FROM outbox_jobs WHERE dedupe_key = $1",
      [`break-glass:${yc.id}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("BREAK_GLASS_UNSEAL_ALERT");
    expect(rows[0]?.payload.severity).toBe("HIGH");
  });

  it("[INV-D4] cảnh báo TỨC THÌ: `NOTIFY` tới người nghe mà KHÔNG đợi vòng poll nào", async () => {
    // Đây là vế đã giữ D4 ở trạng thái chưa phủ suốt từ S0, và lý do ghi nguyên văn khi ấy:
    // *"D4 đòi cảnh báo TỨC THÌ, còn outbox là POLL và độ trễ của nó bị chặn dưới bởi
    //   pollIntervalMs; đường đúng là NOTIFY/LISTEN."*
    // Người nghe dưới đây KHÔNG chạy một vòng poll nào — nó chỉ `LISTEN` rồi đợi sự kiện.
    const nguoiNghe = await db.pool.connect();
    const nhan: string[] = [];
    try {
      nguoiNghe.on("notification", (m) => {
        if (m.payload !== undefined) nhan.push(m.payload);
      });
      await nguoiNghe.query("LISTEN trustprocure_break_glass");

      const rfqId = await taoRfqDaDong();
      const yc = await withTenant(apiPool, orgA, (c) =>
        requestUnseal(
          c,
          orgA,
          { rfqId, reason: "su co", actorSessionId: sYc, breakGlass: true },
          auditPool,
        ),
      );

      const hetHan = Date.now() + 5000;
      while (nhan.length === 0 && Date.now() < hetHan) {
        await nguoiNghe.query("SELECT 1");
      }
      expect(nhan.length, "không nhận được NOTIFY nào trong 5 giây").toBeGreaterThan(0);
      expect(nhan.some((p) => p.includes(yc.id))).toBe(true);
    } finally {
      await nguoiNghe.query("UNLISTEN trustprocure_break_glass").catch(() => undefined);
      nguoiNghe.release();
    }
  });

  it("[INV-D4] một yêu cầu THƯỜNG KHÔNG sinh cảnh báo — đối chứng âm", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "binh thuong", actorSessionId: sYc }, auditPool),
    );
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs WHERE dedupe_key = $1",
      [`break-glass:${yc.id}`],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[INV-D4] break-glass sang APPROVED mà KHÔNG cần phê duyệt nào — đó là đường riêng", async () => {
    const rfqId = await taoRfqDaDong(true); // vượt ngưỡng: đường thường sẽ cần HAI phê duyệt
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(
        c,
        orgA,
        { rfqId, reason: "su co", actorSessionId: sYc, breakGlass: true },
        auditPool,
      ),
    );
    const { rowCount } = await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [
        yc.id,
      ]),
    );
    expect(rowCount).toBe(1);
  });

  it("[INV-D4] ĐỘT BIẾN: gỡ trigger cảnh báo thì một break-glass đi qua TRONG IM LẶNG", async () => {
    await db.pool.query("DROP TRIGGER unseal_requests_canh_bao_break_glass ON unseal_requests");
    try {
      const rfqId = await taoRfqDaDong();
      const yc = await withTenant(apiPool, orgA, (c) =>
        requestUnseal(
          c,
          orgA,
          { rfqId, reason: "su co", actorSessionId: sYc, breakGlass: true },
          auditPool,
        ),
      );
      const { rows } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM outbox_jobs WHERE dedupe_key = $1",
        [`break-glass:${yc.id}`],
      );
      expect(rows[0]?.n, "không có trigger thì break-glass không để lại dấu vết nào").toBe("0");
    } finally {
      await db.pool.query(
        "CREATE TRIGGER unseal_requests_canh_bao_break_glass AFTER INSERT ON unseal_requests " +
          " FOR EACH ROW WHEN (NEW.break_glass) " +
          " EXECUTE FUNCTION public.unseal_canh_bao_break_glass()",
      );
    }
  });
});

// ===============================================================================================
// ĐIỀU PHỐI — `api` CHỈ ĐẶT MỘT JOB, KHÔNG GIẢI MÃ GÌ
// ===============================================================================================
describe("dispatchUnseal", () => {
  it("đặt đúng một job vào hàng đợi sau khi cổng bốn vế cho qua", async () => {
    const { requestId } = await yeuCauDaDuyet();
    const bangChung = await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    expect(bangChung.clauses).toHaveLength(4);
    const { rows } = await db.pool.query<{ kind: string }>(
      "SELECT kind FROM outbox_jobs WHERE dedupe_key = $1",
      [`unseal:${requestId}`],
    );
    expect(rows.map((r) => r.kind)).toEqual(["UNSEAL_RFQ"]);
  });

  it("KHÔNG đặt job nào khi cổng từ chối — không có nửa đường nào", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "chua duyet", actorSessionId: sYc }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        dispatchUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sYc }, auditPool),
      ),
    ).rejects.toBeInstanceOf(UnsealDeniedError);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM outbox_jobs WHERE dedupe_key = $1",
      [`unseal:${yc.id}`],
    );
    expect(rows[0]?.n).toBe("0");
  });
});
