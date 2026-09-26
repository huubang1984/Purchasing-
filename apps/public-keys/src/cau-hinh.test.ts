// [ADR-070] Cấu hình của tiến trình công bố: chỉ nửa công khai, mỗi khoá phải là EC P-256, kid đang dùng phải có mặt.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReceiptSigningKeyRing } from "@trustprocure/bidding";
import { CauHinhError, docCauHinh } from "./cau-hinh.js";
import { buildReceiptKeyDocument, buildReceiptKeyDocumentTuKhoaCongKhai } from "./index.js";

function cap(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" })),
    publicKey: new Uint8Array(publicKey.export({ type: "spki", format: "der" })),
  };
}

const K1 = cap();
const K2 = cap();
const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const envHopLe = (ghiDe: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kms-2026-09": b64(K1.publicKey), "kms-2027-01": b64(K2.publicKey) }),
  TRUSTPROCURE_RECEIPT_ACTIVE_KID: "kms-2027-01",
  ...ghiDe,
});

describe("[ADR-070] docCauHinh — public-keys", () => {
  it("đọc mọi khoá và kid đang dùng; cổng/host mặc định", () => {
    const ch = docCauHinh(envHopLe());
    expect([...ch.publicKeys.keys()]).toEqual(["kms-2026-09", "kms-2027-01"]);
    expect(ch.activeKeyId).toBe("kms-2027-01");
    expect(ch.listenHost).toBe("127.0.0.1");
    expect(ch.listenPort).toBe(8070);
  });

  it("tài liệu dựng từ nửa công khai TRÙNG BYTE tài liệu dựng từ vòng khoá", () => {
    const vong = new ReceiptSigningKeyRing("kms-2027-01", { "kms-2026-09": K1, "kms-2027-01": K2 });
    const ch = docCauHinh(envHopLe());
    expect(JSON.stringify(buildReceiptKeyDocumentTuKhoaCongKhai(ch.activeKeyId, ch.publicKeys))).toBe(
      JSON.stringify(buildReceiptKeyDocument(vong)),
    );
  });

  it("fail-closed: thiếu, không phải JSON, rỗng, kid lạ, không base64, không SPKI, không P-256, kid đang dùng vắng", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" });
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" }).publicKey.export({ type: "spki", format: "der" });
    const hong: Record<string, string | undefined>[] = [
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: undefined },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: "{" },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: "[]" },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: "{}" },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kid lạ": b64(K1.publicKey) }) },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kms-2027-01": "không base64!" }) },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kms-2027-01": b64(new Uint8Array([1, 2, 3])) }) },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kms-2027-01": b64(new Uint8Array(rsa)) }) },
      { TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kms-2027-01": b64(new Uint8Array(p384)) }) },
      { TRUSTPROCURE_RECEIPT_ACTIVE_KID: "kms-2099-01" },
      { TRUSTPROCURE_PUBLIC_KEYS_PORT: "70000" },
    ];
    for (const g of hong) expect(() => docCauHinh(envHopLe(g)), JSON.stringify(g)).toThrow(CauHinhError);
  });

  it("thông điệp lỗi không mang giá trị khoá", () => {
    const giaTri = b64(new Uint8Array([9, 9, 9, 9]));
    try {
      docCauHinh(envHopLe({ TRUSTPROCURE_RECEIPT_PUBLIC_KEYS: JSON.stringify({ "kms-2027-01": giaTri }) }));
    } catch (e) {
      expect((e as Error).message).not.toContain(giaTri);
    }
  });
});
