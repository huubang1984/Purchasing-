// ==============================================================================================
// [S1.9101 / S3.5a · spec S3 §2.4 ⑹iv ⑺, §4.7, §5.1 · K7 · K2b · K5b · K12] AWARD THEO BẬC — PHÉP ĐO TRÊN POSTGRES 16, DƯỚI `app_api`
//
// Migration `9501_trao_thau_theo_bac`, ba lần hỏi trước của `trao-thau.ts` (`deXuatTraoThau`, `duyetTraoThau`). Hợp đồng đo ở đây:
//   ⑴ K7 — chữ ký SỐNG độc lập với hàng `APPROVED`: bậc cần hai thì chữ ký đầu còn đó (hàng `PROPOSED` đứng yên, `chuKyCan` 2),
//      gọi lặp là `DA_KY_DE_XUAT_NAY` có tên, người thứ hai ⇒ `APPROVED`; bậc CAO HƠN trong hai bậc (khai thấp ước lượng ⇒ số
//      chữ ký của bậc trao); vai thuộc `award_vai` của bậc ấy; tác giả phiên bản chính sách không ký; `award_vai_khac_nhau` là hệ
//      đại diện phân biệt; bậc đấu thầu chính thức, gói không bậc ghim, tiền tệ lệch ⇒ từ chối có tên; lớp chặn cuối ở trigger;
//   ⑵ K2b — số NHÓM có báo giá hợp lệ (đếm được theo luật K2) dưới ngưỡng của bậc cao hơn ⇒ đề xuất bị chặn; ngoại lệ
//      `LOW_ACTUAL_COMPETITION` lập ở EVALUATING cứu; lập hay rút ở AWARDED bị chặn; nhà cung cấp không đếm được nộp báo giá
//      không nâng số đếm; trigger là lớp chặn cuối khi lớp đề xuất bị tắt;
//   ⑶ K5b — khi bậc cao hơn ký danh sách, có ngoại lệ, hay bậc trao cao hơn ước lượng: mọi chữ ký của người trong tập loại trừ
//      (người xác minh nhà cung cấp thắng, người điều phối mở thầu) ⇒ từ chối; đối chứng âm khi không vế nào đòi;
//   ⑷ K12 — mỗi lần từ chối một hàng `CONTROL_DENIED` mang mã, đúng người; tập mã của các hàm vị từ BẰNG các dòng K7/K2b/K5b
//      của `CHOT_VAO_SO`.
// Mỗi vế có một ĐỘT BIẾN trong chính tệp này (định nghĩa lại hàm lúc chạy, khôi phục bằng `pg_get_functiondef` và tự kiểm sha256).
// Gói đi DRAFT→OPEN bằng câu thô dưới chủ cụm cộng `approveRfq` (mọi trigger của cạnh vẫn chạy — ENABLE ALWAYS), báo giá và mở
// niêm phong chèn thẳng (khuôn `luot-danh-gia.int.test.ts`), chấm bằng `taoLuotDanhGia`, trao thầu bằng hàm gói.
// ==============================================================================================
import { createHash, randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { CHOT_VAO_SO } from "@trustprocure/identity";
import { lapNgoaiLe, rutNgoaiLe } from "@trustprocure/invitation";
import { approveRfq } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, nhaCungCapDemDuoc, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { approveUnseal, requestUnseal } from "@trustprocure/unseal";
import { taoLuotDanhGia } from "./luot-danh-gia.js";
import { deXuatTraoThau, docTraoThau, duyetTraoThau } from "./trao-thau.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

/** Bốn bậc, VND. Bậc 1 chỉ nhận DIRECTOR; bậc 2 ký danh sách, hai chữ ký ở hai vai khác nhau; bậc 3 đấu thầu chính thức. */
const BAC = [
  { tu_so_tien: 0, so_ncc_toi_thieu: 1, award_vai_khac_nhau: false, ky_danh_sach_moi: false, xoay_vong_n: 0, award_so_chu_ky: 1, award_vai: ["DIRECTOR", "FINANCE"], tham_dinh_truoc_trao: false, khai_xung_dot: false, dau_thau_chinh_thuc: false },
  { tu_so_tien: 100_000_000, so_ncc_toi_thieu: 2, award_vai_khac_nhau: false, ky_danh_sach_moi: false, xoay_vong_n: 0, award_so_chu_ky: 2, award_vai: ["DIRECTOR"], tham_dinh_truoc_trao: false, khai_xung_dot: false, dau_thau_chinh_thuc: false },
  { tu_so_tien: 1_000_000_000, so_ncc_toi_thieu: 3, award_vai_khac_nhau: true, ky_danh_sach_moi: true, xoay_vong_n: 0, award_so_chu_ky: 2, award_vai: ["DIRECTOR", "FINANCE"], tham_dinh_truoc_trao: false, khai_xung_dot: false, dau_thau_chinh_thuc: false },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];
const UL_BAC0 = "50000000.00";
const UL_BAC1 = "150000000.00";
const UL_BAC2 = "1200000000.00";
const GIA_BAC0 = ["40000000.00", "42000000.00"];
const GIA_BAC1 = ["150000000.00", "160000000.00"];
const GIA_BAC2 = ["1100000000.00", "1150000000.00", "1180000000.00"];
const GIA_DTCT = ["12000000000.00"];
const GIAI_TRINH = "Chi hai nha cung cap nop bao gia du da moi du so; nha thu ba rut vi het hang.";

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;

interface ToChuc {
  readonly org: string;
  readonly daBat: boolean;
  /** PROCUREMENT_MANAGER — tạo gói, mời, nộp, yêu cầu mở thầu, chấm. */
  readonly pm: NguoiPhien;
  /** PROCUREMENT_MANAGER — ký danh sách (độc lập), đề xuất trao thầu. */
  readonly pm2: NguoiPhien;
  readonly gd1: NguoiPhien;
  readonly gd2: NguoiPhien;
  /** FINANCE — người KHAI phiên bản chính sách có bậc (tác giả). */
  readonly tc: NguoiPhien;
  /** FINANCE — người KÝ phiên bản ấy và người XÁC MINH mọi nhà cung cấp. */
  readonly tc2: NguoiPhien;
  /** FINANCE — không khai, không ký chính sách, không xác minh. */
  readonly tc3: NguoiPhien;
  readonly nhap: NguoiPhien;
  readonly chinhSachId: string;
  readonly categoryId: string;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function nguoi(org: string, vai: string): Promise<NguoiPhien> {
  const u = await motId("INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, $2, 'ACTIVE') RETURNING id", [
    org,
    `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
  ]);
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
  const s = await motId(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [org, u, randomBytes(32)],
  );
  return { u, s };
}

/** Phiên bản có bậc của `tc`, ký bởi `tc2` — lần bật S3 của tổ chức. Trả id phiên bản. */
async function batS3(t: Omit<ToChuc, "chinhSachId" | "categoryId" | "daBat">): Promise<string> {
  const v2 = await motId(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, tiers, " +
      "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
      "VALUES ($1, 2, '5000000000.00', 'VND', $2::jsonb, 0, $3::jsonb, 30, 12, true, now(), $4, $5) RETURNING id",
    [t.org, TP_GIA, JSON.stringify(BAC), t.tc.u, t.tc.s],
  );
  await db.pool.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
    t.org,
    v2,
    t.tc2.u,
    t.tc2.s,
  ]);
  return v2;
}

async function taoToChuc(bat = true): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`ct-${randomBytes(4).toString("hex")}`]);
  const [pm, pm2, gd1, gd2, tc, tc2, tc3] = await Promise.all([
    nguoi(org, "PROCUREMENT_MANAGER"),
    nguoi(org, "PROCUREMENT_MANAGER"),
    nguoi(org, "DIRECTOR"),
    nguoi(org, "DIRECTOR"),
    nguoi(org, "FINANCE"),
    nguoi(org, "FINANCE"),
    nguoi(org, "FINANCE"),
  ]);
  const v1 = await motId(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '5000000000.00', 'VND', $2::jsonb, 0, $3, $4) RETURNING id",
    [org, TP_GIA, tc.u, tc.s],
  );
  const nhap = await nguoiNhapNhaCungCap(db.pool, org);
  const goc = { org, pm, pm2, gd1, gd2, tc, tc2, tc3, nhap };
  const chinhSachId = bat ? await batS3(goc) : v1;
  const categoryId = await motId(
    "INSERT INTO procurement_categories (org_id, ma, ten, created_by, created_by_session_id) VALUES ($1, 'THEP', 'Thep', $2, $3) RETURNING id",
    [org, tc.u, tc.s],
  );
  return { ...goc, daBat: bat, chinhSachId, categoryId };
}

interface LoiMoi {
  readonly id: string;
  readonly ncc: string;
  readonly lh: string;
}

/** Gói DRAFT của `pm` có ngân sách (ghim phiên bản `chinhSachId`), nhóm hàng, một hạng mục. */
async function goiNhap(t: ToChuc, uocLuong: string): Promise<string> {
  const rfqId = await motId(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, category_id, created_by, created_by_session_id) " +
      "VALUES ($1, 'Mua thep tam', $2, false, $3, $4, $5) RETURNING id",
    [t.org, MAI_SAU, t.categoryId, t.pm.u, t.pm.s],
  );
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [t.org, rfqId, t.pm.u, t.pm.s],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) VALUES ($1, $2, $3, 'VND', $4, $5, $6)",
    [t.org, rfqId, uocLuong, t.chinhSachId, t.pm.u, t.pm.s],
  );
  return rfqId;
}

/**
 * `soLuong` nhà cung cấp ĐẾM ĐƯỢC (dựng bởi `nhap`, xác minh bởi `tc2`), mời bởi `pm`. Tổ chức CHƯA bật không xác minh được
 * (`082`, ADR-080) — ở đó nhà cung cấp thường là đủ: K2 không chạy.
 */
async function moiDemDuoc(t: ToChuc, rfqId: string, soLuong: number): Promise<LoiMoi[]> {
  if (!t.daBat) {
    const ra: LoiMoi[] = [];
    for (let i = 0; i < soLuong; i += 1) ra.push(await moiKhongDemDuoc(t, rfqId));
    return ra;
  }
  const ds = await nhaCungCapDemDuoc(db.pool, t.org, { nguoiXacMinh: t.tc2, soLuong, nguoiNhap: t.nhap });
  const ra: LoiMoi[] = [];
  for (const n of ds) ra.push({ id: await moi(t, rfqId, n.ncc, n.lh), ncc: n.ncc, lh: n.lh });
  return ra;
}

async function moi(t: ToChuc, rfqId: string, ncc: string, lh: string): Promise<string> {
  return motId(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [t.org, rfqId, ncc, lh, t.pm.u, t.pm.s],
  );
}

/** Một nhà cung cấp KHÔNG đếm được: hồ sơ do chính `pm` (người chọn danh sách) dựng, không xác minh. */
async function moiKhongDemDuoc(t: ToChuc, rfqId: string): Promise<LoiMoi> {
  const hex = randomBytes(4).toString("hex");
  const ncc = await motId("INSERT INTO suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id", [
    t.org,
    `NCC vo ${hex}`,
    `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`,
    t.pm.u,
    t.pm.s,
  ]);
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) VALUES ($1, $2, 'Nguoi ban', $3, $4, $5, $6) RETURNING id",
    [t.org, ncc, `vo${hex}@vidu.vn`, `09${String(randomInt(0, 1e8)).padStart(8, "0")}`, t.pm.u, t.pm.s],
  );
  return { id: await moi(t, rfqId, ncc, lh), ncc, lh };
}

/** Nộp duyệt (câu thô — mọi trigger của cạnh vẫn chạy), ký bởi `pm2` (độc lập), mở gói (câu thô, khoá ký giả). */
async function nopKyMo(t: ToChuc, rfqId: string): Promise<void> {
  await db.pool.query("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [
    rfqId,
    t.pm.u,
    t.pm.s,
  ]);
  await withTenant(apiPool, t.org, async (c) => {
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]!.n;
    await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s, lanNopDaXem: lan }, apiPool);
  });
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [t.org, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), t.pm.u, t.pm.s],
    );
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [
      rfqId,
      t.pm.u,
      t.pm.s,
    ]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Một phiên bản báo giá niêm phong giả trên lời mời đã có — khuôn `nopBaoGia` của `luot-danh-gia.int.test.ts`. */
async function nopBaoGia(t: ToChuc, rfqId: string, lm: LoiMoi): Promise<string> {
  const tk = await motId(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
      "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
    [t.org, lm.id, randomBytes(32), t.pm.u, t.pm.s],
  );
  const tt = await motId(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at, consumed_at) " +
      "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
    [t.org, lm.id, tk, lm.lh, randomBytes(32), randomBytes(32)],
  );
  const pk = await motId(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [t.org, lm.id, tt, randomBytes(32), lm.lh],
  );
  return withTenant(apiPool, t.org, async (c) => {
    const bidId = (await c.query<{ id: string }>("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [t.org, lm.id])).rows[0]!.id;
    const versionId = (
      await c.query<{ id: string }>("INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id", [
        t.org,
        bidId,
        Buffer.alloc(64, 9),
        pk,
      ])
    ).rows[0]!.id;
    await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
      t.org,
      versionId,
      `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bidId}\nversion=1\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-05T00:00:00.000000Z\n`,
      Buffer.alloc(70, 7),
    ]);
    return versionId;
  });
}

/** Đóng sớm, yêu cầu mở thầu (`pm`), duyệt (`gd1`), chèn bản rõ dưới `app_unseal` — khuôn `moThau` của `luot-danh-gia.int.test.ts`. */
async function moThau(t: ToChuc, rfqId: string, banRo: readonly (readonly [string, unknown])[]): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, t.pm.u, t.pm.s],
  );
  const yc = await withTenant(apiPool, t.org, (c) => requestUnseal(c, t.org, { rfqId, reason: "den gio mo thau", actorSessionId: t.pm.s }, apiPool));
  await withTenant(apiPool, t.org, (c) => approveUnseal(c, t.org, { unsealRequestId: yc.id, actorSessionId: t.gd1.s }, apiPool));
  await withTenant(unsealPool, t.org, async (c) => {
    for (const [versionId, payload] of banRo) {
      await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
        t.org,
        yc.id,
        versionId,
        JSON.stringify(payload),
      ]);
    }
    await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
    await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [yc.id]);
  });
}

interface GoiDaCham {
  readonly rfqId: string;
  /** Phiên bản báo giá theo thứ tự `gia` — phần tử đầu là giá thấp nhất khi `gia` tăng dần. */
  readonly banRo: readonly string[];
  readonly luotId: string;
  readonly loiMoi: readonly LoiMoi[];
}

/**
 * Một gói đã chấm, ở EVALUATING: ước lượng `uocLuong`, `soMoi` nhà cung cấp đếm được (mặc định bằng số giá), mỗi giá một báo giá
 * của một nhà cung cấp theo thứ tự mời. `tienTe` áp cho mọi phong bì. `themMoi` chèn thêm lời mời trước khi nộp.
 */
async function goiDaCham(
  t: ToChuc,
  uocLuong: string,
  gia: readonly string[],
  tuyChon: {
    readonly soMoi?: number;
    readonly tienTe?: string;
    readonly themMoi?: (rfqId: string) => Promise<LoiMoi[]>;
    /** Chỉ số lời mời (trong `loiMoi`) nộp từng giá — mặc định theo thứ tự. */
    readonly chon?: readonly number[];
  } = {},
): Promise<GoiDaCham> {
  const rfqId = await goiNhap(t, uocLuong);
  const loiMoi = [...(await moiDemDuoc(t, rfqId, tuyChon.soMoi ?? gia.length)), ...(tuyChon.themMoi === undefined ? [] : await tuyChon.themMoi(rfqId))];
  await nopKyMo(t, rfqId);
  const banRo: string[] = [];
  const ban: [string, unknown][] = [];
  for (const [i, g] of gia.entries()) {
    const lm = loiMoi[tuyChon.chon?.[i] ?? i];
    if (lm === undefined) throw new Error("thiếu lời mời cho báo giá");
    const v = await nopBaoGia(t, rfqId, lm);
    banRo.push(v);
    ban.push([v, { totalAmount: g, currency: tuyChon.tienTe ?? "VND" }]);
  }
  await moThau(t, rfqId, ban);
  const kq = await withTenant(apiPool, t.org, (c) => taoLuotDanhGia(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
  expect(await trangThai(rfqId), "tiền đề: gói phải ở EVALUATING").toBe("EVALUATING");
  return { rfqId, banRo, luotId: kq.evaluationId, loiMoi };
}

async function trangThai(rfqId: string): Promise<string> {
  return (await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]?.status ?? "";
}

const deXuat = (t: ToChuc, rfqId: string, bidVersionId: string, ai: NguoiPhien = t.pm2) =>
  withTenant(apiPool, t.org, (c) => deXuatTraoThau(c, t.org, { rfqId, bidVersionId, reason: "gia thap nhat", actorSessionId: ai.s }, apiPool));
const duyet = (t: ToChuc, rfqId: string, awardId: string, ai: NguoiPhien) =>
  withTenant(apiPool, t.org, (c) => duyetTraoThau(c, t.org, { rfqId, awardId, actorSessionId: ai.s }, apiPool));
const doc = (t: ToChuc, rfqId: string) => withTenant(apiPool, t.org, (c) => docTraoThau(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
const lapNl = (t: ToChuc, rfqId: string, ai: NguoiPhien = t.pm) =>
  withTenant(apiPool, t.org, (c) =>
    lapNgoaiLe(c, t.org, { rfqId, loai: "LOW_ACTUAL_COMPETITION", maLyDo: "NO_ALTERNATIVE", giaiTrinh: GIAI_TRINH, actorSessionId: ai.s }, apiPool),
  );

async function hangAward(rfqId: string): Promise<readonly string[]> {
  return (await db.pool.query<{ status: string }>("SELECT status FROM rfq_awards WHERE rfq_id = $1 ORDER BY acted_at, id", [rfqId])).rows.map((h) => h.status);
}
async function chuKy(awardId: string): Promise<readonly { nguoi: string; vai: string[] | null }[]> {
  return (
    await db.pool.query<{ nguoi: string; vai: string[] | null }>(
      "SELECT approver_user_id AS nguoi, vai_luc_ky AS vai FROM rfq_award_approvals WHERE award_id = $1 ORDER BY approved_at, id",
      [awardId],
    )
  ).rows;
}
async function tuChoiChot(org: string, rfqId: string): Promise<readonly { ma: unknown; actorId: string | null }[]> {
  return (
    await db.pool.query<{ ma: unknown; actorId: string | null }>(
      "SELECT payload->>'ma' AS ma, actor_id::text AS \"actorId\" FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = $2 ORDER BY seq",
      [org, rfqId],
    )
  ).rows;
}
async function hangSo(org: string, action: string, resourceId: string): Promise<number> {
  return Number(
    (await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_events WHERE org_id = $1 AND action = $2 AND resource_id = $3", [org, action, resourceId]))
      .rows[0]?.n ?? "-1",
  );
}

interface LoiBat {
  readonly message: string;
  readonly code: string;
  readonly constraint: string;
  readonly lyDo: string;
}
async function loi(p: Promise<unknown>): Promise<LoiBat | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as Error & { code?: string; constraint?: string; lyDo?: string };
    return { message: x.message, code: x.code ?? "", constraint: x.constraint ?? "", lyDo: x.lyDo ?? "" };
  }
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * ĐỘT BIẾN một hàm lúc chạy: thay đúng MỘT chỗ trong `pg_get_functiondef`, chạy `viec`, rồi khôi phục và TỰ KIỂM bằng sha256 — một
 * lần khôi phục lệch là NÉM, không phải một cụm im lặng mang đột biến sang ca sau.
 */
async function voiDotBien<T>(ham: string, cu: string, moi: string, viec: () => Promise<T>): Promise<T> {
  const goc = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
  expect(goc.split(cu).length - 1, `đột biến phải khớp ĐÚNG một chỗ trong ${ham}`).toBe(1);
  await db.pool.query(goc.replace(cu, moi));
  try {
    return await viec();
  } finally {
    await db.pool.query(goc);
    const sau = (await db.pool.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [ham])).rows[0]!.def;
    if (sha(sau) !== sha(goc)) throw new Error(`khôi phục ${ham} lệch bản gốc`);
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");
}, 240000);

afterAll(async () => {
  await db?.stop();
});

// =============================================================================================
// ⑴ K7 — SỐ CHỮ KÝ THEO BẬC CAO HƠN, CHỮ KÝ SỐNG ĐỘC LẬP
// =============================================================================================
describe("[S1.9101 / S3.5a / K7] số chữ ký theo bậc cao hơn — chữ ký sống độc lập với hàng APPROVED", { timeout: 300000 }, () => {
  it("[INV-K7] ĐỐI CHỨNG DƯƠNG bậc 0: một chữ ký DIRECTOR ⇒ APPROVED ngay, chuKyCan 1, hai hàng sổ (SIGNED, APPROVED), không CONTROL_DENIED", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC0);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect(dx.status).toBe("PROPOSED");
    expect((await doc(t, g.rfqId))?.chuKyCan).toBe(1);
    const kq = await duyet(t, g.rfqId, dx.awardId, t.gd1);
    expect([kq.status, kq.chuKyCan, kq.approvals.map((c) => c.approverUserId)]).toEqual(["APPROVED", 1, [t.gd1.u]]);
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED", "APPROVED"]);
    expect((await chuKy(dx.awardId)).map((c) => c.vai)).toEqual([["DIRECTOR"]]);
    expect(await hangSo(t.org, "RFQ_AWARD_SIGNED", dx.awardId)).toBe(1);
    expect(await hangSo(t.org, "RFQ_AWARD_APPROVED", kq.awardId)).toBe(1);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([]);
  });

  it("[INV-K7] KHAI THẤP: ước lượng bậc 0, giá trúng bậc 1 ⇒ cần HAI — chữ ký đầu SỐNG, gọi lặp là DA_KY_DE_XUAT_NAY, người thứ hai ⇒ APPROVED; ĐỘT BIẾN lấy bậc ước lượng ⇒ một chữ ký duyệt", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await doc(t, g.rfqId))?.chuKyCan, "bậc cao hơn là bậc của số tiền trao").toBe(2);

    const mot = await duyet(t, g.rfqId, dx.awardId, t.gd1);
    expect([mot.status, mot.chuKyCan, mot.approvals.length], "chữ ký đầu còn đó, hàng đề xuất đứng yên").toEqual(["PROPOSED", 2, 1]);
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED"]);
    expect(await trangThai(g.rfqId)).toBe("AWARDED");

    const lap = await loi(duyet(t, g.rfqId, dx.awardId, t.gd1));
    expect(lap?.lyDo).toBe("DA_KY_DE_XUAT_NAY");
    expect(await hangSo(t.org, "RFQ_STATE_DENIED", g.rfqId)).toBe(1);
    expect((await chuKy(dx.awardId)).length, "lần gọi lặp không chèn thêm chữ ký").toBe(1);

    const hai = await duyet(t, g.rfqId, dx.awardId, t.gd2);
    expect([hai.status, hai.approvals.map((c) => c.approverUserId)]).toEqual(["APPROVED", [t.gd1.u, t.gd2.u]]);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([]);

    // ĐỘT BIẾN: bậc cao hơn ⇐ bậc ước lượng (bỏ `greatest`) ⇒ bậc 0 ⇒ một chữ ký duyệt được. Ca MỚI, gói MỚI — ở tổ chức MỚI: hai
    // gói 50 triệu cùng nhóm hàng trong một tổ chức chạm cận 100 triệu và K10a đòi ghi nhận tín hiệu chia nhỏ trước khi mở.
    const t2 = await taoToChuc();
    const g2 = await goiDaCham(t2, UL_BAC0, GIA_BAC1);
    await voiDotBien("public.award_bac_cao_hon(uuid, uuid, uuid)", "tu_cao := greatest(tu_trao, (bac_ul ->> 'tu_so_tien')::numeric);", "tu_cao := (bac_ul ->> 'tu_so_tien')::numeric;", async () => {
      const dx2 = await deXuat(t2, g2.rfqId, g2.banRo[0]!);
      expect((await duyet(t2, g2.rfqId, dx2.awardId, t2.gd1)).status, "đột biến: bậc ước lượng ⇒ một chữ ký đủ").toBe("APPROVED");
    });
  });

  it("[INV-K7] SAI VAI: bậc 1 chỉ nhận DIRECTOR — FINANCE ký ⇒ K7_SAI_VAI + CONTROL_DENIED đúng người, không chữ ký; hai DIRECTOR ⇒ APPROVED; ĐỘT BIẾN bỏ vế vai ⇒ chữ ký FINANCE được nhận", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    const e = await loi(duyet(t, g.rfqId, dx.awardId, t.tc3));
    expect([e?.lyDo, e?.message]).toEqual(["K7_SAI_VAI", CHOT_VAO_SO.K7_SAI_VAI.thongDiep]);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K7_SAI_VAI", actorId: t.tc3.u }]);
    expect(await chuKy(dx.awardId)).toEqual([]);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status).toBe("APPROVED");

    const g2 = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    await voiDotBien("public.award_chot_nguoi_ky(uuid, uuid, uuid)", "IF cardinality(vai) = 0 THEN", "IF cardinality(vai) < 0 THEN", async () => {
      const dx2 = await deXuat(t, g2.rfqId, g2.banRo[0]!);
      const kq = await duyet(t, g2.rfqId, dx2.awardId, t.tc3);
      expect([kq.status, kq.approvals.length], "đột biến: FINANCE ký được ở bậc chỉ cho DIRECTOR").toEqual(["PROPOSED", 1]);
      expect((await chuKy(dx2.awardId)).map((c) => c.vai), "vai_luc_ky chụp giao RỖNG — bằng chứng vai không thuộc bậc").toEqual([[]]);
    });
  });

  it("[INV-K7] TÁC GIẢ CHÍNH SÁCH: người khai phiên bản ghim ký ⇒ K7_TAC_GIA_CHINH_SACH; FINANCE khác ⇒ APPROVED; ĐỘT BIẾN bỏ vế ⇒ tác giả duyệt được", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC0);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    const e = await loi(duyet(t, g.rfqId, dx.awardId, t.tc));
    expect(e?.lyDo).toBe("K7_TAC_GIA_CHINH_SACH");
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K7_TAC_GIA_CHINH_SACH", actorId: t.tc.u }]);
    expect((await duyet(t, g.rfqId, dx.awardId, t.tc3)).status).toBe("APPROVED");

    const t2 = await taoToChuc();
    const g2 = await goiDaCham(t2, UL_BAC0, GIA_BAC0);
    await voiDotBien("public.award_chot_nguoi_ky(uuid, uuid, uuid)", "AND p.created_by = p_user) THEN", "AND p.created_by = p_user AND false) THEN", async () => {
      const dx2 = await deXuat(t2, g2.rfqId, g2.banRo[0]!);
      expect((await duyet(t2, g2.rfqId, dx2.awardId, t2.tc)).status, "đột biến: tác giả chính sách duyệt được").toBe("APPROVED");
    });
  });

  it("[INV-K7] VAI KHÁC NHAU (bậc 2): hai FINANCE chưa đủ, thêm DIRECTOR ⇒ APPROVED, vai_luc_ky chụp đúng; ĐỘT BIẾN bỏ vế ⇒ hai FINANCE duyệt", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await duyet(t, g.rfqId, dx.awardId, t.tc3)).status).toBe("PROPOSED");
    // tc2 là người xác minh nhà cung cấp thắng — thuộc tập loại trừ của K5b, nhưng vẫn ký được; K5b chỉ đòi MỘT người ngoài tập.
    const hai = await duyet(t, g.rfqId, dx.awardId, t.tc2);
    expect([hai.status, hai.approvals.length], "hai người cùng vai FINANCE — đủ số, chưa đủ vai").toEqual(["PROPOSED", 2]);
    const ba = await duyet(t, g.rfqId, dx.awardId, t.gd1);
    expect(ba.status).toBe("APPROVED");
    expect((await chuKy(dx.awardId)).map((c) => c.vai)).toEqual([["FINANCE"], ["FINANCE"], ["DIRECTOR"]]);

    const g2 = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    await voiDotBien("public.award_du_chu_ky(uuid, uuid)", "IF NOT coalesce((bac ->> 'award_vai_khac_nhau')::boolean, false) THEN", "IF true THEN", async () => {
      const dx2 = await deXuat(t, g2.rfqId, g2.banRo[0]!);
      expect((await duyet(t, g2.rfqId, dx2.awardId, t.tc3)).status).toBe("PROPOSED");
      expect((await duyet(t, g2.rfqId, dx2.awardId, t.tc2)).status, "đột biến: hai FINANCE duyệt được bậc đòi hai vai").toBe("APPROVED");
    });
  });

  it("[INV-K7] ĐẤU THẦU CHÍNH THỨC: giá trúng rơi bậc 3 ⇒ đề xuất bị K7_DAU_THAU_CHINH_THUC, CONTROL_DENIED, gói ở EVALUATING, không hàng award; ĐỘT BIẾN bỏ vế ⇒ đề xuất đi qua", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_DTCT);
    const e = await loi(deXuat(t, g.rfqId, g.banRo[0]!));
    expect([e?.lyDo, e?.message]).toEqual(["K7_DAU_THAU_CHINH_THUC", CHOT_VAO_SO.K7_DAU_THAU_CHINH_THUC.thongDiep]);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K7_DAU_THAU_CHINH_THUC", actorId: t.pm2.u }]);
    expect(await hangAward(g.rfqId)).toEqual([]);
    expect(await trangThai(g.rfqId)).toBe("EVALUATING");

    // ĐỘT BIẾN: bỏ vế đấu thầu chính thức ⇒ lời có tên biến mất; lớp hai (hàm theo bậc NÉM khi bậc không khai `so_ncc_toi_thieu`,
    // ADR-082 ⑽) vẫn chặn bằng một lỗi KHÔNG tên, không hàng sổ — đúng cái giá của "NÉM thay vì cho qua".
    await voiDotBien("public.award_chot_bac(uuid, uuid, uuid)", "IF (bac ->> 'dau_thau_chinh_thuc')::boolean IS NOT FALSE THEN", "IF false THEN", async () => {
      const e2 = await loi(deXuat(t, g.rfqId, g.banRo[0]!));
      expect([e2?.code, e2?.lyDo], "đột biến: không còn lời có tên, chỉ còn NÉM của lớp hai").toEqual(["23514", ""]);
      expect(e2?.message).toMatch(/thieu so_ncc_toi_thieu/u);
    });
    expect(await tuChoiChot(t.org, g.rfqId), "lần NÉM của lớp hai không để lại hàng sổ").toHaveLength(1);
  });

  it("[INV-K7] GÓI KHÔNG BẬC GHIM ở tổ chức đã bật (rời DRAFT trước lần bật) ⇒ K7_KHONG_BAC_GHIM, CONTROL_DENIED; tổ chức chưa bật trao được bằng một chữ ký", async () => {
    const t0 = await taoToChuc(false);
    const g = await goiDaCham(t0, UL_BAC1, GIA_BAC1);
    expect((await db.pool.query<{ b: string | null }>("SELECT tier_tu_so_tien::text AS b FROM rfq_budgets WHERE rfq_id = $1", [g.rfqId])).rows[0]?.b, "tiền đề: không bậc ghim").toBeNull();
    // Một gói CHỊ EM cùng tổ chức, chưa bật: một chữ ký FINANCE duyệt — MVP1 nguyên văn.
    const g0 = await goiDaCham(t0, UL_BAC1, GIA_BAC1);
    const dx0 = await deXuat(t0, g0.rfqId, g0.banRo[0]!);
    expect((await duyet(t0, g0.rfqId, dx0.awardId, t0.tc)).status, "tổ chức chưa bật: một chữ ký, kể cả của tác giả chính sách").toBe("APPROVED");

    await batS3(t0);
    const e = await loi(deXuat(t0, g.rfqId, g.banRo[0]!));
    expect(e?.lyDo).toBe("K7_KHONG_BAC_GHIM");
    expect(await tuChoiChot(t0.org, g.rfqId)).toEqual([{ ma: "K7_KHONG_BAC_GHIM", actorId: t0.pm2.u }]);
    expect(await hangAward(g.rfqId)).toEqual([]);
  });

  it("[INV-K7] TIỀN TỆ LỆCH: báo giá USD dưới chính sách VND ⇒ hàm vị từ trả K7_LECH_TIEN_TE và đường đề xuất từ chối có tên", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC0, { tienTe: "USD" });
    const ma = (await db.pool.query<{ m: string | null }>("SELECT public.award_chot_bac($1, $2, $3) AS m", [t.org, g.rfqId, g.banRo[0]])).rows[0]?.m;
    expect(ma).toBe("K7_LECH_TIEN_TE");
    const e = await loi(deXuat(t, g.rfqId, g.banRo[0]!));
    expect(e?.lyDo).toBe("K7_LECH_TIEN_TE");
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K7_LECH_TIEN_TE", actorId: t.pm2.u }]);
  });

  it("[INV-K7] LỚP CHẶN CUỐI: hàng APPROVED thô với MỘT chữ ký ở bậc cần hai ⇒ trigger từ chối `k7_thieu_chu_ky` (23514), không CONTROL_DENIED; đủ hai ⇒ câu thô đi qua", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    await duyet(t, g.rfqId, dx.awardId, t.gd1);
    const chenTho = (ai: NguoiPhien) =>
      withTenant(apiPool, t.org, (c) =>
        c.query(
          "INSERT INTO rfq_awards (org_id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_by_session_id) VALUES ($1, $2, $3, $4, 'APPROVED', 'cau tho', $5, $6)",
          [t.org, g.rfqId, g.luotId, g.banRo[0], ai.u, ai.s],
        ),
      );
    const e = await loi(chenTho(t.gd1));
    expect([e?.code, e?.constraint]).toEqual(["23514", "k7_thieu_chu_ky"]);
    expect(await tuChoiChot(t.org, g.rfqId), "lời *chưa đủ* không qua bảng tên → mã").toEqual([]);
    await duyet(t, g.rfqId, dx.awardId, t.gd2);
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED", "APPROVED"]);
  });
});

// =============================================================================================
// ⑵ K2b — HẬU KIỂM SỐ BÁO GIÁ HỢP LỆ
// =============================================================================================
describe("[S1.9101 / S3.5a / K2b] hậu kiểm: số nhóm có báo giá hợp lệ dưới ngưỡng của bậc cao hơn", { timeout: 300000 }, () => {
  it("[INV-K2b] hai mời đếm được, MỘT báo giá ở bậc cần hai ⇒ đề xuất bị K2B_THIEU_CANH_TRANH_THUC; ngoại lệ LOW_ACTUAL_COMPETITION ở EVALUATING cứu; lập hay rút ở AWARDED ⇒ K2B_NGOAI_LE_SAI_TRANG_THAI; ĐỘT BIẾN bỏ hậu kiểm ⇒ đề xuất không ngoại lệ đi qua", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC1, [GIA_BAC1[0]!], { soMoi: 2 });
    const e = await loi(deXuat(t, g.rfqId, g.banRo[0]!));
    expect([e?.lyDo, e?.message]).toEqual(["K2B_THIEU_CANH_TRANH_THUC", CHOT_VAO_SO.K2B_THIEU_CANH_TRANH_THUC.thongDiep]);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K2B_THIEU_CANH_TRANH_THUC", actorId: t.pm2.u }]);
    expect(await hangAward(g.rfqId)).toEqual([]);

    const nl = await lapNl(t, g.rfqId);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect(dx.status).toBe("PROPOSED");
    // Ở AWARDED: không lập thêm, không rút — ngoại lệ mà lần duyệt dựa vào đứng yên.
    const lapMuon = await loi(lapNl(t, g.rfqId));
    expect(lapMuon?.lyDo).toBe("K2B_NGOAI_LE_SAI_TRANG_THAI");
    const rutMuon = await loi(
      withTenant(apiPool, t.org, (c) => rutNgoaiLe(c, t.org, { rfqId: g.rfqId, exceptionId: nl.id, reason: "rut sau de xuat", actorSessionId: t.pm.s }, apiPool)),
    );
    expect(rutMuon?.lyDo).toBe("K2B_NGOAI_LE_SAI_TRANG_THAI");
    expect((await tuChoiChot(t.org, g.rfqId)).map((h) => h.ma)).toEqual(["K2B_THIEU_CANH_TRANH_THUC", "K2B_NGOAI_LE_SAI_TRANG_THAI", "K2B_NGOAI_LE_SAI_TRANG_THAI"]);
    // Gói có ngoại lệ ⇒ K5b đòi một chữ ký ngoài tập; gd1, gd2 không chọn danh sách, không điều phối, không xác minh ⇒ qua.
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status).toBe("APPROVED");

    const g2 = await goiDaCham(t, UL_BAC1, [GIA_BAC1[0]!], { soMoi: 2 });
    await voiDotBien("public.award_chot_hau_kiem(uuid, uuid, uuid, uuid)", "RETURN 'K2B_THIEU_CANH_TRANH_THUC';", "RETURN NULL;", async () => {
      expect((await deXuat(t, g2.rfqId, g2.banRo[0]!)).status, "đột biến: dưới ngưỡng không ngoại lệ vẫn đề xuất được").toBe("PROPOSED");
    });
  });

  it("[INV-K2b] nhà cung cấp KHÔNG đếm được (hồ sơ do người chọn danh sách dựng) nộp báo giá không nâng số đếm; ĐỘT BIẾN đếm mọi lời mời ⇒ qua", async () => {
    const t = await taoToChuc();
    // Hai mời đếm được (K2 lúc nộp cần hai) cộng một nhà vỏ; báo giá về từ MỘT nhà đếm được và nhà vỏ ⇒ số nhóm đếm được có báo giá
    // = 1 < 2, dù hai báo giá hợp lệ về.
    const g2 = await goiDaCham(t, UL_BAC1, [GIA_BAC1[0]!, GIA_BAC1[1]!], { soMoi: 2, chon: [0, 2], themMoi: async (rfqId) => [await moiKhongDemDuoc(t, rfqId)] });
    expect((await db.pool.query<{ n: number }>("SELECT public.award_dem_nhom_bao_gia($1, $2, $3) AS n", [t.org, g2.rfqId, g2.luotId])).rows[0]?.n).toBe(1);
    const e = await loi(deXuat(t, g2.rfqId, g2.banRo[0]!));
    expect(e?.lyDo).toBe("K2B_THIEU_CANH_TRANH_THUC");
    await voiDotBien("public.award_dem_nhom_bao_gia(uuid, uuid, uuid)", "FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) AS t(d)", "FROM (SELECT i.id FROM public.rfq_invitations i WHERE i.org_id = p_org AND i.rfq_id = p_rfq) AS t(d)", async () => {
      expect((await db.pool.query<{ n: number }>("SELECT public.award_dem_nhom_bao_gia($1, $2, $3) AS n", [t.org, g2.rfqId, g2.luotId])).rows[0]?.n, "đột biến: nhà vỏ đếm").toBe(2);
      expect((await deXuat(t, g2.rfqId, g2.banRo[0]!)).status).toBe("PROPOSED");
    });
  });

  it("[INV-K2b] LỚP CHẶN CUỐI: tắt trigger cạnh đề xuất thì đề xuất thô đi qua, nhưng hàng APPROVED thô vẫn bị `k2b_thieu_canh_tranh_thuc`", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC1, [GIA_BAC1[0]!], { soMoi: 2 });
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE public.rfq_awards DISABLE TRIGGER rfq_awards_kiem_theo_bac_khi_de_xuat");
      const dxId = (
        await c.query<{ id: string }>(
          "INSERT INTO rfq_awards (org_id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_by_session_id) VALUES ($1, $2, $3, $4, 'PROPOSED', 'tho', $5, $6) RETURNING id",
          [t.org, g.rfqId, g.luotId, g.banRo[0], t.pm2.u, t.pm2.s],
        )
      ).rows[0]!.id;
      await c.query("INSERT INTO rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [t.org, dxId, t.gd1.u, t.gd1.s]);
      await c.query("INSERT INTO rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [t.org, dxId, t.gd2.u, t.gd2.s]);
      await c.query("SAVEPOINT s");
      const e = await loi(
        c.query(
          "INSERT INTO rfq_awards (org_id, rfq_id, evaluation_id, bid_version_id, status, reason, acted_by, acted_by_session_id) VALUES ($1, $2, $3, $4, 'APPROVED', 'tho', $5, $6)",
          [t.org, g.rfqId, g.luotId, g.banRo[0], t.gd2.u, t.gd2.s],
        ),
      );
      expect([e?.code, e?.constraint]).toEqual(["23514", "k2b_thieu_canh_tranh_thuc"]);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

// =============================================================================================
// ⑶ K5b — CHỮ KÝ TRAO THẦU ĐỘC LẬP
// =============================================================================================
describe("[S1.9101 / S3.5a / K5b] chữ ký trao thầu của người ngoài tập loại trừ", { timeout: 300000 }, () => {
  /** Ghi `gd1` là người ĐÃ TỪNG điều phối mở gói — hàng lịch sử của `064`. */
  async function gd1DieuPhoi(t: ToChuc, rfqId: string): Promise<void> {
    const yc = (await db.pool.query<{ id: string }>("SELECT id FROM unseal_requests WHERE rfq_id = $1", [rfqId])).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO unseal_dispatch_history (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id) VALUES ($1, $2, $3, $4, $5)",
      [t.org, yc, rfqId, t.gd1.u, t.gd1.s],
    );
  }

  it("[INV-K5b] bậc 2 ký danh sách: người xác minh nhà cung cấp thắng (tc2) + người điều phối (gd1) ⇒ K5B_THIEU_CHU_KY_DOC_LAP khi đủ số, chữ ký cuối rơi; gd2 ⇒ APPROVED; ĐỘT BIẾN bỏ hai vế của tập ⇒ hai người ấy duyệt", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    await gd1DieuPhoi(t, g.rfqId);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await duyet(t, g.rfqId, dx.awardId, t.tc2)).status).toBe("PROPOSED");
    const e = await loi(duyet(t, g.rfqId, dx.awardId, t.gd1));
    expect([e?.lyDo, e?.message]).toEqual(["K5B_THIEU_CHU_KY_DOC_LAP", CHOT_VAO_SO.K5B_THIEU_CHU_KY_DOC_LAP.thongDiep]);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K5B_THIEU_CHU_KY_DOC_LAP", actorId: t.gd1.u }]);
    expect((await chuKy(dx.awardId)).map((c) => c.nguoi), "chữ ký của lần bị từ chối rơi theo giao dịch — chữ ký trước còn").toEqual([t.tc2.u]);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status).toBe("APPROVED");

    const g2 = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    await gd1DieuPhoi(t, g2.rfqId);
    const dx2 = await deXuat(t, g2.rfqId, g2.banRo[0]!);
    await duyet(t, g2.rfqId, dx2.awardId, t.tc2);
    await voiDotBien(
      "public.award_tap_loai_tru(uuid, uuid, uuid)",
      "SELECT h.dispatched_by FROM public.unseal_dispatch_history h WHERE h.org_id = p_org AND h.rfq_id = p_rfq",
      "SELECT NULL::uuid WHERE false",
      async () => {
        const e2 = await loi(duyet(t, g2.rfqId, dx2.awardId, t.gd1));
        expect(e2?.lyDo, "bỏ riêng vế điều phối: gd1 thoát tập nhưng vẫn phải là người độc lập — ca qua").toBeUndefined();
        expect(await hangAward(g2.rfqId)).toEqual(["PROPOSED", "APPROVED"]);
      },
    );
    const g3 = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    const dx3 = await deXuat(t, g3.rfqId, g3.banRo[0]!);
    await duyet(t, g3.rfqId, dx3.awardId, t.tc3);
    await voiDotBien("public.award_tap_loai_tru(uuid, uuid, uuid)", "ORDER BY v.thu_tu DESC\n             LIMIT 1) m", "ORDER BY v.thu_tu DESC\n             LIMIT 0) m", async () => {
      // tc3 + tc2: cùng vai ⇒ chưa đủ vai; thêm gd1 KHÔNG điều phối ở gói này ⇒ độc lập ⇒ qua dù vế xác minh bị bỏ. Đo vế xác minh
      // bằng hàm: tc2 không còn trong tập.
      const trong = (await db.pool.query<{ co: boolean }>("SELECT EXISTS (SELECT 1 FROM public.award_tap_loai_tru($1, $2, $3) t(n) WHERE t.n = $4) AS co", [t.org, g3.rfqId, g3.banRo[0], t.tc2.u])).rows[0]?.co;
      expect(trong, "đột biến: người xác minh rời tập loại trừ").toBe(false);
    });
    expect((await db.pool.query<{ co: boolean }>("SELECT EXISTS (SELECT 1 FROM public.award_tap_loai_tru($1, $2, $3) t(n) WHERE t.n = $4) AS co", [t.org, g3.rfqId, g3.banRo[0], t.tc2.u])).rows[0]?.co, "bản thật: người xác minh ở trong tập").toBe(true);
  });

  it("[INV-K5b] KHAI THẤP không ký danh sách, không ngoại lệ: bậc trao > bậc ước lượng vẫn đòi — hai người trong tập (tc2 xác minh, gd1 điều phối) ⇒ từ chối; ĐỘT BIẾN bỏ vế bậc ⇒ qua; ĐỐI CHỨNG ÂM bậc trao = ước lượng ⇒ hai người ấy duyệt được", async () => {
    const t = await taoToChuc();
    // Bậc ước lượng 0 (không ký danh sách), giá trúng bậc 1 (vai chỉ DIRECTOR) — nên dùng gd1 + gd2 với gd2 cũng điều phối.
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    await gd1DieuPhoi(t, g.rfqId);
    await db.pool.query(
      "INSERT INTO unseal_dispatch_history (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id) " +
        "SELECT org_id, id, rfq_id, $2, $3 FROM unseal_requests WHERE rfq_id = $1",
      [g.rfqId, t.gd2.u, t.gd2.s],
    );
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
    expect((await loi(duyet(t, g.rfqId, dx.awardId, t.gd2)))?.lyDo).toBe("K5B_THIEU_CHU_KY_DOC_LAP");
    await voiDotBien("public.award_chot_doc_lap(uuid, uuid)", "OR (bac ->> 'tu_so_tien')::numeric > (bac_ul ->> 'tu_so_tien')::numeric", "OR false", async () => {
      expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status, "đột biến: khai thấp không còn đòi chữ ký độc lập").toBe("APPROVED");
    });

    // ĐỐI CHỨNG ÂM: bậc 1 ước lượng, bậc 1 trao, không ký danh sách, không ngoại lệ ⇒ K5b không đòi — hai người điều phối duyệt được.
    const g0 = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    await gd1DieuPhoi(t, g0.rfqId);
    await db.pool.query(
      "INSERT INTO unseal_dispatch_history (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id) " +
        "SELECT org_id, id, rfq_id, $2, $3 FROM unseal_requests WHERE rfq_id = $1",
      [g0.rfqId, t.gd2.u, t.gd2.s],
    );
    const dx0 = await deXuat(t, g0.rfqId, g0.banRo[0]!);
    await duyet(t, g0.rfqId, dx0.awardId, t.gd1);
    expect((await duyet(t, g0.rfqId, dx0.awardId, t.gd2)).status).toBe("APPROVED");
    expect(await tuChoiChot(t.org, g0.rfqId)).toEqual([]);
  });
});

// =============================================================================================
// ⑷ K12 — HAI BẢNG KHÔNG TRÔI KHỎI NHAU
// =============================================================================================
describe("[S1.9101 / S3.5a / K12] tập mã của các hàm vị từ BẰNG các dòng K7, K2b, K5b của CHOT_VAO_SO", () => {
  it("[INV-K7] [INV-K2b] [INV-K5b] mã trong thân năm hàm SQL = tập khoá có `chot` K7/K2b/K5b", async () => {
    const ham = [
      "public.award_chot_bac(uuid, uuid, uuid)",
      "public.award_chot_nguoi_ky(uuid, uuid, uuid)",
      "public.award_chot_hau_kiem(uuid, uuid, uuid, uuid)",
      "public.award_chot_doc_lap(uuid, uuid)",
      "public.ngoai_le_kiem()",
    ];
    const trongHam = new Set<string>();
    for (const h of ham) {
      const src = (await db.pool.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = $1::regprocedure", [h])).rows[0]!.s;
      for (const m of src.matchAll(/'(K7_[A-Z_]+|K2B_[A-Z_]+|K5B_[A-Z_]+)'/g)) trongHam.add(m[1]!);
      for (const m of src.matchAll(/CONSTRAINT = '(k7_[a-z_]+|k2b_[a-z_]+|k5b_[a-z_]+)'/g)) trongHam.add(m[1]!.toUpperCase());
    }
    const trongBang = new Set(Object.entries(CHOT_VAO_SO).filter(([, d]) => d.chot === "K7" || d.chot === "K2b" || d.chot === "K5b").map(([k]) => k));
    expect([...trongHam].sort()).toEqual([...trongBang].sort());
    expect(trongBang.size).toBe(8);
  });
});
