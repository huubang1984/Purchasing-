// [S1.9101 / S4.4a] Lịch sử giá — trên Postgres thật (spec S4 §4.5, §3.3, §2.5 ⑿ ⒀ ⒁; §5.1 L5).
//
//   ⑴ `bid_dong_tho` — bộ đọc dòng: SÁU ca của `bid_so_tien` trên `amount` và trên `totalAmount`, `lines` không phải mảng, hai
//      phần tử cùng `lineNo`, `lineNo` sai kiểu, phép so tổng CHÍNH XÁC, `unitPrice` không được đọc, không bao giờ ném;
//   ⑵ `gia_da_lo` — theo DỮ LIỆU tại mốc: vòng một chưa chạy, vòng BAFO đang mở hay đã đóng mà chưa mở niêm phong, huỷ;
//      `EVALUATING` được tính (không đọc `status`);
//   ⑶ `quan_sat_gia` — vị thế CUỐI, đơn giá = `amount / quantity`, sáu trạng thái đúng thứ tự ưu tiên, tiền tệ so với chính sách
//      của CHÍNH gói, quy đổi về MÃ gốc (kể cả mã mơ hồ `t`), mọi hàng nền đọc TẠI MỐC, hai nhãn `HOI_TO`/`SAU_MOC`, nhánh lọc
//      theo hàng chuẩn trùng khít nhánh đọc hết, phiên khách và tổ chức khác ra 0 hàng.
//
// Gói nền dữ liệu không với tới đường mở thầu (`g19-`), kể cả trong test: gói đã mở niêm phong và vòng BAFO dựng bằng SQL thô
// dưới vai chủ cụm, theo đúng thứ tự các cạnh mà đường thật đi (khuôn fixture của `anh-xa.int.test.ts` và
// `luot-danh-gia.int.test.ts`) — mọi trigger ENABLE ALWAYS vẫn chạy.
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { khaiBiDanhDonVi, khaiQuyDoiRieng, taoHangChuan, taoPhienBanHangChuan } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

interface Nguoi {
  readonly nguoi: string;
  readonly phien: string;
}
interface BaoGia {
  readonly versionId: string;
  readonly bidId: string;
  readonly phienKhach: string;
  readonly supplierId: string;
}
interface Dong {
  readonly moTa: string;
  readonly soLuong: string;
  readonly donVi: string;
}
interface QuanSat {
  readonly rfq_id: string;
  readonly supplier_id: string;
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly ngay_quan_sat: string;
  readonly anh_xa_id: string | null;
  readonly canonical_item_id: string | null;
  readonly thanh_tien: string | null;
  readonly so_luong: string;
  readonly don_vi: string;
  readonly don_gia: string | null;
  readonly don_vi_goc: string | null;
  readonly he_so: string | null;
  readonly don_gia_quy_doi: string | null;
  readonly tien_te: string | null;
  readonly trang_thai: string;
  readonly hoi_to: readonly string[];
  readonly sau_moc: Readonly<Record<string, number>>;
}

let db: TestDatabase;
let api: pg.Pool;
let orgA = "";
let orgB = "";
let pm: Nguoi;
let duyet: Nguoi;
let duyet2: Nguoi;
let ql: Nguoi;
let chinhSachA = "";
let hangThep = "";
let hangCat = "";
let hangCay = "";

const trong = <T>(orgId: string, viec: (c: pg.PoolClient) => Promise<T>): Promise<T> => withTenant(api, orgId, viec);

async function taoNguoi(orgId: string, vai: readonly string[]): Promise<Nguoi> {
  const nguoi = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'Nguoi') RETURNING id", [
      orgId,
      `${randomBytes(5).toString("hex")}@vidu.vn`,
    ])
  ).rows[0]!.id;
  const phien = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [orgId, nguoi, randomBytes(32)],
    )
  ).rows[0]!.id;
  for (const v of vai) await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgId, nguoi, v]);
  return { nguoi, phien };
}

/** Giờ của CỤM, dạng chữ — `Date` của JS cắt xuống mili giây, còn `ghi_luc` giữ micro giây. */
async function gio(): Promise<string> {
  return (await db.pool.query<{ t: string }>("SELECT clock_timestamp()::text AS t")).rows[0]!.t;
}

// ---- Gói, báo giá, mở thầu (SQL thô, đúng thứ tự cạnh của đường thật) -----------------------------------------------------
/** `tienTeNganSach` NULL: gói KHÔNG ngân sách — D2 khi ấy đòi phê duyệt kép, nên gói mang cờ ấy và hai chữ ký. */
async function taoGoi(dong: readonly Dong[], tienTeNganSach: "VND" | null = "VND"): Promise<string> {
  const rfqId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Mua vat tu', $2, $3, $4, $5) RETURNING id",
      [orgA, MAI_SAU, tienTeNganSach === null, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  for (const [i, d] of dong.entries()) {
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [orgA, rfqId, i + 1, d.moTa, d.soLuong, d.donVi, pm.nguoi, pm.phien],
    );
  }
  if (tienTeNganSach !== null) {
    await db.pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
        "VALUES ($1, $2, '1000000000.00', $3, $4, $5, $6)",
      [orgA, rfqId, tienTeNganSach, chinhSachA, pm.nguoi, pm.phien],
    );
  }
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, pm.nguoi, pm.phien],
  );
  for (const n of tienTeNganSach === null ? [duyet, duyet2] : [duyet]) {
    await db.pool.query("INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)", [
      orgA,
      rfqId,
      n.nguoi,
      n.phien,
    ]);
  }
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), pm.nguoi, pm.phien],
    );
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [
      rfqId,
      pm.nguoi,
      pm.phien,
    ]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  return rfqId;
}

