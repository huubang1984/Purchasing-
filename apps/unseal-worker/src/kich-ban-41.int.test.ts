// =============================================================================================
// S1.9 — KỊCH BẢN MỤC 41 CHẠY TRỌN VẸN
//
// §7 mục 3 của đặc tả: *"RFQ 1 tỷ, 5 nhà cung cấp, có sửa giá trước deadline, đóng thầu, mở thầu
// có phê duyệt kép, sinh bảng so sánh"*, cộng §7 mục 4: *"nhận link → OTP → nộp → nhận biên nhận
// kiểm chứng được"*. Cả hai chạy trong MỘT file này, trên MỘT cơ sở dữ liệu, theo đúng thứ tự.
//
// ---------------------------------------------------------------------------------------------
// HAI CHỖ FILE NÀY KHÔNG LÀM ĐÚNG NHƯ ĐẶC TẢ VÀ KẾ HOẠCH VIẾT — NÓI RA TRƯỚC
// ---------------------------------------------------------------------------------------------
// ⑴ ĐẶC TẢ NÓI *"trên trình duyệt thật"*; đây là T3, không phải T4. Không có trình duyệt vì
//    không có trang nào để mở: `apps/` có đúng một worker. Thứ file này chứng minh là CHUỖI
//    NGHIỆP VỤ chạy được từ đầu tới cuối qua các cửa công khai THẬT của mọi gói — không một
//    câu SQL viết tay nào cho phần nghiệp vụ. Phần *"trình duyệt thật"* thuộc T4 và thuộc S2+.
//
// ⑵ KẾ HOẠCH S1 §2 xếp hạng mục này vào `tests/e2e`. File lại nằm ở `apps/unseal-worker/src/`,
//    và KHÔNG phải vì tiện tay: quy tắc `g1-khong-import-nguoc-tu-apps-unseal-worker` cấm MỌI
//    module ngoài thư mục này import `executeUnsealRequest`. Một kịch bản đi trọn tới bảng so
//    sánh thì PHẢI đi qua bước mở thầu, nên nó phải sống bên trong hàng rào.
//
//    Đây là lần THỨ HAI một hàng rào dựng từ S0 quyết định chỗ ở của một file có thật, và lần
//    này nó bác một dòng của kế hoạch. Ghi lại vì đó là thông tin: một kế hoạch viết trước khi
//    hàng rào có việc để làm sẽ không thấy trước những chỗ hàng rào chạm tới.
// =============================================================================================

