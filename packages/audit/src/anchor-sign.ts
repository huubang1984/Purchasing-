// ==============================================================================================
// KÝ MỐC NEO — KHẢ NĂNG DUY NHẤT CỦA GÓI `audit` MÀ TIẾN TRÌNH `api` KHÔNG ĐƯỢC CÓ
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO FILE NÀY KHÔNG ĐI QUA `index.ts`
// ----------------------------------------------------------------------------------------------
// `packages/audit` được `apps/api` import ở mọi đường ghi (`appendAuditEvent`). Nếu bộ ký mốc neo
// nằm trong cửa công khai của gói thì tiến trình `api` — tiến trình NẰM TRONG vùng tin cậy mà mốc
// neo sinh ra để ràng buộc — link luôn được khả năng đúc mốc neo. Điều đó không tự nó là một lỗ
// (nó vẫn cần khoá riêng), nhưng nó xoá mất ranh giới mà cả cơ chế này đứng trên.
//
// Nên file này đi theo đúng khuôn `packages/crypto-keys/src/unwrap.ts` (ADR-006, INV-G1): một
// file KHÔNG re-export ở `index.ts`, cộng một quy tắc dependency-cruiser liệt kê ĐÍCH DANH những
// module được phép import nó — hôm nay là `tools/neo-so-kiem-toan` và test của chính file này.
// Quy tắc: `g11-ky-neo-chi-o-cong-cu-xuat-neo`.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO KHÔNG DÙNG CHUNG VÒNG KHOÁ VỚI BIÊN NHẬN
// ----------------------------------------------------------------------------------------------
// Hai vòng khoá cùng thuật toán, cùng dạng DER — dùng chung là một dòng ít hơn. Không dùng chung,
// vì ba lý do và cả ba đều đo được thành hậu quả:
//   ⑴ NGƯỜI GIỮ khác nhau. Khoá ký biên nhận sống trong đường nộp thầu, tức trong tiến trình
//      `api`. Khoá ký mốc neo mà cũng ở đó thì mốc neo không còn ở ngoài vùng tin cậy của tiến
//      trình bị nghi ngờ — và đó là toàn bộ giá trị của nó.
//   ⑵ NHỊP XOAY khác nhau. Biên nhận có giá trị pháp lý hàng năm nên khoá cũ không bao giờ được
//      gỡ; mốc neo chỉ cần kiểm được tới lần kiểm toán kế.
//   ⑶ MỘT LẦN LỘ KHOÁ KHÔNG ĐƯỢC LAN. Kẻ có khoá ký biên nhận đúc được biên nhận giả; nếu cùng
//      khoá ấy đúc được mốc neo thì họ RỬA LUÔN được cái sổ đã ghi việc đó.
// ==============================================================================================

import { createSign, generateKeyPairSync } from "node:crypto";
import { assertLocalDevAllowed } from "@trustprocure/crypto-keys";
import { AnchorError, buildAnchorText, type AnchorFields } from "./anchor-text.js";
import { verifyAnchorRecord, type SignedAnchorRecord } from "./anchor-verify.js";

/** Một cặp khoá ký mốc neo, cả hai nửa ở dạng DER: khoá riêng PKCS8, khoá công khai SPKI. */
export interface AnchorKeyPair {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

const KID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Vòng khoá ký mốc neo. Cùng khuôn `ReceiptSigningKeyRing`, cùng luật: xoay khoá là **thêm** một
 * khoá rồi chuyển `activeKeyId`, KHÔNG phải thay — gỡ một khoá cũ làm mọi mốc neo đã xuất trước
 * lần xoay ấy vĩnh viễn không kiểm được, tức xoá sạch chính thứ ràng buộc quá khứ.
 */
export class AnchorSigningKeyRing {
  readonly #keys: ReadonlyMap<string, AnchorKeyPair>;

  constructor(
    readonly activeKeyId: string,
    keys: Readonly<Record<string, AnchorKeyPair>>,
  ) {
    const cap = Object.entries(keys);
    if (cap.length === 0) {
      throw new AnchorError("Vòng khoá ký mốc neo phải có ít nhất một khoá.");
    }
    for (const [kid, k] of cap) {
      if (!KID_PATTERN.test(kid)) {
        throw new AnchorError(
          `Định danh khoá "${kid}" không hợp lệ: nó đi vào một dòng "kid=..." của văn bản đã ký.`,
        );
      }
      if (k.privateKey.length === 0 || k.publicKey.length === 0) {
        throw new AnchorError(`Khoá "${kid}" thiếu một nửa.`);
      }
    }
    if (!Object.hasOwn(keys, activeKeyId)) {
      throw new AnchorError(`Vòng khoá ký mốc neo không chứa khoá đang dùng "${activeKeyId}".`);
    }
    this.#keys = new Map(cap);
  }

  get(kid: string): AnchorKeyPair {
    const k = this.#keys.get(kid);
    if (k === undefined) throw new AnchorError(`Vòng khoá ký mốc neo không có "${kid}".`);
    return k;
  }

