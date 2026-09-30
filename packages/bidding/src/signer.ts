// ==============================================================================================
// KÝ BIÊN NHẬN — VÒNG KHOÁ CÓ ĐỊNH DANH, VÀ MỘT ADAPTER DEV CHẶN Ở PRODUCTION
//
// [ADR-011 mục 3] Xoay khoá ký là **thêm** một khoá rồi chuyển `activeKeyId`, KHÔNG phải thay.
// Bỏ một khoá cũ đi là làm mọi biên nhận đã phát trước lần xoay ấy **vĩnh viễn không kiểm chứng
// được** — mà biên nhận có giá trị pháp lý lâu hơn vòng đời một khoá. Đây là G3 ở một đối tượng
// khác, và `MasterKeyRing` (S0) cùng `PepperRing` (ADR-018) là hai bản trước của cùng khuôn.
//
// KHÁC BIỆT ĐÁNG NÓI với hai vòng khoá kia: vòng này có một nửa **CÔNG KHAI**. `publicKeys()` là
// thứ sẽ được công bố, và nó là điều kiện để B2 có nghĩa — một chữ ký không ai lấy được khoá công
// khai để kiểm là một chữ ký không kiểm chứng được. Đường công bố (một endpoint HTTP) CHƯA tồn
// tại vì `apps/` còn rỗng; S1.5 giao CẤU TRÚC, không giao đường.
// ==============================================================================================

import type { webcrypto } from "node:crypto";
import { assertLocalDevAllowed } from "@trustprocure/crypto-keys";
import {
  RECEIPT_SIGNING_ALGORITHM,
  ReceiptError,
  rawToDerSignature,
} from "./receipt.js";

/** Một cặp khoá ký, cả hai nửa ở dạng DER: khoá riêng PKCS8, khoá công khai SPKI. */
export interface ReceiptKeyPair {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

/**
 * ~~`KID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/` — cùng tập với `KID_PATTERN` của `receipt.ts`.~~ [S1.249 / kid] Tập PHÁT HÀNH, HẸP
 * hơn tập của ĐỊNH DẠNG: không `:`. Kid biên nhận thành TÊN ĐỐI TƯỢNG S3 (`khoa-bien-nhan/<kid>.json`) khi job neo neo tài liệu
 * khoá mà `apps/public-keys` công bố (`taiLieuMotKhoa` của `tools/neo-so-kiem-toan/src/aws.ts`, tập `[A-Za-z0-9._-]`) — một kid mang
 * `:` mà bộ ký nhận là một kid ký được, công bố được, mà lệnh neo NÉM (câu hỏi của lô A1, §S1.238). Chủ dự án chốt 2026-09-30: thu
 * hẹp ở ĐÂY, trước khi có biên nhận thật nào được ký. `KID_PATTERN` của `receipt.ts` KHÔNG đổi: nó là hằng của ĐỊNH DẠNG ĐÃ KÝ, và
 * phía KIỂM phải đọc được mọi văn bản định dạng cho phép — đổi định dạng là thứ ADR-026 §1 cấm (cùng lập luận H11-11 ở
 * `tools/neo-so-kiem-toan/src/index.ts`). Bản chép cùng tập ở `apps/api/src/cau-hinh.ts` và `apps/public-keys/src/cau-hinh.ts`
 * (hàng `KID` của `tests/architecture/ma-chep-api-worker.test.ts`).
 */
const KID_PHAT_HANH = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * `kid` đi nguyên văn vào một dòng `kid=...` của văn bản được ký — dùng chung cho mọi adapter. [S1.249 / kid] Và thành tên đối
 * tượng S3 khi neo tài liệu khoá: tập phát hành là `[A-Za-z0-9._-]`, 1–64 ký tự — thông điệp nêu đúng tập ấy.
 */
export function assertReceiptKid(kid: string): void {
  if (!KID_PHAT_HANH.test(kid)) {
    throw new ReceiptError(
      `Định danh khoá "${kid}" không hợp lệ: phải dài 1–64 ký tự [A-Za-z0-9._-] (không ":") — nó đi vào một dòng "kid=..." ` +
        "của văn bản đã ký và thành tên đối tượng khi neo tài liệu khoá biên nhận.",
    );
  }
}

export class ReceiptSigningKeyRing {
  readonly #keys: ReadonlyMap<string, ReceiptKeyPair>;

