// ==============================================================================================
// [khoản 15 / S1.128] CẤU HÌNH CỦA `apps/public-keys` — FAIL-CLOSED, VÀ KHÔNG IN GIÁ TRỊ
//
// `docCauHinh` là hàm THUẦN nên mọi ca đo ở T1. Hai vế nặng:
//   ⑴ hai bộ biến khoá LOẠI TRỪ nhau (ADR-064 quy tắc ⑷), cùng tên biến với `apps/api` để cùng một
//      tệp env công bố đúng khoá mà `api` ký;
//   ⑵ không thông điệp lỗi nào mang GIÁ TRỊ — dưới `local-dev` giá trị là KHOÁ RIÊNG.
// ==============================================================================================

import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CauHinhError, docCauHinh } from "./cau-hinh.js";

function capKhoa(): { pkcs8: string; spki: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    pkcs8: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    spki: publicKey.export({ type: "spki", format: "der" }),
  };
}

const K1 = capKhoa();
const K2 = capKhoa();

function envLocalDev(): Record<string, string> {
  return {
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `r1=${K1.pkcs8},r2=${K2.pkcs8}`,
    TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "r2",
  };
}

function envKms(): Record<string, string> {
  return {
    TRUSTPROCURE_KEY_ADAPTER: "aws-kms",
    TRUSTPROCURE_AWS_REGION: "ap-southeast-1",
    TRUSTPROCURE_KMS_RECEIPT_KEYS: "kms-2026-01=alias/tp-receipt-sign-2026-01, kms-2026-09=arn:aws:kms:ap-southeast-1:111122223333:key/abcd",
    TRUSTPROCURE_KMS_RECEIPT_KID: "kms-2026-09",
  };
}

/** Bắt thông điệp lỗi — và khẳng định nó là `CauHinhError`, không phải một lỗi lạc. */
function loiCua(env: Record<string, string>): string {
  try {
    docCauHinh(env);
  } catch (e) {
    expect(e).toBeInstanceOf(CauHinhError);
    return (e as Error).message;
  }
  throw new Error("cấu hình này lẽ ra phải bị từ chối");
}

