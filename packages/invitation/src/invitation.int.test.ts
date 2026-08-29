import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import {
  InvitationError,
  MAGIC_LINK_TOKEN_BYTES,
  OTP_MAX_FAILED_ATTEMPTS,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  revokeInvitation,
  verifyOtpAndStartSession,
  type Channel,
} from "./invitation.js";

// =============================================================================================
// S1.3 SAU REVIEW AN NINH — CHUỖI TẤN CÔNG CŨ NAY LÀ MỘT BỘ TEST
//
// Ba CRITICAL của bản trước đã được dựng lại thành phép đo và chúng chạy TRỌN. Bộ test này giữ
// NGUYÊN từng bước của chuỗi ấy và đảo chiều khẳng định: mỗi bước từng THÀNH CÔNG nay phải BỊ
// CHẶN, và mỗi phép chặn phải kèm một vế ĐỐI CHỨNG DƯƠNG — không có vế đó thì "chặn tất cả" cũng
// làm test xanh.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const ACTOR = { type: "SYSTEM" } as const;

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;
let supplierKhac: string;
/** Người liên hệ thuộc MỘT NHÀ CUNG CẤP KHÁC — dùng cho phép đo đối chứng của C2. */
let lienHeKhac: string;
let rfqA: string;

interface LoiMoiDaPhat {
  readonly invitationId: string;
  readonly token: string;
  readonly contactId: string;
}

