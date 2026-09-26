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
//
// [S1.106 / S2.4] Tệp này nay đo CẢ đường ĐỌC (`docBangXepHang`), và nó nằm ở đây chứ không ở một
// tệp riêng vì toàn bộ giàn cảnh — chính sách, RFQ, báo giá niêm phong, mở thầu — là CHUNG. Một
// tệp thứ hai nghĩa là một container Postgres thứ 55 và một BẢN SAO của giàn cảnh ấy; hai bản sao
// của cùng một quy ước là hai chỗ để chúng lệch nhau.
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
import { docBangXepHang } from "./doc-bang-xep-hang.js";
import { DanhGiaTuChoiError, taoLuotDanhGia } from "./luot-danh-gia.js";
// Bí danh có chủ đích: tệp này đã có một FIXTURE tên `moVongBafo` (chèn hàng thẳng, dựng
// cảnh cho S1.108). Hàm SẢN XUẤT đi vào dưới tên khác để không chỗ nào đọc nhầm cái này
// thành cái kia — hai thứ đo hai việc khác nhau.
import {
  VongBafoTuChoiError,
  docVongBafo,
  dongVongBafo as dongVongBafoThat,
  moVongBafo as moVongBafoThat,
} from "./vong-bafo.js";
import {
  deXuatTraoThau,
  docTraoThau,
  duyetTraoThau,
  huyTraoThau,
} from "./trao-thau.js";
import { SO_LE_TIEN, docSo, vietSo } from "./chi-phi-hieu-dung.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA = "";
// [S1.106 / S2.4] Tổ chức THỨ HAI, một người, một phiên — đủ để hỏi bảng xếp hạng của tổ chức
// A từ phía NGƯỜI GỌI khác. Không dựng giàn cảnh gì thêm cho nó: câu cần đo là *không thấy gì*.
let orgB = "";
let uYc = "", uD1 = "", uKhong = "", uKhongXem = "", uB = "";
let sYc = "", sD1 = "", sKhong = "", sKhongXem = "", sB = "";
// [S1.110 / S2.6] HAI người nữa, và cả hai là một phép ĐO trên `005` chứ không một khẩu vị:
//   * `uDeXuat` — PROCUREMENT_MANAGER THỨ HAI. Giữ `award.recommend` và `bid.view`, KHÔNG giữ
//     `po.approve`, và KHÔNG phải `created_by` của RFQ nào (fixture luôn dùng `uYc`). Đó là ba
//     tính chất mà một người đề xuất hợp lệ phải có, và không vai nào khác trong fixture có đủ.
//   * `uDuyet` — FINANCE. Giữ `po.approve`, và giữ LUÔN `award.recommend`; vế thứ hai là thứ
//     làm ca *người đề xuất tự duyệt* đo được ở đúng chỗ khó — một người có CẢ HAI mã, tức lớp
//     vai trò không chặn nổi và chỉ một trigger đọc hàng chặn được.
let uDeXuat = "", uDuyet = "";
let sDeXuat = "", sDuyet = "";

async function taoNguoi(email: string, vaiTro: string, org: string = orgA): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [org, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, vaiTro]);
  return id;
}

async function taoPhien(userId: string, org: string = orgA): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [org, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

/**
 * Phiên bản chính sách KẾ TIẾP — `035` đòi `version` bằng ĐÚNG `max + 1` và liên tục.
 *
 * [S1.108 / S2.5] `topN` thêm ở vòng này, mặc định `0` = *"tổ chức này không dùng BAFO"* (quy ước
 * của `056`). Mặc định giữ nguyên hành vi cho ba mươi chỗ gọi đã có.
 */
async function taoChinhSach(evalComponents: string | null, topN = 0): Promise<string> {
  const { rows: ke } = await db.pool.query<{ n: number }>(
    "SELECT coalesce(max(version), 0) + 1 AS n FROM org_procurement_policies WHERE org_id = $1",
    [orgA],
  );
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "eval_components, bafo_top_n, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '100000000.00', 'VND', $3::jsonb, CASE WHEN $3::jsonb IS NULL THEN NULL ELSE $6::integer END, $4, $5) RETURNING id",
    [orgA, ke[0]?.n ?? 1, evalComponents, uYc, sYc, topN],
  );
  return rows[0]?.id ?? "";
}

/**
 * [S1.108 / S2.5] Luồng báo giá và phiên khách của từng phiên bản đã nộp.
 *
 * Nộp BAFO KHÔNG phải một luồng mới: `vendor_bids` có `UNIQUE (org_id, invitation_id)` từ `018`
 * nên một lời mời có ĐÚNG MỘT luồng, và báo giá vòng hai là một PHIÊN BẢN mới trên luồng ấy. Để
 * nộp lại cần đúng hai thứ mà `nopBaoGia` đang bỏ đi: `bid_id` và phiên khách đã xác thực.
 */
const LUONG_CUA_PHIEN_BAN = new Map<string, { readonly bidId: string; readonly phienKhach: string }>();

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
    LUONG_CUA_PHIEN_BAN.set(versionId, { bidId, phienKhach: pk[0]?.id ?? "" });
    return versionId;
  });
}

/**
 * [S1.108 / S2.5] Nộp LẠI trên đúng luồng báo giá của một phiên bản vòng một — đường nộp BAFO.
 *
 * Đi qua CHÍNH `vendor_bid_versions` với CHÍNH phiên khách cũ, nên nó đi qua cả ba trigger của
 * `018` cộng trigger top-N của `059`. Trả về id phiên bản mới.
 */
