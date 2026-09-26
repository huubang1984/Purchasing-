// ==============================================================================================
// [khoản 15 / ADR-064 — S1.128] NGUỒN KHOÁ CÔNG KHAI TỪ AWS KMS — ĐO TRÊN MỘT KMS GIẢ
//
// KMS giả giữ những cặp khoá P-256 THẬT (`node:crypto`), ký đúng như `kms:Sign` (RAW, SHA-256,
// DER) và trả SPKI ở `GetPublicKey`. Vế chịu lực là vòng khép kín của B2 đi qua ĐƯỜNG CÔNG BỐ:
// một biên nhận do `createAwsKmsReceiptSigner` ký kiểm chứng được bằng khoá công khai lấy TỪ TÀI
// LIỆU CÔNG BỐ — không từ chính KMS, không từ bộ sinh khoá của test.
//
// Giới hạn nói thẳng: không đo key policy hay định dạng thật của AWS (quyền `kms:GetPublicKey` của
// tiến trình này là việc của hạ tầng, và phép đo ấy chỉ có trên tài khoản thật).
// ==============================================================================================

import { createHash, generateKeyPairSync, sign as kyNode, type KeyObject } from "node:crypto";
import {
  GetPublicKeyCommand,
  SignCommand,
  type GetPublicKeyCommandOutput,
  type SignCommandOutput,
} from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import {
  buildReceiptText,
  createAwsKmsReceiptSigner,
  verifyReceipt,
  type KmsDocKhoaCongKhai,
  type KmsKyBienNhan,
} from "@trustprocure/bidding";
import { NguonKhoaError, buildReceiptKeyDocument, dungNguonKhoaKms } from "./index.js";

interface CmkGia {
  readonly rieng: KeyObject;
  readonly spki: Uint8Array;
  ra?: Partial<GetPublicKeyCommandOutput>;
  loi?: Error;
}

/** KMS giả nhiều CMK. Ghi lại MỌI lệnh để đo rằng nguồn khoá không bao giờ gọi `Sign`. */
class KmsGia implements KmsKyBienNhan, KmsDocKhoaCongKhai {
  readonly lenh: Array<{ ten: string; keyId: string | undefined }> = [];
  readonly cmk = new Map<string, CmkGia>();

  them(keyId: string, curve = "prime256v1"): CmkGia {
    const cap = generateKeyPairSync("ec", { namedCurve: curve });
    const c: CmkGia = { rieng: cap.privateKey, spki: new Uint8Array(cap.publicKey.export({ type: "spki", format: "der" })) };
    this.cmk.set(keyId, c);
    return c;
  }

  send(lenh: SignCommand): Promise<SignCommandOutput>;
  send(lenh: GetPublicKeyCommand): Promise<GetPublicKeyCommandOutput>;
  send(lenh: SignCommand | GetPublicKeyCommand): Promise<SignCommandOutput | GetPublicKeyCommandOutput> {
    this.lenh.push({ ten: lenh.constructor.name, keyId: lenh.input.KeyId });
    const c = this.cmk.get(lenh.input.KeyId ?? "");
    if (c === undefined) return Promise.reject(new Error("NotFoundException"));
    if (c.loi !== undefined) return Promise.reject(c.loi);
    const meta = { $metadata: {} };
    if (lenh instanceof SignCommand) {
      const chuKy = kyNode("sha256", Buffer.from(lenh.input.Message!), c.rieng);
      return Promise.resolve({ ...meta, Signature: new Uint8Array(chuKy), SigningAlgorithm: "ECDSA_SHA_256" });
    }
    return Promise.resolve({
      ...meta,
      KeyId: `arn:gia:${String(lenh.input.KeyId)}`,
      KeySpec: "ECC_NIST_P256",
      KeyUsage: "SIGN_VERIFY",
      SigningAlgorithms: ["ECDSA_SHA_256"],
      PublicKey: c.spki,
      ...c.ra,
    });
  }
}

function vanBan(kid: string): string {
  return buildReceiptText({
    kid,
    rfqId: "11111111-1111-4111-8111-111111111111",
    bidId: "22222222-2222-4222-8222-222222222222",
    version: 1,
    ciphertextSha256: "b".repeat(64),
    submittedAt: "2026-09-26T01:00:00.000000Z",
  });
}

function baCmk(): KmsGia {
  const kms = new KmsGia();
  kms.them("alias/tp-receipt-sign-2026-01");
  kms.them("alias/tp-receipt-sign");
  return kms;
}

