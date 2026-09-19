// ==============================================================================================
// tools/gieo-demo — GIEO MỘT VÒNG THẦU ĐỦ ĐỂ DEMO, RỒI IN RA NĂM ĐƯỜNG LINK
//
//   pnpm gieo:demo
//
// [ADR-044] Vì sao có công cụ này thay vì làm mọi thứ qua giao diện: tạo một RFQ đầy đủ là bảy
// màn hình (tổ chức, chính sách, người dùng, nhà cung cấp, người liên hệ, gói thầu, hạng mục,
// duyệt, mời) và **không màn nào trong số đó chạm một USP nào**. Lát cắt demo đặt giao diện đúng
// ở hai chỗ sản phẩm này khác phần còn lại của thị trường — niêm phong ở máy nhà cung cấp, và mở
// thầu hai người duyệt — còn phần dựng bối cảnh thì gieo bằng script.
//
// CÔNG CỤ NÀY KHÔNG PHẢI MỘT ĐƯỜNG SẢN XUẤT, và nó tự chặn mình bằng ba điều:
//   ⑴ nó đòi một biến môi trường RIÊNG (`TRUSTPROCURE_SEED_DATABASE_URL`) chứ không mượn biến của
//      `apps/api` — một người vận hành phải CỐ Ý trỏ nó vào một cụm;
//   ⑵ nó in ra token dạng rõ ra màn hình, nên nó không bao giờ được chạy ở nơi log bị thu thập;
//   ⑶ nó không xoá gì, không sửa gì có sẵn — chỉ thêm một tổ chức mới mỗi lần chạy.
//
// Nó dùng ĐÚNG các hàm sản phẩm cho mọi thứ có bất biến: `createInvitation`, `issueMagicLinkToken`,
// `issueRfqKeyPair`, `issueLoginToken`. Chỉ những hàng không có cửa nghiệp vụ (tổ chức, người
// dùng, vai trò, phiên của người gieo) mới được chèn bằng SQL thẳng — đúng cách các test tích hợp
// của kho vẫn dựng bối cảnh.
// ==============================================================================================

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createLocalDevWrapper, MasterKeyRing } from "@trustprocure/crypto-keys";
import { createPool, migrate } from "@trustprocure/db";
import { issueLoginToken } from "@trustprocure/identity";
import { createInvitation, issueMagicLinkToken } from "@trustprocure/invitation";
import { issueRfqKeyPair } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

class GieoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GieoError";
  }
}

function bat(ten: string): string {
  const v = process.env[ten];
  if (v === undefined || v.trim() === "") throw new GieoError(`${ten}: thiếu`);
  return v.trim();
}

/** Cùng định dạng `<phiên bản>=<base64>,...` với `apps/api/src/cau-hinh.ts`. */
function docVongKhoa(): MasterKeyRing {
  const tho = bat("TRUSTPROCURE_MASTER_KEYS");
  const active = bat("TRUSTPROCURE_MASTER_KEY_ACTIVE");
  const keys: Record<string, Buffer> = {};
  for (const muc of tho.split(",")) {
    const m = muc.trim();
    if (m === "") continue;
    const dau = m.indexOf("=");
    if (dau <= 0) throw new GieoError("TRUSTPROCURE_MASTER_KEYS: mỗi mục phải có dạng <phiên bản>=<base64>");
    const byte = Buffer.from(m.slice(dau + 1).trim(), "base64");
    if (byte.length !== 32) throw new GieoError(`TRUSTPROCURE_MASTER_KEYS: phiên bản "${m.slice(0, dau)}" phải dài 32 byte`);
    keys[m.slice(0, dau).trim()] = byte;
  }
  if (!Object.hasOwn(keys, active)) throw new GieoError("TRUSTPROCURE_MASTER_KEY_ACTIVE: không có trong TRUSTPROCURE_MASTER_KEYS");
  return new MasterKeyRing(active, keys);
}

const HANG_MUC: readonly { readonly mo: string; readonly sl: string; readonly dvt: string }[] = [
  { mo: "Thep tam SS400 day 10mm", sl: "120.0000", dvt: "tam" },
  { mo: "Thep hop ma kem 50x50", sl: "800.0000", dvt: "cay" },
  { mo: "Bu long neo M24 cap 8.8", sl: "2400.0000", dvt: "bo" },
];

const NHA_CUNG_CAP: readonly string[] = ["Thep Dong Anh", "Kim khi Hai Phong", "Vat tu Truong Thanh"];

