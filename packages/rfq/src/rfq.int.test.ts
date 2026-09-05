import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  RfqError,
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createRfq,
  extendRfqDeadline,
  getRfq,
  listRfqItems,
  openRfq,
  submitRfqForApproval,
} from "./rfq.js";
import { createProcurementPolicy, setRfqBudget } from "./procurement-policy.js";
import { issueRfqKeyPair } from "@trustprocure/sealed-envelope";

// =============================================================================================
// S1.2 — MÁY TRẠNG THÁI RFQ, ĐO TRÊN POSTGRES THẬT DƯỚI ROLE `app_api`
//
// Mọi phép đo chạy qua `db.poolAs("app_api")`. Superuser BỎ QUA RLS (đã đo ở 002), nên một test
// cô lập tổ chức chạy dưới superuser xanh VÌ LÝ DO SAI.
//
// Phép đo quan trọng nhất của file này KHÔNG đi qua gói `rfq`: nó chạy `UPDATE` thẳng bằng SQL.
// Đó là điểm của ADR-014 — nếu máy trạng thái nằm ở TypeScript, một câu SQL trong script vận
// hành đi vòng qua nó mà không lớp nào kêu.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
// [ADR-016] `const ACTOR = { type: "SYSTEM" }` da bien mat khoi file nay, va do la noi dung
// chinh cua vong sua: mot hang ba tu o dau file test la toan bo thu ma tam ham cua goi nay dung
// de KHAI minh la ai — roi ghi thang loi khai ay vao so kiem toan.

// =============================================================================================
// [S1.4 / ADR-019] BỘ BỌC KHOÁ GIẢ — VÀ VÌ SAO NÓ LÀ ĐỒ GIẢ CÓ CHỦ ĐÍCH
//
// `openRfq` nay đòi một `KeyWrapper` vì mở RFQ và sinh cặp khoá là MỘT việc (C5). File này đo
// MÁY TRẠNG THÁI, không đo phép bọc khoá — phép bọc đã có phép đo riêng ở
// `packages/crypto-keys/src/roundtrip.test.ts`, và vòng đời khoá có phép đo riêng ở
// `packages/sealed-envelope/src/key-material.int.test.ts`.
//
// Dùng đồ giả ở đây mua đúng một thứ đáng giá: `packages/rfq` KHÔNG có một cạnh phụ thuộc nào
// tới `@trustprocure/crypto-keys`, kể cả trong test. Đó là lý do `@trustprocure/sealed-envelope`
// chuyển tiếp KIỂU `KeyWrapper` thay vì bắt người gọi tự đi lấy.
//
// *** ĐÂY KHÔNG PHẢI MÃ HOÁ. *** Nó đảo bit rồi trả lại. Ai chép đoạn này ra khỏi file test là
// đang cất khoá riêng RFQ dưới dạng gần-như-rõ. Tên hàm nói đúng thứ nó là.
// =============================================================================================
const boBocGia = {
  name: "gia-cho-test-may-trang-thai",
  wrap: (_orgId: string, plaintext: Uint8Array) =>
    Promise.resolve({ ciphertext: plaintext.map((b) => b ^ 0xff), keyVersion: "gia-v1" }),
};

const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const MAI_SAU_XA = new Date(Date.now() + 14 * 24 * 3600 * 1000);

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;
/** u1 tạo RFQ; u2 và u3 là hai người duyệt. */
let u1: string, u2: string, u3: string;
/** s2/s3 là phiên của u2/u3; s2b là phiên THỨ HAI của u2. */
let s1: string, s2: string, s3: string, s2b: string;

/**
 * [H-2, vòng sửa sau review an ninh] Phiên phải mang `mfa_verified_at`: trigger `rfq_kiem_nguoi_duyet`
 * (011) nay từ chối phiên hết hạn, bị thu hồi, hoặc chưa qua MFA. Bản 009 chỉ đọc `user_id`, nên
 * một phiên ĐÃ BỊ THU HỒI vì nghi ngờ chiếm đoạt vẫn ký được một phê duyệt — quy trình ứng phó sự
 * cố "thu hồi hết phiên của người này" không đóng được đường phê duyệt.
 */