/** `ncc` cho sẵn: mời lại ĐÚNG nhà cung cấp ấy (lời mời mới, báo giá mới) — ca thu hồi rồi mời lại. */
async function nopBaoGia(rfqId: string, ncc?: { readonly supplierId: string; readonly lienHe: string }): Promise<BaoGia & { readonly lienHe: string; readonly loiMoi: string }> {
  const supplierId =
    ncc?.supplierId ??
    (
      await db.pool.query<{ id: string }>(
        "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [orgA, `NCC ${randomBytes(3).toString("hex")}`, pm.nguoi, pm.phien],
      )
    ).rows[0]!.id;
  const lienHe =
    ncc?.lienHe ??
    (
      await db.pool.query<{ id: string }>(
        "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
          "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
        [orgA, supplierId, `${randomBytes(4).toString("hex")}@ncc.vn`, pm.nguoi, pm.phien],
      )
    ).rows[0]!.id;
  const loiMoi = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
      [orgA, rfqId, supplierId, lienHe, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  const token = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
        "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
      [orgA, loiMoi, randomBytes(32), pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  const thachThuc = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, " +
        "destination_hash, pepper_version, expires_at, consumed_at) " +
        "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
      [orgA, loiMoi, token, lienHe, randomBytes(32), randomBytes(32)],
    )
  ).rows[0]!.id;
  const phienKhach = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
        "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
      [orgA, loiMoi, thachThuc, randomBytes(32), lienHe],
    )
  ).rows[0]!.id;
  return trong(orgA, async (c) => {
    const bidId = (await c.query<{ id: string }>("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [orgA, loiMoi]))
      .rows[0]!.id;
    const versionId = await chenPhienBan(c, rfqId, bidId, phienKhach);
    return { versionId, bidId, phienKhach, supplierId, lienHe, loiMoi };
  });
}

async function chenPhienBan(c: pg.PoolClient, rfqId: string, bidId: string, phienKhach: string): Promise<string> {
  const v = (
    await c.query<{ id: string; version: number }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id, version",
      [orgA, bidId, Buffer.alloc(64, 9), phienKhach],
    )
  ).rows[0]!;
  await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
    orgA,
    v.id,
    `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bidId}\n` +
      `version=${String(v.version)}\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-30T00:00:00.000000Z\n`,
    Buffer.alloc(70, 7),
  ]);
  return v.id;
}

/** Yêu cầu mở thầu đã duyệt — C3 gắn `bafo_round_id` khi gói đang `BAFO_CLOSED`. */
async function yeuCauMoThau(rfqId: string): Promise<string> {
  const yeuCau = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
      [orgA, rfqId, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  const kep = (await db.pool.query<{ k: boolean }>("SELECT requires_dual_approval AS k FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.k;
  for (const n of kep ? [duyet, duyet2] : [duyet]) {
    await db.pool.query("INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [
      orgA,
      yeuCau,
      n.nguoi,
      n.phien,
    ]);
  }
  await db.pool.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yeuCau]);
  return yeuCau;
}

/** Giao dịch mở thầu: bản rõ, trạng thái, `EXECUTED` — cùng thứ tự worker thật. */
async function moThau(
  rfqId: string,
  yeuCau: string,
  banRo: readonly (readonly [string, unknown])[],
  trangThai: "UNSEALED" | "BAFO_UNSEALED",
): Promise<void> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    for (const [versionId, payload] of banRo) {
      await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
        orgA,
        yeuCau,
        versionId,
        JSON.stringify(payload),
      ]);
    }
    await c.query("UPDATE rfq_packages SET status = $2 WHERE id = $1", [rfqId, trangThai]);
    await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [yeuCau]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

async function dongGoi(rfqId: string): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de do', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, pm.nguoi, pm.phien],
  );
}

/** Phong bì như trình duyệt dựng (`nop-thau.js`): `totalAmount` mặc định là Σ `amount`. */
function phongBi(dong: readonly (readonly [number, string])[], tuy: { readonly tong?: string; readonly tienTe?: string } = {}): unknown {
  const tong = tuy.tong ?? dong.reduce((s, [, a]) => s + Number(a), 0).toFixed(2);
  return {
    totalAmount: tong,
    currency: tuy.tienTe ?? "VND",
    lines: dong.map(([lineNo, amount]) => ({ lineNo, unitPrice: "1", amount })),
  };
}

/** Gói đã mở niêm phong với các báo giá cho trước. */
async function goiDaMo(
  dong: readonly Dong[],
  baoGia: readonly unknown[],
  tienTeNganSach: "VND" | null = "VND",
): Promise<{ readonly rfqId: string; readonly bg: readonly BaoGia[]; readonly yeuCau: string }> {
  const rfqId = await taoGoi(dong, tienTeNganSach);
  const bg: BaoGia[] = [];
  for (let i = 0; i < baoGia.length; i += 1) bg.push(await nopBaoGia(rfqId));
  await dongGoi(rfqId);
  const yeuCau = await yeuCauMoThau(rfqId);
  await moThau(
    rfqId,
    yeuCau,
    bg.map((b, i) => [b.versionId, baoGia[i]] as const),
    "UNSEALED",
  );
  return { rfqId, bg, yeuCau };
}

async function anhXa(rfqId: string, lineNo: number, hangChuan: string | null, lyDo: string | null = null): Promise<void> {
  await trong(orgA, (c) =>
    c.query(
      "INSERT INTO rfq_item_mappings (org_id, rfq_id, line_no, nguon, canonical_item_id, phien_ban_bo_chuan_hoa, dau_vao, ly_do, tac_gia, session_id) " +
        "VALUES ($1, $2, $3, 'NGUOI_DUYET', $4, 1, '{}', $5, $6, $7)",
      [orgA, rfqId, lineNo, hangChuan, lyDo, ql.nguoi, ql.phien],
    ),
  );
}

