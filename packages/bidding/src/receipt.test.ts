// ==============================================================================================
// BIÊN NHẬN — PHẦN ĐO ĐƯỢC MÀ KHÔNG CẦN CSDL
//
// [B2] Phép đo quan trọng nhất của file này là phép đo NGHÈO NHẤT: kiểm chứng một biên nhận khi
// trong tay chỉ có ba thứ — văn bản, chữ ký, khoá công khai. Nếu nó cần thêm bất cứ thứ gì, B2
// đã hỏng, và nó hỏng theo đúng cách §"Rủi ro của việc để mở" của ADR-011 mô tả: *im lặng*.
// ==============================================================================================

import { createSign, createVerify, generateKeyPairSync, type webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RECEIPT_FORMAT_LABEL,
  RECEIPT_SIGNING_ALGORITHM,
  ReceiptError,
  ReceiptSigningKeyRing,
  buildReceiptText,
  createLocalDevReceiptSigner,
  derToRawSignature,
  parseReceiptText,
  rawToDerSignature,
  sha256Hex,
  verifyReceipt,
  type ReceiptKeyPair,
} from "./index.js";

const RFQ = "11111111-1111-4111-8111-111111111111";
const BID = "22222222-2222-4222-8222-222222222222";
const KHI_NAO = "2026-09-04T10:15:32.123456Z";

function truong(ghiDe: Partial<Parameters<typeof buildReceiptText>[0]> = {}) {
  return {
    kid: "ky-2026-09",
    rfqId: RFQ,
    bidId: BID,
    version: 1,
    ciphertextSha256: "a".repeat(64),
    submittedAt: KHI_NAO,
    ...ghiDe,
  };
}

/** Một cặp khoá ECDSA P-256, hai nửa ở dạng DER — đúng dạng vòng khoá và KMS dùng. */
function capKhoa(): ReceiptKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey: new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" })),
    publicKey: new Uint8Array(publicKey.export({ type: "spki", format: "der" })),
  };
}

describe("văn bản chính tắc của biên nhận", () => {
  it("dựng đúng khuôn, đúng thứ tự trường, và kết thúc bằng một dòng mới", () => {
    const t = buildReceiptText(truong());
    expect(t).toBe(
      [
        RECEIPT_FORMAT_LABEL,
        `alg=${RECEIPT_SIGNING_ALGORITHM}`,
        "kid=ky-2026-09",
        `rfq_id=${RFQ}`,
        `bid_id=${BID}`,
        "version=1",
        `ciphertext_sha256=${"a".repeat(64)}`,
        `submitted_at=${KHI_NAO}`,
        "",
      ].join("\n"),
    );
    // Dòng mới cuối cùng là một phần của định dạng, không phải một sơ suất: trình soạn thảo của
    // nhà cung cấp sẽ tự thêm nó khi họ lưu tệp để chạy `openssl`.
    expect(t.endsWith("\n")).toBe(true);
  });

  it("đọc ngược ra đúng các trường đã dựng", () => {
    expect(parseReceiptText(buildReceiptText(truong({ version: 7 })))).toEqual({
      alg: RECEIPT_SIGNING_ALGORITHM,
      kid: "ky-2026-09",
      rfqId: RFQ,
      bidId: BID,
      version: 7,
      ciphertextSha256: "a".repeat(64),
      submittedAt: KHI_NAO,
    });
  });

  it("TỪ CHỐI mọi trường sai khuôn — mỗi vế đóng một đường", () => {
    expect(() => buildReceiptText(truong({ kid: "khoa\nkid=gia" }))).toThrow(/kid không hợp lệ/);
    expect(() => buildReceiptText(truong({ kid: "khoa=lung" }))).toThrow(/kid không hợp lệ/);
    expect(() => buildReceiptText(truong({ rfqId: "RFQ-1" }))).toThrow(/rfq_id/);
    expect(() => buildReceiptText(truong({ version: 0 }))).toThrow(/version/);
    expect(() => buildReceiptText(truong({ version: 1.5 }))).toThrow(/version/);
    expect(() => buildReceiptText(truong({ ciphertextSha256: "A".repeat(64) }))).toThrow(/hex/);
    // Dấu thời gian THIẾU micro-giây — đây là ca mà một lần dựng từ `Date` của JS sẽ rơi vào,
    // và nó phải đỏ chứ không được lặng lẽ ký một dấu thời gian cắt bớt.
    expect(() => buildReceiptText(truong({ submittedAt: "2026-09-04T10:15:32.123Z" }))).toThrow(
      /micro-giây/,
    );
  });

  it("TỪ CHỐI văn bản hỏng khi đọc ngược, không đọc một phần", () => {
    expect(() => parseReceiptText("khong-phai-bien-nhan\n")).toThrow(/không phải một biên nhận/);
    expect(() => parseReceiptText(buildReceiptText(truong()).slice(0, -1))).toThrow(/dòng mới/);
    const doiThuTu = buildReceiptText(truong()).split("\n");
    [doiThuTu[2], doiThuTu[3]] = [doiThuTu[3] as string, doiThuTu[2] as string];
    expect(() => parseReceiptText(doiThuTu.join("\n"))).toThrow(/phải là "kid"/);
  });
});