async function taoPhien(orgId: string, userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgId, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** RFQ ở DRAFT kèm một hạng mục — điểm xuất phát của hầu hết phép đo dưới đây. */
// [ADR-017] `requiresDualApproval` khong con la mot co tu khai. RFQ luon ra doi o `true`, va
// duong DUY NHAT ha no xuong `false` la `setRfqBudget` — thu phai tro toi mot chinh sach co that
// va de CSDL tinh phep so. Tham so cua helper nay vi vay DOI NGHIA: no khong con DAT mot co, no
// chon mot SO TIEN nam duoi hay tren nguong. Nguong cua orgA la 100 trieu, dat o beforeAll.
async function rfqNhap(orgId = orgA, requiresDualApproval = false): Promise<string> {
  return withTenant(apiPool, orgId, async (c) => {
    const r = await createRfq(c, orgId, {
      title: "Mua thep tam",
      deadlineAt: MAI_SAU,
      createdBySessionId: s1,
    });
    await setRfqBudget(c, orgId, {
      rfqId: r.id,
      estimatedValue: requiresDualApproval ? "200000000.00" : "1000000.00",
      currency: "VND",
      actorSessionId: s1,
    });
    await addRfqItem(c, orgId, {
      rfqId: r.id,
      lineNo: 1,
      description: "Thep tam SS400 3mm",
      quantity: "100.0000",
      unit: "tam",
      actorSessionId: s1,
    });
    return r.id;
  });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);

  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
      "('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  orgB = orgs.rows[1]?.id ?? "";

  const users = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES " +
      "($1, 'u1@vidu.vn', 'Nguoi tao'), ($1, 'u2@vidu.vn', 'Nguoi duyet 1'), " +
      "($1, 'u3@vidu.vn', 'Nguoi duyet 2') RETURNING id",
    [orgA],
  );
  u1 = users.rows[0]?.id ?? "";
  u2 = users.rows[1]?.id ?? "";
  u3 = users.rows[2]?.id ?? "";

  // [khoản nợ 31] `u1` là người MỞ và HUỶ trong cả bộ test này, nên nó phải giữ `rfq.open` và
  // `rfq.cancel` — hai mã ra đời ở `023`, và `PROCUREMENT_MANAGER` là vai trò duy nhất giữ chúng.
  // Trước vòng sửa ấy, `u1` KHÔNG có một vai trò nào và vẫn mở/huỷ được mọi RFQ; đó chính là
  // khiếm khuyết, và việc bộ test này từng xanh với một người dùng không vai trò là bằng chứng.
  //
  // `u2` cũng giữ vai trò ấy, và điều đó KHÔNG làm hỏng điểm của khối "bốn cạnh mang chữ ký":
  // khối ấy chứng minh BA NGƯỜI KHÁC NHAU ký ba cạnh, không chứng minh ba QUYỀN khác nhau. `u3`
  // thì cố ý KHÔNG được cấp — nó chỉ đóng thầu, và `closeRfq` không có cổng quyền.
  await db.pool.query(
    "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'PROCUREMENT_MANAGER'), " +
      "($1, $3, 'PROCUREMENT_MANAGER')",
    [orgA, u1, u2],
  );

  s1 = await taoPhien(orgA, u1);
  s2 = await taoPhien(orgA, u2);
  s3 = await taoPhien(orgA, u3);
  s2b = await taoPhien(orgA, u2);

  expect([orgA, orgB, u1, u2, u3, s1, s2, s3, s2b].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");

  // [ADR-017] Chinh sach cua orgA: nguong 100 trieu VND. Moi RFQ cua bo test nay di qua no.
  await withTenant(apiPool, orgA, (c) =>
    createProcurementPolicy(c, orgA, {
      version: 1,
      dualApprovalThreshold: "100000000.00",
      currency: "VND",
      actorSessionId: s1,
    }),
  );
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("máy trạng thái — cưỡng chế ở tầng CSDL, không ở tầng ứng dụng", () => {
  it("ĐI VÒNG QUA ỨNG DỤNG: `UPDATE ... SET status='OPEN'` trên RFQ đã CLOSED bị TRIGGER chặn", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
      await closeRfq(c, orgA, { rfqId, reason: "het han", actorSessionId: s1 });
    });

    // KHÔNG gọi hàm nào của gói `rfq`. Đây là phép đo duy nhất chứng minh lớp nằm ở CSDL.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN' WHERE id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/Chuyen trang thai RFQ khong hop le: CLOSED -> OPEN/);

    const sau = await withTenant(apiPool, orgA, (c) => getRfq(c, orgA, rfqId));
    expect(sau?.status).toBe("CLOSED");
  });

  it("ĐỐI CHỨNG ĐỘT BIẾN: gỡ trigger đi thì CHÍNH câu UPDATE ấy ĐI LỌT", async () => {
    // Không có phép đo này, test trên xanh kể cả khi thứ chặn là một thứ khác — một CHECK, một
    // quyền cột, hay một sự trùng hợp. Ở đây trigger bị gỡ, cùng câu lệnh chạy lại, và nó QUA.
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
      await closeRfq(c, orgA, { rfqId, reason: "het han", actorSessionId: s1 });
    });

    await db.pool.query("DROP TRIGGER rfq_packages_kiem_chuyen_trang_thai ON rfq_packages");
    try {
      // [Vòng sửa sau review an ninh] Lượt đo này ĐÃ ĐỔI KẾT QUẢ, và đổi theo hướng tốt. Trước
      // 011, gỡ trigger đi thì câu UPDATE ĐI LỌT (rowCount = 1) — đó là bằng chứng trigger là
      // lớp duy nhất. Sau 011 nó vẫn đỏ, nhưng bằng một lớp KHÁC có tên:
      // rfq_chua_dong_thi_khong_co_moc_dong, một CHECK đóng chiều ngược mà 009 để trống (status
      // quay về OPEN trong khi closed_at vẫn NOT NULL).
      //
      // Giữ nguyên phép đo thay vì xoá, và khẳng định ĐÚNG thứ đang chặn: hai lớp độc lập cùng
      // canh một cạnh là kết quả mong muốn, nhưng nó phải được NÓI RA — không được để một test
      // cũ xanh vì một lý do khác với lý do nó được viết.
      const loi = await withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN' WHERE id = $1", [rfqId]),
      ).then(
        () => null,
        (e: unknown) => e as { constraint?: string },
      );
      expect(loi?.constraint).toBe("rfq_chua_dong_thi_khong_co_moc_dong");

      // ... và khi CẢ HAI lớp bị vô hiệu (gỡ trigger + xoá mốc đóng), câu ấy ĐI LỌT. Đây mới là
      // vế chứng minh không có lớp thứ ba nào đang âm thầm gánh.
      const { rowCount } = await withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN', closed_at = NULL WHERE id = $1", [
          rfqId,
        ]),
      );
      expect(rowCount).toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_chuyen_trang_thai BEFORE UPDATE ON rfq_packages " +
          "FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_chuyen_trang_thai()",
      );
      // Trả RFQ về CLOSED để không rò trạng thái sang test khác.
      // Dọn: trả cả trạng thái LẪN mốc đóng, vì lượt đo trên đã xoá mốc. Không có vế thứ hai,
      // chính câu dọn này đỏ vì `rfq_da_dong_thi_co_moc_dong` — đã vấp phải khi chạy lại.
      await db.pool.query(
        "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now() WHERE id = $1",
        [rfqId],
      );
    }
  });

  it("mọi cạnh HỢP LỆ đi được — đối chứng dương, chống quy tắc chặn-tất-cả", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
      await closeRfq(c, orgA, { rfqId, reason: "het han", actorSessionId: s1 });
      // ~~Hai cạnh cuối chưa có hàm sản phẩm (S1.6 và S2), nên đo thẳng bằng SQL.~~
      // [S1.6] Cạnh `CLOSED -> UNSEALED` NAY ĐÒI một yêu cầu mở thầu đã được phê duyệt (trigger
      // `rfq_packages_kiem_yeu_cau_mo_thau`, 019). Test này đỏ ở đúng lượt chạy đầu sau khi 019
      // áp — và nó đỏ vì một lớp MỚI đứng đúng chỗ, không vì máy trạng thái hỏng.
      //
      // Dựng yêu cầu bằng SQL viết tay chứ không gọi `@trustprocure/unseal`: `packages/rfq` không
      // cần một cạnh phụ thuộc tới gói ấy lúc chạy, và fixture ở đây chỉ cần trạng thái, không
      // cần cổng chính sách.
      const { rows: yc } = await c.query<{ id: string }>(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, " +
          "requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
        [orgA, rfqId, u1, s1],
      );
      await c.query(
        "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, " +
          "approver_session_id) VALUES ($1, $2, $3, $4)",
        [orgA, yc[0]?.id ?? "", u2, s2],
      );
      await c.query(
        "UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1",
        [yc[0]?.id ?? ""],
      );
      await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
    });
    const sau = await withTenant(apiPool, orgA, (c) => getRfq(c, orgA, rfqId));
    expect(sau?.status).toBe("EVALUATING");
  });

  it("bỏ qua một bậc cũng bị chặn: DRAFT -> OPEN không phải một cạnh", async () => {
    const rfqId = await rfqNhap();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now() WHERE id = $1", [
          rfqId,
        ]),
      ),
    ).rejects.toThrow(/DRAFT -> OPEN/);
  });

  it("không mở được RFQ không có hạng mục nào", async () => {
    const rfqId = await withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, {
        title: "RFQ rong",
        deadlineAt: MAI_SAU,
          createdBySessionId: s1,
      });
      await setRfqBudget(c, orgA, {
        rfqId: r.id,
        estimatedValue: "1000000.00",
        currency: "VND",
        actorSessionId: s1,
      });
      await submitRfqForApproval(c, orgA, { rfqId: r.id, actorSessionId: s1 });
      return r.id;
    });

    await expect(
      withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool)),
    ).rejects.toThrow(/khong co hang muc nao/);
  });
});

