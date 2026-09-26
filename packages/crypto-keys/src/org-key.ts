// =============================================================================================
// [ADR-062] KHOÁ CỦA TỔ CHỨC LÀ MỘT CẶP KHOÁ P-256 — PHÍA CÔNG KHAI
//
// Khoá riêng của một RFQ được bọc bằng KHOÁ CÔNG KHAI của tổ chức, hoàn toàn cục bộ: ECDH tạm
// thời → HKDF-SHA256 → AES-256-GCM, cùng các primitive ADR-011 đã chốt cho phong bì. Không có lời
// gọi KMS nào trên đường này, và không cần bí mật nào — nên `wrapForOrg` là một hàm THUẦN, dùng
// chung cho mọi adapter (local-dev hôm nay, aws-kms mai sau). Thứ khác nhau giữa các adapter chỉ
// còn hai việc: SINH cặp khoá tổ chức (`OrgKeyProvisioner`) và MỞ khoá riêng tổ chức (phía
// `./unwrap`, chỉ `apps/unseal-worker` với tới).
//
// Định dạng v2 (v1 là định dạng bọc đối xứng cũ — ADR-062 bỏ nó cho khoá RFQ):
//
//   [0x02] [điểm tạm thời, 65 byte, dạng không nén 0x04‖X‖Y] [iv 12] [tag 16] [thân]
//
//   khoá AES = HKDF-SHA256(ikm  = ECDH(khoá tạm thời, khoá công khai tổ chức),
//                          salt = điểm tạm thời ‖ điểm công khai tổ chức,
//                          info = "trustprocure/org-wrap/v2", 32 byte)
//   AAD      = [0x02, len(keyVersion)] ‖ keyVersion ‖ orgId
//
// AAD ràng buộc tổ chức và phiên bản cặp khoá: một phong bì chép sang tổ chức khác, hay khai sai
// phiên bản, hỏng tag. Salt ràng buộc CẢ HAI điểm, nên một khoá AES không dùng lại được giữa hai
// cặp (tạm thời, tổ chức) khác nhau kể cả khi bí mật ECDH trùng.
// =============================================================================================

import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

import { KeyError, type WrappedKey } from "./types.js";

export const ORG_WRAP_VERSION = 2;
export const POINT_LENGTH = 65;
export const ORG_IV_LENGTH = 12;
export const ORG_TAG_LENGTH = 16;
export const ORG_HEADER_LENGTH = 1 + POINT_LENGTH + ORG_IV_LENGTH + ORG_TAG_LENGTH;
const INFO = Buffer.from("trustprocure/org-wrap/v2", "utf8");
// Không import `assertValidOrgId` từ `local-dev-shared.ts`: file ấy nằm sau quy tắc
// `g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts` (nó mang `deriveOrgKey`), và mặt BỌC
// công khai này không được là một cây cầu tới nó.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertOrgId(orgId: string): void {
  if (!UUID.test(orgId)) throw new KeyError(`orgId phải là UUID hợp lệ, nhận được: "${orgId}".`);
}

/** Khoá công khai của một tổ chức, đủ để BỌC — không đủ để mở. */
export interface OrgPublicKey {
  readonly orgId: string;
  /** Phiên bản cặp khoá tổ chức; thành `WrappedKey.keyVersion` của mọi khoá bọc bằng nó. */
  readonly keyVersion: string;
  /** SPKI DER của một khoá P-256. */
  readonly publicKey: Uint8Array;
}

/** Cặp khoá vừa sinh: khoá công khai cộng khoá riêng ĐÃ BỌC — không bao giờ có bản rõ. */
export interface ProvisionedOrgKey extends OrgPublicKey {
  readonly wrappedPrivateKey: Uint8Array;
}

/**
 * Sinh cặp khoá của một tổ chức. local-dev: bọc khoá riêng bằng vòng master key. aws-kms:
 * `GenerateDataKeyPairWithoutPlaintext` — bên gọi (`tp-api`) không bao giờ thấy khoá riêng.
 */
export interface OrgKeyProvisioner {
  readonly name: string;
  generate(orgId: string): Promise<ProvisionedOrgKey>;
}

/** Điểm công khai P-256 dạng không nén (65 byte) của một KeyObject. */
export function diemCongKhai(khoa: KeyObject): Buffer {
  const jwk = khoa.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new KeyError("Khoá không phải một khoá EC P-256.");
  }
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) throw new KeyError("Toạ độ khoá P-256 sai độ dài.");
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

/** Dựng KeyObject công khai từ một điểm không nén 65 byte; điểm ngoài đường cong bị từ chối. */
export function khoaTuDiem(diem: Uint8Array): KeyObject {
  if (diem.length !== POINT_LENGTH || diem[0] !== 0x04) {
    throw new KeyError("Điểm P-256 phải ở dạng không nén 65 byte.");
  }
  try {
    return createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(diem.subarray(1, 33)).toString("base64url"),
        y: Buffer.from(diem.subarray(33, 65)).toString("base64url"),
      },
      format: "jwk",
    });
  } catch (error) {
    throw new KeyError("Điểm P-256 không hợp lệ.", { cause: error });
  }
}

/** Đọc SPKI DER của khoá công khai tổ chức; chỉ nhận P-256. */
export function khoaCongKhaiTuSpki(spki: Uint8Array): KeyObject {
  let khoa: KeyObject;
  try {
    khoa = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" });
  } catch (error) {
    throw new KeyError("Khoá công khai tổ chức không phải SPKI DER hợp lệ.", { cause: error });
  }
  if (khoa.asymmetricKeyType !== "ec" || khoa.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new KeyError("Khoá công khai tổ chức phải là P-256 (ADR-062).");
  }
  return khoa;
}

export function aadV2(keyVersion: string, orgId: string): Buffer {
  const kv = Buffer.from(keyVersion, "utf8");
  if (kv.length === 0 || kv.length > 255) {
    throw new KeyError("keyVersion của cặp khoá tổ chức phải dài 1–255 byte UTF-8.");
  }
  return Buffer.concat([Buffer.from([ORG_WRAP_VERSION, kv.length]), kv, Buffer.from(orgId, "utf8")]);
}

/** Khoá AES của một phong bì v2. Bên gọi phải `fill(0)` sau khi dùng. */
export function khoaPhongBi(bimat: Buffer, diemTam: Uint8Array, diemToChuc: Uint8Array): Buffer {
  return Buffer.from(hkdfSync("sha256", bimat, Buffer.concat([diemTam, diemToChuc]), INFO, 32));
}

/** Bọc `plaintext` (thường là PKCS#8 của khoá riêng RFQ) cho đúng một tổ chức. */
export function wrapForOrg(khoaToChuc: OrgPublicKey, plaintext: Uint8Array): WrappedKey {
  assertOrgId(khoaToChuc.orgId);
  const aad = aadV2(khoaToChuc.keyVersion, khoaToChuc.orgId);
  const congKhai = khoaCongKhaiTuSpki(khoaToChuc.publicKey);
  const diemToChuc = diemCongKhai(congKhai);

  const tam = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const diemTam = diemCongKhai(tam.publicKey);
  const bimat = diffieHellman({ privateKey: tam.privateKey, publicKey: congKhai });
  const khoa = khoaPhongBi(bimat, diemTam, diemToChuc);
  try {
    const iv = randomBytes(ORG_IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", khoa, iv);
    cipher.setAAD(aad);
    const than = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([Buffer.from([ORG_WRAP_VERSION]), diemTam, iv, tag, than]),
      keyVersion: khoaToChuc.keyVersion,
    };
  } finally {
    khoa.fill(0);
    bimat.fill(0);
  }
}
