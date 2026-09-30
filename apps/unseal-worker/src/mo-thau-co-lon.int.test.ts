// ==============================================================================================
// [S1.9141 / khoản 167] LƯỢT MỞ THẦU CỠ LỚN TRÊN ĐƯỜNG ĐIỂM VÀO THẬT CỦA WORKER — VÀ THỜI HẠN 60 s
// CỦA HANDLER, ĐO CHỨ KHÔNG KHAI.
//
// Khoản 116 ghi rằng phép đo của 106/107 chạy trên một đường KHÁC đường sẽ chạy: `unseal-worker.int
// .test.ts` gọi thẳng `executeUnsealRequest` trên một pool `app_unseal` của test-support — không IM7,
// không `statement_timeout` LOCAL 60 s, không `Promise.race` 60 s của `JobRunner`. S1.82 dựng đường
// ấy (`tien-trinh.ts`) nhưng chỉ đo TÍNH ĐÚNG của nó ở cỡ NHỎ. Khoản 167 đòi phần còn lại, và tệp
// này là phần ấy: mọi lượt dưới đây đi qua `taoTienTrinhUnsealWorker` — pool dựng từ chuỗi kết nối
// của `app_unseal_login`, `SET ROLE app_unseal`, runner thật với bảng handler thật, job nhặt từ
// `outbox_jobs` — với phong bì ở HAI cỡ:
//   • `TRAN_THAN_BYTE` (64 KiB, `apps/api/src/router.ts`): trần THÂN HTTP của api — không phong bì
//     nào đi qua HTTP lớn hơn nó;
//   • `TRAN_PHONG_BI_BYTE` (8 MiB): trần cột `vendor_bid_versions.envelope` (018, `CHECK octet_length
//     BETWEEN 32 AND 8388608`) — lớn nhất mà lược đồ nhận, và vế ⓪ dưới đây ĐO ràng buộc ấy chứ không
//     chép nó.
// Ở mỗi cỡ, các ca của 106 (chuỗi/khoá/độ sâu `jsonb` từ chối, U+0000 thô) và 107 (số giữ nguyên giá
// trị, biên văn bản của số, số `numeric` không chứa nổi, khoá trùng, đối chứng của phép quét) được
// lặp lại — mỗi ca một RFQ, một báo giá sạch cộng một báo giá cỡ ấy, một job — rồi một RFQ GOM MỌI
// CA (14 phong bì cùng cỡ, một job) cho con số đầu bảng.
//
// PHÉP ĐO THỜI HẠN. Trần của handler trên đường này là `leaseSeconds` mặc định 60 của `JobRunner`
// (`packages/outbox/src/runner.ts`: `handlerTimeoutMs ?? leaseSeconds * 1000`; `tien-trinh.ts` không
// ghi đè) — nửa CSDL là `SET LOCAL statement_timeout`, nửa JS là `Promise.race`. Mỗi lượt đo:
//   • `msHandler`: từ lúc job được thấy `RUNNING` tới lúc thấy `DONE`, đồng hồ test, thăm dò 10 ms;
//   • `msTuXep`: `finished_at − created_at`, đồng hồ CSDL — cận trên gồm cả một nhịp poll (100 ms);
//   • `leaseGiay`: `lease_expires_at − clock_timestamp()` lúc thấy `RUNNING` — đối chứng dương rằng
//     trần 60 s đúng là trần đang có hiệu lực trên đường này, không phải 15 s của pool.
// Một lượt quá trần KHÔNG được vá ở vòng này (đề bài); nó mở `khoản 9441`. Số đo ghi ở §S1.9141.
//
// Không nhãn INV: đây là phép đo khả dụng ở biên cỡ, cùng loại với khối khoản 126 của
// `unseal-worker.int.test.ts`. Kết quả từng ca được so ở PHÍA CSDL (`payload = $2::jsonb`), không kéo
// 8 MiB về so trong JS — cùng lý do khối 107 đã ghi: `pg` phân tích `jsonb` bằng `JSON.parse`.
// ==============================================================================================

