// ==============================================================================================
// [khoản 15 / S1.128] TIẾN TRÌNH `public-keys` — TRONG TIẾN TRÌNH, VÀ `main.ts` THẬT NHƯ `pnpm public-keys:dev`
//
// Hai tầng đo:
//   ⑴ `khoiDongPublicKeys` với KMS GIẢ tiêm vào: lên được thì phục vụ đúng tài liệu và ĐÃ đóng
//      client KMS (tiến trình không giữ kết nối KMS nào sau khởi động); nguồn lỗi hay treo thì
//      KHÔNG lên — không cổng nào được mở.
//   ⑵ `main.ts` là tiến trình con, cùng lệnh với script ở package.json gốc (khuôn
//      `apps/mcp/src/tien-trinh.test.ts`). Nhánh `aws-kms` chạy `KMSClient` THẬT của SDK, trỏ về
//      một máy chủ KMS GIẢ trên 127.0.0.1 bằng `AWS_ENDPOINT_URL_KMS` và chứng chỉ giả — mọi biến
//      `AWS_*` của môi trường chạy test bị gỡ khỏi tiến trình con, nên không lời gọi nào ra AWS thật.
// ==============================================================================================

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { GetPublicKeyCommand, type GetPublicKeyCommandOutput } from "@aws-sdk/client-kms";
import { afterEach, describe, expect, it } from "vitest";
import { RECEIPT_KEYS_PATH, type ReceiptKeyDocument } from "./index.js";
import type { CauHinhPublicKeys } from "./cau-hinh.js";
import { khoiDongPublicKeys, type ClientKmsCongBo } from "./tien-trinh.js";

function spkiP256(): Uint8Array {
  return new Uint8Array(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "der" }));
}

const SPKI_CU = spkiP256();
const SPKI_MOI = spkiP256();
const THEO_KEY_ID = new Map([
  ["alias/tp-receipt-sign-2026-01", SPKI_CU],
  ["alias/tp-receipt-sign", SPKI_MOI],
]);

class KmsGia implements ClientKmsCongBo {
  daDong = 0;
  soLenh = 0;
  constructor(private readonly hanh: "tot" | "loi" | "treo" = "tot") {}
  send(lenh: GetPublicKeyCommand): Promise<GetPublicKeyCommandOutput> {
    this.soLenh += 1;
    if (this.hanh === "loi") return Promise.reject(new Error("AccessDeniedException"));
    if (this.hanh === "treo") return new Promise(() => undefined);
    return Promise.resolve({
      $metadata: {},
      KeySpec: "ECC_NIST_P256",
      KeyUsage: "SIGN_VERIFY",
      SigningAlgorithms: ["ECDSA_SHA_256"],
      PublicKey: THEO_KEY_ID.get(lenh.input.KeyId ?? ""),
    });
  }
  destroy(): void {
    this.daDong += 1;
  }
}

const CH_KMS: CauHinhPublicKeys = {
  keyAdapter: "aws-kms",
  listenHost: "127.0.0.1",
  listenPort: 0,
  kms: {
    region: "ap-southeast-1",
    khoa: [
      { kid: "kms-2026-01", keyId: "alias/tp-receipt-sign-2026-01" },
      { kid: "kms-2026-09", keyId: "alias/tp-receipt-sign" },
    ],
    activeKid: "kms-2026-09",
  },
};

const donDep: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of donDep.splice(0)) await f();
});

