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

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { DenialAuditFailedError, moTaHangDongCuaLanTuChoi } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  UNSEAL_CLAUSES,
  UnsealDeniedError,
  UnsealError,
  approveUnseal,
  assertUnsealAllowed,
  cancelUnseal,
  dispatchUnseal,
  getOpenUnsealForRfq,
  getUnsealRequest,
  requestUnseal,
} from "./index.js";
// [S1.9145 / khoản 266] Tên ràng buộc mà bộ lọc "không tìm thấy" đọc — export KHỎI TỆP, không khỏi gói (cùng khuôn
// `laViPhamD2TheoThongDiep`): ca hai chiều dưới đây đối chiếu nó với thân hàm THẬT trong CSDL.
import { RANG_BUOC_KHONG_TIM_THAY_YEU_CAU } from "./requests.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

let db: TestDatabase;
let apiPool: pg.Pool;
/** Pool ghi sổ kiểm toán của `requirePermission` — phải là `app_api`, không phải superuser:
 * `audit_append` chạy dưới RLS và `WITH CHECK (org_id = app_current_org_id())`. */
let auditPool: pg.Pool;
let orgA: string;
/** Pool của vai `app_unseal` — đường của unseal-worker, và vai chạy câu `EXECUTED`. */
let unsealPool: pg.Pool;
/**
 * uYc yêu cầu (PROCUREMENT_MANAGER), uD1/uD2 duyệt (DIRECTOR), uKhong không có quyền nào.
 *
 * `uYc2` là một PROCUREMENT_MANAGER THỨ HAI, và nó có mặt vì một lý do đo được: ca điều phối
 * lại dùng `sYcB` — phiên khác của CÙNG người — nên nó không phân biệt được trường NGƯỜI của
 * cặp cũ. Đột biến ghi `previousDispatchedBy` thành người MỚI SỐNG qua ca ấy (đo ở S1.103).
 */
let uYc: string, uYc2: string, uD1: string, uD2: string, uKhong: string;
let sYc: string, sD1: string, sD2: string, sKhong: string, sYcB: string, sYc2: string;
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
  // Hai phê duyệt RFQ (khác với phê duyệt MỞ THẦU) để cạnh PENDING_APPROVAL -> OPEN đi được.
  // [S1.142 / khoản 241] Gói dưới ngưỡng cũng cần MỘT — sàn một chữ ký của `068`.
  const nguoiKy: readonly (readonly [string, string])[] = capKep
    ? [
        [uD1, sD1],
        [uD2, sD2],
      ]
    : [[uD1, sD1]];
  for (const [u, s] of nguoiKy) {
    await db.pool.query(
      "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) " +
        "VALUES ($1, $2, $3, $4)",
      [orgA, rfqId, u, s],
    );
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
  uYc2 = await taoNguoi("yc2@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi("d1@vidu.vn", "DIRECTOR");
  uD2 = await taoNguoi("d2@vidu.vn", "DIRECTOR");
  uKhong = await taoNguoi("khong@vidu.vn", "TECHNICAL");

  sYc = await taoPhien(uYc);
  sYcB = await taoPhien(uYc);
  sYc2 = await taoPhien(uYc2);
  sD1 = await taoPhien(uD1);
  sD2 = await taoPhien(uD2);
  sKhong = await taoPhien(uKhong);

  const cs = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [orgA, uYc, sYc],
  );
  csA = cs.rows[0]?.id ?? "";
  expect(
    [orgA, uYc, uYc2, uD1, uD2, uKhong, sYc, sD1, sD2, sKhong, sYcB, sYc2, csA].filter((x) => x === ""),
  ).toEqual([]);
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
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
      // [S1.100 / khoản 216] `ENABLE ALWAYS` là một PHẦN của trigger này (045), nên một lượt khôi phục
      // thiếu nó trả lại một trigger YẾU HƠN bản bị gỡ: nó thôi chạy dưới `session_replication_role =
      // replica`. Không test nào trong tệp này đặt GUC ấy, nên nó chưa hại ai — nhưng một lượt khôi phục
      // không khôi phục là đúng lớp lỗi mà khoản 145 và S1.86 đã trả giá một lần.
      await db.pool.query(
        "ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_du_phe_duyet",
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
      // [S1.100 / khoản 216] Cùng lý do: 045 đưa trigger này lên `ENABLE ALWAYS`.
      await db.pool.query(
        "ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_canh_bao_break_glass",
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
// [S1.96 / khoản 130 + 159] MỘT JOB MỞ THẦU ĐÃ CHẾT PHẢI ĐIỀU PHỐI LẠI ĐƯỢC
//
// §11 đòi *"không một bước nào cần người của dự án can thiệp bằng tay"*. Trước vòng này, job
// `UNSEAL_RFQ` hết `maxAttempts` thì vào `FAILED` — trạng thái không có cạnh nào đi ra — và
// đường phục hồi duy nhất qua API là huỷ yêu cầu, tạo yêu cầu mới, gom lại ĐỦ HAI phê duyệt.
// ===============================================================================================
interface HangDieuPhoi {
  readonly status: string;
  readonly dispatched_at: Date | null;
  readonly dispatched_by: string | null;
  readonly dispatched_by_session_id: string | null;
}

async function docHangDieuPhoi(requestId: string): Promise<HangDieuPhoi> {
  const { rows } = await db.pool.query<HangDieuPhoi>(
    "SELECT status, dispatched_at, dispatched_by, dispatched_by_session_id FROM unseal_requests WHERE id = $1",
    [requestId],
  );
  const r = rows[0];
  if (r === undefined) throw new Error("khong tim thay unseal_requests");
  return r;
}

async function ketCucJob(requestId: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ status: string }>(
    "SELECT status FROM outbox_jobs WHERE dedupe_key = $1 ORDER BY created_at",
    [`unseal:${requestId}`],
  );
  return rows.map((r) => r.status);
}

/** Đốt job đúng như `JobRunner` làm sau `maxAttempts`: `FAILED` + `finished_at` (hai CHECK của 007 khoá chúng với nhau). */
async function dotHetLuot(requestId: string): Promise<void> {
  await db.pool.query(
    "UPDATE outbox_jobs SET status = 'FAILED', finished_at = now(), last_failure_reason = 'HANDLER_ERROR' " +
      " WHERE dedupe_key = $1 AND status <> 'FAILED'",
    [`unseal:${requestId}`],
  );
}

describe("[khoản 130] điều phối lại sau khi job chết", () => {
  it("job FAILED ⇒ xếp job MỚI, đổi cặp người-phiên sang người vừa qua cổng, GIỮ NGUYÊN dispatched_at, và để lại hàng sổ MANG CẢ HAI CẶP", async () => {
    const { rfqId, requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    const truoc = await docHangDieuPhoi(requestId);
    expect(truoc.dispatched_by_session_id, "tiền đề: lần điều phối đầu đã ghi phiên của người bấm").toBe(sYc);

    await dotHetLuot(requestId);
    expect(await ketCucJob(requestId)).toEqual(["FAILED"]);

    // `sYcB` là phiên KHÁC của cùng người: đủ để cặp ĐỔI, nên nó chạm đúng trigger của khoản 159.
    const bangChung = await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYcB }, auditPool),
    );
    expect(bangChung.clauses, "điều phối lại đi TRỌN cổng bốn vế, không phải một lối tắt").toHaveLength(4);

    const sau = await docHangDieuPhoi(requestId);
    expect(sau.dispatched_at, "mốc điều phối ĐẦU là bất biến — `unseal_dieu_phoi_mot_lan` (022) canh nó").toEqual(
      truoc.dispatched_at,
    );
    expect(sau.dispatched_by_session_id, "cặp người-phiên chuyển sang phiên vừa qua cổng với MFA tươi").toBe(sYcB);

    expect(await ketCucJob(requestId), "job cũ ở lại làm dấu vết, job mới đứng cạnh nó").toEqual([
      "FAILED",
      "PENDING",
    ]);

    const { rows: so } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'UNSEAL_REDISPATCHED' AND resource_id = $1",
      [requestId],
    );
    expect(so[0]?.n, "D5: lần điều phối lại để lại đúng một hàng sổ").toBe("1");

    // [S1.103 / khoản 208] ĐẾM HÀNG KHÔNG ĐO ĐƯỢC NỘI DUNG. Sau câu `UPDATE` ở trên,
    // `dispatched_at` còn giữ mốc của lần điều phối ĐẦU nhưng `dispatched_by_session_id`
    // đã là của người bấm lại — nên `sYc` không còn đứng ở một CỘT nào, và `audit_events`
    // thì không có cột phiên. Hàng sổ này là nơi duy nhất nó còn sống. Phép đo trước khi
    // vá: gỡ trọn payload thì cả 58 ca của tệp này VẪN XANH.
    const { rows: noiDung } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE action = 'UNSEAL_REDISPATCHED' AND resource_id = $1",
      [requestId],
    );
    expect(
      noiDung[0]?.payload,
      "hàng sổ nối MỐC của lần đầu với CẶP của lần đang chạy — `toEqual` để một trường bị bỏ quên cũng đỏ",
    ).toEqual({
      rfqId,
      clauses: [...bangChung.clauses],
      breakGlass: bangChung.breakGlass,
      previousDispatchedBy: uYc,
      previousDispatchedBySessionId: sYc,
      dispatchedBy: uYc,
      dispatchedBySessionId: sYcB,
    });
  });

  // [S1.103 / khoản 208] CA NGAY TRÊN KHÔNG ĐO ĐƯỢC NỬA KIA CỦA CẶP. Nó bấm lại bằng `sYcB`,
  // một phiên KHÁC của CÙNG người, nên `previousDispatchedBy` mang đúng giá trị mà
  // `dispatchedBy` cũng mang — một đột biến ghi nhầm cặp cũ thành cặp mới ở trường NGƯỜI
  // SỐNG sót qua nó (đo thật, S1.103). Ca này đóng nửa ấy bằng một người bấm lại KHÁC hẳn,
  // và nó là hình dạng THẬT của đường phục hồi: người bấm lại thường không phải người bấm
  // lần đầu, vì lần đầu đã thất bại.
  it("[khoản 208] người bấm lại là người KHÁC ⇒ hàng sổ giữ cả NGƯỜI lẫn PHIÊN của lần điều phối ĐẦU", async () => {
    const { rfqId, requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    const truoc = await docHangDieuPhoi(requestId);
    expect([truoc.dispatched_by, truoc.dispatched_by_session_id], "tiền đề: lần đầu là uYc/sYc").toEqual([
      uYc,
      sYc,
    ]);
    await dotHetLuot(requestId);

    const bangChung = await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc2 }, auditPool),
    );
    expect(bangChung.userId, "tiền đề: người bấm lại đi TRỌN cổng bốn vế bằng danh tính của chính họ").toBe(
      uYc2,
    );

    const sau = await docHangDieuPhoi(requestId);
    expect(
      [sau.dispatched_by, sau.dispatched_by_session_id],
      "hai cột chỉ còn người của lần ĐANG CHẠY — cặp của lần đầu rời khỏi bảng từ đây",
    ).toEqual([uYc2, sYc2]);
    expect(sau.dispatched_at, "còn mốc thì vẫn của lần ĐẦU — đúng thứ làm hàng thành phát biểu ghép").toEqual(
      truoc.dispatched_at,
    );

    const { rows: noiDung } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE action = 'UNSEAL_REDISPATCHED' AND resource_id = $1",
      [requestId],
    );
    expect(noiDung[0]?.payload, "cặp CŨ — cả người lẫn phiên — chỉ còn sống ở hàng sổ này").toEqual({
      rfqId,
      clauses: [...bangChung.clauses],
      breakGlass: bangChung.breakGlass,
      previousDispatchedBy: uYc,
      previousDispatchedBySessionId: sYc,
      dispatchedBy: uYc2,
      dispatchedBySessionId: sYc2,
    });
  });

  it("còn một lượt ĐANG SỐNG thì từ chối — đây không phải đường bấm hai lần cho nhanh", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYcB }, auditPool),
      ),
    ).rejects.toThrow(/vẫn còn một lượt đang chờ chạy/u);
    expect(await ketCucJob(requestId), "không job thứ hai nào được xếp").toEqual(["PENDING"]);
    expect((await docHangDieuPhoi(requestId)).dispatched_by_session_id, "và cặp người-phiên KHÔNG đổi").toBe(sYc);
  });

  // ĐO CÁI GÌ: rằng CỔNG BỐN VẾ từ chối trước, chứ không phải vế trạng thái bên trong nhánh phục
  // hồi. Đột biến tắt vế bên trong SỐNG, và đó là kết quả ĐÚNG — xem khối chú thích ở `requests.ts`.
  it("yêu cầu không còn APPROVED thì CỔNG từ chối trước khi nhánh phục hồi kịp chạy — không mở thầu lại thứ đã mở", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    await dotHetLuot(requestId);
    await db.pool.query(
      "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1",
      [requestId],
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYcB }, auditPool),
      ),
    ).rejects.toBeInstanceOf(UnsealDeniedError);
    expect(await ketCucJob(requestId), "và không job nào được xếp thêm").toEqual(["FAILED"]);
  });
});

