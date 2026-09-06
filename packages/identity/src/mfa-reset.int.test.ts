// ==============================================================================================
// [sổ nợ 40 / migration 040 / review M-5] ĐẶT LẠI TOTP — HAI NGƯỜI, HỒ SƠ BỊ XOÁ, PHIÊN BỊ THU HỒI
//
//   ⑴ không có `user.mfa_reset` ⇒ PermissionDeniedError (và một bản ghi PERMISSION_DENIED);
//   ⑵ yêu cầu ⇒ PENDING, hết hạn 24 giờ, sổ có MFA_RESET_REQUESTED; hai yêu cầu đang chờ ⇒ 23505;
//   ⑶ tự duyệt (cùng người) ⇒ 23514 từ CHECK của 040, và sổ có MFA_RESET_APPROVAL_DENIED dù rollback;
//   ⑷ người KHÁC duyệt ⇒ hồ sơ TOTP mất, mọi phiên còn sống thu hồi, yêu cầu tiêu thụ, sổ có
//      MFA_RESET_APPROVED; duyệt lần hai ⇒ MfaResetError;
//   ⑸ app_api XOÁ hồ sơ khi KHÔNG có yêu cầu đã duyệt ⇒ 23514 (trigger 040);
//   ⑹ ĐỘT BIẾN: gỡ trigger ⇒ xoá được; gỡ hai CHECK ⇒ tự duyệt được; khôi phục ⇒ chặn lại;
//   ⑺ yêu cầu hết hạn ⇒ không duyệt được; danh tính người duyệt phải khớp phiên (013).
// ==============================================================================================
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { withTenant } from "@trustprocure/tenancy";
import { MfaResetError, approveMfaReset, cancelMfaReset, requestMfaReset } from "./mfa-reset.js";
import { PermissionDeniedError } from "./rbac.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let org: string;

interface Nguoi {
  readonly id: string;
  readonly phien: string;
}

async function nguoi(vai: readonly string[]): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'N', 'ACTIVE') RETURNING id",
    [org, `${randomBytes(6).toString("hex")}@vidu.vn`],
  );
  const id = rows[0]!.id;
  for (const r of vai) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, r]);
  return { id, phien: await phienMoi(id) };
}

async function phienMoi(userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '8 hours', now()) RETURNING id",
    [org, userId, randomBytes(32)],
  );
  return rows[0]!.id;
}

async function hoSoTotp(userId: string): Promise<void> {
  await db.pool.query(
    "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version, confirmed_at, last_used_counter) VALUES ($1, $2, 'TOTP', '\\x01', 'v1', now(), 1)",
    [org, userId],
  );
}

async function coHoSo(userId: string): Promise<boolean> {
  const { rows } = await db.pool.query("SELECT 1 FROM mfa_credentials WHERE org_id = $1 AND user_id = $2", [org, userId]);
  return rows.length > 0;
}