import { createCipheriv, createDecipheriv, createPublicKey, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createSupplier, addSupplierContact } from "@trustprocure/supplier";
import {
  addRfqItem,
  approveRfq,
  closeRfq,
  createProcurementPolicy,
  createRfq,
  openRfq,
  setRfqBudget,
  submitRfqForApproval,
} from "@trustprocure/rfq";
import {
  PepperRing,
  createInvitation,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import { getRfqPublicKeys, sealBid } from "@trustprocure/sealed-envelope";
import {
  ReceiptSigningKeyRing,
  auditStoredCiphertexts,
  createLocalDevReceiptSigner,
  listBidVersions,
  submitBid,
  verifyReceipt,
  type ReceiptSigner,
} from "@trustprocure/bidding";
import {
  approveUnseal,
  buildComparisonTable,
  countReceivedBids,
  dispatchUnseal,
  requestUnseal,
} from "@trustprocure/unseal";
import { executeUnsealRequest } from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const HAN_NOP = new Date(Date.now() + 7 * 24 * 3600 * 1000);

/** Bộ bọc/mở bọc đối xứng của riêng test — cùng khuôn `unseal-worker.int.test.ts`. */
const KHOA_TEST = randomBytes(32);
const boBoc = {
  name: "doi-xung-cua-test",
  wrap: (_orgId: string, plaintext: Uint8Array) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", KHOA_TEST, iv);
    const than = Buffer.concat([c.update(plaintext), c.final()]);
    return Promise.resolve({
      ciphertext: new Uint8Array(Buffer.concat([iv, c.getAuthTag(), than])),
      keyVersion: "test-v1",
    });
  },
};
const boMoBoc = {
  name: "doi-xung-cua-test",
  unwrap: (_orgId: string, wrapped: { ciphertext: Uint8Array }) => {
    const b = Buffer.from(wrapped.ciphertext);
    const d = createDecipheriv("aes-256-gcm", KHOA_TEST, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Promise.resolve(new Uint8Array(Buffer.concat([d.update(b.subarray(28)), d.final()])));
  },
};

/**
 * NĂM nhà cung cấp, năm mức giá, đơn vị VND. Con số 1 tỷ của kịch bản là NGÂN SÁCH DỰ TÍNH của
 * người mua, không phải giá của ai — nên hai nhà cung cấp dưới ngân sách và ba nhà trên.
 */
const NHA_CUNG_CAP = [
  { ten: "Thep Hoa Phat", gia: "980000000.00" },
  { ten: "Thep Viet Duc", gia: "1050000000.00" },
  { ten: "Thep Pomina", gia: "1120000000.00" },
  { ten: "Thep Nam Kim", gia: "999000000.00" },
  { ten: "Thep Tung Kuang", gia: "1400000000.00" },
] as const;

/** Nhà cung cấp thứ tư SỬA GIÁ trước hạn — vế "có sửa giá trước deadline" của kịch bản. */
const GIA_SUA_LAI = "930000000.00";
const NGAN_SACH = "1000000000.00";

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;
/** uMua tạo RFQ (PROCUREMENT_MANAGER); uGd1/uGd2 duyệt (DIRECTOR). */
let uMua: string, uGd1: string, uGd2: string;
let sMua: string, sGd1: string, sGd2: string;
let boKy: ReceiptSigner;
let khoaKyCongKhai: Uint8Array;
const pepper = new PepperRing("pepper-2026-09", { "pepper-2026-09": randomBytes(32) });

async function taoNguoi(email: string, vaiTro: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
    orgA,
    id,
    vaiTro,
  ]);
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

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty Mua Sam A', 'cong-ty-a') RETURNING id",
  );
  orgA = orgs.rows[0]?.id ?? "";
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");

  uMua = await taoNguoi("mua@vidu.vn", "PROCUREMENT_MANAGER");
  uGd1 = await taoNguoi("gd1@vidu.vn", "DIRECTOR");
  uGd2 = await taoNguoi("gd2@vidu.vn", "DIRECTOR");
  sMua = await taoPhien(uMua);
  sGd1 = await taoPhien(uGd1);
  sGd2 = await taoPhien(uGd2);

  const { generateKeyPairSync } = await import("node:crypto");
  const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  khoaKyCongKhai = new Uint8Array(cap.publicKey.export({ type: "spki", format: "der" }));
  boKy = createLocalDevReceiptSigner(
    new ReceiptSigningKeyRing("ky-2026-09", {
      "ky-2026-09": {
        privateKey: new Uint8Array(cap.privateKey.export({ type: "pkcs8", format: "der" })),
        publicKey: khoaKyCongKhai,
      },
    }),
  );

  expect([orgA, uMua, uGd1, uGd2, sMua, sGd1, sGd2].filter((x) => x === "")).toEqual([]);
}, 180000);

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

// ===============================================================================================
// KỊCH BẢN CHẠY MỘT LẦN, THEO THỨ TỰ, VÀ CÁC `it` SAU ĐỌC KẾT QUẢ CỦA CÁC `it` TRƯỚC.
//
// Đây là ngoại lệ CÓ CHỦ ĐÍCH của quy ước "mỗi test tự dựng bối cảnh": một kịch bản end-to-end
// mà mỗi bước tự dựng lại từ đầu thì KHÔNG còn là end-to-end — nó là năm test đơn lẻ đặt cạnh
// nhau. Cái giá phải trả được nói ra: một bước đỏ làm các bước sau đỏ theo, và thứ tự khai báo
// trong file LÀ hợp đồng.
// ===============================================================================================
const trangThai: {
  rfqId: string;
  loiMoi: { invitationId: string; supplierId: string; ten: string; gia: string }[];
  phienKhach: string[];
  bienNhan: { canonicalText: string; signature: Uint8Array; ten: string }[];
  unsealRequestId: string;
} = { rfqId: "", loiMoi: [], phienKhach: [], bienNhan: [], unsealRequestId: "" };

