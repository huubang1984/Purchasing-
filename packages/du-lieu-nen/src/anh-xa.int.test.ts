// [S1.9101 / S4.3a] Ánh xạ hạng mục sang hàng chuẩn — trên Postgres thật (spec S4 §4.4; §5.1 L1 · L2 · L3 · L13; §2.5 ⒁ ⒂).
//
//   ⑴ L2 — `TU_DONG` tồn tại khi và chỉ khi chuỗi đã làm sạch trùng một bí danh còn hiệu lực của đúng hàng chuẩn; lượt chuẩn
//      hoá ghi `TU_DONG` cho mọi dòng khớp bí danh; mọi hàng `TU_DONG` trong CSDL tái lập được từ dữ liệu đã lưu;
//   ⑵ L3 vế hành vi — người ghi `NGUOI_DUYET` giữ `item.manage` và nằm ngoài TRỌN tập loại trừ của gói, từng vế một; chuẩn hoá
//      hồi tố trên gói đã có bản rõ chỉ do người giữ `item.manage`;
//   ⑶ L13 — gói đã có bản rõ thì ánh xạ đòi lý do, `TU_DONG` mang `CHUAN_HOA_HOI_TO`; đo cả hai chiều của cuộc đua với giao
//      dịch mở thầu;
//   ⑷ §2.5 ⒁ — bác một dòng đã từng có gợi ý `GOI_Y` đòi lý do;
//   ⑸ hàng đợi, thao tác duyệt/bác/tạo hàng chuẩn, hàng đợi *học*, băm của dòng;
//   ⑹ khuôn nền L1 của hai bảng mới.
//
// Gói nền dữ liệu không với tới đường mở thầu (`g19-`), kể cả trong test: gói đã mở niêm phong được dựng bằng SQL thô dưới vai
// chủ cụm, theo đúng thứ tự các cạnh mà đường thật đi (khuôn fixture của `luot-danh-gia.int.test.ts`) — mọi trigger ENABLE
// ALWAYS vẫn chạy.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAuditEvent } from "@trustprocure/audit";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  DuLieuNenError,
  LY_DO_CHUAN_HOA_HOI_TO,
  chuanHoaGoi,
  docAnhXaGoi,
  docHangDoi,
  ghiAnhXa,
  khaiBiDanhHang,
  rutBiDanhHang,
  taoHangChuan,
  taoHangChuanVaAnhXa,
} from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const GOC = fileURLToPath(new URL("../../../", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);

interface Nguoi {
  readonly nguoi: string;
  readonly phien: string;
}

let db: TestDatabase;
let api: pg.Pool;
let orgA = "";
let orgB = "";
let pm: Nguoi;
let duyet: Nguoi;
let ql: Nguoi;
let qlB: Nguoi;
let chinhSachA = "";
let hangD10 = "";
let hangD12 = "";
let hangXiMang = "";

async function taoNguoi(orgId: string, vai: readonly string[], hoTen = "Nguoi"): Promise<Nguoi> {
  const nguoi = (
    await db.pool.query<{ id: string }>("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id", [
      orgId,
      `${randomBytes(5).toString("hex")}@vidu.vn`,
      hoTen,
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

/** Người ĐÃ làm một việc trên gói với vai cũ, NAY là người quản lý dữ liệu — `033` không cho giữ cả hai cùng lúc. */
async function thanhQuanLy(orgId: string, n: Nguoi): Promise<void> {
  await db.pool.query("DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2", [orgId, n.nguoi]);
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'DATA_STEWARD')", [orgId, n.nguoi]);
}

const trong = <T>(orgId: string, viec: (c: pg.PoolClient) => Promise<T>): Promise<T> => withTenant(api, orgId, viec);

async function maLoi(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DuLieuNenError) return e.ma;
    const loi = e as { constraint?: string; code?: string };
    return loi.constraint ?? loi.code ?? "KHONG_MA";
  }
  return "KHONG_NEM";
}

async function taoGoi(orgId: string, tao: Nguoi, dong: readonly string[]): Promise<string> {
  const rfqId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Mua vat tu', $2, false, $3, $4) RETURNING id",
      [orgId, MAI_SAU, tao.nguoi, tao.phien],
    )
  ).rows[0]!.id;
  for (const [i, moTa] of dong.entries()) {
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, $3, $4, '10.0000', 'kg', $5, $6)",
      [orgId, rfqId, i + 1, moTa, tao.nguoi, tao.phien],
    );
  }
  return rfqId;
}

async function nopDuyet(orgId: string, rfqId: string, nop: Nguoi): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, nop.nguoi, nop.phien],
  );
}

async function goiDaNop(dong: readonly string[], orgId = orgA, nguoi = pm): Promise<string> {
  const rfqId = await taoGoi(orgId, nguoi, dong);
  await datNganSach(orgId, rfqId, nguoi);
  await nopDuyet(orgId, rfqId, nguoi);
  return rfqId;
}

