import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  MAX_TOTP_WINDOW,
  MFA_LOCKOUT_SECONDS,
  MFA_MAX_ALLOWED_FAILED_ATTEMPTS,
  MFA_MAX_FAILED_ATTEMPTS,
  MfaRequiredError,
  assertFreshMfa,
  counterForTime,
  deriveTotpCode,
  enrollTotpCredential,
  generateTotpSecret,
  verifyTotpAttempt,
  type MfaAttemptResult,
  type TotpAttempt,
  type TotpSecretUnsealer,
  type WrappedTotpSecret,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

// ============================================================================================
// CỔNG MỞ BÍ MẬT DÙNG CHO TEST — VÀ VÌ SAO NÓ TỰ CHỨNG MINH TRƯỚC KHI ĐƯỢC DÙNG
//
// Đây là một cài đặt THẬT của `TotpSecretUnsealer` (AES-256-GCM, khoá dẫn xuất theo tổ chức,
// AAD ràng buộc tổ chức + phiên bản khoá), KHÔNG phải một stub trả thẳng plaintext. Lý do:
// nếu cổng không ràng buộc tổ chức, mọi khẳng định "bí mật của tổ chức A không mở được ở tổ
// chức B" phía dưới sẽ xanh VÌ LÝ DO SAI. Bài học "fixture cũng phải chịu đột biến" đã tái
// xuất bốn lần trong dự án này, nên có một test riêng ở đầu file tấn công chính fixture.
//
// NÓ KHÔNG PHẢI mã sản phẩm và không thay thế được khoản nợ (d) ghi ở mfa-credentials.ts: nó
// sống trong một file test, không có vòng khoá chính do người vận hành quản, không có xoay
// khoá. Cái nó chứng minh là HỢP ĐỒNG CỦA CỔNG đủ để viết một cài đặt đúng.
// ============================================================================================
const MASTER_KEYS: Readonly<Record<string, Buffer>> = {
  v1: Buffer.alloc(32, 0x11),
  v2: Buffer.alloc(32, 0x22),
};
const PHIEN_BAN_DANG_DUNG = "v1";

function khoaTheoToChuc(phienBan: string, orgId: string): Buffer {
  const goc = MASTER_KEYS[phienBan];
  if (goc === undefined) throw new Error(`không có phiên bản khoá "${phienBan}"`);
  // HKDF thật không cần thiết cho một fixture; điều CẦN là khoá phụ thuộc CẢ orgId lẫn phiên bản.
  const dan = Buffer.alloc(32);
  const nem = Buffer.from(orgId, "utf8");
  for (let i = 0; i < 32; i += 1) {
    dan[i] = goc[i]! ^ nem[i % nem.length]!;
  }
  return dan;
}

function bocBiMat(orgId: string, biMat: Buffer): WrappedTotpSecret {
  const iv = randomBytes(12);
  const khoa = khoaTheoToChuc(PHIEN_BAN_DANG_DUNG, orgId);
  const cipher = createCipheriv("aes-256-gcm", khoa, iv);
  cipher.setAAD(Buffer.from(`${PHIEN_BAN_DANG_DUNG}|${orgId}`, "utf8"));
  const than = Buffer.concat([cipher.update(biMat), cipher.final()]);
  khoa.fill(0);
  return {
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), than]),
    keyVersion: PHIEN_BAN_DANG_DUNG,
  };
}

const congMoBiMat: TotpSecretUnsealer = {
  kind: "TOTP_SECRET_UNSEALER",
  name: "aes-gcm-test",
  // eslint-disable-next-line @typescript-eslint/require-await
  async openTotpSecret(orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array> {
    const phongBi = Buffer.from(wrapped.ciphertext);
    const khoa = khoaTheoToChuc(wrapped.keyVersion, orgId);
    try {
      const decipher = createDecipheriv("aes-256-gcm", khoa, phongBi.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${wrapped.keyVersion}|${orgId}`, "utf8"));
      decipher.setAuthTag(phongBi.subarray(12, 28));
      return Buffer.concat([decipher.update(phongBi.subarray(28)), decipher.final()]);
    } finally {
      khoa.fill(0);
    }
  },
};

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;
let orgB: string;
let nguoiA: string;
let nguoiB: string;
let nguoiDinhChi: string;
/** Bí mật TOTP rõ của `nguoiA` — chỉ tồn tại trong tiến trình test. */
let biMatA: Buffer;

async function taoToChuc(ten: string, slug: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [ten, slug],
  );
  return rows[0]!.id;
}

async function taoNguoi(orgId: string, email: string, trangThai = "ACTIVE"): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi Dung', $3) RETURNING id",
    [orgId, email, trangThai],
  );
  return rows[0]!.id;
}

/**
 * Tạo một phiên bằng quyền superuser (fixture), trả về id.
 *
 * `taoLuc` tồn tại vì một ràng buộc CỦA LƯỢC ĐỒ, không phải vì tiện: `CHECK (expires_at >
 * created_at)` cộng `created_at DEFAULT now()` làm một phiên KHÔNG THỂ RA ĐỜI đã hết hạn — đã
 * tự vấp phải khi viết bản đầu của file này ("violates check constraint sessions_check"). Đó
 * là hành vi ĐÚNG của lược đồ; fixture cho phiên hết hạn vì thế phải lùi CẢ `created_at`.
 */
async function taoPhien(
  orgId: string,
  userId: string,
  mfaVerifiedAt: string | null,
  hetHan = "clock_timestamp() + interval '8 hours'",
  taoLuc = "clock_timestamp()",
): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO sessions (org_id, user_id, token_hash, created_at, expires_at, mfa_verified_at)
     VALUES ($1, $2, $3, ${taoLuc}, ${hetHan}, ${mfaVerifiedAt ?? "NULL"})
     RETURNING id`,
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]!.id;
}

/**
 * Chạy MỘT câu lệnh trong MỘT transaction riêng và trả về thông báo lỗi (hoặc "THÀNH CÔNG").
 *
 * Mỗi câu một transaction là BẮT BUỘC, không phải khẩu vị: câu lệnh đầu tiên bị từ chối làm
 * transaction chuyển sang trạng thái hỏng, nên MỌI câu sau đó trong cùng transaction trả
 * `25P02 "current transaction is aborted"` chứ không trả lỗi thật của chính nó. Gộp nhiều phép
 * đo quyền vào một transaction là tự làm mù phép đo từ câu thứ hai trở đi — đã tự vấp phải khi
 * viết bản đầu của file này.
 */
async function chayRieng(
  pool: pg.Pool,
  orgId: string,
  cau: string,
  tham: readonly unknown[] = [],
): Promise<string> {
  return await withTenant(pool, orgId, (c) => c.query(cau, [...tham])).then(
    () => "THÀNH CÔNG",
    (loi: Error) => loi.message,
  );
}

async function demSuKien(orgId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
    [orgId],
  );
  return Number(rows[0]!.n);
}

async function datTrangThaiHoSo(
  userId: string,
  cot: string,
  bieuThuc: string,
): Promise<void> {
  await db.pool.query(
    `UPDATE mfa_credentials SET ${cot} = ${bieuThuc} WHERE user_id = $1`,
    [userId],
  );
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");

  orgA = await taoToChuc("Cong ty A", "cong-ty-a");
  orgB = await taoToChuc("Cong ty B", "cong-ty-b");
  nguoiA = await taoNguoi(orgA, "a@example.com");
  nguoiB = await taoNguoi(orgB, "b@example.com");
  nguoiDinhChi = await taoNguoi(orgA, "dinh-chi@example.com", "SUSPENDED");

  biMatA = generateTotpSecret();
  await withTenant(apiPool, orgA, (c) =>
    enrollTotpCredential(c, { orgId: orgA, userId: nguoiA, wrapped: bocBiMat(orgA, biMatA) }),
  );
});

afterAll(async () => {
  await db?.stop();
});

// ============================================================================================
// 0. HỒ SƠ VAI TRÒ VÀ FIXTURE — ĐO TRƯỚC KHI KẾT LUẬN BẤT CỨ ĐIỀU GÌ
// ============================================================================================
describe("tiền đề của phép đo", () => {
  it("apiPool/unsealPool chạy dưới role THƯỜNG, không superuser, không BYPASSRLS", async () => {
    // Bài học (d) của Task 6: một môi trường test chạy dưới superuser CHE MẤT đột biến về
    // quyền. Mọi kết luận về GRANT ở file này chỉ có giá trị nếu tiền đề này đúng.
    for (const [ten, pool] of [
      ["app_api", apiPool],
      ["app_unseal", unsealPool],
    ] as const) {
      const { rows } = await pool.query<{ u: string; s: boolean; b: boolean }>(
        "SELECT current_user AS u, r.rolsuper AS s, r.rolbypassrls AS b " +
          "  FROM pg_roles r WHERE r.rolname = current_user",
      );
      expect(rows[0]?.u).toBe(ten);
      expect(rows[0]?.s, `${ten} là SUPERUSER — mọi phép đo quyền ở file này vô nghĩa`).toBe(false);
      expect(rows[0]?.b, `${ten} có BYPASSRLS — mọi phép đo RLS ở file này vô nghĩa`).toBe(false);
    }
  });

  it("cổng mở bí mật của test THẬT SỰ ràng buộc tổ chức và phiên bản khoá", async () => {
    // Fixture tự chứng minh trước khi được dùng để kết luận. Không có ba khẳng định này, mọi
    // test "tổ chức B không mở được bí mật của A" ở dưới có thể xanh vì cổng bỏ qua orgId.
    const biMat = Buffer.from("12345678901234567890", "ascii");
    const boc = bocBiMat(orgA, biMat);

    expect(Buffer.from(await congMoBiMat.openTotpSecret(orgA, boc)).equals(biMat)).toBe(true);
    await expect(congMoBiMat.openTotpSecret(orgB, boc)).rejects.toThrow();
    await expect(
      congMoBiMat.openTotpSecret(orgA, { ciphertext: boc.ciphertext, keyVersion: "v2" }),
    ).rejects.toThrow();
  });

  it("hồ sơ MFA lưu KHỐI ĐỤC — bí mật rõ không có mặt trong bảng", async () => {
    const { rows } = await db.pool.query<{ secret_wrapped: Buffer; secret_key_version: string }>(
      "SELECT secret_wrapped, secret_key_version FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.secret_key_version).toBe(PHIEN_BAN_DANG_DUNG);
    // Chống rỗng ruột theo cả hai chiều: khối lưu phải KHÁC bí mật rõ, và phải mở lại ĐÚNG nó.
    expect(rows[0]!.secret_wrapped.includes(biMatA)).toBe(false);
    const moLai = Buffer.from(
      await congMoBiMat.openTotpSecret(orgA, {
        ciphertext: rows[0]!.secret_wrapped,
        keyVersion: rows[0]!.secret_key_version,
      }),
    );
    expect(moLai.equals(biMatA)).toBe(true);
  });
});

// ============================================================================================
// 1. BẤT BIẾN D1 — ĐỘ TƯƠI CỦA XÁC THỰC HAI LỚP
// ============================================================================================
describe("độ tươi của xác thực hai lớp", () => {
  const KIEM = (sessionId: string, userId = nguoiA, orgId = orgA) => ({
    sessionId,
    userId,
    orgId,
    maxAgeSeconds: 300,
  });

  it("[INV-D1] chấp nhận phiên vừa xác thực", async () => {
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId))),
    ).resolves.toBeUndefined();
  });

  it("[INV-D1] từ chối phiên chưa từng xác thực hai lớp", async () => {
    const sessionId = await taoPhien(orgA, nguoiA, null);
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] từ chối phiên đã xác thực nhưng quá cũ", async () => {
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp() - interval '20 minutes'");
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] từ chối phiên đã bị thu hồi dù vừa xác thực", async () => {
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    await db.pool.query("UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1", [
      sessionId,
    ]);
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] từ chối phiên đã HẾT HẠN dù vừa xác thực", async () => {
    // Lùi CẢ `created_at`: lược đồ có `CHECK (expires_at > created_at)`, tức một phiên không ra
    // đời đã hết hạn được. Xem chú thích ở `taoPhien`.
    const sessionId = await taoPhien(
      orgA,
      nguoiA,
      "clock_timestamp()",
      "clock_timestamp() - interval '1 second'",
      "clock_timestamp() - interval '2 hours'",
    );
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] mốc xác thực Ở TƯƠNG LAI KHÔNG phải là 'tươi'", async () => {
    // Không có vế cận trên, một mốc ở tương lai làm phiên "luôn vừa xác thực" VĨNH VIỄN — và
    // app_api ĐƯỢC cấp UPDATE (mfa_verified_at), nên đó là một đường đi có thật, không giả định.
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp() + interval '1 year'");
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] người dùng bị ĐÌNH CHỈ không đi qua được dù phiên vừa xác thực", async () => {
    const sessionId = await taoPhien(orgA, nguoiDinhChi, "clock_timestamp()");
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiDinhChi))),
    ).rejects.toBeInstanceOf(MfaRequiredError);

    // Đối chứng dương, cùng phiên, cùng câu lệnh: khôi phục trạng thái thì nó QUA. Không có vế
    // này, khẳng định trên xanh kể cả khi truy vấn hỏng vì một lý do khác hẳn.
    await db.pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [nguoiDinhChi]);
    try {
      await expect(
        withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiDinhChi))),
      ).resolves.toBeUndefined();
    } finally {
      await db.pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [nguoiDinhChi]);
    }
  });

  it("[INV-D1] sessionId của NGƯỜI KHÁC bị từ chối — userId là tham số CHỊU LỰC", async () => {
    // Brief (mục Interfaces) khai `{userId, orgId}`, brief (Step 6) cài `{sessionId}`. Bản chỉ
    // có sessionId trả lời "phiên này vừa xác thực chưa" trong khi D1 hỏi "NGƯỜI đang thao tác
    // vừa xác thực chưa": ghép nhầm một sessionId hợp lệ của người khác vào request sẽ đi lọt.
    const nguoiKhac = await taoNguoi(orgA, "nguoi-khac@example.com");
    const sessionId = await taoPhien(orgA, nguoiKhac, "clock_timestamp()");

    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiKhac))),
    ).resolves.toBeUndefined(); // đối chứng dương: đúng chủ thì QUA
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiA))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-F1] phiên của tổ chức khác không nhìn thấy được — kể cả với đúng userId", async () => {
    const sessionId = await taoPhien(orgB, nguoiB, "clock_timestamp()");
    await expect(
      withTenant(apiPool, orgA, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiB, orgA))),
    ).rejects.toBeInstanceOf(MfaRequiredError);
    // Đối chứng dương: trong đúng tổ chức thì nó QUA — tức phép chặn trên không phải "chặn tất cả".
    await expect(
      withTenant(apiPool, orgB, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiB, orgB))),
    ).resolves.toBeUndefined();
  });

  it("[INV-F1] assertFreshMfa NÉM khi phiên đang gắn tổ chức KHÁC với orgId được hỏi", async () => {
    // `orgId` phải CHỊU LỰC chứ không trang trí: không có assertTenantBound, lời gọi này trả
    // "không tươi" — đúng hướng an toàn nhưng là "không thấy gì" chứ không phải "chưa xác thực",
    // và hai thứ đó phải phân biệt được. Cùng khuôn `hasPermission` (rbac.ts, quyết định (1)).
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    await expect(
      withTenant(apiPool, orgB, (c) => assertFreshMfa(c, KIEM(sessionId, nguoiA, orgA))),
    ).rejects.toThrow(/phiên đang gắn tổ chức/);
  });

  it("assertFreshMfa từ chối tham số sai hình dạng TRƯỚC khi chạm Postgres", async () => {
    // Một uuid sai hình dạng cho 22P02 và làm HỎNG transaction đang mở, nên `withTenant` sẽ
    // biến COMMIT thành ROLLBACK trong im lặng. Và lỗi này KHÔNG được là MfaRequiredError:
    // nhánh xử lý mặc định `catch (MfaRequiredError) -> đòi xác thực lại` sẽ nuốt mất một lỗi
    // ghép tham số.
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    await withTenant(apiPool, orgA, async (c) => {
      for (const xau of ["", "khong-phai-uuid", `${sessionId}x`]) {
        await expect(
          assertFreshMfa(c, { sessionId: xau, userId: nguoiA, orgId: orgA, maxAgeSeconds: 300 }),
        ).rejects.toThrow(/UUID hợp lệ/);
      }
      for (const so of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          assertFreshMfa(c, { sessionId, userId: nguoiA, orgId: orgA, maxAgeSeconds: so }),
        ).rejects.toThrow(/số dương hữu hạn/);
      }
      // Transaction PHẢI còn dùng được — đó chính là điều bản kiểm-trong-Postgres không giữ được.
      await expect(assertFreshMfa(c, KIEM(sessionId))).resolves.toBeUndefined();
    });
  });

  it("[INV-D1] ĐỘ TƯƠI ĐO BẰNG clock_timestamp(), KHÔNG PHẢI now() — mốc chết của cạm bẫy đồng hồ", async () => {
    // `now()` = `transaction_timestamp()` đóng băng ở lúc BẮT ĐẦU transaction. Không có test
    // này, mũi đột biến `clock_timestamp() -> now()` SỐNG SÓT trọn vẹn, vì mọi test khác chạy
    // trong những transaction ngắn tới mức hai đồng hồ không phân biệt được.
    //
    // Dựng đúng ca nguy hiểm: phiên vừa xác thực, cửa sổ 1 giây, rồi NGỦ 1,6 giây BÊN TRONG
    // transaction. Với `clock_timestamp()` nó đã cũ; với `now()` nó vẫn "vừa xác thực".
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    await withTenant(apiPool, orgA, async (c) => {
      // Tiền đề của phép đo, tự chứng minh: hai đồng hồ THẬT SỰ tách nhau trong transaction này.
      await expect(
        assertFreshMfa(c, { sessionId, userId: nguoiA, orgId: orgA, maxAgeSeconds: 1 }),
      ).resolves.toBeUndefined();
      await c.query("SELECT pg_sleep(1.6)");
      const { rows } = await c.query<{ lech: string }>(
        "SELECT (clock_timestamp() - now())::text AS lech",
      );
      expect(
        Number.parseFloat(rows[0]!.lech.split(":").pop()!),
        "hai đồng hồ chưa tách nhau — phép đo rỗng ruột",
      ).toBeGreaterThan(1);

      await expect(
        assertFreshMfa(c, { sessionId, userId: nguoiA, orgId: orgA, maxAgeSeconds: 1 }),
      ).rejects.toBeInstanceOf(MfaRequiredError);
    });
  }, 60_000);

  it("[INV-D1] vế expires_at cũng đo bằng clock_timestamp() — phiên hết hạn GIỮA transaction", async () => {
    // Mốc chết riêng cho vế thứ hai. Không có nó, mũi đột biến chỉ đổi `expires_at` sang `now()`
    // sống sót trong khi vế `mfa_verified_at` vẫn bị test trên giết — đúng khuôn "một bản vá
    // được canh ở 2/5 vế" mà Task 8 đã vấp.
    const sessionId = await taoPhien(
      orgA,
      nguoiA,
      "clock_timestamp()",
      "clock_timestamp() + interval '1 second'",
    );
    await withTenant(apiPool, orgA, async (c) => {
      await expect(
        assertFreshMfa(c, { sessionId, userId: nguoiA, orgId: orgA, maxAgeSeconds: 300 }),
      ).resolves.toBeUndefined();
      await c.query("SELECT pg_sleep(1.6)");
      await expect(
        assertFreshMfa(c, { sessionId, userId: nguoiA, orgId: orgA, maxAgeSeconds: 300 }),
      ).rejects.toBeInstanceOf(MfaRequiredError);
    });
  }, 60_000);

  it("[CẤM LOG] MfaRequiredError không mang sessionId, userId hay orgId", async () => {
    const sessionId = await taoPhien(orgA, nguoiA, null);
    const loi = await withTenant(apiPool, orgA, (c) =>
      assertFreshMfa(c, KIEM(sessionId)).then(
        () => null,
        (e: Error) => e,
      ),
    );
    expect(loi).toBeInstanceOf(MfaRequiredError);
    const chuoi = `${loi!.name}: ${loi!.message}`;
    for (const bi of [sessionId, nguoiA, orgA]) {
      expect(chuoi).not.toContain(bi);
    }
    expect(chuoi).toContain("300"); // maxAgeSeconds là hằng chính sách, được phép nêu
  });
});

