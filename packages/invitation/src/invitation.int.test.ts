import { createHash } from "node:crypto";
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
  OTP_MAX_PER_CALLER,
  OTP_MAX_PER_DEST,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  revokeInvitation,
  verifyOtpAndStartSession,
  type Channel,
} from "./invitation.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const ACTOR = { type: "SYSTEM" } as const;

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;
let supplierA: string;
/** `lienHe1` là người ĐƯỢC MỜI; `lienHe2` là đồng nghiệp — dùng cho phép đo E5. */
let lienHe1: string;
let lienHe2: string;
let rfqA: string;

/** Tạo một lời mời mới với kênh link cho trước. Mỗi test cần lời mời riêng (UNIQUE theo RFQ+NCC). */
async function moiMoi(linkChannel: Channel = "EMAIL"): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO suppliers (org_id, legal_name) VALUES ($1, 'NCC tam') RETURNING id",
    [orgA],
  );
  const ncc = rows[0]?.id ?? "";
  return withTenant(apiPool, orgA, async (c) => {
    const loi = await createInvitation(c, orgA, {
      rfqId: rfqA,
      supplierId: ncc,
      contactId: lienHe1,
      linkChannel,
      actor: ACTOR,
    });
    return loi.id;
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
    "INSERT INTO suppliers (org_id, legal_name, tax_code) VALUES ($1, 'NCC chinh', '0101010101') " +
      "RETURNING id",
    [orgA],
  );
  supplierA = ncc.rows[0]?.id ?? "";

  const lh = await db.pool.query<{ id: string }>(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone) VALUES " +
      "($1, $2, 'Nguoi duoc moi', 'a@vidu.vn', '0900000001'), " +
      "($1, $2, 'Dong nghiep', 'b@vidu.vn', '0900000002') RETURNING id",
    [orgA, supplierA],
  );
  lienHe1 = lh.rows[0]?.id ?? "";
  lienHe2 = lh.rows[1]?.id ?? "";

  const rfq = await db.pool.query<{ id: string }>(
    "INSERT INTO rfq_packages (org_id, title, deadline_at, created_by) " +
      "VALUES ($1, 'RFQ de moi', now() + interval '7 days', $2) RETURNING id",
    [orgA, buyer],
  );
  rfqA = rfq.rows[0]?.id ?? "";

  expect([orgA, orgB, supplierA, lienHe1, lienHe2, rfqA].filter((x) => x === "")).toEqual([]);
  apiPool = db.poolAs("app_api");
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[INV-E1] token của magic link", () => {
  it("entropy ≥ 128 bit từ CSPRNG, và hai lần phát KHÔNG trùng nhau", async () => {
    expect(MAGIC_LINK_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);

    const a = await moiMoi();
    const b = await moiMoi();
    const [t1, t2] = await withTenant(apiPool, orgA, async (c) => [
      await issueMagicLinkToken(c, orgA, { invitationId: a }),
      await issueMagicLinkToken(c, orgA, { invitationId: b }),
    ]);

    expect(Buffer.from(t1.token, "base64url").length).toBe(MAGIC_LINK_TOKEN_BYTES);
    expect(t1.token).not.toBe(t2.token);
  });

  it("lưu dạng HASH — token dạng rõ KHÔNG xuất hiện ở BẤT KỲ cột nào của hàng", async () => {
    const inv = await moiMoi();
    const { token } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );

    // Không kiểm một cột đã biết tên: `to_jsonb(hàng)` biến TOÀN BỘ hàng thành văn bản, nên một
    // cột MỚI thêm vào sau này mà lỡ chứa token dạng rõ cũng bị bắt. Kiểm theo tính chất, không
    // theo danh sách tên — khuôn đã hỏng ba lần ở S0.
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_invitation_tokens t " +
        " WHERE to_jsonb(t)::text LIKE '%' || $1 || '%'",
      [token],
    );
    expect(rows[0]?.n).toBe("0");

    // ... và dấu hiệu TÍCH CỰC rằng hàng có thật và hash đúng — không có vế này, "0" ở trên cũng
    // đúng với một bảng rỗng.
    const bam = createHash("sha256").update(token, "utf8").digest();
    const { rows: khop } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM rfq_invitation_tokens WHERE token_hash = $1",
      [bam],
    );
    expect(khop[0]?.n).toBe("1");
  });

  it("ĐƠN MỤC ĐÍCH — lược đồ từ chối một `purpose` ngoài tập đóng", async () => {
    const inv = await moiMoi();
    await expect(
      db.pool.query(
        "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at)" +
          " VALUES ($1, $2, decode(repeat('ab', 32), 'hex'), 'DOC_MOI_THU', now() + interval '1 day')",
        [orgA, inv],
      ),
    ).rejects.toThrow(/purpose/);
  });

  it("CÓ HẠN — token hết hạn không đổi được nữa", async () => {
    const inv = await moiMoi();
    const { token, tokenId } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );
    await db.pool.query(
      "UPDATE rfq_invitation_tokens SET created_at = now() - interval '1 hour', " +
        "       expires_at = now() - interval '1 minute' WHERE id = $1",
      [tokenId],
    );

    await expect(
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token)),
    ).rejects.toThrow(InvitationError);
  });

  it("THU HỒI ĐƯỢC — sau khi thu hồi lời mời, token chết", async () => {
    const inv = await moiMoi();
    const { token } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );
    // Dấu hiệu tích cực: nó SỐNG trước khi bị thu hồi.
    const truoc = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(truoc.invitationId).toBe(inv);

    await withTenant(apiPool, orgA, (c) =>
      revokeInvitation(c, orgA, { invitationId: inv, actor: ACTOR }),
    );
    await expect(
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token)),
    ).rejects.toThrow(InvitationError);
  });

  it("ba ca hỏng — không tồn tại, hết hạn, đã thu hồi — trả CÙNG một thông báo", async () => {
    // Phân biệt được ba ca là một oracle trên chính tập token: "chuỗi này từng là token thật".
    const inv = await moiMoi();
    const { token, tokenId } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );
    await db.pool.query(
      "UPDATE rfq_invitation_tokens SET created_at = now() - interval '1 hour', " +
        "       expires_at = now() - interval '1 minute' WHERE id = $1",
      [tokenId],
    );

    const bat = async (t: string): Promise<string> =>
      withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, t)).then(
        () => "KHONG NEM",
        (e: unknown) => (e as Error).message,
      );

    expect(await bat(token)).toBe(await bat("khong-phai-token-nao-ca"));
  });
});

