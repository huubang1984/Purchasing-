// Dịch vụ TIÊM cho test của apps/api: pepper cố định, bộ gửi OTP GHI LẠI (không gửi đi đâu), bộ
// ký biên nhận local-dev với một cặp khoá sinh tại chỗ. File này KHÔNG phải mã sản phẩm — nó nằm
// ngoài `routes/**` và `dispatch.ts`, không xuất qua `index.ts`, và chỉ test import nó.
import { generateKeyPairSync } from "node:crypto";
import { createLocalDevReceiptSigner, ReceiptSigningKeyRing, type ReceiptKeyPair } from "@trustprocure/bidding";
import { PepperRing, type Channel } from "@trustprocure/invitation";
import type { ApiServices } from "./route-types.js";

export interface OtpDaGui {
  readonly channel: Channel;
  readonly destination: string;
  readonly code: string;
}

export interface DichVuTest {
  readonly services: ApiServices;
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
  return {
    otpDaGui,
    khoaKy,
    services: {
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
