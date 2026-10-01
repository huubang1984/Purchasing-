// ==============================================================================================
// [ADR-011 / ADR-009] BỘ KÝ BIÊN NHẬN aws-kms — ĐO TRÊN MỘT KMS GIẢ, VÀ ĐÓ LÀ GIỚI HẠN NÓI THẲNG
//
// KMS giả ký bằng `node:crypto` (ECDSA P-256, SHA-256, DER — đúng dạng `kms:Sign` trả) và trả SPKI
// ở `GetPublicKey`. Phép đo quan trọng là vòng khép kín: chữ ký adapter trả được `verifyReceipt`
// chấp nhận với khoá công khai MỘT MÌNH (B2). Không đo key policy hay định dạng thật của AWS — đó
// là việc của phép đo trên tài khoản thật.
// ==============================================================================================

import { generateKeyPairSync, sign as kyNode, type KeyObject } from "node:crypto";
import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
  type GetPublicKeyCommandOutput,
  type SignCommandOutput,
} from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import {
  ReceiptError,
  buildReceiptText,
  createAwsKmsReceiptSigner,
  layKhoaCongKhaiBienNhanKms,
  verifyReceipt,
  type KmsDocKhoaCongKhai,
  type KmsKyBienNhan,
} from "./index.js";

const KEY_ID = "alias/tp-receipt-sign";

