// ===============================================================================================
// [S1.105 / S2.3] LƯỢT ĐÁNH GIÁ — ĐƯỜNG HỢP LỆ, NĂM LỐI TỪ CHỐI, VÀ VẾ NỘI DUNG CỦA **J1**
//
// **Phong bì ở đây là GIẢ, và bản rõ được ghi thẳng** dưới vai `app_unseal` — đúng khuôn
// `packages/unseal/src/comparison.int.test.ts`. Tệp này đo thứ S2.3 THÊM (chấm, xếp hạng, cổng
// quyền, cạnh trạng thái, hàng sổ), không đo lại đường mở thầu của S1: đường ấy đã có phép đo
// riêng ở `apps/unseal-worker/src/kich-ban-41.int.test.ts` với mật mã thật.
//
// **Không mang nhãn `[INV-*]`**, và đó là cố ý: J1 mới có vế cấu trúc + vế nội dung ở tầng CSDL,
// còn J2 mới có vế dễ; cả hai chưa đủ để khai một bất biến nhóm J là ĐÃ ĐƯỢC CƯỠNG CHẾ. Gắn nhãn
// ở đây là ghi một dòng `passed` vào hàng của một bất biến chưa trọn — đúng thứ `[INV-H22]` chặn.
// ===============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { PermissionDeniedError } from "@trustprocure/identity";
import { withTenant } from "@trustprocure/tenancy";
import { approveUnseal, requestUnseal } from "@trustprocure/unseal";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { DanhGiaTuChoiError, taoLuotDanhGia } from "./luot-danh-gia.js";
import { SO_LE_TIEN, docSo, vietSo } from "./chi-phi-hieu-dung.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA = "";
let uYc = "", uD1 = "", uKhong = "";
let sYc = "", sD1 = "", sKhong = "";

async function taoNguoi(email: string, vaiTro: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgA, id, vaiTro]);
  return id;
}

async function taoPhien(userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/** Phiên bản chính sách KẾ TIẾP — `035` đòi `version` bằng ĐÚNG `max + 1` và liên tục. */
async function taoChinhSach(evalComponents: string | null): Promise<string> {
  const { rows: ke } = await db.pool.query<{ n: number }>(
    "SELECT coalesce(max(version), 0) + 1 AS n FROM org_procurement_policies WHERE org_id = $1",
    [orgA],
  );
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "eval_components, bafo_top_n, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '100000000.00', 'VND', $3::jsonb, CASE WHEN $3::jsonb IS NULL THEN NULL ELSE 0 END, $4, $5) RETURNING id",
    [orgA, ke[0]?.n ?? 1, evalComponents, uYc, sYc],
  );
  return rows[0]?.id ?? "";
}

async function taoRfqMo(policyId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, " +
      "created_by, created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) RETURNING id",
    [orgA, MAI_SAU, uYc, sYc],
  );
  const rfqId = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, " +
      "created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [orgA, rfqId, uYc, sYc],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, " +
      "created_by, created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgA, rfqId, policyId, uYc, sYc],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, " +
        "key_version, created_by, created_by_session_id) VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [orgA, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), uYc, sYc],
    );
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return rfqId;
}