/** Mọi quan sát của MỘT gói tại mốc (mặc định: `now()` của giao dịch đọc). */
async function quanSat(rfqId: string, moc: string | null = null, hangChuan: string | null = null, org = orgA): Promise<QuanSat[]> {
  return trong(org, async (c) => {
    const { rows } = await c.query<QuanSat>(
      "SELECT rfq_id, supplier_id, bid_version_id, line_no, ngay_quan_sat::text AS ngay_quan_sat, anh_xa_id, canonical_item_id, " +
        "thanh_tien::text AS thanh_tien, so_luong::text AS so_luong, don_vi, don_gia::text AS don_gia, don_vi_goc, he_so::text AS he_so, " +
        "don_gia_quy_doi::text AS don_gia_quy_doi, tien_te, trang_thai, hoi_to, sau_moc " +
        "FROM public.quan_sat_gia(coalesce($1::timestamptz, now()), $2::uuid) WHERE rfq_id = $3 ORDER BY supplier_id, line_no",
      [moc, hangChuan, rfqId],
    );
    return rows;
  });
}

async function daLo(rfqId: string, moc: string | null = null): Promise<boolean> {
  return trong(orgA, async (c) => {
    const { rows } = await c.query<{ v: boolean }>("SELECT public.gia_da_lo($1, $2, coalesce($3::timestamptz, now())) AS v", [orgA, rfqId, moc]);
    return rows[0]!.v;
  });
}

async function dongTho(payload: unknown): Promise<{ line_no: number | null; thanh_tien: string | null; ly_do: string | null }[]> {
  return trong(orgA, async (c) => {
    const { rows } = await c.query<{ line_no: number | null; thanh_tien: string | null; ly_do: string | null }>(
      "SELECT line_no, thanh_tien::text AS thanh_tien, ly_do FROM public.bid_dong_tho($1::jsonb) ORDER BY line_no NULLS LAST",
      [JSON.stringify(payload)],
    );
    return rows;
  });
}

const theoNcc = (ds: readonly QuanSat[], supplierId: string): QuanSat[] => ds.filter((q) => q.supplier_id === supplierId);

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'lsg-a'), ('Cong ty B', 'lsg-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  pm = await taoNguoi(orgA, ["PROCUREMENT_MANAGER"]);
  duyet = await taoNguoi(orgA, ["DIRECTOR"]);
  duyet2 = await taoNguoi(orgA, ["DIRECTOR"]);
  ql = await taoNguoi(orgA, ["DATA_STEWARD"]);
  chinhSachA = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, " +
        "created_by, created_by_session_id) VALUES ($1, 1, '100000000000.00', 'VND', $2::jsonb, 3, $3, $4) RETURNING id",
      [orgA, TP_GIA, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  const tao = async (ma: string, ten: string, donViGoc: string): Promise<string> =>
    (await trong(orgA, (c) => taoHangChuan(c, orgA, { ma, ten, donViGoc, actorSessionId: ql.phien }))).id;
  hangThep = await tao("THEP-D10", "Thép vằn D10", "kg");
  // Gốc là MÃ mơ hồ `t` (tấn): không bí danh chung nào trỏ nó — đúng ca mà lõi quy đổi theo mã (1) của `9501` sinh ra để đọc.
  hangCat = await tao("CAT-VANG", "Cát vàng", "t");
  hangCay = await tao("THEP-CAY", "Thép cây 11,7 m", "kg");
}, 300_000);

afterAll(async () => {
  await api.end();
  await db.stop();
});