describe("[khoản 159] cặp người-phiên điều phối được kiểm ở MỌI lần ghi, không chỉ lần đầu", () => {
  it("ghi đè bằng một phiên KHÔNG TỒN TẠI bị chặn — trước S1.96 lối này đi lọt vì mệnh đề WHEN chỉ canh lần đầu", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    const phienMa = randomUUID();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE unseal_requests SET dispatched_by = $1, dispatched_by_session_id = $2 WHERE id = $3", [
          uYc,
          phienMa,
          requestId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await docHangDieuPhoi(requestId)).dispatched_by_session_id, "hàng giữ nguyên cặp cũ").toBe(sYc);
  });

  it("ghi đè bằng phiên ĐÃ THU HỒI cũng bị chặn — đây là ca mà khoản 159 gọi là nặng nhất", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    const sThuHoi = await taoPhien(uYc);
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sThuHoi]);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE unseal_requests SET dispatched_by = $1, dispatched_by_session_id = $2 WHERE id = $3", [
          uYc,
          sThuHoi,
          requestId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("ĐỐI CHỨNG — đường hợp lệ KHÔNG gãy: tuyên bố EXECUTED không đụng cặp nên trigger không fire", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    // Phiên của người điều phối đóng lại — đúng cảnh mà khoản 159 cảnh báo là sẽ gãy nếu bỏ hẳn mệnh đề `WHEN`.
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sYc]);
    const kq = await db.pool.query(
      "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1",
      [requestId],
    );
    expect(kq.rowCount, "lần ghi KHÔNG đổi cặp vẫn đi qua, dù phiên điều phối đã thu hồi").toBe(1);
    await db.pool.query("UPDATE sessions SET revoked_at = NULL WHERE id = $1", [sYc]);
  });
});

