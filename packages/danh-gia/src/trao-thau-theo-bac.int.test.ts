// ==============================================================================================
// [S1.280 / S3.5a · spec S3 §2.4 ⑹iv ⑺, §4.7, §5.1 · K7 · K2b · K5b · K12] AWARD THEO BẬC — PHÉP ĐO TRÊN POSTGRES 16, DƯỚI `app_api`
//
// Migration `113_trao_thau_theo_bac`, ba lần hỏi trước của `trao-thau.ts` (`deXuatTraoThau`, `duyetTraoThau`). Hợp đồng đo ở đây:
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
//   ⑸ [S1.283 / S3.4b · K9] chữ ký của người đã khai `CO_XUNG_DOT` trên gói — kể cả SAU khi ký — không đếm ở K7 (đủ chữ ký, hai
//      vai) lẫn K5b (chữ ký độc lập): `115` đặt ba phép ấy trên `award_chu_ky_con_hieu_luc`; lời trả về đánh dấu chữ ký ấy.
// Mỗi vế có một ĐỘT BIẾN trong chính tệp này (định nghĩa lại hàm lúc chạy, khôi phục bằng `pg_get_functiondef` và tự kiểm sha256).
// Gói đi DRAFT→OPEN bằng câu thô dưới chủ cụm cộng `approveRfq` (mọi trigger của cạnh vẫn chạy — ENABLE ALWAYS), báo giá và mở
// niêm phong chèn thẳng (khuôn `luot-danh-gia.int.test.ts`), chấm bằng `taoLuotDanhGia`, trao thầu bằng hàm gói.
// ==============================================================================================
import { createHash, randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { CHOT_THEO_RANG_BUOC, CHOT_VAO_SO } from "@trustprocure/identity";
import { lapNgoaiLe, revokeInvitation, rutNgoaiLe } from "@trustprocure/invitation";
import { ghiNhanTinHieu, lietKeTinHieu } from "@trustprocure/kiem-soat";
import { approveRfq, closeRfq } from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, nhaCungCapDemDuoc, startPostgres, type NguoiPhien, type TestDatabase } from "@trustprocure/test-support";
import { approveUnseal, requestUnseal } from "@trustprocure/unseal";
import { taoLuotDanhGia } from "./luot-danh-gia.js";
import { deXuatTraoThau, docTraoThau, duyetTraoThau, rutDeXuatTraoThau } from "./trao-thau.js";

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
async function batS3(t: Omit<ToChuc, "chinhSachId" | "categoryId" | "daBat">, nguongKep = "5000000000.00"): Promise<string> {
  const v2 = await motId(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, tiers, " +
      "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
      "VALUES ($1, 2, $6, 'VND', $2::jsonb, 0, $3::jsonb, 30, 12, true, now(), $4, $5) RETURNING id",
    [t.org, TP_GIA, JSON.stringify(BAC), t.tc.u, t.tc.s, nguongKep],
  );
  await db.pool.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
    t.org,
    v2,
    t.tc2.u,
    t.tc2.s,
  ]);
  return v2;
}