  /**
   * Nửa CÔNG KHAI của toàn bộ vòng khoá — thứ kiểm toán viên cầm.
   *
   * Đây là đầu vào của `verifyAnchorRecord`, và nó là GỐC TIN CẬY của cả cơ chế: kiểm toán viên
   * phải lấy được vòng khoá này qua một đường KHÁC đường lấy artefact. In vào hợp đồng, đọc qua
   * điện thoại, hoặc so dấu vân tay — cùng một bài toán với `fingerprint` của
   * `apps/public-keys`, và cùng một câu trả lời: không có đường ngoài thì không có neo.
   */
  publicKeys(): ReadonlyMap<string, Uint8Array> {
    return new Map([...this.#keys].map(([kid, k]) => [kid, k.publicKey]));
  }
}

/** Sinh một cặp khoá P-256 mới, cả hai nửa ở dạng DER. Dùng cho máy phát triển và cho test. */
export function generateAnchorKeyPair(): AnchorKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  return { privateKey, publicKey };
}

export interface AnchorSigner {
  readonly name: string;
  readonly activeKeyId: string;
  /** Ký một mốc neo và trả bản ghi sẽ nằm trong nơi cất. */
  sign(fields: Omit<AnchorFields, "kid">): SignedAnchorRecord;
}

/**
 * Bộ ký dùng cho phát triển và test. Môi trường thật ký bằng AWS KMS (`ECC_NIST_P256` +
 * `ECDSA_SHA_256`, ADR-009), nơi khoá riêng không bao giờ rời khỏi dịch vụ quản lý khoá — và ở
 * đó ràng buộc *"khoá ký mốc neo không nằm trong tay role deploy"* trở thành một chính sách IAM
 * đọc được, không phải một câu trong tài liệu.
 *
 * Hàng rào fail-closed chạy NGAY khi tạo, và nó là **cùng một hàm** với hàng rào của
 * `createLocalDevWrapper` và `createLocalDevReceiptSigner` — không phải một bản chép.
 *
 * Cài bằng `node:crypto` chứ không bằng WebCrypto, và đó là một quyết định KHÁC với biên nhận:
 * `createSign` trả chữ ký DER thẳng, đúng dạng `openssl dgst -sha256 -verify` đọc được, nên
 * không cần vòng đổi RAW → DER. Biên nhận chọn WebCrypto vì bên KIỂM là nhà cung cấp chạy trong
 * trình duyệt; bên kiểm mốc neo là một kiểm toán viên chạy `openssl` trên máy của họ —
 * ~~[review lượt 9 — H9-9] một kịch bản CHƯA ĐƯỢC ĐO đầu-cuối~~ **[S1.19] nay ĐÃ ĐO đầu-cuối**
 * bằng `pnpm neo trich` cộng một lượt `openssl dgst` thật trong `cong-cu.int.test.ts`.
 */
export function createLocalDevAnchorSigner(ring: AnchorSigningKeyRing): AnchorSigner {
  assertLocalDevAllowed();
  const boKy: AnchorSigner = {
    name: "local-dev",
    activeKeyId: ring.activeKeyId,
    sign(fields: Omit<AnchorFields, "kid">): SignedAnchorRecord {
      const { privateKey } = ring.get(ring.activeKeyId);
      // `buildAnchorText` chạy TRƯỚC khi ký, nên mọi regex của định dạng là một cổng chặn trên
      // đường ký chứ không phải một phép kiểm ở đường đọc.
      const text = buildAnchorText({ ...fields, kid: ring.activeKeyId });
      let sig: Buffer;
      try {
        sig = createSign("sha256")
          .update(text, "utf8")
          .sign({ key: Buffer.from(privateKey), format: "der", type: "pkcs8" });
      } catch (loi) {
        throw new AnchorError("Khoá riêng ký mốc neo không đọc được theo ECDSA P-256.", {
          cause: loi,
        });
      }
      return { text, sig: sig.toString("base64") };
    },
  };

  // ============================================================================================
  // [review lượt 9 — H9-3] TỰ KIỂM MỘT LẦN: HAI NỬA KHOÁ CÓ PHẢI MỘT CẶP KHÔNG
  // ============================================================================================
  // Không có vế này, một lần xoay khoá dán nhầm nửa công khai (hoặc nửa riêng) cho ra một bộ ký
  // chạy SẠCH: `xuat` thoát mã 0, in `seq=...` mỗi lượt, hàng tháng trời. Vì `kiem` chưa có LỊCH
  // (ADR-026 §5⑴), không ai phát hiện cho tới lần kiểm toán thật — và khi ấy `loadVerifiedAnchors`
  // fail-closed đúng như thiết kế, nhưng TOÀN BỘ cửa sổ đó không có một mốc neo dùng được. Tức
  // fail-closed ở đường ĐỌC không cứu được một lỗi cấu hình ở đường GHI; nó chỉ báo tin muộn.
  //
  // Chạy NGAY lúc tạo, cùng khuôn `assertLocalDevAllowed` ở dòng trên: một bộ ký hỏng không được
  // phép sống tới lần ký đầu tiên.
  const mau = boKy.sign({
    orgId: "00000000-0000-0000-0000-000000000000",
    seq: 1,
    hashHex: "0".repeat(64),
    exportedAt: "1970-01-01T00:00:00.000Z",
  });
  try {
    verifyAnchorRecord(mau, ring.publicKeys(), "tu-kiem");
  } catch (loi) {
    throw new AnchorError(
      `Hai nửa khoá của "${ring.activeKeyId}" KHÔNG phải một cặp: chữ ký do nửa riêng sinh ra ` +
        "không kiểm được bằng nửa công khai cùng kid. Mọi mốc neo ký bằng cấu hình này sẽ không " +
        "ai kiểm được, và lỗi sẽ chỉ lộ ra ở lần kiểm toán thật.",
      { cause: loi },
    );
  }

  return boKy;
}