// ============================================================================================
// 2. BẤT BIẾN E3 — GIỚI HẠN SỐ LẦN THỬ, DÙNG MỘT LẦN, BỀN VỮNG QUA HAI REQUEST
// ============================================================================================
describe("xác thực TOTP bền vững", () => {
  const NGAY = 1_700_000_000_000;

  async function thu(
    orgId: string,
    userId: string,
    code: string,
    now: number,
  ): Promise<MfaAttemptResult> {
    return await withTenant(apiPool, orgId, (c) =>
      verifyTotpAttempt(c, { orgId, userId, code, now }, congMoBiMat),
    );
  }

  async function datLai(userId: string): Promise<void> {
    await db.pool.query(
      "UPDATE mfa_credentials SET last_used_counter = NULL, failed_attempts = 0, " +
        "locked_until = NULL WHERE user_id = $1",
      [userId],
    );
  }

  it("[INV-E3] mã đúng được chấp nhận, và bộ đếm được GHI LẠI", async () => {
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    const ketQua = await thu(orgA, nguoiA, deriveTotpCode(biMatA, buoc), NGAY);
    expect(ketQua).toEqual({ ok: true, counter: buoc });

    const { rows } = await db.pool.query<{ c: string | null; f: number; l: Date | null; xn: Date | null }>(
      "SELECT last_used_counter AS c, failed_attempts AS f, locked_until AS l, confirmed_at AS xn " +
        "  FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(Number(rows[0]!.c)).toBe(buoc);
    expect(rows[0]!.f).toBe(0);
    expect(rows[0]!.l).toBeNull();
    // Lần thành công ĐẦU TIÊN đóng `confirmed_at` — không có đường nào đặt nó mà không qua một
    // mã đúng (app_api không được INSERT cột đó, xem 006).
    expect(rows[0]!.xn).toBeInstanceOf(Date);
  });

  it("[INV-E3] confirmed_at đóng ở lần thành công ĐẦU TIÊN và KHÔNG bị ghi đè", async () => {
    // `COALESCE(c.confirmed_at, clock_timestamp())` chứ không phải `clock_timestamp()` trần.
    // Không có khẳng định này, mũi đột biến bỏ COALESCE SỐNG SÓT (đã đo: 44/44 xanh) và cột đổi
    // nghĩa trong im lặng — từ "lúc người dùng chứng minh giữ được thiết bị" thành "lần xác thực
    // gần nhất", tức mất hẳn dấu vết thời điểm ghi danh hoàn tất.
    await datLai(nguoiA);
    expect((await thu(orgA, nguoiA, deriveTotpCode(biMatA, counterForTime(NGAY)), NGAY)).ok).toBe(
      true,
    );
    const doc = async (): Promise<string> => {
      const { rows } = await db.pool.query<{ xn: string }>(
        "SELECT confirmed_at::text AS xn FROM mfa_credentials WHERE user_id = $1",
        [nguoiA],
      );
      return rows[0]!.xn;
    };
    const lanDau = await doc();
    expect(lanDau).not.toBeNull();

    const sau = NGAY + 60_000;
    expect((await thu(orgA, nguoiA, deriveTotpCode(biMatA, counterForTime(sau)), sau)).ok).toBe(
      true,
    );
    expect(await doc(), "confirmed_at bị ghi đè ở lần xác thực thứ hai").toBe(lanDau);
  });

  it("[INV-E3] DÙNG MỘT LẦN BỀN VỮNG: cùng mã, hai request TUẦN TỰ — request thứ hai bị từ chối", async () => {
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    const ma = deriveTotpCode(biMatA, buoc);

    expect((await thu(orgA, nguoiA, ma, NGAY)).ok).toBe(true);
    const lanHai = await thu(orgA, nguoiA, ma, NGAY);
    expect(lanHai).toMatchObject({ ok: false, reason: "CODE_ALREADY_USED" });

    // Và nó THẬT SỰ bền vững qua ranh giới transaction: giá trị nằm trong bảng, không trong bộ
    // nhớ tiến trình. Một cài đặt chỉ dùng hàm thuần sẽ cho `ok: true` ở đây.
    const { rows } = await db.pool.query<{ c: string }>(
      "SELECT last_used_counter AS c FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(Number(rows[0]!.c)).toBe(buoc);
  });

  it("[INV-E3] TOCTOU: hai request ĐỒNG THỜI cùng một mã — đúng MỘT request qua", async () => {
    // ==========================================================================================
    // MỐC CHẾT PHẢI TẤT ĐỊNH, KHÔNG PHỤ THUỘC LỊCH BIỂU. Bản đầu của test này chỉ
    // `Promise.all([thu(...), thu(...)])` và nó SỐNG SÓT mũi đột biến gỡ hẳn vế
    // `last_used_counter < $3` khỏi câu ghi — đo được: 43/43 test vẫn xanh. Lý do là hai lời gọi
    // đi qua nhiều round trip nên vòng lặp sự kiện của Node tình cờ tuần tự hoá chúng, và khi đó
    // vế "dùng một lần" được cưỡng chế bởi HÀM THUẦN (lời gọi thứ hai ĐỌC ĐƯỢC last_used_counter
    // đã ghi) chứ không bởi vế chống đua. Một mốc chết phụ thuộc lịch biểu là một mốc chết GIẢ.
    //
    // Bản này ép ĐÚNG cửa sổ đua bằng chính CỔNG mở bí mật: cổng được gọi SAU câu SELECT và
    // TRƯỚC câu UPDATE, nên chặn nó lại là chốt được request A ở giữa hai câu đó.
    //   A: BEGIN, SELECT (last_used_counter = NULL), rồi TREO trong cổng
    //   B: chạy trọn vẹn, ghi last_used_counter = C, COMMIT
    //   A: thả cổng ra, chạy tiếp câu UPDATE — bây giờ hàng đã mang C
    // Với vế chống đua, A nhận rowCount = 0 -> CODE_ALREADY_USED. Không có nó, A ghi đè và CẢ
    // HAI cùng "xác thực thành công" — đúng kịch bản kẻ tấn công gửi SONG SONG một mã bắt được.
    // ==========================================================================================
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    const ma = deriveTotpCode(biMatA, buoc);

    let thaCong = (): void => {};
    const chotLai = new Promise<void>((r) => {
      thaCong = r;
    });
    let baoDaVaoCong = (): void => {};
    const daVaoCong = new Promise<void>((r) => {
      baoDaVaoCong = r;
    });

    const congTreo: TotpSecretUnsealer = {
      kind: "TOTP_SECRET_UNSEALER",
      name: "treo",
      async openTotpSecret(orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array> {
        baoDaVaoCong();
        await chotLai;
        return await congMoBiMat.openTotpSecret(orgId, wrapped);
      },
    };
    const chayA: Promise<MfaAttemptResult> = withTenant(apiPool, orgA, (c) =>
      verifyTotpAttempt(c, { orgId: orgA, userId: nguoiA, code: ma, now: NGAY }, congTreo),
    );

    await daVaoCong; // A đã SELECT xong và đang treo TRONG cổng.
    const b = await thu(orgA, nguoiA, ma, NGAY);
    expect(b, "request B (chạy trọn vẹn trước) phải QUA").toMatchObject({ ok: true });

    thaCong();
    const a = await chayA;
    expect(
      a,
      `Request A ghi đè bộ đếm của B — vế "dùng một lần" của E3 sụp ở đúng ca nó cần nhất. ` +
        `Kết quả A: ${JSON.stringify(a)}`,
    ).toMatchObject({ ok: false, reason: "CODE_ALREADY_USED" });

    // Và bộ đếm trong bảng vẫn đúng bằng bước đã dùng, không bị A ghi đè.
    const { rows } = await db.pool.query<{ c: string }>(
      "SELECT last_used_counter AS c FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(Number(rows[0]!.c)).toBe(buoc);
  }, 60_000);

  it("[INV-E3] bộ đếm vượt số nguyên an toàn của JS bị TỪ CHỐI, không so sánh sai trong im lặng", async () => {
    // `last_used_counter` là `bigint`; `pg` trả nó dưới dạng CHUỖI. Một giá trị vượt
    // Number.MAX_SAFE_INTEGER (2^53-1) mà đem `Number()` sẽ LÀM TRÒN, và mọi phép so
    // `khop <= daDung` sau đó phán xét trên một con số KHÔNG PHẢI giá trị trong bảng — tức vế
    // "dùng một lần" hỏng trong im lặng. Fail-closed và ồn ào.
    await datLai(nguoiA);
    await datTrangThaiHoSo(nguoiA, "last_used_counter", "9223372036854775807");
    const ma = deriveTotpCode(biMatA, counterForTime(NGAY));
    await expect(
      withTenant(apiPool, orgA, (c) =>
        verifyTotpAttempt(c, { orgId: orgA, userId: nguoiA, code: ma, now: NGAY }, congMoBiMat),
      ),
    ).rejects.toThrow(/số nguyên an toàn/);
    await datLai(nguoiA);
  });

  it("[INV-E3] CỬA SỔ ĐUA LÀ CÓ THẬT — đường đọc-rồi-ghi ngây thơ cho CẢ HAI qua", async () => {
    // Fixture tự chứng minh trước khi kết luận: nếu không có phép đo này, test TOCTOU ở trên
    // có thể xanh chỉ vì Postgres tình cờ tuần tự hoá hai request, chứ không vì vế
    // `last_used_counter < $3` chịu lực. Ở đây dựng ĐÚNG khuôn ngây thơ (SELECT ở cả hai
    // transaction TRƯỚC, rồi UPDATE không điều kiện) và đo rằng cả hai đều "thành công".
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);

    const c1 = await apiPool.connect();
    const c2 = await apiPool.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      }
      const doc = async (c: pg.PoolClient): Promise<string | null> => {
        const { rows } = await c.query<{ c: string | null }>(
          "SELECT last_used_counter AS c FROM mfa_credentials WHERE user_id = $1",
          [nguoiA],
        );
        return rows[0]!.c;
      };
      // CẢ HAI đọc trước — đây chính là cửa sổ.
      expect(await doc(c1)).toBeNull();
      expect(await doc(c2)).toBeNull();

      const ghiNgayTho = async (c: pg.PoolClient): Promise<number> => {
        const { rowCount } = await c.query(
          "UPDATE mfa_credentials SET last_used_counter = $2 WHERE user_id = $1",
          [nguoiA, buoc],
        );
        return rowCount ?? 0;
      };
      expect(await ghiNgayTho(c1)).toBe(1);
      await c1.query("COMMIT");
      // Không có vế điều kiện, transaction thứ hai cũng ghi được: CẢ HAI "xác thực thành công".
      expect(
        await ghiNgayTho(c2),
        "Đường ngây thơ KHÔNG tái lập được cửa sổ đua — test TOCTOU ở trên mất giá trị.",
      ).toBe(1);
      await c2.query("COMMIT");
    } finally {
      // Trả kết nối TRƯỚC khi lấy cặp thứ hai: apiPool có max = 3, nên giữ bốn kết nối cùng lúc
      // làm `connect()` chờ VĨNH VIỄN (pg-pool không có timeout mặc định) và mọi test sau đó
      // trên pool này treo theo. Đã tự vấp phải ở bản đầu của file này — cùng lớp lỗi [fix I4]
      // mà migrate() đã phải đóng.
      c1.release();
      c2.release();
    }

    // Đối chứng: CÙNG hai transaction, CÙNG thứ tự, nhưng với vế điều kiện của mã sản phẩm thì
    // transaction thứ hai KHÔNG ghi được.
    await datLai(nguoiA);
    const c3 = await apiPool.connect();
    const c4 = await apiPool.connect();
    try {
      for (const c of [c3, c4]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      }
      const ghiCoDieuKien = async (c: pg.PoolClient): Promise<number> => {
        const { rowCount } = await c.query(
          "UPDATE mfa_credentials SET last_used_counter = $2 WHERE user_id = $1 " +
            "  AND (last_used_counter IS NULL OR last_used_counter < $2)",
          [nguoiA, buoc],
        );
        return rowCount ?? 0;
      };
      expect(await ghiCoDieuKien(c3)).toBe(1);
      await c3.query("COMMIT");
      expect(await ghiCoDieuKien(c4)).toBe(0);
      await c4.query("COMMIT");
    } finally {
      c3.release();
      c4.release();
    }
  });

  it("[INV-E3] mã của bước TRƯỚC không chơi lại được sau khi bước sau đã dùng", async () => {
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    expect((await thu(orgA, nguoiA, deriveTotpCode(biMatA, buoc), NGAY)).ok).toBe(true);
    // Mã của `buoc - 1` vẫn nằm trong cửa sổ trượt và vẫn "đúng" về mật mã.
    const lai = await thu(orgA, nguoiA, deriveTotpCode(biMatA, buoc - 1), NGAY);
    expect(lai).toMatchObject({ ok: false, reason: "CODE_ALREADY_USED" });
  });

  it("[INV-E3] GIỚI HẠN SỐ LẦN THỬ: lần thất bại thứ N khoá hồ sơ, và khoá CHẶN mã ĐÚNG", async () => {
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    const maDung = deriveTotpCode(biMatA, buoc);
    const maSai = maDung === "000000" ? "111111" : "000000";

    for (let lan = 1; lan < MFA_MAX_FAILED_ATTEMPTS; lan += 1) {
      const r = await thu(orgA, nguoiA, maSai, NGAY);
      expect(r, `lần ${lan} không được khoá`).toMatchObject({
        ok: false,
        reason: "WRONG_CODE",
        justLocked: false,
      });
      expect((r as { lockedUntil: Date | null }).lockedUntil).toBeNull();
    }

    const lanKhoa = await thu(orgA, nguoiA, maSai, NGAY);
    expect(lanKhoa).toMatchObject({ ok: false, reason: "WRONG_CODE", justLocked: true });
    expect((lanKhoa as { lockedUntil: Date | null }).lockedUntil).toBeInstanceOf(Date);

    // Đây là vế mua được thật: sau khi khoá, MÃ ĐÚNG cũng bị từ chối.
    expect(await thu(orgA, nguoiA, maDung, NGAY)).toMatchObject({
      ok: false,
      reason: "LOCKED_OUT",
    });

    const { rows } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows[0]!.f).toBe(MFA_MAX_FAILED_ATTEMPTS);
  });

  it("[INV-E3] GIỚI HẠN SỐ LẦN THỬ DƯỚI ĐỒNG THỜI: hai lần THẤT BẠI chồng nhau đếm thành HAI", async () => {
    // ==========================================================================================
    // [vòng fix 1 — MỤC 1] MỐC CHẾT CHO TRỤC ĐẾM, ĐẶT NGANG KỶ LUẬT VỚI TRỤC "DÙNG MỘT LẦN".
    //
    // Bộ test của Task 9 đo khoá TUẦN TỰ và đo việc đặt lại bộ đếm sau cửa sổ, nhưng KHÔNG một
    // test nào đặt HAI lần THẤT BẠI chồng nhau — trong khi trục "dùng một lần", nằm trên CÙNG
    // một hàng và CÙNG một bất biến, thì được ép đua rất kỹ (test TOCTOU ở trên). Khoảng trống
    // đó che một lỗ fail-OPEN đã đo được: bản đầu tính số lần thất bại mới trong một CTE, thứ
    // KHÔNG được EvalPlanQual tính lại trên tuple đã cập nhật, nên N request chồng nhau chỉ làm
    // bộ đếm tăng ĐÚNG MỘT (đo: 24 request song song, ngưỡng 5 -> 24 mã được phán xét,
    // LOCKED_OUT = 0, failed_attempts cuối = 3).
    //
    // CỬA SỔ ĐUA ĐƯỢC ÉP TẤT ĐỊNH, KHÔNG NHỜ LỊCH BIỂU — đây là điều kiện để mốc chết này thật:
    //   A: BEGIN, `SELECT ... FOR UPDATE` -> giữ KHOÁ HÀNG mà KHÔNG đổi `failed_attempts`
    //   B: chạy verifyTotpAttempt với mã sai; câu UPDATE của nó CHỤP ẢNH (failed_attempts = 0)
    //      rồi KẸT ở khoá hàng của A. Việc B thật sự kẹt được QUAN SÁT qua pg_stat_activity,
    //      không phải giả định.
    //   A: chạy verifyTotpAttempt của chính mình (cùng transaction nên không tự kẹt), COMMIT
    //   B: được thả, EvalPlanQual đánh giá lại trên tuple ĐÃ cập nhật
    // Với biểu thức TỰ THAM CHIẾU HÀNG ĐÍCH, B ghi 2. Với CTE, B ghi 1.
    // ==========================================================================================
    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    const maSai = deriveTotpCode(biMatA, buoc) === "000000" ? "111111" : "000000";

    const demKetKhoa = async (): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active'
            AND wait_event_type = 'Lock'`,
      );
      return Number(rows[0]!.n);
    };

    let ketQuaB: MfaAttemptResult | null = null;
    let loiB: unknown = null;
    const ketQuaA = await withTenant(apiPool, orgA, async (cA) => {
      await cA.query(
        "SELECT id FROM mfa_credentials WHERE user_id = $1 FOR UPDATE",
        [nguoiA],
      );

      // Hai nhánh của `.then` được truyền NGAY, không để một lần từ chối trở thành unhandled
      // rejection trong khoảng thời gian A còn đang giữ khoá.
      const chayB = withTenant(apiPool, orgA, (cB) =>
        verifyTotpAttempt(cB, { orgId: orgA, userId: nguoiA, code: maSai, now: NGAY }, congMoBiMat),
      ).then(
        (r) => {
          ketQuaB = r;
        },
        (e: unknown) => {
          loiB = e;
        },
      );

      // Chờ B THẬT SỰ kẹt ở khoá hàng. Nếu nó không bao giờ kẹt thì cửa sổ đua chưa được ép và
      // mọi khẳng định dưới đây vô nghĩa — nên hết thời gian là ĐỎ, không phải "đi tiếp".
      const hetHan = Date.now() + 20_000;
      while ((await demKetKhoa()) === 0) {
        if (Date.now() > hetHan) {
          throw new Error(
            "Request B không bao giờ kẹt ở khoá hàng — cửa sổ đua KHÔNG được ép, mốc chết này rỗng ruột.",
          );
        }
        await new Promise((r) => setTimeout(r, 25));
      }

      const a = await verifyTotpAttempt(
        cA,
        { orgId: orgA, userId: nguoiA, code: maSai, now: NGAY },
        congMoBiMat,
      );
      // `withTenant` COMMIT khi callback trả về; B được thả ngay sau đó.
      return { a, chayB };
    });

    await ketQuaA.chayB;
    expect(loiB, `request B ném thay vì trả kết quả: ${String(loiB)}`).toBeNull();
    expect(ketQuaA.a).toMatchObject({ ok: false, reason: "WRONG_CODE" });
    expect(ketQuaB).toMatchObject({ ok: false, reason: "WRONG_CODE" });

    const { rows } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(
      rows[0]!.f,
      "HAI lần thất bại CHỒNG NHAU chỉ làm bộ đếm tăng 1 — đây là MẤT CẬP NHẬT, và nó cho kẻ " +
        "tấn công đổi mỗi đơn vị bộ đếm lấy số lần đoán tuỳ ý (biên độ do chính nó chọn, không " +
        "có cận trên trong thiết kế). Xem khối CAU_GHI_THAT_BAI ở mfa-credentials.ts.",
    ).toBe(2);
    await datLai(nguoiA);
  }, 60_000);

  it("[INV-E3] LOẠT ĐẦU dưới đồng thời 24: 24 mã ĐƯỢC PHÁN XÉT, bộ đếm 24, rồi hồ sơ BỊ KHOÁ", async () => {
    // ==========================================================================================
    // [vòng fix 2 — MỤC 1] GHIM CHÍNH CON SỐ, ĐỂ DƯ LƯỢNG LÀ BẰNG CHỨNG ĐO ĐƯỢC CHỨ KHÔNG PHẢI
    // MỘT CÂU TRONG CHÚ THÍCH.
    //
    // Vòng fix 1 viết vào `CAU_GHI_THAT_BAI` rằng mỗi cửa sổ cho đúng `maxFailedAttempts` lần
    // đoán được phán xét "KỂ CẢ KHI các lần đoán tới ĐỒNG THỜI". Vế sau BỊ ĐO LÀ SAI: `dang_khoa`
    // đọc từ câu SELECT chạy TRƯỚC khi bất kỳ request nào ghi, nên N request chồng nhau đều thấy
    // `locked_until IS NULL` và đều đi TRỌN tới `verifyTotpCode`. Test này ghim cả HAI nửa của
    // phát biểu đã được hạ xuống:
    //   (A) DƯ LƯỢNG CÓ THẬT — loạt đầu cho tới C mã được phán xét, KHÔNG phải `maxFailedAttempts`
    //       (ở đây 24 so với ngưỡng 5, tức 4,8x);
    //   (B) THỨ BẢN VÁ MUA ĐƯỢC — biên độ đúng 1 (24 phán xét -> bộ đếm 24, không phải 3), và
    //       SAU loạt hồ sơ BỊ KHOÁ, nên đây là "24 lần MỘT LẦN rồi khoá", không phải "24 lần mỗi
    //       cửa sổ, lặp mãi" như bản CTE.
    //
    // ĐỒNG THỜI ĐƯỢC ÉP TẤT ĐỊNH, KHÔNG NHỜ LỊCH BIỂU — cùng kỷ luật với test hai-request ở trên,
    // và đây là điều kiện để con số 24 không phải một phép đo may rủi: một transaction ngoài giữ
    // KHOÁ HÀNG bằng `SELECT ... FOR UPDATE`. Câu SELECT của `verifyTotpAttempt` KHÔNG bị khoá
    // hàng chặn (người đọc không chờ người ghi), nên cả 24 request đi qua phép kiểm `dang_khoa`
    // rồi KẸT ở câu UPDATE. Việc cả 24 thật sự kẹt được QUAN SÁT qua pg_stat_activity; không đủ
    // 24 thì ĐỎ, không phải "đi tiếp".
    //
    // `poolAs()` trả pool `max = 3`, nên 24 request đồng thời đòi 8 pool — nếu không, 21 request
    // sẽ xếp hàng ở tầng pool và phép đo này đo hàng đợi của pg-pool chứ không đo CSDL.
    //
    // NẾU AI ĐÓ ĐÓNG TRẦN LOẠT ĐẦU (khoản nợ: lấy khoá hàng TRƯỚC lời gọi cổng mở bí mật), test
    // này ĐỎ — và đó là kết cục ĐÚNG: việc đóng phải đi kèm sửa phát biểu ở `CAU_GHI_THAT_BAI`
    // và một quyết định về đánh đổi DoS, chứ không được trôi qua trong im lặng.
    // ==========================================================================================
    const N = 24;
    const SO_POOL = 8;

    await datLai(nguoiA);
    const buoc = counterForTime(NGAY);
    const maSai = deriveTotpCode(biMatA, buoc) === "000000" ? "111111" : "000000";

    // Vế chống rỗng ruột thứ nhất: hồ sơ phải KHÔNG bị khoá trước loạt, nếu không "24 lần được
    // phán xét" có thể xanh vì một lý do khác hẳn.
    const { rows: truoc } = await db.pool.query<{ f: number; l: Date | null }>(
      "SELECT failed_attempts AS f, locked_until AS l FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(truoc[0]!.f, "loạt phải bắt đầu từ bộ đếm 0").toBe(0);
    expect(truoc[0]!.l, "loạt phải bắt đầu từ hồ sơ KHÔNG bị khoá").toBeNull();

    const cacPool = Array.from({ length: SO_POOL }, () => db.poolAs("app_api"));
    const demKetKhoa = async (): Promise<number> => {
      const { rows } = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active'
            AND wait_event_type = 'Lock'`,
      );
      return Number(rows[0]!.n);
    };

    const giu = await db.pool.connect();
    let ketQua: PromiseSettledResult<MfaAttemptResult>[];
    try {
      await giu.query("BEGIN");
      await giu.query("SELECT id FROM mfa_credentials WHERE user_id = $1 FOR UPDATE", [nguoiA]);

      const tatCa = Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          withTenant(cacPool[i % SO_POOL]!, orgA, (c) =>
            verifyTotpAttempt(
              c,
              { orgId: orgA, userId: nguoiA, code: maSai, now: NGAY },
              congMoBiMat,
            ),
          ),
        ),
      );

      const hetHan = Date.now() + 60_000;
      let ketCuoi = 0;
      while ((ketCuoi = await demKetKhoa()) < N) {
        if (Date.now() > hetHan) {
          throw new Error(
            `Chỉ ${ketCuoi}/${N} request kẹt ở khoá hàng — cửa sổ đồng thời KHÔNG được ép, ` +
              "nên mọi con số dưới đây vô nghĩa.",
          );
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      await giu.query("COMMIT");
      ketQua = await tatCa;
    } finally {
      giu.release();
      await Promise.allSettled(cacPool.map((p) => p.end()));
    }

    const nem = ketQua.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(nem.length, `có request ném: ${nem.map((r) => String(r.reason)).join(" | ")}`).toBe(0);
    const daPhanXet = ketQua.filter(
      (r) => r.status === "fulfilled" && !r.value.ok && r.value.reason === "WRONG_CODE",
    ).length;
    const biKhoaSom = ketQua.filter(
      (r) => r.status === "fulfilled" && !r.value.ok && r.value.reason === "LOCKED_OUT",
    ).length;

    // (A) DƯ LƯỢNG. Con số này LỚN HƠN ngưỡng, và đó chính là thứ câu "đúng maxFailedAttempts
    //     mỗi cửa sổ, kể cả khi ĐỒNG THỜI" nói sai.
    expect(
      daPhanXet,
      "cả 24 request đều đi TRỌN tới verifyTotpCode vì `dang_khoa` được đọc TRƯỚC khi bất kỳ " +
        "request nào ghi — đây là DƯ LƯỢNG, không phải thứ bản vá mua được",
    ).toBe(N);
    expect(biKhoaSom, "không request nào bị chặn sớm trong loạt ĐẦU").toBe(0);
    expect(N).toBeGreaterThan(MFA_MAX_FAILED_ATTEMPTS);

    // (B) THỨ BẢN VÁ MUA ĐƯỢC: biên độ đúng 1, và sau loạt thì KHOÁ.
    const { rows: sau } = await db.pool.query<{ f: number; l: Date | null }>(
      "SELECT failed_attempts AS f, locked_until AS l FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(
      sau[0]!.f,
      "24 mã được phán xét phải làm bộ đếm tăng ĐÚNG 24 (biên độ 1). Bản CTE cho 3 — tức 24 " +
        "lần đoán mỗi đơn vị bộ đếm, và vì hồ sơ không bao giờ khoá thì LẶP MÃI.",
    ).toBe(N);
    expect(
      sau[0]!.l,
      "sau loạt đầu hồ sơ phải BỊ KHOÁ — đó là thứ biến 'N lần đoán' thành 'N lần MỘT LẦN'",
    ).toBeInstanceOf(Date);
    expect(sau[0]!.l!.getTime()).toBeGreaterThan(Date.now());

    // Vế chống rỗng ruột thứ hai, ĐỐI CHỨNG DƯƠNG: khoá vừa đặt CÓ hiệu lực — một request tiếp
    // theo bị chặn ở LOCKED_OUT. Không có vế này, "hồ sơ BỊ KHOÁ" chỉ là một cột trong bảng.
    expect(await thu(orgA, nguoiA, maSai, NGAY)).toMatchObject({
      ok: false,
      reason: "LOCKED_OUT",
    });

    await datLai(nguoiA);
  }, 180_000);

  it("[INV-E3] khoá HẾT HẠN thì bộ đếm ĐẶT LẠI VỀ 1, KHÔNG để lại mốc quá khứ", async () => {
    // [vòng fix 2 — MỤC 1] TÊN CŨ ("— mỗi cửa sổ cho đúng N lần đoán") NÓI QUÁ THỨ TEST NÀY ĐO,
    // và nói quá theo đúng cùng một hướng với câu đã bị bác bỏ trong CAU_GHI_THAT_BAI: "đúng N
    // lần mỗi cửa sổ" SAI dưới đồng thời (xem test "[INV-E3] LOẠT ĐẦU dưới đồng thời 24" bên
    // dưới: 24 mã được phán xét với ngưỡng 5). Thứ test NÀY thật sự đo là hẹp hơn hẳn và đủ để
    // đứng một mình: nhánh ĐẶT LẠI có tồn tại. Không có nhánh đó, sau lần khoá đầu tiên MỖI lần
    // sai tiếp theo đều vượt ngưỡng và khoá lại ngay, tức người dùng THẬT chỉ còn đúng một lần
    // thử mỗi cửa sổ, vĩnh viễn.
    await datLai(nguoiA);
    await datTrangThaiHoSo(nguoiA, "failed_attempts", String(MFA_MAX_FAILED_ATTEMPTS));
    await datTrangThaiHoSo(nguoiA, "locked_until", "clock_timestamp() - interval '1 second'");

    const buoc = counterForTime(NGAY);
    const maSai = deriveTotpCode(biMatA, buoc) === "000000" ? "111111" : "000000";

    const r = await thu(orgA, nguoiA, maSai, NGAY);
    expect(r).toMatchObject({ ok: false, reason: "WRONG_CODE", justLocked: false });
    const { rows } = await db.pool.query<{ f: number; l: Date | null }>(
      "SELECT failed_attempts AS f, locked_until AS l FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows[0]!.f, "bộ đếm phải ĐẶT LẠI về 1 sau khi khoá hết hạn").toBe(1);
    expect(rows[0]!.l, "khoá cũ đã hết hạn phải được xoá, không để lại mốc quá khứ").toBeNull();
  });

  it("[INV-E3] mã sai HÌNH DẠNG không tính là một lần thất bại", async () => {
    await datLai(nguoiA);
    for (const xau of ["", "abcdef", "12345", "١٢٣٤٥٦"]) {
      expect(await thu(orgA, nguoiA, xau, NGAY)).toMatchObject({
        ok: false,
        reason: "MALFORMED_CODE",
        justLocked: false,
      });
    }
    const { rows } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows[0]!.f).toBe(0);
    // Đối chứng: một mã ĐÚNG HÌNH DẠNG nhưng sai thì CÓ tính — nếu không, khẳng định trên xanh
    // vì hàm không đếm gì cả.
    await thu(orgA, nguoiA, "000000", NGAY);
    const { rows: sau } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(sau[0]!.f).toBe(1);
  });

  it("[INV-E3] người dùng bị ĐÌNH CHỈ không xác thực được, kể cả với mã đúng", async () => {
    const biMat = generateTotpSecret();
    await withTenant(apiPool, orgA, (c) =>
      enrollTotpCredential(c, {
        orgId: orgA,
        userId: nguoiDinhChi,
        wrapped: bocBiMat(orgA, biMat),
      }),
    );
    const ma = deriveTotpCode(biMat, counterForTime(NGAY));
    expect(await thu(orgA, nguoiDinhChi, ma, NGAY)).toMatchObject({
      ok: false,
      reason: "NO_CREDENTIAL",
    });

    // Đối chứng dương: khôi phục ACTIVE thì CÙNG mã đó QUA — tức phép chặn trên là do `status`,
    // không do một lý do khác (hồ sơ thiếu, cổng hỏng, tổ chức sai).
    await db.pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [nguoiDinhChi]);
    try {
      expect((await thu(orgA, nguoiDinhChi, ma, NGAY)).ok).toBe(true);
    } finally {
      await db.pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [nguoiDinhChi]);
      await db.pool.query("DELETE FROM mfa_credentials WHERE user_id = $1", [nguoiDinhChi]);
    }
  });

  it("[INV-F1] bí mật của tổ chức A không dùng được trong ngữ cảnh tổ chức B", async () => {
    await datLai(nguoiA);
    const ma = deriveTotpCode(biMatA, counterForTime(NGAY));
    // Trong tổ chức B, RLS không thấy hồ sơ của A.
    expect(await thu(orgB, nguoiA, ma, NGAY)).toMatchObject({
      ok: false,
      reason: "NO_CREDENTIAL",
    });
    // Và assertTenantBound chặn lời gọi "hỏi tổ chức A trên phiên gắn tổ chức B".
    await expect(
      withTenant(apiPool, orgB, (c) =>
        verifyTotpAttempt(c, { orgId: orgA, userId: nguoiA, code: ma, now: NGAY }, congMoBiMat),
      ),
    ).rejects.toThrow(/phiên đang gắn tổ chức/);
  });

  it("[INV-E3] `window` và `maxFailedAttempts` bị GHIM CẢ HAI CẬN ở mặt tiền — và bị chặn TRƯỚC cổng", async () => {
    // ==========================================================================================
    // [vòng fix 1 — MỤC 5] Hai tham số chính sách này do NGƯỜI GỌI truyền và trước vòng này chỉ
    // có cận DƯỚI. Hệ quả đo được: `maxFailedAttempts: 1e9` vô hiệu hoá vế E3(1) trong im lặng;
    // `window: 60` làm một mã 30 PHÚT TUỔI được chấp nhận (vế E3(3) do người gọi định đoạt);
    // `window: 200000` tốn 8745 ms CPU trong MỘT lời gọi đồng bộ.
    // VỊ TRÍ của phép chặn cũng chịu lực, nên nó được ĐO chứ không suy: `window` xấu phải bị từ
    // chối TRƯỚC khi cổng mở bí mật được gọi lần nào — nếu không, cần gạt DoS vẫn còn và một bí
    // mật rõ đã kịp tồn tại trong tiến trình.
    // ==========================================================================================
    await datLai(nguoiA);
    const ma = deriveTotpCode(biMatA, counterForTime(NGAY));

    let soLanMoCong = 0;
    const congDem: TotpSecretUnsealer = {
      kind: "TOTP_SECRET_UNSEALER",
      name: "dem",
      async openTotpSecret(orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array> {
        soLanMoCong += 1;
        return await congMoBiMat.openTotpSecret(orgId, wrapped);
      },
    };
    const goi = (them: Partial<TotpAttempt>): Promise<MfaAttemptResult> =>
      withTenant(apiPool, orgA, (c) =>
        verifyTotpAttempt(
          c,
          { orgId: orgA, userId: nguoiA, code: ma, now: NGAY, ...them },
          congDem,
        ),
      );

    // CẬN TRÊN của `maxFailedAttempts`.
    await expect(goi({ maxFailedAttempts: 1e9 })).rejects.toThrow(RangeError);
    await expect(goi({ maxFailedAttempts: MFA_MAX_ALLOWED_FAILED_ATTEMPTS + 1 })).rejects.toThrow(
      /vượt trần/,
    );
    // CẬN DƯỚI (đã có từ trước; giữ ở đây để một mũi gỡ hẳn khối kiểm bị bắt bởi MỘT test).
    await expect(goi({ maxFailedAttempts: 0 })).rejects.toThrow(RangeError);

    // CẬN TRÊN của `window`, và nó phải chặn TRƯỚC cổng.
    await expect(goi({ window: MAX_TOTP_WINDOW + 1 })).rejects.toThrow(/MAX_TOTP_WINDOW/);
    await expect(goi({ window: 200_000 })).rejects.toThrow(RangeError);
    await expect(goi({ window: -1 })).rejects.toThrow(RangeError);
    expect(
      soLanMoCong,
      "một `window` vượt trần vẫn đi tới cổng mở bí mật — cần gạt DoS CPU còn nguyên, và một " +
        "bí mật rõ đã tồn tại trong tiến trình cho một lời gọi chắc chắn bị từ chối.",
    ).toBe(0);

    // KHÔNG lời gọi nào ở trên được tính là một lần thất bại: đó là lỗi THAM SỐ của người gọi,
    // không phải một lần đoán sai. Nếu chúng bị tính, một client hỏng tự khoá tài khoản.
    const { rows } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows[0]!.f).toBe(0);

    // ĐỐI CHỨNG DƯƠNG — chống "chặn tất cả": ĐÚNG hai trần thì lời gọi đi trọn vẹn và QUA.
    const ok = await goi({
      window: MAX_TOTP_WINDOW,
      maxFailedAttempts: MFA_MAX_ALLOWED_FAILED_ATTEMPTS,
    });
    expect(ok).toMatchObject({ ok: true });
    expect(soLanMoCong).toBe(1);
    await datLai(nguoiA);
  });

  it("[CẤM LOG] lỗi của CỔNG được BỌC — bí mật rõ không đi vào `message`, chỉ đi tiếp qua `cause`", async () => {
    // ==========================================================================================
    // [vòng fix 1 — MỤC 7] mfa-credentials.ts từng HỨA điều này trong chú thích ("lỗi do cổng
    // ném được bọc lại KHÔNG nội suy giá trị nào ... nguyên nhân gốc chỉ đi tiếp qua `cause`")
    // trong khi thân hàm chỉ có `try/finally`: không `catch`, không `cause`, không bọc. ĐO:
    // tiêm adapter ném lỗi mang bí mật RÕ -> bí mật CÓ trong `message` = true. Và hai test
    // [CẤM LOG] hôm ấy chỉ quét bốn lỗi của totp.ts, KHÔNG test nào chạm đường lỗi của
    // `verifyTotpAttempt` — chỗ DUY NHẤT của toàn S0 cầm bí mật TOTP ở dạng rõ.
    // Test này bơm ĐÚNG adapter của phép đo đó.
    // ==========================================================================================
    await datLai(nguoiA);
    const biMatHex = biMatA.toString("hex");
    const biMatB64 = biMatA.toString("base64");
    const congRo: TotpSecretUnsealer = {
      kind: "TOTP_SECRET_UNSEALER",
      name: "adapter-viet-au",
      // eslint-disable-next-line @typescript-eslint/require-await
      async openTotpSecret(): Promise<Uint8Array> {
        // Đúng thứ một adapter viết ẩu làm: ném lỗi có nội suy giá trị đang xử lý.
        throw new Error(`giai ma that bai cho secret=${biMatHex} (b64 ${biMatB64})`);
      },
    };

    const loi = await withTenant(apiPool, orgA, (c) =>
      verifyTotpAttempt(
        c,
        { orgId: orgA, userId: nguoiA, code: deriveTotpCode(biMatA, counterForTime(NGAY)), now: NGAY },
        congRo,
      ),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(loi, "lời gọi phải NÉM — fail-closed, không nuốt lỗi của cổng").toBeInstanceOf(Error);
    const boc = loi as Error & { cause?: unknown };

    // ĐỐI CHỨNG CHỐNG RỖNG RUỘT, đặt TRƯỚC: fixture phải THẬT SỰ rò, nếu không mọi khẳng định
    // dưới đây xanh vì lỗi gốc vô hại chứ không vì lớp bọc chịu lực.
    expect(boc.cause, "nguyên nhân gốc phải đi tiếp qua `cause`").toBeInstanceOf(Error);
    expect((boc.cause as Error).message).toContain(biMatHex);

    // VẾ CHỊU LỰC: chuỗi mà lớp trên ghi log được KHÔNG mang bí mật, kể cả một mảnh.
    expect(boc.message).not.toContain(biMatHex);
    expect(boc.message).not.toContain(biMatB64);
    expect(boc.message).not.toContain(biMatHex.slice(0, 8));
    // `stack` của chính lỗi bọc cũng vậy — nó là thứ đi vào một dòng log trong thực tế.
    expect(boc.stack ?? "").not.toContain(biMatHex.slice(0, 8));
    // Và nó phải nói được cổng NÀO hỏng, nếu không lớp bọc mua sự im lặng bằng khả năng điều tra.
    expect(boc.message).toContain("adapter-viet-au");

    // Một lần lỗi CỔNG không được tính là một lần đoán sai: đó là sự cố hạ tầng, không phải một
    // lần thử của người dùng.
    const { rows } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows[0]!.f).toBe(0);
    await datLai(nguoiA);
  });

  it("[T9-J] một lần thử MFA THẤT BẠI KHÔNG ghi sổ kiểm toán — quyết định, có đo", async () => {
    // [vòng fix 1 — MỤC 3/I2] TEST NÀY TỪNG MANG THẺ `[INV-D5]`, VÀ ĐÓ LÀ BẰNG CHỨNG ĐẢO CHIỀU.
    // D5 (docs/TEST-PLAN.md) = "lần từ chối vì thiếu quyền CŨNG PHẢI audit". Test này khẳng định
    // điều NGƯỢC LẠI trên một đường đi khác, tức nó chứng minh một NGOẠI LỆ của D5 — và bộ sinh
    // của Task 11 gom theo mã, nên hàng D5 của `evidence/INV-matrix.md` sẽ mang một dòng
    // "passed" mà TÊN của nó đọc như phủ định chính bất biến ấy. NỘI DUNG quyết định thì đúng và
    // được giữ nguyên; chỉ cái NHÃN sai. Thẻ `[T9-J]` cố ý KHÔNG khớp regex `\[INV-([A-H]\d+)\]`
    // của bộ sinh: đây là một QUYẾT ĐỊNH có ADR (docs/DECISIONS.md, ADR-008), không phải một bất
    // biến được phủ.
    //
    // D5 nói về TỪ CHỐI QUYỀN, không về một phép thử chứng thực. Ghi sổ ở đây nghĩa là MỖI lần
    // đoán sai của MỖI người lạ đều lấy khoá tư vấn ghi sổ THEO TỔ CHỨC (Task 8 ĐO-5a/5b: một
    // phiên khác cùng tổ chức kẹt tới lock_timeout) — trên một đường đi kẻ tấn công KHÔNG CẦN
    // đăng nhập được để chạm tới. Khẳng định này khoá quyết định đó lại: ai đổi ý phải sửa test
    // và trả lời câu hỏi về chi phí.
    await datLai(nguoiA);
    const truoc = await demSuKien(orgA);
    for (let i = 0; i < 3; i += 1) {
      await thu(orgA, nguoiA, "000000", NGAY);
    }
    expect(await demSuKien(orgA)).toBe(truoc);

    // Cái ĐƯỢC ghi lại bền vững vẫn còn — nên "không ghi sổ" không đồng nghĩa "không để lại dấu".
    const { rows } = await db.pool.query<{ f: number }>(
      "SELECT failed_attempts AS f FROM mfa_credentials WHERE user_id = $1",
      [nguoiA],
    );
    expect(rows[0]!.f).toBe(3);
  });

  it("cổng mở bí mật trả về 0 byte bị TỪ CHỐI — không xác thực bằng khoá HMAC rỗng", async () => {
    // HMAC với khoá rỗng vẫn tính ra một mã hợp lệ, nên một cổng cài đặt sai (trả mảng rỗng
    // thay vì ném) sẽ tạo một hệ thống MFA mà MỌI người có cùng một mã. Fail-closed, ồn ào.
    await datLai(nguoiA);
    const congHong: TotpSecretUnsealer = {
      kind: "TOTP_SECRET_UNSEALER",
      name: "rong",
      // eslint-disable-next-line @typescript-eslint/require-await
      async openTotpSecret(): Promise<Uint8Array> {
        return new Uint8Array(0);
      },
    };
    const maRong = deriveTotpCode(Buffer.alloc(0), counterForTime(NGAY));
    await expect(
      withTenant(apiPool, orgA, (c) =>
        verifyTotpAttempt(
          c,
          { orgId: orgA, userId: nguoiA, code: maRong, now: NGAY },
          congHong,
        ),
      ),
    ).rejects.toThrow(/0 byte/);
  });

  it("hằng chính sách mặc định đúng bằng thứ được ghi ra", () => {
    expect(MFA_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(MFA_LOCKOUT_SECONDS).toBe(900);
  });
});

