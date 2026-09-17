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

import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { DenialAuditFailedError } from "@trustprocure/identity";
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
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_gia_han_khong_hoi_sinh; ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
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
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_gia_han_khong_hoi_sinh; ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
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
    await db.pool.query("ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_gia_han_khong_hoi_sinh; ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
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
      await db.pool.query("ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_gia_han_khong_hoi_sinh; ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai");
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
        { rfqId, reason: "su co: giam doc yeu cau mo gap", actorSessionId: sYc, breakGlass: true, breakGlassWitnessSessionId: sD1 },
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
          { rfqId, reason: "su co", actorSessionId: sYc, breakGlass: true, breakGlassWitnessSessionId: sD1 },
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
        { rfqId, reason: "su co", actorSessionId: sYc, breakGlass: true, breakGlassWitnessSessionId: sD1 },
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
          { rfqId, reason: "su co", actorSessionId: sYc, breakGlass: true, breakGlassWitnessSessionId: sD1 },
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

// ===============================================================================================
// [khoản nợ 32] D5 CHO CẢ BỐN VẾ, KHÔNG CHỈ VẾ MỘT
//
// `requirePermission` ghi sổ cho vế 1 từ S0. Ba vế còn lại ném và KHÔNG ghi gì — nên một người
// trong tổ chức dò *"RFQ đóng chưa / phê duyệt về chưa"* bằng cách gọi `dispatchUnseal` liên tục
// sinh ra CON SỐ KHÔNG bản ghi. Và một lần THỬ vi phạm D2 còn tệ hơn: trigger chặn đúng, nhưng
// lời từ chối của nó ROLLBACK cả bản ghi `UNSEAL_APPROVED` — nên không còn dấu vết nào.
// ===============================================================================================
// ~~[S1.68 / lượt soi 62a-9] "Mọi" rộng hơn thứ đo ở đây: yêu cầu không tìm thấy trong tổ chức ⇒ `UnsealDeniedError` POLICY_GATE ném TRƯỚC~~
// ~~mọi lần ghi và không để lại dấu vết (đọc, `gate.ts`) — khoản nợ 121.~~ [S1.72 / khoản 121] Nhánh ấy nay đi qua `tuChoi`: đo trước bản vá,
// 0 hàng sổ qua `assertUnsealAllowed`, `dispatchUnseal` và `POST /unseal/:id/dispatch`; test [S1.72] đầu tiên dưới đây ghim đúng một hàng.
describe("[INV-D5] mọi lần từ chối của cổng mở thầu đều để lại dấu vết", () => {
  async function demTuChoi(requestId: string, action: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 " +
        "  AND resource_id = $3",
      [orgA, action, requestId],
    );
    return Number(rows[0]?.n ?? "0");
  }

  it("[INV-D5] vế 2 (MFA quá cũ) ghi `UNSEAL_DENIED` mang đúng tên vế", async () => {
    const { requestId } = await yeuCauDaDuyet();
    const sCu = await taoPhien(uYc, 3600);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sCu }, auditPool),
      ),
    ).rejects.toBeInstanceOf(UnsealDeniedError);

    expect(await demTuChoi(requestId, "UNSEAL_DENIED")).toBe(1);
    const { rows } = await db.pool.query<{ payload: { clause: string } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_DENIED' " +
        "  AND resource_id = $2",
      [orgA, requestId],
    );
    expect(rows[0]?.payload.clause).toBe("MFA_FRESH");
  });

  it("[INV-D5] vế 3 (RFQ chưa CLOSED) cũng ghi — và bản ghi SỐNG QUA một lần rollback", async () => {
    // Vế chịu lực: một lần từ chối thường kéo theo rollback của người gọi. Một bản ghi kiểm toán
    // biến mất cùng lần rollback ấy là một bản ghi KHÔNG TỒN TẠI. Giao dịch độc lập là thứ mua
    // được điều đó, và test này đo chính nó.
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "chua dong ma xin mo", actorSessionId: sYc }, auditPool),
    );
    await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
    );
    // Đưa RFQ ra khỏi CLOSED bằng SQL viết tay — đúng ca mà vế 3 tồn tại để bắt.
    await db.pool.query(
      "ALTER TABLE rfq_packages DISABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai",
    );
    try {
      await db.pool.query(
        "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', opened_at = NULL, closed_at = NULL, " +
          " early_close_reason = NULL, opened_by = NULL, opened_by_session_id = NULL, " +
          " closed_by = NULL, closed_by_session_id = NULL WHERE id = $1",
        [rfqId],
      );
    } finally {
      await db.pool.query(
        "ALTER TABLE rfq_packages ENABLE TRIGGER rfq_packages_kiem_chuyen_trang_thai",
      );
    }

    const CHAN = new Error("chan-lai-de-do-rollback");
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await assertUnsealAllowed(
          c,
          orgA,
          { unsealRequestId: yc.id, actorSessionId: sYc },
          auditPool,
        ).catch(() => undefined);
        throw CHAN;
      }),
    ).rejects.toBe(CHAN);

    expect(
      await demTuChoi(yc.id, "UNSEAL_DENIED"),
      "bản ghi từ chối biến mất cùng rollback của người gọi — nó phải ở một giao dịch ĐỘC LẬP",
    ).toBe(1);
  });

  it("[INV-D5] vế 4 (chưa đủ phê duyệt) cũng ghi", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "moi mot phe duyet", actorSessionId: sYc }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        assertUnsealAllowed(c, orgA, { unsealRequestId: yc.id, actorSessionId: sYc }, auditPool),
      ),
    ).rejects.toBeInstanceOf(UnsealDeniedError);
    expect(await demTuChoi(yc.id, "UNSEAL_DENIED")).toBe(1);
  });

  it("[INV-D5] [S1.72 / khoản 121] yêu cầu KHÔNG tìm thấy trong tổ chức ⇒ `UnsealDeniedError` POLICY_GATE và đúng một `UNSEAL_DENIED` mang vế POLICY_GATE, người gọi và id đã gửi — qua `assertUnsealAllowed` lẫn `dispatchUnseal`", async () => {
    // Đo trước bản vá (§S1.72): nhánh này ném TRƯỚC mọi lần ghi — 0 hàng sổ qua cả hai hàm và qua `POST /unseal/:id/dispatch` (422). Một id
    // có thật của tổ chức khác cũng rơi vào nhánh này (RLS giấu nó) và cũng 0 hàng ở cả hai sổ.
    const id = randomUUID();
    const loi = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: id, actorSessionId: sYc }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).toBeInstanceOf(UnsealDeniedError);
    expect((loi as UnsealDeniedError).clause).toBe("POLICY_GATE");
    const { rows } = await db.pool.query<{ actor_id: string | null; resource_type: string; payload: Record<string, unknown> }>(
      "SELECT actor_id, resource_type, payload FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_DENIED' AND resource_id = $2",
      [orgA, id],
    );
    // [S1.72 / lượt soi 67c-6] Loại tài nguyên và HÌNH DẠNG trọn của payload — cùng mốc chết mà lượt soi 67a-8 đặt cho worker và bảng so sánh.
    expect(rows.map((r) => [r.actor_id, r.resource_type, r.payload])).toEqual([[uYc, "UNSEAL_REQUEST", { clause: "POLICY_GATE" }]]);

    const idQuaDieuPhoi = randomUUID();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        dispatchUnseal(c, orgA, { unsealRequestId: idQuaDieuPhoi, actorSessionId: sYc }, auditPool),
      ),
    ).rejects.toBeInstanceOf(UnsealDeniedError);
    expect(await demTuChoi(idQuaDieuPhoi, "UNSEAL_DENIED")).toBe(1);
  });

  it("[INV-D5] [S1.72 / lượt soi 67c-6] vế 2: lỗi MANG SQLSTATE từ câu SQL của phép kiểm MFA đi nguyên — không thành `UnsealDeniedError`, không vào sổ", async () => {
    // Phép phân loại của vế 2 chưa có ca "lỗi khác": nới nó thành mọi lỗi thì một lỗi vận hành (42501, 57014) thành hàng MFA_FRESH sai nguyên
    // nhân. `maxMfaAgeSeconds` 1e12 qua được phép kiểm tham số của `assertFreshMfa`; mốc `clock_timestamp() - 1e12 giây` ra ngoài miền timestamp.
    const { requestId } = await yeuCauDaDuyet();
    const loi = await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc, maxMfaAgeSeconds: 1e12 }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).not.toBeInstanceOf(UnsealDeniedError);
    expect((loi as { code?: unknown } | null)?.code, String((loi as Error | null)?.message)).toBe("22008");
    expect(await demTuChoi(requestId, "UNSEAL_DENIED")).toBe(0);
  });

  it("[INV-D2] một lần THỬ tự phê duyệt để lại `UNSEAL_APPROVAL_DENIED`", async () => {
    const rfqId = await taoRfqDaDong();
    // Người YÊU CẦU phải là một `DIRECTOR`, không phải `uYc`: `uYc` là `PROCUREMENT_MANAGER` và
    // KHÔNG giữ `rfq.unseal.approve`, nên lượt tự-phê-duyệt của nó dừng ở CỔNG QUYỀN — tức nó đo
    // vế 1 của D5 một lần nữa chứ không đo trigger D2. Bản đầu của test này mắc đúng lỗi ấy và
    // đỏ vì lý do đúng.
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "tu phe duyet", actorSessionId: sD1 }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
      ),
    ).rejects.toThrow(/tu phe duyet/i);
    expect(
      await demTuChoi(yc.id, "UNSEAL_APPROVAL_DENIED"),
      "trigger chặn đúng, nhưng lời từ chối của nó rollback cả bản ghi kiểm toán — nên nó phải " +
        "được ghi ở một giao dịch ĐỘC LẬP",
    ).toBe(1);
  });

  it("[INV-D5] ĐỐI CHỨNG DƯƠNG: một lần cho qua KHÔNG ghi bản ghi từ chối nào", async () => {
    // Không có vế này, bốn khẳng định trên xanh kể cả khi hàm ghi `UNSEAL_DENIED` ở MỌI lượt gọi.
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      assertUnsealAllowed(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    expect(await demTuChoi(requestId, "UNSEAL_DENIED")).toBe(0);
  });
});

