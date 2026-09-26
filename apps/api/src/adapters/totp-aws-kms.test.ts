// [ADR-063] Adapter aws-kms của cổng TOTP giữ đúng ba tính chất hợp đồng như bản local-dev — đo trên
// một KMS GIẢ mô phỏng đúng thứ KMS thật làm với CMK đối xứng: encryption context là AAD của blob,
// Decrypt lệch context hay lệch KeyId thì từ chối. Không đo key policy — đó là phép đo trên tài khoản thật.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import {
  DecryptCommand,
  EncryptCommand,
  KMSClient,
  type DecryptCommandOutput,
  type EncryptCommandOutput,
} from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import { taoBoMaBiMatTotpAwsKms, type KmsTotp } from "./totp-aws-kms.js";

const KEY_ID = "alias/tp-totp";
const orgA = randomUUID();
const orgB = randomUUID();

class KmsTotpGia implements KmsTotp {
  readonly cmk = randomBytes(32);
  readonly lenh: Array<{ ten: string; input: unknown }> = [];
  send(lenh: EncryptCommand): Promise<EncryptCommandOutput>;
  send(lenh: DecryptCommand): Promise<DecryptCommandOutput>;
  send(lenh: EncryptCommand | DecryptCommand): Promise<EncryptCommandOutput | DecryptCommandOutput> {
    return new Promise((resolve) => resolve(this.xuLy(lenh)));
  }
  private xuLy(lenh: EncryptCommand | DecryptCommand): EncryptCommandOutput | DecryptCommandOutput {
    this.lenh.push({ ten: lenh.constructor.name, input: lenh.input });
    const aad = Buffer.from(JSON.stringify(lenh.input.EncryptionContext ?? {}));
    if (lenh.input.KeyId !== KEY_ID) throw new Error("IncorrectKeyException");
    if (lenh instanceof EncryptCommand) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", this.cmk, iv);
      c.setAAD(aad);
      const than = Buffer.concat([c.update(lenh.input.Plaintext!), c.final()]);
      return { $metadata: {}, KeyId: KEY_ID, CiphertextBlob: new Uint8Array(Buffer.concat([iv, c.getAuthTag(), than])) };
    }
    const b = Buffer.from(lenh.input.CiphertextBlob!);
    const d = createDecipheriv("aes-256-gcm", this.cmk, b.subarray(0, 12));
    d.setAAD(aad);
    d.setAuthTag(b.subarray(12, 28));
    try {
      return { $metadata: {}, KeyId: KEY_ID, Plaintext: new Uint8Array(Buffer.concat([d.update(b.subarray(28)), d.final()])) };
    } catch {
      throw new Error("InvalidCiphertextException");
    }
  }
}

const bo = (kms: KmsTotp, keyVersion = "kms-totp-1") => taoBoMaBiMatTotpAwsKms({ client: kms, keyId: KEY_ID, keyVersion });