// ============================================================================================
// 3. LƯỢC ĐỒ 006 — RÀNG BUỘC VÀ QUYỀN, ĐO DƯỚI ĐÚNG HỒ SƠ VAI TRÒ
// ============================================================================================
describe("lược đồ 006", () => {
  it("[INV-F1] khoá ngoại TỔ HỢP chặn hàng lệch tổ chức trên CẢ HAI bảng", async () => {
    // Dư lượng đã ghi ở 005 §(5) cho `user_roles`: `WITH CHECK` cho qua (org_id đúng là tổ chức
    // đang gắn) và khoá ngoại `users(id)` chạy dưới quyền hệ thống nên cũng cho qua. Ở hai bảng
    // của 006, khoá ngoại TỔ HỢP đóng đường đó ngay ở tầng ràng buộc.
    expect(
      await chayRieng(
        apiPool,
        orgA,
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) " +
          "VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')",
        [orgA, nguoiB, randomBytes(32)],
      ),
    ).toMatch(/foreign key constraint/i);
    expect(
      await chayRieng(
        apiPool,
        orgA,
        "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version) " +
          "VALUES ($1, $2, 'TOTP', $3, 'v1')",
        [orgA, nguoiB, Buffer.from("x")],
      ),
    ).toMatch(/foreign key constraint/i);
    // Đối chứng dương: người ĐÚNG tổ chức thì chèn được.
    expect(
      await chayRieng(
        apiPool,
        orgA,
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) " +
          "VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')",
        [orgA, nguoiA, randomBytes(32)],
      ),
    ).toBe("THÀNH CÔNG");
  });

  it("[CR3] ràng buộc duy nhất đi THEO TỔ CHỨC — không dùng làm oracle xuyên tổ chức được", async () => {
    // `mfa_credentials`: brief viết UNIQUE (user_id, kind) — toàn cục. Với khoá theo tổ chức,
    // câu hỏi "người này đã đăng ký MFA ở tổ chức khác chưa" không trả lời được nữa. Phép đo
    // phải SẮC như [CR3] của Task 4: hai truy vấn phải cho CÙNG một kết cục.
    const nguoiC = await taoNguoi(orgB, "trung-ten@example.com");
    await withTenant(apiPool, orgB, (c) =>
      enrollTotpCredential(c, {
        orgId: orgB,
        userId: nguoiC,
        wrapped: bocBiMat(orgB, generateTotpSecret()),
      }),
    );
    // Cùng `user_id` nhưng ở tổ chức A: khoá ngoại tổ hợp chặn TRƯỚC ràng buộc duy nhất, và cả
    // hai đường đều KHÔNG phân biệt được "đã đăng ký ở nơi khác" với "chưa đăng ký".
    const thuChen = async (userId: string): Promise<string> =>
      withTenant(apiPool, orgA, (c) =>
        enrollTotpCredential(c, {
          orgId: orgA,
          userId,
          wrapped: bocBiMat(orgA, generateTotpSecret()),
        }),
      ).then(
        () => "THÀNH CÔNG",
        (e: Error) => e.message.replace(/"[^"]*"/g, '"…"'),
      );
    const daDangKyNoiKhac = await thuChen(nguoiC);
    const khongTonTai = await thuChen("00000000-0000-4000-8000-0000000000ff");
    expect(daDangKyNoiKhac).not.toBe("THÀNH CÔNG");
    expect(
      khongTonTai,
      `Hai truy vấn cho thông báo KHÁC NHAU — đó là oracle nhị phân: ` +
        `[${daDangKyNoiKhac}] vs [${khongTonTai}]`,
    ).toBe(daDangKyNoiKhac);

    // `sessions.token_hash`: duy nhất theo (org_id, token_hash), nên CÙNG một băm dùng được ở
    // hai tổ chức khác nhau — tức không còn oracle nào để hỏi.
    const bam = randomBytes(32);
    for (const [org, nguoi] of [
      [orgA, nguoiA],
      [orgB, nguoiB],
    ] as const) {
      await withTenant(apiPool, org, async (c) => {
        await expect(
          c.query(
            "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) " +
              "VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')",
            [org, nguoi, bam],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      });
    }
  });

  it("app_api KHÔNG ghi được các cột chịu lực của hai bảng mới", async () => {
    const ca: ReadonlyArray<readonly [string, string, readonly unknown[]]> = [
      // `id` không được INSERT -> sessions_pkey/mfa_credentials_pkey không làm oracle được.
      [
        "sessions.id",
        "INSERT INTO sessions (id, org_id, user_id, token_hash, expires_at) " +
          "VALUES (gen_random_uuid(), $1, $2, $3, clock_timestamp() + interval '1 hour')",
        [orgA, nguoiA, randomBytes(32)],
      ],
      // `mfa_verified_at` không được INSERT -> phiên không ra đời ở trạng thái "đã xác thực".
      [
        "sessions.mfa_verified_at (INSERT)",
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
          "VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour', clock_timestamp())",
        [orgA, nguoiA, randomBytes(32)],
      ],
      // `last_used_counter` không được INSERT -> không chiếm trước bộ đếm dùng-một-lần.
      [
        "mfa_credentials.last_used_counter (INSERT)",
        "INSERT INTO mfa_credentials (org_id, user_id, secret_wrapped, secret_key_version, last_used_counter) " +
          "VALUES ($1, $2, $3, 'v1', 999999999)",
        [orgA, nguoiA, Buffer.from("x")],
      ],
      // Bí mật đã lưu KHÔNG sửa được, và hồ sơ KHÔNG xoá được.
      [
        "mfa_credentials.secret_wrapped (UPDATE)",
        "UPDATE mfa_credentials SET secret_wrapped = $2 WHERE user_id = $1",
        [nguoiA, Buffer.from("x")],
      ],
      ["mfa_credentials (DELETE)", "DELETE FROM mfa_credentials WHERE user_id = $1", [nguoiA]],
      // `expires_at` không được UPDATE -> không gia hạn phiên vô hạn.
      [
        "sessions.expires_at (UPDATE)",
        "UPDATE sessions SET expires_at = clock_timestamp() + interval '10 years'",
        [],
      ],
    ];
    for (const [moTa, cau, tham] of ca) {
      expect(await chayRieng(apiPool, orgA, cau, tham), moTa).toMatch(/permission denied/i);
    }
    // Đối chứng dương: đường đi HỢP LỆ của ứng dụng không bị bản vá làm hỏng.
    expect(
      await chayRieng(
        apiPool,
        orgA,
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) " +
          "VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')",
        [orgA, nguoiA, randomBytes(32)],
      ),
    ).toBe("THÀNH CÔNG");
    expect(
      await chayRieng(
        apiPool,
        orgA,
        "UPDATE sessions SET mfa_verified_at = clock_timestamp() WHERE user_id = $1",
        [nguoiA],
      ),
    ).toBe("THÀNH CÔNG");
  });

  it("[M5] app_unseal đọc được ĐÚNG sáu cột của sessions, KHÔNG đọc được token_hash", async () => {
    // Đo bằng HÀNH VI dưới đúng role, không chỉ bằng catalog: `information_schema.role_table_
    // grants` MÙ với quyền cột (cảnh báo đã ghi ở 002), nên một GRANT mức BẢNG lỡ tay sẽ không
    // hiện ra ở bất kỳ khẳng định "danh sách quyền" nào.
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    expect(
      await chayRieng(
        unsealPool,
        orgA,
        "SELECT id, org_id, user_id, mfa_verified_at, expires_at, revoked_at FROM sessions WHERE id = $1",
        [sessionId],
      ),
    ).toBe("THÀNH CÔNG");
    for (const cot of ["token_hash", "ip", "user_agent", "created_at"]) {
      expect(
        await chayRieng(unsealPool, orgA, `SELECT ${cot} FROM sessions WHERE id = $1`, [sessionId]),
        cot,
      ).toMatch(/permission denied/i);
    }
    // Và KHÔNG ghi được gì.
    expect(
      await chayRieng(
        unsealPool,
        orgA,
        "UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1",
        [sessionId],
      ),
    ).toMatch(/permission denied/i);
  });

  it("[M5] app_unseal KHÔNG chạm được mfa_credentials, nhưng CHẠY ĐƯỢC assertFreshMfa", async () => {
    const sessionId = await taoPhien(orgA, nguoiA, "clock_timestamp()");
    for (const cau of ["SELECT 1 FROM mfa_credentials", "SELECT secret_wrapped FROM mfa_credentials"]) {
      expect(await chayRieng(unsealPool, orgA, cau), cau).toMatch(/permission denied/i);
    }
    // Đây là toàn bộ điểm của việc cấp quyền cột: runtime mở thầu phán xét được D1 mà KHÔNG đọc
    // được bí mật MFA và không đọc được băm token phiên.
    await withTenant(unsealPool, orgA, async (c) => {
      await expect(
        assertFreshMfa(c, { sessionId, userId: nguoiA, orgId: orgA, maxAgeSeconds: 300 }),
      ).resolves.toBeUndefined();
    });
    // Và nó phán xét ĐÚNG chứ không phải luôn-qua: một phiên cũ vẫn bị từ chối dưới cùng role.
    const cu = await taoPhien(orgA, nguoiA, "clock_timestamp() - interval '1 hour'");
    await withTenant(unsealPool, orgA, async (c) => {
      await expect(
        assertFreshMfa(c, { sessionId: cu, userId: nguoiA, orgId: orgA, maxAgeSeconds: 300 }),
      ).rejects.toBeInstanceOf(MfaRequiredError);
    });
  });

  it("app_unseal KHÔNG đọc được email/họ tên — quyết định của 002 vẫn nguyên", async () => {
    // Cố ý KHÔNG neo vào một SỐ HÀNG cụ thể: các test khác trong file thêm người dùng, và một
    // khẳng định `rowCount === 2` sẽ đỏ vì lý do KHÔNG liên quan tới thứ nó canh.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM users WHERE org_id = $1",
      [orgA],
    );
    expect(Number(rows[0]!.n), "chống rỗng ruột: tổ chức A phải có người").toBeGreaterThan(0);
    const docDuoc = await withTenant(unsealPool, orgA, (c) =>
      c.query<{ id: string }>("SELECT id, org_id, status FROM users"),
    );
    expect(docDuoc.rowCount).toBe(Number(rows[0]!.n));
    for (const cot of ["email", "full_name", "created_at"]) {
      expect(await chayRieng(unsealPool, orgA, `SELECT ${cot} FROM users`), cot).toMatch(
        /permission denied/i,
      );
    }
  });

  it("[INV-F1] chưa gắn tổ chức thì hai bảng mới trả 0 hàng", async () => {
    const client = await apiPool.connect();
    try {
      for (const bang of ["sessions", "mfa_credentials"]) {
        const that = await db.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${bang}`);
        expect(Number(that.rows[0]!.n), `chống rỗng ruột: ${bang} phải có hàng`).toBeGreaterThan(0);
        const duoiApi = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${bang}`,
        );
        expect(Number(duoiApi.rows[0]!.n)).toBe(0);
      }
    } finally {
      client.release();
    }
  });

  it("CHECK của lược đồ chặn hình dạng sai — token 32 byte, hạn sau lúc tạo, user_agent có trần", async () => {
    for (const [mo_ta, cau, tham] of [
      [
        "token_hash không đủ 32 byte",
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')",
        [orgA, nguoiA, randomBytes(16)],
      ],
      [
        "expires_at không sau created_at",
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, clock_timestamp() - interval '1 hour')",
        [orgA, nguoiA, randomBytes(32)],
      ],
      [
        "user_agent vượt trần 512 byte",
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour', $4)",
        [orgA, nguoiA, randomBytes(32), "x".repeat(513)],
      ],
    ] as const) {
      expect(await chayRieng(apiPool, orgA, cau, tham), mo_ta).toMatch(
        /violates check constraint/i,
      );
    }
    // Đối chứng dương: hình dạng ĐÚNG vẫn chèn được — ba CHECK trên không phải "chặn tất cả".
    expect(
      await chayRieng(
        apiPool,
        orgA,
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, user_agent) " +
          "VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour', $4)",
        [orgA, nguoiA, randomBytes(32), "x".repeat(512)],
      ),
    ).toBe("THÀNH CÔNG");
  });
});