describe("[khoản 15 / S1.128] cấu hình public-keys — local-dev", () => {
  it("đối chứng dương: đọc ra ĐÚNG nửa công khai, cùng tên biến và cùng định dạng với apps/api", () => {
    const ch = docCauHinh(envLocalDev());
    if (ch.keyAdapter !== "local-dev") throw new Error("fixture khai local-dev");
    expect(ch.receiptKeys.active).toBe("r2");
    expect([...ch.receiptKeys.publicKeys.keys()]).toEqual(["r1", "r2"]);
    expect(Buffer.from(ch.receiptKeys.publicKeys.get("r1")!).equals(K1.spki)).toBe(true);
    expect(Buffer.from(ch.receiptKeys.publicKeys.get("r2")!).equals(K2.spki)).toBe(true);
    expect(ch.listenHost).toBe("127.0.0.1");
    expect(ch.listenPort).toBe(8091);
  });

  it("cấu hình đã đọc KHÔNG giữ khoá riêng — chỉ nửa công khai đi qua cửa `docCauHinh`", () => {
    const ch = docCauHinh(envLocalDev());
    if (ch.keyAdapter !== "local-dev") throw new Error("fixture khai local-dev");
    const tatCa = Buffer.concat([...ch.receiptKeys.publicKeys.values()].map((b) => Buffer.from(b)));
    for (const k of [K1, K2]) {
      const rieng = Buffer.from(k.pkcs8, "base64");
      expect(tatCa.includes(rieng)).toBe(false);
      expect(JSON.stringify(ch)).not.toContain(k.pkcs8);
    }
    // Đối chứng cho phép tìm trên: chính nó bắt được khi khoá riêng CÓ mặt.
    expect(Buffer.concat([tatCa, Buffer.from(K1.pkcs8, "base64")]).includes(Buffer.from(K1.pkcs8, "base64"))).toBe(true);
  });

  it.each(["TRUSTPROCURE_KEY_ADAPTER", "TRUSTPROCURE_RECEIPT_SIGNING_KEYS", "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE"])(
    "thiếu %s ⇒ ném, nêu đúng tên biến",
    (ten) => {
      const env = envLocalDev();
      delete env[ten];
      expect(loiCua(env)).toContain(ten);
    },
  );

  it("khoá riêng hỏng, không phải P-256, base64 lệch ⇒ ném, và KHÔNG in giá trị", () => {
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    for (const giaTri of ["QUJDRA==", p384, "khong-phai-base64!!", `${K1.pkcs8.slice(0, -4)}`]) {
      const env = { ...envLocalDev(), TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `r1=${giaTri}`, TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "r1" };
      const tb = loiCua(env);
      expect(tb).toContain("TRUSTPROCURE_RECEIPT_SIGNING_KEYS");
      expect(tb).not.toContain(giaTri);
    }
  });

  it("phiên bản trùng, phiên bản đang dùng không có ⇒ ném", () => {
    expect(loiCua({ ...envLocalDev(), TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `r1=${K1.pkcs8},r1=${K2.pkcs8}` })).toContain("hai lần");
    expect(loiCua({ ...envLocalDev(), TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "r9" })).toContain("TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE");
  });

  it.each(["TRUSTPROCURE_AWS_REGION", "TRUSTPROCURE_KMS_RECEIPT_KEYS", "TRUSTPROCURE_KMS_RECEIPT_KID"])(
    "[ADR-064 ⑷] local-dev mà còn khai %s của aws-kms ⇒ ném",
    (ten) => {
      const tb = loiCua({ ...envLocalDev(), [ten]: envKms()[ten]! });
      expect(tb).toContain(ten);
      expect(tb).not.toContain(envKms()[ten]!);
    },
  );
});

describe("[khoản 15 / S1.128] cấu hình public-keys — aws-kms", () => {
  it("đối chứng dương: NHIỀU kid, đúng thứ tự khai, và kid đang dùng", () => {
    const ch = docCauHinh(envKms());
    if (ch.keyAdapter !== "aws-kms") throw new Error("fixture khai aws-kms");
    expect(ch.kms).toEqual({
      region: "ap-southeast-1",
      khoa: [
        { kid: "kms-2026-01", keyId: "alias/tp-receipt-sign-2026-01" },
        { kid: "kms-2026-09", keyId: "arn:aws:kms:ap-southeast-1:111122223333:key/abcd" },
      ],
      activeKid: "kms-2026-09",
    });
  });

  it.each(["TRUSTPROCURE_AWS_REGION", "TRUSTPROCURE_KMS_RECEIPT_KEYS", "TRUSTPROCURE_KMS_RECEIPT_KID"])(
    "thiếu %s ⇒ ném, nêu đúng tên biến",
    (ten) => {
      const env = envKms();
      delete env[ten];
      expect(loiCua(env)).toContain(ten);
    },
  );

  it.each(["TRUSTPROCURE_RECEIPT_SIGNING_KEYS", "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE"])(
    "[ADR-064 ⑷] aws-kms mà còn khai %s của local-dev ⇒ ném, và KHÔNG in khoá riêng",
    (ten) => {
      const tb = loiCua({ ...envKms(), [ten]: envLocalDev()[ten]! });
      expect(tb).toContain(ten);
      expect(tb).not.toContain(K1.pkcs8);
      expect(tb).not.toContain(K2.pkcs8);
    },
  );

  const cacCaSai: Array<[string, Record<string, string>, string]> = [
    ["mục thiếu dấu =", { TRUSTPROCURE_KMS_RECEIPT_KEYS: "alias/tp-receipt-sign" }, "TRUSTPROCURE_KMS_RECEIPT_KEYS"],
    ["kid trùng", { TRUSTPROCURE_KMS_RECEIPT_KEYS: "kms-2026-09=alias/a,kms-2026-09=alias/b" }, "TRUSTPROCURE_KMS_RECEIPT_KEYS"],
    ["keyId trùng", { TRUSTPROCURE_KMS_RECEIPT_KEYS: "kms-2026-01=alias/a,kms-2026-09=alias/a" }, "TRUSTPROCURE_KMS_RECEIPT_KEYS"],
    ["kid sai ký tự", { TRUSTPROCURE_KMS_RECEIPT_KEYS: "kms 2026=alias/a", TRUSTPROCURE_KMS_RECEIPT_KID: "kms 2026" }, "TRUSTPROCURE_KMS_RECEIPT_KEYS"],
    ["keyId sai ký tự", { TRUSTPROCURE_KMS_RECEIPT_KEYS: "kms-2026-09=alias/bi mat" }, "TRUSTPROCURE_KMS_RECEIPT_KEYS"],
    ["không có mục nào", { TRUSTPROCURE_KMS_RECEIPT_KEYS: " , " }, "TRUSTPROCURE_KMS_RECEIPT_KEYS"],
    ["kid đang dùng không có trong danh sách", { TRUSTPROCURE_KMS_RECEIPT_KID: "kms-2027-01" }, "TRUSTPROCURE_KMS_RECEIPT_KID"],
    ["vùng sai", { TRUSTPROCURE_AWS_REGION: "mat-trang-1a" }, "TRUSTPROCURE_AWS_REGION"],
  ];
  it.each(cacCaSai)("%s ⇒ ném, nêu tên biến, không in giá trị", (_ten, de, bien) => {
    const env = { ...envKms(), ...de };
    const tb = loiCua(env);
    expect(tb).toContain(bien);
    for (const v of Object.values(de)) expect(tb).not.toContain(v);
  });
});