describe("[INV-E2] token một mình KHÔNG đủ vào phiên báo giá", () => {
  it("đổi được magic link nhưng KHÔNG có phiên nào ra đời — phép đo của mệnh đề HỘI", async () => {
    const inv = await moiMoi();
    const { token } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );

    const doi = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(doi.invitationId).toBe(inv);

    // Vế thứ hai của phép hội, và nó là vế mà một hệ thống viết ẩu sẽ bỏ: SAU khi đổi link thành
    // công, số phiên khách vẫn là 0. Không có đường nào từ "có token" tới "có phiên".
    const { rows } = await db.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM guest_sessions WHERE invitation_id = $1",
      [inv],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("mã OTP SAI cũng không sinh phiên; mã ĐÚNG thì có — hai vế của cùng một phép đo", async () => {
    const inv = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: inv,
        channel: "SMS",
        destination: "0900001001",
        callerFingerprint: "ip-1",
      }),
    );
    if (!kq.ok) throw new Error("thách thức OTP phải phát được");

    const sai = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code === "000000" ? "111111" : "000000",
        verifiedContactId: lienHe1,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(sai.ok).toBe(false);

    const dung = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code,
        verifiedContactId: lienHe1,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(dung.ok).toBe(true);
  });
});

describe("ADR-015 mục 1 — OTP không bao giờ đi cùng kênh với magic link", () => {
  it("link EMAIL + OTP EMAIL bị CSDL từ chối", async () => {
    const inv = await moiMoi("EMAIL");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          invitationId: inv,
          channel: "EMAIL",
          destination: "a@vidu.vn",
          callerFingerprint: "ip-kenh-1",
        }),
      ),
    ).rejects.toThrow(/OTP khong duoc di cung kenh voi magic link/);
  });

  it("link SMS + OTP SMS CŨNG bị từ chối — lớp này so HAI KÊNH, không cấm cứng EMAIL", async () => {
    // Đây là phép đo phân biệt hai thiết kế. Một `CHECK (channel <> 'EMAIL')` sẽ CHO QUA ca này
    // trong khi bất biến đã vỡ — nó giữ mệnh đề bằng một sự trùng hợp về việc hôm nay link đi
    // bằng email.
    const inv = await moiMoi("SMS");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          invitationId: inv,
          channel: "SMS",
          destination: "0900001005",
          callerFingerprint: "ip-kenh-2",
        }),
      ),
    ).rejects.toThrow(/OTP khong duoc di cung kenh voi magic link/);
  });

  it("link SMS + OTP EMAIL thì ĐƯỢC — đối chứng dương, chống quy tắc chặn-tất-cả", async () => {
    const inv = await moiMoi("SMS");
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: inv,
        channel: "EMAIL",
        destination: "a@vidu.vn",
        callerFingerprint: "ip-kenh-3",
      }),
    );
    expect(kq.ok).toBe(true);
  });
});

