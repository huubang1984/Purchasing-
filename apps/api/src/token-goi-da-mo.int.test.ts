import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import {
  PepperRing,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  createProcurementPolicy,
  createRfq,
  openRfq,
  setRfqBudget,
  submitRfqForApproval,
} from "@trustprocure/rfq";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

// =============================================================================================
// [S1.186 / S3.2b1 / K6 · khoản 253] TOKEN ĐÚC KHI GÓI CHƯA MỞ THÔI DÙNG ĐƯỢC SAU KHI TỔ CHỨC BẬT S3 — ĐO Ở PHÍA DÙNG
//
// K6 (`076`) chặn lần ĐÚC; khoản 253 đo rằng token thời MVP1 của gói chưa mở sống qua lần bật. `077_tra_ve_nhap` ghi, lúc
// đúc, gói đã mở chưa (`duc_khi_goi_da_mo`), và `docToken` của `packages/invitation` đòi cột ấy ở tổ chức đã bật — ở cả
// ba đường dùng token: đổi link, xin OTP, xác minh OTP. Tệp này đứng ở `apps/api` vì nó cần CẢ gói `rfq` (mở gói thật) LẪN gói
// `invitation` (đường dùng thật). Vế CSDL của cột đo ở `packages/rfq/src/tra-ve-nhap.int.test.ts`.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PEPPER = new PepperRing("p1", { p1: Buffer.alloc(32, 7) });
const LOI_TOKEN = "magic link không hợp lệ, đã hết hạn, đã dùng, hoặc đã bị thu hồi";

// Bộ sinh cặp khoá tổ chức GIẢ, khuôn `danh-sach-moi.int.test.ts`. *** KHÔNG PHẢI MÃ HOÁ. ***
const boBocGia = {
  name: "gia-cho-test-token-goi-da-mo",
  generate: (orgId: string) => {
    const k = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return Promise.resolve({
      orgId,
      keyVersion: "test-v1",
      publicKey: k.publicKey.export({ format: "der", type: "spki" }),
      wrappedPrivateKey: new Uint8Array(k.privateKey.export({ format: "der", type: "pkcs8" })).map((b) => b ^ 0xff),
    });
  },
};

const BAC = [
  {
    tu_so_tien: 0,
    so_ncc_toi_thieu: 1,
    award_vai_khac_nhau: false,
    ky_danh_sach_moi: false,
    xoay_vong_n: 0,
    award_so_chu_ky: 1,
    award_vai: ["DIRECTOR"],
    tham_dinh_truoc_trao: false,
    khai_xung_dot: false,
    dau_thau_chinh_thuc: false,
  },
  { tu_so_tien: 10_000_000_000, dau_thau_chinh_thuc: true },
];

let db: TestDatabase;
let apiPool: pg.Pool;

interface Nguoi {
  readonly u: string;
  readonly s: string;
}
interface ToChuc {
  readonly org: string;
  readonly pm: Nguoi;
  readonly pm2: Nguoi;
  readonly tc: Nguoi;
}

async function motId(sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await db.pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

async function taoToChuc(): Promise<ToChuc> {
  const org = await motId("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [
    `tgm-${randomBytes(4).toString("hex")}`,
  ]);
  const nguoi = async (vai: string): Promise<Nguoi> => {
    const u = await motId("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id", [
      org,
      `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`,
    ]);
    await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const s = await motId(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
        "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [org, u, randomBytes(32)],
    );
    return { u, s };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const tc = await nguoi("FINANCE");
  await withTenant(apiPool, org, (c) =>
    createProcurementPolicy(c, org, { version: 1, dualApprovalThreshold: "100000000.00", currency: "VND", actorSessionId: pm.s }),
  );
  return { org, pm, pm2, tc };
}

/** BẬT S3 — khuôn `batS3` của `danh-sach-moi`. */
async function batS3(t: ToChuc): Promise<void> {
  const v2 = (
    await withTenant(apiPool, t.org, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, tiers, " +
          "chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, strict_blind_mode, effective_from, created_by, created_by_session_id) " +
          "VALUES ($1, 2, '100000000.00', 'VND', $2::jsonb, 30, 12, true, now(), $3, $4) RETURNING id",
        [t.org, JSON.stringify(BAC), t.pm.u, t.pm.s],
      ),
    )
  ).rows[0]!.id;
  await withTenant(apiPool, t.org, (c) =>
    c.query("INSERT INTO org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id) VALUES ($1, $2, $3, $4)", [
      t.org,
      v2,
      t.tc.u,
      t.tc.s,
    ]),
  );
  const { rows } = await withTenant(apiPool, t.org, (c) => c.query<{ b: boolean }>("SELECT public.to_chuc_da_bat_s3($1) AS b", [t.org]));
  expect(rows[0]?.b, "dàn cảnh: tổ chức phải ĐÃ BẬT").toBe(true);
}