async function taoToChuc(bat = true, nguongKep = "5000000000.00"): Promise<ToChuc> {
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
  const chinhSachId = bat ? await batS3(goc, nguongKep) : v1;
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

/**
 * Đóng sớm, yêu cầu mở thầu (`pm`), duyệt (`gd1`), chèn bản rõ dưới `app_unseal` — khuôn `moThau` của `luot-danh-gia.int.test.ts`.
 * [S1.289 / S3.6c] `dongQuaGoi`: đóng bằng `closeRfq` dưới phiên người ấy (hàng tín hiệu ĐÓNG SỚM ghi ở cạnh đóng) thay cho câu thô.
 */
async function moThau(t: ToChuc, rfqId: string, banRo: readonly (readonly [string, unknown])[], tuyChon: { readonly dongQuaGoi?: NguoiPhien } = {}): Promise<void> {
  if (tuyChon.dongQuaGoi !== undefined) {
    const ai = tuyChon.dongQuaGoi;
    await withTenant(apiPool, t.org, (c) => closeRfq(c, t.org, { rfqId, reason: "dong som de kiem tra", actorSessionId: ai.s }));
  } else {
    await db.pool.query(
      "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
      [rfqId, t.pm.u, t.pm.s],
    );
  }
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
    /** [S1.289 / S3.6c] Đóng bằng `closeRfq` dưới phiên người này thay cho câu thô. */
    readonly dongQuaGoi?: NguoiPhien;
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
  await moThau(t, rfqId, ban, tuyChon.dongQuaGoi === undefined ? {} : { dongQuaGoi: tuyChon.dongQuaGoi });
  const kq = await withTenant(apiPool, t.org, (c) => taoLuotDanhGia(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
  expect(await trangThai(rfqId), "tiền đề: gói phải ở EVALUATING").toBe("EVALUATING");
  return { rfqId, banRo, luotId: kq.evaluationId, loiMoi };
}

async function trangThai(rfqId: string): Promise<string> {
  return (await db.pool.query<{ status: string }>("SELECT status FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]?.status ?? "";
}

const deXuat = (t: ToChuc, rfqId: string, bidVersionId: string, ai: NguoiPhien = t.pm2) =>
  withTenant(apiPool, t.org, (c) => deXuatTraoThau(c, t.org, { rfqId, bidVersionId, reason: "gia thap nhat", actorSessionId: ai.s }, apiPool));
/**
 * [S1.285 / S3.6d / K10b] Ghi nhận tín hiệu khai thấp của gói — một người giữ `po.approve` ngoài gói. Các ca KHAI THẤP của K7/K5b (ước
 * lượng bậc 0, giá trúng bậc 1) nay có tín hiệu `ESTIMATE_UNDERSTATED` chặn chữ ký cho tới khi nó được đọc: gọi trước chữ ký đầu.
 */
const ghiNhanKhaiThap = (t: ToChuc, rfqId: string, ai: NguoiPhien) =>
  withTenant(apiPool, t.org, (c) =>
    ghiNhanTinHieu(c, t.org, { rfqId, lyDo: "Da doc: gia thi truong tang sau khi uoc luong; trao dung bao gia thap nhat.", actorSessionId: ai.s, loai: "ESTIMATE_UNDERSTATED" }, apiPool),
  );
/** [S1.289 / S3.6c / K10c] Ghi nhận một tín hiệu của lượt mời thầu (thu hẹp danh sách / đóng sớm) — người giữ `po.approve` ngoài gói. */
const ghiNhanTT = (t: ToChuc, rfqId: string, ai: NguoiPhien, loai: "INVITE_LIST_NARROWED" | "EARLY_CLOSE") =>
  withTenant(apiPool, t.org, (c) => ghiNhanTinHieu(c, t.org, { rfqId, lyDo: "Da doc tin hieu cua luot moi thau.", actorSessionId: ai.s, loai }, apiPool));
/** Chữ ký duyệt trao thầu THÔ của tầng gói — không ghi nhận gì trước. */
const duyetTho = (t: ToChuc, rfqId: string, awardId: string, ai: NguoiPhien) =>
  withTenant(apiPool, t.org, (c) => duyetTraoThau(c, t.org, { rfqId, awardId, actorSessionId: ai.s }, apiPool));
/**
 * [S1.289 / S3.6c / K10c] Mọi fixture của tệp đóng gói SỚM khi đã có báo giá (`moThau`), nên ở tổ chức đã bật mọi chữ ký trao thầu nay
 * đi qua K10c: trước khi ký, `gd2` (giữ `po.approve`, ngoài gói — không tạo, không nộp, không đóng) ghi nhận tín hiệu ĐÓNG SỚM nếu nó
 * còn chờ. Ghi nhận là đọc, không phải ký thay; nó không để hàng `CONTROL_DENIED` nào. K10c tự đo ở khối ⑶c bằng `duyetTho`.
 */
const duyet = async (t: ToChuc, rfqId: string, awardId: string, ai: NguoiPhien) => {
  if (t.daBat) {
    const th = await withTenant(apiPool, t.org, (c) => lietKeTinHieu(c, t.org, { rfqId, actorSessionId: t.gd2.s }));
    if (th.dongSom.canGhiNhan) await ghiNhanTT(t, rfqId, t.gd2, "EARLY_CLOSE");
  }
  return duyetTho(t, rfqId, awardId, ai);
};
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
describe("[S1.280 / S3.5a / K7] số chữ ký theo bậc cao hơn — chữ ký sống độc lập với hàng APPROVED", { timeout: 300000 }, () => {
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
    // [S1.285 / S3.6d] Khai thấp ⇒ tín hiệu K10b: gd2 đọc trước khi ai ký.
    await ghiNhanKhaiThap(t, g.rfqId, t.gd2);

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
      await ghiNhanKhaiThap(t2, g2.rfqId, t2.gd2);
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
describe("[S1.280 / S3.5a / K2b] hậu kiểm: số nhóm có báo giá hợp lệ dưới ngưỡng của bậc cao hơn", { timeout: 300000 }, () => {
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
      // [S1.289 / S3.6c / K10c] Fixture đóng gói SỚM khi đã có báo giá ⇒ chữ ký thô dưới đây bị K10c chặn trước khi tới hàng APPROVED; vế
      // đo ở ca này là `k2b_thieu_canh_tranh_thuc` trên hàng APPROVED, nên tắt trigger K10c trong cùng giao dịch (K10c đo ở khối ⑶c).
      await c.query("ALTER TABLE public.rfq_award_approvals DISABLE TRIGGER rfq_award_approvals_kiem_tin_hieu_khai_thap");
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
describe("[S1.280 / S3.5a / K5b] chữ ký trao thầu của người ngoài tập loại trừ", { timeout: 300000 }, () => {
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
    // [S1.285 / S3.6d] Khai thấp ⇒ tín hiệu K10b: tc3 (ngoài gói) đọc trước khi ai ký.
    await ghiNhanKhaiThap(t, g.rfqId, t.tc3);
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
// ⑶b K10b — TÍN HIỆU KHAI THẤP ƯỚC LƯỢNG VÀ K10 Ở CHỮ KÝ TRAO THẦU (S3.6d, `116`)
// =============================================================================================
describe("[S1.285 / S3.6d / K10b] tín hiệu khai thấp ước lượng — ghi ở đề xuất, chặn chữ ký cho tới khi người độc lập ghi nhận", { timeout: 300000 }, () => {
  const tinHieuCua = async (rfqId: string) =>
    (
      await db.pool.query<{ loai: string; nguon: string; bang_chung: Record<string, unknown>; giai_thich: string }>(
        "SELECT loai, nguon, bang_chung, giai_thich FROM governance_signals WHERE rfq_id = $1 ORDER BY tinh_luc, id",
        [rfqId],
      )
    ).rows;
  const ghiNhan = ghiNhanKhaiThap;
  const docTh = (t: ToChuc, rfqId: string, ai: NguoiPhien) => withTenant(apiPool, t.org, (c) => lietKeTinHieu(c, t.org, { rfqId, actorSessionId: ai.s }));

  it("[INV-K10b] KHAI THẤP (ước lượng bậc 0, giá trúng bậc 1): đề xuất GHI một hàng ESTIMATE_UNDERSTATED/DE_XUAT mang hai mốc bậc, không số tiền; chữ ký DIRECTOR bị K10B_TIN_HIEU_CHUA_GHI_NHAN + CONTROL_DENIED, không chữ ký; gd2 ghi nhận ⇒ gd1, gd2 ký ⇒ APPROVED", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    const th = await tinHieuCua(g.rfqId);
    expect(th).toHaveLength(1);
    expect([th[0]!.loai, th[0]!.nguon]).toEqual(["ESTIMATE_UNDERSTATED", "DE_XUAT"]);
    expect(th[0]!.bang_chung).toEqual({
      loai: "ESTIMATE_UNDERSTATED", chinh_sach: t.chinhSachId, award: dx.awardId, bao_gia: g.banRo[0], bac_uoc_luong: 0, bac_trao: 100000000,
      vuot_nguong_kep: false, goi: [g.rfqId],
    });
    expect(JSON.stringify(th[0]!.bang_chung), "bằng chứng không mang số tiền trao (ADR-054)").not.toContain("150000000");
    expect(th[0]!.giai_thich).toBe("Bậc của số tiền trao (từ 100000000) cao hơn bậc của ước lượng (từ 0).");
    expect(await hangSo(t.org, "GOVERNANCE_SIGNAL_RECORDED", g.rfqId)).toBe(1);

    // Chữ ký đầu bị chặn ở tầng gói: một hàng CONTROL_DENIED đúng người, không chữ ký, đề xuất đứng yên.
    // [S1.289 / S3.6c] `duyetTho`: khai thấp hỏi TRƯỚC đóng sớm trong `award_chot_tin_hieu`, nên chữ ký thô bị K10b mà không cần ghi nhận đóng sớm —
    // và số lần ghi nhận bên dưới đếm đúng một.
    expect((await loi(duyetTho(t, g.rfqId, dx.awardId, t.gd1)))?.lyDo).toBe("K10B_TIN_HIEU_CHUA_GHI_NHAN");
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K10B_TIN_HIEU_CHUA_GHI_NHAN", actorId: t.gd1.u }]);
    expect(await chuKy(dx.awardId)).toEqual([]);
    // Màn: gd2 ghi nhận được; pm (tạo gói, đặt ngân sách) không giữ po.approve — câu nói thiếu quyền.
    const xemGd2 = (await docTh(t, g.rfqId, t.gd2)).khaiThap;
    expect([xemGd2.canGhiNhan, xemGd2.nguoiXem, xemGd2.soNguoiGhiNhanDuoc]).toEqual([true, { ghiNhanDuoc: true, lyDo: null }, 4]);
    expect((await docTh(t, g.rfqId, t.pm)).khaiThap.nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: "Ghi nhận tín hiệu khai thấp cần quyền duyệt trao thầu." });

    const gn = await ghiNhan(t, g.rfqId, t.gd2);
    expect(gn.tinHieuMoi, "bằng chứng chưa đổi: ghi nhận lên hàng DE_XUAT, không hàng mới").toBe(false);
    expect(await hangSo(t.org, "GOVERNANCE_SIGNAL_ACKNOWLEDGED", g.rfqId)).toBe(1);
    expect((await docTh(t, g.rfqId, t.gd2)).khaiThap.canGhiNhan).toBe(false);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status).toBe("APPROVED");
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED", "APPROVED"]);
  });

  it("[INV-K10b] LUẬT NGƯỜI: người đề xuất (tc3, giữ po.approve) ⇒ K10B_TU_GHI_NHAN; người khai phiên bản chính sách (tc) ⇒ K10B_TAC_GIA_CHINH_SACH; cả hai vào sổ; FINANCE khác (tc2) ghi nhận được", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!, t.tc3);
    expect((await loi(ghiNhan(t, g.rfqId, t.tc3)))?.lyDo).toBe("K10B_TU_GHI_NHAN");
    expect((await loi(ghiNhan(t, g.rfqId, t.tc)))?.lyDo).toBe("K10B_TAC_GIA_CHINH_SACH");
    expect((await tuChoiChot(t.org, g.rfqId)).map((h) => h.ma)).toEqual(["K10B_TU_GHI_NHAN", "K10B_TAC_GIA_CHINH_SACH"]);
    expect((await docTh(t, g.rfqId, t.tc3)).khaiThap.nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: CHOT_VAO_SO.K10B_TU_GHI_NHAN.thongDiep });
    expect((await ghiNhan(t, g.rfqId, t.tc2)).tinHieuMoi).toBe(false);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
  });

  it("[INV-K10b] FAIL-CLOSED: rút đề xuất rồi đề xuất báo giá KHÁC ⇒ bằng chứng mới (award, bao_gia), lần ghi nhận cũ không đếm — chữ ký lại bị chặn; ghi nhận lần hai lưu hàng GHI_NHAN mới", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    await deXuat(t, g.rfqId, g.banRo[0]!);
    await ghiNhan(t, g.rfqId, t.gd2);
    await withTenant(apiPool, t.org, (c) => rutDeXuatTraoThau(c, t.org, { rfqId: g.rfqId, reason: "chon lai bao gia", actorSessionId: t.pm2.s }, apiPool));
    expect(await tinHieuCua(g.rfqId), "rút rồi: không đề xuất sống ⇒ không tín hiệu hiện tại, hàng cũ ở lại").toHaveLength(1);
    const dx2 = await deXuat(t, g.rfqId, g.banRo[1]!);
    const th = await tinHieuCua(g.rfqId);
    expect(th).toHaveLength(2);
    expect(th[1]!.bang_chung).toMatchObject({ award: dx2.awardId, bao_gia: g.banRo[1] });
    expect((await loi(duyet(t, g.rfqId, dx2.awardId, t.gd1)))?.lyDo, "lần ghi nhận trỏ đề xuất cũ không đếm cho đề xuất mới").toBe("K10B_TIN_HIEU_CHUA_GHI_NHAN");
    expect((await ghiNhan(t, g.rfqId, t.gd2)).tinHieuMoi, "hàng DE_XUAT của đề xuất mới đã có").toBe(false);
    expect((await duyet(t, g.rfqId, dx2.awardId, t.gd1)).status).toBe("PROPOSED");
  });

  it("[INV-K10b] VƯỢT NGƯỠNG KÉP mà ước lượng thì không (cùng bậc 1, ngưỡng 500 triệu): tín hiệu bắn với vuot_nguong_kep, câu giải thích nói ngưỡng; ĐỐI CHỨNG ÂM cùng bậc, dưới ngưỡng ⇒ không tín hiệu, hai chữ ký APPROVED, không CONTROL_DENIED", async () => {
    const t = await taoToChuc(true, "500000000.00");
    const g = await goiDaCham(t, UL_BAC1, ["600000000.00", "650000000.00"]);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    const th = await tinHieuCua(g.rfqId);
    expect(th).toHaveLength(1);
    expect(th[0]!.bang_chung).toMatchObject({ bac_uoc_luong: 100000000, bac_trao: 100000000, vuot_nguong_kep: true });
    expect(th[0]!.giai_thich).toBe("Số tiền trao vượt ngưỡng phê duyệt kép mà ước lượng thì không (cùng bậc từ 100000000).");
    expect((await loi(duyet(t, g.rfqId, dx.awardId, t.gd1)))?.lyDo).toBe("K10B_TIN_HIEU_CHUA_GHI_NHAN");

    const g0 = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    const dx0 = await deXuat(t, g0.rfqId, g0.banRo[0]!);
    expect(await tinHieuCua(g0.rfqId)).toEqual([]);
    expect((await docTh(t, g0.rfqId, t.gd1)).khaiThap).toEqual({ hienTai: null, canGhiNhan: false, nguoiXem: { ghiNhanDuoc: false, lyDo: null }, soNguoiGhiNhanDuoc: null });
    await duyet(t, g0.rfqId, dx0.awardId, t.gd1);
    expect((await duyet(t, g0.rfqId, dx0.awardId, t.gd2)).status).toBe("APPROVED");
    expect(await tuChoiChot(t.org, g0.rfqId)).toEqual([]);
  });

  it("[INV-K10b] TỔ CHỨC CHƯA BẬT: khai thấp mà không tín hiệu, không hàng, một chữ ký duyệt như MVP1", async () => {
    const t = await taoToChuc(false);
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect(await tinHieuCua(g.rfqId)).toEqual([]);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("APPROVED");
  });

  it("[INV-K10b] ĐỘT BIẾN hàm vị từ `award_chot_tin_hieu` RETURN NULL ⇒ chữ ký đi qua không ai ghi nhận; ĐỘT BIẾN `tin_hieu_khai_thap` không bao giờ bắn ⇒ đề xuất không ghi hàng nào; LỚP CHẶN CUỐI: chữ ký thô với trigger ⇒ 23514 `k10b_tin_hieu_chua_ghi_nhan`, không CONTROL_DENIED", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    await voiDotBien("public.award_chot_tin_hieu(uuid, uuid)", "RETURN 'K10B_TIN_HIEU_CHUA_GHI_NHAN';", "RETURN NULL;", async () => {
      expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status, "đột biến: K10b không còn hỏi").toBe("PROPOSED");
    });
    // Gói thứ hai ở TỔ CHỨC MỚI: hai gói 50 triệu cùng nhóm hàng trong một tổ chức chạm cận 100 triệu và K10a đòi ghi nhận trước khi mở.
    const t2 = await taoToChuc();
    const g2 = await goiDaCham(t2, UL_BAC0, GIA_BAC1);
    await voiDotBien("public.tin_hieu_khai_thap(uuid, uuid)", "IF tu_trao <= tu_ul AND NOT vuot THEN", "IF true THEN", async () => {
      await deXuat(t2, g2.rfqId, g2.banRo[0]!);
      expect(await tinHieuCua(g2.rfqId), "đột biến: tín hiệu không bao giờ bắn").toEqual([]);
    });
    // Lớp chặn cuối: trên gói g2 (đã đề xuất dưới đột biến, nay hàm thật) — chữ ký thô dưới app_api đi thẳng vào trigger.
    const dx2 = (await db.pool.query<{ id: string }>("SELECT id FROM rfq_awards WHERE rfq_id = $1 AND status = 'PROPOSED'", [g2.rfqId])).rows[0]!.id;
    const truoc = await tuChoiChot(t2.org, g2.rfqId);
    const tho = await loi(
      withTenant(apiPool, t2.org, (c) =>
        c.query(
          "INSERT INTO public.rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)",
          [t2.org, dx2, t2.gd2.u, t2.gd2.s],
        ),
      ),
    );
    expect([tho?.code, tho?.constraint]).toEqual(["23514", "k10b_tin_hieu_chua_ghi_nhan"]);
    expect(await tuChoiChot(t2.org, g2.rfqId), "câu đi tắt: không hàng sổ nào thêm").toEqual(truoc);
    expect(await chuKy(dx2)).toEqual([]);
  });

  it("[INV-K10b] ĐỘT BIẾN luật người: bỏ vế người đề xuất ⇒ người đề xuất (tc3) tự ghi nhận được; bỏ vế tác giả chính sách ⇒ tc ghi nhận được", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC0, GIA_BAC1);
    await deXuat(t, g.rfqId, g.banRo[0]!, t.tc3);
    await voiDotBien("public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)", "AND w.acted_by = p_nguoi) THEN", "AND false) THEN", async () => {
      expect((await ghiNhan(t, g.rfqId, t.tc3)).tinHieuMoi, "đột biến: người đề xuất tự ghi nhận").toBe(false);
    });
    const t2 = await taoToChuc();
    const g2 = await goiDaCham(t2, UL_BAC0, GIA_BAC1);
    await deXuat(t2, g2.rfqId, g2.banRo[0]!);
    await voiDotBien("public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)", "RETURN 'K10B_TAC_GIA_CHINH_SACH';", "RETURN NULL;", async () => {
      expect((await ghiNhan(t2, g2.rfqId, t2.tc)).tinHieuMoi, "đột biến: tác giả chính sách ghi nhận được").toBe(false);
    });
  });

  it("[INV-K10b] K12: tập mã K10b trong thân ba hàm SQL = các dòng `chot: K10b` của CHOT_VAO_SO; tên ràng buộc k10b_* KHÔNG ở CHOT_THEO_RANG_BUOC (ADR-120)", async () => {
    const { rows } = await db.pool.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE oid IN ('public.award_chot_tin_hieu(uuid, uuid)'::regprocedure, " +
        "'public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)'::regprocedure, 'public.tin_hieu_kiem_ghi_nhan()'::regprocedure)",
    );
    const trongThan = [...new Set(rows.flatMap((r) => [...r.prosrc.matchAll(/'(K10B_\w+)'/gu)].map((m) => m[1])))].sort();
    const trongBang = Object.entries(CHOT_VAO_SO).filter(([, d]) => d.chot === "K10b").map(([k]) => k).sort();
    expect(trongThan).toEqual(trongBang);
    expect(trongBang).toEqual(["K10B_TAC_GIA_CHINH_SACH", "K10B_TIN_HIEU_CHUA_GHI_NHAN", "K10B_TU_GHI_NHAN"]);
  });
});


