import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Bản sao TypeScript của `BANG_CHI_GHI_THEM` trong db/migrations/hardening.always.sql — tập
 * ĐÓNG các bảng sổ chỉ-ghi-thêm mà hardening phải phục hồi trigger cho.
 *
 * Vì sao là danh sách viết tay chứ không phải suy ra tự động (đã cân nhắc và loại bỏ ba cách):
 *   - "bảng có cột hash/prev_hash": Task 6-10 gần như chắc chắn có bảng báo giá mang hash mà
 *     VẪN cần UPDATE. Suy sai theo hướng đó là chặn deploy trên một lược đồ hợp lệ — đúng cái
 *     bẫy QT1 mà hardening đã phải gỡ hai lần.
 *   - "bảng có COMMENT mang nhãn": nhãn do CHÍNH tác nhân đang bị canh sửa được, nên nó là mốc
 *     fail-open — gỡ nhãn là gỡ luôn việc canh.
 *   - "bảng đang có trigger chan_sua_xoa()": có dùng, nhưng KHÔNG đủ một mình — nó chính là thứ
 *     đang bị canh. Trong hardening nó được HỢP với danh sách này: mất một trigger thì hai
 *     trigger còn lại vẫn lộ ra bảng, mất cả ba thì danh sách này lộ ra.
 * Đúng khuôn BANG_GOC_TENANT của Task 3-4: danh sách đóng, nhân bản có kiểm soát, có meta-test
 * canh sự đồng bộ (bên dưới) nên sửa một bên mà quên bên kia là ĐỎ.
 */
const BANG_CHI_GHI_THEM = ["audit_chain_anchors", "audit_events"];

/**
 * Ba trigger bắt buộc trên MỖI bảng sổ, kèm giá trị `pg_trigger.tgtype` tương ứng. tgtype là
 * một bitmask (ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32) — đã đo trên
 * PostgreSQL 16.15 chứ không tra tài liệu:
 *   BEFORE UPDATE   FOR EACH ROW       -> 19 = 1|2|16
 *   BEFORE DELETE   FOR EACH ROW       -> 11 = 1|2|8
 *   BEFORE TRUNCATE FOR EACH STATEMENT -> 34 =   2|32
 */
const TRIGGER_BAT_BUOC: readonly [string, number][] = [
  ["update", 19],
  ["delete", 11],
  ["truncate", 34],
];

/** Quyền GHI trên bảng: ba quyền không role nào (ngoài chủ sở hữu) được có trên bảng sổ. */
const QUYEN_GHI_BI_CAM = ["UPDATE", "DELETE", "TRUNCATE"];

/**
 * [vòng fix 1 — IM1] GÓC MÙ THỨ BA: vai trò ĐỊNH SẴN của PostgreSQL.
 *
 * Task 4 học rằng `information_schema.role_table_grants` mù với quyền CỘT, và Task 5 thay nó
 * bằng `relacl` + `attacl`. Đo lại trên PostgreSQL 16.15 thì bản thay thế cũng có một góc mù,
 * chỉ là góc khác:
 *   has_table_privilege('pg_write_all_data', 'audit_events', 'UPDATE')       -> true
 *   has_table_privilege('pg_write_all_data', 'audit_events', 'DELETE')       -> true
 *   has_any_column_privilege('pg_write_all_data','audit_events','UPDATE')    -> true (15/15 cột)
 *   has_table_privilege('pg_write_all_data', 'audit_events', 'TRUNCATE')     -> FALSE
 *   aclexplode(relacl) UNION aclexplode(attacl)                              -> 0 DÒNG
 * Quyền của vai trò định sẵn KHÔNG được lưu trong ACL, nên MỌI phép đọc ACL đều mù với nó.
 *
 * Cách xử: KHÔNG thu hẹp tên test, mà mở rộng phép kiểm sang has_table_privilege /
 * has_any_column_privilege trên toàn bộ pg_roles, và giữ ĐÚNG MỘT ngoại lệ có tên. Hệ quả có
 * ích ngay: "GRANT pg_write_all_data TO app_api" nay làm phép kiểm này ĐỎ (app_api không nằm
 * trong danh sách ngoại lệ), tức nó phủ cả đường leo quyền qua tư cách thành viên.
 *
 * Vì sao KHÔNG thu hồi được: quyền của vai trò định sẵn là mã cứng trong PostgreSQL, không có
 * ACL để REVOKE. Vì sao KHÔNG đưa vào hardening: một cụm có role khác được cấp
 * pg_write_all_data (chuyện của quản trị cụm, không của database này) sẽ bị chặn deploy VĨNH
 * VIỄN mà không có đường sửa từ trong database — đúng cái bẫy QT1. Bất biến B4 KHÔNG vỡ vì
 * lớp A vẫn chặn: xem test "thành viên pg_write_all_data ... vẫn bị lớp A chặn" bên dưới.
 */
const VAI_TRO_DINH_SAN_DUOC_MIEN = ["pg_write_all_data"];

/**
 * Quyền HIỆU DỤNG (has_*_privilege) thay vì quyền ĐƯỢC GHI TRONG ACL. Nó tính cả quyền đến qua
 * PUBLIC, qua tư cách thành viên, và qua vai trò định sẵn — ba đường mà đọc ACL không thấy.
 * Loại chủ sở hữu bảng và mọi superuser: cả hai có tất cả theo định nghĩa, không phải phát hiện.
 */
