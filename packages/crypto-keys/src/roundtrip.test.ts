import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyPairWithoutPlaintextCommand,
  KMSClient,
  type DecryptCommandOutput,
  type GenerateDataKeyPairWithoutPlaintextCommandOutput,
} from "@aws-sdk/client-kms";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertDevSinkAllowed,
  assertLocalDevAllowed,
  createAwsKmsOrgKeyProvisioner,
  createLocalDevOrgKeyProvisioner,
  createLocalDevWrapper,
  KeyError,
  MasterKeyRing,
  wrapForOrg,
  type KmsSinhCapKhoa,
  type ProvisionedOrgKey,
  type WrappedKey,
} from "./index.js";
import {
  createAwsKmsOrgUnwrapper,
  createLocalDevOrgUnwrapper,
  createLocalDevUnwrapper,
  type KmsMoKhoa,
  type OrgKeyHandle,
} from "./unwrap.js";

function ring(): MasterKeyRing {
  return new MasterKeyRing("v2", {
    v1: randomBytes(32),
    v2: randomBytes(32),
  });
}

describe("vòng đời khóa", () => {
  it("bọc rồi mở trả lại đúng nguyên bản", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();

    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 512 }), async (plaintext) => {
        const wrapped = await wrapper.wrap(orgId, plaintext);
        const opened = await unwrapper.unwrap(orgId, wrapped);
        expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Không gắn [INV-A2]: A2 phát biểu "giá dạng rõ không tồn tại trong api service tại bất kỳ
  // thời điểm nào — kể cả bộ nhớ, log, APM trace, thông báo lỗi" (docs/TEST-PLAN.md:36), một
  // bất biến kiến trúc ở tầng service api, đo bằng bộ quét rò rỉ (T2/T5). Test dưới đây chỉ
  // kiểm tra một tính chất hẹp hơn nhiều của AES-GCM (ciphertext không chứa chuỗi con của bản
  // rõ) — một phép kiểm tra hạ tầng hữu ích nhưng không phải bằng chứng cho A2. Gắn nhãn A2 ở
  // đây sẽ tạo bằng chứng giả trong ma trận kiểm thử (phát hiện I3, fix round 1).
  it("ciphertext không chứa chuỗi con của bản rõ", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("gia-bao-1250000-VND-bi-mat");

    const wrapped = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(wrapped.ciphertext).includes(plaintext)).toBe(false);
  });

  // Không gắn [INV-G2]: G2 phát biểu "mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ
  // khác" (docs/TEST-PLAN.md, hàng **G2** — ~~`:100`~~ [S1.79] đã trôi tới 108, neo theo MÃ hàng)
  // — một bất biến về cô lập khóa theo RFQ. Package này (Task 7)
  // chưa có khái niệm RFQ/bid trong chữ ký wrap()/unwrap() — đơn vị cô lập duy nhất hiện có là
  // orgId (bất biến F3, đã có test riêng bên dưới). G2 THỰC SỰ CHƯA ĐƯỢC PHỦ bởi test nào ở
  // Task 7; cần một task sau (khi wrap()/unwrap() nhận thêm contextId cho rfqId/bidId — xem
  // ruling AAD của controller, hoãn qua S1) mới viết được test đúng cho G2. Hai test dưới đây
  // kiểm tra tính toàn vẹn AEAD (GCM tag) chống giả mạo — một bất biến mật mã hạ tầng thật
  // nhưng không trùng với phát biểu của G2, nên không gắn tag nào.
  it("lật một byte trong vùng tag GCM (offset 13-28) làm unwrap ném lỗi toàn vẹn", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    // Định dạng phong bì: version(1) || iv(12) || tag(16) || ciphertext — vùng tag là
    // offset 13..28 (16 byte, kết thúc trước HEADER_LENGTH = 29).
    const hong = Uint8Array.from(wrapped.ciphertext);
    hong[20] = hong[20]! ^ 0xff;

    await expect(unwrapper.unwrap(orgId, { ...wrapped, ciphertext: hong })).rejects.toThrow(
      /dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức/i,
    );
  });

  it("lật byte 0 (phiên bản định dạng) làm unwrap ném lỗi phiên bản không hỗ trợ", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    const hong = Uint8Array.from(wrapped.ciphertext);
    hong[0] = hong[0]! ^ 0xff;

    await expect(unwrapper.unwrap(orgId, { ...wrapped, ciphertext: hong })).rejects.toThrow(
      /phiên bản định dạng .* không hỗ trợ/i,
    );
  });

  it("sửa keyVersion trong WrappedKey làm unwrap ném lỗi (AAD ràng buộc keyVersion)", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    // wrapped.keyVersion đang là "v2" (phiên bản active của ring()). Sửa nó sang "v1" —
    // vẫn là một phiên bản hợp lệ trong ring nên ring.get() không ném, nhưng AAD dùng để
    // tính tag xác thực đã ràng buộc keyVersion gốc ("v2"), nên đổi keyVersion mà không đổi
    // lại ciphertext phải làm decipher.setAuthTag()/final() thất bại.
    const gia = { ...wrapped, keyVersion: "v1" };
    await expect(unwrapper.unwrap(orgId, gia)).rejects.toThrow(
      /dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức/i,
    );
  });

  it("từ chối orgId rỗng ở cả wrap() và unwrap()", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);

    await expect(wrapper.wrap("", Buffer.from("x"))).rejects.toThrow(/orgId phải là UUID hợp lệ/i);
    await expect(unwrapper.unwrap("", { ciphertext: new Uint8Array(29), keyVersion: "v2" })).rejects.toThrow(
      /orgId phải là UUID hợp lệ/i,
    );
  });

  it("từ chối orgId không phải UUID ở cả wrap() và unwrap()", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);

    await expect(wrapper.wrap("khong-phai-uuid", Buffer.from("x"))).rejects.toThrow(
      /orgId phải là UUID hợp lệ/i,
    );
    await expect(
      unwrapper.unwrap("khong-phai-uuid", { ciphertext: new Uint8Array(29), keyVersion: "v2" }),
    ).rejects.toThrow(/orgId phải là UUID hợp lệ/i);
  });

  it("ciphertext hỏng (không phải mảng byte) ném KeyError, không phải TypeError trần", async () => {
    const r = ring();
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();

    // Mô phỏng dữ liệu DB hỏng: cột ciphertext là null/undefined thay vì bytea. Ép kiểu qua
    // `unknown` (không dùng `any`) vì WrappedKey thật sự không cho phép ciphertext là null —
    // đây là cách duy nhất để mô phỏng dữ liệu hỏng từ bên ngoài hợp đồng kiểu.
    const hong = { ciphertext: null, keyVersion: "v2" } as unknown as WrappedKey;
    await expect(unwrapper.unwrap(orgId, hong)).rejects.toThrow(KeyError);
    await expect(unwrapper.unwrap(orgId, hong)).rejects.toThrow(/ciphertext không hợp lệ/i);
  });

  it("[INV-F3] khóa của tổ chức khác không mở được phong bì", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgA = randomUUID();
    const orgB = randomUUID();

    const wrapped = await wrapper.wrap(orgA, Buffer.from("du lieu cua to chuc A"));
    await expect(unwrapper.unwrap(orgB, wrapped)).rejects.toThrow(/mở phong bì thất bại/i);
  });

  it("[INV-G3] xoay master key vẫn mở được phong bì bọc bằng phiên bản cũ", async () => {
    const v1 = randomBytes(32);
    const cu = new MasterKeyRing("v1", { v1 });
    const orgId = randomUUID();
    const plaintext = Buffer.from("bao gia cu");

    const wrappedCu = await createLocalDevWrapper(cu).wrap(orgId, plaintext);
    expect(wrappedCu.keyVersion).toBe("v1");

    // Sau khi xoay: v2 là phiên bản đang dùng, v1 vẫn giữ để giải mã dữ liệu cũ.
    const sauXoay = new MasterKeyRing("v2", { v1, v2: randomBytes(32) });
    const opened = await createLocalDevUnwrapper(sauXoay).unwrap(orgId, wrappedCu);
    expect(Buffer.from(opened).equals(plaintext)).toBe(true);

    // Phong bì mới dùng phiên bản mới.
    const wrappedMoi = await createLocalDevWrapper(sauXoay).wrap(orgId, plaintext);
    expect(wrappedMoi.keyVersion).toBe("v2");
  });

  it("[INV-G3] thiếu phiên bản khóa trong vòng khóa thì báo lỗi rõ ràng", async () => {
    const orgId = randomUUID();
    const wrapped = await createLocalDevWrapper(
      new MasterKeyRing("v1", { v1: randomBytes(32) }),
    ).wrap(orgId, Buffer.from("x"));

    const thieu = new MasterKeyRing("v9", { v9: randomBytes(32) });
    await expect(createLocalDevUnwrapper(thieu).unwrap(orgId, wrapped)).rejects.toThrow(
      /không có phiên bản khóa "v1"/i,
    );
  });

  it("hai lần bọc cùng bản rõ cho ra hai phong bì khác nhau", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("cung mot noi dung");

    const a = await wrapper.wrap(orgId, plaintext);
    const b = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("từ chối master key không đủ 32 byte", () => {
    expect(() => new MasterKeyRing("v1", { v1: randomBytes(16) })).toThrow(/32 byte/);
  });

  it("từ chối vòng khóa không chứa phiên bản đang dùng", () => {
    expect(() => new MasterKeyRing("v2", { v1: randomBytes(32) })).toThrow(/phiên bản đang dùng/i);
  });
});