import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { MasterKeyRing, createLocalDevOrgKeyProvisioner } from "@trustprocure/crypto-keys";
import { migrate } from "@trustprocure/db";
import { enqueueJob } from "@trustprocure/outbox";
import { getRfqPublicKeys, issueRfqKeyPair, sealBid } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
// Import TƯƠNG ĐỐI xuyên app, có chủ đích và có tiền lệ (`tien-trinh.int.test.ts`, `kich-ban-41-http.int.test.ts`): chỉ ĐỌC một
// hằng của api; mã CHẠY của worker không chạm api.
import { TRAN_THAN_BYTE } from "../../api/src/router.js";
import { docCauHinh } from "./cau-hinh.js";
import { UNSEAL_JOB_KIND } from "./composition.js";
import { taoTienTrinhUnsealWorker } from "./tien-trinh.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const KHOA_32 = Buffer.alloc(32, 3);

/** Trần cột `envelope` của 018 — chép giá trị, và vế ⓪ đo rằng CSDL từ chối đúng ở byte kế tiếp. */
const TRAN_PHONG_BI_BYTE = 8 * 1024 * 1024;
/** Trần handler trên đường điểm vào: `leaseSeconds` mặc định 60 của `JobRunner` (xem khối đầu tệp). */
const TRAN_HANDLER_MS = 60_000;
/** Hạn chờ một job ở mỗi lượt — phải vượt trần handler để một lượt quá trần được thấy là quá trần, không phải hết giờ chờ. */
const HAN_CHO_JOB_MS = 150_000;

const BS = String.fromCharCode(92);
const NUL = String.fromCharCode(0);
const BAN_RO_SACH = JSON.stringify({ donGia: 111, tienTe: "VND" });

let db: TestDatabase;
let apiPool: pg.Pool;
let urlLogin: string;
let thuMucCanhBao: string;
let tienTrinh: ReturnType<typeof taoTienTrinhUnsealWorker> | undefined;
let orgA: string;
let uYc: string, uD1: string;
let sYc: string, sD1: string;
let csA: string;
/** Phần dôi của phong bì so với bản rõ (đầu phong bì + khoá phù du + IV + thẻ GCM) — đo ở `beforeAll`, không chép hằng. */
let doiPhongBi = -1;
const logWorker: string[] = [];
const consoleErrorGoc = console.error;

// [ADR-062] Cặp khoá tổ chức sinh bằng CHÍNH bộ sinh local-dev của sản xuất, bọc bằng cùng vòng master key mà tiến trình worker được
// cấu hình — không dùng đồ giả xor của `unseal-worker.int.test.ts`, vì ở đây thứ được đo là ĐƯỜNG THẬT.
const boSinhKhoaToChuc = createLocalDevOrgKeyProvisioner(new MasterKeyRing("v1", { v1: KHOA_32 }));

function doiNguoiDung(chuoi: string, nguoi: string, matKhau: string): string {
  const u = new URL(chuoi);
  u.username = nguoi;
  u.password = matKhau;
  return u.toString();
}

function moiTruong(): Record<string, string> {
  return {
    TRUSTPROCURE_DATABASE_URL: urlLogin,
    TRUSTPROCURE_DB_POOL_MAX: "2",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32.toString("base64")}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
    TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
    TRUSTPROCURE_ALERT_DIR: thuMucCanhBao,
    // Nhịp poll nhỏ nhất `cau-hinh.ts` cho phép: phần chờ nhặt job không át phần đo handler.
    TRUSTPROCURE_OUTBOX_POLL_MS: "100",
  };
}

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

/** Một RFQ đã OPEN kèm vật liệu khoá THẬT — cùng fixture với `unseal-worker.int.test.ts`, bộ sinh khoá là bản local-dev. */
async function taoRfqMo(): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
      "VALUES ($1, 'Mua thep tam', $2, false, $3, $4) RETURNING id",
    [orgA, MAI_SAU, uYc, sYc],
  );
  const rfqId = rows[0]?.id ?? "";
  await db.pool.query(
    "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4)",
    [orgA, rfqId, uYc, sYc],
  );
  await db.pool.query(
    "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
      "VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
    [orgA, rfqId, csA, uYc, sYc],
  );
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  await db.pool.query(
    "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)",
    [orgA, rfqId, uD1, sD1],
  );
  await withTenant(apiPool, orgA, async (c) => {
    await issueRfqKeyPair(c, orgA, { rfqId, actorSessionId: sYc, orgKeys: boSinhKhoaToChuc });
    await c.query(
      "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
      [rfqId, uYc, sYc],
    );
  });
  return rfqId;
}

