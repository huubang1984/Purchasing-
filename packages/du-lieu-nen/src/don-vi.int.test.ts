// ==============================================================================================
// [S1.192 / S4.1] ĐƠN VỊ ĐO VÀ KHUÔN NỀN — L1 (vế ghi) và L4 (vế quy đổi chung), trên PostgreSQL thật, dưới `app_api`
//
// Mọi phép đo ở đây đi qua ĐÚNG đường ứng dụng đi: `withTenant` trên pool `app_api`, và tầng gói `quyDoiDonVi`. Vai chủ
// (superuser của container) chỉ dùng để dựng tổ chức, người, phiên — và để chứng minh rằng trigger là lớp giữ khi quyền
// không còn đứng chắn (chủ bảng có mọi quyền mà vẫn không UPDATE/DELETE/TRUNCATE được).
//
// Đột biến chạy TRONG GIAO DỊCH rồi ROLLBACK, khuôn `db/hardening-suy-tu-tinh-chat.int.test.ts`: sửa migration sẽ sống
// GIẢ, vì hardening tự chữa về bản ghim (bẫy S1.86).
// ==============================================================================================
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { KHONG_QUY_DOI_DUOC, chuoiSach, quyDoiDonVi, type KetQuaQuyDoi } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** Mọi bảng dữ liệu nền mang khuôn L1. Mỗi hạng mục S4 dựng một bảng nền thì thêm tên ở đây — test cuối tệp đòi hai chiều. */
// [S1.195 / S4.2a] Bốn bảng hàng chuẩn vào cùng khuôn.
const BANG_DU_LIEU_NEN = ["canonical_item_versions", "canonical_items", "item_aliases", "item_uom_conversions", "uom_aliases"] as const;

let db: TestDatabase;
let api: pg.Pool;
let orgA: string;
let orgB: string;
let nguoiA: string;
let phienA: string;
let nguoiA2: string;
let nguoiB: string;
let phienB: string;

async function taoNguoiVaPhien(orgId: string, email: string): Promise<{ nguoi: string; phien: string }> {
  const nguoi = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi du lieu') RETURNING id",
      [orgId, email],
    )
  ).rows[0]!.id;
  const phien = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id",
      [orgId, nguoi, randomBytes(32)],
    )
  ).rows[0]!.id;
  // [S1.195 / S4.2a] Người ghi dữ liệu nền phải giữ `item.manage` — cổng `du_lieu_nen_kiem_quyen_ghi`.
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DATA_STEWARD')", [orgId, nguoi]);
  return { nguoi, phien };
}

async function khaiBiDanh(
  orgId: string,
  nguoi: string,
  phien: string,
  biDanhSach: string,
  code: string | null,
): Promise<{ seq: string; ghi_luc: Date }> {
  return withTenant(api, orgId, async (c) => {
    const { rows } = await c.query<{ seq: string; ghi_luc: Date }>(
      "INSERT INTO uom_aliases (org_id, bi_danh_sach, code, rut, tac_gia, session_id) VALUES ($1, $2, $3, $4, $5, $6) " +
        "RETURNING seq::text, ghi_luc",
      [orgId, biDanhSach, code, code === null, nguoi, phien],
    );
    return rows[0]!;
  });
}

function quyDoi(orgId: string, tu: string, sang: string, moc = new Date(Date.now() + 60_000)): Promise<KetQuaQuyDoi> {
  return withTenant(api, orgId, (c) => quyDoiDonVi(c, { orgId, tu, sang, moc }));
}

async function maLoi(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "KHONG_MA";
  }
  return "KHONG_NEM";
}

/**
 * Bảng ca L4. Trả danh sách ca LỆCH — rỗng là đúng. Chạy lại được dưới một đột biến: một hàm quy đổi bị sửa phải làm danh
 * sách này khác rỗng.
 */
const BANG_CA_QUY_DOI: ReadonlyArray<readonly [string, string, number | null]> = [
  ["tấn", "kg", 1000],
  ["Kg", "g", 1000],
  ["KGS", "kilogram", 1],
  ["mm", "mét", 0.001],
  ["km", "cm", 100000],
  ["Lít", "ml", 1000],
  ["m3", "l", 1000],
  ["m³", "lít", 1000],
  ["chiếc", "cái", 1],
  // Khác thứ nguyên — không có cầu nối chung.
  ["kg", "mét", null],
  ["m2", "m3", null],
  ["m²", "mét", null],
  // Đơn vị đóng gói: không hệ số chung, chỉ qua quy đổi riêng của hàng chuẩn (S4.2).
  ["cây", "kg", null],
  ["cuộn", "mét", null],
  // Dạng MƠ HỒ: không bí danh chung, kể cả khi dạng sạch trùng một mã (`t`, `m`).
  ["MT", "kg", null],
  ["T", "kg", null],
  ["M", "cm", null],
  // Hai phía cùng một đơn vị LẠ: không phải hệ số `1` — không có nguồn nào nói hai chuỗi ấy là một đơn vị đã biết.
  ["hộp", "hộp", null],
  ["", "kg", null],
];