describe("[khoản 15 / S1.128] cấu hình public-keys — chung", () => {
  it("adapter lạ ⇒ ném, KHÔNG rơi về local-dev, và không vọng lại giá trị", () => {
    const tb = loiCua({ ...envLocalDev(), TRUSTPROCURE_KEY_ADAPTER: "hsm-bi-mat" });
    expect(tb).toContain("TRUSTPROCURE_KEY_ADAPTER");
    expect(tb).not.toContain("hsm-bi-mat");
  });

  it("host/cổng: mặc định an toàn (loopback), khai được, cổng sai ⇒ ném", () => {
    const ch = docCauHinh({ ...envKms(), TRUSTPROCURE_PUBLIC_KEYS_HOST: "0.0.0.0", TRUSTPROCURE_PUBLIC_KEYS_PORT: "0" });
    expect([ch.listenHost, ch.listenPort]).toEqual(["0.0.0.0", 0]);
    for (const p of ["65536", "-1", "80a"]) {
      expect(loiCua({ ...envKms(), TRUSTPROCURE_PUBLIC_KEYS_PORT: p })).toContain("TRUSTPROCURE_PUBLIC_KEYS_PORT");
    }
  });

  it("dấu vân tay local-dev khớp SHA-256 của SPKI mà apps/api dẫn ra từ cùng khoá riêng", () => {
    // Hai tiến trình đọc CÙNG biến; nếu `public-keys` dẫn ra một SPKI khác `api` thì mọi biên nhận
    // dev hỏng kiểm chứng. Phép so ở đây là với `node:crypto` trực tiếp — cách `docVongKhoaKy` của api làm.
    const ch = docCauHinh(envLocalDev());
    if (ch.keyAdapter !== "local-dev") throw new Error("fixture khai local-dev");
    const vt = createHash("sha256").update(ch.receiptKeys.publicKeys.get("r1")!).digest("hex");
    expect(vt).toBe(createHash("sha256").update(K1.spki).digest("hex"));
  });
});