async function nopLaiBafo(rfqId: string, versionVongMot: string): Promise<string> {
  const luong = LUONG_CUA_PHIEN_BAN.get(versionVongMot);
  if (luong === undefined) throw new Error(`khong biet luong cua phien ban ${versionVongMot}`);
  return await withTenant(apiPool, orgA, async (c) => {
    const { rows: v } = await c.query<{ id: string; version: number }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) " +
        "VALUES ($1, $2, $3, $4) RETURNING id, version",
      [orgA, luong.bidId, Buffer.alloc(64, 11), luong.phienKhach],
    );
    const versionId = v[0]?.id ?? "";
    await c.query(
      "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)",
      [
        orgA,
        versionId,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\n` +
          `bid_id=${luong.bidId}\nversion=${String(v[0]?.version ?? 2)}\n` +
          `ciphertext_sha256=${"b".repeat(64)}\nsubmitted_at=2026-09-22T00:00:00.000000Z\n`,
        Buffer.alloc(70, 8),
      ],
    );
    return versionId;
  });
}

/**
 * [S1.108 / S2.5] Mở một vòng BAFO trên một gói thầu đang `EVALUATING`. Trả về id vòng.
 *
 * `policy_id` được ĐỌC TỪ lượt đánh giá chứ không truyền vào: `rfq_evaluations.policy_id` là
 * phiên bản chính sách mà con số xếp hạng đã được tính dưới, và `top_n` của vòng phải khớp
 * `bafo_top_n` của ĐÚNG phiên bản ấy. Truyền tay là mở một đường cho hai giá trị lệch nhau trong
 * chính fixture, tức là đo một thế giới không tồn tại.
 */
async function moVongBafo(
  rfqId: string,
  luotId: string,
  topN: number,
  han: Date = new Date(Date.now() + 3 * 24 * 3600 * 1000),
): Promise<string> {
  const { rows: e } = await db.pool.query<{ policy_id: string }>(
    "SELECT policy_id FROM rfq_evaluations WHERE id = $1",
    [luotId],
  );
  return await withTenant(apiPool, orgA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, " +
        "opened_by, opened_by_session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [orgA, rfqId, luotId, e[0]?.policy_id ?? "", topN, han, uYc, sYc],
    );
    const vongId = rows[0]?.id ?? "";
    await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfqId]);
    return vongId;
  });
}

/**
 * [S1.108 / S2.5] Đóng vòng BAFO rồi mở phong bì vòng hai qua ĐÚNG cổng bốn vế.
 *
 * `requestUnseal` ở đây tạo một yêu cầu THỨ HAI cho cùng RFQ, và C3 của `059` gắn
 * `bafo_round_id` cho nó. Vế ấy là thứ làm `rfq_kiem_yeu_cau_mo_thau` phân biệt được hai vòng.
 */
async function moThauBafo(
  rfqId: string,
  vongId: string,
  banRo: readonly (readonly [string, unknown])[],
): Promise<string> {
  await withTenant(apiPool, orgA, async (c) => {
    await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vongId]);
    await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfqId]);
  });
  const yc = await withTenant(apiPool, orgA, (c) =>
    requestUnseal(c, orgA, { rfqId, reason: "den gio mo thau vong BAFO", actorSessionId: sYc }, apiPool),
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
    await c.query("UPDATE rfq_packages SET status = 'BAFO_UNSEALED' WHERE id = $1", [rfqId]);
    await c.query(
      "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1",
      [yc.id],
    );
  });
  return yc.id;
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
    // [S1.108 / S2.5] Dòng này THIẾU cho tới vòng này, và nó là một lệch so với đường sản xuất:
    // worker thật đặt `EXECUTED` cùng lúc với `UNSEALED` (`apps/unseal-worker/src/index.ts:607` —
    // *"bản rõ, mốc `EXECUTED` và trạng thái `UNSEALED` phải cùng sống hoặc cùng chết"*). Fixture
    // để yêu cầu ở `APPROVED` mãi, và điều đó VÔ HẠI suốt hai vòng vì không kịch bản nào cần một
    // yêu cầu mở thầu THỨ HAI. Vòng BAFO cần, và chỉ mục bộ phận
    // `unseal_requests_mot_yeu_cau_dang_mo` (`019:73`) bắt ngay — *"một RFQ có TỐI ĐA MỘT yêu cầu
    // đang mở"*. Cùng hình dạng *cổng xanh vì phạm vi* mà lượt soi 77 gọi tên.
    await c.query(
      "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1",
      [yc.id],
    );
  });
}

/** Một gói thầu ở `UNSEALED` với các báo giá đã mở mang đúng những số tiền cho trước. */
async function goiDaMo(
  soTien: readonly (readonly [string, string | null])[],
  evalComponents: string | null = TP_GIA,
  topN = 0,
): Promise<{ rfqId: string; banRo: readonly string[]; csId: string }> {
  const csId = await taoChinhSach(evalComponents, topN);
  const rfqId = await taoRfqMo(csId);
  const ban: [string, unknown][] = [];
  const ids: string[] = [];
  for (const [i, [tien, dv]] of soTien.entries()) {
    const versionId = await nopBaoGia(rfqId, `NCC ${String(i)} ${randomBytes(2).toString("hex")}`);
    ids.push(versionId);
    ban.push([versionId, { totalAmount: tien, currency: dv }]);
  }
  await moThau(rfqId, ban);
  return { rfqId, banRo: ids, csId };
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
  // [S1.106 / S2.4] Cổng của đường ĐỌC là `bid.view`, và `005` cấp nó cho PROCUREMENT_MANAGER,
  // FINANCE, DIRECTOR — nên một phiên KHÔNG xem được phải là một vai khác `uKhong` ở trên.
  uKhongXem = await taoNguoi("khong-xem@vidu.vn", "REQUESTER");
  uDeXuat = await taoNguoi("de-xuat@vidu.vn", "PROCUREMENT_MANAGER");
  uDuyet = await taoNguoi("duyet@vidu.vn", "FINANCE");
  sYc = await taoPhien(uYc);
  sDeXuat = await taoPhien(uDeXuat);
  sDuyet = await taoPhien(uDuyet);
  sD1 = await taoPhien(uD1);
  sKhong = await taoPhien(uKhong);
  sKhongXem = await taoPhien(uKhongXem);
  const { rows: b } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  orgB = b[0]?.id ?? "";
  uB = await taoNguoi("pm-b@vidu.vn", "PROCUREMENT_MANAGER", orgB);
  sB = await taoPhien(uB, orgB);
  expect(
    [orgA, orgB, uYc, uD1, uKhong, uKhongXem, uB, uDeXuat, uDuyet,
      sYc, sD1, sKhong, sKhongXem, sB, sDeXuat, sDuyet].filter((x) => x === ""),
  ).toEqual([]);
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

  it("[INV-J2] `components` đọc TỪ CSDL cộng ra ĐÚNG `effective_cost` — vế dễ của J2, trên dữ liệu đã ghi", async () => {
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

  it("[INV-J1] tập thành phần KHỚP chính sách ⇒ đi qua (đối chứng dương)", async () => {
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

  it("[INV-J1] **MỆNH ĐỀ J1**: một thành phần chính sách khai `DIEM` mà hàng lại mang `tien` cho nó ⇒ 23514", async () => {
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
  it("[INV-J1] đột biến: gỡ trigger `..._kiem_thanh_phan` ⇒ hàng mang `tien` cho thành phần DIEM ĐI LỌT", async () => {
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
// ==============================================================================================
// [S1.106 / S2.4] ĐỌC BẢNG XẾP HẠNG
//
// Vế chịu lực của cả vòng: cột `components` phải đi RA TỚI người đọc. **J2** nói mỗi hàng xếp
// hạng tái lập được, và một màn hình chỉ hiện `effective_cost` biến J2 thành một lời hứa mà người
// mua không kiểm được. Nên phép đo ở đây không dừng ở "có mấy hàng" — nó đòi từng thành phần.
// ==============================================================================================
describe("[S1.106 / S2.4] đọc bảng xếp hạng", { timeout: 180000 }, () => {
  it("chưa chấm lần nào ⇒ `null`, KHÔNG phải một bảng RỖNG", async () => {
    const { rfqId } = await goiDaMo([["101000000.00", "VND"]]);
    const kq = await withTenant(apiPool, orgA, (c) =>
      docBangXepHang(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    // Một mảng rỗng ở đây nói dối: *"đã chấm, và không ai trong bảng"* khác hẳn *"chưa chấm"*, và
    // màn chấm phải phân biệt được hai câu ấy — cùng khuôn `getOpenUnsealForRfq` (khoản 190).
    expect(kq).toBeNull();
  });

  it("chấm rồi ⇒ hạng TĂNG DẦN, tên nhà cung cấp, và MỖI HÀNG mang đủ thành phần sinh ra con số", async () => {
    const { rfqId, banRo } = await goiDaMo([
      ["548800000.00", "VND"],
      ["537600000.00", "VND"],
      ["544000000.00", "VND"],
    ]);
    const luot = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    const kq = await withTenant(apiPool, orgA, (c) =>
      docBangXepHang(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(kq).not.toBeNull();
    expect(kq?.evaluationId).toBe(luot.evaluationId);
    expect(kq?.policyVersion).toBe(luot.policyVersion);
    expect(kq?.currency).toBe("VND");
    expect(kq?.evaluatedAt).toBeInstanceOf(Date);
    // `ORDER BY l.rank ASC NULLS LAST` — hàng đọc theo THỨ HẠNG, không theo thứ tự chèn.
    expect(kq?.rows.map((h) => h.rank)).toEqual([1, 2, 3]);
    expect(kq?.rows.map((h) => h.effectiveCost)).toEqual(["537600000.00", "544000000.00", "548800000.00"]);
    expect(kq?.rows.map((h) => h.bidVersionId)).toEqual([banRo[1], banRo[2], banRo[0]]);
    // Tên nhà cung cấp đi qua BỐN phép nối (`rfq_unsealed_bids` → `vendor_bid_versions` →
    // `vendor_bids` → `rfq_invitations` → `suppliers`); một phép nối sai `org_id` vẫn trả đúng số
    // hàng, nên phải khẳng định chính cái tên.
    for (const h of kq?.rows ?? []) expect(h.supplierName, JSON.stringify(h)).toMatch(/^NCC \d /u);

    // VẾ CHỊU LỰC: từng thành phần, không chỉ tổng. Chính sách của giàn cảnh khai đúng một thành
    // phần `gia` hệ số `1.0000`, nên `giaTri × heSo` phải BẰNG `effectiveCost` của hàng ấy.
    for (const h of kq?.rows ?? []) {
      expect(h.components, JSON.stringify(h)).toHaveLength(1);
      const tp = h.components[0];
      expect(tp?.ma).toBe("gia");
      expect(tp?.donVi).toBe("TIEN");
      expect(tp?.heSo).toBe("1.0000");
      expect(tp?.giaTri).toBe(h.effectiveCost);
      expect(tp?.tien).toBe(h.effectiveCost);
    }
  });

  it("báo giá KHÔNG đọc được số tiền ⇒ xuống CUỐI bảng (`NULLS LAST`) và `components` RỖNG", async () => {
    const { rfqId, banRo } = await goiDaMo([
      ["530000000.00", "VND"],
      ["khong-phai-so", "VND"],
    ]);
    await withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    const kq = await withTenant(apiPool, orgA, (c) =>
      docBangXepHang(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    // `NULL` là LỚN NHẤT theo mặc định ASC của Postgres, nên `NULLS LAST` không đổi kết quả hôm
    // nay — nó được viết ra để một lần đổi `ORDER BY` sang `DESC` mai sau không lặng lẽ đưa hàng
    // không đọc được lên ĐẦU bảng xếp hạng.
    expect(kq?.rows.map((h) => h.rank)).toEqual([1, null]);
    expect(kq?.rows.map((h) => h.bidVersionId)).toEqual([banRo[0], banRo[1]]);
    expect(kq?.rows[1]?.effectiveCost).toBeNull();
    expect(kq?.rows[1]?.components).toEqual([]);
  });

  it("HAI lượt chấm ⇒ đọc lượt MỚI NHẤT, và lượt CŨ còn nguyên trong CSDL", async () => {
    const { rfqId } = await goiDaMo([["520000000.00", "VND"]]);
    const dau = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    // Cạnh `BAFO_CLOSED->EVALUATING` của spec §4.3 sinh một `rfq_evaluations` THỨ HAI; ở vòng này
    // chưa có đường BAFO, nên lượt thứ hai được chèn THẲNG dưới vai ứng dụng — đúng hình dạng mà
    // đường ấy sẽ tạo ra, không phải một lối tắt của test.
    const sau = await withTenant(apiPool, orgA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) " +
          "SELECT org_id, rfq_id, policy_id, currency, created_by, created_by_session_id FROM rfq_evaluations " +
          "WHERE id = $1 RETURNING id",
        [dau.evaluationId],
      );
      return rows[0]?.id ?? "";
    });
    expect(sau).not.toBe("");
    const kq = await withTenant(apiPool, orgA, (c) =>
      docBangXepHang(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(kq?.evaluationId).toBe(sau);
    // Lượt mới chưa có hàng nào ⇒ bảng RỖNG, và đó KHÁC `null`: đã có một lượt chấm.
    expect(kq?.rows).toEqual([]);
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_evaluations WHERE rfq_id = $1",
      [rfqId],
    );
    expect(rows[0]?.n, "lượt chấm cũ đã biến mất — sổ kiểm toán mất một mắt").toBe("2");
  });

  it("`don_vi` VẮNG trong `components` ⇒ suy đúng LUẬT của trigger; `he_so`/`gia_tri` vắng ⇒ `null`, KHÔNG bịa", async () => {
    // `057` chỉ đòi `ma` và `tien` trong mỗi phần tử `components`, nên một hàng THẬT có thể không
    // mang `don_vi`/`he_so`/`gia_tri` — và trigger `kiem_thanh_phan_theo_chinh_sach` suy đơn vị
    // từ `tien` (`null` là `DIEM`, có giá trị là `TIEN`). Bộ đọc phải suy CÙNG một luật, còn hai
    // trường kia thì không suy được từ đâu cả.
    const csId = await taoChinhSach('[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"},{"ma":"chatluong","don_vi":"DIEM","he_so":"2.0000"}]');
    const rfqId = await taoRfqMo(csId);
    const versionId = await nopBaoGia(rfqId, "NCC 9 hai thanh phan");
    await moThau(rfqId, [[versionId, { totalAmount: "515000000.00", currency: "VND" }]]);
    await withTenant(apiPool, orgA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) " +
          "VALUES ($1, $2, $3, 'VND', $4, $5) RETURNING id",
        [orgA, rfqId, csId, uYc, sYc],
      );
      await c.query(
        "INSERT INTO rfq_evaluation_lines (org_id, evaluation_id, bid_version_id, effective_cost, components, rank) " +
          "VALUES ($1, $2, $3, '515000000.00', $4::jsonb, 1)",
        [orgA, rows[0]?.id ?? "", versionId, '[{"ma":"gia","tien":"515000000.00"},{"ma":"chatluong","tien":null}]'],
      );
    });
    const kq = await withTenant(apiPool, orgA, (c) =>
      docBangXepHang(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(kq?.rows).toHaveLength(1);
    expect(kq?.rows[0]?.components).toEqual([
      { ma: "gia", donVi: "TIEN", heSo: null, giaTri: null, tien: "515000000.00" },
      { ma: "chatluong", donVi: "DIEM", heSo: null, giaTri: null, tien: null },
    ]);
  });

  it("phiên KHÔNG có `bid.view` ⇒ `PermissionDeniedError`, KHÔNG một hàng bảng nào đi ra, và ĐÚNG MỘT hàng sổ", async () => {
    const { rfqId } = await goiDaMo([["512000000.00", "VND"]]);
    await withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    const { rows: truoc } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED'",
      [orgA],
    );
    const loi = await withTenant(apiPool, orgA, (c) =>
      docBangXepHang(c, orgA, { rfqId, actorSessionId: sKhongXem }, apiPool).then(
        () => null,
        (e: unknown) => e,
      ),
    );
    // `REQUESTER` là một vai THẬT của `005` không giữ `bid.view` — khác `uKhong` (DIRECTOR), vai
    // duy nhất KHÔNG giữ `evaluation.perform`. Hai cổng, hai mã quyền, hai vai khác nhau.
    expect(loi).toBeInstanceOf(PermissionDeniedError);
    const { rows: sau } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED'",
      [orgA],
    );
    expect(Number(sau[0]?.n) - Number(truoc[0]?.n), "một lần từ chối phải để lại ĐÚNG MỘT hàng sổ (D5)").toBe(1);
    // [S1.107 / lượt soi ngang 77 — ②] Và hàng sổ ấy phải mang một CẶP khớp nhau. Trước vòng
    // này nó khai `resource_type = "RFQ_EVALUATION"` với `resource_id` là id của một
    // `rfq_packages` — ai nối `resource_id` sang `rfq_evaluations` được 0 hàng cho một sự kiện
    // CÓ THẬT. Khẳng định đọc CẢ HAI trường: chỉ đo `resource_type` thì một id sai vẫn lọt.
    const { rows: moi } = await db.pool.query<{ rt: string; ri: string | null }>(
      "SELECT resource_type AS rt, resource_id::text AS ri FROM audit_events " +
        "WHERE org_id = $1 AND action = 'PERMISSION_DENIED' ORDER BY seq DESC LIMIT 1",
      [orgA],
    );
    expect(moi[0]?.rt).toBe("RFQ");
    expect(moi[0]?.ri, "`resource_id` phải là chính gói thầu mà `resource_type` khai").toBe(rfqId);
  });

  it("tổ chức KHÁC hỏi đúng mã gói thầu ấy ⇒ `null`, không một hàng nào", async () => {
    const { rfqId } = await goiDaMo([["509000000.00", "VND"]]);
    await withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    // Bảy phép nối của câu đọc đều mang vế `org_id`; RLS là lớp thứ hai. Phép đo này đứng ở phía
    // NGƯỜI GỌI: một tổ chức khác, một phiên khác, đúng mã gói thầu của tổ chức A.
    const kq = await withTenant(apiPool, orgB, (c) =>
      docBangXepHang(c, orgB, { rfqId, actorSessionId: sB }, apiPool),
    );
    expect(kq).toBeNull();
  });

  it("bất biến A3 ĐO LẠI SAU KHI CÓ MỘT LƯỢT CHẤM: giá dạng rõ nay ở HAI bảng, không một", async () => {
    // TÊN TEST NÀY CỐ Ý KHÔNG MANG NHÃN trong ngoặc vuông, và đó là vế thứ hai của cùng một sự
    // cẩn thận: `tools/inv-matrix/src/so-khai-nhan.ts` không khai tệp này cho A3 (nên một nhãn ở
    // đây CHẶN MERGE ở lượt evidence), và tệ hơn — một test TÊN là A3 mà XANH sẽ ghi một dòng
    // `passed` vào hàng của A3 trong khi nó khẳng định A3 SAI.
    //
    // KHÔNG phải một lời chúc phúc cho hai bảng. Đây là một cái ĐINH GHIM VÀO THỰC TẠI, và nó
    // mâu thuẫn với lời khai của bất biến A3 mà `apps/unseal-worker/src/kich-ban-41-http.int.test.ts`
    // bước 14 đo: *"giá dạng rõ chỉ tồn tại ở ĐÚNG MỘT bảng"*. Lời khai ấy vẫn XANH ở đó chỉ vì
    // kịch bản ấy không chấm thầu lần nào — tức cổng ĐÚNG, nhưng nó đứng ở một thế giới không có
    // lượt chấm. `057` (S2.3, đã merge) dựng chỗ ở thứ hai cho một con giá dạng rõ, và vòng này
    // là vòng đầu tiên NHÌN THẤY nó.
    //
    // Tập được viết VÉT CẠN và CHÍNH XÁC: dù chủ dự án chọn hướng nào, dòng này cũng đỏ và buộc
    // người sửa đọc lại quyết định. Xem khoản 224 — ĐANG MỞ, chờ quyết định của chủ dự án.
    const GIA = "777123456.00";
    const { rfqId } = await goiDaMo([[GIA, "VND"]]);
    await withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool));
    const { rows: bang } = await db.pool.query<{ ten: string }>(
      "SELECT c.relname AS ten FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname",
    );
    expect(bang.length, "chống rỗng ruột: không đọc được bảng nào").toBeGreaterThan(20);
    const dinh: string[] = [];
    for (const b of bang) {
      if (!/^[a-z_][a-z0-9_]*$/u.test(b.ten)) throw new Error(`ten bang la: ${b.ten}`);
      const { rows } = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${b.ten} t WHERE t::text LIKE '%' || $1 || '%'`,
        [GIA],
      );
      if (rows[0]?.n !== "0") dinh.push(b.ten);
    }
    expect(dinh).toEqual(["rfq_evaluation_lines", "rfq_unsealed_bids"]);
  });
});

// ==============================================================================================
// [S1.108 / S2.5] VÒNG BAFO — BỐN CẠNH, VÀ TOP-N SUY TỪ `rank`
//
// Khối này ở ĐÂY chứ không ở một tệp riêng vì fixture của nó CHÍNH LÀ fixture ở trên: một vòng
// BAFO bắt đầu ở `EVALUATING`, tức ở đúng chỗ `taoLuotDanhGia` vừa để gói thầu lại. Một tệp
// riêng sẽ phải chép hai trăm dòng giàn cảnh để đo đúng những thứ này.
//
// Bốn cạnh được đo ở tầng HÀNH VI, không ở tầng văn bản: `transitions.test.ts` đã so bảng cạnh TS
// với bảng cạnh SQL, còn ở đây từng cạnh được ĐI QUA trên một cụm Postgres thật, dưới vai ứng
// dụng thật, với đủ trigger `ENABLE ALWAYS`.
// ==============================================================================================