describe("chuyển dạng chữ ký DER ↔ RAW", () => {
  it("khứ hồi RAW → DER → RAW giữ nguyên byte, trên 200 chữ ký ngẫu nhiên", () => {
    for (let i = 0; i < 200; i += 1) {
      const raw = new Uint8Array(64);
      globalThis.crypto.getRandomValues(raw);
      expect(Buffer.from(derToRawSignature(rawToDerSignature(raw))).equals(Buffer.from(raw))).toBe(
        true,
      );
    }
  });

  it("đọc được DER THẬT do node:crypto sinh ra — đối chứng với một cài đặt khác", () => {
    // Đây là phép đo đáng giá nhất của khối này: bộ phân tích DER ở đây không được chỉ đọc được
    // thứ chính nó sinh ra. `node:crypto` là một cài đặt độc lập, và nó là cùng dạng mà `openssl`
    // và AWS KMS phát ra.
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const van = buildReceiptText(truong());
    for (let i = 0; i < 20; i += 1) {
      const der = new Uint8Array(createSign("SHA256").update(van).sign(privateKey));
      const raw = derToRawSignature(der);
      expect(raw.length).toBe(64);
      // ... và chiều ngược lại phải cho ra một DER mà `node:crypto` chấp nhận.
      const derLai = rawToDerSignature(raw);
      expect(
        createVerify("SHA256").update(van).verify(publicKey, Buffer.from(derLai)),
      ).toBe(true);
    }
  });

  it("TỪ CHỐI DER hỏng thay vì đoán", () => {
    expect(() => derToRawSignature(new Uint8Array([0x31, 0x02]))).toThrow(/SEQUENCE/);
    expect(() => derToRawSignature(new Uint8Array([0x30]))).toThrow(/cắt cụt/);
    expect(() => derToRawSignature(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01]))).toThrow();
    expect(() => rawToDerSignature(new Uint8Array(63))).toThrow(/64 byte/);
  });
});

