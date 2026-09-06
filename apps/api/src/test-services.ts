// Dịch vụ TIÊM cho test của apps/api: pepper cố định, bộ gửi OTP GHI LẠI (không gửi đi đâu), bộ
// ký biên nhận local-dev với một cặp khoá sinh tại chỗ. File này KHÔNG phải mã sản phẩm — nó nằm
// ngoài `routes/**` và `dispatch.ts`, không xuất qua `index.ts`, và chỉ test import nó.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createLocalDevReceiptSigner, ReceiptSigningKeyRing, type ReceiptKeyPair } from "@trustprocure/bidding";
import { createCipheriv, createDecipheriv } from "node:crypto";
import type { TotpSecretUnsealer, WrappedTotpSecret } from "@trustprocure/identity";
import { PepperRing, type Channel } from "@trustprocure/invitation";
import type { ApiServices } from "./route-types.js";

export interface OtpDaGui {
  readonly channel: Channel;
  readonly destination: string;
  readonly code: string;
}

export interface LinkDaGui {
  readonly orgId: string;
  readonly email: string;
  readonly token: string;
}

export interface LoiMoiDaGui {
  readonly invitationId: string;
  readonly channel: string;
  readonly destination: string;
  readonly token: string;
}

export interface DichVuTest {
  readonly services: ApiServices;
  /** Mọi link đăng nhập đã đi qua bộ gửi. Test đọc token ở đây — và CHỈ ở đây. */
  readonly linkDaGui: LinkDaGui[];
  /** Mọi magic link mời thầu đã đi qua bộ gửi. */
  readonly loiMoiDaGui: LoiMoiDaGui[];
  /** Mọi OTP đã đi qua bộ gửi, theo thứ tự. Test đọc mã ở đây — và CHỈ ở đây. */
  readonly otpDaGui: OtpDaGui[];
  readonly khoaKy: ReceiptKeyPair;
}

export function dichVuTest(): DichVuTest {
  const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const khoaKy: ReceiptKeyPair = {
    privateKey: new Uint8Array(cap.privateKey.export({ type: "pkcs8", format: "der" })),
    publicKey: new Uint8Array(cap.publicKey.export({ type: "spki", format: "der" })),
  };
  const otpDaGui: OtpDaGui[] = [];
  const linkDaGui: LinkDaGui[] = [];
  const loiMoiDaGui: LoiMoiDaGui[] = [];
  // Bộ bọc/mở bí mật TOTP của test: AES-256-GCM, khoá dẫn xuất theo tổ chức, AAD ràng buộc tổ chức
  // + phiên bản — cùng fixture với `packages/identity/src/mfa.int.test.ts`, KHÔNG phải stub trả
  // thẳng plaintext (một stub như thế làm mọi khẳng định "bí mật của A không mở ở B" xanh vì lý do sai).
  const GOC = Buffer.alloc(32, 0x11);
  const khoaTheoToChuc = (orgId: string): Buffer => {
    const dan = Buffer.alloc(32);
    const nem = Buffer.from(orgId, "utf8");
    for (let i = 0; i < 32; i += 1) dan[i] = GOC[i]! ^ nem[i % nem.length]!;
    return dan;
  };
  const totpSecretUnsealer: TotpSecretUnsealer = {
    kind: "TOTP_SECRET_UNSEALER",
    name: "aes-gcm-test",
    openTotpSecret: (orgId: string, wrapped: WrappedTotpSecret): Promise<Uint8Array> => {
      const phongBi = Buffer.from(wrapped.ciphertext);
      const khoa = khoaTheoToChuc(orgId);
      const d = createDecipheriv("aes-256-gcm", khoa, phongBi.subarray(0, 12));
      d.setAAD(Buffer.from(`${wrapped.keyVersion}|${orgId}`, "utf8"));
      d.setAuthTag(phongBi.subarray(12, 28));
      const ro = Buffer.concat([d.update(phongBi.subarray(28)), d.final()]);
      khoa.fill(0);
      return Promise.resolve(new Uint8Array(ro));
    },
  };
  return {
    otpDaGui,
    linkDaGui,
    loiMoiDaGui,
    khoaKy,
    services: {
      // Bộ bọc khoá RFQ của test — đối xứng, cùng fixture với bidding.int.test.ts. Không phải KMS.
      rfqKeyWrapper: {
        name: "doi-xung-cua-test",
        wrap: (_orgId: string, plaintext: Uint8Array) =>
          Promise.resolve({ ciphertext: plaintext.map((b) => b ^ 0xff), keyVersion: "test-v1" }),
      },
      invitationLinkSender: {
        name: "ghi-lai-cua-test",
        send: (m) => {
          loiMoiDaGui.push({ invitationId: m.invitationId, channel: m.channel, destination: m.destination, token: m.token });
          return Promise.resolve();
        },
      },
      loginLinkSender: {
        name: "ghi-lai-cua-test",
        send: (m) => {
          linkDaGui.push({ orgId: m.orgId, email: m.email, token: m.token });
          return Promise.resolve();
        },
      },
      totpSecretWrapper: {
        name: "aes-gcm-test",
        wrapTotpSecret: (orgId: string, secret: Uint8Array): Promise<WrappedTotpSecret> => {
          const iv = randomBytes(12);
          const khoa = khoaTheoToChuc(orgId);
          const c = createCipheriv("aes-256-gcm", khoa, iv);
          c.setAAD(Buffer.from(`v1|${orgId}`, "utf8"));
          const than = Buffer.concat([c.update(Buffer.from(secret)), c.final()]);
          khoa.fill(0);
          return Promise.resolve({ ciphertext: new Uint8Array(Buffer.concat([iv, c.getAuthTag(), than])), keyVersion: "v1" });
        },
      },
      totpSecretUnsealer,
      pepper: new PepperRing("p1", { p1: Buffer.alloc(32, 9) }),
      otpSender: {
        name: "ghi-lai-cua-test",
        send: (m) => {
          otpDaGui.push({ channel: m.channel, destination: m.destination, code: m.code });
          return Promise.resolve();
        },
      },
      receiptSigner: createLocalDevReceiptSigner(new ReceiptSigningKeyRing("ky-test", { "ky-test": khoaKy })),
    },
  };
}
