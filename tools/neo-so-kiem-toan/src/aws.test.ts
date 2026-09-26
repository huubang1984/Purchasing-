// [ADR-071] Job neo trên ECS — đo trên S3/KMS/STS GIẢ: ghi một lần, đọc theo thứ tự, ký KMS kiểm được bằng
// `verifyAnchorRecord`, tự kiểm bắt khoá sai cặp, neo khoá biên nhận đúng byte của endpoint và từ chối đổi khoá.
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { AssumeRoleCommand } from "@aws-sdk/client-sts";
import { loadVerifiedAnchors, verifyAnchorRecord, type SignedAnchorRecord } from "@trustprocure/audit";
import { afterAll, describe, expect, it } from "vitest";
import {
  createS3AnchorStore,
  muonNguoiGhiNeo,
  neoKhoaBienNhan,
  taiLieuMotKhoa,
  taoBoKyNeoAwsKms,
  taoNoiNeoTaiLieuS3,
  taoNoiNeoTaiLieuTep,
  type KmsKyNeo,
} from "./aws.js";

const ORG = "11111111-1111-4111-8111-111111111111";

class S3Gia {
  readonly vat = new Map<string, Uint8Array>();
  readonly lenh: string[] = [];
  trang = 2;
  send(l: PutObjectCommand | GetObjectCommand | ListObjectsV2Command): Promise<never> {
    this.lenh.push(l.constructor.name);
    if (l instanceof PutObjectCommand) {
      const k = l.input.Key ?? "";
      if (l.input.IfNoneMatch !== "*") return Promise.reject(new Error("thiếu IfNoneMatch"));
      if (this.vat.has(k)) return Promise.reject(Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }));
      const b = l.input.Body;
      this.vat.set(k, typeof b === "string" ? Buffer.from(b) : new Uint8Array(b as Uint8Array));
      return Promise.resolve({ $metadata: {} } as never);
    }
    if (l instanceof GetObjectCommand) {
      const v = this.vat.get(l.input.Key ?? "");
      if (v === undefined) return Promise.reject(new Error("NoSuchKey"));
      return Promise.resolve({ $metadata: {}, Body: { transformToByteArray: () => Promise.resolve(v) } } as never);
    }
    const tatCa = [...this.vat.keys()].filter((k) => k.startsWith(l.input.Prefix ?? "")).sort().reverse();
    const batDau = Number(l.input.ContinuationToken ?? "0");
    const phan = tatCa.slice(batDau, batDau + this.trang);
    const conNua = batDau + this.trang < tatCa.length;
    return Promise.resolve({
      $metadata: {},
      Contents: phan.map((Key) => ({ Key })),
      IsTruncated: conNua,
      ...(conNua ? { NextContinuationToken: String(batDau + this.trang) } : {}),
    } as never);
  }
}

function kmsGia(khoaKy = generateKeyPairSync("ec", { namedCurve: "P-256" }), khoaCong = khoaKy): KmsKyNeo & { soLanKy: number } {
  const o = {
    soLanKy: 0,
    send(l: SignCommand | GetPublicKeyCommand): Promise<never> {
      if (l instanceof GetPublicKeyCommand) {
        return Promise.resolve({
          $metadata: {},
          KeySpec: "ECC_NIST_P256",
          KeyUsage: "SIGN_VERIFY",
          PublicKey: new Uint8Array(khoaCong.publicKey.export({ type: "spki", format: "der" })),
        } as never);
      }
      o.soLanKy += 1;
      expect(l.input.MessageType).toBe("RAW");
      expect(l.input.SigningAlgorithm).toBe("ECDSA_SHA_256");
      const sig = createSign("sha256").update(Buffer.from(l.input.Message ?? new Uint8Array())).sign(khoaKy.privateKey);
      return Promise.resolve({ $metadata: {}, Signature: new Uint8Array(sig) } as never);
    },
  };
  return o;
}

const thuMucTam: string[] = [];
afterAll(() => {
  for (const d of thuMucTam) rmSync(d, { recursive: true, force: true });
});

describe("[ADR-071] mượn tp-anchor-writer", () => {
  it("AssumeRole đúng role, một giờ; thiếu thông tin ⇒ ném", async () => {
    let da: AssumeRoleCommand | undefined;
    const tt = await muonNguoiGhiNeo(
      {
        send: (l) => {
          da = l;
          return Promise.resolve({ $metadata: {}, Credentials: { AccessKeyId: "a", SecretAccessKey: "b", SessionToken: "c", Expiration: new Date(0) } });
        },
      },
      "arn:aws:iam::528657840905:role/tp-anchor-writer",
    );
    expect(da?.input.RoleArn).toBe("arn:aws:iam::528657840905:role/tp-anchor-writer");
    expect(da?.input.DurationSeconds).toBe(3600);
    expect(tt).toMatchObject({ accessKeyId: "a", secretAccessKey: "b", sessionToken: "c" });
    await expect(muonNguoiGhiNeo({ send: () => Promise.resolve({ $metadata: {} }) }, "arn:x")).rejects.toThrow(/không trả đủ/u);
  });
});