// ===============================================================================================
// [INV-D3] [khoản 209 + 210] CẶP NHÂN CHỨNG BREAK-GLASS — BẤT BIẾN SAU KHI SINH, VÀ KHÔNG GÁC
// CÂU `EXECUTED` CỦA WORKER
//
// Hai khoản khoá lẫn nhau nên chúng được đo trong CÙNG một khối. 022 mục (4) dựng nhân chứng làm
// *"mức thấp nhất còn giữ được D3"* khi đường phê duyệt bị bỏ — nhưng nó canh mức ấy ở đúng MỘT
// CẠNH (`→ APPROVED`), và hai cột nhân chứng KHÔNG nằm trong danh sách bất biến của
// `unseal_kiem_chuyen_trang_thai`. Còn trigger canh danh tính thì gác MỌI lần ghi, kể cả câu
// `EXECUTED` của worker — nên một phiên nhân chứng chết làm chính lượt mở thầu khẩn cấp bất khả.
//
// Trước vòng này `INV-D3` có ba tệp, và chúng đo D3 ở mức VAI TRÒ và QUYỀN — kể cả một khối *phân
// tách nhiệm vụ ở mức người dùng* ở `rbac.int.test.ts`. Không tệp nào đo đường BREAK-GLASS, tức đúng
// chỗ chuỗi nằm trọn trong tay một người được sau khi đường phê duyệt đã bị bỏ.
// ===============================================================================================
describe("[INV-D3] [khoản 209 + 210] cặp nhân chứng break-glass", () => {
  /** Một yêu cầu break-glass ĐÃ `APPROVED` — đường riêng của D4: không cần một phê duyệt nào. */
  async function breakGlassDaDuyet(phienNhanChung = sD1): Promise<{ rfqId: string; requestId: string }> {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(
        c,
        orgA,
        {
          rfqId,
          reason: "su co: can mo ngay",
          actorSessionId: sYc,
          breakGlass: true,
          breakGlassWitnessSessionId: phienNhanChung,
        },
        auditPool,
      ),
    );
    const { rowCount } = await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yc.id]),
    );
    expect(rowCount, "break-glass sang APPROVED không cần phê duyệt nào (D4)").toBe(1);
    return { rfqId, requestId: yc.id };
  }

  /**
   * Thông điệp của một lần từ chối, KHÔNG đi qua `expect.stringContaining` trong
   * `toMatchObject`: bộ khớp bất đối xứng ấy trả `any`, và `no-unsafe-assignment` chặn đúng.
   * Ở đây cần CẢ mã lỗi lẫn thông điệp từ CÙNG một lần thử, nên bắt lỗi rồi khẳng định hai vế.
   */
  const thongDiep = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  async function docNhanChung(requestId: string): Promise<{ u: string | null; s: string | null }> {
    const { rows } = await db.pool.query<{ u: string | null; s: string | null }>(
      "SELECT break_glass_witness_user_id AS u, break_glass_witness_session_id AS s " +
        "  FROM unseal_requests WHERE id = $1",
      [requestId],
    );
    return rows[0] ?? { u: null, s: null };
  }

  it("[INV-D3] [khoản 209] `app_api` KHÔNG có quyền UPDATE trên hai cột nhân chứng — 42501", async () => {
    const { requestId } = await breakGlassDaDuyet();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "UPDATE unseal_requests SET break_glass_witness_user_id = $1, " +
            "  break_glass_witness_session_id = $2 WHERE id = $3",
          [uYc, sYcB, requestId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await docNhanChung(requestId), "hàng giữ nguyên cặp nhân chứng gốc").toEqual({ u: uD1, s: sD1 });
  });

  it("[INV-D3] [khoản 209] lớp trigger chặn CẢ khi người gọi có quyền cột: 23514 gọi tên D3", async () => {
    const { requestId } = await breakGlassDaDuyet();
    const loi: unknown = await db.pool
      .query(
        "UPDATE unseal_requests SET break_glass_witness_user_id = $1, " +
          "  break_glass_witness_session_id = $2 WHERE id = $3",
        [uYc, sYcB, requestId],
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(loi, "câu UPDATE phải bị TỪ CHỐI, không phải đi qua").toMatchObject({ code: "23514" });
    expect(thongDiep(loi)).toContain("Khong doi duoc nguoi lam chung break-glass");
    expect(await docNhanChung(requestId)).toEqual({ u: uD1, s: sD1 });
  });

  it("[INV-D3] [khoản 209] ĐỘT BIẾN: gỡ trigger cột bất biến thì ĐÚNG câu ấy ĐI LỌT", async () => {
    const { requestId } = await breakGlassDaDuyet();
    await db.pool.query("DROP TRIGGER unseal_requests_kiem_chuyen_trang_thai ON unseal_requests");
    try {
      const { rowCount } = await db.pool.query(
        "UPDATE unseal_requests SET break_glass_witness_user_id = $1, " +
          "  break_glass_witness_session_id = $2 WHERE id = $3",
        [uYc, sYcB, requestId],
      );
      expect(rowCount, "không có trigger thì người yêu cầu tự làm chứng cho chính mình").toBe(1);
      expect(await docNhanChung(requestId)).toEqual({ u: uYc, s: sYcB });
    } finally {
      await db.pool.query(
        "CREATE TRIGGER unseal_requests_kiem_chuyen_trang_thai BEFORE UPDATE ON unseal_requests " +
          " FOR EACH ROW EXECUTE FUNCTION public.unseal_kiem_chuyen_trang_thai()",
      );
      await db.pool.query(
        "ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_chuyen_trang_thai",
      );
      const { rows } = await db.pool.query<{ e: string }>(
        "SELECT tgenabled::text AS e FROM pg_trigger " +
          " WHERE tgname = 'unseal_requests_kiem_chuyen_trang_thai' AND NOT tgisinternal",
      );
      expect(rows[0]?.e, "khôi phục phải trả lại ENABLE ALWAYS, không chỉ trả lại trigger").toBe("A");
    }
  });

  it("[INV-D3] [khoản 210] phiên nhân chứng bị THU HỒI: câu `EXECUTED` của worker VẪN đi được", async () => {
    const { requestId } = await breakGlassDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    // Nhân chứng đăng xuất — hay bị đình chỉ, hay TTL 8 giờ hết. Đúng cảnh mà khoản 210 dựng.
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sD1]);
    try {
      const kq = await withTenant(unsealPool, orgA, (c) =>
        c.query(
          "UPDATE public.unseal_requests SET status = 'EXECUTED', executed_at = pg_catalog.now() " +
            " WHERE id = $1 AND org_id = $2 AND status = 'APPROVED'",
          [requestId, orgA],
        ),
      );
      expect(kq.rowCount, "một phiên nhân chứng chết KHÔNG được làm lượt mở thầu khẩn cấp bất khả").toBe(1);
    } finally {
      await db.pool.query("UPDATE sessions SET revoked_at = NULL WHERE id = $1", [sD1]);
    }
  });

  // [S1.218 / khoản 160] Khoản 160 khai "MỌI `UPDATE` về sau trên một hàng break-glass đã có nhân
  // chứng đòi phiên nhân chứng còn sống", và S1.96 thêm lối điều phối lại (`dieuPhoiLaiSauKhiChet`)
  // làm chỗ thứ hai nó cắn được. `055` mục (3) thu trigger về `BEFORE INSERT` nên cả hai chỗ đều
  // hết cắn: ca ngay trên đo câu `EXECUTED`, hai ca dưới đo lối điều phối lại — đường mà chưa ca nào
  // dựng đúng cảnh "nhân chứng chết GIỮA lần điều phối và lần bấm lại".
  it("[INV-D3] [S1.218 / khoản 160] phiên nhân chứng bị THU HỒI: ĐIỀU PHỐI LẠI sau khi job chết VẪN đi được — câu đổi cặp người-phiên không hỏi nhân chứng nữa", async () => {
    const { requestId } = await breakGlassDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    await dotHetLuot(requestId);
    // Nhân chứng đăng xuất SAU lần điều phối đầu và TRƯỚC lần bấm lại — đúng cảnh khoản 160 chưa đo.
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sD1]);
    try {
      const bangChung = await withTenant(apiPool, orgA, (c) =>
        dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYcB }, auditPool),
      );
      expect(bangChung.breakGlass, "tiền đề: đây là đường break-glass").toBe(true);
      expect(await ketCucJob(requestId), "job cũ ở lại làm dấu vết, job mới đứng cạnh nó").toEqual(["FAILED", "PENDING"]);
      expect((await docHangDieuPhoi(requestId)).dispatched_by_session_id).toBe(sYcB);
      expect(await docNhanChung(requestId), "cặp nhân chứng gốc giữ nguyên — lối này không chạm nó").toEqual({ u: uD1, s: sD1 });
      const { rows } = await db.pool.query<{ payload: { breakGlass?: unknown } }>(
        "SELECT payload FROM audit_events WHERE action = 'UNSEAL_REDISPATCHED' AND resource_id = $1",
        [requestId],
      );
      expect(rows.map((r) => r.payload.breakGlass), "D4: hàng sổ điều phối lại vẫn nói đây là break-glass").toEqual([true]);
    } finally {
      await db.pool.query("UPDATE sessions SET revoked_at = NULL WHERE id = $1", [sD1]);
    }
  });

  it("[INV-D3] [S1.218 / khoản 160] ĐỘT BIẾN: trả trigger nhân chứng về hình `022` (`BEFORE INSERT OR UPDATE`) thì ĐÚNG lối điều phối lại ấy GÃY 23514 — rồi trả lại hình `055`", async () => {
    const docDinhNghia = async (): Promise<readonly (readonly [string, string])[]> => {
      const { rows } = await db.pool.query<{ e: string; d: string }>(
        "SELECT tgenabled::text AS e, pg_get_triggerdef(oid) AS d FROM pg_trigger " +
          " WHERE tgname = 'unseal_requests_kiem_nhan_chung' AND NOT tgisinternal",
      );
      return rows.map((r) => [r.e, r.d] as const);
    };
    const hinh055 = await docDinhNghia();
    expect(hinh055, "tiền đề: trigger đang ở hình `055` — `BEFORE INSERT`, ENABLE ALWAYS").toHaveLength(1);
    expect(hinh055[0]?.[0]).toBe("A");
    expect(hinh055[0]?.[1]).toMatch(/ BEFORE INSERT ON public\.unseal_requests /u);

    const { requestId } = await breakGlassDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    await dotHetLuot(requestId);
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sD1]);
    await db.pool.query("DROP TRIGGER unseal_requests_kiem_nhan_chung ON unseal_requests");
    try {
      await db.pool.query(
        "CREATE TRIGGER unseal_requests_kiem_nhan_chung BEFORE INSERT OR UPDATE ON unseal_requests " +
          " FOR EACH ROW WHEN (NEW.break_glass_witness_user_id IS NOT NULL) " +
          " EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('break_glass_witness_user_id', 'break_glass_witness_session_id')",
      );
      await db.pool.query("ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nhan_chung");
      await expect(
        withTenant(apiPool, orgA, (c) =>
          dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYcB }, auditPool),
        ),
      ).rejects.toMatchObject({ code: "23514", message: /Phien khong hop le/u });
      expect(await ketCucJob(requestId), "không job nào được xếp — đúng cảnh khoản 160 mô tả").toEqual(["FAILED"]);
    } finally {
      await db.pool.query("UPDATE sessions SET revoked_at = NULL WHERE id = $1", [sD1]);
      await db.pool.query("DROP TRIGGER IF EXISTS unseal_requests_kiem_nhan_chung ON unseal_requests");
      await db.pool.query(
        "CREATE TRIGGER unseal_requests_kiem_nhan_chung BEFORE INSERT ON unseal_requests " +
          " FOR EACH ROW WHEN (NEW.break_glass_witness_user_id IS NOT NULL) " +
          " EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('break_glass_witness_user_id', 'break_glass_witness_session_id')",
      );
      await db.pool.query("ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_nhan_chung");
      expect(await docDinhNghia(), "khôi phục phải trả lại ĐÚNG định nghĩa `055`, kể cả ENABLE ALWAYS").toEqual(hinh055);
    }
  });

  it("[INV-D3] [khoản 210] ĐỐI CHỨNG DƯƠNG: nhân chứng BỊA lúc CHÈN vẫn bị chặn — thu hẹp `WHEN` không tắt lớp", async () => {
    const rfqId = await taoRfqDaDong();
    await expect(
      db.pool.query(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, break_glass, requested_by, " +
          "  requested_by_session_id, break_glass_witness_user_id, break_glass_witness_session_id) " +
          "VALUES ($1, $2, 'su co: can mo ngay', true, $3, $4, $5, $6)",
        [orgA, rfqId, uYc, sYc, uD1, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514", message: /Phien khong hop le/u });
  });

  it("[INV-D3] [khoản 210] ĐỐI CHỨNG DƯƠNG: nhân chứng KHÔNG khớp chủ phiên bị chặn lúc CHÈN", async () => {
    const rfqId = await taoRfqDaDong();
    await expect(
      db.pool.query(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, break_glass, requested_by, " +
          "  requested_by_session_id, break_glass_witness_user_id, break_glass_witness_session_id) " +
          "VALUES ($1, $2, 'su co: can mo ngay', true, $3, $4, $5, $6)",
        [orgA, rfqId, uYc, sYc, uD1, sD2],
      ),
    ).rejects.toMatchObject({ code: "23514", message: /khong khop chu phien/u });
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
// [S1.77 / khoản 140] `approveUnseal` TUẦN TỰ HOÁ TRÊN HÀNG YÊU CẦU **TRƯỚC** LẦN GHI SỔ ĐẦU
//
// Khoản 140 mở ở S1.73 với lời đọc: *"`approveUnseal` INSERT một phê duyệt, ghi sổ, rồi UPDATE
// `unseal_requests` — nếu một giao dịch khác đang giữ khoá hàng thì lần phê duyệt đứng chờ TRONG KHI
// giữ khoá ghi sổ của tổ chức, đúng lớp lỗi của khoản 126."* **Phép đo BÁC lời ấy** (§S1.77).
//
// Thứ lời đọc bỏ sót nằm trong chính câu đầu nó nhắc tới: `INSERT INTO public.unseal_approvals` bắn
// trigger `unseal_approvals_kiem_nguoi_duyet` (019, BEFORE INSERT), và thân hàm ấy mở đầu bằng
// `SELECT … FROM public.unseal_requests … FOR NO KEY UPDATE`. Tức câu INSERT **giữ khoá hàng yêu cầu**
// — và nó đứng TRƯỚC `appendAuditEvent`.
//
// LẬP LUẬN ĐÓNG KÍN — mạnh hơn "ba kịch bản cùng chiều", vì nó không phụ thuộc vào việc đã liệt đủ
// người giữ hay chưa [lượt soi 71 / L71D-6]: khoá mà trigger lấy ở câu INSERT là `FOR NO KEY UPDATE`
// (019:207), **đúng bằng** mức mà câu `UPDATE … SET status = 'APPROVED', approved_at = …` ở cuối hàm
// cần (`status`/`approved_at` không phải cột khoá: hai chỉ mục duy nhất góp key_attrs của
// `unseal_requests` là `unseal_requests_pkey (id)` và `UNIQUE (org_id, id)` — 019:63). Hai câu cùng
// một chế độ khoá ⇒ tập người giữ chặn được câu SAU lần ghi sổ TRÙNG KHÍT tập người giữ chặn được câu
// TRƯỚC nó ⇒ **không tồn tại khe nào** để approve vừa cầm khoá ghi sổ vừa còn phải chờ hàng.
//
// Bản đầu của khối này ghi rằng khoá đến từ KHOÁ NGOẠI `(org_id, unseal_request_id)` và gọi tính chất
// ấy là "tình cờ". **Sai cả hai vế** (lượt soi 71): khoá đến từ một câu `FOR NO KEY UPDATE` viết
// TƯỜNG MINH trong trigger cưỡng chế D2, tức nó là một lựa chọn CÓ CHỦ Ý, không phải may mắn. Và nó
// giải thích đúng số đo, trong khi lời khoá-ngoại thì không: `FOR KEY SHARE` của một phép kiểm khoá
// ngoại KHÔNG xung đột `FOR NO KEY UPDATE`, nên nếu khoá chỉ đến từ khoá ngoại thì người giữ dưới đây
// đã phải đi lọt — đo thì nó CHỜ.
//
// ĐỘT BIẾN NÀO LÀM VẾ NÀY ĐỎ, VÀ ĐỎ BẰNG CÁCH NÀO — ĐÃ ĐO, không suy
// [lượt soi 71 / G2-1, G2-4; bảng đo ở §S1.77 mục 4]:
//   ⒜ dời câu `INSERT` xuống SAU `appendAuditEvent`  → **ĐỎ** bằng `40P01 deadlock detected` ném từ
//        chính câu INSERT; KHÔNG vế `expect` nào chạy tới. Đó là hình dạng khoản 140 khi nó CÓ THẬT:
//        approve cầm khoá ghi sổ rồi chờ hàng, người giữ chờ lại khoá ghi sổ ⇒ vòng khép kín ⇒ bộ dò
//        khoá chết bắn ở `deadlock_timeout` 1 s, TRƯỚC trần 2 s của 050 (xem khoản 143).
//   ⒝ gỡ `FOR NO KEY UPDATE` khỏi thân trigger 019   → **ĐỎ** ở vòng chờ có hạn dưới đây
//   ⒞ bỏ KHOÁ NGOẠI `(org_id, unseal_request_id)`    → **XANH NGUYÊN**
//   ⒟ tắt hẳn trigger `unseal_approvals_kiem_nguoi_duyet` → **ĐỎ**, cùng cách với ⒝
// Tức KHÔNG đột biến nào ở trên bị một vế `expect` bắt — chúng chết sớm hơn. Vế `expect` canh một ca
// khác, và ca ấy mới là ca im lặng: approve cầm khoá ghi sổ mà KHÔNG khép thành vòng (người giữ không
// ghi sổ ⇒ không có khoá chết). Chỉ một khẳng định trên `pg_locks` thấy được ca ấy.
// ⒞ là vế chịu lực của cả lời giải thích: khoá ngoại KHÔNG giữ vế này, câu `FOR NO KEY UPDATE` mới
// giữ. Bản đầu của khối này khai ngược lại, và khai sai.
//
// CÁCH DỰNG LẠI ⒝/⒟ — đọc trước khi thử, vì đường hiển nhiên KHÔNG đo gì cả: sửa thân hàm trong
// `db/migrations/019_unseal.sql` thì `hardening.always.sql` **âm thầm phục hồi nó** (nó chạy
// `CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet()`), và test báo XANH — một đột biến
// "sống" GIẢ. Sửa cả hai tệp thì bước phán xét của hardening chặn `migrate()`. Đường đo được là đột
// biến LÚC CHẠY, sau khi migrate + hardening đã xong:
//   `SELECT pg_get_functiondef(to_regprocedure('public.unseal_kiem_nguoi_duyet()'))` → bỏ mệnh đề
//   khoá khỏi chuỗi ấy → chạy lại chính chuỗi ấy.
// Đây là chỗ khoản 140 được giữ ĐÓNG, không phải chỗ nó được vá.
// ================================================================================================
describe("[S1.77 / khoản 140] approveUnseal tuần tự hoá trên hàng TRƯỚC lần ghi sổ đầu", () => {
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
    let approveDangCho = "chưa-thấy";
    let msGhiSoCuaNguoiGiu = -1;
    let ketQuaApprove = "chua-xong";
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      // Người giữ dùng NGUYÊN VĂN câu của `dispatchUnseal` (`requests.ts`). Câu ấy lấy
      // `FOR NO KEY UPDATE` — **đúng bằng** chế độ mà câu `UPDATE … SET status = 'APPROVED'` ở cuối
      // `approveUnseal` lấy, và cũng đúng bằng chế độ trigger lấy ở câu INSERT. Nên người giữ này
      // nằm ngay trên đường biên: nó là người giữ NHẸ NHẤT còn chặn được câu UPDATE cuối. Nếu khoản
      // 140 có thật thì nó phải lọt qua câu INSERT rồi kẹt ở câu UPDATE — đo thì nó kẹt ở INSERT.
      //
      // [lượt soi 71 / G2-6, L71D-3] Bản đầu của khối này viết rằng câu của `cancelUnseal` (đổi
      // `status`) là một KEY update vì `status` nằm trong vị từ của chỉ mục riêng phần
      // `unseal_requests_mot_yeu_cau_dang_mo` (019:73-74). **SAI:** Postgres chỉ tính là cột khoá
      // các cột của một chỉ mục unique KHÔNG riêng phần và KHÔNG biểu thức, nên đổi `status` vẫn chỉ
      // là `FOR NO KEY UPDATE` — hai người giữ ấy CÙNG một chế độ khoá, không ai nhẹ hơn ai.
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
      // [lượt soi 71 / G2-5] Nếu thân test ném trước `await pApprove`, lời hứa trên thành unhandled
      // rejection và Node giết cả tiến trình. Gắn một tay bắt câm — vế `expect` dưới đọc
      // `ketQuaApprove`, không đọc lời hứa này.
      void pApprove.catch(() => undefined);

      // [lượt soi 71 / G2-2] KHÔNG dùng sleep cứng. Dưới tải, một sleep cứng có thể chụp lúc approve
      // CHƯA tới câu INSERT; khi ấy cả ba vế dưới đều xanh — kể cả trên bản đột biến ⒜, vì lúc chụp
      // nó cũng chưa lấy khoá ghi sổ. Đó là chiều hỏng IM LẶNG (xanh giả) nên nó không bao giờ tự lộ.
      //
      // ĐỪNG ĐỌC VÒNG NÀY LÀ "THÊM RĂNG": đo rồi, và bản sleep cứng CŨNG bắt được cả ⒝ lẫn ⒟ trên máy
      // chạy phép đo này (§S1.77 mục 4). Thứ vòng này bỏ đi là chỗ PHỤ THUỘC THỜI GIAN — bản cũ chụp
      // ở mốc 2 s rồi TIN rằng approve đã kẹt; bản này KHẲNG ĐỊNH điều ấy trước khi đo. Chiều hỏng mà
      // lượt soi 71 nêu không dựng lại được theo yêu cầu ở đây, nên đây là một phép PHÒNG, không phải
      // một bản vá cho lỗi đã quan sát được.
      // Vòng dưới biến "approve đang kẹt" từ giả định thành KHẲNG ĐỊNH: chờ tới khi thấy chính câu
      // `INSERT … unseal_approvals` của nó nằm trong `pg_stat_activity` với `wait_event_type='Lock'`
      // và `wait_event='transactionid'` — đúng thứ §S1.77 mục 3 chụp tay — rồi mới đo.
      const han = Date.now() + 30_000;
      for (;;) {
        const { rows } = await db.pool.query<{ pid: number; wait_event: string; q: string }>(
          "SELECT pid, wait_event, left(query, 60) AS q FROM pg_catalog.pg_stat_activity " +
            "WHERE datname OPERATOR(pg_catalog.=) pg_catalog.current_database() " +
            "AND wait_event_type OPERATOR(pg_catalog.=) 'Lock' AND wait_event OPERATOR(pg_catalog.=) 'transactionid' " +
            "AND query ILIKE '%unseal_approvals%'",
        );
        const r = rows[0];
        if (r !== undefined) {
          approveDangCho = `pid=${r.pid} wait_event=${r.wait_event} query=${r.q.replace(/\s+/g, " ")}`;
          break;
        }
        if (Date.now() > han)
          throw new Error(
            "hết 30000ms: KHÔNG thấy approve kẹt trên hàng yêu cầu. Hai cách đọc, cả hai đều phải ĐỎ " +
              "chứ không được báo xanh: ⑴ HỒI QUY — câu INSERT thôi không còn giữ khoá hàng, nên approve " +
              "đi thẳng qua lần ghi sổ rồi mới kẹt ở câu UPDATE cuối, tức khoản 140 vừa thành THẬT " +
              "(đo được: đây đúng là thứ đột biến ⒝ và ⒟ gây ra); ⑵ đồ gá hỏng hoặc máy quá chậm, và " +
              "khi ấy ba vế dưới sẽ xanh RỖNG RUỘT. Xem [lượt soi 71 / G2-2].",
          );
        await new Promise((xong) => setTimeout(xong, 20));
      }

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

    // [lượt soi 71 / G3-5] ĐỐI CHỨNG DƯƠNG của phép dò. Vế ⑴ dưới là một khẳng định RỖNG
    // (`toEqual([])`), nên một phép dò hỏng — sai chuỗi băm, sai kiểu, sai `orgA` — làm nó xanh mãi
    // mãi. Chạy lại ĐÚNG câu dò ấy trong một giao dịch đang cầm khoá ghi sổ của tổ chức: nó phải
    // THẤY. Không vế này thì vế ⑴ không chứng được gì. Chạy SAU khi approve đã xong nên không ai bị
    // chặn. Khuôn lấy từ `packages/rfq/src/gia-han-xep-job-truoc-ghi-so.int.test.ts:132-138`.
    const doi = await apiPool.connect();
    let khoaKhiCoNguoiCam: unknown[] = [];
    try {
      await doi.query("BEGIN");
      await doi.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await doi.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))", [orgA]);
      khoaKhiCoNguoiCam = (await db.pool.query<Record<string, unknown>>(KHOA_GHI_SO_CUA_TO_CHUC, [orgA])).rows;
    } finally {
      await doi.query("ROLLBACK").catch(() => undefined);
      doi.release();
    }

    const keChung =
      `approve lúc chụp: ${approveDangCho}; ` +
      `khoá ghi sổ của tổ chức trong lúc approve chờ: ${JSON.stringify(khoaTrongLucCho)}; ` +
      `lần ghi sổ của người giữ: ${msGhiSoCuaNguoiGiu} ms; ${ke.join(" ")}`;

    // ⑴ Đối chứng dương TRƯỚC — nếu vế này đỏ thì phép dò hỏng và vế ⑵ vô nghĩa.
    expect(
      khoaKhiCoNguoiCam.length,
      `đối chứng dương: phép dò KHÔNG thấy khoá ghi sổ mà một giao dịch đang cầm — ${keChung}`,
    ).toBeGreaterThanOrEqual(1);
    // ⑵ KHÔNG ai cầm khoá ghi sổ của tổ chức trong lúc approve chờ hàng — và vòng chờ ở trên đã
    //    khẳng định approve THẬT SỰ đang kẹt lúc chụp. Đây là mệnh đề mà khoản 140 khai ngược lại.
    expect(khoaTrongLucCho, `approve KHÔNG được cầm khoá ghi sổ trong lúc chờ hàng — ${keChung}`).toEqual([]);
    // ⑶ Hệ quả đo được của ⑵: lần ghi sổ của người giữ đi qua NGAY, không chạm trần 2 s của 050.
    expect(msGhiSoCuaNguoiGiu, `lần ghi sổ của người giữ phải đi qua ngay — ${keChung}`).toBeLessThan(1_000);
    // ⑷ Và đây là một lần CHỜ, không phải khoá chết: nhả hàng thì approve xong bình thường.
    expect(ketQuaApprove, `nhả hàng thì approve phải chạy tiếp — ${keChung}`).toBe("xong status=APPROVED");
  }, 120_000);
});

// ==============================================================================================
// [S1.85 / khoản 147] VẾ D2 MÀ TRIGGER CHO QUA VÀ RÀNG BUỘC DUY NHẤT CHẶN — `23505`, KHÔNG PHẢI
// MỘT THÔNG ĐIỆP.
//
// `approveUnseal` phân loại lỗi của câu `INSERT INTO unseal_approvals` bằng một bộ lọc THÔNG ĐIỆP,
// và tới trước vòng này bộ lọc ấy có BA vế trong đó HAI là vế chết (§S1.77 rồi §S1.78 sửa lại).
// Vế còn sống duy nhất là `khong duoc tu phe duyet`. Ca dưới đây — CÙNG một người duyệt lần hai từ
// một PHIÊN KHÁC trên một RFQ cấp kép — đi qua cả ba phép kiểm của trigger rồi trượt ở ràng buộc
// UNIQUE, tức ném `23505`; bộ lọc cũ không khớp và một lần THỬ vi phạm D2 để lại 0 hàng sổ.
// ==============================================================================================
describe("[INV-D5] [INV-D2] [S1.85 / khoản 147] phê duyệt lần hai từ phiên khác — 23505 chứ không phải 23514", () => {
  async function demTuChoi147(requestId: string): Promise<number> {
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_APPROVAL_DENIED' AND resource_id = $2",
      [orgA, requestId],
    );
    return Number(rows[0]?.n ?? "0");
  }

  it("[INV-D5] cùng một người duyệt lần hai từ PHIÊN KHÁC ⇒ ĐÚNG MỘT hàng `UNSEAL_APPROVAL_DENIED`, và lỗi là 23505 mang TÊN ràng buộc", async () => {
    // RFQ CẤP KÉP: sau phê duyệt đầu yêu cầu còn `PENDING`, nên phép kiểm PENDING của trigger cho
    // qua. Trên RFQ dưới ngưỡng, yêu cầu đã sang `APPROVED` và trigger gãy ở vế PENDING — 23514,
    // một ca KHÁC (đó là điều test "một người phê duyệt HAI LẦN chỉ tính một" ở trên thật sự đo).
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    const sauMot = await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
    );
    expect(sauMot.status, "cấp kép: một phê duyệt chưa đủ, yêu cầu phải còn PENDING").toBe("PENDING");
    expect(await demTuChoi147(yc.id)).toBe(0);

    // CÙNG uD1, PHIÊN KHÁC — trigger cho qua cả ba vế (còn PENDING · người duyệt khác người yêu
    // cầu · phiên khác phiên yêu cầu); ràng buộc UNIQUE theo NGƯỜI là thứ chặn.
    const sD1b = await taoPhien(uD1);
    const loi = await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1b }, auditPool),
    ).then(
      () => null,
      (e: unknown) => e as Error & { code?: unknown; constraint?: unknown; table?: unknown },
    );
    expect(loi, "lần duyệt thứ hai của CÙNG một người phải bị chặn").not.toBeNull();
    // Phép đo mà bản vá dựa lên: `pg` điền sẵn `code` và `constraint`, và tên ràng buộc là tên
    // `053` đặt — không phải chuỗi PostgreSQL tự sinh (dẫn xuất của danh sách cột, cắt ở 63 byte).
    expect({ code: loi?.code, constraint: loi?.constraint, table: loi?.table }).toEqual({
      code: "23505",
      constraint: "unseal_approvals_mot_nguoi_mot_lan",
      table: "unseal_approvals",
    });
    expect(
      await demTuChoi147(yc.id),
      "trước bản vá khoản 147: bộ lọc thông điệp không khớp 23505 nào, lỗi rơi thẳng xuống `throw` và D5 mất một lần THỬ",
    ).toBe(1);
  });

  it("[S1.85 / khoản 147] `unseal_approvals` có ĐÚNG HAI ràng buộc UNIQUE, cả hai mang tên của `053` — một ràng buộc thứ ba không được lặng lẽ đổi nghĩa của `23505` ở đường này", async () => {
    const { rows } = await db.pool.query<{ conname: string }>(
      "SELECT c.conname::text AS conname FROM pg_catalog.pg_constraint c " +
        "WHERE c.conrelid = 'public.unseal_approvals'::pg_catalog.regclass AND c.contype = 'u' ORDER BY c.conname",
    );
    expect(rows.map((r) => r.conname)).toEqual([
      "unseal_approvals_mot_nguoi_mot_lan",
      "unseal_approvals_mot_phien_mot_lan",
    ]);
  });

  it("[S1.85 / khoản 147] vế PHIÊN của trigger `019` CÒN SỐNG — `approveUnseal` chỉ không dựng được ca ấy, vì danh tính người duyệt là dẫn xuất của phiên", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    // "Người khác, CÙNG phiên đã yêu cầu" không dựng được qua `approveUnseal` (`actor.id` và
    // `actor.sessionId` cùng đến từ một phiên), và ở tầng CSDL nó bị `unseal_approvals_kiem_danh_tinh`
    // chặn TRƯỚC — trigger cùng bảng chạy theo THỨ TỰ TÊN, và `kiem_danh_tinh` < `kiem_nguoi_duyet`.
    // Nên phép đo phải TẮT đúng trigger ấy lúc chạy, rồi bật lại ở `finally`.
    await db.pool.query("ALTER TABLE public.unseal_approvals DISABLE TRIGGER unseal_approvals_kiem_danh_tinh");
    try {
      const loi = await withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)",
          [orgA, yc.id, uD1, sYc],
        ),
      ).then(
        () => null,
        (e: unknown) => e as Error,
      );
      // NGUYÊN VĂN câu `RAISE` của `019:226`, và đây là chuỗi mà bộ lọc của `approveUnseal` nay
      // mang. Bộ lọc cũ viết `phai o mot PHIEN khac` — một chuỗi của một trigger KHÁC, trên bảng
      // `unseal_requests`, tức một vế chết đối với câu INSERT này.
      expect(loi?.message).toMatch(/Phe duyet phai den tu mot PHIEN KHAC voi phien da yeu cau \(D2\)/u);
    } finally {
      await db.pool.query("ALTER TABLE public.unseal_approvals ENABLE TRIGGER unseal_approvals_kiem_danh_tinh");
    }
    const { rows } = await db.pool.query<{ tgenabled: string }>(
      "SELECT t.tgenabled::text AS tgenabled FROM pg_catalog.pg_trigger t " +
        "WHERE t.tgrelid = 'public.unseal_approvals'::pg_catalog.regclass AND t.tgname = 'unseal_approvals_kiem_danh_tinh'",
    );
    expect(rows[0]?.tgenabled, "trigger phải được bật lại — một phép đo không được để lại lược đồ khác lúc nó tới").toBe("O");
  });
});
// =============================================================================================
// [S1.90 / khoản 190 · 192] TÌM ĐƯỢC YÊU CẦU MỞ THẦU, VÀ ĐẾM ĐƯỢC CHỮ KÝ
//
// Khối này sinh ra từ MỘT LƯỢT ĐI THỬ, không từ một lượt đọc mã: ngày 2026-09-20 chủ dự án đi
// trọn luồng người mua và dừng lại ở bước phê duyệt THỨ NHẤT, vì mã yêu cầu mở thầu chỉ tồn tại
// trong bộ nhớ của tab ĐÃ TẠO ra nó. D2 đòi người duyệt phải là người KHÁC — tức máy khác — nên
// tính năng hai người duyệt khi ấy chỉ chạy được bằng cách vi phạm tinh thần của chính nó.
//
// Hai vế được đo ở đây, và vế thứ hai là vế dễ chết:
//   ⑴ TÌM ĐƯỢC: theo id gói thầu, không cần biết trước UUID của yêu cầu.
//   ⑵ CHỈ CÁI ĐANG MỞ: một yêu cầu đã huỷ KHÔNG được trả về. Bỏ vế lọc trạng thái đi thì mã vẫn
//      chạy, màn hình vẫn có số — và người duyệt thứ hai sẽ ký lên một yêu cầu đã chết. Test
//      "đã huỷ" dưới đây là test duy nhất đỏ khi vế ấy mất, nên nó là lý do khối này tồn tại.
// =============================================================================================
describe("[khoản 190] yêu cầu mở thầu ĐANG MỞ của một gói thầu", () => {
  it("gói thầu chưa ai xin mở trả về null — một câu trả lời, không phải một lỗi", async () => {
    const rfqId = await taoRfqDaDong();
    const xem = await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId));
    expect(xem, "chưa có yêu cầu nào thì phải là null chứ không ném").toBeNull();
  });

  it("tìm được yêu cầu mà một PHIÊN KHÁC đã tạo, chỉ từ id gói thầu", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau", actorSessionId: sYc }, auditPool),
    );
    // Người duyệt thứ hai KHÔNG biết `yc.id`; tất cả những gì họ có là mã gói thầu.
    const xem = await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId));
    expect(xem?.id).toBe(yc.id);
    expect(xem?.status).toBe("PENDING");
    expect(xem?.approvalCount).toBe(0);
    expect(xem?.requiredApprovals, "RFQ cấp kép cần hai chữ ký").toBe(2);
  });

  it("số chữ ký đi 0 → 1 → 2 và trạng thái chỉ đổi ở chữ ký cuối", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    const doc = async (): Promise<{ so: number; tt: string }> => {
      const x = await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId));
      return { so: x?.approvalCount ?? -1, tt: x?.status ?? "" };
    };
    expect(await doc()).toEqual({ so: 0, tt: "PENDING" });

    await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
    );
    expect(await doc(), "một chữ ký: đếm lên, trạng thái ĐỨNG YÊN").toEqual({ so: 1, tt: "PENDING" });

    await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD2 }, auditPool),
    );
    expect(await doc()).toEqual({ so: 2, tt: "APPROVED" });
  });

  it("RFQ dưới ngưỡng chỉ cần MỘT chữ ký — ngưỡng đến từ máy chủ, không từ một hằng của màn hình", async () => {
    const rfqId = await taoRfqDaDong();
    await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio", actorSessionId: sYc }, auditPool),
    );
    const xem = await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId));
    expect(xem?.requiredApprovals).toBe(1);
  });

  it("yêu cầu ĐÃ HUỶ không còn 'đang mở' — và tiền đề được đo trước khi huỷ", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "den gio", actorSessionId: sYc }, auditPool),
    );
    expect(
      (await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId)))?.id,
      "tiền đề: trước khi huỷ thì nó PHẢI tìm thấy — không có vế này thì null sau đó chứng minh 0",
    ).toBe(yc.id);

    await withTenant(apiPool, orgA, (c) =>
      cancelUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sYc }, auditPool),
    );
    expect(
      await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId)),
      "một yêu cầu đã huỷ mà vẫn hiện ra là một chữ ký đặt lên một yêu cầu đã chết",
    ).toBeNull();
    // Nó KHÔNG biến mất khỏi hệ thống — đọc theo id vẫn thấy. Hai đường trả lời hai câu khác nhau.
    expect(
      (await withTenant(apiPool, orgA, (c) => getUnsealRequest(c, orgA, yc.id)))?.status,
    ).toBe("CANCELLED");
  });

  it("hai đường đọc trả về CÙNG một bản ghi — không có bản sao quy tắc ngưỡng nào", async () => {
    const rfqId = await taoRfqDaDong(true);
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "hop dong lon", actorSessionId: sYc }, auditPool),
    );
    await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
    );
    const theoId = await withTenant(apiPool, orgA, (c) => getUnsealRequest(c, orgA, yc.id));
    const theoRfq = await withTenant(apiPool, orgA, (c) => getOpenUnsealForRfq(c, orgA, rfqId));
    expect(theoId).toEqual(theoRfq);
    expect(theoId?.approvalCount).toBe(1);
  });
});