async function datNganSach(orgId: string, rfqId: string, n: Nguoi): Promise<void> {
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgId, rfqId, chinhSachA, n.nguoi, n.phien],
  );
}

/** Nhà cung cấp (do `ncc` tạo), người liên hệ (do `lienHe` tạo), lời mời (do `moi` gửi). */
async function moiNhaCungCap(
  orgId: string,
  rfqId: string,
  ai: { readonly ncc: Nguoi; readonly lienHe: Nguoi; readonly moi: Nguoi },
): Promise<{ readonly loiMoi: string; readonly lienHe: string }> {
  const supplierId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [orgId, `NCC ${randomBytes(3).toString("hex")}`, ai.ncc.nguoi, ai.ncc.phien],
    )
  ).rows[0]!.id;
  const contactId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
      [orgId, supplierId, `${randomBytes(4).toString("hex")}@ncc.vn`, ai.lienHe.nguoi, ai.lienHe.phien],
    )
  ).rows[0]!.id;
  const loiMoi = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
      [orgId, rfqId, supplierId, contactId, ai.moi.nguoi, ai.moi.phien],
    )
  ).rows[0]!.id;
  return { loiMoi, lienHe: contactId };
}

// ---- Gói đã mở niêm phong (SQL thô, đúng thứ tự cạnh của đường thật) -------------------------------------------------------
async function nopBaoGia(orgId: string, rfqId: string): Promise<string> {
  const { loiMoi, lienHe } = await moiNhaCungCap(orgId, rfqId, { ncc: pm, lienHe: pm, moi: pm });
  const token = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
        "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
      [orgId, loiMoi, randomBytes(32), pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  const thachThuc = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, " +
        "destination_hash, pepper_version, expires_at, consumed_at) " +
        "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
      [orgId, loiMoi, token, lienHe, randomBytes(32), randomBytes(32)],
    )
  ).rows[0]!.id;
  const phienKhach = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
        "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
      [orgId, loiMoi, thachThuc, randomBytes(32), lienHe],
    )
  ).rows[0]!.id;
  return trong(orgId, async (c) => {
    const bidId = (await c.query<{ id: string }>("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [orgId, loiMoi]))
      .rows[0]!.id;
    const versionId = (
      await c.query<{ id: string }>(
        "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [orgId, bidId, Buffer.alloc(64, 9), phienKhach],
      )
    ).rows[0]!.id;
    await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
      orgId,
      versionId,
      `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bidId}\n` +
        `version=1\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-30T00:00:00.000000Z\n`,
      Buffer.alloc(70, 7),
    ]);
    return versionId;
  });
}

/** Gói đã ĐÓNG, có một báo giá và một yêu cầu mở thầu đã duyệt — một bước trước giao dịch mở thầu. */
async function goiChoMoThau(dong: readonly string[]): Promise<{ readonly rfqId: string; readonly yeuCau: string; readonly version: string }> {
  const rfqId = await taoGoi(orgA, pm, dong);
  await datNganSach(orgA, rfqId, pm);
  await nopDuyet(orgA, rfqId, pm);
  await db.pool.query("INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)", [
    orgA,
    rfqId,
    duyet.nguoi,
    duyet.phien,
  ]);
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
  const version = await nopBaoGia(orgA, rfqId);
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de do', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, pm.nguoi, pm.phien],
  );
  const yeuCau = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
      [orgA, rfqId, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  await db.pool.query("INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [
    orgA,
    yeuCau,
    duyet.nguoi,
    duyet.phien,
  ]);
  await db.pool.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yeuCau]);
  return { rfqId, yeuCau, version };
}

/** Giao dịch mở thầu: bản rõ, rồi `UNSEALED`, rồi `EXECUTED` — cùng thứ tự worker thật (`apps/unseal-worker`). */
async function moThauTrong(c: pg.PoolClient, g: { readonly rfqId: string; readonly yeuCau: string; readonly version: string }): Promise<void> {
  await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
    orgA,
    g.yeuCau,
    g.version,
    JSON.stringify({ totalAmount: "1000", currency: "VND" }),
  ]);
  await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [g.rfqId]);
  await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [g.yeuCau]);
}

async function goiDaMo(dong: readonly string[]): Promise<string> {
  const g = await goiChoMoThau(dong);
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await moThauTrong(c, g);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  return g.rfqId;
}