async function nopBaoGia(rfqId: string, tenNcc: string): Promise<string> {
  const hex = randomBytes(4).toString("hex");
  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, tenNcc, uYc, sYc],
  );
  const supplierId = ncc[0]?.id ?? "";
  const { rows: lh } = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
    [orgA, supplierId, `${hex}@vidu.vn`, uYc, sYc],
  );
  const contactId = lh[0]?.id ?? "";
  const { rows: lm } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
      "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [orgA, rfqId, supplierId, contactId, uYc, sYc],
  );
  const invitationId = lm[0]?.id ?? "";
  const { rows: tk } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
      "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
    [orgA, invitationId, randomBytes(32), uYc, sYc],
  );
  const { rows: tt } = await db.pool.query<{ id: string }>(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, " +
      "destination_hash, pepper_version, expires_at, consumed_at) " +
      "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
    [orgA, invitationId, tk[0]?.id ?? "", contactId, randomBytes(32), randomBytes(32)],
  );
  const { rows: pk } = await db.pool.query<{ id: string }>(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, " +
      "verified_channel, expires_at) VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [orgA, invitationId, tt[0]?.id ?? "", randomBytes(32), contactId],
  );
  return await withTenant(apiPool, orgA, async (c) => {
    const { rows: b } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, invitationId],
    );
    const bidId = b[0]?.id ?? "";
    const { rows: v } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
        "VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, bidId, Buffer.alloc(64, 9), pk[0]?.id ?? ""],
    );
    const versionId = v[0]?.id ?? "";
    await c.query(
      "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)",
      [
        orgA,
        versionId,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bidId}\n` +
          `version=1\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-05T00:00:00.000000Z\n`,
        Buffer.alloc(70, 7),
      ],
    );
    return versionId;
  });
}

/** Đóng RFQ, xin + duyệt mở thầu, ghi bản rõ, rồi tuyên bố `UNSEALED`. */
async function moThau(rfqId: string, banRo: readonly (readonly [string, unknown])[]): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', " +
      "closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  const yc = await withTenant(apiPool, orgA, (c) =>
    requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau", actorSessionId: sYc }, apiPool),
  );
  await withTenant(apiPool, orgA, (c) =>
    approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sD1 }, apiPool),
  );
  await withTenant(unsealPool, orgA, async (c) => {
    for (const [versionId, payload] of banRo) {
      await c.query(
        "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)",
        [orgA, yc.id, versionId, JSON.stringify(payload)],
      );
    }
    await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
  });
}

/** Một gói thầu ở `UNSEALED` với các báo giá đã mở mang đúng những số tiền cho trước. */
async function goiDaMo(
  soTien: readonly (readonly [string, string | null])[],
  evalComponents: string | null = TP_GIA,
): Promise<{ rfqId: string; banRo: readonly string[] }> {
  const csId = await taoChinhSach(evalComponents);
  const rfqId = await taoRfqMo(csId);
  const ban: [string, unknown][] = [];
  const ids: string[] = [];
  for (const [i, [tien, dv]] of soTien.entries()) {
    const versionId = await nopBaoGia(rfqId, `NCC ${String(i)} ${randomBytes(2).toString("hex")}`);
    ids.push(versionId);
    ban.push([versionId, { totalAmount: tien, currency: dv }]);
  }
  await moThau(rfqId, ban);
  return { rfqId, banRo: ids };
}

async function trangThaiRfq(rfqId: string): Promise<string> {
  const { rows } = await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId]);
  return rows[0]?.status ?? "";
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
  uYc = await taoNguoi("yc@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi("d1@vidu.vn", "DIRECTOR");
  // [S1.105 — ĐO, không đoán] `DIRECTOR` là vai DUY NHẤT trong sáu vai của `005` KHÔNG giữ
  // `evaluation.perform`: năm vai kia (REQUESTER · BUYER · TECHNICAL · PROCUREMENT_MANAGER ·
  // FINANCE) đều có. Nên cổng quyền của route chấm gần như không phân tách được vai nào — cùng
  // hình dạng mà ADR-051 đã tìm ra cho J3, và nó là lý do J3 cần một lớp theo HÀNH VI.
  uKhong = await taoNguoi("khong@vidu.vn", "DIRECTOR");
  sYc = await taoPhien(uYc);
  sD1 = await taoPhien(uD1);
  sKhong = await taoPhien(uKhong);
  expect([orgA, uYc, uD1, uKhong, sYc, sD1, sKhong].filter((x) => x === "")).toEqual([]);
}, 240000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.105 / S2.3] đường hợp lệ của một lượt chấm", { timeout: 180000 }, () => {
  it("ba báo giá đọc được ⇒ xếp hạng theo giá TĂNG DẦN, RFQ sang EVALUATING, một hàng sổ", async () => {
    const { rfqId, banRo } = await goiDaMo([
      ["548800000.00", "VND"],
      ["537600000.00", "VND"],
      ["544000000.00", "VND"],
    ]);
    const kq = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(kq.currency).toBe("VND");
    expect(kq.lines).toHaveLength(3);
    const theoId = new Map(kq.lines.map((l) => [l.bidVersionId, l]));
    expect([banRo[0], banRo[1], banRo[2]].map((id) => theoId.get(id ?? "")?.rank)).toEqual([3, 1, 2]);
    expect(theoId.get(banRo[1] ?? "")?.effectiveCost, "hệ số 1.0000 ⇒ chi phí hiệu dụng bằng đúng tổng").toBe(
      "537600000.00",
    );
    expect(await trangThaiRfq(rfqId), "cạnh UNSEALED->EVALUATING có từ 011 và vòng này làm nó SỐNG").toBe(
      "EVALUATING",
    );
    const { rows: so } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'RFQ_EVALUATED' AND resource_id = $1",
      [kq.evaluationId],
    );
    expect(so[0]?.n, "J6: mỗi lượt chấm để lại đúng một hàng sổ").toBe("1");
  });

  it("hai báo giá BẰNG NHAU nhận CÙNG một hạng — ADR-052 cố ý không chốt luật phá hoà", async () => {
    const { rfqId, banRo } = await goiDaMo([
      ["100.00", "VND"],
      ["100.00", "VND"],
      ["200.00", "VND"],
    ]);
    const kq = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    const theoId = new Map(kq.lines.map((l) => [l.bidVersionId, l.rank]));
    expect(
      [banRo[0], banRo[1], banRo[2]].map((id) => theoId.get(id ?? "")),
      "xếp hạng thi đấu 1, 1, 3 — hai hạng khác nhau là khai một thứ tự mà dữ liệu không có",
    ).toEqual([1, 1, 3]);
  });

  it("báo giá KHÔNG đọc được giá vẫn CÓ hàng, `effective_cost` và `rank` đều NULL, và không chiếm chỗ trong dãy", async () => {
    const { rfqId, banRo } = await goiDaMo([
      ["khong-phai-so", "VND"],
      ["100.00", "VND"],
      ["200.00", "VND"],
    ]);
    const kq = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    const theoId = new Map(kq.lines.map((l) => [l.bidVersionId, l]));
    const hong = theoId.get(banRo[0] ?? "");
    expect([hong?.effectiveCost, hong?.rank], "spec §2.3⑺: giữ hàng, không vứt").toEqual([null, null]);
    expect(hong?.components, "không có số thì không có thành phần nào sinh ra nó").toEqual([]);
    expect(
      [banRo[1], banRo[2]].map((id) => theoId.get(id ?? "")?.rank),
      "hàng không đọc được KHÔNG chiếm hạng 1 — nó không tham gia thứ tự nào cả",
    ).toEqual([1, 2]);
  });

  it("`components` đọc TỪ CSDL cộng ra ĐÚNG `effective_cost` — vế dễ của J2, trên dữ liệu đã ghi", async () => {
    const { rfqId } = await goiDaMo([["1234.57", "VND"]]);
    const kq = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    const { rows } = await db.pool.query<{ effective_cost: string; components: { tien: string | null }[] }>(
      "SELECT effective_cost, components FROM rfq_evaluation_lines WHERE evaluation_id = $1",
      [kq.evaluationId],
    );
    const hang = rows[0];
    const cong = (hang?.components ?? [])
      .map((c) => docSo(c.tien ?? "0.00", SO_LE_TIEN) ?? 0n)
      .reduce((s, v) => s + v, 0n);
    expect(vietSo(cong, SO_LE_TIEN), "kiểm toán viên cộng cột `tien` là ra con số đã lưu").toBe(
      hang?.effective_cost,
    );
  });
});

describe("[S1.105 / S2.3] năm lối TỪ CHỐI, mỗi lối một câu gọi tên", { timeout: 180000 }, () => {
  it("RFQ không ở UNSEALED", async () => {
    const csId = await taoChinhSach(TP_GIA);
    const rfqId = await taoRfqMo(csId);
    await expect(
      withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool)),
    ).rejects.toMatchObject({ lyDo: "RFQ_KHONG_CHAM_DUOC" });
  });

  it("chính sách CHƯA khai trọng số ⇒ câu từ chối GỌI TÊN phiên bản, không lấy mặc định", async () => {
    const { rfqId } = await goiDaMo([["100.00", "VND"]], null);
    const loi = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    ).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(DanhGiaTuChoiError);
    expect((loi as DanhGiaTuChoiError).lyDo).toBe("CHINH_SACH_CHUA_KHAI_TRONG_SO");
    expect(
      (loi as DanhGiaTuChoiError).message,
      "spec §4.1 đòi câu nói rõ: *chính sách phiên bản N chưa khai trọng số*",
    ).toMatch(/Chính sách phiên bản \d+ chưa khai trọng số đánh giá/u);
  });

  it("chính sách khai một thành phần CHƯA CÓ NGUỒN ⇒ từ chối, không âm thầm lấy 0", async () => {
    const ca = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"kt","don_vi":"DIEM","he_so":"2.0000"}]';
    const { rfqId } = await goiDaMo([["100.00", "VND"]], ca);
    await expect(
      withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool)),
    ).rejects.toMatchObject({ lyDo: "THANH_PHAN_CHUA_CO_NGUON" });
  });

  it("LỆCH TIỀN TỆ ⇒ từ chối CẢ LƯỢT, mạnh hơn bảng so sánh (nó chỉ hiển thị nên trả null được)", async () => {
    const { rfqId } = await goiDaMo([
      ["100.00", "VND"],
      ["100.00", "USD"],
    ]);
    await expect(
      withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool)),
    ).rejects.toMatchObject({ lyDo: "LECH_TIEN_TE" });
    expect(await trangThaiRfq(rfqId), "một lượt bị từ chối KHÔNG chuyển trạng thái gói thầu").toBe("UNSEALED");
  });

  it("không một báo giá nào đọc được giá ⇒ không có gì để xếp hạng", async () => {
    const { rfqId } = await goiDaMo([["NaN", "VND"]]);
    await expect(
      withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool)),
    ).rejects.toMatchObject({ lyDo: "KHONG_CO_BAO_GIA_DOC_DUOC" });
  });

  it("thiếu quyền `evaluation.perform` ⇒ PermissionDeniedError, và lần từ chối ĐƯỢC GHI SỔ (J6)", async () => {
    const { rfqId } = await goiDaMo([["100.00", "VND"]]);
    const truoc = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'PERMISSION_DENIED'",
    );
    await expect(
      withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sKhong }, apiPool)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const sau = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE action = 'PERMISSION_DENIED'",
    );
    expect(Number(sau.rows[0]?.n ?? 0) - Number(truoc.rows[0]?.n ?? 0), "mọi lần từ chối QUYỀN để lại một hàng").toBe(1);
    expect(await trangThaiRfq(rfqId)).toBe("UNSEALED");
  });
});

describe("[S1.105 / S2.3] vế NỘI DUNG của J1 — trigger đọc chính sách đã ghim", { timeout: 180000 }, () => {
  /** Một lượt chấm TRỐNG, ghim vào một chính sách cho trước — để chèn tay từng hàng xếp hạng. */
  async function luotTrong(evalComponents: string): Promise<{ evalId: string; bidVersionId: string }> {
    const { rfqId, banRo } = await goiDaMo([["100.00", "VND"]], evalComponents);
    const { rows: cs } = await db.pool.query<{ id: string }>(
      "SELECT id FROM org_procurement_policies WHERE org_id = $1 ORDER BY version DESC LIMIT 1",
      [orgA],
    );
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) " +
        "VALUES ($1, $2, $3, 'VND', $4, $5) RETURNING id",
      [orgA, rfqId, cs[0]?.id ?? "", uYc, sYc],
    );
    return { evalId: rows[0]?.id ?? "", bidVersionId: banRo[0] ?? "" };
  }

  async function chenHang(evalId: string, bidVersionId: string, components: string): Promise<void> {
    await db.pool.query(
      "INSERT INTO rfq_evaluation_lines (org_id, evaluation_id, bid_version_id, effective_cost, components, rank) " +
        "VALUES ($1, $2, $3, '100.00', $4, 1)",
      [orgA, evalId, bidVersionId, components],
    );
  }

  it("tập thành phần KHỚP chính sách ⇒ đi qua (đối chứng dương)", async () => {
    const { evalId, bidVersionId } = await luotTrong(TP_GIA);
    await expect(chenHang(evalId, bidVersionId, '[{"ma":"gia","tien":"100.00"}]')).resolves.toBeUndefined();
  });

  it("THIẾU một thành phần chính sách đã khai ⇒ 23514", async () => {
    const ca = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"kt","don_vi":"DIEM","he_so":"2.0000"}]';
    const { evalId, bidVersionId } = await luotTrong(ca);
    await expect(chenHang(evalId, bidVersionId, '[{"ma":"gia","tien":"100.00"}]')).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("THỪA một mã chính sách KHÔNG khai ⇒ 23514 — một con số không ai giải thích được", async () => {
    const { evalId, bidVersionId } = await luotTrong(TP_GIA);
    await expect(
      chenHang(evalId, bidVersionId, '[{"ma":"gia","tien":"100.00"},{"ma":"bi_an","tien":"9.99"}]'),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("**MỆNH ĐỀ J1**: một thành phần chính sách khai `DIEM` mà hàng lại mang `tien` cho nó ⇒ 23514", async () => {
    const ca = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"kt","don_vi":"DIEM","he_so":"2.0000"}]';
    const { evalId, bidVersionId } = await luotTrong(ca);
    await expect(
      chenHang(evalId, bidVersionId, '[{"ma":"gia","tien":"100.00"},{"ma":"kt","tien":"240.00"}]'),
      "một điểm phi giá KHÔNG được đi vào effective_cost — đó là toàn bộ J1",
    ).rejects.toMatchObject({ code: "23514" });
    // Và cùng hàng ấy với `tien: null` cho `kt` thì ĐI QUA — J1 LỌC, không CẤM.
    await expect(
      chenHang(evalId, bidVersionId, '[{"ma":"gia","tien":"100.00"},{"ma":"kt","tien":null}]'),
    ).resolves.toBeUndefined();
  });

  // [S1.105] ĐỘT BIẾN — GỠ TRIGGER THÌ HÀNG SAI ĐI LỌT, và đó là phép đo rằng vế nội dung của
  // J1 sống trong TRIGGER chứ không trong một `CHECK` nào.
  //
  // Đột biến phải làm LÚC CHẠY, KHÔNG bằng cách sửa migration: hardening ghim trigger này và nó
  // TỰ CHỮA ở mọi lượt `migrate()`, nên một đột biến trong migration sẽ "sống" GIẢ — đúng cái bẫy
  // S1.86 đã trả giá bằng một lượt evidence 309 ca đỏ.
  //
  // Câu khôi phục mang `ENABLE ALWAYS`: thiếu nó là trả lại một trigger YẾU HƠN bản đã gỡ, đúng
  // khoản **216** mà S1.100 mở và đóng trong cùng vòng.
  it("đột biến: gỡ trigger `..._kiem_thanh_phan` ⇒ hàng mang `tien` cho thành phần DIEM ĐI LỌT", async () => {
    const ca =
      '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"kt","don_vi":"DIEM","he_so":"2.0000"}]';
    const { evalId, bidVersionId } = await luotTrong(ca);
    const sai = '[{"ma":"gia","tien":"100.00"},{"ma":"kt","tien":"240.00"}]';
    // Tiền đề: với trigger CÒN SỐNG, hàng ấy bị chặn.
    await expect(chenHang(evalId, bidVersionId, sai)).rejects.toMatchObject({ code: "23514" });

    await db.pool.query(
      "ALTER TABLE rfq_evaluation_lines DISABLE TRIGGER rfq_evaluation_lines_kiem_thanh_phan",
    );
    try {
      const truoc = await db.pool.query<{ n: string }>(
        "SELECT tgenabled::text AS n FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal",
        ["rfq_evaluation_lines_kiem_thanh_phan"],
      );
      expect(
        truoc.rows[0]?.n,
        "khẳng định đột biến ĐÃ ÁP — một đột biến không áp được là một ca XANH vô nghĩa",
      ).toBe("D");
      await expect(
        chenHang(evalId, bidVersionId, sai),
        "không trigger thì một điểm phi giá đi thẳng vào effective_cost — J1 mất lớp duy nhất của nó",
      ).resolves.toBeUndefined();
    } finally {
      await db.pool.query(
        "ALTER TABLE rfq_evaluation_lines ENABLE ALWAYS TRIGGER rfq_evaluation_lines_kiem_thanh_phan",
      );
      const sau = await db.pool.query<{ n: string }>(
        "SELECT tgenabled::text AS n FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal",
        ["rfq_evaluation_lines_kiem_thanh_phan"],
      );
      expect(sau.rows[0]?.n, "khôi phục phải trả về ENABLE ALWAYS (`A`), không phải `O` — khoản 216").toBe(
        "A",
      );
    }
  });

  it("`app_api` KHÔNG sửa được một lượt chấm đã ghi — bảng chỉ ghi thêm", async () => {
    const { evalId } = await luotTrong(TP_GIA);
    await expect(
      withTenant(apiPool, orgA, (c) => c.query("UPDATE rfq_evaluations SET currency = 'USD' WHERE id = $1", [evalId])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