// ================================================================================================================================
describe("[INV-L5] ⑴ bid_dong_tho — bộ đọc dòng", { timeout: 120_000 }, () => {
  it("phong bì của trình duyệt: mỗi dòng một hàng, lý do NULL, tiền là `amount`", async () => {
    expect(await dongTho(phongBi([[1, "100.00"], [2, "250.50"]]))).toEqual([
      { line_no: 1, thanh_tien: "100.00", ly_do: null },
      { line_no: 2, thanh_tien: "250.50", ly_do: null },
    ]);
  });

  // M1 của spec §2.5 ⒁: thân đang chạy của `bid_so_tien` là `022:350`, không phải *"bốn ca"* của chú thích cũ.
  const SAU_CA = ["1e131071", "10000000000000000", "1.001", "-1", "NaN", "Infinity"] as const;

  it.each(SAU_CA)("`amount` = %s ⇒ dòng ấy KHONG_DOC_DUOC, dòng anh em LECH_TONG", async (xau) => {
    expect(await dongTho({ totalAmount: "100.00", currency: "VND", lines: [{ lineNo: 1, amount: xau }, { lineNo: 2, amount: "100.00" }] })).toEqual([
      { line_no: 1, thanh_tien: null, ly_do: "KHONG_DOC_DUOC" },
      { line_no: 2, thanh_tien: "100.00", ly_do: "LECH_TONG" },
    ]);
  });

  it.each(SAU_CA)("`totalAmount` = %s ⇒ mọi dòng KHONG_DOC_DUOC", async (xau) => {
    const kq = await dongTho({ totalAmount: xau, currency: "VND", lines: [{ lineNo: 1, amount: "1.00" }, { lineNo: 2, amount: "2.00" }] });
    expect(kq.map((r) => r.ly_do)).toEqual(["KHONG_DOC_DUOC", "KHONG_DOC_DUOC"]);
  });

  it("chuỗi không phải số và `amount` là số JSON: một NULL, một đọc được", async () => {
    expect(await dongTho({ totalAmount: "3", lines: [{ lineNo: 1, amount: "abc" }, { lineNo: 2, amount: 3 }] })).toEqual([
      { line_no: 1, thanh_tien: null, ly_do: "KHONG_DOC_DUOC" },
      { line_no: 2, thanh_tien: "3", ly_do: "LECH_TONG" },
    ]);
  });

  it.each([
    ["đối tượng", { a: 1 }],
    ["chuỗi", "[]"],
    ["null", null],
    ["vắng", undefined],
  ])("`lines` là %s ⇒ đúng một hàng (NULL, NULL, KHONG_DOC_DUOC)", async (_ten, lines) => {
    expect(await dongTho({ totalAmount: "1.00", ...(lines === undefined ? {} : { lines }) })).toEqual([
      { line_no: null, thanh_tien: null, ly_do: "KHONG_DOC_DUOC" },
    ]);
  });

  it("hai phần tử cùng `lineNo` ⇒ MỘT hàng KHONG_DOC_DUOC cho số ấy, dòng khác LECH_TONG", async () => {
    expect(
      await dongTho({ totalAmount: "30.00", lines: [{ lineNo: 1, amount: "10.00" }, { lineNo: 1, amount: "10.00" }, { lineNo: 2, amount: "10.00" }] }),
    ).toEqual([
      { line_no: 1, thanh_tien: null, ly_do: "KHONG_DOC_DUOC" },
      { line_no: 2, thanh_tien: "10.00", ly_do: "LECH_TONG" },
    ]);
  });

  it.each([["chuỗi", "1"], ["0", 0], ["âm", -1], ["lẻ", 1.5], ["mũ", 1e10], ["null", null]])(
    "`lineNo` %s ⇒ phần tử gộp vào hàng `line_no` NULL",
    async (_ten, lineNo) => {
      const kq = await dongTho({ totalAmount: "3.00", lines: [{ lineNo, amount: "1.00" }, { lineNo: 2, amount: "2.00" }] });
      expect(kq).toEqual([
        { line_no: 2, thanh_tien: "2.00", ly_do: "LECH_TONG" },
        { line_no: null, thanh_tien: "1.00", ly_do: "KHONG_DOC_DUOC" },
      ]);
    },
  );

  it("phần tử không phải đối tượng ⇒ hàng `line_no` NULL", async () => {
    expect(await dongTho({ totalAmount: "2.00", lines: [5, { lineNo: 2, amount: "2.00" }] })).toEqual([
      { line_no: 2, thanh_tien: "2.00", ly_do: "LECH_TONG" },
      { line_no: null, thanh_tien: null, ly_do: "KHONG_DOC_DUOC" },
    ]);
  });

  it("phép so tổng CHÍNH XÁC: lệch một xu ⇒ mọi dòng LECH_TONG; `30` và `30.00` là một số", async () => {
    expect((await dongTho({ totalAmount: "30.01", lines: [{ lineNo: 1, amount: "10.00" }, { lineNo: 2, amount: "20.00" }] })).map((r) => r.ly_do)).toEqual([
      "LECH_TONG",
      "LECH_TONG",
    ]);
    expect((await dongTho({ totalAmount: "30", lines: [{ lineNo: 1, amount: "10.00" }, { lineNo: 2, amount: "20.00" }] })).map((r) => r.ly_do)).toEqual([
      null,
      null,
    ]);
  });

  it("`unitPrice` không được đọc: đơn giá khai thấp mà `amount` khớp tổng vẫn cho đúng `amount`", async () => {
    expect(await dongTho({ totalAmount: "900.00", lines: [{ lineNo: 1, unitPrice: "0.01", amount: "900.00" }] })).toEqual([
      { line_no: 1, thanh_tien: "900.00", ly_do: null },
    ]);
  });

  it("không bao giờ ném: phong bì lạ, rỗng, `{ raw }` của worker", async () => {
    for (const p of [null, 5, "x", [], {}, { raw: "rac" }, { lines: [[[[1]]]] }, { lines: [{ lineNo: 1, amount: { a: 1 } }] }]) {
      await expect(dongTho(p)).resolves.toBeDefined();
    }
    expect(await dongTho({ lines: [], totalAmount: "0" }), "mảng rỗng: không dòng nào").toEqual([]);
  });
});