async function caLech(chay: (tu: string, sang: string) => Promise<KetQuaQuyDoi>): Promise<string[]> {
  const lech: string[] = [];
  for (const [tu, sang, mong] of BANG_CA_QUY_DOI) {
    const kq = await chay(tu, sang);
    const dung =
      mong === null
        ? !kq.quyDoiDuoc && kq.ma === KHONG_QUY_DOI_DUOC
        : kq.quyDoiDuoc && Number(kq.heSo) === mong;
    if (!dung) lech.push(`${tu}→${sang}: ${JSON.stringify(kq)}`);
  }
  return lech;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'dv-a'), ('Cong ty B', 'dv-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  ({ nguoi: nguoiA, phien: phienA } = await taoNguoiVaPhien(orgA, "s@a.vn"));
  ({ nguoi: nguoiA2 } = await taoNguoiVaPhien(orgA, "s2@a.vn"));
  ({ nguoi: nguoiB, phien: phienB } = await taoNguoiVaPhien(orgB, "s@b.vn"));
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.192 / S4.1] làm sạch chuỗi bản 1", () => {
  it("chuoi_sach: bỏ dấu, `đ`→`d`, chữ thường, ký tự lạ thành một khoảng trắng — một hàm SQL, tầng gói chỉ gọi nó", async () => {
    const ca: ReadonlyArray<readonly [string, string]> = [
      ["Thép Hòa Phát D10", "thep hoa phat d10"],
      ["THEP HOA PHAT D10", "thep hoa phat d10"],
      ["  Thep   HP phi 10 ", "thep hp phi 10"],
      ["D10-HP", "d10 hp"],
      ["Đường ống ĐK 21", "duong ong dk 21"],
      ["Ư ơ Ỗ ặ", "u o o a"],
      ["Kg.", "kg"],
      // NFKD: số mũ và chữ toàn khổ về dạng thường. NFD thì *"m²"* thành `m` — mã của mét.
      ["m²", "m2"],
      ["m³", "m3"],
      ["ｋｇ", "kg"],
      ["", ""],
    ];
    const that = await withTenant(api, orgA, async (c) => {
      const ra: string[] = [];
      for (const [vao] of ca) ra.push(await chuoiSach(c, vao));
      return ra;
    });
    expect(that).toEqual(ca.map(([, ra]) => ra));
  });
});