/** Một nhà cung cấp mới, một người liên hệ mới, một lời mời, một token. */
async function moiMoi(linkChannel: Channel = "EMAIL"): Promise<LoiMoiDaPhat> {
  const ncc = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name) VALUES ($1, 'NCC tam') RETURNING id",
    [orgA],
  );
  const nccId = ncc.rows[0]?.id ?? "";
  const duoi = randomBytes(6).toString("hex");
  const lh = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone) " +
      "VALUES ($1, $2, 'Nguoi duoc moi', $3, $4) RETURNING id",
    [orgA, nccId, `lh${duoi}@vidu.vn`, `09${duoi.slice(0, 8)}`.replace(/[a-f]/g, "1")],
  );
  const contactId = lh.rows[0]?.id ?? "";

  return withTenant(apiPool, orgA, async (c) => {
    const loi = await createInvitation(c, orgA, {
      rfqId: rfqA,
      supplierId: nccId,
      contactId,
      linkChannel,
      actor: ACTOR,
    });
    const t = await issueMagicLinkToken(c, orgA, { invitationId: loi.id, actor: ACTOR });
    return { invitationId: loi.id, token: t.token, contactId };
  });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);

  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a'), " +
      "('Cong ty B', 'cong-ty-b') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  orgB = orgs.rows[1]?.id ?? "";

  const nguoi = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'buyer@vidu.vn', 'Nguoi mua') " +
      "RETURNING id",
    [orgA],
  );
  const buyer = nguoi.rows[0]?.id ?? "";

  const ncc = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name, tax_code) VALUES ($1, 'NCC khac', '0202020202') " +
      "RETURNING id",
    [orgA],
  );
  supplierKhac = ncc.rows[0]?.id ?? "";

  const lh = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone) " +
      "VALUES ($1, $2, 'Nguoi cua NCC khac', 'b@vidu.vn', '0900000002') RETURNING id",
    [orgA, supplierKhac],
  );
  lienHeKhac = lh.rows[0]?.id ?? "";

  // [H-1, 011] RFQ mang phiên của chính người tạo.
  const phien = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, buyer, randomBytes(32)],
  );
  const rfq = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, created_by, created_by_session_id) " +
      "VALUES ($1, 'RFQ de moi', now() + interval '7 days', $2, $3) RETURNING id",
    [orgA, buyer, phien.rows[0]?.id ?? ""],
  );
  rfqA = rfq.rows[0]?.id ?? "";

  expect([orgA, orgB, supplierKhac, lienHeKhac, rfqA].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

// =============================================================================================
// CHUỖI TẤN CÔNG CŨ — TỪNG BƯỚC, ĐẢO CHIỀU
// =============================================================================================
describe("chuỗi tấn công của review an ninh, nay bị chặn ở từng bước", () => {
  it("[C1] đích nhận OTP ĐỌC TỪ CSDL — chữ ký hàm không còn chỗ để khai", async () => {
    const { token, contactId } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-c1", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const { rows } = await db.pool.query<{ phone: string }>(
      "SELECT phone FROM supplier_contacts WHERE id = $1",
      [contactId],
    );
    expect(kq.contactId).toBe(contactId);
    expect(kq.destination).toBe(rows[0]?.phone);

    // Hàng thách thức GHI LẠI đích đã dùng — thứ bản trước không lưu, nên "không lớp nào, ở bất
    // kỳ thời điểm nào, biết mã đã đi tới đâu".
    const { rows: tt } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM invitation_otp_challenges " +
        " WHERE id = $1 AND destination_hash IS NOT NULL AND contact_id IS NOT NULL " +
        "   AND token_id IS NOT NULL",
      [kq.challengeId],
    );
    expect(tt[0]?.n).toBe("1");
  });

  it("[C1] ĐỐI CHỨNG: thách thức trỏ tới người liên hệ của NHÀ CUNG CẤP KHÁC bị CSDL từ chối", async () => {
    const { invitationId, token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-c1b", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    // Câu INSERT viết tay: khoá ngoại một mình chỉ đòi "có trong tổ chức", nên nó cho phép gửi
    // OTP tới người liên hệ của một nhà cung cấp KHÁC. Trigger ở 012 mới là lớp chặn.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id," +
            " channel, code_hash, expires_at) " +
            "VALUES ($1, $2, (SELECT token_id FROM invitation_otp_challenges WHERE id = $3), $4," +
            " 'SMS', decode(repeat('ab', 32), 'hex'), now() + interval '5 minutes')",
          [orgA, invitationId, kq.challengeId, lienHeKhac],
        ),
      ),
    ).rejects.toThrow(/Nguoi lien he khong thuoc nha cung cap duoc moi/);
  });

  it("[H1] token của MỘT lời mời khác không mở được thách thức này", async () => {
    const { token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-h1", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const khac = await moiMoi();
    const nham = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token: khac.token, code: kq.code, actor: ACTOR }),
    );
    expect(nham).toEqual({ ok: false, reason: "NO_CHALLENGE" });

    // Đối chứng dương: đúng token thì vào được.
    const dung = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(dung.ok).toBe(true);
  });

  it("[C2] danh tính đã xác thực là DẪN XUẤT từ chính thách thức", async () => {
    const { invitationId, token, contactId } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-c2", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const r = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    if (!r.ok) throw new Error("phải mở được phiên");
    expect(r.verifiedContactId).toBe(contactId);

    const { rows } = await db.pool.query<{ vc: string; cid: string; ch: string }>(
      "SELECT g.verified_contact_id AS vc, c.contact_id AS cid, g.verified_channel AS ch " +
        "  FROM guest_sessions g JOIN invitation_otp_challenges c ON c.id = g.challenge_id " +
        " WHERE g.invitation_id = $1",
      [invitationId],
    );
    expect(rows[0]?.vc).toBe(rows[0]?.cid);
    expect(rows[0]?.ch).toBe("SMS");
  });

  it("[C2] ĐỐI CHỨNG: phiên KHAI một danh tính khác bị CSDL từ chối, kể cả đi thẳng bằng SQL", async () => {
    const { invitationId, token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-c2b", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");
    await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query(
          "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash," +
            " verified_contact_id, verified_channel, expires_at) " +
            "VALUES ($1, $2, $3, decode(repeat('ef', 32), 'hex'), $4, 'SMS'," +
            " now() + interval '1 hour')",
          [orgA, invitationId, kq.challengeId, lienHeKhac],
        ),
      ),
    ).rejects.toThrow(/Danh tinh da xac thuc phai DAN XUAT tu thach thuc OTP/);
  });

  it("[C3] sau THU HỒI: token chết, và phiên đang sống bị thu hồi theo", async () => {
    const { invitationId, token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-c3", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");
    const phien = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(phien.ok).toBe(true);

    const daThuHoi = await withTenant(apiPool, orgA, (c) =>
      revokeInvitation(c, orgA, { invitationId, actor: ACTOR }),
    );
    expect(daThuHoi).toBe(true);

    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          token,
          channel: "SMS",
          callerFingerprint: "ip-c3b",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(InvitationError);

    // Phiên ĐANG SỐNG bị thu hồi theo — thứ bản trước hoàn toàn không chạm tới.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM guest_sessions " +
        " WHERE invitation_id = $1 AND revoked_at IS NULL",
      [invitationId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("[C3] thu hồi hai lần: lần sau trả `false` và KHÔNG ghi thêm sự kiện kiểm toán", async () => {
    const { invitationId } = await moiMoi();
    const lan1 = await withTenant(apiPool, orgA, (c) =>
      revokeInvitation(c, orgA, { invitationId, actor: ACTOR }),
    );
    const lan2 = await withTenant(apiPool, orgA, (c) =>
      revokeInvitation(c, orgA, { invitationId, actor: ACTOR }),
    );
    expect([lan1, lan2]).toEqual([true, false]);

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events " +
        " WHERE action = 'INVITATION_REVOKED' AND resource_id = $1",
      [invitationId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("[H3] khoá 5-lần-sai KHÔNG reset được bằng cách phát lại thách thức", async () => {
    const { token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-h3", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");
    const maSai = kq.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i++) {
      await withTenant(apiPool, orgA, (c) =>
        verifyOtpAndStartSession(c, orgA, { token, code: maSai, actor: ACTOR }),
      );
    }
    const biKhoa = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(biKhoa).toEqual({ ok: false, reason: "LOCKED_OUT" });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          token,
          channel: "SMS",
          callerFingerprint: "ip-h3b",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/dang bi khoa vi qua nhieu lan thu sai/);
  });

  it("[H5] magic link BỊ TIÊU THỤ khi phiên ra đời — không chơi lại được", async () => {
    const { token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-h5", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const truoc = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(truoc.invitationId).not.toBe("");

    await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );

    await expect(
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token)),
    ).rejects.toThrow(InvitationError);
  });

  it("[H5] thu hồi ĐƠN ĐIỆU — cờ đã bật không tắt lại được, kể cả bằng SQL", async () => {
    const { invitationId, token } = await moiMoi();
    await withTenant(apiPool, orgA, (c) =>
      revokeInvitation(c, orgA, { invitationId, actor: ACTOR }),
    );
    const bam = createHash("sha256").update(token, "utf8").digest();

    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("UPDATE rfq_invitation_tokens SET revoked_at = NULL WHERE token_hash = $1", [bam]),
      ),
    ).rejects.toThrow(/revoked_at da bat thi khong duoc tat lai/);
  });
});

