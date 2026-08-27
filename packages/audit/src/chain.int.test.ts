import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { withTenant } from "@trustprocure/tenancy";
import {
  appendAuditEvent,
  exportChainHead,
  recordChainAnchor,
  verifyAuditChain,
  type ExternalAnchor,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;

async function orgMoi(slug: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
    [slug],
  );
  return rows[0]!.id;
}

async function docTgenabled(bang: string, tenTrigger: string): Promise<string> {
  const { rows } = await db.pool.query<{ tgenabled: string }>(
    "SELECT t.tgenabled FROM pg_trigger t WHERE t.tgrelid = $1::regclass AND t.tgname = $2",
    [bang, tenTrigger],
  );
  const giaTri = rows[0]?.tgenabled;
  if (giaTri === undefined) throw new Error(`không thấy trigger ${bang}.${tenTrigger}`);
  return giaTri;
}

/**
 * Mô phỏng một tác nhân đã vượt qua LỚP TRIGGER: tạm gỡ đúng một trigger, làm việc bẩn, rồi
 * gắn lại NGUYÊN TRẠNG.
 *
 * [cạm bẫy 1] Bản mã mẫu của brief dùng `ALTER TABLE ... ENABLE TRIGGER` để gắn lại. Đã đo
 * (test "[cạm bẫy 1] ..." bên dưới): câu đó đặt pg_trigger.tgenabled về 'O', trong khi 003 cưỡng
 * chế 'A' (ENABLE ALWAYS). Dùng nó ở đây sẽ ÂM THẦM hạ cấp bất biến B4 của Task 5 cho toàn bộ
 * phần còn lại của suite — trigger 'O' bị bỏ qua khi session_replication_role = 'replica'.
 * Nên hàm này (a) gắn lại bằng ENABLE ALWAYS, (b) đọc lại tgenabled và ném lỗi nếu khác trạng
 * thái ban đầu, (c) đòi trạng thái ban đầu phải là 'A' — nếu một test chạy trước đã hạ cấp thì
 * lỗi nổ ở đây chứ không im lặng.
 */
