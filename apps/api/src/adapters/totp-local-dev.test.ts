// [S1.11] Adapter dev của cổng `TotpSecretUnsealer` giữ đúng ba tính chất hợp đồng đòi: ràng buộc
// tổ chức, ném khi không mở được, và phân biệt kiểu với `KeyUnwrapper`.
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { MasterKeyRing } from "@trustprocure/crypto-keys";
import { taoBoMaBiMatTotp } from "./totp-local-dev.js";

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const vong = () => new MasterKeyRing("t1", { t1: K1 });
const orgA = randomUUID();
const orgB = randomUUID();

afterEach(() => {
  delete process.env["TRUSTPROCURE_KEY_ADAPTER"];
});

describe("[S1.11] bọc/mở bí mật TOTP local-dev", () => {
  it("roundtrip; hai lần bọc cùng bí mật cho hai phong bì khác nhau; phong bì không chứa bí mật rõ", async () => {
    const { wrapper, unsealer } = taoBoMaBiMatTotp(vong());
    const biMat = randomBytes(20);
    const b1 = await wrapper.wrapTotpSecret(orgA, biMat);
    const b2 = await wrapper.wrapTotpSecret(orgA, biMat);
    expect(b1.keyVersion).toBe("t1");
    expect(Buffer.from(b1.ciphertext).equals(Buffer.from(b2.ciphertext))).toBe(false);
    expect(Buffer.from(b1.ciphertext).includes(biMat)).toBe(false);
    expect(Buffer.from(await unsealer.openTotpSecret(orgA, b1)).equals(biMat)).toBe(true);
    expect(unsealer.kind).toBe("TOTP_SECRET_UNSEALER");
    expect(unsealer.name).toBe("local-dev");
    expect(wrapper.name).toBe("local-dev");
  });

  it("ràng buộc tổ chức: bọc ở A không mở ở B — cùng một thông điệp với phong bì bị sửa (không oracle)", async () => {
    const { wrapper, unsealer } = taoBoMaBiMatTotp(vong());
    const boc = await wrapper.wrapTotpSecret(orgA, randomBytes(20));
    await expect(unsealer.openTotpSecret(orgB, boc)).rejects.toThrow(/khong mo duoc bi mat TOTP/u);
    const hong = Buffer.from(boc.ciphertext);
    const cuoi = hong.length - 1;
    hong[cuoi] = (hong[cuoi] ?? 0) ^ 0x01;
    await expect(unsealer.openTotpSecret(orgA, { ...boc, ciphertext: hong })).rejects.toThrow(/khong mo duoc bi mat TOTP/u);
    // Đổi phiên bản trong hàng mà không đổi ciphertext: AAD không khớp ⇒ ném (kể cả khi vòng có phiên bản ấy).
    const vongHai = new MasterKeyRing("t1", { t1: K1, t2: K2 });
    const { unsealer: u2 } = taoBoMaBiMatTotp(vongHai);
    await expect(u2.openTotpSecret(orgA, { ...boc, keyVersion: "t2" })).rejects.toThrow(/khong mo duoc bi mat TOTP/u);
  });

  it("phiên bản không có trong vòng, phong bì quá ngắn, orgId không phải UUID ⇒ ném — không bao giờ trả rỗng", async () => {
    const { wrapper, unsealer } = taoBoMaBiMatTotp(vong());
    const boc = await wrapper.wrapTotpSecret(orgA, randomBytes(20));
    await expect(unsealer.openTotpSecret(orgA, { ...boc, keyVersion: "t9" })).rejects.toThrow(/t9/u);
    await expect(unsealer.openTotpSecret(orgA, { keyVersion: "t1", ciphertext: new Uint8Array(20) })).rejects.toThrow(/qua ngan/u);
    await expect(unsealer.openTotpSecret("khong-uuid", boc)).rejects.toThrow(/UUID/u);
    await expect(wrapper.wrapTotpSecret("khong-uuid", randomBytes(20))).rejects.toThrow(/UUID/u);
    // Bí mật rỗng: bọc được về mặt mật mã, nhưng mở ra phải NÉM (fail-open trên khoá HMAC rỗng — hợp đồng identity).
    const rong = await wrapper.wrapTotpSecret(orgA, new Uint8Array(0));
    expect(rong.ciphertext).toHaveLength(28); // iv + tag, không một byte thân — bị chặn ở phép kiểm độ dài, trước cả giải mã.
    await expect(unsealer.openTotpSecret(orgA, rong)).rejects.toThrow(/qua ngan|khong mo duoc bi mat TOTP/u);
  });

  it("hai vòng khoá khác nhau không mở được phong bì của nhau — khoá TOTP không dùng chung với khoá RFQ", async () => {
    const a = taoBoMaBiMatTotp(new MasterKeyRing("t1", { t1: K1 }));
    const b = taoBoMaBiMatTotp(new MasterKeyRing("t1", { t1: K2 }));
    const boc = await a.wrapper.wrapTotpSecret(orgA, randomBytes(20));
    await expect(b.unsealer.openTotpSecret(orgA, boc)).rejects.toThrow(/khong mo duoc bi mat TOTP/u);
  });

  it("hàng rào môi trường chạy NGAY KHI TẠO: tiến trình khai adapter KMS thì không dựng được bản dev", () => {
    process.env["TRUSTPROCURE_KEY_ADAPTER"] = "kms";
    expect(() => taoBoMaBiMatTotp(vong())).toThrow(/local-dev/u);
  });
});
