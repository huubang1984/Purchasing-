// =============================================================================================
// [S1.291 / S3.8a / K11] HIỆU SUẤT NHÀ CUNG CẤP — view `supplier_performance`, hàm `docHieuSuatNhaCungCap`, route
// `GET /supplier-performance` — đo trên Postgres 16, dưới `app_api` và qua HTTP.
//
// Spec S3 §4.9, §5.1 K11, §6 T2; ADR-163; kế hoạch `docs/superpowers/plans/2026-10-10-chuan-bi-s3-8-s3-9.md` §2. Chủ dự án chốt
// 2026-10-10: chỉ số PHẢN HỒI cũng chỉ đọc gói ĐÃ LỘ GIÁ (góc C⑦ của S1.159) — không đọc từ lúc đóng.
//
//   A  TÍNH ĐÚNG (khuôn J2): một tổ chức, mười gói phủ mọi nhánh của định nghĩa — đã lộ, đóng chưa lộ, đang mở, BAFO đang mở, BAFO đã lộ,
//      huỷ trước và sau mở niêm phong, lời mời UNSENT / REVOKED / mời lại sau thu hồi, mời sau khi mở, hoà hạng, báo giá 0, trao thầu được
//      duyệt / bị rút / bị huỷ. Một bản tính lại ĐỘC LẬP bằng TypeScript trên hàng thô — đọc dưới vai chủ cụm, CÙNG giao dịch nên cùng
//      `now()`, không gọi `gia_da_lo`, không đọc view — phải ra ĐÚNG từng hàng của view. Cộng các khẳng định viết tay cho những con số
//      dễ đoán sai (đếm lời mời, chọn lời mời, mốc phản hồi, thắng).
//   B  K11 THEO THỜI GIAN: một gói đi OPEN → CLOSED → UNSEALED → EVALUATING → BAFO_OPEN → BAFO_CLOSED → BAFO_UNSEALED, ảnh chụp sau từng
//      cạnh. Trước UNSEALED không hàng nào; ngay sau UNSEALED hàng xuất hiện (ĐỐI CHỨNG DƯƠNG); lúc BAFO mở và đóng, phiên bản BAFO và cột giá
//      đứng yên trong khi vòng một VẪN đếm (đối chứng dương lúc BAFO_OPEN, spec §5.1 K11); sau mở niêm phong BAFO thì đổi. Gói huỷ sau khi
//      đóng mà trước mở niêm phong: không bao giờ hiện.
//   C  CÔ LẬP: phiên khách của một lời mời thuộc gói ĐÃ LỘ ra 0 hàng ở view; đối chứng dương dưới kết nối người mua của cùng tổ chức;
//      kết nối gắn tổ chức KHÁC không thấy hàng nào của tổ chức này. Nói thẳng: view bắt đầu từ `suppliers` — đóng với khách — nên khối
//      này xanh cả khi bỏ vị từ khách (đột biến V11); thứ giết đột biến ấy là phép đếm thân view ở `rls-coverage` và hàng ghim.
//   D  QUA HTTP: người giữ `bid.view` đọc được và để ĐÚNG một hàng `SUPPLIER_PERFORMANCE_READ`; BUYER (không `bid.view`) bị 403 kèm đúng một
//      `PERMISSION_DENIED`, không hàng đọc nào; sàn lịch sử (giả định 5) giữ lại tỷ lệ và trung vị của mẫu nhỏ; ghi sổ hỏng ⇒ hàm NÉM, không
//      chỉ số nào ra.
//
// Fixture: gói, báo giá, mở niêm phong dựng bằng SQL thô dưới vai chủ cụm theo ĐÚNG thứ tự cạnh của đường thật (khuôn
// `packages/du-lieu-nen/src/lich-su-gia.int.test.ts`) — mọi trigger ENABLE ALWAYS vẫn chạy; lượt chấm, vòng BAFO, trao thầu đi qua hàm
// gói thật. Tổ chức chưa bật S3 (hình dạng pilot), nên lời mời UNSENT và thu hồi được dựng thẳng — trigger K4a/K6 chỉ áp ở tổ chức đã bật.
// =============================================================================================
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { deXuatTraoThau, duyetTraoThau, huyTraoThau, rutDeXuatTraoThau, taoLuotDanhGia } from "@trustprocure/danh-gia";
import { PermissionDeniedError } from "@trustprocure/identity";
import { SAN_LICH_SU, docHieuSuatNhaCungCap, type HieuSuatNhaCungCap } from "@trustprocure/kiem-soat";
import { withGuestSession, withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { COOKIE_PHIEN_NGUOI_MUA, createDispatcher } from "./dispatch.js";
import { createApiServer } from "./server.js";
import { dichVuTest } from "./test-services.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

let db: TestDatabase;
let apiPool: pg.Pool;
let auditPool: pg.Pool;
let goc = "";
const dongServer: (() => Promise<void>)[] = [];

interface Nguoi {
  readonly u: string;
  readonly s: string;
  readonly cookie: string;
}
interface ToChuc {
  readonly org: string;
  /** Tạo gói, nộp duyệt, xin mở thầu, chấm — PROCUREMENT_MANAGER. */
  readonly pm: Nguoi;
  /** Đề xuất trao thầu — PROCUREMENT_MANAGER thứ hai, không tạo gói nào, không điều phối mở thầu (J3). */
  readonly dx: Nguoi;
  /** Duyệt và huỷ trao thầu — FINANCE (`po.approve`). */
  readonly tc: Nguoi;
  /** Ký duyệt gói và duyệt mở thầu — DIRECTOR. */
  readonly d1: Nguoi;
  /** BUYER — giữ `rfq.invite`, KHÔNG giữ `bid.view` (`005`). */
  readonly buyer: Nguoi;
  readonly cs: string;
}
interface Ncc {
  readonly id: string;
  readonly lh: string;
}
interface BaoGia {
  readonly inv: string;
  readonly bid: string;
  readonly khach: string;
  readonly phienBan: string[];
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`hs-${randomBytes(4).toString("hex")}`]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const ten = `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}`;
    const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id", [org, `${ten}@vidu.vn`, ten]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const token = randomBytes(32).toString("base64url");
    const s = await motId(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [org, u, createHash("sha256").update(token, "utf8").digest()],
    );
    return { u, s, cookie: `${COOKIE_PHIEN_NGUOI_MUA}=${org}.${token}` };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const dx = await nguoi("PROCUREMENT_MANAGER");
  const tc = await nguoi("FINANCE");
  const d1 = await nguoi("DIRECTOR");
  const buyer = await nguoi("BUYER");
  const cs = await motId(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000000.00', 'VND', $2::jsonb, 2, $3, $4) RETURNING id",
    [org, TP_GIA, pm.u, pm.s],
  );
  return { org, pm, dx, tc, d1, buyer, cs };
}

async function ncc(t: ToChuc, ten: string): Promise<Ncc> {
  const id = await motId(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [t.org, `${ten} ${randomBytes(2).toString("hex")}`, t.pm.u, t.pm.s],
  );
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
    [t.org, id, `${randomBytes(5).toString("hex")}@ncc.vn`, t.pm.u, t.pm.s],
  );
  return { id, lh };
}