const CAU_QUYEN_HIEU_DUNG =
  "SELECT c.relname AS bang, r.rolname AS grantee, NULL::text AS cot, q.quyen " +
  "  FROM pg_class c " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  "  CROSS JOIN pg_roles r " +
  "  CROSS JOIN LATERAL (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) q(quyen) " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) " +
  "   AND r.oid <> c.relowner AND NOT r.rolsuper " +
  "   AND has_table_privilege(r.oid, c.oid, q.quyen) " +
  "UNION ALL " +
  "SELECT c.relname, r.rolname, '<một cột bất kỳ>', 'UPDATE' " +
  "  FROM pg_class c " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  "  CROSS JOIN pg_roles r " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) " +
  "   AND r.oid <> c.relowner AND NOT r.rolsuper " +
  "   AND has_any_column_privilege(r.oid, c.oid, 'UPDATE') " +
  "   AND NOT has_table_privilege(r.oid, c.oid, 'UPDATE') " +
  " ORDER BY 1, 2, 3, 4";

/**
 * [vòng fix 1 — CR1] Trigger và RULE LẠ trên bảng sổ. Không có phép kiểm nào ở vòng trước hỏi
 * "bảng sổ có trigger nào NGOÀI sáu cái đã biết không" hay "có pg_rewrite nào không" — và đó là
 * đường xoá audit VỀ TƯƠNG LAI: một "BEFORE INSERT ... RETURN NULL" nuốt đúng sự kiện nó chọn
 * và để lại chuỗi hash LIỀN MẠCH MÀ THIẾU SỰ KIỆN, nên bộ kiểm chứng của Task 6 sẽ báo HỢP LỆ.
 */
const CAU_TRIGGER_RULE_LA =
  "SELECT c.relname || '.' || t.tgname AS ten FROM pg_trigger t " +
  "  JOIN pg_class c ON c.oid = t.tgrelid " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT t.tgisinternal " +
  "   AND t.tgname <> ALL($2) " +
  "UNION ALL " +
  "SELECT c.relname || '.' || rw.rulename FROM pg_rewrite rw " +
  "  JOIN pg_class c ON c.oid = rw.ev_class " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) AND rw.rulename <> '_RETURN' " +
  " ORDER BY 1";

interface HangQuyen {
  bang: string;
  grantee: string;
  cot: string | null;
  quyen: string;
}

/**
 * [cạm bẫy 1] Quyền trên bảng sổ đọc THẲNG từ catalog (`pg_class.relacl` +
 * `pg_attribute.attacl`) chứ KHÔNG qua `information_schema.role_table_grants`.
 *
 * Đo trên PostgreSQL 16.15 vì sao view kia không dùng được cho ĐÚNG bất biến này:
 *   GRANT UPDATE (payload) ON audit_events TO app_api
 *     -> role_table_grants: KHÔNG có dòng nào  (view chỉ biết quyền MỨC BẢNG)
 *     -> relacl:            không đổi
 *     -> attacl của cột payload: {app_api=w/postgres}   <- chỗ DUY NHẤT nhìn thấy
 * (Phát biểu trong bản brief rằng "GRANT UPDATE ON audit_events TO PUBLIC không xuất hiện ở
 * role_table_grants" thì SAI — đã đo, nó xuất hiện với grantee='PUBLIC'. Góc mù thật của bản
 * brief là mệnh đề "grantee IN ('app_api','app_unseal')" trong chính câu truy vấn của nó, cộng
 * với việc view mù hẳn với quyền cột.)
 *
 * `coalesce(relacl, acldefault('r', relowner))` là bắt buộc: relacl = NULL nghĩa là ACL mặc
 * định của PostgreSQL (chủ sở hữu có tất cả), không phải "không ai có gì".
 */
const CAU_QUYEN_BANG_SO =
  "SELECT c.relname AS bang, coalesce(r.rolname::text, 'PUBLIC') AS grantee, " +
  "       NULL::text AS cot, a.privilege_type AS quyen " +
  "  FROM pg_class c " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  "  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a " +
  "  LEFT JOIN pg_roles r ON r.oid = a.grantee " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) AND a.grantee <> c.relowner " +
  "UNION ALL " +
  "SELECT c.relname, coalesce(r.rolname::text, 'PUBLIC'), att.attname, a.privilege_type " +
  "  FROM pg_class c " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  "  JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped " +
  "  CROSS JOIN LATERAL aclexplode(att.attacl) a " +
  "  LEFT JOIN pg_roles r ON r.oid = a.grantee " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) AND a.grantee <> c.relowner " +
  " ORDER BY 1, 2, 3, 4";

interface HangTrigger {
  bang: string;
  ten_trigger: string;
  tgtype: number;
  tgenabled: string;
  co_when: boolean;
  cot_giam: string;
  ham: string;
}

// Tên hàm dựng từ pg_proc + regnamespace, KHÔNG dùng `tgfoid::regprocedure::text`. Đã tự vấp:
// regprocedure BỎ tên schema khi schema đó nằm trong search_path của phiên đang đọc, nên cùng
// một trigger cho ra "app_private.chan_sua_xoa()" hay "chan_sua_xoa()" tuỳ cấu hình phiên —
// đúng lớp phụ thuộc search_path mà QT3 và bản vá CR1-v2 của Task 4 đã phải xử một lần.
const CAU_TRIGGER =
  "SELECT c.relname AS bang, t.tgname AS ten_trigger, t.tgtype::int AS tgtype, " +
  "       t.tgenabled::text AS tgenabled, (t.tgqual IS NOT NULL) AS co_when, " +
  "       t.tgattr::text AS cot_giam, " +
  "       p.pronamespace::regnamespace::text || '.' || p.proname || '()' AS ham " +
  "  FROM pg_trigger t " +
  "  JOIN pg_class c ON c.oid = t.tgrelid " +
  "  JOIN pg_namespace n ON n.oid = c.relnamespace " +
  "  JOIN pg_proc p ON p.oid = t.tgfoid " +
  " WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT t.tgisinternal " +
  " ORDER BY 1, 2";