  constructor(
    readonly activeKeyId: string,
    keys: Readonly<Record<string, ReceiptKeyPair>>,
  ) {
    const cap = Object.entries(keys);
    if (cap.length === 0) {
      throw new ReceiptError("Vòng khoá ký phải có ít nhất một khoá.");
    }
    for (const [kid, k] of cap) {
      assertReceiptKid(kid);
      if (k.privateKey.length === 0 || k.publicKey.length === 0) {
        throw new ReceiptError(`Khoá "${kid}" thiếu một nửa.`);
      }
    }
    if (!Object.hasOwn(keys, activeKeyId)) {
      throw new ReceiptError(`Vòng khoá ký không chứa khoá đang dùng "${activeKeyId}".`);
    }
    this.#keys = new Map(cap);
  }

  get(kid: string): ReceiptKeyPair {
    const k = this.#keys.get(kid);
    if (!k) {
      // Thông điệp nói rõ hệ quả, vì đây là chỗ một lần "dọn khoá cũ" hiện ra hậu quả của nó.
      throw new ReceiptError(
        `Vòng khoá ký không có "${kid}". Mọi biên nhận ký bằng khoá này không kiểm chứng được ` +
          "nữa — khoá cũ KHÔNG được gỡ khỏi vòng khoá (ADR-011 mục 3).",
      );
    }
    return k;
  }

  /** Nửa CÔNG KHAI của toàn bộ vòng khoá — thứ sẽ được công bố theo `kid`. */
  publicKeys(): ReadonlyMap<string, Uint8Array> {
    return new Map([...this.#keys].map(([kid, k]) => [kid, k.publicKey]));
  }
}

export interface ReceiptSigner {
  readonly name: string;
  /** `kid` đi vào văn bản được ký, nên nó phải đọc được TRƯỚC khi ký. */
  readonly activeKeyId: string;
  /** Trả chữ ký dạng **DER** — dạng của `openssl` và của AWS KMS. Xem `receipt.ts`. */
  sign(canonicalText: string): Promise<Uint8Array>;
}

function subtle(): webcrypto.SubtleCrypto {
  const c: webcrypto.Crypto | undefined = globalThis.crypto;
  if (c?.subtle === undefined) throw new ReceiptError("Môi trường này không có crypto.subtle.");
  return c.subtle;
}

/**
 * Bộ ký dùng cho phát triển và test. Môi trường thật dùng AWS KMS (`ECC_NIST_P256` +
 * `ECDSA_SHA_256`, ADR-009), nơi khoá riêng không bao giờ rời khỏi dịch vụ quản lý khoá.
 *
 * Hàng rào fail-closed chạy NGAY khi tạo, và nó là **cùng một hàm** với hàng rào của
 * `createLocalDevWrapper` — không phải một bản chép. Xem khối đầu
 * `packages/crypto-keys/src/moi-truong.ts` để biết vì sao hàm ấy được tách ra một file riêng.
 *
 * Cài bằng **WebCrypto**, không bằng `node:crypto`, và đó là một quyết định: cùng một cài đặt
 * ECDSA ký và kiểm, nên một sai lệch giữa hai bên là điều KHÔNG diễn đạt được. Giá phải trả là
 * một lần đổi RAW → DER, và phép đổi ấy có test đối chiếu với DER thật do `node:crypto` sinh ra.
 */
export function createLocalDevReceiptSigner(ring: ReceiptSigningKeyRing): ReceiptSigner {
  assertLocalDevAllowed();
  return {
    name: "local-dev",
    activeKeyId: ring.activeKeyId,
    async sign(canonicalText: string): Promise<Uint8Array> {
      const { privateKey } = ring.get(ring.activeKeyId);
      const s = subtle();
      let khoa: webcrypto.CryptoKey;
      try {
        khoa = await s.importKey(
          "pkcs8",
          privateKey,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        );
      } catch (loi) {
        throw new ReceiptError("Khoá riêng ký không đọc được theo ECDSA P-256.", { cause: loi });
      }
      const raw = new Uint8Array(
        await s.sign(
          { name: "ECDSA", hash: "SHA-256" },
          khoa,
          new TextEncoder().encode(canonicalText),
        ),
      );
      return rawToDerSignature(raw);
    },
  };
}

export { RECEIPT_SIGNING_ALGORITHM };
