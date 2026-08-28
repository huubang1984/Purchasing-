import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { withTenant } from "@trustprocure/tenancy";
import { appendAuditEvent, exportChainHead, recordChainAnchor, verifyAuditChain } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

// ==============================================================================================
// [vòng fix 2 — MỤC A] `assertTenantBound` DƯỚI MỘT TOÁN TỬ `=` BỊ CƯỚP.
//
// Vòng fix 1 viết thành văn ở hai chỗ (packages/identity/src/rbac.ts và báo cáo) rằng hàm này
// "KHÔNG cần bản vá" vì `IS NOT DISTINCT FROM` "phân giải qua opclass". Câu đó SAI:
// PostgreSQL phân giải `IS [NOT] DISTINCT FROM` bằng cách tra cứu toán tử `=` THEO TÊN qua
// `search_path` (`make_distinct_op` -> `make_op`). Đo lại trên PostgreSQL 16.15, KHÔNG sửa gì
// khác, sổ của P có 3 hàng và sổ của Q có 7 hàng:
//     assertTenantBound(phiên P, orgQ)     -> QUA
//     verifyAuditChain(phiên của P, orgQ)  -> ok=false checked=3   (sự thật: Q có 7)
//     exportChainHead(phiên của P, orgQ)   -> {"orgId":<orgQ>,"seq":3,...}
// tức MỘT MỐC NEO MANG NHÃN TỔ CHỨC Q ĐÚC TỪ SỔ CỦA TỔ CHỨC P — nguyên văn kịch bản [M5].
//
// Khai thác KHÔNG đụng tới `app_current_org_id()`: chỉ cướp toán tử của `uuid`, để nguyên
// `text`, nên `NULLIF` bên trong hàm vẫn chạy đúng và lớp phòng thủ TÌNH CỜ mà vòng fix 1 mô
// tả (hàm sập về NULL) KHÔNG kích hoạt. Fixture dưới đây khẳng định đúng tiền đề đó trước khi
// kết luận bất cứ điều gì.
// ==============================================================================================