// ===============================================================================================
// [S1.187 / khoản 215] CẶP NHÂN CHỨNG CHỈ ĐI VỚI YÊU CẦU BREAK-GLASS — Ở TẦNG CSDL
//
// `requestUnseal` đã chặn ở tầng ứng dụng; ca này đo tầng có thẩm quyền, bằng một câu `INSERT` viết tay dưới chính vai `app_api`
// (vai có `GRANT INSERT` trên hai cột nhân chứng, `022`). Trước `078` câu ấy đi qua: nhân chứng hợp lệ (người khác, phiên của chính
// họ) nên trigger `unseal_requests_kiem_nhan_chung` không từ chối, và `unseal_kiem_du_phe_duyet` chỉ đọc hai cột ấy khi `break_glass`.
// ===============================================================================================
describe("[S1.187 / khoản 215] yêu cầu không break-glass không mang được cặp nhân chứng", () => {
  const CHEN =
    "INSERT INTO unseal_requests (org_id, rfq_id, reason, break_glass, requested_by, requested_by_session_id, " +
    "break_glass_witness_user_id, break_glass_witness_session_id) VALUES ($1, $2, 'viet tay', false, $3, $4, $5, $6) RETURNING id";

  it("INSERT viết tay dưới app_api: break_glass = false kèm nhân chứng ⇒ 23514 của `unseal_requests_nhan_chung_chi_break_glass`", async () => {
    const rfqId = await taoRfqDaDong();
    const loi = await withTenant(apiPool, orgA, (c) => c.query(CHEN, [orgA, rfqId, uYc, sYc, uD1, sD1])).then(
      () => ({ code: "khong-nem", constraint: undefined as string | undefined }),
      (e: unknown) => e as { code?: string; constraint?: string },
    );
    expect(loi.code, `câu viết tay phải bị CSDL từ chối — ${JSON.stringify(loi)}`).toBe("23514");
    expect(loi.constraint).toBe("unseal_requests_nhan_chung_chi_break_glass");
  });

  it("ĐỐI CHỨNG: cùng câu, không nhân chứng ⇒ đi qua — ràng buộc không chặn đường thường", async () => {
    const rfqId = await taoRfqDaDong();
    const { rowCount } = await withTenant(apiPool, orgA, (c) => c.query(CHEN, [orgA, rfqId, uYc, sYc, null, null]));
    expect(rowCount).toBe(1);
  });
});