async function voHieuHoaTrigger<T>(
  bang: string,
  tenTrigger: string,
  viec: () => Promise<T>,
): Promise<T> {
  const truoc = await docTgenabled(bang, tenTrigger);
  expect(truoc, `${bang}.${tenTrigger} phải là ENABLE ALWAYS trước khi mô phỏng tấn công`).toBe(
    "A",
  );
  await db.pool.query(`ALTER TABLE ${bang} DISABLE TRIGGER ${tenTrigger}`);
  try {
    return await viec();
  } finally {
    await db.pool.query(`ALTER TABLE ${bang} ENABLE ALWAYS TRIGGER ${tenTrigger}`);
    const sau = await docTgenabled(bang, tenTrigger);
    if (sau !== truoc) {
      throw new Error(
        `khôi phục trigger ${bang}.${tenTrigger} không nguyên trạng: ${truoc} -> ${sau}`,
      );
    }
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe("chuỗi hash kiểm toán", () => {
  it("đánh số seq liên tục từ 1 và nối prev_hash đúng", async () => {
    const org = await orgMoi("chuoi-co-ban");
    const banGhi = await withTenant(apiPool, org, async (client) => {
      const a = await appendAuditEvent(client, org, {
        actorType: "SYSTEM",
        action: "RFQ_CREATED",
        resourceType: "RFQ",
      });
      const b = await appendAuditEvent(client, org, {
        actorType: "SYSTEM",
        action: "RFQ_OPENED",
        resourceType: "RFQ",
      });
      return [a, b];
    });

    expect(banGhi.map((r) => r.seq)).toEqual([1, 2]);
    expect(banGhi[0]!.prevHash.equals(Buffer.alloc(32, 0))).toBe(true);
    expect(banGhi[1]!.prevHash.equals(banGhi[0]!.hash)).toBe(true);
    // clock_timestamp() chứ không now(): hai sự kiện trong CÙNG transaction phải mang hai dấu
    // thời gian khác nhau, nếu không thứ tự thời gian thật mất khi điều tra.
    expect(banGhi[1]!.occurredAt.getTime()).toBeGreaterThanOrEqual(
      banGhi[0]!.occurredAt.getTime(),
    );
    expect(banGhi[0]!.occurredAt.toISOString()).not.toBe(banGhi[1]!.occurredAt.toISOString());
  });

  it("[INV-B3] chuỗi nguyên vẹn CÓ mốc neo ngoài thì kiểm chứng đạt", async () => {
    const org = await orgMoi("chuoi-nguyen-ven");
    const neo = await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 25; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `HANH_DONG_${i}`,
          resourceType: "TEST",
          payload: { chiSo: i, ghiChu: "giá trị có dấu tiếng Việt" },
        });
      }
      return exportChainHead(client, org);
    });
    if (neo === null) throw new Error("không xuất được mốc chuỗi");

    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [neo] }),
    );
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
    expect(ketQua.checked).toBe(25);
  });

  /**
   * [vòng fix 1 — CR2] Bản trước của test ngay trên gọi verifyAuditChain KHÔNG NEO và khẳng
   * định ok:true. Test này là lý do phát biểu đó phải đổi, và nó dựng lại ĐÚNG payload mà
   * reviewer đo được: sửa một hàng rồi TÍNH LẠI ĐUÔI bằng CHÍNH hàm băm thật.
   *
   * Vế (a) là phát hiện: không neo thì chuỗi "tự nhất quán" trên một sổ ĐÃ BỊ SỬA — mọi phép
   * kiểm nội tại đều xanh, chỉ còn NOT_ANCHORED nói rằng kết luận này không có giá trị.
   * Vế (b) là bảo đảm còn lại: CÓ neo thì đúng cú tấn công đó bị bắt.
   */
  it("[INV-B3] sửa một hàng RỒI TÍNH LẠI ĐUÔI: chuỗi tự nhất quán, chỉ mốc neo ngoài bắt được", async () => {
    const org = await orgMoi("chuoi-tinh-lai-duoi");
    const neo = await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 6; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `T${i}`,
          resourceType: "TEST",
        });
      }
      return exportChainHead(client, org);
    });
    if (neo === null) throw new Error("không xuất được mốc chuỗi");

    // Tác nhân: chủ sở hữu bảng đã qua lớp trigger. Nó sửa seq 3 rồi đi từ seq 3 tính lại
    // prev_hash/hash cho toàn bộ đuôi bằng chính public.audit_compute_hash.
    await voHieuHoaTrigger("audit_events", "audit_events_chan_update", async () => {
      await db.pool.query(
        "UPDATE audit_events SET action = 'DA_BI_SUA' WHERE org_id = $1 AND seq = 3",
        [org],
      );
      await db.pool.query(
        `DO $$
         DECLARE r RECORD; truoc bytea;
         BEGIN
           SELECT ae.hash INTO truoc FROM audit_events ae
            WHERE ae.org_id = '${org}'::uuid AND ae.seq = 2;
           FOR r IN SELECT * FROM audit_events ae
                     WHERE ae.org_id = '${org}'::uuid AND ae.seq >= 3 ORDER BY ae.seq LOOP
             UPDATE audit_events SET prev_hash = truoc,
                    hash = public.audit_compute_hash(truoc, r.id, r.org_id, r.seq, r.occurred_at,
                             r.actor_type, r.actor_id,
                             CASE WHEN r.seq = 3 THEN 'DA_BI_SUA' ELSE r.action END,
                             r.resource_type, r.resource_id, r.payload, r.request_id, r.ip,
                             r.user_agent)
              WHERE id = r.id
              RETURNING hash INTO truoc;
           END LOOP;
         END $$`,
      );
    });

    // Fixture phải thật sự tấn công được.
    const { rows } = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE org_id = $1 AND seq = 3",
      [org],
    );
    expect(rows[0]!.action).toBe("DA_BI_SUA");

    // (a) KHÔNG neo: mọi phép kiểm NỘI TẠI của chuỗi đều xanh trên một sổ đã bị sửa.
    const khongNeo = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [] }),
    );
    expect(khongNeo.checked).toBe(6);
    expect(khongNeo.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
    expect(khongNeo.ok, "một lời gọi KHÔNG NEO không được cho ra kết luận màu xanh").toBe(false);

    // (b) CÓ neo: đúng cú tấn công đó bị bắt, tại đúng đầu chuỗi.
    const coNeo = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [neo] }),
    );
    expect(coNeo.ok).toBe(false);
    expect(coNeo.problems.some((p) => p.seq === 6 && p.kind === "ANCHOR_MISSING")).toBe(true);
  });

  /**
   * [vòng fix 1 — CR1] `ip` và `user_agent` là HAI TRƯỜNG PHÁP Y, và trước bản vá này chúng
   * nằm NGOÀI tiền ảnh băm: kẻ đã qua lớp trigger viết lại được địa chỉ của chính mình mà
   * kiểm chứng vẫn xanh và đầu chuỗi KHÔNG ĐỔI (nên cả neo ngoài cũng khớp). Mọi test
   * "[INV-B3] sửa nội dung..." đều dựng đúng khuôn này — chúng chỉ tình cờ chọn cột `action`.
   * `id` cũng được thêm vào cùng vòng: đo được là NEW.id CÓ giá trị trong BEFORE-trigger.
   */
  it("[INV-B3] sửa ip/user_agent/id trên hàng ĐANG CÓ thì kiểm chứng thất bại", async () => {
    for (const [cot, giaTri] of [
      ["ip", "'9.9.9.9'::inet"],
      ["user_agent", "'DA_BI_SUA'"],
      ["id", "'deadbeef-0000-4000-8000-000000000001'::uuid"],
    ] as const) {
      const org = await orgMoi(`chuoi-phap-y-${cot}`);
      const neo = await withTenant(apiPool, org, async (client) => {
        for (let i = 0; i < 3; i += 1) {
          await appendAuditEvent(client, org, {
            actorType: "USER",
            action: `P${i}`,
            resourceType: "TEST",
            ip: "10.0.0.1",
            userAgent: "trustprocure-test/1.0",
          });
        }
        return exportChainHead(client, org);
      });
      if (neo === null) throw new Error("không xuất được mốc chuỗi");

      await voHieuHoaTrigger("audit_events", "audit_events_chan_update", async () => {
        const { rowCount } = await db.pool.query(
          `UPDATE audit_events SET ${cot} = ${giaTri} WHERE org_id = $1 AND seq = 2`,
          [org],
        );
        expect(rowCount, `fixture không sửa được cột ${cot} thì phép đo rỗng ruột`).toBe(1);
      });

      const ketQua = await withTenant(apiPool, org, (client) =>
        verifyAuditChain(client, org, { externalAnchors: [neo] }),
      );
      expect(ketQua.ok, `sửa ${cot} mà kiểm chứng vẫn QUA`).toBe(false);
      expect(
        ketQua.problems.some((p) => p.seq === 2 && p.kind === "HASH_MISMATCH"),
        `sửa ${cot} phải cho HASH_MISMATCH tại seq 2`,
      ).toBe(true);
    }
  });

  it("[INV-B3] sửa nội dung một hàng ĐANG CÓ thì kiểm chứng thất bại", async () => {
    const org = await orgMoi("chuoi-bi-sua");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `A${i}`,
          resourceType: "TEST",
        });
      }
    });

    await voHieuHoaTrigger("audit_events", "audit_events_chan_update", async () => {
      await db.pool.query(
        "UPDATE audit_events SET action = 'DA_BI_SUA' WHERE org_id = $1 AND seq = 3",
        [org],
      );
    });

    // Fixture phải thật sự tấn công được, nếu không mọi kết luận phía sau là rỗng ruột.
    const { rows } = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE org_id = $1 AND seq = 3",
      [org],
    );
    expect(rows[0]!.action).toBe("DA_BI_SUA");

    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [] }),
    );
    expect(ketQua.ok).toBe(false);
    expect(ketQua.problems.some((p) => p.seq === 3 && p.kind === "HASH_MISMATCH")).toBe(true);
  });

  it("[INV-B3] xoá một hàng ở giữa thì kiểm chứng thất bại", async () => {
    const org = await orgMoi("chuoi-bi-xoa-giua");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `B${i}`,
          resourceType: "TEST",
        });
      }
    });

    await voHieuHoaTrigger("audit_events", "audit_events_chan_delete", async () => {
      const { rowCount } = await db.pool.query(
        "DELETE FROM audit_events WHERE org_id = $1 AND seq = 3",
        [org],
      );
      expect(rowCount, "fixture không xoá được hàng nào thì phép đo rỗng ruột").toBe(1);
    });

    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [] }),
    );
    expect(ketQua.ok).toBe(false);
    expect(ketQua.problems.some((p) => p.kind === "SEQ_GAP")).toBe(true);
    expect(ketQua.problems.some((p) => p.kind === "LINK_BROKEN")).toBe(true);
  });

  it("[INV-B3] chèn một hàng lạ vào chuỗi thì kiểm chứng thất bại", async () => {
    const org = await orgMoi("chuoi-bi-chen");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 3; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `C${i}`,
          resourceType: "TEST",
        });
      }
    });

    // Chèn phải đi qua đường "gỡ trigger nối chuỗi": chừng nào trigger còn đó, seq và hash do
    // DB tự đặt nên không ai CHỌN được chỗ chèn (xem test [INV-B3] ... chiếm trước seq).
    await voHieuHoaTrigger("audit_events", "audit_events_noi_chuoi", async () => {
      await db.pool.query(
        "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, " +
          "prev_hash, hash) VALUES ($1, 4, 'SYSTEM', 'HANG_CHEN', 'TEST', " +
          "decode(repeat('00', 32), 'hex'), sha256('gia'::bytea))",
        [org],
      );
    });

    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [] }),
    );
    expect(ketQua.ok).toBe(false);
    expect(ketQua.checked).toBe(4);
    expect(ketQua.problems.some((p) => p.seq === 4 && p.kind === "LINK_BROKEN")).toBe(true);
    expect(ketQua.problems.some((p) => p.seq === 4 && p.kind === "HASH_MISMATCH")).toBe(true);
  });

  it("[INV-B3] cắt đuôi chuỗi bị phát hiện nhờ mốc neo trong DB", async () => {
    const org = await orgMoi("chuoi-bi-cat-duoi");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 6; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `D${i}`,
          resourceType: "TEST",
        });
      }
      const neo = await recordChainAnchor(client, org);
      expect(neo?.seq).toBe(6);
    });

    await voHieuHoaTrigger("audit_events", "audit_events_chan_delete", async () => {
      const { rowCount } = await db.pool.query(
        "DELETE FROM audit_events WHERE org_id = $1 AND seq > 4",
        [org],
      );
      expect(rowCount).toBe(2);
    });

    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [] }),
    );
    expect(ketQua.ok).toBe(false);
    expect(ketQua.checked).toBe(4);
    expect(ketQua.problems.some((p) => p.seq === 6 && p.kind === "ANCHOR_MISSING")).toBe(true);
  });

  /**
   * Bàn giao của Task 5 nói rõ: `audit_chain_anchors` nằm CÙNG VÙNG TIN CẬY với `audit_events`
   * và với tác nhân — chủ sở hữu bảng gỡ được cả hai. Nên mốc neo TRONG DB không phải gốc tin
   * cậy; nó chỉ bắt được kẻ quên xoá neo. Mốc neo NGOÀI DB (artefact do CI/vận hành giữ) là
   * thứ duy nhất trong phạm vi S0 còn đứng khi cả hai bảng bị dọn sạch.
   */
  it("[INV-B3] cắt đuôi VÀ xoá mốc neo trong DB vẫn bị phát hiện nhờ mốc neo NGOÀI DB", async () => {
    const org = await orgMoi("chuoi-neo-ngoai");
    const neoNgoai: ExternalAnchor = await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `E${i}`,
          resourceType: "TEST",
        });
      }
      await recordChainAnchor(client, org);
      const xuat = await exportChainHead(client, org);
      if (xuat === null) throw new Error("không xuất được mốc chuỗi");
      return xuat;
    });

    // Artefact phải sống được qua JSON — nó nằm NGOÀI database, trong kho của CI.
    const quaJson: ExternalAnchor = JSON.parse(JSON.stringify(neoNgoai)) as ExternalAnchor;
    expect(quaJson.seq).toBe(5);
    expect(quaJson.hashHex).toMatch(/^[0-9a-f]{64}$/);

    await voHieuHoaTrigger("audit_events", "audit_events_chan_delete", async () => {
      await voHieuHoaTrigger("audit_chain_anchors", "audit_chain_anchors_chan_delete", async () => {
        await db.pool.query("DELETE FROM audit_events WHERE org_id = $1", [org]);
        await db.pool.query("DELETE FROM audit_chain_anchors WHERE org_id = $1", [org]);
      });
    });

    // Không có neo ngoài: MỌI phép kiểm NỘI TẠI của chuỗi đều xanh trên một sổ đã bị xoá sạch —
    // đúng cái mà bàn giao Task 5 cảnh báo. [vòng fix 1 — CR2/IM3] Nay hai vấn đề mức-kết-luận
    // giữ cho kết quả đó không được đọc thành "sổ khoẻ mạnh".
    const khongNeo = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [] }),
    );
    expect(khongNeo.checked).toBe(0);
    expect(khongNeo.problems.map((p) => p.kind).sort()).toEqual([
      "EMPTY_LEDGER",
      "NOT_ANCHORED",
    ]);
    expect(khongNeo.ok).toBe(false);
    // Và vế quan trọng: KHÔNG phép kiểm nội tại nào (SEQ_GAP/LINK_BROKEN/HASH_MISMATCH/
    // ANCHOR_MISSING) nói được gì ở đây — đó là lý do neo ngoài tồn tại.
    expect(
      khongNeo.problems.filter(
        (p) => p.kind !== "EMPTY_LEDGER" && p.kind !== "NOT_ANCHORED",
      ),
    ).toEqual([]);

    const coNeo = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [quaJson] }),
    );
    expect(coNeo.ok).toBe(false);
    expect(coNeo.problems.some((p) => p.seq === 5 && p.kind === "ANCHOR_MISSING")).toBe(true);
  });

  it("[INV-B3] mốc neo ngoài DB khớp chuỗi nguyên vẹn thì kiểm chứng vẫn đạt", async () => {
    const org = await orgMoi("chuoi-neo-ngoai-nguyen-ven");
    const neoNgoai = await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 4; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `F${i}`,
          resourceType: "TEST",
        });
      }
      return exportChainHead(client, org);
    });
    if (neoNgoai === null) throw new Error("không xuất được mốc chuỗi");

    await withTenant(apiPool, org, (client) =>
      appendAuditEvent(client, org, { actorType: "SYSTEM", action: "F4", resourceType: "TEST" }),
    );

    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [neoNgoai] }),
    );
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
    expect(ketQua.checked).toBe(5);
  });

  it("[INV-F1] chuỗi của hai tổ chức độc lập nhau", async () => {
    const orgX = await orgMoi("chuoi-org-x");
    const orgY = await orgMoi("chuoi-org-y");

    await withTenant(apiPool, orgX, (client) =>
      appendAuditEvent(client, orgX, { actorType: "SYSTEM", action: "X1", resourceType: "T" }),
    );
    const y = await withTenant(apiPool, orgY, (client) =>
      appendAuditEvent(client, orgY, { actorType: "SYSTEM", action: "Y1", resourceType: "T" }),
    );

    expect(y.seq).toBe(1);
    expect(y.prevHash.equals(Buffer.alloc(32, 0))).toBe(true);
  });

  it("[INV-F1] ghi sang tổ chức khác bị RLS từ chối, không tạo được hàng nào", async () => {
    const orgX = await orgMoi("chuoi-rls-x");
    const orgY = await orgMoi("chuoi-rls-y");

    // Lỗi phải nổi ra NGOÀI withTenant: bắt nó bên trong thì transaction đã hỏng rồi, và
    // withTenant sẽ báo một lỗi khác (COMMIT trả ROLLBACK) che mất lỗi thật.
    const loi = await withTenant(apiPool, orgX, (client) =>
      appendAuditEvent(client, orgY, {
        actorType: "SYSTEM",
        action: "LAN_SANG",
        resourceType: "T",
      }),
    ).then(
      () => "THÀNH CÔNG",
      (e: Error) => e.message,
    );
    expect(loi).toMatch(/row-level security/i);

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
      [orgY],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("ghi đồng thời không làm chuỗi phân nhánh", async () => {
    const org = await orgMoi("chuoi-dong-thoi");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withTenant(apiPool, org, (client) =>
          appendAuditEvent(client, org, {
            actorType: "SYSTEM",
            action: `SONG_SONG_${i}`,
            resourceType: "TEST",
          }),
        ),
      ),
    );

    const neo = await withTenant(apiPool, org, (client) => exportChainHead(client, org));
    if (neo === null) throw new Error("không xuất được mốc chuỗi");
    const ketQua = await withTenant(apiPool, org, (client) =>
      verifyAuditChain(client, org, { externalAnchors: [neo] }),
    );
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
    expect(ketQua.checked).toBe(20);
  });

  /**
   * [cạm bẫy 3] Trước Task 6, `seq`/`prev_hash`/`hash` do BÊN GHI chọn: 003 cấp
   * INSERT trên đúng ba cột đó. Hệ quả đã đo ở bàn giao Task 5 — một app_api bị chiếm CHẶN
   * ĐƯỢC việc ghi sổ bằng cách chiếm trước seq. Ca nặng nhất là chiếm seq = 2^63-1: mọi lần
   * ghi sau đó vỡ với "bigint out of range" VĨNH VIỄN, và không role nào (kể cả chủ sở hữu ở
   * đường DML thường) xoá được hàng đó để gỡ.
   *
   * Task 6 đóng bằng HAI lớp độc lập, và mỗi lớp có một khẳng định riêng ở đây:
   *   (a) thu hồi quyền ghi ba cột đó -> câu INSERT nêu tên cột bị từ chối 42501;
   *   (b) trigger BEFORE INSERT GHI ĐÈ ba cột đó -> kể cả tác nhân KHÔNG bị (a) chặn
   *       (chủ sở hữu bảng, superuser) cũng không chọn được seq.
   */
  it("[INV-B3] app_api không chiếm trước được seq — quyền ghi ba cột chuỗi đã bị thu hồi", async () => {
    const org = await orgMoi("chuoi-chiem-seq");
    await withTenant(apiPool, org, (client) =>
      appendAuditEvent(client, org, { actorType: "SYSTEM", action: "G0", resourceType: "T" }),
    );

    const cauChiem = [
      ["seq", "(org_id, seq, actor_type, action, resource_type)", "$1, 9223372036854775807, 'SYSTEM', 'CHIEM', 'T'"],
      ["prev_hash", "(org_id, actor_type, action, resource_type, prev_hash)", "$1, 'SYSTEM', 'CHIEM', 'T', sha256('x'::bytea)"],
      ["hash", "(org_id, actor_type, action, resource_type, hash)", "$1, 'SYSTEM', 'CHIEM', 'T', sha256('x'::bytea)"],
    ] as const;

    for (const [cot, cacCot, giaTri] of cauChiem) {
      // Mỗi mũi một transaction riêng: một câu lỗi làm hỏng cả transaction đang mở.
      const loi = await withTenant(apiPool, org, (client) =>
        client.query(`INSERT INTO audit_events ${cacCot} VALUES (${giaTri})`, [org]),
      ).then(
        () => "THÀNH CÔNG",
        (e: Error) => e.message,
      );
      expect(loi, `ghi thẳng cột ${cot}`).toMatch(/permission denied/i);
    }

    // Và đường ghi HỢP LỆ vẫn mở: app_api ghi thẳng được, chỉ là không chọn được ba cột kia.
    const ketQua = await withTenant(apiPool, org, async (client) => {
      await client.query(
        "INSERT INTO audit_events (org_id, actor_type, action, resource_type) " +
          "VALUES ($1, 'SYSTEM', 'GHI_THANG', 'T')",
        [org],
      );
      const neo = await exportChainHead(client, org);
      if (neo === null) throw new Error("không xuất được mốc chuỗi");
      return verifyAuditChain(client, org, { externalAnchors: [neo] });
    });
    expect(ketQua.ok).toBe(true);
    expect(ketQua.checked).toBe(2);
  });

  it("[INV-B3] trigger nối chuỗi ghi đè seq/prev_hash/hash kể cả với superuser", async () => {
    const org = await orgMoi("chuoi-ghi-de");
    await withTenant(apiPool, org, (client) =>
      appendAuditEvent(client, org, { actorType: "SYSTEM", action: "H0", resourceType: "T" }),
    );

    // db.pool là chủ sở hữu bảng VÀ superuser — lớp (a) không chạm tới nó. Lớp (b) thì có.
    const { rows } = await db.pool.query<{ seq: string; prev_hash: Buffer }>(
      "INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash) " +
        "VALUES ($1, 9223372036854775807, 'SYSTEM', 'CHIEM', 'T', sha256('x'::bytea), " +
        "sha256('y'::bytea)) RETURNING seq, prev_hash",
      [org],
    );
    expect(Number(rows[0]!.seq)).toBe(2);

    const ketQua = await withTenant(apiPool, org, async (client) => {
      const neo = await exportChainHead(client, org);
      if (neo === null) throw new Error("không xuất được mốc chuỗi");
      return verifyAuditChain(client, org, { externalAnchors: [neo] });
    });
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
  });

  /**
   * [cạm bẫy 4] `audit_compute_hash` được khai IMMUTABLE, nhưng PostgreSQL KHÔNG kiểm điều đó.
   * Đã đo provolatile của mọi hàm mà nó gọi: to_char(timestamp,text) = 's',
   * convert_to(text,name) = 's', concat_ws(text,"any") = 's', jsonb_build_object = 's'.
   * Nghĩa là lời khai IMMUTABLE mạnh hơn thứ mà các hàm được gọi bảo đảm. Cách đóng theo QT2 là
   * GHIM (mệnh đề SET trên chính hàm), không phải NỚI phát biểu. Test này đo hệ quả: đổi năm
   * GUC rồi băm lại toàn bộ chuỗi phải cho đúng kết quả cũ.
   */
  it("[INV-B3] băm không đổi theo DateStyle/TimeZone/lc_time/IntervalStyle/bytea_output", async () => {
    const org = await orgMoi("chuoi-ghim-guc");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 3; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `I${i}`,
          resourceType: "TEST",
          payload: { so: 1.5, chuoi: "đơn vị" },
        });
      }
    });

    const neo = await withTenant(apiPool, org, (client) => exportChainHead(client, org));
    if (neo === null) throw new Error("không xuất được mốc chuỗi");

    const ketQua = await withTenant(apiPool, org, async (client) => {
      for (const cau of [
        "SET LOCAL DateStyle = 'German, DMY'",
        "SET LOCAL TimeZone = 'Asia/Tokyo'",
        "SET LOCAL lc_time = 'C'",
        "SET LOCAL IntervalStyle = 'sql_standard'",
        "SET LOCAL bytea_output = 'escape'",
      ]) {
        await client.query(cau);
      }
      return verifyAuditChain(client, org, { externalAnchors: [neo] });
    });
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
    expect(ketQua.checked).toBe(3);
  });

  /**
   * Brief băm bằng concat_ws(chr(31), ...). Bên ghi kiểm soát cả `action` lẫn `resource_type`,
   * nên nó DỜI ĐƯỢC ranh giới giữa hai trường liền kề: (action='A', resource_type='B'||sep||'C')
   * và (action='A'||sep||'B', resource_type='C') cho CÙNG một chuỗi tiền ảnh "A␟B␟C", tức hai sự
   * kiện KHÁC NHAU trùng băm. Bản này dùng jsonb chuẩn hoá nên ranh giới trường được thoát dấu.
   *
   * [đã tự bắt được bằng kiểm thử đột biến] Bản đầu của test này so ('A','B') với ('A'+sep+'B','')
   * — hai cặp đó KHÔNG va chạm ngay cả dưới concat_ws, vì dời ranh giới ra rìa làm SỐ trường
   * thay đổi và do đó số dấu phân cách cũng thay đổi. Đột biến "đổi tiền ảnh sang concat_ws"
   * SỐNG SÓT test đó. Cặp dưới đây giữ nguyên số trường nên nó va chạm thật.
   */
  it("[INV-B3] không chèn được ký tự phân cách để hai sự kiện khác nhau trùng băm", async () => {
    const { rows } = await db.pool.query<{ trung: boolean }>(
      `SELECT audit_compute_hash(decode(repeat('00',32),'hex'),
                '22222222-2222-2222-2222-222222222222'::uuid,
                '11111111-1111-1111-1111-111111111111'::uuid, 1::bigint,
                '2026-08-27 10:11:12.123456+00'::timestamptz, 'USER', NULL,
                'A', 'B' || chr(31) || 'C', NULL, '{}'::jsonb, NULL, NULL, NULL)
            = audit_compute_hash(decode(repeat('00',32),'hex'),
                '22222222-2222-2222-2222-222222222222'::uuid,
                '11111111-1111-1111-1111-111111111111'::uuid, 1::bigint,
                '2026-08-27 10:11:12.123456+00'::timestamptz, 'USER', NULL,
                'A' || chr(31) || 'B', 'C', NULL, '{}'::jsonb, NULL, NULL, NULL) AS trung`,
    );
    expect(rows[0]!.trung).toBe(false);
  });

  /**
   * [vòng fix 1 — CR1] Hai trường PHÁP Y mới cũng phải chịu đúng phép đo va chạm đó: bên ghi
   * kiểm soát `user_agent`, và `ip` thì không (kiểu `inet` không chứa được ký tự phân cách),
   * nên mũi đáng đo là cặp (action, user_agent) và cặp (resource_type, user_agent).
   */
  it("[INV-B3] hai trường pháp y mới không dời được ranh giới để trùng băm", async () => {
    const { rows } = await db.pool.query<{ ua_action: boolean; ua_res: boolean }>(
      `WITH b AS (
         SELECT decode(repeat('00',32),'hex') AS p,
                '22222222-2222-2222-2222-222222222222'::uuid AS i,
                '11111111-1111-1111-1111-111111111111'::uuid AS o,
                '2026-08-27 10:11:12.123456+00'::timestamptz AS t
       )
       SELECT audit_compute_hash(p, i, o, 1::bigint, t, 'USER', NULL, 'A', 'R', NULL,
                '{}'::jsonb, NULL, NULL, 'B' || chr(31) || 'C')
            = audit_compute_hash(p, i, o, 1::bigint, t, 'USER', NULL,
                'A' || chr(31) || 'B', 'R', NULL, '{}'::jsonb, NULL, NULL, 'C') AS ua_action,
              audit_compute_hash(p, i, o, 1::bigint, t, 'USER', NULL, 'A', 'R', NULL,
                '{}'::jsonb, NULL, NULL, 'B' || chr(31) || 'C')
            = audit_compute_hash(p, i, o, 1::bigint, t, 'USER', NULL, 'A',
                'R' || chr(31) || 'B', NULL, '{}'::jsonb, NULL, NULL, 'C') AS ua_res
         FROM b`,
    );
    expect(rows[0]!.ua_action).toBe(false);
    expect(rows[0]!.ua_res).toBe(false);
  });

  /**
   * [cạm bẫy 1] Phép đo nền cho `voHieuHoaTrigger`. Chạy trên một bảng nháp để không đụng tới
   * trạng thái trigger của bảng sổ.
   */
  it("[cạm bẫy 1] ENABLE TRIGGER trần hạ ENABLE ALWAYS ('A') xuống ORIGIN ('O')", async () => {
    await db.pool.query("CREATE TABLE IF NOT EXISTS nhap_tgenabled (id int)");
    await db.pool.query(
      "CREATE OR REPLACE TRIGGER nhap_chan_update BEFORE UPDATE ON nhap_tgenabled " +
        "FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa()",
    );
    await db.pool.query("ALTER TABLE nhap_tgenabled ENABLE ALWAYS TRIGGER nhap_chan_update");
    expect(await docTgenabled("nhap_tgenabled", "nhap_chan_update")).toBe("A");

    await db.pool.query("ALTER TABLE nhap_tgenabled DISABLE TRIGGER nhap_chan_update");
    await db.pool.query("ALTER TABLE nhap_tgenabled ENABLE TRIGGER nhap_chan_update");
    expect(await docTgenabled("nhap_tgenabled", "nhap_chan_update")).toBe("O");

    await db.pool.query("ALTER TABLE nhap_tgenabled ENABLE ALWAYS TRIGGER nhap_chan_update");
    expect(await docTgenabled("nhap_tgenabled", "nhap_chan_update")).toBe("A");
    await db.pool.query("DROP TABLE nhap_tgenabled");
  });

  /**
   * [vòng fix 1 — IM3] Bộ kiểm chứng KHÔNG được trả lời "không có vấn đề" ở chỗ phải trả lời
   * "không kiểm được". Đây là phép đo TRÊN DB THẬT (bản mô phỏng nằm ở verifier.test.ts): sổ
   * của P có 5 hàng, nhưng phiên đang gắn Q — trước bản vá, kết quả là
   * {"ok":true,"checked":0,"problems":[]}, tức một giấy chứng nhận sức khoẻ tốt cho một tổ
   * chức mà phiên này không nhìn thấy hàng nào.
   */
  it("[INV-F1] verifyAuditChain/exportChainHead NÉM khi phiên gắn sai tổ chức", async () => {
    const orgP = await orgMoi("chuoi-tenant-p");
    const orgQ = await orgMoi("chuoi-tenant-q");
    await withTenant(apiPool, orgP, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, orgP, {
          actorType: "USER",
          action: `Q${i}`,
          resourceType: "TEST",
        });
      }
    });

    // Vế chống rỗng ruột: sổ của P thật sự có 5 hàng.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1",
      [orgP],
    );
    expect(rows[0]!.n).toBe("5");

    const cacHam: readonly [string, (c: pg.PoolClient) => Promise<unknown>][] = [
      ["verifyAuditChain", (c) => verifyAuditChain(c, orgP, { externalAnchors: [] })],
      ["exportChainHead", (c) => exportChainHead(c, orgP)],
      ["recordChainAnchor", (c) => recordChainAnchor(c, orgP)],
    ];
    for (const [ten, chay] of cacHam) {
      const loi = await withTenant(apiPool, orgQ, (client) => chay(client)).then(
        () => "THÀNH CÔNG",
        (e: Error) => e.message,
      );
      expect(loi, `${ten} chạy sai tenant mà không ném`).toContain(orgQ);
      expect(loi).toContain("withTenant");
    }
  });

  /**
   * [vòng fix 1 — IM4] `audit_chain_anchors` là BỘ KIỂM CHỨNG chứ không phải dữ liệu nghiệp vụ,
   * và trước bản vá này `app_api` chèn được một mốc neo GIẢ vào đó — VĨNH VIỄN, vì trigger
   * append-only của chính B4 chặn gỡ bỏ kể cả bởi chủ sở hữu bảng trên đường DML.
   *
   * Ba vế, đúng ba hệ quả mà báo cáo vòng trước bỏ qua:
   *   (a) app_api không nêu được `seq`/`hash` (lớp REVOKE, 42501);
   *   (b) kể cả superuser cũng không CHỌN được (lớp trigger ghi đè);
   *   (c) đường neo HỢP LỆ vẫn mở, và neo chiếm chỗ không còn làm recordChainAnchor thành
   *       no-op vĩnh viễn.
   */
  it("[INV-B3] không ai chèn được mốc neo GIẢ vào audit_chain_anchors", async () => {
    const org = await orgMoi("neo-gia");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 3; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `N${i}`,
          resourceType: "TEST",
        });
      }
    });

    // (a) app_api nêu tên seq/hash -> 42501.
    for (const [cot, cacCot, giaTri] of [
      ["seq", "(org_id, seq)", "$1, 999999"],
      ["hash", "(org_id, hash)", "$1, sha256('gia'::bytea)"],
    ] as const) {
      const loi = await withTenant(apiPool, org, (client) =>
        client.query(`INSERT INTO audit_chain_anchors ${cacCot} VALUES (${giaTri})`, [org]),
      ).then(
        () => "THÀNH CÔNG",
        (e: Error) => e.message,
      );
      expect(loi, `neo giả qua cột ${cot}`).toMatch(/permission denied/i);
    }

    // (b) superuser + chủ sở hữu bảng cũng bị trigger ghi đè về đúng đầu chuỗi.
    const { rows: chiem } = await db.pool.query<{ seq: string; hash: Buffer }>(
      "INSERT INTO audit_chain_anchors (org_id, seq, hash) " +
        "VALUES ($1, 999999, sha256('gia'::bytea)) RETURNING seq, hash",
      [org],
    );
    expect(Number(chiem[0]!.seq)).toBe(3);
    const { rows: dau } = await db.pool.query<{ hash: Buffer }>(
      "SELECT hash FROM audit_events WHERE org_id = $1 AND seq = 3",
      [org],
    );
    expect(chiem[0]!.hash.equals(dau[0]!.hash)).toBe(true);

    // (c) và kiểm chứng vẫn sạch — không có ANCHOR_MISSING giả nào.
    const ketQua = await withTenant(apiPool, org, async (client) => {
      const neo = await exportChainHead(client, org);
      if (neo === null) throw new Error("không xuất được mốc chuỗi");
      return verifyAuditChain(client, org, { externalAnchors: [neo] });
    });
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
  });

  it("[INV-B3] recordChainAnchor vẫn neo được đúng đầu chuỗi, và trả null trên sổ rỗng", async () => {
    const org = await orgMoi("neo-hop-le");
    const rong = await withTenant(apiPool, org, (client) => recordChainAnchor(client, org));
    expect(rong, "sổ rỗng thì không có gì để neo").toBeNull();

    const neo = await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 4; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `M${i}`,
          resourceType: "TEST",
        });
      }
      return recordChainAnchor(client, org);
    });
    expect(neo?.seq).toBe(4);

    // Neo lại cùng đầu chuỗi -> ON CONFLICT DO NOTHING -> null. Đó là hành vi cũ, giữ nguyên.
    const lai = await withTenant(apiPool, org, (client) => recordChainAnchor(client, org));
    expect(lai).toBeNull();
  });

  it("[INV-B4] sau mọi mô phỏng tấn công, tám trigger trên bảng sổ vẫn ENABLE ALWAYS", async () => {
    const { rows } = await db.pool.query<{ tgname: string; tgenabled: string }>(
      "SELECT t.tgname, t.tgenabled FROM pg_trigger t " +
        " JOIN pg_class c ON c.oid = t.tgrelid " +
        " WHERE c.relname IN ('audit_events', 'audit_chain_anchors') AND NOT t.tgisinternal " +
        " ORDER BY 1",
    );
    expect(rows.map((r) => r.tgname)).toEqual([
      "audit_chain_anchors_chan_delete",
      "audit_chain_anchors_chan_truncate",
      "audit_chain_anchors_chan_update",
      "audit_chain_anchors_moc_neo",
      "audit_events_chan_delete",
      "audit_events_chan_truncate",
      "audit_events_chan_update",
      "audit_events_noi_chuoi",
    ]);
    expect(rows.every((r) => r.tgenabled === "A")).toBe(true);
  });
});