/** Một gói thầu đã chấm xong, sẵn sàng mở vòng BAFO. Trả về đủ thứ cho phần còn lại. */
async function daCham(
  soTien: readonly (readonly [string, string | null])[],
  topN: number,
): Promise<{
  readonly rfqId: string;
  readonly banRo: readonly string[];
  readonly luotId: string;
  readonly hang: ReadonlyMap<string, number | null>;
}> {
  const { rfqId, banRo } = await goiDaMo(soTien, TP_GIA, topN);
  const kq = await withTenant(apiPool, orgA, (c) =>
    taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
  );
  return {
    rfqId,
    banRo,
    luotId: kq.evaluationId,
    hang: new Map(kq.lines.map((l) => [l.bidVersionId, l.rank])),
  };
}

describe("[S1.108 / S2.5] vòng BAFO đi trọn bốn cạnh", { timeout: 300000 }, () => {
  it("EVALUATING -> BAFO_OPEN -> BAFO_CLOSED -> BAFO_UNSEALED -> EVALUATING, và lượt chấm THỨ HAI ra đời", async () => {
    const { rfqId, banRo, luotId, hang } = await daCham(
      [
        ["548800000.00", "VND"],
        ["537600000.00", "VND"],
        ["544000000.00", "VND"],
      ],
      2,
    );
    // Tiền đề của mọi thứ dưới đây: hạng 1 và 2 là hai báo giá THẤP nhất, hạng 3 là cái cao nhất.
    expect(
      [banRo[0], banRo[1], banRo[2]].map((id) => hang.get(id ?? "")),
      "tiền đề hỏng thì mọi khẳng định dưới vô nghĩa",
    ).toEqual([3, 1, 2]);

    const vongId = await moVongBafo(rfqId, luotId, 2);
    expect(await trangThaiRfq(rfqId)).toBe("BAFO_OPEN");
    const { rows: v } = await db.pool.query<{ round_no: number; closed_at: Date | null }>(
      "SELECT round_no, closed_at FROM rfq_bafo_rounds WHERE id = $1",
      [vongId],
    );
    expect(v[0]?.round_no, "số vòng là DẪN XUẤT, do trigger đặt").toBe(1);
    expect(v[0]?.closed_at).toBeNull();

    // Hai nhà cung cấp TRONG top-2 nộp lại. Giá hạ.
    const lai1 = await nopLaiBafo(rfqId, banRo[1] ?? "");
    const lai2 = await nopLaiBafo(rfqId, banRo[2] ?? "");
    const { rows: dau } = await db.pool.query<{ bafo_round_id: string | null }>(
      "SELECT bafo_round_id FROM vendor_bid_versions WHERE id = ANY($1::uuid[])",
      [[lai1, lai2]],
    );
    expect(
      dau.map((r) => r.bafo_round_id),
      "C1 đặt dấu vòng cho mọi phiên bản nộp ở BAFO_OPEN",
    ).toEqual([vongId, vongId]);
    const { rows: cu } = await db.pool.query<{ bafo_round_id: string | null }>(
      "SELECT bafo_round_id FROM vendor_bid_versions WHERE id = $1",
      [banRo[1] ?? ""],
    );
    expect(cu[0]?.bafo_round_id, "phiên bản vòng MỘT không mang dấu vòng nào").toBeNull();

    const ycBafo = await moThauBafo(rfqId, vongId, [
      [lai1, { totalAmount: "500000000.00", currency: "VND" }],
      [lai2, { totalAmount: "530000000.00", currency: "VND" }],
    ]);
    expect(await trangThaiRfq(rfqId)).toBe("BAFO_UNSEALED");
    const { rows: ycv } = await db.pool.query<{ bafo_round_id: string | null }>(
      "SELECT bafo_round_id FROM unseal_requests WHERE id = $1",
      [ycBafo],
    );
    expect(ycv[0]?.bafo_round_id, "C3 gắn yêu cầu mở thầu vào ĐÚNG vòng nó mở").toBe(vongId);

    // Chấm LẠI: cạnh `BAFO_UNSEALED->EVALUATING`.
    const kq2 = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(await trangThaiRfq(rfqId)).toBe("EVALUATING");
    expect(kq2.evaluationId, "một lượt chấm THỨ HAI, không phải lượt cũ sửa lại").not.toBe(luotId);
    const hang2 = new Map(kq2.lines.map((l) => [l.bidVersionId, l.rank]));
    expect(hang2.get(lai1), "500 triệu là giá thấp nhất sau vòng hai").toBe(1);
    // MỘT hàng cho MỘT nhà cung cấp — BA, không NĂM. `rfq_unsealed_bids` lúc này có 3 hàng của
    // vòng một CỘNG 2 hàng của vòng hai, và một phép đọc "mọi hàng" sẽ xếp hạng hai nhà cung cấp
    // top-N HAI LẦN, một lần với giá cũ. Đây là vế mà `docBaoGia` vừa được sửa để giữ.
    expect(kq2.lines, "một luồng báo giá cho ĐÚNG một hàng xếp hạng").toHaveLength(3);
    const { rows: soBanRo } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_unsealed_bids u JOIN vendor_bid_versions v " +
        "ON v.id = u.bid_version_id JOIN vendor_bids b ON b.id = v.bid_id " +
        "JOIN rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1",
      [rfqId],
    );
    expect(soBanRo[0]?.n, "tiền đề: bảng bản rõ THẬT SỰ có năm hàng — nếu không, ca trên rỗng ruột").toBe("5");
    // Nhà cung cấp NGOÀI top-2 vẫn đứng trong bảng, với giá vòng MỘT của họ. BAFO cải thiện giá
    // của top-N; nó không loại ai khỏi cuộc thi.
    expect(hang2.get(banRo[0] ?? ""), "báo giá 548,8 triệu của vòng một vẫn xếp hạng, và đứng cuối").toBe(3);
    const { rows: soLuot } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_evaluations WHERE rfq_id = $1",
      [rfqId],
    );
    expect(soLuot[0]?.n, "hàng cũ Ở LẠI nguyên vẹn — spec §4.3").toBe("2");
  });

  it("nhà cung cấp NGOÀI top-N không nộp được, và thông điệp nói đúng lý do", async () => {
    const { rfqId, banRo, luotId, hang } = await daCham(
      [
        ["548800000.00", "VND"],
        ["537600000.00", "VND"],
        ["544000000.00", "VND"],
      ],
      2,
    );
    expect(hang.get(banRo[0] ?? ""), "báo giá cao nhất đứng hạng 3").toBe(3);
    await moVongBafo(rfqId, luotId, 2);
    await expect(nopLaiBafo(rfqId, banRo[0] ?? "")).rejects.toThrow(/khong nam trong top-N/u);
    // ĐỐI CHỨNG DƯƠNG: cùng lúc ấy, hạng 1 nộp được. Không có vế này, ca trên xanh y hệt với một
    // trigger từ chối MỌI lần nộp BAFO.
    await expect(nopLaiBafo(rfqId, banRo[1] ?? "")).resolves.toBeTruthy();
  });

  it("[CAO ③] yêu cầu mở thầu của VÒNG MỘT không mở được phong bì vòng hai", async () => {
    const { rfqId, banRo, luotId } = await daCham(
      [
        ["100.00", "VND"],
        ["200.00", "VND"],
      ],
      2,
    );
    const vongId = await moVongBafo(rfqId, luotId, 2);
    await nopLaiBafo(rfqId, banRo[0] ?? "");
    await withTenant(apiPool, orgA, async (c) => {
      await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vongId]);
      await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfqId]);
    });
    // Yêu cầu của vòng MỘT vẫn ở `EXECUTED` và vẫn thuộc đúng RFQ này — thân hàm của `019` chỉ
    // đếm "có yêu cầu APPROVED/EXECUTED nào cho RFQ này không", nên trước `059` câu dưới ĐI QUA.
    const { rows: cu } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM unseal_requests WHERE rfq_id = $1 AND bafo_round_id IS NULL " +
        "AND status IN ('APPROVED', 'EXECUTED')",
      [rfqId],
    );
    expect(cu[0]?.n, "tiền đề: yêu cầu vòng một CÓ THẬT và vẫn được phê duyệt").toBe("1");
    await expect(
      withTenant(unsealPool, orgA, (c) =>
        c.query("UPDATE rfq_packages SET status = 'BAFO_UNSEALED' WHERE id = $1", [rfqId]),
      ),
    ).rejects.toThrow(/yeu cau mo thau CUA VONG AY/u);
  });

  it("dấu vòng KHÔNG khai được: `app_api` không có INSERT trên `bafo_round_id`", async () => {
    const { rfqId, banRo, luotId } = await daCham(
      [
        ["100.00", "VND"],
        ["200.00", "VND"],
      ],
      2,
    );
    const vongId = await moVongBafo(rfqId, luotId, 2);
    const luong = LUONG_CUA_PHIEN_BAN.get(banRo[0] ?? "");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id, bafo_round_id) " +
            "VALUES ($1, $2, $3, $4, $5)",
          [orgA, luong?.bidId ?? "", Buffer.alloc(64, 3), luong?.phienKhach ?? "", vongId],
        ),
      ),
    ).rejects.toThrow(/permission denied for (table|column)/u);
  });
});