describe("[INV-E3] OTP — năm vế", () => {
  it("giới hạn SỐ LẦN THỬ: sau 5 lần sai thì khoá, và mã ĐÚNG cũng không vào được", async () => {
    const inv = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: inv,
        channel: "SMS",
        destination: "0900001002",
        callerFingerprint: "ip-thu",
      }),
    );
    if (!kq.ok) throw new Error("thách thức OTP phải phát được");
    const maSai = kq.code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i++) {
      await withTenant(apiPool, orgA, (c) =>
        verifyOtpAndStartSession(c, orgA, {
          invitationId: inv,
          code: maSai,
          verifiedContactId: lienHe1,
          verifiedChannel: "SMS",
          actor: ACTOR,
        }),
      );
    }

    const sauKhiKhoa = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code,
        verifiedContactId: lienHe1,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(sauKhiKhoa).toEqual({ ok: false, reason: "LOCKED_OUT" });
  });

  it("HẾT HẠN: thách thức quá hạn bị từ chối dù mã đúng", async () => {
    const inv = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: inv,
        channel: "SMS",
        destination: "0900001003",
        callerFingerprint: "ip-hethan",
      }),
    );
    if (!kq.ok) throw new Error("thách thức OTP phải phát được");

    await db.pool.query(
      "UPDATE invitation_otp_challenges SET created_at = now() - interval '1 hour', " +
        "       expires_at = now() - interval '1 minute' WHERE invitation_id = $1",
      [inv],
    );

    const r = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code,
        verifiedContactId: lienHe1,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(r).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("DÙNG MỘT LẦN: mã đúng lần thứ hai bị từ chối", async () => {
    const inv = await moiMoi();
    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: inv,
        channel: "SMS",
        destination: "0900001004",
        callerFingerprint: "ip-motlan",
      }),
    );
    if (!kq.ok) throw new Error("thách thức OTP phải phát được");

    const lan1 = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code,
        verifiedContactId: lienHe1,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(lan1.ok).toBe(true);

    const lan2 = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code,
        verifiedContactId: lienHe1,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(lan2).toEqual({ ok: false, reason: "ALREADY_USED" });
  });

  it("GIỚI HẠN TẦN SUẤT theo ĐÍCH: chạm trần thì LÀM CHẬM, KHÔNG khoá và KHÔNG ném", async () => {
    const dich = "0900009999";
    const invs: string[] = [];
    for (let i = 0; i <= OTP_MAX_PER_DEST; i++) invs.push(await moiMoi());

    const kq = [];
    for (let i = 0; i <= OTP_MAX_PER_DEST; i++) {
      kq.push(
        await withTenant(apiPool, orgA, (c) =>
          issueOtpChallenge(c, orgA, {
            invitationId: invs[i] as string,
            channel: "SMS",
            destination: dich,
            callerFingerprint: `ip-dich-${String(i)}`,
          }),
        ),
      );
    }

    expect(kq.slice(0, OTP_MAX_PER_DEST).every((r) => r.ok)).toBe(true);
    const cuoi = kq[OTP_MAX_PER_DEST];
    expect(cuoi?.ok).toBe(false);
    expect(cuoi?.ok === false ? cuoi.reason : null).toBe("DEST_RATE_LIMITED");
  });

  it("ĐỐI CHỨNG: xoá bộ đếm đi thì chính lời gọi ấy ĐI QUA — bộ đếm là thứ đang chặn", async () => {
    const dich = "0900008888";
    const invs: string[] = [];
    for (let i = 0; i <= OTP_MAX_PER_DEST; i++) invs.push(await moiMoi());

    for (let i = 0; i < OTP_MAX_PER_DEST; i++) {
      await withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          invitationId: invs[i] as string,
          channel: "SMS",
          destination: dich,
          callerFingerprint: `ip-dc-${String(i)}`,
        }),
      );
    }

    const biChan = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: invs[OTP_MAX_PER_DEST] as string,
        channel: "SMS",
        destination: dich,
        callerFingerprint: "ip-dc-cuoi",
      }),
    );
    expect(biChan.ok).toBe(false);

    // Vô hiệu hoá lớp: xoá bộ đếm. Không có phép đo này, test trên xanh kể cả khi thứ chặn là một
    // thứ khác — E3(2) là vế CHƯA TỪNG CÓ một dòng mã nào trong toàn S0, nên nó là vế cần bằng
    // chứng nhất.
    await db.pool.query("DELETE FROM otp_rate_limits WHERE org_id = $1", [orgA]);
    const saiKhiXoa = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: invs[OTP_MAX_PER_DEST] as string,
        channel: "SMS",
        destination: dich,
        callerFingerprint: "ip-dc-cuoi-2",
      }),
    );
    expect(saiKhiXoa.ok).toBe(true);
  });

  it("GIỚI HẠN TẦN SUẤT theo NGƯỜI GỌI: chạm trần thì KHOÁ — ném, không trả nhánh", async () => {
    const nguoiGoi = "ip-ke-tan-cong";
    const invs: string[] = [];
    for (let i = 0; i <= OTP_MAX_PER_CALLER; i++) invs.push(await moiMoi());

    for (let i = 0; i < OTP_MAX_PER_CALLER; i++) {
      await withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          invitationId: invs[i] as string,
          channel: "SMS",
          // Mỗi lần một đích khác nhau: nếu dùng chung đích thì hạn mức ĐÍCH sẽ chạm trước và
          // phép đo này sẽ đo nhầm lớp.
          destination: `09000${String(70000 + i)}`,
          callerFingerprint: nguoiGoi,
        }),
      );
    }

    await expect(
      withTenant(apiPool, orgA, (c) =>
        issueOtpChallenge(c, orgA, {
          invitationId: invs[OTP_MAX_PER_CALLER] as string,
          channel: "SMS",
          destination: "0900079999",
          callerFingerprint: nguoiGoi,
        }),
      ),
    ).rejects.toThrow(/gioi han tan suat theo nguoi goi|giới hạn tần suất theo người gọi/);
  });
});