// =============================================================================================
// NHÓM E — NAY CÓ ĐỦ LỚP ĐỂ MANG NHÃN
// =============================================================================================
describe("[INV-E1] token của magic link", () => {
  it("entropy ≥ 128 bit từ CSPRNG, và hai lần phát KHÔNG trùng nhau", async () => {
    expect(MAGIC_LINK_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    const a = await moiMoi();
    const b = await moiMoi();
    expect(Buffer.from(a.token, "base64url").length).toBe(MAGIC_LINK_TOKEN_BYTES);
    expect(a.token).not.toBe(b.token);
  });

  it("lưu dạng HASH — token dạng rõ KHÔNG xuất hiện ở BẤT KỲ cột nào của hàng", async () => {
    const { token } = await moiMoi();
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_invitation_tokens t " +
        " WHERE to_jsonb(t)::text LIKE '%' || $1 || '%'",
      [token],
    );
    expect(rows[0]?.n).toBe("0");
    const { rows: khop } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_invitation_tokens WHERE token_hash = $1",
      [createHash("sha256").update(token, "utf8").digest()],
    );
    expect(khop[0]?.n).toBe("1");
  });

  it("ĐƠN MỤC ĐÍCH — lược đồ từ chối một `purpose` ngoài tập đóng", async () => {
    const { invitationId } = await moiMoi();
    await expect(
      db.pool.query(
        "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at)" +
          " VALUES ($1, $2, decode(repeat('ab', 32), 'hex'), 'DOC_MOI_THU', now() + interval '1 day')",
        [orgA, invitationId],
      ),
    ).rejects.toThrow(/purpose/);
  });

  it("CÓ HẠN — token hết hạn thì chết, và TTL có TRẦN TRÊN", async () => {
    const { invitationId, token } = await moiMoi();
    await db.pool.query(
      "UPDATE rfq_invitation_tokens SET created_at = now() - interval '1 hour', " +
        "       expires_at = now() - interval '1 minute' WHERE invitation_id = $1",
      [invitationId],
    );
    await expect(
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token)),
    ).rejects.toThrow(InvitationError);

    // `CHECK (expires_at > created_at)` chỉ chặn cận DƯỚI: một cấu hình sai đặt TTL = 10^9 làm vế
    // "có hạn" của E1 biến mất trong im lặng. Cùng bài học với `MFA_MAX_ALLOWED_FAILED_ATTEMPTS`.
    const khac = await moiMoi();
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueMagicLinkToken(c, orgA, {
          invitationId: khac.invitationId,
          ttlSeconds: 1_000_000_000,
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(InvitationError);
  });

  it("THU HỒI ĐƯỢC — và thu hồi chạm CẢ token, thách thức, LẪN phiên", async () => {
    const { invitationId, token } = await moiMoi();
    const truoc = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(truoc.invitationId).toBe(invitationId);

    await withTenant(apiPool, orgA, (c) =>
      revokeInvitation(c, orgA, { invitationId, actor: ACTOR }),
    );
    await expect(
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token)),
    ).rejects.toThrow(InvitationError);
  });

  it("bốn ca hỏng trả CÙNG một thông báo — không phân biệt được là không có oracle", async () => {
    const { invitationId, token } = await moiMoi();
    await db.pool.query(
      "UPDATE rfq_invitation_tokens SET created_at = now() - interval '1 hour', " +
        "       expires_at = now() - interval '1 minute' WHERE invitation_id = $1",
      [invitationId],
    );
    const bat = async (t: string): Promise<string> =>
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, t)).then(
        () => "KHONG NEM",
        (e: unknown) => (e as Error).message,
      );
    expect(await bat(token)).toBe(await bat("khong-phai-token-nao-ca"));
  });
});

