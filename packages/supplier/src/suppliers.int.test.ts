import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  SupplierError,
  addSupplierContact,
  createSupplier,
  findSupplierByTaxCode,
  getSupplier,
  listSupplierContacts,
  listSuppliers,
} from "./suppliers.js";

// =============================================================================================
// S1.1 — SỔ NHÀ CUNG CẤP, ĐO TRÊN POSTGRES THẬT DƯỚI ROLE `app_api`
//
// Mọi phép đo ở đây chạy qua `db.poolAs("app_api")`, KHÔNG qua pool superuser. Lý do đã được 002
// đo và ghi: SUPERUSER BỎ QUA RLS bất kể ENABLE hay FORCE, nên một test cô lập tổ chức chạy dưới
// superuser sẽ XANH VÌ LÝ DO SAI — nó chứng minh truy vấn có `WHERE`, không chứng minh CSDL chặn.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

const ACTOR = { type: "SYSTEM" } as const;

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);

  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
      "('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  orgA = rows[0]?.id ?? "";
  orgB = rows[1]?.id ?? "";
  expect(orgA).not.toBe("");
  expect(orgB).not.toBe("");

  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("sổ nhà cung cấp — cô lập tổ chức", () => {
  it("[INV-F1] nhà cung cấp của tổ chức A không nhìn thấy được từ phiên của tổ chức B", async () => {
    const cua_a = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "NCC cua A", taxCode: "0101010101", actor: ACTOR }),
    );

    const thayTuA = await withTenant(apiPool, orgA, (c) => getSupplier(c, orgA, cua_a.id));
    const thayTuB = await withTenant(apiPool, orgB, (c) => getSupplier(c, orgB, cua_a.id));

    // Dấu hiệu TÍCH CỰC rằng hàng có thật, trước khi kết luận gì từ việc không thấy nó.
    expect(thayTuA?.id).toBe(cua_a.id);
    expect(thayTuB).toBeNull();

    const danhSachB = await withTenant(apiPool, orgB, (c) => listSuppliers(c, orgB));
    expect(danhSachB.map((s) => s.id)).not.toContain(cua_a.id);
  });

  it("[INV-F1] người liên hệ cũng bị cắt theo tổ chức", async () => {
    const ncc = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "NCC co nguoi lien he", actor: ACTOR }),
    );
    const lienHe = await withTenant(apiPool, orgA, (c) =>
      addSupplierContact(c, orgA, {
        supplierId: ncc.id,
        fullName: "Nguyen Van A",
        email: "a@vidu.vn",
        phone: "0900000001",
        actor: ACTOR,
      }),
    );

    const tuA = await withTenant(apiPool, orgA, (c) => listSupplierContacts(c, orgA, ncc.id));
    const tuB = await withTenant(apiPool, orgB, (c) => listSupplierContacts(c, orgB, ncc.id));

    expect(tuA.map((x) => x.id)).toEqual([lienHe.id]);
    expect(tuB).toEqual([]);
  });

  it("assertTenantBound chặn lời gọi 'hỏi tổ chức A trên phiên gắn tổ chức B'", async () => {
    // Không có lớp này, lời gọi dưới đây KHÔNG lỗi — nó trả về `null`, và `null` đọc như "không
    // có nhà cung cấp đó" chứ không như "bạn đang hỏi sai chỗ". Đó là toàn bộ lý do nó tồn tại.
    await expect(
      withTenant(apiPool, orgB, (c) => getSupplier(c, orgA, "00000000-0000-4000-8000-000000000000")),
    ).rejects.toThrow(/getSupplier/);
  });
});

