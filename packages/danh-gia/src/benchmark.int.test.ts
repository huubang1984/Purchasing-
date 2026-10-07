// [S1.256 / S4.5b] Benchmark giá — trên Postgres thật (spec S4 §4.6, §2.4 ⑾, §2.5 ⑿; §5.1 L7, L14; ADR-142).
//
//   ⑴ lượt chấm ghi ĐÚNG MỘT hàng mỗi (báo giá, dòng): nhãn và chiều của dữ liệu đã thiết kế, `KHONG_DO_DUOC` có lý do,
//      `CHUA_DU_LICH_SU` dưới sàn, số đếm thành phần, đầu vào là đúng các quan sát đã vào dải và không quan sát nào của chính gói;
//   ⑵ L7 tái lập: tính lại sau khi có gói mới mở và ánh xạ mới ⇒ ra đúng hàng và đúng đầu vào đã lưu;
//   ⑶ L14 vế benchmark: ngưỡng đọc từ phiên bản GHIM, không từ phiên bản mới hơn; CSDL buộc `policy_id` của hàng = của lượt chấm;
//   ⑷ ghi một lần: khoá ngoại `ghi_luc → created_at` từ chối lần ghi ở giao dịch khác, có đối chứng dương cùng giao dịch;
//      `app_api` không sửa, không xoá, không tự đặt `ghi_luc`; phiên khách thấy 0 hàng;
//   ⑸ `docBenchmark`: ~~as-of khi `UNSEALED`~~ [S1.260 / S4.5c1] lần đọc ĐẦU sau mở thầu tính và GHI bản lưu, ra đúng nhãn mà lượt
//      chấm ghi sau đó; lần sau đọc bản lưu; cổng `bid.view` có hàng sổ từ chối; mỗi lần đọc một hàng `BENCHMARK_READ` không mang giá;
//      phiên bản không cấu hình ⇒ `CHUA_CAU_HINH` và lượt chấm vẫn chạy;
//   ⑹ [S1.260 / S4.5c1] bản lưu: một bản mỗi lần mở thầu, hai lần đọc đồng thời ghi MỘT bản; CSDL buộc phiên bản ghim, đúng gói, cùng
//      giao dịch, một lần; chỉ-ghi-thêm; khách không thấy;
//   ⑺ [S1.260 / S4.5c1] *Xem dải*: số của dải đúng dữ liệu thiết kế, số đếm trùng bản lưu, `SAU_MOC` đếm tới lúc đọc (đối chứng dương),
//      cổng và hàng sổ; vòng chào lại đang mở hay đã đóng ⇒ không nhãn, không dải; mở niêm phong vòng ấy ⇒ bản lưu MỚI cho lần mở thầu mới.
//   ⑼ [S1.262 / S4.5c2] bộ bằng chứng mang lớp dữ liệu nền của gói X: bộ kiểm NGOẠI TUYẾN (CLI thật, `DATABASE_URL` đã xoá) tính lại
//      đủ chín nhãn từ đơn giá đã quy đổi; định danh của gói khác và nhà cung cấp chỉ ra dạng băm, muối mỗi lần xuất; người ánh xạ.
//   ⑽ [S1.276 / S4.6b] lịch sử mua ngoài và mốc ngoài (L1, L15; ADR-151): nhãn ngoài tính cùng lần đọc đầu và lưu (không số tiền),
//      cờ mốc ngoài ở bảng, số của dải ngoài + mốc + độ lệch ở *Xem dải*; L1 tại mốc mở giá (ghi/rút sau mốc chỉ được đếm, quy đổi
//      riêng rút trước mốc ⇒ không quy đổi được); bản lưu trước S4.6b; CSDL của bảng con.
//
// Giàn cảnh: gói đã mở niêm phong dựng bằng SQL thô dưới vai chủ cụm, đúng thứ tự cạnh của đường thật (khuôn
// `packages/du-lieu-nen/src/lich-su-gia.int.test.ts`) — mọi trigger ENABLE ALWAYS vẫn chạy, kể cả trigger ghim chính sách lúc OPEN.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { PermissionDeniedError } from "@trustprocure/identity";
import {
  NHOM_BENCHMARK_MAU,
  docNhomBenchmark,
  ghiBanLuuBenchmark,
  khaiQuyDoiRieng,
  nhapDuLieuNgoai,
  rutDuLieuNgoai,
  rutQuyDoiRieng,
  taoHangChuan,
  tinhBenchmarkGoi,
} from "@trustprocure/du-lieu-nen";
import { TEP_DAC_TA, TEP_DU_LIEU, docBenchmark, docDaiBenchmark, dungBoBangChung, taoLuotDanhGia, type BenchmarkCuaGoi } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const TP_GIA = '[{"ma":"gia","don_vi":"TIEN","he_so":"1.0000"}]';

interface Nguoi {
  readonly nguoi: string;
  readonly phien: string;
}
interface BaoGia {
  readonly versionId: string;
  readonly supplierId: string;
  readonly phienKhach: string;
  readonly bidId: string;
}
interface HangKetQua {
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly nhan: string;
  readonly chieu: string | null;
  readonly ly_do: string | null;
  readonly canonical_item_id: string | null;
  readonly anh_xa_id: string | null;
  readonly tien_te: string | null;
  readonly so_quan_sat: number | null;
  readonly so_goi: number | null;
  readonly so_ncc: number | null;
  readonly so_goi_cung_nguoi_tao: number | null;
  readonly so_quan_sat_hoi_to: number | null;
  readonly so_loai_tien_te: number | null;
  readonly so_loai_gia_0: number | null;
  readonly hoi_to: string[];
  readonly policy_id: string;
}

let db: TestDatabase;
let api: pg.Pool;
let orgA = "";
let orgB = "";
let pm: Nguoi;
let pm2: Nguoi;
let duyet: Nguoi;
let ql: Nguoi;
let kyThuat: Nguoi;
let pmB: Nguoi;
let orgC = "";
let pmC: Nguoi;
let duyetB: Nguoi;
let chinhSachA1 = "";
let chinhSachA2 = "";
let hangThep = "";
let hangCat = "";

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

async function chinhSach(orgId: string, version: number, nguoi: Nguoi, benchmark: unknown): Promise<string> {
  return (
    await db.pool.query<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, benchmark, " +
        "created_by, created_by_session_id) VALUES ($1, $2, '100000000000.00', 'VND', $3::jsonb, 3, $4::jsonb, $5, $6) RETURNING id",
      [orgId, version, TP_GIA, benchmark === null ? null : JSON.stringify(benchmark), nguoi.nguoi, nguoi.phien],
    )
  ).rows[0]!.id;
}

interface Bo {
  readonly org: string;
  readonly tao: Nguoi;
  readonly duyet: Nguoi;
  readonly chinhSach: string;
}

/** Gói `OPEN` với các dòng `(mô tả, số lượng, đơn vị)`. */
async function taoGoi(bo: Bo, dong: readonly (readonly [string, string, string])[]): Promise<string> {
  const rfqId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, 'Mua vat tu', $2, false, $3, $4) RETURNING id",
      [bo.org, MAI_SAU, bo.tao.nguoi, bo.tao.phien],
    )
  ).rows[0]!.id;
  for (const [i, [moTa, soLuong, donVi]] of dong.entries()) {
    await db.pool.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [bo.org, rfqId, i + 1, moTa, soLuong, donVi, bo.tao.nguoi, bo.tao.phien],
    );
  }
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '1000000000.00', 'VND', $3, $4, $5)",
    [bo.org, rfqId, bo.chinhSach, bo.tao.nguoi, bo.tao.phien],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, bo.tao.nguoi, bo.tao.phien],
  );
  await db.pool.query("INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)", [
    bo.org,
    rfqId,
    bo.duyet.nguoi,
    bo.duyet.phien,
  ]);
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, key_version, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
      [bo.org, rfqId, Buffer.alloc(91, 1), Buffer.alloc(80, 2), bo.tao.nguoi, bo.tao.phien],
    );
    await c.query("UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1", [
      rfqId,
      bo.tao.nguoi,
      bo.tao.phien,
    ]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  return rfqId;
}

async function nopBaoGia(bo: Bo, rfqId: string): Promise<BaoGia> {
  const supplierId = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [bo.org, `NCC ${randomBytes(3).toString("hex")}`, bo.tao.nguoi, bo.tao.phien],
    )
  ).rows[0]!.id;
  const lienHe = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
      [bo.org, supplierId, `${randomBytes(4).toString("hex")}@ncc.vn`, bo.tao.nguoi, bo.tao.phien],
    )
  ).rows[0]!.id;
  const loiMoi = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
        "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
      [bo.org, rfqId, supplierId, lienHe, bo.tao.nguoi, bo.tao.phien],
    )
  ).rows[0]!.id;
  const token = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
        "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
      [bo.org, loiMoi, randomBytes(32), bo.tao.nguoi, bo.tao.phien],
    )
  ).rows[0]!.id;
  const thachThuc = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, " +
        "destination_hash, pepper_version, expires_at, consumed_at) " +
        "VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) RETURNING id",
      [bo.org, loiMoi, token, lienHe, randomBytes(32), randomBytes(32)],
    )
  ).rows[0]!.id;
  const phienKhach = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
        "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
      [bo.org, loiMoi, thachThuc, randomBytes(32), lienHe],
    )
  ).rows[0]!.id;
  return trong(bo.org, async (c) => {
    const bidId = (await c.query<{ id: string }>("INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [bo.org, loiMoi]))
      .rows[0]!.id;
    const v = (
      await c.query<{ id: string; version: number }>(
        "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id, version",
        [bo.org, bidId, Buffer.alloc(64, 9), phienKhach],
      )
    ).rows[0]!;
    await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
      bo.org,
      v.id,
      `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bidId}\n` +
        `version=${String(v.version)}\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-30T00:00:00.000000Z\n`,
      Buffer.alloc(70, 7),
    ]);
    return { versionId: v.id, supplierId, phienKhach, bidId };
  });
}

/** Đóng, xin mở, duyệt, mở: bản rõ, `UNSEALED`, `EXECUTED` — cùng thứ tự worker thật. `luc` cho sẵn: lùi `unsealed_at`. */
async function moThau(bo: Bo, rfqId: string, banRo: readonly (readonly [string, unknown])[], luc: string | null = null): Promise<void> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de do', closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, bo.tao.nguoi, bo.tao.phien],
  );
  const yeuCau = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
      [bo.org, rfqId, bo.tao.nguoi, bo.tao.phien],
    )
  ).rows[0]!.id;
  await db.pool.query("INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [
    bo.org,
    yeuCau,
    bo.duyet.nguoi,
    bo.duyet.phien,
  ]);
  await db.pool.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yeuCau]);
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    for (const [versionId, payload] of banRo) {
      await c.query(
        "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload, unsealed_at) VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now()))",
        [bo.org, yeuCau, versionId, JSON.stringify(payload), luc],
      );
    }
    await c.query("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfqId]);
    await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [yeuCau]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

/** Phong bì như trình duyệt dựng: `totalAmount` là Σ `amount`. */
function phongBi(dong: readonly (readonly [number, string])[]): unknown {
  return {
    totalAmount: dong.reduce((s, [, a]) => s + Number(a), 0).toFixed(2),
    currency: "VND",
    lines: dong.map(([lineNo, amount]) => ({ lineNo, unitPrice: "1", amount })),
  };
}

async function anhXa(org: string, rfqId: string, lineNo: number, hangChuan: string | null, lyDo: string | null = null): Promise<void> {
  await trong(org, (c) =>
    c.query(
      "INSERT INTO rfq_item_mappings (org_id, rfq_id, line_no, nguon, canonical_item_id, phien_ban_bo_chuan_hoa, dau_vao, ly_do, tac_gia, session_id) " +
        "VALUES ($1, $2, $3, 'NGUOI_DUYET', $4, 1, '{}', $5, $6, $7)",
      [org, rfqId, lineNo, hangChuan, lyDo, ql.nguoi, ql.phien],
    ),
  );
}

/** Gói lịch sử một dòng (10 kg) ánh xạ TRƯỚC khi mở (hay SAU, có lý do — ánh xạ hồi tố), mỗi số tiền một nhà cung cấp. */
async function goiLichSu(
  bo: Bo,
  hang: string,
  tien: readonly string[],
  tuy: { readonly hoiTo?: boolean; readonly luc?: string; readonly khongAnhXa?: boolean } = {},
): Promise<{ readonly rfqId: string; readonly bg: readonly BaoGia[] }> {
  const rfqId = await taoGoi(bo, [["Vat tu", "10", "kg"]]);
  if (tuy.hoiTo !== true && tuy.khongAnhXa !== true) await anhXa(bo.org, rfqId, 1, hang);
  const bg: BaoGia[] = [];
  for (let i = 0; i < tien.length; i += 1) bg.push(await nopBaoGia(bo, rfqId));
  await moThau(
    bo,
    rfqId,
    bg.map((b, i) => [b.versionId, phongBi([[1, tien[i]!]])] as const),
    tuy.luc ?? null,
  );
  if (tuy.hoiTo === true) await anhXa(bo.org, rfqId, 1, hang, "anh xa sau khi mo de do hoi to");
  return { rfqId, bg };
}

async function ketQua(org: string, evaluationId: string): Promise<HangKetQua[]> {
  return (
    await db.pool.query<HangKetQua>(
      "SELECT bid_version_id, line_no, nhan, chieu, ly_do, canonical_item_id, anh_xa_id, tien_te, so_quan_sat, so_goi, so_ncc, " +
        "so_goi_cung_nguoi_tao, so_quan_sat_hoi_to, so_loai_tien_te, so_loai_gia_0, hoi_to, policy_id " +
        "FROM price_benchmark_results WHERE org_id = $1 AND evaluation_id = $2 ORDER BY line_no, bid_version_id",
      [org, evaluationId],
    )
  ).rows;
}

async function dauVao(org: string, evaluationId: string): Promise<{ bid_version_id: string; line_no: number; canonical_item_id: string; hoi_to: string[] }[]> {
  return (
    await db.pool.query<{ bid_version_id: string; line_no: number; canonical_item_id: string; hoi_to: string[] }>(
      "SELECT bid_version_id, line_no, canonical_item_id, hoi_to FROM price_benchmark_inputs WHERE org_id = $1 AND evaluation_id = $2 " +
        "ORDER BY canonical_item_id, bid_version_id, line_no",
      [org, evaluationId],
    )
  ).rows;
}

// ---- Dữ liệu thiết kế ----------------------------------------------------------------------------------------------------------
// Thép (gốc kg), dòng 10 kg, đơn giá = số tiền / 10:
//   H1 {100, 120} → trung vị 110 · H2 {105} → 105 (do pm2 lập) · H3 {90, 110} → 100, ánh xạ HỒI TỐ, mở 3 tháng trước · H4 {0} → loại, đếm, mở ngay sau biên cửa sổ ·
//   H5 {500} mở 26 tháng trước → ngoài cửa sổ 12 tháng.
//   Trung vị các trung vị gói {100, 105, 110} = 105; 0.05·105 = 5.25; 0.10·105 = 10.5.
// Cát (gốc kg): H6 {50}, H7 {55} → hai gói, dưới sàn.
// Gói X do pm2 lập: dòng 1 thép 10 kg, dòng 2 không ánh xạ, dòng 3 cát 10 kg (ánh xạ SAU khi X mở — hồi tố của chính dòng).
//   SX1: 1050 → 105 BINH_THUONG · SX2: 1300 → 130 LECH_CAO TREN · SX3: 960 → 96 LECH_VUA DUOI, bỏ trống dòng 3.
let boA: Bo;
let boA2: Bo;
let rfqX = "";
let bgX: readonly BaoGia[] = [];
let lichSuThep: readonly { readonly rfqId: string; readonly bg: readonly BaoGia[] }[] = [];
let lichSuCat: readonly { readonly rfqId: string; readonly bg: readonly BaoGia[] }[] = [];
let asOfTruocCham: BenchmarkCuaGoi | null = null;
let sauMocX: { readonly rfqId: string; readonly bg: readonly BaoGia[] } = { rfqId: "", bg: [] };
let anhXaSauMocX: { readonly rfqId: string; readonly bg: readonly BaoGia[] } = { rfqId: "", bg: [] };
let evaluationId = "";

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  api = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'bm-a'), ('Cong ty B', 'bm-b'), ('Cong ty C', 'bm-c') RETURNING id",
  );
  orgA = rows[0]!.id;
  orgB = rows[1]!.id;
  orgC = rows[2]!.id;
  pm = await taoNguoi(orgA, ["PROCUREMENT_MANAGER"]);
  pm2 = await taoNguoi(orgA, ["PROCUREMENT_MANAGER"]);
  duyet = await taoNguoi(orgA, ["DIRECTOR"]);
  ql = await taoNguoi(orgA, ["DATA_STEWARD"]);
  kyThuat = await taoNguoi(orgA, ["TECHNICAL"]);
  pmB = await taoNguoi(orgB, ["PROCUREMENT_MANAGER"]);
  pmC = await taoNguoi(orgC, ["FINANCE"]);
  duyetB = await taoNguoi(orgB, ["DIRECTOR"]);
  chinhSachA1 = await chinhSach(orgA, 1, pm, NHOM_BENCHMARK_MAU);
  boA = { org: orgA, tao: pm, duyet, chinhSach: chinhSachA1 };
  boA2 = { org: orgA, tao: pm2, duyet, chinhSach: chinhSachA1 };
  const tao = async (ma: string, ten: string): Promise<string> =>
    (await trong(orgA, (c) => taoHangChuan(c, orgA, { ma, ten, donViGoc: "kg", actorSessionId: ql.phien }))).id;
  hangThep = await tao("THEP-D10", "Thép vằn D10");
  hangCat = await tao("CAT-VANG", "Cát vàng");

  const luc26Thang = (await db.pool.query<{ t: string }>("SELECT (now() - interval '26 months')::text AS t")).rows[0]!.t;
  // [rà soát S4.5c2] H3 mở 3 tháng trước — trong cửa sổ, ngoài mọi ngày biên — để bộ bằng chứng có quan sát mang `ngay` dạng NGÀY
  // TRƠN (§8.2). H3 vốn ánh xạ hồi tố, nên mốc lùi không đổi cờ hồi tố hay số đếm nào.
  const luc3Thang = (await db.pool.query<{ t: string }>("SELECT (now() - interval '3 months')::text AS t")).rows[0]!.t;
  // [rà soát S4.5c2] H4 (đơn giá 0 — bị loại TRƯỚC dải, nên số đếm nào cũng không đổi) mở mười phút SAU biên cửa sổ 12 tháng của X,
  // kẹp về cuối NGÀY UTC của biên ấy: trong cửa sổ, trên ngày biên — §8.2 đòi đủ micro giây ở đó. X mở vài giây sau dòng này nên biên
  // của X còn trước H4; chỉ một lượt dựng VẮT qua nửa đêm UTC mới đặt biên ấy sau H4. Lịch tính trên giờ tường UTC, không múi giờ phiên.
  const lucBienCuaSo = (
    await db.pool.query<{ t: string }>(
      "SELECT (LEAST(n - interval '12 months' + interval '10 minutes', date_trunc('day', n - interval '12 months') + interval '1 day' - " +
        "interval '1 microsecond') AT TIME ZONE 'UTC')::text AS t FROM (SELECT now() AT TIME ZONE 'UTC' AS n) x",
    )
  ).rows[0]!.t;
  lichSuThep = [
    await goiLichSu(boA, hangThep, ["1000", "1200"]),
    await goiLichSu(boA2, hangThep, ["1050"]),
    await goiLichSu(boA, hangThep, ["900", "1100"], { hoiTo: true, luc: luc3Thang }),
    await goiLichSu(boA, hangThep, ["0"], { luc: lucBienCuaSo }),
    await goiLichSu(boA, hangThep, ["5000"], { luc: luc26Thang }),
  ];
  lichSuCat = [await goiLichSu(boA, hangCat, ["500"]), await goiLichSu(boA, hangCat, ["550"])];
  // Gói thép mở TRƯỚC X mà chỉ được ánh xạ SAU khi X mở: tại mốc của X dòng ấy chưa ánh xạ — dải không thấy nó; đọc hàng nền tại lúc
  // chấm thì thấy (đối chứng cho "dải đọc tại MỐC MỞ GIÁ", đột biến M12 của §S1.256).
  anhXaSauMocX = await goiLichSu(boA, hangThep, ["2000"], { khongAnhXa: true });

  rfqX = await taoGoi(boA2, [
    ["Thep vang D10", "10", "kg"],
    ["Hang la", "1", "cai"],
    ["Cat vang", "10", "kg"],
  ]);
  await anhXa(orgA, rfqX, 1, hangThep);
  // L14: phiên bản 2 khai SAU lúc X mở, với ngưỡng rộng — dưới nó SX2 (130) là BINH_THUONG. X ghim phiên bản 1.
  chinhSachA2 = await chinhSach(orgA, 2, pm, { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: "0.30", nguong_lech_cao: "0.50" });
  bgX = [await nopBaoGia(boA2, rfqX), await nopBaoGia(boA2, rfqX), await nopBaoGia(boA2, rfqX)];
  await moThau(boA2, rfqX, [
    [bgX[0]!.versionId, phongBi([[1, "1050"], [2, "500"], [3, "300"]])],
    [bgX[1]!.versionId, phongBi([[1, "1300"], [2, "500"], [3, "300"]])],
    [bgX[2]!.versionId, phongBi([[1, "960"], [2, "500"]])],
  ]);
  await anhXa(orgA, rfqX, 3, hangCat, "anh xa sau khi mo de do hoi to cua chinh dong");
  // Gói thép mở SAU mốc mở giá của X nhưng TRƯỚC lượt chấm: dải đọc TẠI MỐC của X nên không thấy nó — đọc tại lúc chấm thì thấy.
  sauMocX = await goiLichSu(boA, hangThep, ["10"]);
  await anhXa(orgA, anhXaSauMocX.rfqId, 1, hangThep, "anh xa sau moc mo gia cua X");

  asOfTruocCham = await trong(orgA, (c) => docBenchmark(c, orgA, { rfqId: rfqX, actorSessionId: pm.phien }, api));
  evaluationId = (await trong(orgA, (c) => taoLuotDanhGia(c, orgA, { rfqId: rfqX, actorSessionId: pm.phien }, api))).evaluationId;
}, 600_000);