// ================================================================================================================================
describe("[INV-L5] ⑵ ⑶ gia_da_lo và quan_sat_gia — vị thế cuối, trạng thái, quy đổi", { timeout: 300_000 }, () => {
  it("gói đã mở: đơn giá = amount / quantity, quy đổi về gốc, ngày quan sát là mốc mở giá", async () => {
    const { rfqId, bg } = await goiDaMo(
      [
        { moTa: "Thép D10", soLuong: "2.5000", donVi: "tấn" },
        { moTa: "Cát vàng", soLuong: "4.0000", donVi: "tấn" },
      ],
      [phongBi([[1, "50000000.00"], [2, "1200000.00"]]), phongBi([[1, "52500000.00"], [2, "1000000.00"]], { tienTe: "VNĐ" })],
    );
    await anhXa(rfqId, 1, hangThep, "anh xa sau mo gia de do");
    await anhXa(rfqId, 2, hangCat, "anh xa sau mo gia de do");
    expect(await daLo(rfqId)).toBe(true);
    const ds = await quanSat(rfqId);
    expect(ds).toHaveLength(4);
    const moc = (await db.pool.query<{ t: string }>("SELECT min(unsealed_at)::text AS t FROM rfq_unsealed_bids WHERE bid_version_id = ANY($1)", [bg.map((b) => b.versionId)])).rows[0]!.t;
    for (const q of ds) {
      expect(q.ngay_quan_sat).toBe(moc);
      expect(q.trang_thai).toBe("HOP_LE");
      expect(q.tien_te, "`VNĐ` đi qua bid_currency").toBe("VND");
    }
    const a = theoNcc(ds, bg[0]!.supplierId);
    const so = (v: string | null): number | null => (v === null ? null : Number(v));
    expect(a.map((q) => [q.line_no, so(q.don_gia), q.don_vi_goc, so(q.he_so), so(q.don_gia_quy_doi)])).toEqual([
      // 50 triệu / 2,5 tấn = 20 triệu một tấn = 20 000 một kg.
      [1, 20000000, "kg", 1000, 20000],
      // Gốc là MÃ `t`: `tấn` giải ra `t`, cùng mã — hệ số 1 CÓ NGUỒN. Bản `quy_doi_don_vi(…, 'tấn', 't')` ra KHONG_QUY_DOI_DUOC.
      [2, 300000, "t", 1, 300000],
    ]);
  });

  it("quy_doi_don_vi giữ nguyên hành vi, lõi theo mã đọc được gốc `t`", async () => {
    const { rows } = await db.pool.query<{ a: string; b: string }>(
      "SELECT (SELECT ma FROM quy_doi_don_vi($1, $2, 'tấn', 't', now())) AS a, (SELECT ma FROM quy_doi_da_giai($1, $2, 't', 't', 't', 't', now())) AS b",
      [orgA, hangCat],
    );
    expect(rows[0]).toEqual({ a: "KHONG_QUY_DOI_DUOC", b: "CUNG_DON_VI" });
  });

  it("gói chưa mở niêm phong: không lộ, không quan sát", async () => {
    const rfqId = await taoGoi([{ moTa: "Thép D10", soLuong: "1.0000", donVi: "kg" }]);
    await nopBaoGia(rfqId);
    await dongGoi(rfqId);
    await anhXa(rfqId, 1, hangThep);
    expect(await daLo(rfqId)).toBe(false);
    expect(await quanSat(rfqId)).toEqual([]);
  });

  it("sáu trạng thái, đúng thứ tự ưu tiên; `anh_xa_id` phân biệt chưa ánh xạ với ánh xạ tường minh sang NULL", async () => {
    const dong: Dong[] = [
      { moTa: "Thép D10", soLuong: "10.0000", donVi: "kg" },
      { moTa: "Thép cây", soLuong: "10.0000", donVi: "cây" },
      { moTa: "Vật tư lạ", soLuong: "1.0000", donVi: "kg" },
      { moTa: "Chưa ánh xạ", soLuong: "1.0000", donVi: "kg" },
    ];
    const { rfqId, bg } = await goiDaMo(dong, [
      phongBi([[1, "100.00"], [2, "200.00"], [3, "30.00"], [4, "40.00"]]),
      phongBi([[1, "100.00"], [2, "200.00"], [3, "30.00"], [4, "40.00"]], { tong: "999.00" }),
      phongBi([[1, "100.00"], [2, "200.00"], [3, "30.00"], [4, "40.00"]], { tienTe: "USD" }),
      phongBi([[1, "100.00"], [2, "200.00"], [3, "30.00"]]),
      phongBi([[1, "100.00"], [2, "200.00"], [3, "30.00"], [4, "40.00"], [9, "1.00"]]),
    ]);
    await anhXa(rfqId, 1, hangThep, "do");
    await anhXa(rfqId, 2, hangCay, "do");
    await anhXa(rfqId, 3, null, "khong co hang chuan tuong ung");
    const ds = await quanSat(rfqId);
    const tt = (i: number): string[] => theoNcc(ds, bg[i]!.supplierId).map((q) => q.trang_thai);
    // `cây` sang kg cần quy đổi riêng — chưa khai ⇒ KHONG_QUY_DOI_DUOC.
    expect(tt(0)).toEqual(["HOP_LE", "KHONG_QUY_DOI_DUOC", "CHUA_ANH_XA", "CHUA_ANH_XA"]);
    expect(tt(1), "tổng lệch đứng TRƯỚC tiền tệ, ánh xạ, quy đổi").toEqual(["LECH_TONG", "LECH_TONG", "LECH_TONG", "LECH_TONG"]);
    expect(tt(2), "tiền tệ khác chính sách của CHÍNH gói").toEqual(["LECH_TIEN_TE", "LECH_TIEN_TE", "LECH_TIEN_TE", "LECH_TIEN_TE"]);
    expect(tt(3), "dòng bỏ trống là KHONG_DOC_DUOC; dòng có mặt mà tổng khớp vẫn đọc được").toEqual([
      "HOP_LE",
      "KHONG_QUY_DOI_DUOC",
      "CHUA_ANH_XA",
      "KHONG_DOC_DUOC",
    ]);
    expect(tt(4), "một `lineNo` ngoài gói ⇒ cả báo giá KHONG_DOC_DUOC").toEqual([
      "KHONG_DOC_DUOC",
      "KHONG_DOC_DUOC",
      "KHONG_DOC_DUOC",
      "KHONG_DOC_DUOC",
    ]);
    const a = theoNcc(ds, bg[0]!.supplierId);
    expect(a[2]!.anh_xa_id, "ánh xạ tường minh sang NULL có hàng").not.toBeNull();
    expect(a[3]!.anh_xa_id, "chưa ánh xạ thì không").toBeNull();
    for (const q of ds) {
      if (q.trang_thai !== "HOP_LE") expect(q.don_gia_quy_doi, `${q.trang_thai} không có đơn giá đã quy đổi`).toBeNull();
    }
    // Khai quy đổi riêng cho hàng `THEP-CAY` ⇒ dòng 2 thành HOP_LE (đọc tại `now()`).
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: hangCay, tuDonVi: "cây", sangDonVi: "kg", heSo: "7.22", actorSessionId: ql.phien }));
    const sau = theoNcc(await quanSat(rfqId), bg[0]!.supplierId);
    expect([sau[1]!.trang_thai, Number(sau[1]!.he_so), sau[1]!.don_gia_quy_doi]).toEqual(["HOP_LE", 7.22, expect.stringMatching(/^2\.770083/u)]);
  });

  it("tiền tệ của gói KHÔNG có ngân sách: đọc phiên bản chính sách hiệu lực lúc gói ra đời (nhánh ⑵ của `rfq_che_do_nghiem`)", async () => {
    const { rfqId } = await goiDaMo([{ moTa: "Thép D10", soLuong: "1.0000", donVi: "kg" }], [phongBi([[1, "5.00"]]), phongBi([[1, "5.00"]], { tienTe: "USD" })], null);
    await anhXa(rfqId, 1, hangThep, "do");
    expect((await quanSat(rfqId)).map((q) => q.trang_thai).sort()).toEqual(["HOP_LE", "LECH_TIEN_TE"]);
  });

  it("phiên khách và tổ chức khác: 0 hàng (policy áp theo NGƯỜI GỌI)", async () => {
    const { rfqId } = await goiDaMo([{ moTa: "Thép D10", soLuong: "1.0000", donVi: "kg" }], [phongBi([[1, "5.00"]])]);
    await anhXa(rfqId, 1, hangThep, "do");
    expect(await quanSat(rfqId)).toHaveLength(1);
    expect(await quanSat(rfqId, null, null, orgB)).toEqual([]);
    const khach = await trong(orgA, async (c) => {
      await c.query("SELECT set_config('app.guest_session_id', $1, true)", [randomUUID()]);
      return (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM public.quan_sat_gia(now()) WHERE rfq_id = $1", [rfqId])).rows[0]!.n;
    });
    expect(khach).toBe(0);
  });
});