async function chinh(): Promise<void> {
  const url = bat("TRUSTPROCURE_SEED_DATABASE_URL");
  const vong = docVongKhoa();
  const gocWeb = process.env.TRUSTPROCURE_WEB_BASE?.trim() ?? "http://127.0.0.1:8090";
  const duoi = randomBytes(3).toString("hex");
  // Số điện thoại phải là SỐ: ràng buộc `supplier_contacts_phone_check` của 008 bác đuôi hex,
  // và nó bác ở lượt chạy thứ ba của script này.
  const soDienThoai = String(randomBytes(4).readUInt32BE(0) % 10000000).padStart(7, "0");

  const pool = createPool(url, 4);
  try {
    await migrate(pool, MIGRATIONS_DIR);

    const q = async <T extends Record<string, unknown>>(sql: string, tham: readonly unknown[] = []): Promise<T> => {
      const { rows } = await pool.query<T>(sql, [...tham]);
      const h = rows[0];
      if (h === undefined) throw new GieoError(`câu lệnh không trả hàng nào: ${sql.slice(0, 60)}`);
      return h;
    };

    const org = (await q<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`Cong ty Demo ${duoi}`, `demo-${duoi}`],
    )).id;

    // BA người, không phải hai — và con số ba là do PHÉP ĐO ép ra, không do em chọn.
    //
    // Lượt chạy thứ hai của script này gãy với đúng câu *"Nguoi tao RFQ khong duoc la mot trong
    // hai nguoi duyet (D2)"*: máy trạng thái ở tầng CSDL cưỡng chế nguyên tắc số 1 của
    // `docs/PRODUCT.md` — không cá nhân nào kiểm soát trọn chuỗi. Nên bối cảnh demo phải có một
    // người SOẠN và hai người DUYỆT khác người soạn. Giữ lại lời kể này vì một bối cảnh demo
    // dựng được bằng hai người sẽ là dấu hiệu luật ấy đã mất răng.
    const nguoiMua: { readonly email: string; readonly id: string; readonly sessionId: string }[] = [];
    for (const ten of ["soan", "duyet1", "duyet2"]) {
      const email = `${ten}.${duoi}@vidu.vn`;
      const id = (await q<{ id: string }>(
        "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
        [org, email, ten === "soan" ? "Nguoi soan goi thau" : `Nguoi duyet ${ten.slice(-1)}`],
      )).id;
      // VAI khác nhau, và sự khác nhau ấy là Separation of Duties ở dạng dữ liệu: `005` cấp
      // `rfq.unseal` cho PROCUREMENT_MANAGER (được YÊU CẦU mở thầu) nhưng `rfq.unseal.approve`
      // chỉ cho DIRECTOR (được PHÊ DUYỆT). Lượt chạy thử thứ tư gãy đúng ở đó với câu
      // "khong co quyen" khi một PROCUREMENT_MANAGER bấm phê duyệt.
      const vai = ten === "soan" ? "PROCUREMENT_MANAGER" : "DIRECTOR";
      await pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, vai]);
      // MỖI người mua một phiên riêng: mọi lần ghi có kiểm danh tính (013) đòi một phiên còn
      // sống, và `rfq_approvals` đòi một phiên KHÁC NHAU cho mỗi người duyệt — ràng buộc
      // `rfq_approvals_mot_phien_mot_lan` của 009 làm phép "một người bấm duyệt hai lần" bất khả
      // ở tầng CSDL, nên script này cũng phải tôn trọng nó.
      const sid = (await q<{ id: string }>(
        "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
          "VALUES ($1, $2, $3, now() + interval '2 hours', now()) RETURNING id",
        [org, id, randomBytes(32)],
      )).id;
      nguoiMua.push({ email, id, sessionId: sid });
    }
    const nguoiGieo = nguoiMua[0]?.id ?? "";
    const phienGieo = nguoiMua[0]?.sessionId ?? "";

    const chinhSach = (await q<{ id: string }>(
      "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
        "VALUES ($1, 1, '1000000000.00', 'VND', $2, $3) RETURNING id",
      [org, nguoiGieo, phienGieo],
    )).id;

    const rfq = (await q<{ id: string }>(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id) " +
        "VALUES ($1, $2, now() + interval '2 hours', true, $3, $4) RETURNING id",
      [org, `Goi thau vat tu ket cau ${duoi}`, nguoiGieo, phienGieo],
    )).id;
    for (const [i, hm] of HANG_MUC.entries()) {
      await pool.query(
        "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [org, rfq, i + 1, hm.mo, hm.sl, hm.dvt, nguoiGieo, phienGieo],
      );
    }
    await pool.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
        "VALUES ($1, $2, '9000000000.00', 'VND', $3, $4, $5)",
      [org, rfq, chinhSach, nguoiGieo, phienGieo],
    );
    await pool.query(
      "UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1",
      [rfq, nguoiGieo, phienGieo],
    );

    // HAI phê duyệt của HAI người khác nhau — ngân sách gieo ở trên vượt ngưỡng của chính sách,
    // nên máy trạng thái ở tầng CSDL từ chối mở gói thầu khi chưa đủ. Lượt chạy đầu của script
    // này gãy đúng ở đó (*"RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 0 (D2)"*) và
    // dòng dưới là bản vá; giữ lại lời kể vì nó là bằng chứng rằng luật ấy có răng thật.
    for (const nm of nguoiMua.slice(1)) {
      await pool.query(
        "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4)",
        [org, rfq, nm.id, nm.sessionId],
      );
    }

    const loiMoi: { readonly ten: string; readonly token: string }[] = [];
    await withTenant(pool, org, async (c) => {
      // Cặp khoá RFQ ra đời ở đây và khoá riêng được BỌC ngay — `issueRfqKeyPair` trả về mọi thứ
      // trừ nó (ADR-019). Script này không bao giờ cầm một khoá riêng dạng rõ.
      await issueRfqKeyPair(c, org, { rfqId: rfq, actorSessionId: phienGieo, wrapper: createLocalDevWrapper(vong) });
      await c.query(
        "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
        [rfq, nguoiGieo, phienGieo],
      );

      for (const [i, ten] of NHA_CUNG_CAP.entries()) {
        const ncc = (await c.query<{ id: string }>(
          "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
          [org, `${ten} ${duoi}`, nguoiGieo, phienGieo],
        )).rows[0]?.id ?? "";
        const lh = (await c.query<{ id: string }>(
          "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [org, ncc, `Nguoi bao gia ${i + 1}`, `ncc${i + 1}.${duoi}@vidu.vn`, `09${soDienThoai}${i}`.slice(0, 10), nguoiGieo, phienGieo],
        )).rows[0]?.id ?? "";
        const lm = await createInvitation(c, org, {
          rfqId: rfq,
          supplierId: ncc,
          contactId: lh,
          linkChannel: "EMAIL",
          actorSessionId: phienGieo,
        });
        const t = await issueMagicLinkToken(c, org, { invitationId: lm.id, actorSessionId: phienGieo });
        loiMoi.push({ ten, token: t.token });
      }
    });

    const tokenNguoiMua: { readonly email: string; readonly token: string }[] = [];
    for (const nm of nguoiMua) {
      const kq = await withTenant(pool, org, (c) => issueLoginToken(c, org, { email: nm.email }));
      if (!kq.ok) throw new GieoError(`không phát được token đăng nhập cho ${nm.email}`);
      tokenNguoiMua.push({ email: nm.email, token: kq.token });
    }

    const ra: string[] = [];
    ra.push("");
    ra.push("=== ĐÃ GIEO MỘT VÒNG THẦU ===");
    ra.push(`tổ chức : ${org}`);
    ra.push(`gói thầu: ${rfq}   (hạn nộp sau 2 giờ, cần HAI người duyệt để mở)`);
    ra.push("");
    ra.push("NHÀ CUNG CẤP — mở trên điện thoại, mỗi link một người:");
    for (const lm of loiMoi) ra.push(`  ${lm.ten.padEnd(24)} ${gocWeb}/nop-thau#${org}:${lm.token}`);
    ra.push("");
    ra.push("NGƯỜI MUA — lần đầu vào sẽ hiện bí mật TOTP để ghi danh. Mở thầu cần HAI người:");
    for (const nm of tokenNguoiMua) ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/mo-thau#${org}:${nm.token}`);
    ra.push("");
    ra.push(`mã gói thầu để dán vào bước 2 của màn người mua: ${rfq}`);
    ra.push("");
    ra.push("Mã OTP của nhà cung cấp đi tới hộp thư dev (TRUSTPROCURE_DEV_MAILBOX_DIR của apps/api).");
    // `console.error` là dòng ra DUY NHẤT dự án cho phép (eslint `no-console`), và ở một công cụ
    // dev thì stderr cũng đúng chỗ: nó không lẫn vào thứ ai đó đem đi pipe.
    console.error(ra.join("\n"));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

chinh().catch((e: unknown) => {
  console.error(`[gieo-demo] ${e instanceof Error ? `${e.name}: ${e.message}` : "loi khong ro"}`);
  process.exitCode = 1;
});