/** Niêm phong `banRo` cho RFQ bằng khoá công khai thật của nó. */
async function niemPhong(rfqId: string, banRo: Uint8Array): Promise<Uint8Array> {
  const khoa = await withTenant(apiPool, orgA, (c) => getRfqPublicKeys(c, orgA, rfqId));
  const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
  if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");
  return sealBid({ rfqId, algorithm: "ECDH_P256", recipientPublicKey: p256.publicKey, plaintext: banRo });
}

/** Nộp một báo giá THẬT. Trả id phiên bản, id báo giá và id phiên khách (vế ⓪ cần hai id sau). */
async function nopBaoGia(rfqId: string, banRo: string): Promise<{ versionId: string; bidId: string; guestSessionId: string }> {
  const hex = randomBytes(4).toString("hex");
  const { rows: ncc } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [orgA, `NCC ${hex}`, uYc, sYc],
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
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, destination_hash, " +
      "pepper_version, expires_at, consumed_at) VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day', now()) " +
      "RETURNING id",
    [orgA, invitationId, tk[0]?.id ?? "", contactId, randomBytes(32), randomBytes(32)],
  );
  const { rows: pk } = await db.pool.query<{ id: string }>(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [orgA, invitationId, tt[0]?.id ?? "", randomBytes(32), contactId],
  );
  const guestSessionId = pk[0]?.id ?? "";
  const phongBi = await niemPhong(rfqId, new TextEncoder().encode(banRo));

  return await withTenant(apiPool, orgA, async (c) => {
    const { rows: b } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id",
      [orgA, invitationId],
    );
    const bidId = b[0]?.id ?? "";
    const { rows: v } = await c.query<{ id: string }>(
      "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, bidId, Buffer.from(phongBi), guestSessionId],
    );
    const versionId = v[0]?.id ?? "";
    await c.query(
      "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)",
      [
        orgA,
        versionId,
        `trustprocure-receipt-v1\nalg=ECDSA_P256_SHA256\nkid=k1\nrfq_id=${rfqId}\nbid_id=${bidId}\nversion=1\n` +
          `ciphertext_sha256=${"a".repeat(64)}\nsubmitted_at=2026-09-05T00:00:00.000000Z\n`,
        Buffer.alloc(70, 7),
      ],
    );
    return { versionId, bidId, guestSessionId };
  });
}