describe("[S1.192 / S4.1] quy đổi đơn vị — L4", () => {
  it("[INV-L4] bảng ca: cùng thứ nguyên thì có hệ số; khác thứ nguyên, đóng gói, mơ hồ, lạ thì KHONG_QUY_DOI_DUOC — không bao giờ hệ số 1 không nguồn", async () => {
    expect(await caLech((tu, sang) => quyDoi(orgA, tu, sang))).toEqual([]);
    const cung = await quyDoi(orgA, "kg", "Kg");
    expect(cung).toEqual({ quyDoiDuoc: true, heSo: "1", ma: "CUNG_DON_VI" });
    expect(await quyDoi(orgA, "tấn", "kg")).toMatchObject({ quyDoiDuoc: true, ma: "QUY_DOI_CHUNG" });
  });

  it("[INV-L4] danh mục gieo sẵn đúng bản đã chốt: mười hai đơn vị, và `t`, `m`, `mt` KHÔNG có bí danh chung", async () => {
    const donVi = await withTenant(api, orgA, async (c) =>
      (await c.query<{ d: string }>(
        "SELECT code || ':' || thu_nguyen || ':' || he_so_ve_goc::text AS d FROM uom_units ORDER BY code",
      )).rows.map((r) => r.d),
    );
    expect(donVi).toEqual([
      "cai:DEM:1", "cm:CHIEU_DAI:0.01", "g:KHOI_LUONG:0.001", "kg:KHOI_LUONG:1", "km:CHIEU_DAI:1000", "l:THE_TICH:0.001",
      "m:CHIEU_DAI:1", "m2:DIEN_TICH:1", "m3:THE_TICH:1", "ml:THE_TICH:0.000001", "mm:CHIEU_DAI:0.001", "t:KHOI_LUONG:1000",
    ]);
    const biDanh = await withTenant(api, orgA, async (c) =>
      (await c.query<{ b: string }>("SELECT bi_danh_sach AS b FROM uom_aliases_chung ORDER BY 1")).rows.map((r) => r.b),
    );
    expect(biDanh).not.toContain("t");
    expect(biDanh).not.toContain("m");
    expect(biDanh).not.toContain("mt");
    expect(biDanh).toHaveLength(18);
  });

  it("[INV-L4] bí danh của tổ chức đọc TẠI MỐC: trước khi khai thì không quy đổi; sau khi rút thì thôi; tổ chức khác không thấy", async () => {
    const truocKhai = new Date();
    const khai = await khaiBiDanh(orgA, nguoiA, phienA, "mt", "t");
    const sauKhai = new Date(khai.ghi_luc.getTime() + 1);
    const rut = await khaiBiDanh(orgA, nguoiA, phienA, "mt", null);
    const sauRut = new Date(rut.ghi_luc.getTime() + 1);

    expect(await quyDoi(orgA, "MT", "kg", truocKhai)).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
    expect(await quyDoi(orgA, "MT", "kg", sauKhai)).toMatchObject({ quyDoiDuoc: true, ma: "QUY_DOI_CHUNG" });
    expect(Number(((await quyDoi(orgA, "MT", "kg", sauKhai)) as { heSo: string }).heSo)).toBe(1000);
    expect(await quyDoi(orgA, "MT", "kg", sauRut)).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
    // Mốc NẰM GIỮA hai hàng vẫn đọc bí danh — lịch sử không bị hàng rút viết lại.
    expect(await quyDoi(orgA, "mt", "kg", sauKhai)).toMatchObject({ quyDoiDuoc: true });
    // RLS: tổ chức B không thấy bí danh của A, cả khi hỏi hộ `org_id` của A trên phiên của B.
    expect(await quyDoi(orgB, "MT", "kg")).toEqual({ quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC });
    const hoiHo = await withTenant(api, orgB, async (c) =>
      (await c.query<{ ma: string }>("SELECT ma FROM public.quy_doi_don_vi($1, NULL, 'MT', 'kg', now() + interval '1 minute')", [orgA]))
        .rows[0]!.ma,
    );
    expect(hoiHo).toBe(KHONG_QUY_DOI_DUOC);
  });

  it("[INV-L4] ĐỘT BIẾN — thân quy đổi có nhánh `ELSE 1` (hệ số đoán) làm bảng ca lệch; bí danh chung cho `t` cũng lệch", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`CREATE OR REPLACE FUNCTION public.quy_doi_don_vi(
          p_org uuid, p_hang_chuan uuid, p_tu text, p_sang text, p_moc timestamptz)
          RETURNS TABLE (he_so numeric, ma text) LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $ham$
          SELECT coalesce(CASE WHEN a.thu_nguyen = b.thu_nguyen THEN a.he_so_ve_goc / b.he_so_ve_goc END, 1::numeric),
                 CASE WHEN a.thu_nguyen = b.thu_nguyen AND a.code = b.code THEN 'CUNG_DON_VI' ELSE 'QUY_DOI_CHUNG' END
            FROM (SELECT public.don_vi_tai(p_org, p_tu, p_moc) AS tu, public.don_vi_tai(p_org, p_sang, p_moc) AS sang) d
            LEFT JOIN public.uom_units a ON a.code = d.tu LEFT JOIN public.uom_units b ON b.code = d.sang
          $ham$`);
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      const chay = async (tu: string, sang: string): Promise<KetQuaQuyDoi> => {
        const { rows } = await c.query<{ he_so: string | null; ma: string }>(
          "SELECT he_so::text AS he_so, ma FROM public.quy_doi_don_vi($1, NULL, $2, $3, now() + interval '1 minute')",
          [orgA, tu, sang],
        );
        const h = rows[0]!;
        return h.he_so === null ? { quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC } : { quyDoiDuoc: true, heSo: h.he_so, ma: "QUY_DOI_CHUNG" };
      };
      const lech = await caLech(chay);
      expect(lech.length, "đột biến ELSE 1 phải làm bảng ca đỏ").toBeGreaterThan(0);
      expect(lech.some((l) => l.startsWith("hộp→hộp"))).toBe(true);
      await c.query("ROLLBACK");

      await c.query("BEGIN");
      await c.query("ALTER TABLE uom_aliases_chung DISABLE TRIGGER USER");
      await c.query("INSERT INTO uom_aliases_chung (bi_danh_sach, code) VALUES ('t', 't')");
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      const t = (await c.query<{ ma: string }>("SELECT ma FROM public.quy_doi_don_vi($1, NULL, 'T', 'kg', now())", [orgA])).rows[0]!.ma;
      expect(t, "một bí danh chung cho `t` đưa dạng mơ hồ vào quy đổi").toBe("QUY_DOI_CHUNG");
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("[INV-L4] ĐỘT BIẾN — hàm SQL trả một cặp (hệ số, mã) lạ: tầng gói NÉM thay vì đoán `quyDoiDuoc`", async () => {
    const c = await db.pool.connect();
    try {
      for (const [heSo, ma] of [
        ["1::numeric", "'KHONG_QUY_DOI_DUOC'"],
        ["NULL::numeric", "'QUY_DOI_CHUNG'"],
        ["1::numeric", "'DOAN'"],
      ] as const) {
        await c.query("BEGIN");
        await c.query(`CREATE OR REPLACE FUNCTION public.quy_doi_don_vi(
            p_org uuid, p_hang_chuan uuid, p_tu text, p_sang text, p_moc timestamptz)
            RETURNS TABLE (he_so numeric, ma text) LANGUAGE sql STABLE AS $ham$ SELECT ${heSo}, ${ma} $ham$`);
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
        await expect(quyDoiDonVi(c, { orgId: orgA, tu: "kg", sang: "g", moc: new Date() }), `${heSo}, ${ma}`).rejects.toThrow(/cặp lạ/);
        await c.query("ROLLBACK");
      }
    } finally {
      c.release();
    }
  });
});

