// ==============================================================================================
// [S1.9101 / S4.3b] ÁNH XẠ HẠNG MỤC QUA HTTP — lượt chuẩn hoá sau lần nộp duyệt, hàng đợi, trạng thái từng dòng, ba đường ghi.
//
//   ⑴ lần nộp duyệt qua HTTP ở tổ chức có hàng chuẩn đang dùng: khi phản hồi 200 về, dòng trùng bí danh đã `TU_DONG` và dòng còn lại
//      có gợi ý — lượt chuẩn hoá chạy SAU commit, dưới phiên người nộp, một hàng sổ `RFQ_ITEMS_NORMALIZED`;
//   ⑵ tổ chức chưa có hàng chuẩn đang dùng: lần nộp duyệt không để lại hàng gợi ý, ánh xạ hay hàng sổ nào — hành vi hôm nay (spec §2.3);
//   ⑶ ngữ nghĩa của `afterCommitGiaoDich` trên route GIẢ: giao dịch MỚI đã gắn tổ chức, chỉ khi phản hồi thành công, hỏng thì phản hồi
//      giữ nguyên và một dòng log không nội dung;
//   ⑷ năm route: hai route đọc `agent: false`, ba route ghi khai `item.manage` và tọa độ gói; [INV-L3] người tạo gói gọi ba route ghi
//      ⇒ 403; người quản lý dữ liệu duyệt (hàng đợi học), bác, tạo hàng chuẩn mới, chuẩn hoá lại; lần từ chối có tên ra 422 có mã;
//      tổ chức khác không thấy hàng đợi.
// ==============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import type { ApiResponse } from "./http.js";
import type { BuyerContext, BuyerReadRoute, Route } from "./route-types.js";
import { ROUTES } from "./routes.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const UUID0 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc: string;
let gocGia: string;
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi {
  readonly id: string;
  readonly cookie: string;
}

async function nguoi(org: string, roles: readonly string[], hoTen = "Nguoi"): Promise<Nguoi> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
    [org, `${randomBytes(4).toString("hex")}@vidu.vn`, hoTen],
  );
  const id = rows[0]?.id ?? "";
  for (const r of roles) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, r]);
  const token = randomBytes(32).toString("base64url");
  await db.pool.query(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())",
    [org, id, createHash("sha256").update(token, "utf8").digest()],
  );
  return { id, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
}

interface PhanHoi {
  readonly status: number;
  readonly text: string;
  readonly body: Record<string, unknown>;
}