describe("[INV-E2] token một mình KHÔNG đủ, và OTP phải trên kênh ĐÃ ĐĂNG KÝ", () => {
  it("đổi được magic link nhưng KHÔNG có phiên nào ra đời", async () => {
    const { invitationId, token } = await moiMoi();
    const doi = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(doi.invitationId).toBe(invitationId);

    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM guest_sessions WHERE invitation_id = $1",
      [invitationId],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("mã OTP SAI không sinh phiên; mã ĐÚNG thì có — phép hội, hai vế", async () => {
    const { token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-e2", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const sai = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        token,
        code: kq.code === "000000" ? "111111" : "000000",
        actor: ACTOR,
      }),
    );
    expect(sai.ok).toBe(false);

    const dung = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(dung.ok).toBe(true);
  });

  it("kênh quyết định CỘT nào được đọc — nhãn và sự thật là một thứ", async () => {
    const { token, contactId } = await moiMoi("SMS"); // link đi SMS ⇒ OTP phải đi EMAIL
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        token,
        channel: "EMAIL",
        callerFingerprint: "ip-kenh",
        actor: ACTOR,
      }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");
    const { rows } = await db.pool.query<{ email: string }>(
      "SELECT email FROM supplier_contacts WHERE id = $1",
      [contactId],
    );
    expect(kq.destination).toBe(rows[0]?.email);
  });

  it("người liên hệ chưa có kênh đã đăng ký thì BỊ TỪ CHỐI, không rơi về kênh khác", async () => {
    const lh = await db.pool.query<{ id: string }>(
      "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email) " +
        "VALUES ($1, $2, 'Khong co so', 'khongso@vidu.vn') RETURNING id",
      [orgA, supplierKhac],
    );
    const t = await withTenant(apiPool, orgA, async (c) => {
      const l = await createInvitation(c, orgA, {
        rfqId: rfqA,
        supplierId: supplierKhac,
        contactId: lh.rows[0]?.id ?? "",
        actor: ACTOR,
      });
      return issueMagicLinkToken(c, orgA, { invitationId: l.id, actor: ACTOR });
    });

    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          token: t.token,
          channel: "SMS",
          callerFingerprint: "ip-thieu-kenh",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/chưa có kênh đã đăng ký/);
  });
});