// ===============================================================================================
// [S1.213 / khoản 133] BA LẦN TỪ CHỐI CỦA BỀ MẶT MỞ THẦU TỪNG KHÔNG GHI SỔ NAY VÀO SỔ
//
// Đo trước bản vá (§S1.72, đo lại trên `69e743e` ở §S1.213): `cancelUnseal` với id không tồn tại ⇒ `UnsealError`, 0 hàng;
// `approveUnseal` với id không tồn tại ⇒ lỗi PostgreSQL 23503 TRẦN (trigger `unseal_kiem_nguoi_duyet` của 019 RAISE
// `foreign_key_violation` trước cả khoá ngoại), 0 hàng — qua HTTP là 422 "tham chieu khong hop le" của bảng ánh xạ SQLSTATE;
// `dispatchUnseal` lần hai trên yêu cầu đã điều phối mà lượt trước còn sống ⇒ `UnsealError`, 0 hàng. Chủ dự án chốt (tiểu mục
// ADR-016 [S1.213]): D5 phủ cả ba — cùng khuôn `throwAuditedDenial`, lớp lỗi và thông điệp giữ nguyên (riêng phê duyệt: 23503 được
// bọc thành `UnsealError` có tên, lỗi `pg` giữ ở `cause`), `resourceId` là id NGƯỜI GỌI gửi.
// ===============================================================================================
describe("[INV-D5] [S1.213 / khoản 133] huỷ hay phê duyệt một yêu cầu KHÔNG TÌM THẤY, và điều phối LẦN HAI khi lượt trước còn sống — mỗi lần đúng một hàng sổ", () => {
  /** Mọi hàng mang `action` của một id — HÌNH DẠNG trọn, theo thứ tự ghi. */
  async function hangTuChoi(action: string, resourceId: string): Promise<unknown[][]> {
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string | null; resource_type: string; payload: unknown }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events " +
        " WHERE org_id = $1 AND action = $2 AND resource_id = $3 ORDER BY seq",
      [orgA, action, resourceId],
    );
    return rows.map((r) => [r.actor_type, r.actor_id, r.resource_type, r.payload]);
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ — cùng khuôn `voiGhiSoBiChan` của khối khoản 119. */
  async function voiGhiSoBiChan<T>(action: string, viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k133_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k133 thong diep noi bo' USING ERRCODE = 'TP133'; END$$",
      );
      await db.pool.query(
        `CREATE TRIGGER k133_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = '${action}') ` +
          "EXECUTE FUNCTION public.k133_chan_ghi_so()",
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k133_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k133_chan_ghi_so()");
    }
  }

  it("[INV-D5] `cancelUnseal` với UUID ngẫu nhiên ⇒ `UnsealError` cùng câu như trước, và đúng một `UNSEAL_NOT_FOUND_DENIED` mang người gọi, `UNSEAL_REQUEST`, id đã gửi và tên đường", async () => {
    const id = randomUUID();
    const loi = await loiCua(
      withTenant(apiPool, orgA, (c) => cancelUnseal(c, orgA, { unsealRequestId: id, actorSessionId: sYc }, auditPool)),
    );
    expect(loi).toBeInstanceOf(UnsealError);
    expect((loi as Error).message).toBe(
      "không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn, hoặc nó không ở trạng thái huỷ được",
    );
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", id)).toEqual([["USER", uYc, "UNSEAL_REQUEST", { operation: "CANCEL_UNSEAL" }]]);
  });

  it("[INV-D5] `approveUnseal` với UUID ngẫu nhiên ⇒ `UnsealError` CÓ TÊN thay 23503 trần (lỗi `pg` giữ ở `cause`), và đúng một `UNSEAL_NOT_FOUND_DENIED`", async () => {
    const id = randomUUID();
    const loi = await loiCua(
      withTenant(apiPool, orgA, (c) => approveUnseal(c, orgA, { unsealRequestId: id, actorSessionId: sD1 }, auditPool)),
    );
    expect((loi as Error).name, "trước bản vá: `error` — lỗi PostgreSQL trần").toBe("UnsealError");
    expect(loi).toBeInstanceOf(UnsealError);
    expect((loi as Error).message).toBe("Không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn.");
    expect(((loi as Error).cause as { code?: unknown } | undefined)?.code, "lỗi `pg` gốc đi theo ở `cause`").toBe("23503");
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", id)).toEqual([["USER", uD1, "UNSEAL_REQUEST", { operation: "APPROVE_UNSEAL" }]]);
  });

  it("[INV-D5] `dispatchUnseal` lần hai khi lượt trước còn PENDING ⇒ `UnsealError` cùng câu như trước, đúng một `UNSEAL_DISPATCH_DENIED`; không job thứ hai, cặp người-phiên không đổi", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc }, auditPool),
    );
    expect(await hangTuChoi("UNSEAL_DISPATCH_DENIED", requestId), "đối chứng: lần điều phối ĐẦU không phải một lần từ chối").toEqual([]);
    const loi = await loiCua(
      withTenant(apiPool, orgA, (c) => dispatchUnseal(c, orgA, { unsealRequestId: requestId, actorSessionId: sYc2 }, auditPool)),
    );
    expect(loi).toBeInstanceOf(UnsealError);
    expect((loi as Error).message).toBe("Yêu cầu mở thầu này vẫn còn một lượt đang chờ chạy — chưa có gì để điều phối lại.");
    expect(await hangTuChoi("UNSEAL_DISPATCH_DENIED", requestId)).toEqual([
      ["USER", uYc2, "UNSEAL_REQUEST", { reason: "JOB_STILL_ALIVE" }],
    ]);
    expect(await ketCucJob(requestId), "không job thứ hai nào được xếp").toEqual(["PENDING"]);
    expect((await docHangDieuPhoi(requestId)).dispatched_by_session_id, "cặp người-phiên KHÔNG đổi").toBe(sYc);
  });

  it("[INV-D5] ĐỐI CHỨNG DƯƠNG: id có thật — phê duyệt được, huỷ được — 0 hàng `UNSEAL_NOT_FOUND_DENIED`", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "doi chung khoan 133", actorSessionId: sYc }, auditPool),
    );
    await withTenant(apiPool, orgA, (c) =>
      approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, auditPool),
    );
    const huy = await withTenant(apiPool, orgA, (c) =>
      cancelUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sYc }, auditPool),
    );
    expect(huy.status).toBe("CANCELLED");
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", yc.id)).toEqual([]);
  });

  it("[INV-D5] lần ghi `UNSEAL_NOT_FOUND_DENIED` của phê duyệt ném TP133 ⇒ `DenialAuditFailedError` giữ `UnsealError` (đã bọc 23503) trong `denial`, lỗi của lần ghi trong `cause`; không hàng sổ nào", async () => {
    const id = randomUUID();
    const loi = await voiGhiSoBiChan("UNSEAL_NOT_FOUND_DENIED", () =>
      loiCua(withTenant(apiPool, orgA, (c) => approveUnseal(c, orgA, { unsealRequestId: id, actorSessionId: sD1 }, auditPool))),
    );
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const x = loi as DenialAuditFailedError;
    expect(x.denial).toBeInstanceOf(UnsealError);
    expect(x.denial.message).toBe("Không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn.");
    expect((x.cause as { code?: unknown }).code).toBe("TP133");
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", id)).toEqual([]);
  });
});