async function goiNhap(t: ToChuc): Promise<string> {
  const rfqId = await withTenant(apiPool, t.org, async (c) =>
    (await createRfq(c, t.org, { title: "Mua thep tam", deadlineAt: MAI_SAU, createdBySessionId: t.pm.s })).id,
  );
  await withTenant(apiPool, t.org, async (c) => {
    await setRfqBudget(c, t.org, { rfqId, estimatedValue: "1000000.00", currency: "VND", actorSessionId: t.pm.s });
    await addRfqItem(c, t.org, { rfqId, lineNo: 1, description: "Thep tam SS400 3mm", quantity: "100.0000", unit: "tam", actorSessionId: t.pm.s });
  });
  return rfqId;
}

/** Nộp duyệt → một chữ ký của người khác người tạo → mở gói, bằng hàm gói thật. */
async function moGoi(t: ToChuc, rfqId: string): Promise<void> {
  await withTenant(apiPool, t.org, (c) => submitRfqForApproval(c, t.org, { rfqId, actorSessionId: t.pm.s }, apiPool));
  await withTenant(apiPool, t.org, async (c) => {
    // [S1.194 / khoản 256] Lời duyệt mang lần nộp vừa đọc — tổ chức đã bật đòi nó.
    const lan = (await c.query<{ n: number }>("SELECT lan_nop AS n FROM public.rfq_packages WHERE id = $1", [rfqId])).rows[0]!.n;
    await approveRfq(c, t.org, { rfqId, sessionId: t.pm2.s, lanNopDaXem: lan }, apiPool);
  });
  await withTenant(apiPool, t.org, (c) => openRfq(c, t.org, { rfqId, actorSessionId: t.pm.s, orgKeys: boBocGia }, apiPool));
}

/** Một nhà cung cấp, một người liên hệ, một lời mời kênh EMAIL — bằng hàm gói thật. */
async function loiMoi(t: ToChuc, rfqId: string): Promise<string> {
  const ncc = await motId(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [t.org, `NCC ${randomBytes(3).toString("hex")}`, t.pm.u, t.pm.s],
  );
  const duoi = randomBytes(6).toString("hex");
  const lh = await motId(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4, $5, $6) RETURNING id",
    [t.org, ncc, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1"), t.pm.u, t.pm.s],
  );
  return withTenant(apiPool, t.org, async (c) =>
    (await createInvitation(c, t.org, { rfqId, supplierId: ncc, contactId: lh, linkChannel: "EMAIL", actorSessionId: t.pm.s })).id,
  );
}

const ducToken = (t: ToChuc, invitationId: string): Promise<string> =>
  withTenant(apiPool, t.org, async (c) => (await issueMagicLinkToken(c, t.org, { invitationId, actorSessionId: t.pm.s })).token);

const doiLink = (t: ToChuc, token: string): Promise<unknown> => withTenant(apiPool, t.org, (c) => redeemMagicLink(c, t.org, token));

const xinOtp = (t: ToChuc, token: string, nguoiGoi: string) =>
  withTenant(apiPool, t.org, (c) => issueOtpChallenge(c, t.org, { token, channel: "SMS", callerFingerprint: nguoiGoi, pepper: PEPPER }));

