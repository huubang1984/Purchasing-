// [ADR-069] Kho token Zalo trên Secrets Manager — đo trên client GIẢ: đọc/ghi khứ hồi, secret hỏng ném nêu TRƯỜNG.
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it } from "vitest";
import { phanTichSecretZalo, taoKhoTokenZaloSecretsManager, type SecretsManagerKho } from "./kho-token-zalo.js";

const HOP_LE = { app_id: "123", secret_key: "sk", access_token: "", refresh_token: "rt", het_han_luc: 0 };

describe("[ADR-069] kho token Zalo", () => {
  it("SecretsManagerClient thật thoả mặt tối thiểu (phép kiểm kiểu)", () => {
    const c = new SecretsManagerClient({ region: "ap-southeast-1" });
    const s: SecretsManagerKho = c;
    expect(s).toBe(c);
    c.destroy();
  });

  it("đọc rồi ghi khứ hồi đúng secret, đúng hình dạng JSON", async () => {
    let chuoi = JSON.stringify(HOP_LE);
    const lenh: unknown[] = [];
    const client: SecretsManagerKho = {
      send(l: GetSecretValueCommand | PutSecretValueCommand) {
        lenh.push(l);
        if (l instanceof GetSecretValueCommand) return Promise.resolve({ $metadata: {}, SecretString: chuoi });
        chuoi = l.input.SecretString ?? "";
        return Promise.resolve({ $metadata: {} });
      },
    };
    const kho = taoKhoTokenZaloSecretsManager({ client, secretId: "tp/api/zalo-oa" });
    const tk = await kho.doc();
    expect(tk).toEqual({ appId: "123", secretKey: "sk", accessToken: "", refreshToken: "rt", hetHanLuc: 0 });
    await kho.ghi({ ...tk, accessToken: "at", refreshToken: "rt-2", hetHanLuc: 5 });
    expect(JSON.parse(chuoi)).toEqual({ app_id: "123", secret_key: "sk", access_token: "at", refresh_token: "rt-2", het_han_luc: 5 });
    expect(lenh.every((l) => (l as { input: { SecretId: string } }).input.SecretId === "tp/api/zalo-oa")).toBe(true);
  });

  it("secret hỏng ⇒ ném nêu tên trường, không nội dung", () => {
    expect(() => phanTichSecretZalo(undefined)).toThrow(/JSON/u);
    expect(() => phanTichSecretZalo("[]")).toThrow(/đối tượng/u);
    expect(() => phanTichSecretZalo(JSON.stringify({ ...HOP_LE, refresh_token: "" }))).toThrow(/refresh_token/u);
    expect(() => phanTichSecretZalo(JSON.stringify({ ...HOP_LE, het_han_luc: "0" }))).toThrow(/het_han_luc/u);
    try {
      phanTichSecretZalo(JSON.stringify({ ...HOP_LE, secret_key: 7 }));
    } catch (e) {
      expect((e as Error).message).not.toContain("rt");
    }
  });
});
