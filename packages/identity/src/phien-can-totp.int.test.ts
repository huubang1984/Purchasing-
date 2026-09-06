// ==============================================================================================
// [sổ nợ 43 / migration 039 / review M-4] PHIÊN ĐÃ-MFA CHỈ RA ĐỜI SAU MỘT LẦN TOTP ĐÚNG GẦN ĐÂY — ở CSDL
//
// `MfaProof` (kiểu) làm "mở phiên mà quên TOTP" không biên dịch được; kiểu không chạy ở CSDL, và
// một `app_api` bị chiếm INSERT thẳng `sessions` với `mfa_verified_at = now()` là có một phiên
// đã-MFA. 039 đòi hồ sơ TOTP đã xác nhận của đúng người ấy có `last_used_counter` trong ba bước
// 30 giây gần nhất — chính giá trị `verifyTotpAttempt` ghi ngay trước `startUserSession`.
//   ⑴ không hồ sơ / hồ sơ chưa xác nhận / bộ đếm cũ ⇒ 23514; bộ đếm tươi ⇒ đi qua;
//   ⑵ superuser (đường test/vận hành) không bị chạm;
//   ⑶ ĐỘT BIẾN: gỡ trigger ⇒ bộ đếm cũ đi lọt; khôi phục ⇒ chặn lại;
//   ⑷ hàng lệch tổ chức vẫn nhận lỗi KHOÁ NGOẠI (trigger là AFTER — RI chạy trước), không phải 23514.
// ==============================================================================================
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { withTenant } from "@trustprocure/tenancy";
import { counterForTime } from "./totp.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('A', 'a') RETURNING id")).rows[0]!.id;
  orgB = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('B', 'b') RETURNING id")).rows[0]!.id;
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await db?.stop();
});

async function taoNguoi(orgId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'N', 'ACTIVE') RETURNING id",
    [orgId, `${randomBytes(6).toString("hex")}@vidu.vn`],
  );
  return rows[0]!.id;
}

/** Hồ sơ TOTP của người ấy — `daXacNhan` và `lechBuoc` (0 = bộ đếm hiện tại, 4 = quá cũ). */
async function hoSo(orgId: string, userId: string, daXacNhan: boolean, lechBuoc: number | null): Promise<void> {
  await db.pool.query("DELETE FROM mfa_credentials WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  await db.pool.query(
    "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version, confirmed_at, last_used_counter) VALUES ($1, $2, 'TOTP', '\\x01', 'v1', $3, $4)",
    [orgId, userId, daXacNhan ? new Date() : null, lechBuoc === null ? null : counterForTime(Date.now()) - lechBuoc],
  );
}

const chenPhienMfa = (orgId: string, userId: string) =>
  withTenant(apiPool, orgId, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 hour', now()) RETURNING id",
      [orgId, userId, randomBytes(32)],
    ),
  );

describe("[039] app_api chỉ chèn được phiên đã-MFA khi có một lần TOTP đúng gần đây", () => {
  it("không hồ sơ ⇒ 23514 nêu 039; hồ sơ chưa xác nhận ⇒ 23514; bộ đếm quá cũ (4 bước) ⇒ 23514; tươi ⇒ đi qua; lệch 3 bước vẫn qua", async () => {
    const u = await taoNguoi(orgA);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await expect(chenPhienMfa(orgA, u)).rejects.toThrow(/039/u);
    await hoSo(orgA, u, false, 0);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await hoSo(orgA, u, true, 4);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await hoSo(orgA, u, true, null);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await hoSo(orgA, u, true, 3);
    await expect(chenPhienMfa(orgA, u)).resolves.toMatchObject({ rowCount: 1 });
    await hoSo(orgA, u, true, 0);
    await expect(chenPhienMfa(orgA, u)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("phiên CHƯA MFA (mfa_verified_at NULL) không thuộc 039 — nó thuộc 029, và 029 vẫn chặn app_api", async () => {
    const u = await taoNguoi(orgA);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [orgA, u, randomBytes(32)]),
      ),
    ).rejects.toThrow(/MFA/u);
  });

  it("superuser chèn được phiên đã-MFA không cần hồ sơ; hồ sơ tươi của tổ chức KHÁC không cứu được", async () => {
    const u = await taoNguoi(orgA);
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 hour', now()) RETURNING id",
      [orgA, u, randomBytes(32)],
    );
    expect(rows).toHaveLength(1);
    // Người của B với hồ sơ tươi, nhưng chèn dưới danh nghĩa A: khoá ngoại tổ hợp nói trước (AFTER RI chạy trước 039).
    const uB = await taoNguoi(orgB);
    await hoSo(orgB, uB, true, 0);
    await expect(chenPhienMfa(orgA, uB)).rejects.toMatchObject({ code: "23503" });
  });

  it("ĐỘT BIẾN: gỡ trigger 039 ⇒ bộ đếm cũ ĐI LỌT; khôi phục ⇒ chặn lại", async () => {
    const u = await taoNguoi(orgA);
    await hoSo(orgA, u, true, 10);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await db.pool.query("DROP TRIGGER sessions_kiem_totp_gan_day ON sessions");
    try {
      const { rows } = await chenPhienMfa(orgA, u);
      expect(rows, "RED THẬT: không có 039, một app_api bị chiếm tự chèn phiên đã-MFA").toHaveLength(1);
    } finally {
      await db.pool.query("CREATE TRIGGER sessions_kiem_totp_gan_day AFTER INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION public.sessions_kiem_totp_gan_day()");
      await db.pool.query("ALTER TABLE sessions ENABLE ALWAYS TRIGGER sessions_kiem_totp_gan_day");
    }
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
  });
});