describe("[INV-E5] link chuyển tiếp, và danh tính THỰC TẾ đã xác thực", () => {
  it("người nhận link chuyển tiếp vẫn vào được, nhưng phiên ghi người GIỮ KÊNH đã xác thực", async () => {
    const inv = await moiMoi();
    const { token } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );

    // Link được chuyển tiếp: người khác cầm token và đổi được nó. Đây là hành vi ĐƯỢC THIẾT KẾ.
    const doi = await withTenant(apiPool, orgA, (c) => redeemMagicLink(c, orgA, token));
    expect(doi.contactId).toBe(lienHe1);

    const kq = await withTenant(apiPool, orgA, (c) =>
      issueOtpChallenge(c, orgA, {
        invitationId: inv,
        channel: "SMS",
        destination: "0900000002",
        callerFingerprint: "ip-e5",
      }),
    );
    if (!kq.ok) throw new Error("thách thức OTP phải phát được");

    const r = await withTenant(apiPool, orgA, (c) =>
      verifyOtpAndStartSession(c, orgA, {
        invitationId: inv,
        code: kq.code,
        // Người THỰC TẾ giữ kênh và nhận mã là `lienHe2`, KHÁC với người được mời `lienHe1`.
        verifiedContactId: lienHe2,
        verifiedChannel: "SMS",
        actor: ACTOR,
      }),
    );
    expect(r.ok).toBe(true);

    const { rows } = await db.pool.query<{ verified_contact_id: string; contact_id: string }>(
      "SELECT g.verified_contact_id, i.contact_id FROM guest_sessions g " +
        "  JOIN rfq_invitations i ON i.id = g.invitation_id WHERE g.invitation_id = $1",
      [inv],
    );
    // Hai cột KHÁC nhau, và đó chính là mệnh đề: hệ thống ghi danh tính đã xác thực, không ghi
    // danh tính người được mời.
    expect(rows[0]?.verified_contact_id).toBe(lienHe2);
    expect(rows[0]?.contact_id).toBe(lienHe1);
    expect(rows[0]?.verified_contact_id).not.toBe(rows[0]?.contact_id);

    const { rows: so } = await db.pool.query<{ payload: { verifiedContactId?: string } }>(
      "SELECT payload FROM audit_events WHERE action = 'GUEST_SESSION_STARTED' " +
        "  AND org_id = $1 ORDER BY seq DESC LIMIT 1",
      [orgA],
    );
    expect(so[0]?.payload.verifiedContactId).toBe(lienHe2);
  });
});

describe("cô lập tổ chức", () => {
  it("[INV-F1] token của tổ chức A không đổi được từ phiên của tổ chức B", async () => {
    const inv = await moiMoi();
    const { token } = await withTenant(apiPool, orgA, (c) =>
      issueMagicLinkToken(c, orgA, { invitationId: inv }),
    );
    await expect(
      withTenant(apiPool, orgB, (c) => redeemMagicLink(c, orgB, token)),
    ).rejects.toThrow(InvitationError);
  });
});