// ============================================================================================
// 4. QUYỀN — ĐO BẰNG CÔNG CỤ KHÔNG MÙ
//
// `information_schema.role_table_grants` MÙ với quyền mức CỘT (cảnh báo đã ghi ở 002), và cả
// hai view `role_*_grants` đều lọc theo grantee nên chúng MÙ với `GRANT ... TO PUBLIC`. Khối
// này đọc THẲNG `pg_class.relacl` + `pg_attribute.attacl` qua `aclexplode`, cộng hai phép kiểm
// RIÊNG cho PUBLIC và cho các role ĐỊNH SẴN của PostgreSQL.
// ============================================================================================
describe("quyền trên hai bảng mới, đo không mù", () => {
  const BANG_MOI = ["mfa_credentials", "sessions"];

  it("ACL mức BẢNG đúng bằng quyết định — đọc pg_class.relacl qua aclexplode", async () => {
    const { rows } = await db.pool.query<{ bang: string; ai: string; quyen: string }>(
      `SELECT c.relname AS bang,
              CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS ai,
              x.privilege_type AS quyen
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) x
        WHERE n.nspname = 'public' AND c.relname = ANY($1)
          AND (x.grantee = 0 OR pg_get_userbyid(x.grantee) IN ('app_api', 'app_unseal'))
        ORDER BY 1, 2, 3`,
      [BANG_MOI],
    );
    expect(rows).toEqual([
      { bang: "mfa_credentials", ai: "app_api", quyen: "SELECT" },
      { bang: "sessions", ai: "app_api", quyen: "SELECT" },
    ]);
  });

  it("[M5] ACL mức CỘT đúng bằng quyết định — đọc pg_attribute.attacl qua aclexplode", async () => {
    const { rows } = await db.pool.query<{
      bang: string;
      cot: string;
      ai: string;
      quyen: string;
    }>(
      `SELECT c.relname AS bang, a.attname AS cot,
              CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS ai,
              x.privilege_type AS quyen
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         CROSS JOIN LATERAL aclexplode(a.attacl) x
        WHERE n.nspname = 'public' AND c.relname = ANY($1)
          AND (x.grantee = 0 OR pg_get_userbyid(x.grantee) IN ('app_api', 'app_unseal'))
        ORDER BY 1, 2, 3, 4`,
      [[...BANG_MOI, "users"]],
    );
    expect(rows).toEqual([
      { bang: "mfa_credentials", cot: "confirmed_at", ai: "app_api", quyen: "UPDATE" },
      { bang: "mfa_credentials", cot: "failed_attempts", ai: "app_api", quyen: "UPDATE" },
      { bang: "mfa_credentials", cot: "kind", ai: "app_api", quyen: "INSERT" },
      { bang: "mfa_credentials", cot: "last_used_counter", ai: "app_api", quyen: "UPDATE" },
      { bang: "mfa_credentials", cot: "locked_until", ai: "app_api", quyen: "UPDATE" },
      { bang: "mfa_credentials", cot: "org_id", ai: "app_api", quyen: "INSERT" },
      { bang: "mfa_credentials", cot: "secret_key_version", ai: "app_api", quyen: "INSERT" },
      { bang: "mfa_credentials", cot: "secret_wrapped", ai: "app_api", quyen: "INSERT" },
      { bang: "mfa_credentials", cot: "user_id", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "expires_at", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "expires_at", ai: "app_unseal", quyen: "SELECT" },
      { bang: "sessions", cot: "id", ai: "app_unseal", quyen: "SELECT" },
      { bang: "sessions", cot: "ip", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "mfa_verified_at", ai: "app_api", quyen: "UPDATE" },
      { bang: "sessions", cot: "mfa_verified_at", ai: "app_unseal", quyen: "SELECT" },
      { bang: "sessions", cot: "org_id", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "org_id", ai: "app_unseal", quyen: "SELECT" },
      { bang: "sessions", cot: "revoked_at", ai: "app_api", quyen: "UPDATE" },
      { bang: "sessions", cot: "revoked_at", ai: "app_unseal", quyen: "SELECT" },
      { bang: "sessions", cot: "token_hash", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "user_agent", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "user_id", ai: "app_api", quyen: "INSERT" },
      { bang: "sessions", cot: "user_id", ai: "app_unseal", quyen: "SELECT" },
      { bang: "users", cot: "email", ai: "app_api", quyen: "INSERT" },
      { bang: "users", cot: "email", ai: "app_api", quyen: "UPDATE" },
      { bang: "users", cot: "full_name", ai: "app_api", quyen: "INSERT" },
      { bang: "users", cot: "full_name", ai: "app_api", quyen: "UPDATE" },
      { bang: "users", cot: "id", ai: "app_unseal", quyen: "SELECT" },
      { bang: "users", cot: "org_id", ai: "app_api", quyen: "INSERT" },
      { bang: "users", cot: "org_id", ai: "app_unseal", quyen: "SELECT" },
      { bang: "users", cot: "status", ai: "app_api", quyen: "INSERT" },
      { bang: "users", cot: "status", ai: "app_api", quyen: "UPDATE" },
      { bang: "users", cot: "status", ai: "app_unseal", quyen: "SELECT" },
    ]);
  });

  it("[M5] PUBLIC không có quyền nào trên hai bảng mới — phép kiểm RIÊNG, cả bảng lẫn cột", async () => {
    // Hai view `role_*_grants` lọc theo grantee nên một `GRANT ... TO PUBLIC` không hiện ra ở
    // BẤT KỲ khẳng định danh sách nào. Vế này là lớp duy nhất canh nó.
    const { rows } = await db.pool.query<{ o: string }>(
      `SELECT c.relname || coalesce('.' || a.attname, '') || ':' || x.privilege_type AS o
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         CROSS JOIN LATERAL aclexplode(coalesce(a.attacl, c.relacl)) x
        WHERE n.nspname = 'public' AND c.relname = ANY($1) AND x.grantee = 0`,
      [BANG_MOI],
    );
    expect(rows.map((r) => r.o)).toEqual([]);
  });

  it("[M5] không role ĐỊNH SẴN nào của PostgreSQL với tới hai bảng mới", async () => {
    // `pg_read_all_data`/`pg_write_all_data` (PG14+) BỎ QUA mọi GRANT theo bảng. Một
    // `GRANT pg_read_all_data TO app_api` ở đâu đó làm mọi khẳng định ACL ở trên vẫn xanh trong
    // khi app_api đọc được TOÀN BỘ cụm. Đo bằng hai đường: membership, và ACL trực tiếp.
    const { rows: thanhVien } = await db.pool.query<{ o: string }>(
      `SELECT m.member::regrole::text || ' IN ' || m.roleid::regrole::text AS o
         FROM pg_auth_members m
        WHERE m.roleid::regrole::text IN ('pg_read_all_data', 'pg_write_all_data',
                                          'pg_monitor', 'pg_signal_backend')`,
    );
    expect(thanhVien.map((r) => r.o)).toEqual([]);

    const { rows: acl } = await db.pool.query<{ o: string }>(
      `SELECT c.relname || ':' || pg_get_userbyid(x.grantee) AS o
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) x
        WHERE n.nspname = 'public' AND c.relname = ANY($1)
          AND x.grantee <> 0
          AND pg_get_userbyid(x.grantee) LIKE 'pg\_%'`,
      [BANG_MOI],
    );
    expect(acl.map((r) => r.o)).toEqual([]);

    // Chống rỗng ruột: hai role định sẵn PHẢI tồn tại, nếu không hai khẳng định trên xanh vì
    // phép đo hỏi về một thứ không có mặt.
    const { rows: co } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_roles WHERE rolname IN ('pg_read_all_data','pg_write_all_data')",
    );
    expect(Number(co[0]!.n), "hai role định sẵn không tồn tại — phép đo trên rỗng ruột").toBe(2);
  });
});