describe("[S1.108 / S2.5] một vòng BAFO hợp lệ, và nó chỉ đóng được một lần", { timeout: 300000 }, () => {
  it("RFQ không ở EVALUATING thì không mở được vòng nào", async () => {
    const { rfqId, csId } = await goiDaMo([["100.00", "VND"]], TP_GIA, 1);
    // Gói này còn ở `UNSEALED` — chưa chấm.
    expect(await trangThaiRfq(rfqId)).toBe("UNSEALED");
    const { rows: l } = await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) " +
        "VALUES ($1, $2, $3, 'VND', $4, $5) RETURNING id",
      [orgA, rfqId, csId, uYc, sYc],
    );
    await expect(moVongBafo(rfqId, l[0]?.id ?? "", 1)).rejects.toThrow(
      /Chi mo duoc vong BAFO khi RFQ dang o EVALUATING/u,
    );
  });

  it("lượt đánh giá của gói thầu KHÁC bị từ chối — khoá ngoại hợp thành không bắt được ca này", async () => {
    const a = await daCham([["100.00", "VND"]], 1);
    const b = await daCham([["100.00", "VND"]], 1);
    // `b.luotId` cùng TỔ CHỨC nên khoá ngoại `(org_id, evaluation_id)` đi qua; thứ chặn là trigger.
    await expect(moVongBafo(a.rfqId, b.luotId, 1)).rejects.toThrow(/khong thuoc RFQ/u);
    // ĐỐI CHỨNG DƯƠNG: lượt của chính nó thì mở được.
    await expect(moVongBafo(a.rfqId, a.luotId, 1)).resolves.toBeTruthy();
  });

  it.each([
    ["top_n LỚN hơn chính sách", 3],
    ["top_n NHỎ hơn chính sách", 1],
  ])("%s ⇒ ném", async (_ten, topN) => {
    const { rfqId, luotId } = await daCham(
      [
        ["100.00", "VND"],
        ["200.00", "VND"],
      ],
      2,
    );
    await expect(moVongBafo(rfqId, luotId, topN)).rejects.toThrow(
      new RegExp(`top_n cua vong \\(${String(topN)}\\) khac bafo_top_n cua chinh sach \\(2\\)`, "u"),
    );
  });

  it("hạn nộp trong vòng một giờ tới ⇒ ném; hạn xa hơn thì đi qua", async () => {
    const { rfqId, luotId } = await daCham([["100.00", "VND"]], 1);
    await expect(moVongBafo(rfqId, luotId, 1, new Date(Date.now() + 30 * 60 * 1000))).rejects.toThrow(
      /Cua so BAFO phai con it nhat/u,
    );
    await expect(
      moVongBafo(rfqId, luotId, 1, new Date(Date.now() + 90 * 60 * 1000)),
    ).resolves.toBeTruthy();
  });

  it("`round_no` đếm 1 rồi 2, và vòng thứ hai không mở được khi vòng một chưa đóng", async () => {
    const { rfqId, banRo, luotId } = await daCham(
      [
        ["100.00", "VND"],
        ["200.00", "VND"],
      ],
      2,
    );
    const v1 = await moVongBafo(rfqId, luotId, 2);
    // Hai lớp cùng nói không, và lớp nào nói TRƯỚC thì thông điệp là của lớp ấy:
    // `bafo_kiem_vong` đòi RFQ ở `EVALUATING`, mà nó đang `BAFO_OPEN`.
    await expect(moVongBafo(rfqId, luotId, 2)).rejects.toThrow(/EVALUATING/u);
    // Đi trọn vòng một để về `EVALUATING`, rồi mở vòng HAI: `round_no` phải là 2.
    const lai = await nopLaiBafo(rfqId, banRo[0] ?? "");
    await moThauBafo(rfqId, v1, [[lai, { totalAmount: "90.00", currency: "VND" }]]);
    const kq2 = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    const v2 = await moVongBafo(rfqId, kq2.evaluationId, 2);
    const { rows } = await db.pool.query<{ round_no: number }>(
      "SELECT round_no FROM rfq_bafo_rounds WHERE id = $1",
      [v2],
    );
    expect(rows[0]?.round_no).toBe(2);
  });

  it.each([
    ["mở lại một vòng đã đóng", "UPDATE rfq_bafo_rounds SET closed_at = NULL WHERE id = $1"],
    [
      "dời hạn nộp của một vòng",
      "UPDATE rfq_bafo_rounds SET deadline_at = now() + interval '9 days' WHERE id = $1",
    ],
    ["xoá một vòng", "DELETE FROM rfq_bafo_rounds WHERE id = $1"],
  ])("%s ⇒ ném, kể cả dưới vai SỞ HỮU bảng", async (ten, cau) => {
    const mau =
      ten === "mở lại một vòng đã đóng"
        ? /da dong thi khong mo lai duoc/u
        : ten === "dời hạn nộp của một vòng"
          ? /Chi sua duoc closed_at/u
          : /Khong duoc xoa mot vong BAFO/u;
    const { rfqId, luotId } = await daCham([["100.00", "VND"]], 1);
    const vongId = await moVongBafo(rfqId, luotId, 1);
    await db.pool.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vongId]);
    // `db.pool` chạy dưới vai SỞ HỮU bảng, thứ mà GRANT không chặn. Đây là lý do ba vế trên là
    // TRIGGER chứ không phải ba dòng GRANT vắng mặt.
    await expect(db.pool.query(cau, [vongId])).rejects.toThrow(mau);
  });

  it("yêu cầu mở thầu vòng BAFO KHÔNG tạo được khi yêu cầu vòng một còn đang mở", async () => {
    // Phát hiện của chính vòng này, ghim lại thay vì để nó sống trong một fixture. Chỉ mục bộ
    // phận `unseal_requests_mot_yeu_cau_dang_mo` (`019:73`) nói *"một RFQ có TỐI ĐA MỘT yêu cầu
    // đang mở"*, với `đang mở` = `status IN ('PENDING', 'APPROVED')`. Nó có từ `019` và chưa từng
    // bị một kịch bản nào chạm, vì cho tới S2.5 không gói thầu nào cần mở thầu LẦN HAI.
    //
    // Hệ quả cho S1.109, nói ra ở đây vì đây là chỗ nó ĐO được: đường sản xuất mở vòng BAFO phải
    // đi SAU khi worker đã đặt `EXECUTED` cho yêu cầu vòng một. Không phải một giới hạn cần gỡ —
    // nó chính là vế D2 mà `019` đã ghi: hai yêu cầu cùng mở thì ngưỡng "hai người khác nhau" bị
    // CHIA ĐÔI thay vì bị thoả.
    const { rfqId, banRo, luotId } = await daCham([["100.00", "VND"]], 1);
    const vongId = await moVongBafo(rfqId, luotId, 1);
    await nopLaiBafo(rfqId, banRo[0] ?? "");
    await withTenant(apiPool, orgA, async (c) => {
      await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vongId]);
      await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfqId]);
    });
    // Đẩy yêu cầu vòng một NGƯỢC về `APPROVED` — trạng thái mà fixture cũ để nó ở suốt hai vòng.
    // `unseal_kiem_chuyen_trang_thai` (`055`) chặn đúng chiều ấy (*"EXECUTED -> APPROVED"*), và đó
    // là một lớp ĐÚNG — nên nó được tắt cho ĐÚNG một câu rồi bật lại trong `finally`, khuôn mà
    // `db/hardening-suy-tu-tinh-chat.int.test.ts` dùng cho mọi đột biến lớp CSDL. Thứ đang được đo
    // ở đây là chỉ mục bộ phận, không phải máy trạng thái của yêu cầu.
    await db.pool.query(
      "ALTER TABLE unseal_requests DISABLE TRIGGER unseal_requests_kiem_chuyen_trang_thai",
    );
    try {
      await db.pool.query(
        "UPDATE unseal_requests SET status = 'APPROVED', executed_at = NULL " +
          "WHERE rfq_id = $1 AND bafo_round_id IS NULL",
        [rfqId],
      );
    } finally {
      await db.pool.query(
        "ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_kiem_chuyen_trang_thai",
      );
    }
    await expect(
      withTenant(apiPool, orgA, (c) =>
        requestUnseal(c, orgA, { rfqId, reason: "mo vong hai", actorSessionId: sYc }, apiPool),
      ),
    ).rejects.toThrow(/unseal_requests_mot_yeu_cau_dang_mo/u);
    // ĐỐI CHỨNG DƯƠNG: đặt lại `EXECUTED` thì yêu cầu thứ hai tạo được.
    await db.pool.query(
      "UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() " +
        "WHERE rfq_id = $1 AND bafo_round_id IS NULL",
      [rfqId],
    );
    const yc2 = await withTenant(apiPool, orgA, (c) =>
      requestUnseal(c, orgA, { rfqId, reason: "mo vong hai", actorSessionId: sYc }, apiPool),
    );
    const { rows } = await db.pool.query<{ bafo_round_id: string | null }>(
      "SELECT bafo_round_id FROM unseal_requests WHERE id = $1",
      [yc2.id],
    );
    expect(rows[0]?.bafo_round_id).toBe(vongId);
  });

  it("`TRUNCATE rfq_bafo_rounds` bị chặn ở CẢ HAI đường — không cần lớp thứ ba", async () => {
    // Tính chất, không cơ chế: đường trần bị khoá ngoại của `vendor_bid_versions` chặn, đường
    // CASCADE lan tới chính bảng ấy và đụng trigger `047`. Ngày nào khoá ngoại ấy đi, dòng này đỏ
    // và người sửa phải đọc lại mục (4) của `059`.
    await expect(db.pool.query("TRUNCATE public.rfq_bafo_rounds")).rejects.toThrow(
      /cannot truncate a table referenced in a foreign key constraint/u,
    );
    await expect(db.pool.query("TRUNCATE public.rfq_bafo_rounds CASCADE")).rejects.toThrow(
      /Bang vendor_bid_versions chi duoc ghi them/u,
    );
  });

  it("nộp báo giá khi RFQ đang EVALUATING ⇒ C1 từ chối bằng chính thông điệp cũ", async () => {
    const { rfqId, banRo } = await daCham([["100.00", "VND"]], 1);
    expect(await trangThaiRfq(rfqId)).toBe("EVALUATING");
    await expect(nopLaiBafo(rfqId, banRo[0] ?? "")).rejects.toThrow(
      /RFQ khong nhan bao gia khi dang o trang thai EVALUATING \(C1\)/u,
    );
  });

  it("nộp SAU hạn của vòng BAFO ⇒ C1 từ chối; hạn của vòng MỘT không còn liên quan", async () => {
    const { rfqId, banRo, luotId } = await daCham([["100.00", "VND"]], 1);
    const vongId = await moVongBafo(rfqId, luotId, 1, new Date(Date.now() + 90 * 60 * 1000));
    // Đẩy hạn về quá khứ dưới vai sở hữu — `bafo_kiem_vong` cấm cả vai ấy sửa `deadline_at`, nên
    // trigger phải được tắt trong đúng một câu. Đây là khuôn `db/hardening-suy-tu-tinh-chat` dùng
    // cho mọi đột biến lớp CSDL: tắt lúc chạy, `finally` bật lại.
    await db.pool.query("ALTER TABLE rfq_bafo_rounds DISABLE TRIGGER rfq_bafo_rounds_kiem_vong");
    try {
      await db.pool.query(
        "UPDATE rfq_bafo_rounds SET deadline_at = now() - interval '1 minute' WHERE id = $1",
        [vongId],
      );
    } finally {
      await db.pool.query(
        "ALTER TABLE rfq_bafo_rounds ENABLE ALWAYS TRIGGER rfq_bafo_rounds_kiem_vong",
      );
    }
    await expect(nopLaiBafo(rfqId, banRo[0] ?? "")).rejects.toThrow(/Da qua han nop bao gia \(C1\)/u);
    // Và hạn của RFQ vẫn ở TƯƠNG LAI — nên ca trên đo đúng hạn của VÒNG, không đo hạn của gói.
    const { rows } = await db.pool.query<{ con: boolean }>(
      "SELECT deadline_at > now() AS con FROM rfq_packages WHERE id = $1",
      [rfqId],
    );
    expect(rows[0]?.con, "hạn vòng một còn ở tương lai — MAI_SAU là bảy ngày").toBe(true);
  });
});

// ================================================================================================
// [S1.109 / S2.5 tầng người dùng] ĐƯỜNG SẢN XUẤT của bốn cạnh BAFO
//
// S1.108 chứng minh bốn cạnh ĐI TRỌN ĐƯỢC bằng cách chèn hàng thẳng dưới vai ứng dụng. Khoản
// **227** ghi rằng lúc ấy KHÔNG đường sản xuất nào đi qua chúng. Khối này đo chính các hàm mà
// route gọi — nên nó cũng đo những thứ fixture không có: cổng quyền, hàng sổ, và lối từ chối.
// ================================================================================================

describe("[S1.109 / S2.5] moVongBafo và dongVongBafo — hai cạnh đầu qua đường SẢN XUẤT", { timeout: 300000 }, () => {
  it("mở vòng: EVALUATING -> BAFO_OPEN, số vòng 1, top-N SUY từ chính sách, một hàng sổ", async () => {
    const { rfqId } = await daCham([["548800000.00", "VND"], ["537600000.00", "VND"], ["544000000.00", "VND"]], 2);

    const han = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const v = await withTenant(apiPool, orgA, (c) =>
      moVongBafoThat(c, orgA, { rfqId, deadlineAt: han, actorSessionId: sYc }, apiPool),
    );

    expect(v.roundNo).toBe(1);
    // `topN` KHÔNG do người gọi khai — nó suy từ `bafo_top_n` của phiên bản chính sách mà lượt
    // chấm đã tính dưới. `daCham(..., 2)` dựng chính sách với `bafo_top_n = 2`.
    expect(v.topN).toBe(2);
    expect(v.closedAt).toBeNull();
    expect(await trangThaiRfq(rfqId)).toBe("BAFO_OPEN");

    const { rows: so } = await db.pool.query<{ resource_id: string; payload: Record<string, unknown> }>(
      "SELECT resource_id, payload FROM audit_events WHERE org_id = $1 AND action = 'RFQ_BAFO_ROUND_OPENED'",
      [orgA],
    );
    expect(so).toHaveLength(1);
    expect(so[0]?.resource_id).toBe(v.bafoRoundId);
    expect(so[0]?.payload.rfqId).toBe(rfqId);
    expect(so[0]?.payload.topN).toBe(2);

    // Đường ĐỌC thấy đúng vòng vừa mở.
    const doc = await withTenant(apiPool, orgA, (c) => docVongBafo(c, orgA, rfqId));
    expect(doc?.bafoRoundId).toBe(v.bafoRoundId);
  });

  it("đóng vòng: BAFO_OPEN -> BAFO_CLOSED, `closed_at` của VÒNG được đặt — và `closed_at` của GÓI THẦU KHÔNG đổi", async () => {
    const { rfqId } = await daCham([["548800000.00", "VND"], ["537600000.00", "VND"]], 1);
    await withTenant(apiPool, orgA, (c) =>
      moVongBafoThat(c, orgA, { rfqId, deadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000), actorSessionId: sYc }, apiPool),
    );

    // TIỀN ĐỀ, đo trước: gói thầu ĐÃ CÓ một `closed_at` từ vòng một. Không có khẳng định này, ca
    // dưới xanh cả khi cột ấy vốn NULL — và lúc ấy nó không đo gì.
    const { rows: truoc } = await db.pool.query<{ closed_at: Date | null }>(
      "SELECT closed_at FROM rfq_packages WHERE id = $1", [rfqId],
    );
    expect(truoc[0]?.closed_at).not.toBeNull();

    const v = await withTenant(apiPool, orgA, (c) =>
      dongVongBafoThat(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(v.closedAt).not.toBeNull();
    expect(await trangThaiRfq(rfqId)).toBe("BAFO_CLOSED");

    // VẾ ĐÁNG GIÁ NHẤT của ca này: `closeRfq` ghi `rfq_packages.closed_at`, nên tham số hoá nó
    // cho BAFO sẽ GHI ĐÈ giờ đóng thầu vòng một — một sự thật kiểm toán. `dongVongBafo` là một
    // hàm riêng đúng vì thế.
    const { rows: sau } = await db.pool.query<{ closed_at: Date | null; early_close_reason: string | null }>(
      "SELECT closed_at, early_close_reason FROM rfq_packages WHERE id = $1", [rfqId],
    );
    expect(sau[0]?.closed_at?.toISOString()).toBe(truoc[0]?.closed_at?.toISOString());
  });

  it("cổng quyền `rfq.bafo.open`: một phiên KHÔNG có mã ấy bị từ chối, kể cả khi nó chấm thầu được", async () => {
    const { rfqId } = await daCham([["548800000.00", "VND"], ["537600000.00", "VND"]], 1);
    // `uKhong` là DIRECTOR — vai giữ `bid.view` và không giữ `evaluation.perform`; ADR-055 cho
    // `rfq.bafo.open` CHỈ `PROCUREMENT_MANAGER`, nên DIRECTOR không mở vòng được.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        moVongBafoThat(c, orgA, { rfqId, deadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000), actorSessionId: sKhong }, apiPool),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await trangThaiRfq(rfqId)).toBe("EVALUATING");
  });

  it("ba lối TỪ CHỐI CÓ TÊN — và cả ba là `VongBafoTuChoiError`, không một lỗi Postgres trần", async () => {
    // ⑴ sai trạng thái: gói thầu chưa chấm lần nào thì còn ở UNSEALED.
    const { rfqId: chuaCham } = await goiDaMo([["548800000.00", "VND"]], TP_GIA, 2);
    await expect(
      withTenant(apiPool, orgA, (c) =>
        moVongBafoThat(c, orgA, { rfqId: chuaCham, deadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000), actorSessionId: sYc }, apiPool),
      ),
    ).rejects.toThrow(/EVALUATING/u);

    // ⑵ chính sách TẮT BAFO (`bafo_top_n = 0` — quy ước của `056`).
    const { rfqId: tatBafo } = await daCham([["548800000.00", "VND"], ["537600000.00", "VND"]], 0);
    const loi = await withTenant(apiPool, orgA, (c) =>
      moVongBafoThat(c, orgA, { rfqId: tatBafo, deadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000), actorSessionId: sYc }, apiPool),
    ).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(VongBafoTuChoiError);
    expect((loi as VongBafoTuChoiError).lyDo).toBe("CHINH_SACH_TAT_BAFO");

    // ⑶ đóng một vòng khi không có vòng nào đang mở.
    const loi2 = await withTenant(apiPool, orgA, (c) =>
      dongVongBafoThat(c, orgA, { rfqId: tatBafo, actorSessionId: sYc }, apiPool),
    ).catch((e: unknown) => e);
    expect(loi2).toBeInstanceOf(VongBafoTuChoiError);
    expect((loi2 as VongBafoTuChoiError).lyDo).toBe("KHONG_CO_VONG_DANG_MO");
  });
});

