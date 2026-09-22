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

// ----------------------------------------------------------------------------------------------
// [S1.112 / khoản 235] CẶP (GHI HỒ SƠ, CHÈN PHIÊN) PHẢI NẰM TRỌN TRONG **MỘT** BƯỚC 30 GIÂY
// ----------------------------------------------------------------------------------------------
// `hoSo()` tính `last_used_counter` ở thời điểm T1; trigger `039` so nó với `clock_timestamp()` ở
// T2 > T1. Ca `lechBuoc = 3` ngồi ĐÚNG biên dưới của ±3, nên chỉ cần đồng hồ tường vượt MỘT mốc
// bội-30-giây giữa T1 và T2 là độ lệch hiệu dụng thành 4 và trigger từ chối — một lần ĐỎ NGẪU
// NHIÊN, đã thấy trong lượt `test:int` trọn cây ngày 2026-09-22.
//
// BA LỜI KHAI BỊ PHÉP ĐO BÁC (`apps/api/do-totp-bien.mjs`, ép vượt mốc chứ không chờ may rủi):
//
//   ⑴ *"khe hở HAI ĐỒNG HỒ Node ↔ Postgres"* — **sai**. Container dùng chung clock của host nên
//     KHÔNG có skew. Thứ gây đỏ là **thời gian TRÔI** giữa hai câu, không phải nguồn đồng hồ. Đo:
//     lấy bộ đếm từ `clock_timestamp()` của CSDL ngay trong câu ghi ⇒ **VẪN ĐỎ** khi vượt mốc.
//
//   ⑵ *"`lechBuoc = -3` cũng ở biên"* — **sai**. Đồng hồ chỉ trôi TỚI, nên một lần vượt mốc đưa
//     `-3` từ *+3 bước ở tương lai* thành *+2* — SÂU HƠN vào trong dung sai. Đo: `-3` vượt mốc
//     vẫn QUA.
//
//   ⑶ *"những ca TỪ CHỐI thì lệch thêm một bước vẫn từ chối, nên chúng an toàn"* — **sai với
//     `-4`**, và đây là ca NGUY HƠN cả ca đã báo. Bộ đếm `+4 bước ở tương lai` sau một lần vượt
//     mốc thành `+3` — **lọt vào dung sai và câu INSERT ĐI QUA**. Tức một ca lẽ ra ĐỎ sẽ XANH:
//     một lần mù, không phải một lần ồn. `+4` thì an toàn thật (lệch thêm ⇒ càng xa).
//
// Nên vá ở FIXTURE, và vá bằng cách xoá cuộc đua chứ không bằng cách nới dung sai của `039` —
// dung sai ấy là một quyết định an ninh. Biên **5 giây** so với khe hở đo được **7 ms** (20 lượt,
// máy rảnh: min 5, max 9) là hơn **700 lần**; hậu điều kiện ngay dưới khẳng định phép chờ ĐÃ làm
// được việc của nó, nên một lần nới sai biên không đi qua trong im lặng.
//
// Đường SẢN XUẤT không có cuộc đua này: `verifyTotpAttempt` ghi bộ đếm ở lệch **0**, nên nó còn
// trọn ba bước (90 giây) slack trước khi `startUserSession` chèn. Chỉ TEST mới ngồi đúng biên, và
// ngồi đúng biên là CHỦ Ý — `[review H4-6]` ghim ±3 và ±4 để một lần nới dung sai bị bắt.
//
// PHẦN DƯ, nói ra bằng số: biên 5 giây KHÔNG đóng được ca khe hở **vượt 5 giây** — nó chỉ đẩy
// ngưỡng lên 700 lần so với khe hở đo được. Nếu ca này lại đỏ, đo `conLaiTrongBuoc()` ngay trước
// khi kết luận: khe hở đã vượt 5 giây thì đây vẫn là cùng khoản **235**, không phải một lỗi nghiệp
// vụ mới. Không nới dung sai của `039` — đó là một quyết định an ninh, không một tham số test.
//
// LƯỢT TÌM cho lời khai *"không có chỗ thứ hai"*: `grep counterForTime|STEP_SECONDS` trên
// `packages/ apps/ db/`. Chỗ duy nhất khác ngồi ở BIÊN là `apps/api/src/auth.int.test.ts:1040`
// (`counterForTime(Date.now()) + 1`, cửa sổ xác thực `DEFAULT_WINDOW = 1`), và nó AN TOÀN theo
// chiều đồng hồ trôi: mã của bước `N+1` rơi vào GIỮA cửa sổ của bước `N+1`, tức sâu hơn vào trong.
// Mọi chỗ còn lại hoặc dùng mốc cố định `NGAY`, hoặc ở lệch 0 — cả một cửa sổ slack.
// ----------------------------------------------------------------------------------------------
const BUOC_MS = 30_000;
const BIEN_TOI_THIEU_MS = 5_000;
const conLaiTrongBuoc = (): number => BUOC_MS - (Date.now() % BUOC_MS);

/** Chờ tới khi còn ít nhất `BIEN_TOI_THIEU_MS` trong bước 30 giây hiện tại. */
async function choDuBien(): Promise<void> {
  if (conLaiTrongBuoc() < BIEN_TOI_THIEU_MS) {
    await new Promise((xong) => setTimeout(xong, conLaiTrongBuoc() + 20));
  }
  expect(
    conLaiTrongBuoc(),
    "hậu điều kiện của choDuBien: sau khi chờ phải còn đủ biên trong bước 30 giây hiện tại — " +
      "thiếu nó thì một lần nới BIEN_TOI_THIEU_MS sai đi qua trong im lặng",
  ).toBeGreaterThanOrEqual(BIEN_TOI_THIEU_MS);
}

/** Hồ sơ TOTP của người ấy — `daXacNhan` và `lechBuoc` (0 = bộ đếm hiện tại, 4 = quá cũ). */
async function hoSo(orgId: string, userId: string, daXacNhan: boolean, lechBuoc: number | null): Promise<void> {
  // Chờ TRƯỚC khi ghi: biên được đo từ thời điểm `last_used_counter` được tính, và mọi ca của
  // tệp này đều đi qua đây nên không ca nào phải tự nhớ mình có ở biên hay không.
  await choDuBien();
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
    // [review H4-6] CẬN TRÊN: bộ đếm ở tương lai 4 bước ⇒ 23514 (không được thoả mãn vĩnh viễn); +3 vẫn qua.
    await hoSo(orgA, u, true, -4);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await hoSo(orgA, u, true, -1_000_000);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await hoSo(orgA, u, true, -3);
    await expect(chenPhienMfa(orgA, u)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("[review H4-6] PHẦN CHÊNH nói ra: app_api có UPDATE (last_used_counter) nên HAI câu (UPDATE bộ đếm rồi INSERT) đi qua — trigger chặn một INSERT trần, không chặn đường này", async () => {
    const u = await taoNguoi(orgA);
    await hoSo(orgA, u, true, 10);
    await expect(chenPhienMfa(orgA, u)).rejects.toMatchObject({ code: "23514" });
    await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE mfa_credentials SET last_used_counter = $3 WHERE org_id = $1 AND user_id = $2", [orgA, u, counterForTime(Date.now())]),
    );
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