describe("[INV-B2] ký và kiểm chứng — bằng khoá công khai một mình", () => {
  it("[INV-B2] kiểm chứng thành công chỉ với VĂN BẢN + CHỮ KÝ + KHOÁ CÔNG KHAI", async () => {
    const k = capKhoa();
    const ring = new ReceiptSigningKeyRing("ky-2026-09", { "ky-2026-09": k });
    const boKy = createLocalDevReceiptSigner(ring);

    const van = buildReceiptText(truong({ kid: boKy.activeKeyId }));
    const chuKy = await boKy.sign(van);

    // Ba thứ, và không thứ nào chỉ máy chủ mới có. Không `client`, không `orgId`, không vòng khoá.
    await expect(
      verifyReceipt({ canonicalText: van, signature: chuKy, publicKey: k.publicKey }),
    ).resolves.toBe(true);
  });

  it("[INV-B2] cùng chữ ký ấy kiểm chứng được bằng MỘT CÀI ĐẶT KHÁC (node:crypto)", async () => {
    // Vế này là thứ biến "kiểm chứng độc lập" từ một câu thành một phép đo: nếu chữ ký chỉ kiểm
    // được bằng chính mã của chúng ta thì nhà cung cấp không kiểm chứng độc lập được gì cả.
    // `createVerify` của Node là con đường mà `openssl dgst -sha256 -verify` đi.
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const k: ReceiptKeyPair = {
      privateKey: new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" })),
      publicKey: new Uint8Array(publicKey.export({ type: "spki", format: "der" })),
    };
    const boKy = createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1: k }));
    const van = buildReceiptText(truong({ kid: "k1" }));
    const chuKy = await boKy.sign(van);

    expect(createVerify("SHA256").update(van).verify(publicKey, Buffer.from(chuKy))).toBe(true);
  });

  it("[INV-B2] ĐỐI CHỨNG ÂM — sửa một byte của VĂN BẢN thì không kiểm chứng được", async () => {
    const k = capKhoa();
    const boKy = createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1: k }));
    const van = buildReceiptText(truong({ kid: "k1", version: 1 }));
    const chuKy = await boKy.sign(van);

    const sua = van.replace("version=1", "version=2");
    expect(sua).not.toBe(van);
    await expect(
      verifyReceipt({ canonicalText: sua, signature: chuKy, publicKey: k.publicKey }),
    ).resolves.toBe(false);
  });

  it("[INV-B2] ĐỐI CHỨNG ÂM — sửa một byte của CHỮ KÝ thì không kiểm chứng được", async () => {
    const k = capKhoa();
    const boKy = createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1: k }));
    const van = buildReceiptText(truong({ kid: "k1" }));
    const chuKy = await boKy.sign(van);

    const sua = Uint8Array.from(chuKy);
    sua[sua.length - 1] = ((sua[sua.length - 1] ?? 0) ^ 0x01) & 0xff;
    await expect(
      verifyReceipt({ canonicalText: van, signature: sua, publicKey: k.publicKey }),
    ).resolves.toBe(false);
  });

  it("[INV-B2] ĐỐI CHỨNG ÂM — khoá công khai của MỘT KHOÁ KHÁC thì không kiểm chứng được", async () => {
    const k1 = capKhoa();
    const k2 = capKhoa();
    const boKy = createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1 }));
    const van = buildReceiptText(truong({ kid: "k1" }));
    const chuKy = await boKy.sign(van);

    await expect(
      verifyReceipt({ canonicalText: van, signature: chuKy, publicKey: k2.publicKey }),
    ).resolves.toBe(false);
  });

  it("TỪ CHỐI (chứ không trả false) khi ĐẦU VÀO hỏng — hai ca khác nhau, hai phản ứng khác nhau", async () => {
    const k = capKhoa();
    const boKy = createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1: k }));
    const van = buildReceiptText(truong({ kid: "k1" }));
    const chuKy = await boKy.sign(van);

    // Văn bản không phải biên nhận -> lỗi lập trình, không phải "chữ ký sai".
    await expect(
      verifyReceipt({ canonicalText: "rac\n", signature: chuKy, publicKey: k.publicKey }),
    ).rejects.toThrow(ReceiptError);
    // Khoá công khai không đọc được -> cũng vậy.
    await expect(
      verifyReceipt({ canonicalText: van, signature: chuKy, publicKey: new Uint8Array(8) }),
    ).rejects.toThrow(/Khoá công khai không đọc được/);
  });
});

describe("[ADR-011 mục 3] xoay khoá ký — biên nhận CŨ vẫn kiểm chứng được", () => {
  it("phát bằng khoá cũ, xoay sang khoá mới, biên nhận cũ VẪN kiểm chứng được", async () => {
    const cu = capKhoa();
    const moi = capKhoa();

    const truocKhiXoay = createLocalDevReceiptSigner(
      new ReceiptSigningKeyRing("ky-2026-08", { "ky-2026-08": cu }),
    );
    const vanCu = buildReceiptText(truong({ kid: truocKhiXoay.activeKeyId }));
    const chuKyCu = await truocKhiXoay.sign(vanCu);

    // Xoay = THÊM một khoá rồi chuyển `activeKeyId`. Khoá cũ Ở LẠI.
    const sauKhiXoay = new ReceiptSigningKeyRing("ky-2026-09", {
      "ky-2026-08": cu,
      "ky-2026-09": moi,
    });
    const boKyMoi = createLocalDevReceiptSigner(sauKhiXoay);
    expect(boKyMoi.activeKeyId).toBe("ky-2026-09");

    // Bên kiểm chứng đọc `kid` TỪ VĂN BẢN ĐÃ KÝ rồi tra khoá công khai tương ứng.
    const kid = parseReceiptText(vanCu).kid;
    expect(kid).toBe("ky-2026-08");
    const congKhai = sauKhiXoay.publicKeys().get(kid);
    expect(congKhai).toBeDefined();
    await expect(
      verifyReceipt({
        canonicalText: vanCu,
        signature: chuKyCu,
        publicKey: congKhai ?? new Uint8Array(0),
      }),
    ).resolves.toBe(true);

    // Đối chứng: khoá MỚI thì không mở được biên nhận cũ — nên "giữ khoá cũ" không phải trang trí.
    await expect(
      verifyReceipt({ canonicalText: vanCu, signature: chuKyCu, publicKey: moi.publicKey }),
    ).resolves.toBe(false);
  });

  it("gỡ một khoá cũ khỏi vòng khoá làm lỗi NÓI RA hệ quả, không im lặng", () => {
    const ring = new ReceiptSigningKeyRing("k2", { k2: capKhoa() });
    expect(() => ring.get("k1")).toThrow(/không kiểm chứng được/);
  });

  it("vòng khoá TỪ CHỐI một cấu hình không dùng được", () => {
    expect(() => new ReceiptSigningKeyRing("k9", { k1: capKhoa() })).toThrow(/không chứa khoá/);
    expect(() => new ReceiptSigningKeyRing("k1", {})).toThrow(/ít nhất một khoá/);
    expect(() => new ReceiptSigningKeyRing("k 1", { "k 1": capKhoa() })).toThrow(/không hợp lệ/);
  });
});