// ================================================================================================
// [S1.109 / S2.5 / 060] VÒNG BAFO CHỈ TRỎ ĐƯỢC VÀO LƯỢT CHẤM MỚI NHẤT
//
// Lỗ mà lượt soi HÌNH DẠNG của vòng này tìm ra: `059` kiểm lượt đánh giá THUỘC ĐÚNG RFQ và khớp
// chính sách, nhưng KHÔNG đòi nó là lượt mới nhất — nên sau đúng một chu kỳ BAFO (lúc ấy có HAI
// lượt), vòng thứ hai mở được với lượt CŨ, tức mời top-N của bảng xếp hạng TRƯỚC BAFO.
//
// Ca này chèn hàng THẲNG dưới vai `app_api`, không qua `moVongBafoThat`: hàm ấy tự suy lượt mới
// nhất, nên đi qua nó thì lớp CSDL không bao giờ được hỏi. Đo lớp dưới thì phải gọi thẳng lớp dưới.
// ================================================================================================

describe("[S1.109 / S2.5 / 060] vòng BAFO trỏ vào lượt chấm CŨ bị CSDL từ chối", { timeout: 300000 }, () => {
  it("lượt CŨ bị từ chối, và ĐỐI CHỨNG DƯƠNG: cùng câu ấy với lượt MỚI NHẤT thì đi qua", async () => {
    // Một chu kỳ BAFO trọn vẹn để có HAI lượt chấm trên cùng một RFQ.
    const { rfqId, banRo, luotId: luot1 } = await daCham(
      [["548800000.00", "VND"], ["537600000.00", "VND"], ["544000000.00", "VND"]], 2,
    );
    const vong1 = await moVongBafo(rfqId, luot1, 2);
    const lai = await nopLaiBafo(rfqId, banRo[1] ?? "");
    await moThauBafo(rfqId, vong1, [[lai, { totalAmount: "500000000.00", currency: "VND" }]]);
    const kq2 = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    const luot2 = kq2.evaluationId;

    // TIỀN ĐỀ: hai lượt chấm KHÁC NHAU thật sự tồn tại cho cùng một RFQ. Thiếu khẳng định này,
    // ca dưới xanh cả khi `luot2 === luot1` — và lúc ấy nó không đo gì.
    expect(luot2).not.toBe(luot1);
    const { rows: dem } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_evaluations WHERE org_id = $1 AND rfq_id = $2", [orgA, rfqId],
    );
    expect(dem[0]?.n).toBe("2");
    expect(await trangThaiRfq(rfqId)).toBe("EVALUATING");

    const chen = async (luotId: string): Promise<string> => {
      const { rows: e } = await db.pool.query<{ policy_id: string }>(
        "SELECT policy_id FROM rfq_evaluations WHERE id = $1", [luotId],
      );
      return await withTenant(apiPool, orgA, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, " +
            "opened_by, opened_by_session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
          [orgA, rfqId, luotId, e[0]?.policy_id ?? "", 2, new Date(Date.now() + 3 * 24 * 3600 * 1000), uYc, sYc],
        );
        return rows[0]?.id ?? "";
      });
    };

    // VẾ ÂM — lượt CŨ.
    await expect(chen(luot1)).rejects.toThrow(/khong phai luot moi nhat/u);

    // ĐỐI CHỨNG DƯƠNG — cùng câu, cùng mọi tham số khác, chỉ đổi lượt. Không có vế này, ca trên
    // xanh cả khi câu INSERT hỏng vì một lý do khác hẳn.
    const vong2 = await chen(luot2);
    expect(vong2).not.toBe("");
    const { rows: v } = await db.pool.query<{ round_no: number; evaluation_id: string }>(
      "SELECT round_no, evaluation_id FROM rfq_bafo_rounds WHERE id = $1", [vong2],
    );
    expect(v[0]?.evaluation_id).toBe(luot2);
    expect(v[0]?.round_no).toBe(2);
  });
});

// ================================================================================================
// [S1.110 / S2.6] TRAO THẦU — ĐƯỜNG HỢP LỆ, VÀ BA BẤT BIẾN MỚI ĐO TỪNG VẾ MỘT
//
// Khối này ở ĐÂY vì fixture của nó CHÍNH LÀ fixture ở trên — một award bắt đầu ở `EVALUATING`,
// tức ở đúng chỗ `taoLuotDanhGia` để gói thầu lại, và nó cần cả một chu kỳ BAFO để đo vế *lượt
// chấm mới nhất*. Cùng lập luận mà khối `[S1.108]` đã viết ra.
//
// ~~**KHÔNG mang nhãn `[INV-*]`**, và đó là cố ý, cùng lý do khối đầu tệp đã ghi: dải mã bất biến
// ghim `[A-H]` ở TÁM chỗ nên nhóm **J** chưa có ô nào để ghi một dòng `passed` vào (khoản **229**).
// Ba bất biến dưới đây có phép ĐO, có đối chứng DƯƠNG và có đột biến; thứ chúng chưa có là một ô
// trong ma trận, và mở ô ấy là một vòng riêng.~~
//
// **[S1.115 / khoản 229] ĐÃ MỞ Ô, và HAI câu vừa gạch đều bị phép đo bác.** ⑴ Con số *TÁM chỗ* là
// của hàng 229 và nó SAI: đo trên `master` ngày 2026-09-23 ra **MƯỜI**, nay đã nới cả mười sang
// `[A-HJ]`. ⑵ Câu *"ba bất biến dưới đây ... có đột biến"* đúng cho J3 và SAI cho J5 và J7: quét mọi
// `DISABLE TRIGGER`/`DROP TRIGGER` trong test, `rfq_awards_kiem_de_xuat` và
// `rfq_awards_kiem_mot_award_song` KHÔNG bị gỡ ở một ca nào. Thứ hai bất biến ấy thật sự có là ca
// `INSERT` THẲNG — nó chứng minh *trigger là lớp giữ*, khác hẳn *gỡ lớp ra thì thủng*. Hai đột biến
// còn thiếu viết ở cuối mỗi khối, và chỉ SAU đó ô ma trận mới mở.
//
// ------------------------------------------------------------------------------------------------
// PHẠM VI THẬT CỦA TỪNG VẾ, ĐO CHỨ KHÔNG KHAI
// ------------------------------------------------------------------------------------------------
// **J3** có BA vế và chúng không cùng độ chắc: vế *người tạo RFQ* và vế *người duyệt ≠ người đề
// xuất* đọc dữ liệu đủ để phán xử; ~~vế *người điều phối* đọc `unseal_requests.dispatched_by`, cột
// mang người của lần điều phối ĐANG CHẠY — nên sau một lần điều phối lại nó không thấy người đầu
// (khoản **233**). Ca dưới đo đúng thứ vế ấy CÓ, không đo thứ nó không có.~~ **[S1.122 / khoản 233
// ĐÓNG]** vế *người điều phối* nay đọc `unseal_dispatch_history` (`064`), và ba ca mới đo nó qua một
// lần điều phối lại: chặn, đối chứng dương, đột biến gỡ lớp ghi.
//
// **J5** có vế CẤU TRÚC (khoá ngoại hợp thành) và vế NỘI DUNG (`effective_cost` đọc được + lượt
// chấm thuộc đúng RFQ). Vế cấu trúc không cần ca riêng — nó là một khoá ngoại; hai vế nội dung
// thì cần, và vế *thuộc đúng RFQ* chỉ tới được bằng một câu `INSERT` thẳng vì `deXuatTraoThau` tự
// suy lượt chấm.
//
// **J7** là một trigger đọc hàng mới nhất dưới khoá tư vấn. Ca *hai award cùng sống* đo nó qua
// đường sản xuất; ba ca chuỗi (`APPROVED` không chữ ký, `APPROVED` đổi báo giá, huỷ hai lần) chỉ
// tới được bằng câu `INSERT` thẳng, vì lớp gói không viết ra được những hàng ấy.
// ================================================================================================

/** Một gói thầu đã chấm xong và ĐANG Ở `EVALUATING` — sẵn sàng cho một đề xuất trao thầu. */
async function sanSangTraoThau(
  soTien: readonly (readonly [string, string | null])[] = [
    ["548800000.00", "VND"],
    ["537600000.00", "VND"],
    ["544000000.00", "VND"],
  ],
): Promise<{ readonly rfqId: string; readonly banRo: readonly string[]; readonly luotId: string }> {
  const { rfqId, banRo, luotId } = await daCham(soTien, 0);
  expect(await trangThaiRfq(rfqId), "tiền đề: gói thầu phải đang ở EVALUATING").toBe("EVALUATING");
  return { rfqId, banRo, luotId };
}

/**
 * Chèn một hàng `rfq_awards` THẲNG dưới vai `app_api`, bỏ qua lớp gói.
 *
 * Ba ca chuỗi của J7 và vế *lượt chấm thuộc đúng RFQ* của J5 KHÔNG tới được qua `deXuatTraoThau`
 * / `duyetTraoThau`: lớp gói tự suy `evaluation_id`, tự chép `bid_version_id` và tự ghi chữ ký
 * trước hàng `APPROVED`. Đo lớp dưới thì phải gọi thẳng lớp dưới — cùng khuôn ca `060` ở trên.
 */
async function chenAwardTho(cot: {
  readonly rfqId: string;
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly status: string;
  readonly actedBy: string;
  readonly actedBySessionId: string;
  readonly reason?: string;
}): Promise<string> {
  return await withTenant(apiPool, orgA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO rfq_awards (org_id, rfq_id, evaluation_id, bid_version_id, status, reason, " +
        "acted_by, acted_by_session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
      [
        orgA,
        cot.rfqId,
        cot.evaluationId,
        cot.bidVersionId,
        cot.status,
        cot.reason ?? "cau INSERT thang de do tang CSDL",
        cot.actedBy,
        cot.actedBySessionId,
      ],
    );
    return rows[0]?.id ?? "";
  });
}

/** Mọi hàng award của một gói thầu, theo đúng thứ tự mà `award_kiem_mot_award_song` đọc. */
async function hangAward(rfqId: string): Promise<readonly { status: string; acted_by: string }[]> {
  const { rows } = await db.pool.query<{ status: string; acted_by: string }>(
    "SELECT status, acted_by FROM rfq_awards WHERE org_id = $1 AND rfq_id = $2 " +
      "ORDER BY acted_at ASC, id ASC",
    [orgA, rfqId],
  );
  return rows;
}

async function hangSoCuaAward(rfqId: string, action: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 " +
      "AND payload->>'rfqId' = $3",
    [orgA, action, rfqId],
  );
  return Number(rows[0]?.n ?? "0");
}