describe("ADR-013 — MST là dữ liệu, không phải khoá toàn cục", () => {
  it("CÙNG một MST tồn tại song song ở HAI tổ chức — đây là phép đo trực tiếp của ADR-013", async () => {
    const mst = "0202020202";
    const a = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Cung mot NCC, ho so cua A", taxCode: mst, actor: ACTOR }),
    );
    const b = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Cung mot NCC, ho so cua B", taxCode: mst, actor: ACTOR }),
    );

    // Một sổ dùng chung toàn cục với `UNIQUE (tax_code)` sẽ TỪ CHỐI hàng thứ hai — và chính lần
    // từ chối đó là oracle: nó nói cho tổ chức B biết một tổ chức khác đã có nhà cung cấp này.
    // Hai hàng cùng tồn tại là hình dạng mà ADR-013 chọn, kèm cái giá đã ghi ở đó: TRÙNG LẶP
    // xuyên tổ chức được chấp nhận ở S1, gộp hồ sơ (Level 2) là việc của S3+.
    expect(a.id).not.toBe(b.id);
    expect(a.taxCode).toBe(mst);
    expect(b.taxCode).toBe(mst);
  });

  it("trùng MST TRONG cùng một tổ chức thì bị chặn — ràng buộc vẫn có răng trong phạm vi của nó", async () => {
    const mst = "0303030303";
    await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Ban ghi dau", taxCode: mst, actor: ACTOR }),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        createSupplier(c, orgA, { legalName: "Ban ghi trung", taxCode: mst, actor: ACTOR }),
      ),
    ).rejects.toThrow(/duplicate key|suppliers_org_id_tax_code_key/);
  });

  it("NHIỀU hàng tax_code NULL trong cùng tổ chức đều được — ngữ nghĩa NULL của UNIQUE, đo chứ không suy", async () => {
    // Hành vi này là CÓ CHỦ ĐÍCH (Level 0 — Guest Bidder chưa khai MST) và nó phụ thuộc vào một
    // mặc định của PostgreSQL (NULL <> NULL trong chỉ mục duy nhất). Một mặc định mà thiết kế
    // dựa vào thì phải được ĐO, không được SUY — cùng bài học với test hoa-thường của S0.
    const mot = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Khach 1, chua co MST", actor: ACTOR }),
    );
    const hai = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Khach 2, chua co MST", actor: ACTOR }),
    );
    expect(mot.taxCode).toBeNull();
    expect(hai.taxCode).toBeNull();
    expect(mot.level).toBe(0);
  });

  it("findSupplierByTaxCode chỉ trả lời trong phạm vi tổ chức đang gắn", async () => {
    const mst = "0404040404";
    await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Chi co o A", taxCode: mst, actor: ACTOR }),
    );

    const oA = await withTenant(apiPool, orgA, (c) => findSupplierByTaxCode(c, orgA, mst));
    const oB = await withTenant(apiPool, orgB, (c) => findSupplierByTaxCode(c, orgB, mst));

    expect(oA?.taxCode).toBe(mst);
    expect(oB).toBeNull();
  });

  it("MST sai định dạng bị từ chối ở tầng ứng dụng, và thông báo KHÔNG chứa giá trị bị từ chối", async () => {
    await expect(
      withTenant(apiPool, orgA, (c) =>
        createSupplier(c, orgA, { legalName: "Sai dinh dang", taxCode: "abc", actor: ACTOR }),
      ),
    ).rejects.toThrow(SupplierError);

    const loi: unknown = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Sai dinh dang", taxCode: "abc", actor: ACTOR }),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(loi, "lời gọi phải NÉM thì phép đo dưới đây mới có nghĩa").toBeInstanceOf(SupplierError);
    // Quy ước của dự án: không nội suy dữ liệu đầu vào vào thông báo lỗi, vì thông báo đi vào
    // log và khuôn đó sẽ được sao chép sang chỗ dữ liệu ĐÚNG LÀ bí mật (giá thầu, token, OTP).
    expect((loi as Error).message).not.toContain("abc");
  });
});

