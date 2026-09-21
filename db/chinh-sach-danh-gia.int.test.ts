// ===============================================================================================
// [S1.102 / S2.1] CHÍNH SÁCH ĐÁNH GIÁ — LỚP CSDL LÀM CHO TRẠNG THÁI "KHAI MỘT NỬA" BẤT KHẢ
//
// `056` mở rộng `org_procurement_policies` bằng hai cột của Effective Cost, và một `CHECK`
// **tất-cả-hoặc-không-cột-nào**. Tệp này đo đúng ba điều, và không hơn:
//
//   ⑴ phiên bản chính sách CŨ — không khai cột nào — vẫn ghi được. Đây là vế đắt nhất: một
//     migration làm chết mọi hàng đã có là một migration không triển khai được;
//   ⑵ khai MỘT NỬA thì bị chặn ở tầng CSDL, không phải ở tầng ứng dụng;
//   ⑶ `app_api` ghi được hai cột mới — quyền theo CỘT là cộng dồn, và một `GRANT` quên thì
//     đường hợp lệ chết trong im lặng cho tới lúc ai đó tạo phiên bản chính sách đầu tiên.
//
// **Thứ tệp này KHÔNG đo, nói ra:** câu từ chối *"chính sách phiên bản N chưa khai trọng số"* —
// nó là việc của **S2.3**, và chưa có mã nào để gọi. Và hình dạng BÊN TRONG của `eval_components`
// (mọi phần tử mang một trường tiền) là **J1**, cần một trigger đọc chính sách chứ không phải một
// `CHECK` — đo ở lượt soi S1.101, ghi vào spec §5.
//
// **Không mang nhãn `[INV-*]` nào**, và đó là cố ý: `056` chưa cưỡng chế một bất biến nhóm J nào,
// nó chỉ dựng chỗ để chúng đứng. Gắn một nhãn ở đây là ghi một dòng "passed" vào hàng của một bất
// biến chưa tồn tại — đúng thứ `[INV-H22]` sinh ra để chặn. Cổng chịu lực của tệp này là dòng
// `vitest thoát mã` của `pnpm evidence`.
// ===============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let org = "";
let nguoi = "";
let phien = "";
/**
 * Một câu `INSERT` chính sách đầy đủ trừ hai cột mới — `cot`/`gia` thêm đúng thứ ca cần.
 *
 * Số phiên bản ĐỌC TỪ CSDL chứ không đếm trong tiến trình: `035` đòi `version` bằng ĐÚNG
 * `max(version) + 1` và liên tục, nên một bộ đếm cục bộ trôi ngay sau ca ghi hỏng ĐẦU TIÊN — và
 * mọi ca sau đó đỏ vì `035` chứ không vì thứ nó định đo. Bản đầu của tệp này mắc đúng lỗi ấy: 7
 * ca đỏ với `Phien ban chinh sach phai BANG phien ban lon nhat + 1`.
 */
async function cauChinhSach(
  cot: readonly string[],
  gia: readonly unknown[],
): Promise<{ readonly sql: string; readonly thamSo: unknown[] }> {
  const { rows } = await db.pool.query<{ ke: number }>(
    "SELECT coalesce(pg_catalog.max(version), 0) + 1 AS ke FROM org_procurement_policies WHERE org_id = $1",
    [org],
  );
  const nen = ["org_id", "version", "dual_approval_threshold", "currency", "created_by", "created_by_session_id"];
  const tat = [...nen, ...cot];
  const cho = tat.map((_, i) => `$${String(i + 1)}`).join(", ");
  return {
    sql: `INSERT INTO org_procurement_policies (${tat.join(", ")}) VALUES (${cho}) RETURNING id`,
    thamSo: [org, rows[0]?.ke ?? 1, "1000000.00", "VND", nguoi, phien, ...gia],
  };
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  org =
    (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id"))
      .rows[0]?.id ?? "";
  nguoi =
    (
      await db.pool.query<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'cs@vidu.vn', 'Nguoi dat chinh sach') RETURNING id",
        [org],
      )
    ).rows[0]?.id ?? "";
  phien =
    (
      await db.pool.query<{ id: string }>(
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
          "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
        [org, nguoi, randomBytes(32)],
      )
    ).rows[0]?.id ?? "";
  expect([org, nguoi, phien].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.102 / S2.1] hai cột đánh giá của `org_procurement_policies`", { timeout: 120000 }, () => {
  it("⑴ phiên bản chính sách CŨ — không khai cột nào — vẫn ghi được", async () => {
    const { sql, thamSo } = await cauChinhSach([], []);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    expect(rows[0]?.id, "một migration làm chết mọi hàng đã có là một migration không triển khai được").toBeTruthy();
  });

  it("⑵ khai ĐỦ hai cột thì ghi được", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], ['[{"ma":"gia","he_so":"1.00"}]', 3]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    expect(rows[0]?.id).toBeTruthy();
  });

  it("⑵ `bafo_top_n = 0` là một lời khai CÓ MẶT (tổ chức không dùng BAFO), không phải chưa khai", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], ["[]", 0]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    expect(rows[0]?.id, "spec §2.2⑸: một RFQ đi thẳng EVALUATING → AWARDED là đường HỢP LỆ").toBeTruthy();
  });

  it.each([
    ["chỉ `eval_components`", ["eval_components"], ['[{"ma":"gia"}]']],
    ["chỉ `bafo_top_n`", ["bafo_top_n"], [3]],
  ])("⑵ khai MỘT NỬA (%s) bị chặn ở tầng CSDL — 23514", async (_ten, cot, gia) => {
    const { sql, thamSo } = await cauChinhSach(cot, gia);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_danh_gia_du_bo",
    });
  });

  it("⑵ `bafo_top_n` ÂM không phải một lời khai nào cả — 23514", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], ["[]", -1]);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_bafo_top_n_khong_am",
    });
  });

  it.each([
    ["một chuỗi JSON", '"chi-gia"'],
    ["một số JSON", "3"],
    ["`null` của JSON — KHÁC `NULL` của SQL", "null"],
  ])("⑵ `eval_components` không phải MẢNG (%s) bị chặn — 23514", async (_ten, van) => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [van, 1]);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_eval_components_la_mang",
    });
  });

  it("⑶ `app_api` GHI được hai cột mới — quyền theo cột là cộng dồn", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], ['[{"ma":"gia","he_so":"1.00"}]', 5]);
    const { rows } = await withTenant(apiPool, org, (c) => c.query<{ id: string }>(sql, thamSo));
    expect(rows[0]?.id, "một GRANT quên thì đường hợp lệ chết lúc tạo phiên bản chính sách đầu tiên").toBeTruthy();
  });

  it("⑶ và `app_api` VẪN không UPDATE được chúng — bảng chỉ ghi thêm, đổi chính sách là thêm phiên bản", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], ["[]", 0]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    await expect(
      withTenant(apiPool, org, (c) => c.query("UPDATE org_procurement_policies SET bafo_top_n = 9 WHERE id = $1", [rows[0]?.id])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