afterAll(async () => {
  await api.end();
  await db.stop();
});

const CHEN_KET_QUA =
  "INSERT INTO price_benchmark_results (org_id, evaluation_id, rfq_id, policy_id, bid_version_id, line_no, phuong_phap, moc_mo_gia, nhan, ly_do, hoi_to) " +
  "VALUES ($1, $2, $3, $4, $5, 1, 'TRUNG_VI_THEO_GOI_V1', now() - interval '1 second', 'KHONG_DO_DUOC', 'CHUA_ANH_XA', '{}')";
const CHEN_DAU_VAO =
  "INSERT INTO price_benchmark_inputs (org_id, evaluation_id, canonical_item_id, tien_te, bid_version_id, line_no, anh_xa_id, hoi_to) " +
  "VALUES ($1, $2, $3, 'VND', $4, 1, $5, '{}')";

/** Gói một dòng thép, một báo giá, đã mở — mở SAU phiên bản 2 nên ghim phiên bản 2. */
async function goiMoiDaMo(): Promise<{ readonly rfqId: string; readonly bg: BaoGia }> {
  const rfqId = await taoGoi(boA2, [["Thep", "10", "kg"]]);
  const bg = await nopBaoGia(boA2, rfqId);
  await moThau(boA2, rfqId, [[bg.versionId, phongBi([[1, "1000"]])]]);
  return { rfqId, bg };
}

/** Lượt chấm THÔ dưới `app_api` — một hàng `rfq_evaluations` và một hàng xếp hạng, trong giao dịch của `c`. */
async function luotTho(c: pg.PoolClient, rfqId: string, bidVersionId: string): Promise<string> {
  const luot = (
    await c.query<{ id: string }>(
      "INSERT INTO rfq_evaluations (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id) VALUES ($1, $2, $3, 'VND', $4, $5) RETURNING id",
      [orgA, rfqId, chinhSachA2, pm.nguoi, pm.phien],
    )
  ).rows[0]!.id;
  await c.query(
    "INSERT INTO rfq_evaluation_lines (org_id, evaluation_id, bid_version_id, effective_cost, components, rank) " +
      "VALUES ($1, $2, $3, '1000.00', '[{\"ma\":\"gia\",\"tien\":\"1000.00\"}]', 1)",
    [orgA, luot, bidVersionId],
  );
  return luot;
}

async function anhXaCua(rfqId: string): Promise<string> {
  return (await db.pool.query<{ id: string }>("SELECT id FROM rfq_item_mappings WHERE rfq_id = $1 ORDER BY seq LIMIT 1", [rfqId])).rows[0]!.id;
}

const KHONG_DAI = {
  tien_te: null,
  so_quan_sat: null,
  so_goi: null,
  so_ncc: null,
  so_goi_cung_nguoi_tao: null,
  so_quan_sat_hoi_to: null,
  so_loai_tien_te: null,
  so_loai_gia_0: null,
};
const DAI_THEP = {
  canonical_item_id: "",
  tien_te: "VND",
  so_quan_sat: 5,
  so_goi: 3,
  so_ncc: 5,
  so_goi_cung_nguoi_tao: 1,
  so_quan_sat_hoi_to: 2,
  so_loai_tien_te: 0,
  so_loai_gia_0: 1,
};

describe("[INV-L7] ⑴ lượt chấm ghi đúng một hàng mỗi (báo giá, dòng)", { timeout: 120_000 }, () => {
  it("nhãn, chiều, lý do, số đếm — đúng dữ liệu thiết kế; hàng mang phiên bản ghim", async () => {
    const kq = await ketQua(orgA, evaluationId);
    expect(kq).toHaveLength(9);
    const theo = (lineNo: number, i: number): HangKetQua => kq.find((r) => r.line_no === lineNo && r.bid_version_id === bgX[i]!.versionId)!;
    const thep = { ...DAI_THEP, canonical_item_id: hangThep, ly_do: null, hoi_to: [] };
    expect(theo(1, 0)).toMatchObject({ ...thep, nhan: "BINH_THUONG", chieu: null });
    expect(theo(1, 1)).toMatchObject({ ...thep, nhan: "LECH_CAO", chieu: "TREN" });
    expect(theo(1, 2)).toMatchObject({ ...thep, nhan: "LECH_VUA", chieu: "DUOI" });
    for (const i of [0, 1, 2]) {
      expect(theo(2, i)).toMatchObject({ ...KHONG_DAI, nhan: "KHONG_DO_DUOC", ly_do: "CHUA_ANH_XA", canonical_item_id: null, anh_xa_id: null, chieu: null });
    }
    const cat = { canonical_item_id: hangCat, tien_te: "VND", so_goi: 2, so_ncc: 2, so_quan_sat: 2, hoi_to: ["ANH_XA"] };
    expect(theo(3, 0)).toMatchObject({ ...cat, nhan: "CHUA_DU_LICH_SU", chieu: null, ly_do: null });
    expect(theo(3, 1)).toMatchObject({ ...cat, nhan: "CHUA_DU_LICH_SU", chieu: null, ly_do: null });
    expect(theo(3, 2)).toMatchObject({ ...KHONG_DAI, nhan: "KHONG_DO_DUOC", ly_do: "KHONG_DOC_DUOC", canonical_item_id: hangCat, hoi_to: ["ANH_XA"] });
    expect(new Set(kq.map((r) => r.policy_id))).toEqual(new Set([chinhSachA1]));
  });

  it("đầu vào: đúng các quan sát đã vào dải — không quan sát nào của CHÍNH gói X, ngoài cửa sổ, hay đơn giá 0", async () => {
    const dv = await dauVao(orgA, evaluationId);
    const cua = (ds: readonly { readonly bg: readonly BaoGia[] }[]) => ds.flatMap((g) => g.bg.map((b) => b.versionId));
    const thep = dv.filter((d) => d.canonical_item_id === hangThep).map((d) => d.bid_version_id).sort();
    expect(thep).toEqual(cua(lichSuThep.slice(0, 3)).sort());
    expect(dv.filter((d) => d.canonical_item_id === hangCat).map((d) => d.bid_version_id).sort()).toEqual(cua(lichSuCat).sort());
    const cuaX = new Set(bgX.map((b) => b.versionId));
    expect(dv.filter((d) => cuaX.has(d.bid_version_id)), "L7: không tự so").toEqual([]);
    expect(dv.filter((d) => d.bid_version_id === sauMocX.bg[0]!.versionId), "gói mở sau mốc của X không vào dải").toEqual([]);
    expect(dv.filter((d) => d.bid_version_id === anhXaSauMocX.bg[0]!.versionId), "ánh xạ ghi sau mốc của X không vào dải").toEqual([]);
    const hoiTo = dv.filter((d) => d.hoi_to.length > 0).map((d) => d.bid_version_id).sort();
    expect(hoiTo).toEqual(lichSuThep[2]!.bg.map((b) => b.versionId).sort());
  });
});

describe("[INV-L7] ⑵ tái lập", { timeout: 180_000 }, () => {
  it("tính lại tại cùng hai mốc SAU khi có gói mới mở và ánh xạ mới ⇒ đúng hàng và đúng đầu vào đã lưu; tính tại `now()` thì khác (đối chứng dương)", async () => {
    const truoc = await ketQua(orgA, evaluationId);
    const sapDv = <T extends { canonical_item_id: string; bid_version_id: string }>(ds: T[]): T[] =>
      ds.sort((a, b) => a.canonical_item_id.localeCompare(b.canonical_item_id) || a.bid_version_id.localeCompare(b.bid_version_id));
    const dvTruoc = sapDv(await dauVao(orgA, evaluationId));
    // Dữ liệu SAU mốc của X: một gói thép mới với giá cực, và ánh xạ lại một dòng lịch sử sang cát.
    await goiLichSu(boA, hangThep, ["99999"]);
    await anhXa(orgA, lichSuThep[0]!.rfqId, 1, hangCat, "doi anh xa sau luot cham");

    const ghiLuc = (
      await db.pool.query<{ us: string }>(
        "SELECT (extract(epoch FROM created_at) * 1000000)::int8::text AS us FROM rfq_evaluations WHERE id = $1",
        [evaluationId],
      )
    ).rows[0]!.us;
    const nhom = docNhomBenchmark(NHOM_BENCHMARK_MAU)!;
    const tinhLai = await trong(orgA, (c) =>
      tinhBenchmarkGoi(c, orgA, { rfqId: rfqX, bidVersionIds: bgX.map((b) => b.versionId), nhom, mocDoc: BigInt(ghiLuc) }),
    );
    const rutGon = (ds: readonly { bidVersionId: string; lineNo: number; nhan: string; chieu: string | null; lyDo: string | null; soQuanSat: number | null; soGoi: number | null; soNcc: number | null; soGoiCungNguoiTao: number | null; soQuanSatHoiTo: number | null; soLoaiTienTe: number | null; soLoaiGia0: number | null; hoiTo: readonly string[]; canonicalItemId: string | null; anhXaId: string | null; tienTe: string | null }[]) =>
      ds
        .map((d) => ({
          bid_version_id: d.bidVersionId,
          line_no: d.lineNo,
          nhan: d.nhan,
          chieu: d.chieu,
          ly_do: d.lyDo,
          canonical_item_id: d.canonicalItemId,
          anh_xa_id: d.anhXaId,
          tien_te: d.tienTe,
          so_quan_sat: d.soQuanSat,
          so_goi: d.soGoi,
          so_ncc: d.soNcc,
          so_goi_cung_nguoi_tao: d.soGoiCungNguoiTao,
          so_quan_sat_hoi_to: d.soQuanSatHoiTo,
          so_loai_tien_te: d.soLoaiTienTe,
          so_loai_gia_0: d.soLoaiGia0,
          hoi_to: [...d.hoiTo],
        }))
        .sort((a, b) => a.line_no - b.line_no || a.bid_version_id.localeCompare(b.bid_version_id));
    const boChinhSach = (r: HangKetQua): Omit<HangKetQua, "policy_id"> => {
      const { policy_id: chinhSachCuaHang, ...con } = r;
      expect(chinhSachCuaHang).toBe(chinhSachA1);
      return con;
    };
    const daLuu = truoc.map(boChinhSach).sort((a, b) => a.line_no - b.line_no || a.bid_version_id.localeCompare(b.bid_version_id));
    expect(rutGon(tinhLai.dong)).toEqual(daLuu);
    const dvLai = sapDv(
      tinhLai.dai.flatMap((d) => d.dauVao.map((q) => ({ bid_version_id: q.bidVersionId, line_no: q.lineNo, canonical_item_id: d.canonicalItemId, hoi_to: [...q.hoiTo] }))),
    );
    expect(dvLai).toEqual(dvTruoc);

    // Đối chứng dương: đọc lịch sử thép tại `now()` thấy gói mới — nếu phép tính lại đọc `now()` thay vì mốc, nó đã khác.
    const { rows } = await trong(orgA, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM quan_sat_gia(now(), $1) WHERE trang_thai = 'HOP_LE' AND don_gia_quy_doi = 9999.9", [hangThep]),
    );
    expect(rows[0]!.n).toBe("1");
  });
});