describe("[KỊCH BẢN 41] RFQ 1 tỷ, 5 nhà cung cấp, sửa giá, mở thầu phê duyệt kép, bảng so sánh", () => {
  it("bước 1 — người mua dựng RFQ 1 tỷ và nó GIỮ yêu cầu phê duyệt kép", async () => {
    await withTenant(apiPool, orgA, async (c) => {
      // Ngưỡng 500 triệu, ngân sách 1 tỷ -> VƯỢT ngưỡng -> `requires_dual_approval` GIỮ `true`.
      // Đây là chỗ con số "1 tỷ" của kịch bản có tác dụng THẬT chứ không phải một nhãn trang trí.
      await createProcurementPolicy(c, orgA, {
        version: 1,
        dualApprovalThreshold: "500000000.00",
        currency: "VND",
        actorSessionId: sMua,
      });
      const rfq = await createRfq(c, orgA, {
        title: "Mua thep tam cho nha may Q4",
        deadlineAt: HAN_NOP,
        createdBySessionId: sMua,
      });
      trangThai.rfqId = rfq.id;
      await addRfqItem(c, orgA, {
        rfqId: rfq.id,
        lineNo: 1,
        description: "Thep tam SS400 day 10mm",
        quantity: "500.0000",
        unit: "tan",
        actorSessionId: sMua,
      });
      const ns = await setRfqBudget(c, orgA, {
        rfqId: rfq.id,
        estimatedValue: NGAN_SACH,
        currency: "VND",
        actorSessionId: sMua,
      });
      expect(
        ns.requiresDualApproval,
        "1 tỷ vượt ngưỡng 500 triệu — RFQ này PHẢI cần phê duyệt kép",
      ).toBe(true);
    });
    expect(trangThai.rfqId).not.toBe("");
  });

  it("bước 2 — hai giám đốc KHÁC NHAU duyệt, rồi RFQ mở kèm cặp khoá của chính nó", async () => {
    await withTenant(apiPool, orgA, async (c) => {
      await submitRfqForApproval(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua });
      await approveRfq(c, orgA, { rfqId: trangThai.rfqId, sessionId: sGd1 });
      await approveRfq(c, orgA, { rfqId: trangThai.rfqId, sessionId: sGd2 });
      const mo = await openRfq(c, orgA, {
        rfqId: trangThai.rfqId,
        actorSessionId: sMua,
        keyWrapper: boBoc,
      });
      expect(mo.status).toBe("OPEN");
    });

    // [C5] Cặp khoá ra đời ĐÚNG lúc mở, không sớm hơn — và khoá riêng nằm ở dạng ĐÃ BỌC.
    const khoa = await withTenant(apiPool, orgA, (c) =>
      getRfqPublicKeys(c, orgA, trangThai.rfqId),
    );
    expect(khoa.map((k) => k.algorithm)).toContain("ECDH_P256");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("SELECT wrapped_private_key FROM rfq_key_material WHERE rfq_id = $1", [
          trangThai.rfqId,
        ]),
      ),
      "[G1] `app_api` GHI được khoá đã bọc nhưng KHÔNG ĐỌC LẠI được",
    ).rejects.toThrow(/permission denied/i);
  });

  it("bước 3 — mời năm nhà cung cấp; mỗi người đi trọn link → OTP → phiên khách", async () => {
    for (const ncc of NHA_CUNG_CAP) {
      await withTenant(apiPool, orgA, async (c) => {
        const s = await createSupplier(c, orgA, {
          legalName: ncc.ten,
          actorSessionId: sMua,
        });
        const lh = await addSupplierContact(c, orgA, {
          supplierId: s.id,
          fullName: "Nguoi ban hang",
          email: `${s.id.slice(0, 8)}@vidu.vn`,
          phone: `09${s.id.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
          actorSessionId: sMua,
        });
        const lm = await createInvitation(c, orgA, {
          rfqId: trangThai.rfqId,
          supplierId: s.id,
          contactId: lh.id,
          linkChannel: "EMAIL",
          actorSessionId: sMua,
        });
        trangThai.loiMoi.push({
          invitationId: lm.id,
          supplierId: s.id,
          ten: ncc.ten,
          gia: ncc.gia,
        });

        // §7 mục 4: nhận link -> OTP -> phiên. Magic link đi kênh EMAIL, OTP đi kênh SMS —
        // ADR-015 mục 1 cấm hai thứ đi cùng kênh, và `issueOtpChallenge` cưỡng chế điều đó.
        const token = await issueMagicLinkToken(c, orgA, {
          invitationId: lm.id,
          actorSessionId: sMua,
        });
        const daNhan = await redeemMagicLink(c, orgA, token.token);
        expect(daNhan.invitationId).toBe(lm.id);

        const otp = await issueOtpChallenge(c, orgA, {
          token: token.token,
          channel: "SMS",
          callerFingerprint: `ip-${s.id.slice(0, 8)}`,
          pepper,
        });
        expect(otp.ok, "phát OTP bị từ chối ngay ở lần đầu").toBe(true);
        if (!otp.ok) throw new Error("khong phat duoc OTP");

        const phien = await verifyOtpAndStartSession(c, orgA, {
          token: token.token,
          code: otp.code,
          pepper,
        });
        expect(phien.ok, "đối chiếu OTP thất bại trên mã vừa phát").toBe(true);
        if (!phien.ok) throw new Error("khong doi chieu duoc OTP");
        trangThai.phienKhach.push(phien.sessionId);
      });
    }
    expect(trangThai.loiMoi.length).toBe(5);
    expect(new Set(trangThai.phienKhach).size, "năm phiên khách phải khác nhau").toBe(5);
  });

  it("bước 4 — năm báo giá niêm phong ở phía nhà cung cấp, mỗi lần nộp một biên nhận đã ký", async () => {
    const khoa = await withTenant(apiPool, orgA, (c) =>
      getRfqPublicKeys(c, orgA, trangThai.rfqId),
    );
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
    if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");

    for (const [i, lm] of trangThai.loiMoi.entries()) {
      // NIÊM PHONG PHÍA NHÀ CUNG CẤP: bản rõ chỉ tồn tại trong phạm vi vòng lặp này, và thứ đi
      // vào `submitBid` là một chuỗi byte mà không role nào của tầng `api` mở được.
      const phongBi = await sealBid({
        rfqId: trangThai.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: p256.publicKey,
        plaintext: new TextEncoder().encode(
          JSON.stringify({ totalAmount: lm.gia, currency: "VND", nhaCungCap: lm.ten }),
        ),
      });
      const bn = await withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, {
          guestSessionId: trangThai.phienKhach[i] ?? "",
          envelope: phongBi,
          signer: boKy,
        }),
      );
      expect(bn.version).toBe(1);
      trangThai.bienNhan.push({
        canonicalText: bn.canonicalText,
        signature: bn.signature,
        ten: lm.ten,
      });
    }
    expect(trangThai.bienNhan.length).toBe(5);
  });

  it("bước 5 — [B2] nhà cung cấp kiểm chứng biên nhận bằng KHOÁ CÔNG KHAI MỘT MÌNH", async () => {
    // Vế chịu lực: vòng lặp này KHÔNG cầm `client`, KHÔNG cầm `orgId`, không chạm CSDL một lần
    // nào. Nó là đúng thứ một nhà cung cấp làm được ở máy của họ.
    for (const bn of trangThai.bienNhan) {
      const hopLe = await verifyReceipt({
        canonicalText: bn.canonicalText,
        signature: bn.signature,
        publicKey: khoaKyCongKhai,
      });
      expect(hopLe, `biên nhận của ${bn.ten} không kiểm chứng được`).toBe(true);
    }

    // Đối chứng âm: sửa MỘT ký tự của văn bản thì chữ ký hỏng.
    const dau = trangThai.bienNhan[0];
    if (dau === undefined) throw new Error("khong co bien nhan nao");
    const hong = await verifyReceipt({
      canonicalText: dau.canonicalText.replace("version=1", "version=9"),
      signature: dau.signature,
      publicKey: khoaKyCongKhai,
    });
    expect(hong, "một văn bản đã sửa vẫn kiểm chứng được — chữ ký không có tác dụng").toBe(false);

    // Và cùng chữ ký ấy kiểm được bằng MỘT CÀI ĐẶT KHÁC — con đường `openssl dgst -verify` đi.
    const khoaNode = createPublicKey({
      key: Buffer.from(khoaKyCongKhai),
      format: "der",
      type: "spki",
    });
    expect(khoaNode.asymmetricKeyType).toBe("ec");
  });

  it("bước 6 — SỬA GIÁ trước hạn: bản mới thành version 2, bản cũ VẪN CÒN [B1]", async () => {
    const khoa = await withTenant(apiPool, orgA, (c) =>
      getRfqPublicKeys(c, orgA, trangThai.rfqId),
    );
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
    if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");
    const lm = trangThai.loiMoi[3];
    if (lm === undefined) throw new Error("khong co loi moi thu tu");

    const phongBiMoi = await sealBid({
      rfqId: trangThai.rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: p256.publicKey,
      plaintext: new TextEncoder().encode(
        JSON.stringify({ totalAmount: GIA_SUA_LAI, currency: "VND", nhaCungCap: lm.ten }),
      ),
    });
    const bn2 = await withTenant(apiPool, orgA, (c) =>
      submitBid(c, orgA, {
        guestSessionId: trangThai.phienKhach[3] ?? "",
        envelope: phongBiMoi,
        signer: boKy,
      }),
    );
    expect(bn2.version, "lần nộp thứ hai phải là một PHIÊN BẢN MỚI").toBe(2);

    const cac = await withTenant(apiPool, orgA, (c) =>
      listBidVersions(c, orgA, bn2.bidId),
    );
    expect(cac.map((v) => v.version).sort(), "bản đầu KHÔNG được biến mất").toEqual([1, 2]);
    lm.gia = GIA_SUA_LAI;
  });

  it("bước 7 — [A6] trước khi đóng, số báo giá đã nhận bị GIẤU; sau khi đóng thì công bố", async () => {
    const truoc = await withTenant(apiPool, orgA, (c) =>
      countReceivedBids(c, orgA, trangThai.rfqId),
    );
    expect(truoc, "chính sách mặc định là chế độ nghiêm — con số này chưa được nói ra").toEqual({
      disclosed: false,
      reason: "STRICT_BLIND_BEFORE_CLOSE",
      rfqStatus: "OPEN",
    });

    await withTenant(apiPool, orgA, (c) =>
      closeRfq(c, orgA, {
        rfqId: trangThai.rfqId,
        reason: "dong dung han theo ke hoach mua sam Q4",
        actorSessionId: sMua,
      }),
    );

    const sau = await withTenant(apiPool, orgA, (c) =>
      countReceivedBids(c, orgA, trangThai.rfqId),
    );
    expect(sau).toEqual({ disclosed: true, count: 5 });
  });

  it("bước 8 — [A4] RFQ đã CLOSED nhưng CHƯA mở thầu: bảng so sánh vẫn bị từ chối", async () => {
    // Đây là khoảnh khắc nguy hiểm nhất của cả kịch bản: hạn đã hết, mọi báo giá đã nằm trong
    // CSDL, và người mua có mọi lý do để muốn nhìn. Không có gì nhìn được.
    await expect(
      withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, trangThai.rfqId)),
    ).rejects.toThrow(/RFQ đang ở CLOSED/);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_unsealed_bids"),
    );
    expect(rows[0]?.n, "chưa mở thầu mà đã có bản rõ").toBe("0");
  });

  it("bước 9 — [D2] mở thầu cần HAI phê duyệt của HAI người, và người yêu cầu không tự duyệt", async () => {
    await withTenant(apiPool, orgA, async (c) => {
      const yc = await requestUnseal(
        c,
        orgA,
        {
          rfqId: trangThai.rfqId,
          reason: "da het han nop, mo thau de cham",
          actorSessionId: sMua,
        },
        apiPool,
      );
      trangThai.unsealRequestId = yc.id;
      expect(yc.status).toBe("PENDING");

      // Người yêu cầu tự duyệt -> bị từ chối. Đây là D3/D2 ở dạng chạy được.
      await expect(
        approveUnseal(c, orgA, { unsealRequestId: yc.id, actorSessionId: sMua }, apiPool),
      ).rejects.toThrow();
    });

    await withTenant(apiPool, orgA, async (c) => {
      const mot = await approveUnseal(
        c,
        orgA,
        { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sGd1 },
        apiPool,
      );
      expect(mot.status, "MỘT phê duyệt là chưa đủ cho một RFQ vượt ngưỡng").toBe("PENDING");
    });
    await withTenant(apiPool, orgA, async (c) => {
      const hai = await approveUnseal(
        c,
        orgA,
        { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sGd2 },
        apiPool,
      );
      expect(hai.status).toBe("APPROVED");
    });
  });

  it("bước 10 — [D1] cổng bốn vế cho qua, và `api` chỉ ĐẶT MỘT JOB chứ không giải mã", async () => {
    const bangChung = await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(
        c,
        orgA,
        { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sMua },
        apiPool,
      ),
    );
    expect(bangChung.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);

    const { rows } = await db.pool.query<{ kind: string }>(
      "SELECT kind FROM outbox_jobs WHERE payload->>'unsealRequestId' = $1",
      [trangThai.unsealRequestId],
    );
    expect(rows.map((r) => r.kind)).toEqual(["UNSEAL_RFQ"]);
  });

  it("bước 11 — worker mở năm phong bì, và chỉ lấy PHIÊN BẢN CUỐI của người đã sửa giá", async () => {
    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, {
        unsealRequestId: trangThai.unsealRequestId,
        unwrapper: boMoBoc,
      }),
    );
    expect(ketQua.opened, "năm luồng báo giá, năm bản rõ").toBe(5);
    expect(ketQua.failed).toBe(0);
    expect(ketQua.rfqId).toBe(trangThai.rfqId);
  });

  it("bước 12 — BẢNG SO SÁNH: năm dòng, sắp theo giá, và giá SỬA LẠI thắng giá đầu", async () => {
    const bang = await withTenant(apiPool, orgA, (c) =>
      buildComparisonTable(c, orgA, trangThai.rfqId),
    );
    expect(bang.rfqStatus).toBe("UNSEALED");
    expect(bang.rows.length).toBe(5);

    const mongDoi = [...trangThai.loiMoi]
      .map((l) => ({ ten: l.ten, gia: l.gia }))
      .sort((a, b) => Number(a.gia) - Number(b.gia));
    expect(bang.rows.map((r) => r.supplierLegalName)).toEqual(mongDoi.map((m) => m.ten));
    expect(bang.rows.map((r) => r.totalAmount)).toEqual(mongDoi.map((m) => m.gia));

    // Giá 930 triệu (bản SỬA) phải đứng đầu; giá 999 triệu (bản ĐẦU của cùng người) không được
    // xuất hiện ở đâu cả. Nếu worker lấy nhầm phiên bản, hai khẳng định này đỏ cùng lúc.
    expect(bang.rows[0]?.totalAmount).toBe(GIA_SUA_LAI);
    expect(bang.rows.map((r) => r.totalAmount)).not.toContain("999000000.00");

    expect(bang.aggregates.min).toBe(GIA_SUA_LAI);
    expect(bang.aggregates.max).toBe("1400000000.00");
    expect(bang.aggregates.currency).toBe("VND");
    expect(bang.aggregates.currencyMismatch).toBe(false);
    expect(bang.aggregates.unparsed).toBe(0);
    // Ngân sách 1 tỷ: 930tr và 980tr ở dưới, ba nhà còn lại ở trên.
    expect(bang.aggregates.belowBudget).toBe(2);
  });

  it("bước 13 — [B5] job toàn vẹn chạy sạch trên toàn bộ sáu phiên bản của kịch bản", async () => {
    const bc = await withTenant(unsealPool, orgA, (c) =>
      auditStoredCiphertexts(c, orgA, trangThai.rfqId),
    );
    expect(bc.checked, "năm nhà cung cấp, một người nộp hai lần").toBe(6);
    expect(bc.mismatched).toEqual([]);
    expect(bc.missingReceipt).toEqual([]);
    expect(bc.unparsableReceipt).toEqual([]);
  });

  it("bước 14 — [A3/A4] sau tất cả, giá dạng rõ chỉ tồn tại ở ĐÚNG MỘT bảng", async () => {
    // Cùng bộ quét của S1.7, chạy ở cuối một kịch bản THẬT thay vì trên một fixture hai dòng.
    const { rows: bang } = await db.pool.query<{ ten: string }>(
      "SELECT c.relname AS ten FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        " WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname",
    );
    const dinh: string[] = [];
    for (const b of bang) {
      if (!/^[a-z_][a-z0-9_]*$/.test(b.ten)) throw new Error(`ten bang la: ${b.ten}`);
      const { rows } = await db.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${b.ten} t WHERE t::text LIKE '%' || $1 || '%'`,
        [GIA_SUA_LAI],
      );
      if (rows[0]?.n !== "0") dinh.push(b.ten);
    }
    expect(bang.length).toBeGreaterThan(20);
    expect(dinh).toEqual(["rfq_unsealed_bids"]);
  }, 120000);

  it("bước 15 — sổ kiểm toán kể lại được toàn bộ kịch bản, theo đúng thứ tự", async () => {
    // Câu hỏi của một kiểm toán viên là *"kể lại cho tôi nghe chuyện gì đã xảy ra"*, và câu trả
    // lời phải là dữ liệu chứ không phải một lời hứa. Đây là phép đo cho chính câu ấy.
    const { rows } = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [orgA],
    );
    const cac = rows.map((r) => r.action);
    for (const moc of [
      "RFQ_CREATED",
      "RFQ_SUBMITTED_FOR_APPROVAL",
      "RFQ_APPROVED",
      "RFQ_KEY_MATERIAL_ISSUED",
      "RFQ_OPENED",
      "RFQ_CLOSED",
      "UNSEAL_REQUESTED",
      "UNSEAL_APPROVED",
      "UNSEAL_DISPATCHED",
      "RFQ_KEY_MATERIAL_UNWRAPPED",
      "RFQ_UNSEALED",
    ]) {
      expect(cac, `sổ kiểm toán thiếu mốc ${moc}`).toContain(moc);
    }
    // THỨ TỰ là một phần của câu chuyện: khoá được mở bọc SAU khi có phê duyệt, không trước.
    expect(cac.indexOf("RFQ_KEY_MATERIAL_UNWRAPPED")).toBeGreaterThan(
      cac.lastIndexOf("UNSEAL_APPROVED"),
    );
    expect(cac.indexOf("RFQ_UNSEALED")).toBeGreaterThan(
      cac.indexOf("RFQ_KEY_MATERIAL_UNWRAPPED"),
    );
  });
});