let db: TestDatabase;
let poolThuDich: pg.Pool;
/** [vòng fix 3 — MỤC 1] Phiên tấn công trục TÊN KIỂU: KHÔNG cướp một toán tử nào. */
let poolTenKieu: pg.Pool;
/** [vòng fix 3 — MỤC 2] Phiên SUPERUSER — không chịu RLS, và `=` của uuid bị cướp. */
let poolSieu: pg.Pool;
let orgP: string;
let orgQ: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('P','p'),('Q','q') RETURNING id",
  );
  orgP = rows[0]!.id;
  orgQ = rows[1]!.id;
  for (const [org, soLan] of [
    [orgP, 3],
    [orgQ, 7],
  ] as const) {
    await withTenant(db.pool, org, async (c) => {
      for (let i = 0; i < soLan; i += 1) {
        await appendAuditEvent(c, org, {
          actorType: "SYSTEM",
          action: `E${i}`,
          resourceType: "TEST",
        });
      }
    });
  }

  // Schema thù địch. CỐ Ý cướp `=` cho BA kiểu — `uuid`, `bigint`, `bytea` — vì đó đúng là ba
  // kiểu của ba cột mà vế phát hiện CẮT ĐUÔI của verifyAuditChain so sánh.
  await db.pool.query("CREATE SCHEMA doc; GRANT USAGE ON SCHEMA doc TO PUBLIC");
  for (const kieu of ["uuid", "bigint", "bytea"]) {
    await db.pool.query(
      `CREATE FUNCTION doc.luon_dung_${kieu}(${kieu}, ${kieu}) RETURNS boolean
         LANGUAGE sql IMMUTABLE AS 'SELECT true'`,
    );
    await db.pool.query(
      `CREATE OPERATOR doc.= (LEFTARG=${kieu}, RIGHTARG=${kieu}, FUNCTION=doc.luon_dung_${kieu})`,
    );
  }
  // Trục TÊN KIỂU, hình dạng MIỀN TRỊ: hai miền trị bóng đứng TRƯỚC pg_catalog. Riêng hình dạng
  // này fail-closed — nhưng [vòng fix 3 — MỤC 1] KHÔNG được đọc điều đó thành "cả trục tên kiểu
  // fail-closed": hình dạng ENUM + CAST IMPLICIT (schema `gia` dựng ở dưới) LẬT ĐƯỢC phán xét.
  await db.pool.query("CREATE DOMAIN doc.uuid AS pg_catalog.uuid");
  await db.pool.query("CREATE DOMAIN doc.text AS pg_catalog.text");
  await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk' IN ROLE app_api");
  await db.pool.query("ALTER ROLE app_api_login SET search_path = doc, pg_catalog, public");

  // ==========================================================================================
  // [vòng fix 3 — MỤC 1] SCHEMA THÙ ĐỊCH THỨ HAI: trục TÊN KIỂU, KHÔNG cướp một toán tử nào.
  //
  // Vòng fix 2 đo trục này bằng ĐÚNG MỘT hình dạng (miền trị bóng) rồi kết luận cho cả trục là
  // "fail-CLOSED, ghim theo QT2 chứ không phải vá". Sai. Hình dạng ENUM + CAST IMPLICIT LẬT
  // ĐƯỢC phán xét: `$1::uuid` trần phân giải thành kiểu ENUM bóng, và phép ép ngầm về
  // `pg_catalog.uuid` (bắt buộc phải xảy ra để `OPERATOR(pg_catalog.=)` áp được) chạy HÀM CỦA
  // KẺ TẤN CÔNG, hàm này trả thẳng `app_current_org_id()` — hai vế bằng nhau với MỌI `$1`.
  //
  // Toàn bộ DDL dưới đây chạy DƯỚI CHÍNH ROLE TẤN CÔNG (không superuser, không CREATEROLE) để
  // test tự chứng minh tiền đề: cần đúng `CREATE` trên một schema nằm trên `search_path` — y
  // hệt mô hình đe doạ mà dự án đã chấp nhận cho `CREATE OPERATOR`.
  // ==========================================================================================
  await db.pool.query("CREATE ROLE app_gia_login LOGIN PASSWORD 'mk' IN ROLE app_api");
  await db.pool.query("ALTER ROLE app_gia_login SET search_path = gia, pg_catalog, public");
  await db.pool.query("CREATE SCHEMA gia AUTHORIZATION app_gia_login");
  const cGia = await db.pool.connect();
  try {
    await cGia.query("BEGIN");
    // `SET LOCAL` để quyền hạn trở lại ở COMMIT — client này quay về pool sau đó.
    await cGia.query("SET LOCAL SESSION AUTHORIZATION app_gia_login");
    const { rows: hoSoKe } = await cGia.query<{ sieu: boolean; tao_role: boolean }>(
      `SELECT r.rolsuper AS sieu, r.rolcreaterole AS tao_role
         FROM pg_catalog.pg_roles r
        WHERE r.rolname OPERATOR(pg_catalog.=) CURRENT_USER`,
    );
    expect(hoSoKe[0]!.sieu, "kẻ tấn công KHÔNG được là superuser, nếu không phép đo rỗng ruột").toBe(
      false,
    );
    expect(hoSoKe[0]!.tao_role, "kẻ tấn công KHÔNG được có CREATEROLE").toBe(false);
    // Nhãn ENUM là hai uuid do CHÍNH database sinh ra — nội suy an toàn.
    await cGia.query(`CREATE TYPE gia.uuid AS ENUM ('${orgP}', '${orgQ}')`);
    await cGia.query(
      `CREATE FUNCTION gia.ep(gia.uuid) RETURNS pg_catalog.uuid
         LANGUAGE sql STABLE AS 'SELECT public.app_current_org_id()'`,
    );
    await cGia.query(
      "CREATE CAST (gia.uuid AS pg_catalog.uuid) WITH FUNCTION gia.ep AS IMPLICIT",
    );
    await cGia.query("COMMIT");
  } catch (loi) {
    await cGia.query("ROLLBACK").catch(() => {});
    throw loi;
  } finally {
    cGia.release();
  }

  // [vòng fix 3 — MỤC 2] Phiên SUPERUSER trên CHÍNH schema thù địch `doc` ở trên. Đây là phiên
  // mà `packages/test-support` cấp qua `db.pool`, và là phiên một người vận hành chạy công cụ
  // kiểm toán bằng tay sẽ có. Nó KHÔNG chịu RLS, nên mọi lập luận "RLS đã giới hạn tập hàng"
  // đều rỗng ở đây.
  await db.pool.query("CREATE ROLE sieu_login LOGIN SUPERUSER PASSWORD 'mk'");
  await db.pool.query("ALTER ROLE sieu_login SET search_path = doc, pg_catalog, public");

  const url = new URL(db.connectionString);
  url.username = "app_api_login";
  url.password = "mk";
  poolThuDich = createPool(url.toString(), 3);
  url.username = "app_gia_login";
  poolTenKieu = createPool(url.toString(), 3);
  url.username = "sieu_login";
  poolSieu = createPool(url.toString(), 3);
}, 300_000);