// ============================================================================================
// 5. [QT3] MFA DƯỚI search_path THÙ ĐỊCH — MỐC CHẾT CHO TỪNG VẾ GHIM
//
// `withTenant` GHIM tên hàm cho ba câu lệnh của CHÍNH NÓ, nhưng truy vấn do `fn` viết chạy dưới
// `search_path` của người gọi. Không có khối này, MỌI mũi đột biến gỡ `public.`, `pg_catalog.`
// hay `OPERATOR(pg_catalog.=)` khỏi mfa.ts / mfa-credentials.ts đều SỐNG SÓT — và một bản ghim
// không có mốc chết là một QUY ƯỚC, không phải một bất biến (đúng khoản nợ số 1 trong
// task-8-report.md §V3.5).
//
// NĂM TRỤC, MỖI TRỤC MỘT ĐƯỜNG LEO THANG KHÁC NHAU — cố ý không đo một trục rồi tổng quát hoá
// (bài học (f), thứ đã cắn cả controller lẫn implementer trong dự án này):
//   doc.sessions         -> phiên ĐÃ THU HỒI trông như vừa xác thực
//   doc.users            -> người ĐANG BỊ ĐÌNH CHỈ trông như ACTIVE
//   doc.make_interval    -> cửa sổ 300 giây thành 100 năm, tức mọi phiên cũ đều "tươi"
//   doc.= (uuid, uuid)   -> mọi so sánh uuid trả true, tức một sessionId KHÔNG TỒN TẠI khớp
//                           hàng của người khác
//   doc.mfa_credentials  -> hồ sơ ĐANG BỊ KHOÁ trông như không khoá
// Container RIÊNG vì fixture đổi `search_path` ở mức ROLE và dựng schema thù địch.
// ============================================================================================
describe("[QT3] MFA dưới search_path thù địch", () => {
  it("[INV-D1][INV-E3] mọi vế ghim đều có mốc chết — bảng, hàm và toán tử", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      const { rows: o } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
      );
      const org = o[0]!.id;
      const { rows: u } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name, status) VALUES " +
          "($1, 'ok@a.com', 'Nguoi OK', 'ACTIVE'), " +
          "($1, 'dinhchi@a.com', 'Dinh chi', 'SUSPENDED') RETURNING id",
        [org],
      );
      const nguoiOk = u[0]!.id;
      const nguoiSuspended = u[1]!.id;

      const themPhien = async (
        userId: string,
        mfaLuc: string,
        thuHoi: string,
      ): Promise<string> => {
        const { rows } = await dbRieng.pool.query<{ id: string }>(
          "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at, revoked_at) " +
            "VALUES ($1, $2, $3, clock_timestamp() + interval '8 hours', " +
            `${mfaLuc}, ${thuHoi}) RETURNING id`,
          [org, userId, randomBytes(32)],
        );
        return rows[0]!.id;
      };
      const phienDaThuHoi = await themPhien(nguoiOk, "clock_timestamp()", "clock_timestamp()");
      const phienQuaCu = await themPhien(nguoiOk, "clock_timestamp() - interval '2 hours'", "NULL");
      const phienCuaNguoiDinhChi = await themPhien(nguoiSuspended, "clock_timestamp()", "NULL");
      const phienTuoi = await themPhien(nguoiOk, "clock_timestamp()", "NULL");

      // Hồ sơ MFA ĐANG BỊ KHOÁ ở public.
      const biMat = generateTotpSecret();
      const boc = bocBiMat(org, biMat);
      await dbRieng.pool.query(
        "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version, " +
          "failed_attempts, locked_until) " +
          "VALUES ($1, $2, 'TOTP', $3, $4, 5, clock_timestamp() + interval '1 hour')",
        [org, nguoiOk, Buffer.from(boc.ciphertext), boc.keyVersion],
      );

      // ---------------------------- SCHEMA THÙ ĐỊCH ----------------------------
      await dbRieng.pool.query("CREATE SCHEMA doc");
      await dbRieng.pool.query("GRANT USAGE ON SCHEMA doc TO PUBLIC");

      await dbRieng.pool.query(
        "CREATE TABLE doc.sessions (id uuid, org_id uuid, user_id uuid, " +
          "expires_at timestamptz, mfa_verified_at timestamptz, revoked_at timestamptz)",
      );
      await dbRieng.pool.query(
        "INSERT INTO doc.sessions VALUES ($1, $2, $3, " +
          "clock_timestamp() + interval '8 hours', clock_timestamp(), NULL)",
        [phienDaThuHoi, org, nguoiOk],
      );
      await dbRieng.pool.query("GRANT SELECT ON doc.sessions TO PUBLIC");

      await dbRieng.pool.query("CREATE TABLE doc.users (id uuid, org_id uuid, status text)");
      await dbRieng.pool.query(
        "INSERT INTO doc.users VALUES ($1, $2, 'ACTIVE'), ($3, $2, 'ACTIVE')",
        [nguoiOk, org, nguoiSuspended],
      );
      await dbRieng.pool.query("GRANT SELECT ON doc.users TO PUBLIC");

      await dbRieng.pool.query(
        "CREATE TABLE doc.mfa_credentials (id uuid, org_id uuid, user_id uuid, kind text, " +
          "secret_wrapped bytea, secret_key_version text, last_used_counter bigint, " +
          "locked_until timestamptz)",
      );
      await dbRieng.pool.query(
        "INSERT INTO doc.mfa_credentials VALUES (gen_random_uuid(), $1, $2, 'TOTP', $3, $4, NULL, NULL)",
        [org, nguoiOk, Buffer.from(boc.ciphertext), boc.keyVersion],
      );
      await dbRieng.pool.query("GRANT SELECT ON doc.mfa_credentials TO PUBLIC");

      // Hàm bóng: cửa sổ nào cũng thành 100 năm.
      await dbRieng.pool.query(
        "CREATE FUNCTION doc.make_interval(secs double precision) RETURNS interval " +
          "LANGUAGE sql IMMUTABLE AS 'SELECT interval ''100 years'''",
      );
      await dbRieng.pool.query(
        "GRANT EXECUTE ON FUNCTION doc.make_interval(double precision) TO PUBLIC",
      );

      // Toán tử bóng: mọi so sánh uuid trả true.
      await dbRieng.pool.query(
        "CREATE FUNCTION doc.luon_dung(uuid, uuid) RETURNS boolean " +
          "LANGUAGE sql IMMUTABLE AS 'SELECT true'",
      );
      await dbRieng.pool.query("GRANT EXECUTE ON FUNCTION doc.luon_dung(uuid, uuid) TO PUBLIC");
      await dbRieng.pool.query(
        "CREATE OPERATOR doc.= (LEFTARG = uuid, RIGHTARG = uuid, FUNCTION = doc.luon_dung)",
      );

      await dbRieng.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk' IN ROLE app_api");
      await dbRieng.pool.query(
        "ALTER ROLE app_api_login SET search_path = doc, pg_catalog, public",
      );

      const url = new URL(dbRieng.connectionString);
      url.username = "app_api_login";
      url.password = "mk";
      const poolThuDich = createPool(url.toString(), 3);
      try {
        // ============== FIXTURE TỰ CHỨNG MINH NÓ TẤN CÔNG ĐƯỢC ==============
        // Không có khối này, mọi kết luận dưới đây có thể xanh vì schema `doc` vô hại. Bài học
        // này đã tái xuất BỐN lần trong dự án, gần nhất là ở Task 8 vòng 3 khi một fixture dùng
        // chung `$1` suýt cho kết luận sai NGƯỢC CHIỀU.
        expect(
          (await poolThuDich.query<{ search_path: string }>("SHOW search_path")).rows[0]!
            .search_path,
        ).toBe("doc, pg_catalog, public");
        const { rows: doDuoc } = await poolThuDich.query<{
          s_tran: number;
          s_du: number;
          u_tran: number;
          u_du: number;
          mc_tran: number;
          mc_du: number;
          mi_tran: string;
          mi_du: string;
          eq_tran: boolean;
          eq_ghim: boolean;
        }>(
          // MỖI vế probe phải cô lập ĐÚNG MỘT trục. Bốn vế "bảng" dưới đây GHIM toán tử uuid,
          // vì nếu để `=` trần thì toán tử bóng (trục thứ tư) làm chúng khớp MỌI hàng và phép đo
          // trả lời sai về trục BẢNG. Đã tự vấp phải khi viết bản đầu ("doc.users không cướp
          // được: expected 2 to be 1") — cùng lớp với ca `$1` dùng chung ở Task 8 vòng 3.
          `SELECT (SELECT count(*)::int FROM sessions
                    WHERE id OPERATOR(pg_catalog.=) $1 AND revoked_at IS NULL) AS s_tran,
                  (SELECT count(*)::int FROM public.sessions
                    WHERE id OPERATOR(pg_catalog.=) $1 AND revoked_at IS NULL) AS s_du,
                  (SELECT count(*)::int FROM users
                    WHERE id OPERATOR(pg_catalog.=) $2 AND status = 'ACTIVE') AS u_tran,
                  (SELECT count(*)::int FROM public.users
                    WHERE id OPERATOR(pg_catalog.=) $2 AND status = 'ACTIVE') AS u_du,
                  (SELECT count(*)::int FROM mfa_credentials WHERE locked_until IS NULL) AS mc_tran,
                  (SELECT count(*)::int FROM public.mfa_credentials WHERE locked_until IS NULL) AS mc_du,
                  make_interval(secs => 1)::text AS mi_tran,
                  pg_catalog.make_interval(secs => 1)::text AS mi_du,
                  ($3::uuid = $4::uuid) AS eq_tran,
                  ($3::uuid OPERATOR(pg_catalog.=) $4::uuid) AS eq_ghim`,
          [phienDaThuHoi, nguoiSuspended, phienTuoi, phienQuaCu],
        );
        const d = doDuoc[0]!;
        expect(d.s_tran, "doc.sessions không cướp được — trục BẢNG rỗng ruột").toBe(1);
        expect(d.s_du, "public.sessions lại bị cướp — phép đo rỗng ruột").toBe(0);
        expect(d.u_tran, "doc.users không cướp được").toBe(1);
        expect(d.u_du, "public.users lại bị cướp").toBe(0);
        expect(d.mc_tran, "doc.mfa_credentials không cướp được").toBe(1);
        expect(d.mc_du, "public.mfa_credentials lại bị cướp").toBe(0);
        expect(d.mi_tran, "make_interval TRẦN không bị cướp — trục HÀM rỗng ruột").toContain("year");
        expect(d.mi_du, "pg_catalog.make_interval lại bị cướp").toBe("00:00:01");
        expect(d.eq_tran, "toán tử `=` của uuid không bị cướp — trục TOÁN TỬ rỗng ruột").toBe(true);
        expect(d.eq_ghim, "OPERATOR(pg_catalog.=) lại bị cướp").toBe(false);

        // ==================== PHÁN XÉT PHẢI VẪN ĐÚNG ====================
        const kiem = (sessionId: string, userId: string): Promise<void> =>
          withTenant(poolThuDich, org, (c) =>
            assertFreshMfa(c, { sessionId, userId, orgId: org, maxAgeSeconds: 300 }),
          );

        // Trục `public.sessions`: phiên ĐÃ THU HỒI, mà doc.sessions khai là chưa.
        await expect(kiem(phienDaThuHoi, nguoiOk)).rejects.toBeInstanceOf(MfaRequiredError);
        // Trục `public.users`: người ĐÌNH CHỈ, mà doc.users khai là ACTIVE.
        await expect(kiem(phienCuaNguoiDinhChi, nguoiSuspended)).rejects.toBeInstanceOf(
          MfaRequiredError,
        );
        // Trục `pg_catalog.make_interval`: phiên xác thực từ 2 giờ trước, cửa sổ 300 giây.
        await expect(kiem(phienQuaCu, nguoiOk)).rejects.toBeInstanceOf(MfaRequiredError);
        // Trục `OPERATOR(pg_catalog.=)`: một sessionId KHÔNG TỒN TẠI. Với `=` trần nó khớp MỌI
        // hàng, trong đó có `phienTuoi`, nên phép kiểm trả "tươi" cho một phiên không có thật.
        await expect(kiem("00000000-0000-4000-8000-0000000000ff", nguoiOk)).rejects.toBeInstanceOf(
          MfaRequiredError,
        );

        // ĐỐI CHỨNG DƯƠNG: một phiên THẬT SỰ tươi vẫn qua được dưới cùng search_path đó — nên
        // bốn khẳng định trên không phải "truy vấn hỏng hoàn toàn dưới path này".
        await expect(kiem(phienTuoi, nguoiOk)).resolves.toBeUndefined();

        // Trục `public.mfa_credentials`: hồ sơ ĐANG BỊ KHOÁ ở public, doc khai là không khoá.
        const maDung = deriveTotpCode(biMat, counterForTime(Date.now()));
        expect(
          await withTenant(poolThuDich, org, (c) =>
            verifyTotpAttempt(c, { orgId: org, userId: nguoiOk, code: maDung }, congMoBiMat),
          ),
        ).toMatchObject({ ok: false, reason: "LOCKED_OUT" });
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await dbRieng.stop();
    }
  }, 240_000);

  // ==========================================================================================
  // [vòng fix 1 — VIỆC ĐƯỢC NÂNG MỨC] TRỤC TÊN KIỂU, MỐC CHẾT MÀ TASK 9 KHAI LÀ "KHÓ DỰNG"
  //
  // Task 9 ghi lý do bỏ trống trục này: "dựng fixture ấy cho `assertFreshMfa` khó hơn vì có BA
  // tham số uuid khác nhau, còn ENUM bóng chỉ mang được MỘT giá trị." LÝ DO ĐÓ SAI — hàm cast
  // ÁNH XẠ THEO NHÃN được, nên một ENUM NHIỀU NHÃN phục vụ trọn cả ba tham số. Fixture dưới
  // đây ~40 dòng và nó ĐO trên đúng hàm sản phẩm.
  //
  // VÌ SAO TRỤC NÀY KHÔNG PHẢI TRANG TRÍ: Task 8 vòng fix 2 đã tái lập END-TO-END rằng
  // `CREATE TYPE ... AS ENUM` + `CREATE CAST ... AS IMPLICIT` LẬT ĐƯỢC một phán xét mà KHÔNG
  // cần cướp một toán tử nào. Kẻ tấn công cần `CREATE` trên một schema bất kỳ cộng quyền điều
  // khiển `search_path` — và cái nó mua là mở thầu với một lần MFA CŨ TUỲ Ý, tức lật thẳng D1.
  //
  // CONTAINER RIÊNG, KHÔNG GHÉP VÀO KHỐI TRÊN: fixture này định nghĩa `ke9.uuid`, và với
  // `search_path = ke9, pg_catalog, public` thì MỌI chữ `uuid` trần trong container đó phân
  // giải về enum — kể cả các vế probe của khối trên. Ghép lại là tự làm mù phép đo kia.
  // ==========================================================================================
  it("[INV-D1] trục TÊN KIỂU có MỐC CHẾT — ENUM + CAST IMPLICIT lật được bản KHÔNG ghim", async () => {
    const dbRieng = await startPostgres();
    try {
      await migrate(dbRieng.pool, MIGRATIONS);
      const { rows: o } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
      );
      const org = o[0]!.id;
      const { rows: u } = await dbRieng.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name, status) VALUES ($1, 'ok@a.com', 'OK', 'ACTIVE') RETURNING id",
        [org],
      );
      const nguoi = u[0]!.id;

      const themPhien = async (mfaLuc: string): Promise<string> => {
        const { rows } = await dbRieng.pool.query<{ id: string }>(
          "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
            `VALUES ($1, $2, $3, clock_timestamp() + interval '8 hours', ${mfaLuc}) RETURNING id`,
          [org, nguoi, randomBytes(32)],
        );
        return rows[0]!.id;
      };
      const sidTuoi = await themPhien("clock_timestamp()");
      const sidCu = await themPhien("clock_timestamp() - interval '2 hours'");

      // ------------------------- KIỂU `uuid` THÙ ĐỊCH -------------------------
      // Bốn NHÃN, không phải một: đây chính là điều mà lý do hoãn cũ nói là không làm được.
      await dbRieng.pool.query("CREATE SCHEMA ke9");
      await dbRieng.pool.query("GRANT USAGE ON SCHEMA ke9 TO PUBLIC");
      await dbRieng.pool.query(
        `CREATE TYPE ke9.uuid AS ENUM ('${sidCu}', '${sidTuoi}', '${nguoi}', '${org}')`,
      );
      // Ánh xạ THEO NHÃN: chỉ `sidCu` bị đổi, ba nhãn kia đi qua nguyên vẹn. Nhờ vậy phán xét
      // bị lật ĐÚNG một trục (định danh phiên) thay vì hỏng toàn bộ truy vấn.
      await dbRieng.pool.query(
        `CREATE FUNCTION ke9.doi(v ke9.uuid) RETURNS pg_catalog.uuid
           LANGUAGE sql IMMUTABLE AS $$
             SELECT (CASE v::pg_catalog.text
                       WHEN '${sidCu}' THEN '${sidTuoi}'
                       ELSE v::pg_catalog.text
                     END)::pg_catalog.uuid $$`,
      );
      await dbRieng.pool.query("GRANT EXECUTE ON FUNCTION ke9.doi(ke9.uuid) TO PUBLIC");
      await dbRieng.pool.query(
        "CREATE CAST (ke9.uuid AS pg_catalog.uuid) WITH FUNCTION ke9.doi AS IMPLICIT",
      );

      await dbRieng.pool.query("CREATE ROLE app_api_ke9 LOGIN PASSWORD 'mk' IN ROLE app_api");
      await dbRieng.pool.query("ALTER ROLE app_api_ke9 SET search_path = ke9, pg_catalog, public");

      const url = new URL(dbRieng.connectionString);
      url.username = "app_api_ke9";
      url.password = "mk";
      const poolThuDich = createPool(url.toString(), 3);
      try {
        // ============== FIXTURE TỰ CHỨNG MINH NÓ TẤN CÔNG ĐƯỢC ==============
        // Nếu `uuid` trần vẫn phân giải về pg_catalog, mọi khẳng định dưới đây xanh VÌ LÝ DO
        // SAI. Đối chứng dương: chữ `uuid` trần phải thuộc schema THÙ ĐỊCH, còn
        // `pg_catalog.uuid` thì không.
        const { rows: ns } = await poolThuDich.query<{ tran: string; ghim: string }>(
          `SELECT (SELECT n.nspname FROM pg_catalog.pg_type t
                     JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) t.typnamespace
                    WHERE t.oid OPERATOR(pg_catalog.=) pg_catalog.to_regtype('uuid')) AS tran,
                  (SELECT n.nspname FROM pg_catalog.pg_type t
                     JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) t.typnamespace
                    WHERE t.oid OPERATOR(pg_catalog.=) pg_catalog.to_regtype('pg_catalog.uuid')) AS ghim`,
        );
        expect(ns[0]!.tran, "`uuid` trần KHÔNG bị cướp — fixture rỗng ruột").toBe("ke9");
        expect(ns[0]!.ghim, "`pg_catalog.uuid` lại bị cướp — phép đo rỗng ruột").toBe("pg_catalog");

        // ============== HAI BẢN CỦA CÙNG MỘT VỊ TỪ, ĐO RIÊNG ==============
        // HAI LỜI GỌI RIÊNG, KHÔNG DÙNG CHUNG THAM SỐ: PostgreSQL suy kiểu tham số từ lần dùng
        // ĐẦU TIÊN, nên gộp hai vế vào một câu sẽ biến `$1::pg_catalog.uuid` thành một phép ép
        // TƯỜNG MINH từ `ke9.uuid` — tức đo một hình dạng mà mã sản phẩm không có. Đây đúng cạm
        // bẫy đã suýt cho một kết luận sai NGƯỢC CHIỀU ở Task 8 vòng fix 3.
        const viTu = (kieu: string): string =>
          `SELECT (s.mfa_verified_at OPERATOR(pg_catalog.>)
                   (pg_catalog.clock_timestamp() OPERATOR(pg_catalog.-)
                    pg_catalog.make_interval(secs => 300::pg_catalog.float8))) IS TRUE AS tuoi
             FROM public.sessions s
            WHERE s.id OPERATOR(pg_catalog.=) $1::${kieu}`;
        const doVe = async (kieu: string): Promise<boolean> => {
          const { rows } = await withTenant(poolThuDich, org, (c) =>
            c.query<{ tuoi: boolean }>(viTu(kieu), [sidCu]),
          );
          return rows[0]?.tuoi === true;
        };
        expect(
          await doVe("uuid"),
          "bản KHÔNG GHIM phải BỊ LẬT — nếu không, trục này không khai thác được và mốc chết " +
            "dưới đây không đo gì cả.",
        ).toBe(true);
        expect(await doVe("pg_catalog.uuid"), "bản CÓ GHIM bị lật theo").toBe(false);

        // ==================== MÃ SẢN PHẨM PHẢI ĐỨNG VỮNG ====================
        await expect(
          withTenant(poolThuDich, org, (c) =>
            assertFreshMfa(c, { sessionId: sidCu, userId: nguoi, orgId: org, maxAgeSeconds: 300 }),
          ),
        ).rejects.toBeInstanceOf(MfaRequiredError);

        // ĐỐI CHỨNG DƯƠNG: phiên THẬT SỰ tươi vẫn qua dưới cùng search_path — nên khẳng định
        // trên không phải "truy vấn hỏng hoàn toàn dưới path này".
        await expect(
          withTenant(poolThuDich, org, (c) =>
            assertFreshMfa(c, { sessionId: sidTuoi, userId: nguoi, orgId: org, maxAgeSeconds: 300 }),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await poolThuDich.end();
      }
    } finally {
      await dbRieng.stop();
    }
  }, 240_000);
});