describe("[ADR-011] tính MỀM DẺO của ECDSA — đo ra chứ không giả vờ là không có", () => {
  it("từ một chữ ký hợp lệ dựng được chữ ký thứ HAI cũng hợp lệ, KHÔNG cần khoá riêng", async () => {
    // Đây là lý do lược đồ `bid_receipts` KHÔNG có ràng buộc duy nhất nào trên `signature`, và
    // lý do "mã biên nhận" không bao giờ được là chuỗi byte chữ ký. Phép đo này biến một câu
    // trong ADR thành một sự thật quan sát được — và nếu một ngày ai đó thêm `UNIQUE (signature)`
    // thì đây là test giải thích vì sao điều đó nguy hiểm.
    const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const k = capKhoa();
    const boKy = createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1: k }));
    const van = buildReceiptText(truong({ kid: "k1" }));
    const chuKy = await boKy.sign(van);

    const raw = derToRawSignature(chuKy);
    const doc = (x: Uint8Array): bigint => {
      let v = 0n;
      for (const b of x) v = (v << 8n) | BigInt(b);
      return v;
    };
    const viet = (v: bigint): Uint8Array => {
      const ra = new Uint8Array(32);
      for (let i = 31; i >= 0; i -= 1) {
        ra[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      return ra;
    };
    const s = doc(raw.subarray(32));
    const rawKhac = new Uint8Array(64);
    rawKhac.set(raw.subarray(0, 32), 0);
    rawKhac.set(viet(N - s), 32);

    const chuKyKhac = rawToDerSignature(rawKhac);
    expect(Buffer.from(chuKyKhac).equals(Buffer.from(chuKy))).toBe(false);

    // HAI chuỗi byte KHÁC NHAU, CÙNG hợp lệ cho CÙNG một văn bản.
    await expect(
      verifyReceipt({ canonicalText: van, signature: chuKyKhac, publicKey: k.publicKey }),
    ).resolves.toBe(true);
  });
});

describe("hàng rào môi trường của bộ ký dev", () => {
  it("bị CHẶN khi NODE_ENV=production, và chặn NGAY lúc tạo chứ không đợi lần ký đầu", () => {
    const cu = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "Production";
    try {
      expect(() =>
        createLocalDevReceiptSigner(new ReceiptSigningKeyRing("k1", { k1: capKhoa() })),
      ).toThrow(/local-dev/);
    } finally {
      if (cu === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = cu;
    }
  });
});

describe("sha256Hex", () => {
  it("khớp với một giá trị đã biết", async () => {
    // sha256("") — hằng chuẩn, tra được ở bất kỳ đâu; nó chống một cài đặt "băm" tự chế.
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("kiểu trả về khớp khuôn của trường ciphertext_sha256", async () => {
    const bam = await sha256Hex(new TextEncoder().encode("phong bi"));
    expect(bam).toMatch(/^[0-9a-f]{64}$/);
    expect(() => buildReceiptText(truong({ ciphertextSha256: bam }))).not.toThrow();
  });
});

// Giữ tham chiếu kiểu để `webcrypto` không thành import chết nếu file được rút gọn về sau.
export type _KieuKhoa = webcrypto.CryptoKey;
