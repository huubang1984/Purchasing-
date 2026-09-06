import { randomBytes } from "node:crypto";
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

// [ADR-016] `const ACTOR = { type: "SYSTEM" }` ĐÃ BIẾN MẤT khỏi file này, và sự biến mất ấy là
// nội dung chính của vòng sửa: một hằng số ba từ ở đầu file test là toàn bộ thứ mà mọi lời gọi
// dùng để KHAI mình là ai. Nay mỗi lời gọi phải cầm một `sessionId` có thật, và một phiên của
// tổ chức khác thì CSDL từ chối — xem "danh tính là dẫn xuất" ở cuối file.
let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;
/** Người dùng và phiên của mỗi tổ chức. `sA`/`sB` là thứ thay chỗ cho `ACTOR` cũ. */
let uA: string, uB: string;
let sA: string, sB: string;

async function taoNguoiVaPhien(orgId: string): Promise<{ userId: string; sessionId: string }> {
  const { rows: nguoi } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name, status) " +
      "VALUES ($1, $2, 'Nguoi thao tac', 'ACTIVE') RETURNING id",
    [orgId, "u-" + randomBytes(6).toString("hex") + "@x.vn"],
  );
  const userId = nguoi[0]?.id ?? "";
  const { rows: phien } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return { userId, sessionId: phien[0]?.id ?? "" };
}

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

  ({ userId: uA, sessionId: sA } = await taoNguoiVaPhien(orgA));
  ({ userId: uB, sessionId: sB } = await taoNguoiVaPhien(orgB));
  expect(sA).not.toBe("");
  expect(sB).not.toBe("");

  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("sổ nhà cung cấp — cô lập tổ chức", () => {
  it("[INV-F1] nhà cung cấp của tổ chức A không nhìn thấy được từ phiên của tổ chức B", async () => {
    const cua_a = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "NCC cua A", taxCode: "0101010101", actorSessionId: sA }),
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
      createSupplier(c, orgA, { legalName: "NCC co nguoi lien he", actorSessionId: sA }),
    );
    const lienHe = await withTenant(apiPool, orgA, (c) =>
      addSupplierContact(c, orgA, {
        supplierId: ncc.id,
        fullName: "Nguyen Van A",
        email: "a@vidu.vn",
        phone: "0900000001",
        actorSessionId: sA,
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
      createSupplier(c, orgA, { legalName: "Cung mot NCC, ho so cua A", taxCode: mst, actorSessionId: sA }),
    );
    const b = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Cung mot NCC, ho so cua B", taxCode: mst, actorSessionId: sB }),
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
      createSupplier(c, orgA, { legalName: "Ban ghi dau", taxCode: mst, actorSessionId: sA }),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        createSupplier(c, orgA, { legalName: "Ban ghi trung", taxCode: mst, actorSessionId: sA }),
      ),
    ).rejects.toThrow(/duplicate key|suppliers_org_id_tax_code_key/);
  });

  it("NHIỀU hàng tax_code NULL trong cùng tổ chức đều được — ngữ nghĩa NULL của UNIQUE, đo chứ không suy", async () => {
    // Hành vi này là CÓ CHỦ ĐÍCH (Level 0 — Guest Bidder chưa khai MST) và nó phụ thuộc vào một
    // mặc định của PostgreSQL (NULL <> NULL trong chỉ mục duy nhất). Một mặc định mà thiết kế
    // dựa vào thì phải được ĐO, không được SUY — cùng bài học với test hoa-thường của S0.
    const mot = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Khach 1, chua co MST", actorSessionId: sB }),
    );
    const hai = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Khach 2, chua co MST", actorSessionId: sB }),
    );
    expect(mot.taxCode).toBeNull();
    expect(hai.taxCode).toBeNull();
    expect(mot.level).toBe(0);
  });

  it("findSupplierByTaxCode chỉ trả lời trong phạm vi tổ chức đang gắn", async () => {
    const mst = "0404040404";
    await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Chi co o A", taxCode: mst, actorSessionId: sA }),
    );

    const oA = await withTenant(apiPool, orgA, (c) => findSupplierByTaxCode(c, orgA, mst));
    const oB = await withTenant(apiPool, orgB, (c) => findSupplierByTaxCode(c, orgB, mst));

    expect(oA?.taxCode).toBe(mst);
    expect(oB).toBeNull();
  });

  it("MST sai định dạng bị từ chối ở tầng ứng dụng, và thông báo KHÔNG chứa giá trị bị từ chối", async () => {
    await expect(
      withTenant(apiPool, orgA, (c) =>
        createSupplier(c, orgA, { legalName: "Sai dinh dang", taxCode: "abc", actorSessionId: sA }),
      ),
    ).rejects.toThrow(SupplierError);

    const loi: unknown = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Sai dinh dang", taxCode: "abc", actorSessionId: sA }),
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
      createSupplier(c, orgB, { legalName: "NCC thuoc B", actorSessionId: sB }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        addSupplierContact(c, orgA, {
          supplierId: cuaB.id,
          fullName: "Nguoi cua A",
          email: "x@vidu.vn",
          actorSessionId: sA,
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
        createSupplier(c, orgB, { legalName: "NCC thuoc B, lan hai", actorSessionId: sB }),
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
        actorSessionId: sA,
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
        await createSupplier(c, orgA, { legalName: "Se bi vut di", actorSessionId: sA });
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

// =============================================================================================
// [ADR-016] DANH TÍNH LÀ DẪN XUẤT — VÀ VẾ ĐỐI CHỨNG DƯƠNG ĐI TRƯỚC
//
// Vế đối chứng dương là phần chịu lực của cả khối này. Không có nó, "không tạo được nhà cung cấp
// dưới tên người khác" cũng XANH khi hàm hỏng theo mọi hướng khác — kể cả khi nó không ghi được
// hàng nào. Nên trước mỗi phép chặn phải có một lượt THÀNH CÔNG chứng minh đường đi vẫn thông.
// =============================================================================================
describe("danh tính là dẫn xuất, không phải lời khai", () => {
  it("ĐỐI CHỨNG DƯƠNG: với phiên hợp lệ, đường tạo nhà cung cấp vẫn thông và created_by ĐƯỢC GHI", async () => {
    const ncc = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Ban ghi co chu", actorSessionId: sA }),
    );

    const { rows } = await db.pool.query<{ created_by: string; created_by_session_id: string }>(
      "SELECT created_by, created_by_session_id FROM suppliers WHERE id = $1",
      [ncc.id],
    );
    // Bản S1.1 KHÔNG có hai cột này, nên câu hỏi "ai đã thêm nhà cung cấp này" chỉ trả lời được
    // từ một sổ kiểm toán mà chính nó nhận đầu vào là lời khai.
    expect(rows[0]?.created_by).toBe(uA);
    expect(rows[0]?.created_by_session_id).toBe(sA);
  });

  it("sổ kiểm toán ghi CHỦ PHIÊN, không ghi thứ người gọi tự đặt", async () => {
    const ncc = await withTenant(apiPool, orgA, (c) =>
      createSupplier(c, orgA, { legalName: "Kiem tra so", actorSessionId: sA }),
    );

    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string }>(
      "SELECT actor_type, actor_id FROM audit_events " +
        " WHERE org_id = $1 AND resource_id = $2 AND action = 'SUPPLIER_CREATED'",
      [orgA, ncc.id],
    );
    // Bản trước ghi `actor_type = SYSTEM, actor_id = NULL` cho ĐÚNG cùng lời gọi này, vì hằng số
    // `ACTOR` ở đầu file nói vậy. Không lớp nào phản đối.
    expect(rows[0]?.actor_type).toBe("USER");
    expect(rows[0]?.actor_id).toBe(uA);
  });

  it("phiên của TỔ CHỨC KHÁC bị từ chối — kể cả khi nó là một phiên có thật và còn hiệu lực", async () => {
    // ĐỐI CHỨNG DƯƠNG, cùng một phiên: ở ĐÚNG tổ chức của nó, `sB` hoạt động bình thường và ghi
    // đúng chủ nhân. Không có vế này, phép chặn dưới cũng xanh nếu `sB` chỉ đơn giản là hỏng.
    const cuaB = await withTenant(apiPool, orgB, (c) =>
      createSupplier(c, orgB, { legalName: "Phien cua B, dung cho B", actorSessionId: sB }),
    );
    const { rows } = await db.pool.query<{ created_by: string }>(
      "SELECT created_by FROM suppliers WHERE id = $1",
      [cuaB.id],
    );
    expect(rows[0]?.created_by).toBe(uB);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        createSupplier(c, orgA, { legalName: "Muon phien cua B", actorSessionId: sB }),
      ),
    ).rejects.toThrow(/phiên không hợp lệ/);
  });

  it("phiên ĐÃ THU HỒI bị từ chối — quy trình ứng phó sự cố phải đóng được đường ghi", async () => {
    const { sessionId } = await taoNguoiVaPhien(orgA);
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sessionId]);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        createSupplier(c, orgA, { legalName: "Phien da thu hoi", actorSessionId: sessionId }),
      ),
    ).rejects.toThrow(/phiên không hợp lệ/);
  });

  it("LỚP CÓ THẨM QUYỀN NẰM Ở CSDL: một INSERT viết tay khai created_by của người khác bị TRIGGER chặn", async () => {
    // Phép đo quan trọng nhất của khối này, và nó CỐ Ý KHÔNG đi qua gói `supplier`. Nếu lớp duy
    // nhất là `resolveSessionActor`, thì một câu SQL trong script vận hành — hoặc một hàm MỚI
    // trong chính gói này quên gọi nó — đi vòng qua mà không lớp nào kêu. Cùng lập luận ADR-014
    // đã dùng cho máy trạng thái RFQ.
    const nguoiKhac = await taoNguoiVaPhien(orgA);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
            " VALUES ($1, 'Khai man', $2, $3)",
          [orgA, nguoiKhac.userId, sA],
        ),
      ),
    ).rejects.toThrow(/khong khop chu phien/);
  });

  it("thiếu HẲN cột phiên cũng bị chặn — mặc định ĐÓNG, không phải bỏ qua khi NULL", async () => {
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("INSERT INTO suppliers (org_id, legal_name) VALUES ($1, 'Khong ky ten')", [orgA]),
      ),
    ).rejects.toThrow(/phai duoc dat/);
  });

  it("ĐỘT BIẾN: gỡ trigger đi thì câu INSERT khai man ĐI LỌT — bằng chứng trigger không rỗng ruột", async () => {
    await db.pool.query("DROP TRIGGER suppliers_kiem_danh_tinh ON suppliers");
    try {
      const nguoiKhac = await taoNguoiVaPhien(orgA);
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) " +
            " VALUES ($1, 'Khai man khi khong co trigger', $2, $3)",
          [orgA, nguoiKhac.userId, sA],
        ),
      );
      expect(rowCount, "không có trigger thì lời khai đi lọt — đó là lý do trigger tồn tại").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER suppliers_kiem_danh_tinh BEFORE INSERT ON suppliers " +
          " FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(" +
          " 'created_by', 'created_by_session_id')",
      );
    }
  });
});
