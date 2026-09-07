import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(
  fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url)),
  "utf8",
);

/**
 * [S1.20 / sổ nợ 3 + 16] HARDENING KHÔNG ĐƯỢC TỰ LÀM MÙ BẰNG MỘT DANH SÁCH TÊN.
 *
 * Khoản nợ 16 mô tả một bất đối xứng: `bang_so` nhận bảng theo HAI TÊN VIẾT CỨNG
 * (`audit_events`, `audit_chain_anchors`) trong khi `bang_al` nhận bảng lạ theo TÍNH CHẤT (mang
 * trigger gọi `chan_sua_xoa()`). Nó dự báo *"bảng báo giá S1 sẽ rơi thẳng vào đó"*.
 *
 * **Dự báo ấy đã thành hiện thực, và đo được — S1 dựng một hàm canh chỉ-ghi-thêm THỨ HAI**
 * (`public.bid_chi_ghi_them()`, migration 018) cắm trên BA bảng: `bid_receipts`,
 * `rfq_unsealed_bids`, `vendor_bid_versions`. Cả ba nằm ngoài `bang_so` (không có trong danh
 * sách hai tên) VÀ ngoài `bang_al` (vế ấy khoá theo OID của `chan_sua_xoa`). Đo trên
 * PostgreSQL 16 ngày 2026-09-07, mỗi lần `migrate()` trả về `applied=[]` và KHÔNG một lỗi nào:
 *
 *   - `ALTER TABLE bid_receipts SET UNLOGGED`     -> MIGRATE OK, relpersistence còn 'u'
 *   - `GRANT UPDATE, DELETE ON bid_receipts TO app_api` -> MIGRATE OK, acl còn `app_api=rwd`
 *   - `TRUNCATE public.bid_receipts`              -> **OK** (audit_events thì NÉM)
 *
 * **Vế thứ ba là lỗ mà sổ nợ 16 KHÔNG nêu, và nó nặng hơn hai vế kia:** ba trigger của 018 và 019
 * là `BEFORE DELETE OR UPDATE FOR EACH ROW` (tgtype 27) — chúng KHÔNG chạm TRUNCATE, trong khi
 * bảng sổ có hẳn một trigger TRUNCATE riêng từ 003. Một câu lệnh xoá sạch mọi biên nhận nộp thầu
 * (**B2**), mọi phiên bản báo giá (**B1**) và mọi giá đã mở — và ma trận đang ghi cả hai mã ✅.
 *
 * KHUÔN SỬA, theo ADR-027/ADR-028: **suy từ một TÍNH CHẤT, và tính chất phải không giả mạo được
 * theo chiều nguy hiểm.** Tính chất ở đây:
 *
 *   một bảng là CHỈ-GHI-THÊM khi nó mang CẢ HAI trigger BEFORE-ROW-UPDATE và BEFORE-ROW-DELETE
 *   mà hàm plpgsql của chúng KHÔNG BAO GIỜ TRẢ VỀ (thân không có `RETURN` nào)
 *
 * Một hàm trigger không trả về thì chỉ có thể NÉM. Giả mạo tính chất này là THÊM bảo vệ, không
 * phải gỡ. Gỡ nó (viết lại thân hàm thành `BEGIN RETURN NEW; END`) làm bảng rời khỏi tập — nhưng
 * đường ấy đã có lớp khác đứng: mỗi hàm trigger trong `public` đều có một mục ghim thân trong
 * `hardening.always.sql`, và `db/migrations.int.test.ts` [S1.14/S1.15] giữ danh sách loại trừ RỖNG.
 *
 * **Vì sao vế `RETURN` là cần chứ không thừa — có phản ví dụ thật trong kho:**
 * `rfq_items_cam_truncate` (011) cũng có thân `BEGIN RAISE EXCEPTION … END` không `RETURN`, nhưng
 * nó là trigger TRUNCATE cấp CÂU LỆNH. `rfq_items` KHÔNG chỉ-ghi-thêm — nó sửa và xoá được khi RFQ
 * còn DRAFT. Vế "cả UPDATE lẫn DELETE, cấp HÀNG" là thứ loại nó ra.
 *
 * **Vì sao vế `prolang = plpgsql` là cần [review lượt 12, M4]:** `prosrc` của một hàm
 * `LANGUAGE internal`/`c` là TÊN SYMBOL — đã đo, `suppress_redundant_updates_trigger` có
 * `prosrc = 'suppress_redundant_updates_trigger'`. Không chứa `RETURN`, nên không có vế ngôn ngữ
 * thì hai trigger dựng sẵn của PostgreSQL đủ để một bảng bị nhận nhầm là chỉ-ghi-thêm và bị CHẶN
 * DEPLOY.
 */