describe("[INV-L14] ⑶ vế benchmark — ngưỡng của phiên bản GHIM", { timeout: 120_000 }, () => {
  it("phiên bản 2 (ngưỡng rộng) khai SAU lúc X mở không áp: SX2 vẫn LECH_CAO; X ghim phiên bản 1", async () => {
    const ghim = (await db.pool.query<{ g: string }>("SELECT chinh_sach_ghim_id AS g FROM rfq_packages WHERE id = $1", [rfqX])).rows[0]!.g;
    expect(ghim).toBe(chinhSachA1);
    const kq = await ketQua(orgA, evaluationId);
    expect(kq.find((r) => r.line_no === 1 && r.bid_version_id === bgX[1]!.versionId)).toMatchObject({ nhan: "LECH_CAO", policy_id: chinhSachA1 });
  });

  it("CSDL: hàng mang `policy_id` khác phiên bản của lượt chấm ⇒ khoá ngoại `…_cua_luot_cham_fk` từ chối, cùng giao dịch; đúng phiên bản ⇒ vào (đối chứng dương)", async () => {
    // Gói mở SAU phiên bản 2 ⇒ ghim phiên bản 2; lượt chấm thô phải mang phiên bản ấy (S4.5a).
    const { rfqId, bg } = await goiMoiDaMo();
    const chen = (policyKetQua: string) =>
      trong(orgA, async (c) => {
        const luot = await luotTho(c, rfqId, bg.versionId);
        await c.query(CHEN_KET_QUA, [orgA, luot, rfqId, policyKetQua, bg.versionId]);
        await c.query(CHEN_DAU_VAO, [orgA, luot, hangThep, lichSuThep[1]!.bg[0]!.versionId, await anhXaCua(lichSuThep[1]!.rfqId)]);
        // Đối chứng dương đi tới đây; ném để giao dịch ROLLBACK.
        throw new Error("HOAN_TAC");
      });
    await expect(chen(chinhSachA1)).rejects.toMatchObject({ code: "23503", constraint: "price_benchmark_results_cua_luot_cham_fk" });
    await expect(chen(chinhSachA2)).rejects.toThrow("HOAN_TAC");
  });
});