describe("D2 — phê duyệt kép ở phía RFQ", () => {
  it("RFQ cần hai phê duyệt KHÔNG mở được khi mới có một", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await approveRfq(c, orgA, { rfqId, sessionId: s2 });
    });

    await expect(
      withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool)),
    ).rejects.toThrow(/can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 1/);

    // ... và mở được ngay khi có người thứ hai. Vế dương là bắt buộc: không có nó, một trigger
    // luôn từ chối cũng làm test trên xanh.
    await withTenant(apiPool, orgA, (c) =>
      approveRfq(c, orgA, { rfqId, sessionId: s3 }),
    );
    const mo = await withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool));
    expect(mo.status).toBe("OPEN");
    expect(mo.openedAt).not.toBeNull();
  });

  it("người TẠO RFQ không được là một trong hai người duyệt", async () => {
    const rfqId = await rfqNhap(orgA, true);
    const s1 = await taoPhien(orgA, u1);
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, sessionId: s1 }),
      ),
    ).rejects.toThrow(/Nguoi tao RFQ khong duoc la mot trong hai nguoi duyet/);
  });

  it("một người không duyệt được hai lần, kể cả từ hai phiên khác nhau", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await approveRfq(c, orgA, { rfqId, sessionId: s2 });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, sessionId: s2b }),
      ),
    ).rejects.toThrow(/rfq_approvals_mot_nguoi_mot_lan|duplicate key/);
  });

  // ===========================================================================================
  // TEST NÀY ĐỔI NGHĨA Ở VÒNG ADR-016, VÀ SỰ ĐỔI NGHĨA ẤY LÀ THỨ ĐÁNG ĐỌC NHẤT Ở ĐÂY
  //
  // Nguyên văn cũ, giữ lại để đối chiếu:
  //     it("phiên được dẫn ra phải THUỘC VỀ người duyệt — mượn phiên của người khác bị chặn")
  //       approveRfq(c, orgA, { rfqId, approverUserId: u3, sessionId: s2 })
  //         -> rejects /Phien duoc dan ra khong thuoc ve nguoi duyet/
  //
  // Sau khi `approverUserId` trở thành DẪN XUẤT của `sessionId`, ca ấy KHÔNG CÒN VIẾT RA ĐƯỢC:
  // không có hai tham số để cho lệch nhau. Lỗ bị đóng bằng HÌNH DẠNG CHỮ KÝ, không bằng một phép
  // kiểm — mạnh hơn một bậc, vì một phép kiểm có thể quên gọi còn một tham số không tồn tại thì
  // không ai truyền được.
  //
  // Nhưng XOÁ test là sai: trigger ở CSDL vẫn phải còn răng, vì nó canh MỌI đường chứ không chỉ
  // đường đi qua gói này. Nên test được viết lại để đo đúng thứ đó — bằng SQL VIẾT TAY.
  // ===========================================================================================
  it("LỚP CSDL VẪN CÒN RĂNG: INSERT viết tay khai người duyệt lệch chủ phiên bị trigger chặn", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );

    // u3 là người duyệt được khai, nhưng phiên dẫn ra là của u2.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) " +
            " VALUES ($1, $2, $3, $4)",
          [orgA, rfqId, u3, s2],
        ),
      ),
    ).rejects.toThrow(/Phien duoc dan ra khong thuoc ve nguoi duyet/);

    // ĐỐI CHỨNG DƯƠNG: cùng câu INSERT ấy, với cặp KHỚP nhau, đi qua.
    const { rowCount } = await withTenant(apiPool, orgA, (c) =>
      c.query(
        "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) " +
          " VALUES ($1, $2, $3, $4)",
        [orgA, rfqId, u2, s2],
      ),
    );
    expect(rowCount).toBe(1);
  });

  it("chỉ phê duyệt được RFQ đang ở PENDING_APPROVAL", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId, sessionId: s2 }),
      ),
    ).rejects.toThrow(/dang o PENDING_APPROVAL, RFQ nay dang DRAFT/);
  });
});