// ================================================================================================================================
describe("[INV-L5] ⑵ vòng BAFO, huỷ, và `status` không được đọc", { timeout: 300_000 }, () => {
  it("BAFO_OPEN và BAFO_CLOSED: không lộ; BAFO_UNSEALED: vị thế cuối là bản BAFO của người nộp lại, bản vòng một của người không", async () => {
    const dong: Dong[] = [{ moTa: "Thép D10", soLuong: "10.0000", donVi: "kg" }];
    const { rfqId, bg } = await goiDaMo(dong, [phongBi([[1, "1000.00"]]), phongBi([[1, "1100.00"]]), phongBi([[1, "1200.00"]])]);
    await anhXa(rfqId, 1, hangThep, "do");
    const vongMot = await quanSat(rfqId);
    expect(vongMot.map((q) => q.thanh_tien).sort()).toEqual(["1000.00", "1100.00", "1200.00"]);

    // Lượt chấm (khuôn `luotTrong` của danh-gia), rồi EVALUATING — `gia_da_lo` không đọc `status`.
    const evalId = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) VALUES ($1, $2, $3, 'VND', $4, $5) RETURNING id",
        [orgA, rfqId, chinhSachA, pm.nguoi, pm.phien],
      )
    ).rows[0]!.id;
    for (const [i, b] of bg.entries()) {
      const tien = ["1000.00", "1100.00", "1200.00"][i]!;
      await db.pool.query(
        "INSERT INTO rfq_evaluation_lines (org_id, evaluation_id, bid_version_id, effective_cost, components, rank) VALUES ($1, $2, $3, $4, $5, $6)",
        [orgA, evalId, b.versionId, tien, JSON.stringify([{ ma: "gia", tien }]), i + 1],
      );
    }
    await db.pool.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
    expect(await daLo(rfqId), "EVALUATING — không đọc status").toBe(true);
    const truocBafo = await gio();

    const vong = await trong(orgA, async (c) => {
      const id = (
        await c.query<{ id: string }>(
          "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id) " +
            "VALUES ($1, $2, $3, $4, 3, $5, $6, $7) RETURNING id",
          [orgA, rfqId, evalId, chinhSachA, MAI_SAU, pm.nguoi, pm.phien],
        )
      ).rows[0]!.id;
      await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfqId]);
      return id;
    });
    expect(await daLo(rfqId), "BAFO_OPEN").toBe(false);
    expect(await quanSat(rfqId)).toEqual([]);
    expect(await daLo(rfqId, truocBafo), "tại mốc TRƯỚC khi vòng mở: giá vòng một là vị thế cuối lúc ấy").toBe(true);
    expect((await quanSat(rfqId, truocBafo)).map((q) => q.thanh_tien).sort()).toEqual(["1000.00", "1100.00", "1200.00"]);

    // Người thứ HAI nộp lại (giá hạ); người thứ nhất và thứ ba không.
    const lai = await trong(orgA, (c) => chenPhienBan(c, rfqId, bg[1]!.bidId, bg[1]!.phienKhach));
    await trong(orgA, async (c) => {
      await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vong]);
      await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfqId]);
    });
    expect(await daLo(rfqId), "BAFO_CLOSED: phong bì vòng hai chưa vào rfq_unsealed_bids").toBe(false);
    expect(await quanSat(rfqId)).toEqual([]);

    const ycBafo = await yeuCauMoThau(rfqId);
    await moThau(rfqId, ycBafo, [[lai, phongBi([[1, "900.00"]])]], "BAFO_UNSEALED");
    expect(await daLo(rfqId)).toBe(true);
    const cuoi = await quanSat(rfqId);
    expect(cuoi).toHaveLength(3);
    expect(theoNcc(cuoi, bg[1]!.supplierId).map((q) => [q.bid_version_id, q.thanh_tien])).toEqual([[lai, "900.00"]]);
    expect(theoNcc(cuoi, bg[0]!.supplierId).map((q) => q.thanh_tien)).toEqual(["1000.00"]);
    expect(new Set(cuoi.map((q) => q.ngay_quan_sat)).size, "ngày quan sát là mốc mở giá VÒNG MỘT").toBe(1);
    // Tái lập: đọc lại tại mốc TRƯỚC vòng BAFO, SAU khi vòng ấy đã mở niêm phong, vẫn ra đúng giá vòng một.
    expect((await quanSat(rfqId, truocBafo)).map((q) => q.thanh_tien).sort(), "bản rõ vòng hai ghi SAU mốc").toEqual([
      "1000.00",
      "1100.00",
      "1200.00",
    ]);
  });

  it("huỷ sau khi mở: không lộ từ lúc huỷ, vẫn lộ tại mốc trước lúc huỷ", async () => {
    const { rfqId } = await goiDaMo([{ moTa: "Thép D10", soLuong: "1.0000", donVi: "kg" }], [phongBi([[1, "5.00"]])]);
    await anhXa(rfqId, 1, hangThep, "do");
    const truocHuy = await gio();
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'nghi thong dong', cancelled_by = $2, cancelled_by_session_id = $3 WHERE id = $1",
      [rfqId, pm.nguoi, pm.phien],
    );
    expect(await daLo(rfqId)).toBe(false);
    expect(await quanSat(rfqId)).toEqual([]);
    expect(await daLo(rfqId, truocHuy)).toBe(true);
    expect(await quanSat(rfqId, truocHuy)).toHaveLength(1);
  });

  it("vị thế cuối theo NHÀ CUNG CẤP: thu hồi lời mời rồi mời lại — hai báo giá đã mở, MỘT quan sát (lần nộp muộn nhất)", async () => {
    const rfqId = await taoGoi([{ moTa: "Thép D10", soLuong: "1.0000", donVi: "kg" }]);
    await anhXa(rfqId, 1, hangThep);
    const dau = await nopBaoGia(rfqId);
    await db.pool.query("UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 WHERE id = $1", [
      dau.loiMoi,
      pm.nguoi,
      pm.phien,
    ]);
    const lai = await nopBaoGia(rfqId, { supplierId: dau.supplierId, lienHe: dau.lienHe });
    const khac = await nopBaoGia(rfqId);
    await dongGoi(rfqId);
    await moThau(
      rfqId,
      await yeuCauMoThau(rfqId),
      [
        [dau.versionId, phongBi([[1, "1.00"]])],
        [lai.versionId, phongBi([[1, "2.00"]])],
        [khac.versionId, phongBi([[1, "10.00"]])],
      ],
      "UNSEALED",
    );
    const ds = await quanSat(rfqId);
    expect(ds.map((q) => [q.supplier_id, q.bid_version_id, q.thanh_tien]).sort(), "một hàng mỗi nhà cung cấp").toEqual(
      [
        [dau.supplierId, lai.versionId, "2.00"],
        [khac.supplierId, khac.versionId, "10.00"],
      ].sort(),
    );
  });

  it("gói X không thấy giá CHÍNH nó: mốc bằng mốc mở giá của gói ⇒ 0 hàng", async () => {
    const { rfqId, bg } = await goiDaMo([{ moTa: "Thép D10", soLuong: "1.0000", donVi: "kg" }], [phongBi([[1, "5.00"]])]);
    await anhXa(rfqId, 1, hangThep, "do");
    const moc = (await db.pool.query<{ t: string }>("SELECT unsealed_at::text AS t FROM rfq_unsealed_bids WHERE bid_version_id = $1", [bg[0]!.versionId])).rows[0]!.t;
    expect(await quanSat(rfqId, moc)).toEqual([]);
  });
});