class KmsKyGia implements KmsKyBienNhan, KmsDocKhoaCongKhai {
  readonly lenh: Array<{ ten: string; input: unknown }> = [];
  readonly #rieng: KeyObject;
  readonly spki: Uint8Array;
  constructor() {
    const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    this.#rieng = cap.privateKey;
    this.spki = new Uint8Array(cap.publicKey.export({ type: "spki", format: "der" }));
  }
  send(lenh: SignCommand): Promise<SignCommandOutput>;
  send(lenh: GetPublicKeyCommand): Promise<GetPublicKeyCommandOutput>;
  send(lenh: SignCommand | GetPublicKeyCommand): Promise<SignCommandOutput | GetPublicKeyCommandOutput> {
    this.lenh.push({ ten: lenh.constructor.name, input: lenh.input });
    const meta = { $metadata: {} };
    if (lenh instanceof SignCommand) {
      // `kms:Sign` với MessageType RAW: KMS tự băm SHA-256 rồi ký — `crypto.sign("sha256", …)` làm đúng thế.
      const chuKy = kyNode("sha256", Buffer.from(lenh.input.Message!), this.#rieng);
      return Promise.resolve({ ...meta, KeyId: "arn:gia", Signature: new Uint8Array(chuKy), SigningAlgorithm: "ECDSA_SHA_256" });
    }
    return Promise.resolve({
      ...meta,
      KeyId: "arn:gia",
      KeySpec: "ECC_NIST_P256",
      KeyUsage: "SIGN_VERIFY",
      SigningAlgorithms: ["ECDSA_SHA_256"],
      PublicKey: this.spki,
    });
  }
}

function vanBan(kid: string): string {
  return buildReceiptText({
    kid,
    rfqId: "11111111-1111-4111-8111-111111111111",
    bidId: "22222222-2222-4222-8222-222222222222",
    version: 1,
    ciphertextSha256: "a".repeat(64),
    submittedAt: "2026-09-26T01:00:00.000000Z",
  });
}

describe("[ADR-011] bộ ký biên nhận aws-kms", () => {
  it("KMSClient thật thoả hai mặt tối thiểu (phép kiểm kiểu, không gọi mạng)", () => {
    const client = new KMSClient({ region: "ap-southeast-1" });
    const ky: KmsKyBienNhan = client;
    const doc: KmsDocKhoaCongKhai = client;
    expect(ky).toBe(doc);
    client.destroy();
  });

  it("[B2] chữ ký của kms:Sign kiểm chứng được bằng khoá công khai MỘT MÌNH, lấy từ GetPublicKey", async () => {
    const kms = new KmsKyGia();
    const ky = createAwsKmsReceiptSigner({ client: kms, keyId: KEY_ID, kid: "kms-2026-09" });
    expect(ky).toMatchObject({ name: "aws-kms", activeKeyId: "kms-2026-09" });
    const t = vanBan(ky.activeKeyId);
    const chuKy = await ky.sign(t);
    const congKhai = await layKhoaCongKhaiBienNhanKms(kms, KEY_ID);
    expect(await verifyReceipt({ canonicalText: t, signature: chuKy, publicKey: congKhai })).toBe(true);
    // Đối chứng: đổi một ký tự của văn bản ⇒ false, không ném.
    expect(await verifyReceipt({ canonicalText: t.replace("version=1", "version=2"), signature: chuKy, publicKey: congKhai })).toBe(false);
    expect(kms.lenh[0]).toEqual({
      ten: "SignCommand",
      input: { KeyId: KEY_ID, Message: new TextEncoder().encode(t), MessageType: "RAW", SigningAlgorithm: "ECDSA_SHA_256" },
    });
  });

  it("chữ ký DER dị dạng hay rỗng, thuật toán lệch, lỗi KMS ⇒ ReceiptError lúc KÝ", async () => {
    const tra = (ra: Partial<SignCommandOutput>): KmsKyBienNhan => ({ send: () => Promise.resolve({ $metadata: {}, ...ra }) });
    const cacCa: KmsKyBienNhan[] = [
      tra({ Signature: new Uint8Array([0x30, 0x02, 0x02, 0x00]) }),
      tra({ Signature: new Uint8Array(0) }),
      tra({}),
      tra({ Signature: new Uint8Array(70), SigningAlgorithm: "ECDSA_SHA_384" }),
      { send: () => Promise.reject(new Error("AccessDeniedException")) },
    ];
    for (const client of cacCa) {
      await expect(createAwsKmsReceiptSigner({ client, keyId: KEY_ID, kid: "k1" }).sign(vanBan("k1"))).rejects.toThrow(ReceiptError);
    }
  });

  it("GetPublicKey của một khoá sai loại bị từ chối", async () => {
    const hopLe = await new KmsKyGia().send(new GetPublicKeyCommand({ KeyId: KEY_ID }));
    const cacCa: Array<Partial<GetPublicKeyCommandOutput>> = [
      { ...hopLe, KeySpec: "ECC_NIST_P384" },
      { ...hopLe, KeyUsage: "ENCRYPT_DECRYPT" },
      { ...hopLe, SigningAlgorithms: ["ECDSA_SHA_384"] },
      { ...hopLe, PublicKey: undefined },
    ];
    for (const ra of cacCa) {
      const client: KmsDocKhoaCongKhai = { send: () => Promise.resolve({ $metadata: {}, ...ra }) };
      await expect(layKhoaCongKhaiBienNhanKms(client, KEY_ID)).rejects.toThrow(ReceiptError);
    }
  });

  it("cấu hình sai bị từ chối lúc dựng: keyId rỗng, kid không đi được vào dòng kid=", () => {
    const kms = new KmsKyGia();
    expect(() => createAwsKmsReceiptSigner({ client: kms, keyId: " ", kid: "k1" })).toThrow(ReceiptError);
    expect(() => createAwsKmsReceiptSigner({ client: kms, keyId: KEY_ID, kid: "kid\nalg=HMAC" })).toThrow(ReceiptError);
  });

  // [S1.249 / kid] Phía phát hành hẹp hơn định dạng: kid biên nhận thành tên đối tượng S3 khi job neo neo tài liệu khoá
  // (`taiLieuMotKhoa`, tập `[A-Za-z0-9._-]`). Định dạng vẫn cho `:` — ca "định dạng không đổi" ở `receipt.test.ts`.
  // [S1.250 / kid] Chủ dự án chốt 2026-10-01: bộ dựng đọc `cfg.kid` ĐÚNG MỘT LẦN — giá trị đã kiểm là giá trị thành
  // `activeKeyId`. Một cấu hình mang getter đổi giá trị sau lần đọc đầu không được lọt kid có `:` qua phép kiểm (cùng khuôn
  // ca getter của `submitBid` ở `bidding.int.test.ts` và của bộ ký mốc neo KMS).
  it("[S1.250 / kid] bộ dựng đọc `cfg.kid` đúng một lần: getter đổi giá trị sau lần đọc đầu ⇒ `activeKeyId` là ĐÚNG giá trị đã kiểm", () => {
    const kms = new KmsKyGia();
    const gia = ["kms-2026-09", "kms:2026-09"];
    let soLanDoc = 0;
    const cfg = {
      client: kms,
      keyId: KEY_ID,
      get kid(): string {
        const v = gia[Math.min(soLanDoc, gia.length - 1)] as string;
        soLanDoc += 1;
        return v;
      },
    };
    const boKy = createAwsKmsReceiptSigner(cfg);
    expect(boKy.activeKeyId, "bộ ký phải mang kid ĐÃ KIỂM").toBe("kms-2026-09");
    expect(soLanDoc, "getter `kid` đọc đúng một lần").toBe(1);
  });

  it("[S1.249 / kid] kid có `:` bị từ chối lúc DỰNG bộ ký aws-kms — trước lời gọi KMS nào — và thông điệp nêu tập ký tự", () => {
    const kms = new KmsKyGia();
    for (const kid of ["kms:2026-09", "arn:kid", ":"]) {
      expect(() => createAwsKmsReceiptSigner({ client: kms, keyId: KEY_ID, kid }), kid).toThrow(ReceiptError);
      expect(() => createAwsKmsReceiptSigner({ client: kms, keyId: KEY_ID, kid }), kid).toThrow("[A-Za-z0-9._-]");
    }
    expect(kms.lenh, "từ chối lúc dựng: không lệnh KMS nào đã gửi").toEqual([]);
    // Đối chứng: giá trị mặc định của `receipt_kid` (stack 50) đi qua.
    expect(createAwsKmsReceiptSigner({ client: kms, keyId: KEY_ID, kid: "kms-2026-09" }).activeKeyId).toBe("kms-2026-09");
  });
});