describe("[S1.192 / S4.1] khuôn ghi của dữ liệu nền — L1", () => {
  it("[INV-L1] `seq` và `ghi_luc` do trigger đặt; `id`, `seq`, `ghi_luc` ngoài GRANT — ứng dụng khai là bị từ chối", async () => {
    const hai = [await khaiBiDanh(orgB, nguoiB, phienB, "cay", "cai"), await khaiBiDanh(orgB, nguoiB, phienB, "bo", "cai")];
    expect(hai.map((h) => h.seq)).toEqual(["1", "2"]);
    expect(hai[1]!.ghi_luc.getTime()).toBeGreaterThan(hai[0]!.ghi_luc.getTime());
    for (const cot of ["seq", "ghi_luc", "id"]) {
      const gia = cot === "seq" ? "99" : cot === "ghi_luc" ? "2000-01-01" : "00000000-0000-4000-8000-000000000001";
      const loi = await maLoi(
        withTenant(api, orgB, (c) =>
          c.query(
            `INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id, ${cot}) VALUES ($1, 'x', 'kg', $2, $3, $4)`,
            [orgB, nguoiB, phienB, gia],
          ),
        ),
      );
      expect(loi, `ứng dụng khai được cột ${cot}`).toBe("42501");
    }
  });

  it("[INV-L1] chỉ-ghi-thêm: `app_api` không UPDATE/DELETE; chủ bảng cũng bị trigger chặn UPDATE, DELETE, TRUNCATE — ở cả ba bảng mới", async () => {
    await khaiBiDanh(orgA, nguoiA, phienA, "bao", "cai");
    expect(await maLoi(withTenant(api, orgA, (c) => c.query("UPDATE uom_aliases SET code = 'kg'")))).toBe("42501");
    expect(await maLoi(withTenant(api, orgA, (c) => c.query("DELETE FROM uom_aliases")))).toBe("42501");
    expect(await maLoi(withTenant(api, orgA, (c) => c.query("INSERT INTO uom_units (code, thu_nguyen, he_so_ve_goc) VALUES ('x', 'DEM', 1)")))).toBe("42501");
    for (const [bang, sua] of [
      ["uom_aliases", "code = 'kg'"],
      ["uom_units", "he_so_ve_goc = 1"],
      ["uom_aliases_chung", "code = 'kg'"],
    ] as const) {
      expect(await maLoi(db.pool.query(`UPDATE ${bang} SET ${sua}`)), `${bang} UPDATE`).toBe("23514");
      expect(await maLoi(db.pool.query(`DELETE FROM ${bang}`)), `${bang} DELETE`).toBe("23514");
      expect(await maLoi(db.pool.query(`TRUNCATE ${bang} CASCADE`)), `${bang} TRUNCATE`).toBe("23514");
    }
  });

  it("[INV-L1] tác giả là DẪN XUẤT từ phiên; bí danh phải ở dạng sạch; hàng rút không mang mã", async () => {
    expect(
      await maLoi(
        withTenant(api, orgA, (c) =>
          c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id) VALUES ($1, 'kien', 'cai', $2, $3)", [
            orgA,
            nguoiA2,
            phienA,
          ]),
        ),
      ),
      "tác giả khác chủ phiên",
    ).toBe("23514");
    expect(await maLoi(khaiBiDanh(orgA, nguoiA, phienA, "MT", "t")), "bí danh chưa làm sạch").toBe("23514");
    expect(
      await maLoi(
        withTenant(api, orgA, (c) =>
          c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, rut, tac_gia, session_id) VALUES ($1, 'kien', 'cai', true, $2, $3)", [
            orgA,
            nguoiA,
            phienA,
          ]),
        ),
      ),
      "hàng rút mang mã",
    ).toBe("23514");
  });

  it("[INV-L1] hai giao dịch đồng thời của một tổ chức không trùng `seq`: khoá tư vấn xếp chúng hàng", async () => {
    const truoc = await withTenant(api, orgB, async (c) =>
      Number((await c.query<{ n: string }>("SELECT coalesce(max(seq), 0)::text AS n FROM uom_aliases")).rows[0]!.n),
    );
    const mot = withTenant(api, orgB, async (c) => {
      await c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id) VALUES ($1, 'dong thoi 1', 'cai', $2, $3)", [
        orgB,
        nguoiB,
        phienB,
      ]);
      await c.query("SELECT pg_sleep(0.5)");
    });
    await new Promise((r) => setTimeout(r, 150));
    const hai = withTenant(api, orgB, (c) =>
      c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id) VALUES ($1, 'dong thoi 2', 'cai', $2, $3)", [
        orgB,
        nguoiB,
        phienB,
      ]),
    );
    await Promise.all([mot, hai]);
    const seq = await withTenant(api, orgB, async (c) =>
      (await c.query<{ s: string }>("SELECT seq::text AS s FROM uom_aliases WHERE seq > $1 ORDER BY seq", [truoc])).rows.map((r) => r.s),
    );
    expect(seq).toEqual([String(truoc + 1), String(truoc + 2)]);
  });

  it("[INV-L1] ĐỘT BIẾN — gỡ trigger khuôn lúc chạy: hàng không có `seq` bị NOT NULL chặn, tức trigger là lớp đặt nó", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE uom_aliases DISABLE TRIGGER uom_aliases_dat_thu_tu");
      const loi = await maLoi(
        c.query("INSERT INTO uom_aliases (org_id, bi_danh_sach, code, tac_gia, session_id) VALUES ($1, 'go trigger', 'cai', $2, $3)", [
          orgA,
          nguoiA,
          phienA,
        ]),
      );
      expect(loi).toBe("23502");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("[INV-L1] tổng điều tra: đúng các bảng trong BANG_DU_LIEU_NEN mang trigger khuôn, ENABLE ALWAYS, và giữ `seq`/`ghi_luc`/`id` ngoài GRANT", async () => {
    const { rows } = await db.pool.query<{ bang: string; bat: string }>(
      "SELECT c.relname AS bang, t.tgenabled::text AS bat FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
        "WHERE t.tgfoid = to_regprocedure('public.du_lieu_nen_dat_thu_tu()') AND NOT t.tgisinternal ORDER BY 1",
    );
    expect(rows.map((r) => r.bang)).toEqual([...BANG_DU_LIEU_NEN].sort());
    expect(rows.every((r) => r.bat === "A")).toBe(true);
    for (const bang of BANG_DU_LIEU_NEN) {
      const cap = await db.pool.query<{ cot: string }>(
        "SELECT a.attname AS cot FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped " +
          "AND a.attname IN ('id', 'seq', 'ghi_luc') AND (has_column_privilege('app_api', $1::regclass, a.attnum, 'INSERT') " +
          "OR has_column_privilege('app_api', $1::regclass, a.attnum, 'UPDATE'))",
        [bang],
      );
      expect(cap.rows, `${bang}: cột khuôn nằm trong GRANT`).toEqual([]);
    }
  });
});