// ================================================================================================================================
describe("[INV-L5] ⑶ hàng nền TẠI MỐC và hai nhãn HOI_TO / SAU_MOC", { timeout: 300_000 }, () => {
  it("ánh xạ trước mốc mở giá: không nhãn; ánh xạ lại sau `p_moc`: lần đọc tại mốc dùng bản cũ và đếm SAU_MOC", async () => {
    const rfqId = await taoGoi([{ moTa: "Thép D10", soLuong: "10.0000", donVi: "kg" }]);
    await anhXa(rfqId, 1, hangThep);
    const b = await nopBaoGia(rfqId);
    await dongGoi(rfqId);
    await moThau(rfqId, await yeuCauMoThau(rfqId), [[b.versionId, phongBi([[1, "100.00"]])]], "UNSEALED");
    const moc = await gio();
    const truoc = await quanSat(rfqId, moc);
    expect(truoc.map((q) => [q.canonical_item_id, q.hoi_to, q.sau_moc])).toEqual([[hangThep, [], {}]]);

    await anhXa(rfqId, 1, hangCay, "sua anh xa sau khi thay gia");
    const tai = await quanSat(rfqId, moc);
    expect(tai.map((q) => [q.canonical_item_id, q.hoi_to, q.sau_moc]), "bản tại mốc KHÔNG đổi").toEqual([[hangThep, [], { ANH_XA: 1 }]]);
    const nay = await quanSat(rfqId);
    expect(nay.map((q) => [q.canonical_item_id, q.hoi_to, q.sau_moc]), "đọc bây giờ: ánh xạ mới, ghi SAU mốc của chính gói").toEqual([
      [hangCay, ["ANH_XA"], {}],
    ]);
  });

  it("bí danh đơn vị, quy đổi riêng, phiên bản hàng chuẩn ghi sau `p_moc`: lần đọc tại mốc bỏ qua và đếm SAU_MOC; đọc bây giờ mang HOI_TO", async () => {
    const hangMoi = (
      await trong(orgA, (c) =>
        taoHangChuan(c, orgA, { ma: `THEP-BO-${randomBytes(2).toString("hex").toUpperCase()}`, ten: "Thép bó", donViGoc: "kg", actorSessionId: ql.phien }),
      )
    ).id;
    const rfqId = await taoGoi([
      { moTa: "Thép bó", soLuong: "2.0000", donVi: "bó" },
      { moTa: "Thép tấn", soLuong: "2.0000", donVi: "tấn" },
    ]);
    await anhXa(rfqId, 1, hangMoi);
    await anhXa(rfqId, 2, hangMoi);
    const b = await nopBaoGia(rfqId);
    await dongGoi(rfqId);
    await moThau(rfqId, await yeuCauMoThau(rfqId), [[b.versionId, phongBi([[1, "144.40"], [2, "40000.00"]])]], "UNSEALED");
    const moc = await gio();
    // Ba lần ghi SAU khi giá lộ: một cạnh riêng, một bí danh của tổ chức ĐÈ bí danh chung (`tấn` → `kg`: thước lệch 1000 lần —
    // cách chỉnh thứ hai của §3.3), một phiên bản mới.
    await trong(orgA, async (c) => {
      await khaiQuyDoiRieng(c, orgA, { hangChuanId: hangMoi, tuDonVi: "bó", sangDonVi: "kg", heSo: "72.2", actorSessionId: ql.phien });
      await khaiBiDanhDonVi(c, orgA, { biDanh: "tấn", donVi: "kg", actorSessionId: ql.phien });
      await taoPhienBanHangChuan(c, orgA, { hangChuanId: hangMoi, ten: "Thép bó (sửa)", actorSessionId: ql.phien });
    });
    const gon = (ds: readonly QuanSat[]): unknown[] =>
      ds.map((q) => [q.line_no, q.trang_thai, q.he_so === null ? null : Number(q.he_so), q.hoi_to, q.sau_moc]);
    expect(gon(await quanSat(rfqId, moc)), "tại mốc: y như trước ba lần ghi").toEqual([
      [1, "KHONG_QUY_DOI_DUOC", null, [], { QUY_DOI: 1, PHIEN_BAN_HANG_CHUAN: 1 }],
      [2, "HOP_LE", 1000, [], { BI_DANH_DON_VI: 1, PHIEN_BAN_HANG_CHUAN: 1 }],
    ]);
    expect(gon(await quanSat(rfqId)), "bây giờ: đọc hàng mới, và nhãn nói chúng ghi sau khi giá của chính gói đã lộ").toEqual([
      [1, "HOP_LE", 72.2, ["QUY_DOI", "PHIEN_BAN_HANG_CHUAN"], {}],
      [2, "HOP_LE", 1, ["BI_DANH_DON_VI", "PHIEN_BAN_HANG_CHUAN"], {}],
    ]);
  });

  it("ánh xạ chỉ hiệu lực khi băm đã lưu bằng băm HIỆN TẠI của dòng (khuôn C-1, `089`)", async () => {
    const rfqId = await taoGoi([{ moTa: "Thép D10 sẽ sửa", soLuong: "1.0000", donVi: "kg" }]);
    await anhXa(rfqId, 1, hangThep);
    // Cảnh *"gói về DRAFT, dòng được sửa, nộp lại"* dựng thẳng dưới vai chủ cụm — khuôn ca băm của `anh-xa.int.test.ts`.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE rfq_items DISABLE TRIGGER USER");
      await c.query("UPDATE rfq_items SET description = 'Thép D32 đã sửa' WHERE rfq_id = $1", [rfqId]);
      await c.query("ALTER TABLE rfq_items ENABLE TRIGGER USER");
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    const b = await nopBaoGia(rfqId);
    await dongGoi(rfqId);
    await moThau(rfqId, await yeuCauMoThau(rfqId), [[b.versionId, phongBi([[1, "5.00"]])]], "UNSEALED");
    expect((await quanSat(rfqId)).map((q) => [q.trang_thai, q.anh_xa_id])).toEqual([["CHUA_ANH_XA", null]]);
  });

  it("nhánh lọc theo hàng chuẩn trùng khít nhánh đọc hết, ở cả mốc cũ lẫn bây giờ", async () => {
    const moc = await gio();
    for (const m of [moc, null]) {
      const tatCa = await trong(orgA, async (c) =>
        (await c.query<{ k: string }>("SELECT row_to_json(q)::text AS k FROM public.quan_sat_gia(coalesce($1::timestamptz, now())) q", [m])).rows,
      );
      for (const hang of [hangThep, hangCat, hangCay, randomUUID()]) {
        const loc = await trong(orgA, async (c) =>
          (await c.query<{ k: string }>("SELECT row_to_json(q)::text AS k FROM public.quan_sat_gia(coalesce($1::timestamptz, now()), $2) q", [m, hang])).rows,
        );
        const ky = (s: string): string => (JSON.parse(s) as { canonical_item_id: string | null }).canonical_item_id ?? "";
        expect(loc.map((r) => r.k).sort(), `hàng ${hang} tại ${m ?? "now()"}`).toEqual(tatCa.filter((r) => ky(r.k) === hang).map((r) => r.k).sort());
      }
      expect(tatCa.length, "tập đọc hết không rỗng — phép so trên có việc").toBeGreaterThan(10);
    }
  });
});

