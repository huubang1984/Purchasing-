// ==============================================================================================
// [S1.85 / khoản 131] MỘT LẦN TỪ CHỐI MẤT KHỎI SỔ PHẢI ĐỂ LẠI DÒNG LOG NÓI LẦN TỪ CHỐI NÀO.
//
// Khi khoá ghi sổ của một tổ chức bị giữ quá trần 2 s của `050`, MỌI lần ghi sổ của tổ chức ấy
// gãy `55P03` — kể cả lần ghi `PERMISSION_DENIED` của cổng quyền. Bất biến D5 vẫn đứng (thao tác
// bị từ chối, không hàng sổ, 500 ồn ào), nhưng thứ còn lại sau sự cố là dòng log, và tới trước
// vòng này dòng ấy KHÔNG nói lần từ chối nào đã mất.
//
// ĐO TRÊN HEAD TRƯỚC DÒNG MÃ ĐẦU TIÊN (§S1.85) — tiến trình `api` thật qua HTTP, `POST /suppliers`
// của một phiên KHÔNG vai trò, một giao dịch khác giữ khoá ghi sổ của tổ chức:
//
//     status=500 than={"error":"loi noi bo"} daCho=2052
//     [api] 9c5b2cd6-e418-40ed-aa1b-1cd28aee05de PermissionAuditFailedError <- error 55P03
//
// Tên lớp bọc và SQLSTATE của lần ghi — không `action`, không mã quyền, không `resourceType`,
// không mẫu route. Đúng như khoản 131 ghi từ S1.72.
//
// PHÉP ĐO NÀY LÀ CẢ HAI CHIỀU. Vế chính đòi các hằng đóng CÓ MẶT; vế đối chứng đòi dòng ấy KHÔNG
// mang một giá trị nào — id tổ chức, id người dùng, tên người gọi gửi lên. Thiếu vế sau thì
// "dòng log nói nhiều hơn" là một lời khen mà A2 phải trả giá.
//
// [S1.9161 / khoản 179] VẾ THỨ HAI, QUA NHÁNH `DenialAuditFailedError`. Hai vế trên đều đi qua
// `PermissionAuditFailedError` của cổng quyền; các lần từ chối NGOÀI cổng quyền (cổng mở thầu, A4,
// worker lúc giải mã) bọc bằng lớp kia, và tới trước vòng này dòng log của chúng chỉ mang `action`
// và `resourceType` — ba đường ghi cùng `UNSEAL_DENIED UNSEAL_REQUEST` nên khi mất sổ không nói
// được VẾ nào của cổng đã từ chối, mà hàng sổ mang `clause` chính là hàng không ghi được. Đo trên mã
// trước vòng này, cùng cảnh khoá ghi sổ bị giữ, `POST /unseal/:id/dispatch` với id không tồn tại:
//
//     [api] <requestId> POST /unseal/:unsealRequestId/dispatch DenialAuditFailedError UNSEAL_DENIED UNSEAL_REQUEST <- error 55P03
//
// Nay dòng ấy mang thêm vế `POLICY_GATE` — hằng thứ ba của `DenialAuditFailedError`, do chính chỗ
// gọi `throwAuditedDenial` truyền vào và đi qua cùng phép thuộc-tập (`packages/identity/src/rbac.ts`).
//
// [S1.9122 / khoản 177 / ADR-9223] VẾ THỨ BA — AI BỊ TỪ CHỐI. §S1.85 để ngỏ câu ấy, và ở đúng ca này
// lập luận "danh tính lấy từ sổ" không đứng: hàng sổ chính là thứ không ghi được. Chủ dự án chọn ⒞
// (2026-09-30): dòng mang `nguoi=<12 hex đầu của sha256(userId)>` — nối được các dòng của cùng một
// người với nhau mà không nêu ai; hình dạng ghim ở `moTaHangDongCuaLanTuChoi`. Phép đo là phép đo
// khoản 177 tự đề ra: dựng lại §S1.85 với BA phiên của BA người, rồi hỏi *"từ stderr một mình, dựng
// lại được tập người bị từ chối không"* — được, dưới dạng ba băm khác nhau khớp sha256 của ba id, và
// không dòng nào mang một UUID thô nào ngoài `requestId`. Trên mã trước vòng này dòng không có `nguoi=`.
// ==============================================================================================
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createDispatcher } from "./dispatch.js";
import { COOKIE_PHIEN_NGUOI_MUA } from "./routes/auth.js";
import { createApiServer } from "./server.js";
import { dichVuTest, type DichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** Tên người gọi gửi lên trong thân — một GIÁ TRỊ, và nó không được có mặt ở dòng log nào. */
const TEN_GUI_LEN = "Nha cung cap 4111-1111-1111-1111";

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let dv: DichVuTest;
let orgA: string;
let goc: string;
let server: ReturnType<typeof createApiServer>;
const logLoi: string[] = [];

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** [S1.9122 / khoản 177] Băm rút gọn mà ADR-9223 khai: 12 hex đầu của sha256(userId). Tính LẠI ở đây, độc lập với `rbac.ts`. */
function bamRutGon(userId: string): string {
  return sha256(userId).toString("hex").slice(0, 12);
}

/**
 * Một phiên NGƯỜI MUA đã qua MFA, với các vai trò cho trước. Không vai trò nào ⇒ mọi route ghi của nó là một lần từ chối
 * của cổng quyền; [S1.9161 / khoản 179] `DIRECTOR` ⇒ qua được cổng quyền `rfq.unseal` để tới cổng mở thầu.
 */
async function phienNguoiMua(vaiTro: readonly string[]): Promise<{ id: string; cookie: string }> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Khong vai tro') RETURNING id",
    [orgA, `k131-${randomBytes(4).toString("hex")}@vidu.vn`],
  );
  const id = rows[0]?.id ?? "";
  for (const v of vaiTro) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, v]);
  const token = randomBytes(32).toString("base64url");
  await db.pool.query(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
    [orgA, id, sha256(token)],
  );
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${orgA}.${token}` };
}

/** Khoá ghi sổ của tổ chức đang được MỘT giao dịch nào đó cầm? Cùng phép dò với `rbac.int.test.ts`. */
async function demKhoaGiuDuoc(org: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted " +
      "AND classid = ((pg_catalog.hashtextextended($1::text, 0) >> 32) & 4294967295)::oid " +
      "AND objid = (pg_catalog.hashtextextended($1::text, 0) & 4294967295)::oid",
    [org],
  );
  return rows[0]?.n ?? -1;
}

/**
 * Giữ khoá ghi sổ của tổ chức ở MỘT giao dịch khác, và chỉ trả về khi khoá THẬT SỰ đã được cầm — không thì phép đo có thể chạy
 * trước người giữ và lời gọi đi qua bình thường, tức một test XANH không đo gì. Hàm trả về thả khoá, chờ giao dịch giữ khoá kết
 * thúc và đóng pool; gọi lại lần nữa là no-op.
 */
async function giuKhoaGhiSo(org: string): Promise<() => Promise<void>> {
  const poolGiuKhoa = createPool(db.connectionString, 1, { role: "app_api" });
  let thaKhoa: () => void = () => {};
  const choTha = new Promise<void>((xong) => {
    thaKhoa = xong;
  });
  const giuKhoa = withTenant(poolGiuKhoa, org, async (c) => {
    await c.query("SELECT * FROM public.audit_append($1,'USER',NULL,'K131_GIU_KHOA','RFQ',NULL,'{}'::jsonb,NULL,NULL,NULL)", [org]);
    await choTha;
  });
  const tha = async (): Promise<void> => {
    thaKhoa();
    await giuKhoa.catch(() => undefined);
    await poolGiuKhoa.end().catch(() => undefined);
  };
  try {
    const han = Date.now() + 5000;
    for (;;) {
      if ((await demKhoaGiuDuoc(org)) >= 1) break;
      if (Date.now() > han) throw new Error("het 5000ms ma khoa ghi so cua to chuc chua duoc cam");
      await new Promise<void>((xong) => setTimeout(xong, 20));
    }
  } catch (loi) {
    await tha();
    throw loi;
  }
  return tha;
}

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logLoi.push(args.map(String).join(" "));
  });
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  orgA =
    (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id")).rows[0]
      ?.id ?? "";
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  dv = dichVuTest();
  server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180000);

afterAll(async () => {
  await new Promise<void>((xong) => server?.close(() => xong()));
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[INV-D5] [INV-A2] [S1.85 / khoản 131] lần từ chối mất khỏi sổ vì trần 2 s", { timeout: 120_000 }, () => {
  it("khoá ghi sổ của tổ chức bị giữ ⇒ 500 sau ~2 s với MỘT dòng log mang mẫu route, `action`, `resourceType` và mã quyền [S1.9122 / khoản 177] cộng băm rút gọn của người bị từ chối — và KHÔNG một giá trị nào", async () => {
    const ai = await phienNguoiMua([]);
    const thaKhoa = await giuKhoaGhiSo(orgA);
    try {
      const truoc = logLoi.length;
      const batDau = Date.now();
      const res = await fetch(`${goc}/suppliers`, {
        method: "POST",
        headers: { cookie: ai.cookie, "content-type": "application/json" },
        body: JSON.stringify({ legalName: TEN_GUI_LEN }),
      });
      const daCho = Date.now() - batDau;
      const than = await res.text();
      await thaKhoa();
      const moi = logLoi.slice(truoc);

      expect([res.status, JSON.parse(than)], than).toEqual([500, { error: "loi noi bo" }]);
      expect(daCho, "phải chờ tới trần 2 s của `050` rồi mới gãy 55P03").toBeGreaterThanOrEqual(1800);
      expect(moi, "một sự cố, một dòng").toHaveLength(1);
      // [S1.9122 / khoản 177] `nguoi=` là khe DUY NHẤT mở thêm: 12 hex, và phải là băm của CHÍNH người bị từ chối.
      const khop = /^\[api\] [0-9a-f-]{36} POST \/suppliers PermissionAuditFailedError PERMISSION_DENIED SUPPLIER supplier\.manage nguoi=([0-9a-f]{12}) <- error 55P03$/u.exec(
        moi[0] ?? "",
      );
      expect(khop, moi[0]).not.toBeNull();
      expect(khop?.[1], "băm rút gọn của chính người bị từ chối").toBe(bamRutGon(ai.id));
      expect(moi[0], "id người dùng thô không có mặt").not.toContain(ai.id);
      // [S1.87 / lượt soi ngang 74 góc 4 — ĐỌC] VÒNG "ĐỐI CHỨNG A2" Ở ĐÂY ĐÃ BỊ GỠ, và gỡ vì hai
      // lý do đo được, chứ không phải để test ngắn lại:
      //   ⑴ Nó không đo một bit nào. Khẳng định ngay trên neo HAI ĐẦU (`^…$`, KHÔNG cờ `m`) nên
      //      chuỗi đã bị xác định HOÀN TOÀN; vùng tự do duy nhất là 36 ký tự `requestId`. Xoá hẳn
      //      vòng ấy không làm mất một mệnh đề nào.
      //   ⑵ Nó là nguồn ĐỎ OAN duy nhất của tệp: `not.toContain("4111")` chạy trên chính chuỗi có
      //      `requestId` ngẫu nhiên hệ 16 ⇒ ~29 vị trí × 16⁻⁴, cỡ MỘT lượt trong hai nghìn đỏ mà
      //      không lỗi nào thật. Một khẳng định không bao giờ bắt được lỗi mà thỉnh thoảng đỏ giả
      //      là một khẳng định phải đi.
      // Vế A2 THẬT — có răng, đo từng giá trị qua chính hàm sinh chuỗi — sống ở
      // `packages/identity/src/mo-ta-hang-dong.test.ts`.
      // Và D5 thật, không chỉ dòng log: lần từ chối không vào sổ, thao tác không xảy ra.
      const { rows: so } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
        [orgA, ai.id],
      );
      expect(so[0]?.n).toBe("0");
      const { rows: ncc } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM suppliers WHERE org_id = $1 AND legal_name = $2",
        [orgA, TEN_GUI_LEN],
      );
      expect(ncc[0]?.n).toBe("0");
    } finally {
      await thaKhoa();
    }
  });

  it("[S1.9161 / khoản 179] khoá ghi sổ bị giữ, cổng mở thầu từ chối một yêu cầu KHÔNG TÌM THẤY ⇒ 500 sau ~2 s với MỘT dòng log mang mẫu route, `action`, `resourceType` VÀ VẾ `POLICY_GATE` — qua nhánh `DenialAuditFailedError`, không một giá trị nào", async () => {
    const gd = await phienNguoiMua(["DIRECTOR"]);
    const idLa = randomUUID();
    const thaKhoa = await giuKhoaGhiSo(orgA);
    try {
      const truoc = logLoi.length;
      const batDau = Date.now();
      const res = await fetch(`${goc}/unseal/${idLa}/dispatch`, { method: "POST", headers: { cookie: gd.cookie } });
      const daCho = Date.now() - batDau;
      const than = await res.text();
      await thaKhoa();
      const moi = logLoi.slice(truoc);

      expect([res.status, JSON.parse(than)], than).toEqual([500, { error: "loi noi bo" }]);
      expect(daCho, "phải chờ tới trần 2 s của `050` rồi mới gãy 55P03").toBeGreaterThanOrEqual(1800);
      expect(moi, "một sự cố, một dòng").toHaveLength(1);
      // Neo HAI ĐẦU: ngoài 36 ký tự `requestId`, chuỗi bị xác định hoàn toàn — nên id yêu cầu, id tổ chức, id người gọi không
      // có chỗ trong dòng (cùng lập luận với vế trên).
      // [S1.9122 / khoản 177] Nhánh `DenialAuditFailedError` cũng mang băm: cổng mở thầu ghi `actorId` của người gọi.
      const khop = /^\[api\] [0-9a-f-]{36} POST \/unseal\/:unsealRequestId\/dispatch DenialAuditFailedError UNSEAL_DENIED UNSEAL_REQUEST POLICY_GATE nguoi=([0-9a-f]{12}) <- error 55P03$/u.exec(
        moi[0] ?? "",
      );
      expect(khop, moi[0]).not.toBeNull();
      expect(khop?.[1], "băm rút gọn của chính người bị từ chối").toBe(bamRutGon(gd.id));
      expect(moi[0], "id người dùng thô không có mặt").not.toContain(gd.id);
      // D5 thật: lần từ chối không vào sổ.
      const { rows: so } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_DENIED' AND resource_id = $2",
        [orgA, idLa],
      );
      expect(so[0]?.n).toBe("0");
    } finally {
      await thaKhoa();
    }
  });

  it("[S1.9122 / khoản 177] BA phiên của BA người bị từ chối trong cùng một lần giữ khoá ⇒ từ stderr MỘT MÌNH dựng lại được đúng ba băm rút gọn KHÁC NHAU, khớp sha256 của ba id — và ngoài `requestId` không dòng nào mang một UUID thô", async () => {
    const ba = [await phienNguoiMua([]), await phienNguoiMua([]), await phienNguoiMua([])];
    const thaKhoa = await giuKhoaGhiSo(orgA);
    try {
      const truoc = logLoi.length;
      // Tuần tự, trong CÙNG một lần giữ khoá: pool api và pool sổ của test đều 3 kết nối, ba lần chờ khoá song song vừa khít cả
      // hai — một lần đo ở mép của đồ gá là một lần đo đỏ oan được. Mỗi lượt chờ đúng trần 2 s của `050`.
      const trangThai: number[] = [];
      for (const ai of ba) {
        const res = await fetch(`${goc}/suppliers`, {
          method: "POST",
          headers: { cookie: ai.cookie, "content-type": "application/json" },
          body: JSON.stringify({ legalName: TEN_GUI_LEN }),
        });
        await res.text();
        trangThai.push(res.status);
      }
      await thaKhoa();
      const moi = logLoi.slice(truoc);

      expect(trangThai).toEqual([500, 500, 500]);
      expect(moi, "ba lần từ chối mất sổ, ba dòng").toHaveLength(3);
      const MAU =
        /^\[api\] [0-9a-f-]{36} POST \/suppliers PermissionAuditFailedError PERMISSION_DENIED SUPPLIER supplier\.manage nguoi=([0-9a-f]{12}) <- error 55P03$/u;
      const bamTuLog = new Set<string>();
      for (const dong of moi) {
        const khop = MAU.exec(dong);
        expect(khop, dong).not.toBeNull();
        bamTuLog.add(khop?.[1] ?? "");
        for (const ai of ba) expect(dong, "id người dùng thô không có mặt").not.toContain(ai.id);
        // Ngoài 36 ký tự `requestId` ở đầu, phần còn lại của dòng không được mang một UUID nào.
        expect(dong.slice(dong.indexOf(" POST ")), "phần sau requestId không mang UUID").not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u,
        );
      }
      // Câu hỏi của khoản 177: từ stderr một mình, dựng lại được TẬP người bị từ chối không? — được, dưới dạng băm: ba người
      // ⇒ ba băm khác nhau, và mỗi băm là sha256 rút gọn của đúng một id trong ba.
      expect(bamTuLog.size, "ba người ⇒ ba băm KHÁC NHAU — các dòng nối được với nhau theo người").toBe(3);
      expect([...bamTuLog].sort()).toEqual(ba.map((ai) => bamRutGon(ai.id)).sort());
      // D5 thật cho cả ba: không hàng sổ nào.
      for (const ai of ba) {
        const { rows } = await db.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
          [orgA, ai.id],
        );
        expect(rows[0]?.n, ai.id).toBe("0");
      }
    } finally {
      await thaKhoa();
    }
  });

  it("ĐỐI CHỨNG [S1.9161 / khoản 179]: không ai giữ khoá ⇒ cùng lời gọi ra 422 và MỘT hàng sổ `UNSEAL_DENIED` mang vế `POLICY_GATE`, không dòng log", async () => {
    const gd = await phienNguoiMua(["DIRECTOR"]);
    const idLa = randomUUID();
    const truoc = logLoi.length;
    const res = await fetch(`${goc}/unseal/${idLa}/dispatch`, { method: "POST", headers: { cookie: gd.cookie } });
    expect(res.status, await res.text()).toBe(422);
    expect(logLoi.slice(truoc)).toEqual([]);
    const { rows } = await db.pool.query<{ clause: string }>(
      "SELECT payload->>'clause' AS clause FROM audit_events WHERE org_id = $1 AND action = 'UNSEAL_DENIED' AND resource_id = $2",
      [orgA, idLa],
    );
    expect(rows).toEqual([{ clause: "POLICY_GATE" }]);
  });

  it("ĐỐI CHỨNG: không ai giữ khoá ⇒ cùng lời gọi ra 403 và MỘT hàng sổ, không dòng log — phép đo trên đo đúng ca `55P03`, không phải mọi lần từ chối", async () => {
    const ai = await phienNguoiMua([]);
    const truoc = logLoi.length;
    const res = await fetch(`${goc}/suppliers`, {
      method: "POST",
      headers: { cookie: ai.cookie, "content-type": "application/json" },
      body: JSON.stringify({ legalName: TEN_GUI_LEN }),
    });
    expect(res.status).toBe(403);
    expect(logLoi.slice(truoc)).toEqual([]);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND actor_id = $2 AND action = 'PERMISSION_DENIED'",
      [orgA, ai.id],
    );
    expect(rows[0]?.n).toBe("1");
  });
});