// =============================================================================================
// ⑶c K10c — HAI TÍN HIỆU CỦA LƯỢT MỜI THẦU (THU HẸP DANH SÁCH MỜI, ĐÓNG SỚM) VÀ K10 Ở CHỮ KÝ TRAO THẦU (S3.6c, `120`)
// =============================================================================================
describe("[S1.289 / S3.6c / K10c] tín hiệu của lượt mời thầu — thu hồi ở OPEN có lý do và qua ngưỡng, đóng sớm khi đã có báo giá; chữ ký trao thầu bị chặn tới khi người độc lập ghi nhận từng tín hiệu", { timeout: 300000 }, () => {
  const tinHieuCua = async (rfqId: string) =>
    (
      await db.pool.query<{ loai: string; nguon: string; bang_chung: Record<string, unknown>; giai_thich: string }>(
        "SELECT loai, nguon, bang_chung, giai_thich FROM governance_signals WHERE rfq_id = $1 ORDER BY tinh_luc, id",
        [rfqId],
      )
    ).rows;
  const docTh = (t: ToChuc, rfqId: string, ai: NguoiPhien) => withTenant(apiPool, t.org, (c) => lietKeTinHieu(c, t.org, { rfqId, actorSessionId: ai.s }));
  const thuHoi = (t: ToChuc, loiMoiId: string, ai: NguoiPhien, lyDo?: string) =>
    withTenant(apiPool, t.org, (c) => revokeInvitation(c, t.org, { invitationId: loiMoiId, actorSessionId: ai.s, ...(lyDo === undefined ? {} : { lyDo }) }, apiPool));
  const hangLoiMoi = async (loiMoiId: string) =>
    (await db.pool.query<{ status: string; ly_do: string | null }>("SELECT status, ly_do_thu_hoi AS ly_do FROM rfq_invitations WHERE id = $1", [loiMoiId])).rows[0]!;
  const CAU_THU_HOI_THO =
    "UPDATE public.rfq_invitations SET status = 'REVOKED', revoked_at = pg_catalog.now(), revoked_by = $2, revoked_by_session_id = $3, ly_do_thu_hoi = $4 WHERE id = $1";
  const LY_DO = "Nha cung cap bao het hang";
  const MOC_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

  /** Gói đã MỞ với `soMoi` nhà cung cấp đếm được — chưa báo giá, chưa đóng. */
  async function goiDaMo(t: ToChuc, uocLuong: string, soMoi: number): Promise<{ readonly rfqId: string; readonly loiMoi: LoiMoi[] }> {
    const rfqId = await goiNhap(t, uocLuong);
    const loiMoi = await moiDemDuoc(t, rfqId, soMoi);
    await nopKyMo(t, rfqId);
    expect(await trangThai(rfqId), "tiền đề: gói phải ở OPEN").toBe("OPEN");
    return { rfqId, loiMoi };
  }
  /** Báo giá theo `gia` của các lời mời đầu, đóng (qua `closeRfq` dưới `nguoiDong` nếu có), mở thầu, chấm, đề xuất báo giá rẻ nhất. */
  async function chamVaDeXuat(t: ToChuc, rfqId: string, loiMoi: readonly LoiMoi[], gia: readonly string[], nguoiDong?: NguoiPhien) {
    const ban: [string, unknown][] = [];
    const banRo: string[] = [];
    for (const [i, g] of gia.entries()) {
      const v = await nopBaoGia(t, rfqId, loiMoi[i]!);
      banRo.push(v);
      ban.push([v, { totalAmount: g, currency: "VND" }]);
    }
    await moThau(t, rfqId, ban, nguoiDong === undefined ? {} : { dongQuaGoi: nguoiDong });
    await withTenant(apiPool, t.org, (c) => taoLuotDanhGia(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
    const dx = await deXuat(t, rfqId, banRo[0]!);
    return { dx, banRo };
  }

  it("[INV-K10c] THU HỒI Ở OPEN: không lý do ⇒ từ chối có tên, lời mời còn sống; có lý do ⇒ cột ly_do_thu_hoi và hàng INVITE_LIST_NARROWED/THU_HOI mang {lời mời, người, lúc, lý do}, không số tiền; chữ ký bị K10C_TIN_HIEU_CHUA_GHI_NHAN + CONTROL_DENIED tới khi gd2 ghi nhận CẢ thu hẹp lẫn đóng sớm", async () => {
    const t = await taoToChuc();
    const { rfqId, loiMoi } = await goiDaMo(t, UL_BAC1, 3);
    const khong = await loi(thuHoi(t, loiMoi[2]!.id, t.pm));
    expect(khong?.message).toMatch(/cần một lý do/u);
    expect(await hangLoiMoi(loiMoi[2]!.id)).toEqual({ status: "UNSENT", ly_do: null });
    expect(await tinHieuCua(rfqId)).toEqual([]);

    expect(await thuHoi(t, loiMoi[2]!.id, t.pm, `  ${LY_DO}  `)).toBe(true);
    expect(await hangLoiMoi(loiMoi[2]!.id)).toEqual({ status: "REVOKED", ly_do: LY_DO });
    const th = await tinHieuCua(rfqId);
    expect(th).toHaveLength(1);
    expect([th[0]!.loai, th[0]!.nguon]).toEqual(["INVITE_LIST_NARROWED", "THU_HOI"]);
    const bcTh = th[0]!.bang_chung as { thu_hoi: { luc: string; loi_moi: string; nguoi: string; ly_do: string }[] } & Record<string, unknown>;
    expect(bcTh.thu_hoi.map((x) => x.luc)).toEqual([expect.stringMatching(MOC_UTC) as string]);
    expect({ ...bcTh, thu_hoi: bcTh.thu_hoi.map((x) => ({ loi_moi: x.loi_moi, nguoi: x.nguoi, ly_do: x.ly_do })) }).toEqual({
      loai: "INVITE_LIST_NARROWED", chinh_sach: t.chinhSachId, goi: [rfqId],
      thu_hoi: [{ loi_moi: loiMoi[2]!.id, nguoi: t.pm.u, ly_do: LY_DO }],
    });
    expect(th[0]!.giai_thich).toBe("1 lời mời bị thu hồi sau khi gói thầu mở — danh sách người duyệt đã ký bị thu hẹp.");
    expect(await hangSo(t.org, "GOVERNANCE_SIGNAL_RECORDED", rfqId)).toBe(1);

    const { dx } = await chamVaDeXuat(t, rfqId, loiMoi, GIA_BAC1, t.pm);
    expect((await tinHieuCua(rfqId)).map((h) => [h.loai, h.nguon])).toEqual([["INVITE_LIST_NARROWED", "THU_HOI"], ["EARLY_CLOSE", "DONG_SOM"]]);
    // Chữ ký đầu bị chặn ở tầng gói: một hàng CONTROL_DENIED đúng người, không chữ ký.
    expect((await loi(duyetTho(t, rfqId, dx.awardId, t.gd1)))?.lyDo).toBe("K10C_TIN_HIEU_CHUA_GHI_NHAN");
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K10C_TIN_HIEU_CHUA_GHI_NHAN", actorId: t.gd1.u }]);
    expect(await chuKy(dx.awardId)).toEqual([]);
    // Màn: hai phần, mỗi phần còn chờ; gd2 ghi nhận được cả hai; pm (tạo, thu hồi, đóng) không giữ po.approve.
    const xem = await docTh(t, rfqId, t.gd2);
    expect([xem.thuHep.canGhiNhan, xem.thuHep.nguoiXem, xem.thuHep.soNguoiGhiNhanDuoc]).toEqual([true, { ghiNhanDuoc: true, lyDo: null }, 4]);
    expect([xem.dongSom.canGhiNhan, xem.dongSom.nguoiXem, xem.dongSom.soNguoiGhiNhanDuoc]).toEqual([true, { ghiNhanDuoc: true, lyDo: null }, 4]);
    expect(xem.khaiThap.hienTai, "cùng bậc: không khai thấp").toBeNull();
    expect((await docTh(t, rfqId, t.pm)).thuHep.nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: "Ghi nhận tín hiệu của lượt mời thầu cần quyền duyệt trao thầu." });

    expect((await ghiNhanTT(t, rfqId, t.gd2, "INVITE_LIST_NARROWED")).tinHieuMoi, "bằng chứng chưa đổi: ghi nhận lên hàng THU_HOI").toBe(false);
    expect((await loi(duyetTho(t, rfqId, dx.awardId, t.gd1)))?.lyDo, "đóng sớm còn chờ").toBe("K10C_TIN_HIEU_CHUA_GHI_NHAN");
    const sau = await docTh(t, rfqId, t.gd2);
    expect([sau.thuHep.canGhiNhan, sau.dongSom.canGhiNhan]).toEqual([false, true]);
    expect((await ghiNhanTT(t, rfqId, t.gd2, "EARLY_CLOSE")).tinHieuMoi).toBe(false);
    expect(await hangSo(t.org, "GOVERNANCE_SIGNAL_ACKNOWLEDGED", rfqId)).toBe(2);
    expect((await duyetTho(t, rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
    expect((await duyetTho(t, rfqId, dx.awardId, t.gd2)).status).toBe("APPROVED");
    expect(await hangAward(rfqId)).toEqual(["PROPOSED", "APPROVED"]);
  });

  it("[INV-K10c] ĐÓNG SỚM qua closeRfq: hàng EARLY_CLOSE/DONG_SOM ghi ở cạnh đóng — bằng chứng {hạn, lúc đóng, người đóng, lý do, số luồng báo giá}; LUẬT NGƯỜI: người đóng (gd1) ⇒ K10C_TU_GHI_NHAN, tác giả chính sách (tc) ⇒ K10C_TAC_GIA_CHINH_SACH, tc3 ghi nhận được; đóng sớm KHÔNG báo giá ⇒ không tín hiệu", async () => {
    const t = await taoToChuc();
    const { rfqId, loiMoi } = await goiDaMo(t, UL_BAC1, 2);
    const { dx } = await chamVaDeXuat(t, rfqId, loiMoi, GIA_BAC1, t.gd1);
    const th = await tinHieuCua(rfqId);
    expect(th).toHaveLength(1);
    expect([th[0]!.loai, th[0]!.nguon]).toEqual(["EARLY_CLOSE", "DONG_SOM"]);
    const { han, dong_luc, ...bcDs } = th[0]!.bang_chung as { han: string; dong_luc: string } & Record<string, unknown>;
    expect([han, dong_luc].map((x) => MOC_UTC.test(x))).toEqual([true, true]);
    expect(bcDs).toEqual({ loai: "EARLY_CLOSE", chinh_sach: t.chinhSachId, goi: [rfqId], nguoi_dong: t.gd1.u, ly_do: "dong som de kiem tra", so_bao_gia: 2 });
    expect(JSON.stringify(th[0]!.bang_chung), "bằng chứng không mang số tiền (ADR-054)").not.toContain("150000000");
    expect(th[0]!.giai_thich).toMatch(/^Gói thầu đóng lúc .+, trước hạn .+, khi đã có 2 luồng báo giá\.$/u);

    expect((await loi(ghiNhanTT(t, rfqId, t.gd1, "EARLY_CLOSE")))?.lyDo).toBe("K10C_TU_GHI_NHAN");
    expect((await loi(ghiNhanTT(t, rfqId, t.tc, "EARLY_CLOSE")))?.lyDo).toBe("K10C_TAC_GIA_CHINH_SACH");
    expect((await tuChoiChot(t.org, rfqId)).map((h) => h.ma)).toEqual(["K10C_TU_GHI_NHAN", "K10C_TAC_GIA_CHINH_SACH"]);
    expect((await docTh(t, rfqId, t.gd1)).dongSom.nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: CHOT_VAO_SO.K10C_TU_GHI_NHAN.thongDiep });
    expect((await docTh(t, rfqId, t.gd1)).dongSom.soNguoiGhiNhanDuoc, "gd2, tc2, tc3 — không gd1 (đóng), không tc (tác giả)").toBe(3);
    expect((await ghiNhanTT(t, rfqId, t.tc3, "EARLY_CLOSE")).tinHieuMoi).toBe(false);
    expect((await duyetTho(t, rfqId, dx.awardId, t.gd2)).status).toBe("PROPOSED");

    const g2 = await goiDaMo(t, UL_BAC1, 2);
    await withTenant(apiPool, t.org, (c) => closeRfq(c, t.org, { rfqId: g2.rfqId, reason: "dong som khong bao gia", actorSessionId: t.pm.s }));
    expect(await tinHieuCua(g2.rfqId)).toEqual([]);
    expect((await db.pool.query<{ n: boolean }>("SELECT public.tin_hieu_dong_som($1, $2) IS NULL AS n", [t.org, g2.rfqId])).rows[0]!.n).toBe(true);
  });

  it("[INV-K10c] DƯỚI NGƯỠNG (bậc 1, ngưỡng 2): hai lời mời đếm được, thu hồi một ⇒ K10C_THU_HOI_THIEU_CANH_TRANH + CONTROL_DENIED, lời mời sống, không tín hiệu; lời mời KHÔNG đếm được thu hồi được (số nhóm không đổi) và vẫn vào tín hiệu; NGOẠI LỆ còn sống đúng loại cứu, sai loại không; TỔ CHỨC CHƯA BẬT thu hồi ở OPEN không lý do như MVP1", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t, UL_BAC1);
    const dem = await moiDemDuoc(t, rfqId, 2);
    const vo = await moiKhongDemDuoc(t, rfqId);
    await nopKyMo(t, rfqId);
    expect((await loi(thuHoi(t, dem[0]!.id, t.pm, LY_DO)))?.lyDo).toBe("K10C_THU_HOI_THIEU_CANH_TRANH");
    expect(await tuChoiChot(t.org, rfqId)).toEqual([{ ma: "K10C_THU_HOI_THIEU_CANH_TRANH", actorId: t.pm.u }]);
    expect(await hangLoiMoi(dem[0]!.id)).toEqual({ status: "UNSENT", ly_do: null });
    expect(await tinHieuCua(rfqId)).toEqual([]);
    expect(await thuHoi(t, vo.id, t.pm, LY_DO), "nhà cung cấp vỏ không đếm: thu hồi không đổi số nhóm").toBe(true);
    expect((await tinHieuCua(rfqId)).map((h) => (h.bang_chung.thu_hoi as { loi_moi: string }[]).map((x) => x.loi_moi))).toEqual([[vo.id]]);

    // Ngoại lệ SAI loại không cứu: ba lời mời + LIMITED_COMPETITION lập ở DRAFT; thu hồi một ⇒ còn 2 ≥ 2 (qua); thu hồi hai ⇒ còn 1 lời mời sống — cần SINGLE_SOURCE.
    const rfqB = await goiNhap(t, UL_BAC1);
    const demB = await moiDemDuoc(t, rfqB, 3);
    await withTenant(apiPool, t.org, (c) => lapNgoaiLe(c, t.org, { rfqId: rfqB, loai: "LIMITED_COMPETITION", maLyDo: "EMERGENCY", giaiTrinh: GIAI_TRINH, actorSessionId: t.pm.s }, apiPool));
    await nopKyMo(t, rfqB);
    expect(await thuHoi(t, demB[0]!.id, t.pm, LY_DO)).toBe(true);
    expect((await loi(thuHoi(t, demB[1]!.id, t.pm, LY_DO)))?.lyDo, "ngoại lệ LIMITED_COMPETITION không cứu lần thu hồi để lại MỘT lời mời").toBe("K10C_THU_HOI_THIEU_CANH_TRANH");
    // Ngoại lệ ĐÚNG loại cứu: hai lời mời + SINGLE_SOURCE lập ở DRAFT; thu hồi một ⇒ còn 1 < 2 nhưng ngoại lệ còn sống.
    const rfqC = await goiNhap(t, UL_BAC1);
    const demC = await moiDemDuoc(t, rfqC, 2);
    await withTenant(apiPool, t.org, (c) => lapNgoaiLe(c, t.org, { rfqId: rfqC, loai: "SINGLE_SOURCE", maLyDo: "EMERGENCY", giaiTrinh: GIAI_TRINH, actorSessionId: t.pm.s }, apiPool));
    await nopKyMo(t, rfqC);
    expect(await thuHoi(t, demC[0]!.id, t.pm, LY_DO)).toBe(true);
    expect(await hangLoiMoi(demC[0]!.id)).toEqual({ status: "REVOKED", ly_do: LY_DO });

    const t0 = await taoToChuc(false);
    const g0 = await goiDaMo(t0, UL_BAC1, 1);
    expect(await thuHoi(t0, g0.loiMoi[0]!.id, t0.pm), "MVP1: thu hồi ở OPEN không lý do, không chốt").toBe(true);
    expect(await tinHieuCua(g0.rfqId)).toEqual([]);
    expect(await tuChoiChot(t0.org, g0.rfqId)).toEqual([]);
  });

  it("[INV-K10c] LỚP CHẶN CUỐI: chữ ký thô dưới app_api khi thu hẹp chưa ghi nhận ⇒ 23514 k10c_tin_hieu_chua_ghi_nhan, không hàng sổ; câu thu hồi thô ở OPEN không lý do ⇒ k10c_thu_hoi_thieu_ly_do; dưới ngưỡng ⇒ k10c_thu_hoi_thieu_canh_tranh", async () => {
    const t = await taoToChuc();
    const { rfqId, loiMoi } = await goiDaMo(t, UL_BAC1, 3);
    expect(await thuHoi(t, loiMoi[2]!.id, t.pm, LY_DO)).toBe(true);
    const { dx } = await chamVaDeXuat(t, rfqId, loiMoi, GIA_BAC1);
    await ghiNhanTT(t, rfqId, t.gd2, "EARLY_CLOSE");
    const truoc = await tuChoiChot(t.org, rfqId);
    const tho = await loi(
      withTenant(apiPool, t.org, (c) =>
        c.query("INSERT INTO public.rfq_award_approvals (org_id, award_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [t.org, dx.awardId, t.gd1.u, t.gd1.s]),
      ),
    );
    expect([tho?.code, tho?.constraint]).toEqual(["23514", "k10c_tin_hieu_chua_ghi_nhan"]);
    expect(await tuChoiChot(t.org, rfqId), "câu đi tắt: không hàng sổ nào thêm").toEqual(truoc);
    expect(await chuKy(dx.awardId)).toEqual([]);

    const gA = await goiDaMo(t, UL_BAC1, 3);
    const thieuLyDo = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_THU_HOI_THO, [gA.loiMoi[0]!.id, t.pm.u, t.pm.s, null])));
    expect([thieuLyDo?.code, thieuLyDo?.constraint]).toEqual(["23514", "k10c_thu_hoi_thieu_ly_do"]);
    const gB = await goiDaMo(t, UL_BAC1, 2);
    const duoiNguong = await loi(withTenant(apiPool, t.org, (c) => c.query(CAU_THU_HOI_THO, [gB.loiMoi[0]!.id, t.pm.u, t.pm.s, LY_DO])));
    expect([duoiNguong?.code, duoiNguong?.constraint]).toEqual(["23514", "k10c_thu_hoi_thieu_canh_tranh"]);
    expect(await hangLoiMoi(gB.loiMoi[0]!.id)).toEqual({ status: "UNSENT", ly_do: null });
  });

  it("[INV-K10c] ĐỘT BIẾN: `award_chot_tin_hieu` bỏ hàm thu hẹp / bỏ hàm đóng sớm ⇒ chữ ký đi qua không ai đọc; `tin_hieu_thu_hep` không bao giờ bắn ⇒ thu hồi không để hàng; `rfq_chot_thu_hoi` RETURN NULL ⇒ dưới ngưỡng đi qua; luật người bỏ vế người gây ra ⇒ người thu hồi tự ghi nhận được", async () => {
    const t = await taoToChuc();
    const { rfqId, loiMoi } = await goiDaMo(t, UL_BAC1, 3);
    expect(await thuHoi(t, loiMoi[2]!.id, t.pm, LY_DO)).toBe(true);
    const { dx } = await chamVaDeXuat(t, rfqId, loiMoi, GIA_BAC1);
    await voiDotBien("public.award_chot_tin_hieu(uuid, uuid)", "bc := public.tin_hieu_thu_hep(p_org, p_rfq);", "bc := NULL;", async () => {
      expect((await duyet(t, rfqId, dx.awardId, t.gd1)).status, "đột biến: thu hẹp không còn hỏi (đóng sớm đã được gd2 ghi nhận)").toBe("PROPOSED");
    });
    expect((await loi(duyetTho(t, rfqId, dx.awardId, t.gd2)))?.lyDo, "hàm thật: thu hẹp vẫn chưa ai ghi nhận").toBe("K10C_TIN_HIEU_CHUA_GHI_NHAN");

    const g2 = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    const dx2 = await deXuat(t, g2.rfqId, g2.banRo[0]!);
    await voiDotBien("public.award_chot_tin_hieu(uuid, uuid)", "bc := public.tin_hieu_dong_som(p_org, p_rfq);", "bc := NULL;", async () => {
      expect((await duyetTho(t, g2.rfqId, dx2.awardId, t.gd1)).status, "đột biến: đóng sớm không còn hỏi").toBe("PROPOSED");
    });
    expect((await loi(duyetTho(t, g2.rfqId, dx2.awardId, t.gd2)))?.lyDo).toBe("K10C_TIN_HIEU_CHUA_GHI_NHAN");

    const g3 = await goiDaMo(t, UL_BAC1, 3);
    await voiDotBien("public.tin_hieu_thu_hep(uuid, uuid)", "AND i.revoked_at >= mo;", "AND false;", async () => {
      expect(await thuHoi(t, g3.loiMoi[2]!.id, t.pm, LY_DO)).toBe(true);
      expect(await tinHieuCua(g3.rfqId), "đột biến: tín hiệu không bao giờ bắn").toEqual([]);
    });
    expect((await docTh(t, g3.rfqId, t.gd2)).thuHep.hienTai, "hàm thật: tín hiệu hiện tại có, hàng thì chưa — lần ghi nhận sẽ lưu nó").not.toBeNull();

    const g4 = await goiDaMo(t, UL_BAC1, 2);
    await voiDotBien("public.rfq_chot_thu_hoi(uuid, uuid, uuid)", "RETURN 'K10C_THU_HOI_THIEU_CANH_TRANH';", "RETURN NULL;", async () => {
      expect(await thuHoi(t, g4.loiMoi[0]!.id, t.pm, LY_DO), "đột biến: dưới ngưỡng đi qua").toBe(true);
    });

    const t5 = await taoToChuc();
    const g5 = await goiDaMo(t5, UL_BAC1, 3);
    expect(await thuHoi(t5, g5.loiMoi[2]!.id, t5.tc3, LY_DO), "tc3 thu hồi — người gây ra tín hiệu").toBe(true);
    await chamVaDeXuat(t5, g5.rfqId, g5.loiMoi, GIA_BAC1);
    expect((await loi(ghiNhanTT(t5, g5.rfqId, t5.tc3, "INVITE_LIST_NARROWED")))?.lyDo, "hàm thật").toBe("K10C_TU_GHI_NHAN");
    await voiDotBien("public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)", "RETURN 'K10C_TU_GHI_NHAN';", "RETURN NULL;", async () => {
      expect((await ghiNhanTT(t5, g5.rfqId, t5.tc3, "INVITE_LIST_NARROWED")).tinHieuMoi, "đột biến: người thu hồi tự ghi nhận").toBe(false);
    });
  });

  it("[INV-K10c] K12: tập mã K10c trong thân bốn hàm SQL = các dòng `chot: K10c` của CHOT_VAO_SO; tên ràng buộc k10c_* KHÔNG ở CHOT_THEO_RANG_BUOC (ADR-120)", async () => {
    const { rows } = await db.pool.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE oid IN ('public.award_chot_tin_hieu(uuid, uuid)'::regprocedure, 'public.rfq_chot_thu_hoi(uuid, uuid, uuid)'::regprocedure, " +
        "'public.tin_hieu_chot_nguoi_ghi_nhan(uuid, jsonb, uuid)'::regprocedure, 'public.tin_hieu_kiem_ghi_nhan()'::regprocedure)",
    );
    const trongThan = [...new Set(rows.flatMap((r) => [...r.prosrc.matchAll(/'(K10C_\w+)'/gu)].map((m) => m[1])))].sort();
    const trongBang = Object.entries(CHOT_VAO_SO).filter(([, d]) => d.chot === "K10c").map(([k]) => k).sort();
    expect(trongThan).toEqual(trongBang);
    expect(trongBang).toEqual(["K10C_TAC_GIA_CHINH_SACH", "K10C_THU_HOI_THIEU_CANH_TRANH", "K10C_TIN_HIEU_CHUA_GHI_NHAN", "K10C_TU_GHI_NHAN"]);
    const { rows: rb } = await db.pool.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE oid IN ('public.rfq_invitations_kiem_danh_sach()'::regprocedure, 'public.award_kiem_tin_hieu_khai_thap()'::regprocedure)",
    );
    const ten = [...new Set(rb.flatMap((r) => [...r.prosrc.matchAll(/CONSTRAINT = '(k10c_\w+)'/gu)].map((m) => m[1])))].sort();
    expect(ten).toEqual(["k10c_thu_hoi_thieu_canh_tranh", "k10c_thu_hoi_thieu_ly_do", "k10c_tin_hieu_chua_ghi_nhan"]);
    expect(Object.keys(CHOT_THEO_RANG_BUOC).filter((k) => k.startsWith("k10c_"))).toEqual([]);
  });
});