describe("[khoản 15 / S1.128] khoiDongPublicKeys — trong tiến trình, KMS giả", () => {
  it("aws-kms: lên, phục vụ tài liệu dựng từ GetPublicKey, và ĐÃ đóng client KMS", async () => {
    const kms = new KmsGia();
    const vungKms: string[] = [];
    const tt = await khoiDongPublicKeys(CH_KMS, {
      taoClientKms: (vung) => {
        vungKms.push(vung);
        return kms;
      },
    });
    donDep.push(() => tt.dung());

    expect(vungKms).toEqual(["ap-southeast-1"]);
    expect(kms.soLenh).toBe(2);
    expect(kms.daDong, "tiến trình không được giữ client KMS sau khi chụp khoá").toBe(1);

    const res = await fetch(`http://127.0.0.1:${String(tt.diaChi.port)}${RECEIPT_KEYS_PATH}`);
    const doc = (await res.json()) as ReceiptKeyDocument;
    expect(doc.activeKeyId).toBe("kms-2026-09");
    expect(doc.keys.map((k) => [k.kid, k.fingerprint])).toEqual([
      ["kms-2026-01", createHash("sha256").update(SPKI_CU).digest("hex")],
      ["kms-2026-09", createHash("sha256").update(SPKI_MOI).digest("hex")],
    ]);
  });

  it("aws-kms: GetPublicKey lỗi ⇒ KHÔNG lên, không cổng nào mở, client vẫn được đóng", async () => {
    const kms = new KmsGia("loi");
    let daMoCong = false;
    await expect(
      khoiDongPublicKeys(CH_KMS, {
        taoClientKms: () => kms,
        nghe: () => {
          daMoCong = true;
          return Promise.reject(new Error("không được tới đây"));
        },
      }),
    ).rejects.toThrow(/kms-2026-01/u);
    expect(daMoCong).toBe(false);
    expect(kms.daDong).toBe(1);
  });

  it("aws-kms: KMS TREO ⇒ quá hạn khởi động, không lên", async () => {
    const kms = new KmsGia("treo");
    await expect(khoiDongPublicKeys(CH_KMS, { taoClientKms: () => kms, hanKmsMs: 50 })).rejects.toThrow(/quá hạn/u);
    expect(kms.daDong).toBe(1);
  });

  it("local-dev: KHÔNG dựng client KMS nào", async () => {
    const tt = await khoiDongPublicKeys(
      { keyAdapter: "local-dev", listenHost: "127.0.0.1", listenPort: 0, receiptKeys: { active: "r1", publicKeys: new Map([["r1", SPKI_CU]]) } },
      {
        taoClientKms: () => {
          throw new Error("local-dev không được chạm KMS");
        },
      },
    );
    donDep.push(() => tt.dung());
    const doc = (await (await fetch(`http://127.0.0.1:${String(tt.diaChi.port)}${RECEIPT_KEYS_PATH}`)).json()) as ReceiptKeyDocument;
    expect(doc.keys.map((k) => k.kid)).toEqual(["r1"]);
  });
});

// ----------------------------------------------------------------------------------------------
// ⑵ `main.ts` THẬT
// ----------------------------------------------------------------------------------------------

const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const LENH_MAIN = ["--experimental-transform-types", "--import", "./apps/public-keys/register-ts-resolve.mjs", "apps/public-keys/src/main.ts"];

/** Môi trường của tiến trình con: gỡ MỌI biến AWS_* và TRUSTPROCURE_* của máy chạy test. */
function envSach(them: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("AWS_") || k.startsWith("TRUSTPROCURE_")) continue;
    env[k] = v;
  }
  return { ...env, NODE_ENV: "test", ...them };
}

interface KetQua {
  readonly ma: number | null;
  readonly stderr: string;
}

function chayMain(env: Readonly<Record<string, string>>): { tt: ChildProcess; stderr: () => string; xong: Promise<KetQua> } {
  const tt = spawn(process.execPath, LENH_MAIN, { cwd: GOC_KHO, env: envSach(env), stdio: ["ignore", "pipe", "pipe"] });
  let loi = "";
  tt.stderr.on("data", (c: Buffer) => {
    loi += c.toString("utf8");
  });
  const xong = new Promise<KetQua>((ok) => {
    tt.on("exit", (ma) => {
      ok({ ma, stderr: loi });
    });
  });
  donDep.push(() => {
    if (tt.exitCode === null) tt.kill();
  });
  return { tt, stderr: () => loi, xong };
}

async function doiCong(stderr: () => string, hanMs: number): Promise<number> {
  const het = Date.now() + hanMs;
  while (Date.now() < het) {
    const m = /dang nghe 127\.0\.0\.1:(\d+)/u.exec(stderr());
    if (m) return Number(m[1]);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`main không lên trong ${String(hanMs)}ms — stderr: ${stderr()}`);
}