/**
 * Gói ở `OPEN`, mở cách đây `moTruocGio` giờ (tạo trước đó một ngày — CHECK `opened_at >= created_at`): thời gian phản hồi của báo giá
 * nộp bây giờ là khoảng ấy, nên trung vị đo được một con số khác 0.
 */
async function goiMo(t: ToChuc, moTruocGio: number): Promise<string> {
  const rfq = await motId(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id, created_at) " +
      "VALUES ($1, 'Mua vat tu', now() + interval '7 days', false, $2, $3, now() - interval '1 day') RETURNING id",
    [t.org, t.pm.u, t.pm.s],
  );
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [t.org, rfq, t.pm.u, t.pm.s],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [t.org, rfq, t.cs, t.pm.u, t.pm.s],
  );
  await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [
    rfq,
    t.pm.u,
    t.pm.s,
  ]);
  await db.pool.query("INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)", [t.org, rfq, t.d1.u, t.d1.s]);
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [t.org, rfq, Buffer.alloc(91, 1), Buffer.alloc(80, 2), t.pm.u, t.pm.s],
    );
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now() - make_interval(hours => $4), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
      [rfq, t.pm.u, t.pm.s, moTruocGio],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return rfq;
}

/**
 * Lời mời thô. `status` cho sẵn chỉ ở tổ chức chưa bật — nơi trigger K6 không ép `UNSENT`. Mặc định lời mời mang lúc TẠO GÓI (mời trước
 * khi mở, như đường thật ở DRAFT), nên mốc phản hồi là lúc mở; `sauKhiMo` ⇒ lúc mời là bây giờ — mời sau khi mở, mốc là lúc mời.
 */
async function moi(t: ToChuc, rfq: string, n: Ncc, tuy: { readonly status?: string; readonly sauKhiMo?: boolean } = {}): Promise<string> {
  return motId(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id, status, created_at) " +
      "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6, $7, CASE WHEN $8 THEN now() ELSE (SELECT r.created_at FROM rfq_packages r WHERE r.id = $2) END) RETURNING id",
    [t.org, rfq, n.id, n.lh, t.pm.u, t.pm.s, tuy.status ?? "SENT", tuy.sauKhiMo === true],
  );
}

async function thuHoi(t: ToChuc, inv: string): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 WHERE id = $1",
    [inv, t.pm.u, t.pm.s],
  );
}