describe("C4 — deadline (phần cưỡng chế được ở S1.2)", () => {
  it("deadline KHÔNG lùi được, kể cả khi RFQ còn DRAFT — HAI lớp, hai thông báo", async () => {
    // [REVIEW AN NINH S1.7 — MED-1] Test này từng khẳng định ĐÚNG MỘT thông báo — thông báo của
    // trigger. Nó xanh, và nó che mất một điều: hàm ứng dụng lúc ấy KHÔNG có phép kiểm nào cả,
    // nên ca `NEW = OLD` (bằng nhau, không lùi) đi lọt cả hai lớp và ghi một bản ghi kiểm toán
    // cho một lần gia hạn không xảy ra. Nay hai lớp được đo RIÊNG.
    const rfqId = await rfqNhap();
    const somHon = new Date(MAI_SAU.getTime() - 24 * 3600 * 1000);

    // Lớp ỨNG DỤNG: nó định nghĩa "gia hạn" là ĐẨY RA XA, nên nó chặn trước và nói rõ hơn.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: somHon,
          reason: "khach giuc",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(/đẩy hạn nộp RA XA hơn/);

    // Và ca BẰNG NHAU — thứ trigger KHÔNG chặn, vì kiểm (c) của 011 có vế bảo vệ
    // `NEW IS DISTINCT FROM OLD` nên với hạn bằng nhau nó còn không chạy.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: MAI_SAU,
          reason: "gia han bang chinh no",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(/đẩy hạn nộp RA XA hơn/);

    // Lớp CSDL: cùng phép lùi ấy đi bằng SQL viết tay vẫn bị chặn. Đây là lớp canh MỌI đường,
    // và nó là lý do lớp ứng dụng ở trên KHÔNG phải một bản sao thừa.
    await expect(
      db.pool.query("UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1", [rfqId, somHon]),
    ).rejects.toThrow(/Khong duoc rut ngan hay xoa deadline/);
  });

  it("gia hạn khi đang OPEN thì được, và nó để lại lý do trong sổ kiểm toán", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
      await extendRfqDeadline(c, orgA, {
        rfqId,
        newDeadlineAt: MAI_SAU_XA,
        reason: "nha cung cap xin them thoi gian",
        actorSessionId: s1,
      });
    });

    const { rows } = await db.pool.query<{ payload: { reason?: string } }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_DEADLINE_EXTENDED' " +
        "  AND resource_id = $2",
      [orgA, rfqId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.payload.reason).toBe("nha cung cap xin them thoi gian");
  });

  it("gia hạn KHÔNG được nữa sau khi RFQ đã CLOSED", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
      await closeRfq(c, orgA, { rfqId, reason: "het han", actorSessionId: s1 });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: MAI_SAU_XA,
          reason: "mo lai",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(/Chi doi duoc deadline khi RFQ dang DRAFT hoac OPEN/);
  });

  it("gia hạn KHÔNG có lý do bị từ chối ở tầng ứng dụng", async () => {
    const rfqId = await rfqNhap();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        extendRfqDeadline(c, orgA, {
          rfqId,
          newDeadlineAt: MAI_SAU_XA,
          reason: "   ",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(RfqError);
  });
});

describe("hạng mục chỉ sửa được khi RFQ còn soạn", () => {
  it("thêm/sửa/xoá hạng mục bị chặn sau khi RFQ đã OPEN", async () => {
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        addRfqItem(c, orgA, {
          rfqId,
          lineNo: 2,
          description: "Them dong sau khi da mo",
          quantity: "1.0000",
          unit: "cai",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(/Chi sua duoc hang muc khi RFQ con o DRAFT/);

    // [011] Quyền DELETE trên `rfq_items` ĐÃ BỊ THU HỒI: trong toàn kho mã không có một câu
    // DELETE nào, và một quyền cấp "cho chắc" là một quyền không ai gỡ ra nữa. Nay câu này chết ở
    // TẦNG QUYỀN, sớm hơn trigger một bậc — và đó là lớp mạnh hơn, không phải lớp khác.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("DELETE FROM rfq_items WHERE rfq_id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/permission denied/);

    const conNguyen = await withTenant(apiPool, orgA, (c) => listRfqItems(c, orgA, rfqId));
    expect(conNguyen.length).toBe(1);
  });
});

describe("cô lập tổ chức", () => {
  it("[INV-F1] RFQ của tổ chức A không nhìn thấy được từ phiên của tổ chức B", async () => {
    const rfqId = await rfqNhap();
    const tuA = await withTenant(apiPool, orgA, (c) => getRfq(c, orgA, rfqId));
    const tuB = await withTenant(apiPool, orgB, (c) => getRfq(c, orgB, rfqId));
    expect(tuA?.id).toBe(rfqId);
    expect(tuB).toBeNull();
  });

  it("[INV-F1] hạng mục cũng bị cắt theo tổ chức", async () => {
    const rfqId = await rfqNhap();
    const tuA = await withTenant(apiPool, orgA, (c) => listRfqItems(c, orgA, rfqId));
    const tuB = await withTenant(apiPool, orgB, (c) => listRfqItems(c, orgB, rfqId));
    expect(tuA.length).toBe(1);
    expect(tuB).toEqual([]);
  });
});

describe("huỷ RFQ", () => {
  it("huỷ được từ DRAFT, và sau khi huỷ thì không đi tiếp được", async () => {
    const rfqId = await rfqNhap();
    const huy = await withTenant(apiPool, orgA, (c) =>
      cancelRfq(c, orgA, { rfqId, reason: "khong con nhu cau", actorSessionId: s1 }, apiPool),
    );
    expect(huy.status).toBe("CANCELLED");
    expect(huy.cancelledAt).not.toBeNull();

    await expect(
      withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 })),
    ).rejects.toThrow(/không ở trạng thái nguồn hợp lệ/);
  });

  it("KHÔNG huỷ được RFQ đã CLOSED — cạnh đó không có trong bảng cạnh", async () => {
    // Có chủ đích, và nó theo đúng docs/ARCHITECTURE.md §6: ba mũi tên tới CANCELLED xuất phát từ
    // DRAFT, PENDING_APPROVAL và OPEN. Sau CLOSED thì phong bì đã nộp đang nằm trong hệ thống, và
    // "huỷ" lúc đó là một nghiệp vụ khác cần thiết kế riêng, không phải một cạnh thêm vào.
    const rfqId = await rfqNhap();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
      await closeRfq(c, orgA, { rfqId, reason: "het han", actorSessionId: s1 });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        cancelRfq(c, orgA, { rfqId, reason: "doi y", actorSessionId: s1 }, apiPool),
      ),
    // [H-3] Câu UPDATE nay ghim trạng thái nguồn, nên nó chạm 0 hàng và hàm ném TRƯỚC khi trigger
    // kịp nói gì. Cạnh `CLOSED->CANCELLED` vẫn không có trong bảng cạnh — test "đi vòng qua ứng
    // dụng" ở trên mới là chỗ đo trigger.
    ).rejects.toThrow(/không ở trạng thái nguồn hợp lệ/);
  });
});