async function chenThang(
  orgId: string,
  n: Nguoi,
  hang: { readonly rfqId: string; readonly lineNo: number; readonly nguon: string; readonly hangChuan: string | null; readonly lyDo?: string | null },
): Promise<void> {
  await trong(orgId, (c) =>
    c.query(
      "INSERT INTO rfq_item_mappings (org_id, rfq_id, line_no, nguon, canonical_item_id, phien_ban_bo_chuan_hoa, dau_vao, ly_do, tac_gia, session_id) " +
        "VALUES ($1, $2, $3, $4, $5, 1, '{}', $6, $7, $8)",
      [orgId, hang.rfqId, hang.lineNo, hang.nguon, hang.hangChuan, hang.lyDo ?? null, n.nguoi, n.phien],
    ),
  );
}

async function demHang(bang: "rfq_item_mappings" | "rfq_item_goi_y", rfqId: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${bang} WHERE rfq_id = $1`, [rfqId]);
  return rows[0]!.n;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'axa-a'), ('Cong ty B', 'axa-b') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  pm = await taoNguoi(orgA, ["PROCUREMENT_MANAGER"], "Tran Mua Hang");
  duyet = await taoNguoi(orgA, ["DIRECTOR"], "Le Giam Doc");
  ql = await taoNguoi(orgA, ["DATA_STEWARD"], "Nguyen Quan Ly");
  qlB = await taoNguoi(orgB, ["DATA_STEWARD"]);
  chinhSachA = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
        "VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
      [orgA, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  const tao = async (ma: string, ten: string, kichThuoc?: string): Promise<string> =>
    (
      await trong(orgA, (c) =>
        taoHangChuan(c, orgA, {
          ma,
          ten,
          donViGoc: "kg",
          ...(kichThuoc === undefined ? {} : { thuocTinh: { kich_thuoc: kichThuoc }, thuocTinhTrongYeu: ["kich_thuoc"] }),
          actorSessionId: ql.phien,
        }),
      )
    ).id;
  hangD10 = await tao("THEP-D10", "Thép vằn D10", "10");
  hangD12 = await tao("THEP-D12", "Thép vằn D12", "12");
  hangXiMang = await tao("XI-MANG-PCB40", "Xi măng PCB40");
  await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: hangD10, biDanh: "Thép D10 Hòa Phát", actorSessionId: ql.phien }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
});

describe("[INV-L2] TU_DONG tồn tại khi và chỉ khi mô tả đã làm sạch trùng một bí danh còn hiệu lực", () => {
  it("[INV-L2] lượt chuẩn hoá: dòng khớp bí danh → TU_DONG; dòng còn lại → gợi ý; sổ ghi một hàng cho cả lượt", async () => {
    const rfqId = await goiDaNop(["THÉP D10 – Hòa Phát", "Thép vằn D12", "Gạch thẻ đỏ"]);
    const k = await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien }));
    expect(k).toEqual({ phienBan: 1, tuDong: 1, goiY: 1, canDuyet: 1, daCo: 0, khongDoi: 0 });

    const trangThai = await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfqId));
    expect(trangThai).toEqual([
      { lineNo: 1, trangThai: "TU_DONG", hangChuan: { id: hangD10, ma: "THEP-D10" }, lyDo: null },
      { lineNo: 2, trangThai: "CHO_DUYET", hangChuan: null, lyDo: null },
      { lineNo: 3, trangThai: "CHO_DUYET", hangChuan: null, lyDo: null },
    ]);
    const { rows: goiY } = await db.pool.query<{ line_no: number; ket_qua: string; dau: string }>(
      "SELECT line_no, ket_qua, dau_vao->'ungVien'->0->>'ma' AS dau FROM rfq_item_goi_y WHERE rfq_id = $1 ORDER BY line_no",
      [rfqId],
    );
    expect(goiY).toEqual([
      { line_no: 2, ket_qua: "GOI_Y", dau: "THEP-D12" },
      { line_no: 3, ket_qua: "CAN_DUYET", dau: expect.any(String) },
    ]);
    const { rows: so } = await db.pool.query<{ action: string; payload: Record<string, unknown> }>(
      "SELECT action, payload FROM audit_events WHERE resource_id = $1 AND action = 'RFQ_ITEMS_NORMALIZED'",
      [rfqId],
    );
    expect(so).toEqual([{ action: "RFQ_ITEMS_NORMALIZED", payload: { phienBan: 1, tuDong: 1, goiY: 1, canDuyet: 1, daCo: 0, khongDoi: 0, hoiTo: false } }]);

    // Chạy lại: dòng đã ánh xạ không đụng, gợi ý y hệt không ghi thêm.
    const lai = await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien }));
    expect(lai).toMatchObject({ tuDong: 0, goiY: 0, canDuyet: 0, daCo: 1, khongDoi: 2 });
    expect(await demHang("rfq_item_mappings", rfqId)).toBe(1);
    expect(await demHang("rfq_item_goi_y", rfqId)).toBe(2);
  });

  it("[INV-L2] câu ghi thẳng: TU_DONG không bí danh, bí danh trỏ hàng khác, bí danh đã rút — ba lần bị từ chối; đúng bí danh thì qua", async () => {
    const rfqId = await goiDaNop(["Thép vằn D12", "Thép D10 Hòa Phát", "Thép rút bí danh"]);
    expect(await maLoi(chenThang(orgA, pm, { rfqId, lineNo: 1, nguon: "TU_DONG", hangChuan: hangD12 }))).toBe(
      "anh_xa_tu_dong_khong_khop_bi_danh",
    );
    expect(await maLoi(chenThang(orgA, pm, { rfqId, lineNo: 2, nguon: "TU_DONG", hangChuan: hangD12 }))).toBe(
      "anh_xa_tu_dong_khong_khop_bi_danh",
    );
    await trong(orgA, (c) => khaiBiDanhHang(c, orgA, { hangChuanId: hangD12, biDanh: "thep rut bi danh", actorSessionId: ql.phien }));
    await trong(orgA, (c) => rutBiDanhHang(c, orgA, { biDanh: "thep rut bi danh", actorSessionId: ql.phien }));
    expect(await maLoi(chenThang(orgA, pm, { rfqId, lineNo: 3, nguon: "TU_DONG", hangChuan: hangD12 }))).toBe(
      "anh_xa_tu_dong_khong_khop_bi_danh",
    );
    // Đối chứng dương: đúng bí danh, đúng hàng — người nộp duyệt ghi được (không cần item.manage trước khi có bản rõ).
    await chenThang(orgA, pm, { rfqId, lineNo: 2, nguon: "TU_DONG", hangChuan: hangD10 });
    expect(await demHang("rfq_item_mappings", rfqId)).toBe(1);
  });

  it("[INV-L2] mọi hàng TU_DONG trong CSDL tái lập được: chuoi_sach(mô tả) trùng bí danh mới nhất ghi TRƯỚC hàng ánh xạ, cùng hàng chuẩn", async () => {
    const { rows } = await db.pool.query<{ id: string; tai_lap: boolean }>(
      "SELECT m.id, (SELECT NOT a.rut AND a.canonical_item_id = m.canonical_item_id FROM item_aliases a " +
        " WHERE a.org_id = m.org_id AND a.bi_danh_sach = chuoi_sach(i.description) AND a.ghi_luc < m.ghi_luc " +
        " ORDER BY a.seq DESC LIMIT 1) IS TRUE AS tai_lap " +
        "FROM rfq_item_mappings m JOIN rfq_items i ON i.org_id = m.org_id AND i.rfq_id = m.rfq_id AND i.line_no = m.line_no " +
        "WHERE m.nguon = 'TU_DONG'",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.tai_lap)).toEqual([]);
  });

  it("[INV-L2] khai bí danh ở hàng đợi thì lượt sau đổi dòng khớp thành TU_DONG — hàng đợi học", async () => {
    const rfqId = await goiDaNop(["Xi măng Nghi Sơn PCB40 bao 50kg"]);
    await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien }));
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangXiMang, taoBiDanh: true, actorSessionId: ql.phien }));
    const rfq2 = await goiDaNop(["xi-măng NGHI SƠN pcb40 — bao 50KG"]);
    const k = await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId: rfq2, actorSessionId: pm.phien }));
    expect(k).toMatchObject({ tuDong: 1, goiY: 0, canDuyet: 0 });
    expect((await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfq2)))[0]).toMatchObject({ trangThai: "TU_DONG", hangChuan: { ma: "XI-MANG-PCB40" } });
  });
});

describe("[INV-L3] người ghi NGUOI_DUYET giữ item.manage và nằm ngoài TRỌN tập loại trừ của gói (ADR-082 ⑿)", () => {
  it("[INV-L3] người không giữ item.manage bị từ chối; người quản lý dữ liệu ngoài tập thì qua, và vào sổ", async () => {
    const rfqId = await goiDaNop(["Thép vằn D12"]);
    expect(await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: pm.phien })))).toBe(
      "CAN_ITEM_MANAGE",
    );
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien }));
    expect(await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfqId))).toEqual([
      { lineNo: 1, trangThai: "NGUOI_DUYET", hangChuan: { id: hangD12, ma: "THEP-D12" }, lyDo: null },
    ]);
    const { rows } = await db.pool.query<{ actor_id: string; payload: Record<string, unknown> }>(
      "SELECT actor_id, payload FROM audit_events WHERE resource_id = $1 AND action = 'RFQ_ITEM_MAPPED'",
      [rfqId],
    );
    expect(rows).toEqual([
      { actor_id: ql.nguoi, payload: { lineNo: 1, nguon: "NGUOI_DUYET", hangChuanId: hangD12, coLyDo: false, taoBiDanh: false, seq: expect.any(String) } },
    ]);
  });

  it("[INV-L3] chín vế của tập loại trừ, mỗi vế một người đã làm đúng một việc rồi thành người quản lý dữ liệu — cả chín bị từ chối", async () => {
    const ten = ["tao", "nop", "moi", "thuHoi", "nganSach", "ncc", "lienHe", "nopTruoc", "nganSachSau"] as const;
    const v: Record<(typeof ten)[number], Nguoi> = Object.fromEntries(
      await Promise.all(ten.map(async (t) => [t, await taoNguoi(orgA, ["PROCUREMENT_MANAGER"], t)] as const)),
    ) as Record<(typeof ten)[number], Nguoi>;
    const rfqId = await taoGoi(orgA, v.tao, ["Thép vằn D12"]);
    const { loiMoi } = await moiNhaCungCap(orgA, rfqId, { ncc: v.ncc, lienHe: v.lienHe, moi: v.moi });
    await db.pool.query(
      "UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 WHERE id = $1",
      [loiMoi, v.thuHoi.nguoi, v.thuHoi.phien],
    );
    await datNganSach(orgA, rfqId, v.nganSach);
    await nopDuyet(orgA, rfqId, v.nop);
    // Hai vế chỉ có trong sổ: lần nộp TRƯỚC (cột `submitted_by` giữ lần cuối) và lần đặt ngân sách SAU (cột giữ lần đầu).
    await trong(orgA, async (c) => {
      await appendAuditEvent(c, orgA, { actorType: "USER", actorId: v.nopTruoc.nguoi, action: "RFQ_SUBMITTED_FOR_APPROVAL", resourceType: "rfq_package", resourceId: rfqId });
      await appendAuditEvent(c, orgA, { actorType: "USER", actorId: v.nganSachSau.nguoi, action: "RFQ_BUDGET_SET", resourceType: "rfq_package", resourceId: rfqId });
    });

    const { rows } = await trong(orgA, (c) => c.query<{ n: string }>("SELECT rfq_tap_loai_tru($1, $2) AS n", [orgA, rfqId]));
    expect(rows.map((r) => r.n).sort()).toEqual(ten.map((t) => v[t].nguoi).sort());

    for (const t of ten) {
      await thanhQuanLy(orgA, v[t]);
      expect(
        await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: v[t].phien }))),
        `vế ${t}`,
      ).toBe("TRONG_TAP_LOAI_TRU");
    }
    expect(await demHang("rfq_item_mappings", rfqId)).toBe(0);
    // Đối chứng dương trên CHÍNH gói ấy.
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien }));
    expect(await demHang("rfq_item_mappings", rfqId)).toBe(1);
  });

  it("[INV-L3] hai vế đọc từ sổ ghim theo TÊN action — tầng gói `rfq` vẫn ghi đúng hai tên ấy, vào đúng loại tài nguyên", () => {
    const rfq = readFileSync(`${GOC}packages/rfq/src/rfq.ts`, "utf8");
    const nganSach = readFileSync(`${GOC}packages/rfq/src/procurement-policy.ts`, "utf8");
    const mig = readFileSync(`${MIGRATIONS}/9501_anh_xa_hang_muc.sql`, "utf8");
    expect(rfq).toMatch(/action: "RFQ_SUBMITTED_FOR_APPROVAL",\s+resourceType: "rfq_package",/u);
    expect(nganSach).toMatch(/action: "RFQ_BUDGET_SET",\s+resourceType: "rfq_package",/u);
    expect(mig).toContain("a.action IN ('RFQ_SUBMITTED_FOR_APPROVAL', 'RFQ_BUDGET_SET')");
    expect(mig).toContain("a.resource_type = 'rfq_package'");
  });

  it("[INV-L3] gói đã có bản rõ: lượt chuẩn hoá của người không giữ item.manage bị từ chối cả ở TU_DONG lẫn gợi ý; người quản lý thì qua với CHUAN_HOA_HOI_TO", async () => {
    const rfqId = await goiDaMo(["Thép D10 Hòa Phát", "Thép vằn D12"]);
    expect(await maLoi(trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien })))).toBe("HOI_TO_CAN_ITEM_MANAGE");
    expect(await maLoi(chenThang(orgA, pm, { rfqId, lineNo: 1, nguon: "TU_DONG", hangChuan: hangD10, lyDo: LY_DO_CHUAN_HOA_HOI_TO }))).toBe(
      "anh_xa_hoi_to_can_item_manage",
    );
    expect(
      await maLoi(
        trong(orgA, (c) =>
          c.query(
            "INSERT INTO rfq_item_goi_y (org_id, rfq_id, line_no, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, tac_gia, session_id) " +
              "VALUES ($1, $2, 2, 'GOI_Y', 0.9, 1, '{}', $3, $4)",
            [orgA, rfqId, pm.nguoi, pm.phien],
          ),
        ),
      ),
    ).toBe("anh_xa_hoi_to_can_item_manage");
    expect(await demHang("rfq_item_mappings", rfqId)).toBe(0);

    const k = await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: ql.phien }));
    expect(k).toMatchObject({ tuDong: 1, goiY: 1 });
    expect(await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfqId))).toEqual([
      { lineNo: 1, trangThai: "TU_DONG", hangChuan: { id: hangD10, ma: "THEP-D10" }, lyDo: LY_DO_CHUAN_HOA_HOI_TO },
      { lineNo: 2, trangThai: "CHO_DUYET", hangChuan: null, lyDo: null },
    ]);
  });
});

describe("[INV-L13] gói đã có bản rõ thì ánh xạ đòi lý do — khoá theo SỰ TỒN TẠI của hàng bản rõ", () => {
  it("[INV-L13] NGUOI_DUYET không lý do bị từ chối, có lý do thì qua; TU_DONG phải mang đúng mã CHUAN_HOA_HOI_TO", async () => {
    const rfqId = await goiDaMo(["Thép vằn D12", "Thép D10 Hòa Phát"]);
    expect(await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien })))).toBe("CAN_LY_DO");
    expect(await maLoi(chenThang(orgA, ql, { rfqId, lineNo: 2, nguon: "TU_DONG", hangChuan: hangD10 }))).toBe("anh_xa_hoi_to_sai_ma_ly_do");
    expect(await maLoi(chenThang(orgA, ql, { rfqId, lineNo: 2, nguon: "TU_DONG", hangChuan: hangD10, lyDo: "tu viet" }))).toBe(
      "anh_xa_hoi_to_sai_ma_ly_do",
    );
    await trong(orgA, (c) =>
      ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, lyDo: "anh xa hoi to khi khoi dong du lieu", actorSessionId: ql.phien }),
    );
    await chenThang(orgA, ql, { rfqId, lineNo: 2, nguon: "TU_DONG", hangChuan: hangD10, lyDo: LY_DO_CHUAN_HOA_HOI_TO });
    expect(await demHang("rfq_item_mappings", rfqId)).toBe(2);
  });

  it("[INV-L13] đua ⑴: ánh xạ ghi TRONG lúc giao dịch mở thầu đang chạy thì chờ nó commit, rồi thấy bản rõ và đòi lý do", async () => {
    const g = await goiChoMoThau(["Thép vằn D12"]);
    const mo = await db.pool.connect();
    try {
      await mo.query("BEGIN");
      await moThauTrong(mo, g);
      let xong = false;
      const ghi = maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId: g.rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien }))).finally(
        () => {
          xong = true;
        },
      );
      await new Promise((r) => setTimeout(r, 1500));
      expect(xong, "câu ghi ánh xạ phải CHỜ khoá hàng gói của giao dịch mở thầu").toBe(false);
      await mo.query("COMMIT");
      expect(await ghi).toBe("CAN_LY_DO");
    } finally {
      mo.release();
    }
    expect(await demHang("rfq_item_mappings", g.rfqId)).toBe(0);
  });

  it("[INV-L13] đua ⑵: giao dịch mở thầu gặp một ánh xạ chưa commit thì chờ nó — ánh xạ không lý do là hàng ghi TRƯỚC mọi bản rõ", async () => {
    const g = await goiChoMoThau(["Thép vằn D12"]);
    let tha: () => void = () => undefined;
    const cho = new Promise<void>((r) => {
      tha = r;
    });
    let daGhi: () => void = () => undefined;
    const ghiXong = new Promise<void>((r) => {
      daGhi = r;
    });
    const giaoDichAnhXa = trong(orgA, async (c) => {
      await ghiAnhXa(c, orgA, { rfqId: g.rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien });
      daGhi();
      await cho;
    });
    await ghiXong;
    const mo = await db.pool.connect();
    try {
      await mo.query("BEGIN");
      let xong = false;
      const moThau = moThauTrong(mo, g).finally(() => {
        xong = true;
      });
      await new Promise((r) => setTimeout(r, 1500));
      expect(xong, "câu UPDATE trạng thái của giao dịch mở thầu phải CHỜ khoá FOR SHARE của ánh xạ").toBe(false);
      tha();
      await giaoDichAnhXa;
      await moThau;
      await mo.query("COMMIT");
    } finally {
      mo.release();
    }
    const { rows } = await db.pool.query<{ ly_do: string | null }>("SELECT ly_do FROM rfq_item_mappings WHERE rfq_id = $1", [g.rfqId]);
    expect(rows).toEqual([{ ly_do: null }]);
    // Sau lần mở thầu, cùng dòng ghi lại thì đòi lý do.
    expect(await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId: g.rfqId, lineNo: 1, hangChuanId: hangD10, actorSessionId: ql.phien })))).toBe(
      "CAN_LY_DO",
    );
  });
});

describe("[S1.9101 / §2.5 ⒁] bác một dòng đã từng có gợi ý GOI_Y đòi lý do", () => {
  it("bác không lý do sau GOI_Y bị từ chối — kể cả khi một gợi ý CAN_DUYET ghi sau; bác dòng chỉ có CAN_DUYET thì không cần", async () => {
    const rfqId = await goiDaNop(["Thép vằn D12", "Gạch thẻ đỏ"]);
    await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien }));
    // Người nộp duyệt ghi thêm một hàng CAN_DUYET cho dòng 1 — không xoá được dấu của GOI_Y trước nó.
    await trong(orgA, (c) =>
      c.query(
        "INSERT INTO rfq_item_goi_y (org_id, rfq_id, line_no, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, tac_gia, session_id) " +
          "VALUES ($1, $2, 1, 'CAN_DUYET', 0.1, 1, '{}', $3, $4)",
        [orgA, rfqId, pm.nguoi, pm.phien],
      ),
    );
    expect(await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: null, actorSessionId: ql.phien })))).toBe("CAN_LY_DO");
    await trong(orgA, (c) =>
      ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: null, lyDo: "hang nhap khau, khong co trong danh muc", actorSessionId: ql.phien }),
    );
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 2, hangChuanId: null, actorSessionId: ql.phien }));
    expect(await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfqId))).toEqual([
      { lineNo: 1, trangThai: "NGUOI_DUYET", hangChuan: null, lyDo: "hang nhap khau, khong co trong danh muc" },
      { lineNo: 2, trangThai: "NGUOI_DUYET", hangChuan: null, lyDo: null },
    ]);
  });
});

describe("[S1.9101 / S4.3a] hàng đợi, thao tác, băm của dòng", () => {
  it("hàng đợi: dòng chưa ánh xạ của gói đã nộp, kèm gợi ý hiện hành; dòng đã duyệt và gói còn soạn không có mặt; tổ chức khác không thấy", async () => {
    const rfqId = await goiDaNop(["Thép vằn D12 hàng đợi", "Gạch thẻ hàng đợi"]);
    const soan = await taoGoi(orgA, pm, ["Thép vằn D12 gói còn soạn"]);
    await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien }));
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien }));
    const { dong, conNua } = await trong(orgA, (c) => docHangDoi(c, orgA));
    expect(conNua).toBe(false);
    const cuaGoi = dong.filter((d) => d.rfqId === rfqId);
    expect(cuaGoi.map((d) => [d.lineNo, d.moTa, d.goiY?.ketQua])).toEqual([[2, "Gạch thẻ hàng đợi", "CAN_DUYET"]]);
    expect(dong.some((d) => d.rfqId === soan)).toBe(false);
    expect((await trong(orgB, (c) => docHangDoi(c, orgB))).dong).toEqual([]);
  });

  it("tạo hàng chuẩn mới rồi ánh xạ, trong một giao dịch; gói còn soạn và dòng không có bị từ chối có mã", async () => {
    const rfqId = await goiDaNop(["Ống nhựa PPR phi 25"]);
    const { hangChuanId } = await trong(orgA, (c) =>
      taoHangChuanVaAnhXa(c, orgA, {
        rfqId,
        lineNo: 1,
        hangChuan: { ma: "ONG-PPR-25", ten: "Ống nhựa PPR phi 25", donViGoc: "m", thuocTinh: { kich_thuoc: "25" } },
        taoBiDanh: true,
        actorSessionId: ql.phien,
      }),
    );
    expect((await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfqId)))[0]).toMatchObject({ trangThai: "NGUOI_DUYET", hangChuan: { id: hangChuanId, ma: "ONG-PPR-25" } });
    const soan = await taoGoi(orgA, pm, ["Ống nhựa PPR phi 25"]);
    expect(await maLoi(trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId: soan, actorSessionId: pm.phien })))).toBe("GOI_CON_SOAN");
    expect(await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId: soan, lineNo: 1, hangChuanId, actorSessionId: ql.phien })))).toBe("GOI_CON_SOAN");
    expect(await maLoi(trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 9, hangChuanId, actorSessionId: ql.phien })))).toBe("KHONG_CO_HANG_MUC");
    // Câu ghi thẳng, bỏ qua phép hỏi trước của tầng gói: trigger là lớp chặn cuối cho cả hai bảng.
    expect(await maLoi(chenThang(orgA, ql, { rfqId: soan, lineNo: 1, nguon: "NGUOI_DUYET", hangChuan: hangChuanId }))).toBe("anh_xa_goi_con_soan");
    expect(
      await maLoi(
        trong(orgA, (c) =>
          c.query(
            "INSERT INTO rfq_item_goi_y (org_id, rfq_id, line_no, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, tac_gia, session_id) " +
              "VALUES ($1, $2, 1, 'GOI_Y', 0.9, 1, '{}', $3, $4)",
            [orgA, soan, pm.nguoi, pm.phien],
          ),
        ),
      ),
    ).toBe("anh_xa_goi_con_soan");
    expect(await maLoi(chenThang(orgA, ql, { rfqId, lineNo: 9, nguon: "NGUOI_DUYET", hangChuan: hangChuanId }))).toBe("anh_xa_khong_co_hang_muc");
    // Tổ chức khác: không thấy gói (RLS) — câu ghi thẳng bị từ chối, không lọt sang.
    expect(await maLoi(chenThang(orgB, qlB, { rfqId, lineNo: 1, nguon: "NGUOI_DUYET", hangChuan: null }))).toBe("anh_xa_goi_con_soan");
  });

  it("băm của dòng: sửa mô tả sau khi ánh xạ làm ánh xạ cũ thôi hiệu lực — dòng trở lại hàng đợi", async () => {
    const rfqId = await goiDaNop(["Thép vằn D12 sẽ sửa"]);
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien }));
    expect((await trong(orgA, (c) => docAnhXaGoi(c, orgA, rfqId)))[0]?.trangThai).toBe("NGUOI_DUYET");
    // Dựng cảnh *"gói về DRAFT, dòng được sửa, nộp lại"* (đường thật là K4a của tổ chức đã bật): sửa thẳng dưới vai chủ cụm.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE rfq_items DISABLE TRIGGER USER");
      await c.query("UPDATE rfq_items SET description = 'Thép vằn D32 đã sửa' WHERE rfq_id = $1", [rfqId]);
      await c.query("ALTER TABLE rfq_items ENABLE TRIGGER USER");
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    expect((await trong(orgA, (c2) => docAnhXaGoi(c2, orgA, rfqId)))[0]?.trangThai).toBe("CHUA_CHUAN_HOA");
    expect((await trong(orgA, (c2) => docHangDoi(c2, orgA))).dong.some((d) => d.rfqId === rfqId)).toBe(true);
  });
});

describe("[INV-L1] khuôn nền của hai bảng mới", () => {
  it("[INV-L1] chỉ-ghi-thêm (UPDATE, DELETE, TRUNCATE bị từ chối kể cả dưới chủ cụm); seq tăng; băm, seq, ghi_luc ngoài GRANT; tác giả dẫn xuất từ phiên", async () => {
    const rfqId = await goiDaNop(["Thép vằn D12 khuôn"]);
    await trong(orgA, (c) => chuanHoaGoi(c, orgA, { rfqId, actorSessionId: pm.phien }));
    await trong(orgA, (c) => ghiAnhXa(c, orgA, { rfqId, lineNo: 1, hangChuanId: hangD12, actorSessionId: ql.phien }));
    expect([await demHang("rfq_item_mappings", rfqId), await demHang("rfq_item_goi_y", rfqId)]).toEqual([1, 1]);
    for (const bang of ["rfq_item_mappings", "rfq_item_goi_y"]) {
      await expect(db.pool.query(`UPDATE ${bang} SET line_no = line_no WHERE rfq_id = $1`, [rfqId])).rejects.toThrow(/chi duoc ghi them/iu);
      await expect(db.pool.query(`DELETE FROM ${bang} WHERE rfq_id = $1`, [rfqId])).rejects.toThrow(/chi duoc ghi them/iu);
      await expect(db.pool.query(`TRUNCATE ${bang}`)).rejects.toThrow(/chi duoc ghi them/iu);
    }
    expect(
      await maLoi(
        trong(orgA, (c) =>
          c.query(
            "INSERT INTO rfq_item_goi_y (org_id, rfq_id, line_no, hang_muc_bam, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, tac_gia, session_id) " +
              "VALUES ($1, $2, 1, '\\x00', 'GOI_Y', 0.9, 1, '{}', $3, $4)",
            [orgA, rfqId, pm.nguoi, pm.phien],
          ),
        ),
      ),
    ).toBe("42501");
    // Tác giả khai khác người của phiên.
    expect(
      await maLoi(
        trong(orgA, (c) =>
          c.query(
            "INSERT INTO rfq_item_goi_y (org_id, rfq_id, line_no, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, tac_gia, session_id) " +
              "VALUES ($1, $2, 1, 'GOI_Y', 0.9, 1, '{}', $3, $4)",
            [orgA, rfqId, ql.nguoi, pm.phien],
          ),
        ),
      ),
    ).not.toBe("KHONG_NEM");
    const { rows } = await db.pool.query<{ so: number; bam: boolean }>(
      "SELECT seq::int AS so, hang_muc_bam = rfq_hang_muc_bam(org_id, rfq_id, line_no) AS bam FROM rfq_item_goi_y WHERE org_id = $1 ORDER BY seq",
      [orgA],
    );
    expect(rows.map((r) => r.so)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.every((r) => r.bam)).toBe(true);
  });
});