afterAll(async () => {
  await poolThuDich?.end().catch(() => {});
  await poolTenKieu?.end().catch(() => {});
  await poolSieu?.end().catch(() => {});
  await db?.stop();
});

describe("[MỤC A] assertTenantBound dưới toán tử `=` bị cướp", () => {
  it("FIXTURE tự chứng minh nó tấn công được, và app_current_org_id() vẫn ĐÚNG", async () => {
    const { rows } = await poolThuDich.query<{
      sp: string;
      indf: boolean;
      eq: boolean;
      du: boolean;
      pc: string | null;
    }>(
      `SELECT pg_catalog.current_setting('search_path') AS sp,
              ('11111111-1111-1111-1111-111111111111'::pg_catalog.uuid
               IS NOT DISTINCT FROM '22222222-2222-2222-2222-222222222222'::pg_catalog.uuid) AS indf,
              ('11111111-1111-1111-1111-111111111111'::pg_catalog.uuid
               = '22222222-2222-2222-2222-222222222222'::pg_catalog.uuid) AS eq,
              ('11111111-1111-1111-1111-111111111111'::pg_catalog.uuid
               OPERATOR(pg_catalog.=) '22222222-2222-2222-2222-222222222222'::pg_catalog.uuid) AS du,
              (SELECT pg_catalog.array_to_string(p.proconfig, ',') FROM pg_catalog.pg_proc p
                WHERE p.oid = 'public.app_current_org_id()'::pg_catalog.regprocedure) AS pc`,
    );
    const d = rows[0]!;
    expect(d.sp).toBe("doc, pg_catalog, public");
    expect(d.indf, "`IS NOT DISTINCT FROM` KHÔNG bị cướp — phép đo rỗng ruột").toBe(true);
    expect(d.eq, "`=` trần KHÔNG bị cướp — phép đo rỗng ruột").toBe(true);
    expect(d.du, "`OPERATOR(pg_catalog.=)` LẠI bị cướp — phép đo rỗng ruột").toBe(false);
    // TIỀN ĐỀ SINH TỬ: khai thác này KHÔNG dựa vào việc app_current_org_id() hỏng. Nếu vế này
    // đỏ thì cái đang chặn là lớp TÌNH CỜ của vòng trước, không phải bản vá của vòng này.
    expect(d.pc, "app_current_org_id() phải VẪN chưa ghim search_path (trạng thái hôm nay)").toBeNull();
    const trongPhien = await withTenant(poolThuDich, orgP, async (c) =>
      (
        await c.query<{ v: string | null }>(
          "SELECT public.app_current_org_id()::pg_catalog.text AS v",
        )
      ).rows[0]!.v,
    );
    expect(trongPhien, "app_current_org_id() phải VẪN trả đúng tổ chức đang gắn").toBe(orgP);
  }, 120_000);

  it("[INV-M5] exportChainHead KHÔNG đúc được mốc neo mang nhãn tổ chức khác", async () => {
    await expect(
      withTenant(poolThuDich, orgP, (c) => exportChainHead(c, orgQ)),
    ).rejects.toThrow(/exportChainHead: phiên đang gắn tổ chức/);
  }, 120_000);

  it("[INV-M5] verifyAuditChain KHÔNG phán xét được sổ của tổ chức khác", async () => {
    await expect(
      withTenant(poolThuDich, orgP, (c) => verifyAuditChain(c, orgQ, { externalAnchors: [] })),
    ).rejects.toThrow(/verifyAuditChain: phiên đang gắn tổ chức/);
  }, 120_000);

  it("[INV-M5] recordChainAnchor KHÔNG neo được sổ của tổ chức khác", async () => {
    await expect(
      withTenant(poolThuDich, orgP, (c) => recordChainAnchor(c, orgQ)),
    ).rejects.toThrow(/recordChainAnchor: phiên đang gắn tổ chức/);
  }, 120_000);

  it("đúng tổ chức thì hàng rào KHÔNG chặn — đối chứng dương, chống hàng rào luôn-ném", async () => {
    const xuat = await withTenant(poolThuDich, orgP, (c) => exportChainHead(c, orgP));
    expect(xuat?.orgId).toBe(orgP);
    expect(xuat?.seq, "sổ của P có ĐÚNG 3 hàng — số này khoá luôn phép đo cross-tenant ở trên").toBe(3);
  }, 120_000);

  it("phiên CHƯA gắn tổ chức vẫn ném, và thông báo vẫn giữ thông tin `chưa gắn`", async () => {
    const c = await poolThuDich.connect();
    try {
      // KHÔNG đi qua withTenant: đây đúng là ca "quên withTenant" mà hàng rào sinh ra để bắt.
      await expect(exportChainHead(c, orgP)).rejects.toThrow(/chưa gắn — app\.org_id trống/);
    } finally {
      c.release();
    }
  }, 120_000);

  it("TRỤC TÊN KIỂU (1): MIỀN TRỊ bóng KHÔNG lật được phán xét — một trong năm hình dạng", async () => {
    const c = await poolThuDich.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [orgP]);
      const { rows } = await c.query<{ ghim: boolean; tran: boolean; cu: boolean }>(
        `SELECT (public.app_current_org_id()
                 OPERATOR(pg_catalog.=) $1::pg_catalog.uuid) IS TRUE AS ghim,
                (public.app_current_org_id() OPERATOR(pg_catalog.=) $1::uuid) IS TRUE AS tran,
                (public.app_current_org_id() IS NOT DISTINCT FROM $1::uuid) AS cu`,
        [orgQ],
      );
      // Câu ĐANG DÙNG: đúng.
      expect(rows[0]!.ghim, "câu đã vá phán xét SAI").toBe(false);
      // [vòng fix 3 — MỤC 1] Ý NGHĨA CỦA VẾ NÀY ĐÃ ĐƯỢC HẠ XUỐNG. Vòng fix 2 đọc nó là "trục
      // tên kiểu là GHIM theo QT2, không phải vá một lỗ đã đo" — MỘT TỔNG QUÁT HOÁ TỪ MỘT MẪU,
      // và nó SAI: xem test `TRỤC TÊN KIỂU (2)` ngay dưới, hình dạng ENUM + CAST IMPLICIT LẬT
      // ĐƯỢC phán xét. Vế này nay chỉ phát biểu về ĐÚNG hình dạng MIỀN TRỊ: miền trị không
      // biến đổi được giá trị và `OPERATOR(pg_catalog.=)` vẫn áp được cho nó (khả ép nhị
      // phân), nên riêng hình dạng ấy fail-closed.
      expect(
        rows[0]!.tran,
        "hình dạng MIỀN TRỊ đã đổi hành vi — đọc lại cả năm hình dạng trong docblock",
      ).toBe(false);
      // Và câu CŨ, chạy ngay cạnh: SAI. Đây là bằng chứng sống của chính lỗ vừa đóng.
      expect(rows[0]!.cu, "`IS NOT DISTINCT FROM` KHÔNG còn bị cướp — phép đo rỗng ruột").toBe(true);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  }, 120_000);

  it("TRỤC TÊN KIỂU (2): ENUM + CAST IMPLICIT LẬT ĐƯỢC phán xét — `::pg_catalog.uuid` là VÁ", async () => {
    // MỐC CHẾT cho hai mũi đột biến mà 464 test của vòng trước KHÔNG thấy:
    //   gỡ `pg_catalog.` ở tên kiểu của tenant-guard.ts        -> hàng rào KHÔNG ném
    //   + gỡ tiếp ở exportChainHead                            -> {"orgId":<orgQ>,"seq":3}
    // Khai thác này KHÔNG cướp một toán tử nào — vế `eq_tran` dưới đây chứng minh điều đó.
    const c = await poolTenKieu.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [orgP]);
      const { rows } = await c.query<{
        sp: string;
        dang_gan: string | null;
        eq_tran: boolean;
        ten_kieu_tran: boolean;
        ten_kieu_ghim: boolean;
      }>(
        `SELECT pg_catalog.current_setting('search_path') AS sp,
                public.app_current_org_id()::pg_catalog.text AS dang_gan,
                ('11111111-1111-1111-1111-111111111111'::pg_catalog.uuid
                 = '22222222-2222-2222-2222-222222222222'::pg_catalog.uuid) AS eq_tran,
                (public.app_current_org_id()
                 OPERATOR(pg_catalog.=) $1::uuid) IS TRUE AS ten_kieu_tran,
                (public.app_current_org_id()
                 OPERATOR(pg_catalog.=) $2::pg_catalog.uuid) IS TRUE AS ten_kieu_ghim`,
        // HAI tham số RIÊNG cho CÙNG một giá trị, và đó KHÔNG phải thừa. Nếu dùng chung `$1`,
        // Postgres suy kiểu tham số từ lần dùng ĐẦU (`$1::uuid` -> `gia.uuid`), rồi
        // `$1::pg_catalog.uuid` trở thành phép ép TƯỜNG MINH từ `gia.uuid` — vẫn chạy hàm của
        // kẻ tấn công, và vế "đã ghim" cũng cho `true`. Tự vấp phải khi viết bản đầu của test
        // này. Mã sản phẩm KHÔNG có hình dạng đó: ở đó `$1` chỉ xuất hiện MỘT lần, dưới tên
        // kiểu đã ghim, nên nó được suy thành `pg_catalog.uuid` ngay từ đầu.
        [orgQ, orgQ],
      );
      const d = rows[0]!;
      expect(d.sp).toBe("gia, pg_catalog, public");
      // TIỀN ĐỀ 1: `app_current_org_id()` VẪN ĐÚNG. Thân hàm nó đã ghim `::pg_catalog.uuid` từ
      // 001, nên lớp phòng thủ TÌNH CỜ "hàm sập về NULL" KHÔNG kích hoạt ở đây.
      expect(d.dang_gan, "app_current_org_id() phải VẪN trả đúng tổ chức đang gắn").toBe(orgP);
      // TIỀN ĐỀ 2 (SINH TỬ): KHÔNG cướp toán tử nào. Nếu vế này `true` thì phép đo đang đo lại
      // trục TOÁN TỬ của vòng fix 2 chứ không đo trục TÊN KIỂU.
      expect(d.eq_tran, "`=` của uuid BỊ CƯỚP — phép đo đang đo nhầm trục").toBe(false);
      // TIỀN ĐỀ 3: fixture THẬT SỰ tấn công được. Nếu vế này `false` thì mọi kết luận dưới đây
      // rỗng ruột — đúng lớp khiếm khuyết mà vòng fix 2 mắc phải.
      expect(
        d.ten_kieu_tran,
        "tên kiểu TRẦN không lật được phán xét — fixture rỗng ruột, đừng kết luận gì từ nó",
      ).toBe(true);
      // Câu ĐANG DÙNG: đúng.
      expect(d.ten_kieu_ghim, "câu đã ghim tên kiểu phán xét SAI").toBe(false);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }

    // MỐC CHẾT trên MÃ SẢN PHẨM, đi qua đúng ba hàm mà `assertTenantBound` canh.
    await expect(
      withTenant(poolTenKieu, orgP, (cl) => exportChainHead(cl, orgQ)),
    ).rejects.toThrow(/exportChainHead: phiên đang gắn tổ chức/);
    await expect(
      withTenant(poolTenKieu, orgP, (cl) => verifyAuditChain(cl, orgQ, { externalAnchors: [] })),
    ).rejects.toThrow(/verifyAuditChain: phiên đang gắn tổ chức/);
    await expect(
      withTenant(poolTenKieu, orgP, (cl) => recordChainAnchor(cl, orgQ)),
    ).rejects.toThrow(/recordChainAnchor: phiên đang gắn tổ chức/);

    // ĐỐI CHỨNG DƯƠNG — chống một hàng rào luôn-ném dưới schema này.
    const xuat = await withTenant(poolTenKieu, orgP, (cl) => exportChainHead(cl, orgP));
    expect(xuat?.orgId).toBe(orgP);
    expect(xuat?.seq, "sổ của P có ĐÚNG 3 hàng").toBe(3);
  }, 180_000);

  it("[INV-M5] phiên BYPASSRLS: vế `WHERE` là lớp DUY NHẤT giới hạn tập hàng", async () => {
    // [vòng fix 3 — MỤC 2] Ba chỗ trong gói này từng viết "RLS đã giới hạn tập hàng về đúng tổ
    // chức đang gắn, nên một `=` bị cướp ở đó KHÔNG mở rộng tập hàng ra ngoài tổ chức" — một
    // PHÁT BIỂU VÔ ĐIỀU KIỆN, và nó SAI với phiên `rolsuper`/`rolbypassrls`: phiên của người
    // vận hành chạy công cụ kiểm toán bằng tay, và của chính `db.pool` mà test-support cấp.
    // Test này là MỐC CHẾT cho ba mũi từng SỐNG SÓT (gỡ ghim ở `WHERE ae.org_id` của truy vấn
    // chuỗi, ở `recordChainAnchor`, ở `exportChainHead`).
    const c = await poolSieu.connect();
    try {
      const { rows: ho } = await c.query<{ sieu: boolean; bo_qua: boolean; sp: string }>(
        `SELECT r.rolsuper AS sieu, r.rolbypassrls AS bo_qua,
                pg_catalog.current_setting('search_path') AS sp
           FROM pg_catalog.pg_roles r
          WHERE r.rolname OPERATOR(pg_catalog.=) CURRENT_USER`,
      );
      expect(ho[0]!.sieu, "phiên đo phải THẬT SỰ là superuser").toBe(true);
      expect(ho[0]!.sp).toBe("doc, pg_catalog, public");
    } finally {
      c.release();
    }

    // FIXTURE TỰ CHỨNG MINH: (a) RLS thật sự KHÔNG chặn gì trên phiên này, (b) `=` của uuid
    // thật sự bị cướp. Không có (a) thì phép đo chỉ lặp lại test cũ; không có (b) thì nó rỗng.
    const bc = await withTenant(poolSieu, orgP, async (cl) => {
      const { rows } = await cl.query<{ tong: string; cua_p: string; eq: boolean }>(
        `SELECT (SELECT pg_catalog.count(*) FROM public.audit_events)::pg_catalog.text AS tong,
                (SELECT pg_catalog.count(*) FROM public.audit_events ae
                  WHERE ae.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
                )::pg_catalog.text AS cua_p,
                ('11111111-1111-1111-1111-111111111111'::pg_catalog.uuid
                 = '22222222-2222-2222-2222-222222222222'::pg_catalog.uuid) AS eq`,
        [orgP],
      );
      return rows[0]!;
    });
    expect(bc.eq, "`=` của uuid KHÔNG bị cướp — phép đo rỗng ruột").toBe(true);
    expect(
      bc.tong,
      "phiên này VẪN chịu RLS (thấy đúng sổ của P) — phép đo rỗng ruột, nó không đo BYPASSRLS",
    ).toBe("10");
    expect(bc.cua_p, "vế WHERE đã ghim phải cắt 10 hàng xuống đúng 3").toBe("3");

    // MỐC CHẾT 1 — truy vấn chuỗi của verifyAuditChain. Gỡ ghim ở đó: checked = 3 + 7 = 10.
    const ketQua = await withTenant(poolSieu, orgP, (cl) =>
      verifyAuditChain(cl, orgP, { externalAnchors: [] }),
    );
    expect(
      ketQua.checked,
      "tập hàng TRÀN RA NGOÀI TỔ CHỨC — vế WHERE của truy vấn chuỗi mất ghim",
    ).toBe(3);

    // MỐC CHẾT 2 — exportChainHead. Gỡ ghim ở đó: seq 7 (đầu chuỗi của Q) dán nhãn P.
    const xuat = await withTenant(poolSieu, orgP, (cl) => exportChainHead(cl, orgP));
    expect(xuat?.orgId).toBe(orgP);
    expect(xuat?.seq, "xuất ra đầu chuỗi của tổ chức KHÁC dưới nhãn P").toBe(3);

    // MỐC CHẾT 3 — recordChainAnchor. Gỡ ghim ở đó: hàng thắng ORDER BY là hàng của Q, nên câu
    // `SELECT ae.org_id` GHI một mốc neo dưới nhãn tổ chức Q.
    const neo = await withTenant(poolSieu, orgP, (cl) => recordChainAnchor(cl, orgP));
    expect(neo?.seq, "neo sai đầu chuỗi — vế WHERE của recordChainAnchor mất ghim").toBe(3);
    const { rows: kt } = await db.pool.query<{ p: string; q: string }>(
      `SELECT pg_catalog.count(*) FILTER (WHERE a.org_id OPERATOR(pg_catalog.=)
                $1::pg_catalog.uuid)::pg_catalog.text AS p,
              pg_catalog.count(*) FILTER (WHERE a.org_id OPERATOR(pg_catalog.=)
                $2::pg_catalog.uuid)::pg_catalog.text AS q
         FROM public.audit_chain_anchors a`,
      [orgP, orgQ],
    );
    expect(kt[0]!.p, "mốc neo của P phải được ghi").toBe("1");
    expect(kt[0]!.q, "một mốc neo mang nhãn tổ chức Q vừa bị ĐÚC từ lời gọi của P").toBe("0");
  }, 180_000);

  it("[INV-B3] vế phát hiện CẮT ĐUÔI vẫn báo ANCHOR_MISSING dưới `=` bị cướp", async () => {
    // Lỗ ĐO ĐƯỢC mà việc ghim toán tử ở verifier.ts vá thật (khác với các vế chỉ là ghim): với
    // `=` bị cướp cho uuid/bigint/bytea, `NOT EXISTS (... ae.seq = a.seq AND ae.hash = a.hash)`
    // luôn cho FALSE, nên ANCHOR_MISSING không bao giờ được báo và bộ kiểm chứng trả `ok:true`
    // trên một sổ ĐÃ BỊ CẮT ĐUÔI. Đo trên chính phiên thù địch này:
    //     EXISTS(... org_id=$1) = EXISTS(... seq=999999) = EXISTS(... hash=decode('00','hex'))
    //       = EXISTS(cả ba)  ->  true, true, true, true
    const org = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('cat-duoi','cat-duoi') RETURNING id",
      )
    ).rows[0]!.id;
    await withTenant(db.pool, org, async (c) => {
      for (let i = 0; i < 6; i += 1) {
        await appendAuditEvent(c, org, {
          actorType: "SYSTEM",
          action: `D${i}`,
          resourceType: "TEST",
        });
      }
      expect((await recordChainAnchor(c, org))?.seq).toBe(6);
    });

    // FIXTURE tự chứng minh: dưới phiên thù địch, cả ba vế so của NOT EXISTS đều bị cướp.
    const cf = await poolThuDich.connect();
    try {
      await cf.query("BEGIN");
      await cf.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [org]);
      const { rows: bc } = await cf.query<{ e_org: boolean; e_seq: boolean; e_hash: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM public.audit_events ae WHERE ae.org_id = $1) AS e_org,
                EXISTS (SELECT 1 FROM public.audit_events ae
                         WHERE ae.seq = 999999::pg_catalog.int8) AS e_seq,
                EXISTS (SELECT 1 FROM public.audit_events ae
                         WHERE ae.hash = pg_catalog.decode('00','hex')) AS e_hash`,
        [org],
      );
      expect(bc[0]!.e_seq, "`=` của bigint KHÔNG bị cướp — phép đo rỗng ruột").toBe(true);
      expect(bc[0]!.e_hash, "`=` của bytea KHÔNG bị cướp — phép đo rỗng ruột").toBe(true);
      expect(bc[0]!.e_org, "`=` của uuid KHÔNG bị cướp — phép đo rỗng ruột").toBe(true);
      await cf.query("ROLLBACK");
    } finally {
      cf.release();
    }

    // Cắt đuôi THẬT.
    await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete");
    try {
      const { rowCount } = await db.pool.query(
        "DELETE FROM audit_events WHERE org_id = $1 AND seq > 4",
        [org],
      );
      expect(rowCount).toBe(2);
    } finally {
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_delete");
      const { rows: tg } = await db.pool.query<{ tgenabled: string }>(
        "SELECT t.tgenabled FROM pg_trigger t WHERE t.tgrelid = 'audit_events'::regclass " +
          "  AND t.tgname = 'audit_events_chan_delete'",
      );
      expect(tg[0]!.tgenabled, "trigger phải trở lại ENABLE ALWAYS").toBe("A");
    }

    const ketQua = await withTenant(poolThuDich, org, (c) =>
      verifyAuditChain(c, org, { externalAnchors: [] }),
    );
    expect(ketQua.checked).toBe(4);
    expect(
      ketQua.problems.some((p) => p.seq === 6 && p.kind === "ANCHOR_MISSING"),
      "bộ kiểm chứng KHÔNG thấy lần cắt đuôi dưới `=` bị cướp — fail-OPEN",
    ).toBe(true);
    expect(ketQua.ok).toBe(false);
  }, 180_000);

  it("[INV-B2] vế `ae.hash` của mốc neo vẫn bắt được SỬA NỘI DUNG dưới `=` bị cướp", async () => {
    // Mốc chết RIÊNG của vế `ae.hash OPERATOR(pg_catalog.=) a.hash`. Test cắt đuôi ở trên KHÔNG
    // giết được mũi "bỏ OPERATOR khỏi ae.hash": ở đó vế `ae.seq` (còn ghim) đã đủ phán xét, vì
    // hàng seq=6 KHÔNG CÒN. Ca phân biệt được hai vế là ca hàng VẪN CÒN nhưng NỘI DUNG ĐÃ ĐỔI —
    // khi đó chỉ `ae.hash` nói lên sự thật. Đo được: với `=` của bytea bị cướp và vế đó viết
    // trần, `ANCHOR_MISSING` KHÔNG được báo và bộ kiểm chứng cho ra `problems: []`.
    const org = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ('sua-noi-dung','sua-noi-dung') RETURNING id",
      )
    ).rows[0]!.id;
    await withTenant(db.pool, org, async (c) => {
      for (let i = 0; i < 4; i += 1) {
        await appendAuditEvent(c, org, {
          actorType: "SYSTEM",
          action: `S${i}`,
          resourceType: "TEST",
        });
      }
      expect((await recordChainAnchor(c, org))?.seq).toBe(4);
    });
    const truocKhiSua = (
      await db.pool.query<{ hash: Buffer }>(
        "SELECT hash FROM audit_events WHERE org_id = $1 AND seq = 4",
        [org],
      )
    ).rows[0]!.hash;

    // Sửa nội dung hàng cuối RỒI TÍNH LẠI BĂM cho chuỗi tự nó vẫn khớp — đúng cú tấn công mà
    // chỉ mốc neo mới bắt được. `${org}` nội suy là an toàn: nó là uuid do chính DB sinh ra.
    await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_update");
    try {
      await db.pool.query(
        `DO $$
         DECLARE r RECORD; truoc bytea;
         BEGIN
           SELECT ae.hash INTO truoc FROM audit_events ae
            WHERE ae.org_id = '${org}'::uuid AND ae.seq = 3;
           FOR r IN SELECT * FROM audit_events ae
                     WHERE ae.org_id = '${org}'::uuid AND ae.seq >= 4 ORDER BY ae.seq LOOP
             UPDATE audit_events
                SET action = 'DA_BI_SUA', prev_hash = truoc,
                    hash = public.audit_compute_hash(truoc, r.id, r.org_id, r.seq, r.occurred_at,
                             r.actor_type, r.actor_id, 'DA_BI_SUA', r.resource_type, r.resource_id,
                             r.payload, r.request_id, r.ip, r.user_agent)
              WHERE id = r.id
              RETURNING hash INTO truoc;
           END LOOP;
         END $$`,
      );
    } finally {
      await db.pool.query("ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_chan_update");
    }
    const sauKhiSua = (
      await db.pool.query<{ hash: Buffer; action: string }>(
        "SELECT hash, action FROM audit_events WHERE org_id = $1 AND seq = 4",
        [org],
      )
    ).rows[0]!;
    expect(sauKhiSua.action, "fixture phải THẬT SỰ sửa được").toBe("DA_BI_SUA");
    expect(
      sauKhiSua.hash.equals(truocKhiSua),
      "băm phải ĐỔI, nếu không thì vế `ae.hash` không phân biệt được gì",
    ).toBe(false);

    const ketQua = await withTenant(poolThuDich, org, (c) =>
      verifyAuditChain(c, org, { externalAnchors: [] }),
    );
    expect(ketQua.checked, "chuỗi vẫn đủ 4 hàng — đây KHÔNG phải ca cắt đuôi").toBe(4);
    expect(
      ketQua.problems.some((p) => p.seq === 4 && p.kind === "ANCHOR_MISSING"),
      "mốc neo trong DB KHÔNG bắt được lần sửa nội dung dưới `=` bị cướp — fail-OPEN",
    ).toBe(true);
    expect(ketQua.ok).toBe(false);
  }, 180_000);
});