// =============================================================================================
// [ADR-017] NGƯỠNG PHÊ DUYỆT KÉP — CHÍNH SÁCH THEO TỔ CHỨC, CÓ PHIÊN BẢN, TÁI LẬP ĐƯỢC
//
// Trước migration 014, `requires_dual_approval` là một cờ NGƯỜI GỌI đặt và không một dòng mã nào
// tính nó. Khối này đo bốn thứ: phân loại chạy đúng, hạ cờ mà KHÔNG có bằng chứng thì bị chặn ở
// tầng CSDL, phân loại cũ KHÔNG đổi khi chính sách xoay, và bằng chứng không sửa được sau khi
// RFQ rời DRAFT.
// =============================================================================================
describe("chính sách mua sắm và ngưỡng phê duyệt kép", () => {
  it("ĐỐI CHỨNG DƯƠNG: dưới ngưỡng thì hạ được cờ; trên ngưỡng thì KHÔNG", async () => {
    const duoi = await rfqNhap(orgA, false);
    const tren = await rfqNhap(orgA, true);

    const { rows } = await db.pool.query<{ id: string; requires_dual_approval: boolean }>(
      "SELECT id, requires_dual_approval FROM rfq_packages WHERE id = ANY($1::uuid[])",
      [[duoi, tren]],
    );
    const theoId = new Map(rows.map((h) => [h.id, h.requires_dual_approval]));
    expect(theoId.get(duoi)).toBe(false);
    expect(theoId.get(tren)).toBe(true);
  });

  it("bằng chứng được LƯU, và nó trỏ tới đúng phiên bản chính sách đã dùng", async () => {
    const rfqId = await rfqNhap(orgA, false);
    const { rows } = await db.pool.query<{ estimated_value: string; version: number }>(
      "SELECT b.estimated_value, p.version FROM rfq_budgets b " +
        " JOIN org_procurement_policies p ON p.id = b.policy_id WHERE b.rfq_id = $1",
      [rfqId],
    );
    // Đây là câu trả lời cho "vì sao RFQ này chỉ cần một phê duyệt". Trước 014 nó không tồn tại.
    expect(rows[0]?.estimated_value).toBe("1000000.00");
    expect(rows[0]?.version).toBe(1);
  });

  it("LỚP CÓ THẨM QUYỀN Ở CSDL: hạ cờ bằng SQL VIẾT TAY rồi nộp duyệt bị TRIGGER chặn", async () => {
    const rfqId = await rfqNhap(orgA, true);

    // Đi vòng qua `setRfqBudget`: đây là chỗ duy nhất chứng minh lớp nằm ở CSDL. Câu UPDATE này
    // THÀNH CÔNG — hạ cờ khi còn DRAFT là hợp lệ về lược đồ.
    await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE rfq_packages SET requires_dual_approval = false WHERE id = $1", [rfqId]),
    );

    // Nhưng cạnh đi vào vòng phê duyệt thì đòi BẰNG CHỨNG, và bằng chứng nói ngược lại.
    await expect(
      withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 })),
    ).rejects.toThrow(/phai can hai phe duyet/);
  });

  it("KHÔNG có ngân sách nào thì cũng không hạ cờ được — mặc định ĐÓNG", async () => {
    const rfqId = await withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, {
        title: "RFQ khong ngan sach",
        deadlineAt: MAI_SAU,
          createdBySessionId: s1,
      });
      await addRfqItem(c, orgA, {
        rfqId: r.id,
        lineNo: 1,
        description: "Mot hang muc",
        quantity: "1.0000",
        unit: "cai",
        actorSessionId: s1,
      });
      await c.query("UPDATE rfq_packages SET requires_dual_approval = false WHERE id = $1", [r.id]);
      return r.id;
    });

    await expect(
      withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 })),
    ).rejects.toThrow(/chua co ngan sach va chinh sach/);
  });

  it("TÁI LẬP ĐƯỢC: xoay chính sách sang phiên bản mới KHÔNG đổi phân loại của RFQ cũ", async () => {
    const cu = await rfqNhap(orgA, false);

    // Phiên bản 2 hạ ngưỡng xuống dưới giá trị của RFQ trên. Nếu phân loại được tính lại từ
    // "chính sách hiện hành", RFQ cũ sẽ đổi nghĩa sau lưng mọi người.
    await withTenant(apiPool, orgA, (c) =>
      createProcurementPolicy(c, orgA, {
        version: 2,
        dualApprovalThreshold: "500000.00",
        currency: "VND",
        actorSessionId: s1,
      }),
    );

    const { rows } = await db.pool.query<{ requires_dual_approval: boolean; version: number }>(
      "SELECT r.requires_dual_approval, p.version FROM rfq_packages r " +
        " JOIN rfq_budgets b ON b.rfq_id = r.id " +
        " JOIN org_procurement_policies p ON p.id = b.policy_id WHERE r.id = $1",
      [cu],
    );
    expect(rows[0]?.requires_dual_approval).toBe(false);
    expect(rows[0]?.version).toBe(1);
  });

  it("chính sách KHÔNG SỬA ĐƯỢC — `app_api` không có UPDATE, và đó là toàn bộ cơ chế", async () => {
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE org_procurement_policies SET dual_approval_threshold = 1 WHERE version = 1"),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("bằng chứng không sửa được sau khi RFQ rời DRAFT", async () => {
    const rfqId = await rfqNhap(orgA, false);
    await withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }));

    await expect(
      withTenant(apiPool, orgA, (c) =>
        setRfqBudget(c, orgA, {
          rfqId,
          estimatedValue: "999.00",
          currency: "VND",
          actorSessionId: s1,
        }),
      ),
    ).rejects.toThrow(/DRAFT/);
  });

  it("ĐỘT BIẾN: gỡ trigger ngưỡng thì cờ hạ bằng tay ĐI LỌT vào vòng phê duyệt", async () => {
    const rfqId = await rfqNhap(orgA, true);
    await withTenant(apiPool, orgA, (c) =>
      c.query("UPDATE rfq_packages SET requires_dual_approval = false WHERE id = $1", [rfqId]),
    );

    await db.pool.query(
      "DROP TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep ON rfq_packages",
    );
    try {
      await withTenant(apiPool, orgA, (c) =>
        submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
      );
      const { rows } = await db.pool.query<{ status: string }>(
        "SELECT status FROM rfq_packages WHERE id = $1",
        [rfqId],
      );
      expect(rows[0]?.status, "không có trigger thì bằng chứng chỉ là một hàng dữ liệu").toBe(
        "PENDING_APPROVAL",
      );
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep BEFORE UPDATE ON rfq_packages " +
          " FOR EACH ROW WHEN (NEW.status IN ('PENDING_APPROVAL', 'OPEN') " +
          "   AND NEW.status IS DISTINCT FROM OLD.status) " +
          " EXECUTE FUNCTION public.rfq_kiem_nguong_phe_duyet_kep()",
      );
    }
  });

  it("số tiền KHÔNG vào sổ kiểm toán — ngân sách rò xuống bên bán là NEO GIÁ", async () => {
    const rfqId = await rfqNhap(orgA, false);
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE resource_id = $1 AND action = 'RFQ_BUDGET_SET'",
      [rfqId],
    );
    const p = rows[0]?.payload ?? {};
    expect(Object.keys(p).sort()).toEqual(["policyVersion", "requiresDualApproval"]);
    expect(JSON.stringify(p)).not.toContain("1000000");
  });

  it("`estimated_value` KHÔNG nằm trên `rfq_packages` — bảng không có cột thì không có gì để nhớ", async () => {
    // Lớp thay cho thứ ADR-017 mục 4 hứa mà KHÔNG cài được: đường khách và đường người mua dùng
    // CHUNG một role CSDL (`app_api`), nên không thu hẹp quyền theo cột cho riêng đường khách
    // được. Bảng riêng là thứ thay thế được, và test này ghim nó.
    const { rows } = await db.pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns " +
        " WHERE table_schema = 'public' AND table_name = 'rfq_packages' " +
        "   AND (column_name LIKE '%value%' OR column_name LIKE '%price%' " +
        "        OR column_name LIKE '%budget%' OR column_name LIKE '%amount%')",
    );
    expect(rows.map((h) => h.column_name)).toEqual([]);
  });
});