// ===============================================================================================
// [S1.68 / khoản 119] LẦN GHI SỔ TỪ CHỐI HỎNG THÌ GÃY ỒN ÀO — LỖI CỦA LẦN GHI KHÔNG ĐƯỢC THAY CHỖ LẦN TỪ CHỐI
//
// Đo trên master 749f925, trước bản vá (biên bản §S1.68): trigger chặn lần ghi `UNSEAL_DENIED` bằng TP119 ⇒ `assertUnsealAllowed` ném
// lỗi Postgres trần `{ name: "error", code: "TP119" }`, không mang lần từ chối; `auditPool` siêu người dùng ⇒ bản ghi được nhận không một
// lời. `auditPool` đầy TẠM THỜI thì lần ghi xếp hàng rồi ghi được — trước bản vá cũng thế; bản đầu của vòng này làm vỡ điều ấy bằng một
// phép kiểm "pool còn chỗ" tức thì, và test thứ hai dưới đây ghim lại (lượt soi 62a-1).
// ===============================================================================================
describe("[INV-D5] [S1.68 / khoản 119] lần ghi sổ từ chối của cổng mở thầu và của D2 hỏng ⇒ DenialAuditFailedError giữ lần từ chối", () => {
  async function demTuChoi(requestId: string, action: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3",
      [orgA, action, requestId],
    );
    return Number(rows[0]?.n ?? "0");
  }

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ; mọi lần ghi khác đi qua. */
  async function voiGhiSoBiChan<T>(action: string, viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k119_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k119 thong diep noi bo' USING ERRCODE = 'TP119'; END$$",
      );
      await db.pool.query(
        `CREATE TRIGGER k119_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = '${action}') ` +
          "EXECUTE FUNCTION public.k119_chan_ghi_so()",
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k119_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k119_chan_ghi_so()");
    }
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  async function yeuCauChoDuyet(lyDo: string): Promise<string> {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: lyDo, actorSessionId: sYc }, auditPool),
    );
    return yc.id;
  }

  it("[INV-D5] vế 4 của cổng, lần ghi `UNSEAL_DENIED` ném TP119 ⇒ DenialAuditFailedError: lần từ chối POLICY_GATE nằm trong `denial`, lỗi của lần ghi trong `cause`, thông điệp không mang thông điệp của lỗi gốc; không hàng sổ nào", async () => {
    const id = await yeuCauChoDuyet("k119 cong");
    const loi = await voiGhiSoBiChan("UNSEAL_DENIED", () =>
      loiCua(withTenant(apiPool, orgA, (c) => assertUnsealAllowed(c, orgA, { unsealRequestId: id, actorSessionId: sYc }, auditPool))),
    );
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const x = loi as DenialAuditFailedError;
    expect(x.action).toBe("UNSEAL_DENIED");
    expect(x.denial).toBeInstanceOf(UnsealDeniedError);
    expect((x.denial as UnsealDeniedError).clause).toBe("POLICY_GATE");
    expect((x.cause as { code?: unknown }).code).toBe("TP119");
    expect(x.message).not.toContain("k119 thong diep noi bo");
    expect(await demTuChoi(id, "UNSEAL_DENIED")).toBe(0);
  });

  it("[INV-D5] `auditPool` đầy TẠM THỜI ⇒ cổng CHỜ kết nối rồi vẫn ghi được lần từ chối — `UnsealDeniedError` POLICY_GATE và đúng một hàng (lượt soi 62a-1: bản đầu của vòng này gãy ngay, không hàng sổ)", async () => {
    const id = await yeuCauChoDuyet("k119 pool day tam thoi");
    const poolNho = db.poolAs("app_api");
    const giu: pg.PoolClient[] = [];
    try {
      for (let i = 0; i < poolNho.options.max; i += 1) giu.push(await poolNho.connect());
      const theoDoi = { xong: false };
      const hua = loiCua(withTenant(apiPool, orgA, (c) => assertUnsealAllowed(c, orgA, { unsealRequestId: id, actorSessionId: sYc }, poolNho)));
      void hua.then(() => {
        theoDoi.xong = true;
      });
      const hanCho = Date.now() + 5000;
      while (poolNho.waitingCount === 0 && !theoDoi.xong && Date.now() < hanCho) {
        await new Promise<void>((xong) => setTimeout(xong, 20));
      }
      const daXepHang = poolNho.waitingCount > 0;
      for (const c of giu.splice(0)) c.release();
      const loi = await hua;
      expect(daXepHang, "lần ghi phải xếp hàng chờ kết nối của auditPool, không gãy ngay").toBe(true);
      expect((loi as Error).name).toBe("UnsealDeniedError");
      expect((loi as UnsealDeniedError).clause).toBe("POLICY_GATE");
      expect(await demTuChoi(id, "UNSEAL_DENIED")).toBe(1);
    } finally {
      for (const c of giu) c.release();
      await poolNho.end();
    }
  });

  it("[INV-D5] [S1.72 / khoản 121] yêu cầu KHÔNG tìm thấy, lần ghi `UNSEAL_DENIED` ném TP119 ⇒ DenialAuditFailedError: `UnsealDeniedError` POLICY_GATE nằm trong `denial`, lỗi của lần ghi trong `cause`; không hàng sổ nào", async () => {
    const id = randomUUID();
    const loi = await voiGhiSoBiChan("UNSEAL_DENIED", () =>
      loiCua(withTenant(apiPool, orgA, (c) => assertUnsealAllowed(c, orgA, { unsealRequestId: id, actorSessionId: sYc }, auditPool))),
    );
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    const x = loi as DenialAuditFailedError;
    expect(x.denial).toBeInstanceOf(UnsealDeniedError);
    expect((x.denial as UnsealDeniedError).clause).toBe("POLICY_GATE");
    expect((x.cause as { code?: unknown }).code).toBe("TP119");
    expect(await demTuChoi(id, "UNSEAL_DENIED")).toBe(0);
  });

  it("[INV-D5] `auditPool` chạy dưới siêu người dùng ⇒ cổng từ chối ghi — cùng lớp canh [F9] của requirePermission — DenialAuditFailedError nêu SUPERUSER trong `cause`; không hàng sổ nào", async () => {
    const id = await yeuCauChoDuyet("k119 sieu nguoi dung");
    const loi = await loiCua(withTenant(apiPool, orgA, (c) => assertUnsealAllowed(c, orgA, { unsealRequestId: id, actorSessionId: sYc }, db.pool)));
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    expect(((loi as DenialAuditFailedError).cause as Error).message).toMatch(/SUPERUSER|BYPASSRLS/);
    expect(((loi as DenialAuditFailedError).denial as UnsealDeniedError).clause).toBe("POLICY_GATE");
    expect(await demTuChoi(id, "UNSEAL_DENIED")).toBe(0);
  });

  it("[INV-D5] [INV-D2] lần THỬ tự phê duyệt, lần ghi `UNSEAL_APPROVAL_DENIED` ném TP119 ⇒ DenialAuditFailedError: vi phạm D2 (23514 của trigger 019) nằm trong `denial`; không hàng sổ nào", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "k119 tu duyet", actorSessionId: sD1 }, auditPool),
    );
    const loi = await voiGhiSoBiChan("UNSEAL_APPROVAL_DENIED", () =>
      loiCua(withTenant(apiPool, orgA, (c) => approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool))),
    );
    expect((loi as Error).name).toBe("DenialAuditFailedError");
    const x = loi as DenialAuditFailedError;
    expect(x.action).toBe("UNSEAL_APPROVAL_DENIED");
    expect((x.denial as { code?: unknown }).code).toBe("23514");
    expect(x.denial.message).toMatch(/tu phe duyet/i);
    expect((x.cause as { code?: unknown }).code).toBe("TP119");
    expect(await demTuChoi(yc.id, "UNSEAL_APPROVAL_DENIED")).toBe(0);
  });
});

