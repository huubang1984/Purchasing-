// [ADR-064] `dungKhoa` chọn bốn adapter khoá theo `keyAdapter`, và hai nhánh không lẫn vào nhau:
// dưới `aws-kms` không adapter nào là local-dev (và không vòng khoá nào được dựng), dưới `local-dev`
// không `KMSClient` nào được dựng. Không gọi mạng: dựng `KMSClient` không mở kết nối.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { docCauHinh, type MoiTruong } from "./cau-hinh.js";
import { dungKhoa } from "./composition.js";

const CHUNG: MoiTruong = {
  TRUSTPROCURE_DATABASE_URL: "postgres://app_api_login:mk@127.0.0.1:5432/trustprocure",
  TRUSTPROCURE_PUBLIC_BASE_URL: "https://mua.vidu.vn",
  TRUSTPROCURE_OTP_PEPPERS: `p1=${randomBytes(32).toString("base64")}`,
  TRUSTPROCURE_OTP_PEPPER_ACTIVE: "p1",
  TRUSTPROCURE_SENDER_ADAPTER: "dev-mailbox",
  TRUSTPROCURE_DEV_MAILBOX_DIR: join(tmpdir(), "hop-thu-dev"),
  TRUSTPROCURE_TRUSTED_PROXIES: "direct",
};

const ADAPTER_GOC = process.env["TRUSTPROCURE_KEY_ADAPTER"];
afterEach(() => {
  if (ADAPTER_GOC === undefined) delete process.env["TRUSTPROCURE_KEY_ADAPTER"];
  else process.env["TRUSTPROCURE_KEY_ADAPTER"] = ADAPTER_GOC;
});

describe("[ADR-064] dungKhoa — bốn adapter khoá theo TRUSTPROCURE_KEY_ADAPTER", () => {
  it("aws-kms ⇒ cả bốn adapter là aws-kms, kid là nhãn cấu hình", () => {
    const ch = docCauHinh({
      ...CHUNG,
      TRUSTPROCURE_KEY_ADAPTER: "aws-kms",
      TRUSTPROCURE_AWS_REGION: "ap-southeast-1",
      TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID: "alias/tp-org-wrap",
      TRUSTPROCURE_KMS_ORG_KEY_VERSION: "kms-1",
      TRUSTPROCURE_KMS_TOTP_KEY_ID: "alias/tp-totp",
      TRUSTPROCURE_KMS_TOTP_KEY_VERSION: "kms-totp-1",
      TRUSTPROCURE_KMS_RECEIPT_KEY_ID: "alias/tp-receipt-sign",
      TRUSTPROCURE_KMS_RECEIPT_KID: "kms-2026-09",
    });
    // Dưới aws-kms, hàng rào local-dev CHẶN mọi adapter khoá local-dev — nên nếu `dungKhoa` lỡ dựng một
    // cái, test này ném thay vì chỉ so tên.
    process.env["TRUSTPROCURE_KEY_ADAPTER"] = "aws-kms";
    const k = dungKhoa(ch);
    try {
      expect([k.orgKeyProvisioner.name, k.totpSecretWrapper.name, k.totpSecretUnsealer.name, k.receiptSigner.name]).toEqual([
        "aws-kms",
        "aws-kms",
        "aws-kms",
        "aws-kms",
      ]);
      expect(k.receiptSigner.activeKeyId).toBe("kms-2026-09");
      expect(k.totpSecretUnsealer.kind).toBe("TOTP_SECRET_UNSEALER");
    } finally {
      k.dong();
    }
  });

  it("local-dev ⇒ cả bốn adapter là local-dev", () => {
    const ky = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" });
    const ch = docCauHinh({
      ...CHUNG,
      TRUSTPROCURE_KEY_ADAPTER: "local-dev",
      TRUSTPROCURE_MASTER_KEYS: `v1=${randomBytes(32).toString("base64")}`,
      TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
      TRUSTPROCURE_TOTP_MASTER_KEYS: `t1=${randomBytes(32).toString("base64")}`,
      TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "t1",
      TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `ky-1=${ky.toString("base64")}`,
      TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "ky-1",
    });
    process.env["TRUSTPROCURE_KEY_ADAPTER"] = "local-dev";
    const k = dungKhoa(ch);
    expect([k.orgKeyProvisioner.name, k.totpSecretWrapper.name, k.totpSecretUnsealer.name, k.receiptSigner.name]).toEqual([
      "local-dev",
      "local-dev",
      "local-dev",
      "local-dev",
    ]);
    expect(k.receiptSigner.activeKeyId).toBe("ky-1");
    k.dong();
  });
});