const HAI_KHOA = [
  { kid: "kms-2026-01", keyId: "alias/tp-receipt-sign-2026-01" },
  { kid: "kms-2026-09", keyId: "alias/tp-receipt-sign" },
] as const;

describe("[khoản 15 / S1.128] nguồn khoá công khai biên nhận từ AWS KMS", () => {
  it("[INV-B2] tài liệu dựng từ KMS mang ĐÚNG kid, SPKI và dấu vân tay của từng CMK", async () => {
    const kms = baCmk();
    const nguon = await dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-09" });
    const doc = buildReceiptKeyDocument(nguon);

    expect(doc.activeKeyId).toBe("kms-2026-09");
    expect(doc.keys.map((k) => k.kid)).toEqual(["kms-2026-01", "kms-2026-09"]);
    for (const { kid, keyId } of HAI_KHOA) {
      const goc = kms.cmk.get(keyId)!.spki;
      const k = doc.keys.find((x) => x.kid === kid)!;
      // ĐỐI CHỨNG DƯƠNG so với chuỗi byte của chính CMK giả, không so với đầu ra của hàm đang đo.
      expect(Buffer.from(k.spki, "base64").equals(Buffer.from(goc)), `${kid}: SPKI`).toBe(true);
      expect(k.fingerprint).toBe(createHash("sha256").update(goc).digest("hex"));
      expect(k.alg).toBe("ECDSA_P256_SHA256");
    }
  });

  it("[INV-B2] VẾ CHỊU LỰC: biên nhận ký bằng kms:Sign kiểm chứng được bằng khoá lấy từ TÀI LIỆU CÔNG BỐ", async () => {
    const kms = baCmk();
    const doc = buildReceiptKeyDocument(await dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-09" }));

    for (const { kid, keyId } of HAI_KHOA) {
      // Cả khoá ĐANG DÙNG lẫn khoá CŨ: biên nhận ký trước lần xoay vẫn phải kiểm được (ADR-011 mục 3).
      const ky = createAwsKmsReceiptSigner({ client: kms, keyId, kid });
      const t = vanBan(kid);
      const chuKy = await ky.sign(t);
      const congBo = doc.keys.find((k) => k.kid === kid)!;
      const khoa = new Uint8Array(Buffer.from(congBo.spki, "base64"));
      expect(await verifyReceipt({ canonicalText: t, signature: chuKy, publicKey: khoa }), kid).toBe(true);
      // Đối chứng âm: khoá của `kid` KIA không kiểm được chữ ký này.
      const khac = doc.keys.find((k) => k.kid !== kid)!;
      expect(
        await verifyReceipt({ canonicalText: t, signature: chuKy, publicKey: new Uint8Array(Buffer.from(khac.spki, "base64")) }),
      ).toBe(false);
    }
  });

  it("nguồn khoá CHỈ gọi GetPublicKey — không một lệnh Sign nào, mỗi CMK đúng một lần", async () => {
    const kms = baCmk();
    await dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-01" });
    expect(kms.lenh).toEqual([
      { ten: "GetPublicKeyCommand", keyId: "alias/tp-receipt-sign-2026-01" },
      { ten: "GetPublicKeyCommand", keyId: "alias/tp-receipt-sign" },
    ]);
  });

  it("ẢNH CHỤP TĨNH: đọc tài liệu nhiều lần không gọi lại KMS, và sửa mảng trả về không đổi được nguồn", async () => {
    const kms = baCmk();
    const nguon = await dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-09" });
    const truoc = kms.lenh.length;
    const lan1 = buildReceiptKeyDocument(nguon);
    const bytes = nguon.publicKeys().get("kms-2026-01")!;
    bytes.fill(0);
    expect(buildReceiptKeyDocument(nguon)).toEqual(lan1);
    expect(kms.lenh.length).toBe(truoc);
  });

  describe("fail-closed — một khoá hỏng thì KHÔNG có nguồn nào cả", () => {
    const cacCaKmsTra: Array<[string, Partial<GetPublicKeyCommandOutput>]> = [
      ["KeySpec P-384", { KeySpec: "ECC_NIST_P384" }],
      ["KeyUsage mã hoá", { KeyUsage: "ENCRYPT_DECRYPT" }],
      ["không có ECDSA_SHA_256", { SigningAlgorithms: ["ECDSA_SHA_384"] }],
      ["không trả PublicKey", { PublicKey: undefined }],
      ["PublicKey không phải SPKI", { PublicKey: new Uint8Array([1, 2, 3]) }],
    ];
    it.each(cacCaKmsTra)("KMS trả %s cho khoá CŨ ⇒ ném", async (_ten, ra) => {
      const kms = baCmk();
      kms.cmk.get("alias/tp-receipt-sign-2026-01")!.ra = ra;
      await expect(dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-09" })).rejects.toThrow(NguonKhoaError);
    });

    it("KMS khai P-256 nhưng SPKI thật là một đường cong khác ⇒ ném", async () => {
      const kms = baCmk();
      const lech = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey.export({ type: "spki", format: "der" });
      kms.cmk.get("alias/tp-receipt-sign")!.ra = { PublicKey: new Uint8Array(lech) };
      await expect(dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-09" })).rejects.toThrow(/P-256/u);
    });

    it("GetPublicKey lỗi (AccessDenied) ⇒ ném, và thông điệp nêu kid chứ không nêu keyId", async () => {
      const kms = baCmk();
      kms.cmk.get("alias/tp-receipt-sign")!.loi = new Error("AccessDeniedException");
      const loi = await dungNguonKhoaKms({ client: kms, khoa: HAI_KHOA, activeKid: "kms-2026-09" }).catch((e: unknown) => e);
      expect(loi).toBeInstanceOf(NguonKhoaError);
      expect((loi as Error).message).toContain("kms-2026-09");
      expect((loi as Error).message).not.toContain("alias/tp-receipt-sign");
    });

    it("hai kid trỏ CÙNG một khoá công khai (alias và ARN của một CMK) ⇒ ném", async () => {
      const kms = baCmk();
      kms.cmk.set("arn:aws:kms:ap-southeast-1:1:key/x", kms.cmk.get("alias/tp-receipt-sign")!);
      await expect(
        dungNguonKhoaKms({
          client: kms,
          khoa: [...HAI_KHOA, { kid: "kms-2026-10", keyId: "arn:aws:kms:ap-southeast-1:1:key/x" }],
          activeKid: "kms-2026-09",
        }),
      ).rejects.toThrow(/cùng một khoá công khai/u);
    });

    const cacCaCauHinh: Array<[string, Parameters<typeof dungNguonKhoaKms>[0]["khoa"], string]> = [
      ["danh sách rỗng", [], "kms-2026-09"],
      ["activeKid không có trong danh sách", HAI_KHOA, "kms-2026-10"],
      ["kid trùng", [HAI_KHOA[0], { kid: "kms-2026-01", keyId: "alias/khac" }], "kms-2026-01"],
      ["keyId trùng", [HAI_KHOA[0], { kid: "kms-2026-02", keyId: "alias/tp-receipt-sign-2026-01" }], "kms-2026-01"],
      ["kid không qua assertReceiptKid", [{ kid: "kid co dau cach", keyId: "alias/tp-receipt-sign" }], "kid co dau cach"],
      ["keyId rỗng", [{ kid: "kms-2026-09", keyId: " " }], "kms-2026-09"],
    ];
    it.each(cacCaCauHinh)("%s ⇒ ném TRƯỚC mọi lời gọi KMS", async (_ten, khoa, activeKid) => {
      const kms = baCmk();
      await expect(dungNguonKhoaKms({ client: kms, khoa, activeKid })).rejects.toThrow(NguonKhoaError);
      expect(kms.lenh).toEqual([]);
    });
  });
});

describe("[S1.128] tài liệu công bố nhận một NGUỒN cấu trúc — và không tin nó mù quáng", () => {
  it("nguồn mà khoá đang dùng không có trong danh sách ⇒ buildReceiptKeyDocument ném", () => {
    // Vòng khoá tự cưỡng chế điều này trong constructor; một kiểu CẤU TRÚC thì không, nên nó được
    // kiểm lại ở chỗ tài liệu ra đời — một tài liệu công bố `activeKeyId` không tra được là một
    // tài liệu mà mọi biên nhận mới đều không kiểm chứng được.
    const spki = new Uint8Array(
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }),
    );
    expect(() => buildReceiptKeyDocument({ activeKeyId: "k2", publicKeys: () => new Map([["k1", spki]]) })).toThrow(
      NguonKhoaError,
    );
    expect(() => buildReceiptKeyDocument({ activeKeyId: "k1", publicKeys: () => new Map() })).toThrow(NguonKhoaError);
    expect(buildReceiptKeyDocument({ activeKeyId: "k1", publicKeys: () => new Map([["k1", spki]]) }).keys).toHaveLength(1);
  });
});
