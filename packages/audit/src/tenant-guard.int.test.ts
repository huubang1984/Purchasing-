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
  // Trục TÊN KIỂU: hai miền trị bóng đứng TRƯỚC pg_catalog. Xem docblock của tenant-guard.ts —
  // trục này KHÔNG cho ra dương tính giả, và có mốc đo riêng ở dưới để câu đó không trôi.
  await db.pool.query("CREATE DOMAIN doc.uuid AS pg_catalog.uuid");
  await db.pool.query("CREATE DOMAIN doc.text AS pg_catalog.text");
  await db.pool.query("CREATE ROLE app_api_login LOGIN PASSWORD 'mk' IN ROLE app_api");
  await db.pool.query("ALTER ROLE app_api_login SET search_path = doc, pg_catalog, public");

  const url = new URL(db.connectionString);
  url.username = "app_api_login";
  url.password = "mk";
  poolThuDich = createPool(url.toString(), 3);
}, 300_000);

afterAll(async () => {
  await poolThuDich?.end().catch(() => {});
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

  it("TRỤC TÊN KIỂU: miền trị bóng KHÔNG lật được phán xét (ghim, không phải vá)", async () => {
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
      // Cùng câu đó với tên kiểu TRẦN: vẫn đúng => trục tên kiểu là GHIM theo QT2, không phải
      // vá một lỗ đã đo. Chú thích của tenant-guard.ts nói đúng mức đó, và vế này khoá nó lại.
      expect(rows[0]!.tran, "trục tên kiểu ĐÃ thành khai thác được — cập nhật lại chú thích").toBe(
        false,
      );
      // Và câu CŨ, chạy ngay cạnh: SAI. Đây là bằng chứng sống của chính lỗ vừa đóng.
      expect(rows[0]!.cu, "`IS NOT DISTINCT FROM` KHÔNG còn bị cướp — phép đo rỗng ruột").toBe(true);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  }, 120_000);

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