const VI_TU_BANG_CHI_GHI_THEM = `SELECT c.oid AS bang_oid, c.relname, c.relpersistence, c.relowner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
          AND c.relkind IN ('r', 'p')
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                  AND p.prosrc !~* '\\mRETURN\\M'
                  AND (t.tgtype OPERATOR(pg_catalog.&) 19::pg_catalog.int2) OPERATOR(pg_catalog.=) 19) OPERATOR(pg_catalog.>) 0
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
                  AND p.prosrc !~* '\\mRETURN\\M'
                  AND (t.tgtype OPERATOR(pg_catalog.&) 11::pg_catalog.int2) OPERATOR(pg_catalog.=) 11) OPERATOR(pg_catalog.>) 0`;

/** Tập bảng chỉ-ghi-thêm ĐO ĐƯỢC hôm nay. Hai tên đầu là bảng sổ (003), ba tên sau là S1 (018/019). */
const BANG_CHI_GHI_THEM_THAT = [
  "audit_chain_anchors",
  "audit_events",
  "bid_receipts",
  "rfq_unsealed_bids",
  "vendor_bid_versions",
];

/** Hai bảng có TÊN trong `BANG_CHI_GHI_THEM` — hardening TỰ CHỮA chúng. Ba bảng kia thì chỉ PHÁN XÉT. */
const BANG_CO_TEN = ["audit_chain_anchors", "audit_events"];

async function thu(db: TestDatabase, cau: string): Promise<string> {
  try {
    await db.pool.query(cau);
    return "OK";
  } catch (e) {
    return `NÉM: ${(e as Error).message}`;
  }
}

/** `migrate()` lại và cho biết nó NÉM hay không — mọi mục hardening chạy lại ở mỗi lần gọi. */
async function migrateLai(db: TestDatabase): Promise<string> {
  try {
    await migrate(db.pool, MIGRATIONS_DIR);
    return "OK";
  } catch (e) {
    return `NÉM: ${(e as Error).message}`;
  }
}

