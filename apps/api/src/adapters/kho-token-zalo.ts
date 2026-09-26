// ==============================================================================================
// apps/api/src/adapters/kho-token-zalo.ts — KHO TOKEN ZALO TRÊN SECRETS MANAGER (ADR-069)
//
// Một secret JSON (`tp/api/zalo-oa`, stack 85):
//   { "app_id", "secret_key", "access_token", "refresh_token", "het_han_luc" }
// Người vận hành nạp lần đầu `app_id`, `secret_key`, `refresh_token` (từ lần cấp quyền OA), `access_token: ""`,
// `het_han_luc: 0`; adapter tự làm mới và GHI LẠI. IAM của `tp-api` chỉ Get/Put đúng secret này.
//
// Thông điệp lỗi không mang nội dung secret — chỉ tên trường hỏng.
// ==============================================================================================

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  type GetSecretValueCommandOutput,
  type PutSecretValueCommandOutput,
} from "@aws-sdk/client-secrets-manager";
import { GuiKenhError } from "./kenh-so.js";
import type { KhoTokenZalo, TokenZalo } from "./gui-zalo.js";

/** Mặt tối thiểu của `SecretsManagerClient`. */
export interface SecretsManagerKho {
  send(lenh: GetSecretValueCommand): Promise<GetSecretValueCommandOutput>;
  send(lenh: PutSecretValueCommand): Promise<PutSecretValueCommandOutput>;
}

function chuoi(o: Record<string, unknown>, ten: string, choRong: boolean): string {
  const v = o[ten];
  if (typeof v !== "string" || (!choRong && v === "")) throw new GuiKenhError(`secret Zalo: trường ${ten} thiếu hoặc sai kiểu`);
  return v;
}

export function phanTichSecretZalo(s: string | undefined): TokenZalo {
  let o: unknown;
  try {
    o = JSON.parse(s ?? "");
  } catch {
    throw new GuiKenhError("secret Zalo: không phải JSON");
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) throw new GuiKenhError("secret Zalo: không phải một đối tượng JSON");
  const r = o as Record<string, unknown>;
  const hetHan = r.het_han_luc;
  if (typeof hetHan !== "number" || !Number.isSafeInteger(hetHan) || hetHan < 0) {
    throw new GuiKenhError("secret Zalo: trường het_han_luc thiếu hoặc sai kiểu");
  }
  return {
    appId: chuoi(r, "app_id", false),
    secretKey: chuoi(r, "secret_key", false),
    accessToken: chuoi(r, "access_token", true),
    refreshToken: chuoi(r, "refresh_token", false),
    hetHanLuc: hetHan,
  };
}

export function taoKhoTokenZaloSecretsManager(t: { readonly client: SecretsManagerKho; readonly secretId: string }): KhoTokenZalo {
  return {
    async doc(): Promise<TokenZalo> {
      const ra = await t.client.send(new GetSecretValueCommand({ SecretId: t.secretId }));
      return phanTichSecretZalo(ra.SecretString);
    },
    async ghi(tk: TokenZalo): Promise<void> {
      await t.client.send(
        new PutSecretValueCommand({
          SecretId: t.secretId,
          SecretString: JSON.stringify({
            app_id: tk.appId,
            secret_key: tk.secretKey,
            access_token: tk.accessToken,
            refresh_token: tk.refreshToken,
            het_han_luc: tk.hetHanLuc,
          }),
        }),
      );
    },
  };
}
