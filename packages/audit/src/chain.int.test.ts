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

  it("[INV-B3] chuỗi nguyên vẹn thì kiểm chứng đạt", async () => {
    const org = await orgMoi("chuoi-nguyen-ven");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 25; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `HANH_DONG_${i}`,
          resourceType: "TEST",
          payload: { chiSo: i, ghiChu: "giá trị có dấu tiếng Việt" },
        });
      }
    });

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(ketQua.problems).toEqual([]);
    expect(ketQua.ok).toBe(true);
    expect(ketQua.checked).toBe(25);
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

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
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

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
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

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
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

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
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

    // Không có neo ngoài: sổ RỖNG trông "hợp lệ" — đúng đúng cái mà bàn giao Task 5 cảnh báo.
    const khongNeo = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(khongNeo.ok).toBe(true);
    expect(khongNeo.checked).toBe(0);

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

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
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
      return verifyAuditChain(client, org);
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

    const ketQua = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
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
      return verifyAuditChain(client, org);
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
                '11111111-1111-1111-1111-111111111111'::uuid, 1::bigint,
                '2026-08-27 10:11:12.123456+00'::timestamptz, 'USER', NULL,
                'A', 'B' || chr(31) || 'C', NULL, '{}'::jsonb, NULL)
            = audit_compute_hash(decode(repeat('00',32),'hex'),
                '11111111-1111-1111-1111-111111111111'::uuid, 1::bigint,
                '2026-08-27 10:11:12.123456+00'::timestamptz, 'USER', NULL,
                'A' || chr(31) || 'B', 'C', NULL, '{}'::jsonb, NULL) AS trung`,
    );
    expect(rows[0]!.trung).toBe(false);
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

  it("[INV-B4] sau mọi mô phỏng tấn công, bảy trigger trên bảng sổ vẫn ENABLE ALWAYS", async () => {
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
      "audit_events_chan_delete",
      "audit_events_chan_truncate",
      "audit_events_chan_update",
      "audit_events_noi_chuoi",
    ]);
    expect(rows.every((r) => r.tgenabled === "A")).toBe(true);
  });
});