async function loi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("S3.2b1 — K6 ở phía dùng: token đúc khi gói chưa mở thôi dùng được ở tổ chức đã bật (khoản 253)", () => {
  it("[INV-K6] token thời MVP1 của gói DRAFT: trước lần bật đổi link và xin OTP được; SAU lần bật cả ba đường từ chối — cùng MỘT thông báo", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const inv = await loiMoi(t, rfqId);
    const token = await ducToken(t, inv);

    // Đối chứng MVP1, TRƯỚC lần bật: đường dùng mở. Thách thức OTP phát ở đây để lát nữa đo đường XÁC MINH.
    expect(await loi(doiLink(t, token))).toBeNull();
    const thachThuc = await xinOtp(t, token, "ip-253-a");
    if (!thachThuc.ok) throw new Error("dàn cảnh: thách thức phải phát được trước lần bật");

    await batS3(t);
    expect(await loi(doiLink(t, token)), "đổi link").toBe(LOI_TOKEN);
    expect(await loi(xinOtp(t, token, "ip-253-b")), "xin OTP").toBe(LOI_TOKEN);
    expect(
      await loi(withTenant(apiPool, t.org, (c) => verifyOtpAndStartSession(c, t.org, { token, code: thachThuc.code, pepper: PEPPER }))),
      "xác minh OTP bằng mã ĐÚNG của thách thức đã phát",
    ).toBe(LOI_TOKEN);
    const { rows } = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM guest_sessions WHERE invitation_id = $1", [inv]);
    expect(rows[0]?.n, "không phiên khách nào mở được").toBe("0");
  });

  it("[INV-K6] tổ chức đã bật, gói đã mở: token đúc sau lần mở đổi link, xin và xác minh OTP được — phiên khách mở", async () => {
    const t = await taoToChuc();
    await batS3(t);
    const rfqId = await goiNhap(t);
    const inv = await loiMoi(t, rfqId);
    await moGoi(t, rfqId);
    const token = await ducToken(t, inv);
    expect(await loi(doiLink(t, token))).toBeNull();
    const thachThuc = await xinOtp(t, token, "ip-253-c");
    if (!thachThuc.ok) throw new Error("thách thức phải phát được");
    const vao = await withTenant(apiPool, t.org, (c) => verifyOtpAndStartSession(c, t.org, { token, code: thachThuc.code, pepper: PEPPER }));
    expect(vao.ok).toBe(true);
  });

  it("[INV-K6] ĐỐI CHỨNG MVP1: tổ chức CHƯA bật thì token đúc ở DRAFT vẫn đổi link được — vế `NOT to_chuc_da_bat_s3` giữ nguyên MVP1", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const token = await ducToken(t, await loiMoi(t, rfqId));
    const { rows } = await db.pool.query<{ d: boolean }>(
      "SELECT duc_khi_goi_da_mo AS d FROM rfq_invitation_tokens WHERE invitation_id IN (SELECT id FROM rfq_invitations WHERE rfq_id = $1)",
      [rfqId],
    );
    expect(rows.map((r) => r.d), "token này mang false").toEqual([false]);
    expect(await loi(doiLink(t, token))).toBeNull();
  });

  it("[INV-K6] ĐỘT BIẾN: đặt tay cột thành `true` trên token thời MVP1 thì nó đổi được sau lần bật — `docToken` đọc đúng cột ấy, không đọc gì khác", async () => {
    const t = await taoToChuc();
    const rfqId = await goiNhap(t);
    const inv = await loiMoi(t, rfqId);
    const token = await ducToken(t, inv);
    await batS3(t);
    expect(await loi(doiLink(t, token))).toBe(LOI_TOKEN);
    await db.pool.query("UPDATE rfq_invitation_tokens SET duc_khi_goi_da_mo = true WHERE invitation_id = $1", [inv]);
    try {
      expect(await loi(doiLink(t, token)), "cột là vế DUY NHẤT phân biệt hai token").toBeNull();
    } finally {
      await db.pool.query("UPDATE rfq_invitation_tokens SET duc_khi_goi_da_mo = false WHERE invitation_id = $1", [inv]);
    }
  });
});
