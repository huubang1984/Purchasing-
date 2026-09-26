// ==============================================================================================
// tools/neo-so-kiem-toan/src/aws.ts — JOB NEO TRÊN ECS: NƠI CẤT S3, KÝ BẰNG KMS, NEO KHOÁ BIÊN NHẬN (ADR-071)
//
// Job chạy với task role `tp-anchor-job` (prod) — role ấy chỉ làm được MỘT việc: `sts:AssumeRole` sang
// `tp-anchor-writer` ở tài khoản audit (stack 10/30). Mọi lời gọi S3 và KMS dưới đây đi bằng danh tính mượn ấy:
//   • bucket neo (Object Lock COMPLIANCE 365 ngày) CHỈ nhận `PutObject` từ `tp-anchor-writer` — không nới gì;
//   • khoá `alias/tp-anchor-sign` (stack 40) CHỈ cho `tp-anchor-writer` ký.
//
// BA QUYẾT ĐỊNH:
//   ⑴ GHI MỘT LẦN: mọi `PutObject` mang `IfNoneMatch: "*"` — S3 từ chối ghi đè ngay cả khi Object Lock chỉ giữ
//      PHIÊN BẢN cũ (một phiên bản mới cùng khoá vẫn thay cái mà `GetObject` trả về). Không có phép ghi đè nào.
//   ⑵ KÝ BẰNG KMS cùng định dạng với bộ ký local-dev (`buildAnchorText`, ECDSA P-256 SHA-256, chữ ký DER base64),
//      nên `kiem`/`trich`/`openssl` không đổi. Bộ ký TỰ KIỂM một lần lúc tạo, như bản local-dev (H9-3).
//   ⑶ TÀI LIỆU KHOÁ BIÊN NHẬN neo ĐÚNG BYTE mà `GET /.well-known/trustprocure-receipt-keys/<kid>` trả về, ở
//      `khoa-bien-nhan/<kid>.json`: người kiểm so hai chuỗi byte, không cần hiểu JSON. Neo lại cùng kid với
//      CÙNG byte là không làm gì; với byte KHÁC là lỗi to — một kid không bao giờ đổi khoá.
// ==============================================================================================

import { createHash, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetPublicKeyCommand, SignCommand, type GetPublicKeyCommandOutput, type SignCommandOutput } from "@aws-sdk/client-kms";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type GetObjectCommandOutput,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { AssumeRoleCommand, type AssumeRoleCommandOutput } from "@aws-sdk/client-sts";
import {
  AnchorError,
  buildAnchorText,
  verifyAnchorRecord,
  type AnchorFields,
  type AnchorStore,
  type SignedAnchorRecord,
} from "@trustprocure/audit";
import { RECEIPT_SIGNING_ALGORITHM } from "@trustprocure/bidding";

// ---------------------------------------------------------------------------------------------
// Danh tính mượn
// ---------------------------------------------------------------------------------------------
export interface StsMuonRole {
  send(lenh: AssumeRoleCommand): Promise<AssumeRoleCommandOutput>;
}

export interface ThongTinDangNhap {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
  readonly expiration?: Date;
}

/** Mượn `tp-anchor-writer` MỘT lần, một giờ — job neo chạy vài phút. */
export async function muonNguoiGhiNeo(sts: StsMuonRole, roleArn: string): Promise<ThongTinDangNhap> {
  const ra = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: `neo-${Date.now()}`, DurationSeconds: 3600 }));
  const c = ra.Credentials;
  if (c?.AccessKeyId === undefined || c.SecretAccessKey === undefined || c.SessionToken === undefined) {
    throw new Error("sts:AssumeRole không trả đủ thông tin đăng nhập cho người ghi neo.");
  }
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    ...(c.Expiration === undefined ? {} : { expiration: c.Expiration }),
  };
}