describe("ADR-015 mục 1 — OTP không bao giờ đi cùng kênh với magic link", () => {
  it("link EMAIL + OTP EMAIL bị CSDL từ chối", async () => {
    const { token } = await moiMoi("EMAIL");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          token,
          channel: "EMAIL",
          callerFingerprint: "ip-k1",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/OTP khong duoc di cung kenh voi magic link/);
  });

  it("link SMS + OTP SMS CŨNG bị từ chối — lớp này so HAI KÊNH, không cấm cứng EMAIL", async () => {
    const { token } = await moiMoi("SMS");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          token,
          channel: "SMS",
          callerFingerprint: "ip-k2",
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(/OTP khong duoc di cung kenh voi magic link/);
  });
});

describe("[INV-E3] OTP — năm vế", () => {
  it("HẾT HẠN: thách thức quá hạn bị từ chối dù mã đúng", async () => {
    const { invitationId, token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-hh", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    await db.pool.query(
      "UPDATE invitation_otp_challenges SET created_at = now() - interval '1 hour', " +
        "       expires_at = now() - interval '1 minute' WHERE invitation_id = $1",
      [invitationId],
    );
    const r = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(r).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("DÙNG MỘT LẦN: mã đúng lần thứ hai không vào được nữa", async () => {
    const { token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-ml", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const lan1 = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(lan1.ok).toBe(true);

    // Token cũng đã bị tiêu thụ (H5), nên lần hai chết ngay ở lớp token — sớm hơn một bậc.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
      ),
    ).rejects.toThrow(InvitationError);
  });

  it("GIỚI HẠN SỐ LẦN THỬ: sau 5 lần sai thì khoá, và mã ĐÚNG cũng không vào được", async () => {
    const { token } = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-lt", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");
    const maSai = kq.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i++) {
      await withTenant(apiPool, orgA, (c) =>
        verifyOtpAndStartSession(c, orgA, { token, code: maSai, actor: ACTOR }),
      );
    }
    const sau = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    expect(sau).toEqual({ ok: false, reason: "LOCKED_OUT" });
  });

  it("GIỚI HẠN TẦN SUẤT theo LỜI MỜI: bucket kẻ tấn công KHÔNG xoay được", async () => {
    // `callerFingerprint` đổi mỗi lần — bản trước sẽ không bao giờ chạm trần vì bucket theo người
    // gọi là chuỗi do người gọi chọn. Bucket theo LỜI MỜI thì không xoay được.
    const { token } = await moiMoi();
    let biChan = false;
    for (let i = 0; i < 12; i++) {
      const r = await withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          token,
          channel: "SMS",
          callerFingerprint: `ip-xoay-${String(i)}`,
          actor: ACTOR,
        }),
      ).catch((e: unknown) => e as Error);
      if (r instanceof Error) {
        expect(r.message).toMatch(/vượt giới hạn tần suất/);
        biChan = true;
        break;
      }
    }
    expect(biChan, "xoay callerFingerprint phải chạm một trần nào đó").toBe(true);
  });
});

describe("[INV-E5] link chuyển tiếp, và danh tính THỰC TẾ đã xác thực", () => {
  it("người nhận link chuyển tiếp vẫn vào được, và phiên ghi NGƯỜI GIỮ KÊNH đã nhận mã", async () => {
    const { invitationId, token, contactId } = await moiMoi();
    // Link được chuyển tiếp: một người khác cầm token và đổi được nó. Hành vi ĐƯỢC THIẾT KẾ.
    const doi = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(doi.invitationId).toBe(invitationId);

    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, { token, channel: "SMS", callerFingerprint: "ip-e5", actor: ACTOR }),
    );
    if (!kq.ok) throw new Error("thách thức phải phát được");

    const r = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, { token, code: kq.code, actor: ACTOR }),
    );
    if (!r.ok) throw new Error("phải mở được phiên");
    expect(r.verifiedContactId).toBe(contactId);

    const { rows } = await db.pool.query<{ payload: { verifiedContactId?: string } }>(
      "SELECT payload FROM audit_events WHERE action = 'GUEST_SESSION_STARTED' " +
        "  AND org_id = $1 ORDER BY seq DESC LIMIT 1",
      [orgA],
    );
    expect(rows[0]?.payload.verifiedContactId).toBe(contactId);
  });
});

describe("cô lập tổ chức", () => {
  it("[INV-F1] token của tổ chức A không đổi được từ phiên của tổ chức B", async () => {
    const { token } = await moiMoi();
    await expect(
      withTenant(apiPool, orgB, (c) => redeemMagicLink(c, orgB, token)),
    ).rejects.toThrow(InvitationError);
  });
});