// =============================================================================================
// [ADR-016] BỐN CẠNH CHUYỂN TRẠNG THÁI ĐƯỢC KÝ TÊN
//
// `submitted_by`, `opened_by`, `closed_by`, `cancelled_by` không phải siêu dữ liệu trang trí. Ba
// nguyên tắc bất khả xâm phạm của sản phẩm treo vào đúng bốn câu hỏi này — nặng nhất là
// *Separation of Duties*: không có `opened_by`, mệnh đề "không cá nhân nào kiểm soát trọn chuỗi"
// KHÔNG kiểm được từ dữ liệu, kể cả sau khi việc đã xảy ra.
// =============================================================================================
describe("bốn cạnh chuyển trạng thái mang chữ ký", () => {
  // Helper RIÊNG, và lý do nó tồn tại là một khiếm khuyết ĐO ĐƯỢC của bộ test này: `rfqNhap`
  // ghi ngân sách 1 000 000 và đọc chính sách ĐANG HIỆU LỰC. Test "TÁI LẬP ĐƯỢC" của ADR-017 tạo
  // phiên bản 2 với ngưỡng 500 000, nên MỌI test chạy SAU nó nhận `requires_dual_approval = true`
  // từ cùng một lời gọi `rfqNhap(orgA, false)`. Đó là một phụ thuộc THỨ TỰ ẩn, và nó đã làm bốn
  // test ở khối này đỏ ở lần chạy đầu — bắt được vì chúng khẳng định trạng thái, không chỉ khẳng
  // định "không ném".
  //
  // Cách sửa đúng là KHÔNG phụ thuộc chính sách hiện hành: 100 000 nằm dưới cả hai ngưỡng.
  async function rfqDuoiMoiNguong(): Promise<string> {
    return withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, {
        title: "RFQ duoi moi nguong",
        deadlineAt: MAI_SAU,
        createdBySessionId: s1,
      });
      await addRfqItem(c, orgA, {
        rfqId: r.id,
        lineNo: 1,
        description: "Mot hang muc",
        quantity: "1.0000",
        unit: "cai",
        actorSessionId: s1,
      });
      await setRfqBudget(c, orgA, {
        rfqId: r.id,
        estimatedValue: "100000.00",
        currency: "VND",
        actorSessionId: s1,
      });
      return r.id;
    });
  }
  it("ĐỐI CHỨNG DƯƠNG: nộp duyệt, mở, đóng — mỗi cạnh ghi đúng người và đúng phiên", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s2, keyWrapper: boBocGia }, apiPool);
      await closeRfq(c, orgA, { rfqId, reason: "du bao gia", actorSessionId: s3 });
    });

    const { rows } = await db.pool.query<{
      submitted_by: string;
      opened_by: string;
      closed_by: string;
      opened_by_session_id: string;
    }>(
      "SELECT submitted_by, opened_by, closed_by, opened_by_session_id " +
        " FROM rfq_packages WHERE id = $1",
      [rfqId],
    );
    // BA NGƯỜI KHÁC NHAU trên ba cạnh — và trước migration 016, cả ba câu hỏi này không có chỗ
    // nào trong dữ liệu để trả lời.
    expect(rows[0]?.submitted_by).toBe(u1);
    expect(rows[0]?.opened_by).toBe(u2);
    expect(rows[0]?.closed_by).toBe(u3);
    expect(rows[0]?.opened_by_session_id).toBe(s2);
  });

  it("huỷ RFQ cũng mang chữ ký", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    await withTenant(apiPool, orgA, (c) =>
      cancelRfq(c, orgA, { rfqId, reason: "khong con nhu cau", actorSessionId: s2 }, apiPool),
    );
    const { rows } = await db.pool.query<{ cancelled_by: string }>(
      "SELECT cancelled_by FROM rfq_packages WHERE id = $1",
      [rfqId],
    );
    expect(rows[0]?.cancelled_by).toBe(u2);
  });

  it("LỚP CÓ THẨM QUYỀN Ở CSDL: mở RFQ bằng SQL viết tay mà không ký tên bị TRIGGER chặn", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );

    // Một script vận hành "mở hàng loạt RFQ đã duyệt" sẽ đi đúng đường này.
    //
    // [S1.4] Câu `issueRfqKeyPair` dưới đây là MỚI, và nó KHÔNG phải một tiện nghi: từ migration
    // 017, `rfq_packages_kiem_khoa_khi_mo` chặn mọi lần mở RFQ chưa có cặp khoá — và nó đứng
    // TRƯỚC `rfq_packages_kiem_nguoi_mo` theo thứ tự chữ cái. Không có câu này, test dưới sẽ đỏ
    // vì thiếu KHOÁ chứ không vì thiếu CHỮ KÝ, tức nó sẽ xanh-vì-lý-do-sai ở chiều ngược lại.
    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: s1, wrapper: boBocGia });
        await c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now() WHERE id = $1",
          [rfqId],
        );
      }),
    ).rejects.toThrow(/phai duoc dat/);
  });

  it("khai người mở LỆCH chủ phiên cũng bị chặn — không chỉ thiếu, mà cả sai", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );

    await expect(
      withTenant(apiPool, orgA, async (c) => {
        await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: s1, wrapper: boBocGia });
        await c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), " +
            " opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
          [rfqId, u3, s2],
        );
      }),
    ).rejects.toThrow(/khong khop chu phien/);
  });

  it("hạng mục RFQ cũng mang chữ ký người thêm", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    const { rows } = await db.pool.query<{ created_by: string; created_by_session_id: string }>(
      "SELECT created_by, created_by_session_id FROM rfq_items WHERE rfq_id = $1",
      [rfqId],
    );
    expect(rows[0]?.created_by).toBe(u1);
    expect(rows[0]?.created_by_session_id).toBe(s1);
  });

  it("sổ kiểm toán ghi CHỦ PHIÊN — hằng `ACTOR` cũ đã không còn chỗ nào để khai", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s2 }),
    );
    const { rows } = await db.pool.query<{ actor_type: string; actor_id: string }>(
      "SELECT actor_type, actor_id FROM audit_events " +
        " WHERE resource_id = $1 AND action = 'RFQ_SUBMITTED_FOR_APPROVAL'",
      [rfqId],
    );
    // Bản trước ghi `SYSTEM`/NULL cho ĐÚNG lời gọi này. Không lớp nào phản đối.
    expect(rows[0]?.actor_type).toBe("USER");
    expect(rows[0]?.actor_id).toBe(u2);
  });

  it("ĐỘT BIẾN: gỡ trigger người-mở thì câu UPDATE không ký tên ĐI LỌT", async () => {
    const rfqId = await rfqDuoiMoiNguong();
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );

    await db.pool.query("DROP TRIGGER rfq_packages_kiem_nguoi_mo ON rfq_packages");
    try {
      const { rowCount } = await withTenant(apiPool, orgA, async (c) => {
        await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: s1, wrapper: boBocGia });
        return await c.query(
          "UPDATE rfq_packages SET status = 'OPEN', opened_at = now() WHERE id = $1",
          [rfqId],
        );
      });
      expect(rowCount, "không có trigger thì một RFQ được mở mà không ai ký tên").toBe(1);
    } finally {
      await db.pool.query(
        "CREATE TRIGGER rfq_packages_kiem_nguoi_mo BEFORE UPDATE ON rfq_packages " +
          " FOR EACH ROW WHEN (NEW.status = 'OPEN' AND OLD.status IS DISTINCT FROM 'OPEN') " +
          " EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('opened_by', 'opened_by_session_id')",
      );
    }
  });
});

