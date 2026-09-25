// =============================================================================================
// [ADR-062] MỞ PHONG BÌ v2 BẰNG KHOÁ RIÊNG CỦA TỔ CHỨC — PHÍA MỞ KHOÁ, DÙNG CHUNG MỌI ADAPTER
//
// Nằm sau quy tắc `g1-khong-giai-ma-ngoai-unseal-worker-org-open-ts`: chỉ `apps/unseal-worker` và
// các unwrapper của chính gói này import được. Adapter local-dev và aws-kms khác nhau ở cách lấy
// KHOÁ RIÊNG tổ chức (vòng master key hay `kms:Decrypt`); từ lúc có nó, việc mở khoá RFQ là cùng
// một hàm — ở đây.
//
// Một `OrgKeyHandle` sống đúng MỘT lượt mở thầu (ràng buộc 4 của ADR-009): mở khoá riêng tổ chức
// một lần, mở mọi khoá RFQ cần thiết, rồi `dispose()`. Sau `dispose()`, mọi lần gọi `unwrap` ném.
// =============================================================================================

import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, type KeyObject } from "node:crypto";

import {
  aadV2,
  assertOrgId,
  diemCongKhai,
  khoaPhongBi,
  khoaTuDiem,
  ORG_HEADER_LENGTH,
  ORG_IV_LENGTH,
  ORG_WRAP_VERSION,
  POINT_LENGTH,
} from "./org-key.js";
import { KeyError, type WrappedKey } from "./types.js";

/** Khoá riêng tổ chức đã mở, sống trong đúng một lượt mở thầu. */
export interface OrgKeyHandle {
  readonly orgId: string;
  readonly keyVersion: string;
  /** Mở một khoá RFQ đã bọc bằng `wrapForOrg`. Bên gọi phải `fill(0)` kết quả khi xong. */
  unwrap(wrapped: WrappedKey): Uint8Array;
  /** Bỏ tham chiếu khoá riêng tổ chức; mọi lần `unwrap` sau đó ném. */
  dispose(): void;
}

/** Khoá riêng tổ chức ĐÃ BỌC, đúng như lưu ở CSDL. */
export interface WrappedOrgKey {
  readonly orgId: string;
  readonly keyVersion: string;
  readonly wrappedPrivateKey: Uint8Array;
}

export function taoHandle(orgId: string, keyVersion: string, khoaRieng: KeyObject): OrgKeyHandle {
  assertOrgId(orgId);
  if (khoaRieng.asymmetricKeyType !== "ec" || khoaRieng.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new KeyError("Khoá riêng tổ chức phải là P-256 (ADR-062).");
  }
  let khoa: KeyObject | null = khoaRieng;
  const diemToChuc = diemCongKhai(createPublicKey(khoaRieng));
  return {
    orgId,
    keyVersion,
    unwrap(wrapped: WrappedKey): Uint8Array {
      if (khoa === null) throw new KeyError("Khoá tổ chức đã bị huỷ sau lượt mở thầu (dispose).");
      if (wrapped.keyVersion !== keyVersion) {
        throw new KeyError("Khoá RFQ được bọc bằng một phiên bản cặp khoá tổ chức khác.");
      }
      let phongBi: Buffer;
      try {
        phongBi = Buffer.from(wrapped.ciphertext);
      } catch (error) {
        throw new KeyError("Mở phong bì thất bại: dữ liệu ciphertext không hợp lệ.", { cause: error });
      }
      if (phongBi.length < ORG_HEADER_LENGTH) {
        throw new KeyError("Mở phong bì thất bại: dữ liệu ngắn hơn phần đầu bắt buộc.");
      }
      if (phongBi[0] !== ORG_WRAP_VERSION) {
        throw new KeyError(`Mở phong bì thất bại: phiên bản định dạng ${String(phongBi[0])} không hỗ trợ.`);
      }
      const diemTam = phongBi.subarray(1, 1 + POINT_LENGTH);
      const iv = phongBi.subarray(1 + POINT_LENGTH, 1 + POINT_LENGTH + ORG_IV_LENGTH);
      const tag = phongBi.subarray(1 + POINT_LENGTH + ORG_IV_LENGTH, ORG_HEADER_LENGTH);
      const than = phongBi.subarray(ORG_HEADER_LENGTH);
      const bimat = diffieHellman({ privateKey: khoa, publicKey: khoaTuDiem(diemTam) });
      const k = khoaPhongBi(bimat, diemTam, diemToChuc);
      try {
        const decipher = createDecipheriv("aes-256-gcm", k, iv);
        decipher.setAAD(aadV2(keyVersion, orgId));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(than), decipher.final()]);
      } catch (error) {
        throw new KeyError("Mở phong bì thất bại: dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức.", {
          cause: error,
        });
      } finally {
        k.fill(0);
        bimat.fill(0);
      }
    },
    dispose(): void {
      khoa = null;
    },
  };
}

export interface OrgKeyUnwrapper {
  readonly name: string;
  /** Mở khoá riêng tổ chức cho MỘT lượt mở thầu. Bên gọi phải `dispose()` handle khi xong. */
  openOrgKey(khoa: WrappedOrgKey): Promise<OrgKeyHandle>;
}

export interface OrgKeyUnwrapperConfig {
  readonly name: string;
  /**
   * Mở khoá riêng tổ chức đã bọc, trả PKCS#8 dạng rõ. Đây là chỗ DUY NHẤT các adapter khác nhau:
   * local-dev mở bằng vòng master key; aws-kms gọi `kms:Decrypt` (kèm encryption context org_id).
   * Bản rõ trả về bị `fill(0)` ngay sau khi dựng KeyObject.
   */
  moKhoaRieng(khoa: WrappedOrgKey): Promise<Uint8Array>;
}

/** Unwrapper tổ chức cho MỌI adapter: adapter chỉ cung cấp cách mở khoá riêng tổ chức. */
export function createOrgKeyUnwrapper(cfg: OrgKeyUnwrapperConfig): OrgKeyUnwrapper {
  return {
    name: cfg.name,
    async openOrgKey(khoa: WrappedOrgKey): Promise<OrgKeyHandle> {
      assertOrgId(khoa.orgId);
      const pkcs8 = await cfg.moKhoaRieng(khoa);
      let rieng: KeyObject;
      try {
        rieng = createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" });
      } catch (error) {
        throw new KeyError("Khoá riêng tổ chức đã mở nhưng không phải PKCS#8 hợp lệ.", { cause: error });
      } finally {
        pkcs8.fill(0);
      }
      return taoHandle(khoa.orgId, khoa.keyVersion, rieng);
    },
  };
}