describe("[ADR-071] nơi cất S3 + bộ ký KMS", () => {
  it("xuất ba mốc qua nhiều trang: ghi một lần, đọc lại theo thứ tự, mọi mốc kiểm được", async () => {
    const s3 = new S3Gia();
    const kho = createS3AnchorStore({ client: s3, bucket: "tp-neo" });
    const { boKy, khoaCongKhai } = await taoBoKyNeoAwsKms({ client: kmsGia(), keyId: "arn:aws:kms:ap-southeast-1:528657840905:alias/tp-anchor-sign", kid: "kms-neo-1" });
    for (const seq of [1, 2, 3]) {
      await kho.append(ORG, await boKy.ky({ orgId: ORG, seq, hashHex: String(seq).repeat(64), exportedAt: "2026-09-26T00:00:00.000Z" }));
      await new Promise((xong) => setTimeout(xong, 2));
    }
    expect([...s3.vat.keys()].every((k) => k.startsWith(`so-kiem-toan/${ORG}/`) && k.endsWith(".json"))).toBe(true);
    const neo = await loadVerifiedAnchors(kho, ORG, new Map([["kms-neo-1", khoaCongKhai]]));
    expect(neo.map((n) => n.seq)).toEqual([1, 2, 3]);
    expect(kho.moTa).toBe("s3://tp-neo/so-kiem-toan");
  });

  it("orgId không phải UUID ⇒ ném trước mọi lời gọi", async () => {
    const s3 = new S3Gia();
    const kho = createS3AnchorStore({ client: s3, bucket: "b" });
    await expect(kho.readAllRaw("../x")).rejects.toThrow(/UUID/u);
    expect(s3.lenh).toHaveLength(0);
  });

  it("bản ghi hỏng trong bucket không biến mất: loadVerifiedAnchors từ chối", async () => {
    const s3 = new S3Gia();
    s3.vat.set(`so-kiem-toan/${ORG}/000000000000001-aaaa.json`, Buffer.from("khong phai json"));
    const kho = createS3AnchorStore({ client: s3, bucket: "b" });
    await expect(loadVerifiedAnchors(kho, ORG, new Map())).rejects.toThrow();
  });

  it("chữ ký KMS là DER base64 kiểm được bằng verifyAnchorRecord; khoá KMS sai cặp ⇒ tự kiểm ném lúc tạo", async () => {
    const { boKy, khoaCongKhai } = await taoBoKyNeoAwsKms({ client: kmsGia(), keyId: "k", kid: "kms-neo-1" });
    const bg: SignedAnchorRecord = await boKy.ky({ orgId: ORG, seq: 7, hashHex: "a".repeat(64), exportedAt: "2026-09-26T00:00:00.000Z" });
    expect(verifyAnchorRecord(bg, new Map([["kms-neo-1", khoaCongKhai]]), "t").seq).toBe(7);
    const lech = kmsGia(generateKeyPairSync("ec", { namedCurve: "P-256" }), generateKeyPairSync("ec", { namedCurve: "P-256" }));
    await expect(taoBoKyNeoAwsKms({ client: lech, keyId: "k", kid: "kms-neo-1" })).rejects.toThrow(/không kiểm được/u);
  });
});

describe("[ADR-071] neo tài liệu khoá biên nhận", () => {
  const spki = (): string => Buffer.from(generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "der" })).toString("base64");

  it("byte neo = JSON.stringify({kid, alg, spki, fingerprint}) — đúng dạng endpoint trả cho /<kid>", () => {
    const b = spki();
    const doc = JSON.parse(Buffer.from(taiLieuMotKhoa("kms-2026-09", b)).toString("utf8")) as Record<string, string>;
    expect(Object.keys(doc)).toEqual(["kid", "alg", "spki", "fingerprint"]);
    expect(doc.spki).toBe(b);
    expect(doc.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    const rsa = Buffer.from(generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" })).toString("base64");
    expect(() => taiLieuMotKhoa("k", rsa)).toThrow(/P-256/u);
    expect(() => taiLieuMotKhoa("a:b", b)).toThrow(/an toàn/u);
  });

  it("S3: lần đầu DA NEO, lần sau cùng byte TRUNG, khoá khác cho cùng kid ⇒ ném", async () => {
    const s3 = new S3Gia();
    const noi = taoNoiNeoTaiLieuS3({ client: s3, bucket: "tp-neo" });
    const k1 = spki();
    expect(await neoKhoaBienNhan(noi, { "kms-2026-09": k1 })).toEqual([["kms-2026-09", "moi"]]);
    expect(await neoKhoaBienNhan(noi, { "kms-2026-09": k1 })).toEqual([["kms-2026-09", "trung"]]);
    await expect(neoKhoaBienNhan(noi, { "kms-2026-09": spki() })).rejects.toThrow(/nội dung KHÁC/u);
    expect([...s3.vat.keys()]).toEqual(["khoa-bien-nhan/kms-2026-09.json"]);
  });

  it("tệp: cùng hành vi ghi một lần", async () => {
    const thuMuc = mkdtempSync(join(tmpdir(), "neo-khoa-"));
    thuMucTam.push(thuMuc);
    const noi = taoNoiNeoTaiLieuTep(thuMuc);
    const k1 = spki();
    expect(await neoKhoaBienNhan(noi, { a: k1, b: spki() })).toEqual([["a", "moi"], ["b", "moi"]]);
    expect(await neoKhoaBienNhan(noi, { a: k1 })).toEqual([["a", "trung"]]);
    await expect(neoKhoaBienNhan(noi, { a: spki() })).rejects.toThrow(/nội dung KHÁC/u);
  });
});