// ===============================================================================================
// [khoản nợ 31] MỞ VÀ HUỶ RFQ LÀ HAI HÀNH VI CÓ QUYỀN
//
// Tới trước migration `023`, hai hàm này xác lập *ai* và *tổ chức nào* rồi làm việc — không hỏi
// *người ấy có được phép không*. Và câu `requirePermission(...)` lẽ ra phải gọi là câu KHÔNG
// VIẾT ĐƯỢC, vì `permissions` không có `rfq.open` và không có `rfq.cancel`.
//
// Bằng chứng đọc được rằng khoảng trống ấy CÓ THẬT: fixture của chính file này từng tạo `u1`
// KHÔNG một vai trò nào, và cả 39 test vẫn xanh trong khi `u1` mở và huỷ mọi RFQ.
// ===============================================================================================
describe("[INV-D3] mở và huỷ RFQ đòi quyền, và một lần từ chối để lại dấu vết", () => {
  /**
   * RFQ có ngân sách DƯỚI MỌI ngưỡng đã từng ban hành trong bộ test này.
   *
   * Cùng lý do đã ghi ở khối "bốn cạnh mang chữ ký": `rfqNhap` ghi ngân sách 1 000 000 và đọc
   * chính sách ĐANG hiệu lực, mà một test của ADR-017 ban hành phiên bản 2 với ngưỡng 500 000 —
   * nên mọi test chạy SAU nó nhận `requires_dual_approval = true` và không mở được. Một phụ
   * thuộc THỨ TỰ ẩn, đã đo, và cách sửa đúng là không phụ thuộc chính sách hiện hành.
   */
  async function rfqMoDuoc(): Promise<string> {
    return withTenant(apiPool, orgA, async (c) => {
      const r = await createRfq(c, orgA, {
        title: "RFQ cho phep do quyen",
        deadlineAt: MAI_SAU,
        createdBySessionId: s1,
      });
      await addRfqItem(c, orgA, {
        rfqId: r.id,
        lineNo: 1,
        description: "Mot hang muc",
        quantity: "1.0000",
        unit: "cai",
        actorSessionId: s1,
      });
      await setRfqBudget(c, orgA, {
        rfqId: r.id,
        estimatedValue: "100000.00",
        currency: "VND",
        actorSessionId: s1,
      });
      return r.id;
    });
  }

  /** Một người dùng KHÔNG có vai trò nào — đúng hình dạng `u1` từng có. */
  async function nguoiKhongVaiTro(): Promise<string> {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Khong vai tro') RETURNING id",
      [orgA, `khong-vai-tro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vidu.vn`],
    );
    return taoPhien(orgA, rows[0]?.id ?? "");
  }

  it("[INV-D3] không có `rfq.open` thì KHÔNG mở được — và RFQ vẫn nguyên trạng thái cũ", async () => {
    const rfqId = await rfqNhap(orgA, false);
    const sLa = await nguoiKhongVaiTro();
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        openRfq(c, orgA, { rfqId, actorSessionId: sLa, keyWrapper: boBocGia }, apiPool),
      ),
    ).rejects.toThrow(/rfq\.open/);

    // Và phép kiểm đứng TRƯỚC lần đúc khoá: không có vế này, một lần từ chối vẫn để lại một hàng
    // `rfq_key_material` cho một RFQ chưa bao giờ mở.
    const { rows } = await db.pool.query<{ status: string; n: string }>(
      "SELECT p.status, (SELECT count(*)::text FROM rfq_key_material k WHERE k.rfq_id = p.id) AS n " +
        "  FROM rfq_packages p WHERE p.id = $1",
      [rfqId],
    );
    expect(rows[0]?.status).toBe("PENDING_APPROVAL");
    expect(rows[0]?.n, "một lần từ chối vẫn đúc khoá — phép kiểm đứng SAU lần đúc").toBe("0");
  });

  it("[INV-D3] không có `rfq.cancel` thì KHÔNG huỷ được — và vật liệu khoá KHÔNG bị thu hồi", async () => {
    // Đây là vế NẶNG của khoản nợ: huỷ thì thu hồi toàn bộ vật liệu khoá, và thu hồi không đảo
    // ngược được (017 cấm bỏ dấu). Một lời gọi lọt qua đây làm báo giá của RFQ vĩnh viễn không
    // mở được.
    const rfqId = await rfqMoDuoc();
    const sLa = await nguoiKhongVaiTro();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        cancelRfq(c, orgA, { rfqId, reason: "khong con nhu cau", actorSessionId: sLa }, apiPool),
      ),
    ).rejects.toThrow(/rfq\.cancel/);

    const { rows } = await db.pool.query<{ status: string; con: string }>(
      "SELECT p.status, (SELECT count(*)::text FROM rfq_key_material k " +
        "   WHERE k.rfq_id = p.id AND k.revoked_at IS NULL) AS con FROM rfq_packages p WHERE p.id = $1",
      [rfqId],
    );
    expect(rows[0]?.status).toBe("OPEN");
    expect(rows[0]?.con, "vật liệu khoá đã bị thu hồi bởi một lần huỷ BỊ TỪ CHỐI").not.toBe("0");
  });

  it("[INV-D5] một lần từ chối `rfq.cancel` để lại bản ghi kiểm toán, không chỉ một lần ném", async () => {
    const rfqId = await rfqNhap(orgA, false);
    const sLa = await nguoiKhongVaiTro();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        cancelRfq(c, orgA, { rfqId, reason: "thu huy", actorSessionId: sLa }, apiPool),
      ),
    ).rejects.toThrow();

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events " +
        " WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND resource_id = $2",
      [orgA, rfqId],
    );
    expect(rows[0]?.n, "D5: lần TỪ CHỐI cũng phải audit, không chỉ lần thành công").toBe("1");
  });

  it("[INV-D3] ĐỐI CHỨNG DƯƠNG: `PROCUREMENT_MANAGER` mở và huỷ được", async () => {
    // Không có vế này, ba khẳng định trên xanh kể cả khi cổng từ chối TẤT CẢ — tức nó đã chặn
    // luôn đường hợp pháp và không ai mở được gói thầu nào nữa.
    const rfqId = await rfqMoDuoc();
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 });
      await openRfq(c, orgA, { rfqId, actorSessionId: s1, keyWrapper: boBocGia }, apiPool);
    });
    const huy = await withTenant(apiPool, orgA, (c) =>
      cancelRfq(c, orgA, { rfqId, reason: "khong con nhu cau", actorSessionId: s1 }, apiPool),
    );
    expect(huy.status).toBe("CANCELLED");
  });

  it("[khoản nợ 31] `DIRECTOR` CỐ Ý không mở được — hai đầu của một cặp kiểm soát", async () => {
    // `DIRECTOR` giữ `rfq.unseal.approve`. Cho nó thêm quyền mở chính gói thầu ấy là gộp hai đầu
    // của một cặp kiểm soát vào một tay. `023` vì thế chỉ cấp cho `PROCUREMENT_MANAGER`.
    const { rows: u } = await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Giam doc') RETURNING id",
      [orgA, `gd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vidu.vn`],
    );
    const uGd = u[0]?.id ?? "";
    await db.pool.query(
      "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DIRECTOR')",
      [orgA, uGd],
    );
    const sGd = await taoPhien(orgA, uGd);
    const rfqId = await rfqNhap(orgA, false);
    await withTenant(apiPool, orgA, (c) =>
      submitRfqForApproval(c, orgA, { rfqId, actorSessionId: s1 }),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        openRfq(c, orgA, { rfqId, actorSessionId: sGd, keyWrapper: boBocGia }, apiPool),
      ),
    ).rejects.toThrow(/rfq\.open/);
  });
});