// =============================================================================================
// ⑷ K12 — HAI BẢNG KHÔNG TRÔI KHỎI NHAU
// =============================================================================================
describe("[S1.280 / S3.5a / K12] tập mã của các hàm vị từ BẰNG các dòng K7, K2b, K5b của CHOT_VAO_SO", () => {
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

// =============================================================================================
// ⑸ [S1.283 / S3.4b · K9] CHỮ KÝ CỦA NGƯỜI ĐÃ KHAI XUNG ĐỘT KHÔNG ĐẾM Ở K7 LẪN K5b
// =============================================================================================
describe("[S1.283 / S3.4b / K9] chữ ký trao thầu của người đã khai CO_XUNG_DOT không đếm — K7 và K5b đọc `award_chu_ky_con_hieu_luc`", { timeout: 300000 }, () => {
  /**
   * Lời khai `CO_XUNG_DOT` của `ai` với nhà cung cấp của lời mời đầu — câu chèn của `khaiBaoXungDot` (`@trustprocure/kiem-soat`; gói
   * này không phụ thuộc nó), dưới `app_api`: trigger `coi_kiem_khai_bao` đặt băm và đòi nhà cung cấp có lời mời. Các bậc của tệp này
   * KHÔNG đòi khai (`khai_xung_dot: false`), nên người chưa khai vẫn ký được; người đã khai có xung đột thì không ký thêm được (K9).
   */
  const khaiCo = (t: ToChuc, g: GoiDaCham, ai: NguoiPhien): Promise<unknown> =>
    withTenant(apiPool, t.org, (c) =>
      c.query(
        "INSERT INTO public.coi_declarations (org_id, rfq_id, user_id, session_id, trang_thai, supplier_id) VALUES ($1, $2, $3, $4, 'CO_XUNG_DOT', $5)",
        [t.org, g.rfqId, ai.u, ai.s, g.loiMoi[0]!.ncc],
      ),
    );
  /** `gd1` là người ĐÃ TỪNG điều phối mở gói (khuôn khối K5b ở trên). */
  async function gd1DieuPhoi(t: ToChuc, rfqId: string): Promise<void> {
    const yc = (await db.pool.query<{ id: string }>("SELECT id FROM unseal_requests WHERE rfq_id = $1", [rfqId])).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO unseal_dispatch_history (org_id, unseal_request_id, rfq_id, dispatched_by, dispatched_by_session_id) VALUES ($1, $2, $3, $4, $5)",
      [t.org, yc, rfqId, t.gd1.u, t.gd1.s],
    );
  }

  it("[INV-K9] K7 bậc 1 (hai DIRECTOR): gd1 ký rồi khai CO_XUNG_DOT ⇒ gd2 ký mà đề xuất vẫn PROPOSED — chữ ký gd1 đánh dấu không đếm, không lần từ chối nào; DIRECTOR thứ ba ⇒ APPROVED; ĐỘT BIẾN bỏ vế loại trừ ⇒ gd2 duyệt xong", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC1, GIA_BAC1);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd1)).status).toBe("PROPOSED");
    await khaiCo(t, g, t.gd1);
    const hai = await duyet(t, g.rfqId, dx.awardId, t.gd2);
    expect([hai.status, hai.chuKyCan, hai.approvals.map((c) => [c.approverUserId, c.conHieuLuc])], "chữ ký của người khai xung đột còn đó nhưng không đếm").toEqual([
      "PROPOSED",
      2,
      [
        [t.gd1.u, false],
        [t.gd2.u, true],
      ],
    ]);
    expect((await doc(t, g.rfqId))?.approvals.map((c) => c.conHieuLuc), "lời đọc trao thầu đánh dấu cùng cách").toEqual([false, true]);
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED"]);
    expect(await tuChoiChot(t.org, g.rfqId), "chưa đủ chữ ký không phải một lần từ chối").toEqual([]);
    const gd3 = await nguoi(t.org, "DIRECTOR");
    expect((await duyet(t, g.rfqId, dx.awardId, gd3)).status).toBe("APPROVED");

    // ĐỘT BIẾN: hàm chữ ký còn hiệu lực bỏ vế loại trừ ⇒ chữ ký gd1 đếm, gd2 duyệt xong. Tổ chức MỚI (K10a — khuôn khối K7 ở trên).
    const t2 = await taoToChuc();
    const g2 = await goiDaCham(t2, UL_BAC1, GIA_BAC1);
    const dx2 = await deXuat(t2, g2.rfqId, g2.banRo[0]!);
    await duyet(t2, g2.rfqId, dx2.awardId, t2.gd1);
    await khaiCo(t2, g2, t2.gd1);
    await voiDotBien("public.award_chu_ky_con_hieu_luc(uuid, uuid)", "d.trang_thai = 'CO_XUNG_DOT'", "d.trang_thai = 'KHONG_PHAI_MA'", async () => {
      const r = await duyet(t2, g2.rfqId, dx2.awardId, t2.gd2);
      expect([r.status, r.approvals.map((c) => c.conHieuLuc)], "đột biến: chữ ký của người khai xung đột đếm").toEqual(["APPROVED", [true, true]]);
    });
  });

  it("[INV-K9] K7 hai vai (bậc 2): DIRECTOR ký rồi khai CO_XUNG_DOT ⇒ hai FINANCE còn hiệu lực đủ số mà KHÔNG rút được hai vai khác nhau ⇒ PROPOSED; ĐỘT BIẾN vế hai vai đọc chữ ký thô ⇒ APPROVED", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status).toBe("PROPOSED");
    await khaiCo(t, g, t.gd2);
    expect((await duyet(t, g.rfqId, dx.awardId, t.tc3)).status).toBe("PROPOSED");
    const r = await duyet(t, g.rfqId, dx.awardId, t.tc2);
    expect([r.status, r.approvals.map((c) => c.conHieuLuc)], "hai chữ ký FINANCE còn hiệu lực: đủ số, chưa đủ vai").toEqual(["PROPOSED", [false, true, true]]);
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED"]);

    const g2 = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    const dx2 = await deXuat(t, g2.rfqId, g2.banRo[0]!);
    await duyet(t, g2.rfqId, dx2.awardId, t.gd2);
    await khaiCo(t, g2, t.gd2);
    await duyet(t, g2.rfqId, dx2.awardId, t.tc3);
    // Vế hai vai đọc chữ ký THÔ (vế đếm vẫn đọc hàm): vai DIRECTOR của người đã khai xung đột rút được ⇒ qua.
    await voiDotBien(
      "public.award_du_chu_ky(uuid, uuid)",
      "                   FROM public.award_chu_ky_con_hieu_luc(p_org, p_award) x\n                   JOIN public.award_chu_ky_con_hieu_luc(p_org, p_award) y ON y.nguoi <> x.nguoi,",
      "                   FROM (SELECT ap.approver_user_id AS nguoi, ap.vai_luc_ky AS vai FROM public.rfq_award_approvals ap WHERE ap.org_id = p_org AND ap.award_id = p_award) x\n" +
        "                   JOIN (SELECT ap.approver_user_id AS nguoi, ap.vai_luc_ky AS vai FROM public.rfq_award_approvals ap WHERE ap.org_id = p_org AND ap.award_id = p_award) y ON y.nguoi <> x.nguoi,",
      async () => {
        expect((await duyet(t, g2.rfqId, dx2.awardId, t.tc2)).status, "đột biến: vai của người khai xung đột rút được").toBe("APPROVED");
      },
    );
  });

  it("[INV-K9] K5b bậc 2: người độc lập duy nhất (gd2) ký rồi khai CO_XUNG_DOT ⇒ tc2 (xác minh) + gd1 (điều phối) đủ số và đủ vai nhưng không ai độc lập ⇒ K5B_THIEU_CHU_KY_DOC_LAP; ĐỘT BIẾN K5b đọc chữ ký thô ⇒ APPROVED", async () => {
    const t = await taoToChuc();
    const g = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    await gd1DieuPhoi(t, g.rfqId);
    const dx = await deXuat(t, g.rfqId, g.banRo[0]!);
    expect((await duyet(t, g.rfqId, dx.awardId, t.gd2)).status).toBe("PROPOSED");
    await khaiCo(t, g, t.gd2);
    expect((await duyet(t, g.rfqId, dx.awardId, t.tc2)).status, "một chữ ký còn hiệu lực trên hai").toBe("PROPOSED");
    const e = await loi(duyet(t, g.rfqId, dx.awardId, t.gd1));
    expect([e?.lyDo, e?.message]).toEqual(["K5B_THIEU_CHU_KY_DOC_LAP", CHOT_VAO_SO.K5B_THIEU_CHU_KY_DOC_LAP.thongDiep]);
    expect(await tuChoiChot(t.org, g.rfqId)).toEqual([{ ma: "K5B_THIEU_CHU_KY_DOC_LAP", actorId: t.gd1.u }]);
    expect(await hangAward(g.rfqId)).toEqual(["PROPOSED"]);

    const g2 = await goiDaCham(t, UL_BAC2, GIA_BAC2);
    await gd1DieuPhoi(t, g2.rfqId);
    const dx2 = await deXuat(t, g2.rfqId, g2.banRo[0]!);
    await duyet(t, g2.rfqId, dx2.awardId, t.gd2);
    await khaiCo(t, g2, t.gd2);
    await duyet(t, g2.rfqId, dx2.awardId, t.tc2);
    await voiDotBien(
      "public.award_chot_doc_lap(uuid, uuid)",
      "FROM public.award_chu_ky_con_hieu_luc(p_org, p_award) k",
      "FROM (SELECT ap.approver_user_id AS nguoi FROM public.rfq_award_approvals ap WHERE ap.org_id = p_org AND ap.award_id = p_award) k",
      async () => {
        expect((await duyet(t, g2.rfqId, dx2.awardId, t.gd1)).status, "đột biến: người khai xung đột là chữ ký độc lập").toBe("APPROVED");
      },
    );
  });
});