async function phienSong(userId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM sessions WHERE org_id = $1 AND user_id = $2 AND revoked_at IS NULL",
    [org, userId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function demSo(action: string, resourceId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3",
    [org, action, resourceId],
  );
  return Number(rows[0]?.n ?? 0);
}

const yeuCau = (ai: Nguoi, userId: string, reason = "Mat dien thoai") =>
  withTenant(apiPool, org, (c) => requestMfaReset(c, org, { userId, reason, actorSessionId: ai.phien }, auditPool));
const duyet = (ai: Nguoi, requestId: string) =>
  withTenant(apiPool, org, (c) => approveMfaReset(c, org, { requestId, actorSessionId: ai.phien }, auditPool));
const huy = (ai: Nguoi, requestId: string) =>
  withTenant(apiPool, org, (c) => cancelMfaReset(c, org, { requestId, actorSessionId: ai.phien }, auditPool));

async function trangThaiCua(requestId: string): Promise<string> {
  const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM mfa_reset_requests WHERE id = $1", [requestId]);
  return rows[0]?.status ?? "(khong co)";
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  org = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('A', 'a') RETURNING id")).rows[0]!.id;
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[040] đặt lại TOTP — hai người", () => {
  it("không có user.mfa_reset ⇒ PermissionDeniedError; PM yêu cầu ⇒ PENDING + sổ; hai yêu cầu đang chờ cho một người ⇒ 23505", async () => {
    const buyer = await nguoi(["BUYER"]);
    const pm1 = await nguoi(["PROCUREMENT_MANAGER"]);
    const nan = await nguoi(["BUYER"]);
    await expect(yeuCau(buyer, nan.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    const r = await yeuCau(pm1, nan.id);
    expect(r.status).toBe("PENDING");
    expect(r.requestedBy).toBe(pm1.id);
    expect(r.expiresAt.getTime() - r.requestedAt.getTime()).toBeGreaterThan(23 * 3600_000);
    expect(await demSo("MFA_RESET_REQUESTED", nan.id)).toBe(1);
    await expect(yeuCau(pm1, nan.id)).rejects.toMatchObject({ code: "23505" });
    await expect(yeuCau(pm1, nan.id, "   ")).rejects.toBeInstanceOf(MfaResetError);
  });

  it("tự duyệt ⇒ 23514 (CHECK của 040) và một bản ghi MFA_RESET_APPROVAL_DENIED sống qua rollback; người KHÁC duyệt ⇒ hồ sơ mất, phiên thu hồi, tiêu thụ, sổ; duyệt lại ⇒ MfaResetError", async () => {
    const pm1 = await nguoi(["PROCUREMENT_MANAGER"]);
    const pm2 = await nguoi(["DIRECTOR"]);
    const nan = await nguoi(["BUYER"]);
    await hoSoTotp(nan.id);
    await phienMoi(nan.id);
    expect(await phienSong(nan.id)).toBe(2);
    const r = await yeuCau(pm1, nan.id);
    await expect(duyet(pm1, r.id)).rejects.toMatchObject({ code: "23514" });
    expect(await demSo("MFA_RESET_APPROVAL_DENIED", r.id)).toBe(1);
    expect(await coHoSo(nan.id)).toBe(true);

    const kq = await duyet(pm2, r.id);
    expect(kq.status).toBe("APPROVED");
    expect(kq.approvedBy).toBe(pm2.id);
    expect(kq.credentialDeleted).toBe(true);
    expect(kq.sessionsRevoked).toBe(2);
    expect(kq.consumedAt).not.toBeNull();
    expect(await coHoSo(nan.id)).toBe(false);
    expect(await phienSong(nan.id)).toBe(0);
    expect(await demSo("MFA_RESET_APPROVED", nan.id)).toBe(1);
    await expect(duyet(pm2, r.id)).rejects.toBeInstanceOf(MfaResetError);
    // Người chưa từng ghi danh cũng đặt lại được — không có gì để xoá, nói ra bằng cờ.
    const nan2 = await nguoi(["BUYER"]);
    const r2 = await yeuCau(pm1, nan2.id);
    expect((await duyet(pm2, r2.id)).credentialDeleted).toBe(false);
  });

  it("app_api không XOÁ được hồ sơ TOTP khi không có yêu cầu đã duyệt ⇒ 23514 nêu 040; ĐỘT BIẾN gỡ trigger ⇒ xoá được", async () => {
    const nan = await nguoi(["BUYER"]);
    await hoSoTotp(nan.id);
    const xoa = () => withTenant(apiPool, org, (c) => c.query("DELETE FROM mfa_credentials WHERE org_id = $1 AND user_id = $2", [org, nan.id]));
    await expect(xoa()).rejects.toMatchObject({ code: "23514" });
    await expect(xoa()).rejects.toThrow(/040/u);
    expect(await coHoSo(nan.id)).toBe(true);
    await db.pool.query("DROP TRIGGER mfa_credentials_xoa_can_yeu_cau ON mfa_credentials");
    try {
      await expect(xoa()).resolves.toMatchObject({ rowCount: 1 });
      expect(await coHoSo(nan.id), "RED THẬT: không có trigger, app_api xoá trộm được hồ sơ TOTP").toBe(false);
    } finally {
      await db.pool.query("CREATE TRIGGER mfa_credentials_xoa_can_yeu_cau BEFORE DELETE ON mfa_credentials FOR EACH ROW EXECUTE FUNCTION public.mfa_credentials_xoa_can_yeu_cau()");
      await db.pool.query("ALTER TABLE mfa_credentials ENABLE ALWAYS TRIGGER mfa_credentials_xoa_can_yeu_cau");
    }
    await hoSoTotp(nan.id);
    await expect(xoa()).rejects.toMatchObject({ code: "23514" });
  });

  it("ĐỘT BIẾN: gỡ hai CHECK (khác người, khác phiên) ⇒ tự duyệt ĐI LỌT; khôi phục ⇒ chặn lại", async () => {
    const pm1 = await nguoi(["PROCUREMENT_MANAGER"]);
    const nan = await nguoi(["BUYER"]);
    const r = await yeuCau(pm1, nan.id);
    await db.pool.query("ALTER TABLE mfa_reset_requests DROP CONSTRAINT mfa_reset_requests_khong_tu_duyet, DROP CONSTRAINT mfa_reset_requests_phien_khac");
    try {
      const kq = await duyet(pm1, r.id);
      expect(kq.status, "RED THẬT: không có CHECK, một người tự đặt lại TOTP cho người khác").toBe("APPROVED");
    } finally {
      await db.pool.query(
        "ALTER TABLE mfa_reset_requests ADD CONSTRAINT mfa_reset_requests_khong_tu_duyet CHECK (approved_by IS NULL OR approved_by <> requested_by) NOT VALID, " +
          "ADD CONSTRAINT mfa_reset_requests_phien_khac CHECK (approved_by_session_id IS NULL OR approved_by_session_id <> requested_by_session_id) NOT VALID",
      );
    }
    const nan2 = await nguoi(["BUYER"]);
    const r2 = await yeuCau(pm1, nan2.id);
    await expect(duyet(pm1, r2.id)).rejects.toMatchObject({ code: "23514" });
    // Cùng người nhưng PHIÊN KHÁC: vẫn bị chặn (vế người), không chỉ vế phiên.
    const pm1PhienKhac: Nguoi = { id: pm1.id, phien: await phienMoi(pm1.id) };
    await expect(duyet(pm1PhienKhac, r2.id)).rejects.toMatchObject({ code: "23514" });
  });

  it("yêu cầu hết hạn ⇒ 23514 nêu het han; danh tính người duyệt phải là dẫn xuất của phiên (013)", async () => {
    const pm1 = await nguoi(["PROCUREMENT_MANAGER"]);
    const pm2 = await nguoi(["PROCUREMENT_MANAGER"]);
    const nan = await nguoi(["BUYER"]);
    const r = await yeuCau(pm1, nan.id);
    await db.pool.query("ALTER TABLE mfa_reset_requests DISABLE TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai");
    try {
      await db.pool.query("UPDATE mfa_reset_requests SET requested_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE id = $1", [r.id]);
    } finally {
      await db.pool.query("ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_chuyen_trang_thai");
    }
    await expect(duyet(pm2, r.id)).rejects.toThrow(/het han/u);
    // [review H4-2] Yêu cầu hết hạn KHÔNG khoá vĩnh viễn đường về: yêu cầu mới cho cùng người tạo được,
    // yêu cầu cũ chuyển CANCELLED, một bản ghi MFA_RESET_EXPIRED cho nó.
    const rMoi = await yeuCau(pm1, nan.id);
    expect(rMoi.status).toBe("PENDING");
    expect(rMoi.id).not.toBe(r.id);
    expect(await trangThaiCua(r.id)).toBe("CANCELLED");
    expect(await demSo("MFA_RESET_EXPIRED", r.id)).toBe(1);
    await expect(duyet(pm2, rMoi.id)).resolves.toMatchObject({ status: "APPROVED" });
    // 013 trên cột duyệt: superuser khai approved_by = pm2 nhưng phiên của pm1 ⇒ 23514.
    const nan2 = await nguoi(["BUYER"]);
    const r2 = await yeuCau(pm1, nan2.id);
    await expect(
      db.pool.query(
        "UPDATE mfa_reset_requests SET status = 'APPROVED', approved_by = $2, approved_by_session_id = $3, approved_at = now() WHERE id = $1",
        [r2.id, pm2.id, pm1.phien],
      ),
    ).rejects.toThrow(/khong khop chu phien/u);
  });

  it("[review H4-2] huỷ: PENDING → CANCELLED + sổ; duyệt sau huỷ ⇒ MfaResetError; huỷ lại ⇒ MfaResetError; yêu cầu mới cho cùng người tạo được; BUYER huỷ ⇒ PermissionDeniedError", async () => {
    const pm1 = await nguoi(["PROCUREMENT_MANAGER"]);
    const pm2 = await nguoi(["PROCUREMENT_MANAGER"]);
    const buyer = await nguoi(["BUYER"]);
    const nan = await nguoi(["BUYER"]);
    const r = await yeuCau(pm1, nan.id);
    await expect(huy(buyer, r.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    const daHuy = await huy(pm2, r.id);
    expect(daHuy.status).toBe("CANCELLED");
    expect(await demSo("MFA_RESET_CANCELLED", nan.id)).toBe(1);
    await expect(duyet(pm2, r.id)).rejects.toBeInstanceOf(MfaResetError);
    await expect(huy(pm2, r.id)).rejects.toBeInstanceOf(MfaResetError);
    const r2 = await yeuCau(pm1, nan.id);
    expect(r2.status).toBe("PENDING");
    // Đã duyệt thì không huỷ được — hồ sơ đã mất trong giao dịch duyệt, "huỷ" không còn nghĩa.
    await hoSoTotp(nan.id);
    await duyet(pm2, r2.id);
    await expect(huy(pm1, r2.id)).rejects.toBeInstanceOf(MfaResetError);
  });

  it("[review H4-1] CSDL đòi người yêu cầu VÀ người duyệt CÓ user.mfa_reset: app_api với hai phiên BUYER sống ⇒ 23514 nêu H4-1 ở cả INSERT lẫn UPDATE; ĐỘT BIẾN gỡ hai trigger ⇒ đi lọt tới tận DELETE", async () => {
    const b1 = await nguoi(["BUYER"]);
    const b2 = await nguoi(["BUYER"]);
    const pm = await nguoi(["PROCUREMENT_MANAGER"]);
    const nan = await nguoi(["BUYER"]);
    await hoSoTotp(nan.id);
    // Đường "app_api bị chiếm": không qua requirePermission, gõ thẳng SQL với hai phiên BUYER.
    const chenTho = (ai: Nguoi) =>
      withTenant(apiPool, org, (c) =>
        c.query<{ id: string }>(
          "INSERT INTO mfa_reset_requests (org_id, user_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'x', $3, $4) RETURNING id",
          [org, nan.id, ai.id, ai.phien],
        ),
      );
    const duyetTho = (id: string, ai: Nguoi) =>
      withTenant(apiPool, org, (c) =>
        c.query(
          "UPDATE mfa_reset_requests SET status = 'APPROVED', approved_by = $2, approved_by_session_id = $3, approved_at = now() WHERE id = $1",
          [id, ai.id, ai.phien],
        ),
      );
    await expect(chenTho(b1)).rejects.toMatchObject({ code: "23514" });
    await expect(chenTho(b1)).rejects.toThrow(/H4-1/u);
    // Người yêu cầu hợp lệ (PM) nhưng người duyệt là BUYER ⇒ vẫn 23514 ở UPDATE.
    const hopLe = (await chenTho(pm)).rows[0]!.id;
    await expect(duyetTho(hopLe, b2)).rejects.toMatchObject({ code: "23514" });
    await expect(duyetTho(hopLe, b2)).rejects.toThrow(/H4-1/u);
    expect(await coHoSo(nan.id)).toBe(true);
    await db.pool.query("UPDATE mfa_reset_requests SET status = 'CANCELLED' WHERE id = $1", [hopLe]);

    await db.pool.query(
      "DROP TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau ON mfa_reset_requests; DROP TRIGGER mfa_reset_requests_kiem_quyen_duyet ON mfa_reset_requests",
    );
    try {
      const id = (await chenTho(b1)).rows[0]!.id;
      await expect(duyetTho(id, b2)).resolves.toMatchObject({ rowCount: 1 });
      await withTenant(apiPool, org, (c) => c.query("DELETE FROM mfa_credentials WHERE org_id = $1 AND user_id = $2", [org, nan.id]));
      expect(await coHoSo(nan.id), "RED THẬT: không có trigger quyền, hai phiên BUYER sống là đủ để app_api bị chiếm xoá hồ sơ TOTP của bất kỳ ai").toBe(false);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau BEFORE INSERT ON mfa_reset_requests FOR EACH ROW EXECUTE FUNCTION public.mfa_reset_kiem_quyen(); " +
          "ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_quyen_yeu_cau; " +
          "CREATE TRIGGER mfa_reset_requests_kiem_quyen_duyet BEFORE UPDATE ON mfa_reset_requests FOR EACH ROW WHEN (OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL) EXECUTE FUNCTION public.mfa_reset_kiem_quyen(); " +
          "ALTER TABLE mfa_reset_requests ENABLE ALWAYS TRIGGER mfa_reset_requests_kiem_quyen_duyet",
      );
    }
    await expect(chenTho(b1)).rejects.toMatchObject({ code: "23514" });
  });
});
