// [sổ nợ 38] Trần thời gian cho việc ngoài CSDL: lỗi mang TÊN riêng, promise gốc bị bỏ, hai adapter KMS được bọc.
import { describe, expect, it } from "vitest";
import type { KeyWrapper } from "@trustprocure/crypto-keys";
import type { TotpSecretUnsealer } from "@trustprocure/identity";
import { KMS_TIMEOUT_MS_MAC_DINH, QuaHanError, boiTranKms, coHan } from "./co-han.js";
import type { TotpSecretWrapper } from "./route-types.js";

const treo = () => new Promise<never>(() => undefined);

describe("[sổ nợ 38] coHan / boiTranKms", () => {
  it("việc xong trước trần ⇒ trả kết quả; treo ⇒ ném lỗi mang đúng tên, không giữ tiến trình", async () => {
    await expect(coHan(() => Promise.resolve(7), 100, "X")).resolves.toBe(7);
    const loi = await coHan(() => treo(), 20, "KmsQuaHan").catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(QuaHanError);
    expect((loi as Error).name).toBe("KmsQuaHan");
    await expect(coHan(() => Promise.reject(new Error("goc")), 100, "X")).rejects.toThrow("goc");
  });

  it("boiTranKms: wrapper/unsealer treo ⇒ KmsQuaHan trong trần; các trường khác giữ NGUYÊN tham chiếu; kind/name giữ nguyên", async () => {
    const wrapper: TotpSecretWrapper = { name: "treo", wrapTotpSecret: () => treo() };
    const unsealer: TotpSecretUnsealer = { kind: "TOTP_SECRET_UNSEALER", name: "treo", openTotpSecret: () => treo() };
    const khac = { name: "khac" };
    const rfqKeyWrapper: KeyWrapper = { name: "rfq-treo", wrap: () => treo() };
    const boc = boiTranKms({ totpSecretWrapper: wrapper, totpSecretUnsealer: unsealer, rfqKeyWrapper, khac }, 20);
    expect(boc.khac).toBe(khac);
    // [review H4-8] Lời gọi KMS thứ ba (openRfq) cũng có trần.
    expect(boc.rfqKeyWrapper.name).toBe("rfq-treo");
    await expect(boc.rfqKeyWrapper.wrap("o", new Uint8Array(1))).rejects.toMatchObject({ name: "KmsQuaHan" });
    expect(boc.totpSecretUnsealer.kind).toBe("TOTP_SECRET_UNSEALER");
    expect(boc.totpSecretWrapper.name).toBe("treo");
    await expect(boc.totpSecretWrapper.wrapTotpSecret("o", new Uint8Array(1))).rejects.toMatchObject({ name: "KmsQuaHan" });
    await expect(boc.totpSecretUnsealer.openTotpSecret("o", { ciphertext: new Uint8Array(1), keyVersion: "v" })).rejects.toMatchObject({ name: "KmsQuaHan" });
    expect(KMS_TIMEOUT_MS_MAC_DINH).toBe(5000);
  });
});
