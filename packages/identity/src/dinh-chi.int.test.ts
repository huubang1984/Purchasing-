// ==============================================================================================
// [034 / sổ nợ 48] ĐÌNH CHỈ ⇒ THU HỒI PHIÊN — hai lớp, mỗi lớp một phép đo riêng.
//
//   Lớp CSDL: trigger `users_thu_hoi_phien_khi_dinh_chi` thu hồi mọi phiên còn sống của người bị
//             đình chỉ trong cùng giao dịch; kích hoạt lại KHÔNG mở lại. Đột biến gỡ trigger ⇒ phiên
//             vẫn sống — RED thật.
//   Lớp gói:  `resolveSessionActor` nối `users.status = 'ACTIVE'` — một phiên CÒN SỐNG của người
//             bị đình chỉ (chèn sau khi đình chỉ, hoặc trigger bị gỡ) vẫn không thành tác nhân.
//   Đường ứng dụng: `app_api` đình chỉ dưới `withTenant` ⇒ trigger chạy dưới RLS của nó và vẫn
//             thu hồi đủ — không cần superuser.
// ==============================================================================================
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { SessionInvalidError, resolveSessionActor } from "./session-actor.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;

async function taoNguoi(email: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi') RETURNING id",
    [orgA, email],
  );
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'BUYER')", [orgA, rows[0]!.id]);
  return rows[0]!.id;
}

/** Phiên ĐÃ MFA, còn hạn — chèn dưới superuser (đường test/vận hành, trigger 029 cố ý miễn). */
async function taoPhien(userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, userId, randomBytes(32)],
  );
  return rows[0]!.id;
}

async function phienSong(userId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return Number(rows[0]?.n ?? "-1");
}

const datTrangThai = (userId: string, status: string) =>
  db.pool.query("UPDATE users SET status = $2 WHERE id = $1", [userId, status]);

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  orgA = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[INV-D1] [034] đình chỉ một người là thu hồi mọi phiên của người ấy", () => {
  it("SUSPENDED ⇒ mọi phiên còn sống bị thu hồi trong cùng giao dịch; ACTIVE lại KHÔNG mở lại; phiên của người KHÁC không bị chạm", async () => {
    const u = await taoNguoi("dinhchi@vidu.vn");
    const khac = await taoNguoi("khac@vidu.vn");
    const s1 = await taoPhien(u);
    const s2 = await taoPhien(u);
    const sKhac = await taoPhien(khac);
    expect(await phienSong(u)).toBe(2);
    // Đối chứng dương trước: phiên đang là một tác nhân hợp lệ.
    await expect(withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, s1))).resolves.toMatchObject({ id: u });

    await datTrangThai(u, "SUSPENDED");
    expect(await phienSong(u)).toBe(0);
    expect(await phienSong(khac)).toBe(1);
    for (const s of [s1, s2]) {
      await expect(withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, s))).rejects.toBeInstanceOf(SessionInvalidError);
    }
    await expect(withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, sKhac))).resolves.toMatchObject({ id: khac });

    // Kích hoạt lại: phiên cũ KHÔNG sống lại — người ấy đăng nhập lại.
    await datTrangThai(u, "ACTIVE");
    expect(await phienSong(u)).toBe(0);
    await expect(withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, s1))).rejects.toBeInstanceOf(SessionInvalidError);
    // Và một phiên MỚI sau khi kích hoạt lại thì hợp lệ — trigger không "đánh dấu" người dùng vĩnh viễn.
    const s3 = await taoPhien(u);
    await expect(withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, s3))).resolves.toMatchObject({ id: u });
  });

  it("đường ứng dụng: app_api đình chỉ dưới withTenant ⇒ trigger chạy dưới RLS của nó và vẫn thu hồi đủ", async () => {
    const u = await taoNguoi("app-dinhchi@vidu.vn");
    await taoPhien(u);
    await taoPhien(u);
    expect(await phienSong(u)).toBe(2);
    const kq = await withTenant(apiPool, orgA, (c) => c.query("UPDATE public.users SET status = 'SUSPENDED' WHERE id = $1", [u]));
    expect(kq.rowCount).toBe(1);
    expect(await phienSong(u)).toBe(0);
  });

  it("lớp GÓI đứng riêng: phiên CÒN SỐNG của người bị đình chỉ (chèn SAU khi đình chỉ) vẫn không thành tác nhân", async () => {
    const u = await taoNguoi("song-sau@vidu.vn");
    await datTrangThai(u, "SUSPENDED");
    const s = await taoPhien(u); // trigger chỉ bắn khi ĐỔI trạng thái — hàng này sống ở tầng CSDL
    expect(await phienSong(u)).toBe(1);
    await expect(withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, s))).rejects.toBeInstanceOf(SessionInvalidError);
    // Cùng một lỗi cho mọi ca hỏng (không oracle): thông điệp giống ca "phiên không tồn tại".
    const [a, b] = await Promise.all([
      withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, s)).catch((e: unknown) => (e as Error).message),
      withTenant(apiPool, orgA, (c) => resolveSessionActor(c, orgA, "3f2504e0-4f89-11d3-9a0c-0305e82c3301")).catch((e: unknown) => (e as Error).message),
    ]);
    expect(a).toBe(b);
  });

  it("ĐỘT BIẾN: gỡ trigger ⇒ SUSPENDED để phiên SỐNG NGUYÊN ở tầng CSDL; khôi phục ⇒ lại thu hồi", async () => {
    const u = await taoNguoi("dot-bien@vidu.vn");
    await taoPhien(u);
    await db.pool.query("DROP TRIGGER users_thu_hoi_phien_khi_dinh_chi ON users");
    try {
      await datTrangThai(u, "SUSPENDED");
      expect(await phienSong(u), "không có trigger, đình chỉ không chạm phiên — đúng trạng thái trước 034").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER users_thu_hoi_phien_khi_dinh_chi AFTER UPDATE OF status ON users FOR EACH ROW EXECUTE FUNCTION public.users_thu_hoi_phien_khi_dinh_chi()",
      );
      await db.pool.query("ALTER TABLE users ENABLE ALWAYS TRIGGER users_thu_hoi_phien_khi_dinh_chi");
    }
    await datTrangThai(u, "ACTIVE");
    expect(await phienSong(u)).toBe(1);
    await datTrangThai(u, "SUSPENDED");
    expect(await phienSong(u)).toBe(0);
  });
});
