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

/**
 * [S1.105 / S2.3] Hình dạng HỢP LỆ của một thành phần chính sách, và nó ĐỔI ở vòng S2.3.
 *
 * Bản S1.102 dùng `[{"ma":"gia","he_so":"1.00"}]` — **không có trường đơn vị nào**. `056` cố ý
 * để hở hình dạng bên trong, và `057` chốt nó vì **J1** treo vào đúng trường ấy: *con số xếp hạng
 * chỉ gồm các khoản có ĐƠN VỊ TIỀN*. Không có `don_vi`, trigger nội dung của J1 không có gì để
 * đọc. Bảy ca của tệp này ĐỎ khi `057` vào, và lượt đỏ ấy là phép đo rằng ràng buộc có răng.
 */
const TP_HOP_LE = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

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
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [TP_HOP_LE, 3]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    expect(rows[0]?.id).toBeTruthy();
  });

  it("⑵ `bafo_top_n = 0` là một lời khai CÓ MẶT (tổ chức không dùng BAFO), không phải chưa khai", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [TP_HOP_LE, 0]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    expect(rows[0]?.id, "spec §2.2⑸: một RFQ đi thẳng EVALUATING → AWARDED là đường HỢP LỆ").toBeTruthy();
  });

  it.each([
    // Giá trị HỢP LỆ, cố ý: một `eval_components` sai hình dạng sẽ bị `..._hinh_dang` bắt
    // trước và ca này thôi đo `..._danh_gia_du_bo`. Mỗi ràng buộc một input CHỈ nó bắt.
    ["chỉ `eval_components`", ["eval_components"], [TP_HOP_LE]],
    ["chỉ `bafo_top_n`", ["bafo_top_n"], [3]],
  ])("⑵ khai MỘT NỬA (%s) bị chặn ở tầng CSDL — 23514", async (_ten, cot, gia) => {
    const { sql, thamSo } = await cauChinhSach(cot, gia);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_danh_gia_du_bo",
    });
  });

  it("⑵ `bafo_top_n` ÂM không phải một lời khai nào cả — 23514", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [TP_HOP_LE, -1]);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_bafo_top_n_khong_am",
    });
  });

  // [S1.105 / S2.3] BA CA NÀY TỪNG KHỚP `..._la_mang`, VÀ TỪ `057` CHÚNG THÔI ĐO NÓ.
  // `jsonpath` ở chế độ lax TỰ BỌC một scalar thành mảng một phần tử, nên `$[*] ? (…)` của
  // `..._hinh_dang` cũng bắt `'"chi-gia"'` — và Postgres báo ràng buộc nào nó chạm trước, không
  // hứa thứ tự. Một ca mà HAI ràng buộc cùng bắt thì không đo được ràng buộc nào cả: đúng lớp lỗi
  // mà `fixture-vai-bootstrap-che-ve-loc` đã trả giá hai lần ở S1.53 và S1.56.
  //
  // Nên ba ca ấy nay khai `..._hinh_dang` (thứ THẬT SỰ bắt chúng), và `..._la_mang` nhận một input
  // mà CHỈ nó bắt được: một OBJECT TRẦN. Object ấy đi qua trọn ba vế của `..._hinh_dang` — nó có
  // `ma`/`don_vi`/`he_so` đều là chuỗi và `don_vi` là `TIEN` — nên thứ duy nhất còn chặn nó là vế
  // *"phải là một MẢNG"*.
  it.each([
    ["một chuỗi JSON", '"chi-gia"'],
    ["một số JSON", "3"],
    ["`null` của JSON — KHÁC `NULL` của SQL", "null"],
  ])("⑵ `eval_components` không phải MẢNG (%s) bị chặn — 23514", async (_ten, van) => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [van, 1]);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_eval_components_hinh_dang",
    });
  });

  it("⑵ một OBJECT TRẦN bị chặn bởi ĐÚNG vế *phải là một mảng* — input mà chỉ `..._la_mang` bắt", async () => {
    const tran = '{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}';
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [tran, 1]);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_eval_components_la_mang",
    });
  });

  it("⑶ `app_api` GHI được hai cột mới — quyền theo cột là cộng dồn", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [TP_HOP_LE, 5]);
    const { rows } = await withTenant(apiPool, org, (c) => c.query<{ id: string }>(sql, thamSo));
    expect(rows[0]?.id, "một GRANT quên thì đường hợp lệ chết lúc tạo phiên bản chính sách đầu tiên").toBeTruthy();
  });

  // ============================================================================================
  // [S1.105 / S2.3] HÌNH DẠNG BÊN TRONG — thứ `056` cố ý để hở, và J1 đòi
  // ============================================================================================
  it.each([
    ["thiếu `don_vi` — hình dạng S1.102", '[{"ma":"gia","he_so":"1.0000"}]'],
    ["thiếu `he_so`", '[{"ma":"gia","don_vi":"TIEN"}]'],
    ["thiếu `ma`", '[{"don_vi":"TIEN","he_so":"1.0000"}]'],
    ["`don_vi` lạ", '[{"ma":"gia","don_vi":"XXX","he_so":"1.0000"}]'],
    ["`don_vi` là SỐ — vế mà một phép so chuỗi một mình KHÔNG bắt", '[{"ma":"gia","don_vi":3,"he_so":"1.0000"}]'],
    ["`don_vi` là `null`", '[{"ma":"gia","don_vi":null,"he_so":"1.0000"}]'],
    ["`he_so` là số JSON — `numeric` và `number` không cùng miền", '[{"ma":"gia","don_vi":"TIEN","he_so":1}]'],
    ["`ma` là số", '[{"ma":3,"don_vi":"TIEN","he_so":"1.0000"}]'],
    ["phần tử không phải object", '[3]'],
    ["mảng RỖNG — không thành phần TIỀN nào", "[]"],
    ["chỉ có DIEM — chấm ra con số tiền nào?", '[{"ma":"kt","don_vi":"DIEM","he_so":"2.0000"}]'],
  ])("⑵ `eval_components` sai hình dạng bên trong (%s) bị chặn — 23514", async (_ten, van) => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [van, 1]);
    await expect(db.pool.query(sql, thamSo)).rejects.toMatchObject({
      code: "23514",
      constraint: "org_procurement_policies_eval_components_hinh_dang",
    });
  });

  it("⑵ một thành phần `DIEM` ĐỨNG CẠNH một thành phần `TIEN` thì HỢP LỆ — J1 lọc, không cấm", async () => {
    const ca = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"kt","don_vi":"DIEM","he_so":"2.0000"}]';
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [ca, 2]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    expect(rows[0]?.id, "một chính sách có điểm phi giá là chính sách BÌNH THƯỜNG").toBeTruthy();
  });

  it("⑶ và `app_api` VẪN không UPDATE được chúng — bảng chỉ ghi thêm, đổi chính sách là thêm phiên bản", async () => {
    const { sql, thamSo } = await cauChinhSach(["eval_components", "bafo_top_n"], [TP_HOP_LE, 0]);
    const { rows } = await db.pool.query<{ id: string }>(sql, thamSo);
    await expect(
      withTenant(apiPool, org, (c) => c.query("UPDATE org_procurement_policies SET bafo_top_n = 9 WHERE id = $1", [rows[0]?.id])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