/** Đóng RFQ, tạo + phê duyệt + điều phối một yêu cầu mở thầu, rồi XẾP JOB cho worker — đúng thứ `dispatchUnseal` xếp. */
async function dongXinMoThauVaXepJob(rfqId: string): Promise<{ requestId: string; jobId: string }> {
  await db.pool.query(
    "UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de kiem tra', " +
      "closed_by = $2, closed_by_session_id = $3 WHERE id = $1",
    [rfqId, uYc, sYc],
  );
  const { rows } = await withTenant(apiPool, orgA, (c) =>
    c.query<{ id: string }>(
      "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) " +
        "VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
      [orgA, rfqId, uYc, sYc],
    ),
  );
  const requestId = rows[0]?.id ?? "";
  const jobId = await withTenant(apiPool, orgA, async (c) => {
    await c.query(
      "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)",
      [orgA, requestId, uD1, sD1],
    );
    await c.query("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [requestId]);
    await c.query(
      "UPDATE unseal_requests SET dispatched_at = now(), dispatched_by = $2, dispatched_by_session_id = $3 WHERE id = $1",
      [requestId, uYc, sYc],
    );
    return enqueueJob(c, orgA, { kind: UNSEAL_JOB_KIND, payload: { unsealRequestId: requestId, rfqId } });
  });
  return { requestId, jobId };
}

interface HangJob {
  readonly status: string;
  readonly attempts: number;
  readonly last_failure_reason: string | null;
  readonly lease_expires_at: Date | null;
  readonly created_at: Date;
  readonly finished_at: Date | null;
  readonly bay_gio: Date;
}

async function docJob(jobId: string): Promise<HangJob> {
  const { rows } = await db.pool.query<HangJob>(
    "SELECT status, attempts, last_failure_reason, lease_expires_at, created_at, finished_at, clock_timestamp() AS bay_gio " +
      "FROM outbox_jobs WHERE id = $1",
    [jobId],
  );
  const h = rows[0];
  if (h === undefined) throw new Error("job khong ton tai");
  return h;
}

interface SoDoLuot {
  readonly status: string;
  readonly attempts: number;
  readonly lyDo: string | null;
  /** RUNNING → DONE theo đồng hồ test, thăm dò 10 ms; `-1` nếu chưa từng thấy RUNNING (job xong dưới một nhịp thăm dò). */
  readonly msHandler: number;
  /** `finished_at − created_at`, đồng hồ CSDL — cận trên, gồm cả một nhịp poll. `-1` nếu chưa xong. */
  readonly msTuXep: number;
  /** `lease_expires_at − clock_timestamp()` lúc thấy RUNNING; `-1` nếu chưa từng thấy RUNNING. */
  readonly leaseGiay: number;
}

/** Chờ worker (đã chạy nền) nhặt và ghi kết cục cho `jobId`. Kết cục là DONE, FAILED, hay PENDING với `attempts > 0` (hẹn thử lại). */
async function choKetCucJob(jobId: string): Promise<SoDoLuot> {
  const batDau = Date.now();
  let tRunning = -1;
  let leaseGiay = -1;
  for (;;) {
    const h = await docJob(jobId);
    if (h.status === "RUNNING" && tRunning < 0) {
      tRunning = Date.now();
      leaseGiay = h.lease_expires_at === null ? -1 : (h.lease_expires_at.getTime() - h.bay_gio.getTime()) / 1000;
    }
    const daCoKetCuc = h.status === "DONE" || h.status === "FAILED" || (h.status === "PENDING" && h.attempts > 0);
    if (daCoKetCuc || Date.now() - batDau > HAN_CHO_JOB_MS) {
      return {
        status: daCoKetCuc ? h.status : `HET_GIO_CHO(${h.status})`,
        attempts: h.attempts,
        lyDo: h.last_failure_reason,
        msHandler: tRunning < 0 ? -1 : Date.now() - tRunning,
        msTuXep: h.finished_at === null ? -1 : h.finished_at.getTime() - h.created_at.getTime(),
        leaseGiay,
      };
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function keLuot(ten: string, d: SoDoLuot): string {
  return (
    `${ten}: ${d.status} sau ${d.attempts} lần, lý do "${d.lyDo ?? ""}", handler ${d.msHandler} ms, ` +
    `từ xếp tới xong ${d.msTuXep} ms, lease ${d.leaseGiay} s; log worker: ${JSON.stringify(logWorker.slice(-5))}`
  );
}

/** Payload của một phiên bản, so ở PHÍA CSDL: có BẰNG `kyVong` (một văn bản `jsonb`) không. */
async function payloadBang(versionId: string, kyVongJsonb: string): Promise<boolean> {
  const { rows } = await withTenant(apiPool, orgA, (c) =>
    c.query<{ khop: boolean }>("SELECT payload = $2::jsonb AS khop FROM rfq_unsealed_bids WHERE bid_version_id = $1", [
      versionId,
      kyVongJsonb,
    ]),
  );
  expect(rows, `phải có ĐÚNG một hàng bản rõ cho phiên bản ${versionId}`).toHaveLength(1);
  return rows[0]?.khop === true;
}

/** Payload có bằng `{ raw: <văn bản> }` không — cùng phép so phía CSDL, văn bản đi qua tham số, không nội suy. */
async function payloadLaRaw(versionId: string, raw: string): Promise<boolean> {
  const { rows } = await withTenant(apiPool, orgA, (c) =>
    c.query<{ khop: boolean }>(
      "SELECT payload = pg_catalog.jsonb_build_object('raw', $2::text) AS khop FROM rfq_unsealed_bids WHERE bid_version_id = $1",
      [versionId, raw],
    ),
  );
  expect(rows, `phải có ĐÚNG một hàng bản rõ cho phiên bản ${versionId}`).toHaveLength(1);
  return rows[0]?.khop === true;
}

// ----------------------------------------------------------------------------------------------
// CÁC CA, dựng theo CỠ BẢN RÕ đích (byte, ASCII trừ chỗ nói rõ). `dem(n)` là trường đệm để bản rõ
// đúng cỡ; các ca mà chính cấu trúc là phần đệm (lồng sâu, mảng số) tự tính số phần tử.
// `kyVong`: `"raw"` — cất dưới `{ raw }` nguyên văn; `"giu"` — `jsonb` nhận văn bản gốc, giữ nguyên
// hình dạng (so `payload = $2::jsonb`); `"raw-bo-nul"` — cất dưới `{ raw }` đã gỡ U+0000.
// ----------------------------------------------------------------------------------------------
interface CaCoLon {
  readonly ten: string;
  readonly kyVong: "raw" | "giu" | "raw-bo-nul";
  dung(coByte: number): string;
}

/** Bọc `loi` (một dãy cặp khoá-giá trị, có dấu phẩy đầu nếu không rỗng) bằng một đối tượng có trường đệm để đúng `coByte` byte. */
function boc(coByte: number, loi: string): string {
  const khung = '{"dem":""' + loi + "}";
  const thieu = coByte - Buffer.byteLength(khung, "utf8");
  if (thieu < 0) throw new Error(`ca vượt cỡ đích ${thieu} byte`);
  return '{"dem":"' + "x".repeat(thieu) + '"' + loi + "}";
}

const CAC_CA: readonly CaCoLon[] = [
  { ten: "106 ⑴ escape U+0000 trong một CHUỖI", kyVong: "raw", dung: (n) => boc(n, ',"donGia":222,"ghiChu":"a' + BS + 'u0000b"') },
  { ten: "106 ⑵ escape U+0000 trong một KHOÁ", kyVong: "raw", dung: (n) => boc(n, ',"donGia":333,"a' + BS + 'u0000":1,"a":2') },
  {
    ten: "106 ⑶ escape surrogate đơn lẻ, nằm sâu trong mảng lồng",
    kyVong: "raw",
    dung: (n) => boc(n, ',"hang":[1,[2,["' + BS + 'ud800"]]]'),
  },
  {
    ten: "106 ⑷ mảng lồng SÂU BẰNG CẢ BẢN RÕ — JSON.parse gãy ngăn xếp, cất dưới raw",
    kyVong: "raw",
    dung: (n) => {
      // '{"a":' + '['×k + ']'×k + '}' = 6 + 2k byte; lẻ một byte thì thêm một khoảng trắng — JSON cho phép, và `raw` giữ nguyên văn.
      const k = Math.floor((n - 6) / 2);
      return '{"a":' + "[".repeat(k) + "]".repeat(k) + "}" + " ".repeat(n - 6 - 2 * k);
    },
  },
  {
    ten: "106 ngưỡng độ sâu — 64 tầng đối tượng lồng cộng phần đệm, giữ nguyên hình dạng",
    kyVong: "giu",
    dung: (n) => boc(n, ',"a":' + '{"a":'.repeat(63) + "1" + "}".repeat(63)),
  },
  {
    ten: "106 ĐỐI CHỨNG — cặp surrogate hợp lệ, escape điều khiển khác U+0000, gạch chéo ngược thật trước u0000",
    kyVong: "giu",
    dung: (n) =>
      boc(
        n,
        ',"ghiChu":"' + BS + "ud83d" + BS + 'ude00","' + BS + "ud83d" + BS + 'ude00":1,"dk":"a' + BS + "u0001b" + BS + 'u001fc",' +
          '"gc":"a' + BS + BS + 'u0000b","k' + BS + BS + 'u0000":2',
      ),
  },
  {
    ten: "106 [lượt soi 57] U+0000 THÔ trong một chuỗi — không phải JSON hợp lệ, cất dưới raw đã gỡ U+0000",
    kyVong: "raw-bo-nul",
    dung: (n) => boc(n, ',"ghiChu":"x' + NUL + '","khac":"' + BS + 'u0000"'),
  },
  {
    ten: "107 số tiền kiểu SỐ giữ nguyên giá trị — 99999999999999.99 và 9007199254740993",
    kyVong: "giu",
    dung: (n) => boc(n, ',"totalAmount":99999999999999.99,"khac":9007199254740993,"currency":"VND"'),
  },
  {
    ten: "107 MẢNG SỐ LẤP ĐẦY BẢN RÕ — phép đi cây, phép quét khoá và phép soi biên số trên hàng triệu số",
    kyVong: "giu",
    dung: (n) => {
      // '{"a":[' + '0,'×(k−1) + '0' + ']}' = 2k + 7 byte.
      const k = Math.floor((n - 7) / 2);
      return '{"a":[' + "0,".repeat(k - 1) + "0" + "]}" + " ".repeat(n - 7 - 2 * k);
    },
  },
  { ten: "107 biên văn bản của một số — 1 000 ký tự, giữ nguyên giá trị", kyVong: "giu", dung: (n) => boc(n, ',"a":' + "9".repeat(1000)) },
  { ten: "107 biên văn bản của một số — 1 001 ký tự, cả bản rõ cất dưới raw", kyVong: "raw", dung: (n) => boc(n, ',"a":' + "9".repeat(1001)) },
  {
    ten: "107 số mà `numeric` không chứa nổi — 1e131072 là phần tử mảng, cất dưới raw",
    kyVong: "raw",
    dung: (n) => boc(n, ',"totalAmount":1,"hang":[2,1e131072]'),
  },
  {
    ten: "107 KHOÁ TRÙNG sau dấu nháy đã thoát — cả bản rõ cất dưới raw",
    kyVong: "raw",
    dung: (n) => boc(n, ',"a":"' + BS + 'ud800","a":"x' + BS + '"y","b":1'),
  },
  {
    ten: "107 ĐỐI CHỨNG của phép quét văn bản — khoảng trắng quanh dấu hai chấm, dấu nháy và ngoặc trong chuỗi, true/false/null",
    kyVong: "giu",
    dung: (n) =>
      boc(
        n,
        ',"a" :  1 ,' + String.fromCharCode(13, 10) + ' "b"' + String.fromCharCode(9) + ":" + String.fromCharCode(13, 10) + "[ 2 ]," +
          '"ghiChu":"x' + BS + '":1","k":[1,"]:{"],"dung":true,"sai":false,"rong":null,"am":-12.5,"ma":"1e999"',
      ),
  },
];

/** Kỳ vọng cho một ca, so phía CSDL. Trả lỗi dưới dạng chuỗi ngắn để thông điệp không mang 8 MiB. */
async function kiemCa(ca: CaCoLon, versionId: string, banRo: string): Promise<string> {
  if (ca.kyVong === "giu") return (await payloadBang(versionId, banRo)) ? "" : `${ca.ten}: payload KHÁC bản rõ (jsonb =)`;
  const raw = ca.kyVong === "raw" ? banRo : banRo.split(NUL).join("");
  return (await payloadLaRaw(versionId, raw)) ? "" : `${ca.ten}: payload KHÔNG phải { raw } kỳ vọng`;
}

/**
 * Đòi job DONE ở lần đầu, dưới trần, không lý do hỏng — đây là phần "thời hạn handler" của khoản 167. Mỗi lượt in MỘT dòng số đo
 * (`[đo khoản 167]`) để lần đo lại đọc được con số mà không phải làm đỏ test; dòng ấy chỉ mang tên ca và mili-giây, không mang bản rõ.
 */
function khangDinhTronVenDuoiTran(ten: string, d: SoDoLuot): void {
  console.error(
    `[đo khoản 167] ${ten}: ${d.status}/${d.attempts}, handler ${d.msHandler} ms, từ xếp tới xong ${d.msTuXep} ms, lease ${d.leaseGiay} s`,
  );
  expect(d.status, `lượt mở thầu phải chạy trọn trên đường điểm vào — ${keLuot(ten, d)}`).toBe("DONE");
  expect(d.attempts, `phải xong ở lần đầu, không qua HANDLER_TIMEOUT rồi thử lại — ${keLuot(ten, d)}`).toBe(1);
  expect(d.lyDo, keLuot(ten, d)).toBeNull();
  expect(d.msHandler, `handler phải dưới trần ${TRAN_HANDLER_MS} ms — ${keLuot(ten, d)}`).toBeLessThan(TRAN_HANDLER_MS);
  expect(d.msTuXep, `từ xếp tới xong phải dưới trần — ${keLuot(ten, d)}`).toBeLessThan(TRAN_HANDLER_MS);
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a-k167') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  uYc = await taoNguoi("yc@vidu.vn", "PROCUREMENT_MANAGER");
  uD1 = await taoNguoi("d1@vidu.vn", "DIRECTOR");
  sYc = await taoPhien(uYc);
  sD1 = await taoPhien(uD1);
  const cs = await db.pool.query<{ id: string }>(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
      "VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [orgA, uYc, sYc],
  );
  csA = cs.rows[0]?.id ?? "";
  expect([orgA, uYc, uD1, sYc, sD1, csA].filter((x) => x === "")).toEqual([]);

  // Phần dôi của phong bì, ĐO trên một lần niêm phong thật (bố cục phong bì là hằng theo thuật toán).
  const rfqDo = await taoRfqMo();
  doiPhongBi = (await niemPhong(rfqDo, new Uint8Array([49]))).length - 1;
  expect(doiPhongBi).toBeGreaterThan(0);

  // Tiến trình worker THẬT chạy nền suốt tệp: `app_unseal_login` → `SET ROLE app_unseal`, hai pool, runner với bảng handler thật.
  await db.pool.query("CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk-unseal' IN ROLE app_unseal");
  urlLogin = doiNguoiDung(db.connectionString, "app_unseal_login", "mk-unseal");
  thuMucCanhBao = mkdtempSync(join(tmpdir(), "tp-canh-bao-k167-"));
  // Mọi dòng log của worker (khởi động, `onJobFailure`, tồn đọng) đi vào `logWorker` để thông điệp đỏ mang được nó; vẫn in ra.
  console.error = (...a: unknown[]) => {
    const dong = a.map(String).join(" ");
    if (dong.startsWith("[unseal-worker]")) logWorker.push(dong);
    consoleErrorGoc(...a);
  };
  tienTrinh = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()));
  await tienTrinh.batDau();
}, 180_000);

afterAll(async () => {
  await tienTrinh?.dung();
  console.error = consoleErrorGoc;
  await apiPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.9141 / khoản 167] mở thầu cỡ lớn trên đường điểm vào thật của worker", () => {
  it("⓪ ĐỐI CHỨNG của cỡ: phong bì đúng trần 8 MiB được nhận, thêm MỘT byte thì 018 từ chối (23514) — trần đo được, không chép", async () => {
    const rfqId = await taoRfqMo();
    const { bidId, guestSessionId } = await nopBaoGia(rfqId, BAN_RO_SACH);
    const c = await db.pool.connect();
    try {
      for (const [coByte, kyVong] of [
        [TRAN_PHONG_BI_BYTE, null],
        [TRAN_PHONG_BI_BYTE + 1, "23514"],
      ] as const) {
        await c.query("BEGIN");
        const ma = await c
          .query(
            "INSERT INTO vendor_bid_versions (org_id, bid_id, envelope, submitted_by_guest_session_id) VALUES ($1, $2, $3, $4)",
            [orgA, bidId, Buffer.alloc(coByte, 7), guestSessionId],
          )
          .then(
            () => null,
            (e: unknown) => (e as { code?: string }).code ?? "?",
          );
        await c.query("ROLLBACK");
        expect(ma, `phong bì ${coByte} byte`).toBe(kyVong);
      }
    } finally {
      c.release();
    }
  });

  for (const [tenCo, coPhongBi] of [
    ["TRAN_THAN_BYTE (64 KiB — trần thân HTTP của api)", TRAN_THAN_BYTE],
    ["8 MiB (trần cột envelope của 018)", TRAN_PHONG_BI_BYTE],
  ] as const) {
    describe(`phong bì cỡ ${tenCo}`, () => {
      const coBanRo = (): number => coPhongBi - doiPhongBi;

      it.each(CAC_CA.map((ca): [string, CaCoLon] => [ca.ten, ca]))(
        "%s — một RFQ, một báo giá sạch, một phong bì đúng cỡ, một job",
        async (ten, ca) => {
          const banRo = ca.dung(coBanRo());
          expect(Buffer.byteLength(banRo, "utf8"), "bản rõ phải đúng cỡ đích").toBe(coBanRo());
          const rfqId = await taoRfqMo();
          const sach = await nopBaoGia(rfqId, BAN_RO_SACH);
          const lon = await nopBaoGia(rfqId, banRo);
          const { rows: co } = await db.pool.query<{ n: number }>(
            "SELECT octet_length(envelope)::int AS n FROM vendor_bid_versions WHERE id = $1",
            [lon.versionId],
          );
          expect(co[0]?.n, "phong bì trong CSDL phải đúng cỡ đích").toBe(coPhongBi);

          const { jobId } = await dongXinMoThauVaXepJob(rfqId);
          const d = await choKetCucJob(jobId);
          khangDinhTronVenDuoiTran(`${tenCo} · ${ten}`, d);
          expect(await payloadBang(sach.versionId, BAN_RO_SACH), "báo giá sạch phải giữ nguyên hình dạng").toBe(true);
          expect(await kiemCa(ca, lon.versionId, banRo)).toBe("");
        },
        HAN_CHO_JOB_MS + 60_000,
      );

      it(
        "MỘT RFQ GOM MỌI CA — 14 phong bì cùng cỡ trong một job: chạy trọn dưới trần 60 s, và trần ấy là trần đang có hiệu lực",
        async () => {
          const rfqId = await taoRfqMo();
          const sach = await nopBaoGia(rfqId, BAN_RO_SACH);
          const cacBanRo = CAC_CA.map((ca) => ca.dung(coBanRo()));
          const cacId: string[] = [];
          for (const banRo of cacBanRo) cacId.push((await nopBaoGia(rfqId, banRo)).versionId);

          const { jobId } = await dongXinMoThauVaXepJob(rfqId);
          const d = await choKetCucJob(jobId);
          khangDinhTronVenDuoiTran(`${tenCo} · GOM ${CAC_CA.length} ca`, d);
          // ĐỐI CHỨNG DƯƠNG của con số 60 s: hạn thuê thấy được lúc job đang chạy là ~60 s — không phải 15 s của pool, không phải
          // một giá trị nào khác. Job này chạy đủ lâu để một nhịp thăm dò 10 ms chắc chắn thấy nó ở RUNNING.
          expect(d.leaseGiay, `phải thấy job ở RUNNING và hạn thuê của nó là 60 s — ${keLuot("gom", d)}`).toBeGreaterThan(50);
          expect(d.leaseGiay, keLuot("gom", d)).toBeLessThanOrEqual(60);
          expect(await payloadBang(sach.versionId, BAN_RO_SACH), "báo giá sạch phải giữ nguyên hình dạng").toBe(true);
          const loi: string[] = [];
          for (const [i, ca] of CAC_CA.entries()) {
            const l = await kiemCa(ca, cacId[i] ?? "", cacBanRo[i] ?? "");
            if (l !== "") loi.push(l);
          }
          expect(loi).toEqual([]);
        },
        HAN_CHO_JOB_MS + 120_000,
      );
    });
  }
});