describe("[S1.110 / S2.6] trao thầu đi trọn chuỗi PROPOSED → APPROVED → CANCELLED", { timeout: 300000 }, () => {
  it("đề xuất ⇒ RFQ sang AWARDED, lượt chấm được SUY, một hàng sổ", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    const kq = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c,
        orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "gia thap nhat, ky thuat dat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    expect(kq.status).toBe("PROPOSED");
    expect(kq.bidVersionId).toBe(banRo[1]);
    // Lượt chấm KHÔNG do người gọi khai — nó được suy, và đây là lớp DUY NHẤT canh vế ấy.
    expect(kq.evaluationId, "award phải nói ra nó dựa trên lượt chấm NÀO").toBe(luotId);
    expect(kq.actedBy).toBe(uDeXuat);
    expect(kq.reason).toBe("gia thap nhat, ky thuat dat");

    expect(await trangThaiRfq(rfqId), "`AWARDED` nghĩa là ĐANG CÓ một award còn sống").toBe("AWARDED");
    expect(await hangSoCuaAward(rfqId, "RFQ_AWARD_PROPOSED")).toBe(1);
    expect((await hangAward(rfqId)).map((h) => h.status)).toEqual(["PROPOSED"]);
  });

  it("phê duyệt ⇒ một chữ ký, một hàng APPROVED, và RFQ ĐỨNG YÊN ở AWARDED", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "gia thap nhat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    const duyet = await withTenant(apiPool, orgA, (c) =>
      duyetTraoThau(c, orgA, { rfqId, awardId: dx.awardId, actorSessionId: sDuyet }, apiPool),
    );
    expect(duyet.status).toBe("APPROVED");
    expect(duyet.actedBy).toBe(uDuyet);
    // Hàng `APPROVED` chép ĐÚNG báo giá của đề xuất — `award_kiem_mot_award_song` đòi vế này.
    expect([duyet.evaluationId, duyet.bidVersionId]).toEqual([dx.evaluationId, dx.bidVersionId]);
    expect(await trangThaiRfq(rfqId), "duyệt KHÔNG đổi trạng thái RFQ — nó đã ở AWARDED").toBe("AWARDED");

    const { rows: ck } = await db.pool.query<{ approver_user_id: string }>(
      "SELECT approver_user_id FROM rfq_award_approvals WHERE org_id = $1 AND award_id = $2",
      [orgA, dx.awardId],
    );
    expect(ck.map((r) => r.approver_user_id)).toEqual([uDuyet]);
    expect(await hangSoCuaAward(rfqId, "RFQ_AWARD_APPROVED")).toBe(1);

    // Đường ĐỌC thấy hàng mới nhất CỘNG chữ ký của đề xuất mà nó nối vào.
    const doc = await withTenant(apiPool, orgA, (c) =>
      docTraoThau(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(doc?.status).toBe("APPROVED");
    expect(doc?.approvals.map((a) => a.approverUserId)).toEqual([uDuyet]);
  });

  it("[INV-J7] huỷ ⇒ RFQ về EVALUATING, và một đề xuất MỚI đi được (J7 mở lại sau CANCELLED)", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "gia thap nhat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    await withTenant(apiPool, orgA, (c) =>
      duyetTraoThau(c, orgA, { rfqId, awardId: dx.awardId, actorSessionId: sDuyet }, apiPool),
    );
    const huy = await withTenant(apiPool, orgA, (c) =>
      huyTraoThau(c, orgA, { rfqId, reason: "ncc rut lai cam ket giao hang", actorSessionId: sDuyet }, apiPool),
    );
    expect(huy.status).toBe("CANCELLED");
    expect(huy.reason).toBe("ncc rut lai cam ket giao hang");
    expect(await trangThaiRfq(rfqId), "§8.3 chốt 2026-09-22: AWARDED->EVALUATING").toBe("EVALUATING");
    expect(await hangSoCuaAward(rfqId, "RFQ_AWARD_CANCELLED")).toBe(1);

    // CHỈ-GHI-THÊM: ba hàng còn nguyên, không hàng nào bị sửa. Đây là vế đo được của §2.3⑹ —
    // câu *ai huỷ, lúc nào, vì sao* trả lời được từ chính bảng.
    expect((await hangAward(rfqId)).map((h) => h.status)).toEqual(["PROPOSED", "APPROVED", "CANCELLED"]);

    // ...và ĐỐI CHỨNG DƯƠNG cho vế J7 *hàng mới nhất đã huỷ thì đề xuất lại được*.
    const lai = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[2] ?? "", reason: "chuyen sang ncc thu hai", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    expect(lai.status).toBe("PROPOSED");
    expect(lai.bidVersionId).toBe(banRo[2]);
    expect(await trangThaiRfq(rfqId)).toBe("AWARDED");
  });

  it("lượt chấm được suy là lượt MỚI NHẤT — đo sau một chu kỳ BAFO, nơi có HAI lượt", async () => {
    // Vế này là lớp DUY NHẤT: `award_kiem_de_xuat` đòi lượt chấm THUỘC ĐÚNG RFQ, không đòi nó mới
    // nhất. Nên nếu câu `ORDER BY e.created_at DESC` của `deXuatTraoThau` sai, KHÔNG lớp nào kêu.
    const { rfqId, banRo, luotId: luot1 } = await daCham(
      [["548800000.00", "VND"], ["537600000.00", "VND"], ["544000000.00", "VND"]], 2,
    );
    const vong1 = await moVongBafo(rfqId, luot1, 2);
    const lai = await nopLaiBafo(rfqId, banRo[1] ?? "");
    await moThauBafo(rfqId, vong1, [[lai, { totalAmount: "500000000.00", currency: "VND" }]]);
    const kq2 = await withTenant(apiPool, orgA, (c) =>
      taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool),
    );
    expect(kq2.evaluationId, "tiền đề: phải có HAI lượt chấm khác nhau").not.toBe(luot1);

    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: lai, reason: "gia BAFO thap nhat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    expect(dx.evaluationId, "award phải dựa trên bảng xếp hạng SAU BAFO").toBe(kq2.evaluationId);
  });
});

describe("[S1.110 / S2.6] J3 — ba vế, và mỗi vế một câu gọi tên", { timeout: 300000 }, () => {
  it("[INV-J3] vế 2 — NGƯỜI TẠO gói thầu không đề xuất được trao thầu cho chính gói ấy", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    // `uYc` là `created_by` của mọi RFQ mà fixture dựng, và họ giữ `award.recommend`
    // (PROCUREMENT_MANAGER) — nên cổng QUYỀN cho họ đi qua, và thứ chặn là trigger đọc HÀNH VI.
    const { rows: tao } = await db.pool.query<{ created_by: string }>(
      "SELECT created_by FROM rfq_packages WHERE id = $1", [rfqId],
    );
    expect(tao[0]?.created_by, "tiền đề của ca này").toBe(uYc);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[1] ?? "", reason: "tu tao tu de xuat", actorSessionId: sYc },
          apiPool,
        ),
      ),
    ).rejects.toThrow(/Nguoi tao goi thau khong duoc de xuat trao thau/u);

    // Và gói thầu KHÔNG đổi trạng thái — câu `UPDATE` đứng SAU câu `INSERT`, nên một trigger nổ
    // ở `INSERT` phải để lại đúng trạng thái cũ. Thiếu khẳng định này, một thứ tự ngược lại sẽ
    // để RFQ ở `AWARDED` mà không award nào tồn tại.
    expect(await trangThaiRfq(rfqId)).toBe("EVALUATING");
    expect(await hangAward(rfqId)).toEqual([]);
  });

  it("[INV-J3] vế 3 — NGƯỜI ĐIỀU PHỐI mở thầu cũng không — và vế ấy chỉ thấy lần điều phối ĐANG CHẠY", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    // Fixture để `dispatched_by` NULL (nó ghi bản rõ thẳng dưới vai `app_unseal`), nên vế này
    // INERT cho tới khi có ai đó thật sự điều phối. Đặt nó tay là đúng thứ worker đặt.
    const { rowCount } = await db.pool.query(
      "UPDATE unseal_requests SET dispatched_by = $2, dispatched_by_session_id = $3, " +
        "dispatched_at = now() WHERE org_id = $1 AND rfq_id = $4",
      [orgA, uDeXuat, sDeXuat, rfqId],
    );
    expect(rowCount, "tiền đề: phải có ĐÚNG một yêu cầu mở thầu để gắn người điều phối").toBe(1);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[1] ?? "", reason: "tu dieu phoi tu de xuat", actorSessionId: sDeXuat },
          apiPool,
        ),
      ),
    ).rejects.toThrow(/Nguoi dieu phoi mo thau khong duoc de xuat trao thau/u);

    // ĐỐI CHỨNG DƯƠNG — cùng gói, cùng báo giá, chỉ đổi NGƯỜI. Không có vế này, ca trên xanh cả
    // khi trigger từ chối mọi đề xuất trên gói thầu ấy vì một lý do khác hẳn.
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "nguoi thu ba de xuat", actorSessionId: sDuyet },
        apiPool,
      ),
    );
    expect(dx.status).toBe("PROPOSED");
    expect(dx.actedBy).toBe(uDuyet);
  });

  // [S1.122 / khoản 233] Kịch bản mà hàng 233 viết ra: A điều phối → worker chết → B điều phối lại
  // → A đề xuất. Trước `064` vế 3 đọc `dispatched_by` (nay là B) nên A ĐI QUA; từ `064` nó đọc
  // `unseal_dispatch_history`, nơi trigger đã ghi CẢ HAI lần.
  async function dieuPhoiTay(rfqId: string, nguoi: string, phien: string): Promise<void> {
    const { rowCount } = await db.pool.query(
      "UPDATE unseal_requests SET dispatched_by = $2, dispatched_by_session_id = $3, " +
        "dispatched_at = coalesce(dispatched_at, now()) WHERE org_id = $1 AND rfq_id = $4",
      [orgA, nguoi, phien, rfqId],
    );
    expect(rowCount, "tiền đề: phải có ĐÚNG một yêu cầu mở thầu để gắn người điều phối").toBe(1);
  }

  it("[INV-J3] vế 3 — người điều phối LẦN ĐẦU vẫn bị chặn sau một lần điều phối lại (khoản 233)", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    await dieuPhoiTay(rfqId, uDeXuat, sDeXuat);
    await dieuPhoiTay(rfqId, uKhong, sKhong);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[1] ?? "", reason: "dieu phoi lan dau roi de xuat", actorSessionId: sDeXuat },
          apiPool,
        ),
      ),
    ).rejects.toThrow(/Nguoi dieu phoi mo thau khong duoc de xuat trao thau/u);

    const { rows: ls } = await db.pool.query<{ dispatched_by: string }>(
      "SELECT dispatched_by FROM unseal_dispatch_history WHERE org_id = $1 AND rfq_id = $2 " +
        "ORDER BY recorded_at, id",
      [orgA, rfqId],
    );
    expect(ls.map((r) => r.dispatched_by), "trigger phải ghi CẢ HAI lần điều phối").toEqual([uDeXuat, uKhong]);

    // ĐỐI CHỨNG DƯƠNG — người chưa từng điều phối, cùng gói, cùng báo giá.
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "nguoi chua tung dieu phoi", actorSessionId: sDuyet },
        apiPool,
      ),
    );
    expect(dx.status).toBe("PROPOSED");
  });

  it("[INV-J3] vế 3 — ĐỘT BIẾN: gỡ trigger ghi lịch sử thì người điều phối lần đầu lại đi qua", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    await db.pool.query("ALTER TABLE unseal_requests DISABLE TRIGGER unseal_requests_ghi_lich_su_dieu_phoi");
    try {
      await dieuPhoiTay(rfqId, uDeXuat, sDeXuat);
      await dieuPhoiTay(rfqId, uKhong, sKhong);
      const dx = await withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[1] ?? "", reason: "dot bien go lop ghi", actorSessionId: sDeXuat },
          apiPool,
        ),
      );
      expect(dx.status, "không có lớp ghi thì vế 3 mù — đúng lỗ của khoản 233").toBe("PROPOSED");
    } finally {
      await db.pool.query("ALTER TABLE unseal_requests ENABLE ALWAYS TRIGGER unseal_requests_ghi_lich_su_dieu_phoi");
    }
  });

  it("[INV-J3] lịch sử điều phối CHỈ-GHI-THÊM với app_api, và cách ly theo tổ chức", async () => {
    const { rfqId } = await sanSangTraoThau();
    await dieuPhoiTay(rfqId, uDeXuat, sDeXuat);
    for (const cau of [
      "UPDATE unseal_dispatch_history SET dispatched_by = dispatched_by WHERE rfq_id = $1",
      "DELETE FROM unseal_dispatch_history WHERE rfq_id = $1",
    ]) {
      await expect(withTenant(apiPool, orgA, (c) => c.query(cau, [rfqId])), cau).rejects.toMatchObject({ code: "42501" });
    }
    const { rows } = await withTenant(apiPool, orgB, (c) =>
      c.query("SELECT 1 FROM unseal_dispatch_history WHERE rfq_id = $1", [rfqId]),
    );
    expect(rows, "tổ chức B không thấy lịch sử điều phối của A").toEqual([]);
  });

  it("[INV-J3] vế 1 — NGƯỜI ĐỀ XUẤT không tự duyệt được, kể cả khi họ giữ `po.approve`", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    // `uDuyet` (FINANCE) giữ CẢ `award.recommend` lẫn `po.approve` — đo được ở `005`, và nó là
    // đúng ca mà lớp vai trò KHÔNG chặn được: hai mã đều có, nên chỉ một trigger đọc HÀNG chặn nổi.
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat roi tu duyet", actorSessionId: sDuyet },
        apiPool,
      ),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        duyetTraoThau(c, orgA, { rfqId, awardId: dx.awardId, actorSessionId: sDuyet }, apiPool),
      ),
    ).rejects.toThrow(/Nguoi de xuat trao thau khong duoc tu duyet/u);

    // Không chữ ký nào được ghi, và hàng `APPROVED` không tồn tại.
    const { rows: ck } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_award_approvals WHERE org_id = $1 AND award_id = $2",
      [orgA, dx.awardId],
    );
    expect(ck[0]?.n).toBe("0");
    expect((await hangAward(rfqId)).map((h) => h.status)).toEqual(["PROPOSED"]);
  });

  it("[INV-J3] vế 1, nửa KHÔNG tới được qua lớp trên — cùng một PHIÊN, hai người dùng khác nhau", async () => {
    // `award_kiem_nguoi_duyet` có HAI vế: so NGƯỜI và so PHIÊN. Vế PHIÊN không tới được qua đường
    // sản xuất, vì `kiem_danh_tinh_theo_phien` buộc cặp người-phiên là DẪN XUẤT — nên một phiên
    // của A không khai được `approver_user_id = B`. Chính chú thích của `061` khai điều đó.
    //
    // Đo nó bằng cách TẮT trigger danh tính lúc chạy, và khẳng định phép tắt ĐÃ ÁP trước khi tin
    // kết quả. Thiếu bước khẳng định ấy, một lệnh `ALTER` thất bại sẽ cho một ca xanh vì vế NGƯỜI
    // bắt — tức đo lại đúng thứ ca trên đã đo.
    const { rfqId, banRo } = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de do ve PHIEN", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    await db.pool.query(
      "ALTER TABLE rfq_award_approvals DISABLE TRIGGER rfq_award_approvals_kiem_danh_tinh",
    );
    try {
      const { rows: tg } = await db.pool.query<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_award_approvals_kiem_danh_tinh'",
      );
      expect(tg[0]?.tgenabled, "đột biến phải THẬT SỰ được áp trước khi đọc kết quả").toBe("D");

      await expect(
        withTenant(apiPool, orgA, (c) =>
          c.query(
            "INSERT INTO rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) " +
              "VALUES ($1, $2, $3, $4)",
            [orgA, dx.awardId, uDuyet, sDeXuat],
          ),
        ),
      ).rejects.toThrow(/Phien da de xuat trao thau khong duoc dung de duyet/u);
    } finally {
      await db.pool.query(
        "ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_danh_tinh",
      );
    }
    // KHÔI PHỤC phải tự kiểm — một trigger `ENABLE ALWAYS` bị để lại ở `DISABLE` sẽ làm mọi ca
    // sau đó đo một thế giới không có lớp danh tính, và không ca nào trong tệp này kêu.
    const { rows: lai } = await db.pool.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_award_approvals_kiem_danh_tinh'",
    );
    expect(lai[0]?.tgenabled, "phải về đúng ENABLE ALWAYS, không phải ENABLE thường").toBe("A");
  });
});