// =============================================================================================
// [ADR-062] CẶP KHOÁ CỦA TỔ CHỨC: bọc bằng khoá CÔNG KHAI, mở bằng khoá riêng mở MỘT lần mỗi lượt
// =============================================================================================
describe("cặp khoá tổ chức (ADR-062)", () => {
  async function capKhoa(r: MasterKeyRing, orgId = randomUUID()): Promise<ProvisionedOrgKey> {
    return createLocalDevOrgKeyProvisioner(r).generate(orgId);
  }

  async function moKhoa(r: MasterKeyRing, k: ProvisionedOrgKey): Promise<OrgKeyHandle> {
    return createLocalDevOrgUnwrapper(r).openOrgKey(k);
  }

  function lat(b: Uint8Array, viTri: number): Uint8Array {
    const c = new Uint8Array(b);
    c[viTri] = (c[viTri] ?? 0) ^ 0x01;
    return c;
  }

  it("bọc bằng khoá công khai rồi mở bằng handle trả lại đúng nguyên bản", async () => {
    const r = ring();
    const k = await capKhoa(r);
    const banRo = randomBytes(138);
    const daBoc = wrapForOrg(k, banRo);
    const h = await moKhoa(r, k);
    try {
      expect(Buffer.from(h.unwrap(daBoc)).equals(banRo)).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("thuộc tính: mọi bản rõ 0–2048 byte đều khứ hồi nguyên vẹn", async () => {
    const r = ring();
    const k = await capKhoa(r);
    const h = await moKhoa(r, k);
    try {
      fc.assert(
        fc.property(fc.uint8Array({ minLength: 0, maxLength: 2048 }), (banRo) => {
          expect(Buffer.from(h.unwrap(wrapForOrg(k, banRo))).equals(Buffer.from(banRo))).toBe(true);
        }),
        { numRuns: 50 },
      );
    } finally {
      h.dispose();
    }
  });

  it("bộ sinh trả SPKI P-256 và khoá riêng ĐÃ BỌC — không có PKCS#8 dạng rõ nào lọt ra", async () => {
    const r = ring();
    const k = await capKhoa(r);
    expect(k.keyVersion).toBe("v2");
    const congKhai = createPublicKey({ key: Buffer.from(k.publicKey), format: "der", type: "spki" });
    expect(congKhai.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    // PKCS#8 của một khoá P-256 luôn mở đầu bằng cùng một tiền tố ASN.1; bản bọc v1 thì không.
    const tienToPkcs8 = Buffer.from("308187020100301306072a8648ce3d020106082a8648ce3d030107", "hex");
    expect(Buffer.from(k.wrappedPrivateKey).includes(tienToPkcs8)).toBe(false);
    expect(k.wrappedPrivateKey[0]).toBe(1);
  });

  it("phong bì v2 đúng định dạng: 0x02 ‖ điểm 65 byte (0x04…) ‖ iv 12 ‖ tag 16 ‖ thân", async () => {
    const k = await capKhoa(ring());
    const daBoc = wrapForOrg(k, new Uint8Array(40));
    expect(daBoc.keyVersion).toBe(k.keyVersion);
    expect(daBoc.ciphertext[0]).toBe(2);
    expect(daBoc.ciphertext[1]).toBe(4);
    expect(daBoc.ciphertext.length).toBe(1 + 65 + 12 + 16 + 40);
  });

  it("hai lần bọc cùng bản rõ cho ra hai phong bì khác nhau (khoá tạm thời mới mỗi lần)", async () => {
    const k = await capKhoa(ring());
    const banRo = randomBytes(64);
    const a = Buffer.from(wrapForOrg(k, banRo).ciphertext);
    const b = Buffer.from(wrapForOrg(k, banRo).ciphertext);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(1, 66).equals(b.subarray(1, 66))).toBe(false);
  });

  it.each([
    ["phiên bản định dạng", 0, /phiên bản định dạng/],
    ["điểm tạm thời", 40, /không hợp lệ|toàn vẹn/],
    ["iv", 70, /toàn vẹn/],
    ["tag", 85, /toàn vẹn/],
    ["thân", 100, /toàn vẹn/],
  ])("lật một bit ở %s làm unwrap ném KeyError", async (_ten, viTri, thongDiep) => {
    const r = ring();
    const k = await capKhoa(r);
    const daBoc = wrapForOrg(k, randomBytes(32));
    const h = await moKhoa(r, k);
    try {
      expect(() => h.unwrap({ ...daBoc, ciphertext: lat(daBoc.ciphertext, viTri) })).toThrow(KeyError);
      expect(() => h.unwrap({ ...daBoc, ciphertext: lat(daBoc.ciphertext, viTri) })).toThrow(thongDiep);
      // Đối chứng: bản không lật vẫn mở được bằng CÙNG handle.
      expect(h.unwrap(daBoc).length).toBe(32);
    } finally {
      h.dispose();
    }
  });

  it("[INV-F3] khoá của tổ chức khác không mở được khoá RFQ, kể cả khi chép nguyên phong bì", async () => {
    const r = ring();
    const a = await capKhoa(r);
    const b = await capKhoa(r);
    const daBoc = wrapForOrg(a, randomBytes(32));
    const hB = await moKhoa(r, b);
    try {
      expect(() => hB.unwrap(daBoc)).toThrow(KeyError);
    } finally {
      hB.dispose();
    }
    // AAD ràng buộc orgId: khoá công khai của A dán dưới tên B không cho ra phong bì mà A mở được.
    const hA = await moKhoa(r, a);
    try {
      const saiTen = wrapForOrg({ ...a, orgId: b.orgId }, randomBytes(32));
      expect(() => hA.unwrap(saiTen)).toThrow(KeyError);
    } finally {
      hA.dispose();
    }
  });

  it("khai sai phiên bản cặp khoá thì bị từ chối (AAD ràng buộc keyVersion)", async () => {
    const r = ring();
    const k = await capKhoa(r);
    const daBoc = wrapForOrg(k, randomBytes(16));
    const h = await moKhoa(r, k);
    try {
      expect(() => h.unwrap({ ...daBoc, keyVersion: "v1" })).toThrow(/phiên bản cặp khoá/);
    } finally {
      h.dispose();
    }
  });

  it("sau dispose(), handle không mở được gì nữa", async () => {
    const r = ring();
    const k = await capKhoa(r);
    const daBoc = wrapForOrg(k, randomBytes(16));
    const h = await moKhoa(r, k);
    expect(h.unwrap(daBoc).length).toBe(16);
    h.dispose();
    expect(() => h.unwrap(daBoc)).toThrow(/dispose/);
  });

  it("[INV-G3] xoay master key: cặp khoá sinh dưới phiên bản cũ vẫn mở được", async () => {
    const keys = { v1: randomBytes(32), v2: randomBytes(32) };
    const cu = await capKhoa(new MasterKeyRing("v1", keys));
    const daBoc = wrapForOrg(cu, randomBytes(24));
    const h = await moKhoa(new MasterKeyRing("v2", keys), cu);
    try {
      expect(h.unwrap(daBoc).length).toBe(24);
    } finally {
      h.dispose();
    }
  });

  it("wrapForOrg từ chối khoá công khai không phải P-256 và orgId không phải UUID", async () => {
    const k = await capKhoa(ring());
    const x25519 = generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" });
    expect(() => wrapForOrg({ ...k, publicKey: x25519 }, randomBytes(8))).toThrow(/P-256/);
    expect(() => wrapForOrg({ ...k, publicKey: randomBytes(91) }, randomBytes(8))).toThrow(KeyError);
    expect(() => wrapForOrg({ ...k, orgId: "khong-phai-uuid" }, randomBytes(8))).toThrow(/UUID/);
  });

  it("mở khoá riêng tổ chức bằng vòng khoá khác thì thất bại, không cho ra khoá rác", async () => {
    const k = await capKhoa(ring());
    await expect(moKhoa(ring(), k)).rejects.toThrow(KeyError);
  });
});

// =============================================================================================
// [ADR-062] ADAPTER aws-kms — ĐO TRÊN MỘT KMS GIẢ, VÀ ĐÓ LÀ GIỚI HẠN NÓI THẲNG
//
// KMS giả dưới đây làm đúng hai việc KMS thật làm với một CMK đối xứng: sinh cặp P-256 rồi bọc khoá
// riêng bằng AES-GCM với AAD là encryption context, và `Decrypt` từ chối khi context hay KeyId lệch.
// Nó đo ADAPTER — lệnh nào được gửi, với tham số nào, bao nhiêu lần, và phản hồi dị dạng bị từ chối
// ra sao. Nó KHÔNG đo key policy, IAM hay định dạng blob thật của AWS: đó là phép đo ⒜ của ADR-062,
// chạy trên tài khoản thật.
// =============================================================================================
class KmsGia implements KmsSinhCapKhoa, KmsMoKhoa {
  readonly cmk = randomBytes(32);
  readonly lenh: Array<{ ten: string; input: unknown }> = [];
  constructor(readonly keyArn = "arn:aws:kms:ap-southeast-1:942091277863:key/gia") {}

  send(lenh: GenerateDataKeyPairWithoutPlaintextCommand): Promise<GenerateDataKeyPairWithoutPlaintextCommandOutput>;
  send(lenh: DecryptCommand): Promise<DecryptCommandOutput>;
  send(
    lenh: GenerateDataKeyPairWithoutPlaintextCommand | DecryptCommand,
  ): Promise<GenerateDataKeyPairWithoutPlaintextCommandOutput | DecryptCommandOutput> {
    // Ném trong executor thành một Promise bị từ chối — đúng hình lỗi của KMSClient thật.
    return new Promise((resolve) => resolve(this.xuLy(lenh)));
  }

  private xuLy(
    lenh: GenerateDataKeyPairWithoutPlaintextCommand | DecryptCommand,
  ): GenerateDataKeyPairWithoutPlaintextCommandOutput | DecryptCommandOutput {
    this.lenh.push({ ten: lenh.constructor.name, input: lenh.input });
    const meta = { $metadata: {} };
    if (lenh instanceof GenerateDataKeyPairWithoutPlaintextCommand) {
      const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const pkcs8 = cap.privateKey.export({ format: "der", type: "pkcs8" });
      return {
        ...meta,
        KeyId: this.keyArn,
        KeyPairSpec: "ECC_NIST_P256",
        PublicKey: cap.publicKey.export({ format: "der", type: "spki" }),
        PrivateKeyCiphertextBlob: this.boc(pkcs8, lenh.input.EncryptionContext),
      };
    }
    if (lenh.input.KeyId !== "alias/tp-org-wrap") throw new Error("IncorrectKeyException");
    return { ...meta, KeyId: this.keyArn, Plaintext: this.mo(lenh.input.CiphertextBlob!, lenh.input.EncryptionContext) };
  }

  private boc(banRo: Uint8Array, ctx: Record<string, string> | undefined): Uint8Array {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.cmk, iv);
    c.setAAD(Buffer.from(JSON.stringify(ctx ?? {})));
    const than = Buffer.concat([c.update(banRo), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), than]);
  }

  private mo(blob: Uint8Array, ctx: Record<string, string> | undefined): Uint8Array {
    const b = Buffer.from(blob);
    const d = createDecipheriv("aes-256-gcm", this.cmk, b.subarray(0, 12));
    d.setAAD(Buffer.from(JSON.stringify(ctx ?? {})));
    d.setAuthTag(b.subarray(12, 28));
    try {
      return Buffer.concat([d.update(b.subarray(28)), d.final()]);
    } catch {
      throw new Error("InvalidCiphertextException");
    }
  }
}

describe("adapter aws-kms cho cặp khoá tổ chức (ADR-062)", () => {
  const KEY_ID = "alias/tp-org-wrap";

  it("KMSClient thật thoả hai mặt tối thiểu mà adapter đòi (phép kiểm kiểu, không gọi mạng)", () => {
    const client = new KMSClient({ region: "ap-southeast-1" });
    const sinh: KmsSinhCapKhoa = client;
    const mo: KmsMoKhoa = client;
    expect(sinh).toBe(mo);
    client.destroy();
  });

  it("sinh bằng GenerateDataKeyPairWithoutPlaintext, bọc cục bộ, mở bằng ĐÚNG MỘT Decrypt cho nhiều khoá RFQ", async () => {
    const kms = new KmsGia();
    const orgId = randomUUID();
    const k = await createAwsKmsOrgKeyProvisioner({ client: kms, keyId: KEY_ID, keyVersion: "kms-1" }).generate(orgId);
    expect(k).toMatchObject({ orgId, keyVersion: "kms-1" });
    expect(kms.lenh).toEqual([
      {
        ten: "GenerateDataKeyPairWithoutPlaintextCommand",
        input: { KeyId: KEY_ID, KeyPairSpec: "ECC_NIST_P256", EncryptionContext: { org_id: orgId } },
      },
    ]);

    const banRo = Array.from({ length: 5 }, () => randomBytes(138));
    const daBoc = banRo.map((b) => wrapForOrg(k, b));
    expect(kms.lenh).toHaveLength(1);

    const h = await createAwsKmsOrgUnwrapper({ client: kms, keyId: KEY_ID }).openOrgKey(k);
    try {
      daBoc.forEach((d, i) => expect(Buffer.from(h.unwrap(d)).equals(banRo[i]!)).toBe(true));
    } finally {
      h.dispose();
    }
    expect(kms.lenh.map((l) => l.ten)).toEqual(["GenerateDataKeyPairWithoutPlaintextCommand", "DecryptCommand"]);
    expect(kms.lenh[1]!.input).toEqual({
      KeyId: KEY_ID,
      CiphertextBlob: k.wrappedPrivateKey,
      EncryptionContext: { org_id: orgId },
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    });
    expect(() => h.unwrap(daBoc[0]!)).toThrow(/dispose/);
  });

  it("khoá riêng đã bọc của tổ chức A đem mở dưới org_id của B ⇒ KMS từ chối, lỗi là KeyError", async () => {
    const kms = new KmsGia();
    const k = await createAwsKmsOrgKeyProvisioner({ client: kms, keyId: KEY_ID, keyVersion: "kms-1" }).generate(
      randomUUID(),
    );
    const mo = createAwsKmsOrgUnwrapper({ client: kms, keyId: KEY_ID });
    await expect(mo.openOrgKey({ ...k, orgId: randomUUID() })).rejects.toThrow(KeyError);
    // Đối chứng: cùng blob, đúng org_id thì mở được — lần từ chối trên là vì context, không vì blob hỏng.
    (await mo.openOrgKey(k)).dispose();
  });

  it("lỗi KMS (sai CMK, từ chối quyền) thành KeyError, giữ nguyên lỗi gốc ở cause", async () => {
    const kms = new KmsGia();
    const k = await createAwsKmsOrgKeyProvisioner({ client: kms, keyId: KEY_ID, keyVersion: "kms-1" }).generate(
      randomUUID(),
    );
    const loi = await createAwsKmsOrgUnwrapper({ client: kms, keyId: "alias/khac" })
      .openOrgKey(k)
      .catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(KeyError);
    expect((loi as KeyError).cause).toBeInstanceOf(Error);

    const tuChoi: KmsSinhCapKhoa = { send: () => Promise.reject(new Error("AccessDeniedException")) };
    await expect(
      createAwsKmsOrgKeyProvisioner({ client: tuChoi, keyId: KEY_ID, keyVersion: "kms-1" }).generate(randomUUID()),
    ).rejects.toThrow(KeyError);
  });

  it("phản hồi dị dạng của KMS bị từ chối trước khi vào CSDL", async () => {
    const x25519 = generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" });
    const hopLe = await new KmsGia().send(new GenerateDataKeyPairWithoutPlaintextCommand({ KeyId: KEY_ID, KeyPairSpec: "ECC_NIST_P256" }));
    const phanHoi: Array<Partial<GenerateDataKeyPairWithoutPlaintextCommandOutput>> = [
      { ...hopLe, KeyPairSpec: "ECC_NIST_P384" },
      { ...hopLe, PublicKey: undefined },
      { ...hopLe, PrivateKeyCiphertextBlob: new Uint8Array(0) },
      { ...hopLe, KeyPairSpec: undefined, PublicKey: x25519 },
    ];
    for (const ra of phanHoi) {
      const client: KmsSinhCapKhoa = { send: () => Promise.resolve({ $metadata: {}, ...ra }) };
      await expect(
        createAwsKmsOrgKeyProvisioner({ client, keyId: KEY_ID, keyVersion: "kms-1" }).generate(randomUUID()),
      ).rejects.toThrow(KeyError);
    }
    const rong: KmsMoKhoa = { send: () => Promise.resolve({ $metadata: {} }) };
    const k = await createAwsKmsOrgKeyProvisioner({ client: new KmsGia(), keyId: KEY_ID, keyVersion: "kms-1" }).generate(
      randomUUID(),
    );
    await expect(createAwsKmsOrgUnwrapper({ client: rong, keyId: KEY_ID }).openOrgKey(k)).rejects.toThrow(/bản rõ/);
  });

  it("cấu hình sai bị từ chối lúc dựng, không phải lúc gọi đầu tiên", () => {
    const kms = new KmsGia();
    expect(() => createAwsKmsOrgKeyProvisioner({ client: kms, keyId: " ", keyVersion: "kms-1" })).toThrow(KeyError);
    expect(() => createAwsKmsOrgKeyProvisioner({ client: kms, keyId: KEY_ID, keyVersion: "" })).toThrow(KeyError);
    expect(() => createAwsKmsOrgKeyProvisioner({ client: kms, keyId: KEY_ID, keyVersion: "v".repeat(65) })).toThrow(
      KeyError,
    );
    expect(() => createAwsKmsOrgUnwrapper({ client: kms, keyId: "" })).toThrow(KeyError);
  });

  it("orgId không phải UUID bị từ chối trước khi gọi KMS", async () => {
    const kms = new KmsGia();
    await expect(
      createAwsKmsOrgKeyProvisioner({ client: kms, keyId: KEY_ID, keyVersion: "kms-1" }).generate("khong-phai-uuid"),
    ).rejects.toThrow(/UUID/);
    expect(kms.lenh).toHaveLength(0);
  });
});

describe("rào chắn cho adapter local-dev (bất biến G1)", () => {
  // ==========================================================================================
  // [REVIEW AN NINH S1.4 — MED-1] KHỐI NÀY ĐƯỢC VIẾT LẠI, VÀ MỘT TEST CŨ ĐÃ ĐỔI DẤU
  //
  // Bộ cũ đo một hàng rào DANH SÁCH TÊN: chặn khi `NODE_ENV` khẳng định là production, cho qua
  // ở mọi giá trị khác — kể cả KHÔNG ĐẶT, mặc định của một container trần. Nó tự gọi mình là
  // fail-closed và nó không phải.
  //
  // Test cũ *"không chặn khi NODE_ENV là một chuỗi vô hại chứa 'prod'"* (với `producthunt`) NAY
  // ĐỔI DẤU: `producthunt` bị chặn, và đó là ĐÚNG. Nó được giữ lại dưới tên mới thay vì xoá, vì
  // nó là bằng chứng đọc được rằng hàng rào đã đảo chiều — chứ không phải một dòng biến mất.
  //
  // Luật mới: `TRUSTPROCURE_KEY_ADAPTER="local-dev"` là lời khai DƯƠNG duy nhất; `NODE_ENV` ở
  // ba giá trị dev rõ ràng là lớp thứ hai; không nói gì = TỪ CHỐI.
  // ==========================================================================================
  const NODE_ENV_GOC = process.env["NODE_ENV"];
  const CO_GHI_DE_GOC = process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
  const ADAPTER_GOC = process.env["TRUSTPROCURE_KEY_ADAPTER"];

  function datLai(): void {
    for (const [ten, goc] of [
      ["NODE_ENV", NODE_ENV_GOC],
      ["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS", CO_GHI_DE_GOC],
      ["TRUSTPROCURE_KEY_ADAPTER", ADAPTER_GOC],
    ] as const) {
      if (goc === undefined) delete process.env[ten];
      else process.env[ten] = goc;
    }
  }

  function dat(env: Record<string, string | undefined>): void {
    for (const ten of ["NODE_ENV", "TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS", "TRUSTPROCURE_KEY_ADAPTER"]) {
      const v = env[ten];
      if (v === undefined) delete process.env[ten];
      else process.env[ten] = v;
    }
  }

  it("[INV-G1] MẶC ĐỊNH LÀ TỪ CHỐI: không biến môi trường nào được đặt thì cả hai factory chặn", () => {
    // Đây là ca mà bộ cũ CHO QUA, và nó là ca thường gặp nhất trong một container trần.
    dat({});
    try {
      expect(() => createLocalDevWrapper(ring())).toThrow(/không tiến trình nào khai báo/);
      expect(() => createLocalDevUnwrapper(ring())).toThrow(/không tiến trình nào khai báo/);
      // [ADR-062] Hai factory của cặp khoá tổ chức dùng CHUNG hàng rào — không có cửa thứ hai.
      expect(() => createLocalDevOrgKeyProvisioner(ring())).toThrow(/không tiến trình nào khai báo/);
      expect(() => createLocalDevOrgUnwrapper(ring())).toThrow(/không tiến trình nào khai báo/);
    } finally {
      datLai();
    }
  });

  it.each(["production", "Production", "PRODUCTION", "prod", "  production  ", "PROD",
           "staging", "live", "release", "prd", "producthunt"])(
    '[INV-G1] chặn khi NODE_ENV="%s" và không có lời khai adapter nào',
    (bienThe) => {
      // `producthunt` nằm trong danh sách này CÓ CHỦ ĐÍCH — xem khối đầu describe. Ở bộ cũ nó là
      // một ca ĐƯỢC QUA; nay nó bị chặn, vì hàng rào không còn đoán ý nghĩa của một chuỗi lạ.
      dat({ NODE_ENV: bienThe });
      try {
        expect(() => createLocalDevWrapper(ring())).toThrow(/local-dev/);
        expect(() => createLocalDevUnwrapper(ring())).toThrow(/local-dev/);
      } finally {
        datLai();
      }
    },
  );

  it.each(["development", "dev", "test"])(
    '[INV-G1] cho qua khi NODE_ENV="%s" — ba giá trị dev RÕ RÀNG, không phải "khác production"',
    (bienThe) => {
      dat({ NODE_ENV: bienThe });
      try {
        expect(() => createLocalDevWrapper(ring())).not.toThrow();
        expect(() => createLocalDevUnwrapper(ring())).not.toThrow();
      } finally {
        datLai();
      }
    },
  );

  // ~~it("[INV-G1] lời khai DƯƠNG thắng mọi NODE_ENV", …)~~ — [S1.11 / review H3-2] Câu ấy đúng cho
  // mọi NODE_ENV TRỪ production: từ S1.11 cấu hình của tiến trình `api` BẮT BUỘC khai `local-dev`
  // (adapter duy nhất), nên "lời khai dương một mình mở cửa" nghĩa là mọi cấu hình khởi động được
  // đều mở cửa, kể cả production. Nay production + local-dev là MÂU THUẪN ⇒ chặn; cờ ghi đè vẫn là
  // đường cuối.
  it.each(["staging", "live", "producthunt", "development"])(
    '[INV-G1] lời khai DƯƠNG thắng NODE_ENV="%s" — mọi giá trị KHÔNG phải production',
    (bienThe) => {
      dat({ NODE_ENV: bienThe, TRUSTPROCURE_KEY_ADAPTER: "local-dev" });
      try {
        expect(() => createLocalDevWrapper(ring())).not.toThrow();
        expect(() => createLocalDevUnwrapper(ring())).not.toThrow();
      } finally {
        datLai();
      }
    },
  );

  it.each(["production", "prod", " PRODUCTION "])(
    '[INV-G1][S1.11] lời khai DƯƠNG + NODE_ENV="%s" là mâu thuẫn ⇒ chặn; thêm cờ ghi đè ⇒ qua',
    (bienThe) => {
      dat({ NODE_ENV: bienThe, TRUSTPROCURE_KEY_ADAPTER: "local-dev" });
      try {
        expect(() => createLocalDevWrapper(ring())).toThrow(/mâu thuẫn/);
        expect(() => createLocalDevUnwrapper(ring())).toThrow(/mâu thuẫn/);
      } finally {
        datLai();
      }
      dat({ NODE_ENV: bienThe, TRUSTPROCURE_KEY_ADAPTER: "local-dev", TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS: "1" });
      try {
        expect(() => createLocalDevWrapper(ring())).not.toThrow();
      } finally {
        datLai();
      }
    },
  );

  it("[INV-G1] khai một adapter KHÁC thì bị chặn kể cả ở máy phát triển", () => {
    // Một tiến trình nói nó dùng KMS thì không được dựng bộ bọc khoá nội bộ — kể cả khi
    // `NODE_ENV=development`. Không có vế này, lời khai dương chỉ nới ra chứ không siết vào.
    dat({ NODE_ENV: "development", TRUSTPROCURE_KEY_ADAPTER: "aws-kms" });
    try {
      expect(() => createLocalDevWrapper(ring())).toThrow(/đang là "aws-kms"/);
      expect(() => createLocalDevUnwrapper(ring())).toThrow(/đang là "aws-kms"/);
    } finally {
      datLai();
    }
  });

  it("[INV-G1] cờ ghi đè vẫn mở được cửa, và nó là đường CUỐI CÙNG còn lại", () => {
    dat({ NODE_ENV: "production", TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS: "1" });
    try {
      expect(() => createLocalDevWrapper(ring())).not.toThrow();
      expect(() => createLocalDevUnwrapper(ring())).not.toThrow();
    } finally {
      datLai();
    }
  });
});

describe("[ADR-064] hàng rào của adapter gửi/cảnh báo dev — tách khỏi hàng rào khoá", () => {
  const BIEN = ["NODE_ENV", "TRUSTPROCURE_KEY_ADAPTER", "TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS", "TRUSTPROCURE_ALLOW_DEV_SINKS"] as const;
  const GOC = Object.fromEntries(BIEN.map((b) => [b, process.env[b]]));

  function chay(env: Partial<Record<(typeof BIEN)[number], string>>, fn: () => void): void {
    for (const b of BIEN) {
      const v = env[b];
      if (v === undefined) delete process.env[b];
      else process.env[b] = v;
    }
    try {
      fn();
    } finally {
      for (const b of BIEN) {
        const g = GOC[b];
        if (g === undefined) delete process.env[b];
        else process.env[b] = g;
      }
    }
  }

  it("khoá KHÔNG phải aws-kms ⇒ CHÍNH LÀ assertLocalDevAllowed (không nới gì)", () => {
    chay({}, () => expect(() => assertDevSinkAllowed()).toThrow(KeyError));
    chay({ NODE_ENV: "production", TRUSTPROCURE_KEY_ADAPTER: "local-dev" }, () =>
      expect(() => assertDevSinkAllowed()).toThrow(/mâu thuẫn/),
    );
    chay({ TRUSTPROCURE_KEY_ADAPTER: "local-dev" }, () => expect(() => assertDevSinkAllowed()).not.toThrow());
    // Một adapter khoá lạ vẫn bị chặn như trước.
    chay({ NODE_ENV: "development", TRUSTPROCURE_KEY_ADAPTER: "vault" }, () =>
      expect(() => assertDevSinkAllowed()).toThrow(/"vault"/),
    );
  });

  it("khoá aws-kms ⇒ cho qua ngoài production; production cần ĐÚNG cờ riêng của nó", () => {
    chay({ TRUSTPROCURE_KEY_ADAPTER: "aws-kms" }, () => expect(() => assertDevSinkAllowed()).not.toThrow());
    chay({ TRUSTPROCURE_KEY_ADAPTER: "aws-kms", NODE_ENV: "staging" }, () => expect(() => assertDevSinkAllowed()).not.toThrow());
    for (const nodeEnv of ["production", "PROD", " Production "]) {
      chay({ TRUSTPROCURE_KEY_ADAPTER: "aws-kms", NODE_ENV: nodeEnv }, () =>
        expect(() => assertDevSinkAllowed()).toThrow(/TRUSTPROCURE_ALLOW_DEV_SINKS/),
      );
    }
    chay({ TRUSTPROCURE_KEY_ADAPTER: "aws-kms", NODE_ENV: "production", TRUSTPROCURE_ALLOW_DEV_SINKS: "1" }, () =>
      expect(() => assertDevSinkAllowed()).not.toThrow(),
    );
    // Cờ của KHOÁ không mở hộp thư dev dưới aws-kms: hai quyết định, hai cờ.
    chay({ TRUSTPROCURE_KEY_ADAPTER: "aws-kms", NODE_ENV: "production", TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS: "1" }, () =>
      expect(() => assertDevSinkAllowed()).toThrow(/TRUSTPROCURE_ALLOW_DEV_SINKS/),
    );
  });

  it("cờ của hộp thư dev KHÔNG mở adapter khoá local-dev dưới aws-kms", () => {
    chay({ TRUSTPROCURE_KEY_ADAPTER: "aws-kms", NODE_ENV: "development", TRUSTPROCURE_ALLOW_DEV_SINKS: "1" }, () => {
      expect(() => assertDevSinkAllowed()).not.toThrow();
      expect(() => assertLocalDevAllowed()).toThrow(/đang là "aws-kms"/);
      expect(() => createLocalDevWrapper(ring())).toThrow(/đang là "aws-kms"/);
    });
  });
});