describe("khoá ngoại HỢP THÀNH — và bằng chứng rằng khoá ngoại ĐƠN CỘT sẽ không đủ", () => {
  it("người liên hệ của tổ chức A KHÔNG treo được vào nhà cung cấp của tổ chức B", async () => {
    // Test này CỐ Ý KHÔNG mang nhãn `[INV-...]`. Nó đo một tính chất thật — ràng buộc tham chiếu
    // phải nằm TRONG một tổ chức — nhưng sổ đăng ký 47 mã hôm nay KHÔNG có mệnh đề nào phát biểu
    // điều đó: F1 nói về TRUY VẤN bị ràng buộc org_id, F2 nói về IDOR, F3 nói về khoá. Gắn một
    // trong ba nhãn ấy lên đây là lấp mã bằng NHÃN thay vì bằng LỚP — đúng thứ đã xảy ra hai lần
    // ở S0 và bị bắt cả hai lần. Nếu mệnh đề này đáng vào sổ, nó phải vào sổ tường minh.
    const cuaB = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "NCC thuoc B", actor: ACTOR }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        addSupplierContact(c, orgA, {
          supplierId: cuaB.id,
          fullName: "Nguoi cua A",
          email: "x@vidu.vn",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/foreign key|supplier_contacts_org_id_supplier_id_fkey/);
  });

  it("ĐỐI CHỨNG: cùng hàng đó ĐI LỌT khi khoá ngoại chỉ có một cột — lý do của thiết kế, đo được", async () => {
    // Không có phép đo này, câu "khoá ngoại đơn cột là một lỗ thật" trong 008 chỉ là một lời
    // khẳng định. Ở đây nó được dựng lại: cùng dữ liệu, cùng RLS, chỉ khác hình dạng khoá ngoại.
    await db.pool.query(
      "CREATE TABLE do_fk_don_cot (" +
        " id uuid PRIMARY KEY DEFAULT gen_random_uuid()," +
        " org_id uuid NOT NULL REFERENCES organizations(id)," +
        " supplier_id uuid NOT NULL REFERENCES suppliers(id))",
    );
    try {
      await db.pool.query("ALTER TABLE do_fk_don_cot ENABLE ROW LEVEL SECURITY");
      await db.pool.query("ALTER TABLE do_fk_don_cot FORCE ROW LEVEL SECURITY");
      await db.pool.query(
        "CREATE POLICY do_fk_don_cot_tenant ON do_fk_don_cot " +
          "USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())",
      );
      await db.pool.query("GRANT INSERT (org_id, supplier_id) ON do_fk_don_cot TO app_api");

      const cuaB = await withTenant(apiPool, orgB, (c) =>
        createSupplier(c, orgB, { legalName: "NCC thuoc B, lan hai", actor: ACTOR }),
      );

      // Hàng này mang org_id của A và supplier_id của B. RLS `WITH CHECK` chỉ soi org_id nên nó
      // thấy A và cho qua; khoá ngoại đơn cột chỉ hỏi "id này có trong suppliers không" — CÓ.
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query("INSERT INTO do_fk_don_cot (org_id, supplier_id) VALUES ($1, $2)", [
          orgA,
          cuaB.id,
        ]),
      );

      expect(
        rowCount,
        "Nếu dòng này KHÔNG chèn được thì lập luận của 008 về khoá ngoại hợp thành đã sai và " +
          "phải viết lại — không được để nguyên một chú thích không còn đúng.",
      ).toBe(1);
    } finally {
      await db.pool.query("DROP TABLE do_fk_don_cot");
    }
  });
});

describe("dấu vết kiểm toán", () => {
  it("tạo nhà cung cấp sinh ĐÚNG một sự kiện, và payload KHÔNG mang tên hay MST", async () => {
    const truoc = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'SUPPLIER_CREATED'",
      [orgA],
    );

    const ncc = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, {
        legalName: "Ten rieng khong duoc vao so",
        taxCode: "0505050505",
        level: 1,
        actor: ACTOR,
      }),
    );

    const sau = await db.pool.query<{ payload: Record<string, unknown>; resource_id: string }>(
      "SELECT payload, resource_id::text FROM audit_events " +
        " WHERE org_id = $1 AND action = 'SUPPLIER_CREATED' ORDER BY seq",
      [orgA],
    );

    expect(sau.rows.length).toBe(Number(truoc.rows[0]?.n ?? "0") + 1);
    const cuoi = sau.rows[sau.rows.length - 1];
    expect(cuoi?.resource_id).toBe(ncc.id);
    expect(cuoi?.payload).toEqual({ level: 1 });
    expect(JSON.stringify(cuoi?.payload)).not.toContain("Ten rieng");
    expect(JSON.stringify(cuoi?.payload)).not.toContain("0505050505");
  });

  it("sự kiện kiểm toán ROLLBACK cùng hàng nó mô tả — cùng transaction, không phải hai", async () => {
    const truoc = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
      [orgA],
    );

    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await createSupplier(c, orgA, { legalName: "Se bi vut di", actor: ACTOR });
        throw new Error("nga giua chung");
      }),
    ).rejects.toThrow("nga giua chung");

    const sau = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
      [orgA],
    );
    // Đây là lựa chọn KHÁC với `requirePermission` (nó ghi ở transaction ĐỘC LẬP để một lần TỪ
    // CHỐI không biến mất khi người gọi nuốt lỗi). Ở đây thứ được ghi là hệ quả của một thay đổi
    // dữ liệu, nên nó phải sống chết cùng thay đổi ấy — và test này ghim lựa chọn đó.
    expect(sau.rows[0]?.n).toBe(truoc.rows[0]?.n);
  });
});