// ---------------------------------------------------------------------------------------------
// Nơi cất S3
// ---------------------------------------------------------------------------------------------
export interface S3NoiCat {
  send(lenh: PutObjectCommand): Promise<PutObjectCommandOutput>;
  send(lenh: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(lenh: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TIEN_TO_SO = "so-kiem-toan";

function laDaTonTai(loi: unknown): boolean {
  const e = loi as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === "PreconditionFailed" || e.$metadata?.httpStatusCode === 412;
}

async function docThan(ra: GetObjectCommandOutput): Promise<Uint8Array> {
  if (ra.Body === undefined) throw new Error("GetObject không có thân.");
  return ra.Body.transformToByteArray();
}

/**
 * Mỗi bản ghi một đối tượng `so-kiem-toan/<org>/<mili-giây 15 chữ số>-<sha256 16 hex>.json`: tên sắp theo thời
 * gian ghi, phần băm tách hai bản ghi cùng mili-giây. `readAllRaw` đọc theo thứ tự tên — cùng thứ tự "nối thêm"
 * của nơi cất tệp. Thân hỏng JSON trả nguyên chuỗi: `loadVerifiedAnchors` sẽ từ chối nó thay vì nó biến mất.
 */
export function createS3AnchorStore(t: { readonly client: S3NoiCat; readonly bucket: string }): AnchorStore {
  const tienTo = (orgId: string): string => {
    if (!UUID.test(orgId)) throw new AnchorError("orgId phải là UUID thường.");
    return `${TIEN_TO_SO}/${orgId}/`;
  };
  return {
    moTa: `s3://${t.bucket}/${TIEN_TO_SO}`,
    async append(orgId: string, banGhi: SignedAnchorRecord): Promise<void> {
      const than = Buffer.from(JSON.stringify(banGhi), "utf8");
      const bam = createHash("sha256").update(than).digest("hex").slice(0, 16);
      const khoa = `${tienTo(orgId)}${String(Date.now()).padStart(15, "0")}-${bam}.json`;
      await t.client.send(
        new PutObjectCommand({ Bucket: t.bucket, Key: khoa, Body: than, ContentType: "application/json", IfNoneMatch: "*" }),
      );
    },
    async readAllRaw(orgId: string): Promise<readonly unknown[]> {
      const khoa: string[] = [];
      let tiep: string | undefined;
      do {
        const ra = await t.client.send(
          new ListObjectsV2Command({ Bucket: t.bucket, Prefix: tienTo(orgId), ...(tiep === undefined ? {} : { ContinuationToken: tiep }) }),
        );
        for (const o of ra.Contents ?? []) if (o.Key?.endsWith(".json") === true) khoa.push(o.Key);
        tiep = ra.IsTruncated === true ? ra.NextContinuationToken : undefined;
      } while (tiep !== undefined);
      khoa.sort();
      const ketQua: unknown[] = [];
      for (const k of khoa) {
        const chuoi = Buffer.from(await docThan(await t.client.send(new GetObjectCommand({ Bucket: t.bucket, Key: k })))).toString("utf8");
        try {
          ketQua.push(JSON.parse(chuoi));
        } catch {
          ketQua.push(chuoi);
        }
      }
      return ketQua;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Bộ ký mốc neo bằng KMS
// ---------------------------------------------------------------------------------------------
export interface KmsKyNeo {
  send(lenh: SignCommand): Promise<SignCommandOutput>;
  send(lenh: GetPublicKeyCommand): Promise<GetPublicKeyCommandOutput>;
}

/** Mặt ký của công cụ — bất đồng bộ, vì KMS là một lời gọi mạng. Bộ ký local-dev được bọc về mặt này. */
export interface BoKyNeo {
  readonly activeKeyId: string;
  ky(fields: Omit<AnchorFields, "kid">): Promise<SignedAnchorRecord>;
}

export async function taoBoKyNeoAwsKms(t: {
  readonly client: KmsKyNeo;
  readonly keyId: string;
  readonly kid: string;
}): Promise<{ readonly boKy: BoKyNeo; readonly khoaCongKhai: Uint8Array }> {
  const pk = await t.client.send(new GetPublicKeyCommand({ KeyId: t.keyId }));
  if (pk.KeySpec !== "ECC_NIST_P256" || pk.KeyUsage !== "SIGN_VERIFY" || pk.PublicKey === undefined) {
    throw new AnchorError(`Khoá ký mốc neo phải là ECC_NIST_P256 / SIGN_VERIFY, KMS trả ${String(pk.KeySpec)} / ${String(pk.KeyUsage)}.`);
  }
  const khoaCongKhai = new Uint8Array(pk.PublicKey);
  const boKy: BoKyNeo = {
    activeKeyId: t.kid,
    async ky(fields) {
      const text = buildAnchorText({ ...fields, kid: t.kid });
      const ra = await t.client.send(
        new SignCommand({ KeyId: t.keyId, Message: Buffer.from(text, "utf8"), MessageType: "RAW", SigningAlgorithm: "ECDSA_SHA_256" }),
      );
      if (ra.Signature === undefined) throw new AnchorError("KMS Sign không trả chữ ký.");
      return { text, sig: Buffer.from(ra.Signature).toString("base64") };
    },
  };
  // Tự kiểm: chữ ký KMS kiểm được bằng nửa công khai cùng kid — nếu không, không mốc neo nào ký bằng cấu hình này
  // kiểm được, và lỗi chỉ lộ ra ở lần kiểm toán thật (cùng lý do H9-3 của bộ ký local-dev).
  const mau = await boKy.ky({ orgId: "00000000-0000-0000-0000-000000000000", seq: 1, hashHex: "0".repeat(64), exportedAt: "1970-01-01T00:00:00.000Z" });
  try {
    verifyAnchorRecord(mau, new Map([[t.kid, khoaCongKhai]]), "tu-kiem");
  } catch (loi) {
    throw new AnchorError(`Chữ ký KMS của "${t.kid}" không kiểm được bằng nửa công khai của chính khoá ấy.`, { cause: loi });
  }
  return { boKy, khoaCongKhai };
}

// ---------------------------------------------------------------------------------------------
// Neo tài liệu khoá biên nhận
// ---------------------------------------------------------------------------------------------
const KID = /^[A-Za-z0-9._-]{1,64}$/u;

/** Tài liệu một khoá — ĐÚNG byte của `GET /.well-known/trustprocure-receipt-keys/<kid>` (apps/public-keys). */
export function taiLieuMotKhoa(kid: string, spkiB64: string): Uint8Array {
  if (!KID.test(kid)) throw new Error(`kid "${kid}" không an toàn cho một tên đối tượng.`);
  const der = Buffer.from(spkiB64, "base64");
  const khoa = createPublicKey({ key: der, format: "der", type: "spki" });
  if (khoa.asymmetricKeyType !== "ec" || khoa.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error(`Khoá biên nhận "${kid}" không phải EC P-256.`);
  }
  const doc = {
    kid,
    alg: RECEIPT_SIGNING_ALGORITHM,
    spki: der.toString("base64"),
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
  return Buffer.from(JSON.stringify(doc), "utf8");
}

/** Nơi ghi MỘT LẦN theo tên: "moi" khi vừa ghi, "trung" khi đã có đúng byte ấy; byte khác ⇒ ném. */
export interface NoiNeoTaiLieu {
  readonly moTa: string;
  ghiMotLan(ten: string, noiDung: Uint8Array): Promise<"moi" | "trung">;
}

function soByte(a: Uint8Array, b: Uint8Array, ten: string): "trung" {
  if (!Buffer.from(a).equals(Buffer.from(b))) {
    throw new Error(`"${ten}" ĐÃ được neo với nội dung KHÁC — một kid không bao giờ đổi khoá. Dừng lại và điều tra.`);
  }
  return "trung";
}

export function taoNoiNeoTaiLieuS3(t: { readonly client: S3NoiCat; readonly bucket: string }): NoiNeoTaiLieu {
  return {
    moTa: `s3://${t.bucket}`,
    async ghiMotLan(ten, noiDung) {
      try {
        await t.client.send(new PutObjectCommand({ Bucket: t.bucket, Key: ten, Body: noiDung, ContentType: "application/json", IfNoneMatch: "*" }));
        return "moi";
      } catch (loi) {
        if (!laDaTonTai(loi)) throw loi;
        return soByte(await docThan(await t.client.send(new GetObjectCommand({ Bucket: t.bucket, Key: ten }))), noiDung, ten);
      }
    },
  };
}

export function taoNoiNeoTaiLieuTep(thuMuc: string): NoiNeoTaiLieu {
  return {
    moTa: `kho tệp ${thuMuc}`,
    async ghiMotLan(ten, noiDung) {
      const duong = join(thuMuc, ...ten.split("/"));
      await mkdir(dirname(duong), { recursive: true, mode: 0o700 });
      try {
        await writeFile(duong, noiDung, { flag: "wx", mode: 0o600 });
        return "moi";
      } catch (loi) {
        if ((loi as { code?: string }).code !== "EEXIST") throw loi;
        return soByte(new Uint8Array(await readFile(duong)), noiDung, ten);
      }
    },
  };
}

/** Neo MỌI khoá trong danh sách công bố; trả từng kid kèm "moi" (vừa ghi) hay "trung" (đã có đúng byte ấy). */
export async function neoKhoaBienNhan(noi: NoiNeoTaiLieu, khoaCongKhai: Readonly<Record<string, string>>): Promise<readonly [string, "moi" | "trung"][]> {
  const ketQua: [string, "moi" | "trung"][] = [];
  for (const kid of Object.keys(khoaCongKhai).sort()) {
    ketQua.push([kid, await noi.ghiMotLan(`khoa-bien-nhan/${kid}.json`, taiLieuMotKhoa(kid, khoaCongKhai[kid] ?? ""))]);
  }
  return ketQua;
}