// ================================================================================================
// [S1.76 / khoản 140] `approveUnseal` TUẦN TỰ HOÁ TRÊN HÀNG YÊU CẦU **TRƯỚC** LẦN GHI SỔ ĐẦU
//
// Khoản 140 mở ở S1.73 với lời đọc: *"`approveUnseal` INSERT một phê duyệt, ghi sổ, rồi UPDATE
// `unseal_requests` — nếu một giao dịch khác đang giữ khoá hàng thì lần phê duyệt đứng chờ TRONG KHI
// giữ khoá ghi sổ của tổ chức, đúng lớp lỗi của khoản 126."* **Phép đo BÁC lời ấy** (§S1.76).
//
// Thứ lời đọc bỏ sót nằm trong chính câu đầu nó nhắc tới: `INSERT INTO public.unseal_approvals` bắn
// trigger `unseal_approvals_kiem_nguoi_duyet` (019, BEFORE INSERT), và thân hàm ấy mở đầu bằng
// `SELECT … FROM public.unseal_requests … FOR NO KEY UPDATE`. Tức câu INSERT **giữ khoá hàng yêu cầu**
// — và nó đứng TRƯỚC `appendAuditEvent`. `approveUnseal` vì thế đã sẵn mang đúng hình dạng mà bản vá
// khoản 126 quy định ("khoá hàng trước lần ghi sổ đầu"), và câu `UPDATE … SET status = 'APPROVED'` ở
// cuối hàm chỉ xin lại đúng mức khoá giao dịch đã cầm, nên nó không chờ được ai.
//
// Bản đầu của khối này ghi rằng khoá đến từ KHOÁ NGOẠI `(org_id, unseal_request_id)` và gọi tính chất
// ấy là "tình cờ". **Sai cả hai vế** (lượt soi 71): khoá đến từ một câu `FOR NO KEY UPDATE` viết
// TƯỜNG MINH trong trigger cưỡng chế D2, tức nó là một lựa chọn CÓ CHỦ Ý, không phải may mắn. Và nó
// giải thích đúng số đo, trong khi lời khoá-ngoại thì không: `FOR KEY SHARE` của một phép kiểm khoá
// ngoại KHÔNG xung đột `FOR NO KEY UPDATE`, nên nếu khoá chỉ đến từ khoá ngoại thì kịch bản ⑵ đã phải
// đi lọt — đo thì nó CHỜ.
//
// VÌ SAO VẪN CẦN VẾ NÀY khi không có gì để vá: tính chất ấy có chủ ý nhưng VÔ DANH ở `requests.ts`
// (nay đã được đặt tên bằng một khối chú thích ở đó). Nó đứng nhờ hai điều có thể bị đổi mà không ai
// thấy — câu `FOR NO KEY UPDATE` trong trigger 019, và việc câu `INSERT` đứng trước lần ghi sổ. Đảo
// hai câu ấy, hay gỡ mệnh đề khoá khỏi trigger, thì khoản 140 thành thật ngay; và cái đỏ sẽ là vế ⑴
// dưới đây. Đây là chỗ khoản 140 được giữ ĐÓNG, không phải chỗ nó được vá.
// ================================================================================================
describe("[S1.76 / khoản 140] approveUnseal tuần tự hoá trên hàng TRƯỚC lần ghi sổ đầu", () => {
  const KHOA_GHI_SO_CUA_TO_CHUC =
    `SELECT pid, granted FROM pg_catalog.pg_locks
      WHERE locktype = 'advisory'
        AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid
        AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid`;

  it("người giữ hàng ⇒ approve kẹt TRƯỚC lần ghi sổ: khoá ghi sổ của tổ chức KHÔNG bị ai cầm, và lần ghi sổ của người giữ đi qua ngay", async () => {
    const rfqId = await taoRfqDaDong(false);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio", actorSessionId: sYc }, auditPool),
    );

    const giu = await apiPool.connect();
    const ke: string[] = [];
    let khoaTrongLucCho: unknown[] = [];
    let msGhiSoCuaNguoiGiu = -1;
    let ketQuaApprove = "chua-xong";
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      // Người giữ là `dispatchUnseal`, dùng NGUYÊN VĂN câu của nó (`requests.ts`). Chọn câu này chứ
      // không chọn câu của `cancelUnseal` là có chủ ý: câu của cancel đổi `status`, mà `status` nằm
      // trong vị từ của chỉ mục riêng phần `unseal_requests_mot_yeu_cau_dang_mo` (019) nên nó là một
      // KEY update — người giữ MẠNH hơn. Câu dưới KHÔNG chạm `status` nên chỉ `FOR NO KEY UPDATE`,
      // tức người giữ NHẸ NHẤT mà đường sản xuất dựng được; vế này đứng với người giữ nhẹ nhất thì
      // đứng với mọi người giữ.
      const u = await giu.query(
        "UPDATE public.unseal_requests SET dispatched_at = pg_catalog.now(), dispatched_by = $2, " +
          "dispatched_by_session_id = $3 WHERE id OPERATOR(pg_catalog.=) $1 AND org_id OPERATOR(pg_catalog.=) $4 AND dispatched_at IS NULL",
        [yc.id, uYc, sYc, orgA],
      );
      expect(u.rowCount, "đối chứng: người giữ phải THẬT SỰ khoá được hàng").toBe(1);

      const pApprove = withTenant(apiPool, orgA, (c) =>
        approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
      ).then(
        (r) => {
          ketQuaApprove = `xong status=${r.status}`;
          return r;
        },
        (e: unknown) => {
          ketQuaApprove = `ném code=${(e as { code?: string }).code ?? "?"}`;
          throw e;
        },
      );

      // Để approve chạy tới chỗ nó kẹt. 2 s là quá đủ: mọi câu trước đó của nó đều dưới 10 ms khi
      // không có tranh chấp (đo).
      await new Promise((r) => setTimeout(r, 2_000));

      khoaTrongLucCho = (await db.pool.query<Record<string, unknown>>(KHOA_GHI_SO_CUA_TO_CHUC, [orgA])).rows;

      // Lần ghi sổ của NGƯỜI GIỮ — đoạn sau của `dispatchUnseal`. Nếu approve đang cầm khoá ghi sổ
      // (tức khoản 140 có thật) thì câu này phải chờ tới trần 2 s của 050 rồi gãy 55P03.
      const t = Date.now();
      await giu.query(
        `SELECT seq FROM public.audit_append($1, 'SYSTEM', NULL, 'K140_DISPATCH', 'unseal_request', $2, '{}'::jsonb, NULL, NULL, NULL)`,
        [orgA, yc.id],
      );
      msGhiSoCuaNguoiGiu = Date.now() - t;

      // Nhả hàng ⇒ approve phải chạy tiếp và XONG. Vế này chứng rằng đây là một lần CHỜ, không phải
      // một vòng khoá chết: nếu có vòng, một trong hai bên đã chết bằng 40P01 trước khi tới đây.
      await giu.query("ROLLBACK");
      await pApprove;
      ke.push(`approve=${ketQuaApprove}`);
    } finally {
      await giu.query("ROLLBACK").catch(() => undefined);
      giu.release();
    }

    const keChung =
      `khoá ghi sổ của tổ chức trong lúc approve chờ: ${JSON.stringify(khoaTrongLucCho)}; ` +
      `lần ghi sổ của người giữ: ${msGhiSoCuaNguoiGiu} ms; ${ke.join(" ")}`;

    // ⑴ KHÔNG ai cầm khoá ghi sổ của tổ chức trong lúc approve chờ hàng. Đây là mệnh đề mà khoản 140
    //    khai ngược lại, và là vế sẽ ĐỎ nếu ai dời `INSERT` xuống sau `appendAuditEvent`.
    expect(khoaTrongLucCho, `approve KHÔNG được cầm khoá ghi sổ trong lúc chờ hàng — ${keChung}`).toEqual([]);
    // ⑵ Hệ quả đo được của ⑴: lần ghi sổ của người giữ đi qua NGAY, không chạm trần 2 s của 050.
    expect(msGhiSoCuaNguoiGiu, `lần ghi sổ của người giữ phải đi qua ngay — ${keChung}`).toBeLessThan(1_000);
    // ⑶ Và đây là một lần CHỜ, không phải khoá chết: nhả hàng thì approve xong bình thường.
    expect(ketQuaApprove, `nhả hàng thì approve phải chạy tiếp — ${keChung}`).toBe("xong status=APPROVED");
  }, 120_000);
});