describe("[S1.110 / S2.6] J5 — hai vế NỘI DUNG, mỗi vế một câu", { timeout: 300000 }, () => {
  it("[INV-J5] vế giá — báo giá KHÔNG có `effective_cost` đọc được thì không trao thầu được", async () => {
    // MỘT LỜI KHAI CỦA CHÍNH VÒNG NÀY BỊ PHÉP ĐO BÁC. Bản đầu của ca này dựng *báo giá không đọc
    // được* bằng `currency: null`, và nó SAI: `taoLuotDanhGia` lọc *đọc được* theo `tien`, rồi vế
    // §2.3⑻ TỪ CHỐI cả lượt chấm khi tập đọc được lệch đơn vị tiền (`LECH_TIEN_TE`). Nên một
    // `currency` NULL không cho một hàng xếp hạng NULL — nó cho KHÔNG lượt chấm nào, và ca ấy đỏ
    // ở giàn cảnh chứ không ở thứ đang đo.
    //
    // Hình dạng ĐÚNG là một `totalAmount` KHÔNG PHẢI SỐ: `bid_so_tien` (`020`) trả NULL, hàng xếp
    // hạng VẪN tồn tại với `effective_cost` và `rank` cùng NULL (§2.3⑺), và khoá ngoại hợp thành
    // của `061` vẫn đi qua — nên vế CẤU TRÚC của J5 KHÔNG chặn, và thứ chặn là vế NỘI DUNG. Đó
    // chính là lý do vế nội dung tồn tại, và ca này là chỗ nó được chứng minh.
    const { rfqId, banRo } = await sanSangTraoThau([
      ["khong-phai-so", "VND"],
      ["537600000.00", "VND"],
    ]);
    const { rows: hang } = await db.pool.query<{ effective_cost: string | null; rank: number | null }>(
      "SELECT effective_cost, rank FROM rfq_evaluation_lines WHERE org_id = $1 AND bid_version_id = $2",
      [orgA, banRo[0] ?? ""],
    );
    expect(
      hang,
      "tiền đề: hàng xếp hạng phải TỒN TẠI — nếu không, ca này đo khoá ngoại chứ không đo J5",
    ).toHaveLength(1);
    expect(
      [hang[0]?.effective_cost, hang[0]?.rank],
      "tiền đề: hàng ấy phải thật sự không đọc được giá",
    ).toEqual([null, null]);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[0] ?? "", reason: "chon bao gia khong doc duoc", actorSessionId: sDeXuat },
          apiPool,
        ),
      ),
    ).rejects.toThrow(/khong co effective_cost doc duoc/u);

    // ĐỐI CHỨNG DƯƠNG — cùng gói, cùng người, chỉ đổi sang báo giá ĐỌC ĐƯỢC.
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "bao gia doc duoc", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    expect(dx.status).toBe("PROPOSED");
  });

  it("[INV-J5] vế RFQ — lượt chấm của gói thầu KHÁC bị từ chối — câu INSERT thẳng, vì lớp gói tự suy", async () => {
    const a = await sanSangTraoThau();
    const b = await sanSangTraoThau();
    expect(a.rfqId).not.toBe(b.rfqId);

    // Khoá ngoại hợp thành `(org_id, evaluation_id, bid_version_id)` ĐI QUA: cặp ấy có thật ở
    // `rfq_evaluation_lines`. Thứ không có chuỗi nào buộc là *lượt chấm ấy thuộc `NEW.rfq_id`*.
    await expect(
      chenAwardTho({
        rfqId: a.rfqId,
        evaluationId: b.luotId,
        bidVersionId: b.banRo[1] ?? "",
        status: "PROPOSED",
        actedBy: uDeXuat,
        actedBySessionId: sDeXuat,
      }),
    ).rejects.toThrow(/khong thuoc RFQ/u);

    // ĐỐI CHỨNG DƯƠNG — CÙNG câu ấy với lượt chấm của CHÍNH gói `a`.
    const id = await chenAwardTho({
      rfqId: a.rfqId,
      evaluationId: a.luotId,
      bidVersionId: a.banRo[1] ?? "",
      status: "PROPOSED",
      actedBy: uDeXuat,
      actedBySessionId: sDeXuat,
    });
    expect(id).not.toBe("");
  });

  // [S1.115 / khoản 229] ĐỘT BIẾN — và nó là thứ J5 KHÔNG CÓ cho tới vòng này.
  //
  // Đo lại ngày 2026-09-23, TRƯỚC khi mở ô ma trận cho nhóm J: khối `[S1.110]` ở đầu phần trao
  // thầu khai rằng J3 · J5 · J7 *"có phép ĐO, có đối chứng DƯƠNG và có đột biến"*. Quét toàn
  // kho tìm mọi lệnh `DISABLE TRIGGER`/`DROP TRIGGER` trong test: **chỉ J3 có** —
  // `rfq_awards_kiem_de_xuat` và `rfq_awards_kiem_mot_award_song` không bị gỡ ở một ca nào.
  //
  // Thứ J5 và J7 thật sự có là **ca `INSERT` THẲNG**, và nó chứng minh một mệnh đề KHÁC: *lớp
  // giữ nằm ở trigger chứ không ở lớp gói*. Nó không chứng minh *gỡ lớp ấy ra thì thủng*. Hai
  // câu ấy khác nhau, và một ô trong ma trận bất biến chỉ được mở khi câu thứ hai cũng được đo.
  //
  // Ca này dùng vế *lượt chấm của gói KHÁC* chứ không vế *giá không đọc được*, vì vế ấy đi tới
  // được bằng một câu `INSERT` thẳng mà KHÔNG chạm một vế nào của J3 — nên thứ đỏ lên khi gỡ
  // trigger là đúng J5, không phải một vế đi ké.
  it("[INV-J5] ĐỘT BIẾN — gỡ `rfq_awards_kiem_de_xuat` lúc chạy thì award trỏ lượt chấm của gói KHÁC ĐI LỌT", async () => {
    const a = await sanSangTraoThau();
    const b = await sanSangTraoThau();
    const hangSai = {
      rfqId: a.rfqId,
      evaluationId: b.luotId,
      bidVersionId: b.banRo[1] ?? "",
      status: "PROPOSED",
      actedBy: uDeXuat,
      actedBySessionId: sDeXuat,
    };
    // Tiền đề: với trigger CÒN SỐNG, hàng ấy bị chặn. Thiếu bước này, một ca xanh sau khi gỡ
    // trigger không phân biệt được *đột biến sống* với *hàng vốn dĩ hợp lệ*.
    await expect(chenAwardTho(hangSai)).rejects.toThrow(/khong thuoc RFQ/u);

    await db.pool.query("ALTER TABLE rfq_awards DISABLE TRIGGER rfq_awards_kiem_de_xuat");
    try {
      const { rows: tg } = await db.pool.query<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_awards_kiem_de_xuat'",
      );
      expect(tg[0]?.tgenabled, "đột biến phải THẬT SỰ được áp trước khi đọc kết quả").toBe("D");
      const id = await chenAwardTho(hangSai);
      expect(
        id,
        "không trigger thì một award trỏ lượt chấm của gói THẦU KHÁC đi thẳng vào sổ — J5 mất lớp duy nhất của nó",
      ).not.toBe("");
    } finally {
      // `ENABLE ALWAYS`, không `ENABLE` thường: thiếu chữ ALWAYS là trả lại một trigger YẾU HƠN
      // bản đã gỡ — đúng khoản **216**.
      await db.pool.query("ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_de_xuat");
    }
    const { rows: lai } = await db.pool.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_awards_kiem_de_xuat'",
    );
    expect(lai[0]?.tgenabled, "phải về đúng ENABLE ALWAYS, không phải ENABLE thường").toBe("A");
  });
});

describe("[S1.110 / S2.6] J7 — tối đa MỘT award còn sống, và chuỗi chỉ đi một chiều", { timeout: 300000 }, () => {
  it("[INV-J7] hai đề xuất trên cùng một gói thầu: lần thứ hai bị từ chối và gọi tên J7", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat mot", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    // Lớp GÓI bắt trước (RFQ nay ở `AWARDED`, không còn `EVALUATING`) — và thông điệp của nó là
    // thứ người dùng đọc, nên nó phải nói ra trạng thái.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[2] ?? "", reason: "de xuat hai", actorSessionId: sDeXuat },
          apiPool,
        ),
      ),
    ).rejects.toThrow(/Chỉ đề xuất trao thầu khi gói thầu đang ở EVALUATING; gói này đang ở AWARDED/u);

    // Và lớp CSDL — thứ có thẩm quyền — bắt cùng ca ấy khi lớp gói bị đi vòng. Hai lớp, và ca
    // này là lý do lớp dưới tồn tại: một đường ghi tương lai quên câu `UPDATE` trạng thái sẽ đi
    // qua lớp trên mà không đi qua lớp này.
    await expect(
      chenAwardTho({
        rfqId,
        evaluationId: luotId,
        bidVersionId: banRo[2] ?? "",
        status: "PROPOSED",
        actedBy: uDeXuat,
        actedBySessionId: sDeXuat,
      }),
    ).rejects.toThrow(/da co mot award con song .*toi da MOT \(J7\)/u);
  });

  it("hàng APPROVED KHÔNG CHỮ KÝ bị từ chối, và thông điệp nói ra số chữ ký đang có", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    expect(dx.evaluationId).toBe(luotId);

    await expect(
      chenAwardTho({
        rfqId,
        evaluationId: luotId,
        bidVersionId: banRo[1] ?? "",
        status: "APPROVED",
        actedBy: uDuyet,
        actedBySessionId: sDuyet,
      }),
    ).rejects.toThrow(/can 1 chu ky duyet; dang co 0/u);

    // ĐỐI CHỨNG DƯƠNG — CÙNG câu ấy sau khi có ĐÚNG một chữ ký hợp lệ.
    await withTenant(apiPool, orgA, (c) =>
      c.query(
        "INSERT INTO rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) " +
          "VALUES ($1, $2, $3, $4)",
        [orgA, dx.awardId, uDuyet, sDuyet],
      ),
    );
    const id = await chenAwardTho({
      rfqId,
      evaluationId: luotId,
      bidVersionId: banRo[1] ?? "",
      status: "APPROVED",
      actedBy: uDuyet,
      actedBySessionId: sDuyet,
    });
    expect(id).not.toBe("");
  });

  it("hàng APPROVED nói về một BÁO GIÁ KHÁC bị từ chối", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat bao gia hai", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    await withTenant(apiPool, orgA, (c) =>
      c.query(
        "INSERT INTO rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) " +
          "VALUES ($1, $2, $3, $4)",
        [orgA, dx.awardId, uDuyet, sDuyet],
      ),
    );
    // Chữ ký ĐÃ có, nên thứ chặn KHÔNG phải phép đếm — nó là vế *cùng báo giá*. Không có vế ấy,
    // một hàng "duyệt" đổi người thắng sau lưng người đã ký.
    await expect(
      chenAwardTho({
        rfqId,
        evaluationId: luotId,
        bidVersionId: banRo[2] ?? "",
        status: "APPROVED",
        actedBy: uDuyet,
        actedBySessionId: sDuyet,
      }),
    ).rejects.toThrow(/phai noi ve dung bao gia cua de xuat dang song/u);
  });

  it("huỷ HAI LẦN: lần thứ hai bị từ chối ở cả lớp gói và lớp CSDL", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    await withTenant(apiPool, orgA, (c) =>
      huyTraoThau(c, orgA, { rfqId, reason: "huy lan mot", actorSessionId: sDuyet }, apiPool),
    );
    await expect(
      withTenant(apiPool, orgA, (c) =>
        huyTraoThau(c, orgA, { rfqId, reason: "huy lan hai", actorSessionId: sDuyet }, apiPool),
      ),
    ).rejects.toThrow(/Chỉ huỷ được khi gói thầu đang ở AWARDED; gói này đang ở EVALUATING/u);

    await expect(
      chenAwardTho({
        rfqId,
        evaluationId: luotId,
        bidVersionId: banRo[1] ?? "",
        status: "CANCELLED",
        actedBy: uDuyet,
        actedBySessionId: sDuyet,
      }),
    ).rejects.toThrow(/da huy roi/u);
  });

  it("hàng APPROVED / CANCELLED mà CHƯA có đề xuất nào bị từ chối", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    for (const tt of ["APPROVED", "CANCELLED"]) {
      await expect(
        chenAwardTho({
          rfqId,
          evaluationId: luotId,
          bidVersionId: banRo[1] ?? "",
          status: tt,
          actedBy: uDuyet,
          actedBySessionId: sDuyet,
        }),
        `hàng ${tt} không có đề xuất trước đó`,
      ).rejects.toThrow(/chua co de xuat trao thau nao/u);
    }
  });

  it("hai bảng award đều CHỈ-GHI-THÊM — `UPDATE` và `DELETE` bị chặn kể cả với superuser", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    await withTenant(apiPool, orgA, (c) =>
      duyetTraoThau(c, orgA, { rfqId, awardId: dx.awardId, actorSessionId: sDuyet }, apiPool),
    );
    // `db.pool` là SUPERUSER + BYPASSRLS, nên ca này đo đúng thứ `ENABLE ALWAYS` tồn tại để làm:
    // chặn cả vai không ai chặn được bằng quyền.
    await expect(
      db.pool.query("UPDATE rfq_awards SET reason = 'sua lai' WHERE id = $1", [dx.awardId]),
    ).rejects.toThrow();
    await expect(
      db.pool.query("DELETE FROM rfq_awards WHERE id = $1", [dx.awardId]),
    ).rejects.toThrow();
    await expect(
      db.pool.query("DELETE FROM rfq_award_approvals WHERE org_id = $1 AND award_id = $2", [orgA, dx.awardId]),
    ).rejects.toThrow();
    expect((await hangAward(rfqId)).map((h) => h.status)).toEqual(["PROPOSED", "APPROVED"]);
  });

  // [S1.115 / khoản 229] ĐỘT BIẾN — cùng lý do với ca J5 ở trên: khối `[S1.110]` khai một đột
  // biến mà kho không có. Ca này là nó.
  //
  // Gỡ ĐÚNG MỘT trigger: `rfq_awards_kiem_de_xuat` ở lại sống, nên hàng thứ hai vẫn phải đi
  // qua mọi vế của J3 và J5. Thứ duy nhất mất đi là J7 — và đó là cách ca này chứng minh
  // trigger ấy, chứ không một lớp nào khác, là thứ giữ *tối đa MỘT award còn sống*.
  it("[INV-J7] ĐỘT BIẾN — gỡ `rfq_awards_kiem_mot_award_song` lúc chạy thì award THỨ HAI ĐI LỌT", async () => {
    const { rfqId, banRo, luotId } = await sanSangTraoThau();
    await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat mot", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    const hangHai = {
      rfqId,
      evaluationId: luotId,
      bidVersionId: banRo[2] ?? "",
      status: "PROPOSED",
      actedBy: uDeXuat,
      actedBySessionId: sDeXuat,
    };
    // Tiền đề: với trigger CÒN SỐNG, đề xuất thứ hai bị chặn và thông điệp gọi tên J7.
    await expect(chenAwardTho(hangHai)).rejects.toThrow(/da co mot award con song/u);

    await db.pool.query(
      "ALTER TABLE rfq_awards DISABLE TRIGGER rfq_awards_kiem_mot_award_song",
    );
    try {
      const { rows: tg } = await db.pool.query<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_awards_kiem_mot_award_song'",
      );
      expect(tg[0]?.tgenabled, "đột biến phải THẬT SỰ được áp trước khi đọc kết quả").toBe("D");
      const id = await chenAwardTho(hangHai);
      expect(
        id,
        "không trigger thì một gói thầu có HAI award cùng sống — và `docTraoThau` chỉ thấy một trong hai",
      ).not.toBe("");
      const { rows: dem } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM rfq_awards WHERE org_id = $1 AND rfq_id = $2 AND status = 'PROPOSED'",
        [orgA, rfqId],
      );
      expect(dem[0]?.n, "HAI hàng PROPOSED cùng sống trên một gói thầu — đó là đúng thứ J7 cấm").toBe("2");
    } finally {
      await db.pool.query(
        "ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_mot_award_song",
      );
    }
    const { rows: lai } = await db.pool.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'rfq_awards_kiem_mot_award_song'",
    );
    expect(lai[0]?.tgenabled, "phải về đúng ENABLE ALWAYS, không phải ENABLE thường").toBe("A");
  });
});