describe("[INV-L7] nhóm khoá `benchmark` — `CHECK` của CSDL", { timeout: 120_000 }, () => {
  const chen = (benchmark: unknown) =>
    trong(orgC, (c) =>
      c.query(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, benchmark, created_by, created_by_session_id) " +
          "SELECT $1, coalesce(max(version), 0) + 1, '1000.00', 'VND', $2::jsonb, $3, $4 FROM org_procurement_policies WHERE org_id = $1",
        [orgC, JSON.stringify(benchmark), pmC.nguoi, pmC.phien],
      ),
    );
  it.each([
    ["vừa = cao", { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: "0.10" }],
    ["vừa > cao", { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: "0.2" }],
    ["vừa 0", { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: "0" }],
    ["cao > 10", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: "10.0001" }],
    ["năm chữ số lẻ", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: "0.10001" }],
    ["số mũ", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: "1e-1" }],
    ["NaN", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: "NaN" }],
    ["cửa sổ 61", { ...NHOM_BENCHMARK_MAU, cua_so_thang: "61" }],
    ["sàn 51", { ...NHOM_BENCHMARK_MAU, san_ncc: "51" }],
    ["sàn 0", { ...NHOM_BENCHMARK_MAU, san_goi: "0" }],
    ["số JSON", { ...NHOM_BENCHMARK_MAU, cua_so_thang: 12 }],
    ["thiếu khoá", { cua_so_thang: "12", san_goi: "3", san_ncc: "3", nguong_lech_vua: "0.05", phuong_phap: "TRUNG_VI_THEO_GOI_V1" }],
    ["thừa khoá", { ...NHOM_BENCHMARK_MAU, x: "1" }],
    ["phương pháp lạ", { ...NHOM_BENCHMARK_MAU, phuong_phap: "TRUNG_VI_TU_PHAN_VI_V1" }],
    ["mảng", [NHOM_BENCHMARK_MAU]],
    // [lượt soi §S1.256 — TRUNG-1] jsonpath `lax` tự mở mảng: năm dạng dưới đây từng QUA `CHECK` và làm lượt chấm ném mãi.
    ["cửa sổ là mảng", { ...NHOM_BENCHMARK_MAU, cua_so_thang: ["12"] }],
    ["cửa sổ là mảng vượt biên", { ...NHOM_BENCHMARK_MAU, cua_so_thang: ["12", "99"] }],
    ["ngưỡng vừa là mảng", { ...NHOM_BENCHMARK_MAU, nguong_lech_vua: ["0.05", "0.50"], nguong_lech_cao: ["0.10"] }],
    ["ngưỡng cao là mảng vượt biên", { ...NHOM_BENCHMARK_MAU, nguong_lech_cao: ["0.10", "50"] }],
    ["phương pháp là mảng", { ...NHOM_BENCHMARK_MAU, phuong_phap: ["TRUNG_VI_THEO_GOI_V1"] }],
    ["sàn là đối tượng", { ...NHOM_BENCHMARK_MAU, san_goi: { a: "3" } }],
  ])("%s ⇒ `org_procurement_policies_benchmark_hinh_dang` từ chối", async (_ten, tho) => {
    await expect(chen(tho)).rejects.toMatchObject({ code: "23514", constraint: "org_procurement_policies_benchmark_hinh_dang" });
  });
  it("đối chứng dương: mẫu, và hai biên 60 tháng · sàn 50 · ngưỡng 9.9999/10 — vào", async () => {
    await expect(chen(NHOM_BENCHMARK_MAU)).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      chen({ ...NHOM_BENCHMARK_MAU, cua_so_thang: "60", san_goi: "50", san_ncc: "1", nguong_lech_vua: "9.9999", nguong_lech_cao: "10" }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("[INV-L7] hệ số quy đổi riêng hữu hạn — một `NaN` trong dải làm lượt chấm ném mãi", { timeout: 120_000 }, () => {
  // [lượt soi §S1.256 — THẤP-5] `'NaN' > 0` là đúng trong Postgres, nên `CHECK` của `083` nhận nó.
  const chen = (heSo: string) =>
    trong(orgA, (c) =>
      c.query(
        "INSERT INTO item_uom_conversions (org_id, canonical_item_id, tu_don_vi, sang_don_vi, he_so, tac_gia, session_id) " +
          "VALUES ($1, $2, 'bao', 'kg', $3::numeric, $4, $5)",
        [orgA, hangCat, heSo, ql.nguoi, ql.phien],
      ),
    );
  it.each(["NaN", "Infinity"])("`he_so` %s ⇒ `item_uom_conversions_he_so_huu_han` từ chối", async (heSo) => {
    await expect(chen(heSo)).rejects.toMatchObject({ code: "23514", constraint: "item_uom_conversions_he_so_huu_han" });
  });
  it("đối chứng dương: `he_so` 50 vào", async () => {
    await expect(chen("50")).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("[INV-L7] ⑷ ghi một lần, chỉ-ghi-thêm, khách không thấy", { timeout: 120_000 }, () => {
  it("lần ghi ở giao dịch KHÁC giao dịch tạo lượt chấm ⇒ khoá ngoại `…_cua_luot_cham_fk` từ chối, ở cả hai bảng", async () => {
    const { rfqId, bg } = await goiMoiDaMo();
    const luot = await trong(orgA, (c) => luotTho(c, rfqId, bg.versionId));
    await expect(trong(orgA, (c) => c.query(CHEN_KET_QUA, [orgA, luot, rfqId, chinhSachA2, bg.versionId]))).rejects.toMatchObject({
      code: "23503",
      constraint: "price_benchmark_results_cua_luot_cham_fk",
    });
    const ax = await anhXaCua(lichSuThep[1]!.rfqId);
    await expect(
      trong(orgA, (c) => c.query(CHEN_DAU_VAO, [orgA, luot, hangThep, lichSuThep[1]!.bg[0]!.versionId, ax])),
    ).rejects.toMatchObject({ code: "23503", constraint: "price_benchmark_inputs_cua_luot_cham_fk" });
  });

  it("`app_api` không UPDATE, không DELETE, không tự đặt `ghi_luc`", async () => {
    for (const cau of [
      "UPDATE price_benchmark_results SET nhan = 'BINH_THUONG' WHERE evaluation_id = $1",
      "DELETE FROM price_benchmark_results WHERE evaluation_id = $1",
      "UPDATE price_benchmark_inputs SET hoi_to = '{}' WHERE evaluation_id = $1",
      "DELETE FROM price_benchmark_inputs WHERE evaluation_id = $1",
    ]) {
      await expect(trong(orgA, (c) => c.query(cau, [evaluationId])), cau).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      trong(orgA, (c) =>
        c.query(
          "INSERT INTO price_benchmark_results (org_id, evaluation_id, rfq_id, policy_id, bid_version_id, line_no, phuong_phap, moc_mo_gia, nhan, ly_do, hoi_to, ghi_luc) " +
            "SELECT $1, e.id, e.rfq_id, e.policy_id, $3, 2, 'TRUNG_VI_THEO_GOI_V1', now() - interval '1 second', 'KHONG_DO_DUOC', 'CHUA_ANH_XA', '{}', e.created_at " +
            "FROM rfq_evaluations e WHERE e.id = $2",
          [orgA, evaluationId, bgX[0]!.versionId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("phiên khách thấy 0 hàng ở cả hai bảng; tổ chức khác thấy 0 hàng", async () => {
    const dem = (org: string, khach: string | null) =>
      trong(org, async (c) => {
        if (khach !== null) await c.query("SELECT set_config('app.guest_session_id', $1, true)", [khach]);
        const a = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM price_benchmark_results");
        const b = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM price_benchmark_inputs");
        return [a.rows[0]!.n, b.rows[0]!.n];
      });
    const coHang = await dem(orgA, null);
    expect(Number(coHang[0]) > 0 && Number(coHang[1]) > 0, "đối chứng dương").toBe(true);
    expect(await dem(orgA, bgX[0]!.phienKhach)).toEqual(["0", "0"]);
    expect(await dem(orgB, null)).toEqual(["0", "0"]);
  });
});


// ---- [S1.260 / S4.5c1] Bản lưu của bảng so sánh ---------------------------------------------------------------------------------
const doc = (org: string, rfqId: string, phien = pm.phien) => trong(org, (c) => docBenchmark(c, org, { rfqId, actorSessionId: phien }, api));

async function banLuuCua(rfqId: string): Promise<{ id: string; unseal_request_id: string; policy_id: string }[]> {
  return (
    await db.pool.query<{ id: string; unseal_request_id: string; policy_id: string }>(
      "SELECT id, unseal_request_id, policy_id FROM price_benchmark_snapshots WHERE rfq_id = $1 ORDER BY ghi_luc",
      [rfqId],
    )
  ).rows;
}

async function lanMoMoiNhat(rfqId: string): Promise<string> {
  return (
    await db.pool.query<{ id: string }>(
      "SELECT id FROM unseal_requests WHERE rfq_id = $1 AND status = 'EXECUTED' ORDER BY executed_at DESC, id DESC LIMIT 1",
      [rfqId],
    )
  ).rows[0]!.id;
}

/** Một hàng của bảng so sánh rút gọn để so hai nguồn: (báo giá, dòng, nhãn, chiều, lý do, số gói, cờ hồi tố). */
const gon = (b: BenchmarkCuaGoi | null): string[] =>
  b?.trangThai === "CO"
    ? b.dong
        .map((d) => `${d.bidVersionId}:${String(d.lineNo)}:${d.nhan}:${d.chieu ?? "-"}:${d.lyDo ?? "-"}:${String(d.soGoi)}:${d.hoiTo.join("+")}`)
        .sort()
    : [];

describe("[INV-L7] ⑸ docBenchmark", { timeout: 180_000 }, () => {
  it("lần đọc ĐẦU lúc `UNSEALED` tính và ghi bản lưu, ra đúng nhãn mà lượt chấm ghi sau đó; sau lượt chấm đọc BẢN LƯU", async () => {
    expect(asOfTruocCham).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI", bafoRoundId: null, policyId: chinhSachA1, policyVersion: 1 });
    const sau = await doc(orgA, rfqX);
    expect(sau).toMatchObject({ trangThai: "CO", nguon: "BAN_LUU", policyId: chinhSachA1, policyVersion: 1 });
    expect(sau?.trangThai === "CO" && asOfTruocCham?.trangThai === "CO" && sau.snapshotId === asOfTruocCham.snapshotId).toBe(true);
    expect(gon(asOfTruocCham)).toHaveLength(9);
    expect(gon(sau)).toEqual(gon(asOfTruocCham));
    const luotCham = (await ketQua(orgA, evaluationId))
      .map((r) => `${r.bid_version_id}:${String(r.line_no)}:${r.nhan}:${r.chieu ?? "-"}:${r.ly_do ?? "-"}:${String(r.so_goi)}:${r.hoi_to.join("+")}`)
      .sort();
    expect(gon(sau), "bản lưu và hàng của lượt chấm: cùng phép tính, cùng nhãn").toEqual(luotCham);
  });

  it("cổng `bid.view`: TECHNICAL (giữ `evaluation.perform`, không `bid.view`) bị từ chối kèm hàng sổ; mỗi lần đọc một hàng `BENCHMARK_READ` không mang giá", async () => {
    await expect(doc(orgA, rfqX, kyThuat.phien)).rejects.toBeInstanceOf(PermissionDeniedError);
    const tuChoi = await db.pool.query(
      "SELECT 1 FROM audit_events WHERE org_id = $1 AND action = 'PERMISSION_DENIED' AND actor_id = $2 AND resource_id = $3",
      [orgA, kyThuat.nguoi, rfqX],
    );
    expect(tuChoi.rowCount).toBe(1);
    const truoc = (await db.pool.query("SELECT 1 FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_READ'", [orgA])).rowCount!;
    await doc(orgA, rfqX);
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_READ' ORDER BY seq DESC",
      [orgA],
    );
    expect(rows).toHaveLength(truoc + 1);
    expect(Object.keys(rows[0]!.payload).sort()).toEqual([
      "nguon", "rfqId", "snapshotId", "soDong", "soDongNgoai", "soMocNgoai", "trangThai", "viewedBySessionId",
    ]);
  });

  it("gói `EVALUATING` mà chưa ai đọc (lượt chấm thô) ⇒ lần đọc đầu tính bản lưu cho lần mở thầu MỚI NHẤT, dưới phiên bản ghim", async () => {
    const { rfqId, bg } = await goiMoiDaMo();
    await trong(orgA, async (c) => {
      await luotTho(c, rfqId, bg.versionId);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
    });
    const kq = await doc(orgA, rfqId);
    expect(kq).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI", unsealRequestId: await lanMoMoiNhat(rfqId), policyId: chinhSachA2 });
    expect(await banLuuCua(rfqId)).toHaveLength(1);
  });

  it("gói chưa mở niêm phong ⇒ `KHONG_HIEN`, không bản lưu nào", async () => {
    const rfqMo = await taoGoi(boA, [["Thep", "10", "kg"]]);
    expect(await doc(orgA, rfqMo)).toEqual({ trangThai: "KHONG_HIEN", rfqStatus: "OPEN" });
    expect(await banLuuCua(rfqMo)).toEqual([]);
  });

  it("phiên bản ghim không có nhóm `benchmark` ⇒ lượt chấm vẫn chạy, không hàng nào, đọc ra `CHUA_CAU_HINH` trước và sau lượt chấm", async () => {
    const csB = await chinhSach(orgB, 1, pmB, null);
    const boB: Bo = { org: orgB, tao: pmB, duyet: duyetB, chinhSach: csB };
    const rfqB = await taoGoi(boB, [["Thep", "10", "kg"]]);
    const bg = await nopBaoGia(boB, rfqB);
    await moThau(boB, rfqB, [[bg.versionId, phongBi([[1, "1000"]])]]);
    const mong = { trangThai: "CHUA_CAU_HINH", policyId: csB, policyVersion: 1 };
    expect(await doc(orgB, rfqB, pmB.phien)).toEqual(mong);
    const luot = await trong(orgB, (c) => taoLuotDanhGia(c, orgB, { rfqId: rfqB, actorSessionId: pmB.phien }, api));
    expect(await ketQua(orgB, luot.evaluationId)).toEqual([]);
    expect(await doc(orgB, rfqB, pmB.phien)).toEqual(mong);
    expect(await banLuuCua(rfqB)).toEqual([]);
  });
});

describe("[INV-L6] [INV-L14] ⑹ bản lưu — một bản mỗi lần mở thầu, CSDL buộc phiên bản ghim và cùng giao dịch", { timeout: 180_000 }, () => {
  it("gói X có đúng MỘT bản lưu (lần mở thầu duy nhất) mang chín hàng; đọc lại không ghi thêm", async () => {
    await doc(orgA, rfqX);
    const ban = await banLuuCua(rfqX);
    expect(ban).toHaveLength(1);
    expect(ban[0]).toMatchObject({ unseal_request_id: await lanMoMoiNhat(rfqX), policy_id: chinhSachA1 });
    const n = (await db.pool.query("SELECT 1 FROM price_benchmark_snapshot_lines WHERE snapshot_id = $1", [ban[0]!.id])).rowCount;
    expect(n).toBe(9);
  });

  it("hai lần đọc ĐỒNG THỜI trên gói chưa có bản lưu: lần sau CHỜ ở `ON CONFLICT` rồi đọc bản của lần trước — một bản, hai nguồn", async () => {
    const { rfqId } = await goiMoiDaMo();
    let tha!: () => void;
    const cho = new Promise<void>((r) => { tha = r; });
    let motDaGhi = false;
    // Lần một: đọc (tính, ghi) rồi GIỮ giao dịch mở — bản lưu chưa commit.
    const mot = trong(orgA, async (c) => {
      const kq = await docBenchmark(c, orgA, { rfqId, actorSessionId: pm.phien }, api);
      motDaGhi = true;
      await cho;
      return kq;
    });
    for (let i = 0; i < 400 && !motDaGhi; i += 1) await new Promise((r) => setTimeout(r, 25));
    expect(motDaGhi).toBe(true);
    expect(await banLuuCua(rfqId), "bản của lần một chưa commit").toEqual([]);
    // Lần hai: không thấy bản chưa commit ⇒ TÍNH, rồi `INSERT … ON CONFLICT` chờ giao dịch lần một.
    const hai = doc(orgA, rfqId);
    let choKhoa = false;
    try {
      for (let i = 0; i < 200 && !choKhoa; i += 1) {
        const { rowCount } = await db.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO public.price_benchmark_snapshots%'",
        );
        choKhoa = rowCount! > 0;
        if (!choKhoa) await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      tha();
    }
    expect(choKhoa, "lần hai phải đang chờ ở INSERT của bản lưu").toBe(true);
    const [a, b] = await Promise.all([mot, hai]);
    expect(a).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI" });
    expect(b).toMatchObject({ trangThai: "CO", nguon: "BAN_LUU" });
    expect(a?.trangThai === "CO" && b?.trangThai === "CO" && a.snapshotId === b.snapshotId).toBe(true);
    expect(await banLuuCua(rfqId)).toHaveLength(1);
  });

  const CHEN_BAN =
    "INSERT INTO price_benchmark_snapshots (org_id, rfq_id, unseal_request_id, policy_id, phuong_phap, moc_mo_gia) " +
    "VALUES ($1, $2, $3, $4, 'TRUNG_VI_THEO_GOI_V1', $5::timestamptz)";
  const HOAN_TAC = "HOAN_TAC";
  /** Chạy `viec` trong giao dịch rồi HUỶ — đối chứng dương không để lại hàng. */
  const roiHuy = (viec: (c: pg.PoolClient) => Promise<unknown>) =>
    expect(trong(orgA, async (c) => { await viec(c); throw new Error(HOAN_TAC); })).rejects.toThrow(HOAN_TAC);

  it("CSDL: phiên bản ≠ phiên bản ghim, lần mở thầu của gói khác, bản thứ hai cho cùng lần mở thầu, mốc không trước lúc ghi — bốn lần từ chối có tên; đúng ⇒ vào", async () => {
    const { rfqId } = await goiMoiDaMo();
    const yc = await lanMoMoiNhat(rfqId);
    const ycX = await lanMoMoiNhat(rfqX);
    // Lần mở thầu của một gói KHÁC chưa có bản lưu — `UNIQUE (org_id, unseal_request_id)` không che khoá ngoại cần đo.
    const ycKhac = await lanMoMoiNhat(lichSuThep[0]!.rfqId);
    const moc = "2020-01-01T00:00:00Z";
    await expect(trong(orgA, (c) => c.query(CHEN_BAN, [orgA, rfqId, yc, chinhSachA1, moc]))).rejects.toMatchObject({
      code: "23503",
      constraint: "price_benchmark_snapshots_phien_ban_ghim_fk",
    });
    await expect(trong(orgA, (c) => c.query(CHEN_BAN, [orgA, rfqId, ycKhac, chinhSachA2, moc]))).rejects.toMatchObject({
      code: "23503",
      constraint: "price_benchmark_snapshots_cua_lan_mo_fk",
    });
    await expect(trong(orgA, (c) => c.query(CHEN_BAN, [orgA, rfqX, ycX, chinhSachA1, moc]))).rejects.toMatchObject({
      code: "23505",
      constraint: "price_benchmark_snapshots_mot_lan_mo_key",
    });
    await expect(trong(orgA, (c) => c.query(CHEN_BAN, [orgA, rfqId, yc, chinhSachA2, "2999-01-01T00:00:00Z"]))).rejects.toMatchObject({
      code: "23514",
      constraint: "price_benchmark_snapshots_moc_truoc_ghi",
    });
    await roiHuy((c) => c.query(CHEN_BAN, [orgA, rfqId, yc, chinhSachA2, moc]));
  });

  it("CSDL: hàng của bản lưu ghi ở giao dịch KHÁC ⇒ khoá ngoại `…_cung_ban_luu_fk` từ chối; cùng giao dịch ⇒ vào (đối chứng dương)", async () => {
    const ban = (await banLuuCua(rfqX))[0]!;
    const CHEN_DONG =
      "INSERT INTO price_benchmark_snapshot_lines (org_id, snapshot_id, rfq_id, policy_id, bid_version_id, line_no, nhan, ly_do, hoi_to) " +
      "VALUES ($1, $2, $3, $4, $5, 2, 'KHONG_DO_DUOC', 'CHUA_ANH_XA', '{}')";
    // Báo giá của một gói lịch sử ở dòng 1 — không trùng hàng nào của bản lưu, nên `UNIQUE` không che khoá ngoại cần đo.
    const khac = lichSuThep[0]!.bg[0]!.versionId;
    await expect(trong(orgA, (c) => c.query(CHEN_DONG.replace("2, 'KHONG", "1, 'KHONG"), [orgA, ban.id, rfqX, chinhSachA1, khac]))).rejects.toMatchObject({
      code: "23503",
      constraint: "price_benchmark_snapshot_lines_cung_ban_luu_fk",
    });
    const { rfqId, bg } = await goiMoiDaMo();
    const yc = await lanMoMoiNhat(rfqId);
    await roiHuy(async (c) => {
      const id = (
        await c.query<{ id: string }>(`${CHEN_BAN} RETURNING id`, [orgA, rfqId, yc, chinhSachA2, "2020-01-01T00:00:00Z"])
      ).rows[0]!.id;
      await c.query(CHEN_DONG.replace("2, 'KHONG", "1, 'KHONG"), [orgA, id, rfqId, chinhSachA2, bg.versionId]);
    });
  });

  it("`app_api` không UPDATE, không DELETE, không tự đặt `ghi_luc`; phiên khách và tổ chức khác thấy 0 hàng", async () => {
    const ban = (await banLuuCua(rfqX))[0]!;
    for (const cau of [
      "UPDATE price_benchmark_snapshots SET moc_mo_gia = moc_mo_gia WHERE id = $1",
      "DELETE FROM price_benchmark_snapshots WHERE id = $1",
      "UPDATE price_benchmark_snapshot_lines SET nhan = 'BINH_THUONG' WHERE snapshot_id = $1",
      "DELETE FROM price_benchmark_snapshot_lines WHERE snapshot_id = $1",
    ]) {
      await expect(trong(orgA, (c) => c.query(cau, [ban.id])), cau).rejects.toMatchObject({ code: "42501" });
    }
    const { rfqId } = await goiMoiDaMo();
    await expect(
      trong(orgA, async (c) =>
        c.query(
          "INSERT INTO price_benchmark_snapshots (org_id, rfq_id, unseal_request_id, policy_id, phuong_phap, moc_mo_gia, ghi_luc) " +
            "VALUES ($1, $2, $3, $4, 'TRUNG_VI_THEO_GOI_V1', '2020-01-01T00:00:00Z', now())",
          [orgA, rfqId, await lanMoMoiNhat(rfqId), chinhSachA2],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const dem = (org: string, khach: string | null) =>
      trong(org, async (c) => {
        if (khach !== null) await c.query("SELECT set_config('app.guest_session_id', $1, true)", [khach]);
        const a = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM price_benchmark_snapshots");
        const b = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM price_benchmark_snapshot_lines");
        return [a.rows[0]!.n, b.rows[0]!.n];
      });
    const coHang = await dem(orgA, null);
    expect(Number(coHang[0]) > 0 && Number(coHang[1]) > 0, "đối chứng dương").toBe(true);
    expect(await dem(orgA, bgX[0]!.phienKhach)).toEqual(["0", "0"]);
    expect(await dem(orgB, null)).toEqual(["0", "0"]);
  });
});

describe("[INV-L6] [INV-L7] ⑺ Xem dải và vòng chào lại", { timeout: 300_000 }, () => {
  const dai = (rfqId: string, lineNo: number, phien = pm.phien) =>
    trong(orgA, (c) => docDaiBenchmark(c, orgA, { rfqId, lineNo, actorSessionId: phien }, api));

  it("dòng thép của X: Q1/trung vị/Q3 đúng dữ liệu thiết kế, số đếm trùng bản lưu, giá quy đổi của ba báo giá theo kg", async () => {
    const kq = await dai(rfqX, 1);
    expect(kq).toMatchObject({ trangThai: "CO", lineNo: 1, donViGoc: "kg" });
    if (kq?.trangThai !== "CO") return;
    // Trung vị các gói {110, 105, 100}: Q1 = 100 + 0,5·5, trung vị 105, Q3 = 105 + 0,5·5 (nội suy tuyến tính).
    expect(kq.dai).toHaveLength(1);
    expect(kq.dai[0]).toMatchObject({
      canonicalItemId: hangThep, tienTe: "VND", duSan: true, q1: "102.5", trungVi: "105", q3: "107.5",
      soQuanSat: 5, soGoi: 3, soNcc: 5, soGoiCungNguoiTao: 1, soQuanSatHoiTo: 2, soLoaiGia0: 1, khopBanLuu: true,
    });
    const gia = new Map(kq.giaCuaGoi.map((g) => [g.bidVersionId, Number(g.donGiaQuyDoi)]));
    expect([gia.get(bgX[0]!.versionId), gia.get(bgX[1]!.versionId), gia.get(bgX[2]!.versionId)]).toEqual([105, 130, 96]);
  });

  it("dòng cát dưới sàn: không con số nào; dòng chưa ánh xạ: `KHONG_CO_DAI`; dòng không có trên gói: `KHONG_CO_DAI`", async () => {
    const cat = await dai(rfqX, 3);
    expect(cat?.trangThai === "CO" && cat.dai.map((d) => [d.duSan, d.q1, d.trungVi, d.q3, d.soGoi])).toEqual([[false, null, null, null, 2]]);
    expect(await dai(rfqX, 2)).toEqual({ trangThai: "KHONG_CO_DAI", lineNo: 2 });
    expect(await dai(rfqX, 99)).toEqual({ trangThai: "KHONG_CO_DAI", lineNo: 99 });
  });

  it("`SAU_MOC` đếm tới LÚC ĐỌC: ánh xạ lại một gói của dải SAU mốc ⇒ số đếm tăng đúng 1, dải và nhãn không đổi (đối chứng dương)", async () => {
    const truoc = await dai(rfqX, 1);
    await anhXa(orgA, lichSuThep[1]!.rfqId, 1, hangThep, "anh xa lai sau moc cua X de do SAU_MOC");
    const sau = await dai(rfqX, 1);
    if (truoc?.trangThai !== "CO" || sau?.trangThai !== "CO") throw new Error("thiếu dải");
    expect((sau.dai[0]!.sauMoc["ANH_XA"] ?? 0) - (truoc.dai[0]!.sauMoc["ANH_XA"] ?? 0)).toBe(1);
    expect([sau.dai[0]!.q1, sau.dai[0]!.trungVi, sau.dai[0]!.q3, sau.dai[0]!.khopBanLuu]).toEqual(["102.5", "105", "107.5", true]);
  });

  it("số đếm của bản lưu bị sửa NGOÀI luật chỉ-ghi-thêm (vai chủ cụm) ⇒ `khopBanLuu: false` — màn nói ra, không giấu", async () => {
    const { rfqId } = await goiMoiDaMo();
    await anhXa(orgA, rfqId, 1, hangThep, "anh xa sau khi mo de do khop ban luu");
    await doc(orgA, rfqId);
    const truoc = await dai(rfqId, 1);
    expect(truoc?.trangThai === "CO" && truoc.dai.every((d) => d.khopBanLuu)).toBe(true);
    await db.pool.query(
      "UPDATE price_benchmark_snapshot_lines SET so_quan_sat = so_quan_sat + 1 WHERE rfq_id = $1 AND line_no = 1",
      [rfqId],
    );
    const sau = await dai(rfqId, 1);
    expect(sau?.trangThai === "CO" && sau.dai.map((d) => d.khopBanLuu)).toEqual([false]);
  });

  it("cổng `bid.view` có hàng sổ từ chối; mỗi lần bấm một hàng `BENCHMARK_BAND_READ` không mang giá", async () => {
    await expect(dai(rfqX, 1, kyThuat.phien)).rejects.toBeInstanceOf(PermissionDeniedError);
    const truoc = (await db.pool.query("SELECT 1 FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_BAND_READ'", [orgA])).rowCount!;
    await dai(rfqX, 1);
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_BAND_READ' ORDER BY seq DESC",
      [orgA],
    );
    expect(rows).toHaveLength(truoc + 1);
    expect(Object.keys(rows[0]!.payload).sort()).toEqual([
      "lineNo", "rfqId", "snapshotId", "soDai", "soDaiNgoai", "soMocNgoai", "trangThai", "viewedBySessionId",
    ]);
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/102\.5|107\.5/u);
  });

  it("vòng chào lại: `BAFO_OPEN`, `BAFO_CLOSED` ⇒ không nhãn, không dải, không bản lưu mới; `BAFO_UNSEALED` ⇒ bản lưu MỚI cho lần mở thầu của vòng ấy, mang bản BAFO của người nộp lại", async () => {
    const rfqId = await taoGoi(boA2, [["Thep", "10", "kg"]]);
    await anhXa(orgA, rfqId, 1, hangThep);
    const bg = [await nopBaoGia(boA2, rfqId), await nopBaoGia(boA2, rfqId)];
    await moThau(boA2, rfqId, [
      [bg[0]!.versionId, phongBi([[1, "1000"]])],
      [bg[1]!.versionId, phongBi([[1, "1100"]])],
    ]);
    const vongMot = await doc(orgA, rfqId);
    expect(vongMot).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI", bafoRoundId: null });
    const luot = await trong(orgA, async (c) => {
      const id = await luotTho(c, rfqId, bg[0]!.versionId);
      await c.query(
        "INSERT INTO rfq_evaluation_lines (org_id, evaluation_id, bid_version_id, effective_cost, components, rank) " +
          "VALUES ($1, $2, $3, '1100.00', '[{\"ma\":\"gia\",\"tien\":\"1100.00\"}]', 2)",
        [orgA, id, bg[1]!.versionId],
      );
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
      return id;
    });
    const vong = await trong(orgA, async (c) => {
      const id = (
        await c.query<{ id: string }>(
          "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id) " +
            "VALUES ($1, $2, $3, $4, 3, $5, $6, $7) RETURNING id",
          [orgA, rfqId, luot, chinhSachA2, MAI_SAU, pm.nguoi, pm.phien],
        )
      ).rows[0]!.id;
      await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfqId]);
      return id;
    });
    expect(await doc(orgA, rfqId)).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
    expect(await dai(rfqId, 1)).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
    // Người thứ hai nộp lại, hạ giá.
    const lai = await trong(orgA, async (c) => {
      const v = (
        await c.query<{ id: string; version: number }>(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id, version",
          [orgA, bg[1]!.bidId, Buffer.alloc(64, 9), bg[1]!.phienKhach],
        )
      ).rows[0]!;
      await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
        orgA,
        v.id,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bg[1]!.bidId}\n` +
          `version=${String(v.version)}\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-30T00:00:00.000000Z\n`,
        Buffer.alloc(70, 7),
      ]);
      return v.id;
    });
    await trong(orgA, async (c) => {
      await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vong]);
      await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfqId]);
    });
    expect(await doc(orgA, rfqId)).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_CLOSED" });
    expect(await banLuuCua(rfqId), "không bản lưu mới ở vòng chào lại").toHaveLength(1);

    const ycBafo = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'mo vong bafo', $3, $4) RETURNING id",
        [orgA, rfqId, pm2.nguoi, pm2.phien],
      )
    ).rows[0]!.id;
    await db.pool.query("INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [
      orgA,
      ycBafo,
      duyet.nguoi,
      duyet.phien,
    ]);
    await db.pool.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [ycBafo]);
    // [rà soát S4.5c1] Giao dịch đọc BẮT ĐẦU trước lần mở vòng BAFO, câu đọc chạy SAU khi nó commit: `now()` của người đọc sớm hơn
    // `unsealed_at` của bản BAFO, nên tính bây giờ thì bản ấy vô hình và bản lưu ghi-một-lần mang `KHONG_DO_DUOC` mãi mãi. Phải `THU_LAI`.
    const thuLai = await trong(orgA, async (rc) => {
      await rc.query("SELECT pg_catalog.now()");
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
          orgA,
          ycBafo,
          lai,
          JSON.stringify(phongBi([[1, "900"]])),
        ]);
        await c.query("UPDATE rfq_packages SET status = 'BAFO_UNSEALED' WHERE id = $1", [rfqId]);
        await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [ycBafo]);
        await c.query("COMMIT");
      } finally {
        c.release();
      }
      return docBenchmark(rc, orgA, { rfqId, actorSessionId: pm.phien }, api);
    });
    expect(thuLai).toEqual({ trangThai: "THU_LAI", rfqStatus: "BAFO_UNSEALED" });
    expect(await banLuuCua(rfqId), "THU_LAI không ghi gì").toHaveLength(1);
    const vongHai = await doc(orgA, rfqId);
    expect(vongHai).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI", unsealRequestId: ycBafo, bafoRoundId: vong });
    if (vongHai?.trangThai !== "CO" || vongMot?.trangThai !== "CO") throw new Error("thiếu bản lưu");
    expect(vongHai.snapshotId).not.toBe(vongMot.snapshotId);
    expect(vongHai.dong.map((d) => d.bidVersionId).sort(), "bản BAFO của người nộp lại, bản vòng một của người không").toEqual(
      [bg[0]!.versionId, lai].sort(),
    );
    expect(
      vongHai.dong.find((d) => d.bidVersionId === lai)?.nhan,
      "bản BAFO được ĐO — không phải `KHONG_DO_DUOC` của một lần đọc không thấy nó",
    ).toMatch(/^(BINH_THUONG|LECH_VUA|LECH_CAO)$/u);
    expect(await banLuuCua(rfqId)).toHaveLength(2);
    expect(await dai(rfqId, 1)).toMatchObject({ trangThai: "CO", snapshotId: vongHai.snapshotId });
  });
});

// ---- [rà soát S4.5c1] cuộc đua với lần mở thầu và cạnh trạng thái; trạng thái chưa đo; nhãn trong phép so bản lưu ----------------
describe("[INV-L6] [INV-L7] ⑻ rà soát S4.5c1 — cuộc đua, khoá hàng gói, các trạng thái không con số, so nhãn", { timeout: 300_000 }, () => {
  const dai = (rfqId: string, lineNo: number) =>
    trong(orgA, (c) => docDaiBenchmark(c, orgA, { rfqId, lineNo, actorSessionId: pm.phien }, api));

  /** Chờ tới khi một phiên khác đang CHỜ KHOÁ ở câu `FOR SHARE` của `kiemLaiDuoiKhoa`. */
  async function choKhoaHangGoi(): Promise<boolean> {
    for (let i = 0; i < 200; i += 1) {
      const { rowCount } = await db.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM public.rfq_packages p WHERE%FOR SHARE%'",
      );
      if (rowCount! > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  /** Giữ MỘT giao dịch đang mở vòng chào lại (`EVALUATING → BAFO_OPEN`) — hàng gói bị khoá, chưa commit — tới khi `tha()`. */
  async function giuMoVongBafo(rfqId: string, bidVersionId: string): Promise<{ readonly tha: () => Promise<void> }> {
    const luot = await trong(orgA, async (c) => {
      const id = await luotTho(c, rfqId, bidVersionId);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
      return id;
    });
    let thaRa!: () => void;
    const cho = new Promise<void>((r) => { thaRa = r; });
    let daGiu = false;
    const giu = trong(orgA, async (c) => {
      await c.query(
        "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 3, $5, $6, $7)",
        [orgA, rfqId, luot, chinhSachA2, MAI_SAU, pm.nguoi, pm.phien],
      );
      await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfqId]);
      daGiu = true;
      await cho;
    });
    for (let i = 0; i < 400 && !daGiu; i += 1) await new Promise((r) => setTimeout(r, 25));
    expect(daGiu).toBe(true);
    return { tha: async () => { thaRa(); await giu; } };
  }

  it("lần mở thầu commit SAU lúc giao dịch đọc bắt đầu (vòng một) ⇒ `THU_LAI`, không bản lưu, hàng sổ nói `THU_LAI`; đọc lại ⇒ `CO`", async () => {
    const rfqId = await taoGoi(boA2, [["Thep", "10", "kg"]]);
    await anhXa(orgA, rfqId, 1, hangThep);
    const bg = await nopBaoGia(boA2, rfqId);
    const kq = await trong(orgA, async (c) => {
      await c.query("SELECT pg_catalog.now()");
      await moThau(boA2, rfqId, [[bg.versionId, phongBi([[1, "1000"]])]]);
      return docBenchmark(c, orgA, { rfqId, actorSessionId: pm.phien }, api);
    });
    expect(kq).toEqual({ trangThai: "THU_LAI", rfqStatus: "UNSEALED" });
    expect(await banLuuCua(rfqId)).toEqual([]);
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_READ' AND resource_id = $2 ORDER BY seq DESC LIMIT 1",
      [orgA, rfqId],
    );
    expect(rows[0]?.payload).toMatchObject({ trangThai: "THU_LAI", snapshotId: null, soDong: 0 });
    const lai = await doc(orgA, rfqId);
    expect(lai).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI" });
    expect(lai?.trangThai === "CO" && lai.dong.map((d) => d.nhan)).toEqual([expect.stringMatching(/^(BINH_THUONG|LECH_VUA|LECH_CAO)$/u)]);
  });

  it("vòng chào lại mở TRONG lúc lần đọc đầu đang tính ⇒ lần đọc CHỜ ở khoá hàng gói rồi trả `VONG_CHAO_LAI_DANG_MO`, không bản lưu nào", async () => {
    const { rfqId, bg } = await goiMoiDaMo();
    const { tha } = await giuMoVongBafo(rfqId, bg.versionId);
    const doc1 = doc(orgA, rfqId);
    // Nhả giao dịch giữ trong `finally`: phép chờ khoá trượt thì giao dịch ấy không được giữ hàng gói tới hết lượt test.
    let cho = false;
    try {
      cho = await choKhoaHangGoi();
    } finally {
      await tha();
    }
    expect(cho, "lần đọc phải đang chờ khoá hàng gói").toBe(true);
    expect(await doc1).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
    expect(await banLuuCua(rfqId)).toEqual([]);
  });

  // ~~"vòng chào lại mở TRONG lúc Xem dải đang tính ⇒ Xem dải CHỜ ở khoá hàng gói"~~ — [S1.274 / khoản 342] chỉ đường GHI giữ khoá hàng
  // gói; lượt đọc bản lưu và *Xem dải* hỏi lại không khoá. Ca ấy nay đo bằng ma trận hỏi lại và ba ca NOWAIT dưới.

  /** Một cạnh chiếm hàng gói NGAY (`FOR NO KEY UPDATE NOWAIT`, câu khoá của mọi cạnh trạng thái) — `BI_GIU` khi có ai đang giữ nó. */
  async function canhKhoaNgay(rfqId: string): Promise<"CHIEM_DUOC" | "BI_GIU"> {
    const k = await db.pool.connect();
    try {
      await k.query("BEGIN");
      await k.query("SELECT id FROM rfq_packages WHERE id = $1 FOR NO KEY UPDATE NOWAIT", [rfqId]);
      return "CHIEM_DUOC";
    } catch (e) {
      if ((e as { code?: string }).code === "55P03") return "BI_GIU";
      throw e;
    } finally {
      await k.query("ROLLBACK");
      k.release();
    }
  }

  /** Gói đã mở, có ánh xạ dòng 1, đã có bản lưu (lần đọc đầu ở `UNSEALED`), rồi sang `EVALUATING` bằng một lượt chấm thô. */
  async function goiCoBanLuuDangCham(): Promise<{ readonly rfqId: string; readonly bg: BaoGia; readonly luot: string }> {
    const { rfqId, bg } = await goiMoiDaMo();
    await anhXa(orgA, rfqId, 1, hangThep, "anh xa sau khi mo de do hoi lai khong khoa");
    expect(await doc(orgA, rfqId)).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI" });
    const luot = await trong(orgA, async (c) => {
      const id = await luotTho(c, rfqId, bg.versionId);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
      return id;
    });
    return { rfqId, bg, luot };
  }

  /** `EVALUATING → BAFO_OPEN`, commit. */
  async function moVongBafoNgay(rfqId: string, luot: string): Promise<void> {
    await trong(orgA, async (c) => {
      await c.query(
        "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id) " +
          "VALUES ($1, $2, $3, $4, 3, $5, $6, $7)",
        [orgA, rfqId, luot, chinhSachA2, MAI_SAU, pm.nguoi, pm.phien],
      );
      await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfqId]);
    });
  }

  /**
   * Chặn lượt đọc GIỮA câu bối cảnh và câu hỏi lại: khoá `price_benchmark_snapshots` (câu đọc bản lưu đầu tiên của cả hai hàm đọc, ngay
   * sau câu bối cảnh), chạy `doc1`, chờ thấy nó chờ ở bảng ấy, chạy `giua` (commit cạnh), rồi nhả.
   */
  async function chanGiuaBoiCanhVaHoiLai<T>(doc1: () => Promise<T>, giua: () => Promise<unknown>): Promise<T> {
    const chan = await db.pool.connect();
    let p: Promise<T> | undefined;
    try {
      await chan.query("BEGIN");
      await chan.query("LOCK TABLE price_benchmark_snapshots IN ACCESS EXCLUSIVE MODE");
      p = doc1();
      let cho = false;
      for (let i = 0; i < 400 && !cho; i += 1) {
        const { rowCount } = await db.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM public.price_benchmark_snapshots s%'",
        );
        cho = rowCount! > 0;
        if (!cho) await new Promise((r) => setTimeout(r, 50));
      }
      expect(cho, "lượt đọc phải đang chờ ở bản lưu, SAU câu bối cảnh").toBe(true);
      await giua();
    } finally {
      await chan.query("COMMIT");
      chan.release();
    }
    return p;
  }

  const HAI_CHO_GOI: readonly (readonly [string, (rfqId: string) => Promise<unknown>])[] = [
    ["đọc bản lưu", (rfqId) => doc(orgA, rfqId)],
    ["Xem dải", (rfqId) => dai(rfqId, 1)],
  ];

  // [S1.274] Ma trận hỏi lại của đường ĐỌC: hai chỗ gọi × hai vế (trạng thái, lần mở thầu), mỗi ô một ca — để đột biến từng vế ở từng chỗ
  // gọi đều có một ca đỏ (lượt soi hình dạng: hai ca chéo để sống hai đột biến).
  it.each(HAI_CHO_GOI)("%s: vòng chào lại MỞ (commit) giữa câu bối cảnh và câu hỏi lại ⇒ `VONG_CHAO_LAI_DANG_MO`, không nhãn, không số", async (_ten, doc1) => {
    const { rfqId, luot } = await goiCoBanLuuDangCham();
    const kq = await chanGiuaBoiCanhVaHoiLai(() => doc1(rfqId), () => moVongBafoNgay(rfqId, luot));
    expect(kq).toEqual({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
  });

  it.each(HAI_CHO_GOI)("%s: một vòng chào lại TRỌN VẸN commit giữa câu bối cảnh và câu hỏi lại — trạng thái lại hiện, lần mở thầu đã khác ⇒ `THU_LAI`", async (_ten, doc1) => {
    const { rfqId, bg, luot } = await goiCoBanLuuDangCham();
    const kq = await chanGiuaBoiCanhVaHoiLai(() => doc1(rfqId), () => vongBafoTronVen(rfqId, luot, bg));
    expect(kq).toEqual({ trangThai: "THU_LAI", rfqStatus: "BAFO_UNSEALED" });
  });

  // [S1.274] Ba ca NOWAIT: giao dịch của lượt đọc còn MỞ (sau khi đã khẳng định `CO` — các nhánh không số không bao giờ tới câu hỏi lại),
  // và một cạnh thử khoá hàng gói ngay. Trên mã trước S1.274 hai ca đầu là `BI_GIU` (55P03).
  it("đọc bản lưu (`CO`, `BAN_LUU`) không giữ khoá hàng gói: giao dịch đọc còn mở mà một cạnh khoá được hàng gói ngay", async () => {
    const { rfqId } = await goiMoiDaMo();
    expect(await doc(orgA, rfqId)).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI" });
    const thu = await trong(orgA, async (c) => {
      const k = await docBenchmark(c, orgA, { rfqId, actorSessionId: pm.phien }, api);
      expect(k).toMatchObject({ trangThai: "CO", nguon: "BAN_LUU" });
      return canhKhoaNgay(rfqId);
    });
    expect(thu).toBe("CHIEM_DUOC");
  });

  it("Xem dải (`CO`) không giữ khoá hàng gói: giao dịch đọc còn mở mà một cạnh khoá được hàng gói ngay", async () => {
    const { rfqId } = await goiMoiDaMo();
    await anhXa(orgA, rfqId, 1, hangThep, "anh xa sau khi mo de do xem dai khong khoa");
    expect(await doc(orgA, rfqId)).toMatchObject({ trangThai: "CO" });
    const thu = await trong(orgA, async (c) => {
      const k = await docDaiBenchmark(c, orgA, { rfqId, lineNo: 1, actorSessionId: pm.phien }, api);
      expect(k).toMatchObject({ trangThai: "CO" });
      return canhKhoaNgay(rfqId);
    });
    expect(thu).toBe("CHIEM_DUOC");
  });

  it("lần đọc ĐẦU vẫn giữ khoá hàng gói tới commit: bản lưu vừa ghi, giao dịch còn mở thì một cạnh KHÔNG khoá được ngay", async () => {
    const { rfqId } = await goiMoiDaMo();
    const thu = await trong(orgA, async (c) => {
      const k = await docBenchmark(c, orgA, { rfqId, actorSessionId: pm.phien }, api);
      expect(k).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI" });
      return canhKhoaNgay(rfqId);
    });
    expect(thu).toBe("BI_GIU");
  });

  /** Một vòng chào lại TRỌN VẸN, từng cạnh một giao dịch như đường thật: mở vòng, người nộp lại, đóng vòng, xin–duyệt–mở niêm phong. */
  async function vongBafoTronVen(rfqId: string, luot: string, bg: BaoGia): Promise<string> {
    const { yc, lai } = await vongBafoDenDuyet(rfqId, luot, bg);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await moNiemPhongVongBafo(c, rfqId, yc, lai);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    return yc;
  }

  /** Câu của lần mở niêm phong vòng chào lại — trong giao dịch của `c`, không commit. */
  async function moNiemPhongVongBafo(c: pg.PoolClient, rfqId: string, yc: string, lai: string): Promise<void> {
    await c.query("INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, $4)", [
      orgA,
      yc,
      lai,
      JSON.stringify(phongBi([[1, "900"]])),
    ]);
    await c.query("UPDATE rfq_packages SET status = 'BAFO_UNSEALED' WHERE id = $1", [rfqId]);
    await c.query("UPDATE unseal_requests SET status = 'EXECUTED', executed_at = now() WHERE id = $1", [yc]);
  }

  /** Vòng chào lại tới lúc yêu cầu mở niêm phong đã duyệt: mở vòng, người nộp lại, đóng vòng, xin–duyệt; mỗi cạnh một giao dịch. */
  async function vongBafoDenDuyet(rfqId: string, luot: string, bg: BaoGia): Promise<{ readonly yc: string; readonly lai: string }> {
    const vong = await trong(orgA, async (c) => {
      const id = (
        await c.query<{ id: string }>(
          "INSERT INTO rfq_bafo_rounds (org_id, rfq_id, evaluation_id, policy_id, top_n, deadline_at, opened_by, opened_by_session_id) " +
            "VALUES ($1, $2, $3, $4, 3, $5, $6, $7) RETURNING id",
          [orgA, rfqId, luot, chinhSachA2, MAI_SAU, pm.nguoi, pm.phien],
        )
      ).rows[0]!.id;
      await c.query("UPDATE rfq_packages SET status = 'BAFO_OPEN' WHERE id = $1", [rfqId]);
      return id;
    });
    const lai = await trong(orgA, async (c) => {
      const v = (
        await c.query<{ id: string; version: number }>(
          "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id, version",
          [orgA, bg.bidId, Buffer.alloc(64, 9), bg.phienKhach],
        )
      ).rows[0]!;
      await c.query("INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)", [
        orgA,
        v.id,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bg.bidId}\n` +
          `version=${String(v.version)}\nciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-30T00:00:00.000000Z\n`,
        Buffer.alloc(70, 7),
      ]);
      return v.id;
    });
    await trong(orgA, async (c) => {
      await c.query("UPDATE rfq_bafo_rounds SET closed_at = now() WHERE id = $1", [vong]);
      await c.query("UPDATE rfq_packages SET status = 'BAFO_CLOSED' WHERE id = $1", [rfqId]);
    });
    const yc = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'mo vong bafo', $3, $4) RETURNING id",
        [orgA, rfqId, pm2.nguoi, pm2.phien],
      )
    ).rows[0]!.id;
    await db.pool.query("INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)", [
      orgA,
      yc,
      duyet.nguoi,
      duyet.phien,
    ]);
    await db.pool.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yc]);
    return { yc, lai };
  }

  it("một vòng chào lại TRỌN VẸN commit trong lúc lần đọc đầu đang tính — trạng thái lại hiện, lần mở thầu đã khác ⇒ `THU_LAI`, không bản lưu", async () => {
    const rfqId = await taoGoi(boA2, [["Thep", "10", "kg"]]);
    await anhXa(orgA, rfqId, 1, hangThep);
    const bg = await nopBaoGia(boA2, rfqId);
    await moThau(boA2, rfqId, [[bg.versionId, phongBi([[1, "1000"]])]]);
    const luot = await trong(orgA, async (c) => {
      const id = await luotTho(c, rfqId, bg.versionId);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
      return id;
    });
    // Chặn lần đọc GIỮA câu bối cảnh (thấy `EVALUATING`, lần mở thầu vòng một) và khoá hàng gói: `tinhBenchmarkGoi` đọc bảng ánh xạ
    // ngay sau mốc, nên khoá bảng ấy giữ lần đọc lại ở đúng chỗ ấy trong khi cả vòng chào lại commit.
    const chan = await db.pool.connect();
    let doc1: Promise<BenchmarkCuaGoi | null> | undefined;
    let ycMoi = "";
    try {
      await chan.query("BEGIN");
      await chan.query("LOCK TABLE rfq_item_mappings IN ACCESS EXCLUSIVE MODE");
      doc1 = doc(orgA, rfqId);
      let cho = false;
      for (let i = 0; i < 400 && !cho; i += 1) {
        const { rowCount } = await db.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM public.rfq_item_mappings m%'",
        );
        cho = rowCount! > 0;
        if (!cho) await new Promise((r) => setTimeout(r, 50));
      }
      expect(cho, "lần đọc phải đang chờ ở bảng ánh xạ, SAU câu bối cảnh").toBe(true);
      ycMoi = await vongBafoTronVen(rfqId, luot, bg);
    } finally {
      await chan.query("COMMIT");
      chan.release();
    }
    expect(await doc1).toEqual({ trangThai: "THU_LAI", rfqStatus: "BAFO_UNSEALED" });
    expect(await banLuuCua(rfqId), "không bản lưu nào cho lần mở thầu vòng một mà gói đã rời").toEqual([]);
    expect(await doc(orgA, rfqId)).toMatchObject({ trangThai: "CO", unsealRequestId: ycMoi });
  });

  // [S1.274 / lượt soi hình dạng khoản 342] Lý do *"hai câu, không một"* của `kiemLaiDuoiKhoa`, đo: lần mở niêm phong vòng chào lại ĐANG giữ
  // hàng gói lúc lần đọc đầu tới `FOR SHARE`. Câu chờ khoá thấy phiên bản MỚI của hàng gói (`BAFO_UNSEALED`, trạng thái hiện); một truy vấn
  // con trong cùng câu sẽ đọc ảnh chụp lúc câu bắt đầu — lần mở thầu vòng một — và ghi bản lưu cho một lần mở thầu gói đã rời.
  it("lần mở niêm phong vòng chào lại GIỮ hàng gói lúc lần đọc đầu tới khoá ⇒ lần đọc chờ, rồi `THU_LAI` — không bản lưu nào", async () => {
    const rfqId = await taoGoi(boA2, [["Thep", "10", "kg"]]);
    await anhXa(orgA, rfqId, 1, hangThep);
    const bg = await nopBaoGia(boA2, rfqId);
    await moThau(boA2, rfqId, [[bg.versionId, phongBi([[1, "1000"]])]]);
    const luot = await trong(orgA, async (c) => {
      const id = await luotTho(c, rfqId, bg.versionId);
      await c.query("UPDATE rfq_packages SET status = 'EVALUATING' WHERE id = $1", [rfqId]);
      return id;
    });
    const chan = await db.pool.connect();
    const moNiem = await db.pool.connect();
    let doc1: Promise<BenchmarkCuaGoi | null> | undefined;
    let daChan = true;
    let daMo = false;
    try {
      await chan.query("BEGIN");
      await chan.query("LOCK TABLE rfq_item_mappings IN ACCESS EXCLUSIVE MODE");
      doc1 = doc(orgA, rfqId);
      let cho = false;
      for (let i = 0; i < 400 && !cho; i += 1) {
        const { rowCount } = await db.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM public.rfq_item_mappings m%'",
        );
        cho = rowCount! > 0;
        if (!cho) await new Promise((r) => setTimeout(r, 50));
      }
      expect(cho, "lần đọc phải đang chờ ở bảng ánh xạ, SAU câu bối cảnh").toBe(true);
      const { yc, lai } = await vongBafoDenDuyet(rfqId, luot, bg);
      await moNiem.query("BEGIN");
      daMo = true;
      await moNiemPhongVongBafo(moNiem, rfqId, yc, lai);
      await chan.query("COMMIT");
      daChan = false;
      expect(await choKhoaHangGoi(), "lần đọc phải đang chờ khoá hàng gói mà lần mở niêm phong đang giữ").toBe(true);
      await moNiem.query("COMMIT");
      daMo = false;
    } finally {
      if (daChan) await chan.query("COMMIT");
      if (daMo) await moNiem.query("ROLLBACK");
      chan.release();
      moNiem.release();
    }
    expect(await doc1).toEqual({ trangThai: "THU_LAI", rfqStatus: "BAFO_UNSEALED" });
    expect(await banLuuCua(rfqId), "không bản lưu nào cho lần mở thầu vòng một").toEqual([]);
  });

  it("Xem dải: gói `OPEN` ⇒ `KHONG_HIEN`; gói đã mở mà chưa ai đọc benchmark ⇒ `CHUA_CO_BAN_LUU` — không số nào, không ghi gì", async () => {
    const rfqMo = await taoGoi(boA2, [["Thep", "10", "kg"]]);
    expect(await dai(rfqMo, 1)).toEqual({ trangThai: "KHONG_HIEN", rfqStatus: "OPEN" });
    const { rfqId } = await goiMoiDaMo();
    expect(await dai(rfqId, 1)).toEqual({ trangThai: "CHUA_CO_BAN_LUU" });
    expect(await banLuuCua(rfqId)).toEqual([]);
  });

  it("NHÃN của bản lưu bị sửa ngoài luật (số đếm giữ nguyên) ⇒ `khopBanLuu: false` — phép so không chỉ đếm", async () => {
    const { rfqId } = await goiMoiDaMo();
    await anhXa(orgA, rfqId, 1, hangThep, "anh xa sau khi mo de do so nhan");
    const b = await doc(orgA, rfqId);
    const nhan = b?.trangThai === "CO" ? b.dong[0]?.nhan : undefined;
    expect(nhan).toMatch(/^(BINH_THUONG|LECH_VUA|LECH_CAO)$/u);
    expect(await dai(rfqId, 1)).toMatchObject({ trangThai: "CO", dai: [{ khopBanLuu: true }] });
    const [moi, chieu] = nhan === "BINH_THUONG" ? ["LECH_CAO", "TREN"] : ["BINH_THUONG", null];
    await db.pool.query("UPDATE price_benchmark_snapshot_lines SET nhan = $2, chieu = $3 WHERE rfq_id = $1 AND line_no = 1", [rfqId, moi, chieu]);
    expect(await dai(rfqId, 1)).toMatchObject({ trangThai: "CO", dai: [{ khopBanLuu: false }] });
  });
});

// ---- [S1.262 / S4.5c2] lớp dữ liệu nền của bộ bằng chứng — xuất trên dữ liệu thiết kế, kiểm bằng CLI THẬT khi đã ngắt CSDL ----------
const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const CLI_DANG_KY = pathToFileURL(join(GOC_KHO, "tools", "bo-xuat-danh-gia", "register-ts-resolve.mjs")).href;
const CLI_BO = join(GOC_KHO, "tools", "bo-xuat-danh-gia", "src", "index.ts");

/** `pnpm bang-chung kiem` như một tiến trình THẬT, `DATABASE_URL` xoá khỏi môi trường — ADR-059 §*Đo bằng gì* ⒜. */
function kiemNgoaiTuyen(thuMuc: string): { ma: number; ra: string } {
  const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
  delete env["DATABASE_URL"];
  const kq = spawnSync(execPath, ["--experimental-transform-types", "--import", CLI_DANG_KY, CLI_BO, "kiem", "--bo", thuMuc], {
    env,
    encoding: "utf8",
    cwd: GOC_KHO,
  });
  return { ma: kq.status ?? -1, ra: `${kq.stdout ?? ""}${kq.stderr ?? ""}` };
}

/** Đổi mọi mã băm 32 hex thành số thứ tự lần gặp đầu — hai lần xuất với hai muối phải bằng nhau sau phép này. */
const doiTenBam = (vanBan: string): string => {
  const thu = new Map<string, string>();
  return vanBan.replace(/"[0-9a-f]{32}"/gu, (m) => {
    if (!thu.has(m)) thu.set(m, `"#${String(thu.size)}"`);
    return thu.get(m)!;
  });
};
const boXuatLuc = (v: string): string => v.replace(/"xuatLuc": \{[^}]*\}/u, '"xuatLuc": {}');

describe("[INV-L7] [INV-L6] ⑼ bộ bằng chứng — lớp dữ liệu nền, tính lại ngoại tuyến", { timeout: 300_000 }, () => {
  let thuMuc = "";
  let json = "";
  let bo: {
    duLieuNen: {
      goiX: string;
      hangMuc: unknown[];
      bangQuanSat: { mocMoGia: string; hangChuan: string; tuNgay: string; quanSat: { goi: string; ncc: string; gia: string }[] }[];
      luotCham: {
        evaluationId: string;
        mocMoGia: string;
        dong: {
          bidVersionId: string;
          lineNo: number;
          nhan: string;
          lyDo: string | null;
          hoiTo: string[];
          giaDong: unknown;
          anhXa: { tacGia: { userId: string; hoTen: string | null }; ghiLuc: string; lyDo: string | null } | null;
        }[];
        dauVao: { hangChuan: string; quanSat: string[] }[];
        dauVaoThieu: number;
      }[];
    } | null;
  };
  const muoi = randomBytes(32);

  beforeAll(async () => {
    const xuat = await trong(orgA, (c) => dungBoBangChung(c, orgA, rfqX, new Date(), muoi));
    if (xuat === null) throw new Error("gói X đã chấm mà không xuất được");
    json = xuat.tep[TEP_DU_LIEU];
    bo = JSON.parse(json) as typeof bo;
    thuMuc = await mkdtemp(join(tmpdir(), "tp-bc-dln-"));
    for (const [ten, noiDung] of Object.entries(xuat.tep)) await writeFile(join(thuMuc, ten), Buffer.from(noiDung, "utf8"));
  });

  afterAll(async () => {
    if (thuMuc !== "") await rm(thuMuc, { recursive: true, force: true });
  });

  it("lớp mang chín hàng của lượt chấm của X, đúng nhãn đã ghi; dòng chưa ánh xạ không giá, không người ánh xạ", () => {
    const luot = bo.duLieuNen?.luotCham.find((l) => l.evaluationId === evaluationId);
    expect(luot?.dong).toHaveLength(9);
    expect(luot?.dauVaoThieu).toBe(0);
    const nhanCua = (bv: number, line: number) => luot?.dong.find((d) => d.bidVersionId === bgX[bv]!.versionId && d.lineNo === line);
    expect([nhanCua(0, 1)?.nhan, nhanCua(1, 1)?.nhan, nhanCua(2, 1)?.nhan]).toEqual(["BINH_THUONG", "LECH_CAO", "LECH_VUA"]);
    expect(nhanCua(0, 2)).toMatchObject({ nhan: "KHONG_DO_DUOC", lyDo: "CHUA_ANH_XA", giaDong: null, anhXa: null });
    expect(nhanCua(0, 3)?.nhan).toBe("CHUA_DU_LICH_SU");
    expect(bo.duLieuNen?.hangMuc).toHaveLength(3);
  });

  it("*dòng ấy do ai ánh xạ, lúc nào, trước hay sau khi giá lộ*: thép ánh xạ TRƯỚC mốc, cát SAU mốc (hồi tố), người ghi có tên", () => {
    const luot = bo.duLieuNen!.luotCham.find((l) => l.evaluationId === evaluationId)!;
    const thep = luot.dong.find((d) => d.lineNo === 1)!;
    const cat = luot.dong.find((d) => d.lineNo === 3 && d.bidVersionId === bgX[0]!.versionId)!;
    expect(thep.anhXa?.tacGia).toEqual({ userId: ql.nguoi, hoTen: "Nguoi" });
    expect(thep.anhXa!.ghiLuc < luot.mocMoGia).toBe(true);
    expect(cat.anhXa!.ghiLuc >= luot.mocMoGia).toBe(true);
    expect(cat.anhXa?.lyDo).toBe("anh xa sau khi mo de do hoi to cua chinh dong");
    expect(cat.hoiTo).toContain("ANH_XA");
  });

  it("[INV-L6] bảng quan sát: sáu quan sát thép (gói 26 tháng trước nằm ngoài biên dưới), hai cát; KHÔNG định danh thô nào của gói khác", () => {
    const bang = bo.duLieuNen!.bangQuanSat;
    expect(bang.find((b) => b.hangChuan === hangThep)?.quanSat).toHaveLength(6);
    expect(bang.find((b) => b.hangChuan === hangCat)?.quanSat).toHaveLength(2);
    const tho = [...lichSuThep, ...lichSuCat].flatMap((g) => [g.rfqId, ...g.bg.flatMap((b) => [b.versionId, b.supplierId, b.bidId])]);
    expect(tho.length).toBeGreaterThan(10);
    for (const id of tho) expect(json, `định danh thô ${id} lọt vào bộ bằng chứng`).not.toContain(id);
    // Hai quan sát của H1 (cùng gói, hai nhà cung cấp) cùng mã gói, khác mã nhà cung cấp; mã là 32 hex.
    const thep = bang.find((b) => b.hangChuan === hangThep)!.quanSat;
    const h1 = thep.filter((q) => q.gia.startsWith("100.") || q.gia.startsWith("120."));
    expect(h1).toHaveLength(2);
    expect(h1[0]!.goi).toBe(h1[1]!.goi);
    expect(h1[0]!.ncc).not.toBe(h1[1]!.ncc);
    expect(h1[0]!.goi).toMatch(/^[0-9a-f]{32}$/u);
    expect(new Set(thep.map((q) => q.goi)).size).toBe(4);
  });

  it("[rà soát S4.5c2] §8.2 `ngay` là NGÀY UTC trừ trên ngày biên; quan sát xếp theo NỘI DUNG; lớp chấm thầu mang cờ `coBenchmark`", () => {
    const ban = JSON.parse(json) as {
      luotCham: { evaluationId: string; coBenchmark: boolean }[];
      duLieuNen: {
        bangQuanSat: { mocMoGia: string; tuNgay: string; quanSat: { ngay: string; gia: string }[] }[];
        luotCham: { mocMoGia: string; dong: { cuaSoTu: string | null }[] }[];
      };
    };
    expect(ban.luotCham.find((l) => l.evaluationId === evaluationId)?.coBenchmark).toBe(true);
    let tron = 0;
    for (const b of ban.duLieuNen.bangQuanSat) {
      const bien = new Set([b.mocMoGia, b.tuNgay].map((t) => t.slice(0, 10)));
      for (const l of ban.duLieuNen.luotCham.filter((x) => x.mocMoGia === b.mocMoGia)) {
        for (const d of l.dong) if (d.cuaSoTu !== null) bien.add(d.cuaSoTu.slice(0, 10));
      }
      for (const q of b.quanSat) {
        if (q.ngay.length === 10) {
          tron += 1;
          expect(bien.has(q.ngay), `ngày trơn ${q.ngay} trên một ngày biên`).toBe(false);
        } else {
          expect(q.ngay).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
          expect(bien.has(q.ngay.slice(0, 10)), `mốc đủ micro giây ${q.ngay} ngoài mọi ngày biên`).toBe(true);
        }
      }
      // Thứ tự theo nội dung: (ngày, đơn giá) không giảm — định danh thô không quyết định vị trí nào ngoài phép phá hoà.
      for (let i = 1; i < b.quanSat.length; i += 1) {
        const [t, s] = [b.quanSat[i - 1]!, b.quanSat[i]!];
        expect(t.ngay < s.ngay || (t.ngay === s.ngay && Number(t.gia) <= Number(s.gia)), `${t.ngay}/${t.gia} trước ${s.ngay}/${s.gia}`).toBe(true);
      }
    }
    expect(tron).toBeGreaterThan(0);
    // H4 nằm trên ngày của biên cửa sổ — không phải ngày của mốc — nên đủ micro giây ở đó chỉ đến từ biên cửa sổ trong tập ngày biên.
    const thep = ban.duLieuNen.bangQuanSat.find((b) => b.quanSat.some((q) => Number(q.gia) === 0))!;
    const h4 = thep.quanSat.find((q) => Number(q.gia) === 0)!;
    expect(h4.ngay.length, `H4 mang ${h4.ngay}`).toBeGreaterThan(10);
    expect(h4.ngay.slice(0, 10)).not.toBe(thep.mocMoGia.slice(0, 10));
  });

  it("muối mỗi lần xuất: cùng muối ⇒ cùng byte; muối mới ⇒ khác ở mã băm, BẰNG sau khi đổi tên mã băm", async () => {
    const lai = await trong(orgA, (c) => dungBoBangChung(c, orgA, rfqX, new Date(), muoi));
    expect(boXuatLuc(lai!.tep[TEP_DU_LIEU])).toBe(boXuatLuc(json));
    const moi = await trong(orgA, (c) => dungBoBangChung(c, orgA, rfqX, new Date()));
    expect(boXuatLuc(moi!.tep[TEP_DU_LIEU])).not.toBe(boXuatLuc(json));
    expect(doiTenBam(boXuatLuc(moi!.tep[TEP_DU_LIEU]))).toBe(doiTenBam(boXuatLuc(json)));
    // [rà soát S4.5c2] Muối là tham số công khai của `dungBoBangChung`: một người gọi truyền muối ngắn (hay hằng) thì mã băm dò ngược
    // được bằng vét cạn — ném, không xuất.
    await expect(trong(orgA, (c) => dungBoBangChung(c, orgA, rfqX, new Date(), Buffer.alloc(16)))).rejects.toThrow(/32 byte/u);
  });

  it("[INV-L7] CLI `kiem` khi đã ngắt CSDL: ok=true, chín hàng benchmark ĐẠT", () => {
    const kq = kiemNgoaiTuyen(thuMuc);
    expect(kq.ma, kq.ra).toBe(0);
    expect(kq.ra).toContain("ok=true");
    expect(kq.ra).toMatch(/benchmark\tdong=9\tdat=9\tlech=0/u);
  });

  it("sửa MỘT nhãn đã lưu trong bundle ⇒ CLI đỏ, gọi tên dòng; bớt một đầu vào đã lưu ⇒ đỏ ở lời báo §8.6", async () => {
    const thu = async (sua: (b: typeof bo) => void, mau: RegExp): Promise<void> => {
      const ban = JSON.parse(json) as typeof bo;
      sua(ban);
      const tm = await mkdtemp(join(tmpdir(), "tp-bc-dln-sua-"));
      try {
        await writeFile(join(tm, TEP_DU_LIEU), Buffer.from(`${JSON.stringify(ban, null, 2)}\n`, "utf8"));
        await writeFile(join(tm, TEP_DAC_TA), Buffer.from(await readFile(join(thuMuc, TEP_DAC_TA), "utf8"), "utf8"));
        const kq = kiemNgoaiTuyen(tm);
        expect(kq.ma, kq.ra).toBe(1);
        expect(kq.ra).toMatch(mau);
      } finally {
        await rm(tm, { recursive: true, force: true });
      }
    };
    await thu((b) => {
      const d = b.duLieuNen!.luotCham.find((l) => l.evaluationId === evaluationId)!.dong.find(
        (x) => x.bidVersionId === bgX[0]!.versionId && x.lineNo === 1,
      )!;
      d.nhan = "LECH_CAO";
    }, /LECH-BENCHMARK\t.*`nhan` đã lưu "LECH_CAO", tính lại ra "BINH_THUONG"/u);
    await thu((b) => {
      const dv = b.duLieuNen!.luotCham.find((l) => l.evaluationId === evaluationId)!.dauVao.find((x) => x.hangChuan === hangThep)!;
      dv.quanSat = dv.quanSat.slice(1);
    }, /LOI-BENCHMARK\t.*hai tập khác nhau/u);
  });
});

// ---- [S1.276 / S4.6b] Lịch sử mua ngoài hệ thống và mốc ngoài ở bảng benchmark và *Xem dải* -----------------------------------
// Dữ liệu thiết kế, hàng chuẩn N (gốc kg), không lịch sử nội bộ (dải nội bộ dưới sàn), phiên bản 3 = mẫu (5% / 10%, sàn 3 / 3):
//   Lịch sử ngoài, nhập TRƯỚC khi X mở (ngày = hôm nay giờ Việt Nam − n ngày):
//     (d10, "Công ty Thép Á") 100 kg + (d10, "cong ty thep a") 120000 t ⇒ MỘT gói (cùng nhà cung cấp đã làm sạch), trung vị 110
//     (d20, B) 105 · (d30, C) 98 · (d5, E) 130 — lô của E bị rút SAU khi X mở: vẫn vào dải (L1), đếm RUT
//     (d30, U) 9999 USD ⇒ loại khác tiền tệ · (d40, Bao) 6000 bao, quy đổi riêng 1 bao = 50 kg rút TRƯỚC khi X mở ⇒ không quy đổi được
//     tại mốc · (d400, Cũ) 50 ⇒ ngoài cửa sổ · (d15, D) 1 ⇒ lô bị rút TRƯỚC khi X mở
//   ⇒ 5 dòng, 4 gói {98, 105, 110, 130}, 4 nhà cung cấp: Q1 103.25 · trung vị 107.5 · Q3 115.
//   Nhập SAU khi X mở: (d3, F) 1 ⇒ đếm GHI, không vào dải; quy đổi riêng `bao` khai lại ⇒ dòng `bao` vẫn không quy đổi được TẠI MỐC.
//   Mốc ngoài: d60 100 kg · d7 112000 t (= 112/kg, mới nhất) · hôm nay + 30 ngày 90 (hiệu lực sau mốc ⇒ bỏ) · d7 USD; sau khi X mở: d0 200.
//   X: dòng 1 thép N 10 kg (ánh xạ trước khi mở), dòng 2 không ánh xạ; ba báo giá 1100 · 1500 · 900 ⇒ 110 · 150 · 90 /kg.
//   Nhãn ngoài (5,375 / 10,75 quanh 107,5): BINH_THUONG · LECH_CAO TREN · LECH_CAO DUOI. Độ lệch so với 112: −1,8 · 33,9 · −19,6.
describe("[INV-L15] [INV-L1] ⑽ [S1.276 / S4.6b] lịch sử mua ngoài và mốc ngoài", { timeout: 300_000 }, () => {
  let hangN = "";
  let rfqN = "";
  let bgN: readonly BaoGia[] = [];
  let dau: BenchmarkCuaGoi | null = null;
  let homNay = "";
  let ngayMocChon = "";
  const dai = (rfqId: string, lineNo: number, phien = pm.phien) =>
    trong(orgA, (c) => docDaiBenchmark(c, orgA, { rfqId, lineNo, actorSessionId: phien }, api));
  /** Ngày giờ Việt Nam lệch `n` ngày (âm = tương lai) — cùng lịch với luật *"ngày mua không sau hôm nay"* của `109`. */
  const ngay = async (n: number): Promise<string> =>
    (
      await db.pool.query<{ d: string }>(
        "SELECT ((timezone('UTC', clock_timestamp()) + interval '7 hours')::date - $1::int)::text AS d",
        [n],
      )
    ).rows[0]!.d;
  const nhap = async (loai: "MOC_NGOAI" | "LICH_SU_NGOAI", dong: readonly string[]): Promise<string> => {
    const dauDong =
      loai === "MOC_NGOAI" ? "ma_hang,don_gia,don_vi,tien_te,ngay_hieu_luc,nguon" : "ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon";
    const kq = await trong(orgA, (c) => nhapDuLieuNgoai(c, orgA, { loai, vanBan: [dauDong, ...dong].join("\n"), actorSessionId: ql.phien }));
    if (!kq.nhan) throw new Error(`lô ngoài bị từ chối: ${JSON.stringify(kq.loi)}`);
    return kq.loNhapId;
  };

  beforeAll(async () => {
    await chinhSach(orgA, 3, pm, NHOM_BENCHMARK_MAU);
    hangN = (await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "THEP-NGOAI", ten: "Thép mua ngoài", donViGoc: "kg", actorSessionId: ql.phien }))).id;
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: hangN, tuDonVi: "bao", sangDonVi: "kg", heSo: "50", actorSessionId: ql.phien }));
    homNay = await ngay(0);
    const [d5, d7, d10, d15, d20, d30, d40, d60, d400, tuongLai] = await Promise.all(
      [5, 7, 10, 15, 20, 30, 40, 60, 400, -30].map((n) => ngay(n)),
    );
    ngayMocChon = d7!;
    await nhap("LICH_SU_NGOAI", [
      `THEP-NGOAI,100,kg,VND,${d10!},Công ty Thép Á,Sổ mua 2026`,
      `THEP-NGOAI,120000,t,VND,${d10!},cong ty thep a,Sổ mua 2026`,
      `THEP-NGOAI,105,kg,VND,${d20!},Công ty B,Báo giá điện thoại`,
      `THEP-NGOAI,98,kg,VND,${d30!},Công ty C,Sổ mua 2026`,
      `THEP-NGOAI,9999,kg,USD,${d30!},Công ty U,Sổ mua 2026`,
      `THEP-NGOAI,6000,bao,VND,${d40!},Công ty Bao,Sổ mua 2026`,
      `THEP-NGOAI,50,kg,VND,${d400!},Công ty Cũ,Sổ mua 2025`,
    ]);
    const loRutTruoc = await nhap("LICH_SU_NGOAI", [`THEP-NGOAI,1,kg,VND,${d15!},Công ty D,Gõ nhầm`]);
    await trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "LICH_SU_NGOAI", loNhapId: loRutTruoc, actorSessionId: ql.phien }));
    const loRutSau = await nhap("LICH_SU_NGOAI", [`THEP-NGOAI,130,kg,VND,${d5!},Công ty E,Sổ mua 2026`]);
    await trong(orgA, (c) => rutQuyDoiRieng(c, orgA, { hangChuanId: hangN, tuDonVi: "bao", sangDonVi: "kg", actorSessionId: ql.phien }));
    await nhap("MOC_NGOAI", [
      `THEP-NGOAI,100,kg,VND,${d60!},Bảng giá quý 3`,
      `THEP-NGOAI,112000,t,VND,${d7!},Bảng giá nhà máy tháng 9`,
      `THEP-NGOAI,90,kg,VND,${tuongLai!},Bảng giá quý sau`,
      `THEP-NGOAI,5,kg,USD,${d7!},Bảng giá USD`,
    ]);

    rfqN = await taoGoi(boA2, [
      ["Thep mua ngoai", "10", "kg"],
      ["Hang la", "1", "cai"],
    ]);
    await anhXa(orgA, rfqN, 1, hangN);
    bgN = [await nopBaoGia(boA2, rfqN), await nopBaoGia(boA2, rfqN), await nopBaoGia(boA2, rfqN)];
    await moThau(boA2, rfqN, [
      [bgN[0]!.versionId, phongBi([[1, "1100"], [2, "50"]])],
      [bgN[1]!.versionId, phongBi([[1, "1500"], [2, "50"]])],
      [bgN[2]!.versionId, phongBi([[1, "900"], [2, "50"]])],
    ]);
    // SAU mốc mở giá của X: một dòng lịch sử, một mốc, và lần rút lô của E — dải và mốc của X không đổi (L1), chỉ đếm.
    await nhap("LICH_SU_NGOAI", [`THEP-NGOAI,1,kg,VND,${await ngay(3)},Công ty F,Nhập sau mốc`]);
    await nhap("MOC_NGOAI", [`THEP-NGOAI,200,kg,VND,${homNay},Nhập sau mốc`]);
    await trong(orgA, (c) => rutDuLieuNgoai(c, orgA, { loai: "LICH_SU_NGOAI", loNhapId: loRutSau, actorSessionId: ql.phien }));
    // Quy đổi riêng `bao` khai LẠI sau mốc của X: tại mốc của X dòng `bao` vẫn không quy đổi được — quy đổi đọc TẠI MỐC, không lúc đọc.
    await trong(orgA, (c) => khaiQuyDoiRieng(c, orgA, { hangChuanId: hangN, tuDonVi: "bao", sangDonVi: "kg", heSo: "50", actorSessionId: ql.phien }));
    dau = await doc(orgA, rfqN);
  }, 300_000);

  const nhanNgoai = (b: BenchmarkCuaGoi | null): string[] =>
    b?.trangThai === "CO" && b.dongNgoai !== null
      ? b.dongNgoai.map((d) => `${d.bidVersionId}:${String(d.lineNo)}:${d.nhan}:${d.chieu ?? "-"}`).sort()
      : [];

  it("lần đọc ĐẦU tính và lưu nhãn ngoài của mỗi dòng đo được — tách khỏi nhãn nội bộ (dưới sàn); cờ mốc ngoài không con số", async () => {
    expect(dau).toMatchObject({ trangThai: "CO", nguon: "TINH_MOI", policyVersion: 3 });
    if (dau?.trangThai !== "CO") return;
    expect(dau.dong.filter((d) => d.lineNo === 1).map((d) => d.nhan)).toEqual(["CHUA_DU_LICH_SU", "CHUA_DU_LICH_SU", "CHUA_DU_LICH_SU"]);
    expect(nhanNgoai(dau)).toEqual(
      [
        `${bgN[0]!.versionId}:1:BINH_THUONG:-`,
        `${bgN[1]!.versionId}:1:LECH_CAO:TREN`,
        `${bgN[2]!.versionId}:1:LECH_CAO:DUOI`,
      ].sort(),
    );
    // Cửa sổ suy từ MỐC ĐÃ LƯU, không từ "hôm nay" lúc dựng cảnh — lượt chạy vắt qua nửa đêm giờ Việt Nam (17:00Z) không đổi kỳ vọng.
    const { rows: cs } = await db.pool.query<{ tu: string; den: string }>(
      "SELECT to_char((d - interval '12 months')::date, 'YYYY-MM-DD') AS tu, to_char(d, 'YYYY-MM-DD') AS den " +
        "FROM (SELECT (timezone('UTC', moc_mo_gia) + interval '7 hours')::date AS d FROM price_benchmark_snapshots WHERE rfq_id = $1) x",
      [rfqN],
    );
    for (const d of dau.dongNgoai ?? []) {
      expect(d).toMatchObject({
        canonicalItemId: hangN, tienTe: "VND", cuaSoTu: cs[0]!.tu, denNgay: cs[0]!.den, soDong: 5, soGoi: 4, soNcc: 4, soLoaiTienTe: 1,
        soLoaiKhongQuyDoi: 1,
      });
    }
    expect(dau.mocNgoai).toEqual([
      { canonicalItemId: hangN, tienTe: "VND", nguon: "Bảng giá nhà máy tháng 9", ngayHieuLuc: ngayMocChon },
    ]);
    // Bảng con: ba hàng, không cột tiền; dòng 2 (không đo được) không có hàng.
    const { rows } = await db.pool.query<{ line_no: number }>(
      "SELECT line_no FROM price_benchmark_snapshot_external_lines WHERE rfq_id = $1 ORDER BY line_no",
      [rfqN],
    );
    expect(rows.map((r) => r.line_no)).toEqual([1, 1, 1]);
  });

  it("đọc lại ⇒ BẢN LƯU, cùng nhãn ngoài; hàng sổ `BENCHMARK_READ` mang số đếm ngoài, không giá", async () => {
    const lai = await doc(orgA, rfqN);
    expect(lai).toMatchObject({ trangThai: "CO", nguon: "BAN_LUU" });
    expect(nhanNgoai(lai)).toEqual(nhanNgoai(dau));
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_READ' AND resource_id = $2 ORDER BY seq DESC LIMIT 1",
      [orgA, rfqN],
    );
    expect(rows[0]!.payload).toMatchObject({ soDongNgoai: 3, soMocNgoai: 1, nguon: "BAN_LUU" });
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/107\.5|112/u);
  });

  it("Xem dải: số của dải ngoài, nguồn, ghi/rút SAU mốc chỉ đếm; mốc ngoài theo kg (không nhãn); độ lệch của từng báo giá; nhãn ngoài khớp bản lưu", async () => {
    const kq = await dai(rfqN, 1);
    expect(kq).toMatchObject({ trangThai: "CO", donViGoc: "kg" });
    if (kq?.trangThai !== "CO") return;
    expect(kq.daiNgoai).toHaveLength(1);
    expect(kq.daiNgoai[0]).toMatchObject({
      canonicalItemId: hangN, tienTe: "VND", duSan: true, q1: "103.25", trungVi: "107.5", q3: "115",
      soDong: 5, soGoi: 4, soNcc: 4, soLoaiTienTe: 1, soLoaiKhongQuyDoi: 1,
      nguon: ["Báo giá điện thoại", "Sổ mua 2026"], sauMoc: { GHI: 1, RUT: 1 }, khopBanLuu: true,
    });
    expect(kq.mocNgoai).toHaveLength(1);
    expect(kq.mocNgoai[0]).toMatchObject({ tienTe: "VND", ghiSauMoc: 1, rutSauMoc: false, moc: { nguon: "Bảng giá nhà máy tháng 9" } });
    expect(Number(kq.mocNgoai[0]!.moc?.donGiaQuyDoi)).toBe(112);
    const lech = new Map(kq.giaCuaGoi.map((g) => [g.bidVersionId, g.lechMoc]));
    expect([lech.get(bgN[0]!.versionId), lech.get(bgN[1]!.versionId), lech.get(bgN[2]!.versionId)]).toEqual(["-1.8", "33.9", "-19.6"]);
    const { rows } = await db.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE org_id = $1 AND action = 'BENCHMARK_BAND_READ' AND resource_id = $2 ORDER BY seq DESC LIMIT 1",
      [orgA, rfqN],
    );
    expect(rows[0]!.payload).toMatchObject({ soDai: 1, soDaiNgoai: 1, soMocNgoai: 1 });
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/107\.5|112|103\.25/u);
  });

  it("người giữ `bid.view` đọc được; TECHNICAL (không `bid.view`) bị từ chối ở cả hai bộ đọc", async () => {
    await expect(doc(orgA, rfqN, kyThuat.phien)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(dai(rfqN, 1, kyThuat.phien)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("nhãn ngoài đã lưu bị sửa NGOÀI luật (vai chủ cụm) ⇒ Xem dải `khopBanLuu: false`", async () => {
    await db.pool.query(
      "UPDATE price_benchmark_snapshot_external_lines SET nhan = 'BINH_THUONG', chieu = NULL WHERE rfq_id = $1 AND bid_version_id = $2",
      [rfqN, bgN[1]!.versionId],
    );
    try {
      expect(await dai(rfqN, 1)).toMatchObject({ trangThai: "CO", daiNgoai: [{ khopBanLuu: false }] });
    } finally {
      await db.pool.query(
        "UPDATE price_benchmark_snapshot_external_lines SET nhan = 'LECH_CAO', chieu = 'TREN' WHERE rfq_id = $1 AND bid_version_id = $2",
        [rfqN, bgN[1]!.versionId],
      );
    }
    expect(await dai(rfqN, 1)).toMatchObject({ trangThai: "CO", daiNgoai: [{ khopBanLuu: true }] });
  });

  /** Gói Y một dòng thép N, đã mở, bản lưu tính KHÔNG kèm nhãn ngoài — đúng hình dạng một bản lưu ghi trước S4.6b. */
  async function goiBanLuuCu(): Promise<{ readonly rfqId: string; readonly bg: BaoGia; readonly banId: string; readonly ghiLuc: string; readonly policyId: string }> {
    const rfqId = await taoGoi(boA2, [["Thep mua ngoai", "10", "kg"]]);
    await anhXa(orgA, rfqId, 1, hangN);
    const bg = await nopBaoGia(boA2, rfqId);
    await moThau(boA2, rfqId, [[bg.versionId, phongBi([[1, "1000"]])]]);
    const yc = await lanMoMoiNhat(rfqId);
    const policyId = (await db.pool.query<{ p: string }>("SELECT chinh_sach_ghim_id AS p FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]!.p;
    await trong(orgA, async (c) => {
      const kq = await tinhBenchmarkGoi(c, orgA, { rfqId, bidVersionIds: [bg.versionId], nhom: docNhomBenchmark(NHOM_BENCHMARK_MAU)! });
      expect(kq.ngoai).toBeNull();
      await ghiBanLuuBenchmark(c, orgA, { unsealRequestId: yc, policyId, ketQua: kq });
    });
    // `ghi_luc` dạng CHỮ: `Date` cắt mất micro giây, và khoá ngoại cùng giao dịch so đúng tới micro giây.
    const ban = (
      await db.pool.query<{ id: string; g: string }>("SELECT id, ghi_luc::text AS g FROM price_benchmark_snapshots WHERE rfq_id = $1", [rfqId])
    ).rows[0]!;
    return { rfqId, bg, banId: ban.id, ghiLuc: ban.g, policyId };
  }

  it("bản lưu tính TRƯỚC khi có lịch sử ngoài (không `kemNgoai`) ⇒ bảng `dongNgoai: null`, Xem dải vẫn tính dải ngoài, `khopBanLuu: null`", async () => {
    const { rfqId: rfqY } = await goiBanLuuCu();
    const b = await doc(orgA, rfqY);
    expect(b).toMatchObject({ trangThai: "CO", nguon: "BAN_LUU", dongNgoai: null });
    expect(b?.trangThai === "CO" && b.mocNgoai.length).toBe(1);
    // Y mở SAU X: dải của Y thấy dòng của F (nhập sau mốc của X, trước mốc của Y), thấy dòng `bao` (quy đổi riêng khai lại trước mốc
    // của Y: 6000 / 50 = 120) và không thấy E (rút trước mốc của Y) — L1 theo mốc của TỪNG gói: gói {1, 98, 105, 110, 120} ⇒ trung vị 105.
    const kq = await dai(rfqY, 1);
    expect(kq).toMatchObject({
      trangThai: "CO",
      daiNgoai: [{ trungVi: "105", soDong: 6, soLoaiKhongQuyDoi: 0, sauMoc: { GHI: 0, RUT: 0 }, khopBanLuu: null }],
    });
  });

  it("[rà soát §S1.276 THẤP-2] lô ngoài ghi TRƯỚC mốc mở giá mà commit SAU: lần đọc đầu CHỜ lô commit rồi thấy nó — bản lưu và Xem dải cùng một tập", async () => {
    const hangW = (
      await trong(orgA, (c) => taoHangChuan(c, orgA, { ma: "THEP-CHO-LO", ten: "Thép chờ lô", donViGoc: "kg", actorSessionId: ql.phien }))
    ).id;
    const [a, b, c3] = await Promise.all([12, 13, 14].map((n) => ngay(n)));
    let tha!: () => void;
    const choTha = new Promise<void>((r) => (tha = r));
    let daGhi!: () => void;
    const ghiXong = new Promise<void>((r) => (daGhi = r));
    // Giao dịch nhập lô giữ nguyên tới khi được thả: hàng đã có `ghi_luc` (lúc INSERT), khoá tư vấn của bảng còn giữ.
    const lo = trong(orgA, async (c) => {
      const kq = await nhapDuLieuNgoai(c, orgA, {
        loai: "LICH_SU_NGOAI",
        vanBan: [
          "ma_hang,don_gia,don_vi,tien_te,ngay_mua,nha_cung_cap,nguon",
          `THEP-CHO-LO,100,kg,VND,${a!},Cong ty P,So mua`,
          `THEP-CHO-LO,110,kg,VND,${b!},Cong ty Q,So mua`,
          `THEP-CHO-LO,120,kg,VND,${c3!},Cong ty R,So mua`,
        ].join("\n"),
        actorSessionId: ql.phien,
      });
      expect(kq.nhan).toBe(true);
      daGhi();
      await choTha;
    });
    await ghiXong;
    const rfqW = await taoGoi(boA2, [["Thep cho lo", "10", "kg"]]);
    await anhXa(orgA, rfqW, 1, hangW);
    const bg = await nopBaoGia(boA2, rfqW);
    await moThau(boA2, rfqW, [[bg.versionId, phongBi([[1, "1100"]])]]);
    let xong = false;
    const docDau = doc(orgA, rfqW).then((kq) => {
      xong = true;
      return kq;
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(xong, "lần đọc đầu phải CHỜ lô đang ghi").toBe(false);
    tha();
    await lo;
    const ban = await docDau;
    expect(ban?.trangThai === "CO" && ban.dongNgoai?.map((d) => [d.soDong, d.soGoi, d.nhan])).toEqual([[3, 3, "BINH_THUONG"]]);
    expect(await dai(rfqW, 1)).toMatchObject({ trangThai: "CO", daiNgoai: [{ soDong: 3, trungVi: "110", khopBanLuu: true }] });
  });

  it("CSDL: hàng ngoài ở giao dịch KHÁC ⇒ `…_cung_ban_luu_fk`; dòng không đo được ⇒ `…_dong_do_duoc_fk`; năm `CHECK` có tên; đúng ⇒ vào", async () => {
    // Vai chủ cụm đặt được `ghi_luc` — để khoá ngoại cùng giao dịch không che ràng buộc cần đo; `app_api` thì không đặt được (ca dưới).
    // Bản lưu cũ Y (chưa hàng ngoài nào) để `UNIQUE` không che khoá ngoại; X cho dòng không đo được (dòng 2) và cho các `CHECK`.
    const y = await goiBanLuuCu();
    const banX = (await banLuuCua(rfqN))[0]!;
    const ghiX = (await db.pool.query<{ g: string }>("SELECT ghi_luc::text AS g FROM price_benchmark_snapshots WHERE id = $1", [banX.id])).rows[0]!
      .g;
    interface Hang {
      readonly ban: string; readonly rfq: string; readonly policy: string; readonly bid: string; readonly line: number; readonly ghi: string;
      readonly tu: string; readonly den: string; readonly nhan: string; readonly chieu: string | null;
      readonly dong: number; readonly goi: number; readonly ncc: number;
    }
    const X: Hang = {
      ban: banX.id, rfq: rfqN, policy: banX.policy_id, bid: bgN[0]!.versionId, line: 1, ghi: ghiX,
      tu: "2025-10-01", den: "2026-10-01", nhan: "BINH_THUONG", chieu: null, dong: 3, goi: 3, ncc: 3,
    };
    const Y: Hang = { ...X, ban: y.banId, rfq: y.rfqId, policy: y.policyId, bid: y.bg.versionId, ghi: y.ghiLuc };
    const CHEN =
      "INSERT INTO price_benchmark_snapshot_external_lines (org_id, snapshot_id, rfq_id, policy_id, bid_version_id, line_no, canonical_item_id, " +
      "tien_te, cua_so_tu, den_ngay, nhan, chieu, so_dong, so_goi, so_ncc, so_loai_tien_te, so_loai_khong_quy_doi, ghi_luc) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, 'VND', $8::date, $9::date, $10, $11, $12, $13, $14, 0, 0, $15::timestamptz)";
    const tham = (h: Hang) => [orgA, h.ban, h.rfq, h.policy, h.bid, h.line, hangN, h.tu, h.den, h.nhan, h.chieu, h.dong, h.goi, h.ncc, h.ghi];
    const tuChoi = (h: Hang, code: string, constraint: string) =>
      expect(db.pool.query(CHEN, tham(h)), constraint).rejects.toMatchObject({ code, constraint });
    await tuChoi({ ...Y, ghi: new Date().toISOString() }, "23503", "price_benchmark_snapshot_external_lines_cung_ban_luu_fk");
    await tuChoi({ ...X, line: 2 }, "23503", "price_benchmark_snapshot_external_lines_dong_do_duoc_fk");
    await tuChoi({ ...X, nhan: "KHONG_DO_DUOC" }, "23514", "price_benchmark_snapshot_external_lines_nhan_mien");
    await tuChoi({ ...X, chieu: "TREN" }, "23514", "price_benchmark_snapshot_external_lines_chieu_khi_lech");
    await tuChoi({ ...X, goi: 2, ncc: 3 }, "23514", "price_benchmark_snapshot_external_lines_so_dem");
    await tuChoi({ ...X, dong: 0, goi: 0, ncc: 0 }, "23514", "price_benchmark_snapshot_external_lines_co_dai");
    await tuChoi({ ...X, tu: "2026-10-02" }, "23514", "price_benchmark_snapshot_external_lines_cua_so");
    // Đối chứng dương: Y đúng mọi thứ ⇒ vào (rồi huỷ); X đúng mọi thứ ⇒ chỉ `UNIQUE` của hàng đã có chặn.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(CHEN, tham(Y));
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    await expect(db.pool.query(CHEN, tham(X))).rejects.toMatchObject({ code: "23505" });
  });

  it("`app_api` không UPDATE, không DELETE, không tự đặt `ghi_luc`; phiên khách và tổ chức khác thấy 0 hàng", async () => {
    const ban = (await banLuuCua(rfqN))[0]!;
    for (const cau of [
      "UPDATE price_benchmark_snapshot_external_lines SET nhan = 'BINH_THUONG' WHERE snapshot_id = $1",
      "DELETE FROM price_benchmark_snapshot_external_lines WHERE snapshot_id = $1",
      "INSERT INTO price_benchmark_snapshot_external_lines (org_id, snapshot_id, ghi_luc) SELECT org_id, id, ghi_luc FROM price_benchmark_snapshots WHERE id = $1",
    ]) {
      await expect(trong(orgA, (c) => c.query(cau, [ban.id])), cau).rejects.toMatchObject({ code: "42501" });
    }
    const dem = (org: string, khach: string | null) =>
      trong(org, async (c) => {
        if (khach !== null) await c.query("SELECT set_config('app.guest_session_id', $1, true)", [khach]);
        return (await c.query<{ n: string }>("SELECT count(*)::text AS n FROM price_benchmark_snapshot_external_lines")).rows[0]!.n;
      });
    expect(Number(await dem(orgA, null)), "đối chứng dương").toBeGreaterThan(0);
    expect(await dem(orgA, bgN[0]!.phienKhach)).toBe("0");
    expect(await dem(orgB, null)).toBe("0");
  });
});