const BAM_0 = "decode(repeat('00', 32), 'hex')";

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;
let orgB: string;

/** Ghi một sự kiện bằng quyền chủ sở hữu (bỏ qua RLS) — dùng để dựng dữ liệu nền. */
async function ghiSuKien(pOrgId: string, pSeq: number): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
      `VALUES ($1, $2, 'SYSTEM', 'TEST', 'TEST', ${BAM_0}, sha256($3::bytea)) RETURNING id`,
    [pOrgId, pSeq, `su-kien-${pOrgId}-${pSeq}`],
  );
  return rows[0]!.id;
}

/** Chạy một câu lệnh và trả về thông báo lỗi, hoặc chuỗi "THÀNH CÔNG" khi nó chạy lọt. */
async function thu(pPool: pg.Pool, pSql: string, pThamSo: unknown[] = []): Promise<string> {
  return pPool.query(pSql, pThamSo).then(
    () => "THÀNH CÔNG",
    (loi: Error) => loi.message,
  );
}

describe("sổ kiểm toán chỉ ghi thêm", () => {
  beforeAll(async () => {
    db = await startPostgres();
    await migrate(db.pool, MIGRATIONS_DIR);

    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
        "('Cong ty B', 'cong-ty-b') RETURNING id",
    );
    orgA = rows[0]!.id;
    orgB = rows[1]!.id;

    await ghiSuKien(orgA, 1);
    await ghiSuKien(orgB, 1);
    await ghiSuKien(orgB, 7);
    await db.pool.query(
      `INSERT INTO audit_chain_anchors (org_id, seq, hash) VALUES ($1, 1, sha256('neo'::bytea))`,
      [orgA],
    );

    apiPool = db.poolAs("app_api");
    unsealPool = db.poolAs("app_unseal");
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  // ==========================================================================================
  // LỚP 1 — TRIGGER. Lớp DUY NHẤT ràng buộc được cả chủ sở hữu bảng lẫn superuser.
  // ==========================================================================================
  it("[INV-B4] UPDATE trên audit_events bị từ chối kể cả dưới chủ sở hữu bảng là superuser", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "SELECT id FROM audit_events WHERE org_id = $1 AND seq = 1",
      [orgA],
    );
    await expect(
      db.pool.query("UPDATE audit_events SET action = 'SUA_TROM' WHERE id = $1", [rows[0]!.id]),
    ).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);

    // Không rỗng ruột: hàng vẫn còn nguyên nội dung cũ.
    const sau = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE id = $1",
      [rows[0]!.id],
    );
    expect(sau.rows[0]!.action).toBe("TEST");
  });

  it("[INV-B4] DELETE trên audit_events bị từ chối kể cả dưới chủ sở hữu bảng là superuser", async () => {
    const truoc = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events");
    await expect(
      db.pool.query("DELETE FROM audit_events WHERE org_id = $1", [orgA]),
    ).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);
    const sau = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events");
    expect(sau.rows[0]!.n).toBe(truoc.rows[0]!.n);
  });

  it("[INV-B3] TRUNCATE audit_events bị chặn — cắt đuôi chuỗi không im lặng được", async () => {
    await expect(db.pool.query("TRUNCATE audit_events")).rejects.toThrow(
      /chỉ-ghi-thêm|append-only/i,
    );
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  // Mốc neo là thứ phát hiện việc cắt đuôi chuỗi (ADR-004). Một bảng mốc neo SỬA/XOÁ được thì
  // kẻ cắt đuôi chỉ cần sửa luôn mốc neo — nên nó phải chỉ-ghi-thêm y hệt sổ chính.
  it("[INV-B3] audit_chain_anchors cũng chỉ-ghi-thêm: UPDATE, DELETE, TRUNCATE đều bị từ chối", async () => {
    for (const cau of [
      "UPDATE audit_chain_anchors SET seq = 99",
      "DELETE FROM audit_chain_anchors",
      "TRUNCATE audit_chain_anchors",
    ]) {
      await expect(db.pool.query(cau), cau).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);
    }
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_chain_anchors",
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  // ==========================================================================================
  // [cạm bẫy 5] session_replication_role = replica — GUC làm vô hiệu một bảo đảm
  // ==========================================================================================
  // Đã đo trên PostgreSQL 16.15:
  //   * `session_replication_role` là GUC mức SUSET: app_api_login, app_api và cả role deploy
  //     (CREATEROLE + chủ sở hữu database, KHÔNG superuser) đều nhận "permission denied to set
  //     parameter". NHƯNG một "GRANT SET ON PARAMETER session_replication_role TO app_api"
  //     (PG15+) mở được cửa đó cho role thường — đã đo là chạy.
  //   * Với trigger ORIGIN (mặc định, tgenabled='O'), replica mode BỎ QUA cả ba trigger:
  //     UPDATE 1, DELETE 1, TRUNCATE TABLE, bảng còn 0 hàng.
  //   * Với ENABLE ALWAYS (tgenabled='A') thì KHÔNG: cả ba lệnh đều bị RAISE chặn.
  // Cách vá theo QT2 — GHIM cấu hình mà bảo đảm phụ thuộc vào (ENABLE ALWAYS), thay vì đi
  // canh xem ai đặt được GUC đó (NỚI ra rồi vá từng đường).
  it("[INV-B4] session_replication_role = replica KHÔNG vô hiệu hoá được trigger chỉ-ghi-thêm", async () => {
    // (a) CHỨNG MINH FIXTURE THẬT SỰ TẤN CÔNG ĐƯỢC: cùng một phiên, cùng replica mode, một
    // trigger ORIGIN trên bảng đối chứng BỊ BỎ QUA. Không có nửa này, một phiên replica không
    // có tác dụng gì (vd. GUC không đặt được) cũng cho ra "đỏ = an toàn" giả.
    const doiChung = await db.pool.connect();
    let ketQuaDoiChung: string;
    try {
      await doiChung.query("BEGIN");
      await doiChung.query("CREATE TABLE doi_chung (id int PRIMARY KEY, v text)");
      await doiChung.query(
        "CREATE TRIGGER doi_chung_chan BEFORE UPDATE ON doi_chung FOR EACH ROW " +
          "EXECUTE FUNCTION public.chan_sua_xoa()",
      );
      await doiChung.query("INSERT INTO doi_chung VALUES (1, 'a')");
      await doiChung.query("SET LOCAL session_replication_role = replica");
      ketQuaDoiChung = await doiChung
        .query("UPDATE doi_chung SET v = 'b' WHERE id = 1")
        .then(() => "THÀNH CÔNG", (loi: Error) => loi.message);
    } finally {
      await doiChung.query("ROLLBACK");
      doiChung.release();
    }
    expect(
      ketQuaDoiChung,
      "fixture tự vô hiệu hoá: replica mode không bỏ qua nổi cả một trigger ORIGIN, nên phần " +
        "(b) bên dưới không chứng minh được gì.",
    ).toBe("THÀNH CÔNG");

    // (b) Cùng vũ khí đó nhắm vào bảng sổ: trigger ENABLE ALWAYS vẫn chặn.
    const keTanCong = await db.pool.connect();
    try {
      await keTanCong.query("SET session_replication_role = replica");
      for (const cau of [
        "UPDATE audit_events SET action = 'SUA_TROM'",
        "DELETE FROM audit_events",
        "TRUNCATE audit_events",
      ]) {
        const loi = await keTanCong
          .query(cau)
          .then(() => "THÀNH CÔNG", (e: Error) => e.message);
        expect(loi, cau).toMatch(/chỉ-ghi-thêm|append-only/i);
      }
    } finally {
      keTanCong.release(new Error("phiên replica — không trả về pool"));
    }

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events",
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  // ==========================================================================================
  // [cạm bẫy 4] Trigger tồn tại TẠI MỘT THỜI ĐIỂM — hình dạng của nó cũng phải bị khoá
  // ==========================================================================================
  // Bốn cách vô hiệu hoá một trigger mà KHÔNG xoá nó, đều đã đo chạy được trên PG16.15:
  //   ALTER TABLE ... DISABLE TRIGGER          -> tgenabled='D'
  //   ALTER TABLE ... ENABLE REPLICA TRIGGER   -> tgenabled='R' (không chạy ở chế độ origin)
  //   CREATE OR REPLACE TRIGGER ... WHEN (false)      -> tgqual khác NULL, UPDATE đi lọt
  //   CREATE OR REPLACE TRIGGER ... BEFORE UPDATE OF <cột> -> tgattr={n}, chỉ chạy khi cột đó
  //                                                           nằm trong SET
  // Và một cái nữa không ai ngờ, cũng đã đo: CREATE OR REPLACE TRIGGER RESET tgenabled về 'O'.
  // Nên "đã từng ENABLE ALWAYS" không phải một trạng thái ổn định — nó phải được canh.
  it("[INV-B4] ba trigger của mỗi bảng sổ đúng hình dạng: BEFORE, đúng sự kiện, ENABLE ALWAYS, không WHEN, không UPDATE OF", async () => {
    const { rows } = await db.pool.query<HangTrigger>(CAU_TRIGGER, [BANG_CHI_GHI_THEM]);
    const mong = BANG_CHI_GHI_THEM.flatMap((bang) =>
      TRIGGER_BAT_BUOC.map(([hauTo, tgtype]) => ({
        bang,
        ten_trigger: `${bang}_chan_${hauTo}`,
        tgtype,
        tgenabled: "A",
        co_when: false,
        cot_giam: "",
        ham: "public.chan_sua_xoa()",
      })),
    ).sort((x, y) => (x.bang + x.ten_trigger).localeCompare(y.bang + y.ten_trigger));
    expect(rows).toEqual(mong);
  });

  // ==========================================================================================
  // [cạm bẫy 1] LỚP 2 — QUYỀN. Phủ MỌI role, PUBLIC, và quyền CỘT.
  // ==========================================================================================
  // Vế HẸP nhưng CHÍNH XÁC HƠN về NGUỒN: quyền được ghi trong ACL (relacl + attacl), tức thứ
  // mà một câu GRANT sau triển khai để lại. Giữ nguyên từ vòng trước — nó nói được ĐÚNG BẰNG
  // những gì 003 quyết định, điều mà has_*_privilege không nói được.
  async function kiemQuyenAcl(): Promise<void> {
    const { rows } = await db.pool.query<HangQuyen>(CAU_QUYEN_BANG_SO, [BANG_CHI_GHI_THEM]);
    expect(rows.length, "không có dòng quyền nào thì phép kiểm này rỗng ruột").toBeGreaterThan(0);

    const viPham = rows.filter((r) => QUYEN_GHI_BI_CAM.includes(r.quyen));
    expect(
      viPham,
      "Bảng sổ kiểm toán chỉ được cấp SELECT và INSERT. Phép kiểm này đọc pg_class.relacl VÀ " +
        "pg_attribute.attacl nên nó phủ cả PUBLIC lẫn quyền CỘT — hai thứ mà " +
        "information_schema.role_table_grants bỏ sót.",
    ).toEqual([]);

    // Và mặt thuận: đúng bằng những gì 003 quyết định, không hơn.
    const mucBang = rows.filter((r) => r.cot === null).map((r) => `${r.bang}:${r.grantee}:${r.quyen}`);
    expect(mucBang.sort()).toEqual([
      "audit_chain_anchors:app_api:SELECT",
      "audit_chain_anchors:app_unseal:SELECT",
      "audit_events:app_api:SELECT",
      "audit_events:app_unseal:SELECT",
    ]);
    const cotDuocGhi = [
      ...new Set(rows.filter((r) => r.cot !== null).map((r) => `${r.bang}.${r.cot}:${r.quyen}`)),
    ].sort();
    expect(cotDuocGhi).toEqual([
      "audit_chain_anchors.hash:INSERT",
      "audit_chain_anchors.org_id:INSERT",
      "audit_chain_anchors.seq:INSERT",
      "audit_events.action:INSERT",
      "audit_events.actor_id:INSERT",
      "audit_events.actor_type:INSERT",
      "audit_events.hash:INSERT",
      "audit_events.ip:INSERT",
      "audit_events.org_id:INSERT",
      "audit_events.payload:INSERT",
      "audit_events.prev_hash:INSERT",
      "audit_events.request_id:INSERT",
      "audit_events.resource_id:INSERT",
      "audit_events.resource_type:INSERT",
      "audit_events.seq:INSERT",
      "audit_events.user_agent:INSERT",
    ]);
  }

  it("[INV-B4] ngoài chủ sở hữu bảng và superuser, chỉ vai trò định sẵn pg_write_all_data có UPDATE/DELETE trên bảng sổ", async () => {
    // [vòng fix 1 — IM1] Vế RỘNG: quyền HIỆU DỤNG trên toàn bộ pg_roles, không phải quyền ghi
    // trong ACL. Nó phủ ba đường mà đọc ACL mù: PUBLIC, tư cách thành viên, vai trò định sẵn.
    const hieuDung = await db.pool.query<HangQuyen>(CAU_QUYEN_HIEU_DUNG, [BANG_CHI_GHI_THEM]);
    const ngoaiMien = hieuDung.rows.filter(
      (r) => !VAI_TRO_DINH_SAN_DUOC_MIEN.includes(r.grantee),
    );
    expect(
      ngoaiMien,
      "Ngoài chủ sở hữu bảng, superuser và đúng những vai trò ĐỊNH SẴN được liệt kê, không role " +
        "nào được có UPDATE/DELETE/TRUNCATE trên bảng sổ — kể cả qua PUBLIC, qua tư cách thành " +
        "viên, hay qua quyền CỘT.",
    ).toEqual([]);

    // Chống rỗng ruột theo hai chiều. (i) Danh sách miễn trừ phải THẬT SỰ cần: nếu một phiên bản
    // PostgreSQL sau bỏ quyền ghi của pg_write_all_data thì dòng miễn trừ thành mã chết và phải
    // ĐỎ chứ không im lặng. (ii) TRUNCATE thì pg_write_all_data KHÔNG có — đã đo, và nếu nó có
    // thì đây là thông tin phải biết.
    const cuaDinhSan = hieuDung.rows
      .filter((r) => r.grantee === "pg_write_all_data" && r.cot === null)
      .map((r) => `${r.bang}:${r.quyen}`)
      .sort();
    expect(cuaDinhSan).toEqual([
      "audit_chain_anchors:DELETE",
      "audit_chain_anchors:UPDATE",
      "audit_events:DELETE",
      "audit_events:UPDATE",
    ]);

    await kiemQuyenAcl();
  });

  // [vòng fix 1 — IM1] B4 KHÔNG vỡ vì góc mù trên: lớp A chặn thật, và đây là phép đo chứ không
  // phải lý luận. Nửa (a) chứng minh vũ khí THẬT SỰ sắc (cùng role, cùng phiên, xoá được hàng
  // của một bảng đối chứng); nửa (b) nhắm đúng vũ khí ấy vào bảng sổ.
  it("[INV-B4] thành viên pg_write_all_data có quyền ghi trên sổ nhưng vẫn bị lớp A chặn", async () => {
    const con = await db.pool.connect();
    try {
      await con.query("BEGIN");
      await con.query("CREATE ROLE ke_ghi_du_lieu NOLOGIN");
      await con.query("GRANT pg_write_all_data TO ke_ghi_du_lieu");
      // pg_read_all_data cũng cần, và lý do là một chi tiết phải ĐO chứ không suy: "DELETE ...
      // WHERE" và vế USING của policy RLS đều đọc cột, nên pg_write_all_data MỘT MÌNH dừng ở
      // "permission denied" trước khi tới được trigger — tức fixture sẽ tự cho ra "đỏ = an toàn"
      // giả. Kịch bản thật của góc mù này là một role được quản trị cụm cấp cả hai.
      await con.query("GRANT pg_read_all_data TO ke_ghi_du_lieu");
      await con.query("GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO ke_ghi_du_lieu");
      await con.query("CREATE TABLE doi_chung_ghi (id int PRIMARY KEY)");
      await con.query("INSERT INTO doi_chung_ghi VALUES (1)");
      await con.query("SET LOCAL ROLE ke_ghi_du_lieu");
      await con.query("SELECT set_config('app.org_id', $1, true)", [orgA]);

      const xoaDoiChung = await con
        .query("DELETE FROM doi_chung_ghi WHERE id = 1")
        .then((r) => `DELETE ${r.rowCount}`, (e: Error) => e.message);
      expect(
        xoaDoiChung,
        "fixture tự vô hiệu hoá: role này không xoá nổi cả một bảng thường thì phần dưới không " +
          "chứng minh được lớp A làm gì",
      ).toBe("DELETE 1");

      // SAVEPOINT cho từng mũi: câu đầu bị RAISE làm hỏng transaction, và không có savepoint thì
      // câu thứ hai chỉ nhận "current transaction is aborted" — một phép đo tự rỗng ruột.
      const thuMui = async (cau: string): Promise<string> => {
        await con.query("SAVEPOINT mui");
        const kq = await con.query(cau).then(() => "THÀNH CÔNG", (e: Error) => e.message);
        await con.query("ROLLBACK TO SAVEPOINT mui");
        return kq;
      };
      for (const cau of [
        "UPDATE audit_events SET action = 'SUA_TROM'",
        "DELETE FROM audit_events",
      ]) {
        expect(await thuMui(cau), cau).toMatch(/chỉ-ghi-thêm|append-only/i);
      }
      // TRUNCATE không nằm trong pg_write_all_data (đã đo) — lớp B dừng trước lớp A. Cả hai
      // đều fail-closed, nên phép kiểm nhận cả hai thông báo.
      expect(await thuMui("TRUNCATE audit_events")).toMatch(
        /permission denied|chỉ-ghi-thêm|append-only/i,
      );
    } finally {
      await con.query("ROLLBACK");
      con.release();
    }
  });

  // [vòng fix 1 — CR1] Mặc định-ĐÓNG: trên bảng sổ chỉ sáu trigger chỉ-ghi-thêm được phép tồn
  // tại, và không rule nào. Phép kiểm trạng thái; đường trôi tương ứng có test đối kháng riêng
  // ở db/migrations.int.test.ts.
  it("[INV-B4] không trigger LẠ và không RULE nào trên bảng sổ", async () => {
    const tenHopLe = BANG_CHI_GHI_THEM.flatMap((bang) =>
      TRIGGER_BAT_BUOC.map(([hauTo]) => `${bang}_chan_${hauTo}`),
    );
    const { rows } = await db.pool.query<{ ten: string }>(CAU_TRIGGER_RULE_LA, [
      BANG_CHI_GHI_THEM,
      tenHopLe,
    ]);
    expect(rows).toEqual([]);
  });


  // Phép đo giữ cho phép kiểm trên khỏi bị "đơn giản hoá" về information_schema ở một vòng sau.
  it("[INV-B4] information_schema.role_table_grants MÙ với quyền CỘT — nên phép kiểm quyền phải đọc attacl", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("GRANT UPDATE (payload) ON audit_events TO app_api");

      // Chống rỗng ruột hai chiều. Vế (i): view PHẢI thấy quyền mức BẢNG — nếu không thì nó
      // mù vì một lý do khác (vd. lọc theo role đang chạy) và phép đo không nói gì về CỘT.
      // Vế (ii): với ĐÚNG cùng một câu hỏi, quyền CỘT thì nó không thấy.
      // Ghi rõ một chi tiết dễ đọc nhầm, đã tự vấp khi viết test này: view CÓ hiện dòng
      // 'postgres|UPDATE' — đó là quyền ngầm của CHỦ SỞ HỮU bảng, không phải quyền cột. Thiếu
      // mệnh đề grantee = 'app_api' thì phép đo tự cho ra kết luận ngược.
      const view = await client.query<{ quyen: string }>(
        "SELECT privilege_type AS quyen FROM information_schema.role_table_grants " +
          " WHERE table_name = 'audit_events' AND grantee = 'app_api' ORDER BY 1",
      );
      // Đây là toàn bộ những gì view đó biết về app_api trên bảng sổ: MỘT dòng SELECT. Nó
      // không thấy UPDATE(payload) vừa cấp, và nó cũng KHÔNG THẤY 13 quyền INSERT theo cột mà
      // 003 cấp — chúng chỉ tồn tại trong pg_attribute.attacl.
      // Hệ quả cụ thể, và là lý do bản kế hoạch của task này phải bị sửa chứ không chép lại:
      // phép kiểm #4 của nó khẳng định `quyen.has("INSERT") === true` trên chính view này. Với
      // lược đồ ĐÚNG (INSERT cấp theo cột để đóng oracle audit_events_pkey), khẳng định ấy ĐỎ.
      // Nghĩa là nó không chỉ mù — nó ép người viết cấp INSERT ở MỨC BẢNG để test xanh, tức tự
      // tay mở lại oracle mà Task 4 vừa đóng cho users_pkey.
      expect(
        view.rows.map((r) => r.quyen),
        "view không thấy nổi cả quyền mức bảng — phép đo này hết nội dung",
      ).toEqual(["SELECT"]);

      const thuc = await client.query<HangQuyen>(CAU_QUYEN_BANG_SO, [BANG_CHI_GHI_THEM]);
      expect(thuc.rows.filter((r) => r.quyen === "UPDATE")).toEqual([
        { bang: "audit_events", grantee: "app_api", cot: "payload", quyen: "UPDATE" },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  // ==========================================================================================
  // Hai role ứng dụng: ghi thêm được, không sửa/xoá/cắt được
  // ==========================================================================================
  for (const [tenRole, layPool] of [
    ["app_api", (): pg.Pool => apiPool],
    ["app_unseal", (): pg.Pool => unsealPool],
  ] as const) {
    it(`[INV-B4] ${tenRole} ghi thêm được nhưng không sửa, không xoá, không cắt`, async () => {
      const pool = layPool();
      const client = await pool.connect();
      try {
        await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
        const seq = tenRole === "app_api" ? 100 : 200;
        await client.query(
          "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
            `VALUES ($1, $2, 'SERVICE', 'GHI_THEM', 'TEST', ${BAM_0}, sha256($3::bytea))`,
          [orgA, seq, tenRole],
        );

        for (const cau of [
          "UPDATE audit_events SET action = 'SUA_TROM'",
          "DELETE FROM audit_events",
          "TRUNCATE audit_events",
        ]) {
          const loi = await client.query(cau).then(() => "THÀNH CÔNG", (e: Error) => e.message);
          // Quyền bị thu hồi nên đường đi thường dừng ở "permission denied"; trigger là lớp
          // đứng sau cho mọi ai vượt được lớp quyền. Cả hai đều là fail-closed.
          expect(loi, `${tenRole}: ${cau}`).toMatch(
            /permission denied|chỉ-ghi-thêm|append-only/i,
          );
        }
      } finally {
        client.release();
      }
    });
  }

  // ==========================================================================================
  // [cạm bẫy 8] Hai ràng buộc DUY NHẤT của bảng sổ có làm oracle xuyên tổ chức không?
  // ==========================================================================================
  // Task 4 tìm ra `organizations.slug UNIQUE` toàn cục LÀ oracle thật. Ở đây phải ĐO chứ không
  // suy: kết quả phụ thuộc THỨ TỰ mà PostgreSQL kiểm RLS WITH CHECK so với chỉ mục duy nhất.
  it("[INV-B4] UNIQUE (org_id, seq) không dùng làm oracle xuyên tổ chức được", async () => {
    const client = await apiPool.connect();
    try {
      await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
      const chen = async (seq: number): Promise<string> =>
        client
          .query(
            "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
              `VALUES ($1, $2, 'SYSTEM', 'DO', 'TEST', ${BAM_0}, sha256('x'::bytea))`,
            [orgB, seq],
          )
          .then(() => "THÀNH CÔNG", (loi: Error) => loi.message);

      // Chống rỗng ruột: (orgB, 7) PHẢI tồn tại thật, nếu không hai vế so sánh đều là "không
      // tồn tại" và phép đo không nói gì.
      const coThat = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND seq = 7",
        [orgB],
      );
      expect(coThat.rows[0]!.n).toBe("1");

      const coTon = await chen(7);
      const khongTon = await chen(4242);
      expect(coTon, "hai thông báo khác nhau = một bit rò ra ngoài tổ chức").toBe(khongTon);
      expect(coTon).toMatch(/row-level security/i);
    } finally {
      client.release();
    }
  });

  it("[INV-B4] audit_events_pkey không dùng làm oracle được — app_api không ghi được cột id", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "SELECT id FROM audit_events WHERE org_id = $1 LIMIT 1",
      [orgB],
    );
    const client = await apiPool.connect();
    try {
      await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
      const chen = async (id: string): Promise<string> =>
        client
          .query(
            "INSERT INTO audit_events (id, org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
              `VALUES ($1, $2, 300, 'SYSTEM', 'DO', 'TEST', ${BAM_0}, sha256('x'::bytea))`,
            [id, orgA],
          )
          .then(() => "THÀNH CÔNG", (loi: Error) => loi.message);

      const coThat = await chen(rows[0]!.id);
      const khongTon = await chen("00000000-0000-4000-8000-0000000000ff");
      expect(coThat).toBe(khongTon);
      expect(coThat).toMatch(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it("[INV-B4] không cho phép hai sự kiện cùng seq trong một tổ chức", async () => {
    await expect(
      db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
          `VALUES ($1, 1, 'SYSTEM', 'TRUNG_SEQ', 'TEST', sha256('a'::bytea), sha256('b'::bytea))`,
        [orgA],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  // ==========================================================================================
  // Ràng buộc toàn cục "không bao giờ ghi log giá" có một chốt chặn ở tầng DB
  // ==========================================================================================
  it("[INV-B4] payload không nhận khoá mang giá — chốt chặn tầng DB cho quy tắc không ghi log giá", async () => {
    const loi = await thu(
      db.pool,
      "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash, payload) " +
        `VALUES ($1, 900, 'SYSTEM', 'RO_GIA', 'TEST', ${BAM_0}, sha256('z'::bytea), $2::jsonb)`,
      [orgA, JSON.stringify({ don_gia: 12_000 })],
    );
    expect(loi).toMatch(/audit_events_payload_khong_mang_gia|violates check constraint/i);

    // Và payload bình thường thì vẫn ghi được — chốt chặn không được là hàng rào chặn hết.
    await expect(
      db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash, payload) " +
          `VALUES ($1, 901, 'SYSTEM', 'BINH_THUONG', 'TEST', ${BAM_0}, sha256('y'::bytea), $2::jsonb)`,
        [orgA, JSON.stringify({ rfq_id: "abc", ket_qua: "OK" })],
      ),
    ).resolves.toBeTruthy();
  });

  // [vòng fix 1 — IM4] Toán tử "?|" của vòng trước CHỈ XÉT KHOÁ CẤP MỘT, nên ba payload dưới đây
  // đi lọt hoàn toàn — và payload LỒNG là cách viết mặc định, không phải cách né tránh. Đo trên
  // bản chưa vá: {"chi_tiet":{"gia":12000}} -> INSERT 0 1, {"ds":[{"don_gia":12000}]} -> INSERT 0 1.
  // Nay ràng buộc dùng jsonb_path_exists với '$.**' (IMMUTABLE, đo được provolatile='i').
  it("[INV-B4] payload không nhận khoá mang giá ở BẤT KỲ ĐỘ SÂU NÀO — lồng, trong mảng, sâu ba tầng", async () => {
    const cacCa: [string, unknown][] = [
      ["phẳng", { don_gia: 12_000 }],
      ["lồng một tầng", { chi_tiet: { gia: 12_000 } }],
      ["trong mảng", { ds: [{ don_gia: 12_000 }] }],
      ["sâu ba tầng", { a: { b: { c: { totp_secret: "x" } } } }],
      ["bí mật lồng", { auth: { password: "x" } }],
    ];
    let seq = 910;
    for (const [nhan, payload] of cacCa) {
      seq += 1;
      const loi = await thu(
        db.pool,
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash, payload) " +
          `VALUES ($1, $2, 'SYSTEM', 'RO_GIA', 'TEST', ${BAM_0}, sha256($3::bytea), $4::jsonb)`,
        [orgA, seq, `ro-${seq}`, JSON.stringify(payload)],
      );
      expect(loi, nhan).toMatch(/audit_events_payload_khong_mang_gia|violates check constraint/i);
    }

    // Chống rỗng ruột: một payload lồng KHÔNG mang khoá cấm vẫn phải ghi được, nếu không thì
    // ràng buộc mới chỉ đơn giản là cấm mọi payload lồng.
    await expect(
      db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash, payload) " +
          `VALUES ($1, 999, 'SYSTEM', 'BINH_THUONG', 'TEST', ${BAM_0}, sha256('long'::bytea), $2::jsonb)`,
        [orgA, JSON.stringify({ rfq: { id: "abc", dong: [{ ma: "A1", so_luong: 5 }] } })],
      ),
    ).resolves.toBeTruthy();
  });

  // ==========================================================================================
  // [cạm bẫy 6] "Ba lớp bảo vệ ĐỘC LẬP" là một phát biểu quá lời — đo lại cho đúng mức
  // ==========================================================================================
  // Lớp REVOKE và lớp trigger KHÔNG độc lập theo hướng người ta hay nghĩ: lớp REVOKE thua chủ
  // sở hữu bảng và superuser, còn lớp trigger ràng buộc được CẢ HAI ở đường DML (đã đo ở các
  // test trên). Nghĩa là ở đường DML lớp trigger BAO TRÙM lớp REVOKE về sức mạnh.
  // [vòng fix 1 — IM2] Vòng trước rút ra từ đó rằng "lớp REVOKE chỉ thêm thông báo lỗi dừng sớm
  // hơn", và DÙNG kết luận ấy để biện minh cho việc hardening KHÔNG tự chữa ACL của bảng sổ. Vế
  // đó VƯỢT QUÁ: khi một trigger bị DISABLE — đúng cửa sổ phơi mà 003 thừa nhận — lớp B là lớp
  // DUY NHẤT còn đứng (đo: app_api_login DELETE -> "permission denied for table audit_events").
  // Nay hardening CÓ tự chữa ACL; test đối kháng cho đường đó ở db/migrations.int.test.ts.
  it("[INV-B4] GRANT UPDATE cho app_api sau triển khai vẫn không sửa được hàng — trigger là lớp có thẩm quyền", async () => {
    await db.pool.query("GRANT UPDATE ON audit_events TO app_api");
    try {
      const client = await apiPool.connect();
      try {
        await client.query("SELECT set_config('app.org_id', $1, false)", [orgA]);
        const loi = await client
          .query("UPDATE audit_events SET action = 'SUA_TROM'")
          .then(() => "THÀNH CÔNG", (e: Error) => e.message);
        expect(loi).toMatch(/chỉ-ghi-thêm|append-only/i);
      } finally {
        client.release();
      }
    } finally {
      await db.pool.query("REVOKE UPDATE ON audit_events FROM app_api");
    }
  });
});

// ==============================================================================================
// META-TEST — không cần container: chỉ đọc file.
// ==============================================================================================
describe("hồ sơ kiểm toán của bảng sổ khớp nhau giữa các file", () => {
  const doc = (tenFile: string): string =>
    readFileSync(fileURLToPath(new URL(`./migrations/${tenFile}`, import.meta.url)), "utf8");

  // Cùng khuôn §R3 đã dùng cho app_current_org_id(): định nghĩa nằm ở HAI file (003 tạo lần
  // đầu, hardening.always.sql cưỡng chế lại ở mọi lần migrate()), nên sửa một bên mà quên bên
  // kia phải ĐỎ — nếu không hardening âm thầm ghi đè bản trong 003 ở mỗi lần deploy.
  it("[INV-B4] định nghĩa chan_sua_xoa() trong 003 và trong hardening.always.sql khớp nhau", () => {
    const thanHam = (tenFile: string): string => {
      const khop = [
        ...doc(tenFile).matchAll(
          /LANGUAGE plpgsql SET search_path = pg_catalog AS \$(\w*)\$([\s\S]*?)\$\1\$/g,
        ),
      ];
      expect(khop, `${tenFile}: đúng một định nghĩa chan_sua_xoa()`).toHaveLength(1);
      return khop[0]![2]!.replace(/\s+/g, " ").trim();
    };

    const than003 = thanHam("003_audit_events.sql");
    expect(than003).toBe(
      "BEGIN RAISE EXCEPTION 'Bảng % là bảng chỉ-ghi-thêm (append-only): thao tác % bị từ chối', " +
        "TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege'; END",
    );
    expect(thanHam("hardening.always.sql")).toBe(than003);
  });

  it("[INV-B4] danh sách bảng chỉ-ghi-thêm khớp nhau ở hardening.always.sql và ở test này", () => {
    const khoi = /BANG_CHI_GHI_THEM constant text :=\s*\$q\$\(VALUES([\s\S]*?)\)\s*AS b\(ten\)\$q\$/.exec(
      doc("hardening.always.sql"),
    );
    expect(khoi, "không tìm thấy BANG_CHI_GHI_THEM trong hardening.always.sql").not.toBeNull();
    const trongSql = [...khoi![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
    expect(trongSql).toEqual([...BANG_CHI_GHI_THEM].sort());
  });
});