describe("[S1.110 / S2.6] cổng quyền và ranh giới tổ chức của ba đường trao thầu", { timeout: 300000 }, () => {
  it("`award.recommend` thiếu ⇒ 403 có hàng sổ; `po.approve` thiếu ⇒ cũng vậy", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    // `uKhongXem` là `REQUESTER` — đo được ở `005` rằng vai ấy KHÔNG giữ `award.recommend`,
    // `po.approve` lẫn `bid.view`, nên nó là phiên duy nhất trong fixture trượt cả ba cổng.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        deXuatTraoThau(
          c, orgA,
          { rfqId, bidVersionId: banRo[1] ?? "", reason: "khong co quyen", actorSessionId: sKhongXem },
          apiPool,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat that", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    // `uDeXuat` là PROCUREMENT_MANAGER: giữ `award.recommend`, KHÔNG giữ `po.approve`. Nên cổng
    // duyệt chặn họ ở lớp QUYỀN, trước cả khi trigger *không tự duyệt* được hỏi.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        duyetTraoThau(c, orgA, { rfqId, awardId: dx.awardId, actorSessionId: sDeXuat }, apiPool),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        huyTraoThau(c, orgA, { rfqId, reason: "khong co po.approve", actorSessionId: sDeXuat }, apiPool),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        docTraoThau(c, orgA, { rfqId, actorSessionId: sKhongXem }, apiPool),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const { rows: so } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' " +
        "AND resource_id = $2",
      [orgA, rfqId],
    );
    expect(Number(so[0]?.n ?? "0"), "mỗi lần từ chối một hàng sổ").toBe(4);
  });

  it("đề xuất trỏ tới award của gói thầu KHÁC bị từ chối trước khi chạm cổng nào", async () => {
    const a = await sanSangTraoThau();
    const b = await sanSangTraoThau();
    const dx = await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId: b.rfqId, bidVersionId: b.banRo[1] ?? "", reason: "de xuat cua goi b", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    // Cặp `(rfqId đường dẫn, awardId)` lệch nhau: hàng sổ `PERMISSION_DENIED` của route sẽ gọi
    // tên gói `a` cho một hành động trên gói `b`. Không phải một lần vượt cổng — một câu SAI.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        duyetTraoThau(c, orgA, { rfqId: a.rfqId, awardId: dx.awardId, actorSessionId: sDuyet }, apiPool),
      ),
    ).rejects.toThrow(/không thuộc gói thầu được nêu trong đường dẫn/u);
  });

  it("một phiên của tổ chức KHÁC không thấy và không chạm được award của tổ chức này", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat cua to chuc A", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    // `uB` là PROCUREMENT_MANAGER của tổ chức B: họ giữ `bid.view`, nên thứ chặn KHÔNG phải cổng
    // quyền — nó là RLS cộng phép giải phiên. Câu cần đo là *không thấy gì*.
    await expect(
      withTenant(apiPool, orgB, (c) => docTraoThau(c, orgB, { rfqId, actorSessionId: sB }, apiPool)),
    ).resolves.toBeNull();
    await expect(
      withTenant(apiPool, orgB, (c) =>
        huyTraoThau(c, orgB, { rfqId, reason: "to chuc khac huy", actorSessionId: sB }, apiPool),
      ),
    ).rejects.toThrow();
    // Và award của tổ chức A còn nguyên.
    expect((await hangAward(rfqId)).map((h) => h.status)).toEqual(["PROPOSED"]);
  });

  it("`docTraoThau` trả `null` khi chưa có đề xuất nào — KHÔNG mảng rỗng, KHÔNG 404", async () => {
    const { rfqId } = await sanSangTraoThau();
    await expect(
      withTenant(apiPool, orgA, (c) => docTraoThau(c, orgA, { rfqId, actorSessionId: sYc }, apiPool)),
    ).resolves.toBeNull();
  });
});

// ================================================================================================
// [S1.116 / khoản 239 / ADR-060] **J6** — TỪ CHỐI TRẠNG THÁI NÀO VÀO SỔ, VÀ CA CHỨNG MINH LẦN GHI
// ẤY KHÔNG PHẢI "CỐ GẮNG HẾT SỨC"
//
// Khoản 239 đo được rằng một lần từ chối TRẠNG THÁI không để lại dấu vết nào: `dispatch.ts` trả 422
// rồi thoát, và chú thích của chính nó viết *"422 với thân cố định, KHÔNG vào log"*. ADR-060 chốt
// luật CHỌN LỌC — ghi khi lời từ chối nói NGƯỜI DÙNG đi sai thứ tự chuỗi, không ghi khi nó nói CẤU
// HÌNH chưa sẵn sàng — và ba ca dưới đây đo đúng ba vế mà một ô trong ma trận đòi.
// ================================================================================================

describe("[S1.116 / khoản 239] J6 — từ chối TRẠNG THÁI vào sổ có chọn lọc", { timeout: 300000 }, () => {
  /** Đếm hàng `RFQ_STATE_DENIED` của một gói thầu. `resource_id`, KHÔNG phải `payload->>'rfqId'`. */
  async function hangTuChoiTrangThai(rfqId: string): Promise<{ ma: string; actor: string }[]> {
    const { rows } = await db.pool.query<{ ma: string; actor: string }>(
      "SELECT payload->>'ma' AS ma, actor_id::text AS actor FROM audit_events " +
        "WHERE org_id = $1 AND action = 'RFQ_STATE_DENIED' AND resource_id = $2 ORDER BY seq",
      [orgA, rfqId],
    );
    return rows;
  }

  /** Chặn ĐÚNG lần ghi mang `action` bằng một trigger trên sổ; mọi lần ghi khác đi qua. */
  async function voiGhiSoBiChan<T>(viec: () => Promise<T>): Promise<T> {
    try {
      await db.pool.query(
        "CREATE FUNCTION public.k239_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS " +
          "$$BEGIN RAISE EXCEPTION 'k239 thong diep noi bo' USING ERRCODE = 'TP239'; END$$",
      );
      await db.pool.query(
        "CREATE TRIGGER k239_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW " +
          "WHEN (NEW.action = 'RFQ_STATE_DENIED') EXECUTE FUNCTION public.k239_chan_ghi_so()",
      );
      return await viec();
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k239_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k239_chan_ghi_so()");
    }
  }

  /** Đưa một gói thầu sang `AWARDED` rồi đề xuất LẦN HAI — lối `RFQ_KHONG_DE_XUAT_DUOC`. */
  async function deXuatLanHai(rfqId: string, bidVersionId: string): Promise<unknown> {
    return withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId, reason: "de xuat lan hai", actorSessionId: sDeXuat },
        apiPool,
      ),
    ).then(
      () => null,
      (e: unknown) => e,
    );
  }

  it("[INV-J6] một mã CHUỖI để lại ĐÚNG MỘT hàng `RFQ_STATE_DENIED`, mang đúng mã và đúng người", async () => {
    const { rfqId, banRo } = await sanSangTraoThau();
    await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat mot", actorSessionId: sDeXuat },
        apiPool,
      ),
    );
    expect(await hangTuChoiTrangThai(rfqId), "tiền đề: đường THUẬN không được ghi hàng từ chối nào").toEqual([]);

    const loi = await deXuatLanHai(rfqId, banRo[2] ?? "");
    expect(loi).toMatchObject({ lyDo: "RFQ_KHONG_DE_XUAT_DUOC" });

    // Hàng sổ mang MÃ, không mang thông điệp — thông điệp có tên trạng thái, hàng sổ thì bất biến.
    expect(await hangTuChoiTrangThai(rfqId)).toEqual([
      { ma: "RFQ_KHONG_DE_XUAT_DUOC", actor: uDeXuat },
    ]);
  });

  it("[INV-J6] một mã CẤU HÌNH KHÔNG để lại hàng nào — đối chứng ÂM, cùng cơ chế", async () => {
    // Nếu ca này XANH vì lối `LECH_TIEN_TE` không chạy, nó không đo gì; nên nó khẳng định CẢ lời
    // từ chối lẫn sổ rỗng. Đây là nửa `vaoSo: false` của ADR-060, và nó phải rẻ THẬT —
    // `nemTuChoi` ném thẳng, không chạm `auditPool`, không mở một giao dịch nào.
    const { rfqId } = await goiDaMo([
      ["100.00", "VND"],
      ["100.00", "USD"],
    ]);
    await expect(
      withTenant(apiPool, orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId, actorSessionId: sYc }, apiPool)),
    ).rejects.toMatchObject({ lyDo: "LECH_TIEN_TE" });
    expect(
      await hangTuChoiTrangThai(rfqId),
      "`LECH_TIEN_TE` là sự cố DỮ LIỆU, không phải một người đi sai thứ tự — nó KHÔNG vào sổ",
    ).toEqual([]);
  });

  it("[INV-J6] ĐỘT BIẾN — chặn lần ghi sổ thì lời từ chối GÃY ỒN ÀO, không im lặng đi qua", async () => {
    // Đây là vế chịu lực: một hàng sổ *cố gắng hết sức* thì J6 không có giá trị nào, vì đúng lúc
    // ai đó gỡ quyền ghi sổ là đúng lúc dấu vết biến mất mà không ai biết. `throwAuditedDenial`
    // fail-CLOSED, và ca này là chỗ điều đó được đo.
    const { rfqId, banRo } = await sanSangTraoThau();
    await withTenant(apiPool, orgA, (c) =>
      deXuatTraoThau(
        c, orgA,
        { rfqId, bidVersionId: banRo[1] ?? "", reason: "de xuat mot", actorSessionId: sDeXuat },
        apiPool,
      ),
    );

    const loi = await voiGhiSoBiChan(() => deXuatLanHai(rfqId, banRo[2] ?? ""));
    // KHÔNG còn là lời từ chối trần: lần ghi hỏng được nâng lên thành một lỗi KHÁC HẲN, và lời
    // từ chối gốc đi kèm trong đó.
    expect(loi).toBeInstanceOf(Error);
    expect((loi as Error).name, "lần ghi sổ hỏng phải đổi HÌNH DẠNG lỗi, không được nuốt").toBe(
      "DenialAuditFailedError",
    );
    expect((loi as { denial?: { lyDo?: string } }).denial?.lyDo).toBe("RFQ_KHONG_DE_XUAT_DUOC");
    expect(await hangTuChoiTrangThai(rfqId), "và đúng là KHÔNG hàng nào ghi được").toEqual([]);

    // ĐỐI CHỨNG: gỡ trigger ra thì cùng lời gọi ấy ghi được — tức ca trên đỏ vì ĐỘT BIẾN, không
    // vì một lý do khác.
    const lai = await deXuatLanHai(rfqId, banRo[2] ?? "");
    expect(lai).toMatchObject({ lyDo: "RFQ_KHONG_DE_XUAT_DUOC" });
    expect((await hangTuChoiTrangThai(rfqId)).map((h) => h.ma)).toEqual(["RFQ_KHONG_DE_XUAT_DUOC"]);
  });
});