// ================================================================================================================================
describe("[INV-L5] ranh giới ở tầng CSDL", { timeout: 120_000 }, () => {
  it("hàm có thân chạm `rfq_unsealed_bids` trên cụm thật — mọi schema, cả thân `BEGIN ATOMIC` — đúng bằng danh sách của lớp tĩnh", async () => {
    const { rows } = await db.pool.query<{ ten: string }>(
      "SELECT n.nspname || '.' || p.proname AS ten FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
        "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' " +
        "AND p.prokind IN ('f', 'p') AND pg_get_functiondef(p.oid) ~ 'rfq_unsealed_bids' ORDER BY 1",
    );
    expect(rows.map((r) => r.ten)).toEqual(["public.anh_xa_kiem_luat", "public.goi_y_kiem_luat", "public.quan_sat_gia"]);
  });

  it("không view hay materialized view nào đọc bảng bản rõ, và `quan_sat_gia` chạy dưới quyền NGƯỜI GỌI", async () => {
    const { rows } = await db.pool.query<{ n: number; secdef: boolean }>(
      "SELECT (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
        "AND pg_get_viewdef(c.oid) ~ 'rfq_unsealed_bids') AS n, " +
        "(SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.quan_sat_gia(timestamptz, uuid)')) AS secdef",
    );
    expect(rows[0]).toEqual({ n: 0, secdef: false });
  });
});