describe("[INV-H19] hardening suy chủ thể từ TÍNH CHẤT, không từ danh sách tên", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startPostgres();
    await migrate(db.pool, MIGRATIONS_DIR);
  }, 180000);

  afterAll(async () => {
    await db.stop();
  });

  it("vị từ chỉ-ghi-thêm suy từ tính chất, và nó nhận ĐÚNG năm bảng — kể cả ba bảng S1 mà danh sách hai tên bỏ sót", async () => {
    const { rows } = await db.pool.query<{ relname: string }>(
      `${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(BANG_CHI_GHI_THEM_THAT);

    // Đối chứng ÂM cho vế `RETURN`: `rfq_items` có một trigger TRUNCATE (`rfq_items_cam_truncate`)
    // thân không RETURN, và nó KHÔNG được lọt vào tập. Không có khẳng định này thì một vị từ lỏng
    // hơn vẫn xanh ở trên.
    expect(rows.map((r) => r.relname)).not.toContain("rfq_items");

    // Và vị từ này phải là CÙNG MỘT VĂN BẢN với vị từ trong hardening — hai bản sao trôi khỏi
    // nhau tái tạo đúng cái mù mà test này tồn tại để đóng (khuôn BANG_GOC_TENANT của Task 3-4).
    expect(
      HARDENING.includes(VI_TU_BANG_CHI_GHI_THEM),
      "vị từ trong test phải xuất hiện NGUYÊN VĂN trong hardening.always.sql",
    ).toBe(true);

    // [review lượt 12, H2] Và vế SCHEMA của nó phải là `MAU_SCHEMA_DU_AN` đã khai triển, không phải
    // một `nspname = 'public'` viết cứng — bản đầu của vòng này viết khoá cứng, tức tái lập đúng
    // thứ [CR2a] đã CỐ Ý gỡ khỏi `bang_so`. Đọc thẳng hằng ấy từ file rồi so, để hai bên không trôi.
    const mauSchema = /MAU_SCHEMA_DU_AN constant text :=\s*\$q\$([\s\S]*?)\$q\$;/.exec(HARDENING);
    expect(mauSchema, "không tìm thấy MAU_SCHEMA_DU_AN").not.toBeNull();
    // So sau khi gộp khoảng trắng: hai chỗ có mức thụt lề khác nhau, và thụt lề không phải thứ
    // đang được đo.
    const gonTrang = (t: string): string => t.replace(/\s+/gu, " ").trim();
    const khaiTrien = gonTrang(mauSchema![1]!.replaceAll("%1$s", "n").replaceAll("%%", "%"));
    expect(
      gonTrang(VI_TU_BANG_CHI_GHI_THEM).includes(khaiTrien),
      "vế schema phải BẰNG MAU_SCHEMA_DU_AN khai triển cho bí danh `n`",
    ).toBe(true);
  });

  it("mọi bảng chỉ-ghi-thêm đều LOGGED — bảng có TÊN thì hardening TỰ CHỮA, bảng SUY RA thì hardening NÉM", async () => {
    const { rows } = await db.pool.query<{ relname: string; relpersistence: string }>(
      `${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`,
    );
    expect(rows.filter((r) => r.relpersistence !== "p").map((r) => r.relname)).toEqual([]);

    // [CR5] đo hậu quả bằng SIGKILL postgres thật: trước-crash 4 hàng, sau-crash 0. Cửa sổ phơi
    // là VĨNH VIỄN vì `SET UNLOGGED` đòi quyền SỞ HỮU, không phải quyền ghi.
    //
    // KHÔNG ép danh sách bảng: PostgreSQL TỪ CHỐI `SET UNLOGGED` cho một bảng đang được một bảng
    // LOGGED tham chiếu (`vendor_bid_versions`, `rfq_unsealed_bids` rơi vào đó — đã đo). Đó là một
    // lớp khác, của chính PostgreSQL, và nó KHÔNG phủ hết: `audit_chain_anchors` và `bid_receipts`
    // đổi được. Test thử từng bảng và chỉ đòi hỏi ở những bảng mà đột biến THÀNH CÔNG.
    //
    // HAI KẾT QUẢ ĐÚNG KHÁC NHAU, và sự khác nhau ấy CHÍNH LÀ ADR-028 §2⑵ đo được:
    //   - bảng có TÊN trong `BANG_CHI_GHI_THEM` -> hardening TỰ CHỮA: migrate() OK, bảng về LOGGED;
    //   - bảng SUY RA (ba bảng của S1)          -> hardening chỉ PHÁN XÉT: migrate() NÉM.
    // `migrate()` không bao giờ tự tay đổi trạng thái vật lý của một bảng mà nó chỉ SUY RA.
    let soDotBien = 0;
    for (const r of rows) {
      if ((await thu(db, `ALTER TABLE public.${r.relname} SET UNLOGGED`)) !== "OK") continue;
      soDotBien += 1;
      const ketQua = await migrateLai(db);
      if (BANG_CO_TEN.includes(r.relname)) {
        expect(ketQua, `${r.relname} có tên trong danh sách nên hardening TỰ CHỮA`).toBe("OK");
        const { rows: sau } = await db.pool.query<{ p: string }>(
          `SELECT relpersistence AS p FROM pg_class WHERE oid = to_regclass('public.${r.relname}')`,
        );
        expect(sau[0]?.p, `${r.relname} phải được đưa về LOGGED`).toBe("p");
      } else {
        expect(ketQua, `${r.relname} là bảng SUY RA nên hardening chỉ phán xét`).toMatch(/UNLOGGED/u);
        expect(await thu(db, `ALTER TABLE public.${r.relname} SET LOGGED`)).toBe("OK");
      }
    }
    expect(soDotBien, "phải có ít nhất hai bảng đổi được sang UNLOGGED, nếu không test này rỗng")
      .toBeGreaterThan(1);
    expect(await migrateLai(db), "đối chứng dương: lược đồ đúng vẫn migrate() được").toBe("OK");
  }, 180000);

  it("mọi bảng chỉ-ghi-thêm CHẶN CẢ TRUNCATE — không chỉ UPDATE và DELETE", async () => {
    // Ba bảng của S1 chỉ có trigger BEFORE DELETE OR UPDATE (tgtype 27). TRUNCATE đi qua chúng.
    for (const bang of BANG_CHI_GHI_THEM_THAT) {
      expect(await thu(db, `TRUNCATE public.${bang} CASCADE`), `TRUNCATE ${bang}`).toMatch(
        /chỉ-ghi-thêm|chi duoc ghi them/u,
      );
    }

    // [review lượt 12, M2] Vế "có chốt TRUNCATE" nay đòi trigger ĐANG BẬT (`tgenabled='A'`) và
    // BEFORE. Bản đầu chỉ hỏi *có hàng nào trong pg_trigger mang bit 32 không*, nên một
    // `DISABLE TRIGGER` cho ra mục XANH trong khi TRUNCATE đi lọt hoàn toàn.
    //
    // Trên `bid_receipts` đột biến ấy KHÔNG dừng ở phán xét, và đó là kết quả ĐÚNG: ba trigger của
    // ba bảng S1 có TÊN trong mục ghim `bid_chi_ghi_them (047)`, nên hardening **TỰ CHỮA** — cùng
    // ranh giới ADR-028 §2⑵ mà đột biến UNLOGGED ở trên đo. Lượt ĐỎ THẬT của vế `tgenabled` nằm ở
    // ca PHÂN MẢNH bên dưới, nơi bảng là SUY RA và không mục ghim nào che.
    expect(
      await thu(db, "ALTER TABLE public.bid_receipts DISABLE TRIGGER bid_receipts_chan_truncate"),
    ).toBe("OK");
    expect(await thu(db, "TRUNCATE public.bid_receipts CASCADE"), "chốt đã tắt thì TRUNCATE đi lọt")
      .toBe("OK");
    expect(await migrateLai(db), "trigger có TÊN trong mục ghim nên hardening tự chữa").toBe("OK");
    const { rows: bat } = await db.pool.query<{ e: string }>(
      "SELECT tgenabled AS e FROM pg_trigger WHERE tgname = 'bid_receipts_chan_truncate'",
    );
    expect(bat[0]?.e, "chốt phải được dựng lại ở ENABLE ALWAYS").toBe("A");
    expect(await thu(db, "TRUNCATE public.bid_receipts CASCADE"), "và chặn trở lại").toMatch(
      /chi duoc ghi them/u,
    );
  }, 180000);

  it("không ai ngoài chủ sở hữu được cấp UPDATE/DELETE/TRUNCATE trên bảng chỉ-ghi-thêm — kể cả ở MỨC CỘT", async () => {
    const cauQuyen = `SELECT b.relname, a.privilege_type
         FROM (${VI_TU_BANG_CHI_GHI_THEM}) b
         JOIN pg_class c ON c.oid = b.bang_oid
         CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE a.grantee <> c.relowner
          AND a.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')`;
    const { rows } = await db.pool.query(cauQuyen);
    expect(rows).toEqual([]);

    // Đột biến 1 — mức BẢNG: một GRANT của kẻ tấn công phải KHÔNG sống qua `migrate()`.
    expect(await thu(db, "GRANT UPDATE, DELETE, TRUNCATE ON public.bid_receipts TO app_api")).toBe(
      "OK",
    );
    expect(await migrateLai(db), "GRANT lạ phải làm migrate() NÉM").toMatch(/bid_receipts/u);
    expect(await thu(db, "REVOKE UPDATE, DELETE, TRUNCATE ON public.bid_receipts FROM app_api")).toBe(
      "OK",
    );
    expect(await migrateLai(db)).toBe("OK");

    // Đột biến 2 — mức CỘT [review lượt 12, M1]. Quyền cột nằm ở `pg_attribute.attacl` và VÔ HÌNH
    // với `relacl`, nên bản đầu của vòng này để nó sống qua mọi deploy. `canonical_text` là CHÍNH
    // CHUỖI ĐƯỢC KÝ của biên nhận, nên đây chạm thẳng B2.
    expect(await thu(db, "GRANT UPDATE (canonical_text) ON public.bid_receipts TO app_api")).toBe(
      "OK",
    );
    expect(await migrateLai(db), "GRANT mức CỘT cũng phải làm migrate() NÉM").toMatch(
      /canonical_text/u,
    );
    expect(
      await thu(db, "REVOKE UPDATE (canonical_text) ON public.bid_receipts FROM app_api"),
    ).toBe("OK");
    expect(await migrateLai(db), "đối chứng dương").toBe("OK");
  }, 180000);

  it("[sổ nợ 16] bảng sổ không có cột nào NGOÀI chuỗi hash — phép ĐẾM không cấm cột thừa", async () => {
    // `MAU_HINH_DANG_SO` là `count(attname IN (15 tên)) = 15`: thêm một cột thứ 16 vẫn cho ra 15.
    // Đo được: `ALTER TABLE audit_events ADD COLUMN payload_plaintext text` -> MIGRATE OK,
    // applied=[]. Cột ấy nằm NGOÀI mọi trường mà `noi_chuoi_kiem_toan()` băm, tức nội dung sống
    // trong sổ kiểm toán mà chuỗi hash KHÔNG phủ — nền của B3 mất một mảng.
    expect(
      await thu(db, "ALTER TABLE public.audit_events ADD COLUMN payload_plaintext text"),
    ).toBe("OK");
    expect(await migrateLai(db), "cột ngoài chuỗi hash phải làm migrate() NÉM").toMatch(
      /payload_plaintext/u,
    );
    expect(await thu(db, "ALTER TABLE public.audit_events DROP COLUMN payload_plaintext")).toBe(
      "OK",
    );
    expect(await migrateLai(db), "đối chứng dương").toBe("OK");
  }, 180000);

  it("[sổ nợ 16] bảng gốc của cây tenant suy từ TÍNH CHẤT (đích của khoá ngoại org_id một cột), không từ tên 'organizations'", async () => {
    // Hôm nay `VI_TU_BANG_TENANT` giấu `OR relname IN ('organizations')` bên trong một vị từ
    // tính-chất. Đo được: 28 bảng có cột `org_id`, và cả 28 khoá ngoại MỘT CỘT `org_id` đều trỏ
    // tới `organizations` — tức tính chất ấy có thật và duy nhất, không cần cái tên.
    const { rows: goc } = await db.pool.query<{ goc: string }>(
      `SELECT DISTINCT ref.relname AS goc
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_class ref ON ref.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'
          AND array_length(con.conkey, 1) = 1
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = cl.oid
                        AND a.attnum = con.conkey[1] AND a.attname = 'org_id'
                        AND NOT a.attisdropped)`,
    );
    expect(goc.map((r) => r.goc)).toEqual(["organizations"]);

    // Đột biến: một bảng gốc tenant THỨ HAI — đúng khuôn của dự án, kèm policy đúng `HINH_DANG_
    // CHUAN` — phải được bật RLS + FORCE như `organizations`, và `migrate()` vẫn phải THÀNH CÔNG.
    // Vế thứ hai là đối chứng dương bắt buộc của vòng này: một vị từ rộng hơn sẽ CHẶN DEPLOY trên
    // một lược đồ hợp lệ, và đó là chế độ hỏng nguy hiểm hơn của file hardening.
    await db.pool.query("CREATE TABLE public.chi_nhanh (id uuid PRIMARY KEY)");
    await db.pool.query(
      `CREATE TABLE public.chi_nhanh_thanh_vien (
         id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES public.chi_nhanh(id))`,
    );
    await db.pool.query(
      `CREATE POLICY chi_nhanh_tenant_isolation ON public.chi_nhanh
         USING (id = app_current_org_id()) WITH CHECK (id = app_current_org_id())`,
    );
    await db.pool.query(
      `CREATE POLICY chi_nhanh_thanh_vien_tenant_isolation ON public.chi_nhanh_thanh_vien
         USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())`,
    );
    try {
      const ketQua = await migrateLai(db);
      const { rows } = await db.pool.query<{ ten: string; r: boolean; f: boolean }>(
        `SELECT relname AS ten, relrowsecurity AS r, relforcerowsecurity AS f FROM pg_class
          WHERE oid IN (to_regclass('public.chi_nhanh'), to_regclass('public.chi_nhanh_thanh_vien'))
          ORDER BY relname`,
      );
      expect(
        { migrate: ketQua, rls: rows },
        "bảng gốc tenant thứ hai phải được bật RLS + FORCE, và deploy vẫn phải đi qua",
      ).toEqual({
        migrate: "OK",
        rls: [
          { ten: "chi_nhanh", r: true, f: true },
          { ten: "chi_nhanh_thanh_vien", r: true, f: true },
        ],
      });
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS public.chi_nhanh_thanh_vien");
      await db.pool.query("DROP TABLE IF EXISTS public.chi_nhanh");
      await migrateLai(db);
    }
  }, 180000);

  it("[review lượt 12, H1] một bảng chỉ-ghi-thêm PHÂN MẢNH: mỗi LÁ cũng vào tập, và chốt trên CHA KHÔNG phủ LÁ", async () => {
    // Reviewer lượt 12 nêu ca này như một khả năng CHẶN DEPLOY trên lược đồ hợp lệ. Phép đo cho
    // thấy tiền đề *"hợp lệ"* SAI: lá thật sự TRUNCATE được, tức nó là một LỖ chứ không phải một
    // báo động giả. Bốn sự kiện, đo trên PostgreSQL 16:
    //   ⑴ `CREATE TRIGGER … BEFORE TRUNCATE` trên bảng CHA (relkind='p') CHẠY ĐƯỢC — nên ca "điều
    //      kiện không thoả mãn được bằng bất kỳ migration nào" KHÔNG tồn tại;
    //   ⑵ trigger cấp HÀNG ĐƯỢC nhân bản xuống lá (`tgparentid <> 0`, `tgisinternal = false`) nên
    //      LÁ cũng vào tập suy ra — đúng như reviewer nói;
    //   ⑶ trigger TRUNCATE thì KHÔNG được nhân bản (003:323-324 đã ghi), và
    //   ⑷ `TRUNCATE <lá>` **đi lọt** dù CHA có chốt.
    // Kết luận: đòi chốt trên từng lá là ĐÚNG, không phải quá chặt. Cái giá là một phân mảnh mới
    // thêm ngoài migration sẽ chặn deploy tới khi có chốt — ghi ở ADR-028 §6, và thông điệp của
    // mục canh nói thẳng ra điều đó.
    // Phân mảnh theo `id`, KHÔNG theo `org_id`: một cột `org_id` biến bảng này thành bảng tenant
    // và kéo theo mọi phép kiểm policy — thứ không liên quan gì tới điều đang đo ở đây.
    await db.pool.query("CREATE TABLE public.so_pm (id uuid) PARTITION BY LIST (id)");
    try {
      await db.pool.query(
        "CREATE TABLE public.so_pm_a PARTITION OF public.so_pm " +
          "FOR VALUES IN ('00000000-0000-4000-8000-00000000000a')",
      );
      await db.pool.query(
        "CREATE TRIGGER so_pm_chan BEFORE DELETE OR UPDATE ON public.so_pm " +
          "FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them()",
      );
      expect(
        await thu(
          db,
          "CREATE TRIGGER so_pm_chan_truncate BEFORE TRUNCATE ON public.so_pm " +
            "FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them()",
        ),
        "⑴ trigger TRUNCATE trên bảng CHA phải cắm được",
      ).toBe("OK");
      await db.pool.query("ALTER TABLE public.so_pm ENABLE ALWAYS TRIGGER so_pm_chan_truncate");

      const { rows } = await db.pool.query<{ relname: string }>(
        `${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`,
      );
      expect(rows.map((r) => r.relname), "⑵ CẢ cha lẫn lá đều vào tập suy ra").toEqual(
        [...BANG_CHI_GHI_THEM_THAT, "so_pm", "so_pm_a"].sort(),
      );

      const { rows: tg } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t " +
          " WHERE t.tgrelid = 'public.so_pm_a'::regclass AND NOT t.tgisinternal " +
          "   AND (t.tgtype & 32::int2) <> 0",
      );
      expect(tg[0]!.n, "⑶ trigger TRUNCATE KHÔNG được nhân bản xuống lá").toBe("0");

      expect(await thu(db, "TRUNCATE public.so_pm_a"), "⑷ TRUNCATE thẳng vào LÁ đi lọt").toBe("OK");
      expect(await thu(db, "TRUNCATE public.so_pm"), "TRUNCATE vào CHA thì bị chặn").toMatch(
        /chi duoc ghi them/u,
      );

      // Và vì lá là một lỗ thật, hardening phải KÊU về nó.
      expect(await migrateLai(db), "lá thiếu chốt TRUNCATE phải làm migrate() NÉM").toMatch(
        /so_pm_a/u,
      );
      // Đối chứng dương: cắm chốt cho lá xong thì deploy đi qua.
      await db.pool.query(
        "CREATE TRIGGER so_pm_a_chan_truncate BEFORE TRUNCATE ON public.so_pm_a " +
          "FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them()",
      );
      await db.pool.query(
        "ALTER TABLE public.so_pm_a ENABLE ALWAYS TRIGGER so_pm_a_chan_truncate",
      );
      expect(await migrateLai(db), "lá có chốt rồi thì deploy phải đi qua").toBe("OK");

      // [review lượt 12, M2] LƯỢT ĐỎ THẬT của vế `tgenabled = 'A'`. Đây là chỗ duy nhất đo được
      // nó: `so_pm_a` là bảng SUY RA, không mục ghim nào có tên nó, nên không có lớp tự chữa nào
      // che mất phán xét. Bản đầu của vòng này chỉ hỏi *có hàng nào mang bit 32 không* ⇒ mục XANH
      // trong khi `TRUNCATE` đi lọt.
      await db.pool.query("ALTER TABLE public.so_pm_a DISABLE TRIGGER so_pm_a_chan_truncate");
      expect(await thu(db, "TRUNCATE public.so_pm_a"), "chốt đã tắt thì TRUNCATE đi lọt").toBe("OK");
      expect(await migrateLai(db), "chốt bị TẮT trên bảng SUY RA phải làm migrate() NÉM").toMatch(
        /so_pm_a.*chốt TRUNCATE ĐANG BẬT/su,
      );
      await db.pool.query("ALTER TABLE public.so_pm_a ENABLE ALWAYS TRIGGER so_pm_a_chan_truncate");
      expect(await migrateLai(db), "đối chứng dương").toBe("OK");
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS public.so_pm CASCADE");
      await migrateLai(db);
    }
  }, 180000);

  it("[sổ nợ 3] cây role của dự án BẰNG tập tên được ghim — và một role lạ mang BYPASSRLS bị ĐẨY KHỎI cây", async () => {
    // KHOẢN NỢ 3 VIẾT: *"`NOBYPASSRLS` chỉ ghim đúng BỐN TÊN ROLE"*, và đọc thì đúng: bốn khối
    // `ARRAY[…]` trong `hardening.always.sql` gọi thẳng tên. Vòng này dựng một mục thứ năm suy từ
    // tính chất — rồi GỠ nó, vì phép đo bác bỏ tiền đề: **BƯỚC 1 thu hồi mọi tư cách thành viên
    // LẠ**, nên tập "role trong cây dự án" LUÔN BẰNG tập tên đã ghim. Cửa mà khoản nợ mô tả có
    // thật và ĐÃ ĐÓNG — bởi một lớp KHÁC với lớp mà khoản nợ chỉ tên.
    //
    // Thứ CÓ THỂ TRÔI thì được canh ở đây: ngày một migration mở danh sách trắng cho role thứ
    // năm, khẳng định "cây == tập ghim" ĐỎ, và người mở phải ghim nó hoặc viết ra vì sao không.
    const cay = async (): Promise<string[]> => {
      const { rows } = await db.pool.query<{ rolname: string }>(
        `SELECT vai.rolname FROM pg_roles vai
          WHERE NOT vai.rolsuper
            AND EXISTS (SELECT 1 FROM unnest(ARRAY['app_api', 'app_unseal']) AS g(ten)
                         WHERE to_regrole(g.ten) IS NOT NULL
                           AND pg_has_role(vai.oid, to_regrole(g.ten)::oid, 'MEMBER'))
          ORDER BY 1`,
      );
      return rows.map((r) => r.rolname);
    };

    // Tập tên mà hardening ghim `NOBYPASSRLS` — đọc THẲNG từ file, không viết tay lại.
    const daGhim = [...HARDENING.matchAll(/ALTER ROLE (\w+) NOSUPERUSER[^$]*?NOBYPASSRLS/gu)]
      .map((m) => m[1]!)
      .sort();
    expect(daGhim, "bốn tên được ghim NOBYPASSRLS").toEqual([
      "app_api",
      "app_api_login",
      "app_unseal",
      "app_unseal_login",
    ]);

    // Cây thật ⊆ tập ghim. (Hai role `*_login` chỉ tồn tại trên cụm đã tạo chúng, nên là tập con.)
    const truoc = await cay();
    expect(truoc.filter((r) => !daGhim.includes(r)), "cây role không được có tên ngoài tập ghim")
      .toEqual([]);

    // Đột biến: role thứ năm, có BYPASSRLS, là THÀNH VIÊN của `app_api` — tức thừa hưởng mọi quyền
    // của nó VÀ bỏ qua toàn bộ RLS. Đo được: sau `migrate()` nó KHÔNG còn trong cây.
    expect(await thu(db, "CREATE ROLE ke_gian BYPASSRLS NOLOGIN")).toBe("OK");
    try {
      expect(await thu(db, "GRANT app_api TO ke_gian")).toBe("OK");
      expect(await cay(), "trước migrate: ke_gian ở trong cây").toContain("ke_gian");
      expect(await migrateLai(db)).toBe("OK");
      expect(await cay(), "sau migrate: BƯỚC 1 phải đẩy ke_gian ra khỏi cây").toEqual(truoc);
    } finally {
      await db.pool.query("DROP ROLE IF EXISTS ke_gian");
    }
  }, 180000);
});