/** Máy chủ KMS giả nói giao thức JSON 1.1 của KMS — đủ cho `GetPublicKey`. */
async function kmsHttpGia(tra: (keyId: string) => { ma: number; than: unknown }): Promise<{ goc: string; lenh: string[] }> {
  const lenh: string[] = [];
  const s: Server = createServer((req, res) => {
    let than = "";
    req.on("data", (c: Buffer) => {
      than += c.toString("utf8");
    });
    req.on("end", () => {
      lenh.push(String(req.headers["x-amz-target"]));
      const { KeyId } = JSON.parse(than) as { KeyId: string };
      const r = tra(KeyId);
      res.writeHead(r.ma, { "content-type": "application/x-amz-json-1.1" });
      res.end(JSON.stringify(r.than));
    });
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  donDep.push(() => new Promise<void>((ok) => s.close(() => { ok(); })));
  return { goc: `http://127.0.0.1:${String((s.address() as AddressInfo).port)}`, lenh };
}

function envKmsMain(goc: string): Record<string, string> {
  return {
    TRUSTPROCURE_KEY_ADAPTER: "aws-kms",
    TRUSTPROCURE_AWS_REGION: "ap-southeast-1",
    TRUSTPROCURE_KMS_RECEIPT_KEYS: "kms-2026-01=alias/tp-receipt-sign-2026-01,kms-2026-09=alias/tp-receipt-sign",
    TRUSTPROCURE_KMS_RECEIPT_KID: "kms-2026-09",
    TRUSTPROCURE_PUBLIC_KEYS_PORT: "0",
    AWS_ENDPOINT_URL_KMS: goc,
    AWS_ACCESS_KEY_ID: "AKIAGIAGIAGIAGIAGIA0",
    AWS_SECRET_ACCESS_KEY: "gia-gia-gia-gia-gia-gia-gia-gia-gia-gia0",
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

describe("[khoản 15 / S1.128] main.ts thật — `pnpm public-keys:dev`", () => {
  it("aws-kms với KMSClient THẬT trỏ về KMS giả: lên và công bố đúng hai kid", async () => {
    const kms = await kmsHttpGia((keyId) => ({
      ma: 200,
      than: {
        KeyId: `arn:gia:${keyId}`,
        KeySpec: "ECC_NIST_P256",
        KeyUsage: "SIGN_VERIFY",
        SigningAlgorithms: ["ECDSA_SHA_256"],
        PublicKey: Buffer.from(THEO_KEY_ID.get(keyId)!).toString("base64"),
      },
    }));
    const m = chayMain(envKmsMain(kms.goc));
    const cong = await doiCong(m.stderr, 20_000);
    const doc = (await (await fetch(`http://127.0.0.1:${String(cong)}${RECEIPT_KEYS_PATH}`)).json()) as ReceiptKeyDocument;
    expect(doc.activeKeyId).toBe("kms-2026-09");
    expect(doc.keys.map((k) => k.spki)).toEqual([Buffer.from(SPKI_CU).toString("base64"), Buffer.from(SPKI_MOI).toString("base64")]);
    // Chỉ GetPublicKey, không một lệnh Sign nào — tiến trình này không bao giờ cần `kms:Sign`.
    expect(kms.lenh).toEqual(["TrentService.GetPublicKey", "TrentService.GetPublicKey"]);
  }, 30_000);

  it("aws-kms: KMS từ chối GetPublicKey ⇒ tiến trình KHÔNG lên, thoát mã 1", async () => {
    const kms = await kmsHttpGia(() => ({ ma: 400, than: { __type: "AccessDeniedException", message: "khong co quyen" } }));
    const m = chayMain(envKmsMain(kms.goc));
    const kq = await m.xong;
    expect(kq.ma).toBe(1);
    expect(kq.stderr).toMatch(/khong khoi dong duoc/u);
    expect(kq.stderr).not.toMatch(/dang nghe/u);
    // Không stack, không chứng chỉ.
    expect(kq.stderr).not.toContain("gia-gia-gia");
    expect(kq.stderr).not.toMatch(/\n\s+at /u);
  }, 30_000);

  it("cấu hình mang cả hai bộ biến ⇒ thoát mã 1, stderr nêu TÊN biến và KHÔNG mang khoá riêng", async () => {
    const pkcs8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const m = chayMain({
      ...envKmsMain("http://127.0.0.1:9"),
      TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `r1=${pkcs8}`,
      TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "r1",
    });
    const kq = await m.xong;
    expect(kq.ma).toBe(1);
    expect(kq.stderr).toContain("TRUSTPROCURE_RECEIPT_SIGNING_KEYS");
    expect(kq.stderr).not.toContain(pkcs8);
    expect(kq.stderr).not.toContain(pkcs8.slice(0, 40));
  }, 30_000);

  it("local-dev: lên, và hàng rào assertLocalDevAllowed chặn khi NODE_ENV=production", async () => {
    const pkcs8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const env = {
      TRUSTPROCURE_KEY_ADAPTER: "local-dev",
      TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `r1=${pkcs8}`,
      TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "r1",
      TRUSTPROCURE_PUBLIC_KEYS_PORT: "0",
    };
    const tot = chayMain(env);
    const cong = await doiCong(tot.stderr, 20_000);
    const doc = (await (await fetch(`http://127.0.0.1:${String(cong)}${RECEIPT_KEYS_PATH}`)).json()) as ReceiptKeyDocument;
    expect(doc.keys.map((k) => k.kid)).toEqual(["r1"]);
    expect(JSON.stringify(doc)).not.toContain(pkcs8);

    const chan = await chayMain({ ...env, NODE_ENV: "production" }).xong;
    expect(chan.ma).toBe(1);
    expect(chan.stderr).toMatch(/local-dev/u);
    expect(chan.stderr).not.toContain(pkcs8);
  }, 30_000);
});