describe("[ADR-063] bọc/mở bí mật TOTP aws-kms", () => {
  it("KMSClient thật thoả mặt tối thiểu (phép kiểm kiểu, không gọi mạng)", () => {
    const client = new KMSClient({ region: "ap-southeast-1" });
    const k: KmsTotp = client;
    expect(k).toBe(client);
    client.destroy();
  });

  it("roundtrip; lệnh và encryption context gửi đi đúng; phong bì không chứa bí mật rõ", async () => {
    const kms = new KmsTotpGia();
    const { wrapper, unsealer } = bo(kms);
    const biMat = randomBytes(20);
    const boc = await wrapper.wrapTotpSecret(orgA, biMat);
    expect(boc.keyVersion).toBe("kms-totp-1");
    expect(Buffer.from(boc.ciphertext).includes(biMat)).toBe(false);
    expect(Buffer.from(await unsealer.openTotpSecret(orgA, boc)).equals(biMat)).toBe(true);
    expect(kms.lenh).toEqual([
      { ten: "EncryptCommand", input: { KeyId: KEY_ID, Plaintext: biMat, EncryptionContext: { org_id: orgA, key_version: "kms-totp-1" } } },
      {
        ten: "DecryptCommand",
        input: {
          KeyId: KEY_ID,
          CiphertextBlob: boc.ciphertext,
          EncryptionContext: { org_id: orgA, key_version: "kms-totp-1" },
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        },
      },
    ]);
    expect(unsealer.kind).toBe("TOTP_SECRET_UNSEALER");
    expect(unsealer.name).toBe("aws-kms");
    expect(wrapper.name).toBe("aws-kms");
  });

  it("ràng buộc tổ chức và phiên bản: A không mở ở B, đổi keyVersion trong hàng không mở — một thông điệp cho mọi ca", async () => {
    const kms = new KmsTotpGia();
    const { wrapper, unsealer } = bo(kms);
    const boc = await wrapper.wrapTotpSecret(orgA, randomBytes(20));
    await expect(unsealer.openTotpSecret(orgB, boc)).rejects.toThrow(/^khong mo duoc bi mat TOTP$/u);
    await expect(unsealer.openTotpSecret(orgA, { ...boc, keyVersion: "kms-totp-2" })).rejects.toThrow(/^khong mo duoc bi mat TOTP$/u);
    const hong = Buffer.from(boc.ciphertext);
    hong[hong.length - 1] = (hong[hong.length - 1] ?? 0) ^ 0x01;
    await expect(unsealer.openTotpSecret(orgA, { ...boc, ciphertext: hong })).rejects.toThrow(/^khong mo duoc bi mat TOTP$/u);
    // Sai CMK (KeyId lệch): cũng cùng thông điệp.
    const { unsealer: saiKhoa } = taoBoMaBiMatTotpAwsKms({ client: kms, keyId: "alias/khac", keyVersion: "kms-totp-1" });
    await expect(saiKhoa.openTotpSecret(orgA, boc)).rejects.toThrow(/^khong mo duoc bi mat TOTP$/u);
    // Đối chứng: đúng tổ chức, đúng phiên bản vẫn mở được — các lần từ chối ở trên là vì ngữ cảnh.
    expect((await unsealer.openTotpSecret(orgA, boc)).length).toBe(20);
  });

  it("không bao giờ trả rỗng: KMS trả Plaintext rỗng/thiếu ⇒ ném; bí mật rỗng không được bọc", async () => {
    const rong: KmsTotp = { send: () => Promise.resolve({ $metadata: {}, Plaintext: new Uint8Array(0) }) };
    const { unsealer } = bo(rong);
    await expect(unsealer.openTotpSecret(orgA, { ciphertext: new Uint8Array(40), keyVersion: "kms-totp-1" })).rejects.toThrow(/khong mo duoc/u);
    const thieu: KmsTotp = { send: () => Promise.resolve({ $metadata: {} }) };
    await expect(bo(thieu).unsealer.openTotpSecret(orgA, { ciphertext: new Uint8Array(40), keyVersion: "kms-totp-1" })).rejects.toThrow(/khong mo duoc/u);
    await expect(bo(thieu).wrapper.wrapTotpSecret(orgA, randomBytes(20))).rejects.toThrow(/ciphertext/u);
    await expect(bo(new KmsTotpGia()).wrapper.wrapTotpSecret(orgA, new Uint8Array(0))).rejects.toThrow(/rong/u);
  });

  it("orgId không phải UUID bị từ chối TRƯỚC khi gọi KMS; cấu hình sai bị từ chối lúc dựng", async () => {
    const kms = new KmsTotpGia();
    const { wrapper, unsealer } = bo(kms);
    await expect(wrapper.wrapTotpSecret("khong-uuid", randomBytes(20))).rejects.toThrow(/UUID/u);
    await expect(unsealer.openTotpSecret("khong-uuid", { ciphertext: new Uint8Array(40), keyVersion: "kms-totp-1" })).rejects.toThrow(/UUID/u);
    expect(kms.lenh).toHaveLength(0);
    expect(() => taoBoMaBiMatTotpAwsKms({ client: kms, keyId: "", keyVersion: "v1" })).toThrow(/keyId/u);
    expect(() => bo(kms, "")).toThrow(/keyVersion/u);
    expect(() => bo(kms, "co khoang trang")).toThrow(/keyVersion/u);
  });
});