async function chenPhienBan(t: ToChuc, rfq: string, bg: { readonly bid: string; readonly khach: string }, soLan: number): Promise<string[]> {
  return withTenant(apiPool, t.org, async (c) => {
    const ra: string[] = [];
    for (let i = 0; i < soLan; i += 1) {
      const v = (
        await c.query<{ id: string; version: number }>(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id, version",
          [t.org, bg.bid, Buffer.alloc(64, 9), bg.khach],
        )
      ).rows[0]!;
      await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
        t.org,
        v.id,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfq}\nbid_id=${bg.bid}\n` +
          `version=${String(v.version)}\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-10-10T00:00:00.000000Z\n`,
        Buffer.alloc(70, 7),
      ]);
      ra.push(v.id);
    }
    return ra;
  });
}

/** Phiên khách đã xác thực của một lời mời, luồng báo giá, rồi `soLan` phiên bản vòng một. */
async function nop(t: ToChuc, rfq: string, inv: string, n: Ncc, soLan: number): Promise<BaoGia> {
  const token = await motId(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
      "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
    [t.org, inv, randomBytes(32), t.pm.u, t.pm.s],
  );
  const thachThuc = await motId(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, " +
      "expires_at, consumed_at) VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
    [t.org, inv, token, n.lh, randomBytes(32), randomBytes(32)],
  );
  const khach = await motId(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [t.org, inv, thachThuc, randomBytes(32), n.lh],
  );
  const bid = await withTenant(apiPool, t.org, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [t.org, inv])).rows[0]!.id,
  );
  return { inv, bid, khach, phienBan: soLan === 0 ? [] : await chenPhienBan(t, rfq, { bid, khach }, soLan) };
}

async function dong(t: ToChuc, rfq: string): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de do', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfq, t.pm.u, t.pm.s],
  );
}

/** Yêu cầu mở thầu đã duyệt rồi giao dịch mở thầu — bản rõ, trạng thái, `EXECUTED` cùng thứ tự worker thật. C3 gắn `bafo_round_id` khi gói BAFO_CLOSED. */
async function moNiemPhong(t: ToChuc, rfq: string, banRo: readonly (readonly [string, string])[]): Promise<void> {
  const yeuCau = await motId(
    "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
    [t.org, rfq, t.pm.u, t.pm.s],
  );
  await db.pool.query("INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [
    t.org,
    yeuCau,
    t.d1.u,
    t.d1.s,
  ]);
  await db.pool.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yeuCau]);
  const truoc = (await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfq])).rows[0]!.status;
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    for (const [versionId, tong] of banRo) {
      await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
        t.org,
        yeuCau,
        versionId,
        JSON.stringify({ totalAmount: tong, currency: "VND" }),
      ]);
    }
    await c.query("UPDATE rfq_packages SET status = $2 WHERE id = $1", [rfq, truoc === "BAFO_CLOSED" ? "BAFO_UNSEALED" : "UNSEALED"]);
    await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [yeuCau]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function cham(t: ToChuc, rfq: string): Promise<string> {
  return (await withTenant(apiPool, t.org, (c) => taoLuotDanhGia(c, t.org, { rfqId: rfq, actorSessionId: t.pm.s }, auditPool))).evaluationId;
}

async function moBafo(t: ToChuc, rfq: string, luot: string): Promise<string> {
  return withTenant(apiPool, t.org, async (c) => {
    const vong = (
      await c.query<{ id: string }>(
        "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 2, now() + interval '3 days', $5, $6) RETURNING id",
        [t.org, rfq, luot, t.cs, t.pm.u, t.pm.s],
      )
    ).rows[0]!.id;
    await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfq]);
    return vong;
  });
}

async function dongBafo(t: ToChuc, rfq: string, vong: string): Promise<void> {
  await withTenant(apiPool, t.org, async (c) => {
    await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vong]);
    await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfq]);
  });
}

async function huyGoi(t: ToChuc, rfq: string): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'huy de do', cancelled_by = $2, cancelled_by_session_id = $3 WHERE id = $1",
    [rfq, t.pm.u, t.pm.s],
  );
}

async function deXuat(t: ToChuc, rfq: string, versionId: string): Promise<string> {
  return (
    await withTenant(apiPool, t.org, (c) =>
      deXuatTraoThau(c, t.org, { rfqId: rfq, bidVersionId: versionId, reason: "gia thap nhat", actorSessionId: t.dx.s }, auditPool),
    )
  ).awardId;
}

/** Duyệt đề xuất; trả id hàng `APPROVED` — sổ trao thầu chỉ-ghi-thêm, mỗi lần đổi trạng thái là một hàng mới (`094`). */
async function duyet(t: ToChuc, rfq: string, awardId: string): Promise<string> {
  return (await withTenant(apiPool, t.org, (c) => duyetTraoThau(c, t.org, { rfqId: rfq, awardId, actorSessionId: t.tc.s }, auditPool))).awardId;
}

/** Một gói đi trọn tới `EVALUATING`: mỗi báo giá một (ncc, số phiên bản, tổng tiền của phiên bản cuối). */
async function goiDaCham(
  t: ToChuc,
  moTruocGio: number,
  baoGia: readonly (readonly [Ncc, number, string])[],
): Promise<{ readonly rfq: string; readonly bg: readonly BaoGia[]; readonly luot: string }> {
  const rfq = await goiMo(t, moTruocGio);
  const bg: BaoGia[] = [];
  for (const [n, soLan] of baoGia) bg.push(await nop(t, rfq, await moi(t, rfq, n), n, soLan));
  await dong(t, rfq);
  await moNiemPhong(
    t,
    rfq,
    bg.map((b, i) => [b.phienBan.at(-1)!, baoGia[i]![2]] as const),
  );
  return { rfq, bg, luot: await cham(t, rfq) };
}

// ---- Đọc view và tính lại độc lập ------------------------------------------------------------------------------------------
interface HangHieuSuat {
  readonly supplier_id: string;
  readonly so_goi_moi: string;
  readonly so_goi_nop: string;
  readonly trung_vi_phan_hoi_giay: string | null;
  readonly so_lan_sua: string;
  readonly so_goi_xep_hang: string;
  readonly hang_trung_vi: string | null;
  readonly khoang_cach_trung_vi_phan_van: string | null;
  readonly so_lan_vao_bafo: string;
  readonly so_lan_thang: string;
}

const CAU_VIEW =
  "SELECT supplier_id::text, so_goi_moi::text, so_goi_nop::text, trung_vi_phan_hoi_giay::text, so_lan_sua::text, so_goi_xep_hang::text, " +
  "hang_trung_vi::text, khoang_cach_trung_vi_phan_van::text, so_lan_vao_bafo::text, so_lan_thang::text " +
  "FROM public.supplier_performance WHERE org_id = $1 ORDER BY supplier_id";

/** View dưới `app_api`, gắn tổ chức — đường của tầng gói. */
async function view(org: string): Promise<HangHieuSuat[]> {
  return withTenant(apiPool, org, async (c) => (await c.query<HangHieuSuat>(CAU_VIEW, [org])).rows);
}

const sapXep = <T>(xs: readonly T[], cmp: (a: T, b: T) => number): T[] => [...xs].sort(cmp);
const soBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
/** `percentile_disc(0.5)`: phần tử đầu tiên có vị trí ≥ một nửa — số chẵn thì phần tử dưới. */
const trungVi = (xs: readonly bigint[]): bigint | null => (xs.length === 0 ? null : sapXep(xs, soBig)[Math.ceil(xs.length / 2) - 1]!);

/**
 * Bản tính lại ĐỘC LẬP — chỉ đọc hàng thô, không `gia_da_lo`, không view; mốc là `now()` của CHÍNH giao dịch của `c`. Thời gian ở micro giây
 * (`Date` của JS cắt xuống mili giây, mà vị từ *giá đã lộ* so nghiêm `<`).
 */
async function tinhLai(c: pg.PoolClient, org: string): Promise<HangHieuSuat[]> {
  const E = (cot: string): string => `(extract(epoch FROM ${cot}) * 1000000)::bigint::text`;
  const doc = async <T extends pg.QueryResultRow>(sql: string): Promise<T[]> => (await c.query<T>(sql, [org])).rows;
  const bayGio = BigInt((await c.query<{ n: string }>(`SELECT ${E("now()")} AS n`)).rows[0]!.n);
  const goi = await doc<{ id: string; mo: string | null; huy: string | null }>(`SELECT id, ${E("opened_at")} AS mo, ${E("cancelled_at")} AS huy FROM rfq_packages WHERE org_id = $1`);
  const yeuCau = await doc<{ rfq_id: string; vong: string | null; status: string; xong: string | null }>(
    `SELECT rfq_id, bafo_round_id AS vong, status, ${E("executed_at")} AS xong FROM unseal_requests WHERE org_id = $1`,
  );
  const vong = await doc<{ id: string; rfq_id: string; mo: string; luot: string; top_n: number }>(
    `SELECT id, rfq_id, ${E("opened_at")} AS mo, evaluation_id AS luot, top_n FROM rfq_bafo_rounds WHERE org_id = $1`,
  );
  const loiMoi = await doc<{ id: string; rfq_id: string; ncc: string; status: string; thu_hoi: string | null; tao: string }>(
    `SELECT id, rfq_id, supplier_id AS ncc, status, ${E("revoked_at")} AS thu_hoi, ${E("created_at")} AS tao FROM rfq_invitations WHERE org_id = $1`,
  );
  const luong = await doc<{ id: string; inv: string }>("SELECT id, invitation_id AS inv FROM vendor_bids WHERE org_id = $1");
  const phienBan = await doc<{ id: string; bid: string; vong: string | null; nop: string }>(
    `SELECT id, bid_id AS bid, bafo_round_id AS vong, ${E("submitted_at")} AS nop FROM vendor_bid_versions WHERE org_id = $1`,
  );
  const luotCham = await doc<{ id: string; rfq_id: string; tao: string }>(`SELECT id, rfq_id, ${E("created_at")} AS tao FROM rfq_evaluations WHERE org_id = $1`);
  const dongCham = await doc<{ luot: string; pb: string; tien: string | null; hang: number | null }>(
    "SELECT evaluation_id AS luot, bid_version_id AS pb, effective_cost::text AS tien, rank AS hang FROM rfq_evaluation_lines WHERE org_id = $1",
  );
  const trao = await doc<{ id: string; rfq_id: string; status: string; pb: string; luc: string }>(
    `SELECT id, rfq_id, status, bid_version_id AS pb, ${E("acted_at")} AS luc FROM rfq_awards WHERE org_id = $1`,
  );

  const daLo = (rfq: string, moc: bigint): boolean => {
    const g = goi.find((x) => x.id === rfq)!;
    if (g.huy !== null && BigInt(g.huy) < moc) return false;
    const thucThi = (v: string | null): boolean =>
      yeuCau.some((y) => y.rfq_id === rfq && y.vong === v && y.status === "EXECUTED" && y.xong !== null && BigInt(y.xong) < moc);
    return thucThi(null) && vong.filter((v) => v.rfq_id === rfq && BigInt(v.mo) < moc).every((v) => thucThi(v.id));
  };
  const loVongMot = new Map<string, boolean>();
  const loGia = new Map<string, boolean>();
  for (const g of goi) {
    const ung = [bayGio, ...(g.huy === null ? [] : [BigInt(g.huy)]), ...vong.filter((v) => v.rfq_id === g.id).map((v) => BigInt(v.mo))];
    loVongMot.set(g.id, daLo(g.id, ung.reduce((a, b) => (b < a ? b : a))));
    loGia.set(g.id, daLo(g.id, bayGio));
  }
  const loiMoiCua = new Map(loiMoi.map((i) => [i.id, i]));
  const luongCua = new Map(luong.map((b) => [b.id, b]));
  const pbCua = new Map(phienBan.map((v) => [v.id, v]));
  const nccCuaPhienBan = (pb: string): { ncc: string; rfq: string } => {
    const i = loiMoiCua.get(luongCua.get(pbCua.get(pb)!.bid)!.inv)!;
    return { ncc: i.ncc, rfq: i.rfq_id };
  };

  interface Gom {
    moi: Set<string>;
    nop: bigint[];
    suaMot: bigint;
    coBafo: boolean;
    suaBafo: bigint;
    xepHang: Set<string>;
    hang: bigint[];
    phanVan: bigint[];
    vaoBafo: Set<string>;
    thang: bigint;
  }
  const gom = new Map<string, Gom>();
  const cua = (n: string): Gom => {
    let g = gom.get(n);
    if (g === undefined) {
      g = { moi: new Set(), nop: [], suaMot: 0n, coBafo: false, suaBafo: 0n, xepHang: new Set(), hang: [], phanVan: [], vaoBafo: new Set(), thang: 0n };
      gom.set(n, g);
    }
    return g;
  };

  // Lời mời được đếm (vòng một) — và báo giá theo ĐÚNG lời mời ấy.
  for (const i of loiMoi) {
    if (!loVongMot.get(i.rfq_id) || i.thu_hoi !== null || i.status === "UNSENT") continue;
    const g = cua(i.ncc);
    g.moi.add(i.rfq_id);
    const mo = goi.find((x) => x.id === i.rfq_id)!.mo;
    const batDau = mo === null || BigInt(i.tao) > BigInt(mo) ? BigInt(i.tao) : BigInt(mo);
    const cuaLoiMoi = phienBan.filter((v) => v.vong === null && luongCua.get(v.bid)!.inv === i.id);
    if (cuaLoiMoi.length > 0) {
      const dau = cuaLoiMoi.map((v) => BigInt(v.nop)).reduce((a, b) => (b < a ? b : a));
      g.nop.push((dau - batDau) / 1000000n);
      g.suaMot += BigInt(cuaLoiMoi.length - 1);
    }
  }
  // Phiên bản BAFO của gói đã lộ giá: số phiên bản trừ số cặp (luồng, vòng).
  const capBafo = new Map<string, Set<string>>();
  for (const v of phienBan) {
    if (v.vong === null) continue;
    const { ncc: n, rfq } = nccCuaPhienBan(v.id);
    if (!loGia.get(rfq)) continue;
    const g = cua(n);
    g.coBafo = true;
    g.suaBafo += 1n;
    const cap = capBafo.get(n) ?? new Set<string>();
    cap.add(`${v.bid}|${v.vong}`);
    capBafo.set(n, cap);
  }
  for (const [n, cap] of capBafo) cua(n).suaBafo -= BigInt(cap.size);
  // Hạng ở lượt chấm MỚI NHẤT của gói đã lộ giá.
  for (const g of goi) {
    if (!loGia.get(g.id)) continue;
    const luot = sapXep(
      luotCham.filter((l) => l.rfq_id === g.id),
      (a, b) => soBig(BigInt(b.tao), BigInt(a.tao)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )[0];
    if (luot === undefined) continue;
    const dongs = dongCham.filter((d) => d.luot === luot.id && d.tien !== null);
    const xu = (s: string): bigint => BigInt(s.replace(".", ""));
    const thap = dongs.map((d) => xu(d.tien!)).reduce<bigint | null>((a, b) => (a === null || b < a ? b : a), null);
    for (const d of dongs) {
      const n = cua(nccCuaPhienBan(d.pb).ncc);
      n.xepHang.add(g.id);
      n.hang.push(BigInt(d.hang!));
      if (thap !== null && thap !== 0n) n.phanVan.push(((xu(d.tien!) - thap) * 20000n + thap) / (thap * 2n));
    }
  }
  // Vào BAFO: hạng ở lượt chấm của vòng ≤ top_n.
  for (const v of vong) {
    if (!loGia.get(v.rfq_id)) continue;
    for (const d of dongCham.filter((x) => x.luot === v.luot && x.hang !== null && x.hang <= v.top_n)) cua(nccCuaPhienBan(d.pb).ncc).vaoBafo.add(v.id);
  }
  // Thắng: hàng award MỚI NHẤT của gói là APPROVED.
  for (const g of goi) {
    if (!loGia.get(g.id)) continue;
    const moiNhat = sapXep(
      trao.filter((a) => a.rfq_id === g.id),
      (a, b) => soBig(BigInt(b.luc), BigInt(a.luc)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )[0];
    if (moiNhat?.status === "APPROVED") cua(nccCuaPhienBan(moiNhat.pb).ncc).thang += 1n;
  }

  const ra: HangHieuSuat[] = [];
  for (const [n, g] of gom) {
    if (g.moi.size === 0 && g.xepHang.size === 0 && !g.coBafo && g.vaoBafo.size === 0 && g.thang === 0n) continue;
    const tv = (xs: bigint[]): string | null => {
      const x = trungVi(xs);
      return x === null ? null : String(x);
    };
    ra.push({
      supplier_id: n,
      so_goi_moi: String(g.moi.size),
      so_goi_nop: String(g.nop.length),
      trung_vi_phan_hoi_giay: tv(g.nop),
      so_lan_sua: String(g.suaMot + g.suaBafo),
      so_goi_xep_hang: String(g.xepHang.size),
      hang_trung_vi: tv(g.hang),
      khoang_cach_trung_vi_phan_van: tv(g.phanVan),
      so_lan_vao_bafo: String(g.vaoBafo.size),
      so_lan_thang: String(g.thang),
    });
  }
  return sapXep(ra, (a, b) => (a.supplier_id < b.supplier_id ? -1 : a.supplier_id > b.supplier_id ? 1 : 0));
}

/** View và bản tính lại trong CÙNG giao dịch của chủ cụm — cùng `now()`. */
async function doiChieu(org: string): Promise<{ readonly view: HangHieuSuat[]; readonly tinhLai: HangHieuSuat[] }> {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const v = (await c.query<HangHieuSuat>(CAU_VIEW, [org])).rows;
    const t = await tinhLai(c, org);
    await c.query("COMMIT");
    return { view: v, tinhLai: t };
  } catch (e) {
    // Câu đọc ném (vd. đột biến bỏ `nullif` ⇒ chia cho 0) thì trả kết nối về pool SẠCH — không thì ca kế tiếp nhận "transaction is aborted".
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

async function dungServer(): Promise<string> {
  const dv = dichVuTest();
  const server = createApiServer(createDispatcher({ pool: apiPool, auditPool, services: dv.services }));
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  dongServer.push(() => new Promise<void>((xong) => server.close(() => xong())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function goi(duong: string, cookie: string): Promise<{ readonly status: number; readonly body: Record<string, unknown>; readonly text: string }> {
  const res = await fetch(`${goc}${duong}`, { headers: { cookie } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // thân không phải JSON — để `text` nói
  }
  return { status: res.status, body, text };
}

async function hangSo(org: string, action: string): Promise<{ resource_type: string; actor_id: string; payload: unknown }[]> {
  return (
    await db.pool.query<{ resource_type: string; actor_id: string; payload: unknown }>(
      "SELECT resource_type, actor_id, payload FROM audit_events WHERE org_id = $1 AND action = $2 ORDER BY seq",
      [org, action],
    )
  ).rows;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = createPool(db.connectionString, 6, { role: "app_api" });
  auditPool = createPool(db.connectionString, 4, { role: "app_api" });
  goc = await dungServer();
}, 180000);

afterAll(async () => {
  for (const dong of dongServer) await dong();
  await apiPool?.end().catch(() => undefined);
  await auditPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.291 / S3.8a] A — tính đúng: view bằng bản tính lại độc lập trên hàng thô", () => {
  it("[INV-K11] mười gói phủ mọi nhánh của định nghĩa — từng hàng của view bằng bản tính lại; các con số dễ đoán sai khẳng định tay", { timeout: 240000 }, async () => {
    const t = await taoToChuc();
    const [a, b, c, d, e] = [await ncc(t, "NCC A"), await ncc(t, "NCC B"), await ncc(t, "NCC C"), await ncc(t, "NCC D"), await ncc(t, "NCC E")];

    // P1 — đã lộ, đã chấm, trao cho A được duyệt. A sửa hai lần; C được mời mà không nộp; D có lời mời UNSENT (không đếm); E bị thu hồi.
    const p1 = await goiMo(t, 3);
    const bgA1 = await nop(t, p1, await moi(t, p1, a), a, 3);
    const bgB1 = await nop(t, p1, await moi(t, p1, b), b, 1);
    await moi(t, p1, c);
    await moi(t, p1, d, { status: "UNSENT" });
    await thuHoi(t, await moi(t, p1, e));
    await dong(t, p1);
    await moNiemPhong(t, p1, [
      [bgA1.phienBan.at(-1)!, "100.00"],
      [bgB1.phienBan.at(-1)!, "120.00"],
    ]);
    await cham(t, p1);
    await duyet(t, p1, await deXuat(t, p1, bgA1.phienBan.at(-1)!));

    // P2 — đóng mà CHƯA mở niêm phong: không cột nào được đọc (góc C⑦).
    const p2 = await goiMo(t, 5);
    await nop(t, p2, await moi(t, p2, a), a, 2);
    await nop(t, p2, await moi(t, p2, b), b, 1);
    await dong(t, p2);

    // P3 — đang mở.
    const p3 = await goiMo(t, 1);
    await nop(t, p3, await moi(t, p3, a), a, 4);

    // P4 — đã lộ vòng một, vòng BAFO ĐANG MỞ: vòng một vẫn đếm, phiên bản BAFO và cột giá thì không.
    const p4 = await goiDaCham(t, 6, [
      [a, 1, "300.00"],
      [b, 1, "310.00"],
      [c, 2, "320.00"],
    ]);
    const vong4 = await moBafo(t, p4.rfq, p4.luot);
    await chenPhienBan(t, p4.rfq, p4.bg[0]!, 2);
    expect(vong4).not.toBe("");

    // P5 — BAFO đã lộ: B nộp lại ba lần (hai lần sửa), lượt chấm MỚI là lượt tính hạng; A và B vào BAFO.
    const p5 = await goiDaCham(t, 8, [
      [a, 1, "500.00"],
      [b, 1, "520.00"],
      [c, 1, "540.00"],
    ]);
    const vong5 = await moBafo(t, p5.rfq, p5.luot);
    const bafoA5 = await chenPhienBan(t, p5.rfq, p5.bg[0]!, 1);
    const bafoB5 = await chenPhienBan(t, p5.rfq, p5.bg[1]!, 3);
    await dongBafo(t, p5.rfq, vong5);
    await moNiemPhong(t, p5.rfq, [
      [bafoA5.at(-1)!, "490.00"],
      [bafoB5.at(-1)!, "480.00"],
    ]);
    await cham(t, p5.rfq);

    // P6 — đã lộ rồi bị huỷ: vòng một vẫn đếm (mốc lùi về lúc huỷ), cột giá thì không.
    const p6 = await goiDaCham(t, 2, [
      [a, 1, "600.00"],
      [d, 1, "650.00"],
    ]);
    await huyGoi(t, p6.rfq);

    // P7 — đóng rồi huỷ TRƯỚC mở niêm phong: không bao giờ hiện.
    const p7 = await goiMo(t, 4);
    await nop(t, p7, await moi(t, p7, e), e, 2);
    await dong(t, p7);
    await huyGoi(t, p7);

    // P8 — C nộp qua lời mời cũ, bị thu hồi, mời lại sau khi mở rồi nộp qua lời mời MỚI: chỉ luồng của lời mời được đếm vào phép
    // tính, mốc phản hồi là lúc mời lại (mời sau khi mở). Hoà hạng A–C.
    const p8 = await goiMo(t, 10);
    const bgA8 = await nop(t, p8, await moi(t, p8, a), a, 1);
    const cuC8 = await nop(t, p8, await moi(t, p8, c), c, 2);
    await thuHoi(t, cuC8.inv);
    const bgC8 = await nop(t, p8, await moi(t, p8, c, { sauKhiMo: true }), c, 1);
    await dong(t, p8);
    await moNiemPhong(t, p8, [
      [bgA8.phienBan.at(-1)!, "800.00"],
      [bgC8.phienBan.at(-1)!, "800.00"],
    ]);
    await cham(t, p8);

    // P9 — báo giá 0 của D: chi phí thấp nhất bằng 0, khoảng cách của lượt NULL (không chia cho 0); trao cho B bị rút.
    const p9 = await goiDaCham(t, 7, [
      [d, 1, "0.00"],
      [b, 1, "900.00"],
    ]);
    await deXuat(t, p9.rfq, p9.bg[1]!.phienBan.at(-1)!);
    await withTenant(apiPool, t.org, (c2) => rutDeXuatTraoThau(c2, t.org, { rfqId: p9.rfq, reason: "rut de do", actorSessionId: t.dx.s }, auditPool));

    // P10 — trao cho E được duyệt rồi bị huỷ: hàng mới nhất CANCELLED, không thắng. Khoảng cách của B là 12,5 phần vạn — ca DUY NHẤT
    // nơi làm tròn nửa lên (13) khác cắt (12), và nó là trung vị của B: đột biến bỏ phép làm tròn phải đỏ ở đây.
    const p10 = await goiDaCham(t, 9, [
      [e, 1, "1000.00"],
      [b, 1, "1001.25"],
    ]);
    const award10 = await duyet(t, p10.rfq, await deXuat(t, p10.rfq, p10.bg[0]!.phienBan.at(-1)!));
    await withTenant(apiPool, t.org, (c2) =>
      huyTraoThau(c2, t.org, { rfqId: p10.rfq, awardId: award10, reason: "huy de do", actorSessionId: t.tc.s }, auditPool),
    );

    const { view: v, tinhLai: tl } = await doiChieu(t.org);
    expect(v.length, "tiền đề: view phải có hàng của các nhà cung cấp").toBeGreaterThanOrEqual(5);
    expect(v).toEqual(tl);

    // Khẳng định tay — chỗ một định nghĩa sai vẫn có thể khớp một bản tính lại cùng sai.
    const hang = (n: Ncc): HangHieuSuat => v.find((x) => x.supplier_id === n.id)!;
    // A: được mời ở P1, P4, P5, P6, P8 (P2 chưa lộ, P3 đang mở); nộp cả năm; sửa 2 (P1) + 0 (BAFO P5, một phiên bản) — BAFO P4 chưa lộ.
    expect([hang(a).so_goi_moi, hang(a).so_goi_nop, hang(a).so_lan_sua]).toEqual(["5", "5", "2"]);
    // A thắng ĐÚNG một gói (P1); P9/P10 không phải của A.
    expect(hang(a).so_lan_thang).toBe("1");
    // C: P1 (không nộp), P4, P5, P8 ⇒ mời 4, nộp 3. Sửa: P4 hai phiên bản ⇒ 1; luồng của lời mời CŨ ở P8 (hai phiên bản) không đếm.
    expect([hang(c).so_goi_moi, hang(c).so_goi_nop, hang(c).so_lan_sua]).toEqual(["4", "3", "1"]);
    // D: lời mời UNSENT ở P1 không đếm ⇒ P6 (đã lộ, huỷ sau) và P9 ⇒ 2.
    expect(hang(d).so_goi_moi).toBe("2");
    // E: P1 bị thu hồi, P7 huỷ trước mở niêm phong ⇒ chỉ P10.
    expect([hang(e).so_goi_moi, hang(e).so_lan_thang]).toEqual(["1", "0"]);
    // B: sửa = 2 (ba phiên bản BAFO ở P5); vào BAFO ở P5 (P4 đang mở — không đếm); thắng 0 (P9 bị rút).
    expect([hang(b).so_lan_sua, hang(b).so_lan_vao_bafo, hang(b).so_lan_thang]).toEqual(["2", "1", "0"]);
    // B: khoảng cách P1 2000, P5 0 (hạng nhất sau BAFO), P10 12,5 ⇒ 13, P9 NULL (thấp nhất bằng 0) ⇒ trung vị của [0, 13, 2000] là 13.
    expect(hang(b).khoang_cach_trung_vi_phan_van).toBe("13");
    // D: hai gói nộp (P6 mở cách 2 giờ, P9 cách 7 giờ) — số chẵn, trung vị là phần tử DƯỚI (percentile_disc), không phải trung bình.
    expect(Number(hang(d).trung_vi_phan_hoi_giay)).toBeGreaterThanOrEqual(2 * 3600);
    expect(Number(hang(d).trung_vi_phan_hoi_giay)).toBeLessThan(2 * 3600 + 60);
    // A: xếp hạng ở P1 (hạng 1), P5 (hạng 2 sau BAFO — B 480 < A 490), P8 (hoà, hạng 1); P4 (BAFO đang mở) và P6 (huỷ) rời ⇒ 3, trung vị 1.
    expect([hang(a).so_goi_xep_hang, hang(a).hang_trung_vi]).toEqual(["3", "1"]);
    // C: phản hồi ở P4 (mở cách 6 giờ), P5 (8 giờ), P8 (MỜI LẠI sau khi mở ⇒ tính từ lúc mời, khoảng 0) ⇒ trung vị khoảng 6 giờ; nếu mốc là
    // `opened_at` thì P8 thành 10 giờ và trung vị thành 8 giờ.
    expect(Number(hang(c).trung_vi_phan_hoi_giay)).toBeGreaterThanOrEqual(6 * 3600);
    expect(Number(hang(c).trung_vi_phan_hoi_giay)).toBeLessThan(6 * 3600 + 600);
    // Đường của tầng gói (`app_api`, RLS thật, giao dịch khác) ra cùng hàng như đường của chủ cụm.
    expect(await view(t.org)).toEqual(tl);
  });
});

describe("[S1.291 / S3.8a] A2 — khoảng cách vượt bigint không làm hỏng view", () => {
  it("[INV-K11] giá thấp nhất 0,01 cạnh chi phí 10 nghìn tỷ: khoảng cách 9 999 999 999 999 990 000 phần vạn (vượt bigint) đi ra nguyên vẹn, view không ném", { timeout: 120000 }, async () => {
    // Lượt soi trên mã §S1.291 THẤP-6: bản đầu ép `::bigint` ⇒ "bigint out of range" làm hỏng view của CẢ tổ chức, route 500 — đầu vào
    // nằm trong tay nhà cung cấp. ((10 000 000 000 000 − 0,01) × 20 000 + 0,01) / 0,02 = 9 999 999 999 999 990 000,5 ⇒ `div` cắt.
    const t = await taoToChuc();
    const re = await ncc(t, "NCC re");
    const dat = await ncc(t, "NCC dat");
    await goiDaCham(t, 2, [
      [re, 1, "0.01"],
      [dat, 1, "10000000000000.00"],
    ]);
    const { view: v, tinhLai: tl } = await doiChieu(t.org);
    expect(v).toEqual(tl);
    expect(v.find((h) => h.supplier_id === dat.id)!.khoang_cach_trung_vi_phan_van).toBe("9999999999999990000");
    expect(v.find((h) => h.supplier_id === re.id)!.khoang_cach_trung_vi_phan_van).toBe("0");
    const hs = await withTenant(apiPool, t.org, (c) => docHieuSuatNhaCungCap(c, t.org, { actorSessionId: t.pm.s }, auditPool));
    expect(hs.nhaCungCap.map((n) => n.supplierId).sort()).toEqual([re.id, dat.id].sort());
  });
});

describe("[S1.291 / S3.8a] B — K11 theo thời gian: chỉ gói đã lộ giá, vòng một vẫn đếm lúc BAFO mở", () => {
  it("[INV-K11] OPEN → CLOSED: không hàng; UNSEALED: hàng xuất hiện (đối chứng dương); BAFO mở/đóng: vòng một đứng, BAFO và cột giá chưa vào; BAFO lộ: vào", { timeout: 120000 }, async () => {
    const t = await taoToChuc();
    const x = await ncc(t, "NCC dau");
    const y = await ncc(t, "NCC phu");
    const rfq = await goiMo(t, 2);
    const bgX = await nop(t, rfq, await moi(t, rfq, x), x, 6);
    const bgY = await nop(t, rfq, await moi(t, rfq, y), y, 1);
    const cua = async (): Promise<HangHieuSuat | undefined> => (await view(t.org)).find((h) => h.supplier_id === x.id);

    expect(await cua(), "OPEN: chưa một số nào được đọc").toBeUndefined();
    await dong(t, rfq);
    expect(await cua(), "CLOSED chưa mở niêm phong: so trước/sau lúc đóng không được lộ ai đã nộp (góc C⑦)").toBeUndefined();
    await moNiemPhong(t, rfq, [
      [bgX.phienBan.at(-1)!, "200.00"],
      [bgY.phienBan.at(-1)!, "210.00"],
    ]);
    const sauMo = await cua();
    expect(sauMo, "đối chứng dương: ngay sau UNSEALED hàng PHẢI xuất hiện").toBeDefined();
    expect([sauMo!.so_goi_moi, sauMo!.so_goi_nop, sauMo!.so_lan_sua, sauMo!.so_goi_xep_hang]).toEqual(["1", "1", "5", "0"]);
    const luot = await cham(t, rfq);
    expect((await cua())!.so_goi_xep_hang).toBe("1");

    const vong = await moBafo(t, rfq, luot);
    const bafoX = await chenPhienBan(t, rfq, bgX, 4);
    const lucMo = await cua();
    expect(lucMo, "đối chứng dương lúc BAFO_OPEN: vòng một — đã lộ trước khi vòng mở — vẫn đếm").toBeDefined();
    expect([lucMo!.so_goi_moi, lucMo!.so_goi_nop, lucMo!.so_lan_sua], "phiên bản BAFO của vòng đang mở chưa vào").toEqual(["1", "1", "5"]);
    expect([lucMo!.so_goi_xep_hang, lucMo!.so_lan_vao_bafo], "cột giá rời gói khi vòng BAFO chưa lộ").toEqual(["0", "0"]);
    await dongBafo(t, rfq, vong);
    const lucDong = await cua();
    expect([lucDong!.so_lan_sua, lucDong!.so_goi_xep_hang, lucDong!.so_lan_vao_bafo], "BAFO_CLOSED chưa mở niêm phong: vẫn như lúc mở").toEqual(["5", "0", "0"]);

    await moNiemPhong(t, rfq, [[bafoX.at(-1)!, "190.00"]]);
    const sauBafo = await cua();
    expect([sauBafo!.so_lan_sua, sauBafo!.so_goi_xep_hang, sauBafo!.so_lan_vao_bafo], "BAFO đã lộ: ba lần sửa của vòng BAFO vào, hạng về, vào BAFO một lần").toEqual([
      "8",
      "1",
      "1",
    ]);
    const { view: v, tinhLai: tl } = await doiChieu(t.org);
    expect(v).toEqual(tl);
  });

  it("[INV-K11] gói đóng rồi huỷ trước mở niêm phong không bao giờ hiện; gói huỷ sau mở niêm phong giữ vòng một, mất cột giá", { timeout: 120000 }, async () => {
    const t = await taoToChuc();
    const x = await ncc(t, "NCC huy truoc");
    const y = await ncc(t, "NCC huy sau");
    const truoc = await goiMo(t, 2);
    await nop(t, truoc, await moi(t, truoc, x), x, 3);
    await dong(t, truoc);
    await huyGoi(t, truoc);
    expect((await view(t.org)).find((h) => h.supplier_id === x.id)).toBeUndefined();

    const sau = await goiDaCham(t, 2, [[y, 2, "300.00"]]);
    const truocHuy = (await view(t.org)).find((h) => h.supplier_id === y.id)!;
    expect([truocHuy.so_goi_moi, truocHuy.so_lan_sua, truocHuy.so_goi_xep_hang]).toEqual(["1", "1", "1"]);
    await huyGoi(t, sau.rfq);
    const sauHuy = (await view(t.org)).find((h) => h.supplier_id === y.id)!;
    expect([sauHuy.so_goi_moi, sauHuy.so_lan_sua, sauHuy.so_goi_xep_hang], "huỷ SAU mở niêm phong: vòng một giữ, hạng rời").toEqual(["1", "1", "0"]);
    expect(await view(t.org)).toEqual((await doiChieu(t.org)).tinhLai);
  });
});

describe("[S1.291 / S3.8a] B2 — vòng BAFO không ai nộp lại", () => {
  it("[INV-K11] vòng BAFO đóng với 0 phong bì vẫn mở niêm phong được; trước đó cột giá rời gói, sau đó trở lại và hai người top-2 vào BAFO", { timeout: 120000 }, async () => {
    // Kế hoạch §5: vòng không phong bì có sinh `unseal_requests` EXECUTED không — nếu không, `gia_da_lo` loại gói ấy vĩnh viễn.
    const t = await taoToChuc();
    const x = await ncc(t, "NCC x");
    const y = await ncc(t, "NCC y");
    const g = await goiDaCham(t, 2, [
      [x, 1, "100.00"],
      [y, 1, "110.00"],
    ]);
    const vong = await moBafo(t, g.rfq, g.luot);
    await dongBafo(t, g.rfq, vong);
    const cua = async (n: Ncc): Promise<HangHieuSuat> => (await view(t.org)).find((h) => h.supplier_id === n.id)!;
    expect([(await cua(x)).so_goi_moi, (await cua(x)).so_goi_xep_hang], "BAFO_CLOSED chưa mở: vòng một đếm, cột giá rời").toEqual(["1", "0"]);
    await moNiemPhong(t, g.rfq, []);
    expect((await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [g.rfq])).rows[0]!.status).toBe("BAFO_UNSEALED");
    expect([(await cua(x)).so_goi_xep_hang, (await cua(x)).so_lan_vao_bafo, (await cua(y)).so_lan_vao_bafo]).toEqual(["1", "1", "1"]);
    expect(await view(t.org)).toEqual((await doiChieu(t.org)).tinhLai);
  });
});

describe("[S1.291 / S3.8a / ADR-081 ⑶] C — cô lập", () => {
  it("[INV-K11] phiên khách của lời mời thuộc gói ĐÃ LỘ ra 0 hàng; đối chứng dương: người mua cùng tổ chức thấy hàng; kết nối tổ chức khác không thấy hàng nào của nó", { timeout: 120000 }, async () => {
    const t = await taoToChuc();
    const khac = await taoToChuc();
    const x = await ncc(t, "NCC co lap");
    const g = await goiDaCham(t, 2, [[x, 1, "100.00"]]);
    const khach = g.bg[0]!.khach;
    // Tiền đề: dưới phiên khách, bảng gốc trả hàng của CHÍNH lời mời. (Nó KHÔNG chứng minh view sẽ lộ khi bỏ vị từ — view bắt đầu từ
    // `suppliers`, bảng đóng với khách; xem đầu tệp.)
    const banThan = await withGuestSession(apiPool, t.org, khach, async (c) =>
      Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM public.vendor_bid_versions")).rows[0]!.n),
    );
    expect(banThan, "tiền đề: phiên khách đọc được phiên bản của chính nó").toBe(1);
    const duoiKhach = await withGuestSession(apiPool, t.org, khach, async (c) =>
      Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM public.supplier_performance")).rows[0]!.n),
    );
    expect(duoiKhach).toBe(0);
    expect((await view(t.org)).map((h) => h.supplier_id), "đối chứng dương: người mua thấy hàng của nhà cung cấp").toEqual([x.id]);
    // Kết nối gắn tổ chức KHÁC hỏi đúng `org_id` của tổ chức này: RLS của bảng gốc giấu mọi hàng.
    const cheo = await withTenant(apiPool, khac.org, async (c) => (await c.query<HangHieuSuat>(CAU_VIEW, [t.org])).rows);
    expect(cheo, "tổ chức khác").toEqual([]);
  });
});

describe("[S1.291 / S3.8a] D — qua HTTP: cổng `bid.view`, sổ, sàn lịch sử", () => {
  it("[INV-K11] [INV-D5] `bid.view` đọc được, một hàng `SUPPLIER_PERFORMANCE_READ`; BUYER 403 kèm một `PERMISSION_DENIED`, không hàng đọc", { timeout: 120000 }, async () => {
    const t = await taoToChuc();
    const x = await ncc(t, "NCC http");
    await goiDaCham(t, 2, [[x, 1, "100.00"]]);

    const duoc = await goi("/supplier-performance", t.pm.cookie);
    expect(duoc.status, duoc.text).toBe(200);
    const hs = duoc.body.hieuSuat as { sanLichSu: number; nhaCungCap: HieuSuatNhaCungCap[] };
    expect(hs.sanLichSu).toBe(SAN_LICH_SU);
    expect(hs.nhaCungCap.map((n) => [n.supplierId, n.soGoiMoi, n.soGoiNop])).toEqual([[x.id, 1, 1]]);
    expect(duoc.text, "không số tiền nào đi ra").not.toMatch(/100\.00|"100"/u);
    const doc = await hangSo(t.org, "SUPPLIER_PERFORMANCE_READ");
    expect(doc).toEqual([{ resource_type: "SUPPLIER_PERFORMANCE", actor_id: t.pm.u, payload: { soNhaCungCap: 1, viewedBySessionId: t.pm.s } }]);

    const bi = await goi("/supplier-performance", t.buyer.cookie);
    expect(bi.status, bi.text).toBe(403);
    const tuChoi = (await hangSo(t.org, "PERMISSION_DENIED")).filter((h) => h.actor_id === t.buyer.u);
    expect(tuChoi.map((h) => h.resource_type)).toEqual(["SUPPLIER_PERFORMANCE"]);
    expect(await hangSo(t.org, "SUPPLIER_PERFORMANCE_READ"), "lần bị từ chối không để hàng đọc").toHaveLength(1);
  });

  it("[INV-K11] sàn lịch sử: năm gói ⇒ tỷ lệ phản hồi và trung vị hiện; bốn gói ⇒ giữ lại, nói tên trường; số đếm luôn trả", { timeout: 240000 }, async () => {
    const t = await taoToChuc();
    const du = await ncc(t, "NCC du");
    const thieu = await ncc(t, "NCC thieu");
    for (let i = 0; i < SAN_LICH_SU; i += 1) {
      const rfq = await goiMo(t, 1 + i);
      const bgDu = await nop(t, rfq, await moi(t, rfq, du), du, 1);
      const banRo: [string, string][] = [[bgDu.phienBan[0]!, "100.00"]];
      if (i < SAN_LICH_SU - 1) banRo.push([(await nop(t, rfq, await moi(t, rfq, thieu), thieu, 1)).phienBan[0]!, "110.00"]);
      await dong(t, rfq);
      await moNiemPhong(t, rfq, banRo);
    }
    const hs = await withTenant(apiPool, t.org, (c) => docHieuSuatNhaCungCap(c, t.org, { actorSessionId: t.pm.s }, auditPool));
    const cua = (n: Ncc): HieuSuatNhaCungCap => hs.nhaCungCap.find((h) => h.supplierId === n.id)!;
    expect([cua(du).soGoiMoi, cua(du).tyLePhanHoiPhanVan]).toEqual([5, 10000]);
    expect(cua(du).trungViPhanHoiGiay, "trung vị của năm gói mở cách 1..5 giờ là gói giữa — khoảng 3 giờ").toBeGreaterThanOrEqual(3 * 3600);
    expect(cua(du).trungViPhanHoiGiay).toBeLessThan(3 * 3600 + 60);
    expect(cua(du).chuaDuLichSu, "chưa chấm gói nào: ba trường của giá dưới sàn").toEqual(["hangTrungVi", "khoangCachTrungViPhanVan", "tyLeThangPhanVan"]);
    expect([cua(thieu).soGoiMoi, cua(thieu).soGoiNop, cua(thieu).tyLePhanHoiPhanVan, cua(thieu).trungViPhanHoiGiay]).toEqual([4, 4, null, null]);
    expect(cua(thieu).chuaDuLichSu).toEqual(["tyLePhanHoiPhanVan", "trungViPhanHoiGiay", "hangTrungVi", "khoangCachTrungViPhanVan", "tyLeThangPhanVan"]);
  });

  it("[INV-K11] fail-closed: ghi `SUPPLIER_PERFORMANCE_READ` hỏng ⇒ hàm NÉM chính lỗi ấy, không chỉ số nào ra; người không `bid.view` ⇒ `PermissionDeniedError`", { timeout: 120000 }, async () => {
    const t = await taoToChuc();
    const x = await ncc(t, "NCC chan so");
    await goiDaCham(t, 2, [[x, 1, "100.00"]]);
    await expect(withTenant(apiPool, t.org, (c) => docHieuSuatNhaCungCap(c, t.org, { actorSessionId: t.buyer.s }, auditPool))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await db.pool.query(
      "CREATE FUNCTION public.k11_chan_ghi_so() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'chan ghi so de do' USING ERRCODE = 'P0001'; END $$",
    );
    try {
      await db.pool.query(
        "CREATE TRIGGER k11_chan_ghi_so BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.action = 'SUPPLIER_PERFORMANCE_READ') " +
          "EXECUTE FUNCTION public.k11_chan_ghi_so()",
      );
      await expect(withTenant(apiPool, t.org, (c) => docHieuSuatNhaCungCap(c, t.org, { actorSessionId: t.pm.s }, auditPool))).rejects.toThrow(
        /chan ghi so de do/u,
      );
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS k11_chan_ghi_so ON public.audit_events");
      await db.pool.query("DROP FUNCTION IF EXISTS public.k11_chan_ghi_so()");
    }
    expect(await hangSo(t.org, "SUPPLIER_PERFORMANCE_READ")).toEqual([]);
    const lai = await withTenant(apiPool, t.org, (c) => docHieuSuatNhaCungCap(c, t.org, { actorSessionId: t.pm.s }, auditPool));
    expect(lai.nhaCungCap.map((n) => n.supplierId)).toEqual([x.id]);
  });
});