async function goiTai(noi: string, method: string, path: string, ai: Nguoi, body?: unknown): Promise<PhanHoi> {
  const headers: Record<string, string> = { cookie: ai.cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${noi}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}
const goi = (method: string, path: string, ai: Nguoi, body?: unknown): Promise<PhanHoi> => goiTai(goc, method, path, ai, body);

async function dungServer(dispatcher: ReturnType<typeof createDispatcher>): Promise<string> {
  const server = createApiServer(dispatcher);
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  dongServer.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function demTheoGoi(bang: "rfq_item_goi_y" | "rfq_item_mappings", rfqId: string): Promise<number> {
  return Number((await db.pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${bang} WHERE rfq_id = $1`, [rfqId])).rows[0]?.n ?? "-1");
}

async function soLuotChuanHoa(rfqId: string): Promise<{ actor_id: string; payload: Record<string, unknown> }[]> {
  return (
    await db.pool.query<{ actor_id: string; payload: Record<string, unknown> }>(
      "SELECT actor_id, payload FROM audit_events WHERE resource_id = $1 AND action = 'RFQ_ITEMS_NORMALIZED' ORDER BY seq",
      [rfqId],
    )
  ).rows;
}

interface ToChuc {
  readonly id: string;
  readonly nguoiMua: Nguoi;
  readonly taiChinh: Nguoi;
}

async function taoToChuc(slug: string): Promise<ToChuc> {
  const id = (await db.pool.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [slug, slug])).rows[0]!.id;
  const taiChinh = await nguoi(id, ["FINANCE"], "Le Tai Chinh");
  const cs = await goi("POST", "/policy", taiChinh, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND" });
  expect(cs.status, cs.text).toBe(201);
  return { id, nguoiMua: await nguoi(id, ["BUYER"], "Tran Nguoi Mua"), taiChinh };
}

/** Gói qua HTTP — tạo, dòng, ngân sách dưới ngưỡng, nộp duyệt. Trả id gói và phản hồi của lần nộp. */
async function goiDaNop(tc: ToChuc, dong: readonly string[]): Promise<{ readonly rfqId: string; readonly nop: PhanHoi }> {
  const han = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const rfq = await goi("POST", "/rfqs", tc.nguoiMua, { title: "Mua vat tu", deadlineAt: han });
  expect(rfq.status, rfq.text).toBe(201);
  const rfqId = (rfq.body as { rfq: { id: string } }).rfq.id;
  for (const [i, moTa] of dong.entries()) {
    const r = await goi("POST", `/rfqs/${rfqId}/items`, tc.nguoiMua, { lineNo: i + 1, description: moTa, quantity: "10.0000", unit: "kg" });
    expect(r.status, r.text).toBe(201);
  }
  const ns = await goi("PUT", `/rfqs/${rfqId}/budget`, tc.nguoiMua, { estimatedValue: "1000000.00", currency: "VND" });
  expect(ns.status, ns.text).toBe(200);
  return { rfqId, nop: await goi("POST", `/rfqs/${rfqId}/submit`, tc.nguoiMua) };
}

let A: ToChuc;
let B: ToChuc;
let C: ToChuc;
let quanLy: Nguoi;
let quanLyB: Nguoi;
let hangD10 = "";
let hangD12 = "";

// ---------------------------------------------------------------------------------------------
// Route GIẢ cho ngữ nghĩa của `afterCommitGiaoDich` (⑶).
// ---------------------------------------------------------------------------------------------
const vet: { viec: string; tx: string; org: string | null }[] = [];
let txHandler = "";

async function ghiVet(viec: string, c: pg.PoolClient): Promise<void> {
  const h = (
    await c.query<{ t: string; org: string | null }>("SELECT pg_catalog.txid_current()::text AS t, pg_catalog.current_setting('app.org_id', true) AS org")
  ).rows[0]!;
  vet.push({ viec, tx: h.t, org: h.org });
}
function loiCoTen(ten: string, thongDiep: string): Error {
  return Object.assign(new Error(thongDiep), { name: ten });
}

function tuyenGia(): Route[] {
  const tuyen = (path: string, handler: (ctx: BuyerContext) => Promise<ApiResponse>): BuyerReadRoute => ({ method: "GET", path, audience: "BUYER", mutates: false, agent: false, handler });
  return [
    tuyen("/s43b/hai-viec", async (ctx) => {
      txHandler = (await ctx.client.query<{ t: string }>("SELECT pg_catalog.txid_current()::text AS t")).rows[0]!.t;
      ctx.afterCommitGiaoDich((c) => ghiVet("mot", c));
      ctx.afterCommitGiaoDich((c) => ghiVet("hai", c));
      return { status: 200, body: { ok: true } };
    }),
    tuyen("/s43b/viec-hong", (ctx) => {
      ctx.afterCommitGiaoDich(() => Promise.reject(loiCoTen("LoiGiaChuanHoa", "noi dung khong duoc ra log")));
      ctx.afterCommitGiaoDich((c) => ghiVet("sau-viec-hong", c));
      return Promise.resolve({ status: 200, body: { ok: true } });
    }),
    tuyen("/s43b/phan-hoi-422", (ctx) => {
      ctx.afterCommitGiaoDich((c) => ghiVet("khong-duoc-chay", c));
      return Promise.resolve({ status: 422, body: { error: "gia 422" } });
    }),
  ];
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
  auditPool = db.poolAs("app_api");
  const services = dichVuTest().services;
  goc = await dungServer(createDispatcher({ pool: apiPool, auditPool, services }));
  gocGia = await dungServer(createDispatcher({ pool: apiPool, auditPool, services, routes: tuyenGia() }));
  A = await taoToChuc("axb-a");
  B = await taoToChuc("axb-b");
  C = await taoToChuc("axb-c");
  quanLy = await nguoi(A.id, ["DATA_STEWARD"], "Nguyen Quan Ly");
  quanLyB = await nguoi(B.id, ["DATA_STEWARD"]);
  const tao = async (ma: string, ten: string, kichThuoc: string): Promise<string> => {
    const r = await goi("POST", "/items", quanLy, { ma, ten, donViGoc: "kg", thuocTinh: { kich_thuoc: kichThuoc }, thuocTinhTrongYeu: ["kich_thuoc"] });
    expect(r.status, r.text).toBe(201);
    return (r.body as { hangChuan: { id: string } }).hangChuan.id;
  };
  hangD10 = await tao("THEP-D10", "Thép vằn D10", "10");
  hangD12 = await tao("THEP-D12", "Thép vằn D12", "12");
  const bd = await goi("POST", `/items/${hangD10}/aliases`, quanLy, { biDanh: "Thép D10 Hòa Phát" });
  expect(bd.status, bd.text).toBe(201);
}, 240000);

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.9101 / S4.3b] ⑴ ⑵ lượt chuẩn hoá sau lần nộp duyệt", () => {
  it("tổ chức có hàng chuẩn đang dùng: phản hồi 200 của lần nộp về khi dòng trùng bí danh đã TU_DONG và dòng còn lại có gợi ý", async () => {
    const { rfqId, nop } = await goiDaNop(A, ["Thép D10 Hòa Phát", "Thép vằn D12", "Gạch thẻ đỏ"]);
    expect(nop.status, nop.text).toBe(200);
    const r = await goi("GET", `/rfqs/${rfqId}/mappings`, A.nguoiMua);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual({
      dong: [
        { lineNo: 1, trangThai: "TU_DONG", hangChuan: { id: hangD10, ma: "THEP-D10" }, lyDo: null },
        { lineNo: 2, trangThai: "CHO_DUYET", hangChuan: null, lyDo: null },
        { lineNo: 3, trangThai: "CHO_DUYET", hangChuan: null, lyDo: null },
      ],
    });
    // Một lượt, dưới phiên NGƯỜI NỘP — tác giả của hàng TU_DONG và của hàng sổ.
    expect(await soLuotChuanHoa(rfqId)).toEqual([
      { actor_id: A.nguoiMua.id, payload: { phienBan: 1, tuDong: 1, goiY: 1, canDuyet: 1, daCo: 0, khongDoi: 0, hoiTo: false } },
    ]);
    const { rows } = await db.pool.query<{ tac_gia: string }>("SELECT tac_gia FROM rfq_item_mappings WHERE rfq_id = $1", [rfqId]);
    expect(rows).toEqual([{ tac_gia: A.nguoiMua.id }]);
  });

  it("tổ chức chưa có hàng chuẩn nào: lần nộp duyệt không để lại hàng gợi ý, ánh xạ hay hàng sổ nào — hành vi hôm nay", async () => {
    const { rfqId, nop } = await goiDaNop(C, ["Thép D10 Hòa Phát", "Gạch thẻ đỏ"]);
    expect(nop.status, nop.text).toBe(200);
    expect([await demTheoGoi("rfq_item_goi_y", rfqId), await demTheoGoi("rfq_item_mappings", rfqId)]).toEqual([0, 0]);
    expect(await soLuotChuanHoa(rfqId)).toEqual([]);
    expect(((await goi("GET", `/rfqs/${rfqId}/mappings`, C.nguoiMua)).body as { dong: { trangThai: string }[] }).dong.map((d) => d.trangThai)).toEqual([
      "CHUA_CHUAN_HOA",
      "CHUA_CHUAN_HOA",
    ]);
  });

  it("tổ chức chỉ có hàng chuẩn đã ngừng dùng: cũng không chạy", async () => {
    const D = await taoToChuc("axb-d");
    const ql = await nguoi(D.id, ["DATA_STEWARD"]);
    const h = await goi("POST", "/items", ql, { ma: "CU-1", ten: "Hàng cũ", donViGoc: "kg" });
    expect(h.status, h.text).toBe(201);
    const id = (h.body as { hangChuan: { id: string } }).hangChuan.id;
    expect((await goi("POST", `/items/${id}/versions`, ql, { ten: "Hàng cũ", trangThai: "NGUNG_DUNG" })).status).toBe(201);
    const { rfqId, nop } = await goiDaNop(D, ["Hàng cũ"]);
    expect(nop.status, nop.text).toBe(200);
    expect(await demTheoGoi("rfq_item_goi_y", rfqId)).toBe(0);
    expect(await soLuotChuanHoa(rfqId)).toEqual([]);
  });
});

describe("[S1.9101 / S4.3b] ⑶ `afterCommitGiaoDich` — giao dịch mới, chỉ khi thành công, hỏng không đổi phản hồi", () => {
  it("mỗi việc một giao dịch MỚI đã gắn tổ chức, theo thứ tự đăng ký, sau commit của handler", async () => {
    vet.length = 0;
    const r = await goiTai(gocGia, "GET", "/s43b/hai-viec", A.nguoiMua);
    expect(r.status, r.text).toBe(200);
    expect(vet.map((v) => v.viec)).toEqual(["mot", "hai"]);
    expect(vet.every((v) => v.org === A.id)).toBe(true);
    expect(new Set([txHandler, ...vet.map((v) => v.tx)]).size).toBe(3);
  });

  it("một việc hỏng: phản hồi giữ nguyên, việc sau vẫn chạy, và đúng một dòng log mang TÊN lỗi, không nội dung", async () => {
    vet.length = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await goiTai(gocGia, "GET", "/s43b/viec-hong", A.nguoiMua);
      expect(r.status, r.text).toBe(200);
      expect(r.body).toEqual({ ok: true });
      const dong = log.mock.calls.map((c) => String(c[0])).filter((d) => d.includes("giao-dich-sau-commit"));
      expect(dong).toHaveLength(1);
      expect(dong[0]).toContain("LoiGiaChuanHoa");
      expect(dong[0]).not.toContain("noi dung");
    } finally {
      log.mockRestore();
    }
    expect(vet.map((v) => v.viec)).toEqual(["sau-viec-hong"]);
  });

  it("phản hồi 4xx: không việc nào chạy", async () => {
    vet.length = 0;
    const r = await goiTai(gocGia, "GET", "/s43b/phan-hoi-422", A.nguoiMua);
    expect(r.status).toBe(422);
    expect(vet).toEqual([]);
  });
});

describe("[S1.9101 / S4.3b] ⑷ năm route ánh xạ", () => {
  it("hai route đọc `agent: false`; ba route ghi khai `item.manage`, loại tài nguyên RFQ và tọa độ gói", () => {
    const cua = ROUTES.filter((r) => r.path === "/mapping-queue" || /^\/rfqs\/:rfqId\/(?:mappings|normalize|items\/:lineNo\/mapping)/u.test(r.path));
    expect(cua.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /mapping-queue",
      "GET /rfqs/:rfqId/mappings",
      "POST /rfqs/:rfqId/items/:lineNo/mapping",
      "POST /rfqs/:rfqId/items/:lineNo/mapping/new-item",
      "POST /rfqs/:rfqId/normalize",
    ]);
    for (const r of cua) {
      expect(r.audience, r.path).toBe("BUYER");
      if ("mutates" in r && r.mutates) {
        expect("permission" in r ? r.permission : null, r.path).toBe("item.manage");
        expect("resourceType" in r ? r.resourceType : null, r.path).toBe("RFQ");
        expect("resourceId" in r && typeof r.resourceId === "function", r.path).toBe(true);
      } else {
        expect("agent" in r ? r.agent : null, r.path).toBe(false);
      }
    }
  });

  it("[INV-L3] người tạo gói gọi ba route ghi ⇒ 403 cả ba, mỗi lần một hàng PERMISSION_DENIED, không hàng ánh xạ nào", async () => {
    const { rfqId } = await goiDaNop(A, ["Thép vằn D12 người tạo"]);
    const truocAnhXa = await demTheoGoi("rfq_item_mappings", rfqId);
    const ca: [string, unknown][] = [
      [`/rfqs/${rfqId}/normalize`, undefined],
      [`/rfqs/${rfqId}/items/1/mapping`, { hangChuanId: hangD12 }],
      [`/rfqs/${rfqId}/items/1/mapping/new-item`, { ma: "TAO-1", ten: "X", donViGoc: "kg" }],
    ];
    for (const [p, b] of ca) {
      const r = await goi("POST", p, A.nguoiMua, b);
      expect(r.status, `${p}: ${r.text}`).toBe(403);
    }
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE actor_id = $1 AND action = 'PERMISSION_DENIED' AND resource_type = 'RFQ' AND resource_id = $2",
      [A.nguoiMua.id, rfqId],
    );
    expect(rows[0]?.n).toBe("3");
    expect(await demTheoGoi("rfq_item_mappings", rfqId)).toBe(truocAnhXa);
  });

  it("người quản lý dữ liệu: hàng đợi, bác đòi lý do sau GOI_Y (422 có mã), duyệt kèm bí danh, tạo hàng chuẩn mới, chuẩn hoá lại", async () => {
    const { rfqId } = await goiDaNop(A, ["Thép vằn D12", "Gạch thẻ đỏ hàng đợi", "Cát vàng hàng đợi"]);
    // Hàng đợi: người quản lý và người mua cùng thấy; tổ chức B không thấy gói của A.
    const hd = await goi("GET", "/mapping-queue", quanLy);
    expect(hd.status, hd.text).toBe(200);
    const cuaGoi = (hd.body as { dong: { rfqId: string; lineNo: number; goiY: { ketQua: string; tacGia: string } | null }[] }).dong.filter((d) => d.rfqId === rfqId);
    expect(cuaGoi.map((d) => [d.lineNo, d.goiY?.ketQua, d.goiY?.tacGia])).toEqual([
      [1, "GOI_Y", "Tran Nguoi Mua"],
      [2, "CAN_DUYET", "Tran Nguoi Mua"],
      [3, "CAN_DUYET", "Tran Nguoi Mua"],
    ]);
    expect((await goi("GET", "/mapping-queue", A.nguoiMua)).status).toBe(200);
    expect(((await goi("GET", "/mapping-queue", quanLyB)).body as { dong: { rfqId: string }[] }).dong.some((d) => d.rfqId === rfqId)).toBe(false);

    const bac = await goi("POST", `/rfqs/${rfqId}/items/1/mapping`, quanLy, { hangChuanId: null });
    expect(bac.status, bac.text).toBe(422);
    expect(bac.text).toContain("CAN_LY_DO");
    const duyet = await goi("POST", `/rfqs/${rfqId}/items/1/mapping`, quanLy, { hangChuanId: hangD12, taoBiDanh: true });
    expect(duyet.status, duyet.text).toBe(201);
    const bacCoLyDo = await goi("POST", `/rfqs/${rfqId}/items/3/mapping`, quanLy, { hangChuanId: null, lyDo: "vat lieu dia phuong" });
    expect(bacCoLyDo.status, bacCoLyDo.text).toBe(201);
    const moi = await goi("POST", `/rfqs/${rfqId}/items/2/mapping/new-item`, quanLy, { ma: "GACH-THE-DO", ten: "Gạch thẻ đỏ", donViGoc: "kg", taoBiDanh: true });
    expect(moi.status, moi.text).toBe(201);
    const hangGach = (moi.body as { hangChuanId: string }).hangChuanId;

    expect((await goi("GET", `/rfqs/${rfqId}/mappings`, A.nguoiMua)).body).toEqual({
      dong: [
        { lineNo: 1, trangThai: "NGUOI_DUYET", hangChuan: { id: hangD12, ma: "THEP-D12" }, lyDo: null },
        { lineNo: 2, trangThai: "NGUOI_DUYET", hangChuan: { id: hangGach, ma: "GACH-THE-DO" }, lyDo: null },
        { lineNo: 3, trangThai: "NGUOI_DUYET", hangChuan: null, lyDo: "vat lieu dia phuong" },
      ],
    });
    // Chuẩn hoá lại: mọi dòng đã có ánh xạ hiệu lực — không đụng.
    const lai = await goi("POST", `/rfqs/${rfqId}/normalize`, quanLy);
    expect(lai.status, lai.text).toBe(200);
    expect(lai.body).toMatchObject({ ketQua: { tuDong: 0, daCo: 3 } });
    // Hàng đợi học: gói sau có đúng chuỗi ấy ⇒ TU_DONG ngay ở lần nộp.
    const sau = await goiDaNop(A, ["THÉP VẰN D12", "gạch thẻ đỏ hàng đợi"]);
    expect(((await goi("GET", `/rfqs/${sau.rfqId}/mappings`, A.nguoiMua)).body as { dong: { trangThai: string }[] }).dong.map((d) => d.trangThai)).toEqual([
      "TU_DONG",
      "TU_DONG",
    ]);
  });

  it("từ chối có tên ra 422 có mã; tham số sai hình dạng và gói lạ ra 404; thân sai kiểu ra 422", async () => {
    const soan = await goi("POST", "/rfqs", A.nguoiMua, { title: "Con soan", deadlineAt: new Date(Date.now() + 86400000).toISOString() });
    const soanId = (soan.body as { rfq: { id: string } }).rfq.id;
    await goi("POST", `/rfqs/${soanId}/items`, A.nguoiMua, { lineNo: 1, description: "Thép vằn D12", quantity: "1.0000", unit: "kg" });
    const conSoan = await goi("POST", `/rfqs/${soanId}/items/1/mapping`, quanLy, { hangChuanId: hangD12 });
    expect(conSoan.status, conSoan.text).toBe(422);
    expect(conSoan.text).toContain("GOI_CON_SOAN");
    const { rfqId } = await goiDaNop(A, ["Thép vằn D12 dòng thiếu"]);
    const khongDong = await goi("POST", `/rfqs/${rfqId}/items/9/mapping`, quanLy, { hangChuanId: hangD12 });
    expect(khongDong.status, khongDong.text).toBe(422);
    expect(khongDong.text).toContain("KHONG_CO_HANG_MUC");
    expect((await goi("POST", `/rfqs/${rfqId}/items/0/mapping`, quanLy, { hangChuanId: hangD12 })).status).toBe(404);
    expect((await goi("POST", `/rfqs/${rfqId}/items/x/mapping`, quanLy, { hangChuanId: hangD12 })).status).toBe(404);
    expect((await goi("GET", "/rfqs/khong-phai-uuid/mappings", quanLy)).status).toBe(404);
    expect((await goi("GET", `/rfqs/${UUID0}/mappings`, quanLy)).status).toBe(404);
    expect((await goi("POST", `/rfqs/${rfqId}/items/1/mapping`, quanLy, {})).status).toBe(422);
    expect((await goi("POST", `/rfqs/${rfqId}/items/1/mapping`, quanLy, { hangChuanId: "d12" })).status).toBe(422);
    expect((await goi("POST", `/rfqs/${rfqId}/items/1/mapping`, quanLy, { hangChuanId: hangD12, taoBiDanh: "co" })).status).toBe(422);
    expect((await goi("POST", `/rfqs/${rfqId}/items/1/mapping`, quanLy, { hangChuanId: null, lyDo: 5 })).status).toBe(422);
  });
});