// ===============================================================================================
// [S1.9145 / khoản 266 · 267] "KHÔNG TÌM THẤY YÊU CẦU" NHẬN RA THEO TÊN RÀNG BUỘC; HUỶ MỘT YÊU CẦU KHÔNG CÒN Ở TRẠNG THÁI HUỶ ĐƯỢC
// VÀO SỔ, VỚI CÂU RIÊNG VÀ MÃ RIÊNG
//
// 266 — đo trước (§S1.213, đo lại trên `a97dd48b` ở §S1.9145): nhánh không thấy yêu cầu của `unseal_kiem_nguoi_duyet` (019) RAISE
// 23503 KHÔNG tên ràng buộc, nên `laKhongTimThayYeuCau` chỉ đọc `code` — MỌI 23503 của câu INSERT ấy thành hàng `UNSEAL_NOT_FOUND_DENIED`,
// kể cả một 23503 vì nguyên nhân khác. `9545_khong_tim_thay_yeu_cau_co_ten.sql` định nghĩa lại hàm (thân trích nguyên văn, đổi đúng một
// chỗ: `CONSTRAINT = 'unseal_approvals_yeu_cau_phai_ton_tai'`) và bộ lọc đọc `code` VÀ `constraint` — khuôn `laTrungPheDuyet` (ADR-108).
// 267 — đo trước: huỷ một yêu cầu CÓ THẬT đã `EXECUTED`/`CANCELLED` ⇒ `UnsealError` câu gộp "không tìm thấy …, hoặc nó không ở trạng
// thái huỷ được", 0 hàng sổ. Chủ dự án chốt (kế hoạch đợt 3 mục 0, câu 5): tách câu (đổi hợp đồng — thân 422 mang `ma`, khuôn khoản
// 230) và vào sổ `UNSEAL_CANCEL_DENIED {lyDo: "KHONG_O_TRANG_THAI_HUY_DUOC"}` theo luật ADR-060; người tích hợp chốt thêm (khuôn khoản
// 279, §S1.9125): `lyDo` là VẾ — đối số thứ năm của `throwAuditedDenial` — để dòng log mất sổ phân biệt hai lý do của cùng `action`.
// ===============================================================================================
describe("[INV-D5] [S1.9145 / khoản 266 · 267] 23503 \"không tìm thấy\" phải MANG TÊN; huỷ một yêu cầu không còn huỷ được để lại đúng một hàng, câu riêng, mã riêng", () => {
  /** Câu 422 MỚI của vế trạng thái — hợp đồng, ghim nguyên văn. */
  const CAU_KHONG_O_TRANG_THAI_HUY_DUOC =
    "Yêu cầu mở thầu này không còn ở trạng thái huỷ được — nó đã được mở thầu hoặc đã bị huỷ.";
  /** Câu CŨ của nhánh không tìm thấy — giữ nguyên (thân 422 của khoản 133). */
  const CAU_KHONG_TIM_THAY_KHI_HUY = "không tìm thấy yêu cầu mở thầu trong tổ chức đang gắn, hoặc nó không ở trạng thái huỷ được";

  /** Mọi hàng mang `action` của một id — HÌNH DẠNG trọn, theo thứ tự ghi. */
  async function hangTuChoi(action: string, resourceId: string): Promise<unknown[][]> {
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string | null; resource_type: string; payload: unknown }>(
      "SELECT actor_type, actor_id, resource_type, payload FROM audit_events " +
        " WHERE org_id = $1 AND action = $2 AND resource_id = $3 ORDER BY seq",
      [orgA, action, resourceId],
    );
    return rows.map((r) => [r.actor_type, r.actor_id, r.resource_type, r.payload]);
  }

  const loiCua = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  const huy = (unsealRequestId: string, actorSessionId: string): Promise<unknown> =>
    loiCua(withTenant(apiPool, orgA, (c) => cancelUnseal(c, orgA, { unsealRequestId, actorSessionId }, auditPool)));

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ — cùng khuôn `voiGhiSoBiChan` của khối khoản 119/133. */
  async function voiGhiSoBiChan<T>(action: string, viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k267_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k267 thong diep noi bo' USING ERRCODE = 'TP267'; END$$",
      );
      await db.pool.query(
        `CREATE TRIGGER k267_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = '${action}') ` +
          "EXECUTE FUNCTION public.k267_chan_ghi_so()",
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k267_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k267_chan_ghi_so()");
    }
  }

  /** Băm rút gọn của khe `nguoi=` — cùng công thức ADR-127 khai (sha256 của userId, 12 hex đầu). */
  const bamNguoi = (userId: string): string => createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 12);

  /** Thân và `proconfig` của hàm đang chạy — để đo đột biến lúc chạy rồi đòi trả lại đúng như cũ. */
  async function hamDangChay(): Promise<{ src: string; cfg: string[] | null }> {
    const { rows } = await db.pool.query<{ src: string; cfg: string[] | null }>(
      "SELECT p.prosrc AS src, p.proconfig AS cfg FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.unseal_kiem_nguoi_duyet()')",
    );
    const h = rows[0];
    if (h === undefined) throw new Error("không thấy public.unseal_kiem_nguoi_duyet() trong CSDL");
    return h;
  }

  it("[INV-D5] [khoản 266] `approveUnseal` với UUID ngẫu nhiên ⇒ 23503 MANG TÊN `unseal_approvals_yeu_cau_phai_ton_tai` ở `cause`, `UnsealError` có tên và đúng một `UNSEAL_NOT_FOUND_DENIED`", async () => {
    const id = randomUUID();
    const loi = await loiCua(
      withTenant(apiPool, orgA, (c) => approveUnseal(c, orgA, { unsealRequestId: id, actorSessionId: sD1 }, auditPool)),
    );
    expect(loi).toBeInstanceOf(UnsealError);
    const goc = (loi as Error).cause as { code?: unknown; constraint?: unknown } | undefined;
    expect(
      { code: goc?.code, constraint: goc?.constraint },
      "trước khoản 266: `constraint` rỗng — trigger 019 RAISE 23503 không `USING CONSTRAINT`",
    ).toEqual({ code: "23503", constraint: "unseal_approvals_yeu_cau_phai_ton_tai" });
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", id)).toEqual([["USER", uD1, "UNSEAL_REQUEST", { operation: "APPROVE_UNSEAL" }]]);
  });

  it("[khoản 266] ĐỘT BIẾN LÚC CHẠY: thân hàm trả về bản `019` (23503 KHÔNG tên) ⇒ lỗi `pg` đi NGUYÊN — không `UnsealError`, 0 hàng `UNSEAL_NOT_FOUND_DENIED`; thân được trả lại đúng như cũ", async () => {
    // Một 23503 không mang tên của nhánh "không tìm thấy" là đúng hình dạng của một 23503 vì nguyên nhân KHÁC trên câu INSERT ấy (khoá
    // ngoại người duyệt, khoá ngoại thêm sau): đường lỗi CHUNG, không một hàng sổ nói sai nguyên nhân. Dựng nó bằng cách chạy lại
    // NGUYÊN VĂN câu `CREATE OR REPLACE FUNCTION` của `019` lúc chạy — sửa tệp thì hardening âm thầm dựng lại thân chuẩn (khoản 140).
    const sql019 = readFileSync(fileURLToPath(new URL("../../../db/migrations/019_unseal.sql", import.meta.url)), "utf8");
    const dau = sql019.indexOf("CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet()");
    const cuoi = sql019.indexOf("$ham$;", sql019.indexOf("AS $ham$", dau) + 8);
    expect([dau, cuoi].every((v) => v > 0), "đọc được câu định nghĩa hàm ở 019").toBe(true);
    const cau019 = sql019.slice(dau, cuoi + "$ham$;".length);
    expect(cau019, "tiền đề: bản 019 không mang tên ràng buộc").not.toMatch(/CONSTRAINT\s*=/u);

    const truoc = await hamDangChay();
    const { rows: dn } = await db.pool.query<{ d: string }>(
      "SELECT pg_catalog.pg_get_functiondef(to_regprocedure('public.unseal_kiem_nguoi_duyet()')) AS d",
    );
    const dinhNghiaTruoc = dn[0]?.d ?? "";
    expect(dinhNghiaTruoc).toContain("unseal_kiem_nguoi_duyet");
    const id = randomUUID();
    let loi: unknown;
    try {
      await db.pool.query(cau019);
      expect((await hamDangChay()).src, "tiền đề: thân đang chạy là thân 019").not.toMatch(/CONSTRAINT\s*=/u);
      loi = await loiCua(
        withTenant(apiPool, orgA, (c) => approveUnseal(c, orgA, { unsealRequestId: id, actorSessionId: sD1 }, auditPool)),
      );
    } finally {
      await db.pool.query(dinhNghiaTruoc);
    }
    expect(await hamDangChay(), "thân và proconfig phải được trả lại đúng như trước đột biến").toEqual(truoc);
    expect((loi as Error | null)?.name, "23503 KHÔNG tên đi nguyên — lỗi `pg` trần, không `UnsealError`").toBe("error");
    expect(loi).not.toBeInstanceOf(UnsealError);
    const e = loi as { code?: unknown; constraint?: unknown };
    expect({ code: e.code, constraint: e.constraint }).toEqual({ code: "23503", constraint: undefined });
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", id), "0 hàng — một 23503 không tên không được ghi thành 'không tìm thấy'").toEqual([]);
  });

  it("[khoản 266] tên ràng buộc HAI CHIỀU: các `CONSTRAINT = '…'` trong thân `unseal_kiem_nguoi_duyet` THẬT trong CSDL đúng bằng tên mà `requests.ts` đọc", async () => {
    // Khuôn phép đo hai chiều của ADR-108 ④: đổi tên ở một phía mà quên phía kia là đỏ — ở đây chứ không ở một ca "không tìm thấy"
    // im lặng rơi về đường lỗi chung.
    const { src } = await hamDangChay();
    const ten = [...src.matchAll(/CONSTRAINT\s*=\s*'([a-z0-9_]+)'/gu)].map((m) => m[1]);
    expect(ten).toEqual([RANG_BUOC_KHONG_TIM_THAY_YEU_CAU]);
  });

  it("[INV-D5] [khoản 267] `cancelUnseal` trên yêu cầu đã `EXECUTED` ⇒ `UnsealError` câu RIÊNG, `ma` `KHONG_O_TRANG_THAI_HUY_DUOC`, đúng một `UNSEAL_CANCEL_DENIED {lyDo}` mang người gọi; không hàng 'không tìm thấy', trạng thái không đổi", async () => {
    const { requestId } = await yeuCauDaDuyet();
    await db.pool.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [requestId]);
    expect(await hangTuChoi("UNSEAL_CANCEL_DENIED", requestId), "đối chứng: chưa lần từ chối huỷ nào").toEqual([]);
    const loi = await huy(requestId, sYc);
    expect(loi).toBeInstanceOf(UnsealError);
    expect((loi as Error).message, "trước khoản 267: câu gộp 'không tìm thấy …, hoặc …'").toBe(CAU_KHONG_O_TRANG_THAI_HUY_DUOC);
    expect((loi as UnsealError).ma).toBe("KHONG_O_TRANG_THAI_HUY_DUOC");
    expect(await hangTuChoi("UNSEAL_CANCEL_DENIED", requestId), "trước khoản 267: 0 hàng").toEqual([
      ["USER", uYc, "UNSEAL_REQUEST", { lyDo: "KHONG_O_TRANG_THAI_HUY_DUOC" }],
    ]);
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", requestId), "hàng CÓ THẬT — không phải 'không tìm thấy'").toEqual([]);
    expect((await docHangDieuPhoi(requestId)).status).toBe("EXECUTED");
  });

  it("[INV-D5] [khoản 267] `cancelUnseal` lần HAI trên yêu cầu đã `CANCELLED` ⇒ cùng câu, cùng mã, đúng một `UNSEAL_CANCEL_DENIED` — lần huỷ đầu không để lại lần từ chối nào", async () => {
    const rfqId = await taoRfqDaDong();
    const yc = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "huy hai lan khoan 267", actorSessionId: sYc }, auditPool),
    );
    expect(await huy(yc.id, sYc), "lần huỷ đầu đi qua").toBeNull();
    expect(await hangTuChoi("UNSEAL_CANCEL_DENIED", yc.id), "đối chứng: lần huỷ đầu không phải một lần từ chối").toEqual([]);
    const loi = await huy(yc.id, sYc);
    expect(loi).toBeInstanceOf(UnsealError);
    expect([(loi as Error).message, (loi as UnsealError).ma]).toEqual([CAU_KHONG_O_TRANG_THAI_HUY_DUOC, "KHONG_O_TRANG_THAI_HUY_DUOC"]);
    expect(await hangTuChoi("UNSEAL_CANCEL_DENIED", yc.id)).toEqual([["USER", uYc, "UNSEAL_REQUEST", { lyDo: "KHONG_O_TRANG_THAI_HUY_DUOC" }]]);
  });

  it("[INV-D5] [khoản 267] ĐỐI CHỨNG: id lạ vẫn là 'không tìm thấy' — câu CŨ, không `ma`, không `UNSEAL_CANCEL_DENIED`; và người không được huỷ vẫn nhận lý do người, không `ma`", async () => {
    const id = randomUUID();
    const khongThay = await huy(id, sYc);
    expect(khongThay).toBeInstanceOf(UnsealError);
    expect([(khongThay as Error).message, (khongThay as UnsealError).ma]).toEqual([CAU_KHONG_TIM_THAY_KHI_HUY, null]);
    expect(await hangTuChoi("UNSEAL_CANCEL_DENIED", id)).toEqual([]);
    expect(await hangTuChoi("UNSEAL_NOT_FOUND_DENIED", id)).toEqual([["USER", uYc, "UNSEAL_REQUEST", { operation: "CANCEL_UNSEAL" }]]);

    // `uYc2` giữ `rfq.unseal`, không phải người yêu cầu, không giữ `rfq.unseal.approve` — vế AI ĐƯỢC HUỶ đứng TRƯỚC vế trạng thái.
    const { requestId } = await yeuCauDaDuyet();
    await db.pool.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [requestId]);
    const khongDuoc = await huy(requestId, sYc2);
    expect(khongDuoc).toBeInstanceOf(UnsealError);
    expect((khongDuoc as UnsealError).ma, "thân 422 của vế người không đổi — chỉ vế trạng thái mang `ma`").toBeNull();
    expect(await hangTuChoi("UNSEAL_CANCEL_DENIED", requestId)).toEqual([
      ["USER", uYc2, "UNSEAL_REQUEST", { lyDo: "KHONG_PHAI_NGUOI_YEU_CAU_VA_KHONG_DUYET_DUOC" }],
    ]);
  });

  it("[INV-D5] [khoản 267] ĐỐI CHỨNG DƯƠNG: huỷ yêu cầu `PENDING` và `APPROVED` đi qua — 0 hàng `UNSEAL_CANCEL_DENIED`", async () => {
    const rfqId = await taoRfqDaDong(true);
    const choDuyet = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "doi chung khoan 267", actorSessionId: sYc }, auditPool),
    );
    expect(await huy(choDuyet.id, sYc)).toBeNull();
    const { requestId: daDuyet } = await yeuCauDaDuyet();
    expect(await huy(daDuyet, sYc)).toBeNull();
    expect([...(await hangTuChoi("UNSEAL_CANCEL_DENIED", choDuyet.id)), ...(await hangTuChoi("UNSEAL_CANCEL_DENIED", daDuyet))]).toEqual([]);
    expect((await docHangDieuPhoi(daDuyet)).status).toBe("CANCELLED");
  });

  it("[INV-D5] [khoản 267] lần ghi `UNSEAL_CANCEL_DENIED` bị chặn ⇒ `DenialAuditFailedError` mang VẾ — hai lý do của cùng `action` ra HAI dòng log khác nhau; không hàng sổ nào", async () => {
    const { requestId: daChay } = await yeuCauDaDuyet();
    await db.pool.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [daChay]);
    const { requestId: conSong } = await yeuCauDaDuyet();
    const [trangThai, nguoi] = await voiGhiSoBiChan("UNSEAL_CANCEL_DENIED", async () => [await huy(daChay, sYc), await huy(conSong, sYc2)]);

    expect(trangThai, "vế trạng thái: lần ghi gãy ⇒ gãy ỒN ÀO, không lời từ chối trần").toBeInstanceOf(DenialAuditFailedError);
    const x = trangThai as DenialAuditFailedError;
    expect([x.action, x.clause, x.denial.message]).toEqual(["UNSEAL_CANCEL_DENIED", "KHONG_O_TRANG_THAI_HUY_DUOC", CAU_KHONG_O_TRANG_THAI_HUY_DUOC]);
    expect((x.cause as { code?: unknown }).code).toBe("TP267");
    expect(moTaHangDongCuaLanTuChoi(x)).toBe(`UNSEAL_CANCEL_DENIED UNSEAL_REQUEST KHONG_O_TRANG_THAI_HUY_DUOC nguoi=${bamNguoi(uYc)}`);

    expect(nguoi).toBeInstanceOf(DenialAuditFailedError);
    const y = nguoi as DenialAuditFailedError;
    expect([y.action, y.clause]).toEqual(["UNSEAL_CANCEL_DENIED", "KHONG_PHAI_NGUOI_YEU_CAU_VA_KHONG_DUYET_DUOC"]);
    expect(moTaHangDongCuaLanTuChoi(y), "trước vòng này: `… UNSEAL_CANCEL_DENIED UNSEAL_REQUEST nguoi=…` — không nói lý do nào").toBe(
      `UNSEAL_CANCEL_DENIED UNSEAL_REQUEST KHONG_PHAI_NGUOI_YEU_CAU_VA_KHONG_DUYET_DUOC nguoi=${bamNguoi(uYc2)}`,
    );
    expect([...(await hangTuChoi("UNSEAL_CANCEL_DENIED", daChay)), ...(await hangTuChoi("UNSEAL_CANCEL_DENIED", conSong))]).toEqual([]);
    expect((await docHangDieuPhoi(conSong)).status, "lần từ chối không đổi trạng thái").toBe("APPROVED");
  });
});
